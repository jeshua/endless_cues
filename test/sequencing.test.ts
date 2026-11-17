/** How cues run one after another: lists with their own playheads, second triggers, ducks, Reset, Target and Load
 *  cues, a Devamp that starts the next cue. (core/engine/sequencing.js and the parts of cue-engine.js it hangs on.) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rig, build } from './helpers';
import * as show from '../core/show/show';
import type { Rig } from './helpers';
import type { CueEngine, EngineAudio } from '../core/engine/cue-engine';
import type { CueSpec, Op, Place } from '../core/show/ops';

/** A line of Active Cues that is a sound (it has a duck). */
type SoundRow = Extract<ReturnType<CueEngine['active']>[number], { duck: unknown }>;

const A = (ref: string, extra: Partial<CueSpec> = {}): CueSpec => ({ type: 'audio', ref, name: ref, file: `media/${ref}.wav`, ...extra });
const add = (cue: CueSpec, more: Place = {}): Op => ({ op: 'cue.add', ref: cue.ref, cue, ...more });
const last = (r: Rig, op: string) => r.audio.calls.filter((c) => c[0] === op).at(-1)!;

const twoLists = () => build([
  { op: 'list.add', name: 'Preshow' },
  add(A('a1', { number: '1' })), add(A('a2', { number: '2' })), add(A('a3', { number: '3' })),
  add(A('p1', { number: 'P1', continue: 'auto-follow' }), { list: 'Preshow' }), add(A('p2', { number: 'P2' }), { list: 'Preshow' }), add(A('p3', { number: 'P3' }), { list: 'Preshow' }),
  add({ type: 'start', ref: 'goPre', number: '9', target: 'list:Preshow' }),
  add({ type: 'fade', ref: 'fadePre', number: '10', target: 'list:Preshow', db: -60, duration: 2, stopTarget: true }),
  add({ type: 'stop', ref: 'stopPre', number: '11', target: 'list:Preshow' }),
]);

test('each list keeps its own playhead, and a list that is not on screen runs on', () => {
  const s = twoLists();
  const r = rig(s.doc);
  r.engine.setDuration('media/p1.wav', 5);
  r.engine.go();
  assert.equal(r.engine.playhead, s.id('a2'));
  r.engine.selectList('Preshow');
  assert.equal(r.engine.playhead, s.id('p1'), 'the other list starts at its top');
  r.engine.go();                                             // p1, which p2 follows
  assert.equal(r.engine.playhead, s.id('p3'));
  r.engine.selectList('Main');
  assert.equal(r.engine.playhead, s.id('a2'), 'back where this list was left');
  r.audio.playing.delete(s.id('p1')); r.engine.audioEnded(s.id('p1'));
  assert.ok(r.audio.playing.has(s.id('p2')), 'the auto-follow in the list that is not showing still ran');
  const snap = r.engine.snapshot();
  assert.deepEqual(snap.lists.map((l) => [l.name, l.playhead, l.live]), [['Main', s.id('a2'), 1], ['Preshow', s.id('p3'), 1]]);
  r.engine.reset();
  assert.deepEqual(r.engine.snapshot().lists.map((l) => l.playhead), [s.id('a1'), s.id('p1')], 'Reset: every list back at its top');
});

test('a Start cue aimed at a list is that list’s GO; a Fade and a Stop aimed at a list take what it started', () => {
  const s = twoLists();
  const r = rig(s.doc);
  r.engine.go();                                             // a1
  r.engine.setPlayhead(s.id('goPre'));
  r.engine.go();
  assert.ok(r.audio.playing.has(s.id('p1')), 'the Preshow list’s first cue went');
  assert.equal(r.engine.heads.get('Preshow'), s.id('p3'), 'and its playhead moved on, past what follows');
  assert.equal(r.engine.listName, 'Main');
  assert.equal(r.engine.lastGo!.id, s.id('goPre'), 'the operator’s GO was the Start cue');
  r.engine.go();                                             // fadePre
  assert.deepEqual(last(r, 'fade'), ['fade', s.id('p1'), -60, 2, undefined]);
  assert.ok(!r.audio.calls.some((c) => c[0] === 'fade' && c[1] === s.id('a1')), 'the Main list’s sound is not touched');
  r.advance(2.1);
  assert.ok(!r.audio.playing.has(s.id('p1')) && r.audio.playing.has(s.id('a1')));
  assert.ok(!r.audio.playing.has(s.id('p2')), 'what was to follow in the list does not');
  r.engine.setPlayhead(s.id('goPre')); r.engine.go();        // the list's next GO: p3
  assert.ok(r.audio.playing.has(s.id('p3')));
  r.engine.setPlayhead(s.id('stopPre')); r.engine.go();
  assert.ok(!r.audio.playing.has(s.id('p3')) && r.audio.playing.has(s.id('a1')));
  assert.deepEqual(show.problems(s.doc), [], 'a list is a target these cues can have');
});

