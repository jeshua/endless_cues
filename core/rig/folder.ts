/**
 * The show folder, read: what files are in it, and the text of a text file.
 *
 *   listing(showDir, doc, { durations })   every file under the folder (two levels deep), except the show's own:
 *                                          [{ path, kind, bytes, secs?, usedBy: [cue refs] }]
 *   readText(showDir, rel, { from, lines }) → { ok, why, text, from, to, total }     at most 400 lines a call
 *   counts(listing)                        → { sounds, videos, texts, unused }       for the Rig and the assistant's first line
 *
 * Reading only, and only inside the show folder: a path that leaves it, a link that points out of it, the show's
 * own files, anything that is not text and anything over 2 MB are refused with a sentence. A .docx is read as
 * its paragraphs (it is a zip; zlib and a few lines here, no dependency). Nothing here writes.
 *
 * Plain node. `showDir: null` (an untitled show) has no folder: an empty listing, and a sentence from readText.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as show from '../show/show';
import { mediaKind } from '../video/stage';
import { wavInfo } from '../engine/waveform';
import type { ShowDoc } from '../show/types';

/** A file of the show folder, as `listing` gives it. */
export interface FolderEntry { path: string; kind: string; bytes: number; secs?: number; usedBy: string[] }
/** A text file's lines, or why not. */
export type ReadAll = { ok: true; lines: string[] } | { ok: false; why: string };

const SOUND = /\.(wav|aiff?|aifc|caf|mp3|m4a|aac|flac|ogg|opus)$/i;
const MIDI = /\.(mid|midi|smf)$/i;
const TEXT = ['.txt', '.md', '.markdown', '.fountain', '.csv', '.json', '.ino', '.h', '.cpp', '.toml', '.yaml', '.docx'];
// the show's own: never listed, never read (the show is read with the show's tools, and the rest is the app's)
const OWN_FILES = ['show.json', 'show.unsaved.json'];
const OWN_DIRS = ['versions', 'backups', 'logs', 'recordings'];
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_LINES = 400;
const MAX_ENTRIES = 2000;
const NO_FOLDER = 'This show is not in a folder yet.';

const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
function kindOf(name: string): string {
  if (SOUND.test(name)) return 'sound';
  if (MIDI.test(name)) return 'midi';
  const m = mediaKind(name);
  if (m) return m;
  return TEXT.includes(path.extname(name).toLowerCase()) ? 'text' : 'other';
}

/** Every file under the show folder (`depth` folders down), in the order a person would read their names. */
function listing(showDir: string | null | undefined, doc: Pick<ShowDoc, 'lists'> | null = null, { durations = {}, depth = 2, under = '' }: { durations?: Record<string, unknown>; depth?: number; under?: string } = {}): FolderEntry[] {
  if (!showDir) return [];
  // which cues use which file: a cue names a file relative to the folder (media/rain.wav) or by its whole path
  const usedBy = new Map<string, string[]>();
  if (doc) show.walk(doc, (c) => {
    if (!c.file) return;
    const f = String(c.file).split('\\').join('/');
    const rel = path.isAbsolute(c.file) ? path.relative(showDir!, c.file).split(path.sep).join('/') : f;
    const list = usedBy.get(rel) || []; list.push(c.number ? `#${c.number}` : c.id); usedBy.set(rel, list);
  });
  const out: FolderEntry[] = [];
  const start = String(under || '').split('/').filter((s) => s && s !== '.' && s !== '..');
  const go = (parts: string[], left: number) => {
    let names: fs.Dirent[] = [];
    try { names = fs.readdirSync(path.join(showDir!, ...parts), { withFileTypes: true }); } catch { return; }
    names.sort((a, b) => natural(a.name, b.name));
    const dirs: string[] = [];
    for (const d of names) {
      if (out.length >= MAX_ENTRIES) return;
      if (d.name.startsWith('.') || d.name === 'node_modules') continue;
      const rel = [...parts, d.name].join('/');
      if (d.isSymbolicLink()) continue;                  // a link may point anywhere: what is listed is what is in the folder
      if (d.isDirectory()) { if (!(parts.length === 0 && OWN_DIRS.includes(d.name)) && left > 0) dirs.push(d.name); continue; }
      if (!d.isFile() || (parts.length === 0 && OWN_FILES.includes(d.name)) || /\.tmp$/.test(d.name)) continue;
      const abs = path.join(showDir!, ...parts, d.name);
      let bytes = 0; try { bytes = fs.statSync(abs).size; } catch { continue; }
      const kind = kindOf(d.name);
      const e: FolderEntry = { path: rel, kind, bytes, usedBy: usedBy.get(rel) || [] };
      if (kind === 'sound' || kind === 'video') { const secs = Number(durations[rel]) > 0 ? Number(durations[rel]) : /\.wav$/i.test(d.name) ? (wavInfo(abs) || {}).seconds : undefined; if ((secs as number) > 0) e.secs = Math.round((secs as number) * 100) / 100; }
      out.push(e);
    }
    for (const name of dirs) go([...parts, name], left - 1);
  };
  // the folder asked about is reached through no link either (a link, or a junction on Windows, may point anywhere)
  for (let i = 1; i <= start.length; i++) {
    try { if (fs.lstatSync(path.join(showDir, ...start.slice(0, i))).isSymbolicLink()) return []; } catch { return []; }
  }
  go(start, depth);
  return out;
}

