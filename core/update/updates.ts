/**
 * Updates: when the app may look for a newer version, what it says about one, and when it may install it.
 *
 * The rules (docs/specs/00-defaults.md, "The app itself"):
 *   - Nothing about updates happens in Show mode or while anything is playing: a check that is due waits, a line
 *     that was showing is hidden, and a download under way is stopped (it starts again from Download).
 *   - A check is one GET of the feed's file (latest-mac.yml): once a day by itself while "Check for updates
 *     automatically" is on, and whenever the person asks (Help ▸ Check for Updates…).
 *   - Nothing is downloaded until the person presses Download, and nothing is installed until they quit or press
 *     Restart now. The app never quits by itself to install.
 *   - "Test versions" reads another feed (…/test/), so a version can be tried before everyone is offered it.
 *   - A copy that cannot install over itself (a Linux .deb: that needs the package manager and an administrator)
 *     only says a new version is out, and its one button opens the download page. It never downloads or installs.
 *
 * The updater itself is given (electron-updater's autoUpdater in the app, a fake in the tests): this file never
 * requires Electron. What it needs of one: on(event, fn), setFeedURL({ provider, url }), checkForUpdates(),
 * downloadUpdate(token), quitAndInstall(); `token()` makes the cancellation token a download is given.
 */

const FEED = 'https://downloads.endlesscues.com/';
const PAGE = 'https://endlesscues.com/';
const TEST_FEED = `${FEED}test/`;
const DAY = 24 * 3600e3;
const RETRY = 3600e3;             // an automatic check that failed (no connection, most often) is tried again an hour later

/** This computer's update settings, as settingsOf reads them. */
export interface UpdateSettings { auto: boolean; test: boolean; lastCheck: number }
/** What config.json keeps: `updates` is the part this file reads and writes. */
export interface UpdateConfig { updates?: Partial<UpdateSettings> }
/** A download's cancellation token. */
export interface UpdateToken { cancel(): void }
/** What the controller needs of an updater (electron-updater's autoUpdater, or a stand-in). */
export interface Updater {
  on(event: string, fn: (...args: any[]) => void): unknown;
  setFeedURL(feed: { provider: 'generic'; url: string; channel?: string }): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(token?: UpdateToken | null): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): unknown;
}
/** A version the feed offers, as the updater's events carry it. */
interface UpdateInfo { version: string }
export type UpdateStep = 'idle' | 'checking' | 'available' | 'downloading' | 'ready';
export interface UpdateState { step: UpdateStep; version: string; percent: number; hidden: boolean }
/** What the window is told: the state, and whether the line shows. */
export type UpdateView = UpdateState & { visible: boolean; page?: string };

/**
 * The feed's file for a platform and architecture, named as electron-updater asks for it (its Provider's
 * getChannelFilePrefix): the Mac's latest-mac.yml, Windows' latest.yml (one file for every architecture: the
 * updater picks the installer whose name has its own), Linux's latest-linux.yml for x64 and latest-linux-<arch>.yml
 * for the others.
 */
function feedFile(platform: string, arch: string) {
  if (platform === 'darwin') return 'latest-mac.yml';
  if (platform === 'win32') return 'latest.yml';
  return `latest-linux${arch === 'x64' ? '' : `-${arch}`}.yml`;
}

/** Semantic versions compared (x.y.z, then a pre-release after "-": 0.3.0-alpha.10 after -alpha.9, 0.3.0 after both). */
function compareVersions(a: string, b: string) {
  const split = (v: string) => { const [main, pre = ''] = String(v).trim().replace(/^v/, '').split('+')[0].split(/-(.*)/s); return { main: main.split('.').map((n) => Number(n) || 0), pre: pre ? pre.split('.') : [] }; };
  const x = split(a), y = split(b);
  for (let i = 0; i < 3; i++) if ((x.main[i] || 0) !== (y.main[i] || 0)) return (x.main[i] || 0) - (y.main[i] || 0);
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? -1 : 0) + (y.pre.length ? 1 : 0);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** What a copy that cannot install over itself is given for an updater: it reads the feed's version, and that is all. */
export interface FeedReaderOptions { version: string; file: string; get: (url: string) => Promise<string | null> }
/**
 * An updater that only looks: one GET of the feed's file, its `version:` compared with this one. It downloads
 * nothing and installs nothing (downloadUpdate refuses, quitAndInstall does nothing): for a .deb install, whose
 * update is the person's to make (the download page, or their package manager).
 */
