/**
 * Updates, the app's side: which updater runs (core/update/updates.ts decides when it may do anything), the
 * window's line about a new version, and Help ▸ Check for Updates….
 *
 *   update-state                     what the window shows now
 *   update-check                     look now (Help ▸ Check for Updates…), and say the answer
 *   update-download / update-later   the line's two buttons
 *   update-restart                   "Restart now": quitting's questions first, then install and open the new version
 *   update-settings { auto, test }   Settings ▸ General's two switches
 *
 * Which updater:
 *   - an installed app: electron-updater, reading https://downloads.endlesscues.com/ (or …/test/): on a Mac its
 *     MacUpdater (the .zip), on Windows its NsisUpdater (the installer for this computer's architecture, refused
 *     unless signed by the publisher named in the app's app-update.yml when the running copy was signed), on Linux
 *     its AppImageUpdater when this is an AppImage (APPIMAGE is set);
 *   - any other Linux install (a .deb): no updater that installs. It reads the feed's version and, when it is newer,
 *     says so; its button opens the download page (core/update/updates.ts `feedReader`). electron-updater's own
 *     DebUpdater would run dpkg as an administrator, which is the person's package manager's job, not this app's;
 *   - run from source: none (it is updated with git), and Help says so;
 *   - a test run: a stand-in in this process that a smoke check scripts (`testHooks`), so no test ever reaches the
 *     network; or, with EC_UPDATE_FEED=http://127.0.0.1:…/, the real electron-updater against that local server
 *     (a dry run: it gets as far as a download; installing needs two signed builds).
 */
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { createUpdates, feedReader, feedFile, PAGE } from '../../core/update/updates';
import type { Updater, UpdateToken } from '../../core/update/updates';
import type { App, WebContents } from 'electron';
import type { Host } from './host';
import type { AppConfig } from './main';

/** Help ▸ Check for Updates…, the window's line and Settings ▸ General (`window.ec.app`). */
export type UpdateCommand =
  | { op: 'update-state' | 'update-check' | 'update-download' | 'update-later' | 'update-restart' }
  | { op: 'update-settings'; auto?: boolean; test?: boolean };
export interface AppUpdatesOptions {
  app: App;
  host: Host;
  getConfig: () => AppConfig;
  saveConfig: (change: Partial<AppConfig>) => void;
  log: (line: string) => void;
  version: string;
  test?: boolean;
  views?: () => WebContents[];
  notice?: (text: string, ms?: number) => void;
  quit?: () => Promise<boolean>;
  install?: (updater: Updater) => void;
  /** opens the download page (a .deb install's one button) */
  open?: (url: string) => void;
  /** reads a feed's file (a .deb install's check); null when it is not there */
  get?: (url: string) => Promise<string | null>;
}
/** The test run's stand-in: a feed whose `latest` a smoke check sets, and what it was asked. */
type StandIn = EventEmitter & Updater & { latest: string; fail: string | null; feeds: string[]; checks: number; installs: number; downloadMs: number };
/** What is set on electron-updater's own updater before it is used. */
interface UpdaterKnobs {
  autoDownload?: boolean; autoInstallOnAppQuit?: boolean; allowDowngrade?: boolean; logger?: unknown;
  forceDevUpdateConfig?: boolean; updateConfigPath?: string | null; disableWebInstaller?: boolean;
}
/** The one knob electron-updater's types call protected: the id a check sends for staged roll-outs. */
interface Staging { stagingUserIdPromise: { value: Promise<string> } }
interface StandInToken extends UpdateToken { onCancel?: () => void }

const CHECK_EVERY = 10000;            // how often it asks itself whether a check is due (no network unless one is)
// electron-updater sends a random id kept on this computer with each check, for staged roll-outs; these are not
// used here, and a check sends nothing about the person: every computer sends the same zero id instead
const NOBODY = '00000000-0000-4000-8000-000000000000';

let current: AppUpdates | null = null;

/** A stand-in for electron-updater in a test run: the feed has `latest`, and a download takes a moment. */
function standIn(version: string) {
  const u = new EventEmitter() as StandIn;
  u.latest = version; u.fail = null; u.feeds = []; u.checks = 0; u.installs = 0; u.downloadMs = 300;
  u.setFeedURL = (o: { url: string }) => u.feeds.push(o.url);
  u.checkForUpdates = async () => {
    u.checks++;
    if (u.fail) throw new Error(u.fail);
    u.emit(u.latest !== version ? 'update-available' : 'update-not-available', { version: u.latest });
  };
  u.downloadUpdate = (token: StandInToken | null) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { u.emit('download-progress', { percent: 100 }); u.emit('update-downloaded', { version: u.latest }); resolve([]); }, u.downloadMs);
    if (token) token.onCancel = () => { clearTimeout(t); reject(new Error('cancelled')); };
  });
  u.quitAndInstall = () => { u.installs++; };
  return u;
}
const standInToken = (): StandInToken => ({ cancel() { if (this.onCancel) this.onCancel(); } });

