/**
 * The smoke run's checks that the app is simple until asked (docs/specs/00-defaults.md), called from smoke.ts:
 *
 *   plain(…)   as the app comes: no Live view, no way into it, nothing has looked for a tempo; then the Live
 *              view is switched on, which the checks of that view (smoke.ts, smoke-live.ts) need
 *   after(…)   switched off again: a show made with the Live view says so in one line and offers it; a new
 *              sound goes on a bus by its length only when the show asks for that
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Smoke, Snap, Page } from './smoke';
import type { Cue } from '../../core/show/types';

const switchLive = (page: Page, on: boolean) => page(`window.ec.app({ op: 'view', view: { live: ${on ? 'true' : 'false'} } })`);
const liveTab = (page: Page) => page(`!!document.querySelector('.titlebar [data-tabs] [data-tab="live"]')`);

async function plain({ host, win, check, until, page, sleep }: Pick<Smoke, 'host' | 'win' | 'check' | 'until' | 'page' | 'sleep'>) {
  const snap = () => host.snapshot() as Snap;
  const d = snap().doc.settings, mods = snap().doc.modules || {};
  check('as it comes, the window has no Live view', !(await liveTab(page)) && (await page(`window.ec.init().then((i) => i.view.live)`)) === false);
  win.webContents.send('ec-menu', 'view-live');
  await sleep(200);
  check('…and nothing opens one', await page(`!document.querySelector('.desk') && !!document.querySelector('.list, .welcome')`));
  const log = (await page<{ lines?: string[] }>(`window.ec.app({ op: 'log' })`)).lines || [];
  check('nothing has looked for a tempo in any sound', !log.some((l) => /^\[tempo\]/.test(l) || /\[tempo\]/.test(l)), log.filter((l) => /\[tempo\]/.test(l)).slice(0, 3));
  check('a show starts with ducking, lighting output, timecode and every module off', d.audio.duck.on === false && d.light.on === false && d.timecode.source === 'off' && d.network.listen === false
    && !d.midi.mscIn && !d.audio.monitor.on && !d.editing.longSoundsToMusic && Object.values(mods).every((m) => !m.enabled) && !snap().modules.some((m) => m.running), [d.audio.duck, mods]);
  await switchLive(page, true);
  check('switched on (Settings ▸ General, or the View menu), the Live view is in the title bar', await until(() => liveTab(page), 3000));
  await page(`document.querySelector('.titlebar [data-tab="live"]').click()`);
  check('…and opens', await until(() => page(`!!document.querySelector('.desk')`), 3000));
  await page(`document.querySelector('.titlebar [data-tab="edit"]').click()`);
  await until(() => page(`!document.querySelector('.desk')`), 3000);
}

async function after({ host, win, check, until, page, sleep }: Pick<Smoke, 'host' | 'win' | 'check' | 'until' | 'page' | 'sleep'>) {
  const snap = () => host.snapshot() as Snap;
  const { writeWav } = require('../../examples/make-demo');
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'mode', mode: 'edit' });
  host.openUntitled();
  await until(() => snap().show.untitled && snap().rows.length === 0 && snap().mixer.audioReady, 4000);
  win.webContents.send('ec-menu', 'view-live');
  await until(() => page(`!!document.querySelector('.desk')`), 3000);
  await switchLive(page, false);
  check('the Live view switched off while it is open: the cue list is back, and the tab is gone', await until(() => page(`!document.querySelector('.desk') && !document.querySelector('.titlebar [data-tab="live"]')`), 3000));
  check('a plain show says nothing about the Live view', (snap().live.used || []).length === 0 && !(await page(`!!document.querySelector('[data-uses-live]')`)), snap().live.used);
  // a new sound's bus: the one every Audio cue starts on, however long it is, until the show asks for the guess
  const long = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-defaults-')), 'long.wav');
  { const n = 44100 * 31, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * 220 * i / 44100) * 0.2; writeWav(long, x); }
  const busOf = (id: string) => { const c: Partial<Cue> = host.document.doc.lists[0].cues.find((q) => q.id === id) || {}; return c.bus || 'effects'; };
  const one = await host.cmd({ op: 'import', paths: [long] });
  check('a long sound added to a new show is on the bus every Audio cue starts on', one && one.made && busOf(one.made[0]) === 'effects', one);
  host.cmd({ op: 'edit', ops: [{ op: 'show.set', path: 'settings.editing.longSoundsToMusic', value: true }], label: 'long sounds go on the Music bus' });
  const two = await host.cmd({ op: 'import', paths: [long] });
  check('…and on Music once the show asks for that (Settings ▸ Show)', two && two.made && busOf(two.made[0]) === 'music', [two, host.document.doc.settings.editing]);
  // The tools for steering a running track are the cue list's own, with the Live view hidden: each sound in Active
  // Cues has its own pause and stop, the waveform of what plays is under the list, a loop region is held and let go,
  // and a tempo is found for one sound when it is asked for on its Time & Loops tab (so a group can wait for the bar).
  const click = path.join(path.dirname(long), 'click120.wav');
  { const n = 44100 * 20, x = new Float32Array(n); for (let i = 0; i < n; i++) { const p = ((i / 44100) - 0.25 + 0.5) % 0.5; x[i] = Math.exp(-p / 0.04) * Math.sin(2 * Math.PI * 70 * p) * 0.8; } writeWav(click, x); }
  const made = await host.cmd({ op: 'import', paths: [click] });
  const clickId = made.made[0];
  const cueOf = (id: string): Partial<Cue> => host.document.doc.lists[0].cues.find((q) => q.id === id) || {};
  host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: clickId, props: { name: 'Click', loops: [{ start: 4, end: 6, name: 'vamp' }] } }], label: 'a loop region' });
  const logged = async () => ((await page<{ lines?: string[] }>(`window.ec.app({ op: 'log' })`)).lines || []).filter((l) => /\[tempo\]/.test(l) && /click120/.test(l)).length;
  check('adding a sound does not look for its tempo', !cueOf(clickId).tempo && (await logged()) === 0 && (await host.cmd({ op: 'tempo-of', file: cueOf(clickId).file! })).known === false);
  await until(() => page(`[...document.querySelectorAll('.list tbody tr')].some((x) => /Click/.test(x.textContent))`), 3000);
  await page(`(() => { const r = [...document.querySelectorAll('.list tbody tr')].find((x) => /Click/.test(x.textContent)); r.scrollIntoView(); r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); r.click(); })()`);
  await until(() => page(`[...document.querySelectorAll('.inspector .tabs button')].some((b) => b.textContent === 'Time & Loops')`), 3000);
  await page(`[...document.querySelectorAll('.inspector .tabs button')].find((b) => b.textContent === 'Time & Loops').click()`);
  await until(() => page(`!!document.querySelector('.inspector [data-find-tempo]')`), 3000);
  await page(`document.querySelector('.inspector [data-find-tempo]').click()`);
  check('asked for on a sound’s Time & Loops tab, its tempo is found, with the Live view hidden', await until(() => { const t = cueOf(clickId).tempo; return !!t && Math.abs(t.bpm - 120) < 0.05; }, 15000), cueOf(clickId).tempo);
  check('…shown there, and no other sound was listened through', (await until(() => page(`/120\.00 bpm/.test((document.querySelector('.inspector [data-tempo]') || {}).textContent || '')`), 3000))
    && !host.document.doc.lists[0].cues.some((q) => q.id !== clickId && q.tempo));
  host.cmd({ op: 'start', id: clickId });
  check('a running sound has its own pause and stop in Active Cues, and its waveform under the list', await until(() => page(`document.querySelectorAll('.side .act .ctl button.btn').length >= 2 && !!document.querySelector('.playing .wave')`), 4000));
  await page(`document.querySelector('.side .act .ctl button.btn').click()`);
  check('…its pause pauses that sound', await until(() => (snap().engine.active.find((x) => x.id === clickId) || {}).paused === true, 2000));
  await page(`document.querySelector('.side .act .ctl button.btn').click()`);
  await until(() => (snap().engine.active.find((x) => x.id === clickId) || {}).paused !== true, 2000);
  const held = host.cmd({ op: 'hold' });
  check('a loop region ahead is armed to hold (L), and let go again', held && held.did === 'armed' && (snap().engine.active.find((x) => x.id === clickId) || { armed: [] }).armed!.length === 1 && !!host.cmd({ op: 'hold' }).did, held);
  await page(`document.querySelectorAll('.side .act .ctl button.btn')[1].click()`);
  check('…and its stop stops it', await until(() => !snap().engine.active.some((x) => x.id === clickId), 4000));
  // a show made with the Live view, opened with the view hidden: it says so in one line, and plays as it was made
  host.cmd({ op: 'strip', name: 'music', key: 'pan', value: 0.5, commit: true });
  check('a show that uses the Live view says so in the title bar while the view is hidden', await until(() => page<string | undefined>(`(document.querySelector('[data-uses-live]') || {}).textContent`).then((t) => /Live view/.test(t || '')), 3000), snap().live.used);
  const pan = () => host.audioWindow()!.webContents.executeJavaScript(`buses.music.strip.pan`, true).catch(() => null);
  check('…and its desk is still what is heard', await until(() => pan().then((v) => v === 0.5), 2000), await pan());
  await page(`document.querySelector('[data-uses-live]').click()`);
  check('a click on that line shows the Live view', await until(() => page(`!!document.querySelector('.desk') && !!document.querySelector('.titlebar [data-tab="live"]')`), 3000));
  await switchLive(page, false);
  await until(() => page(`!document.querySelector('.desk')`), 3000);
  await sleep(100);
}

export { plain, after };
