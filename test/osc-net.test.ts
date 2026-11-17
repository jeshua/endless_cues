/**
 * The network, beyond one OSC message over UDP: the input port over TCP, where a UDP answer goes,
 * passcodes with levels, QLab's editing addresses and its show control broadcast, show commands from
 * any OSC message, and messages that are text or bytes. Loopback only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as dgram from 'dgram';
import * as net from 'net';
import * as osc from '../core/net/osc';
import * as raw from '../core/net/raw';
import * as events from '../core/net/qlab-events';
import { commandsFor } from '../core/net/commands';
import { createHub, interfaces } from '../core/net/hub';
import * as show from '../core/show/show';
import { applyOps } from '../core/show/ops';
import { rig, build } from './helpers';
import * as oscControl from '../app/main/modules/osc-control';
import * as webRemote from '../app/main/modules/web-remote';
import type { HostApi, HostCommand, HostResult, ModuleContext } from '../app/main/host';
import type { Op } from '../core/show/ops';
import type { HubFrom, HubReply } from '../core/net/hub';
import type { OscMessage, OscTyped, OscValue } from '../core/net/osc';
import type { ShowDoc } from '../core/show/types';

/** A command as the fake host logs it (the tests read any of its fields). */
type Logged = HostCommand & Record<string, any>;
/** A thing in a JSON reply (a cue, a list). */
type Json = Record<string, any>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => unknown, ms = 1500) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await sleep(10); return fn(); };
/** A port that is free for both UDP and TCP on loopback. */
const freePort = () => new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
const udpListener = async () => { const sock = dgram.createSocket('udp4'), got: { buf: Buffer; msg: OscMessage; from: dgram.RemoteInfo }[] = []; sock.on('message', (b, from) => got.push({ buf: b, msg: osc.decode(b)!, from })); await new Promise<void>((r) => sock.bind(0, '127.0.0.1', r)); return { sock, got, port: sock.address().port, close: () => sock.close() }; };

/** A host as the module sees one, with the ops a newer host has when `can` names them. */
function fakeHost(doc: ShowDoc, can: string[] = []) {
  const r = rig(doc); let rev = 1, mode = 'edit';
  const cmds: Logged[] = [], listeners = new Set<(c: Logged, res: HostResult) => void>(), resets: string[] = [];
  const idOf = (c: Logged) => (c.id || (c.number != null ? (show.findByNumber(doc, c.number) || {}).id : null) || null) as string;
  const run = (c: Logged): HostResult | null => {
    if (mode === 'show' && ['edit', 'undo', 'redo'].includes(c.op)) return { error: 'Show mode: editing is locked' };
    switch (c.op) {
      case 'go': r.engine.go(); break;
      case 'start': r.engine.start(idOf(c)); break;
      case 'fire': r.engine.fire(idOf(c)); break;
      case 'stop': r.engine.stopCue(idOf(c)); break;
      case 'pause': r.engine.pause(idOf(c)); break;
      case 'resume': r.engine.resume(idOf(c)); break;
      case 'panic': r.engine.panic(); if (c.hard) r.engine.panic(); break;
      case 'fadeall': r.engine.fadeAll(Number(c.secs) || 5); break;
      case 'reset': if (c.id) resets.push(c.id); else r.engine.reset(); break;
      case 'playhead': if (c.id === null) r.engine.playhead = null; else r.engine.setPlayhead(c.id); break;
      case 'move': r.engine.movePlayhead(Number(c.step) || 0); break;
      case 'jump': if (!r.engine.jumpTo(c.number)) return { error: `no cue numbered ${c.number}` }; break;
      case 'load': return { loaded: { id: c.id || r.engine.playhead, at: c.secs } };
      case 'mode': mode = c.mode === 'show' ? 'show' : 'edit'; break;
      case 'edit': { const res = applyOps(doc, c.ops); doc = res.doc; r.engine.load(show.toEngineDoc(doc)); rev++; return { made: res.made, changed: true }; }
      default: return { error: `unknown command ${c.op}` };
    }
    return null;
  };
  return {
    cmds, resets,
    get doc() { return doc; }, get engine() { return r.engine; },
    advance: (secs: number) => r.advance(secs),
    showId: () => doc.id,
    supports: (what: string) => can.includes(what),
    onCmd: (fn: (c: Logged, res: HostResult) => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    cmd(c: Logged) { cmds.push(c); let res: HostResult; try { res = run(c) || { ok: true }; } catch (err) { res = { error: (err as Error).message }; } for (const fn of listeners) fn(c, res); return res; },
    snapshot() { const e: Partial<ReturnType<typeof r.engine.snapshot>> & { poem?: unknown } = r.engine.snapshot(); delete e.cues; delete e.poem; return { rev, doc, engine: e, show: { title: doc.title }, problems: [], mode }; },
  };
}
type FakeHost = ReturnType<typeof fakeHost>;

function aShow() {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'wait', number: '1', name: 'House to half', duration: 10 } },
    { op: 'cue.add', ref: 'b', cue: { type: 'wait', number: '2', duration: 4 } },
    { op: 'cue.add', ref: 'g', cue: { type: 'group', number: '10', name: 'Storm', children: [{ type: 'wait', ref: 'g1', number: '10.1', duration: 30 }, { type: 'memo', ref: 'g2', number: '10.2', name: 'Thunder' }] } },
    { op: 'cue.add', ref: 'm', cue: { type: 'memo', name: 'no number' } },
  ]);
  return { ...s, list: s.doc.lists[0].id };
}
/** The module with senders: `from(port, tcp)` gives say(text) → { ret, reply, port } and everything it was sent in `got`. */
/** (a show with no passcode of its own is given one that may do everything, and each sender connects with it first:
 *  a sender with no passcode may not edit, and over UDP only a sender that has connected is answered) */
