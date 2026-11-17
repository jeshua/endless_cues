// The editing tools: the cue clipboard (within a show and between two), Paste Cue Properties, cue templates,
// renumbering past numbers in use, and the engine's memory of what has played.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as show from '../core/show/show';
import { applyOps } from '../core/show/ops';
import * as clipboard from '../core/show/clipboard';
import * as templates from '../core/show/templates';
import { build, rig } from './helpers';
import type { Built } from './helpers';

const scene = () => build([
  { op: 'cue.add', ref: 'rain', cue: { type: 'audio', number: '1', name: 'Rain', file: 'media/rain.wav', gainDb: -6, bus: 'music' } },
  { op: 'cue.add', ref: 'g', cue: { type: 'group', number: '2', name: 'Storm', children: [
    { type: 'audio', ref: 'thunder', number: '2.1', file: 'media/thunder.wav' },
    { type: 'fade', ref: 'duck', target: '@rain', db: -20, duration: 4 },
    { type: 'fade', ref: 'out', target: '@thunder', stopTarget: true },
  ] } },
  { op: 'cue.add', ref: 'memo', cue: { type: 'memo', number: '3', name: 'Interval', notes: 'house lights', color: 'red' } },
]);

test('clipboard: a copy pasted into the same show is made again, its inner targets following the copy', () => {
  const s = scene();
  const clip = clipboard.take(s.doc, [s.id('thunder'), s.id('g'), s.id('rain')], { showDir: '/shows/A.ecshow' });
  assert.deepEqual(clip.ids, [s.id('rain'), s.id('g')], 'in the show’s order, and not a cue that is inside another one taken');
  const p = clipboard.pasteOps(clip, s.doc, { after: s.id('memo') });
  assert.equal(p.moved, false); assert.equal(p.count, 2);
  const r = applyOps(s.doc, p.ops);
  const cues = r.doc.lists[0].cues;
  assert.deepEqual(cues.map((c) => c.name), ['Rain', 'Storm', 'Interval', 'Rain', 'Storm']);
  const [rain2, storm2] = cues.slice(3);
  assert.notEqual(rain2.id, s.id('rain'));
  assert.equal(rain2.number, undefined, 'a number the show already has is not pasted');
  assert.equal(rain2.file, 'media/rain.wav'); assert.equal(rain2.gainDb, -6);
  assert.equal(storm2.children![1].target, rain2.id, 'a target inside the clip follows the copy');
  assert.equal(storm2.children![2].target, storm2.children![0].id);
  assert.deepEqual(show.problems(r.doc).filter((x) => x.level === 'error'), []);
});

test('clipboard: a target outside the clip is kept in the same show; a cut pasted there is a move', () => {
  const s = scene();
  const copy = clipboard.pasteOps(clipboard.take(s.doc, [s.id('g')]), s.doc, { after: s.id('memo') });
  const r = applyOps(s.doc, copy.ops);
  assert.equal(r.doc.lists[0].cues[3].children![1].target, s.id('rain'));
  const cut = clipboard.pasteOps(clipboard.take(s.doc, [s.id('rain')], { cut: true }), s.doc, { after: s.id('memo') });
  assert.equal(cut.moved, true);
  assert.deepEqual(applyOps(s.doc, cut.ops).doc.lists[0].cues.map((c) => c.id), [s.id('g'), s.id('memo'), s.id('rain')]);
});

