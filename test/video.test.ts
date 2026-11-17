import test from 'node:test';
import assert from 'node:assert/strict';
import { rig, build } from './helpers';
import * as show from '../core/show/show';
import { mediaKind, geometryOf, movesOf, mix, stageOf, cleanPin, pinMatrix, project } from '../core/video/stage';

/** An engine with a stage that writes down what it is told. */
function stageRig(ops) {
  const b = build(ops);
  const calls = [];
  const video = {};
  for (const op of ['show', 'move', 'pause', 'resume', 'seek', 'hide']) video[op] = (...a) => calls.push([op, ...a]);
  const r = rig(b.doc, { video });
  const of = (op) => calls.filter((c) => c[0] === op);
  return { ...r, ...b, calls, of, last: (op) => of(op).at(-1) };
}
const add = (ref, cue, extra = {}) => ({ op: 'cue.add', ref, cue, ...extra });

test('a video file is a sound with a picture: one GO starts both, on the cue’s bus and at its place on the stage', () => {
  const s = stageRig([add('v', { type: 'video', file: 'media/film.mp4', gainDb: -6, bus: 'music', from: 2, x: 100, y: -50, scale: 0.5, layer: 3, loop: true })]);
  s.engine.setDuration('media/film.mp4', 30);
  s.engine.go();
  const play = s.audio.calls.find((c) => c[0] === 'play');
  assert.deepEqual([play[2].file, play[2].gainDb, play[2].from, play[2].bus, play[2].loop], ['media/film.mp4', -6, 2, 'music', true]);
  assert.equal(play[2].exact, false, 'a video is never decoded whole to loop');
  assert.deepEqual(s.engine.wantedFiles(), []);
  const [, id, spec] = s.last('show');
  assert.equal(id, s.id('v'));
  assert.deepEqual([spec.kind, spec.file, spec.from, spec.loop, spec.layer, spec.fit], ['video', 'media/film.mp4', 2, true, 3, 'fit']);
  assert.deepEqual(spec.geometry, { opacity: 100, x: 100, y: -50, scale: 0.5, rotation: 0 });
  const a = s.engine.active().find((x) => x.id === s.id('v'));
  assert.deepEqual([a.kind, a.picture, a.total], ['audio', 'video', 30]);
});

test('pause, resume, a skip and Load to Time reach the picture as they reach the sound', () => {
  const s = stageRig([add('v', { type: 'video', file: 'media/film.mp4' })]);
  s.engine.setDuration('media/film.mp4', 30);
  s.engine.loadToTime(5);
  s.engine.go();
  assert.equal(s.last('show')[2].from, 5, 'loaded to a time');
  s.engine.pause(s.id('v'));
  assert.deepEqual(s.last('pause'), ['pause', s.id('v')]);
  s.engine.resume(s.id('v'));
  assert.deepEqual(s.last('resume'), ['resume', s.id('v')]);
  s.engine.seek(s.id('v'), 12);
  assert.deepEqual(s.last('seek'), ['seek', s.id('v'), 12]);
  assert.ok(s.audio.calls.some((c) => c[0] === 'seek' && c[2] === 12));
});

test('a stop clears the picture; a panic fades it out with the sound and then clears it', () => {
  const s = stageRig([add('v', { type: 'video', file: 'media/film.mp4' }), add('w', { type: 'video', file: 'media/two.mp4' })]);
  s.engine.go();
  s.engine.stopCue(s.id('v'));
  assert.deepEqual(s.last('hide'), ['hide', s.id('v')]);
  s.engine.go();
  s.advance(1);
  s.engine.panic();
  assert.deepEqual(s.last('move'), ['move', s.id('w'), { opacity: 0 }, 1]);
  assert.equal(s.of('hide').length, 1, 'still up while it fades');
  s.advance(1.01);
  assert.deepEqual(s.last('hide'), ['hide', s.id('w')]);
  assert.equal(s.engine.running.size, 0);
});

test('a video that reaches its end leaves the stage; with “hold at end” its last frame stays until it is stopped', () => {
  const s = stageRig([add('v', { type: 'video', file: 'media/film.mp4' }), add('h', { type: 'video', file: 'media/film.mp4', holdEnd: true, continue: 'auto-follow' }), add('m', { type: 'memo' })]);
  s.engine.setDuration('media/film.mp4', 4);
  s.engine.go(); s.advance(4);
  s.engine.audioEnded(s.id('v'));
  assert.deepEqual(s.last('hide'), ['hide', s.id('v')]);
  s.engine.go(); s.advance(4);
  s.engine.audioEnded(s.id('h'));
  assert.equal(s.of('hide').length, 1, 'held');
  assert.deepEqual(s.last('pause'), ['pause', s.id('h')]);
  const a = s.engine.active().find((x) => x.id === s.id('h'));
  assert.deepEqual([a.heldEnd, a.elapsed], [true, 4]);
  s.advance(10);
  assert.equal(s.engine.active().find((x) => x.id === s.id('h')).elapsed, 4, 'its clock has stopped at the end');
  assert.ok(s.engine.isLive(s.id('h')), 'still running, so what follows it waits');
  s.engine.stopCue(s.id('h'));
  assert.deepEqual(s.last('hide'), ['hide', s.id('h')]);
});