type RemoteConfig = Parameters<ReturnType<typeof oscControl.create>['start']>[0];
const ALL = { code: '7777', view: true, edit: true, control: true };
const ownCodes = (config: RemoteConfig) => (Array.isArray(config.passcodes) && config.passcodes.length) || (config.passcode != null && String(config.passcode) !== '');
function remote(host: FakeHost, config: RemoteConfig = {}) {
  const m = oscControl.create({ log() {}, changed() {}, host: host as unknown as HostApi });
  const mine = ownCodes(config);
  m.start(mine ? config : { ...config, passcodes: [ALL] });
  const from = (port: number, tcp = false) => {
    const got: { address: string; args: unknown[]; port?: number }[] = [];
    const send: HubReply = (address, args = [], o = {}) => got.push({ address, args: args.map((a) => (a && typeof a === 'object' ? (a as OscTyped).value : a)), port: o.port });
    if (!mine) m.onOsc({ address: '/connect', args: [ALL.code] }, { address: '10.0.0.9', port, tcp }, () => {});
    const say = (text: string): { ret: 'done' | boolean; reply: any; port: number | null | undefined } => {
      const msg = osc.decode(osc.encode(text))!, n = got.length;
      const ret = m.onOsc(msg, { address: '10.0.0.9', port, tcp }, send);
      const back = got.slice(n).find((g) => /^\/reply/.test(g.address)) || null;
      return { ret, reply: back ? JSON.parse(String(back.args[0])) : null, port: back && back.port };
    };
    return { say, got };
  };
  return { m, ...from(5000), from };
}

// ── the words ─────────────────────────────────────────────────────────────

test('OSC text: \\T \\F \\I \\N are the arguments with no value, and a bundle is every message in it', () => {
  const m = osc.parseText('/thing \\T \\F \\I \\N 3');
  assert.deepEqual(m.args.map((a) => a.type), ['T', 'F', 'I', 'N', 'i']);
  const back = osc.decode(osc.encode(m.address, m.args))!;
  assert.equal(back.types, 'TFINi');
  assert.deepEqual(back.args, [true, false, Infinity, null, 3]);
  assert.equal(osc.toText(back), '/thing \\T \\F \\I \\N 3', 'and it reads back as it was written');
  const el = (b: Buffer) => { const n = Buffer.alloc(4); n.writeInt32BE(b.length); return Buffer.concat([n, b]); };
  const bundle = (...parts: Buffer[]): Buffer => Buffer.concat([Buffer.from('#bundle\0'), Buffer.alloc(8), ...parts.map(el)]);
  const all = osc.decodeAll(bundle(osc.encode('/a 1'), bundle(osc.encode('/b'), osc.encode('/c two'))));
  assert.deepEqual(all.map((x) => x.address), ['/a', '/b', '/c']);
  assert.deepEqual(osc.decodeAll(Buffer.from('nonsense')), []);
});

test('a message that is not OSC: text with its escapes, and bytes written in hex', () => {
  assert.deepEqual([...raw.text('PLAY 3\\r\\n')], [...Buffer.from('PLAY 3\r\n')]);
  assert.deepEqual([...raw.text('a\\tb\\0\\x41\\e\\\\n')], [0x61, 9, 0x62, 0, 0x41, 0x1b, 0x5c, 0x6e]);
  assert.deepEqual([...raw.text('C:\\path é')], [...Buffer.from('C:\\path é')], 'a backslash before anything else stays');
  assert.deepEqual([...raw.hex('FE 01 0a,0x10:ff')], [0xfe, 1, 0x0a, 0x10, 0xff]);
  assert.throws(() => raw.hex('F'), /odd number/);
  assert.throws(() => raw.hex('GG'), /not hex/);
  assert.throws(() => raw.hex('  '), /no bytes/);
  assert.equal(raw.packetFor('/a 1').osc, true);
  assert.throws(() => raw.packetFor('hello'), /not an OSC address/);
});

// ── the hub ───────────────────────────────────────────────────────────────

test('the input port over TCP: SLIP and length-prefixed, answered on the connection, with no limit on the size', async () => {
  const port = await freePort();
  const hub = createHub();
  hub.configure({ patches: [], inputPort: port, listen: true });
  const big = 'x'.repeat(40000), left: number[] = [];
  hub.onMessage((msg, from, reply) => { if (msg.address === '/big') reply('/reply/big', [big]); else reply('/reply' + msg.address, [from.tcp ? 'tcp' : 'udp']); return true; });
  hub.onGone((from) => left.push(from.port));
  await until(() => hub.status().input.tcp);
  for (const framing of ['slip', 'length']) {
    const conn = net.createConnection({ host: '127.0.0.1', port }), read = osc.deframer(framing), got: OscMessage[] = [];
    conn.on('data', (chunk) => { for (const p of read(chunk)) got.push(osc.decode(p)!); });
    await new Promise((r) => conn.on('connect', r));
    const mine = conn.localPort!;
    // (two messages in one write, and one split across two: a stream has no packet edges)
    const two = Buffer.concat([osc.frame(osc.encode('/one'), framing), osc.frame(osc.encode('/big'), framing)]);
    conn.write(two.subarray(0, 10)); await sleep(20); conn.write(two.subarray(10));
    assert.ok(await until(() => got.length === 2), `${framing}: both answered`);
    assert.deepEqual([got[0].address, got[0].args[0]], ['/reply/one', 'tcp']);
    assert.equal((got[1].args[0] as string).length, 40000, 'an answer far bigger than a UDP packet');
    assert.equal(hub.status().input.connections, 1);
    conn.destroy();
    assert.ok(await until(() => left.includes(mine)), 'and the hub says when it hangs up');
  }
  assert.match(hub.monitor().find((e) => e.dir === 'in')!.who, /\(TCP\)/);
  hub.close();
});

