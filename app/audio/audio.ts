// The audio window's code (audio.html says what it does): a plain script, as the page's tests reach into it.
// Timecode, Chain and Lanes are core/'s, put on the page by audio-lib.bundle.js (app/audio/lib.ts).
declare const Timecode: typeof import('../../core/timecode/timecode');
declare const Chain: typeof import('../../core/audio/chain');
declare const Lanes: typeof import('../../core/audio/lanes');
// What the host sends (a command, by its op) and what this window says: app/audio/preload.ts.
type Cmd<K extends import('./preload').AudioOp> = import('./preload').AudioCommands[K];
type Own = import('./preload').Own;
type BuiltChain = import('../../core/audio/chain').BuiltChain;
type LanePoint = import('../../core/show/types').LanePoint;
type Timer = ReturnType<typeof setTimeout>;
// (Chromium's, not yet in the DOM types: the output device a context plays to)
declare global { interface AudioContext { readonly sinkId: string | { type: 'none' }; setSinkId(id: string): Promise<void> } }
/** A place in a file a loop is held between, in seconds. */
type Span = { start: number; end: number };
/** A pair of the device's outputs: where a bus plays in (`inp`, metered by `tap`), its master and limiter, and its split
 *  into the two outputs (none for 1–2, whose limiter is the window's own). `mono`: the pair's outputs one at a time. */
interface Pair { inp: GainNode; tap: AnalyserNode; master: GainNode; limiter: DynamicsCompressorNode; split: ChannelSplitterNode | null; mono?: ChannelMergerNode; chTaps?: AnalyserNode[] }
/** A bus's channel strip as it is set: the eq's three bands, the filter, the pan and the gate. */
interface StripNow { low: number; mid: number; high: number; filter: { type: 'lowpass' | 'highpass'; hz: number } | null; pan: number; gate: number }
/** A bus's level as a signal (`ride`). */
interface BusCtl { fader: GainNode; gate: GainNode; duck: GainNode; dip: ConstantSourceNode; tap: AnalyserNode }
/** A bus of the mixer: its fader, its strip, its ducker's dip, and where it plays (`to`, the pair `want`). */
interface Bus {
  to: AudioNode | null; want: number; out: number; fader: GainNode; low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode; filt: BiquadFilterNode;
  pan: StereoPannerNode; gate: GainNode; duck: GainNode; band: BiquadFilterNode; tap: AnalyserNode; strip: StripNow; wired: string; unwire: Timer | null;
  ctl: BusCtl; idle: ConstantSourceNode; sends?: Record<string, GainNode>;
}
/** A buffer voice's clock: at ctx time `t` it was `p` s into its file, at rate `r0`, on its way to `r1` over `d` s. */
interface Clock { t: number; p: number; r0: number; r1: number; d: number }
/** A buffer source's own stage: its gain and the bass shelf. */
interface Sub { gain: GainNode; bass: BiquadFilterNode }
interface PanStage { inp: GainNode; sp: ChannelSplitterNode; l: GainNode; r: GainNode; out: ChannelMergerNode }
/** A move under way: the place it is leaving (`old`), and the source, stage and moment it lands with. */
interface Move {
  old: { node: AudioBufferSourceNode | null | undefined; sub: Sub | null | undefined; clk: Clock; region: Span | null | undefined; loopWhole: boolean | undefined; released: boolean | undefined; onended: AudioScheduledSourceNode['onended'] | undefined };
  n: AudioBufferSourceNode; sub: Sub; when: number; timer?: Timer;
}
/**
 * A sound playing: a decoded buffer (`buf`, its `clk`), a stream (`el`, its element) or a live input (`mic`), and the
 * stages of its way out. Each kind has the fields of its kind; the rest are there only once something has made them.
 */
interface Voice {
  gain: GainNode; band: BiquadFilterNode; db: number;
  mic?: boolean; stream?: MediaStream | null; feed?: { node: AudioNode; out?: number }; split?: ChannelSplitterNode;
  src: (AudioNode & { stop?: () => void }) | null;
  el: HTMLAudioElement; dip?: GainNode; url: string; wantExact?: boolean; keepPitch?: boolean; rateRamp?: { from: number; to: number; t: number; d: number } | null;
  buf?: AudioBuffer | null; clk: Clock; srcNode?: AudioBufferSourceNode | null; sub?: Sub | null; moving?: Move | null; region?: Span | null; loopWhole?: boolean;
  released?: boolean; rate0?: number; pausedAt?: number; speech?: [number, number][];
  fx?: BuiltChain | null; swept: string; cutIn?: boolean; tailOf?: string;
  lanes: { env: LanePoint[] | null; pan: LanePoint[] | null; chain: Record<string, LanePoint[]> | null }; panBase: number; rode: Record<string, number | null>;
  env?: GainNode | null; pan?: PanStage | null; noPan?: boolean; under?: GainNode; pre?: AudioNode; patched?: boolean;
  own?: { pairs: number[]; undo: (() => void)[] }; onBus?: string; tap?: AnalyserNode;
}
/** An effect's nodes (a reverb or a delay): fed at `inp`, back at `ret` onto its pair. */
/** A test signal for `measure`. */
type Signal = { kind: 'sine'; hz: number; db: number; right?: boolean } | { kind: 'impulse'; hz?: undefined; db?: undefined; right?: boolean }
  | { kind: 'step'; hz: number; db: number; to: number; at: number; right?: boolean } | { kind: 'burst'; hz: number; db: number; until: number; right?: boolean };
interface FxNode { inp: GainNode; ret: GainNode; to: AudioNode | null; pair: number | null; delay?: DelayNode; back?: GainNode; conv?: ConvolverNode; secs?: number }

// A test run (`?silent`) opens no audio device at all: everything still runs, on a context with no output,
// so it cannot touch an interface that is busy doing a show.
const SILENT = new URLSearchParams(location.search).has('silent');
// (a test may pretend the device has more outputs than two, to route to them and read their meters)
const FAKE_OUTS = Number(new URLSearchParams(location.search).get('outs')) || 0;
const ctx = new AudioContext({ latencyHint: 'interactive', ...(SILENT ? { sinkId: { type: 'none' } } : {}) });
const master = ctx.createGain();
// A safety limiter at the very end: the master can be pushed up to +20 dB in a
// quiet room without ever clipping the output to the PA. It does nothing below
// -0.3 dBFS. Not -1: mastered music commonly peaks at -0.01 dBFS, and at -1 the limiter
// audibly squashed every transient of a track playing at its own level (measured).
const limiter = ctx.createDynamicsCompressor();
limiter.threshold.value = -0.3;
limiter.knee.value = 0;
limiter.ratio.value = 20;
limiter.attack.value = 0.002;
limiter.release.value = 0.15;
const meter = ctx.createAnalyser();
meter.fftSize = 1024;
master.connect(limiter).connect(meter).connect(ctx.destination);
// The output pairs: [0] is outputs 1–2 (the master and limiter above); the others are made when a bus is sent to them.
// A bus plays into a pair's `inp`, where the pair's meter is (before the master, so a muted test run still reads it).
const maxOuts = () => FAKE_OUTS || ctx.destination.maxChannelCount;
const pairs: Pair[] = [];
function outPair(k: number) {
  if (pairs[k]) return pairs[k];
  const inp = ctx.createGain();
  const tap = ctx.createAnalyser(); tap.fftSize = 1024;
  inp.connect(tap);
  if (k === 0) { inp.connect(master); return (pairs[0] = { inp, tap, master, limiter, split: null }); }
  const m = ctx.createGain(); m.gain.value = master.gain.value;
  const lim = ctx.createDynamicsCompressor();
  for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release'] as const) lim[key].value = limiter[key].value;
  const sp = ctx.createChannelSplitter(2);
  inp.connect(m).connect(lim).connect(sp);
  return (pairs[k] = { inp, tap, master: m, limiter: lim, split: sp });
}
// One output of the device as a place to send one channel: the left or right of its pair, before the pair's master
// and limiter. An output is there when its whole pair is (as a bus's is).
const ownPairs = new Set<number>();        // the pairs something other than a bus plays into (a sound's own outputs, audition, an effect's return)
const hasOut = (o: number) => o < 2 || (o >> 1) * 2 + 2 <= maxOuts();          // o: 0 is output 1
function outIn(o: number) {
  const p = outPair(o >> 1);
  if (!p.mono) { p.mono = ctx.createChannelMerger(2); p.mono.connect(p.inp); }
  return p.mono;
}
/** A pair now in use by something that is not a bus: laid into the device's outputs if it was not. */
function usePair(k: number) { if (ownPairs.has(k)) return; ownPairs.add(k); try { route(); } catch (err) { window.cueAudio.report({ type: 'operror', op: 'route', key: '', detail: String(err) }); } }
// A dip in the band speech lives in: one wide peaking cut centred at 1.2 kHz (Q 0.6,
// roughly 400 Hz–3.5 kHz), flat at 0 dB. A duck in the voice range moves its gain
// instead of the level, so the music keeps its bass and its air under the words.
const VOICE_HZ = 1200, VOICE_Q = 0.6;
function voiceBand() {
  const f = ctx.createBiquadFilter();
  f.type = 'peaking'; f.frequency.value = VOICE_HZ; f.Q.value = VOICE_Q; f.gain.value = 0;
  return f;
}
// A DJ's bass swap: a low shelf under 180 Hz, flat (0 dB, exactly no change) until a dj blend
// takes the bass out of one voice and gives it to the other on the downbeat.
const BASS_HZ = 180, BASS_OUT_DB = -40, BASS_SWAP_S = 0.03;
function bassShelf() {
  const f = ctx.createBiquadFilter();
  f.type = 'lowshelf'; f.frequency.value = BASS_HZ; f.gain.value = 0;
  return f;
}
// The mixer's buses: a fader each (`bus`), and on the music the ducker's dip after it
// (`duck`, the whole mix, or `band`, the voice range), so a fader ride and a duck never
// fight over one gain.
const buses: Record<string, Bus> = {};
function ensureBus(name: string) {
  if (buses[name]) return buses[name];
  const fader = ctx.createGain();
  const duck = ctx.createGain();
  const band = voiceBand();
  const tap = ctx.createAnalyser(); tap.fftSize = 1024;
  // The channel strip (the Live view): a three-band eq, one filter that is a low-pass or a high-pass, a pan,
  // and a gate (mute, solo and the crossfader as one gain). The eq and the filter are in the path only while
  // they are doing something (`wire`), so a bus at rest is the plain wire it always was.
  const biquad = (type: BiquadFilterType, hz: number, q?: number) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; if (q) f.Q.value = q; f.gain.value = 0; return f; };
  const low = biquad('lowshelf', 250), mid = biquad('peaking', 1000, 0.8), high = biquad('highshelf', 4000);
  const filt = biquad('lowpass', 20000, 0.9);
  // stereo in, always: a mono sound would otherwise lose 3 dB the moment it met the panner
  const pan = ctx.createStereoPanner(); pan.channelCountMode = 'explicit'; pan.channelCount = 2;
  const gate = ctx.createGain();
  duck.connect(band).connect(outPair(0).inp);
  band.connect(tap);
  // (its `ctl` and `idle` are made just below)
  const b = buses[name] = { to: outPair(0).inp, want: 0, out: 1, fader, low, mid, high, filt, pan, gate, duck, band, tap, strip: { low: 0, mid: 0, high: 0, filter: null, pan: 0, gate: 1 }, wired: '', unwire: null } as Omit<Bus, 'ctl' | 'idle'> as Bus;
  ride(b);
  wire(b);
  // A bus is never without an input. MEASURED (Chromium): a node with nothing playing into it stops its automation
  // where it was, so a strip moved while its bus was silent (a mute, the crossfader, a Mix cue's desk) had not
  // arrived when the next sound started, which began at the old gate and glided; and its gains read stale. A
  // steady nothing into the fader keeps the whole path running.
  b.idle = ctx.createConstantSource();
  b.idle.offset.value = 0;
  b.idle.connect(fader);
  b.idle.start();
  return b;
}
/** A bus's level as a signal, beside its sound: a steady 1 through a copy of its fader, its gate and its duck
 *  (`ctl`), and its voice-band dip in dB (`dip`). Every move of the real ones is made on these too. A sound with
 *  outputs of its own is ridden by them (`patch`), which is how a bus's fader, mute, solo and ducking still mean
 *  something for a sound that does not pass through the bus. The two small analysers only keep them running. */
function ride(b: Bus) {
  const one = ctx.createConstantSource(), dip = ctx.createConstantSource();
  dip.offset.value = 0;
  const fader = ctx.createGain(), gate = ctx.createGain(), duck = ctx.createGain();
  const tap = ctx.createAnalyser(), dipTap = ctx.createAnalyser();
  tap.fftSize = dipTap.fftSize = 32;
  one.connect(fader).connect(gate).connect(duck).connect(tap);
  dip.connect(dipTap);
  one.start(); dip.start();
  b.ctl = { fader, gate, duck, dip, tap };
}
/** A bus's path from its fader to its ducker, with the eq and the filter in it only while they are in use. */
function wire(b: Bus) {
  const s = b.strip;
  const eq = s.low !== 0 || s.mid !== 0 || s.high !== 0, filter = !!s.filter;
  const key = `${eq}:${filter}`;
  if (key === b.wired) return;
  const path = [b.fader, ...(eq ? [b.low, b.mid, b.high] : []), ...(filter ? [b.filt] : []), b.pan, b.gate, b.duck];
  for (const n of [b.fader, b.low, b.mid, b.high, b.filt, b.pan, b.gate]) n.disconnect();
  for (let i = 0; i < path.length - 1; i++) path[i].connect(path[i + 1]);
  b.wired = key;
}
/** The Live view's strips: [{ name, low, mid, high, filter: { type, hz } | null, pan, gate }]. Every move is a short glide,
 *  or a long one when a Mix cue recalls a desk over a time. */
