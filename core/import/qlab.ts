/**
 * A QLab 5 workspace (.qlab5), read straight from the file: no QLab needed, on any platform.
 * A QLab 4 workspace (.qlab4) is the same kind of file with a few things in other places, and is read too: the
 * sound's path beside the workspace is on the cue (not in its file record), a fade says "relative" in words,
 * the network patches are a numbered list under the OSC settings, and an Audio cue always carries an end time
 * (so `endAtFileEnd` lists the cues whose End at may only be the file's own end: the host drops those once it
 * has measured the files). Checked against one real QLab 4.7 workspace of Audio, Fade and Group cues; its
 * Network and MIDI cues are read by the QLab 5 names and have not met a real QLab 4 file.
 *
 *   importQlab(buffer, { file })  → { doc, report }
 *
 * `doc` is an Endless Cues show (not yet a folder: the app opens it untitled, and Save puts it somewhere
 * and collects its sound files). `report` says, in the operator's terms, what came across and what did
 * not, cue by cue: { source, counts, issues: [{ id, cue, why }], summary: ["3 Video cues …", …] }.
 *
 * The file is a keyed archive (core/import/plist.js) whose `cueLists` is a second archive: one root
 * Group whose children are the cue lists (and carts). What is mapped was worked out from workspaces
 * saved by QLab 5.6; nothing here is Figure 53's code, and a file from a later QLab may hold things
 * this has not seen. Anything it cannot carry over it says so, and the cue is kept (as a Memo with
 * its number, name, notes, waits and continue) so sequences and targets still line up.
 *
 * What comes across: lists, and carts with each cue on its button; groups; Audio (file, level, start, end, loop, rate, and its level matrix as the cue's own
 * outputs when it is not QLab's default: see `ownOutputs`; its integrated fade envelope
 * only if it is written the way envelopeOf() guesses, which no real workspace has yet confirmed); Fade (the main level,
 * absolute or relative, stop target); Start, Stop, Pause, Load, GoTo, Arm, Disarm, Devamp, Wait,
 * Memo; Video (its file, level, start, end and loop, read as an Audio cue's are), Text and Camera, as cues for
 * the stage; Network (OSC, with a 1D fade); MIDI (with a faded value); MIDI File; Timecode (by guess: see
 * `timecodeOf`); Light (its commands as text and its fade time, where the text
 * can be found: never checked on a real workspace with Light cues; the light patch is not read); numbers, names, notes, colours, flags, armed, pre- and
 * post-waits, continue modes; "fade and stop others" on a group; double-GO protection, the panic
 * time and the network patches.
 */
import * as path from 'path';
import * as fs from 'fs';
import { unarchive } from './plist';
import * as show from '../show/show';
import * as midi from '../net/midi';
import * as routing from '../audio/routing';
import * as Lanes from '../audio/lanes';
import * as lightCommands from '../light/commands';
import * as timecode from '../timecode/timecode';
import * as cart from '../show/cart';

const SILENT_DB = -60;
/** QLab stores a level as a linear gain: 1 is 0 dB. */
const toDb = (gain) => { const g = Number(gain); if (!(g > 0)) return SILENT_DB; return Math.max(SILENT_DB, Math.round(200 * Math.log10(g)) / 10); };

// QLab's group modes (its OSC dictionary's /mode)
const GROUP_MODE = { 0: 'cue list', 1: 'Start First and Enter', 2: 'Start First', 3: 'Timeline', 4: 'Start Random', 5: 'cart', 6: 'Playlist' };
// its 20 colour names → our nine
const COLOR = {
  red: 'red', orange: 'orange', yellow: 'yellow', green: 'green', blue: 'blue', purple: 'purple',
  berry: 'pink', magenta: 'pink', fuchsia: 'pink', pink: 'pink', rose: 'pink', coral: 'red', peach: 'orange', ochre: 'orange', gold: 'yellow',
  lime: 'green', forest: 'green', olive: 'green', teal: 'teal', cyan: 'teal', ocean: 'teal', aqua: 'teal', indigo: 'blue', cerulean: 'blue', sky: 'blue',
  lilac: 'purple', violet: 'purple', grey: 'grey', gray: 'grey', taupe: 'grey', brown: 'orange',
};
// the cue classes that have a cue of ours of the same kind
const SIMPLE = { StartCue: 'start', StopCue: 'stop', PauseCue: 'pause', GotoCue: 'goto', GoToCue: 'goto', ArmCue: 'arm', DisarmCue: 'disarm', DevampCue: 'devamp', MemoCue: 'memo' };
// the ones that have none yet
const UNSUPPORTED = {
  MicCue: 'Mic', LightCue: 'Light', MIDICue: 'MIDI', MIDIFileCue: 'MIDI File',
  TimecodeCue: 'Timecode', ScriptCue: 'Script', TargetCue: 'Target', ResetCue: 'Reset',
};

const text = (v) => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'object' && typeof v.NSString === 'string' ? v.NSString : String(v));
const secs = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0; };

/** The main level of a QLab level matrix: row 0, column 0 (with its trim). */
function mainLevel(matrix) {
  const entries = (matrix && matrix.entries) || {};
  for (const e of Object.values(entries)) if (e && e.row === 0 && e.column === 0) return toDb(Number(e.initialLevel) * (Number(e.trimLevel) || 1));
  return 0;
}
/** Whether a matrix has any level besides the main one off unity (a mix of its own, which one level cannot keep). */
function routed(matrix) {
  const entries = (matrix && matrix.entries) || {};
  let odd = false;
  for (const e of Object.values(entries)) {
    if (!e || (e.row === 0 && e.column === 0)) continue;
    const g = Number(e.initialLevel);
    if (Math.abs(g - 1) > 0.001 && (g > 0 || e.row === 0 || e.column === 0)) odd = true;   // an input, output or crosspoint level off unity
  }
  return odd;
}

/**
 * A cue's level matrix as outputs of its own here (core/audio/routing.js `fromQlab`: rows are the file's channels,
 * columns QLab's cue outputs, row 0 and column 0 the masters, multiplied into each crosspoint). QLab's default
 * (channel 1 to output 1, channel 2 to output 2, all at unity) is no routing: the cue plays on its bus. QLab's cue
 * outputs pass through an output patch on their way to the device; here they are taken as the device's outputs of
 * the same numbers, and the report says so. Gangs are not kept.
 */
