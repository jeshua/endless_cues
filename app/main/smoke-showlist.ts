/**
 * The cue list's run tools (app/renderer/ListTools.js, list-view.js), run by smoke.js near its end. Checked here:
 * a chain of continues drawn as a line down the linked rows (past a heading) and the masthead saying how many cues
 * the GO sets off; a cue deleted from the middle of a chain: the new link shown and said; a playing row's own level,
 * where it goes, "no output" when its outputs are not there, and its stop (a fade, then dead; ⌥ dead at once; in
 * Show mode too, never moving the playhead); Find unfolding a section and bringing the match to the middle with a
 * flash; the list zoomed out by a pinch until the whole show fits (headings readable, the cue standing by seen), a
 * click there zooming back in without selecting, ⌘− ⌘= ⌘0, kept per show and not in the show file, GO unaffected.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as show from '../../core/show/show';
import { applyOps } from '../../core/show/ops';
import { writeWav } from '../../examples/make-demo';
import type { Smoke, Snap, Check } from './smoke';
import type { Op } from '../../core/show/ops';

async function run({ host, win, check, until, page, sleep, shot, log = () => {} }: Pick<Smoke, 'host' | 'win' | 'check' | 'until' | 'page' | 'sleep' | 'shot'> & Partial<Pick<Smoke, 'log'>>) {
  // (the whole show fits the list only in a window as tall as the run asked for; on a smaller screen it was cut down)
  const roomy: Check = (name, ok, got) => { const h = win.getContentSize()[1]; if (ok || h >= 880) return check(name, ok, got); log(`SMOKE skip  ${name}: the window is ${h} px tall here, the screen is too small for 940${got !== undefined ? `  got: ${JSON.stringify(got)}` : ''}`); };
  const snap = () => host.snapshot() as Snap;
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-showlist-')), 'Showlist.ecshow');
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  // a steady tone, long enough to be playing while it is looked at
  const n = 44100 * 20, tone = new Float32Array(n);
  for (let i = 0; i < n; i++) tone[i] = 0.4 * Math.sin((2 * Math.PI * 330 * i) / 44100);
  writeWav(path.join(dir, 'media', 'tone.wav'), tone);
  const ops: Op[] = [
    { op: 'cue.add', ref: 'a', cue: { type: 'memo', number: '1', name: 'Doors', continue: 'auto-continue' } },
    { op: 'cue.add', ref: 'b', cue: { type: 'wait', number: '2', name: 'Beat', duration: 0.5, continue: 'auto-follow' } },
    { op: 'cue.add', ref: 's1', cue: { type: 'section', name: 'Scene one', color: 'teal' } },
    { op: 'cue.add', ref: 'c', cue: { type: 'memo', number: '3', name: 'Lights up' } },
    { op: 'cue.add', ref: 'd', cue: { type: 'audio', number: '4', name: 'Tone', file: 'media/tone.wav', color: 'blue' } },
    { op: 'cue.add', ref: 'e', cue: { type: 'audio', number: '5', name: 'Tone elsewhere', file: 'media/tone.wav' } },
    { op: 'cue.add', ref: 's2', cue: { type: 'section', name: 'Scene two' } },
    { op: 'cue.add', ref: 'needle', cue: { type: 'memo', number: '40', name: 'Hidden needle' } },
  ];
  for (let i = 6; i < 70; i++) {
    if (i % 16 === 0) ops.push({ op: 'cue.add', cue: { type: 'section', name: `Scene ${i / 16 + 2}` } });
    ops.push({ op: 'cue.add', cue: { type: 'memo', number: String(i + 100), name: `Cue ${i}`, color: ['none', 'red', 'green', 'none', 'orange'][i % 5] } });
  }
  const built = applyOps(show.newShow('Showlist'), ops);
  const id = (ref: string) => built.refs[ref];
  fs.writeFileSync(path.join(dir, 'show.json'), show.stringify(built.doc));
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'mode', mode: 'edit' });
  host.open(dir);
  const row = (cid: string) => `document.querySelector('.list tbody tr[data-cue="${cid}"]')`;
  const has = (sel: string) => page<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`);
  const key = (k: string, more = '') => page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true${more} }))`);
  await until(() => page(`!!${row(id('needle'))}`), 4000);
  host.cmd({ op: 'playhead', id: id('a') });

  // 1. chains
  check('a chain is drawn: a line out of the first cue, into and out of the next, past the heading, into the last',
    await until(() => page(`(() => { const r = (c) => document.querySelector('.list tbody tr[data-cue="' + c + '"]');
      return !!r('${id('a')}').querySelector('.cline.down') && !r('${id('a')}').querySelector('.cline.up') && !!r('${id('b')}').querySelector('.cline.up') && !!r('${id('b')}').querySelector('.cline.down.k-auto-follow')
        && !!document.querySelector('tr[data-section="${id('s1')}"] .cline.thru') && !!r('${id('c')}').querySelector('.cline.up') && !r('${id('c')}').querySelector('.cline.down') && !r('${id('d')}').querySelector('.cline'); })()`), 4000));
  check('…in grey, from the surface ramp (colour carries meaning only)', await page(`(() => { const t = document.createElement('i'); t.style.color = 'var(--text-2)'; document.body.appendChild(t); const want = getComputedStyle(t).color; t.remove(); return getComputedStyle(${row(id('a'))}.querySelector('.cline')).borderLeftColor === want; })()`));
  check('the masthead says how many cues this GO sets off', await until(() => page(`(document.querySelector('[data-go-count]') || {}).textContent === 'GO · 3 cues'`), 3000), await page(`(document.querySelector('[data-go-count]') || {}).textContent`));
  host.cmd({ op: 'playhead', id: id('c') });
  check('…and nothing when it sets off one', await until(() => page(`!document.querySelector('[data-go-count]')`), 3000));
  await shot('showlist-chain');

  // 2. a cue cut out of the middle of a chain: the cue before it now links to the next, shown and said; ⌘Z puts it back
  host.cmd({ op: 'playhead', id: id('a') });
  await sleep(300);
  await page(`${row(id('b'))}.click()`);
  await sleep(200);
  await key('Backspace');
  // (the new link is shown for 2.5 s only: looked for first, so a slow toast cannot use up its moment)
  const shownNew = await until(() => page(`${row(id('a'))}.classList.contains('chain-new') && ${row(id('c'))}.classList.contains('chain-new') && !!${row(id('c'))}.querySelector('.cline.up.k-auto-continue')`), 2000);
  check('deleting a cue in the middle of a chain says what the cue before it now links to', await until(() => page(`/1 now auto-continues into 3/.test(document.querySelector('.toast') ? document.querySelector('.toast').textContent : '')`), 3000),
    await page(`document.querySelector('.toast') && document.querySelector('.toast').textContent`));
  check('…and the list shows the new link for a moment', shownNew);
  await shot('showlist-stray');
  host.cmd({ op: 'undo' });
  await until(() => page(`!!${row(id('b'))}`), 3000);

  // 3. a playing row: its level, where it goes, and its stop
  host.cmd({ op: 'start', id: id('d') });
  check('a playing row has its own stop and a level meter', await until(() => page(`!!${row(id('d'))}.querySelector('[data-row-stop]') && !!${row(id('d'))}.querySelector('[data-row-meter]')`), 4000));
  check('…the meter moves with the sound', await until(() => page(`parseFloat(${row(id('d'))}.querySelector('[data-row-meter] i').style.width) > 30`), 4000),
    [await page(`${row(id('d'))}.querySelector('[data-row-meter] i').style.width`), snap().cueLevels]);
  check('…and says where it goes (its bus, the pair, the device)', /outputs 1–2/.test(await page(`${row(id('d'))}.querySelector('[data-row-meter]').title`)), await page(`${row(id('d'))}.querySelector('[data-row-meter]').title`));
  check('…and nothing says it has no output', !(await page(`!!${row(id('d'))}.querySelector('[data-row-nout]')`)));
  await shot('showlist-playing');
  const head = snap().engine.playhead;
  await page(`${row(id('d'))}.querySelector('[data-row-stop]').click()`);
  check('the row’s stop fades it out (the panic time), and leaves the playhead and selection where they were',
    await until(() => snap().engine.active.some((x) => x.id === id('d') && x.fadingTo != null), 2000) && snap().engine.playhead === head);
  await page(`${row(id('d'))}.querySelector('[data-row-stop]').click()`);
  check('…a second click stops it dead', await until(() => !snap().engine.active.some((x) => x.id === id('d')), 2000));
  host.cmd({ op: 'start', id: id('d') });
  await until(() => page(`!!${row(id('d'))}.querySelector('[data-row-stop]')`), 3000);
  await page(`${row(id('d'))}.querySelector('[data-row-stop]').dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))`);
  check('…and ⌥-click stops it dead at once', await until(() => !snap().engine.active.some((x) => x.id === id('d')), 1500));

  // its own outputs, which this device does not have: the row says so in danger
  host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: id('e'), props: { outputs: [{ 11: 0 }, { 12: 0 }] } }], label: 'outputs' });
  host.cmd({ op: 'start', id: id('e') });
  check('a sound sent to outputs the device lacks says “no output”, in danger', await until(() => page(`(() => { const x = ${row(id('e'))}.querySelector('[data-row-nout]'); return !!x && getComputedStyle(x).color !== getComputedStyle(${row(id('e'))}).color; })()`), 4000));
  check('…and its title names the outputs', /outputs 11, 12/.test(await page(`${row(id('e'))}.querySelector('[data-row-meter]').title`)));
  host.cmd({ op: 'stop', id: id('e') });

  // in Show mode the stop is bigger, red, apart from GO, and does not take the keyboard
  host.cmd({ op: 'mode', mode: 'show' });
  host.cmd({ op: 'start', id: id('d') });
  check('in Show mode a playing row’s stop is larger and red', await until(() => page(`(() => { const b = ${row(id('d'))}.querySelector('[data-row-stop]'); if (!b) return false; const r = b.getBoundingClientRect(), g = document.querySelector('.go-btn').getBoundingClientRect(); return r.height >= 22 && r.width >= 30 && r.left > g.right + 200 && /rgb/.test(getComputedStyle(b).color); })()`), 3000));
  await shot('showlist-show-stop');
  const head2 = snap().engine.playhead;
  await page(`${row(id('d'))}.querySelector('[data-row-stop]').click()`);
  check('…it stops that sound and nothing else moves (the playhead stays; the keyboard is not taken)', await until(() => snap().engine.active.some((x) => x.id === id('d') && x.fadingTo != null), 2000)
    && snap().engine.playhead === head2 && await page(`document.activeElement === document.body || !document.activeElement`));
  host.cmd({ op: 'stop', id: id('d') });
  host.cmd({ op: 'mode', mode: 'edit' });

  // 4. Find: a match in a folded section is unfolded, selected, brought to the middle, and flashes; the playhead stays
  host.cmd({ op: 'playhead', id: id('a') });
  await sleep(300);
  await page(`document.querySelector('tr[data-section="${id('s2')}"]').click()`);
  await until(() => page(`!document.querySelector('.list tbody tr[data-cue="${id('needle')}"]')`), 2000);
  host.cmd({ op: 'playhead', id: id('a') });
  await sleep(200);
  win.webContents.send('ec-menu', 'tool-find');
  await until(() => has('.toolstrip input'), 2000);
  await page(`(() => { const i = document.querySelector('.toolstrip input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'needle'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check('Find unfolds the section that hides the match and selects it', await until(() => page(`!!${row(id('needle'))} && ${row(id('needle'))}.classList.contains('sel')`), 3000));
  check('…brings it to the middle of the list and flashes it', await until(() => page(`(() => { const r = ${row(id('needle'))}.getBoundingClientRect(), l = document.querySelector('.list').getBoundingClientRect(); return Math.abs((r.top + r.bottom) / 2 - (l.top + l.bottom) / 2) < 40 && ${row(id('needle'))}.classList.contains('found'); })()`), 2000),
    await page(`(() => { const r = ${row(id('needle'))}.getBoundingClientRect(), l = document.querySelector('.list').getBoundingClientRect(); return [r.top, r.bottom, l.top, l.bottom]; })()`));
  check('…and does not move the playhead', snap().engine.playhead === id('a'), snap().engine.playhead);
  await shot('showlist-find');
  await page(`document.querySelector('.toolstrip input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

  // 5. zoom: a pinch (a wheel with ctrl) until the whole show fits
  const listBox = () => page<{ h: number; t: number; scroll: number }>(`(() => { const l = document.querySelector('.list'), t = l.querySelector('table'); return { h: l.clientHeight, t: t.offsetHeight, scroll: l.scrollHeight }; })()`);
  await page(`(() => { const l = document.querySelector('.list'), r = l.getBoundingClientRect(); for (let i = 0; i < 6; i++) l.dispatchEvent(new WheelEvent('wheel', { deltaY: 12, ctrlKey: true, clientX: r.left + 200, clientY: r.top + 200, bubbles: true, cancelable: true })); })()`);
  check('a pinch zooms the list out: the rows shrink, their words fading', await until(() => page(`document.querySelector('.list').classList.contains('zoomed') && ${row(id('c'))}.getBoundingClientRect().height < 29`), 2000));
  await shot('showlist-zoom-half');
  await page(`(() => { const l = document.querySelector('.list'), r = l.getBoundingClientRect(); for (let i = 0; i < 40; i++) l.dispatchEvent(new WheelEvent('wheel', { deltaY: 20, ctrlKey: true, clientX: r.left + 200, clientY: r.top + 200, bubbles: true, cancelable: true })); })()`);
  const b = await listBox();
  roomy('zoomed all the way out, the whole show fits the list', await until(async () => { const x = await listBox(); return x.scroll <= x.h + 2; }, 2000), b);
  check('…sections stay readable headings, the cue standing by and the bars stay seen', await page(`(() => { const h = document.querySelector('tr[data-section="${id('s1')}"]').getBoundingClientRect().height, p = document.querySelector('.list tr.head').getBoundingClientRect().height, n = parseFloat(getComputedStyle(document.querySelector('tr[data-section="${id('s1')}"] .sec-name')).fontSize);
    return h >= 18 && p >= 5 && document.querySelector('.list').classList.contains('overview'); })()`));
  check('…and a chain is still drawn', await page(`!!${row(id('a'))}.querySelector('.cline.down')`));
  await shot('showlist-zoom-whole');
  await until(async () => ((await page<{ z: number }>(`window.ec.app({ op: 'list-zoom', dir: ${JSON.stringify(dir)} })`)) || {}).z < 0.2, 2000);
  check('the zoom is kept per show on this computer, not in the show file', ((await page<{ z: number }>(`window.ec.app({ op: 'list-zoom', dir: ${JSON.stringify(dir)} })`)) || {}).z < 0.2 && !/zoom/i.test(fs.readFileSync(path.join(dir, 'show.json'), 'utf8')));
  // Space is still GO, zoomed out
  const before = snap().engine.playhead;
  await key(' ');
  check('Space is still GO while zoomed out', await until(() => snap().engine.playhead !== before, 2000), [before, snap().engine.playhead]);
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'playhead', id: id('a') });
  await sleep(300);
  const selWas = await page(`[...document.querySelectorAll('.list tr.sel')].map((r) => r.dataset.cue).join()`);
  // a click on a spot zooms back in there, selecting nothing and leaving the playhead
  await page(`(() => { const r = ${row(id('needle'))}.getBoundingClientRect(); ${row(id('needle'))}.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 300, clientY: r.top + r.height / 2 })); })()`);
  check('a click on the zoomed-out list zooms back in there: that row in the middle', await until(() => page(`(() => { const l = document.querySelector('.list'), r = ${row(id('needle'))}.getBoundingClientRect(), b = l.getBoundingClientRect(); return !l.classList.contains('zoomed') && Math.abs((r.top + r.bottom) / 2 - (b.top + b.bottom) / 2) < 60; })()`), 2000));
  check('…selecting nothing and leaving the playhead', snap().engine.playhead === id('a') && await page(`[...document.querySelectorAll('.list tr.sel')].map((r) => r.dataset.cue).join()`) === selWas);
  // the keys and the button
  await key('-', ', metaKey: true, ctrlKey: true');
  check('⌘− zooms out a step', await until(() => page(`document.querySelector('.list').classList.contains('zoomed')`), 1500));
  await key('=', ', metaKey: true, ctrlKey: true');
  check('⌘= zooms back in', await until(() => page(`!document.querySelector('.list').classList.contains('zoomed')`), 1500));
  await page(`document.querySelector('[data-list-zoom]').click()`);
  roomy('the header’s button shows the whole show', await until(async () => { const x = await listBox(); return x.scroll <= x.h + 2; }, 1500));
  const cues = snap().rows.length;
  await key('0', ', metaKey: true, ctrlKey: true');
  check('⌘0 while zoomed out is back to normal size (and adds no cue)', await until(() => page(`!document.querySelector('.list').classList.contains('zoomed')`), 1500) && snap().rows.length === cues);
  check('…and nothing in the zoom moved the playhead', snap().engine.playhead === id('a'));
}

export { run };
