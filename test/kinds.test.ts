// The kinds of sound: what a bus's kind is, what it asks of the engine, ducking by kind, where the speech is in a
// voice, and the guess at what a new sound is.
import test from 'node:test';
import assert from 'node:assert';
import * as kinds from '../core/audio/kinds';
import * as show from '../core/show/show';
import { rig, build } from './helpers';
import * as sig from '../app/main/test-signals';

test('a bus’s kind is the one it says, else effects', () => {
  const k = (id: string, name: string, kind?: string) => kinds.kindOf({ id, name, ...(kind ? { kind } : {}) });
  assert.strictEqual(k('bus4', 'Radio mics', 'live'), 'live');
  assert.strictEqual(k('music', 'Music', 'ambience'), 'ambience', 'what it says, whatever its name');
  assert.strictEqual(k('vocals', 'Vocals'), 'effects', 'a name is not a kind');
  assert.strictEqual(k('x', 'y', 'nonsense'), 'effects');
});

// The rule: the default is simple. Nothing clever happens to a sound unless a person switched it on.
test('a new show plays as a plain cue list: its buses have kinds as labels, and every behaviour a kind could bring is off', () => {
  const doc = show.newShow('T'), a = doc.settings.audio;
  assert.deepStrictEqual(a.buses.map((b) => b.kind), ['music', 'effects', 'voice']);
  assert.strictEqual(a.ducking, undefined, 'ducking by kind: not written until asked for');
  assert.strictEqual(kinds.duckingOf(a).on, false, '…and off, read as the defaults');
  assert.strictEqual(kinds.DUCKING.on, false, '…which are off');
  assert.deepStrictEqual(kinds.duckRules(a), [], 'so nothing ducks, and no voice is read ahead (look-ahead is part of ducking)');
  assert.deepStrictEqual(kinds.rulesOf(a), {}, 'no stop fades, no bus plays one at a time, no bus is exempt from a cue’s duck');
  assert.ok(a.buses.every((b) => b.stopFade === undefined && b.oneAtATime === undefined && b.noDuck === undefined));
  assert.strictEqual(a.sortNew, false, 'a new sound is not listened to or sorted');
  assert.strictEqual(a.chains, undefined);
  // and it plays so: a Stop cue on the music bus cuts, a second sound on a bus overlaps the first
  const s = build([
    { op: 'cue.add', ref: 'm', cue: { type: 'audio', file: 'm.wav', bus: 'music' } },
    { op: 'cue.add', ref: 'n', cue: { type: 'audio', file: 'n.wav', bus: 'music' } },
    { op: 'cue.add', cue: { type: 'stop', target: '@m' } },
  ]);
  const r = rig(s.doc);
  r.engine.busRules = kinds.rulesOf(s.doc.settings.audio);
  r.engine.setDuration('m.wav', 100); r.engine.setDuration('n.wav', 100);
  r.engine.go(); r.engine.go(); r.engine.go();
  assert.deepStrictEqual(r.audio.calls.map((c) => c[0]), ['play', 'play', 'stop']);
  assert.ok(r.engine.running.has(s.id('n')));
  // a cue made in it has no chain and no eq: a plain wire
  assert.strictEqual(s.doc.lists[0].cues[0].chain, undefined);
  assert.strictEqual(s.doc.lists[0].cues[0].eq, undefined);
  // switched on, ducking by kind is music under the voice bus
  assert.deepStrictEqual(kinds.duckRules({ ...a, ducking: { ...kinds.DUCKING, on: true } }), [{ target: 'music', keys: ['vocals'], threshold: -35, depth: -8, attack: 0.05, hold: 0.5, release: 1, range: 'voice' }]);
});

