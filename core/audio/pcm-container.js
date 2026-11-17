/**
 * AIFF and CAF, made playable.
 *
 * The app's sound is Chromium's, and Chromium reads neither AIFF nor Apple's CAF (measured: the element refuses
 * them and decodeAudioData fails), though half the sound effects on a Mac are one or the other. Both are usually
 * plain PCM in a different wrapper, so such a file is played from a WAV copy of itself: the same samples, byte
 * order turned round where it must be. The copy is made once, beside the system's temporary files, and found
 * again by the original's path, size and date; the show's own file is never touched.
 *
 *   toWav(buffer) → Buffer | null     a WAV of the same sound; null when it is not AIFF/AIFC/CAF. Throws (with a
 *                                     reason an operator can read) when it is one whose sound is compressed.
 *   wavCopyOf(file, cacheDir) → path  the copy's path (made if need be); the file's own path when it needs none.
 *
 * No Electron.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NEEDS_COPY = /\.(aiff?|aifc|caf)$/i;
const tag = (b, at) => b.toString('latin1', at, at + 4);

/** An 80-bit extended float (AIFF's sample rate). */
function extended(b, at) {
  const exp = ((b[at] & 0x7f) << 8) | b[at + 1];
  const hi = b.readUInt32BE(at + 2), lo = b.readUInt32BE(at + 6);
  if (!exp && !hi && !lo) return 0;
  return (hi * 2 ** 32 + lo) * 2 ** (exp - 16383 - 63);
}

function wavOf({ rate, channels, bits, float, data }) {
  const h = Buffer.alloc(44), bytes = bits / 8;
  h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8, 'latin1'); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(float ? 3 : 1, 20); h.writeUInt16LE(channels, 22); h.writeUInt32LE(Math.round(rate), 24);
  h.writeUInt32LE(Math.round(rate) * channels * bytes, 28); h.writeUInt16LE(channels * bytes, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36, 'latin1'); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** PCM samples as a WAV keeps them: little-endian, and 8-bit ones unsigned. */
function samples(src, bytes, bigEndian, signed8) {
  const out = Buffer.from(src.subarray(0, src.length - (src.length % bytes)));
  if (bytes === 1) { if (signed8) for (let i = 0; i < out.length; i++) out[i] = (out[i] + 128) & 0xff; return out; }
  if (!bigEndian) return out;
  if (bytes === 2) out.swap16(); else if (bytes === 4) out.swap32(); else if (bytes === 8) out.swap64();
  else for (let i = 0; i + bytes <= out.length; i += bytes) out.subarray(i, i + bytes).reverse();      // 24-bit
  return out;
}

function aiffToWav(b) {
  const aifc = tag(b, 8) === 'AIFC';
  let comm = null, data = null, at = 12;
  while (at + 8 <= b.length) {
    const id = tag(b, at), len = b.readUInt32BE(at + 4), body = at + 8;
    if (id === 'COMM') comm = { channels: b.readUInt16BE(body), frames: b.readUInt32BE(body + 2), bits: b.readUInt16BE(body + 6), rate: extended(b, body + 8), kind: aifc && len >= 22 ? tag(b, body + 18) : 'NONE' };
    else if (id === 'SSND') { const off = b.readUInt32BE(body); data = b.subarray(body + 8 + off, Math.min(b.length, body + len)); }
    at = body + len + (len % 2);
  }
  if (!comm || !data) throw new Error('an AIFF file with no sound in it');
  const kind = comm.kind.toLowerCase();
  if (!['none', 'sowt', 'twos', 'fl32', 'fl64', 'in24', 'in32'].includes(kind)) throw new Error(`an AIFF-C file whose sound is compressed (${comm.kind.trim()}): convert it to WAV or plain AIFF`);
  const float = kind === 'fl32' || kind === 'fl64';
  const bits = float ? (kind === 'fl64' ? 64 : 32) : Math.ceil(comm.bits / 8) * 8;
  const pcm = samples(data.subarray(0, Math.min(data.length, comm.frames * comm.channels * (bits / 8)) || data.length), bits / 8, kind !== 'sowt', true);
  return wavOf({ rate: comm.rate, channels: comm.channels, bits, float, data: pcm });
}

function cafToWav(b) {
  let desc = null, data = null, at = 8;
  while (at + 12 <= b.length) {
    const id = tag(b, at), len = Number(b.readBigInt64BE(at + 4)), body = at + 12;
    const end = len < 0 ? b.length : Math.min(b.length, body + len);
    if (id === 'desc') desc = { rate: b.readDoubleBE(body), format: tag(b, body + 8), flags: b.readUInt32BE(body + 12), channels: b.readUInt32BE(body + 24), bits: b.readUInt32BE(body + 28) };
    else if (id === 'data') data = b.subarray(body + 4, end);            // (four bytes of edit count first)
    if (len < 0) break;
    at = end;
  }
  if (!desc || !data) throw new Error('a CAF file with no sound in it');
  if (desc.format !== 'lpcm') throw new Error(`a CAF file whose sound is compressed (${desc.format.trim()}): convert it to WAV`);
  const float = !!(desc.flags & 1), little = !!(desc.flags & 2);
  return wavOf({ rate: desc.rate, channels: desc.channels, bits: desc.bits, float, data: samples(data, desc.bits / 8, !little, true) });
}

function toWav(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (tag(b, 0) === 'FORM' && (tag(b, 8) === 'AIFF' || tag(b, 8) === 'AIFC')) return aiffToWav(b);
  if (tag(b, 0) === 'caff') return cafToWav(b);
  return null;
}

function wavCopyOf(file, cacheDir) {
  if (!file || !NEEDS_COPY.test(file)) return file;
  const st = fs.statSync(file);
  const name = `${crypto.createHash('sha1').update(`${path.resolve(file)}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 20)}.wav`;
  const copy = path.join(cacheDir, name);
  if (fs.existsSync(copy)) return copy;
  const wav = toWav(fs.readFileSync(file));
  if (!wav) return file;
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(`${copy}.part`, wav);
  fs.renameSync(`${copy}.part`, copy);                // (never a half-written copy under the name it is found by)
  return copy;
}

module.exports = { toWav, wavCopyOf, NEEDS_COPY };
