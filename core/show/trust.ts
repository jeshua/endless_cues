/**
 * Whether a show is this computer's own: made or last saved here, or turned on here by a person.
 *
 * A show from somewhere else (a download, a USB stick, a shared folder) opens with its network features held
 * back: no module started (OSC control, the web remote, the lighting desk, the backup link), no listening
 * port, no outgoing connection or message, no device asked whether it is there, and no trigger from a
 * clock, OSC, MIDI or timecode. Its sounds on another computer's share (\\host\share, //host/share) are not
 * opened either. One click (Turn on) gives it all back, and is remembered for that show on this computer.
 *
 * What is remembered is in this computer's config.json, never in the show: `shows`, a record of
 * { "<the show folder, as this computer finds it>": "<the show's id>" }. A show is this computer's when its
 * folder is in the record with its id. So a copy of a show moved or copied to another folder asks once again,
 * and a show put in place of one of yours (another id) is not taken for yours. Nothing is written into the
 * show file: a show is the same file whichever computer saved it.
 *
 * Plain node, no Electron: core/show/trust.js. docs/specs/03-show-file.md says it for the show file.
 */
import * as fs from 'fs';
import * as path from 'path';

/** This computer's record of its own shows: { "<show folder>": "<show id>" } (`true`: taken from its recent shows). */
export type TrustRecord = Record<string, string | true>;

const KEEP = 400;                   // the record keeps the last this many shows (the oldest go first)

/** The folder as a key: its real path (links resolved), and on Windows and macOS, where case does not matter, in one case. */
function keyOf(dir: unknown, platform: string = process.platform) {
  if (!dir) return '';
  let real = path.resolve(String(dir));
  try { real = fs.realpathSync.native(real); } catch { /* not there (yet): as given */ }
  real = real.replace(/[\\/]+$/, '');
  return platform === 'win32' || platform === 'darwin' ? real.toLowerCase() : real;
}

/** Whether the show `id` in folder `dir` is this computer's, by the record. */
function isMine(record: TrustRecord | null | undefined, dir: unknown, id: unknown, platform?: string) {
  const key = keyOf(dir, platform);
  if (!key || !record || typeof record !== 'object') return false;
  const had = Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
  // (`true`: a folder taken from the list of recent shows when the record was first made, whatever id it has)
  return had === true || (typeof had === 'string' && had === String(id || ''));
}

/** The record with this show in it (the newest last; the oldest dropped past KEEP). A new object: the old is not changed. */
function remember(record: TrustRecord | null | undefined, dir: unknown, id: unknown, platform?: string): TrustRecord {
  const key = keyOf(dir, platform);
  if (!key) return { ...(record || {}) };
  const out: TrustRecord = {};
  for (const [k, v] of Object.entries(record || {})) if (k !== key) out[k] = v;
  out[key] = String(id || '');
  const keys = Object.keys(out);
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete out[k];
  return out;
}

/** The first record, for a computer that had shows before there was one: its recent shows (and the last one open)
 *  are taken as its own, so nothing that was already working here is held back by an update. */
function firstRecord(config: { recent?: unknown; lastShow?: string | null } = {}, platform?: string): TrustRecord {
  const out: TrustRecord = {};
  for (const dir of [...(Array.isArray(config.recent) ? config.recent : []), config.lastShow]) if (dir) out[keyOf(dir, platform)] = true;
  return out;
}

/** A path that names another computer: \\host\share\…, //host/share/…, and Windows's \\?\ and \\.\ forms. */
const isRemote = (file: unknown) => /^[\\/]{2}/.test(String(file || ''));

export { keyOf, isMine, remember, firstRecord, isRemote, KEEP };
