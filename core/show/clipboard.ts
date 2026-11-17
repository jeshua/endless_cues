/**
 * The cue clipboard: what Cut and Copy take, and the operations a Paste is made of.
 *
 * A clip is this computer's, not a show's: it is taken from one show and may be
 * pasted into another, so it carries the cues whole (not their ids alone) and
 * says where their show's folder was, which is how a sound named `media/rain.wav`
 * is found again from the show it is pasted into.
 *
 * Nothing here changes a show. `pasteOps` and `propertyOps` return operations
 * for core/show/ops.ts, so a paste is one undoable edit like any other.
 */
import * as path from 'path';
import { TYPES, fieldsOf } from './cue-types';
import * as show from './show';
import type { ShowDoc, Cue } from './types';
import type { Op, CueSpec, Place, Props } from './ops';

/** What Cut and Copy take: the cues whole, and the show (and its folder) they came from. */
export interface Clip { showId: string; showDir: string | null; cut: boolean; ids: string[]; cues: Cue[] }
/** What a paste is: its operations, whether they move the cues (a cut into its own show), how many, and whether the clip is this show's. */
export interface Paste { ops: Op[]; moved: boolean; count: number; same?: boolean }
/** A property of a copied cue that Paste Cue Properties offers (`set`: the cue has a value for it). */
export interface Property { key: string; label: string; set: boolean }

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The cues named, in the order they stand in the show, without any that is inside another of them. */
function topmost(doc: ShowDoc, ids: Iterable<string>): Cue[] {
  const want = new Set(ids), out: Cue[] = [];
  const go = (cues: Cue[] | undefined, inside: boolean) => { for (const c of cues || []) { const hit = want.has(c.id) && !inside; if (hit) out.push(c); go(c.children, inside || hit); } };
  for (const l of doc.lists) go(l.cues, false);
  return out;
}

/** Take cues onto the clipboard. `cut`: a paste into the same show moves them. */
function take(doc: ShowDoc, ids: Iterable<string>, { showDir = null, cut = false }: { showDir?: string | null; cut?: boolean } = {}): Clip {
  const cues = topmost(doc, ids).map(clone);
  return { showId: doc.id, showDir, cut: !!cut, ids: cues.map((c) => c.id), cues };
}

/**
 * The operations that paste a clip at `where` ({ after } | { before } | { parent } | { list }).
 *
 *  - Cut, and pasted into the show it was cut from: the cues are moved.
 *  - Otherwise each cue is made again. A target inside the clip follows the copy; one outside it is kept when
 *    that cue is in this show and dropped when it is not (the cue is then flagged: it has no target).
 *  - A number another cue in this show already has is not pasted (two cues with one number).
 *  - In another show a sound is found from the folder of the show it was copied in; `fileFor(absolutePath)`
 *    returns the name this show should know it by (the host copies it into the show's media folder).
 *
 * Returns { ops, moved, count, same }.
 */
