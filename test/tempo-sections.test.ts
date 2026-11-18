// Tempo that changes within a track: sections found from made tracks, laid into one grid, and edited by hand.
import test from 'node:test';
import assert from 'node:assert';
import { tempoMap, gridOf, cleanTempo, editTempo, sectionAt, MIN_CONFIDENCE } from '../core/audio/tempo';
import { rig, build } from './helpers';
import type { CueEngine, EngineAudio } from '../core/engine/cue-engine';
import type { TempoValue } from '../core/audio/tempo';

/** A line of Active Cues that is a sound (it has a rate). */
type SoundRow = Extract<ReturnType<CueEngine['active']>[number], { rate: unknown }>;

const RATE = 11025, TAU = Math.PI * 2;
let seed = 11;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const near = (a: number, b: number, by: number) => Math.abs(a - b) <= by;
/** A made track in parts: [{ secs, bpm }], each part's first kick on its first sample (after `lead` s of nothing). */
function track(parts: { secs: number; bpm?: number }[], lead = 0) {
  const total = parts.reduce((n, p) => n + p.secs, lead), x = new Float32Array(Math.round(total * RATE));
  let from = lead;
  for (const part of parts) {
    const a = Math.round(from * RATE), n = Math.round(part.secs * RATE);
    for (let i = 0; i < n && a + i < x.length; i++) {
      const t = i / RATE;
      if (!part.bpm) { x[a + i] = 0.1 * Math.sin(TAU * 110 * t) * (1 + 0.3 * Math.sin(TAU * 0.13 * t)); continue; }       // a pad: no pulse
      const b = 60 / part.bpm, p = t % b, h = t % (b / 2);
      x[a + i] = Math.exp(-p / 0.05) * Math.sin(TAU * 60 * p) * 0.8 + Math.exp(-h / 0.01) * rnd() * 0.25 + 0.05 * Math.sin(TAU * 220 * t);
    }
    from += part.secs;
  }
  return x;
}
const onGrid = (t: number, first: number, bpm: number) => { const b = 60 / bpm, d = (t - first) / b; return Math.abs(d - Math.round(d)) * b; };

test('a track with one tempo has no sections', () => {
  const r = tempoMap(track([{ secs: 64, bpm: 120 }]), RATE);
  assert.ok(r && near(r.bpm, 120, 0.02) && r.sections.length === 0, JSON.stringify(r));
});

test('two tempos: a section for the second, starting where it starts, on its own beat', () => {
  const r = tempoMap(track([{ secs: 64, bpm: 120 }, { secs: 64, bpm: 96 }]), RATE);
  assert.ok(r && r.confidence >= MIN_CONFIDENCE, 'found');
  assert.ok(near(r.bpm, 120, 0.05) && onGrid(0, r.first, 120) < 0.015, `the first part: ${r.bpm} at ${r.first}`);
  assert.strictEqual(r.sections.length, 1, JSON.stringify(r.sections));
  const s = r.sections[0];
  assert.ok(near(s.bpm, 96, 0.1), `the second part: ${s.bpm}`);
  assert.ok(near(s.from, 64, 0.7), `it starts at ${s.from}, not 64`);            // to the beat, about
  assert.ok(onGrid(s.first, 64, 96) < 0.02, `its beat is ${onGrid(s.first, 64, 96)} s off`);
});

test('three parts, the outer two alike but not on one grid: three sections', () => {
  // the middle part is 40.3 s, so the third does not land on the first one's beats
  const r = tempoMap(track([{ secs: 48, bpm: 100 }, { secs: 40.3, bpm: 140 }, { secs: 48, bpm: 100 }]), RATE);
  assert.ok(r && near(r.bpm, 100, 0.05), JSON.stringify(r));
  assert.deepStrictEqual(r.sections.map((s) => Math.round(s.bpm)), [140, 100], JSON.stringify(r.sections));
  assert.ok(near(r.sections[0].from, 48, 0.8) && near(r.sections[1].from, 88.3, 0.8), JSON.stringify(r.sections));
  assert.ok(onGrid(r.sections[1].first, 88.3, 100) < 0.02);
});

test('a breakdown with no pulse in the middle of one tempo: still one grid', () => {
  // 48 s at 120 is 96 beats, and 24 s more is 48: the music comes back on the grid it left
  const r = tempoMap(track([{ secs: 48, bpm: 120 }, { secs: 24, bpm: 0 }, { secs: 48, bpm: 120 }]), RATE);
  assert.ok(r && near(r.bpm, 120, 0.05) && r.sections.length === 0, JSON.stringify(r));
});

