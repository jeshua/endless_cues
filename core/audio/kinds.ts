/**
 * What kind of sound a bus carries, and what follows from it.
 *
 * A bus has a `kind`: music, voice (recorded dialogue and voice-over), effects, ambience (beds and loops) or live
 * (microphones). A bus that does not say (every bus of a show from before kinds) is read from its id and name
 * (`kindOf`), which decides only what it is CALLED and where a new sound is offered: nothing about how an old
 * show plays changes because of a kind it never wrote down.
 *
 * A KIND IS A LABEL. By itself it does nothing to any sound: a new show, and a show brought in from QLab, play
 * as a plain cue list. Everything a kind could bring is a switch that is off until a person turns it on, and
 * is written on the bus or in the show where it can be seen (docs/specs/05-audio.md has the table):
 *
 *   bus.stopFade      s: a sound on this bus that is stopped (a Stop cue, the ■ beside it) fades out over this
 *                     long instead of cutting. Suggested for a music bus: 1.5 s.
 *   bus.oneAtATime    s: a sound starting on this bus takes over from whatever is playing on it, crossfading
 *                     over this long. Suggested for an ambience bus: 3 s.
 *   bus.noDuck        true: a sound on this bus is left alone by another cue's "Duck others while running".
 *                     Suggested for a live bus.
 *   settings.audio.ducking   which kinds dip under which, each with its own depth and times (`duckRules`); `on` false until switched on.
 *   settings.audio.sortNew   true: a newly added sound is listened to and put on the bus for its kind.
 *
 * `defaultsOf(kind)` is what is SUGGESTED for a bus of a kind; `withSuggested` writes it, when asked.
 *
 * Also here: where the speech is in a recorded voice (`speechSpans`, from the waveform the app already has),
 * which is what lets music duck a moment BEFORE a voice-over speaks; and a guess at what kind of sound a file
 * is (`guessKind`), from its length and its signal, for a newly added sound.
 *
 * Plain data and arithmetic: no Electron, no audio API.
 */
import { tempoMap, MIN_CONFIDENCE } from './tempo';

export type Kind = 'music' | 'voice' | 'effects' | 'ambience' | 'live';
/** A bus as its kind is read from it (settings.audio.buses), with the switches a kind may suggest. */
export interface KindBus { id: string; name?: string; kind?: string; stopFade?: unknown; oneAtATime?: unknown; noDuck?: unknown }
/** How a kind dips under the ones it is ducked by. */
export interface DuckUnder { depth: number; attack: number; hold: number; release: number; range: 'voice' | 'all' }
/** A show's ducking by kind, every number filled in. */
export interface Ducking { on: boolean; threshold: number; by: string[]; under: Record<string, DuckUnder> }
/** An older show's one pair (settings.audio.duck). */
export interface DuckPair { on?: boolean; key?: string; target?: string; threshold?: unknown; depth?: unknown; attack?: unknown; hold?: unknown; release?: unknown; range?: string }
/** What of a show's audio settings the kinds read. */
export interface KindAudio { buses?: KindBus[]; ducking?: { on?: unknown; threshold?: unknown; by?: unknown; under?: unknown } | null; duck?: DuckPair | null }
/** One rule of the ducker as the sound window runs it: a bus that dips, and the buses it listens to. */
export type DuckRule = { target: string; keys: string[]; threshold: number } & DuckUnder;
/** What the cue engine needs of a bus. */
export interface BusRules { stopFade: number; oneAtATime: number; live: boolean }

const KINDS: Record<string, { label: string; what: string }> = {
  music: { label: 'Music', what: 'Songs, underscore, playback. Suggested: a stop fades over 1.5 s.' },
  voice: { label: 'Voice', what: 'Recorded dialogue and voice-over. Ducking by kind listens to it, and reads a recorded voice ahead.' },
  effects: { label: 'Effects', what: 'One-shots: door slams, phones, thunder. Nothing is suggested: they start at once and stop dead.' },
  ambience: { label: 'Ambience', what: 'Beds and loops: rain, room tone, a crowd. Suggested: one at a time, crossfading over 3 s; a stop fades over 2 s.' },
  live: { label: 'Live', what: 'Microphones and line inputs. Ducking by kind listens to it. Suggested: never ducked by a cue that ducks the others.' },
};
const KIND_ORDER: Kind[] = ['music', 'voice', 'effects', 'ambience', 'live'];

