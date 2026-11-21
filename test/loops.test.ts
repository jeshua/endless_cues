import test from 'node:test';
import assert from 'node:assert/strict';
import { findLoops, seamOf } from '../core/audio/loops';

const RATE = 11025;
/** A made track at 120 bpm (a bar is 2 s): eight bars going round a two-bar pattern (a chord of A, then one of F,
 *  each with a kick on the beat), then eight bars of chords that never come back. */
function track() {
  const bar = 2, n = 16 * bar * RATE, x = new Float32Array(n);
  const chord = (hz: number[], from: number, secs: number, gain = 0.12) => { for (let i = 0; i < secs * RATE; i++) { const t = i / RATE, env = Math.min(1, t / 0.02, (secs - t) / 0.05); let v = 0; for (const f of hz) v += Math.sin(2 * Math.PI * f * t); x[Math.round(from * RATE) + i] += gain * env * v; } };
  const kick = (at: number) => { for (let i = 0; i < 0.12 * RATE; i++) { const t = i / RATE; x[Math.round(at * RATE) + i] += 0.5 * Math.exp(-t * 30) * Math.sin(2 * Math.PI * (110 - 300 * t) * t); } };
  const A = [220, 277.18, 329.63], F = [174.61, 220, 261.63];
  for (let b = 0; b < 8; b++) chord(b % 2 ? F : A, b * bar, bar);
  const later = [[246.94, 311.13, 369.99], [196, 233.08, 293.66], [207.65, 261.63, 311.13], [185, 233.08, 277.18], [164.81, 207.65, 246.94], [233.08, 293.66, 349.23], [155.56, 196, 233.08], [261.63, 329.63, 392]];
  for (let b = 8; b < 16; b++) chord(later[b - 8], b * bar, bar);
  for (let k = 0; k < 16 * 4; k++) kick(k * 0.5);
  return x;
}
const TEMPO = { bpm: 120, first: 0, bar: 4 };

test('loops are found where the track goes round, a whole number of its pattern long, and not where it does not', () => {
  const found = findLoops(track(), RATE, { tempo: TEMPO });
  assert.ok(found.length >= 1, 'something is found');
  for (const g of found) {
    assert.ok(g.end <= 16.001, `${g.start}–${g.end} stays in the part that repeats`);
    assert.equal((g.bars || 0) % 2, 0, `${g.start}–${g.end}: a whole number of the two-bar pattern`);
    assert.equal(Math.round(g.start * 1000) % 2000, 0, 'from a bar line');
    assert.ok(g.score >= 0.85 && g.score <= 1);
  }
  // two found loops never sit on top of each other
  for (const p of found) for (const q of found) if (p !== q) assert.ok(Math.min(p.end, q.end) - Math.max(p.start, q.start) <= 0.5 * Math.min(p.end - p.start, q.end - q.start));
});

test('a seam on the pattern scores high, one across it low', () => {
  const x = track();
  // round the two-bar pattern (F A F A … back to F), against a jump from F back to A, and one into the part that never comes back
  assert.ok(seamOf(x, RATE, 2, 10) > 0.95, `four bars: ${seamOf(x, RATE, 2, 10)}`);
  assert.ok(seamOf(x, RATE, 2, 8) < 0.85, `three bars: ${seamOf(x, RATE, 2, 8)}`);
  assert.ok(seamOf(x, RATE, 10, 18) < 0.85, `into the new part: ${seamOf(x, RATE, 10, 18)}`);
});

test('without a tempo, loops are found in seconds; nothing is found in silence or in a too-short sound', () => {
  const found = findLoops(track(), RATE, { tempo: null });
  assert.ok(found.length >= 1);
  for (const g of found) assert.ok(g.end <= 16.25 && Math.abs(((g.end - g.start) % 4)) < 0.01, `${g.start}–${g.end}`);
  assert.deepEqual(findLoops(new Float32Array(RATE * 20), RATE, { tempo: TEMPO }), []);
  assert.deepEqual(findLoops(new Float32Array(RATE), RATE, {}), []);
});

test('it keeps to the stretch asked about, and to the number asked for', () => {
  const found = findLoops(track(), RATE, { tempo: TEMPO, from: 4, to: 12, max: 1 });
  assert.ok(found.length <= 1);
  for (const g of found) assert.ok(g.start >= 4 && g.end <= 12);
});
