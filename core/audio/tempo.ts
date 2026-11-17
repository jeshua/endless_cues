/**
 * Finding a track's tempo, and the beat grid a tempo stands for.
 *
 *   tempoOf(samples, rate)     → { bpm, first, confidence, covers, holds, others } | null     from mono PCM (any rate; 11 kHz is plenty)
 *   tempoMap(samples, rate)    → the same, and `sections`: where the tempo changes, and to what
 *   sectionAt(tempo, t)        → the section a place in the track is in
 *   editTempo(tempo, edit)     → a tempo changed by hand (a section's bpm or bar, "1 is here", a new section)
 *   gridOf(tempo, length)      → { beats, downbeats }                   the seconds the engine quantises to
 *
 * A tempo is { bpm, first, bar }: `first` is the time of a downbeat (any one), `bar` the beats in a bar (4).
 * Beats run from it both ways at 60 / bpm. That is all a steady track needs, and it is two numbers a person can
 * read and correct, where a list of six hundred beat times is not.
 *
 * What this finds: music with a steady pulse, made to a click or a sequencer. What it cannot: rubato, a tempo
 * that changes, anything without onsets (a pad, rain, speech). It says so by returning null, and by a
 * `confidence` the caller can hold up against MIN_CONFIDENCE. It hears a pulse, not a bar: `first` is a beat,
 * and whether it is beat one of the bar is for a person to say. A track that keeps its tempo for only part of
 * its length gets one grid from tempoOf, and `holds` says where that grid fits; tempoMap goes on from there and
 * listens to the rest, so a track made in two or three tempos gets a section for each.
 *
 * A tempo with sections is { bpm, first, bar, sections: [{ from, bpm, first, bar }] }: the top is the section
 * from the start of the file, and each later one has its own tempo, its own bar line and its own beats in a bar
 * from `from` on. sectionAt says which one a place is in; gridOf lays every section's beats end to end, which
 * is all the engine reads (quantise, loops in beats, the bar counter).
 *
 * How: an onset envelope (the rise in loudness in three bands, 172 times a second); its autocorrelation picks
 * the period people would tap (60–185 bpm, preferring the middle); then every tempo within 2 % of that is
 * tried against the whole track at once (the envelope folded at that period), which is what makes the answer
 * exact enough not to drift over five minutes; a whole-number tempo wins when it fits as well. The grid is then
 * held against the onsets eight seconds at a time: that is where it holds, and it is also how half time and a
 * dotted reading are told from the beat (the faster reading wins when its beats are hit as hard).
 *
 * Measured on real tracks with known tempos and on made ones: where a track has a pulse, the right tempo is
 * the answer or one of `others` (half or double time, or a dotted reading: 76 for 114); tracks without one
 * (pads, rain, rubato, scattered hits) score under MIN_CONFIDENCE. Not told apart: a shuffle (a beat in
 * three) from the straight tempo half as fast again, and quiet music whose onsets are too soft to see.
 */
/** A beat grid: its tempo, and the time of one of its beats. */
export interface Grid { bpm: number; first: number }
/** The frames of an envelope where something starts, and how strongly. */
interface Onsets { at: Int32Array; v: Float32Array }
/** A stretch of a track that keeps one tempo. */
interface Stretch { from: number; to: number; bpm: number; first: number; confidence: number }
/** A tempo as a show might hold it, before it is cleaned: every part may be missing or wrong. */
export interface TempoIn { bpm?: unknown; first?: unknown; bar?: unknown; confidence?: unknown; sections?: unknown }
/** One section of a tempo: from where, its tempo, a bar line of it, its beats in a bar. */
export interface Section { from: number; bpm: number; first: number; bar: number }
/** A tempo as the show keeps it: the section from the start of the file, and any later ones. */
export interface TempoValue { bpm: number; first: number; bar: number; confidence?: number; sections?: Section[] }
/** A tempo edited by hand (editTempo). */
export interface TempoEdit { do: string; at?: unknown; bpm?: unknown; bar?: unknown; by?: unknown }

