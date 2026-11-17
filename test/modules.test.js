const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('dgram');
const http = require('http');
const osc = require('../core/net/osc');
const oscControl = require('../app/main/modules/osc-control');
const lightingDesk = require('../app/main/modules/lighting-desk');
const webRemote = require('../app/main/modules/web-remote');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freeUdp = () => new Promise((res) => { const s = dgram.createSocket('udp4'); s.bind(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const freeTcp = () => new Promise((res) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
function udpClient() {
  const sock = dgram.createSocket('udp4');
  const got = [];
  sock.on('message', (b) => got.push(osc.decode(b)));
  return { sock, got, send: (port, text) => new Promise((r) => sock.send(osc.encode(text), port, '127.0.0.1', r)), close: () => sock.close() };
}

test('OSC control: QLab’s addresses become host commands', () => {
  const m = oscControl.create({ log() {}, changed() {}, host: { cmd() {} } });
  assert.deepEqual(m.route('/go'), { op: 'go' });
  assert.deepEqual(m.route('/workspace/abc/go'), { op: 'go' });
  assert.deepEqual(m.route('/go/12.5'), [{ op: 'jump', number: '12.5' }, { op: 'go' }]);
  assert.deepEqual(m.route('/cue/LQ7/start'), { op: 'start', number: 'LQ7' });
  assert.deepEqual(m.route('/cue/3/togglePause'), { op: 'toggle', number: '3' });
  assert.deepEqual(m.route('/playhead/next'), { op: 'move', step: 1 });
  assert.deepEqual(m.route('/stop'), { op: 'panic', hard: true });
  assert.equal(m.route('/nonsense'), null);
});

test('OSC control through the hub: over UDP, with a reply; a passcode keeps strangers out; a refused step ends it', async () => {
  const { createHub } = require('../core/net/hub');
  const port = await freeUdp();
  const cmds = [];
  const hub = createHub();
  hub.configure({ patches: [], inputPort: port, listen: true });
  const m = oscControl.create({ log() {}, changed() {}, net: hub, host: { cmd: (c) => { cmds.push(c.op); return c.op === 'jump' ? { error: 'no cue numbered 99' } : { ok: true }; } } });
  m.start({ passcode: '1234', replyPort: 0 });
  const c = udpClient();
  await sleep(40);
  await c.send(port, '/go'); await sleep(40);
  assert.deepEqual(cmds, [], 'refused before /connect');
  assert.match(c.got[0].args[0], /denied/);
  await c.send(port, '/connect 1234'); await sleep(40);
  await c.send(port, '/alwaysReply 1'); await sleep(40);          // (a command is answered only on request, as in QLab)
  await c.send(port, '/go'); await sleep(40);
  assert.deepEqual(cmds, ['go']);
  assert.equal(c.got.at(-1).address, '/reply/go');
  await c.send(port, '/go/99'); await sleep(40);
  assert.deepEqual(cmds, ['go', 'jump'], 'the GO after a failed jump is not sent');
  assert.match(m.status().text, /3 received/);
  assert.equal(hub.monitor().filter((e) => e.dir === 'in').length, 5, 'everything heard is in the monitor');
  m.stop(); hub.close(); c.close();
});

test('the hub: UDP out with the answer heard, TCP with SLIP framing, the monitor, learn, and a patch that cannot work', async () => {
  const { createHub } = require('../core/net/hub');
  const net = require('net');
  // a UDP device that answers the sender (as an X32 does)
  const dev = dgram.createSocket('udp4'); const got = [];
  dev.on('message', (b, from) => { got.push(osc.toText(osc.decode(b))); dev.send(osc.encode('/info "X32" 4.06'), from.port, from.address); });
  await new Promise((r) => dev.bind(0, '127.0.0.1', r));
  // a TCP device (as an Eos desk on 3032): SLIP in, SLIP out
  const tcpGot = []; let reader = osc.deframer('slip');
  const server = net.createServer((sock) => sock.on('data', (chunk) => { for (const p of reader(chunk)) { tcpGot.push(osc.toText(osc.decode(p))); sock.write(osc.frame(osc.encode('/eos/out/ping'))); } }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const inPort = await freeUdp();
  const hub = createHub();
  hub.configure({ inputPort: inPort, listen: true, patches: [
    { id: 'mixer', name: 'Mixer', host: '127.0.0.1', port: dev.address().port, protocol: 'udp', device: 'x32' },
    { id: 'desk', name: 'Desk', host: '127.0.0.1', port: server.address().port, protocol: 'tcp', framing: 'slip', device: 'etc-eos' },
    { id: 'bad', name: 'Nowhere', host: '', port: 0, protocol: 'udp' },
  ] });
  await sleep(80);
  assert.equal(hub.status().patches.desk.state, 'connected');
  assert.equal(hub.send('mixer', '/ch/01/mix/fader 0.75').ok, true);
  assert.equal(hub.test('desk').text, '/eos/ping', 'Test sends the device’s own are-you-there');
  const bad = hub.send('bad', '/x');
  assert.equal(bad.ok, false);
  assert.match(bad.why, /no address/);
  assert.match(hub.send('mixer', 'not osc').why, /not an OSC address/);
  await sleep(80);
  assert.deepEqual(got, ['/ch/01/mix/fader 0.75']);
  assert.deepEqual(tcpGot, ['/eos/ping']);
  const st = hub.status().patches;
  assert.equal(st.mixer.state, 'answering');
  assert.equal(st.desk.state, 'answering');
  assert.match(st.mixer.lastIn, /^\/info X32/);
  assert.equal(st.bad.state, 'error');
  // learn: the next message to arrive on the input port
  const learning = hub.learn(1000);
  const c = udpClient(); await c.send(inPort, '/sm/thunder 1');
  assert.deepEqual((await learning).text, '/sm/thunder 1');
  const dirs = hub.monitor().map((e) => e.dir).join('');
  assert.ok(dirs.includes('out') && dirs.includes('in'));
  hub.close(); dev.close(); server.close(); c.close();
});

test('device templates compose messages, and a faded Network cue runs its value', () => {
  const { compose, list } = require('../core/net/devices');
  assert.equal(compose('etc-eos', 'fire', { list: 2, cue: '12.5' }), '/eos/cue/2/12.5/fire');
  assert.equal(compose('x32', 'fader', { channel: '03', level: 0.5 }), '/ch/03/mix/fader 0.5');
  assert.equal(compose('x32', 'fader', { channel: '03' }, { fade: true }), '/ch/03/mix/fader #v#');
  assert.ok(list().every((d) => d.label && Array.isArray(d.commands)));
  const { rig, build } = require('./helpers');
  const s = build([{ op: 'show.set', path: 'settings.network.patches', value: [{ id: 'm', name: 'Mixer', host: '10.0.0.5', port: 10023 }] },
    { op: 'cue.add', cue: { type: 'network', number: '1', patch: 'm', message: '/ch/01/mix/fader #v#', fadeFrom: 0, fadeTo: 0.75, duration: 1 } },
    { op: 'cue.add', cue: { type: 'network', number: '2', patch: 'm', message: '/ch/01/mix/on #v#', fadeTo: 1 } }]);
  const r = rig(s.doc);
  r.engine.go();
  assert.equal(r.sent[0], '/ch/01/mix/fader 0.0');
  assert.equal(r.engine.active()[0].kind, 'fade');
  r.advance(0.5);
  r.engine.pause(); r.advance(5); r.engine.resume();
  r.advance(0.6);
  assert.equal(r.sent.at(-1), '/ch/01/mix/fader 0.75');
  assert.ok(r.sent.length > 25 && r.sent.length < 40, `about 30 a second (${r.sent.length})`);
  assert.equal(r.engine.active().length, 0);
  r.engine.go();
  assert.equal(r.sent.at(-1), '/ch/01/mix/on 1.0', 'no duration: the landing value, once');
});

test('Lighting desk: a Light cue fires the desk by number, and the desk answering is known', async () => {
  const deskPort = await freeUdp(), listenPort = await freeUdp();
  const desk = dgram.createSocket('udp4');
  const heard = [];
  desk.on('message', (b, from) => {
    const msg = osc.decode(b); heard.push(msg.address);
    if (msg.address === '/eos/ping') desk.send(osc.encode('/eos/out/ping'), listenPort, '127.0.0.1');
    if (/fire$/.test(msg.address)) desk.send(osc.encode('/eos/out/active/cue/1/7'), listenPort, '127.0.0.1');
  });
  await new Promise((r) => desk.bind(deskPort, '127.0.0.1', r));
  const m = lightingDesk.create({ log() {}, changed() {} });
  m.start({ kind: 'etc-eos', host: '127.0.0.1', port: deskPort, listenPort, list: 1 });
  await sleep(80);
  assert.ok(heard.includes('/eos/ping'));
  assert.match(m.status().text, /desk answering/);
  m.onLight({ number: 'LQ7', lightCue: '7' });
  m.onLight({ number: 'LQx', lightCue: 'seven' });      // not a number an Eos desk has: logged, not sent
  await sleep(80);
  assert.deepEqual(heard.filter((a) => /fire/.test(a)), ['/eos/cue/1/7/fire']);
  assert.equal(m.status().active, '7');
  m.stop(); desk.close();
});

test('Web remote: the page and commands need the key; a view-only remote cannot GO', async () => {
  const port = await freeTcp();
  const cmds = [];
  const snapshot = () => ({ show: { title: 'T' }, rows: [{ id: 'a', depth: 0, number: '1', name: 'One', type: 'memo' }], engine: { listName: 'Main', playhead: 'a', live: [], paused: [], disarmed: [], active: [] } });
  const m = webRemote.create({ log() {}, changed() {}, host: { cmd: (c) => { cmds.push(c.op); return { ok: true }; }, snapshot } });
  m.start({ port, key: 'k1', control: true });
  await sleep(40);
  const get = (path, opts = {}) => fetch(`http://127.0.0.1:${port}${path}`, opts);
  assert.equal((await get('/')).status, 403);
  assert.equal((await get('/?k=k1')).status, 200);
  assert.equal((await get('/cmd?k=k1', { method: 'POST', body: JSON.stringify({ op: 'go' }) })).status, 200);
  assert.equal((await get('/cmd?k=k1', { method: 'POST', body: JSON.stringify({ op: 'edit', ops: [] }) })).status, 403, 'only transport commands');
  assert.deepEqual(cmds, ['go']);
  assert.match(m.status().urls[0], /\?k=k1$/);
  m.stop();
  m.start({ port, key: 'k1', control: false });
  await sleep(40);
  assert.equal((await get('/cmd?k=k1', { method: 'POST', body: JSON.stringify({ op: 'go' }) })).status, 403);
  m.stop();
});
