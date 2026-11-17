// The knobs of the Sound design tab: how a setting turns (along a ratio for a frequency or a long time, along a
// line for a level or a mix), how it is shown and typed, and the response curves drawn on a filter or an eq.
// app/renderer/dial.js is a module of the window with no imports; it is loaded here as it is there.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Chain = require('../core/audio/chain');

let D;
test.before(async () => {
  const src = fs.readFileSync(path.join(__dirname, '../app/renderer/dial.js'), 'utf8');
  D = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
});
const param = (tool, key) => Chain.TOOLS.find((t) => t.key === tool).params.find((p) => p.key === key);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);

test('a frequency turns along a ratio: halfway round 20 Hz to 20 kHz is 632 Hz, and each octave is the same turn', () => {
  const hz = param('highpass', 'hz');
  assert.strictEqual(D.scaleOf(hz).kind, 'log');
  assert.strictEqual(D.fromPos(hz, 0), 20);
  assert.strictEqual(D.fromPos(hz, 1), 20000);
  assert.strictEqual(D.fromPos(hz, 0.5), 632);
  near(D.toPos(hz, 200) - D.toPos(hz, 100), D.toPos(hz, 2000) - D.toPos(hz, 1000), 1e-9, 'an octave low and an octave high');
  for (const v of [20, 80, 440, 3200, 20000]) near(D.fromPos(hz, D.toPos(hz, v)), v, v * 0.002, `${v} Hz there and back`);
});

test('a level, a mix and a pitch turn along a line; a gain turns either side of 0 dB', () => {
  const thr = param('comp', 'threshold'), mix = param('reverb', 'mix'), st = param('pitch', 'semitones'), mk = param('comp', 'makeup');
  assert.strictEqual(D.scaleOf(thr).kind, 'lin');
  assert.strictEqual(D.fromPos(thr, 0.5), -30);
  assert.strictEqual(D.fromPos(mix, 0.25), 0.25);
  assert.strictEqual(D.fromPos(st, 0.5), 0);
  assert.strictEqual(D.fromPos(st, 0.52), 0, 'a semitone knob lands on whole semitones');
  assert.strictEqual(D.fromPos(st, 0.75), 6);
  assert.strictEqual(D.scaleOf(mk).origin, 0, 'make-up: the arc starts at 0 dB');
  assert.strictEqual(D.scaleOf(thr).origin, -60, 'a threshold: the arc starts at the bottom');
  assert.strictEqual(D.fromPos(param('crush', 'bits'), 0.5), 9, 'bits are whole');
});

test('a time that starts at nothing turns slowly at the short end; a ratio and a long time along a ratio', () => {
  const hold = param('gate', 'hold');
  assert.strictEqual(D.scaleOf(hold).kind, 'sq');
  assert.strictEqual(D.fromPos(hold, 0.5), 500);
  assert.strictEqual(D.scaleOf(param('comp', 'ratio')).kind, 'log');
  assert.strictEqual(D.scaleOf(param('comp', 'release')).kind, 'log');
  assert.strictEqual(D.scaleOf(param('reverb', 'decay')).kind, 'log');
});

test('a turn rounds as a hand would want it, finer with Shift, and never leaves the range', () => {
  const hz = param('lowpass', 'hz'), thr = param('gate', 'threshold');
  assert.strictEqual(D.quantize(hz, 1234.567), 1230);
  assert.strictEqual(D.quantize(hz, 1234.567, true), 1235);
  assert.strictEqual(D.quantize(hz, 33.333), 33.3);
  assert.strictEqual(D.quantize(thr, -17.77), -18);
  assert.strictEqual(D.quantize(thr, -17.77, true), -17.8);
  assert.strictEqual(D.fromPos(hz, 1.4), 20000);
  assert.strictEqual(D.fromPos(hz, -1), 20);
  for (const t of Chain.TOOLS) for (const p of t.params.filter((x) => x.min !== undefined)) {
    for (const pos of [0, 0.13, 0.5, 0.77, 1]) { const v = D.fromPos(p, pos); assert.ok(v >= p.min && v <= p.max, `${t.key}.${p.key} at ${pos}: ${v}`); }
  }
});

