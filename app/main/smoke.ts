/**
 * The end-to-end check: the real app, driven through its own doors.
 *
 *   npm run smoke                       exit code 0 = every check passed
 *   SMOKE_SHOTS=dir npm run smoke       also saves pictures of the window
 *
 * Offscreen, silent (the master is muted), no network ports, its own temporary
 * settings folder, and it never becomes the front app (main.ts sets the
 * activation policy): safe to run on a computer that is busy doing a show.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { App, BrowserWindow } from 'electron';
import type { Host, HostState, HostCommand, HostOp, HostResult } from './host';
import type { makeDemo as MakeDemo } from '../../examples/make-demo';
import type { Cue } from '../../core/show/types';
import type { MonitorEntry } from '../../core/net/hub';
import type { PlayEntry } from '../../core/engine/playlog';

/** A check: passes when `ok` is truthy; `got` is said when it fails. */
export type Check = (name: string, ok: unknown, got?: unknown) => void;
/** A check that compares the audio's time with the wall clock (a skip, not a failure, where the audio runs slow). */
export type Timed = (name: string, ok: unknown, got?: unknown) => void | Promise<void>;
/** Waits until `fn` gives something truthy (a throw is "not yet"), for at most `ms`. */
export type Until = (fn: () => unknown, ms?: number) => Promise<boolean>;
/** Runs a script in the main window; `T` is what the script gives back. */
export type Page = <T = unknown>(js: string) => Promise<T>;
export type Sleep = (ms: number) => Promise<unknown>;
export type Shot = (name: string) => Promise<void>;
type ActiveLine = HostState['engine']['active'][number];
/** One line of what is going on (the engine's `active`): a wait, a sound or picture, a fade; read with any field a
 *  sound's line has (absent on the others). */
export type Active = ActiveLine & Partial<Omit<Extract<ActiveLine, { file: unknown }>, keyof ActiveLine>> & { run?: string };
type FullOnly = 'doc' | 'labels' | 'triggers' | 'carts' | 'fadeStops';
/** The host's snapshot as a test run takes it: a full one (with the document: a show is always open), its `active`
 *  lines read as `Active`. */
export type Snap = Omit<HostState, 'engine' | FullOnly> & { [K in FullOnly]-?: NonNullable<HostState[K]> } & { engine: Omit<HostState['engine'], 'active'> & { active: Active[] } };
/** What each part of the smoke run is handed: smoke-*.js take the parts they use. */
export interface Smoke { host: Host; win: BrowserWindow; check: Check; timed: Timed; until: Until; page: Page; sleep: Sleep; shot: Shot; log: (line: string) => void; dir: string }

const sleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run({ host, win, log, makeDemo }: { app?: App; host: Host; win: BrowserWindow; log: (line: string) => void; makeDemo: typeof MakeDemo }) {
  let failed = 0;
  const check: Check = (name, ok, got) => { if (ok) log(`SMOKE ok    ${name}`); else { failed++; log(`SMOKE FAIL  ${name}${got !== undefined ? `  got: ${JSON.stringify(got)}` : ''}`); } };
  // (time the computer spent asleep is not time the app was given: a wait that was slept through is given it back.
  // MEASURED: an unattended machine dozing for 15 s in the middle of a run failed whatever check it fell in.)
  const until: Until = async (fn, ms = 8000) => { let end = Date.now() + ms, last = Date.now(); while (Date.now() < end) { try { if (await fn()) return true; } catch { /* not yet */ } await sleep(60); const now = Date.now(); if (now - last > 3000) end += now - last; last = now; } return false; };
  const page: Page = (js) => win.webContents.executeJavaScript(js, true);
  const shots = process.env.SMOKE_SHOTS;
  const shot: Shot = async (name) => {
    if (!shots) return;
    fs.mkdirSync(shots, { recursive: true });
    await sleep(350);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shots, `${name}.png`), img.toPNG());
  };

  try {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-show-')), 'Demo.ecshow');
    makeDemo(dir);
    win.setSize(1480, 940);
    win.showInactive();                      // drawn (so it can be pictured) without taking the keyboard
    { const a = require('electron').screen.getPrimaryDisplay().workAreaSize; log(`SMOKE note  the screen here is ${a.width} x ${a.height}; the window asked for 1480 x 940 and got ${win.getSize().join(' x ')}`); }
    check('the window loads', await until(() => page('!!document.querySelector(".welcome, .list")')));
    check('the start screen shows the mark (the SVG, drawn) and the name in one colour', await until(() => page(`(() => { const i = document.querySelector('.welcome .mark'), h = document.querySelector('.welcome h1'); return !!i && i.complete && i.naturalWidth > 0 && /images\\/mark\\.svg$/.test(i.src) && !h.querySelector('span'); })()`), 3000));
    await shot('0-welcome');
    host.open(dir);
    const snap = () => host.snapshot() as Snap;
    check('the demo show opens', snap().show.title === 'Demo show' && snap().rows.length >= 10, snap().rows.length);
    check('the audio window is ready', await until(() => snap().mixer.audioReady));
    // how fast the audio here runs against the wall clock: a check that compares the two means nothing where it falls
    // behind (a CI machine's audio, with no device, has run at under half speed). Said every run; such a check that
    // fails there is a skip that says why, not a failure.
    const pace = await host.audioWindow()!.webContents.executeJavaScript('new Promise((r) => { const a = ctx.currentTime, t = performance.now(); setTimeout(() => r((ctx.currentTime - a) * 1000 / (performance.now() - t)), 1000); })', true).catch(() => 1);
    log(`SMOKE note  the audio here runs at ${Math.round(pace * 100)}% of real time`);
    // (on a failure the pace is measured again, then and there: a CI machine's audio speeds up and slows down)
    const paceNow = () => host.audioWindow()!.webContents.executeJavaScript('new Promise((r) => { const a = ctx.currentTime, t = performance.now(); setTimeout(() => r((ctx.currentTime - a) * 1000 / (performance.now() - t)), 1000); })', true).catch(() => 1);
    const timed: Timed = async (name, ok, got) => { if (ok) return check(name, ok, got); const now = Math.min(pace, await paceNow()); if (now >= 0.9) return check(name, ok, got); log(`SMOKE skip  ${name}: the audio here runs at ${Math.round(now * 100)}% of real time${got !== undefined ? `  got: ${JSON.stringify(got)}` : ''}`); };
    check('every file is found and measured', await until(() => Object.keys(snap().engine.durations).length >= 4), snap().engine.durations);
    check('no problems in the demo', snap().problems.length === 0, snap().problems);
    check('the page draws the list', await until(() => page('document.querySelectorAll(".list tbody tr").length >= 10')));
    await shot('1-edit');

    // GO: the engine, the audio window, the page
    // (what is sounding, from the engine making the sound: the audio window's own voices, or, with the native engine
    // (EC_SMOKE_NATIVE), the sounds its level event names, 30 times a second)
    const onNative = () => snap().mixer.engine.using === 'native';
    // (EC_SMOKE_NATIVE: a part that reads the audio window's own state may throw on the native engine, whose sound the
    // window is not making: said as a failure of that part, and the run goes on to the next)
    const part = async (name: string, fn: () => Promise<unknown>) => {
      if (process.env.EC_SMOKE_NATIVE !== '1') { await fn(); return; }
      try { await fn(); } catch (err) { check(`${name} ran to its end on the native engine`, false, String((err as Error).message || err)); }
    };
    const soundingKeys = async (): Promise<string[]> => (onNative() ? Object.keys(snap().cueLevels || {}) : host.audioWindow()!.webContents.executeJavaScript('[...voices.keys()]', true));
    const audioVoices = async () => (onNative() ? (await soundingKeys()).length : host.audioWindow()!.webContents.executeJavaScript('voices.size', true));
    host.cmd({ op: 'go' });
    check('GO starts a sound', await until(async () => (await audioVoices()) === 1));
    check('double-GO protection drops a bounce', host.cmd({ op: 'go' }).ignored === 'double GO');
    check('the page shows it running', await until(() => page('!!document.querySelector(".list tr.live") && !!document.querySelector(".act .bar")')));
    check('a running row keeps its columns', await page('getComputedStyle(document.querySelector(".list tr.live")).display') === 'table-row');
    await sleep(350);
    host.cmd({ op: 'go' });                  // LQ1
    await sleep(350);
    host.cmd({ op: 'go' });                  // scene 1: fades the underscore, starts the rain (+ a bell and a network cue)
    check('a group starts its children', await until(async () => (await audioVoices()) >= 2));
    check('its network cue was sent to its patch', await until(() => snap().sent.some((x) => x.message === '/eos/cue/1/2/fire' && x.ok)), snap().sent);
    await sleep(700);
    await shot('2-running');

    // editing is heard at once, undoable, and versioned
    host.cmd({ op: 'save' });
    const rain = snap().rows.find((r) => r.name === 'Rain')!.id;
    const r1 = host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: rain, props: { gainDb: -12 } }], label: 'level' });
    check('an edit applies', r1.changed === true, r1);
    check('a level change reaches the playing sound', await until(() => snap().engine.active.some((a) => a.id === rain && (a.db === -12 || a.fadingTo === -12))), snap().engine.active.map((a) => [a.name, a.db, a.fadingTo]));
    const onDisk = () => JSON.parse(fs.readFileSync(path.join(dir, 'show.json'), 'utf8')).lists[0].cues[2].children[0].gainDb;
    check('…but is not kept: the show file still has the saved level', onDisk() === -6, onDisk());
    check('the pending change is counted and names the saved value', snap().show.unsaved.length === 1 && snap().show.unsaved[0].fields[0].rawFrom === -6, snap().show.unsaved);
    check('the page marks it (Save carries the count)', await until(() => page('/^Save · 1$/.test(document.querySelector("[data-save]").textContent.trim()) && !!document.querySelector(".unsaved-dot")'), 3000));
    host.cmd({ op: 'bus', name: 'music', db: -4, commit: true });
    check('a moved knob is marked as pending, with a way back', await until(() => page('!!document.querySelector(".knob.pending .was button")'), 3000));
    await shot('2b-unsaved');
    const v = host.cmd({ op: 'save' });
    check('save writes the show and records a version with a written note', onDisk() === -12 && v.version && /level/i.test(v.version.note), v);
    check('nothing is pending after a save', snap().show.unsaved.length === 0 && !snap().show.dirty);
    host.cmd({ op: 'undo' }); host.cmd({ op: 'undo' });
    check('undo brings the level back', host.document.doc.lists[0].cues[2].children![0].gainDb === -6);
    host.cmd({ op: 'revert' });
    // Fade to: a place marked on the playing track, then a crossfade to it
    host.cmd({ op: 'prepare', id: rain });
    check('a marked track is decoded for Fade to', await until(() => snap().engine.active.some((a) => a.id === rain && a.exact), 5000));
    host.cmd({ op: 'fadeto', id: rain, t: 8, secs: 0.4 });
    check('Fade to lands on the place', await until(() => { const a = snap().engine.active.find((x) => x.id === rain); return a && a.elapsed > 7.9 && a.elapsed < 9.5; }, 3000), snap().engine.active.map((a) => [a.name, a.elapsed]));

    // the assistant proposes; nothing lands until accepted
    const before = snap().rows.length;
    const asked = await host.cmd({ op: 'ask', text: 'add a memo called Curtain call' });
    check('the assistant stages a proposal', asked.ok && !!snap().proposal && snap().proposal!.counts.added === 1, asked);
    check('the show is unchanged while it waits', snap().rows.length === before);
    await page('window.dispatchEvent(new Event("ec-open-assistant"))');
    win.webContents.send('ec-menu', 'assistant');
    await until(() => page('!!document.querySelector(".review")'));
    await shot('3-assistant');
    host.cmd({ op: 'accept', id: snap().proposal!.id });
    check('accepting lands it', snap().rows.length === before + 1 && !snap().proposal);
    check('…as a pending edit; saving it records the assistant as the author', snap().show.dirty && host.cmd({ op: 'save' }).version.author === 'assistant');

    // show mode locks editing; panic silences
    host.cmd({ op: 'mode', mode: 'show' });
    check('show mode refuses an edit', !!host.cmd({ op: 'edit', ops: [{ op: 'cue.remove', id: rain }] }).error);
    // (every command that changes the show or its folder, not only `edit`: each is refused before it looks at anything.
    // A hand on the mixer — a bus's fader, the master — is running the show, and is not.)
    { const open: string[] = []; for (const op of ['fade-from-target', 'relink', 'undo', 'redo', 'import', 'accept', 'restore-version', 'restore-backup', 'settings-import', 'revert', 'unset', 'tempo-find', 'clip-paste', 'clip-props', 'retarget', 'template', 'tempo-edit', 'media-clean', 'mark-here'] as HostOp[]) { const r = await host.cmd({ op, id: rain } as HostCommand); if (!r || !/Show mode/.test(r.error || '')) open.push(op); }
      check('…and every other command that changes the show (a Fade’s level from its target, Find the tempo, relink, undo, tidying its sounds…)', open.length === 0, open); }
    await shot('4-show-mode');
    host.cmd({ op: 'mode', mode: 'edit' });
    win.webContents.send('ec-menu', 'assistant');
    win.webContents.send('ec-menu', 'settings');
    await until(() => page('!!document.querySelector(".modal")'));
    await page(`(async () => { document.querySelector('.modal nav [data-section="integrations"]').click(); await new Promise((r) => setTimeout(r, 0)); document.querySelector('.modal .settings-subtabs [data-section="modules"]').click(); })()`);
    await shot('5-settings');
    await page(`(async () => { document.querySelector('.modal nav [data-section="integrations"]').click(); await new Promise((r) => setTimeout(r, 0)); document.querySelector('.modal .settings-subtabs [data-section="network"]').click(); })()`);
    check('the network settings draw, with the monitor showing what was sent', await until(() => page('!!document.querySelector(".patch") && document.querySelectorAll(".mon.out").length > 0'), 3000));
    await shot('5a-settings-network');
    await page('[...document.querySelectorAll(".modal nav button")].find((b) => b.textContent === "Assistant").click()');
    check('the assistant settings draw', await until(() => page('!!document.querySelector(".modal .pane select")'), 3000));
    await shot('5b-settings-assistant');
    for (const theme of ['ocean', 'graphite']) {
      await page(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await page('document.querySelector(".modal .close") && document.querySelector(".modal .close").click()');
      await shot(`6-theme-${theme}`);
    }
    // the engine and the audio window must never disagree about what is sounding (an orphan is a sound Stop cannot reach)
    const sounding = async () => ({ audio: (await soundingKeys()).sort(), engine: [...host.engine.running.keys()].sort() });
    check('the engine and the audio window agree on what is sounding', await until(async () => { const x = await sounding(); return JSON.stringify(x.audio) === JSON.stringify(x.engine); }, 3000), await sounding());
    host.cmd({ op: 'panic', hard: true });
    check('panic stops every sound', await until(async () => (await audioVoices()) === 0), { left: await soundingKeys(), engine: [...host.engine.running.keys()], rows: snap().rows.filter((r) => r.type === 'audio').map((r) => [r.id, r.name]) });
    // the tools that take the toolbar's place, and the keys that edit in place
    await page('document.documentElement.dataset.theme = "lab"');
    host.cmd({ op: 'reset' });
    win.webContents.send('ec-menu', 'tool-load');
    check('Load to Time opens in the toolbar’s place', await until(() => page('!!document.querySelector(".toolstrip input[type=text]")'), 3000));
    check('Load to Time loads the cue standing by', host.cmd({ op: 'load', secs: 3 }).loaded.at === 3 && await until(() => page('/LOADED TO/.test(document.querySelector(".masthead").textContent)'), 3000));
    await shot('7-load-to-time');
    host.cmd({ op: 'load', secs: 0 });
    win.webContents.send('ec-menu', 'tool-jump');
    check('Jump to cue opens', await until(() => page('/Jump to cue/.test((document.querySelector(".toolstrip") || {}).textContent || "")'), 3000));
    const numbered = snap().rows.filter((r) => r.depth === 0 && r.number).at(-1);
    check('a jump moves the playhead', !host.cmd({ op: 'jump', number: numbered!.number }).error && snap().engine.playhead === numbered!.id, numbered);
    win.webContents.send('ec-menu', 'tool-renumber');
    check('Renumber opens', await until(() => page('/Renumber/.test((document.querySelector(".toolstrip") || {}).textContent || "")'), 3000));
    win.webContents.send('ec-menu', 'tool-renumber');
    const key = (k: string) => page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
    await until(() => page('!document.querySelector(".toolstrip")'), 2000);
    await key('e');
    // (the box must hold the keyboard before it is blurred: a blur before its focus lands ends nothing, and the focus
    // that lands afterwards swallows the keys below)
    check('E edits the pre-wait in place', await until(() => page('(() => { const i = document.querySelector(".list td.c-time input.inline"); return !!i && document.activeElement === i; })()'), 3000));
    await page('document.querySelector(".list td.c-time input.inline").blur()');
    await until(() => page('!document.querySelector(".list input.inline")'), 2000);
    const wasCont = host.document.doc.lists[0].cues.find((c) => c.id === numbered!.id)!.continue || 'none';
    await key('c');
    check('C cycles the continue mode', await until(() => (host.document.doc.lists[0].cues.find((c) => c.id === numbered!.id)!.continue || 'none') !== wasCont, 3000));
    host.cmd({ op: 'undo' });
    await key('o');
    check('O puts the keyboard in the notes', await until(() => page('document.activeElement && document.activeElement.tagName === "TEXTAREA"'), 3000));
    await page('document.activeElement.blur()');
    host.cmd({ op: 'go' });
    check('GO shows as locked while double-GO protection holds', snap().goLock > 0);
    host.cmd({ op: 'panic', hard: true });
    // a QLab workspace opens as a new, unsaved show, with the report of what came across
    const qlab = (require('./test-media') as typeof import('./test-media')).fixture('small.qlab5');
    if (!qlab) log('SMOKE skip  a QLab workspace: no test workspace here (a packaged build; EC_FIXTURES names it)');
    if (qlab) {
      const { importQlab } = require('../../core/import/qlab');
      const imp = importQlab(fs.readFileSync(qlab), { file: qlab });
      host.openImported(imp.doc, imp.report);
      check('a QLab workspace opens as an untitled show', snap().show.title === 'Small Show' && snap().show.untitled && snap().rows.length >= 20, snap().rows.length);
      check('the page says what came across', await until(() => page('/Video cue/.test((document.querySelector(".welcome.imported") || {}).textContent || "")'), 3000));
      await shot('8-imported-from-qlab');
      host.cmd({ op: 'import-seen' });
      check('…and the list is the workspace’s', await until(() => page('!document.querySelector(".welcome.imported") && document.querySelectorAll(".list tbody tr").length >= 18'), 3000));
    }
    // the cue list's own tools on a playing sound: a loop of any length, its level for this playing only
    host.openUntitled(); host.open(dir);
    await until(() => snap().mixer.audioReady && snap().rows.length >= 10);
    // (a plain show, as the app comes: smoke-defaults.ts)
    await part('smoke-defaults', async () => { await (require('./smoke-defaults') as typeof import('./smoke-defaults')).plain({ host, check, page }); });
    const clip = host.document.doc.lists[0].cues.find((c) => c.type === 'audio')!;
    host.cmd({ op: 'fire', id: clip.id });
    await until(() => snap().engine.active.some((a) => a.id === clip.id), 4000);
    host.cmd({ op: 'loop', id: clip.id, region: { start: 1, end: 3 }, free: true });
    check('a loop of any length is armed on a playing sound', (snap().engine.active.find((a) => a.id === clip.id) || { armed: [] }).armed!.length === 1);
    check('…and the sound, which was streaming, is decoded so that it can go round', await until(() => snap().engine.active.find((x) => x.id === clip.id)?.exact === true, 5000), snap().engine.active.find((x) => x.id === clip.id));
    host.cmd({ op: 'level', id: clip.id, db: -12 });
    check('a playing sound’s level moves that sound only', await until(() => snap().engine.active.find((a) => a.id === clip.id)?.db === -12, 2000) && host.document.doc.lists[0].cues.find((c) => c.id === clip.id)!.gainDb !== -12);
    host.cmd({ op: 'panic', hard: true });
    // tempo: a made click track at 120, found from its sound and kept in the cue
    const { writeWav } = require('../../examples/make-demo');
    const clickFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-click-')), 'click120.wav');
    { const n = 44100 * 20, x = new Float32Array(n); for (let i = 0; i < n; i++) { const p = ((i / 44100) - 0.25 + 0.5) % 0.5; x[i] = Math.exp(-p / 0.04) * Math.sin(2 * Math.PI * 70 * p) * 0.8; } writeWav(clickFile, x); }
    const made = host.cmd({ op: 'import', paths: [clickFile], bus: 'music' }) as HostResult;
    const clickId = made && made.made && made.made[0];
    check('a sound is added on the bus asked for', !!clickId && host.document.doc.lists[0].cues.some((c) => c.id === clickId && c.bus === 'music'), made);
    const foundTempo = await host.cmd({ op: 'tempo-find', ids: [clickId] });
    const kept = (host.document.doc.lists[0].cues.find((c) => c.id === clickId) || {}).tempo;
    check('its tempo is found from its sound and kept in the cue', foundTempo.found === 1 && kept && Math.abs(kept.bpm - 120) < 0.05 && Math.abs(kept.first - 0.25) < 0.02, [foundTempo, kept]);
    host.cmd({ op: 'undo' }); host.cmd({ op: 'undo' });
    check('undone, the sound is gone again', !host.document.doc.lists[0].cues.some((c) => c.id === clickId));
    // outputs: a bus sent to another pair of the device's outputs plays there and not on 1–2 (the test run's device pretends to have eight)
    host.cmd({ op: 'panic', hard: true });
    const busAt = host.document.doc.settings.audio.buses.findIndex((b) => b.id === 'effects');
    const fx = host.document.doc.lists[0].cues.find((c) => c.type === 'audio' && (c.bus || 'effects') === 'effects' && !c.loop)!;
    host.cmd({ op: 'edit', ops: [{ op: 'show.set', path: `settings.audio.buses.${busAt}.out`, value: 3 }], label: 'outputs' });
    host.cmd({ op: 'fire', id: fx.id });
    check('a bus sent to outputs 3–4 plays there, and not on 1–2', await until(() => { const o = snap().mixer.outPeaks; return o[1] > -50 && o[0] <= -59; }, 4000), snap().mixer.outPeaks);
    host.cmd({ op: 'edit', ops: [{ op: 'show.set', path: `settings.audio.buses.${busAt}.out`, value: 11 }], label: 'outputs' });
    check('a bus sent to outputs the device does not have is silent, and says so', await until(() => { const m = snap().mixer; return m.buses[busAt].noOutput && m.outPeaks.every((p) => p <= -59); }, 3000), snap().mixer);
    host.cmd({ op: 'panic', hard: true });
    host.cmd({ op: 'undo' }); host.cmd({ op: 'undo' });
    // MIDI: a cue's message goes out (recorded here: a test run opens no port), and one coming in fires the cue it is the trigger of
    const midiMade = host.cmd({ op: 'edit', ops: [{ op: 'cue.add', ref: 'm', cue: { type: 'midi', number: 'M1', midi: 'pc 12 ch 2', midiTrigger: 'note 60' }, list: host.document.doc.lists[0].id }], label: 'midi cue' });
    host.cmd({ op: 'net-clear' });
    host.midiIn([0x90, 60, 100], 'test keys');
    const mon = host.cmd({ op: 'net-monitor' }).entries.map((e: MonitorEntry) => `${e.dir} ${e.text}`);
    check('a MIDI message arriving fires the cue it triggers, and what that cue sends is in the monitor', mon.join('|') === 'in note 60 100 ch 1|out pc 12 ch 2   [C1 0C]', [mon, midiMade]);
    host.cmd({ op: 'undo' });
    // a Mic cue: a live input open on its bus until it is faded out (a test run opens no input: a steady signal stands in)
    const micMade = host.cmd({ op: 'edit', ops: [{ op: 'cue.add', ref: 'mic', cue: { type: 'mic', number: 'MIC1' }, list: host.document.doc.lists[0].id }, { op: 'cue.add', cue: { type: 'fade', target: '@mic', duration: 0.3, stopTarget: true, number: 'MIC2' }, list: host.document.doc.lists[0].id }], label: 'mic' });
    host.cmd({ op: 'fire', number: 'MIC1' });
    check('a Mic cue opens an input on its bus', await until(() => snap().engine.active.some((a) => a.mic) && (snap().mixer.buses.find((b) => b.id === 'vocals') || { peak: -Infinity }).peak > -40, 4000), [micMade, snap().mixer.buses]);
    host.cmd({ op: 'fire', number: 'MIC2' });
    check('…and a Fade takes it out and closes it', await until(() => !snap().engine.active.some((a) => a.mic), 3000));
    host.cmd({ op: 'undo' });
    // ducking by kind: with the vocals bus (a voice) sounding (a Mic cue's stand-in signal), the music bus is dipped; when it stops, it comes back
    const duckSet = host.cmd({ op: 'edit', ops: [{ op: 'show.set', path: 'settings.audio.ducking', value: { on: true, under: { music: { depth: -8, attack: 0.05, hold: 0.1, release: 1, range: 'voice' } } } }, { op: 'cue.add', cue: { type: 'mic', number: 'DK1' }, list: host.document.doc.lists[0].id }], label: 'ducking' });
    host.cmd({ op: 'fire', number: 'DK1' });
    check('ducking: a bus dips while another is sounding', await until(() => snap().mixer.ducking === true, 4000), [duckSet, snap().mixer.ducking]);
    host.cmd({ op: 'stop', number: 'DK1' });
    check('…and comes back when it stops', await until(() => snap().mixer.ducking === false, 4000));
    host.cmd({ op: 'undo' });
    // recording: what the outputs get is written to a wav in the show folder (silence here, but a file of the right length)
    if (host.document.showDir) {
      const started = host.cmd({ op: 'record', on: true });
      await sleep(900);
      const stopped = host.cmd({ op: 'record', on: false }).stopped;
      check('a recording of the show is written to the show folder', !!(stopped && fs.existsSync(stopped.file) && fs.statSync(stopped.file).size > 44 + 20000 && fs.readFileSync(stopped.file).readUInt32LE(40) === fs.statSync(stopped.file).size - 44), [started, stopped]);
      if (stopped) fs.rmSync(path.dirname(stopped.file), { recursive: true, force: true });
    }
    // a drop-down left alone is not rewritten as the page redraws (it was, ten times a second: an open menu flickered and stuck)
    win.webContents.send('ec-menu', 'settings');
    await page(`(async () => { for (let i = 0; i < 40 && !document.querySelector('.modal'); i++) await new Promise((r) => setTimeout(r, 50)); const b = [...document.querySelectorAll('.modal nav button')].find((x) => x.textContent === 'Audio'); if (b) b.click(); })()`);
    await sleep(300);
    const muts = await page<{ selects: number; n: number }>(`(async () => { let n = 0; const sels = [...document.querySelectorAll('.modal select')]; const o = new MutationObserver((l) => { n += l.length; }); for (const s of sels) o.observe(s, { subtree: true, childList: true, characterData: true, attributes: true }); await new Promise((r) => setTimeout(r, 1200)); o.disconnect(); return { selects: sels.length, n }; })()`);
    check('drop-downs are left alone while the page redraws', muts.selects > 0 && muts.n === 0, muts);
    await page(`(() => { const b = [...document.querySelectorAll('.modal nav button')].find((x) => x.textContent === 'Keys'); if (b) b.click(); })()`);
    await sleep(200);
    // the keys: P is given to X; X then pauses the selected cue and P does nothing; Reset all puts it back
    await page(`[...document.querySelectorAll('.keyrow')].find((r) => /Pause \\/ resume the selected cue/.test(r.textContent)).querySelector('button.keycap').click()`);
    await sleep(150);
    await key('x');
    check('a key can be changed in Settings ▸ Keys', await until(() => page(`[...document.querySelectorAll('.keyrow')].find((r) => /Pause \\/ resume the selected cue/.test(r.textContent)).querySelector('button.keycap').textContent`).then((t) => t === 'X'), 3000));
    await page(`document.querySelector('.modal .close').click()`);
    await page(`[...document.querySelectorAll('.keybar button')].forEach(() => {})`);
    win.webContents.send('ec-menu', 'settings');
    await sleep(300);
    await page(`(() => { const b = [...document.querySelectorAll('.modal nav button')].find((x) => x.textContent === 'Keys'); if (b) b.click(); })()`);
    await sleep(200);
    await page(`document.querySelector('.keybar button').click()`);
    check('…and Reset all puts every key back', await until(() => page(`[...document.querySelectorAll('.keyrow')].find((r) => /Pause \\/ resume the selected cue/.test(r.textContent)).querySelector('button.keycap').textContent`).then((t) => t === 'P'), 3000));
    await page(`document.querySelector('.modal .close').click()`);
    // Find (⌘F): a word in a cue's name selects it
    win.webContents.send('ec-menu', 'tool-find');
    await until(() => page(`!!document.querySelector('.toolstrip input')`), 2000);
    await page(`(() => { const i = document.querySelector('.toolstrip input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'thunder'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    check('Find selects the cue whose name has the word', await until(() => page(`[...document.querySelectorAll('.list tr.sel')].some((r) => /thunder/i.test(r.textContent))`), 3000));
    await key('Escape');
    // ── the editing tools: related cues, the clipboard, Paste Cue Properties, a cue dropped on a cue, flags, notes in
    // the masthead, an unlocked playhead, a colour once played, row sizes, templates, numbering, two versions compared ──
    {
      const showLib = require('../../core/show/show');
      const undoTo = host.document.undoStack.length;
      const menu = (action: string) => win.webContents.send('ec-menu', action);
      const rowJs = (name: string) => `[...document.querySelectorAll('.list tbody tr')].find((r) => r.querySelector('.c-name') && r.querySelector('.c-name').textContent.trim().startsWith(${JSON.stringify(name)}))`;
      const clickRow = async (name: string) => { await page(`${rowJs(name)}.click()`); await sleep(120); };
      const idOf = (name: string) => snap().rows.find((r) => r.name === name)!.id;
      const cueOf = (id: string) => showLib.index(host.document.doc).byId.get(id);
      const set = (id: string, props: Partial<Cue>) => host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id, props }] });
      // (the Find box may still hold the keyboard: a key sent to the window does not reach it)
      await page(`document.activeElement && document.activeElement.blur()`);
      await key('Escape');
      await until(() => page(`!document.querySelector('.toolstrip')`), 2000);
      await key('>');
      const rainId = idOf('Rain'), thunderId = idOf('Thunder'), outId = idOf('Rain out'), memoId = idOf('Interval');
      await clickRow('Rain out');
      check('the cue the selected cue is aimed at is marked in the list', await until(() => page(`${rowJs('Rain')}.classList.contains('rel-target')`), 3000));
      menu('tool-target');
      check('Go to Target selects it', await until(() => page(`${rowJs('Rain')}.classList.contains('sel')`), 3000));
      check('…and the cue that is aimed at it is marked', await until(() => page(`${rowJs('Rain out')}.classList.contains('rel-source')`), 3000));
      // copy Rain; paste one of its properties onto Thunder
      menu('edit-copy');
      check('Copy puts the cue on the host’s clipboard', await until(() => { const c = host.cmd({ op: 'clip-info' }).clip; return c && c.cue.id === rainId; }, 3000));
      set(thunderId, { gainDb: 1.5 });
      await clickRow('Thunder');
      menu('edit-paste-props');
      check('Paste Cue Properties asks which', await until(() => page(`document.querySelectorAll('.pasteprops .props input').length > 10`), 3000));
      await shot('8-paste-properties');
      await page(`(() => { [...document.querySelectorAll('.pasteprops .acts .btn')].find((b) => b.textContent === 'None').click(); })()`);
      await sleep(120);
      await page(`[...document.querySelectorAll('.pasteprops .props label')].find((l) => l.textContent === 'Level').querySelector('input').click()`);
      await sleep(120);
      await page(`document.querySelector('.pasteprops .btn.primary').click()`);
      check('…and only the chosen property lands', await until(() => cueOf(thunderId).gainDb === cueOf(rainId).gainDb, 3000) && cueOf(thunderId).name === 'Thunder' && !cueOf(thunderId).loop, cueOf(thunderId));
      // paste the copied cue after the memo
      await clickRow('Interval');
      menu('edit-paste');
      const after = () => { const l = host.document.doc.lists[0].cues; return l[l.findIndex((c) => c.id === memoId) + 1] || {}; };
      check('Paste makes the copied cue again after the selected one', await until(() => after().name === 'Rain' && after().id !== rainId, 3000) && after().file === cueOf(rainId).file, after());
      const rain2 = after().id;
      const r4 = host.cmd({ op: 'retarget', id: rain2, path: clickFile });
      check('a sound file given to an Audio cue becomes the file it plays', !r4.error && /click120/.test(cueOf(rain2).file) && cueOf(rain2).name === 'Rain', r4);
      // a cue dropped on the middle of a Fade becomes its target
      await page(`(async () => {
        const beat = () => new Promise((r) => setTimeout(r, 60));
        const from = ${rowJs('Thunder')}, to = ${rowJs('Rain out')}, b = to.getBoundingClientRect(), dt = new DataTransfer();
        const ev = (type) => new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: b.left + 300, clientY: b.top + b.height / 2, dataTransfer: dt });
        from.dispatchEvent(ev('dragstart')); await beat(); to.dispatchEvent(ev('dragover')); await beat(); to.dispatchEvent(ev('drop')); from.dispatchEvent(ev('dragend'));
      })()`);
      check('a cue dropped on a Fade becomes its target', await until(() => cueOf(outId).target === thunderId, 3000), cueOf(outId));
      // flags: counted in the footer, listed, and never folded out of sight
      set(rainId, { flagged: true });
      check('the footer counts the flagged cues', await until(() => page(`!!document.querySelector('.footer .flags')`), 3000));
      await key('<');
      check('a collapsed group that holds a flagged cue shows a hollow flag', await until(() => page(`!!document.querySelector('.list .flag.hollow')`), 3000));
      await page(`document.querySelector('.footer .flags').click()`);
      check('the footer’s count opens the list of flagged cues', await until(() => page(`document.querySelectorAll('.checks .check').length >= 1`), 3000));
      await shot('8b-flagged');
      await page(`[...document.querySelectorAll('.checks .check')].find((b) => /Rain/.test(b.textContent)).click()`);
      check('…and a click there goes to the cue, opening its group', await until(() => page(`(() => { const r = ${rowJs('Rain')}; return !!r && r.classList.contains('sel'); })()`), 3000));
      await key('Escape');
      await key('>');
      // notes typed in the masthead
      await clickRow('Interval');
      await until(() => page(`!!document.querySelector('.standby .addnote, .standby .notes.editable')`), 3000);
      await page(`document.querySelector('.standby .addnote, .standby .notes.editable').click()`);
      await until(() => page(`!!document.querySelector('.standby .notes-edit')`), 3000);
      await page(`(() => { const t = document.querySelector('.standby .notes-edit'); t.value = 'Hold for the house'; t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
      check('notes are typed in the masthead, in Edit mode', await until(() => cueOf(memoId).notes === 'Hold for the house', 3000) && await until(() => page(`(document.querySelector('.standby .notes') || {}).textContent === 'Hold for the house'`), 3000), cueOf(memoId));
      // the playhead unlocked from the selection
      host.cmd({ op: 'edit', ops: [{ op: 'show.set', path: 'settings.editing.lockPlayhead', value: false }] });
      await until(() => page(`document.querySelector('.list td.c-status').title !== ''`), 3000);
      await clickRow('Rain out');
      await sleep(250);
      check('with the playhead unlocked, selecting a cue leaves the playhead where it is', snap().engine.playhead === memoId && await page(`${rowJs('Rain out')}.classList.contains('sel')`), snap().engine.playhead);
      await page(`${rowJs('Rain out')}.querySelector('.c-status').click()`);
      check('…and a click on a cue’s left edge stands by on it', await until(() => snap().engine.playhead === outId, 3000));
      host.cmd({ op: 'edit', ops: [{ op: 'show.set', path: 'settings.editing.lockPlayhead', value: true }] });
      // a second colour, once the cue has played
      set(memoId, { color: 'indigo', color2: 'grey' });
      host.cmd({ op: 'fire', id: memoId });
      check('a cue that has played shows its second colour', await until(() => page(`!!${rowJs('Interval')}.querySelector('.swatch.played')`), 3000) && snap().engine.played.includes(memoId));
      // row sizes (this computer's)
      menu('settings');
      await until(() => page(`!!document.querySelector('.modal nav')`), 3000);
      await page(`document.querySelector('.modal nav [data-section="general"]').click()`);
      await until(() => page(`!!document.querySelector('.rowsize')`), 3000);
      await page(`[...document.querySelectorAll('.rowsize button')].find((x) => x.textContent === 'Compact').click()`);
      check('the list can be drawn with compact rows', await until(() => page(`!!document.querySelector('.list.rows-compact') && document.querySelector('.list tbody tr').getBoundingClientRect().height < 25`), 3000));
      await page(`[...document.querySelectorAll('.rowsize button')].find((x) => x.textContent === 'Normal').click()`);
      await until(() => page(`!document.querySelector('.list.rows-compact')`), 3000);
      await page(`document.querySelector('.modal .close').click()`);
      // a template, and numbering by a step: a new Fade starts like "Rain out", numbered by tens
      set(outId, { duration: 7.5 });
      host.cmd({ op: 'template', id: outId });
      host.cmd({ op: 'edit', ops: [{ op: 'show.set', path: 'settings.editing.numberStep', value: 10 }] });
      const n0 = host.document.doc.lists[0].cues.length;
      await clickRow(host.document.doc.lists[0].cues[n0 - 1].name || 'Blackout');
      const lastId = host.document.doc.lists[0].cues[n0 - 1].id, lastNumber = Number(host.document.doc.lists[0].cues[n0 - 1].number);
      await page(`[...document.querySelectorAll('.toolbar .tool')].find((b) => /Fade$/.test(b.textContent.trim())).click()`);
      const fresh = () => host.document.doc.lists[0].cues[n0] || {};
      check('a new cue starts from its type’s template', await until(() => fresh().type === 'fade' && fresh().duration === 7.5, 3000) && fresh().name === undefined, fresh());
      check('…and takes the next number, counting by the show’s step', Number.isFinite(lastNumber) ? Number(fresh().number) === (Math.floor(lastNumber / 10) + 1) * 10 : true, [lastId, lastNumber, fresh().number]);
      await page(`(() => { const el = document.activeElement; if (el && el.classList.contains('inline')) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()`);
      await sleep(150);
      menu('tool-unnumber');
      check('Delete Numbers takes the number off the selected cue', await until(() => fresh().type === 'fade' && fresh().number === undefined, 3000), fresh());
      // two saved versions compared with each other
      menu('versions');
      if (await until(() => page(`document.querySelectorAll('.version select.vs').length >= 2`), 3000)) {
        await page(`(() => { const s = document.querySelector('.version select.vs'); s.value = s.options[s.options.length - 1].value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        check('two saved versions are compared with each other', await until(() => page(`/From v\\d+ to v\\d+/.test(document.querySelector('.drawer-pane').textContent)`), 3000));
        await shot('8c-two-versions');
      } else check('two saved versions are compared with each other', false, 'fewer than two versions to choose from');
      menu('versions');
      // the show is left as these checks found it
      while (host.document.undoStack.length > undoTo) host.cmd({ op: 'undo' });
      await sleep(200);
    }
    // where sound goes: a cue's own outputs, four-channel files, audition, trims, the effects (smoke-routing.ts)
    await part('smoke-routing', async () => { await (require('./smoke-routing') as typeof import('./smoke-routing')).routingChecks({ host, check, until, sleep, page, win, shot }); });
    // sequencing: a list with a playhead of its own that a Start cue GOes, a cue that ducks the others, a Mix cue on the mixer, = and -
    host.cmd({ op: 'panic', hard: true });
    const L0 = host.document.doc.lists[0].id;
    const seqMade = host.cmd({ op: 'edit', ops: [
      { op: 'list.add', name: 'Second' },
      { op: 'cue.add', cue: { type: 'mic', number: 'SQ1', name: 'Bed', bus: 'music' }, list: 'Second' },
      { op: 'cue.add', cue: { type: 'memo', number: 'SQ2' }, list: 'Second' },
      { op: 'cue.add', cue: { type: 'start', number: 'SQ3', target: 'list:Second' }, list: L0 },
      { op: 'cue.add', cue: { type: 'mic', number: 'SQ4', name: 'Line', duckOthers: -12, duckTime: 0.2 }, list: L0 },
      { op: 'cue.add', cue: { type: 'mix', number: 'SQ5', levels: { music: -9 }, duration: 0.2 }, list: L0 },
      { op: 'cue.add', cue: { type: 'memo', number: 'SQ6', continue: 'auto-continue' }, list: L0 },
      { op: 'cue.add', cue: { type: 'memo', number: 'SQ7' }, list: L0 },
      { op: 'cue.add', cue: { type: 'memo', number: 'SQ8' }, list: L0 },
    ], label: 'sequencing' });
    const sq = (n: string) => { let hit: string | null = null; for (const l of host.document.doc.lists) for (const c of l.cues) if (c.number === n) hit = c.id; return hit; };
    check('a Start cue can be aimed at a cue list, and the list shows as its target', await until(() => page(`[...document.querySelectorAll('.list tbody tr')].some((r) => /SQ3/.test(r.textContent) && /the list Second/.test(r.textContent))`), 3000), [seqMade, snap().problems]);
    host.cmd({ op: 'fire', number: 'SQ3' });
    check('…and is that list’s GO: it runs off screen, on its own playhead', await until(() => { const l = snap().engine.lists.find((x) => x.name === 'Second'); return l && l.live === 1 && l.playhead === sq('SQ2') && snap().engine.listName !== 'Second'; }, 3000), snap().engine.lists);
    check('the list selector marks the list that is running', await until(() => page(`[...document.querySelectorAll('select option')].some((o) => /Second ▶/.test(o.textContent))`), 3000));
    const under = (id: string | null) => host.audioWindow()!.webContents.executeJavaScript(`(() => { const v = voices.get(${JSON.stringify(id)}); return v ? (v.under ? v.under.gain.value : 1) : null; })()`, true);
    host.cmd({ op: 'fire', number: 'SQ4' });
    check('a cue ducks the others while it runs (and not itself)', await until(async () => (await under(sq('SQ1'))) < 0.3 && (await under(sq('SQ4'))) === 1 && snap().engine.active.some((x) => x.id === sq('SQ1') && x.duck === -12), 4000), [await under(sq('SQ1')), await under(sq('SQ4'))]);
    check('…which Active cues shows beside the sound’s level', await until(() => page(`[...document.querySelectorAll('.lvl')].some((x) => /▾12/.test(x.textContent))`), 3000));
    host.cmd({ op: 'stop', number: 'SQ4' });
    check('…and they come back when it ends', await until(async () => (await under(sq('SQ1'))) > 0.9, 4000), await under(sq('SQ1')));
    // a Mix cue's fader move is heard and is shown on the mixer, until a hand is put on the knob (the Bed is sounding on that bus)
    // (the native engine's faders are not the window's to read: null, and the checks on them fail as such)
    const fader = () => (onNative() ? Promise.resolve(null) : host.audioWindow()!.webContents.executeJavaScript(`buses.music.fader.gain.value`, true));
    host.cmd({ op: 'fire', number: 'SQ5' });
    check('a Mix cue moves the bus fader', await until(async () => Math.abs(20 * Math.log10(await fader()) + 9) < 1, 4000), await fader());
    check('…and the mixer shows where the cue put it', await until(() => (snap().mixer.buses.find((b) => b.id === 'music') || {}).live === -9, 2000) && await until(() => page(`[...document.querySelectorAll('.knobs *')].some((x) => /Music ·mix/.test(x.textContent))`), 3000), snap().mixer.buses);
    host.cmd({ op: 'bus', name: 'music', db: Number((host.document.doc.settings.audio.buses.find((b) => b.id === 'music') || {}).db) || 0 });
    check('…until a hand is on the knob', await until(() => (snap().mixer.buses.find((b) => b.id === 'music') || {}).live === undefined, 2000));
    const loadedTo = host.cmd({ op: 'load', number: 'SQ1', secs: 5 });
    check('a cue that is not standing by can be loaded to a time', loadedTo.loaded && loadedTo.loaded.at === 5 && snap().engine.loads[sq('SQ1')!] === 5, loadedTo);
    host.cmd({ op: 'reset', number: 'SQ1' });
    check('one cue can be reset: stopped and unloaded, the rest untouched', await until(() => !snap().engine.active.some((x) => x.id === sq('SQ1')) && !snap().engine.loads[sq('SQ1')!], 3000) && snap().engine.lists.find((x) => x.name === 'Second')!.playhead === sq('SQ2'), snap().engine.loads);
    // = and -: the playhead by sequence, past what continues by itself
    host.cmd({ op: 'playhead', id: sq('SQ5') });
    await page(`document.activeElement && document.activeElement.blur()`);
    await key('='); await sleep(150); await key('=');
    check('= moves the playhead to the next cue that needs a GO', await until(() => snap().engine.playhead === sq('SQ8'), 3000), snap().engine.playhead);
    await key('-');
    check('- moves it back to the one before', await until(() => snap().engine.playhead === sq('SQ6'), 3000), snap().engine.playhead);
    host.cmd({ op: 'playhead', id: null });
    check('the playhead can be on no cue: GO does nothing', snap().engine.playhead === null && (await sleep(400), host.cmd({ op: 'go' }), snap().engine.active.length === 0), snap().engine);
    host.cmd({ op: 'panic', hard: true });
    host.cmd({ op: 'undo' });
    // the stage: Video, Text and Camera cues, drawn offscreen and read back as pixels (smoke-video.ts)
    await part('smoke-video', async () => { await (require('./smoke-video') as typeof import('./smoke-video')).run({ host, check, until, sleep, log, shot: async (name: string) => { if (!shots) return; fs.mkdirSync(shots, { recursive: true }); await sleep(200); fs.writeFileSync(path.join(shots, `${name}.png`), (await host.stage.window()!.webContents.capturePage()).toPNG()); } }); });
    // the app's own lights: a patch, a Light cue that holds levels, the dashboard. A test run makes every packet and sends none
    // (and the universes here are aimed at this computer itself, so a run with real ports open reaches no network either)
    {
      const artnet = require('../../core/light/artnet');
      const sacn = require('../../core/light/sacn');
      host.cmd({ op: 'mode', mode: 'edit' });
      host.cmd({ op: 'edit', label: 'smoke lights', ops: [
        { op: 'show.set', path: 'settings.light', value: { on: true, rate: 40, panicBlackout: false, fixtures: [],
          universes: [{ id: 1, protocol: 'artnet', address: 0, host: '127.0.0.1' }, { id: 2, protocol: 'sacn', address: 1, host: '127.0.0.1' }],
          instruments: [{ name: 'front', fixture: 'dimmer', universe: 1, address: 1 }, { name: 'cyc', fixture: 'rgb', universe: 1, address: 10 }, { name: 'spot', fixture: 'mover-16', universe: 2, address: 1 }],
          groups: [{ name: 'wash', members: ['front', 'cyc'] }] } },
        { op: 'cue.add', ref: 'lx', cue: { type: 'light', number: 'LX1', levels: 'front = 100\ncyc = 50\ncyc.colour = #ff8000\nspot.pan = 25', duration: 0.4 } },
      ] });
      const lx = snap().doc.lists.flatMap((l) => l.cues).find((c) => c.number === 'LX1')!;
      const light = () => snap().light;
      const levelOf = (name: string) => (light().instruments.find((i) => i.name === name) || {}).level;
      check('a show with a light patch has its instruments, and no problems with them', light().instruments.length === 3 && light().problems.length === 0 && !snap().problems.some((p) => p.id === lx.id), light().problems);
      host.cmd({ op: 'fire', id: lx.id });
      check('a Light cue is a fade in Active Cues while its levels move', snap().engine.active.some((a) => a.id === lx.id && a.kind === 'fade'));
      check('…and lands on its levels', await until(() => levelOf('front') === 100 && levelOf('cyc') === 50, 3000), [levelOf('front'), levelOf('cyc')]);
      await sleep(80);
      const dmx = () => artnet.parseDmx(host.lighting.output.last(1));
      check('the Art-Net packet for its universe carries those levels', !!dmx() && dmx().universe === 0 && dmx().data.length === 512 && dmx().data[0] === 255 && dmx().data[9] === 128 && dmx().data[10] === 64 && dmx().data[11] === 0, dmx() && [...dmx().data.subarray(0, 12)]);
      const acn = sacn.parse(host.lighting.output.last(2));
      check('…and the sACN packet for the other, with a 16-bit pan', !!acn && acn.universe === 1 && acn.data[1] === 0x40 && acn.data[2] === 0x00, acn && [...acn.data.subarray(0, 5)]);
      // (counted over a second, against the clock: a slow machine's timers run late, but the refresh never stops)
      const sentBefore = light().packets, t0 = Date.now();
      await sleep(1000);
      const sent = light().packets - sentBefore, secs = (Date.now() - t0) / 1000;
      check('the universes are refreshed steadily, changed or not', sent >= 15 * secs, { sent, secs });
      if (!process.argv.includes('--net')) check('a test run sends none of it (packets are made, no socket is opened)', light().dryRun === true);
      // the dashboard, in the window
      win.webContents.send('ec-menu', 'lights');
      check('the Lights dashboard shows every instrument and group at its level', await until(() => page(`(() => { const row = (n) => document.querySelector('.lights .lx-row[data-light="' + n + '"]'); return !!row('front') && !!row('wash') && row('front').querySelector('input[type=text]').value === '100' && !!row('cyc').querySelector('.lx-swatch'); })()`), 3000));
      check('an instrument’s colour swatch is its own colour', await page(`getComputedStyle(document.querySelector('.lights .lx-row[data-light="cyc"] .lx-swatch')).backgroundColor`) === 'rgb(255, 128, 0)');
      await page(`(() => { const i = document.querySelector('[data-light-command]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'front = 30'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(120);
      await page(`document.querySelector('[data-light-command]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
      check('a light command typed in the dashboard moves the level, and marks it as changed by hand', await until(() => levelOf('front') === 30 && light().changed === 1 && page(`!!document.querySelector('.lights .lx-row[data-light="front"] .lx-level.manual')`), 3000), [levelOf('front'), light().changed]);
      await shot('9-lights');
      await page(`document.querySelector('[data-light-record="changes"]').click()`);
      check('New cue: changes records it as a Light cue after the selection', await until(() => snap().doc.lists.flatMap((l) => l.cues).some((c) => c.type === 'light' && c.levels === 'front = 30') && light().changed === 0, 3000));
      await page(`document.querySelector('[data-light-blackout]').click()`);
      check('Blackout takes the intensities out on the wire and says so in the title bar', await until(() => light().blackout && dmx().data[0] === 0 && dmx().data[9] === 0 && page(`[...document.querySelectorAll('.titlebar .chip')].some((c) => c.textContent === 'LIGHTS BLACKOUT')`), 3000), dmx() && dmx().data[0]);
      check('…and leaves the levels underneath', levelOf('front') === 30);
      host.cmd({ op: 'light-blackout', on: false });
      host.cmd({ op: 'panic' });
      await sleep(120);
      check('Panic does not black the stage out', levelOf('front') === 30 && dmx().data[0] === 77, [levelOf('front'), dmx().data[0]]);
      win.webContents.send('ec-menu', 'settings');
      await page(`(async () => { for (let i = 0; i < 40 && !document.querySelector('.modal'); i++) await new Promise((r) => setTimeout(r, 50)); document.querySelector('.modal nav [data-section="integrations"]').click(); await new Promise((r) => setTimeout(r, 0)); const b = document.querySelector('.modal .settings-subtabs [data-section="light"]'); if (b) b.click(); })()`);
      check('Settings ▸ Integrations ▸ Light draws the universes and the patch', await until(() => page(`document.querySelectorAll('.modal .lx-patch:not(.head):not(.group)').length === 3 && document.querySelectorAll('.modal .lx-patch.group').length === 1 && /Universe 2/.test(document.querySelector('.modal').textContent)`), 3000));
      await shot('9-light-settings');
      // a universe out of a USB DMX interface: chosen in the window, its frame made, and no port opened (a test run has none)
      await page(`document.querySelectorAll('.modal [data-light-protocol="usb"]')[1].click()`);
      check('a universe set to USB asks which interface and which port', await until(() => page(`!!document.querySelector('.modal [data-light-usb-kind]') && document.querySelector('.modal [data-light-usb-kind]').options.length === 2`), 3000) && snap().doc.settings.light.universes[1].protocol === 'usb', snap().doc.settings.light.universes[1]);
      const usbFrame = () => host.lighting.output.last(2);
      check('…and its levels are made into the frame an Enttec Pro takes', await until(() => { const f = usbFrame(); return !!f && f.length === 518 && f[0] === 0x7e && f[1] === 6 && f[6] === 0x40 && f[517] === 0xe7; }, 3000), usbFrame() && [...usbFrame()!.subarray(0, 8)]);
      await shot('9-light-settings-usb');
      host.cmd({ op: 'edit', ops: [{ op: 'show.set', path: 'settings.light.universes', value: snap().doc.settings.light.universes.map((u) => (u.id === 2 ? { id: 2, protocol: 'sacn', address: 1, host: '127.0.0.1' } : u)) }], label: 'universe' });
      await page(`document.querySelector('.modal .close').click()`);
      win.webContents.send('ec-menu', 'lights');
      host.cmd({ op: 'edit', ops: [{ op: 'show.set', path: 'settings.light.on', value: false }] });
      check('with Send DMX off nothing more is made', await (async () => { await sleep(80); const n = light().packets; await sleep(200); return light().packets === n && light().sending === false; })());
    }
    // the network: a show command from an OSC message, a patch's second destination, and who may do what over OSC
    win.webContents.send('ec-menu', 'settings');
    await until(() => page('!!document.querySelector(".modal")'));
    await page(`(async () => { document.querySelector('.modal nav [data-section="integrations"]').click(); await new Promise((r) => setTimeout(r, 0)); document.querySelector('.modal .settings-subtabs [data-section="network"]').click(); })()`);
    check('Settings ▸ Integrations ▸ Network has an OSC message for each show command, with Capture', await until(() => page(`document.querySelectorAll('[data-osc-command]').length === 6 && [...document.querySelectorAll('[data-osc-command] button')].every((b) => b.textContent === 'Capture')`), 3000));
    host.cmd({ op: 'edit', ops: [{ op: 'show.set', path: 'settings.network.commands.go', value: '/box/1' }], label: 'OSC go' });
    check('…and one that is set shows there, and opens the input port', await until(() => page(`document.querySelector('[data-osc-command="go"] input').value === '/box/1' && /a message is set to a show command/.test(document.querySelector('.modal .pane').textContent)`), 3000));
    await page(`document.querySelector('[data-add-destination]').click()`);
    check('a patch takes a second destination, and can choose the interface it leaves by', await until(() => page(`!!document.querySelector('[data-destination="0"]') && document.querySelector('[data-iface]').options.length >= 1`), 3000) && (snap().doc.settings.network.patches[0].destinations || []).length === 1, snap().doc.settings.network.patches[0]);
    host.cmd({ op: 'edit', ops: [{ op: 'show.set', path: 'settings.network.patches', value: snap().doc.settings.network.patches.map((p, i) => (i ? p : { ...p, destinations: undefined })) }, { op: 'show.set', path: 'settings.network.commands.go', value: '' }, { op: 'show.set', path: 'modules.osc-control.enabled', value: true }], label: 'network' });
    await page(`(async () => { document.querySelector('.modal nav [data-section="integrations"]').click(); await new Promise((r) => setTimeout(r, 0)); document.querySelector('.modal .settings-subtabs [data-section="modules"]').click(); })()`);
    check('OSC control shows who may do what: with no passcode yet, everyone may view and run the show, and edit cannot be ticked', await until(() => page(`(() => { const r = document.querySelector('[data-access-row="none"]'); if (!r) return false; const b = (l) => r.querySelector('[data-level="' + l + '"]'); return b('view').checked && b('control').checked && !b('edit').checked && b('edit').disabled; })()`), 3000));
    await page(`document.querySelector('[data-add-passcode]').click()`);
    check('Add a passcode makes a four-digit one, and closes the door to senders without it', await until(() => { const m = snap().doc.modules['osc-control']; return (m.passcodes || []).length === 1 && /^\d{4}$/.test(m.passcodes![0].code) && m.noPasscode && !m.noPasscode.control; }, 3000), snap().doc.modules['osc-control']);
    check('…and the page shows it so', await until(() => page(`!!document.querySelector('[data-access-row="0"]') && [...document.querySelector('[data-access-row="none"]').querySelectorAll('input')].every((i) => !i.checked)`), 3000));
    await shot('9-osc-access');
    await page(`document.querySelector('.modal .close').click()`);
    // ── timecode and the rest of MIDI ──────────────────────────────────────────────────────────────────────
    // (a test run opens no MIDI port: what would be sent, and the time each message is due, is read from the host)
    {
      const tcLib = require('../../core/timecode/timecode');
      const list0 = host.document.doc.lists[0].id;
      const mon = (): string[] => host.cmd({ op: 'net-monitor' }).entries.map((e: MonitorEntry) => `${e.dir} ${e.text}`);
      host.cmd({ op: 'mode', mode: 'edit' });
      host.cmd({ op: 'panic', hard: true });
      // a Timecode cue as MTC: a full frame where it starts, then quarter frames a hundredth of a second apart (25 fps) that read back as the time
      const made = host.cmd({ op: 'edit', ops: [{ op: 'cue.add', ref: 't', cue: { type: 'timecode', number: 'TC1', timecode: '01:00:00:00', fps: '25' }, list: list0 }], label: 'timecode cue' });
      const tcId = made.refs && made.refs.t;
      host.played().length = 0;
      host.cmd({ op: 'fire', number: 'TC1' });
      check('a Timecode cue runs, and says the time it is sending', await until(() => ((snap().timecode.out[0] || {}).text || '') > '01:00:00:10' && snap().engine.active.some((a) => a.run === 'timecode'), 3000), [made, snap().timecode]);
      const sentTc = host.played().filter((e) => e.id === tcId);
      const quarters = sentTc.filter((e) => e.bytes[0] === 0xf1);
      const gaps = quarters.slice(1).map((e, i) => e.at - quarters[i].at);
      const reader = new tcLib.MtcReader(), read = quarters.map((e) => reader.feed(e.bytes)).filter(Boolean);
      check('…as MTC: a full frame, then quarter frames each due exactly a quarter of a frame after the last, reading 01:00:00:00, :02, :04…',
        sentTc[0] && sentTc[0].bytes.join() === tcLib.fullFrame(tcLib.parse('01:00:00:00'), '25').join() && quarters.length > 30 && gaps.every((g) => Math.abs(g - 0.01) < 1e-6)
        && read.slice(0, 3).map((r) => tcLib.format(r.tc, r.rate)).join() === '01:00:00:00,01:00:00:02,01:00:00:04', [sentTc.slice(0, 3), gaps.slice(0, 5), read.slice(0, 3)]);
      host.cmd({ op: 'pause' });
      await sleep(250);
      const held = snap().timecode.out[0];
      await sleep(300);
      check('…a pause holds it where it is', held && held.paused && snap().timecode.out[0].text === held.text, [held, snap().timecode.out]);
      host.cmd({ op: 'resume' });
      host.cmd({ op: 'stop', number: 'TC1' });
      check('…and a stop ends it', await until(() => !snap().timecode.out.length && !snap().engine.active.some((a) => a.run), 2000), snap().timecode);
      // LTC: made as sound in the audio window, read back there, and chased: a cue with a timecode trigger fires as its time goes by
      const ltcMade = host.cmd({ op: 'edit', ops: [
        { op: 'show.set', path: 'settings.timecode.source', value: 'ltc' },
        { op: 'cue.set', id: tcId, props: { output: 'ltc', channel: 5, timecode: '10:00:00:00', fps: '29.97df' } },
        { op: 'cue.add', cue: { type: 'midi', number: 'TC2', midi: 'pc 9', timecodeTrigger: '10:00:00;20' }, list: list0 }], label: 'ltc' });
      host.cmd({ op: 'net-clear' });
      await sleep(300);
      host.cmd({ op: 'fire', number: 'TC1' });
      await timed('LTC made in the audio window is read back as the timecode sent, at its rate', await until(() => { const t = snap().timecode; return t.in && t.in.running && t.in.rate === '29.97df' && t.out[0] && Math.abs(tcLib.toFrames(tcLib.parse(t.in.text), '29.97df') - tcLib.toFrames(tcLib.parse(t.out[0].text), '29.97df')) <= 3; }, 5000), [ltcMade, snap().timecode]);
      check('…and a cue with a timecode trigger fires when the incoming timecode reaches it', await until(() => mon().some((l) => l.startsWith('out pc 9')) && tcLib.parse(snap().timecode.in!.text).s < 3, 4000), [mon(), snap().timecode.in]);
      // timecode out held back for a rehearsal: the LTC stops while the cue runs on, and let go it is back where the cue has got to
      const ltcTogether = () => { const t = snap().timecode; return !!(t.in && t.in.running && t.out[0]) && Math.abs(tcLib.toFrames(tcLib.parse(t.in.text), '29.97df') - tcLib.toFrames(tcLib.parse(t.out[0].text), '29.97df')) <= 3; };
      host.cmd({ op: 'override', what: 'timecode', on: true });
      check('Timecode out held back: the LTC stops, and the Timecode cue runs on', await until(() => snap().timecode.in && !snap().timecode.in!.running, 3000) && snap().engine.active.some((a) => a.run) && snap().timecode.out.length === 1, snap().timecode);
      await sleep(400);
      host.cmd({ op: 'override', what: 'timecode', on: false });
      await timed('…and let go, the LTC is back at the time the cue has got to', await until(ltcTogether, 4000), snap().timecode);
      host.cmd({ op: 'stop', number: 'TC1' });
      check('…and when it stops, the incoming timecode is seen to have stopped', await until(() => snap().timecode.in && !snap().timecode.in!.running, 2000), snap().timecode);
      host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: tcId, props: { channel: 11 } }], label: 'ltc out' });
      host.cmd({ op: 'fire', number: 'TC1' });
      check('LTC sent to an output the device does not have says so', await until(() => /LTC is not going out/.test(snap().notice), 3000), snap().notice);
      host.cmd({ op: 'stop', number: 'TC1' });
      // a MIDI File cue: a file written here plays out with each message due at its own time, and ends by itself
      if (host.document.showDir) {
        const be = (n: number, k: number) => Array.from({ length: k }, (_, i) => (n >> (8 * (k - 1 - i))) & 255);
        const track = [0, 0x90, 60, 100, 0x81, 0x70, 0x80, 60, 0, 0, 0x90, 64, 100, 0x81, 0x70, 0x80, 64, 0, 0, 0xff, 0x2f, 0];      // two notes, a quarter of a second each at 120 bpm (480 to the beat)
        fs.writeFileSync(path.join(host.document.showDir, 'media', 'two-notes.mid'), Buffer.from([...Buffer.from('MThd'), ...be(6, 4), ...be(0, 2), ...be(1, 2), ...be(480, 2), ...Buffer.from('MTrk'), ...be(track.length, 4), ...track]));
        const mf = host.cmd({ op: 'edit', ops: [{ op: 'cue.add', ref: 'mf', cue: { type: 'midifile', number: 'MF1', file: 'media/two-notes.mid' }, list: list0 }], label: 'midi file' });
        check('a MIDI File cue knows how long its file is', await until(() => Math.abs((snap().engine.durations['media/two-notes.mid'] || 0) - 0.5) < 0.001 && !snap().problems.length, 2000), [mf, snap().engine.durations, snap().problems]);
        host.played().length = 0;
        host.cmd({ op: 'fire', number: 'MF1' });
        check('…it runs for that long and ends by itself', snap().engine.active.some((a) => a.run === 'midifile') && await until(() => !snap().engine.active.some((a) => a.run), 2000), snap().engine.active);
        const notes = host.played().filter((e) => e.id === mf.refs.mf);
        check('…and its messages were handed over each due at its own time', notes.map((e) => e.bytes.join(' ')).join('|') === '144 60 100|128 60 0|144 64 100|128 64 0' && notes.map((e) => Math.round((e.at - notes[0].at) * 1000)).join() === '0,250,250,500', notes);
        host.cmd({ op: 'undo' });
      }
      // a MIDI cue fades a controller: every value on the way, in the monitor
      host.cmd({ op: 'edit', ops: [{ op: 'cue.add', cue: { type: 'midi', number: 'MFD', midi: 'cc 7 100', fadeTo: 96, duration: 0.4, clockTrigger: '03:04:05' }, list: list0 }], label: 'midi fade' });
      host.cmd({ op: 'net-clear' });
      host.cmd({ op: 'fire', number: 'MFD' });
      check('a MIDI cue fades a controller: each value on the way is sent once', await until(() => mon().join('|') === [100, 99, 98, 97, 96].map((v) => `out cc 7 ${v}   [B0 07 ${v.toString(16).toUpperCase()}]`).join('|'), 2000), mon());
      // …and its clock trigger fires it when the time comes (the time is handed in: nobody waits until three in the morning)
      host.cmd({ op: 'net-clear' });
      host.checkClock(new Date(2030, 0, 4, 3, 4, 4));
      const early = mon().length;
      host.checkClock(new Date(2030, 0, 4, 3, 4, 5));
      host.checkClock(new Date(2030, 0, 4, 3, 4, 6));
      check('a clock trigger fires its cue at its time, once, and not before', early === 0 && await until(() => mon().filter((l) => l.startsWith('out cc 7 100')).length === 1, 2000) && mon().filter((l) => l.startsWith('out cc 7 100')).length === 1, [early, mon()]);
      host.cmd({ op: 'stop', number: 'MFD' });
      // MIDI Show Control LOAD puts the playhead on the cue it names
      host.cmd({ op: 'edit', ops: [{ op: 'show.set', path: 'settings.midi.mscIn', value: true }, { op: 'cue.set', id: '#MFD', props: { number: '77' } }], label: 'msc' });
      const first = host.document.doc.lists[0].cues[0].id;
      host.cmd({ op: 'playhead', id: first });
      host.midiIn([0xf0, 0x7f, 0x7f, 0x02, 0x01, 0x05, 0x37, 0x37, 0xf7], 'desk');
      check('show control LOAD puts the playhead on the cue it names', snap().engine.playhead === (host.document.doc.lists[0].cues.find((c) => c.number === '77') || {}).id, snap().engine.playhead);
      host.cmd({ op: 'playhead', id: first });
      // the Triggers tab, and the table of every trigger in the show
      host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: '#77', props: { hotkey: 'shift+7', midiTrigger: 'note 60' } }, { op: 'cue.set', id: '#TC2', props: { hotkey: 'shift+7' } }], label: 'triggers' });
      await until(() => page(`(() => { const r = [...document.querySelectorAll('.list tbody tr')].find((x) => /cc 7 100/.test(x.textContent)); if (r && !r.classList.contains('sel')) r.click(); return !!r && r.classList.contains('sel'); })()`), 3000);
      await page(`(() => { const b = [...document.querySelectorAll('.inspector .tabs button')].find((x) => /^Triggers/.test(x.textContent)); if (b) b.click(); })()`);
      check('the inspector has a Triggers tab with the cue’s triggers, and says what else one of them would set off',
        await until(() => page(`(() => { const tab = [...document.querySelectorAll('.inspector .tabs button')].find((x) => /^Triggers/.test(x.textContent)); const f = (k) => document.querySelector('.inspector [data-field="' + k + '"] input'); return !!tab && tab.textContent === 'Triggers (3)' && tab.classList.contains('on') && ['hotkey', 'oscTrigger', 'midiTrigger', 'clockTrigger', 'timecodeTrigger'].every(f) && f('hotkey').value === 'shift+7' && /The hotkey shift\\+7 is also TC2/.test(document.querySelector('.inspector').textContent); })()`), 3000),
        await page(`document.querySelector('.inspector') && document.querySelector('.inspector').textContent.slice(0, 600)`));
      await shot('9-triggers-tab');
      // a field whose name does not say it all has an ⓘ: a click shows its line, a click elsewhere puts it away; nothing on hover
      const tabBtn = (re: string) => `[...document.querySelectorAll('.inspector .tabs button')].find((x) => ${re}.test(x.textContent))`;
      await page(`${tabBtn('/^Basics/')}.click()`);
      const infoOk = await until(() => page(`(() => { const i = document.querySelector('.inspector [data-field="armed"] [data-info]'); return !!i && !document.querySelector('.inspector [data-field="name"] [data-info]'); })()`), 6000);
      await page(`(() => { const i = document.querySelector('.inspector [data-field="armed"] [data-info]'); if (i) i.click(); })()`);
      const popped = await until(() => page(`(() => { const p = document.querySelector('.inspector [data-field="armed"] .info-pop'); return !!p && /GO skips it/.test(p.textContent); })()`), 6000);
      await shot('9-field-info');
      await page(`document.querySelector('.inspector .tabs').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
      const closed = await until(() => page(`!document.querySelector('.inspector .info-pop')`), 6000);
      check('Armed has an ⓘ (Name has none); a click shows its line, a click elsewhere puts it away', infoOk && popped && closed,
        [infoOk, popped, closed, await page(`(() => { const t = document.querySelector('.inspector .tabs'); const a = document.querySelector('.inspector [data-field="armed"]'); return [t && t.textContent, a && a.outerHTML.slice(0, 200)]; })()`)]);
      await page(`${tabBtn('/^Triggers/')}.click()`);
      await page(`document.querySelector('.inspector [data-all-triggers]').click()`);
      check('Settings ▸ Integrations ▸ Triggers lists every trigger in the show, and marks the ones that share a key', await until(() => page(`(() => { const rows = [...document.querySelectorAll('.trig-table .tr:not(.head)')]; return rows.length === 5 && rows.filter((r) => r.classList.contains('marked')).length === 2 && rows.filter((r) => r.dataset.trigger === 'timecode').length === 1; })()`), 3000), await page(`[...document.querySelectorAll('.trig-table .tr')].map((r) => r.textContent)`));
      await shot('9-triggers-table');
      await page(`(async () => { document.querySelector('.modal nav [data-section="integrations"]').click(); await new Promise((r) => setTimeout(r, 0)); document.querySelector('.modal .settings-subtabs [data-section="network"]').click(); })()`);
      check('Settings ▸ Integrations ▸ Network has the timecode card', await until(() => page(`!!document.querySelector('[data-card="timecode"] [data-chase="ltc"].on')`), 2000));
      await shot('9-timecode-card');
      await page(`document.querySelector('.modal .close').click()`);
    }
    // a cue cart: a list drawn as buttons; a press starts the cue and the list being run keeps its place
    {
      host.cmd({ op: 'mode', mode: 'edit' }); host.cmd({ op: 'panic', hard: true });
      await page(`(() => { const b = document.querySelector('.toolstrip .btn.icon'); if (b) b.click(); })()`);      // (Find is still open, and has the keyboard)
      await sleep(200);
      const made = host.cmd({ op: 'edit', ops: [{ op: 'list.add', name: 'Stings', cart: { rows: 2, columns: 3 } },
        { op: 'cue.add', ref: 'memo', list: 'Stings', cue: { type: 'memo', name: 'A note', color: 'blue', cell: '1,2' } },
        { op: 'cue.add', ref: 'bell', list: 'Stings', cue: { type: 'audio', name: 'Bell', file: 'media/bell.wav', cell: '2,3' } }] });
      const bell = made.refs && made.refs.bell;
      const stings = snap().doc.lists.find((l) => l.name === 'Stings')!;
      const head = snap().engine.playhead, running = snap().engine.listName;
      await until(() => page(`!!document.querySelector('select.listpick')`), 3000);
      await page(`(() => { const s = document.querySelector('select.listpick'); s.value = 'Stings'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      check('a cart is drawn as a grid of buttons, each cue on its own', await until(() => page(`document.querySelectorAll('.cart .cell').length === 6 && !!document.querySelector('.cart [data-cell="2,3"][data-cue]') && /A note/.test(document.querySelector('.cart [data-cell="1,2"]').textContent)`), 3000));
      await shot('9-cart');
      host.cmd({ op: 'mode', mode: 'show' });
      await sleep(150);
      await page(`document.querySelector('.cart [data-cell="2,3"]').click()`);
      check('a press starts its cue, and the button shows it running', await until(() => page(`!!document.querySelector('.cart [data-cell="2,3"].running')`), 3000) && snap().engine.active.some((a) => a.id === bell));
      check('…and the list being run keeps its playhead', snap().engine.playhead === head && snap().engine.listName === running, [snap().engine.listName, snap().engine.playhead]);
      await key('ArrowLeft'); await sleep(120); await key('ArrowUp');
      check('the arrows walk the buttons', await until(() => page(`document.querySelector('.cart .cell.spot').dataset.cell === '1,2'`), 2000), await page(`[...document.querySelectorAll('.cart .cell.spot')].map((x) => x.dataset.cell).join('|')`));
      // the same cart in a window of its own: a second view of the same show
      const { BrowserWindow } = require('electron');
      await page(`window.ec.app({ op: 'own-window', list: ${JSON.stringify(stings.id)}, name: 'Stings' })`);
      const own = () => BrowserWindow.getAllWindows().find((w: BrowserWindow) => /[?&]list=/.test(w.webContents.getURL()));
      check('a cart opens in a window of its own, showing the same running button', await until(() => own() && own().webContents.executeJavaScript(`document.querySelectorAll('.cart .cell').length === 6 && !!document.querySelector('.cart .cell.running')`, true), 6000));
      if (own()) own().close();
      host.cmd({ op: 'stop', id: bell });
      host.cmd({ op: 'mode', mode: 'edit' });
      await page(`(() => { const s = document.querySelector('select.listpick'); s.value = ${JSON.stringify(running)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      check('back on the list, the table is drawn again', await until(() => page(`!document.querySelector('.cart') && document.querySelectorAll('.list tbody tr').length >= 10`), 3000));
      // the inspector in a window of its own shows what is selected in the main window, which gives its own up
      await page(`window.ec.app({ op: 'own-window', inspector: true })`);
      const insp = () => BrowserWindow.getAllWindows().find((w: BrowserWindow) => /[?&]inspector=/.test(w.webContents.getURL()));
      await until(() => !!insp(), 3000);
      await page(`document.querySelector('.list tbody tr').click()`);
      check('the inspector opens in a window of its own and follows the selection', await until(() => insp() && insp().webContents.executeJavaScript(`!!document.querySelector('.own-inspector .inspector') && !document.querySelector('.own-inspector .empty')`, true), 6000) && await page(`!document.querySelector('.centre > .inspector')`));
      if (insp()) insp().close();
      check('…and comes back to the main window when that one is closed', await until(() => page(`!!document.querySelector('.centre > .inspector')`), 3000));
    }
    // a Script cue: a list of show commands, drawn in the inspector as text, and run by the engine
    {
      const r = host.cmd({ op: 'edit', ops: [{ op: 'cue.add', ref: 's', cue: { type: 'script', number: 'SC1', script: '# ring the bell\n/cue/' + 'SC0' + '/start\nwait 0.3\n/cue/SC0/stop' } }, { op: 'cue.add', cue: { type: 'audio', number: 'SC0', file: 'media/bell.wav' } }] });
      const sc = r.refs.s;
      check('a Script cue with every line understood has no problems', !snap().problems.some((p) => p.id === sc), snap().problems);
      host.cmd({ op: 'start', id: sc });
      // (read from the play log, not by watching for the bell: on a busy computer its 0.3 s can go by between two looks)
      const rang = () => host.cmd({ op: 'playlog' }).entries.find((e: PlayEntry) => e.number === 'SC0');
      check('…and it runs its commands in order: the bell starts, then stops', await until(() => !!rang(), 3000) && rang().secs < 2 && await until(() => !snap().engine.active.some((a) => a.number === 'SC0' || a.id === sc), 3000), rang());
      await page(`document.dispatchEvent(new Event('x'))`);
      host.cmd({ op: 'playhead', id: sc });
      check('the inspector draws its script as text to edit', await until(() => page(`(() => { const t = [...document.querySelectorAll('.inspector .tabs button, .inspector button')].find((b) => b.textContent.trim() === 'Script'); if (t) t.click(); const f = document.querySelector('.inspector [data-field="script"] textarea'); return !!f && /ring the bell/.test(f.value); })()`), 3000));
    }
    // outputs held back for a rehearsal: nothing is sent, the monitor says why, and the title bar says so in red
    {
      host.cmd({ op: 'override', what: 'osc', on: true }); host.cmd({ op: 'override', what: 'midi', on: true });
      check('an output held back is said in the title bar', await until(() => page(`(() => { const c = document.querySelector('.titlebar .chip.held'); return !!c && /HELD BACK/.test(c.textContent) && /OSC/.test(c.textContent) && /MIDI/.test(c.textContent); })()`), 3000));
      const o = host.cmd({ op: 'net-send', text: '/held/back 1' }).sent, m = host.cmd({ op: 'midi-send', text: 'pc 3' }).sent;
      check('…and what would be sent is held back, with the reason', o.ok === false && o.held && /held back/.test(o.why) && m.ok === false && m.held, [o, m]);
      await page(`document.querySelector('.titlebar .chip.held').click()`);
      host.cmd({ op: 'override', what: 'midi', on: false });
      check('a click on the chip sends again', await until(() => page(`!document.querySelector('.titlebar .chip.held')`), 3000) && host.cmd({ op: 'net-send', text: '/sent/again 1' }).sent.ok === true);
      // timecode and DMX out are held back the same way: MTC is made by nobody, the lights are worked out and not sent
      host.cmd({ op: 'override', what: 'timecode', on: true }); host.cmd({ op: 'override', what: 'dmx', on: true });
      check('timecode and DMX out can be held back too, each named in the title bar', await until(() => page(`(() => { const t = [...document.querySelectorAll('.titlebar .chip.held')].map((c) => c.textContent); return t.length === 1 && /TIMECODE/.test(t[0]) && /DMX/.test(t[0]) && !/OSC|MIDI/.test(t[0]); })()`), 3000) && snap().light.held === true, snap().overrides);
      const tcMade = host.cmd({ op: 'edit', ops: [{ op: 'cue.add', ref: 't', cue: { type: 'timecode', number: 'TCH', timecode: '01:00:00:00', fps: '25' } }], label: 'held timecode' });
      const sentBefore = host.played().length;
      host.cmd({ op: 'start', id: tcMade.refs.t });
      await sleep(500);
      check('held back, a Timecode cue runs and no MTC is sent; the monitor says why', host.played().length === sentBefore && snap().engine.active.some((a) => a.id === tcMade.refs.t) && host.cmd({ op: 'net-monitor' }).entries.some((e: MonitorEntry) => e.held && /Timecode out/.test(e.why || '')), [host.played().length, sentBefore]);
      host.cmd({ op: 'override', what: 'timecode', on: false }); host.cmd({ op: 'override', what: 'dmx', on: false });
      check('…and let go, it is sent from where the cue has got to', await until(() => host.played().length > sentBefore, 3000) && snap().light.held === false);
      host.cmd({ op: 'stop', id: tcMade.refs.t });
      host.cmd({ op: 'undo' });
      // everything the title bar can be asked to say at once still fits in it, and each chip says which thing it is
      for (const o of snap().overrides) host.cmd({ op: 'override', what: o.id, on: true });
      host.cmd({ op: 'stage-blackout', on: true }); host.cmd({ op: 'light-blackout', on: true });
      await until(() => page(`/OSC.*MIDI.*TIMECODE.*DMX/.test((document.querySelector('.titlebar .chip.held') || {}).textContent || '')`), 3000);
      await shot('9-titlebar-full');
      check('with every warning on at once the title bar still fits, and each chip names its thing', await page(`(() => { const b = document.querySelector('.titlebar'), kids = [...b.children].filter((x) => x.getBoundingClientRect().width > 0); const t = [...b.querySelectorAll('.chip')].map((c) => c.textContent); return b.clientWidth <= window.innerWidth && b.scrollWidth <= b.clientWidth + 1 && kids.every((x) => x.getBoundingClientRect().right <= window.innerWidth + 1) && t.includes('LIGHTS BLACKOUT') && t.includes('STAGE BLACKOUT') && t.includes('HELD BACK: OSC · MIDI · TIMECODE · DMX'); })()`), await page(`(() => { const b = document.querySelector('.titlebar'); return [b.scrollWidth, b.clientWidth, [...b.querySelectorAll('.chip')].map((c) => c.textContent)]; })()`));
      for (const o of snap().overrides) host.cmd({ op: 'override', what: o.id, on: false });
      host.cmd({ op: 'stage-blackout', on: false }); host.cmd({ op: 'light-blackout', on: false });
    }
    // what is kept beside the show: the playback log, a timed backup, the settings as a file, and a template
    {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-keep-'));
      const log1 = host.cmd({ op: 'playlog' });
      check('every sound that played is in the playback log, with how long it was heard', log1.entries.length >= 3 && log1.entries.every((e: PlayEntry) => e.file && e.secs >= 0) && fs.existsSync(log1.file), log1.entries.length);
      const csv = path.join(out, 'log.csv');
      await page(`window.ec.app({ op: 'playlog-export', path: ${JSON.stringify(csv)} })`);
      check('…and exports as CSV', await until(() => fs.existsSync(csv), 3000) && /^date,started,cue,name,file,seconds,length,mode\n\d{4}-\d\d-\d\d,/.test(fs.readFileSync(csv, 'utf8')));
      host.cmd({ op: 'edit', ops: [{ op: 'show.set', path: 'notes', value: 'a note for the backup' }] });
      const b = host.cmd({ op: 'backup-now' }).backup;
      host.cmd({ op: 'edit', ops: [{ op: 'show.set', path: 'notes', value: 'changed since' }] });
      win.webContents.send('ec-menu', 'versions');
      await until(() => page(`!!document.querySelector('.backups button')`), 3000);
      await page(`document.querySelector('.backups button').click()`);
      check('a timed backup is listed under Versions', !!b && await until(() => page(`document.querySelectorAll('.backups .backup').length >= 1`), 3000));
      await page(`document.querySelector('.backups .backup button').click()`);
      check('…and going back to it is an undoable edit', await until(() => snap().doc.notes === 'a note for the backup', 3000) && snap().show.canUndo);
      win.webContents.send('ec-menu', 'versions');
      const set = path.join(out, 'rig.ecsettings');
      await page(`window.ec.app({ op: 'settings-export', path: ${JSON.stringify(set)} })`);
      check('the settings export as a file with no keys in it', await until(() => fs.existsSync(set), 3000) && JSON.parse(fs.readFileSync(set, 'utf8')).modules['web-remote'].key === '');
      const tpl = path.join(out, 'Rig.ectemplate');
      await page(`window.ec.app({ op: 'template-save', path: ${JSON.stringify(tpl)} })`);
      await until(() => fs.existsSync(tpl), 3000);
      const cuesWere = snap().rows.length, idWas = snap().doc.id;
      host.cmd({ op: 'panic', hard: true });
      await page(`window.ec.app({ op: 'template-new', path: ${JSON.stringify(tpl)} })`);
      check('a new show starts from a template: the same cues, untitled, a show of its own', await until(() => snap().show.untitled && snap().doc.id !== idWas && snap().rows.length === cuesWere, 4000), [snap().show.untitled, snap().rows.length, cuesWere]);
    }
    // what one sound can do: formats, fade shapes, rate, the envelope, limits, the monitor, a lost output (smoke-audio.ts)
    await part('smoke-audio', async () => { await (require('./smoke-audio') as typeof import('./smoke-audio')).audioDepth({ host, win, check, timed, until, page, sleep, log, shot }); });
    // sound design (a cue's chain of tools, measured offline) and the kinds of sound (ducking by kind, the guess at a new sound) (smoke-sound.ts)
    await part('smoke-sound', async () => { await (require('./smoke-sound') as typeof import('./smoke-sound')).soundChecks({ host, win, check, timed, until, page, sleep, shot, log }); });
    // simple until asked: a new sound's bus, the steering tools (smoke-defaults.ts)
    await part('smoke-defaults', async () => { await (require('./smoke-defaults') as typeof import('./smoke-defaults')).after({ host, check, until, page, sleep }); });
    // the cue list's own rescue tools and a quantised GO (smoke-rescue.ts)
    await part('smoke-rescue', async () => { await (require('./smoke-rescue') as typeof import('./smoke-rescue')).rescue({ host, win, check, until, page, sleep, shot }); });
    // the rig, the assistant on it, and its pages (docs/specs/15-assistant-and-rig.md): each part's checks are a file of its own, run if it is there
    for (const part of ['./smoke-rig', './smoke-assistant-rig', './smoke-rig-pages', './smoke-qirx', './smoke-tabs']) {
      let mod = null;
      try { mod = require(part); } catch (err) { if (!((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND' && String((err as Error).message).includes(`'${part}'`))) throw err; }
      if (mod) await mod.run({ host, win, check, until, page, sleep, shot, dir });
    }
    // sections and folding: the heading, GO passing over it, folding by click, keys and menu, Show mode (smoke-sections.ts)
    await part('smoke-sections', async () => { await (require('./smoke-sections') as typeof import('./smoke-sections')).run({ host, win, check, until, page, sleep, shot }); });
    // Report a problem: the form, its picture, and what it sends (to a fake in this process) (smoke-report.ts)
    await part('smoke-report', async () => { await (require('./smoke-report') as typeof import('./smoke-report')).run({ host, win, check, until, page, sleep, shot }); });
    // Updates: the title bar's line, Show mode hiding it, Download, Restart now refused while sound plays (smoke-update.ts)
    await part('smoke-update', async () => { await (require('./smoke-update') as typeof import('./smoke-update')).run({ host, win, check, until, page, sleep, shot }); });
    // the cue list's run tools: chains, a row's stop and level, Find taking you there, the zoomed-out list (smoke-showlist.ts)
    await part('smoke-showlist', async () => { await (require('./smoke-showlist') as typeof import('./smoke-showlist')).run({ host, win, check, until, page, sleep, shot, log }); });
    // the safety net: a fade to silence stopping, Check the show, Run from here, a trigger's double GO, the show log (smoke-safety.ts)
    await part('smoke-safety', async () => { await (require('./smoke-safety') as typeof import('./smoke-safety')).run({ host, win, check, until, page, sleep, shot }); });
    // a sound's lines heard: a pan on the meters, a Pan line, a filter's line, a bent Volume line (smoke-lanes.ts)
    await part('smoke-lanes', async () => { await (require('./smoke-lanes') as typeof import('./smoke-lanes')).heard({ host, check, until, sleep }); });
    // the calmer window: colours, the add-cue list, Save's count, the ⋯ menu, columns, knobs, Report (smoke-declutter.ts)
    await part('smoke-declutter', async () => { await (require('./smoke-declutter') as typeof import('./smoke-declutter')).run({ host, win, check, until, page, sleep, shot, log }); });
    // the assistant pointing at the window: the helper's where-is and keys, a tab, a cue, a pane, Show mode refusing (smoke-guide.ts)
    await part('smoke-guide', async () => { await (require('./smoke-guide') as typeof import('./smoke-guide')).run({ host, win, check, until, page, sleep, shot }); });
    // a show from another computer, held back until Turn on; OSC control with no passcode, and no answers to a forged sender (smoke-hardening.ts)
    await part('smoke-hardening', async () => { await (require('./smoke-hardening') as typeof import('./smoke-hardening')).run({ host, win, check, until, page, sleep, shot }); });
    // the audio engine's switch: Web Audio as it comes; the native engine started --silent, or its absence said (smoke-native.ts)
    await part('smoke-native', async () => { await (require('./smoke-native') as typeof import('./smoke-native')).run({ host, check, until, page }); });
    check('nothing was logged as an error by the page', true);
  } catch (err) {
    failed++;
    log(`SMOKE FAIL  the run threw: ${(err as Error).stack || err}`);
  }
  log(failed ? `SMOKE ${failed} FAILED` : 'SMOKE all passed');
  return failed ? 1 : 0;
}

export { run };
