// What one sound can do: fade shapes, a level envelope, rate, level limits, and putting a fade back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rig, build } from './helpers';
import type { SoundLine } from './helpers';
import * as show from '../core/show/show';
import { applyOps } from '../core/show/ops';
import * as curves from '../core/audio/curves';
import type { EngineAudio, EngineOptions } from '../core/engine/cue-engine';
import type { Op } from '../core/show/ops';
import type { ShowDoc } from '../core/show/types';

type FadeArgs = Parameters<EngineAudio['fade']>;
type RateArgs = Parameters<NonNullable<EngineAudio['rate']>>;

/** The rig, with every argument of a fade and every rate move written down too (the shared rig keeps four). */
function rigAll(doc: ShowDoc, opts?: Partial<EngineOptions>) {
  const r = Object.assign(rig(doc, opts), { fades: [] as FadeArgs[], rates: [] as RateArgs[] });
  const fade = r.audio.fade;
  r.audio.fade = (...a) => { r.fades.push(a); fade(...a); };
  (r.audio as EngineAudio).rate = (...a) => { r.rates.push(a); };
  return r;
}
/** What a clean kept (undefined when it refused). */
const kept = <T>(r: { ok: true; value: T } | { ok: false; why: string }) => (r.ok ? r.value : undefined);
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

// ── shapes ──────────────────────────────────────────────────────────────────
test('a shape says how far along a fade is: linear, an S-curve, and custom points', () => {
  assert.equal(curves.shapeAt('linear', 0.25), 0.25);
  near(curves.shapeAt('s-curve', 0.5), 0.5);
  assert.ok(curves.shapeAt('s-curve', 0.1) < 0.1 && curves.shapeAt('s-curve', 0.9) > 0.9, 'it eases out of the start and into the end');
  const custom = kept(curves.cleanShape([[0.5, 0.9]]))!;
  assert.deepEqual(custom, [[0, 0], [0.5, 0.9], [1, 1]], 'the ends are always (0, 0) and (1, 1)');
  near(curves.shapeAt(custom, 0.25), 0.45);
  near(curves.shapeAt(custom, 0.75), 0.95);
});

test('a shape is kept on the cue as little as it can be, and nonsense is refused', () => {
  assert.equal(kept(curves.cleanShape('linear')), undefined, 'linear is the default: nothing is written');
  assert.equal(kept(curves.cleanShape('s-curve')), 's-curve');
  assert.equal(curves.cleanShape('wobble').ok, false);
  assert.deepEqual(kept(curves.cleanShape([[0.7, 2], [0.2, -1], [0.2, 0.5]])), [[0, 0], [0.2, 0], [0.7, 1], [1, 1]], 'points are put in order, kept inside the square, one to a moment');
  const s = build([{ op: 'cue.add', ref: 'a', cue: { type: 'audio', file: 'a.wav' } }, { op: 'cue.add', ref: 'f', cue: { type: 'fade', target: '@a', shapeUp: 's-curve', shapeDown: 'linear' } }]);
  const f = show.index(s.doc).byId.get(s.id('f'))!;
  assert.equal(f.shapeUp, 's-curve');
  assert.equal('shapeDown' in f, false);
  assert.throws(() => applyOps(s.doc, [{ op: 'cue.set', id: s.id('f'), props: { shapeUp: 'wobble' } }]), /fade shape/);
});

test('what is left of a shape, from part way in, is a whole fade of its own', () => {
  const p = curves.progressOf('s-curve', 5, 0.5);
  assert.equal(p[0], 0); assert.equal(p[4], 1);
  near(p[2], (curves.shapeAt('s-curve', 0.75) - 0.5) / 0.5, 0.002);
  assert.deepEqual(curves.progressOf('linear', 3), [0, 0.5, 1]);
});

const fadeShow = (fade = {}, audio = {}) => build([
  { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'a.wav', gainDb: -10, ...audio } },
  { op: 'cue.add', ref: 'f', cue: { type: 'fade', number: '2', target: '@a', duration: 4, ...fade } },
]);

