// The check: one function that says whether the show is ready, from invented facts (core/rig/check.js; docs/specs/15, section 3.7).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const check = require('../core/rig/check');
const { applyOps } = require('../core/show/ops');
const { build } = require('./helpers');

const SAVED = { saved: { untitled: false, dirty: false, changes: 0 } };
const LANTERN = { op: 'device.add', device: { name: 'Lantern A', model: 'ec-prop-light', host: '10.0.0.42' } };
const USES = { op: 'cue.add', cue: { type: 'device', number: '1', device: 'lantern_a', command: 'identify' } };
const by = (items) => Object.fromEntries(items.map((i) => [i.id, i]));
const one = (ops, facts, id) => by(check.items(build(ops).doc, { ...SAVED, ...facts }))[id];
const says = (row, state, text) => { assert.ok(row, 'the row is there'); assert.equal(row.state, state, JSON.stringify(row)); if (text !== undefined) (text instanceof RegExp ? assert.match(row.text, text) : assert.equal(row.text, text)); if (state === 'ready') assert.equal(row.fix, ''); else if (state !== 'unknown') assert.ok(row.fix || row.group === 'before', `a row that is not ready says what to do: ${row.id}`); };

test('an empty new show has three rows; a show of sounds has five; every row is an assertion with a state', () => {
  const empty = check.items(build([]).doc, { saved: { untitled: true } });
  assert.deepEqual(empty.map((i) => [i.id, i.label, i.state, i.group, i.groupLabel]), [
    ['show.saved', 'The show is saved', 'look', 'show', 'The show'], ['show.backups', 'Backups are on', 'ready', 'show', 'The show'], ['show.cues', 'Every cue can run', 'ready', 'show', 'The show']]);
  assert.equal(empty[0].fix, 'Save it to a folder (⌘S).');
  assert.deepEqual(empty[0].actions, [{ id: 'save', label: 'Save', cmd: { op: 'save' } }]);
  const sounds = check.items(build([{ op: 'cue.add', cue: { type: 'audio', file: 'media/a.wav' } }, { op: 'cue.add', cue: { type: 'audio', file: 'media/b.wav' } }]).doc,
    { ...SAVED, audio: { device: 'the interface', ok: true, outputs: 2 }, files: { total: 2, missing: [] } });
  assert.deepEqual(sounds.map((i) => [i.label, i.state, i.text]), [['The show is saved', 'ready', ''], ['Backups are on', 'ready', 'every 5 minutes'], ['Every cue can run', 'ready', '2 cues'], ['Sound goes to the interface', 'ready', ''], ['Every file is found', 'ready', '2 files']]);
  assert.deepEqual(check.summary(sounds, 5), { ready: 5, total: 5, look: 0, problems: 0, unknown: 0, at: 5, text: 'All 5 are ready' });
  for (const i of [...empty, ...sounds]) { assert.ok(check.STATES.includes(i.state)); assert.ok(Array.isArray(i.actions)); assert.equal(typeof i.needed, 'boolean'); }
});

test('the show: unsaved, backups off, broken cues (and which), a file the app found missing', () => {
  says(one([], { saved: { untitled: false, dirty: true, changes: 3 } }, 'show.saved'), 'look', '3 unsaved changes');
  says(one([], { saved: undefined }, 'show.saved'), 'unknown');
  says(one([{ op: 'show.set', path: 'settings.backup.minutes', value: 0 }], {}, 'show.backups'), 'look', 'off');
  const ops = [{ op: 'cue.add', cue: { type: 'fade', number: '4' } }, { op: 'cue.add', cue: { type: 'memo', number: '5' } }, { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '12', file: 'media/gone.wav' } }, { op: 'cue.add', cue: { type: 'network', name: 'Projector on', message: 'no slash' } }];
  const b = build(ops);
  const row = by(check.items(b.doc, { ...SAVED, broken: [{ id: b.id('a'), why: 'its file is missing' }, { id: 'not-in-the-show', why: 'x' }] }))['show.cues'];
  says(row, 'problem', '3 cues are broken: 4, 12, Projector on.');
  assert.match(row.fix, /^4: no target\.$/);
  assert.deepEqual(row.actions.map((a) => a.id), ['select']);
  assert.equal(row.actions[0].cue, b.doc.lists[0].cues[0].id);
});

