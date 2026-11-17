/**
 * Saved versions of a show, kept beside it.
 *
 *   MyShow.ecshow/versions/
 *     index.json          [{ id, at, note, author, hash, cues }]  oldest first
 *     <hash>.json         the whole document as it was (content-addressed: the
 *                         same document saved twice is stored once)
 *
 * Nothing is written to show.json until Save, and every Save records a version:
 * a checkpoint you can go back to. Restoring one is itself an edit (and
 * undoable), never a rewrite of history.
 *
 * Whole snapshots, not deltas: a show file is tens of kilobytes, a thousand
 * versions is a few megabytes, and any version can be read by a person, or by
 * git, with no tool. The store is plain files so it works offline, syncs with
 * anything that syncs folders, and a cloud history (a paid feature) can be
 * layered on by uploading the same blobs.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as show from './show';
import type { ShowDoc } from './types';

/** A saved version, as the index lists it. */
export interface VersionEntry { id: string; at: string; note: string; author: string; hash: string; cues: number }

const dirOf = (showDir: string) => path.join(showDir, 'versions');
const indexPath = (showDir: string) => path.join(dirOf(showDir), 'index.json');

function atomicWrite(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function list(showDir: string): VersionEntry[] {
  try {
    const all = JSON.parse(fs.readFileSync(indexPath(showDir), 'utf8'));
    return Array.isArray(all) ? all : [];
  } catch { return []; }
}

function countCues(doc: ShowDoc) { let n = 0; show.walk(doc, () => { n++; }); return n; }

/** Save `doc` as a version. Returns the entry; `same: true` when the newest version is already this document. */
function save(showDir: string, doc: ShowDoc, { note = '', author = 'you', now = Date.now() }: { note?: string; author?: string; now?: number } = {}): VersionEntry & { same?: boolean } {
  fs.mkdirSync(dirOf(showDir), { recursive: true });
  const all = list(showDir);
  const hash = show.hash(doc);
  const last = all[all.length - 1];
  if (last && last.hash === hash) return { ...last, same: true };
  const blob = path.join(dirOf(showDir), `${hash}.json`);
  if (!fs.existsSync(blob)) atomicWrite(blob, show.stringify(doc));
  const entry: VersionEntry = { id: `v${all.length + 1}`, at: new Date(now).toISOString(), note: String(note || '').slice(0, 300), author, hash, cues: countCues(doc) };
  all.push(entry);
  atomicWrite(indexPath(showDir), JSON.stringify(all, null, 2) + '\n');
  return entry;
}

function read(showDir: string, id: string): { entry: VersionEntry; doc: ShowDoc } {
  const entry = list(showDir).find((v) => v.id === id || v.hash === id);
  if (!entry) throw new Error(`no version ${id}`);
  const raw = JSON.parse(fs.readFileSync(path.join(dirOf(showDir), `${entry.hash}.json`), 'utf8'));
  return { entry, doc: show.normalise(raw).doc };
}

export { list, save, read, atomicWrite };