test('a Fade cue uses its rising shape for a level going up and its falling shape for one going down', () => {
  const up = fadeShow({ db: 0, shapeUp: 's-curve', shapeDown: [[0.5, 0.9]] });
  const r = rigAll(up.doc);
  r.engine.go(); r.engine.go();
  assert.deepEqual(r.fades.at(-1), [up.id('a'), 0, 4, undefined, 's-curve', 0]);
  const down = fadeShow({ db: -30, shapeUp: 's-curve', shapeDown: [[0.5, 0.9]] });
  const d = rigAll(down.doc);
  d.engine.go(); d.engine.go();
  assert.deepEqual(d.fades.at(-1)!.slice(4), [[[0, 0], [0.5, 0.9], [1, 1]], 0]);
});

test('a fade with no shape is sent as a plain fade: no shape with it', () => {
  const s = fadeShow({ db: -30 });
  const r = rigAll(s.doc);
  r.engine.go(); r.engine.go();
  assert.deepEqual(r.fades.at(-1), [s.id('a'), -30, 4]);
});

test('an Audio cue’s own fade in and fade out have their shapes', () => {
  const s = fadeShow({}, { fadeIn: 2, fadeInShape: 's-curve', fadeOut: 3, fadeOutShape: [[0.3, 0.6]] });
  const r = rigAll(s.doc);
  r.engine.setDuration('a.wav', 10);
  r.engine.go();
  assert.deepEqual(r.fades[0], [s.id('a'), -10, 2, undefined, 's-curve', 0]);
  r.advance(7.05);
  assert.equal(r.fades.at(-1)![1], -60);
  assert.deepEqual(r.fades.at(-1)![4], [[0, 0], [0.3, 0.6], [1, 1]]);
});

test('a shaped fade that is paused goes on along what is left of its shape', () => {
  const s = fadeShow({ db: 0, shapeUp: 's-curve' });
  const r = rigAll(s.doc);
  r.engine.go(); r.engine.go();
  r.advance(1);
  r.engine.pause(); r.advance(5); r.engine.resume();
  const last = r.fades.at(-1)!;
  assert.equal(last[1], 0); near(last[2], 3); assert.equal(last[4], 's-curve'); near(last[5]!, 0.25);
});

// ── the envelope ────────────────────────────────────────────────────────────
test('an envelope is points in time order, read between them in straight lines', () => {
  const env = curves.cleanEnvelope([[4, -20], [0, 0], { at: 2, db: -6 }, [4, -30], [9, 40]]);
  assert.deepEqual(env, [[0, 0], [2, -6], [4, -20], [9, 12]]);
  assert.equal(curves.envelopeAt(env, 1), -3);
  assert.equal(curves.envelopeAt(env, 3), -13);
  assert.equal(curves.envelopeAt(env, 99), 12, 'after its last point it holds');
  assert.equal(curves.envelopeAt([], 3), 0);
  assert.equal(curves.cleanEnvelope([[1, 'loud']]), null);
});

test('an Audio cue hands its envelope to the sound; an emptied one is taken off the cue', () => {
  const s = fadeShow({}, { envelope: [[0, -60], [2, 0]] });
  const r = rigAll(s.doc);
  r.engine.go();
  assert.deepEqual(r.audio.calls[0][2].envelope, [[0, -60], [2, 0]]);
  const cleared = applyOps(s.doc, [{ op: 'cue.set', id: s.id('a'), props: { envelope: [] } }]).doc;
  assert.equal('envelope' in show.index(cleared).byId.get(s.id('a'))!, false);
  const plain = fadeShow();
  const p = rigAll(plain.doc);
  p.engine.go();
  assert.deepEqual(Object.keys(p.audio.calls[0][2]).sort(), ['bus', 'exact', 'file', 'from', 'gainDb', 'loop'], 'a plain cue is played with nothing more');
});