test('ducking by kind: every bus of a kind that ducks, under every bus that is listened to, each kind at its own depth', () => {
  const audio = { buses: [{ id: 'music', name: 'Music', kind: 'music' }, { id: 'b2', name: 'Rain', kind: 'ambience' }, { id: 'effects', name: 'Effects', kind: 'effects' }, { id: 'vocals', name: 'Vocals', kind: 'voice' }, { id: 'mics', name: 'Mics', kind: 'live' }],
    ducking: { on: true, under: { music: { depth: -10 }, ambience: { depth: -3, range: 'all' } } } };
  assert.deepStrictEqual(kinds.duckRules({ ...audio, ducking: { under: audio.ducking.under } }), [], 'not on unless it says so');
  const rules = kinds.duckRules(audio);
  assert.deepStrictEqual(rules.map((r) => [r.target, r.keys, r.depth, r.range]), [['music', ['vocals', 'mics'], -10, 'voice'], ['b2', ['vocals', 'mics'], -3, 'all']]);
  assert.deepStrictEqual(kinds.duckRules({ ...audio, ducking: { on: false } }), []);
  // only live sounds are listened to
  assert.deepStrictEqual(kinds.duckRules({ ...audio, ducking: { on: true, by: ['live'] } }).map((r) => r.keys), [['mics'], ['mics']]);
  // effects are never ducked unless the show says so
  assert.ok(!rules.some((r) => r.target === 'effects'));
  assert.ok(kinds.duckRules({ ...audio, ducking: { on: true, under: { effects: { depth: -6 } } } }).some((r) => r.target === 'effects' && r.depth === -6));
});

test('a kind is a label: what suits it is written on the bus only when asked for', () => {
  assert.deepStrictEqual(kinds.rulesOf({ buses: [{ id: 'm', kind: 'music' }, { id: 'a', kind: 'ambience' }, { id: 'l', kind: 'live' }] }), {}, 'a kind alone asks nothing of the engine');
  assert.deepStrictEqual(kinds.withSuggested({ id: 'music', name: 'Music', db: -3, kind: 'music' }), { id: 'music', name: 'Music', db: -3, kind: 'music', stopFade: 1.5 });
  assert.deepStrictEqual(kinds.withSuggested({ id: 'a', name: 'A', db: 0, kind: 'ambience', stopFade: 4 }), { id: 'a', name: 'A', db: 0, kind: 'ambience', stopFade: 2, oneAtATime: 3 });
  assert.deepStrictEqual(kinds.withSuggested({ id: 'l', name: 'Mics', db: 0, kind: 'live' }), { id: 'l', name: 'Mics', db: 0, kind: 'live', noDuck: true });
  assert.deepStrictEqual(kinds.withSuggested({ id: 'b', name: 'Bus 4', db: 0 }), { id: 'b', name: 'Bus 4', db: 0 }, 'a bus with no kind is effects: nothing suggested');
  assert.deepStrictEqual(kinds.withSuggested({ id: 'e', name: 'E', db: 0, kind: 'effects', stopFade: 2, oneAtATime: 3 }), { id: 'e', name: 'E', db: 0, kind: 'effects' });
  assert.deepStrictEqual(kinds.rulesOf({ buses: [{ id: 'm', stopFade: 1.5 }, { id: 'a', oneAtATime: 3 }, { id: 'l', noDuck: true }, { id: 'e' }] }),
    { m: { stopFade: 1.5, oneAtATime: 0, live: false }, a: { stopFade: 0, oneAtATime: 3, live: false }, l: { stopFade: 0, oneAtATime: 0, live: true } });
});

// ── the engine ────────────────────────────────────────────────────────────────
function three() {
  const s = build([
    { op: 'cue.add', ref: 'm', cue: { type: 'audio', file: 'm.wav', bus: 'music', name: 'm' } },
    { op: 'cue.add', ref: 'e', cue: { type: 'audio', file: 'e.wav', bus: 'effects', name: 'e' } },
    { op: 'cue.add', ref: 'sm', cue: { type: 'stop', target: '@m' } },
    { op: 'cue.add', ref: 'se', cue: { type: 'stop', target: '@e' } },
  ]);
  const r = rig(s.doc);
  r.engine.setDuration('m.wav', 100); r.engine.setDuration('e.wav', 100);
  return { ...r, s };
}

