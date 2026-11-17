import test from 'node:test';
import assert from 'node:assert/strict';
import { rig, build } from './helpers';
import type { Rig, Built, SoundLine } from './helpers';
import type { CueSpec } from '../core/show/ops';
import type { EngineOptions } from '../core/engine/cue-engine';

const basic = () => build([
  { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', name: 'Preshow', file: 'media/pre.wav', bus: 'music', gainDb: -6 } },
  { op: 'cue.add', ref: 'f', cue: { type: 'fade', number: '2', target: '@a', db: -60, duration: 4, stopTarget: true } },
  { op: 'cue.add', ref: 'g', cue: { type: 'group', number: '3', name: 'Scene 1', fadeOthers: 2, children: [
    { type: 'audio', ref: 'm', name: 'Storm', file: 'media/storm.wav', bus: 'music' },
    { type: 'network', ref: 'n', message: '/eos/cue/1/5/fire', preWait: 1.5 },
  ] } },
  { op: 'cue.add', ref: 'w', cue: { type: 'wait', number: '4', duration: 2, continue: 'auto-follow' } },
  { op: 'cue.add', ref: 'lq', cue: { type: 'light', number: 'LQ7', lightCue: '7' } },
  { op: 'cue.add', ref: 'memo', cue: { type: 'memo', number: '5', name: 'End' } },
]);

test('GO fires the cue at the playhead and moves on', () => {
  const s = basic();
  const r = rig(s.doc);
  assert.equal(r.engine.playhead, s.id('a'));
  r.engine.go();
  assert.deepEqual(r.audio.calls[0].slice(0, 2), ['play', s.id('a')]);
  assert.equal(r.audio.calls[0][2].gainDb, -6);
  assert.equal(r.audio.calls[0][2].bus, 'music');
  assert.equal(r.engine.playhead, s.id('f'));
});

test('a fade with stop-target fades, then stops its target', () => {
  const s = basic();
  const r = rig(s.doc);
  r.engine.go(); r.engine.go();
  assert.deepEqual(r.audio.calls.at(-1), ['fade', s.id('a'), -60, 4, undefined]);
  r.advance(3.9);
  assert.ok(r.audio.playing.has(s.id('a')));
  r.advance(0.2);
  assert.ok(!r.audio.playing.has(s.id('a')));
});

test('a group fires its children together, each after its own pre-wait, and fades the others', () => {
  const s = basic();
  const r = rig(s.doc);
  r.engine.go();                       // preshow
  r.engine.setPlayhead(s.id('g'));
  r.engine.go();
  assert.ok(r.audio.playing.has(s.id('m')));
  assert.deepEqual(r.sent, []);
  r.advance(1.6);
  assert.deepEqual(r.sent, ['/eos/cue/1/5/fire']);
  r.advance(1);                        // fadeOthers 2 s has landed
  assert.ok(!r.audio.playing.has(s.id('a')));
  assert.ok(r.audio.playing.has(s.id('m')));
});

test('auto-follow fires the next cue when a Wait finishes; a Light cue calls the desk hook', () => {
  const s = basic();
  const r = rig(s.doc);
  r.engine.setPlayhead(s.id('w'));
  r.engine.go();
  assert.equal(r.engine.playhead, s.id('memo'), 'the playhead passes the followed cue');
  assert.deepEqual(r.lights, []);
  r.advance(2.1);
  assert.deepEqual(r.lights, ['7']);
});

test('with light cues off they are not stops', () => {
  const s = basic();
  const r = rig(s.doc);
  r.engine.setSkipLights(true);
  r.engine.setPlayhead(s.id('lq'));
  assert.equal(r.engine.playhead, s.id('memo'));
});

test('panic fades over the show setting; a second panic stops dead', () => {
  const s = basic();
  const r = rig(s.doc, { panicFade: 2.5 });
  r.engine.go();
  r.engine.panic();
  assert.deepEqual(r.audio.calls.at(-1), ['fade', s.id('a'), -60, 2.5, undefined]);
  r.advance(0.5);
  r.engine.panic();
  assert.ok(!r.audio.playing.has(s.id('a')));
});

test('disarmed cues are skipped; Arm and Disarm cues flip a target', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'a.wav', armed: false } },
    { op: 'cue.add', ref: 'arm', cue: { type: 'arm', number: '2', target: '@a' } },
    { op: 'cue.add', ref: 'go', cue: { type: 'start', number: '3', target: '@a' } },
  ]);
  const r = rig(s.doc);
  r.engine.go();
  assert.equal(r.audio.calls.length, 0);
  r.engine.go(); r.engine.go();
  assert.deepEqual(r.audio.calls[0].slice(0, 2), ['play', s.id('a')]);
});