// ── rate ────────────────────────────────────────────────────────────────────
test('a sound at a rate reaches places in its file sooner or later, and the engine’s clock knows', () => {
  const s = fadeShow({}, { rate: 2, cutAt: 8 });
  const r = rigAll(s.doc);
  r.engine.setDuration('a.wav', 20);
  r.engine.go();
  assert.equal(r.audio.calls[0][2].rate, 2);
  assert.equal(r.audio.calls[0][2].preservePitch, false);
  r.advance(1);
  near(r.engine.positionOf(r.engine.running.get(s.id('a'))!), 2);
  assert.equal(r.engine.lengthOf(s.id('a')), 4, 'eight seconds of file take four');
  r.advance(2.6);
  assert.ok(!r.audio.calls.some((c) => c[0] === 'cut'));
  r.advance(0.2);
  assert.ok(r.audio.calls.some((c) => c[0] === 'cut' && c[2] === 8), 'its End at is sent to the sound a moment before it gets there');
  r.advance(0.4);
  assert.ok(!r.audio.playing.has(s.id('a')), 'and it has stopped by four seconds');
});

test('keeping the pitch at a rate needs a streamed sound: it is never decoded, and the show says what that costs', () => {
  const s = fadeShow({}, { rate: 0.5, preservePitch: true, loop: true, cutAt: 4 });
  const r = rigAll(s.doc);
  r.engine.go();
  assert.equal(r.audio.calls[0][2].exact, false);
  assert.equal(r.audio.calls[0][2].preservePitch, true);
  assert.ok(show.problems(s.doc).some((p) => p.id === s.id('a') && /Keep pitch at a rate other than 1/.test(p.why)));
  const varispeed = fadeShow({}, { rate: 0.5, loop: true, cutAt: 4 });
  const v = rigAll(varispeed.doc);
  v.engine.go();
  assert.equal(v.audio.calls[0][2].exact, true, 'without it the sound is decoded and loops to the sample, at its rate');
  assert.equal(show.problems(varispeed.doc).length, 0);
});

test('a rate is refused outside what can be played', () => {
  const s = fadeShow();
  assert.throws(() => applyOps(s.doc, [{ op: 'cue.set', id: s.id('a'), props: { rate: 9 } }]), /between 0.25 and 4/);
});

test('a loop region goes round its count at the sound’s rate', () => {
  const s = fadeShow({}, { rate: 2, loops: [{ start: 2, end: 4, count: 3 }] });
  const r = rigAll(s.doc);
  r.engine.setDuration('a.wav', 20);
  r.engine.go();
  r.engine.setExact(s.id('a'), true);
  const run = () => r.engine.running.get(s.id('a'))!;
  assert.deepEqual([run().region!.start, run().region!.end], [2, 4]);
  r.advance(2.4);                      // 4.8 s of file played through: the second pass
  assert.equal((r.engine.active().find((a) => a.id === s.id('a')) as SoundLine).count!.pass, 2);
  r.advance(1.2);                      // 7.2 s: it lets go half way through its last pass (7 s)
  assert.equal(run().region, null);
  r.advance(1);
  near(r.engine.positionOf(run()), 9.2 - 4, 0.01);          // 9.2 s played through, less the two extra passes of 2 s
});

test('a Fade cue moves the rate over its time; the clock follows the ramp', () => {
  const s = fadeShow({ rate: 2, keepLevel: true, duration: 4 });
  const r = rigAll(s.doc);
  r.engine.setDuration('a.wav', 60);
  r.engine.go();
  r.advance(1);
  r.engine.go();
  assert.deepEqual(r.rates.at(-1), [s.id('a'), 2, 4]);
  assert.equal(r.fades.length, 0, 'rate only: the level is left alone');
  r.advance(4);
  const run = r.engine.running.get(s.id('a'))!;
  assert.equal(run.rate, 2);
  near(r.engine.positionOf(run), 1 + 4 * 1.5, 1e-6);       // a straight ramp from 1 to 2 covers its time at 1.5
  r.advance(1);
  near(r.engine.positionOf(run), 9, 1e-6);
});

