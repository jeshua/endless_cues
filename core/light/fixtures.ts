/**
 * Fixture definitions: what a kind of light is, as the DMX channels it takes.
 *
 * A definition is a name and its parameters in the fixture's own DMX order. Each parameter takes one
 * channel (or two, coarse then fine, when it is 16-bit) and has a home: where it sits when no cue has
 * touched it. Every level in the app is a percentage, 0 to 100, whatever the parameter.
 *
 *   { id: 'rgbw', name: 'RGBW', params: [{ key: 'red', home: 100 }, { key: 'green', home: 100 }, …] }
 *
 * `intensity` is the parameter a bare command means ("front = 80") and the one a blackout takes
 * out. A fixture of colour channels with no dimmer of its own (a plain RGB par) is given one that
 * is not a channel: its `intensity` scales the colour channels on their way out, so "all = 0" is
 * dark on every kind of light and its colour is remembered underneath. That is why colours are at
 * home at 100 (white) and intensity at 0.
 *
 * The built-in library is small on purpose (the generic shapes most rigs are made of). A show adds
 * its own (Settings ▸ Integrations ▸ Light), written as text, one parameter a line in DMX order:
 *
 *   intensity
 *   red
 *   green
 *   blue
 *   pan 16
 *   tilt 16
 *   iris home 100
 *
 * and they are kept in the show file, so the show opens the same on another computer.
 */
const COLOURS = ['red', 'green', 'blue', 'white', 'amber'];
const RGB = ['red', 'green', 'blue'];

/** A fixture definition as written: the library's, or a show's own. */
export interface FixtureSource { id?: string; name?: string; params?: { key?: unknown; home?: unknown; bits?: unknown }[] }
/** One parameter of a compiled definition: its channel `offset` (-1 for the made-up intensity). */
export interface FixtureParam { key: string; bits: number; home: number; offset: number; virtual?: boolean }
/** A definition as the rest of the app uses it (`compile`). */
export interface FixtureDef {
  id: string; name: string; params: FixtureParam[]; footprint: number; colours: string[]; virtual: boolean;
  default: string; byKey: Map<string, FixtureParam>; builtIn?: boolean;
}

const p = (key: string, home = 0, bits = 8) => ({ key, home, bits });

const LIBRARY: FixtureSource[] = [
  { id: 'dimmer', name: 'Dimmer', params: [p('intensity')] },
  { id: 'rgb', name: 'RGB', params: [p('red', 100), p('green', 100), p('blue', 100)] },
  { id: 'rgbw', name: 'RGBW', params: [p('red', 100), p('green', 100), p('blue', 100), p('white', 0)] },
  { id: 'rgba', name: 'RGBA', params: [p('red', 100), p('green', 100), p('blue', 100), p('amber', 0)] },
  { id: 'dimmer-rgb', name: 'Dimmer + RGB', params: [p('intensity'), p('red', 100), p('green', 100), p('blue', 100)] },
  { id: 'dimmer-rgbw', name: 'Dimmer + RGBW', params: [p('intensity'), p('red', 100), p('green', 100), p('blue', 100), p('white', 0)] },
  { id: 'mover', name: 'Moving head (intensity, pan, tilt)', params: [p('intensity'), p('pan', 50), p('tilt', 50)] },
  { id: 'mover-16', name: 'Moving head, 16-bit pan and tilt', params: [p('intensity'), p('pan', 50, 16), p('tilt', 50, 16)] },
];

const KEY = /^[a-z][a-z0-9_]*$/;

/**
 * A definition as the rest of the app uses it: its channels laid out, its default parameter, and
 * whether its intensity is a channel or the made-up one. Returns { ok: false, why } for one that cannot be.
 */
