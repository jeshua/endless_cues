/**
 * Is it there? Each device's live state, worked out from what was asked and what was heard
 * (docs/specs/15-assistant-and-rig.md, section 3.6).
 *
 *   alive.how   what the app does                                ready when
 *   ask         sends alive.send every `every` seconds, quietly  something matching `reply` was heard within 3 × every
 *   heartbeat   sends nothing; the input port is open            something matching `hears` arrived within `within`
 *   none        nothing                                          a TCP device while connected, a MIDI device while there
 *                                                                is a MIDI output; otherwise it cannot be told
 *
 * Plain node, driven by whoever owns the network (the host; `ec check --ask`; a test on a fake clock):
 *
 *   const live = createLiveness({ send, clock, log, changed, stopped });
 *   live.configure(devices, { held, facts })     the show's devices, whenever they change
 *   live.heard(id, msg)                          a message arrived from that device ({ address, args })
 *   live.tick()                                  call it a few times a second: asks whoever is due, and notices who has stopped
 *   live.ask(id)                                 one ask now → Promise<{ ok, held, answered, ms, text, why }> (waits up to 1.5 s)
 *   live.state(id) / live.states()               { state, text, heardAt, ageMs, reports, lastIn, how }
 *
 * `send(device, text)` sends one message and returns { ok, held, why } (the hub's entry). `facts(id)` says what
 * this cannot know itself: { tcp: true | false | undefined (its connection), midi: true | false (a MIDI output is present) }.
 *
 * Rules that came from running a show on this: asking starts only for a device that says `ask`; a device that
 * stops answering is logged once, when it stops, and once more when it is back; nothing here is awaited by a
 * GO (a send is one datagram); held back, nothing is sent and the state says "held back", not "not answering".
 */
import * as osc from '../net/osc';
import { viaOf, isNetwork } from './devices';

const ASK_WAIT_MS = 1500;
const CANNOT = 'It cannot be asked. Press Try and look at it.';

const ago = (ms) => (ms < 1500 ? 'a moment ago' : ms < 90000 ? `${Math.round(ms / 1000)} s ago` : ms < 5400000 ? `${Math.round(ms / 60000)} min ago` : `${Math.round(ms / 3600000)} h ago`);
const textOf = (msg) => { try { return osc.toText(msg); } catch { return String((msg && msg.address) || ''); } };

