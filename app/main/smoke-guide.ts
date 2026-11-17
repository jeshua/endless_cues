/**
 * The assistant pointing at the window (show_in_app; core/ui/places.js, app/renderer/Point.js), run by smoke.js near
 * its end. Checked here: the built-in helper asked where a cue's colour is changed and what the key for Panic is,
 * each answered from the guide and the place ringed (the ring is around the right element, its words beside it);
 * a place pointed at with no model at all (an inspector tab brought forward, a cue's row, a Settings pane), "Show
 * me" ringing it again, a click taking the ring away, and Show mode refusing with nothing drawn.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function run({ host, win, check, until, page, sleep, shot: take }) {
  const shot = async (name) => { try { if (take) await take(name); } catch { /* no picture */ } };
  const snap = () => host.snapshot();
  const has = (sel) => page(`!!document.querySelector(${JSON.stringify(sel)})`);
  // whether the ring is drawn around the element `sel` finds (within a few pixels), and its words
  const ringed = (sel) => page(`(() => {
    const ring = document.querySelector('[data-point-ring]'), el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getBoundingClientRect().width > 0);
    if (!ring || !el) return null;
    const a = ring.getBoundingClientRect(), b = el.getBoundingClientRect();
    const near = Math.abs(a.left - b.left) < 9 && Math.abs(a.top - b.top) < 9 && Math.abs(a.right - b.right) < 9 && Math.abs(a.bottom - b.bottom) < 9;
    const say = document.querySelector('[data-point-say]');
    return { near, say: say ? say.textContent : '', pulse: getComputedStyle(ring).animationName, pointer: getComputedStyle(ring).pointerEvents,
      still: matchMedia('(prefers-reduced-motion: reduce)').matches };
  })()`);
  const lastSaid = () => (snap().assistant.transcript || []).filter((m) => m.role === 'assistant').slice(-1)[0] || {};

  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-guide-')), 'Demo.ecshow');
  require('../../examples/make-demo').makeDemo(dir);
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'mode', mode: 'edit' });
  host.open(dir);
  await until(() => snap().rows.length >= 10, 6000);
  await until(() => page('document.querySelectorAll(".list tbody tr").length >= 10'), 3000);
  win.setContentSize(1480, 940); await sleep(200);
  await page(`window.ec.cmd({ op: 'assistant-reset' }).then(() => window.ec.app({ op: 'assistant-config', config: { provider: 'demo' } })).then(() => window.ec.cmd({ op: 'state' }))`);
  await until(() => snap().assistant.provider === 'demo', 3000);
  if (!(await has('[data-assistant]'))) win.webContents.send('ec-menu', 'assistant-open');
  await until(() => has('[data-assistant] .compose textarea'), 3000);

  // ── the built-in helper: where a cue's colour is changed, and the key for Panic ──
  await page(`window.ec.cmd({ op: 'ask', text: 'Where do I change the colour of a cue?' })`);
  await until(() => /Colour/.test(lastSaid().text || ''), 4000);
  check('the helper says where a cue’s colour is changed, from the app’s guide', /Basics ▸ Colour/.test(lastSaid().text || '') && (lastSaid().points || [])[0] && lastSaid().points[0].target === 'inspector-field:color', lastSaid());
  const colour = await until(async () => { const r = await ringed('[data-field="color"]'); return r && r.near; }, 3000);
  check('…and the Colour field is ringed in the inspector (a cue selected, Basics brought forward)', colour && (await has('[data-insp-tab="basics"].on')) && snap().assistant && (await ringed('[data-field="color"]')).pointer === 'none', await ringed('[data-field="color"]'));
  // (a computer with animations off, as Windows Server is, asks for reduced motion: then the ring holds still)
  const rung = (await ringed('[data-field="color"]')) || {};
  check('…its words beside it, and the ring breathes in the accent (or holds still when the computer asks for less motion)', /Colour/.test(rung.say) && rung.pulse === (rung.still ? 'none' : 'point-pulse'), rung);
  check('…and the reply has a “Show me”', await until(() => has('[data-assistant] [data-show-me="inspector-field:color"]'), 2000));
  check('…while nothing was changed: the show has no unsaved edit', !snap().show.dirty, snap().show.unsaved);
  await shot('guide-1-colour');

  await page(`window.ec.cmd({ op: 'ask', text: 'What’s the key for Panic?' })`);
  await until(() => /Esc/.test(lastSaid().text || ''), 4000);
  check('the helper gives the key for Panic (Esc), from the key table', /^The key is Esc\./.test(lastSaid().text || ''), lastSaid().text);
  check('…and rings the Panic button', await until(async () => { const r = await ringed('[data-panic]'); return r && r.near; }, 3000), await ringed('[data-panic]'));
  await shot('guide-2-panic');
  // a click anywhere takes the ring away (and is let through)
  await page(`document.querySelector('.footer').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  check('a click takes the ring away', await until(async () => !(await has('[data-point-ring]')), 1000));

  // ── with no model: the host asked to point, as the tool does ──
  const trig = await host.cmd({ op: 'point', target: 'inspector-tab:triggers', say: 'Hotkeys and MIDI notes' });
  check('pointing at the inspector’s Triggers tab brings it forward, and the window says it could', trig && trig.ok === true && (await has('[data-insp-tab="triggers"].on')), trig);
  check('…the tab is ringed, with the words given', await until(async () => { const r = await ringed('[data-insp-tab="triggers"]'); return r && r.near && r.say === 'Hotkeys and MIDI notes'; }, 2000), await ringed('[data-insp-tab="triggers"]'));
  await shot('guide-3-triggers');
  const rain = host.document.doc.lists[0].cues.find((c) => c.children && c.children.some((k) => k.name === 'Rain'));
  const inner = rain.children.find((k) => k.name === 'Rain');
  // (a cue inside a group, folded away first: pointing unfolds it and selects it)
  await page(`window.ec.cmd({ op: 'state' })`);
  const row = await host.cmd({ op: 'point', target: `cue:${inner.id}`, say: 'This one' });
  check('pointing at a cue inside a group selects it and rings its row', row && row.ok && await until(async () => { const r = await ringed(`.list tr[data-cue="${inner.id}"]`); return r && r.near; }, 2000), [row, await ringed(`.list tr[data-cue="${inner.id}"]`)]);
  await shot('guide-4-cue');
  const pane = await host.cmd({ op: 'point', target: 'settings:audio' });
  check('pointing at a Settings pane opens Settings there and rings it', pane && pane.ok && await has('.modal') && await until(async () => { const r = await ringed('.modal nav [data-section="audio"]'); return r && r.near; }, 2000), pane);
  await shot('guide-5-settings');
  const back = await host.cmd({ op: 'point', target: 'mixer' });
  check('…and pointing at something under it closes Settings first', back && back.ok && !(await has('.modal')), back);
  const bad = await host.cmd({ op: 'point', target: 'the moon' });
  check('a place that is not one is refused, with the places there are', bad && /no place called[\s\S]*panic/.test(bad.error || ''), bad);
  const absent = await host.cmd({ op: 'point', target: 'row-stop' });
  check('a place not on the screen says so (a row’s ■ while nothing plays)', absent && absent.ok === false && /while that cue plays/.test(absent.why), absent);

  // "Show me" repeats it
  await page(`document.querySelector('.footer').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await page(`document.querySelector('[data-assistant] [data-show-me="inspector-field:color"]').click()`);
  check('“Show me” rings the place again', await until(async () => { const r = await ringed('[data-field="color"]'); return r && r.near; }, 3000));

  // ── Show mode: nothing is pointed at ──
  host.cmd({ op: 'mode', mode: 'show' });
  check('Show mode takes a ring away at once', await until(async () => !(await has('[data-point-ring]')), 1500));
  const locked = await host.cmd({ op: 'point', target: 'panic' });
  await sleep(300);
  check('…and refuses to point, drawing nothing', locked && locked.ok === false && /Show mode/.test(locked.why) && !(await has('[data-point-ring]')), locked);
  host.cmd({ op: 'mode', mode: 'edit' });
  await page(`window.ec.cmd({ op: 'assistant-reset' })`);
}

export { run };
