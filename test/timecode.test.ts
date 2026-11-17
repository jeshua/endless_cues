import test from 'node:test';
import assert from 'node:assert/strict';
import * as tc from '../core/timecode/timecode';

test('a timecode as text, and what is not one', () => {
  assert.deepEqual(tc.parse('01:02:03:04'), { h: 1, m: 2, s: 3, f: 4 });
  assert.deepEqual(tc.parse(' 1:0:0;00 '), { h: 1, m: 0, s: 0, f: 0 });
  for (const bad of ['', '1:00', '01:00:00', '24:00:00:00', '01:60:00:00', '01:00:00:30', 'now']) assert.equal(tc.parse(bad), null, bad);
  assert.equal(tc.format({ h: 1, m: 2, s: 3, f: 4 }, '25'), '01:02:03:04');
  assert.equal(tc.format({ h: 1, m: 2, s: 3, f: 4 }, '29.97df'), '01:02:03;04');
  assert.match(tc.whyNot(tc.parse('00:00:00:24'), '24'), /no frame 24/);
  assert.match(tc.whyNot(tc.parse('00:01:00:00'), '29.97df'), /drop-frame/);
  assert.equal(tc.whyNot(tc.parse('00:10:00:00'), '29.97df'), '');
  assert.equal(tc.framesOf('00:01:00:01', '29.97df'), null);
  assert.equal(tc.framesOf('00:00:01:00', '25'), 25);
});

test('frames and times, both ways, at every rate', () => {
  assert.equal(tc.toFrames(tc.parse('01:00:00:00')!, '24'), 86400);
  assert.equal(tc.toFrames(tc.parse('01:00:00:00')!, '25'), 90000);
  assert.equal(tc.toFrames(tc.parse('01:00:00:00')!, '30'), 108000);
  // drop-frame: the known landmarks. One minute is 1800 frames less the two numbers skipped; an hour is 107892.
  assert.equal(tc.toFrames(tc.parse('00:01:00:02')!, '29.97df'), 1800);
  assert.equal(tc.toFrames(tc.parse('00:10:00:00')!, '29.97df'), 17982);
  assert.equal(tc.toFrames(tc.parse('01:00:00:00')!, '29.97df'), 107892);
  assert.deepEqual(tc.fromFrames(1799, '29.97df'), { h: 0, m: 0, s: 59, f: 29 });
  assert.deepEqual(tc.fromFrames(1800, '29.97df'), { h: 0, m: 1, s: 0, f: 2 });      // 00:01:00:00 and :01 do not exist
  assert.deepEqual(tc.fromFrames(17982, '29.97df'), { h: 0, m: 10, s: 0, f: 0 });   // every tenth minute keeps them
  // an hour of drop-frame timecode is an hour of time to within four hundredths of a second
  assert.ok(Math.abs(tc.secondsOf(107892, '29.97df') - 3600) < 0.004);
  for (const rate of tc.RATE_NAMES) {
    for (const n of [0, 1, 29, 30, 1799, 1800, 1801, 17981, 17982, 17983, 107891, 107892, 500000, 2589407]) {
      const t = tc.fromFrames(n, rate);
      assert.equal(tc.whyNot(t, rate), '', `${rate} ${n}`);
      if (n < tc.rateOf(rate).fps * 86400 - (rate === '29.97df' ? 2592 : 0)) assert.equal(tc.toFrames(t, rate), n, `${rate} ${n}`);
    }
  }
  assert.deepEqual(tc.fromFrames(24 * 86400, '24'), { h: 0, m: 0, s: 0, f: 0 });   // round the clock
  assert.deepEqual(tc.fromFrames(2589408, '29.97df'), { h: 0, m: 0, s: 0, f: 0 });
});

test('MTC: a full frame and the eight quarter frames, to the byte', () => {
  const t = tc.parse('01:02:03:04')!;
  // F0 7F <device> 01 01 hr mn sc fr F7, the rate in bits 5–6 of the hours: 30 fps is 3, so 0x60 | 1
  assert.deepEqual(tc.fullFrame(t, '30'), [0xf0, 0x7f, 0x7f, 0x01, 0x01, 0x61, 0x02, 0x03, 0x04, 0xf7]);
  assert.deepEqual(tc.fullFrame(t, '24'), [0xf0, 0x7f, 0x7f, 0x01, 0x01, 0x01, 0x02, 0x03, 0x04, 0xf7]);
  assert.deepEqual(tc.fullFrame(t, '25'), [0xf0, 0x7f, 0x7f, 0x01, 0x01, 0x21, 0x02, 0x03, 0x04, 0xf7]);
  assert.deepEqual(tc.fullFrame(t, '29.97df'), [0xf0, 0x7f, 0x7f, 0x01, 0x01, 0x41, 0x02, 0x03, 0x04, 0xf7]);
  // 23:59:58:29 at 25 fps: frames 29 = 0x1D, seconds 58 = 0x3A, minutes 59 = 0x3B, hours 23 = 0x17, rate 1
  const late = { h: 23, m: 59, s: 58, f: 29 };
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((p) => tc.quarterFrame(p, late, '25')[1]), [0x0d, 0x11, 0x2a, 0x33, 0x4b, 0x53, 0x67, 0x73]);
  assert.equal(tc.quarterFrame(0, late, '25')[0], 0xf1);
});