test('a value is shown in the units a sound engineer reads', () => {
  const show = (p, v) => { const f = D.format(p, v); return `${f.text}${f.unit ? ` ${f.unit}` : ''}`; };
  assert.strictEqual(show(param('lowpass', 'hz'), 3200), '3.2 kHz');
  assert.strictEqual(show(param('lowpass', 'hz'), 12500), '12.5 kHz');
  assert.strictEqual(show(param('highpass', 'hz'), 80), '80 Hz');
  assert.strictEqual(show(param('comp', 'threshold'), -18), '−18 dB');
  assert.strictEqual(show(param('comp', 'makeup'), 2.5), '+2.5 dB');
  assert.strictEqual(show(param('comp', 'ratio'), 3), '3:1');
  assert.strictEqual(show(param('reverb', 'mix'), 0.25), '25 %');
  assert.strictEqual(show(param('stereo', 'width'), 1.5), '150 %');
  assert.strictEqual(show(param('delay', 'time'), 0.35), '350 ms');
  assert.strictEqual(show(param('delay', 'time'), 1.25), '1.25 s');
  assert.strictEqual(show(param('pitch', 'semitones'), -5), '−5 st');
  assert.strictEqual(show(param('gate', 'attack'), 2), '2 ms');
});

test('a value typed into a knob takes the units it is shown in', () => {
  const hz = param('lowpass', 'hz'), mix = param('reverb', 'mix'), time = param('delay', 'time'), mk = param('comp', 'makeup');
  assert.strictEqual(D.parseTyped(hz, '1.8k'), 1800);
  assert.strictEqual(D.parseTyped(hz, '1.8 kHz'), 1800);
  assert.strictEqual(D.parseTyped(hz, '440 Hz'), 440);
  assert.strictEqual(D.parseTyped(mix, '30%'), 0.3);
  assert.strictEqual(D.parseTyped(mix, '30'), 0.3, 'a share typed as a whole number is a percentage');
  assert.strictEqual(D.parseTyped(mix, '0.4'), 0.4);
  assert.strictEqual(D.parseTyped(time, '350 ms'), 0.35);
  assert.strictEqual(D.parseTyped(mk, '−6 dB'), -6);
  assert.strictEqual(D.parseTyped(mk, '99'), 24, 'clamped to the range');
  assert.strictEqual(D.parseTyped(param('comp', 'ratio'), '4:1'), 4);
  assert.strictEqual(D.parseTyped(hz, 'loud'), null);
  assert.strictEqual(D.parseTyped(hz, ''), null);
});

test('the curves: a filter is 3 dB down at its frequency and falls at its slope; a bell and a shelf reach their gain', () => {
  near(D.filterDb('lowpass', 1000, 12, 1000), -3.01, 0.02, '12 dB/oct low-pass at its corner');
  near(D.filterDb('lowpass', 1000, 24, 1000), -3.01, 0.02, '24 dB/oct low-pass at its corner (Butterworth)');
  near(D.filterDb('lowpass', 1000, 24, 8000) - D.filterDb('lowpass', 1000, 24, 4000), -24, 0.5, 'an octave further: 24 dB down');
  near(D.filterDb('highpass', 100, 48, 50), -48, 1.5, 'a 48 dB/oct high-pass an octave under');
  near(D.filterDb('highpass', 100, 12, 10000), 0, 0.01, 'far above a high-pass: nothing');
  near(D.sectionDb('peaking', 1000, 0.8, 6, 1000), 6, 0.01, 'a bell at its centre');
  near(D.sectionDb('peaking', 1000, 0.8, -6, 20), 0, 0.1, 'a bell far from its centre');
  near(D.sectionDb('lowshelf', 250, 0, 6, 20), 6, 0.1, 'a low shelf far under its corner');
  near(D.sectionDb('lowshelf', 250, 0, 6, 20000), 0, 0.01, 'a low shelf far over it');
  near(D.sectionDb('highshelf', 4000, 0, -6, 20000), -6, 0.1, 'a high shelf far over its corner');
  near(D.eqDb([{ type: 'peaking', hz: 1000, q: 0.8, db: 4 }, { type: 'lowshelf', hz: 250, db: 0 }], 1000), 4, 0.01, 'a flat band adds nothing');
  const d = D.curvePath(() => 0, 120, 34, 12, -30, 4);
  assert.match(d, /^M0\.0 9\.7 L30\.0 9\.7 /, 'a flat curve is a line at 0 dB');
});
