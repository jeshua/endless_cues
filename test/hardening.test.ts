// What a stranger's show file, a stranger's packet or a page the window was sent to must not be able to do.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as dgram from 'dgram';
import * as http from 'http';
import * as osc from '../core/net/osc';
import * as show from '../core/show/show';
import { mayNavigate, mayOpenOutside, guard } from '../app/main/navigation';
import * as lightingDesk from '../app/main/modules/lighting-desk';
import * as webRemote from '../app/main/modules/web-remote';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freeUdp = () => new Promise((res) => { const s = dgram.createSocket('udp4'); s.bind(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const freeTcp = () => new Promise((res) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

test('a window stays on the app’s own pages', () => {
  assert.equal(mayNavigate('ec://app/index.html', 'ec://app/index.html?inspector=1'), true);
  assert.equal(mayNavigate('ec://app/index.html', 'https://example.com/'), false);
  assert.equal(mayNavigate('ec://app/index.html', 'file:///tmp/dropped.html'), false);
  assert.equal(mayNavigate('ec://app/index.html', 'ec://other/x.html'), false);
  assert.equal(mayNavigate('ec://app/index.html', 'data:text/html,<p>'), false);
  assert.equal(mayNavigate('file:///app/stage/stage.html', 'file:///app/stage/stage.html?test=1'), true);
  assert.equal(mayNavigate('file:///app/stage/stage.html', 'file:///Users/someone/evil.html'), false);
  assert.equal(mayNavigate('', 'ec://app/index.html'), false);
});

test('only web pages and mail go to the system', () => {
  for (const u of ['https://endlesscues.com/docs/', 'http://192.168.1.2:8137/', 'mailto:a@b.c']) assert.equal(mayOpenOutside(u), true, u);
  for (const u of ['file:///Applications/Calculator.app', 'javascript:alert(1)', 'smb://host/share', 'x-apple.systempreferences:', 'ms-msdt:/id', '', 'not a url']) assert.equal(mayOpenOutside(u), false, u);
});

test('the guard refuses a navigation away, a webview and a window, and hands a web link to the browser', () => {
  const on = {}, opened = [];
  let handler = null;
  const wc = { on: (ev, fn) => { on[ev] = fn; }, setWindowOpenHandler: (fn) => { handler = fn; }, getURL: () => 'ec://app/index.html' };
  guard(wc, { open: (u) => opened.push(u) });
  const event = () => { const e = { prevented: false, preventDefault() { e.prevented = true; } }; return e; };
  const away = event(); on['will-navigate'](away, 'https://example.com/'); assert.equal(away.prevented, true);
  const here = event(); on['will-navigate'](here, 'ec://app/index.html?list=x'); assert.equal(here.prevented, false);
  const view = event(); on['will-attach-webview'](view); assert.equal(view.prevented, true);
  assert.deepEqual(handler({ url: 'https://endlesscues.com/' }), { action: 'deny' });
  assert.deepEqual(handler({ url: 'file:///etc/passwd' }), { action: 'deny' });
  assert.deepEqual(opened, ['https://endlesscues.com/']);
});

test('a show file cannot give its settings a prototype of its own', () => {
  const file = JSON.parse(show.stringify(show.newShow('A')));
  const text = JSON.stringify(file).replace('"settings":{', '"settings":{"__proto__":{"planted":1},"constructor":{"planted":1},');
  const n = show.normalise(JSON.parse(text)).doc;
  assert.equal(Object.getPrototypeOf(n.settings), Object.prototype);
  assert.equal(n.settings.planted, undefined);
  assert.equal(({}).planted, undefined);
});

test('Lighting desk: a packet that is not OSC on its listening port is dropped, not thrown', async () => {
  const listenPort = await freeUdp(), deskPort = await freeUdp();
  const m = lightingDesk.create({ log() {}, changed() {} });
  m.start({ kind: 'etc-eos', host: '127.0.0.1', port: deskPort, listenPort, list: 1 });
  await sleep(40);
  const thrown = [];
  const catcher = (err) => thrown.push(err);
  process.on('uncaughtException', catcher);
  const s = dgram.createSocket('udp4');
  // an address, a type tag that says "int", and no bytes for it: decode throws reading past the end
  const bad = Buffer.concat([osc.encode('/eos/out/ping').subarray(0, 16), Buffer.from(',i\0\0')]);
  await new Promise((r) => s.send(bad, listenPort, '127.0.0.1', r));
  await new Promise((r) => s.send(Buffer.from([0x2f, 0, 0, 0, 0x2c, 0x62, 0, 0, 0x7f, 0xff, 0xff, 0xff]), listenPort, '127.0.0.1', r));
  await sleep(60);
  process.removeListener('uncaughtException', catcher);
  s.close(); m.stop();
  assert.deepEqual(thrown, []);
});

test('Web remote: with no key of its own, the host’s key for the show is used, not one made from the show’s id', async () => {
  const port = await freeTcp();
  const snapshot = () => ({ show: { title: 'T' }, rows: [], engine: { listName: 'Main', playhead: null, live: [], paused: [], disarmed: [], active: [] } });
  const m = webRemote.create({ log() {}, changed() {}, host: { cmd: () => ({ ok: true }), snapshot, showId: () => 's_1234abcd', remoteKey: () => '0123456789abcdef' } });
  m.start({ port, key: '', control: true });
  await sleep(40);
  const old = require('crypto').createHash('sha256').update('remote:s_1234abcd').digest('hex').slice(0, 8);
  assert.equal((await fetch(`http://127.0.0.1:${port}/?k=${old}`)).status, 403, 'the key made from the show id alone opens nothing');
  assert.equal((await fetch(`http://127.0.0.1:${port}/?k=0123456789abcdef`)).status, 200);
  m.stop();
});
