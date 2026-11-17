/**
 * Every trigger in a show, as one table: the cues' hotkeys, OSC, MIDI, clock and timecode triggers, and the MIDI
 * messages set to run the show (Settings ▸ Integrations ▸ Network ▸ MIDI), so that two things answering to the same key or the same
 * message are seen before a performance finds them.
 *
 *   triggersOf(doc)  -> [{ kind, text, id, number, name, list, what, clash: [labels of the others], bad }]
 *       kind: 'hotkey' | 'osc' | 'midi' | 'clock' | 'timecode'. `id` is the cue (null for a show command, whose
 *       `what` says which: "GO"). `clash` names whatever else the same key or message would set off. `bad`: why
 *       the trigger cannot work as written ('' when it can).
 *   clockDue(doc, date, fired) -> the cues whose clock trigger is due at `date` and has not fired today
 *
 * Two MIDI triggers clash when one message could be both ("note 60" and "note 60 ch 2"). Two OSC triggers clash
 * when they are the same address and arguments; two patterns that only overlap ("/a/*" and "/a/b") are not found.
 */
const show = require('./show');
const midi = require('../net/midi');
const timecode = require('../timecode/timecode');
const { defaultName } = require('./cue-types');

const COMMAND_LABELS = { go: 'GO', panic: 'Panic', pause: 'Pause all', resume: 'Resume all', next: 'Playhead down', previous: 'Playhead up' };
const KINDS = [['hotkey', 'hotkey'], ['osc', 'oscTrigger'], ['midi', 'midiTrigger'], ['clock', 'clockTrigger'], ['timecode', 'timecodeTrigger']];
const same = (a, b) => a === undefined || b === undefined || a === b;
/** Whether one arriving MIDI message could be both of these. */
function midiOverlap(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'raw') return midi.hex(a.bytes) === midi.hex(b.bytes);
  if (a.kind === 'msc') return a.command === b.command && same(a.cue, b.cue) && same(a.list, b.list);
  return a.number === b.number && same(a.channel, b.channel) && (a.kind === 'noteoff' || same(a.value, b.value));
}

function triggersOf(doc) {
  const rate = ((doc.settings || {}).timecode || {}).rate || '30';
  const { byId } = show.index(doc);
  const rows = [];
  const add = (kind, text, c, list) => {
    const row = { kind, text: String(text).trim(), id: c ? c.id : null, number: c ? c.number || '' : '', name: c ? c.name || defaultName(c, byId) : '', list: list || '', what: '', clash: [], bad: '' };
    if (kind === 'hotkey') { row.key = show.normaliseHotkey(text); if (!row.key) row.bad = 'not a key a cue can have'; else if (show.APP_KEYS.has(row.key)) row.bad = 'one of the app’s own keys'; }
    if (kind === 'osc') { row.key = row.text.split(/\s+/).join(' '); if (!row.text.startsWith('/')) row.bad = 'not an OSC address'; }
    if (kind === 'midi') { try { row.msg = midi.parseText(text); } catch (err) { row.bad = err.message; } }
    if (kind === 'clock') { row.clock = show.parseClock(text); if (!row.clock) row.bad = 'not a time of day'; }
    if (kind === 'timecode') { const tc = timecode.parse(text); row.bad = timecode.whyNot(tc, rate); if (!row.bad) row.key = String(timecode.toFrames(tc, rate)); }
    rows.push(row);
    return row;
  };
  for (const l of doc.lists || []) {
    const walk = (cues) => { for (const c of cues) { for (const [kind, field] of KINDS) if (c[field] !== undefined && String(c[field]).trim() !== '') add(kind, c[field], c, l.name); if (c.children) walk(c.children); } };
    walk(l.cues || []);
  }
  for (const [k, text] of Object.entries(((doc.settings || {}).midi || {}).commands || {})) if (text && COMMAND_LABELS[k]) add('midi', text, null).what = COMMAND_LABELS[k];
  // (and the OSC messages set to run it: Settings ▸ Integrations ▸ Network ▸ Incoming OSC)
  for (const [k, text] of Object.entries(((doc.settings || {}).network || {}).commands || {})) if (text && COMMAND_LABELS[k]) add('osc', text, null).what = COMMAND_LABELS[k];
  const label = (r) => (r.id ? `${r.number ? `${r.number} · ` : ''}${r.name}` : r.what);
  const clashes = (a, b) => {
    if (a.kind !== b.kind || a.bad || b.bad) return false;
    if (a.kind === 'midi') return midiOverlap(a.msg, b.msg);
    if (a.kind === 'clock') return a.clock.secs === b.clock.secs && (!a.clock.days || !b.clock.days || [...a.clock.days].some((d) => b.clock.days.has(d)));
    return a.key === b.key;
  };
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) if (clashes(rows[i], rows[j])) { rows[i].clash.push(label(rows[j])); rows[j].clash.push(label(rows[i])); }
  return rows.map(({ key, msg, clock, ...r }) => r);
}

/** The cues whose clock trigger falls at `date` (by this computer's clock), less those in `fired`, which each is
 *  added to as it is returned. A time is due from its second until three seconds after: one long past, because the
 *  app was opened late, is not. The caller empties `fired` when the day changes. */
function clockDue(doc, date, fired) {
  const secs = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds(), out = [];
  show.walk(doc, (c) => {
    const t = c.clockTrigger && show.parseClock(c.clockTrigger);
    const key = `${c.id}@${c.clockTrigger}`;
    if (!t || fired.has(key) || (t.days && !t.days.has(date.getDay()))) return;
    if (secs >= t.secs && secs - t.secs <= 3) { fired.add(key); out.push(c); }
  });
  return out;
}

module.exports = { triggersOf, clockDue, midiOverlap, COMMAND_LABELS };