test('the playhead can be put on no cue, and on a cue of a list that is not showing', () => {
  const s = twoLists();
  const r = rig(s.doc);
  r.engine.setPlayhead(null);
  assert.equal(r.engine.playhead, null);
  assert.equal(r.engine.go(), null, 'GO does nothing with no cue standing by');
  r.engine.load(show.toEngineDoc(s.doc));
  assert.equal(r.engine.playhead, null, 'a reload leaves it off');
  r.engine.setPlayhead(s.id('p2'));
  assert.equal(r.engine.heads.get('Preshow'), s.id('p2'));
  assert.equal(r.engine.listName, 'Main');
  r.engine.setPlayhead(s.id('a3'));
  assert.equal(r.engine.playhead, s.id('a3'));
});

test('= and -: the playhead to the next and the previous cue that needs a GO', () => {
  const s = build([
    add(A('a', { continue: 'auto-continue' })), add(A('b', { continue: 'auto-follow' })), add(A('c')),
    add(A('d')), add(A('e', { continue: 'auto-continue' })), add(A('f')),
  ]);
  const r = rig(s.doc);
  assert.ok(r.engine.moveSequence(1)); assert.equal(r.engine.playhead, s.id('d'));
  assert.ok(r.engine.moveSequence(1)); assert.equal(r.engine.playhead, s.id('e'));
  assert.ok(!r.engine.moveSequence(1), 'no sequence after the last');
  r.engine.setPlayhead(s.id('f'));                          // in the middle of a sequence: back to its start
  assert.ok(r.engine.moveSequence(-1)); assert.equal(r.engine.playhead, s.id('e'));
  r.engine.moveSequence(-1); r.engine.moveSequence(-1);
  assert.equal(r.engine.playhead, s.id('a'));
  assert.ok(!r.engine.moveSequence(-1));
});

test('start one at random deals every child once before any comes again', () => {
  const s = build([add({ type: 'group', ref: 'g', mode: 'random', children: [A('x'), A('y'), A('z'), A('w')] })]);
  let seed = 7;
  const r = rig(s.doc, { random: () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; } });
  const picks = [];
  for (let i = 0; i < 12; i++) { r.engine.fire(s.id('g')); picks.push(r.audio.calls.filter((c) => c[0] === 'play').at(-1)![1]); }
  for (let round = 0; round < 3; round++) assert.equal(new Set(picks.slice(round * 4, round * 4 + 4)).size, 4, `round ${round + 1} plays all four`);
  assert.notEqual(picks[3], picks[4], 'a round does not open with the one the last closed on');
  assert.notEqual(picks[7], picks[8]);
  r.engine.toggleArm(s.id('x'));
  const armed = [];
  for (let i = 0; i < 6; i++) { r.engine.fire(s.id('g')); armed.push(r.audio.calls.filter((c) => c[0] === 'play').at(-1)![1]); }
  assert.ok(!armed.includes(s.id('x')), 'a disarmed child is never dealt');
});

test('a second trigger: nothing, stop, fade out, devamp; and restart by default', () => {
  const s = build([
    add(A('plain', { number: '1' })),
    add(A('once', { number: '2', secondTrigger: 'nothing', continue: 'auto-continue' })),
    add(A('after', { number: '3' })),
    add(A('toggle', { number: '4', secondTrigger: 'stop' })),
    add(A('soft', { number: '5', secondTrigger: 'panic' })),
    add(A('vamp', { number: '6', loop: true, secondTrigger: 'devamp' })),
  ]);
  const r = rig(s.doc, { panicFade: 2 });
  const plays = (ref: string) => r.audio.calls.filter((c) => c[0] === 'play' && c[1] === s.id(ref)).length;
  r.engine.start(s.id('plain')); r.engine.start(s.id('plain'));
  assert.equal(plays('plain'), 2, 'left alone, a second trigger starts it again');
  r.engine.start(s.id('once')); r.engine.start(s.id('once'));
  assert.equal(plays('once'), 1);
  assert.equal(plays('after'), 1, 'and its sequence is not run a second time');
  r.engine.setPlayhead(s.id('once')); r.engine.go();
  assert.equal(plays('once'), 1, 'a GO on a running cue is a second trigger too');
  r.engine.start(s.id('toggle')); r.engine.start(s.id('toggle'));
  assert.ok(!r.audio.playing.has(s.id('toggle')), 'stop: gone at once');
  r.engine.start(s.id('toggle'));
  assert.ok(r.audio.playing.has(s.id('toggle')), 'and the next trigger starts it again');
  r.engine.start(s.id('soft')); r.engine.start(s.id('soft'));
  assert.deepEqual(last(r, 'fade'), ['fade', s.id('soft'), -60, 2, undefined]);
  r.advance(2.1);
  assert.ok(!r.audio.playing.has(s.id('soft')));
  r.engine.start(s.id('vamp')); r.engine.start(s.id('vamp'));
  assert.deepEqual(last(r, 'setLoop'), ['setLoop', s.id('vamp'), false]);
  assert.equal(plays('vamp'), 1);
});

