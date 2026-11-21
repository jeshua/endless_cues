/**
 * The smoke run's checks of what one sound can do (smoke.ts calls this): fade shapes, rate, the level envelope,
 * the level limits, putting a fade back, the monitor feed, the output device going away, every file format, and
 * the waveform a sound is edited on.
 *
 * A test run plays to no device, so nothing here is listened to: levels are read from the audio window's own
 * gains and meters, and positions from its voices. The show is left as it was found (every edit is undone).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as show from '../../core/show/show';
import type { Smoke, Snap } from './smoke';
import type { Op } from '../../core/show/ops';

async function audioDepth({ host, win, check, timed = check, until, page, sleep, log = () => {}, shot = async () => {} }: Pick<Smoke, 'host' | 'win' | 'check' | 'until' | 'page' | 'sleep'> & Partial<Pick<Smoke, 'timed' | 'log' | 'shot'>>) {
  const snap = () => host.snapshot() as Snap;
  const av = (js: string) => host.audioWindow()!.webContents.executeJavaScript(js, true);
  const list = host.document.doc.lists[0].id;
  let edits = 0;
  const edit = (ops: Op[], label: string) => { const r = host.cmd({ op: 'edit', ops, label }); if (r && !r.error) edits++; return r; };
  const idOf = (number: string) => (show.findByNumber(host.document.doc, number) || {}).id!;
  const active = (id: string) => snap().engine.active.find((a) => a.id === id && a.kind === 'audio');
  const { tone, fixture } = (require('./test-media') as typeof import('./test-media'));
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'mode', mode: 'edit' });

  // ── every format: measured, drawn, played, skipped in, and looped ───────────────────────────────────────
  const formats = ['wav', 'aiff', 'mp3', 'm4a', 'flac', 'ogg', 'opus', 'caf'].filter((x) => fixture(path.join('formats', `tone.${x}`)));
  if (!formats.length) log('SMOKE skip  every file format: no test sounds here (a packaged build; EC_FIXTURES names them)');
  edit(formats.map((x) => ({ op: 'cue.add', cue: { type: 'audio', number: `FMT-${x}`, file: tone(x), gainDb: -20 }, list })), 'formats');
  const results: Record<string, { duration: number; waveform?: unknown; seek?: unknown; loop?: unknown }> = {};
  await until(() => formats.every((x) => snap().engine.durations[tone(x)] > 0 || snap().problems.some((p) => p.id === idOf(`FMT-${x}`))), 8000);
  for (const x of formats) results[x] = { duration: Math.round((snap().engine.durations[tone(x)] || 0) * 100) / 100 };
  await until(() => formats.every((x) => !host.cmd({ op: 'peaks', file: tone(x), detail: true }).pending), 8000);
  for (const x of formats) { const p = host.cmd({ op: 'peaks', file: tone(x), detail: true }).peaks; results[x].waveform = !!p && p.length === 8000 && Math.max(...p.slice(4000)) > 0.03 && Math.max(...p.slice(0, 400)) < 0.02 ? true : p ? [p.length, Math.max(...p.slice(4000)), Math.max(...p.slice(0, 400))] : 'none'; }
  for (const x of formats) host.cmd({ op: 'fire', number: `FMT-${x}` });
  await sleep(500);
  for (const x of formats) host.cmd({ op: 'seek', id: idOf(`FMT-${x}`), t: 1 });
  await sleep(400);
  const places = await av(`Object.fromEntries([...voices].map(([k, v]) => [k, placeOf(v)]))`);
  for (const x of formats) { const at = places[idOf(`FMT-${x}`)]; results[x].seek = at > 1.1 && at < 1.9 ? true : at == null ? 'not playing' : Math.round(at * 100) / 100; }
  for (const x of formats) host.cmd({ op: 'loop', id: idOf(`FMT-${x}`), region: { start: 2.2, end: 2.7 }, free: true });
  await until(() => formats.every((x) => { const a = active(idOf(`FMT-${x}`)); return !a || a.exact; }), 6000);
  await sleep(2300);            // long enough to have left the region (and the file) had it not gone round: it is still inside it
  const round = await av(`Object.fromEntries([...voices].map(([k, v]) => [k, v.buf && v.region ? posOf(v) : null]))`);
  for (const x of formats) { const at = round[idOf(`FMT-${x}`)]; results[x].loop = at != null && at >= 2.19 && at <= 2.71 ? true : at == null ? 'no' : Math.round(at * 100) / 100; }
  host.cmd({ op: 'panic', hard: true });
  for (const x of formats) {
    const r = results[x];
    await timed(`${x.toUpperCase()}: measured (${r.duration} s), drawn, skipped in, and looped`, r.duration > 2.9 && r.duration < 3.2 && r.waveform === true && r.seek === true && r.loop === true, r);
  }

  check('the sounds just stopped are no longer held decoded, and the audio window can ask for its memory back', await until(() => av(`[...decoded.keys()].every((u) => !/tone\\.|endless-cues-audio/.test(u)) && typeof gc === 'function'`), 3000), await av(`[[...decoded.keys()], typeof gc]`));

  // ── a fade's shape: a custom curve that holds still for its first half is still where it began at a third ──
  edit([{ op: 'cue.add', ref: 'a', cue: { type: 'audio', number: 'AD1', file: tone('wav'), gainDb: -30, loop: true }, list },
        { op: 'cue.add', cue: { type: 'fade', number: 'AD2', target: '@a', db: 0, duration: 1.2, shapeUp: [[0.5, 0]] }, list },
        { op: 'cue.add', cue: { type: 'fade', number: 'AD3', target: '@a', db: -40, duration: 6, rate: 2 }, list }], 'shapes');
  const ad1 = idOf('AD1');
  const gainDb = () => av(`(() => { const v = voices.get(${JSON.stringify(ad1)}); return v ? 20 * Math.log10(Math.max(1e-4, v.gain.gain.value)) : null; })()`);
  host.cmd({ op: 'fire', number: 'AD1' });
  await until(async () => (await gainDb()) != null, 3000);
  host.cmd({ op: 'fire', number: 'AD2' });
  await sleep(400);
  const early = await gainDb();
  await sleep(1000);
  const landed = await gainDb();
  await timed('a Fade cue’s drawn shape is the curve the level follows', early < -27 && early > -33 && Math.abs(landed) < 0.5, { early, landed });
  // put back: a long fade (with the rate moving too) called off, and the sound as it was before it
  host.cmd({ op: 'fire', number: 'AD3' });
  await sleep(700);
  const moving = await av(`(() => { const v = voices.get(${JSON.stringify(ad1)}); return { rate: v.buf ? rateAt(v) : v.el.playbackRate, db: 20 * Math.log10(v.gain.gain.value) }; })()`);
  const rev = host.cmd({ op: 'revert-fade', number: 'AD3' });
  await sleep(900);
  const back = await av(`(() => { const v = voices.get(${JSON.stringify(ad1)}); return { rate: v.buf ? rateAt(v) : v.el.playbackRate, db: 20 * Math.log10(v.gain.gain.value) }; })()`);
  await timed('a Fade cue moves the rate with the level, and Revert fade puts both back', moving.rate > 1.05 && moving.rate < 1.3 && moving.db < -1 && rev.reverted === 1 && Math.abs(back.rate - 1) < 0.01 && Math.abs(back.db) < 0.5 && !snap().engine.active.some((a) => a.kind === 'fade'), { moving, rev, back });
  const took = host.cmd({ op: 'fade-from-target', number: 'AD3' }); edits++;
  check('“Set level from target” takes the level the target is playing at', took.playing === true && Math.abs(took.db) < 0.5 && show.findByNumber(host.document.doc, 'AD3')!.db === 0, took);
  host.cmd({ op: 'panic', hard: true });

  // ── rate: the engine's clock and the sound agree on where it is; a kept pitch is a stream, a tape a buffer ──
  edit([{ op: 'cue.add', cue: { type: 'audio', number: 'AD4', file: tone('wav'), gainDb: -20, rate: 2, preservePitch: true }, list },
        { op: 'cue.add', cue: { type: 'audio', number: 'AD5', file: tone('flac'), gainDb: -20, rate: 0.5, loop: true }, list },
        { op: 'cue.add', cue: { type: 'audio', number: 'AD6', file: tone('wav'), gainDb: -6, envelope: [[0, -60], [0.6, -60], [1.4, 0]] }, list }], 'rate and envelope');
  host.cmd({ op: 'fire', number: 'AD4' }); host.cmd({ op: 'fire', number: 'AD5' });
  await until(() => active(idOf('AD5')) && active(idOf('AD5'))!.exact, 5000);
  await sleep(900);
  const rates = await av(`Object.fromEntries([...voices].map(([k, v]) => [k, { at: placeOf(v), buffer: !!v.buf, keeps: v.el ? v.el.preservesPitch : false, rate: v.buf ? rateAt(v) : v.el.playbackRate }]))`);
  const fast = rates[idOf('AD4')] || {}, slow = rates[idOf('AD5')] || {};
  const eFast = (active(idOf('AD4')) || {}).elapsed, eSlow = (active(idOf('AD5')) || {}).elapsed;
  await timed('a sound at double rate with its pitch kept is a stream, and is where the engine says', fast.buffer === false && fast.keeps === true && fast.rate === 2 && fast.at > 1.2 && Math.abs(fast.at - eFast!) < 0.35, { fast, eFast });
  await timed('a sound at half rate is played as a tape from its buffer, and is where the engine says', slow.buffer === true && slow.rate === 0.5 && slow.at > 0.2 && slow.at < 1 && Math.abs(slow.at - eSlow!) < 0.2, { slow, eSlow });
  host.cmd({ op: 'panic', hard: true });

  // ── the envelope: silent while its line is at the bottom, at the cue's level once it has risen ──────────────
  host.cmd({ op: 'fire', number: 'AD6' });
  const envGain = () => av(`(() => { const v = voices.get(${JSON.stringify(idOf('AD6'))}); return v && v.env ? v.env.gain.value : null; })()`);
  await sleep(350);
  const low = await envGain();
  await sleep(1500);
  const high = await envGain();
  await timed('a level envelope is followed as the sound plays', low != null && low < 0.01 && high > 0.9, { low, high });
  host.cmd({ op: 'seek', id: idOf('AD6'), t: 0.2 });
  await sleep(150);
  check('…and after a skip back it is the level drawn there', (await envGain()) < 0.05, await envGain());
  host.cmd({ op: 'panic', hard: true });

  // ── level limits ────────────────────────────────────────────────────────────────────────────────────────
  edit([{ op: 'show.set', path: 'settings.audio.levels', value: { min: -40, max: -3 } }, { op: 'cue.add', cue: { type: 'audio', number: 'AD7', file: tone('wav'), gainDb: 6 }, list }], 'limits');
  host.cmd({ op: 'fire', number: 'AD7' });
  check('a cue above the show’s maximum level plays at the maximum, and is flagged', await until(() => (active(idOf('AD7')) || {}).db === -3, 2000) && snap().problems.some((p) => p.id === idOf('AD7') && /maximum/.test(p.why)), [active(idOf('AD7')), snap().problems]);
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'undo' }); edits--;

  // ── the monitor feed: a mono copy of the main outputs on output 5 of the (pretended) eight ─────────────────
  edit([{ op: 'show.set', path: 'settings.audio.monitor', value: { on: true, out: 5, db: 0 } }], 'monitor');
  host.cmd({ op: 'fire', number: 'AD1' });      // (looped, so it is still sounding however long the window takes to meter it)
  await until(() => !!active(ad1), 3000);
  host.cmd({ op: 'level', id: ad1, db: -6 });
  // (a test run's master is shut; it is opened for a moment here, on a context that has no device, to see what the monitor gets)
  // (opened again at each look: in a packaged run the master has been shut again between one look and the next)
  const open = () => av(`master.gain.cancelScheduledValues(0), master.gain.value = 1`);
  check('the monitor feed carries the main outputs on the output it is set to', await until(async () => { await open(); const m = snap().mixer.monitor; return m.on && m.live && m.out === 5 && m.peak > -52; }, 10000),   // (a packaged build on CI took 3 s to load the file)
    { monitor: snap().mixer.monitor, sounding: active(ad1) || null, audio: await av(`(async () => {
      master.gain.cancelScheduledValues(0); master.gain.value = 1;
      const a = ctx.createAnalyser(); a.fftSize = 1024; limiter.connect(a);
      await new Promise((ok) => setTimeout(ok, 200));
      const b = new Float32Array(1024); a.getFloatTimeDomainData(b); let q = 0; for (const x of b) q = Math.max(q, Math.abs(x)); limiter.disconnect(a);
      return { master: master.gain.value, voices: voices.size, state: ctx.state, outKey, outs: ctx.destination.maxChannelCount, destCh: ctx.destination.channelCount, fake: FAKE_OUTS,
        mono: monitor.mono ? { gain: monitor.mono.gain.value, ch: monitor.mono.channelCount } : null, tap: !!monitor.tap, limiterOut: q,
        bands: [...voices.values()].map((v) => (v.band && v.band.gain ? v.band.gain.value : null)),
        // where along its way the sound stops: each voice's own level after its fader, what it plays from, whether the
        // show holds it paused, the buses' faders and peaks, the pairs' inputs. (It failed here on Windows when the
        // browser paused the stream by itself and the move to its buffer took that for the show's pause: audio.ts, play.)
        why: (() => { const pk = (an) => { if (!an) return null; const x = new Float32Array(an.fftSize); an.getFloatTimeDomainData(x); let m = 0; for (const s of x) m = Math.max(m, Math.abs(s)); return m; };
          return { voices: [...voices.values()].map((v) => ({ buf: !!v.buf, source: !!v.srcNode, el: v.el ? { paused: v.el.paused, ready: v.el.readyState, t: v.el.currentTime } : null, gain: v.gain.gain.value, env: v.env ? v.env.gain.value : null, bus: v.onBus || null, own: v.own ? v.own.pairs : null, patched: !!v.patched, peak: pk(v.tap), held: !!v.held, rescued: v.rescued || 0 })),
            buses: Object.fromEntries(Object.entries(buses).map(([n, b]) => [n, { fader: b.fader.gain.value, duck: b.duck.gain.value, to: !!b.to, want: b.want, peak: pk(b.tap) }])),
            pairs: pairs.map((p) => (p ? { master: p.master.gain.value, peak: pk(p.tap) } : null)) }; })() };
    })()`) });
  await av(`master.gain.value = 0`);
  edit([{ op: 'show.set', path: 'settings.audio.monitor.out', value: 12 }], 'monitor');
  check('…and says so when the device has no such output', await until(() => snap().mixer.monitor.on && !snap().mixer.monitor.live, 3000), snap().mixer.monitor);
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'undo' }); host.cmd({ op: 'undo' }); edits -= 2;
  await until(() => !snap().mixer.monitor.live, 2000);

  // ── the output device going away and coming back (the decision and what is said; no device is opened here) ──
  const builtIn = { id: 'default', label: 'System default' }, iface = { id: 'smoke-interface', label: 'Smoke Interface' };
  host.audioEvent({ type: 'devices', list: [builtIn, iface], inputs: [], current: 'default' });
  host.cmd({ op: 'device', id: iface.id });
  host.audioEvent({ type: 'devices', list: [builtIn], inputs: [], current: 'default' });
  check('the chosen output going away moves the show to the default output, and says so', snap().mixer.fallback && snap().mixer.fallback!.label === 'Smoke Interface' && snap().mixer.device === 'default' && /has gone/.test(snap().notice), [snap().mixer.fallback, snap().mixer.device, snap().notice]);
  host.audioEvent({ type: 'devices', list: [builtIn, iface], inputs: [], current: 'default' });
  check('…and its return moves it back', !snap().mixer.fallback && snap().mixer.device === iface.id && /is back/.test(snap().notice), [snap().mixer.fallback, snap().mixer.device, snap().notice]);
  host.cmd({ op: 'device', id: 'default' });

  // ── the waveform a sound is edited on: handles, a drawn region, zoom, the envelope, ⇧I ⇧O ─────────────────
  const ad6 = idOf('AD6');
  await page(`(() => { const r = [...document.querySelectorAll('.list tbody tr')].find((x) => /AD6/.test(x.textContent)); if (r) { r.scrollIntoView(); r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); r.click(); } })()`);
  await until(() => page(`[...document.querySelectorAll('.inspector .tabs button')].some((b) => b.textContent === 'Time & Loops')`), 3000);
  await page(`document.querySelector('.inspector [data-insp-tab="type"]').click()`);
  check('the Audio tab opens on the waveform, with its Volume line and the markers’ strip', await until(() => page(`!!document.querySelector('[data-audio-wave] [data-wavedit] svg[data-lane-svg="volume"]') && !!document.querySelector('[data-audio-wave] [data-markers]')`), 4000));
  await shot('9-audio-tab-wave');
  await page(`[...document.querySelectorAll('.inspector .tabs button')].find((b) => b.textContent === 'Time & Loops').click()`);
  check('Time & Loops shows the waveform with its Start and End handles', await until(() => page(`!!document.querySelector('[data-wavedit] [data-handle="start"]') && !!document.querySelector('[data-wavedit] [data-handle="end"]') && !!document.querySelector('[data-wavedit] canvas')`), 4000));
  const drag = (fx0: number, fx1: number, fy = 0.6) => page(`(async () => { const el = document.querySelector('[data-wavedit]'), r = el.getBoundingClientRect(); const ev = (type, fx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: r.left + fx * r.width, clientY: r.top + ${fy} * r.height }));
    ev('pointerdown', ${fx0}); await new Promise((q) => setTimeout(q, 30)); ev('pointermove', ${(0.5)} * ${fx0} + 0.5 * ${fx1}); await new Promise((q) => setTimeout(q, 30)); ev('pointermove', ${fx1}); await new Promise((q) => setTimeout(q, 30)); ev('pointerup', ${fx1}); })()`);
  const cue = () => show.findByNumber(host.document.doc, 'AD6')!;
  await until(() => snap().engine.durations[tone('wav')] > 0, 2000);
  await drag(0.4, 0.6, 0.95); edits++;            // (low down: the Volume line, always drawn, is not where the drag starts)
  check('a drag across the waveform draws a loop region', await until(() => { const l = (cue().loops || [])[0]; return l && Math.abs(l.start - 1.2) < 0.06 && Math.abs(l.end - 1.8) < 0.06; }, 2000), cue().loops);
  // (a drag a slow machine lost, before the page had drawn the handle there, is made again)
  let endSet = false;
  for (let i = 0; i < 3 && !endSet; i++) { await drag(1, 0.8, 0.05); endSet = await until(() => Math.abs((cue().cutAt || 0) - 2.4) < 0.06, 2500); }
  edits++;
  check('the End handle, dragged, sets End at', endSet, cue().cutAt);
  await page(`document.querySelector('.wavedit [data-zoom="in"]').click()`);
  check('the waveform zooms in', await until(() => page(`/×2/.test(document.querySelector('.wavedit .wavebar').textContent)`), 2000));
  await page(`document.querySelector('.wavedit [data-zoom="fit"]').click()`);
  // the lines, the markers and the loop regions on it are smoke-lanes.ts's
  await (require('./smoke-lanes') as typeof import('./smoke-lanes')).editing({ host, check, until, page, sleep, cue, edit: (n) => { edits += n; } });
  host.cmd({ op: 'fire', id: ad6 });
  await sleep(700);
  await page(`document.activeElement && document.activeElement.blur()`);
  await page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'I', code: 'KeyI', shiftKey: true, bubbles: true }))`); edits++;
  check('⇧I sets Start at where the sound is playing', await until(() => cue().from! > 0.5 && cue().from! < 1.6, 2000), cue().from);
  host.cmd({ op: 'panic', hard: true });

  // ── a Fade cue's shapes in the inspector ───────────────────────────────────────────────────────────────
  await page(`(() => { const r = [...document.querySelectorAll('.list tbody tr')].find((x) => /AD2/.test(x.textContent)); if (r) { r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); r.click(); } })()`);
  await until(() => page(`[...document.querySelectorAll('.inspector .tabs button')].some((b) => b.textContent === 'Fade')`), 3000);
  await page(`[...document.querySelectorAll('.inspector .tabs button')].find((b) => b.textContent === 'Fade').click()`);
  check('a Fade cue shows its two shapes, the drawn one with its point, and its actions', await until(() => page(`document.querySelectorAll('.inspector .shapefield svg').length === 2 && document.querySelectorAll('.inspector [data-field="shapeUp"] circle').length === 1 && !!document.querySelector('.inspector [data-fadetools]')`), 3000));

  for (; edits > 0; edits--) host.cmd({ op: 'undo' });
  await sleep(200);
  return results;
}

export { audioDepth };
