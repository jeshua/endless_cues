/**
 * What changed between two show documents, in terms an operator reads:
 * cues added, removed, moved and changed (field by field), lists and settings.
 *
 * Used for: the review of an assistant's proposal before it lands, the note
 * written for a saved version ("3 level −8 dB, 12 renamed"), and comparing
 * any two versions. Cues are matched by id, so a renumbered or renamed cue is
 * a change, not a remove and an add.
 */
import { TYPES, fieldsOf, formatSeconds, defaultName } from './cue-types';
import * as show from './show';
import * as rigDevices from '../rig/devices';
import type { Field } from './cue-types';
import type { ShowDoc, Cue, CueIndex, Device, DeviceAlive, DeviceCommand, DeviceReport, Destination } from './types';

/** One field that changed, as it reads (`from`, `to`) and as it was (`rawFrom`, `rawTo`). */
export interface FieldChange { field: string; label: string; from: string; to: string; rawFrom: unknown; rawTo: unknown }
/** One thing that changed between two shows. */
export type Change =
  | { kind: 'added' | 'removed'; id: string; label: string; type: string; list: string; count: number }
  | { kind: 'changed'; id: string; label: string; type: string; fields: FieldChange[] }
  | { kind: 'moved'; id: string; label: string; type: string; to: string }
  | { kind: 'list-added' | 'list-removed'; label: string }
  | { kind: 'list-renamed'; label: string; from: string }
  | { kind: 'list-cart'; label: string; to: string }
  | { kind: 'setting'; path: string; from: string; to: string }
  | { kind: 'device-added' | 'device-removed'; id: string; label: string; text: string }
  | { kind: 'device-changed'; id: string; label: string; fields: FieldChange[] };

/** A cue where it sits: its group (id), its list, the cue before it, its place in the show, and what it is called. */
interface Flat { cue: Cue; parent: string | null; list: string; listName: string; prev: string | null; order: number; label: string }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function flat(doc: ShowDoc) {
  const out = new Map<string, Flat>();
  const { byId } = show.index(doc);
  let order = 0;
  show.walk(doc, (c, parent, list) => {
    const sibs = parent ? parent.children! : list.cues;
    out.set(c.id, { cue: c, parent: parent ? parent.id : null, list: list.id, listName: list.name, prev: sibs[sibs.indexOf(c) - 1]?.id || null, order: order++,
                    label: `${c.number ? c.number + ' ' : ''}${c.name || defaultName(c, byId)}`.trim() });
  });
  return out;
}

function fmt(field: Field | null, v: any): string {
  if (v === undefined || v === null || v === '') return '—';
  if (!field) return typeof v === 'object' ? JSON.stringify(v) : String(v);
  switch (field.kind) {
    case 'seconds': return formatSeconds(Number(v), 2);
    case 'db': return Number(v) <= -60 ? '−∞ dB' : `${Number(v) > 0 ? '+' : ''}${String(v).replace('-', '−')} dB`;
    case 'bool': return v ? 'on' : 'off';
    case 'markers': case 'regions': case 'numbers': return `${v.length} item${v.length === 1 ? '' : 's'}`;
    case 'levels': return Object.entries(v).map(([k, d]) => `${k} ${d} dB`).join(', ');
    case 'matrix': return require('../audio/routing').describe(v) || '—';
    case 'eq': return Object.entries(v).map(([k, d]) => `${k} ${d} dB`).join(', ');
    default: return String(v);
  }
}

