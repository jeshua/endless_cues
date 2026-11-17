/**
 * The assistant's guide to the app (core/assistant/app-guide.js), the window's named places (core/ui/places.js),
 * the one table of keys (core/ui/keys.js) and the tool that points (show_in_app in core/assistant/tools.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createAssistant, demoProvider } = require('../core/assistant/assistant');
const { TOOLS, execute, lookup, SYSTEM } = require('../core/assistant/tools');
const appGuide = require('../core/assistant/app-guide');
const places = require('../core/ui/places');
const uiKeys = require('../core/ui/keys');
const { ShowDocument } = require('../core/show/document');
const { build } = require('./helpers');

const doc = () => new ShowDocument({ doc: build([
  { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', name: 'Rain', file: 'media/rain.wav', gainDb: -6 } },
  { op: 'cue.add', cue: { type: 'fade', number: '2', target: '@a', db: -60, duration: 5, stopTarget: true } },
  { op: 'cue.add', cue: { type: 'memo', number: '3', name: 'Interval' } },
]).doc });
/** A window that says yes to every place, and keeps what it was asked to show; `locked` is Show mode. */
const fakeUi = ({ locked = false, ok = true } = {}) => { const shown = []; return { shown, locked: () => locked, point: async (p) => { shown.push(p); return ok ? { ok: true } : { ok: false, why: 'it is not on the screen' }; } }; };
const renderer = (f) => fs.readFileSync(path.join(__dirname, '../app/renderer', f), 'utf8');

test('every place the guide names is in the registry, and every fixed place is in the guide', () => {
  const named = appGuide.namedPlaces();
  assert.ok(named.length > 40, named.length);
  for (const n of named) assert.ok(places.resolve(n).ok, `the guide names [${n}], which places.js does not know: ${places.resolve(n).why}`);
  const fixed = places.names().fixed;
  for (const n of fixed) assert.ok(named.includes(n), `${n} is a place no line of the guide says`);
});

test('each fixed place’s selector is one the window draws (its data attribute or class is in the renderer)', () => {
  const all = fs.readdirSync(path.join(__dirname, '../app/renderer')).filter((f) => f.endsWith('.js')).map(renderer).join('\n');
  for (const [name, p] of Object.entries(places.FIXED)) {
    if (p.sel === null) { assert.ok(p.words, `${name} has neither a selector nor words`); continue; }
    for (const attr of p.sel.match(/data-[a-z-]+/g) || []) assert.ok(all.includes(attr), `${name}: no element has ${attr}`);
  }
  // the families' attributes too
  for (const attr of ['data-tab=', 'data-add-type=', 'data-insp-tab=', 'data-field=', 'data-cue=', 'data-section=']) assert.ok(all.includes(attr), attr);
});

