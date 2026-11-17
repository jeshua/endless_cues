// The three device operations, a patch made a device, and what the diff says of a device (docs/specs/15, section 3.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as show from '../core/show/show';
import { applyOps, OP_KEYS } from '../core/show/ops';
import { diffShows, describe, summary } from '../core/show/diff';
import * as devices from '../core/rig/devices';

const base = () => applyOps(show.newShow('t'), [{ op: 'device.add', device: { name: 'Lantern A', model: 'ec-prop-light', host: '10.0.0.42' } }]);
const refused = (doc, ops, re) => assert.throws(() => applyOps(doc, ops), (err) => err.name === 'OpError' && re.test(err.message), String(re));

test('device.add: an id made from the name, a model’s commands copied in, and what it added named in the result', () => {
  const r = base();
  assert.deepEqual(r.devices, { added: ['lantern_a'], changed: [], removed: [] });
  assert.deepEqual(r.made, [], '`made` is for cues');
  const d = devices.find(r.doc, 'lantern_a');
  assert.deepEqual([d.model, d.port, d.commands.length, d.alive.how, d.test], ['ec-prop-light', 53100, 7, 'ask', 'identify']);
  // a second of the same name takes another id; one written by hand, with no model, is kept as written
  const two = applyOps(r.doc, [{ op: 'device.add', device: { name: 'Lantern A', model: 'ec-prop-light' } }, { op: 'device.add', device: { id: 'projector', name: 'Projector', via: 'text', host: '10.0.0.30', port: 4352, protocol: 'tcp', commands: [{ id: 'power', label: 'Power', template: '%1POWR {on}\\r', params: [{ key: 'on', label: 'On', kind: 'number', default: 1, min: 0, max: 1, whole: true }] }] } }]);
  assert.deepEqual(two.devices.added, ['lantern_a_2', 'projector']);
  assert.equal(devices.find(two.doc, 'projector').alive.how, 'none', 'nothing is asked unless the device says so');
  assert.deepEqual(Object.keys(OP_KEYS).filter((k) => k.startsWith('device.')), ['device.add', 'device.set', 'device.remove']);
});

