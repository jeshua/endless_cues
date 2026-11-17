// Finding a tempo: on made tracks whose tempo is known, and on ones that have none.
const test = require('node:test');
const assert = require('node:assert');
const { tempoOf, gridOf, cleanTempo, MIN_CONFIDENCE } = require('../core/audio/tempo');
const { rig, build } = require('./helpers');

const RATE = 11025, TAU = Math.PI * 2;
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const make = (secs, fn) => { const x = new Float32Array(secs * RATE); for (let i = 0; i < x.length; i++) x[i] = fn(i / RATE); return x; };
const kick = (t, bpm, off = 0) => { const b = 60 / bpm, p = (((t - off) % b) + b) % b; return Math.exp(-p / 0.05) * Math.sin(TAU * 60 * p) * 0.8; };
const hat = (t, bpm, off = 0) => { const b = 30 / bpm, p = (((t - off) % b) + b) % b; return Math.exp(-p / 0.01) * rnd() * 0.25; };
const hits = (times, secs) => { const x = new Float32Array(secs * RATE); for (const t of times) { const a = Math.floor(t * RATE); for (let i = 0; i < 2000 && a + i < x.length; i++) x[a + i] += Math.exp(-i / 500) * Math.sin(i / 8) * 0.7; } return x; };
// a note of `hz` every `every` seconds from `off`
const note = (t, every, off, hz, amp) => { const p = (((t - off) % every) + every) % every; return Math.exp(-p / 0.08) * Math.sin(TAU * hz * p) * amp; };
const near = (a, b, by) => Math.abs(a - b) <= by;

test('a steady track: its tempo to a hundredth and its beat to a hundredth of a second', () => {
  for (const [bpm, off, secs] of [[120, 0.21, 60], [128, 0.1, 60], [93.5, 0.3, 120], [123.4, 0.05, 240]]) {
    const r = tempoOf(make(secs, (t) => kick(t, bpm, off) + hat(t, bpm, off) + 0.05 * Math.sin(TAU * 220 * t)), RATE);
    assert.ok(r && r.confidence >= MIN_CONFIDENCE, `${bpm}: found`);
    assert.ok(near(r.bpm, bpm, 0.02), `${bpm}: got ${r.bpm}`);
    assert.ok(near(r.first, off, 0.012), `${bpm}: beat at ${r.first}, not ${off}`);
  }
});

test('a fast track may be read at half time, with the other reading offered', () => {
  const r = tempoOf(make(60, (t) => kick(t, 174) + hat(t, 174)), RATE);
  const all = [r.bpm, ...r.others.map((o) => o.bpm)];
  assert.ok(all.some((b) => near(b, 174, 0.05)) && all.some((b) => near(b, 87, 0.05)), all.join(' '));
});

test('every beat hit alike is the beat, not half time; a kick on every other one is half time', () => {
  // a kick on all four, and only a quiet bass note to mark every other beat: counted at 176, 88 offered next
  const four = tempoOf(make(60, (t) => kick(t, 176, 0.1) + hat(t, 88, 0.1) + note(t, 120 / 176, 0.1, 110, 0.15)), RATE);
  assert.ok(near(four.bpm, 176, 0.05) && near(four.first, 0.1, 0.012), JSON.stringify(four));
  assert.ok(near(four.others[0].bpm, 88, 0.05), JSON.stringify(four.others));
  // the kick on every other beat, hats on each: counted on the kick, 176 offered
  const half = tempoOf(make(60, (t) => kick(t, 88, 0.1) + hat(t, 88, 0.1)), RATE);
  assert.ok(near(half.bpm, 88, 0.05) && half.others.some((o) => near(o.bpm, 176, 0.05)), JSON.stringify(half));
});

test('a dotted reading is not taken for the beat', () => {
  // 114 with a bass note every beat and a half (which repeats at 76), then a faster passage at 152 (which
  // repeats at 76 too): 76 fits the whole track and is the beat of none of it
  const r = tempoOf(make(120, (t) => (t < 80 ? kick(t, 114, 0.2) * 0.8 + hat(t, 114, 0.2) + note(t, 90 / 114, 0.2, 150, 0.5) : kick(t, 152, 0.2) * 0.8 + hat(t, 152, 0.2))), RATE);
  assert.ok(near(r.bpm, 114, 0.05) && near(r.first, 0.2, 0.012), JSON.stringify(r));
  assert.ok(near(r.others[0].bpm, 76, 0.05) && r.others.some((o) => near(o.bpm, 152, 0.05)), JSON.stringify(r.others));
  assert.deepStrictEqual(r.holds, [{ from: 0, to: 80 }]);
  // and a kick with nothing between its beats is not lifted to anything
  const plain = tempoOf(make(60, (t) => kick(t, 76, 0.2)), RATE);
  assert.ok(near(plain.bpm, 76, 0.05), JSON.stringify(plain));
});