/** A bus's kind: the one it says, else read from its id and name (a show from before kinds). */
function kindOf(bus: Omit<KindBus, 'id'> & { id?: string } | null | undefined): Kind {
  if (bus && KINDS[bus.kind!]) return bus.kind as Kind;
  const t = `${(bus && bus.id) || ''} ${(bus && bus.name) || ''}`.toLowerCase();
  if (/\b(mic|mics|microphone|live|input|radio mic|lav)/.test(t)) return 'live';
  if (/\b(vocal|vocals|voice|voices|vo|v\.o|dialog|dialogue|speech|narrat)/.test(t)) return 'voice';
  if (/\b(amb|ambience|ambient|atmos|bed|beds|room tone|background)/.test(t)) return 'ambience';
  if (/\b(music|mx|band|track|tracks|song|songs|score|playback)/.test(t)) return 'music';
  return 'effects';
}

/** What is SUGGESTED for a bus of a kind. Nothing writes these by itself: choosing a kind only names the bus, and
 *  "Use what is suggested" (Settings ▸ Audio) is the person asking for them. */
function defaultsOf(kind: string): { stopFade?: number; oneAtATime?: number; noDuck?: boolean } {
  if (kind === 'music') return { stopFade: 1.5 };
  if (kind === 'ambience') return { stopFade: 2, oneAtATime: 3 };
  if (kind === 'live') return { noDuck: true };
  return {};
}

/** A bus with what is suggested for its kind switched on, in place of whatever it had of these. */
function withSuggested<B extends KindBus>(bus: B) {
  const { stopFade, oneAtATime, noDuck, ...rest } = bus;
  return { ...rest, ...defaultsOf(kindOf(bus)) };
}

const secsOf = (v: unknown, max: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(max, n) : 0; };
/** What the cue engine needs of the buses: { busId: { stopFade, oneAtATime, live } }, only for a bus with any. */
function rulesOf(audio: KindAudio | null | undefined) {
  const out: Record<string, BusRules> = {};
  for (const b of (audio && audio.buses) || []) {
    const r = { stopFade: secsOf(b.stopFade, 60), oneAtATime: secsOf(b.oneAtATime, 60), live: b.noDuck === true };
    if (r.stopFade || r.oneAtATime || r.live) out[b.id] = r;
  }
  return out;
}

// ── ducking ───────────────────────────────────────────────────────────────────
// "These kinds duck under those": the kinds in `by` (voice, live) are listened to, and each kind in `under` dips
// while any of them sounds, by its own depth and at its own times.
// It is OFF until a person switches it on: a new show plays as a plain cue list.
const DUCKING: Ducking = {
  on: false, threshold: -35, by: ['voice', 'live'],
  under: {
    music: { depth: -8, attack: 0.05, hold: 0.5, release: 1, range: 'voice' },
    ambience: { depth: -4, attack: 0.1, hold: 0.5, release: 1.5, range: 'voice' },
  },
};
const num = (v: unknown, d: number, lo: number, hi: number) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
const underOf = (u: { depth?: unknown; attack?: unknown; hold?: unknown; release?: unknown; range?: unknown } | null | undefined, d: DuckUnder): DuckUnder => ({ depth: num(u && u.depth, d.depth, -60, 0), attack: num(u && u.attack, d.attack, 0.005, 5), hold: num(u && u.hold, d.hold, 0, 10), release: num(u && u.release, d.release, 0.02, 20), range: u && u.range === 'all' ? 'all' : u && u.range === 'voice' ? 'voice' : d.range });

/** The show's ducking by kind with every number filled in, or null for a show that has none (an older show: its
 *  one pair, `settings.audio.duck`, is read instead). */
function duckingOf(audio: KindAudio | null | undefined): Ducking | null {
  const d = audio && audio.ducking;
  if (!d || typeof d !== 'object') return null;
  const by = Array.isArray(d.by) ? d.by.filter((k) => KINDS[k]) : DUCKING.by;
  const under: Record<string, DuckUnder> = {};
  for (const [k, u] of Object.entries(d.under && typeof d.under === 'object' ? d.under : DUCKING.under)) if (KINDS[k] && u) under[k] = underOf(u, DUCKING.under[k] || DUCKING.under.music);
  return { on: d.on === true, threshold: num(d.threshold, DUCKING.threshold, -80, 0), by, under };
}

/** The ducker's rules as the sound window runs them: one per bus that dips, [{ target, keys, threshold, depth,
 *  attack, hold, release, range }]. A show with `ducking` is read by kind; one without, by its old single pair
 *  (`duck`: { on, key, target, … }), exactly as it always was. */