test('device.add and device.set are held to the same checks, and say what to send instead', () => {
  const { doc } = base();
  refused(doc, [{ op: 'device.add' }], /op 1 \(device\.add\): "device" is required/);
  refused(doc, [{ op: 'device.add', device: { host: '10.0.0.1' } }], /a device needs a name/);
  refused(doc, [{ op: 'device.add', device: { name: 'X', model: 'tricorder' } }], /no model “tricorder” \(the models are: generic, etc-eos/);
  refused(doc, [{ op: 'device.add', device: { id: 'lantern_a', name: 'Another' } }], /there is already a device with the id lantern_a \(Lantern A\)/);
  refused(doc, [{ op: 'device.add', device: { name: 'X', commands: [{ id: 'look', label: 'Look', template: '/ec/look {n}' }] } }], /the command “look” has \{n\} in its message and no parameter called n/);
  refused(doc, [{ op: 'device.add', device: { name: 'X', port: '8000' } }], /port is a number/);
  refused(doc, [{ op: 'device.set', id: 'lantern_a' }], /"props" is required/);
  refused(doc, [{ op: 'device.set', id: 'lantern_a', props: { id: 'lamp' } }], /a device’s id cannot be changed: cues name it/);
  refused(doc, [{ op: 'device.set', id: 'lamp', props: { name: 'L' } }], /no device with the id “lamp” \(the show has: lantern_a\)/);
  refused(doc, [{ op: 'device.set', id: 'lantern_a', props: { test: 'explode' } }], /test is the id of one of its commands/);
  refused(doc, [{ op: 'device.set', id: 'lantern_a', props: { name: null } }], /a device needs a name/);
  refused(doc, [{ op: 'device.set', id: 'lantern_a', host: '10.0.0.9' }], /“host” is not something a device\.set takes \(it takes: id, props\)/);
  refused(doc, [{ op: 'device.remove', id: 'lamp' }], /no device with the id “lamp”/);
  // the device list is not a setting to be set
  refused(doc, [{ op: 'show.set', path: 'settings.rig.devices', value: [] }], /devices are added and changed with device\.add, device\.set and device\.remove, not show\.set/);
  refused(doc, [{ op: 'show.set', path: 'settings.rig.devices.0.host', value: '10.0.0.9' }], /device\.add, device\.set and device\.remove/);
});

test('device.set sets fields (null clears; commands, reports and alive whole), device.remove breaks the cues that named it', () => {
  let r = applyOps(base().doc, [{ op: 'device.set', id: 'lantern_a', props: { host: '10.0.0.57', notes: 'Stage left.', resend: null, alive: { how: 'heartbeat', hears: '/ec/here', within: 6 }, needed: false } }]);
  const d = devices.find(r.doc, 'lantern_a');
  assert.deepEqual([d.host, d.notes, d.resend, d.needed], ['10.0.0.57', 'Stage left.', undefined, false]);
  assert.deepEqual(d.alive, { how: 'heartbeat', hears: '/ec/here', within: 6 });
  assert.deepEqual(r.devices, { added: [], changed: ['lantern_a'], removed: [] });
  r = applyOps(r.doc, [{ op: 'cue.add', ref: 'q', cue: { type: 'device', number: '5', device: 'lantern_a', command: 'identify' } }, { op: 'device.remove', id: 'lantern_a' }]);
  assert.deepEqual(r.devices.removed, ['lantern_a']);
  assert.deepEqual(show.problems(r.doc).map((p) => [p.id, p.level, p.why]), [[r.refs.q, 'error', 'its device is gone']]);
  assert.equal(show.toEngineDoc(r.doc).lists[0].cues[0].broken, 'its device is gone');
});

test('the checklist and the script are ordinary settings; the whole rig may come in a settings file, checked', () => {
  const { doc } = base();
  const r = applyOps(doc, [{ op: 'show.set', path: 'settings.rig.checks', value: [{ id: 'k1', text: 'Fresh batteries in both lanterns' }] }, { op: 'show.set', path: 'settings.rig.script', value: 'script.md' }]);
  assert.deepEqual(r.doc.settings.rig.checks, [{ id: 'k1', text: 'Fresh batteries in both lanterns' }]);
  assert.equal(r.doc.settings.rig.script, 'script.md');
  refused(doc, [{ op: 'show.set', path: 'settings.rig.checks', value: 'batteries' }], /settings\.rig\.checks is set whole: a list of/);
  refused(doc, [{ op: 'show.set', path: 'settings.rig.checks', value: [{ id: 'k1', text: 'a' }, { id: 'k1', text: 'b' }] }], /two lines have the id “k1”/);
  refused(doc, [{ op: 'show.set', path: 'settings.rig.script', value: 7 }], /settings\.rig\.script is text/);
  // settings.rig set whole (another show's settings file): the devices in it are held to the same checks
  const other = applyOps(show.newShow('o'), [{ op: 'show.set', path: 'settings.rig', value: r.doc.settings.rig }]);
  assert.equal(devices.list(other.doc).length, 1);
  refused(show.newShow('o'), [{ op: 'show.set', path: 'settings.rig', value: { devices: [{ id: 'x', name: 'X', commands: [{ id: 'a', label: 'A', template: 'no slash' }] }], checks: [], script: '' } }], /an OSC message starts with \//);
});

test('a patch made a device in one batch, in either order, keeps every cue aimed at it', () => {
  let doc = applyOps(show.newShow('t'), [
    { op: 'show.set', path: 'settings.network.patches', value: [{ id: 'desk', name: 'Eos', host: '10.0.0.20', port: 8000, protocol: 'udp', device: 'etc-eos' }] },
    { op: 'cue.add', ref: 'a', cue: { type: 'network', number: '1', patch: 'desk', message: '/eos/cue/1/1/fire' } },
    { op: 'cue.add', ref: 'b', cue: { type: 'network', number: '2', message: '/eos/key/go_0' } },      // sent to "the only patch"
  ]).doc;
  const add = { op: 'device.add', device: { id: 'desk', name: 'Eos', model: 'etc-eos', host: '10.0.0.20', port: 8000 } };
  const drop = { op: 'show.set', path: 'settings.network.patches', value: [] };
  // by itself, the device would share the patch's id
  refused(doc, [add], /a device and a patch both have the id desk/);
  for (const ops of [[add, drop], [drop, add]]) {
    const r = applyOps(doc, ops);
    assert.deepEqual(r.doc.settings.network.patches, []);
    assert.equal(devices.find(r.doc, 'desk').commands.length, 7);
    assert.deepEqual(show.problems(r.doc).filter((p) => p.level === 'error' && p.id === r.doc.lists[0].cues[0].id), [], 'the cue that named the patch names the device');
    const e = show.toEngineDoc(r.doc).lists[0].cues[0];
    assert.deepEqual([e.type, e.patch, e.broken], ['network', 'desk', undefined]);
  }
});

test('the diff says what happened to a device as an operator reads it', () => {
  const a = show.newShow('t');
  const b = applyOps(a, [{ op: 'device.add', device: { name: 'Lantern A', model: 'ec-prop-light', host: '10.0.0.42' } }]).doc;
  let ch = diffShows(a, b);
  assert.deepEqual(ch, [{ kind: 'device-added', id: 'lantern_a', label: 'Lantern A', text: 'prop · 10.0.0.42:53100 · 7 commands · asked every 2 s' }]);
  assert.equal(describe(ch), 'device Lantern A added');
  assert.equal(summary(ch).devices, 1);
  const d = devices.find(b, 'lantern_a');
  const c = applyOps(b, [{ op: 'device.set', id: 'lantern_a', props: { host: '10.0.0.57', needed: false, alive: { how: 'none' },
    commands: [...d.commands.filter((x) => x.id !== 'off'), { id: 'strobe', label: 'Strobe', template: '/ec/effect flicker 4' }] } }]).doc;
  ch = diffShows(b, c);
  assert.equal(ch.length, 1);
  assert.deepEqual([ch[0].kind, ch[0].id, ch[0].label], ['device-changed', 'lantern_a', 'Lantern A']);
  const by = Object.fromEntries(ch[0].fields.map((f) => [f.field, [f.label, f.from, f.to]]));
  assert.deepEqual(by.host, ['Address', '10.0.0.42', '10.0.0.57']);
  assert.deepEqual(by.commands, ['Commands', '7', '7 (added Strobe; removed Off (dark))']);
  assert.deepEqual(by.alive, ['Is it there', 'asked every 2 s (/ec/hello)', 'cannot be asked']);
  assert.deepEqual(by.needed, ['The show needs it', '—', 'no']);
  assert.match(describe(ch), /^device Lantern A: \d changes$/);
  ch = diffShows(c, a);
  assert.deepEqual([ch[0].kind, ch[0].label], ['device-removed', 'Lantern A']);
  // a device is never also reported as a settings path; the checklist is an ordinary setting
  const e = applyOps(b, [{ op: 'show.set', path: 'settings.rig.checks', value: [{ id: 'k1', text: 'Haze fluid' }] }]).doc;
  assert.deepEqual(diffShows(a, e).map((x) => x.kind), ['device-added', 'setting']);
  assert.ok(!diffShows(a, b).some((x) => x.kind === 'setting'));
});
