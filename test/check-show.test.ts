// Check the show (core/show/check.ts): what would go wrong, found without playing anything.
import test from 'node:test';
import assert from 'node:assert';
import { build } from './helpers';
import { checkShow, summary, loops } from '../core/show/check';
import type { CueSpec, Op, Place } from '../core/show/ops';

const add = (ref: string, cue: CueSpec, more: Place = {}): Op => ({ op: 'cue.add', ref, cue, ...more });

test('a plain show has nothing wrong', () => {
  const s = build([add('a', { type: 'audio', file: 'media/a.wav', number: '1' }), add('f', { type: 'fade', target: '@a', number: '2' })]);
  const lines = checkShow(s.doc, { problems: [], rig: [] });
  assert.deepEqual(lines, []);
  assert.equal(summary(lines), 'Nothing wrong');
});

test('the cues’ own problems come first, a target that is gone among them', () => {
  const s = build([add('a', { type: 'audio', file: 'media/a.wav' }), add('f', { type: 'fade', target: '@a' }), { op: 'cue.remove', id: '@a' }]);
  const lines = checkShow(s.doc);
  assert.deepEqual(lines.map((x) => [x.id, x.level]), [[s.id('f'), 'problem']]);
  assert.match(lines[0].text, /target is gone/);
  const extra = checkShow(s.doc, { problems: [{ id: s.id('f'), level: 'error', why: 'its file is missing' }, { id: s.id('f'), level: 'error', why: 'its file is missing' }] });
  assert.equal(extra.length, 1, 'the same line once');
});

test('a disarmed cue with nothing to arm it never plays; one an Arm cue arms is fine', () => {
  const s = build([add('a', { type: 'audio', file: 'media/a.wav', armed: false }), add('b', { type: 'audio', file: 'media/b.wav', armed: false }), add('arm', { type: 'arm', target: '@b' }),
    add('g', { type: 'group', armed: false }), add('k', { type: 'audio', file: 'media/k.wav', armed: false }, { parent: '@g' })]);
  const lines = checkShow(s.doc, { problems: [] });
  assert.deepEqual(lines.map((x) => x.id), [s.id('a'), s.id('g')], 'a disarmed group is said once, not for each cue in it');
  assert.match(lines[0].text, /never plays/);
});

test('Start cues that start each other with no wait: a problem; with a wait: to look at', () => {
  const s = build([add('a', { type: 'start', number: '1' }), add('b', { type: 'start', number: '2', target: '@a' }), { op: 'cue.set', id: '@a', props: { target: '@b' } }]);
  const lp = loops(s.doc);
  assert.equal(lp.length, 1);
  const lines = checkShow(s.doc, { problems: [] });
  assert.equal(lines[0].level, 'problem');
  assert.match(lines[0].text, /no wait \(1 → 2 → 1\)/);
  const w = build([add('a', { type: 'start', number: '1' }), add('b', { type: 'start', number: '2', target: '@a', preWait: 4 }), { op: 'cue.set', id: '@a', props: { target: '@b' } }]);
  const l2 = checkShow(w.doc, { problems: [] });
  assert.equal(l2[0].level, 'look');
  assert.match(l2[0].text, /every 4 s/);
});

test('a loop made by a continue and a Start cue, and one made by a script', () => {
  const s = build([add('a', { type: 'memo', number: '1', continue: 'auto-continue', postWait: 2 }), add('b', { type: 'start', number: '2', target: '@a' })]);
  assert.match(checkShow(s.doc, { problems: [] })[0].text, /every 2 s/);
  const sc = build([add('a', { type: 'audio', file: 'media/a.wav', number: '5' }), add('s', { type: 'script', number: '6', script: '/cue/5/start\nwait 1\n/cue/6/start' })]);
  const lines = checkShow(sc.doc, { problems: [] });
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /every 1 s \(6 → 6\)/);
});

test('a playlist going round, or an auto-follow, is not a loop that can be timed: nothing said', () => {
  const s = build([add('a', { type: 'audio', file: 'media/a.wav', number: '1', continue: 'auto-follow' }), add('b', { type: 'start', number: '2', target: '@a' })]);
  assert.deepEqual(checkShow(s.doc, { problems: [] }), []);
});

test('two OSC triggers on the same message clash', () => {
  const s = build([add('a', { type: 'memo', number: '1', oscTrigger: '/sm/go' }), add('b', { type: 'memo', number: '2', oscTrigger: '/sm/go' })]);
  const lines = checkShow(s.doc, { problems: [] });
  assert.equal(lines.length, 2);
  assert.match(lines[0].text, /OSC trigger \/sm\/go also starts 2/);
});

test('the Rig’s problems with the equipment and outputs right now, each pointing at a cue that uses it', () => {
  const s = build([add('n', { type: 'network', number: '9', patch: 'desk', message: '/eos/go' })]);
  const rig = [
    { id: 'sound.output', group: 'sound', label: 'Sound goes to MOTU', state: 'problem', text: 'away: on this computer’s default output', needed: true },
    { id: 'patch.desk', group: 'equipment', label: 'Desk', state: 'problem', text: 'it cannot be sent to', needed: true, patch: 'desk' },
    { id: 'device.prop', group: 'equipment', label: 'Prop', state: 'ready', text: 'answering', needed: true, device: 'prop' },
    { id: 'show.saved', group: 'show', label: 'The show is saved', state: 'look', text: 'unsaved', needed: true },
  ];
  const lines = checkShow(s.doc, { problems: [], rig });
  assert.deepEqual(lines.map((x) => [x.id, x.text, x.rig]), [[null, 'Sound goes to MOTU: away: on this computer’s default output', true], [s.id('n'), 'Desk: it cannot be sent to', true]]);
});