function ownOutputs(q, cue, note) {
  const own = routing.fromQlab(q.levels && q.levels.entries, { toDb, channels: cue.file ? routing.wavChannels(cue.file) : 0 });
  const panned = own && panOfMatrix(own.matrix);
  if (panned) {
    // a sound panned between outputs 1 and 2 by its crosspoints is a pan here, and stays on its bus
    cue.pan = panned.pan;
    if (panned.db) cue.gainDb = Math.round(((Number(cue.gainDb) || 0) + panned.db) * 10) / 10;
    if (!cue.pan) delete cue.pan;
    note(q, `was panned by its crosspoints: it came across as Pan ${panned.pan}${panned.db ? ` and ${panned.db > 0 ? '+' : ''}${panned.db} dB on its level` : ''}`);
  } else if (own) {
    cue.outputs = own.matrix;
    note(q, `had its own output routing: it came across as ${routing.describe(own.matrix)}, each channel at its own level (QLab’s cue outputs are taken as this device’s outputs of the same numbers: check it in the inspector, Own outputs)`);
  } else if (routed(q.levels)) note(q, 'had its own output routing (levels other than the main one) that this could not read: only the main level is kept');
  const gangs = q.levels && q.levels.gangs;
  if (own && gangs && typeof gangs === 'object' && Object.keys(gangs).length) note(q, 'had ganged levels in its matrix: the levels are kept, the gangs are not');
}

/**
 * A level matrix that only shares the sound between outputs 1 and 2 (a mono file's one row to both, or a stereo
 * file's left to 1 and right to 2, at levels of their own) as a pan and what is left on the level: { pan, db }, or
 * null when it does anything else (core/audio/lanes.js panOfGains: equal power, as the pan here plays).
 */
function panOfMatrix(matrix) {
  const lin = (db) => Math.pow(10, Number(db) / 20), only = (row, k) => row && Object.keys(row).length === k.length && k.every((x) => row[x] !== undefined);
  let l, r;
  if (matrix.length === 1 && only(matrix[0], ['1', '2'])) { l = lin(matrix[0]['1']); r = lin(matrix[0]['2']); }
  else if (matrix.length === 2 && only(matrix[0], ['1']) && only(matrix[1], ['2'])) { l = lin(matrix[0]['1']); r = lin(matrix[1]['2']); }
  else return null;
  return Lanes.panOfGains(l, r);
}

/** One point of a curve, however the archive wrote it: {x, y}, [x, y], or Cocoa's "{0.25, 0.8}". */
function pointOf(p) {
  if (Array.isArray(p) && p.length >= 2) return [Number(p[0]), Number(p[1])];
  if (typeof p === 'string' || (p && typeof p.NSString === 'string')) { const m = /^\{\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*\}$/.exec(text(p).trim()); return m ? [Number(m[1]), Number(m[2])] : null; }
  if (p && typeof p === 'object') { const x = p.x ?? p.time ?? p.t, y = p.y ?? p.level ?? p.value; return x == null || y == null ? null : [Number(x), Number(y)]; }
  return null;
}
/**
 * An Audio cue's integrated fade (`doFade`) as a level envelope here: [[seconds into the file, dB], …].
 *
 * NOT CHECKED AGAINST A REAL WORKSPACE: none with an integrated fade was to hand when this was written. It looks
 * for a list of points under a key that names the integrated fade, reads each as (how far through the played
 * stretch, 0–1; level, a gain where 1 is the cue's own level), and gives up (null) on anything else, in which
 * case the report says the envelope must be drawn again.
 */
function envelopeOf(q, from, end) {
  if (!(end > from)) return null;
  for (const [key, v] of Object.entries(q)) {
    if (!/integratedfade|fadeenvelope|fadecurve|fadepoints/i.test(key) || !v || typeof v !== 'object') continue;
    const list = Array.isArray(v) ? v : Array.isArray(v.points) ? v.points : Array.isArray(v.curve) ? v.curve : null;
    if (!list || list.length < 2) continue;
    const pts = list.map(pointOf);
    if (pts.some((p) => !p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || p[0] < -0.001 || p[0] > 1.001 || p[1] < 0 || p[1] > 4)) continue;
    return pts.sort((a, b) => a[0] - b[0]).map(([x, y]) => [Math.round((from + x * (end - from)) * 1000) / 1000, toDb(y)]);
  }
  return null;
}

/** A QLab MIDI cue's message, in the words a MIDI cue here is written in ('' when it is one this does not send). */
function midiText(q) {
  const ch = Number(q.channel) > 1 ? ` ch ${Number(q.channel)}` : '';
  if (q.messageType === 1) {
    const b1 = Number(q.byte1) || 0, b2 = Number(q.byte2) || 0;
    // (status 2 is key pressure, 5 the channel's pressure, 6 pitch bend: read from a workspace QLab 5.6 saved. Where a
    // bend's fourteen bits are kept is a guess: `byteCombo` if the cue has one, else the two bytes, low then high.)
    const combo = Number.isFinite(Number(q.byteCombo)) && q.byteCombo !== null && q.byteCombo !== undefined ? Number(q.byteCombo) + (Number(q.byteCombo) < 0 ? 8192 : 0) : (b1 & 0x7f) | ((b2 & 0x7f) << 7);
    return { 0: `note off ${b1}${ch}`, 1: `note ${b1} ${b2}${ch}`, 2: `key pressure ${b1} ${b2}${ch}`, 3: `cc ${b1} ${b2}${ch}`, 4: `pc ${b1}${ch}`, 5: `pressure ${b1}${ch}`, 6: `bend ${Math.max(0, Math.min(16383, Math.round(combo)))}${ch}` }[q.status] || '';
  }
  if (q.messageType === 2) {
    const command = Object.keys(midi.MSC_COMMANDS).find((k) => midi.MSC_COMMANDS[k] === Number(q.command));
    const format = Object.keys(midi.MSC_FORMATS).find((k) => midi.MSC_FORMATS[k] === Number(q.commandFormat));
    if (!command || !format) return '';
    if (command === 'fire') return `msc fire ${Number(q.macro) || 0}${Number(q.deviceID) !== 127 ? ` dev ${Number(q.deviceID) || 0}` : ''}${format !== 'lighting' ? ` ${format}` : ''}`;
    const num = /^[\d.]+$/.test(text(q.qNumber)) ? ` ${text(q.qNumber)}` : '', list = num && /^[\d.]+$/.test(text(q.qList)) ? ` list ${text(q.qList)}` : '';
    return `msc ${command}${num}${list}${Number(q.deviceID) !== 127 ? ` dev ${Number(q.deviceID) || 0}` : ''}${format !== 'lighting' ? ` ${format}` : ''}`;
  }
  if (q.messageType === 3) { const raw = text(q.rawString).replace(/[^0-9a-fA-F]/g, '').toUpperCase(); return raw.length >= 2 && raw.length % 2 === 0 ? `F0 ${raw.match(/../g).join(' ')} F7`.replace(/^F0 F0/, 'F0').replace(/F7 F7$/, 'F7') : ''; }
  return '';
}

