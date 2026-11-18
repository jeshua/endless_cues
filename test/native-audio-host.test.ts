// The native audio engine's app side (docs/specs/18-native-audio.md, app/main/native-audio.ts): the process (lines in
// and out, restarts, giving up) on a fake child process, and which engine each command and event belongs to.
// (The arithmetic both engines share is test/native-audio.test.ts.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import { createNativeAudio, createAudioRouter, toNative, fromNative, routeOf, lineSplitter, parseLine, binaryPath, engineOf, WINDOW_OPS } from '../app/main/native-audio';
import type { NativeChild, Spawn, NativeCommand, AudioEngine } from '../app/main/native-audio';
import type { AudioCommand, AudioEvent } from '../app/main/host';

/** A child process that records what it is written and says what the test tells it to. */
class FakeChild extends EventEmitter {
  written: string[] = [];
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = Object.assign(new EventEmitter(), {
    write: (chunk: string) => { this.written.push(chunk); return true; },
    end: () => {},
  });
  kill() { this.killed = true; return true; }
  /** what it was sent, one command a line */
  commands() { return this.written.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l) as NativeCommand); }
  say(text: string) { this.stdout.emit('data', Buffer.from(text)); }
  exit(code = 1) { this.emit('exit', code, null); }
}

/** A process manager on a fake spawn and a fake clock: every child it started, what it said, what it logged. */
function fake({ binary = '/bin/ec-audio', exists = true, silent = false } = {}) {
  let t = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const children: FakeChild[] = [], args: string[][] = [], events: AudioEvent[] = [], logs: string[] = [], exits: string[] = [], gaveUp: string[] = [];
  const spawn: Spawn = (_cmd, a) => { const c = new FakeChild(); children.push(c); args.push(a); return c as unknown as NativeChild; };
  const n = createNativeAudio({ binary, spawn, silent, exists: () => exists, log: (l) => logs.push(l), onEvent: (e) => events.push(e), onExit: (w) => exits.push(w), onGiveUp: (w) => gaveUp.push(w),
    now: () => t, later: (fn, ms) => { timers.push({ at: t + ms, fn }); } });
  const advance = (ms: number) => { t += ms; for (const x of timers.splice(0).sort((a, b) => a.at - b.at)) { if (x.at <= t) x.fn(); else timers.push(x); } };
  return { n, children, args, events, logs, exits, gaveUp, advance };
}

test('the native engine: commands go in as JSON lines, and events come out a line at a time, however the bytes arrive', () => {
  const f = fake({ silent: true });
  f.n.start();
  assert.equal(f.children.length, 1);
  assert.deepEqual(f.args[0], ['--silent'], 'a test run asks for no device');
  assert.equal(f.n.send({ op: 'devices' }), true);
  assert.equal(f.n.send({ op: 'play', key: 'c1', file: '/s/a.wav', gainDb: -3 }), true);
  assert.deepEqual(f.children[0].written, ['{"op":"devices"}\n', '{"op":"play","key":"c1","file":"/s/a.wav","gainDb":-3}\n']);
  // a line split across chunks, two lines in one, a Windows line end, a blank line
  const c = f.children[0];
  c.say('{"type":"rea');
  assert.deepEqual(f.events, [], 'half a line is not an event');
  c.say('dy"}\n{"type":"ended","key":"c1"}\r\n\n{"type":"where","key":"c1",');
  c.say('"t":1.5,"at":1700000000000}\n');
  assert.deepEqual(f.events, [{ type: 'ready' }, { type: 'ended', key: 'c1' }, { type: 'where', key: 'c1', t: 1.5, at: 1700000000000 }]);
  // what is not an event is logged, not passed on; standard error is the log
  c.say('hello\n{"type":"nonsense"}\n[1]\n');
  c.stderr.emit('data', 'opened the output at 48000 Hz\npartial');
  c.stderr.emit('data', ' line\n');
  assert.equal(f.events.length, 3);
  assert.ok(f.logs.some((l) => l.startsWith('[native] not JSON: hello')));
  assert.ok(f.logs.some((l) => l.startsWith('[native] not an event: {"type":"nonsense"}')));
  assert.ok(f.logs.some((l) => l.startsWith('[native] not an object')));
  assert.ok(f.logs.includes('[native] opened the output at 48000 Hz') && f.logs.includes('[native] partial line'));
});