function diffShows(a: ShowDoc, b: ShowDoc): Change[] {
  const A = flat(a), B = flat(b);
  const bIds = show.index(b).byId, aIds = show.index(a).byId;
  const changes: Change[] = [];
  for (const [id, x] of B) {
    if (!A.has(id)) {
      // a whole new group is one line; its children are not listed again
      if (x.parent && !A.has(x.parent)) continue;
      changes.push({ kind: 'added', id, label: x.label, type: x.cue.type, list: x.listName, count: countUnder(x.cue) });
      continue;
    }
    const y = A.get(id)!;
    const fields: FieldChange[] = [];
    for (const f of fieldsOf(x.cue.type)) {
      if (same(y.cue[f.key], x.cue[f.key])) continue;
      let from = y.cue[f.key], to = x.cue[f.key];
      if (f.kind === 'cue') { from = from ? nameOf(aIds, String(from)) : from; to = to ? nameOf(bIds, String(to)) : to; }
      fields.push({ field: f.key, label: f.label, from: fmt(f.kind === 'cue' ? null : f, from), to: fmt(f.kind === 'cue' ? null : f, to), rawFrom: y.cue[f.key], rawTo: x.cue[f.key] });
    }
    if (fields.length) changes.push({ kind: 'changed', id, label: x.label, type: x.cue.type, fields });
    if (y.parent !== x.parent || y.list !== x.list) changes.push({ kind: 'moved', id, label: x.label, type: x.cue.type, to: x.parent ? `into ${B.get(x.parent)!.label}` : `to ${x.listName}` });
  }
  for (const [id, y] of A) {
    if (B.has(id)) continue;
    if (y.parent && !B.has(y.parent)) continue;
    changes.push({ kind: 'removed', id, label: y.label, type: y.cue.type, list: y.listName, count: countUnder(y.cue) });
  }
  // order within a container: report cues whose predecessor changed, when nothing else explains it
  const added = new Set(changes.filter((c): c is Change & { id: string } => c.kind === 'added').map((c) => c.id));
  const removed = new Set(changes.filter((c): c is Change & { id: string } => c.kind === 'removed').map((c) => c.id));
  const moved = new Set(changes.filter((c) => c.kind === 'moved').map((c) => c.id));
  const reordered: string[] = [];
  for (const l of b.lists) {
    const scan = (cues: Cue[] | undefined, oldCues: Cue[] | undefined) => {
      const stay = (cues || []).filter((c) => A.has(c.id) && !moved.has(c.id)).map((c) => c.id);
      const was = (oldCues || []).filter((c) => B.has(c.id) && !moved.has(c.id) && stay.includes(c.id)).map((c) => c.id);
      if (!same(stay, was)) for (const id of lcsMoved(was, stay)) reordered.push(id);
      for (const c of cues || []) if (c.children && A.has(c.id)) scan(c.children, A.get(c.id)!.cue.children);
    };
    const old = a.lists.find((x) => x.id === l.id);
    if (old) scan(l.cues, old.cues);
  }
  for (const id of reordered) if (!added.has(id) && !removed.has(id)) { const x = B.get(id)!; changes.push({ kind: 'moved', id, label: x.label, type: x.cue.type, to: x.prev ? `after ${B.get(x.prev)!.label}` : 'to the top' }); }

  for (const l of b.lists) { const o = a.lists.find((x) => x.id === l.id); if (!o) changes.push({ kind: 'list-added', label: l.name }); else { if (o.name !== l.name) changes.push({ kind: 'list-renamed', label: l.name, from: o.name }); if (!same(o.cart, l.cart)) changes.push({ kind: 'list-cart', label: l.name, to: l.cart ? `a cart of ${l.cart.rows} × ${l.cart.columns}` : 'a plain list' }); } }
  for (const l of a.lists) if (!b.lists.some((x) => x.id === l.id)) changes.push({ kind: 'list-removed', label: l.name });
  for (const path of ['title', 'notes'] as const) if (!same(a[path], b[path])) changes.push({ kind: 'setting', path, from: fmt(null, a[path]), to: fmt(null, b[path]) });
  // devices are reported as an operator reads them (added, removed, changed field by field), not as a settings path
  deviceDiff(a, b, changes);
  const noDevices = (s: ShowDoc['settings']) => (s && s.rig ? { ...s, rig: { ...s.rig, devices: undefined } } : s);
  leafDiff(noDevices(a.settings), noDevices(b.settings), 'settings', changes);
  leafDiff(a.modules, b.modules, 'modules', changes);
  return changes;
}

/** How a device's "is it there" reads in a line. */
const aliveText = (v: DeviceAlive | undefined) => (!v || v.how === 'none' || !v.how ? 'cannot be asked' : v.how === 'ask' ? `asked every ${v.every || 2} s (${v.send || '…'})` : `listened for${v.hears ? ` (${v.hears})` : ''}, within ${v.within || 5} s`);
function deviceField(f: { key: string } | null, from: any, to: any): { from: string; to: string } {
  const key = f ? f.key : '';
  if (key === 'commands') {
    const A: DeviceCommand[] = from || [], B: DeviceCommand[] = to || [];
    const added = B.filter((c) => !A.some((x) => x.id === c.id)), removed = A.filter((c) => !B.some((x) => x.id === c.id));
    const changed = B.filter((c) => A.some((x) => x.id === c.id && !same(x, c)));
    const what = [added.length ? `added ${added.map((c) => c.label || c.id).join(', ')}` : '', removed.length ? `removed ${removed.map((c) => c.label || c.id).join(', ')}` : '', changed.length ? `changed ${changed.map((c) => c.label || c.id).join(', ')}` : ''].filter(Boolean).join('; ');
    return { from: String(A.length), to: `${B.length}${what ? ` (${what})` : ''}` };
  }
  if (key === 'alive') return { from: aliveText(from), to: aliveText(to) };
  if (key === 'reports') return { from: (from || []).map((r: DeviceReport) => r.label || r.key).join(', ') || '—', to: (to || []).map((r: DeviceReport) => r.label || r.key).join(', ') || '—' };
  if (key === 'destinations') return { from: (from || []).map((d: Destination) => `${d.host}:${d.port || ''}`).join(', ') || '—', to: (to || []).map((d: Destination) => `${d.host}:${d.port || ''}`).join(', ') || '—' };
  const one = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return { from: one(from), to: one(to) };
}
function deviceDiff(a: ShowDoc, b: ShowDoc, changes: Change[]) {
  const A: Device[] = rigDevices.list(a), B: Device[] = rigDevices.list(b);
  for (const d of B) {
    const was = A.find((x) => x.id === d.id);
    if (!was) { changes.push({ kind: 'device-added', id: d.id, label: d.name, text: rigDevices.describe(d) }); continue; }
    if (same(was, d)) continue;
    const fields: FieldChange[] = [];
    for (const k of new Set([...Object.keys(was), ...Object.keys(d)])) {
      if (same(was[k], d[k])) continue;
      const f = rigDevices.FIELDS.find((x) => x.key === k) || null;
      fields.push({ field: k, label: f ? f.label : k, ...deviceField(f, was[k], d[k]), rawFrom: was[k], rawTo: d[k] });
    }
    changes.push({ kind: 'device-changed', id: d.id, label: d.name, fields });
  }
  for (const d of A) if (!B.some((x) => x.id === d.id)) changes.push({ kind: 'device-removed', id: d.id, label: d.name, text: rigDevices.describe(d) });
}

