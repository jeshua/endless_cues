/**
 * Timecode: the arithmetic, MIDI Timecode (MTC) as bytes both ways, and Linear Timecode (LTC) as sound both ways.
 *
 *   parse('01:00:00:00')                 -> { h: 1, m: 0, s: 0, f: 0 }       (null when it is not a timecode)
 *   toFrames(tc, '29.97df')              -> frames since 00:00:00:00, counted as that rate counts them
 *   fromFrames(n, '29.97df')             -> { h, m, s, f }                    (round the clock at 24 hours)
 *   format(tc, rate)                     -> '01:00:00;00' (a semicolon before the frames of a drop-frame time)
 *   quarterFrame(piece, tc, rate)        -> [0xF1, 0x..]                      (one of the eight MTC quarter frames)
 *   fullFrame(tc, rate)                  -> [0xF0, 0x7F, 0x7F, 0x01, 0x01, hr, mn, sc, fr, 0xF7]
 *   mtcBetween(start, rate, t0, t1)      -> [{ at, bytes }]: the quarter frames due in that stretch of seconds
 *   new MtcReader().feed(bytes)          -> { frames, rate, tc, full } | null
 *   ltcBits(tc, rate)                    -> the 80 bits of one LTC frame
 *   new LtcWriter({ rate, sampleRate, start }).render(float32)
 *   new LtcReader({ sampleRate }).feed(float32) -> [{ tc, drop, rate, fps, end }]
 *
 * The rates are the four MTC can name: '24', '25', '29.97df' (30 frames counted, two numbers dropped most minutes,
 * running at 30000/1001 a second) and '30'.
 *
 * This file has no dependency and is written so that it loads three ways: required by Node (the host, the tests),
 * as a plain script in a page, and pasted into an AudioWorklet (`SOURCE` is its own text, for that), so that the
 * LTC the app plays is made by the code the tests check. Written from the MIDI 1.0 specification (MIDI Time Code)
 * and SMPTE 12M; nothing here has met a timecode reader or generator other than itself.
 */
// ── the types (stripped from the text a worklet gets, so they may live out here) ──
/** A time of day in timecode: hours, minutes, seconds, frames. */
export interface TC { h: number; m: number; s: number; f: number }
/** The four rates MTC can name. */
export type Rate = '24' | '25' | '29.97df' | '30';
/** A rate as a show or a message names it (anything that is not one of the four is read as 30). */
export type RateIn = Rate | string | number | null | undefined;
/** What a rate is: frames counted in a second, frames gone by in a real second, MTC's code for it, and its name for people. */
export interface RateInfo { fps: number; real: number; code: number; drop?: boolean; label: string }
/** A time read from MTC: `frames` is the time now (a fraction allowed); `full` when it came as a full-frame message. */
export interface MtcTime { tc: TC; rate: Rate; frames: number; full: boolean }
/** A frame of LTC heard (LtcReader.feed). */
export interface LtcFrame { tc: TC; drop: boolean; rate: Rate; fps: number; end: number }