const MIN_CONFIDENCE = 0.14;
const HOP = 64;                  // at 11025 Hz: 172 frames a second
const WIN = 8;                   // seconds of track a grid is checked against at a time
const LIFT = 0.78;               // a faster reading is the beat when its beats are hit this hard, against the slower one's

/** The rise in loudness, frame by frame, in three bands (a kick, a snare and a hat each count): zero where
 *  nothing starts. Returns { env, fps }. */
function onsetEnvelope(x: Float32Array, rate: number) {
  const hop = Math.max(1, Math.round(HOP * rate / 11025)), win = hop * 4, fps = rate / hop;
  const n = Math.max(0, Math.floor((x.length - win) / hop));
  const a1 = 1 - Math.exp(-2 * Math.PI * 200 / rate), a2 = 1 - Math.exp(-2 * Math.PI * 2000 / rate);
  const bands = [new Float32Array(x.length), new Float32Array(x.length), new Float32Array(x.length)];
  let l1 = 0, l2 = 0;
  for (let i = 0; i < x.length; i++) { l1 += a1 * (x[i] - l1); l2 += a2 * (x[i] - l2); bands[0][i] = l1; bands[1][i] = l2 - l1; bands[2][i] = x[i] - l2; }
  const env = new Float32Array(n), amp = new Float32Array(n);
  for (const b of bands) {
    const e = new Float32Array(n);
    let mean = 0, s = 0;
    for (let k = 0; k < win; k++) s += b[k] * b[k];
    for (let i = 0; i < n; i++) {
      e[i] = s / win; mean += e[i];
      const from = i * hop;
      for (let k = 0; k < hop; k++) s += b[from + win + k] ** 2 - b[from + k] ** 2;
      if (s < 0) s = 0;
    }
    const floor = (mean / (n || 1)) * 1e-3 + 1e-12;
    // a rise of less than a sixth (in log energy, over two frames) is ripple, not an onset
    let p1 = Math.log(e[0] + floor), p2 = p1;
    let q1 = Math.sqrt(e[0]), q2 = q1;
    for (let i = 0; i < n; i++) { const L = Math.log(e[i] + floor), A = Math.sqrt(e[i]); env[i] += Math.max(0, L - p2 - 0.15); amp[i] += Math.max(0, A - q2); p2 = p1; p1 = L; q2 = q1; q1 = A; }
  }
  // less its own running mean (half a second), so a busy passage and a sparse one weigh alike
  const w = Math.max(1, Math.round(fps / 2));
  let sum = 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    sum += env[i];
    if (i >= w) sum -= env[i - w];
    out[i] = Math.max(0, env[i] - sum / Math.min(i + 1, w));
  }
  return { env: out, fps, amp };
}

/** The envelope folded at a period (in frames): how much of it lands in each of `bins` slices of the beat. */
function fold(on: Onsets, period: number, bins: number) {
  const h = new Float64Array(bins), { at, v } = on;
  for (let k = 0; k < at.length; k++) h[Math.floor(((at[k] % period) / period) * bins) % bins] += v[k];
  return h;
}
/** Only the frames of an envelope where something starts (a quarter of them, in music): { at, v }. With
 *  `windows`, only those in the windows of WIN seconds marked true. */
function onsetsOf(env: Float32Array, fps: number, windows?: boolean[]): Onsets {
  const w = Math.round(WIN * fps), last = windows ? windows.length - 1 : 0;
  let count = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > 0 && (!windows || windows[Math.min(last, Math.floor(i / w))])) count++;
  const at = new Int32Array(count), v = new Float32Array(count);
  for (let i = 0, k = 0; i < env.length; i++) if (env[i] > 0 && (!windows || windows[Math.min(last, Math.floor(i / w))])) { at[k] = i; v[k++] = env[i]; }
  return { at, v };
}
/** Where a folded envelope gathers (the tallest two slices side by side), and how much of it is there. */
function sharpness(h: Float64Array) {
  let max = 0, sum = 0, at = 0;
  for (let i = 0; i < h.length; i++) { const v = h[i] + h[(i + 1) % h.length]; sum += h[i]; if (v > max) { max = v; at = i; } }
  return { score: sum > 0 ? max / sum : 0, at };
}

