import test from 'node:test';
import assert from 'node:assert/strict';
import * as midi from '../core/net/midi';
import * as show from '../core/show/show';
import { rig, build } from './helpers';

test('pitch bend, key pressure and channel pressure, as text and as bytes', () => {
  const bytes = (t: string) => midi.encode(midi.parseText(t));
  assert.deepEqual(bytes('bend 8192'), [0xe0, 0x00, 0x40]);                 // no bend: the low seven bits first
  assert.deepEqual(bytes('pitch bend 16383 ch 16'), [0xef, 0x7f, 0x7f]);
  assert.deepEqual(bytes('bend 1 ch 2'), [0xe1, 0x01, 0x00]);
  assert.deepEqual(bytes('key pressure 60 100 ch 2'), [0xa1, 60, 100]);
  assert.deepEqual(bytes('pressure 100'), [0xd0, 100]);
  assert.deepEqual(bytes('channel pressure 0 ch 10'), [0xd9, 0]);
  for (const t of ['bend 8192 ch 1', 'bend 0 ch 3', 'key pressure 60 100 ch 2', 'pressure 100 ch 1']) assert.equal(midi.toText(midi.decode(bytes(t))), t);
  for (const t of ['bend', 'bend 16384', 'pressure 128', 'pressure 1 2', 'key pressure 60', 'key pressure 60 200']) assert.throws(() => midi.encode(midi.parseText(t)), () => true, t);
  // as triggers: what is left out matches anything
  const hit = (trigger: string, b: number[]) => midi.matches(midi.parseText(trigger), midi.decode(b));
  assert.ok(hit('key pressure 60', [0xa3, 60, 5]));
  assert.ok(!hit('key pressure 60 ch 1', [0xa3, 60, 5]));
  assert.ok(hit('pressure 100', [0xd0, 100]) && !hit('pressure 100', [0xd0, 99]));
});

test('MIDI Show Control: LOAD, and a timed GO with its time before the cue number', () => {
  assert.deepEqual(midi.encode(midi.parseText('msc load 7')), [0xf0, 0x7f, 0x7f, 0x02, 0x01, 0x05, 0x37, 0xf7]);
  // TIMED_GO is 04: hours, minutes, seconds, frames, fractions, then the cue number and list as GO has them
  const b = midi.encode(midi.parseText('msc timed go 12 list 2 time 00:00:05:00 dev 1'));
  assert.deepEqual(b, [0xf0, 0x7f, 0x01, 0x02, 0x01, 0x04, 0, 0, 5, 0, 0, 0x31, 0x32, 0x00, 0x32, 0xf7]);
  const back = midi.decode(b)!;
  assert.deepEqual([back.command, back.cue, back.list, back.time, back.device], ['timed-go', '12', '2', '0:0:5:0', 1]);
  assert.equal(midi.toText(back), 'msc timed-go 12 list 2 time 00:00:05:00 dev 1');
  assert.deepEqual(midi.encode(midi.parseText('msc timed-go')), [0xf0, 0x7f, 0x7f, 0x02, 0x01, 0x04, 0, 0, 0, 0, 0, 0xf7]);
  assert.equal(midi.decode(midi.encode(midi.parseText('msc timed-go 3')))!.cue, '3');
  assert.throws(() => midi.parseText('msc go 1 time 00:00:05:00'), /only a timed go/);
});

test('a MIDI cue fades a controller: every whole value on the way, once, landing on the last', () => {
  const sent: (string | undefined)[] = [];
  const { doc } = build([{ op: 'cue.add', cue: { type: 'midi', number: '1', midi: 'cc 7 100 ch 2', fadeTo: 90, duration: 2 } }]);
  const r = rig(doc, { midi: (cue) => sent.push(cue.midi) });
  r.engine.go();
  assert.deepEqual(sent, ['cc 7 100 ch 2']);
  assert.ok(r.engine.active().some((a) => a.kind === 'fade'));           // it is a fade: in Active Cues while it runs
  r.advance(1);
  assert.equal(sent.at(-1), 'cc 7 95 ch 2');
  r.advance(1.1);
  assert.deepEqual(sent, [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90].map((v) => `cc 7 ${v} ch 2`));
  assert.equal(r.engine.active().length, 0);
});

