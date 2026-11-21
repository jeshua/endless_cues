// bin/release.ts publish: what it refuses, and the order it uploads in, against a fake bucket (nothing leaves this process).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { publishRelease, publishDownloads, readFeed, feedPointingAt } from '../bin/release.js';
import type { FileRecord, PublishOptions, Release } from '../bin/release';

const BASE = 'https://downloads.example.org/';
const V = '0.3.0-alpha.3';

/** A built release in a temp folder: two dmgs, two zips, their blockmaps and the feed, with release.json's record of them. */
function built({ version = V, signed = true, dirty = false, feedVersion = version }: { version?: string; signed?: boolean; dirty?: boolean; feedVersion?: string } = {}): { dir: string; release: Release } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-publish-'));
  const rec = (file: string, body: string): FileRecord => { fs.writeFileSync(path.join(dir, file), body); return { file, arch: /arm64/.test(file) ? 'arm64' : 'x64', bytes: Buffer.byteLength(body), sha256: crypto.createHash('sha256').update(body).digest('hex') }; };
  const n = (a: string, ext: string) => `Endless-Cues-${version}-mac-${a}.${ext}`;
  const files = ['arm64', 'x64'].map((a) => rec(n(a, 'dmg'), `dmg ${a}`.repeat(20)));
  const update = [
    ...['arm64', 'x64'].flatMap((a) => [rec(n(a, 'zip'), `zip ${a}`.repeat(30)), rec(`${n(a, 'zip')}.blockmap`, `bm ${a}`), rec(`${n(a, 'dmg')}.blockmap`, `dbm ${a}`)]),
    rec('latest-mac.yml', `version: ${feedVersion}\nfiles:\n  - url: ${n('arm64', 'zip')}\n    sha512: abc\n    size: 600\n  - url: ${n('x64', 'zip')}\n    sha512: def\n    size: 540\npath: ${n('arm64', 'zip')}\nsha512: abc\nreleaseDate: '2026-11-20T10:00:00.000Z'\n`),
  ];
  return { dir, release: { version, signed, ...(dirty ? { dirty: true } : {}), files, update } };
}

/** A bucket in memory: what was uploaded, in order, served back at its address. */
function bucket({ lose = null, test = null }: { lose?: string | null; test?: string | null } = {}) {
  const held = new Map<string, Buffer>(), order: ({ key: string } & Parameters<PublishOptions['upload']>[2])[] = [];
  if (test != null) held.set('test/latest-mac.yml', Buffer.from(test));
  const keyOf = (url: string) => decodeURIComponent(url.slice(BASE.length));
  return {
    order, held,
    upload: async (key: string, file: string, o: Parameters<PublishOptions['upload']>[2]) => { order.push({ key, ...o }); if (key !== lose) held.set(key, fs.readFileSync(file)); },
    size: async (url: string): Promise<number | null> => (held.has(keyOf(url)) ? held.get(keyOf(url))!.length : null),
    text: async (url: string) => (held.has(keyOf(url)) ? held.get(keyOf(url))!.toString('utf8') : null),
  };
}

test('everyone’s release: binaries first, each checked, the feed last and uncached; the test feed moved on to it', async () => {
  const { dir, release } = built();
  const b = bucket();
  const out = await publishRelease({ release, dir, channel: 'latest', base: BASE, ...b });
  const keys = b.order.map((o) => o.key);
  assert.deepEqual(keys.slice(0, 2), [`Endless-Cues-${V}-mac-arm64.dmg`, `Endless-Cues-${V}-mac-x64.dmg`]);
  assert.equal(keys.indexOf('latest-mac.yml'), keys.length - 2, 'the feed after every binary');
  assert.equal(keys[keys.length - 1], 'test/latest-mac.yml');
  assert.equal(keys.length, 10);
  assert.equal(b.order.find((o) => o.key === 'latest-mac.yml')!.cacheControl, 'no-cache');
  assert.deepEqual(out.uploaded, keys);
  // the test feed names everyone's files by their full address
  const copy = b.held.get('test/latest-mac.yml')!.toString();
  assert.match(copy, new RegExp(`url: ${BASE.replace(/[.]/g, '\\.')}Endless-Cues-0\\.3\\.0-alpha\\.3-mac-arm64\\.zip`));
  assert.match(copy, /^path: https:\/\/downloads\.example\.org\/Endless-Cues-.*-arm64\.zip$/m);
  assert.equal(readFeed(copy).version, V);
});

