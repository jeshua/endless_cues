/**
 * The light patch: which instruments there are, what kind each is, and where each sits in DMX.
 *
 * It is part of the show file (`settings.light`), so it is versioned, undoable and travels with the show:
 *
 *   universes    [{ id: 1, protocol: 'artnet' | 'sacn', address: 0, host: '' }]
 *                `id` is the number an instrument names; `address` is the universe as the protocol
 *                counts it (Art-Net from 0, sACN from 1); `host` empty means broadcast (Art-Net) or
 *                the universe's multicast group (sACN)
 *   instruments  [{ name: 'front', fixture: 'dimmer', universe: 1, address: 1, note: '' }]
 *                `address` is the first DMX channel (1–512); a fixture of several channels takes the next ones
 *   groups       [{ name: 'wash', members: ['front', 'side L', 'another group'] }]
 *   fixtures     the show's own fixture definitions (core/light/fixtures.js)
 *
 * Names are how cues talk about lights ("front = 80"), so they are compared without case, are unique
 * across instruments and groups, and cannot be "all" (every instrument, always there) or look like a
 * range ("1-3"). A number is a fine name: "1 - 12 = 50" then means those twelve.
 *
 * `compile(light)` never throws on a patch a person could have typed: what cannot work is listed in
 * `problems` and that instrument is left unpatched (it keeps its levels, and nothing is sent for it).
 */
import * as fixtures from './fixtures';
import type { FixtureDef, FixtureSource } from './fixtures';

/** A universe as the patch keeps it. */
export interface LightUniverse { id: number; protocol: 'artnet' | 'sacn'; address: number; host?: string }
/** An instrument as the patch keeps it (with no universe or address: not patched yet). */
export interface LightInstrument { name: string; fixture: string; universe?: number; address?: number; note?: string }
export interface LightGroup { name: string; members: string[] }
/** `settings.light`. */
export interface LightSettings {
  on: boolean; rate: number; panicBlackout: boolean;
  universes: LightUniverse[]; instruments: LightInstrument[]; groups: LightGroup[]; fixtures: FixtureSource[];
}
/** A patch as it may arrive (a show file, an edit, a test): read forgivingly by `compile`. */
export interface LightInput {
  on?: unknown; rate?: unknown; panicBlackout?: unknown;
  universes?: { id?: unknown; protocol?: unknown; address?: unknown; host?: unknown }[];
  instruments?: { name?: unknown; fixture?: unknown; universe?: unknown; address?: unknown; note?: unknown }[];
  groups?: { name?: unknown; members?: unknown }[];
  fixtures?: FixtureSource[];
}
/** An instrument once compiled: its definition, and whether it has DMX channels of its own. */
export interface PatchedInstrument { key: string; name: string; def: FixtureDef; universe: number; address: number; note: string; patched: boolean }
export interface PatchProblem { where: string; why: string }

