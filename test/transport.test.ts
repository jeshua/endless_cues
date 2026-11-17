import test from 'node:test';
import assert from 'node:assert/strict';
import { rig, build } from './helpers';
import * as tc from '../core/timecode/timecode';
import { createTransport } from '../core/timecode/transport';
import type { ChaseSettings, LtcCmd, TransportRecord } from '../core/timecode/transport';
import type { PlayoutMessage } from '../core/net/playout';
import type { Op } from '../core/show/ops';

/** The transport on the engine's fake clock: its 20 ms tick is advanced by hand, with the engine's timers. */
function desk(ops: Op[], { settings = { source: 'mtc', rate: '25' }, files = {}, midiWhyNot = () => '' }: { settings?: ChaseSettings; files?: Record<string, Buffer>; midiWhyNot?: () => string } = {}) {
  const b = build(ops);
  const sent: PlayoutMessage[] = [], audio: LtcCmd[] = [], record: TransportRecord[] = [], notices: string[] = [];
  let t: ReturnType<typeof createTransport> | null = null, ticking = false;
  const r = rig(b.doc, { run: (cue, offset) => t!.run(cue, offset) });
  t = createTransport({
    engine: r.engine, now: r.now, every: () => { ticking = true; return () => { ticking = false; }; }, soon: () => {},
    sendMidi: (ev) => sent.push(...ev), audio: (c) => audio.push(c), record: (e) => record.push(e), notice: (x) => notices.push(x),
    read: (file) => { if (!files[file]) throw new Error('ENOENT'); return files[file]; }, midiWhyNot, settings: () => settings,
  });
  t.configure(b.doc);
  const advance = (secs: number) => { for (let left = secs; left > 1e-9; left -= 0.02) { r.advance(Math.min(0.02, left)); if (ticking) t.tick(); } };
  return { ...r, ...b, t, sent, audio, audio2: r.audio, record, notices, advance, ticking: () => ticking };
}

test('a Timecode cue as MTC: the time on the wire is the time the cue has run, through a pause, until it is stopped', () => {
  const d = desk([{ op: 'cue.add', ref: 't', cue: { type: 'timecode', number: '1', timecode: '00:59:59:00', fps: '25' } }]);
  d.engine.go();
  d.advance(2);
  assert.equal(d.t.status().out[0].text, '01:00:01:00');
  assert.deepEqual(d.sent[0].bytes, tc.fullFrame(tc.parse('00:59:59:00')!, '25'));
  const quarters = d.sent.filter((e) => e.bytes[0] === 0xf1);
  quarters.forEach((e, i) => assert.ok(Math.abs(e.at - i / 100) < 1e-9));
  assert.ok(quarters.length >= 200 && quarters.length <= 211);                 // two seconds, and up to a tenth of one handed over ahead
  d.engine.pause();
  d.advance(5);
  const n = d.sent.length;
  d.advance(5);
  assert.equal(d.sent.length, n);
  assert.deepEqual([d.t.status().out[0].text, d.t.status().out[0].paused], ['01:00:01:00', true]);
  d.engine.resume();
  d.advance(0.02);
  assert.deepEqual(d.sent[n].bytes, tc.fullFrame(tc.parse('01:00:01:00')!, '25'));     // where it is, said outright, then on from there
  assert.ok(d.sent[n + 1].at >= 12.02 - 1e-9 && d.sent[n + 1].at < 12.031);                  // (the first look after the resume was at 12.02)
  d.engine.panic();
  d.advance(0.1);
  assert.deepEqual(d.t.status().out, []);
  assert.equal(d.ticking(), false);                                              // nothing running: nothing ticking
  assert.match(d.record[0].text, /^MTC from 00:59:59:00 at 25 fps$/);
});

test('a Timecode cue as LTC: the audio window is told where the timecode is and when to stop', () => {
  const d = desk([{ op: 'cue.add', ref: 't', cue: { type: 'timecode', timecode: '01:00:00:00', fps: '30', output: 'ltc', channel: 3, gainDb: -6, duration: 4 } }]);
  d.engine.go();
  d.advance(1);
  assert.deepEqual(d.audio, [{ op: 'ltc', key: d.id('t'), on: true, rate: '30', frames: 108000 + 0.6, at: 0.02, channel: 3, db: -6 }].map((c) => ({ ...c, frames: d.audio[0].frames })));
  assert.ok(Math.abs(d.audio[0].frames! - (108000 + 0.02 * 30)) < 1e-6);        // …at the moment it was told
  assert.equal(d.sent.length, 0);
  d.engine.pause(); d.advance(1);
  assert.deepEqual(d.audio[1], { op: 'ltc', key: d.id('t'), on: false });
  d.engine.resume(); d.advance(0.5);
  assert.ok(d.audio[2].on && Math.abs(d.audio[2].frames! - (108000 + 30 * (d.audio[2].at! - 1))) < 1e-6);     // a second was spent held
  d.advance(3);                                                                  // its four seconds are up
  assert.deepEqual(d.audio.at(-1), { op: 'ltc', key: d.id('t'), on: false });
  assert.equal(d.audio.length, 4);
});