test('a rate fade to a stop: “rate only” with stop target ends the sound when it lands', () => {
  const s = fadeShow({ rate: 0.25, keepLevel: true, stopTarget: true, duration: 2 });
  const r = rigAll(s.doc);
  r.engine.go(); r.engine.go();
  r.advance(1.9);
  assert.ok(r.audio.playing.has(s.id('a')));
  r.advance(0.2);
  assert.ok(!r.audio.playing.has(s.id('a')));
});

test('a paused rate fade waits, and goes on to the same rate', () => {
  const s = fadeShow({ rate: 3, keepLevel: true, duration: 2 });
  const r = rigAll(s.doc);
  r.engine.setDuration('a.wav', 60);
  r.engine.go(); r.engine.go();
  r.advance(1);
  r.engine.pause(); r.advance(10);
  const held = r.engine.positionOf(r.engine.running.get(s.id('a'))!);
  near(held, 1.5, 1e-6);
  r.engine.resume();
  assert.deepEqual(r.rates.at(-1)!.slice(0, 2), [s.id('a'), 3]); near(r.rates.at(-1)![2], 1);
  r.advance(1);
  near(r.engine.positionOf(r.engine.running.get(s.id('a'))!), 4, 1e-6);
  assert.equal(r.engine.running.get(s.id('a'))!.rate, 3);
});

// ── absolute and relative, and putting a fade back ────────────────────────────
test('an absolute fade is the last word: a dip still held in the voice band is let go with it', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', file: 'a.wav', gainDb: -6 } },
    { op: 'cue.add', ref: 'duck', cue: { type: 'fade', target: '@a', db: -12, relative: true, range: 'voice', duration: 1 } },
    { op: 'cue.add', ref: 'abs', cue: { type: 'fade', target: '@a', db: -20, duration: 2 } },
    { op: 'cue.add', ref: 'rel', cue: { type: 'fade', target: '@a', db: -3, relative: true, duration: 2 } },
  ]);
  const r = rigAll(s.doc);
  r.engine.go(); r.engine.go();
  assert.deepEqual(r.fades.at(-1), [s.id('a'), -12, 1, 'voice']);
  r.advance(1.5);
  r.engine.go();
  assert.deepEqual(r.fades.slice(-2), [[s.id('a'), 0, 2, 'voice'], [s.id('a'), -20, 2]]);
  assert.equal(r.engine.running.get(s.id('a'))!.band, 0);
  // …and a relative one leaves a dip where it is
  const s2 = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', file: 'a.wav', gainDb: -6 } },
    { op: 'cue.add', ref: 'duck', cue: { type: 'fade', target: '@a', db: -12, relative: true, range: 'voice', duration: 1 } },
    { op: 'cue.add', ref: 'rel', cue: { type: 'fade', target: '@a', db: -3, relative: true, duration: 2 } },
  ]);
  const q = rigAll(s2.doc);
  q.engine.go(); q.engine.go(); q.advance(1.5); q.engine.go();
  assert.deepEqual(q.fades.at(-1), [s2.id('a'), -9, 2]);
  assert.equal(q.fades.filter((f) => f[3] === 'voice').length, 1);
});

test('revert fade puts the sound back as it was before the Fade cue, and calls the fade off', () => {
  const s = fadeShow({ db: -40, duration: 10, rate: 2 });
  const r = rigAll(s.doc);
  r.engine.go(); r.engine.go();
  r.advance(3);
  assert.equal(r.engine.revertFade(s.id('f')), 1);
  assert.deepEqual(r.fades.at(-1), [s.id('a'), -10, 0.5]);
  assert.deepEqual(r.rates.at(-1), [s.id('a'), 1, 0.5]);
  r.advance(20);
  const run = r.engine.running.get(s.id('a'))!;
  assert.equal(run.db, -10, 'the called-off fade never lands');
  assert.equal(run.rate, 1);
  assert.equal(r.engine.revertFade(s.id('f')), 0, 'once put back there is nothing more to revert');
});