test('MTC out: four quarter frames to the frame, eight to a time, none lost or doubled where two stretches meet', () => {
  const start = tc.toFrames(tc.parse('01:00:00:00')!, '30');
  const all = tc.mtcBetween(start, '30', 0, 1);
  assert.equal(all.length, 120);
  assert.equal(all[0].at, 0);
  assert.ok(Math.abs(all[1].at - 1 / 120) < 1e-12);
  assert.deepEqual(all.slice(0, 9).map((e) => e.bytes[1] >> 4), [0, 1, 2, 3, 4, 5, 6, 7, 0]);
  // the same second asked for in uneven pieces is the same messages
  const pieces = [];
  for (let t = 0, step = 0.0137; t < 1; t += step) pieces.push(...tc.mtcBetween(start, '30', t, Math.min(1, t + step)));
  assert.deepEqual(pieces, all);
  // what was sent reads back as the time, two frames on with each run of eight
  const reader = new tc.MtcReader(), heard = [];
  for (const e of all) { const r = reader.feed(e.bytes); if (r) heard.push(r); }
  assert.equal(heard.length, 15);
  assert.deepEqual(heard[0].tc, { h: 1, m: 0, s: 0, f: 0 });
  assert.equal(heard[0].rate, '30');
  assert.equal(heard[0].frames, start + 1.75);           // the eighth piece arrives a frame and three quarters after the time it says
  assert.deepEqual(heard[14].tc, { h: 1, m: 0, s: 0, f: 28 });
  // 29.97 drop: 119.88 quarter frames a second, and the time steps over the dropped numbers
  const df = tc.mtcBetween(tc.toFrames(tc.parse('00:00:59:28')!, '29.97df'), '29.97df', 0, 10);
  assert.equal(df.length, Math.ceil(10 * 4 * 30000 / 1001));
  const r2 = new tc.MtcReader(), times = [];
  for (const e of df) { const r = r2.feed(e.bytes); if (r) times.push(tc.format(r.tc, r.rate)); }
  assert.deepEqual(times.slice(0, 3), ['00:00:59;28', '00:01:00;02', '00:01:00;04']);
});

test('MTC in: a full frame is the time outright; a run joined part way, or backwards, is not a time', () => {
  const r = new tc.MtcReader();
  const full = r.feed(tc.fullFrame(tc.parse('10:20:30:12')!, '25'))!;
  assert.deepEqual([full.tc, full.rate, full.full, full.frames], [{ h: 10, m: 20, s: 30, f: 12 }, '25', true, tc.toFrames(tc.parse('10:20:30:12')!, '25')]);
  const t = tc.parse('00:00:01:00')!;
  for (const p of [3, 4, 5, 6, 7]) assert.equal(r.feed(tc.quarterFrame(p, t, '24')), null);     // joined at piece 3
  for (const p of [0, 1, 2, 3, 4, 5, 6]) assert.equal(r.feed(tc.quarterFrame(p, t, '24')), null);
  assert.equal(r.feed(tc.quarterFrame(7, t, '24'))!.rate, '24');
  for (const p of [7, 6, 5, 4, 3, 2, 1, 0]) assert.equal(r.feed(tc.quarterFrame(p, t, '24')), null);     // backwards
  assert.equal(r.feed([0x90, 60, 100]), null);
});

test('LTC: the 80 bits of a frame, as SMPTE lays them out', () => {
  const bits = [...tc.ltcBits({ h: 12, m: 34, s: 56, f: 17 }, '30')];
  const field = (at: number, n: number) => bits.slice(at, at + n).reduce((v, b, i) => v | (b << i), 0);
  assert.deepEqual([field(0, 4), field(8, 2), field(16, 4), field(24, 3), field(32, 4), field(40, 3), field(48, 4), field(56, 2)], [7, 1, 6, 5, 4, 3, 2, 1]);
  assert.equal(bits.slice(64).join(''), '0011111111111101');                        // the sync word
  assert.equal(bits[10], 0);
  assert.equal(tc.ltcBits({ h: 0, m: 0, s: 0, f: 2 }, '29.97df')[10], 1);            // the drop-frame flag
  // every frame has an even number of ones (so each starts on the same polarity): by bit 27, or bit 59 at 25 fps
  for (const rate of tc.RATE_NAMES) for (let n = 0; n < 4000; n += 37) assert.equal([...tc.ltcBits(tc.fromFrames(n, rate), rate)].reduce((a, b) => a + b, 0) % 2, 0);
  const odd = { h: 0, m: 0, s: 0, f: 1 };                                             // one 1 in the time, twelve + one in the sync word
  assert.equal(tc.ltcBits(odd, '30')[27], 0); assert.equal(tc.ltcBits(odd, '25')[59], 0);
  const even = { h: 0, m: 0, s: 0, f: 3 };
  assert.equal(tc.ltcBits(even, '30')[27], 1); assert.equal(tc.ltcBits(even, '30')[59], 0);
  assert.equal(tc.ltcBits(even, '25')[59], 1); assert.equal(tc.ltcBits(even, '25')[27], 0);
});

