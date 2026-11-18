/**
 * The audio window (Web Audio) measured on a real device, for comparison with the native engine
 * (docs/internal/native-qa/; the native side is native/audio/qa/). Not a test of `npm test`: run by hand, with
 * Electron, on a computer with BlackHole (a virtual device whose output comes back on its input).
 *
 *   npx electron test/native-qa/webaudio.js latency --device "BlackHole 2ch" [--clicks 200] [--db -20] [--loopback]
 *       GO-to-output as `ec-audio measure` measures it: from just before the window's `play` to the moment the
 *       click's first sample is output, by the context's own clock (`getOutputTimestamp`, which includes its
 *       `outputLatency`). With --loopback, also as found in BlackHole's input by `ec-audio listen`.
 *   npx electron test/native-qa/webaudio.js scene --device "BlackHole 2ch" --scene DIR/scene.json
 *       The scene `qa parity` wrote, played through the window while `ec-audio listen` records BlackHole's input to
 *       DIR/web.wav (`qa parity` then plays it through the native engine and compares the two).
 *
 * The real audio window (app/audio/audio.html and its preload), not silent; it is never shown and never takes focus.
 * Nothing is played on the speakers unless --device names them (keep --db at −40 then).
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import { app, BrowserWindow, ipcMain } from 'electron';
import type { IpcMainEvent } from 'electron';

const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, 'native', 'target', 'release', 'ec-audio');
const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith('webaudio.js')) + 1);
const arg = (name: string, d = '') => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const mode = args[0];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Ev = { type: string; [k: string]: unknown };
let win: BrowserWindow;
const events: Ev[] = [];
function waitFor(ok: (e: Ev) => boolean, ms = 10000): Promise<Ev> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      const i = events.findIndex(ok);
      if (i >= 0) { clearInterval(tick); resolve(events.splice(i, 1)[0]); } else if (Date.now() - t0 > ms) { clearInterval(tick); reject(new Error(`timed out; seen ${events.map((e) => e.type).join(',')}`)); }
    }, 5);
  });
}
const send = (cmd: Record<string, unknown>) => win.webContents.send('audio-cmd', cmd);
const page = <T>(js: string) => win.webContents.executeJavaScript(js, true) as Promise<T>;

/** The window on the output named `label`. */
async function open(label: string) {
  win = new BrowserWindow({ show: false, width: 200, height: 100, webPreferences: { preload: path.join(ROOT, 'app/audio/preload.js'), backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  ipcMain.on('audio-event', (_e: IpcMainEvent, ev: Ev) => { if (ev.type !== 'level' && ev.type !== 'outch') events.push(ev); });
  await win.loadFile(path.join(ROOT, 'app/audio/audio.html'));
  await waitFor((e) => e.type === 'ready');
  send({ op: 'devices' });
  const d = await waitFor((e) => e.type === 'devices');
  const list = d.list as { id: string; label: string }[];
  const dev = list.find((x) => x.label.includes(label));
  if (!dev) throw new Error(`no output like ${label}: ${list.map((x) => x.label).join(', ')}`);
  send({ op: 'sink', id: dev.id });
  const s = await waitFor((e) => e.type === 'sink');
  if (!s.ok) throw new Error(`could not open ${label}: ${s.detail}`);
  return dev;
}

async function decode(file: string) {
  const url = pathToFileURL(file).href;
  send({ op: 'decode', url, file, bytes: new Uint8Array(fs.readFileSync(file)) });
  const d = await waitFor((e) => e.type === 'decoded' && e.file === file, 30000);
  if (d.error) throw new Error(`${file}: ${d.error}`);
  return url;
}

/** `ec-audio listen` on an input: the clicks it hears (wall-clock ms), and a recording if asked. */
function listen(input: string, db: number, record?: string) {
  const clicks: number[] = [];
  const p = spawn(BIN, ['listen', '--input', input, '--db', String(db), ...(record ? ['--record', record] : [])], { stdio: ['pipe', 'pipe', 'inherit'] });
  let rest = '';
  let ready: () => void;
  const listening = new Promise<void>((r) => { ready = r; });
  p.stdout.on('data', (b: Buffer) => {
    rest += b.toString();
    let i;
    while ((i = rest.indexOf('\n')) >= 0) {
      const line = rest.slice(0, i); rest = rest.slice(i + 1);
      try { const v = JSON.parse(line); if (v.click) clicks.push(v.click); if (v.listening) ready(); } catch { /* not a line of its */ }
    }
  });
  const done = new Promise<void>((r) => p.on('exit', () => r()));
  return { clicks, listening, stop: async () => { p.stdin.end(); await done; } };
}

function stats(v: number[]) {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), n = s.length, mean = s.reduce((a, b) => a + b, 0) / n;
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { n, mean: r(mean), p50: r(s[Math.floor(n * 0.5)]), p95: r(s[Math.min(n - 1, Math.floor(n * 0.95))]), max: r(s[n - 1]), min: r(s[0]), jitter: r(Math.sqrt(s.reduce((a, x) => a + (x - mean) ** 2, 0) / n)) };
}

/** A click as `ec-audio measure` makes it: 2 ms of 2 kHz under a Hann window, its first sample half its peak. */
function clickFile(dir: string, db: number) {
  const sr = 48000, n = 96, a = 10 ** (db / 20);
  const data = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); data[2 * i] = data[2 * i + 1] = a * w * Math.sin((2 * Math.PI * 2000 * i) / sr); }
  data[0] = data[1] = a * 0.5;
  const file = path.join(dir, `click${db}.wav`);
  const b = Buffer.alloc(44 + data.length * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 8, 28); b.writeUInt16LE(8, 32); b.writeUInt16LE(32, 34); b.write('data', 36); b.writeUInt32LE(data.length * 4, 40);
  Buffer.from(data.buffer).copy(b, 44);
  fs.writeFileSync(file, b);
  return file;
}

