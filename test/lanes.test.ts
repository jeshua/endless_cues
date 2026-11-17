// Automation (core/audio/lanes.ts): the lines drawn over a sound's length that move its volume, its pan and the
// settings of its sound design; how they are kept, read between their points, bent, wrapped round a loop, and how
// a pan is shared between the two sides. And what reaches the engine and the sound.
import test from 'node:test';
import assert from 'node:assert';
import * as L from '../core/audio/lanes';
import * as D from '../app/renderer/dial';
import * as Chain from '../core/audio/chain';
import * as curves from '../core/audio/curves';
import * as cueTypes from '../core/show/cue-types';
import { panOfMatrix } from '../core/import/qlab';
import { rig, build } from './helpers';
import * as runFrom from '../core/engine/run-from';
import * as show from '../core/show/show';
import type { LanePoint } from '../core/show/types';

const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);
const spec = (id: string) => L.specOf(id, Chain.TOOLS);

test('an old envelope reads and plays exactly as it did: straight lines in dB, held at both ends', () => {
  const env: LanePoint[] = [[0, 0], [2, -6], [4, -20], [9, 12]];
  assert.deepEqual(curves.cleanEnvelope(env), env, 'kept as it was written: no bend added');
  assert.strictEqual(curves.envelopeAt(env, 1), -3);
  assert.strictEqual(curves.envelopeAt(env, 3), -13);
  assert.strictEqual(curves.envelopeAt(env, -1), 0);
  assert.strictEqual(curves.envelopeAt(env, 99), 12);
  // (the reading the audio window used to make by itself, before it read lanes.ts)
  const old = (e: LanePoint[], t: number) => { if (t <= e[0][0]) return e[0][1]; for (let i = 1; i < e.length; i++) { const [t0, d0] = e[i - 1], [t1, d1] = e[i]; if (t <= t1) return d0 + (d1 - d0) * ((t - t0) / (t1 - t0)); } return e[e.length - 1][1]; };
  for (let t = -0.5; t < 10; t += 0.137) assert.strictEqual(L.envelopeAt(env, t), old(env, t), `at ${t}`);
});

test('a point may bend the line to the next: a positive bend starts slow, a negative one fast, and the ends stay put', () => {
  const up: LanePoint[] = [[0, -40, 0.6], [2, 0]], down: LanePoint[] = [[0, -40, -0.6], [2, 0]];
  assert.strictEqual(L.valueAt(up, 0), -40); assert.strictEqual(L.valueAt(up, 2), 0);
  assert.ok(L.valueAt(up, 1)! < -20, `slow start: ${L.valueAt(up, 1)} is under the straight line's −20`);
  assert.ok(L.valueAt(down, 1)! > -20, `fast start: ${L.valueAt(down, 1)} is over it`);
  near(L.valueAt(up, 1)! + 20, -(L.valueAt(down, 1)! + 20), 1e-9, 'the two bends mirror each other');
  // monotonic: a bent line never overshoots
  let last = -Infinity;
  for (let t = 0; t <= 2; t += 0.05) { const v = L.valueAt(up, t)!; assert.ok(v >= last - 1e-12, `rising at ${t}`); last = v; }
  assert.strictEqual(L.bend(0.3, 0), 0.3);
  // kept: a bend is rounded to a hundredth and clamped; none is left off
  assert.deepEqual(L.cleanLane([[1, -6, 0], [0, 0, 3.14159], [2, -3, -0.123]]), [[0, 0, 1], [1, -6], [2, -3, -0.12]]);
});

test('a setting moves along its knob’s scale: half way from 200 Hz to 2 kHz is 632 Hz, and a mix moves in a line', () => {
  const hz = spec('chain.lowpass.hz');
  assert.ok(hz && hz.kind === 'chain' && hz.tool === 'lowpass' && hz.key === 'hz');
  near(L.valueAt([[0, 200], [10, 2000]], 5, hz)!, 632.46, 0.01, 'a frequency, half way');
  near(L.valueAt([[0, 0], [10, 1]], 2.5, spec('chain.reverb.mix')!)!, 0.25, 1e-9, 'a mix, a quarter of the way');
  near(L.valueAt([[0, 0], [10, 250]], 5, spec('chain.reverb.predelay')!)!, 62.5, 1e-9, 'a pre-delay turns along a square, as its knob does');
  // what cannot glide is no lane (a change to it rebuilds the chain): a drive's amount, a slope, a reverb's size
  for (const id of ['chain.drive.db', 'chain.lowpass.slope', 'chain.reverb.size', 'chain.nothing.hz', 'volume2']) assert.strictEqual(spec(id), null, id);
});