test('LTC as sound is biphase mark: an edge at every bit, one more in the middle of a 1', () => {
  // 30 fps at 48 kHz: a bit is exactly 20 samples
  const w = new tc.LtcWriter({ rate: '30', sampleRate: 48000, start: 0, level: 0.5 });
  const buf = w.render(new Float32Array(1600));
  const bits = tc.ltcBits({ h: 0, m: 0, s: 0, f: 0 }, '30');
  for (let cell = 1; cell < 80; cell++) {
    const at = cell * 20;
    assert.notEqual(Math.sign(buf[at]), Math.sign(buf[at - 1]), `an edge where bit ${cell} starts`);
    assert.equal(Math.sign(buf[at + 10]) !== Math.sign(buf[at + 9]), bits[cell] === 1, `bit ${cell} is ${bits[cell]}`);
  }
  assert.ok(buf.every((x) => Math.abs(x) === 0.5));
});

test('LTC out is read back by decoding it: every rate, two sample rates, blocks of any size, either polarity, any level', () => {
  for (const rate of tc.RATE_NAMES) {
    for (const sampleRate of [48000, 44100]) {
      const start = tc.toFrames(tc.parse(rate === '29.97df' ? '00:00:59;20' : '01:59:59:10')!, rate) + 0.37;      // (it starts part way through a frame)
      const w = new tc.LtcWriter({ rate, sampleRate, start, level: 0.25 });
      const r = new tc.LtcReader({ sampleRate });
      const frames = [];
      // an audio worklet's blocks are 128 samples; the reader is fed in other sizes to show it does not care
      for (let done = 0, k = 0; done < sampleRate * 2; k++) {
        const block = w.render(new Float32Array(128));
        done += 128;
        if (rate === '25') for (let i = 0; i < block.length; i++) block[i] = -block[i] * 0.1;      // upside down and quiet
        for (let i = 0; i < 128; i += 50) frames.push(...r.feed(block.subarray(i, Math.min(128, i + 50))));
      }
      const first = Math.floor(start) + 1;
      assert.ok(frames.length >= tc.rateOf(rate).real * 2 - 6, `${rate} at ${sampleRate}: ${frames.length} frames heard`);
      const from = tc.toFrames(frames[0].tc, rate);
      assert.ok(from >= first && from <= first + 4, `${rate} at ${sampleRate}: the first frame heard is one of the first sent`);
      frames.forEach((f, i) => assert.equal(tc.toFrames(f.tc, rate), from + i, `${rate} at ${sampleRate}: no frame missed or repeated`));
      assert.equal(frames.at(-1)!.rate, rate);
      assert.ok(Math.abs(frames.at(-1)!.fps - tc.rateOf(rate).real) < 0.2);
      // where each frame ended, to the sample: frame n ends at (n + 1 − start) frames of samples from the first
      const f = frames[5], want = (tc.toFrames(f.tc, rate) + 1 - start) * sampleRate / tc.rateOf(rate).real;
      assert.ok(Math.abs(f.end - want) <= 2, `${rate} at ${sampleRate}: frame end ${f.end} against ${want}`);
    }
  }
  // drop-frame over the minute: :29 is followed by :02
  const w = new tc.LtcWriter({ rate: '29.97df', start: tc.toFrames(tc.parse('00:00:59:27')!, '29.97df') }), r = new tc.LtcReader({});
  const heard = r.feed(w.render(new Float32Array(48000 / 2))).map((f) => tc.format(f.tc, '29.97df'));
  const at = heard.indexOf('00:00:59;29');
  assert.ok(at >= 0 && heard[at + 1] === '00:01:00;02' && heard[at + 2] === '00:01:00;03', heard.join(' '));
  assert.ok(heard.every((t) => !/^00:01:00;0[01]$/.test(t)));
});

test('silence, noise and a signal that stops are not timecode', () => {
  const r = new tc.LtcReader({});
  assert.deepEqual(r.feed(new Float32Array(48000)), []);
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  assert.deepEqual(r.feed(Float32Array.from({ length: 48000 }, rnd)), []);
  // …and after that, real timecode is still found
  const w = new tc.LtcWriter({ rate: '25', start: 250 });
  assert.ok(r.feed(w.render(new Float32Array(48000))).length > 15);
});

test('the same file runs where there is no require: its own text makes the same thing', () => {
  const again = new Function(`return ${tc.SOURCE}`)();
  assert.deepEqual(again.fullFrame(again.parse('01:02:03:04')!, '30'), tc.fullFrame(tc.parse('01:02:03:04')!, '30'));
  assert.deepEqual([...again.ltcBits({ h: 1, m: 2, s: 3, f: 4 }, '25')], [...tc.ltcBits({ h: 1, m: 2, s: 3, f: 4 }, '25')]);
});
