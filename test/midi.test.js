const test = require('node:test');
const assert = require('node:assert/strict');
const midi = require('../core/net/midi');

test('MIDI as text and as bytes, both ways', () => {
  const bytes = (t) => midi.encode(midi.parseText(t));
  assert.deepEqual(bytes('note 60 100 ch 2'), [0x91, 60, 100]);
  assert.deepEqual(bytes('note 60'), [0x90, 60, 100]);
  assert.deepEqual(bytes('note off 60 ch2'), [0x81, 60, 0]);
  assert.deepEqual(bytes('pc 12'), [0xc0, 12]);
  assert.deepEqual(bytes('Program 5 ch 16'), [0xcf, 5]);
  assert.deepEqual(bytes('cc 7 100'), [0xb0, 7, 100]);
  assert.deepEqual(bytes('F0 7E 7F 06 01 F7'), [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]);
  for (const t of ['note 60 100 ch 2', 'note off 60 ch 1', 'pc 12 ch 1', 'cc 7 100 ch 3']) assert.equal(midi.toText(midi.decode(bytes(t))), t);
  assert.equal(midi.decode([0x90, 60, 0]).kind, 'noteoff');             // a note on at velocity 0 is a note off
});

test('MIDI Show Control: GO with a cue and a list, to one device or all', () => {
  const b = midi.encode(midi.parseText('msc go 12.5 list 1'));
  assert.deepEqual(b, [0xf0, 0x7f, 0x7f, 0x02, 0x01, 0x01, 0x31, 0x32, 0x2e, 0x35, 0x00, 0x31, 0xf7]);
  assert.deepEqual(midi.encode(midi.parseText('msc stop dev 3 sound')), [0xf0, 0x7f, 3, 0x02, 0x10, 0x02, 0xf7]);
  const back = midi.decode(b);
  assert.equal(back.command, 'go'); assert.equal(back.cue, '12.5'); assert.equal(back.list, '1');
  assert.equal(midi.toText(back), 'msc go 12.5 list 1');
});

test('what cannot be sent is refused with a reason', () => {
  for (const t of ['', 'note', 'note 200', 'pc 1 2', 'cc 7', 'msc', 'msc launch', 'F0 01 02', 'hello', 'note 60 ch 17']) {
    assert.throws(() => midi.encode(midi.parseText(t)), undefined, t);
  }
});

test('a MIDI trigger: what it leaves out matches anything', () => {
  const hit = (trigger, bytes) => midi.matches(midi.parseText(trigger), midi.decode(bytes));
  assert.ok(hit('note 60', [0x93, 60, 20]));
  assert.ok(!hit('note 60', [0x83, 60, 0]));                            // its note off does not fire it again
  assert.ok(!hit('note 60 ch 2', [0x93, 60, 20]));
  assert.ok(hit('cc 20', [0xb0, 20, 5]));
  assert.ok(!hit('cc 20 127', [0xb0, 20, 5]));
  assert.ok(hit('pc 5', [0xc4, 5]));
  assert.ok(hit('msc go 7', midi.encode(midi.parseText('msc go 7 list 2'))));
  assert.ok(!hit('msc go 7', midi.encode(midi.parseText('msc go 8'))));
  assert.equal(midi.toText(midi.decode([0x93, 60, 20]), { brief: true }), 'note 60 ch 4');
});
