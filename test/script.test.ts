/** The Script cue: a list of show commands, not a program (core/show/script.js; run by the engine). */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as show from '../core/show/show';
import * as script from '../core/show/script';
import { simulate } from '../core/engine/dry-run';
import { rig, build } from './helpers';

test('a script is commands and waits; anything else is a problem with its line number, never something run', () => {
  const r = script.parse(['# the storm', '/cue/12/start', 'wait 2.5', '', '/cue/1%2F2/stop', '/cue_id/c_abc/togglePause', '/playhead/next', '/playhead/20', '/go', 'wait 1:30 s'].join('\n'));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.steps.map(({ line, ...s }) => s), [
    { do: 'start', number: '12' }, { do: 'wait', secs: 2.5 }, { do: 'stop', number: '1/2' }, { do: 'toggle', id: 'c_abc' },
    { do: 'move', step: 1 }, { do: 'playhead', number: '20' }, { do: 'go' }, { do: 'wait', secs: 90 }]);
  assert.equal(script.lengthOf(r.steps), 92.5);
  const bad = script.parse(['/save', 'require("fs")', '/cue/12/name Thunder', '/cue/12/delete', 'wait soon', '/undo', '/showMode 0', 'do shell script "rm -rf ~"'].join('\n'));
  assert.equal(bad.steps.length, 0, 'nothing that edits, saves, or is not a command becomes a step');
  assert.deepEqual(bad.errors.map((e) => e.line), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.match(bad.errors[3].why, /not something a script can do to a cue/);
});

const storm = () => build([
  { op: 'cue.add', ref: 'rain', cue: { type: 'audio', number: '1', name: 'Rain', file: 'media/rain.wav' } },
  { op: 'cue.add', ref: 'bell', cue: { type: 'audio', number: '2', name: 'Bell', file: 'media/bell.wav' } },
  { op: 'cue.add', ref: 's', cue: { type: 'script', number: '3', script: '/cue/1/start\nwait 2\n/cue/2/start\nwait 1\n/cue/1/stop\n/playhead/1' } },
]);

test('the engine runs a script on its own clock: in order, pausable, and stopped with its cue', () => {
  const b = storm();
  assert.deepEqual(show.problems(b.doc), []);
  const { engine, audio, advance } = rig(b.doc);
  const plays = () => audio.calls.filter((c) => c[0] === 'play').map((c) => c[1]);
  engine.setPlayhead(b.id('s')); engine.go();
  assert.deepEqual(plays(), [b.id('rain')]);
  assert.ok(engine.isLive(b.id('s')), 'the script shows as running while it waits');
  advance(1);
  engine.pause(b.id('s')); advance(5);
  assert.deepEqual(plays(), [b.id('rain')], 'a paused script does not go on');
  engine.resume(b.id('s')); advance(0.9);
  assert.deepEqual(plays(), [b.id('rain')]);
  advance(0.2);
  assert.deepEqual(plays(), [b.id('rain'), b.id('bell')], 'the wait is two seconds of running, not of the clock on the wall');
  advance(1.1);
  assert.ok(audio.calls.some((c) => c[0] === 'stop' && c[1] === b.id('rain')));
  assert.equal(engine.playhead, b.id('rain'), 'and the playhead went where the last line sent it');
  assert.equal(engine.isLive(b.id('s')), false);
  // stopped part-way: what was still to come does not happen
  engine.reset(); audio.calls.length = 0;
  engine.fire(b.id('s')); advance(0.5); engine.stopCue(b.id('s')); advance(10);
  assert.deepEqual(plays(), [b.id('rain')]);
});

test('a script that names a cue that is not there is broken, and one that starts itself is stopped', () => {
  const b = build([
    { op: 'cue.add', ref: 's', cue: { type: 'script', number: '1', script: '/cue/99/start\n/launch/missiles' } },
    { op: 'cue.add', ref: 'loop', cue: { type: 'script', number: '2', script: '/cue/2/start' } },
    { op: 'cue.add', ref: 'e', cue: { type: 'script', number: '3', script: '# nothing yet' } },
  ]);
  const probs = show.problems(b.doc).map((p) => `${p.level} ${p.why}`);
  assert.ok(probs.some((p) => /^error its script, line 1: no cue numbered 99/.test(p)), probs);
  assert.ok(probs.some((p) => /^error its script, line 2: \/launch\/missiles is not a command/.test(p)), probs);
  assert.ok(probs.some((p) => /^warning its script has no commands/.test(p)), probs);
  const { engine, logs } = rig(b.doc);
  engine.fire(b.id('loop'));
  assert.ok(logs.some((l) => /STOPPED a loop of scripts/.test(l)), 'a script that starts itself with no wait ends, instead of hanging the app');
});

test('a dry run reads a script as it would play', () => {
  const r = simulate(storm().doc, { from: '3', gos: 1, durations: { 'media/rain.wav': 30, 'media/bell.wav': 4 } });
  const text = r.events.map((e) => `${e.t} ${e.text}`).join('\n');
  assert.match(text, /^0 ▶ Rain plays/m);
  assert.match(text, /^2 ▶ Bell plays/m);
  assert.match(text, /^3 ■ Rain stops/m);
});