// (a function, not plain module code: its own text is what an AudioWorklet runs, `SOURCE` below)
function factory() {
  // `fps`: the frames counted in a second of timecode. `real`: how many go by in a second of time. `code`: MTC's name for it.
  const RATES: Record<string, RateInfo> = {
    24: { fps: 24, real: 24, code: 0, label: '24' },
    25: { fps: 25, real: 25, code: 1, label: '25' },
    '29.97df': { fps: 30, real: 30000 / 1001, code: 2, drop: true, label: '29.97 drop' },
    30: { fps: 30, real: 30, code: 3, label: '30' },
  };
  const RATE_NAMES: Rate[] = ['24', '25', '29.97df', '30'];
  const rateOf = (rate: RateIn) => RATES[rate as string] || RATES[30];
  const DAY = (r: RateInfo) => (r.drop ? 2589408 : r.fps * 86400);      // frames in 24 hours

  /** "01:00:00:00" (or with ; or . before the frames). Four numbers, always: a time with fewer could mean two things. */
  function parse(text: unknown): TC | null {
    const m = /^\s*(\d{1,2}):(\d{1,2}):(\d{1,2})[:;.](\d{1,2})\s*$/.exec(String(text == null ? '' : text));
    if (!m) return null;
    const tc = { h: Number(m[1]), m: Number(m[2]), s: Number(m[3]), f: Number(m[4]) };
    return tc.h < 24 && tc.m < 60 && tc.s < 60 && tc.f < 30 ? tc : null;
  }
  /** Why a time cannot be said at a rate ('' when it can): a frame the rate does not have, or one drop-frame skips. */
  function whyNot(tc: TC | null | undefined, rate: RateIn) {
    const r = rateOf(rate);
    if (!tc) return 'a timecode is hours:minutes:seconds:frames (01:00:00:00)';
    if (tc.f >= r.fps) return `there is no frame ${tc.f} at ${r.label} frames a second`;
    if (r.drop && tc.s === 0 && tc.f < 2 && tc.m % 10 !== 0) return 'drop-frame timecode has no frame 00 or 01 at the start of that minute';
    return '';
  }
  const p2 = (n: number) => String(n).padStart(2, '0');
  function format(tc: TC | null | undefined, rate: RateIn) { return tc ? `${p2(tc.h)}:${p2(tc.m)}:${p2(tc.s)}${rateOf(rate).drop ? ';' : ':'}${p2(tc.f)}` : ''; }

  function toFrames(tc: TC, rate: RateIn) {
    const r = rateOf(rate), mins = tc.h * 60 + tc.m;
    const n = (mins * 60 + tc.s) * r.fps + tc.f;
    // drop-frame: two frame numbers are skipped at the start of every minute but each tenth
    return r.drop ? n - 2 * (mins - Math.floor(mins / 10)) : n;
  }
  function fromFrames(frames: number, rate: RateIn): TC {
    const r = rateOf(rate), day = DAY(r);
    let n = ((Math.floor(frames) % day) + day) % day;
    if (r.drop) {
      const tens = Math.floor(n / 17982), rest = n % 17982;      // 17982 frames in ten minutes, 1798 in a minute that drops
      n += 18 * tens + (rest >= 2 ? 2 * Math.floor((rest - 2) / 1798) : 0);
    }
    const f = n % r.fps, secs = Math.floor(n / r.fps);
    return { h: Math.floor(secs / 3600) % 24, m: Math.floor(secs / 60) % 60, s: secs % 60, f };
  }
  /** A typed time as frames at a rate, or null when it is not a time that rate has. */
  function framesOf(text: unknown, rate: RateIn) { const tc = parse(text); return tc && !whyNot(tc, rate) ? toFrames(tc, rate) : null; }
  const secondsOf = (frames: number, rate: RateIn) => frames / rateOf(rate).real;
  const framesAt = (seconds: number, rate: RateIn) => seconds * rateOf(rate).real;

  // ── MTC ──────────────────────────────────────────────────────────────────────────────────────────────────
  /** One quarter-frame message: F1 0nnn dddd. Pieces 0–7 carry the frame, seconds, minutes and hours a nibble
   *  at a time, low nibble first; the last carries the rate with the hours' top bit. */
  function quarterFrame(piece: number, tc: TC, rate: RateIn) {
    const code = rateOf(rate).code;
    const nibble = [tc.f & 15, tc.f >> 4, tc.s & 15, tc.s >> 4, tc.m & 15, tc.m >> 4, tc.h & 15, ((tc.h >> 4) & 1) | (code << 1)][piece & 7];
    return [0xf1, ((piece & 7) << 4) | nibble];
  }
  /** The whole time in one message (a locate): universal real-time SysEx, sub-IDs 01 01. */
  function fullFrame(tc: TC, rate: RateIn, device = 0x7f) {
    return [0xf0, 0x7f, device & 0x7f, 0x01, 0x01, (rateOf(rate).code << 5) | tc.h, tc.m, tc.s, tc.f, 0xf7];
  }
  /**
   * The quarter frames a stream that began at frame `start` owes between `t0` and `t1` seconds after it began
   * (t0 included, t1 not). Four go by in a frame, so the eight pieces take two frames: each run of eight says the
   * time of the frame its first piece began on, as the specification has it.
   */
  function mtcBetween(start: number, rate: RateIn, t0: number, t1: number) {
    const per = 1 / (4 * rateOf(rate).real), out: { at: number; bytes: number[] }[] = [];
    for (let q = Math.max(0, Math.ceil(t0 / per - 1e-7)); q * per < t1 - 1e-9; q++) {
      out.push({ at: q * per, bytes: quarterFrame(q % 8, fromFrames(start + 2 * Math.floor(q / 8), rate), rate) });
    }
    return out;
  }

  /** Incoming MTC, a message at a time. A full frame says the time outright; quarter frames say it once all eight
   *  have come in order, by which time it is nearly two frames later (the last piece is sent a quarter of a frame
   *  before the frame after next), so `frames` is the time NOW, with a fraction. */
  class MtcReader {
    declare nibbles: number[]; declare next: number;
    constructor() { this.reset(); }
    reset() { this.nibbles = new Array(8).fill(0); this.next = -1; }
    feed(bytes: ArrayLike<number> | null | undefined): MtcTime | null {
      const b = bytes || [];
      if (b[0] === 0xf0 && b[1] === 0x7f && b[3] === 0x01 && b[4] === 0x01 && b.length >= 10) {
        const rate = RATE_NAMES[(b[5] >> 5) & 3], tc = { h: b[5] & 31, m: b[6] & 63, s: b[7] & 63, f: b[8] & 31 };
        this.reset();
        return { tc, rate, frames: toFrames(tc, rate), full: true };
      }
      if (b[0] !== 0xf1 || b.length < 2) return null;
      const piece = (b[1] >> 4) & 7;
      // only a run that started at piece 0 and came in order is a time (running backwards, or joined part way, is not)
      if (piece !== 0 && piece !== this.next) { this.next = -1; return null; }
      this.nibbles[piece] = b[1] & 15;
      this.next = piece + 1;
      if (piece !== 7) return null;
      this.next = 0;
      const n = this.nibbles, rate = RATE_NAMES[(n[7] >> 1) & 3];
      const tc = { f: n[0] | ((n[1] & 1) << 4), s: n[2] | ((n[3] & 3) << 4), m: n[4] | ((n[5] & 3) << 4), h: n[6] | ((n[7] & 1) << 4) };
      return { tc, rate, frames: toFrames(tc, rate) + 1.75, full: false };
    }
  }

  // ── LTC ──────────────────────────────────────────────────────────────────────────────────────────────────
  // The last sixteen bits of every frame: 0011 1111 1111 1101. No time can make this pattern, and it reads
  // differently backwards, so a reader finds the frame's edge and its direction from it.
  const SYNC: number[] = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];
  /** The 80 bits of one frame, in the order they are sent: binary-coded decimal, units before tens, each low bit
   *  first, with the user bits (left at 0) between. One bit (27, or 59 at 25 frames a second) is set so that the
   *  frame has an even number of ones: every frame then starts on the same polarity. */
  function ltcBits(tc: TC, rate: RateIn) {
    const r = rateOf(rate), bits = new Uint8Array(80);
    const put = (at: number, n: number, value: number) => { for (let i = 0; i < n; i++) bits[at + i] = (value >> i) & 1; };
    put(0, 4, tc.f % 10); put(8, 2, Math.floor(tc.f / 10));
    bits[10] = r.drop ? 1 : 0;
    put(16, 4, tc.s % 10); put(24, 3, Math.floor(tc.s / 10));
    put(32, 4, tc.m % 10); put(40, 3, Math.floor(tc.m / 10));
    put(48, 4, tc.h % 10); put(56, 2, Math.floor(tc.h / 10));
    for (let i = 0; i < 16; i++) bits[64 + i] = SYNC[i];
    let ones = 0;
    for (let i = 0; i < 80; i++) ones += bits[i];
    if (ones % 2) bits[r.fps === 25 ? 59 : 27] = 1;
    return bits;
  }

  /**
   * LTC as sound: biphase mark. The level changes at the start of every bit, and once more in the middle of a 1.
   * `start` is where the stream is (in frames, a fraction allowed) at the first sample rendered; each render carries
   * on from the last, to the sample, so blocks of any size join into one unbroken signal.
   */
  class LtcWriter {
    declare rate: RateIn; declare step: number; declare start: number; declare amp: number; declare n: number; declare out: number; declare frame: number; declare cell: number; declare half: boolean; declare bits: Uint8Array | null;
    constructor({ rate = '30', sampleRate = 48000, start = 0, level = 0.5 }: { rate?: RateIn; sampleRate?: number; start?: number; level?: number } = {}) {
      this.rate = rate; this.step = rateOf(rate).real / sampleRate; this.start = start; this.amp = level;
      this.n = 0; this.out = 1; this.frame = -1; this.cell = -1; this.half = false; this.bits = null;
    }
    /** Where the stream will be at the next sample rendered, in frames. */
    position() { return this.start + this.n * this.step; }
    render(buf: Float32Array) {
      for (let i = 0; i < buf.length; i++) {
        const p = this.start + this.n++ * this.step;
        const frame = Math.floor(p), x = (p - frame) * 80, cell = Math.min(79, Math.floor(x)), half = x - cell >= 0.5;
        if (frame !== this.frame) { this.frame = frame; this.bits = ltcBits(fromFrames(frame, this.rate), this.rate); this.cell = -1; }
        if (cell !== this.cell) { this.cell = cell; this.half = false; this.out = -this.out; }
        if (half && !this.half) { this.half = true; if (this.bits![cell]) this.out = -this.out; }
        buf[i] = this.out * this.amp;
      }
      return buf;
    }
  }

  /**
   * LTC heard: the time between one change of level and the next says what was sent (a whole bit's time: a 0; two
   * halves: a 1), whatever the level or the polarity. Each time the last sixteen bits read are the sync word, the
   * eighty before the end are a frame. `feed` returns the frames that ended in the samples it was given:
   *   { tc, drop, rate, fps (measured from the frame before to this one; 0 for the first), end (the sample, counted
   *     from the first ever fed, at which the frame ended) }
   * The time NOW at that sample is one frame after `tc`: a frame's number is known only once it has all gone by.
   */
  class LtcReader {
    declare sampleRate: number; declare n: number; declare level: number; declare peak: number; declare last: number; declare cell: number; declare seen: number[]; declare pending: boolean; declare bits: number[]; declare lastEnd: number; declare firstHalf: number;
    constructor({ sampleRate = 48000 } = {}) {
      this.sampleRate = sampleRate; this.n = 0; this.level = 0; this.peak = 0; this.last = -1;
      this.cell = 0; this.seen = []; this.pending = false; this.bits = []; this.lastEnd = -1;
    }
    feed(buf: Float32Array) {
      const out: LtcFrame[] = [];
      for (let i = 0; i < buf.length; i++, this.n++) {
        const x = buf[i], a = x < 0 ? -x : x;
        // the level is read against a threshold that follows the signal's size, so hiss around zero is not an edge
        this.peak = a > this.peak ? a : this.peak * 0.9995;
        const thr = this.peak * 0.25;
        const level = x > thr ? 1 : x < -thr ? -1 : this.level;
        if (level === this.level || !(this.peak > 1e-4)) continue;
        const first = this.level === 0;
        this.level = level;
        if (first || this.last < 0) { this.last = this.n; continue; }
        const iv = this.n - this.last;
        this.last = this.n;
        const frame = this.edge(iv);
        if (frame) out.push(frame);
      }
      return out;
    }
    /** One interval between edges, in samples. */
    edge(iv: number) {
      if (!this.cell) {
        // not locked yet: the longest of the first intervals is a whole bit (every frame has zeros in it)
        this.seen.push(iv);
        if (this.seen.length < 48) return null;
        this.cell = Math.max(...this.seen); this.seen = [];
        return null;
      }
      if (iv > this.cell * 1.6 || iv < this.cell * 0.2) { this.cell = 0; this.pending = false; this.bits = []; return null; }      // not this signal any more: start again
      if (iv > this.cell * 0.75) {
        this.pending = false;                                  // (a half left over: one edge was missed; carry on from here)
        this.cell += (iv - this.cell) * 0.1;
        return this.bit(0);
      }
      if (!this.pending) { this.pending = true; this.firstHalf = iv; return null; }
      this.pending = false;
      this.cell += (this.firstHalf + iv - this.cell) * 0.1;
      return this.bit(1);
    }
    bit(b: number): LtcFrame | null {
      const bits = this.bits;
      bits.push(b);
      if (bits.length > 80) bits.shift();
      if (bits.length < 80) return null;
      for (let i = 0; i < 16; i++) if (bits[64 + i] !== SYNC[i]) return null;
      const get = (at: number, n: number) => { let v = 0; for (let i = 0; i < n; i++) v |= bits[at + i] << i; return v; };
      const tc = { f: get(0, 4) + 10 * get(8, 2), s: get(16, 4) + 10 * get(24, 3), m: get(32, 4) + 10 * get(40, 3), h: get(48, 4) + 10 * get(56, 2) };
      const drop = !!bits[10];
      const fps = this.lastEnd >= 0 ? this.sampleRate / (this.n - this.lastEnd) : 0;
      this.lastEnd = this.n;
      this.bits = [];
      if (tc.f > 29 || tc.s > 59 || tc.m > 59 || tc.h > 23) return null;
      // which rate: by how long a frame took (the first frame heard cannot say, so it is taken at its word: 30)
      const rate = fps && fps < 24.5 ? '24' : fps && fps < 27 ? '25' : drop ? '29.97df' : '30';
      return { tc, drop, rate, fps, end: this.n };
    }
  }

  return { RATES, RATE_NAMES, rateOf, parse, whyNot, format, toFrames, fromFrames, framesOf, secondsOf, framesAt,
           quarterFrame, fullFrame, mtcBetween, MtcReader, SYNC, ltcBits, LtcWriter, LtcReader };
}

const api = factory();
/** This file's code as text, for an AudioWorklet: `const Timecode = ${SOURCE};` there is this module. */
export const SOURCE = `(${factory})()`;
export const { RATES, RATE_NAMES, rateOf, parse, whyNot, format, toFrames, fromFrames, framesOf, secondsOf, framesAt, quarterFrame, fullFrame, mtcBetween, MtcReader, SYNC, ltcBits, LtcWriter, LtcReader } = api;
