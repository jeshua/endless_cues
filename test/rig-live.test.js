// Is it there? Liveness on a fake clock, and the hub, the scan and a device's `resend` against the stand-in
// prop on loopback sockets (docs/specs/15, sections 3.6 and 6.1).
const test = require('node:test');
const assert = require('node:assert/strict');
const show = require('../core/show/show');
const { applyOps } = require('../core/show/ops');
const { createHub } = require('../core/net/hub');
const { createLiveness, CANNOT } = require('../core/rig/liveness');
const { createFakeProp } = require('../core/rig/fake-prop');
const { scan, targetsOf } = require('../core/rig/scan');
const { senders } = require('../core/rig/senders');
const devices = require('../core/rig/devices');
const { createRig, isPrivate } = require('../app/main/rig-service');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(15); } return false; };
const here = (name = 'lantern_a', more = 'light 1.0 own 12 -52 87') => { const [address, ...args] = `/ec/here ${name} ${more}`.split(' '); return { address, args: args.map((a) => (/^-?\d+$/.test(a) ? Number(a) : a)) }; };
const lantern = (over = {}) => devices.clean(devices.fromModel('ec-prop-light', { id: 'lantern_a', name: 'Lantern A', host: '10.0.0.42', ...over })).device;

/** A liveness on a clock the test moves by hand. */
function onClock(list, opts = {}) {
  let t = 1000000, timers = [], n = 1;
  const clock = { now: () => t, setTimeout: (fn, ms) => { timers.push({ id: n, at: t + ms, fn }); return n++; }, clearTimeout: (id) => { timers = timers.filter((x) => x.id !== id); } };
  const asks = [], logs = [], stopped = [];
  const live = createLiveness({ clock, send: (d, text) => { asks.push(`${d.id} ${text}`); return opts.send ? opts.send(d, text) : { ok: true }; }, log: (l) => logs.push(l), stopped: (d) => stopped.push(d.id), facts: opts.facts });
  live.configure(list, { held: opts.held || '' });
  const advance = (ms, step = 250) => { for (let left = ms; left > 0; left -= step) { t += Math.min(step, left); for (const x of timers.filter((y) => y.at <= t)) { timers = timers.filter((y) => y !== x); x.fn(); } live.tick(); } };
  return { live, asks, logs, stopped, advance, now: () => t };
}

test('ask: sent every `every` seconds; ready while it answers; a problem after three with no answer, said once', () => {
  const c = onClock([lantern()]);
  c.live.tick();
  assert.deepEqual(c.asks, ['lantern_a /ec/hello'], 'the first ask goes at once');
  assert.deepEqual([c.live.state('lantern_a').state, c.live.state('lantern_a').text], ['unknown', 'asking…'], 'it is given its time to answer before it is called away');
  c.live.heard('lantern_a', here(), c.now() + 4);
  c.advance(250);
  let s = c.live.state('lantern_a');
  assert.deepEqual([s.state, s.text, s.how], ['ready', 'answering · 4 ms', 'ask']);
  assert.deepEqual(s.reports, [{ key: 'fw', label: 'Firmware', value: '1.0', warn: false }, { key: 'state', label: 'Doing', value: 'own', warn: false }, { key: 'signal', label: 'Signal', value: -52, unit: 'dBm', warn: false }, { key: 'battery', label: 'Battery', value: 87, unit: '%', warn: false }]);
  assert.equal(s.lastIn, '/ec/here lantern_a light 1.0 own 12 -52 87');
  // it goes on answering for ten seconds: asked every two, and nothing is logged
  for (let i = 0; i < 5; i++) { c.advance(2000); c.live.heard('lantern_a', here()); }
  assert.equal(c.asks.length, 6);
  assert.equal(c.live.state('lantern_a').state, 'ready');
  assert.deepEqual(c.logs, []);
  // then it stops
  c.advance(5900);
  assert.equal(c.live.state('lantern_a').state, 'ready', 'three asks’ worth of patience');
  c.advance(400);
  s = c.live.state('lantern_a');
  assert.deepEqual([s.state, s.text], ['problem', 'not answering (last heard 6 s ago)']);
  c.advance(60000);
  assert.deepEqual(c.logs, ['Lantern A has stopped answering'], 'logged once, when it stopped, not every two seconds');
  assert.deepEqual(c.stopped, ['lantern_a']);
  assert.match(c.live.state('lantern_a').text, /last heard 66 s ago/);
  // and comes back
  c.live.heard('lantern_a', here());
  c.advance(250);
  assert.equal(c.live.state('lantern_a').state, 'ready');
  assert.deepEqual(c.logs, ['Lantern A has stopped answering', 'Lantern A is answering again']);
});

