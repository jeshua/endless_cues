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
 *
 * The updater itself is given (electron-updater's autoUpdater in the app, a fake in the tests): this file never
 * requires Electron. What it needs of one: on(event, fn), setFeedURL({ provider, url }), checkForUpdates(),
 * downloadUpdate(token), quitAndInstall(); `token()` makes the cancellation token a download is given.
 */

const FEED = 'https://downloads.endlesscues.com/';
const TEST_FEED = `${FEED}test/`;
const DAY = 24 * 3600e3;
const RETRY = 3600e3;             // an automatic check that failed (no connection, most often) is tried again an hour later

/** The feed for this computer's choice: everyone's, or the test versions'. EC_UPDATE_FEED (a test) overrides both. */
function feedFor(settings, env = {}) {
  if (env.EC_UPDATE_FEED) return env.EC_UPDATE_FEED.replace(/\/*$/, '/');
  return settings.test ? TEST_FEED : FEED;
}

/** This computer's update settings (config.json's `updates`), with their defaults: checking on, test versions off. */
function settingsOf(config) {
  const u = (config && config.updates) || {};
  return { auto: u.auto !== false, test: u.test === true, lastCheck: Number(u.lastCheck) || 0 };
}

/** Whether anything about updates may happen now: Edit mode, and nothing playing. */
const quiet = ({ mode, sounding }) => mode !== 'show' && !sounding;

/** Whether a check is due by itself: switched on, and a day since the last one that got an answer. */
function due(settings, now) {
  return settings.auto && (!settings.lastCheck || now - settings.lastCheck >= DAY);
}

/** An error from a check or a download, in plain words. */
function said(err) {
  const m = String((err && (err.code || '')) + ' ' + ((err && err.message) || err || ''));
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT|FAILED)|ADDRESS_UNREACHABLE/i.test(m)) return 'There is no connection to endlesscues.com.';
  if (/ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|\b404\b/.test(m)) return 'The update server has no version for this computer yet.';
  if (/cancel/i.test(m)) return 'The download was stopped.';
  if (/sha512 checksum mismatch|checksum/i.test(m)) return 'The download was damaged. Try again.';
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
function createUpdates({ updater, token = () => null, mode = () => 'edit', sounding = () => false, getConfig = () => ({}), saveConfig = () => {},
  version = '0.0.0', env = {}, log = () => {}, now = Date.now, told = () => {}, ask = () => {}, quit = async () => true, install = () => updater.quitAndInstall(), enabled = true }) {
  // step: idle | checking | available | downloading | ready
  let state = { step: 'idle', version: '', percent: 0, hidden: false };
  let manual = false;                 // the check under way was asked for: its answer is said, whatever it is
  let lastTry = 0;                    // when an automatic check was last tried (answered or not)
  let download = null;                // the cancellation token of a download under way
  let feed = '';

  const set = (change) => {
    const next = { ...state, ...change };
    if (Object.keys(next).every((k) => next[k] === state[k])) return;
    state = next;
    told(view());
  };
  const view = () => ({ ...state, visible: !state.hidden && ['available', 'downloading', 'ready'].includes(state.step) });
  const settings = () => settingsOf(getConfig());
  const keep = (change) => saveConfig({ updates: { ...((getConfig() || {}).updates || {}), ...change } });

  function point() {
    const url = feedFor(settings(), env);
    if (url === feed) return;
    feed = url;
    updater.setFeedURL({ provider: 'generic', url, channel: 'latest' });
    log(`feed ${url}`);
  }

  if (enabled) {
    updater.on('update-available', (info) => {
      log(`${info.version} is available`);
      set({ step: 'available', version: info.version, percent: 0 });
    });
    updater.on('update-not-available', (info) => {
      log(`none newer than ${version}${info && info.version ? ` (the feed has ${info.version})` : ''}`);
      if (state.step === 'checking') set({ step: 'idle' });
      if (manual) ask('You have the latest version.');
    });
    updater.on('download-progress', (p) => { if (state.step === 'downloading') set({ percent: Math.floor(p.percent || 0) }); });
    updater.on('update-downloaded', (info) => {
      download = null;
      log(`${info.version} is downloaded: it installs when the app quits`);
      set({ step: 'ready', version: info.version, percent: 100 });
    });
    updater.on('error', (err) => {
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
      if (state.step === 'checking') set({ step: 'idle' });         // (an updater that answered nothing)
      return { ok: true, step: state.step, version: state.version };
    } catch (err) {
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
    download = token();
    set({ step: 'downloading', percent: 0 });
    try {
      await updater.downloadUpdate(download);
      return { ok: true };
    } catch (err) {
      const stopped = !download || /cancel/i.test(String((err && err.message) || err));
      download = null;
      log(`download of ${v} ${stopped ? 'stopped' : `failed: ${(err && err.message) || err}`}`);
      if (state.step === 'downloading') set({ step: 'available', percent: 0 });
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
    if (state.step !== 'ready') return { error: 'There is nothing to install yet.' };
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
  function configure(change = {}) {
    const was = settings();
    const next = {};
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

module.exports = { createUpdates, feedFor, settingsOf, quiet, due, said, FEED, TEST_FEED, DAY };
