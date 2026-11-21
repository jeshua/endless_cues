/**
 * A show from another computer (core/show/trust.ts): which shows are this computer's own, and what a show that is
 * not leaves alone until it is turned on (its sounds on another computer's share, its connections, its reply ports).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as trust from '../core/show/trust';
import { linkFolder } from './helpers';
import { ShowDocument } from '../core/show/document';
import { createHub } from '../core/net/hub';
import type { HubPatch, MonitorEntry } from '../core/net/hub';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ec-trust-'));

test('trust: a show is this computer’s when its folder is in the record with its id', () => {
  const dir = path.join(tmp(), 'Mine.ecshow'); fs.mkdirSync(dir);
  let rec = {};
  assert.equal(trust.isMine(rec, dir, 'show-1'), false, 'a show never seen here is not');
  rec = trust.remember(rec, dir, 'show-1');
  assert.equal(trust.isMine(rec, dir, 'show-1'), true);
  assert.equal(trust.isMine(rec, `${dir}/`, 'show-1'), true, 'with a trailing slash');
  assert.equal(trust.isMine(rec, dir, 'show-2'), false, 'another show put in its place is not');
  const copy = path.join(tmp(), 'Mine.ecshow'); fs.mkdirSync(copy);
  assert.equal(trust.isMine(rec, copy, 'show-1'), false, 'the same show in another folder asks again');
  assert.equal(trust.isMine(null, dir, 'show-1'), false);
  assert.equal(trust.isMine(rec, '', 'show-1'), false);
});

test('trust: a folder reached through a link is the same folder, and case does not matter where the system ignores it', () => {
  const base = tmp(), dir = path.join(base, 'Real.ecshow'), link = path.join(base, 'Link.ecshow');
  fs.mkdirSync(dir); linkFolder(dir, link);
  const rec = trust.remember({}, link, 'x');
  assert.equal(trust.isMine(rec, dir, 'x'), true);
  assert.equal(trust.keyOf('C:\\Shows\\A.ecshow', 'win32'), trust.keyOf('c:\\shows\\a.ecshow', 'win32'));
  assert.notEqual(trust.keyOf('/shows/A.ecshow', 'linux'), trust.keyOf('/shows/a.ecshow', 'linux'));
});

test('trust: the record keeps the newest shows', () => {
  let rec = {};
  for (let i = 0; i < trust.KEEP + 5; i++) rec = trust.remember(rec, `/shows/s${i}.ecshow`, `id${i}`);
  assert.equal(Object.keys(rec).length, trust.KEEP);
  assert.equal(trust.isMine(rec, '/shows/s0.ecshow', 'id0'), false, 'the oldest went');
  assert.equal(trust.isMine(rec, `/shows/s${trust.KEEP + 4}.ecshow`, `id${trust.KEEP + 4}`), true);
  rec = trust.remember(rec, '/shows/s10.ecshow', 'id10');
  assert.equal(Object.keys(rec).at(-1), trust.keyOf('/shows/s10.ecshow'), 'remembered again: the newest');
});

test('trust: another computer’s paths are \\\\host\\share and //host/share (and Windows’s \\\\?\\ forms)', () => {
  for (const p of ['\\\\nas\\show\\a.wav', '//nas/show/a.wav', '\\\\?\\UNC\\nas\\show\\a.wav', '\\\\.\\pipe\\x', '/\\nas\\a.wav']) assert.equal(trust.isRemote(p), true, p);
  for (const p of ['media/a.wav', '/Users/me/a.wav', 'C:\\Sounds\\a.wav', 'C:/Sounds/a.wav', '', null]) assert.equal(trust.isRemote(p), false, String(p));
});

test('trust: a show from another computer opens nothing on another computer’s share until it is turned on', () => {
  const dir = path.join(tmp(), 'Away.ecshow');
  const d = ShowDocument.open(dir);
  assert.equal(d.made, true, 'a folder with no show in it: made here');
  assert.equal(ShowDocument.open(dir).made, false, 'opened again: not made now');
  d.localOnly = true;
  assert.equal(d.resolveFile('\\\\nas\\show\\a.wav'), null);
  assert.equal(d.resolveFile('//nas/show/a.wav'), null);
  assert.equal(d.resolveFile('media/a.wav'), path.join(dir, 'media/a.wav'), 'its own files are found as ever');
  d.localOnly = false;
  assert.equal(d.resolveFile('//nas/show/a.wav'), '//nas/show/a.wav', 'turned on: as written');
});

test('trust: the hub, told not to connect, makes no TCP connection and opens no reply port', async () => {
  const net = require('net');
  let connections = 0;
  const server = net.createServer((c: import('net').Socket) => { connections++; c.destroy(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const hub = createHub();
  const patches: HubPatch[] = [{ id: 'p', name: 'Desk', host: '127.0.0.1', port, protocol: 'tcp' }];
  hub.configure({ patches, connect: false });
  hub.hold('held back: from another computer');
  const e = hub.send('p', '/go');
  assert.equal(e.held, true, 'what would be sent is held back');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(connections, 0, 'no connection was made');
  assert.equal(hub.status().patches.p.tcp, undefined, 'and none is kept');
  hub.hold('');
  hub.configure({ patches, connect: true });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(connections >= 1, 'turned on: it connects');
  hub.close(); server.close();
});

test('trust: the rig of a show from another computer asks no device and looks for no props', async () => {
  const show = require('../core/show/show');
  const { applyOps } = require('../core/show/ops');
  const { createRig } = require('../app/main/rig-service');
  const rigDevices = require('../core/rig/devices');
  let doc = show.newShow('x');
  doc = applyOps(doc, [{ op: 'device.add', device: { name: 'Lantern', model: 'ec-prop-light', host: '127.0.0.1', port: 9, alive: { how: 'ask', send: '/ec/hello', reply: '/ec/here', every: 1 } } }]).doc;
  const hub = createHub({ dryRun: true });
  const sent: MonitorEntry[] = [];
  const send = hub.send.bind(hub);
  hub.send = (...a) => { const e = send(...a); sent.push(e); return e; };
  const AWAY = 'held back: this show came from another computer';
  let away = true;
  const rig = createRig({ hub, state: { mode: 'edit', midi: { outputs: [] } }, engine: { active: () => [], durations: new Map() }, overrides: {}, HELD: (w: string) => w,
    held: () => (away ? AWAY : ''), away: () => (away ? AWAY : ''), smoke: true, document: () => ({ doc, showDir: null }), facts: () => ({ saved: { untitled: true }, network: hub.status() }) });
  hub.configure({ devices: rigDevices.patchesOf(doc), connect: false });
  hub.hold(AWAY);
  rig.configure();
  await new Promise((r) => setTimeout(r, 1300));
  assert.deepEqual(sent, [], 'not asked');
  assert.match(rig.cmd({ op: 'rig-scan' }).error, /another computer/);
  assert.deepEqual(await rig.service.scan(), []);
  away = false; hub.hold(''); rig.configure();
  await new Promise((r) => setTimeout(r, 1300));
  assert.ok(sent.length >= 1, 'turned on: it is asked');
  rig.close(); hub.close();
});