test('ask: a report outside its range is flagged, and a value that means "not known" is left out', () => {
  const c = onClock([lantern()]);
  c.live.tick();
  c.live.heard('lantern_a', here('lantern_a', 'light 1.0 breathe 12 -81 -1'));
  const r = Object.fromEntries(c.live.state('lantern_a').reports.map((x) => [x.key, x]));
  assert.equal(r.signal.warn, true);
  assert.equal(r.battery, undefined, '-1 is the kit’s "no battery to read"');
  c.live.heard('lantern_a', here('lantern_a', 'light 1.0 breathe 12 -50 18'));
  assert.equal(c.live.state('lantern_a').reports.find((x) => x.key === 'battery').warn, true);
  // something else from it is not its answer, though it is the last thing it said
  assert.equal(c.live.heard('lantern_a', { address: '/ec/other', args: [] }), false);
  assert.equal(c.live.state('lantern_a').lastIn, '/ec/other');
});

test('ask: held back, nothing is sent and the row says so; no address, nothing is sent either', () => {
  const held = onClock([lantern()], { held: 'held back: OSC out is switched off for rehearsal' });
  held.advance(10000);
  assert.deepEqual(held.asks, []);
  assert.deepEqual([held.live.state('lantern_a').state, held.live.state('lantern_a').text, held.live.state('lantern_a').held], ['look', 'held back', true]);
  // let go: asked again, and given its time
  held.live.configure([lantern()], { held: '' });
  held.advance(250);
  assert.equal(held.asks.length, 1);
  assert.equal(held.live.state('lantern_a').state, 'unknown');
  const none = onClock([lantern({ host: '' })]);
  none.advance(10000);
  assert.deepEqual(none.asks, []);
  assert.deepEqual([none.live.state('lantern_a').state, none.live.state('lantern_a').text], ['look', 'no address yet']);
  // an ask that cannot be sent is said on the row, not logged every two seconds
  const bad = onClock([lantern({ protocol: 'tcp' })], { send: () => ({ ok: false, why: 'Lantern A is not connected' }) });
  bad.advance(20000);
  assert.deepEqual([bad.live.state('lantern_a').state, bad.live.state('lantern_a').text], ['problem', 'cannot be asked: Lantern A is not connected']);
  assert.equal(bad.logs.length, 1);
});

test('heartbeat: nothing is sent; ready while something arrived within `within`', () => {
  const d = lantern({ alive: { how: 'heartbeat', hears: '/ec/here', within: 5 } });
  const c = onClock([d]);
  c.advance(3000);
  assert.deepEqual(c.asks, [], 'a device that says it is there by itself is never asked');
  assert.deepEqual([c.live.state('lantern_a').state, c.live.state('lantern_a').text], ['unknown', 'listening…']);
  assert.equal(c.live.wantsInput(), true);
  c.advance(3000);
  assert.deepEqual([c.live.state('lantern_a').state, c.live.state('lantern_a').text], ['problem', 'nothing heard from it yet']);
  assert.equal(c.live.heard('lantern_a', { address: '/something/else', args: [] }), false);
  assert.equal(c.live.heard('lantern_a', here()), true);
  c.advance(4000);
  assert.deepEqual([c.live.state('lantern_a').state, c.live.state('lantern_a').text], ['ready', 'heard 4 s ago']);
  c.advance(2000);
  assert.equal(c.live.state('lantern_a').state, 'problem');
  assert.deepEqual(c.stopped, ['lantern_a']);
});

