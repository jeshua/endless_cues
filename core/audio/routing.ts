/**
 * Where sound goes: what the show file says about outputs, as plain data.
 *
 * A bus plays on a pair of the device's outputs (`out` on the bus). On top of that:
 *
 *   a cue's own outputs    cue.outputs: one row per channel of its sound, each { "<output>": dB }.
 *                          [{ "3": 0 }, { "4": 0 }] is a stereo file on outputs 3 and 4; [{ "5": -6 }, { "5": -6 }] is
 *                          both its channels on output 5 alone. A cue with rows does not play on its bus's pair,
 *                          but its bus still rides it: the fader, mute, solo and the ducker move it as they move
 *                          the bus (docs/specs/05-audio.md says why, and what does not follow).
 *   a cue's eq             cue.eq: { low, mid, high } in dB, the strip's three bands, on that one sound.
 *   the device's outputs   settings.audio.outs: { "<output>": { name, trim } }: a name for the people, and a trim
 *                          (0 down to −60 dB, never up: it sits after the limiter).
 *   audition               settings.audio.auditionOut: the first of the pair V plays to (absent: the house).
 *   effects                settings.audio.fx: { reverb: { secs, db, out }, delay: { secs, feedback, db, out } }, and a
 *                          send on a bus (`reverb`, `delay`: dB). A bus that sends nothing is untouched.
 *
 * None of these is in a show that does not use it. An output the device does not have is silent and said,
 * here as everywhere: nothing is ever moved to outputs 1–2 by itself.
 */
import * as fs from 'fs';
import type { Cue, ShowDoc } from '../show/types';

/** One channel's row of a cue's outputs: { output: dB }. */
export type MatrixRow = Record<string, number>;
/** What of a show's audio settings routing reads (each part there only when the show uses it). */
export interface RoutingSettings {
  outs?: Record<string, { name?: unknown; trim?: unknown } | null>;
  auditionOut?: unknown;
  fx?: { reverb?: FxSettings; delay?: FxSettings } | null;
  buses?: { id: string; reverb?: unknown; delay?: unknown }[];
}
type FxSettings = { secs?: unknown; db?: unknown; out?: unknown; feedback?: unknown };
/** One entry of a QLab cue's level matrix (a crosspoint, or a row's or column's master when the other is 0). */
export interface QlabLevel { row: number; column: number; initialLevel?: unknown; trimLevel?: unknown }
/** What a device cannot play of a show (`id`: a cue; null: the show's own settings). */
export interface Lost { id: string | null; level: 'warning'; why: string }
/** A cue as the audition marks it: its pre-wait counts, and so do its children's. */
export interface AuditionCue { id: string; preWait?: number; children?: AuditionCue[] }

const MAX_OUT = 64;          // the highest output a show may name
const MAX_ROWS = 24;         // the most channels of one sound that are routed
const SILENT_DB = -60;
const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A cue's outputs as the show keeps them: rows of { output: dB }, a silent crosspoint left out, empty rows at
 *  the end dropped. Returns null when nothing is sent anywhere (the cue plays on its bus's pair). Throws on what
 *  is not a matrix at all. */
function cleanMatrix(value: unknown): MatrixRow[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) throw new Error('outputs: a list with one entry per channel of the sound, each { output: dB }');
  const rows: MatrixRow[] = [];
  for (const raw of value.slice(0, MAX_ROWS)) {
    const row: MatrixRow = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const k of Object.keys(raw).map(Number).filter((o) => Number.isInteger(o) && o >= 1 && o <= MAX_OUT).sort((a, b) => a - b)) {
        const db = Number(raw[k]);
        if (raw[k] === null || raw[k] === '' || !Number.isFinite(db) || db <= SILENT_DB) continue;
        row[k] = r1(Math.min(12, db));
      }
    } else if (raw != null) throw new Error('outputs: each channel is { output: dB }, as in { "3": 0 }');
    rows.push(row);
  }
  while (rows.length && !Object.keys(rows[rows.length - 1]).length) rows.pop();
  return rows.length ? rows : null;
}

/** The outputs a matrix sends to, in order: [3, 4]. */
function outputsOf(matrix: MatrixRow[] | null | undefined) {
  const seen = new Set<number>();
  for (const row of matrix || []) for (const k of Object.keys(row || {})) seen.add(Number(k));
  return [...seen].sort((a, b) => a - b);
}

