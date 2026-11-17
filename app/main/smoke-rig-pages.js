/**
 * The smoke run's checks of the Rig's pages (docs/specs/15-assistant-and-rig.md, section 5; called from smoke.js):
 * the view switch and its page, the device editor, Try, the checklist, Show mode, a Device cue's row, the review
 * card's devices and files, the assistant drawer with no model, and Space on the Rig page.
 *
 * FIXTURES are invented states of the rig and of the assistant's first screen. A test run can lay them over what
 * the host pushes (`window.ecFixture`, which exists only when `ec.init().fixtures` is true: a smoke run or a driven
 * session, never the app as a person starts it), so that a page no equipment is here to produce can be drawn and
 * pictured: a rig in four states at once, a prop that answered a look (a smoke run sends nothing, so nothing
 * answers), and the first screen of shows this run does not build. Everything else below is checked against what
 * the host really pushes: the rows of core/rig/check.js, the assistant's own first screen, the kit's own options.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const NOW = 1731700000000;
const FIXTURES = {
  rig: {
    summary: { ready: 6, total: 10, look: 2, problems: 1, unknown: 1, at: NOW, text: '6 of 10 ready · 2 to look at · 1 problem' },
    items: [
      { id: 'show.saved', group: 'show', label: 'The show is saved', state: 'look', text: '3 unsaved changes', fix: 'Save (⌘S).', actions: [{ id: 'save', label: 'Save' }] },
      { id: 'show.backups', group: 'show', label: 'Backups are on', state: 'ready', text: 'every 5 minutes', fix: '' },
      { id: 'show.cues', group: 'show', label: 'Every cue can run', state: 'ready', text: '42 cues', fix: '' },
      { id: 'sound.output', group: 'sound', label: 'Sound goes to the interface', state: 'ready', text: '', fix: '' },
      { id: 'sound.files', group: 'sound', label: 'Every file is found', state: 'ready', text: '14 files', fix: '' },
      { id: 'device.lantern', group: 'equipment', label: 'Lantern', state: 'problem', text: 'not answering (last heard 2 min ago)', fix: 'Check its power, and that it is on the show’s Wi-Fi.', needed: true, actions: [{ id: 'ask', label: 'Ask again' }, { id: 'try', label: 'Try: Identify' }] },
      { id: 'device.desk_a', group: 'equipment', label: 'Lighting desk', state: 'ready', text: 'on cue 12 · 3 ms', fix: '' },
      { id: 'device.projector', group: 'equipment', label: 'The projector that hangs over the centre aisle, upstage rail 2', state: 'unknown', text: 'cannot be asked: press Try', fix: '', actions: [] },
    ],
    devices: {
      lantern: { state: 'problem', text: 'not answering (last heard 2 min ago)', heardAt: NOW - 120000, ageMs: 120000, lastOut: '/ec/identify', lastIn: '/ec/here lantern light 1.0 breathe 532 -52 18',
        reports: [{ key: 'fw', label: 'Firmware', value: '1.0' }, { key: 'signal', label: 'Signal', value: -52, unit: 'dBm', warn: false }, { key: 'battery', label: 'Battery', value: 18, unit: '%', warn: true }] },
      desk_a: { state: 'ready', text: 'answering · 3 ms', reports: [], lastOut: '/eos/ping', lastIn: '/eos/out/ping' },
      projector: { state: 'unknown', text: 'it cannot be asked', reports: [] },
    },
    ticks: { k2: true },
    found: [{ name: 'Lantern B', kind: 'light', fw: '1.0', host: '10.0.0.43', port: 53100, known: null, moved: false }, { name: 'Lantern', kind: 'light', fw: '1.0', host: '10.0.0.57', port: 53100, known: 'lantern', moved: true }],
    senders: [{ address: '10.0.0.99', port: 9000, count: 14, messages: [{ address: '/sensor/door', count: 14, every: 2 }], lastAt: NOW }],
  },
  first: {
    empty: { state: 'empty', line: 'An empty show.', asks: [{ label: 'Start from a folder of sounds…', text: '', offline: true }], next: { label: '', text: '' }, setup: null },
    folder: { state: 'folder', line: '11 sounds and 1 text file not in a cue yet.', asks: [{ label: 'Make cues from these 11 sounds', text: 'Make cues from the 11 sounds in this folder.', offline: true }, { label: 'Make cues from notes.txt', text: 'Read notes.txt and make cues from it.' }],
      next: { label: 'Next: tell me how each one should end.', text: '' }, setup: null },
    imported: { state: 'imported', line: 'Imported from QLab: 84 cues, 3 network patches, 6 things did not come across.', asks: [{ label: 'What did not come across?', text: 'What did not come across, and what should I do about each?' }, { label: 'Check the show for problems', text: 'Check the show for problems' }, { label: 'Make “Eos” a device', text: 'Turn the patch “Eos” into a device.' }],
      next: { label: '', text: '' }, setup: null },
    cues: { state: 'cues', line: '19 cues, 2 of them broken.', asks: [{ label: 'Fix the 2 broken cues', text: 'Fix the 2 broken cues.' }, { label: 'Renumber Main in tens', text: 'Renumber Main in tens.' }],
      next: { label: 'Next: tell me about your equipment.', text: '' }, setup: null },
    devices: { state: 'devices', line: '3 devices: 2 answering, Lantern is not.', asks: [{ label: 'Why is Lantern not answering?', text: 'Why is Lantern not answering?', offline: true }, { label: 'Add a cue: Power on and open the shutter slowly now to The projector that hangs over the centre aisle, upstage rail 2', text: 'Add a cue that sends power_on to projector.', offline: true },
      { label: 'Is everything ready?', text: 'Is everything ready?', offline: true }, { label: 'Write firmware for Lantern', text: 'Write firmware for Lantern.', offline: true }], next: { label: 'Next: ask me to hand the show over.', text: '' }, setup: null },
  },
};
const DEVICES = [
  { op: 'device.add', device: { id: 'lantern', name: 'Lantern', model: 'ec-prop-light', host: '127.0.0.1', notes: 'In the stage-left wing. Always-on power bank.' } },
  { op: 'device.add', device: { id: 'desk_a', name: 'Lighting desk', model: 'etc-eos', host: '10.0.0.20' } },
  { op: 'device.add', device: { id: 'projector', name: 'The projector that hangs over the centre aisle, upstage rail 2', kind: 'media', via: 'text', host: '10.0.0.77', port: 4352, protocol: 'tcp',
    commands: [{ id: 'power_on', label: 'Power on and open the shutter slowly now', template: '%1POWR {on}', params: [{ key: 'on', label: 'On', kind: 'enum', options: ['0', '1'], default: '1' }] }] } },
];

async function run({ host, win, check, until, page, sleep, shot }) {
  const snap = () => host.snapshot();
  const has = (sel) => page(`!!document.querySelector(${JSON.stringify(sel)})`);
  const click = (sel) => page(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  const text = (sel) => page(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.innerText : null; })()`);
  const fixture = (f) => page(`window.ecFixture ? (window.ecFixture(${JSON.stringify(f)}), true) : false`);
  const theme = (t) => page(`document.documentElement.dataset.theme = ${JSON.stringify(t)}`);
  // nothing on the page may be wider than the box it is in (a long name must wrap or be cut with its title, never push out)
  const overflow = () => page(`(() => { const root = document.querySelector('[data-rig]'); if (!root) return ['no rig']; const out = []; const lim = root.getBoundingClientRect().right + 1;
    for (const el of root.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.width && r.right > lim && getComputedStyle(el).position !== 'fixed') out.push((el.className || el.tagName) + ' ' + Math.round(r.right - lim)); }
    return out.slice(0, 5); })()`);

  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'mode', mode: 'edit' });
  host.openUntitled();
  await until(() => snap().show.untitled && snap().rows.length === 0, 4000);
  await page(`window.ec.app({ op: 'assistant-config', config: { provider: 'demo' } })`);

  // ── the view switch, and a plain show's Rig ──
  check('the tabs are always there, with Rig in them', await has('.titlebar [data-tabs] [data-tab="rig"][data-view-rig]'));
  const { Menu } = require('electron');
  const rigItem = (() => { const walk = (m) => { for (const i of m.items) { if (i.label === 'Rig') return i; if (i.submenu) { const x = walk(i.submenu); if (x) return x; } } return null; }; return walk(Menu.getApplicationMenu()); })();
  check('View ▸ Rig is in the menu, on ⇧⌘R', !!rigItem && /Shift\+R$/i.test(String(rigItem.accelerator || '').replace('CmdOrCtrl+', '')), rigItem && rigItem.accelerator);
  win.webContents.send('ec-menu', 'view-rig');
  check('…and goes to the Rig page', await until(() => has('[data-rig]'), 3000));
  const plain = snap().rig.items.filter((it) => !/^device\./.test(it.id) && !/before/i.test(it.group));
  check('a plain show draws its rows and the “No devices yet” line, and no editor', (await page(`document.querySelectorAll('[data-rig] .rig-row').length`)) === plain.length && /No devices yet/.test((await text('[data-rig-none]')) || '') && !(await has('[data-rig-editor]')),
    [plain.length, await page(`document.querySelectorAll('[data-rig] .rig-row').length`)]);
  // (unsaved changes are not counted: Save says so, and a brand-new show would otherwise wear a dot from the start)
  check('…with no dot on its tab unless something is not ready, the show’s being unsaved aside', (await has('[data-rig-dot]')) === (snap().rig.summary.problems > 0 || snap().rig.items.some((it) => it.state === 'look' && it.id !== 'show.saved')),
    snap().rig.items.filter((it) => it.state !== 'ready').map((it) => it.id));
  await shot('rig-1-plain-show');

  // ── adding a device by hand: the menu, a model, and its editor ──
  await click('[data-rig-none] [data-rig-add]');
  check('Add a device offers a model, a prop on this network, and an empty device', await until(() => page(`document.querySelectorAll('.rig-pop button').length === 3`), 2000));
  await click('[data-rig-add-model]');
  check('…and the models are listed by name, the kit’s props first', await until(() => page(`(() => { const b = [...document.querySelectorAll('.rig-pop [data-rig-model]')]; return b.length > 4 && /^ec-prop/.test(b[0].dataset.rigModel); })()`), 2000));
  await shot('rig-2-add-from-a-model');
  await click('[data-rig-model="ec-prop-light"]');
  const added = () => (host.document.doc.settings.rig.devices || []).find((d) => d.model === 'ec-prop-light');
  check('choosing one adds that device with its commands, as one edit', await until(() => added() && added().commands.length >= 5 && snap().show.canUndo, 3000), added());
  check('…selects it, with its editor open and its name ready to type', await until(() => page(`(() => { const e = document.querySelector('[data-rig-editor]'); return !!e && document.activeElement === e.querySelector('[data-rig-name] input'); })()`), 3000));
  host.cmd({ op: 'undo' });
  await until(() => !added(), 2000);

  host.cmd({ op: 'edit', ops: [...DEVICES, { op: 'show.set', path: 'settings.rig.checks', value: [{ id: 'k1', text: 'Fresh batteries in both lanterns' }, { id: 'k2', text: 'Haze fluid' }] }], label: 'three devices' });
  check('after an edit adding a device its row is there', await until(() => has('[data-rig-row="device.lantern"]'), 3000));
  await click('[data-rig-row="device.lantern"]');
  check('…and selecting it opens the editor, drawn from the device (its address, its commands)', await until(() => page(`(() => { const e = document.querySelector('[data-rig-editor="lantern"]'); return !!e && e.querySelectorAll('[data-rig-cmd]').length === ${host.document.doc.settings.rig.devices[0].commands.length} && [...e.querySelectorAll('input')].some((i) => i.value === '127.0.0.1'); })()`), 3000));
  check('each command shows the exact message it sends', /\/ec\/effect breathe/.test((await text('[data-rig-cmd="effect"] .cm')) || ''), await text('[data-rig-cmd="effect"] .cm'));
  // a field commits when it loses the keyboard, as well as on Enter
  await sleep(200);
  await page(`(() => { const i = document.querySelector('[data-rig-editor] .addr input'); i.focus(); i.value = '127.0.0.2'; i.dispatchEvent(new Event('input', { bubbles: true })); return new Promise((r) => setTimeout(() => { i.dispatchEvent(new FocusEvent('blur')); r(true); }, 90)); })()`);
  check('an address typed and left (no Enter) is kept, as one undoable edit', await until(() => host.document.doc.settings.rig.devices[0].host === '127.0.0.2', 2000), host.document.doc.settings.rig.devices[0].host);
  if (host.document.doc.settings.rig.devices[0].host === '127.0.0.2') host.cmd({ op: 'undo' });
  await until(() => host.document.doc.settings.rig.devices[0].host === '127.0.0.1', 2000);

  // ── Try ──
  const sentBefore = snap().sent.length;
  await click('[data-rig-try="identify"]');
  check('a Try click reaches the host: the message is among what was sent', await until(() => snap().sent.some((x) => /\/ec\/identify/.test(x.message)), 3000), snap().sent.slice(-3));
  check('…and the toast says what the host sent', await until(async () => /^Sent to Lantern: \/ec\/identify/.test((await text('.toast')) || ''), 2000), await text('.toast'));
  await sleep(200);
  // the real rows: every button the host gives a row is one this page carries out (never "not something this page can do")
  check('the real rows: an unsaved show has a Save button on its row, and each device its Ask again and Try', (await has('[data-rig-row="show.saved"] [data-rig-act="save"]')) && (await has('[data-rig-row="device.lantern"] [data-rig-act="ask"]')) && (await has('[data-rig-row="device.lantern"] [data-rig-act="try"]')), snap().rig.items.map((i) => [i.id, (i.actions || []).map((a) => a.id)]));

  // ── pictures: three devices in mixed states (invented), wide and narrow, in the three themes ──
  await fixture({ rig: FIXTURES.rig });
  await click('[data-rig-editor] .re-head .x');
  await sleep(150);
  check('an invented rig is drawn: a row for each state, each with its mark', await page(`['ready', 'look', 'problem', 'unknown'].every((s) => document.querySelector('[data-rig] .rig-row[data-state="' + s + '"] .rig-mark.m-' + s))`));
  check('…a row that is not ready says what to do on a second line, and a ready one does not', await page(`!!document.querySelector('[data-rig-row="device.lantern"] .rfix') && !document.querySelector('[data-rig-row="device.desk_a"] .rfix')`));
  check('…and the Rig tab carries a red dot for the problem', await has('[data-rig-dot="danger"]'));
  check('nothing on the page is wider than the page (a 60-character device name)', (await overflow()).length === 0, await overflow());
  await shot('rig-3-mixed-1480-lab');
  for (const t of ['ocean', 'graphite']) { await theme(t); await shot(`rig-3-mixed-1480-${t}`); }
  await theme('lab');
  win.setSize(1024, 760); await sleep(350);
  check('…nor at a window 1024 wide', (await overflow()).length === 0, await overflow());
  await shot('rig-4-mixed-1024');
  await click('[data-rig-row="device.projector"]');
  await sleep(200);
  check('in a narrow window the editor takes the list’s place, with a way back', await page(`(() => { const e = document.querySelector('[data-rig-editor]'), b = e && e.querySelector('.back'); return !!b && getComputedStyle(b).display !== 'none' && e.getBoundingClientRect().width > 500; })()`));
  check('…and a long name and a long command stay inside it', (await overflow()).length === 0, await overflow());
  await shot('rig-5-editor-1024-long-names');
  win.setSize(1600, 940); await sleep(350);
  await click('[data-rig-row="device.lantern"]');
  await sleep(200);
  check('in a wide window the editor is beside the list, 400 wide', await page(`Math.round(document.querySelector('[data-rig-editor]').getBoundingClientRect().width) === 400`));
  await shot('rig-6-editor-1600-lab');
  for (const t of ['ocean', 'graphite']) { await theme(t); await shot(`rig-6-editor-1600-${t}`); }
  await theme('lab');
  win.setSize(1480, 940); await sleep(300);

  // ── Hold Back: Try says "held" before it is pressed ──
  await fixture(null);
  host.cmd({ op: 'override', what: 'osc', on: true });
  check('with OSC out held back, the editor says so and each command reads “held”', await until(async () => (await has('[data-rig-held]')) && /^held/.test((await text('[data-rig-cmd="identify"] .cm')) || ''), 3000), await text('[data-rig-cmd="identify"] .cm'));
  await shot('rig-7-held-back');
  // (the row "Nothing is held back" carries the host's own command for letting it go: the page sends that, and only that)
  host.cmd({ op: 'override', what: 'midi', on: true });
  await click('[data-rig-editor] .re-head .x');
  check('the Held back row has a button for each output held', await until(async () => (await has('[data-rig-act="let-go-osc"]')) && (await has('[data-rig-act="let-go-midi"]')), 3000), snap().rig.items.filter((i) => i.group === 'held'));
  await click('[data-rig-act="let-go-osc"]');
  check('…Let OSC out go lets that one go, and leaves the other held', await until(() => { const o = snap().overrides || []; return o.some((x) => x.id === 'osc' && !x.on) && o.some((x) => x.id === 'midi' && x.on); }, 3000), snap().overrides);
  host.cmd({ op: 'override', what: 'midi', on: false });
  host.cmd({ op: 'override', what: 'osc', on: false });
  await until(async () => !(await has('[data-rig-act^="let-go"]')), 2000);
  // a prop that answered a look (invented: a smoke run sends nothing) is added under the name it answers by, and is then not offered again
  await fixture({ rig: { found: [{ name: 'lantern_b', kind: 'light', fw: '1.0', host: '10.0.0.43', port: 53100, known: null, moved: false }] } });
  check('a prop that answered is offered, by name and address', await until(async () => /lantern_b answered at 10\.0\.0\.43/.test((await text('.rig-found')) || ''), 2000), await text('.rig-found'));
  await click('.rig-found button');
  const b = () => (host.document.doc.settings.rig.devices || []).find((d) => d.id === 'lantern_b');
  check('…Add it makes it a device with the id it answers by (so the next look knows it), named to be read', await until(() => !!b() && b().name === 'Lantern b' && b().host === '10.0.0.43' && b().model === 'ec-prop-light', 3000), b());
  check('…and it is not offered a second time', await until(async () => !(await has('.rig-found')), 2000), await text('.rig-found'));
  host.cmd({ op: 'undo' });
  await fixture(null);

  // ── the checklist ──
  await fixture(null);
  await click('[data-rig-tick="k1"] .tick');
  check('a tick sets, and is not an edit to the show', await until(() => snap().rig.ticks.k1 === true, 2000) && await until(() => has('[data-rig-tick="k1"].done'), 2000), snap().rig.ticks);
  await click('[data-rig-again]');
  check('…and Start again clears it', await until(() => !snap().rig.ticks.k1, 2000) && await until(async () => !(await has('[data-rig-tick].done')), 2000), snap().rig.ticks);
  await page(`(() => { const i = document.querySelector('.rig-check.new input'); i.focus(); i.value = 'Spare lamp by the desk'; i.dispatchEvent(new Event('input', { bubbles: true })); return new Promise((r) => setTimeout(() => { i.dispatchEvent(new FocusEvent('blur')); r(true); }, 90)); })()`);
  check('a line typed under the checklist and left is added to the show', await until(() => (host.document.doc.settings.rig.checks || []).some((c) => c.text === 'Spare lamp by the desk'), 2000), host.document.doc.settings.rig.checks);
  await fixture(null);

  // ── +cue, and the Device cue in the list and the inspector ──
  await click('[data-rig-row="device.lantern"]');
  await until(() => has('[data-rig-editor="lantern"]'), 2000);
  if (!(await has('[data-rig-editor="lantern"]'))) { await click('[data-rig-row="device.lantern"]'); await until(() => has('[data-rig-editor="lantern"]'), 2000); }
  await click('[data-rig-cue="identify"]');
  const cueOf = () => host.document.doc.lists[0].cues.find((c) => c.type === 'device');
  check('+cue adds a Device cue for that command, and says so', await until(() => !!cueOf() && cueOf().device === 'lantern' && cueOf().command === 'identify', 3000) && await until(async () => /Added “Lantern ▸ Identify”/.test((await text('.toast')) || ''), 3000), [cueOf(), await text('.toast')]);
  win.webContents.send('ec-menu', 'view-rig');
  await until(() => has('.list table'), 3000);
  check('a Device cue’s row reads “Lantern ▸ Identify”, with its glyph', await until(() => page(`[...document.querySelectorAll('.list tbody tr')].some((r) => /Lantern ▸ Identify/.test(r.innerText) && /◈/.test(r.querySelector('.c-type').innerText))`), 3000));
  await page(`[...document.querySelectorAll('.list tbody tr')].find((r) => /Lantern ▸ Identify/.test(r.innerText)).click()`);
  await until(() => page(`[...document.querySelectorAll('.inspector .tabs button')].some((b) => b.textContent === 'Device')`), 2000);
  await page(`[...document.querySelectorAll('.inspector .tabs button')].find((b) => b.textContent === 'Device').click()`);
  check('its inspector offers the show’s devices and that device’s commands', await until(() => page(`(() => { const d = document.querySelector('[data-field="device"] select'), c = document.querySelector('[data-field="command"] select'); return !!d && !!c && d.value === 'lantern' && c.value === 'identify' && [...d.options].some((o) => o.textContent === 'Lighting desk') && [...c.options].some((o) => o.textContent === 'Effect'); })()`), 3000));
  check('…and no Fade to for a command with nothing to fade', !(await has('[data-field="fadeTo"]')));
  await page(`(() => { const c = document.querySelector('[data-field="command"] select'); c.value = 'effect'; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check('choosing another command changes the cue, and its values are a control each (a list for a choice)', await until(() => cueOf().command === 'effect', 2000) && await until(() => page(`(() => { const s = document.querySelector('[data-field="args"] select'); return !!s && [...s.options].some((o) => o.value === 'flicker'); })()`), 2000));
  await page(`(() => { const s = document.querySelector('[data-field="args"] select'); s.value = 'flicker'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check('…a value chosen there is the cue’s, and the row says it', await until(() => (cueOf().args || {}).name === 'flicker', 2000) && await until(() => page(`[...document.querySelectorAll('.list tbody tr')].some((r) => /Lantern ▸ Effect \\(flicker\\)/.test(r.innerText))`), 2000), cueOf());
  await page(`(() => { const c = document.querySelector('[data-field="command"] select'); c.value = 'level'; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check('a command with a value that fades offers Fade to and Duration', await until(() => has('[data-field="fadeTo"]'), 2000) && await has('[data-field="duration"]'));
  await shot('rig-8-device-cue-inspector');
  host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id: cueOf().id, props: { command: 'identify', args: null } }], label: 'back to identify' });

  // ── Space on the Rig page is still GO ──
  win.webContents.send('ec-menu', 'view-rig');
  await until(() => has('[data-rig]'), 3000);
  await click('[data-rig-row="device.lantern"]');
  await until(() => has('[data-rig-try="identify"]'), 2000);
  host.cmd({ op: 'playhead', id: host.document.doc.lists[0].cues[0].id });
  const head = snap().engine.playhead, sentN = snap().sent.length, lastGo = (snap().engine.lastGo || {}).at;
  await page(`document.querySelector('[data-rig-try="identify"]').focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); win.webContents.sendInputEvent({ type: 'char', keyCode: 'Space' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  check('Space with the keyboard on a Try button is GO (the playhead moves on)', await until(() => (snap().engine.lastGo || {}).at !== lastGo, 3000), [head, snap().engine.playhead]);
  await sleep(250);
  // (the GO itself fires the Device cue once when it is the one standing by; a second "identify" would be the button's)
  const tries = snap().sent.slice(sentN).filter((x) => /identify/.test(x.message)).length, fired = host.document.doc.lists[0].cues[0].type === 'device' ? 1 : 0;
  check('…and the command is not sent again by the button', tries <= fired && !/Sent to|not in this build/i.test((await text('.toast')) || '') , [tries, fired, await text('.toast')]);
  host.cmd({ op: 'panic', hard: true });

  // ── Show mode ──
  host.cmd({ op: 'mode', mode: 'show' });
  check('Show mode: the editor has nothing to type into, and only the safe command can be tried', await until(() => page(`(() => { const e = document.querySelector('[data-rig-editor]'); if (!e) return false; const fields = e.querySelectorAll('.re-head input, .re-head select, .rig-f input, .rig-f select, .rig-f textarea, [data-rig-add-cmd], [data-rig-remove], [data-rig-cue]').length;
    return fields === 0 && e.querySelector('[data-rig-try="effect"]').disabled && !e.querySelector('[data-rig-try="identify"]').disabled; })()`), 3000));
  check('…Look for props is off, and the checklist can still be ticked', await page(`document.querySelector('[data-rig-scan]').disabled && !!document.querySelector('[data-rig-tick] .tick') && !document.querySelector('.rig-check.new')`));
  await shot('rig-9-show-mode');
  host.cmd({ op: 'mode', mode: 'edit' });
  // (the assistant is not there in Show mode: wait for the window to be back in Edit before asking for its drawer)
  await until(() => page(`!!document.querySelector('[data-assistant-button]')`), 3000);

  // ── a proposal with a device and a file: the review card's two parts ──
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-rig-pages-')), 'Rig pages');
  fs.mkdirSync(dir, { recursive: true });
  host.open(dir);
  await until(() => !snap().show.untitled && snap().show.dir === dir, 4000);
  const readme = '# Lantern\n\n1. Install the Arduino IDE.\n2. Open secrets.h and type the network’s name and password.\n';
  host.document.propose([{ op: 'device.add', device: { name: 'Lantern', model: 'ec-prop-light', host: '127.0.0.1' } }], { summary: 'A lantern and its steps', author: 'you', files: [{ path: 'props/lantern/README.md', text: readme }] });
  host.cmd({ op: 'state' });
  win.webContents.send('ec-menu', 'assistant');
  check('a proposal with a device and a file draws both parts', await until(async () => (await has('[data-review-devices]')) && (await has('[data-review-files]')), 4000) && /Lantern/.test((await text('[data-review]')) || '') && /props\/lantern\/README\.md/.test((await text('[data-review-file]')) || ''), await text('[data-review]'));
  check('…the device as an operator reads it (its kind, address and commands)', /prop · 127\.0\.0\.1:53100 · \d+ commands/.test((await text('[data-review]')) || ''), await text('[data-review]'));
  await click('[data-review-file] .filename');
  check('…a click on the file shows its text, to read before accepting', await until(async () => /Install the Arduino IDE/.test((await text('[data-review-text]')) || ''), 2000));
  check('…and the card says files are written on accept and stay after an undo', /Undo does not remove files/.test((await text('[data-review] .rf')) || ''));
  await shot('rig-10-review-device-and-file');
  await click('[data-review] [data-accept]');
  check('accepted, the file is in the show folder and the device is in the show', await until(() => fs.existsSync(path.join(dir, 'props/lantern/README.md')) && (host.document.doc.settings.rig.devices || []).some((d) => d.name === 'Lantern'), 3000));

  // ── Write firmware…: the kit's own options, and files to review ──
  win.webContents.send('ec-menu', 'assistant');
  await until(async () => !(await has('[data-assistant]')), 2000);
  await click('.titlebar [data-view-rig]');
  await until(() => has('[data-rig]'), 3000);
  if (!(await has('[data-rig-editor="lantern"]'))) await click('[data-rig-row="device.lantern"]');
  await until(() => has('[data-rig-firmware]'), 3000);
  await click('[data-rig-firmware]');
  const kit = require('../../core/kit/kit');
  check('Write firmware… is a form of the kit’s own options (its boards by name, its defaults)', await until(() => page(`(() => { const f = document.querySelector('[data-rig-fw]'); if (!f) return false; const board = f.querySelector('[data-rig-fw-field="board"] select'), count = f.querySelector('[data-rig-fw-field="count"] input');
    return !!board && [...board.options].map((o) => o.value).join() === ${JSON.stringify(Object.keys(kit.BOARDS).join())} && [...board.options].some((o) => o.textContent === ${JSON.stringify(kit.BOARDS['xiao-esp32c3'].label)}) && !!count && count.value === '30' && !f.querySelector('[data-rig-fw-field="look"]') && !f.querySelector('[data-rig-fw-field="output"]'); })()`), 3000), await text('[data-rig-fw]'));
  await shot('rig-10b-write-firmware');
  await page(`(() => { const b = document.querySelector('[data-rig-fw-field="board"] select'); b.value = 'esp32-c3'; b.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await click('[data-rig-fw-write]');
  check('…Write the files stages the kit’s files for this prop, set up as chosen, in the assistant’s drawer', await until(() => snap().proposal && (snap().proposal.files || []).some((f) => f.path === 'props/lantern/lantern.ino'), 3000) && /BOARD_LABEL +"esp32-c3"/.test(((snap().proposal.files || []).find((f) => f.path === 'props/lantern/config.h') || {}).text || '') && await until(() => has('[data-review-files]'), 3000),
    snap().proposal && snap().proposal.files.map((f) => f.path));
  check('…the README of a file already there is marked as replacing it', await until(async () => /replaces/.test((await text('[data-review-file="props/lantern/README.md"]')) || ''), 2000), await text('[data-review-file="props/lantern/README.md"]'));
  await click('[data-review] [data-accept]');
  check('accepted, the drawer says where the firmware is and what to open', await until(async () => /README\.md/.test((await text('[data-written="props/lantern"]')) || ''), 3000) && fs.existsSync(path.join(dir, 'props/lantern/lantern.ino')), await text('[data-assistant] .drawer-body'));

  // ── the assistant's first screen: what the host really says of this show ──
  await page(`window.ec.cmd({ op: 'assistant-reset' })`);
  const first = () => snap().assistant.first || {};
  check('before the first message the drawer is about this show: its line, and its asks as buttons', await until(() => page(`(() => { const f = document.querySelector('[data-first]'); return !!f && f.querySelector('.fline').innerText === ${JSON.stringify(first().line || '?')} && f.querySelectorAll('[data-ask]').length === ${(first().asks || []).length} && !!document.querySelector('.compose textarea'); })()`), 3000) && first().state === 'devices' && first().asks.length >= 2, [first(), await text('[data-assistant] .drawer-body')]);
  await shot('rig-11-drawer-first-screen');
  for (const k of ['folder', 'imported', 'cues']) { await fixture({ first: FIXTURES.first[k] }); await shot(`rig-12-drawer-${k}`); }
  await fixture(null);
  // every ask the built-in helper offers here does its job when pressed (none falls through to "here is what I can do")
  const labels = first().asks.map((k) => k.label);
  for (let i = 0; i < labels.length; i++) {
    const n = (snap().assistant.transcript || []).length;
    await page(`[...document.querySelectorAll('[data-first] [data-ask], [data-first-after] [data-ask]')].find((b) => b.textContent === ${JSON.stringify(labels[i])}).click()`);
    await until(() => (snap().assistant.transcript || []).length >= n + 2 && !snap().assistant.busy, 8000);
    const said = ((snap().assistant.transcript || []).at(-1) || {});
    check(`pressing “${labels[i]}” sends it, and the helper does that job`, said.role === 'assistant' && !said.error && !/^The built-in helper has no model/.test(said.text || '') && !/^I could not/.test(said.text || ''), said.text);
    if (snap().proposal) host.cmd({ op: 'reject', id: snap().proposal.id });
    await page(`window.ec.cmd({ op: 'assistant-reset' })`);
    await until(() => has('[data-first]'), 2000);
  }
  // after an answer, what could come next is offered under the conversation
  await page(`window.ec.cmd({ op: 'ask', text: 'is everything ready?' })`);
  check('under a conversation the drawer offers what could come next', await until(async () => !snap().assistant.busy && (await has('[data-first-after] [data-ask]')), 5000));
  await page(`window.ec.cmd({ op: 'assistant-reset' })`);
  // no model: who should answer, and no composer
  await page(`window.ec.app({ op: 'assistant-config', config: { provider: 'off' } }).then(() => window.ec.cmd({ op: 'state' }))`);
  await until(() => snap().assistant.available === false, 3000);
  const rows = ((first().setup || {}).rows || []).map((r) => r.id);
  check('with the provider off the drawer shows who could answer (the host’s rows, the built-in helper last), and no composer', rows.length >= 3 && rows.at(-1) === 'helper' && await until(() => page(`(() => { const w = document.querySelector('[data-who]'); return !!w && [...w.querySelectorAll('[data-provider]')].map((b) => b.dataset.provider).join() === ${JSON.stringify(rows.join())} && !document.querySelector('.compose textarea'); })()`), 3000), [rows, await text('[data-assistant] .drawer-body')]);
  check('…and only the asks the built-in helper can do', first().asks.every((k) => k.offline) && (await page(`document.querySelectorAll('[data-first] [data-ask]').length`)) === first().asks.length, first().asks);
  await shot('rig-13-drawer-no-model');
  // an ask the helper can do, pressed with nobody answering: the helper is switched on, and it is sent
  await page(`[...document.querySelectorAll('[data-first] [data-ask]')].find((b) => b.textContent === 'Is everything ready?').click()`);
  check('an offline ask pressed with the provider off switches to the built-in helper and sends', await until(() => snap().assistant.provider === 'demo' && (snap().assistant.transcript || []).some((m) => m.role === 'assistant'), 5000) && await until(() => has('[data-helper]'), 2000), snap().assistant.transcript);
  await page(`window.ec.cmd({ op: 'assistant-reset' })`);
  await page(`window.ec.app({ op: 'assistant-config', config: { provider: 'off' } }).then(() => window.ec.cmd({ op: 'state' }))`);
  await until(() => snap().assistant.available === false, 3000);
  await until(() => has('[data-who] [data-provider="helper"]'), 3000);
  await click('[data-who] [data-provider="helper"]');
  check('choosing the built-in helper is one click: the composer is there', await until(() => snap().assistant.available && snap().assistant.provider === 'demo', 3000) && await until(() => has('.compose textarea'), 3000));
  win.webContents.send('ec-menu', 'assistant');
  await until(async () => !(await has('[data-assistant]')), 2000);

  // ── Settings ──
  await page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: ${process.platform === 'darwin'}, ctrlKey: ${process.platform !== 'darwin'}, bubbles: true }))`);
  await until(() => has('.modal nav'), 2000);
  await page(`[...document.querySelectorAll('.modal nav button')].find((b) => b.textContent === 'Assistant').click()`);
  check('Settings ▸ Assistant offers the guide for coding agents, and says what is sent', await until(async () => (await has('[data-agent-guide]')) && /each device’s name, address and commands/.test((await text('.modal .pane')) || '') && /Built-in helper/.test((await text('.modal .pane')) || ''), 3000));
  // the guide, with no model: Settings hands over to the drawer, where its two files wait to be read and accepted
  await click('[data-agent-guide]');
  check('Write the guide… closes Settings and shows its two files for review in the assistant’s drawer', await until(async () => !(await has('.modal')) && /AGENTS\.md/.test((await text('[data-review-files] ~ [data-review-file]')) || '') && (snap().proposal.files || []).length === 2, 4000), snap().proposal && snap().proposal.files);
  // (from source: node and the repository's bin; installed: the app's own program run as Node, on the bin in its archive)
  const packaged = require('electron').app.isPackaged;
  check(`…with command lines for this computer (${packaged ? 'installed: the app’s own program as Node' : 'run from source: node and the repository’s bin'})`, (packaged
    ? /claude mcp add endless-cues --env ELECTRON_RUN_AS_NODE=1 -- "[^"\n]+" "[^"\n]*app\.asar[\\/]bin[\\/]ec-mcp\.js"/
    : /claude mcp add endless-cues -- node "?[^"\n]*bin[\\/]ec-mcp\.js/).test(((snap().proposal.files || [])[0] || {}).text || ''), (((snap().proposal.files || [])[0] || {}).text || '').split('\n').find((l) => /claude mcp add/.test(l)));
  if (snap().proposal) host.cmd({ op: 'reject', id: snap().proposal.id });
  win.webContents.send('ec-menu', 'assistant');
  await until(async () => !(await has('[data-assistant]')), 2000);
  await page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: ${process.platform === 'darwin'}, ctrlKey: ${process.platform !== 'darwin'}, bubbles: true }))`);
  await until(() => has('.modal nav'), 2000);
  await page(`(async () => { document.querySelector('.modal nav [data-section="integrations"]').click(); await new Promise((r) => setTimeout(r, 0)); document.querySelector('.modal .settings-subtabs [data-section="network"]').click(); })()`);
  check('Settings ▸ Integrations ▸ Network points at the Rig for equipment with commands', await until(async () => /Devices with named commands are in the Rig/.test((await text('.modal .pane')) || ''), 3000));
  await page(`document.querySelector('.modal .close').click()`);
  await until(async () => !(await has('.modal')), 2000);

  // ── the welcome panel ──
  host.openUntitled();
  await until(() => snap().show.untitled && snap().rows.length === 0, 4000);
  win.webContents.reloadIgnoringCache();              // (a window as it opens: on the cue list, the welcome panel not yet dismissed)
  await sleep(600);
  await until(() => has('.welcome'), 5000);
  check('the welcome panel offers Start from a folder…', await has('.welcome [data-start-folder]'));
  // Start from a Folder: a folder of sounds becomes the show, with nothing made into cues
  const sounds = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-folder-')), 'Spring Concert');
  fs.mkdirSync(sounds, { recursive: true });
  require('../../examples/make-demo').writeWav(path.join(sounds, '01 Overture.wav'), new Float32Array(4410));
  const r = await page(`window.ec.app({ op: 'start-in-folder', path: ${JSON.stringify(sounds)} })`);
  check('Start from a folder makes that folder the show: a show.json beside the sounds, named for the folder, and no cues made', r && r.ok && await until(() => snap().show.dir === sounds && snap().show.title === 'Spring Concert', 3000) && fs.existsSync(path.join(sounds, 'show.json')) && fs.existsSync(path.join(sounds, '01 Overture.wav')) && snap().rows.length === 0, [r, snap().show]);
  check('…and nothing else is put in the folder (no empty media folder beside their sounds)', fs.readdirSync(sounds).sort().join() === '01 Overture.wav,show.json', fs.readdirSync(sounds));
  check('…and the assistant’s drawer opens on it, saying what is in the folder', await until(async () => /^1 sound not in a cue yet\./.test((await text('[data-first] .fline')) || ''), 3000), await text('[data-assistant] .drawer-body'));
  win.webContents.send('ec-menu', 'assistant');
  host.openUntitled();
  await until(() => snap().show.untitled, 3000);
}

module.exports = { run, FIXTURES, DEVICES };
