/**
 * QLab's show control broadcast, as OSC: who asked to hear what, and the messages an event becomes.
 *
 * A client subscribes with "/listen" (everything), "/listen/<event>" or "/listen/<event>/<field>", and
 * unsubscribes with the same under "/ignore". An event about a cue is sent as
 *
 *   /qlab/event/workspace/<event> <number> <name> <uniqueID> <type>
 *
 * and again as four messages of one argument each (…/number, …/name, …/uniqueID, …/type), so that a
 * device which can only match an address, or only read one argument, has something to use. The events
 * about everything at once (pauseAll, panicAll…) have no argument.
 *
 * "/eventFormat <text>" gives a client its own wording: every one-argument message it listens to is sent
 * as that text instead, with #data# (the argument), #address# and #workspace_id# filled in. QLab's manual
 * gives "/eventFormat "/eos/cue/#data#/fire"" with "/listen/go/number" as the way to make a desk follow.
 *
 * Written from QLab 5's manual (Show Control Broadcast); not yet compared with QLab on a network.
 */
const osc = require('./osc');

const CUE_EVENTS = ['go', 'auditionGo', 'cue/start', 'cue/stop', 'playhead'];
const ALL_EVENTS = ['pauseAll', 'resumeAll', 'panicAll', 'stopAll', 'hardStopAll', 'resetAll'];
const FIELDS = ['number', 'name', 'uniqueID', 'type'];
const PREFIX = '/qlab/event/workspace';

/** What "/listen/<rest>" names: a list of subscription keys ('go', 'go/number', 'pauseAll'…), or null if it names nothing. */
function keysOf(rest = '') {
  const r = String(rest).replace(/^\/+|\/+$/g, '');
  if (!r) return [...CUE_EVENTS.flatMap((e) => [e, ...FIELDS.map((f) => `${e}/${f}`)]), ...ALL_EVENTS];
  if (ALL_EVENTS.includes(r)) return [r];
  if (CUE_EVENTS.includes(r)) return [r, ...FIELDS.map((f) => `${r}/${f}`)];
  const m = /^(.*)\/([^/]+)$/.exec(r);
  return m && CUE_EVENTS.includes(m[1]) && FIELDS.includes(m[2]) ? [r] : null;
}

/** A format as "/eventFormat" takes one, checked: { address, args } with the tokens still in it. Throws if it is not a message. */
function parseFormat(text) {
  return osc.parseText(String(text));
}
function fill(format, values) {
  const sub = (s) => String(s).replace(/#(data|address|workspace_id|status)#/g, (_t, k) => (values[k] == null ? '' : String(values[k])));
  const m = parseFormat(format);
  return [sub(m.address), m.args.map((a) => (a.type === 's' ? { type: 's', value: sub(a.value) } : a))];
}

/**
 * The messages one event is, for one subscriber: [[address, args], …].
 *   event   'go' | 'cue/start' | 'cue/stop' | 'playhead' | 'pauseAll' | …
 *   cue     { number, name, uniqueID, type } for an event about a cue (null: the playhead stands nowhere)
 *   subs    the subscriber's keys (a Set)
 *   format  its "/eventFormat", or ''
 */
function messages(event, cue, subs, { format = '', workspaceId = '' } = {}) {
  const out = [];
  const str = (v) => ({ type: 's', value: String(v == null ? '' : v) });
  if (ALL_EVENTS.includes(event)) {
    if (subs.has(event) && !format) out.push([`${PREFIX}/${event}`, []]);       // (with a format only one-argument messages are sent)
    return out;
  }
  const c = cue || {};
  if (subs.has(event) && !format) out.push([`${PREFIX}/${event}`, FIELDS.map((f) => str(c[f]))]);
  for (const f of FIELDS) {
    if (!subs.has(`${event}/${f}`)) continue;
    const address = `${PREFIX}/${event}/${f}`;
    if (!format) { out.push([address, [str(c[f])]]); continue; }
    try { out.push(fill(format, { data: c[f], address, workspace_id: workspaceId, status: '' })); } catch { /* a format that is not a message was refused when it was set */ }
  }
  return out;
}

module.exports = { CUE_EVENTS, ALL_EVENTS, FIELDS, PREFIX, keysOf, parseFormat, messages };
