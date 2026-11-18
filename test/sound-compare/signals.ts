/**
 * The test signals the sound comparison plays (test/sound-compare/qlab.ts): tones that can be told apart while they
 * sound together, bursts that count their plays, and a file of three tones for slices. 48 kHz, 32-bit float.
 *
 * Every tone is a multiple of 200 Hz, so over 5 ms (240 frames, the analysis window of analyse.ts) each is a whole
 * number of cycles and none leaks into another's measure.
 */
import * as fs from 'fs';
import * as path from 'path';

export const RATE = 48000;
/** −12 dBFS: three at once stay under the limiter. */
export const AMP = 0.25;

/** A file the scenes play. `f`: a tone on every channel; `f2`: another on the second channel. */
export type Signal =
  | { kind: 'tone'; f: number; f2?: number; secs: number; channels: 1 | 2 }
  | { kind: 'burst'; f: number; on: number; secs: number; channels: 1 | 2 }
  | { kind: 'slices'; fs: number[]; each: number; channels: 1 | 2 };

/** The samples of a signal, interleaved. */
export function samples(s: Signal): { channels: number; data: Float32Array } {
  const ch = s.channels;
  const secs = s.kind === 'slices' ? s.fs.length * s.each : s.secs;
  const n = Math.round(secs * RATE);
  const data = new Float32Array(n * ch);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    for (let c = 0; c < ch; c++) {
      let f = 0, on = true;
      if (s.kind === 'tone') f = c === 1 && s.f2 ? s.f2 : s.f;
      else if (s.kind === 'burst') { f = s.f; on = t < s.on; }
      else f = s.fs[Math.min(s.fs.length - 1, Math.floor(i / Math.round(s.each * RATE)))];
      // (each tone starts at phase 0 of its own segment, so a slice's edge is where its tone changes)
      const t0 = s.kind === 'slices' ? (i % Math.round(s.each * RATE)) / RATE : t;
      data[i * ch + c] = on ? AMP * Math.sin(2 * Math.PI * f * t0) : 0;
    }
  }
  return { channels: ch, data };
}

/** A 32-bit float WAV. */
export function writeWav(file: string, rate: number, channels: number, data: Float32Array) {
  const b = Buffer.alloc(44 + data.length * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * channels * 4, 28); b.writeUInt16LE(channels * 4, 32); b.writeUInt16LE(32, 34); b.write('data', 36); b.writeUInt32LE(data.length * 4, 40);
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(b, 44);
  fs.writeFileSync(file, b);
}

/** A WAV read back: 16, 24 or 32-bit integer, or 32-bit float. */
export function readWav(file: string): { rate: number; channels: number; data: Float32Array } {
  const b = fs.readFileSync(file);
  let at = 12, fmt = 0, channels = 0, rate = 0, bits = 0;
  while (at + 8 <= b.length) {
    const id = b.toString('latin1', at, at + 4), len = b.readUInt32LE(at + 4);
    if (id === 'fmt ') { fmt = b.readUInt16LE(at + 8); channels = b.readUInt16LE(at + 10); rate = b.readUInt32LE(at + 12); bits = b.readUInt16LE(at + 22); if (fmt === 0xfffe) fmt = b.readUInt16LE(at + 32); }
    if (id === 'data') {
      const body = b.subarray(at + 8, Math.min(b.length, at + 8 + (len || b.length)));
      const n = Math.floor(body.length / (bits / 8));
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        data[i] = fmt === 3 ? body.readFloatLE(i * 4) : bits === 16 ? body.readInt16LE(i * 2) / 32768 : bits === 24 ? body.readIntLE(i * 3, 3) / 8388608 : body.readInt32LE(i * 4) / 2147483648;
      }
      return { rate, channels, data };
    }
    at += 8 + len + (len & 1);
  }
  throw new Error(`${file}: no data`);
}

/** Each signal written into `dir` as <name>.wav. */
export function writeAll(dir: string, signals: Record<string, Signal>) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, s] of Object.entries(signals)) {
    const file = path.join(dir, `${name}.wav`);
    const { channels, data } = samples(s);
    writeWav(file, RATE, channels, data);
  }
}