test('sound: the output away, a bus with no outputs, files missing, a microphone not there', () => {
  const audio = [{ op: 'cue.add', cue: { type: 'audio', file: 'media/a.wav' } }];
  says(one(audio, { audio: { device: 'this computer’s default output', ok: true, fallback: 'the interface', outputs: 2 } }, 'sound.output'), 'problem', /^away: on this computer’s default output/);
  assert.equal(one(audio, { audio: { device: 'x', ok: true, fallback: 'the interface', outputs: 2 } }, 'sound.output').label, 'Sound goes to the interface', 'the label names what is away');
  assert.equal(one(audio, { audio: { fallback: 'the interface' } }, 'sound.output').fix, 'Plug in the interface, or choose another in Settings ▸ Audio.');
  says(one(audio, { audio: { device: 'the interface', ok: false } }, 'sound.output'), 'problem', 'the output has failed');
  says(one(audio, {}, 'sound.output'), 'unknown');
  assert.equal(one([], { audio: { device: 'x', ok: true } }, 'sound.output'), undefined, 'no cue makes a sound: no row');
  const far = [...audio, { op: 'show.set', path: 'settings.audio.buses.music.out', value: 5 }];
  says(one(far, { audio: { device: 'x', ok: true, outputs: 2 } }, 'sound.buses'), 'problem', 'Music (outputs 5–6) cannot be heard: this device has 2 outputs');
  says(one(far, { audio: { device: 'x', ok: true, outputs: 8 } }, 'sound.buses'), 'ready', '8 outputs');
  assert.equal(one(audio, { audio: { device: 'x', ok: true, outputs: 2 } }, 'sound.buses'), undefined, 'every bus on outputs 1–2: no row');
  const files = one(audio, { files: { total: 14, missing: ['media/a.wav', '/somewhere/else/b.wav'] } }, 'sound.files');
  says(files, 'problem', '2 files are missing: a.wav, b.wav');
  assert.deepEqual(files.actions, [{ id: 'relink', label: 'Find them…' }]);
  says(one(audio, { files: { total: 14, missing: [] } }, 'sound.files'), 'ready', '14 files');
  says(one(audio, {}, 'sound.files'), 'unknown');
  const mic = [{ op: 'cue.add', cue: { type: 'mic', input: 'Podium mic' } }];
  says(one(mic, { audio: { device: 'x', ok: true, inputs: ['Built-in'] } }, 'sound.mic'), 'problem', '“Podium mic” is not connected');
  says(one(mic, { audio: { device: 'x', ok: true, inputs: ['Podium mic'] } }, 'sound.mic'), 'ready', 'Podium mic');
  says(one(mic, { audio: { device: 'x', ok: true, inputs: [] } }, 'sound.mic'), 'problem', 'this computer has no audio input');
  says(one(mic, { audio: { device: 'x', ok: true, inputs: null } }, 'sound.mic'), 'unknown');
});

test('picture and lights: the stage not open, its display gone; DMX failing, or held back', () => {
  const text = [{ op: 'cue.add', cue: { type: 'text', text: 'Interval' } }];
  says(one(text, { stage: { open: false } }, 'picture.stage'), 'look', 'the stage is not open');
  says(one(text, { stage: { open: false, waiting: true, label: 'the projector' } }, 'picture.stage'), 'problem', 'its display is not connected');
  const open = one(text, { stage: { open: true, label: 'the projector' } }, 'picture.stage');
  says(open, 'ready');
  assert.deepEqual([open.label, open.actions[0].label, open.actions[0].cmd], ['The stage is on the projector', 'Test pattern', { op: 'stage-pattern' }]);
  assert.equal(one([], { stage: { open: false } }, 'picture.stage'), undefined);
  const lit = [{ op: 'show.set', path: 'settings.light.on', value: true }, { op: 'show.set', path: 'settings.light.instruments', value: [{ name: 'front', fixture: 'dimmer', universe: 1, address: 1 }] }];
  says(one(lit, { light: { error: 'the network is unreachable' } }, 'lights.dmx'), 'problem', 'the network is unreachable');
  says(one(lit, { light: { held: true } }, 'lights.dmx'), 'look', /held back/);
  says(one(lit, { light: {} }, 'lights.dmx'), 'ready');
  assert.equal(one([], { light: { error: 'x' } }, 'lights.dmx'), undefined, 'the show’s own lights are off: no row');
});

