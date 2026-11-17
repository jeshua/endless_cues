#!/usr/bin/env node
/*!
 * The show file from the command line (no Electron, no window):
 *
 *   ec validate <show>            what would not work in a performance; exit code 1 if anything is broken
 *   ec outline  <show>            every cue, as the assistant is shown it
 *   ec diff     <show-a> <show-b> what changed, in an operator's terms (a show folder, a show.json, or a versions/<hash>.json)
 *   ec simulate <show> [from] [gos]   a dry run: what pressing GO does, second by second (no sound, no waiting)
 *   ec versions <show>            the saved versions
 *   ec apply    <show> <ops.json> [note]   apply edit operations (a JSON list, as the app and the assistant write them;
 *                                 "-" reads them from standard input): checked as every edit is, applied whole or
 *                                 not at all, saved as a new version. Not for a show that is open in the app.
 *   ec devices  <show>            the show's equipment: each device on a line, then its commands
 *   ec check    <show> [--ask]    is the show ready? The rows a folder can answer (saved, every cue can run, every file
 *                                 found, the script's marks, each device); with --ask, each device that can be asked is
 *                                 asked once from here. Exit code 1 if anything is a problem.
 *   ec try      <show> <device> <command> [key=value …]   compose one of a device's commands, print the message and send
 *                                 it once (a person at a terminal is a person: the assistant has no such door)
 *   ec fake-prop [--name n] [--kind light|switch] [--port 53100]   a stand-in prop that speaks the prop kit's protocol
 *                                 and prints what arrives, to see the Rig work with no hardware
 *   ec demo     [folder]          write the demo show
 *   ec sounds   [folder]          write a folder of six short made-up sounds (no show in it), to try Start from a Folder with
 *   ec import-qlab <file.qlab5> [folder]   read a QLab 5 workspace: say what comes across and what does not; with a
 *                                 folder, write it there as a show (its sound files copied into media/)
 *
 * A show is named by its folder (My.ecshow) or by a show.json inside one.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as show from '../core/show/show';
import { diffShows } from '../core/show/diff';
import * as versions from '../core/show/versions';
import { outline } from '../core/assistant/tools';

function load(p) {
  const file = fs.statSync(p).isDirectory() ? path.join(p, 'show.json') : p;
  const r = show.normalise(JSON.parse(fs.readFileSync(file, 'utf8')));
  return { ...r, dir: path.dirname(file) };
}
const label = (doc, id) => { const c = show.index(doc).byId.get(id); return c ? `${c.number ? c.number + ' ' : ''}${c.name || c.type}` : id; };

const MARK = { ready: '●', look: '◐', problem: '✕', unknown: '○' };

/** `ec check`: the Rig's rows as a folder can answer them, and, with --ask, each device asked once from here. */
async function checkShow(a, ask) {
  const check = require('../core/rig/check');
  const rigDevices = require('../core/rig/devices');
  const { doc, dir } = load(a);
  const facts = check.folderFacts(dir, doc);
  if (ask) {
    const { createHub } = require('../core/net/hub');
    const { createLiveness } = require('../core/rig/liveness');
    const hub = createHub();
    const live = createLiveness({ send: (d, text) => hub.send(d.id, text, { format: rigDevices.viaOf(d), quiet: true, ask: true }) });
    hub.onHeard((msg, _from, patch) => { if (patch) live.heard(patch.id, msg); });
    hub.configure({ devices: rigDevices.patchesOf(doc) });
    live.configure(rigDevices.list(doc));
    const asked = rigDevices.list(doc).filter((d) => (d.alive || {}).how === 'ask' && d.host && d.port);
    const awake = setInterval(() => {}, 1000);        // (the hub's sockets and the wait for an answer do not hold a process open by themselves)
    await Promise.all(asked.map((d) => live.ask(d.id)));
    clearInterval(awake);
    facts.liveness = Object.fromEntries(asked.map((d) => { const st = live.state(d.id); return [d.id, st.state === 'unknown' ? { ...st, state: 'problem', text: 'not answering' } : st]; }));
    live.close(); hub.close();
  }
  const items = check.items(doc, facts);
  const sum = check.summary(items);
  console.log(`${doc.title}: ${sum.text}`);
  const wide = Math.max(...items.map((i) => i.label.length));
  let group = '';
  for (const i of items) {
    if (i.group !== group) { group = i.group; console.log(`\n${i.groupLabel.toUpperCase()}`); }
    const reports = i.device && facts.liveness && facts.liveness[i.device] ? (facts.liveness[i.device].reports || []).filter((r) => r.key !== 'state').map((r) => `${r.label} ${r.value}${r.unit ? ` ${r.unit}` : ''}`).join(' · ') : '';
    console.log(`${MARK[i.state]} ${i.label.padEnd(wide)}  ${[i.text, reports].filter(Boolean).join(' · ')}`.trimEnd());
    if (i.fix) console.log(`    ${i.fix}`);
  }
  if (!ask && rigDevices.list(doc).some((d) => (d.alive || {}).how === 'ask')) console.log('\nThe devices were not asked: add --ask to ask each one from here.');
  console.log('\nWhat only the running app knows (the sound output, the stage, MIDI, modules) is on its Rig page.');
  return sum.problems ? 1 : 0;
}

