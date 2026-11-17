import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { newer, parts } from '../bin/release.js';

const RELEASE = path.join(__dirname, '../bin/release.js');
const FIXTURE = path.join(__dirname, 'fixtures/site/index.html');

test('versions are compared as releases are ordered', () => {
  for (const [a, b] of [['0.2.0-alpha.1', '0.1.0'], ['0.2.0-alpha.2', '0.2.0-alpha.1'], ['0.2.0-beta.1', '0.2.0-alpha.9'], ['0.2.0-rc.1', '0.2.0-beta.3'], ['0.2.0', '0.2.0-rc.4'], ['0.2.1', '0.2.0'], ['1.0.0', '0.9.9']]) {
    assert.ok(newer(a, b), `${a} is after ${b}`); assert.ok(!newer(b, a), `${b} is not after ${a}`);
  }
  assert.ok(!newer('0.2.0', '0.2.0'));
  assert.equal(parts('1.2'), null); assert.equal(parts('1.2.3-gamma.1'), null); assert.equal(parts('v1.2.3'), null);
});

/** A copy of the fixture page in a temp folder: the site step writes there, never into a real site. */
function tempSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-site-'));
  fs.copyFileSync(FIXTURE, path.join(dir, 'index.html'));
  return dir;
}
const run = (...args) => spawnSync(process.execPath, [RELEASE, ...args], { encoding: 'utf8', env: { ...process.env, EC_SITE_DIR: '' } });

test('the site step writes the download into the site folder it is given', () => {
  const dir = tempSite();
  try {
    const release = path.join(dir, 'release.json');
    fs.writeFileSync(release, JSON.stringify({ version: '0.2.0-alpha.1', date: '2026-11-16', commit: 'abc1234', signed: false, notes: [],
      files: [{ file: 'Endless-Cues-0.2.0-alpha.1-mac-arm64.dmg', arch: 'arm64', bytes: 123e6, sha256: 'a'.repeat(64) },
        { file: 'Endless-Cues-0.2.0-alpha.1-mac-x64.dmg', arch: 'x64', bytes: 130e6, sha256: 'b'.repeat(64) }] }));
    const r = run('site', '--base', 'https://downloads.example.org/0.2.0', '--release', release, '--site-dir', dir);
    assert.equal(r.status, 0, r.stderr);
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.match(html, /<!-- release:download -->\n<section class="sec" id="download"/);
    assert.match(html, /Endless Cues 0\.2\.0-alpha\.1/);
    assert.match(html, /a{64}/);
    assert.match(html, /xattr -dr com\.apple\.quarantine/, 'an unsigned build says how to open it');
    const redirects = fs.readFileSync(path.join(dir, '_redirects'), 'utf8');
    assert.match(redirects, /^\/download\/mac-arm64 https:\/\/downloads\.example\.org\/0\.2\.0\/Endless-Cues-0\.2\.0-alpha\.1-mac-arm64\.dmg 302$/m);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'releases.json'), 'utf8')).latest.version, '0.2.0-alpha.1');

    const none = run('site', '--none', '--site-dir', dir);
    assert.equal(none.status, 0, none.stderr);
    const back = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.match(back, /There&rsquo;s nothing to download yet\./);
    assert.match(back, /<!-- release:download -->\n\n<!-- \/release:download -->/);
    assert.ok(!fs.existsSync(path.join(dir, '_redirects')) && !fs.existsSync(path.join(dir, 'releases.json')));
    // and again: --none is the committed state, so running it twice changes nothing
    run('site', '--none', '--site-dir', dir);
    assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), back);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the site step says clearly where the site is when it is not there', () => {
  const r = run('site', '--none', '--site-dir', path.join(os.tmpdir(), 'ec-no-such-site'));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /There is no site at .*ec-no-such-site/);
  assert.match(r.stderr, /endless_cues_service\/site/);
});

