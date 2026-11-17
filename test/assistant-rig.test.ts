/**
 * The assistant on the rig (docs/specs/15-assistant-and-rig.md, section 4): the tools that see the folder, the
 * script, the rig and the monitor; the one thing it may send ("are you there?") and every way that is refused;
 * devices and files on a proposal; and each of the built-in helper's turns, end to end, in a real show folder.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createAssistant, demoProvider } from '../core/assistant/assistant';
import { TOOLS, SYSTEM, reference, lookup, outline, execute, describeCall, privateAddress, MAX_ASKS, LONG_SHOW } from '../core/assistant/tools';
import * as mcp from '../core/assistant/mcp';
import * as rigDevices from '../core/rig/devices';
import * as show from '../core/show/show';
import { ShowDocument } from '../core/show/document';
import { sound } from '../test/users/materials';
import { build } from './helpers';

/** A show folder with a few sounds, a script with marks, and notes. */
function folderShow(files = ['01 walk-in', '02 Overture FINAL', 'Sc2_door', 'Sc2_thunder v3', 'rain loop']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-rig-'));
  files.forEach((n, i) => sound(path.join(dir, `${n}.wav`), 0.2, i));
  fs.writeFileSync(path.join(dir, 'script.md'), ['# Act one', '', 'The house lights fade.', '<!-- @cue 1 Walk-in out -->', '', 'SCENE 2', '…and the sky answered.', '@cue 12 Thunder', 'She opens the door.', '@cue 13'].join('\n'));
  fs.writeFileSync(path.join(dir, '.DS_Store'), 'x');
  return ShowDocument.open(dir);
}
/** The host's rig service, faked: what it would say, and a record of what was asked of it. */
function fakeRig(over = {}) {
  const asked = [];
  const rig = {
    asked, mode: 'edit',
    status: () => ({
      summary: { ready: 1, total: 3, look: 1, problems: 1, unknown: 0, at: Date.now(), text: '1 of 3 ready · 1 to look at · 1 problem' },
      items: [
        { id: 'show.saved', group: 'show', label: 'The show is saved', state: 'look', text: '3 unsaved changes', fix: 'Save (⌘S).', needed: true, actions: [] },
        { id: 'show.backups', group: 'show', label: 'Backups are on', state: 'ready', text: 'every 5 minutes', fix: '', needed: true, actions: [] },
        { id: 'device.lantern', group: 'equipment', label: 'Lantern', state: 'problem', text: 'not answering (last heard 2 min ago)', fix: 'Check its power, and that it is on the show’s Wi-Fi.', needed: true, actions: [] },
      ],
      devices: { lantern: { state: 'problem', text: 'not answering', heardAt: Date.now() - 120000, ageMs: 120000, reports: [{ key: 'battery', label: 'Battery', value: 18, unit: '%', warn: true }], lastIn: '/ec/here lantern light 1.0 own 60 -52 18' } },
      found: null,
      computer: { audio: { device: 'Interface 8', outputs: 8, devices: ['Built-in Output'] }, displays: ['Built-in (1512×982)', 'Projector (1920×1080)'], midi: { inputs: [], outputs: ['IAC Bus 1'] }, interfaces: [{ name: 'en0', address: '10.0.0.5' }] },
    }),
    monitor: () => [
      { n: 1, at: Date.now() - 5000, dir: 'out', who: 'Lantern 10.0.0.42:53100', patch: 'lantern', text: '/ec/identify', ok: true, label: 'cue 12' },
      { n: 2, at: Date.now() - 4000, dir: 'out', who: 'Desk 10.0.0.20:8000', patch: 'desk', text: '/eos/cue/1/12/fire', ok: false, why: 'held back for rehearsal', held: true, label: '' },
      { n: 3, at: Date.now() - 3000, dir: 'in', who: '10.0.0.57:53100', patch: null, text: '/fog/ready 1', via: 'input', unused: true },
    ],
    senders: () => [{ address: '10.0.0.57', port: 53100, count: 14, messages: [{ address: '/fog/ready', count: 14, every: 2.04 }], lastAt: Date.now() }],
    ask: async (target) => { asked.push(target); return { ok: true, held: false, answered: true, ms: 4, text: '/ec/here lantern light 1.0 steady 532 -52 87', why: '' }; },
    scan: async () => { asked.push('scan'); return [{ name: 'lantern', kind: 'light', fw: '1.0', host: '10.0.0.42', port: 53100, known: null, moved: false }]; },
    locked: () => rig.mode === 'show',
    ...over,
  };
  return rig;
}
const LANTERN = { op: 'device.add', device: { name: 'Lantern', model: 'ec-prop-light', host: '10.0.0.42' } };
const session = (d, rig = null) => { const ctx = { document: d, draft: null, rig, files: new Map() }; return { ctx, run: (name, input) => execute(name, input, ctx) }; };
const helper = (d, rig = null) => { const a = createAssistant({ provider: demoProvider() }); return { a, ask: async (text, engine) => { const r = await a.ask(text, { document: d, rig, engine }); return { r, said: a.status().transcript.at(-1).text, steps: a.status().transcript.at(-1).steps }; } }; };