/** `ec try`: one of a device's commands, composed, printed and sent once. */
async function tryCommand(a, deviceId, commandId, pairs) {
  const rigDevices = require('../core/rig/devices');
  const { doc } = load(a);
  const d = rigDevices.find(doc, deviceId) || rigDevices.list(doc).find((x) => x.name.toLowerCase() === String(deviceId || '').toLowerCase());
  if (!d) { console.error(`No device ${deviceId || ''} in this show (it has: ${rigDevices.list(doc).map((x) => x.id).join(', ') || 'none'}).`); return 1; }
  const args = {};
  for (const p of pairs) { const m = /^(\w+)=(.*)$/.exec(p); if (!m) { console.error(`${p} is not key=value`); return 2; } args[m[1]] = m[2]; }
  const r = rigDevices.compose(d, commandId, args);
  if (!r.ok) { console.error(r.why); return 1; }
  console.log(`${rigDevices.cueName(d, { command: commandId, args })}`);
  console.log(`  ${r.message}`);
  if (!rigDevices.isNetwork(d)) { console.error(`${d.name} is a MIDI device: its commands are sent by the app, which has the MIDI output.`); return 1; }
  if (!d.host || !d.port) { console.error(`${d.name} has no address yet.`); return 1; }
  const { createHub } = require('../core/net/hub');
  const hub = createHub();
  hub.configure({ devices: rigDevices.patchesOf(doc) });
  let answer = null;
  hub.onHeard((msg, _from, patch) => { if (patch && patch.id === d.id && !answer) answer = require('../core/net/osc').toText(msg); });
  if ((d.protocol || 'udp') === 'tcp') await new Promise((done) => setTimeout(done, 600));        // (a TCP device: time to connect)
  const e = hub.send(d.id, r.message, { format: rigDevices.viaOf(d), label: 'ec try' });
  await new Promise((done) => setTimeout(done, 400));
  hub.close();
  if (!e.ok) { console.error(`  not sent: ${e.why}`); return 1; }
  console.log(`  sent once to ${d.host}:${d.port}${answer ? `; it answered ${answer}` : ''}`);
  return 0;
}