test('a video that never got going is not “held at its end”', () => {
  const s = stageRig([add('h', { type: 'video', file: 'media/film.mp4', holdEnd: true })]);
  s.engine.go(); s.advance(0.1);
  s.engine.audioEnded(s.id('h'));         // what the host does when the file will not play
  assert.equal(s.engine.running.size, 0);
  assert.deepEqual(s.last('hide'), ['hide', s.id('h')]);
});

test('fade in and fade out move the picture with the sound', () => {
  const s = stageRig([add('v', { type: 'video', file: 'media/film.mp4', fadeIn: 2, fadeOut: 3, opacity: 80 })]);
  s.engine.setDuration('media/film.mp4', 10);
  s.engine.go();
  assert.equal(s.last('show')[2].geometry.opacity, 0, 'it starts unseen');
  assert.deepEqual(s.last('move'), ['move', s.id('v'), { opacity: 80 }, 2]);
  s.advance(7.01);
  assert.deepEqual(s.last('move'), ['move', s.id('v'), { opacity: 0 }, 3]);
  assert.ok(s.audio.calls.some((c) => c[0] === 'fade' && c[2] === -60 && c[3] === 3));
});

test('a video that loops from its Start to its End is skipped back there, picture and sound', () => {
  const s = stageRig([add('v', { type: 'video', file: 'media/film.mp4', from: 2, cutAt: 5, loop: true })]);
  s.engine.setDuration('media/film.mp4', 10);
  s.engine.go();
  assert.equal(s.last('show')[2].loop, false, 'the file itself does not loop: the engine brings it back');
  s.advance(3.01);
  assert.deepEqual(s.last('seek'), ['seek', s.id('v'), 2]);
  s.advance(3.01);
  assert.equal(s.of('seek').length, 2, 'and round again');
  assert.equal(s.engine.running.size, 1);
});

test('a Fade aimed at a video moves the geometry it names, and leaves the sound alone when it names no level', () => {
  const s = stageRig([
    add('v', { type: 'video', file: 'media/film.mp4', gainDb: -3 }),
    add('f', { type: 'fade', target: '@v', duration: 2, x: 200, scale: 2, opacity: 50 }),
    add('g', { type: 'fade', target: '@v', duration: 1, db: -20, rotation: 90 }),
    add('out', { type: 'fade', target: '@v', duration: 1.5, stopTarget: true }),
  ]);
  s.engine.go(); s.engine.go();
  assert.deepEqual(s.last('move'), ['move', s.id('v'), { opacity: 50, x: 200, scale: 2 }, 2]);
  assert.deepEqual(s.audio.calls.filter((c) => c[0] === 'fade').at(-1).slice(1, 4), [s.id('v'), -3, 2], 'the level stays at its own');
  assert.ok(s.engine.active().some((a) => a.id === s.id('f') && a.kind === 'fade' && a.total === 2), 'the fade shows in Active Cues');
  s.advance(2);
  s.engine.go();
  assert.deepEqual(s.last('move'), ['move', s.id('v'), { rotation: 90 }, 1]);
  assert.deepEqual(s.audio.calls.filter((c) => c[0] === 'fade').at(-1).slice(1, 4), [s.id('v'), -20, 1]);
  assert.deepEqual(s.engine.active().find((a) => a.id === s.id('v')).geometry, { opacity: 50, x: 200, y: 0, scale: 2, rotation: 90 });
  s.advance(1);
  s.engine.go();       // a Fade that names nothing takes its target out
  assert.deepEqual(s.last('move'), ['move', s.id('v'), { opacity: 0 }, 1.5]);
  assert.deepEqual(s.audio.calls.filter((c) => c[0] === 'fade').at(-1).slice(1, 4), [s.id('v'), -60, 1.5]);
  s.advance(1.51);
  assert.deepEqual(s.last('hide'), ['hide', s.id('v')]);
});

