// Sound design: a cue's chain as data (what the show keeps, what is built), and the kernels the worklets run,
// measured on synthesised signals. Nothing here is listened to.
const test = require('node:test');
const assert = require('node:assert');
const Chain = require('../core/audio/chain');
const { coerce, fieldOf } = require('../core/show/cue-types');

const SR = 48000;
const sine = (hz, db, secs, harmonics = 1) => { const a = Math.pow(10, db / 20), s = new Float32Array(Math.round(SR * secs)); for (let i = 0; i < s.length; i++) for (let h = 1; h <= harmonics; h++) s[i] += a / h * Math.sin(2 * Math.PI * hz * h * i / SR); return s; };
/** A kernel run over a signal, a block of 128 at a time as a worklet runs it. */
function run(k, sig) { const out = new Float32Array(sig.length); for (let i = 0; i + 128 <= sig.length; i += 128) k.process([sig.subarray(i, i + 128)], [out.subarray(i, i + 128), new Float32Array(128)]); return out; }
const rmsDb = (x, from, to) => { let s = 0; for (let i = Math.round(from * SR); i < Math.round(to * SR); i++) s += x[i] * x[i]; return 10 * Math.log10(s / (Math.round(to * SR) - Math.round(from * SR)) + 1e-12); };
const hzOf = (x, from, to) => { let n = 0; for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if (x[i - 1] < 0 && x[i] >= 0) n++; return n / (to - from); };

test('a chain keeps only the tools it names, every setting written out and made safe', () => {
  assert.strictEqual(Chain.cleanChain(null), null);
  assert.strictEqual(Chain.cleanChain({}), null);
  assert.deepStrictEqual(Chain.cleanChain({ highpass: { hz: 300 } }), { highpass: { hz: 300, slope: 12 } });
  assert.deepStrictEqual(Chain.cleanChain({ lowpass: { hz: 99999, slope: 30 }, tail: true }), { lowpass: { hz: 20000, slope: 24 }, tail: true });
  assert.deepStrictEqual(Chain.cleanChain({ comp: { ratio: 4, on: false } }), { comp: { threshold: -18, ratio: 4, attack: 10, release: 200, makeup: 0, on: false } });
  assert.deepStrictEqual(Chain.cleanChain({ tail: true }), null, 'a tail of nothing is no chain');
  assert.throws(() => Chain.cleanChain({ flanger: {} }), /no tool called “flanger”/);
  assert.throws(() => Chain.cleanChain({ highpass: 80 }), /highpass is an object/);
  assert.throws(() => Chain.cleanChain({ highpass: { hz: 'low' } }), /highpass\.hz is a number/);
  assert.throws(() => Chain.cleanChain([1]), /one entry per tool/);
});

test('the cue-type table takes a chain, on Audio, Mic and Video cues', () => {
  for (const type of ['audio', 'mic', 'video']) {
    const f = fieldOf(type, 'chain');
    assert.ok(f && f.kind === 'chain', type);
    assert.deepStrictEqual(coerce(f, { delay: { time: 0.5 } }), { ok: true, value: { delay: { time: 0.5, feedback: 0.35, tone: 6000, mix: 0.3 } } });
    assert.deepStrictEqual(coerce(f, {}), { ok: true, value: undefined });
    assert.strictEqual(coerce(f, { nope: {} }).ok, false);
  }
});

test('the eq has four bands, and a three-band eq from an older show is kept exactly as it was written', () => {
  assert.deepStrictEqual(Chain.cleanEq({ low: -40, mid: 0, high: 3 }), { low: -40, high: 3 });
  assert.deepStrictEqual(Chain.cleanEq({ mid: { db: 4, hz: 1000, q: 0.8 } }), { mid: 4 }, 'a band at its usual place is a plain number');
  assert.deepStrictEqual(Chain.cleanEq({ mid: { db: 4, hz: 1800, q: 2 }, mid2: -3, low: { db: 2, hz: 90 } }), { low: { db: 2, hz: 90 }, mid: { db: 4, hz: 1800, q: 2 }, mid2: -3 });
  assert.strictEqual(Chain.cleanEq({ low: 0 }), null);
  // what is built for the old three bands: the same three filters the sound window always made
  const old = Chain.plan(null, { low: -6, mid: 2, high: 1 }).stages;
  assert.deepStrictEqual(old, [{ tool: 'eq', bands: [{ key: 'low', type: 'lowshelf', db: -6, hz: 250, q: 0 }, { key: 'mid', type: 'peaking', db: 2, hz: 1000, q: 0.8 }, { key: 'high', type: 'highshelf', db: 1, hz: 4000, q: 0 }] }]);
});

