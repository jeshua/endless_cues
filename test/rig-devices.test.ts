// Devices: the equipment a show talks to, as part of the show (core/rig/devices.ts; docs/specs/15-assistant-and-rig.md, section 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as show from '../core/show/show';
import { applyOps } from '../core/show/ops';
import * as devices from '../core/rig/devices';
import * as models from '../core/net/devices';
import type { Device, ShowDoc } from '../core/show/types';

const lantern = (over = {}) => devices.fromModel('ec-prop-light', { id: 'lantern_a', name: 'Lantern A', host: '10.0.0.42', ...over }) as Device;
const withDevice = (d: Partial<Device>) => applyOps(show.newShow('t'), [{ op: 'device.add', device: d }]).doc;

test('a device round-trips through normalise and stringify, and what this version does not know is kept', () => {
  const doc = withDevice({ ...lantern(), notes: 'In the stage-left wing.', madeUpLater: { x: 1 } });
  const text = show.stringify(doc);
  const back = show.normalise(JSON.parse(text));
  assert.deepEqual(back.warnings, []);
  assert.equal(show.stringify(back.doc), text);
  const d = devices.find(back.doc, 'lantern_a')!;
  assert.equal(d.name, 'Lantern A');
  assert.deepEqual(d.madeUpLater, { x: 1 }, 'a field from a newer version is kept as it was');
  assert.deepEqual([d.kind, d.via, d.port, d.protocol, d.test, d.resend], ['prop', 'osc', 53100, 'udp', 'identify', 3]);
  assert.deepEqual(d.alive, { how: 'ask', send: '/ec/hello', reply: '/ec/here', every: 2 });
  assert.deepEqual(d.reports!.map((r) => [r.key, r.arg]), [['fw', 2], ['state', 3], ['signal', 5], ['battery', 6]]);
});

test('reading is forgiving: a field that cannot be understood is dropped and said, and the device is kept', () => {
  const raw = show.newShow('t');
  raw.settings.rig.devices = [
    { id: 'Bad Id', name: 'Desk', port: 'eight thousand', kind: 'spaceship', commands: [{ id: 'go', label: 'Go', template: '/go' }, { id: 'no template' }], alive: { how: 'sometimes' }, test: 'nope' },
    'not a device',
    { id: 'desk', name: 'Second with the same id' },
  ] as unknown as Device[];
  const { doc, warnings } = show.normalise(JSON.parse(JSON.stringify(raw)));
  const list = devices.list(doc);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'desk_2', 'an id that is not one is made from the name, clear of the ids there are');
  assert.equal(list[1].id, 'desk');
  assert.deepEqual([list[0].kind, list[0].via, list[0].port, list[0].test, list[0].alive.how, list[0].commands.length], ['other', 'osc', undefined, undefined, 'none', 1]);
  for (const word of ['not a port', 'kind', 'cannot be understood', 'safe to try', 'not a device']) assert.ok(warnings.some((w) => w.includes(word)), word);
});

