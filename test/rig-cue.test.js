// A cue that sends one of a device's named commands (docs/specs/15, section 3.4), and what did not change: an
// old show, a raw Network cue, "the only patch".
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const show = require('../core/show/show');
const { applyOps } = require('../core/show/ops');
const { TYPES, TYPE_ORDER } = require('../core/show/cue-types');
const { ShowDocument } = require('../core/show/document');
const { simulate, describe } = require('../core/engine/dry-run');
const { createHub } = require('../core/net/hub');
const devices = require('../core/rig/devices');
const { rig, build } = require('./helpers');

const LANTERN = { op: 'device.add', device: { name: 'Lantern A', model: 'ec-prop-light', host: '10.0.0.42' } };
const SAMPLER = { op: 'device.add', device: { name: 'Sampler', kind: 'instrument', via: 'midi', commands: [
  { id: 'scene', label: 'Scene', template: 'pc {n} ch 10', params: [{ key: 'n', label: 'Program', kind: 'number', default: 1, min: 0, max: 127, whole: true }] },
  { id: 'volume', label: 'Volume', template: 'cc 7 {v} ch 10', fade: 'v', params: [{ key: 'v', label: 'Volume', kind: 'number', default: 100, min: 0, max: 127, whole: true }] }] } };
/** An engine that keeps what it is asked to send, with the cue it came from. */
const playing = (doc) => { const sent = [], midi = []; const r = rig(doc, { send: (m, cue) => sent.push({ m, patch: cue.patch, format: cue.format, sends: cue.sends }), midi: (cue) => midi.push(cue.midi) }); return { ...r, sent, midi }; };

test('the Device cue is a cue type like any other: one table says what it is', () => {
  assert.deepEqual([TYPES.device.label, TYPES.device.glyph, TYPES.device.summary], ['Device', '◈', 'Sends a device’s command.']);
  assert.equal(TYPE_ORDER[TYPE_ORDER.indexOf('network') + 1], 'device');
  assert.deepEqual(TYPES.device.fields.map((f) => [f.key, f.kind, !!f.required]), [['device', 'device', true], ['command', 'command', true], ['args', 'args', false], ['fadeTo', 'number', false], ['duration', 'seconds', false], ['curve', 'enum', false]]);
});

test('a Device cue sends the composed message to its device, and is named for what it does', () => {
  const b = build([LANTERN, { op: 'cue.add', ref: 'q', cue: { type: 'device', number: '12.1', device: 'lantern_a', command: 'effect', args: { name: 'breathe' } } }, { op: 'cue.add', cue: { type: 'device', device: 'lantern_a', command: 'identify' } }]);
  assert.deepEqual(show.problems(b.doc), []);
  const e = show.toEngineDoc(b.doc).lists[0].cues[0];
  assert.deepEqual([e.type, e.name, e.patch, e.format, e.message, e.sends, e.duration, e.device], ['network', 'Lantern A ▸ Effect (breathe)', 'lantern_a', 'osc', '/ec/effect breathe', 'Lantern A ▸ Effect (breathe)', undefined, undefined]);
  const r = playing(b.doc);
  r.engine.go(); r.engine.go();
  assert.deepEqual(r.sent, [{ m: '/ec/effect breathe', patch: 'lantern_a', format: 'osc', sends: 'Lantern A ▸ Effect (breathe)' }, { m: '/ec/identify', patch: 'lantern_a', format: 'osc', sends: 'Lantern A ▸ Identify' }]);
  // the dry run says what it is as well as what it sends
  assert.match(describe(simulate(b.doc, { gos: 1 })), /⇄ Lantern A ▸ Effect \(breathe\) {2}\/ec\/effect breathe {2}→ Lantern A/);
});