test('second trigger on release: a sound that plays while its key is held', () => {
  const s = build([add(A('held', { secondTrigger: 'stop', secondOnRelease: true })), add(A('tap', { secondTrigger: 'stop' }))]);
  const r = rig(s.doc);
  r.engine.start(s.id('held'));
  assert.ok(r.engine.released(s.id('held')));
  assert.ok(!r.audio.playing.has(s.id('held')));
  assert.ok(!r.engine.released(s.id('held')), 'nothing to do once it has stopped');
  r.engine.start(s.id('tap'));
  assert.ok(!r.engine.released(s.id('tap')), 'a cue that does not ask for it ignores the release');
  assert.ok(r.audio.playing.has(s.id('tap')));
});

test('a cue ducks the others while it runs, and they come back when it ends', () => {
  const s = build([
    add(A('music', { number: '1', gainDb: -6 })),
    add({ type: 'group', ref: 'line', number: '2', duckOthers: -12, duckTime: 0.5, children: [A('voice'), { type: 'memo', ref: 'tail', preWait: 3 }] }),
    add(A('late', { number: '3' })),
    add(A('boost', { number: '4', duckOthers: 3 })),
  ]);
  const r = rig(s.doc);
  const ducks: [string, number, number][] = []; (r.audio as EngineAudio).duck = (key, db, secs) => ducks.push([key, db, secs]);
  r.engine.go();
  r.engine.go();
  assert.deepEqual(ducks, [[s.id('music'), -12, 0.5]], 'the music goes down; the cue’s own sound does not');
  assert.equal((r.engine.active().find((a) => a.id === s.id('music')) as SoundRow).duck, -12);
  assert.equal(r.audio.playing.get(s.id('music'))!.db, -6, 'its own level is not touched');
  r.engine.go();                                             // a sound started under the duck is one of the others
  assert.deepEqual(ducks.at(-1), [s.id('late'), -12, 0]);
  r.engine.go();                                             // a boost on top: the two add up
  const held = () => Object.fromEntries(r.engine.active().filter((a): a is SoundRow => a.kind === 'audio').map((a) => [a.name, a.duck]));
  assert.deepEqual(held(), { music: -9, voice: 3, late: -9, boost: -12 });
  assert.deepEqual(ducks.slice(-3), [[s.id('music'), -9, 1], [s.id('voice'), 3, 1], [s.id('late'), -9, 1]]);
  r.audio.playing.delete(s.id('voice')); r.engine.audioEnded(s.id('voice'));
  assert.equal(ducks.length, 6, 'the group is still running (its memo is waiting): the duck holds');
  r.advance(3.1);
  assert.deepEqual(ducks.slice(-3), [[s.id('music'), 3, 0.5], [s.id('late'), 3, 0.5], [s.id('boost'), 0, 0.5]], 'back over the duck time when the cue has finished');
  r.engine.stopCue(s.id('boost'));
  assert.deepEqual(ducks.slice(-2), [[s.id('music'), 0, 1], [s.id('late'), 0, 1]]);
});

