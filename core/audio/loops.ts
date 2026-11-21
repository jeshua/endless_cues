/**
 * Finding the stretches of a track that go round cleanly: loop regions to hold a track in, offered when a person
 * asks (Time & Loops ▸ Find loops), never by themselves.
 *
 *   findLoops(samples, rate, { tempo, from, to, max }) → [{ start, end, bars?, score }]   in time order
 *   seamOf(samples, rate, start, end)                   → 0–1: how seamless one region is
 *
 * A loop [start, end) is played by jumping back from `end` to `start`. It sounds seamless when what comes after
 * `start` is what would have come after `end` anyway, and what leads up to `end` is what led up to `start`: so each
 * candidate is scored by how alike the sound is on both sides of its two ends (the harmony, as twelve pitch classes,
 * and the colour, as the energy in six bands, a beat either side), and by how alike the two ends are in level.
 *
 * With a tempo, the candidates are whole bars (2, 4, 8 or 16, and six seconds at least: a shorter loop is heard as a
 * repeat) from a bar line to a bar line; without one, stretches of 4, 8 or 16 seconds from any quarter second. What
 * is offered is spread over the track: it is cut into as many stretches as loops are wanted, and each gives its best
 * (a longer one preferred when it scores about as well); two loops never overlap by more than a quarter. Nothing here is a model: it is
 * arithmetic on the sound, and a track with no repetition in it simply gets nothing.
 *
 * Takes mono PCM at any rate (the app sends 11 kHz, as for the tempo).
 */
import { gridOf, sectionAt } from './tempo';
import type { TempoIn } from './tempo';

/** A loop region found: where it starts and ends (seconds into the file), its length in bars (with a tempo),
 *  and how seamless it sounds, 0–1. */
export interface FoundLoop { start: number; end: number; bars?: number; score: number }
export interface FindOptions { tempo?: TempoIn | null; from?: number; to?: number | null; max?: number; minScore?: number }

const FRAME = 2048;              // at 11 kHz: 0.19 s, long enough to hear a chord's pitches
const BANDS = [0, 150, 400, 1000, 2500, 5000, Infinity];      // Hz: the six bands of colour
const MIN_SCORE = 0.85;          // under this a loop is heard as a jump
const BAR_LENGTHS = [2, 4, 8, 16], SEC_LENGTHS = [4, 8, 16];
const MIN_SECS = 6;               // a shorter loop repeats too fast not to be heard as a repeat

/** An in-place radix-2 FFT of `re`/`im` (length a power of two). */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** The sound, a frame every `hop` samples: its pitch classes (12, summing to 1), its colour (6 bands, log energy,
 *  as a unit vector) and its level in dB. */
function features(x: Float32Array, rate: number, hop: number) {
  const frames = Math.max(0, Math.floor((x.length - FRAME) / hop) + 1);
  const chroma = new Float32Array(frames * 12), colour = new Float32Array(frames * 6), level = new Float32Array(frames);
  const win = new Float64Array(FRAME); for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME);
  // each FFT bin's pitch class (bins under 55 Hz or over 4 kHz carry no pitch here), and its band
  const pc = new Int8Array(FRAME / 2), band = new Int8Array(FRAME / 2);
  for (let k = 1; k < FRAME / 2; k++) {
    const hz = (k * rate) / FRAME;
    pc[k] = hz < 55 || hz > 4000 ? -1 : ((Math.round(12 * Math.log2(hz / 440)) % 12) + 12) % 12;
    band[k] = BANDS.findIndex((b, i) => hz >= b && hz < BANDS[i + 1]);
  }
  for (let f = 0; f < frames; f++) {
    const o = f * hop;
    let e = 0;
    for (let i = 0; i < FRAME; i++) { const v = x[o + i]; re[i] = v * win[i]; im[i] = 0; e += v * v; }
    level[f] = 10 * Math.log10(e / FRAME + 1e-12);
    fft(re, im);
    const c = chroma.subarray(f * 12, f * 12 + 12), b = new Float64Array(6);
    for (let k = 1; k < FRAME / 2; k++) {
      const m = re[k] * re[k] + im[k] * im[k];
      if (pc[k] >= 0) c[pc[k]] += Math.sqrt(m);
      if (band[k] >= 0) b[band[k]] += m;
    }
    let s = 0; for (let i = 0; i < 12; i++) s += c[i];
    if (s > 0) for (let i = 0; i < 12; i++) c[i] /= s;
    let n = 0; const lb = b.map((v) => Math.log10(v + 1e-9) + 9);
    for (let i = 0; i < 6; i++) n += lb[i] * lb[i];
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < 6; i++) colour[f * 6 + i] = lb[i] / n;
  }
  return { chroma, colour, level, frames, fps: rate / hop };
}

/**
 * How seamless a jump from `end` back to `start` is: 0 (a jump) to 1 (as if it never happened). The sound a
 * window either side of each end is compared, frame for frame.
 */