test('the grid of a tempo with sections: each section its own beats and bar lines, end to end', () => {
  const tempo = { bpm: 120, first: 0, bar: 4, sections: [{ from: 8, bpm: 90, first: 8, bar: 3 }] };
  const g = gridOf(tempo, 14);
  assert.deepStrictEqual(g.beats.slice(0, 3), [0, 0.5, 1]);
  assert.deepStrictEqual(g.beats.filter((b) => b >= 7), [7, 7.5, 8, 8.667, 9.333, 10, 10.667, 11.333, 12, 12.667, 13.333, 14]);
  assert.deepStrictEqual(g.downbeats, [0, 2, 4, 6, 8, 10, 12, 14]);              // every 4 at 120, then every 3 at 90
  // no beat of the old tempo a hair before the new section's first
  const tight = gridOf({ bpm: 120, first: 0, bar: 4, sections: [{ from: 8.01, bpm: 90, first: 8.01, bar: 4 }] }, 10);
  assert.ok(!tight.beats.includes(8) && tight.beats.includes(8.01), tight.beats.join(' '));
  assert.strictEqual(sectionAt(tempo, 7.9)!.bpm, 120);
  assert.strictEqual(sectionAt(tempo, 8)!.bpm, 90);
  assert.strictEqual(sectionAt(tempo, 8)!.bar, 3);
  assert.strictEqual(sectionAt(tempo, 3)!.to, 8);
});

test('a tempo is cleaned with its sections: in order, each bar line inside its first bar, nonsense dropped', () => {
  const t = cleanTempo({ bpm: 120, first: 4.1, bar: 4, sections: [{ from: 30, bpm: 100, first: 33.1, bar: 3 }, { from: 10, bpm: 90 }, { from: 20, bpm: 5 }, { from: -3, bpm: 100 }] });
  assert.deepStrictEqual(t, { bpm: 120, first: 0.1, bar: 4, sections: [{ from: 10, bpm: 90, first: 10, bar: 4 }, { from: 30, bpm: 100, first: 31.3, bar: 3 }] });
  // a tempo with no sections is one tempo throughout
  assert.deepStrictEqual(cleanTempo({ bpm: 120, first: 2.1, bar: 4 }), { bpm: 120, first: 0.1, bar: 4 });
});

test('by hand: a new section, its tempo and its beats in a bar, "1 is here", and taken away again', () => {
  let t: TempoValue = { bpm: 120, first: 0, bar: 4, confidence: 0.5 };
  t = editTempo(t, { do: 'split', at: 10.1 })!;                       // on the beat nearest: 10.0
  assert.deepStrictEqual(t.sections, [{ from: 10, bpm: 120, first: 10, bar: 4 }]);
  t = editTempo(t, { do: 'set', at: 12, bpm: 90, bar: 3 })!;
  assert.deepStrictEqual(t.sections, [{ from: 10, bpm: 90, first: 10, bar: 3 }]);
  assert.strictEqual(t.bpm, 120);                                    // the first section is not touched
  assert.strictEqual(t.confidence, 0.5);
  // "1 is here", in the second section: the beat nearest 11.4 (10 + 2 beats of 0.667 = 11.333) is beat one
  t = editTempo(t, { do: 'one', at: 11.4 })!;
  assert.ok(near(gridOf(t, 20).downbeats.find((d) => d > 10.5)!, 11.333, 0.002), JSON.stringify(t));
  // …and in the first: the bar lines move, the beats do not
  const before = gridOf(t, 9).beats;
  t = editTempo(t, { do: 'one', at: 1.02 })!;
  assert.deepStrictEqual(gridOf(t, 9).beats, before);
  assert.deepStrictEqual(gridOf(t, 9).downbeats, [1, 3, 5, 7, 9]);
  t = editTempo(t, { do: 'nudge', at: 12, by: 0.01 })!;
  assert.ok(near(t.sections![0].first, 11.343, 0.002), JSON.stringify(t));
  t = editTempo(t, { do: 'join', at: 12 })!;
  assert.strictEqual(t.sections, undefined);
  assert.strictEqual(editTempo(t, { do: 'join', at: 1 }), null);     // the first section cannot be taken away
  assert.strictEqual(editTempo(t, { do: 'set', at: 1, bpm: 5 }), null);
  // a tempo typed over what was heard is no longer the heard one
  assert.strictEqual(editTempo(t, { do: 'set', at: 1, bpm: 100 })!.confidence, undefined);
});

