/**
 * The native audio engine (docs/specs/18-native-audio.md): starting `ec-audio`, talking to it, and falling back.
 *
 * `ec-audio` (native/audio/, Rust) is a second way to make the sound, beside the hidden audio window. It is started
 * as a child process and spoken to in newline-delimited JSON: the window's own commands go in (a file given by its
 * path, never by its bytes or a file:// URL), the window's own events come out, and whatever it prints on standard
 * error is a log line. It is started again when it exits; after three exits in a minute, or with no program to start,
 * the host goes back to Web Audio for the sitting.
 *
 * Two parts, both without Electron so that `node --test` can drive them with a fake `spawn`:
 *
 *   createNativeAudio   the process: start, lines in and out, restart, give up
 *   createAudioRouter   which engine makes the sound, and which commands and events belong to which
 *
 * The host (host.ts) makes one router; the router makes the process when the native engine is chosen.
 */
import * as path from 'path';
import { fileURLToPath } from 'url';
import { StringDecoder } from 'string_decoder';
import type { AudioCommand, AudioEvent } from './host';

/** Which engine makes the sound: the hidden audio window (Web Audio), or `ec-audio`. */
export type AudioEngine = 'webaudio' | 'native';
export const ENGINES: readonly AudioEngine[] = ['webaudio', 'native'];
/** This computer's choice, read from config.json's `audio.engine` (anything else is the default). */
export function engineOf(config: { audio?: { engine?: unknown } } | null | undefined): AudioEngine {
  return config && config.audio && config.audio.engine === 'native' ? 'native' : 'webaudio';
}

// ── which commands and events are whose ─────────────────────────────────

/** What stays with the audio window while the native engine plays: what is not sound (Web MIDI, a USB DMX interface), and reading a
 *  file's peaks and samples for the waveform and the tempo. Every other command goes to the engine that plays. */
export const WINDOW_OPS: ReadonlySet<string> = new Set(['midi', 'peaks', 'pcm', 'dmx', 'dmx-close']);
/** What the audio window says that still counts while the native engine plays: the answers to its own commands, and
 *  a failure it reports. Its devices, its context, its levels and the rest are about a sound it is not making. */
export const WINDOW_EVENTS: ReadonlySet<string> = new Set(['midi-ports', 'midi-in', 'peaks', 'pcm', 'operror', 'dmx-usb']);

/** Where a command goes. */
export function routeOf(op: string, engine: AudioEngine): 'window' | 'native' {
  return engine === 'native' && !WINDOW_OPS.has(op) ? 'native' : 'window';
}

/** Every event the native engine may send (`AudioEvent`'s types), so that a line naming anything else is logged, not
 *  passed on. (A Record, so that a type added to AudioEvent and not here fails the type check.) */
const EVENT_TYPES: Record<AudioEvent['type'], true> = {
  ready: true, duration: true, mode: true, decoded: true, ir: true, missing: true, ended: true, where: true, error: true,
  devices: true, sink: true, outputs: true, outch: true, 'midi-ports': true, 'midi-in': true, 'tc-in': true, ltc: true,
  'ltc-in': true, 'dmx-usb': true, rec: true, recording: true, operror: true, ctx: true, level: true, pcm: true, peaks: true, monitor: true,
};

/** A command as the native engine is given it: the window's, with paths for URLs and no bytes. */
export type NativeCommand = { op: string; [field: string]: unknown };
/** A file:// URL as a path; anything else as it is. */
export function pathOf(url: unknown): string {
  const s = typeof url === 'string' ? url : '';
  if (!s.startsWith('file:')) return s;
  try { return fileURLToPath(s); } catch { return s; }
}

/** The window's command as the native engine takes it (spec, "The protocol"): a file by its path (`file`), never by
 *  its bytes or a file:// URL. `names` remembers which path stands for which of the show's file names, so that the
 *  engine's answers (`decoded`, `duration`, `missing`, `ir`) come back under the name the host asked about.
 *  `resolve` turns one of the show's file names into a path (for `ir`, which the window is given as bytes). */
