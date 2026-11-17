/** The rescue tools the cue list's Playing strip uses: a loop from here with no region drawn, and a skip or a
 *  crossfade that leaves on the track's own bar line. */
import test from 'node:test';
import assert from 'node:assert';
import { rig, build } from './helpers';

// 120 bpm, four in a bar: a beat every 0.5 s, a bar line every 2 s
const track = (extra = {}) => build([{ op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'a.wav', tempo: { bpm: 120, first: 0, bar: 4 }, ...extra } }]);

test('a skip on the bar waits for the track’s own next bar line, then moves to the sample', () => {
  const s = track();
  const r = rig(s.doc);
  r.engine.setDuration('a.wav', 120);
  r.engine.go(); r.advance(4.6);
  const did = r.engine.moveOnGrid(s.id('a'), 60);
  assert.ok(did && Math.abs(did.at - 6) < 1e-6 && Math.abs(did.wait - 1.4) < 0.01, JSON.stringify(did));
  assert.ok(!r.audio.calls.some((c) => c[0] === 'move' || c[0] === 'seek'), 'nothing moves until the line is near');
  r.advance(1.0);
  assert.ok(Math.abs(r.engine.active()[0].elapsed - 5.6) < 0.01, 'the track plays on while it waits');
  r.advance(0.2);
  const mv = r.audio.calls.find((c) => c[0] === 'move');
  assert.ok(mv, 'handed to the audio backend a moment before the line');
  assert.equal(mv[2].sync.blend, 'cut');
  assert.ok(Math.abs(mv[2].sync.at + mv[2].sync.xf / 2 - 6) < 1e-6, 'it leaves at the bar line');
  assert.ok(Math.abs(mv[2].to + mv[2].sync.xf / 2 - 60) < 1e-6, 'and lands on the place asked for');
  r.advance(1.2);                                   // 7.0 s after the GO: one second past the line
  assert.ok(Math.abs(r.engine.active()[0].elapsed - 61) < 0.05, String(r.engine.active()[0].elapsed));
});

test('a crossfade on the bar is centred on the line; on the beat it is the next beat', () => {
  const s = track();
  const r = rig(s.doc);
  r.engine.setDuration('a.wav', 120);
  r.engine.go(); r.advance(4.6);
  const did = r.engine.moveOnGrid(s.id('a'), 30, { secs: 1 });
  assert.ok(Math.abs(did.at - 6) < 1e-6);
  r.advance(1.0);
  const mv = r.audio.calls.find((c) => c[0] === 'move');
  assert.equal(mv[2].sync.blend, 'fade');
  assert.equal(mv[2].sync.xf, 1);
  assert.ok(Math.abs(mv[2].sync.at - 5.5) < 1e-6 && Math.abs(mv[2].to - 29.5) < 1e-6, JSON.stringify(mv[2]));
  const s2 = track(), r2 = rig(s2.doc);
  r2.engine.setDuration('a.wav', 120);
  r2.engine.go(); r2.advance(4.6);
  assert.ok(Math.abs(r2.engine.moveOnGrid(s2.id('a'), 60, { grid: 'beats' }).at - 5) < 1e-6, 'the next beat far enough ahead to set up');
});

test('with no tempo, or paused, it goes now; stopped while it waits, nothing moves; asked twice, the last wins', () => {
  const plain = build([{ op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'a.wav' } }]);
  const r = rig(plain.doc);
  r.engine.setDuration('a.wav', 120);
  r.engine.go(); r.advance(3);
  assert.deepEqual(r.engine.moveOnGrid(plain.id('a'), 60), { wait: 0 });
  assert.deepEqual(r.audio.calls.at(-1).slice(0, 3), ['seek', plain.id('a'), 60]);

  const s = track(), q = rig(s.doc);
  q.engine.setDuration('a.wav', 120);
  q.engine.go(); q.advance(4.6);
  q.engine.moveOnGrid(s.id('a'), 60);
  q.engine.moveOnGrid(s.id('a'), 90);
  q.advance(3);
  const moves = q.audio.calls.filter((c) => c[0] === 'move');
  assert.equal(moves.length, 1);
  assert.ok(Math.abs(moves[0][2].to + moves[0][2].sync.xf / 2 - 90) < 1e-6);
  q.engine.moveOnGrid(s.id('a'), 10);
  q.engine.stopCue(s.id('a'));
  q.advance(5);
  assert.equal(q.audio.calls.filter((c) => c[0] === 'move').length, 1, 'a stopped track is not moved');
  assert.equal(q.engine.moveOnGrid(s.id('a'), 10), null);
  q.engine.go(); q.advance(1);
});

test('a loop from here needs no region drawn: it goes round until let go, and L lets go of it', () => {
  const s = track();
  const r = rig(s.doc);
  r.engine.setDuration('a.wav', 120);
  r.engine.go(); r.advance(4.6);
  r.engine.setExact(s.id('a'), true);
  // two bars from the beat the track is on (4.5 s)
  assert.equal(r.engine.toggleHold(s.id('a'), { start: 4.5, end: 8.5 }, true), 'armed');
  r.advance(6);                                     // 10.6 s of playing: once round (4 s), so at 6.6
  const a = r.engine.active()[0];
  assert.ok(a.holding && Math.abs(a.elapsed - 6.6) < 0.05, JSON.stringify([a.holding, a.elapsed]));
  assert.equal(r.engine.holdOrLetGo(s.id('a')), 'let go');
  r.advance(3);
  assert.ok(r.engine.active()[0].elapsed > 9.5 && !r.engine.active()[0].holding, 'it plays on out of the loop');
  // without the free flag a place that is not one of the cue's regions is refused
  assert.equal(r.engine.toggleHold(s.id('a'), { start: 20, end: 24 }), null);
});

test('a loop from here asked for before the sound is decoded, and decoded only after it has gone by, goes round where the track is then', () => {
  const s = track();
  const r = rig(s.doc);
  r.engine.setDuration('a.wav', 120);
  r.engine.go(); r.advance(4.6);
  // two seconds from here, armed while the sound still streams; decoding takes three seconds
  assert.equal(r.engine.toggleHold(s.id('a'), { start: 4.6, end: 6.6 }, true), 'armed');
  r.advance(3);
  r.engine.setExact(s.id('a'), true);
  let a = r.engine.active()[0];
  assert.ok(a.holding, `held, not left armed for ever: ${JSON.stringify([a.region, a.armed])}`);
  assert.deepEqual([a.region.start, a.region.end].map((x) => Math.round(x * 100) / 100), [6.6, 8.6], 'the next two seconds on from the stretch asked for: the one the track is in');
  r.advance(4);
  a = r.engine.active()[0];
  assert.ok(a.holding && a.elapsed >= 6.55 && a.elapsed < 8.65, JSON.stringify([a.holding, a.elapsed]));
  // a section of the show's own (not free), passed the same way, is dropped and said
  const t = track({ loops: [{ start: 4.5, end: 6.5 }] });
  const q = rig(t.doc);
  q.engine.setDuration('a.wav', 120);
  q.engine.go(); q.advance(4.6);
  assert.equal(q.engine.toggleHold(t.id('a'), { start: 4.5, end: 6.5 }), 'armed');
  q.advance(3);
  q.engine.setExact(t.id('a'), true);
  a = q.engine.active()[0];
  assert.ok(!a.holding && !(a.armed || []).length, JSON.stringify([a.region, a.armed]));
  assert.ok(q.logs.some((l) => /passed before the sound was ready to go round/.test(l)), 'said in the log');
});
