// Simple until asked (docs/specs/00-defaults.md): what a new show and a freshly imported QLab workspace do by
// themselves is what a plain cue list does. Anything that analyses, decides or acts on its own is off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const show = require('../core/show/show');
const { TYPES, COMMON } = require('../core/show/cue-types');
const { importQlab } = require('../core/import/qlab');
const { usesLive } = require('../core/show/uses-live');

/** Everything a show can switch on that acts by itself, read from a document. */
function clever(doc) {
  const s = doc.settings, on = [];
  if (s.audio.duck.on) on.push('ducking');
  if (s.audio.monitor.on) on.push('the monitor feed');
  if (s.light.on) on.push('lighting output');
  if (s.timecode.source !== 'off') on.push('timecode chase');
  if (s.network.listen) on.push('the OSC input held open');
  if (Object.values(s.network.commands).some(Boolean)) on.push('OSC show commands');
  if (s.midi.mscIn) on.push('MIDI Show Control in');
  if (Object.values(s.midi.commands).some(Boolean)) on.push('MIDI show commands');
  if (s.editing.longSoundsToMusic) on.push('long sounds to the Music bus');
  if (s.live.overlap || s.live.tempo || s.live.map.length) on.push('a Live setting');
  if (Object.keys(s.templates).length) on.push('a cue template');
  if (s.rig.devices.length) on.push('a device');
  if (s.rig.checks.length || s.rig.script) on.push('a checklist or a script');
  for (const [id, m] of Object.entries(doc.modules)) if (m.enabled) on.push(`the ${id} module`);
  return on;
}

test('a new show is a plain cue list: nothing that analyses, decides or acts by itself is on', () => {
  const doc = show.newShow('x');
  assert.deepEqual(clever(doc), []);
  assert.deepEqual(usesLive(doc), []);
  // the same through a save and a load, and for a file that names no settings at all
  assert.deepEqual(clever(show.normalise(JSON.parse(show.stringify(doc))).doc), []);
  assert.deepEqual(clever(show.normalise({ format: 'endless-cues-show', version: 1, lists: [] }).doc), []);
  // every module there is comes switched off
  assert.deepEqual(Object.keys(doc.modules).sort(), ['backup-link', 'lighting-desk', 'osc-control', 'show-feedback', 'web-remote']);
});

test('a new cue of any type starts plain: no quantise, warp, ducking, fading of others or auto-load', () => {
  const quiet = { onBeat: 'now', warp: '', fadeOthers: 0, duckOthers: 0, autoLoad: false, beatLead: 0, blend: '' };
  for (const [type, def] of Object.entries(TYPES)) {
    for (const f of [...COMMON, ...def.fields]) if (f.key in quiet) assert.equal(f.default ?? quiet[f.key], quiet[f.key], `${type}.${f.key}`);
  }
  assert.equal(TYPES.audio.fields.find((f) => f.key === 'bus').default, 'effects');
  assert.equal(TYPES.audio.fields.find((f) => f.key === 'tempo').default, undefined, 'no sound starts with a tempo');
  // what belongs to the Live view is marked, so the inspector can keep it out of a plain cue list
  assert.deepEqual(Object.values(TYPES).flatMap((d) => d.fields.filter((f) => f.live).map((f) => f.key)).sort(), ['desk']);
});

test('a show that has something switched on keeps it', () => {
  const doc = show.newShow('x');
  doc.settings.audio.duck.on = true;
  doc.settings.editing.longSoundsToMusic = true;
  doc.modules['web-remote'].enabled = true;
  const back = show.normalise(JSON.parse(show.stringify(doc))).doc;
  assert.deepEqual(clever(back), ['ducking', 'long sounds to the Music bus', 'the web-remote module']);
});

