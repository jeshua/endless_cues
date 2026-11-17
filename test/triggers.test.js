const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('./helpers');
const { triggersOf, clockDue } = require('../core/show/triggers');
const { Chaser } = require('../core/timecode/chase');
const show = require('../core/show/show');
const { applyOps } = require('../core/show/ops');

test('every trigger in the show is one table, and what would be set off together is named', () => {
  const { doc } = build([
    { op: 'cue.add', cue: { type: 'memo', number: '1', name: 'Thunder', hotkey: 'shift+b', midiTrigger: 'note 60', oscTrigger: '/sm/thunder 1' } },
    { op: 'cue.add', cue: { type: 'memo', number: '2', name: 'Rain', hotkey: 'Shift + B', midiTrigger: 'note 60 ch 2', clockTrigger: '19:30 fri sat', timecodeTrigger: '01:00:10:00' } },
    { op: 'cue.add', cue: { type: 'group', number: '3', name: 'Scene', children: [] } },
    { op: 'cue.add', cue: { type: 'memo', number: '4', name: 'Bell', midiTrigger: 'note 61', oscTrigger: '/sm/thunder   1', clockTrigger: '19:30 sat', timecodeTrigger: '1:0:10:0' }, parent: '#3' },
    { op: 'cue.add', cue: { type: 'memo', number: '5', name: 'Odd', hotkey: 'q', midiTrigger: 'banana', clockTrigger: '19:30 mon', timecodeTrigger: '01:00:10:30' } },
    { op: 'show.set', path: 'settings.midi.commands.go', value: 'note 61 ch 1' },
    { op: 'show.set', path: 'settings.network.commands.panic', value: '/sm/thunder 1' },
  ]);
  const rows = triggersOf(doc);
  const row = (number, kind) => rows.find((r) => r.number === number && r.kind === kind);
  assert.equal(rows.length, 3 + 4 + 4 + 4 + 1 + 1);
  assert.deepEqual(row('1', 'hotkey').clash, ['2 · Rain']);
  assert.deepEqual(row('1', 'midi').clash, ['2 · Rain']);                 // "note 60" is also "note 60 ch 2"
  assert.deepEqual(row('1', 'osc').clash, ['4 · Bell', 'Panic']);                // (and an OSC message set to run the show)
  assert.deepEqual(row('4', 'midi').clash, ['GO']);                       // a cue's trigger is also the show's GO
  assert.deepEqual(rows.find((r) => r.what === 'GO').clash, ['4 · Bell']);
  assert.deepEqual(row('2', 'clock').clash, ['4 · Bell']);                // both on a Saturday
  assert.deepEqual(row('2', 'timecode').clash, ['4 · Bell']);
  assert.equal(row('4', 'timecode').list, 'Main');
  // what cannot work is said, and is not counted as a clash
  assert.match(row('5', 'hotkey').bad, /own keys/);
  assert.ok(row('5', 'midi').bad && row('5', 'timecode').bad);
  assert.deepEqual(row('5', 'clock').clash, []);
  // …and the show's own check names a timecode trigger that cannot be
  assert.ok(show.problems(doc).some((p) => /timecode trigger “01:00:10:30” cannot be used/.test(p.why)));
  // at 24 frames a second, frame 24 does not exist either
  const at24 = applyOps(doc, [{ op: 'show.set', path: 'settings.timecode.rate', value: '24' }, { op: 'cue.set', id: '#5', props: { timecodeTrigger: '01:00:10:24' } }]).doc;
  assert.match(triggersOf(at24).find((r) => r.number === '5' && r.kind === 'timecode').bad, /no frame 24/);
});