/**
 * How this copy updates: 'self' (electron-updater installs over it: a Mac app, a Windows install, an AppImage) or
 * 'page' (a .deb, or any other Linux install that is not an AppImage: a new version is only said, with a link).
 */
function howItUpdates(platform: string, env: { APPIMAGE?: string; EC_UPDATE_AS?: string }) {
  if (env.EC_UPDATE_AS === 'page' || env.EC_UPDATE_AS === 'self') return env.EC_UPDATE_AS;     // (a test's choice)
  return platform === 'linux' && !env.APPIMAGE ? 'page' : 'self';
}

function createAppUpdates({ app, host, getConfig, saveConfig, log, version, test = false, views = () => [], notice = () => {}, quit = async () => true, install = () => {},
  open = () => {}, get = async () => null }: AppUpdatesOptions) {
  const env = process.env;
  const say = (l: string) => log(`[update] ${l}`);
  let updater: Updater & UpdaterKnobs, token: () => UpdateToken | null = () => null, enabled = true, fake: StandIn | null = null;
  const how = howItUpdates(process.platform, env);
  if (test && !env.EC_UPDATE_FEED) { updater = fake = standIn(version); token = standInToken; }
  else if (!app.isPackaged && !env.EC_UPDATE_FEED) { updater = new EventEmitter() as unknown as Updater; enabled = false; }      // (never asked: `enabled` is false)
  else if (how === 'page') updater = feedReader({ version, file: feedFile(process.platform, process.arch), get });
  else {
    const eu = require('electron-updater') as typeof import('electron-updater');
    const { CancellationToken } = require(require.resolve('builder-util-runtime', { paths: [path.dirname(require.resolve('electron-updater'))] }));
    // (on Linux, the AppImage's own updater by name: electron-updater would pick its DebUpdater were the build's
    // resources to carry a "package-type" of deb, and that one installs with dpkg as an administrator)
    updater = process.platform === 'linux' ? new eu.AppImageUpdater() : eu.autoUpdater;
    updater.disableWebInstaller = true;           // (Windows: the full installer, never a web installer)
    token = () => new CancellationToken();
    updater.autoDownload = false;                 // never without the person's Download
    updater.autoInstallOnAppQuit = true;          // once downloaded, it goes in when the app quits ("will install when you quit")
    updater.allowDowngrade = false;
    updater.logger = { info: (l: string) => say(l), warn: (l: string) => say(`warning: ${l}`), error: (l: string) => say(`error: ${l}`), debug: () => {} };
    (updater as unknown as Staging).stagingUserIdPromise = { value: Promise.resolve(NOBODY) };
    if (!app.isPackaged) {
      // a dry run from source against a local feed: electron-updater wants the file an installed app carries
      updater.forceDevUpdateConfig = true;
      const file = path.join(app.getPath('userData'), 'dev-app-update.yml');
      fs.writeFileSync(file, `provider: generic\nurl: ${env.EC_UPDATE_FEED}\nupdaterCacheDirName: endless-cues-updater-dry-run\n`);
      updater.updateConfigPath = file;
    }
  }

  const tell = (state: Parameters<NonNullable<Parameters<typeof createUpdates>[0]['told']>>[0]) => { for (const wc of views()) { try { wc.send('ec-update', state); } catch { /* closing */ } } };
  const mode = () => { try { return host.snapshot(false).mode; } catch { return 'show'; } };
  const installs = test && !env.EC_UPDATE_FEED ? env.EC_UPDATE_AS !== 'page' : how === 'self';
  if (enabled && !installs) say(`this copy is not an AppImage: a new version is said, with a link to ${PAGE}, and never installed from here`);
  const updates = createUpdates({ updater, token, enabled, version, env, mode, sounding: () => host.isSounding(), getConfig, saveConfig: (c) => saveConfig(c),
    log: say, told: tell, ask: (t) => notice(t, 6000), quit, install: () => install(updater), installs, open, page: PAGE });

  let timer: ReturnType<typeof setInterval> | undefined;
  const api = {
    handle(c: UpdateCommand) {
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
    start() { if (!test && enabled) timer = setInterval(() => { try { updates.tick(); } catch (err) { say((err as Error).message); } }, CHECK_EVERY); },
    stop() { clearInterval(timer); },
    tick: () => updates.tick(),
    /** (a test run only) the stand-in, to script what the feed has */
    testHooks: () => (test ? fake : null),
  };
  current = api;
  return api;
}

/** New versions, as main.ts has them. */
export type AppUpdates = ReturnType<typeof createAppUpdates>;

const currentOf = () => current;
export { createAppUpdates, howItUpdates, NOBODY, currentOf as current };