test('a UDP answer goes to the sender’s port, or to the port the answerer names', async () => {
  const port = await freePort();
  const hub = createHub();
  hub.configure({ patches: [], inputPort: port, listen: true });
  const fixed = await udpListener(), asker = await udpListener();
  hub.onMessage((msg, from, reply) => { reply('/back', [1]); reply('/fixed', [2], { port: fixed.port }); return true; });
  await sleep(30);
  asker.sock.send(osc.encode('/q'), port, '127.0.0.1');
  assert.ok(await until(() => asker.got.length && fixed.got.length));
  assert.equal(asker.got[0].msg.address, '/back');
  assert.equal(fixed.got[0].msg.address, '/fixed');
  hub.close(); fixed.close(); asker.close();
});

test('the monitor’s "did nothing": on a message nothing acted on, not on one that was used, and a learned message is only learned', async () => {
  const port = await freePort();
  const hub = createHub();
  hub.configure({ patches: [], inputPort: port, listen: true });
  const acted: string[] = [];
  hub.onMessage((msg) => { acted.push(msg.address); return msg.address === '/used'; });
  hub.onMessage(() => false);
  const c = dgram.createSocket('udp4');
  const say = async (text: string) => { c.send(osc.encode(text), port, '127.0.0.1'); await sleep(40); };
  await sleep(30);
  await say('/used'); await say('/stray 1');
  const learning = hub.learn(1000);
  await say('/go');
  assert.equal((await learning)!.address, '/go');
  const seen = Object.fromEntries(hub.monitor().map((e) => [e.text, e]));
  assert.equal(seen['/used'].unused, undefined);
  assert.equal(seen['/stray 1'].unused, true, 'the mark is on the entry the monitor keeps');
  assert.equal(seen['/go'].learned, true);
  assert.equal(seen['/go'].unused, undefined);
  assert.deepEqual(acted, ['/used', '/stray'], 'capturing a desk’s GO does not GO');
  hub.close(); c.close();
});

test('text and bytes go out as they are, over UDP and TCP; a patch with two destinations sends to both', async () => {
  const a = await udpListener(), b = await udpListener();
  const heard: Buffer[] = [];
  const server = net.createServer((conn) => conn.on('data', (d) => heard.push(d)));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const lo = interfaces().find((i) => i.address === '127.0.0.1');
  const hub = createHub();
  hub.configure({ patches: [
    { id: 'two', name: 'Desks', host: '127.0.0.1', port: a.port, protocol: 'udp', destinations: [{ host: '127.0.0.1', port: b.port }, { host: '', port: 1 }] },
    { id: 'proj', name: 'Projector', host: '127.0.0.1', port: (server.address() as net.AddressInfo).port, protocol: 'tcp' },
    { id: 'via', name: 'Via', host: '127.0.0.1', port: a.port, protocol: 'udp', iface: lo ? lo.name : '' },
    { id: 'lost', name: 'Lost', host: '127.0.0.1', port: a.port, protocol: 'udp', iface: 'nope9' },
    { id: 'half', name: 'Half', host: '127.0.0.1', port: a.port, protocol: 'udp', destinations: [{ host: '127.0.0.1', port: 1, protocol: 'tcp' }] },
  ] });
  assert.ok(await until(() => hub.status().patches.proj.state === 'connected'));
  const e = hub.send('two', '%1POWR 1\\r', { format: 'text' });
  assert.equal(e.ok, true);
  assert.match(e.who!, /\+1$/, 'the monitor says it went to one more place');
  assert.equal(e.text, 'text: %1POWR 1\\r');
  assert.ok(await until(() => a.got.length === 1 && b.got.length === 1));
  assert.equal(a.got[0].buf.toString(), '%1POWR 1\r');
  assert.equal(b.got[0].buf.toString(), '%1POWR 1\r');
  hub.send('two', 'FE 01 c0', { format: 'hex' });
  assert.ok(await until(() => a.got.length === 2));
  assert.deepEqual([...a.got[1].buf], [0xfe, 1, 0xc0]);
  hub.send('proj', 'FE c0 01', { format: 'hex' }); hub.send('proj', 'ON\\n', { format: 'text' });
  assert.ok(await until(() => Buffer.concat(heard).length === 6));
  assert.deepEqual([...Buffer.concat(heard)], [0xfe, 0xc0, 1, 0x4f, 0x4e, 0x0a], 'bytes on TCP are not SLIP-framed: the device’s protocol is its own');
  assert.match(hub.send('two', 'XYZ', { format: 'hex' }).why!, /not hex/);
  if (lo) { assert.equal(hub.send('via', '/by/interface 1').ok, true); assert.ok(await until(() => a.got.some((g) => g.msg && g.msg.address === '/by/interface')), 'sent from the interface it names'); }
  assert.match(hub.send('lost', '/x').why!, /nope9 is not on this computer/);
  const half = hub.send('half', '/x');
  assert.equal(half.ok, false);
  assert.match(half.why!, /127\.0\.0\.1:1: not connected/, 'the one that failed is named');
  assert.ok(await until(() => a.got.filter((g) => g.msg && g.msg.address === '/x').length === 1), 'the other still got it');
  assert.ok(hub.status().interfaces.some((i) => i.address === '127.0.0.1'));
  hub.close(); a.close(); b.close(); server.close();
});

// ── OSC control ───────────────────────────────────────────────────────────