function setStrips({ list, secs }: Cmd<'strips'>) {
  // (`secs`: a Mix cue recalling a desk over a time; as a fader's ramp, a time constant of a third of it arrives by then)
  const now = ctx.currentTime, glide = secs! > 0 ? secs! / 3 : 0.02;
  for (const s of list || []) {
    const b = ensureBus(s.name);
    const was = b.strip;
    const next: StripNow = { low: Number(s.low) || 0, mid: Number(s.mid) || 0, high: Number(s.high) || 0, filter: s.filter || null, pan: Number(s.pan) || 0, gate: s.gate == null ? 1 : Number(s.gate) };
    clearTimeout(b.unwire!);
    // into the path first, at rest (where it changes nothing), then moved; out of it only once it has come to rest
    const using: StripNow = { ...next, low: next.low || was.low, mid: next.mid || was.mid, high: next.high || was.high, filter: next.filter || was.filter };
    b.strip = using; wire(b);
    for (const k of ['low', 'mid', 'high'] as const) b[k].gain.setTargetAtTime(next[k], now, glide);
    if (next.filter) {
      if (!was.filter || was.filter.type !== next.filter.type) { b.filt.type = next.filter.type; b.filt.frequency.cancelScheduledValues(now); b.filt.frequency.setValueAtTime(next.filter.type === 'lowpass' ? 20000 : 20, now); }
      b.filt.frequency.setTargetAtTime(next.filter.hz, now, glide);
    } else if (was.filter) b.filt.frequency.setTargetAtTime(was.filter.type === 'lowpass' ? 20000 : 20, now, glide);
    b.pan.pan.setTargetAtTime(next.pan, now, glide);
    b.gate.gain.setTargetAtTime(next.gate, now, glide);
    b.ctl.gate.gain.setTargetAtTime(next.gate, now, glide);
    b.unwire = setTimeout(() => { b.strip = next; wire(b); }, 200 + (secs! > 0 ? secs! * 1500 : 0));
  }
}
const busIn = (name: string | undefined) => ensureBus(name || 'effects').fader;
/** The show's buses (Settings ▸ Audio): made if new, levelled; ones no longer in the show go when nothing plays into them. */
function setBuses({ list }: Cmd<'buses'>) {
  for (const b of list || []) { ensureBus(b.id); ramp(buses[b.id].fader.gain, Number(b.db) || 0, 0.02); ramp(buses[b.id].ctl.fader.gain, Number(b.db) || 0, 0.02); routeBus(buses[b.id], b.out); setSends(buses[b.id], b); }
  route();
}
/** A bus to its pair of outputs (`out`: the first of the pair, 1, 3, 5…). Outputs the device does not have: nowhere. */
function routeBus(b: Bus, out: unknown) {
  b.out = Number(out) > 1 ? Number(out) : 1;
  b.want = Math.floor((b.out - 1) / 2);
  const to = b.want === 0 || b.want * 2 + 2 <= maxOuts() ? outPair(b.want).inp : null;
  if (to === b.to) return;
  if (b.to) { try { b.band.disconnect(b.to); } catch { /* not connected */ } }
  if (to) b.band.connect(to);
  b.to = to;
}
// The level meter's two channels, tapped after the limiter (what the PA gets).
const split = ctx.createChannelSplitter(2);
limiter.connect(split);
const chMeters = [0, 1].map((i) => { const a = ctx.createAnalyser(); a.fftSize = 2048; split.connect(a, i); return a; });
// The monitor: a mono copy of what the PA gets, on one more output of the interface,
// at its own level. Off, the sound takes the plain stereo path and nothing here is in it.
const monitor: { on: boolean; out: number; db: number; mono: GainNode | null; tap: AnalyserNode | null } = { on: false, out: 2, db: -12, mono: null, tap: null };      // `out`: which output, counted from 0
/** The last stage: the pairs in use (and the monitor) laid into the device's outputs. All on 1–2 and no monitor:
 *  the plain stereo path, with nothing of this in it. */
let outMerger: ChannelMergerNode | null = null, outKey = '';
// An output's trim (Settings ▸ Audio): `trims` is { output number: dB below 0 }, and `laid` the gain each trimmed
// output passes through on its way into the device (output index -> { from, gain }). After the limiter, and only
// ever down, so the limiter's ceiling still holds. An output with no trim has nothing in its way.
const trims: Record<string, number> = {}, laid = new Map<number | string, { from: AudioNode; gain: GainNode; o: number }>();
function lay(node: AudioNode, ch: number, o: number, as: number | string = o) {
  if (!(trims[o + 1] < 0)) { node.connect(outMerger!, ch, o); return; }
  const gain = ctx.createGain();
  gain.channelCount = 1; gain.channelCountMode = 'explicit';
  gain.gain.value = toLin(trims[o + 1]);
  node.connect(gain, ch);
  gain.connect(outMerger!, 0, o);
  laid.set(as, { from: node, gain, o });       // (`as`: its own key, for what shares an output with a bus's pair: an LTC stream)
}
function route() {
  const dest = ctx.destination, max = maxOuts();
  const used = [...new Set([...Object.values(buses).map((b) => b.want), ...ownPairs])].filter((k) => k > 0 && k * 2 + 2 <= max).sort();
  const mon = monitor.on && max > monitor.out;
  // LTC: each stream on the output it was given (counted from 0 here), if the device has it
  const tcOuts = [...ltcOut.values()].filter((l) => l.channel < max);
  const n = Math.max(2, ...used.map((k) => k * 2 + 2), mon ? monitor.out + 1 : 0, ...tcOuts.map((l) => l.channel + 1));
  const cut = Object.keys(trims).map(Number).filter((o) => o <= n && trims[o] < 0).sort((a, b) => a - b);
  const key = `${n}:${used.join(',')}:${mon ? monitor.out : ''}:${cut.join(',')}:${tcOuts.map((l) => `${l.id}@${l.channel}`).join(',')}`;
  if (key !== outKey) {
    outKey = key;
    try { meter.disconnect(); } catch { /* not connected */ }
    if (outMerger) {
      for (const t of laid.values()) { try { t.from.disconnect(t.gain); t.gain.disconnect(); } catch { /* gone */ } }
      laid.clear();
      for (const node of [split, monitor.mono, ...pairs.filter((p, k) => p && k > 0).map((p) => p.split), ...[...ltcOut.values(), ...ltcGone.splice(0)].map((l) => l.gain)]) { try { if (node) node.disconnect(outMerger); } catch { /* not connected */ } }
      try { outMerger.disconnect(); } catch { /* gone */ }
      outMerger = null;
    }
    if (n === 2 && !mon && !cut.length && !tcOuts.length) {
      try { dest.channelCount = 2; dest.channelCountMode = 'explicit'; dest.channelInterpretation = 'speakers'; } catch { /* a device with one output */ }
      meter.connect(dest);
    } else {
      outMerger = ctx.createChannelMerger(n);
      lay(split, 0, 0);
      lay(split, 1, 1);
      for (const k of used) { const p = outPair(k); lay(p.split!, 0, 2 * k); lay(p.split!, 1, 2 * k + 1); }
      if (mon) {
        if (!monitor.mono) {
          monitor.mono = ctx.createGain();
          monitor.mono.channelCount = 1;
          monitor.mono.channelCountMode = 'explicit';
          monitor.mono.channelInterpretation = 'speakers';   // stereo to mono: half of each
          limiter.connect(monitor.mono);
          monitor.tap = ctx.createAnalyser(); monitor.tap.fftSize = 1024;      // what the monitor gets, for its meter
          monitor.mono.connect(monitor.tap);
        }
        lay(monitor.mono, 0, monitor.out, 'monitor');          // (through its output's trim, as everything on that output is)
      }
      for (const l of tcOuts) lay(l.gain, 0, l.channel, `ltc${l.id}`);          // (an output's trim holds for the timecode on it too)
      try { dest.channelCount = Math.max(1, Math.min(n, dest.maxChannelCount)); dest.channelCountMode = 'explicit'; dest.channelInterpretation = 'discrete'; } catch { /* the device has fewer */ }
      outMerger.connect(dest);
    }
  }
  for (const t of laid.values()) t.gain.gain.setTargetAtTime(toLin(trims[t.o + 1]), ctx.currentTime, 0.02);
  if (mon) monitor.mono!.gain.setTargetAtTime(toLin(monitor.db), ctx.currentTime, 0.02);
  window.cueAudio.report({ type: 'monitor', on: mon, wanted: monitor.on, out: monitor.out, channels: max });
  window.cueAudio.report({ type: 'outputs', channels: max });
}
function setMonitor({ on, out, db }: Cmd<'monitor'>) {
  monitor.on = !!on;
  if (Number.isInteger(out)) monitor.out = out!;
  if (Number.isFinite(db)) monitor.db = db!;
  try { route(); } catch (err) { window.cueAudio.report({ type: 'monitor', on: false, channels: 0, detail: String(err) }); }
}
/** The outputs' settings (Settings ▸ Audio): each one's trim, and the outputs the show's cues, its audition and its
 *  effects send to (`use`), so their pairs are in place before the first GO and nothing is rewired under a show. */
function setOutputs({ trims: t, use }: Cmd<'outputs'>) {
  for (const k of Object.keys(trims)) delete trims[k];
  for (const [k, db] of Object.entries(t || {})) if (Number(db) < 0) trims[Number(k)] = Math.max(-60, Number(db));
  ownPairs.clear();
  for (const o of use || []) if (hasOut(o - 1)) { outPair((o - 1) >> 1); ownPairs.add((o - 1) >> 1); }
  for (const v of voices.values()) for (const k of (v.own && v.own.pairs) || []) ownPairs.add(k);     // (what is sounding stays where it is)
  for (const f of Object.values(fx.nodes)) if (f.pair != null) ownPairs.add(f.pair);
  route();
}

/**
 * A voice's way out, from its level on: its eq when it has one, its voice band, and then its bus, unless it has
 * outputs of its own (`own`, on its `play`):
 *
 *   own.eq, own.chain   its eq and its sound design: before its level, and not this function's (`design`)
 *   own.audition   the first of a pair: the sound goes straight into that pair and nowhere else (V, to headphones)
 *   own.outputs    [{ output: dB }, …], a row per channel of the sound: each channel into the outputs its row names
 *
 * A sound on outputs of its own is still ridden by its bus (`ride`): the bus's level multiplies it and the bus's
 * voice-band dip is repeated on it, and the bus's meter (and so the ducker's key) hears it. The bus's eq, filter
 * and pan do not reach it: they shape the bus's pair. An output the device does not have gets nothing.
 */
function patch(v: Voice, bus: string | undefined, own: Own | undefined) {
  const o: Own = own || {};
  // (a sound on outputs of its own is not panned: its matrix says where each channel goes)
  if (Array.isArray(o.outputs) && o.outputs.length && v.pan) { dropPan(v); v.noPan = true; }
  v.patched = true;
  relink(v);                                // its level, then its envelope and its pan if it has them, into its voice band
  // (its eq is not here: it is one of the stages of its sound design, before its level: `design`)
  if (o.audition) {
    const k = (Number(o.audition) - 1) >> 1;
    // as two channels, whatever the sound has: one channel alone would come out of the left ear only
    const two = ctx.createGain();
    two.channelCount = 2; two.channelCountMode = 'explicit';
    v.own = { pairs: [], undo: [() => two.disconnect()] };
    if (hasOut(k * 2)) { v.band.connect(two).connect(outPair(k).inp); v.own.pairs.push(k); usePair(k); }
    return;
  }
  const rows = Array.isArray(o.outputs) ? o.outputs : [];
  v.onBus = bus || 'effects';               // (the ducker asks which sounds are on a bus)
  if (!rows.length) { v.band.connect(busIn(bus)); return; }
  const b = ensureBus(bus || 'effects');
  const dip = voiceBand(), send = ctx.createGain(), sp = ctx.createChannelSplitter(rows.length);
  send.gain.value = 0;                      // its gain is the bus's level, as a signal
  b.ctl.duck.connect(send.gain);
  b.ctl.dip.connect(dip.gain);
  v.band.connect(dip).connect(send);
  send.connect(b.tap);
  send.connect(sp);
  const nodes: AudioNode[] = [dip, send, sp], pairs = new Set<number>();
  rows.forEach((row, r) => {
    for (const [out, db] of Object.entries(row || {})) {
      const at = Number(out) - 1;
      if (!(at >= 0) || !hasOut(at) || !(Number(db) > -60)) continue;
      const x = ctx.createGain();
      x.channelCount = 1; x.channelCountMode = 'explicit';
      x.gain.value = toLin(Number(db));
      sp.connect(x, r);
      x.connect(outIn(at), 0, at % 2);
      nodes.push(x); pairs.add(at >> 1);
    }
  });
  v.own = { pairs: [...pairs], undo: [() => b.ctl.duck.disconnect(send.gain), () => b.ctl.dip.disconnect(dip.gain), ...nodes.map((n) => () => n.disconnect())] };
  for (const k of pairs) usePair(k);
}
function unpatch(v: Voice) {
  for (const f of (v.own && v.own.undo) || []) { try { f(); } catch { /* gone */ } }
  if (v.fx) { v.fx.dispose(); v.fx = null; }
}