test('the native engine is started again when it exits, and given up after three exits in a minute', () => {
  const f = fake();
  f.n.start();
  f.children[0].exit(101);
  assert.equal(f.n.running(), false);
  assert.equal(f.n.send({ op: 'stopAll' }), false, 'nothing to send to between an exit and the restart');
  assert.equal(f.exits.length, 1);
  f.advance(500);
  assert.equal(f.children.length, 2, 'started again');
  assert.equal(f.n.running(), true);
  // two more exits within the minute: given up, and not started again
  f.advance(10_000); f.children[1].exit(); f.advance(500);
  assert.equal(f.children.length, 3);
  f.advance(10_000); f.children[2].exit(); f.advance(500);
  assert.equal(f.children.length, 3, 'not started a fourth time');
  assert.equal(f.gaveUp.length, 1);
  assert.match(f.gaveUp[0], /3 times in a minute/);
  assert.equal(f.n.gaveUp(), f.gaveUp[0]);
  f.n.start();
  assert.equal(f.children.length, 3, 'given up is for the sitting');
});

test('exits spread over more than a minute are not three in a minute', () => {
  const f = fake();
  f.n.start();
  for (let i = 0; i < 5; i++) { f.advance(40_000); f.children.at(-1)!.exit(); f.advance(500); }
  assert.equal(f.children.length, 6);
  assert.deepEqual(f.gaveUp, []);
});

test('no program, or one that cannot be started: given up at once, and stopping on purpose is not an exit', () => {
  const none = fake({ binary: '/nowhere/ec-audio', exists: false });
  none.n.start();
  assert.equal(none.children.length, 0);
  assert.match(none.gaveUp[0], /no native engine on this computer/);
  const enoent = fake();
  enoent.n.start();
  enoent.children[0].emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
  enoent.children[0].exit(-2);
  enoent.advance(1000);
  assert.equal(enoent.children.length, 1, 'not tried again');
  assert.equal(enoent.gaveUp.length, 1);
  const stopped = fake();
  stopped.n.start();
  stopped.n.stop();
  assert.equal(stopped.children[0].killed, true);
  stopped.children[0].exit(0);
  stopped.advance(1000);
  assert.deepEqual([stopped.children.length, stopped.exits, stopped.gaveUp], [1, [], []]);
});