function createLiveness({ send = () => ({ ok: false, why: 'nothing to send with' }), clock = null, log = () => {}, changed = () => {}, stopped = () => {}, facts = () => ({}) } = {}) {
  const now = clock && clock.now ? () => clock.now() : Date.now;
  const later = clock && clock.setTimeout ? (fn, ms) => clock.setTimeout(fn, ms) : (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; };
  // an ask's wait is awaited, so it keeps the process alive (`ec try` would otherwise exit before its answer)
  const awaited = clock && clock.setTimeout ? later : setTimeout;
  const cancel = clock && clock.clearTimeout ? (t) => clock.clearTimeout(t) : clearTimeout;
  let devices = [];
  let held = '';
  const live = new Map();           // device id -> { since, askedAt, sentAt, heardAt, rtt, lastIn, values, was, waiters }
  const of = (id) => { if (!live.has(id)) live.set(id, { since: now(), askedAt: 0, sentAt: 0, heardAt: 0, rtt: null, lastIn: '', values: {}, was: '', waiters: new Set(), error: '' }); return live.get(id); };
  const addressed = (d) => !isNetwork(d) || (!!d.host && Number(d.port) > 0);

  function askNow(d) {
    const l = of(d.id);
    l.askedAt = now();
    let r;
    try { r = send(d, d.alive.send) || {}; } catch (err) { r = { ok: false, why: err.message }; }
    if (r.ok === false && !r.held) l.error = r.why || 'could not be sent'; else l.error = '';
    if (r.ok !== false) l.sentAt = l.askedAt;
    return r;
  }

  /** One device's state as the Rig shows it. */
  function state(id) {
    const d = devices.find((x) => x.id === id);
    if (!d) return null;
    const l = of(id), t = now(), a = d.alive || { how: 'none' };
    const out = { how: a.how || 'none', state: 'unknown', text: '', heardAt: l.heardAt || 0, ageMs: l.heardAt ? Math.max(0, t - l.heardAt) : null, reports: [], lastIn: l.lastIn };
    for (const r of d.reports || []) {
      const v = l.values[r.key];
      if (v === undefined || (r.none !== undefined && v === r.none)) continue;
      const n = Number(v);
      out.reports.push({ key: r.key, label: r.label || r.key, value: v, ...(r.unit ? { unit: r.unit } : {}), warn: typeof v === 'number' && ((r.warnBelow !== undefined && n < r.warnBelow) || (r.warnAbove !== undefined && n > r.warnAbove)) });
    }
    if (!addressed(d)) return { ...out, state: 'look', text: 'no address yet' };
    const last = l.heardAt ? ` (last heard ${ago(t - l.heardAt)})` : '';
    if (a.how === 'ask') {
      const window = 3 * (Number(a.every) || 2) * 1000;
      if (l.heardAt && t - l.heardAt <= window) return { ...out, state: 'ready', text: `answering${l.rtt != null ? ` · ${Math.max(1, Math.round(l.rtt))} ms` : ''}` };
      if (held) return { ...out, state: 'look', text: 'held back', held: true };
      if (l.error) return { ...out, state: 'problem', text: `cannot be asked: ${l.error}` };
      // (just added, or just let go: it has not had the time to answer yet)
      if (t - l.since < window) return { ...out, state: 'unknown', text: 'asking…' };
      return { ...out, state: 'problem', text: `not answering${last}` };
    }
    if (a.how === 'heartbeat') {
      const window = (Number(a.within) || 5) * 1000;
      if (l.heardAt && t - l.heardAt <= window) return { ...out, state: 'ready', text: `heard ${ago(t - l.heardAt)}` };
      if (t - l.since < window) return { ...out, state: 'unknown', text: 'listening…' };
      return { ...out, state: 'problem', text: l.heardAt ? `gone quiet${last}` : 'nothing heard from it yet' };
    }
    const f = facts(id) || {};
    if (viaOf(d) === 'midi') return f.midi === true ? { ...out, state: 'ready', text: 'a MIDI output is present' } : f.midi === false ? { ...out, state: 'problem', text: 'no MIDI output on this computer' } : { ...out, text: CANNOT };
    if ((d.protocol || 'udp') === 'tcp') return f.tcp === true ? { ...out, state: 'ready', text: 'connected' } : f.tcp === false ? { ...out, state: 'problem', text: 'not connected' } : { ...out, text: CANNOT };
    return { ...out, text: CANNOT };
  }

  return {
    /** The show's devices, whenever they change. `held`: why nothing is being sent ('' when it is). */
    configure(list = [], { held: why = '' } = {}) {
      devices = list.map((d) => ({ ...d }));
      const was = held; held = String(why || '');
      for (const id of [...live.keys()]) if (!devices.some((d) => d.id === id)) { for (const w of live.get(id).waiters) w(null); live.delete(id); }
      for (const d of devices) {
        const l = of(d.id);
        const key = JSON.stringify([d.alive || null, d.host || '', d.port || 0, d.protocol || 'udp', viaOf(d)]);
        // a device that is new, re-aimed or asked another way starts again: it is given its time to answer
        const fresh = l.key !== key;
        if (fresh || (was && !held)) { l.key = key; l.since = now(); l.askedAt = 0; l.error = ''; if (fresh) { l.heardAt = 0; l.values = {}; l.was = ''; } }
      }
    },

    /** A message arrived from a device. Returns true when it counts as "it is there". */
    heard(id, msg, at = now()) {
      const d = devices.find((x) => x.id === id);
      if (!d || !msg) return false;
      const l = of(id), a = d.alive || { how: 'none' };
      l.lastIn = textOf(msg);
      for (const r of d.reports || []) if (osc.matches(r.from, msg.address) && msg.args && msg.args[r.arg] !== undefined) l.values[r.key] = msg.args[r.arg];
      const pattern = a.how === 'ask' ? a.reply : a.how === 'heartbeat' ? a.hears : null;
      const counts = a.how !== 'none' && (!pattern || osc.matches(pattern, msg.address));
      if (!counts) return false;
      l.heardAt = at;
      if (a.how === 'ask' && l.sentAt && at >= l.sentAt) { l.rtt = at - l.sentAt; l.sentAt = 0; }
      for (const w of [...l.waiters]) w(msg);
      return true;
    },

    /** Ask whoever is due, and notice (once) who has stopped answering and who is back. */
    tick() {
      const t = now();
      for (const d of devices) {
        const a = d.alive || {}, l = of(d.id);
        if (a.how === 'ask' && !held && addressed(d) && t - l.askedAt >= (Number(a.every) || 2) * 1000) askNow(d);
        const s = state(d.id).state;
        if (s !== l.was) {
          // said on the change, never again every two seconds
          if (l.was === 'ready' && s === 'problem') { log(`${d.name} has stopped answering`); try { stopped(d, state(d.id)); } catch { /* the caller's */ } }
          else if (s === 'ready' && l.was === 'problem') log(`${d.name} is answering again`);
          else if (s === 'problem' && l.was !== 'ready') log(`${d.name}: ${state(d.id).text}`);
          l.was = s;
          changed();
        }
      }
    },

    /** One "are you there?" now. Resolves within 1.5 s: { ok, held, answered, ms, text, why }. */
    ask(id) {
      const d = devices.find((x) => x.id === id);
      const no = (why, more = {}) => Promise.resolve({ ok: false, held: false, answered: false, ms: 0, text: '', why, ...more });
      if (!d) return no(`no device with the id ${id}`);
      const a = d.alive || {};
      if (a.how !== 'ask') return no(a.how === 'heartbeat' ? `${d.name} is not asked: it says it is there by itself (${state(id).text}).` : `${d.name} cannot be asked: press Try on the Rig page and look at it.`);
      if (!addressed(d)) return no(`${d.name} has no address yet.`);
      if (held) return no(held, { held: true });
      const l = of(id), started = now();
      return new Promise((resolve) => {
        let timer = null;
        const done = (msg) => {
          cancel(timer); l.waiters.delete(done);
          if (msg) resolve({ ok: true, held: false, answered: true, ms: Math.max(1, Math.round(now() - started)), text: textOf(msg), why: '' });
          else resolve({ ok: true, held: false, answered: false, ms: Math.round(now() - started), text: '', why: `No answer in ${ASK_WAIT_MS / 1000} s.` });
          changed();
        };
        l.waiters.add(done);
        timer = awaited(() => done(null), ASK_WAIT_MS);
        const r = askNow(d);
        if (r.held) { cancel(timer); l.waiters.delete(done); resolve({ ok: false, held: true, answered: false, ms: 0, text: '', why: r.why || 'held back' }); }
        else if (r.ok === false) { cancel(timer); l.waiters.delete(done); resolve({ ok: false, held: false, answered: false, ms: 0, text: '', why: r.why || 'it could not be sent' }); }
      });
    },

    state,
    states() { return Object.fromEntries(devices.map((d) => [d.id, state(d.id)])); },
    /** Whether any device wants the input port open (one that says it is there by itself). */
    wantsInput() { return devices.some((d) => (d.alive || {}).how === 'heartbeat'); },
    close() { for (const l of live.values()) for (const w of [...l.waiters]) w(null); live.clear(); devices = []; },
  };
}

export { createLiveness, ASK_WAIT_MS, CANNOT, ago };