test('the engine quantises to the section the track is in', () => {
  const tempo = { bpm: 120, first: 0, bar: 4, sections: [{ from: 8, bpm: 60, first: 8, bar: 3 }] };
  const { doc, id } = build([{ op: 'cue.add', ref: 'a', cue: { type: 'audio', file: 'a.wav', tempo } }]);
  const { engine, advance } = rig(doc);
  engine.setDuration('a.wav', 60);
  engine.fire(id('a'));
  advance(5.1);                                                      // in the first section: bars of 2 s, the next at 6
  assert.ok(near(engine.toNextDownbeat(0.03)!, 0.9, 0.01), String(engine.toNextDownbeat(0.03)));
  assert.ok(near(engine.toNextDownbeat(0.03, 'beats')!, 0.4, 0.01));
  advance(3.4);                                                      // 8.5, in the second: beats of 1 s, bars of 3 s
  assert.ok(near(engine.toNextDownbeat(0.03, 'beats')!, 0.5, 0.01), String(engine.toNextDownbeat(0.03, 'beats')));
  assert.ok(near(engine.toNextDownbeat(0.03)!, 2.5, 0.01), String(engine.toNextDownbeat(0.03)));
});

// ── a sound at another rate: places in its file, its bars and its end ─────────────────────────────────────

test('a sound at a rate: the engine knows where it is in its file, when its bar comes, and when it ends', () => {
  const { doc, id } = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', file: 'a.wav', rate: 1.2, tempo: { bpm: 100, first: 0, bar: 4 }, cutAt: 24 } },
    { op: 'cue.add', ref: 'k', cue: { type: 'audio', file: 'k.wav', rate: 1.2, preservePitch: true, loop: true, tempo: { bpm: 100, first: 0, bar: 4 } } },
  ]);
  const { engine, audio, advance } = rig(doc);
  (audio as EngineAudio).rate = (...a) => audio.calls.push(['rate', ...a]);
  engine.setDuration('a.wav', 60); engine.setDuration('k.wav', 60);
  engine.fire(id('a'));
  const played = audio.calls.find((c) => c[0] === 'play')![2];
  assert.strictEqual(played.rate, 1.2);
  assert.strictEqual(played.preservePitch, false);
  advance(5);
  const a = () => engine.active().find((x) => x.id === id('a')) as SoundRow;
  assert.ok(near(a().elapsed, 6, 0.001) && a().rate === 1.2, JSON.stringify(a()));        // 5 s of clock is 6 s of file
  // its bars are 2.4 s of file, 2 s of clock at 1.2: the next (at 7.2) is 1 s away
  assert.ok(near(engine.toNextDownbeat(0.03)!, 1, 0.01), String(engine.toNextDownbeat(0.03)));
  // its rate moves (a Fade's "rate to", at once): it carries on from where it is, at the new speed
  engine.fadeRate(id('a'), 1, 0, 'rate:test');
  advance(2);
  assert.ok(near(a().elapsed, 8, 0.001), String(a().elapsed));
  assert.deepStrictEqual(audio.calls.find((c) => c[0] === 'rate'), ['rate', id('a'), 1, 0]);
  engine.fadeRate(id('a'), 1.2, 0, 'rate:test');
  // it ends at its End at (24 s of file): 16 s of file away, 13.33 s of clock
  advance(13.2); assert.ok(engine.running.has(id('a')));
  advance(0.3); assert.ok(!engine.running.has(id('a')));
  // keeping its pitch, a sound streams (the audio backend can only stretch a stream)
  engine.fire(id('k'));
  const kept = audio.calls.filter((c) => c[0] === 'play').pop()![2];
  assert.strictEqual(kept.preservePitch, true);
  assert.strictEqual(kept.exact, false);
  // …and while stretched it is not held in a section
  assert.strictEqual(engine.toggleHold(id('k'), { start: 4, end: 8 }, true), null);
});

test('a sound at its own speed is told nothing of rates, though it has a tempo', () => {
  const { doc, id } = build([{ op: 'cue.add', ref: 'a', cue: { type: 'audio', file: 'a.wav', tempo: { bpm: 100, first: 0, bar: 4 } } }]);
  const { engine, audio } = rig(doc);
  engine.fire(id('a'));
  assert.deepStrictEqual(Object.keys(audio.calls.find((c) => c[0] === 'play')![2]).sort(), ['bus', 'exact', 'file', 'from', 'gainDb', 'loop']);
});