test('fade and stop others can be kept to the cue’s list, or to its peers', () => {
  const s = build([
    { op: 'list.add', name: 'Preshow' },
    add(A('pre'), { list: 'Preshow' }),
    add(A('bed', { number: '1' })),
    add({ type: 'group', ref: 'scene', number: '2', children: [A('one'), A('two', { preWait: 1, fadeOthers: 2, fadeOthersScope: 'peers' })] }),
    add(A('next', { number: '3', fadeOthers: 2, fadeOthersScope: 'list' })),
    add(A('all', { number: '4', fadeOthers: 2 })),
  ]);
  const r = rig(s.doc);
  r.engine.start(s.id('pre'));
  r.engine.go(); r.engine.go();
  r.advance(1.1);                                            // "two" takes out its peer only
  r.advance(2.1);
  assert.ok(!r.audio.playing.has(s.id('one')));
  assert.ok(r.audio.playing.has(s.id('bed')) && r.audio.playing.has(s.id('pre')) && r.audio.playing.has(s.id('two')));
  r.engine.go();                                             // "next": its own list, not the pre-show
  r.advance(2.1);
  assert.deepEqual([...r.audio.playing.keys()].sort(), [s.id('pre'), s.id('next')].sort());
  r.engine.go();                                             // "all"
  r.advance(2.1);
  assert.deepEqual([...r.audio.playing.keys()], [s.id('all')]);
});

test('auto-load: a cue standing by with it has its sounds decoded ahead, and plays from the buffer', () => {
  const s = build([
    add(A('plain', { number: '1' })),
    add(A('tight', { number: '2', autoLoad: true })),
    add({ type: 'group', ref: 'g', number: '3', autoLoad: true, children: [A('k1'), { type: 'group', children: [A('k2')] }] }),
  ]);
  const r = rig(s.doc);
  assert.deepEqual(r.engine.wantedFiles(), []);
  r.engine.go();
  assert.deepEqual(r.engine.wantedFiles(), ['media/tight.wav']);
  r.engine.go();
  assert.equal(last(r, 'play')[2].exact, true);
  assert.deepEqual(r.engine.wantedFiles().sort(), ['media/k1.wav', 'media/k2.wav', 'media/tight.wav'], 'what is playing, and the group standing by');
});

test('a Load cue loads any cue, counted through its pre-wait; a negative time is from the end', () => {
  const s = build([
    add(A('song', { number: '1', from: 2 })),
    add({ type: 'group', ref: 'scene', number: '2', children: [A('bed'), A('sting', { preWait: 10 }), { type: 'memo', ref: 'past', preWait: 4 }] }),
    add({ type: 'load', ref: 'l1', target: '@song', at: 30 }),
    add({ type: 'load', ref: 'l2', target: '@scene', at: 6 }),
    add({ type: 'load', ref: 'l3', target: '@song', at: '-10' }),
  ]);
  assert.equal(show.index(s.doc).byId.get(s.id('l3'))!.at, -10, 'a Load cue’s time may be negative');
  const r = rig(s.doc);
  r.engine.setDuration('media/song.wav', 100); r.engine.setDuration('media/bed.wav', 60);
  r.engine.fire(s.id('l1'));
  assert.deepEqual(r.engine.snapshot().loaded, { id: s.id('song'), at: 30 }, 'the cue standing by shows as loaded');
  r.engine.fire(s.id('l2'));
  assert.deepEqual(r.engine.snapshot().loads, { [s.id('scene')]: 6 });
  r.engine.go();
  assert.equal(last(r, 'play')[2].from, 32, '30 s into the cue, which starts 2 s into its file');
  r.engine.go();
  assert.equal(r.audio.calls.find((c) => c[0] === 'play' && c[1] === s.id('bed'))![2].from, 6);
  assert.ok(!r.engine.waits.has(s.id('past')), 'a child whose moment has passed is skipped');
  assert.equal(r.engine.waits.get(s.id('sting'))!.total, 4, 'one still to come waits what is left');
  assert.deepEqual(r.engine.snapshot().loads, {}, 'used once');
  r.engine.fire(s.id('l3'));                                 // song is no longer standing by: 98 s long, so 88 s in
  r.engine.start(s.id('song'));
  assert.equal(last(r, 'play')[2].from, 90);
  r.engine.loadToTime(12, s.id('song'));                     // a remote's load of a cue that is not standing by
  r.engine.start(s.id('song'));
  assert.equal(last(r, 'play')[2].from, 14);
});