/**
 * A QLab Light cue's commands, where they can be read. QLab's light commands are text ("front = 80"), and a Light
 * cue here holds the same kind of text, so they come across as written. The name QLab keeps them under in the file
 * has not been seen in a real workspace (`lightCommandText` is its OSC name for them), so any text on the cue whose
 * every line reads as a light command is taken. '' when there is none.
 */
function lightText(q) {
  const reads = (v) => {
    if (typeof v !== 'string' || !v.includes('=')) return false;
    const cmds = lightCommands.parse(v);
    return cmds.length > 0 && cmds.every((c) => !c.error || /pulled from another cue/.test(c.error));
  };
  const flat = (v) => (Array.isArray(v) && v.length && v.every((x) => typeof text(x) === 'string' && text(x).includes('=')) ? v.map(text).join('\n') : typeof v === 'string' ? v : v && typeof v === 'object' && typeof v.NSString === 'string' ? v.NSString : null);
  for (const k of ['lightCommandText', 'commandText', 'lightCommands', 'commands']) { const v = flat(q[k]); if (reads(v)) return v.trim(); }
  for (const [k, raw] of Object.entries(q)) { if (['name', 'notes', 'number', 'uniqueID', 'colorName', '$type'].includes(k)) continue; const v = flat(raw); if (reads(v)) return v.trim(); }
  return '';
}

/**
 * A QLab Timecode cue as one of ours. The field names (`startTimecode`, `outputType`, `LTCChannel`, `duration`) are
 * ones a QLab 5 file has; what each holds was not seen, so every reading here is a guess and the import says so:
 * a start written as text or as hours, minutes, seconds and frames is taken; output type 1 (or anything naming
 * LTC) is taken for LTC, anything else for MTC; a frame rate is taken from whichever field holds 24, 25, 29.97 or 30.
 */
function timecodeOf(q) {
  const out = { timecode: '01:00:00:00', fps: '30', output: 'mtc' }, unsure = [];
  const st = q.startTimecode, p2 = (n) => String(Math.max(0, Math.round(Number(n) || 0))).padStart(2, '0');
  const parts = Array.isArray(st) && st.length >= 4 ? st.slice(0, 4)
    : st && typeof st === 'object' && !('NSString' in st) ? [st.hours ?? st.hour ?? st.h, st.minutes ?? st.minute ?? st.m, st.seconds ?? st.second ?? st.s, st.frames ?? st.frame ?? st.f] : null;
  const asText = parts && parts.every((x) => Number.isFinite(Number(x))) ? parts.map(p2).join(':') : typeof st === 'string' || (st && st.NSString) ? text(st).trim().replace(/;/g, ':') : '';
  if (timecode.parse(asText)) out.timecode = timecode.format(timecode.parse(asText), '30'); else unsure.push('its start time');
  const rate = [q.framerate, q.frameRate, q.fps, q.smpteFormat, q.timecodeFormat, q.format, st && st.framerate, st && st.format].map(Number).find((n) => [24, 25, 29.97, 30].some((r) => Math.abs(n - r) < 0.011));
  if (rate) out.fps = Math.abs(rate - 29.97) < 0.011 ? '29.97df' : String(Math.round(rate)); else unsure.push('its frame rate');
  if (Number(q.outputType) === 1 || /ltc/i.test(text(q.outputType))) { out.output = 'ltc'; out.channel = Math.max(1, Math.round(Number(q.LTCChannel) || 1)); }
  if (secs(q.duration)) out.duration = secs(q.duration);
  if (timecode.whyNot(timecode.parse(out.timecode), out.fps)) { out.timecode = '01:00:00:00'; unsure.push('its start time'); }
  return { cue: out, unsure: [...new Set(unsure)] };
}