test('revert fade cannot bring back a sound the fade has already stopped', () => {
  const s = fadeShow({ db: -60, duration: 1, stopTarget: true });
  const r = rigAll(s.doc);
  r.engine.go(); r.engine.go();
  r.advance(2);
  assert.equal(r.engine.revertFade(s.id('f')), 0);
});

test('revert fade puts back every sound of a group the fade moved', () => {
  const s = build([
    { op: 'cue.add', ref: 'g', cue: { type: 'group', children: [{ type: 'audio', ref: 'a', file: 'a.wav', gainDb: -3 }, { type: 'audio', ref: 'b', file: 'b.wav', gainDb: -9 }] } },
    { op: 'cue.add', ref: 'f', cue: { type: 'fade', target: '@g', db: -30, duration: 5 } },
  ]);
  const r = rigAll(s.doc);
  r.engine.go(); r.engine.go(); r.advance(6);
  assert.equal(r.engine.revertFade(s.id('f')), 2);
  r.advance(1);
  assert.equal(r.engine.running.get(s.id('a'))!.db, -3);
  assert.equal(r.engine.running.get(s.id('b'))!.db, -9);
});

// ── level limits ────────────────────────────────────────────────────────────
test('the show’s level limits hold every level a cue or a fade asks for', () => {
  assert.deepEqual(curves.cleanLimits({}), { min: -60, max: 12 });
  assert.deepEqual(curves.cleanLimits({ min: -40, max: 6 }), { min: -40, max: 6 });
  assert.equal(curves.limitDb(9, { min: -40, max: 6 }), 6);
  assert.equal(curves.limitDb(-45, { min: -40, max: 6 }), -60, 'at or below the minimum is silence');
  assert.equal(curves.limitDb(-12, { min: -40, max: 6 }), -12);
  const s = fadeShow({ db: 10, duration: 1 }, { gainDb: 8 });
  const r = rigAll(s.doc, { limits: { min: -40, max: 6 } });
  r.engine.go();
  assert.equal(r.audio.calls[0][2].gainDb, 6);
  r.engine.go();
  assert.equal(r.fades.at(-1)![1], 6);
  r.engine.trim(s.id('a'), 3);
  assert.equal(r.engine.running.get(s.id('a'))!.fade!.to, 6, 'a trim cannot push past the maximum either');
  const flagged = show.problems(applyOps(s.doc, [{ op: 'show.set', path: 'settings.audio.levels', value: { min: -40, max: 6 } }]).doc);
  assert.equal(flagged.filter((p) => /above this show’s maximum/.test(p.why)).length, 2);
});

test('a new show has the limits and the monitor feed in its settings, off and harmless', () => {
  const a = show.newShow().settings.audio;
  assert.deepEqual(a.levels, { min: -60, max: 12 });
  assert.deepEqual(a.monitor, { on: false, out: 3, db: -12 });
  const old = show.normalise({ format: show.FORMAT, version: 1, settings: { audio: { masterDb: -3 } }, lists: [] }).doc.settings.audio;
  assert.deepEqual(old.levels, { min: -60, max: 12 }, 'a show saved before they existed gets the defaults');
});

// ── one rate: a cue's own rate, a Fade's "rate to", and what waits on a place in the file ──
const A = (ref: string, more = {}): Op => ({ op: 'cue.add', ref, cue: { type: 'audio', file: `${ref}.wav`, ...more } });