async function latency() {
  const label = arg('--device', 'BlackHole 2ch');
  const clicks = Number(arg('--clicks', '200'));
  const db = Math.min(-6, Number(arg('--db', '-20')));
  const loop = args.includes('--loopback');
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'ec-webaudio-'));
  await open(label);
  const url = await decode(clickFile(dir, db));
  const ear = loop ? listen(label, db) : null;
  if (ear) await ear.listening;
  const th = 10 ** (db / 20) * 0.2;
  // a tap after the limiter, where the window's output is: the frame of the first sample over the threshold
  await page(`(async () => {
    const W = "registerProcessor('ec-tap', class extends AudioWorkletProcessor { constructor() { super(); this.armed = false; this.port.onmessage = () => { this.armed = true; }; } process(inputs) { const x = inputs[0] && inputs[0][0]; if (this.armed && x) { for (let i = 0; i < x.length; i++) { if (Math.abs(x[i]) > ${th}) { this.port.postMessage(currentFrame + i); this.armed = false; break; } } } return true; } });";
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([W], { type: 'application/javascript' })));
    const tap = new AudioWorkletNode(ctx, 'ec-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
    const mute = ctx.createGain(); mute.gain.value = 0;
    limiter.connect(tap); tap.connect(mute).connect(ctx.destination);
    window.__tap = tap;
    window.__one = (key) => new Promise((resolve) => {
      tap.port.onmessage = (e) => {
        const ts = ctx.getOutputTimestamp();
        resolve({ t0, wall0, frame: e.data, out: ts.performanceTime + (e.data / ctx.sampleRate - ts.contextTime) * 1000, outputLatency: ctx.outputLatency, baseLatency: ctx.baseLatency });
      };
      tap.port.postMessage('arm');
      let t0 = 0, wall0 = 0;
      setTimeout(() => { t0 = performance.now(); wall0 = performance.timeOrigin + t0; play({ key, url: ${JSON.stringify(url)}, exact: true, bus: 'effects' }); }, 15);
    });
  })()`);
  const go: number[] = [], dev: number[] = [], round: number[] = [];
  let seed = 0x9e3779b9;
  for (let i = 0; i < clicks; i++) {
    seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0;
    await sleep(60 + (seed % 100));
    const r = await page<{ t0: number; wall0: number; out: number; outputLatency: number; baseLatency: number }>(`window.__one('c${i}')`);
    go.push(r.out - r.t0);
    dev.push((r.outputLatency + r.baseLatency) * 1000);
    if (ear) {
      await sleep(40);
      const c = ear.clicks.find((x) => x > r.wall0);
      if (c != null) { round.push(c - r.wall0); ear.clicks.splice(0, ear.clicks.indexOf(c) + 1); }
    }
  }
  if (ear) await ear.stop();
  const sr = await page<number>('ctx.sampleRate');
  return { engine: 'webaudio', device: label, rate: sr, clicks, db, go_to_output_ms: stats(go), output_plus_base_latency_ms: stats(dev), loopback_ms: ear ? stats(round) : null, loopback_found: round.length };
}

/** The scene `qa parity` wrote: [{ ms, cmd }], played on time; the window's commands (file:// URLs, bytes to decode). */
async function scene() {
  const label = arg('--device', 'BlackHole 2ch');
  const file = arg('--scene');
  const sc = JSON.parse(fs.readFileSync(file, 'utf8')) as { files: string[]; steps: { ms: number; cmd: Record<string, unknown> }[] };
  await open(label);
  const urls: Record<string, string> = {};
  for (const f of sc.files) urls[f] = await decode(f);
  const ear = listen(label, -20, path.join(path.dirname(file), 'web.wav'));
  await ear.listening;
  await sleep(500);
  const t0 = Date.now();
  for (const s of sc.steps) {
    const wait = t0 + s.ms - Date.now();
    if (wait > 0) await sleep(wait);
    const c = { ...s.cmd } as Record<string, unknown>;
    if (typeof c.file === 'string') { c.url = urls[c.file] || pathToFileURL(c.file).href; delete c.file; }
    send(c);
  }
  await sleep(800);
  await ear.stop();
  return { engine: 'webaudio', device: label, steps: sc.steps.length, recorded: path.join(path.dirname(file), 'web.wav') };
}

app.whenReady().then(async () => {
  let out: unknown;
  try { out = mode === 'latency' ? await latency() : mode === 'scene' ? await scene() : { error: 'latency | scene' }; }
  catch (err) { out = { error: String((err as Error).stack || err) }; }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  app.exit(0);
});
app.on('window-all-closed', () => {});