test('…a pitch bend up through its fourteen bits, held by a pause and ended by a stop', () => {
  const sent: (number | undefined)[] = [];
  const { doc, id } = build([{ op: 'cue.add', ref: 'b', cue: { type: 'midi', midi: 'bend 8192', fadeTo: 16383, duration: 1 } },
    { op: 'cue.add', cue: { type: 'midi', midi: 'note 60 100', fadeTo: 0, duration: 1 } }]);
  assert.ok(show.problems(doc).some((p) => /only a controller, pressure or pitch bend can fade/.test(p.why)));
  const r = rig(doc, { midi: (cue) => sent.push(midi.parseText(cue.midi).value) });
  r.engine.go();
  r.advance(0.5);
  const half = sent.at(-1)!;
  assert.ok(half > 12000 && half < 12600 && sent.length >= 15, `half way: ${half} after ${sent.length} messages`);
  r.engine.pause();
  r.advance(5);
  assert.equal(sent.at(-1), half);
  r.engine.resume();
  r.advance(0.2);
  assert.ok(sent.at(-1)! > half && sent.at(-1)! < 16383);
  r.engine.stopCue(id('b'));
  const n = sent.length;
  r.advance(2);
  assert.equal(sent.length, n);
  // a note has no value to fade: the second cue sends its note and nothing more
  r.engine.go();
  assert.equal(sent.length, n + 1);
});

test('a Timecode cue and a MIDI File cue are the host’s to play: started with where to start, live for their length, held and stopped as fades are', () => {
  const calls: [string, number][] = [];
  const { doc, id } = build([
    { op: 'cue.add', ref: 't', cue: { type: 'timecode', number: '1', timecode: '01:00:00:00', duration: 10, continue: 'auto-follow' } },
    { op: 'cue.add', ref: 'm', cue: { type: 'midifile', number: '2', file: 'media/song.mid', rate: 2 } },
    { op: 'cue.add', ref: 'u', cue: { type: 'timecode', number: '3' } },
  ]);
  assert.deepEqual(show.problems(doc), []);
  const r = rig(doc, { run: (cue, offset) => { calls.push([cue.number!, offset]); return cue.type === 'midifile' ? 4 : Number(cue.duration) || 0; } });
  r.engine.setDuration('media/song.mid', 8);
  assert.equal(r.engine.lengthOf(id('m')), 4);                             // eight seconds at twice the speed
  r.engine.go();
  assert.deepEqual(calls, [['1', 0]]);
  const entry = () => r.engine.fades.get(id('t'))!;
  assert.deepEqual([entry().run, entry().total, entry().startedAt], ['timecode', 10, 0]);
  assert.deepEqual(r.engine.active().map((a) => [(a as { run?: string }).run, a.total]), [['timecode', 10]]);
  r.advance(4);
  r.engine.pause();
  r.advance(100);
  assert.equal(entry().pausedAt, 4);
  r.engine.resume();
  assert.equal(entry().startedAt, 100);                                     // where it is: now − startedAt = 4 s, as when it was held
  r.advance(5.9);
  assert.ok(entry());
  r.advance(0.2);                                                           // its ten seconds are up: gone, and the auto-follow fires the MIDI file
  assert.equal(entry(), undefined);
  assert.deepEqual(calls.at(-1), ['2', 0]);
  r.advance(3.8); assert.ok(r.engine.fades.has(id('m')));
  r.advance(0.2); assert.ok(!r.engine.fades.has(id('m')));
  // with no length it runs until it is stopped; Esc stops it
  r.engine.fire(id('u'));
  r.advance(3600);
  assert.ok(r.engine.fades.has(id('u')) && r.engine.isLive(id('u')));
  r.engine.pause(); r.engine.resume(); r.advance(1);
  assert.ok(r.engine.fades.has(id('u')));
  r.engine.panic();
  assert.ok(!r.engine.fades.has(id('u')));
  // loaded to a time: the host is told how far in, and the cue has that much less to run
  r.engine.fire(id('t'), 7);
  assert.deepEqual(calls.at(-1), ['1', 7]);
  r.advance(2.9); assert.ok(entry());
  r.advance(0.2); assert.equal(entry(), undefined);
  // a start that is not a timecode is an error on the cue
  const bad = build([{ op: 'cue.add', cue: { type: 'timecode', timecode: '01:00:00:27', fps: '25' } }]);
  assert.match(show.problems(bad.doc)[0].why, /no frame 27 at 25/);
});