test('none: never ready by itself; a TCP device while connected, a MIDI device while there is an output', () => {
  const plain = devices.clean({ id: 'projector', name: 'Projector', via: 'text', host: '10.0.0.30', port: 4352 }).device;
  const tcp = { ...plain, id: 'switcher', name: 'Switcher', protocol: 'tcp' };
  const midi = devices.clean({ id: 'sampler', name: 'Sampler', via: 'midi' }).device;
  const facts = { switcher: { tcp: true }, sampler: { midi: false } };
  const c = onClock([plain, tcp, midi], { facts: (id) => facts[id] || {} });
  c.advance(30000);
  assert.deepEqual(c.asks, []);
  assert.deepEqual([c.live.state('projector').state, c.live.state('projector').text], ['unknown', CANNOT]);
  assert.deepEqual([c.live.state('switcher').state, c.live.state('switcher').text], ['ready', 'connected']);
  assert.deepEqual([c.live.state('sampler').state, c.live.state('sampler').text], ['problem', 'no MIDI output on this computer']);
  facts.switcher.tcp = false; facts.sampler.midi = true;
  assert.equal(c.live.state('switcher').state, 'problem');
  assert.equal(c.live.state('sampler').state, 'ready');
  assert.equal(c.live.wantsInput(), false);
  assert.equal(c.live.state('nobody'), null);
});

test('one ask now: answered with how long it took, not answered within 1.5 s, held, or a device that cannot be asked', async () => {
  const c = onClock([lantern(), devices.clean({ id: 'projector', name: 'Projector', host: '10.0.0.30', port: 4352 }).device]);
  const a = c.live.ask('lantern_a');
  c.live.heard('lantern_a', here(), c.now() + 7);
  assert.deepEqual(await a, { ok: true, held: false, answered: true, ms: 1, text: '/ec/here lantern_a light 1.0 own 12 -52 87', why: '' });
  const b = c.live.ask('lantern_a');
  c.advance(1600);
  assert.deepEqual(await b, { ok: true, held: false, answered: false, ms: 1500, text: '', why: 'No answer in 1.5 s.' });
  assert.match((await c.live.ask('projector')).why, /Projector cannot be asked: press Try on the Rig page/);
  assert.match((await c.live.ask('nobody')).why, /no device with the id nobody/);
  const h = onClock([lantern()], { held: 'held back: OSC out is switched off for rehearsal' });
  assert.deepEqual(await h.live.ask('lantern_a'), { ok: false, held: true, answered: false, ms: 0, text: '', why: 'held back: OSC out is switched off for rehearsal' });
});

// ── real sockets on loopback, against the stand-in prop ──