function main([cmd, a, b, ...more]) {
  switch (cmd) {
    case 'validate': {
      const { doc, warnings, dir } = load(a);
      const problems = show.problems(doc);
      show.walk(doc, (c) => { if (c.type === 'audio' && c.file) { const f = path.isAbsolute(c.file) ? c.file : path.join(dir, c.file); if (!fs.existsSync(f)) problems.push({ id: c.id, level: 'error', why: `its file is missing (${c.file})` }); } });
      for (const w of warnings) console.log(`note     ${w}`);
      for (const p of problems) console.log(`${p.level === 'error' ? 'BROKEN ' : 'warning'}  ${label(doc, p.id)}: ${p.why}`);
      let n = 0; show.walk(doc, () => n++);
      const bad = problems.filter((p) => p.level === 'error').length;
      console.log(`${doc.title}: ${n} cues, ${bad} broken, ${problems.length - bad} warnings`);
      return bad ? 1 : 0;
    }
    case 'outline': { const r = load(a); console.log(outline(r.doc, { showDir: path.basename(a) === 'show.json' || fs.statSync(a).isDirectory() ? r.dir : null })); return 0; }
    case 'diff': {
      const changes = diffShows(load(a).doc, load(b).doc);
      if (!changes.length) console.log('no differences');
      for (const c of changes) {
        const sign = { added: '+', removed: '-', moved: '>', 'device-added': '+', 'device-removed': '-' }[c.kind] || '~';
        console.log(`${sign} ${c.kind.startsWith('device-') ? 'device ' : ''}${c.label || c.path}${c.text ? `  ${c.text}` : ''}${c.kind === 'moved' ? `  moved ${c.to}` : c.kind === 'setting' ? `  ${c.from} -> ${c.to}` : c.kind === 'added' || c.kind === 'removed' ? `  ${c.kind}` : ''}`);
        for (const f of c.fields || []) console.log(`    ${f.label}: ${f.from} -> ${f.to}`);
      }
      return 0;
    }
    case 'simulate': { const { simulate, describe } = require('../core/engine/dry-run'); const l = load(a); const { wavInfo } = require('../core/engine/waveform'); const durations = {};
      show.walk(l.doc, (c) => { if (c.type === 'audio' && c.file) { const i = wavInfo(path.isAbsolute(c.file) ? c.file : path.join(l.dir, c.file)); if (i) durations[c.file] = Math.round(i.seconds * 100) / 100; } });
      const r = simulate(l.doc, { from: b || null, gos: Number(process.argv[5]) || 1, durations }); console.log(describe(r)); return r.error ? 1 : 0; }
    case 'versions': { for (const v of versions.list(load(a).dir)) console.log(`${v.id.padEnd(5)} ${v.at.slice(0, 16).replace('T', ' ')}  ${String(v.author).padEnd(9)} ${v.note}`); return 0; }
    case 'apply': {
      const { ShowDocument } = require('../core/show/document');
      const dir = fs.statSync(a).isDirectory() ? a : path.dirname(a);
      if (fs.existsSync(ShowDocument.journalPath(dir))) { console.error('This show has unsaved changes from the app (is it open there?). Save or revert them first.'); return 1; }
      let ops;
      try { ops = JSON.parse(fs.readFileSync(b === '-' || !b ? 0 : b, 'utf8')); } catch (err) { console.error(`The operations could not be read: ${err.message}`); return 2; }
      const d = ShowDocument.open(dir);
      // (ops.js refuses what does not fit, with the operation's place in the list and what to send instead)
      try { d.edit(ops, { label: 'command line' }); } catch (err) { if (err.name !== 'OpError') throw err; console.error(`Refused, nothing applied. ${err.message}`); return 1; }
      const changes = d.unsaved();
      if (!changes.length) { console.log('Applied, but it changed nothing.'); return 0; }
      for (const c of changes) console.log(`${{ added: '+', removed: '-', moved: '>', 'device-added': '+', 'device-removed': '-' }[c.kind] || '~'} ${c.kind.startsWith('device-') ? 'device ' : ''}${c.label || c.path}${c.text ? `  ${c.text}` : ''}${(c.fields || []).map((f) => `  ${f.label}: ${f.from} -> ${f.to}`).join('')}`);
      const v = d.save({ note: process.argv[5] || '' });
      console.log(`Saved as ${v.id}: ${v.note}`);
      return 0;
    }
    case 'import-qlab': {
      const { importQlab } = require('../core/import/qlab');
      const file = path.resolve(a);
      const { doc, report } = importQlab(fs.readFileSync(file), { file });
      console.log(`${report.title} (QLab ${report.qlabVersion || '5'}): ${report.counts.cues} cues in ${report.counts.lists} list${report.counts.lists === 1 ? '' : 's'}`);
      for (const line of report.summary) console.log(`  ${line}`);
      if (!b) return 0;
      const dir = path.resolve(b);
      if (fs.existsSync(path.join(dir, 'show.json'))) { console.error(`There is already a show at ${dir}`); return 1; }
      fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
      // the sounds that can be found come into the show's folder; the rest keep the path QLab had
      const taken = new Map();
      show.walk(doc, (c) => {
        if (c.type !== 'audio' || !c.file || !fs.existsSync(c.file)) return;
        if (!taken.has(c.file)) {
          let name = path.basename(c.file);
          for (let k = 2; [...taken.values()].includes(`media/${name}`); k++) name = `${path.basename(c.file, path.extname(c.file))}-${k}${path.extname(c.file)}`;
          fs.copyFileSync(c.file, path.join(dir, 'media', name));
          taken.set(c.file, `media/${name}`);
        }
        c.file = taken.get(c.file);
      });
      fs.writeFileSync(path.join(dir, 'show.json'), show.stringify(doc));
      console.log(`Written to ${dir} (${taken.size} sound file${taken.size === 1 ? '' : 's'} copied)`);
      return 0;
    }
    case 'devices': {
      const rigDevices = require('../core/rig/devices');
      const list = rigDevices.list(load(a).doc);
      if (!list.length) console.log('This show has no devices. (A device is a piece of equipment the show talks to: the Rig page adds one, or the assistant does.)');
      for (const d of list) {
        console.log(`${d.id}  ${d.name}  ·  ${rigDevices.describe(d)}${d.resend ? `  ·  each command sent ${d.resend} times` : ''}${d.needed === false ? '  ·  the show goes on without it' : ''}`);
        for (const c of d.commands) console.log(`    ${c.id.padEnd(10)} ${String(c.label).padEnd(22)} ${c.template}${c.fade ? `   (${c.fade} fades)` : ''}${c.id === d.test ? '   (safe to try)' : ''}`);
        if (d.notes) console.log(`    ${d.notes}`);
      }
      return 0;
    }
    case 'check': { const rest = [b, ...more].filter(Boolean); return checkShow(a, rest.includes('--ask') || a === '--ask'); }
    case 'try': return tryCommand(a, b, more[0], more.slice(1));
    case 'fake-prop': return require('./ec-fake-prop').main([a, b, ...more].filter((x) => x !== undefined));
    case 'sounds': {
      // six plain tones under names a real folder has (a running-order number, a "FINAL", a "v2", a "loop"): something to start from a folder with
      const dir = path.resolve(a || 'Six Sounds');
      if (fs.existsSync(path.join(dir, 'show.json'))) { console.error(`${dir} is already a show: choose a new folder`); return 2; }
      fs.mkdirSync(dir, { recursive: true });
      const { writeWav } = require('../examples/make-demo');
      const names = { '01 sea wash': [110, 8], '02 gulls FINAL': [880, 4], '03 foghorn': [147, 3], '04 lamp hum loop': [220, 6], '05 storm v2': [98, 8], '06 bows': [330, 5] };
      for (const [name, [hz, secs]] of Object.entries(names)) {
        const n = Math.round(44100 * secs), x = new Float32Array(n);
        for (let i = 0; i < n; i++) { const t = i / 44100, edge = Math.min(1, t / 0.05, (secs - t) / 0.3); x[i] = 0.2 * edge * (Math.sin(2 * Math.PI * hz * t) + 0.4 * Math.sin(2 * Math.PI * hz * 1.5 * t)); }
        writeWav(path.join(dir, `${name}.wav`), x);
      }
      console.log(`Six sounds written to ${dir}\nIn Endless Cues: File ▸ Start from a Folder…, and choose that folder.`);
      return 0;
    }
    case 'demo': { const dir = path.resolve(a || 'Demo.ecshow'); require('../examples/make-demo').makeDemo(dir); console.log(`Demo show written to ${dir}`); return 0; }
    default: console.log(fs.readFileSync(__filename, 'utf8').split('/*!')[1].split('*/')[0].split('\n').slice(1).map((l) => l.replace(/^ \* ?/, '')).join('\n')); return cmd ? 2 : 0;
  }
}
// (some commands wait for the network: they answer with a promise)
try { Promise.resolve(main(process.argv.slice(2))).then((code) => { process.exitCode = code; }, (err) => { console.error(err.message); process.exitCode = 2; }); } catch (err) { console.error(err.message); process.exitCode = 2; }
