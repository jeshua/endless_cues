import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as show from '../core/show/show';
import { applyOps, OpError } from '../core/show/ops';
import { diffShows, describe, summary } from '../core/show/diff';
import { ShowDocument } from '../core/show/document';
import { parseSmart, formatSeconds } from '../core/show/cue-types';
import * as osc from '../core/net/osc';
import { build } from './helpers';
import type { Change } from '../core/show/diff';

/** A cue whose fields changed, as diffShows says it. */
type Changed = Extract<Change, { kind: 'changed' }>;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ec-test-'));

test('a new show normalises to itself and stringifies stably', () => {
  const d = show.newShow('A');
  const n = show.normalise(JSON.parse(show.stringify(d))).doc;
  assert.equal(show.stringify(n), show.stringify(d));
});

test('a newer file version is refused with a reason', () => {
  assert.throws(() => show.normalise({ format: 'endless-cues-show', version: 99, lists: [] }), /newer Endless Cues/);
  assert.throws(() => show.normalise({ format: 'qlab' }), /not an Endless Cues show/);
});

test('ops: add, set by number, refs, and the batch is atomic', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'x.wav' } },
    { op: 'cue.add', cue: { type: 'fade', number: '2', target: '@a', db: -12 } },
    { op: 'cue.set', id: '#1', props: { gainDb: '-8', name: 'Thunder' } },
  ]);
  const [a, f] = s.doc.lists[0].cues;
  assert.equal(a.gainDb, -8);
  assert.equal(f.target, a.id);
  assert.throws(() => applyOps(s.doc, [{ op: 'cue.set', id: '#1', props: { name: 'ok' } }, { op: 'cue.set', id: '#1', props: { wobble: 1 } }]), OpError);
  assert.equal(s.doc.lists[0].cues[0].name, 'Thunder', 'the input is never touched');
});

test('ops: move into a group, never into itself; duplicate retargets inside the copy', () => {
  const s = build([
    { op: 'cue.add', ref: 'g', cue: { type: 'group', number: '1', children: [{ type: 'audio', ref: 'a', file: 'a.wav' }, { type: 'fade', target: '@a' }] } },
    { op: 'cue.add', ref: 'm', cue: { type: 'memo', number: '2' } },
  ]);
  const moved = applyOps(s.doc, [{ op: 'cue.move', ids: ['#2'], parent: '#1' }]).doc;
  assert.equal(moved.lists[0].cues.length, 1);
  assert.equal(moved.lists[0].cues[0].children!.length, 3);
  assert.throws(() => applyOps(s.doc, [{ op: 'cue.move', ids: ['#1'], parent: '#1' }]), /into itself/);
  const dup = applyOps(s.doc, [{ op: 'cue.duplicate', id: '#1' }]).doc;
  const copy = dup.lists[0].cues[1];
  assert.equal(copy.children![1].target, copy.children![0].id);
  assert.notEqual(copy.children![0].id, s.id('a'));
});

test('ops: renumber and show.set are checked', () => {
  const s = build([{ op: 'cue.add', cue: { type: 'memo', number: 'a' } }, { op: 'cue.add', cue: { type: 'memo', number: 'b' } }]);
  const ids = s.doc.lists[0].cues.map((c) => c.id);
  const r = applyOps(s.doc, [{ op: 'cue.renumber', ids, start: 10, step: 0.5 }, { op: 'show.set', path: 'settings.go.panicFade', value: 2 }]).doc;
  assert.deepEqual(r.lists[0].cues.map((c) => c.number), ['10.0', '10.5']);
  assert.equal(r.settings.go.panicFade, 2);
  assert.throws(() => applyOps(s.doc, [{ op: 'show.set', path: 'lists', value: [] }]), /cannot set/);
  assert.throws(() => applyOps(s.doc, [{ op: 'show.set', path: 'settings.__proto__.x', value: 1 }]), /bad path/);
});