function duckRules(audio: KindAudio | null | undefined): DuckRule[] {
  const a: KindAudio = audio || {}, buses = Array.isArray(a.buses) ? a.buses : [];
  const d = duckingOf(a);
  if (!d) {
    const o = a.duck;
    if (!o || !o.on || !o.key || o.key === (o.target || 'music')) return [];
    return [{ target: o.target || 'music', keys: [o.key], threshold: Number(o.threshold), depth: Number(o.depth), attack: Number(o.attack), hold: Number(o.hold), release: Number(o.release), range: o.range === 'all' ? 'all' : 'voice' }];
  }
  if (!d.on) return [];
  const keys = buses.filter((b) => d.by.includes(kindOf(b))).map((b) => b.id);
  if (!keys.length) return [];
  // (a kind may not duck under itself: a bus that is listened to is never one that dips)
  return buses.filter((b) => d.under[kindOf(b)] && !keys.includes(b.id)).map((b) => ({ target: b.id, keys, threshold: d.threshold, ...d.under[kindOf(b)] }));
}

/** An older show's one pair, as ducking by kind: the same depth and times, on the kind its target bus is. */
function duckingFromPair(audio: KindAudio | null | undefined): Ducking {
  const o: DuckPair = (audio && audio.duck) || {}, buses = (audio && audio.buses) || [];
  const target = buses.find((b) => b.id === o.target);
  const kind = target ? kindOf(target) : 'music';
  const under = { ...DUCKING.under };
  if (o.on !== undefined) under[kind === 'voice' || kind === 'live' ? 'music' : kind] = underOf(o, DUCKING.under.music);
  return { on: !!o.on, threshold: num(o.threshold, DUCKING.threshold, -80, 0), by: [...DUCKING.by], under };
}

// ── where the speech is ───────────────────────────────────────────────────────
/**
 * The stretches of a recorded voice that are speech, from its waveform: [[from, to], …] in seconds.
 * `rms`: the level of each of the waveform's slices (0–1, evenly spaced over `secs`), which the app has already
 * drawn. A slice is speech when it is within `under` dB of the file's loud level (its 95th percentile) and above
 * `floor` dBFS; stretches closer together than `gap` s are one (the breath between two words is not a pause the
 * music should come back in), and one shorter than `min` s is a click, not a word.
 */
function speechSpans(rms: ArrayLike<number> | null | undefined, secs: number, { under = 30, floor = -55, gap = 0.6, min = 0.08 } = {}) {
  if (!Array.isArray(rms) && !(rms instanceof Float32Array)) return [];
  const n = rms.length;
  if (!n || !(secs > 0)) return [];
  const sorted = Array.from(rms).sort((a, b) => a - b), loud = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
  if (!(loud > 0)) return [];
  const line = Math.max(loud * Math.pow(10, -under / 20), Math.pow(10, floor / 20)), per = secs / n;
  const spans: [number, number][] = [];
  let from = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && rms[i] >= line;
    if (on && from < 0) from = i;
    if (!on && from >= 0) { spans.push([from * per, i * per]); from = -1; }
  }
  const joined: [number, number][] = [];
  for (const s of spans) { const last = joined[joined.length - 1]; if (last && s[0] - last[1] < gap) last[1] = s[1]; else joined.push([...s]); }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return joined.filter((s) => s[1] - s[0] >= min).map((s) => [r2(s[0]), r2(s[1])]);
}

// ── what kind of sound is this? ───────────────────────────────────────────────
/** One second-order filter run over a signal (the cookbook's), returning the energy that came through. */
function bandEnergy(x: ArrayLike<number>, rate: number, type: 'low' | 'high', hz: number) {
  const w = 2 * Math.PI * hz / rate, c = Math.cos(w), al = Math.sin(w) / (2 * 0.7071);
  const b = type === 'low' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  const a0 = 1 + al, a1 = -2 * c / a0, a2 = (1 - al) / a0, b0 = b[0] / a0, b1 = b[1] / a0, b2 = b[2] / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, e = 0;
  for (let i = 0; i < x.length; i++) { const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; e += y * y; }
  return e;
}

/**
 * What a sound's signal says it is: { secs, active, pauses, swing, speechBand, lows, pulse }.
 *   active      the share of it (between its first and last sound) that is sounding, 0–1
 *   pauses      silences of 0.15 to 2 s inside it, per minute (speech has many; a bed has none)
 *   swing       how far its level moves while it sounds: the spread (dB) of its 20 ms levels
 *   speechBand  the share of its energy above 250 Hz (speech has almost nothing under its fundamental)
 *   lows        the share under 150 Hz (a kick, a bass, a rumble)
 *   pulse       a steady tempo found in it (bpm), or 0
 * `x`: mono samples (11 kHz is plenty), `rate` their sample rate.
 */
