/**
 * The rig: what every light is at right now, and how it gets from one state to the next.
 *
 * It holds one level (0–100) for every parameter of every instrument in the patch. Levels track:
 * a level stays where the last cue (or hand) put it until something else moves it, so a cue only
 * says what changes. A cue marked as a full state also sends everything it does not name home.
 *
 * A change over time is a "move": a set of parameters each going from where it was to where it is
 * told, with a progress from 0 to 1. A Light cue's move is driven from outside (`progress(id, x)`):
 * the cue engine owns that clock, so a paused cue's lights pause and a stopped cue's lights stay
 * where they had got to, with no second timer to disagree with. A hand's move (the dashboard's
 * "over" time, a blackout that fades) runs on the time given to `tick(now)`. The latest word wins,
 * parameter by parameter: a new move takes a parameter away from an older one still running.
 *
 * Each level remembers who set it: the cue it came from (so the dashboard can say, and so "revert"
 * can go back to it), and whether a hand has moved it since (drawn in the standby colour: it is not
 * in any cue until it is recorded).
 *
 * `render()` turns the levels into DMX: one 512-byte buffer per universe. A blackout is applied
 * there and nowhere else (each instrument's intensity goes out as 0), so the levels underneath are
 * untouched and come back as they were.
 *
 * Pure: no clock of its own, no sockets. core/light/output.ts sends what `render()` gives.
 */
import * as commands from './commands';
import * as patchLib from './patch';
import type { CompiledPatch, LightInput } from './patch';
import type { Levels } from './commands';

/** What the rig reads of a Light cue (or of the cue a Fade aims at). */
export interface LightCueLike { id?: string; number?: string; levels?: unknown; block?: boolean; duration?: unknown }
interface Level { v: number; base: number; cue: string | null | undefined; manual: boolean }
interface Move { from: Levels; to: Levels; x: number; timed: { startedAt: number; total: number } | null }
type Opts = { secs?: number; now?: number; external?: boolean };

