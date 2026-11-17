#!/usr/bin/env node
/**
 * Makes the demo show: a small show that uses most of what Endless Cues does,
 * with sounds synthesised here so the repository ships no media.
 *
 *   node examples/make-demo.js [folder]        default: ./examples/Demo.ecshow
 *
 * Also used by the app (File ▸ Open the Demo Show) and by the smoke test.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as show from '../core/show/show';
import { applyOps } from '../core/show/ops';

const RATE = 44100;

function writeWav(file: string, left: Float32Array, right = left) {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  const s16 = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < n; i++) { buf.writeInt16LE(s16(left[i]), 44 + i * 4); buf.writeInt16LE(s16(right[i]), 46 + i * 4); }
  fs.writeFileSync(file, buf);
}

// a small deterministic noise source, so the files are the same every time
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; }; }
const TAU = Math.PI * 2;

/** The underscore: 16 bars at 120 bpm, a pad that changes chord every 4 bars over a soft pulse. Loops cleanly per 4 bars. */
function underscore() {
  const bpm = 120, beat = 60 / bpm, bars = 16, secs = bars * 4 * beat, n = Math.round(secs * RATE);
  const L = new Float32Array(n), R = new Float32Array(n);
  const chords = [[110, 164.81, 220, 261.63], [98, 146.83, 196, 246.94], [87.31, 130.81, 174.61, 220], [103.83, 155.56, 207.65, 261.63]];
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const bar = Math.floor(t / (4 * beat));
    const ch = chords[Math.floor(bar / 4) % 4];
    const inBar = (t % (4 * beat));
    const inSection = t % (16 * beat);
    // the pad breathes with the section, and is silent for an instant at each section edge so a loop there is clean
    const edge = Math.min(1, inSection / 0.02, (16 * beat - inSection) / 0.02);
    let pad = 0;
    for (const [k, f] of ch.entries()) pad += Math.sin(TAU * f * t + k) * 0.5 + Math.sin(TAU * f * 2.003 * t) * 0.12;
    pad *= 0.09 * (0.75 + 0.25 * Math.sin(TAU * t / (8 * beat))) * edge;
    const bt = t % beat;
    const kick = Math.sin(TAU * (48 + 60 * Math.exp(-bt * 30)) * bt) * Math.exp(-bt * 9) * 0.38;
    const tick = (Math.floor(inBar / beat) % 2 === 1) ? Math.sin(TAU * 1800 * bt) * Math.exp(-bt * 70) * 0.05 : 0;
    L[i] = pad + kick + tick; R[i] = pad * 0.96 + kick + tick * 0.6;
  }
  const beats = [], downbeats = [];
  for (let b = 0; b < bars * 4; b++) { beats.push(+(b * beat).toFixed(4)); if (b % 4 === 0) downbeats.push(+(b * beat).toFixed(4)); }
  const sec = 16 * beat;
  return { L, R, secs, beats, downbeats,
    loops: [0, 1, 2, 3].map((k) => ({ start: k * sec, end: (k + 1) * sec, bars: 4, name: `Section ${'ABCD'[k]}` })),
    markers: [0, 1, 2, 3].map((k) => ({ at: k * sec, name: `Section ${'ABCD'[k]}` })) };
}

function rain(secs = 12) {
  const n = Math.round(secs * RATE), L = new Float32Array(n), R = new Float32Array(n), a = rng(7), b = rng(11);
  let l1 = 0, r1 = 0, l2 = 0, r2 = 0;
  for (let i = 0; i < n; i++) {
    l1 += 0.25 * (a() - l1); r1 += 0.25 * (b() - r1);           // soften the top
    l2 += 0.002 * (l1 - l2); r2 += 0.002 * (r1 - r2);           // and take the rumble out
    const fade = Math.min(1, i / (0.5 * RATE), (n - i) / (0.5 * RATE));
    L[i] = (l1 - l2) * 0.22 * fade; R[i] = (r1 - r2) * 0.22 * fade;
  }
  return { L, R };
}

function thunder(secs = 6) {
  const n = Math.round(secs * RATE), L = new Float32Array(n), R = new Float32Array(n), a = rng(3);
  let low = 0, lower = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    low += 0.02 * (a() - low); lower += 0.004 * (low - lower);
    const env = Math.min(1, t / 0.03) * Math.exp(-t * 0.7) * (1 + 0.6 * Math.sin(TAU * 2.2 * t) * Math.exp(-t));
    const crack = t < 0.25 ? a() * Math.exp(-t * 18) * 0.5 : 0;
    const v = (low * 5 + lower * 14) * env * 0.5 + crack;
    L[i] = v; R[i] = v * 0.9;
  }
  return { L, R };
}