/** A rough tempo made exact against the track (every tempo within 2 % of it, the envelope folded at each), and
 *  where its beat falls: { bpm, first }. */
function exactOf(on: Onsets, fps: number, rough: number): Grid {
  const score = (b: number) => sharpness(fold(on, fps * 60 / b, 48)).score;
  let best = -1, bpm = rough;
  for (let b = rough * 0.98; b <= rough * 1.02; b += 0.02) { const s = score(b); if (s > best) { best = s; bpm = b; } }
  for (let b = bpm - 0.02; b <= bpm + 0.02; b += 0.002) { const s = score(b); if (s > best) { best = s; bpm = b; } }
  // music is mostly made at a whole number: take it when it fits the track as well
  for (const round of [Math.round(bpm), Math.round(bpm * 2) / 2]) {
    const off = Math.abs(round - bpm);
    if (off < 0.3 && score(round) >= best * (off <= 0.05 ? 0.9 : 0.97)) { bpm = round; break; }
  }
  const period = fps * 60 / bpm, beat = 60 / bpm;
  const fine = fold(on, period, 96);
  const { at: bin } = sharpness(fine);
  const w0 = fine[bin], w1 = fine[(bin + 1) % 96];
  // the centre of the tallest two slices; an onset shows three frames before it is there (the window looks ahead: measured)
  const phase = ((bin + 0.5 + (w0 + w1 > 0 ? w1 / (w0 + w1) : 0)) / 96) * period / fps + 3 / fps;
  const first = Math.round((((phase % beat) + beat) % beat) * 1000) / 1000;
  return { bpm: Math.round(bpm * 100) / 100, first: first > beat - 0.004 ? 0 : first };     // a hair before the next beat is the beat
}

/** Where a grid holds: the track in windows of WIN seconds, each asked whether its onsets gather on the grid's
 *  beats. Returns { holds: [{ from, to }] (seconds), covers (0 … 1), windows (one true or false each) }. */
