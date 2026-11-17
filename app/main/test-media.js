/**
 * Pictures made by code, for the test run (smoke.js): a still of one colour, and a short video of flat colours
 * with a tone for its sound. Nothing is downloaded and nothing is kept in the repository; a few kilobytes are
 * written into the test's own temporary show.
 *
 * The still is a PNG written by hand. The video is a WebM: its frames are encoded as VP8 and its tone as Opus by
 * a page's own encoders (WebCodecs, in the window handed in), and put into the container here. VP8 and Opus are
 * the codecs every build of Electron plays on every platform, which is why the test uses them.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

// ── a PNG of one colour ───────────────────────────────────────────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}
function png(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;      // 8 bits a channel, RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ── a WebM ────────────────────────────────────────────────────────────────
// (EBML: every element is an id, a length and its data; lengths here are always written eight bytes wide)
const size8 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); b[0] |= 0x01; return b; };
const el = (id, data) => Buffer.concat([Buffer.from(id, 'hex'), size8(data.length), data]);
const uint = (id, n, bytes = 8) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(Math.round(n))); return el(id, b.subarray(8 - bytes)); };
const float = (id, x) => { const b = Buffer.alloc(8); b.writeDoubleBE(x); return el(id, b); };
const str = (id, s) => el(id, Buffer.from(s, 'utf8'));

/** `video`: { width, height, frames: [{ ms, key, data }] }; `audio`: { rate, channels, head, frames: [{ ms, data }] } or null. */
function mux({ video, audio, ms }) {
  const tracks = [el('ae', Buffer.concat([uint('d7', 1, 1), uint('73c5', 1, 1), uint('83', 1, 1), str('86', 'V_VP8'),
    el('e0', Buffer.concat([uint('b0', video.width, 2), uint('ba', video.height, 2)]))]))];
  if (audio) tracks.push(el('ae', Buffer.concat([uint('d7', 2, 1), uint('73c5', 2, 1), uint('83', 2, 1), str('86', 'A_OPUS'),
    uint('56aa', (audio.head.readUInt16LE(10) / 48000) * 1e9), uint('56bb', 80e6), el('63a2', audio.head),
    el('e1', Buffer.concat([float('b5', audio.rate), uint('9f', audio.channels, 1)]))])));
  // one cluster a second, each starting on a key frame, so a skip lands cleanly
  const blocks = [...video.frames.map((f) => ({ ...f, track: 1 })), ...(audio ? audio.frames.map((f) => ({ ...f, track: 2, key: true })) : [])].sort((a, b) => a.ms - b.ms || a.track - b.track);
  const clusters = [];
  for (const b of blocks) {
    if (!clusters.length || (b.track === 1 && b.key && b.ms - clusters.at(-1).ms >= 1000)) clusters.push({ ms: b.ms, blocks: [] });
    clusters.at(-1).blocks.push(b);
  }
  const bodies = clusters.map((c) => el('1f43b675', Buffer.concat([uint('e7', c.ms), ...c.blocks.map((b) => {
    const head = Buffer.alloc(4); head[0] = 0x80 | b.track; head.writeInt16BE(Math.round(b.ms - c.ms), 1); head[3] = b.key ? 0x80 : 0;
    return el('a3', Buffer.concat([head, b.data]));
  })])));
  const info = el('1549a966', Buffer.concat([uint('2ad7b1', 1e6), str('4d80', 'Endless Cues test'), str('5741', 'Endless Cues test'), float('4489', ms)]));
  const trackEl = el('1654ae6b', Buffer.concat(tracks));
  // the cues say where each cluster starts (from the start of the segment's data), so they are sized before they are filled
  const cue = (c, at) => el('bb', Buffer.concat([uint('b3', c.ms), el('b7', Buffer.concat([uint('f7', 1, 1), uint('f1', at)]))]));
  const cuesSize = el('1c53bb6b', Buffer.concat(clusters.map((c) => cue(c, 0)))).length;
  let at = info.length + trackEl.length + cuesSize;
  const cues = el('1c53bb6b', Buffer.concat(clusters.map((c, i) => { const here = at; at += bodies[i].length; return cue(c, here); })));
  const header = el('1a45dfa3', Buffer.concat([uint('4286', 1, 1), uint('42f7', 1, 1), uint('42f2', 4, 1), uint('42f3', 8, 1), str('4282', 'webm'), uint('4287', 4, 1), uint('4285', 2, 1)]));
  return Buffer.concat([header, el('18538067', Buffer.concat([info, trackEl, cues, ...bodies]))]);
}

/**
 * A video `secs` long whose picture is `colours[0]` for the first part, `colours[1]` for the next, and so on
 * (each [r, g, b]), with a steady tone for its sound unless `tone` is false. `page(js)` runs script in a window
 * (its encoders make the frames). Resolves to the file's bytes.
 */
