/**
 * The calmer window's rules (app/renderer/tidy.ts) and a cue's colour as the show keeps it (core/show/cue-types.ts):
 * a named colour or one from the wheel, the list's empty columns and Show mode holding them, the add-cue list's filter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Tidy from '../app/renderer/tidy';
import { COLORS, PALETTE, cleanColor, COMMON, coerce, TYPES, TYPE_ORDER } from '../core/show/cue-types';
import * as show from '../core/show/show';
import { applyOps } from '../core/show/ops';

const colorField = COMMON.find((f) => f.key === 'color')!;

test('the inspector offers six colours, each a name the show already knew', () => {
  assert.deepEqual(PALETTE, ['none', 'red', 'orange', 'yellow', 'green', 'blue']);
  for (const c of PALETTE) assert.ok(COLORS.includes(c));
});

test('a colour is a name or #rrggbb: names stay as they were, a chosen colour is kept in lower case', () => {
  for (const c of COLORS) assert.equal(cleanColor(c), c);
  assert.equal(cleanColor('Teal'), 'teal');
  assert.equal(cleanColor('#3A7BFF'), '#3a7bff');
  assert.equal(cleanColor('#abc'), '#aabbcc');
  for (const bad of ['', 'chartreuse', '#12345', '#ggg000', 'rgb(1,2,3)', null, 12]) assert.equal(cleanColor(bad), null, String(bad));
});

test('a cue takes a chosen colour through an edit, and keeps it through a save and a load', () => {
  assert.deepEqual(coerce(colorField, '#FF8800'), { ok: true, value: '#ff8800' });
  assert.equal(coerce(colorField, 'chartreuse').ok, false);
  assert.deepEqual(coerce(colorField, 'purple'), { ok: true, value: 'purple' });
  const made = applyOps(show.newShow('Colours'), [
    { op: 'cue.add', ref: 'a', cue: { type: 'memo', name: 'A', color: 'purple' } },
    { op: 'cue.add', ref: 'b', cue: { type: 'memo', name: 'B' } },
  ]);
  const b = made.refs.b;
  const after = applyOps(made.doc, [{ op: 'cue.set', id: b, props: { color: '#12AB9C', color2: '#000000' } }]).doc;
  const again = show.normalise(JSON.parse(show.stringify(after))).doc;
  const cue = again.lists[0].cues.find((c) => c.id === b)!;
  assert.equal(cue.color, '#12ab9c');
  assert.equal(cue.color2, '#000000');
  assert.equal(again.lists[0].cues[0].color, 'purple');
  assert.throws(() => applyOps(after, [{ op: 'cue.set', id: b, props: { color: 'url(x)' } }]));
});

test('a colour is drawn as its theme token by name, as chosen by value, and never from anything else', () => {
  assert.equal(Tidy.colorCss('red'), 'var(--c-red)');
  assert.equal(Tidy.colorCss('lavender'), 'var(--c-lavender)');
  assert.equal(Tidy.colorCss('#12ab9c'), '#12ab9c');
  assert.equal(Tidy.colorCss('none'), null);
  assert.equal(Tidy.colorCss(''), null);
  assert.equal(Tidy.colorCss(undefined), null);
  assert.equal(Tidy.colorCss('red;background:url(x)'), null);
  assert.equal(Tidy.isCustomColor('#12AB9C'), true);
  assert.equal(Tidy.isCustomColor('teal'), false);
});

test('a column nothing in the list fills is left out, and comes back for one cue with a value (inside a group too)', () => {
  const dur = (c: Tidy.CueLike) => (c.type === 'fade' ? '0:05.0' : '');
  const plain: Tidy.CueLike[] = [{ type: 'memo', name: 'A' }, { type: 'memo', name: 'B', preWait: 0 }];
  assert.deepEqual(Tidy.usedColumns(plain, dur), { target: false, preWait: false, duration: false, postWait: false });
  const nested: Tidy.CueLike[] = [{ type: 'group', children: [{ type: 'memo', postWait: 2 }, { type: 'fade', target: 'x' }] }, { type: 'section', name: 'Act', preWait: 4 }];
  assert.deepEqual(Tidy.usedColumns(nested, dur), { target: true, preWait: false, duration: true, postWait: true });
  // a sound shows its file there only once it has a name of its own (otherwise the name is the file), or a bus
  assert.equal(Tidy.usedColumns([{ type: 'audio', file: 'a.wav' }]).target, false);
  assert.equal(Tidy.usedColumns([{ type: 'audio', file: 'a.wav', name: 'Rain' }]).target, true);
  assert.equal(Tidy.usedColumns([{ type: 'network', message: '/go' }]).target, true);
});

test('in Show mode the columns stay as they were when Show began; back in Edit they follow the list again', () => {
  const st = {};
  const before = { target: true, preWait: false, duration: true, postWait: false };
  assert.deepEqual(Tidy.frozenColumns(st, before, false), before);
  assert.deepEqual(Tidy.frozenColumns(st, before, true), before);
  const later = { target: true, preWait: true, duration: true, postWait: true };
  assert.deepEqual(Tidy.frozenColumns(st, later, true), before, 'nothing moves during the show');
  assert.deepEqual(Tidy.frozenColumns(st, later, false), later);
  assert.deepEqual(Tidy.frozenColumns(st, before, true), before, 'a new Show takes the columns as they are then');
});

test('the add-cue list keeps the types that match what was typed, best first, and all of them for nothing typed', () => {
  assert.deepEqual(Tidy.matchTypes(TYPES, TYPE_ORDER, ''), TYPE_ORDER);
  const v = Tidy.matchTypes(TYPES, TYPE_ORDER, 'vid');
  assert.equal(v[0], 'video');
  const m = Tidy.matchTypes(TYPES, TYPE_ORDER, 'mi');
  assert.ok(m.includes('midi') && m.indexOf('midi') < m.length);
  assert.ok(m.every((id) => TYPE_ORDER.includes(id)));
  assert.deepEqual(Tidy.matchTypes(TYPES, TYPE_ORDER, 'zzzz'), []);
  // a word inside the label counts after the label's start
  const types = { a: { label: 'Network' }, b: { label: 'Timecode' }, c: { label: 'MIDI File' } };
  assert.deepEqual(Tidy.matchTypes(types, ['a', 'b', 'c'], 'fi'), ['c']);
  assert.deepEqual(Tidy.matchTypes(types, ['a', 'b', 'c'], 'n'), ['a']);
});