test('the tool table: the eight new tools, each with a closed schema, a line for the person watching, and no way to play, save or command', () => {
  for (const name of ['list_folder', 'read_file', 'rig_status', 'read_monitor', 'ask_device', 'find_devices', 'make_prop_files', 'hand_off']) {
    const t = TOOLS.find((x) => x.name === name);
    assert.ok(t, name);
    assert.equal(t.input_schema.additionalProperties, false);
    assert.notEqual(describeCall(name, { device: 'lantern', path: 'script.md' }), name, `${name} is described`);
  }
  assert.equal(describeCall('ask_device', { device: 'lantern' }), 'asking lantern if it is there');
  assert.equal(describeCall('read_file', { path: 'script.md' }), 'reading script.md');
  for (const t of TOOLS) assert.doesNotMatch(t.name, /try|send|command|flash|write_file|run/);
  // no schema takes a password, and the firmware tool's settings are the kit's own
  assert.doesNotMatch(JSON.stringify(TOOLS.map((t) => Object.keys(t.input_schema.properties))), /pass/i);
  assert.deepEqual(TOOLS.find((t) => t.name === 'make_prop_files').input_schema.required, ['device', 'sketch']);
  // the instructions say what it may send and what it never does
  for (const words of ['You can never send a device a command', 'Never invent an address, a port or a message', 'never ask for a Wi-Fi password', 'offer hand_off', 'say in your reply exactly what you guessed']) assert.ok(SYSTEM.includes(words), words);
});

test('the reference’s DEVICES and MODELS are the device tables: in brief every model, in full through read_reference, and a field added to them is in it', () => {
  const ref = reference();
  const devs = lookup('devices').text;
  for (const f of [...rigDevices.FIELDS, ...rigDevices.COMMAND_FIELDS, ...rigDevices.ALIVE_FIELDS, ...rigDevices.REPORT_FIELDS, ...rigDevices.PARAM_FIELDS]) assert.ok(new RegExp(`^    ${f.key} \\(${f.kind}`, 'm').test(devs), f.key);
  // the brief: the operations, the Device cue, a patch made a device, and a line a model with its test message
  for (const words of ['DEVICES (the show', '"model": "etc-eos"', 'etc-eos — ETC Eos family', '(desk, udp 8000, /eos/ping)', 'ec-prop-light — Prop light', '"type": "device"', 'Making a network patch a device', 'settings.rig.script', 'settings.rig.checks']) assert.ok(ref.includes(words), words);
  // in full: each model's commands and notes
  for (const words of ['MODELS (what a device is started from', 'fire — Fire cue: /eos/cue/{list}/{cue}/fire', 'test message /eos/ping, which it answers', 'level — Level: /ec/level {level}   (fades level)']) assert.ok(lookup('models').text.includes(words), words);
  assert.match(lookup('etc-eos').text, /^etc-eos — ETC Eos family[\s\S]*Setup ▸ System ▸ Show Control/);
  assert.ok(!ref.includes('settings.rig.devices=[') && !lookup('settings').text.includes('settings.rig.devices=['), 'the device list is not offered as a setting to set');
  rigDevices.FIELDS.push({ key: 'madeUpToday', kind: 'text', label: 'Made up', help: 'A device field that did not exist this morning.' });
  try { assert.match(lookup('devices').text, /madeUpToday \(text\) — A device field that did not exist this morning\./); } finally { rigDevices.FIELDS.pop(); }
});