function featuresOf(x: Float32Array, rate: number, { tempo }: { tempo?: ReturnType<typeof tempoMap> } = {}) {
  const secs = x.length / rate, hop = Math.max(1, Math.round(rate * 0.02)), frames = Math.floor(x.length / hop);
  const lev = new Float32Array(frames);
  let total = 0, top = 0;
  for (let f = 0; f < frames; f++) { let q = 0; for (let i = f * hop; i < (f + 1) * hop; i++) q += x[i] * x[i]; total += q; lev[f] = Math.sqrt(q / hop); if (lev[f] > top) top = lev[f]; }
  if (!(top > 1e-4)) return { secs, silent: true, active: 0, pauses: 0, swing: 0, speechBand: 0, lows: 0, pulse: 0 };
  const line = Math.max(top * Math.pow(10, -35 / 20), Math.pow(10, -60 / 20));
  let first = 0, last = frames - 1;
  while (first < frames && lev[first] < line) first++;
  while (last > first && lev[last] < line) last--;
  let on = 0, pauses = 0, run = 0;
  const dbs: number[] = [];
  for (let f = first; f <= last; f++) {
    if (lev[f] >= line) { on++; dbs.push(20 * Math.log10(lev[f])); if (run * 0.02 >= 0.15 && run * 0.02 <= 2) pauses++; run = 0; } else run++;
  }
  const span = Math.max(1, last - first + 1), mean = dbs.reduce((a, b) => a + b, 0) / dbs.length;
  const swing = Math.sqrt(dbs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / dbs.length);
  let pulse = 0;
  if (secs >= 8) {
    let t = tempo;
    if (t === undefined) { try { t = tempoMap(x, rate); } catch { t = null; } }
    if (t && t.confidence >= MIN_CONFIDENCE) pulse = t.bpm;
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { secs: r2(secs), active: r2(on / span), pauses: r2(pauses / (span * 0.02 / 60)), swing: r2(swing),
    speechBand: r2(bandEnergy(x, rate, 'high', 250) / (total || 1)), lows: r2(bandEnergy(x, rate, 'low', 150) / (total || 1)), pulse };
}

/**
 * A guess at the kind of a sound, with the reason in words: { kind, why, features }. The rules, in order:
 *   1. nothing in it, or under 1.5 s                                         effects
 *   2. a steady pulse (a tempo found, 8 s or more of it)                      music
 *   3. pauses like speech (6 or more a minute), a level that swings (5 dB or
 *      more), almost nothing under 150 Hz, most of it above 250 Hz            voice
 *   4. under 15 s                                                            effects
 *   5. 20 s or more, sounding nearly all the time, its level steady (under
 *      4 dB of swing)                                                        ambience
 *   6. half a minute or more                                                 music (the rule before kinds); else effects
 * It is a guess: the app shows it and the person confirms or changes it.
 */
function guessKind(x: Float32Array, rate: number, opts: { tempo?: ReturnType<typeof tempoMap> } = {}) {
  const f = featuresOf(x, rate, opts);
  const say = (kind: Kind, why: string) => ({ kind, why, features: f });
  if (f.silent) return say('effects', 'nothing could be heard in it');
  if (f.secs < 1.5) return say('effects', `it is short (${f.secs} s)`);
  if (f.pulse) return say('music', `a steady pulse, ${Math.round(f.pulse)} bpm`);
  if (f.pauses >= 6 && f.swing >= 5 && f.lows < 0.15 && f.speechBand >= 0.6) return say('voice', `it pauses like speech (${Math.round(f.pauses)} times a minute) and has no bass`);
  if (f.secs < 15) return say('effects', `it is short (${Math.round(f.secs)} s) with no pulse`);
  if (f.secs >= 20 && f.active >= 0.95 && f.swing < 4) return say('ambience', 'long, and steady in level, with no pulse');
  if (f.secs >= 30) return say('music', 'long, with no clear pulse or speech');
  return say('effects', 'neither long, steady nor speech');
}

/** The bus a sound of a kind goes on: the show's first bus of that kind, or null (none: it takes the cue's usual bus). */
function busFor(audio: KindAudio | null | undefined, kind: string) {
  const b = ((audio && audio.buses) || []).find((x) => kindOf(x) === kind);
  return b ? b.id : null;
}

export { KINDS, KIND_ORDER, DUCKING, kindOf, defaultsOf, withSuggested, rulesOf, duckingOf, duckRules, duckingFromPair, speechSpans, featuresOf, guessKind, busFor };