function bell(secs = 4, f = 660) {
  const n = Math.round(secs * RATE), L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const v = (Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * f * 2.76 * t) * Math.exp(-t * 3) + 0.25 * Math.sin(TAU * f * 5.4 * t) * Math.exp(-t * 6)) * Math.exp(-t * 1.3) * 0.3 * Math.min(1, t / 0.002);
    L[i] = v; R[i] = v;
  }
  return { L, R };
}

function makeDemo(dir: string) {
  const media = path.join(dir, 'media');
  fs.mkdirSync(media, { recursive: true });
  const u = underscore();
  writeWav(path.join(media, 'underscore.wav'), u.L, u.R);
  const r = rain(); writeWav(path.join(media, 'rain.wav'), r.L, r.R);
  const th = thunder(); writeWav(path.join(media, 'thunder.wav'), th.L, th.R);
  const be = bell(); writeWav(path.join(media, 'bell.wav'), be.L, be.R);

  let doc = show.newShow('Demo show');
  doc.notes = 'A small show that uses most of what Endless Cues does. Press Space.';
  doc.settings.network.patches = [{ id: 'desk', name: 'Lighting desk (example)', host: '127.0.0.1', port: 8000 }];
  doc = applyOps(doc, [
    { op: 'cue.add', ref: 'pre', cue: { type: 'audio', number: '1', name: 'Preshow underscore', file: 'media/underscore.wav', bus: 'music', gainDb: -8, loop: true, fadeIn: 3,
      notes: 'House open. The underscore loops until Scene 1.', color: 'blue', markers: u.markers, loops: u.loops, beats: u.beats, downbeats: u.downbeats } },
    { op: 'cue.add', cue: { type: 'light', number: 'LQ1', name: 'House to half', lightCue: '1' } },
    { op: 'cue.add', ref: 's1', cue: { type: 'group', number: '2', name: 'Scene 1 — the storm arrives', fadeOthers: 4, color: 'green',
      notes: 'One GO: the preshow fades out, rain in, a bell two seconds later, and the desk is told.',
      children: [
        { type: 'audio', ref: 'rain', name: 'Rain', file: 'media/rain.wav', bus: 'effects', gainDb: -6, loop: true, fadeIn: 2 },
        { type: 'audio', name: 'Bell', file: 'media/bell.wav', bus: 'effects', gainDb: -4, preWait: 2 },
        { type: 'network', name: 'Desk: storm look', patch: 'desk', message: '/eos/cue/1/2/fire' },
      ] } },
    { op: 'cue.add', cue: { type: 'group', number: '3', name: 'Thunder (rain ducks under it)', color: 'orange',
      notes: 'On “…and the sky answered.”',
      children: [
        { type: 'audio', ref: 'th', name: 'Thunder', file: 'media/thunder.wav', bus: 'effects', gainDb: 0 },
        { type: 'fade', name: 'Rain dips', target: '@rain', db: -10, duration: 0.4, relative: true },
        { type: 'fade', name: 'Rain returns', target: '@rain', db: 0, duration: 2.5, relative: true, preWait: 4 },
      ] } },
    { op: 'cue.add', cue: { type: 'wait', number: '4', name: 'Beat', duration: 1.5, continue: 'auto-follow' } },
    { op: 'cue.add', cue: { type: 'audio', number: '5', name: 'Bell (follows the beat)', file: 'media/bell.wav', bus: 'effects', gainDb: -8 } },
    { op: 'cue.add', cue: { type: 'fade', number: '6', name: 'Rain out', target: '@rain', db: -60, duration: 6, stopTarget: true } },
    { op: 'cue.add', cue: { type: 'memo', number: '7', name: 'Interval', color: 'grey', notes: '15 minutes.' } },
    { op: 'cue.add', ref: 'under', cue: { type: 'audio', number: '8', name: 'Act 2 underscore', file: 'media/underscore.wav', bus: 'music', gainDb: -6, color: 'blue',
      notes: 'Hold it in a section from the loop lane if the scene runs long.', markers: u.markers, loops: u.loops, beats: u.beats, downbeats: u.downbeats, fadeOut: 4 } },
    { op: 'cue.add', cue: { type: 'group', number: '9', name: 'Bell on the next bar', onBeat: 'bar', notes: 'Quantised: waits for the underscore’s next downbeat.',
      children: [{ type: 'audio', name: 'Bell', file: 'media/bell.wav', bus: 'effects', gainDb: -6 }] } },
    { op: 'cue.add', cue: { type: 'group', number: '10', name: 'Blackout', fadeOthers: 3, color: 'red', children: [{ type: 'light', name: 'Blackout', lightCue: '99' }] } },
  ]).doc;
  fs.writeFileSync(path.join(dir, 'show.json'), show.stringify(doc));
  return dir;
}

export { makeDemo, writeWav };

if (require.main === module) {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, 'Demo.ecshow'));
  makeDemo(dir);
  console.log(`Demo show written to ${dir}`);
}