test('GoTo moves the playhead; Pause then Start resumes', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'a.wav' } },
    { op: 'cue.add', ref: 'p', cue: { type: 'pause', number: '2', target: '@a' } },
    { op: 'cue.add', ref: 's', cue: { type: 'start', number: '3', target: '@a' } },
    { op: 'cue.add', ref: 'j', cue: { type: 'goto', number: '4', target: '@a' } },
  ]);
  const r = rig(s.doc);
  r.engine.go(); r.advance(1);
  r.engine.go();
  assert.ok(r.engine.isPaused(s.id('a')));
  r.engine.go();
  assert.ok(!r.engine.isPaused(s.id('a')));
  assert.equal(r.audio.calls.filter((c) => c[0] === 'play').length, 1, 'resumed, not restarted');
  r.engine.go();
  assert.equal(r.engine.playhead, s.id('a'));
});

test('auto-continue chains after the post-wait', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'a.wav', continue: 'auto-continue', postWait: 3 } },
    { op: 'cue.add', ref: 'b', cue: { type: 'audio', number: '2', file: 'b.wav' } },
    { op: 'cue.add', ref: 'c', cue: { type: 'memo', number: '3' } },
  ]);
  const r = rig(s.doc);
  r.engine.go();
  assert.equal(r.engine.playhead, s.id('c'));
  r.advance(2.9);
  assert.ok(!r.audio.playing.has(s.id('b')));
  r.advance(0.2);
  assert.ok(r.audio.playing.has(s.id('b')));
});

test('a broken target does not stop the list loading; it is reported', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'a.wav' } },
    { op: 'cue.add', ref: 'f', cue: { type: 'fade', number: '2', target: '@a' } },
    { op: 'cue.remove', id: '#1' },
  ]);
  const r = rig(s.doc);
  assert.equal(r.engine.problems().length, 1);
  r.engine.go();                       // does nothing, throws nothing
});

test('a devamp lets a looping sound play out its pass', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'loop.wav', loop: true } },
    { op: 'cue.add', ref: 'd', cue: { type: 'devamp', number: '2', target: '@a' } },
  ]);
  const r = rig(s.doc);
  r.engine.go();
  assert.equal(r.audio.calls[0][2].loop, true);
  r.engine.go();
  assert.deepEqual(r.audio.calls.at(-1), ['setLoop', s.id('a'), false]);
});

test('Fade to crossfades inside the track where a skip jumps; paused, it only skips', () => {
  const s = build([{ op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'a.wav' } }]);
  const r = rig(s.doc);
  r.engine.setDuration('a.wav', 120);
  r.engine.go(); r.advance(10);
  r.engine.fadeTo(s.id('a'), 60, 1.5);
  const mv = r.audio.calls.at(-1)!;
  assert.equal(mv[0], 'move');
  assert.equal(mv[2].sync.xf, 1.5);
  assert.equal(mv[2].sync.blend, 'fade');
  assert.ok(Math.abs(mv[2].to - (60 - 0.75)) < 0.01, 'the crossfade is centred on the place asked for');
  r.advance(2);
  assert.ok(Math.abs(r.engine.active()[0].elapsed - 61.2) < 0.2);
  r.engine.pause(s.id('a'));
  r.engine.fadeTo(s.id('a'), 30);
  assert.deepEqual(r.audio.calls.at(-1)!.slice(0, 3), ['seek', s.id('a'), 30]);
});

test('reloading an edited list keeps the playhead and what is sounding', () => {
  const show = require('../core/show/show');
  const { applyOps } = require('../core/show/ops');
  const s = basic();
  const r = rig(s.doc);
  r.engine.go();
  const edited = applyOps(s.doc, [{ op: 'cue.set', id: '#2', props: { duration: 9 } }, { op: 'cue.add', cue: { type: 'memo', name: 'new' }, before: '#2' }]).doc;
  r.engine.load(show.toEngineDoc(edited));
  assert.equal(r.engine.playhead, s.id('f'));
  assert.ok(r.engine.running.has(s.id('a')));
});