// ── Sound design: a voice's own chain of tools (core/audio/chain.ts builds it) ──
// The worklets (the gate, the compressor, the crusher, the pitch shifter) are added to the context once, as the
// window starts; a sound that asks for one before they have loaded plays without it and says so.
const fxEnv = { worklets: false, ir: (file: string) => irs.get(file) || null };
const irs = new Map<string, AudioBuffer>();             // an impulse-response file (as the show names it) -> its AudioBuffer
const workletUrl = URL.createObjectURL(new Blob([Chain.WORKLETS], { type: 'application/javascript' }));
const fxReady = ctx.audioWorklet.addModule(workletUrl).then(() => { fxEnv.worklets = true; }, (err) => window.cueAudio.report({ type: 'operror', op: 'design', key: '', detail: `the sound design worklets did not load: ${err}` }));
/** Where a voice's sources play into: its chain when it has one, else its level. */
const headOf = (v: Voice) => (v.fx ? v.fx.input : v.gain);
/** A voice's sound design, built (if it has any) and joined to its level. Called once, before its sources are connected. */
function design(key: string, v: Voice, own: Own | undefined) {
  const pl = Chain.plan(own && own.chain, own && own.eq);
  if (!pl.stages.length) return;
  v.fx = Chain.build(ctx, pl, fxEnv);
  v.fx.output.connect(v.gain);
  said(key, v.fx);
}
function said(key: string, fx: BuiltChain) { if (fx.missing.length) window.cueAudio.report({ type: 'operror', op: 'design', key, detail: `not ready yet, so left out of this playing: ${fx.missing.join(', ')}` }); }
/** What plays into a voice's head: its stream's stage, its buffer's stage (and the one a move is leaving), or its input. */
function feeders(v: Voice): { node: AudioNode; out?: number }[] {
  if (v.mic) return v.feed ? [v.feed] : [];
  if (v.buf) return [v.sub && { node: v.sub.bass }, v.moving && v.moving.old.sub && { node: v.moving.old.sub.bass }].filter((f): f is { node: BiquadFilterNode } => !!f);
  return v.dip ? [{ node: v.dip }] : [];
}
/** A playing sound's design changed (an edit in the inspector, A/B). The same tools with other numbers: each
 *  setting glides there (20 ms) and nothing is rebuilt. Another set of tools: a new chain is built and the sound
 *  is moved over to it at once, which may click, and a reverb or a delay that was ringing is cut off. */
function setDesign({ key, chain: c, eq }: Cmd<'design'>) {
  const v = voices.get(key);
  if (!v) return;
  const pl = Chain.plan(c, eq);
  v.swept = '';                             // (a line over a setting takes it back from the knob at the next reading)
  if (v.fx && v.fx.sig === pl.sig) { v.fx.set(pl, 0); return; }
  if (!v.fx && !pl.stages.length) return;
  const old = v.fx, was = headOf(v);
  const next = pl.stages.length ? Chain.build(ctx, pl, fxEnv) : null;
  if (next) { next.output.connect(v.gain); said(key, next); }
  const to = next ? next.input : v.gain;
  for (const f of feeders(v)) { try { f.node.disconnect(was); } catch { /* not connected */ } if (f.out != null) f.node.connect(to, f.out); else f.node.connect(to); }
  v.fx = next;
  if (old) old.dispose();
}
/** A Fade cue moving some of a sound's design over a time (`to`: { tool: { setting: value } }): a filter sweep. */
function sweep({ key, to, secs }: Cmd<'sweep'>) {
  const v = voices.get(key);
  if (!v) return;
  const lost = v.fx ? v.fx.sweep(to, secs) : Object.keys(to || {});
  if (lost.length) window.cueAudio.report({ type: 'operror', op: 'sweep', key, detail: `nothing to move: this sound has no ${lost.join(', ')} switched on` });
}
/** An impulse-response file's bytes, from the host: decoded once, and given to any reverb that was waiting for it. */
async function ir({ file, bytes }: Cmd<'ir'>) {
  try {
    const ab = bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
    const buf = await ctx.decodeAudioData(ab);
    irs.set(file, buf);
    for (const v of voices.values()) { const w = v.fx && v.fx.meters.irWanted; if (w && w.file === file) { w.conv.buffer = buf; delete v.fx!.meters.irWanted; } }
    window.cueAudio.report({ type: 'ir', file, secs: Math.round(buf.duration * 100) / 100 });
  } catch (err) { window.cueAudio.report({ type: 'ir', file, secs: 0, error: String(err) }); }
}
/** The tail: a stopped (or ended) sound whose chain has `tail` on. Its source is shut off (5 ms) and stopped, and
 *  what its reverb and delay still hold rings out through its level, its bus and everything after; then the voice
 *  is let go. It is no longer the cue's sound: the cue can be started again over its own tail. Returns false when
 *  there is no tail to ring (the caller drops the voice). Panic's second press and Reset (`stopAll`) end tails too. */
let tailSeq = 0;
function ring(key: string, v: Voice | undefined) {
  if (!v || !v.fx || !v.fx.tail || !(v.fx.tailSecs > 0) || v.tailOf) return false;
  const now = ctx.currentTime, g = v.fx.input.gain, tk = `tail:${++tailSeq}:${key}`;
  voices.delete(key);
  voices.set(tk, v);
  v.tailOf = key;
  g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + 0.005);
  setTimeout(() => {
    if (voices.get(tk) !== v) return;
    try {
      if (v.mic) { if (v.stream) for (const t of v.stream.getTracks()) t.stop(); if (v.src && v.src.stop) v.src.stop(); }
      else if (v.buf) { settle(v); const n = v.srcNode; v.srcNode = null; if (n) letGo(n); }
      else if (v.el) v.el.pause();
    } catch { /* gone */ }
  }, 20);
  setTimeout(() => { if (voices.get(tk) === v) drop(tk); }, v.fx.tailSecs * 1000 + 60);
  return true;
}
/** A sound that has come to its end, or been stopped: its tail rings if it has one, else it is let go now. */
function finish(key: string) { const v = voices.get(key); if (v && !ring(key, v)) drop(key); }

/**
 * A chain measured, with no sound made: the same `Chain.build` on an offline context, a synthesised signal
 * through it, and what came out read as numbers. This is how the test run checks sound design (nothing can be
 * listened to there). `signal`: { kind: 'sine', hz, db } | { kind: 'impulse' } | { kind: 'step', hz, db, to, at }
 * (a tone that jumps from `db` to `to` at `at` s) | { kind: 'burst', hz, db, until } (a tone that stops).
 * Returns each channel's level in dB over every 10 ms (`l`, `r`), the pitch of the left channel over the second
 * half (`hz`, from its zero crossings), and the tools that could not be built (`missing`).
 */
async function measure({ chain: c, eq, signal, secs = 1, sweep: sw, mono = false }: { chain?: unknown; eq?: unknown; signal?: Signal; secs?: number; sweep?: { to: import('../../core/audio/chain').SweepValue; secs: number }; mono?: boolean }) {
  const sr = 48000, n = Math.round(sr * secs), sig: Signal = signal || { kind: 'sine', hz: 1000, db: -12 };
  const off = new OfflineAudioContext(2, n, sr);
  await off.audioWorklet.addModule(workletUrl);
  const buf = off.createBuffer(mono ? 1 : 2, n, sr);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    if (sig.kind === 'impulse') { d[0] = 1; continue; }
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const db = sig.kind === 'step' ? (t < sig.at ? sig.db : sig.to) : sig.kind === 'burst' && t >= sig.until ? -200 : sig.db;
      d[i] = toLin(db) * Math.sin(2 * Math.PI * sig.hz * t) * (sig.right === false && ch === 1 ? 0 : 1);
    }
  }
  const src = off.createBufferSource();
  src.buffer = buf;
  const pl = Chain.plan(c, eq), fx = Chain.build(off, pl, { worklets: true, ir: fxEnv.ir });
  src.connect(fx.input);
  fx.output.connect(off.destination);
  if (sw) fx.sweep(sw.to, sw.secs);
  src.start();
  const out = await off.startRendering();
  const win = sr / 100, levels = (d: Float32Array) => { const a: number[] = []; for (let i = 0; i + win <= n; i += win) { let q = 0; for (let j = 0; j < win; j++) q += d[i + j] * d[i + j]; a.push(Math.round(Math.max(-120, 10 * Math.log10(q / win + 1e-12)) * 10) / 10); } return a; };
  const L = out.getChannelData(0);
  let zc = 0; for (let i = n / 2 + 1; i < n; i++) if (L[i - 1] < 0 && L[i] >= 0) zc++;
  return { l: levels(L), r: levels(out.getChannelData(1)), hz: zc / (secs / 2), missing: fx.missing, sig: pl.sig, tail: pl.tail, tailSecs: pl.tailSecs };
}

// ── Effects: a reverb and a delay, fed by the buses' sends, each coming back on a pair ──
// `fx.cfg` is what the show says (the host fills in every number); `fx.nodes` holds the ones that have been made.
const fx: { cfg: ReturnType<typeof import('../../core/audio/routing').settingsOf>['fx']; nodes: Record<string, FxNode> } = { cfg: { reverb: { secs: 1.8, db: -6, out: 1 }, delay: { secs: 0.35, feedback: 0.35, db: -6, out: 1 } }, nodes: {} };
/** A room's ring as an impulse response: noise dying away evenly, 60 dB down after `secs`. */
function impulse(secs: number) {
  const n = Math.max(1, Math.round(ctx.sampleRate * secs)), buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(10, -3 * i / n); }
  return buf;
}
function fxNode(kind: 'reverb' | 'delay') {
  if (fx.nodes[kind]) return fx.nodes[kind];
  const inp = ctx.createGain(), ret = ctx.createGain();
  ret.gain.value = 0;
  const f: FxNode = fx.nodes[kind] = { inp, ret, to: null, pair: null };
  if (kind === 'delay') {
    f.delay = ctx.createDelay(4);
    f.back = ctx.createGain();
    inp.connect(f.delay).connect(ret);
    f.delay.connect(f.back).connect(f.delay);
  }
  setFx({});
  return f;
}
/** The effects' settings, and each return to its pair (a pair the device does not have: nowhere, as for a bus). */
function setFx({ reverb, delay }: Cmd<'fx'>) {
  if (reverb) fx.cfg.reverb = reverb;
  if (delay) fx.cfg.delay = delay;
  for (const [kind, f] of Object.entries(fx.nodes)) {
    const c: { secs: number; db: number; out: number; feedback?: number } = fx.cfg[kind as 'reverb' | 'delay'];
    if (kind === 'reverb' && f.secs !== c.secs) {
      // a new room is a new convolver (the old one rings out into nothing)
      if (f.conv) { try { f.inp.disconnect(f.conv); f.conv.disconnect(); } catch { /* gone */ } }
      f.conv = ctx.createConvolver(); f.conv.buffer = impulse(c.secs); f.secs = c.secs;
      f.inp.connect(f.conv).connect(f.ret);
    }
    if (kind === 'delay') { f.delay!.delayTime.setTargetAtTime(c.secs, ctx.currentTime, 0.05); f.back!.gain.setTargetAtTime(c.feedback!, ctx.currentTime, 0.02); }
    ramp(f.ret.gain, c.db, 0.02);
    const k = (Number(c.out) - 1) >> 1;
    const to = hasOut(k * 2) ? outPair(k).inp : null;
    if (to !== f.to) { if (f.to) { try { f.ret.disconnect(f.to); } catch { /* not connected */ } } if (to) f.ret.connect(to); f.to = to; }
    f.pair = to ? k : null;
    if (to) usePair(k);
  }
}
/** A bus's sends (`reverb`, `delay` on the bus: dB, absent for none), taken after its fader and its duck. */
function setSends(b: Bus, cfg: { reverb?: number; delay?: number }) {
  b.sends = b.sends || {};
  for (const kind of ['reverb', 'delay'] as const) {
    const db = cfg[kind] == null ? NaN : Number(cfg[kind]);
    if (!(db > -60)) {
      if (b.sends[kind]) { try { b.band.disconnect(b.sends[kind]); b.sends[kind].disconnect(); } catch { /* gone */ } delete b.sends[kind]; }
      continue;
    }
    if (!b.sends[kind]) { const g = b.sends[kind] = ctx.createGain(); g.gain.value = 0; b.band.connect(g); g.connect(fxNode(kind).inp); }
    ramp(b.sends[kind].gain, db, 0.02);
  }
}

const voices = new Map<string, Voice>();          // key -> { el, src, gain }
const toLin = (db: number) => (db <= -60 ? 0 : Math.pow(10, db / 20));
const toDb = (g: number) => (g <= 0.001 ? -60 : 20 * Math.log10(g));