/** How many of what, for one line: { sounds, videos, texts, unused } (unused: sounds and videos no cue uses). */
function counts(list: FolderEntry[]) {
  const n = (k: string) => list.filter((e) => e.kind === k).length;
  return { sounds: n('sound'), videos: n('video'), texts: n('text'), unused: list.filter((e) => (e.kind === 'sound' || e.kind === 'video') && !e.usedBy.length).length };
}

// ── a .docx is a zip holding word/document.xml: its paragraphs, as lines ──
function unzipOne(buf: Buffer, name: string): Buffer {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('not a zip');
  let at = buf.readUInt32LE(end + 16);
  for (let n = buf.readUInt16LE(end + 10); n > 0 && at + 46 <= buf.length; n--) {
    if (buf.readUInt32LE(at) !== 0x02014b50) break;
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20), nameLen = buf.readUInt16LE(at + 28), extra = buf.readUInt16LE(at + 30), comment = buf.readUInt16LE(at + 32), local = buf.readUInt32LE(at + 42);
    if (buf.toString('utf8', at + 46, at + 46 + nameLen) === name) {
      const from = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(from, from + size);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: 16 * MAX_BYTES });
      throw new Error('compressed in a way this cannot read');
    }
    at += 46 + nameLen + extra + comment;
  }
  throw new Error('no document in it');
}
function docxLines(buf: Buffer): string[] {
  const xml = unzipOne(buf, 'word/document.xml').toString('utf8');
  const entity = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
  const lines: string[] = [];
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) || []) {
    let text = '';
    for (const m of p.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g)) text += m[1] !== undefined ? entity(m[1]) : m[0] === '<w:tab/>' ? '\t' : '\n';
    lines.push(...text.split('\n'));
  }
  return lines;
}

/** Every line of a text file in the show folder: { ok, lines: [text] } or { ok: false, why }. */
function readAll(showDir: string | null | undefined, rel: unknown): ReadAll {
  if (!showDir) return { ok: false, why: NO_FOLDER };
  const p = String(rel || '').split('\\').join('/').replace(/^\.\//, '');
  if (!p) return { ok: false, why: 'Which file? Give its path in the show folder.' };
  const parts = p.split('/');
  if (path.isAbsolute(p) || /^[a-zA-Z]:/.test(p) || parts.some((s) => s === '..' || s === '')) return { ok: false, why: `${rel} is outside the show folder: only files inside it can be read.` };
  if (parts.length === 1 && OWN_FILES.includes(parts[0])) return { ok: false, why: `${p} is the show itself: it is read with the show’s own tools, not as a file.` };
  if (OWN_DIRS.includes(parts[0])) return { ok: false, why: `${parts[0]}/ is the app’s own (versions, backups, logs, recordings): it is not read as files.` };
  const abs = path.join(showDir, ...parts);
  let real: string, root: string;
  try { root = fs.realpathSync(showDir); real = fs.realpathSync(abs); } catch { return { ok: false, why: `There is no file ${p} in the show folder.` }; }
  const out = path.relative(root, real);
  if (out.startsWith('..') || path.isAbsolute(out)) return { ok: false, why: `${p} is a link that points out of the show folder: it is not read.` };
  let st; try { st = fs.statSync(real); } catch { return { ok: false, why: `There is no file ${p} in the show folder.` }; }
  if (st.isDirectory()) return { ok: false, why: `${p} is a folder: list it instead.` };
  const ext = path.extname(p).toLowerCase();
  if (ext === '.pdf') return { ok: false, why: `${p} is a PDF, which cannot be read here. Export it as text or .docx and put that in the folder.` };
  if (!TEXT.includes(ext)) return { ok: false, why: `${p} is not a text file this reads (it reads ${TEXT.join(', ')}).` };
  if (st.size > MAX_BYTES) return { ok: false, why: `${p} is too big to read (${(st.size / 1048576).toFixed(1)} MB; at most 2 MB).` };
  try {
    if (ext === '.docx') return { ok: true, lines: docxLines(fs.readFileSync(real)) };
    const text = fs.readFileSync(real, 'utf8').replace(/^\uFEFF/, '');
    if (text.includes('\0')) return { ok: false, why: `${p} is not text.` };
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return { ok: true, lines };
  } catch (err) { return { ok: false, why: `${p} could not be read: ${(err as Error).message}.` }; }
}

/** Some lines of a text file: `from` counted from 1, at most 400 a call. `to` is the last line given; `total` how many there are. */
function readText(showDir: string | null | undefined, rel: unknown, { from = 1, lines = MAX_LINES }: { from?: unknown; lines?: unknown } = {}) {
  const r = readAll(showDir, rel);
  if (!r.ok) return { ok: false, why: r.why, text: '', from: 0, to: 0, total: 0 };
  const total = r.lines.length;
  const a = Math.max(1, Math.round(Number(from)) || 1), n = Math.max(1, Math.min(MAX_LINES, Math.round(Number(lines)) || MAX_LINES));
  const part = r.lines.slice(a - 1, a - 1 + n);
  return { ok: true, why: '', text: part.join('\n'), from: part.length ? a : 0, to: part.length ? a + part.length - 1 : 0, total };
}

export { listing, counts, readText, readAll, kindOf, natural, TEXT, OWN_FILES, OWN_DIRS, MAX_BYTES, MAX_LINES, NO_FOLDER };
