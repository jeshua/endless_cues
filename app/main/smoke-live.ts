/**
 * The smoke run's checks of the Live view's desk (called from smoke.ts, which has the rest): one clip per track,
 * tempo sections, warp, a desk kept in a Mix cue, keys and MIDI mapped to the desk, dragging and renaming.
 * Meters, positions and what the audio window says it is doing: nobody hears a test run.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Smoke, Snap, Active } from './smoke';
import type { HostResult } from './host';
import type { Cue, Tempo } from '../../core/show/types';

async function live({ host, win, check, until, page, shot, sleep, dir, timed = check }: Pick<Smoke, 'host' | 'win' | 'check' | 'until' | 'page' | 'shot' | 'sleep' | 'dir'> & Partial<Pick<Smoke, 'timed'>>) {
  const snap = () => host.snapshot() as Snap;
  const { writeWav } = require('../../examples/make-demo');
  const audioWin = () => host.audioWindow()!.webContents;
  const strips = () => audioWin().executeJavaScript('Object.fromEntries(Object.entries(buses).map(([k, b]) => [k, { ...b.strip, wired: b.wired, gate: b.gate.gain.value }]))', true);
  const running = (id: string) => snap().engine.active.some((a) => a.id === id && a.kind === 'audio');
  const cueOf = (id: string): Cue | null => { let hit: Cue | null = null; const walk = (l: Cue[]) => { for (const c of l) { if (c.id === id) hit = c; if (c.children) walk(c.children); } }; for (const l of host.document.doc.lists) walk(l.cues); return hit; };
  /** A click track in parts: [[secs, bpm], …], a click on each beat from the start of each part. */
  const clicks = (file: string, parts: [number, number][]) => {
    const n = Math.round(parts.reduce((t, p) => t + p[0], 0) * 44100), x = new Float32Array(n);
    let from = 0;
    for (const [secs, bpm] of parts) { const a = Math.round(from * 44100), b = 60 / bpm; for (let i = 0; i < secs * 44100 && a + i < n; i++) { const p = (i / 44100) % b; x[a + i] = Math.exp(-p / 0.04) * Math.sin(2 * Math.PI * 70 * p) * 0.8; } from += secs; }
    writeWav(file, x);
  };

  host.cmd({ op: 'panic', hard: true });
  host.openUntitled(); host.open(dir);
  await until(() => snap().mixer.audioReady && snap().rows.length >= 10);
  win.webContents.send('ec-menu', 'view-live');
  await until(() => page(`!!document.querySelector('.desk')`), 3000);
  host.cmd({ op: 'launch-q', q: 'none' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-live-'));

  // one clip per track: a launch takes over from what is playing on its track; a GO does not; the show can let them overlap
  const music = host.document.doc.lists[0].cues.filter((c) => c.type === 'audio' && c.bus === 'music');
  const fx: Cue[] = []; { const walk = (l: Cue[]) => { for (const c of l) { if (c.type === 'audio' && (c.bus || 'effects') === 'effects') fx.push(c); if (c.children) walk(c.children); } }; walk(host.document.doc.lists[0].cues); }
  host.cmd({ op: 'launch', id: music[0].id });
  host.cmd({ op: 'launch', id: fx[0].id });
  await until(() => running(music[0].id) && running(fx[0].id), 3000);
  host.cmd({ op: 'launch', id: music[1].id });
  check('a clip launched on a track takes over from the one playing there, and leaves the other tracks alone', await until(() => running(music[1].id) && !running(music[0].id) && running(fx[0].id), 3000), snap().engine.active.map((a) => a.name));
  host.cmd({ op: 'fire', id: music[0].id });
  await sleep(300);
  check('a GO or a fire stops nothing by itself', running(music[0].id) && running(music[1].id));
  host.cmd({ op: 'panic', hard: true });
  await page(`document.querySelector('.desk [data-overlap]').click()`);
  check('“One clip per track” is a setting of the show', await until(() => host.document.doc.settings.live.overlap === true && snap().live.overlap, 2000), host.document.doc.settings.live);
  host.cmd({ op: 'launch', id: music[0].id }); host.cmd({ op: 'launch', id: music[1].id });
  check('…and switched off, two clips on one track play together', await until(() => running(music[0].id) && running(music[1].id), 3000));
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'live-set', key: 'overlap', value: false });

  // tempo sections: a made track at 120 and then at 90
  const twoFile = path.join(tmp, 'two-tempos.wav');
  clicks(twoFile, [[24, 120], [24, 90]]);
  const made = host.cmd({ op: 'import', paths: [twoFile], bus: 'music' }) as HostResult;
  const two = made && made.made && made.made[0];
  await until(() => Object.keys(snap().engine.durations).some((f) => /two-tempos/.test(f)), 4000);
  const foundTwo = await host.cmd({ op: 'tempo-find', ids: [two] });
  const t2: Partial<Tempo> = cueOf(two)?.tempo || {};
  check('a track that changes tempo gets a section for each tempo', foundTwo.found === 1 && Math.abs(t2.bpm! - 120) < 0.1 && (t2.sections || []).length === 1 && Math.abs(t2.sections![0].bpm - 90) < 0.2 && Math.abs(t2.sections![0].from - 24) < 0.8, t2);
  await page(`document.querySelector('.desk [data-clip="${two}"]').click()`);
  check('the Clip view lists its sections', await until(() => page(`document.querySelectorAll('.desk [data-clipview="${two}"] .secchip').length`).then((n) => n === 2), 3000));
  host.cmd({ op: 'fire', id: two });
  host.cmd({ op: 'seek', id: two, t: 30.1 });
  await sleep(300);
  check('the desk reads the tempo of the section the track is in', snap().live.clock && Math.abs(snap().live.clock!.bpm - 90) < 0.2, snap().live.clock);
  check('…and the Clip view’s tempo is that section’s', await until(() => page(`(document.querySelector('.desk [data-clipview="${two}"] .bpmfield') || {}).value`).then((v) => Math.abs(Number(v) - 90) < 0.2), 3000));
  // by hand: three in a bar from here on, and beat one where the track is
  await page(`(() => { const sel = document.querySelector('.desk [data-clipview="${two}"] .barsel'); sel.value = '3'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check('beats in a bar are set for a section, and the desk counts in them', await until(() => (cueOf(two)!.tempo!.sections![0] || {}).bar === 3 && cueOf(two)!.tempo!.bar === 4 && snap().live.clock && snap().live.clock!.per === 3, 3000), [cueOf(two)!.tempo, snap().live.clock]);
  host.cmd({ op: 'seek', id: two, t: 32.55 });         // (its beats are 0.667 s apart from 24.0: the one nearest is at 32.67, the second of its bar)
  await sleep(150);
  await page(`document.querySelector('.desk [data-clipview="${two}"] [data-one]').click()`);
  check('“1 is here” puts beat one on the beat the track is at', await until(() => Math.abs(cueOf(two)!.tempo!.sections![0].first - 24.669) < 0.02, 3000), [cueOf(two)!.tempo, snap().live.clock]);
  host.cmd({ op: 'seek', id: two, t: 10.02 });
  await sleep(250);
  await page(`document.querySelector('.desk [data-clipview="${two}"] [data-split]').click()`);
  check('“+ here” starts a new section on the beat the track is at', await until(() => cueOf(two)!.tempo!.sections!.length === 2 && Math.abs(cueOf(two)!.tempo!.sections![0].from - 10.25) < 0.55, 3000), cueOf(two)!.tempo);
  await shot('10-live-sections');
  host.cmd({ op: 'undo' });
  host.cmd({ op: 'panic', hard: true });

  // the strip by its meter (nobody hears a test run): a 70 Hz click through the eq's low band, and through the crossfader
  // MEASURED: the bus meter is a 23 ms look at the bus every 66 ms, and this click falls 14 dB in 66 ms, so one click
  // reads anywhere from -2.7 to -12 dB (lower when a busy machine stretches the 66) by where the look happens to
  // fall. A reading is therefore the loudest of several clicks (2.2 s: four at 120, each met 38 ms later in the
  // meter's cycle than the last), and "sound is back" is waited for as sound against silence, not compared to the
  // dB with an earlier reading: 700 ms held one click, and one run in three its reading was 6 dB under the last one's.
  const peakOf = async (bus: string, ms = 2200) => { let top = -60; const end = Date.now() + ms; while (Date.now() < end) { top = Math.max(top, snap().mixer.buses.find((b) => b.id === bus)!.peak); await sleep(40); } return top; };
  host.cmd({ op: 'fire', id: two });
  await until(() => running(two), 3000);
  await sleep(300);
  const flat = await peakOf('music');
  host.cmd({ op: 'strip', name: 'music', key: 'eq.low', value: -40 });
  await sleep(400);
  const killed = await peakOf('music');
  check('EQ Three’s low kill takes a low sound down on the track’s meter', flat > -30 && killed < flat - 10, [flat, killed]);
  host.cmd({ op: 'strip', name: 'music', key: 'eq.low', value: 0 });
  host.cmd({ op: 'strip', name: 'music', key: 'xf', value: 'a', commit: true });
  host.cmd({ op: 'crossfader', value: 1 });
  await sleep(400);
  const crossed = await peakOf('music', 1200);
  host.cmd({ op: 'crossfader', value: 0 });
  host.cmd({ op: 'strip', name: 'music', key: 'xf', value: '', commit: true });
  const back = await until(() => snap().mixer.buses.find((b) => b.id === 'music')!.peak > -20, 4000);
  check('the crossfader at B silences a track on A, and brings it back at the centre', crossed <= -55 && back, [flat, crossed]);
  // a loop of one bar from a deck: as long as a bar of the section the track is in
  host.cmd({ op: 'seek', id: two, t: 2.1 });
  await page(`document.querySelector('.desk .dtabs button:nth-child(3)').click()`);
  await until(() => page(`!!document.querySelector('.desk [data-deck="${two}"] .dctl')`), 3000);
  await page(`[...document.querySelectorAll('.desk [data-deck="${two}"] .dctl button')].find((b) => b.textContent === '1 bar').click()`);
  check('a deck’s “1 bar” loops one bar of the track’s tempo, from a beat', await until(() => { const a: Partial<Active> = snap().engine.active.find((x) => x.id === two) || {}; const g = a.region || (a.armed || [])[0]; return g && Math.abs(g.end - g.start - 2) < 0.01 && Math.abs(((g.start - 0.002) / 0.5) - Math.round((g.start - 0.002) / 0.5)) < 0.02; }, 4000), snap().engine.active.find((x) => x.id === two));
  host.cmd({ op: 'panic', hard: true });
  // a strip moved while nothing plays through its bus has arrived by the time a sound does: the bus's gains move
  // whether or not there is sound in them (a Web Audio node with no input stops its automation where it was)
  await sleep(300);
  const gateOf = (bus: string) => audioWin().executeJavaScript(`[buses[${JSON.stringify(bus)}].gate.gain.value, buses[${JSON.stringify(bus)}].ctl.gate.gain.value]`, true);
  host.cmd({ op: 'strip', name: 'music', key: 'xf', value: 'a', commit: true });
  host.cmd({ op: 'crossfader', value: 1 });
  await sleep(500);
  const shut = await gateOf('music');
  host.cmd({ op: 'crossfader', value: 0 });
  host.cmd({ op: 'strip', name: 'music', key: 'xf', value: '', commit: true });
  await sleep(500);
  const open = await gateOf('music');
  check('a strip moved while its bus is silent has arrived before the next sound: its gate does not wait for one', shut[0] < 0.01 && shut[1] < 0.01 && open[0] > 0.99 && open[1] > 0.99, [shut, open]);
  await page(`document.querySelector('.desk [data-clip="${two}"]').click()`);

  // warp: the clip at the desk's tempo
  const voiceRate = (id: string) => audioWin().executeJavaScript(`(() => { const v = voices.get(${JSON.stringify(id)}); return v ? { rate: v.buf ? rateAt(v) : v.el.playbackRate, el: v.el ? v.el.playbackRate : null, keeps: v.el ? v.el.preservesPitch : null, buf: !!v.buf } : null; })()`, true);
  host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: two, props: { warp: 'keep' } }], label: 'warp' });
  host.cmd({ op: 'live-set', key: 'tempo', value: 150 });
  host.cmd({ op: 'launch', id: two });
  await until(() => running(two), 3000);
  const vr = await voiceRate(two);
  check('a warped clip plays at the desk’s tempo, keeping its pitch', vr && Math.abs(vr.rate - 1.25) < 0.001 && Math.abs(vr.el - 1.25) < 0.001 && vr.keeps === true && Math.abs(snap().live.clock!.bpm - 150) < 0.2, [vr, snap().live.clock]);
  const e0 = snap().engine.active.find((a) => a.id === two)!.elapsed;
  await sleep(1000);
  const e1 = snap().engine.active.find((a) => a.id === two)!.elapsed;
  const heard = await audioWin().executeJavaScript(`voices.get(${JSON.stringify(two)}).el.currentTime`, true);
  await timed('…the engine knows where in its file it is', e1 - e0 > 1.1 && e1 - e0 < 1.45 && Math.abs(heard - e1) < 0.3, [e0, e1, heard]);
  host.cmd({ op: 'live-set', key: 'tempo', value: 120 });
  await sleep(200);
  check('the desk’s tempo moved: the clip follows from where it is', Math.abs(((await voiceRate(two)) || {}).el - 1) < 0.001 && snap().engine.active.find((a) => a.id === two)!.rate === 1, await voiceRate(two));
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: two, props: { warp: 'repitch', loop: true } }], label: 'warp' });
  host.cmd({ op: 'live-set', key: 'tempo', value: 96 });
  await sleep(1500);                                   // (a looping sound is decoded ahead: it plays from its buffer)
  host.cmd({ op: 'launch', id: two });
  await until(() => running(two), 3000);
  await sleep(300);
  const vb = await voiceRate(two);
  check('re-pitched, it plays slower through its buffer (or its stream)', vb && Math.abs(vb.rate - 0.8) < 0.001 && (vb.buf || (Math.abs(vb.el - 0.8) < 0.001 && vb.keeps === false)), vb);
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'live-set', key: 'tempo', value: 0 });

  // a Mix cue recalls a whole desk
  host.cmd({ op: 'strip', name: 'music', key: 'filter', value: -0.6, commit: true });
  host.cmd({ op: 'strip', name: 'effects', key: 'mute', value: true, commit: true });
  host.cmd({ op: 'crossfader', value: -0.5, commit: true });
  await page(`document.querySelector('.desk [data-keepdesk]').click()`);
  let mix: Cue | null | undefined = null;
  check('Keep desk makes a Mix cue with the whole desk in it', await until(() => { mix = host.document.doc.lists[0].cues.find((c) => c.type === 'mix' && c.desk); return !!mix && mix.desk!.buses!.music.filter === -0.6 && mix.desk!.buses!.effects.mute === true && mix.desk!.crossfader === -0.5; }, 3000), mix);
  host.cmd({ op: 'strip', name: 'music', key: 'filter', value: 0, commit: true });
  host.cmd({ op: 'strip', name: 'effects', key: 'mute', value: false, commit: true });
  host.cmd({ op: 'crossfader', value: 0, commit: true });
  await sleep(400);
  check('(the desk is back at rest)', (await strips()).music.filter === null && (await strips()).effects.gate > 0.99, await strips());
  host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: mix!.id, props: { duration: 0.3 } }], label: 'quick' });
  // (a sound on each bus the checks read: the audio window runs a gain's glide only while something plays through it)
  host.cmd({ op: 'fire', id: fx[0].id }); host.cmd({ op: 'fire', id: music[0].id });
  await until(() => snap().mixer.buses.find((b) => b.id === 'effects')!.peak > -50, 3000);
  host.cmd({ op: 'fire', id: mix!.id });
  check('its GO brings the desk back: the filter, the mute and the crossfader, over its time', await until(async () => { const st = await strips(); return st.music.filter && st.music.filter.type === 'lowpass' && st.effects.gate < 0.02; }, 4000) && snap().mixer.crossfader === -0.5 && snap().mixer.buses.find((b) => b.id === 'effects')!.mute === true, [await strips(), snap().mixer.crossfader]);
  check('…and the muted track’s meter is still while its sound plays on', await until(() => snap().mixer.buses.find((b) => b.id === 'effects')!.peak <= -59 && running(fx[0].id), 2000), snap().mixer.buses.find((b) => b.id === 'effects'));
  check('…as the desk played, not as a change to the show', host.document.doc.settings.audio.buses.find((b) => b.id === 'effects')!.mute === undefined && snap().mixer.buses.find((b) => b.id === 'music')!.liveStrip === true);
  await shot('11-live-desk-recalled');
  host.cmd({ op: 'reset' });
  host.cmd({ op: 'fire', id: fx[0].id }); host.cmd({ op: 'fire', id: music[0].id });
  check('Reset puts the desk back where the show has it', await until(async () => (await strips()).music.filter === null && (await strips()).effects.gate > 0.99 && snap().mixer.crossfader === 0, 3000), await strips());
  host.cmd({ op: 'panic', hard: true });

  // keys and MIDI mapped to the desk
  await page(`document.querySelector('.desk [data-mapbtn]').click()`);
  await until(() => page(`!!document.querySelector('.desk.mapping')`), 2000);
  await page(`document.querySelector('.desk [data-clip="${music[0].id}"]').click()`);
  check('in Map mode a click chooses a control and does not work it', await until(() => page(`!!document.querySelector('.desk [data-clip="${music[0].id}"][data-mapsel]')`), 2000) && !running(music[0].id));
  await page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true }))`);
  check('…and the next key pressed is given to it', await until(() => (host.document.doc.settings.live.map || []).some((x) => x.on === 'key q' && x.to === `launch:${music[0].id}`), 2000), host.document.doc.settings.live.map);
  await page(`document.querySelector('.desk .vfader[data-map="fader:music"]').click()`);
  await until(() => snap().midi.mapping, 2000);
  host.midiIn([0xb0, 7, 64], 'test surface');
  check('…or the next MIDI control moved', await until(() => (host.document.doc.settings.live.map || []).some((x) => x.on === 'cc 7 ch 1' && x.to === 'fader:music'), 2000), host.document.doc.settings.live.map);
  check('a mapped control says what it is mapped to', await until(() => page(`[document.querySelector('.desk [data-clip="${music[0].id}"]').getAttribute('data-maptag'), document.querySelector('.desk .vfader[data-map="fader:music"]').getAttribute('data-maptag')].join('|')`).then((v) => v === 'q|cc 7'), 2000));
  await shot('12-live-map');
  await page(`document.querySelector('.desk [data-mapbtn]').click()`);
  await until(() => page(`!document.querySelector('.desk.mapping')`), 2000);
  await page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true }))`);
  check('the mapped key launches its clip', await until(() => running(music[0].id), 3000));
  host.midiIn([0xb0, 7, 0], 'test surface');
  check('the mapped controller moves its fader: heard and shown, not written to the show', await until(async () => snap().mixer.buses.find((b) => b.id === 'music')!.live === -60 && (await audioWin().executeJavaScript('buses.music.fader.gain.value', true)) < 0.01, 3000) && host.document.doc.settings.audio.buses.find((b) => b.id === 'music')!.db !== -60, snap().mixer.buses[0]);
  host.cmd({ op: 'map-set', on: 'note 36 ch 10', to: 'mute:effects' });
  host.cmd({ op: 'fire', id: fx[0].id });
  host.midiIn([0x99, 36, 100], 'test surface');
  check('a pad mapped to a track’s on/off button mutes it', await until(async () => (await strips()).effects.gate < 0.02, 2000) && host.document.doc.settings.audio.buses.find((b) => b.id === 'effects')!.mute === true);
  host.midiIn([0x99, 36, 100], 'test surface');
  host.cmd({ op: 'reset' });

  // dragging and naming, in place
  const dragTo = (from: string, to: string, type: string) => page(`(() => { const a = document.querySelector(${JSON.stringify(from)}), b = document.querySelector(${JSON.stringify(to)}); if (!a || !b) return 'missing'; const dt = new DataTransfer();
    a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })); if (![...dt.types].includes(${JSON.stringify(type)})) return 'not draggable';
    b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); return 'ok'; })()`);
  const sceneOf = music[1].id;
  const dragged = await dragTo(`.desk [data-clip="${music[1].id}"]`, `.desk [data-scene="${sceneOf}"] [data-slot="vocals"]`, 'application/x-ec-clip');
  check('a clip dragged to another track plays there', await until(() => cueOf(music[1].id)!.bus === 'vocals', 3000), [dragged, cueOf(music[1].id)!.bus]);
  host.cmd({ op: 'undo' });
  const reordered = await dragTo('.desk [data-th="vocals"]', '.desk [data-th="music"]', 'application/x-ec-track');
  check('a track header dragged onto another reorders the tracks', await until(() => host.document.doc.settings.audio.buses[0].id === 'vocals' && page(`document.querySelector('.desk .shead .th').getAttribute('data-th')`).then((v) => v === 'vocals'), 3000), [reordered, host.document.doc.settings.audio.buses.map((b) => b.id)]);
  host.cmd({ op: 'undo' });
  await page(`document.querySelector('.desk [data-th="music"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await until(() => page(`!!document.querySelector('.desk .thname')`), 2000);
  await page(`(() => { const i = document.querySelector('.desk .thname'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Band'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(100);
  await page(`document.querySelector('.desk .thname').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  check('a track is renamed in place', await until(() => host.document.doc.settings.audio.buses.find((b) => b.id === 'music')!.name === 'Band', 3000), host.document.doc.settings.audio.buses[0]);
  await page(`document.querySelector('.desk [data-th="music"] [data-swatch]').click()`);
  check('…and given a colour', await until(() => host.document.doc.settings.audio.buses.find((b) => b.id === 'music')!.color === 'red', 3000), host.document.doc.settings.audio.buses[0]);
  // a file dropped on a track (a real drop carries the file's path; the page hands it to the same command)
  const dropFile = path.join(tmp, 'dropped.wav');
  clicks(dropFile, [[2, 120]]);
  const group = host.document.doc.lists[0].cues.find((c) => c.type === 'group')!;
  const droppedIn = await host.cmd({ op: 'import', paths: [dropFile], bus: 'vocals', parent: group.id });
  check('a file dropped in a scene’s slot becomes a clip in that scene, on that track', droppedIn && droppedIn.made && (cueOf(group.id)!.children || []).some((c) => c.id === droppedIn.made[0] && c.bus === 'vocals'), droppedIn);
  await shot('13-live-tracks');
  // controls stay where they are as others come and go (the crossfader when a track is put on A)
  const railAt = () => page<number>(`document.querySelector('.desk .xfader input').getBoundingClientRect().left`);
  const before = await railAt();
  host.cmd({ op: 'strip', name: 'music', key: 'xf', value: 'a', commit: true });
  await sleep(250);
  check('the crossfader does not move when a track is put on a side', Math.abs((await railAt()) - before) < 0.5, [before, await railAt()]);
  host.cmd({ op: 'panic', hard: true });
  win.webContents.send('ec-menu', 'view-live');
  await until(() => page(`!document.querySelector('.desk') && !!document.querySelector('.list')`), 3000);
}

export { live };