test('diff: changed, added, removed, moved, and a one-line description', () => {
  const s = build([
    { op: 'cue.add', cue: { type: 'audio', number: '1', name: 'Rain', file: 'r.wav', gainDb: 0 } },
    { op: 'cue.add', cue: { type: 'memo', number: '2', name: 'Two' } },
    { op: 'cue.add', cue: { type: 'memo', number: '3', name: 'Three' } },
  ]);
  const b = applyOps(s.doc, [
    { op: 'cue.set', id: '#1', props: { gainDb: -8 } },
    { op: 'cue.remove', id: '#2' },
    { op: 'cue.add', cue: { type: 'wait', number: '4', duration: 2 } },
    { op: 'cue.move', ids: ['#3'], before: '#1' },
  ]).doc;
  const ch = diffShows(s.doc, b);
  assert.deepEqual(summary(ch), { added: 1, removed: 1, changed: 1, moved: 1, settings: 0, devices: 0, total: 4 });
  const lvl = ch.find((c): c is Changed => c.kind === 'changed')!.fields[0];
  assert.equal(lvl.to, '−8 dB');
  assert.match(describe(ch), /level −8 dB/);
  assert.deepEqual(diffShows(b, b), []);
});

test('document: nothing is kept until save; versions, restore, revert, and a proposal reviewed before it lands', () => {
  const dir = path.join(tmp(), 'T.ecshow');
  const file = path.join(dir, 'show.json');
  const d = ShowDocument.open(dir);
  const empty = fs.readFileSync(file, 'utf8');
  d.edit([{ op: 'cue.add', cue: { type: 'audio', number: '1', name: 'Rain', file: 'media/r.wav' } }]);
  assert.equal(fs.readFileSync(file, 'utf8'), empty, 'an edit is not written');
  assert.equal(d.dirty, true);
  assert.equal(d.unsaved().length, 1);
  const v1 = d.save()!;
  assert.equal(fs.readFileSync(file, 'utf8'), show.stringify(d.doc));
  assert.equal(d.dirty, false);
  assert.equal(d.save(), null, 'nothing to save');

  // what is pending is known change by change, with the saved value to put back
  d.edit([{ op: 'cue.set', id: '#1', props: { gainDb: -10 } }]);
  const f = (d.unsaved()[0] as Changed).fields[0];
  assert.deepEqual([f.field, f.rawFrom, f.to], ['gainDb', undefined, '−10 dB']);
  assert.equal(d.undo() !== false, true);
  assert.equal(d.dirty, false, 'undone back to the saved show: nothing pending');
  d.redo();
  // revert throws the pending changes away, undoably
  assert.equal(d.revert(), true);
  assert.equal(d.doc.lists[0].cues[0].gainDb, undefined);
  d.undo();
  assert.equal(d.doc.lists[0].cues[0].gainDb, -10);
  const v2 = d.save()!;
  assert.match(v2.note, /level −10 dB/);

  const p = d.propose([{ op: 'cue.set', id: '#1', props: { name: 'Heavy rain' } }, { op: 'cue.add', cue: { type: 'fade', target: '#1', number: '2' } }], { summary: 'Rename and add a fade' });
  assert.equal(p.counts.added, 1);
  assert.equal(d.doc.lists[0].cues.length, 1, 'nothing lands until accepted');
  d.accept(p.id);
  assert.equal(d.doc.lists[0].cues.length, 2);
  assert.equal(d.dirty, true, 'accepted, and pending like any other edit');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).lists[0].cues.length, 1);
  const v3 = d.save()!;
  assert.equal(v3.author, 'assistant');
  assert.deepEqual(d.listVersions().map((v) => v.author), ['you', 'you', 'assistant']);

  d.restoreVersion(v1.id);
  assert.equal(d.doc.lists[0].cues.length, 1);
  assert.equal(d.dirty, true, 'a restore is an edit: not kept until saved');
  d.undo();
  assert.equal(d.doc.lists[0].cues.length, 2);
  // a stale proposal cannot land
  const stale = d.propose([{ op: 'cue.set', id: '#1', props: { name: 'x' } }]);
  d.edit([{ op: 'cue.set', id: '#1', props: { notes: 'changed under it' } }]);
  assert.throws(() => d.accept(stale.id), /changed since/);
});

test('unsaved changes survive a crash: they come back, still unsaved', () => {
  const dir = path.join(tmp(), 'J.ecshow');
  const d = ShowDocument.open(dir);
  d.edit([{ op: 'cue.add', cue: { type: 'memo', number: '1', name: 'kept' } }]);
  d.save();
  d.edit([{ op: 'cue.add', cue: { type: 'memo', number: '2', name: 'pending' } }]);
  // (no save: the process "dies" here)
  const again = ShowDocument.open(dir);
  assert.equal(again.recovered, true);
  assert.equal(again.doc.lists[0].cues.length, 2);
  assert.equal(again.dirty, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'show.json'), 'utf8')).lists[0].cues.length, 1);
  again.revert();
  assert.equal(fs.existsSync(path.join(dir, 'show.unsaved.json')), false, 'discarded: the journal goes');
  assert.equal(ShowDocument.open(dir).recovered, false);
});

