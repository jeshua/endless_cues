/**
 * The cue list as it is looked at (app/renderer/list-view.ts): chains of continues, what one GO starts, the line drawn
 * down the linked rows, what a deletion leaves linked, what Find unfolds, and the zoomed-out list's arithmetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as LV from '../app/renderer/list-view';
import { rig, build } from './helpers';
const flatten = (cues: LV.ListCue[], shut: Set<string>) => flattenRows(cues, shut);

// the rows as the window draws them (app/renderer/lib.ts `flatten`, which is an ES module there)
function flattenRows(cues: LV.ListCue[] | undefined, collapsed: Set<string>, depth = 0, out: LV.ListRow[] = []) {
  let shut = false;
  for (const c of cues || []) {
    if (!depth && c.type === 'section') { shut = collapsed.has(c.id); out.push({ cue: c, depth, heading: true }); continue; }
    if (shut) continue;
    out.push({ cue: c, depth });
    if (c.children && !collapsed.has(c.id)) flattenRows(c.children, collapsed, depth + 1, out);
  }
  return out;
}

const cue = (id: string, more: Partial<LV.ListCue> = {}): LV.ListCue => ({ id, type: 'memo', ...more });
const ac = (id: string, more: Partial<LV.ListCue> = {}) => cue(id, { continue: 'auto-continue', ...more });
const af = (id: string, more: Partial<LV.ListCue> = {}) => cue(id, { continue: 'auto-follow', ...more });

test('a chain: each continue links a cue to the next GO would stand by on, past a section heading', () => {
  const cues = [ac('a'), af('b'), cue('c'), cue('d'), { id: 's', type: 'section' }, ac('e'), { id: 's2', type: 'section' }, cue('f')];
  const l = LV.linksOf(cues);
  assert.deepEqual([...l.next], [['a', 'b'], ['b', 'c'], ['e', 'f']]);
  assert.equal(l.kind.get('a'), 'auto-continue');
  assert.equal(l.kind.get('b'), 'auto-follow');
  assert.deepEqual(LV.chainFrom(cues, 'a'), ['a', 'b', 'c']);
  assert.deepEqual(LV.chainFrom(cues, 'b'), ['b', 'c']);
  assert.deepEqual(LV.chainFrom(cues, 'c'), ['c'], 'a cue that continues into nothing starts itself only');
  assert.deepEqual(LV.chainFrom(cues, 'e'), ['e', 'f']);
  assert.deepEqual(LV.chainFrom([ac('z')], 'z'), ['z'], 'the last cue of a list continues into nothing');
});

test('a light cue only called is passed over while light cues are skipped, and is a link while they are not', () => {
  const cues = [ac('a'), { id: 'lq', type: 'light', lightCue: '5' }, cue('b')];
  assert.deepEqual(LV.chainFrom(cues, 'a'), ['a', 'lq']);
  assert.deepEqual(LV.chainFrom(cues, 'a', { skipLights: true }), ['a', 'b']);
});

test('inside a group the children chain only where the group starts its first child', () => {
  const kids = () => [ac('k1'), cue('k2')];
  for (const mode of ['enter', 'first', 'random']) assert.equal(LV.linksOf([{ id: 'g', type: 'group', mode, children: kids() }]).next.get('k1'), 'k2', mode);
  for (const mode of ['timeline', 'playlist', undefined]) assert.equal(LV.linksOf([{ id: 'g', type: 'group', mode, children: kids() }]).next.has('k1'), false, String(mode));
  // a group deep inside a timeline group still has its own
  const deep = LV.linksOf([{ id: 'g', type: 'group', mode: 'timeline', children: [{ id: 'h', type: 'group', mode: 'first', children: kids() }] }]);
  assert.equal(deep.next.get('k1'), 'k2');
});

test('what one GO starts, by the chain, is what the engine starts', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'memo', number: '1', continue: 'auto-continue' } },
    { op: 'cue.add', ref: 'b', cue: { type: 'wait', number: '2', duration: 1, continue: 'auto-follow' } },
    { op: 'cue.add', ref: 's', cue: { type: 'section', name: 'Two' } },
    { op: 'cue.add', ref: 'c', cue: { type: 'memo', number: '3' } },
    { op: 'cue.add', ref: 'd', cue: { type: 'memo', number: '4' } },
  ]);
  const r = rig(s.doc);
  const chain = LV.chainFrom(s.doc.lists[0].cues, s.id('a'));
  assert.deepEqual(chain, [s.id('a'), s.id('b'), s.id('c')]);
  r.engine.go();
  r.advance(3);
  assert.deepEqual([s.id('a'), s.id('b'), s.id('c'), s.id('d')].filter((id) => r.engine.played.has(id)), chain, 'GO started the chain and nothing after it');
  assert.equal(r.engine.playhead, s.id('d'), 'the playhead lands past the chain');
});

test('the line down a chain: up into a linked cue, down out of it, through the rows between', () => {
  const cues = [cue('x'), ac('a'), { id: 'g', type: 'group', mode: 'timeline', continue: 'auto-follow', children: [cue('k1'), cue('k2')] }, { id: 's', type: 'section' }, cue('b'), cue('c')];
  const links = LV.linksOf(cues);
  const marks = LV.chainMarks(cues, flatten(cues, new Set()), new Set(), links);
  assert.equal(marks.has('x'), false, 'a cue in no chain carries nothing');
  assert.deepEqual(marks.get('a'), { depth: 0, up: null, down: 'auto-continue', through: [], tick: true });
  assert.deepEqual(marks.get('g'), { depth: 0, up: 'auto-continue', down: 'auto-follow', through: [], tick: true });
  assert.deepEqual(marks.get('k1')!.through, [{ depth: 0, kind: 'auto-follow' }], 'a group’s children between two linked cues: the line passes them');
  assert.equal(marks.get('k1')!.tick, false);
  assert.deepEqual(marks.get('s')!.through, [{ depth: 0, kind: 'auto-follow' }], 'and a heading between two linked cues');
  assert.deepEqual(marks.get('b'), { depth: 0, up: 'auto-follow', down: null, through: [], tick: true });
  assert.equal(marks.has('c'), false);
});

test('a folded section stands for the chain it hides: a chain that goes into it ends on its heading, one that leaves it starts there', () => {
  const cues = [ac('a'), { id: 's', type: 'section' }, cue('b'), af('c'), { id: 's2', type: 'section' }, cue('d')];
  const links = LV.linksOf(cues), shut = new Set(['s']);
  const marks = LV.chainMarks(cues, flatten(cues, shut), shut, links);
  assert.deepEqual(marks.get('s'), { depth: 0, up: 'auto-continue', down: 'auto-follow', through: [], tick: true });
  assert.deepEqual(marks.get('s2')!.through, [{ depth: 0, kind: 'auto-follow' }]);
  assert.equal(marks.get('d')!.up, 'auto-follow');
  // an empty folded section hands the line on
  const e = [ac('a'), { id: 'z', type: 'section' }, { id: 'y', type: 'section' }, cue('b')];
  const em = LV.chainMarks(e, flatten(e, new Set(['z'])), new Set(['z']), LV.linksOf(e));
  assert.deepEqual(em.get('z')!.through, [{ depth: 0, kind: 'auto-continue' }]);
  assert.equal(em.get('b')!.up, 'auto-continue');
});

test('a chain inside a group is drawn at the group’s depth, beside the line of the list', () => {
  const cues = [{ id: 'g', type: 'group', mode: 'first', children: [ac('k1'), cue('k2')] }, cue('n')];
  const m = LV.chainMarks(cues, flatten(cues, new Set()), new Set(), LV.linksOf(cues));
  assert.deepEqual(m.get('k1'), { depth: 1, up: null, down: 'auto-continue', through: [], tick: true });
  assert.deepEqual(m.get('k2'), { depth: 1, up: 'auto-continue', down: null, through: [], tick: true });
  assert.equal(m.has('g'), false);
});

test('a light cue passed over carries the line by it', () => {
  const cues = [ac('a'), { id: 'lq', type: 'light' }, cue('b')];
  const m = LV.chainMarks(cues, flatten(cues, new Set()), new Set(), LV.linksOf(cues, { skipLights: true }), { skipLights: true });
  assert.deepEqual(m.get('lq'), { depth: 0, up: null, down: null, through: [{ depth: 0, kind: 'auto-continue' }], tick: false });
  assert.equal(m.get('b')!.up, 'auto-continue');
});

test('deleting a cue in the middle of a chain: the cue before it now continues into the next, and says so', () => {
  const cues = [ac('a'), af('b'), cue('c'), cue('d')];
  assert.deepEqual(LV.strayLinks(cues, ['b']), [{ from: 'a', to: 'c', kind: 'auto-continue', was: 'b' }]);
  assert.deepEqual(LV.strayLinks(cues, ['b', 'c']), [{ from: 'a', to: 'd', kind: 'auto-continue', was: 'b' }], 'several gone: the one kept before them');
  assert.deepEqual(LV.strayLinks(cues, ['c']), [{ from: 'b', to: 'd', kind: 'auto-follow', was: 'c' }]);
  assert.deepEqual(LV.strayLinks(cues, ['d']), [], 'a cue nothing continues into');
  assert.deepEqual(LV.strayLinks([ac('a'), cue('b')], ['b']), [{ from: 'a', to: null, kind: 'auto-continue', was: 'b' }], 'the last: it continues into nothing now');
  assert.deepEqual(LV.strayLinks(cues, ['a']), [], 'the first of a chain: nothing before it is linked');
  // inside a group that starts its first child
  const g = [{ id: 'g', type: 'group', mode: 'first', children: [ac('k1'), cue('k2'), cue('k3')] }];
  assert.deepEqual(LV.strayLinks(g, ['k2']), [{ from: 'k1', to: 'k3', kind: 'auto-continue', was: 'k2' }]);
});

test('find: what has to be unfolded for a cue to be drawn', () => {
  const cues = [cue('a'), { id: 's', type: 'section' }, { id: 'g', type: 'group', children: [{ id: 'h', type: 'group', children: [cue('deep')] }] }, cue('b'), { id: 's2', type: 'section' }];
  assert.deepEqual(LV.revealPath(cues, 'deep'), ['s', 'g', 'h']);
  assert.deepEqual(LV.revealPath(cues, 'b'), ['s']);
  assert.deepEqual(LV.revealPath(cues, 'a'), [], 'a cue before every section is in none');
  assert.deepEqual(LV.revealPath(cues, 's2'), [], 'a heading is always drawn');
  assert.deepEqual(LV.revealPath(cues, 'nowhere'), []);
});

test('zoom: from the normal row to the row that fits the whole list, on a log scale, and kept per show', () => {
  assert.equal(LV.rowHeight(1, 30, 3), 30);
  assert.equal(LV.rowHeight(0, 30, 3), 3);
  assert.ok(Math.abs(LV.rowHeight(0.5, 30, 3) - Math.sqrt(90)) < 1e-9, 'halfway is the geometric middle');
  assert.equal(LV.rowHeight(0, 30, 60), 30, 'a list that already fits does not grow');
  assert.equal(LV.rowHeight(-2, 30, 3), 3); assert.equal(LV.rowHeight(7, 30, 3), 30);
  assert.equal(LV.fitHeight(600, 100, 4, 20, 30), 5.2, 'headings keep their height; the cue rows share what is left');
  assert.equal(LV.fitHeight(600, 10, 0, 20, 30), 30, 'never taller than normal');
  assert.equal(LV.fitHeight(100, 1000, 0, 20, 30), 1.5, 'never thinner than a line');
  const kept = LV.keepZoom({ '/old': 0.2 }, '/show', 0.31234);
  assert.deepEqual(kept, { '/old': 0.2, '/show': 0.312 });
  assert.deepEqual(LV.keepZoom(kept, '/show', 1), { '/old': 0.2 }, 'back at normal: forgotten');
  const many: Record<string, number> = {}; for (let i = 0; i < 45; i++) many[`/s${i}`] = 0.5;
  assert.equal(Object.keys(LV.keepZoom(many, '/new', 0.5)).length, 40);
});
