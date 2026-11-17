/** What is kept beside a show: timed backups, templates and settings files, and the playback log. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const show = require('../core/show/show');
const backups = require('../core/show/backups');
const templates = require('../core/show/show-templates');
const { applyOps } = require('../core/show/ops');
const { ShowDocument } = require('../core/show/document');
const { PlayLog, toCsv, CSV_HEAD } = require('../core/engine/playlog');
const { createHub } = require('../core/net/hub');
const { build } = require('./helpers');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `ec-${name}-`));
const sample = () => build([
  { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', name: 'Rain', file: 'media/rain.wav' } },
  { op: 'cue.add', cue: { type: 'fade', number: '2', target: '@a' } },
]).doc;

test('a backup is the working document at a moment; an unchanged show makes no second one', () => {
  const dir = tmp('backups');
  const doc = sample();
  const t0 = new Date(2026, 2, 14, 19, 5, 9).getTime();
  const first = backups.write(dir, doc, { now: t0 });
  assert.equal(first.name, '2026-03-14 19.05.09.json');
  assert.equal(backups.write(dir, doc, { now: t0 + 300000 }), null, 'nothing changed: nothing written');
  const changed = applyOps(doc, [{ op: 'cue.set', id: '#1', props: { gainDb: -6 } }]).doc;
  const second = backups.write(dir, changed, { now: t0 + 600000 });
  assert.deepEqual(backups.list(dir).map((b) => b.name), [second.name, first.name], 'newest first');
  assert.equal(backups.read(dir, first.name).lists[0].cues[0].gainDb, undefined);
  assert.equal(backups.read(dir, second.name).lists[0].cues[0].gainDb, -6);
  assert.throws(() => backups.read(dir, '../show.json'), /no backup/);
});

test('backups are pruned: the newest are kept, then the last of each day', () => {
  const dir = tmp('prune');
  let doc = sample();
  const day = 86400000, t0 = new Date(2026, 0, 1, 12, 0, 0).getTime();
  // four a day for five days, keeping only the newest three
  for (let d = 0; d < 5; d++) for (let k = 0; k < 4; k++) {
    doc = applyOps(doc, [{ op: 'cue.set', id: '#1', props: { gainDb: -(d * 4 + k + 1) } }]).doc;
    backups.write(dir, doc, { now: t0 + d * day + k * 60000, keep: 3 });
  }
  const names = backups.list(dir).map((b) => b.name);
  assert.deepEqual(names, ['2026-01-05 12.03.00.json', '2026-01-05 12.02.00.json', '2026-01-05 12.01.00.json',
    '2026-01-05 12.00.00.json', '2026-01-04 12.03.00.json', '2026-01-03 12.03.00.json', '2026-01-02 12.03.00.json', '2026-01-01 12.03.00.json']);
  assert.equal(backups.surplus(backups.list(dir), { keep: 3, days: 2 }).length, 3, 'and only for so many days');
});

test('going back to a backup is an edit: undoable, and not kept until saved', () => {
  const dir = path.join(tmp('restore'), 'T.ecshow');
  const d = ShowDocument.open(dir);
  d.edit([{ op: 'cue.add', cue: { type: 'memo', number: '1', name: 'Before' } }]); d.save();
  const b = backups.write(backups.dirOf(dir), d.doc);
  d.edit([{ op: 'cue.set', id: '#1', props: { name: 'After' } }]); d.save();
  assert.equal(d.replace(backups.read(backups.dirOf(dir), b.name), { label: 'backup' }), true);
  assert.equal(d.doc.lists[0].cues[0].name, 'Before');
  assert.equal(d.dirty, true, 'the show file still says After until it is saved');
  assert.equal(ShowDocument.open(dir).saved.lists[0].cues[0].name, 'After');
  d.undo();
  assert.equal(d.doc.lists[0].cues[0].name, 'After');
  assert.equal(d.replace(d.doc), false, 'the same document is no edit');
});

test('a template starts a new show: the same cues and settings, a new id, its sounds found, no secrets', () => {
  const dir = tmp('templates');
  let doc = sample();
  doc = applyOps(doc, [{ op: 'show.set', path: 'modules.osc-control.passcode', value: '4321' }, { op: 'show.set', path: 'modules.web-remote.key', value: 'abcd1234' },
    { op: 'show.set', path: 'settings.go.panicFade', value: 2.5 }]).doc;
  const t = templates.templateOf(doc, { name: 'Our: usual/rig', showDir: path.join(dir, 'Old.ecshow') });
  assert.equal(JSON.stringify(t).includes('4321') || JSON.stringify(t).includes('abcd1234'), false, 'no passcode or key leaves the show');
  const saved = templates.save(dir, t);
  assert.equal(saved.name, 'Our usual rig');
  assert.deepEqual(templates.list(dir).map((x) => x.name), ['Our usual rig']);
  const made = templates.showFrom(templates.read(saved.file), 'New one');
  assert.notEqual(made.id, doc.id);
  assert.equal(made.title, 'New one');
  assert.equal(made.settings.go.panicFade, 2.5);
  assert.equal(made.lists[0].cues[0].file, path.join(dir, 'Old.ecshow', 'media/rain.wav'), 'a sound is named by where it is, so the new show plays it');
  assert.equal(made.lists[0].cues[1].target, made.lists[0].cues[0].id, 'targets still point at their cues');
  assert.equal(doc.lists[0].cues[0].file, 'media/rain.wav', 'the show it was made from is untouched');
  assert.throws(() => templates.showFrom({ format: 'something else' }), /not an Endless Cues template/);
});

test('settings travel as a file: imported as one checked edit, and the show keeps its own passcodes', () => {
  let from = sample();
  from = applyOps(from, [
    { op: 'show.set', path: 'settings.audio.buses', value: [{ id: 'music', name: 'Band', db: -3, out: 3 }, { id: 'effects', name: 'FX', db: 0 }] },
    { op: 'show.set', path: 'settings.network.patches', value: [{ id: 'desk', name: 'Desk', host: '10.0.0.9', port: 8000 }] },
    { op: 'show.set', path: 'modules.osc-control', value: { enabled: true, passcode: '1111' } },
  ]).doc;
  const file = JSON.parse(JSON.stringify(templates.settingsOf(from)));
  assert.equal(file.modules['osc-control'].passcode, '');
  const mine = applyOps(sample(), [{ op: 'show.set', path: 'modules.osc-control.passcode', value: '9999' }]).doc;
  const r = applyOps(mine, templates.settingsOps(file, mine));
  assert.deepEqual(r.doc.settings.audio.buses.map((b) => [b.id, b.name, b.out]), [['music', 'Band', 3], ['effects', 'FX', undefined]]);
  assert.equal(r.doc.settings.network.patches[0].host, '10.0.0.9');
  assert.deepEqual([r.doc.modules['osc-control'].enabled, r.doc.modules['osc-control'].passcode], [true, '9999']);
  assert.equal(r.doc.lists[0].cues.length, 2, 'the cues are not touched');
  assert.throws(() => templates.settingsOps({ format: 'endless-cues-show' }, mine), /not an Endless Cues settings file/);
  // a file with a setting this app cannot hold is refused whole
  const bad = JSON.parse(JSON.stringify(file)); bad.settings.network.patches[0].port = 'eight thousand';
  assert.throws(() => applyOps(mine, templates.settingsOps(bad, mine)), /a patch needs a "port"/);
});

test('the playback log: what played, when, and for how long it was heard', () => {
  let t = new Date(2026, 2, 14, 19, 30, 0).getTime();
  const written = [];
  const log = new PlayLog({ now: () => t, onEntry: (e) => written.push(e) });
  log.started('a', { file: 'media/rain.wav', number: '1', name: 'Rain, "heavy"', mode: 'show' });
  t += 10000; log.paused('a');
  t += 5000; log.resumed('a');          // five seconds paused are not five seconds played
  t += 2500;
  log.started('b', { file: 'media/bell.wav', number: '2', name: 'Bell', mode: 'show' });
  t += 1000;
  assert.equal(log.ended('a').secs, 13.5);
  assert.equal(log.ended('a'), null, 'ended once');
  log.started('b', { file: 'media/bell.wav', number: '2', name: 'Bell', mode: 'show' });       // fired again while it plays: two plays
  t += 61000; log.endAll();
  assert.deepEqual(written.map((e) => [e.number, e.secs]), [['1', 13.5], ['2', 1], ['2', 61]]);
  assert.equal(toCsv(log.entries()), `${CSV_HEAD}\n2026-03-14,19:30:00,1,"Rain, ""heavy""",media/rain.wav,13.5,0:14,show\n2026-03-14,19:30:17,2,Bell,media/bell.wav,1.0,0:01,show\n2026-03-14,19:30:18,2,Bell,media/bell.wav,61.0,1:01,show\n`);
});

test('an output held back sends nothing and says so in the monitor', () => {
  const hub = createHub({ dryRun: true });
  hub.configure({ patches: [{ id: 'desk', name: 'Desk', host: '10.0.0.9', port: 8000 }] });
  assert.equal(hub.send('desk', '/cue/1/fire').ok, true);
  hub.hold('held back: OSC out is switched off for rehearsal');
  const e = hub.send('desk', '/cue/2/fire');
  assert.deepEqual([e.ok, e.held, e.why], [false, true, 'held back: OSC out is switched off for rehearsal']);
  assert.equal(hub.status().patches.desk.error || '', '', 'it is not the patch that is at fault');
  hub.hold('');
  assert.equal(hub.send('desk', '/cue/3/fire').ok, true);
  assert.deepEqual(hub.monitor().filter((x) => x.dir === 'out').map((x) => [x.text, x.ok]), [['/cue/1/fire', true], ['/cue/2/fire', false], ['/cue/3/fire', true]]);
  hub.close();
});