function holdsOf(on: Onsets, frames: number, fps: number, t: Grid) {
  const period = fps * 60 / t.bpm, f0 = t.first * fps - 3, tol = Math.min(period / 8, 0.03 * fps);
  const w = Math.round(WIN * fps), nw = Math.max(1, Math.floor(frames / w)), even = 2 * tol / period;
  const hit = new Float64Array(nw), half = new Float64Array(nw), all = new Float64Array(nw), struck = new Float64Array(nw), { at, v } = on;
  let lastBeat = NaN;
  for (let j = 0; j < at.length; j++) {
    const k = Math.min(nw - 1, Math.floor(at[j] / w)), ph = (at[j] - f0) / period, beat = Math.round(ph), d = Math.abs(ph - beat) * period;
    all[k] += v[j];
    if (d <= tol) { hit[k] += v[j]; if (beat !== lastBeat) { struck[k]++; lastBeat = beat; } } else if (period / 2 - d <= tol) half[k] += v[j];
  }
  // onsets spread evenly would put `even` of themselves on the beats, and as much on the half beats: a grid holds
  // where clearly more than that is on the beats, or on the beats and half beats together (busy music), and
  // where half the beats at least have something on them (a few stray hits that happen to land are not a pulse)
  const windows: boolean[] = [];
  for (let k = 0; k < nw; k++) {
    const beats = ((k === nw - 1 ? frames : (k + 1) * w) - k * w) / period;
    windows.push(all[k] > 0 && struck[k] >= beats / 2 && (hit[k] / all[k] >= even + 0.12 || (hit[k] + half[k]) / all[k] >= 2 * even + 0.2));
  }
  // a stretch: windows that hold, one missed window forgiven, and at least two of them (16 seconds)
  const runs: [number, number][] = [], length = frames / fps, sec = (k: number) => (k >= nw ? length : Math.min(length, k * WIN));
  for (let k = 0; k < nw; k++) {
    if (!windows[k]) continue;
    const last = runs[runs.length - 1];
    if (last && k - last[1] <= 1) last[1] = k + 1; else runs.push([k, k + 1]);
  }
  const kept = runs.filter(([a, b]) => b - a >= Math.min(2, nw));
  windows.fill(false);
  for (const [a, b] of kept) for (let k = a; k < b; k++) windows[k] = true;
  const holds = kept.map(([a, b]) => ({ from: Math.round(sec(a) * 10) / 10, to: Math.round(sec(b) * 10) / 10 }));
  let held = 0;
  for (const h of holds) held += h.to - h.from;
  return { holds, covers: Math.round(held / length * 100) / 100, windows };
}
/** What lands on a grid's beats, per beat, in each window of WIN seconds. */
function strengths(e: Float32Array, fps: number, t: Grid, nw: number) {
  const period = fps * 60 / t.bpm, f0 = t.first * fps - 3, tol = Math.round(0.02 * fps), w = Math.round(WIN * fps);
  const sum = new Float64Array(nw), beats = new Float64Array(nw);
  for (let b = f0 - Math.floor(f0 / period) * period; b < e.length; b += period) {
    const c = Math.round(b), k = Math.min(nw - 1, Math.floor(c / w));
    beats[k]++;
    for (let i = Math.max(0, c - tol); i <= c + tol && i < e.length; i++) sum[k] += e[i];
  }
  for (let k = 0; k < nw; k++) sum[k] = beats[k] ? sum[k] / beats[k] : 0;
  return sum;
}

/**
 * { bpm, first, confidence, covers, holds: [{ from, to }], others: [{ bpm, first, covers }] } | null.
 * `confidence` is how clearly the track repeats at that beat (0 … 1; under MIN_CONFIDENCE, do not trust it).
 * `holds` is where in the track the grid fits the onsets (seconds), `covers` how much of the track that is.
 * `others` are the other readings worth offering, the likeliest first: half or double time, and the dotted and
 * triplet relations a machine cannot always tell from the beat a person would tap.
 */