test('the stand-in prop speaks the kit’s protocol: it answers hello, obeys each command, and acts once on an id', async () => {
  const prop = createFakeProp({ name: 'lantern_a', battery: 64 });
  const { port } = await prop.start();
  const hub = createHub();
  hub.configure({ devices: [{ ...devices.patchesOf({ settings: { rig: { devices: [lantern({ host: '127.0.0.1', port })] } } })[0] }] });
  const got = [];
  hub.onHeard((msg, _from, patch, how) => got.push([patch && patch.id, msg.address, how.alive]));
  hub.send('lantern_a', '/ec/hello', { quiet: true, ask: true });
  assert.ok(await until(() => got.length === 1));
  assert.deepEqual(got[0], ['lantern_a', '/ec/here', true]);
  assert.match(hub.status().patches.lantern_a.lastIn, /^\/ec\/here lantern_a light 1\.0 own \d+ -52 64$/);
  const say = async (text, word) => { hub.send('lantern_a', text); assert.ok(await until(() => prop.state() === word), `${text} → ${word} (was ${prop.state()})`); };
  await say('/ec/look 3', 'look3');
  await say('/ec/look 0 2.5', 'own');
  await say('/ec/effect breathe', 'breathe');
  await say('/ec/color 255 0 0 1.0', 'color');
  await say('/ec/off', 'off');
  await say('/ec/on', 'on');
  hub.send('lantern_a', '/ec/level 0.25');
  assert.ok(await until(() => prop.detail().level === 0.25));
  // the same id three times: acted on once
  const before = prop.heard.length;
  for (let i = 0; i < 3; i++) hub.send('lantern_a', '/ec/identify #a41f07');
  assert.ok(await until(() => prop.repeats === 2));
  assert.equal(prop.heard.length, before + 1);
  assert.equal(prop.detail().identified, 1);
  assert.equal(prop.state(), 'on', 'identify goes back to what it was doing');
  // a flat battery: it hears and answers nothing
  prop.silent(true);
  const n = prop.heard.length;
  hub.send('lantern_a', '/ec/effect pulse'); hub.send('lantern_a', '/ec/hello', { quiet: true });
  await sleep(120);
  assert.equal(prop.heard.length, n);
  assert.equal(prop.state(), 'on');
  // a switch is a switch
  const sw = createFakeProp({ name: 'relay', kind: 'switch' });
  const p2 = await sw.start();
  hub.configure({ devices: [{ id: 'relay', name: 'Relay', host: '127.0.0.1', port: p2.port, protocol: 'udp', format: 'osc', alive: { how: 'ask', send: '/ec/hello', reply: '/ec/here', every: 2 }, isDevice: true }] });
  assert.equal(sw.state(), 'off');
  hub.send('relay', '/ec/pulse 60');
  assert.ok(await until(() => sw.state() === 'on'));
  assert.ok(await until(() => sw.state() === 'off'));
  assert.equal(sw.here()[1][1], 'switch');
  prop.stop(); sw.stop(); hub.close();
});

test('the hub and a device: asks and answers stay out of the monitor (the first excepted), and are still counted', async () => {
  const prop = createFakeProp({ name: 'lantern_a' });
  const { port } = await prop.start();
  const doc = applyOps(show.newShow('t'), [{ op: 'device.add', device: { name: 'Lantern A', model: 'ec-prop-light', host: '127.0.0.1', port } }]).doc;
  const hub = createHub();
  hub.configure({ devices: devices.patchesOf(doc) });
  const live = createLiveness({ send: (d, text) => hub.send(d.id, text, { quiet: true, ask: true }) });
  hub.onHeard((msg, _from, patch, how) => { if (patch) live.heard(patch.id, msg, how.at); });
  live.configure(devices.list(doc));
  for (let i = 0; i < 4; i++) { const r = await live.ask('lantern_a'); assert.equal(r.answered, true); assert.match(r.text, /^\/ec\/here lantern_a light 1\.0/); assert.ok(r.ms < 500); }
  const s = live.state('lantern_a');
  assert.equal(s.state, 'ready');
  assert.deepEqual(s.reports.map((r) => [r.label, r.value]), [['Firmware', '1.0'], ['Doing', 'own'], ['Signal', -52], ['Battery', 87]]);
  assert.equal(prop.hellos, 4);
  const mon = hub.monitor();
  assert.deepEqual(mon.filter((e) => e.dir === 'out'), [], 'an ask is never written in the monitor');
  assert.equal(mon.filter((e) => e.dir === 'in').length, 1, 'of four answers, the first after a silence is the one written');
  assert.deepEqual([mon[0].who, mon[0].patch, mon[0].from.address, mon[0].from.port], ['Lantern A', 'lantern_a', '127.0.0.1', port]);
  assert.equal(hub.status().patches.lantern_a.lastOut, '', 'an ask is not "the last thing sent to it"');
  // a command is written, as any message is
  hub.send('lantern_a', '/ec/effect pulse', { label: '12.1 Lantern A ▸ Effect (pulse)' });
  assert.deepEqual(hub.monitor().filter((e) => e.dir === 'out').map((e) => [e.text, e.ok]), [['/ec/effect pulse', true]]);
  assert.equal(hub.status().patches.lantern_a.lastOut, '/ec/effect pulse');
  // it goes away: no answer
  prop.stop();
  assert.equal((await live.ask('lantern_a')).answered, false);
  live.close(); hub.close();
});

