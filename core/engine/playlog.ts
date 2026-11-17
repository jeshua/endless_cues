/**
 * The playback log: what sound played, when, and for how long.
 *
 * Licensing bodies ask a production for exactly this (which recordings were
 * used in each performance, and how many seconds of each), and nobody can
 * reconstruct it afterwards. So every sound that plays is noted as it ends:
 * when it started by the clock on the wall, which cue and file it was, and how
 * long it actually sounded (time spent paused is not counted; a sound stopped
 * early is logged for what was heard, not for its length).
 *
 * This is only the bookkeeping: the host tells it when a sound starts, pauses,
 * resumes and ends, and is handed each finished entry to write down. Plain
 * node, no clock of its own but the one it is given.
 */
const COLUMNS = ['date', 'started', 'cue', 'name', 'file', 'seconds', 'length', 'mode'];

class PlayLog {
  constructor({ now = () => Date.now(), onEntry = null, max = 2000 } = {}) {
    this.now = now;
    this.onEntry = onEntry;
    this.max = max;
    this.open = new Map();          // key -> { at, info, pausedAt, pausedFor }
    this.done = [];                 // finished entries, oldest first
  }

  /** A sound starts. `info`: { file, number, name, mode }. A key that is already playing is ended first (a retrigger is two plays). */
  started(key, info = {}) {
    if (this.open.has(key)) this.ended(key);
    this.open.set(key, { at: this.now(), info, pausedAt: null, pausedFor: 0 });
  }
  paused(key) { const o = this.open.get(key); if (o && o.pausedAt == null) o.pausedAt = this.now(); }
  resumed(key) { const o = this.open.get(key); if (o && o.pausedAt != null) { o.pausedFor += this.now() - o.pausedAt; o.pausedAt = null; } }

  /** A sound has ended (played out, stopped, faded out). Returns its entry, or null when it was not playing. */
  ended(key) {
    const o = this.open.get(key);
    if (!o) return null;
    this.open.delete(key);
    const end = o.pausedAt != null ? o.pausedAt : this.now();
    const secs = Math.max(0, Math.round((end - o.at - o.pausedFor) / 100) / 10);
    const entry = { at: new Date(o.at).toISOString(), startedMs: o.at, file: String(o.info.file || ''), number: String(o.info.number || ''), name: String(o.info.name || ''), secs, mode: o.info.mode || '' };
    this.done.push(entry);
    if (this.done.length > this.max) this.done.shift();
    if (this.onEntry) { try { this.onEntry(entry); } catch { /* a log that cannot be written must not stop the show */ } }
    return entry;
  }
  /** Everything stops at once (a hard panic, a reset, another show opened). */
  endAll() { for (const key of [...this.open.keys()]) this.ended(key); }

  entries() { return this.done.slice(); }
}

const p2 = (n) => String(n).padStart(2, '0');
const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** An entry as a line of CSV: the date and time are this computer's local ones, as a person would report them. */
function csvLine(e) {
  const d = new Date(e.startedMs != null ? e.startedMs : e.at);
  const m = Math.floor(e.secs / 60), s = Math.round(e.secs - m * 60);
  return [`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`,
          e.number, e.name, e.file, e.secs.toFixed(1), `${m}:${p2(s === 60 ? 59 : s)}`, e.mode].map(cell).join(',');
}
const CSV_HEAD = COLUMNS.join(',');
const toCsv = (entries) => [CSV_HEAD, ...entries.map(csvLine)].join('\n') + '\n';

export { PlayLog, COLUMNS, CSV_HEAD, csvLine, toCsv };