test('a device: answering, not answering, no address, held back, a report outside its range', () => {
  const live = (l) => ({ liveness: { lantern_a: { reports: [], ...l } } });
  const ready = one([LANTERN, USES], live({ state: 'ready', text: 'answering · 4 ms' }), 'device.lantern_a');
  says(ready, 'ready', 'answering · 4 ms');
  assert.deepEqual([ready.label, ready.group, ready.needed, ready.device], ['Lantern A', 'equipment', true, 'lantern_a']);
  assert.deepEqual(ready.actions, [{ id: 'ask', label: 'Ask again', cmd: { op: 'device-ask', device: 'lantern_a' } }, { id: 'try', label: 'Try: Identify', cmd: { op: 'device-try', device: 'lantern_a', command: 'identify' } }]);
  const gone = one([LANTERN, USES], live({ state: 'problem', text: 'not answering (last heard 2 min ago)' }), 'device.lantern_a');
  says(gone, 'problem', 'not answering (last heard 2 min ago)');
  assert.equal(gone.fix, 'Check its power, and that it is on the show’s network.');
  says(one([LANTERN, USES], live({ state: 'look', text: 'held back', held: true }), 'device.lantern_a'), 'look', 'held back');
  says(one([LANTERN, USES], live({ state: 'unknown', text: 'asking…' }), 'device.lantern_a'), 'unknown', 'asking…');
  says(one([LANTERN, USES], {}, 'device.lantern_a'), 'unknown', 'not asked yet');
  const low = one([LANTERN, USES], live({ state: 'ready', text: 'answering · 4 ms', reports: [{ key: 'battery', label: 'Battery', value: 18, unit: '%', warn: true }, { key: 'signal', label: 'Signal', value: -50, unit: 'dBm', warn: false }] }), 'device.lantern_a');
  says(low, 'look', 'answering · 4 ms · Battery 18 %');
  const bare = one([{ op: 'device.add', device: { name: 'Lantern A', model: 'ec-prop-light' } }], live({ state: 'ready' }), 'device.lantern_a');
  says(bare, 'look', 'no address yet');
  assert.equal(bare.fix, 'Give it an address.');
  // the label is the name alone, in every state, and the text never repeats it (answering, not answering, cannot be asked, no address)
  for (const row of [ready, gone, bare]) assert.ok(!/answering|address/.test(row.label), row.label);
  assert.equal(bare.label, 'Lantern A');
  assert.equal(one([{ op: 'device.add', device: { id: 'p', name: 'Projector', via: 'text', host: '10.0.0.30', port: 4352, protocol: 'tcp' } }], {}, 'device.p').label, 'Projector');
  const cannot = one([{ op: 'device.add', device: { id: 'p', name: 'Projector', host: '10.0.0.30', port: 4352 } }], { liveness: { p: { state: 'unknown', text: 'It cannot be asked. Press Try and look at it.', reports: [] } } }, 'device.p');
  assert.deepEqual([cannot.label, cannot.state, cannot.text, cannot.actions], ['Projector', 'unknown', 'cannot be asked: press Try', []]);
  says(one([{ op: 'device.add', device: { id: 'p', name: 'Projector', host: '10.0.0.30', port: 4352 } }], {}, 'device.p'), 'unknown', 'cannot be asked: press Try');
});

test('unused is never a problem: the same fault on a device no cue uses, or one the show goes on without, is "to look at"', () => {
  const fault = { liveness: { lantern_a: { state: 'problem', text: 'not answering', reports: [] } } };
  const unused = one([LANTERN], fault, 'device.lantern_a');
  says(unused, 'look', 'not answering · no cue uses it');
  assert.equal(unused.needed, false);
  const optional = one([{ op: 'device.add', device: { ...LANTERN.device, needed: false } }, USES], fault, 'device.lantern_a');
  says(optional, 'look', 'not answering · not needed');
  says(one([LANTERN, USES], fault, 'device.lantern_a'), 'problem');
  // a raw Network cue that names the device uses it too
  says(one([LANTERN, { op: 'cue.add', cue: { type: 'network', patch: 'lantern_a', message: '/ec/on' } }], fault, 'device.lantern_a'), 'problem');
  assert.equal(check.summary(check.items(build([LANTERN]).doc, { ...SAVED, ...fault })).problems, 0);
});

test('unknown is never ready: it is counted apart, and the summary says so', () => {
  const items = check.items(build([LANTERN, USES, { op: 'cue.add', cue: { type: 'audio', file: 'media/a.wav' } }]).doc, { ...SAVED });
  const s = check.summary(items, 7);
  assert.deepEqual([s.total, s.ready, s.unknown, s.problems, s.look], [6, 3, 3, 0, 0]);
  assert.equal(s.text, '3 of 6 ready · 3 cannot be told');
  assert.ok(items.filter((i) => i.state === 'unknown').every((i) => i.fix === ''));
  assert.equal(check.summary([{ state: 'ready' }, { state: 'look' }, { state: 'look' }, { state: 'problem' }], 1).text, '1 of 4 ready · 2 to look at · 1 problem');
  assert.equal(check.summary([{ state: 'problem' }, { state: 'problem' }]).text, '0 of 2 ready · 2 problems');
  assert.equal(check.summary([]).text, '');
});

