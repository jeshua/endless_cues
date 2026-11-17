/**
 * Check the show: everything that would go wrong in it, found without playing anything, in one list.
 *
 * QLab has no way to check a show short of running it. This reads the show and what the app knows about this
 * computer, and says in a few words each what will not work:
 *
 *   - each cue's own problems (show.js `problems`): a target that is gone, a file missing or one that cannot be
 *     played here, a sound sent to outputs this device does not have, a hotkey used twice, and the rest;
 *   - a cue that can never play: disarmed, with no Arm cue to arm it;
 *   - cues that start each other round and round (a Start cue, a Script cue, a continue): with no wait between,
 *     the app has to stop it; with waits, it goes on until someone stops it;
 *   - two triggers answering to the same message (core/show/triggers.js);
 *   - what the Rig page (core/rig/check.js) says is wrong with the equipment and the outputs right now: an output
 *     that is away, a device that does not answer, a display not connected. Nothing is asked here that the Rig
 *     page does not already ask.
 *
 *   checkShow(doc, facts) → [{ id, level: 'problem' | 'look', text, rig }]
 *     id: the cue the line is about (a click selects it), or null. rig: true when the Rig page says more.
 *     facts (each may be missing): problems (the host's list: show.problems with what the running app adds),
 *     rig (core/rig/check.js items), triggers (core/show/triggers.js rows).
 *
 * Pure: no disk, no network.
 */
import * as show from './show';
import * as scriptOf from './script';
import { triggersOf } from './triggers';

const TRIGGER = { osc: 'OSC trigger', midi: 'MIDI trigger', clock: 'clock trigger', timecode: 'timecode trigger', hotkey: 'hotkey' };
const RIG_GROUPS = new Set(['sound', 'picture', 'lights', 'equipment', 'connections']);

/** What firing each cue fires: id -> [{ to, wait }] (`wait`: seconds known to pass first; Infinity: it waits for something to end). */
function firings(doc) {
  const { byId } = show.index(doc);
  const edges = new Map();
  const add = (from, to, wait) => { if (!to || !byId.has(to)) return; if (!edges.has(from)) edges.set(from, []); edges.get(from).push({ to, wait }); };
  const pre = (c) => Number(c && c.preWait) || 0;
  const sequence = (cues, inside) => {
    const steps = cues.filter((c) => c.type !== 'section');
    steps.forEach((c, i) => {
      const next = steps[i + 1];
      // a continue runs in a list, and inside a group that starts its first child
      if (next && (!inside || inside.mode === 'first' || inside.mode === 'enter')) {
        if (c.continue === 'auto-continue') add(c.id, next.id, (Number(c.postWait) || 0) + pre(next));
        if (c.continue === 'auto-follow') add(c.id, next.id, Infinity);
      }
      if (c.type === 'group') {
        const kids = (c.children || []).filter((k) => k.type !== 'section');
        const fired = c.mode === 'first' || c.mode === 'enter' ? kids.slice(0, 1) : kids;
        for (const k of fired) add(c.id, k.id, pre(k) + (c.mode === 'playlist' && k !== kids[0] ? Infinity : 0));
        sequence(c.children || [], c);
      }
      if (c.type === 'start' && c.target && byId.has(c.target)) add(c.id, c.target, pre(byId.get(c.target)));
      if (c.type === 'script' && c.script) {
        let due = 0;
        for (const st of scriptOf.parse(c.script).steps) {
          if (st.do === 'wait') { due += Number(st.secs) || 0; continue; }
          if (st.do !== 'start' && st.do !== 'preview') continue;
          const t = st.id != null ? byId.get(st.id) : show.findByNumber(doc, st.number);
          if (t) add(c.id, t.id, due + pre(t));
        }
      }
    });
  };
  for (const l of doc.lists) sequence(l.cues, null);
  // (each cue's own pre-wait is on the way into it: what fires it waits that long before it acts)
  return edges;
}

