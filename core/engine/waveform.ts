/**
 * Waveform peaks for the app's waveform views, read straight from a WAV
 * file in 1 MB chunks: a 12-minute 24-bit mix is ~200 MB, and decoding it
 * whole to draw a picture would double the app's memory for nothing.
 *
 * Returns { peaks, rms }: `bins` numbers 0..1 each, the loudest sample in each
 * slice (all channels) and its RMS — the loudness, which is what shows a mastered
 * mix's shape: its peaks sit at full scale nearly everywhere (drawn from peaks alone
 * such a track is a solid block). Null when the file is not a WAV this reads (PCM 16/24/32 or
 * float 32; plain or WAVE_FORMAT_EXTENSIBLE). The host falls back to the sound
 * window's decoder for anything else (the short mp3 effects).
 */
import * as fs from 'fs';

function wavPeaks(file: string, bins = 1600) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(12);
    if (fs.readSync(fd, head, 0, 12, 0) < 12 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') return null;
    let pos = 12;
    let fmt = null;
    let dataStart = -1;
    let dataLen = 0;
    const ch = Buffer.alloc(8);
    const size = fs.fstatSync(fd).size;
    while (pos + 8 <= size) {
      fs.readSync(fd, ch, 0, 8, pos);
      const id = ch.toString('latin1', 0, 4);
      const len = ch.readUInt32LE(4);
      if (id === 'fmt ') {
        const b = Buffer.alloc(Math.min(len, 40));
        fs.readSync(fd, b, 0, b.length, pos + 8);
        let format = b.readUInt16LE(0);
        if (format === 0xfffe && b.length >= 26) format = b.readUInt16LE(24);   // extensible: the subformat
        fmt = { format, channels: b.readUInt16LE(2), bits: b.readUInt16LE(14) };
      } else if (id === 'data') {
        dataStart = pos + 8;
        dataLen = Math.min(len, size - dataStart);
        break;
      }
      pos += 8 + len + (len % 2);
    }
    if (!fmt || dataStart < 0) return null;
    const bytes = fmt.bits / 8;
    const read = sampleReader(fmt.format, fmt.bits);
    if (!read) return null;
    const frame = bytes * fmt.channels;
    const frames = Math.floor(dataLen / frame);
    if (!frames) return null;
    const peaks = new Array(bins).fill(0);
    const sq = new Array(bins).fill(0), count = new Array(bins).fill(0);
    const per = frames / bins;
    const CHUNK = Math.floor((1 << 20) / frame) * frame;
    const buf = Buffer.alloc(CHUNK);
    let done = 0;
    while (done < frames) {
      const want = Math.min(CHUNK, (frames - done) * frame);
      const got = fs.readSync(fd, buf, 0, want, dataStart + done * frame);
      if (got <= 0) break;
      const n = Math.floor(got / frame);
      for (let i = 0; i < n; i++) {
        const bin = Math.min(bins - 1, Math.floor((done + i) / per));
        const base = i * frame;
        let m = peaks[bin];
        for (let c = 0; c < fmt.channels; c++) {
          const v = Math.abs(read(buf, base + c * bytes));
          if (v > m) m = v;
          sq[bin] += v * v;
        }
        count[bin] += fmt.channels;
        peaks[bin] = m;
      }
      done += n;
    }
    const r3 = (v: number) => Math.round(Math.min(1, v) * 1000) / 1000;
    return { peaks: peaks.map(r3), rms: sq.map((v, i) => r3(count[i] ? Math.sqrt(v / count[i]) : 0)) };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ }
  }
}

/** { seconds, channels, rate, bits } from a WAV's header, or null. */
function wavInfo(file: string | null) {
  if (!file) return null;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(12);
    if (fs.readSync(fd, head, 0, 12, 0) < 12 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') return null;
    const size = fs.fstatSync(fd).size;
    const ch = Buffer.alloc(8);
    let pos = 12, fmt = null;
    while (pos + 8 <= size) {
      fs.readSync(fd, ch, 0, 8, pos);
      const id = ch.toString('latin1', 0, 4), len = ch.readUInt32LE(4);
      if (id === 'fmt ') {
        const b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, pos + 8);
        fmt = { channels: b.readUInt16LE(2), rate: b.readUInt32LE(4), byteRate: b.readUInt32LE(8), bits: b.readUInt16LE(14) };
      } else if (id === 'data' && fmt) {
        return { seconds: Math.min(len, size - pos - 8) / fmt.byteRate, channels: fmt.channels, rate: fmt.rate, bits: fmt.bits };
      }
      pos += 8 + len + (len % 2);
    }
    return null;
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}

function sampleReader(format: number, bits: number): ((b: Buffer, o: number) => number) | null {
  if (format === 1 && bits === 16) return (b, o) => b.readInt16LE(o) / 32768;
  if (format === 1 && bits === 24) return (b, o) => b.readIntLE(o, 3) / 8388608;
  if (format === 1 && bits === 32) return (b, o) => b.readInt32LE(o) / 2147483648;
  if (format === 3 && bits === 32) return (b, o) => b.readFloatLE(o);
  return null;
}

export { wavPeaks, wavInfo };