test('the site step refuses a page without its five marked parts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-site-'));
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><p>no markers</p>');
    const r = run('site', '--none', '--site-dir', dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no <!-- release:hero --> part/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the site offers Windows beside the Mac: its buttons, how to get past SmartScreen, its checksums, and the Mac kept when only Windows is new', () => {
  const dir = tempSite();
  try {
    const mac = path.join(dir, 'mac.json'), win = path.join(dir, 'win.json');
    fs.writeFileSync(mac, JSON.stringify({ version: '0.3.0-alpha.4', date: '2026-11-17', commit: 'abc1234', signed: true, notes: [],
      files: [{ file: 'Endless-Cues-0.3.0-alpha.4-mac-arm64.dmg', arch: 'arm64', bytes: 130e6, sha256: 'a'.repeat(64) }] }));
    fs.writeFileSync(win, JSON.stringify({ platform: 'win', version: '0.3.0-alpha.4', date: '2026-11-17', commit: 'abc1234', signed: false, notes: [],
      files: [{ file: 'Endless-Cues-0.3.0-alpha.4-win-x64-setup.exe', arch: 'x64', bytes: 116e6, sha256: 'c'.repeat(64) },
        { file: 'Endless-Cues-0.3.0-alpha.4-win-arm64-setup.exe', arch: 'arm64', bytes: 114e6, sha256: 'd'.repeat(64) }] }));
    let r = run('site', '--base', 'https://downloads.example.org/', '--release', mac, '--site-dir', dir);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!/windows/i.test(fs.readFileSync(path.join(dir, '_redirects'), 'utf8')), 'no Windows until there is a Windows build');
    // later, the Windows build alone: the Mac's is kept from the site's own releases.json
    r = run('site', '--base', 'https://downloads.example.org/', '--win-release', win, '--site-dir', dir);
    assert.equal(r.status, 0, r.stderr);
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.match(html, /href="\/download\/mac-arm64">Download for Mac/);
    assert.match(html, /href="\/download\/windows">Download for Windows <span class="cta-sub">64-bit · 116 MB/);
    assert.match(html, /Windows on Arm/);
    assert.match(html, /More info<\/b>, then <b>Run anyway/, 'an unsigned installer says how to get past SmartScreen');
    assert.match(html, /Version 0\.3\.0-alpha\.4 is out for Mac and Windows/);
    assert.match(html, /c{64}/); assert.match(html, /a{64}/);
    assert.match(html, /Get-FileHash/);
    const redirects = fs.readFileSync(path.join(dir, '_redirects'), 'utf8');
    assert.match(redirects, /^\/download\/mac-arm64 https:\/\/downloads\.example\.org\/Endless-Cues-0\.3\.0-alpha\.4-mac-arm64\.dmg 302$/m);
    assert.match(redirects, /^\/download\/windows https:\/\/downloads\.example\.org\/Endless-Cues-0\.3\.0-alpha\.4-win-x64-setup\.exe 302$/m);
    assert.match(redirects, /^\/download\/windows-arm64 /m);
    const rel = JSON.parse(fs.readFileSync(path.join(dir, 'releases.json'), 'utf8'));
    assert.equal(rel.latest.files[0].platform, 'mac');
    assert.equal(rel.windows.files[0].platform, 'windows');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a signed Windows build says so, still says how to get past SmartScreen while it is new, and one signed with a test certificate is refused', () => {
  const dir = tempSite();
  try {
    const win = path.join(dir, 'win.json');
    const build = (more) => fs.writeFileSync(win, JSON.stringify({ platform: 'win', version: '0.3.0-alpha.5', date: '2026-11-20', commit: 'abc1234', notes: [], ...more,
      files: [{ file: 'Endless-Cues-0.3.0-alpha.5-win-x64-setup.exe', arch: 'x64', bytes: 116e6, sha256: 'c'.repeat(64) }] }));
    build({ signed: true });
    let r = run('site', '--base', 'https://downloads.example.org/', '--win-release', win, '--site-dir', dir);
    assert.equal(r.status, 0, r.stderr);
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.match(html, /The Windows installer is signed through Microsoft\./);
    assert.match(html, /The installer is signed, but while it is new to Windows/);
    assert.ok(!/haven&rsquo;t signed the Windows installer/.test(html));
    build({ signed: false, testSigned: true });
    r = run('site', '--base', 'https://downloads.example.org/', '--win-release', win, '--site-dir', dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /test certificate/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
