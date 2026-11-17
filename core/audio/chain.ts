/**
 * Sound design: the chain of tools one sound can be played through.
 *
 * A cue's `chain` is one object per tool that is in use, and nothing for a tool that is not:
 *
 *   "chain": { "highpass": { "hz": 300, "slope": 24 }, "lowpass": { "hz": 3400, "slope": 24 }, "tail": true }
 *
 * The tools always run in the one order of `TOOLS` below (filters, the cue's `eq`, gate, compressor, drive,
 * crush, pitch, chorus, tremolo, auto-pan, stereo, delay, reverb), whatever order the file writes them in. A tool
 * with `"on": false` keeps its settings and is out of the path; `"bypass": true` takes the whole chain out (A/B);
 * `"tail": true` lets a reverb or a delay ring out after the sound is stopped or ends.
 *
 *   TOOLS                      the table: every tool and every parameter (the inspector and the docs draw from it)
 *   cleanChain(value)          a chain as the show keeps it (every number made safe), or null for none. Throws on what is not one.
 *   cleanEq(value)             a cue's eq: four bands, each a dB number at its usual place or { db, hz, q }
 *   plan(chain, eq)            what is to be built: the stages in order, a signature of their structure, the tail's length
 *   build(ctx, plan, env)      the Web Audio nodes for a plan, on ANY context (the live one, or an offline one to measure)
 *   PRESETS                    the built-in chains (Phone, Radio, …)
 *   Dynamics, Crusher, PitchShifter     the kernels the worklets run (and the tests run, in Node)
 *   WORKLETS                   the worklet module's source, made from those kernels
 *
 * This file has no dependency and loads three ways, as core/timecode/timecode.js does: required by Node (the show
 * file's checks, the tests), as a plain script in the audio window, and pasted into an AudioWorklet (`SOURCE`), so
 * the gate, the compressor, the crusher and the pitch shifter the app plays are the code the tests measure.
 *
 * Nobody has listened to any of it. Everything here is checked by measurement: the kernels on synthesised signals
 * in Node, and the built chain by rendering it offline in the audio window (`measure` in app/audio/audio.html).
 */
// ── the types (stripped from the text a worklet gets, so they may live out here) ──
/** How a number reaches a playing sound when it changes: along a ratio (a frequency) or a line. */
export type Glide = 'exp' | 'lin';
/** A tool's setting: a number, a choice of numbers, a switch or a file (each has only its own fields). */
export type NumberParam = { key: string; label: string; unit: string; min: number; max: number; def: number; glide?: Glide; options?: undefined; bool?: undefined; file?: undefined };
export type ChoiceParam = { key: string; label: string; unit: string; options: number[]; def: number; min?: undefined; max?: undefined; glide?: undefined; bool?: undefined; file?: undefined };
export type SwitchParam = { key: string; label: string; bool: true; unit?: undefined; def?: undefined; min?: undefined; max?: undefined; glide?: undefined; options?: undefined; file?: undefined };
export type FileParam = { key: string; label: string; file: true; unit?: undefined; def?: undefined; min?: undefined; max?: undefined; glide?: undefined; options?: undefined; bool?: undefined };
export type Param = NumberParam | ChoiceParam | SwitchParam | FileParam;
/** A tool of the chain, as the table describes it. */
export interface Tool { key: ToolKey; label: string; group: string; help: string; params: Param[] }
export type ToolKey = 'highpass' | 'lowpass' | 'gate' | 'comp' | 'drive' | 'crush' | 'pitch' | 'chorus' | 'tremolo' | 'autopan' | 'stereo' | 'delay' | 'reverb';

/** Each tool's settings as a cleaned chain keeps them (`on: false`: kept, and out of the path). */
type Off = { on?: false };
export type FilterSettings = Off & { hz: number; slope: number };
export type ToolSettings = {
  highpass: FilterSettings;
  lowpass: FilterSettings;
  gate: Off & { threshold: number; range: number; attack: number; hold: number; release: number };
  comp: Off & { threshold: number; ratio: number; attack: number; release: number; makeup: number };
  drive: Off & { db: number; tone: number; out: number };
  crush: Off & { bits: number; hz: number };
  pitch: Off & { semitones: number; cents: number };
  chorus: Off & { rate: number; depth: number; delay: number; feedback: number; mix: number };
  tremolo: Off & { rate: number; depth: number };
  autopan: Off & { rate: number; depth: number };
  stereo: Off & { width: number; invert?: true };
  delay: Off & { time: number; feedback: number; tone: number; pingpong?: true; mix: number };
  reverb: Off & { size: number; decay: number; predelay: number; mix: number; file?: string };
};
/** A cue's `chain` as the show keeps it: only the tools in use, and the two switches. */
export type ChainValue = { [K in ToolKey]?: ToolSettings[K] } & { tail?: true; bypass?: true };

export type EqKey = 'low' | 'mid' | 'mid2' | 'high';
/** One of the eq's bands as the table has it: where it sits until it is moved. */
export interface EqBandSpec { key: EqKey; label: string; type: 'lowshelf' | 'peaking' | 'highshelf'; hz: number; q?: number }
/** A band as a cue keeps it: a level in dB at its usual place, or moved. */
export type EqBandValue = number | { db: number; hz: number; q?: number };
/** A cue's `eq` as the show keeps it: only the bands doing something. */
export type EqValue = { [K in EqKey]?: EqBandValue };
/** A band with everything filled in. */
export interface Band { type: EqBandSpec['type']; db: number; hz: number; q: number | undefined }

/** A stage of a plan: a tool that is on, with every setting (or the eq's bands). */
export type Stage = { tool: 'eq'; bands: (Band & { key: EqKey })[] } | { [K in ToolKey]: { tool: K } & Omit<ToolSettings[K], 'on'> }[ToolKey];
/** A Fade cue's `chainTo` as the show keeps it: { tool: { setting: value } }. */
export type SweepValue = Record<string, Record<string, number>>;
/** A setting of a tool that a Fade cue (or a line over the sound) can move. */
export interface Sweepable { id: string; tool: ToolKey; key: string; label: string; unit: string; min: number; max: number }
/** What the builder is given of the window: whether the worklets are on its context, and impulse-response files. */
export interface BuildEnv { worklets?: boolean; ir?: (file: string) => AudioBuffer | null }
/** What a built chain reports back: a gate's or compressor's gain reduction, an impulse-response file still to come. */
export interface ChainMeters { gate?: number; comp?: number; irWanted?: { file: string; conv: ConvolverNode } }
/** A kernel's settings, as a worklet's `set` message carries them (any left out keep their value). */
/** The pitch shifter's settings: semitones and cents, or a ratio (0.5 … 2). */
export type PitchSettings = { semitones?: number; cents?: number; ratio?: number };
// (a setter is called with the stage of its own tool: a method's parameter, so each may take its own stage)
type Setter = { set(v: Stage, secs: number): void }['set'];
type StageOf<K extends Stage['tool']> = Extract<Stage, { tool: K }>;
/** What has not been checked yet: an object from a file, or a message. */
type Loose = Record<string, unknown>;