function tempoOf(x: Float32Array | null | undefined, rate: number, { min = 60, max = 185 } = {}) {
  if (!x || x.length < rate * 4) return null;                  // under four seconds: nothing to count
  const { env, fps, amp } = onsetEnvelope(x, rate);
  const n = env.length;
  let mean = 0;
  for (const v of env) mean += v;
  mean /= n || 1;
  if (!(mean > 0)) return null;
  // 1. how alike the envelope is to itself a lag later, for every lag up to four of the slowest beats
  const lagMin = Math.floor(fps * 60 / max), lagMax = Math.ceil(fps * 60 / min), L = lagMax * 4 + 2;
  const ac = new Float64Array(L + 1);
  const on = onsetsOf(env, fps);
  for (let a = 0, b = 0; a < on.at.length; a++) {
    while (on.at[a] - on.at[b] > L) b++;
    for (let k = b; k <= a; k++) ac[on.at[a] - on.at[k]] += on.v[a] * on.v[k];
  }
  for (let lag = 0; lag <= L; lag++) ac[lag] /= n - lag;
  const base = mean * mean, top = ac[0] - base;
  if (!(top > 0)) return null;
  const at = (lag: number) => { const i = Math.floor(lag), f = lag - i; return i >= L ? 0 : ((ac[i] * (1 - f) + ac[i + 1] * f) - base) / top; };
  const clarityAt = (lag: number) => (at(lag) + at(2 * lag) + at(3 * lag) + at(4 * lag)) / 4;
  // 2. a beat repeats at one, two, three and four of itself; a lag that is really three of something faster
  //    (a dotted or triplet reading) is marked down; people tap near 115
  type Cand = { bpm: number; clarity: number; score: number };
  type Reading = Cand & Grid & { steady: number };
  const cands: Cand[] = [];
  for (let lag = lagMin; lag <= lagMax; lag += 0.5) {
    const bpm = fps * 60 / lag;
    const clarity = clarityAt(lag);
    const prior = Math.exp(-0.5 * Math.log2(bpm / 115) ** 2);
    cands.push({ bpm, clarity, score: (clarity - 0.3 * Math.max(0, at(lag / 3))) * prior });
  }
  cands.sort((a, b) => b.score - a.score);
  const apart = (a: { bpm: number }, b: { bpm: number }) => Math.abs(Math.log2(a.bpm / b.bpm)) > 0.06;
  // (a pick has its beat and its steadiness once it is made exact, in 3. below)
  let picks: Reading[] = [];
  for (const c of cands) { if (c.score > 0 && picks.every((p) => apart(c, p))) picks.push(c as Reading); if (picks.length === 4) break; }
  if (!picks.length) return null;
  // a pulse that holds: the track is still like itself sixteen beats on (a tempo that wanders is not)
  const steadyOf = (bpm: number) => {
    const far = fps * 60 / bpm * 16;
    let steady = 0;
    for (let d = -3; d <= 3; d++) {
      const lag = Math.round(far) + d;
      if (lag >= n) break;
      let sum = 0;
      for (let i = lag; i < n; i++) sum += env[i] * env[i - lag];
      steady = Math.max(steady, (sum / (n - lag) - base) / top);
    }
    return steady;
  };
  // 3. exactly (every tempo within 2 % of a pick, against the whole track at once), and where in the track that
  //    grid holds; one that holds for part of the track is made exact again on that part alone
  const read = (t: Grid) => {
    let held = holdsOf(on, n, fps, t);
    if (held.covers > 0 && held.covers < 0.9) {
      const t2 = exactOf(onsetsOf(env, fps, held.windows), fps, t.bpm), held2 = holdsOf(on, n, fps, t2);
      if (held2.covers >= held.covers) { t = t2; held = held2; }
    }
    return { ...t, held };
  };
  // the picks whose pulse lasts come before the ones whose does not
  picks = picks.map((p) => { const t = exactOf(on, fps, p.bpm); return { ...p, ...t, steady: steadyOf(t.bpm) }; });
  picks = [...picks.filter((p) => p.steady >= 0.1), ...picks.filter((p) => p.steady < 0.1)];
  // 4. which of two related readings is the beat. The faster one (twice as fast, or half as fast again), when
  //    its beats are hit about as hard as the slower one's in most of the windows where the slower one holds:
  //    the slower is then every other beat of it, or its dotted reading. A kick on one beat and only a hat on
  //    the next is not that, and stays where it is.
  type Read = ReturnType<typeof read>;
  const lift = (t: Read) => {
    const passed: Read[] = [], nw = t.held.windows.length;
    for (let step = 0; step < 2 && t.held.covers > 0; step++) {
      const mine = [strengths(env, fps, t, nw), strengths(amp, fps, t, nw)];
      let best: { u: Read; won: number } | null = null;
      for (const m of [2, 1.5]) {
        if (t.bpm * m > max) continue;
        const u = read(exactOf(on, fps, t.bpm * m)), theirs = [strengths(env, fps, u, nw), strengths(amp, fps, u, nw)];
        let held = 0, won = 0;
        for (let k = 0; k < nw; k++) {
          if (!t.held.windows[k]) continue;
          held++;
          if (theirs[0][k] >= LIFT * mine[0][k] && theirs[1][k] >= LIFT * mine[1][k]) won++;
        }
        if (won > held / 2 && (!best || won > best.won)) best = { u, won };
      }
      if (!best) break;
      passed.push(t);
      t = best.u;
    }
    return { t, passed };
  };
  const { t: main, passed } = lift(read({ bpm: picks[0].bpm, first: picks[0].first }));
  const steady = passed.length ? steadyOf(main.bpm) : picks[0].steady;
  const confidence = steady >= 0.1 ? picks[0].clarity : Math.min(picks[0].clarity, steady);
  const others: { bpm: number; first: number; covers: number }[] = [];
  for (const o of [...passed.reverse(), ...picks.slice(1).filter((p) => p.clarity >= picks[0].clarity * 0.5).map((p) => ({ ...p, held: holdsOf(on, n, fps, p) }))]) {
    if (apart(o, main) && others.every((p) => apart(o, p))) others.push({ bpm: o.bpm, first: o.first, covers: o.held.covers });
  }
  return { bpm: main.bpm, first: main.first, confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100,
           covers: main.held.covers, holds: main.held.holds, others };
}

