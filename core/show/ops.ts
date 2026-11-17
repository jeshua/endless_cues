/**
 * Edit operations: the one way a show document changes.
 *
 * The inspector, drag and drop, undo, a restored version and the assistant all
 * go through `applyOps(doc, ops)`. That is what makes an AI edit safe to show
 * before it lands: a proposal is a list of these, applying them to a copy
 * gives the document it would make, and diff.js says what changed.
 *
 * Pure: the input document is never touched. Throws OpError (with the index of
 * the op that failed) and changes nothing if any op is not valid: a batch
 * lands whole or not at all.
 *
 *   { op: 'cue.add',    cue: {type, ...fields, children?}, list?, parent?, before?, after? }
 *   { op: 'cue.set',    id, props: { field: value | null } }          null clears a field
 *   { op: 'cue.remove', id }
 *   { op: 'cue.move',   ids: [...], list?, parent?, before?, after? }
 *   { op: 'cue.duplicate', id }
 *   { op: 'cue.renumber', ids: [...], start, step?, prefix?, suffix? }    numbers other cues have are passed over
 *   { op: 'cue.unnumber', ids: [...] }
 *   { op: 'list.add',   name, cart? }   { op: 'list.rename', id, name }   { op: 'list.remove', id }
 *   { op: 'list.cart',  id, rows, columns }     a list becomes a cart of that size (cart.js); rows: null makes it a list again
 *   { op: 'show.set',   path: 'title' | 'notes' | 'settings.…' | 'modules.…', value }
 *   { op: 'device.add',    device: { name, …fields } }      a piece of equipment (core/rig/devices.js); `id` made from the name if left out;
 *                                                           with `model` and no commands, the model's are copied in
 *   { op: 'device.set',    id, props: { field: value | null } }     null clears; commands, reports and alive are set whole
 *   { op: 'device.remove', id }                             cues that named it become broken
 *
 * A cue may be named by its id, or by "#<number>" (its cue number) — which is how
 * people, and the assistant, talk about cues. A cue added earlier in the same
 * batch can be named by the `ref` it was given: { op: 'cue.add', ref: 'a', … }
 * then target: '@a'.
 *
 * An operation is also checked for its SHAPE before it is applied, because one
 * that can be applied and does nothing, or the wrong thing, is worse than one
 * that is refused: a key that is not one ("to" on a cue.move, which would land
 * at the end of the list), a cue.set with its fields beside "props" instead of
 * in it, a move that does not say where to. And the batch as a whole may not
 * leave a setting of the wrong kind (a port that is text, a bus with no id):
 * settingsTrouble says what, and anything new in it refuses the batch. These
 * checks are here, not in whoever is editing, so the inspector, the command
 * line and the assistant are all held to them and all get the same sentence.
 */
import { TYPES, fieldsOf, coerce } from './cue-types';
import * as show from './show';
import * as cart from './cart';
import { KIND_ORDER } from '../audio/kinds';
import * as rigDevices from '../rig/devices';
import * as sections from './sections';
import type { ShowDoc, Cue, CueFields, Device } from './types';

/** Where an added or moved cue lands: before or after a cue, at the end of a group, or at the end of a list. */
export interface Place { after?: string | null; before?: string | null; parent?: string | null; list?: string | null }
/** A cue as `cue.add` takes it: its type and fields, and its children (each one of these). */
export type CueSpec = { type: string; ref?: string; children?: CueSpec[] } & { [field in keyof CueFields]?: unknown } & { [field: string]: unknown };
/** The fields a `cue.set` or `device.set` changes: { field: value | null } (null clears it). */
export type Props = Record<string, unknown>;

/** One edit to a show (the list at the top of this file). */
export type Op =
  | ({ op: 'cue.add'; cue: CueSpec; ref?: string } & Place)
  | { op: 'cue.set'; id: string; props: Props }
  | { op: 'cue.remove'; id: string }
  | ({ op: 'cue.move'; ids?: string[]; id?: string } & Place)
  | { op: 'cue.duplicate'; id: string; ref?: string }
  | { op: 'cue.renumber'; ids: string[]; start?: number | string; step?: number | string; prefix?: string; suffix?: string }
  | { op: 'cue.unnumber'; ids: string[] }
  | { op: 'list.add'; name?: string; cart?: { rows?: number; columns?: number } | null }
  | { op: 'list.rename'; id: string; name: string }
  | { op: 'list.remove'; id: string }
  | { op: 'list.cart'; id: string; rows?: number | null; columns?: number | null }
  | { op: 'show.set'; path: string; value: unknown }
  | { op: 'device.add'; device: Partial<Device> }
  | { op: 'device.set'; id: string; props: Props }
  | { op: 'device.remove'; id: string };
