/**
 * Updates, the app's side: which updater runs (core/update/updates.js decides when it may do anything), the
 * window's line about a new version, and Help ▸ Check for Updates….
 *
 *   update-state                     what the window shows now
 *   update-check                     look now (Help ▸ Check for Updates…), and say the answer
 *   update-download / update-later   the line's two buttons
 *   update-restart                   "Restart now": quitting's questions first, then install and open the new version
 *   update-settings { auto, test }   Settings ▸ General's two switches
 *
 * Which updater:
 *   - an installed app: electron-updater, reading https://downloads.endlesscues.com/ (or …/test/);
 *   - run from source: none (it is updated with git), and Help says so;
 *   - a test run: a stand-in in this process that a smoke check scripts (`testHooks`), so no test ever reaches the
 *     network; or, with EC_UPDATE_FEED=http://127.0.0.1:…/, the real electron-updater against that local server
 *     (a dry run: it gets as far as a download; installing needs two signed builds).
 */
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { createUpdates } from '../../core/update/updates';

const CHECK_EVERY = 10000;            // how often it asks itself whether a check is due (no network unless one is)
// electron-updater sends a random id kept on this computer with each check, for staged roll-outs; these are not
// used here, and a check sends nothing about the person: every computer sends the same zero id instead
const NOBODY = '00000000-0000-4000-8000-000000000000';

let current = null;

/** A stand-in for electron-updater in a test run: the feed has `latest`, and a download takes a moment. */
function standIn(version) {
  const u = new EventEmitter();
  u.latest = version; u.fail = null; u.feeds = []; u.checks = 0; u.installs = 0; u.downloadMs = 300;
  u.setFeedURL = (o) => u.feeds.push(o.url);
  u.checkForUpdates = async () => {
    u.checks++;
    if (u.fail) throw new Error(u.fail);
    u.emit(u.latest !== version ? 'update-available' : 'update-not-available', { version: u.latest });
  };
  u.downloadUpdate = (token) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { u.emit('download-progress', { percent: 100 }); u.emit('update-downloaded', { version: u.latest }); resolve([]); }, u.downloadMs);
    if (token) token.onCancel = () => { clearTimeout(t); reject(new Error('cancelled')); };
  });
  u.quitAndInstall = () => { u.installs++; };
  return u;
}
const standInToken = () => ({ cancel() { if (this.onCancel) this.onCancel(); } });

function createAppUpdates({ app, host, getConfig, saveConfig, log, version, test = false, views = () => [], notice = () => {}, quit = async () => true, install = () => {} }) {
  const env = process.env;
  const say = (l) => log(`[update] ${l}`);
  let updater, token = () => null, enabled = true, fake = null;
  if (test && !env.EC_UPDATE_FEED) { updater = fake = standIn(version); token = standInToken; }
  else if (!app.isPackaged && !env.EC_UPDATE_FEED) { updater = new EventEmitter(); enabled = false; }
  else {
    const eu = require('electron-updater');
    const { CancellationToken } = require(require.resolve('builder-util-runtime', { paths: [path.dirname(require.resolve('electron-updater'))] }));
    updater = eu.autoUpdater;
    token = () => new CancellationToken();
    updater.autoDownload = false;                 // never without the person's Download
    updater.autoInstallOnAppQuit = true;          // once downloaded, it goes in when the app quits ("will install when you quit")
    updater.allowDowngrade = false;
    updater.logger = { info: (l) => say(l), warn: (l) => say(`warning: ${l}`), error: (l) => say(`error: ${l}`), debug: () => {} };
    updater.stagingUserIdPromise = { value: Promise.resolve(NOBODY) };
    if (!app.isPackaged) {
      // a dry run from source against a local feed: electron-updater wants the file an installed app carries
      updater.forceDevUpdateConfig = true;
      const file = path.join(app.getPath('userData'), 'dev-app-update.yml');
      fs.writeFileSync(file, `provider: generic\nurl: ${env.EC_UPDATE_FEED}\nupdaterCacheDirName: endless-cues-updater-dry-run\n`);
      updater.updateConfigPath = file;
    }
  }

  const tell = (state) => { for (const wc of views()) { try { wc.send('ec-update', state); } catch { /* closing */ } } };
  const mode = () => { try { return host.snapshot(false).mode; } catch { return 'show'; } };
  const updates = createUpdates({ updater, token, enabled, version, env, mode, sounding: () => host.isSounding(), getConfig, saveConfig: (c) => saveConfig(c),
    log: say, told: tell, ask: (t) => notice(t, 6000), quit, install: () => install(updater) });

  let timer = null;
  const api = {
    handle(c) {
      switch (c.op) {
        case 'update-state': return { ...updates.state(), ...updates.settings() };
        case 'update-check': return updates.check({ manual: true });
        case 'update-download': updates.download(); return { ok: true };       // (it takes a while: the line says how it goes)
        case 'update-later': return updates.later();
        case 'update-restart': return updates.restart();
        case 'update-settings': return updates.configure(c);
        default: return { error: 'unknown' };
      }
    },
    check: () => updates.check({ manual: true }),
    settings: () => updates.settings(),
    /** Start asking whether a check is due (not in a test run, which checks when it is told to). */
    start() { if (!test && enabled) timer = setInterval(() => { try { updates.tick(); } catch (err) { say(err.message); } }, CHECK_EVERY); },
    stop() { clearInterval(timer); },
    tick: () => updates.tick(),
    /** (a test run only) the stand-in, to script what the feed has */
    testHooks: () => (test ? fake : null),
  };
  current = api;
  return api;
}

const currentOf = () => current;
export { createAppUpdates, NOBODY, currentOf as current };