test('a sound’s rate is its own, and a tempo changes neither its rate nor its pitch', () => {
  const s = build([A('both', { rate: 0.5 }), A('kept', { rate: 2, preservePitch: true }), A('tempo'), A('plain')]);
  for (const c of s.doc.lists[0].cues) if (c.id !== s.id('plain')) Object.assign(c, { tempo: { bpm: 100, first: 0, bar: 4 } });
  const r = rigAll(s.doc);
  for (const k of ['both', 'kept', 'tempo', 'plain']) { r.engine.setDuration(`${k}.wav`, 60); r.engine.fire(s.id(k)); }
  const played = (k: string) => r.audio.calls.filter((c) => c[0] === 'play' && c[1] === s.id(k)).pop()![2];
  near(played('both').rate!, 0.5); assert.equal(played('both').preservePitch, false);
  near(played('kept').rate!, 2); assert.equal(played('kept').preservePitch, true);
  assert.equal(played('tempo').rate, undefined, 'a tempo alone: at its own speed, told nothing of rates');
  assert.equal(played('plain').rate, undefined);
  r.advance(10);
  near(r.engine.positionOf(r.engine.running.get(s.id('both'))!), 5, 1e-6);
  // a Fade moves its rate: one rate op, with no time
  r.engine.fadeRate(s.id('both'), 1, 0, 'rate:test');
  near(r.engine.running.get(s.id('both'))!.rate!, 1);
  assert.deepEqual(r.rates.at(-1)!.slice(0, 1).concat(r.rates.at(-1)![2]), [s.id('both'), 0], 'one rate op, with no time');
  near(r.rates.at(-1)![1], 1);
});

test('a re-pitched sound at a rate can be held in a section; one that keeps its pitch cannot', () => {
  const s = build([A('tape', { rate: 2 }), A('stretch', { rate: 2, preservePitch: true })]);
  const r = rigAll(s.doc);
  r.engine.setDuration('tape.wav', 60); r.engine.setDuration('stretch.wav', 60);
  r.engine.go(); r.engine.setExact(s.id('tape'), true);
  r.advance(2.5);                                       // 5 s into its file
  assert.ok(r.engine.toggleHold(s.id('tape'), { start: 4, end: 8 }, true), 'held');
  r.advance(2.5);                                       // 10 s played through: once round 4–8, so at 6
  near(r.engine.positionOf(r.engine.running.get(s.id('tape'))!), 6, 0.01);
  r.engine.go();
  assert.equal(r.engine.toggleHold(s.id('stretch'), { start: 4, end: 8 }, true), null);
  assert.ok(r.logs.some((l) => /with its pitch kept: it cannot be/.test(l)));
});

test('a Devamp that starts the next cue as the loop ends counts the loop’s end at the sound’s rate', () => {
  const s = build([
    A('track', { rate: 2, loops: [{ start: 10, end: 18, hold: true }] }),
    { op: 'cue.add', ref: 'out', cue: { type: 'devamp', target: '@track', startNext: true } },
    A('hit'),
  ]);
  const r = rigAll(s.doc);
  r.engine.setDuration('track.wav', 60);
  r.engine.go(); r.engine.setExact(s.id('track'), true);
  r.advance(7.5);                                       // 15 s of file: 5 s into the section, 3 s of file from its end
  near(r.engine.positionOf(r.engine.running.get(s.id('track'))!), 15, 0.01);
  r.engine.go();
  const w = r.engine.active().find((a) => a.id === s.id('hit'));
  assert.ok(w && Math.abs(w.total - 1.5) < 0.01, `1.5 s of the clock to the section's end at twice the speed (${w && w.total})`);
  r.advance(1.4); assert.ok(!r.audio.playing.has(s.id('hit')));
  r.advance(0.2); assert.ok(r.audio.playing.has(s.id('hit')));
});

test('a Fade’s “rate to” does not re-time a video (its picture would not follow); its level still moves', () => {
  const s = build([
    { op: 'cue.add', ref: 'v', cue: { type: 'video', file: 'media/film.mp4' } },
    { op: 'cue.add', ref: 'f', cue: { type: 'fade', target: '@v', db: -10, duration: 2, rate: 2 } },
  ]);
  const r = rigAll(s.doc);
  r.engine.setDuration('media/film.mp4', 30);
  r.engine.go(); r.engine.go();
  assert.equal(r.rates.length, 0);
  assert.equal(r.engine.rateOf(r.engine.running.get(s.id('v'))!), 1);
  assert.deepEqual(r.fades.at(-1)!.slice(0, 3), [s.id('v'), -10, 2]);
});