function nameOf(byId: CueIndex, id: string) { const c = byId.get(id); return c ? `${c.number ? c.number + ' ' : ''}${c.name || defaultName(c, byId)}`.trim() : '(missing)'; }
function countUnder(c: Cue) { let n = 0; const go = (x: Cue) => { for (const k of x.children || []) { n++; go(k); } }; go(c); return n; }

/** The ids that are out of place between two orderings of the same set (those not in a longest common subsequence). */
function lcsMoved(a: string[], b: string[]) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keep = new Set<string>();
  let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { keep.add(a[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  return b.filter((id) => !keep.has(id));
}

function leafDiff(a: any, b: any, path: string, out: Change[]) {
  if (same(a, b)) return;
  const obj = (v: unknown) => v && typeof v === 'object' && !Array.isArray(v);
  if (obj(a) && obj(b)) { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) leafDiff(a[k], b[k], `${path}.${k}`, out); return; }
  // a list of the same length (the buses, the patches): item by item, so one fader is one change
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every(obj)) { a.forEach((x: unknown, i: number) => leafDiff(x, b[i], `${path}.${i}`, out)); return; }
  out.push({ kind: 'setting', path, from: fmt(null, a), to: fmt(null, b) });
}

/** One line for a version's note: "3 level −8 dB · 2 cues added · 12 renamed". */
function describe(changes: Change[], max = 4) {
  if (!changes.length) return 'no changes';
  const parts: string[] = [];
  for (const c of changes) {
    if (c.kind === 'changed') {
      const f = c.fields[0];
      const what = c.fields.length === 1 ? (f.field === 'name' ? 'renamed' : `${f.label.toLowerCase()} ${f.to}`) : `${c.fields.length} changes`;
      // a numbered cue is called by its number; one without, by its name (not by the name's first word)
      const first = c.label.split(' ')[0];
      parts.push(`${/^[\d.]+[A-Za-z]?$/.test(first) ? first : c.label.length > 28 ? c.label.slice(0, 27).trimEnd() + '…' : c.label}: ${what}`);
    } else if (c.kind === 'setting') parts.push(`${c.path.replace(/^settings\./, '')} ${c.to}`);
    else if (c.kind === 'moved') parts.push(`${c.label} moved`);
    else if (c.kind === 'added' || c.kind === 'removed') parts.push(`${c.label} ${c.kind}`);
    else if (c.kind === 'list-cart') parts.push(`${c.label} is ${c.to}`);
    else if (c.kind === 'device-added' || c.kind === 'device-removed') parts.push(`device ${c.label} ${c.kind.slice(7)}`);
    else if (c.kind === 'device-changed') parts.push(`device ${c.label}: ${c.fields.length === 1 ? `${c.fields[0].label.toLowerCase()} ${c.fields[0].to}` : `${c.fields.length} changes`}`);
    else parts.push(`${c.label} (${c.kind.replace('list-', 'list ')})`);
  }
  return parts.length > max ? `${parts.slice(0, max).join(' · ')} · +${parts.length - max} more` : parts.join(' · ');
}

function summary(changes: Change[]) {
  const n = (k: Change['kind']) => changes.filter((c) => c.kind === k).length;
  return { added: n('added'), removed: n('removed'), changed: n('changed'), moved: n('moved'), settings: n('setting'), devices: n('device-added') + n('device-removed') + n('device-changed'), total: changes.length };
}

export { diffShows, describe, summary };