test('a Device cue fades a value: from the argument’s value to "Fade to", over its duration', () => {
  const b = build([LANTERN, { op: 'cue.add', cue: { type: 'device', device: 'lantern_a', command: 'level', args: { level: 0 }, fadeTo: 1, duration: 2 } }]);
  assert.deepEqual(show.problems(b.doc), []);
  const e = show.toEngineDoc(b.doc).lists[0].cues[0];
  assert.deepEqual([e.message, e.fadeFrom, e.fadeTo, e.duration, e.name], ['/ec/level #v#', 0, 1, 2, 'Lantern A ▸ Level (0 → 1)']);
  const r = playing(b.doc);
  r.engine.go();
  r.advance(1);
  r.advance(1.1);
  assert.equal(r.sent[0].m, '/ec/level 0.0');
  assert.equal(r.sent.at(-1).m, '/ec/level 1.0');
  assert.ok(r.sent.length > 30 && r.sent.some((x) => /level 0\.5/.test(x.m)), 'it moved through the values between');
  // out of the command's range, or on a command with nothing to fade
  const bad = build([LANTERN, { op: 'cue.add', ref: 'a', cue: { type: 'device', device: 'lantern_a', command: 'level', fadeTo: 3, duration: 2 } }, { op: 'cue.add', ref: 'b', cue: { type: 'device', device: 'lantern_a', command: 'identify', fadeTo: 1, duration: 2 } }]);
  const why = Object.fromEntries(show.problems(bad.doc).map((p) => [p.id, [p.level, p.why]]));
  assert.deepEqual(why[bad.id('a')], ['error', 'its “Fade to”: level must be between 0 and 1']);
  assert.deepEqual(why[bad.id('b')][0], 'warning');
  // …which is then sent once, not again and again for its duration
  const once = show.toEngineDoc(bad.doc).lists[0].cues[1];
  assert.deepEqual([once.message, once.duration, once.fadeTo], ['/ec/identify', undefined, undefined]);
});

test('a Device cue is broken, never thrown, when its device or command is gone, or its argument cannot be', () => {
  const b = build([LANTERN, { op: 'device.add', device: { name: 'No address yet', model: 'ec-prop-switch' } },
    { op: 'cue.add', ref: 'gone', cue: { type: 'device', device: 'lantern_b', command: 'identify' } },
    { op: 'cue.add', ref: 'cmd', cue: { type: 'device', device: 'lantern_a', command: 'blink' } },
    { op: 'cue.add', ref: 'arg', cue: { type: 'device', device: 'lantern_a', command: 'level', args: { level: 7 } } },
    { op: 'cue.add', ref: 'addr', cue: { type: 'device', device: 'no_address_yet', command: 'on' } },
    { op: 'cue.add', ref: 'none', cue: { type: 'device' } },
    { op: 'cue.add', ref: 'ok', cue: { type: 'device', device: 'lantern_a', command: 'on' } }]);
  const why = {};
  for (const p of show.problems(b.doc)) if (p.level === 'error' && !why[p.id]) why[p.id] = p.why;      // (the first thing wrong with each is what the list shows)
  assert.equal(why[b.id('gone')], 'its device is gone');
  assert.equal(why[b.id('cmd')], 'Lantern A has no command “blink” (it has: look, color, level, effect, on, off, identify)');
  assert.equal(why[b.id('arg')], 'level must be between 0 and 1');
  assert.equal(why[b.id('addr')], 'its device has no address yet');
  assert.equal(why[b.id('none')], 'no device');
  assert.equal(why[b.id('ok')], undefined);
  const r = playing(b.doc);
  for (let i = 0; i < 6; i++) r.engine.go();
  assert.deepEqual(r.sent.map((x) => x.m), ['/ec/on'], 'the broken ones are skipped; the one that works is sent');
});

test('a MIDI device’s command is a MIDI message, and its value fades as a MIDI cue’s does', () => {
  const b = build([SAMPLER, { op: 'cue.add', cue: { type: 'device', device: 'sampler', command: 'scene', args: { n: 5 } } }, { op: 'cue.add', cue: { type: 'device', device: 'sampler', command: 'volume', args: { v: 0 }, fadeTo: 100, duration: 1 } }]);
  assert.deepEqual(show.problems(b.doc), []);
  const [a, f] = show.toEngineDoc(b.doc).lists[0].cues;
  assert.deepEqual([a.type, a.midi, a.name, a.patch], ['midi', 'pc 5 ch 10', 'Sampler ▸ Scene (5)', undefined]);
  assert.deepEqual([f.type, f.midi, f.fadeTo, f.duration], ['midi', 'cc 7 0 ch 10', 100, 1]);
  const r = playing(b.doc);
  r.engine.go();
  assert.deepEqual(r.midi, ['pc 5 ch 10']);
  r.engine.go(); r.advance(1.2);
  assert.match(r.midi.at(-1), /^cc 7 100/);
  assert.match(describe(simulate(b.doc, { gos: 1 })), /⇄ Sampler ▸ Scene \(5\) {2}pc 5 ch 10 {2}→ MIDI/);
});

