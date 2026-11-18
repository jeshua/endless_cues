/**
 * The smoke run's checks of sound design and of the kinds of sound (called from smoke.ts).
 *
 * A test run plays to no device, so NOTHING HERE IS LISTENED TO. A chain is checked by measuring it: the audio
 * window renders the same node-building code (core/audio/chain.ts `build`) on an offline context with a
 * synthesised signal through it, and hands back levels and a pitch (`measure` in audio.html). What a playing
 * sound is doing is read from its voice in the audio window; ducking from the host's snapshot.
 * The show is left as it was found (every edit is undone).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as show from '../../core/show/show';
import * as sig from './test-signals';
import type { Smoke, Snap } from './smoke';
import type { Op } from '../../core/show/ops';

const RATE = 44100;
/** A mono 16-bit WAV of `samples` (−1…1 at `rate`). */
function writeMono(file: string, samples: Float32Array | number[], rate = RATE) {
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(file, buf);
}
const tone = (secs: number, from = 0, to = secs, hz = 440, amp = 0.4) => { const x = new Float32Array(Math.round(RATE * secs)); for (let i = Math.round(from * RATE); i < Math.min(x.length, Math.round(to * RATE)); i++) x[i] = amp * Math.sin(2 * Math.PI * hz * i / RATE); return x; };

/** What the audio window's `measure` gives back: each side's level every 10 ms (dB), the frequency, and what was built. */
interface Measured { l: number[]; r: number[]; hz: number; missing: string[]; sig: string; tail: boolean; tailSecs: number }

