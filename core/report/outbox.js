/**
 * The reports not sent yet: kept on disk until the service has them, so nothing a person wrote is lost to a dropped
 * connection, a busy service or a quit.
 *
 * One folder per report under `dir`, named by its submission id: `report.json` (the built fields and when it may be
 * tried again) and the pictures beside it. The service answers a second copy of the same client_id + submission_id
 * with the first one, so trying again is always safe.
 *
 * When it is tried (docs/specs/17-service-protocol.md section 2): when the person presses Send (that one, and every
 * one waiting), a little after the app opens, and after a held one at 30 s, 2 and 10 minutes, never sooner than a
 * `retry_after`, at most three times while the app is open. Nothing else: no loop, no telemetry.
 */
const fs = require('fs');
const path = require('path');
const { send: sendReport, retryDelay } = require('./report');

const SAFE = /^[A-Za-z0-9_.:-]{8,80}$/;
const folderOf = (id) => id.replace(/:/g, '_');     // (a colon is not allowed in a folder name on Windows)

function createOutbox({ dir, send = sendReport, sendOptions = () => ({}), now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, log = () => {}, told = () => {} }) {
  let timer = null;
  let autoTries = 0;                 // automatic tries since the app opened (at most three)
  let busy = null;

  function put(built, notBefore = 0) {
    const id = built.fields.submission_id;
    if (!SAFE.test(String(id || ''))) throw new Error('a report kept for later needs a submission id');
    const folder = path.join(dir, folderOf(id));
    fs.mkdirSync(folder, { recursive: true });
    for (const [k, bytes] of Object.entries(built.files || {})) fs.writeFileSync(path.join(folder, `${k}.webp`), bytes);
    const tmp = path.join(folder, 'report.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify({ fields: built.fields, files: Object.keys(built.files || {}), keptAt: new Date(now()).toISOString(), notBefore }, null, 2));
    fs.renameSync(tmp, path.join(folder, 'report.json'));
  }
  function read(name) {
    try {
      const folder = path.join(dir, name);
      const j = JSON.parse(fs.readFileSync(path.join(folder, 'report.json'), 'utf8'));
      const files = {};
      for (const k of j.files || []) files[k] = new Uint8Array(fs.readFileSync(path.join(folder, `${k}.webp`)));
      return { id: j.fields.submission_id, built: { fields: j.fields, files }, notBefore: Number(j.notBefore) || 0, keptAt: j.keptAt };
    } catch { return null; }
  }
  function list() {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n !== 'refused' && fs.existsSync(path.join(dir, n, 'report.json'))); } catch { /* nothing kept */ }
    return names.map(read).filter(Boolean).sort((a, b) => String(a.keptAt).localeCompare(String(b.keptAt)));
  }
  function remove(id) { try { fs.rmSync(path.join(dir, folderOf(id)), { recursive: true, force: true }); } catch { /* already gone */ } }
  // (one the service refused would be refused again: it is moved aside, never deleted, and never tried by itself)
  function setAside(id) {
    try { fs.mkdirSync(path.join(dir, 'refused'), { recursive: true }); fs.renameSync(path.join(dir, folderOf(id)), path.join(dir, 'refused', folderOf(id))); } catch { /* left where it was */ }
  }

  function schedule(ms) {
    if (timer) clearTimer(timer);
    timer = setTimer(() => { timer = null; autoTries++; return flush({ auto: true }); }, ms);
    if (timer && timer.unref) timer.unref();
  }
  /** After a held answer: the next automatic try, if there is one left. */
  function later(retryAfter) {
    const ms = retryDelay(autoTries, retryAfter);
    if (ms !== null) schedule(ms);
  }

  async function sendOne(built) {
    const r = await send(built, sendOptions());
    const id = built.fields.submission_id;
    if (r.sent) { if (id) remove(id); log(`[report] sent: report ${r.id}${r.created ? '' : ' (it was already there)'}`); }
    else if (r.held) {
      if (id) put(built, r.retryAfter ? now() + r.retryAfter * 1000 : 0);
      log(`[report] not sent (${r.held}${r.detail ? `: ${r.detail}` : ''}); kept to send later`);
    } else { if (id) setAside(id); log(`[report] refused by the service: ${r.refused}`); }
    return r;
  }

  /**
   * The person pressed Send: this report now, and every one waiting with it (whatever their retry_after: a person
   * asking is not a loop). Returns this one's outcome, `kept: true` when it is on disk for later.
   */
  async function submit(built) {
    const r = await sendOne(built);
    if (r.held) { r.kept = !!built.fields.submission_id; later(r.retryAfter); }
    if (!r.held) await flush({ auto: false, except: built.fields.submission_id });
    return r;
  }

  /** Try what is waiting. Automatic tries skip a report whose `retry_after` has not passed. */
  async function flush({ auto = false, except = null } = {}) {
    if (busy) return busy;
    busy = (async () => {
      const out = { sent: [], held: 0, refused: 0 };
      let wait = 0;
      for (const k of list()) {
        if (k.id === except) continue;
        if (auto && k.notBefore > now()) { out.held++; wait = Math.max(wait, (k.notBefore - now()) / 1000); continue; }
        const r = await sendOne(k.built);
        if (r.sent) out.sent.push(r.id);
        else if (r.held) { out.held++; wait = Math.max(wait, r.retryAfter || 0); if (r.held === 'offline') break; }   // (no connection: the rest would fail the same way)
        else out.refused++;
      }
      if (out.held) later(wait);
      if (out.sent.length) told(out);
      return out;
    })();
    try { return await busy; } finally { busy = null; }
  }

  return {
    submit, flush, list,
    /** How many are waiting. */
    waiting: () => list().length,
    /** The app has opened: one try at what was kept, after `ms` (the first of section 2's waits). */
    start: (ms = 30000) => { if (list().length) schedule(ms); },
    stop: () => { if (timer) clearTimer(timer); timer = null; },
    /** (for the tests) whether an automatic try is waiting */
    pending: () => !!timer,
  };
}

module.exports = { createOutbox };
