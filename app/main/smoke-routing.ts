/**
 * The smoke run's checks of where sound goes (called from smoke.ts): a cue's own outputs, a file of four
 * channels, audition to a pair of its own, the outputs' trims, the reverb and the delay, a cue's eq.
 *
 * The test run's device is pretended (eight outputs, no device open), so all of this is read from meters: one per
 * output, before the pair's master (`routing.outCh` in the host's snapshot). None of it has been heard.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Smoke, Snap } from './smoke';
import type { Op } from '../../core/show/ops';

const RATE = 44100;
/** A WAV of steady tones: one channel per entry of `amps` (0: that channel is silent), 16-bit. */
function writeTones(file: string, amps: number[], secs = 6) {
  const n = Math.round(RATE * secs), ch = amps.length, buf = Buffer.alloc(44 + n * ch * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * ch * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * ch * 2, 28); buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * ch * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * (330 + 110 * c) * i / RATE) * amps[c] * 32767), 44 + (i * ch + c) * 2);
  fs.writeFileSync(file, buf);
}

async function routingChecks({ host, check, until, sleep, page, win, shot }: Pick<Smoke, 'host' | 'check' | 'until' | 'sleep' | 'page' | 'win' | 'shot'>) {
  const snap = () => host.snapshot() as Snap;
  const ch = () => snap().routing.outCh;
  const at = (o: number) => { const v = ch()[o - 1]; return v === undefined ? -60 : v; };          // output o's level, dB
  const quiet = (...outs: number[]) => outs.every((o) => at(o) <= -58);
  const near = (o: number, db: number, tol = 2.5) => Math.abs(at(o) - db) <= tol;
  const audio = (js: string) => host.audioWindow()!.webContents.executeJavaScript(js, true);
  const edit = (ops: Op[], label = 'routing') => host.cmd({ op: 'edit', ops, label });
  const list = host.document.doc.lists[0].id;
  const set = (pathTo: string, value: unknown) => edit([{ op: 'show.set', path: pathTo, value }]);
  if (!host.document.showDir) { check('the routing checks have a show folder to put their tones in', false); return; }
  host.cmd({ op: 'panic', hard: true });

  // two tones: a stereo one at −6 dBFS, and four channels of which only the first (−6) and the third (−18) sound
  writeTones(path.join(host.document.showDir, 'media', 'tone2.wav'), [0.5, 0.5]);
  writeTones(path.join(host.document.showDir, 'media', 'tone4.wav'), [0.5, 0, 0.125, 0]);
  const made = edit([
    { op: 'cue.add', list, cue: { type: 'audio', number: 'R1', name: 'to 5 and 6', file: 'media/tone2.wav', bus: 'effects', outputs: [{ 5: 0 }, { 6: -12 }] } },
    { op: 'cue.add', list, cue: { type: 'audio', number: 'R2', name: 'both on 7', file: 'media/tone2.wav', bus: 'effects', outputs: [{ 7: -6 }, { 7: -6 }] } },
    { op: 'cue.add', list, cue: { type: 'audio', number: 'R3', name: 'to an output that is not there', file: 'media/tone2.wav', bus: 'effects', outputs: [{ 11: 0 }, { 12: 0 }] } },
    { op: 'cue.add', list, cue: { type: 'audio', number: 'R4', name: 'four channels, the third to 3', file: 'media/tone4.wav', bus: 'effects', outputs: [{}, {}, { 3: 0 }] } },
    { op: 'cue.add', list, cue: { type: 'audio', number: 'R5', name: 'plain, on its bus', file: 'media/tone2.wav', bus: 'effects', eq: { low: -40 } } },
    { op: 'cue.add', list, cue: { type: 'mic', number: 'R6', name: 'a mic to 8', bus: 'vocals', outputs: [{ 8: 0 }] } },
  ]);
  check('cues with outputs of their own are made', made.changed === true, made);
  await until(() => snap().engine.durations['media/tone4.wav'] > 0, 4000);
  check('a file’s channels are counted', snap().routing.channels['media/tone4.wav'] === 4, snap().routing);

  // a cue's own outputs: there, at the level of each crosspoint, and nowhere else; its bus's meter hears it
  host.cmd({ op: 'start', number: 'R1' });
  check('a cue sent to outputs 5 and 6 plays there, each at its own level, and not on 1–2', await until(() => near(5, -6) && near(6, -18) && quiet(1, 2, 3, 4, 7, 8), 4000), ch());
  check('…and its bus’s meter hears it', await until(() => (snap().mixer.buses.find((b) => b.id === 'effects') || { peak: -Infinity }).peak > -30, 2000), snap().mixer.buses);
  host.cmd({ op: 'bus', name: 'effects', db: -20 });
  check('…and its bus’s fader still moves it', await until(() => near(5, -26) && near(6, -38), 3000), ch());
  host.cmd({ op: 'bus', name: 'effects', db: 0 });
  await until(() => near(5, -6), 3000);
  // the ducker: a whole-mix duck of the bus dips it; a voice-band duck is repeated on it as a filter
  await audio(`setDuck({ bus: 'effects', db: -12, secs: 0.05, range: 'all' })`);
  check('…and a duck of its bus dips it', await until(() => near(5, -18), 3000), ch());
  await audio(`setDuck({ bus: 'effects', db: 0, secs: 0.05, range: 'all' })`);
  host.cmd({ op: 'stop', number: 'R1' });
  check('stopped, its outputs are quiet', await until(() => quiet(5, 6), 3000), ch());

  // one output, not a pair
  host.cmd({ op: 'start', number: 'R2' });
  check('both channels of a sound can go to one output alone', await until(() => at(7) > -12 && quiet(8) && quiet(1, 2), 4000), ch());
  host.cmd({ op: 'stop', number: 'R2' });

  // outputs the device lacks: silent, and said on the cue; never moved to 1–2
  host.cmd({ op: 'start', number: 'R3' });
  await sleep(600);
  const r3 = snap().rows.find((r) => r.number === 'R3')!;
  check('a cue sent to outputs the device does not have is silent everywhere, and says so', quiet(1, 2, 3, 4, 5, 6, 7, 8) && snap().engine.active.some((a) => a.id === r3.id) && snap().problems.some((p) => p.id === r3.id && /output/.test(p.why)), [ch(), snap().problems]);
  host.cmd({ op: 'stop', number: 'R3' });

  // a file of four channels: each channel is there to be routed (on a bus it would be folded to stereo)
  host.cmd({ op: 'start', number: 'R4' });
  check('the third channel of a four-channel file plays on the output it is sent to, and the first (not sent) nowhere', await until(() => near(3, -18) && quiet(1, 2, 4), 4000), ch());
  host.cmd({ op: 'stop', number: 'R4' });

  // a mic with an output of its own (the test run's stand-in signal)
  host.cmd({ op: 'start', number: 'R6' });
  check('a Mic cue can be sent to an output of its own', await until(() => at(8) > -30 && quiet(7) && quiet(1, 2), 4000), ch());
  host.cmd({ op: 'stop', number: 'R6' });

  // a cue's eq is in its path, and only its
  host.cmd({ op: 'start', number: 'R5' });
  const r5 = snap().rows.find((r) => r.number === 'R5')!.id;
  check('a cue’s eq is on that sound', await until(() => audio(`(() => { const v = voices.get(${JSON.stringify(r5)}); return !!v && !!v.fx && /^eq\\(/.test(v.fx.sig) && v.fx.plan.stages[0].bands[0].db === -40; })()`), 3000));
  check('…which plays on its bus’s pair as before', await until(() => at(1) > -30 && quiet(3, 4, 5, 6, 7, 8), 3000), ch());
  host.cmd({ op: 'stop', number: 'R5' });

  // audition (V) to a pair of its own: the cue alone, past its bus, and not in the house; a GO of it is in the house
  set('settings.audio.auditionOut', 7);
  host.cmd({ op: 'fire', number: 'R5' });
  check('V plays the cue on the audition pair, and not on 1–2', await until(() => at(7) > -30 && at(8) > -30 && quiet(1, 2), 4000), ch());
  host.cmd({ op: 'stop', number: 'R5' });
  await until(() => quiet(7, 8), 3000);
  host.cmd({ op: 'start', number: 'R5' });
  check('…and started any other way it is in the house', await until(() => at(1) > -30 && quiet(7, 8), 4000), ch());
  host.cmd({ op: 'stop', number: 'R5' });
  set('settings.audio.auditionOut', 11);
  check('an audition pair the device does not have is said', await until(() => snap().routing.lost.some((w) => /Audition/.test(w)), 2000), snap().routing.lost);
  set('settings.audio.auditionOut', undefined);

  // an output's trim: a gain on that output alone, after the limiter
  set('settings.audio.outs', { 3: { name: 'Click', trim: -6 } });
  check('an output’s trim is a gain on that output', await until(() => audio(`laid.has(2) && Math.abs(laid.get(2).gain.gain.value - 0.501) < 0.01 && !laid.has(0)`), 3000), await audio(`[...laid.keys()]`));
  set('settings.audio.outs', undefined);
  check('…and with no trim nothing is in its way', await until(() => audio(`laid.size === 0`), 3000));

  // the effects: a bus's send to the reverb comes back on the reverb's pair, the delay's on the delay's
  const fxAt = host.document.doc.settings.audio.buses.findIndex((b) => b.id === 'effects');
  edit([{ op: 'show.set', path: 'settings.audio.fx', value: { reverb: { secs: 1, db: 0, out: 5 }, delay: { secs: 0.2, feedback: 0.3, db: 0, out: 7 } } },
        { op: 'show.set', path: `settings.audio.buses.${fxAt}.reverb`, value: 0 }]);
  host.cmd({ op: 'start', number: 'R5' });
  check('a bus’s reverb send comes back on the reverb’s pair, with the sound itself still on the bus’s', await until(() => (at(5) > -40 || at(6) > -40) && at(1) > -30 && quiet(7, 8), 5000), ch());      // (either side: a room made of noise may have a hole at the tone's pitch on one)
  edit([{ op: 'show.set', path: `settings.audio.buses.${fxAt}.reverb`, value: undefined }, { op: 'show.set', path: `settings.audio.buses.${fxAt}.delay`, value: 0 }]);
  check('…and its delay send on the delay’s, the reverb gone quiet', await until(() => at(7) > -40 && quiet(5, 6), 6000), ch());
  edit([{ op: 'show.set', path: `settings.audio.buses.${fxAt}.delay`, value: undefined }]);
  check('with no send the bus has nothing added to it', await until(() => audio(`Object.keys(buses.effects.sends).length === 0`), 3000));
  host.cmd({ op: 'panic', hard: true });

  // the window: the inspector's matrix, and Settings ▸ Audio's outputs
  if (page && win) {
    const r1 = snap().rows.find((r) => r.number === 'R1')!.id;
    host.cmd({ op: 'playhead', id: r1 });
    await page(`(() => { const row = [...document.querySelectorAll('.list tbody tr')].find((r) => /to 5 and 6/.test(r.textContent)); if (row) row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })), row.click(); })()`);
    await page(`(() => { const t = [...document.querySelectorAll('.inspector .tabs button')].find((b) => b.textContent === 'Audio'); if (t) t.click(); })()`);
    await sleep(150);
    await page(`(() => { const m = document.querySelector('.inspector button.more'); if (m && /▸/.test(m.textContent)) m.click(); })()`);
    check('the inspector shows a cue’s outputs as a matrix: a row per channel, a column per output', await until(() => page(`(() => { const m = document.querySelector('.matrix'); return !!m && m.querySelectorAll('tbody tr').length === 2 && m.querySelectorAll('tbody tr:first-child td input').length === 8 && m.querySelector('[data-cell="1:5"]').value === '0' && m.querySelector('[data-cell="2:6"]').value === '-12'; })()`), 3000), await page(`(document.querySelector('.matrix') || {}).outerHTML || [...document.querySelectorAll('.inspector .tabs button')].map((b) => b.textContent).join()`));
    await page(`document.querySelector('.matrix').scrollIntoView({ block: 'end' })`);
    if (shot) await shot('9-routing-inspector');
    // a level typed into the grid is the cue's (with no sign it is a cut, as everywhere), and "On its bus" takes the routing away
    await page(`(() => { const i = document.querySelector('.matrix [data-cell="1:3"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '6'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await page(`document.querySelector('.matrix [data-cell="1:3"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    const cueR1 = () => host.document.doc.lists[0].cues.find((c) => c.number === 'R1')!;
    check('a level typed into the matrix is written to the cue', await until(() => JSON.stringify(cueR1().outputs) === '[{"3":-6,"5":0},{"6":-12}]', 3000), cueR1().outputs);
    await page(`[...document.querySelectorAll('.matrix-wrap button')].find((b) => b.textContent === 'On its bus').click()`);
    check('…and “On its bus” takes its outputs away', await until(() => cueR1().outputs === undefined, 3000), cueR1().outputs);
    host.cmd({ op: 'undo' }); host.cmd({ op: 'undo' });
    win.webContents.send('ec-menu', 'settings');
    await page(`(async () => { for (let i = 0; i < 40 && !document.querySelector('.modal'); i++) await new Promise((r) => setTimeout(r, 50)); const b = [...document.querySelectorAll('.modal nav button')].find((x) => x.textContent === 'Audio'); if (b) b.click(); })()`);
    check('Settings ▸ Audio lists the device’s outputs, to name and trim', await until(() => page(`document.querySelectorAll('.modal [data-output]').length === 8 && !!document.querySelector('.modal [data-audition]') && !!document.querySelector('.modal [data-fx="reverb"]')`), 3000));
    await page(`document.querySelector('.modal [data-fx="reverb"]').scrollIntoView({ block: 'end' })`);
    if (shot) await shot('9-routing-settings');
    await page(`document.querySelector('.modal [data-fx="delay"]').scrollIntoView({ block: 'end' })`);
    if (shot) await shot('9-routing-settings-fx');
    await page(`document.querySelector('.modal .close').click()`);
  }
  // back as it was (each edit above is one undo step)
  for (let i = 0; i < 12; i++) host.cmd({ op: 'undo' });
}

export { routingChecks, writeTones };