/** The tempo sections found in a track: tempoOf's answer for the track, and `sections`, the later stretches
 *  that keep a tempo of their own ([{ from, bpm, first, confidence }], `first` a beat at or after `from`, in
 *  seconds from the start of the file). A track with one tempo has none.
 *
 *  How: the grid tempoOf finds holds in some stretches of the track; each stretch it does not hold in (sixteen
 *  seconds or more) is listened to by itself, and so on down. Where one tempo hands over to the next is then
 *  found to the beat: the place before which the onsets sit on the first grid and after which on the second.
 *  A change it cannot hear this way (a ritardando, a tempo held for under sixteen seconds) is for a person to
 *  mark by hand. */
function tempoMap(x: Float32Array, rate: number, opts: { min?: number; max?: number } = {}) {
  const whole = tempoOf(x, rate, opts);
  if (!whole) return null;
  const length = x.length / rate;
  if (!(whole.confidence >= MIN_CONFIDENCE) || whole.covers >= 0.9 || !whole.holds.length) return { ...whole, sections: [] };
  // 1. the stretches that hold a tempo, wherever in the track they are
  const found: Stretch[] = [];
  const listen = (from: number, to: number, depth: number) => {
    if (to - from < 2 * WIN || depth > 4) return;
    const a = Math.round(from * rate), off = a / rate;
    const r = depth === 0 ? whole : tempoOf(x.subarray(a, Math.round(to * rate)), rate, opts);
    if (!r || !(r.confidence >= MIN_CONFIDENCE) || !r.holds.length) return;
    let at = from;
    for (const h of r.holds) {
      found.push({ from: off + h.from, to: Math.min(to, off + h.to), bpm: r.bpm, first: off + r.first, confidence: r.confidence });
      listen(at, off + h.from, depth + 1);
      at = off + h.to;
    }
    listen(at, to, depth + 1);
  };
  listen(0, length, 0);
  found.sort((p, q) => p.from - q.from);
  // 2. two stretches on the one grid (the same tempo, the beat still where the first would have it) are one section
  const same = (p: Stretch, q: Stretch) => {
    const beat = 60 / p.bpm, d = (q.first - p.first) / beat;
    return Math.abs(p.bpm - q.bpm) <= 0.1 && Math.abs(d - Math.round(d)) * beat < 0.04;
  };
  const parts: Stretch[] = [];
  for (const f of found) { const last = parts[parts.length - 1]; if (last && same(last, f)) last.to = f.to; else parts.push({ ...f }); }
  if (parts.length < 2) return { ...whole, sections: [] };
  // 3. where each hands over to the next: the onsets around the join, each asked which grid it sits on
  const { env, fps } = onsetEnvelope(x, rate);
  const on = (p: Stretch, i: number) => { const period = fps * 60 / p.bpm, ph = (i - (p.first * fps - 3)) / period; return Math.abs(ph - Math.round(ph)) * period <= Math.min(period / 8, 0.03 * fps) ? 1 : 0; };
  const sections: { from: number; bpm: number; first: number; confidence: number }[] = [];
  for (let k = 1; k < parts.length; k++) {
    const p = parts[k - 1], q = parts[k];
    const lo = Math.max(0, Math.round((p.to - WIN) * fps)), hi = Math.min(env.length, Math.round((q.from + WIN) * fps));
    let sum = 0, best = 0, at = lo;
    for (let i = lo; i < hi; i++) { if (env[i] > 0) sum += env[i] * (on(p, i) - on(q, i)); if (sum > best) { best = sum; at = i + 1; } }
    // the new section starts on its own first beat at or after the join (a hair before counts as at)
    const beat = 60 / q.bpm, t = (at + 3) / fps;
    const first = q.first + Math.ceil((t - q.first) / beat - 0.25) * beat;
    sections.push({ from: Math.round(first * 1000) / 1000, bpm: q.bpm, first: Math.round(first * 1000) / 1000, confidence: q.confidence });
  }
  const one = parts[0];
  return { ...whole, bpm: one.bpm, first: Math.round((((one.first % (60 / one.bpm)) + 60 / one.bpm) % (60 / one.bpm)) * 1000) / 1000, sections };
}