async function webm(page, { width = 160, height = 90, secs = 4, fps = 10, colours = [[20, 200, 60]], tone = true } = {}) {
  const got = await page(`(async () => {
    const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    const out = { video: [], audio: [], head: null, error: '' };
    const canvas = new OffscreenCanvas(${width}, ${height});
    const g = canvas.getContext('2d');
    const colours = ${JSON.stringify(colours)};
    const total = ${Math.round(secs * fps)};
    const enc = new VideoEncoder({ output: (c) => { const u = new Uint8Array(c.byteLength); c.copyTo(u); out.video.push({ ms: Math.round(c.timestamp / 1000), key: c.type === 'key', data: b64(u) }); }, error: (e) => { out.error = String(e); } });
    enc.configure({ codec: 'vp8', width: ${width}, height: ${height}, bitrate: 300000, framerate: ${fps} });
    for (let i = 0; i < total; i++) {
      const c = colours[Math.min(colours.length - 1, Math.floor((i / total) * colours.length))];
      g.fillStyle = 'rgb(' + c.join(',') + ')'; g.fillRect(0, 0, ${width}, ${height});
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / ${fps}), duration: Math.round(1e6 / ${fps}) });
      enc.encode(frame, { keyFrame: i % ${fps} === 0 });
      frame.close();
    }
    await enc.flush(); enc.close();
    if (${tone ? 'true' : 'false'}) {
      try {
        const aenc = new AudioEncoder({ output: (c, meta) => { const u = new Uint8Array(c.byteLength); c.copyTo(u); out.audio.push({ ms: Math.round(c.timestamp / 1000), data: b64(u) }); if (meta && meta.decoderConfig && meta.decoderConfig.description && !out.head) out.head = b64(new Uint8Array(meta.decoderConfig.description)); }, error: (e) => { out.error = String(e); } });
        aenc.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 64000 });
        const n = 960;
        for (let i = 0; i * n < ${secs} * 48000; i++) {
          const data = new Float32Array(n);
          for (let k = 0; k < n; k++) data[k] = 0.4 * Math.sin((2 * Math.PI * 440 * (i * n + k)) / 48000);
          const a = new AudioData({ format: 'f32', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 1, timestamp: Math.round((i * n * 1e6) / 48000), data });
          aenc.encode(a); a.close();
        }
        await aenc.flush(); aenc.close();
      } catch (err) { out.audio = []; out.audioError = String(err); }
    }
    return out;
  })()`);
  if (got.error || !got.video.length) throw new Error(`the test video could not be encoded: ${got.error || 'no frames'}`);
  const bytes = (s) => Buffer.from(s, 'base64');
  let head = got.head ? bytes(got.head) : null;
  if (!head && got.audio.length) {      // OpusHead: version 1, one channel, 312 samples of pre-skip, 48 kHz, no gain, mapping family 0
    head = Buffer.alloc(19); head.write('OpusHead', 0, 'ascii'); head[8] = 1; head[9] = 1; head.writeUInt16LE(312, 10); head.writeUInt32LE(48000, 12);
  }
  return {
    bytes: mux({ ms: secs * 1000, video: { width, height, frames: got.video.map((f) => ({ ms: f.ms, key: f.key, data: bytes(f.data) })) },
                 audio: got.audio.length ? { rate: 48000, channels: 1, head, frames: got.audio.map((f) => ({ ms: f.ms, data: bytes(f.data) })) } : null }),
    sound: got.audio.length > 0, audioError: got.audioError || '',
  };
}

// ── the test sounds ───────────────────────────────────────────────────────
// test/fixtures/formats holds one tone in every format (make-format-fixtures.sh). A packaged build does not carry
// the tests: EC_FIXTURES names a checkout's test/fixtures for it, and without one the formats are skipped and the
// tone the other checks play is made here as a WAV (three seconds of 440 Hz fading in over the first half).
const fixturesDir = () => process.env.EC_FIXTURES || path.join(__dirname, '../../test/fixtures');
/** A fixture's path, or null when this run cannot see it. */
function fixture(rel) { const f = path.join(fixturesDir(), rel); return fs.existsSync(f) ? f : null; }
let madeTone = null;
/** The tone in this format when it is there; otherwise the WAV made here (a check that needs the format itself uses fixture()). */
function tone(ext = 'wav') {
  const f = fixture(path.join('formats', `tone.${ext}`)) || fixture(path.join('formats', 'tone.wav'));
  if (f) return f;
  if (!madeTone) {
    const { writeWav } = require('../../examples/make-demo');
    const rate = 44100, n = rate * 3, x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.5 * Math.min(1, i / (rate * 1.5)) * Math.sin(2 * Math.PI * 440 * i / rate);
    madeTone = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-tone-')), 'tone.wav');
    writeWav(madeTone, x);
  }
  return madeTone;
}

module.exports = { png, webm, mux, fixture, tone };