test('smart entry and OSC', () => {
  assert.equal(parseSmart('seconds', '1:30'), 90);
  assert.equal(parseSmart('seconds', '1:02:03.5'), 3723.5);
  assert.equal(parseSmart('db', '-inf'), -60);
  assert.equal(formatSeconds(125.5), '02:05.50');
  const m = osc.decode(osc.encode('/a/b 3 1.5 "two words" x'))!;
  assert.equal(m.address, '/a/b');
  assert.deepEqual(m.args, [3, 1.5, 'two words', 'x']);
  assert.throws(() => osc.encode('nope 1'));
});

test('problems: missing target, unknown patch, duplicate numbers', () => {
  const s = build([
    { op: 'cue.add', cue: { type: 'network', number: '1', message: 'no slash', patch: 'gone' } },
    { op: 'cue.add', cue: { type: 'memo', number: '1' } },
    { op: 'cue.add', cue: { type: 'audio', number: '3' } },
  ]);
  const why = show.problems(s.doc).map((p) => p.why).join('; ');
  assert.match(why, /patch is gone/);
  assert.match(why, /starts with \//);
  assert.match(why, /used twice/);
  assert.match(why, /no file/);
});

test('a level typed with no sign is a cut; a number is taken as it is', () => {
  const s = build([{ op: 'cue.add', cue: { type: 'audio', number: '1', file: 'a.wav' } }]);
  const set = (v: unknown) => applyOps(s.doc, [{ op: 'cue.set', id: '#1', props: { gainDb: v } }]).doc.lists[0].cues[0].gainDb;
  assert.equal(set('12'), -12);
  assert.equal(set('+3'), 3);
  assert.equal(set('-6.5'), -6.5);
  assert.equal(set(4), 4);
  assert.equal(set('-inf'), -60);
});

test('a field left alone plays at its default: a new Fade goes to silence over 3 s', () => {
  const doc = show.newShow();
  doc.lists[0].cues.push({ id: 'a', type: 'audio', file: 'a.wav' }, { id: 'f', type: 'fade', target: 'a' });
  const f = show.toEngineDoc(doc).lists[0].cues[1];
  assert.equal(f.db, -60);
  assert.equal(f.duration, 3);
});

test('a duplicate carries no numbers, and a loop region that cannot be is refused rather than dropped', () => {
  const s = require('./helpers').build([
    { op: 'cue.add', ref: 'g', cue: { type: 'group', number: '5' } },
    { op: 'cue.add', ref: 'a', parent: '@g', cue: { type: 'audio', number: '5.1', file: 'a.wav', loops: [{ start: 1, end: 2 }] } },
  ]);
  const { applyOps } = require('../core/show/ops');
  const r = applyOps(s.doc, [{ op: 'cue.duplicate', id: s.id('g') }]);
  const copy = r.doc.lists[0].cues[1];
  assert.equal(copy.number, undefined); assert.equal(copy.children[0].number, undefined);
  assert.throws(() => applyOps(s.doc, [{ op: 'cue.set', id: s.id('a'), props: { loops: [{ start: 8, end: 4 }] } }]), /end must come after/);
});

test('what this version does not know in a cue is kept on save and not played; a clock trigger is a time of day', () => {
  const doc = show.newShow('T');
  doc.lists[0].cues.push({ id: 'c1', type: 'memo', name: 'x', fromTheFuture: { a: 1 }, clockTrigger: '19:30 fri sat' });
  const { doc: clean } = show.normalise(doc);
  assert.deepEqual(clean.lists[0].cues[0].fromTheFuture, { a: 1 });
  assert.equal(JSON.parse(show.stringify(clean)).lists[0].cues[0].fromTheFuture.a, 1);
  assert.equal((show.toEngineDoc(clean).lists[0].cues[0] as unknown as Record<string, unknown>).fromTheFuture, undefined);
  const t = show.parseClock('19:30 fri sat')!;
  assert.equal(t.secs, 19 * 3600 + 30 * 60); assert.deepEqual([...t.days!], [5, 6]);
  assert.equal(show.parseClock('25:00'), null); assert.equal(show.parseClock('7pm'), null);
  assert.equal(show.problems(show.normalise({ ...doc, lists: [{ id: 'l', name: 'Main', cues: [{ id: 'c2', type: 'memo', clockTrigger: 'noon' }] }] }).doc).length, 1);
});
