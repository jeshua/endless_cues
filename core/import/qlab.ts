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
 * The file is a keyed archive (core/import/plist.ts) whose `cueLists` is a second archive: one root
 * Group whose children are the cue lists (and carts). What is mapped was worked out from workspaces
 * saved by QLab 5.6; nothing here is Figure 53's code, and a file from a later QLab may hold things
 * this has not seen. Anything it cannot carry over it says so, and the cue is kept (as a Memo with
 * its number, name, notes, waits and continue) so sequences and targets still line up.
 *
 * What comes across: lists, and carts with each cue on its button; groups; Audio (file, level, start, end, loop, rate and
 * whether it keeps its pitch, and its level matrix as the cue's own outputs when it is not QLab's default: see
 * `ownOutputs`; its integrated fade envelope only if it is written the way envelopeOf() guesses, which no real workspace
 * has yet confirmed); Fade (the main level, absolute or relative, stop target, and a picture's opacity, position,
 * scale and rotation); Start, Stop, Pause, Load, Reset, Target, GoTo, Arm, Disarm, Devamp, Wait, Memo; Video (its file,
 * level, start, end, loop and place on the stage), Text (its words, font, size, colour and alignment) and Camera, as
 * cues for the stage; Network (OSC, with a 1D fade); MIDI (with a faded value; an MSC message this has no words for
 * as its bytes); MIDI File; Timecode; Light (its commands as text and its fade time; the light patch is not read);
 * numbers, names, notes, colours (and the colour once played), flags, armed, pre- and post-waits, continue modes;
 * hotkeys, MIDI, wall-clock and timecode triggers; the second trigger, ducking others, auto-load, and "fade and stop
 * others" with its reach; double-GO protection, the panic time and the network patches. A Script cue is AppleScript,
 * which nothing here runs: it is kept as a Memo with its script in its notes.
 *
 * Checked field by field against what QLab 5.6.3 itself reports for workspaces it saved (test/qlab-compare).
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
import type { Cue, CueFields, CueType, Region } from '../show/types';

/** An object read from the workspace's archive: whatever keys the file holds, each read where it is used (text(), secs(), Number()). */
type Archived = Record<string, any>;
/** One thing that did not come across, cue by cue ({ id: our cue's id, or null for a list, a patch or the show }). */
export interface ImportIssue { id: string | null; cue: string; why: string }
type Note = (q: Archived, why: string) => void;
/** A cue as it is made, before the targets that were not kept are taken off (a target here is null until then). */
interface Made extends Omit<CueFields, 'target'> { id: string; type: CueType; target?: string | null; children?: Made[]; [field: string]: unknown }
/** A level matrix here: one row per channel of the file, { output: dB }. */
type Rows = Record<string, number>[];

const SILENT_DB = -60;
/** QLab stores a level as a linear gain: 1 is 0 dB. */
const toDb = (gain: unknown) => { const g = Number(gain); if (!(g > 0)) return SILENT_DB; return Math.max(SILENT_DB, Math.round(200 * Math.log10(g)) / 10); };

// QLab's group modes (its OSC dictionary's /mode)
const GROUP_MODE: Record<number, string> = { 0: 'cue list', 1: 'Start First and Enter', 2: 'Start First', 3: 'Timeline', 4: 'Start Random', 5: 'cart', 6: 'Playlist' };
// its colour names → ours (core/show/cue-types.ts COLORS): the same name where there is one, else the nearest. The
// names QLab 5.6 accepts and saves were read back from it; the rest are older names, kept in case a file has them.
const COLOR: Record<string, string> = {
  red: 'red', orange: 'orange', yellow: 'yellow', green: 'green', blue: 'blue', purple: 'purple',
  berry: 'pink', magenta: 'magenta', fuchsia: 'pink', pink: 'pink', rose: 'pink', mauve: 'pink', crimson: 'red', coral: 'coral', peach: 'orange', ochre: 'amber', gold: 'amber',
  lime: 'lime', chartreuse: 'lime', forest: 'forest', olive: 'green', teal: 'teal', cyan: 'teal', ocean: 'teal', aqua: 'teal', indigo: 'indigo', midnight: 'indigo', cerulean: 'blue',
  sky: 'sky', 'sky blue': 'sky', skyblue: 'sky', lilac: 'lavender', lavender: 'lavender', plum: 'purple', violet: 'purple', grey: 'grey', gray: 'grey', taupe: 'grey', brown: 'brown',
  'hot pink': 'pink', vermilion: 'red', rufous: 'brown', maize: 'yellow', celadon: 'mint', sage: 'mint', viridian: 'teal', avocado: 'green',      // (and QLab 4's)
};
// the cue classes that have a cue of ours of the same kind
const SIMPLE: Record<string, Cue['type']> = { StartCue: 'start', StopCue: 'stop', PauseCue: 'pause', GotoCue: 'goto', GoToCue: 'goto', ArmCue: 'arm', DisarmCue: 'disarm', DevampCue: 'devamp', MemoCue: 'memo' };
// the ones that have none yet
const UNSUPPORTED: Record<string, string> = {
  MicCue: 'Mic', LightCue: 'Light', MIDICue: 'MIDI', MIDIFileCue: 'MIDI File',
  TimecodeCue: 'Timecode', ScriptCue: 'Script',
};
// a cue's second trigger in QLab (its dictionary: nothing 0, panic 1, stop 2, hard stop 3, hard stop and restart 4,
// devamp 5, playlist plays next 6, playlist plays previous 7) → ours
const SECOND_TRIGGER: Record<number, 'panic' | 'stop' | 'restart' | 'devamp'> = { 1: 'panic', 2: 'stop', 3: 'stop', 4: 'restart', 5: 'devamp' };
// fade and stop others: peers 1, list 2, all 3
const FADE_OTHERS: Record<number, 'peers' | 'list' | 'all'> = { 1: 'peers', 2: 'list', 3: 'all' };

const text = (v: any): string => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'object' && typeof v.NSString === 'string' ? v.NSString : String(v));
const secs = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0; };

/** The main level of a QLab level matrix: row 0, column 0 (with its trim). */
function mainLevel(matrix: Archived | null | undefined) {
  const entries: Archived = (matrix && matrix.entries) || {};
  for (const e of Object.values(entries)) if (e && e.row === 0 && e.column === 0) return toDb(Number(e.initialLevel) * (Number(e.trimLevel) || 1));
  return 0;
}
/** Whether a matrix has any level besides the main one off unity (a mix of its own, which one level cannot keep). */
function routed(matrix: Archived | null | undefined) {
  const entries: Archived = (matrix && matrix.entries) || {};
  let odd = false;
  for (const e of Object.values(entries)) {
    if (!e || (e.row === 0 && e.column === 0)) continue;
    const g = Number(e.initialLevel);
    if (Math.abs(g - 1) > 0.001 && (g > 0 || e.row === 0 || e.column === 0)) odd = true;   // an input, output or crosspoint level off unity
  }
  return odd;
}

/**
 * A cue's level matrix as outputs of its own here (core/audio/routing.ts `fromQlab`: rows are the file's channels,
 * columns QLab's cue outputs, row 0 and column 0 the masters, multiplied into each crosspoint). QLab's default
 * (channel 1 to output 1, channel 2 to output 2, all at unity) is no routing: the cue plays on its bus. QLab's cue
 * outputs pass through an output patch on their way to the device; here they are taken as the device's outputs of
 * the same numbers, and the report says so. Gangs are not kept.
 */