test('a command for the native engine names its files by path: no bytes, no file:// URL', () => {
  const names = new Map<string, string>();
  const url = pathToFileURL('/show/media/Rain 1.wav').href;
  const play = toNative({ op: 'play', key: 'c', url, gainDb: -6, loop: true }, names);
  assert.deepEqual(play, { op: 'play', key: 'c', gainDb: -6, loop: true, file: '/show/media/Rain 1.wav' });
  assert.deepEqual(toNative({ op: 'play', key: 'm', mic: { channel: 1 } }, names), { op: 'play', key: 'm', mic: { channel: 1 } });
  assert.deepEqual(toNative({ op: 'decode', url, file: 'media/Rain 1.wav', bytes: Buffer.from('x') }, names), { op: 'decode', file: '/show/media/Rain 1.wav' });
  assert.deepEqual(toNative({ op: 'keep', urls: [url] }, names), { op: 'keep', files: ['/show/media/Rain 1.wav'] });
  assert.deepEqual(toNative({ op: 'probe', files: [{ file: 'media/b.mp3', url: pathToFileURL('/show/media/b.mp3').href }] }, names), { op: 'probe', files: [{ file: '/show/media/b.mp3' }] });
  assert.deepEqual(toNative({ op: 'ir', file: 'rooms/hall.wav', bytes: Buffer.from('x') }, names, (f) => `/show/${f}`), { op: 'ir', file: '/show/rooms/hall.wav' });
  assert.deepEqual(toNative({ op: 'fade', key: 'c', db: -60, secs: 2 }, names), { op: 'fade', key: 'c', db: -60, secs: 2 }, 'anything else as it is');
  for (const c of [play, toNative({ op: 'decode', url, file: 'x', bytes: new Uint8Array(4) }, new Map())]) assert.ok(!('bytes' in c) && !JSON.stringify(c).includes('file://'));
  // its answers come back under the show's names
  assert.deepEqual(fromNative({ type: 'decoded', file: '/show/media/Rain 1.wav', secs: 12.5 }, names), { type: 'decoded', file: 'media/Rain 1.wav', secs: 12.5 });
  assert.deepEqual(fromNative({ type: 'duration', file: '/show/media/b.mp3', secs: 3 }, names), { type: 'duration', file: 'media/b.mp3', secs: 3 });
  assert.deepEqual(fromNative({ type: 'missing', file: '/elsewhere.wav' }, names), { type: 'missing', file: '/elsewhere.wav' });
  assert.deepEqual(fromNative({ type: 'ended', key: 'c' }, names), { type: 'ended', key: 'c' });
});

test('which engine a command goes to: with the native engine, everything but MIDI, peaks and samples', () => {
  const ops = ['play', 'stop', 'stopAll', 'fade', 'decode', 'keep', 'probe', 'devices', 'sink', 'outputs', 'masterDb', 'buses', 'limiter', 'ducker', 'design', 'ltc', 'record', 'where', 'midi', 'peaks', 'pcm'];
  for (const op of ops) assert.equal(routeOf(op, 'webaudio'), 'window', op);
  assert.deepEqual(ops.filter((op) => routeOf(op, 'native') === 'window'), ['midi', 'peaks', 'pcm']);
  assert.deepEqual([...WINDOW_OPS].sort(), ['midi', 'pcm', 'peaks']);
  // the setting: native only when it says so
  assert.deepEqual([engineOf({}), engineOf(null), engineOf({ audio: { engine: 'native' } }), engineOf({ audio: { engine: 'rust' } })], ['webaudio', 'webaudio', 'native', 'webaudio']);
  assert.equal(binaryPath({ packaged: true, resourcesPath: '/App/Contents/Resources', root: '/src', platform: 'darwin' }), path.join('/App/Contents/Resources', 'ec-audio'));
  assert.equal(binaryPath({ packaged: false, root: '/src', platform: 'win32' }), path.join('/src', 'native', 'target', 'release', 'ec-audio.exe'));
});

/** The host's side of it: a router between a fake window and a fake native engine, recording what each is sent and
 *  what reaches the host's handler. */
function routed() {
  const toWindow: AudioCommand[] = [], toNativeCmds: NativeCommand[] = [], heard: AudioEvent[] = [], down: [AudioEngine, string][] = [], fellBack: string[] = [];
  let started = 0, stopped = 0;
  let handlers: Parameters<Parameters<typeof createAudioRouter>[0]['makeNative']>[0] | null = null;
  let giveUpAtStart: string | null = null;
  const router = createAudioRouter({
    toWindow: (c) => toWindow.push(c),
    makeNative: (h) => { handlers = h; return { start: () => { started++; if (giveUpAtStart) h.onGiveUp(giveUpAtStart); }, send: (c) => { toNativeCmds.push(c); return true; }, stop: () => { stopped++; } }; },
    resolve: (f) => `/show/${f}`,
    onEvent: (e) => heard.push(e), onDown: (e, why) => down.push([e, why]), onFellBack: (w) => fellBack.push(w),
  });
  return { router, toWindow, toNative: toNativeCmds, heard, down, fellBack, native: () => handlers!, started: () => started, stopped: () => stopped, giveUpAtStart: (w: string) => { giveUpAtStart = w; } };
}
const level = (voices: number): AudioEvent => ({ type: 'level', channels: [], buses: {}, voices });