function seam(F: ReturnType<typeof features>, start: number, end: number, window: number) {
  const s0 = Math.round(start * F.fps), e0 = Math.round(end * F.fps), w = Math.max(2, Math.round(window * F.fps));
  if (s0 - w < 0 || e0 + w > F.frames) return 0;
  // the lead-up (before each end) and what follows (after each), scored apart: a seam is as good as its worse side
  const side = (from: number, to: number) => {
    let harm = 0, col = 0, lev = 0, n = 0, quiet = 0;
    for (let d = from; d < to; d++) {
      const a = s0 + d, b = e0 + d;
      let h = 0, ha = 0, hb = 0;
      for (let i = 0; i < 12; i++) { const p = F.chroma[a * 12 + i], q = F.chroma[b * 12 + i]; h += p * q; ha += p * p; hb += q * q; }
      harm += ha > 0 && hb > 0 ? h / Math.sqrt(ha * hb) : 1;
      let c = 0; for (let i = 0; i < 6; i++) c += F.colour[a * 6 + i] * F.colour[b * 6 + i];
      col += c;
      lev += Math.min(1, Math.abs(F.level[a] - F.level[b]) / 12);
      if (F.level[a] < -60 && F.level[b] < -60) quiet++;
      n++;
    }
    if (quiet > n / 2) return 0;            // silence matches silence: no loop to be had there
    harm /= n; col /= n; lev /= n;
    return 0.6 * Math.pow(harm, 3) + 0.25 * Math.pow(Math.max(0, col), 4) + 0.15 * (1 - lev);
  };
  return Math.max(0, Math.min(1, Math.min(side(-w, 0), side(0, w))));
}

/** The loop regions in a track that go round most cleanly, best first (see the top of this file). */
function findLoops(samples: Float32Array, rate: number, { tempo = null, from = 0, to = null, max = 4, minScore = MIN_SCORE }: FindOptions = {}): FoundLoop[] {
  const length = samples.length / rate;
  if (!(length > 2)) return [];
  const hop = Math.max(1, Math.round(rate / 40));       // 40 frames a second
  const F = features(samples, rate, hop);
  const lo = Math.max(0, Number(from) || 0), hi = Math.min(length, to != null && Number(to) > lo ? Number(to) : length);
  const found: FoundLoop[] = [];
  if (tempo && gridOf(tempo, length).downbeats.length > 1) {
    const down = gridOf(tempo, length).downbeats;
    for (let i = 0; i < down.length; i++) {
      if (down[i] < lo) continue;
      for (const bars of BAR_LENGTHS) {
        const j = i + bars;
        if (j >= down.length || down[j] > hi || down[j] - down[i] < MIN_SECS) continue;
        const sec = sectionAt(tempo, down[i]), beat = sec ? 60 / sec.bpm : 0.5;
        const score = seam(F, down[i], down[j], beat);
        if (score >= minScore) found.push({ start: down[i], end: down[j], bars, score: Math.round(score * 1000) / 1000 });
      }
    }
  } else {
    for (let s = Math.ceil(lo * 4) / 4; s < hi; s += 0.25) for (const secs of SEC_LENGTHS) {
      if (s + secs > hi) continue;
      const score = seam(F, s, s + secs, 0.5);
      if (score >= minScore) found.push({ start: Math.round(s * 1000) / 1000, end: Math.round((s + secs) * 1000) / 1000, score: Math.round(score * 1000) / 1000 });
    }
  }
  // the track cut into `max` equal stretches, the best loop in each (a longer one preferred when it is about as
  // good), so what is offered is spread over the track rather than four of one chorus; then the best of the rest
  const worth = (g: FoundLoop) => g.score + 0.01 * Math.log2(g.end - g.start);
  found.sort((p, q) => worth(q) - worth(p));
  const kept: FoundLoop[] = [];
  const overlap = (p: FoundLoop, q: FoundLoop) => Math.max(0, Math.min(p.end, q.end) - Math.max(p.start, q.start)) / Math.min(p.end - p.start, q.end - q.start);
  const take = (g: FoundLoop) => { if (kept.length < max && !kept.some((k) => overlap(k, g) > 0.25)) kept.push(g); };
  for (let k = 0; k < max; k++) {
    const a = lo + ((hi - lo) * k) / max, b = lo + ((hi - lo) * (k + 1)) / max;
    const here = found.find((g) => (g.start + g.end) / 2 >= a && (g.start + g.end) / 2 < b && !kept.some((x) => overlap(x, g) > 0.25));
    if (here) take(here);
  }
  for (const g of found) take(g);
  return kept.sort((p, q) => p.start - q.start);
}

/** How seamless one loop [start, end) is, 0–1: the score findLoops gives, for a region drawn by hand. */
function seamOf(samples: Float32Array, rate: number, start: number, end: number, window = 0.5) {
  const hop = Math.max(1, Math.round(rate / 40));
  return Math.round(seam(features(samples, rate, hop), start, end, window) * 1000) / 1000;
}

export { findLoops, seamOf, MIN_SCORE };