test('OSC control: a command is answered only after /alwaysReply; a question and a refusal always are', () => {
  const s = aShow(), host = fakeHost(s.doc), r = remote(host);
  assert.deepEqual([r.say('/go').ret, r.got.length], ['done', 0]);
  assert.equal(r.say('/cue/1/name').reply.data, 'House to half');
  assert.equal(r.say('/cue/99/start').reply.status, 'error');
  assert.equal(r.say('/alwaysReply 1').reply.status, 'ok');
  assert.equal(r.say('/playhead/2').reply.status, 'ok');
  r.say('/alwaysReply 0');
  assert.equal(r.say('/playhead/1').reply, null);
});

test('OSC control: UDP answers go to 53001 as QLab’s do, to the port the sender asks for, or (set so) back where it came from; a connection needs none', () => {
  const s = aShow();
  const r = remote(fakeHost(s.doc));
  assert.equal(r.say('/version').port, 53001);
  assert.equal(r.say('/workspaces').reply.data[0].udpReplyPort, 53001);
  r.say('/udpReplyPort 7000');
  assert.equal(r.say('/version').port, 7000);
  assert.equal(r.say('/udpReplyPort').reply.data, 7000);
  r.say('/updates 1'); r.say('/playhead/2'); r.m.onState();
  assert.equal(r.got.at(-1)!.port, 7000, 'what it is pushed goes there too');
  r.say('/udpReplyPort 0');
  assert.equal(r.say('/version').port, 53001);
  assert.equal(r.say('/udpReplyPort 99999').reply.status, 'error');
  assert.equal(r.from(6000, true).say('/version').port, undefined, 'over TCP: on the connection');
  const own = remote(fakeHost(s.doc), { replyPort: 0 });
  assert.equal(own.say('/version').port, 0, '0: the hub answers the port it came from');
});

test('OSC control: a long /cueLists is refused over UDP and answered over TCP; a connection is remembered until it closes', () => {
  const ops: Op[] = []; for (let i = 0; i < 300; i++) ops.push({ op: 'cue.add', cue: { type: 'memo', number: String(i), name: `A cue with a fairly long name, number ${i}` } });
  const host = fakeHost(build(ops).doc);
  let t = 0, goneFn: ((from: HubFrom) => void) | null = null;
  const m = oscControl.create({ log() {}, changed() {}, host: host as unknown as HostApi, now: () => t, net: { onMessage: () => () => {}, onGone: (fn: (from: HubFrom) => void) => { goneFn = fn; return () => {}; }, status: () => ({ input: { port: 53000, listening: true, tcp: true } }) } as unknown as ModuleContext['net'] });
  m.start({ passcodes: [{ code: '1234', view: true }] });
  const got: Json[] = [], send: HubReply = (address, args) => got.push(JSON.parse(String((args![0] as OscTyped).value)));
  const udp = { address: '127.0.0.1', port: 9 }, tcp = { address: '127.0.0.1', port: 10, tcp: true };
  for (const from of [udp, tcp]) m.onOsc({ address: '/connect', args: ['1234'] }, from, send);
  m.onOsc({ address: '/cueLists', args: [] }, udp, send);
  assert.equal(got.at(-1)!.status, 'error');
  assert.match(got.at(-1)!.data, /ask over TCP/);
  m.onOsc({ address: '/cueLists', args: [] }, tcp, send);
  assert.equal(got.at(-1)!.data[0].cues.length, 300);
  t += 10 * 60 * 1000;                           // ten minutes of silence
  const before = got.length;
  m.onOsc({ address: '/cue/1/name', args: [] }, udp, send);
  assert.equal(got.length, before, 'a UDP sender is forgotten after 61 s, and is not answered until it connects again');
  m.onOsc({ address: '/cue/1/name', args: [] }, tcp, send);
  assert.equal(got.at(-1)!.status, 'ok', 'a connection is not');
  assert.match(m.status().text, /UDP and TCP 53000 · 1 connected/);
  goneFn!(tcp);
  m.onOsc({ address: '/cue/1/name', args: [] }, tcp, send);
  assert.equal(got.at(-1)!.status, 'denied', 'until it hangs up');
});

