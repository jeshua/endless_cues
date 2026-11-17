// The arithmetic behind a knob, and the little response curves drawn on a filter or an eq: no view, no import, so
// the unit tests run it in Node (test/dial.test.js) and the window imports the same file.
//
// A knob turns through a position from 0 to 1; a parameter is turned into one and back by its scale. A frequency,
// a time or a ratio that spans a wide range turns along a ratio (each turn of the wrist is the same musical step,
// 100 Hz to 200 Hz as 1 kHz to 2 kHz); a level, a mix or a pitch turns along a line.

/** How a parameter turns: { kind: 'log' | 'sq' | 'lin', min, max, origin, step }.
 *  `origin` is where the coloured arc starts: 0 for a setting that can go either side of it (a gain, a pitch),
 *  else the bottom of the range. `step` is what a coarse turn rounds to (a fine one rounds ten times finer). */
/** What a knob needs of a parameter: its range and its unit ('Hz', 'dB', 'ms', 's', 'st', 'ct', ':1', '' …). */
export interface DialParam { min: number; max: number; unit?: string }
/** A scale: how a parameter turns. */
export interface Scale { kind: 'log' | 'sq' | 'lin'; min: number; max: number; origin: number; step: number }

export function scaleOf(p: DialParam): Scale {
  const { min, max } = p;
  const origin = min < 0 && max > 0 ? 0 : min;
  if (min > 0 && max / min >= 20) return { kind: 'log', min, max, origin, step: 0 };
  // a time that starts at nothing (a hold, a pre-delay): most of the turn is spent on the short end
  if (min === 0 && (p.unit === 'ms' || p.unit === 's') && max >= 100) return { kind: 'sq', min, max, origin, step: 1 };
  if (p.unit === 'st' || p.unit === 'ct' || (p.unit === '' && Number.isInteger(min) && Number.isInteger(max) && max - min >= 4 && max > 2)) return { kind: 'lin', min, max, origin, step: 1 };
  const range = max - min;
  const step = [1, 0.5, 0.1, 0.01, 0.001].find((s) => s <= range / 100) || 0.001;
  return { kind: 'lin', min, max, origin, step };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Where a value sits on the knob, 0 to 1. */
export function toPos(p: DialParam, v: number | string | null | undefined) {
  const s = scaleOf(p), x = clamp(Number(v), s.min, s.max);
  if (!Number.isFinite(x)) return 0;
  if (s.kind === 'log') return Math.log(x / s.min) / Math.log(s.max / s.min);
  if (s.kind === 'sq') return Math.sqrt((x - s.min) / (s.max - s.min));
  return (x - s.min) / (s.max - s.min);
}

/** The value at a position on the knob, rounded as a hand would want it (`fine`: ten times finer). */
export function fromPos(p: DialParam, pos: number, fine = false) {
  const s = scaleOf(p), t = clamp(pos, 0, 1);
  const raw = s.kind === 'log' ? s.min * Math.pow(s.max / s.min, t) : s.kind === 'sq' ? s.min + (s.max - s.min) * t * t : s.min + (s.max - s.min) * t;
  return quantize(p, raw, fine);
}

/** A value rounded to what the knob can land on: three significant figures along a ratio (a frequency to the
 *  nearest hertz above 100 Hz), else the scale's step. Always within the parameter's range. */
export function quantize(p: DialParam, v: number, fine = false) {
  const s = scaleOf(p);
  let out: number;
  if (s.kind === 'log') {
    const figs = fine ? 4 : 3;
    const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - (figs - 1));
    out = Math.round(v / mag) * mag;
    if (p.unit === 'Hz' && out >= 100) out = Math.round(out);
  } else {
    // (whole steps stay whole: a semitone, a bit; a level never finer than a tenth of a dB, which is what is shown)
    const whole = s.step === 1 && (p.unit === 'st' || p.unit === 'ct' || !p.unit);
    const step = whole ? 1 : fine ? Math.max(p.unit === 'dB' ? 0.1 : 0.001, s.step / 10) : s.step;
    out = Math.round(v / step) * step;
  }
  return Math.round(clamp(out, s.min, s.max) * 1000) / 1000;
}

const trim = (n: number, places: number) => String(Number(n.toFixed(places)));
const signed = (n: number, text: string) => (n > 0 ? `+${text}` : n < 0 ? `−${text.replace('-', '')}` : text);

/** A value as it is shown under its knob: { text, unit }. */
export function format(p: DialParam, v: number | string | null | undefined): { text: string; unit: string } {
  const n = Number(v);
  if (!Number.isFinite(n)) return { text: '', unit: p.unit || '' };
  if (p.unit === 'Hz') return n >= 1000 ? { text: trim(n / 1000, n >= 10000 ? 1 : 2), unit: 'kHz' } : { text: String(Math.round(n)), unit: 'Hz' };
  if (p.unit === 'dB') return { text: signed(n, trim(Math.abs(n), 1)), unit: 'dB' };
  if (p.unit === 'st' || p.unit === 'ct') return { text: signed(n, trim(Math.abs(n), 2)), unit: p.unit };
  if (p.unit === 'ms') return { text: trim(n, n < 10 ? 1 : 0), unit: 'ms' };
  if (p.unit === 's') return n < 1 ? { text: String(Math.round(n * 1000)), unit: 'ms' } : { text: trim(n, 2), unit: 's' };
  if (p.unit === ':1') return { text: `${trim(n, 1)}:1`, unit: '' };
  if (share(p)) return { text: String(Math.round(n * 100)), unit: '%' };
  return { text: trim(n, 3), unit: p.unit || '' };
}
/** A setting with no unit that runs from nothing to one or two (a mix, a depth, a feedback, a width): a percentage. */
export function share(p: DialParam) { return !p.unit && p.min >= 0 && p.max <= 2; }