test('a patch a cue uses has a row, and an offer to make it a device; one no cue uses has none', () => {
  const ops = [{ op: 'show.set', path: 'settings.network.patches', value: [{ id: 'eos', name: 'Eos', host: '10.0.0.20', port: 8000, protocol: 'udp', device: 'etc-eos', listenPort: 8001 }, { id: 'spare', name: 'Spare', host: '10.0.0.21', port: 9000 }] },
    { op: 'cue.add', cue: { type: 'network', patch: 'eos', message: '/eos/cue/1/1/fire' } }];
  const b = build(ops);
  const net = (state, text = '') => ({ network: { patches: { eos: { state, text } } } });
  const rows = by(check.items(b.doc, { ...SAVED, ...net('sent') }));
  assert.equal(rows['patch.spare'], undefined);
  says(rows['patch.eos'], 'unknown', 'sent; cannot be asked if it arrived');
  assert.equal(rows['patch.eos'].label, 'Eos');
  says(by(check.items(b.doc, { ...SAVED, ...net('answering') }))['patch.eos'], 'ready');
  assert.deepEqual(['label', 'text'].map((k) => by(check.items(b.doc, { ...SAVED, ...net('answering') }))['patch.eos'][k]), ['Eos', 'answering']);
  says(by(check.items(b.doc, { ...SAVED, ...net('error', 'Eos is not connected') }))['patch.eos'], 'problem', 'Eos is not connected');
  // Make it a device: one edit, the same id, its model's commands copied in, and the cue still aimed at it
  const act = rows['patch.eos'].actions[0];
  assert.deepEqual([act.id, act.label, act.cmd.op], ['make-device', 'Make it a device', 'edit']);
  const after = applyOps(b.doc, act.cmd.ops).doc;
  assert.deepEqual(after.settings.network.patches.map((p) => p.id), ['spare']);
  const d = after.settings.rig.devices[0];
  assert.deepEqual([d.id, d.name, d.host, d.port, d.listenPort, d.model, d.commands.length, d.alive.send], ['eos', 'Eos', '10.0.0.20', 8000, 8001, 'etc-eos', 7, '/eos/ping']);
  const then = by(check.items(after, { ...SAVED }));
  assert.equal(then['patch.eos'], undefined);
  assert.equal(then['device.eos'].needed, true);
  assert.equal(then['show.cues'].state, 'ready');
  // a cue with no patch chosen uses the only patch
  const only = build([{ op: 'show.set', path: 'settings.network.patches', value: [{ id: 'eos', name: 'Eos', host: '10.0.0.20', port: 8000 }] }, { op: 'cue.add', cue: { type: 'network', message: '/go' } }]);
  assert.ok(by(check.items(only.doc, SAVED))['patch.eos']);
});