async function soundChecks({ host, check, timed = check, until, sleep, page, shot, win, log = () => {} }: Pick<Smoke, 'host' | 'check' | 'until' | 'sleep' | 'page' | 'shot' | 'win'> & Partial<Pick<Smoke, 'timed' | 'log'>>) {
  const snap = () => host.snapshot() as Snap;
  const av = (js: string) => host.audioWindow()!.webContents.executeJavaScript(js, true);
  const measure = (o: unknown): Promise<Measured> => av(`measure(${JSON.stringify(o)})`);
  const list = host.document.doc.lists[0].id;
  const depth = host.document.undoStack.length;          // every edit made here (by a command or in the window) is undone at the end
  const edit = (ops: Op[], label = 'sound') => host.cmd({ op: 'edit', ops, label });
  const idOf = (number: string) => (show.findByNumber(host.document.doc, number) || {}).id!;
  const mean = (a: number[], from: number, to: number) => { const s = a.slice(Math.round(from * 100), Math.round(to * 100)); return s.reduce((x, y) => x + y, 0) / s.length; };
  // (the run's show may be untitled by now: the sounds made here go in a folder of their own and are named whole)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-sound-'));
  const TONE = path.join(dir, 'sd-tone.wav'), LINE = path.join(dir, 'sd-line.wav'), ROOM = path.join(dir, 'sd-room.wav');
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'mode', mode: 'edit' });
  await until(() => av('fxEnv.worklets'), 4000);
  check('the sound design worklets (gate, compressor, crusher, pitch) load in the audio window', await av('fxEnv.worklets') === true);

  // ── a chain, measured offline: each tool does to a synthesised signal what it says ─────────────────────
  const sine = (hz: number, db = -12) => ({ kind: 'sine', hz, db });
  const lvl = async (o: unknown, from = 0.5, to = 0.95) => mean((await measure(o)).l, from, to) + 3.01;      // a sine's level as its peak, dB
  {
    const plain = await measure({ signal: sine(1000) });
    check('no chain: the sound is the plain wire it was (nothing built, the level untouched)', plain.sig === '' && Math.abs(mean(plain.l, 0.5, 0.95) + 3.01 + 12) < 0.1, [plain.sig, mean(plain.l, 0.5, 0.95)]);
    const hp = { highpass: { hz: 1000, slope: 24 } };
    const lo = await lvl({ chain: hp, signal: sine(100) }), hi = await lvl({ chain: hp, signal: sine(5000) });
    check('high-pass at 1 kHz, 24 dB/oct: 100 Hz is gone (over 60 dB down) and 5 kHz passes', lo < -72 && Math.abs(hi + 12) < 0.5, [lo, hi]);
    const s12 = await lvl({ chain: { highpass: { hz: 1000, slope: 12 } }, signal: sine(250) }), s48 = await lvl({ chain: { highpass: { hz: 1000, slope: 48 } }, signal: sine(250) });
    check('…and its slope is what it says: two octaves under, 24 dB down at 12 dB/oct and 96 at 48', Math.abs(s12 + 12 + 24) < 2 && s48 < -12 - 85, [s12, s48]);
    const lpLo = await lvl({ chain: { lowpass: { hz: 400, slope: 24 } }, signal: sine(100) }), lpHi = await lvl({ chain: { lowpass: { hz: 400, slope: 24 } }, signal: sine(3200) });
    check('low-pass at 400 Hz: 100 Hz passes, 3.2 kHz is three octaves and 72 dB down', Math.abs(lpLo + 12) < 0.5 && Math.abs(lpHi + 12 + 72) < 3, [lpLo, lpHi]);
    const phone = host.snapshot() && require('../../core/audio/chain').PRESETS.Phone;
    const p100 = await lvl({ chain: { highpass: phone.chain.highpass, lowpass: phone.chain.lowpass }, signal: sine(100) }), p1k = await lvl({ chain: { highpass: phone.chain.highpass, lowpass: phone.chain.lowpass }, signal: sine(1000) }), p8k = await lvl({ chain: { highpass: phone.chain.highpass, lowpass: phone.chain.lowpass }, signal: sine(8000) });
    check('the Phone preset’s band: 1 kHz through, 100 Hz and 8 kHz over 25 dB down', Math.abs(p1k + 12) < 1.5 && p100 < -12 - 25 && p8k < -12 - 25, [p100, p1k, p8k]);
    const eqAt = await lvl({ eq: { mid: -12 }, signal: sine(1000) }), eqSide = await lvl({ eq: { mid: -12 }, signal: sine(60) });
    check('the eq: a bell at its usual place, { mid: -12 }, is 12 dB out at 1 kHz and nothing at 60 Hz', Math.abs(eqAt + 24) < 0.3 && Math.abs(eqSide + 12) < 0.5, [eqAt, eqSide]);
    const eqNew = await lvl({ eq: { mid: { db: 6, hz: 3000, q: 4 } }, signal: sine(3000) }), eqNewSide = await lvl({ eq: { mid: { db: 6, hz: 3000, q: 4 } }, signal: sine(1000) });
    check('…and a bell moved to 3 kHz with a Q of 4 lifts 3 kHz by 6 dB and leaves 1 kHz alone', Math.abs(eqNew + 6) < 0.3 && Math.abs(eqNewSide + 12) < 0.5, [eqNew, eqNewSide]);
    const comp = await measure({ chain: { comp: { threshold: -18, ratio: 4, attack: 30, release: 100, makeup: 0 } }, signal: { kind: 'step', hz: 1000, db: -40, to: -6, at: 0.5 } });
    const first = comp.l[50] + 3.01, held = mean(comp.l, 0.8, 0.95) + 3.01, quiet = mean(comp.l, 0.3, 0.45) + 3.01;
    check('the compressor: a tone 12 dB over a 4:1 threshold settles 9 dB down, its first 10 ms let through, and the quiet before it untouched', Math.abs(held + 15) < 0.6 && first > held + 4 && Math.abs(quiet + 40) < 0.3, [quiet, first, held]);
    const gate = await measure({ chain: { gate: { threshold: -40, range: -80, attack: 1, hold: 50, release: 50 } }, signal: { kind: 'step', hz: 500, db: -60, to: -12, at: 0.5 } });
    check('the gate: shut on a tone under its threshold, open on one over it', mean(gate.l, 0.2, 0.45) < -110 && Math.abs(mean(gate.l, 0.7, 0.95) + 15.01) < 0.3, [mean(gate.l, 0.2, 0.45), mean(gate.l, 0.7, 0.95)]);
    const room = await measure({ chain: { reverb: { size: 0.5, decay: 2, predelay: 0, mix: 1 } }, signal: { kind: 'impulse' }, secs: 2.4 });
    const fall = mean(room.l, 0.3, 0.4) - mean(room.l, 1.3, 1.4);
    check('the reverb: an impulse rings on, and falls about 30 dB in each second of a 2 s decay', mean(room.l, 0.3, 0.4) > -90 && fall > 24 && fall < 42 && room.tailSecs > 2 && room.tailSecs < 2.3, [mean(room.l, 0.3, 0.4), fall, room.tailSecs]);
    const dry = await measure({ chain: { reverb: { size: 0.5, decay: 2, predelay: 0, mix: 0 } }, signal: { kind: 'impulse' }, secs: 1 });
    check('…and with its mix at 0 there is no ring at all', mean(dry.l, 0.3, 0.9) < -110, mean(dry.l, 0.3, 0.9));
    const pre = await measure({ chain: { reverb: { size: 0.2, decay: 1, predelay: 200, mix: 1 } }, signal: { kind: 'impulse' }, secs: 1 });
    check('…and its pre-delay holds the room back: silence for 200 ms, then the ring', mean(pre.l, 0.05, 0.18) < -110 && mean(pre.l, 0.22, 0.3) > -80, [mean(pre.l, 0.05, 0.18), mean(pre.l, 0.22, 0.3)]);
    const echo = await measure({ chain: { delay: { time: 0.25, feedback: 0.5, tone: 20000, mix: 1 } }, signal: { kind: 'impulse' }, secs: 1 });
    const e1 = Math.max(...echo.l.slice(24, 27)), e2 = Math.max(...echo.l.slice(49, 52)), gap = mean(echo.l, 0.32, 0.45);
    check('the delay: an impulse comes back every 250 ms, each repeat 6 dB under the last at a feedback of 0.5', e1 > -60 && Math.abs((e1 - e2) - 6) < 1.5 && gap < -110, [e1, e2, gap]);
    const pp = await measure({ chain: { delay: { time: 0.25, feedback: 0.5, tone: 20000, pingpong: true, mix: 1 } }, signal: { kind: 'impulse' }, secs: 1 });
    check('…and ping-pong throws them from side to side: the first on the left, the second on the right', Math.max(...pp.l.slice(24, 27)) > -60 && Math.max(...pp.r.slice(24, 27)) < -110 && Math.max(...pp.r.slice(49, 52)) > -60 && Math.max(...pp.l.slice(49, 52)) < -110, [pp.l.slice(24, 27), pp.r.slice(24, 27), pp.l.slice(49, 52), pp.r.slice(49, 52)]);
    const up = await measure({ chain: { pitch: { semitones: 7, cents: 0 } }, signal: sine(440), secs: 2 });
    const wob = Math.max(...up.l.slice(100, 195)) - Math.min(...up.l.slice(100, 195));
    check('the pitch shifter: 440 Hz up seven semitones comes out at 659 Hz (within 10 cents), at a steady level', Math.abs(1200 * Math.log2(up.hz / 659.26)) < 10 && wob < 1 && !up.missing.length, [up.hz, wob, up.missing]);
    const drive = await measure({ chain: { drive: { db: 24, tone: 20000, out: 0 } }, signal: sine(200, -12) });
    check('drive: a soft clip makes the tone denser (louder on average) without passing full scale', mean(drive.l, 0.5, 0.95) > -15 + 6 && mean(drive.l, 0.5, 0.95) < 0.1, mean(drive.l, 0.5, 0.95));
    const trem = await measure({ chain: { tremolo: { rate: 5, depth: 1 } }, signal: sine(1000) });
    check('tremolo: the level swings (over 12 dB at full depth)', Math.max(...trem.l.slice(20, 95)) - Math.min(...trem.l.slice(20, 95)) > 12, [Math.max(...trem.l.slice(20, 95)), Math.min(...trem.l.slice(20, 95))]);
    const pan = await measure({ chain: { autopan: { rate: 2, depth: 1 } }, signal: sine(1000) });
    const side = pan.l.map((v, i) => v - pan.r[i]).slice(10, 95);
    check('auto-pan: the sound goes from one side to the other', Math.max(...side) > 12 && Math.min(...side) < -12, [Math.max(...side), Math.min(...side)]);
    const mono = await measure({ chain: { stereo: { width: 0 } }, signal: { ...sine(1000), right: false } });
    const wide = await measure({ signal: { ...sine(1000), right: false } });
    check('stereo width 0 is mono: a sound on the left only comes out of both sides alike', Math.abs(mean(mono.l, 0.5, 0.9) - mean(mono.r, 0.5, 0.9)) < 0.1 && mean(wide.r, 0.5, 0.9) < -110, [mean(mono.l, 0.5, 0.9), mean(mono.r, 0.5, 0.9), mean(wide.r, 0.5, 0.9)]);
    const crush = await measure({ chain: { crush: { bits: 3, hz: 4000 } }, signal: sine(300) });
    const chorus = await measure({ chain: { chorus: { rate: 1, depth: 3, delay: 15, feedback: 0.2, mix: 0.5 } }, signal: sine(700) });
    check('the crusher and the chorus are built and pass sound', !crush.missing.length && mean(crush.l, 0.5, 0.9) > -30 && mean(chorus.l, 0.5, 0.9) > -30, [mean(crush.l, 0.5, 0.9), mean(chorus.l, 0.5, 0.9)]);
    const swept = await measure({ chain: { lowpass: { hz: 20000, slope: 24 } }, signal: sine(4000), sweep: { to: { lowpass: { hz: 400 } }, secs: 0.6 } });
    check('a sweep (a Fade’s chainTo): a low-pass closing from 20 kHz to 400 Hz takes a 4 kHz tone from untouched to over 60 dB down', Math.abs(swept.l[2] + 15.01) < 1 && mean(swept.l, 0.8, 0.95) < -15 - 60, [swept.l[2], mean(swept.l, 0.8, 0.95)]);
    const by = await measure({ chain: { highpass: { hz: 5000, slope: 48 }, bypass: true }, eq: { mid: -12 }, signal: sine(1000) });
    check('bypassed, a chain (and the eq) is out of the path', by.sig === '' && Math.abs(mean(by.l, 0.5, 0.95) + 15.01) < 0.1, [by.sig, mean(by.l, 0.5, 0.95)]);
  }

  // ── a playing sound: built only when there is a chain, moved in place, rebuilt when its tools change ─────
  writeMono(TONE, tone(8));
  edit([
    { op: 'cue.add', list, cue: { type: 'audio', number: 'SD1', name: 'plain', file: TONE, gainDb: -20, loop: true } },
    { op: 'cue.add', list, ref: 'b', cue: { type: 'audio', number: 'SD2', name: 'designed', file: TONE, gainDb: -20, loop: true, chain: { lowpass: { hz: 8000, slope: 24 }, reverb: { size: 0.3, decay: 0.6, predelay: 0, mix: 0.3 }, tail: true } } },
    { op: 'cue.add', list, cue: { type: 'fade', number: 'SD3', target: '@b', db: -20, duration: 0.4, chainTo: { lowpass: { hz: 500 } } } },
    { op: 'cue.add', list, cue: { type: 'mic', number: 'SD4', bus: 'vocals', chain: { comp: {}, stereo: { width: 0 } } } },
  ]);
  const sd1 = idOf('SD1'), sd2 = idOf('SD2'), sd4 = idOf('SD4');
  const fxOf = (id: string) => av(`(() => { const v = voices.get(${JSON.stringify(id)}); return v ? (v.fx ? { sig: v.fx.sig, tail: v.fx.tail, stages: v.fx.plan.stages, n: v.fx.n || (v.fx.n = Math.random()), into: v.fx.input.numberOfInputs } : false) : null; })()`);
  host.cmd({ op: 'fire', number: 'SD1' }); host.cmd({ op: 'fire', number: 'SD2' }); host.cmd({ op: 'fire', number: 'SD4' });
  await until(async () => (await fxOf(sd1)) !== null && (await fxOf(sd2)) && (await fxOf(sd4)), 4000);
  const f1 = await fxOf(sd1), f2 = await fxOf(sd2), f4 = await fxOf(sd4);
  check('a playing sound with no chain has nothing built for it; one with a chain has exactly its tools; a Mic cue has its own', f1 === false && f2 && f2.sig === 'lowpass24>reverb(0.3:0.6)' && f2.tail === true && f4 && f4.sig === 'comp>stereo', [f1, f2 && f2.sig, f4 && f4.sig]);
  await until(() => (snap().mixer.buses.find((b) => b.id === 'effects') || { peak: -Infinity }).peak > -50, 3000);
  check('…and the designed sound and the mic are heard on their buses through their chains', (snap().mixer.buses.find((b) => b.id === 'effects') || { peak: -Infinity }).peak > -50 && (snap().mixer.buses.find((b) => b.id === 'vocals') || { peak: -Infinity }).peak > -40, snap().mixer.buses.map((b) => [b.id, b.peak]));
  edit([{ op: 'cue.set', id: sd2, props: { chain: { lowpass: { hz: 2000, slope: 24 }, reverb: { size: 0.3, decay: 0.6, predelay: 0, mix: 0.3 }, tail: true } } }]);
  check('a number changed on a playing sound’s tool glides there in place (the chain is not rebuilt)', await until(async () => { const f = await fxOf(sd2); return f && f.n === f2.n && f.stages[0].hz === 2000; }, 3000), await fxOf(sd2));
  const hzNow = () => av(`(() => { const v = voices.get(${JSON.stringify(sd2)}); let hz = null; if (v && v.fx) { v.fx.input.context; } return v && v.fx ? v.fx.plan.stages[0].hz : null; })()`);
  host.cmd({ op: 'fire', number: 'SD3' });
  check('a Fade cue’s “Sound design to” moves the playing sound’s low-pass over its time', await until(async () => (await hzNow()) === 500, 3000), await hzNow());
  edit([{ op: 'cue.set', id: sd1, props: { chain: { highpass: { hz: 300, slope: 12 } } } }]);
  check('a tool switched on for a sound that was playing plain is put in its path at once', await until(async () => { const f = await fxOf(sd1); return f && f.sig === 'highpass12'; }, 3000) && (snap().mixer.buses.find((b) => b.id === 'effects') || { peak: -Infinity }).peak > -50, await fxOf(sd1));
  edit([{ op: 'cue.set', id: sd1, props: { chain: { highpass: { hz: 300, slope: 12 }, bypass: true } } }]);
  check('…and bypassed (A/B) it is the plain wire again, still sounding', await until(async () => (await fxOf(sd1)) === false, 3000) && await until(() => av(`(() => { const v = voices.get(${JSON.stringify(sd1)}); return !!v && (v.buf ? !!v.srcNode : !v.el.paused); })()`), 2000));
  check('a cue left bypassed is flagged', snap().problems.some((p) => p.id === sd1 && /bypassed/.test(p.why)), snap().problems.filter((p) => p.id === sd1));
  // the tail: stopped, the sound's reverb rings out as a voice of its own and the cue is no longer running
  host.cmd({ op: 'stop', number: 'SD2' });
  const tails = () => av(`[...voices.keys()].filter((k) => k.startsWith('tail:'))`);
  check('“let the tail ring”: a stopped sound is gone from the engine while its reverb rings out…', await until(async () => (await tails()).length === 1 && !snap().engine.active.some((a) => a.id === sd2), 2000), [await tails(), snap().engine.active.map((a) => a.id)]);
  check('…and its voice is let go when the tail has rung (0.7 s)', await until(async () => (await tails()).length === 0, 2500), await tails());
  host.cmd({ op: 'fire', number: 'SD2' });
  await until(async () => !!(await fxOf(sd2)), 3000);
  host.cmd({ op: 'stop', number: 'SD2' });
  await until(async () => (await tails()).length === 1, 1500);
  host.cmd({ op: 'panic', hard: true });
  check('Panic twice ends a ringing tail with everything else', await until(async () => (await av('voices.size')) === 0, 2000), await av('[...voices.keys()]'));

  // a reverb that names an impulse-response file: the host sends its bytes, and the playing sound's convolver takes it
  writeMono(ROOM, tone(1, 0, 0.2, 300, 0.5));
  edit([{ op: 'cue.set', id: sd1, props: { chain: { reverb: { size: 0.5, decay: 1, predelay: 0, mix: 0.3, file: ROOM } } } }]);
  host.cmd({ op: 'fire', number: 'SD1' });
  check('a reverb’s impulse-response file is read and given to the sound that asked for it', await until(() => av(`(() => { const v = voices.get(${JSON.stringify(sd1)}); return irs.has(${JSON.stringify(ROOM)}) && !!v && !!v.fx && /file:/.test(v.fx.sig) && !v.fx.meters.irWanted; })()`), 4000), await av('[...irs.keys()]'));
  host.cmd({ op: 'panic', hard: true });

  // ── the inspector's Sound design tab ────────────────────────────────────────────────────────────────
  const row = (name: string) => page(`(() => { const r = [...document.querySelectorAll('.list tbody tr')].find((x) => /${name}/.test(x.textContent)); if (r) { r.scrollIntoView(); r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); r.click(); } return !!r; })()`);
  const tab = (label: string) => page(`(() => { const b = [...document.querySelectorAll('.inspector .tabs button')].find((x) => x.textContent.startsWith(${JSON.stringify(label)})); if (b) b.click(); return !!b; })()`);
  const typeIn = (sel: string, text: string) => page(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const cueNow = (id: string) => show.index(host.document.doc).byId.get(id)!;
  edit([{ op: 'cue.set', id: sd1, props: { chain: null } }]);
  await row('plain');
  check('an Audio cue’s inspector has a Sound design tab', await until(() => tab('Sound design'), 3000) && await until(() => page(`!!document.querySelector('[data-sound-design] [data-rack]')`), 3000));
  check('…a rack with no devices and one “+ Add effect” when the cue has none', await until(() => page(`document.querySelectorAll('[data-sound-design] [data-device]').length === 0 && /Add effect/.test((document.querySelector('[data-add-effect]') || {}).textContent || '')`), 3000));
  // a click on what the page has drawn: waited for (a slow machine draws late), and named when it never comes
  const click = async (sel: string, ms = 3000) => {
    if (!await until(() => page(`!!document.querySelector(${JSON.stringify(sel)})`), ms)) throw new Error(`nothing to click: ${sel}`);
    await page(`document.querySelector(${JSON.stringify(sel)}).click()`);
  };
  // (a hidden window has no keyboard focus to lose: the box is told it lost it, as the browser would tell it)
  const leave = (sel: string) => page(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new FocusEvent('blur'))`);
  // (a click on "+" that lands while the rack is being drawn again opens nothing: up to three, and said)
  const addTool = async (key: string) => {
    for (let n = 1; n <= 3; n++) {
      await click('[data-add-effect]');
      if (await until(() => page(`!!document.querySelector('[data-add-tool="${key}"]')`), 2000)) { if (n > 1) log(`SMOKE note  the + menu took ${n} clicks to open`); break; }
    }
    await click(`[data-add-tool="${key}"]`);
  };
  await addTool('highpass');
  check('“+” lists the tools; one chosen is added with its settings written out', await until(() => JSON.stringify((cueNow(sd1) || {}).chain) === JSON.stringify({ highpass: { hz: 80, slope: 12 } }), 3000) && await until(() => page(`!!document.querySelector('[data-device="highpass"] [data-knob="highpass.hz"]') && !document.querySelector('[data-add-menu]')`), 2000), cueNow(sd1).chain);
  // a knob dragged up: the frequency rises along a ratio, and lands in the show when the button is let go
  const drag = (sel: string, dy: number) => page(`(() => { const d = document.querySelector(${JSON.stringify(sel)}); const ev = (type, y) => d.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, button: 0, clientX: 10, clientY: y })); ev('pointerdown', 200); ev('pointermove', 200 - ${dy / 2}); ev('pointermove', 200 - ${dy}); ev('pointerup', 200 - ${dy}); return true; })()`);
  await drag('[data-knob="highpass.hz"] svg', 50);
  check('a knob dragged up turns its setting up, and the new value is in the show (one edit)', await until(() => { const h: { hz?: number } = (cueNow(sd1).chain || {}).highpass || {}; return h.hz! > 600 && h.hz! < 1000; }, 3000), cueNow(sd1).chain);
  check('…and its value is shown under it in the units it is in', await until(() => page(`/^\\d+Hz$/.test(document.querySelector('[data-knob-value="highpass.hz"]').textContent.trim())`), 2000), await page(`document.querySelector('[data-knob-value="highpass.hz"]').textContent`));
  // the value double-clicked: a box to type in (a box commits when it loses the keyboard, not only on Enter)
  await page(`document.querySelector('[data-knob-value="highpass.hz"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await until(() => page(`!!document.querySelector('[data-knob-input="highpass.hz"]')`), 2000);
  await typeIn('[data-knob-input="highpass.hz"]', '300');
  await leave('[data-knob-input="highpass.hz"]');
  check('a value typed into a knob’s box is kept', await until(() => ((cueNow(sd1).chain || {}).highpass || {}).hz === 300, 3000), cueNow(sd1).chain);
  const backToDefault = async () => {
    for (let n = 1; n <= 3; n++) {
      await page(`document.querySelector('[data-knob="highpass.hz"] svg').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
      if (await until(() => ((cueNow(sd1).chain || {}).highpass || {}).hz === 80, 1500)) { if (n > 1) log(`SMOKE note  the double-click took ${n} tries`); return true; }
    }
    return false;
  };
  check('a knob double-clicked goes back to its default', await backToDefault(), cueNow(sd1).chain);
  check('a changed setting is marked as not saved yet (its knob and its device)', await until(() => page(`!!document.querySelector('[data-device="highpass"].pending')`), 2000));
  // the slope: a choice on the device
  await click('[data-option="highpass.slope"][data-value="48"]');
  check('a choice on a device is kept (a slope of 48 dB/oct)', await until(() => ((cueNow(sd1).chain || {}).highpass || {}).slope === 48, 3000), cueNow(sd1).chain);
  // a device added is placed where it runs, whatever order it was added in
  // two added at once, faster than the show says the first back: neither undoes the other
  await addTool('reverb'); await addTool('lowpass');
  check('two effects added one straight after the other are both kept', await until(() => { const c = cueNow(sd1).chain || {}; return !!c.reverb && !!c.lowpass && !!c.highpass; }, 3000), cueNow(sd1).chain);
  await addTool('eq');
  await until(() => page(`!!document.querySelector('[data-device="eq"]')`), 2000);
  const order = await page(`[...document.querySelectorAll('[data-sound-design] [data-device]')].map((x) => x.dataset.device)`);
  check('devices sit in the order they run, not the order they were added', JSON.stringify(order) === JSON.stringify(['highpass', 'lowpass', 'eq', 'reverb']), order);
  check('“+” offers a tool already in the chain no second time', await (async () => { await click('[data-add-effect]'); await until(() => page(`!!document.querySelector('[data-add-menu]')`), 2000); const r = await page(`document.querySelector('[data-add-tool="reverb"]').disabled && !document.querySelector('[data-add-tool="delay"]').disabled`); await click('[data-add-effect]'); return r && await until(() => page(`!document.querySelector('[data-add-menu]')`), 2000); })());
  // the power button: off keeps the settings, on again takes them back
  await click('[data-power="reverb"]');
  check('a device switched off keeps its settings in the cue (“on”: false)', await until(() => ((cueNow(sd1).chain || {}).reverb || {}).on === false && cueNow(sd1).chain!.reverb!.mix === 0.25, 3000) && await until(() => page(`!!document.querySelector('[data-device="reverb"].off')`), 2000), cueNow(sd1).chain);
  await click('[data-power="reverb"]');
  check('…and on again', await until(() => (cueNow(sd1).chain || {}).reverb && cueNow(sd1).chain!.reverb!.on === undefined, 3000), cueNow(sd1).chain);
  // an eq band: chosen on the eq device, its gain and frequency typed
  await click('[data-band="mid"]');
  await until(() => page(`!!document.querySelector('[data-knob-value="eq.mid.db"]')`), 2000);
  // (a knob typed into by synthetic events: on a slow CI machine the first try has been lost; up to three, and said)
  const typeKnob = async (knob: string, text: string, landed: () => unknown) => {
    for (let n = 1; n <= 3; n++) {
      await page(`document.querySelector('[data-knob-value="${knob}"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
      if (!await until(() => page(`!!document.querySelector('[data-knob-input="${knob}"]')`), 2000)) continue;
      await typeIn(`[data-knob-input="${knob}"]`, text); await leave(`[data-knob-input="${knob}"]`);
      if (await until(landed, 1500)) { if (n > 1) log(`SMOKE note  ${knob} took ${n} tries to type into`); return; }
    }
  };
  await typeKnob('eq.mid.db', '-6', () => (cueNow(sd1).eq || {}).mid === -6);
  await typeKnob('eq.mid.hz', '1.8k', () => (((cueNow(sd1).eq || {}).mid || {}) as { hz?: number }).hz === 1800);
  check('an eq band is a level at its usual place, and { db, hz, q } once it is moved', await until(() => JSON.stringify(cueNow(sd1).eq) === JSON.stringify({ mid: { db: -6, hz: 1800, q: 0.8 } }), 3000), cueNow(sd1).eq);
  // the rack at 1024 wide: it scrolls inside the tab, the window never does
  const was = win.getContentSize();
  win.setContentSize(1024, 700);
  await until(() => page('window.innerWidth === 1024'), 3000);
  await sleep(200);
  const fit = await page<{ page: boolean; inside: boolean }>(`(() => { const r = document.querySelector('[data-rack]'); return { page: document.documentElement.scrollWidth <= window.innerWidth, inside: r.getBoundingClientRect().right <= window.innerWidth + 1 }; })()`);
  check('at 1024 wide the rack stays inside the window (it scrolls sideways within the tab)', fit.page && fit.inside, fit);
  await shot('sound-design-1024');
  win.setContentSize(1600, 900);
  await until(() => page('window.innerWidth === 1600'), 3000);
  await shot('sound-design-1600');
  win.setContentSize(was[0], was[1]);
  await sleep(200);
  // remove: the device and its settings leave the cue
  await click('[data-remove="lowpass"]');
  check('a device removed (×) is gone from the cue', await until(() => !(cueNow(sd1).chain || {}).lowpass && !!cueNow(sd1).chain!.highpass, 3000) && await until(() => page(`!document.querySelector('[data-device="lowpass"]')`), 2000), cueNow(sd1).chain);
  await shot('sound-design-rack');
  // a preset: applied from the menu, then this cue's chain saved under a name in the show
  const presets = async () => { await click('[data-presets]'); await until(() => page(`!!document.querySelector('[data-preset-menu]')`), 2000); };
  await presets();
  await click('[data-preset="b:Phone"]');
  check('a built-in preset (Phone) puts its chain on the cue', await until(() => ((cueNow(sd1).chain || {}).lowpass || {}).hz === 3200 && cueNow(sd1).chain!.stereo!.width === 0 && cueNow(sd1).eq === undefined, 3000), cueNow(sd1).chain);
  await presets();
  await typeIn('[data-preset-name]', 'Tannoy');
  await click('[data-preset-save]');
  check('a cue’s chain is saved in the show as a preset of its own, and offered', await until(() => !!((host.document.doc.settings.audio.chains || {}).Tannoy || {}).chain, 3000) && await until(() => page(`!!document.querySelector('[data-preset="s:Tannoy"]')`), 3000), host.document.doc.settings.audio.chains);
  await click('[data-presets]');
  await click('[data-bypass]');
  check('Bypass (A/B) is a button on the tab, and the tab says so', await until(() => cueNow(sd1).chain!.bypass === true, 3000) && await until(() => page(`[...document.querySelectorAll('.inspector .tabs button')].some((b) => /Sound design \\(bypassed\\)/.test(b.textContent))`), 3000));
  await shot('sound-design');
  // a mic on the voice bus with no chain is offered the Voice chain, and nothing is applied until it is taken
  edit([{ op: 'cue.set', id: sd4, props: { chain: null } }]);
  await row('Mic');
  await tab('Sound design');
  check('a sound on a voice bus is offered the Voice chain, not given it', await until(() => page(`!!document.querySelector('[data-offer] button')`), 3000) && cueNow(sd4).chain === undefined);
  await click('[data-offer] button');
  check('…and taking the offer writes it on the cue: a high-pass at 80 Hz and a light compressor', await until(() => { const c = cueNow(sd4).chain || {}; return c.highpass && c.highpass.hz === 80 && c.comp && c.comp.ratio === 2.5; }, 3000), cueNow(sd4).chain);
  // the Fade's sweep editor
  await row('fade designed');
  // (the tab is there once the inspector has drawn the Fade cue: wait for it)
  await until(() => tab('Fade'), 3000);
  await page(`(() => { const m = [...document.querySelectorAll('.inspector button.more')][0]; if (m && /▸/.test(m.textContent)) m.click(); })()`);
  check('a Fade cue shows what of its target’s sound design it moves', await until(() => page(`!!document.querySelector('[data-sweep] [data-sweep-to="lowpass.hz"]')`), 3000), await page(`[document.querySelector('.inspector .tabs') && document.querySelector('.inspector .tabs').textContent, document.querySelector('.inspector .insp-body') && document.querySelector('.inspector .insp-body').textContent.slice(0, 300), window.innerWidth, window.innerHeight]`));

  // ── the kinds of sound ───────────────────────────────────────────────────────────────────────────────
  host.cmd({ op: 'panic', hard: true });
  const audio = () => host.document.doc.settings.audio;
  const wasDucking = JSON.stringify(audio().ducking || null);
  // (whatever show the run has, give it ducking by kind for these checks: music under the voice bus, a slow attack so the lead can be seen)
  edit([{ op: 'show.set', path: 'settings.audio.buses', value: audio().buses.map((b) => (b.id === 'music' ? { ...b, kind: 'music' } : b.id === 'vocals' ? { ...b, kind: 'voice' } : b.id === 'effects' ? { ...b, kind: 'effects' } : b)) },
        { op: 'show.set', path: 'settings.audio.ducking', value: { on: true, threshold: -35, by: ['voice', 'live'], under: { music: { depth: -10, attack: 0.3, hold: 0.5, release: 0.4, range: 'all' } } } }]);
  check('each bus has a kind, and the mixer knows them', await until(() => snap().mixer.kinds.music === 'music' && snap().mixer.kinds.vocals === 'voice' && snap().mixer.duckOn === true, 3000), snap().mixer.kinds);
  // a recorded voice: silence, a line from 1.5 s to 2.5 s, silence to 5 s
  writeMono(LINE, tone(5, 1.5, 2.5, 300, 0.5));
  edit([{ op: 'cue.add', list, cue: { type: 'audio', number: 'SK1', name: 'the line', file: LINE, bus: 'vocals', transcript: 'It was the best of times.' } },
        { op: 'cue.add', list, cue: { type: 'audio', number: 'SK2', name: 'the music', file: TONE, bus: 'music', gainDb: -20, loop: true } }]);
  const sk1 = idOf('SK1'), sk2 = idOf('SK2');
  await until(() => snap().engine.durations[LINE] > 4, 4000);
  await sleep(300);
  host.cmd({ op: 'fire', number: 'SK2' }); host.cmd({ op: 'fire', number: 'SK1' });
  const lineAt = () => av(`(() => { const v = voices.get(${JSON.stringify(sk1)}); return v ? { at: placeOf(v), speech: v.speech || null } : null; })()`);
  await until(async () => !!(await lineAt()), 3000);
  check('a recorded voice on a voice bus is played with where its speech is (read from its waveform)', JSON.stringify((await lineAt()).speech) === JSON.stringify([[1.5, 2.5]]), await lineAt());
  let downAt: number | null = null, upAt: number | null = null;
  await until(async () => { const l = await lineAt(); if (!l) return true; if (downAt === null && snap().mixer.ducked.includes('music')) downAt = l.at; return downAt !== null; }, 5000);
  await timed('look-ahead ducking: the music starts down before the voice speaks (an attack time ahead), not after', downAt !== null && downAt >= 1.0 && downAt < 1.5, downAt);
  await until(async () => { const l = await lineAt(); if (!l) return true; if (l.at > 2.2 && !snap().mixer.ducked.includes('music')) upAt = l.at; return upAt !== null; }, 5000);
  await timed('…and is let go as the last word ends, without waiting out the hold', upAt !== null && upAt >= 2.5 && upAt < 2.5 + 0.45, upAt);
  check('a voice-over’s transcript is in the masthead while it plays', await until(() => page<string>(`(document.querySelector('[data-transcript]') || {}).textContent || ''`).then((t) => /best of times/.test(t)), 3000));
  host.cmd({ op: 'panic', hard: true });
  // a bus that fades its stops, set by choosing its kind in Settings ▸ Audio
  edit([{ op: 'show.set', path: 'settings.audio.buses', value: audio().buses.map((b) => (b.id === 'music' ? { ...b, kind: 'music', stopFade: 0.8 } : b)) }]);
  host.cmd({ op: 'fire', number: 'SK2' });
  await until(() => snap().engine.active.some((a) => a.id === sk2), 3000);
  await sleep(200);
  host.cmd({ op: 'stop', number: 'SK2' });
  await sleep(250);
  const still = snap().engine.active.some((a) => a.id === sk2);
  check('a stop on a bus that fades its stops is a fade out, then a stop', still && await until(() => !snap().engine.active.some((a) => a.id === sk2), 2500), still);

  // ── sounds added with no bus: each is listened to, put by what it sounds like, and shown to be confirmed ──
  const drop = dir;
  writeMono(path.join(drop, 'narration.wav'), sig.speech(12), sig.RATE);
  writeMono(path.join(drop, 'groove.wav'), sig.music(20), sig.RATE);
  writeMono(path.join(drop, 'slam.wav'), sig.hit(), sig.RATE);
  // by default nothing is listened to and no chooser appears: a sound is simply added
  const plainAdd = await host.cmd({ op: 'import', paths: [path.join(drop, 'slam.wav')] });
  check('by default a sound is just added: not listened to, no chooser, no analysis', !!plainAdd && !plainAdd.error && !snap().added && audio().sortNew !== true && await av('true') && !host.cmd({ op: 'tempo-of', file: path.join(drop, 'slam.wav') }).known, [plainAdd, snap().added]);
  edit([{ op: 'show.set', path: 'settings.audio.sortNew', value: true }]);
  const before = snap().rows.length;
  const r = await host.cmd({ op: 'import', paths: ['narration.wav', 'groove.wav', 'slam.wav'].map((f) => path.join(drop, f)) });
  const added = (snap().added || {}).items || [];
  check('with “Sort new sounds by kind” on, three sounds added at once are each put by what they sound like: speech on the voice bus, a pulse on music, a hit on effects',
    added.length === 3 && added[0].kind === 'voice' && added[0].bus === 'vocals' && added[1].kind === 'music' && added[1].bus === 'music' && added[2].kind === 'effects' && added[2].bus === 'effects' && snap().rows.length === before + 3, [r, added]);
  check('…and the guesses are shown, each with its reason and a bus to change', await until(() => page(`document.querySelectorAll('[data-added] [data-added-row]').length === 3 && /sounds like/.test(document.querySelector('[data-added]').textContent)`), 3000));
  await shot('sounds-added');
  await page(`(() => { const s = document.querySelector('[data-added-bus="slam.wav"]'); s.value = 'music'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check('a wrong guess is put right in the chooser', await until(() => (show.index(host.document.doc).byId.get(added[2].id) || {}).bus === 'music', 3000));
  await click('[data-added-done]');
  check('Done puts the chooser away', await until(() => !snap().added, 3000) && await until(() => page(`!document.querySelector('[data-added]')`), 3000));

  host.cmd({ op: 'panic', hard: true });
  // Settings ▸ Audio: a bus's kind is chosen there, and brings what the kind is offered
  win.webContents.send('ec-menu', 'settings');
  await page(`(async () => { for (let i = 0; i < 40 && !document.querySelector('.modal'); i++) await new Promise((r) => setTimeout(r, 50)); const b = [...document.querySelectorAll('.modal nav button')].find((x) => x.textContent === 'Audio'); if (b) b.click(); })()`);
  check('Settings ▸ Audio shows what each bus carries, and ducking by kind', await until(() => page(`!!document.querySelector('.modal [data-bus-kinds] [data-kind="effects"]') && !!document.querySelector('.modal [data-ducking] [data-duck-under="music"]')`), 3000));
  await page(`(() => { const s = document.querySelector('.modal [data-kind="effects"]'); s.value = 'ambience'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check('a bus given the kind Ambience is only named so: nothing about how it plays is switched on', await until(() => audio().buses.find((x) => x.id === 'effects')!.kind === 'ambience', 3000) && audio().buses.find((x) => x.id === 'effects')!.oneAtATime === undefined && audio().buses.find((x) => x.id === 'effects')!.stopFade === undefined, audio().buses);
  await until(() => page(`!document.querySelector('.modal [data-suggest="effects"]').disabled`), 3000);
  await click('.modal [data-suggest="effects"]');
  check('…until “Use suggested” is pressed: one at a time (3 s) and a fading stop (2 s), written on the bus', await until(() => { const b = audio().buses.find((x) => x.id === 'effects')!; return b.oneAtATime === 3 && b.stopFade === 2; }, 3000), audio().buses);
  await page(`(() => { const i = document.querySelector('.modal [data-oneatatime="effects"]'); i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '5'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new FocusEvent('blur')); })()`);
  check('…and the time is the designer’s to change (typed and left, it is kept)', await until(() => audio().buses.find((x) => x.id === 'effects')!.oneAtATime === 5, 3000), audio().buses);
  await page(`document.querySelector('.modal [data-ducking]').scrollIntoView({ block: 'end' })`);
  await shot('sound-kinds-settings');
  await click('.modal .close');

  host.cmd({ op: 'panic', hard: true });
  while (host.document.undoStack.length > depth) host.cmd({ op: 'undo' });
  await sleep(200);
  check('the sound checks leave the show’s ducking as they found it', JSON.stringify(host.document.doc.settings.audio.ducking || null) === wasDucking, [host.snapshot().show.undoLabel]);
}

export { soundChecks };