test('a Fade’s geometry does nothing to a sound, and reaches a picture inside a group only as a fade out', () => {
  const s = stageRig([
    add('g', { type: 'group', children: [{ type: 'audio', file: 'media/a.wav', ref: 'a' }, { type: 'video', file: 'media/pic.png', ref: 'p' }] }),
    add('f', { type: 'fade', target: '@a', duration: 1, db: -10, opacity: 0 }),
    add('o', { type: 'fade', target: '@g', duration: 2, stopTarget: true }),
  ]);
  s.engine.go(); s.engine.go();
  assert.equal(s.of('move').length, 0);
  s.advance(1);
  s.engine.go();
  assert.deepEqual(s.last('move'), ['move', s.id('p'), { opacity: 0 }, 2]);
  s.advance(2.01);
  assert.equal(s.engine.running.size, 0);
});

test('a still image has no sound and no end: it stays until it is stopped, or for its duration', () => {
  const s = stageRig([
    add('p', { type: 'video', file: 'media/card.png', fit: 'fill' }),
    add('t', { type: 'video', file: 'media/card.png', duration: 5, fadeOut: 1, continue: 'auto-follow' }),
    add('m', { type: 'video', file: 'media/next.jpg' }),
  ]);
  s.engine.go();
  assert.equal(s.audio.calls.filter((c) => c[0] === 'play').length, 0, 'nothing is asked of the audio window');
  assert.deepEqual([s.last('show')[2].kind, s.last('show')[2].fit], ['image', 'fill']);
  s.advance(600);
  assert.ok(s.engine.running.has(s.id('p')));
  assert.deepEqual(s.engine.stills(), ['media/card.png', 'media/next.jpg']);
  assert.deepEqual(s.engine.files(), [], 'a still is not sent to be measured as a sound');
  s.engine.stopCue(s.id('p'));
  s.engine.go();
  assert.equal(s.engine.active().find((a) => a.id === s.id('t')).total, 5);
  s.advance(4.01);
  assert.deepEqual(s.last('move'), ['move', s.id('t'), { opacity: 0 }, 1]);
  s.advance(1);
  assert.ok(!s.engine.running.has(s.id('t')));
  assert.ok(s.engine.running.has(s.id('m')), 'what follows it fired when it had gone');
});

test('a paused still does not run out its time', () => {
  const s = stageRig([add('t', { type: 'text', text: 'Interval', duration: 5 })]);
  s.engine.go(); s.advance(2);
  s.engine.pause(s.id('t')); s.advance(60);
  assert.ok(s.engine.running.has(s.id('t')));
  s.engine.resume(s.id('t')); s.advance(2.9);
  assert.ok(s.engine.running.has(s.id('t')));
  s.advance(0.2);
  assert.ok(!s.engine.running.has(s.id('t')));
  assert.deepEqual(s.last('hide'), ['hide', s.id('t')]);
});

test('a Text cue and a Camera cue go to the stage with what they are made of', () => {
  const s = stageRig([
    add('t', { type: 'text', text: 'Act Two\nThe Sea', font: 'Georgia', size: 120, textColor: '#ffcc00', align: 'left', y: -300 }),
    add('c', { type: 'camera', camera: 'Front camera', mirror: true, fit: 'fill', layer: 5 }),
    add('f', { type: 'fade', target: '@t', duration: 2 }),
  ]);
  s.engine.go();
  const t = s.last('show')[2];
  assert.deepEqual([t.kind, t.text, t.font, t.size, t.textColor, t.align, t.geometry.y], ['text', 'Act Two\nThe Sea', 'Georgia', 120, '#ffcc00', 'left', -300]);
  s.engine.go();
  const c = s.last('show')[2];
  assert.deepEqual([c.kind, c.camera, c.mirror, c.fit, c.layer], ['camera', 'Front camera', true, 'fill', 5]);
  assert.equal(s.audio.calls.filter((x) => x[0] === 'play').length, 0);
  s.engine.go();     // a Fade with nothing named, aimed at a title: it fades from sight, and (left alone) is stopped at the end
  assert.deepEqual(s.last('move'), ['move', s.id('t'), { opacity: 0 }, 2]);
  s.advance(3);
  assert.ok(!s.engine.running.has(s.id('t')));
  assert.equal(require('../core/show/cue-types').defaultName({ type: 'text', text: 'Act Two\nThe Sea' }), 'Act Two');
});

test('what is on the stage can be told again to a stage that has just opened', () => {
  const s = stageRig([add('v', { type: 'video', file: 'media/film.mp4' }), add('t', { type: 'text', text: 'Hello' }), add('f', { type: 'fade', target: '@v', duration: 0, opacity: 40 })]);
  s.engine.setDuration('media/film.mp4', 60);
  s.engine.go(); s.engine.go(); s.engine.go();
  s.advance(7);
  s.engine.pause(s.id('t'));
  const now = s.engine.pictures();
  assert.deepEqual(now.map((p) => [p.spec.kind, p.spec.from, p.spec.geometry.opacity, p.paused]), [['video', 7, 40, false], ['text', 0, 100, true]]);
});