function compile(def: FixtureSource | null | undefined): { ok: true; def: FixtureDef } | { ok: false; why: string } {
  if (!def || typeof def !== 'object') return { ok: false, why: 'not a fixture definition' };
  const params: FixtureParam[] = [];
  const seen = new Set();
  let offset = 0;
  for (const raw of Array.isArray(def.params) ? def.params : []) {
    const key = String((raw && raw.key) || '').trim().toLowerCase();
    if (!KEY.test(key)) return { ok: false, why: `“${(raw && raw.key) || ''}” is not a parameter name (a word: letters, digits, _)` };
    if (seen.has(key)) return { ok: false, why: `the parameter ${key} is there twice` };
    seen.add(key);
    const bits = Number(raw.bits) === 16 ? 16 : 8;
    const home = Number.isFinite(Number(raw.home)) ? Math.max(0, Math.min(100, Number(raw.home))) : 0;
    params.push({ key, bits, home, offset });
    offset += bits === 16 ? 2 : 1;
  }
  if (!params.length) return { ok: false, why: 'a fixture needs at least one parameter' };
  const colours = params.filter((x) => COLOURS.includes(x.key)).map((x) => x.key);
  // a light of colour channels with no dimmer: its intensity is ours, and scales them
  const virtual = !seen.has('intensity') && RGB.every((c) => seen.has(c));
  if (virtual) params.push({ key: 'intensity', bits: 8, home: 0, offset: -1, virtual: true });
  return { ok: true, def: {
    id: String(def.id || ''), name: String(def.name || def.id || ''), params, footprint: offset, colours, virtual,
    default: seen.has('intensity') || virtual ? 'intensity' : params[0].key,
    byKey: new Map(params.map((x) => [x.key, x])),
  } };
}

/** Where a parameter rests when its line does not say: red, green and blue at 100 (white), pan and tilt in the middle, the rest at 0. */
const restOf = (key: string) => (RGB.includes(key) ? 100 : key === 'pan' || key === 'tilt' ? 50 : 0);

/** A definition written as text (one parameter a line, in DMX order): "pan 16", "tilt 16 home 50", "strobe". */
function parseText(text: unknown): { ok: true; params: { key: string; bits: number; home: number }[] } | { ok: false; why: string } {
  const params: { key: string; bits: number; home: number }[] = [];
  for (const [i, line] of String(text || '').split(/\r?\n/).entries()) {
    const s = line.replace(/(#|\/\/).*$/, '').trim().toLowerCase();
    if (!s) continue;
    const m = /^([a-z][a-z0-9_]*)(?:\s+(8|16)(?:\s*-?\s*bit)?)?(?:\s+home\s+(\d+(?:\.\d+)?))?$/.exec(s);
    if (!m) return { ok: false, why: `line ${i + 1} (“${line.trim()}”): a parameter is a name, then 16 if it takes two channels, then “home 50” if it does not rest at 0` };
    params.push({ key: m[1], bits: m[2] === '16' ? 16 : 8, home: m[3] !== undefined ? Number(m[3]) : restOf(m[1]) });
  }
  const r = compile({ params });
  return r.ok ? { ok: true, params } : r;
}
/** The same definition back as text. */
function toText(def: { params?: { key: string; bits?: unknown; home?: unknown; virtual?: boolean }[] }): string {
  return (def.params || []).filter((x) => !x.virtual).map((x) => `${x.key}${Number(x.bits) === 16 ? ' 16' : ''}${Number(x.home) !== restOf(x.key) ? ` home ${Number(x.home)}` : ''}`).join('\n');
}

/** Every definition a show can use: the library, then the show's own (one of the show's with a library id takes its place). */
function all(own: FixtureSource[] = []): Map<string, FixtureDef & { builtIn: boolean }> {
  const out = new Map<string, FixtureDef & { builtIn: boolean }>();
  for (const d of [...LIBRARY, ...(Array.isArray(own) ? own : [])]) {
    const r = compile(d);
    if (r.ok && r.def.id) out.set(r.def.id, { ...r.def, builtIn: LIBRARY.includes(d) });
  }
  return out;
}

/** For the UI: [{ id, name, footprint, params: ['intensity', 'pan', …], builtIn }]. */
function list(own: FixtureSource[] = []) {
  return [...all(own).values()].map((d) => ({ id: d.id, name: d.name, footprint: d.footprint, builtIn: d.builtIn, text: toText(d), params: d.params.map((x) => x.key) }));
}

export { LIBRARY, COLOURS, compile, parseText, toText, all, list };