/** A matrix that plays channel 1 on `first`, channel 2 on the next, and so on: the plain way to send a sound to
 *  outputs of its own. `channels` 1 with `both`: the one channel on both outputs of the pair. */
function straight(first: number, channels = 2, both = false): MatrixRow[] {
  const n = Math.max(1, Math.min(MAX_ROWS, Math.round(channels) || 1));
  if (n === 1 && both) return [{ [first]: 0, [first + 1]: 0 }];
  return Array.from({ length: n }, (_, i) => ({ [first + i]: 0 }));
}

/** A matrix in a few words, for a list or a tooltip: "outputs 3–4", "output 5", "outputs 1, 3, 6". */
function describe(matrix: MatrixRow[] | null | undefined) {
  const o = outputsOf(matrix);
  if (!o.length) return '';
  if (o.length === 1) return `output ${o[0]}`;
  const run = o.every((x, i) => i === 0 || x === o[i - 1] + 1);
  return `outputs ${run ? `${o[0]}–${o[o.length - 1]}` : o.join(', ')}`;
}

/** A cue's eq as the show keeps it (four bands now: core/audio/chain.js, which the sound window loads too). */
import { cleanEq } from './chain';

const FX_DEFAULTS = {
  reverb: { secs: 1.8, db: -6, out: 1 },                    // how long the room rings, the return's level, the pair it comes back on
  delay: { secs: 0.35, feedback: 0.35, db: -6, out: 1 },    // the time between repeats, how much of each comes round again
};
const pairOf = (out: unknown) => { const n = Math.round(Number(out)); return n > 1 && n <= MAX_OUT ? n - ((n + 1) % 2) : 1; };   // the first of the pair: 1, 3, 5…

/** The show's audio settings as the sound window is told them: every default filled in, every number made safe.
 *  { outs: { n: { name, trim } }, trims: { n: dB }, audition: 0 | first of a pair, fx, sends: { busId: { reverb, delay } } } */
function settingsOf(audio: RoutingSettings | null | undefined) {
  const a: RoutingSettings = audio || {};
  const outs: Record<number, { name?: string; trim?: number }> = {}, trims: Record<number, number> = {};
  for (const [k, v] of Object.entries(a.outs && typeof a.outs === 'object' ? a.outs : {})) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1 || n > MAX_OUT || !v || typeof v !== 'object') continue;
    const name = String(v.name || '').trim().slice(0, 40);
    const trim = Number.isFinite(Number(v.trim)) ? r1(clamp(Number(v.trim), SILENT_DB, 0)) : 0;
    if (name || trim < 0) outs[n] = { ...(name ? { name } : {}), ...(trim < 0 ? { trim } : {}) };
    if (trim < 0) trims[n] = trim;
  }
  const f: NonNullable<RoutingSettings['fx']> = a.fx && typeof a.fx === 'object' ? a.fx : {};
  const num = (v: unknown, d: number, lo: number, hi: number) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? clamp(Number(v), lo, hi) : d);
  const rv: FxSettings = f.reverb || {}, dl: FxSettings = f.delay || {};
  const fx = {
    reverb: { secs: num(rv.secs, FX_DEFAULTS.reverb.secs, 0.1, 10), db: num(rv.db, FX_DEFAULTS.reverb.db, SILENT_DB, 6), out: pairOf(rv.out) },
    delay: { secs: num(dl.secs, FX_DEFAULTS.delay.secs, 0.01, 4), feedback: num(dl.feedback, FX_DEFAULTS.delay.feedback, 0, 0.9), db: num(dl.db, FX_DEFAULTS.delay.db, SILENT_DB, 6), out: pairOf(dl.out) },
  };
  const sends: Record<string, { reverb?: number; delay?: number }> = {};
  for (const b of Array.isArray(a.buses) ? a.buses : []) {
    const s: { reverb?: number; delay?: number } = {};
    for (const k of ['reverb', 'delay'] as const) if (b && b[k] != null && Number.isFinite(Number(b[k])) && Number(b[k]) > SILENT_DB) s[k] = r1(Math.min(6, Number(b[k])));
    if (Object.keys(s).length) sends[b.id] = s;
  }
  const au = Math.round(Number(a.auditionOut));
  return { outs, trims, audition: au >= 1 && au <= MAX_OUT ? pairOf(au) : 0, fx, sends };
}