test('a missing still is a problem and is not shown; a video file of an unknown kind is warned about', () => {
  const s = stageRig([add('p', { type: 'video', file: 'media/gone.png' }), add('q', { type: 'video', file: 'media/film.avi' }), add('n', { type: 'video' })]);
  s.engine.setMissing('media/gone.png');
  assert.deepEqual(s.engine.problems().map((p) => p.why), ['missing file media/gone.png', 'no file']);
  s.engine.go();
  assert.equal(s.of('show').length, 0);
  assert.match(show.problems(s.doc).find((p) => p.id === s.id('q')).why, /avi/);
});

test('the show file’s Video, Text and Camera cues become the engine’s sounds-with-pictures and pictures', () => {
  const b = build([
    add('v', { type: 'video', file: 'media/film.mov', bus: 'nowhere', duration: 9 }),
    add('p', { type: 'video', file: 'media/card.jpg', gainDb: -6, loop: true }),
    add('t', { type: 'text', text: 'x' }),
    add('a', { type: 'audio', file: 'media/a.wav' }),
    add('f', { type: 'fade', target: '@a', opacity: 10 }),
    add('g', { type: 'fade', target: '@v', x: 5 }),
  ]);
  const cues = show.toEngineDoc(b.doc).lists[0].cues;
  assert.deepEqual(cues.map((c) => [c.type, c.picture]), [['audio', 'video'], ['picture', 'image'], ['picture', 'text'], ['audio', undefined], ['fade', undefined], ['fade', undefined]]);
  assert.equal(cues[0].bus, 'effects', 'a bus that is not there falls back as an Audio cue’s does');
  assert.equal(cues[0].duration, undefined, 'a video’s length is its file’s');
  assert.deepEqual([cues[1].gainDb, cues[1].loop, cues[1].bus], [undefined, undefined, undefined]);
  assert.deepEqual([cues[4].opacity, cues[4].db], [undefined, -60], 'aimed at a sound, a Fade is as it was');
  assert.deepEqual([cues[5].x, cues[5].db], [5, undefined]);
});

test('which files are pictures, and a geometry as numbers', () => {
  assert.deepEqual(['a.MP4', 'b.mov', 'c.webm', 'd.png', 'e.JPG', 'f.wav', 'g'].map(mediaKind), ['video', 'video', 'video', 'image', 'image', null, null]);
  assert.deepEqual(geometryOf({ opacity: 250, scale: -1, x: '12' }), { opacity: 100, x: 12, y: 0, scale: 0, rotation: 0 });
  assert.deepEqual(movesOf({ opacity: 0, x: '', y: null, scale: 2, db: -60 }), { opacity: 0, scale: 2 });
  assert.deepEqual(mix({ opacity: 100, x: 0, y: 0, scale: 1, rotation: 0 }, { opacity: 0, x: 100 }, 0.25), { opacity: 75, x: 25, y: 0, scale: 1, rotation: 0 });
});

test('the stage’s settings: a size, and a corner pin that takes each corner where it was put', () => {
  assert.deepEqual(stageOf({}), { width: 1920, height: 1080, pin: null });
  assert.deepEqual(stageOf({ video: { width: 1280, height: 5, pin: [[0, 0], [1, 0], [1, 1], [0, 1]] } }), { width: 1280, height: 1080, pin: null }, 'the stage’s own corners are no pin');
  const pin = [[0.05, 0.02], [0.9, 0.1], [1, 0.95], [-0.02, 1]];
  const m = pinMatrix(1920, 1080, pin);
  const near = (got, want) => assert.ok(Math.abs(got[0] - want[0]) < 1e-6 && Math.abs(got[1] - want[1]) < 1e-6, `${got} is not ${want}`);
  near(project(m, 0, 0), [0.05 * 1920, 0.02 * 1080]);
  near(project(m, 1920, 0), [0.9 * 1920, 0.1 * 1080]);
  near(project(m, 1920, 1080), [1920, 0.95 * 1080]);
  near(project(m, 0, 1080), [-0.02 * 1920, 1080]);
  // straight lines stay straight: the middle of the top edge lands on the line between the two top corners
  const mid = project(m, 960, 0);
  const slope = (0.1 * 1080 - 0.02 * 1080) / (0.9 * 1920 - 0.05 * 1920);
  assert.ok(Math.abs((mid[1] - 0.02 * 1080) - slope * (mid[0] - 0.05 * 1920)) < 1e-6);
  assert.equal(pinMatrix(1920, 1080, null), null);
  assert.equal(cleanPin([[0, 0], [1, 1], [1, 0], [0, 1]]), null, 'a quad folded over itself');
  assert.equal(cleanPin([[0, 0], [0.5, 0], [1, 0], [0, 1]]), null, 'three corners in a line');
  assert.equal(cleanPin([[0, 0], [1, 0], [1, 'x'], [0, 1]]), null);
});