// url -> { buf: AudioBuffer | null, secs }: tracks decoded for exact looping
const decoded = new Map<string, { buf: AudioBuffer | null }>();
async function decode({ url, file, bytes }: Cmd<'decode'>) {
  if (decoded.has(url)) return;
  const entry: { buf: AudioBuffer | null } = { buf: null };
  decoded.set(url, entry);
  try {
    const ab = bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
    entry.buf = await ctx.decodeAudioData(ab);
    if (decoded.get(url) !== entry) return;           // let go while decoding
    window.cueAudio.report({ type: 'decoded', file, secs: Math.round(entry.buf!.duration * 10) / 10 });
    // whatever is streaming this file moves over to the buffer: a sound that asked to (it loops), and one the
    // operator has since marked a place in or drawn a loop on (the host only has decoded what is wanted)
    for (const [key, v] of voices) if (v.el && v.url === url) upgrade(key, v);
  } catch (err) {
    decoded.delete(url);
    window.cueAudio.report({ type: 'decoded', file, secs: 0, error: String(err) });
  }
}
/** Let go of decoded tracks no longer wanted (nor playing). */
function keep({ urls }: Cmd<'keep'>) {
  const want = new Set(urls);
  const playing = new Set([...voices.values()].filter((v) => v.buf).map((v) => v.url));
  let dropped = 0;
  for (const url of [...decoded.keys()]) if (!want.has(url) && !playing.has(url)) { decoded.delete(url); dropped++; }
  if (dropped) tidy();
}
// Memory: a decoded track is a few hundred megabytes that this window's garbage collector is in no hurry over (the
// window makes almost no garbage of its own to prompt a collection), so tracks that had been let go of stayed in
// memory until one happened to run. So when sound is let go of (a track no longer wanted, a waveform or a tempo
// reading finished) a collection is asked for, a moment later. MEASURED, five eight-minute stereo tracks each
// played from its buffer, drawn and analysed, then nothing playing: 843 MB held before; 426 MB with only the fix in
// `drop` (a dropped voice holds no sound); 36 MB with that and this. It needs the collector exposed (the host
// starts this window with --expose-gc); without it this does nothing and the memory comes back whenever the
// collector next runs.
let tidying: Timer | null = null;
function tidy() {
  clearTimeout(tidying!);
  tidying = setTimeout(() => { if (typeof gc === 'function') { try { gc(); } catch { /* not exposed after all */ } } }, 1500);
}

// ── a buffer voice's clock ──────────────────────────────────────────────────
// `v.clk` = { t, p, r0, r1, d }: at ctx time t it was p seconds into its file (played straight on: a held loop not
// wrapped), playing at rate r0 and on its way to r1 over d seconds (d 0: steady at r1). Every question about where
// a voice is, or when it will be somewhere, is asked of these functions.
const clockAt = (t: number, p: number, r0 = 1, r1 = r0, d = 0): Clock => ({ t, p, r0, r1, d });
function rateAt(v: Voice, at = ctx.currentTime) {
  const c = v.clk, x = at - c.t;
  return c.d > 0 && x < c.d ? c.r0 + (c.r1 - c.r0) * Math.max(0, x) / c.d : c.r1;
}
function straight(v: Voice, at = ctx.currentTime) {
  const c = v.clk, x = at - c.t;
  if (!(c.d > 0)) return c.p + c.r1 * x;
  if (x <= 0) return c.p + c.r0 * x;
  const y = Math.min(x, c.d);
  return c.p + c.r0 * y + (c.r1 - c.r0) * y * y / (2 * c.d) + c.r1 * (x - y);
}
/** The ctx time at which it is (or was) `pos` seconds in, straight on. */
function timeAt(v: Voice, pos: number) {
  const c = v.clk, dp = pos - c.p;
  if (!(c.d > 0)) return c.t + dp / c.r1;
  if (dp <= 0) return c.t + dp / c.r0;
  const ramp = (c.r0 + c.r1) / 2 * c.d;             // the file the ramp covers
  if (dp >= ramp) return c.t + c.d + (dp - ramp) / c.r1;
  const a = (c.r1 - c.r0) / (2 * c.d);
  return c.t + (Math.abs(a) < 1e-9 ? dp / c.r0 : (-c.r0 + Math.sqrt(c.r0 * c.r0 + 4 * a * dp)) / (2 * a));
}
/** Where it is in its file as heard: a held loop, or a loop of the whole file, wrapped. */
function posOf(v: Voice, at = ctx.currentTime) {
  return Lanes.wrap(straight(v, at), v.region, v.loopWhole && v.buf ? v.buf.duration : 0);
}
/** The clock begun again at `at`, from where the voice is heard to be (a loop set or let go, a skip, a rate
 *  moved): what is left of a ramp of its rate carries on. */
function rebase(v: Voice, at = ctx.currentTime, pos = posOf(v, at)) {
  const c = v.clk, left = c.d > 0 ? Math.max(0, c.t + c.d - at) : 0;
  v.clk = clockAt(at, pos, rateAt(v, at), c.r1, left);
}
/** A source node's rate, as its voice's clock has it from `when` on. */
function applyRate(n: AudioBufferSourceNode, v: Voice, when = ctx.currentTime) {
  const c = v.clk, p = n.playbackRate, now = ctx.currentTime, at = Math.max(now, when);
  p.cancelScheduledValues(now);
  p.setValueAtTime(rateAt(v, at), at);
  if (c.d > 0 && c.t + c.d > at) p.linearRampToValueAtTime(c.r1, c.t + c.d);
}
/** A voice's output stage: its level and its voice-band dip (`lanesOn` adds an envelope and a pan between them).
 *  `patch` joins them and takes the sound on to its bus, or to outputs of its own. */
function chain(gainDb: number | undefined) {
  const gain = ctx.createGain();
  gain.gain.value = toLin(gainDb || 0);
  return { gain, band: voiceBand() };
}
/** A pan as a stage: the sound as two channels (a mono one on both), each side its own gain (Lanes.panGains). */
function panStage(pan: number | null): PanStage {
  const inp = ctx.createGain();
  inp.channelCount = 2; inp.channelCountMode = 'explicit'; inp.channelInterpretation = 'speakers';
  const sp = ctx.createChannelSplitter(2), l = ctx.createGain(), r = ctx.createGain(), out = ctx.createChannelMerger(2);
  [l.gain.value, r.gain.value] = Lanes.panGains(pan);
  inp.connect(sp); sp.connect(l, 0); sp.connect(r, 1); l.connect(out, 0, 0); r.connect(out, 0, 1);
  return { inp, sp, l, r, out };
}
function dropPan(v: Voice) { if (!v.pan) return; for (const n of [v.pan.inp, v.pan.sp, v.pan.l, v.pan.r, v.pan.out]) { try { n.disconnect(); } catch { /* gone */ } } v.pan = null; }
/** The stretch after a voice's level, laid again: level ─▶ [envelope] ─▶ [pan] ─▶ ("others" duck) ─▶ voice band. */
function relink(v: Voice) {
  for (const n of [v.gain, v.env, v.pan && v.pan.out]) if (n) { try { n.disconnect(); } catch { /* not connected */ } }
  let at: AudioNode = v.gain;
  if (v.env) { at.connect(v.env); at = v.env; }
  if (v.pan) { at.connect(v.pan.inp); at = v.pan.out; }
  at.connect(v.under || v.band);
  v.pre = at;                               // what feeds its voice band: where a later stage (`others`) goes in
}
/** A voice's lines (from its `play`, or drawn again while it plays: `lanes`): the stages they need made (or let go
 *  of, when a line is taken away), laid into its path if it is already playing. */
function lanesOn(v: Voice, { envelope, pan, automation }: { envelope?: LanePoint[] | null; pan?: number; automation?: Record<string, LanePoint[]> | null }) {
  const chainLanes = Object.fromEntries(Object.entries(automation || {}).filter(([id]) => id.startsWith('chain.')));
  v.lanes = { env: Array.isArray(envelope) && envelope.length ? envelope : null, pan: automation && Array.isArray(automation.pan) && automation.pan.length ? automation.pan : null, chain: Object.keys(chainLanes).length ? chainLanes : null };
  v.panBase = Number(pan) || 0;
  v.rode = {}; v.swept = '';
  const wantEnv = !!v.lanes.env, wantPan = !v.noPan && (v.panBase !== 0 || !!v.lanes.pan);
  if (wantEnv === !!v.env && wantPan === !!v.pan) { if (v.pan && !v.lanes.pan) holdPan(v); return; }
  if (wantEnv && !v.env) v.env = ctx.createGain();
  if (!wantEnv && v.env) { try { v.env.disconnect(); } catch { /* gone */ } v.env = null; }
  if (wantPan && !v.pan) v.pan = panStage(v.lanes.pan ? Lanes.valueAt(v.lanes.pan, placeOf(v) || 0, Lanes.PAN) : v.panBase);
  if (!wantPan && v.pan) dropPan(v);
  if (v.patched) relink(v);
  if (v.pan && !v.lanes.pan) holdPan(v);
}
/** A pan with no line: its two gains to the Pan field's, over 20 ms. */
function holdPan(v: Voice) {
  const [l, r] = Lanes.panGains(v.panBase), now = ctx.currentTime;
  for (const [p, to] of [[v.pan!.l.gain, l], [v.pan!.r.gain, r]] as const) { const cur = p.value; p.cancelScheduledValues(now); p.setValueAtTime(cur, now); p.linearRampToValueAtTime(to, now + 0.02); }
}
const LANE_LOOK = 0.06, LANE_STEP = 0.01;      // s: each line is scheduled this far ahead, in straight ramps this far apart
/** Where a voice is in its file `ahead` s from now (null: nowhere: paused, or a live input). */
function placeOf(v: Voice, ahead = 0) {
  if (v.mic) return null;
  if (v.buf) return v.srcNode ? posOf(v, ctx.currentTime + ahead) : null;
  return v.el && !v.el.paused ? Lanes.wrap(v.el.currentTime + ahead * v.el.playbackRate, null, v.el.loop ? v.el.duration || 0 : 0) : null;
}
/** One automated parameter: `valAt(place)` read where the sound will be at each step ahead, as straight ramps.
 *  `at` (a place in the file): set there at once, with no ramp (a start, a skip). A line that holds still is left
 *  alone once it has arrived. */
function rideParam(v: Voice, name: string, param: AudioParam, valAt: (place: number) => number, at: number | null) {
  const now = ctx.currentTime;
  if (at != null) { const x = valAt(at); param.cancelScheduledValues(now); param.setValueAtTime(x, now); v.rode[name] = null; return; }
  const n = Math.round(LANE_LOOK / LANE_STEP), vals: number[] = [];
  for (let k = 0; k <= n; k++) { const p = placeOf(v, k * LANE_STEP); if (p == null) return; vals.push(valAt(p)); }
  if (vals.every((x) => x === vals[0]) && v.rode[name] === vals[0]) return;     // on a level stretch, and there: nothing to move
  // (from the value it has, read here: cancelAndHoldAtTime, called again and again on a ramp that has arrived,
  // was MEASURED to leave the gain stuck short of where it was going)
  const cur = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(cur, now);
  for (let k = 1; k <= n; k++) param.linearRampToValueAtTime(vals[k], now + k * LANE_STEP);
  v.rode[name] = vals.every((x) => x === vals[0]) ? vals[0] : null;
}
/** Every line of a voice, followed (see the top of this file). `at`: set them all to that place at once. */
function follow(v: Voice, at: number | null = null) {
  if (!v.lanes || v.tailOf) return;
  if (v.env && v.lanes.env) rideParam(v, 'env', v.env.gain, (p) => toLin(Lanes.envelopeAt(v.lanes.env, p)), at);
  if (v.pan && v.lanes.pan) {
    rideParam(v, 'panL', v.pan.l.gain, (p) => Lanes.panGains(Lanes.valueAt(v.lanes.pan, p, Lanes.PAN))[0], at);
    rideParam(v, 'panR', v.pan.r.gain, (p) => Lanes.panGains(Lanes.valueAt(v.lanes.pan, p, Lanes.PAN))[1], at);
  }
  if (v.fx && v.lanes.chain) {
    const p = at != null ? at : placeOf(v, LANE_LOOK);
    if (p == null) return;
    const on = new Set<string>(v.fx.plan.stages.map((st) => st.tool));
    const to = Object.fromEntries(Object.entries(Lanes.sweepAt(v.lanes.chain, p, Chain.TOOLS)).filter(([tool]) => on.has(tool)));
    const said = JSON.stringify(to);
    if (said === v.swept || said === '{}') return;
    v.swept = said;
    v.fx.sweep(to, at != null ? 0 : LANE_LOOK);
  }
}
/** Every automated parameter held where it is (a pause): what was scheduled ahead is taken off. */
function holdLanes(v: Voice) {
  const now = ctx.currentTime;
  for (const p of [v.env && v.env.gain, v.pan && v.lanes && v.lanes.pan && v.pan.l.gain, v.pan && v.lanes && v.lanes.pan && v.pan.r.gain]) {
    if (!p) continue;
    const cur = p.value; p.cancelScheduledValues(now); p.setValueAtTime(cur, now);
  }
  v.rode = {}; v.swept = '';
}
/** A playing sound's lines drawn again (an edit in the window): heard at once. */
function setLanes({ key, envelope, pan, automation }: Cmd<'lanes'>) {
  const v = voices.get(key);
  if (!v || v.mic || v.tailOf) return;
  lanesOn(v, { envelope, pan, automation });
  follow(v);
}
// Thirty times a second: every line follows its sound, and a streamed sound's rate (an element has no ramp of
// its own) is stepped along its fade.
setInterval(() => {
  const now = ctx.currentTime;
  for (const v of voices.values()) {
    if (v.lanes) follow(v);
    const rr = v.rateRamp;
    if (rr && v.el) {
      const x = rr.d > 0 ? Math.min(1, (now - rr.t) / rr.d) : 1;
      try { v.el.playbackRate = rr.from + (rr.to - rr.from) * x; } catch { /* a rate the element will not take */ }
      if (x >= 1) v.rateRamp = null;
    }
  }
}, 33);

/** A buffer voice's source plays through a stage of its own (`sub`: a gain and the bass shelf) into the
 *  voice's gain, so a move can crossfade two places in the one track with the track's level, its ducks and
 *  its fader untouched after it. */