test('a clock trigger fires at its time, once, on its days, and not for a time that passed while the app was closed', () => {
  const { doc, id } = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'memo', number: '1', clockTrigger: '19:25' } },
    { op: 'cue.add', ref: 'b', cue: { type: 'memo', number: '2', clockTrigger: '19:25:30 fri sat' } },
    { op: 'cue.add', ref: 'c', cue: { type: 'memo', number: '3', clockTrigger: 'teatime' } },
  ]);
  const fired = new Set();
  const due = (date) => clockDue(doc, date, fired).map((c) => c.id);
  const fri = (h, m, s) => new Date(2030, 0, 4, h, m, s);                 // 4 January 2030 is a Friday
  assert.equal(fri(0, 0, 0).getDay(), 5);
  assert.deepEqual(due(fri(19, 24, 59)), []);
  assert.deepEqual(due(fri(19, 25, 0)), [id('a')]);
  assert.deepEqual(due(fri(19, 25, 1)), []);                              // once
  assert.deepEqual(due(fri(19, 25, 32)), [id('b')]);                      // a tick that came two seconds late still fires it
  assert.deepEqual(due(fri(19, 25, 33)), []);
  // the next day (the host empties `fired` when the date changes): a Saturday has both; a Sunday only the one with no days
  fired.clear();
  assert.deepEqual(due(new Date(2030, 0, 5, 19, 25, 30)), [id('b')]);     // (19:25 itself is 30 s past: not fired late)
  fired.clear();
  assert.deepEqual(due(new Date(2030, 0, 6, 19, 25, 2)), [id('a')]);
  assert.deepEqual(due(new Date(2030, 0, 6, 19, 25, 31)), []);
  // opened at 19:25:04, four seconds after: too late
  fired.clear();
  assert.deepEqual(due(fri(19, 25, 4)), []);
});

test('chasing timecode: a cue starts as its time is passed, and nothing skipped over by a jump is fired', () => {
  const c = new Chaser();
  c.set([{ id: 'b', frames: 300, length: 10 }, { id: 'a', frames: 100, length: 4 }, { id: 'c', frames: 1000, length: 0 }]);
  const real = 25;
  // timecode appears at frame 0 and runs: nothing yet
  assert.deepEqual(c.update(0, real, 0), []);
  assert.deepEqual(c.update(98, real, 98 / 25), []);
  assert.deepEqual(c.update(100, real, 4), [{ id: 'a', offset: 0 }]);
  assert.deepEqual(c.update(102, real, 102 / 25), []);                    // once
  assert.equal(c.next(102), 'b');
  // located to frame 500: `b` began 200 frames (8 s) ago and runs 10 s, so it starts 8 s in; `a` is long over
  assert.deepEqual(c.update(500, real, 5), [{ id: 'b', offset: 8 }]);
  // …or not at all, when catching up is off
  c.park();
  assert.deepEqual(c.update(500, real, 6, { catchUp: false }), []);
  // located backwards to just after `a`'s time (MTC is known two frames late): `a` starts from its top
  assert.deepEqual(c.update(101.75, real, 7), [{ id: 'a', offset: 0 }]);
  // a cue whose length is not known (a loop) is not started part way
  c.park();
  assert.deepEqual(c.update(1500, real, 8), []);
  assert.equal(c.next(1500), null);
  // stopped and started again on the very frame of a cue: it starts
  c.park();
  assert.deepEqual(c.update(300, real, 20), [{ id: 'b', offset: 0 }]);
});

test('chasing timecode heard in bursts (a busy computer): each cue starts once, though every burst looks like a jump', () => {
  const c = new Chaser();
  c.set([{ id: 'pc', frames: 20, length: 0 }]);
  const real = 29.97;
  assert.deepEqual(c.update(18, real, 0), []);
  // frames arrive late and together: each update is further than a quarter second from where the time should be
  assert.deepEqual(c.update(21, real, 0.9), [{ id: 'pc', offset: 0 }]);
  assert.deepEqual(c.update(22, real, 0.91), []);
  assert.deepEqual(c.update(23, real, 1.6), []);
  // a real locate back before it still starts it again
  assert.deepEqual(c.update(20.5, real, 2), [{ id: 'pc', offset: 0 }]);
});