test('an imported QLab workspace is as plain as a new show', () => {
  for (const name of ['small.qlab5', 'small.qlab4']) {
    const file = path.join(__dirname, 'fixtures', name);
    const { doc } = importQlab(fs.readFileSync(file), { file });
    assert.deepEqual(clever(doc), [], name);
    assert.deepEqual(usesLive(doc), [], name);
    show.walk(doc, (c) => {
      assert.equal(c.tempo, undefined, `${name}: ${c.name} was given no tempo`);
      assert.ok(!c.warp && (!c.onBeat || c.onBeat === 'now'), `${name}: ${c.name} is not warped or quantised`);
    });
  }
});

test('a show says what in it came from the Live view', () => {
  const doc = show.newShow('x');
  assert.deepEqual(usesLive(doc), []);
  assert.deepEqual(usesLive(null), []);
  doc.lists[0].cues.push(
    { id: 'a', type: 'audio', file: 'a.wav', tempo: { bpm: 120, first: 0, bar: 4 } },               // a tempo alone changes nothing heard
    { id: 'b', type: 'audio', file: 'b.wav', tempo: { bpm: 120, first: 0, bar: 4 }, warp: 'repitch' },
    { id: 'g', type: 'group', onBeat: 'bar', children: [{ id: 'c', type: 'audio', file: 'c.wav', tempo: { bpm: 90, first: 0, bar: 4 }, warp: 'keep' }] },
    { id: 'm', type: 'mix', levels: { music: -6 } },
    { id: 'n', type: 'mix', desk: { crossfader: 0.5 } },
  );
  assert.deepEqual(usesLive(doc), ['2 warped sounds', 'a Mix cue that recalls the desk']);
  doc.settings.live.map = [{ on: 'key q', to: 'clip:a' }];
  doc.settings.live.tempo = 124;
  doc.settings.audio.buses[0].pan = -0.5;
  assert.deepEqual(usesLive(doc).slice(2), ['a key or control mapped to the desk', 'a desk tempo', 'a desk moved from rest']);
  // a bus level is the cue list's own mixer, not the desk's; so are a tempo and a group that waits for the bar
  const plain = show.newShow('y');
  plain.settings.audio.buses[0].db = -12;
  plain.lists[0].cues.push({ id: 'g', type: 'group', onBeat: 'bar', children: [{ id: 'a', type: 'audio', file: 'a.wav', tempo: { bpm: 120, first: 0, bar: 4 } }] });
  assert.deepEqual(usesLive(plain), []);
});

// ── the rig (docs/specs/15-assistant-and-rig.md, section 7) ──

test('a new show has no devices, asks nothing on the network, and its input port is shut', async () => {
  const { createHub } = require('../core/net/hub');
  const { createRig } = require('../app/main/rig-service');
  const rigDevices = require('../core/rig/devices');
  const check = require('../core/rig/check');
  const doc = show.newShow('x');
  assert.deepEqual(doc.settings.rig, { devices: [], checks: [], script: '' });
  assert.deepEqual(show.defaultSettings().rig, { devices: [], checks: [], script: '' });
  // the rig as the app runs it, on a hub that records what it would send and opens nothing
  const hub = createHub({ dryRun: true });
  const sent = [];
  const send = hub.send.bind(hub);
  hub.send = (...a) => { sent.push(a); return send(...a); };
  const rig = createRig({ hub, state: { mode: 'edit', midi: { outputs: [] } }, engine: { active: () => [], durations: new Map() }, overrides: {}, HELD: (w) => w, smoke: true, document: () => ({ doc, showDir: null }), facts: () => ({ saved: { untitled: true }, network: hub.status() }) });
  const n = doc.settings.network;
  hub.configure({ patches: n.patches, devices: rigDevices.patchesOf(doc), inputPort: n.inputPort, listen: !!n.listen || rig.wantsInput() });
  rig.configure();
  await new Promise((r) => setTimeout(r, 700));        // (longer than it takes a device to be asked, were there one)
  assert.deepEqual(sent, [], 'nothing is asked');
  assert.deepEqual(hub.monitor(), []);
  assert.equal(rig.wantsInput(), false);
  assert.deepEqual([hub.status().input.port, hub.status().input.listening], [0, false], 'the input port is shut');
  // the Rig page is there all the same, with its three rows, and it found them without sending anything
  const s = rig.snapshot();
  assert.deepEqual(s.items.map((i) => i.id), ['show.saved', 'show.backups', 'show.cues']);
  assert.deepEqual([s.devices, s.found, s.scanning, s.senders, s.ticks], [{}, null, false, [], {}]);
  assert.deepEqual(check.items(doc, {}).map((i) => i.group), ['show', 'show', 'show']);
  rig.close(); hub.close();
});