test('the host on Web Audio: everything goes to the window, as before', () => {
  const r = routed();
  r.router.cmd({ op: 'play', key: 'a', url: 'file:///a.wav' });
  assert.equal(r.toWindow.length, 0, 'nothing before the window is ready');
  r.router.fromWindow({ type: 'ready' });
  assert.deepEqual(r.heard, [{ type: 'ready' }]);
  for (const op of ['play', 'midi', 'peaks', 'stopAll']) r.router.cmd({ op, key: 'a' });
  assert.deepEqual(r.toWindow.map((c) => c.op), ['play', 'midi', 'peaks', 'stopAll']);
  r.router.fromWindow(level(1));
  assert.deepEqual(r.heard.map((e) => e.type), ['ready', 'level']);
  assert.equal(r.started(), 0, 'the native engine is never started');
  r.router.windowGone();
  assert.deepEqual(r.down.map((d) => d[0]), ['webaudio']);
});

test('the host on the native engine: sound to it, MIDI and waveforms to the window; the window’s levels ignored', () => {
  const r = routed();
  r.router.fromWindow({ type: 'ready' });
  assert.equal(r.router.choose('native'), 'now');
  assert.equal(r.started(), 1);
  assert.deepEqual(r.down.map((d) => d[0]), ['webaudio'], 'nothing is ready to play until the native engine says so');
  r.router.cmd({ op: 'play', key: 'a', url: 'file:///a.wav' });
  assert.equal(r.toNative.length, 0, 'not before it is ready');
  r.native().onEvent({ type: 'ready' });
  assert.deepEqual(r.heard.map((e) => e.type), ['ready', 'ready']);
  r.router.cmd({ op: 'play', key: 'a', url: 'file:///a.wav', gainDb: 0 });
  r.router.cmd({ op: 'decode', url: 'file:///show/a.wav', file: 'a.wav', bytes: new Uint8Array(3) });
  r.router.cmd({ op: 'midi', bytes: [0x90, 60, 100] });
  r.router.cmd({ op: 'peaks', file: 'a.wav', bytes: new Uint8Array(3) });
  r.router.cmd({ op: 'pcm', file: 'a.wav', bytes: new Uint8Array(3) });
  r.router.cmd({ op: 'masterDb', db: -3 });
  assert.deepEqual(r.toNative, [{ op: 'play', key: 'a', gainDb: 0, file: '/a.wav' }, { op: 'decode', file: '/show/a.wav' }, { op: 'masterDb', db: -3 }]);
  assert.deepEqual(r.toWindow.map((c) => c.op), ['midi', 'peaks', 'pcm']);
  assert.ok(r.toWindow.every((c) => c.op === 'midi' || c.bytes), 'the window still gets its bytes');
  // events: the native engine's count; of the window's, only what is still its own
  const before = r.heard.length;
  r.router.fromWindow(level(0));
  r.router.fromWindow({ type: 'devices', list: [{ id: 'x' }] });
  r.router.fromWindow({ type: 'ctx', state: 'running' });
  r.router.fromWindow({ type: 'midi-in', bytes: [0x90, 60, 1], port: 'Keys' });
  r.router.fromWindow({ type: 'peaks', file: 'a.wav', bins: 10, peaks: [0] });
  r.native().onEvent(level(1));
  r.native().onEvent({ type: 'decoded', file: '/show/a.wav', secs: 2 });
  assert.deepEqual(r.heard.slice(before), [{ type: 'midi-in', bytes: [0x90, 60, 1], port: 'Keys' }, { type: 'peaks', file: 'a.wav', bins: 10, peaks: [0] }, level(1), { type: 'decoded', file: 'a.wav', secs: 2 }]);
  // the window dying does not stop the sound
  r.router.windowGone();
  assert.deepEqual(r.down.map((d) => d[0]), ['webaudio']);
  // it exits: what it played is gone, and it is ready again after its restart
  r.native().onExit!('it exited (code 101)');
  assert.deepEqual(r.down.at(-1), ['native', 'it exited (code 101)']);
  r.router.cmd({ op: 'play', key: 'b', url: 'file:///b.wav' });
  assert.equal(r.toNative.length, 3, 'nothing sent while it is down');
  r.native().onEvent({ type: 'ready' });
  r.router.cmd({ op: 'play', key: 'b', url: 'file:///b.wav' });
  assert.equal(r.toNative.length, 4);
});