test('a plan is the tools that are on, in the one order they run, and a sound with none is no stages at all', () => {
  assert.deepStrictEqual(Chain.plan(null, null), { stages: [], sig: '', tail: false, tailSecs: 0 });
  const p = Chain.plan({ reverb: { decay: 2, predelay: 50 }, highpass: { hz: 100 }, comp: {}, gate: { on: false }, tail: true }, { mid: 3 });
  assert.deepStrictEqual(p.stages.map((s) => s.tool), ['highpass', 'eq', 'comp', 'reverb']);
  assert.strictEqual(p.tail, true);
  assert.ok(Math.abs(p.tailSecs - 2.15) < 1e-9);
  // bypassed: the plain wire, eq and all
  assert.deepStrictEqual(Chain.plan({ highpass: {}, bypass: true }, { mid: 3 }).stages, []);
  // a tail with nothing that rings is no tail
  assert.strictEqual(Chain.plan({ highpass: {}, tail: true }).tail, false);
  // a delay's tail: its repeats down 60 dB
  const d = Chain.plan({ delay: { time: 0.5, feedback: 0.5 }, tail: true });
  assert.ok(d.tailSecs > 5 && d.tailSecs < 6.1, String(d.tailSecs));
  // a change of a number keeps the structure; a change of slope, or a tool switched on, does not
  const sig = (c) => Chain.plan(c).sig;
  assert.strictEqual(sig({ lowpass: { hz: 400 } }), sig({ lowpass: { hz: 9000 } }));
  assert.notStrictEqual(sig({ lowpass: { hz: 400 } }), sig({ lowpass: { hz: 400, slope: 24 } }));
  assert.notStrictEqual(sig({ lowpass: {} }), sig({ lowpass: {}, delay: {} }));
});

test('every built-in preset is a chain the show would keep as written', () => {
  for (const [name, p] of Object.entries(Chain.PRESETS)) {
    const c = Chain.cleanChain(p.chain);
    assert.ok(c, name);
    assert.ok(Chain.plan(p.chain, p.eq).stages.length >= 2, name);
    for (const [tool, set] of Object.entries(p.chain)) if (set && typeof set === 'object') for (const [k, v] of Object.entries(set)) assert.strictEqual(c[tool][k], v, `${name}: ${tool}.${k}`);
  }
  assert.deepStrictEqual(Chain.PRESETS.Voice.chain.highpass, { hz: 80, slope: 12 });
});

test('a Fade cue can move only what glides', () => {
  assert.deepStrictEqual(Chain.cleanSweep({ lowpass: { hz: 400 } }), { lowpass: { hz: 400 } });
  assert.deepStrictEqual(Chain.cleanSweep({ lowpass: { hz: 5 }, delay: { mix: 2 } }), { lowpass: { hz: 20 }, delay: { mix: 1 } });
  assert.throws(() => Chain.cleanSweep({ lowpass: { slope: 24 } }), /cannot be moved by a fade/);
  assert.throws(() => Chain.cleanSweep({ reverb: { decay: 4 } }), /cannot be moved by a fade/);
  assert.strictEqual(Chain.cleanSweep({}), null);
});

test('the compressor: a steady tone 12 dB over a 4:1 threshold comes out 9 dB down, and one under it untouched', () => {
  const k = () => new Chain.Dynamics({ sampleRate: SR, mode: 'comp', threshold: -18, ratio: 4, attack: 5, release: 100, makeup: 0 });
  const loud = run(k(), sine(1000, -6, 1));
  assert.ok(Math.abs((rmsDb(loud, 0.5, 0.95) + 3.01) - (-15)) < 0.4, String(rmsDb(loud, 0.5, 0.95) + 3.01));
  const quiet = run(k(), sine(1000, -30, 1));
  assert.ok(Math.abs((rmsDb(quiet, 0.5, 0.95) + 3.01) - (-30)) < 0.1);
  // make-up is what it says, and nothing is added without it (the browser's own compressor adds its own)
  const made = run(new Chain.Dynamics({ sampleRate: SR, mode: 'comp', threshold: -18, ratio: 4, makeup: 6 }), sine(1000, -30, 1));
  assert.ok(Math.abs((rmsDb(made, 0.5, 0.95) + 3.01) - (-24)) < 0.1);
});

test('the compressor: a transient is let through for its attack time and then held down', () => {
  const sig = new Float32Array(SR);
  sig.set(sine(1000, -40, 0.5), 0);
  sig.set(sine(1000, -6, 0.5), SR / 2);
  const out = run(new Chain.Dynamics({ sampleRate: SR, mode: 'comp', threshold: -18, ratio: 8, attack: 30, release: 100 }), sig);
  const first = rmsDb(out, 0.5, 0.505), later = rmsDb(out, 0.8, 0.95);
  assert.ok(first > later + 5, `${first} then ${later}`);
  assert.ok(Math.abs((later + 3.01) - (-18 + 12 / 8)) < 0.5, String(later + 3.01));
});

