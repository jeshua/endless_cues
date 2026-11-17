/** The parts of the engine that had no tests: Jump and its blends, a GO quantised to the beat, holds, skips, End at,
 *  fade-out tails, voice-band fades, Mix cues, and the path from an OSC message to the cue it triggers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rig, build } from './helpers';
import type { Rig, Built, SoundLine } from './helpers';
import type { CueSpec, Op, Place } from '../core/show/ops';
import * as osc from '../core/net/osc';
import { oscTriggers, firedBy } from '../core/net/triggers';

const add = (cue: CueSpec, more: Place = {}): Op => ({ op: 'cue.add', ref: cue.ref, cue, ...more });
const last = (r: Rig, op: string) => r.audio.calls.filter((c) => c[0] === op).at(-1)!;
const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;
// a track at 120 bpm: a beat every half second, a bar every two, from 0
const TRACK = (extra: Partial<CueSpec> = {}): CueSpec => ({ type: 'audio', ref: 'track', number: '1', name: 'Track', file: 'media/track.wav', bus: 'music', gainDb: -6, tempo: { bpm: 120, first: 0, bar: 4 }, ...extra });
const jump = (ref: string, group: Partial<CueSpec>, music: Partial<CueSpec>): CueSpec => ({ type: 'group', ref, ...group, children: [{ type: 'music', ref: `${ref}m`, target: '@track', ...music }] });
const pos = (r: Rig, s: Built) => r.engine.positionOf(r.engine.running.get(s.id('track'))!);

test('a Jump with no quantise cuts now: the track moves inside itself, its level untouched', () => {
  const s = build([add(TRACK()), add(jump('j', { number: '2', blend: 'cut' }, { to: 40 }))]);
  const r = rig(s.doc);
  r.engine.setDuration('media/track.wav', 120);
  r.engine.go();
  r.advance(10.3);
  r.engine.go();
  const m = last(r, 'move');
  assert.equal(m[1], s.id('track'));
  assert.equal(m[2].sync.blend, 'cut');
  assert.ok(near(m[2].sync.xf, 0.03) && near(m[2].to, 40, 0.02), JSON.stringify(m[2]));
  assert.ok(!r.audio.calls.some((c) => c[0] === 'stop' || (c[0] === 'play' && r.audio.calls.indexOf(c) > 0)), 'it is one sound moved, not stopped and started');
  r.advance(1);
  assert.ok(near(pos(r, s), 41, 0.1), `about a second past where it landed: ${pos(r, s)}`);
  assert.equal(r.audio.playing.get(s.id('track'))!.db, -6);
});

test('a Jump on the bar waits for the next downbeat and crossfades across it; on the beat, the next beat', () => {
  const s = build([
    add(TRACK()),
    add(jump('bar', { number: '2', blend: 'fade', onBeat: 'bar' }, { to: 60 })),
    add(jump('beat', { number: '3', blend: 'cut', onBeat: 'beat' }, { to: 20 })),
    add(jump('dj', { number: '4', blend: 'dj', onBeat: 'bar' }, { to: 80 })),
    add(jump('long', { number: '5', blend: 'fade', blendSecs: 3 }, { to: 10 })),
  ]);
  const r = rig(s.doc);
  r.engine.setDuration('media/track.wav', 120);
  r.engine.go();
  r.advance(4.6);                                            // the next bar line is at 6.0
  r.engine.go();
  assert.ok(r.engine.waits.has(s.id('bar')), 'it waits, and the wait shows in Active cues');
  assert.equal(r.audio.calls.filter((c) => c[0] === 'move').length, 0);
  r.advance(1.2);                                            // handed to the audio backend a quarter of a second ahead
  let m = last(r, 'move')[2];
  assert.equal(m.sync.blend, 'fade');
  assert.ok(near(m.sync.xf, 0.5), 'a fade is a beat long');
  assert.ok(near(m.sync.at + m.sync.xf / 2, 6), `the middle of the crossfade is on the bar line: ${JSON.stringify(m.sync)}`);
  assert.ok(near(m.to + m.sync.xf / 2, 60), 'and lands on the place asked for');
  r.advance(2);
  r.engine.go();                                             // on the beat: within half a second
  r.advance(0.6);
  m = last(r, 'move')[2];
  assert.ok(near((m.sync.at + m.sync.xf / 2) % 0.5, 0, 0.011) || near((m.sync.at + m.sync.xf / 2) % 0.5, 0.5, 0.011), `on a beat: ${m.sync.at}`);
  assert.ok(near(m.to + m.sync.xf / 2, 20));
  r.advance(3);
  r.engine.go();                                             // dj: a bar long
  r.advance(4.1);
  m = last(r, 'move')[2];
  assert.equal(m.sync.blend, 'dj');
  assert.ok(near(m.sync.xf, 2), 'a dj blend is a bar long');
  r.advance(3);
  r.engine.go();                                             // a blend length of its own, now
  r.advance(0.01);
  m = last(r, 'move')[2];
  assert.ok(near(m.sync.xf, 3) && m.sync.blend === 'fade' && near(m.to + 1.5, 10), JSON.stringify(m));
});

test('a Jump starts a track that is not playing, loops where it lands, moves only a level, or stops it', () => {
  const s = build([
    add(TRACK()),
    add(jump('start', { number: '2', blend: 'cut' }, { to: 30, fadeIn: 2, loop: true, end: 38 })),
    add(jump('level', { number: '3', blend: 'fade', blendSecs: 1.5 }, { stay: true, level: -10 })),
    add(jump('out', { number: '4', blend: 'cut' }, { to: 38 })),
    add(jump('stop', { number: '5', blend: 'cut' }, { stop: true })),
  ]);
  const r = rig(s.doc);
  r.engine.setDuration('media/track.wav', 120);
  r.engine.setPlayhead(s.id('start'));
  r.engine.go();
  const p = last(r, 'play');
  assert.equal(p[2].from, 30);
  assert.equal(p[2].exact, false, 'nothing about the Audio cue itself says it loops');
  assert.deepEqual(last(r, 'fade').slice(1, 4), [s.id('track'), -6, 2], 'in from silence over its fade in');
  r.engine.setExact(s.id('track'), true);                    // decoded: now it can loop to the sample
  assert.deepEqual(last(r, 'setRegion'), ['setRegion', s.id('track'), 30, 38]);
  r.advance(19);                                             // twice round and three seconds
  assert.ok(near(pos(r, s), 33, 0.05));
  r.engine.go();                                             // level only: stays where it is, looping as it was
  assert.deepEqual(last(r, 'fade').slice(1, 4), [s.id('track'), -16, 1.5], 'dB on the track’s own level');
  assert.equal(r.audio.calls.filter((c) => c[0] === 'move').length, 0);
  r.engine.go();                                             // to the end of the loop it is in: it lets go and plays on
  assert.deepEqual(last(r, 'setRegion'), ['setRegion', s.id('track'), null, null]);
  r.advance(8);
  assert.ok(pos(r, s) > 38, 'past the loop');
  r.engine.go();
  r.advance(0.1);
  assert.ok(!r.audio.playing.has(s.id('track')), 'stopped (a 30 ms fade)');
});

test('a Jump that holds arms a loop the track plays into; a second jump before the first lands replaces it', () => {
  const s = build([
    add(TRACK()),
    add(jump('hold', { number: '2', blend: 'cut' }, { to: 16, loop: true, end: 24, hold: true })),
    add(jump('a', { number: '3', blend: 'fade', onBeat: 'bar' }, { to: 60 })),
    add(jump('b', { number: '4', blend: 'fade', onBeat: 'bar' }, { to: 90 })),
  ]);
  const r = rig(s.doc);
  r.engine.setDuration('media/track.wav', 120);
  r.engine.go();
  r.engine.setExact(s.id('track'), true);
  r.advance(5);
  r.engine.go();
  assert.equal(r.audio.calls.filter((c) => c[0] === 'move').length, 0, 'a hold moves nothing');
  assert.deepEqual((r.engine.active().find((a) => a.id === s.id('track')) as SoundLine).armed, [{ start: 16, end: 24 }]);
  assert.deepEqual(last(r, 'setRegion'), ['setRegion', s.id('track'), 16, 24]);
  r.advance(30);                                             // 5 + 30 = 35 s played: 16–24 gone round
  assert.ok(pos(r, s) >= 16 && pos(r, s) < 24, `going round the section: ${pos(r, s)}`);
  r.engine.go();                                             // a
  r.advance(0.1);
  r.engine.go();                                             // b, before a has gone: the last word wins
  assert.ok(!r.engine.waits.has(s.id('a')) && r.engine.waits.has(s.id('b')));
  r.advance(4);
  const moves = r.audio.calls.filter((c) => c[0] === 'move');
  assert.equal(moves.length, 1);
  assert.ok(near(moves[0][2].to + moves[0][2].sync.xf / 2, 90));
});

test('a group quantised to the bar fires on the next downbeat; with nothing on a beat playing, now', () => {
  const s = build([
    add(TRACK()),
    add({ type: 'group', ref: 'hit', number: '2', onBeat: 'bar', continue: 'auto-continue', postWait: 1, children: [{ type: 'audio', ref: 'stab', file: 'media/stab.wav' }] }),
    add({ type: 'audio', ref: 'tail', number: '3', file: 'media/tail.wav' }),
    add({ type: 'group', ref: 'tick', number: '4', onBeat: 'beat', children: [{ type: 'audio', ref: 'click', file: 'media/click.wav' }] }),
  ]);
  const r = rig(s.doc);
  r.engine.setPlayhead(s.id('hit'));
  r.engine.go();
  assert.ok(r.audio.playing.has(s.id('stab')), 'no music: at once');
  r.engine.reset();
  r.engine.go();                                             // the track (its length not measured yet: its beats still count)
  r.advance(2.7);                                            // the next bar line is at 4.0
  r.engine.go();
  assert.ok(!r.audio.playing.has(s.id('stab')));
  const w = r.engine.active().find((a) => a.id === s.id('hit'));
  assert.ok(w && near(w.total, 1.3), 'the wait to the bar line is counted down');
  r.advance(1.25);
  assert.ok(!r.audio.playing.has(s.id('stab')));
  r.advance(0.1);
  assert.ok(r.audio.playing.has(s.id('stab')), 'on the downbeat');
  assert.ok(!r.audio.playing.has(s.id('tail')));
  r.advance(1);
  assert.ok(r.audio.playing.has(s.id('tail')), 'what continues from it comes its post-wait after it lands, not after the GO');
  r.advance(0.2);                                            // 5.25: the next beat is 5.5
  r.engine.go();
  r.advance(0.2);
  assert.ok(!r.audio.playing.has(s.id('click')));
  r.advance(0.1);
  assert.ok(r.audio.playing.has(s.id('click')), 'on the next beat');
  r.advance(0.4);                                            // 5.95: too near the beat at 6.0 to land on (inside 80 ms): the one after
  r.engine.fire(s.id('tick'));
  assert.ok(near(r.engine.waits.get(s.id('tick'))!.total, 0.55));
});

test('Hold (H) loops the section the track is in until it is let go; a GO lets go', () => {
  const s = build([add(TRACK({ loops: [{ start: 8, end: 16, name: 'verse' }, { start: 32, end: 40 }] })), add({ type: 'memo', number: '2' })]);
  const r = rig(s.doc);
  r.engine.setDuration('media/track.wav', 120);
  r.engine.go();
  assert.equal(last(r, 'play')[2].exact, true, 'a sound with loop regions is played from a buffer');
  r.engine.setExact(s.id('track'), true);
  r.advance(3);
  r.engine.setHold(true);                                    // before the first section: the next one is armed
  assert.deepEqual(last(r, 'setRegion'), ['setRegion', s.id('track'), 8, 16]);
  assert.ok(!(r.engine.active()[0] as SoundLine).holding, 'not in it yet');
  r.advance(20);                                             // 23 s played: 8 + (23 - 8) % 8 = 15
  assert.ok(near(pos(r, s), 15, 0.01));
  assert.ok((r.engine.active()[0] as SoundLine).holding && r.engine.snapshot().held);
  r.engine.go();                                             // the operator moves on
  assert.ok(!r.engine.held);
  assert.deepEqual(last(r, 'setRegion'), ['setRegion', s.id('track'), null, null]);
  r.advance(3);
  assert.ok(near(pos(r, s), 18, 0.01), 'it plays on from where it was');
  assert.equal(r.engine.toggleHold(s.id('track'), { start: 8, end: 16 }), null, 'a section behind the track is not armed');
  assert.equal(r.engine.toggleHold(s.id('track'), { start: 20, end: 22 }), null, 'nor a stretch that is not one of its sections');
  assert.equal(r.engine.toggleHold(s.id('track'), { start: 32, end: 40 }), 'armed');
  assert.equal(r.engine.toggleHold(s.id('track'), { start: 32, end: 40 }), 'disarmed');
  assert.equal(r.engine.toggleHold(s.id('track'), { start: 32, end: 40 }), 'armed');
  r.advance(20);                                             // 38 s straight on: inside 32–40
  assert.equal(r.engine.toggleHold(s.id('track'), { start: 32, end: 40 }), 'let go');
  r.advance(4);
  assert.ok(pos(r, s) > 40);
});

test('a skip moves the sound and what is timed to it; out of a held section it lets go; paused it stays paused', () => {
  const s = build([add({ type: 'group', ref: 'scene', number: '1', children: [
    TRACK({ number: '', loops: [{ start: 8, end: 16 }] }),
    { type: 'memo', ref: 'early', name: 'verse', preWait: 10 }, { type: 'memo', ref: 'late', name: 'chorus', preWait: 50 },
  ] })]);
  const r = rig(s.doc);
  r.engine.setDuration('media/track.wav', 120);
  r.engine.go();
  r.engine.setExact(s.id('track'), true);
  r.advance(2);
  r.engine.seek(s.id('track'), 30);
  assert.deepEqual(last(r, 'seek'), ['seek', s.id('track'), 30]);
  assert.ok(!r.engine.waits.has(s.id('early')), 'a marker now behind is dropped');
  const w = r.engine.active().find((a) => a.id === s.id('late'))!;
  assert.ok(near(w.total - w.elapsed, 20), 'one ahead counts from the new place');
  r.engine.seek(s.id('track'), 500);
  assert.ok(near(pos(r, s), 119.95), 'never past the end of the file');
  r.engine.seek(s.id('track'), 9);
  r.engine.setHold(true);
  assert.ok((r.engine.active().find((a) => a.kind === 'audio') as SoundLine).holding);
  r.engine.seek(s.id('track'), 60);
  assert.deepEqual(last(r, 'setRegion'), ['setRegion', s.id('track'), null, null], 'skipped out of the section it was held in');
  r.engine.pause();
  r.engine.seek(s.id('track'), 70);
  r.advance(5);
  assert.ok(near(pos(r, s), 70) && r.engine.isPaused(s.id('scene')));
  r.engine.resume();
  r.advance(1);
  assert.ok(near(pos(r, s), 71));
});

test('End at: the sound stops there by itself, told to the audio backend ahead; a skip past it plays on', () => {
  const s = build([add({ type: 'audio', ref: 'a', number: '1', file: 'media/a.wav', from: 2, cutAt: 10, continue: 'auto-follow' }), add({ type: 'audio', ref: 'b', number: '2', file: 'media/b.wav' })]);
  const r = rig(s.doc);
  r.engine.setDuration('media/a.wav', 60);
  r.engine.go();
  assert.equal(r.engine.lengthOf(s.id('a')), 8);
  assert.equal((r.engine.active()[0] as SoundLine).end, 10, 'the countdown is to the End at');
  r.advance(7.6);
  assert.equal(last(r, 'cut'), undefined);
  r.advance(0.2);                                            // 0.3 s ahead of the end
  assert.deepEqual(last(r, 'cut'), ['cut', s.id('a'), 10]);
  r.advance(0.3);
  assert.ok(!r.audio.playing.has(s.id('a')), 'gone at its End at');
  assert.ok(r.audio.playing.has(s.id('b')), 'and what follows it does');
  r.engine.start(s.id('a'));
  r.engine.seek(s.id('a'), 20);                              // a rehearsal pick-up past the end: it plays on
  r.advance(15);
  assert.ok(r.audio.playing.has(s.id('a')));
  r.engine.pause(s.id('a')); r.engine.seek(s.id('a'), 9); r.advance(5);
  assert.ok(r.audio.playing.has(s.id('a')), 'paused, the End at waits');
  r.engine.resume(s.id('a')); r.advance(1.1);
  assert.ok(!r.audio.playing.has(s.id('a')));
});

test('fade-out tails: onto the last sample, from a set time, on a loop, and again after a pause or a skip', () => {
  const s = build([
    add({ type: 'audio', ref: 'end', number: '1', file: 'media/a.wav', gainDb: -3, fadeOut: 4 }),
    add({ type: 'audio', ref: 'early', number: '2', file: 'media/a.wav', fadeOut: 2, fadeAt: 5 }),
    add({ type: 'audio', ref: 'siren', number: '3', file: 'media/a.wav', loop: true, fadeOut: 3, fadeAt: 30 }),
    add({ type: 'audio', ref: 'drone', number: '4', file: 'media/a.wav', loop: true, fadeOut: 3 }),
  ]);
  const r = rig(s.doc);
  r.engine.go();
  r.engine.setDuration('media/a.wav', 20);                   // measured after it started: the tail is still planned
  r.advance(15.9);
  assert.ok(!r.audio.calls.some((c) => c[0] === 'fade'));
  r.advance(0.2);
  assert.deepEqual(last(r, 'fade'), ['fade', s.id('end'), -60, 4, undefined], 'over its last four seconds');
  assert.equal((r.engine.active()[0] as SoundLine).fadingTo, -60);
  r.engine.seek(s.id('end'), 5);                             // skipped back out of the tail: its level again, and a new tail
  assert.deepEqual(last(r, 'fade').slice(1, 3), [s.id('end'), -3]);
  r.engine.pause(s.id('end'));
  r.advance(30);
  r.engine.resume(s.id('end'));
  r.advance(10.9);
  assert.equal((r.engine.active()[0] as SoundLine).fadingTo, null);
  r.advance(0.2);
  assert.equal((r.engine.active()[0] as SoundLine).fadingTo, -60, 'the tail was planned again from where it resumed');
  r.audio.playing.delete(s.id('end')); r.engine.audioEnded(s.id('end'));
  r.engine.go();                                             // fade out from 5 s: it stops when the fade lands
  r.advance(5.1);
  assert.deepEqual(last(r, 'fade'), ['fade', s.id('early'), -60, 2, undefined]);
  r.advance(2);
  assert.ok(!r.audio.playing.has(s.id('early')), 'an early fade stops the sound when it lands');
  r.engine.go(); r.engine.go();                              // two loops: one heard for 30 s, one with no time set
  r.advance(29.9);
  assert.ok(!r.audio.calls.some((c) => c[0] === 'fade' && c[1] === s.id('siren')));
  r.advance(3.2);
  assert.ok(!r.audio.playing.has(s.id('siren')), 'a loop fades after its time played, and stops');
  assert.ok(r.audio.playing.has(s.id('drone')) && !r.audio.calls.some((c) => c[0] === 'fade' && c[1] === s.id('drone')), 'a loop with no time never reaches an end to fade into');
});

test('a Fade in the voice range dips the speech band and leaves the level alone', () => {
  const s = build([
    add({ type: 'audio', ref: 'music', number: '1', file: 'media/m.wav', gainDb: -4 }),
    add({ type: 'fade', ref: 'carve', number: '2', target: '@music', db: -9, duration: 1, relative: true, range: 'voice' }),
    add({ type: 'fade', ref: 'back', number: '3', target: '@music', db: 0, duration: 2, relative: true, range: 'voice', continue: 'auto-follow' }),
    add({ type: 'fade', ref: 'abs', number: '4', target: '@music', db: -10, duration: 1, range: 'voice' }),
    add({ type: 'fade', ref: 'out', number: '5', target: '@music', db: -60, duration: 1, range: 'voice', stopTarget: true }),
  ]);
  const r = rig(s.doc);
  r.engine.go(); r.engine.go();
  assert.deepEqual(last(r, 'fade'), ['fade', s.id('music'), -9, 1, 'voice']);
  assert.equal(r.audio.playing.get(s.id('music'))!.db, -4, 'the sound’s level is where it was');
  assert.equal((r.engine.active().find((a) => a.kind === 'audio') as SoundLine).fadingTo, null);
  assert.ok(r.engine.active().some((a) => a.kind === 'fade' && a.id === s.id('carve')), 'it is a fade like any other in Active cues');
  r.advance(1.1);
  r.engine.go();
  assert.deepEqual(last(r, 'fade'), ['fade', s.id('music'), 0, 2, 'voice'], 'flat again');
  r.advance(1.9);
  assert.equal(r.audio.calls.filter((c) => c[0] === 'fade').length, 2, 'what follows it waits for it to land');
  r.advance(0.2);
  assert.deepEqual(last(r, 'fade'), ['fade', s.id('music'), -6, 1, 'voice'], 'an absolute level in the band: the dip from where the sound is (-4) to it (-10)');
  r.engine.go();
  assert.deepEqual(last(r, 'fade'), ['fade', s.id('music'), -60, 1, undefined], 'one that stops its target is a whole fade');
});

test('a Mix cue hands the mixer its levels and time; a cue that throws is logged, not thrown', () => {
  const s = build([add({ type: 'mix', ref: 'm', number: '1', levels: { music: -9, vocals: 2, nope: 'x' }, duration: 4 }), add({ type: 'mix', ref: 'd', number: '2', levels: { effects: -60 } })]);
  const r = rig(s.doc);
  r.engine.go(); r.engine.go();
  assert.deepEqual(r.mixes.map((c) => [c.levels, c.duration]), [[{ music: -9, vocals: 2 }, 4], [{ effects: -60 }, 2]], 'what is not a number is left out; a duration left alone is the default');
  const bad = rig(s.doc, { mix: () => { throw new Error('no desk'); } });
  bad.engine.go();
  assert.ok(bad.logs.some((l) => /mix cue .*no desk/.test(l)));
  assert.equal(bad.engine.playhead, s.id('d'));
});

test('an OSC message fires the cue it is the trigger of: patterns, arguments, the sequence, the playhead', () => {
  const s = build([
    add({ type: 'audio', ref: 'a', number: '1', file: 'media/a.wav' }),
    add({ type: 'audio', ref: 'thunder', number: '2', file: 'media/t.wav', oscTrigger: '/sm/thunder', continue: 'auto-continue' }),
    add({ type: 'audio', ref: 'rumble', number: '3', file: 'media/r.wav' }),
    add({ type: 'group', ref: 'door', number: '4', oscTrigger: '/sensor/door 1', children: [{ type: 'audio', ref: 'creak', file: 'media/c.wav', oscTrigger: '/sm/*' }] }),
    add({ type: 'memo', ref: 'not', number: '5', oscTrigger: 'sm/thunder' }),
  ]);
  const triggers = oscTriggers(s.doc);
  assert.deepEqual(triggers.map((t) => [t.address, t.args]), [['/sm/thunder', ''], ['/sensor/door', '1'], ['/sm/*', '']], 'what does not start with / is no trigger');
  const arrive = (address: string, args: unknown[] = []) => firedBy(triggers, osc.decode(osc.encode(address, args))!);
  assert.deepEqual(arrive('/sm/thunder'), [s.id('thunder'), s.id('creak')]);
  assert.deepEqual(arrive('/sm/thunder', [3, 'loud']), [s.id('thunder'), s.id('creak')], 'a trigger that names no arguments takes any');
  assert.deepEqual(arrive('/sensor/door', [1]), [s.id('door')]);
  assert.deepEqual(arrive('/sensor/door', [0]), [], 'the arguments must be the ones it names');
  assert.deepEqual(arrive('/sm/thunder/2'), []);
  const r = rig(s.doc);
  for (const id of arrive('/sm/thunder')) r.engine.start(id);
  assert.ok(r.audio.playing.has(s.id('thunder')) && r.audio.playing.has(s.id('rumble')) && r.audio.playing.has(s.id('creak')), 'the cue, what continues from it, and a cue inside a group');
  assert.equal(r.engine.playhead, s.id('a'), 'the playhead stays where the operator has it');
});

test('a track brought back by a Jump keeps the loop regions it goes round by itself', () => {
  const s = build([
    add(TRACK({ loops: [{ start: 40, end: 48, hold: true }] })),
    add(jump('stop', { number: '2', blend: 'cut' }, { stop: true })),
    add(jump('again', { number: '3', blend: 'cut' }, { to: 30 })),
  ]);
  const r = rig(s.doc);
  r.engine.setDuration('media/track.wav', 120);
  r.engine.go();
  r.engine.setExact(s.id('track'), true);
  r.advance(5);
  r.engine.go();
  r.advance(0.1);
  assert.ok(!r.audio.playing.has(s.id('track')));
  r.engine.go();                                             // started again at 30 s, short of its section
  r.engine.setExact(s.id('track'), true);
  assert.deepEqual((r.engine.active().find((a) => a.kind === 'audio') as SoundLine).armed, [{ start: 40, end: 48 }]);
  r.advance(30);                                             // 60 s straight on: without the hold it would be past 48
  assert.ok(pos(r, s) >= 40 && pos(r, s) < 48, `going round its section: ${pos(r, s)}`);
});
