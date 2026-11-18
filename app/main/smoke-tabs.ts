/**
 * The title bar's tabs (Edit · Rig · Show) and the window's room for the list; run by
 * smoke.ts after the rig's pages. Checked here: each tab shows its page; the Show tab IS Show mode, with everything
 * Show mode locks (the host refuses an edit, the toolbar and inspector are gone, the assistant is not there at all);
 * the Rig from Show stays in Show mode, and only Edit unlocks; ⇧⌘M goes between Edit and Show; a brand-new show has no dot on its Rig tab; the add-cue bar is one row of the common
 * types until More; and at 1000 by 700, with the Playing strip folded out and the inspector showing, the cue list
 * keeps its header and four rows.
 */
import type { Smoke, Snap } from './smoke';
async function run({ host, win, check, until, page, sleep, shot: take }: Pick<Smoke, 'host' | 'win' | 'check' | 'until' | 'page' | 'sleep' | 'shot'>) {
  const shot = async (name: string) => { try { if (take) await take(name); } catch { /* no picture */ } };
  const snap = () => host.snapshot() as Snap;
  const has = (sel: string) => page<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`);
  const click = (sel: string) => page<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  const tabOn = () => page(`(() => { const t = document.querySelector('[data-tabs] button.on'); return t ? t.dataset.tab : null; })()`);

  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'mode', mode: 'edit' });
  win.webContents.send('ec-menu', 'info');
  host.openUntitled();
  await until(() => snap().show.untitled && snap().rows.length === 0, 4000);
  win.webContents.send('ec-menu', 'view-rig');
  await until(() => has('[data-rig]'), 3000);
  win.webContents.send('ec-menu', 'view-rig');
  await until(() => has('.list, .welcome'), 3000);

  // ── the tabs as they come ──
  check('the title bar has three tabs, Edit · Rig · Show', (await page(`[...document.querySelectorAll('.titlebar [data-tabs] [data-tab]')].map((b) => b.dataset.tab + ':' + b.textContent.trim()).join()`)) === 'edit:Edit,rig:Rig,show:Show',
    await page(`[...document.querySelectorAll('.titlebar [data-tabs] [data-tab]')].map((b) => b.textContent.trim())`));
  check('…and the old switches are gone', !(await has('.titlebar .seg.mode')) && !(await has('.titlebar .seg.views')));
  check('a brand-new show has no dot on its Rig tab (Save already says it is not saved)', !(await has('[data-rig-dot]')), snap().rig.items.filter((it) => it.state !== 'ready').map((it) => it.id));
  check('Edit is the tab on, with the list', (await tabOn()) === 'edit' && (await has('.centre .list')));

  // ── the add-cue bar: the common types in one row, the rest behind its + ──
  win.setContentSize(1480, 940); await sleep(250);
  const bar = () => page<{ n: number; rows: number; more: boolean } | null>(`(() => { const t = document.querySelector('.centre > .toolbar:not(.toolstrip)'); if (!t) return null; const b = [...t.querySelectorAll('[data-add-type]')]; const tops = new Set(b.map((x) => Math.round(x.getBoundingClientRect().top))); return { n: b.length, rows: tops.size, more: !!t.querySelector('[data-tools-more]') }; })()`);
  const few = await bar();
  check('the add-cue bar shows the common cue types in one row, with a +', !!few && few.n === 5 && few.rows === 1 && few.more, few);
  await click('[data-tools-more]');
  const all = await page(`document.querySelectorAll('[data-add-list] [data-add-pick]').length`);
  check('…and + lists every other type', all === (await page<number>(`window.ec.init().then((i) => i.typeOrder.length)`)) - 5, all);
  await click('[data-tools-more]');

  // ── Show: the cue list in Show mode, with everything Show mode locks ──
  const demo = require('path').join(require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'ec-smoke-tabs-')), 'Demo.ecshow');
  require('../../examples/make-demo').makeDemo(demo);
  host.open(demo);
  await until(() => snap().rows.length >= 10 && snap().mixer.audioReady, 6000);
  await until(() => page('document.querySelectorAll(".list tbody tr").length >= 10'), 3000);
  await click('[data-tab="show"]');
  check('the Show tab puts the app in Show mode', await until(() => snap().mode === 'show', 2000));
  check('…shows the cue list, with no toolbar and no inspector', await until(async () => (await tabOn()) === 'show' && (await has('.centre .list')) && !(await has('.centre > .toolbar:not(.toolstrip)')) && !(await has('.centre .inspector')), 2000));
  check('…is drawn in standby colours, so it cannot be missed', await page(`(() => { const b = document.querySelector('[data-tab="show"]'), c = getComputedStyle(b).color, s = getComputedStyle(document.documentElement).getPropertyValue('--standby').trim(); const probe = document.createElement('i'); probe.style.color = s; document.body.appendChild(probe); const want = getComputedStyle(probe).color; probe.remove(); return b.classList.contains('show') && c === want && !!document.querySelector('.app.show-mode'); })()`));
  check('…the host refuses an edit', /Show mode/.test(host.cmd({ op: 'edit', ops: [{ op: 'show.set', path: 'notes', value: 'x' }] }).error || ''));
  check('…and the assistant is not there at all: no button, no resident, no drawer', !(await has('[data-assistant-button]')) && !(await has('.resident')) && !(await has('[data-assistant]')));
  win.webContents.send('ec-menu', 'assistant');
  await sleep(200);
  check('…and its key opens nothing', !(await has('[data-assistant]')));
  await shot('tabs-1-show');

  // ── the Rig from Show: its page, still in Show mode; only Edit unlocks ──
  await click('[data-tab="rig"]');
  check('the Rig tab from Show shows the Rig page, and the app stays in Show mode', await until(async () => (await has('[data-rig]')) && (await tabOn()) === 'rig', 2000) && snap().mode === 'show');
  check('…with the Show tab still marked, so the lock is never out of sight', await page(`(() => { const b = document.querySelector('[data-tab="show"]'); return b.classList.contains('show') && !b.classList.contains('on'); })()`));
  check('…and Look for props is off there, as in Show mode', await page(`!!document.querySelector('[data-rig-scan]') && document.querySelector('[data-rig-scan]').disabled`));
  await shot('tabs-2-rig-in-show-mode');
  await click('[data-tab="edit"]');
  check('the Edit tab leaves Show mode and shows the list with its inspector', await until(async () => snap().mode === 'edit' && (await tabOn()) === 'edit' && (await has('.centre .list')) && (await has('.centre .inspector')), 2000));

  // ── ⇧⌘M: between Edit and Show, from wherever ──
  const menuItem = (label: string) => { const { Menu } = require('electron'); const walk = (m: Electron.Menu): Electron.MenuItem | null => { for (const i of m.items) { if (i.label === label) return i; if (i.submenu) { const x = walk(i.submenu); if (x) return x; } } return null; }; return walk(Menu.getApplicationMenu()); };
  const sm = menuItem('Show Mode');
  check('View ▸ Show Mode is on ⇧⌘M', !!sm && /Shift\+M$/i.test(String(sm.accelerator || '').replace('CmdOrCtrl+', '')), sm && sm.accelerator);
  win.webContents.send('ec-menu', 'view-rig');
  await until(() => has('[data-rig]'), 2000);
  win.webContents.send('ec-menu', 'toggle-mode');
  check('⇧⌘M from the Rig goes to the Show tab', await until(async () => snap().mode === 'show' && (await tabOn()) === 'show' && (await has('.centre .list')), 2000));
  win.webContents.send('ec-menu', 'toggle-mode');
  check('…and again to the Edit tab', await until(async () => snap().mode === 'edit' && (await tabOn()) === 'edit', 2000));

  // ── the list keeps its room at 1000 by 700: the Playing strip folded out and the inspector showing ──
  win.setContentSize(1000, 700); await sleep(300);
  const rain = snap().rows.find((r) => r.name === 'Rain')!;
  host.cmd({ op: 'fire', id: rain.id });
  await until(() => has('.playing'), 3000);
  await page(`(() => { const tr = [...document.querySelectorAll('.list tbody tr')].find((t) => /Rain/.test(t.textContent)); tr && tr.click(); })()`);
  if (!(await has('.playing [data-more].on'))) await click('.playing [data-more]');
  await sleep(300);
  const room = await page<{ list: number; need: number; inspector: number; playing: number; fits: boolean }>(`(() => { const l = document.querySelector('.centre .list'), i = document.querySelector('.centre .inspector'), p = document.querySelector('.centre .playing'); const row = parseFloat(getComputedStyle(l).getPropertyValue('--row')) || 30;
    return { list: Math.round(l.getBoundingClientRect().height), need: 24 + 4 * row, inspector: i ? Math.round(i.getBoundingClientRect().height) : 0, playing: p ? Math.round(p.getBoundingClientRect().height) : 0, fits: document.querySelector('.centre').scrollHeight <= document.querySelector('.centre').clientHeight + 1 }; })()`);
  check('at 1000×700 with the Playing strip folded out and the inspector showing, the list keeps its header and four rows', room.list >= room.need - 1 && room.inspector > 0 && room.playing > 0, room);
  await shot('tabs-3-list-room-1000x700');
  host.cmd({ op: 'panic', hard: true });
  await click('.playing [data-more]');
  win.setContentSize(1480, 940); await sleep(250);
}

export { run };