test('where the grid holds: all of a steady track, the steady part of another', () => {
  const all = tempoOf(make(60, (t) => kick(t, 120, 0.21) + hat(t, 120, 0.21)), RATE);
  assert.strictEqual(all.covers, 1);
  assert.deepStrictEqual(all.holds, [{ from: 0, to: 60 }]);
  // 40 seconds of a beat in the middle of two minutes of scattered hits
  const x = make(120, (t) => (t >= 40 && t < 80 ? kick(t, 120, 0.25) + hat(t, 120, 0.25) : 0) + 0.05 * Math.sin(TAU * 220 * t));
  const loose = hits(Array.from({ length: 60 }, () => { const u = (rnd() + 1) / 2 * 80; return u < 40 ? u : u + 40; }), 120);
  for (let i = 0; i < x.length; i++) x[i] += loose[i] * 0.5;
  const r = tempoOf(x, RATE);
  assert.ok(r.confidence >= MIN_CONFIDENCE && near(r.bpm, 120, 0.02) && near(r.first, 0.25, 0.012), JSON.stringify(r));
  assert.deepStrictEqual(r.holds, [{ from: 40, to: 80 }]);
  assert.ok(near(r.covers, 1 / 3, 0.01), `covers ${r.covers}`);
  for (const o of r.others) assert.ok(o.covers >= 0 && o.covers <= 1, JSON.stringify(o));
});

test('a quiet pulse that lasts is offered before a louder one that wanders', () => {
  const wander = []; for (let t = 0.1; t < 119; t += 60 / (115 + 5 * Math.sin(t / 4))) wander.push(t);
  const x = hits(wander, 120);
  for (let i = 0; i < x.length; i++) x[i] += kick(i / RATE, 64, 0.3) * 0.6;
  const r = tempoOf(x, RATE);
  assert.ok(near(r.bpm, 64, 0.05) && near(r.first, 0.3, 0.012), JSON.stringify(r));
});

test('a pulse under a pad is still found', () => {
  const r = tempoOf(make(90, (t) => kick(t, 74, 0.4) * 0.5 + 0.3 * Math.sin(TAU * 110 * t)), RATE);
  assert.ok(r.confidence >= MIN_CONFIDENCE && near(r.bpm, 74, 0.02) && near(r.first, 0.4, 0.012), JSON.stringify(r));
});

test('what has no steady pulse is said to have none', () => {
  const none = (x, name) => { const r = tempoOf(x, RATE); assert.ok(!r || r.confidence < MIN_CONFIDENCE, `${name}: ${JSON.stringify(r)}`); };
  none(make(60, () => rnd() * 0.3), 'noise');
  none(make(60, (t) => 0.4 * Math.sin(TAU * 110 * t) * (0.6 + 0.4 * Math.sin(TAU * t / 7))), 'a pad');
  none(hits(Array.from({ length: 90 }, () => (rnd() + 1) / 2 * 59), 60), 'scattered hits');
  const wander = []; for (let t = 0.1; t < 59; t += 60 / (115 + 15 * Math.sin(t / 4))) wander.push(t);
  none(hits(wander, 60), 'a tempo that wanders');
  none(make(3, (t) => kick(t, 120)), 'three seconds');
  none(new Float32Array(RATE * 30), 'silence');
});

test('a tempo stands for a grid of beats and bars', () => {
  const g = gridOf({ bpm: 120, first: 0.25, bar: 4 }, 5);
  assert.deepStrictEqual(g.beats, [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75, 4.25, 4.75]);
  assert.deepStrictEqual(g.downbeats, [0.25, 2.25, 4.25]);
  // a downbeat later in the file: the beats before it are there too, and the bars count back from it
  const h = gridOf({ bpm: 60, first: 2.5, bar: 4 }, 8);
  assert.deepStrictEqual(h.beats, [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]);
  assert.deepStrictEqual(h.downbeats, [2.5, 6.5]);
  assert.deepStrictEqual(gridOf({ bpm: 0 }, 10), { beats: [], downbeats: [] });
});

test('a tempo is kept in one way of writing it', () => {
  assert.deepStrictEqual(cleanTempo({ bpm: 120.004, first: 2.25 }), { bpm: 120, first: 0.25, bar: 4 });
  assert.deepStrictEqual(cleanTempo({ bpm: 60, first: -1, bar: 3, confidence: 0.4567 }), { bpm: 60, first: 2, bar: 3, confidence: 0.46 });
  assert.strictEqual(cleanTempo({ bpm: 5 }), null);
  assert.strictEqual(cleanTempo('120'), null);
});

test('a cue with a tempo gives the engine a beat to wait for', () => {
  const { doc, id } = build([
    { op: 'cue.add', ref: 'm', cue: { type: 'audio', name: 'Track', file: 'media/t.wav', tempo: { bpm: 120, first: 0, bar: 4 } } },
    { op: 'cue.add', ref: 'g', cue: { type: 'group', name: 'Hit', onBeat: 'bar', children: [{ type: 'audio', name: 'Bell', file: 'media/b.wav' }] } },
  ]);
  assert.deepStrictEqual(doc.lists[0].cues[0].tempo, { bpm: 120, first: 0, bar: 4 });
  const r = rig(doc);
  r.engine.setDuration('media/t.wav', 60);
  r.engine.go();
  r.advance(2.7);
  const wait = r.engine.toNextDownbeat(0, 'downbeats');
  assert.ok(near(wait, 1.3, 0.01), `to the next bar: ${wait}`);
  assert.ok(near(r.engine.toNextDownbeat(0, 'beats'), 0.3, 0.01));
  r.engine.go();                                   // the group waits for the bar
  r.advance(1.2);
  assert.ok(!r.audio.calls.some((c) => c[0] === 'play' && /b\.wav/.test(JSON.stringify(c))), 'not before the bar');
  r.advance(0.2);
  assert.ok(r.audio.calls.some((c) => c[0] === 'play' && /b\.wav/.test(JSON.stringify(c))), 'on the bar');
  assert.strictEqual(id('m') && r.engine.byId.get(id('m')).beats.length, 121);
});
