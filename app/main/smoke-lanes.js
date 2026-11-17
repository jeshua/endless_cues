/**
 * The smoke run's checks of a sound's lines (core/audio/lanes.js) and of what is dragged on its waveform:
 *
 *   editing()   Time & Loops, on the cue smoke-audio.js has open: a point added on the Volume line, dragged, bent,
 *               selected with others and deleted; the lane picker and a Pan line; a marker made, dragged, renamed
 *               and ⌥-clicked away; a loop region's edge and its middle dragged; Show mode moving nothing.
 *   heard()     the audio window: a pan as a difference between the two outputs' meters, a Pan line, a filter's
 *               frequency following its line, a bent Volume line under a straight one, and a line drawn again while
 *               the sound plays.
 *
 * Nothing is listened to (a test run has no device): levels are the audio window's own meters and gains.
 */
const path = require('path');
const show = require('../../core/show/show');

/** Pointer events on the waveform's parts, at a fraction of the width and a height in px (or a fraction). */
const pointer = (sel, steps, opts = {}) => `(async () => {
  const el = document.querySelector(${JSON.stringify(sel)}), wave = document.querySelector('[data-wavedit]');
  if (!el || !wave) return 'no ' + ${JSON.stringify(sel)};
  const box = wave.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  for (const [type, fx, y] of ${JSON.stringify(steps)}) {
    const init = { bubbles: true, button: 0, pointerId: 1, clientX: box.left + fx * box.width, clientY: r.top + (y <= 1 ? y * r.height : y), altKey: ${!!opts.alt}, metaKey: ${!!opts.meta}, ctrlKey: ${!!opts.meta}, shiftKey: false };
    el.dispatchEvent(type === 'dblclick' ? new MouseEvent('dblclick', init) : new PointerEvent(type, init));
    await new Promise((q) => setTimeout(q, 40));
  }
  return 'ok';
})()`;
// the y (px, in the waveform) the Volume line is drawn at for a level: the fader's law, as WaveEdit.js draws it
const volY = (d) => `(() => { const h = document.querySelector('[data-wavedit]').clientHeight, u = ${d} <= -60 ? 0 : Math.pow((${d} + 60) / 72, 2.2); return (1 - u) * (h - 8) + 4; })()`;