function importQlab(buffer, { file = '' } = {}) {
  let root;
  try { root = unarchive(buffer); } catch (err) { throw new Error(`This is not a QLab workspace this can read (${err.message}).`); }
  if (!root || typeof root !== 'object' || !root.cueLists) throw new Error('This is not a QLab 4 or 5 workspace (it has no cue lists). QLab 3 and earlier files are not read: open and save them in QLab 4 or 5 first.');
  const v4 = /^4\./.test(String(root.QLabShortVersionString || '')) || /\.qlab4(backup)?$/i.test(file);
  const endAtFileEnd = [];             // (QLab 4) cues whose End at may be nothing but the end of the file
  const top = Buffer.isBuffer(root.cueLists) ? unarchive(root.cueLists) : root.cueLists;
  const baseDir = file ? path.dirname(file) : '';
  const title = text(root.workspaceName) || (file ? path.basename(file).replace(/\.qlab\d(backup)?$/i, '') : 'Imported show');
  const doc = show.newShow(title);
  const issues = [];
  const ids = new Map();              // QLab uniqueID → our id
  const made = new Map();             // QLab uniqueID → our cue
  const kinds = {};
  const lightNames = new Set();       // the instruments and groups the Light cues name: the patch they need here
  const label = (q) => `${text(q.number) ? text(q.number) + ' ' : ''}${text(q.name) || (q.$type || 'cue').replace(/Cue$/, '')}`.trim();
  const note = (q, why) => issues.push({ id: ids.get(q.uniqueID) || null, cue: label(q), why });
  const each = (q, fn) => { fn(q); for (const k of q.cues || []) each(k, fn); };
  for (const l of top.cues || []) for (const q of l.cues || []) each(q, (c) => ids.set(c.uniqueID, show.newId()));

  // ── settings ────────────────────────────────────────────────────────────
  const settings = root.settings || {};
  const general = settings.General || {};
  if (Number(general.minTimeBetweenGOs) >= 0) doc.settings.go.doubleGoProtection = secs(general.minTimeBetweenGOs);
  if (Number(general.panicDuration) >= 0) doc.settings.go.panicFade = secs(general.panicDuration);
  const patchIds = new Map();
  // QLab 4: the network patches are the OSC settings' numbered destinations (a cue names one by its number, from 1)
  (((settings.OSC || {}).clientState) || []).forEach((d, i) => {
    if (!d || !text(d.host)) return;
    const id = show.newId('patch');
    patchIds.set(`v4:${i + 1}`, id);
    const names = (settings.OSC || {}).names;
    const name = (names && typeof names === 'object' && text(names[i + 1] || names[String(i + 1)] || names[i])) || `Patch ${i + 1}`;
    doc.settings.network.patches.push({ id, name: /^\[object|^$/.test(name) ? `Patch ${i + 1}` : name, host: text(d.host) === 'localhost' ? '127.0.0.1' : text(d.host), port: Number(d.port) || 0, protocol: d.useTcp ? 'tcp' : 'udp', framing: 'slip', device: 'generic' });
  });
  for (const p of (settings.Network || {}).networkPatches || []) {
    const d = (p && p.data) || {};
    const dests = d.clientStates || [];
    const first = dests[0] || {};
    const id = show.newId('patch');
    patchIds.set(d.uniqueID, id);
    const host = text(first.host) === 'localhost' ? '127.0.0.1' : text(first.host);
    doc.settings.network.patches.push({ id, name: text(d.name) || `Patch ${doc.settings.network.patches.length + 1}`, host, port: Number(first.port) || 0, protocol: first.useTcp ? 'tcp' : 'udp', framing: 'slip', device: 'generic' });
    if (dests.length > 1) issues.push({ id: null, cue: `Network patch ${text(d.name)}`, why: `had ${dests.length} destinations; only the first (${host}:${first.port}) is kept` });
    if (d.deviceIdentifier && d.deviceIdentifier !== 'com.figure53.oscmessage') issues.push({ id: null, cue: `Network patch ${text(d.name)}`, why: `was a device patch (${d.deviceIdentifier}); its cues are imported only where QLab saved the OSC message itself` });
  }

  // ── cues ────────────────────────────────────────────────────────────────
  const common = (q, cue) => {
    if (text(q.number)) cue.number = text(q.number);
    if (text(q.name)) cue.name = text(q.name);
    if (text(q.notes)) cue.notes = text(q.notes);
    const col = COLOR[String(q.colorName || '').toLowerCase()];
    if (col) cue.color = col; else if (q.colorName && q.colorName !== 'none') note(q, `its colour (${q.colorName}) has no match here`);
    if (q.flagged) cue.flagged = true;
    if (q.armed === false) cue.armed = false;
    if (secs(q.preWait)) cue.preWait = secs(q.preWait);
    if (secs(q.postWait)) cue.postWait = secs(q.postWait);
    if (q.continueMode === 1) cue.continue = 'auto-continue';
    if (q.continueMode === 2) { cue.continue = 'auto-follow'; delete cue.postWait; }   // (QLab shows the duration there; ours is extra time after the cue ends)
    // a hotkey and a MIDI trigger come across when they are ones this can hold
    const hk = q.useHotKey && q.hotKey && !q.hotKey.QLActionKeyCommand && !q.hotKey.QLActionKeyControl && Number(q.hotKey.QLActionKeyKeyCharacter) > 32
      ? show.normaliseHotkey(`${q.hotKey.QLActionKeyShift ? 'shift+' : ''}${q.hotKey.QLActionKeyOption ? 'alt+' : ''}${String.fromCharCode(Number(q.hotKey.QLActionKeyKeyCharacter))}`) : null;
    if (hk) cue.hotkey = hk;
    const mt = q.useMIDITrigger && q.midiTrigger && !q.midiTrigger.byte1Operator ? { 144: 'note', 192: 'pc', 176: 'cc' }[Number(q.midiTrigger.status) & 0xf0] : null;
    if (mt) cue.midiTrigger = `${mt} ${Number(q.midiTrigger.byte1) || 0}${Number(q.midiTrigger.channel) > 0 ? ` ch ${Number(q.midiTrigger.channel)}` : ''}`;
    if (hk && show.APP_KEYS.has(hk)) note(q, `its hotkey ${hk} is one of this app’s own keys: change it (its Triggers tab)`);
    if (mt) note(q, `its MIDI trigger came across as “${cue.midiTrigger}”: check it (QLab’s conditions on the second byte are not read)`);
    const trig = [q.useHotKey && !hk && (Number((q.hotKey || {}).QLActionKeyKeyCharacter) > 0 ? 'a hotkey this cannot hold (one with ⌘ or ctrl, or not a letter, digit or F-key)' : 'a hotkey with no key set'), q.useMIDITrigger && !mt && 'a MIDI trigger', q.useWallClock && 'a wall-clock trigger', q.useTimecode && 'a timecode trigger'].filter(Boolean);
    if (trig.length) note(q, `had ${trig.join(' and ')}: not carried over${q.useTimecode ? ' (give it its time again on its Triggers tab)' : ''}`);
    if (q.duckOthers) note(q, 'ducked other cues while it ran: not carried over (build it with two relative Fade cues)');
    if (q.secondTriggerAction) note(q, 'had a second-trigger action: not carried over');
    if (q.skipIfDisarmed) note(q, 'was "skip if disarmed": not carried over');
    if (q.fadeAndStopOthers && cue.type !== 'group') cue.fadeOthers = secs(q.fadeAndStopOthersTime) || 0.01;
    return cue;
  };
  const targetOf = (q) => ids.get(q.cueTargetUniqueID || (q.cueTarget && q.cueTarget.uniqueID)) || null;
  const targetCue = (q) => (q.cueTarget && typeof q.cueTarget === 'object' ? q.cueTarget : null);

  function fileOf(q) {
    const a = q.fileTarget;
    if (!a || typeof a !== 'object') return '';
    const rel = text(a.relativePath) || text(q.relativePath), last = text(a.lastKnownPath);      // (QLab 4 keeps the path beside the workspace on the cue)
    // beside the workspace first (a project folder that has moved), then where QLab last saw it
    if (rel && baseDir) { const p = path.resolve(baseDir, rel); if (fs.existsSync(p)) return p; }
    if (last && fs.existsSync(last)) return last;
    // not where it should be: a file of the same name but for its punctuation, in the folder it should be in. (A
    // show folder that has been zipped, uploaded or downloaded often comes back with ' : ? turned into _.)
    if (rel && baseDir) {
      const want = path.resolve(baseDir, rel), dir = path.dirname(want);
      const plain = (n) => n.normalize('NFKD').toLowerCase().replace(/[^a-z0-9.]+/g, '_');
      let names = []; try { names = fs.readdirSync(dir); } catch { /* no such folder */ }
      const hits = names.filter((n) => plain(n) === plain(path.basename(want)));
      if (hits.length === 1) { note(q, `its file was found under a slightly different name (“${hits[0]}” for “${path.basename(want)}”): check it is the right one`); return path.join(dir, hits[0]); }
    }
    return last || (rel && baseDir ? path.resolve(baseDir, rel) : rel);
  }

  /** A Video, Text or Camera cue's place on the stage, where the file has it under the names QLab's OSC dictionary
   *  uses (opacity, translation, scale, rotation, layer, fillStage). Returns what was found, in words. */
  function geometry(q, cue) {
    const found = [];
    const n = (...keys) => { for (const k of keys) { const v = k.split('.').reduce((o, p) => (o && typeof o === 'object' ? o[p] : undefined), q); if (typeof v === 'number' && Number.isFinite(v)) return v; } return null; };
    const opacity = n('opacity');
    if (opacity !== null && opacity >= 0 && opacity <= 1) { if (opacity < 1) cue.opacity = Math.round(opacity * 1000) / 10; found.push('opacity'); }
    const x = n('translationX', 'translation.x'), y = n('translationY', 'translation.y');
    if (x !== null || y !== null) { if (x) cue.x = Math.round(x * 100) / 100; if (y) cue.y = Math.round(y * 100) / 100; found.push('position'); }
    const sx = n('scaleX', 'scale.x', 'scale'), sy = n('scaleY', 'scale.y');
    if (sx !== null && sx > 0) { if (sx !== 1) cue.scale = Math.round(sx * 1000) / 1000; found.push('scale'); if (sy !== null && Math.abs(sy - sx) > 0.001) note(q, 'was scaled differently across and down: one scale is kept'); }
    const rot = n('rotationZ', 'rotation.z', 'rotation');
    if (rot !== null) { if (rot) cue.rotation = Math.round(rot * 100) / 100; found.push('rotation'); }
    const layer = n('layer');
    if (layer !== null) { if (layer !== 1) cue.layer = Math.round(layer); found.push('layer'); }
    const fill = [q.fillStage, q.fullSurface, q.fullScreen].find((v) => typeof v === 'boolean');
    if (fill === false && cue.type !== 'text') { cue.fit = 'natural'; found.push('size (its own pixels)'); }
    return found;
  }

  function convert(q) {
    const id = ids.get(q.uniqueID);
    const type = q.$type;
    kinds[type] = (kinds[type] || 0) + 1;
    let cue;
    if (type === 'GroupCue') {
      cue = common(q, { id, type: 'group' });
      if (q.groupMode === 6) { cue.mode = 'playlist'; if (q.playlistShuffle) cue.shuffle = true; if (q.playlistLoop) cue.repeat = true; if (q.playlistCrossfade && secs(q.playlistCrossfadeDuration)) cue.crossfade = secs(q.playlistCrossfadeDuration); }
      else if (q.groupMode === 1) cue.mode = 'enter';
      else if (q.groupMode === 2) cue.mode = 'first';
      else if (q.groupMode === 4) cue.mode = 'random';
      else if (q.groupMode !== 3) note(q, `was a ${GROUP_MODE[q.groupMode] || `mode ${q.groupMode}`} group: here it fires all its children together`);
      if (q.fadeAndStopOthers) cue.fadeOthers = secs(q.fadeAndStopOthersTime) || 0.01;
      cue.children = (q.cues || []).map(convert);
      for (const k of q.cues || []) if (k.continueMode && ![1, 2, 3, 6].includes(q.groupMode)) note(k, 'its continue mode is inside a group: not run here yet');
    } else if (type === 'AudioCue') {
      cue = common(q, { id, type: 'audio', file: fileOf(q), gainDb: mainLevel(q.levels) });
      if (!cue.file) note(q, 'has no file');
      const len = Number(q.lastSeenFileDuration) || 0;
      if (secs(q.startTime)) cue.from = secs(q.startTime);
      if (secs(q.endTime) && (!len || q.endTime < len - 0.01)) cue.cutAt = secs(q.endTime);
      if (v4 && cue.cutAt && !len) endAtFileEnd.push(id);       // (QLab 4 does not say how long the file is: this End at may be its own end)
      if (q.infiniteLoop) cue.loop = true;
      else if (Number(q.playCount) > 1) cue.plays = Math.round(Number(q.playCount));
      const slices = (q.slices || []).filter((s) => s && Number(s.time) > 0);
      if (slices.length) {
        // QLab's slices: each ends at its marker and has a play count (or loops until devamped); the last runs to the end
        cue.markers = slices.map((s, i) => ({ at: secs(s.time), name: `Slice ${i + 2}` }));
        const ends = [...slices.map((s) => ({ end: secs(s.time), n: Number(s.playCount) || 1, inf: !!s.infiniteLoop })), { end: cue.cutAt || len, n: Number((q.lastSlice || {}).playCount) || 1, inf: !!(q.lastSlice || {}).infiniteLoop }];
        const loops = [];
        let from = cue.from || 0;
        ends.forEach((s, i) => { if (s.end > from && (s.inf || s.n > 1)) loops.push({ start: from, end: s.end, name: `Slice ${i + 1}`, ...(s.inf ? { hold: true } : { count: s.n }) }); from = s.end || from; });
        if (loops.length) cue.loops = loops;
      }
      if (Number(q.rate) > 0 && Math.abs(Number(q.rate) - 1) > 0.0001) {
        cue.rate = Math.max(0.25, Math.min(4, Math.round(Number(q.rate) * 1000) / 1000));
        if (q.preservePitch === true || q.pitchShift === false) cue.preservePitch = true;
        note(q, `plays at rate ${cue.rate}${cue.rate !== Number(q.rate) ? ` (it was ${q.rate}: outside what can be played here)` : ''}: check whether it should keep its pitch (Audio ▸ More ▸ Keep pitch)`);
      }
      if (q.doFade) {
        // its integrated fade: the level drawn over the stretch of the file it plays
        const env = envelopeOf(q, cue.from || 0, cue.cutAt || len);
        if (env) { cue.envelope = env; note(q, 'its integrated fade envelope came across as a level envelope: check it on the waveform (Time & Loops)'); }
        else note(q, 'had an integrated fade envelope, which was not in a form this reads: draw it on the waveform (Time & Loops ▸ Draw a level envelope)');
      }
      if ((q.effects || []).length) note(q, `had ${q.effects.length} audio effect${q.effects.length === 1 ? '' : 's'}: not carried over`);
      ownOutputs(q, cue, note);
      // a click sent to its own outputs with the main level down would arrive silent, and nobody told
      if (cue.plays > 1 && cue.loops) { delete cue.plays; note(q, 'had a play count and slices: the slices’ counts are kept, the play count of the whole is not'); }
      if (cue.gainDb <= SILENT_DB && Object.values((q.levels && q.levels.entries) || {}).some((e) => e && e.row === 0 && e.column > 0 && Number(e.initialLevel) > 0)) note(q, 'played only on outputs of its own, with its main level down: it is silent until you raise its level (the inspector’s Level; its outputs are under Own outputs)');
    } else if (type === 'FadeCue') {
      cue = common(q, { id, type: 'fade', target: targetOf(q), duration: secs(q.duration), stopTarget: !!(q.stopTargetWhenDone || (q.fade && q.fade.stopTargetWhenDone)) });
      const main = Object.values((q.fade && q.fade.entries) || {}).find((e) => e && e.row === 0 && e.column === 0 && e.live !== false);
      const others = Object.values((q.fade && q.fade.entries) || {}).filter((e) => e && !(e.row === 0 && e.column === 0) && e.live !== false).length;
      cue.relative = q.mode === 1 || (q.fade && q.fade.fadeType === 'relative');
      if (main) cue.db = toDb(main.endValue);
      else { cue.db = cue.relative ? 0 : mainLevel(targetCue(q) && targetCue(q).levels); note(q, 'does not fade its target’s main level: what it faded is not carried over'); }
      if (cue.relative) note(q, 'is a relative fade: check its amount (it is measured from the target’s own level here)');
      if (others) note(q, `also faded ${others} other level${others === 1 ? '' : 's'} (outputs or crosspoints): only the main level is kept`);
      if (q.doRate && Number(q.rate) > 0) { cue.rate = Math.max(0.25, Math.min(4, Math.round(Number(q.rate) * 1000) / 1000)); note(q, `also fades its target’s rate to ${cue.rate}: check it`); }
      else if (q.doRate) note(q, 'also faded its target’s rate, to a rate this could not read: set Rate to on the Fade');
      if (q.doOpacity || q.doTranslation || q.doScale || q.doRotation) note(q, 'also faded video geometry: where the file keeps those values is not known to this, so they are not carried over (set To opacity, position, scale or rotation on the Fade)');
      if (q.targetMode) note(q, 'targeted an output patch or audio map: not carried over');
      const t = targetCue(q);
      if (t && !['AudioCue', 'GroupCue', 'MicCue', 'VideoCue', 'TextCue', 'TitlesCue', 'CameraCue'].includes(t.$type)) note(q, `targets a ${t.$type.replace(/Cue$/, '')} cue: a Fade here moves a sound, a picture or a group of them`);
    } else if (SIMPLE[type]) {
      cue = common(q, { id, type: SIMPLE[type] });
      if (SIMPLE[type] !== 'memo') cue.target = targetOf(q);
      const t = targetCue(q);
      if (type === 'DevampCue') {
        if (t && t.$type !== 'AudioCue') note(q, 'targets something other than an Audio cue');
        if (q.fireNextCueAtMomentLoopEnds) note(q, 'started the next cue when the loop ended: not carried over');
        if ((t && (t.slices || []).length) || q.devampType === 0) note(q, 'its target has slices: here they are loop regions, and this Devamp lets the track out of the one it is going round');
      }
    } else if (type === 'LoadCue') {
      cue = common(q, { id, type: 'load', target: targetOf(q), at: secs(q.loadTime) });
      if (Number(q.loadTime) < 0) note(q, 'loaded back from the end: a Load cue here takes a time from the start');
      const t = targetCue(q);
      if (t && t.$type !== 'AudioCue' && t.$type !== 'VideoCue') note(q, `loads a ${t.$type.replace(/Cue$/, '')} cue: a Load cue here sets where one Audio or Video cue starts`);
    } else if (type === 'WaitCue') {
      cue = common(q, { id, type: 'wait', duration: secs(q.duration) });
    } else if (type === 'OSCCue' || type === 'NetworkCue') {
      const osc = text(q.oscString) || text(((q.allParameterValues || {})['com.figure53.oscmessage'] || {}).custom)
        || [q.customString, q.customMessage, q.rawString].map(text).find((x) => x.trim().startsWith('/')) || '';      // (QLab 4's names for a custom message: read if they are there)
      if (osc.trim().startsWith('/')) {
        cue = common(q, { id, type: 'network', message: osc.trim() });
        if (patchIds.has(q.networkPatchID)) cue.patch = patchIds.get(q.networkPatchID);
        else if (patchIds.has(`v4:${Number(q.patch)}`)) cue.patch = patchIds.get(`v4:${Number(q.patch)}`);
        if (q.fadeType === 1) { cue.fadeFrom = Number(q.startValue) || 0; cue.fadeTo = Number(q.endValue) || 0; cue.duration = secs(q.duration); if (!cue.message.includes('#v#')) note(q, 'is a faded message with no #v# in it'); }
        else if (q.fadeType === 2) note(q, 'was a 2D fade: only the message is kept');
        else if (secs(q.duration)) note(q, `re-sent its message for ${secs(q.duration)} s: it is sent once here`);
      } else {
        cue = common(q, { id, type: 'memo' });
        cue.notes = `${cue.notes ? cue.notes + '\n' : ''}(QLab Network cue: ${text(q.plainTextString) ? `plain text “${text(q.plainTextString)}”` : text(q.hexCodesString) ? `hex ${text(q.hexCodesString)}` : 'a device command'})`;
        note(q, 'was a Network cue that is not an OSC message (plain text, hex or a device command): kept as a Memo');
      }
    } else if (type === 'VideoCue') {
      // The file, level and times are read where an Audio cue keeps them (a Video cue is an Audio cue with a picture
      // in QLab too). No workspace with a Video cue has been seen by this code: where its geometry is kept in the
      // file is not known, so it is looked for under the names QLab gives those settings over OSC, and said either way.
      cue = common(q, { id, type: 'video', file: fileOf(q), gainDb: mainLevel(q.levels) });
      if (!cue.file) note(q, 'has no file');
      const len = Number(q.lastSeenFileDuration) || 0;
      if (secs(q.startTime)) cue.from = secs(q.startTime);
      if (secs(q.endTime) && (!len || q.endTime < len - 0.01)) cue.cutAt = secs(q.endTime);
      if (q.infiniteLoop) cue.loop = true;
      else if (Number(q.playCount) > 1) note(q, `played ${Math.round(Number(q.playCount))} times: a Video cue here plays once, or loops`);
      if (q.holdLastFrame) cue.holdEnd = true;
      const found = geometry(q, cue);
      note(q, found.length
        ? `is a Video cue: its ${found.join(', ')} came across under the names QLab uses for them over OSC, which have not been checked against a real workspace. Look at it on the stage`
        : 'is a Video cue: its file, level and times came across; its place on the stage (position, scale, opacity, layer) was not found in the file, so it fits the stage here');
      if ((q.slices || []).length) note(q, 'had slices: not carried over for a Video cue');
      if (Number(q.rate) && Math.abs(Number(q.rate) - 1) > 0.0001) note(q, `played at rate ${q.rate}: rate is not here yet`);
      if ((q.videoEffects || q.effects || []).length) note(q, 'had effects: not carried over');
    } else if (type === 'TextCue' || type === 'TitlesCue') {
      // (QLab keeps a Text cue's words as styled text; a plain `text` is read if the file has one)
      const words = typeof q.text === 'string' ? q.text : (q.text && typeof q.text.NSString === 'string' ? q.text.NSString : '');
      cue = common(q, { id, type: 'text', text: words || text(q.name) || 'Text' });
      geometry(q, cue);
      note(q, words ? 'is a Text cue: its words came across; its font, size and colour did not (QLab keeps them as styled text). Set them, and look at it on the stage'
        : 'is a Text cue: its words could not be read from the file (QLab keeps them as styled text), so its name stands in for them. Type them again, and set the font, size and colour');
    } else if (type === 'CameraCue') {
      cue = common(q, { id, type: 'camera' });
      geometry(q, cue);
      note(q, 'is a Camera cue: it is one here too, on this computer’s default camera; choose its camera. Its sound, if it had any, is not carried over (add a Mic cue)');
    } else if (type === 'MicCue') {
      cue = common(q, { id, type: 'mic', gainDb: mainLevel(q.levels), channel: (Number(q.channelOffset) || 0) + 1 });
      note(q, 'was a Mic cue: it is one here too, on this computer’s default input; choose its input and its bus');
      if (q.levels) ownOutputs(q, cue, note);
    } else if (type === 'LightCue' && lightText(q)) {
      // a Light cue is one here too: its commands as they were written, its fade time. The patch is not in the cue.
      cue = common(q, { id, type: 'light', levels: lightText(q), duration: secs(q.duration) });
      const cmds = lightCommands.parse(cue.levels);
      for (const c of cmds) for (const t of c.targets) lightNames.add(typeof t === 'string' ? t : `${t.from} - ${t.to}`);
      if (cmds.some((c) => c.error)) note(q, 'pulled levels from another cue (“= cue …”): those lines are not read here; type the levels');
      note(q, 'was a Light cue: its levels came across as written. Its lights must be patched here under the same names (Settings ▸ Integrations ▸ Light)');
    } else if (type === 'MIDICue' && midiText(q)) {
      cue = common(q, { id, type: 'midi', midi: midiText(q) });
      // a faded value: from the one in the message to `endValue` over `duration`
      if (q.doFade && q.messageType === 1 && [2, 3, 5, 6].includes(q.status) && Number.isFinite(Number(q.endValue)) && secs(q.duration)) {
        cue.fadeTo = Math.max(0, Math.min(q.status === 6 ? 16383 : 127, Math.round(Number(q.endValue) + (q.status === 6 && Number(q.endValue) < 0 ? 8192 : 0))));
        cue.duration = secs(q.duration);
        note(q, `fades its value to ${cue.fadeTo} over ${cue.duration} s: check where it starts and lands${q.status === 6 ? ' (a pitch bend here runs 0 to 16383, with 8192 in the middle)' : ''}`);
      } else if (q.doFade) note(q, 'faded its value over a time: here the message is sent once');
      if (text(q.midiPatchID)) note(q, 'was sent to one MIDI patch: here MIDI cues go to the output chosen in Settings ▸ Integrations ▸ Network (every output, until you choose)');
    } else if (type === 'TimecodeCue') {
      const t = timecodeOf(q);
      cue = common(q, { id, type: 'timecode', ...t.cue });
      note(q, `was a Timecode cue: it is one here too (${t.cue.output === 'ltc' ? `LTC on output ${t.cue.channel}` : 'MTC'} from ${t.cue.timecode} at ${t.cue.fps}). Check it${t.unsure.length ? `: ${t.unsure.join(' and ')} could not be read and ${t.unsure.length === 1 ? 'is' : 'are'} as a new cue has ${t.unsure.length === 1 ? 'it' : 'them'}` : ' against the workspace'}`);
    } else if (type === 'MIDIFileCue' && fileOf(q)) {
      cue = common(q, { id, type: 'midifile', file: fileOf(q) });
      if (Number(q.rate) > 0 && Math.abs(Number(q.rate) - 1) > 0.0001) cue.rate = Math.round(Number(q.rate) * 1000) / 1000;
      if (text(q.midiPatchID)) note(q, 'was sent to one MIDI patch: here MIDI goes to the output chosen in Settings ▸ Integrations ▸ Network (every output, until you choose)');
    } else {
      const what = UNSUPPORTED[type] || String(type || 'unknown').replace(/Cue$/, '');
      cue = common(q, { id, type: 'memo' });
      if (!cue.name) cue.name = `(${what} cue)`;
      const midi = type === 'MIDICue';         // there is a MIDI cue here, but what a QLab one sends is not read yet
      cue.notes = `${cue.notes ? cue.notes + '\n' : ''}(QLab ${what} cue: ${midi ? 'its message is one this does not send (MIDI timecode, or an empty SysEx). Make a MIDI cue here in its place' : 'not in Endless Cues yet. It does nothing here'}.)`;
      note(q, midi ? 'was a MIDI cue whose message this does not send (MIDI timecode, or an empty SysEx): kept as a Memo' : `was a ${what} cue: kept as a Memo that does nothing`);
      if (q.cues) for (const k of q.cues) convert(k);
    }
    made.set(q.uniqueID, cue);
    return cue;
  }

  doc.lists = [];
  for (const l of top.cues || []) {
    if (l.$type !== 'GroupCue') continue;
    const name = text(l.name) || `List ${doc.lists.length + 1}`;
    if (l.syncToTimecode) issues.push({ id: null, cue: name, why: 'chased timecode: turn that on again in Settings ▸ Integrations ▸ Network ▸ Timecode, and give its cues their timecode triggers (a QLab cue’s trigger time is not read)' });
    let unique = name; for (let n = 2; doc.lists.some((x) => x.name === unique); n++) unique = `${name} ${n}`;
    const cues = (l.cues || []).map(convert);
    // a cue cart: the grid's size, and each cue on the button it was on (a position this cannot read takes the first free button)
    const isCart = l.groupMode === 5;
    if (isCart) (l.cues || []).forEach((q, i) => { const p = cartCell(q.cartPosition); if (p && cues[i]) cues[i].cell = `${p[0]},${p[1]}`; });
    doc.lists.push({ id: show.newId('list'), name: unique, ...(isCart ? { cart: cart.cleanCart({ rows: l.cartRows, columns: l.cartColumns }) } : {}), cues });
  }
  if (!doc.lists.length) doc.lists.push({ id: show.newId('list'), name: 'Main', cues: [] });

  if (lightNames.size) issues.push({ id: null, cue: 'Light patch', why: `QLab’s light patch is not read. The Light cues name: ${[...lightNames].slice(0, 24).join(', ')}${lightNames.size > 24 ? '…' : ''}. Add instruments and groups with those names under Settings ▸ Integrations ▸ Light` });

  // a target that was not a cue we kept (or was never set) leaves the cue broken, as it should be; say which
  for (const [uid, cue] of made) if ('target' in cue && !cue.target) { delete cue.target; issues.push({ id: cue.id, cue: `${cue.number ? cue.number + ' ' : ''}${cue.name || cue.type}`, why: 'has no target' }); void uid; }

  const r = show.normalise(doc);
  let cues = 0; show.walk(r.doc, () => cues++);
  const missing = [];
  show.walk(r.doc, (c) => { if ((c.type === 'audio' || c.type === 'video') && c.file && !fs.existsSync(c.file) && !missing.includes(c.file)) missing.push(c.file); });
  const version = text(root.QLabShortVersionString);
  const report = {
    source: file ? path.basename(file) : '', qlabVersion: version, title, endAtFileEnd,
    counts: { lists: r.doc.lists.length, cues, kinds, patches: r.doc.settings.network.patches.length },
    issues: [...issues, ...r.warnings.map((w) => ({ id: null, cue: '', why: w }))],
    missing,
    summary: summarise(issues, missing, cues),
  };
  r.doc.notes = [`Imported from the QLab ${version || '5'} workspace “${report.source || title}”.`, ...report.summary].join('\n');
  return { doc: r.doc, report };
}

/** Where a cue sat in a QLab cart: [row, column] counted from 1, as QLab's own /cartPosition gives it (0: not placed).
 *  QLab writes it as a pair; a point written as text ("{2, 3}") or as { row, column } is read too. */
function cartCell(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && !('row' in v)) v = [v.x ?? v.X, v.y ?? v.Y];
  return cart.parseCell(Array.isArray(v) ? v.map(Number) : v);
}