/** Each cycle of cues that fire each other, once: [{ ids, wait }] (`wait`: the least time one round takes). */
function loops(doc) {
  const edges = firings(doc);
  const out = [], seen = new Set();
  const state = new Map();                 // id -> 1 on the path, 2 done
  const path = [];
  const visit = (id) => {
    state.set(id, 1); path.push(id);
    for (const e of edges.get(id) || []) {
      if (state.get(e.to) === 1) {
        const ids = path.slice(path.indexOf(e.to));
        const key = [...ids].sort().join(' ');
        if (!seen.has(key)) {
          seen.add(key);
          let wait = 0;
          for (let i = 0; i < ids.length; i++) {
            const to = ids[(i + 1) % ids.length];
            const step = (edges.get(ids[i]) || []).filter((x) => x.to === to).reduce((m, x) => Math.min(m, x.wait), Infinity);
            wait += step;
          }
          out.push({ ids, wait });
        }
      } else if (!state.has(e.to)) visit(e.to);
    }
    path.pop(); state.set(id, 2);
  };
  for (const id of edges.keys()) if (!state.has(id)) visit(id);
  return out;
}

function checkShow(doc, facts = {}) {
  const { byId } = show.index(doc);
  const out = [];
  const name = (id) => { const c = byId.get(id); return c ? c.number || c.name || c.type : id; };
  const line = (id, level, text, more = {}) => out.push({ id: id || null, level, text, rig: false, ...more });

  // the cues' own problems, as the app knows them (a missing file, a target that is gone, outputs it does not have)
  const seen = new Set();
  for (const p of facts.problems || show.problems(doc)) {
    const k = `${p.id} ${p.why}`;
    if (seen.has(k)) continue;
    seen.add(k);
    line(p.id, p.level === 'error' ? 'problem' : 'look', p.why);
  }

  // a cue that can never play: disarmed, and nothing arms it
  const armed = new Set();
  show.walk(doc, (c) => { if (c.type === 'arm' && c.target) armed.add(c.target); });
  const offUnder = (c) => { if (c.armed === false && !armed.has(c.id)) { line(c.id, 'look', 'disarmed, and no Arm cue arms it: it never plays'); return; } for (const k of c.children || []) offUnder(k); };
  for (const l of doc.lists) for (const c of l.cues) offUnder(c);

  // cues that start each other round and round
  for (const lp of loops(doc)) {
    const round = [...lp.ids, lp.ids[0]].map(name).join(' → ');
    if (lp.wait === 0) line(lp.ids[0], 'problem', `starts itself again with no wait (${round}): the app stops it after 24 rounds`);
    else if (Number.isFinite(lp.wait)) line(lp.ids[0], 'look', `goes round for ever, every ${Math.round(lp.wait * 100) / 100} s (${round}): only a Stop or Esc ends it`);
  }

  // two triggers that answer to the same thing (a hotkey used twice is in the cues' own problems already)
  for (const t of facts.triggers || triggersOf(doc)) {
    if (!t.clash.length || t.kind === 'hotkey') continue;
    line(t.id, 'look', `its ${TRIGGER[t.kind] || t.kind} ${t.text} also starts ${t.clash.join(' and ')}`);
  }

  // the equipment and the outputs, as the Rig page has them now
  for (const r of facts.rig || []) {
    if (!RIG_GROUPS.has(r.group) || r.id === 'sound.files') continue;
    if (r.state !== 'problem' && !(r.state === 'look' && r.group === 'equipment' && r.needed)) continue;
    // a device or a patch: the first cue that sends to it, so the line goes somewhere
    let id = null;
    const dev = r.device || r.patch;
    if (dev) show.walk(doc, (c) => { if (!id && (c.device === dev || c.patch === dev)) id = c.id; });
    line(id, r.state === 'problem' ? 'problem' : 'look', `${r.label}: ${r.text || 'not ready'}`, { rig: true });
  }

  // problems first, then what to look at; each in the order of the list
  const order = new Map();
  let i = 0; show.walk(doc, (c) => order.set(c.id, i++));
  const at = (x) => (x.id && order.has(x.id) ? order.get(x.id) : -1);
  return out.sort((a, b) => (a.level === b.level ? at(a) - at(b) : a.level === 'problem' ? -1 : 1));
}

/** The one line that says it: "Nothing wrong", "2 problems · 3 to look at". */
function summary(lines) {
  const p = lines.filter((x) => x.level === 'problem').length, l = lines.length - p;
  if (!lines.length) return 'Nothing wrong';
  return [p ? `${p} problem${p === 1 ? '' : 's'}` : '', l ? `${l} to look at` : ''].filter(Boolean).join(' · ');
}

export { checkShow, summary, loops, firings };
