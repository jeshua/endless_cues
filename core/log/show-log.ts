/**
 * The show log: what happened while the show ran, one line each, written beside the show.
 *
 *   MyShow.ecshow/logs/
 *     2026-11-16 19-30-02.log    every GO and what it started, each cue starting, stopping and fading and what set
 *                                it off, the GOs that were ignored, problems, mode changes, saves (one file per sitting)
 *     2026-11-16 19-30-02.csv    the same, as a table
 *     playback.csv               what sound played and for how long (core/engine/playlog.ts), as before
 *
 * Logging must never hold up a GO: `add` only puts the line in memory; the lines are written together a moment
 * later, without waiting (fs.promises), and a log that cannot be written is given up quietly (the show goes on).
 * A file that grows past `maxBytes` is continued in a new one; only the newest `keep` sittings are kept.
 *
 * Nothing secret goes in: anything that looks like a key, a token or a password is written as <key>.
 *
 *   const log = new ShowLog({ version })
 *   log.open(dir, title)       a new sitting: its file is made with the first line (dir null: kept in memory only)
 *   log.add(kind, text, more)  kind: go | cue | trigger | ignored | warning | error | show. more: { cue } (its number)
 *   log.since(n)               the lines after line n (the Log view follows with it)
 *   log.flush()                write what is waiting now (a promise); closing the app calls it
 */
import { promises as fsp } from 'fs';
import * as path from 'path';

const KINDS = ['go', 'cue', 'trigger', 'ignored', 'warning', 'error', 'show'] as const;
export type LogKind = typeof KINDS[number];
const LABEL: Record<LogKind, string> = { go: 'GO', cue: 'cue', trigger: 'trigger', ignored: 'ignored', warning: 'warning', error: 'ERROR', show: 'show' };
const FILE = /^\d{4}-\d\d-\d\d \d\d-\d\d-\d\d(?: \d+)?\.(log|csv)$/;