test('the input port, MIDI, modules, timecode, what is held back, and the operator’s own lines', () => {
  const input = (i) => ({ network: { input: i, patches: {} } });
  says(one([], input({ port: 53000, listening: true }), 'equipment.input'), 'ready');
  assert.equal(one([], input({ port: 53000, listening: true }), 'equipment.input').label, 'Listening on port 53000');
  says(one([], input({ port: 53000, listening: false, error: 'port 53000 is in use by another program' }), 'equipment.input'), 'problem', 'port 53000 is in use by another program');
  assert.equal(one([], input({ port: 0, listening: false }), 'equipment.input'), undefined, 'nothing wants the port: no row');
  const midi = [{ op: 'cue.add', cue: { type: 'midi', midi: 'pc 3' } }];
  says(one(midi, { midi: { outputs: [] } }, 'equipment.midi'), 'problem', 'no MIDI output on this computer');
  says(one(midi, { midi: { outputs: ['Keys'] } }, 'equipment.midi'), 'ready', 'Keys');
  says(one([...midi, { op: 'show.set', path: 'settings.midi.output', value: 'Desk' }], { midi: { outputs: ['Keys'] } }, 'equipment.midi'), 'problem', '“Desk” is not connected');
  assert.equal(one([...midi, { op: 'show.set', path: 'settings.midi.output', value: 'Desk' }], { midi: { outputs: ['Desk'] } }, 'equipment.midi').label, 'MIDI goes to Desk');
  assert.ok(one([{ op: 'device.add', device: { name: 'Sampler', via: 'midi' } }], { midi: { outputs: ['Keys'] } }, 'equipment.midi'), 'a MIDI device wants the MIDI output too');
  assert.equal(one([], { midi: { outputs: [] } }, 'equipment.midi'), undefined);
  const mods = { modules: [{ id: 'web-remote', name: 'Web remote', enabled: true, running: true, status: { ok: false, text: 'port 8137 is in use' } }, { id: 'osc-control', name: 'OSC control', enabled: true, running: true, status: { ok: true, text: 'listening' } }, { id: 'backup-link', name: 'Main and backup', enabled: false, running: false, status: null }] };
  const rows = by(check.items(build([]).doc, { ...SAVED, ...mods }));
  says(rows['module.web-remote'], 'problem', 'port 8137 is in use');
  says(rows['module.osc-control'], 'ready', 'listening');
  assert.equal(rows['module.backup-link'], undefined, 'a module that is off has no row');
  const tc = [{ op: 'show.set', path: 'settings.timecode.source', value: 'mtc' }];
  says(one(tc, { timecode: { arriving: false } }, 'connections.timecode'), 'look', 'none has arrived yet');
  says(one(tc, { timecode: { arriving: true } }, 'connections.timecode'), 'ready');
  assert.equal(one([], { timecode: { arriving: false } }, 'connections.timecode'), undefined);
  const held = one([], { overrides: [{ id: 'osc', label: 'OSC out', on: true }, { id: 'midi', label: 'MIDI out', on: false }] }, 'held');
  says(held, 'look', 'OSC out is held back: nothing reaches the equipment.');
  assert.deepEqual(held.actions, [{ id: 'let-go-osc', label: 'Let it go', cmd: { op: 'override', what: 'osc', on: false } }]);
  assert.equal(one([], { overrides: [{ id: 'osc', label: 'OSC out', on: false }] }, 'held'), undefined, 'nothing held: no row');
  const lines = [{ op: 'show.set', path: 'settings.rig.checks', value: [{ id: 'k1', text: 'Fresh batteries in both lanterns' }, { id: 'k2', text: 'Haze fluid' }] }];
  const ticked = by(check.items(build(lines).doc, { ...SAVED, ticks: { k2: true } }));
  assert.deepEqual([ticked['check.k1'].label, ticked['check.k1'].state, ticked['check.k1'].group, ticked['check.k2'].state], ['Fresh batteries in both lanterns', 'look', 'before', 'ready']);
  assert.deepEqual(ticked['check.k1'].actions[0].cmd, { op: 'rig-tick', id: 'k1', on: true });
});

test('from a folder alone (ec check): the rows a folder can answer, and nothing that needs the app', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-check-')), 'Show.ecshow');
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'media/a.wav'), 'x');
  const b = build([LANTERN, USES, { op: 'cue.add', cue: { type: 'audio', number: '2', file: 'media/a.wav' } }, { op: 'cue.add', cue: { type: 'audio', number: '3', file: 'media/lost.wav' } }, { op: 'cue.add', cue: { type: 'text', text: 'Hello' } }, { op: 'cue.add', cue: { type: 'midi', midi: 'pc 1' } },
    { op: 'show.set', path: 'settings.rig.checks', value: [{ id: 'k1', text: 'Haze fluid' }] }]);
  const facts = check.folderFacts(dir, b.doc);
  assert.deepEqual([facts.app, facts.saved, facts.files], [false, { untitled: false, dirty: false, changes: 0 }, { total: 2, missing: ['media/lost.wav'] }]);
  const items = check.items(b.doc, facts);
  assert.deepEqual(items.map((i) => [i.id, i.state]), [['show.saved', 'ready'], ['show.backups', 'ready'], ['show.cues', 'problem'], ['sound.files', 'problem'], ['device.lantern_a', 'unknown']]);
  assert.equal(by(items)['show.cues'].text, '1 cue is broken: 3.');
  assert.match(by(items)['device.lantern_a'].text, /ec check --ask/);
  // unsaved changes from the app, waiting beside the show
  fs.writeFileSync(path.join(dir, 'show.unsaved.json'), '{}');
  const dirty = by(check.items(b.doc, check.folderFacts(dir, b.doc)))['show.saved'];
  assert.deepEqual([dirty.state, dirty.actions], ['look', []]);
  assert.deepEqual(check.folderFacts(null, b.doc).saved, { untitled: true, dirty: false, changes: 0 });
});