test('a device’s `resend`: one command, one id, sent three times, acted on once; a faded value is never sent again', async () => {
  const prop = createFakeProp({ name: 'lantern_a' });
  const { port } = await prop.start();
  let doc = applyOps(show.newShow('t'), [{ op: 'device.add', device: { name: 'Lantern A', model: 'ec-prop-light', host: '127.0.0.1', port } }]).doc;
  const hub = createHub();
  const state = { mode: 'edit', midi: { outputs: [] } };
  const rig = createRig({ hub, state, engine: { active: () => [], durations: new Map() }, overrides: {}, HELD: (w) => `held back: ${w}`, document: () => ({ doc, showDir: null }) });
  hub.configure({ devices: devices.patchesOf(doc) });
  rig.configure();
  const arrived = [];
  prop.heard.push = function push(e) { arrived.push(e.text); return Array.prototype.push.call(this, e); };
  const e = rig.send('lantern_a', '/ec/identify', { label: 'try' });
  assert.match(e.text, /^\/ec\/identify #[0-9a-f]{6}$/);
  assert.ok(await until(() => prop.repeats === 2, 1500), `two repeats ignored (${prop.repeats})`);
  assert.equal(prop.detail().identified, 1, 'acted on once');
  assert.equal(hub.monitor().filter((x) => x.dir === 'out').length, 1, 'the repeats are not written in the monitor');
  // a value on its way somewhere (a Device cue's fade) goes once each time, with no id
  rig.send('lantern_a', '/ec/level 0.5', { faded: true });
  assert.ok(await until(() => prop.detail().level === 0.5));
  await sleep(120);
  assert.equal(prop.repeats, 2);
  assert.equal(hub.monitor().filter((x) => x.dir === 'out').at(-1).text, '/ec/level 0.5');
  // Try: composed from the device's own command, and refused in Show mode unless it is the safe one
  assert.match(rig.cmd({ op: 'device-try', device: 'lantern_a', command: 'effect', args: { name: 'pulse' } }).sent.text, /^\/ec\/effect pulse #/);
  assert.ok(await until(() => prop.state() === 'pulse'));
  assert.equal(rig.cmd({ op: 'device-try', device: 'lantern_a', command: 'level', args: { level: 9 } }).error, 'level must be between 0 and 1');
  state.mode = 'show';
  assert.match(rig.cmd({ op: 'device-try', device: 'lantern_a', command: 'effect' }).error, /^Show mode: only Lantern A’s safe command \(Identify\) can be tried/);
  assert.ok(rig.cmd({ op: 'device-try', device: 'lantern_a', command: 'identify' }).sent.ok);
  assert.match(rig.cmd({ op: 'rig-scan' }).error, /^Show mode/);
  assert.deepEqual(await rig.service.scan(), []);
  assert.match((await rig.service.ask('lantern_a')).why, /Show mode: an assistant sends nothing to the equipment/);
  state.mode = 'edit';
  // with resend at 0 it is one plain message
  doc = applyOps(doc, [{ op: 'device.set', id: 'lantern_a', props: { resend: 0 } }]).doc;
  assert.equal(rig.send('lantern_a', '/ec/off').text, '/ec/off');
  rig.close(); prop.stop(); hub.close();
});

test('the rig in the app: a device’s row goes ready when it answers, and a needed one that stops is said once', async () => {
  const prop = createFakeProp({ name: 'lantern_a' });
  const { port } = await prop.start();
  const doc = applyOps(show.newShow('t'), [{ op: 'device.add', device: { name: 'Lantern A', model: 'ec-prop-light', host: '127.0.0.1', port, alive: { how: 'ask', send: '/ec/hello', reply: '/ec/here', every: 1 } } },
    { op: 'cue.add', cue: { type: 'device', number: '1', device: 'lantern_a', command: 'identify' } }, { op: 'show.set', path: 'settings.rig.checks', value: [{ id: 'k1', text: 'Fresh batteries' }] }]).doc;
  const hub = createHub();
  const notices = [];
  const rig = createRig({ hub, state: { mode: 'edit', midi: { outputs: [] } }, engine: { active: () => [], durations: new Map() }, overrides: {}, HELD: (w) => `held back: ${w}`, notice: (t) => notices.push(t), document: () => ({ doc, showDir: null }),
    facts: () => ({ saved: { untitled: true }, network: hub.status() }) });
  hub.configure({ devices: devices.patchesOf(doc) });
  rig.configure();
  const row = () => rig.snapshot().items.find((i) => i.id === 'device.lantern_a');
  assert.ok(await until(() => row().state === 'ready', 3000), JSON.stringify(row()));
  let s = rig.snapshot();
  assert.match(s.devices.lantern_a.text, /^answering · \d+ ms$/);
  assert.deepEqual(s.devices.lantern_a.reports.map((r) => r.key), ['fw', 'state', 'signal', 'battery']);
  assert.match(s.devices.lantern_a.lastIn, /^\/ec\/here lantern_a/);
  assert.equal(row().needed, true);
  assert.deepEqual(row().actions.map((a) => [a.id, a.label, a.cmd.op]), [['ask', 'Ask again', 'device-ask'], ['try', 'Try: Identify', 'device-try']]);
  // ask it by hand; tick the checklist
  const asked = await rig.cmd({ op: 'device-ask', device: 'lantern_a' });
  assert.deepEqual([asked.answered, asked.held], [true, false]);
  assert.deepEqual(rig.cmd({ op: 'rig-tick', id: 'k1', on: true }).ticks, { k1: true });
  assert.equal(rig.snapshot().items.find((i) => i.id === 'check.k1').state, 'ready');
  assert.match(rig.cmd({ op: 'rig-tick', id: 'nope', on: true }).error, /no such line/);
  rig.cmd({ op: 'rig-ticks-clear' });
  assert.equal(rig.snapshot().items.find((i) => i.id === 'check.k1').state, 'look');
  const checked = await rig.cmd({ op: 'rig-check' });
  assert.ok(checked.summary.at >= s.summary.at && /ready/.test(checked.summary.text));
  // the assistant's door: it can read, and ask, and nothing more
  assert.deepEqual(Object.keys(rig.service).sort(), ['ask', 'locked', 'monitor', 'scan', 'senders', 'status']);
  assert.equal((await rig.service.ask('lantern_a')).answered, true);
  assert.match((await rig.service.ask({ host: '8.8.8.8', port: 53100, probe: 'ec-prop-light' })).why, /not an address on a private network/);
  assert.match((await rig.service.ask({ host: '127.0.0.1', port, probe: 'grandma3' })).why, /is not a model with a test message/);
  const probe = await rig.service.ask({ host: '127.0.0.1', port, probe: 'ec-prop-light' });
  assert.deepEqual([probe.answered, /^\/ec\/here lantern_a/.test(probe.text)], [true, true]);
  assert.ok(rig.service.status().computer);
  // the prop loses its power
  prop.stop();
  assert.ok(await until(() => row().state === 'problem', 6000), JSON.stringify(row()));
  assert.match(row().text, /^not answering \(last heard/);
  assert.equal(row().fix, 'Check its power, and that it is on the show’s network.');
  await sleep(1500);
  assert.deepEqual(notices, ['Lantern A has stopped answering'], 'said once');
  assert.equal(rig.snapshot().summary.problems, 1);
  rig.close(); hub.close();
});

test('looking for props: one hello, and each prop that answers, with whether the show knows it', async () => {
  const a = createFakeProp({ name: 'lantern_a' }), b = createFakeProp({ name: 'relay', kind: 'switch', fw: '1.1' });
  const pa = await a.start(), pb = await b.start();
  const targets = [{ host: '127.0.0.1', port: pa.port }, { host: '127.0.0.1', port: pb.port }];
  let found = await scan({ targets, wait: 250, devices: [] });
  assert.deepEqual(found, [{ name: 'lantern_a', kind: 'light', fw: '1.0', host: '127.0.0.1', port: pa.port, state: 'own', known: null, moved: false },
    { name: 'relay', kind: 'switch', fw: '1.1', host: '127.0.0.1', port: pb.port, state: 'off', known: null, moved: false }]);
  assert.deepEqual([a.hellos, b.hellos, a.heard.length], [1, 1, 1], 'one hello each, and nothing else');
  // a prop the show has at that address is known; one written at another address has moved; one with a new name at a known address is that device
  found = await scan({ targets, wait: 250, devices: [lantern({ host: '10.0.0.42' }), { id: 'old_name', name: 'Old name', host: '127.0.0.1', port: pb.port }] });
  assert.deepEqual(found.map((f) => [f.name, f.known, f.moved]), [['lantern_a', 'lantern_a', true], ['relay', 'old_name', false]]);
  found = await scan({ targets, wait: 250, devices: [lantern({ host: '127.0.0.1', port: pa.port })] });
  assert.deepEqual(found.map((f) => [f.name, f.known, f.moved]), [['lantern_a', 'lantern_a', false], ['relay', null, false]]);
  a.silent(true); b.stop();
  assert.deepEqual(await scan({ targets, wait: 200 }), [], 'nothing answered');
  a.stop();
  // where the hello goes by itself: each network's broadcast address, and this computer
  const t = targetsOf(53100, { lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' }], en0: [{ family: 'IPv4', internal: false, address: '10.0.0.7', netmask: '255.255.255.0' }, { family: 'IPv6', internal: false, address: 'fe80::1', netmask: 'ffff::' }], en1: [{ family: 'IPv4', internal: false, address: '192.168.4.20', netmask: '255.255.252.0' }] });
  assert.deepEqual(t, [{ host: '127.0.0.1', port: 53100 }, { host: '10.0.0.255', port: 53100 }, { host: '192.168.7.255', port: 53100 }]);
});

test('unknown senders: what arrived from an address that is no device’s and no patch’s, and how often', () => {
  const at = 1700000000000;
  const entries = [
    ...[0, 2000, 4010, 6000].map((d) => ({ dir: 'in', patch: null, text: '/ec/here lantern_b light 1.0 own 3 -60 90', from: { address: '10.0.0.57', port: 53100 }, at: at + d })),
    { dir: 'in', patch: null, text: '/button 1', from: { address: '10.0.0.57', port: 53100 }, at: at + 6500 },
    { dir: 'in', patch: null, text: '/go', from: { address: '10.0.0.99', port: 9000 }, at: at + 100 },
    { dir: 'in', patch: 'lantern_a', text: '/ec/here lantern_a', from: { address: '10.0.0.42', port: 53100 }, at },      // a device's: credited to it
    { dir: 'in', patch: null, text: '/reply', from: { address: '10.0.0.20', port: 8001 }, at },                           // a patch's address
    { dir: 'in', patch: null, text: 'note 60', via: 'midi', at },
    { dir: 'out', patch: null, text: '/x', at },
  ];
  const s = senders(entries, { devices: [{ id: 'lantern_a', host: '10.0.0.42' }], patches: [{ id: 'desk', host: '10.0.0.20' }] });
  assert.deepEqual(s, [
    { address: '10.0.0.57', port: 53100, count: 5, lastAt: at + 6500, messages: [{ address: '/ec/here', count: 4, every: 2 }, { address: '/button', count: 1, every: null }] },
    { address: '10.0.0.99', port: 9000, count: 1, lastAt: at + 100, messages: [{ address: '/go', count: 1, every: null }] },
  ]);
  assert.deepEqual(senders([], {}), []);
  for (const [host, ok] of [['10.1.2.3', true], ['172.16.0.9', true], ['172.32.0.9', false], ['192.168.1.1', true], ['169.254.3.4', true], ['127.0.0.1', true], ['8.8.8.8', false], ['example.com', false], ['300.1.1.1', false], ['', false]]) assert.equal(isPrivate(host), ok, host);
});

test('a heartbeat is kept out of the monitor after the first, and a test run can pretend a device was heard', async () => {
  const hub = createHub({ dryRun: true });
  const hb = { id: 'beacon', name: 'Beacon', host: '10.0.0.60', port: 9000, protocol: 'udp', alive: { how: 'heartbeat', hears: '/beacon/alive', within: 5 }, isDevice: true };
  hub.configure({ patches: [{ id: 'desk', name: 'Desk', host: '10.0.0.20', port: 8000 }], devices: [hb, { id: 'plain', name: 'Plain', host: '10.0.0.61', port: 9000, alive: { how: 'none' }, isDevice: true }] });
  const used = [], heard = [];
  hub.onMessage((msg) => { used.push(msg.address); return true; });
  hub.onHeard((msg, _from, patch, how) => heard.push([patch && patch.id, msg.address, how.alive]));
  // (a test run opens no socket: what "arrives" is put in by the hub's own stand-in)
  for (let i = 0; i < 3; i++) hub.pretendHeard('beacon', '/beacon/alive 1');
  hub.pretendHeard('beacon', '/beacon/button 1');
  hub.pretendHeard('plain', '/status ok');
  assert.equal(hub.pretendHeard('nobody', '/x'), false);
  assert.deepEqual(heard, [['beacon', '/beacon/alive', true], ['beacon', '/beacon/alive', true], ['beacon', '/beacon/alive', true], ['beacon', '/beacon/button', false], ['plain', '/status', false]]);
  assert.deepEqual(hub.monitor().map((e) => e.text), ['/beacon/alive 1', '/beacon/button 1', '/status ok'], 'the first heartbeat after a silence, then only what is not one');
  assert.equal(hub.status().patches.beacon.state, 'answering');
  assert.deepEqual(used, [], 'none of it came in on the input port');
  hub.close();
});

test('what arrives on the input port from a device’s address is credited to it; its heartbeat is not a command or a trigger', async () => {
  const dgram = require('dgram');
  const osc = require('../core/net/osc');
  const free = () => new Promise((resolve) => { const x = dgram.createSocket('udp4'); x.bind(0, '127.0.0.1', () => { const p = x.address().port; x.close(() => resolve(p)); }); });
  const inputPort = await free();
  const from = dgram.createSocket('udp4');
  await new Promise((resolve) => from.bind(0, '127.0.0.1', resolve));
  const hub = createHub();
  hub.configure({ inputPort, listen: true, devices: [{ id: 'beacon', name: 'Beacon', host: '127.0.0.1', port: from.address().port, protocol: 'udp', alive: { how: 'heartbeat', hears: '/beacon/alive', within: 5 }, isDevice: true }] });
  const used = [], heard = [];
  hub.onMessage((msg) => { used.push(msg.address); return true; });
  hub.onHeard((msg, _from, patch, how) => heard.push([patch && patch.id, msg.address, how.via, how.alive]));
  await sleep(60);
  from.send(osc.encode('/beacon/alive', [1]), inputPort, '127.0.0.1');
  from.send(osc.encode('/beacon/alive', [1]), inputPort, '127.0.0.1');
  from.send(osc.encode('/go'), inputPort, '127.0.0.1');
  assert.ok(await until(() => heard.length === 3));
  assert.deepEqual(heard, [['beacon', '/beacon/alive', 'input', true], ['beacon', '/beacon/alive', 'input', true], ['beacon', '/go', 'input', false]]);
  assert.deepEqual(used, ['/go'], 'a device saying it is there runs nothing; anything else it sends is a message like any other');
  assert.deepEqual(hub.monitor().map((e) => [e.text, e.patch]), [['/beacon/alive 1', 'beacon'], ['/go', 'beacon']]);
  from.close(); hub.close();
});