function createRig() {
  let patch = patchLib.compile(null);
  const state = new Map<string, Level>();           // 'instrument.parameter' -> { v, base, cue, manual }
  const moves = new Map<string, Move>();           // id -> { from: Map, to: Map, x, timed: { startedAt, total } | null }
  let blackout = false;
  let latest: { id: string | null; n: number } | null = null;                 // the last Light cue run: { id, at }
  let serial = 0;

  const homeOf = (key: string) => { const at = key.lastIndexOf('.'); const i = patch.instruments.get(key.slice(0, at)); const p = i && i.def.byKey.get(key.slice(at + 1)); return p ? p.home : 0; };
  /** A parameter is taken by the newest move: older moves let go of it. */
  function claim(keyList: Iterable<string>, except: string | null) {
    const keys = [...keyList];
    for (const [id, m] of moves) {
      if (id === except) continue;
      for (const k of keys) { m.to.delete(k); m.from.delete(k); }
      if (!m.to.size) moves.delete(id);
    }
  }
  function apply(m: Move) {
    for (const [k, to] of m.to) { const s = state.get(k); if (s) s.v = m.from.get(k)! + (to - m.from.get(k)!) * m.x; }
  }
  /** Start a move to `targets` (Map key → level). `secs` > 0 with `now`: timed; `external`: driven by progress(). */
  function move(id: string | undefined, targets: Levels, { secs = 0, now = 0, external = false }: Opts = {}): Move {
    const to = new Map([...targets].filter(([k]) => state.has(k)));
    claim(to.keys(), null);
    moves.delete(id!);
    const m: Move = { from: new Map([...to.keys()].map((k) => [k, state.get(k)!.v])), to, x: 0, timed: !external && secs > 0 ? { startedAt: now, total: secs } : null };
    if (!external && !(secs > 0)) { m.x = 1; apply(m); return m; }
    if (to.size) moves.set(id!, m);
    return m;
  }

  const api = {
    /** The patch changed (or a show was opened): instruments still there keep their levels, new ones start at home. */
    setPatch(light: CompiledPatch | LightInput | null): CompiledPatch {
      patch = light && light.instruments instanceof Map ? light as CompiledPatch : patchLib.compile(light as LightInput | null);
      const keep = new Set<string>();
      for (const inst of patch.instruments.values()) for (const p of inst.def.params) {
        const k = `${inst.key}.${p.key}`;
        keep.add(k);
        if (!state.has(k)) state.set(k, { v: p.home, base: p.home, cue: null, manual: false });
      }
      for (const k of [...state.keys()]) if (!keep.has(k)) state.delete(k);
      claim([...moves.values()].flatMap((m) => [...m.to.keys()]).filter((k) => !keep.has(k)), null);
      return patch;
    },
    patch: () => patch,

    /**
     * A Light cue goes: its commands, over its duration. Returns { id, count, errors }. With
     * `external` the move waits for progress(id, x); otherwise it runs on tick(), or lands at once.
     */
    run(cue: LightCueLike, { now = 0, external = false }: Opts = {}) {
      const { levels, errors } = commands.evaluate(cue.levels || '', patch);
      // a full state: whatever this cue does not name goes home with it
      if (cue.block) for (const k of state.keys()) if (!levels.has(k)) levels.set(k, homeOf(k));
      for (const [k, v] of levels) { const s = state.get(k); if (s) { s.base = v; s.cue = cue.id || null; s.manual = false; } }
      move(cue.id, levels, { secs: Number(cue.duration) || 0, now, external });
      latest = { id: cue.id || null, n: ++serial };
      return { id: cue.id, count: levels.size, errors };
    },
    /**
     * A Fade aimed at a Light cue: what that cue set goes back home (`out`), or to the levels the cue
     * holds again, over the Fade's own time. The move is the Fade's (`id`), so the Fade can be paused and stopped.
     */
    fadeCue(id: string, cue: LightCueLike, { out = true, secs = 0, now = 0, external = false }: Opts & { out?: boolean } = {}) {
      const { levels } = commands.evaluate(cue.levels || '', patch);
      if (out) for (const k of levels.keys()) levels.set(k, homeOf(k));
      for (const [k, v] of levels) { const s = state.get(k); if (s) { s.base = v; s.cue = out ? null : cue.id; s.manual = false; } }
      move(id, levels, { secs, now, external });
      return { id, count: levels.size };
    },
    /** How far an externally driven move has got (0–1). At 1 it has landed and is forgotten. */
    progress(id: string, x: unknown): boolean {
      const m = moves.get(id);
      if (!m) return false;
      m.x = Math.max(0, Math.min(1, Number(x) || 0));
      apply(m);
      if (m.x >= 1) moves.delete(id);
      return true;
    },
    finish(id: string) { return api.progress(id, 1); },
    /** A move stopped where it is: the levels stay as they are now. */
    halt(id: string) { return moves.delete(id); },
    haltAll() { const n = moves.size; moves.clear(); return n; },
    /** The moves in flight, and whether each is the engine's to drive: [{ id, external }]. */
    moving: () => [...moves].map(([id, m]) => ({ id, external: !m.timed, x: m.x })),

    /** Time passes for the moves that run on their own time. Returns whether anything is still moving. */
    tick(now: number) {
      for (const [id, m] of moves) {
        if (!m.timed) continue;
        m.x = Math.max(0, Math.min(1, (now - m.timed.startedAt) / m.timed.total));
        apply(m);
        if (m.x >= 1) moves.delete(id);
      }
      return moves.size > 0;
    },

    /** A hand on the lights: commands typed or a control moved, optionally over `secs`. Marked as not yet in any cue. */
    set(text: string, { secs = 0, now = 0 }: Opts = {}) {
      const { levels, errors } = commands.evaluate(text, patch);
      for (const k of levels.keys()) { const s = state.get(k); if (s) s.manual = true; }
      move(`hand:${++serial}`, levels, { secs, now });
      return { count: levels.size, errors };
    },
    /** One control moved: a level for one parameter of one instrument, or of every instrument a group holds. */
    setLevel(name: unknown, param: string | null, value: unknown, opts: Opts = {}) {
      return api.set(`${name}${param ? `.${param}` : ''} = ${Math.max(0, Math.min(100, Number(value) || 0))}`, opts);
    },
    /** What hands have changed goes back to what the cues last set. */
    revert({ secs = 0, now = 0 }: Opts = {}) {
      const back: Levels = new Map();
      for (const [k, s] of state) if (s.manual) { back.set(k, s.base); s.manual = false; }
      move(`revert:${++serial}`, back, { secs, now });
      return back.size;
    },
    /** Everything home (out, for most rigs), as if no cue had run. */
    clear({ secs = 0, now = 0 }: Opts = {}) {
      const home: Levels = new Map();
      for (const [k, s] of state) { const h = homeOf(k); home.set(k, h); s.base = h; s.cue = null; s.manual = false; }
      move(`clear:${++serial}`, home, { secs, now });
      latest = null;
    },
    setBlackout(on: unknown) { blackout = !!on; },
    blackout: () => blackout,

    /** The levels to write into a cue: only what hands have changed (`changes`), or everything. Map key → level, where each is heading. */
    capture({ changes = false } = {}) {
      const landing: Levels = new Map();
      for (const m of moves.values()) for (const [k, v] of m.to) landing.set(k, v);
      const out: Levels = new Map();
      for (const [k, s] of state) if (!changes || s.manual) out.set(k, Math.round((landing.has(k) ? landing.get(k)! : s.v) * 100) / 100);
      return out;
    },
    /** Those levels are now in cue `id`: they are no longer a hand's. */
    recorded(keys: string[], id: string | null | undefined) {
      for (const k of keys) { const s = state.get(k); if (s) { s.manual = false; s.base = s.v; s.cue = id || s.cue; } }
    },
    level(key: string) { const s = state.get(key); return s ? s.v : null; },
    changed: () => [...state.values()].filter((s) => s.manual).length,

    /** DMX, as it should be on the wire now: Map(universe id → Buffer of 512). Every universe set up gets a buffer, lit or not. */
    render(): Map<number, Buffer> {
      const out = new Map(patch.universes.map((u) => [u.id, Buffer.alloc(512)]));
      for (const inst of patch.instruments.values()) {
        if (!inst.patched) continue;
        const buf = out.get(inst.universe);
        if (!buf) continue;
        const def = inst.def;
        const master = def.virtual ? (blackout ? 0 : state.get(`${inst.key}.intensity`)!.v / 100) : 1;
        for (const p of def.params) {
          if (p.virtual) continue;
          let v = state.get(`${inst.key}.${p.key}`)!.v;
          if (def.virtual && def.colours.includes(p.key)) v *= master;
          else if (blackout && p.key === def.default) v = 0;
          const at = inst.address - 1 + p.offset;
          if (p.bits === 16) { const n = Math.round(Math.max(0, Math.min(100, v)) / 100 * 65535); buf[at] = n >> 8; buf[at + 1] = n & 0xff; }
          else buf[at] = Math.round(Math.max(0, Math.min(100, v)) / 100 * 255);
        }
      }
      return out;
    },

    /** For the dashboard: every instrument with its levels, the groups, and what is going on. */
    snapshot() {
      const r1 = (v: number) => Math.round(v * 10) / 10;
      const instruments = [...patch.instruments.values()].map((inst) => {
        const params = inst.def.params.map((p) => { const s = state.get(`${inst.key}.${p.key}`)!; return { key: p.key, value: r1(s.v), home: p.home, manual: s.manual, cue: s.cue }; });
        const get = (k: string) => { const p = params.find((x) => x.key === k); return p ? p.value : 0; };
        const has = (k: string) => inst.def.byKey.has(k);
        // the colour its emitters are mixing, at full: data about the light, shown as a swatch
        const colour = ['red', 'green', 'blue'].every(has)
          ? `#${[get('red') + get('white') + get('amber'), get('green') + get('white') + get('amber') * 0.6, get('blue') + get('white')].map((c) => Math.round(Math.min(100, c) * 2.55).toString(16).padStart(2, '0')).join('')}` : null;
        return { name: inst.name, key: inst.key, fixture: inst.def.id, fixtureName: inst.def.name, universe: inst.universe, address: inst.address, footprint: inst.def.footprint, patched: inst.patched,
                 default: inst.def.default, level: get(inst.def.default), colour, manual: params.some((p) => p.manual), params };
      });
      const byKey = new Map(instruments.map((i) => [i.key, i]));
      const groups = [...patch.groups.values()].map((g) => {
        const ls = g.members.map((m) => byKey.get(m)!.level);
        return { name: g.name, members: g.members.map((m) => byKey.get(m)!.name), direct: g.direct, level: ls.length ? r1(Math.max(...ls)) : 0, mixed: new Set(ls).size > 1, manual: g.members.some((m) => byKey.get(m)!.manual) };
      });
      return { instruments, groups, blackout, changed: api.changed(), moving: moves.size, latest: latest ? latest.id : null };
    },
  };
  return api;
}

export type Rig = ReturnType<typeof createRig>;

export { createRig };
