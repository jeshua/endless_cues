// The arithmetic behind dragging things on a sound's waveform (WaveEdit.ts): lines' points, markers and loop
// regions. No view and no import, so the unit tests run it in Node (test/wave-edit.test.ts) as the window does.

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Snap a time lightly: to the nearest of `marks` (markers, bar lines, beats, Start and End, other points) when it
 *  is within `px` pixels of one at `pxPerSec`; `fine` (Shift): never. */
export function snapTime(t: number, marks: number[] | null | undefined, pxPerSec: number, fine = false, px = 6) {
  if (fine || !(pxPerSec > 0)) return t;
  let best = t, gap = px / pxPerSec;
  for (const m of marks || []) { const d = Math.abs(m - t); if (d < gap) { gap = d; best = m; } }
  return best;
}

/** A tempo's section as Tempo.ts gives it: from where, its tempo, its first beat and the beats in a bar. */
export interface TempoSection { from: number; bpm: number; first: number; bar: number }

/** The beats of a tempo across a length (its sections as Tempo.ts gives them: { from, bpm, first, bar }), at most `max`. */
export function beatsOf(sections: TempoSection[], length: number, max = 2400) {
  const out: number[] = [];
  if (!(length > 0)) return out;
  sections.forEach((x, i) => {
    const beat = 60 / x.bpm, to = i + 1 < sections.length ? Math.min(length, sections[i + 1].from - 0.02) : length;
    for (let t = x.first + Math.ceil((x.from - x.first) / beat - 1e-6) * beat; t <= to && out.length < max; t += beat) if (t >= 0) out.push(r3(t));
  });
  return out;
}

/**
 * Several points of a line moved together by `dt` seconds and `dy` pixels: { dt, dy } as far as they can go, so
 * none passes a point that is not moving, leaves the sound (0 … `dur`), or leaves the picture (y 0 … `h`).
 * `pts`: [[t, …]], `ys`: each point's y now, `sel`: the indices moving.
 */
export function groupMove(pts: number[][], ys: number[], sel: Set<number>, dt: number, dy: number, dur: number, h: number, gap = 0.01) {
  let lo = -Infinity, hi = Infinity;
  for (const i of sel) {
    let a = i - 1; while (a >= 0 && sel.has(a)) a--;
    let b = i + 1; while (b < pts.length && sel.has(b)) b++;
    lo = Math.max(lo, (a >= 0 ? pts[a][0] + gap : 0) - pts[i][0]);
    hi = Math.min(hi, (b < pts.length ? pts[b][0] - gap : dur) - pts[i][0]);
  }
  let ylo = -Infinity, yhi = Infinity;
  for (const i of sel) { ylo = Math.max(ylo, -ys[i]); yhi = Math.min(yhi, h - ys[i]); }
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  return { dt: r6(clamp(dt, Math.min(0, lo), Math.max(0, hi))), dy: r6(clamp(dy, Math.min(0, ylo), Math.max(0, yhi))) };
}

/** A segment's bend after an ⌥-drag of `up` pixels upwards from where it was (`c0`): a drag up bulges the line
 *  up, whichever way the segment runs (`rising`: its end is higher than its start on the picture). */
export function bendFromDrag(c0: number | undefined, up: number, rising: boolean, per = 60) {
  const c = (Number(c0) || 0) + (rising ? -1 : 1) * up / per;
  return Math.round(clamp(c, -1, 1) * 100) / 100;
}

/** Which segment a place on the picture is on: the index of its first point, or -1 (before the first point or after the last). */
export function segmentAt(pts: number[][], t: number) {
  for (let i = 0; i + 1 < pts.length; i++) if (t >= pts[i][0] && t <= pts[i + 1][0]) return i;
  return -1;
}

/** Markers after one is moved to `t` (or renamed, or removed with `t` null): kept in time order, inside the sound. */
export function moveMarker<M extends { at: number }>(markers: M[], i: number, t: number | null, dur: number) {
  const out = markers.map((m) => ({ ...m }));
  if (t === null) out.splice(i, 1);
  else out[i].at = r3(clamp(t, 0, dur > 0 ? dur : Infinity));
  return out.sort((a, b) => a.at - b.at);
}

/** A loop region after a drag: `part` 'start' or 'end' moves that edge (never closer than `min` to the other),
 *  'body' moves both by the same (the region kept whole, inside the sound). */
export function moveRegion<G extends { start: number; end: number }>(g: G, part: 'start' | 'end' | 'body', t: number, dur: number, grab = 0, min = 0.05): G {
  const len = g.end - g.start, end = dur > 0 ? dur : Infinity;
  if (part === 'start') return { ...g, start: r3(clamp(t, 0, g.end - min)) };
  if (part === 'end') return { ...g, end: r3(clamp(t, g.start + min, end)) };
  const s = clamp(t - grab, 0, end - len);
  return { ...g, start: r3(s), end: r3(s + len) };
}