/** What was typed into a knob's box, as the parameter's own number, or null when it is not one. Takes the units the
 *  knob shows: "1.8k", "1.8 kHz", "350 ms" for a time in seconds, "30%" for a share; "−6" with the printer's minus. */
export function parseTyped(p: DialParam, text: string | number) {
  let t = String(text).trim().replace(/−/g, '-').replace(/,/g, '.').toLowerCase();
  if (!t) return null;
  let scale = 1;
  const unit = (t.match(/[a-z%:]+\s*1?$/) || [''])[0].trim();
  t = t.slice(0, t.length - (t.match(/\s*[a-z%:]+\s*1?$/) || [''])[0].length).trim();
  if (unit === 'k' || unit === 'khz') scale = 1000;
  else if (unit === 'ms' && p.unit === 's') scale = 0.001;
  else if (unit === 's' && p.unit === 'ms') scale = 1000;
  else if (unit === '%') scale = 0.01;
  const n = Number(t) * scale;
  if (t === '' || !Number.isFinite(n)) return null;
  // a share typed as a plain number above its top ("30" for a mix): a percentage was meant
  const v = share(p) && unit !== '%' && n > p.max ? n / 100 : n;
  return Math.round(clamp(v, p.min, p.max) * 1e6) / 1e6;
}

// ── the response curves ─────────────────────────────────────────────────────────────────────────────
// The level in dB a filter gives at a frequency, from the analogue prototype of each biquad (the shape the
// browser's filters are drawn from; close enough below a quarter of the sample rate for a picture an inch wide).
const Q_OF_SLOPE: Record<number, number[]> = { 12: [0.7071], 24: [0.5412, 1.3066], 48: [0.5098, 0.6013, 0.9, 2.5629] };

/** One second-order section's level in dB at `hz`. `type`: lowpass, highpass, peaking, lowshelf, highshelf. */
export function sectionDb(type: string, f0: number, q: number, gainDb: number, hz: number) {
  const x = hz / f0, x2 = x * x;
  const mag2 = (re: number, im: number) => re * re + im * im;
  if (type === 'lowpass') return -10 * Math.log10(mag2(1 - x2, x / q));
  if (type === 'highpass') return 10 * Math.log10(x2 * x2 / mag2(1 - x2, x / q));
  const A = Math.pow(10, gainDb / 40);
  if (type === 'peaking') return 10 * Math.log10(mag2(1 - x2, x * A / q) / mag2(1 - x2, x / (A * q)));
  // shelves with a slope of 1 (the browser's): Q = 1/√2
  const sq = Math.sqrt(A) * Math.SQRT2;
  if (type === 'lowshelf') return 20 * Math.log10(A) + 10 * Math.log10(mag2(A - x2, x * sq) / mag2(1 - A * x2, x * sq));
  if (type === 'highshelf') return 20 * Math.log10(A) + 10 * Math.log10(mag2(1 - A * x2, x * sq) / mag2(A - x2, x * sq));
  return 0;
}

/** A high-pass or low-pass of a slope (12, 24, 48 dB/oct) at `hz`: the Butterworth cascade the chain builds. */
export function filterDb(type: string, f0: number, slope: number, hz: number) {
  return (Q_OF_SLOPE[slope] || Q_OF_SLOPE[12]).reduce((sum, q) => sum + sectionDb(type, f0, q, 0, hz), 0);
}

/** An eq's bands ([{ type, hz, q, db }]) together at `hz`. */
export function eqDb(bands: { type: string; hz: number; q?: number; db?: number }[], hz: number) {
  return bands.reduce((sum, b) => sum + (b.db ? sectionDb(b.type, b.hz, b.q || 0.7071, b.db, hz) : 0), 0);
}

/** An SVG path for a curve `dbAt(hz)` across 20 Hz to 20 kHz, `w` by `h`, with `top` dB at the top and `bottom` at the foot. */
export function curvePath(dbAt: (hz: number) => number, w: number, h: number, top = 12, bottom = -30, points = 64) {
  const out: string[] = [];
  for (let i = 0; i <= points; i++) {
    const hz = 20 * Math.pow(1000, i / points);
    const d = clamp(dbAt(hz), bottom, top);
    out.push(`${i ? 'L' : 'M'}${(i / points * w).toFixed(1)} ${((top - d) / (top - bottom) * h).toFixed(1)}`);
  }
  return out.join(' ');
}