test('asking, listening and sending again each have one switch, and each is off until a device says so', () => {
  const rigDevices = require('../core/rig/devices');
  const { applyOps } = require('../core/show/ops');
  // a device written by hand asks nothing, is not listened for, and is sent each command once
  const plain = rigDevices.find(applyOps(show.newShow('x'), [{ op: 'device.add', device: { name: 'Projector', host: '10.0.0.30', port: 4352 } }]).doc, 'projector');
  assert.deepEqual([plain.alive, plain.resend, plain.needed], [{ how: 'none' }, undefined, undefined]);
  for (const f of rigDevices.FIELDS) if (f.key === 'resend') assert.equal(f.default, 0);
  assert.equal(rigDevices.ALIVE_FIELDS.find((f) => f.key === 'how').default, 'none');
  // "Ask it" is the switch for asking; "It says so by itself" is the switch for the input port; the kit's models set resend
  const { createLiveness } = require('../core/rig/liveness');
  const asked = [];
  const live = createLiveness({ send: (d, text) => { asked.push(text); return { ok: true }; } });
  live.configure([plain]);
  live.tick();
  assert.deepEqual([asked, live.wantsInput()], [[], false]);
  live.configure([{ ...plain, alive: { how: 'heartbeat', within: 5 } }]);
  live.tick();
  assert.deepEqual([asked, live.wantsInput()], [[], true]);
  live.configure([{ ...plain, alive: { how: 'ask', send: '/ping', every: 2 } }]);
  live.tick();
  assert.deepEqual([asked, live.wantsInput()], [['/ping'], false]);
  assert.equal(rigDevices.fromModel('ec-prop-light', {}).resend, 3);
  assert.equal(rigDevices.fromModel('etc-eos', {}).resend, undefined);
});

test('a show started in a folder of sounds has no cues; an imported workspace has no devices; a file is written only by an accepted proposal', () => {
  const os = require('os');
  const { ShowDocument } = require('../core/show/document');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-start-'));
  fs.writeFileSync(path.join(dir, '01 Overture.wav'), 'x');
  const d = ShowDocument.open(dir);
  assert.deepEqual(d.doc.lists.map((l) => l.cues.length), [0], 'the folder’s sounds are not made into cues by themselves');
  assert.deepEqual(d.doc.settings.rig.devices, []);
  for (const name of ['small.qlab5', 'small.qlab4']) {
    const file = path.join(__dirname, 'fixtures', name);
    assert.deepEqual(importQlab(fs.readFileSync(file), { file }).doc.settings.rig, { devices: [], checks: [], script: '' }, `${name}: its patches stay patches`);
  }
  const p = d.proposeDocument(d.doc, { files: [{ path: 'AGENTS.md', text: 'x\n' }] });
  assert.equal(fs.existsSync(path.join(dir, 'AGENTS.md')), false);
  d.reject(p.id);
  assert.equal(fs.existsSync(path.join(dir, 'AGENTS.md')), false, 'a proposal that is not accepted writes nothing');
});

test('updates: the daily check is on (the owner\'s decision: one GET of the feed, nothing about the person), test versions off, and nothing downloads or installs by itself', () => {
  const { settingsOf, FEED } = require('../core/update/updates');
  assert.deepEqual(settingsOf({}), { auto: true, test: false, lastCheck: 0 });
  assert.equal(FEED, 'https://downloads.endlesscues.com/');
  // (that nothing downloads before Download, nor installs before quit or Restart now, is test/updates.test.js)
});
