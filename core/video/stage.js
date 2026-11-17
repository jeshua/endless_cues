/**
 * The stage: what a Video, Text or Camera cue is drawn on.
 *
 * A stage is a raster of its own size (1920 × 1080 unless the show says otherwise) that the output window
 * scales to whatever display it is on, so a show's positions are in stage pixels and do not change when
 * the projector does. This file is the arithmetic of it, with no window: which files are pictures, a cue's
 * geometry as numbers, a geometry part way through a fade, and the corner pin (a four-point keystone) as
 * the matrix the output window applies. The window itself is app/stage/stage.html.
 */

const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'];
const ext = (file) => (/\.([a-z0-9]+)$/i.exec(String(file || '')) || [])[1]?.toLowerCase() || '';

/** What a Video cue's file is: 'video' (it has a length, and perhaps sound), 'image' (a still), or null. */
function mediaKind(file) {
  const e = ext(file);
  return VIDEO_EXT.includes(e) ? 'video' : IMAGE_EXT.includes(e) ? 'image' : null;
}

const DEFAULT_STAGE = { width: 1920, height: 1080, pin: null };
const FADEABLE = ['opacity', 'x', 'y', 'scale', 'rotation'];
const REST = { opacity: 100, x: 0, y: 0, scale: 1, rotation: 0 };
const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);

/** A cue's geometry as the output window wants it: every number present and in range. */
function geometryOf(cue) {
  return {
    opacity: Math.max(0, Math.min(100, num(cue.opacity, REST.opacity))),
    x: num(cue.x, 0), y: num(cue.y, 0),
    scale: Math.max(0, num(cue.scale, 1)),
    rotation: num(cue.rotation, 0),
  };
}

/** What a Fade cue moves on a picture: only the geometry it names ({} when it names none). */
function movesOf(fade) {
  const out = {};
  for (const k of FADEABLE) if (fade[k] !== undefined && fade[k] !== null && fade[k] !== '' && Number.isFinite(Number(fade[k]))) out[k] = Number(fade[k]);
  if (out.opacity !== undefined) out.opacity = Math.max(0, Math.min(100, out.opacity));
  if (out.scale !== undefined) out.scale = Math.max(0, out.scale);
  return out;
}

/** A geometry `x` (0–1) of the way from `a` to `b`; what `b` does not name stays as it is in `a`. */
function mix(a, b, x) {
  const t = Math.max(0, Math.min(1, x));
  const out = { ...a };
  for (const k of FADEABLE) if (b[k] !== undefined) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** The show's stage settings (settings.video), cleaned: a size, and four corners or none. */
function stageOf(settings) {
  const v = (settings && settings.video) || {};
  const size = (n, d) => (Number(n) >= 16 && Number(n) <= 16384 ? Math.round(Number(n)) : d);
  return { width: size(v.width, DEFAULT_STAGE.width), height: size(v.height, DEFAULT_STAGE.height), pin: cleanPin(v.pin) };
}

const SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1]];
/** Four corners (top left, top right, bottom right, bottom left) as fractions of the stage, or null when they
 *  are missing, are the stage's own corners, or could not be a picture (three of them in a line). */
function cleanPin(pin) {
  if (!Array.isArray(pin) || pin.length !== 4) return null;
  const p = pin.map((c) => (Array.isArray(c) && c.length === 2 ? [Number(c[0]), Number(c[1])] : null));
  if (p.some((c) => !c || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0]) > 4 || Math.abs(c[1]) > 4)) return null;
  if (p.every((c, i) => Math.abs(c[0] - SQUARE[i][0]) < 1e-6 && Math.abs(c[1] - SQUARE[i][1]) < 1e-6)) return null;
  // each corner must turn the same way as the one before it: a quad that folds over itself has no picture
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) return null;
    if (sign && Math.sign(cross) !== sign) return null;
    sign = Math.sign(cross);
  }
  return p.map((c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5]);
}

/**
 * The corner pin as a CSS matrix3d (16 numbers, applied with its origin at the stage's top left): the
 * projective map that takes the stage's corners to `pin`'s. null when there is no pin.
 */
function pinMatrix(width, height, pin) {
  const p = cleanPin(pin);
  if (!p) return null;
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p.map(([u, v]) => [u * width, v * height]);
  const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  // (the unit square to the quad, then the stage's pixels to the unit square)
  const a = (x1 - x0 + g * x1) / width, b = (x3 - x0 + h * x3) / height, c = x0;
  const d = (y1 - y0 + g * y1) / width, e = (y3 - y0 + h * y3) / height, f = y0;
  return [a, d, 0, g / width, b, e, 0, h / height, 0, 0, 1, 0, c, f, 0, 1];
}

/** Where a stage pixel lands under a matrix from pinMatrix (for the tests, and for anyone drawing handles). */
function project(m, x, y) {
  const w = m[3] * x + m[7] * y + m[15];
  return [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w];
}

module.exports = { VIDEO_EXT, IMAGE_EXT, mediaKind, DEFAULT_STAGE, FADEABLE, geometryOf, movesOf, mix, stageOf, cleanPin, pinMatrix, project };