function ownOutputs(q: Archived, cue: Made, note: Note) {
  const own = routing.fromQlab(q.levels && q.levels.entries, { toDb, channels: cue.file ? routing.wavChannels(cue.file) : 0 });
  const panned = own && panOfMatrix(own.matrix);
  if (panned) {
    // a sound panned between outputs 1 and 2 by its crosspoints is a pan here, and stays on its bus
    cue.pan = panned.pan;
    // (a cue whose main level is down is silent in QLab whatever its other levels: it stays so)
    if (panned.db && Number(cue.gainDb) > SILENT_DB) cue.gainDb = Math.max(SILENT_DB, Math.round(((Number(cue.gainDb) || 0) + panned.db) * 10) / 10);
    if (!cue.pan) delete cue.pan;
    const quiet = Number(cue.gainDb) <= SILENT_DB;
    note(q, `was panned by its crosspoints: it came across as Pan ${panned.pan}${quiet ? ' (its main level is down: it stays silent)' : panned.db ? ` and ${panned.db > 0 ? '+' : ''}${panned.db} dB on its level` : ''}`);
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
 * null when it does anything else (core/audio/lanes.ts panOfGains: equal power, as the pan here plays).
 */
function panOfMatrix(matrix: Rows) {
  const lin = (db: unknown) => Math.pow(10, Number(db) / 20), only = (row: Rows[number] | undefined, k: string[]) => row && Object.keys(row).length === k.length && k.every((x) => row[x] !== undefined);
  let l: number, r: number;
  if (matrix.length === 1 && only(matrix[0], ['1', '2'])) { l = lin(matrix[0]['1']); r = lin(matrix[0]['2']); }
  else if (matrix.length === 2 && only(matrix[0], ['1']) && only(matrix[1], ['2'])) { l = lin(matrix[0]['1']); r = lin(matrix[1]['2']); }
  else return null;
  return Lanes.panOfGains(l, r);
}

/** One point of a curve, however the archive wrote it: {x, y}, [x, y], or Cocoa's "{0.25, 0.8}". */
function pointOf(p: any): [number, number] | null {
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
function envelopeOf(q: Archived, from: number, end: number): [number, number][] | null {
  if (!(end > from)) return null;
  for (const [key, v] of Object.entries(q)) {
    if (!/integratedfade|fadeenvelope|fadecurve|fadepoints/i.test(key) || !v || typeof v !== 'object') continue;
    const list = Array.isArray(v) ? v : Array.isArray(v.points) ? v.points : Array.isArray(v.curve) ? v.curve : null;
    if (!list || list.length < 2) continue;
    const pts = list.map(pointOf);
    if (pts.some((p: [number, number] | null) => !p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || p[0] < -0.001 || p[0] > 1.001 || p[1] < 0 || p[1] > 4)) continue;
    return (pts as [number, number][]).sort((a, b) => a[0] - b[0]).map(([x, y]): [number, number] => [Math.round((from + x * (end - from)) * 1000) / 1000, toDb(y)]);
  }
  return null;
}

/** A QLab MIDI cue's message, in the words a MIDI cue here is written in ('' when it is one this does not send). */
function midiText(q: Archived): string {
  const ch = Number(q.channel) > 1 ? ` ch ${Number(q.channel)}` : '';
  if (q.messageType === 1) {
    const b1 = Number(q.byte1) || 0, b2 = Number(q.byte2) || 0;
    // (status 2 is key pressure, 5 the channel's pressure, 6 pitch bend: read from a workspace QLab 5.6 saved. Where a
    // bend's fourteen bits are kept is a guess: `byteCombo` if the cue has one, else the two bytes, low then high.)
    const combo = Number.isFinite(Number(q.byteCombo)) && q.byteCombo !== null && q.byteCombo !== undefined ? Number(q.byteCombo) + (Number(q.byteCombo) < 0 ? 8192 : 0) : (b1 & 0x7f) | ((b2 & 0x7f) << 7);
    return ({ 0: `note off ${b1}${ch}`, 1: `note ${b1} ${b2}${ch}`, 2: `key pressure ${b1} ${b2}${ch}`, 3: `cc ${b1} ${b2}${ch}`, 4: `pc ${b1}${ch}`, 5: `pressure ${b1}${ch}`, 6: `bend ${Math.max(0, Math.min(16383, Math.round(combo)))}${ch}` } as Record<number, string>)[q.status] || '';
  }
  if (q.messageType === 2) {
    const command = (Object.keys(midi.MSC_COMMANDS) as (keyof typeof midi.MSC_COMMANDS)[]).find((k) => midi.MSC_COMMANDS[k] === Number(q.command));
    const format = (Object.keys(midi.MSC_FORMATS) as (keyof typeof midi.MSC_FORMATS)[]).find((k) => midi.MSC_FORMATS[k] === Number(q.commandFormat));
    const dev = Number(q.deviceID) !== 127 ? ` dev ${Number(q.deviceID) || 0}` : '', fmt = format && format !== 'lighting' ? ` ${format}` : '';
    const numeric = (v: unknown) => /^[\d.]+$/.test(text(v));
    // a command, format or cue path the words here have none for: the message as its bytes, which a MIDI cue sends as they are
    if (!command || !format || text(q.qPath) || (text(q.qNumber) && !numeric(q.qNumber)) || (text(q.qList) && !numeric(q.qList))) return mscBytes(q);
    if (command === 'fire') return `msc fire ${Number(q.macro) || 0}${dev}${fmt}`;
    const num = numeric(q.qNumber) ? ` ${text(q.qNumber)}` : '', list = num && numeric(q.qList) ? ` list ${text(q.qList)}` : '';
    const p2 = (n: unknown) => String(Math.max(0, Math.round(Number(n) || 0))).padStart(2, '0');
    const time = command === 'timed-go' ? ` time ${[q.hours, q.minutes, q.seconds, q.frames].map(p2).join(':')}` : '';
    return `msc ${command}${num}${list}${time}${dev}${fmt}`;
  }
  if (q.messageType === 3) { const raw = text(q.rawString).replace(/[^0-9a-fA-F]/g, '').toUpperCase(); return raw.length >= 2 && raw.length % 2 === 0 ? `F0 ${(raw.match(/../g) || []).join(' ')} F7`.replace(/^F0 F0/, 'F0').replace(/F7 F7$/, 'F7') : ''; }
  return '';
}

/**
 * A QLab MSC message as its bytes in hex ("F0 7F 03 02 01 06 …"): the commands and formats a MIDI cue here has no words
 * for (SET, a cue path, a format of QLab's own numbering). The command's data is laid out as the MSC specification
 * has it: a cue number, list and path in ASCII separated by 00; SET's control number and value as 14 bits, low first;
 * FIRE's macro; a timed go's time before its cue. '' when the command is not one MSC has.
 */
function mscBytes(q: Archived): string {
  const cmd = Number(q.command), fmt = Number(q.commandFormat), dev = Number.isFinite(Number(q.deviceID)) ? Number(q.deviceID) & 0x7f : 0x7f;
  if (!(cmd >= 1 && cmd <= 0x7f) || !(fmt >= 1 && fmt <= 0x7f)) return '';
  const ascii = (v: unknown) => [...text(v)].map((ch) => ch.charCodeAt(0) & 0x7f);
  const cue = () => { const parts = [q.qNumber, q.qList, q.qPath].map(text); while (parts.length && !parts[parts.length - 1]) parts.pop(); return parts.flatMap((p, i) => [...(i ? [0] : []), ...ascii(p)]); };
  const b14 = (n: unknown) => { const v = Math.max(0, Math.min(16383, Math.round(Number(n) || 0))); return [v & 0x7f, v >> 7]; };
  const time = () => [Number(q.hours) & 31, Number(q.minutes) & 63, Number(q.seconds) & 63, Number(q.frames) & 31, Number(q.subframes) & 127];
  const data = cmd === 6 ? [...b14(q.controlNumber), ...b14(q.controlValue)] : cmd === 7 ? [Number(q.macro) & 0x7f] : cmd === 4 ? [...time(), ...cue()] : [1, 2, 3, 5, 0x0b].includes(cmd) ? cue() : [];
  return [0xf0, 0x7f, dev, 0x02, fmt, cmd, ...data, 0xf7].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

/** Why a QLab MIDI cue has no message here: what its fields held, in a few words. */
function midiWhy(q: Archived): string {
  if (q.messageType === 3) return text(q.rawString).trim() ? `a SysEx message this could not read as bytes (“${text(q.rawString).trim().slice(0, 40)}”)` : 'an empty SysEx message (QLab sends nothing for it either)';
  if (q.messageType === 1) return q.status === undefined ? 'a voice message with no kind of message saved' : `a voice message of a kind this does not know (status ${q.status})`;
  if (q.messageType === 2) return `an MSC message with command ${q.command ?? 'none'} in format ${q.commandFormat ?? 'none'}, which MSC does not have`;
  if (q.messageType === undefined || q.messageType === null) return 'no message at all (the cue has no MIDI fields saved)';
  return `a message of a type this does not know (type ${q.messageType})`;
}

/**
 * A QLab Light cue's commands, where they can be read. QLab's light commands are text ("front = 80"), and a Light
 * cue here holds the same kind of text, so they come across as written. The name QLab keeps them under in the file
 * has not been seen in a real workspace (`lightCommandText` is its OSC name for them), so any text on the cue whose
 * every line reads as a light command is taken. '' when there is none.
 */
function lightText(q: Archived): string {
  const reads = (v: string | null): v is string => {
    if (typeof v !== 'string' || !v.includes('=')) return false;
    const cmds = lightCommands.parse(v);
    return cmds.length > 0 && cmds.every((c) => !c.error || /pulled from another cue/.test(c.error));
  };
  const flat = (v: any): string | null => (Array.isArray(v) && v.length && v.every((x) => typeof text(x) === 'string' && text(x).includes('=')) ? v.map(text).join('\n') : typeof v === 'string' ? v : v && typeof v === 'object' && typeof v.NSString === 'string' ? v.NSString : null);
  for (const k of ['lightCommandText', 'commandText', 'lightCommands', 'commands']) { const v = flat(q[k]); if (reads(v)) return v.trim(); }
  for (const [k, raw] of Object.entries(q)) { if (['name', 'notes', 'number', 'uniqueID', 'colorName', '$type'].includes(k)) continue; const v = flat(raw); if (reads(v)) return v.trim(); }
  return '';
}

/**
 * A Text cue's styled text (an NSAttributedString) as our Text cue's font, size, colour and alignment: { fields, said,
 * mixed }, or null when it has no style this reads. The style of its first run is taken; `mixed` when it has others.
 * The font is the family (the name QLab last saw, its style words taken off: a stage here has no bold or italic).
 */
function styleOf(styled: Archived, seenFonts: unknown) {
  const runs = styled.NSAttributes;
  const a: Archived | null = Array.isArray(runs) ? runs[0] : runs && typeof runs === 'object' ? runs : null;
  if (!a) return null;
  const fields: Record<string, unknown> = {}, said: string[] = [];
  const font = a.NSFont && typeof a.NSFont === 'object' ? a.NSFont : null;
  const seen = Array.isArray(seenFonts) ? text(seenFonts[0]) : '';
  // (a PostScript name, "HelveticaNeue-Bold", is the family with its spaces taken out: they are put back)
  const family = (seen || text(font && font.NSName).split('-')[0].replace(/([a-z])([A-Z])/g, '$1 $2')).replace(/\s+(Regular|Bold|Italic|Oblique|Light|Medium|Semibold|SemiBold|Heavy|Black|Thin|UltraLight|Condensed)\b.*$/i, '').trim();
  if (family) { fields.font = family; said.push(family); }
  if (font && Number(font.NSSize) > 0) { fields.size = Math.round(Number(font.NSSize)); said.push(`${fields.size} pt`); }
  // a colour is kept as text: "r g b a" for RGB, "w a" for a grey, each 0–1
  const color = a.NSColor && typeof a.NSColor === 'object' ? a.NSColor : null;
  const nums = (b: unknown) => (Buffer.isBuffer(b) ? b.toString('latin1').replace(/\0/g, '').trim().split(/\s+/).map(Number) : []);
  const rgb = color ? (color.NSRGB ? nums(color.NSRGB) : color.NSWhite ? nums(color.NSWhite).slice(0, 1).flatMap((w) => [w, w, w]) : []) : [];
  if (rgb.length >= 3 && rgb.slice(0, 3).every((x) => x >= 0 && x <= 1)) {
    const hex = '#' + rgb.slice(0, 3).map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
    if (hex !== '#ffffff') fields.textColor = hex;
    said.push(hex === '#ffffff' ? 'white' : hex);
  }
  // NSTextAlignment: left 0, right 1, centre 2 (justified and natural are taken as left)
  const align = a.NSParagraphStyle && typeof a.NSParagraphStyle === 'object' ? Number(a.NSParagraphStyle.NSAlignment ?? 4) : null;
  if (align === 1) fields.align = 'right'; else if (align === 0 || align === 3 || align === 4) fields.align = 'left';
  if (!said.length) return null;
  return { fields, said: said.join(', '), mixed: Array.isArray(runs) && runs.length > 1 };
}

/** QLab's ticks: an F53Timecode keeps its time as frames over its frames counted a second (30 for 29.97 drop frame)
 *  in 48 million ticks a second: 01:00:00:00 is 3600 × 48 million at any rate, 10:00:00;00 at 29.97 drop 35964 ×. */
const TICKS = 48e6;
/** An F53Timecode's frame rate as one of ours, or null for one this has not (23.976, 24.975, 29.97 counted without drops). */
function rateOfF53(t: Archived | null | undefined): timecode.Rate | null {
  const r = t && t.F53TimecodeFramerate;
  if (!r || typeof r !== 'object') return null;
  const fps = Number(r.F53FramerateFramesPerSecond), drop = !!r.F53FramerateDropFrame, slow = !!r.F53FramerateVideoSpeed;
  if (fps === 30 && drop) return '29.97df';
  if (slow) return null;
  return fps === 24 ? '24' : fps === 25 ? '25' : fps === 30 && !drop ? '30' : null;
}
/** An F53Timecode as text at its own rate ("01:02:03:04", a ; before the frames when it drops), or null. */
function timecodeText(t: Archived | null | undefined): string | null {
  const rate = rateOfF53(t), ticks = Number(t && t.F53TimecodeCommonTicks);
  if (!rate || !Number.isFinite(ticks) || ticks < 0) return null;
  return timecode.format(timecode.fromFrames(Math.round((ticks / TICKS) * timecode.rateOf(rate).fps), rate), rate);
}
/** A wall-clock trigger as ours ("19:30", "19:30:15 mon tue"), or null when it is not one (no day ticked, or a mode
 *  other than the time of day, 0, the only one seen). */
function clockOf(q: Archived): string | null {
  if (Number(q.wallClockMode) || 0) return null;
  const h = Number(q.wallHours) || 0, m = Number(q.wallMinutes) || 0, s = Number(q.wallSeconds) || 0;
  if (h > 23 || m > 59 || s > 59) return null;
  const days = ['wallSunday', 'wallMonday', 'wallTuesday', 'wallWednesday', 'wallThursday', 'wallFriday', 'wallSaturday'].map((k) => q[k] !== false);
  if (!days.some(Boolean)) return null;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}${s ? `:${p2(s)}` : ''}${days.every(Boolean) ? '' : ' ' + ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].filter((_, i) => days[i]).join(' ')}`;
}
/** Fade and stop others' reach: QLab 5 keeps it as a number; a yes or no (QLab 4) is taken as all of them. */
function fadeScope(q: Archived, cue: Made) {
  const scope = typeof q.fadeAndStopOthers === 'number' ? FADE_OTHERS[q.fadeAndStopOthers] : null;
  if (scope && scope !== 'all') cue.fadeOthersScope = scope;
}

/**
 * A QLab Timecode cue as one of ours. QLab 5.6 saves `startTimecode` as an F53Timecode (its rate and its ticks: see
 * timecodeText), `outputType` 1 for LTC and 0 for MTC, `LTCChannel` counted from 0 and `duration` in seconds, as
 * read back from workspaces it saved. A start written another way (text, or hours, minutes, seconds and frames, or a
 * rate in a field of its own) is read too, as a guess, and what could not be read is said.
 */
function timecodeOf(q: Archived) {
  const out: { timecode: string; fps: '24' | '25' | '29.97df' | '30'; output: 'mtc' | 'ltc'; channel?: number; duration?: number } = { timecode: '01:00:00:00', fps: '30', output: 'mtc' }, unsure: string[] = [];
  const st = q.startTimecode, p2 = (n: unknown) => String(Math.max(0, Math.round(Number(n) || 0))).padStart(2, '0');
  const f53 = st && typeof st === 'object' && 'F53TimecodeCommonTicks' in st;
  if (f53) {
    const rate = rateOfF53(st), start = timecodeText(st);
    if (rate) out.fps = rate; else unsure.push('its frame rate');
    if (start) out.timecode = start; else unsure.push('its start time');
  }
  const parts = Array.isArray(st) && st.length >= 4 ? st.slice(0, 4)
    : st && typeof st === 'object' && !('NSString' in st) ? [st.hours ?? st.hour ?? st.h, st.minutes ?? st.minute ?? st.m, st.seconds ?? st.second ?? st.s, st.frames ?? st.frame ?? st.f] : null;
  const asText = parts && parts.every((x: unknown) => Number.isFinite(Number(x))) ? parts.map(p2).join(':') : typeof st === 'string' || (st && st.NSString) ? text(st).trim().replace(/;/g, ':') : '';
  if (f53) { /* read above */ } else if (timecode.parse(asText)) out.timecode = timecode.format(timecode.parse(asText), '30'); else unsure.push('its start time');
  const rate = f53 ? null : [q.framerate, q.frameRate, q.fps, q.smpteFormat, q.timecodeFormat, q.format, st && st.framerate, st && st.format].map(Number).find((n) => [24, 25, 29.97, 30].some((r) => Math.abs(n - r) < 0.011));
  if (rate) out.fps = Math.abs(rate - 29.97) < 0.011 ? '29.97df' : String(Math.round(rate)) as '24' | '25' | '30'; else if (!f53) unsure.push('its frame rate');
  // (LTCChannel counts from 0: QLab shows 1 more)
  if (Number(q.outputType) === 1 || /ltc/i.test(text(q.outputType))) { out.output = 'ltc'; out.channel = Math.max(1, Math.round(Number(q.LTCChannel) || 0) + 1); }
  if (secs(q.duration)) out.duration = secs(q.duration);
  if (timecode.whyNot(timecode.parse(out.timecode), out.fps)) { out.timecode = timecode.format(timecode.parse('01:00:00:00')!, out.fps); unsure.push('its start time'); }
  return { cue: out, unsure: [...new Set(unsure)] };
}

function importQlab(buffer: Buffer, { file = '' }: { file?: string } = {}) {
  let root: Archived;
  try { root = unarchive(buffer) as Archived; } catch (err) { throw new Error(`This is not a QLab workspace this can read (${(err as Error).message}).`); }
  if (!root || typeof root !== 'object' || !root.cueLists) throw new Error('This is not a QLab 4 or 5 workspace (it has no cue lists). QLab 3 and earlier files are not read: open and save them in QLab 4 or 5 first.');
  const v4 = /^4\./.test(String(root.QLabShortVersionString || '')) || /\.qlab4(backup)?$/i.test(file);
  const endAtFileEnd: string[] = [];             // (QLab 4) cues whose End at may be nothing but the end of the file
  const top: Archived = Buffer.isBuffer(root.cueLists) ? unarchive(root.cueLists) as Archived : root.cueLists;
  const baseDir = file ? path.dirname(file) : '';
  const title = text(root.workspaceName) || (file ? path.basename(file).replace(/\.qlab\d(backup)?$/i, '') : 'Imported show');
  const doc = show.newShow(title);
  const issues: ImportIssue[] = [];
  const ids = new Map<unknown, string>();   // QLab uniqueID → our id
  const made = new Map<unknown, Made>();     // QLab uniqueID → our cue
  const kinds: Record<string, number> = {};
  const monoLeft: string[] = [];               // mono sounds QLab sent to output 1 alone (its default for one)
  const lightNames = new Set<string>();       // the instruments and groups the Light cues name: the patch they need here
  const label = (q: Archived) => `${text(q.number) ? text(q.number) + ' ' : ''}${text(q.name) || (q.$type || 'cue').replace(/Cue$/, '')}`.trim();
  const note: Note = (q, why) => issues.push({ id: ids.get(q.uniqueID) || null, cue: label(q), why });
  const each = (q: Archived, fn: (q: Archived) => void) => { fn(q); for (const k of q.cues || []) each(k, fn); };
  for (const l of top.cues || []) for (const q of l.cues || []) each(q, (c) => ids.set(c.uniqueID, show.newId()));
  const byNumber = new Map<string, string>();     // a cue's number → our id (the first with it, as QLab finds one by number)
  for (const l of top.cues || []) for (const q of l.cues || []) each(q, (c) => { const n = text(c.number); if (n && !byNumber.has(n)) byNumber.set(n, ids.get(c.uniqueID)!); });

  // ── settings ────────────────────────────────────────────────────────────
  const settings: Archived = root.settings || {};
  const general: Archived = settings.General || {};
  if (Number(general.minTimeBetweenGOs) >= 0) doc.settings.go.doubleGoProtection = secs(general.minTimeBetweenGOs);
  if (Number(general.panicDuration) >= 0) doc.settings.go.panicFade = secs(general.panicDuration);
  const patchIds = new Map<unknown, string>();
  // QLab 4: the network patches are the OSC settings' numbered destinations (a cue names one by its number, from 1)
  (((settings.OSC || {}).clientState) || []).forEach((d: Archived | null, i: number) => {
    if (!d || !text(d.host)) return;
    const id = show.newId('patch');
    patchIds.set(`v4:${i + 1}`, id);
    const names = (settings.OSC || {}).names;
    const name = (names && typeof names === 'object' && text(names[i + 1] || names[String(i + 1)] || names[i])) || `Patch ${i + 1}`;
    doc.settings.network.patches.push({ id, name: /^\[object|^$/.test(name) ? `Patch ${i + 1}` : name, host: text(d.host) === 'localhost' ? '127.0.0.1' : text(d.host), port: Number(d.port) || 0, protocol: d.useTcp ? 'tcp' : 'udp', framing: 'slip', device: 'generic' });
  });
  for (const p of (settings.Network || {}).networkPatches || []) {
    const d: Archived = (p && p.data) || {};
    const dests: Archived[] = d.clientStates || [];
    const first: Archived = dests[0] || {};
    const id = show.newId('patch');
    patchIds.set(d.uniqueID, id);
    const host = text(first.host) === 'localhost' ? '127.0.0.1' : text(first.host);
    doc.settings.network.patches.push({ id, name: text(d.name) || `Patch ${doc.settings.network.patches.length + 1}`, host, port: Number(first.port) || 0, protocol: first.useTcp ? 'tcp' : 'udp', framing: 'slip', device: 'generic' });
    if (dests.length > 1) issues.push({ id: null, cue: `Network patch ${text(d.name)}`, why: `had ${dests.length} destinations; only the first (${host}:${first.port}) is kept` });
    if (d.deviceIdentifier && d.deviceIdentifier !== 'com.figure53.oscmessage') issues.push({ id: null, cue: `Network patch ${text(d.name)}`, why: `was a device patch (${d.deviceIdentifier}); its cues are imported only where QLab saved the OSC message itself` });
  }

  // ── cues ────────────────────────────────────────────────────────────────
  const common = (q: Archived, cue: Made) => {
    if (text(q.number)) cue.number = text(q.number);
    if (text(q.name)) cue.name = text(q.name);
    if (text(q.notes)) cue.notes = text(q.notes);
    const col = COLOR[String(q.colorName || '').toLowerCase()];
    if (col) cue.color = col; else if (q.colorName && q.colorName !== 'none') note(q, `its colour (${q.colorName}) has no match here`);
    const col2 = q.useSecondColor && COLOR[String(q.secondColorName || '').toLowerCase()];
    if (col2) cue.color2 = col2;
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
    // QLab's condition on the second byte (a note's velocity, a controller's value): = 0, any 1, < 2, > 3 (read back
    // from what QLab saved for each). "=" is kept as the trigger's value; "any" is a trigger with none. (A note's "= 0"
    // is taken as none: a note on at velocity 0 is a note off, so it can only be a velocity never set.)
    const op2 = Number(q.midiTrigger && q.midiTrigger.byte2Operator) || 0, b2 = Number(q.midiTrigger && q.midiTrigger.byte2) || 0;
    if (mt) cue.midiTrigger = `${mt} ${Number(q.midiTrigger.byte1) || 0}${mt !== 'pc' && op2 === 0 && !(mt === 'note' && b2 === 0) ? ` ${b2}` : ''}${Number(q.midiTrigger.channel) > 0 ? ` ch ${Number(q.midiTrigger.channel)}` : ''}`;
    if (hk && show.APP_KEYS.has(hk)) note(q, `its hotkey ${hk} is one of this app’s own keys: change it (its Triggers tab)`);
    if (mt && mt !== 'pc' && (op2 === 2 || op2 === 3)) note(q, `its MIDI trigger came across as “${cue.midiTrigger}”: it fires on any ${mt === 'note' ? 'velocity' : 'value'}, where QLab’s fired only ${op2 === 2 ? 'below' : 'above'} ${b2}`);
    // a time of day: hours, minutes, seconds, and the days it is on (all seven: every day)
    const clock = q.useWallClock ? clockOf(q) : null;
    if (clock) cue.clockTrigger = clock;
    const tc = q.useTimecode ? timecodeText(q.timecode) : null;
    if (tc) cue.timecodeTrigger = tc;
    const trig = [q.useHotKey && !hk && (Number((q.hotKey || {}).QLActionKeyKeyCharacter) > 0 ? 'a hotkey this cannot hold (one with ⌘ or ctrl, or not a letter, digit or F-key)' : 'a hotkey with no key set'), q.useMIDITrigger && !mt && 'a MIDI trigger', q.useWallClock && !clock && 'a wall-clock trigger', q.useTimecode && !tc && 'a timecode trigger'].filter(Boolean);
    if (trig.length) note(q, `had ${trig.join(' and ')}: not carried over${q.useTimecode && !tc ? ' (give it its time again on its Triggers tab)' : ''}`);
    if (tc) note(q, `its timecode trigger came across as ${tc}: it fires when the show’s timecode input is on (Settings ▸ Integrations ▸ Network ▸ Timecode)`);
    if (q.duckOthers) {
      // (QLab keeps the duck level as a gain: below 1 ducks, above 1 boosts)
      const d = toDb(q.duckLevel);
      if (d) { cue.duckOthers = Math.max(-60, Math.min(12, d)); if (Number(q.duckTime) >= 0 && Math.abs(Number(q.duckTime) - 1) > 0.0001) cue.duckTime = secs(q.duckTime); }
    }
    const second = Number(q.secondTriggerAction) || 0;
    if (SECOND_TRIGGER[second]) {
      cue.secondTrigger = SECOND_TRIGGER[second];
      if (second === 3 || second === 4) note(q, `its second trigger was a hard stop${second === 4 ? ' and restart: here it restarts' : ': here it stops'}`);
    } else if (second) note(q, `its second trigger played the playlist’s ${second === 6 ? 'next' : 'previous'} cue: not carried over`);
    if (second && q.secondTriggerOnRelease) cue.secondOnRelease = true;
    if (q.autoLoad) cue.autoLoad = true;
    if (q.skipIfDisarmed) note(q, 'was "skip if disarmed": not carried over');
    if (q.fadeAndStopOthers && cue.type !== 'group') { cue.fadeOthers = secs(q.fadeAndStopOthersTime) || 0.01; fadeScope(q, cue); }
    return cue;
  };
  const targetOf = (q: Archived) => ids.get(q.cueTargetUniqueID || (q.cueTarget && q.cueTarget.uniqueID)) || null;
  const targetCue = (q: Archived): Archived | null => (q.cueTarget && typeof q.cueTarget === 'object' ? q.cueTarget : null);

  function fileOf(q: Archived): string {
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
      const plain = (n: string) => n.normalize('NFKD').toLowerCase().replace(/[^a-z0-9.]+/g, '_');
      let names: string[] = []; try { names = fs.readdirSync(dir); } catch { /* no such folder */ }
      const hits = names.filter((n) => plain(n) === plain(path.basename(want)));
      if (hits.length === 1) { note(q, `its file was found under a slightly different name (“${hits[0]}” for “${path.basename(want)}”): check it is the right one`); return path.join(dir, hits[0]); }
    }
    return last || (rel && baseDir ? path.resolve(baseDir, rel) : rel);
  }

  /** A Video, Text or Camera cue's place on the stage, where the file has it under the names QLab's OSC dictionary
   *  uses (opacity, translation, scale, rotation, layer, fillStage). Returns what was found, in words. */
  function geometry(q: Archived, cue: Made) {
    const found: string[] = [];
    const n = (...keys: string[]) => { for (const k of keys) { const v = k.split('.').reduce((o: any, p) => (o && typeof o === 'object' ? o[p] : undefined), q); if (typeof v === 'number' && Number.isFinite(v)) return v; } return null; };
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

  function convert(q: Archived): Made {
    const id = ids.get(q.uniqueID) as string;
    const type = q.$type;
    kinds[type] = (kinds[type] || 0) + 1;
    let cue: Made;
    if (type === 'GroupCue') {
      cue = common(q, { id, type: 'group' });
      if (q.groupMode === 6) { cue.mode = 'playlist'; if (q.playlistShuffle) cue.shuffle = true; if (q.playlistLoop) cue.repeat = true; if (q.playlistCrossfade && secs(q.playlistCrossfadeDuration)) cue.crossfade = secs(q.playlistCrossfadeDuration); }
      else if (q.groupMode === 1) cue.mode = 'enter';
      else if (q.groupMode === 2) cue.mode = 'first';
      else if (q.groupMode === 4) cue.mode = 'random';
      else if (q.groupMode !== 3) note(q, `was a ${GROUP_MODE[q.groupMode] || `mode ${q.groupMode}`} group: here it fires all its children together`);
      if (q.fadeAndStopOthers) { cue.fadeOthers = secs(q.fadeAndStopOthersTime) || 0.01; fadeScope(q, cue); }
      cue.children = (q.cues || []).map(convert);
      // (a playlist plays its cues one after another itself: QLab does not run their continue modes, and nor does this)
      if (q.groupMode === 6) for (const k of cue.children!) delete k.continue;
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
      const slices = (q.slices || []).filter((s: Archived) => s && Number(s.time) > 0);
      if (slices.length) {
        // QLab's slices: each ends at its marker and has a play count (or loops until devamped); the last runs to the end
        cue.markers = slices.map((s: Archived, i: number) => ({ at: secs(s.time), name: `Slice ${i + 2}` }));
        const ends = [...slices.map((s: Archived) => ({ end: secs(s.time), n: Number(s.playCount) || 1, inf: !!s.infiniteLoop })), { end: cue.cutAt || len, n: Number((q.lastSlice || {}).playCount) || 1, inf: !!(q.lastSlice || {}).infiniteLoop }];
        const loops: Region[] = [];
        let from = cue.from || 0;
        ends.forEach((s, i) => { if (s.end > from && (s.inf || s.n > 1)) loops.push({ start: from, end: s.end, name: `Slice ${i + 1}`, ...(s.inf ? { hold: true } : { count: s.n }) }); from = s.end || from; });
        if (loops.length) cue.loops = loops;
      }
      if (Number(q.rate) > 0 && Math.abs(Number(q.rate) - 1) > 0.0001) {
        cue.rate = Math.max(0.25, Math.min(4, Math.round(Number(q.rate) * 1000) / 1000));
        if (q.preservePitch === true || q.pitchShift === false || q.doPitchShift === false || q.doPitchShift === 0) cue.preservePitch = true;      // (QLab 5.6 saves doPitchShift 0)
        const known = q.doPitchShift !== undefined || q.preservePitch !== undefined || q.pitchShift !== undefined;
        note(q, `plays at rate ${cue.rate}${cue.rate !== Number(q.rate) ? ` (it was ${q.rate}: outside what can be played here)` : ''}${known ? (cue.preservePitch ? ', keeping its pitch' : ', its pitch moving with it') : ': check whether it should keep its pitch (Audio ▸ More ▸ Keep pitch)'}`);
      }
      if (q.doFade) {
        // its integrated fade: the level drawn over the stretch of the file it plays
        const env = envelopeOf(q, cue.from || 0, cue.cutAt || len);
        if (env) { cue.envelope = env; note(q, 'its integrated fade envelope came across as a level envelope: check it on the waveform (Time & Loops)'); }
        else note(q, 'had an integrated fade envelope, which was not in a form this reads: draw it on the waveform (Time & Loops ▸ Draw a level envelope)');
      }
      if ((q.effects || []).length) note(q, `had ${q.effects.length} audio effect${q.effects.length === 1 ? '' : 's'}: not carried over`);
      ownOutputs(q, cue, note);
      // a mono file left on QLab's default crosspoints goes to cue output 1 alone; on a bus here it plays in the middle
      if (!cue.outputs && cue.pan === undefined && cue.file && routing.wavChannels(cue.file) === 1) {
        const x = (r: number, c: number) => { const e = Object.values<Archived>((q.levels && q.levels.entries) || {}).find((k) => k && k.row === r && k.column === c); return e ? Number(e.initialLevel) : 0; };
        if (x(1, 1) > 0 && !(x(1, 2) > 0)) monoLeft.push(label(q));
      }
      if (Number(cue.plays) > 1 && cue.loops) { delete cue.plays; note(q, 'had a play count and slices: the slices’ counts are kept, the play count of the whole is not'); }
      // a click sent to outputs of its own with the main level down would arrive silent, and nobody told. (Only when
      // its crosspoints do send it somewhere other than QLab's default: every cue's output levels are at unity.)
      if (Number(cue.gainDb) <= SILENT_DB && cue.outputs) note(q, 'played only on outputs of its own, with its main level down: it is silent until you raise its level (the inspector’s Level; its outputs are under Own outputs)');
    } else if (type === 'FadeCue') {
      cue = common(q, { id, type: 'fade', target: targetOf(q), duration: secs(q.duration), stopTarget: !!(q.stopTargetWhenDone || (q.fade && q.fade.stopTargetWhenDone)) });
      const main: Archived | undefined = Object.values<Archived>((q.fade && q.fade.entries) || {}).find((e: Archived) => e && e.row === 0 && e.column === 0 && e.live !== false);
      const others = Object.values<Archived>((q.fade && q.fade.entries) || {}).filter((e: Archived) => e && !(e.row === 0 && e.column === 0) && e.live !== false).length;
      cue.relative = q.mode === 1 || (q.fade && q.fade.fadeType === 'relative');
      const pictured = !!(q.doOpacity || q.doTranslation || q.doScale || q.doRotation);
      if (main) cue.db = toDb(main.endValue);
      else { cue.db = cue.relative ? 0 : mainLevel(targetCue(q) && targetCue(q)!.levels); if (!pictured && !q.doRate) note(q, 'does not fade its target’s main level: what it faded is not carried over'); }
      if (cue.relative) note(q, 'is a relative fade: check its amount (it is measured from the target’s own level here)');
      if (others) note(q, `also faded ${others} other level${others === 1 ? '' : 's'} (outputs or crosspoints): only the main level is kept`);
      if (q.doRate && Number(q.rate) > 0) { cue.rate = Math.max(0.25, Math.min(4, Math.round(Number(q.rate) * 1000) / 1000)); note(q, `also fades its target’s rate to ${cue.rate}: check it`); }
      else if (q.doRate) note(q, 'also faded its target’s rate, to a rate this could not read: set Rate to on the Fade');
      // a picture's place: opacity 0–1 (a percent here), position in stage pixels, scale, rotation in degrees
      const num = (v: unknown) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : null);
      if (q.doOpacity && num(q.opacity) !== null) cue.opacity = Math.round(num(q.opacity)! * 1000) / 10;
      if (q.doTranslation) { if (num(q.translationX) !== null) cue.x = Math.round(num(q.translationX)! * 100) / 100; if (num(q.translationY) !== null) cue.y = Math.round(num(q.translationY)! * 100) / 100; }
      if (q.doScale && num(q.scaleX)! > 0) { cue.scale = Math.round(num(q.scaleX)! * 1000) / 1000; if (num(q.scaleY) !== null && Math.abs(num(q.scaleY)! - num(q.scaleX)!) > 0.001) note(q, 'faded the scale differently across and down: one scale is kept'); }
      if (q.doRotation && num(q.rotation) !== null) { cue.rotation = Math.round(num(q.rotation)! * 100) / 100; if (Number(q.rotationType)) note(q, 'rotated about another axis than the screen’s: here it turns flat on the stage'); }
      if (pictured && !main) delete cue.db;      // (it moves the picture, not the sound: its level stays)
      if (q.targetMode) note(q, 'targeted an output patch or audio map: not carried over');
      const t = targetCue(q);
      if (t && !['AudioCue', 'GroupCue', 'MicCue', 'VideoCue', 'TextCue', 'TitlesCue', 'CameraCue'].includes(t.$type)) note(q, `targets a ${t.$type.replace(/Cue$/, '')} cue: a Fade here moves a sound, a picture or a group of them`);
    } else if (type === 'ResetCue') {
      cue = common(q, { id, type: 'reset', target: targetOf(q) });
      if (q.targetMode) note(q, 'reset an output patch or audio map: not carried over');
    } else if (type === 'TargetCue') {
      // the cue to re-aim, and the number of the cue it is aimed at instead (QLab keeps the number, not the cue)
      const to = byNumber.get(text(q.targetCueNumber));
      cue = common(q, { id, type: 'target', target: targetOf(q), ...(to ? { to } : {}) });
      if (text(q.targetCueNumber) && !to) note(q, `re-aimed its target at cue ${text(q.targetCueNumber)}, which is not in the workspace`);
      else if (!text(q.targetCueNumber)) note(q, 'has no new target set');
    } else if (SIMPLE[type]) {
      cue = common(q, { id, type: SIMPLE[type] });
      if (SIMPLE[type] !== 'memo') cue.target = targetOf(q);
      const t = targetCue(q);
      if (type === 'DevampCue') {
        if (t && t.$type !== 'AudioCue') note(q, 'targets something other than an Audio cue');
        if (q.fireNextCueAtMomentLoopEnds) cue.startNext = true;
        if (q.stopTargetWhenDone) note(q, 'stopped its target at the end of the slice: here the sound plays on past its loop');
        if ((t && (t.slices || []).length) || q.devampType === 0) note(q, 'its target has slices: here they are loop regions, and this Devamp lets the track out of the one it is going round');
      }
    } else if (type === 'LoadCue') {
      // (a negative time is from the end, in QLab and here)
      cue = common(q, { id, type: 'load', target: targetOf(q), at: Number.isFinite(Number(q.loadTime)) ? Math.round(Number(q.loadTime) * 1000) / 1000 : 0 });
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
        if (q.fadeType === 1) { cue.fadeFrom = Number(q.startValue) || 0; cue.fadeTo = Number(q.endValue) || 0; cue.duration = secs(q.duration); if (!cue.message!.includes('#v#')) note(q, 'is a faded message with no #v# in it'); }
        else if (q.fadeType === 2) note(q, 'was a 2D fade: only the message is kept');
        else if (secs(q.duration)) note(q, `re-sent its message for ${secs(q.duration)} s: it is sent once here`);
      } else {
        cue = common(q, { id, type: 'memo' });
        // what it held, in a word: plain text, hex, a command for a device, or nothing at all (a new cue left empty)
        // (an OSC message cue left empty is saved as "{custom}", with its patch's details under `f53.` names)
        const plain = text(q.plainTextString), hex = text(q.hexCodesString);
        const device = Object.keys(q.allParameterValues || {}).some((k) => !k.startsWith('f53.') && k !== 'com.figure53.oscmessage') || (osc.trim() && osc.trim() !== '{custom}');
        const kind = plain ? 'plain text' : hex ? 'hex' : device ? 'a device command' : '';
        cue.notes = `${cue.notes ? cue.notes + '\n' : ''}(QLab Network cue: ${plain ? `plain text “${plain}”` : hex ? `hex ${hex}` : kind || 'no message'})`;
        note(q, kind ? `was a Network cue that is not an OSC message (${kind}): kept as a Memo` : 'was a Network cue with no message: kept as a Memo');
      }
    } else if (type === 'VideoCue') {
      // The file, level and times are read where an Audio cue keeps them (a Video cue is an Audio cue with a picture
      // in QLab too). Its place on the stage is kept under the names QLab's OSC dictionary gives it (opacity,
      // translationX and Y, scaleX and Y, layer, fullSurface), as workspaces QLab 5.6 saved have it.
      // (QLab 4 keeps a Video cue's sound, and so its level, on an Audio cue inside it: `audioCue`)
      const sound: Archived | null = q.levels ? q : q.audioCue && typeof q.audioCue === 'object' ? q.audioCue : null;
      cue = common(q, { id, type: 'video', file: fileOf(q), gainDb: mainLevel(sound && sound.levels) });
      if (!cue.file) note(q, 'has no file');
      const len = Number(q.lastSeenFileDuration) || 0;
      if (secs(q.startTime)) cue.from = secs(q.startTime);
      if (secs(q.endTime) && (!len || q.endTime < len - 0.01)) cue.cutAt = secs(q.endTime);
      if (q.infiniteLoop) cue.loop = true;
      else if (Number(q.playCount) > 1) note(q, `played ${Math.round(Number(q.playCount))} times: a Video cue here plays once, or loops`);
      if (q.holdLastFrame) cue.holdEnd = true;
      const found = geometry(q, cue);
      note(q, found.length
        ? `is a Video cue: its file, level, times and ${found.join(', ')} came across. Look at it on the stage (QLab’s stage and this one may not be the same size)`
        : 'is a Video cue: its file, level and times came across; its place on the stage (position, scale, opacity, layer) was not found in the file, so it fits the stage here');
      if ((q.slices || []).length) note(q, 'had slices: not carried over for a Video cue');
      if (Number(q.rate) && Math.abs(Number(q.rate) - 1) > 0.0001) note(q, `played at rate ${q.rate}: rate is not here yet`);
      if ((q.videoEffects || q.effects || []).length) note(q, 'had effects: not carried over');
    } else if (type === 'TextCue' || type === 'TitlesCue') {
      // QLab 5 keeps a Text cue's words as styled text (`titlesAttributedString`); a plain `text` is read if the file has one
      const styled: Archived | null = q.titlesAttributedString && typeof q.titlesAttributedString === 'object' ? q.titlesAttributedString : null;
      const words = styled && typeof styled.NSString === 'string' ? styled.NSString : typeof q.text === 'string' ? q.text : (q.text && typeof q.text.NSString === 'string' ? q.text.NSString : '');
      cue = common(q, { id, type: 'text', text: words || text(q.name) || 'Text' });
      geometry(q, cue);
      const style = styled ? styleOf(styled, q.lastSeenFontNames) : null;
      if (style) Object.assign(cue, style.fields);
      note(q, !words ? 'is a Text cue: its words could not be read from the file (QLab keeps them as styled text), so its name stands in for them. Type them again, and set the font, size and colour'
        : style && style.mixed ? `is a Text cue: its words came across, with the style of their first letter (${style.said}); QLab had more than one style in them. Look at it on the stage`
          : style ? `is a Text cue: its words came across, in ${style.said}. Look at it on the stage (QLab’s point sizes are taken as stage pixels)`
            : 'is a Text cue: its words came across; its font, size and colour did not. Set them, and look at it on the stage');
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
      { const rate = Number(q.playbackRate ?? q.rate); if (rate > 0 && Math.abs(rate - 1) > 0.0001) cue.rate = Math.round(rate * 1000) / 1000; }      // (QLab 5.6 saves it as playbackRate)
      if (text(q.midiPatchID)) note(q, 'was sent to one MIDI patch: here MIDI goes to the output chosen in Settings ▸ Integrations ▸ Network (every output, until you choose)');
    } else {
      const what = UNSUPPORTED[type] || String(type || 'unknown').replace(/Cue$/, '');
      cue = common(q, { id, type: 'memo' });
      if (!cue.name) cue.name = `(${what} cue)`;
      const midi = type === 'MIDICue';         // a MIDI cue whose message could not be read: say what it held
      const script = type === 'ScriptCue' && text(q.source).trim();
      // a Light cue whose commands do not all read as ours (a colour as rgbw(…), say): its commands kept in its notes
      const light = type === 'LightCue' && text(q.commandText).trim();
      const bad = light ? lightCommands.parse(light).find((c) => c.error && !/pulled from another cue/.test(c.error)) : null;
      cue.notes = `${cue.notes ? cue.notes + '\n' : ''}(QLab ${what} cue: ${midi ? `${midiWhy(q)}. Make a MIDI cue here in its place if it should send something`
        : script ? `an AppleScript, which this does not run. Its script was:\n${text(q.source).trim()}\n`
          : light ? `its commands, which a Light cue here cannot all read, were:\n${light}\n` : 'not in Endless Cues yet. It does nothing here'}.)`;
      note(q, midi ? `was a MIDI cue with ${midiWhy(q)}: kept as a Memo` : script ? 'was a Script cue (AppleScript, which this does not run): kept as a Memo, its script in its notes'
        : light ? `was a Light cue with a command a Light cue here cannot read${bad && bad.error ? ` (${bad.error})` : ''}: kept as a Memo, its commands in its notes`
          : type === 'LightCue' ? 'was a Light cue with no commands: kept as a Memo' : `was a ${what} cue: kept as a Memo that does nothing`);
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
    const cues = (l.cues || []).map(convert) as Cue[];   // (a target not kept is taken off below, before the show is read)
    // a cue cart: the grid's size, and each cue on the button it was on (a position this cannot read takes the first free button)
    const isCart = l.groupMode === 5;
    if (isCart) (l.cues || []).forEach((q: Archived, i: number) => { const p = cartCell(q.cartPosition); if (p && cues[i]) cues[i].cell = `${p[0]},${p[1]}`; });
    doc.lists.push({ id: show.newId('list'), name: unique, ...(isCart ? { cart: cart.cleanCart({ rows: l.cartRows, columns: l.cartColumns })! } : {}), cues });
  }
  if (!doc.lists.length) doc.lists.push({ id: show.newId('list'), name: 'Main', cues: [] });

  if (monoLeft.length) issues.push({ id: null, cue: 'Mono sounds', why: `${monoLeft.length} mono sound${monoLeft.length === 1 ? '' : 's'} (${monoLeft.slice(0, 3).join('; ')}${monoLeft.length > 3 ? '…' : ''}) went to QLab’s output 1 alone, as QLab sends a mono file unless told otherwise; here ${monoLeft.length === 1 ? 'it plays' : 'they play'} in the middle of the bus. Pan ${monoLeft.length === 1 ? 'it' : 'them'} hard left (Pan −100) if that is what was meant` });
  if (lightNames.size) issues.push({ id: null, cue: 'Light patch', why: `QLab’s light patch is not read. The Light cues name: ${[...lightNames].slice(0, 24).join(', ')}${lightNames.size > 24 ? '…' : ''}. Add instruments and groups with those names under Settings ▸ Integrations ▸ Light` });

  // a target that was not a cue we kept (or was never set) leaves the cue broken, as it should be; say which
  for (const [uid, cue] of made) if ('target' in cue && !cue.target) { delete cue.target; issues.push({ id: cue.id, cue: `${cue.number ? cue.number + ' ' : ''}${cue.name || cue.type}`, why: 'has no target' }); void uid; }

  const r = show.normalise(doc);
  let cues = 0; show.walk(r.doc, () => cues++);
  const missing: string[] = [];
  show.walk(r.doc, (c: Cue) => { if ((c.type === 'audio' || c.type === 'video') && c.file && !fs.existsSync(c.file) && !missing.includes(c.file)) missing.push(c.file); });
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
function cartCell(v: any) {
  if (v && typeof v === 'object' && !Array.isArray(v) && !('row' in v)) v = [v.x ?? v.X, v.y ?? v.Y];
  return cart.parseCell(Array.isArray(v) ? v.map(Number) : v);
}

/** The issues, grouped: one line per kind of thing that did not come across. */
function summarise(issues: ImportIssue[], missing: string[], cues: number) {
  const groups = new Map<string, { why: string; cues: string[] }>();
  for (const i of issues) {
    const key = i.why.replace(/\d+(\.\d+)?/g, 'N').replace(/\(.*?\)/g, '').replace(/“.*?”/g, '');
    if (!groups.has(key)) groups.set(key, { why: i.why, cues: [] });
    groups.get(key)!.cues.push(i.cue);
  }
  const lines = [...groups.values()].sort((a, b) => b.cues.length - a.cues.length)
    .map((g) => (g.cues.length === 1 ? `${g.cues[0]}: ${g.why}.` : `${g.cues.length} cues (${g.cues.slice(0, 3).join('; ')}${g.cues.length > 3 ? '…' : ''}): ${g.why}.`));
  if (missing.length) lines.push(`${missing.length} sound file${missing.length === 1 ? ' is' : 's are'} not where the workspace says (${missing.slice(0, 3).map((f) => path.basename(f)).join(', ')}${missing.length > 3 ? '…' : ''}).`);
  if (!lines.length) lines.push(`All ${cues} cues came across as they were.`);
  return lines;
}

/** Whether a file looks like a QLab workspace (by its name). */
const isQlabFile = (p: unknown) => /\.qlab[45](backup)?$/i.test(String(p || ''));

export { envelopeOf, importQlab, isQlabFile, toDb, midiText, timecodeOf, panOfMatrix };

export type QlabImport = ReturnType<typeof importQlab>;
