/**
 * A Network cue beyond one OSC message: resent for a duration, a value fading along a curve or as whole
 * numbers, a point moving along a path, and text or hex payloads. The engine on a fake clock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as show from '../core/show/show';
import { plan, parsePath, along } from '../core/net/network-cue';
import { rig, build } from './helpers';
import type { CueSpec } from '../core/show/ops';

const one = (cue: Partial<CueSpec>) => { const s = build([{ op: 'cue.add', ref: 'n', cue: { type: 'network', ...cue } }]); return { ...s, r: rig(s.doc) }; };

test('a Network cue with a duration and no value to fade is sent again and again for that long', () => {
  const { r } = one({ message: '/keepalive 1', duration: 1, fps: 4 });
  r.engine.go();
  assert.deepEqual(r.sent, ['/keepalive 1']);
  assert.equal(r.engine.active().length, 1, 'it is running, and shows as such');
  r.advance(0.6);
  assert.equal(r.sent.length, 3);
  r.advance(1);
  assert.equal(r.sent.length, 5, 'four a second for one second, and the one at the start');
  assert.equal(r.engine.active().length, 0);
  // stopped part-way: no more are sent
  const again = one({ message: '/keepalive 1', duration: 10, fps: 10 });
  again.r.engine.go(); again.r.advance(0.35);
  again.r.engine.panic(); again.r.engine.panic();
  const n = again.r.sent.length;
  again.r.advance(5);
  assert.equal(again.r.sent.length, n);
  assert.equal(plan({ message: '/x', duration: 1, fps: 5000 }).rate, 120, 'never more than 120 a second');
});

test('a fading value: along a curve, as whole numbers, and still a float by default', () => {
  const lin = plan({ message: '/fader #v#', fadeFrom: 0, fadeTo: 100, duration: 2 });
  assert.deepEqual([lin.at(0), lin.at(0.25), lin.at(1)], ['/fader 0.0', '/fader 25.0', '/fader 100.0']);
  const s = plan({ message: '/fader #v#', fadeFrom: 0, fadeTo: 100, duration: 2, curve: 's-curve' });
  assert.deepEqual([s.at(0), s.at(0.25), s.at(0.5), s.at(1)], ['/fader 0.0', '/fader 15.625', '/fader 50.0', '/fader 100.0']);
  assert.equal(plan({ message: '/f #v#', fadeTo: 100, curve: 'ease-in' }).at(0.5), '/f 25.0');
  assert.equal(plan({ message: '/f #v#', fadeTo: 100, curve: 'ease-out' }).at(0.5), '/f 75.0');
  const whole = plan({ message: '/dmx/#v# #v#', fadeFrom: 0, fadeTo: 255, whole: true });
  assert.equal(whole.at(0.5), '/dmx/128 128', 'an integer, in the address too');
  assert.equal(plan({ message: '/f #v#', fadeFrom: 0, fadeTo: 1 }).at(1 / 3), '/f 0.333333', 'six places');
  // through the engine, at the cue's own rate
  const { r } = one({ message: '/level #v#', fadeFrom: 0, fadeTo: 10, duration: 1, fps: 2, whole: true });
  r.engine.go(); r.advance(2);
  assert.deepEqual(r.sent, ['/level 0', '/level 5', '/level 10']);
});

test('a point moving along a path: #x# and #y#, at an even speed, once or round and round', () => {
  assert.deepEqual(parsePath('0,0 1,0  1,1'), [[0, 0], [1, 0], [1, 1]]);
  assert.deepEqual(parsePath('{0,0} {-2.5,4}; 1,1'), [[0, 0], [-2.5, 4], [1, 1]]);
  assert.throws(() => parsePath('0,0 nonsense'), /“nonsense” is not one/);
  assert.throws(() => parsePath('1,2,3'), /not one/);
  assert.deepEqual(along([[0, 0], [2, 0], [2, 2]], 0.75), [2, 1], 'by distance along the whole path, not by point');
  assert.deepEqual(along([[3, 4]], 0.5), [3, 4]);
  const p = plan({ message: '/pos #x# #y#', path: '0,0 2,0 2,2', duration: 4 });
  assert.deepEqual([p.at(0), p.at(0.25), p.at(0.5), p.at(1)], ['/pos 0.0 0.0', '/pos 1.0 0.0', '/pos 2.0 0.0', '/pos 2.0 2.0']);
  assert.equal(p.loop, false);
  const { r, id } = one({ message: '/pos #x# #y#', path: '0,0 1,0', duration: 1, fps: 2, pathLoop: true });
  r.engine.go(); r.advance(2.2);
  assert.deepEqual(r.sent.slice(0, 5), ['/pos 0.0 0.0', '/pos 0.5 0.0', '/pos 1.0 0.0', '/pos 0.5 0.0', '/pos 1.0 0.0'], 'it jumps back to the start and goes round again');
  assert.equal(r.engine.active().length, 1, 'until it is stopped');
  r.engine.stopCue(id('n'));
  const n = r.sent.length; r.advance(3);
  assert.equal(r.sent.length, n);
});

test('text and hex messages are sent once, as written, and the show says what is wrong with one', () => {
  const { r, doc } = one({ message: 'PLAY #v#\\r', format: 'text', duration: 3 });
  r.engine.go(); r.advance(5);
  assert.deepEqual(r.sent, ['PLAY #v#\\r'], 'once, whatever its duration, and no token is filled in');
  const why = (cue: Partial<CueSpec>) => show.problems(one(cue).doc).map((p) => `${p.level}: ${p.why}`);
  assert.deepEqual(show.problems(doc).map((p) => p.level), ['warning']);
  assert.match(why({ message: 'hello' })[0], /an OSC message starts with \//);
  assert.deepEqual(why({ message: 'hello', format: 'text' }), []);
  assert.deepEqual(why({ message: 'FE 01', format: 'hex' }), []);
  assert.match(why({ message: 'FE 0', format: 'hex' })[0], /not hex: an odd number/);
  assert.match(why({ message: '/pos #x# #y#' })[0], /no path/);
  assert.match(why({ message: '/pos #x# #y#', path: '0,0 oops' })[0], /“oops” is not one/);
  assert.deepEqual(why({ message: '/pos #x# #y#', path: '0,0 1,1' }), []);
  assert.deepEqual(why({ message: '/keepalive', duration: 5 }), [], 'a duration with nothing to fade is a resend, not a mistake');
});
