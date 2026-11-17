/**
 * The calmer window, run by smoke.js near its end. Checked here: the inspector's six colours and "…", a colour from
 * the wheel drawn in the list, the list's right-click Colour menu; the add-cue bar's five types and its "+" list that
 * narrows as you type; Save carrying the count, the ⋯ menu (Versions, the side panel's Network); Panic large and
 * Reset only in Edit; the side panel's one line when nothing plays; empty columns left out and held through Show
 * mode; a mixer knob with no buttons, typed into and sent home with ⌥-click; Pre-wait and Post-wait on Basics only
 * when they matter; Report always in the status bar, and "Something went wrong" offered there (a mark in Show mode).
 * Pictures at 1024 × 700 and 1600 × 1000.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Smoke, Snap } from './smoke';
import type { Cue } from '../../core/show/types';

async function run({ host, win, check, until, page, sleep, shot, log }: Pick<Smoke, 'host' | 'win' | 'check' | 'until' | 'page' | 'sleep' | 'shot' | 'log'>) {
  const snap = () => host.snapshot() as Snap;
  const has = (sel: string) => page<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`);
  const click = (sel: string) => page<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-declutter-')), 'Demo.ecshow');
  require('../../examples/make-demo').makeDemo(dir);
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'mode', mode: 'edit' });
  host.open(dir);
  await until(() => snap().rows.length >= 10 && snap().mixer.audioReady, 6000);
  await until(() => page('document.querySelectorAll(".list tbody tr").length >= 10'), 3000);
  win.setContentSize(1600, 1000); await sleep(250);
  const cues = () => host.document.doc.lists[0].cues;
  const memo = cues().find((c) => c.type === 'memo')!;
  const pick = (id: string) => page<boolean>(`(() => { const r = document.querySelector('.list tr[data-cue="${id}"] td.c-name'); if (!r) return false; r.click(); return true; })()`);

  // ── colour: six and "…"; a colour from the wheel is kept as #rrggbb and drawn as chosen ──
  await pick(memo.id);
  await until(() => has('[data-swatches="color"]'), 2000);
  const sw = await page<{ n: number; any: boolean }>(`(() => { const s = document.querySelector('[data-swatches="color"]'); return { n: s.querySelectorAll('button').length, any: !!s.querySelector('[data-colour-any] input[type=color]') }; })()`);
  check('the inspector offers six colours and “…” for any other', sw.n === 6 && sw.any, sw);
  host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: memo.id, props: { color: '#12AB9C' } }], label: 'colour' });
  check('a colour from the wheel is kept as #rrggbb', host.document.doc.lists[0].cues.find((c) => c.id === memo.id)!.color === '#12ab9c');
  check('…the list draws it as chosen, and “…” shows it is on', await until(() => page(`(() => { const r = document.querySelector('.list tr[data-cue="${memo.id}"]'); const a = document.querySelector('[data-swatches="color"] [data-colour-any]'); return r && /#12ab9c/i.test(r.getAttribute('style') || '') && a && a.classList.contains('on'); })()`), 2000));
  // the list's right-click: Colour ▸ the six and Other… (a test run has no screen for the menu: it is handed the pick)
  global.ecCueMenu = { items: [], picks: ['color:green'] };
  await page(`document.querySelector('.list tr[data-cue="${memo.id}"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`);
  check('the list’s right-click has Colour ▸ the six and Other…, and a pick sets it', await until(() => cues().find((c) => c.id === memo.id)!.color === 'green', 2000)
    && (() => { const m = (global.ecCueMenu.items || []).find((it) => it.label === 'Colour'); return !!m && m.submenu!.filter((x) => x.id).length === 7 && m.submenu!.some((x) => x.id === 'color:other') && m.submenu!.find((x) => x.id === 'color:none'); })(), global.ecCueMenu.items.map((it) => it.label));
  check('…and Colour Once Played beside it', (global.ecCueMenu.items || []).some((it) => it.label === 'Colour Once Played' && it.submenu));

  // ── the add-cue bar: five types and a + that narrows as you type ──
  const bar = await page(`[...document.querySelectorAll('.centre > .toolbar [data-add-type]')].map((b) => b.dataset.addType).join()`);
  check('the add-cue bar shows Group, Audio, Fade, Stop and Memo, and a +', bar === 'group,audio,fade,stop,memo' && await has('[data-tools-more]'), bar);
  await click('[data-tools-more]');
  check('“+” opens a short list with a field that has the keyboard', await until(() => page(`!!document.querySelector('[data-add-list]') && document.activeElement === document.querySelector('[data-add-list] input')`), 2000));
  const waits = () => { let n = 0; const walk = (l: Cue[] | undefined) => { for (const c of l || []) { if (c.type === 'wait') n++; walk(c.children); } }; walk(cues()); return n; };
  const before = waits();
  await page(`(() => { const i = document.querySelector('[data-add-list] input'); i.value = 'wai'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check('…typing narrows it', await until(() => page(`[...document.querySelectorAll('[data-add-list] [data-add-pick]')].map((b) => b.dataset.addPick)[0] === 'wait'`), 2000));
  await shot('declutter-add-list');
  await page(`document.querySelector('[data-add-list] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
  check('…and Enter adds the first, and closes it', await until(() => waits() === before + 1, 2000) && !(await has('[data-add-list]')), { before, after: waits() });

  // ── the title bar: Save with its count, the ⋯ menu ──
  check('Save carries the count of what is not kept (“Save · n”), and there is no separate unsaved chip', await until(() => page(`/^Save · \\d+$/.test(document.querySelector('[data-save]').textContent.trim()) && !document.querySelector('.titlebar .chip.warn')`), 2000),
    await page(`document.querySelector('[data-save]').textContent`));
  host.cmd({ op: 'save' });
  check('…and says Saved when everything is', await until(() => page(`document.querySelector('[data-save]').textContent.trim() === 'Saved'`), 2000));
  check('Versions and Lights are not buttons on the title bar any more', !(await page(`[...document.querySelectorAll('.titlebar button')].some((b) => /^(Versions|Lights)$/.test(b.textContent.trim()))`)));
  check('no module chip in the title bar while no module is on (OSC control among them)', !(await page(`[...document.querySelectorAll('.titlebar .chip')].some((b) => /OSC/i.test(b.textContent))`)));
  global.ecCueMenu = { items: [], picks: ['versions'] };
  await click('[data-more-menu]');
  check('⋯ opens a menu of Versions, the light dashboard, the monitor, Network in the side panel and Report, and Versions opens', await until(() => has('.drawer-pane'), 2000)
    && ['versions', 'lights', 'monitor', 'log', 'side-network', 'report'].every((id) => global.ecCueMenu!.items.some((it) => it.id === id)), global.ecCueMenu!.items.map((it) => it.id));
  global.ecCueMenu = { items: [], picks: ['versions'] };
  await click('[data-more-menu]');
  await until(async () => !(await has('.drawer-pane')), 2000);

  // ── by GO: Panic large; Pause all and Fade all small; Reset only in Edit ──
  const sizes = await page<{ panic: number; pause: number; fade: number; reset: number }>(`(() => { const h = (s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect().height : 0; }; return { panic: h('[data-panic]'), pause: h('[data-pause-all]'), fade: h('[data-fade-all]'), reset: h('[data-reset]') }; })()`);
  check('Panic is large, Pause all and Fade all small, and Reset is there in Edit', sizes.panic > sizes.pause && sizes.pause > 0 && sizes.fade === sizes.pause && sizes.reset > 0, sizes);

  // ── the side panel: one line with nothing playing; Network only once asked for, remembered ──
  check('with nothing playing, the side panel says so in one line', (await page(`document.querySelector('[data-active-head]').textContent.trim()`)) === 'Nothing playing' && !(await has('.side .nothing')));
  check('the side panel’s Network is hidden until asked for', !(await has('[data-side-network]')));
  global.ecCueMenu = { items: [], picks: ['side-network'] };
  await click('[data-more-menu]');
  check('…⋯ ▸ Network in the Side Panel shows it, and this viewer’s choice is kept', await until(() => has('[data-side-network]'), 2000) && (await page(`localStorage.getItem('ec.sideNetwork')`)) === '1');
  global.ecCueMenu = { items: [], picks: ['side-network'] };
  await click('[data-more-menu]');
  await until(async () => !(await has('[data-side-network]')), 2000);

  // ── empty columns: left out, back with one value, held through Show mode ──
  const hidden = () => page(`(() => { const l = document.querySelector('.list'); return ['target', 'pre', 'dur', 'post'].filter((k) => l.classList.contains('no-' + k)).join(); })()`);
  const thShown = (k: string) => page(`getComputedStyle(document.querySelector('.list thead th.c-${k}')).display !== 'none'`);
  check('a column nothing in the list fills (Post-wait in the demo) is not drawn', (await hidden()) === 'post' && !(await thShown('post')) && await thShown('pre'), await hidden());
  host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: memo.id, props: { postWait: 2 } }], label: 'post-wait' });
  check('…and comes back as soon as one cue has a value', await until(async () => (await hidden()) === '' && await thShown('post'), 2000), await hidden());
  host.cmd({ op: 'mode', mode: 'show' });
  await until(() => page(`!!document.querySelector('.app.show-mode')`), 2000);
  const inShow = await hidden();
  host.cmd({ op: 'mode', mode: 'edit' });
  host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: memo.id, props: { postWait: 0 } }], label: 'post-wait' });
  check('…goes again when it is emptied, in Edit', await until(async () => (await hidden()) === 'post', 2000));
  host.cmd({ op: 'mode', mode: 'show' });
  check('in Show mode the columns are as they were when Show began', inShow === '' && await until(async () => (await hidden()) === 'post', 2000));
  check('…and Reset is not there in Show mode', await until(async () => !(await has('[data-reset]')), 2000));
  await shot('declutter-show-1600');
  host.cmd({ op: 'mode', mode: 'edit' });
  await until(() => page(`!document.querySelector('.app.show-mode')`), 2000);

  // ── the mixer's knobs: no buttons; typed into; ⌥-click home; Tab reaches it ──
  check('a mixer knob has no − and + beside it, and Tab can reach it', !(await has('.knob .ksteps')) && !(await has('.knob button[title="+1 dB"]')) && (await page(`document.querySelector('.knob .kdial').getAttribute('tabindex')`)) === '0');
  await page(`document.querySelector('.knob .kdial').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  check('double-click on a knob types a level', await until(() => has('[data-knob-type]'), 2000));
  await page(`(() => { const i = document.querySelector('[data-knob-type]'); i.value = '-6'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  const bus0 = () => (snap().mixer.buses[0] || {});
  check('…Enter sets it', await until(() => bus0().db === -6, 2000), bus0());
  await page(`document.querySelector('.knob .kdial').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, altKey: true, pointerId: 1 }))`);
  check('⌥-click sends it home to 0 dB', await until(() => bus0().db === 0, 2000), bus0());
  await until(() => page(`document.querySelector('.knob .kdial').getAttribute('aria-valuenow') === '0'`), 2000);
  await page(`(() => { const k = document.querySelector('.knob .kdial'); k.focus(); k.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })); })()`);
  check('…and with the keyboard on it, ↑ steps it up 1 dB', await until(() => bus0().db === 1, 2000), bus0());
  await page(`document.activeElement && document.activeElement.blur()`);
  host.cmd({ op: 'revert' });

  // ── Pre-wait and Post-wait on Basics only when they matter ──
  const wait = cues().find((c) => c.type === 'memo')!;
  await pick(wait.id);
  const onBasics = (k: string) => page(`(() => { const f = document.querySelector('.inspector [data-field="${k}"]'); return !!f; })()`);
  await until(() => has('.inspector [data-field="name"]'), 2000);
  const moreOpen = await has('.inspector .more') && (await page(`document.querySelector('.inspector .more').textContent.includes('▾')`));
  check('a cue with no waits shows neither on Basics (they are under More)', moreOpen || (!(await onBasics('preWait')) && !(await onBasics('postWait'))));
  host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: wait.id, props: { continue: 'auto-continue' } }], label: 'continue' });
  check('…auto-continue brings Post-wait onto Basics', await until(() => onBasics('postWait'), 2000));
  host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: wait.id, props: { preWait: 1.5 } }], label: 'pre-wait' });
  check('…and a pre-wait that is set is shown there too', await until(() => onBasics('preWait'), 2000));
  host.cmd({ op: 'revert' });
  await shot('declutter-edit-1600');

  // ── Report: always in the status bar; offered when something goes wrong; a mark in Show mode ──
  check('Report is always in the status bar', await has('.footer [data-report-open]'));
  log('[audio] could not decode smoke-check.wav: a made-up failure (smoke-declutter)');
  check('something gone wrong is offered in the status bar, in Edit', await until(() => has('.footer [data-issue] [data-issue-report]'), 3000));
  host.cmd({ op: 'mode', mode: 'show' });
  check('…in Show mode it waits as a small mark and takes no focus', await until(async () => !(await has('[data-issue]')) && await has('[data-issue-mark]'), 2000) && (await page(`!document.activeElement || !document.activeElement.closest('.footer')`)));
  host.cmd({ op: 'mode', mode: 'edit' });
  check('…and back in Edit it says itself again', await until(() => has('[data-issue]'), 2000));
  win.setContentSize(1024, 700); await sleep(250);
  await shot('declutter-issue-1024');
  await click('[data-issue-report]');
  check('Report opens the form with the error attached, which can be unticked', await until(() => has('[data-report] [data-report-attach="issue"]'), 6000)
    && await page(`document.querySelector('[data-report-attach="issue"]').checked === true`));
  check('…and the show log’s tail ticked, when there is one', await page(`(() => { const b = document.querySelector('[data-report-log]'); return !!b && (b.disabled || b.checked); })()`));
  await shot('declutter-report-1024');
  await click('[data-report] .acts .btn:not(.primary)');
  check('…and once reported the line is put away', await until(async () => !(await has('[data-report]')) && !(await has('[data-issue]')), 3000));
  win.setContentSize(1600, 1000); await sleep(150);
  await shot('declutter-1600');
  win.setContentSize(1480, 940); await sleep(150);
}

export { run };