test('OSC control: passcodes grant view, edit and control apart; the no-passcode row says what a stranger may do', () => {
  const s = aShow(), host = fakeHost(s.doc);
  const r = remote(host, { passcodes: [{ code: '1111', view: true }, { code: '0222', view: true, control: true }, { code: '3333', view: true, edit: true, control: true }], noPasscode: { view: true } });
  // nobody: may look (over TCP: over UDP a sender that has not connected is not answered)
  const stranger = r.from(1, true);
  assert.equal(stranger.say('/cue/1/name').reply.data, 'House to half');
  assert.equal(stranger.say('/go').reply.status, 'denied');
  assert.equal(stranger.say('/cue/1/name Changed').reply.status, 'denied');
  assert.equal(stranger.say('/connect').reply.data, 'ok:view');
  assert.equal(host.cmds.length, 0);
  // view only
  const viewer = r.from(2);
  assert.equal(viewer.say('/connect 1111').reply.data, 'ok:view');
  for (const text of ['/go', '/cue/1/start', '/playhead/2', '/showMode 1', '/cue/1/loadAt 3', '/panic', '/save', '/undo', '/new memo', `/delete_id/${s.id('a')}`, '/renumber 5 1', `/move/${s.id('a')} 1`, '/cue/1/armed 0'])
    assert.equal(viewer.say(text).reply.status, 'denied', text);
  assert.equal(host.cmds.length, 0, 'and nothing reached the host');
  assert.equal(viewer.say('/cueLists').reply.status, 'ok');
  assert.equal(viewer.say('/showMode').reply.data, false);
  assert.equal(viewer.say('/updates 1').ret, 'done', 'updates are for anyone who may connect');
  // control without edit (its passcode sent as the number 222, as a keypad would)
  const op = r.from(3);
  assert.equal(op.say('/connect 222').reply.data, 'ok:view|control');
  assert.equal(op.say('/go').ret, 'done');
  assert.equal(op.say('/cue/2/notes "do not"').reply.status, 'denied');
  assert.match(op.say('/new memo').reply.data, /edit access/);
  // everything
  const all = r.from(4);
  assert.equal(all.say('/connect 3333').reply.data, 'ok:view|edit|control');
  assert.equal(all.say('/cue/2/notes "do"').ret, 'done');
  assert.equal(show.findByNumber(host.doc, '2')!.notes, 'do');
  // a wrong one, and no passcode where the row grants nothing
  assert.deepEqual(r.from(5).say('/connect 9999').reply, { workspace_id: s.doc.id, address: '/connect', status: 'denied', data: 'badpass' });
  const closed = remote(fakeHost(s.doc), { passcodes: [{ code: '1111', view: true, edit: true, control: true }] });
  assert.equal(closed.say('/connect').reply.data, 'badpass');
  assert.equal(closed.from(6, true).say('/cue/1/name').reply.status, 'denied');
  assert.equal(closed.say('/version').reply.data, '5.0.0', '/version answers whoever asks');
  // the older single passcode still grants everything; no passcode at all lets anyone view and run the show, never edit it
  assert.equal(remote(fakeHost(s.doc), { passcode: 'abc' }).say('/connect abc').reply.data, 'ok:view|edit|control');
  assert.deepEqual(oscControl.accessOf({}).none, { view: true, edit: false, control: true });
  assert.deepEqual(oscControl.accessOf({ noPasscode: { view: true, edit: true, control: true } }).none, { view: true, edit: false, control: true }, 'a row that says edit is not taken at its word');
  assert.deepEqual(oscControl.accessOf({ passcode: 'x' }).none, { view: false, edit: false, control: false });
});

test('OSC control: wrong passcodes make the next try wait, longer each time', () => {
  let t = 0;
  const m = oscControl.create({ log() {}, changed() {}, host: fakeHost(aShow().doc) as unknown as HostApi, now: () => t });
  m.start({ passcodes: [{ code: '1234', view: true }] });
  const got: unknown[] = [], from = { address: '10.0.0.5', port: 1 }, send: HubReply = (a, args) => got.push(JSON.parse(String((args![0] as OscTyped).value)).data);
  const tryIt = (code: string) => { m.onOsc({ address: '/connect', args: [code] }, from, send); return got.at(-1); };
  assert.equal(tryIt('1'), 'badpass');
  assert.equal(tryIt('1234'), 'error', 'even the right one, at once after a wrong one');
  t += 1100; assert.equal(tryIt('2'), 'badpass');
  t += 1100; assert.equal(tryIt('1234'), 'error', 'the second wait is two seconds');
  t += 1000; assert.equal(tryIt('1234'), 'ok:view');
});

test('OSC control: /new, /move, /delete and /renumber are edits (one undo step each, refused in Show mode)', () => {
  const s = aShow(), host = fakeHost(s.doc), r = remote(host);
  const top = () => host.doc.lists[0].cues.map((c) => c.number || c.type);
  // a new cue lands after the one standing by, and then stands by itself
  r.say('/playhead/1');
  const made = r.say('/new memo').reply.data;
  assert.deepEqual(top(), ['1', 'memo', '2', '10', 'memo']);
  assert.equal(host.doc.lists[0].cues[1].id, made, 'the answer is the new cue’s id');
  assert.equal(host.engine.playhead, made);
  const edits = host.cmds.filter((c) => c.op === 'edit');
  assert.equal(edits.length, 1);
  assert.equal(edits[0].ops[0].op, 'cue.add');
  // …or after the cue named
  const fade = r.say(`/new fade ${s.id('g')}`).reply.data;
  assert.equal(host.doc.lists[0].cues[4].id, fade);
  assert.match(r.say('/new video').reply.data, /no video cue/);
  assert.match(r.say('/new sandwich').reply.data, /not a kind of cue/);
  assert.equal(r.say('/new').reply.status, 'error');
  const list = r.say('/new "cue list"').reply.data;
  assert.equal(host.doc.lists[1].id, list);
  // renumber: the cue standing by
  r.say(`/playheadID/${made}`);
  assert.equal(r.say('/renumber 7 1 Q x').reply, null);
  assert.equal(host.doc.lists[0].cues[1].number, 'Q7x');
  assert.equal(r.say('/renumber').reply.status, 'error');
  // move: to a place in its own list, into a group, and out again
  assert.deepEqual(r.say(`/move/${made} 0`).reply.data, { parent: s.list, index: 0 });
  assert.equal(top()[0], 'Q7x');
  assert.deepEqual(r.say(`/move/${made} 1 ${s.id('g')}`).reply.data, { parent: s.id('g'), index: 1 });
  assert.deepEqual(show.findByNumber(host.doc, '10')!.children!.map((c) => c.number), ['10.1', 'Q7x', '10.2']);
  assert.deepEqual(r.say(`/move/${made} 99 ${s.list}`).reply.data, { parent: s.list, index: 5 }, 'past the end is the end');
  assert.match(r.say(`/move/${s.id('g')} 0 ${s.id('g1')}`).reply.data, /not a cue list or a group/);
  assert.equal(r.say('/move/nope 0').reply.status, 'error');
  // delete: by number, by id, the one standing by; a group takes its children with it
  r.say('/alwaysReply 1');
  assert.equal(r.say('/delete/Q7x').reply.status, 'ok');
  assert.equal(r.say(`/delete_id/${fade}`).reply.status, 'ok');
  assert.equal(r.say('/delete/1*').reply.status, 'ok', 'a pattern: 1, 10 and what is in 10, as one edit');
  assert.deepEqual(top(), ['2', 'memo']);
  r.say('/playhead/2');
  assert.equal(r.say('/delete/selected').reply.status, 'ok');
  assert.deepEqual(top(), ['memo']);
  assert.equal(r.say('/delete/77').reply.status, 'error');
  // Show mode locks all of it
  r.say('/showMode 1');
  for (const text of ['/new memo', '/delete/selected', '/renumber 1 1', `/move/${host.doc.lists[0].cues[0].id} 0`]) assert.match(r.say(text).reply.data, /Show mode/, text);
  assert.deepEqual(top(), ['memo']);
});

