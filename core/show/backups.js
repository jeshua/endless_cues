/**
 * Timed backups of the show as it is being worked on.
 *
 *   MyShow.ecshow/backups/
 *     2026-03-14 19.05.09.json     the whole working document at that moment
 *
 * A version (versions.js) is a save made on purpose; the journal beside the show
 * holds only the latest unsaved state. A backup is the third thing: a copy of the
 * working document, unsaved changes and all, taken every few minutes while it is
 * changing, so "what did this look like twenty minutes ago, before I saved over
 * it" has an answer. Going back to one is an edit like any other (undoable, not
 * kept until saved), never a rewrite of the show file.
 *
 * Whole documents as plain files, named by the local time they were taken, for
 * the reasons versions are: a person can read one, and it needs no tool. Pruned
 * as they are written: the newest `keep`, and beyond those the last of each day
 * for two weeks.
 */
const fs = require('fs');
const path = require('path');
const show = require('./show');
const { atomicWrite } = require('./versions');

const KEEP = 30;
const DAYS = 14;
const NAME = /^(\d{4}-\d{2}-\d{2}) (\d{2})\.(\d{2})\.(\d{2})\.json$/;

const dirOf = (showDir) => path.join(showDir, 'backups');
const p2 = (n) => String(n).padStart(2, '0');
const nameAt = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}.json`; };

/** The backups in a folder, newest first: [{ name, file, day, time, bytes }]. */
function list(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => NAME.test(n)).sort().reverse().map((name) => {
    const m = NAME.exec(name), file = path.join(dir, name);
    let bytes = 0; try { bytes = fs.statSync(file).size; } catch { /* gone meanwhile */ }
    return { name, file, day: m[1], time: `${m[2]}:${m[3]}:${m[4]}`, bytes };
  });
}

/** Which of the backups (newest first) are let go: all but the newest `keep`, and of the older ones all but the last of each of the next `days` days. */
function surplus(all, { keep = KEEP, days = DAYS } = {}) {
  const out = [], seen = new Set();
  for (const b of all.slice(Math.max(1, keep))) {
    if (seen.has(b.day) || seen.size >= days) out.push(b); else seen.add(b.day);
  }
  return out;
}

/**
 * Take a backup of `doc` into `dir`. Returns its entry, or null when the newest backup is already this document
 * (a show left open and untouched all night makes one backup, not a hundred).
 */
function write(dir, doc, { now = Date.now(), keep = KEEP } = {}) {
  const text = show.stringify(doc);
  const all = list(dir);
  if (all[0]) { try { if (fs.readFileSync(all[0].file, 'utf8') === text) return null; } catch { /* unreadable: take a new one */ } }
  fs.mkdirSync(dir, { recursive: true });
  let at = now, name = nameAt(at);
  while (fs.existsSync(path.join(dir, name))) name = nameAt(at += 1000);      // (two in one second: the clock's next)
  atomicWrite(path.join(dir, name), text);
  for (const b of surplus(list(dir), { keep })) { try { fs.unlinkSync(b.file); } catch { /* another time */ } }
  return list(dir).find((b) => b.name === name) || null;
}

/** A backup, as a document this app can open. `name` is a file in `dir`, never a path. */
function read(dir, name) {
  if (!NAME.test(String(name))) throw new Error(`no backup ${name}`);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { throw new Error(`the backup ${name} cannot be read`); }
  return show.normalise(raw).doc;
}

module.exports = { KEEP, DAYS, dirOf, list, surplus, write, read };