/** The issues, grouped: one line per kind of thing that did not come across. */
function summarise(issues, missing, cues) {
  const groups = new Map();
  for (const i of issues) {
    const key = i.why.replace(/\d+(\.\d+)?/g, 'N').replace(/\(.*?\)/g, '').replace(/“.*?”/g, '');
    if (!groups.has(key)) groups.set(key, { why: i.why, cues: [] });
    groups.get(key).cues.push(i.cue);
  }
  const lines = [...groups.values()].sort((a, b) => b.cues.length - a.cues.length)
    .map((g) => (g.cues.length === 1 ? `${g.cues[0]}: ${g.why}.` : `${g.cues.length} cues (${g.cues.slice(0, 3).join('; ')}${g.cues.length > 3 ? '…' : ''}): ${g.why}.`));
  if (missing.length) lines.push(`${missing.length} sound file${missing.length === 1 ? ' is' : 's are'} not where the workspace says (${missing.slice(0, 3).map((f) => path.basename(f)).join(', ')}${missing.length > 3 ? '…' : ''}).`);
  if (!lines.length) lines.push(`All ${cues} cues came across as they were.`);
  return lines;
}

/** Whether a file looks like a QLab workspace (by its name). */
const isQlabFile = (p) => /\.qlab[45](backup)?$/i.test(String(p || ''));

export { envelopeOf, importQlab, isQlabFile, toDb, midiText, timecodeOf, panOfMatrix };
