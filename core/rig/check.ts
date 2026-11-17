/**
 * The check: one pure function that says whether the show is ready
 * (docs/specs/15-assistant-and-rig.md, section 3.7). It is the Rig page.
 *
 *   items(doc, facts)   → [{ id, group, groupLabel, label, state, text, fix, needed, actions: [{ id, label, cmd? }] }]
 *   summary(items, at)  → { ready, total, look, problems, unknown, at, text }
 *   folderFacts(showDir, doc) → the facts a show folder alone can give (no running app): `ec check`, an agent with no app
 *
 * A row's label is an assertion, the thing that should be true ("Every file is found"), or for a device or a
 * patch its name alone, with its state in the text ("Lantern A" · "answering · 3 ms"); its state says whether it is:
 *
 *   ready     it is
 *   look      it will work, look at it (and anything wrong with a thing the show does not need)
 *   problem   the show is not whole without it
 *   unknown   it cannot be told from here: never counted as ready
 *
 * A row exists only when the show uses the thing, so an empty new show has three. `fix` says what to do with
 * your hands, and is empty when the row is ready. An action may carry `cmd`, the host command that does it.
 *
 * `facts` is what only the running app knows; every part of it may be missing, and a row whose fact is
 * missing is `unknown` (or, for `app: false`, a command line asking, is left out when no folder could answer it):
 *
 *   app        false: asked with no app running
 *   saved      { untitled, dirty, changes }
 *   broken     [{ id, why }]: cues that cannot run beyond what show.problems says (a missing file)
 *   files      { total, missing: [path] }
 *   audio      { device, ok, fallback, outputs, inputs: [label] | null }
 *   stage      { open, waiting, label }
 *   light      { error, held }
 *   network    the hub's status(): { input: { port, listening, error }, patches: { id: { state, text } } }
 *   liveness   { deviceId: core/rig/liveness.js state }
 *   midi       { outputs: [name], error }
 *   modules    [{ id, name, enabled, running, status: { ok, text } }]
 *   timecode   { arriving }
 *   overrides  [{ id, label, on }]
 *   script     { found, why, lines, marks, missing: [{ number, line }] }
 *   ticks      { checkId: true }
 *
 * Pure: no disk, no network (folderFacts is the one function here that reads the folder).
 */
import * as show from '../show/show';
import { STAGE_TYPES } from '../show/cue-types';
import * as rigDevices from './devices';
import { DEVICES as MODELS } from '../net/devices';

const GROUPS = { show: 'The show', sound: 'Sound', picture: 'Picture', lights: 'Lights', equipment: 'Equipment', connections: 'Connections', held: 'Held back', before: 'Before the show' };
const STATES = ['ready', 'look', 'problem', 'unknown'];

