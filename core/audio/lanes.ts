/**
 * Automation: lines drawn over a sound's length that move its volume, its pan, or a setting of its sound design
 * while it plays (the lanes of a DAW, drawn on Time & Loops).
 *
 * A LANE is a list of points in time order, [[seconds into the file, value], …]. A point may carry a third number,
 * the bend of the line from it to the next point (`c`, −1 … 1; none or 0: straight). Before the first point and
 * after the last the line holds their values. A cue keeps:
 *
 *   envelope                      the Volume lane: dB on top of Level (and whatever fades it). Written before lanes
 *                                 had bends, so an old envelope ([[t, dB], …]) reads and plays exactly as it did.
 *   pan                           the cue's own pan, −100 (left) … 0 … 100 (right): a field, not a lane
 *   automation                    every other lane, by id: { "pan": [[t, v, c?], …], "chain.lowpass.hz": [[t, Hz], …] }
 *                                 "pan" replaces the Pan field while it has points; "chain.<tool>.<setting>" replaces
 *                                 that knob of its sound design (only a setting that glides: core/audio/chain.js
 *                                 SWEEPABLE). A lane for a tool the chain does not have does nothing.
 *
 * Between two points the value moves along the knob's own scale (core/audio/chain.js's table, turned the way
 * app/renderer/dial.js turns the knob: a frequency along a ratio, a level along a line), so a straight line from
 * 200 Hz to 2 kHz passes 632 Hz half way. The Volume lane moves in dB and Pan in its own units, as drawn.
 *
 * A lane is read at a place IN THE FILE, never at a time since the GO: so it repeats with a loop region (or a loop
 * of the whole file) each time round, follows a skip, a pause, a rate, Load to Time and Run from here, with nothing
 * to work out again.
 *
 * Pure arithmetic, no dependency; loads three ways as core/audio/chain.js does: required by Node, as a plain script
 * in the audio window (`Lanes`), and in the main window (served at ec://app/core/audio/lanes.js).
 */
const SILENT_DB = -60, MAX_DB = 12;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r3 = (n) => Math.round(n * 1000) / 1000;
const r2 = (n) => Math.round(n * 100) / 100;

// ── a knob's scale: as scaleOf in app/renderer/dial.js (test/lanes.test.js holds the two to one answer) ──
function scaleOf(p) {
  const { min, max } = p;
  if (min > 0 && max / min >= 20) return 'log';
  if (min === 0 && (p.unit === 'ms' || p.unit === 's') && max >= 100) return 'sq';
  return 'lin';
}
/** Where a value sits on its knob, 0 … 1. */
function posOf(p, v) {
  const x = clamp(Number(v), p.min, p.max), k = scaleOf(p);
  if (!Number.isFinite(x)) return 0;
  if (k === 'log') return Math.log(x / p.min) / Math.log(p.max / p.min);
  if (k === 'sq') return Math.sqrt((x - p.min) / (p.max - p.min));
  return (x - p.min) / (p.max - p.min);
}
/** The value at a place on its knob (not rounded). */
function valueAtPos(p, u) {
  const t = clamp(u, 0, 1), k = scaleOf(p);
  return k === 'log' ? p.min * Math.pow(p.max / p.min, t) : k === 'sq' ? p.min + (p.max - p.min) * t * t : p.min + (p.max - p.min) * t;
}

// ── what lanes there are ──
const VOLUME = { id: 'volume', kind: 'volume', label: 'Volume', unit: 'dB', min: SILENT_DB, max: MAX_DB, def: 0 };
const NAMES = { 'lowpass.hz': 'Cutoff', 'highpass.hz': 'Cutoff' };      // (a lane's name where the knob's own reads oddly alone)
const PAN = { id: 'pan', kind: 'pan', label: 'Pan', unit: '', min: -100, max: 100, def: 0 };
/** A lane's description from its id: { id, kind, label, unit, min, max, def, tool?, key?, p? }, or null.
 *  `tools`: core/audio/chain.js TOOLS (the chain lanes are drawn from it). */
function specOf(id, tools) {
  if (id === 'volume') return VOLUME;
  if (id === 'pan') return PAN;
  const m = /^chain\.([a-z0-9]+)\.([a-z0-9]+)$/i.exec(String(id));
  const t = m && (tools || []).find((x) => x.key === m[1]);
  const p = t && t.params.find((x) => x.key === m[2] && x.glide && !x.options && !x.bool && !x.file);
  if (!p) return null;
  return { id, kind: 'chain', tool: t.key, key: p.key, label: `${t.label} · ${NAMES[`${t.key}.${p.key}`] || p.label}`, unit: p.unit, min: p.min, max: p.max, def: p.def, p };
}
/** The lanes a cue can have: Volume, Pan (a sound with a file), then every setting that glides of each tool its
 *  chain has, in the order the tools run. */