const okBpm = (b: unknown) => Number(b) >= 20 && Number(b) <= 400;
const barOf = (b: unknown) => Math.max(1, Math.min(16, Math.round(Number(b) || 4)));

/** A tempo as its sections in order: [{ from, bpm, first, bar }], the first from 0. `first` is a bar line of
 *  that section (any one); a later section's grid starts at its `from` and runs to the next section. */
function sectionsOf(tempo: TempoIn | null | undefined): Section[] {
  if (!tempo || !okBpm(tempo.bpm)) return [];
  const out: Section[] = [{ from: 0, bpm: Number(tempo.bpm), first: Number(tempo.first) || 0, bar: barOf(tempo.bar) }];
  for (const s of Array.isArray(tempo.sections) ? tempo.sections : []) {
    if (s && okBpm(s.bpm) && Number(s.from) > 0) out.push({ from: Number(s.from), bpm: Number(s.bpm), first: Number.isFinite(Number(s.first)) ? Number(s.first) : Number(s.from), bar: barOf(s.bar) });
  }
  return out.sort((a, b) => a.from - b.from);
}
/** The section a place in the track is in: { index, from, to, bpm, first, bar } (`to`: Infinity for the last). */
function sectionAt(tempo: TempoIn | null | undefined, t: number) {
  const all = sectionsOf(tempo);
  if (!all.length) return null;
  let i = 0;
  while (i + 1 < all.length && all[i + 1].from <= t + 1e-6) i++;
  return { index: i, ...all[i], to: i + 1 < all.length ? all[i + 1].from : Infinity };
}

/** Every beat and every bar line of a tempo, from the start of the file to `length` seconds: each section's
 *  own grid, from where it begins to where the next one does. */
function gridOf(tempo: TempoIn | null | undefined, length: number) {
  const all = sectionsOf(tempo);
  if (!all.length || !(length > 0)) return { beats: [], downbeats: [] };
  const beats: number[] = [], downbeats: number[] = [];
  all.forEach((s, i) => {
    const beat = 60 / s.bpm, to = i + 1 < all.length ? Math.min(length, all[i + 1].from - 0.02) : length;      // (no beat a hair before the next section's first)
    for (let k = Math.ceil((s.from - s.first) / beat - 1e-6); ; k++) {
      const t = Math.round((s.first + k * beat) * 1000) / 1000;
      if (t > to) break;
      if (t < 0) continue;
      beats.push(t);
      if (((k % s.bar) + s.bar) % s.bar === 0) downbeats.push(t);
    }
  });
  return { beats, downbeats };
}