/** What an output is called: its name in the show, else its number. */
function outName(audio: RoutingSettings | null | undefined, n: number) {
  const o = ((audio || {}).outs || {})[n];
  return o && String(o.name || '').trim() ? String(o.name).trim() : String(n);
}

/** Every output the show sends something to besides its buses' pairs (cues with outputs of their own, the
 *  audition pair, the effects' returns), so the sound window can have them ready before the first GO. */
function outputsUsed(doc: ShowDoc) {
  const seen = new Set<number>();
  const walk = (cues: Cue[] | undefined) => { for (const c of cues || []) { for (const o of outputsOf(c.outputs)) seen.add(o); if (c.children) walk(c.children); } };
  for (const l of doc.lists || []) walk(l.cues);
  const s = settingsOf(doc.settings && doc.settings.audio);
  if (s.audition) { seen.add(s.audition); seen.add(s.audition + 1); }
  for (const k of ['reverb', 'delay'] as const) if (Object.values(s.sends).some((x) => x[k] != null)) { seen.add(s.fx[k].out); seen.add(s.fx[k].out + 1); }
  return [...seen].sort((a, b) => a - b);
}

/** What a device with `have` outputs cannot play of this show: [{ id (a cue) | null, level: 'warning', why }].
 *  Each of these is silent there, and said; none is moved. */
function lost(doc: ShowDoc, have: unknown) {
  const out: Lost[] = [];
  const n = Number(have) || 0;
  const top = Math.max(2, n - (n % 2));          // an output is there when its whole pair is
  const walk = (cues: Cue[] | undefined) => {
    for (const c of cues || []) {
      const gone = outputsOf(c.outputs).filter((o) => o > top);
      if (gone.length) out.push({ id: c.id, level: 'warning', why: `it is sent to output${gone.length === 1 ? '' : 's'} ${gone.join(', ')}, and this device has ${n}: it is silent there` });
      if (c.children) walk(c.children);
    }
  };
  for (const l of doc.lists || []) walk(l.cues);
  const s = settingsOf(doc.settings && doc.settings.audio);
  if (s.audition && s.audition + 1 > top) out.push({ id: null, level: 'warning', why: `Audition (V) is sent to outputs ${s.audition}–${s.audition + 1}, and this device has ${n}: an auditioned cue is silent` });
  for (const k of ['reverb', 'delay'] as const) if (Object.values(s.sends).some((x) => x[k] != null) && s.fx[k].out + 1 > top) out.push({ id: null, level: 'warning', why: `The ${k} comes back on outputs ${s.fx[k].out}–${s.fx[k].out + 1}, and this device has ${n}: it is silent` });
  return out;
}

/**
 * A QLab level matrix as a cue's outputs here. QLab's rows are the file's channels and its columns the cue
 * outputs, with row 0 and column 0 the masters: a crosspoint is heard at (its own level × its row's × its
 * column's), and the main level (row 0, column 0) is the cue's level, kept apart (the importer's `mainLevel`).
 * `gain` reads one entry as a linear gain. Returns { matrix, outputs } or null when the matrix is QLab's default
 * (channel 1 to output 1, channel 2 to output 2, everything at unity), which is what a bus's pair already does.
 */