function makeSub(v: Voice): Sub {
  const gain = ctx.createGain();
  const bass = bassShelf();
  gain.connect(bass).connect(headOf(v));
  return { gain, bass };
}
/** A buffer's source node, finished with: stopped and out of the graph. */
function letGo(n: AudioBufferSourceNode) {
  try { n.onended = null; n.stop(); } catch { /* never started, or gone */ }
  try { n.disconnect(); } catch { /* gone */ }
}
function dropSub(sub: Sub) { try { sub.gain.disconnect(); sub.bass.disconnect(); } catch { /* gone */ } }
/** A sub stage back to flat (full level, its bass in), from wherever its automation had it. */
function flat(sub: Sub, now: number, ramp = 0) {
  for (const [p, val] of [[sub.gain.gain, 1], [sub.bass.gain, 0]] as const) {
    const cur = p.value;
    p.cancelScheduledValues(now); p.setValueAtTime(cur, now);
    if (ramp > 0) p.linearRampToValueAtTime(val, now + ramp); else p.setValueAtTime(val, now);
  }
}
/** A move still under way (`v.moving`: in its lead or its crossfade) when something else comes (a pause, a
 *  skip, another move, a stop). Before it lands it is undone: the place it was leaving plays on as before.
 *  Once crossfading it lands at once: the old place gone, the new one at full (measured: a pause mid-move
 *  left the new place frozen silent, or the old one sounding through the pause). */
function settle(v: Voice) {
  const m = v.moving;
  if (!m) return;
  v.moving = null;
  clearTimeout(m.timer);
  const now = ctx.currentTime;
  if (now < m.when && m.old.node) {
    letGo(m.n);
    dropSub(m.sub);
    Object.assign(v, { srcNode: m.old.node, sub: m.old.sub, clk: m.old.clk, region: m.old.region, loopWhole: m.old.loopWhole, released: m.old.released });
    m.old.node.onended = m.old.onended!;
    try { m.old.node.stop(now + 86400); } catch { /* gone */ }   // its stop at the crossfade is off: the last stop() is the one applied
    flat(m.old.sub!, now);
    return;
  }
  if (m.old.node) letGo(m.old.node);
  if (m.old.sub) dropSub(m.old.sub);
  if (v.sub) flat(v.sub, now, 0.02);
}

/** A buffer voice: (re)start its source at `t` s, looping its held section if it has one. */
function startBuf(key: string, v: Voice, t: number | undefined, into?: AudioNode) {
  settle(v);
  if (v.srcNode) { const old = v.srcNode; v.srcNode = null; letGo(old); }
  // a fresh stage, flat: a stage with nothing playing into it stops its automation where it was (MEASURED,
  // Chromium), so one left part way through a move's crossfade or bass swap would stay there
  if (v.sub && !into) { dropSub(v.sub); v.sub = null; }
  if (!v.sub) v.sub = makeSub(v);
  const n = ctx.createBufferSource();
  n.buffer = v.buf!;
  applyLoop(n, v);
  n.connect(into || v.sub!.gain);
  n.onended = () => { if (v.srcNode === n && voices.get(key) === v) { finish(key); window.cueAudio.report({ type: 'ended', key }); } };
  ctx.resume();
  const from = Math.max(0, Math.min(t || 0, v.buf!.duration - 0.01));
  // its clock from here (before any held loop wraps it): at the rate it had, on with any ramp of it
  if (v.clk) rebase(v, ctx.currentTime, from); else v.clk = clockAt(ctx.currentTime, from, v.rate0 || 1);
  applyRate(n, v);
  n.start(0, from);
  v.srcNode = n;
  v.released = false;
  follow(v, from);
}
function applyLoop(n: AudioBufferSourceNode, v: Voice) {
  if (v.region) { n.loopStart = v.region.start; n.loopEnd = v.region.end; n.loop = true; }
  else { n.loopStart = 0; n.loopEnd = 0; n.loop = !!v.loopWhole; }
}

/** A Mic cue: a live input onto its bus. One channel of the device, as it comes (no echo cancelling, no automatic
 *  gain: those are for telephone calls). A test run opens no input: a quiet steady signal stands in for it. */
async function openMic(key: string, { input, channel }: NonNullable<Cmd<'play'>['mic']>, gainDb: number | undefined, bus: string | undefined, own: Own | undefined, pan: number | undefined) {
  const v = { mic: true, ...chain(gainDb), db: gainDb || 0, stream: null, src: null } as Partial<Voice> as Voice;
  lanesOn(v, { pan });                      // (a microphone has a pan and no lines: it has no place in a file)
  design(key, v, own);
  patch(v, bus, own);
  voices.set(key, v);
  if (SILENT) { const c = ctx.createConstantSource(); c.offset.value = 0.1; c.connect(headOf(v)); c.start(); v.src = c; v.feed = { node: c }; return; }
  let deviceId: { exact: string } | undefined;
  if (input) {
    const found = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'audioinput' && (d.label === input || d.deviceId === input));
    if (!found) { drop(key); window.cueAudio.report({ type: 'error', key, url: `mic:${input}`, detail: `there is no input named ${input}` }); return; }
    deviceId = { exact: found.deviceId };
  }
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: Math.max(2, channel) } } }); }
  catch (err) { if (voices.get(key) === v) { drop(key); window.cueAudio.report({ type: 'error', key, url: `mic:${input || 'default'}`, detail: `the input could not be opened: ${(err as Error).message || err}` }); } return; }
  if (voices.get(key) !== v) { for (const t of stream.getTracks()) t.stop(); return; }      // stopped while it was opening
  v.stream = stream;
  v.src = ctx.createMediaStreamSource(stream);
  const have = v.src.channelCount || 1;
  if (have > 1) { const sp = ctx.createChannelSplitter(have); v.src.connect(sp); sp.connect(headOf(v), Math.min(channel, have) - 1); v.split = sp; v.feed = { node: sp, out: Math.min(channel, have) - 1 }; }
  else { v.src.connect(headOf(v)); v.feed = { node: v.src }; }
  ctx.resume();
  devices();                    // (the inputs have names once one has been opened)
}

function play({ key, url, gainDb, from, loop, exact, bus, mic, own, rate, preservePitch, envelope, pan, automation, speech }: Cmd<'play'>) {
  stop({ key });
  if (mic) { openMic(key, mic, gainDb, bus, own, pan).catch((err) => window.cueAudio.report({ type: 'operror', op: 'mic', key, detail: String(err) })); return; }
  const ready = exact && decoded.get(url!) && decoded.get(url!)!.buf;
  // (its sound design starts with each automated setting where its line is at the place it starts from)
  if (automation && own && own.chain) own = { ...own, chain: Lanes.chainAt(own.chain, automation, from || 0, Chain.TOOLS) };
  const lines = { envelope, pan, automation };
  if (ready) {
    const v = { buf: ready, url, ...chain(gainDb), db: gainDb || 0, region: null, loopWhole: !!loop, srcNode: null, rate0: rate! > 0 ? rate : 1, speech } as Partial<Voice> as Voice;
    lanesOn(v, lines);
    design(key, v, own);
    patch(v, bus, own);
    voices.set(key, v);
    startBuf(key, v, from || 0);
    window.cueAudio.report({ type: 'mode', key, exact: true });
    return;
  }
  if (exact) window.cueAudio.report({ type: 'mode', key, exact: false });
  const el = new Audio();
  el.preload = 'auto';
  el.loop = !!loop;                 // a loop never ends: it plays until stopped or faded out
  el.src = url!;
  const src = ctx.createMediaElementSource(el);
  const dip = ctx.createGain();                 // a move's 30 ms dip, apart from the level (and the fades on it)
  const out = chain(gainDb);
  // its rate: with its pitch kept (the element's stretcher) or not (as a tape). Kept, it stays a stream for good.
  const keepPitch = !!preservePitch && rate! > 0 && rate !== 1;
  if (rate! > 0 && rate !== 1) { el.preservesPitch = keepPitch; el.defaultPlaybackRate = rate!; el.playbackRate = rate!; }
  const v = { el, src, dip, ...out, db: gainDb || 0, url, wantExact: !!exact && !keepPitch, keepPitch, speech } as Partial<Voice> as Voice;
  lanesOn(v, lines);
  design(key, v, own);
  src.connect(dip).connect(headOf(v));
  patch(v, bus, own);
  voices.set(key, v);
  follow(v, from || 0);
  el.addEventListener('ended', () => { if (voices.get(key) === v) { finish(key); window.cueAudio.report({ type: 'ended', key }); } });
  el.addEventListener('error', () => { if (voices.get(key) === v) { drop(key); window.cueAudio.report({ type: 'error', key, url: url! }); } });
  const start = () => {
    if (from! > 0) el.currentTime = Math.min(from!, (el.duration || from!) - 0.05);
    ctx.resume();
    el.play().catch((err) => {
      // The stream's play() is rejected when the voice moved over to its decoded buffer before the stream had
      // started (`upgrade` pauses the element): the sound is playing, from the buffer, and this is not an error.
      // Reporting it made the engine forget a sound that was still sounding, which Panic then could not stop.
      if (voices.get(key) !== v || v.buf) return;
      drop(key);
      window.cueAudio.report({ type: 'error', key, url: url!, detail: String(err) });
    });
  };
  if (from! > 0 && el.readyState < 1) el.addEventListener('loadedmetadata', start, { once: true });
  else start();
}

/** Seconds until buffer voice `v` plays the place `at` s into its file (a held section comes round). */
function untilAt(v: Voice, at: number) {
  const now = ctx.currentTime;
  const u = straight(v, now);                       // where it would be, played straight on
  const g = v.region;
  if (!g) return at - u >= 0 ? timeAt(v, at) - now : null;
  const len = g.end - g.start;
  const pos = u < g.end ? u : g.start + ((u - g.end) % len);
  if (u < g.end && at >= u) return timeAt(v, at) - now;          // not yet round: straight on to it
  return timeAt(v, u + ((((at - pos) % len) + len) % len)) - now;
}

/** A music cue: the track moves to `to` (looping `region` if it says), when it reaches sync.at — to the
 *  sample, its place read from its own clock (else as near as `lead` says) — crossfading the place it
 *  leaves into the place it lands, inside the track, over sync.xf: equal power ('fade', 'dj': the bass
 *  swapped on the downbeat in the middle), or equal gain for a 'cut' (a few ms of nearly the same music).
 *  A streamed voice (not decoded yet) can only jump: a 30 ms dip, then it plays from the new place. */
function move({ key, to, region, sync }: Cmd<'move'>) {
  const v = voices.get(key);
  if (!v || !sync) return;
  const xf = Math.max(0.005, Number(sync.xf) || 0);
  const now = ctx.currentTime;
  let when = now + Math.max(0, sync.lead || 0);
  if (!v.buf) {
    setTimeout(() => {
      if (voices.get(key) !== v) return;
      // the dip on the stream's own stage (or, decoded since, the buffer's), never the level: a fade sent
      // with the move (its `level`) runs on underneath
      const g = (v.buf ? v.sub!.gain : v.dip!).gain, t = ctx.currentTime;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + 0.03);
      setTimeout(() => {
        if (voices.get(key) !== v) return;
        if (v.buf) startBuf(key, v, to + xf / 2);            // decoded in the meantime: the buffer jumps instead
        else { try { v.el.currentTime = to + xf / 2; } catch { /* not seekable yet */ } }
        const t2 = ctx.currentTime; g.cancelScheduledValues(t2); g.setValueAtTime(0, t2); g.linearRampToValueAtTime(1, t2 + 0.05);
      }, 35);
    }, Math.max(0, (sync.lead || 0) + xf / 2 - 0.03) * 1000);
    return;
  }
  settle(v);                                                  // a move before the last one landed replaces it
  // to the sample when the buffer says where it is; if that disagrees with the engine by more than a
  // beat's worth, something moved under it (a seek on its way): trust the engine
  const exactAt = v.srcNode && !v.released ? untilAt(v, sync.at) : null;
  if (exactAt != null && Math.abs(exactAt - (sync.lead || 0)) < 0.3) when = now + exactAt;
  const old: Move['old'] = { node: v.srcNode, sub: v.sub, clk: v.clk, region: v.region, loopWhole: v.loopWhole, released: v.released,
                onended: v.srcNode && v.srcNode.onended };
  const sub = makeSub(v);
  sub.gain.gain.value = 0;
  v.region = region && region.end > region.start ? { start: region.start, end: region.end } : null;
  v.loopWhole = false;
  const n = ctx.createBufferSource();
  n.buffer = v.buf;
  applyLoop(n, v);
  n.connect(sub.gain);
  n.onended = () => { if (v.srcNode === n && voices.get(key) === v) { finish(key); window.cueAudio.report({ type: 'ended', key }); } };
  const from = Math.max(0, Math.min(to, v.buf.duration - 0.01));
  rebase(v, when, from);                                      // its clock from the landing on, at the rate it will have then
  applyRate(n, v, when);
  n.start(when, from);
  v.srcNode = n; v.sub = sub; v.released = false;
  // the two places, crossfaded
  const steps = Math.max(2, Math.ceil(xf * 100));
  const up = new Float32Array(steps), down = new Float32Array(steps);
  const cut = sync.blend === 'cut';
  for (let i = 0; i < steps; i++) {
    const x = i / (steps - 1);
    up[i] = cut ? x : Math.sin(x * Math.PI / 2);
    down[i] = cut ? 1 - x : Math.cos(x * Math.PI / 2);
  }
  sub.gain.gain.setValueAtTime(0, now);
  sub.gain.gain.setValueCurveAtTime(up, when, xf);
  if (old.sub) {
    // full until it leaves (a move that landed early, just above, may have left it part way up)
    const og = old.sub.gain.gain, re = Math.min(now + 0.02, when - 0.002);
    og.cancelScheduledValues(now);
    og.setValueAtTime(og.value, now);
    if (re > now) og.linearRampToValueAtTime(1, re); else og.setValueAtTime(1, now);
    og.setValueCurveAtTime(down, when, xf);
  }
  if (sync.blend === 'dj') {
    const mid = when + xf / 2;
    sub.bass.gain.setValueAtTime(BASS_OUT_DB, now);
    sub.bass.gain.setValueAtTime(BASS_OUT_DB, mid);
    sub.bass.gain.linearRampToValueAtTime(0, mid + BASS_SWAP_S);
    if (old.sub) { old.sub.bass.gain.setValueAtTime(0, mid); old.sub.bass.gain.linearRampToValueAtTime(BASS_OUT_DB, mid + BASS_SWAP_S); }
  }
  if (old.node) {
    old.node.onended = null;
    try { old.node.stop(when + xf + 0.02); } catch { /* gone */ }
  }
  const m: Move = { old, n, sub, when };
  m.timer = setTimeout(() => {
    if (v.moving === m) v.moving = null;
    if (old.node) letGo(old.node); if (old.sub) dropSub(old.sub);
  }, Math.max(0, when - now + xf + 0.2) * 1000);
  v.moving = m;
}