const p2 = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
const clockOf = (ms: number) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`; };
const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** A line with anything that could be a secret taken out: keys and tokens, passwords and passcodes. */
function clean(text: unknown) {
  return String(text == null ? '' : text).replace(/[\r\n]+/g, ' ')
    .replace(/\bBearer\s+\S+/gi, 'Bearer <key>')
    .replace(/\b(?:ec[lscd]_|sk-|sk_|xox[abprs]-|ghp_|gho_|AKIA)[A-Za-z0-9_-]{6,}/g, '<key>')
    .replace(/\b(pass(?:word|code)?|token|secret|api[_-]?key)(\s*[=:]\s*)("[^"]*"|\S+)/gi, (_m, k, sep) => `${k}${sep}<key>`)
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '<key>');
}

/** One line of the log. */
export interface LogEntry { n: number; at: number; kind: LogKind; text: string; cue?: string }
/** The file calls the log makes (fs.promises, or a stand-in in the tests). */
export type LogFs = Pick<typeof fsp, 'mkdir' | 'appendFile' | 'readdir' | 'unlink'>;
export interface ShowLogOptions {
  now?: () => number; version?: string; keep?: number; maxBytes?: number; max?: number; flushMs?: number;
  fs?: LogFs; timer?: (fn: () => void, ms: number) => { unref?(): unknown } | undefined;
}

class ShowLog {
  declare now: () => number;
  declare version: string;
  declare keep: number;
  declare maxBytes: number;
  declare max: number;
  declare flushMs: number;
  declare fs: LogFs;
  declare timer: NonNullable<ShowLogOptions['timer']>;
  lines: LogEntry[];
  n: number;
  dir: string | null;
  file: string | null;
  part: number;
  bytes: number;
  waiting: LogEntry[];
  flushing: Promise<void> | null;
  scheduled: boolean;

  constructor({ now = () => Date.now(), version = '', keep = 20, maxBytes = 2 * 1024 * 1024, max = 3000, flushMs = 250, fs = fsp, timer = setTimeout }: ShowLogOptions = {}) {
    Object.assign(this, { now, version, keep, maxBytes, max, flushMs, fs, timer });
    this.lines = [];                // the newest `max` entries: { n, at, kind, text, cue }
    this.n = 0;
    this.dir = null;
    this.file = null;               // the sitting's file, less its extension
    this.part = 1;
    this.bytes = 0;
    this.waiting = [];              // entries not yet written
    this.flushing = null;
    this.scheduled = false;
  }

  /** A new sitting, in `dir` (the show's logs folder; null: in memory only). */
  open(dir: string | null | undefined, title = '') {
    this.flush();
    this.dir = dir || null;
    this.part = 1; this.bytes = 0;
    this.file = this.dir ? path.join(this.dir, stamp(new Date(this.now()))) : null;
    this.add('show', `opened “${title || 'Untitled'}”${this.version ? ` · Endless Cues ${this.version}` : ''}`);
    if (this.dir) this.prune();
  }

  add(kind: string, text: unknown, more: { cue?: string | number | null } = {}): LogEntry {
    if (!(KINDS as readonly string[]).includes(kind)) kind = 'show';
    const e: LogEntry = { n: ++this.n, at: this.now(), kind: kind as LogKind, text: clean(text) };
    if (more.cue != null && more.cue !== '') e.cue = String(more.cue);
    this.lines.push(e);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
    if (this.file) { this.waiting.push(e); this.schedule(); }
    return e;
  }

  /** The lines after `n` (0: all that are kept), at most `limit`, newest last. */
  since(n = 0, limit = this.max) {
    const out = this.lines.filter((e) => e.n > n);
    return out.slice(-limit);
  }
  tail(count = 200) { return this.lines.slice(-count); }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    const t = this.timer(() => { this.scheduled = false; this.flush(); }, this.flushMs);
    if (t && t.unref) t.unref();
  }

  /** Write what is waiting (one append to each file). A failure is given up: the lines stay in memory. */
  flush() {
    const b = this.take();
    if (!b) return this.flushing || Promise.resolve();
    const write = async () => {
      await this.fs.mkdir(path.dirname(b.file), { recursive: true });
      await this.fs.appendFile(`${b.file}.log`, b.text);
      await this.fs.appendFile(`${b.file}.csv`, b.csv);
    };
    const run = (this.flushing || Promise.resolve()).then(write).catch(() => { /* a log that cannot be written must not stop the show */ });
    this.flushing = run;
    run.then(() => { if (this.flushing === run) this.flushing = null; });
    return run;
  }
  /** The same, now, as the app closes (nothing is playing by then). */
  flushSync() {
    const b = this.take();
    if (!b) return;
    const fs = require('fs');
    try { fs.mkdirSync(path.dirname(b.file), { recursive: true }); fs.appendFileSync(`${b.file}.log`, b.text); fs.appendFileSync(`${b.file}.csv`, b.csv); } catch { /* given up */ }
  }
  /** What is waiting, as the text to append to each file; the next file is begun when this one is full. */
  take() {
    if (!this.file || !this.waiting.length) return null;
    const batch = this.waiting; this.waiting = [];
    const file = this.file, first = this.bytes === 0;
    const lines = batch.map(lineOf).join('\n') + '\n';
    const text = (first ? `# Endless Cues show log${this.version ? ` · ${this.version}` : ''}\n` : '') + lines;
    const csv = (first ? 'time,kind,cue,what\n' : '') + batch.map(csvOf).join('\n') + '\n';
    this.bytes += Buffer.byteLength(lines);
    if (this.bytes > this.maxBytes) { this.part++; this.bytes = 0; this.file = `${this.file.replace(/ \d+$/, '')} ${this.part}`; }
    return { file, text, csv };
  }

  /** Only the newest `keep` sittings stay in the folder (playback.csv and anything else in it are left alone). */
  async prune() {
    try {
      const dir = this.dir as string;
      const names = (await this.fs.readdir(dir)).filter((f) => FILE.test(f));
      const sittings = [...new Set(names.map((f) => f.replace(/(?: \d+)?\.(log|csv)$/, '')))].sort();
      const old = new Set(sittings.slice(0, Math.max(0, sittings.length - this.keep)));
      for (const f of names) if (old.has(f.replace(/(?: \d+)?\.(log|csv)$/, ''))) await this.fs.unlink(path.join(dir, f)).catch(() => {});
    } catch { /* no folder yet */ }
  }
}

function lineOf(e: LogEntry) { return `${clockOf(e.at)}  ${LABEL[e.kind].padEnd(8)}${e.text}`; }
function csvOf(e: LogEntry) { return [new Date(e.at).toISOString(), e.kind, e.cue || '', e.text].map(cell).join(','); }

/**
 * The lines as they go with a problem report: the time, the kind and the words, with every cue's name and every
 * file's name taken out (`names`: the show's cue names and sound files). A report carries no names
 * (docs/specs/17-service-protocol.md), so a cue is left as its number.
 */
function bareLines(entries: LogEntry[], names: unknown[] = []) {
  const known = [...new Set(names.map((x) => String(x || '').trim()).filter((x) => x.length >= 2))].sort((a, b) => b.length - a.length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = known.length ? new RegExp(known.map(esc).join('|'), 'g') : null;
  return entries.map((e) => {
    let t = e.text.replace(/\(([^()]*[\\/])?[^()\\/]+\.(wav|aiff?|aifc|caf|mp3|m4a|aac|flac|ogg|opus|mp4|mov|m4v|webm|png|jpe?g|gif|mid|midi)\)/gi, '(a file)');
    if (re) t = t.replace(re, '…');
    return `${clockOf(e.at)} ${e.kind} ${t}`.slice(0, 300);
  });
}

export { ShowLog, KINDS, clean, bareLines, lineOf };
