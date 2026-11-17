/**
 * Sections and folding (core/show/sections.js, app/renderer/Sections.js), run by smoke.js near its end. Checked here:
 * a section is drawn as a heading and listed in the strip above the list; GO passes over it; a click on the heading,
 * ← and →, View ▸ Fold All / Unfold All and ⌥-click fold; a folded heading shows the cue standing by in it; in Show
 * mode the section holding the playhead opens by itself and closes again when the playhead leaves; what is folded is
 * kept for this show on this computer and comes back when it is opened again; a strip click goes to a section; Jump
 * takes a section's name. Pictures at 1024 × 700 and 1600 × 1000.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const show = require('../../core/show/show');
const { applyOps } = require('../../core/show/ops');

async function run({ host, win, check, until, page, sleep, shot }) {
  const snap = () => host.snapshot();
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-sections-')), 'Sections.ecshow');
  fs.mkdirSync(dir, { recursive: true });
  const built = applyOps(show.newShow('Sections'), [
    { op: 'cue.add', ref: 'm1', cue: { type: 'memo', number: '1', name: 'Preset' } },
    { op: 'cue.add', ref: 's1', cue: { type: 'section', name: 'Act one', color: 'teal' } },
    { op: 'cue.add', ref: 'm2', cue: { type: 'memo', number: '2', name: 'Lights up' } },
    { op: 'cue.add', ref: 'm3', cue: { type: 'memo', number: '3', name: 'Door' } },
    { op: 'cue.add', ref: 's2', cue: { type: 'section', name: 'Act two' } },
    { op: 'cue.add', ref: 'm4', cue: { type: 'memo', number: '4', name: 'Storm' } },
    { op: 'cue.add', ref: 'g5', cue: { type: 'group', number: '5', name: 'Thunder', children: [{ type: 'memo', name: 'Crack' }, { type: 'memo', name: 'Roll' }] } },
  ]);
  const id = (ref) => built.refs[ref];
  fs.writeFileSync(path.join(dir, 'show.json'), show.stringify(built.doc));
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'mode', mode: 'edit' });
  host.open(dir);
  await page(`window.ec.app({ op: 'folds', dir: ${JSON.stringify(dir)}, ids: [] })`);
  const has = (sel) => page(`!!document.querySelector(${JSON.stringify(sel)})`);
  const count = (sel) => page(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const folded = () => page(`[...document.querySelectorAll('.list tr.section.folded')].map((r) => r.dataset.section)`);
  const key = (k, more = '') => page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true${more} }))`);
  const rowOf = (n) => `[...document.querySelectorAll('.list tbody tr')].find((r) => r.querySelector('.c-num') && r.querySelector('.c-num').textContent.trim() === ${JSON.stringify(n)})`;
  const shows = (n) => page(`!!${rowOf(n)}`);

  check('a section is drawn as a heading across the list (every column drawn), and named in the strip above it',
    await until(() => page(`document.querySelectorAll('.list tr.section').length === 2 && document.querySelector('.list tr.section td').colSpan === [...document.querySelectorAll('.list thead th')].filter((th) => getComputedStyle(th).display !== 'none').length && [...document.querySelectorAll('[data-section-strip] button')].map((b) => b.textContent).join('|') === 'Act one|Act two'`), 4000),
    await page(`[...document.querySelectorAll('[data-section-strip] button')].map((b) => b.textContent)`));

  host.cmd({ op: 'go' });
  check('GO passes over a section: the cue after it stands by', snap().engine.playhead === id('m2'), snap().engine.playhead);
  host.cmd({ op: 'playhead', id: id('s2') });
  check('standing by on a section stands by its first cue', snap().engine.playhead === id('m4'), snap().engine.playhead);
  host.cmd({ op: 'playhead', id: id('m2') });
  await sleep(400);                          // (the selection follows the playhead when the page hears of it: let it, before clicking)

  // a click on the heading folds it; ← and → on the selected one; the menu folds every section and group
  await page(`document.querySelector('tr[data-section="${id('s2')}"]').click()`);
  check('a click on a section heading folds it: its cues are not drawn, its heading says how many', await until(async () => (await folded()).join() === id('s2') && !(await shows('4')) && !(await shows('5')), 3000)
    && await page(`document.querySelector('tr[data-section="${id('s2')}"] .sec-count').textContent === '2'`), await folded());
  await key('ArrowRight');
  check('→ unfolds the selected section', await until(async () => !(await folded()).length && await shows('4'), 3000), await folded());
  await key('ArrowLeft');
  check('← folds it again', await until(async () => (await folded()).join() === id('s2'), 3000), await folded());
  win.webContents.send('ec-menu', 'fold-sections');
  check('View ▸ Fold All Sections folds every section', await until(async () => (await folded()).length === 2 && !(await shows('2')), 3000), await folded());
  check('…and the folded section holding the cue standing by says which, in the standby treatment', await until(() => page(`(() => { const h = document.querySelector('tr.section.holds-head .sec-head'); return !!h && /2/.test(h.textContent) && /Lights up/.test(h.textContent) && getComputedStyle(h).color !== getComputedStyle(document.querySelector('.sec-name')).color; })()`), 3000));
  win.webContents.send('ec-menu', 'unfold-all');
  check('View ▸ Unfold Everything opens them all', await until(async () => !(await folded()).length && await count('.list tr.section') === 2 && await shows('5'), 3000));
  const crack = () => page(`[...document.querySelectorAll('.list tbody tr')].some((r) => /Crack/.test(r.textContent))`);
  await key('<');
  check('< folds every group and leaves the sections open', await until(async () => !(await crack()) && !(await folded()).length, 3000), await folded());
  await key('>');
  check('> opens every group again', await until(() => crack(), 3000));
  await page(`document.querySelector('tr[data-section="${id('s1')}"] .sec-caret').dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))`);
  check('⌥-click on a caret folds every section', await until(async () => (await folded()).length === 2, 3000), await folded());

  // Show mode: the section holding the playhead is open while the playhead is in it, and folds again as it leaves
  host.cmd({ op: 'mode', mode: 'show' });
  check('in Show mode the section holding the cue standing by opens by itself', await until(async () => (await folded()).join() === id('s2') && await shows('2'), 3000), await folded());
  await shot('sections-show-mode');
  host.cmd({ op: 'go' }); await sleep(400); host.cmd({ op: 'go' });
  check('…and when the playhead leaves it, it folds again and the next one opens', await until(async () => snap().engine.playhead === id('m4') && (await folded()).join() === id('s1') && await shows('4'), 3000), [snap().engine.playhead, await folded()]);
  host.cmd({ op: 'mode', mode: 'edit' });

  // kept for this show on this computer: opened again, the same sections are folded
  await until(async () => (await page(`window.ec.app({ op: 'folds', dir: ${JSON.stringify(dir)} }).then((r) => r.ids.length)`)) === 2, 2000);
  const kept = await page(`window.ec.app({ op: 'folds', dir: ${JSON.stringify(dir)} })`);
  host.openUntitled();
  await until(async () => (await count('.list tr.section')) === 0, 3000);
  host.open(dir);
  check('what is folded is kept per show on this computer and comes back when the show is opened again', [...kept.ids].sort().join() === [id('s1'), id('s2')].sort().join() && await until(async () => (await folded()).length === 2, 4000), [kept, await folded()]);
  check('…and not in the show file', !/folded|collapsed/.test(fs.readFileSync(path.join(dir, 'show.json'), 'utf8')));

  // the strip goes to a section; Jump takes a section's name
  win.webContents.send('ec-menu', 'unfold-all');
  await page(`[...document.querySelectorAll('[data-section-strip] button')][1].click()`);
  check('a section in the strip is gone to and selected', await until(() => has(`tr[data-section="${id('s2')}"].sel`), 3000));
  const j = host.cmd({ op: 'jump', number: 'act two' });
  check('Jump to a section by its name stands by its first cue', !j.error && snap().engine.playhead === id('m4'), j);

  for (const [w, h] of [[1024, 700], [1600, 1000]]) {
    win.setContentSize(w, h); await sleep(300);
    check(`at ${w} × ${h} the strip and the headings fit the list's width`, await page(`(() => { const s = document.querySelector('[data-section-strip]'), l = document.querySelector('.list'); return !!s && s.getBoundingClientRect().right <= l.getBoundingClientRect().right + 1 && document.querySelector('.list tr.section').getBoundingClientRect().width <= l.clientWidth + 1; })()`));
    await shot(`sections-${w}`);
  }
  win.setContentSize(1480, 940);
}

module.exports = { run };
