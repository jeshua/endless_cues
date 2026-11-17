/**
 * Updates (app/main/updates.js, app/renderer/Update.js), run by smoke.js near its end, against the test run's
 * stand-in updater: no network. Checked here: Help ▸ Check for Updates… with nothing newer says so; with a newer
 * version the title bar has one line with Download and Not now, and nothing is downloaded yet; Show mode hides the
 * line and refuses a check; sound playing hides it; Download fetches and the line becomes "will install when you
 * quit" with Restart now; Restart now is refused while sound plays; Settings ▸ General has the two switches, and
 * Test versions points the check at the test feed.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { makeDemo } from '../../examples/make-demo';

async function run({ host, win, check, until, page, sleep, shot: take }) {
  const shot = async (name) => { try { if (take) await take(name); } catch { /* no picture */ } };
  const updates = require('./updates').current();
  const fake = updates.testHooks();
  const has = (sel) => page(`!!document.querySelector(${JSON.stringify(sel)})`);
  const text = (sel) => page(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? [...el.children].map((c) => c.textContent.replace(/\\s+/g, ' ').trim()).join(' | ') : null; })()`);
  const click = (sel) => page(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  const notice = () => host.snapshot(false).notice;
  const noticeText = () => { const n = notice(); return n ? (n.text || String(n)) : ''; };

  host.cmd({ op: 'panic', hard: true });
  await until(() => !host.isSounding(), 4000);
  host.cmd({ op: 'mode', mode: 'edit' });
  win.setContentSize(1480, 940); await sleep(200);

  check('a test run’s updater is the stand-in, and looks at nothing by itself', !!fake && fake.checks === 0, fake && fake.checks);
  await updates.check();
  check('Help ▸ Check for Updates… with nothing newer: “You have the latest version.”', await until(() => /You have the latest version\./.test(noticeText()), 3000), noticeText());
  check('…and no line in the title bar', !(await has('[data-update]')));

  fake.latest = '9.9.9';
  await updates.check();
  check('a newer version: one line, “Version 9.9.9 is ready to download.”, with Download and Not now', await until(async () => /^Version 9\.9\.9 is ready to download\. \| Download \| Not now$/.test(await text('.titlebar [data-update]') || ''), 3000), await text('.titlebar [data-update]'));
  check('…and nothing is downloaded until Download', fake.installs === 0 && (await page(`document.querySelector('[data-update]').dataset.update`)) === 'available');
  check('…the check read everyone’s feed', fake.feeds[fake.feeds.length - 1] === 'https://downloads.endlesscues.com/', fake.feeds);
  await shot('update-available');

  host.cmd({ op: 'mode', mode: 'show' });
  check('Show mode hides the line', await until(async () => !(await has('[data-update]')), 2000));
  const before = fake.checks;
  await updates.check();
  check('…and a check asked for in Show mode is not made, and says why', fake.checks === before && /Show mode/.test(noticeText()), [fake.checks, noticeText()]);
  host.cmd({ op: 'mode', mode: 'edit' });
  check('…back in Edit it is there again', await until(() => has('[data-update="available"]'), 2000));

  await click('[data-update-later]');
  check('Not now takes the line away', await until(async () => !(await has('[data-update]')), 2000));
  await updates.check();
  check('…and a check asked for brings it back', await until(() => has('[data-update="available"]'), 2000));

  await click('[data-update-download]');
  check('Download: the line says it is downloading, then “Version 9.9.9 will install when you quit.” with Restart now', await until(async () => /^Version 9\.9\.9 will install when you quit\. \| Restart now$/.test(await text('[data-update]') || ''), 4000), await text('[data-update]'));
  check('…and nothing was installed by itself', fake.installs === 0);
  await shot('update-ready');

  // (a demo show of its own, opened fresh: what earlier checks left standing by may play nothing)
  const demo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-update-')), 'Demo.ecshow');
  makeDemo(demo);
  host.open(demo);
  await until(() => host.snapshot(false).mixer.audioReady && Object.keys(host.snapshot(false).engine.durations).length >= 4, 6000);
  host.cmd({ op: 'go' });
  const sounding = await until(() => host.isSounding(), 3000);
  if (sounding) {
    check('sound playing hides the line', await until(async () => !(await has('[data-update]')), 2000));
    const r = await page(`window.ec.app({ op: 'update-restart' })`);
    check('…and Restart now is refused while sound plays', /nothing playing/.test(r.error || '') && fake.installs === 0, r);
    host.cmd({ op: 'panic', hard: true });
    await until(() => !host.isSounding(), 4000);
  } else check('a GO plays something to hide the line with', false);
  updates.tick();
  check('…the line is back once nothing plays', await until(() => has('[data-update="ready"]'), 3000));

  // Settings ▸ General: the two switches (this computer's)
  win.webContents.send('ec-menu', 'settings');
  await page(`(() => { const b = document.querySelector('[data-section="general"]'); if (b) b.click(); })()`);
  check('Settings ▸ General has “Check for updates automatically” (on) and “Test versions” (off)', await until(() => page(`(() => { const a = document.querySelector('[data-update-auto] .switch'), t = document.querySelector('[data-update-test] .switch'); return !!a && !!t && a.classList.contains('on') && !t.classList.contains('on') && /Check for updates automatically/.test(document.querySelector('.pane').textContent); })()`), 3000));
  await shot('update-settings');
  check('Settings covers the title bar, so the newer version is said in Settings ▸ General too', await until(() => has('[data-settings-update] [data-update="ready"] [data-update-restart]'), 3000));
  await page(`window.ec.app({ op: 'update-settings', test: true })`);
  check('Test versions on: the setting is kept, and what was downloaded stays offered', updates.settings().test === true && (await page(`window.ec.app({ op: 'update-state' })`)).step === 'ready');
  await page(`window.ec.app({ op: 'update-settings', test: false })`);
  await page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(150);
}

export { run };