test('auto-follow waits for a Fade cue to land; Load to Time reaches a top-level Audio cue', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'a.wav' } },
    { op: 'cue.add', ref: 'f', cue: { type: 'fade', number: '2', target: '@a', db: -20, duration: 3, continue: 'auto-follow' } },
    { op: 'cue.add', ref: 'b', cue: { type: 'audio', number: '3', file: 'b.wav' } },
  ]);
  const r = rig(s.doc);
  r.engine.loadToTime(12);
  r.engine.go();
  assert.equal(r.audio.calls[0][2].from, 12);
  r.engine.go();
  r.advance(2.9);
  assert.ok(!r.audio.playing.has(s.id('b')), 'not before the fade lands');
  r.advance(0.2);
  assert.ok(r.audio.playing.has(s.id('b')));
});

test('a cue started by a trigger or a Start cue runs its sequence, and the playhead stays', () => {
  const s = build([
    { op: 'cue.add', ref: 'm', cue: { type: 'memo', number: '1' } },
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '2', file: 'a.wav', continue: 'auto-continue', postWait: 2 } },
    { op: 'cue.add', ref: 'b', cue: { type: 'audio', number: '3', file: 'b.wav' } },
    { op: 'cue.add', ref: 's', cue: { type: 'start', number: '4', target: '@a' } },
  ]);
  const r = rig(s.doc);
  assert.equal(r.engine.playhead, s.id('m'));
  r.engine.start(s.id('a'));                       // as an OSC trigger or /cue/2/start does
  assert.ok(r.audio.playing.has(s.id('a')));
  r.advance(2.1);
  assert.ok(r.audio.playing.has(s.id('b')), 'its auto-continue ran');
  assert.equal(r.engine.playhead, s.id('m'), 'the playhead did not move');
  r.engine.panic(); r.engine.panic();
  r.engine.jumpTo('4'); r.engine.go();             // the Start cue
  r.advance(2.1);
  assert.ok(r.audio.playing.has(s.id('b')), 'a Start cue runs the sequence too');
});

test('a Stop cue ends what was to follow the cue it stops', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'a.wav', continue: 'auto-follow' } },
    { op: 'cue.add', ref: 'b', cue: { type: 'audio', number: '2', file: 'b.wav' } },
    { op: 'cue.add', ref: 'x', cue: { type: 'stop', number: '3', target: '@a' } },
  ]);
  const r = rig(s.doc);
  r.engine.go();
  r.engine.jumpTo('3'); r.engine.go();
  r.advance(1);
  assert.ok(!r.audio.playing.has(s.id('a')));
  assert.ok(!r.audio.playing.has(s.id('b')), 'stopped is not finished: 2 does not follow');
});

test('Load to Time counts through a pre-wait, into a group, and back from the end', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'a.wav', preWait: 4, from: 10 } },
    { op: 'cue.add', ref: 'g', cue: { type: 'group', number: '2' } },
    { op: 'cue.add', ref: 'c1', cue: { type: 'audio', file: 'b.wav' }, parent: '@g' },
    { op: 'cue.add', ref: 'c2', cue: { type: 'audio', file: 'c.wav', preWait: 20 }, parent: '@g' },
    { op: 'cue.add', ref: 'c3', cue: { type: 'audio', file: 'a.wav', preWait: 50 }, parent: '@g' },
  ]);
  const r = rig(s.doc);
  r.engine.setDuration('a.wav', 100); r.engine.setDuration('b.wav', 60); r.engine.setDuration('c.wav', 60);
  const from = (ref: string) => r.audio.calls.filter((c) => c[0] === 'play' && c[1] === s.id(ref)).at(-1)![2].from;
  r.engine.loadToTime(6);
  r.engine.go();
  assert.equal(from('a'), 12, '6 s in: past the 4 s pre-wait, 2 s into the sound, which starts at 10');
  r.engine.loadToTime(30);
  r.engine.go();
  assert.equal(from('c1'), 30);
  assert.equal(from('c2'), 10, 'a child that began at 20 is 10 s in');
  assert.ok(!r.audio.playing.has(s.id('c3')), 'a child at 50 still waits');
  r.advance(20.1);
  assert.equal(from('c3'), 0);
  r.engine.reset();
  r.engine.loadToTime(-10);                        // ten seconds before cue 1 ends: 4 + (100 − 10) = 94 long
  assert.equal(r.engine.loaded!.at, 84);
});