test('writing is strict: every sentence of trouble', () => {
  const says = (d: unknown, re: RegExp, doc: ShowDoc | null = null) => assert.ok(devices.trouble(d, doc).some((t) => re.test(t)), `${re} in ${JSON.stringify(devices.trouble(d, doc))}`);
  assert.deepEqual(devices.trouble(lantern()), []);
  for (const id of Object.keys(models.DEVICES)) assert.deepEqual(devices.trouble(devices.fromModel(id, { id: 'x', name: 'X', host: '10.0.0.2' })), [], `the model ${id} makes a device that may be kept`);
  says('nope', /a device is an object/);
  says({ name: 'X' }, /a device’s id is lower-case letters/);
  says({ id: 'Lantern', name: 'X' }, /a device’s id is lower-case letters.*"Lantern"/);
  says({ id: 'x' }, /a device needs a name/);
  says({ id: 'x', name: 'X', kind: 'robot' }, /kind is one of desk, prop/);
  says({ id: 'x', name: 'X', via: 'smoke' }, /via is one of osc, text, hex, midi/);
  says({ id: 'x', name: 'X', port: '8000' }, /port is a number, 1–65535 \(it was given "8000"\)/);
  says({ id: 'x', name: 'X', port: 70000 }, /port is a number/);
  says({ id: 'x', name: 'X', protocol: 'smoke' }, /protocol is udp or tcp/);
  says({ id: 'x', name: 'X', via: 'midi', host: '10.0.0.1' }, /a MIDI device has no address/);
  says({ id: 'x', name: 'X', resend: 9 }, /resend is a whole number from 0 to 5/);
  says({ id: 'x', name: 'X', needed: 'yes' }, /needed is true or false/);
  says({ id: 'x', name: 'X', commands: 'go' }, /commands is a list/);
  says({ id: 'x', name: 'X', commands: new Array(65).fill(0).map((_, i) => ({ id: `c${i}`, label: 'C', template: '/c' })) }, /at most 64 commands/);
  says({ id: 'x', name: 'X', commands: [{ id: 'Go!', label: 'Go', template: '/go' }] }, /a command’s id is lower-case/);
  says({ id: 'x', name: 'X', commands: [{ id: 'go', label: 'Go', template: '/go' }, { id: 'go', label: 'Go', template: '/go' }] }, /two commands have the id go/);
  says({ id: 'x', name: 'X', commands: [{ id: 'go', template: '/go' }] }, /needs a label/);
  says({ id: 'x', name: 'X', commands: [{ id: 'go', label: 'Go' }] }, /needs a template/);
  says({ id: 'x', name: 'X', commands: [{ id: 'look', label: 'Look', template: '/ec/look {n}' }] }, /the command “look” has \{n\} in its message and no parameter called n/);
  says({ id: 'x', name: 'X', commands: [{ id: 'look', label: 'Look', template: '/ec/look', params: [{ key: 'n', kind: 'number', default: 1 }] }] }, /has a parameter n that its message does not use/);
  says({ id: 'x', name: 'X', commands: [{ id: 'e', label: 'E', template: '/e {name}', params: [{ key: 'name', kind: 'enum' }] }] }, /name is an enum and needs its options/);
  says({ id: 'x', name: 'X', commands: [{ id: 'e', label: 'E', template: '/e {n}', params: [{ key: 'n', kind: 'colour' }] }] }, /the kind of n is number, text or enum/);
  says({ id: 'x', name: 'X', commands: [{ id: 'e', label: 'E', template: '/e {n}', params: [{ key: 'n', kind: 'number', min: 'low' }] }] }, /the min of n is a number/);
  says({ id: 'x', name: 'X', commands: [{ id: 'e', label: 'E', template: '/e {n}', fade: 'n', params: [{ key: 'n', kind: 'text' }] }] }, /fade names the one numeric parameter/);
  says({ id: 'x', name: 'X', commands: [{ id: 'go', label: 'Go', template: 'go now' }] }, /an OSC message starts with \//);
  says({ id: 'x', name: 'X', via: 'hex', commands: [{ id: 'go', label: 'Go', template: 'FE 0G' }] }, /its message cannot be sent: not hex/);
  says({ id: 'x', name: 'X', via: 'midi', commands: [{ id: 'go', label: 'Go', template: 'bang {n}', params: [{ key: 'n', kind: 'number', default: 1 }] }] }, /its message cannot be sent/);
  says({ id: 'x', name: 'X', commands: [], test: 'identify' }, /test is the id of one of its commands, or empty/);
  says({ id: 'x', name: 'X', alive: { how: 'maybe' } }, /alive is \{ "how": "ask" \| "heartbeat" \| "none"/);
  says({ id: 'x', name: 'X', alive: { how: 'ask', send: 'hello' } }, /the message it is asked with \(alive\.send\) is not OSC/);
  says({ id: 'x', name: 'X', alive: { how: 'ask', send: '/hello', every: 90 } }, /alive\.every is a number of seconds, 1 to 30/);
  says({ id: 'x', name: 'X', alive: { how: 'ask', send: '/hello', reply: 'here' } }, /alive\.reply is an OSC address pattern/);
  says({ id: 'x', name: 'X', alive: { how: 'heartbeat', within: 0 } }, /alive\.within is a number of seconds/);
  says({ id: 'x', name: 'X', via: 'midi', alive: { how: 'ask', send: 'pc 1' } }, /a MIDI device cannot be asked/);
  says({ id: 'x', name: 'X', reports: [{ key: 'fw' }] }, /a report is \{ "key"/);
  says({ id: 'x', name: 'X', reports: new Array(13).fill(0).map((_, i) => ({ key: `k${i}`, label: 'K', from: '/k' })) }, /at most 12 reports/);
  says({ id: 'x', name: 'X', reports: [{ key: 'fw', label: 'F', from: '/x', arg: -1 }] }, /arg is which argument, counted from 0/);
  // in a show: an id is one thing's, among devices and patches alike
  const doc = withDevice(lantern());
  doc.settings.network.patches.push({ id: 'lantern_a', name: 'A patch', host: '10.0.0.9', port: 8000 });
  says(devices.find(doc, 'lantern_a'), /a device and a patch both have the id lantern_a/, doc);
  doc.settings.rig.devices.push({ ...lantern() });
  says(devices.find(doc, 'lantern_a'), /two devices have the id lantern_a/, doc);
});

test('compose: defaults, ranges, whole numbers, enums, a faded value, and quotes kept as written', () => {
  const d = lantern();
  assert.deepEqual(devices.compose(d, 'look'), { ok: true, message: '/ec/look 1' });
  assert.deepEqual(devices.compose(d, 'look', { n: 3.4 }), { ok: true, message: '/ec/look 3' }, 'a whole number is rounded');
  assert.deepEqual(devices.compose(d, 'look', { n: '7' }), { ok: true, message: '/ec/look 7' });
  assert.deepEqual(devices.compose(d, 'look', { n: 12 }), { ok: false, why: 'n must be between 0 and 8' });
  assert.deepEqual(devices.compose(d, 'look', { n: 'bright' }), { ok: false, why: 'n must be a number' });
  assert.deepEqual(devices.compose(d, 'level', { level: 0.25 }), { ok: true, message: '/ec/level 0.25' });
  assert.deepEqual(devices.compose(d, 'level', { level: 2 }), { ok: false, why: 'level must be between 0 and 1' });
  assert.deepEqual(devices.compose(d, 'level', { level: 0 }, { fade: true }), { ok: true, message: '/ec/level #v#' });
  assert.deepEqual(devices.compose(d, 'effect'), { ok: true, message: '/ec/effect breathe' });
  assert.deepEqual(devices.compose(d, 'effect', { name: 'strobe' }), { ok: false, why: 'name must be one of steady, breathe, pulse, flicker' });
  assert.deepEqual(devices.compose(d, 'identify', {}, { fade: true }), { ok: false, why: '“Identify” has no value that can fade' });
  assert.deepEqual(devices.compose(d, 'blink'), { ok: false, why: 'Lantern A has no command “blink” (it has: look, color, level, effect, on, off, identify)' });
  const desk = devices.fromModel('etc-eos', { id: 'desk', name: 'Lighting desk', host: '10.0.0.20' });
  assert.equal((devices.compose(desk, 'fire', { cue: '12' }) as { message: string }).message, '/eos/cue/1/12/fire');
  assert.equal((devices.compose(desk, 'cmd', { command: 'Chan 1 At 50#' }) as { message: string }).message, '/eos/newcmd "Chan 1 At 50#"', 'a template that needs quotes has them');
  // one function with a patch's device templates, which do not refuse a value
  assert.equal(models.compose('etc-eos', 'fire', { cue: 12 }), '/eos/cue/1/12/fire');
  assert.equal(models.compose('x32', 'fader', {}, { fade: true }), '/ch/01/mix/fader #v#');
  assert.equal(models.compose('x32', 'mute', { on: 'yes' }), '/ch/01/mix/on yes');
  assert.equal(models.compose('etc-eos', 'nope'), null);
  assert.equal(devices.cueName(d, { command: 'effect', args: { name: 'pulse' } }), 'Lantern A ▸ Effect (pulse)');
  assert.equal(devices.cueName(d, { command: 'identify' }), 'Lantern A ▸ Identify');
  assert.equal(devices.cueName(d, { command: 'level', args: { level: 0 }, fadeTo: 1 }), 'Lantern A ▸ Level (0 → 1)');
});

test('a model is what a device is started from: its commands are copied in, and what the person said wins', () => {
  const d = devices.fromModel('etc-eos', { id: 'desk', name: 'Lighting desk', host: '10.0.0.20' })!;
  assert.deepEqual([d.kind, d.model, d.port, d.listenPort, d.commands.length], ['desk', 'etc-eos', 8000, 8001, 7]);
  assert.deepEqual(d.alive, { how: 'ask', send: '/eos/ping', reply: '/eos/out/*', every: 2 });
  d.commands[0].template = '/changed';
  assert.equal(models.DEVICES['etc-eos'].commands[0].template, '/eos/cue/{list}/{cue}/fire', 'a copy: editing a device never changes the model');
  assert.equal(devices.fromModel('x32', { name: 'Desk', port: 10099 })!.port, 10099);
  assert.deepEqual(devices.fromModel('x32', {})!.alive, { how: 'ask', send: '/info', every: 2 }, 'a model that answers its test is asked with it');
  assert.equal(devices.fromModel('grandma3', {})!.alive, undefined, 'one that does not cannot be asked');
  assert.equal(devices.fromModel('nope', {}), null);
  // the kit's two props are in the table every picker reads
  const kit = models.list().filter((m) => m.id.startsWith('ec-prop-'));
  assert.deepEqual(kit.map((m) => [m.id, m.port, m.kind, m.tryCommand, m.resend, m.test]), [['ec-prop-light', 53100, 'prop', 'identify', 3, '/ec/hello'], ['ec-prop-switch', 53100, 'prop', 'identify', 3, '/ec/hello']]);
});

test('ids, the outline’s line, and a device as the hub wants it', () => {
  assert.equal(devices.idFrom('Lantern A'), 'lantern_a');
  assert.equal(devices.idFrom('Lantern A', ['lantern_a', 'lantern_a_2']), 'lantern_a_3');
  assert.equal(devices.idFrom('12 volt relay'), 'd_12_volt_relay');
  assert.equal(devices.idFrom(''), 'device');
  assert.ok(devices.ID.test(devices.idFrom('Ünïcödé — a very long name that goes on and on and on')));
  assert.equal(devices.line(devices.clean(lantern()).device!), 'lantern_a = Lantern A (prop, ec-prop-light, osc udp 10.0.0.42:53100; commands: look(n), color(r, g, b), level(level, fades), effect(name), on, off, identify; asked every 2 s)');
  assert.match(devices.line(devices.clean({ id: 'sampler', name: 'Sampler', kind: 'instrument', via: 'midi', commands: [{ id: 'scene', label: 'Scene', template: 'pc {n} ch 10', params: [{ key: 'n', kind: 'number', default: 1 }] }] }).device!), /^sampler = Sampler \(instrument, midi; commands: scene\(n\); cannot be asked\)$/);
  assert.match(devices.line(devices.clean({ id: 'x', name: 'X' }).device!), /no address yet; commands: none yet/);
  const doc = applyOps(withDevice(lantern()), [{ op: 'device.add', device: { name: 'Sampler', via: 'midi', commands: [] } }]).doc;
  const hub = devices.patchesOf(doc);
  assert.equal(hub.length, 1, 'a MIDI device is not a patch to the hub');
  assert.deepEqual([hub[0].id, hub[0].name, hub[0].host, hub[0].port, hub[0].format, hub[0].resend, hub[0].isDevice], ['lantern_a', 'Lantern A', '10.0.0.42', 53100, 'osc', 3, true]);
  assert.equal(devices.describe(devices.find(doc, 'lantern_a')!), 'prop · 10.0.0.42:53100 · 7 commands · asked every 2 s');
});

test('the tables are what a device is: every field of a kept device is in FIELDS', () => {
  const keys = new Set(devices.FIELDS.map((f) => f.key));
  for (const k of Object.keys(devices.clean(lantern({ notes: 'x', needed: false, listenPort: 9000 })).device!)) assert.ok(keys.has(k), k);
  for (const t of [devices.COMMAND_FIELDS, devices.PARAM_FIELDS, devices.ALIVE_FIELDS, devices.REPORT_FIELDS]) for (const f of t) assert.ok(f.key && f.kind && f.label, JSON.stringify(f));
  assert.deepEqual(devices.KINDS, ['desk', 'prop', 'media', 'sound', 'computer', 'instrument', 'other']);
  assert.deepEqual(devices.VIAS, ['osc', 'text', 'hex', 'midi']);
});