export function toNative(cmd: AudioCommand, names: Map<string, string>, resolve: (file: string) => string | null = (f) => f): NativeCommand {
  const { bytes: _bytes, ...c } = cmd as AudioCommand & { bytes?: unknown };
  switch (c.op) {
    case 'play': {
      const { url, ...rest } = c;
      return typeof url === 'string' && url ? { ...rest, file: pathOf(url) } : rest;
    }
    case 'decode': {
      const file = pathOf(c.url) || String(c.file || '');
      if (typeof c.file === 'string' && c.file) names.set(file, c.file);
      return { op: 'decode', file };
    }
    case 'keep': return { op: 'keep', files: (Array.isArray(c.urls) ? c.urls : []).map(pathOf) };
    case 'probe': {
      const files = (Array.isArray(c.files) ? c.files : []) as { file?: string; url?: string }[];
      return { op: 'probe', files: files.map((f) => {
        const p = pathOf(f.url) || String(f.file || '');
        if (f.file) names.set(p, f.file);
        return { file: p };
      }) };
    }
    case 'ir': {
      const name = String(c.file || ''), p = resolve(name) || name;
      names.set(p, name);
      return { op: 'ir', file: p };
    }
    default: return c;
  }
}

/** The native engine's event as the host reads it: a file it names by its path is named as the host asked for it. */
export function fromNative(ev: AudioEvent, names: Map<string, string>): AudioEvent {
  if ((ev.type === 'decoded' || ev.type === 'duration' || ev.type === 'missing' || ev.type === 'ir') && names.has(ev.file)) return { ...ev, file: names.get(ev.file)! };
  return ev;
}

/** One line of the engine's standard output as an event, or why it is not one. */
export function parseLine(line: string): { event: AudioEvent } | { bad: string } {
  let v: unknown;
  try { v = JSON.parse(line); } catch { return { bad: `not JSON: ${line.slice(0, 200)}` }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { bad: `not an object: ${line.slice(0, 200)}` };
  const type = (v as { type?: unknown }).type;
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(EVENT_TYPES, type)) return { bad: `not an event: ${line.slice(0, 200)}` };
  return { event: v as AudioEvent };
}

/** Splits a stream into lines as it arrives, a chunk at a time (a line may be split across chunks). */
export function lineSplitter(onLine: (line: string) => void) {
  let rest = '';
  const utf8 = new StringDecoder('utf8');          // (a character split between two chunks is put back together)
  return (chunk: string | Buffer) => {
    rest += typeof chunk === 'string' ? chunk : utf8.write(chunk);
    let i: number;
    while ((i = rest.indexOf('\n')) >= 0) {
      const line = rest.slice(0, i).replace(/\r$/, '');
      rest = rest.slice(i + 1);
      if (line.trim()) onLine(line);
    }
    if (rest.length > 1 << 22) rest = '';          // (four megabytes with no newline: not a line, and not kept)
  };
}

// ── the program ─────────────────────────────────────────────────────────

const EXE = (platform: NodeJS.Platform) => (platform === 'win32' ? 'ec-audio.exe' : 'ec-audio');
/** Where `ec-audio` is: in a packaged app, in its resources (outside the archive); from source, where
 *  `npm run native` builds it. */
export function binaryPath({ packaged, resourcesPath, root, platform = process.platform }: { packaged: boolean; resourcesPath?: string; root: string; platform?: NodeJS.Platform }) {
  return packaged && resourcesPath ? path.join(resourcesPath, EXE(platform)) : path.join(root, 'native', 'target', 'release', EXE(platform));
}

/** What the process manager needs of a child process (a real one from child_process.spawn, or a test's fake). */
export interface NativeChild {
  stdin: { write(chunk: string): boolean; on(event: 'error', fn: (err: Error) => void): unknown; end(): void } | null;
  stdout: { on(event: 'data', fn: (chunk: string | Buffer) => void): unknown } | null;
  stderr: { on(event: 'data', fn: (chunk: string | Buffer) => void): unknown } | null;
  on(event: 'exit', fn: (code: number | null, signal: string | null) => void): unknown;
  on(event: 'error', fn: (err: Error) => void): unknown;
  kill(): boolean;
}
export type Spawn = (command: string, args: string[], options: { stdio: ['pipe', 'pipe', 'pipe']; windowsHide: boolean }) => NativeChild;

export interface NativeAudioOptions {
  /** the program, or null when there is none for this computer */
  binary: string | null;
  spawn: Spawn;
  /** a test run: `--silent`, no device at all */
  silent?: boolean;
  /** with `silent`: the outputs to pretend the device has (`--outs`; the test run's audio window pretends eight) */
  outs?: number;
  exists?: (file: string) => boolean;
  log: (line: string) => void;
  onEvent: (ev: AudioEvent) => void;
  /** it stopped, and will be started again (what it was playing is gone) */
  onExit?: (why: string) => void;
  /** it will not be started again this sitting */
  onGiveUp: (why: string) => void;
  now?: () => number;
  later?: (fn: () => void, ms: number) => unknown;
  /** how long after an exit it is started again */
  restartMs?: number;
}
/** Three exits within this long: given up. */
export const GIVE_UP = { exits: 3, withinMs: 60_000 };

