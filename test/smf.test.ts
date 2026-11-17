import test from 'node:test';
import assert from 'node:assert/strict';
import * as smf from '../core/net/smf';
import { Playout, mtcSource } from '../core/net/playout';
import * as tc from '../core/timecode/timecode';

// A MIDI file, written out here byte by byte from the specification (not by the code under test).
const be = (n, bytes) => Array.from({ length: bytes }, (_, i) => (n >> (8 * (bytes - 1 - i))) & 0xff);
const chunk = (id, data) => [...Buffer.from(id), ...be(data.length, 4), ...data];
const file = (format, division, ...tracks) => Buffer.from([...chunk('MThd', [...be(format, 2), ...be(tracks.length, 2), ...be(division, 2)]), ...tracks.flatMap((t) => chunk('MTrk', t))]);
const END = [0x00, 0xff, 0x2f, 0x00];

test('a MIDI file: tempo, running status, a delta of two bytes, and two tracks laid into one', () => {
  const song = file(1, 480,
    // the tempo track: 120 to the minute, then 60 from beat 2 (tick 960)
    [0x00, 0xff, 0x03, 0x04, ...Buffer.from('Song'), 0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, 0x87, 0x40, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40, ...END],
    // notes: on at 0, off at tick 480 (a delta of two bytes: 83 60) by running status with velocity 0, on at tick 960, off at 1440
    [0x00, 0xc0, 0x05, 0x00, 0x90, 60, 100, 0x83, 0x60, 60, 0, 0x83, 0x60, 62, 90, 0x83, 0x60, 0x80, 62, 0, ...END]);
  const f = smf.parse(song);
  assert.deepEqual([f.format, f.tracks, f.ppq, f.name, f.notes], [1, 2, 480, 'Song', 2]);
  assert.deepEqual(f.tempos, [{ at: 0, bpm: 120 }, { at: 1, bpm: 60 }]);
  assert.deepEqual(f.events.map((e) => [e.at, ...e.bytes]), [[0, 0xc0, 5], [0, 0x90, 60, 100], [0.5, 0x90, 60, 0], [1, 0x90, 62, 90], [2, 0x80, 62, 0]]);
  assert.equal(f.seconds, 2);
});

test('a MIDI file timed in frames, with SysEx in it', () => {
  // 25 frames a second, 40 ticks a frame: a tick is a millisecond
  const f = smf.parse(file(0, ((256 - 25) << 8) | 40, [0x00, 0xf0, 0x05, 0x7e, 0x7f, 0x09, 0x01, 0xf7, 0x87, 0x68, 0xb0, 7, 100, ...END]));
  assert.deepEqual(f.smpte, { fps: 25, ticks: 40 });
  assert.deepEqual(f.events, [{ at: 0, bytes: [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7] }, { at: 1, bytes: [0xb0, 7, 100] }]);
});

test('what is not a MIDI file is refused with a reason', () => {
  assert.throws(() => smf.parse(Buffer.from('RIFF....WAVE....')), /not a MIDI file/);
  assert.throws(() => smf.parse(Buffer.alloc(0)), /not a MIDI file/);
  assert.throws(() => smf.parse(file(1, 480)), /no tracks/);
  assert.throws(() => smf.parse(file(0, 480, [0x00, 60, 100, ...END])), /damaged/);
});

const twoNotes = () => smf.parse(file(0, 480, [0x00, 0xc1, 9, 0x00, 0xb1, 7, 90, 0x00, 0x91, 60, 100, 0x8f, 0x00, 0x81, 60, 0, 0x00, 0x91, 64, 100, 0x8f, 0x00, 0x81, 64, 0, ...END]));   // a two-second note, then another

