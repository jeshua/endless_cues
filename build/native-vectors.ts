/**
 * Writes native/audio/tests/vectors.json: what core/audio/curves.ts and core/audio/lanes.ts give at many points, so
 * the native engine's own tests (native/audio/tests/vectors.rs) hold its arithmetic to the same answers:
 *
 *   npm run native:vectors      after a change to a fade shape, the Volume or Pan line, or panGains
 *
 * Each entry is the arguments and the answer. Times are on a 48 kHz grid (a whole number of samples), so the
 * engine's renderer can be read at exactly those places.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as Curves from '../core/audio/curves';
import * as Lanes from '../core/audio/lanes';
import type { LanePoint } from '../core/show/types';

const xs = Array.from({ length: 41 }, (_, i) => i / 40).concat([0.013, 0.333, 0.5005, 0.987]);
const shapes: { name: string; shape: Curves.FadeShape | 'linear' }[] = [
  { name: 'linear', shape: 'linear' },
  { name: 's-curve', shape: 's-curve' },
  { name: 'custom', shape: [[0, 0], [0.2, 0.6], [0.7, 0.8], [1, 1]] },
  { name: 'custom-step', shape: [[0, 0], [0.5, 0], [0.5, 1], [1, 1]] },
];

// A fade as the audio window plays it: from `from` dB to `to` dB, `progressOf` the shape read at x (audio.ts `fade`).
const along = (shape: number[], x: number) => { const f = x * (shape.length - 1), i = Math.min(shape.length - 2, Math.floor(f)); return shape[i] + (shape[i + 1] - shape[i]) * (f - i); };
const toLin = (db: number) => (db <= -60 ? 0 : Math.pow(10, db / 20));

const envelopes: { name: string; pts: LanePoint[] }[] = [
  { name: 'straight', pts: [[0.5, -12], [1.5, 0], [2, 6]] },
  { name: 'bent', pts: [[0, 0, 0.6], [1, -24, -0.4], [2, 3], [2.5, -60]] },
  { name: 'one point', pts: [[1, -6]] },
];
const pans: { name: string; pts: LanePoint[] }[] = [
  { name: 'sweep', pts: [[0, -100], [2, 100]] },
  { name: 'bent', pts: [[0.25, 30, 0.8], [1.25, -70, -1], [2.25, 0]] },
];
const ts = Array.from({ length: 64 }, (_, i) => (i * 1440) / 48000);         // every 30 ms, on the sample grid

const out = {
  written: 'by build/native-vectors.ts (npm run native:vectors); do not edit',
  shapeAt: shapes.map((s) => ({ name: s.name, shape: s.shape, xs, ys: xs.map((x) => Curves.shapeAt(s.shape, x)) })),
  progressOf: shapes.flatMap((s) => [0, 0.3].map((from) => ({ name: s.name, from, shape: s.shape, values: Curves.progressOf(s.shape, 65, from) }))),
  fades: shapes.map((s) => {
    const p = Curves.progressOf(s.shape, 65);
    return { name: s.name, from: 0, to: -30, progress: p, xs, gains: xs.map((x) => toLin(0 + (-30 - 0) * along(p, x))) };
  }),
  bend: [-1, -0.5, 0, 0.3, 1].map((c) => ({ c, xs, ys: xs.map((x) => Lanes.bend(x, c)) })),
  envelopeAt: envelopes.map((e) => ({ name: e.name, pts: e.pts, ts, dbs: ts.map((t) => Lanes.envelopeAt(e.pts, t)), gains: ts.map((t) => toLin(Lanes.envelopeAt(e.pts, t))) })),
  panLine: pans.map((p) => ({ name: p.name, pts: p.pts, ts, values: ts.map((t) => Lanes.valueAt(p.pts, t, Lanes.PAN)), gains: ts.map((t) => Lanes.panGains(Lanes.valueAt(p.pts, t, Lanes.PAN))) })),
  panGains: Array.from({ length: 41 }, (_, i) => -100 + i * 5).concat([-33.3, 12.5, 99.9]).map((p) => ({ pan: p, gains: Lanes.panGains(p) })),
  wrap: [[0.5, null, 0], [3.2, { start: 1, end: 2 }, 0], [2, { start: 1, end: 2 }, 0], [7.5, null, 3], [1.99, { start: 1, end: 2 }, 3]].map(([u, region, whole]) => ({ u, region, whole, value: Lanes.wrap(u as number, region as { start: number; end: number } | null, whole as number) })),
};

const file = path.join(__dirname, '..', 'native', 'audio', 'tests', 'vectors.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${path.relative(process.cwd(), file)}`);
