/**
 * Sections (core/show/sections.js): headings in a list that never play. The engine is handed the list without them
 * (show.js toEngineDoc), so GO, continues and auto-follow run straight through; what names one lands on its first cue.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as show from '../core/show/show';
import * as sections from '../core/show/sections';
import { applyOps } from '../core/show/ops';
import { TYPES, fieldsOf } from '../core/show/cue-types';
import { rig, build } from './helpers';
import type { CueSpec, Op } from '../core/show/ops';

const sec = (ref: string, name: string, more: Partial<CueSpec> = {}): Op => ({ op: 'cue.add', ref, cue: { type: 'section', name, ...more } });
const memo = (ref: string, number: string, more: Partial<CueSpec> = {}): Op => ({ op: 'cue.add', ref, cue: { type: 'memo', number, ...more } });

test('a section is a heading: a name, a colour and notes, and nothing that plays', () => {
  assert.ok(TYPES.section.heading);
  assert.deepEqual(fieldsOf('section').map((f) => f.key).sort(), ['color', 'name', 'notes']);
  const r = build([sec('s', 'Scene 1')]);
  assert.throws(() => applyOps(r.doc, [{ op: 'cue.set', id: r.id('s'), props: { preWait: 2 } }]), /no field “preWait”/);
  assert.throws(() => applyOps(r.doc, [{ op: 'cue.set', id: r.id('s'), props: { continue: 'auto-continue' } }]), /no field “continue”/);
});

test('GO passes over a section: from the last cue before it to the first after it; a section at the start or end is never stood by', () => {
  const s = build([sec('s0', 'Top'), memo('a', '1'), memo('b', '2'), sec('s1', 'Scene 2'), memo('c', '3'), sec('s2', 'Empty'), sec('s3', 'Scene 4'), memo('d', '4'), sec('end', 'Bows')]);
  const r = rig(s.doc);
  assert.equal(r.engine.playhead, s.id('a'), 'a list that starts with a section stands by its first cue');
  const fired = [];
  for (let i = 0; i < 6; i++) { const id = r.engine.go(); if (id) fired.push(id); }
  assert.deepEqual(fired, [s.id('a'), s.id('b'), s.id('c'), s.id('d')]);
  assert.equal(r.engine.playhead, null, 'a section at the end is not a stop: the end of the list');
  for (const id of ['s0', 's1', 's2', 's3', 'end']) assert.ok(!r.engine.byId.has(s.id(id)), 'the engine never has a section');
  r.engine.reset();
  r.engine.movePlayhead(1); r.engine.movePlayhead(1);
  assert.equal(r.engine.playhead, s.id('c'), 'the arrows step over a section too');
});

test('auto-continue and auto-follow run straight through a section', () => {
  const s = build([
    memo('a', '1', { continue: 'auto-continue', postWait: 1 }), sec('s1', 'Scene 2'), sec('s2', 'Empty'), { op: 'cue.add', ref: 'w', cue: { type: 'wait', number: '2', duration: 2, continue: 'auto-follow' } },
    sec('s3', 'Scene 3'), memo('c', '3'), memo('d', '4'),
  ]);
  const r = rig(s.doc);
  r.engine.go();
  assert.equal(r.engine.playhead, s.id('c'), 'the sequence takes the playhead past both continued cues and the sections between');
  r.advance(1.1);
  assert.ok(r.engine.isLive(s.id('w')), 'the wait after the sections fired from the auto-continue');
  r.advance(2.1);
  assert.ok(r.logs.some((l) => /auto-follow 3/.test(l)), 'the auto-follow went over the next section to cue 3');
  assert.equal(r.engine.playhead, s.id('d'));
});

test('a section named as somewhere to go lands on its first cue, past empty sections', () => {
  const s = build([memo('a', '1'), sec('s1', 'Scene 2'), sec('s2', 'Empty'), memo('c', '3'), sec('end', 'Bows')]);
  const cues = s.doc.lists[0].cues;
  assert.equal(sections.landing(cues, s.id('s1')), s.id('c'));
  assert.equal(sections.landing(cues, s.id('s2')), s.id('c'));
  assert.equal(sections.landing(cues, s.id('end')), null, 'nothing after the last section');
  assert.equal(sections.landing(cues, s.id('a')), s.id('a'), 'a cue lands on itself');
  assert.equal(sections.landingIn(s.doc, s.id('s1')), s.id('c'));
  // Jump to "scene 2" finds the section by its name; Load to Time on it loads its first cue
  assert.equal(sections.byName(s.doc, 'scene 2')!.id, s.id('s1'));
  assert.equal(sections.byName(s.doc, 'bo')!.id, s.id('end'), 'or the start of its name');
  assert.equal(sections.byName(s.doc, 'nothing'), null);
  const r = rig(s.doc);
  r.engine.setPlayhead(sections.landingIn(s.doc, s.id('s1')));
  assert.equal(r.engine.playhead, s.id('c'));
  r.engine.setPlayhead(s.id('s1'));
  assert.equal(r.engine.playhead, s.id('c'), 'a section id given to the engine itself changes nothing');
});

test('which section holds which cues: up to the next section; groups may be inside one', () => {
  const s = build([memo('a', '1'), sec('s1', 'One', { color: 'red' }), { op: 'cue.add', ref: 'g', cue: { type: 'group', number: '2', children: [{ type: 'memo', number: '2.1' }] } }, memo('b', '3'), sec('s2', 'Two'), sec('s3', 'Three'), memo('c', '4')]);
  const cues = s.doc.lists[0].cues;
  assert.deepEqual(sections.sectionsOf(cues).map((x) => [x.name, x.color, x.ids]), [['One', 'red', [s.id('g'), s.id('b')]], ['Two', 'none', []], ['Three', 'none', [s.id('c')]]]);
  assert.equal(sections.sectionOf(cues, s.id('a')), null, 'a cue before the first section is in none');
  assert.equal(sections.sectionOf(cues, s.id('b')), s.id('s1'));
  assert.equal(sections.sectionOf(cues, s.id('c')), s.id('s3'));
});

test('sections are flat: never inside a group, never in a cart; a cue cannot target one; renumbering passes over them', () => {
  const s = build([memo('a', '1'), sec('s', 'Scene'), { op: 'cue.add', ref: 'g', cue: { type: 'group', number: '2' } }, memo('b', '3')]);
  assert.throws(() => applyOps(s.doc, [{ op: 'cue.move', ids: [s.id('s')], parent: s.id('g') }]), /goes in a list, not inside a group/);
  assert.throws(() => applyOps(s.doc, [{ op: 'cue.add', cue: { type: 'section' }, parent: s.id('g') }]), /not inside a group/);
  assert.throws(() => applyOps(s.doc, [{ op: 'list.cart', id: s.doc.lists[0].id, rows: 2, columns: 2 }]), /has buttons, not sections/);
  const aimed = applyOps(s.doc, [{ op: 'cue.add', ref: 'st', cue: { type: 'start', number: '9', target: s.id('s') } }]);
  assert.ok(show.problems(aimed.doc).some((p) => p.id === aimed.refs.st && /section heading/.test(p.why)));
  assert.equal(show.toEngineDoc(aimed.doc).lists[0].cues.find((c) => c.id === aimed.refs.st)!.target, null, 'and plays as a cue with no target, not a crash');
  const n = applyOps(s.doc, [{ op: 'cue.renumber', ids: [s.id('a'), s.id('s'), s.id('b')], start: 10 }]).doc;
  assert.deepEqual(n.lists[0].cues.map((c) => c.number), ['10', undefined, '2', '11']);
});

test('the show file: a section is one ordinary entry; it reads back the same; an old show has none', () => {
  const s = build([sec('s', 'Scene 1 — Rebirth', { color: 'teal', notes: 'Lamps low' }), memo('a', '1')]);
  const text = show.stringify(s.doc);
  const entry = JSON.parse(text).lists[0].cues[0];
  assert.deepEqual(entry, { id: s.id('s'), type: 'section', name: 'Scene 1 — Rebirth', notes: 'Lamps low', color: 'teal' });
  const back = show.normalise(JSON.parse(text));
  assert.deepEqual(back.warnings, []);
  assert.equal(show.stringify(back.doc), text, 'round trip');
  // undo is an edit like any other: the batch before it is the show as it was
  const removed = applyOps(s.doc, [{ op: 'cue.remove', id: s.id('s') }]).doc;
  assert.deepEqual(removed.lists[0].cues.map((c) => c.id), [s.id('a')], 'removing a section leaves its cues');
});

test('fold state: kept per show folder, nothing kept for a show with nothing folded, the oldest let go', () => {
  let f = sections.keepFolds({}, '/shows/a.ecshow', ['s1', 's2', 's1', '']);
  assert.deepEqual(f, { '/shows/a.ecshow': ['s1', 's2'] });
  f = sections.keepFolds(f, '/shows/b.ecshow', ['g']);
  assert.deepEqual(f['/shows/a.ecshow'], ['s1', 's2'], 'another show keeps its own');
  f = sections.keepFolds(f, '/shows/a.ecshow', []);
  assert.deepEqual(Object.keys(f), ['/shows/b.ecshow']);
  f = sections.keepFolds(f, null, ['x']);
  assert.deepEqual(Object.keys(f), ['/shows/b.ecshow'], 'an untitled show is not kept');
  let many: Record<string, unknown[]> = {};
  for (let i = 0; i < 45; i++) many = sections.keepFolds(many, `/s${i}`, ['x'], 40);
  assert.equal(Object.keys(many).length, 40);
  assert.ok(!many['/s0'] && many['/s44']);
});