test('choosing the engine while something plays waits for the next stop-all', () => {
  const r = routed();
  r.router.fromWindow({ type: 'ready' });
  assert.equal(r.router.choose('native', { playing: true }), 'later');
  assert.equal(r.started(), 0);
  assert.deepEqual(r.router.status(), { wanted: 'native', using: 'webaudio', pending: 'native', failed: null });
  r.router.cmd({ op: 'fade', key: 'a', db: -60 });
  assert.equal(r.toWindow.at(-1)!.op, 'fade', 'the window plays on until then');
  r.router.cmd({ op: 'stopAll' });
  assert.equal(r.toWindow.at(-1)!.op, 'stopAll', 'the stop-all goes to the engine that was playing');
  assert.deepEqual(r.router.status(), { wanted: 'native', using: 'native', pending: null, failed: null });
  assert.equal(r.started(), 1);
  r.native().onEvent({ type: 'ready' });
  // and back: the native engine stopped, the window takes over at once, told it is ready
  const heard = r.heard.length;
  assert.equal(r.router.choose('webaudio'), 'now');
  assert.equal(r.stopped(), 1);
  assert.deepEqual(r.heard.slice(heard), [{ type: 'ready' }]);
  r.router.cmd({ op: 'play', key: 'a', url: 'file:///a.wav' });
  assert.equal(r.toWindow.at(-1)!.url, 'file:///a.wav');
  r.native().onEvent(level(1));
  assert.notDeepEqual(r.heard.at(-1), level(1), 'a word from it after it was left is not heard');
  // changing the mind before the stop-all: nothing changes
  r.router.choose('native', { playing: true });
  r.router.choose('webaudio', { playing: true });
  r.router.cmd({ op: 'stopAll' });
  assert.equal(r.started(), 1);
});

test('the native engine given up: Web Audio plays for the sitting, the host is told so and the window is ready at once', () => {
  const r = routed();
  r.router.fromWindow({ type: 'ready' });
  r.router.choose('native');
  r.native().onEvent({ type: 'ready' });
  r.native().onGiveUp('it stopped 3 times in a minute');
  assert.deepEqual(r.fellBack, ['it stopped 3 times in a minute']);
  assert.deepEqual(r.down.at(-1), ['native', 'it stopped 3 times in a minute']);
  assert.deepEqual(r.heard.at(-1), { type: 'ready' }, 'the host sends the window the mixer and the sounds again');
  assert.deepEqual(r.router.status(), { wanted: 'native', using: 'webaudio', pending: null, failed: 'it stopped 3 times in a minute' });
  r.router.cmd({ op: 'play', key: 'a', url: 'file:///a.wav' });
  assert.equal(r.toWindow.at(-1)!.op, 'play');
  assert.equal(r.router.choose('native'), 'failed', 'not tried again this sitting');
  assert.equal(r.started(), 1);
  // no program at all: given up as it is chosen
  const none = routed();
  none.router.fromWindow({ type: 'ready' });
  none.giveUpAtStart('there is no native engine on this computer');
  none.router.choose('native');
  assert.deepEqual([none.fellBack, none.router.status().using, none.heard.map((e) => e.type)], [['there is no native engine on this computer'], 'webaudio', ['ready', 'ready']]);
});