test('a bus that fades its stops: a Stop cue fades a sound on it out and then stops it; another bus’s sound still cuts', () => {
  const r = three();
  r.engine.busRules = { music: { stopFade: 1.5 } };
  r.engine.go(); r.engine.go(); r.advance(1);
  r.engine.go();                                              // stop the music
  assert.deepStrictEqual(r.audio.calls.filter((c) => c[1] === r.s.id('m')).slice(-1)[0].slice(0, 4), ['fade', r.s.id('m'), -60, 1.5]);
  assert.ok(r.engine.running.has(r.s.id('m')), 'still sounding, on its way out');
  r.engine.go();                                              // stop the effect: dead
  assert.deepStrictEqual(r.audio.calls.slice(-1)[0], ['stop', r.s.id('e')]);
  r.advance(1.6);
  assert.ok(!r.engine.running.has(r.s.id('m')));
  assert.deepStrictEqual(r.audio.calls.slice(-1)[0], ['stop', r.s.id('m')]);
});

test('…the operator’s stop fades it too, and Panic twice still cuts it', () => {
  const r = three();
  r.engine.busRules = { music: { stopFade: 1.5 } };
  r.engine.go(); r.advance(1);
  r.engine.stopCue(r.s.id('m'));
  assert.strictEqual(r.audio.calls.slice(-1)[0][0], 'fade');
  r.engine.panic(); r.engine.panic();
  assert.ok(!r.engine.running.has(r.s.id('m')));
  assert.deepStrictEqual(r.audio.calls.slice(-1)[0], ['stop', r.s.id('m')]);
});

test('a bus that plays one at a time: a new sound crossfades with the one playing there, and the first to start comes in as it is', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', file: 'a.wav', bus: 'effects', name: 'rain', loop: true } },
    { op: 'cue.add', ref: 'b', cue: { type: 'audio', file: 'b.wav', bus: 'effects', name: 'wind', loop: true, gainDb: -6 } },
    { op: 'cue.add', ref: 'm', cue: { type: 'audio', file: 'm.wav', bus: 'music', name: 'm' } },
  ]);
  const r = rig(s.doc);
  for (const f of ['a.wav', 'b.wav', 'm.wav']) r.engine.setDuration(f, 100);
  r.engine.busRules = { effects: { oneAtATime: 3 } };
  r.engine.go();
  assert.strictEqual(r.audio.calls.find((c) => c[0] === 'play')![2].gainDb, 0, 'nothing to take over from: it starts at its level');
  r.advance(5);
  r.engine.go();
  const calls = r.audio.calls.slice(-3).map((c) => c.slice(0, 4));
  assert.deepStrictEqual(calls, [['fade', s.id('a'), -60, 3], ['play', s.id('b'), r.audio.calls.slice(-2)[0][2]], ['fade', s.id('b'), -6, 3]]);
  assert.strictEqual(r.audio.calls.slice(-2)[0][2].gainDb, -60, 'the new one comes up from silence');
  r.advance(3.1);
  assert.deepStrictEqual([...r.engine.running.keys()], [s.id('b')]);
  r.engine.go();                                              // music, on another bus: the ambience plays on
  assert.ok(r.engine.running.has(s.id('b')) && r.engine.running.has(s.id('m')));
  assert.ok(!r.audio.calls.slice(-2).some((c) => c[0] === 'fade' && c[1] === s.id('b')));
});

test('a microphone on a bus set to be left alone is not held down by a cue that ducks the others', () => {
  const s = build([
    { op: 'show.set', path: 'settings.audio.buses', value: [{ id: 'music', name: 'Music', db: 0 }, { id: 'effects', name: 'Effects', db: 0 }, { id: 'mics', name: 'Mics', db: 0, kind: 'live', noDuck: true }] },
    { op: 'cue.add', ref: 'mic', cue: { type: 'mic', bus: 'mics' } },
    { op: 'cue.add', ref: 'm', cue: { type: 'audio', file: 'm.wav', bus: 'music' } },
    { op: 'cue.add', ref: 'vo', cue: { type: 'audio', file: 'vo.wav', bus: 'effects', duckOthers: -12, duckTime: 0.5 } },
  ]);
  const ducked: [string, number][] = [];
  const r = rig(s.doc);
  r.audio.duck = (k, db) => ducked.push([k, db]);
  r.engine.setDuration('m.wav', 100); r.engine.setDuration('vo.wav', 10);
  r.engine.busRules = kinds.rulesOf(s.doc.settings.audio);
  r.engine.go(); r.engine.go(); r.engine.go();
  assert.deepStrictEqual(ducked, [[s.id('m'), -12]]);
});

