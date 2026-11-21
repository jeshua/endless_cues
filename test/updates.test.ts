// Updates (core/update/updates.ts): when the app may look, what it says, and that nothing happens during a show.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { createUpdates, feedFor, feedFile, feedReader, compareVersions, settingsOf, due, said, FEED, TEST_FEED, PAGE, DAY } from '../core/update/updates';
import type { UpdateConfig, UpdateToken, UpdateView } from '../core/update/updates';

/** The stand-in's own counters, beside what the controller needs of an updater. */
interface FakeUpdater extends EventEmitter {
  feeds: { provider: string; url: string; channel?: string }[]; checks: number; downloads: number; installed: number; latest: string; fail: Error | null;
  setFeedURL(o: { provider: string; url: string; channel?: string }): number;
  checkForUpdates(): Promise<{ isUpdateAvailable: boolean }>;
  downloadUpdate(token: UpdateToken | null): Promise<unknown>;
  finish(): void;
  quitAndInstall(): void;
}
type CancelToken = UpdateToken & { onCancel?: () => void };

/** A stand-in for electron-updater: the feed has `latest`; a download finishes when `finish()` is called. */
function fakeUpdater({ current = '0.3.0-alpha.2', latest = '0.3.0-alpha.3', fail = null }: { current?: string; latest?: string; fail?: Error | null } = {}): FakeUpdater {
  const u = new EventEmitter() as FakeUpdater;
  u.feeds = []; u.checks = 0; u.downloads = 0; u.installed = 0; u.latest = latest; u.fail = fail;
  let pending: { resolve: (v: unknown) => void; reject: (e: Error) => void } | null = null;
  u.setFeedURL = (o) => u.feeds.push(o);
  u.checkForUpdates = async () => {
    u.checks++;
    if (u.fail) throw u.fail;
    const newer = u.latest !== current;
    u.emit(newer ? 'update-available' : 'update-not-available', { version: u.latest });
    return { isUpdateAvailable: newer };
  };
  u.downloadUpdate = (token: CancelToken | null) => new Promise((resolve, reject) => {
    u.downloads++;
    pending = { resolve, reject };
    if (token) token.onCancel = () => reject(new Error('cancelled'));
  });
  u.finish = () => { u.emit('download-progress', { percent: 100 }); u.emit('update-downloaded', { version: u.latest }); pending!.resolve([]); };
  u.quitAndInstall = () => { u.installed++; };
  return u;
}
const token = (): CancelToken => ({ cancel(this: CancelToken) { if (this.onCancel) this.onCancel(); } });

function rig(opts: { config?: UpdateConfig; now?: number; env?: { EC_UPDATE_FEED?: string }; current?: string; latest?: string; fail?: Error | null } = {}) {
  const updater = fakeUpdater(opts);
  const world = { mode: 'edit', sounding: false, config: opts.config || {}, now: opts.now || 1e12, said: [] as string[], shown: [] as UpdateView[], quitAnswer: true, quits: 0 };
  const u = createUpdates({ updater, token, version: '0.3.0-alpha.2', mode: () => world.mode, sounding: () => world.sounding,
    getConfig: () => world.config, saveConfig: (c) => Object.assign(world.config, c), now: () => world.now,
    told: (s) => world.shown.push(s), ask: (t) => world.said.push(t), quit: async () => { world.quits++; return world.quitAnswer; }, env: opts.env || {} });
  return { u, updater, world };
}
const flush = () => new Promise((r) => setImmediate(r));

test('the feed: everyone’s by default, the test versions’ when chosen, a test feed above both', () => {
  assert.equal(feedFor({ test: false }), FEED);
  assert.equal(feedFor({ test: true }), TEST_FEED);
  assert.equal(TEST_FEED, 'https://downloads.endlesscues.com/test/');
  assert.equal(feedFor({ test: true }, { EC_UPDATE_FEED: 'http://127.0.0.1:8123' }), 'http://127.0.0.1:8123/');
  assert.deepEqual(settingsOf({}), { auto: true, test: false, lastCheck: 0 }, 'checking is on, test versions off');
  assert.deepEqual(settingsOf({ updates: { auto: false, test: true, lastCheck: 5 } }), { auto: false, test: true, lastCheck: 5 });
});

test('a check is due once a day, and never while switched off', () => {
  assert.ok(due({ auto: true, test: false, lastCheck: 0 }, 1e12));
  assert.ok(!due({ auto: true, test: false, lastCheck: 1e12 - DAY + 1000 }, 1e12));
  assert.ok(due({ auto: true, test: false, lastCheck: 1e12 - DAY }, 1e12));
  assert.ok(!due({ auto: false, test: false, lastCheck: 0 }, 1e12));
});