function pasteOps(clip: Clip | null | undefined, doc: ShowDoc, where: Place = {}, { fileFor = (p: string) => p, showDir }: { fileFor?: (absolutePath: string) => string; showDir?: string | null } = {}): Paste {
  if (!clip || !clip.cues || !clip.cues.length) return { ops: [], moved: false, count: 0 };
  // (a show folder copied by hand has the id of the one it was copied from: the folder tells them apart)
  const same = sameShow(clip, doc, showDir);
  const { byId } = show.index(doc);
  if (clip.cut && same && clip.ids.every((id) => byId.has(id))) return { ops: [{ op: 'cue.move', ids: clip.ids, ...where }], moved: true, count: clip.ids.length, same };

  const refOf = new Map<string, string>();
  let n = 0;
  const name = (c: Cue) => { refOf.set(c.id, `clip${n++}`); (c.children || []).forEach(name); };
  clip.cues.forEach(name);
  const taken = new Set<string>();
  show.walk(doc, (c) => { if (c.number != null && c.number !== '') taken.add(String(c.number).toLowerCase()); });

  const aims: Op[] = [];
  const remake = (c: Cue): CueSpec | null => {
    if (!TYPES[c.type]) return null;
    const out: CueSpec = { type: c.type, ref: refOf.get(c.id) };
    for (const f of fieldsOf(c.type)) {
      let v = c[f.key];
      if (v === undefined) continue;
      if (f.key === 'number') { const k = String(v).toLowerCase(); if (taken.has(k)) continue; taken.add(k); }
      // (a target inside the clip is set once every cue of it has been made: it may be a cue pasted after this one)
      if (f.kind === 'cue') { const aim = v as string; if (refOf.has(aim)) { aims.push({ op: 'cue.set', id: `@${refOf.get(c.id)}`, props: { [f.key]: `@${refOf.get(aim)}` } }); continue; } if (!byId.has(aim)) continue; }
      if (f.kind === 'file' && !same) v = fileFor(path.isAbsolute(String(v)) || !clip.showDir ? String(v) : path.join(clip.showDir, String(v)));
      out[f.key] = clone(v);
    }
    if (c.children && TYPES[c.type].container) out.children = c.children.map(remake).filter((k): k is CueSpec => !!k);
    return out;
  };
  const ops: (Op & { op: 'cue.add' })[] = [];
  for (const c of clip.cues) {
    const cue = remake(c);
    if (cue) ops.push({ op: 'cue.add', ref: cue.ref, cue, ...(ops.length ? { after: `@${ops[ops.length - 1].ref}` } : where) });
  }
  return { ops: [...ops, ...aims], moved: false, count: ops.length, same };
}

/** Whether a clip was taken from this show (`showDir`: where this show is kept, when the caller knows). */
function sameShow(clip: Clip | null | undefined, doc: ShowDoc, showDir?: string | null) { return !!clip && clip.showId === doc.id && (showDir === undefined || (clip.showDir || null) === (showDir || null)); }

/** What belongs to one cue and is never offered by Paste Cue Properties. */
const NOT_PASTED = new Set(['number']);

/** The properties of a copied cue that can be pasted onto others: [{ key, label, set }] (`set`: the cue has a value for it). */
function properties(cue: Cue | null | undefined): Property[] {
  if (!cue || !TYPES[cue.type]) return [];
  return fieldsOf(cue.type).filter((f) => !NOT_PASTED.has(f.key) && !f.hidden).map((f) => ({ key: f.key, label: f.label, set: cue[f.key] !== undefined }));
}

/**
 * Paste Cue Properties: the chosen fields of `source` onto each of `targets` (cues of the show), one `cue.set`
 * each. A cue takes only the fields its own type has (a Fade's duration lands on a Wait, its level does not),
 * and a field the source leaves at its default goes back to the default on the target. A cue is never made
 * its own target.
 */
function propertyOps(source: Cue | null | undefined, targets: (Cue | null | undefined)[], keys: string[]): Op[] {
  const ops: Op[] = [];
  if (!source || !TYPES[source.type]) return ops;
  const from = fieldsOf(source.type);
  for (const t of targets) {
    if (!t || !TYPES[t.type] || t.id === source.id) continue;
    const props: Props = {};
    for (const key of keys) {
      const f = from.find((x) => x.key === key), g = fieldsOf(t.type).find((x) => x.key === key);
      if (!f || !g || f.kind !== g.kind || NOT_PASTED.has(key)) continue;
      if (f.kind === 'cue' && source[key] === t.id) continue;
      if (g.required && source[key] === undefined) continue;
      props[key] = source[key] === undefined ? null : clone(source[key]);
    }
    if (Object.keys(props).length) ops.push({ op: 'cue.set', id: t.id, props });
  }
  return ops;
}

export { sameShow, take, pasteOps, properties, propertyOps, topmost };