test('a Fade cue’s chainTo is sent to the sound it fades, over the fade’s time', () => {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', file: 'a.wav', chain: { lowpass: { hz: 20000 } } } },
    { op: 'cue.add', ref: 'f', cue: { type: 'fade', target: '@a', db: -6, duration: 8, chainTo: { lowpass: { hz: 400 } } } },
  ]);
  assert.deepStrictEqual(s.doc.lists[0].cues[0].chain, { lowpass: { hz: 20000, slope: 12 } });
  const swept: unknown[][] = [];
  const r = rig(s.doc);
  r.audio.sweep = (...a) => swept.push(a);
  r.engine.setDuration('a.wav', 100);
  r.engine.go(); r.engine.go();
  assert.deepStrictEqual(swept, [[s.id('a'), { lowpass: { hz: 400 } }, 8]]);
});

// ── speech, and the guess ─────────────────────────────────────────────────────
test('where the speech is: stretches above the floor, a breath joined, a click dropped', () => {
  // 10 s in 100 slices: speech 1–3 s, a 0.3 s breath, speech 3.3–4 s, a long pause, a click at 7 s, speech 8–9 s
  const rms = new Array(100).fill(0.001);
  for (let i = 10; i < 30; i++) rms[i] = 0.2;
  for (let i = 33; i < 40; i++) rms[i] = 0.15;
  rms[70] = 0.2;
  for (let i = 80; i < 90; i++) rms[i] = 0.25;
  assert.deepStrictEqual(kinds.speechSpans(rms, 10, { min: 0.15 }), [[1, 4], [8, 9]]);
  assert.deepStrictEqual(kinds.speechSpans(new Array(50).fill(0), 10), []);
  assert.deepStrictEqual(kinds.speechSpans(null, 10), []);
});

test('the kind of a sound is guessed from what it is: speech, music, an effect, a bed', () => {
  const g = (x: Float32Array) => kinds.guessKind(x, sig.RATE);
  assert.strictEqual(g(sig.speech(20)).kind, 'voice');
  assert.strictEqual(g(sig.speech(6, 7)).kind, 'voice', 'a short line is still a voice');
  assert.strictEqual(g(sig.speech(90, 4)).kind, 'voice', 'and a long speech is not music because it is long');
  assert.strictEqual(g(sig.music(40)).kind, 'music');
  assert.match(g(sig.music(40, 96)).why, /96 bpm/);
  assert.strictEqual(g(sig.hit()).kind, 'effects');
  assert.strictEqual(g(sig.hit(5)).kind, 'effects');
  assert.strictEqual(g(sig.bed(45)).kind, 'ambience');
  assert.strictEqual(g(sig.bed(12)).kind, 'effects', 'a short steady sound is an effect');
  assert.strictEqual(g(new Float32Array(sig.RATE * 3)).kind, 'effects');
  // a sound that is none of them and is long is music
  const odd = sig.bed(40); for (let i = 0; i < odd.length; i++) odd[i] *= 0.05 + 0.95 * Math.abs(Math.sin(i / sig.RATE * 0.9));
  assert.strictEqual(g(odd).kind, 'music');
});

test('a guessed kind goes to the show’s first bus of that kind, or to none', () => {
  const audio = { buses: [{ id: 'music', name: 'Music', kind: 'music' }, { id: 'effects', name: 'Effects', kind: 'effects' }, { id: 'vocals', name: 'Vocals', kind: 'voice' }] };
  assert.strictEqual(kinds.busFor(audio, 'voice'), 'vocals');
  assert.strictEqual(kinds.busFor(audio, 'music'), 'music');
  assert.strictEqual(kinds.busFor(audio, 'ambience'), null);
});