/** A tempo made safe to keep in a show: null when it is not one. */
function cleanTempo(t: unknown): TempoValue | null {
  if (!t || typeof t !== 'object') return null;
  const all = sectionsOf(t);
  if (!all.length) return null;
  const r2 = (v: number) => Math.round(v * 100) / 100, r3 = (v: number) => Math.round(v * 1000) / 1000;
  // `first` is kept inside the section's first bar: the same grid, one way of writing it
  const tidy = (s: Section) => { const len = 60 / s.bpm * s.bar; return { bpm: r2(s.bpm), first: r3(s.from + ((((s.first - s.from) % len) + len) % len)), bar: s.bar }; };
  const later: Section[] = [];
  for (const s of all.slice(1, 65)) {
    const prev = later[later.length - 1];
    if (prev && s.from - prev.from < 0.05) later.pop();          // two sections at one place: the later one stands
    later.push({ from: r3(s.from), ...tidy(s) });
  }
  return { ...tidy(all[0]), ...((t as TempoIn).confidence != null ? { confidence: r2(Number((t as TempoIn).confidence)) } : {}), ...(later.length ? { sections: later } : {}) };
}

/**
 * A tempo edited by hand: returns the new tempo (cleaned), or null when the edit means nothing.
 *
 *   { do: 'set', at, bpm?, bar? }     the section `at` is in: its tempo, its beats in a bar
 *   { do: 'nudge', at, by }           …its grid moved `by` seconds
 *   { do: 'one', at }                 the beat nearest `at` is beat one of a bar ("1 is here")
 *   { do: 'split', at, bpm?, bar? }   a new section begins on the beat nearest `at` (the tempo changes here)
 *   { do: 'join', at }                the section `at` is in is taken away: the one before it runs on
 */
function editTempo(tempo: TempoIn | null | undefined, e: TempoEdit) {
  const all = sectionsOf(tempo), at = Number(e && e.at) || 0;
  if (!all.length) return null;
  const cur = sectionAt(tempo, at)!, s = all[cur.index], beat = 60 / s.bpm;
  const nearest = s.first + Math.round((at - s.first) / beat) * beat;
  switch (e.do) {
    case 'set':
      if (e.bpm !== undefined) { if (!okBpm(e.bpm)) return null; s.bpm = Number(e.bpm); }
      if (e.bar !== undefined) s.bar = barOf(e.bar);
      break;
    case 'nudge': s.first += Number(e.by) || 0; break;
    case 'one': s.first = nearest; break;
    case 'split': {
      if (nearest - s.from < 0.05 || (e.bpm !== undefined && !okBpm(e.bpm))) return null;
      all.splice(cur.index + 1, 0, { from: nearest, first: nearest, bpm: e.bpm !== undefined ? Number(e.bpm) : s.bpm, bar: e.bar !== undefined ? barOf(e.bar) : s.bar });
      break;
    }
    case 'join': if (cur.index === 0) return null; all.splice(cur.index, 1); break;
    default: return null;
  }
  // a tempo typed over the one that was heard: what was heard no longer vouches for it
  const typed = cur.index === 0 && e.do === 'set' && e.bpm !== undefined;
  return cleanTempo({ ...all[0], ...(tempo!.confidence != null && !typed ? { confidence: tempo!.confidence } : {}), sections: all.slice(1) });
}

/** How fast a sound with a tempo plays to be at the desk's tempo: 1 when it has none, the desk has none, or the
 *  answer is beyond what stays music (half speed to double). `at`: where in its file it starts (its section). */
const WARP_MIN = 0.5, WARP_MAX = 2;
function warpRate(tempo: TempoIn | null | undefined, deskBpm: unknown, at = 0) {
  const sec = sectionAt(tempo, at);
  if (!sec || !okBpm(deskBpm)) return 1;
  const rate = Number(deskBpm) / sec.bpm;
  return rate >= WARP_MIN && rate <= WARP_MAX ? Math.round(rate * 1e4) / 1e4 : 1;
}

export { warpRate, tempoOf, tempoMap, gridOf, cleanTempo, editTempo, sectionsOf, sectionAt, onsetEnvelope, MIN_CONFIDENCE };