test('the daily check waits for Edit mode with nothing playing, and its line hides in Show mode', async () => {
  const { u, updater, world } = rig();
  world.mode = 'show'; u.tick(); await flush();
  assert.equal(updater.checks, 0, 'Show mode: no check');
  world.mode = 'edit'; world.sounding = true; u.tick(); await flush();
  assert.equal(updater.checks, 0, 'sound playing: no check');
  world.sounding = false; u.tick(); await flush();
  assert.equal(updater.checks, 1);
  assert.equal(updater.feeds[0].url, FEED);
  assert.equal(updater.feeds[0].provider, 'generic');
  assert.deepEqual([u.state().step, u.state().version, u.state().visible], ['available', '0.3.0-alpha.3', true]);
  assert.ok(world.config.updates!.lastCheck, 'the check is remembered');
  world.mode = 'show'; u.tick();
  assert.equal(u.state().visible, false, 'hidden in Show mode');
  world.mode = 'edit'; u.tick();
  assert.equal(u.state().visible, true, 'back in Edit');
  // and not again today
  u.later(); u.tick(); await flush();
  assert.equal(updater.checks, 1);
  assert.equal(u.state().visible, false, 'Not now hides it');
  world.now += DAY; u.tick(); await flush();
  assert.equal(updater.checks, 2, 'tomorrow it looks again');
  assert.equal(u.state().visible, true);
});

test('switched off, nothing is checked by itself; Help ▸ Check for Updates… still works and says the answer', async () => {
  const { u, updater, world } = rig({ latest: '0.3.0-alpha.2', config: { updates: { auto: false } } });
  u.tick(); await flush();
  assert.equal(updater.checks, 0);
  await u.check({ manual: true });
  assert.equal(updater.checks, 1);
  assert.deepEqual(world.said, ['You have the latest version.']);
  world.mode = 'show';
  await u.check({ manual: true });
  assert.equal(updater.checks, 1, 'not in Show mode');
  assert.match(world.said[1], /Show mode/);
});

test('an offline check is silent by itself, plain when asked, and tried again an hour later', async () => {
  const err = Object.assign(new Error('net::ERR_INTERNET_DISCONNECTED'), {});
  const { u, updater, world } = rig({ fail: err });
  u.tick(); await flush();
  assert.equal(updater.checks, 1);
  assert.deepEqual(world.said, [], 'nothing said');
  assert.equal(world.config.updates, undefined, 'a check that got no answer is not counted');
  u.tick(); await flush();
  assert.equal(updater.checks, 1, 'not again at once');
  world.now += 3600e3; u.tick(); await flush();
  assert.equal(updater.checks, 2);
  await u.check({ manual: true });
  assert.deepEqual(world.said, ['Could not check for updates. There is no connection to endlesscues.com.']);
  assert.equal(said(new Error('Could not locate update bundle for com.github.Electron within file:///x/')), 'macOS could not install it over this copy of the app.');
  assert.equal(said(new Error('Cannot find channel "latest-mac.yml" update info: HttpError: 404')), 'The update server has no version for this computer yet.');
});

test('nothing downloads until Download, and Show mode stops a download under way', async () => {
  const { u, updater, world } = rig();
  await u.check({ manual: true });
  assert.equal(updater.downloads, 0, 'found, not fetched');
  world.mode = 'show';
  assert.match((await u.download()).error!, /Edit mode/);
  world.mode = 'edit';
  const going = u.download();
  assert.equal(u.state().step, 'downloading');
  world.mode = 'show'; u.tick();
  await going;
  assert.deepEqual([u.state().step, u.state().visible], ['available', false], 'stopped, and offered again in Edit');
  world.mode = 'edit'; u.tick();
  const again = u.download();
  updater.finish(); await again;
  assert.deepEqual([u.state().step, u.state().version, u.state().visible], ['ready', '0.3.0-alpha.3', true]);
  assert.equal(updater.installed, 0, 'never installed by itself');
});

test('Restart now: only in Edit mode with nothing playing, and only after quitting’s questions say yes', async () => {
  const { u, updater, world } = rig();
  assert.match((await u.restart()).error!, /nothing to install/);
  await u.check(); const d = u.download(); updater.finish(); await d;
  world.sounding = true;
  assert.match((await u.restart()).error!, /nothing playing/);
  world.sounding = false; world.mode = 'show';
  assert.match((await u.restart()).error!, /Edit mode/);
  world.mode = 'edit'; world.quitAnswer = false;
  assert.deepEqual(await u.restart(), { canceled: true }, 'Cancel at the unsaved-changes question');
  assert.equal(updater.installed, 0);
  world.quitAnswer = true;
  assert.deepEqual(await u.restart(), { ok: true });
  assert.equal(updater.installed, 1);
  assert.equal(world.quits, 2);
});

test('a download the system will not install (its signature refused) stops saying it will install', async () => {
  const { u, updater, world } = rig();
  await u.check(); const d = u.download(); updater.finish(); await d;
  updater.emit('error', new Error('Could not get code signature for running application'));
  assert.equal(u.state().visible, false);
  assert.match(world.said[0], /^Version 0\.3\.0-alpha\.3 cannot be installed\. macOS refused/);
});