test('the gate: shut under its threshold, open over it, and held open for its hold', () => {
  const sig = new Float32Array(SR * 2);
  sig.set(sine(500, -60, 0.5), 0);                 // hiss: shut
  sig.set(sine(500, -12, 0.5), SR * 0.5);          // a line: open
  sig.set(sine(500, -60, 1), SR);                  // hiss again: held 200 ms, then shut
  const out = run(new Chain.Dynamics({ sampleRate: SR, mode: 'gate', threshold: -40, range: -80, attack: 1, hold: 200, release: 50 }), sig);
  assert.ok(rmsDb(out, 0.2, 0.45) < -110, `shut: ${rmsDb(out, 0.2, 0.45)}`);
  assert.ok(Math.abs(rmsDb(out, 0.6, 0.95) + 15.01) < 0.2, `open: ${rmsDb(out, 0.6, 0.95)}`);
  assert.ok(Math.abs(rmsDb(out, 1.05, 1.15) + 63.01) < 1, `held: ${rmsDb(out, 1.05, 1.15)}`);
  assert.ok(rmsDb(out, 1.7, 1.95) < -100, `shut again: ${rmsDb(out, 1.7, 1.95)}`);
  // as an expander: the quiet is turned down by its range, not shut
  const exp = run(new Chain.Dynamics({ sampleRate: SR, mode: 'gate', threshold: -40, range: -12 }), sine(500, -60, 1));
  assert.ok(Math.abs(rmsDb(exp, 0.5, 0.95) + 75.01) < 0.3, String(rmsDb(exp, 0.5, 0.95)));
});

test('the crusher: four bits is sixteen levels, and a lower sample rate holds each sample', () => {
  const out = run(new Chain.Crusher({ sampleRate: SR, bits: 4, hz: SR }), sine(200, -1, 0.2));
  assert.ok(new Set([...out.slice(0, 9600)].map((v) => Math.round(v * 1000))).size <= 17);
  const held = run(new Chain.Crusher({ sampleRate: SR, bits: 16, hz: 4800 }), sine(200, -1, 0.2));
  let changes = 0; for (let i = 1; i < 9600; i++) if (held[i] !== held[i - 1]) changes++;
  assert.ok(changes > 900 && changes <= 961, String(changes));
});

// The measure the pitch shifter is kept by: a steady tone comes out at the asked pitch within 10 cents, and its
// level does not wobble by more than 1 dB from one 20 ms to the next (the splices are not heard as a tremolo).
test('the pitch shifter: a tone comes out at the pitch asked for, at a steady level', () => {
  for (const [hz, st, harmonics] of [[440, 7, 1], [440, -5, 1], [220, 12, 1], [1000, -12, 1], [5000, 3, 1], [110, 4, 6], [220, -7, 6]]) {
    const out = run(new Chain.PitchShifter({ sampleRate: SR, semitones: st }), sine(hz, -6, 3, harmonics));
    const want = hz * Math.pow(2, st / 12);
    // (a tone with harmonics crosses zero more than once a period: its pitch is read from a pure tone only)
    if (harmonics === 1) { const cents = 1200 * Math.log2(hzOf(out, 1, 2.9) / want); assert.ok(Math.abs(cents) < 10, `${hz} Hz ${st} st: ${cents.toFixed(1)} cents out`); }
    let lo = Infinity, hi = -Infinity;
    const win = Math.max(0.02, 4 / Math.min(hz, want));
    for (let t = 1; t + win < 2.9; t += win) { const r = rmsDb(out, t, t + win); lo = Math.min(lo, r); hi = Math.max(hi, r); }
    assert.ok(hi - lo < 1, `${hz} Hz ${st} st: level wobbles ${(hi - lo).toFixed(2)} dB`);
    assert.ok(Math.abs(hi - rmsDb(sine(hz, -6, 1, harmonics), 0.1, 0.9)) < 1, `${hz} Hz ${st} st: level changed`);
  }
  // cents count, and nothing asked for is nothing done (bar the delay)
  const up = run(new Chain.PitchShifter({ sampleRate: SR, semitones: 0, cents: 50 }), sine(440, -6, 3));
  assert.ok(Math.abs(1200 * Math.log2(hzOf(up, 1, 2.9) / 440) - 50) < 10);
});

test('the worklet module is the kernels’ own text', () => {
  assert.ok(Chain.WORKLETS.includes('class PitchShifter') && Chain.WORKLETS.includes("shell('ec-dynamics'"));
  // (it must at least be a program: a worklet that does not parse fails silently in a hidden window)
  assert.doesNotThrow(() => new Function('registerProcessor', 'AudioWorkletProcessor', 'sampleRate', Chain.WORKLETS)(() => {}, class {}, SR));
});
