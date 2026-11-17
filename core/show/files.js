/**
 * Files a proposal may carry into the show folder: prop firmware and the guide for coding agents.
 *
 * A proposal is mostly a change to the show; it may also be a short list of text files, written when a
 * person accepts it (core/show/document.js). What may be written is narrow on purpose, and decided here and
 * nowhere else:
 *
 *   AGENTS.md and CLAUDE.md at the top of the show folder, and anything under props/
 *   text only, at most 200 KB a file and 24 files in a proposal
 *   never a path that leaves the folder (by "..", by an absolute path, or through a link that points out of it)
 *   never the show's own files, and never over an existing secrets.h (that file is the person's: it holds a password)
 *
 *   check(showDir, files)   → { ok: true, files: [{ path, text, lines, bytes, replaces }], kept: [path] }  or  { ok: false, why }
 *   write(showDir, files)   → the paths written (each atomically: a temporary file, then a rename)
 *
 * `replaces` is true when a different file is already there. `kept` lists what was left out because it must
 * never be overwritten. Undo takes back a change to the show and leaves the files; the review says so.
 */
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 200 * 1024;
const MAX_FILES = 24;
const TOP = ['AGENTS.md', 'CLAUDE.md'];
const NO_FOLDER = 'Save the show to a folder first: this writes files into it.';

/** Whether `abs` is inside `root` once every link on the way has been followed (what is not there yet is taken from its nearest folder that is). */
function inside(root, abs) {
  let real;
  try { real = fs.realpathSync(root); } catch { return false; }
  let at = abs, rest = [];
  for (;;) {
    try { const r = fs.realpathSync(at); const full = path.join(r, ...rest); const rel = path.relative(real, full); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }
    catch { const up = path.dirname(at); if (up === at) return false; rest = [path.basename(at), ...rest]; at = up; }
  }
}

function check(showDir, files) {
  if (!showDir) return { ok: false, why: NO_FOLDER };
  if (!Array.isArray(files) || !files.length) return { ok: false, why: 'no files to write' };
  if (files.length > MAX_FILES) return { ok: false, why: `a proposal carries at most ${MAX_FILES} files (this has ${files.length})` };
  const out = [], kept = [], seen = new Set();
  for (const f of files) {
    if (!f || typeof f !== 'object' || typeof f.path !== 'string' || typeof f.text !== 'string') return { ok: false, why: 'a file is { "path": …, "text": … }' };
    const p = f.path;
    if (!p || p.includes('\\') || p.includes('\0') || path.isAbsolute(p) || /^[a-zA-Z]:/.test(p)) return { ok: false, why: `${JSON.stringify(p)} is not a path inside the show folder (written with /, and not starting from the top of the disk)` };
    const parts = p.split('/');
    if (parts.some((s) => s === '' || s === '.' || s === '..')) return { ok: false, why: `${p} leaves the show folder, or is not a plain path: files are written only inside it` };
    if (!(TOP.includes(p) || (parts[0] === 'props' && parts.length > 1))) return { ok: false, why: `${p} may not be written: only ${TOP.join(' and ')} at the top of the show folder, and files under props/` };
    if (seen.has(p.toLowerCase())) return { ok: false, why: `${p} is in the list twice` };
    seen.add(p.toLowerCase());
    const bytes = Buffer.byteLength(f.text, 'utf8');
    if (bytes > MAX_BYTES) return { ok: false, why: `${p} is too big (${Math.round(bytes / 1024)} KB; at most ${MAX_BYTES / 1024} KB a file)` };
    if (f.text.includes('\0')) return { ok: false, why: `${p} is not text` };
    const abs = path.join(showDir, ...parts);
    if (!inside(showDir, abs)) return { ok: false, why: `${p} would be written outside the show folder (a link in it points elsewhere)` };
    let was = null;
    try { const st = fs.statSync(abs); if (st.isDirectory()) return { ok: false, why: `${p} is a folder` }; was = fs.readFileSync(abs, 'utf8'); } catch { /* not there */ }
    // the person's Wi-Fi password lives in secrets.h: once it exists it is theirs, and nothing here replaces it
    if (was !== null && parts[parts.length - 1] === 'secrets.h') { kept.push(p); continue; }
    out.push({ path: p, text: f.text, lines: f.text ? f.text.replace(/\n$/, '').split('\n').length : 0, bytes, replaces: was !== null && was !== f.text });
  }
  if (!out.length) return { ok: false, why: 'every one of these files is already there and is kept as it is' };
  return { ok: true, files: out, kept };
}

/** Write checked files. Throws (and writes nothing more) on the first that cannot be written. */
function write(showDir, files) {
  const r = check(showDir, files);
  if (!r.ok) throw new Error(r.why);
  const written = [];
  for (const f of r.files) {
    const abs = path.join(showDir, ...f.path.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, f.text);
    fs.renameSync(tmp, abs);
    written.push(f.path);
  }
  return written;
}

module.exports = { check, write, MAX_BYTES, MAX_FILES, NO_FOLDER };
