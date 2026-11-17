'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsignArgs, signatureBytes } from '../build/sign-win.js';

test('Windows signing: Azure Artifact Signing by endpoint, account and profile, the token passed by name only', () => {
  const env = { EC_WIN_SIGNING: ' eus.codesigning.azure.net  my-account my-profile ', EC_WIN_SIGN_TOKEN: 'sekrit' };
  const args = jsignArgs('C:/x/app.exe', env);
  const after = (k) => args[args.indexOf(k) + 1];
  assert.equal(after('--storetype'), 'TRUSTEDSIGNING');
  assert.equal(after('--keystore'), 'eus.codesigning.azure.net');
  assert.equal(after('--alias'), 'my-account/my-profile');
  assert.equal(after('--storepass'), 'env:EC_WIN_SIGN_TOKEN');
  assert.equal(after('--tsmode'), 'RFC3161');
  assert.equal(args.at(-1), 'C:/x/app.exe');
  assert.ok(!args.join(' ').includes('sekrit'));
  assert.throws(() => jsignArgs('a.exe', { EC_WIN_SIGNING: 'eus.codesigning.azure.net my-account' }), /<endpoint> <account> <profile>/);
});

test('Windows signing: a certificate of your own to try it, by its file; nothing set, nothing to sign with', () => {
  const args = jsignArgs('a.exe', { EC_WIN_SIGN_P12: '/tmp/t.p12', EC_WIN_SIGN_P12_PASS: 'pw', EC_WIN_SIGNING: 'e a p' });
  assert.equal(args[args.indexOf('--keystore') + 1], '/tmp/t.p12');
  assert.equal(args[args.indexOf('--storepass') + 1], 'env:EC_WIN_SIGN_P12_PASS');
  assert.ok(!args.includes('--storetype') && !args.includes('pw'));
  assert.equal(jsignArgs('a.exe', {}), null);
});

/** A smallest PE header (PE32+ or PE32), with a certificate table of `size` bytes when given. */
function pe({ magic = 0x20b, size = 0 } = {}) {
  const buf = Buffer.alloc(1024);
  buf.write('MZ', 0, 'latin1'); buf.writeUInt32LE(0x80, 0x3c); buf.write('PE\0\0', 0x80, 'latin1');
  const opt = 0x80 + 24; buf.writeUInt16LE(magic, opt);
  const dir = opt + (magic === 0x20b ? 112 : 96) + 4 * 8;
  if (size) { buf.writeUInt32LE(512, dir); buf.writeUInt32LE(size, dir + 4); }
  return buf;
}

test('Windows signing: a program’s signature is found in its header, 64-bit or 32-bit, and not in what is not a program', () => {
  assert.equal(signatureBytes(pe({ size: 300 })), 300);
  assert.equal(signatureBytes(pe({ magic: 0x10b, size: 200 })), 200);
  assert.equal(signatureBytes(pe()), 0);
  assert.equal(signatureBytes(pe({ size: 4000 })), 0, 'a table running past the end of the file is no signature');
  assert.equal(signatureBytes(Buffer.from('not a program at all, just some words in a file')), 0);
  assert.equal(signatureBytes(Buffer.alloc(0)), 0);
});
