/**
 * The assistant's drawer and its face, as a person meets them (docs/brand-assistant.md): run by smoke.js after
 * the rig's pages. Checked here: choosing who answers never leaves the drawer sitting unchanged, the few words the
 * first screen is allowed, and the resident (the assistant's eye in the side panel): there on a new show, a way into the
 * drawer, gone in Show mode, saying a waiting change with the app's own dot and words, hidden when
 * asked and still hidden after the page starts again, and never lying over anything at 1024 by 700.
 */
async function run({ host, win, check, until, page, sleep, shot: take }) {
  // (a picture is for looking at afterwards: one that cannot be taken never fails the run)
  const shot = async (name) => { try { if (take) await take(name); } catch { /* no picture */ } };
  const snap = () => host.snapshot();
  const has = (sel) => page(`!!document.querySelector(${JSON.stringify(sel)})`);
  const click = (sel) => page(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  const text = (sel) => page(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.innerText : null; })()`);
  const off = async () => {
    await page(`window.ec.cmd({ op: 'assistant-reset' }).then(() => window.ec.app({ op: 'assistant-config', config: { provider: 'off' } })).then(() => window.ec.cmd({ op: 'state' }))`);
    await until(() => snap().assistant.available === false && snap().assistant.chosen === 'off', 3000);
  };

  host.cmd({ op: 'mode', mode: 'edit' });
  if (!(await has('[data-assistant]'))) win.webContents.send('ec-menu', 'assistant-open');
  await until(() => has('[data-assistant]'), 3000);

  // ── who should answer: every row, pressed, ends in a place to type or in a line saying why not ──
  await off();
  await until(() => has('[data-who] [data-provider]'), 3000);
  const rows = await page(`[...document.querySelectorAll('[data-who] [data-provider]')].map((b) => ({ id: b.dataset.provider, words: b.querySelector('span').innerText.trim() }))`);
  check('each row of “Who should answer?” is a name and at most five words, with no brackets', rows.length >= 3 && rows.every((r) => r.words.split(/\s+/).length <= 5 && !/[()]/.test(r.words)), rows);
  check('…and there is no line under the rows', !(await has('[data-who] .wf')));
  for (const r of rows) {
    await off();
    await until(() => has(`[data-who] [data-provider="${r.id}"]`), 3000);
    await click(`[data-who] [data-provider="${r.id}"]`);
    const ended = await until(async () => (await has('.compose textarea')) || ((await text('[data-whynot]')) || '').trim().length > 0, 4000);
    check(`choosing “${r.id}” shows a place to type, or says in a line why it cannot answer`, ended, [snap().assistant.chosen, snap().assistant.missing, await text('[data-whynot]')]);
    if (r.id === 'claude-code' || r.id === 'codex') {
      check('…an agent chosen in a test window says so (it has no door to the app here)', /can’t be used in a test window|wasn’t found/.test((await text('[data-whynot]')) || ''), await text('[data-whynot]'));
      await shot('qirx-01-why-not');
    }
    if (r.id === 'cloud') {
      // a test run has no way to the service (main.js points it at a port nothing listens on): the sign-in it starts
      // ends in one line saying so, and the rows stay there to choose another
      const line = await until(async () => /internet/.test((await text('[data-whynot]')) || ''), 6000);
      const said = ((await text('[data-whynot]')) || '').trim();
      check('choosing the Endless Cues assistant with no network says why in one line, and the rows stay', line && !said.includes('\n') && said.split(/\s+/).length <= 10 && await has('[data-who] [data-provider="helper"]') && !(await has('.compose textarea')), [said, snap().assistant.cloud]);
      await shot('qirx-01b-cloud-offline');
    }
    // (a row that opens Settings on its provider: shut them again)
    if (await has('.modal')) { await page(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await click('.modal .close'); await until(async () => !(await has('.modal')), 2000); }
  }

  // ── an empty show's first screen: one line and one button ──
  await page(`window.ec.app({ op: 'new' })`);
  await until(() => snap().show.untitled && snap().rows.length === 0, 4000);
  await off();
  // (the choice is clicked again if the first click landed while the panel was being drawn)
  for (let n = 1; n <= 3; n++) {
    await click('[data-who] [data-provider="helper"]');
    if (await until(() => snap().assistant.provider === 'demo' && has('.compose textarea'), 3000)) break;
  }
  if (!(await has('[data-assistant]'))) win.webContents.send('ec-menu', 'assistant-open');
  await until(() => has('[data-first]'), 3000);
  const firstScreen = await page(`(() => { const f = document.querySelector('[data-first]'); return f ? { line: f.querySelector('.fline').innerText, asks: [...f.querySelectorAll('[data-ask]')].map((b) => b.innerText), rest: [...f.querySelectorAll('.fnext')].map((x) => x.innerText) } : null; })()`);
  check('an empty show’s first screen is one line and one button', !!firstScreen && firstScreen.line === 'An empty show.' && firstScreen.asks.length === 1 && firstScreen.rest.length === 0, firstScreen);
  await shot('qirx-02-empty');

  // ── the resident: the assistant's eye in the side panel ──
  const resident = () => page(`(() => { const r = document.querySelector('[data-resident]'); if (!r) return null; const q = r.querySelector('.qirx'); const css = (sel, prop) => { const el = q && q.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
    return { state: r.dataset.resident, why: r.dataset.why, words: (r.querySelector('[data-resident-words]') || {}).innerText || '', dot: !!r.querySelector('.dot.standby'), label: r.querySelector('b').innerText.trim(), fill: css('.win', 'fill'), lamp: css('.lamp', 'opacity'), size: q ? Math.round(q.getBoundingClientRect().width) : 0,
      moving: q ? [...q.querySelectorAll('polygon')].some((i) => getComputedStyle(i).animationName !== 'none') : null }; })()`);
  const settled = (want) => until(async () => { const x = await resident(); return !!x && want(x); }, 4000);
  await click('[data-assistant] [data-close]');
  await until(async () => !(await has('[data-assistant]')), 2000);
  check('on a new show the assistant’s eye is in the side panel, awake, saying what it is for', await settled((x) => x.state === 'awake' && /^Ask the assistant/.test(x.label) && x.size >= 18 && x.size <= 26), await resident());
  check('…at rest its eye is dark and still: it lights only while it answers', await settled((x) => x.lamp === '0' && x.moving === false), await resident());
  check('…and the title bar’s button has the same head as its sign', await has('[data-assistant-button] .qirx-sign path'));
  await click('[data-resident]');
  check('a click on it opens the assistant’s drawer', await until(() => has('[data-assistant]'), 2000));
  check('…where the same eye is beside the first line', await has('[data-first] .fface .qirx'));
  // a change waiting: the app's own yellow dot and a count, in words
  await page(`window.ec.cmd({ op: 'ask', text: 'add a memo called Interval' })`);
  await until(() => !!snap().proposal, 5000);
  check('a change waiting for review is said beside it with the app’s own yellow dot and a count', await settled((x) => x.state === 'waiting' && x.dot && x.words.trim() === '1 change to look at' && x.lamp === '0'), await resident());
  check('…and beside the reply in the drawer the eye is small', await has('.said .qirx'));
  // ── 1024 by 700: it lies over nothing ──
  const size = win.getContentSize();
  win.setContentSize(1024, 700);
  await until(() => page('window.innerWidth === 1024 && window.innerHeight === 700'), 3000);
  const over = () => page(`(() => { const r = document.querySelector('[data-resident]'); if (!r) return ['no resident']; const a = r.getBoundingClientRect(); const hits = [];
    const rows = [...document.querySelectorAll('.list tbody tr')];
    for (const [name, el] of [['GO', document.querySelector('.go-btn')], ['the Playing strip', document.querySelector('.playing')], ['the inspector', document.querySelector('.inspector')], ['the drawer', document.querySelector('.drawer-pane')], ['the last cue row', rows[rows.length - 1]], ['the mixer', document.querySelector('.side .knobs')], ['the transport', document.querySelector('.transport')], ['the footer', document.querySelector('.footer')]]) {
      if (!el) continue; const b = el.getBoundingClientRect(); if (b.width && b.height && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) hits.push(name); }
    const side = document.querySelector('.side').getBoundingClientRect(); if (a.left < side.left || a.right > side.right + 0.5) hits.push('outside the side panel');
    return hits; })()`);
  check('at 1024 by 700, with the drawer open and a change waiting, the eye lies over no control', (await over()).length === 0, await over());
  await shot('qirx-03-1024-drawer');
  await page(`window.ec.cmd({ op: 'accept', id: ${JSON.stringify((snap().proposal || {}).id || '')} })`);
  await until(() => !snap().proposal && snap().rows.length === 1, 3000);
  await click('[data-assistant] [data-close]');
  await until(async () => !(await has('[data-assistant]')), 2000);
  check('…and with the drawer shut', (await over()).length === 0, await over());
  await shot('qirx-04-1024');
  // ── Show mode: the assistant is not there at all ──
  await click('[data-resident]');
  await until(() => has('[data-assistant]'), 2000);
  host.cmd({ op: 'mode', mode: 'show' });
  check('in Show mode the assistant is gone: no resident, no title-bar button, and its open drawer shut', await until(async () => !(await has('[data-resident]')) && !(await has('[data-assistant-button]')) && !(await has('[data-assistant]')), 3000));
  await page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }))`);
  await sleep(300);
  check('…and its key does not bring it back', !(await has('[data-assistant]')));
  await shot('qirx-05-show-mode');
  host.cmd({ op: 'mode', mode: 'edit' });
  check('back in Edit it returns', await until(() => has('[data-resident]'), 3000) && await has('[data-assistant-button]'));
  await click('[data-resident]');
  await until(() => has('[data-assistant]'), 2000);
  await click('[data-assistant] [data-close]');
  win.setContentSize(size[0], size[1]);
  await until(() => page(`window.innerWidth === ${size[0]}`), 3000);
  // nobody answering: asleep, and "off"
  await off();
  check('with nobody set to answer the eye is asleep and says “off”', await settled((x) => x.state === 'asleep' && x.why === 'off' && x.words.trim() === 'off'), await resident());
  await page(`window.ec.app({ op: 'assistant-config', config: { provider: 'demo' } }).then(() => window.ec.cmd({ op: 'state' }))`);
  await until(() => snap().assistant.available, 3000);
  // ── hidden when asked (Settings ▸ Assistant), and it stays hidden when the page starts again ──
  win.webContents.send('ec-menu', 'settings');
  await until(() => has('.modal nav'), 3000);
  await page(`[...document.querySelectorAll('.modal nav button')].find((b) => b.textContent === 'Assistant').click()`);
  await until(() => has('[data-qirx-switch]'), 3000);
  check('Settings ▸ Assistant has the eye beside its heading and the switch that shows it', await has('.modal .qtitle .qirx'));
  await page(`document.querySelector('[data-qirx-switch]').firstElementChild.click()`);
  check('the eye can be hidden: the side panel is bare, the title bar’s button stays', await until(async () => !(await has('[data-resident]')), 3000) && await has('[data-assistant-button]'));
  await page(`[...document.querySelectorAll('.modal nav button')].find((b) => b.textContent === 'About').click()`);
  check('About says in one line what the QIRX are', /robot puppets from Endless Forms/.test((await text('.modal .pane')) || '') && await has('[data-about-qirx] .qirx'));
  win.webContents.reload();
  await new Promise((ok) => setTimeout(ok, 600));
  check('…and it is still hidden after the page starts again', await until(() => has('[data-assistant-button]'), 8000) && !(await has('[data-resident]')));
  await page(`window.ec.app({ op: 'view', view: { qirx: true } })`);
  check('…until it is asked back', await until(() => has('[data-resident]'), 3000));
}

module.exports = { run };
