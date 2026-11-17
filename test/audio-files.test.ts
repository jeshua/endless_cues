// AIFF and CAF made playable (a WAV copy), and the output device watched.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { toWav, wavCopyOf } from '../core/audio/pcm-container';
import { wavPeaks } from '../core/engine/waveform';
import * as watch from '../core/audio/device-watch';

/** 80-bit extended, for an AIFF's sample rate. */
function ext(rate: number) { const b = Buffer.alloc(10); let e = 16383 + 63, m = BigInt(Math.round(rate)); while (m < (1n << 63n)) { m <<= 1n; e--; } b.writeUInt16BE(e, 0); b.writeBigUInt64BE(m, 2); return b; }
function chunk(id: string, body: Buffer) { const h = Buffer.alloc(8); h.write(id, 0, 'latin1'); h.writeUInt32BE(body.length, 4); return Buffer.concat([h, body, Buffer.alloc(body.length % 2)]); }
function aiff(samples: number[], { rate = 22050, channels = 1, kind = null as string | null } = {}) {
  const data = Buffer.alloc(8 + samples.length * 2);
  samples.forEach((v, i) => (kind === 'sowt' ? data.writeInt16LE(v, 8 + i * 2) : data.writeInt16BE(v, 8 + i * 2)));
  const comm = Buffer.alloc(8); comm.writeUInt16BE(channels, 0); comm.writeUInt32BE(samples.length / channels, 2); comm.writeUInt16BE(16, 6);
  const body = Buffer.concat([Buffer.from(kind ? 'AIFC' : 'AIFF', 'latin1'), chunk('COMM', Buffer.concat([comm, ext(rate), ...(kind ? [Buffer.from(kind, 'latin1'), Buffer.from([0, 0])] : [])])), chunk('SSND', data)]);
  const h = Buffer.alloc(8); h.write('FORM', 0, 'latin1'); h.writeUInt32BE(body.length, 4);
  return Buffer.concat([h, body]);
}
function caf(samples: number[], { rate = 22050, flags = 2, format = 'lpcm' } = {}) {
  const c = (id: string, body: Buffer) => { const h = Buffer.alloc(12); h.write(id, 0, 'latin1'); h.writeBigInt64BE(BigInt(body.length), 4); return Buffer.concat([h, body]); };
  const desc = Buffer.alloc(32); desc.writeDoubleBE(rate, 0); desc.write(format, 8, 'latin1'); desc.writeUInt32BE(flags, 12); desc.writeUInt32BE(2, 16); desc.writeUInt32BE(1, 20); desc.writeUInt32BE(1, 24); desc.writeUInt32BE(16, 28);
  const data = Buffer.alloc(4 + samples.length * 2);
  samples.forEach((v, i) => (flags & 2 ? data.writeInt16LE(v, 4 + i * 2) : data.writeInt16BE(v, 4 + i * 2)));
  const head = Buffer.alloc(8); head.write('caff', 0, 'latin1'); head.writeUInt16BE(1, 4);
  return Buffer.concat([head, c('desc', desc), c('data', data)]);
}
const pcmOf = (wav: Buffer | null) => { const n = wav!.readUInt32LE(40) / 2; return Array.from({ length: n }, (_, i) => wav!.readInt16LE(44 + i * 2)); };
const tone = Array.from({ length: 2000 }, (_, i) => Math.round(12000 * Math.sin(i / 8)));