test('a Reset cue puts its target back: stopped, unloaded, armed as written, a Fade undone', () => {
  const s = build([
    add(A('music', { number: '1', gainDb: -3 })),
    add({ type: 'fade', ref: 'dip', number: '2', target: '@music', db: -20, duration: 4 }),
    add({ type: 'reset', ref: 'undo', number: '3', target: '@dip' }),
    add(A('sfx', { number: '4', armed: false })),
    add({ type: 'reset', ref: 'again', number: '5', target: '@sfx' }),
  ]);
  const r = rig(s.doc);
  r.engine.go(); r.engine.go();
  r.advance(1);                                              // mid-fade
  r.engine.go();
  assert.deepEqual(last(r, 'fade'), ['fade', s.id('music'), -3, 0, undefined], 'the sound the Fade moved is back at its own level');
  assert.ok(!r.engine.fades.has(s.id('dip')), 'and the Fade is no longer running');
  r.advance(5);
  assert.equal(r.audio.playing.get(s.id('music'))!.db, -3);
  r.engine.toggleArm(s.id('sfx'));                           // armed by hand, loaded, started
  r.engine.loadToTime(5, s.id('sfx'));
  r.engine.start(s.id('sfx'));
  r.engine.loadToTime(7, s.id('sfx'));
  r.engine.setPlayhead(s.id('again')); r.engine.go();
  assert.ok(!r.audio.playing.has(s.id('sfx')), 'stopped');
  assert.ok(r.engine.disarmed.has(s.id('sfx')), 'disarmed again, as the show has it');
  assert.deepEqual(r.engine.snapshot().loads, {});
});

test('a Target cue re-aims another cue, until Reset or an edit', () => {
  const s = build([
    add(A('one', { number: '1' })), add(A('two', { number: '2' })),
    add({ type: 'fade', ref: 'out', number: '3', target: '@one', db: -60, duration: 1, stopTarget: true }),
    add({ type: 'target', ref: 'aim', number: '4', target: '@out', to: '@two' }),
    add({ type: 'target', ref: 'bad', number: '5', target: '@one', to: '@two' }),
    add({ type: 'target', ref: 'wrong', number: '6', target: '@out', to: '@aim' }),
  ]);
  const why = show.problems(s.doc).map((p) => [p.id, p.why]);
  assert.deepEqual(why, [[s.id('bad'), 'the Audio cue it re-aims has no target to change'], [s.id('wrong'), 'the Fade cue it re-aims cannot target a Target cue']]);
  const r = rig(s.doc);
  r.engine.start(s.id('one')); r.engine.start(s.id('two'));
  r.engine.fire(s.id('aim'));
  r.engine.fire(s.id('out'));
  assert.equal(last(r, 'fade')[1], s.id('two'));
  r.engine.load(show.toEngineDoc(s.doc));
  assert.equal(r.engine.byId.get(s.id('out'))!.target, s.id('two'), 'a reload of the same show keeps it');
  r.engine.reset();
  assert.equal(r.engine.byId.get(s.id('out'))!.target, s.id('one'), 'Reset puts it back');
});

test('a Devamp can start the next cue as the loop ends: a region, and a sound that loops whole', () => {
  const s = build([
    add(A('track', { number: '1', loops: [{ start: 10, end: 18, hold: true }] })),
    add({ type: 'devamp', ref: 'out', number: '2', target: '@track', startNext: true }),
    add(A('hit', { number: '3', continue: 'auto-continue' })),
    add(A('more', { number: '4' })),
    add(A('ring', { number: '5', loop: true })),
    add({ type: 'devamp', ref: 'out2', number: '6', target: '@ring', startNext: true }),
    add(A('answer', { number: '7' })),
  ]);
  const r = rig(s.doc);
  r.engine.setDuration('media/track.wav', 60); r.engine.setDuration('media/ring.wav', 4);
  r.engine.go();
  r.engine.setExact(s.id('track'), true);
  r.advance(23);                                             // 5 s into its second pass of 10–18
  assert.equal(Math.round(r.engine.positionOf(r.engine.running.get(s.id('track'))!)), 15);
  r.engine.go();                                             // the Devamp
  assert.equal(r.engine.playhead, s.id('more'), 'the playhead passes the cue that will start');
  assert.ok(!r.audio.playing.has(s.id('hit')));
  const w = r.engine.active().find((a) => a.id === s.id('hit'));
  assert.ok(w && Math.abs(w.total - 3) < 0.01, 'it is counted down in Active cues: 3 s to the end of the section');
  r.advance(2.9);
  assert.ok(!r.audio.playing.has(s.id('hit')));
  r.advance(0.2);
  assert.ok(r.audio.playing.has(s.id('hit')) && r.audio.playing.has(s.id('more')), 'at the section’s end, with its own sequence');
  assert.ok(r.audio.playing.has(s.id('track')), 'the track plays on');
  assert.equal(r.engine.playhead, s.id('ring'));
  r.engine.go();                                             // ring
  r.engine.go();                                             // its Devamp
  assert.equal(r.engine.playhead, null);
  assert.ok(!r.audio.playing.has(s.id('answer')));
  r.audio.playing.delete(s.id('ring')); r.engine.audioEnded(s.id('ring'));
  assert.ok(r.audio.playing.has(s.id('answer')), 'a whole loop: when its last pass ends');
});
