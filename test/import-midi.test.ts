import test from 'node:test';
import assert from 'node:assert/strict';
import { midiText, timecodeOf } from '../core/import/qlab';
import * as midi from '../core/net/midi';

test('a QLab MIDI cue’s pressure and pitch bend come across as text this sends', () => {
  const voice = (status: number, byte1: number, byte2: number, more = {}) => midiText({ messageType: 1, status, byte1, byte2, channel: 1, ...more });
  assert.equal(voice(2, 60, 90), 'key pressure 60 90');
  assert.equal(voice(5, 77, 0, { channel: 3 }), 'pressure 77 ch 3');
  assert.equal(voice(6, 0, 64), 'bend 8192');                                    // two bytes, low then high
  assert.equal(voice(6, 0, 0, { byteCombo: 16383 }), 'bend 16383');              // or the one number, if the cue has it
  assert.equal(voice(6, 0, 0, { byteCombo: -8192 }), 'bend 0');                  // …written around zero
  assert.equal(voice(3, 7, 100), 'cc 7 100');
  for (const t of [voice(2, 60, 90), voice(5, 77, 0), voice(6, 0, 64)]) assert.doesNotThrow(() => midi.encode(midi.parseText(t)));
});

test('a QLab Timecode cue is read by its field names, and what could not be read is said', () => {
  assert.deepEqual(timecodeOf({ startTimecode: '10:00:00:00', outputType: 1, LTCChannel: 3, duration: 90, framerate: 25 }),
    { cue: { timecode: '10:00:00:00', fps: '25', output: 'ltc', channel: 3, duration: 90 }, unsure: [] });
  assert.deepEqual(timecodeOf({ startTimecode: { hours: 1, minutes: 2, seconds: 3, frames: 4 }, outputType: 0, smpteFormat: 29.97 }),
    { cue: { timecode: '01:02:03:04', fps: '29.97df', output: 'mtc' }, unsure: [] });
  // nothing it knows how to read: a cue as a new one is, and both things named
  assert.deepEqual(timecodeOf({ startTimecode: 3600 }), { cue: { timecode: '01:00:00:00', fps: '30', output: 'mtc' }, unsure: ['its start time', 'its frame rate'] });
  // a start the rate does not have (frame 27 at 25) is not kept
  assert.deepEqual(timecodeOf({ startTimecode: '00:00:01:27', framerate: 25 }).unsure, ['its start time']);
});