const CANNOT = 'cannot be asked: press Try';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listOf = (names, max = 4) => (names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`);
const and = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** What of the show's cues uses what: counted once, so each row can ask. */
function uses(doc) {
  const u = { cues: 0, types: new Set(), files: new Set(), devices: new Set(), patches: new Set(), noPatch: false, inputs: new Set(), mtc: false };
  show.walk(doc, (c) => {
    u.cues++; u.types.add(c.type);
    if (c.file) u.files.add(String(c.file));
    if (c.type === 'device' && c.device) u.devices.add(c.device);
    if (c.type === 'network') { if (c.patch) u.patches.add(c.patch); else u.noPatch = true; }
    if (c.type === 'mic') u.inputs.add(String(c.input || ''));
    if (c.type === 'timecode' && (c.output || 'mtc') === 'mtc') u.mtc = true;
  });
  return u;
}

/** The edit that makes a patch a device: the same id, so every cue that named the patch still does. null: its id cannot be a device's. */
function patchToDevice(doc, patch) {
  if (!rigDevices.ID.test(String(patch.id))) return null;       // (an older patch id with a capital or a dash)
  const device = { id: patch.id, name: patch.name, host: patch.host, port: patch.port, protocol: patch.protocol || 'udp' };
  for (const k of ['framing', 'listenPort', 'iface', 'destinations', 'notes']) if (patch[k] !== undefined && patch[k] !== '' && patch[k] !== null) device[k] = patch[k];
  if (patch.device && MODELS[patch.device] && patch.device !== 'generic') device.model = patch.device;
  return [{ op: 'device.add', device }, { op: 'show.set', path: 'settings.network.patches', value: doc.settings.network.patches.filter((p) => p.id !== patch.id) }];
}

function items(doc, facts = {}) {
  const out = [];
  const app = facts.app !== false;
  const s = doc.settings, u = uses(doc);
  const rig = s.rig || { devices: [], checks: [], script: '' };
  const row = (group, id, label, state, text = '', fix = '', more = {}) => out.push({ id, group, groupLabel: GROUPS[group], label, state, text, fix: state === 'ready' ? '' : fix, needed: true, actions: [], ...more });

  // ── the show ──
  const sv = facts.saved;
  const save = { actions: [{ id: 'save', label: 'Save', cmd: { op: 'save' } }] };
  if (!sv) row('show', 'show.saved', 'The show is saved', 'unknown', 'it cannot be told from here');
  else if (sv.untitled) row('show', 'show.saved', 'The show is saved', 'look', 'not in a folder yet', 'Save it to a folder (⌘S).', save);
  else if (sv.dirty) row('show', 'show.saved', 'The show is saved', 'look', sv.changes > 0 ? plural(sv.changes, 'unsaved change') : 'unsaved changes', app ? 'Save (⌘S).' : 'It has unsaved changes from the app: save or revert them there.', app ? save : {});
  else row('show', 'show.saved', 'The show is saved', 'ready');
  const mins = Number((s.backup || {}).minutes) || 0;
  if (mins > 0) row('show', 'show.backups', 'Backups are on', 'ready', `every ${plural(mins, 'minute')}`);
  else row('show', 'show.backups', 'Backups are on', 'look', 'off', 'Turn them on in Settings ▸ Show.');
  {
    const { byId } = show.index(doc);
    const why = new Map();
    for (const p of show.problems(doc)) if (p.level === 'error' && !why.has(p.id)) why.set(p.id, p.why);
    for (const p of facts.broken || []) if (p && byId.has(p.id) && !why.has(p.id)) why.set(p.id, p.why);
    // (named in the order they are in the list, which is the order they will be met in)
    const bad = new Map();
    show.walk(doc, (c) => { if (why.has(c.id)) bad.set(c.id, why.get(c.id)); });
    if (!bad.size) row('show', 'show.cues', 'Every cue can run', 'ready', plural(u.cues, 'cue'));
    else {
      const names = [...bad.keys()].map((id) => { const c = byId.get(id); return c.number || c.name || 'one with no number'; });
      const [first, why] = [...bad][0];
      row('show', 'show.cues', 'Every cue can run', 'problem', `${bad.size === 1 ? '1 cue is' : `${bad.size} cues are`} broken: ${listOf(names, 6)}.`, `${names[0]}: ${why}.`, { actions: [{ id: 'select', label: 'Show it', cue: first }] });
    }
  }
  if (rig.script) {
    const sc = facts.script;
    const label = 'Every script mark has a cue';
    if (!sc) row('show', 'show.script', label, 'unknown', `${rig.script} has not been read`);
    else if (!sc.found) row('show', 'show.script', label, 'look', `${rig.script} cannot be read`, sc.why || `Put ${rig.script} in the show folder, or name another script.`);
    else if ((sc.missing || []).length) row('show', 'show.script', label, 'look', `${and(sc.missing.slice(0, 6).map((m) => `${m.number} (line ${m.line})`))}${sc.missing.length > 6 ? ` and ${sc.missing.length - 6} more` : ''} ${sc.missing.length === 1 ? 'has' : 'have'} no cue.`, 'Add a cue with each number.');
    else row('show', 'show.script', label, 'ready', sc.marks ? plural(sc.marks, 'mark') : `no @cue marks in ${rig.script}`);
  }

  // ── sound ──
  const sounding = ['audio', 'mic', 'video'].some((t) => u.types.has(t));
  const a = facts.audio;
  if (sounding && (a || app)) {
    const name = (a && a.device) || 'this computer’s output';
    if (!a) row('sound', 'sound.output', 'Sound goes to the chosen output', 'unknown', 'it cannot be told from here');
    else if (a.fallback) row('sound', 'sound.output', `Sound goes to ${a.fallback}`, 'problem', 'away: on this computer’s default output', `Plug in ${a.fallback}, or choose another in Settings ▸ Audio.`);
    else if (a.ok === false) row('sound', 'sound.output', `Sound goes to ${name}`, 'problem', 'the output has failed', `Plug in ${name}, or choose another in Settings ▸ Audio.`);
    else row('sound', 'sound.output', `Sound goes to ${name}`, 'ready');
  }
  const far = s.audio.buses.filter((b) => Number(b.out) > 1);
  if (far.length && (a || app)) {
    const lost = a && Number(a.outputs) > 0 ? far.filter((b) => Number(b.out) + 1 > a.outputs) : [];
    if (!a || !(Number(a.outputs) > 0)) row('sound', 'sound.buses', 'Every bus has its outputs', 'unknown', 'it cannot be told from here');
    else if (lost.length) row('sound', 'sound.buses', 'Every bus has its outputs', 'problem', `${and(lost.map((b) => `${b.name} (outputs ${b.out}–${Number(b.out) + 1})`))} cannot be heard: this device has ${plural(a.outputs, 'output')}`, 'Choose a device with enough outputs in Settings ▸ Audio, or send the bus to outputs 1–2.');
    else row('sound', 'sound.buses', 'Every bus has its outputs', 'ready', plural(a.outputs, 'output'));
  }
  if (u.files.size) {
    const f = facts.files;
    if (!f) row('sound', 'sound.files', 'Every file is found', 'unknown', 'the files have not been looked for');
    else if ((f.missing || []).length) row('sound', 'sound.files', 'Every file is found', 'problem', `${f.missing.length === 1 ? '1 file is' : `${f.missing.length} files are`} missing: ${listOf(f.missing.map((p) => String(p).split(/[\\/]/).pop()))}`, 'Put them back, or press Find them… and choose their folder.', { actions: [{ id: 'relink', label: 'Find them…' }] });
    else row('sound', 'sound.files', 'Every file is found', 'ready', plural(f.total != null ? f.total : u.files.size, 'file'));
  }
  if (u.types.has('mic') && (a || app)) {
    const inputs = a && Array.isArray(a.inputs) ? a.inputs : null;
    const wanted = [...u.inputs].filter(Boolean);
    const away = inputs ? wanted.filter((w) => !inputs.includes(w)) : [];
    if (!inputs) row('sound', 'sound.mic', 'The microphone input is there', 'unknown', 'it cannot be told from here');
    else if (!inputs.length) row('sound', 'sound.mic', 'The microphone input is there', 'problem', 'this computer has no audio input', 'Plug in the microphone, or the interface it is on.');
    else if (away.length) row('sound', 'sound.mic', 'The microphone input is there', 'problem', `${and(away.map((w) => `“${w}”`))} ${away.length === 1 ? 'is' : 'are'} not connected`, 'Plug it in, or choose another input on the Mic cue.');
    else row('sound', 'sound.mic', 'The microphone input is there', 'ready', wanted.length ? and(wanted) : 'this computer’s default input');
  }

  // ── picture ──
  if (STAGE_TYPES.some((t) => u.types.has(t)) && (facts.stage || app)) {
    const st = facts.stage;
    if (!st) row('picture', 'picture.stage', 'The stage is on a display', 'unknown', 'it cannot be told from here');
    else if (st.waiting) row('picture', 'picture.stage', `The stage is on ${st.label || 'its display'}`, 'problem', 'its display is not connected', 'Plug the display in: the stage returns to it.');
    else if (!st.open) row('picture', 'picture.stage', 'The stage is on a display', 'look', 'the stage is not open', 'Open it from View ▸ Stage.', { actions: [{ id: 'stage-open', label: 'Open the stage', cmd: { op: 'stage-open' } }] });
    else row('picture', 'picture.stage', `The stage is on ${st.label || 'a window'}`, 'ready', '', '', { actions: [{ id: 'stage-pattern', label: 'Test pattern', cmd: { op: 'stage-pattern' } }] });
  }

  // ── lights ──
  if (s.light && s.light.on && (s.light.instruments || []).length && (facts.light || app)) {
    const l = facts.light;
    if (!l) row('lights', 'lights.dmx', 'DMX is going out', 'unknown', 'it cannot be told from here');
    else if (l.error) row('lights', 'lights.dmx', 'DMX is going out', 'problem', String(l.error), 'Check the lights’ network and Settings ▸ Integrations ▸ Light.');
    else if (l.held) row('lights', 'lights.dmx', 'DMX is going out', 'look', 'held back: nothing reaches the lights', 'Let DMX out go (Tools ▸ Hold Back).', { actions: [{ id: 'let-go-dmx', label: 'Let it go', cmd: { op: 'override', what: 'dmx', on: false } }] });
    else row('lights', 'lights.dmx', 'DMX is going out', 'ready');
  }

  // ── equipment: each device, each patch a cue uses, the input port, the MIDI output ──
  const live = facts.liveness || null;
  for (const d of rigDevices.list(doc)) {
    const how = (d.alive || {}).how || 'none';
    const net = rigDevices.isNetwork(d);
    // the name alone: the text says the state ("answering · 3 ms", "not answering", "cannot be asked", "no address yet")
    const label = d.name;
    const used = u.devices.has(d.id) || u.patches.has(d.id);
    const needed = d.needed !== false && used;
    const actions = [];
    if (how === 'ask') actions.push({ id: 'ask', label: 'Ask again', cmd: { op: 'device-ask', device: d.id } });
    const test = d.test && d.commands.find((c) => c.id === d.test);
    if (test) actions.push({ id: 'try', label: `Try: ${test.label}`, cmd: { op: 'device-try', device: d.id, command: test.id } });
    const more = { needed, actions, device: d.id };
    const id = `device.${d.id}`;
    if (net && (!d.host || !(Number(d.port) > 0))) { row('equipment', id, label, 'look', 'no address yet', 'Give it an address.', { ...more, actions: [] }); continue; }
    const l = live && live[d.id];
    if (!l) { row('equipment', id, label, 'unknown', how === 'ask' ? (app ? 'not asked yet' : 'not asked: ec check --ask asks it') : how === 'heartbeat' ? 'heard only while the app runs' : CANNOT, '', more); continue; }
    const fix = l.held ? 'Let OSC out go in Tools ▸ Hold Back: until then nothing is asked.'
      : how === 'ask' ? 'Check its power, and that it is on the show’s network.'
      : how === 'heartbeat' ? 'Check its power, and that it is on the show’s network.'
      : net ? 'Check that it is switched on, and its address.' : 'Connect a MIDI output (Settings ▸ Integrations ▸ Network).';
    // a fault on a thing the show does not need (no cue uses it, or it is marked so) is something to look at, never a problem
    let state = l.state === 'problem' && !needed ? 'look' : l.state;
    let text = how === 'none' && state === 'unknown' ? CANNOT : l.text || '';
    let why = fix;
    const warns = (l.reports || []).filter((r) => r.warn);
    if (state === 'ready' && warns.length) { state = 'look'; text = `${text} · ${warns.map((r) => `${r.label} ${r.value}${r.unit ? ` ${r.unit}` : ''}`).join(', ')}`; why = `${and(warns.map((r) => r.label))} out of range.`; }
    if (l.state === 'problem' && !needed) text = `${text} · ${used ? 'not needed' : 'no cue uses it'}`;
    row('equipment', id, label, STATES.includes(state) ? state : 'unknown', text, state === 'unknown' ? '' : why, more);
  }
  const net = facts.network || null;
  const patches = s.network.patches || [];
  for (const p of patches) {
    if (!p || !(u.patches.has(p.id) || (u.noPatch && patches.length === 1))) continue;
    const ops = patchToDevice(doc, p);
    const actions = ops ? [{ id: 'make-device', label: 'Make it a device', cmd: { op: 'edit', ops, label: `${p.name} made a device` } }] : [];
    const st = net && net.patches ? net.patches[p.id] : null;
    const id = `patch.${p.id}`;
    if (!st) row('equipment', id, p.name, 'unknown', 'cannot be asked', '', { actions, patch: p.id });
    else if (st.state === 'error') row('equipment', id, p.name, 'problem', st.text || 'it cannot be sent to', 'Check it is on, and its address in Settings ▸ Integrations ▸ Network.', { actions, patch: p.id });
    else if (st.state === 'answering') row('equipment', id, p.name, 'ready', 'answering', '', { actions, patch: p.id });
    else row('equipment', id, p.name, 'unknown', st.state === 'connecting' ? 'connecting…' : st.state === 'connected' ? 'connected, no answer yet' : st.state === 'sent' ? 'sent; cannot be asked if it arrived' : 'nothing sent yet', '', { actions, patch: p.id });
  }
  if (net && net.input && Number(net.input.port) > 0) {
    const port = net.input.port;
    if (net.input.error || net.input.tcpError) row('equipment', 'equipment.input', `Listening on port ${port}`, 'problem', net.input.error || net.input.tcpError, 'Another program has it: close that, or change the port in Settings ▸ Integrations ▸ Network.');
    else if (!net.input.listening) row('equipment', 'equipment.input', `Listening on port ${port}`, 'look', 'not listening yet', 'If it stays shut, change the port in Settings ▸ Integrations ▸ Network.');
    else row('equipment', 'equipment.input', `Listening on port ${port}`, 'ready');
  }
  const midiDevice = rigDevices.list(doc).some((d) => !rigDevices.isNetwork(d));
  if ((u.types.has('midi') || u.types.has('midifile') || u.mtc || midiDevice) && (facts.midi || app)) {
    const m = facts.midi, port = String((s.midi || {}).output || '');
    const label = `MIDI goes to ${port || 'every MIDI output'}`;
    if (!m) row('equipment', 'equipment.midi', label, 'unknown', 'it cannot be told from here');
    else if (!(m.outputs || []).length) row('equipment', 'equipment.midi', label, 'problem', m.error || 'no MIDI output on this computer', 'Connect the MIDI interface or the instrument.');
    else if (port && !m.outputs.includes(port)) row('equipment', 'equipment.midi', label, 'problem', `“${port}” is not connected`, 'Connect it, or choose another output in Settings ▸ Integrations ▸ Network.');
    else row('equipment', 'equipment.midi', label, 'ready', port ? '' : and(m.outputs.slice(0, 3)));
  }

  // ── connections: each module that is on, and timecode ──
  for (const m of facts.modules || []) {
    if (!m.enabled) continue;
    const id = `module.${m.id}`, label = `${m.name} is running`;
    if (!m.running) row('connections', id, label, 'look', 'switched on, not started', 'It starts with the app.');
    else if (m.status && m.status.ok === false) row('connections', id, label, 'problem', m.status.text || 'not working', 'See Settings ▸ Integrations ▸ Modules.');
    else row('connections', id, label, 'ready', (m.status && m.status.text) || '');
  }
  if (s.timecode && s.timecode.source !== 'off' && (facts.timecode || app)) {
    const t = facts.timecode;
    if (!t) row('connections', 'connections.timecode', 'Timecode is arriving', 'unknown', 'it cannot be told from here');
    else if (t.arriving) row('connections', 'connections.timecode', 'Timecode is arriving', 'ready', t.text || '');
    else row('connections', 'connections.timecode', 'Timecode is arriving', 'look', 'none has arrived yet', `Start the timecode at its source (${s.timecode.source === 'ltc' ? 'LTC on an audio input' : 'MTC on a MIDI input'}).`);
  }

  // ── held back ──
  const heldNow = (facts.overrides || []).filter((o) => o.on);
  if (heldNow.length) {
    row('held', 'held', 'Nothing is held back', 'look', `${and(heldNow.map((o) => o.label))} ${heldNow.length === 1 ? 'is' : 'are'} held back: nothing reaches ${heldNow.some((o) => o.id === 'osc' || o.id === 'midi') ? 'the equipment' : 'what it feeds'}.`, 'Let it go after the rehearsal, in Tools ▸ Hold Back.',
      { actions: heldNow.map((o) => ({ id: `let-go-${o.id}`, label: heldNow.length === 1 ? 'Let it go' : `Let ${o.label} go`, cmd: { op: 'override', what: o.id, on: false } })) });
  }

  // ── before the show: the operator's own lines, ticked per sitting (a command line has no sitting) ──
  if (app) for (const k of rig.checks || []) {
    const on = !!(facts.ticks && facts.ticks[k.id]);
    row('before', `check.${k.id}`, k.text, on ? 'ready' : 'look', '', '', { check: k.id, actions: [{ id: 'tick', label: on ? 'Untick' : 'Tick', cmd: { op: 'rig-tick', id: k.id, on: !on } }] });
  }
  return out;
}

/** The count of each state, and the one line that says it: "All 9 are ready", "6 of 9 ready · 2 to look at · 1 problem". */
function summary(list = [], at = Date.now()) {
  const n = (k) => list.filter((i) => i.state === k).length;
  const ready = n('ready'), look = n('look'), problems = n('problem'), unknown = n('unknown'), total = list.length;
  const text = !total ? '' : ready === total ? (total === 1 ? 'The 1 is ready' : `All ${total} are ready`)
    : [`${ready} of ${total} ready`, look ? `${look} to look at` : '', problems ? plural(problems, 'problem') : '', unknown ? `${unknown} cannot be told` : ''].filter(Boolean).join(' · ');
  return { ready, total, look, problems, unknown, at, text };
}

/**
 * What a show folder alone can say, with no app running: whether it has unsaved changes from the app, which
 * files are there, and the script's marks. Everything else (the output device, MIDI, the stage) needs the app.
 * `liveness` may be added by whoever has asked the devices (ec check --ask).
 */
function folderFacts(showDir, doc) {
  const fs = require('fs');
  const path = require('path');
  const facts = { app: false };
  if (!showDir) return { ...facts, saved: { untitled: true, dirty: false, changes: 0 } };
  facts.saved = { untitled: false, dirty: fs.existsSync(path.join(showDir, 'show.unsaved.json')), changes: 0 };
  const files = new Set();
  show.walk(doc, (c) => { if (c.file) files.add(String(c.file)); });
  facts.files = { total: files.size, missing: [...files].filter((f) => !fs.existsSync(path.isAbsolute(f) ? f : path.join(showDir, f))) };
  facts.broken = [];
  show.walk(doc, (c) => { if (c.file && facts.files.missing.includes(String(c.file))) facts.broken.push({ id: c.id, why: 'its file is missing' }); });
  const rig = doc.settings.rig || {};
  if (rig.script) {
    const script = require('./script');
    const r = script.read(showDir, rig.script);
    facts.script = { file: rig.script, found: r.ok, why: r.why, lines: r.lines, marks: r.marks.length, missing: r.ok ? script.compare(doc, r.marks).missing : [] };
  }
  return facts;
}

export { items, summary, folderFacts, patchToDevice, GROUPS, STATES };