test('the outline: one line a device and three lines more; a long show stays short', () => {
  const d = folderShow();
  d.edit([LANTERN, { op: 'device.add', device: { name: 'Lighting desk', model: 'etc-eos', host: '10.0.0.20' } }, { op: 'show.set', path: 'settings.rig.script', value: 'script.md' }, { op: 'show.set', path: 'settings.rig.checks', value: [{ id: 'k1', text: 'Haze fluid' }] }]);
  const text = outline(d.doc, { showDir: d.showDir, rig: fakeRig() });
  assert.match(text, /^Devices: lantern = Lantern \(prop, ec-prop-light, osc udp 10\.0\.0\.42:53100; commands: look\(n\), color\(r, g, b\), level\(level, fades\), effect\(name\), on, off, identify; asked every 2 s\)$/m);
  assert.match(text, /^ {9}lighting_desk = Lighting desk \(desk, etc-eos, osc udp 10\.0\.0\.20:8000; commands: fire\(list, cue\)/m);
  assert.match(text, /^Rig: script script\.md \(10 lines, 3 marks\) · checklist 1 line · folder: 5 sounds, 1 text file; 5 files no cue uses$/m);
  assert.match(text, /^Rig now: 1 of 3 ready · 1 to look at · 1 problem · problem: Lantern \(not answering \(last heard 2 min ago\)\) · to look at: The show is saved \(3 unsaved changes\)$/m);
  assert.doesNotMatch(text, /walk-in\.wav/, 'file names are list_folder’s, not the outline’s');
  assert.doesNotMatch(text, /rig\.devices=/);
  // with no app there is no "Rig now"; a plain untitled show says so in two short lines
  const plain = outline(show.newShow('T'));
  assert.match(plain, /^Devices: none$/m);
  assert.match(plain, /^Rig: not saved to a folder yet$/m);
  assert.doesNotMatch(plain, /Rig now/);
  // 300 cues and 3 devices: the short outline, plus three device lines
  const ops = Array.from({ length: LONG_SHOW + 50 }, (_x, i) => ({ op: 'cue.add', cue: { type: 'memo', number: String(i + 1) } }));
  const long = build([...ops, LANTERN, { op: 'device.add', device: { name: 'B', model: 'ec-prop-light' } }, { op: 'device.add', device: { name: 'C', model: 'x32', host: '10.0.0.9' } }]).doc;
  const lines = outline(long).split('\n');
  assert.equal(lines.filter((l) => /^(Devices: | {9})\w+ = /.test(l)).length, 3);
  assert.ok(lines.some((l) => l.startsWith('This is a long show')));
  assert.ok(lines.length < LONG_SHOW + 50 + 14);
  // many devices: names only
  const many = build(Array.from({ length: 13 }, (_x, i) => ({ op: 'device.add', device: { name: `Lamp ${i + 1}`, model: 'ec-prop-light' } }))).doc;
  assert.match(outline(many), /^Devices \(13; read_show \{"device": "<id>"\} for one in full\): lamp_1 = Lamp 1; /m);
  assert.doesNotMatch(outline(many), /commands:/);
});

test('list_folder and read_file: the folder as a person reads it, a script with its marks, and nothing outside it', () => {
  const d = folderShow();
  const s = session(d);
  const list = s.run('list_folder', {}).content;
  assert.match(list, /^01 walk-in\.wav {2}sound {2}\d+ KB {2}00:00\.2 {2}not used by any cue$/m);
  assert.match(list, /^script\.md {2}text {2}\d+ B$/m);
  assert.doesNotMatch(list, /DS_Store|show\.json/);
  assert.match(list, /6 files: 5 sounds, 0 videos, 1 text; 5 sound or video files no cue uses\./);
  assert.match(s.run('list_folder', { path: 'nowhere' }).content, /Nothing in nowhere\//);
  assert.match(session(new ShowDocument()).run('list_folder', {}).content, /^This show is not in a folder yet\./);
  // reading: line numbers, paging, and a mark noted beside its line with whether a cue has its number
  d.edit([{ op: 'show.set', path: 'settings.rig.script', value: 'script.md' }, { op: 'cue.add', cue: { type: 'memo', number: '12' } }]);
  const read = s.run('read_file', { path: 'script.md' }).content;
  assert.match(read, /^script\.md: lines 1–10 of 10 · 3 marks in the whole file, 2 with no cue$/m);
  assert.match(read, /^ {3}8 {2}@cue 12 Thunder {6}← mark: cue 12 “Thunder”, called on “…and the sky answered\.” \(has a cue\)$/m);
  assert.match(read, /← mark: cue 1 “Walk-in out”, called on “The house lights fade\.” \(NO CUE has this number\)/);
  assert.match(s.run('list_folder', {}).content, /script\.md .*\(the show’s script\)/);
  const part = s.run('read_file', { path: 'script.md', from: 7, lines: 2 }).content;
  assert.match(part, /lines 7–8 of 10 \(read on with \{"from": 9\}\)/);
  assert.equal(part.split('\n').length, 3);
  // check_show says which marks have no cue
  assert.match(s.run('check_show', {}).content, /warning: the script’s mark @cue 1 Walk-in out \(script\.md line 4\) has no cue numbered 1/);
  for (const [p, why] of [['../secret.txt', /outside the show folder/], ['show.json', /the show itself/], ['01 walk-in.wav', /not a text file/], ['nope.md', /no file nope\.md/]]) {
    const r = s.run('read_file', { path: p });
    assert.equal(r.is_error, true, p);
    assert.match(r.content, why);
  }
});

test('rig_status and read_monitor: worst first with what to do, each device’s reports, this computer, and who else is sending', () => {
  const d = folderShow(); d.edit([LANTERN]);
  const s = session(d, fakeRig());
  const rig = s.run('rig_status', {}).content.split('\n');
  assert.match(rig[0], /^The rig: 1 of 3 ready · 1 to look at · 1 problem \(checked \d\d:\d\d:\d\d\)$/);
  assert.equal(rig[1], '  problem: Lantern: not answering (last heard 2 min ago) → Check its power, and that it is on the show’s Wi-Fi.');
  assert.equal(rig[2], '  to look at: The show is saved: 3 unsaved changes → Save (⌘S).');
  assert.equal(rig[3], '  ready: Backups are on: every 5 minutes');
  const all = rig.join('\n');
  assert.match(all, /lantern = Lantern: problem, not answering; last heard 2 min ago; Battery 18 % \(LOW: look at it\); it last said: \/ec\/here lantern/);
  assert.match(all, /Sound output: Interface 8 \(8 outputs\)\. Others: Built-in Output/);
  assert.match(all, /Displays: Built-in \(1512×982\); Projector \(1920×1080\)/);
  assert.match(all, /MIDI in: none · MIDI out: IAC Bus 1/);
  assert.match(all, /Networks: en0 10\.0\.0\.5/);
  const mon = s.run('read_monitor', {}).content;
  assert.match(mon, /^\d\d:\d\d:\d\d {2}→ {2}Lantern 10\.0\.0\.42:53100 {2}\/ec\/identify {2}\(cue 12\)$/m);
  assert.match(mon, /→ {2}Desk 10\.0\.0\.20:8000 {2}\/eos\/cue\/1\/12\/fire {2}\(NOT SENT: held back for rehearsal\)/);
  assert.match(mon, /← {2}10\.0\.0\.57:53100 {2}\/fog\/ready 1 {2}\(nothing here acted on it\)/);
  assert.match(mon, /Unknown senders[^\n]*\n {2}10\.0\.0\.57:53100 sent \/fog\/ready 14 times, about every 2\.0 s/);
  assert.equal(s.run('read_monitor', { from: 'lantern' }).content.split('\n').filter((l) => /→|←/.test(l)).length, 1);
  // a show folder alone: what a folder can answer, and a plain statement of what needs the app
  const alone = session(d);
  assert.match(alone.run('rig_status', {}).content, /lantern = Lantern: whether it is answering needs the app[\s\S]*with no app running/);
  assert.match(alone.run('read_monitor', {}).content, /show folder alone/);
});

test('ask_device: a device in the show is asked; every other way is refused before anything is sent', async () => {
  const d = folderShow(); d.edit([LANTERN, { op: 'device.add', device: { name: 'Sampler', via: 'midi', commands: [] } }, { op: 'device.add', device: { name: 'Bare', model: 'ec-prop-light' } }]);
  const rig = fakeRig();
  const s = session(d, rig);
  assert.equal((await s.run('ask_device', { device: 'lantern' })).content, 'Lantern answered in 4 ms: /ec/here lantern light 1.0 steady 532 -52 87');
  assert.deepEqual(rig.asked, ['lantern']);
  // an address the person gave, with a model's own test message: allowed on a private network only
  assert.match((await s.run('ask_device', { host: '10.0.0.20', port: 8000, probe: 'etc-eos' })).content, /^10\.0\.0\.20:8000 answered in 4 ms/);
  assert.deepEqual(rig.asked[1], { host: '10.0.0.20', port: 8000, probe: 'etc-eos' });
  assert.deepEqual((await s.run('ask_device', { host: 'localhost', probe: 'ec-prop-light' }), rig.asked[2]), { host: '127.0.0.1', port: 53100, probe: 'ec-prop-light' }, 'the model’s usual port');
  const sent = rig.asked.length;
  const refused = async (input, why) => { const r = await s.run('ask_device', input); assert.equal(r.is_error, true, JSON.stringify(input)); assert.match(r.content, why); };
  await refused({ host: '8.8.8.8', port: 8000, probe: 'etc-eos' }, /not an address on this computer or a private network/);
  await refused({ host: 'desk.example.com', port: 8000, probe: 'etc-eos' }, /written as numbers/);
  await refused({ host: '172.32.0.1', port: 8000, probe: 'etc-eos' }, /private network/);
  await refused({ host: '10.0.0.20', port: 8000, probe: '/eos/newcmd "Chan 1 Full#"' }, /not a model with a test message[\s\S]*You cannot send a message of your own/);
  await refused({ host: '10.0.0.20', port: 8000, probe: 'grandma3' }, /not a model with a test message/);
  await refused({ device: 'nobody' }, /No device with the id nobody/);
  await refused({ device: 'sampler' }, /has no “are you there\?” message/);
  await refused({ device: 'bare' }, /no address yet/);
  await refused({}, /takes \{"device"/);
  // a device only in the draft: the person has not accepted it
  s.run('edit_show', { ops: [{ op: 'device.add', device: { name: 'Draft lamp', model: 'ec-prop-light', host: '10.0.0.99' } }] });
  await refused({ device: 'draft_lamp' }, /only in your draft: the person has not accepted it/);
  assert.equal(rig.asked.length, sent, 'none of the refusals sent anything');
  // Show mode; a show folder with no app
  rig.mode = 'show';
  await refused({ device: 'lantern' }, /^Show mode: an assistant sends nothing to the equipment\.$/);
  assert.match((await s.run('find_devices', {})).content, /^Show mode/);
  rig.mode = 'edit';
  assert.match((await session(d).run('ask_device', { device: 'lantern' })).content, /needs the Endless Cues app running/);
  assert.equal(rig.asked.length, sent);
  // the answers that are not "it answered"
  const quiet = session(d, fakeRig({ ask: async () => ({ ok: true, answered: false, held: false }) }));
  assert.equal((await quiet.run('ask_device', { device: 'lantern' })).content, 'No answer from Lantern in 1.5 s.');
  const held = session(d, fakeRig({ ask: async () => ({ ok: false, held: true, why: 'OSC out is switched off for rehearsal' }) }));
  assert.equal((await held.run('ask_device', { device: 'lantern' })).content, 'Held back: OSC out is switched off for rehearsal. Nothing was sent.');
});

test('at most thirty asks a turn: the thirty-first is refused and nothing more is sent', async () => {
  const d = folderShow(); d.edit([LANTERN]);
  const rig = fakeRig();
  const s = session(d, rig);
  for (let i = 0; i < MAX_ASKS; i++) assert.ok(!(await s.run('ask_device', { device: 'lantern' })).is_error);
  const over = await s.run('ask_device', { device: 'lantern' });
  assert.equal(over.is_error, true);
  assert.match(over.content, /30 asks already/);
  assert.match((await s.run('find_devices', {})).content, /30 asks already/);
  assert.equal(rig.asked.length, MAX_ASKS);
  assert.equal(privateAddress('192.168.1.4'), '192.168.1.4');
  assert.equal(privateAddress('169.254.3.3'), '169.254.3.3');
  assert.equal(privateAddress('192.169.1.4'), null);
  assert.equal(privateAddress('10.0.0.300'), null);
});

test('a device made through edit_show and proposed: the answer names it, the review has its line, and a Device cue rides with it', () => {
  const d = folderShow();
  const s = session(d);
  const made = s.run('edit_show', { ops: [{ op: 'device.add', device: { name: 'Lighting desk', model: 'etc-eos', host: '127.0.0.1' } }, { op: 'cue.add', cue: { type: 'device', number: '12', device: 'lighting_desk', command: 'fire', args: { cue: '12' } } }] }).content;
  assert.match(made, /Devices: added lighting_desk\. \(lighting_desk: desk · 127\.0\.0\.1:8000 · 7 commands · asked every 2 s; commands fire, go, stop, macro, sub, chan, cmd\)/);
  assert.match(made, /#12 Device: Lighting desk ▸ Fire cue \(1, 12\)/);
  assert.match(s.run('read_show', { device: 'Lighting desk' }).content, /"template": "\/eos\/cue\/\{list\}\/\{cue\}\/fire"/);
  assert.match(s.run('read_show', { device: 'nope' }).content, /No device nope\. The show has: lighting_desk \(Lighting desk\)/);
  assert.match(s.run('simulate', { from: '#12' }).content, /\/eos\/cue\/1\/12\/fire/);
  const r = s.run('propose_changes', { summary: 'The desk, and cue 12 fires its cue 12' });
  assert.match(r.content, /1 added[\s\S]*1 device \(added Lighting desk\)/);
  const dev = d.proposal.changes.find((c) => c.kind === 'device-added');
  assert.equal(dev.text, 'desk · 127.0.0.1:8000 · 7 commands · asked every 2 s');
  // a command the device does not have is refused or reported, never staged silently
  const bad = s.run('edit_show', { ops: [{ op: 'cue.add', cue: { type: 'device', device: 'lighting_desk', command: 'blink' } }] }).content;
  assert.match(bad, /no command “blink”/);
  // a model's check: a device whose message does not fit is refused whole
  const wrong = s.run('edit_show', { ops: [{ op: 'device.add', device: { name: 'Fog', host: '10.0.0.60', port: 9000, commands: [{ id: 'burst', label: 'Burst', template: '/fog/burst {secs}' }] } }] });
  assert.equal(wrong.is_error, true);
  assert.match(wrong.content, /\{secs\}/);
});

test('firmware and the hand-over: files staged by the app’s generators, carried by the proposal, written on accept; secrets.h is the person’s', () => {
  const d = folderShow();
  const s = session(d);
  // an untitled show has no folder to write into; a device must exist
  assert.match(session(new ShowDocument()).run('make_prop_files', { device: 'lantern', sketch: 'light' }).content, /^Save the show to a folder first/);
  assert.match(session(new ShowDocument()).run('hand_off', { why: 'x' }).content, /^Save the show to a folder first/);
  assert.match(s.run('make_prop_files', { device: 'lantern', sketch: 'light' }).content, /No device lantern in the show or your draft: add it first/);
  s.run('edit_show', { ops: [LANTERN] });
  assert.match(s.run('make_prop_files', { device: 'lantern', sketch: 'light', pin: 12 }).content, /^Refused, nothing applied\. pin 12 cannot be used/);
  assert.equal(s.ctx.files.size, 0);
  const staged = s.run('make_prop_files', { device: 'lantern', sketch: 'light', pin: 13, count: 12, ssid: 'Stage' }).content;
  assert.match(staged, /^Staged 6 files for Lantern \(a light: 12 LEDs, GRB, data on GPIO 13; board ESP32/);
  assert.match(staged, /props\/lantern\/lantern\.ino[\s\S]*call propose_changes now[\s\S]*secrets\.h[\s\S]*ESP32 Dev Module[\s\S]*has not yet been run on a board/);
  assert.equal(d.proposal, null, 'staging is not proposing');
  const p = s.run('propose_changes', { summary: 'Lantern and its firmware' });
  assert.match(p.content, /1 device \(added Lantern\), 6 files for the show folder \(props\/lantern\/lantern\.ino, [^)]*\), written when they accept/);
  assert.equal(d.proposal.counts.files, 6);
  assert.ok(!fs.existsSync(path.join(d.showDir, 'props')), 'nothing is written until a person accepts');
  d.accept(d.proposal.id);
  assert.match(fs.readFileSync(path.join(d.showDir, 'props/lantern/config.h'), 'utf8'), /#define LED_COUNT 12/);
  assert.equal(rigDevices.find(d.doc, 'lantern').host, '10.0.0.42');
  // the person types their password; asking for the firmware again never touches it
  const secrets = path.join(d.showDir, 'props/lantern/secrets.h');
  fs.writeFileSync(secrets, '#define WIFI_SSID "Stage"\n#define WIFI_PASS "their password"\n');
  const again = session(d);
  const second = again.run('make_prop_files', { device: 'lantern', sketch: 'light', count: 60 }).content;
  assert.match(second, /^Staged 5 files[\s\S]*props\/lantern\/secrets\.h is already there and is left as it is/);
  assert.ok(![...again.ctx.files.keys()].some((k) => k.endsWith('secrets.h')));
  // a proposal of files alone, with the hand-over beside it
  assert.match(again.run('hand_off', { why: 'It must speak HTTP to a projector.' }).content, /^Staged the guide for a coding agent: AGENTS\.md[\s\S]*cd "[^"]+"\n {2}claude/);
  const alone = again.run('propose_changes', { summary: 'More LEDs, and the hand-over' });
  assert.match(alone.content, /0 added, 0 changed[\s\S]*7 files for the show folder/);
  assert.deepEqual(d.proposal.changes, []);
  assert.equal(d.proposal.files.find((f) => f.path === 'props/lantern/config.h').replaces, true);
  d.accept(d.proposal.id);
  assert.match(fs.readFileSync(secrets, 'utf8'), /their password/);
  assert.match(fs.readFileSync(path.join(d.showDir, 'AGENTS.md'), 'utf8'), /\*\*Lantern\*\* \(`lantern`\)/);
  assert.equal(fs.readFileSync(path.join(d.showDir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.match(session(d).run('propose_changes', { summary: 'x' }).content, /nothing to propose/);
});

test('the built-in helper: cues from the folder, through the real tools, saying what it guessed', async () => {
  const d = folderShow();
  const h = helper(d);
  const { said, steps } = await h.ask('Make cues from the 5 sounds in this folder.');
  assert.deepEqual(steps, ['looking at the folder', 'handing over the change']);
  assert.match(said, /^5 cues in file-name order, numbered 1 to 5, named after their files/);
  assert.match(said, /Scene 2[\s\S]*“Rain loop” is called a loop\. I did not make it loop[\s\S]*I did not read script\.md\.[\s\S]*Nothing else is set/);
  assert.equal(d.proposal.counts.added, 6);
  d.accept(d.proposal.id);
  assert.deepEqual(d.doc.lists[0].cues.map((c) => [c.number || '', c.name]), [['1', 'Walk-in'], ['2', 'Overture'], ['3', 'Rain loop'], ['', 'Scene 2'], ['4', 'Door'], ['5', 'Thunder']]);
  assert.equal(d.doc.lists[0].cues[2].loop, undefined, 'a loop is said, never switched on');
  assert.deepEqual(show.problems(d.doc), []);
  // asked again: nothing left to add; an untitled show: where to begin
  assert.match((await h.ask('make cues from the sounds in this folder')).said, /no sounds in this folder that a cue does not already use/);
  assert.match((await helper(new ShowDocument()).ask('make cues from the sounds in this folder')).said, /not in a folder yet[\s\S]*Start from a Folder/);
  assert.match((await h.ask('How do I start from a folder of sounds?')).said, /File ▸ Start from a Folder…/);
});

test('the built-in helper: a device from a model named in words, a cue for its command, and what it will not guess', async () => {
  const d = folderShow();
  const h = helper(d);
  assert.match((await h.ask('add a lantern at 10.0.0.42')).said, /^Lantern, from the app’s model “Prop light \(the Endless Cues kit\)”: I took that from your words[\s\S]*7 commands[\s\S]*every 2 seconds/);
  assert.equal(d.proposal.changes[0].kind, 'device-added');
  d.accept(d.proposal.id);
  assert.deepEqual([rigDevices.find(d.doc, 'lantern').model, rigDevices.find(d.doc, 'lantern').host, rigDevices.find(d.doc, 'lantern').port], ['ec-prop-light', '10.0.0.42', 53100]);
  await h.ask('my lighting desk is an ETC Ion at 10.0.0.20'); d.accept(d.proposal.id);
  assert.deepEqual([rigDevices.find(d.doc, 'lighting_desk').model, rigDevices.find(d.doc, 'lighting_desk').name], ['etc-eos', 'Lighting desk']);
  // a thing it does not know: a plain device, no commands invented, and it says so
  assert.match((await h.ask('add a device called Fog at 10.0.0.60:9000')).said, /plain device at 10\.0\.0\.60:9000\. I do not know what it is, so it has no commands yet/);
  d.accept(d.proposal.id);
  assert.deepEqual(rigDevices.find(d.doc, 'fog').commands, []);
  // "the lighting desk" with no maker named is not guessed to be anybody's desk
  await h.ask('add the lighting desk at 10.0.0.21');
  assert.match(h.a.status().transcript.at(-1).text, /already has a device called Lighting desk/);
  assert.match((await h.ask('add a lantern at 10.0.0.43')).said, /already has a device called Lantern \(at 10\.0\.0\.42\)/);
  assert.match((await h.ask('add a device')).said, /What is it called\?/);
  // a cue for a command, after the cue the playhead is on
  d.edit([{ op: 'cue.add', ref: 'a', cue: { type: 'memo', number: '1' } }, { op: 'cue.add', cue: { type: 'memo', number: '2' } }]);
  const one = d.doc.lists[0].cues[0];
  const cue = await h.ask('Add a cue that sends Identify to Lantern.', { playhead: one.id, running: new Map(), durations: new Map() });
  assert.deepEqual(cue.steps, ['reading the device lantern', 'handing over the change']);
  assert.match(cue.said, /“Lantern ▸ Identify”, after cue 1\. GO on it sends \/ec\/identify\. I cannot send it myself/);
  d.accept(d.proposal.id);
  assert.deepEqual([d.doc.lists[0].cues[1].type, d.doc.lists[0].cues[1].device, d.doc.lists[0].cues[1].command], ['device', 'lantern', 'identify']);
  // (numbered as a cue added from the toolbar is: between 1 and 2 it is 1.5; at the end, one more than the highest)
  assert.equal(d.doc.lists[0].cues[1].number, '1.5');
  await h.ask('add a cue that sends effect pulse to lantern'); d.accept(d.proposal.id);
  assert.deepEqual(d.doc.lists[0].cues.at(-1).args, { name: 'pulse' });
  assert.equal(d.doc.lists[0].cues.at(-1).number, '3');
  assert.match((await h.ask('add a cue that sends strobe to Lantern')).said, /Lantern has no command “strobe”\. It has: Look, Colour, Level/);
  assert.match((await h.ask('add a cue that sends identify to the fridge')).said, /no device called “the fridge”\. It has: Lantern, Lighting desk, Fog/);
  assert.match((await h.ask('add a cue that sends effect strobe to lantern')).said, /That would not send/);
});

test('the built-in helper: props found, readiness, why a device is quiet, firmware, the hand-over, and its honest list', async () => {
  const d = folderShow();
  const rig = fakeRig();
  const h = helper(d, rig);
  const found = await h.ask('look for props');
  assert.deepEqual(found.steps, ['looking for props', 'handing over the change']);
  assert.match(found.said, /^One prop answered that the show does not have yet: lantern at 10\.0\.0\.42 \(a light, firmware 1\.0\)/);
  d.accept(d.proposal.id);
  assert.deepEqual([rigDevices.find(d.doc, 'lantern').name, rigDevices.find(d.doc, 'lantern').model], ['Lantern', 'ec-prop-light']);
  // found again, now known; and one that has moved is offered its new address
  rig.scan = async () => [{ name: 'lantern', kind: 'light', fw: '1.0', host: '10.0.0.57', port: 53100, known: 'lantern', moved: true }];
  assert.match((await h.ask('look for props')).said, /answered from a new address/);
  d.accept(d.proposal.id);
  assert.equal(rigDevices.find(d.doc, 'lantern').host, '10.0.0.57');
  rig.scan = async () => [];
  assert.match((await h.ask('look for props')).said, /^Nothing answered\. Props must be powered, on this network, and running the kit’s firmware\./);
  assert.equal(d.proposal, null);

  const ready = (await h.ask('Is everything ready?')).said.split('\n');
  assert.match(ready[0], /^1 of 3 ready · 1 to look at · 1 problem/);
  assert.equal(ready[1], '• problem: Lantern: not answering (last heard 2 min ago) → Check its power, and that it is on the show’s Wi-Fi.');
  assert.equal(ready[2], '• to look at: The show is saved: 3 unsaved changes → Save (⌘S).');
  assert.equal(ready.length, 3, 'what is fine is not listed');

  rig.ask = async () => ({ ok: true, answered: false });
  const why = await h.ask('Why is Lantern not answering?');
  assert.deepEqual(why.steps, ['asking lantern if it is there']);
  assert.match(why.said, /I asked Lantern at 10\.0\.0\.57:53100 just now and it did not answer[\s\S]*no power[\s\S]*2\.4 GHz/);

  const fw = await h.ask('Write firmware for Lantern.');
  assert.deepEqual(fw.steps, ['writing firmware for lantern', 'handing over the change']);
  assert.match(fw.said, /^Firmware for Lantern \(a light: 30 LEDs, GRB, data on GPIO 5[\s\S]*secrets\.h[\s\S]*has not yet been run on a board/);
  assert.equal(d.proposal.counts.files, 6);
  d.accept(d.proposal.id);
  const over = await h.ask('hand the show over');
  assert.match(over.said, /AGENTS\.md and CLAUDE\.md[\s\S]*cd "[^"]+"\n {2}claude/);
  assert.deepEqual(d.proposal.files.map((f) => f.path), ['AGENTS.md', 'CLAUDE.md']);
  d.reject();

  // a patch made a device: the same id, so cues still aim at it
  d.edit([{ op: 'show.set', path: 'settings.network.patches', value: [{ id: 'eos', name: 'Eos', host: '10.0.0.20', port: 8000, protocol: 'udp', device: 'etc-eos' }] }, { op: 'cue.add', cue: { type: 'network', number: '5', patch: 'eos', message: '/eos/key/go_0' } }]);
  await h.ask('Turn the patch “Eos” into a device.'); d.accept(d.proposal.id);
  assert.deepEqual([d.doc.settings.network.patches.length, rigDevices.find(d.doc, 'eos').model, show.findByNumber(d.doc, '5').patch], [0, 'etc-eos', 'eos']);
  assert.deepEqual(show.problems(d.doc).filter((p) => p.level === 'error'), []);
  d.edit([{ op: 'cue.add', cue: { type: 'memo', number: '5' } }, { op: 'cue.add', cue: { type: 'memo' } }]);
  await h.ask('Renumber Main in tens.'); d.accept(d.proposal.id);
  assert.deepEqual(d.doc.lists[0].cues.map((c) => c.number), ['10', '20', '30']);
  assert.match((await h.ask('Check the show for problems.')).said, /Nothing wrong|warning|error/);
  // anything else: what it is, what it does, where a model is
  const no = (await h.ask('every scene should end with a three second fade')).said;
  assert.match(no, /^The built-in helper has no model\. It knows only these:[\s\S]*Settings ▸ Assistant\.$/);
  assert.equal(d.proposal, null);
});

test('every ask the first screen offers to the helper is one the helper really does', async () => {
  const d = folderShow();
  const rig = fakeRig();
  const h = helper(d, rig);
  const first = () => h.a.status({ document: d, rig }).first;
  assert.equal(first().asks[0].text, 'Make cues from the 5 sounds in this folder.');
  for (let round = 0; round < 6; round++) {
    for (const ask of first().asks) {
      assert.equal(ask.offline, true, ask.label);
      const { said } = await h.ask(ask.text);
      assert.doesNotMatch(said, /^The built-in helper has no model/, `“${ask.text}” fell through to the list`);
      assert.doesNotMatch(said, /^I could not/, `“${ask.text}”: ${said}`);
      if (d.proposal) d.accept(d.proposal.id);
    }
    if (round === 0) { await h.ask('add a lantern at 10.0.0.42'); d.accept(d.proposal.id); }
  }
  assert.equal(first().state, 'devices');
  assert.ok(fs.existsSync(path.join(d.showDir, 'props/lantern/lantern.ino')));
});

test('status: the first screen, which agents are installed, and the helper’s name', () => {
  const d = folderShow();
  const off = createAssistant({ config: { provider: 'off' } }).status({ document: d });
  assert.equal(off.first.state, 'no-model');
  assert.equal(off.first.line, '5 sounds and 1 text file not in a cue yet.');
  assert.equal(typeof off.installed['claude-code'], 'boolean');
  assert.equal(off.first.setup.rows.at(-1).set, 'demo');
  assert.equal(createAssistant({ provider: demoProvider() }).status({ document: d }).label, 'Built-in helper');
  assert.equal(createAssistant({ config: { provider: 'off' } }).status().first, undefined, 'asked without a show, it says nothing of one');
});

test('a turn with a scripted model: the tools are awaited, a waiting proposal’s files carry into the next turn', async () => {
  const d = folderShow(); d.edit([LANTERN]);
  const rig = fakeRig();
  const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const replies = [
    { stop_reason: 'tool_use', content: [use('t1', 'ask_device', { device: 'lantern' }), use('t2', 'make_prop_files', { device: 'lantern', sketch: 'light' })] },
    { stop_reason: 'tool_use', content: [use('t3', 'propose_changes', { summary: 'Firmware for the lantern' })] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Firmware is staged.' }] },
    { stop_reason: 'tool_use', content: [use('t4', 'propose_changes', { summary: 'And a memo', ops: [{ op: 'cue.add', cue: { type: 'memo', name: 'Check the lantern' } }] })] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Added.' }] },
  ];
  const seen = [];
  const a = createAssistant({ provider: { name: 'scripted', async create(req) { seen.push(JSON.parse(JSON.stringify(req.messages))); return replies.shift(); } } });
  await a.ask('is the lantern there? then write its firmware', { document: d, rig });
  const results = seen[1].at(-1).content;
  assert.match(results[0].content, /^Lantern answered in 4 ms/, 'the answer was waited for, not a promise');
  assert.equal(d.proposal.counts.files, 6);
  assert.match(seen[0][0].content[0].text, /Rig now: 1 of 3 ready/, 'the outline sent with the question has the Rig as it is');
  await a.ask('and add a memo', { document: d, rig });
  assert.equal(d.proposal.counts.files, 6, 'the firmware is still on the proposal that replaced the first');
  assert.equal(d.proposal.counts.added, 1);
});

test('MCP on a show folder: every tool listed, files written at once, and the rig said to need the app', async () => {
  const d = folderShow(); d.edit([LANTERN]); d.save({ note: 'a lantern' });
  const backend = mcp.fileBackend(d.showDir);
  assert.match((await backend.call('list_folder', {})).content, /01 walk-in\.wav/);
  assert.match((await backend.call('ask_device', { device: 'lantern' })).content, /needs the Endless Cues app running/);
  await backend.call('hand_off', { why: 'x' });
  const done = await backend.call('propose_changes', { summary: 'The guide' });
  assert.match(done.content, /^Done: “The guide”\. Written into the show folder: AGENTS\.md, CLAUDE\.md\.$/);
  assert.ok(fs.existsSync(path.join(d.showDir, 'AGENTS.md')));
  assert.ok(!fs.existsSync(path.join(d.showDir, 'show.unsaved.json')), 'files alone leave no unsaved change behind');
  assert.match(mcp.INSTRUCTIONS, /^MODELS \(.*etc-eos — ETC Eos family/m);
});