test('clipboard: pasted into another show, sounds are found from the first show’s folder and lost targets are dropped', () => {
  const a = scene();
  const b = build([{ op: 'cue.add', cue: { type: 'memo', number: '1', name: 'Top' } }]);
  const asked: string[] = [];
  const clip = clipboard.take(a.doc, [s2(a, 'g'), s2(a, 'memo')], { showDir: path.join(path.sep, 'shows', 'A.ecshow'), cut: true });
  const p = clipboard.pasteOps(clip, b.doc, { list: b.doc.lists[0].id }, { fileFor: (abs) => { asked.push(abs); return `media/${path.basename(abs)}`; } });
  assert.equal(p.moved, false, 'a cut cannot be a move in another show');
  const r = applyOps(b.doc, p.ops);
  const [top, storm, interval] = r.doc.lists[0].cues;
  assert.equal(top.name, 'Top');
  assert.deepEqual(asked, [path.join(path.sep, 'shows', 'A.ecshow', 'media', 'thunder.wav')]);
  assert.equal(storm.children![0].file, 'media/thunder.wav');
  assert.equal(storm.number, '2', 'a number that is free here comes across');
  assert.equal(storm.children![1].target, undefined, 'the rain is not in this show');
  assert.equal(storm.children![2].target, storm.children![0].id);
  assert.equal(interval.notes, 'house lights'); assert.equal(interval.number, '3');
  assert.ok(show.problems(r.doc).some((x) => x.id === storm.children![1].id && /no target/.test(x.why)), 'and the cue says so');
});
function s2(s: Built, ref: string) { return s.id(ref); }

test('clipboard: a cue aimed at one pasted after it still finds it', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', file: 'a.wav' } },
    { op: 'cue.add', ref: 'stop', before: '@a', cue: { type: 'stop', target: '@a' } },
  ]);
  const other = show.newShow('Other');
  const p = clipboard.pasteOps(clipboard.take(s.doc, [s.id('a'), s.id('stop')]), other, {});
  const cues = applyOps(other, p.ops).doc.lists[0].cues;
  assert.deepEqual(cues.map((c) => c.type), ['stop', 'audio']);
  assert.equal(cues[0].target, cues[1].id);
});

test('paste cue properties: the chosen fields only, and only onto cues that have them', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', file: 'a.wav', name: 'A', gainDb: -9, bus: 'music', fadeIn: 2, color: 'blue', preWait: 1.5, notes: 'mine' } },
    { op: 'cue.add', ref: 'b', cue: { type: 'audio', file: 'b.wav', name: 'B', fadeOut: 3, color: 'red' } },
    { op: 'cue.add', ref: 'm', cue: { type: 'memo', name: 'M' } },
    { op: 'cue.add', ref: 'f', cue: { type: 'fade', target: '@a', duration: 7 } },
    { op: 'cue.add', ref: 'w', cue: { type: 'wait', duration: 1 } },
  ]);
  const cue = (ref: string, doc = s.doc) => show.index(doc).byId.get(s.id(ref))!;
  const offered = clipboard.properties(cue('a'));
  assert.ok(offered.some((p) => p.key === 'gainDb' && p.set) && offered.some((p) => p.key === 'fadeOut' && !p.set));
  assert.ok(!offered.some((p) => p.key === 'number'), 'a number is one cue’s');
  const ops = clipboard.propertyOps(cue('a'), [cue('a'), cue('b'), cue('m')], ['gainDb', 'bus', 'color', 'preWait', 'fadeOut']);
  assert.equal(ops.length, 2, 'not onto itself');
  const r = applyOps(s.doc, ops).doc;
  const b = cue('b', r), m = cue('m', r);
  assert.deepEqual([b.gainDb, b.bus, b.color, b.preWait, b.fadeOut, b.name, b.file, b.fadeIn], [-9, 'music', 'blue', 1.5, undefined, 'B', 'b.wav', undefined]);
  assert.deepEqual([m.color, m.preWait, m.gainDb, m.name], ['blue', 1.5, undefined, 'M']);
  // a Fade's duration lands on a Wait; its target does not land on the cue it targets
  const r2 = applyOps(s.doc, clipboard.propertyOps(cue('f'), [cue('w'), cue('a')], ['duration', 'target', 'db'])).doc;
  assert.equal(cue('w', r2).duration, 7);
  assert.equal(cue('a', r2).target, undefined);
});