test('Test versions reads the test feed, forgets what everyone’s offered, and checks again', async () => {
  const { u, updater, world } = rig();
  await u.check();
  assert.equal(u.state().step, 'available');
  u.configure({ test: true });
  assert.equal(world.config.updates!.test, true);
  assert.equal(u.state().step, 'idle');
  u.tick(); await flush();
  assert.equal(updater.checks, 2, 'due again at once');
  assert.equal(updater.feeds[updater.feeds.length - 1].url, TEST_FEED);
  u.configure({ auto: false });
  assert.deepEqual(u.settings().auto, false);
});

test('a copy run from source never checks, and says so when asked', async () => {
  const said: string[] = [];
  const u = createUpdates({ updater: fakeUpdater(), enabled: false, ask: (t) => said.push(t) });
  u.tick();
  await u.check({ manual: true });
  assert.match(said[0], /runs from source/);
});

test('the feed’s file for each platform, by electron-updater’s names: one for Windows, one per architecture on Linux', () => {
  assert.equal(feedFile('darwin', 'arm64'), 'latest-mac.yml');
  assert.equal(feedFile('win32', 'x64'), 'latest.yml');
  assert.equal(feedFile('win32', 'arm64'), 'latest.yml');
  assert.equal(feedFile('linux', 'x64'), 'latest-linux.yml');
  assert.equal(feedFile('linux', 'arm64'), 'latest-linux-arm64.yml');
});

test('versions compare as releases are ordered', () => {
  for (const [a, b] of [['0.3.0-alpha.10', '0.3.0-alpha.9'], ['0.3.0-beta.1', '0.3.0-alpha.9'], ['0.3.0', '0.3.0-rc.2'], ['0.3.1-alpha.1', '0.3.0'], ['1.0.0', '0.9.9']]) {
    assert.ok(compareVersions(a, b) > 0, `${a} is after ${b}`); assert.ok(compareVersions(b, a) < 0, `${b} is before ${a}`);
  }
  assert.equal(compareVersions('0.3.0-alpha.7', '0.3.0-alpha.7'), 0);
});

/** A .deb install: the feed reader over a pretend feed, and the controller told it cannot install. */
function debRig(feed: string | null) {
  const gets: string[] = [], opened: string[] = [], said: string[] = [];
  let installed = 0, quits = 0;
  const updater = feedReader({ version: '0.3.0-alpha.2', file: 'latest-linux.yml', get: async (url) => { gets.push(url); return feed; } });
  const u = createUpdates({ updater, version: '0.3.0-alpha.2', installs: false, open: (url) => opened.push(url), ask: (t) => said.push(t),
    quit: async () => { quits++; return true; }, install: () => { installed++; } });
  return { u, gets, opened, said, counts: () => ({ installed, quits }) };
}

test('a .deb install: one GET of the feed, a newer version said with the download page, and nothing ever downloaded or installed', async () => {
  const { u, gets, opened, counts } = debRig('version: 0.3.0-alpha.3\nfiles:\n  - url: Endless-Cues-0.3.0-alpha.3-linux-x64.AppImage\n');
  await u.check();
  assert.deepEqual(gets, [`${FEED}latest-linux.yml`]);
  assert.deepEqual([u.state().step, u.state().version, u.state().visible, u.state().page], ['available', '0.3.0-alpha.3', true, PAGE]);
  assert.equal(PAGE, 'https://endlesscues.com/');
  const r = await u.download();
  assert.deepEqual(r, { ok: true, opened: PAGE });
  assert.deepEqual(opened, [PAGE], 'Download opens the download page');
  assert.equal(u.state().step, 'available', 'nothing is downloading');
  assert.match((await u.restart()).error!, /nothing to install/);
  assert.deepEqual(counts(), { installed: 0, quits: 0 });
  await assert.rejects(Promise.resolve(feedReader({ version: '1.0.0', file: 'x.yml', get: async () => '' }).downloadUpdate()), /download page/);
});

test('a .deb install: the same version or an older one is not offered; a missing feed says so when asked', async () => {
  const same = debRig('version: 0.3.0-alpha.2\n');
  await same.u.check({ manual: true });
  assert.equal(same.u.state().visible, false);
  assert.match(same.said[0], /latest version/);
  const older = debRig('version: 0.3.0-alpha.1\n');
  await older.u.check();
  assert.equal(older.u.state().step, 'idle');
  const none = debRig(null);
  await none.u.check({ manual: true });
  assert.match(none.said[0], /has no version for this computer yet/);
});

test('Windows refusing an installer signed by someone else is said in plain words', () => {
  assert.match(said(new Error('ERR_UPDATER_INVALID_SIGNATURE: New version 1.0.0 is not signed by the application owner: publisherNames: X')), /^Windows refused the new version: it is not signed by the same publisher/);
});