async function editing({ host, check, until, page, sleep, cue, edit }) {
  const dur = host.snapshot().engine.durations[cue().file] || 3;
  const fx = (t) => t / dur;
  const env = () => cue().envelope || [];
  const was = env().length;
  // ── the Volume line, always drawn: a click on it adds a point there, on the line ──
  check('the Volume line is drawn without being asked for, with its points', await until(() => page(`!!document.querySelector('[data-wavedit] svg[data-lane-svg="volume"] path.line') && document.querySelectorAll('[data-wavedit] svg circle').length === ${was}`), 3000));
  const y0 = await page(volY(0));
  await page(pointer('[data-wavedit]', [['pointerdown', fx(2.1), y0], ['pointerup', fx(2.1), y0]])); edit(1);
  check('a click on the line adds a point there, at the line’s level', await until(() => env().length === was + 1 && env().some((p) => Math.abs(p[0] - 2.1) < 0.06 && Math.abs(p[1]) < 0.6), 2000), env());
  await page(pointer('[data-wavedit]', [['pointerdown', fx(2.1), y0], ['pointermove', fx(2.1), y0 + 15], ['pointermove', fx(2.1), y0 + 30], ['pointerup', fx(2.1), y0 + 30]])); edit(1);
  check('a point dragged down lowers the level there, at the same time', await until(() => env().some((p) => Math.abs(p[0] - 2.1) < 0.06 && p[1] < -3), 2000), env());
  // ⌥-drag on the rising stretch (0.6 s to 1.4 s) bends it
  const yMid = await page(volY(-30));
  await page(pointer('[data-wavedit]', [['pointerdown', fx(1.0), yMid], ['pointermove', fx(1.0), yMid - 15], ['pointermove', fx(1.0), yMid - 30], ['pointerup', fx(1.0), yMid - 30]], { alt: true })); edit(1);
  check('an ⌥-drag on the line bends it: a bulge up on a rising stretch is a bend below 0, kept on its first point', await until(() => { const p = env().find((q) => Math.abs(q[0] - 0.6) < 0.01); return p && p[2] < 0; }, 2000), env());
  const yLow = await page(`(() => { const c = [...document.querySelectorAll('[data-wavedit] svg circle')]; return c.length; })()`);
  const lowered = env().find((p) => Math.abs(p[0] - 2.1) < 0.06);
  const yDown = await page(volY(lowered ? lowered[1] : 0));
  await page(pointer('[data-wavedit]', [['pointerdown', fx(lowered[0]), yDown], ['pointerup', fx(lowered[0]), yDown], ['dblclick', fx(lowered[0]), yDown]])); edit(1);
  check('a double-click on a point removes it', await until(() => env().length === was && !env().some((p) => Math.abs(p[0] - 2.1) < 0.06), 2000), [env(), yLow]);
  // ⌘-drag a box round two points, and Delete takes both (and not the cue)
  const cues = host.snapshot().rows.length, top = await page(volY(12)), foot = await page(`document.querySelector('[data-wavedit]').clientHeight - 2`);
  await page(pointer('[data-wavedit]', [['pointerdown', fx(0.45), top], ['pointermove', fx(1.0), foot], ['pointermove', fx(1.55), foot], ['pointerup', fx(1.55), foot]], { meta: true }));
  check('a ⌘-drag selects the points inside its box', await until(() => page(`document.querySelectorAll('[data-wavedit] svg circle.on').length === 2`), 2000));
  await page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true }))`); edit(1);
  check('…and Delete removes them, leaving the cue where it was', await until(() => env().length === was - 2, 2000) && host.snapshot().rows.length === cues, [env(), host.snapshot().rows.length, cues]);

  // ── the lane picker: Pan, then back to Volume ──
  await page(`document.querySelector('[data-lane-pick]').click()`);
  check('the lane picker lists Volume and Pan, with a dot on the line that has points', await until(() => page(`!!document.querySelector('[data-lane-menu] [data-lane="pan"]') && !!document.querySelector('[data-lane-menu] [data-lane="volume"] .lane-dot.has') && !document.querySelector('[data-lane-menu] [data-lane="pan"] .lane-dot.has')`), 2000));
  await page(`document.querySelector('[data-lane-menu] [data-lane="pan"]').click()`);
  await until(() => page(`!!document.querySelector('svg[data-lane-svg="pan"]')`), 2000);
  const yPan = await page(`(() => { const h = document.querySelector('[data-wavedit]').clientHeight; return 0.5 * (h - 8) + 4; })()`);
  await page(pointer('[data-wavedit]', [['pointerdown', fx(0.5), yPan], ['pointermove', fx(0.5), yPan - 20], ['pointerup', fx(0.5), yPan - 20]])); edit(1);
  check('on the Pan line, a point added and dragged up is a pan to the right, kept in the cue’s automation', await until(() => { const a = (cue().automation || {}).pan; return a && a.length === 1 && a[0][1] > 10; }, 2000) && await page(`document.querySelectorAll('[data-wavedit] svg path.other').length === 1`), cue().automation);
  await page(`document.querySelector('[data-lane-pick]').click()`);
  await until(() => page(`!!document.querySelector('[data-lane-menu] [data-lane="volume"]')`), 2000);
  await page(`document.querySelector('[data-lane-menu] [data-lane="volume"]').click()`);

  // ── markers: made by a drag on the strip, dragged, renamed, ⌥-clicked away ──
  const marks = () => cue().markers || [];
  const m0 = marks().length;
  await page(pointer('[data-markers]', [['pointerdown', fx(1.5), 0.5], ['pointermove', fx(1.6), 0.5], ['pointermove', fx(1.7), 0.5], ['pointerup', fx(1.7), 0.5]])); edit(1);
  check('a drag on the marker strip makes a marker where it is let go', await until(() => marks().length === m0 + 1 && marks().some((m) => Math.abs(m.at - 1.7) < 0.06), 2000), marks());
  const flag = () => page(`[...document.querySelectorAll('[data-mflag]')].findIndex((el) => el.textContent.includes('Marker'))`);
  const fi = await flag();
  await page(pointer(`[data-mflag="${fi}"]`, [['pointerdown', fx(1.7) + 0.003, 0.5], ['pointermove', fx(1.2), 0.5], ['pointermove', fx(0.9) + 0.003, 0.5], ['pointerup', fx(0.9) + 0.003, 0.5]])); edit(1);
  check('a marker dragged along the strip moves there', await until(() => marks().some((m) => /Marker/.test(m.name) && Math.abs(m.at - 0.9) < 0.07), 2000), marks());
  const fj = await flag();
  await page(`document.querySelector('[data-mflag="${fj}"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await until(() => page(`!!document.querySelector('[data-marker-name]')`), 2000);
  await page(`(() => { const el = document.querySelector('[data-marker-name]'); el.value = 'Chorus'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`); edit(1);
  check('a double-click on a marker’s name renames it in place', await until(() => marks().some((m) => m.name === 'Chorus'), 2000), marks());
  const chorus = () => page(`[...document.querySelectorAll('[data-mflag]')].findIndex((el) => el.textContent.includes('Chorus'))`);
  await until(async () => (await chorus()) >= 0, 2000);              // (the window draws the new name a moment after the show has it)
  const fk = await chorus();
  await page(pointer(`[data-mflag="${fk}"]`, [['pointerdown', fx(0.9) + 0.003, 0.5], ['pointerup', fx(0.9) + 0.003, 0.5]], { alt: true })); edit(1);
  check('an ⌥-click on a marker removes it', await until(() => marks().length === m0 && !marks().some((m) => m.name === 'Chorus'), 2000), marks());

  // ── a loop region: an edge dragged, then the whole of it ──
  const g = () => (cue().loops || [])[0];
  const g0 = g();
  await page(pointer('[data-loop="0"]', [['pointerdown', fx(g0.start) + 0.004, 0.5], ['pointermove', fx(g0.start - 0.15), 0.5], ['pointermove', fx(g0.start - 0.3) + 0.002, 0.5], ['pointerup', fx(g0.start - 0.3) + 0.002, 0.5]])); edit(1);
  check('a loop region’s start dragged moves its start, its end stays', await until(() => Math.abs(g().start - (g0.start - 0.3)) < 0.06 && Math.abs(g().end - g0.end) < 0.01, 2000), [g0, g()]);
  const g1 = g(), mid = (g1.start + g1.end) / 2;
  await page(pointer('[data-loop="0"]', [['pointerdown', fx(mid), 0.5], ['pointermove', fx(mid + 0.1), 0.5], ['pointermove', fx(mid + 0.2), 0.5], ['pointerup', fx(mid + 0.2), 0.5]])); edit(1);
  check('…and its middle dragged moves the whole region, the same length', await until(() => Math.abs(g().start - (g1.start + 0.2)) < 0.06 && Math.abs((g().end - g().start) - (g1.end - g1.start)) < 0.01, 2000), [g1, g()]);

  // ── Show mode: everything drawn, nothing moves ──
  host.cmd({ op: 'mode', mode: 'show' });
  // (Show mode may put the inspector away altogether; where it is still drawn, it is locked)
  await until(() => page(`!document.querySelector('.wavedit') || !!document.querySelector('.wavedit.locked')`), 2000);
  const n = env().length, ml = marks().length;
  await page(pointer('[data-wavedit]', [['pointerdown', fx(2.0), y0], ['pointerup', fx(2.0), y0]]));
  await page(pointer('[data-markers]', [['pointerdown', fx(1.0), 0.5], ['pointerup', fx(1.0), 0.5]]));
  await sleep(250);
  check('in Show mode a click on the line or the marker strip changes nothing', env().length === n && marks().length === ml && await page(`!document.querySelector('.wavedit') || !!document.querySelector('.wavedit.locked [data-wavedit] svg path.line')`), [env(), marks()]);
  host.cmd({ op: 'mode', mode: 'edit' });
  await until(() => page(`!!document.querySelector('.wavedit') && !document.querySelector('.wavedit.locked')`), 3000);

  // ── a song's sections cleared at once: Remove all, beside the markers ──
  const keep = cue().markers || [];
  host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: cue().id, props: { markers: [{ at: 0.5, name: 'Verse' }, { at: 1.5, name: 'Chorus' }] } }], label: 'sections' }); edit(1);
  await until(() => (cue().markers || []).length === 2, 2000);
  await page(`(() => { const b = [...document.querySelectorAll('.inspector .tabs button')].find((x) => x.textContent === 'Time & Loops'); if (b && !b.classList.contains('on')) b.click(); })()`);
  const shown = await until(() => page(`!!document.querySelector('[data-markers-clear]')`), 3000);
  check('two markers: a Remove all beside them', shown, [cue().markers, await page(`document.querySelector('.inspector .tabs') && document.querySelector('.inspector .tabs').textContent`)]);
  if (shown) { await page(`document.querySelector('[data-markers-clear]').click()`); edit(1); }
  check('Remove all takes every marker away at once', await until(() => !(cue().markers || []).length, 2000), cue().markers);
  if (keep.length) { host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: cue().id, props: { markers: keep } }], label: 'markers back' }); edit(1); }
}