/** A streamed voice whose track has now decoded: carry on from the buffer, where the
 *  stream is, crossfading the two so the change is not heard. The gain node (and any
 *  fade on it) stays; the voice is a buffer voice from here on and reports exact. */
const XFADE_S = 0.03;
function upgrade(key: string, v: Voice) {
  const entry = decoded.get(v.url);
  if (!entry || !entry.buf || v.buf || voices.get(key) !== v || v.tailOf) return;
  const { el, src } = v;
  const paused = el.paused;
  const t = el.currentTime;
  if (!(t < entry.buf.duration - 0.25)) return;              // nearly over: let it stream out
  if (v.keepPitch) return;                                    // a stretched sound has no buffer to move over to
  Object.assign(v, { buf: entry.buf, region: null, loopWhole: el.loop, srcNode: null, wantExact: false });
  // its clock, from the stream's: its rate, and what is left of a fade of it
  { const rr = v.rateRamp, now0 = ctx.currentTime; v.clk = clockAt(now0, t, el.playbackRate || 1, rr ? rr.to : el.playbackRate || 1, rr ? Math.max(0, rr.t + rr.d - now0) : 0); v.rateRamp = null; }
  delete (v as Partial<Voice>).el; delete (v as Partial<Voice>).src;
  const retire = () => { try { el.pause(); src!.disconnect(); } catch { /* gone */ } el.removeAttribute('src'); el.load(); };
  window.cueAudio.report({ type: 'mode', key, exact: true });
  if (paused) { retire(); v.pausedAt = t; return; }           // resume starts the buffer there
  const now = ctx.currentTime;
  const out = ctx.createGain(), inn = ctx.createGain();
  out.gain.setValueAtTime(1, now); out.gain.linearRampToValueAtTime(0, now + XFADE_S);
  inn.gain.setValueAtTime(0, now); inn.gain.linearRampToValueAtTime(1, now + XFADE_S);
  if (!v.sub) v.sub = makeSub(v);                    // the buffer plays through its own stage, as every buffer does
  src!.disconnect(); src!.connect(out).connect(headOf(v));
  inn.connect(v.sub.gain);
  startBuf(key, v, t, inn);
  setTimeout(() => { retire(); out.disconnect(); }, XFADE_S * 1000 + 50);
}

/** A fade straight in dB, like QLab's, over `secs`. `range: 'voice'` moves the sound's
 *  voice-band dip to `db` instead (a duck that carves room for words, 0 = flat). */
function fade({ key, db, secs, range, shape }: Cmd<'fade'>) {
  const v = voices.get(key);
  if (!v) return;
  if (range === 'voice') { rampDb(v.band.gain, Math.min(0, db), secs); return; }
  const p = v.gain.gain;
  const now = ctx.currentTime;
  // (a cut that was made at its chain's door, below, is taken back by the level the engine sends after a skip back)
  if (v.cutIn && v.fx) { v.cutIn = false; const g = v.fx.input.gain; g.cancelScheduledValues(now); g.setValueAtTime(1, now); }
  const fromDb = toDb(p.value);
  p.cancelScheduledValues(now);
  if (!(secs! > 0)) { p.setValueAtTime(toLin(db), now); v.db = db; return; }
  const n = Math.max(2, Math.ceil(secs! * 50));
  const curve = new Float32Array(n);
  // its shape: how far along it is at each moment (a list of evenly spaced readings; none: a straight line in dB)
  const along = Array.isArray(shape) && shape.length > 1
    ? (x: number) => { const f = x * (shape.length - 1), i = Math.min(shape.length - 2, Math.floor(f)); return shape[i] + (shape[i + 1] - shape[i]) * (f - i); }
    : (x: number) => x;
  for (let i = 0; i < n; i++) curve[i] = toLin(fromDb + (db - fromDb) * along(i / (n - 1)));
  p.setValueCurveAtTime(curve, now, secs!);
  v.db = db;
}

/** A cue that ducks (or boosts) the others while it runs: this sound held `db` from its level, on a gain of its
 *  own after the level's, so no fade, trim or pause on the sound itself is disturbed. Made when first asked for. */
function others({ key, db, secs }: Cmd<'others'>) {
  const v = voices.get(key);
  if (!v) return;
  if (!v.under) {
    if (!db) return;
    v.under = ctx.createGain();
    // (after its level, its envelope and its own eq, whichever it has: the last thing before its voice band)
    const pre = v.pre || v.gain;
    pre.disconnect(v.band);
    pre.connect(v.under).connect(v.band);
  }
  ramp(v.under.gain, Number(db) || 0, secs);
}

function drop(key: string) {
  const v = voices.get(key);
  if (!v) return;
  voices.delete(key);
  unpatch(v);
  for (const n of [v.env, v.under]) if (n) { try { n.disconnect(); } catch { /* gone */ } }
  dropPan(v);
  if (v.moving) {
    const m = v.moving; v.moving = null; clearTimeout(m.timer);
    if (m.old.node) letGo(m.old.node);
    if (m.old.sub) dropSub(m.old.sub);
  }
  if (v.mic) {
    try { if (v.stream) for (const t of v.stream.getTracks()) t.stop(); if (v.src) { if (v.src.stop) v.src.stop(); v.src.disconnect(); } if (v.split) v.split.disconnect(); v.gain.disconnect(); v.band.disconnect(); } catch { /* gone */ }
    return;
  }
  if (v.buf) {
    const n = v.srcNode; v.srcNode = null;
    if (n) letGo(n);
    try { if (v.sub) dropSub(v.sub); v.gain.disconnect(); v.band.disconnect(); } catch { /* gone */ }
    // A dropped voice holds no sound. MEASURED: a voice that began as a stream and moved over to its buffer was kept,
    // buffer and all (some 170 MB for eight minutes of stereo), by the listeners on the stream's element, which
    // Chromium did not let go of: every such track played stayed in memory for as long as the app was open.
    v.buf = null; v.sub = null;
    return;
  }
  try { v.el.pause(); } catch { /* gone */ }
  try { v.src!.disconnect(); if (v.dip) v.dip.disconnect(); if (v.sub) dropSub(v.sub); v.gain.disconnect(); v.band.disconnect(); } catch { /* gone */ }
  v.el.removeAttribute('src');
  v.el.load();
}
/** A cutAt: silence from this place in the file, to the sample, with a 4 ms ramp so it does not click. */
function cut({ key, at }: Cmd<'cut'>) {
  const v = voices.get(key);
  if (!v || v.mic) return;
  const now = ctx.currentTime;
  const T = v.buf ? timeAt(v, at) : now + (at - v.el.currentTime) / (v.el.playbackRate || 1);
  // a sound whose tail rings is cut where it goes into its chain, so the reverb is not cut with it
  const tailed = !!(v.fx && v.fx.tail);
  const p = tailed ? v.fx!.input.gain : v.gain.gain;
  if (tailed) v.cutIn = true;
  const level = p.value;
  p.cancelScheduledValues(now);
  p.setValueAtTime(level, Math.max(now, T - 0.004));
  p.linearRampToValueAtTime(0, Math.max(now, T));
}

function stop({ key }: Cmd<'stop'>) { finish(key); }


/** How long each file is, or that it cannot be read, before anything plays. */
async function probe({ files }: Cmd<'probe'>) {
  for (const { file, url } of files) {
    await new Promise<void>((resolve) => {
      const el = new Audio();
      el.preload = 'metadata';
      // (load() after the src is taken off is what makes the element let go of the file and its decoder)
      const done = (msg: import('./preload').AudioEvent) => { window.cueAudio.report(msg); el.removeAttribute('src'); el.load(); resolve(); };
      el.addEventListener('loadedmetadata', () => done({ type: 'duration', file, secs: el.duration }), { once: true });
      el.addEventListener('error', () => done({ type: 'missing', file }), { once: true });
      el.src = url;
    });
  }
}

async function devices() {
  const list = (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind === 'audiooutput')
    .map((d) => ({ id: d.deviceId, label: d.label || (d.deviceId === 'default' ? 'System default' : d.deviceId) }));
  const all = await navigator.mediaDevices.enumerateDevices();
  const inputs = all.filter((d) => d.kind === 'audioinput' && d.label && d.deviceId !== 'default').map((d) => d.label);
  window.cueAudio.report({ type: 'devices', list, inputs, current: ctx.sinkId || 'default' });
}

async function sink({ id, fallback }: Cmd<'sink'>) {
  try {
    await ctx.setSinkId(!id || id === 'default' ? '' : id);
    // (a context whose device went away under it is suspended: on its new device it runs again)
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    window.cueAudio.report({ type: 'sink', id: id || 'default', ok: true, fallback: !!fallback });
  } catch (err) {
    window.cueAudio.report({ type: 'sink', id, ok: false, detail: String(err), fallback: !!fallback });
  }
  // a new device has its own number of outputs: every bus finds its pair again (or finds it gone)
  outKey = '';
  for (const b of Object.values(buses)) routeBus(b, b.out);
  setFx({});
  try { route(); } catch (err) { window.cueAudio.report({ type: 'operror', op: 'route', key: '', detail: String(err) }); }
  devices();
}

/** Pause holds the sound and its level where they are (a fade stops part way). */
function pause({ key }: Cmd<'pause'>) {
  const v = voices.get(key);
  if (!v || v.mic) return;
  if (v.buf) settle(v);                                      // a move under way: undone, or landed
  // (where it is heard to be, a held loop wrapped; a ramp of its rate stops where it is, and the engine sends what is left of it on resume)
  if (v.buf) { const n = v.srcNode; v.srcNode = null; if (n) { v.pausedAt = posOf(v); v.clk = clockAt(ctx.currentTime, v.pausedAt, rateAt(v)); letGo(n); } }
  else { v.el.pause(); v.rateRamp = null; }
  if (v.lanes) holdLanes(v);
  const g = v.gain.gain;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(ctx.currentTime);
  else { const val = g.value; g.cancelScheduledValues(ctx.currentTime); g.setValueAtTime(val, ctx.currentTime); }
}
function resume({ key, t }: Cmd<'resume'>) {
  const v = voices.get(key);
  if (!v || v.mic) return;
  if (v.buf) { startBuf(key, v, t != null ? t : v.pausedAt); return; }
  ctx.resume(); v.el.play().catch(() => {});
}

/** A loop told to finish: it plays to its end and stops (or loops again). */
function setLoop({ key, on }: Cmd<'loop'>) {
  const v = voices.get(key);
  if (!v || v.mic) return;
  if (v.buf) { v.loopWhole = !!on; if (v.srcNode) applyLoop(v.srcNode, v); return; }
  v.el.loop = !!on;
}

/** HOLD: loop this section of a decoded track to the sample (start null: let go, play on). */
function setRegion({ key, start, end }: Cmd<'region'>) {
  const v = voices.get(key);
  if (!v || !v.buf) return;
  if (start == null && v.region) v.released = true;     // let go mid-loop
  if (v.srcNode) rebase(v);                              // its clock begins again where it is heard to be, so the times round are not counted twice
  v.region = start == null ? null : { start, end };
  if (v.srcNode) applyLoop(v.srcNode, v);
}

function seek({ key, t }: Cmd<'seek'>) {
  const v = voices.get(key);
  if (v && v.mic) return;
  if (v && v.buf) { if (v.srcNode) startBuf(key, v, t); else v.pausedAt = t; return; }
  if (v) { try { v.el.currentTime = Math.max(0, t); } catch { /* not seekable yet */ } follow(v, Math.max(0, t)); }
}

/** How fast a sound plays, moved to `rate` over `secs` (0: at once). A buffer's rate ramps on the audio clock and
 *  its own clock follows the ramp exactly; a stream's is stepped (the tick above). */
function setRate({ key, rate, secs }: Cmd<'rate'>) {
  const v = voices.get(key);
  if (!v || v.mic || !(rate > 0)) return;
  const now = ctx.currentTime, d = secs! > 0 ? secs! : 0;
  if (!v.buf) {
    v.rateRamp = d > 0 ? { from: v.el.playbackRate, to: rate, t: now, d } : null;
    if (!d) { try { v.el.playbackRate = rate; } catch { /* a rate the element will not take */ } }
    return;
  }
  if (!v.srcNode) { v.clk = clockAt(now, v.pausedAt || 0, d > 0 ? rateAt(v) : rate, rate, d); return; }      // paused: it has that rate when it goes on
  const at = Math.max(now, v.clk.t);                       // (in a move's lead: from its landing)
  v.clk = clockAt(at, posOf(v, at), rateAt(v, at), rate, d);
  applyRate(v.srcNode, v, at);
  // the place a move is leaving plays out its crossfade at the same rate
  const old = v.moving && v.moving.old.node;
  if (old) { try { const p = old.playbackRate; p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); p.linearRampToValueAtTime(rate, now + Math.max(d, 0.005)); } catch { /* gone */ } }
}