const NAME = /^[\p{L}\p{N}][\p{L}\p{N} _'-]*$/u;
const keyOf = (name: unknown) => String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();
const RESERVED = new Set(['all', 'home', 'pass', 'full', 'out', 'cue']);

/** Why a name cannot be an instrument's or a group's, or '' when it can. */
function badName(name: unknown): string {
  const k = keyOf(name);
  if (!k) return 'it needs a name';
  if (!NAME.test(k)) return `“${name}” has a character a name cannot (letters, digits, spaces, _ ' -)`;
  if (RESERVED.has(k)) return `“${name}” is a word the light commands use`;
  if (/^\d+\s*-\s*\d+$/.test(k)) return `“${name}” reads as a range of numbers`;
  return '';
}

function defaults(): LightSettings {
  return { on: false, rate: 40, panicBlackout: false, universes: [], instruments: [], groups: [], fixtures: [] };
}

function compile(light?: LightInput | null) {
  const src = { ...defaults(), ...(light && typeof light === 'object' ? light : {}) };
  const defs = fixtures.all(src.fixtures);
  const problems: PatchProblem[] = [];
  const instruments = new Map<string, PatchedInstrument>();     // key -> { key, name, def, universe, address, patched, note }
  const groups = new Map<string, { key: string; name: string; members: string[]; direct: string[] }>();          // key -> { key, name, members: [instrument keys] }
  const universes: { id: number; protocol: 'artnet' | 'sacn'; address: number | null; host: string }[] = [];
  const seenU = new Set<number>();
  for (const u of Array.isArray(src.universes) ? src.universes : []) {
    const id = Math.round(Number(u && u.id));
    if (!(id >= 1) || seenU.has(id)) { problems.push({ where: `universe ${u && u.id}`, why: seenU.has(id) ? 'is there twice' : 'needs a number from 1' }); continue; }
    seenU.add(id);
    const protocol = u.protocol === 'sacn' ? 'sacn' : 'artnet';
    const address = Math.round(Number(u.address));
    const max = protocol === 'sacn' ? 63999 : 32767, min = protocol === 'sacn' ? 1 : 0;
    const ok = Number.isFinite(address) && address >= min && address <= max;
    if (!ok) problems.push({ where: `universe ${id}`, why: `${protocol === 'sacn' ? 'an sACN universe is 1 to 63999' : 'an Art-Net universe is 0 to 32767'}: nothing is sent for it` });
    universes.push({ id, protocol, address: ok ? address : null, host: String(u.host || '').trim() });
  }

  const taken = new Map<number, string[]>();           // universe id -> [instrument key per channel]
  for (const raw of Array.isArray(src.instruments) ? src.instruments : []) {
    const name = String((raw && raw.name) || '').trim();
    const key = keyOf(name);
    const bad = badName(name);
    if (bad) { problems.push({ where: name || '(an instrument)', why: bad }); continue; }
    if (instruments.has(key)) { problems.push({ where: name, why: 'two instruments have this name: the second is left out' }); continue; }
    const def = defs.get(String(raw.fixture || 'dimmer'));
    if (!def) { problems.push({ where: name, why: `its fixture “${raw.fixture}” is not in the library or the show` }); continue; }
    const universe = Math.round(Number(raw.universe)) || 0, address = Math.round(Number(raw.address)) || 0;
    const inst = { key, name, def, universe, address, note: String(raw.note || ''), patched: false };
    instruments.set(key, inst);
    if (!universe || !address) continue;                      // not patched yet: it has levels, and nothing is sent for it
    if (address < 1 || address + def.footprint - 1 > 512) { problems.push({ where: name, why: `address ${address}${def.footprint > 1 ? ` (${def.footprint} channels)` : ''} does not fit in a universe of 512` }); continue; }
    if (!seenU.has(universe)) problems.push({ where: name, why: `universe ${universe} is not set up (Settings ▸ Integrations ▸ Light): nothing is sent for it` });
    const used = taken.get(universe) || taken.set(universe, new Array(513)).get(universe)!;
    let clash: string | null = null;
    for (let c = address; c < address + def.footprint; c++) if (used[c]) clash = used[c];
    if (clash) { problems.push({ where: name, why: `shares DMX channels with ${instruments.get(clash)!.name} (universe ${universe}): it is left unpatched` }); continue; }
    for (let c = address; c < address + def.footprint; c++) used[c] = key;
    inst.patched = true;
  }

  // groups may hold groups: each is flattened to its instruments (one that holds itself stops there)
  const rawGroups = new Map<string, { name: string; members: string[] }>();
  for (const g of Array.isArray(src.groups) ? src.groups : []) {
    const name = String((g && g.name) || '').trim(), key = keyOf(name);
    const bad = badName(name);
    if (bad) { problems.push({ where: name || '(a group)', why: bad }); continue; }
    if (instruments.has(key) || rawGroups.has(key)) { problems.push({ where: name, why: 'this name is already an instrument’s or a group’s' }); continue; }
    rawGroups.set(key, { name, members: (Array.isArray(g.members) ? g.members : []).map(keyOf).filter(Boolean) });
  }
  const flat = (key: string, seen: Set<string>): string[] => {
    const out: string[] = [];
    for (const m of rawGroups.get(key)!.members) {
      if (instruments.has(m)) out.push(m);
      else if (rawGroups.has(m)) { if (!seen.has(m)) out.push(...flat(m, new Set([...seen, m]))); }
      else problems.push({ where: rawGroups.get(key)!.name, why: `its member “${m}” is not an instrument or a group` });
    }
    return out;
  };
  for (const [key, g] of rawGroups) groups.set(key, { key, name: g.name, members: [...new Set(flat(key, new Set([key])))], direct: g.members });

  return {
    instruments, groups, universes, problems, defs,
    on: !!src.on, rate: Math.max(1, Math.min(44, Number(src.rate) || 40)), panicBlackout: !!src.panicBlackout,
    /** The instruments a name means: an instrument, a group, or "all". null: nothing has that name. */
    resolve(name: unknown): string[] | null {
      const k = keyOf(name);
      if (k === 'all') return [...instruments.keys()];
      if (instruments.has(k)) return [k];
      if (groups.has(k)) return groups.get(k)!.members;
      return null;
    },
  };
}

/** The next free address in a universe for a fixture of `footprint` channels (auto-patch): 0 when it is full. */
function nextFree(compiled: CompiledPatch, universe: number, footprint = 1): number {
  const used = new Array(514).fill(false);
  for (const i of compiled.instruments.values()) if (i.patched && i.universe === universe) for (let c = i.address; c < i.address + i.def.footprint; c++) used[c] = true;
  for (let a = 1; a + footprint - 1 <= 512; a++) { let free = true; for (let c = a; c < a + footprint; c++) if (used[c]) { free = false; a = c; break; } if (free) return a; }
  return 0;
}

export type CompiledPatch = ReturnType<typeof compile>;

export { compile, defaults, badName, keyOf, nextFree };