// (a function, not plain module code: its own text is what an AudioWorklet runs, `SOURCE` below)
function factory() {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const lin = (db: number) => Math.pow(10, db / 20);

  // A parameter: a number (min, max, def; `glide` says how a change reaches a playing sound: 'exp' for a
  // frequency, 'lin' for the rest; none: the stage is built again), a choice (`options`), a switch (`bool`) or a
  // file. `live: false` on a tool: any change to it rebuilds the chain (a click may be heard).
  const N = (key: string, label: string, unit: string, min: number, max: number, def: number, glide?: Glide): NumberParam => ({ key, label, unit, min, max, def, ...(glide ? { glide } : {}) });
  const TOOLS: Tool[] = [
    { key: 'highpass', label: 'High-pass', group: 'Filters', help: 'Takes away everything below a frequency (rumble, a voice’s chest).',
      params: [N('hz', 'Below', 'Hz', 20, 20000, 80, 'exp'), { key: 'slope', label: 'Slope', unit: 'dB/oct', options: [12, 24, 48], def: 12 }] },
    { key: 'lowpass', label: 'Low-pass', group: 'Filters', help: 'Takes away everything above a frequency (a sound behind a door, under water).',
      params: [N('hz', 'Above', 'Hz', 20, 20000, 8000, 'exp'), { key: 'slope', label: 'Slope', unit: 'dB/oct', options: [12, 24, 48], def: 12 }] },
    // (the cue's `eq` field is built here, between the filters and the dynamics: it is not a tool of the chain's own)
    { key: 'gate', label: 'Gate', group: 'Dynamics', help: 'Shuts the sound below a level (hiss between lines). With a Range above −80 dB it only turns the quiet down: an expander.',
      params: [N('threshold', 'Opens above', 'dB', -80, 0, -45, 'lin'), N('range', 'Range', 'dB', -80, 0, -80, 'lin'), N('attack', 'Attack', 'ms', 0.1, 200, 2, 'lin'), N('hold', 'Hold', 'ms', 0, 2000, 80, 'lin'), N('release', 'Release', 'ms', 5, 4000, 200, 'lin')] },
    { key: 'comp', label: 'Compressor', group: 'Dynamics', help: 'Turns down what is louder than the threshold, by the ratio. Make-up brings the whole sound back up.',
      params: [N('threshold', 'Threshold', 'dB', -60, 0, -18, 'lin'), N('ratio', 'Ratio', ':1', 1, 20, 3, 'lin'), N('attack', 'Attack', 'ms', 0.1, 200, 10, 'lin'), N('release', 'Release', 'ms', 5, 4000, 200, 'lin'), N('makeup', 'Make-up', 'dB', -12, 24, 0, 'lin')] },
    { key: 'drive', label: 'Drive', group: 'Character', help: 'Distortion: the sound pushed into a soft clip. Tone rolls the top off what comes out.',
      params: [N('db', 'Drive', 'dB', 0, 36, 12), N('tone', 'Tone', 'Hz', 500, 20000, 8000, 'exp'), N('out', 'Output', 'dB', -24, 12, 0, 'lin')] },
    { key: 'crush', label: 'Bit-crush', group: 'Character', help: 'Fewer bits and a lower sample rate: an old sampler, a toy, a game.',
      params: [N('bits', 'Bits', '', 1, 16, 8, 'lin'), N('hz', 'Sample rate', 'Hz', 200, 48000, 8000, 'lin')] },
    { key: 'pitch', label: 'Pitch shift', group: 'Pitch', help: 'Higher or lower without changing the speed (Rate, on the Audio tab, is the tape way: both move together). It adds about 30 ms of delay, and is rough on dense music.',
      params: [N('semitones', 'Semitones', 'st', -12, 12, 0, 'lin'), N('cents', 'Cents', 'ct', -100, 100, 0, 'lin')] },
    { key: 'chorus', label: 'Chorus / flanger', group: 'Modulation', help: 'A copy of the sound whose delay drifts. A long delay (15 ms) is a chorus; a short one (2 ms) with feedback is a flanger.',
      params: [N('rate', 'Rate', 'Hz', 0.05, 10, 0.8, 'lin'), N('depth', 'Depth', 'ms', 0, 10, 3, 'lin'), N('delay', 'Delay', 'ms', 0.5, 40, 15, 'lin'), N('feedback', 'Feedback', '', 0, 0.9, 0, 'lin'), N('mix', 'Mix', '', 0, 1, 0.5, 'lin')] },
    { key: 'tremolo', label: 'Tremolo', group: 'Modulation', help: 'The level wobbles.',
      params: [N('rate', 'Rate', 'Hz', 0.05, 40, 5, 'lin'), N('depth', 'Depth', '', 0, 1, 0.5, 'lin')] },
    { key: 'autopan', label: 'Auto-pan', group: 'Modulation', help: 'The sound swings from side to side.',
      params: [N('rate', 'Rate', 'Hz', 0.02, 20, 0.5, 'lin'), N('depth', 'Depth', '', 0, 1, 1, 'lin')] },
    { key: 'stereo', label: 'Stereo', group: 'Character', help: 'Width: 0 is mono, 1 as recorded, 2 wider. Invert turns the sound’s polarity over.',
      params: [N('width', 'Width', '', 0, 2, 1, 'lin'), { key: 'invert', label: 'Invert', bool: true }] },
    { key: 'delay', label: 'Delay', group: 'Space', help: 'An echo of this sound alone. Feedback is how much of each repeat comes round again; Tone darkens each repeat; Ping-pong throws them from side to side.',
      params: [N('time', 'Time', 's', 0.01, 4, 0.35, 'lin'), N('feedback', 'Feedback', '', 0, 0.95, 0.35, 'lin'), N('tone', 'Tone', 'Hz', 200, 20000, 6000, 'exp'), { key: 'pingpong', label: 'Ping-pong', bool: true }, N('mix', 'Mix', '', 0, 1, 0.3, 'lin')] },
    { key: 'reverb', label: 'Reverb', group: 'Space', help: 'A room of this sound’s own. Size is how far apart its first reflections are; Decay how long it rings. Or the room in an impulse-response file from the show’s media.',
      params: [N('size', 'Size', '', 0, 1, 0.5), N('decay', 'Decay', 's', 0.1, 12, 1.8), N('predelay', 'Pre-delay', 'ms', 0, 250, 20, 'lin'), N('mix', 'Mix', '', 0, 1, 0.25, 'lin'), { key: 'file', label: 'Impulse response', file: true }] },
  ];
  const TOOL: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.key, t]));

  function cleanTool(t: Tool, raw: unknown) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`chain: ${t.key} is an object of its settings, as in { ${t.params.filter((p) => p.def !== undefined).slice(0, 2).map((p) => `"${p.key}": ${p.def}`).join(', ')} }`);
    const out: Record<string, number | boolean | string> = {};
    for (const p of t.params) {
      const v = (raw as Loose)[p.key];
      if (p.bool) { if (v === true || v === 'true' || v === 1) out[p.key] = true; continue; }
      if (p.file) { if (typeof v === 'string' && v.trim()) out[p.key] = v.trim(); continue; }
      const n = v === undefined || v === null || v === '' ? p.def : Number(v);
      if (!Number.isFinite(n)) throw new Error(`chain: ${t.key}.${p.key} is a number${p.options ? ` (one of ${p.options.join(', ')})` : ` (${p.min} to ${p.max})`}`);
      if (p.options) out[p.key] = p.options.reduce((best, o) => (Math.abs(o - n) < Math.abs(best - n) ? o : best), p.options[0]);
      else out[p.key] = r3(clamp(n, p.min, p.max));
    }
    if ((raw as Loose).on === false || (raw as Loose).on === 'false') out.on = false;
    return out;
  }

  /** A chain as the show keeps it: only the tools it names, each with every one of its settings written out (so
   *  the file says what will be heard, and a later change of a default changes no show). null: no chain. */
  function cleanChain(value: unknown): ChainValue | null {
    if (value == null || value === '') return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`chain: an object with one entry per tool in use (${TOOLS.map((t) => t.key).join(', ')})`);
    const out: Loose = {};
    for (const k of Object.keys(value)) if (!TOOL[k] && !['tail', 'bypass'].includes(k)) throw new Error(`chain: there is no tool called “${k}” (the tools are ${TOOLS.map((t) => t.key).join(', ')}; and "tail" and "bypass", true or false)`);
    for (const t of TOOLS) if ((value as Loose)[t.key] != null) out[t.key] = cleanTool(t, (value as Loose)[t.key]);
    if (!Object.keys(out).length) return null;
    if ((value as Loose).tail === true) out.tail = true;
    if ((value as Loose).bypass === true) out.bypass = true;
    return out as ChainValue;
  }

  // ── a cue's eq: four bands ──────────────────────────────────────────────────
  // A band is a level in dB at its usual place (the three-band eq every show before this had: { low, mid, high }),
  // or { db, hz, q } to move it. `mid2` is the second bell.
  const EQ_BANDS: EqBandSpec[] = [
    { key: 'low', label: 'Low shelf', type: 'lowshelf', hz: 250 },
    { key: 'mid', label: 'Bell 1', type: 'peaking', hz: 1000, q: 0.8 },
    { key: 'mid2', label: 'Bell 2', type: 'peaking', hz: 3000, q: 0.8 },
    { key: 'high', label: 'High shelf', type: 'highshelf', hz: 4000 },
  ];
  const EQ_MIN = -40, EQ_MAX = 6;             // (a boost stops at +6, as the strip’s does)
  /** One band, with everything filled in: { type, hz, q, db } (db 0: the band does nothing). */
  function bandOf(b: EqBandSpec, raw: unknown): Band {
    const o = (raw && typeof raw === 'object' ? raw : { db: raw }) as Loose;
    const db = Number(o.db), hz = Number(o.hz), q = Number(o.q);
    return { type: b.type, db: Number.isFinite(db) ? Math.round(clamp(db, EQ_MIN, EQ_MAX) * 2) / 2 : 0,
      hz: Number.isFinite(hz) && o.hz != null && o.hz !== '' ? Math.round(clamp(hz, 20, 20000)) : b.hz,
      q: b.type === 'peaking' ? (Number.isFinite(q) && o.q != null && o.q !== '' ? Math.round(clamp(q, 0.1, 18) * 100) / 100 : b.q) : 0 };
  }
  /** A cue's eq as the show keeps it: only the bands doing something, each a plain dB number while it sits at its
   *  usual place (so a show written before the eq had four bands reads, and is written, exactly as it was). */
  function cleanEq(value: unknown): EqValue | null {
    if (value == null || value === '') return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('eq: { low, mid, mid2, high }, each a level in dB or { db, hz, q }');
    const out: EqValue = {};
    for (const b of EQ_BANDS) {
      if ((value as Loose)[b.key] == null || (value as Loose)[b.key] === '') continue;
      const x = bandOf(b, (value as Loose)[b.key]);
      if (!x.db) continue;
      const moved = x.hz !== b.hz || (b.type === 'peaking' && x.q !== b.q);
      out[b.key] = moved ? { db: x.db, hz: x.hz, ...(b.type === 'peaking' ? { q: x.q } : {}) } : x.db;
    }
    return Object.keys(out).length ? out : null;
  }

  // ── the plan ────────────────────────────────────────────────────────────────
  // Butterworth sections for a slope: the Q of each second-order filter in the cascade.
  const SLOPE_Q: Record<number, number[]> = { 12: [0.7071], 24: [0.5412, 1.3066], 48: [0.5098, 0.6013, 0.9, 2.5629] };
  const TAIL_MAX = 30;            // s: the longest a tail is given to ring before its voice is let go
  /** How long a delay's repeats take to fall 60 dB. */
  const delayTail = (d: { time: number; feedback: number }) => (d.feedback > 0.001 ? Math.min(TAIL_MAX, d.time * (1 + Math.ceil(Math.log(0.001) / Math.log(d.feedback)))) : d.time) + 0.05;

  /**
   * What is to be built for a cue's `chain` and `eq`: { stages, sig, tail, tailSecs }.
   * `stages` are the tools that are on, in the order they run, with every setting filled in. `sig` changes when
   * the STRUCTURE does (which tools, a slope, ping-pong, an impulse-response file): the same `sig` means a playing
   * sound's chain can be moved to the new settings in place (`set`), a different one that it is built again.
   * A bypassed chain, or none, is no stages: the sound is the plain wire it was.
   */
  function plan(chain: unknown, eq: unknown) {
    let c: ChainValue | null = null, e: EqValue | null = null;
    try { c = cleanChain(chain); } catch { c = null; }
    try { e = cleanEq(eq); } catch { e = null; }
    const stages: Stage[] = [];
    if (!(c && c.bypass)) {
      for (const t of TOOLS) {
        if (t.key === 'gate' && e) stages.push({ tool: 'eq', bands: EQ_BANDS.filter((b) => e[b.key] != null).map((b) => ({ key: b.key, ...bandOf(b, e[b.key]) })) });
        const s: Loose | null | undefined = c && c[t.key];
        if (!s || s.on === false) continue;
        // a pitch shift of nothing, a width of 1 that is not inverted: in the file, and not in the path
        if (t.key === 'pitch' && !s.semitones && !s.cents) continue;
        if (t.key === 'stereo' && s.width === 1 && !s.invert) continue;
        const { on, ...settings } = s;
        stages.push({ tool: t.key, ...settings } as Stage);
      }
    }
    const struct = (s: Stage) => (s.tool === 'eq' ? `eq(${s.bands.map((b) => b.key).join('')})` : s.tool === 'highpass' || s.tool === 'lowpass' ? `${s.tool}${s.slope}`
      : s.tool === 'delay' ? `delay${s.pingpong ? 'pp' : ''}` : s.tool === 'reverb' ? `reverb(${s.file ? `file:${s.file}` : `${s.size}:${s.decay}`})`
      : s.tool === 'drive' ? `drive${s.db}` : s.tool === 'stereo' ? `stereo${s.invert ? 'inv' : ''}` : s.tool);
    const rv = stages.find((s): s is StageOf<'reverb'> => s.tool === 'reverb'), dl = stages.find((s): s is StageOf<'delay'> => s.tool === 'delay');
    const tailSecs = Math.max(rv ? rv.predelay / 1000 + (rv.file ? 6 : rv.decay) + 0.1 : 0, dl ? delayTail(dl) : 0);
    return { stages, sig: stages.map(struct).join('>'), tail: !!(c && c.tail) && tailSecs > 0, tailSecs: Math.min(TAIL_MAX, tailSecs) };
  }

  // ── the kernels: plain arithmetic on blocks of samples, run by the worklets and by the tests ──────────────
  /**
   * A gate (or downward expander) and a compressor, as one kernel in two modes. Channels are linked: the loudest
   * channel decides for all, so a stereo sound keeps its image.
   *   comp: { threshold, ratio, attack, release, makeup } — a 6 dB soft knee; the gain reduction moves at the
   *         attack and release times. No automatic make-up (the browser's own compressor node has one it does
   *         not let you turn off, which is why this is not that node).
   *   gate: { threshold, range, attack, hold, release } — opens above the threshold, shuts 3 dB under it (so it
   *         does not chatter on a level sitting at the threshold) once the hold has run out; shut, the sound is
   *         `range` dB down (−80: silence).
   */
  class Dynamics {
    declare sr: number; declare mode: 'gate' | 'comp'; declare env: number; declare gr: number; declare g: number; declare held: number; declare open: boolean; declare reduction: number;
    declare p: Record<string, number>; declare att: number; declare rel: number; declare floor: number; declare mk: number; declare detRel: number;
    constructor({ sampleRate, mode, ...p }: { sampleRate: number; mode?: string } & Loose) { this.sr = sampleRate; this.mode = mode === 'gate' ? 'gate' : 'comp'; this.env = 0; this.gr = 0; this.g = mode === 'gate' ? 0 : 1; this.held = 0; this.open = false; this.reduction = 0; this.set(p); if (this.mode === 'gate') this.g = this.floor; }
    set(p: Loose) {
      const d: Record<string, number> = this.mode === 'gate' ? { threshold: -45, range: -80, attack: 2, hold: 80, release: 200 } : { threshold: -18, ratio: 3, attack: 10, release: 200, makeup: 0 };
      const v = (k: string) => (Number.isFinite(Number(p && p[k])) && p[k] !== null ? Number(p[k]) : this.p ? this.p[k] : d[k]);
      this.p = Object.fromEntries(Object.keys(d).map((k) => [k, v(k)]));
      const coef = (ms: number) => Math.exp(-1 / (Math.max(0.05, ms) / 1000 * this.sr));
      this.att = coef(this.p.attack); this.rel = coef(this.p.release);
      this.floor = this.mode === 'gate' ? (this.p.range <= -80 ? 0 : lin(this.p.range)) : 0;
      this.mk = this.mode === 'comp' ? lin(this.p.makeup) : 1;
      this.detRel = coef(10);                              // the level detector falls over 10 ms: it reads a peak, not a waveform
    }
    process(inp: Float32Array[], out: Float32Array[]) {
      const n = out[0].length, ch = out.length, p = this.p, W = 6;
      for (let i = 0; i < n; i++) {
        let peak = 0;
        for (let c = 0; c < ch; c++) { const x = inp[c] || inp[0]; const a = x ? Math.abs(x[i]) : 0; if (a > peak) peak = a; }
        this.env = peak > this.env ? peak : this.env * this.detRel + peak * (1 - this.detRel);
        const db = this.env > 1e-6 ? 20 * Math.log10(this.env) : -120;
        let g: number;
        if (this.mode === 'comp') {
          const over = db - p.threshold;
          const want = 2 * over < -W ? 0 : 2 * over > W ? over * (1 - 1 / p.ratio) : (1 - 1 / p.ratio) * (over + W / 2) * (over + W / 2) / (2 * W);   // dB of reduction asked for
          const k = want > this.gr ? this.att : this.rel;
          this.gr = want + (this.gr - want) * k;
          g = lin(-this.gr) * this.mk;
        } else {
          if (db > p.threshold) { this.open = true; this.held = p.hold / 1000 * this.sr; }
          else if (db < p.threshold - 3) { if (this.held > 0) this.held--; else this.open = false; }
          const to = this.open ? 1 : this.floor;
          this.g = to + (this.g - to) * (to > this.g ? this.att : this.rel);
          g = this.g;
        }
        for (let c = 0; c < ch; c++) { const x = inp[c] || inp[0]; out[c][i] = x ? x[i] * g : 0; }
      }
      this.reduction = this.mode === 'comp' ? -this.gr : (this.g > 1e-4 ? 20 * Math.log10(this.g) : -80);
    }
  }

  /** Fewer bits (each sample rounded to one of 2^bits levels) and a lower sample rate (each sample held until the
   *  next tick of a slower clock, with no filter: the aliasing is the sound). */
  class Crusher {
    declare sr: number; declare phase: number; declare hold: number[]; declare p: { bits: number; hz: number };
    constructor({ sampleRate, ...p }: { sampleRate: number } & Loose) { this.sr = sampleRate; this.phase = 1; this.hold = [0, 0]; this.set(p); }
    set(p: Loose) { const v = (k: 'bits' | 'hz', d: number) => (Number.isFinite(Number(p && p[k])) && p[k] !== null ? Number(p[k]) : this.p ? this.p[k] : d); this.p = { bits: clamp(v('bits', 8), 1, 16), hz: clamp(v('hz', 8000), 50, 192000) }; }
    process(inp: Float32Array[], out: Float32Array[]) {
      const n = out[0].length, step = 2 / Math.pow(2, this.p.bits), inc = Math.min(1, this.p.hz / this.sr);
      for (let i = 0; i < n; i++) {
        this.phase += inc;
        const tick = this.phase >= 1;
        if (tick) this.phase -= 1;
        for (let c = 0; c < out.length; c++) {
          const x = inp[c] || inp[0];
          if (tick) this.hold[c] = x ? Math.round(x[i] / step) * step : 0;
          out[c][i] = this.hold[c] || 0;
        }
      }
    }
  }

  /**
   * Pitch without speed, in the time domain: the sound is written into a short memory and read back out of it
   * faster (higher) or slower (lower) than it went in. The reader therefore gains on the writer, or falls behind,
   * and every so often must jump back, or forward, to stay inside the memory. Each jump is made by a length at
   * which the sound just played resembles itself (the lag of its strongest self-similarity: a whole number of
   * periods of a pitched sound) and is crossfaded, so a steady tone comes through with no gap, click or wobble.
   * On dense music or noise there is no such length and the splices are heard as a roughness. It delays the
   * sound by up to 45 ms. `ratio` = 2^(semitones/12 + cents/1200), from 0.5 to 2.
   */
  class PitchShifter {
    declare sr: number; declare N: number; declare mask: number; declare buf: Float32Array[]; declare mono: Float32Array; declare w: number; declare X: number;
    declare lagMin: number; declare lagMax: number; declare d: number; declare d2: number; declare xf: number; declare ratio: number; declare lo: number; declare hi: number; declare scores?: Float32Array;
    constructor({ sampleRate, ...p }: { sampleRate: number } & PitchSettings) {
      this.sr = sampleRate; this.N = 16384; this.mask = this.N - 1;
      this.buf = [new Float32Array(this.N), new Float32Array(this.N)];
      this.mono = new Float32Array(this.N);
      this.w = 0;
      this.X = Math.round(sampleRate * 0.012);              // the crossfade of a splice
      this.lagMin = Math.round(sampleRate * 0.006); this.lagMax = Math.round(sampleRate * 0.028);
      this.d = 0; this.d2 = 0; this.xf = 0;                 // the reader's delay behind the writer; the one it is crossfading to; how far through
      this.ratio = 1; this.set(p);
      this.d = this.lo + (this.hi - this.lo) / 2;
    }
    set(p?: PitchSettings) {
      const st = Number(p && p.semitones) || 0, ct = Number(p && p.cents) || 0;
      this.ratio = p && p.ratio! > 0 ? clamp(p.ratio!, 0.5, 2) : clamp(Math.pow(2, st / 12 + ct / 1200), 0.5, 2);
      // the nearest the reader may come to the writer: far enough that a splice's crossfade, read at this ratio,
      // never asks for a sample not yet written
      this.lo = Math.ceil(this.X * Math.max(0, this.ratio - 1)) + 48;
      this.hi = this.lo + this.lagMax + this.X;           // far enough that a splice forward has every lag to choose from
    }
    /** A sample `d` behind the writer, between the two it falls between. */
    at(b: Float32Array, d: number) { const pos = this.w - d, i = Math.floor(pos), f = pos - i; const a = b[i & this.mask]; return a + (b[(i + 1) & this.mask] - a) * f; }
    /** The lag (in samples) at which what the reader has just played most resembles what lies that far from it. `dir` +1: further back. */
    lag(dir: number) {
      const n = this.X, m = this.mono, start = Math.floor(this.w - this.d) - n, mask = this.mask;      // (what it has just played: what it is about to play may not be written yet)
      let best = this.lagMin, top = -Infinity;
      const scores = this.scores || (this.scores = new Float32Array(this.lagMax + 2));
      for (let L = this.lagMin - 1; L <= this.lagMax + 1; L++) {
        let xy = 0, yy = 0;
        for (let i = 0; i < n; i += 2) { const a = m[(start + i) & mask], b = m[(start + i - dir * L) & mask]; xy += a * b; yy += b * b; }
        const score = scores[L] = xy / Math.sqrt(yy + 1e-9);
        if (score > top && L >= this.lagMin && L <= this.lagMax) { top = score; best = L; }
      }
      // between whole samples: the top of the curve through the best lag and its two neighbours (half a sample out
      // is 19 degrees of a 5 kHz tone, which a crossfade turns into a dip in its level)
      const a = scores[best - 1], b = scores[best], c = scores[best + 1], bend = a - 2 * b + c;
      return bend < 0 ? best + Math.max(-0.5, Math.min(0.5, (a - c) / (2 * bend))) : best;
    }
    process(inp: Float32Array[], out: Float32Array[]) {
      const n = out[0].length, drift = 1 - this.ratio;
      for (let i = 0; i < n; i++) {
        const l = inp[0] ? inp[0][i] : 0, r = inp[1] ? inp[1][i] : l;
        this.buf[0][this.w & this.mask] = l; this.buf[1][this.w & this.mask] = r; this.mono[this.w & this.mask] = (l + r) / 2;
        this.w++;
        if (this.ratio === 1 && !this.xf) { for (let c = 0; c < out.length; c++) out[c][i] = this.at(this.buf[Math.min(c, 1)], this.d); continue; }
        this.d += drift;
        if (this.xf > 0) {
          this.d2 += drift;
          const a = 1 - this.xf / this.X;
          for (let c = 0; c < out.length; c++) { const b = this.buf[Math.min(c, 1)]; out[c][i] = this.at(b, this.d) * (1 - a) + this.at(b, this.d2) * a; }
          if (--this.xf === 0) this.d = this.d2;
          continue;
        }
        for (let c = 0; c < out.length; c++) out[c][i] = this.at(this.buf[Math.min(c, 1)], this.d);
        if (this.d < this.lo) { this.d2 = this.d + this.lag(1); this.xf = this.X; }
        else if (this.d > this.hi) { this.d2 = this.d - this.lag(-1); this.xf = this.X; }
      }
    }
  }

  // The worklets: each a thin shell round a kernel. A `set` message moves its settings; 'stop' ends it.
  const WORKLET_TAIL = `
const shell = (name, make) => registerProcessor(name, class extends AudioWorkletProcessor {
  constructor(o) { super(); this.on = true; this.k = make({ sampleRate, ...(o.processorOptions || {}) }); this.n = 0;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.on = false; else if (e.data && e.data.set) this.k.set(e.data.set); }; }
  process(inputs, outputs) {
    if (!this.on) return false;
    const out = outputs[0]; if (!out || !out.length) return true;
    this.k.process(inputs[0] || [], out);
    if (this.k.reduction !== undefined && (this.n = (this.n + 1) % 32) === 0) this.port.postMessage({ reduction: this.k.reduction });
    return true;
  }
});
shell('ec-dynamics', (o) => new Chain.Dynamics(o));
shell('ec-crush', (o) => new Chain.Crusher(o));
shell('ec-pitch', (o) => new Chain.PitchShifter(o));
`;

  // ── the builder ─────────────────────────────────────────────────────────────
  /** A room's ring as an impulse response: a few first reflections, spread by `size`, then noise dying away
   *  evenly, 60 dB down after `decay` s and darker as it goes. The noise is from a fixed seed, so the same
   *  settings always make the same room (and a measurement of it can be repeated). */
  function impulse(ctx: BaseAudioContext, { size, decay }: { size: number; decay: number }) {
    const sr = ctx.sampleRate, n = Math.max(1, Math.round(sr * decay)), buf = ctx.createBuffer(2, n, sr);
    let seed = 22222;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    const onset = Math.round(sr * (0.004 + 0.05 * size));               // the tail builds up over this long: a bigger room fills more slowly
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n, damp = 0.25 + 0.7 * x;                         // a one-pole low-pass that closes as the tail goes on
        lp = lp * damp + rnd() * (1 - damp);
        d[i] = lp * Math.pow(10, -3 * x) * Math.min(1, i / onset);
      }
      // first reflections: six taps, further apart in a bigger room, each side its own
      for (let k = 0; k < 6; k++) { const at = Math.round(sr * (0.007 + 0.013 * k * (0.3 + size)) * (c ? 1.13 : 1)); if (at < n) d[at] += (k % 2 ? -1 : 1) * 0.5 * Math.pow(0.8, k); }
    }
    return buf;
  }

  /**
   * The nodes for a plan, on any context: { input, output, sig, tail, tailSecs, set(plan, secs), dispose(), meters }.
   * `input` and `output` are gains (unity): a source goes in one end and the voice's level comes after the other.
   * `env`: { worklets: true once WORKLETS has been added to this context, ir: (file) => AudioBuffer | null }.
   * A tool that needs a worklet on a context that has none is left out (and named in `missing`).
   */
  function build(ctx: BaseAudioContext, pl: Plan, env: BuildEnv = {}) {
    const input = ctx.createGain(), output = ctx.createGain();
    const made: AudioNode[] = [], stops: (() => void)[] = [], sets: [string, Setter][] = [], missing: string[] = [], meters: ChainMeters = {};
    const keep = <T extends AudioNode>(n: T) => { made.push(n); return n; };
    const gain = (v: number) => { const g = keep(ctx.createGain()); g.gain.value = v; return g; };
    // (a low-pass or high-pass filter's Q is given to Web Audio in dB of resonance, not as the number a filter table has: 0.7071 is −3 dB)
    const biquad = (type: BiquadFilterType, hz: number, q: number | undefined, db?: number) => { const f = keep(ctx.createBiquadFilter()); f.type = type; f.frequency.value = clamp(hz, 10, ctx.sampleRate / 2 - 100); if (q) f.Q.value = type === 'lowpass' || type === 'highpass' ? 20 * Math.log10(q) : q; if (db !== undefined) f.gain.value = db; return f; };
    const osc = (hz: number) => { const o = keep(ctx.createOscillator()); o.frequency.value = hz; o.start(); stops.push(() => { try { o.stop(); } catch { /* gone */ } }); return o; };
    // a setting moved on a playing sound: a frequency glides along a ratio, everything else along a line
    const move = (param: AudioParam, to: number, secs?: number, mode?: Glide) => {
      const now = ctx.currentTime, t = Math.max(0.02, secs || 0), cur = param.value;
      param.cancelScheduledValues(now); param.setValueAtTime(cur, now);
      if (mode === 'exp' && cur > 0 && to > 0) param.exponentialRampToValueAtTime(to, now + t); else param.linearRampToValueAtTime(to, now + t);
    };
    const worklet = (name: string, opts: Loose, s: Stage) => {
      if (!env.worklets) { missing.push(s.tool); return null; }
      const node = keep(new AudioWorkletNode(ctx, name, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', processorOptions: opts }));
      stops.push(() => { try { node.port.postMessage('stop'); } catch { /* gone */ } });
      return node;
    };
    // equal-power wet and dry
    const dryOf = (mix: number) => Math.cos(mix * Math.PI / 2), wetOf = (mix: number) => Math.sin(mix * Math.PI / 2);
    let at: AudioNode = input;
    const then = (first: AudioNode, last = first) => { at.connect(first); at = last; };
    for (const s of pl.stages) {
      switch (s.tool) {
        case 'highpass': case 'lowpass': {
          const fs = SLOPE_Q[s.slope].map((q) => biquad(s.tool, s.hz, q));
          for (const f of fs) then(f);
          sets.push([s.tool, (v: StageOf<'highpass' | 'lowpass'>, secs) => { for (const f of fs) move(f.frequency, clamp(v.hz, 10, ctx.sampleRate / 2 - 100), secs, 'exp'); }]);
          break;
        }
        case 'eq': {
          const fs = s.bands.map((b) => biquad(b.type, b.hz, b.q, b.db));
          for (const f of fs) then(f);
          sets.push(['eq', (v: StageOf<'eq'>, secs) => v.bands.forEach((b, i) => { move(fs[i].gain, b.db, secs); move(fs[i].frequency, b.hz, secs, 'exp'); if (b.q) move(fs[i].Q, b.q, secs); })]);
          break;
        }
        case 'gate': case 'comp': {
          const { tool, ...p } = s;
          const node = worklet('ec-dynamics', { mode: tool, ...p }, s);
          if (!node) break;
          node.port.onmessage = (e) => { meters[tool] = e.data.reduction; };
          then(node);
          sets.push([tool, (v: StageOf<'gate' | 'comp'>) => { const { tool: _t, ...q } = v; node.port.postMessage({ set: q }); }]);
          break;
        }
        case 'drive': {
          // a soft clip (tanh), four times oversampled so what it adds above the top of hearing does not fold
          // back down; a full-scale sound still peaks at full scale, so more drive is denser, not higher
          const g = lin(s.db), curve = new Float32Array(2049);
          for (let i = 0; i < curve.length; i++) { const x = i / 1024 - 1; curve[i] = Math.tanh(g * x) / Math.tanh(g); }
          const sh = keep(ctx.createWaveShaper()); sh.curve = curve; sh.oversample = '4x';
          const tone = biquad('lowpass', s.tone, 0.7071), out = gain(lin(s.out));
          then(sh); then(tone); then(out);
          sets.push(['drive', (v: StageOf<'drive'>, secs) => { move(tone.frequency, v.tone, secs, 'exp'); move(out.gain, lin(v.out), secs); }]);
          break;
        }
        case 'crush': {
          const node = worklet('ec-crush', { bits: s.bits, hz: s.hz }, s);
          if (!node) break;
          then(node);
          sets.push(['crush', (v: StageOf<'crush'>) => node.port.postMessage({ set: { bits: v.bits, hz: v.hz } })]);
          break;
        }
        case 'pitch': {
          const node = worklet('ec-pitch', { semitones: s.semitones, cents: s.cents }, s);
          if (!node) break;
          then(node);
          sets.push(['pitch', (v: StageOf<'pitch'>) => node.port.postMessage({ set: { semitones: v.semitones, cents: v.cents } })]);
          break;
        }
        case 'chorus': {
          const inn = gain(1), out = gain(1), dry = gain(dryOf(s.mix)), wet = gain(wetOf(s.mix));
          const dl = keep(ctx.createDelay(0.1)); dl.delayTime.value = s.delay / 1000;
          const lfo = osc(s.rate), depth = gain(Math.min(s.depth, s.delay * 0.95) / 1000), back = gain(s.feedback);
          lfo.connect(depth).connect(dl.delayTime);
          inn.connect(dry).connect(out); inn.connect(dl).connect(wet).connect(out); dl.connect(back).connect(dl);
          then(inn, out);
          sets.push(['chorus', (v: StageOf<'chorus'>, secs) => { move(lfo.frequency, v.rate, secs); move(depth.gain, Math.min(v.depth, v.delay * 0.95) / 1000, secs); move(dl.delayTime, v.delay / 1000, secs); move(back.gain, v.feedback, secs); move(dry.gain, dryOf(v.mix), secs); move(wet.gain, wetOf(v.mix), secs); }]);
          break;
        }
        case 'tremolo': {
          // the level swings between 1 and 1 − depth
          const g = gain(1 - s.depth / 2), lfo = osc(s.rate), depth = gain(s.depth / 2);
          lfo.connect(depth).connect(g.gain);
          then(g);
          sets.push(['tremolo', (v: StageOf<'tremolo'>, secs) => { move(lfo.frequency, v.rate, secs); move(depth.gain, v.depth / 2, secs); move(g.gain, 1 - v.depth / 2, secs); }]);
          break;
        }
        case 'autopan': {
          const pan = keep(ctx.createStereoPanner()); pan.channelCountMode = 'explicit'; pan.channelCount = 2;
          const lfo = osc(s.rate), depth = gain(s.depth);
          lfo.connect(depth).connect(pan.pan);
          then(pan);
          sets.push(['autopan', (v: StageOf<'autopan'>, secs) => { move(lfo.frequency, v.rate, secs); move(depth.gain, v.depth, secs); }]);
          break;
        }
        case 'stereo': {
          // mid and side: L' = a·L + b·R, R' = b·L + a·R, with a = (1 + width) / 2 and b = (1 − width) / 2
          const inn = gain(1); inn.channelCount = 2; inn.channelCountMode = 'explicit';
          const sp = keep(ctx.createChannelSplitter(2)), mg = keep(ctx.createChannelMerger(2));
          const sign = s.invert ? -1 : 1, a = (w: number) => sign * (1 + w) / 2, b = (w: number) => sign * (1 - w) / 2;
          const ll = gain(a(s.width)), rr = gain(a(s.width)), lr = gain(b(s.width)), rl = gain(b(s.width));
          inn.connect(sp);
          sp.connect(ll, 0); ll.connect(mg, 0, 0); sp.connect(rl, 1); rl.connect(mg, 0, 0);
          sp.connect(rr, 1); rr.connect(mg, 0, 1); sp.connect(lr, 0); lr.connect(mg, 0, 1);
          then(inn, mg);
          sets.push(['stereo', (v: StageOf<'stereo'>, secs) => { for (const g of [ll, rr]) move(g.gain, a(v.width), secs); for (const g of [lr, rl]) move(g.gain, b(v.width), secs); }]);
          break;
        }
        case 'delay': {
          const inn = gain(1), out = gain(1), dry = gain(dryOf(s.mix)), wet = gain(wetOf(s.mix));
          const tone = biquad('lowpass', s.tone, 0.7071), back = gain(s.feedback);
          const lines: DelayNode[] = [];
          inn.connect(dry).connect(out);
          if (s.pingpong) {
            // two lines, one a side, each feeding the other: the first repeat on the left, the next on the right
            const a = keep(ctx.createDelay(4.1)), b = keep(ctx.createDelay(4.1)), mono = gain(1), mg = keep(ctx.createChannelMerger(2));
            mono.channelCount = 1; mono.channelCountMode = 'explicit';
            a.delayTime.value = b.delayTime.value = s.time;
            inn.connect(mono).connect(a); a.connect(b); b.connect(tone).connect(back).connect(a);
            a.connect(mg, 0, 0); b.connect(mg, 0, 1); mg.connect(wet).connect(out);
            lines.push(a, b);
          } else {
            const d = keep(ctx.createDelay(4.1)); d.delayTime.value = s.time;
            inn.connect(d); d.connect(tone).connect(back).connect(d); d.connect(wet).connect(out);
            lines.push(d);
          }
          then(inn, out);
          sets.push(['delay', (v: StageOf<'delay'>, secs) => { for (const d of lines) move(d.delayTime, v.time, Math.max(0.05, secs)); move(back.gain, v.feedback, secs); move(tone.frequency, v.tone, secs, 'exp'); move(dry.gain, dryOf(v.mix), secs); move(wet.gain, wetOf(v.mix), secs); }]);
          break;
        }
        case 'reverb': {
          const inn = gain(1), out = gain(1), dry = gain(dryOf(s.mix)), wet = gain(wetOf(s.mix));
          const pre = keep(ctx.createDelay(0.3)); pre.delayTime.value = s.predelay / 1000;
          const conv = keep(ctx.createConvolver());
          const file = s.file && env.ir ? env.ir(s.file) : null;
          conv.buffer = file || impulse(ctx, s);
          inn.connect(dry).connect(out); inn.connect(pre).connect(conv).connect(wet).connect(out);
          then(inn, out);
          sets.push(['reverb', (v: StageOf<'reverb'>, secs) => { move(pre.delayTime, v.predelay / 1000, secs); move(dry.gain, dryOf(v.mix), secs); move(wet.gain, wetOf(v.mix), secs); }]);
          // (an impulse-response file that had not been read when the sound started: the room is the generated one until it has)
          if (s.file && !file) meters.irWanted = { file: s.file, conv };
          break;
        }
        default: break;
      }
    }
    at.connect(output);
    return {
      input, output, sig: pl.sig, tail: pl.tail, tailSecs: pl.tailSecs, missing, meters, plan: pl,
      /** Move to another plan of the same structure, over `secs` (0: a 20 ms glide). */
      set(next: Plan, secs: number) { this.plan = next; this.tail = next.tail; this.tailSecs = next.tailSecs; for (const [tool, f] of sets) { const v = next.stages.find((x) => x.tool === tool); if (v) f(v, secs); } },
      /** Move some settings only, as a Fade cue does: { tool: { setting: value } }. Returns the tools it could not find. */
      sweep(to: SweepValue | null | undefined, secs: number) {
        const lost: string[] = [];
        const stages = this.plan.stages.map((st) => (to && to[st.tool] && st.tool !== 'eq' ? { ...st, ...to[st.tool] } : st));
        for (const k of Object.keys(to || {})) if (!stages.some((st) => st.tool === k)) lost.push(k);
        this.plan = { ...this.plan, stages };
        for (const [tool, f] of sets) if (to && to[tool]) f(stages.find((x) => x.tool === tool)!, secs);
        return lost;
      },
      dispose() { for (const f of stops) f(); for (const n of [input, output, ...made]) { try { n.disconnect(); } catch { /* gone */ } } },
    };
  }

  // ── the built-in presets ────────────────────────────────────────────────────
  // Each is a chain (and perhaps an eq) a designer would otherwise set by hand; applying one writes it onto the
  // cue, where every number can then be changed. A show keeps its own beside these (settings.audio.chains).
  const PRESETS: Record<string, { chain: ChainValue; eq?: EqValue }> = {
    'Voice': { chain: { highpass: { hz: 80, slope: 12 }, comp: { threshold: -20, ratio: 2.5, attack: 10, release: 150, makeup: 2 } } },
    'Phone': { chain: { highpass: { hz: 400, slope: 24 }, lowpass: { hz: 3200, slope: 24 }, comp: { threshold: -24, ratio: 6, attack: 3, release: 120, makeup: 6 }, drive: { db: 9, tone: 3500, out: -4 }, stereo: { width: 0 } } },
    'Radio': { chain: { highpass: { hz: 250, slope: 24 }, lowpass: { hz: 4500, slope: 12 }, comp: { threshold: -22, ratio: 4, attack: 5, release: 150, makeup: 5 }, drive: { db: 6, tone: 5000, out: -2 }, stereo: { width: 0 } }, eq: { mid: { db: 5, hz: 1800, q: 1.2 } } },
    'Next room': { chain: { lowpass: { hz: 450, slope: 12 }, reverb: { size: 0.3, decay: 0.6, predelay: 5, mix: 0.25 } }, eq: { low: 3 } },
    'Underwater': { chain: { lowpass: { hz: 600, slope: 24 }, chorus: { rate: 0.3, depth: 4, delay: 12, feedback: 0.3, mix: 0.5 }, reverb: { size: 0.6, decay: 1.6, predelay: 10, mix: 0.3 } } },
    'Cathedral': { chain: { highpass: { hz: 120, slope: 12 }, reverb: { size: 1, decay: 6, predelay: 60, mix: 0.45 }, tail: true } },
    'Old record': { chain: { highpass: { hz: 180, slope: 12 }, lowpass: { hz: 5500, slope: 12 }, drive: { db: 6, tone: 6000, out: -2 }, chorus: { rate: 0.55, depth: 0.6, delay: 8, feedback: 0, mix: 0.5 }, stereo: { width: 0 } } },
    'Lo-fi': { chain: { lowpass: { hz: 6000, slope: 12 }, crush: { bits: 10, hz: 11025 }, drive: { db: 4, tone: 7000, out: -1 } } },
  };

  /** The chain a kind of sound is offered (never applied by itself): a voice gets its rumble taken off and a light compressor. */
  const OFFER: Record<string, string> = { voice: 'Voice', live: 'Voice' };

  /** What can be swept by a Fade cue: every numeric setting that glides, as "tool.setting". */
  const SWEEPABLE: Sweepable[] = TOOLS.flatMap((t) => t.params.filter((p): p is NumberParam => !!p.glide).map((p) => ({ id: `${t.key}.${p.key}`, tool: t.key, key: p.key, label: `${t.label}: ${p.label}`, unit: p.unit, min: p.min, max: p.max })));
  /** A Fade cue's `chainTo` as the show keeps it: { tool: { setting: value } }, only settings that can glide. null: none. */
  function cleanSweep(value: unknown): SweepValue | null {
    if (value == null || value === '') return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('chainTo: { tool: { setting: value } }, as in { "lowpass": { "hz": 400 } }');
    const out: SweepValue = {};
    for (const [tool, set] of Object.entries(value)) {
      if (!TOOL[tool]) throw new Error(`chainTo: there is no tool called “${tool}”`);
      if (!set || typeof set !== 'object') throw new Error(`chainTo: ${tool} is { setting: value }`);
      for (const [k, v] of Object.entries(set)) {
        const p = SWEEPABLE.find((x) => x.tool === tool && x.key === k);
        if (!p) throw new Error(`chainTo: ${tool}.${k} cannot be moved by a fade (those that can: ${SWEEPABLE.filter((x) => x.tool === tool).map((x) => x.key).join(', ') || 'none of this tool’s'})`);
        if (v === null || v === '' || !Number.isFinite(Number(v))) continue;
        (out[tool] = out[tool] || {})[k] = r3(clamp(Number(v), p.min, p.max));
      }
    }
    return Object.keys(out).length ? out : null;
  }

  return { TOOLS, EQ_BANDS, PRESETS, OFFER, SWEEPABLE, TAIL_MAX, cleanChain, cleanEq, cleanSweep, bandOf, plan, build, impulse, Dynamics, Crusher, PitchShifter, WORKLET_TAIL };
}

const api = factory();
/** What is to be built for a cue's chain and eq (plan()). */
export type Plan = ReturnType<typeof api.plan>;
/** A chain built on a context (build()). */
export type BuiltChain = ReturnType<typeof api.build>;
/** This file's code as text, for an AudioWorklet: `const Chain = ${SOURCE};` there is this module. */
export const SOURCE = `(${factory})()`;
/** The worklet module's source: the kernels and their processors. */
export const WORKLETS = `const Chain = ${SOURCE};\n${api.WORKLET_TAIL}`;
export const { TOOLS, EQ_BANDS, PRESETS, OFFER, SWEEPABLE, TAIL_MAX, cleanChain, cleanEq, cleanSweep, bandOf, plan, build, impulse, Dynamics, Crusher, PitchShifter, WORKLET_TAIL } = api;