/** Peaks for a file main cannot read itself (mp3): decoded at a low rate, then dropped. */
/** A file as mono sound at 11 kHz, for the host to find its tempo in (core/audio/tempo.ts). The first twenty minutes. */
async function pcm({ file, bytes }: Cmd<'pcm'>) {
  try {
    const off = new OfflineAudioContext(1, 1, 11025);
    const buf = await off.decodeAudioData(bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes);
    const n = Math.min(buf.length, Math.round(buf.sampleRate * 1200)), samples = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) samples[i] += d[i] / buf.numberOfChannels; }
    window.cueAudio.report({ type: 'pcm', file, rate: buf.sampleRate, samples });
    tidy();
  } catch (err) {
    window.cueAudio.report({ type: 'pcm', file, samples: null, error: String(err) });
  }
}
async function peaks({ file, bytes, bins: want }: Cmd<'peaks'>) {
  try {
    const off = new OfflineAudioContext(1, 1, 11025);
    const buf = await off.decodeAudioData(bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes);
    const bins = want! > 0 ? want! : 1600, per = buf.length / bins, out = new Array(bins).fill(0), sq = new Array(bins).fill(0), n = new Array(bins).fill(0);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) { const b = Math.min(bins - 1, Math.floor(i / per)); const v = Math.abs(d[i]); if (v > out[b]) out[b] = v; sq[b] += v * v; n[b]++; }
    }
    const r3 = (v: number) => Math.round(Math.min(1, v) * 1000) / 1000;
    window.cueAudio.report({ type: 'peaks', file, bins, peaks: out.map(r3), rms: sq.map((v, i) => r3(n[i] ? Math.sqrt(v / n[i]) : 0)) });
    tidy();
  } catch {
    window.cueAudio.report({ type: 'peaks', file, bins: want, peaks: null });
  }
}

/** A ramp in dB on a gain, from wherever it is now. */
function ramp(param: AudioParam, db: number, secs: number | undefined) {
  const now = ctx.currentTime;
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
  else { const v = param.value; param.cancelScheduledValues(now); param.setValueAtTime(v, now); }
  if (!(secs! > 0)) { param.setValueAtTime(toLin(db), now); return; }
  // setTargetAtTime: an exponential approach, which is a straight line in dB as heard;
  // a time constant of a third of `secs` lands within 0.5 dB by then
  param.setTargetAtTime(toLin(db), now, secs! / 3);
}
/** A ramp on a parameter that is already in dB (a filter's gain), from where it is now. */
function rampDb(param: AudioParam, db: number, secs: number | undefined) {
  const now = ctx.currentTime;
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
  else { const v = param.value; param.cancelScheduledValues(now); param.setValueAtTime(v, now); }
  if (!(secs! > 0)) { param.setValueAtTime(db, now); return; }
  param.setTargetAtTime(db, now, secs! / 3);
}
/** The mixer: a bus fader moved (or a Mix cue's fade). */
function setBus({ name, db, secs }: Cmd<'bus'>) { const b = ensureBus(name); ramp(b.fader.gain, db, secs); ramp(b.ctl.fader.gain, db, secs); }
/** The ducker: the music's dip (0 = none), in the voice range or of the whole mix. */
function setDuck({ bus, db, secs, range }: Cmd<'duck'>) {
  const b = ensureBus(bus || 'music');
  const voice = range !== 'all';
  ramp(b.duck.gain, voice ? 0 : db, secs);
  rampDb(b.band.gain, voice ? db : 0, secs);
  ramp(b.ctl.duck.gain, voice ? 0 : db, secs);            // (the same two moves on the bus's level as a signal: `ride`)
  rampDb(b.ctl.dip.offset, voice ? db : 0, secs);
}
// Ducking: while a key bus is sounding above the threshold, the target bus dips (its duck stage, so its fader
// and a Fade cue's work are untouched); when the keys have been quiet for `hold`, it comes back over `release`.
// Read here, where the sound is, 30 times a second: the host only says how it is set. There is a rule per bus
// that ducks (`rules`: [{ target, keys: [bus], threshold, depth, attack, hold, release, range }]); a show from
// before kinds sends its one pair ({ on, key, target, … }) and is one rule.
//
// Look-ahead: a recorded voice whose speech is known (`speech` on its `play`: [[from, to], …] in its file's
// seconds, found by the host from its waveform) is not waited for. Where it is in its file is known, so the dip
// starts an attack time BEFORE each stretch of speech and the music comes back as its last word ends (after
// SPEECH_HOLD, not the rule's hold, which is there to ride out the gaps a level cannot see past). When every
// sound on a key bus is such a voice, the bus's level is not read at all; a live mic, or a sound with no map, is
// keyed by level as before.
const SPEECH_HOLD = 0.15;
let duckRules: { target: string; keys: string[]; threshold: number; depth: number; attack: number; hold: number; release: number; range: 'all' | 'voice'; ducked: boolean; lastLoud: number; holdNow: number }[] = [];
const duckBuf = new Float32Array(1024);
function setDucker(cfg: Cmd<'ducker'>) {
  const list = Array.isArray(cfg.rules) ? cfg.rules : cfg.on ? [{ ...cfg, keys: [cfg.key], target: cfg.target || 'music' }] : [];
  const next = list.map((r: import('./preload').DuckerRule): (typeof duckRules)[number] => ({ target: r.target!, keys: (r.keys || []).filter((k): k is string => !!k && k !== r.target), threshold: Number(r.threshold), depth: Math.min(0, Number(r.depth) || 0), attack: Math.max(0.005, Number(r.attack) || 0.05), hold: Math.max(0, Number(r.hold) || 0), release: Math.max(0.02, Number(r.release) || 1), range: r.range === 'all' ? 'all' : 'voice', ducked: false, lastLoud: 0, holdNow: 0 }))
    .filter((r) => r.target && r.keys.length);
  for (const was of duckRules) {
    const now = next.find((r) => r.target === was.target && r.range === was.range);
    if (now) { now.ducked = was.ducked; now.lastLoud = was.lastLoud; now.holdNow = was.holdNow; if (was.ducked && now.depth !== was.depth) setDuck({ bus: now.target, db: now.depth, secs: 0.1, range: now.range }); }
    else if (was.ducked) setDuck({ bus: was.target, db: 0, secs: 0.2, range: was.range });
  }
  duckRules = next;
}
/** Whether a voice with a speech map is speaking now, or will be within `ahead` s. */
function speaking(v: Voice, ahead: number) {
  const p0 = placeOf(v, 0);
  if (p0 == null) return false;
  const p1 = placeOf(v, ahead + 0.04);
  return v.speech!.some(([a, b]) => a <= p1! && b >= p0);
}
setInterval(() => {
  if (!duckRules.length) return;
  const now = ctx.currentTime, on: Record<string, Voice[]> = {};
  for (const v of voices.values()) if (v.onBus && !v.tailOf) (on[v.onBus] = on[v.onBus] || []).push(v);
  for (const r of duckRules) {
    let loud = false, hold = r.hold;
    for (const k of r.keys) {
      const b = buses[k], vs = on[k] || [];
      if (!b) continue;
      if (vs.length && vs.every((v) => Array.isArray(v.speech))) { if (vs.some((v) => speaking(v, r.attack))) { loud = true; hold = Math.min(hold, SPEECH_HOLD); } continue; }
      b.tap.getFloatTimeDomainData(duckBuf);
      let p = 0;
      for (const x of duckBuf) { const a = Math.abs(x); if (a > p) p = a; }
      if (dbOf(p) > r.threshold) { loud = true; hold = r.hold; }
    }
    if (loud) {
      r.lastLoud = now; r.holdNow = hold;
      if (!r.ducked) { r.ducked = true; setDuck({ bus: r.target, db: r.depth, secs: r.attack, range: r.range }); }
    } else if (r.ducked && now - r.lastLoud > r.holdNow) { r.ducked = false; setDuck({ bus: r.target, db: 0, secs: r.release, range: r.range }); }
  }
}, 33);

/** The master fader (dB), and the safety limiter in or out. */
function setMasterDb({ db, secs }: Cmd<'masterDb'>) { for (const p of pairs) if (p) ramp(p.master.gain, Number(db) || 0, secs == null ? 0.03 : secs); }
function setLimiter({ on }: Cmd<'limiter'>) { for (const p of pairs) if (p) { p.limiter.threshold.value = on === false ? 0 : -0.3; p.limiter.ratio.value = on === false ? 1 : 20; } }

/** The smoke run's muted play: everything still runs, nothing is heard. */
function setMaster({ gain }: Cmd<'master'>) {
  if (typeof gain === 'number') for (const p of pairs) if (p) p.master.gain.value = gain;
}

function stopAll() { for (const key of [...voices.keys()]) drop(key); for (const key of [...ltcOut.keys()]) ltc({ key, on: false }); }

// Recording the show (not yet wired to the app; the host will write the file): what the main outputs get, after the limiter, as 16-bit
// stereo, a quarter of a second at a time. The tap is a worklet so the audio thread does the copying; it plays
// nothing (its way to the output is a gain of 0, there only so the graph runs it).
const REC_WORKLET = `registerProcessor('ec-rec', class extends AudioWorkletProcessor {
  constructor() { super(); this.n = Math.round(sampleRate / 4); this.buf = new Int16Array(this.n * 2); this.at = 0; this.on = true;
    this.port.onmessage = () => { this.on = false; }; }
  process(inputs) {
    if (!this.on) return false;
    const inp = inputs[0] || [], l = inp[0], r = inp[1] || inp[0], b = this.buf;
    for (let i = 0; i < 128; i++) {
      const x = l ? l[i] : 0, y = r ? r[i] : 0;          // nothing playing: silence, so the file keeps time
      b[this.at++] = Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
      b[this.at++] = Math.max(-32768, Math.min(32767, Math.round(y * 32767)));
      if (this.at >= b.length) { const out = b.slice(); this.port.postMessage(out, [out.buffer]); this.at = 0; }
    }
    return true;
  }
});`;
let rec: { node: AudioWorkletNode; mute: GainNode } | null = null, recModule: Promise<void> | null = null;
async function record({ on }: Cmd<'record'>) {
  if (rec) { rec.node.port.postMessage('stop'); try { limiter.disconnect(rec.node); rec.node.disconnect(); rec.mute.disconnect(); } catch { /* gone */ } rec = null; }
  if (!on) return;
  if (!recModule) recModule = ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([REC_WORKLET], { type: 'application/javascript' })));
  await recModule;
  const node = new AudioWorkletNode(ctx, 'ec-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.port.onmessage = (e) => window.cueAudio.report({ type: 'rec', rate: ctx.sampleRate, at: Date.now(), pcm: new Uint8Array(e.data.buffer) });
  limiter.connect(node);
  node.connect(mute).connect(ctx.destination);
  rec = { node, mute };
  window.cueAudio.report({ type: 'recording', rate: ctx.sampleRate });
}

// ── MIDI ──────────────────────────────────────────────────────────────────
let midiAccess: MIDIAccess | null = null;
// The clock this window shares with the host is the wall clock (a moment as milliseconds since 1970). Its own steady
// clock, performance.now(), is what Web MIDI and the audio clock are read against, and it can fall behind the wall:
// MEASURED, a computer that slept for 13 s left this window's clock 13 s behind the host's (Chromium's does not
// count sleep, Node's does), and timecode went out 13 s wrong until the app was restarted. So how far the steady
// clock is from the wall is kept, looked at every second, and taken up again only when it has moved by more
// than a frame's worth: between such moments the two are a fixed distance apart, with none of Date.now()'s grain.
let wallOff = Date.now() - (performance.timeOrigin + performance.now());
setInterval(() => { const o = Date.now() - (performance.timeOrigin + performance.now()); if (Math.abs(o - wallOff) > 20) wallOff = o; }, 1000);
const wallOfPerf = (p: number) => performance.timeOrigin + p + wallOff;       // a performance.now() reading, as the wall's ms
const perfOfWall = (ms: number) => ms - performance.timeOrigin - wallOff;     // and back
function midiPorts(error = '') {
  const names = (m: MIDIInputMap | MIDIOutputMap | null) => (m ? [...m.values()].filter((p) => p.state !== 'disconnected').map((p) => p.name || p.id) : []);
  window.cueAudio.report({ type: 'midi-ports', inputs: names(midiAccess && midiAccess.inputs), outputs: names(midiAccess && midiAccess.outputs), error });
}
async function midiOpen() {
  if (SILENT || !navigator.requestMIDIAccess) { midiPorts(SILENT ? '' : 'this computer has no MIDI'); return; }
  try { midiAccess = await navigator.requestMIDIAccess({ sysex: true }); } catch (err) { midiPorts(`MIDI is not available: ${(err as Error).message || err}`); return; }
  const hook = () => {
    for (const input of midiAccess!.inputs.values()) input.onmidimessage = (e) => window.cueAudio.report({ type: 'midi-in', port: input.name || input.id, bytes: [...e.data!], at: wallOfPerf(e.timeStamp || performance.now()) });
    midiPorts();
  };
  midiAccess.onstatechange = hook;
  hook();
}
/** Send to the output named, or to every output when none is. `events`: messages each stamped with the time it
 *  is due (`at`, milliseconds since 1970 on the clock this window shares with the host); the MIDI system sends
 *  each at its time, or at once if that has passed. */