test('a vamp: the click goes round with its track, and a Devamp lets both go', () => {
  const s = build([
    { op: 'cue.add', ref: 'g', cue: { type: 'group', number: '10', name: 'Opening' } },
    { op: 'cue.add', ref: 't', parent: '@g', cue: { type: 'audio', file: 'track.wav', loops: [{ start: 16, end: 24, name: 'Vamp' }] } },
    { op: 'cue.add', ref: 'c', parent: '@g', cue: { type: 'audio', file: 'click.wav' } },
    { op: 'cue.add', ref: 'd', cue: { type: 'devamp', number: '11', target: '@t' } },
  ]);
  const r = rig(s.doc);
  r.engine.setDuration('track.wav', 48); r.engine.setDuration('click.wav', 48);
  r.engine.go();
  r.engine.setExact(s.id('t'), true); r.engine.setExact(s.id('c'), true);
  r.advance(5);
  assert.equal(r.engine.holdOrLetGo(s.id('t')), 'armed');
  const regions = r.audio.calls.filter((c) => c[0] === 'setRegion' && c[2] === 16 && c[3] === 24).map((c) => c[1]).sort();
  assert.deepEqual(regions, [s.id('c'), s.id('t')].sort());
  r.advance(15);                                    // 0:20: inside the section, going round
  assert.ok((r.engine.active().find((a) => a.id === s.id('t')) as SoundLine).holding);
  r.engine.go();                                    // the Devamp
  for (const id of [s.id('t'), s.id('c')]) assert.equal((r.engine.active().find((a) => a.id === id) as SoundLine).holding, false);
  assert.deepEqual(r.audio.calls.filter((c) => c[0] === 'setRegion').slice(-2).map((c) => [c[2], c[3]]), [[null, null], [null, null]]);
});

test('a Fade on a Group takes every sound in it out, and what was still waiting does not start', () => {
  const s = build([
    { op: 'cue.add', ref: 'g', cue: { type: 'group', number: '1', name: 'Preshow' } },
    { op: 'cue.add', ref: 'a', parent: '@g', cue: { type: 'audio', file: 'a.wav' } },
    { op: 'cue.add', ref: 'b', parent: '@g', cue: { type: 'audio', file: 'b.wav', preWait: 40 } },
    { op: 'cue.add', ref: 'f', cue: { type: 'fade', number: '2', target: '@g', duration: 6, stopTarget: true } },
  ]);
  const r = rig(s.doc);
  r.engine.setDuration('a.wav', 100); r.engine.setDuration('b.wav', 100);
  r.engine.go(); r.advance(10);
  r.engine.go();
  assert.deepEqual(r.audio.calls.at(-1), ['fade', s.id('a'), -60, 6, undefined]);
  r.advance(60);
  assert.equal(r.engine.running.size, 0);
  assert.equal(r.audio.calls.filter((c) => c[0] === 'play').length, 1);
});

test('a counted section goes round that many times by itself, the click with it, then plays on', () => {
  const s = build([
    { op: 'cue.add', ref: 'g', cue: { type: 'group', number: '10', name: 'Opening' } },
    { op: 'cue.add', ref: 't', parent: '@g', cue: { type: 'audio', file: 'track.wav', loops: [{ start: 16, end: 24, name: 'Vamp', count: 3 }] } },
    { op: 'cue.add', ref: 'c', parent: '@g', cue: { type: 'audio', file: 'click.wav' } },
  ]);
  const r = rig(s.doc);
  r.engine.setDuration('track.wav', 48); r.engine.setDuration('click.wav', 48);
  r.engine.go();
  r.engine.setExact(s.id('t'), true); r.engine.setExact(s.id('c'), true);
  const armed = r.audio.calls.filter((c) => c[0] === 'setRegion' && c[2] === 16 && c[3] === 24).map((c) => c[1]).sort();
  assert.deepEqual(armed, [s.id('c'), s.id('t')].sort());
  r.advance(35);                                    // 16 + 8 + 8 + 3: the third pass
  const a = r.engine.active().find((x) => x.id === s.id('t')) as SoundLine;
  assert.ok(a.holding);
  assert.deepEqual(a.count, { of: 3, pass: 3 });
  r.advance(2);                                     // let go in the last pass: it plays out and goes on
  for (const id of [s.id('t'), s.id('c')]) assert.equal((r.engine.active().find((x) => x.id === id) as SoundLine).holding, false);
  assert.ok(Math.abs(r.engine.positionOf(r.engine.running.get(s.id('t'))!) - 21) < 0.01);
  r.advance(5);                                     // 0:26 in the file: past the section, not round again
  assert.ok(Math.abs(r.engine.positionOf(r.engine.running.get(s.id('t'))!) - 26) < 0.01);
});