function feedReader({ version, file, get }: FeedReaderOptions) {
  const fns = new Map<string, ((...a: any[]) => void)[]>();
  const emit = (event: string, ...a: unknown[]) => { for (const fn of fns.get(event) || []) fn(...a); };
  let url = '';
  const reader = {
    installs: false as const,
    on(event: string, fn: (...a: any[]) => void) { fns.set(event, [...(fns.get(event) || []), fn]); return reader; },
    setFeedURL(feed: { url: string }) { url = feed.url.replace(/\/*$/, '/'); },
    async checkForUpdates() {
      const text = await get(url + file);
      if (text == null) throw new Error(`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND: ${url}${file}`);
      const offered = (/^version:\s*['"]?([^'"\s]+)/m.exec(text) || [])[1];
      if (!offered) throw new Error(`${url}${file} names no version`);
      const newer = compareVersions(offered, version) > 0;
      emit(newer ? 'update-available' : 'update-not-available', { version: offered });
      return { isUpdateAvailable: newer };
    },
    async downloadUpdate() { throw new Error('This copy is installed by a package: it is updated from the download page, not from here.'); },
    quitAndInstall() { /* never: nothing was downloaded */ },
  };
  return reader;
}

/** The feed for this computer's choice: everyone's, or the test versions'. EC_UPDATE_FEED (a test) overrides both. */
function feedFor(settings: { test?: boolean }, env: { EC_UPDATE_FEED?: string } = {}) {
  if (env.EC_UPDATE_FEED) return env.EC_UPDATE_FEED.replace(/\/*$/, '/');
  return settings.test ? TEST_FEED : FEED;
}

/** This computer's update settings (config.json's `updates`), with their defaults: checking on, test versions off. */
function settingsOf(config: UpdateConfig | null | undefined): UpdateSettings {
  const u: Partial<UpdateSettings> = (config && config.updates) || {};
  return { auto: u.auto !== false, test: u.test === true, lastCheck: Number(u.lastCheck) || 0 };
}

/** Whether anything about updates may happen now: Edit mode, and nothing playing. */
const quiet = ({ mode, sounding }: { mode: string; sounding: boolean }) => mode !== 'show' && !sounding;

/** Whether a check is due by itself: switched on, and a day since the last one that got an answer. */
function due(settings: UpdateSettings, now: number) {
  return settings.auto && (!settings.lastCheck || now - settings.lastCheck >= DAY);
}

/** An error from a check or a download, in plain words. */
function said(err: any) {
  const m = String((err && (err.code || '')) + ' ' + ((err && err.message) || err || ''));
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT|FAILED)|ADDRESS_UNREACHABLE/i.test(m)) return 'There is no connection to endlesscues.com.';
  if (/ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|\b404\b/.test(m)) return 'The update server has no version for this computer yet.';
  if (/cancel/i.test(m)) return 'The download was stopped.';
  if (/sha512 checksum mismatch|checksum/i.test(m)) return 'The download was damaged. Try again.';
  if (/ERR_UPDATER_INVALID_SIGNATURE|not signed by the application owner/i.test(m)) return 'Windows refused the new version: it is not signed by the same publisher as this one.';
  if (/code signature|signature/i.test(m)) return 'macOS refused the new version: its signature did not match this one.';
  if (/update bundle/i.test(m)) return 'macOS could not install it over this copy of the app.';
  const first = String((err && err.message) || err || 'Something went wrong.').split('\n')[0].trim();
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}

/**
 * The controller. `told(state)` is called whenever what the window should show changes. `ask(text)` says a
 * one-off answer (a manual check's result). `quit()` asks what quitting asks (unsaved changes) and resolves to
 * true when the app may go; `install()` then quits and installs.
 */
export interface UpdatesOptions {
  updater: Updater;
  token?: () => UpdateToken | null;
  mode?: () => string;
  sounding?: () => boolean;
  getConfig?: () => UpdateConfig | null | undefined;
  saveConfig?: (change: UpdateConfig) => void;
  version?: string;
  env?: { EC_UPDATE_FEED?: string };
  log?: (line: string) => void;
  now?: () => number;
  told?: (view: UpdateView) => void;
  ask?: (text: string) => void;
  quit?: () => Promise<boolean>;
  install?: () => void;
  enabled?: boolean;
  /** false: this copy cannot install over itself (a .deb); a new version is only said, and Download opens `page` */
  installs?: boolean;
  /** opens the download page in the person's browser (installs: false) */
  open?: (url: string) => void;
  page?: string;
}

function createUpdates({ updater, token = () => null, mode = () => 'edit', sounding = () => false, getConfig = () => ({}), saveConfig = () => {},
  version = '0.0.0', env = {}, log = () => {}, now = Date.now, told = () => {}, ask = () => {}, quit = async () => true, install = () => updater.quitAndInstall(), enabled = true,
  installs = true, open = () => {}, page = PAGE }: UpdatesOptions) {
  // step: idle | checking | available | downloading | ready
  let state: UpdateState = { step: 'idle', version: '', percent: 0, hidden: false };
  let manual = false;                 // the check under way was asked for: its answer is said, whatever it is
  let lastTry = 0;                    // when an automatic check was last tried (answered or not)
  let download: UpdateToken | null = null;                // the cancellation token of a download under way
  let feed = '';

  const set = (change: Partial<UpdateState>) => {
    const next: UpdateState = { ...state, ...change };
    if ((Object.keys(next) as (keyof UpdateState)[]).every((k) => next[k] === state[k])) return;
    state = next;
    told(view());
  };
  const view = (): UpdateView => ({ ...state, visible: !state.hidden && ['available', 'downloading', 'ready'].includes(state.step), ...(installs ? {} : { page }) });
  const settings = () => settingsOf(getConfig());
  const keep = (change: Partial<UpdateSettings>) => saveConfig({ updates: { ...((getConfig() || {}).updates || {}), ...change } });

  function point() {
    const url = feedFor(settings(), env);
    if (url === feed) return;
    feed = url;
    updater.setFeedURL({ provider: 'generic', url, channel: 'latest' });
    log(`feed ${url}`);
  }

  if (enabled) {
    updater.on('update-available', (info: UpdateInfo) => {
      log(`${info.version} is available`);
      set({ step: 'available', version: info.version, percent: 0 });
    });
    updater.on('update-not-available', (info?: UpdateInfo) => {
      log(`none newer than ${version}${info && info.version ? ` (the feed has ${info.version})` : ''}`);
      if (state.step === 'checking') set({ step: 'idle' });
      if (manual) ask('You have the latest version.');
    });
    updater.on('download-progress', (p: { percent?: number }) => { if (state.step === 'downloading') set({ percent: Math.floor(p.percent || 0) }); });
    updater.on('update-downloaded', (info: UpdateInfo) => {
      download = null;
      if (!installs) return;          // (never: nothing is downloaded here; and were it, nothing would be installed)
      log(`${info.version} is downloaded: it installs when the app quits`);
      set({ step: 'ready', version: info.version, percent: 100 });
    });
    updater.on('error', (err: any) => {
      log(`error: ${(err && err.message) || err}`);
      // (on a Mac the system's installer takes the download after it is complete, and checks its signature then:
      // a refusal there means nothing will install on quit, so the line must not go on saying it will)
      if (state.step === 'ready') { const v = state.version; set({ step: 'idle', version: '', percent: 0 }); ask(`Version ${v} cannot be installed. ${said(err)}`); }
    });
  }

  /** Look for a newer version now. `manual`: asked for, so its answer is said (and Show mode says why not). */
  async function check({ manual: asked = false } = {}) {
    if (!enabled) { if (asked) ask('This copy runs from source: it is updated with git, not from here.'); return { ok: false, why: 'source' }; }
    if (!quiet({ mode: mode(), sounding: sounding() })) {
      if (asked) ask(mode() === 'show' ? 'Show mode: check for updates in Edit.' : 'Sound is playing: check for updates when it stops.');
      return { ok: false, why: 'busy' };
    }
    if (state.step === 'downloading' || state.step === 'ready') { if (asked) ask(state.step === 'ready' ? `Version ${state.version} will install when you quit.` : `Version ${state.version} is downloading.`); return { ok: true, step: state.step }; }
    if (state.step === 'checking') return { ok: true, step: 'checking' };
    manual = asked;
    lastTry = now();
    set({ step: 'checking', hidden: false });
    try {
      point();
      await updater.checkForUpdates();
      keep({ lastCheck: now() });
      if ((state.step as UpdateStep) === 'checking') set({ step: 'idle' });         // (an updater that answered nothing)
      return { ok: true, step: state.step, version: state.version };
    } catch (err: any) {
      log(`${asked ? '' : 'the daily '}check failed: ${(err && err.message) || err}`);
      set({ step: 'idle' });
      if (asked) ask(`Could not check for updates. ${said(err)}`);
      return { ok: false, error: said(err) };
    } finally { manual = false; }
  }

  /** Download: only once it was found, and only when the person says so. */
  async function get() {
    if (state.step !== 'available') return { error: 'There is nothing to download.' };
    if (!quiet({ mode: mode(), sounding: sounding() })) return { error: 'Download in Edit mode, with nothing playing.' };
    const v = state.version;
    // a copy that cannot install over itself: the download page, in the browser; the line stays until Not now
    if (!installs) { log(`${v}: opening the download page (this copy installs from a package)`); open(page); return { ok: true, opened: page }; }
    download = token();
    set({ step: 'downloading', percent: 0 });
    try {
      await updater.downloadUpdate(download);
      return { ok: true };
    } catch (err: any) {
      const stopped = !download || /cancel/i.test(String((err && err.message) || err));
      download = null;
      log(`download of ${v} ${stopped ? 'stopped' : `failed: ${(err && err.message) || err}`}`);
      if ((state.step as UpdateStep) === 'downloading') set({ step: 'available', percent: 0 });
      if (!stopped) ask(`Version ${v} could not be downloaded. ${said(err)}`);
      return { error: said(err) };
    }
  }

  /** Not now: the line goes until the next check finds a version (tomorrow's, or one asked for). */
  function later() {
    if (state.step === 'available') set({ step: 'idle' });
    return { ok: true };
  }

  /** Restart now: in Edit mode with nothing playing, after the questions quitting asks. */
  async function restart() {
    if (!installs || state.step !== 'ready') return { error: 'There is nothing to install yet.' };
    if (!quiet({ mode: mode(), sounding: sounding() })) return { error: 'Restart in Edit mode, with nothing playing.' };
    if (!(await quit())) return { canceled: true };
    // (asked again: the questions may have taken a while, and a GO pressed meanwhile is a show again)
    if (!quiet({ mode: mode(), sounding: sounding() })) return { error: 'Restart in Edit mode, with nothing playing.' };
    log(`restarting into ${state.version}`);
    install();
    return { ok: true };
  }

  /** Every little while: hide everything in Show mode or while playing (and stop a download); otherwise, check when due. */
  function tick() {
    if (!enabled) return;
    if (!quiet({ mode: mode(), sounding: sounding() })) {
      if (download) { const t = download; download = null; try { t.cancel(); } catch { /* gone */ } log('download stopped: Show mode or sound playing'); set({ step: 'available', percent: 0 }); }
      set({ hidden: true });
      return;
    }
    set({ hidden: false });
    if (state.step === 'idle' && due(settings(), now()) && now() - lastTry >= RETRY) check();
  }

  /** The two settings. Changing the feed forgets what the other one offered, and checks again soon. */
  function configure(change: { auto?: unknown; test?: unknown } = {}) {
    const was = settings();
    const next: Partial<UpdateSettings> = {};
    if ('auto' in change) next.auto = !!change.auto;
    if ('test' in change) next.test = !!change.test;
    if ('test' in next && next.test !== was.test) {
      next.lastCheck = 0; lastTry = 0;
      if (download) { const t = download; download = null; try { t.cancel(); } catch { /* gone */ } }
      if (state.step !== 'ready') set({ step: 'idle', version: '', percent: 0 });
    }
    keep(next);
    return { ok: true, ...settingsOf(getConfig()) };
  }

  return { check, download: get, later, restart, tick, configure, state: view, settings };
}

export type Updates = ReturnType<typeof createUpdates>;

export { createUpdates, feedFor, feedFile, feedReader, compareVersions, settingsOf, quiet, due, said, FEED, TEST_FEED, PAGE, DAY };