test('OSC control: loading a cue that is not standing by, one cue’s reset and /playhead/none wait for a host that has them', () => {
  const s = aShow();
  const old = fakeHost(s.doc), r = remote(old);
  r.say('/playhead/1');
  assert.equal(r.say('/cue/1/loadAt 3').ret, 'done', 'the cue standing by loads as before');
  assert.deepEqual(old.cmds.at(-1), { op: 'load', secs: 3, from: 'osc' });
  const n = old.cmds.length;
  assert.match(r.say('/cue/2/loadAt 3').reply.data, /only the cue standing by can be loaded/);
  assert.match(r.say('/cue/2/load').reply.data, /only the cue standing by/);
  assert.match(r.say('/cue/2/reset').reply.data, /cannot be reset from here yet/);
  assert.match(r.say('/playhead/none').reply.data, /cannot be taken off the list from here yet/);
  assert.equal(old.cmds.length, n, 'and the host is not asked for what it would do wrongly');

  const host = fakeHost(s.doc, ['load-id', 'reset-id', 'playhead-none']), q = remote(host);
  q.say('/playhead/1');
  q.say('/cue/2/loadAt 0 1 30');
  assert.deepEqual(host.cmds.at(-1), { op: 'load', id: s.id('b'), secs: 90, from: 'osc' });
  q.say('/cue/10.1/load');
  assert.deepEqual(host.cmds.at(-1), { op: 'load', id: s.id('g1'), secs: 0, from: 'osc' });
  q.say('/cue/2/reset');
  assert.deepEqual(host.resets, [s.id('b')]);
  q.say('/playhead/none');
  assert.deepEqual(host.cmds.at(-1), { op: 'playhead', id: null, from: 'osc' });
  assert.equal(host.engine.playhead, null);
  // the playhead's other places
  assert.match(q.say('/playhead/active').reply.data, /no cue is running/);
  q.say('/cue/2/start');
  q.say('/playhead/active');
  assert.equal(host.engine.playhead, s.id('b'), 'onto the first cue that is running');
  assert.equal(q.say('/playhead/selected').ret, 'done');
  assert.equal(host.engine.playhead, s.id('b'));
});

// ── show control broadcast ────────────────────────────────────────────────

test('QLab’s events: what /listen names, and the messages an event becomes', () => {
  assert.equal(events.keysOf('')!.length, 5 * 5 + 6);
  assert.deepEqual(events.keysOf('/go'), ['go', 'go/number', 'go/name', 'go/uniqueID', 'go/type']);
  assert.deepEqual(events.keysOf('/cue/start/name'), ['cue/start/name']);
  assert.deepEqual(events.keysOf('/panicAll'), ['panicAll']);
  assert.equal(events.keysOf('/cue'), null);
  assert.equal(events.keysOf('/go/colour'), null);
  const cue = { number: '12', name: 'Door slam', uniqueID: 'abc', type: 'Audio' };
  const plain = (list: events.EventMessage[]) => list.map(([a, args]) => [a, ...args.map((x) => x.value)]);
  assert.deepEqual(plain(events.messages('go', cue, new Set(events.keysOf('/go')))), [
    ['/qlab/event/workspace/go', '12', 'Door slam', 'abc', 'Audio'],
    ['/qlab/event/workspace/go/number', '12'], ['/qlab/event/workspace/go/name', 'Door slam'],
    ['/qlab/event/workspace/go/uniqueID', 'abc'], ['/qlab/event/workspace/go/type', 'Audio']]);
  assert.deepEqual(events.messages('go', cue, new Set(['cue/stop'])), []);
  assert.deepEqual(plain(events.messages('pauseAll', null, new Set(['pauseAll']))), [['/qlab/event/workspace/pauseAll']]);
  // a format of the client's own: only the one-argument messages, reworded
  const subs = new Set(events.keysOf(''));
  assert.deepEqual(plain(events.messages('go', cue, new Set(['go', 'go/number']), { format: '/eos/cue/#data#/fire' })), [['/eos/cue/12/fire']]);
  assert.deepEqual(plain(events.messages('go', cue, new Set(['go/name']), { format: '/said "#data#" #address# 3', workspaceId: 'w' })), [['/said', 'Door slam', '/qlab/event/workspace/go/name', 3]]);
  assert.deepEqual(events.messages('pauseAll', null, subs, { format: '/x #data#' }), []);
  assert.throws(() => events.parseFormat('no slash'), /not an OSC address/);
});