test('the test channel: everything under test/, and everyone’s feed untouched', async () => {
  const { dir, release } = built();
  const b = bucket();
  await publishRelease({ release, dir, channel: 'test', base: BASE, ...b });
  assert.ok(b.order.every((o) => o.key.startsWith('test/')));
  assert.equal(b.order[b.order.length - 1].key, 'test/latest-mac.yml');
  assert.ok(!b.held.has('latest-mac.yml'));
});

test('everyone’s release leaves a newer test version offered to testers', async () => {
  const { dir, release } = built({ version: '0.3.0-alpha.2' });
  const b = bucket({ test: 'version: 0.3.0-alpha.3\nfiles: []\n' });
  await publishRelease({ release, dir, channel: 'latest', base: BASE, ...b });
  assert.ok(!b.order.some((o) => o.key === 'test/latest-mac.yml'));
  assert.match(b.held.get('test/latest-mac.yml')!.toString(), /alpha\.3/);
});

test('a file that does not answer with its size stops it before the feed: nobody is offered a missing file', async () => {
  const { dir, release } = built();
  const b = bucket({ lose: `Endless-Cues-${V}-mac-x64.zip` });
  await assert.rejects(publishRelease({ release, dir, base: BASE, ...b }), /mac-x64\.zip answers with nothing.*The feed was not changed/);
  assert.ok(!b.order.some((o) => /latest-mac\.yml$/.test(o.key)));
});

test('it refuses an unsigned build, a dirty one, a feed for another version, a changed file and a missing zip', async () => {
  const refuse = async (make: () => { dir: string; release: Release }, re: RegExp) => { const { dir, release } = make(); const b = bucket(); await assert.rejects(publishRelease({ release, dir, base: BASE, ...b }), re); assert.equal(b.order.length, 0, 'nothing uploaded'); };
  await refuse(() => built({ signed: false }), /not signed and notarised/);
  await refuse(() => built({ dirty: true }), /uncommitted changes/);
  await refuse(() => built({ feedVersion: '0.3.0-alpha.1' }), /latest-mac\.yml is for 0\.3\.0-alpha\.1, the build is 0\.3\.0-alpha\.3/);
  await refuse(() => { const x = built(); fs.appendFileSync(path.join(x.dir, x.release.files[0].file), 'more'); return x; }, /its size has changed/);
  await refuse(() => { const x = built(); x.release.update = x.release.update!.filter((f) => !/x64\.zip$/.test(f.file)); return x; }, /names Endless-Cues-.*x64\.zip, which is not in the build/);
  await refuse(() => { const x = built(); delete x.release.update; return x; }, /no update files/);
  const { dir, release } = built();
  await assert.rejects(publishRelease({ release, dir, channel: 'beta', base: BASE, ...bucket() }), /no channel "beta"/);
});

test('a dry run uploads nothing and lists what it would', async () => {
  const { dir, release } = built();
  const b = bucket();
  const out = await publishRelease({ release, dir, base: BASE, ...b, dryRun: true });
  assert.equal(b.order.length, 0);
  assert.equal(out.uploaded.length, 10);
});

test('the feed is read for its version and the files it names', () => {
  const f = readFeed('version: 1.2.3\nfiles:\n  - url: a.zip\n    sha512: x\n  - url: b.zip\npath: a.zip\n');
  assert.deepEqual(f, { version: '1.2.3', named: ['a.zip', 'b.zip'] });
  assert.equal(feedPointingAt('  - url: a.zip\npath: a.zip\n', 'https://x/'), '  - url: https://x/a.zip\npath: https://x/a.zip\n');
});