test('a lane turns as the knob in the window turns: the same scale as app/renderer/dial.ts for every setting', () => {
  for (const t of Chain.TOOLS) for (const p of t.params) {
    if (!spec(`chain.${t.key}.${p.key}`)) continue;
    const n = p as Chain.NumberParam;
    assert.strictEqual(L.scaleOf(n), D.scaleOf(n).kind, `${t.key}.${p.key}`);
    for (const x of [0, 0.1, 0.37, 0.5, 0.9, 1]) { const v = n.min + (n.max - n.min) * x; near(L.posOf(n, v), D.toPos(n, v), 1e-12, `${t.key}.${p.key} at ${v}`); }
  }
});

test('the lanes a cue offers: Volume, Pan, then each setting that glides of each tool in its chain, in the order they run', () => {
  const ids = L.lanesOf({ chain: { reverb: { mix: 0.3 }, lowpass: { hz: 800, slope: 12, on: false } } as Chain.ChainValue }, Chain.TOOLS).map((s) => s.id);
  assert.deepEqual(ids, ['volume', 'pan', 'chain.lowpass.hz', 'chain.reverb.predelay', 'chain.reverb.mix']);
  assert.strictEqual(spec('chain.reverb.mix')!.label, 'Reverb · Mix');
});

test('a cue’s automation is checked as the show keeps it: unknown lanes and the Volume lane are refused, empty lanes go', () => {
  const f = cueTypes.fieldOf('audio', 'automation')!;
  const ok = cueTypes.coerce(f, { pan: [[2, 150], [0, -100, 0.5]], 'chain.lowpass.hz': [[0, 5]], 'chain.reverb.mix': [] });
  assert.ok(ok.ok, (ok as { why: string }).why);
  assert.deepEqual((ok as { value: unknown }).value, { pan: [[0, -100, 0.5], [2, 100]], 'chain.lowpass.hz': [[0, 20]] });
  assert.match((cueTypes.coerce(f, { volume: [[0, 0]] }) as { why: string }).why, /envelope/);
  assert.match((cueTypes.coerce(f, { 'chain.drive.db': [[0, 3]] }) as { why: string }).why, /no lane/);
  assert.match((cueTypes.coerce(f, { pan: [[0, 'left']] }) as { why: string }).why, /points/);
  assert.strictEqual((cueTypes.coerce(f, { pan: [] }) as { value: unknown }).value, undefined, 'nothing left: no automation');
  const pan = cueTypes.fieldOf('audio', 'pan')!;
  assert.strictEqual((cueTypes.coerce(pan, '-30') as { value: unknown }).value, -30);
  assert.strictEqual(cueTypes.coerce(pan, 140).ok, false);
  assert.ok(cueTypes.fieldOf('mic', 'pan'), 'a Mic cue has a pan too');
});

test('a line inside a looped region goes round with it, and a whole-file loop plays its line again each pass', () => {
  const g = { start: 2, end: 4 };
  assert.strictEqual(L.wrap(3, g, 0), 3);
  assert.strictEqual(L.wrap(4.5, g, 0), 2.5, 'half a second past the end is half a second into the region');
  assert.strictEqual(L.wrap(7, g, 0), 3);
  assert.strictEqual(L.wrap(11, null, 10), 1);
  assert.strictEqual(L.wrap(5, null, 0), 5);
  const lane: LanePoint[] = [[2, -30], [4, 0]];
  assert.strictEqual(L.envelopeAt(lane, L.wrap(5, g, 0)), L.envelopeAt(lane, 3), 'the second time round is the first');
});

test('a pan is equal power: unity on both sides in the middle, the same power anywhere, all of it on one side at ±100', () => {
  assert.deepEqual(L.panGains(0), [1, 1]);
  for (const p of [-100, -60, -10, 25, 100]) { const [l, r] = L.panGains(p); near(l * l + r * r, 2, 1e-12, `power at ${p}`); }
  near(L.panGains(-100)[0], Math.SQRT2, 1e-12, 'hard left'); near(L.panGains(-100)[1], 0, 1e-12, 'nothing right');
  near(L.panGains(100)[1], Math.SQRT2, 1e-12, 'hard right');
  assert.ok(L.panGains(-50)[0] > L.panGains(-50)[1]);
  // and back: two gains as a pan and the level that is left
  assert.deepEqual(L.panOfGains(1, 1), { pan: 0, db: 0 });
  assert.deepEqual(L.panOfGains(...(L.panGains(-40) as [number, number])), { pan: -40, db: 0 });
  assert.strictEqual(L.panOfGains(1, 0)!.pan, -100);
  assert.strictEqual(L.panOfGains(0, 0), null);
});

