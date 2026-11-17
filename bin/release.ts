#!/usr/bin/env node
/**
 * Releases (docs/RELEASING.md says when and why; this does the mechanical parts).
 *
 *   node bin/release.js version <x.y.z[-alpha.n]>     set the version: package.json, package-lock.json, and the
 *                                                     changelog's "Unreleased" heading becomes that version, dated
 *   node bin/release.js mac [--x64-only|--arm64-only] build the .dmg files (to download) and the .zip files (for
 *                                                     updates) into dist.noindex/, with latest-mac.yml and the
 *                                                     blockmaps, and write dist.noindex/release.json (names, sizes,
 *                                                     SHA-256)
 *   node bin/release.js win [--x64-only|--arm64-only] build the Windows installers (NSIS, one each for 64-bit and
 *                                                     Arm; signed through Azure when EC_WIN_SIGNING is set, else
 *                                                     not) into dist-win.noindex/, with its own release.json.
 *                                                     Downloads only: no update feed for Windows yet.
 *   node bin/release.js publish --win [--channel test] upload those installers, each checked by its size there
 *   node bin/release.js publish [--channel test]      upload that build to downloads.endlesscues.com (R2): the
 *                                                     binaries first, each checked by its size there, the feed
 *                                                     (latest-mac.yml) last. --channel test puts it all under test/,
 *                                                     for "Test versions" only. Refuses an unsigned or dirty build.
 *                                                     --dry-run says what it would upload and uploads nothing.
 *   node bin/release.js site --base <url>             write the download into the site from the builds here (the
 *                                                     Mac's and Windows' release.json; a platform with no build
 *                                                     keeps what the site offers already):
 *                                                     releases.json, _redirects, and the marked parts of index.html
 *                                                     in the site folder. <url> is where the downloads are served from.
 *   node bin/release.js site --none                   put the site back to "nothing to download yet"
 *
 *   The site is not in this repository: it is the service repository's site/ folder, checked out beside this one
 *   (../endless_cues_service/site). --site-dir <dir> (or EC_SITE_DIR) names another; --release <file> reads
 *   another release.json than dist.noindex/release.json, and --win-release <file> another than dist-win.noindex/'s
 *   (naming either means only what is named is fresh).
 *
 * Only `publish` uploads, and only when a person runs it. Nothing here deploys, commits, tags or pushes: each of
 * those is a person's decision, and the last line of every command says what the next one is.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync, spawnSync } from 'child_process';
import { siteDir } from './site-dir';

/** One file of a build, as release.json records it (and the site, with where it is served from). */
export interface FileRecord { file: string; arch: string; bytes: number; sha256: string; url?: string; platform?: string }
/** release.json: what a build made. */
export interface Release {
  version: string; date?: string; commit?: string; signed: boolean; dirty?: boolean;
  platform?: string; testSigned?: boolean; files: FileRecord[]; update?: FileRecord[]; notes?: string[];
}
/** How a publish reaches the bucket and checks what it serves (the command line's, or a test's). */
export interface PublishOptions {
  release: Release | null; dir: string; channel?: string; base?: string;
  upload: (key: string, file: string, o: { contentType?: string; cacheControl?: string }) => Promise<unknown>;
  size: (url: string) => Promise<number | null>;
  text?: (url: string) => Promise<string | null>;
  log?: (line: string) => void; dryRun?: boolean;
}