test('a play count plays a sound that many times', () => {
  const s = build([{ op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'ring.wav', plays: 3 } }]);
  const r = rig(s.doc);
  r.engine.setDuration('ring.wav', 2);
  r.engine.go();
  assert.equal(r.audio.calls.find((c) => c[0] === 'play')![2].exact, true);
  r.engine.setExact(s.id('a'), true);
  assert.deepEqual(r.audio.calls.filter((c) => c[0] === 'setRegion').map((c) => [c[2], c[3]]), [[0, 2]]);
  r.advance(4.5);
  assert.deepEqual((r.engine.active()[0] as SoundLine).count, { of: 3, pass: 3 });
  r.advance(1);                                     // in the third pass it is let go, to end at its end
  assert.deepEqual(r.audio.calls.filter((c) => c[0] === 'setRegion').at(-1)!.slice(2), [null, null]);
  assert.equal(r.engine.lengthOf(s.id('a')), 6);
});

test('a playlist group plays one child after another; repeat, shuffle, crossfade, and a stop ends it', () => {
  const make = (props: Partial<CueSpec>) => build([
    { op: 'cue.add', ref: 'g', cue: { type: 'group', number: '1', name: 'Walk-in', mode: 'playlist', ...props } },
    { op: 'cue.add', ref: 'a', parent: '@g', cue: { type: 'audio', file: 'a.wav' } },
    { op: 'cue.add', ref: 'b', parent: '@g', cue: { type: 'audio', file: 'b.wav' } },
    { op: 'cue.add', ref: 'c', parent: '@g', cue: { type: 'audio', file: 'c.wav' } },
  ]);
  const start = (props: Partial<CueSpec>, opts?: Partial<EngineOptions>) => { const s = make(props); const r = rig(s.doc, opts); for (const f of ['a', 'b', 'c']) r.engine.setDuration(`${f}.wav`, 10); r.engine.go(); return { s, r }; };
  const playing = (x: { s: Built; r: Rig }) => [...x.r.engine.running.keys()].map((id) => ['a', 'b', 'c'].find((k) => x.s.id(k) === id));

  let x = start({});
  assert.deepEqual(playing(x), ['a']);
  x.r.engine.audioEnded(x.s.id('a')); assert.deepEqual(playing(x), ['b']);
  x.r.engine.audioEnded(x.s.id('b')); x.r.engine.audioEnded(x.s.id('c'));
  assert.deepEqual(playing(x), []);
  assert.equal(x.r.engine.isLive(x.s.id('g')), false);

  x = start({ repeat: true });
  for (const k of ['a', 'b', 'c']) x.r.engine.audioEnded(x.s.id(k));
  assert.deepEqual(playing(x), ['a']);
  x.r.engine.stopCue(x.s.id('a'));                  // the operator's stop: the playlist ends, the next does not start
  assert.deepEqual(playing(x), []);

  x = start({ crossfade: 2 });
  x.r.advance(8.1);                                 // two seconds before a ends, b comes in under it
  assert.deepEqual(playing(x).sort(), ['a', 'b']);
  assert.ok(x.r.audio.calls.some((c) => c[0] === 'fade' && c[1] === x.s.id('a') && c[2] === -60));
  assert.ok(x.r.audio.calls.some((c) => c[0] === 'fade' && c[1] === x.s.id('b') && c[2] === 0 && c[3] === 2));
  x.r.advance(2); assert.deepEqual(playing(x), ['b']);
  x.r.engine.skipPlaylist(x.s.id('g')); assert.ok(playing(x).includes('c'));
  x.r.engine.panic(); x.r.engine.panic();
  assert.equal(x.r.engine.playlists.size, 0);

  x = start({ shuffle: true }, { random: () => 0 });        // (a fixed "random": the order it gives is b, c, a)
  assert.deepEqual(playing(x), ['b']);
});

test('a fade out with an End at lands on the End at, and the sound stops there', () => {
  const s = build([{ op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'a.wav', from: 12, cutAt: 40, fadeOut: 5 } }]);
  const r = rig(s.doc);
  r.engine.setDuration('a.wav', 200);
  r.engine.go();
  r.advance(22.9);                                  // 0:34.9 in the file: not yet
  assert.equal((r.engine.active()[0] as SoundLine).fadingTo, null);
  r.advance(0.2);
  assert.deepEqual(r.audio.calls.at(-1)!.slice(0, 3), ['fade', s.id('a'), -60]);
  assert.equal((r.engine.active().find((x) => x.kind === 'audio') as SoundLine).fadingTo, -60);
  r.advance(5);
  assert.equal(r.engine.running.size, 0);
});