test('the families: tabs, cue types, inspector tabs and fields, cues, Settings panes; and what is refused', () => {
  const d = doc().doc;
  assert.equal(places.resolve('tab:rig').place.sel, '.tabs-main [data-tab="rig"]');
  assert.equal(places.resolve('rig').place.target, 'tab:rig', 'a plain word for a place');
  const triggers = places.resolve('inspector-tab:triggers').place;
  assert.deepEqual(triggers.steps.map((s) => s.do), ['cues', 'select', 'tab']);
  assert.equal(triggers.steps[2].tab, 'triggers');
  const colour = places.resolve('inspector-field:color').place;
  assert.equal(colour.sel, '[data-field="color"]');
  assert.equal(colour.steps.find((s) => s.do === 'tab').tab, 'basics');
  assert.ok(!colour.steps.find((s) => s.do === 'select').types.includes('section'), 'a section has no colour of its own to show');
  const level = places.resolve('inspector-field:gainDb').place;
  assert.equal(level.steps.find((s) => s.do === 'tab').tab, 'type');
  assert.ok(level.steps.find((s) => s.do === 'select').types.includes('audio'));
  assert.equal(places.resolve('inspector-field:loops').place.sel, '[data-insp-tab="time"]', 'a field drawn on Time & Loops is that tab');
  assert.ok(places.resolve('inspector-field:color2').place.steps.some((s) => s.do === 'more'), 'an advanced field opens More');
  const cue = places.resolve('cue:1', { doc: d }).place;
  assert.match(cue.sel, /tr\[data-cue="/);
  assert.equal(cue.steps.find((s) => s.do === 'reveal').cue, d.lists[0].cues[0].id);
  assert.equal(places.resolve('cue:#2', { doc: d }).ok, true);
  assert.match(places.resolve('settings:network').place.sel, /settings-subtabs \[data-section="network"\]/);
  assert.match(places.resolve('settings:audio').place.sel, /nav \[data-section="audio"\]/);
  assert.equal(places.resolve('add-type:fade').place.fallback.target, 'add-cue-more');
  // refused, with what there is
  assert.match(places.resolve('the big red one').why, /no place called[\s\S]*panic/);
  assert.match(places.resolve('cue:99', { doc: d }).why, /No cue 99/);
  assert.match(places.resolve('inspector-field:wobble').why, /No cue has a field/);
  assert.match(places.resolve('inspector-tab:extras').why, /basics\|type/);
  assert.match(places.resolve('inspector-field:gainDb', { doc: d, cue: '#3' }).why, /Memo cue has no Level/);
});

test('the keys: one table, which the menus are built from and the window reads', () => {
  const main = fs.readFileSync(path.join(__dirname, '../app/main/main.js'), 'utf8');
  assert.ok(!/accelerator:\s*['"`]/.test(main), 'every menu accelerator in main.js comes from core/ui/keys.js');
  const used = [...main.matchAll(/accelerator: KEY\('([a-zA-Z]+)'\)/g)].map((m) => m[1]);
  for (const id of used) assert.doesNotThrow(() => uiKeys.accel(id), id);
  for (const [id] of uiKeys.MENU) assert.ok(used.includes(id), `${id} is in the table and on no menu`);
  // the window's tables are the same one: lib.js keeps none of its own
  const lib = renderer('lib.js');
  assert.ok(!/\['go', 'GO'/.test(lib) && /ec\.ui/.test(lib), 'lib.js reads the keys the preload hands it');
  const page = uiKeys.forPage();
  assert.equal(page.actions, uiKeys.ACTIONS);
  assert.deepEqual(page.fixed.find(([l]) => l === 'Save a version'), ['Save a version', '⌘S']);
  assert.deepEqual(page.fixed.find(([l]) => l === 'Paste cue properties'), ['Paste cue properties', '⌥⌘V']);
  assert.deepEqual(page.fixed.find(([l]) => l === 'Check the show'), ['Check the show', '⇧⌘F']);
  assert.equal(uiKeys.glyphs('CmdOrCtrl+Shift+M'), '⇧⌘M');
  assert.equal(uiKeys.glyphs('CmdOrCtrl+,'), '⌘,');
  // the guide's keys are written from the table: every key in it, nothing else
  const text = appGuide.keysText();
  for (const k of uiKeys.all()) assert.ok(text.includes(`${k.keys} ${k.what}`), `${k.what} (${k.keys}) is not in the guide`);
  assert.match(text, /Esc Panic/);
  assert.match(text, /< Fold every group/);
});

test('read_reference "app", "screens" and "keys"; the brief grows by one line and says to use them', () => {
  const app = lookup('app');
  assert.ok(app.ok);
  assert.match(app.text, /HOW TO USE THE APP[\s\S]*Panic \[panic\][\s\S]*KEYS/);
  assert.ok(!lookup('screens').text.includes('KEYS ('));
  assert.match(lookup('keys').text, /⌘S Save a version/);
  assert.match(lookup('places').text, /inspector-field:/);
  assert.match(SYSTEM, /read_reference "app", never guess, and show_in_app/);
  assert.ok(TOOLS.some((t) => t.name === 'show_in_app'));
});

test('show_in_app: a place resolved and shown; refused in Show mode, with no window, or for a name that is not one', async () => {
  const d = doc();
  const ui = fakeUi();
  const r = await execute('show_in_app', { target: 'inspector-tab:triggers', say: 'Hotkeys are here' }, { document: d, ui });
  assert.ok(!r.is_error, r.content);
  assert.match(r.content, /Shown: .*Triggers/);
  assert.deepEqual(r.point, { target: 'inspector-tab:triggers', say: 'Hotkeys are here', cue: null });
  assert.equal(ui.shown[0].sel, '[data-insp-tab="triggers"]');
  const onCue = await execute('show_in_app', { target: 'inspector-field:gainDb', cue: '#1' }, { document: d, ui });
  assert.ok(!onCue.is_error, onCue.content);
  assert.equal(ui.shown[1].steps.find((s) => s.do === 'select').cue, d.doc.lists[0].cues[0].id);
  // refusals: Show mode, no window, an unknown place, the window not finding it
  const locked = await execute('show_in_app', { target: 'panic' }, { document: d, ui: fakeUi({ locked: true }) });
  assert.ok(locked.is_error); assert.match(locked.content, /Show mode/);
  const none = await execute('show_in_app', { target: 'panic' }, { document: d });
  assert.ok(none.is_error); assert.match(none.content, /in words/);
  const bad = await execute('show_in_app', { target: 'nowhere' }, { document: d, ui });
  assert.ok(bad.is_error); assert.match(bad.content, /no place called/);
  const gone = await execute('show_in_app', { target: 'row-stop' }, { document: d, ui: fakeUi({ ok: false }) });
  assert.ok(gone.is_error); assert.match(gone.content, /Could not show/);
  // a menu bar item has nothing to ring: it is said in words, and is not an error
  const find = await execute('show_in_app', { target: 'find' }, { document: d, ui });
  assert.ok(!find.is_error); assert.match(find.content, /Tools ▸ Find/);
});

test('a reply that pointed carries the place, so the drawer can show it again', async () => {
  const d = doc();
  const replies = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'show_in_app', input: { target: 'panic', say: 'Esc does this too' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Panic is top right.' }] },
  ];
  const a = createAssistant({ provider: { name: 'scripted', async create() { return replies.shift(); } } });
  const ui = fakeUi();
  await a.ask('where is panic', { document: d, ui });
  const last = a.status().transcript.at(-1);
  assert.deepEqual(last.points, [{ target: 'panic', say: 'Esc does this too', cue: null }]);
  assert.equal(ui.shown.length, 1);
});

test('the built-in helper answers where things are and what their keys are, from the guide, and points', async () => {
  const d = doc();
  const ask = async (text, ui = fakeUi()) => { const a = createAssistant({ provider: demoProvider() }); await a.ask(text, { document: d, ui }); return { said: a.status().transcript.at(-1), ui }; };
  let r = await ask('Where do I change the colour of a cue?');
  assert.equal(r.ui.shown[0].target, 'inspector-field:color');
  assert.match(r.said.text, /Basics ▸ Colour[\s\S]*ringed/);
  assert.equal(r.said.points[0].target, 'inspector-field:color');
  r = await ask('What’s the key for Panic?');
  assert.equal(r.ui.shown[0].target, 'panic');
  assert.match(r.said.text, /^The key is Esc\. Panic: fades everything out/);
  assert.equal(r.ui.shown[0].say, 'Panic: Esc');
  r = await ask('what is the shortcut for save');
  assert.match(r.said.text, /Save a version: (⌘|Ctrl\+)S/);
  r = await ask('where is the mixer');
  assert.equal(r.ui.shown[0].target, 'mixer');
  r = await ask('how do I add a hotkey to a cue');
  assert.equal(r.ui.shown[0].target, 'inspector-tab:triggers');
  r = await ask('where are the versions');
  assert.equal(r.ui.shown[0].target, 'versions');
  // Find has no button: said, not pointed
  r = await ask('how do I search for a cue?');
  assert.equal(r.ui.shown.length, 0);
  assert.match(r.said.text, /Find/);
  // with no window (or in Show mode) it still answers, in words
  r = await ask('where is Panic', fakeUi({ locked: true }));
  assert.match(r.said.text, /Panic/);
  assert.ok(!/ringed/.test(r.said.text));
  // a question it has no place for: its list, as before
  r = await ask('where is the moon');
  assert.match(r.said.text, /built-in helper/);
  // the one-line jobs are not taken for questions
  const a = createAssistant({ provider: demoProvider() });
  await a.ask('set cue 1 level to -9', { document: d, ui: fakeUi() });
  assert.ok(d.proposal);
});