const ROOT = path.join(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const write = (f: string, text: string) => fs.writeFileSync(path.join(ROOT, f), text);
const pkg = () => JSON.parse(read('package.json'));
const fail: (text: string) => never = (text) => { console.error(text); process.exit(1); };
const git = (...a: string[]) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
// (the date here, where the release is made: not UTC's, which is tomorrow for an evening's work west of Greenwich)
const today = () => { const d = new Date(), p2 = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };

/** x.y.z or x.y.z-alpha.n / -beta.n / -rc.n, as numbers to compare. */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/;
function parts(v: string) { const m = SEMVER.exec(v); return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? ['alpha', 'beta', 'rc'].indexOf(m[4]) : 3, Number(m[5] || 0)] : null; }
function newer(a: string, b: string) { const x = parts(a)!, y = parts(b)!; for (let i = 0; i < 5; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; }

function setVersion(v: string) {
  if (!parts(v)) fail(`"${v}" is not a version this project uses: 0.2.0, 0.2.0-alpha.1, 1.0.0-rc.2`);
  const was = pkg().version;
  if (!newer(v, was)) fail(`${v} is not after ${was}`);
  for (const f of ['package.json', 'package-lock.json']) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    const j = JSON.parse(read(f));
    j.version = v;
    if (j.packages && j.packages['']) j.packages[''].version = v;
    write(f, JSON.stringify(j, null, 2) + '\n');
  }
  let log = read('CHANGELOG.md');
  if (!/^## Unreleased\s*$/m.test(log)) fail('CHANGELOG.md has no "## Unreleased" heading to turn into this version');
  const body = log.split(/^## Unreleased\s*$/m)[1].split(/^## /m)[0].trim();
  if (!body) fail('Nothing is written under "## Unreleased" in CHANGELOG.md: say what changed first');
  log = log.replace(/^## Unreleased\s*$/m, `## Unreleased\n\n## ${v} · ${today()}`);
  write('CHANGELOG.md', log);
  console.log(`Version ${was} → ${v}.\nNext: look at the diff, commit it ("Version ${v}"), then: node bin/release.js mac`);
}

/** What this version's part of the changelog says, as plain lines. */
function notesOf(v: string) {
  const m = new RegExp(`^## ${v.replace(/[.]/g, '\\.')} · .*$`, 'm').exec(read('CHANGELOG.md'));
  if (!m) return [];
  return read('CHANGELOG.md').slice(m.index + m[0].length).split(/^## /m)[0].split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
}

function buildMac(flags: string[]) {
  if (process.platform !== 'darwin') fail('A .dmg is built on a Mac.');
  const v = pkg().version;
  const dirty = git('status', '--porcelain') !== '';
  const info = { version: v, commit: git('rev-parse', '--short', 'HEAD'), date: today(), ...(dirty ? { dirty: true } : {}) };
  write('app/build-info.json', JSON.stringify(info, null, 2) + '\n');
  // Signed and notarised only when this computer has a Developer ID and the notary's credentials are in the
  // environment (APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD +
  // APPLE_TEAM_ID). Otherwise the build is ad-hoc signed, and says so: macOS will not open it without a detour.
  const identity = /Developer ID Application/.test(spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }).stdout || '');
  // The notary's credentials: a profile in the keychain (made once with `xcrun notarytool store-credentials
  // "endless-cues" …`; nothing secret is in a file or the environment), or the environment's own.
  const profile = process.env.EC_NOTARY_PROFILE || 'endless-cues';
  const asked = spawnSync('xcrun', ['notarytool', 'history', '--keychain-profile', profile], { encoding: 'utf8' });
  const said = `${asked.stdout || ''}${asked.stderr || ''}`;
  const inKeychain = asked.status === 0;
  if (identity && !inKeychain && /agreement/i.test(said)) fail(`Apple's notary refused: ${said.trim().split('\n').pop()}\nAccept the pending agreement (developer.apple.com/account, and App Store Connect ▸ Business), wait a few minutes, and run this again. To build unsigned meanwhile: EC_UNSIGNED=1 node bin/release.js mac`);
  const notary = inKeychain || !!(process.env.APPLE_API_KEY || (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID));
  // A Developer ID is here but the notary's profile cannot be read: a locked screen hides keychain items, and a
  // build would quietly come out unsigned. Stop rather than make one nobody can publish (EC_UNSIGNED=1 still forces it).
  if (identity && !notary && !process.env.EC_UNSIGNED) fail(`The notary's profile "${profile}" cannot be read from the keychain: ${said.trim().split('\n')[0]}\nIf the screen is locked, unlock it and try again. If the profile is really gone: xcrun notarytool store-credentials "${profile}" --key <AuthKey_….p8> --key-id <id> --issuer <issuer>. To build unsigned on purpose: EC_UNSIGNED=1.`);
  const signed = identity && notary && !process.env.EC_UNSIGNED;
  const archs = flags.includes('--x64-only') ? ['x64'] : flags.includes('--arm64-only') ? ['arm64'] : ['arm64', 'x64'];
  fs.rmSync(path.join(ROOT, 'dist.noindex'), { recursive: true, force: true });
  // (the .zip is what an installed app updates from: macOS's updater takes a zip, not a disk image)
  const args = ['electron-builder', '--mac', 'dmg', 'zip', ...archs.map((a) => `--${a}`), '--publish', 'never',
    ...(signed ? [] : ['-c.mac.notarize=false', '-c.mac.hardenedRuntime=false', '-c.mac.identity=null'])];
  console.log(`Building ${v} (${info.commit}${dirty ? ', with uncommitted changes' : ''}) for ${archs.join(' and ')}, ${signed ? 'signed and notarised' : 'NOT signed'}…`);
  const r = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...(signed ? (inKeychain ? { APPLE_KEYCHAIN_PROFILE: profile } : {}) : { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }) } });
  fs.rmSync(path.join(ROOT, 'app/build-info.json'), { force: true });
  if (r.status !== 0) fail('The build failed.');
  const out = path.join(ROOT, 'dist.noindex');
  const record = (f: string): FileRecord => {
    const bytes = fs.readFileSync(path.join(out, f));
    return { file: f, arch: /arm64/.test(f) ? 'arm64' : 'x64', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  };
  const files = fs.readdirSync(out).filter((f) => f.endsWith('.dmg')).map(record);
  // what an installed app updates from: the zips, their blockmaps (so an update downloads only what changed) and
  // the feed that names them (electron-builder writes latest-mac.yml because package.json's build has a `publish`)
  const update = fs.readdirSync(out).filter((f) => /\.(zip|zip\.blockmap|dmg\.blockmap)$/.test(f) || f === FEED_FILE).sort().map(record);
  // What macOS itself will say of the app in each build, asked now and not assumed: "accepted" with "Notarized Developer ID".
  if (signed) for (const d of fs.readdirSync(out).filter((x) => /^mac/.test(x))) {
    const appPath = path.join(out, d, fs.readdirSync(path.join(out, d)).find((x) => x.endsWith('.app'))!);
    const g = spawnSync('spctl', ['-a', '-vv', '-t', 'exec', appPath], { encoding: 'utf8' });
    const verdict = `${g.stdout || ''}${g.stderr || ''}`.trim().split('\n').slice(0, 2).join(' · ');
    console.log(`  ${d}: ${verdict}`);
    if (g.status !== 0 || !/Notarized Developer ID/.test(verdict)) fail('macOS does not accept that build: it is not offered as signed.');
  }
  if (!files.length) fail('No .dmg came out of the build.');
  // (only the mounted app bundles are in the way of Spotlight; the .dmg files and this record stay)
  for (const d of fs.readdirSync(out)) if (/^mac/.test(d)) fs.rmSync(path.join(out, d), { recursive: true, force: true });
  if (!update.some((f) => f.file === FEED_FILE)) fail(`No ${FEED_FILE} came out of the build: is the \`publish\` entry still in package.json's build?`);
  const release = { version: v, date: info.date, commit: info.commit, signed, ...(dirty ? { dirty: true } : {}), files, update, notes: notesOf(v) };
  fs.writeFileSync(path.join(out, 'release.json'), JSON.stringify(release, null, 2) + '\n');
  for (const f of [...files, ...update.filter((u) => u.file.endsWith('.zip'))]) console.log(`  dist.noindex/${f.file}   ${(f.bytes / 1e6).toFixed(1)} MB   sha256 ${f.sha256}`);
  if (dirty) console.log('  (built with uncommitted changes: fine for trying, not for publishing)');
  if (!signed) console.log('  NOT signed or notarised: on another Mac, macOS will say it cannot be opened until the person allows it by hand (docs/RELEASING.md).');
  console.log(signed && !dirty ? 'Next: node bin/release.js publish (or --channel test), then: node bin/release.js site --base https://downloads.endlesscues.com/'
    : 'This build cannot be published (unsigned or uncommitted): it is for trying on this computer.');
}