function fromQlab(entries: Record<string, QlabLevel | null> | QlabLevel[] | null | undefined, { toDb, channels = 0 }: { toDb: (gain: number) => number; channels?: number }) {
  const inp = new Map<number, number>(), outp = new Map<number, number>(), cross: { row: number; column: number; g: number }[] = [];
  for (const e of Object.values(entries || {})) {
    if (!e || !Number.isInteger(e.row) || !Number.isInteger(e.column)) continue;
    const g = Number(e.initialLevel) * (e.trimLevel == null ? 1 : Number(e.trimLevel));
    if (e.row === 0 && e.column === 0) continue;
    if (e.row === 0) outp.set(e.column, g);
    else if (e.column === 0) inp.set(e.row, g);
    else cross.push({ row: e.row, column: e.column, g });
  }
  const rows: MatrixRow[] = [];
  for (const x of cross) {
    if (x.row > MAX_ROWS || x.column > MAX_OUT) continue;
    const g = x.g * (outp.has(x.column) ? outp.get(x.column)! : 1) * (inp.has(x.row) ? inp.get(x.row)! : 1);
    if (!(g > 0)) continue;
    const db = toDb(g);
    if (db <= SILENT_DB) continue;
    while (rows.length < x.row) rows.push({});
    rows[x.row - 1][x.column] = db;
  }
  // QLab writes a row for every channel a file could have (24 of them in QLab 4), each to the output of its own
  // number: rows past the file's last channel carry nothing, so they are not a routing
  // (when the file's channels are not known, the untouched rows after the second go: a row that was set stays)
  if (!(channels > 0)) while (rows.length > 2 && JSON.stringify(rows[rows.length - 1]) === `{"${rows.length}":0}`) rows.pop();
  const matrix = cleanMatrix(channels > 0 ? rows.slice(0, channels) : rows);
  if (!matrix) return null;
  const diagonal = matrix.every((row, i) => { const k = Object.keys(row); return k.length === 0 || (k.length === 1 && Number(k[0]) === i + 1 && row[k[0]] === 0); });
  // (how many channels the file has is not known for everything: an untouched diagonal is then QLab's default too)
  if (diagonal && channels <= 2) return null;
  // (one channel on both of 1–2 is what a bus does with a mono file, so that is plain too)
  const plain = (matrix.length <= 2 && matrix.every((row, i) => { const k = Object.keys(row); return k.length === 0 || (k.length === 1 && Number(k[0]) === i + 1 && row[k[0]] === 0); }))
    || (matrix.length === 1 && JSON.stringify(matrix[0]) === '{"1":0,"2":0}');
  return plain ? null : { matrix, outputs: outputsOf(matrix) };
}

/** How many channels a WAV file has (its header says), or 0 for anything this cannot tell. */
function wavChannels(file: string) {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(12);
    if (fs.readSync(fd, head, 0, 12, 0) < 12 || !['RIFF', 'RF64'].includes(head.toString('latin1', 0, 4)) || head.toString('latin1', 8, 12) !== 'WAVE') return 0;
    const ch = Buffer.alloc(8), size = fs.fstatSync(fd).size;
    for (let pos = 12, n = 0; pos + 8 <= size && n < 64; n++) {
      fs.readSync(fd, ch, 0, 8, pos);
      const len = ch.readUInt32LE(4);
      if (ch.toString('latin1', 0, 4) === 'fmt ') { const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, pos + 8); return b.readUInt16LE(2); }
      if (ch.toString('latin1', 0, 4) === 'data') return 0;
      pos += 8 + len + (len % 2);
    }
    return 0;
  } catch { return 0; } finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* closed */ } } }
}

/**
 * Audition (V) to outputs of its own: which cues the next sounds belong to an audition. V marks the cue and
 * everything under it; a sound starting from a marked cue plays to the audition pair. Any other way of starting
 * a cue (GO, a start, a launch, Panic) clears the marks first, and a mark does not outlive the longest pre-wait
 * under the cue it was made for: a sound the operator did not ask to hear alone must never be kept from the house.
 */
class Audition {
  declare now: () => number;
  declare marks: Map<string, number>;
  constructor(now = () => Date.now()) { this.now = now; this.marks = new Map(); }
  /** `cue`: the engine's cue (with its children). */
  mark(cue: AuditionCue) {
    this.marks.clear();
    let longest = 0;
    const ids: string[] = [];
    const walk = (c: AuditionCue, wait: number) => { const w = wait + (Number(c.preWait) || 0); longest = Math.max(longest, w); ids.push(c.id); for (const k of c.children || []) walk(k, w); };
    walk(cue, 0);
    const until = this.now() + (longest + 2) * 1000;
    for (const id of ids) this.marks.set(id, until);
  }
  clear() { this.marks.clear(); }
  /** Whether the sound now starting from this cue is an audition (asked once per start: the mark is spent). */
  take(id: string) {
    const until = this.marks.get(id);
    if (until === undefined) return false;
    this.marks.delete(id);
    return this.now() <= until;
  }
}

export { MAX_OUT, MAX_ROWS, FX_DEFAULTS, cleanMatrix, outputsOf, straight, describe, cleanEq, settingsOf, outName, outputsUsed, lost, fromQlab, wavChannels, pairOf, Audition };
