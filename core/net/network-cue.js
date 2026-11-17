/**
 * What a Network cue sends over its time: one message, the same message again and again, or a message
 * with a value in it that moves.
 *
 *   plan(cue) -> { total, rate, loop, at(x) }      at(x): the message at x (0 at the start, 1 at the end)
 *
 *   no duration                    one message
 *   a duration, no token           the message is sent again `fps` times a second for that long (QLab's "Resend":
 *                                  for a device that must be told continuously, or might miss one)
 *   #v# in the message             a value from `fadeFrom` to `fadeTo` along `curve` (QLab's 1D fade)
 *   #x# and #y# in the message     a point moving along `path`, "x,y x,y …" (QLab's 2D fade); with `pathLoop`
 *                                  it goes round until the cue is stopped
 *
 * A value is sent as a float (six places at most, and "1.0" for a whole one, so it is a float on the wire)
 * unless `whole` is set, when it is rounded and sent as an integer: some devices take only one or the other.
 * The tokens may be in the address as well as the arguments. Text and hex messages are sent once: their
 * devices have no notion of a value arriving thirty times a second.
 */
const DEFAULT_RATE = 30;
const MAX_RATE = 120;

// how far along the value is (0..1) when the time is x (0..1)
const CURVES = {
  linear: (x) => x,
  's-curve': (x) => x * x * (3 - 2 * x),        // slow away, slow in
  'ease-in': (x) => x * x,                      // slow away
  'ease-out': (x) => 1 - (1 - x) * (1 - x),     // slow in
};

/** "0,0 1,0.5 1,1" (also "0,0; 1,1" or "{0,0} {1,1}") -> [[x, y], …]. Throws on anything that is not pairs of numbers. */
function parsePath(text) {
  const pairs = String(text || '').replace(/[{}[\]()]/g, ' ').split(/[;\s]+/).filter(Boolean);
  const out = [];
  for (const p of pairs) {
    const [x, y, more] = p.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y) || more !== undefined) throw new Error(`a path is points written x,y with spaces between (“${p}” is not one)`);
    out.push([x, y]);
  }
  return out;
}

/** The point a fraction t (0..1) of the way along a path, by distance. */
function along(points, t) {
  if (!points.length) return [0, 0];
  if (points.length === 1) return points[0];
  const lengths = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) { const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]); lengths.push(d); total += d; }
  if (!(total > 0)) return points[points.length - 1];
  let left = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const k = lengths[i] > 0 ? Math.min(1, left / lengths[i]) : 1;
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * k, points[i][1] + (points[i + 1][1] - points[i][1]) * k];
    }
    left -= lengths[i];
  }
  return points[points.length - 1];
}

function plan(cue) {
  const text = String(cue.message || '');
  const format = cue.format || 'osc';
  const total = Number(cue.duration) || 0;
  const rate = Math.max(1, Math.min(MAX_RATE, Number(cue.fps) || DEFAULT_RATE));
  if (format !== 'osc') return { total: 0, rate, loop: false, at: () => text };
  const hasV = text.includes('#v#'), hasXY = text.includes('#x#') || text.includes('#y#');
  if (!hasV && !hasXY) return { total, rate, loop: false, at: () => text };
  const shape = CURVES[cue.curve] || CURVES.linear;
  const val = cue.whole
    ? (v) => String(Math.round(v))
    : (v) => { const r = Math.round(v * 1e6) / 1e6; return Number.isInteger(r) ? r.toFixed(1) : String(r); };
  const a = Number(cue.fadeFrom) || 0, b = cue.fadeTo != null && cue.fadeTo !== '' ? Number(cue.fadeTo) : 1;
  let points = [];
  if (hasXY) { try { points = parsePath(cue.path); } catch { points = []; } }
  return {
    total, rate, loop: hasXY && !!cue.pathLoop && total > 0,
    at(x) {
      const k = shape(Math.max(0, Math.min(1, x)));
      let out = text;
      if (hasV) out = out.split('#v#').join(val(a + (b - a) * k));
      if (hasXY) { const [px, py] = along(points, k); out = out.split('#x#').join(val(px)).split('#y#').join(val(py)); }
      return out;
    },
  };
}

module.exports = { plan, parsePath, along, CURVES, DEFAULT_RATE, MAX_RATE };