async function heard({ host, check, until, sleep }) {
  const snap = () => host.snapshot();
  const av = (js) => host.audioWindow().webContents.executeJavaScript(js, true);
  const list = host.document.doc.lists[0].id;
  const tone = require('./test-media').tone('wav');
  const idOf = (number) => (show.findByNumber(host.document.doc, number) || {}).id;
  let edits = 0;
  const edit = (ops, label) => { const r = host.cmd({ op: 'edit', ops, label }); if (r && !r.error) edits++; return r; };
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'mode', mode: 'edit' });
  edit([{ op: 'cue.add', cue: { type: 'audio', number: 'LN1', file: tone, gainDb: -12, loop: true, pan: -100 }, list },
        { op: 'cue.add', cue: { type: 'audio', number: 'LN2', file: tone, gainDb: -12, loop: true, automation: { pan: [[0, -100], [2.5, 100]] } }, list },
        { op: 'cue.add', cue: { type: 'audio', number: 'LN3', file: tone, gainDb: -12, loop: true, chain: { lowpass: { hz: 1000, slope: 12 } }, automation: { 'chain.lowpass.hz': [[0, 200], [2, 8000]] } }, list },
        { op: 'cue.add', cue: { type: 'audio', number: 'LN4', file: tone, gainDb: -12, loop: true, envelope: [[0, -40, 0.8], [2, 0]] }, list },
        { op: 'cue.add', cue: { type: 'audio', number: 'LN5', file: tone, gainDb: -12, loop: true, envelope: [[0, -40], [2, 0]] }, list }], 'lanes');
  await until(() => snap().engine.durations[tone] > 0, 3000);

  // ── a pan: hard left is all on output 1 ──
  host.cmd({ op: 'fire', number: 'LN1' });
  const outs = () => (snap().routing.outCh || []).slice(0, 2);
  const left = await until(() => { const [l, r] = outs(); return l > -40 && r <= -55; }, 3000);
  check('a sound panned hard left is heard on output 1 and not on output 2 (the meters)', left, outs());
  edit([{ op: 'cue.set', id: idOf('LN1'), props: { pan: 100 } }], 'pan');
  check('…and the Pan field moved to the right while it plays moves it to output 2', await until(() => { const [l, r] = outs(); return r > -40 && l <= -55; }, 3000), outs());
  host.cmd({ op: 'panic', hard: true });
  await sleep(300);

  // ── the lines followed as the sounds play ──
  for (const n of ['LN2', 'LN3', 'LN4', 'LN5']) host.cmd({ op: 'fire', number: n });
  const read = () => av(`(() => { const g = (n) => voices.get(n); const a = g(${JSON.stringify(idOf('LN2'))}), b = g(${JSON.stringify(idOf('LN3'))}), c = g(${JSON.stringify(idOf('LN4'))}), d = g(${JSON.stringify(idOf('LN5'))});
    const lp = b && b.fx && b.fx.plan.stages.find((s) => s.tool === 'lowpass');
    return { panL: a && a.pan ? a.pan.l.gain.value : null, panR: a && a.pan ? a.pan.r.gain.value : null, hz: lp ? lp.hz : null, bent: c && c.env ? c.env.gain.value : null, straight: d && d.env ? d.env.gain.value : null, at: d ? placeOf(d) : null }; })()`);
  await until(async () => { const x = await read(); return x.at > 0.15; }, 4000);
  const early = await read();
  await until(async () => { const x = await read(); return x.at > 1.0; }, 4000);
  const midway = await read();
  await until(async () => { const x = await read(); return x.at > 2.1 && x.at < 2.9; }, 4000);
  const late = await read();
  check('a Pan line moves the sound from left to right as it plays', early.panL > 1.2 && early.panR < 0.4 && late.panR > late.panL, { early, late });
  check('a filter’s line moves its frequency as the sound plays (along a ratio)', early.hz > 0 && early.hz < 500 && midway.hz > 800 && midway.hz < 2600 && late.hz > 4500, { early: early.hz, midway: midway.hz, late: late.hz });
  check('a bent Volume line is below the straight one half way (it starts slow), and both arrive', midway.bent < midway.straight * 0.7 && late.straight > 0.9 && late.bent > 0.9, { midway, late });
  // a line drawn again while it plays is heard at once
  edit([{ op: 'cue.set', id: idOf('LN5'), props: { envelope: [[0, -60]] } }], 'volume line');
  check('a line drawn again while the sound plays is followed at once', await until(async () => (await read()).straight < 0.01, 2000), await read());
  host.cmd({ op: 'panic', hard: true });
  for (; edits > 0; edits--) host.cmd({ op: 'undo' });
  await sleep(200);
}

module.exports = { editing, heard };