test('lines split anywhere, even inside a character, make the same lines', () => {
  const bytes = Buffer.from('{"type":"ready"}\n{"type":"ended","key":"é—x"}\n');
  for (let cut = 1; cut < bytes.length; cut++) {
    const got: string[] = [];
    const split = lineSplitter((l) => got.push(l));
    split(bytes.subarray(0, cut));
    split(bytes.subarray(cut));
    assert.deepEqual(got.map(parseLine), [{ event: { type: 'ready' } }, { event: { type: 'ended', key: 'é—x' } }], `cut at ${cut}`);
  }
});

// ── the real program, when it has been built (npm run native) ──
const BIN = binaryPath({ packaged: false, root: path.join(__dirname, '..') });
test('the real ec-audio, run --silent: it says ready and lists its devices', { skip: fs.existsSync(BIN) ? false : `no ${path.relative(path.join(__dirname, '..'), BIN)}: build it with npm run native` }, async () => {
  const events: AudioEvent[] = [], logs: string[] = [];
  let gaveUp = '';
  const got = (type: string) => new Promise<void>((resolve, reject) => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      if (events.some((e) => e.type === type)) { clearInterval(tick); resolve(); }
      else if (gaveUp || Date.now() - t0 > 10_000) { clearInterval(tick); reject(new Error(`no ${type}: ${gaveUp || 'timed out'}\n${logs.join('\n')}`)); }
    }, 20);
  });
  const n = createNativeAudio({ binary: BIN, spawn, silent: true, exists: (f) => fs.existsSync(f), log: (l) => logs.push(l), onEvent: (e) => events.push(e), onGiveUp: (w) => { gaveUp = w; } });
  try {
    n.start();
    await got('ready');
    n.send({ op: 'devices' });
    await got('devices');
    const d = events.find((e) => e.type === 'devices') as Extract<AudioEvent, { type: 'devices' }>;
    assert.ok(Array.isArray(d.list), 'a list of outputs');
  } finally { n.stop(); }
});