test('the window’s edits: one lane set on the cue, a removed device takes its lanes with it, a chain starts on its lines', () => {
  const cue = { envelope: [[0, 0]] as LanePoint[], automation: { pan: [[0, 0]], 'chain.lowpass.hz': [[0, 300], [4, 3000]] } as L.AutomationValue, chain: { lowpass: { hz: 1000, slope: 12 }, reverb: { mix: 0.2 } } as Chain.ChainValue };
  assert.deepEqual(L.propsFor(cue, 'volume', []), { envelope: null });
  assert.deepEqual(L.propsFor(cue, 'pan', []), { automation: { 'chain.lowpass.hz': [[0, 300], [4, 3000]] } });
  assert.deepEqual(L.propsFor({}, 'chain.reverb.mix', [[1, 0.5]]), { automation: { 'chain.reverb.mix': [[1, 0.5]] } });
  assert.strictEqual(L.pruneFor(cue.automation, cue.chain), cue.automation, 'nothing to take: the same object');
  assert.deepEqual(L.pruneFor(cue.automation, { reverb: { mix: 0.2 } } as Chain.ChainValue), { pan: [[0, 0]] });
  assert.strictEqual(L.pruneFor({ 'chain.lowpass.hz': [[0, 1]] }, null), null);
  assert.strictEqual(L.baseOf(cue, L.PAN), 0); assert.strictEqual(L.baseOf(cue, spec('chain.lowpass.hz')!), 1000); assert.strictEqual(L.baseOf(cue, spec('chain.reverb.predelay')!), 20);
  const at = L.chainAt(cue.chain, cue.automation, 2, Chain.TOOLS)!;
  near(at.lowpass!.hz, 948.7, 0.1, 'half way along a ratio'); assert.strictEqual(at.reverb!.mix, 0.2); assert.strictEqual(cue.chain.lowpass!.hz, 1000, 'the cue’s own is left alone');
  assert.deepEqual(Object.keys(L.sweepAt(cue.automation, 4, Chain.TOOLS)), ['lowpass']);
});

test('an Audio cue hands its pan and its lines to the sound, and a Mic cue its pan', () => {
  const doc = show.newShow('t');
  const list = doc.lists[0];
  list.cues.push({ id: 'a', type: 'audio', file: 'a.wav', pan: -40, envelope: [[0, -6]], automation: { pan: [[0, -40], [2, 40, 0.3]] } },
    { id: 'm', type: 'mic', pan: 25 }, { id: 'b', type: 'audio', file: 'b.wav' });
  const { engine: e, audio } = rig(doc);
  e.fire('a'); e.fire('m'); e.fire('b');
  const o = (k: string) => audio.calls.find((c) => c[0] === 'play' && c[1] === k)![2];
  assert.strictEqual(o('a').pan, -40);
  assert.deepEqual(o('a').automation, { pan: [[0, -40], [2, 40, 0.3]] });
  assert.deepEqual(o('a').envelope, [[0, -6]]);
  assert.strictEqual(o('m').pan, 25);
  assert.ok(!('pan' in o('b')) && !('automation' in o('b')), 'a plain sound is played as it always was');
});

test('Run from here brings a sound back part way in, with its lines: they are read at the place it starts from', () => {
  const lane = [[0, 200], [8, 8000]];
  const b = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'a.wav', continue: 'auto-continue', postWait: 3, chain: { lowpass: { hz: 1000, slope: 12 } }, automation: { 'chain.lowpass.hz': lane } } },
    { op: 'cue.add', ref: 'x', cue: { type: 'memo', number: '2' } },
  ]);
  const p = runFrom.plan(b.doc, b.id('x'), { durations: { 'a.wav': 10 } }) as runFrom.RunPlan;
  assert.deepEqual(p.sounds.map((x) => x.at), [3]);
  const { engine: e, audio } = rig(b.doc);
  runFrom.apply(e, p);
  const play = audio.calls.filter((c) => c[0] === 'play').pop()![2];
  assert.strictEqual(play.from, 3);
  assert.deepEqual(play.automation, { 'chain.lowpass.hz': lane });
  // which is the place the audio window reads the line at, so the filter is where the show would have it there
  near(L.chainAt({ lowpass: { hz: 1000, slope: 12 } }, play.automation, play.from, Chain.TOOLS)!.lowpass!.hz, 200 * Math.pow(40, 3 / 8), 0.01, 'the filter');
});

test('a QLab cue panned by its crosspoints between outputs 1 and 2 comes across as a pan, its level what is left', () => {
  const db = (g: number) => Math.round(20 * Math.log10(g) * 1000) / 1000;
  const [l, r] = L.panGains(-50);
  assert.deepEqual(panOfMatrix([{ 1: db(l), 2: db(r) }]), { pan: -50, db: 0 }, 'a mono file to both');
  assert.deepEqual(panOfMatrix([{ 1: db(l / 2) }, { 2: db(r / 2) }]), { pan: -50, db: -6 }, 'a stereo file, balanced, 6 dB down');
  assert.strictEqual(panOfMatrix([{ 3: 0 }, { 4: 0 }]), null, 'other outputs: its own outputs, as before');
  assert.strictEqual(panOfMatrix([{ 1: 0, 2: 0, 3: 0 }]), null);
});
