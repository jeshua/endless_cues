// Run from here (core/engine/run-from.js): a rehearsal at a cue, with what would be going on there.
import test from 'node:test';
import assert from 'node:assert';
import { rig, build } from './helpers';
import * as runFrom from '../core/engine/run-from';
import type { RunPlan } from '../core/engine/run-from';
import type { CueSpec, Op, Place } from '../core/show/ops';

/** A plan as these tests read it (a refused one has only its error). */
const plan = (...a: Parameters<typeof runFrom.plan>) => runFrom.plan(...a) as RunPlan;

const add = (ref: string, cue: CueSpec, more: Place = {}): Op => ({ op: 'cue.add', ref, cue, ...more });
function scene() {
  return build([
    add('rain', { type: 'audio', number: '1', name: 'Rain', file: 'media/rain.wav', loop: true }),
    add('thunder', { type: 'audio', number: '2', name: 'Thunder', file: 'media/thunder.wav' }),
    add('music', { type: 'audio', number: '3', name: 'Music', file: 'media/music.wav', gainDb: -3 }),
    add('down', { type: 'fade', number: '4', target: '@music', db: -12, duration: 2 }),
    add('blue', { type: 'network', number: '5', message: '/lamp/color blue' }),
    add('red', { type: 'network', number: '6', message: '/lamp/color red' }),
    add('dim', { type: 'network', number: '7', message: '/lamp/level 0.5' }),
    add('here', { type: 'memo', number: '8', name: 'Here' }),
    add('out', { type: 'fade', number: '9', target: '@music', duration: 3 }),
  ]);
}

test('what loops, and what the show stops later, is brought back at the level the fades left it at', () => {
  const s = scene();
  const p = plan(s.doc, s.id('here'));
  assert.deepEqual(p.sounds.map((x) => [x.name, x.db, x.at, x.why]), [['Rain', 0, 0, 'goes on'], ['Music', -12, 0, 'stopped later']]);
  assert.deepEqual(p.left, [s.id('thunder')], 'a one-off sound the show never stops ended by itself');
  assert.deepEqual(p.sends.map((x) => x.number), ['6', '7'], 'the last word on each address: red, not blue; and the level');
  assert.equal(p.text, 'Starts 2 sounds and sends 2 messages.');
});

test('a sound faded out and stopped before the cue is not brought back', () => {
  const s = build([
    add('rain', { type: 'audio', number: '1', file: 'media/rain.wav', loop: true }),
    add('gone', { type: 'fade', number: '2', target: '@rain', duration: 4 }),
    add('here', { type: 'memo', number: '3' }),
  ]);
  const p = plan(s.doc, s.id('here'));
  assert.deepEqual(p.sounds, []);
  assert.equal(p.text, 'Nothing to bring back: it starts from silence.');
});

test('a cue reached by a continue: what its sequence started is where it would be', () => {
  const s = build([
    add('bed', { type: 'audio', number: '1', file: 'media/bed.wav', continue: 'auto-continue', postWait: 5 }),
    add('here', { type: 'memo', number: '2' }),
  ]);
  const p = plan(s.doc, s.id('here'), { durations: { 'media/bed.wav': 60 } });
  assert.equal(p.reachedByContinue, true);
  assert.deepEqual(p.sounds.map((x) => [x.at, x.why]), [[5, 'still playing']]);
  const short = plan(s.doc, s.id('here'), { durations: { 'media/bed.wav': 3 } });
  assert.deepEqual(short.sounds, [], 'a 3 s sound is over 5 s later');
});

test('a sound with a section it holds comes back at that section; a sound followed by the next plays to its end first', () => {
  const s = build([
    add('vamp', { type: 'audio', number: '1', file: 'media/vamp.wav', loops: [{ start: 12, end: 20, hold: true }] }),
    add('song', { type: 'audio', number: '2', file: 'media/song.wav', continue: 'auto-follow' }),
    add('next', { type: 'audio', number: '3', file: 'media/next.wav', loop: true }),
    add('here', { type: 'memo', number: '4' }),
  ]);
  const p = plan(s.doc, s.id('here'), { durations: { 'media/song.wav': 30 } });
  assert.deepEqual(p.sounds.map((x) => [x.number, x.at]), [['1', 12], ['3', 0]]);
});

test('a Device cue and the mixer: the last word on each wins', () => {
  const s = build([
    add('m1', { type: 'mix', number: '1', levels: { music: -6 } }),
    add('m2', { type: 'mix', number: '2', levels: { music: -10, effects: -3 } }),
    add('here', { type: 'memo', number: '3' }),
  ]);
  const p = plan(s.doc, s.id('here'));
  assert.deepEqual(p.sends.map((x) => [x.number, x.kind]), [['2', 'mix']]);
  assert.equal(p.text, 'Sets the mixer.');
});

test('Run from here on the real engine: everything stops, the plan starts, the playhead stands on the cue', () => {
  const s = scene();
  const r = rig(s.doc);
  r.engine.fire(s.id('thunder'));
  const p = plan(s.doc, s.id('here'));
  runFrom.apply(r.engine, p);
  assert.deepEqual([...r.audio.playing.keys()].sort(), [s.id('rain'), s.id('music')].sort());
  r.advance(0.1);
  assert.equal(r.audio.playing.get(s.id('music'))!.db, -12);
  assert.deepEqual(r.sent, ['/lamp/color red', '/lamp/level 0.5']);
  assert.equal(r.engine.playhead, s.id('here'));
  r.engine.go(); r.engine.go();                     // and the show goes on from there: 8, then 9 fades the music out
  r.advance(4);
  assert.ok(!r.audio.playing.has(s.id('music')));
  assert.ok(r.audio.playing.has(s.id('rain')));
});

test('a cue not at the top of a list is refused', () => {
  const s = build([add('g', { type: 'group' }), add('k', { type: 'memo' }, { parent: '@g' })]);
  assert.ok(plan(s.doc, s.id('k')).error);
});