export type OpName = Op['op'];

/** What applyOps gives back: the new show, the ids of the cues it made, their refs, and the devices it touched. */
export interface Applied { doc: ShowDoc; made: string[]; refs: Record<string, string>; devices: { added: string[]; changed: string[]; removed: string[] } }

class OpError extends Error {
  /** the index of the operation that failed (−1: the batch as a whole) */
  at: number;
  constructor(message: string, at: number) { super(message); this.name = 'OpError'; this.at = at; }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** What each operation takes: the shape check and the assistant's reference both read this. */
const PLACES = ['after', 'before', 'parent', 'list'];
const OP_KEYS: Record<OpName, string[]> = {
  'cue.add': ['cue', 'ref', ...PLACES],
  'cue.set': ['id', 'props'],
  'cue.remove': ['id'],
  'cue.move': ['ids', 'id', ...PLACES],
  'cue.duplicate': ['id', 'ref'],
  'cue.renumber': ['ids', 'start', 'step', 'prefix', 'suffix'],
  'cue.unnumber': ['ids'],
  'list.add': ['name', 'cart'],
  'list.rename': ['id', 'name'],
  'list.remove': ['id'],
  'list.cart': ['id', 'rows', 'columns'],
  'show.set': ['path', 'value'],
  'device.add': ['device'],
  'device.set': ['id', 'props'],
  'device.remove': ['id'],
};
const DEVICE_OPS = 'device.add, device.set and device.remove';

/** A show.set path with a bus or a patch named by its id, as the index the operation wants. */
function settingPath(pathText: string, doc: ShowDoc, fail: (msg: string) => never) {
  const keys = String(pathText || '').split('.');
  for (const [list, noun, at] of [[doc.settings.audio.buses, 'bus', 'settings.audio.buses'], [doc.settings.network.patches, 'patch', 'settings.network.patches']] as [{ id?: string }[], string, string][]) {
    const depth = at.split('.').length;
    if (keys.slice(0, depth).join('.') !== at || keys.length === depth) continue;
    const k = keys[depth];
    const known = list.map((x) => x && x.id).join(', ') || 'none';
    if (/^\d+$/.test(k)) { if (Number(k) >= list.length) fail(`there is no ${noun} at ${k} (${list.length} in the show: ${known}). To add one, set the whole list at ${at}.`); continue; }
    const i = list.findIndex((x) => x && x.id === k);
    if (i < 0) fail(`no ${noun} with the id “${k}” (the show has: ${known}). To add one, set the whole list at ${at}.`);
    keys[depth] = String(i);
  }
  return keys.join('.');
}

/** One operation as the switch below wants it, or a refusal that says what to send instead. `doc` is the show as the batch has left it so far. */
function shaped(o: any, doc: ShowDoc, fail: (msg: string) => never): Op {
  if (!o || typeof o !== 'object' || Array.isArray(o)) fail('not an operation (an object with "op")');
  const keys = OP_KEYS[o.op as OpName];
  if (!keys) fail(`unknown operation (the operations are ${Object.keys(OP_KEYS).join(', ')})`);
  for (const k of Object.keys(o)) if (k !== 'op' && !keys.includes(k)) fail(`“${k}” is not something a ${o.op} takes (it takes: ${keys.join(', ')})`);
  const places = PLACES.filter((k) => keys.includes(k) && o[k] != null);
  if (places.length > 1) fail(`say where once: ${places.join(' and ')} were both given`);
  switch (o.op) {
    case 'cue.add':
      if (!o.cue || typeof o.cue !== 'object' || Array.isArray(o.cue)) fail('"cue" is required: { "type": …, …fields }');
      break;
    case 'cue.set':
      if (!o.props || typeof o.props !== 'object' || Array.isArray(o.props) || !Object.keys(o.props).length) fail('"props" is required: the fields to change, { "field": value }');
      break;
    case 'cue.move':
      if (!([] as string[]).concat(o.ids || o.id || []).length) fail('"ids" is required: the cues to move');
      if (!places.length) fail('say where to: "before" or "after" a cue, "parent" (a group) or "list"');
      break;
    case 'cue.renumber':
      if (!([] as string[]).concat(o.ids || []).length) fail('"ids" is required: the cues to renumber, in order');
      for (const k of ['start', 'step']) if (o[k] != null && !Number.isFinite(Number(o[k]))) fail(`"${k}" is a number (use "prefix" and "suffix" for letters)`);
      break;
    case 'device.add':
      if (!o.device || typeof o.device !== 'object' || Array.isArray(o.device)) fail('"device" is required: { "name": …, "host": …, "port": …, "commands": [ … ] } (or "model" and the model’s commands are copied in)');
      break;
    case 'device.set':
      if (!o.id) fail('"id" is required: the device to change');
      if (!o.props || typeof o.props !== 'object' || Array.isArray(o.props) || !Object.keys(o.props).length) fail('"props" is required: the fields to change, { "field": value }');
      break;
    case 'device.remove':
      if (!o.id) fail('"id" is required: the device to remove');
      break;
    case 'show.set':
      if (!('value' in o)) fail('"value" is required');
      // (a device has commands that must fit their messages, and an id cues hold on to: it is changed by its own operations, which check both)
      // (the whole of settings.rig may be set, which is how another show's settings file brings its equipment: every device in it is still held to the same checks when the batch ends)
      if (String(o.path || '').startsWith('settings.rig.devices')) fail(`devices are added and changed with ${DEVICE_OPS}, not show.set`);
      if (o.path === 'settings.rig.checks' && !Array.isArray(o.value)) fail('settings.rig.checks is set whole: a list of { "id": …, "text": … }');
      if (o.path === 'settings.rig.script' && typeof o.value !== 'string') fail('settings.rig.script is text: the name of a text file in the show folder ("" for none)');
      if ((o.path === 'settings.audio.buses' || o.path === 'settings.network.patches') && !Array.isArray(o.value)) fail(`${o.path} is a list ([ { "id": …, "name": …, … } ]); to change one of them, name it in the path (${o.path}.<id>.<setting>)`);
      if (o.path === 'settings.audio.buses' && !o.value.length) fail('a show keeps at least one bus');
      return { ...o, path: settingPath(o.path, doc, fail) };
    default:
  }
  return o;
}

/** What is wrong with a show's settings, as sentences: things show.set would otherwise let through. */
function settingsTrouble(doc: ShowDoc): string[] {
  const out: string[] = [];
  const kinds = (base: object, node: any, at: string) => {
    for (const [k, want] of Object.entries(base)) {
      const have = node == null ? undefined : node[k];
      if (Array.isArray(want)) { if (!Array.isArray(have)) out.push(`${at}${k} is a list`); continue; }
      if (want && typeof want === 'object') { if (!have || typeof have !== 'object' || Array.isArray(have)) out.push(`${at}${k} cannot be replaced by ${JSON.stringify(have)}: set the settings inside it`); else kinds(want, have, `${at}${k}.`); continue; }
      if (typeof have !== typeof want) out.push(`${at}${k} is ${typeof want === 'boolean' ? 'true or false' : typeof want === 'number' ? 'a number' : 'text'} (it was given ${JSON.stringify(have)})`);
      else if (typeof want === 'number' && !Number.isFinite(have)) out.push(`${at}${k} is a number`);
    }
  };
  kinds(show.defaultSettings(), doc.settings, 'settings.');
  kinds(show.defaultModules(), doc.modules, 'modules.');
  const items = <T extends { id?: unknown; name?: unknown }>(list: T[], at: string, noun: string, each: (x: T, at: string) => void) => {
    const seen = new Set();
    for (let i = 0; i < (Array.isArray(list) ? list.length : 0); i++) {
      const x = list[i];
      if (!x || typeof x !== 'object' || Array.isArray(x)) { out.push(`${at}.${i} is not a ${noun}: a ${noun} is an object with an id and a name`); continue; }
      if (typeof x.id !== 'string' || !x.id.trim()) out.push(`${at}.${i}: a ${noun} needs an "id" (a short word; cues name it by this)`);
      else if (seen.has(x.id)) out.push(`${at}: two ${noun}es have the id “${x.id}”`);
      seen.add(x.id);
      if (typeof x.name !== 'string' || !x.name.trim()) out.push(`${at}.${i}: a ${noun} needs a "name"`);
      each(x, `${at}.${x.id || i}`);
    }
  };
  items(doc.settings.audio.buses, 'settings.audio.buses', 'bus', (b, at) => {
    if (b.db !== undefined && (typeof b.db !== 'number' || !Number.isFinite(b.db))) out.push(`${at}.db is a number of dB (it was given ${JSON.stringify(b.db)})`);
    if (b.out !== undefined && !(Number.isInteger(b.out) && b.out >= 1 && b.out % 2 === 1)) out.push(`${at}.out is the first of a pair of outputs: 1, 3, 5 … (it was given ${JSON.stringify(b.out)})`);
    // what kind of sound it carries, and what its kind was offered (core/audio/kinds.js)
    if (b.kind !== undefined && !(KIND_ORDER as readonly string[]).includes(b.kind)) out.push(`${at}.kind is one of ${KIND_ORDER.join(', ')} (it was given ${JSON.stringify(b.kind)})`);
    if (b.noDuck !== undefined && typeof b.noDuck !== 'boolean') out.push(`${at}.noDuck is true or false (it was given ${JSON.stringify(b.noDuck)})`);
    for (const k of ['stopFade', 'oneAtATime'] as const) if (b[k] !== undefined && !(typeof b[k] === 'number' && b[k] >= 0 && b[k] <= 60)) out.push(`${at}.${k} is a time in seconds, 0 to 60 (it was given ${JSON.stringify(b[k])})`);
  });
  items(doc.settings.network.patches, 'settings.network.patches', 'patch', (p, at) => {
    if (typeof p.host !== 'string') out.push(`${at}: a patch needs a "host" (an address)`);
    if (!(Number.isInteger(p.port) && p.port > 0 && p.port < 65536)) out.push(`${at}: a patch needs a "port" (a number, 1–65535)`);
  });
  // the rig: each device as core/rig/devices.js holds it to (and no id shared with a patch or another device), and the checklist
  const rig = doc.settings.rig || {};
  for (const d of Array.isArray(rig.devices) ? rig.devices : []) out.push(...rigDevices.trouble(d, doc));
  const ticks = new Set();
  for (const [i, k] of (Array.isArray(rig.checks) ? rig.checks : []).entries()) {
    if (!k || typeof k !== 'object' || Array.isArray(k) || typeof k.text !== 'string' || !k.text.trim()) { out.push(`settings.rig.checks.${i} is not a line of the checklist: a line is { "id": …, "text": … }`); continue; }
    if (typeof k.id !== 'string' || !k.id.trim()) out.push(`settings.rig.checks.${i}: a line needs an "id" (a short word; its tick is kept by it)`);
    else if (ticks.has(k.id)) out.push(`settings.rig.checks: two lines have the id “${k.id}”`);
    ticks.add(k.id);
  }
  return out;
}

function applyOps(input: ShowDoc, ops: readonly Op[]): Applied {
  if (!Array.isArray(ops)) throw new OpError('ops: a list of operations', -1);
  const doc = clone(input);
  const refs = new Map<string, string>();
  const made: string[] = [];
  const devices: Applied['devices'] = { added: [], changed: [], removed: [] };      // the ids of the devices this batch touched (`made` is for cues)
  let at = 0;
  const fail: (msg: string) => never = (msg) => { throw new OpError(`op ${at + 1}${ops[at] && typeof ops[at].op === 'string' ? ` (${ops[at].op})` : ''}: ${msg}`, at); };

  const resolve = (name: unknown, what = 'cue'): string => {
    if (name == null || name === '') fail(`no ${what} named`);
    const s = String(name);
    if (s.startsWith('@')) { if (!refs.has(s.slice(1))) fail(`no cue was added with ref ${s.slice(1)}`); return refs.get(s.slice(1))!; }
    if (s.startsWith('#')) { const c = show.findByNumber(doc, s.slice(1)); if (!c) fail(`no cue numbered ${s.slice(1)}`); return c.id; }
    if (!show.locate(doc, s)) {
      const c = show.findByNumber(doc, s);       // forgiving: a bare number
      if (c) return c.id;
      fail(`no ${what} ${s}`);
    }
    return s;
  };
  const listById = (id: unknown) => doc.lists.find((l) => l.id === id || l.name === id) || fail(`no list ${id}`);
  // (a cue named here has been resolved: it is in the show)
  const found = (id: string) => show.locate(doc, id)!;

  /** Where an add / move lands: { siblings, at }. */
  const place = (o: Place, moving: string[] = []) => {
    let siblings: Cue[];
    if (o.before != null || o.after != null) {
      const anchor = resolve(o.before != null ? o.before : o.after);
      if (moving.includes(anchor)) fail('cannot place a cue relative to itself');
      const loc = found(anchor);
      return { siblings: loc.siblings, at: loc.at + (o.before != null ? 0 : 1) };
    }
    if (o.parent != null) {
      const pid = resolve(o.parent, 'group');
      const p = found(pid);
      const g = p.siblings[p.at];
      if (!TYPES[g.type].container) fail(`${g.number || g.id} is not a group`);
      siblings = g.children || (g.children = []);
    } else siblings = (o.list != null ? listById(o.list) : doc.lists[0]).cues;
    return { siblings, at: siblings.length };
  };

  const setProps = (cue: Cue, props: Props | undefined) => {
    for (const [key, raw] of Object.entries(props || {})) {
      if (key === 'id' || key === 'type' || key === 'children') fail(`${key} cannot be set`);
      const f = fieldsOf(cue.type).find((x) => x.key === key);
      if (!f) fail(`a ${TYPES[cue.type].label} cue has no field “${key}” (it has: ${fieldsOf(cue.type).filter((x) => !x.hidden).map((x) => x.key).join(', ')})`);
      let value = raw;
      // (a target that may be a whole cue list: its id, or "list:" and its name)
      const whole = f.kind === 'cue' && f.lists ? doc.lists.find((l) => l.id === raw || `list:${l.name}` === raw) : null;
      if (whole) value = whole.id;
      else if (f.kind === 'cue' && raw != null && raw !== '') value = resolve(raw);
      const r = coerce({ ...f, required: false }, value);
      if (!r.ok) fail(r.why);
      if (r.value === undefined) delete cue[key]; else cue[key] = r.value;
    }
  };

  const build = (spec: CueSpec): { cue: Cue; pending: (() => void)[] } => {
    if (!spec || !TYPES[spec.type]) fail(`unknown cue type ${JSON.stringify(spec && spec.type)} (types: ${Object.keys(TYPES).join(', ')})`);
    const cue: Cue = { id: show.newId(), type: spec.type as Cue['type'] };
    const { type, children, id, ref, ...props } = spec;
    if (ref) refs.set(String(ref), cue.id);
    made.push(cue.id);
    if (TYPES[type].container) cue.children = [];
    // children first, so the group's own fields (and theirs) can name each other by @ref
    if (children && !TYPES[type].container) fail(`a ${TYPES[type].label} cue cannot have children`);
    const pending = [() => setProps(cue, props)];
    for (const k of children || []) { const b = build(k); cue.children!.push(b.cue); pending.push(...b.pending); }
    return { cue, pending };
  };

  const isInside = (id: string, ancestorId: string) => {
    const a = found(ancestorId);
    let hit = false;
    const go = (cues: Cue[] | undefined) => { for (const c of cues || []) { if (c.id === id) hit = true; go(c.children); } };
    go(a.siblings[a.at].children);
    return hit;
  };

  for (at = 0; at < ops.length; at++) {
    const o = shaped(ops[at], doc, fail);
    switch (o.op) {
      case 'cue.add': {
        const where = place(o);
        const b = build({ ...o.cue, ref: o.ref || (o.cue && o.cue.ref) });
        where.siblings.splice(where.at, 0, b.cue);
        for (const run of b.pending) run();
        break;
      }
      case 'cue.set': {
        const loc = found(resolve(o.id));
        setProps(loc.siblings[loc.at], o.props);
        break;
      }
      case 'cue.remove': {
        const loc = found(resolve(o.id));
        loc.siblings.splice(loc.at, 1);
        break;
      }
      case 'cue.move': {
        const ids = ([] as string[]).concat(o.ids || o.id || []).map((x) => resolve(x));
        if (!ids.length) fail('no cues to move');
        if (o.parent != null) { const pid = resolve(o.parent, 'group'); for (const id of ids) if (id === pid || isInside(pid, id)) fail('cannot move a group into itself'); }
        if (o.before != null || o.after != null) { const anchor = resolve(o.before != null ? o.before : o.after); for (const id of ids) if (id !== anchor && found(id).siblings[found(id).at].children && isInside(anchor, id)) fail('cannot move a group into itself'); }
        // take them out (in document order), then put them in at the anchor
        const taken: Cue[] = [];
        for (const id of ids) { const loc = show.locate(doc, id); if (!loc) continue; taken.push(loc.siblings.splice(loc.at, 1)[0]); }
        const where = place(o, ids);
        where.siblings.splice(where.at, 0, ...taken);
        break;
      }
      case 'cue.duplicate': {
        const loc = found(resolve(o.id));
        const copy = clone(loc.siblings[loc.at]);
        const remap = new Map<string, string>();
        const reid = (c: Cue) => { const id = show.newId(); remap.set(c.id, id); c.id = id; made.push(id); (c.children || []).forEach(reid); };
        reid(copy);
        // a target inside the copy follows the copy; one outside stays
        const retarget = (c: Cue) => { if (c.target && remap.has(c.target)) c.target = remap.get(c.target); (c.children || []).forEach(retarget); };
        retarget(copy);
        // numbers are not copied (two cues with one number): the copy and everything in it start unnumbered
        const unnumber = (c: Cue) => { if (c.number) delete c.number; (c.children || []).forEach(unnumber); };
        unnumber(copy);
        if (o.ref) refs.set(String(o.ref), copy.id);
        loc.siblings.splice(loc.at + 1, 0, copy);
        break;
      }
      case 'cue.renumber': {
        const ids = ([] as string[]).concat(o.ids || []).map((x) => resolve(x));
        const step = Number.isFinite(Number(o.step)) && Number(o.step) !== 0 ? Number(o.step) : 1;
        let n = Number.isFinite(Number(o.start)) ? Number(o.start) : 1;
        const places = Math.max(...[n, step].map((x) => (String(x).split('.')[1] || '').length));
        // a number another cue already has (one that is not being renumbered) is passed over, never given twice
        const taken = new Set<string>();
        show.walk(doc, (c) => { if (c.number != null && c.number !== '' && !ids.includes(c.id)) taken.add(String(c.number).toLowerCase()); });
        for (const id of ids) {
          const loc = found(id);
          if (loc.siblings[loc.at].type === 'section') continue;      // (a heading is not called, so it has no number)
          const text = () => `${o.prefix || ''}${places ? n.toFixed(places) : n}${o.suffix || ''}`;
          for (let tries = 0; taken.has(text().toLowerCase()) && tries < 100000; tries++) n += step;
          loc.siblings[loc.at].number = text();
          n += step;
        }
        break;
      }
      case 'cue.unnumber': {
        for (const id of ([] as string[]).concat(o.ids || []).map((x) => resolve(x))) { const loc = found(id); delete loc.siblings[loc.at].number; }
        break;
      }
      case 'list.add': {
        const name = String(o.name || '').trim() || `List ${doc.lists.length + 1}`;
        if (doc.lists.some((l) => l.name === name)) fail(`there is already a list called ${name}`);
        if (o.cart != null && !cart.cleanCart(o.cart)) fail('"cart" is the size of the grid: { "rows": 4, "columns": 4 }');
        doc.lists.push({ id: show.newId('list'), name, ...(o.cart != null ? { cart: cart.cleanCart(o.cart)! } : {}), cues: [] });
        break;
      }
      case 'list.cart': {
        const l = listById(o.id);
        if (o.rows == null && o.columns == null) { delete l.cart; break; }
        for (const k of ['rows', 'columns'] as const) if (!(Number.isInteger(Number(o[k])) && Number(o[k]) >= 1 && Number(o[k]) <= cart.MAX)) fail(`"${k}" is a whole number from 1 to ${cart.MAX} (rows: null makes it a plain list again)`);
        l.cart = { rows: Number(o.rows), columns: Number(o.columns) };
        break;
      }
      case 'list.rename': {
        const l = listById(o.id);
        const name = String(o.name || '').trim();
        if (!name) fail('a list needs a name');
        if (doc.lists.some((x) => x !== l && x.name === name)) fail(`there is already a list called ${name}`);
        l.name = name;
        break;
      }
      case 'list.remove': {
        const l = listById(o.id);
        if (doc.lists.length === 1) fail('a show keeps at least one list');
        doc.lists.splice(doc.lists.indexOf(l), 1);
        break;
      }
      case 'show.set': {
        const path = String(o.path || '');
        if (!(path === 'title' || path === 'notes' || path.startsWith('settings.') || path.startsWith('modules.'))) fail(`cannot set ${path} (title, notes, settings.…, modules.…)`);
        const keys = path.split('.');
        if (keys.some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype' || k === '')) fail('bad path');
        let node: any = doc;
        for (const k of keys.slice(0, -1)) { if (!node[k] || typeof node[k] !== 'object') node[k] = {}; node = node[k]; }
        if (o.value === undefined) delete node[keys.at(-1)!]; else node[keys.at(-1)!] = clone(o.value);
        break;
      }
      // ── devices (core/rig/devices.js): each is held to `trouble` as it lands; an id shared with a patch is the
      //    whole batch's to answer for (below), so a patch can be made a device in either order ──
      case 'device.add': {
        const rig = doc.settings.rig;
        const taken = new Set([...rig.devices.map((d) => d.id), ...doc.settings.network.patches.map((p) => p && p.id)]);
        let d: Record<string, any> = clone(o.device);       // (as asked for: `trouble` checks it below)
        if (d.model !== undefined && d.model !== null && d.model !== '') {
          const all = Object.keys(require('../net/devices').DEVICES);
          if (!all.includes(d.model)) fail(`no model “${d.model}” (the models are: ${all.join(', ')})`);
          if (!Array.isArray(d.commands) || !d.commands.length) d = rigDevices.fromModel(d.model, d)!;
        }
        if (typeof d.name !== 'string' || !d.name.trim()) fail('a device needs a name');
        if (d.id === undefined || d.id === null || d.id === '') d.id = rigDevices.idFrom(d.name, taken);
        if (rig.devices.some((x) => x.id === d.id)) fail(`there is already a device with the id ${d.id} (${rig.devices.find((x) => x.id === d.id)!.name}): change it with device.set, or give this one another id`);
        const bad = rigDevices.trouble(d);
        if (bad.length) fail(bad[0]);
        rig.devices.push(rigDevices.clean(d).device!);
        devices.added.push(d.id);
        break;
      }
      case 'device.set': {
        const rig = doc.settings.rig;
        const i = rig.devices.findIndex((d) => d.id === o.id);
        if (i < 0) fail(`no device with the id “${o.id}” (the show has: ${rig.devices.map((d) => d.id).join(', ') || 'none'})`);
        const d = clone(rig.devices[i]);
        for (const [key, value] of Object.entries(o.props)) {
          if (key === 'id') fail('a device’s id cannot be changed: cues name it (to rename the device, set "name")');
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail('bad field');
          if (value === null || value === undefined) delete d[key]; else d[key] = clone(value);
        }
        const bad = rigDevices.trouble(d);
        if (bad.length) fail(bad[0]);
        rig.devices[i] = rigDevices.clean(d).device!;
        if (!devices.added.includes(o.id) && !devices.changed.includes(o.id)) devices.changed.push(o.id);
        break;
      }
      case 'device.remove': {
        const rig = doc.settings.rig;
        const i = rig.devices.findIndex((d) => d.id === o.id);
        if (i < 0) fail(`no device with the id “${o.id}” (the show has: ${rig.devices.map((d) => d.id).join(', ') || 'none'})`);
        rig.devices.splice(i, 1);
        if (devices.added.includes(o.id)) devices.added.splice(devices.added.indexOf(o.id), 1); else devices.removed.push(o.id);
        break;
      }
      default: fail('unknown operation');
    }
  }
  // the result must still be a show this app can open
  let clean: ShowDoc;
  try { clean = show.normalise(doc).doc; } catch (err) { throw new OpError(`that would leave the show unreadable (${(err as Error).message})`, -1); }
  // and no setting may be left as something it cannot be (what was already wrong before the batch is not this batch's to answer for)
  const had = new Set(settingsTrouble(input));
  const bad = settingsTrouble(clean).find((t) => !had.has(t));
  if (bad) throw new OpError(bad, -1);
  // a section stays a heading of a list: never inside a group, never in a cart
  const hadSections = new Set(sections.trouble(input));
  const badSection = sections.trouble(clean).find((t) => !hadSections.has(t));
  if (badSection) throw new OpError(badSection, -1);
  return { doc: clean, made, refs: Object.fromEntries(refs), devices };
}

export { applyOps, OpError, OP_KEYS, PLACES, settingsTrouble };