/** `ec-audio`, kept running. */
export function createNativeAudio({ binary, spawn, silent = false, outs = 0, exists, log, onEvent, onExit = () => {}, onGiveUp, now = Date.now, later = setTimeout, restartMs = 500 }: NativeAudioOptions) {
  let child: NativeChild | null = null;
  let stopped = true, gaveUp: string | null = null;
  const exits: number[] = [];

  function giveUp(why: string) {
    if (gaveUp) return;
    gaveUp = why; stopped = true; child = null;
    log(`[native] given up: ${why}`);
    onGiveUp(why);
  }
  function start() {
    if (gaveUp || child) return;
    stopped = false;
    if (!binary || (exists && !exists(binary))) { log(`[native] not found: ${binary || '(no path for this computer)'}`); giveUp('there is no native engine on this computer'); return; }
    let c: NativeChild;
    try { c = spawn(binary, silent ? ['--silent', ...(outs > 0 ? ['--outs', String(outs)] : [])] : [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
    catch (err) { giveUp(`it could not be started: ${(err as Error).message}`); return; }
    child = c;
    let done = false;
    const ended = (why: string, restart: boolean) => {
      if (done) return;
      done = true;
      if (child === c) child = null;
      if (stopped || gaveUp) return;
      if (!restart) { giveUp(why); return; }
      const t = now();
      exits.push(t);
      while (exits.length && t - exits[0] > GIVE_UP.withinMs) exits.shift();
      if (exits.length >= GIVE_UP.exits) { giveUp(`it stopped ${exits.length} times in a minute (last: ${why})`); return; }
      log(`[native] ${why}; starting it again`);
      onExit(why);
      later(() => { if (!stopped && !child) start(); }, restartMs);
    };
    c.on('error', (err: Error & { code?: string }) => {
      // (the program not there, or not allowed to run: no sense in trying again)
      if (err.code === 'ENOENT' || err.code === 'EACCES') ended(`it could not be started: ${err.message}`, false);
      else log(`[native] ${err.message}`);
    });
    c.on('exit', (code, signal) => ended(`it exited (${signal ? `signal ${signal}` : `code ${code}`})`, true));
    if (c.stdin) c.stdin.on('error', (err) => log(`[native] writing to it: ${err.message}`));
    if (c.stdout) c.stdout.on('data', lineSplitter((line) => {
      const r = parseLine(line);
      if ('bad' in r) { log(`[native] ${r.bad}`); return; }
      try { onEvent(r.event); } catch (err) { log(`[native] event ${r.event.type}: ${(err as Error).stack || err}`); }
    }));
    if (c.stderr) c.stderr.on('data', lineSplitter((line) => log(`[native] ${line}`)));
    log(`[native] started ${binary}${silent ? ' --silent' : ''}`);
  }
  /** One command, as one line. False when there is no program to take it. */
  function send(cmd: NativeCommand) {
    if (!child || !child.stdin) return false;
    try { child.stdin.write(`${JSON.stringify(cmd)}\n`); return true; } catch (err) { log(`[native] writing to it: ${(err as Error).message}`); return false; }
  }
  /** Stopped on purpose: not started again. */
  function stop() {
    stopped = true;
    const c = child;
    child = null;
    if (!c) return;
    try { if (c.stdin) c.stdin.end(); } catch { /* already gone */ }
    try { c.kill(); } catch { /* already gone */ }
  }
  return { start, send, stop, running: () => !!child, gaveUp: () => gaveUp };
}
export type NativeAudio = ReturnType<typeof createNativeAudio>;

// ── the router ──────────────────────────────────────────────────────────

export interface AudioRouterOptions {
  /** to the audio window (only called once it has said it is ready) */
  toWindow: (cmd: AudioCommand) => void;
  /** makes the native engine's process with these handlers (createNativeAudio, in the app) */
  makeNative: (handlers: Pick<NativeAudioOptions, 'onEvent' | 'onExit' | 'onGiveUp'>) => Pick<NativeAudio, 'start' | 'send' | 'stop'>;
  /** one of the show's file names as a path */
  resolve?: (file: string) => string | null;
  /** the host's handler: every event of either engine that counts arrives here (a `ready` when the engine that makes
   *  the sound is ready, whichever it is) */
  onEvent: (ev: AudioEvent) => void;
  /** the engine that was making the sound is gone (what it was playing with it), until its next `ready` */
  onDown: (engine: AudioEngine, why: string) => void;
  /** the native engine was given up for this sitting: Web Audio plays */
  onFellBack: (why: string) => void;
  log?: (line: string) => void;
}

/** Which engine makes the sound, and which commands and events go where. */
export function createAudioRouter({ toWindow, makeNative, resolve, onEvent, onDown, onFellBack, log = () => {} }: AudioRouterOptions) {
  let wanted: AudioEngine = 'webaudio', using: AudioEngine = 'webaudio', pending: AudioEngine | null = null;
  let windowReady = false, nativeReady = false, failed: string | null = null;
  let native: Pick<NativeAudio, 'start' | 'send' | 'stop'> | null = null;
  const names = new Map<string, string>();

  function nativeEvent(ev: AudioEvent) {
    if (using !== 'native') return;            // (a word from it after it was switched away from)
    if (ev.type === 'ready') { nativeReady = true; onEvent(ev); return; }
    if (WINDOW_OPS.has(ev.type)) return;        // (peaks and samples are the window's to read)
    onEvent(fromNative(ev, names));
  }
  function startNative() {
    if (!native) native = makeNative({
      onEvent: nativeEvent,
      onExit: (why) => { nativeReady = false; if (using === 'native') onDown('native', why); },
      onGiveUp: (why) => {
        const was = using;
        nativeReady = false; failed = why; native = null;
        if (was !== 'native') return;
        using = 'webaudio';
        onDown('native', why);
        onFellBack(why);
        if (windowReady) onEvent({ type: 'ready' });
      },
    });
    native.start();
  }
  /** Changes over now (nothing is playing). */
  function use(engine: AudioEngine) {
    pending = null;
    if (engine === 'native' && failed) engine = 'webaudio';
    if (engine === using) return;
    const was = using;
    using = engine;
    names.clear();
    onDown(was, `switched to ${engine === 'native' ? 'the native engine' : 'Web Audio'}`);
    if (engine === 'native') { nativeReady = false; startNative(); }
    else {
      if (native) native.stop();
      native = null; nativeReady = false;
      if (windowReady) onEvent({ type: 'ready' });
    }
    log(`[audio] the sound is made by ${using === 'native' ? 'the native engine' : 'Web Audio'}`);
  }
  return {
    /** This computer's choice. Taken at once when nothing is playing; otherwise at the next stop-all. */
    choose(engine: AudioEngine, { playing = false }: { playing?: boolean } = {}): 'now' | 'later' | 'failed' {
      wanted = engine;
      if (engine === 'native' && failed) { pending = null; return 'failed'; }
      if (engine === using) { pending = null; return 'now'; }
      if (playing) { pending = engine; return 'later'; }
      use(engine);
      return 'now';
    },
    /** A command for the sound: to whichever engine it belongs to, once that one is ready. */
    cmd(cmd: AudioCommand) {
      if (routeOf(cmd.op, using) === 'native') { if (nativeReady && native) native.send(toNative(cmd, names, resolve)); }
      else if (windowReady) toWindow(cmd);
      if (cmd.op === 'stopAll' && pending) use(pending);
    },
    /** An event from the audio window. */
    fromWindow(ev: AudioEvent) {
      if (ev.type === 'ready') { windowReady = true; if (using === 'webaudio') onEvent(ev); return; }
      if (using === 'native' && !WINDOW_EVENTS.has(ev.type)) return;       // (its levels, devices and context: not the sound being heard)
      onEvent(ev);
    },
    /** The audio window is gone (a new one is being made). */
    windowGone() { windowReady = false; if (using === 'webaudio') onDown('webaudio', 'the audio window is gone'); },
    /** Whether a command with this op would be carried out now. */
    ready(op = 'play') { return routeOf(op, using) === 'native' ? nativeReady : windowReady; },
    /** What it is doing: the engine chosen, the one making the sound, one waiting for the next stop-all, and why the
     *  native engine was given up (null: it was not). */
    status() { return { wanted, using, pending, failed }; },
    stop() { if (native) native.stop(); native = null; nativeReady = false; },
  };
}
export type AudioRouter = ReturnType<typeof createAudioRouter>;