test('templates: a new cue starts from its type’s template; what belongs to the one cue is not in it', () => {
  const s = build([{ op: 'cue.add', ref: 'f', cue: { type: 'fade', number: '9', name: 'Out', notes: 'n', db: -30, duration: 8, stopTarget: true, color: 'green', continue: 'auto-continue' } }]);
  const t = templates.templateOf(s.doc.lists[0].cues[0]);
  assert.deepEqual(t, { color: 'green', continue: 'auto-continue', db: -30, duration: 8, stopTarget: true });
  const doc = applyOps(s.doc, [{ op: 'show.set', path: 'settings.templates.fade', value: { ...t, bogus: 1, duration: 'x' } }]).doc;
  assert.deepEqual(templates.templateFor(doc, 'fade'), { color: 'green', continue: 'auto-continue', db: -30, stopTarget: true }, 'what cannot be used is left out');
  assert.deepEqual(templates.withTemplate(doc, { type: 'fade', db: -3 }), { color: 'green', continue: 'auto-continue', db: -3, stopTarget: true, type: 'fade' });
  assert.deepEqual(templates.withTemplate(doc, { type: 'memo' }), { type: 'memo' });
  const made = applyOps(doc, [{ op: 'cue.add', cue: templates.withTemplate(doc, { type: 'fade' }) }]).doc.lists[0].cues[1];
  assert.equal(made.stopTarget, true); assert.equal(made.name, undefined); assert.equal(made.number, undefined);
  // it is kept by the show file, and a show without any reads as none
  assert.deepEqual(show.normalise(JSON.parse(show.stringify(doc))).doc.settings.templates.fade!.db, -30);
  assert.deepEqual(show.newShow('x').settings.templates, {});
  assert.deepEqual(show.newShow('x').settings.editing, { autoNumber: true, numberStep: 1, lockPlayhead: true, longSoundsToMusic: false });
});

test('renumber passes over numbers other cues have; unnumber takes numbers away', () => {
  const s = build(['1', '2', '3', 'x', 'y'].map((n) => ({ op: 'cue.add', cue: { type: 'memo', number: n } })));
  const ids = s.doc.lists[0].cues.map((c) => c.id);
  const r = applyOps(s.doc, [{ op: 'cue.renumber', ids: ids.slice(3), start: 2 }]).doc;
  assert.deepEqual(r.lists[0].cues.map((c) => c.number), ['1', '2', '3', '4', '5']);
  // the cues being renumbered may trade numbers among themselves
  assert.deepEqual(applyOps(s.doc, [{ op: 'cue.renumber', ids: ids.slice(0, 3), start: 2 }]).doc.lists[0].cues.map((c) => c.number), ['2', '3', '4', 'x', 'y']);
  assert.deepEqual(applyOps(s.doc, [{ op: 'cue.renumber', ids: [ids[3]], start: 1, prefix: 'A' }]).doc.lists[0].cues[3].number, 'A1');
  const u = applyOps(s.doc, [{ op: 'cue.unnumber', ids: ids.slice(1, 3) }]).doc;
  assert.deepEqual(u.lists[0].cues.map((c) => c.number), ['1', undefined, undefined, 'x', 'y']);
});

test('more colours, and a second colour, are fields like any other', () => {
  const s = build([{ op: 'cue.add', cue: { type: 'memo', color: 'indigo', color2: 'grey' } }]);
  assert.equal(s.doc.lists[0].cues[0].color2, 'grey');
  assert.throws(() => applyOps(s.doc, [{ op: 'cue.set', id: s.doc.lists[0].cues[0].id, props: { color2: 'beige' } }]), /one of/);
  assert.ok(require('../core/show/cue-types').COLORS.length >= 20);
});

test('the engine remembers which cues have played, until Reset', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'memo', name: 'A' } },
    { op: 'cue.add', ref: 'g', cue: { type: 'group', children: [{ type: 'memo', ref: 'k', name: 'K' }] } },
    { op: 'cue.add', ref: 'c', cue: { type: 'memo', name: 'C' } },
  ]);
  const r = rig(s.doc);
  assert.deepEqual(r.engine.snapshot().played, []);
  r.engine.go(); r.advance(1); r.engine.go(); r.advance(1);
  assert.deepEqual(new Set(r.engine.snapshot().played), new Set([s.id('a'), s.id('g'), s.id('k')]));
  r.engine.reset();
  assert.deepEqual(r.engine.snapshot().played, []);
});