function lanesOf(cue, tools) {
  const out = [VOLUME, PAN];
  const chain = (cue && cue.chain) || {};
  for (const t of tools || []) {
    if (!chain[t.key] || typeof chain[t.key] !== 'object') continue;
    for (const p of t.params) { const s = specOf(`chain.${t.key}.${p.key}`, tools); if (s) out.push(s); }
  }
  return out;
}

// ── a lane's points ──
/** A lane as a cue keeps it: points in time order (two at one moment: the first is kept), each value inside its
 *  range, a bend of nothing left off. null: not a lane at all. */
function cleanLane(value, spec = VOLUME) {
  if (!Array.isArray(value)) return null;
  const pts = [];
  for (const p of value) {
    const t = Array.isArray(p) ? Number(p[0]) : p && typeof p === 'object' ? Number(p.at ?? p.t) : NaN;
    const v = Array.isArray(p) ? Number(p[1]) : p && typeof p === 'object' ? Number(p.db ?? p.v ?? p.value) : NaN;
    const c = Array.isArray(p) ? Number(p[2] || 0) : p && typeof p === 'object' ? Number(p.c || p.curve || 0) : 0;
    if (!Number.isFinite(t) || !Number.isFinite(v) || t < 0) return null;
    const val = spec.kind === 'volume' ? Math.round(clamp(v, SILENT_DB, MAX_DB) * 10) / 10 : r3(clamp(v, spec.min, spec.max));
    const bend = Number.isFinite(c) ? r2(clamp(c, -1, 1)) : 0;
    pts.push(bend ? [r3(t), val, bend] : [r3(t), val]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  return pts.filter((p, i) => i === 0 || p[0] > pts[i - 1][0]);
}
/** A cue's `automation` as the show keeps it: only lanes with points, each cleaned. null: none. Throws on what is
 *  not one (the message says what would be). */
function cleanAutomation(value, tools) {
  if (value == null || value === '') return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('automation: { lane: [[seconds, value], …] }, as in { "pan": [[0, -100], [4, 100]], "chain.lowpass.hz": [[0, 300], [8, 8000]] }');
  const out = {};
  for (const [id, pts] of Object.entries(value)) {
    if (id === 'volume') throw new Error('automation: the Volume line is the cue’s `envelope` ([[seconds, dB], …])');
    const spec = specOf(id, tools);
    if (!spec) throw new Error(`automation: there is no lane “${id}” (the lanes are "pan" and "chain.<tool>.<setting>" for a setting that glides, as "chain.lowpass.hz" or "chain.reverb.mix")`);
    if (pts == null) continue;
    const lane = cleanLane(pts, spec);
    if (!lane) throw new Error(`automation: ${id} is a list of [seconds, value] points (a third number bends the line to the next point, −1 to 1)`);
    if (lane.length) out[id] = lane;
  }
  return Object.keys(out).length ? out : null;
}

/** How far along a segment its value is (0 … 1) when `x` (0 … 1) of its time has gone: straight when `c` is
 *  nothing; c > 0 starts slow and ends fast, c < 0 the other way. */
function bend(x, c) {
  x = clamp(x, 0, 1);
  if (!c) return x;
  const k = clamp(c, -1, 1) * 4;
  return (Math.exp(k * x) - 1) / (Math.exp(k) - 1);
}
// what a line is straight in: dB for Volume, its own units for Pan, its knob's turn for a setting
const toU = (spec, v) => (spec.kind === 'chain' ? posOf(spec.p || spec, v) : v);
const fromU = (spec, u) => (spec.kind === 'chain' ? valueAtPos(spec.p || spec, u) : u);

/** The lane's value at `t` seconds into the file. No points: null (the cue's own value holds). */
function valueAt(pts, t, spec = VOLUME) {
  if (!Array.isArray(pts) || !pts.length) return null;
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [t0, v0, c] = pts[i - 1], [t1, v1] = pts[i];
    if (t <= t1) {
      const f = bend((t - t0) / (t1 - t0), c);
      if (spec.kind !== 'chain') return v0 + (v1 - v0) * f;
      const u0 = toU(spec, v0), u1 = toU(spec, v1);
      return fromU(spec, u0 + (u1 - u0) * f);
    }
  }
  return pts[pts.length - 1][1];
}
/** The Volume lane in dB at `t` (0: no envelope, no change). The reading core/audio/curves.js envelopeAt gives. */
const envelopeAt = (env, t) => { const v = valueAt(env, t, VOLUME); return v == null ? 0 : v; };

/** A place in the file, played straight on from a start (`u`), as it is heard: a held region (`region`) and a loop
 *  of the whole file (`whole`: the file's length) wrapped. So a lane read here goes round with the loop. */
function wrap(u, region, whole) {
  if (region && region.end > region.start && u >= region.end) return region.start + ((u - region.end) % (region.end - region.start));
  return whole > 0 && u >= whole ? u % whole : u;
}

/** Each side's gain for a pan, −100 … 100: equal power (a sound in the middle is as loud as at either side), unity
 *  on both at 0, so a cue that is not panned plays exactly as it did. A stereo sound is balanced: each side by its gain. */
function panGains(pan) {
  const x = clamp(Number(pan) || 0, -100, 100);
  if (!x) return [1, 1];
  const th = (x / 100 + 1) * Math.PI / 4;
  return [Math.SQRT2 * Math.cos(th), Math.SQRT2 * Math.sin(th)];
}
/** The other way: two gains (linear) as a pan and the level left over, in dB. { pan, db } (pan rounded to 1). */
function panOfGains(gl, gr) {
  const l = Math.max(0, Number(gl) || 0), r = Math.max(0, Number(gr) || 0);
  if (!(l + r > 0)) return null;
  const th = Math.atan2(r, l), m = Math.sqrt((l * l + r * r) / 2);
  return { pan: Math.round((th / (Math.PI / 4) - 1) * 100), db: Math.round(20 * Math.log10(m) * 10) / 10 };
}

// ── the cue's lanes, as the window edits them ──
/** A lane's points on a cue. */
function pointsOf(cue, id) { return (id === 'volume' ? cue && cue.envelope : cue && cue.automation && cue.automation[id]) || []; }
/** What a cue's line is where it has no points: 0 dB on top of Level, the Pan field, the knob as set. */
function baseOf(cue, spec) {
  if (spec.kind === 'volume') return 0;
  if (spec.kind === 'pan') return clamp(Number(cue && cue.pan) || 0, -100, 100);
  const v = cue && cue.chain && cue.chain[spec.tool] ? cue.chain[spec.tool][spec.key] : undefined;
  return v === undefined || v === null ? spec.def : Number(v);
}
/** The props one edit of a lane sets (setCue): the envelope for Volume, the cue's whole `automation` otherwise. */
function propsFor(cue, id, pts) {
  if (id === 'volume') return { envelope: pts && pts.length ? pts : null };
  const next = { ...((cue && cue.automation) || {}) };
  if (pts && pts.length) next[id] = pts; else delete next[id];
  return { automation: Object.keys(next).length ? next : null };
}
/** A cue's automation without the lanes of tools its chain no longer has (a device removed): the same object
 *  when nothing goes, else the new one, or null for none left. */
function pruneFor(automation, chain) {
  if (!automation) return automation;
  const keep = Object.entries(automation).filter(([id]) => { const m = /^chain\.([a-z0-9]+)\./i.exec(id); return !m || (chain && chain[m[1]] && typeof chain[m[1]] === 'object'); });
  if (keep.length === Object.keys(automation).length) return automation;
  return keep.length ? Object.fromEntries(keep) : null;
}
/** A chain with each automated setting where its lane is at `t` (the chain a sound starts with). */
function chainAt(chain, automation, t, tools) {
  if (!chain || !automation) return chain;
  let out = chain;
  for (const [id, pts] of Object.entries(automation)) {
    const spec = specOf(id, tools);
    if (!spec || spec.kind !== 'chain' || !chain[spec.tool] || typeof chain[spec.tool] !== 'object') continue;
    const v = valueAt(pts, t, spec);
    if (v == null) continue;
    if (out === chain) out = { ...chain };
    out[spec.tool] = { ...out[spec.tool], [spec.key]: r3(v) };
  }
  return out;
}
/** The chain lanes of an automation, grouped by tool as a Fade's sweep is: { tool: { setting: value } } at `t`. */
function sweepAt(automation, t, tools) {
  const to = {};
  for (const [id, pts] of Object.entries(automation || {})) {
    const spec = specOf(id, tools);
    if (!spec || spec.kind !== 'chain') continue;
    const v = valueAt(pts, t, spec);
    if (v != null) (to[spec.tool] = to[spec.tool] || {})[spec.key] = v;
  }
  return to;
}

export { SILENT_DB, MAX_DB, VOLUME, PAN, scaleOf, posOf, valueAtPos, specOf, lanesOf, cleanLane, cleanAutomation, bend, valueAt, envelopeAt, wrap, panGains, panOfGains, pointsOf, baseOf, propsFor, pruneFor, chainAt, sweepAt };