test('what cannot start says why, and is not left running', () => {
  const d = desk([{ op: 'cue.add', ref: 'm', cue: { type: 'midifile', number: '5', file: 'media/gone.mid' } }, { op: 'cue.add', ref: 't', cue: { type: 'timecode' } }], { midiWhyNot: () => 'no MIDI output on this computer' });
  d.engine.go();
  assert.match(d.notices[0], /^5 · gone did not start: its file is missing$/);
  d.engine.go();
  assert.match(d.notices[1], /no MIDI output on this computer/);
  assert.equal(d.engine.active().length, 0);
  assert.deepEqual(d.record.map((e) => e.ok), [false, false]);
  assert.equal(d.t.lengthOf('media/gone.mid'), 0);
});

test('chasing MTC: cues start as their times pass, a located time starts a cue part way in, and the playhead follows', () => {
  const d = desk([
    { op: 'cue.add', ref: 'a', cue: { type: 'wait', number: '1', duration: 10, timecodeTrigger: '01:00:01:00' } },
    { op: 'cue.add', ref: 'b', cue: { type: 'audio', number: '2', file: 'media/song.wav', timecodeTrigger: '01:00:20:00' } },
    { op: 'cue.add', ref: 'c', cue: { type: 'memo', number: '3' } },
  ]);
  const start = tc.toFrames(tc.parse('01:00:00:00')!, '25');
  const feed = (from: number, t0: number, t1: number) => { const base = d.now() - t0; for (const e of tc.mtcBetween(from, '25', t0, t1)) { d.advance(Math.max(0, base + e.at - d.now())); d.t.midiIn(e.bytes, d.now()); } };
  // MTC nobody is chasing is still swallowed (it is not a trigger or show control)
  assert.equal(d.t.midiIn([0x90, 60, 100]), false);
  assert.equal(d.t.midiIn(tc.fullFrame(tc.parse('01:00:00:00')!, '25')), true);
  assert.deepEqual([d.t.status().in!.text, d.t.status().in!.running], ['01:00:00:00', false]);     // located, not running: nothing starts
  feed(start, 0, 0.5);
  assert.equal(d.t.status().in!.running, true);
  assert.equal(d.engine.playhead, d.id('a'));                                    // the next cue the timecode will start
  assert.equal(d.engine.active().length, 0);
  feed(start, 0.5, 1.2);
  assert.deepEqual(d.engine.active().map((a) => a.number), ['1']);
  assert.equal(d.engine.playhead, d.id('b'));
  // the timecode stops: seen within a third of a second; what was started plays on
  d.advance(0.4);
  assert.equal(d.t.status().in!.running, false);
  assert.equal(d.engine.active().length, 1);
  // it comes back at 01:00:25:00: cue 2 began five seconds ago, so it starts five seconds in
  d.engine.panic();
  d.engine.setDuration('media/song.wav', 30);                                    // (its length became known after the show was read, as files' do)
  feed(tc.toFrames(tc.parse('01:00:25:00')!, '25'), 0, 0.3);
  const play = d.audio2.calls.find((c) => c[0] === 'play');
  assert.ok(play && Math.abs(play[2].from - 5) < 0.1, JSON.stringify(d.audio2.calls));
  // not chasing: nothing fires
  const off = desk([{ op: 'cue.add', cue: { type: 'wait', duration: 5, timecodeTrigger: '01:00:00:02' } }], { settings: { source: 'off' } });
  for (const e of tc.mtcBetween(start, '25', 0, 1)) assert.equal(off.t.midiIn(e.bytes, e.at), true);
  assert.equal(off.engine.active().length, 0);
  assert.equal(off.t.status().in, null);
});

test('chasing LTC: each frame heard is the frame that just went by', () => {
  const d = desk([{ op: 'cue.add', cue: { type: 'wait', number: '9', duration: 3, timecodeTrigger: '00:00:02:00' } }], { settings: { source: 'ltc', rate: '30', catchUp: false, follow: false } });
  for (let f = 30; f < 75; f++) { d.advance(1 / 30); d.t.ltcIn({ tc: tc.fromFrames(f, '30'), rate: '30' }, d.now()); if (f === 58) assert.equal(d.engine.active().length, 0); if (f === 59) assert.deepEqual(d.engine.active().map((a) => a.number), ['9']); }
  assert.equal(d.t.status().in!.text, '00:00:02:15');
  assert.equal(d.engine.playhead, d.engine.steps()[0].id);                       // (follow is off: the playhead is left alone)
});
