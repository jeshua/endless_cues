/**
 * A Standard MIDI File (.mid), read into what a MIDI File cue plays: every message with the second it falls on.
 *
 *   parse(buffer)  -> { format, tracks, ppq | smpte, events: [{ at, bytes }], seconds, tempos: [{ at, bpm }], notes, name }
 *   new MidiFileStream(parsed, { rate })   what the host's playout asks for, a stretch of time at a time
 *
 * The file's tracks are laid into one list in time order (a format 1 file's tracks play together; a format 2
 * file's, which are meant as separate patterns, are played together too, and `format` says so). Tempo changes are
 * followed (120 to the minute until the file says otherwise), as is a file timed in frames instead of beats. What
 * is kept: channel messages and SysEx. What is not sent anywhere: the file's text, lyrics, markers and time
 * signatures. Written from the Standard MIDI Files 1.0 specification.
 */

/** One message of a file, at the second it falls on. */
export interface MidiFileEvent { at: number; bytes: number[] }

function parse(buffer: Buffer | ArrayLike<number> | null | undefined) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (b.length < 14 || b.toString('latin1', 0, 4) !== 'MThd') throw new Error('not a MIDI file (it does not start with MThd)');
  const headLen = b.readUInt32BE(4), format = b.readUInt16BE(8), ntrks = b.readUInt16BE(10), division = b.readUInt16BE(12);
  if (format > 2) throw new Error(`a MIDI file of a format this does not know (${format})`);
  // timed in frames (the top bit set): −frames a second, and ticks in a frame; otherwise ticks in a quarter note
  const smpte = division & 0x8000 ? { fps: 256 - (division >> 8), ticks: division & 0xff } : null;
  const ppq = smpte ? 0 : division;
  if (!smpte && !ppq) throw new Error('a MIDI file with no time division');
  const raw: { tick: number; bytes: number[]; order: number }[] = [], tempoMap: { tick: number; us: number; order: number }[] = [];
  let at = 8 + headLen, order = 0, name = '', lastTick = 0, tracks = 0;
  for (let t = 0; t < ntrks && at + 8 <= b.length; t++) {
    const id = b.toString('latin1', at, at + 4), len = b.readUInt32BE(at + 4), end = Math.min(b.length, at + 8 + len);
    let p = at + 8;
    at = end;
    if (id !== 'MTrk') continue;                    // a chunk of another kind is skipped, as the specification asks
    tracks++;
    let tick = 0, status = 0;
    const varlen = () => { let v = 0; for (let i = 0; i < 4 && p < end; i++) { const c = b[p++]; v = (v << 7) | (c & 0x7f); if (!(c & 0x80)) break; } return v; };
    while (p < end) {
      tick += varlen();
      if (p >= end) break;
      let s = b[p];
      if (s === 0xff) {
        const type = b[p + 1]; p += 2;
        const n = varlen(), data = b.subarray(p, Math.min(end, p + n)); p += n;
        if (type === 0x51 && data.length >= 3) tempoMap.push({ tick, us: (data[0] << 16) | (data[1] << 8) | data[2], order: order++ });
        if (type === 0x03 && !name) name = data.toString('latin1').trim();
        if (type === 0x2f) { lastTick = Math.max(lastTick, tick); break; }
        continue;
      }
      if (s === 0xf0 || s === 0xf7) {
        p++;
        const n = varlen(), data = [...b.subarray(p, Math.min(end, p + n))]; p += n;
        // F0: a SysEx, its F0 not repeated in the data. F7: bytes to send as they are (the rest of a split SysEx, or anything)
        const bytes = s === 0xf0 ? [0xf0, ...data] : data;
        if (bytes.length && (bytes[0] !== 0xf0 || bytes[bytes.length - 1] === 0xf7)) raw.push({ tick, bytes, order: order++ });
        status = 0;
        continue;
      }
      if (s & 0x80) { status = s; p++; } else s = status;      // running status: the last status byte again
      if (!(s & 0x80)) throw new Error('a MIDI file that is damaged (data with no status before it)');
      const n = (s & 0xf0) === 0xc0 || (s & 0xf0) === 0xd0 ? 1 : 2;
      if (p + n > end) break;
      raw.push({ tick, bytes: [s, ...b.subarray(p, p + n)], order: order++ });
      p += n;
    }
    lastTick = Math.max(lastTick, tick);
  }
  if (!tracks) throw new Error('a MIDI file with no tracks in it');
  // ticks → seconds: by the frame for a file timed in frames, else through the tempo changes
  tempoMap.sort((x, y) => x.tick - y.tick || x.order - y.order);
  const marks = [{ tick: 0, at: 0, us: 500000 }];
  for (const t of tempoMap) {
    const m = marks[marks.length - 1];
    const here = m.at + ((t.tick - m.tick) * m.us) / (ppq * 1e6);
    if (t.tick === m.tick) m.us = t.us; else marks.push({ tick: t.tick, at: here, us: t.us });
  }
  let k = 0;
  const secondsAt = (tick: number) => {
    if (smpte) return tick / ((smpte.fps === 29 ? 30000 / 1001 : smpte.fps) * smpte.ticks);
    if (marks[k].tick > tick) k = 0;
    while (k + 1 < marks.length && marks[k + 1].tick <= tick) k++;
    return marks[k].at + ((tick - marks[k].tick) * marks[k].us) / (ppq * 1e6);
  };
  raw.sort((x, y) => x.tick - y.tick || x.order - y.order);
  const events: MidiFileEvent[] = raw.map((e) => ({ at: secondsAt(e.tick), bytes: e.bytes }));
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    format, tracks, ...(smpte ? { smpte } : { ppq }), events, name,
    seconds: secondsAt(lastTick),
    tempos: smpte ? [] : marks.map((m) => ({ at: m.at, bpm: r1(6e7 / m.us) })),
    notes: events.filter((e) => (e.bytes[0] & 0xf0) === 0x90 && e.bytes[2] > 0).length,
  };
}