/** A Windows build in a temp folder: two installers and release.json's record of them. */
function builtWin({ dirty = false, platform = 'win', testSigned = false }: { dirty?: boolean; platform?: string; testSigned?: boolean } = {}): { dir: string; release: Release } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-publish-win-'));
  const files = ['x64', 'arm64'].map((a) => { const file = `Endless-Cues-${V}-win-${a}-setup.exe`, body = `exe ${a}`.repeat(25); fs.writeFileSync(path.join(dir, file), body); return { file, arch: a, bytes: Buffer.byteLength(body), sha256: 'x' }; });
  return { dir, release: { platform, version: V, signed: false, ...(testSigned ? { testSigned } : {}), ...(dirty ? { dirty: true } : {}), files } };
}

test('Windows: the installers, each checked by its size where it is served; unsigned allowed, no feed touched', async () => {
  const { dir, release } = builtWin();
  const b = bucket();
  const out = await publishDownloads({ release, dir, base: BASE, ...b });
  assert.deepEqual(out.uploaded, [`Endless-Cues-${V}-win-x64-setup.exe`, `Endless-Cues-${V}-win-arm64-setup.exe`]);
  assert.ok(![...b.held.keys()].some((k) => /\.yml$/.test(k)), 'no feed');
  assert.equal(b.order[0].contentType, 'application/vnd.microsoft.portable-executable');
  const t = bucket();
  await publishDownloads({ release, dir, channel: 'test', base: BASE, ...t });
  assert.ok(t.order.every((o) => o.key.startsWith('test/')));
});

test('Windows: refuses a dirty build, a Mac release.json, one signed with a test certificate, and an upload that does not arrive whole', async () => {
  await assert.rejects(publishDownloads({ ...builtWin({ dirty: true }), base: BASE, ...bucket() }), /uncommitted changes/);
  await assert.rejects(publishDownloads({ ...builtWin({ platform: 'mac' }), base: BASE, ...bucket() }), /not a Windows build/);
  await assert.rejects(publishDownloads({ ...builtWin({ testSigned: true }), base: BASE, ...bucket() }), /test certificate/);
  const { dir, release } = builtWin();
  const b = bucket({ lose: `Endless-Cues-${V}-win-x64-setup.exe` });
  await assert.rejects(publishDownloads({ release, dir, base: BASE, ...b }), /answers with nothing/);
  // a cache still serving the file it replaces: refused, and told how to clear it
  const c = bucket(); c.size = async () => 99;
  await assert.rejects(publishDownloads({ ...builtWin(), base: BASE, ...c }), /answers with 99 bytes.*purge that address/);
  assert.equal(b.order.length, 1, 'it stops at the first that is not there');
});

test('Linux: the AppImage and the .deb, each checked where it is served, with their own types; a Windows release.json refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-publish-linux-'));
  const files = ['AppImage', 'deb'].map((ext) => { const file = `Endless-Cues-${V}-linux-x64.${ext}`, body = `${ext} `.repeat(30); fs.writeFileSync(path.join(dir, file), body); return { file, arch: 'x64', bytes: Buffer.byteLength(body), sha256: 'x' }; });
  const release: Release = { platform: 'linux', version: V, signed: false, files };
  const b = bucket();
  const out = await publishDownloads({ release, dir, base: BASE, ...b, platform: 'linux' });
  assert.deepEqual(out.uploaded, files.map((f) => f.file));
  assert.deepEqual(b.order.map((o) => o.contentType), ['application/octet-stream', 'application/vnd.debian.binary-package']);
  await assert.rejects(publishDownloads({ ...builtWin(), base: BASE, ...bucket(), platform: 'linux' }), /not a Linux build/);
});