// ── with the cues that came beside it: lists as targets, Load, Reset and Target cues, ducking the others ──

test('a Fade or a Stop aimed at a cue list takes the pictures in it; a Load cue loads a video', () => {
  const s = stageRig([
    { op: 'list.add', name: 'Screen' },
    add('v', { type: 'video', file: 'media/film.mp4' }, { list: 'Screen' }),
    add('t', { type: 'text', text: 'Act Two' }, { list: 'Screen' }),
    add('l', { type: 'load', target: '@v', at: 8 }),
    add('sv', { type: 'start', target: '@v' }),
    add('st', { type: 'start', target: '@t' }),
    add('f', { type: 'fade', target: 'list:Screen', duration: 2, stopTarget: true }),
  ]);
  assert.deepEqual(show.problems(s.doc).filter((p) => p.level === 'error'), []);
  s.engine.setDuration('media/film.mp4', 30);
  s.engine.go(); s.engine.go(); s.engine.go();
  assert.equal(s.of('show').find((c) => c[1] === s.id('v'))[2].from, 8, 'the Load cue’s time reaches the picture');
  assert.ok(s.audio.calls.some((c) => c[0] === 'play' && c[2].from === 8), '…and the sound');
  s.engine.go();
  assert.deepEqual(s.of('move').slice(-2).map((c) => [c[1], c[2], c[3]]).sort(), [[s.id('t'), { opacity: 0 }, 2], [s.id('v'), { opacity: 0 }, 2]].sort());
  s.advance(2.01);
  assert.deepEqual(s.of('hide').map((c) => c[1]).sort(), [s.id('t'), s.id('v')].sort());
  assert.equal(s.engine.running.size, 0);
});

test('a Reset cue on a Fade puts a picture back where its cue has it; a Target cue re-aims a Fade at a picture', () => {
  const s = stageRig([
    add('v', { type: 'video', file: 'media/film.mp4', gainDb: -3, x: 10 }),
    add('p', { type: 'video', file: 'media/card.png' }),
    add('f', { type: 'fade', target: '@v', duration: 1, db: -20, x: 200, opacity: 40 }),
    add('r', { type: 'reset', target: '@f' }),
    add('a', { type: 'target', target: '@f', to: '@p' }),
  ]);
  assert.deepEqual(show.problems(s.doc).filter((p) => p.level === 'error'), []);
  s.engine.go(); s.engine.go(); s.engine.go();
  s.advance(1.01);
  assert.deepEqual(s.engine.active().find((a) => a.id === s.id('v')).geometry, { opacity: 40, x: 200, y: 0, scale: 1, rotation: 0 });
  s.engine.go();
  assert.deepEqual(s.last('move'), ['move', s.id('v'), { opacity: 100, x: 10, y: 0, scale: 1, rotation: 0 }, 0]);
  assert.deepEqual(s.audio.calls.filter((c) => c[0] === 'fade').at(-1).slice(1, 4), [s.id('v'), -3, 0]);
  s.engine.go();
  s.engine.fire(s.id('f'));
  assert.deepEqual(s.last('move'), ['move', s.id('p'), { opacity: 40, x: 200 }, 1]);
});

test('a cue that ducks the others moves a video’s sound and leaves a still alone; a second trigger can stop a picture', () => {
  const s = stageRig([
    add('v', { type: 'video', file: 'media/film.mp4' }),
    add('p', { type: 'video', file: 'media/card.png', secondTrigger: 'stop' }),
    add('d', { type: 'audio', file: 'media/line.wav', duckOthers: -12, duckTime: 0.5 }),
  ]);
  const ducks = []; s.audio.duck = (key, db, secs) => ducks.push([key, db, secs]);
  s.engine.go(); s.engine.go(); s.engine.go();
  assert.deepEqual(ducks, [[s.id('v'), -12, 0.5]]);
  assert.equal(s.engine.active().find((a) => a.id === s.id('p')).duck, 0);
  assert.equal(s.engine.fire(s.id('p')), 'second');
  assert.deepEqual(s.last('hide'), ['hide', s.id('p')]);
});