/**
 * A parsed file as the playout plays it (core/net/playout.ts): `between(t0, t1)` is what falls in that stretch of
 * the cue's own time, at its rate (2: twice as fast). It remembers which notes it has started, so that `flush()`
 * can end them when the cue is stopped or paused part way; `locate(t)`, for a cue started or resumed part way in,
 * is the programs, controllers and bends the file had set by then, so the instrument is as it would have been.
 */
export type MidiFile = ReturnType<typeof parse>;

class MidiFileStream {
  events: MidiFileEvent[];
  rate: number;
  total: number;
  i: number;
  on: Set<number>;
  constructor(file: { events: MidiFileEvent[]; seconds: number }, { rate = 1 }: { rate?: unknown } = {}) {
    this.events = file.events; this.rate = Number(rate) > 0 ? Number(rate) : 1;
    this.total = file.seconds / this.rate; this.i = 0; this.on = new Set();
  }
  between(t0: number, t1: number): MidiFileEvent[] {
    const ev = this.events, a = t0 * this.rate, b = t1 * this.rate, out: MidiFileEvent[] = [];
    if (this.i > 0 && ev[this.i - 1].at >= a) this.i = 0;      // asked for an earlier stretch than the last: look again
    while (this.i < ev.length && ev[this.i].at < a - 1e-9) this.i++;
    for (; this.i < ev.length && ev[this.i].at < b - 1e-9; this.i++) {
      const e = ev[this.i], hi = e.bytes[0] & 0xf0, key = ((e.bytes[0] & 15) << 7) | e.bytes[1];
      if (hi === 0x90 && e.bytes[2] > 0) this.on.add(key); else if (hi === 0x80 || hi === 0x90) this.on.delete(key);
      out.push({ at: e.at / this.rate, bytes: e.bytes });
    }
    return out;
  }
  locate(t: number): number[][] {
    const last = new Map<number, number[]>();
    if (!(t > 0)) return [];
    for (const e of this.events) {
      if (e.at >= t * this.rate - 1e-9) break;
      const hi = e.bytes[0] & 0xf0;
      if (hi === 0xc0 || hi === 0xd0 || hi === 0xe0) last.set(e.bytes[0], e.bytes); else if (hi === 0xb0) last.set((e.bytes[0] << 8) | e.bytes[1], e.bytes);
    }
    return [...last.values()];
  }
  flush() {
    const out = [...this.on].map((key) => [0x80 | (key >> 7), key & 0x7f, 0]);
    this.on.clear();
    return out;
  }
}

export { parse, MidiFileStream };