test('an AIFF becomes a WAV of the same samples, at the same rate', () => {
  const wav = toWav(aiff(tone, { rate: 44100 }))!;
  assert.equal(wav.toString('latin1', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 44100);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.deepEqual(pcmOf(wav), tone);
  assert.deepEqual(pcmOf(toWav(aiff(tone, { kind: 'sowt' }))), tone, 'AIFF-C that is already little-endian is left that way round');
});

test('a CAF of plain PCM becomes a WAV, whichever way round its bytes are', () => {
  assert.deepEqual(pcmOf(toWav(caf(tone))), tone);
  assert.deepEqual(pcmOf(toWav(caf(tone, { flags: 0 }))), tone);
  assert.equal(toWav(caf(tone, { rate: 48000 }))!.readUInt32LE(24), 48000);
});

test('a compressed one is refused with a reason, and anything else is not this module’s business', () => {
  assert.throws(() => toWav(caf(tone, { format: 'aac ' })), /compressed \(aac\)/);
  assert.throws(() => toWav(aiff(tone, { kind: 'ima4' })), /compressed \(ima4\)/);
  assert.equal(toWav(Buffer.from('RIFF....WAVEfmt ')), null);
});

test('the copy is made once, beside the temporary files, and has a waveform', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-pcm-'));
  const file = path.join(dir, 'bell.aiff');
  fs.writeFileSync(file, aiff(tone));
  const copy = wavCopyOf(file, path.join(dir, 'cache'));
  assert.ok(copy.endsWith('.wav') && fs.existsSync(copy));
  const made = fs.statSync(copy).mtimeMs;
  assert.equal(wavCopyOf(file, path.join(dir, 'cache')), copy);
  assert.equal(fs.statSync(copy).mtimeMs, made, 'found again, not made again');
  const p = wavPeaks(copy, 50);
  assert.ok(p && Math.max(...p.peaks) > 0.3);
  assert.equal(wavCopyOf(path.join(dir, 'x.wav'), dir), path.join(dir, 'x.wav'), 'a WAV needs no copy');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── the output device ─────────────────────────────────────────────────────────
const built = { id: 'default', label: 'System default' }, iface = { id: 'abc', label: 'Interface 8' };
const chosen = () => watch.step(null, { type: 'chosen', id: 'abc', label: 'Interface 8' }).state;

test('the chosen output going away moves the show to the default, and its return brings it back', () => {
  let r = watch.step(chosen(), { type: 'devices', list: [built, iface] });
  assert.equal(r.action, null);
  r = watch.step(r.state, { type: 'devices', list: [built] });
  assert.deepEqual(r.action, { do: 'fallback', label: 'Interface 8' });
  r = watch.step(r.state, { type: 'devices', list: [built] });
  assert.equal(r.action, null, 'said once');
  r = watch.step(r.state, { type: 'devices', list: [built, iface] });
  assert.deepEqual(r.action, { do: 'return', id: 'abc', label: 'Interface 8' });
  assert.equal(r.state.fallback, null);
});

test('a device that comes back under a new id is known by its name', () => {
  let r = watch.step(chosen(), { type: 'devices', list: [built] });
  r = watch.step(r.state, { type: 'devices', list: [built, { id: 'xyz', label: 'Interface 8' }] });
  assert.deepEqual(r.action, { do: 'return', id: 'xyz', label: 'Interface 8' });
  assert.equal(r.state.wanted!.id, 'xyz');
});

test('an output that fails while still plugged in is left alone until it has been away', () => {
  let r = watch.step(chosen(), { type: 'failed' });
  assert.equal(r.action!.do, 'fallback');
  r = watch.step(r.state, { type: 'devices', list: [built, iface] });
  assert.equal(r.action, null, 'still listed: going back to it would only fail again');
  r = watch.step(r.state, { type: 'devices', list: [built] });
  r = watch.step(r.state, { type: 'devices', list: [built, iface] });
  assert.equal(r.action!.do, 'return');
});

test('on the system default there is nothing to fall back to: a failure opens the output again', () => {
  const r = watch.step(null, { type: 'failed' });
  assert.deepEqual(r.action, { do: 'revive' });
  assert.equal(watch.step(null, { type: 'devices', list: [built] }).action, null);
  assert.equal(watch.step(chosen(), { type: 'devices', list: [] }).action, null, 'an empty list is the system not having answered yet');
});

test('a device not there when the app starts is waited for; choosing another ends the wait', () => {
  let r = watch.step(chosen(), { type: 'refused' });
  assert.equal(r.action!.do, 'fallback');
  r = watch.step(r.state, { type: 'devices', list: [built, iface] });
  assert.equal(r.action!.do, 'return');
  r = watch.step(watch.step(chosen(), { type: 'refused' }).state, { type: 'chosen', id: 'default' });
  assert.equal(watch.step(r.state, { type: 'devices', list: [built, iface] }).action, null);
});