test('a region set to hold goes round by itself until it is let go', () => {
  const s = build([
    { op: 'cue.add', ref: 't', cue: { type: 'audio', number: '1', file: 'track.wav', loops: [{ start: 16, end: 24, hold: true }] } },
    { op: 'cue.add', ref: 'd', cue: { type: 'devamp', number: '2', target: '@t' } },
  ]);
  const r = rig(s.doc);
  r.engine.setDuration('track.wav', 48);
  r.engine.go(); r.engine.setExact(s.id('t'), true);
  r.advance(60);                                    // long past where a count would have let go
  const a = r.engine.active()[0] as SoundLine;
  assert.ok(a.holding); assert.equal(a.count, null);
  r.engine.go();                                    // the Devamp
  assert.equal((r.engine.active()[0] as SoundLine).holding, false);
});

test('a group that starts its first child: each GO enters it, a child’s continue carries on, and the playhead waits', () => {
  const s = build([
    { op: 'cue.add', ref: 'g', cue: { type: 'group', number: '1', name: 'Phone call', mode: 'enter' } },
    { op: 'cue.add', ref: 'a', parent: '@g', cue: { type: 'audio', file: 'a.wav', continue: 'auto-continue', postWait: 2 } },
    { op: 'cue.add', ref: 'b', parent: '@g', cue: { type: 'audio', file: 'b.wav' } },
    { op: 'cue.add', ref: 'c', parent: '@g', cue: { type: 'audio', file: 'c.wav' } },
    { op: 'cue.add', ref: 'n', cue: { type: 'memo', number: '2' } },
  ]);
  const r = rig(s.doc);
  const playing = () => [...r.engine.running.keys()].map((id) => ['a', 'b', 'c'].find((k) => s.id(k) === id)).sort();
  r.engine.go();
  assert.deepEqual(playing(), ['a']);
  assert.equal(r.engine.playhead, s.id('g'));           // still on the group: there is more of it to come
  r.advance(2.1);
  assert.deepEqual(playing(), ['a', 'b']);              // a's auto-continue brought b
  r.engine.go();                                        // the next GO is c, the last: the playhead moves on
  assert.deepEqual(playing(), ['a', 'b', 'c']);
  assert.equal(r.engine.playhead, s.id('n'));

  const f = build([
    { op: 'cue.add', ref: 'g', cue: { type: 'group', number: '1', mode: 'first' } },
    { op: 'cue.add', ref: 'a', parent: '@g', cue: { type: 'audio', file: 'a.wav' } },
    { op: 'cue.add', ref: 'b', parent: '@g', cue: { type: 'audio', file: 'b.wav' } },
    { op: 'cue.add', ref: 'n', cue: { type: 'memo', number: '2' } },
  ]);
  const r2 = rig(f.doc);
  r2.engine.go();
  assert.deepEqual([...r2.engine.running.keys()], [f.id('a')]);
  assert.equal(r2.engine.playhead, f.id('n'));
});

test('fade and stop others on any cue: a sound takes out what was playing; a Fade cue spares the sound it moves', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'a.wav' } },
    { op: 'cue.add', ref: 'b', cue: { type: 'audio', number: '2', file: 'b.wav', fadeOthers: 3 } },
    { op: 'cue.add', ref: 'c', cue: { type: 'audio', number: '3', file: 'c.wav' } },
    { op: 'cue.add', ref: 'f', cue: { type: 'fade', number: '4', target: '@c', db: -10, duration: 2, fadeOthers: 1 } },
  ]);
  const r = rig(s.doc);
  for (const f of ['a', 'b', 'c']) r.engine.setDuration(`${f}.wav`, 100);
  r.engine.go(); r.engine.go();
  assert.ok(r.audio.calls.some((c) => c[0] === 'fade' && c[1] === s.id('a') && c[2] === -60 && c[3] === 3));
  r.advance(3.1);
  assert.deepEqual([...r.engine.running.keys()], [s.id('b')]);
  r.engine.go(); r.engine.go();                     // c starts; the Fade moves c and takes b out
  r.advance(2.5);
  assert.deepEqual([...r.engine.running.keys()], [s.id('c')]);
  assert.equal(r.engine.running.get(s.id('c'))!.db, -10);
});