test('a MIDI file played out: handed over ahead of time, at a rate, paused, resumed and stopped without a note left on', () => {
  const stream = new smf.MidiFileStream(twoNotes(), { rate: 2 });      // twice as fast: each note lasts a second
  assert.equal(stream.total, 2);
  const p = new Playout({ lookahead: 0.1 });
  let st = { startedAt: 10, pausedAt: null };
  assert.deepEqual(p.start('a', stream, 10), []);
  const first = p.tick(10, () => st);
  assert.deepEqual(first.map((e) => [e.at, ...e.bytes]), [[10, 0xc1, 9], [10, 0xb1, 7, 90], [10, 0x91, 60, 100]]);
  assert.deepEqual(p.tick(10.5, () => st), []);
  // the note off at 11 s is handed over as soon as it is within the lookahead, stamped with its own time
  assert.deepEqual(p.tick(10.95, () => st).map((e) => [e.at, ...e.bytes]), [[11, 0x81, 60, 0], [11, 0x91, 64, 100]]);
  // paused at 11.4 with the second note sounding: it is ended, after anything already handed over
  st = { startedAt: 10, pausedAt: 11.4 };
  assert.deepEqual(p.tick(11.4, () => st).map((e) => [e.at, ...e.bytes]), [[11.4, 0x81, 64, 0]]);
  assert.deepEqual(p.tick(12, () => st), []);
  // resumed at 13 (the engine moves `startedAt` by the time held): the instrument is told the program and controller again
  st = { startedAt: 11.6, pausedAt: null };
  assert.deepEqual(p.tick(13, () => st).map((e) => [e.at, ...e.bytes]), [[13, 0xc1, 9], [13, 0xb1, 7, 90]]);
  // …and plays on to the last note off; then the engine drops it (it ran its length) and nothing more is owed
  assert.deepEqual(p.tick(13.55, () => st).map((e) => [e.at, ...e.bytes]), [[13.6, 0x81, 64, 0]]);
  assert.deepEqual(p.tick(13.7, () => null), []);
  assert.equal(p.size, 0);
});

test('stopped part way, or started again while playing: the notes sounding are ended', () => {
  const p = new Playout({ lookahead: 0.05 });
  p.start('a', new smf.MidiFileStream(twoNotes()), 0);
  p.tick(0, () => ({ startedAt: 0 }));
  assert.deepEqual(p.tick(0.5, () => null).map((e) => e.bytes), [[0x81, 60, 0]]);
  p.start('a', new smf.MidiFileStream(twoNotes()), 1);
  p.tick(1, () => ({ startedAt: 1 }));
  assert.deepEqual(p.start('a', new smf.MidiFileStream(twoNotes()), 1.2).map((e) => e.bytes), [[0x81, 60, 0]]);
});

test('MTC played out: a full frame where it starts, then every quarter frame once, stamped on its own time however late the ticks', () => {
  const start = tc.toFrames(tc.parse('01:00:00:00'), '25');
  const p = new Playout({ lookahead: 0.08 });
  p.start('t', mtcSource(tc, start, '25'), 100);
  const out = [];
  // a timer that wakes when it likes: 20 ms, then 3, then 47, then 31…
  let now = 100;
  for (const step of [0, 0.02, 0.003, 0.047, 0.031, 0.02, 0.02, 0.06, 0.011, ...new Array(60).fill(0.02)]) {
    now += step;
    out.push(...p.tick(now, () => ({ startedAt: 100 })));
  }
  assert.deepEqual(out[0], { id: 't', at: 100, bytes: tc.fullFrame(tc.parse('01:00:00:00'), '25') });
  const q = out.slice(1);
  q.forEach((e, i) => { assert.ok(Math.abs(e.at - (100 + i / 100)) < 1e-9, `quarter frame ${i} at ${e.at}`); assert.equal(e.bytes[1] >> 4, i % 8); });
  assert.ok(q.length >= 100 && q.at(-1).at <= now + 0.08);
  const reader = new tc.MtcReader();
  const heard = q.map((e) => reader.feed(e.bytes)).filter(Boolean);
  assert.deepEqual(heard[12].tc, { h: 1, m: 0, s: 0, f: 24 });
  assert.deepEqual(heard[13].tc, { h: 1, m: 0, s: 1, f: 1 });
  // paused and resumed two seconds in: a full frame says where it is, and the quarter frames go on from there
  p.tick(now + 0.02, () => ({ startedAt: 100, pausedAt: now }));
  const again = p.tick(110, () => ({ startedAt: 108 }));
  assert.deepEqual(again[0].bytes, tc.fullFrame(tc.parse('01:00:02:00'), '25'));
  assert.ok(Math.abs(again[1].at - 110) < 1e-9);
});