test('OSC control: /listen sends QLab’s events for a GO, a cue started another way, a stop, the playhead and the "All" commands', () => {
  const s = aShow(), host = fakeHost(s.doc), r = remote(host);
  const heard = () => { r.m.onState(); return r.got.splice(0).filter((g) => /^\/qlab\/event/.test(g.address)).map((g) => [g.address.replace('/qlab/event/workspace/', ''), ...g.args]); };
  host.cmd({ op: 'go' }); r.m.onState();
  assert.deepEqual(heard(), [], 'nobody listens yet');
  host.cmd({ op: 'panic', hard: true });
  r.say('/listen/go'); r.say('/listen/cue/start/number'); r.say('/listen/cue/stop/number'); r.say('/listen/playhead/number'); r.say('/listen/pauseAll'); r.say('/listen/panicAll'); r.say('/listen/stopAll');
  assert.deepEqual(heard(), [], 'what was already so is not news');
  host.advance(1);
  host.cmd({ op: 'jump', number: '1' });
  assert.deepEqual(heard(), [['playhead/number', '1']]);
  host.cmd({ op: 'go' });
  assert.deepEqual(heard(), [['go', '1', 'House to half', s.id('a'), 'Wait'], ['go/number', '1'], ['go/name', 'House to half'], ['go/uniqueID', s.id('a')], ['go/type', 'Wait'], ['playhead/number', '2']]);
  host.cmd({ op: 'start', number: '10' });
  assert.deepEqual(heard(), [['cue/start/number', '10'], ['cue/start/number', '10.1']], 'a cue started by anything but GO is a cue/start');
  host.cmd({ op: 'pause' });
  assert.deepEqual(heard(), [['pauseAll']]);
  host.cmd({ op: 'pause', number: '1' });
  assert.deepEqual(heard(), [], 'pausing one cue is not "pause all"');
  host.cmd({ op: 'resume' });
  assert.deepEqual(heard(), [], 'not listened to');
  host.advance(11);
  assert.deepEqual(heard(), [['cue/stop/number', '1']], 'a cue that runs out has stopped');
  r.say('/stop');
  assert.deepEqual(heard().sort(), [['cue/stop/number', '10'], ['cue/stop/number', '10.1'], ['stopAll']]);
  host.cmd({ op: 'panic' });
  assert.deepEqual(heard(), [['panicAll']]);
  // its own wording: the recipe from QLab's manual for making a desk follow
  r.say('/ignore'); r.say('/listen/go/number'); r.say('/eventFormat "/eos/cue/#data#/fire"');
  assert.equal(r.say('/eventFormat').reply.data, '/eos/cue/#data#/fire');
  host.advance(1); host.cmd({ op: 'jump', number: '2' }); host.cmd({ op: 'go' });
  r.m.onState();
  assert.deepEqual(r.got.splice(0).filter((g) => !/^\/reply/.test(g.address)).map((g) => [g.address, g.port]), [['/eos/cue/2/fire', 53001]]);
  assert.equal(r.say('/eventFormat nonsense').reply.status, 'error');
  assert.match(r.say('/listen/everything').reply.data, /not an event/);
  r.say('/eventFormat ""'); r.say('/ignore/go/number');
  host.advance(1); host.cmd({ op: 'jump', number: '1' }); host.cmd({ op: 'go' });
  assert.deepEqual(heard(), []);
});

// ── show commands from any message ────────────────────────────────────────

test('an OSC message set to a show command: by address, by pattern, and only with its arguments when it has them', () => {
  const set = { go: '/box/1', panic: '/box/4 1', pause: '', next: '/deck/*/down', previous: 'not an address', bogus: '/box/1' };
  const said = (text: string) => commandsFor(set, osc.decode(osc.encode(text))!).map((h) => [h.what, h.cmd]);
  assert.deepEqual(said('/box/1'), [['go', { op: 'go' }]]);
  assert.deepEqual(said('/box/1 0.5'), [['go', { op: 'go' }]], 'no arguments asked for: any will do');
  assert.deepEqual(said('/box/4 1'), [['panic', { op: 'panic' }]]);
  assert.deepEqual(said('/box/4 0'), [], 'the button coming up is not the button going down');
  assert.deepEqual(said('/deck/a/down'), [['next', { op: 'move', step: 1 }]]);
  assert.deepEqual(said('/elsewhere'), []);
  assert.deepEqual(Object.keys(show.newShow('x').settings.network.commands), Object.keys(show.newShow('x').settings.midi.commands), 'the same commands as MIDI has');
});

// ── the web remote ────────────────────────────────────────────────────────