// ── Windows: installers to download, built on any computer (electron-builder makes NSIS installers without Windows) ──
const WIN_OUT = 'dist-win.noindex';

/**
 * The Windows installers, one for each architecture (a 64-bit PC, and Windows on Arm), into dist-win.noindex/ with
 * their release.json. Signed through Azure Artifact Signing when EC_WIN_SIGNING says which certificate (the app, its
 * uninstaller and the installer, by build/sign-win.ts), with a certificate of your own to try the path when
 * EC_WIN_SIGN_P12 names one (not offered as signed: Windows trusts none), and otherwise not code-signed, so
 * SmartScreen warns the first time. Every signature is checked after. Downloads only: no update feed is written for
 * Windows, and an installed copy says the server has no version for it.
 */
function buildWin(flags: string[]) {
  const v = pkg().version;
  const dirty = git('status', '--porcelain') !== '';
  const info = { version: v, commit: git('rev-parse', '--short', 'HEAD'), date: today(), ...(dirty ? { dirty: true } : {}) };
  const archs = flags.includes('--x64-only') ? ['x64'] : flags.includes('--arm64-only') ? ['arm64'] : ['x64', 'arm64'];
  const out = path.join(ROOT, WIN_OUT);
  fs.rmSync(out, { recursive: true, force: true });
  write('app/build-info.json', JSON.stringify(info, null, 2) + '\n');
  const { signatureBytes } = require('../build/sign-win') as typeof import('../build/sign-win');
  const how = process.env.EC_WIN_SIGN_P12 ? 'test' : process.env.EC_WIN_SIGNING ? 'azure' : null;
  const env: NodeJS.ProcessEnv = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  if (how === 'azure') {
    // (one token for the whole build: it lasts an hour; jsign reads it from the environment, never from its arguments)
    const t = spawnSync('az', ['account', 'get-access-token', '--resource', 'https://codesigning.azure.net', '--query', 'accessToken', '-o', 'tsv'], { encoding: 'utf8' });
    if (t.error) fail('Signing needs the Azure command line (brew install azure-cli), signed in: az login');
    if (t.status !== 0 || !t.stdout.trim()) fail(`Azure gave no signing token. Sign in (az login) and try again.\n${(t.stderr || '').trim()}`);
    env.EC_WIN_SIGN_TOKEN = t.stdout.trim();
  }
  const signing = how ? ['-c.win.signtoolOptions.sign=build/sign-win.js'] : [];
  console.log(`Building ${v} (${info.commit}${dirty ? ', with uncommitted changes' : ''}) for Windows ${archs.join(' and ')}, ${how === 'azure' ? 'signed through Azure Artifact Signing' : how === 'test' ? 'signed with a test certificate (not trusted by Windows)' : 'NOT code-signed'}…`);
  try {
    // (one build an architecture, so each installer carries only its own: a combined one is twice the download)
    for (const a of archs) {
      const r = spawnSync('npx', ['electron-builder', '--win', 'nsis', `--${a}`, '--publish', 'never', `-c.directories.output=${WIN_OUT}`,
        '-c.nsis.artifactName=Endless-Cues-${version}-win-${arch}-setup.${ext}', ...signing], { cwd: ROOT, stdio: 'inherit', env });
      if (r.status !== 0) fail(`The ${a} build failed.`);
    }
  } finally { fs.rmSync(path.join(ROOT, 'app/build-info.json'), { force: true }); }
  const files = fs.readdirSync(out).filter((f) => /-win-(x64|arm64)-setup\.exe$/.test(f)).sort().map((f): FileRecord => {
    const bytes = fs.readFileSync(path.join(out, f));
    return { file: f, arch: /arm64/.test(f) ? 'arm64' : 'x64', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  });
  if (files.length !== archs.length) fail(`Expected ${archs.length} installer(s), found ${files.length}.`);
  if (how) {
    // (the installer, and the program it installs: each must carry a signature, or the build is not offered as signed)
    const apps = fs.readdirSync(out).filter((d) => /^win-.*unpacked$/.test(d)).map((d) => path.join(WIN_OUT, d, `${pkg().build.productName}.exe`));
    const unsigned = [...files.map((f) => path.join(WIN_OUT, f.file)), ...apps].filter((f) => !signatureBytes(fs.readFileSync(path.join(ROOT, f))));
    if (apps.length !== archs.length || unsigned.length) fail(`Not signed: ${unsigned.join(', ') || 'the unpacked app was not found'}`);
  }
  // (what is not offered goes: the unpacked apps, the blockmaps and the feed electron-builder writes regardless)
  for (const f of fs.readdirSync(out)) if (!files.some((x) => x.file === f)) fs.rmSync(path.join(out, f), { recursive: true, force: true });
  const release = { platform: 'win', version: v, date: info.date, commit: info.commit, signed: how === 'azure', ...(how === 'test' ? { testSigned: true } : {}), ...(dirty ? { dirty: true } : {}), files, notes: notesOf(v) };
  fs.writeFileSync(path.join(out, 'release.json'), JSON.stringify(release, null, 2) + '\n');
  for (const f of files) console.log(`  ${WIN_OUT}/${f.file}   ${(f.bytes / 1e6).toFixed(1)} MB   sha256 ${f.sha256}`);
  if (how !== 'azure') console.log(`  ${how ? 'Signed with a test certificate, which Windows does not trust' : 'Not code-signed'}: Windows SmartScreen says "Windows protected your PC" the first time; More info ▸ Run anyway.`);
  console.log(dirty ? '  (built with uncommitted changes: fine for trying, not for publishing)'
    : 'Next: try it on Windows, then node bin/release.js publish --win (or --channel test), then: node bin/release.js site --base https://downloads.endlesscues.com/');
}

/**
 * Publish the Windows installers: each uploaded and checked by the size its address answers with. There is no feed
 * to change, so nothing can be offered a missing file; unsigned is allowed (nothing installs it unasked).
 */
async function publishDownloads({ release: r, dir, channel = 'latest', base = DOWNLOADS, upload, size, log = () => {}, dryRun = false }: PublishOptions) {
  const refuse: (why: string) => never = (why) => { throw new Error(`Not published: ${why}`); };
  if (!['latest', 'test'].includes(channel)) refuse(`there is no channel "${channel}" (latest or test)`);
  if (!r || !r.version) refuse(`there is no ${WIN_OUT}/release.json: build first (node bin/release.js win)`);
  if (r.platform !== 'win') refuse('that release.json is not a Windows build.');
  if (r.testSigned) refuse('that build is signed with a test certificate, which Windows does not trust. Build it again without EC_WIN_SIGN_P12.');
  if (r.dirty) refuse('that build was made with uncommitted changes. Commit, build again, then publish.');
  if (!Array.isArray(r.files) || !r.files.length) refuse('that build has no installers.');
  for (const f of r.files) {
    const p = path.join(dir, f.file);
    if (!fs.existsSync(p)) refuse(`${f.file} is not in ${dir}.`);
    if (fs.statSync(p).size !== f.bytes) refuse(`${f.file} is not the file that was built (its size has changed).`);
  }
  const folder = channel === 'test' ? 'test/' : '';
  const uploaded: string[] = [];
  for (const f of r.files) {
    const key = folder + f.file;
    log(`  ${dryRun ? 'would upload' : 'uploading'} ${key}`);
    if (dryRun) { uploaded.push(key); continue; }
    await upload(key, path.join(dir, f.file), { contentType: 'application/vnd.microsoft.portable-executable' });
    uploaded.push(key);
    const at = `${base}${key.split('/').map(encodeURIComponent).join('/')}`;
    const got = await size(at);
    if (got !== f.bytes) refuse(`${at} answers with ${got == null ? 'nothing' : `${got} bytes`}, not ${f.bytes}.${got == null ? '' : ' A cache may still hold an older file of that name: purge that address (Cloudflare ▸ endlesscues.com ▸ Caching ▸ Custom Purge), then publish again.'}`);
  }
  return { uploaded };
}

// ── publishing: the downloads and the update feed (docs/RELEASING.md) ───────────────────────────────────────────
// Everything is served from one Cloudflare R2 bucket at downloads.endlesscues.com: everyone's versions at its top,
// the test versions under test/. An installed app reads latest-mac.yml from one of the two (Settings ▸ General ▸
// Test versions says which); that file names the zips beside it, so it is uploaded last, once every file it names
// is there and answers with the right size. A client never sees a feed that points at a missing file.
const DOWNLOADS = 'https://downloads.endlesscues.com/';
const BUCKET = 'endlesscues-downloads';
const FEED_FILE = 'latest-mac.yml';

/** What a feed file says: its version and the files it names. (Only what is needed: it is electron-builder's YAML.) */
function readFeed(text: string) {
  const version = (/^version:\s*['"]?([^'"\s]+)/m.exec(text) || [])[1] || '';
  const named = [...text.matchAll(/^[ \t]*(?:-[ \t]*)?(?:url|path):[ \t]*['"]?([^'"\s]+)/gm)].map((m) => m[1]);
  return { version, named: [...new Set(named)] };
}
/** The same feed for the test channel's folder: each file it names, by its full address in everyone's folder. */
function feedPointingAt(text: string, base: string) {
  return text.replace(/^([ \t]*(?:-[ \t]*)?(?:url|path):[ \t]*)['"]?([^'"\s]+)['"]?[ \t]*$/gm, (_m, a: string, f: string) => `${a}${/^https?:/.test(f) ? f : base + f}`);
}

/**
 * Publish a build: refuse what must not be offered, then upload in an order no client can be caught out by.
 *   release   dist.noindex/release.json, read
 *   dir       the folder its files are in
 *   channel   'latest' (everyone) or 'test'
 *   upload(key, file, { contentType, cacheControl })   puts one file in the bucket (rejects on failure)
 *   size(url)        resolves to the byte count that address answers with, through any cache (null: not there)
 *   text(url)        resolves to what that address answers with, past any cache (null: not there)
 * Resolves to { uploaded: [keys in order] }, or throws an Error whose message says why nothing (more) was sent.
 */
async function publishRelease({ release: r, dir, channel = 'latest', base = DOWNLOADS, upload, size, text, log = () => {}, dryRun = false }: PublishOptions) {
  const refuse: (why: string) => never = (why) => { throw new Error(`Not published: ${why}`); };
  if (!['latest', 'test'].includes(channel)) refuse(`there is no channel "${channel}" (latest or test)`);
  if (!r || !r.version) refuse('there is no release.json: build first (node bin/release.js mac)');
  if (r.dirty) refuse('that build was made with uncommitted changes. Commit, build again, then publish.');
  if (!r.signed) refuse('that build is not signed and notarised. An installed app would refuse it as an update, and macOS would refuse it as a download.');
  if (!Array.isArray(r.update) || !r.update.length) refuse('that build has no update files (it was made before updates were built): build again.');
  const feed = r.update.find((f) => f.file === FEED_FILE);
  if (!feed) refuse(`that build has no ${FEED_FILE}.`);
  const all = [...r.files, ...r.update];
  for (const f of all) {
    const p = path.join(dir, f.file);
    if (!fs.existsSync(p)) refuse(`${f.file} is not in ${dir}.`);
    if (fs.statSync(p).size !== f.bytes) refuse(`${f.file} is not the file that was built (its size has changed).`);
  }
  const feedText = fs.readFileSync(path.join(dir, FEED_FILE), 'utf8');
  const said = readFeed(feedText);
  if (said.version !== r.version) refuse(`${FEED_FILE} is for ${said.version || 'no version'}, the build is ${r.version}.`);
  for (const n of said.named) if (!all.some((f) => f.file === n)) refuse(`${FEED_FILE} names ${n}, which is not in the build.`);
  for (const d of r.files) if (!r.update.some((f) => f.file.endsWith('.zip') && f.arch === d.arch)) refuse(`there is no update zip for ${d.arch}.`);

  const folder = channel === 'test' ? 'test/' : '';
  const url = (key: string) => `${base}${key.split('/').map(encodeURIComponent).join('/')}`;
  const uploaded: string[] = [];
  const put = async (key: string, file: string, o: { contentType?: string; cacheControl?: string }) => {
    log(`  ${dryRun ? 'would upload' : 'uploading'} ${key}`);
    if (!dryRun) await upload(key, file, o);
    uploaded.push(key);
  };
  // 1. the binaries, each checked where it is served before anything names it
  const kind = (f: string) => (f.endsWith('.dmg') ? 0 : f.endsWith('.zip') ? 1 : 2);
  const binaries = all.filter((f) => f.file !== FEED_FILE).sort((a, b) => kind(a.file) - kind(b.file) || a.file.localeCompare(b.file));
  for (const f of binaries) {
    const key = folder + f.file;
    await put(key, path.join(dir, f.file), { contentType: f.file.endsWith('.dmg') ? 'application/x-apple-diskimage' : f.file.endsWith('.zip') ? 'application/zip' : 'application/octet-stream' });
    if (dryRun) continue;
    const got = await size(url(key));
    if (got !== f.bytes) refuse(`${url(key)} answers with ${got == null ? 'nothing' : `${got} bytes`}, not ${f.bytes}.${got == null ? '' : ' A cache may still hold an older file of that name: purge that address (Cloudflare ▸ endlesscues.com ▸ Caching ▸ Custom Purge), then publish again.'} The feed was not changed: no app has been offered this version.`);
  }
  // 2. the feed, last; never cached, so a new version is offered as soon as it is there
  const feedKey = folder + FEED_FILE;
  await put(feedKey, path.join(dir, FEED_FILE), { contentType: 'text/yaml', cacheControl: 'no-cache' });
  if (!dryRun && (await text!(url(feedKey))) !== feedText) refuse(`${url(feedKey)} does not answer with the feed just uploaded.`);
  // 3. everyone's version is a test version too: the test feed is moved on to it, unless it already offers a newer one
  if (channel === 'latest') {
    const testKey = `test/${FEED_FILE}`;
    const was = dryRun ? null : await text!(url(testKey));
    const wasVersion = was ? readFeed(was).version : '';
    if (wasVersion && parts(wasVersion) && !newer(r.version, wasVersion)) log(`  the test feed offers ${wasVersion}, which is not older: left as it is`);
    else {
      const copy = feedPointingAt(feedText, base);
      const tmp = path.join(fs.mkdtempSync(path.join((require('os') as typeof import('os')).tmpdir(), 'ec-feed-')), FEED_FILE);
      fs.writeFileSync(tmp, copy);
      await put(testKey, tmp, { contentType: 'text/yaml', cacheControl: 'no-cache' });
      if (!dryRun && (await text!(url(testKey))) !== copy) refuse(`${url(testKey)} does not answer with the feed just uploaded.`);
    }
  }
  return { uploaded };
}

/** `publish` from the command line: wrangler through `cf` (this project's Cloudflare token), and fetch to check. */
async function publish(flags: string[]) {
  const channel = flags.includes('--channel') ? flags[flags.indexOf('--channel') + 1] : 'latest';
  const win = flags.includes('--win');
  const file = flags.includes('--release') ? path.resolve(flags[flags.indexOf('--release') + 1] || '') : path.join(ROOT, win ? WIN_OUT : 'dist.noindex', 'release.json');
  const r: Release | null = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const dryRun = flags.includes('--dry-run');
  const upload = async (key: string, src: string, o: { contentType?: string; cacheControl?: string }) => {
    const args = ['cues/cloudflare', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', src, '--remote',
      ...(o.contentType ? ['--content-type', o.contentType] : []), ...(o.cacheControl ? ['--cache-control', o.cacheControl] : [])];
    const x = spawnSync('cf', args, { stdio: 'inherit', env: { ...process.env, AWS_PROFILE: 'cues' } });
    if (x.status !== 0) throw new Error(`the upload of ${key} failed (cf ${args.join(' ')})`);
  };
  const fresh = (u: string) => `${u}${u.includes('?') ? '&' : '?'}check=${Date.now()}`;
  // (as a downloader gets it: the plain address, through Cloudflare's cache, which can still hold an older file of the
  // same name for hours; the first byte alone answers with the whole file's size)
  const size = async (u: string) => {
    const x = await fetch(u, { headers: { range: 'bytes=0-0' } });
    if (!x.ok) return null;
    const whole = /\/(\d+)$/.exec(x.headers.get('content-range') || '');
    return whole ? Number(whole[1]) : Number(x.headers.get('content-length'));
  };
  const text = async (u: string) => { const x = await fetch(fresh(u), { headers: { 'cache-control': 'no-cache' } }); return x.ok ? x.text() : null; };
  console.log(`${dryRun ? 'Would publish' : 'Publishing'} ${r ? r.version : '(no build)'}${win ? ' for Windows' : ''} to ${channel === 'test' ? 'the test versions' : 'everyone'}…`);
  if (win) {
    try {
      const out = await publishDownloads({ release: r, dir: path.dirname(file), channel, upload, size, log: (l) => console.log(l), dryRun });
      console.log(dryRun ? `${out.uploaded.length} files would be uploaded. Nothing was.` : `Published: the Windows installers for ${r!.version} are at ${DOWNLOADS}${channel === 'test' ? 'test/' : ''}.`);
      if (channel !== 'test') console.log(`Next: node bin/release.js site --base ${DOWNLOADS}`);
    } catch (err) { fail((err as Error).message); }
    return;
  }
  try {
    const out = await publishRelease({ release: r, dir: path.dirname(file), channel, upload, size, text, log: (l) => console.log(l), dryRun });
    console.log(dryRun ? `${out.uploaded.length} files would be uploaded. Nothing was.` : `Published: ${DOWNLOADS}${channel === 'test' ? 'test/' : ''}${FEED_FILE} offers ${r!.version}.`);
    console.log(channel === 'test' ? 'Next: in an installed app, Settings ▸ General ▸ Test versions, then Help ▸ Check for Updates….'
      : `Next: node bin/release.js site --base ${DOWNLOADS}`);
  } catch (err) { fail((err as Error).message); }
}

/** The part of a page between <!-- release:NAME --> and <!-- /release:NAME -->, replaced. */
function fill(html: string, name: string, inner: string) {
  const re = new RegExp(`(<!-- release:${name} -->)[\\s\\S]*?(<!-- /release:${name} -->)`);
  if (!re.test(html)) fail(`the site's index.html has no <!-- release:${name} --> part`);
  return html.replace(re, (_m, a: string, b: string) => `${a}\n${inner}\n${b}`);
}
const EMAIL = 'jeshua@endlessformspuppetry.com';
const NOTIFY = `mailto:${EMAIL}?subject=Tell%20me%20when%20Endless%20Cues%20is%20out`;
// The words below are a note from one person, in the first person: the site's README.md ("Voice") says how he talks.
const WRITE = `<a class="cta" data-link="contact" href="mailto:${EMAIL}">Email me</a>`;
const MANUAL = '<a href="/docs/">The manual</a>';

const FINAL_NONE = `    <h2 id="h-final">Want to know when there&rsquo;s a download?</h2>
    <p class="lede">Email <a data-link="notify" href="${NOTIFY}"><span data-fill="email">${EMAIL}</span></a> and I&rsquo;ll tell you when there is one. If you like, say what you run your shows on now.</p>`;

function site(flags: string[]) {
  const dir = siteDir(flags);
  if (!fs.existsSync(path.join(dir, 'index.html'))) fail(`There is no site at ${dir}.\nThe site lives in the service repository (endless_cues_service/site): check it out beside this one, or say where it is with --site-dir <dir>.`);
  const readSite = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
  const writeSite = (f: string, text: string) => fs.writeFileSync(path.join(dir, f), text);
  let html = readSite('index.html');
  if (flags.includes('--none')) {
    html = fill(html, 'hero', `        <a class="cta primary" data-link="notify" href="${NOTIFY}">Get notified</a>\n        ${WRITE}`);
    html = fill(html, 'hero-fine', '');
    html = fill(html, 'status', '      <p class="lede">There&rsquo;s nothing to download yet.</p>');
    html = fill(html, 'download', '');
    html = fill(html, 'final', FINAL_NONE);
    writeSite('index.html', html);
    for (const f of ['releases.json', '_redirects']) fs.rmSync(path.join(dir, f), { force: true });
    console.log(`The site (${dir}) says there is nothing to download yet.`);
    return;
  }
  const base = flags[flags.indexOf('--base') + 1];
  if (!flags.includes('--base') || !/^https:\/\/[^\s]+$/.test(base || '')) fail('Say where the downloads are served from: --base https://…');
  // A fresh build for each platform (dist.noindex/ for the Mac, dist-win.noindex/ for Windows, or --release and
  // --win-release); a platform with none keeps what the site offers already (its releases.json).
  const named = flags.includes('--release') || flags.includes('--win-release');
  const fileOf = (flag: string, dflt: string) => (flags.includes(flag) ? path.resolve(flags[flags.indexOf(flag) + 1] || '') : named ? null : path.join(ROOT, dflt, 'release.json'));
  const fresh = (f: string | null): Release | null => (f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
  const macFile = fileOf('--release', 'dist.noindex'), winFile = fileOf('--win-release', WIN_OUT);
  if (flags.includes('--release') && !fs.existsSync(macFile!)) fail(`There is no ${path.relative(ROOT, macFile!)}: build first (node bin/release.js mac)`);
  if (flags.includes('--win-release') && !fs.existsSync(winFile!)) fail(`There is no ${path.relative(ROOT, winFile!)}: build first (node bin/release.js win)`);
  let prior: { latest?: Release; windows?: Release } = {}; try { prior = JSON.parse(readSite('releases.json')); } catch { /* nothing offered yet */ }
  const url = (f: FileRecord) => `${base.replace(/\/+$/, '')}/${encodeURIComponent(f.file)}`;
  const offer = (r: Release | null, kept: Release | undefined) => {
    if (r && r.dirty) fail('That build was made with uncommitted changes. Commit, build again, then write the site.');
    if (r && r.testSigned) fail('That Windows build is signed with a test certificate. Build it again without EC_WIN_SIGN_P12.');
    if (r) return { ...r, files: r.files.map((f) => ({ ...f, url: url(f) })) };
    return kept && kept.files && kept.files.length ? kept : null;
  };
  const mac = offer(fresh(macFile), prior.latest), win = offer(fresh(winFile), prior.windows);
  if (!mac && !win) fail('There is no build to offer: build first (node bin/release.js mac, or win)');
  const arm = mac && mac.files.find((f) => f.arch === 'arm64'), intel = mac && mac.files.find((f) => f.arch === 'x64');
  const pc = win && win.files.find((f) => f.arch === 'x64'), winArm = win && win.files.find((f) => f.arch === 'arm64');
  const mb = (f: FileRecord) => `${Math.round(f.bytes / 1e6)} MB`;
  const dateOf = (r: Release) => new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // /download/… are the addresses the pages link to; where they lead is this one file, so the files can move
  writeSite('_redirects', ['# Written by bin/release.js: the addresses the site links to, and where the files are now.',
    ...(arm ? [`/download/mac-arm64 ${arm.url} 302`, `/download/mac ${arm.url} 302`] : []),
    ...(intel ? [`/download/mac-intel ${intel.url} 302`, ...(arm ? [] : [`/download/mac ${intel.url} 302`])] : []),
    ...(pc ? [`/download/windows ${pc.url} 302`] : []), ...(winArm ? [`/download/windows-arm64 ${winArm.url} 302`] : []), ''].join('\n'));
  // (the notes are kept here for anything that reads this file; the page links to the changelog instead of listing them)
  const record = (r: Release, platform: string) => ({ version: r.version, date: r.date, commit: r.commit, signed: r.signed, files: r.files.map((f) => ({ ...f, platform })), notes: r.notes });
  writeSite('releases.json', JSON.stringify({ ...(mac ? { latest: record(mac, 'mac') } : {}), ...(win ? { windows: record(win, 'windows') } : {}) }, null, 2) + '\n');
  // the buttons: in the hero by name alone, in the download part with their sizes
  const button = (f: FileRecord, cls: string, href: string, label: string, bits: string[]) => `<a class="cta${cls}" href="${href}">${label}${bits.length ? ` <span class="cta-sub">${bits.join(' · ')}</span>` : ''}</a>`;
  const macButtons = (size: boolean) => [arm && button(arm, ' primary', '/download/mac-arm64', 'Download for Mac', ['Apple silicon', ...(size ? [mb(arm)] : [])]),
    intel && button(intel, arm ? '' : ' primary', '/download/mac-intel', arm ? 'Intel Mac' : 'Download for Mac', [...(arm ? [] : ['Intel']), ...(size ? [mb(intel)] : [])])].filter(Boolean);
  const winButtons = (size: boolean) => [pc && button(pc, mac ? '' : ' primary', '/download/windows', size || !mac ? 'Download for Windows' : 'Windows', size ? ['64-bit', mb(pc)] : []),
    winArm && size && button(winArm, '', '/download/windows-arm64', 'Windows on Arm', [mb(winArm)])].filter(Boolean);
  html = fill(html, 'hero', `        ${[...macButtons(false), ...winButtons(false)].join('\n        ')}\n        ${WRITE}`);
  const same = mac && win && mac.version === win.version;
  const forWhat = [mac && 'macOS 12 or later', win && 'Windows 10 or 11'].filter(Boolean).join(' and ');
  const howTo = (mac && !mac.signed) || win ? 'How to open it, and checksums' : 'Checksums';
  const versions = !mac || !win || same ? `Version ${esc((mac || win)!.version)}, ${dateOf((mac || win)!)}, for ${forWhat}.`
    : `Mac: version ${esc(mac.version)}, ${dateOf(mac)}. Windows: version ${esc(win.version)}, ${dateOf(win)}.`;
  html = fill(html, 'hero-fine', `      <p class="fine">${versions} <a href="#download">${howTo}</a>. ${MANUAL}.</p>`);
  const out = !mac || !win || same ? `Version ${esc((mac || win)!.version)} is out${mac && win ? ' for Mac and Windows' : ''}.` : `Version ${esc(mac.version)} is out for the Mac, and ${esc(win.version)} for Windows.`;
  html = fill(html, 'status', `      <p class="lede">${out} It is an early alpha: try it well before a show depends on it.</p>`);
  const sum = (f: FileRecord) => `          <dt>${esc(f.file)}</dt><dd><code>${esc(f.sha256)}</code></dd>`;
  const macOpen = mac && !mac.signed ? `      <p class="open"><b>Opening it the first time.</b> I haven&rsquo;t signed this build with an Apple Developer ID yet, so macOS will refuse to open it and may say it&rsquo;s damaged. It isn&rsquo;t. Drag the app to Applications, then in Terminal run <code>xattr -dr com.apple.quarantine "/Applications/Endless Cues Public Alpha.app"</code> and open it again.</p>\n` : '';
  // (a new certificate has no reputation with SmartScreen yet, so even a signed installer may be warned about at first)
  const winOpen = win && win.signed ? `      <p class="open"><b>Opening it on Windows.</b> The installer is signed, but while it is new to Windows it may still say &ldquo;Windows protected your PC&rdquo;. Click <b>More info</b>, then <b>Run anyway</b>. It installs for you alone and doesn&rsquo;t ask for an administrator.</p>\n`
    : win ? `      <p class="open"><b>Opening it on Windows.</b> I haven&rsquo;t signed the Windows installer yet, so Windows may say &ldquo;Windows protected your PC&rdquo;. Click <b>More info</b>, then <b>Run anyway</b>. It installs for you alone and doesn&rsquo;t ask for an administrator.</p>\n` : '';
  html = fill(html, 'download', `<section class="sec" id="download" aria-labelledby="h-download">
  <div class="wrap dl">
    <div>
      <p class="kicker"><span class="dot go"></span>Download</p>
      <h2 id="h-download">Endless Cues ${esc(!mac || !win || same ? (mac || win)!.version : `${mac.version} · ${win.version}`)}</h2>
      <p class="lede">${dateOf((mac || win)!)}. For ${forWhat}.${mac && mac.signed ? ' The Mac app is signed and notarised by Apple.' : ''}${win && win.signed ? ' The Windows installer is signed through Microsoft.' : ''}</p>
    </div>
    <div>
${mac ? `      <div class="cta-row">
        ${macButtons(true).join('\n        ')}
      </div>
` : ''}${win ? `      <div class="cta-row">
        ${winButtons(true).join('\n        ')}
      </div>
` : ''}${macOpen}${winOpen}      <details class="sums">
        <summary>SHA-256 checksums</summary>
        <dl>
${[arm, intel, pc, winArm].filter((f): f is FileRecord => !!f).map(sum).join('\n')}
        </dl>
        <p>${[mac && 'On a Mac, in Terminal: <code>shasum -a 256</code> and the file&rsquo;s name.', win && 'On Windows, in PowerShell: <code>Get-FileHash</code> and the file&rsquo;s name.'].filter(Boolean).join(' ')}</p>
      </details>
    </div>
  </div>
</section>`);
  html = fill(html, 'final', `    <h2 id="h-final">Want to hear about the next version?</h2>
    <p class="lede">Email <a data-link="notify" href="${NOTIFY}"><span data-fill="email">${EMAIL}</span></a> and I&rsquo;ll tell you when there&rsquo;s a new one. If you try this one on a show, tell me how it went: what you ran it on, and what broke.</p>`);
  writeSite('index.html', html);
  console.log(`The site (${dir}) offers ${[mac && `${mac.version} for the Mac`, win && `${win.version} for Windows`].filter(Boolean).join(' and ')} from ${base}.\nNext, in the service repository: look at it (python3 -m http.server -d site 8788), run node site/stamp.js, commit, then deploy the site (its README.md).`);
}

const [what, ...rest] = require.main === module ? process.argv.slice(2) : ['(loaded)'];
if (what === '(loaded)') { /* required by a test: nothing runs */ }
else if (what === 'version') setVersion(rest[0] || '');
else if (what === 'mac') buildMac(rest);
else if (what === 'win') buildWin(rest);
else if (what === 'site') site(rest);
else if (what === 'publish') publish(rest);
else { console.log(read('bin/release.js').split('*/')[0].split('\n').slice(2).map((l) => l.replace(/^ \* ?/, '')).join('\n')); process.exit(what ? 1 : 0); }

export { parts, newer, publishRelease, publishDownloads, readFeed, feedPointingAt, FEED_FILE };
