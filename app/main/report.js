/**
 * Report a problem, the app's side: the picture of the main window, what the app knew when it was taken, and the
 * outbox that sends it (core/report). Help ▸ Report a Problem… and Settings ▸ About open the form
 * (app/renderer/Report.js); nothing here sends anything until the person presses Send.
 *
 *   report-capture  { view, selected }   the picture now (before the form is drawn), and the context with it
 *   report-send     { … }                one report: built, sent, and kept on disk when the service cannot take it
 *   report-flush                         try every report waiting
 *
 * Where reports go: the service (docs/specs/17-service-protocol.md section 3), or EC_REPORTS_URL. A test run has
 * no endpoint unless it is given one (`testHooks`), so no test can ever send to the real service.
 */
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const R = require('../../core/report/report');
const { createOutbox } = require('../../core/report/outbox');

let current = null;
const LOG_LINES = 150;            // the show log's last lines a report may carry

function createReports({ app, mainWindow, host, getConfig, saveConfig, log, logLines, version, test = false, notice = () => {} }) {
  let url = process.env.EC_REPORTS_URL || (test ? null : R.ENDPOINT);
  let fetchImpl = globalThis.fetch;
  const osText = R.osName(process.platform, typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : os.release(), process.arch);
  const scrub = R.scrubber({ home: os.homedir(), user: (() => { try { return os.userInfo().username; } catch { return ''; } })() });
  let taken = null;           // the last picture and context: what the form shows is what is sent

  /** This install's id: a random UUID, made the first time it is needed and kept in config.json. */
  function clientId() {
    const c = getConfig();
    if (c.clientId && /^[A-Za-z0-9_.:-]{8,80}$/.test(c.clientId)) return c.clientId;
    const id = crypto.randomUUID();
    saveConfig({ clientId: id });
    return id;
  }

  const outbox = createOutbox({
    dir: path.join(app.getPath('userData'), 'reports'),
    sendOptions: () => ({ url, fetch: fetchImpl, userAgent: `EndlessCues/${version} (${osText})` }),
    log,
    told: (out) => notice(out.sent.length === 1 ? 'The report kept from before has been sent. Thank you.' : `${out.sent.length} reports kept from before have been sent. Thank you.`, 6000),
  });

  function contextNow(about) {
    const snap = host.snapshot(false);
    let cueCount = 0;
    const walk = (cues) => { for (const c of cues || []) { cueCount++; walk(c.children); } };
    for (const l of (host.document.doc.lists || [])) walk(l.cues);
    const m = snap.mixer || {};
    const dev = (m.devices || []).find((d) => d.id === m.device);
    return R.makeContext({
      view: about.view, mode: snap.mode, selected: about.selected, cueCount,
      audio: { device: dev ? dev.label : m.device === 'default' || !m.device ? 'system default' : 'chosen output', ok: m.deviceOk },
      locale: app.getLocale(), log: logLines(), issue: about.issue,
    }, scrub);
  }

  async function capture(c) {
    const win = mainWindow();
    if (!win || win.isDestroyed()) return { error: 'No window to take a picture of.' };
    let png = null, size = null;
    // (a window that has not been drawn for a while can give an empty picture, or Chromium's compositor an error
    // while it is busy: it is asked to draw, and asked again)
    for (let i = 0; i < 4 && !png; i++) {
      try { const img = await win.webContents.capturePage(); if (!img.isEmpty()) { png = img.toPNG(); size = img.getSize(); } } catch (err) { if (i === 3) log(`[report] no picture: ${err.message}`); }
      if (!png) { win.webContents.invalidate(); await new Promise((r) => setTimeout(r, 120)); }
    }
    const context = contextNow(c || {});
    // the show log's last lines, as they would go if the person ticks the box: no cue's or file's name, scrubbed
    const logTail = (host.reportLog ? host.reportLog(LOG_LINES) : []).map((l) => scrub(l));
    taken = { at: new Date().toISOString(), context, logTail };
    return { png, width: size && size.width, height: size && size.height, capturedAt: taken.at, context, logTail, showName: host.document.doc.title || '', os: osText, version,
      waiting: outbox.waiting(), sends: !!url };
  }

  async function submit(c) {
    const context = { ...((taken && taken.context) || contextNow({})) };
    // (what the person unticked under "Attached" is left out: the error that was offered, the recent error lines)
    for (const k of Array.isArray(c.leaveOut) ? c.leaveOut : []) if (['issue', 'errors'].includes(k)) delete context[k];
    if (c.showName) { const t = host.document.doc.title; if (t) context.show_name = String(t).slice(0, 200); }
    // the show log's tail, only when ticked (off as the form opens): the lines the form showed, the oldest dropped to fit
    if (c.showLog && taken && taken.logTail && taken.logTail.length) {
      context.show_log = taken.logTail.slice();
      while (context.show_log.length && JSON.stringify(context).length > R.LIMITS.context) context.show_log.shift();
      if (!context.show_log.length) delete context.show_log;
    }
    const built = R.buildReport({
      clientId: clientId(),
      submissionId: /^[A-Za-z0-9_.:-]{8,80}$/.test(String(c.submissionId || '')) ? c.submissionId : crypto.randomUUID(),
      category: c.category, comment: c.comment, email: c.email, appVersion: version, os: osText,
      capturedAt: taken ? taken.at : new Date().toISOString(), context,
      screenshot: c.picture ? c.screenshot : null, thumbnail: c.picture ? c.thumbnail : null,
    });
    if (built.error) return { refused: built.error, message: built.why ? `Not sent: ${built.why}.` : '' };
    return outbox.submit(built);
  }

  function handle(c) {
    switch (c.op) {
      case 'report-capture': return capture(c);
      case 'report-send': return submit(c);
      case 'report-flush': return outbox.flush().then((r) => ({ ...r, waiting: outbox.waiting() }));
      default: return { error: 'unknown' };
    }
  }

  const api = {
    handle,
    /** The app has opened: what was kept is tried once, 30 s from now (never in a test run). */
    start() { if (!test && url) outbox.start(30000); },
    stop() { outbox.stop(); },
    /** (a test run only) where its reports go, and the fetch that takes them */
    testHooks({ url: u, fetch: f } = {}) { if (!test) return; url = u || null; if (f) fetchImpl = f; },
    outbox,
  };
  current = api;
  return api;
}

module.exports = { createReports, current: () => current };