test('a raw Network cue may name a device; "the only patch" still counts patches only', () => {
  const b = build([
    { op: 'show.set', path: 'settings.network.patches', value: [{ id: 'desk', name: 'Desk', host: '10.0.0.20', port: 8000, protocol: 'udp' }] },
    { op: 'cue.add', ref: 'only', cue: { type: 'network', message: '/go' } },                              // no patch chosen: the only patch
    LANTERN,                                                                                                 // …and adding a device does not re-aim it
    { op: 'cue.add', ref: 'raw', cue: { type: 'network', patch: 'lantern_a', message: '/ec/color 255 0 0' } },
    SAMPLER,
    { op: 'cue.add', ref: 'midi', cue: { type: 'network', patch: 'sampler', message: '/x' } },
    { op: 'cue.add', ref: 'lost', cue: { type: 'network', patch: 'nowhere', message: '/x' } }]);
  const why = Object.fromEntries(show.problems(b.doc).map((p) => [p.id, p.why]));
  assert.equal(why[b.id('only')], undefined);
  assert.equal(why[b.id('raw')], undefined);
  assert.equal(why[b.id('midi')], 'Sampler is a MIDI device: a Network cue cannot send to it');
  assert.equal(why[b.id('lost')], 'its network patch is gone');
  // through the hub (a test run: recorded, not sent)
  const hub = createHub({ dryRun: true });
  hub.configure({ patches: b.doc.settings.network.patches, devices: devices.patchesOf(b.doc) });
  assert.match(hub.send(null, '/go').who, /^Desk 10\.0\.0\.20:8000/);
  assert.match(hub.send('lantern_a', '/ec/color 255 0 0').who, /^Lantern A 10\.0\.0\.42:53100/);
  // with no patch at all, a device is still not "the only patch"
  hub.configure({ patches: [], devices: devices.patchesOf(b.doc) });
  const e = hub.send(null, '/go');
  assert.deepEqual([e.ok, e.why], [false, 'no network patch (Settings ▸ Integrations ▸ Network)']);
  assert.match(describe(simulate(b.doc, { gos: 2 })), /⇄ \/ec\/color 255 0 0 {2}→ Lantern A/);
  hub.close();
});

test('an old show opens, plays and saves byte for byte as it did, with its patches untouched', () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/before-kinds.ecshow/show.json'), 'utf8');
  const raw = JSON.parse(fixture);
  raw.settings = { ...(raw.settings || {}), network: { patches: [{ id: 'desk', name: 'Desk', host: '10.0.0.20', port: 8000, protocol: 'udp', device: 'etc-eos' }] } };
  const { doc } = show.normalise(JSON.parse(fixture));
  // what this app writes for it is, to the byte, what the app wrote before there was a rig (the hash is of that)
  const text = show.stringify(doc);
  assert.equal(crypto.createHash('sha256').update(text).digest('hex'), 'cc6a454e9fd43e334ee785969e8044a0cca3b3124bae149aa795f10a865719a9');
  assert.ok(!text.includes('"rig"'), 'a rig with nothing in it is not written');
  assert.deepEqual(doc.settings.rig, { devices: [], checks: [], script: '' }, '…though the open show has one');
  // opened from a folder and saved: the file is what it was, and a second save writes nothing
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-old-')), 'Old.ecshow');
  fs.mkdirSync(dir, { recursive: true });
  const withPatch = show.stringify(show.normalise(raw).doc);
  fs.writeFileSync(path.join(dir, 'show.json'), withPatch);
  const d = ShowDocument.open(dir);
  assert.equal(d.dirty, false);
  d.save();
  assert.equal(fs.readFileSync(path.join(dir, 'show.json'), 'utf8'), withPatch);
  assert.equal(d.save(), null);
  assert.deepEqual(d.doc.settings.network.patches, [{ id: 'desk', name: 'Desk', host: '10.0.0.20', port: 8000, protocol: 'udp', device: 'etc-eos' }]);
  assert.deepEqual(devices.list(d.doc), [], 'its patch stays a patch until someone asks');
  // and it plays
  const r = rig(doc);
  r.engine.go();
  assert.equal(r.audio.calls.filter((c) => c[0] === 'play').length, 1);
  // a show with a device does write its rig, and reads it back the same
  const two = applyOps(d.doc, [LANTERN]).doc;
  assert.ok(show.stringify(two).includes('"rig"'));
  assert.equal(show.stringify(show.normalise(JSON.parse(show.stringify(two))).doc), show.stringify(two));
});
