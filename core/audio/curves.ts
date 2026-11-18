/**
 * The shape of a fade, and a sound's level envelope.
 *
 * A fade moves a level from where it is to where it is going; its SHAPE says how far along it is (0–1) at each
 * moment of its time (0–1). 'linear' is a straight line in dB;
 * 's-curve' eases out of the start and into the end, so neither end of a long fade is heard as a corner; a custom
 * shape is a list of points [[x, y], …] from (0, 0) to (1, 1), joined by straight lines.
 *
 * A Fade cue has a shape for a level going up and one for a level going down; an Audio cue has one for its fade
 * in and one for its fade out. The engine says which applies (core/engine/cue-engine.ts); the host turns it into
 * numbers with progressOf() for the audio window, which only ever plays a list of points.
 *
 * An ENVELOPE is a sound's level drawn over its length: [[seconds into the file, dB], …], on top of the cue's
 * own level and whatever fades it. Before its first point and after its last it holds their levels.
 *
 * Pure arithmetic: no Electron, no audio.
 */
import * as Lanes from './lanes';
import type { LanePoint } from '../show/types';

/** A fade's shape as a cue keeps it ('linear' is kept as nothing): s-curve, or custom points [[x, y], …]. */
export type FadeShape = 's-curve' | [number, number][];
/** A show's level limits, in dB. */
export interface Limits { min: number; max: number }

const SHAPES: readonly string[] = ['linear', 's-curve'];
const SILENT_DB = -60;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** A custom shape as it is kept: points in order from (0, 0) to (1, 1), every one inside the square. null: not one. */
function cleanPoints(value: unknown): [number, number][] | null {
  if (!Array.isArray(value)) return null;
  const pts: [number, number][] = [];
  for (const p of value) {
    const x = Array.isArray(p) ? Number(p[0]) : p && typeof p === 'object' ? Number(p.x) : NaN;
    const y = Array.isArray(p) ? Number(p[1]) : p && typeof p === 'object' ? Number(p.y) : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push([r3(Math.max(0, Math.min(1, x))), r3(Math.max(0, Math.min(1, y)))]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  const mid = pts.filter((p) => p[0] > 0 && p[0] < 1);
  // two points at one moment would be a jump with no order to it: the first is kept
  const out: [number, number][] = [[0, 0]];
  for (const p of mid) if (p[0] > out[out.length - 1][0]) out.push(p);
  out.push([1, 1]);
  return out;
}

/** A shape as a cue keeps it: 'linear' (kept as nothing), 's-curve', or custom points. { ok, value } | { ok: false, why }. */
function cleanShape(value: unknown): { ok: true; value: FadeShape | undefined } | { ok: false; why: string } {
  if (value === 'linear') return { ok: true, value: undefined };
  if (SHAPES.includes(value as string)) return { ok: true, value: value as 's-curve' };
  if (value === 'custom') return { ok: true, value: [[0, 0], [0.5, 0.5], [1, 1]] };      // a custom shape begins as the straight line, with one point to drag
  const pts = cleanPoints(value);
  if (!pts) return { ok: false, why: 'a fade shape is linear, s-curve, or a list of points [[x, y], …] from 0 to 1' };
  return { ok: true, value: pts };
}

const kindOf = (shape: unknown) => (Array.isArray(shape) ? 'custom' : SHAPES.includes(shape as string) ? shape as string : 'linear');

/** How far along a fade of this shape is (0–1) when `x` (0–1) of its time has gone. */
function shapeAt(shape: FadeShape | string | null | undefined, x: number) {
  x = Math.max(0, Math.min(1, x));
  if (Array.isArray(shape)) {
    for (let i = 1; i < shape.length; i++) {
      const [x0, y0] = shape[i - 1], [x1, y1] = shape[i];
      if (x <= x1) return x1 > x0 ? y0 + (y1 - y0) * ((x - x0) / (x1 - x0)) : y1;
    }
    return 1;
  }
  if (shape === 's-curve') return (1 - Math.cos(Math.PI * x)) / 2;
  return x;
}

/** A shape as `n` numbers for the audio window: progress at evenly spaced moments. `from` (0–1): only what is left
 *  of the shape from that moment on, as a whole fade of its own (a paused fade taken up where it stopped). */
function progressOf(shape: FadeShape | string | null | undefined, n = 65, from = 0) {
  from = Math.max(0, Math.min(0.999, Number(from) || 0));
  const y0 = shapeAt(shape, from), span = 1 - y0;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = from + (1 - from) * (i / (n - 1));
    out[i] = span > 1e-6 ? r3((shapeAt(shape, x) - y0) / span) : i / (n - 1);
  }
  out[0] = 0; out[n - 1] = 1;
  return out;
}

/** An envelope as a cue keeps it: [[seconds, dB, bend?], …] in time order, levels between silence and +12. null:
 *  not one. (It is the Volume lane of core/audio/lanes.ts, where the arithmetic is; a point's third number bends the
 *  line to the next one; with none, the lines are straight in dB.) */
function cleanEnvelope(value: unknown) { return Lanes.cleanLane(value, Lanes.VOLUME); }

/** The envelope's level (dB on the cue's own) at `t` seconds into the file. No envelope: 0, no change. */
function envelopeAt(env: LanePoint[] | null | undefined, t: number) { return Lanes.envelopeAt(env, t); }

/** A show's level limits (Settings ▸ Audio): a level above the maximum is played at the maximum; one at or
 *  below the minimum is silence. No limits set: the engine's own (silence at −60 dB, nothing above +12 by hand). */
function cleanLimits(l: { min?: unknown; max?: unknown }): Limits {
  const max = Number.isFinite(Number(l && l.max)) && l.max !== null && l.max !== '' ? Math.max(-40, Math.min(24, Number(l.max))) : 12;
  const min = Number.isFinite(Number(l && l.min)) && l.min !== null && l.min !== '' ? Math.max(SILENT_DB, Math.min(max - 1, Number(l.min))) : SILENT_DB;
  return { min, max };
}
function limitDb(db: number, limits?: Limits | null) {
  const { min, max } = limits || { min: SILENT_DB, max: Infinity };
  if (!Number.isFinite(db)) return db;
  if (db <= min) return SILENT_DB;
  return db > max ? max : db;
}

export { SHAPES, SILENT_DB, cleanPoints, cleanShape, kindOf, shapeAt, progressOf, cleanEnvelope, envelopeAt, cleanLimits, limitDb };
