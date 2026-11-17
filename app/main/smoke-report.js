/**
 * Report a problem (app/main/report.js, app/renderer/Report.js), run by smoke.js near its end. Checked here: a test
 * run has no endpoint until it is given one; Help ▸ Report a Problem… opens the form with the window's picture shown
 * small; Send sends one multipart report in the protocol's fields (a WebP within 2400 px and its thumbnail within
 * 480 px and 256 KB, this install's client id, the context with no home folder in it, the show's name only when its
 * box is ticked); with no connection the report is kept on disk and offered "Send later", and Send again sends the
 * same submission; Settings ▸ About's link closes Settings first; the form fits at 1024 × 700 and 1600 × 1000.
 *
 * Its reports go to a fake `fetch` in this process: no port is opened and the real service is never reached.
 */
const os = require('os');
const { webpInfo } = require('../../core/report/report');

async function run({ win, check, until, page, sleep, shot: take }) {
  const shot = async (name) => { try { if (take) await take(name); } catch { /* no picture */ } };
  const reports = require('./report').current();
  const has = (sel) => page(`!!document.querySelector(${JSON.stringify(sel)})`);
  const click = (sel) => page(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  const type = (sel, text) => page(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const tick = (sel, on) => page(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el.checked !== ${on}) el.click(); return el.checked; })()`);
  const status = () => page(`(() => { const el = document.querySelector('[data-report-status]'); return el ? el.dataset.reportStatus : null; })()`);
  const closeForm = async () => { await page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await until(async () => !(await has('[data-report]')), 2000); };

  // (a resize first: a window nothing has redrawn for a while gives an empty picture in a test run, as in smoke.js's own pictures)
  win.setContentSize(1480, 940); await sleep(350);
  const first = await page(`window.ec.app({ op: 'report-capture' }).then((r) => ({ sends: r.sends, png: !!r.png }))`);
  check('a test run has nowhere to send a report until it is given one', first.sends === false && first.png, first);

  // a fake service in this process: what it was sent, and what it answers
  const got = [];
  let answer = () => new Response(JSON.stringify({ id: 100 + got.length, status: 'open', created_at: new Date().toISOString(), created: true }), { status: 201, headers: { 'content-type': 'application/json' } });
  reports.testHooks({ url: 'https://reports.invalid/v1/reports', fetch: async (url, init) => {
    const form = await new Request(url, init).formData();
    const fields = {}, files = {};
    for (const [k, v] of form.entries()) { if (typeof v === 'string') fields[k] = v; else files[k] = new Uint8Array(await v.arrayBuffer()); }
    got.push({ url, headers: init.headers, fields, files });
    return answer();
  } });

  win.setContentSize(1480, 940); await sleep(200);
  win.webContents.send('ec-menu', 'report');
  check('Help ▸ Report a Problem… opens the form', await until(() => has('[data-report]'), 4000));
  check('…with the picture of the window shown small, made into a WebP', await until(() => page(`(() => { const i = document.querySelector('[data-report-shot] img'); return !!i && i.complete && i.naturalWidth > 0 && i.src.startsWith('data:image/webp') && i.getBoundingClientRect().width <= 200; })()`), 6000));
  check('…the picture on, the show’s name off, and Bug chosen', (await page(`document.querySelector('[data-report-picture]').checked && !document.querySelector('[data-report-showname]').checked && document.querySelector('[data-report-kind].on').dataset.reportKind`)) === 'bug');
  check('…and a line saying what is sent and what never is', /Never: show files, sounds, paths with your name, keys/.test(await page(`document.querySelector('[data-report-what]').textContent`)));
  await tick('[data-report-picture]', false);
  check('Send waits for words or a picture', await until(() => page(`document.querySelector('[data-report-send]').disabled`), 2000));
  await tick('[data-report-picture]', true);
  await type('[data-report-text]', 'Smoke test: the fade did not finish.');
  await tick('[data-report-showname]', true);
  await click('[data-report-details]');
  check('“Exactly what is sent” shows the context, with the show’s name once ticked', await until(() => page(`/"show_name"/.test(document.querySelector('[data-report-json]').textContent) && /"cue_count"/.test(document.querySelector('[data-report-json]').textContent)`), 2000));
  await shot('report-1480');
  await click('[data-report-send]');
  check('Send sends one report and says so', await until(async () => got.length === 1 && (await status()) === 'sent', 5000), [got.length, await status()]);
  const r = got[0] || { fields: {}, files: {}, headers: {} };
  const shotInfo = r.files.screenshot && webpInfo(r.files.screenshot), thumbInfo = r.files.thumbnail && webpInfo(r.files.thumbnail);
  check('…in the protocol’s fields', r.fields.category === 'bug' && r.fields.comment === 'Smoke test: the fade did not finish.' && /^[0-9a-f-]{36}$/.test(r.fields.client_id) && /^[0-9a-f-]{36}$/.test(r.fields.submission_id) && /^\d+\.\d+\.\d+/.test(r.fields.app_version) && !!r.fields.os && !!r.fields.captured_at && !r.fields.email, r.fields);
  check('…with a WebP within 2400 px and a thumbnail within 480 px and 256 KB', !!shotInfo && Math.max(shotInfo.width, shotInfo.height) <= 2400 && !shotInfo.animated && !!thumbInfo && Math.max(thumbInfo.width, thumbInfo.height) <= 480 && r.files.thumbnail.length <= 256 * 1024 && r.files.screenshot.length <= 8 * 1024 * 1024, [shotInfo, thumbInfo, r.files.thumbnail && r.files.thumbnail.length]);
  const ctx = (() => { try { return JSON.parse(r.fields.context); } catch { return {}; } })();
  check('…the context as the protocol lists it, with the show’s name because it was ticked', ['view', 'mode', 'cue_count', 'locale'].every((k) => k in ctx) && typeof ctx.show_name === 'string', ctx);
  const everything = JSON.stringify(r.fields);
  check('…and no home folder or user name anywhere in it', !everything.includes(os.homedir()) && !(os.userInfo().username.length >= 3 && new RegExp(`(?<![A-Za-z0-9])${os.userInfo().username}(?![A-Za-z0-9])`, 'i').test(JSON.stringify(ctx))));
  check('…a User-Agent naming the app, and no token', /^EndlessCues\/\S+ \(.+\)$/.test((r.headers || {})['User-Agent'] || '') && !(r.headers || {}).Authorization, r.headers);
  check('…and the form closes by itself', await until(async () => !(await has('[data-report]')), 4000));

  // no connection: kept, offered for later, and the same report when sent again
  answer = () => { throw new TypeError('fetch failed'); };
  win.webContents.send('ec-menu', 'report');
  await until(() => page(`(() => { const i = document.querySelector('[data-report-shot] img'); return !!i && i.complete && i.naturalWidth > 0; })()`), 6000);
  check('a sent report’s words are not there the next time', (await page(`document.querySelector('[data-report-text]').value`)) === '');
  await type('[data-report-text]', 'Smoke test: sent with no connection.');
  await click('[data-report-send]');
  check('with no connection the report is kept and “Send later” is offered', await until(async () => (await status()) === 'held' && (await has('[data-report-later]')), 5000) && reports.outbox.waiting() === 1, [await status(), reports.outbox.waiting()]);
  await shot('report-held');
  await click('[data-report-later]');
  win.webContents.send('ec-menu', 'report');
  await until(() => has('[data-report]'), 4000);
  check('…what was written is still there, and the waiting report is said', (await page(`document.querySelector('[data-report-text]').value`)) === 'Smoke test: sent with no connection.' && await until(() => has('[data-report-waiting]'), 2000));
  answer = () => new Response(JSON.stringify({ id: 200, status: 'open', created: true }), { status: 201 });
  const before = got.length;
  await click('[data-report-send]');
  check('Send again sends it, as the same submission, and nothing is left waiting', await until(async () => (await status()) === 'sent', 5000) && got.length >= before + 1 && got[got.length - 1].fields.submission_id === got[before - 1].fields.submission_id && got[got.length - 1].fields.client_id === got[0].fields.client_id && reports.outbox.waiting() === 0,
    [got.length, before, got.slice(-2).map((g) => g.fields.submission_id), reports.outbox.waiting()]);
  await until(async () => !(await has('[data-report]')), 4000);

  // from Settings ▸ About: Settings closes before the picture is taken
  win.webContents.send('ec-menu', 'settings');
  await until(() => has('.modal [data-section="about"]'), 3000);
  await click('.modal [data-section="about"]');
  check('Settings ▸ About has a quiet link to Report a problem', await until(() => has('[data-about-report]'), 2000));
  await click('[data-about-report]');
  check('…which closes Settings and opens the form', await until(async () => (await has('[data-report]')) && !(await has('.modal')), 4000));

  // the form at two sizes of window: all of it can be reached, and Send is on the screen
  for (const [w, h] of [[1024, 700], [1600, 1000]]) {
    win.setContentSize(w, h); await sleep(300);
    await click('[data-report-details]');
    await sleep(150);
    const fit = await page(`(() => { const s = document.querySelector('[data-report]').getBoundingClientRect(), b = document.querySelector('[data-report-send]').getBoundingClientRect(); return { fits: s.left >= 0 && s.right <= innerWidth && s.top >= 0 && s.bottom <= innerHeight, send: b.bottom <= innerHeight && b.right <= innerWidth && b.width > 0 }; })()`);
    await shot(`report-${w}x${h}`);
    await click('[data-report-details]');
    check(`at ${w} × ${h} the form fits in the window`, fit.fits, fit);
  }
  await closeForm();
  check('Esc closes the form', !(await has('[data-report]')));
  win.setContentSize(1480, 940);
}

module.exports = { run };
