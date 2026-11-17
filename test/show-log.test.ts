// The show log (core/log/show-log.js) and double-GO protection for every way a GO arrives (core/engine/go-guard.js).
import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ShowLog, clean, bareLines } from '../core/log/show-log';
import { createGoGuard } from '../core/engine/go-guard';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ec-log-'));
// a timer that waits to be told: the log is written only when the test says time has passed
function laterTimer() { const due: (() => void)[] = []; const t = (fn: () => void) => { due.push(fn); return {}; }; t.run = () => { while (due.length) due.shift()!(); }; return t; }

test('adding a line never writes: the lines are written together, later, without waiting', async () => {
  const dir = tmp(), timer = laterTimer();
  let writes = 0;
  const counting = { ...fs.promises, appendFile: (...a: Parameters<typeof fs.promises.appendFile>) => { writes++; return fs.promises.appendFile(...a); } };
  const log = new ShowLog({ version: '1.2.3', timer, fs: counting, now: () => new Date(2026, 10, 16, 19, 30, 2, 5).getTime() });
  log.open(dir, 'Rain');
  for (let i = 0; i < 50; i++) log.add('go', `GO ${i}`, { cue: String(i) });
  assert.equal(writes, 0, 'nothing is written while the GOs come');
  timer.run();
  await log.flush();
  assert.equal(writes, 2, 'one append to the log and one to its table');
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['2026-11-16 19-30-02.csv', '2026-11-16 19-30-02.log']);
  const text = fs.readFileSync(path.join(dir, files[1]), 'utf8').split('\n');
  assert.match(text[0], /^# Endless Cues show log · 1\.2\.3/);
  assert.match(text[1], /^19:30:02\.005  show    opened “Rain”/);
  assert.match(text[2], /^19:30:02\.005  GO      GO 0$/);
  const csv = fs.readFileSync(path.join(dir, files[0]), 'utf8').split('\n');
  assert.equal(csv[0], 'time,kind,cue,what');
  assert.match(csv[2], /,go,0,GO 0$/);
});

test('a log that cannot be written is given up, and the lines stay in memory', async () => {
  const broken = { ...fs.promises, mkdir: async () => { throw new Error('read-only'); } };
  const log = new ShowLog({ fs: broken, timer: laterTimer() });
  log.open('/nowhere/logs', 'X');
  log.add('error', 'its file is missing');
  await log.flush();
  assert.equal(log.tail().length, 2);
});

test('a full file goes on in a new one, and only the newest sittings are kept', async () => {
  const dir = tmp();
  let t = new Date(2026, 0, 1, 10, 0, 0).getTime();
  const make = () => new ShowLog({ now: () => t, keep: 2, maxBytes: 200, timer: laterTimer() });
  for (let i = 0; i < 3; i++) { const l = make(); l.open(dir, 'S'); await l.prune(); await l.flush(); t += 60000; }
  const l = make(); l.open(dir, 'S');
  for (let i = 0; i < 20; i++) { l.add('cue', `a line long enough to fill the file quickly, number ${i}`); await l.flush(); }
  await l.prune();
  fs.writeFileSync(path.join(dir, 'playback.csv'), 'kept\n');
  await l.prune();
  const names = fs.readdirSync(dir);
  assert.ok(names.includes('playback.csv'), 'the playback log is not the show log’s to remove');
  const sittings = new Set(names.filter((f) => f !== 'playback.csv').map((f) => f.replace(/(?: \d+)?\.(log|csv)$/, '')));
  assert.equal(sittings.size, 2);
  assert.ok(names.some((f) => / 2\.log$/.test(f)), 'a second part');
});

test('the Log view follows with since(); nothing secret is written', () => {
  const log = new ShowLog({ timer: laterTimer() });
  log.open(null, 'X');
  const a = log.add('trigger', 'OSC /go token=abc123 fires 4');
  log.add('warning', 'Bearer eyJhbGciOi.secret');
  assert.deepEqual(log.since(a.n).map((e) => e.kind), ['warning']);
  assert.equal(a.text, 'OSC /go token=<key> fires 4');
  assert.equal(clean('key sk-ant-REALLYSECRET123 used'), 'key <key> used');
  assert.equal(clean('password: hunter2'), 'password: <key>');
  assert.equal(clean('hotkey shift+b fires 3'), 'hotkey shift+b fires 3');
});

test('a report gets the lines with every cue’s name and file taken out', () => {
  const log = new ShowLog({ timer: laterTimer(), now: () => new Date(2026, 0, 1, 20, 1, 2).getTime() });
  log.open(null, 'X');
  const e = [log.add('go', 'GO 12 Thunder over the bay'), log.add('cue', '▶ 12 Thunder over the bay plays (media/thunder.wav) at 0 dB')];
  const out = bareLines(e, ['Thunder over the bay', 'Rain']);
  assert.deepEqual(out, ['20:01:02.000 go GO 12 …', '20:01:02.000 cue ▶ 12 … plays (a file) at 0 dB']);
});

test('double-GO protection: a GO from anywhere within the time of the last is ignored', () => {
  let t = 1000;
  const g = createGoGuard({ now: () => t, secs: () => 0.3 });
  assert.equal(g.go('window'), true);
  t += 100; assert.equal(g.go('osc'), false, 'from somewhere else is a GO too');
  assert.ok(g.lockLeft() > 0);
  t += 250; assert.equal(g.go('web-remote'), true, 'past the time: it goes (measured from the last that went)');
  assert.deepEqual(g.ignored().map((x) => [x.kind, x.from, x.after]), [['go', 'osc', 100]]);
});

test('a cue’s own trigger is not a GO, but the same trigger again within the time is ignored', () => {
  let t = 0;
  const g = createGoGuard({ now: () => t, secs: () => 0.3 });
  assert.equal(g.go(), true);
  assert.equal(g.trigger('osc /thunder · a'), true, 'a GO does not lock a trigger');
  t += 50;
  assert.equal(g.trigger('osc /thunder · a'), false, 'the same message for the same cue: a bounce');
  assert.equal(g.trigger('osc /thunder · b'), true, 'another cue');
  assert.equal(g.trigger('midi note 60 · a'), true, 'another trigger');
  t += 400;
  assert.equal(g.go(), true, 'a trigger does not lock GO');
  assert.equal(g.trigger('osc /thunder · a'), true);
});

test('with protection at 0, nothing is ignored', () => {
  const g = createGoGuard({ now: () => 5, secs: () => 0 });
  assert.ok(g.go() && g.go() && g.trigger('k') && g.trigger('k'));
  assert.equal(g.lockLeft(), 0);
});