test('the web remote: a level per bus and Load to Time, as clean host commands; off with the switch', async () => {
  const port = await freePort();
  const cmds: HostCommand[] = [];
  const snapshot = () => ({ show: { title: 'T' }, rows: [], engine: { listName: 'Main', playhead: 'c1', live: [], paused: [], disarmed: [], active: [], loaded: { id: 'c1', at: 90 } },
    mixer: { masterDb: -3, buses: [{ id: 'music', name: 'Music', db: -6, peak: -20 }] } });
  const m = webRemote.create({ log() {}, changed() {}, host: { cmd: (c: HostCommand) => { cmds.push(c); return { ok: true }; }, snapshot } } as unknown as ModuleContext);
  m.start({ port, key: 'k', control: true });
  await sleep(40);
  const post = async (c: Record<string, unknown>) => (await fetch(`http://127.0.0.1:${port}/cmd?k=k`, { method: 'POST', body: JSON.stringify(c) })).status;
  const view = async () => { const res = await fetch(`http://127.0.0.1:${port}/events?k=k`); const reader = res.body!.getReader(); const { value } = await reader.read(); reader.cancel(); return JSON.parse(Buffer.from(value!).toString().replace(/^data: /, '')); };
  assert.deepEqual((await view()).mix, { masterDb: -3, buses: [{ id: 'music', name: 'Music', db: -6 }], loaded: { id: 'c1', at: 90 }, min: -60, max: 12 });
  assert.equal(await post({ op: 'bus', name: 'music', db: -12.04, commit: true, secs: 99 }), 200);
  assert.equal(await post({ op: 'master', db: 40, commit: 'yes' }), 200);
  assert.equal(await post({ op: 'load', secs: 75.5, id: 'elsewhere' }), 200);
  assert.deepEqual(cmds, [{ op: 'bus', name: 'music', db: -12, commit: true, from: 'web-remote' }, { op: 'master', db: 12, from: 'web-remote' }, { op: 'load', secs: 75.5, from: 'web-remote' }],
    'rounded, kept on the fader’s scale, and only the fields these commands have');
  assert.equal(await post({ op: 'bus', name: 'music', db: 'loud' }), 403);
  assert.equal(await post({ op: 'load' }), 403);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/?k=k`)).text(), /Load to time/);
  m.stop();
  m.start({ port, key: 'k', control: true, levels: false });
  await sleep(40);
  assert.equal((await view()).mix, null);
  assert.equal(await post({ op: 'bus', name: 'music', db: -12 }), 403);
  assert.equal(await post({ op: 'go' }), 200);
  m.stop();
  m.start({ port, key: 'k', control: false });
  await sleep(40);
  assert.equal(await post({ op: 'master', db: 0 }), 403, 'a view only: nothing at all');
  m.stop();
});

test('Show feedback: no GO for what happened before it was switched on, and a cue with no number is named by its name', () => {
  const feedback = require('../app/main/modules/show-feedback') as typeof import('../app/main/modules/show-feedback');
  const s = aShow(), host = fakeHost(s.doc), sent: string[] = [];
  host.cmd({ op: 'go' });
  const rows = () => host.doc.lists[0].cues.map((c) => ({ id: c.id, number: c.number || '', name: c.name || '' }));
  const m = feedback.create({ host: { snapshot: () => ({ ...host.snapshot(), rows: rows() }) }, net: { send: (patch: string, text: string) => sent.push(text) } } as unknown as ModuleContext);
  m.start({ patch: 'p1', prefix: '/ec/' });
  m.onState();
  assert.deepEqual(sent.filter((t) => t.startsWith('/ec/go')), [], 'the GO from before is not news');
  host.advance(1); host.cmd({ op: 'go' }); m.onState();
  assert.ok(sent.includes('/ec/go "2" ""'));
  sent.length = 0;
  host.cmd({ op: 'start', id: s.id('m') }); host.cmd({ op: 'jump', number: s.id('m') }); m.onState();
  assert.ok(sent.includes('/ec/playhead "" "no number"'), sent.join(' | '));
});

test('OSC control with no passcode: anyone may view and run the show, nobody may change it', () => {
  const s = aShow(), host = fakeHost(s.doc);
  const m = oscControl.create({ log() {}, changed() {}, host: host as unknown as HostApi });
  m.start({});
  const got: Json[] = [], send: HubReply = (address, args) => got.push(JSON.parse(String((args![0] as OscTyped).value)));
  const from = { address: '10.0.0.9', port: 7000, tcp: true };
  const say = (address: string, args: OscValue[] = []) => { m.onOsc({ address, args }, from, send); return got.at(-1)!; };
  assert.equal(say('/connect').data, 'ok:view|control');
  say('/alwaysReply', [1]);
  assert.equal(say('/go').status, 'ok');
  assert.equal(say('/cue/1/name').data, 'House to half');
  for (const [address, args] of <[string, OscValue[]][]>[['/cue/1/name', ['Changed']], ['/save', []], ['/new', ['memo']], ['/delete/1', []], ['/renumber', [5, 1]], ['/undo', []], [`/move/${s.id('a')}`, [1]]])
    assert.equal(say(address, args).status, 'denied', address);
  assert.equal(show.findByNumber(host.doc, '1')!.name, 'House to half');
  assert.ok(!host.cmds.some((c) => ['edit', 'save', 'undo'].includes(c.op)), 'no edit reached the host');
});

test('OSC control is no UDP reflector: a sender that has not connected gets no answer, and one address gets 32 KB a second at most', () => {
  const ops: Op[] = []; for (let i = 0; i < 40; i++) ops.push({ op: 'cue.add', cue: { type: 'memo', number: String(i), name: `A cue with a fairly long name, number ${i}` } });
  const host = fakeHost(build(ops).doc);
  let t = 1e6;
  const m = oscControl.create({ log() {}, changed() {}, host: host as unknown as HostApi, now: () => t });
  m.start({});
  const sent: { address: string; bytes: number; port?: number }[] = [], send: HubReply = (address, args, o) => sent.push({ address, bytes: osc.encode(address, args).length, port: o && o.port });
  const forged = { address: '192.0.2.7', port: 53535 };
  m.onOsc({ address: '/cueLists', args: [] }, forged, send);
  m.onOsc({ address: '/cue/1/name', args: [] }, forged, send);
  assert.equal(sent.length, 0, 'nothing goes to an address that never connected');
  m.onOsc({ address: '/go', args: [] }, forged, send);
  assert.equal(host.cmds.filter((c) => c.op === 'go').length, 1, 'a plain GO from a box that never connects still works');
  m.onOsc({ address: '/version', args: [] }, forged, send);
  assert.equal(sent.length, 1, '/version is answered: it is short');
  // a client that connects is answered as QLab answers one: on 53001
  m.onOsc({ address: '/connect', args: [] }, forged, send);
  sent.length = 0;
  for (let i = 0; i < 20; i++) m.onOsc({ address: '/cueLists', args: [] }, forged, send);
  const bytes = sent.reduce((n, x) => n + x.bytes, 0);
  assert.ok(sent.length >= 1 && sent.every((x) => x.port === 53001), 'answered on 53001');
  assert.ok(bytes <= 32768, `at most 32 KB in a second (${bytes})`);
  assert.ok(sent.length < 20, 'the rest are not sent');
  t += 1000;
  const n = sent.length;
  m.onOsc({ address: '/cueLists', args: [] }, forged, send);
  assert.equal(sent.length, n + 1, 'a second later it is answered again');
});