function midiSend({ bytes, port, events }: Cmd<'midi'>) {
  if (!midiAccess) throw new Error('MIDI is not open');
  const outs = [...midiAccess.outputs.values()].filter((o) => o.state !== 'disconnected' && (!port || (o.name || o.id) === port));
  if (!outs.length) throw new Error(port ? `no MIDI output named ${port}` : 'no MIDI output');
  if (!events) { for (const o of outs) o.send(bytes!); return; }
  for (const e of events) { const when = perfOfWall(e.at); for (const o of outs) o.send(e.bytes, when); }
}

// ── LTC ───────────────────────────────────────────────────────────────────
// Out: one worklet per running Timecode cue, writing the signal a block at a time and to the sample (so the frames
// are as steady as the audio device's own clock, which is the clock the device reading them hears). In: one
// worklet reading an input, reporting each frame as its last bit ends.
const LTC_WORKLET = `const Timecode = ${Timecode.SOURCE};
registerProcessor('ec-ltc-out', class extends AudioWorkletProcessor {
  constructor(o) { super(); const p = o.processorOptions; this.on = true; this.w = new Timecode.LtcWriter({ rate: p.rate, sampleRate, start: p.frames + (currentTime - p.at) * Timecode.rateOf(p.rate).real, level: p.level }); this.port.onmessage = () => { this.on = false; }; }
  process(_inputs, outputs) { if (!this.on) return false; const out = outputs[0][0]; if (out) this.w.render(out); return true; }
});
registerProcessor('ec-ltc-in', class extends AudioWorkletProcessor {
  constructor() { super(); this.on = true; this.r = new Timecode.LtcReader({ sampleRate }); this.n = 0; this.port.onmessage = () => { this.on = false; }; }
  process(inputs) {
    if (!this.on) return false;
    const inp = inputs[0] && inputs[0][0];
    if (inp) { for (const f of this.r.feed(inp)) this.port.postMessage({ tc: f.tc, rate: f.rate, at: currentTime + (f.end - this.n) / sampleRate }); this.n += inp.length; }
    return true;
  }
});`;
let ltcModule: Promise<void> | null = null;
const ltcReady = () => (ltcModule = ltcModule || ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([LTC_WORKLET], { type: 'application/javascript' }))));
type LtcStream = { id: number; node: AudioWorkletNode; gain: GainNode; channel: number };
const ltcOut = new Map<string, LtcStream>();          // key -> { id, node, gain, channel }
const ltcGone: LtcStream[] = [];                // streams stopped since the outputs were last laid out: still to be taken off them
let ltcSeq = 0;
/** A moment of the audio clock (ctx.currentTime) as the shared clock's milliseconds, and back. */
const epochOfCtx = (t: number) => wallOfPerf(performance.now()) + (t - ctx.currentTime) * 1000;
const ctxOfEpoch = (ms: number) => ctx.currentTime + (perfOfWall(ms) - performance.now()) / 1000;
/** A Timecode cue's LTC: on (where the timecode was, in frames, at the moment `at`) or off. */
async function ltc({ key, on, rate, frames, at, channel, db }: Cmd<'ltc'>) {
  const old = ltcOut.get(key);
  if (old) { ltcOut.delete(key); old.node.port.postMessage('stop'); try { old.node.disconnect(); } catch { /* gone */ } ltcGone.push(old); if (ltcIn && ltcIn.tap === old.gain) ltcTap(); }
  if (!on) { route(); return; }
  await ltcReady();
  ctx.resume();
  const ch = Math.max(1, Math.round(Number(channel) || 1)) - 1;
  const node = new AudioWorkletNode(ctx, 'ec-ltc-out', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { rate, frames, at: ctxOfEpoch(at!), level: toLin(Number.isFinite(db) ? Math.min(0, db!) : -12) } });
  const gain = ctx.createGain();
  gain.channelCount = 1; gain.channelCountMode = 'explicit';
  node.connect(gain);
  ltcOut.set(key, { id: ++ltcSeq, node, gain, channel: ch });
  route();
  if (ch >= maxOuts()) window.cueAudio.report({ type: 'ltc', key, ok: false, detail: `this audio device has no output ${ch + 1} (it has ${maxOuts()})` });
  else window.cueAudio.report({ type: 'ltc', key, ok: true });
  if (SILENT) ltcTap();
}
// LTC in. A test run opens no input: it listens to the LTC this window is itself sending instead, which is how
// the whole path (made here, read here, chased by the host) is checked with nothing plugged in.
type LtcIn = { node: AudioWorkletNode; mute: GainNode; stream: MediaStream | null; src: MediaStreamAudioSourceNode | null; split: ChannelSplitterNode | null; tap: GainNode | null };
let ltcIn: LtcIn | null = null;                  // { node, mute, stream, src, split, tap }
function ltcTap() {
  if (!ltcIn || !SILENT) return;
  if (ltcIn.tap) { try { ltcIn.tap.disconnect(ltcIn.node); } catch { /* gone */ } ltcIn.tap = null; }
  const first = [...ltcOut.values()][0];
  if (first) { first.gain.connect(ltcIn.node); ltcIn.tap = first.gain; }
}
async function ltcListen({ on, input, channel }: Cmd<'ltc-in'>) {
  if (ltcIn) { const l = ltcIn; ltcIn = null; l.node.port.postMessage('stop'); try { if (l.stream) for (const t of l.stream.getTracks()) t.stop(); if (l.src) l.src.disconnect(); if (l.split) l.split.disconnect(); if (l.tap) l.tap.disconnect(l.node); l.node.disconnect(); l.mute.disconnect(); } catch { /* gone */ } }
  if (!on) return;
  await ltcReady();
  const node = new AudioWorkletNode(ctx, 'ec-ltc-in', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
  const mute = ctx.createGain();
  mute.gain.value = 0;                     // it plays nothing: its way to the output is there only so the graph runs it
  node.connect(mute).connect(ctx.destination);
  node.port.onmessage = (e) => window.cueAudio.report({ type: 'tc-in', frame: { tc: e.data.tc, rate: e.data.rate }, at: epochOfCtx(e.data.at) });
  const mine: LtcIn = ltcIn = { node, mute, stream: null, src: null, split: null, tap: null };
  ctx.resume();
  if (SILENT) { ltcTap(); window.cueAudio.report({ type: 'ltc-in', ok: true }); return; }
  try {
    let deviceId: { exact: string } | undefined;
    if (input) {
      const found = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'audioinput' && (d.label === input || d.deviceId === input));
      if (!found) throw new Error(`there is no input named ${input}`);
      deviceId = { exact: found.deviceId };
    }
    const ch = Math.max(1, Math.round(Number(channel) || 1));
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: Math.max(2, ch) } } });
    if (ltcIn !== mine) { for (const t of stream.getTracks()) t.stop(); return; }      // changed while it was opening
    mine.stream = stream;
    mine.src = ctx.createMediaStreamSource(stream);
    const have = mine.src.channelCount || 1;
    if (have > 1) { mine.split = ctx.createChannelSplitter(have); mine.src.connect(mine.split); mine.split.connect(node, Math.min(ch, have) - 1); } else mine.src.connect(node);
    window.cueAudio.report({ type: 'ltc-in', ok: true });
    devices();
  } catch (err) { window.cueAudio.report({ type: 'ltc-in', ok: false, detail: String((err as Error).message || err) }); }
}

const ops: { [K in import('./preload').AudioOp]?: (cmd: Cmd<K>) => unknown } = { design: setDesign, lanes: setLanes, sweep, ir, ltc, 'ltc-in': ltcListen, rate: setRate, others, outputs: setOutputs, fx: setFx, ducker: setDucker, midi: midiSend, record, monitor: setMonitor, play, move, fade, cut, stop, pause, resume, seek, loop: setLoop, region: setRegion, decode, keep, peaks, pcm, probe, devices, sink, stopAll, master: setMaster, bus: setBus, buses: setBuses, strips: setStrips, duck: setDuck, masterDb: setMasterDb, limiter: setLimiter };
// A command that throws is said (the cue log), never lost in a window nobody can see.
window.cueAudio.onCmd((cmd) => {
  // (each op's handler takes its own command: `cmd.op` is what chose it)
  const f = ops[cmd.op] as ((cmd: import('./preload').AudioCommand) => unknown) | undefined;
  if (!f) return;
  try {
    const p = f(cmd) as Promise<unknown> | undefined;
    if (p && p.catch) p.catch((err) => window.cueAudio.report({ type: 'operror', op: cmd.op, key: (cmd as { key?: string }).key || '', detail: String(err) }));
  } catch (err) { window.cueAudio.report({ type: 'operror', op: cmd.op, key: (cmd as { key?: string }).key || '', detail: String(err) }); }
});
// Where a streamed sound is in its file, and when that was read (this computer's clock): a video's picture, in
// the stage window, is kept in step with its sound by this.
function where({ keys }: Cmd<'where'>) {
  for (const key of keys || []) {
    const v = voices.get(key);
    if (v && v.el && !v.el.paused && v.el.readyState >= 2) window.cueAudio.report({ type: 'where', key, t: v.el.currentTime, at: Date.now() });
  }
}
ops.where = where;
navigator.mediaDevices.addEventListener('devicechange', devices);
// The output going away under the sound (the interface's USB cable): the context says so, or stops.
// The host hears both.
ctx.addEventListener('error', () => { window.cueAudio.report({ type: 'ctx', state: ctx.state, error: true }); devices(); });
ctx.addEventListener('statechange', () => window.cueAudio.report({ type: 'ctx', state: ctx.state }));

// Each output's own level (a pair's meter cannot tell its left from its right, and a sound may go to one of them):
// read where the pair's meter is, before its master, and said only when it changes.
let outChSaid = '';
function outChannels() {
  const ch: number[] = [];
  pairs.forEach((p, k) => {
    if (!p) { ch[2 * k] = ch[2 * k + 1] = -60; return; }
    if (!p.chTaps) { const sp = ctx.createChannelSplitter(2); p.inp.connect(sp); p.chTaps = [0, 1].map((i) => { const a = ctx.createAnalyser(); a.fftSize = 1024; sp.connect(a, i); return a; }); }
    p.chTaps.forEach((a, i) => { a.getFloatTimeDomainData(buf); let q = 0; for (const x of buf) q = Math.max(q, Math.abs(x)); ch[2 * k + i] = Math.round(dbOf(q)); });
  });
  const said = ch.join(',');
  if (said !== outChSaid) { outChSaid = said; window.cueAudio.report({ type: 'outch', ch }); }
}
// The meter, 15 times a second: the master's peak (the pre-show check reads
// it), and each channel's peak and RMS for the mixer's level meter.
const buf = new Float32Array(meter.fftSize);
const chBuf = new Float32Array(2048);
const cueBuf = new Float32Array(256);
const dbOf = (x: number) => (x > 0 ? Math.max(-60, 20 * Math.log10(x)) : -60);
setInterval(() => {
  meter.getFloatTimeDomainData(buf);
  let peak = 0;
  for (const s of buf) peak = Math.max(peak, Math.abs(s));
  const channels = chMeters.map((a) => {
    a.getFloatTimeDomainData(chBuf);
    let p = 0, sum = 0;
    for (const s of chBuf) { const v = Math.abs(s); if (v > p) p = v; sum += s * s; }
    return { peak: Math.round(dbOf(p) * 10) / 10, rms: Math.round(dbOf(Math.sqrt(sum / chBuf.length)) * 10) / 10 };
  });
  const busPeaks: Record<string, number> = {};
  for (const [name, b] of Object.entries(buses)) {
    b.tap.getFloatTimeDomainData(buf);
    let p = 0;
    for (const x of buf) p = Math.max(p, Math.abs(x));
    busPeaks[name] = Math.round(dbOf(p) * 10) / 10;
  }
  outChannels();
  // each sound's own level, after its fader (the cue list's meter on its row: a sound playing but silent shows no
  // bar). A small tap, made the first time it is read and gone with the voice's band.
  const cues: Record<string, number> = {};
  for (const [key, v] of voices) {
    if (!v.band) continue;
    if (!v.tap) { v.tap = ctx.createAnalyser(); v.tap.fftSize = 256; v.band.connect(v.tap); }
    v.tap.getFloatTimeDomainData(cueBuf);
    let q = 0;
    for (const x of cueBuf) q = Math.max(q, Math.abs(x));
    cues[key] = Math.round(dbOf(q));
  }
  const outs = pairs.map((p) => { if (!p) return -60; p.tap.getFloatTimeDomainData(buf); let q = 0; for (const x of buf) q = Math.max(q, Math.abs(x)); return Math.round(dbOf(q) * 10) / 10; });
  let mon = null;
  if (monitor.on && monitor.tap) { monitor.tap.getFloatTimeDomainData(buf); let q = 0; for (const x of buf) q = Math.max(q, Math.abs(x)); mon = Math.round(dbOf(q) * 10) / 10; }
  window.cueAudio.report({ type: 'level', monitor: mon, ducking: duckRules.some((r) => r.ducked), ducked: duckRules.filter((r) => r.ducked).map((r) => r.target), db: dbOf(peak), channels, buses: busPeaks, outs, cues, voices: voices.size, limiting: limiter.reduction < -0.5 });
}, 66);

window.cueAudio.report({ type: 'ready' });
devices();
midiOpen();