test('the real ec-audio through the router: a sound probed, decoded and played by its path, its answers under the show’s names', { skip: fs.existsSync(BIN) ? false : `no ${path.relative(path.join(__dirname, '..'), BIN)}: build it with npm run native` }, async () => {
  const os = require('os') as typeof import('os');
  const { writeWav } = require('../examples/make-demo') as typeof import('../examples/make-demo');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-native-'));
  const file = path.join(dir, 'tone.wav');
  writeWav(file, Float32Array.from({ length: 4410 }, (_, i) => 0.2 * Math.sin(i / 10)));        // a tenth of a second
  const heard: AudioEvent[] = [], logs: string[] = [];
  const router = createAudioRouter({
    toWindow: () => {},
    makeNative: (h) => createNativeAudio({ binary: BIN, spawn, silent: true, exists: (f) => fs.existsSync(f), log: (l) => logs.push(l), ...h }),
    onEvent: (e) => heard.push(e), onDown: () => {}, onFellBack: (w) => logs.push(`fell back: ${w}`),
  });
  const got = (ok: (e: AudioEvent) => boolean, what: string) => new Promise<AudioEvent>((resolve, reject) => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      const e = heard.find(ok);
      if (e) { clearInterval(tick); resolve(e); } else if (Date.now() - t0 > 10_000) { clearInterval(tick); reject(new Error(`no ${what}\n${logs.join('\n')}\n${JSON.stringify(heard.filter((x) => x.type !== 'level'))}`)); }
    }, 20);
  });
  try {
    router.choose('native');
    await got((e) => e.type === 'ready', 'ready');
    const url = pathToFileURL(file).href;
    router.cmd({ op: 'probe', files: [{ file: 'media/tone.wav', url }] });
    const d = await got((e) => e.type === 'duration', 'duration') as Extract<AudioEvent, { type: 'duration' }>;
    assert.equal(d.file, 'media/tone.wav');
    assert.ok(Math.abs(d.secs - 0.1) < 0.02, `${d.secs} s`);
    router.cmd({ op: 'decode', url, file: 'media/tone.wav', bytes: new Uint8Array(0) });
    const dec = await got((e) => e.type === 'decoded', 'decoded') as Extract<AudioEvent, { type: 'decoded' }>;
    assert.deepEqual([dec.file, dec.error], ['media/tone.wav', undefined]);
    router.cmd({ op: 'play', key: 'c1', url, gainDb: -6, exact: true });
    await got((e) => e.type === 'ended' && e.key === 'c1', 'ended');
  } finally { router.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the real ec-audio killed mid-play (kill -9): started again and said so; three times in a minute, given up for Web Audio', { skip: fs.existsSync(BIN) ? false : `no ${path.relative(path.join(__dirname, '..'), BIN)}: build it with npm run native` }, async () => {
  const os = require('os') as typeof import('os');
  const { writeWav } = require('../examples/make-demo') as typeof import('../examples/make-demo');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-native-'));
  const file = path.join(dir, 'long.wav');
  writeWav(file, Float32Array.from({ length: 44100 * 5 }, (_, i) => 0.05 * Math.sin(i / 10)));
  const heard: AudioEvent[] = [], logs: string[] = [], downs: string[] = [], fell: string[] = [];
  const pids: number[] = [];
  const spawnSeen: Spawn = (cmd, args, opts) => { const c = spawn(cmd, args, opts); pids.push(c.pid!); return c as unknown as NativeChild; };
  const router = createAudioRouter({
    toWindow: () => {},
    makeNative: (h) => createNativeAudio({ binary: BIN, spawn: spawnSeen, silent: true, exists: (f) => fs.existsSync(f), log: (l) => logs.push(l), restartMs: 50, ...h }),
    onEvent: (e) => heard.push(e), onDown: (_e, why) => downs.push(why), onFellBack: (w) => fell.push(w),
  });
  const got = (ok: (e: AudioEvent) => boolean, what: string, from = 0) => new Promise<AudioEvent>((resolve, reject) => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      const e = heard.slice(from).find(ok);
      if (e) { clearInterval(tick); resolve(e); } else if (Date.now() - t0 > 10_000) { clearInterval(tick); reject(new Error(`no ${what}\n${logs.join('\n')}`)); }
    }, 20);
  });
  const until = (ok: () => boolean, what: string) => new Promise<void>((resolve, reject) => {
    const t0 = Date.now();
    const tick = setInterval(() => { if (ok()) { clearInterval(tick); resolve(); } else if (Date.now() - t0 > 10_000) { clearInterval(tick); reject(new Error(`${what}\n${logs.join('\n')}`)); } }, 20);
  });
  try {
    router.choose('native');
    await got((e) => e.type === 'ready', 'ready');
    downs.length = 0;                                    // (the switch from Web Audio is one too)
    for (let k = 1; k <= 3; k++) {
      const from = heard.length;
      router.cmd({ op: 'play', key: `p${k}`, url: pathToFileURL(file).href });
      await got((e) => e.type === 'level' && (e as Extract<AudioEvent, { type: 'level' }>).voices === 1, `playing ${k}`, from);
      process.kill(pids[pids.length - 1], 'SIGKILL');
      await until(() => downs.length >= k, `the host was told it went (${k})`);
      assert.match(downs[k - 1], /signal SIGKILL/);
      if (k < 3) {
        const at = heard.length;
        await got((e) => e.type === 'ready', `ready again (${k})`, at);
        assert.equal(router.status().using, 'native');
      }
    }
    await until(() => fell.length === 1, 'given up');
    assert.match(fell[0], /3 times in a minute/);
    assert.deepEqual([router.status().using, !!router.status().failed], ['webaudio', true]);
  } finally { router.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
