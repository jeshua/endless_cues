import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { parseBinaryPlist, unarchive } from '../core/import/plist';
import { importQlab, toDb } from '../core/import/qlab';
import * as show from '../core/show/show';
import { simulate } from '../core/engine/dry-run';
import type { ShowDoc } from '../core/show/types';

// a made-up workspace in the shape QLab 5 saves (test/fixtures/make-qlab-fixture.py writes it)
const FILE = path.join(__dirname, 'fixtures', 'small.qlab5');
const load = () => importQlab(fs.readFileSync(FILE), { file: FILE });
const byNumber = (doc: ShowDoc, n: string) => show.findByNumber(doc, n)!;
/** A keyed archive as read: what is in it is whatever the file says. */
type Archived = Record<string, any>;

test('a binary property list and the keyed archive inside it are read', () => {
  const plist = parseBinaryPlist(fs.readFileSync(FILE)) as Archived;
  assert.equal(plist.$archiver, 'NSKeyedArchiver');
  const root = unarchive(fs.readFileSync(FILE)) as Archived;
  assert.equal(root.workspaceName, 'Small Show');
  assert.ok(Buffer.isBuffer(root.cueLists), 'the cue lists are a second archive');
  const lists = unarchive(root.cueLists) as Archived;
  assert.equal(lists.cues[0].name, 'Main Cue List');
  const fade = lists.cues[0].cues[1].cues[1];
  assert.equal(fade.cueTarget, lists.cues[0].cues[0], 'a reference is the same object, not a copy');
  assert.throws(() => parseBinaryPlist(Buffer.from('not a plist at all, just some text that is long enough')), /not a binary property list/);
});

test('a QLab workspace becomes a show: lists, cues, levels, targets and settings', () => {
  const { doc, report } = load();
  assert.equal(doc.title, 'Small Show');
  assert.deepEqual(doc.lists.map((l) => l.name), ['Main Cue List', 'Stings']);
  assert.equal(report.counts.cues, 31);
  const rain = byNumber(doc, '1');
  assert.deepEqual({ type: rain.type, gainDb: rain.gainDb, loop: rain.loop, color: rain.color, notes: rain.notes, file: rain.file },
    { type: 'audio', gainDb: -6, loop: true, color: 'blue', notes: 'House to half first.', file: '/shows/demo/audio/rain.wav' });
  const storm = byNumber(doc, '2');
  assert.equal(storm.type, 'group');
  const [thunder, duck, back] = storm.children!;
  assert.deepEqual({ from: thunder.from, cutAt: thunder.cutAt, preWait: thunder.preWait }, { from: 1.5, cutAt: 20, preWait: 0.5 });
  assert.deepEqual({ target: duck.target, db: duck.db, duration: duck.duration }, { target: rain.id, db: -15, duration: 0.3 });
  assert.equal(back.preWait, 8);
  const out = byNumber(doc, '3');
  assert.deepEqual({ db: out.db, stop: out.stopTarget, cont: out.continue, post: out.postWait }, { db: -60, stop: true, cont: 'auto-continue', post: 1 });
  // the control cues keep their targets
  for (const [n, type, target] of [['9', 'start', storm.id], ['10', 'stop', rain.id], ['11', 'pause', rain.id], ['12', 'load', rain.id], ['13', 'goto', storm.id], ['14', 'disarm', thunder.id], ['15', 'arm', thunder.id], ['16', 'devamp', rain.id]]) {
    const c = byNumber(doc, n);
    assert.deepEqual([c.type, c.target], [type, target], `cue ${n}`);
  }
  assert.equal(byNumber(doc, '12').at, 12.5);
  assert.equal(byNumber(doc, '7').duration, 4);
  assert.equal(byNumber(doc, '17').armed, false);
  // network: the patch and a faded value
  const patch = doc.settings.network.patches[0];
  assert.deepEqual({ name: patch.name, host: patch.host, port: patch.port, protocol: patch.protocol }, { name: 'Lighting desk', host: '10.0.0.20', port: 8000, protocol: 'udp' });
  assert.deepEqual({ m: byNumber(doc, '4').message, p: byNumber(doc, '4').patch }, { m: '/eos/cue/1/12/fire', p: patch.id });
  const dim = byNumber(doc, '5');
  assert.deepEqual([dim.message, dim.fadeFrom, dim.fadeTo, dim.duration], ['/ch/01/mix/fader #v#', 0.75, 0, 3]);
  assert.deepEqual(doc.settings.go, { doubleGoProtection: 0.5, panicFade: 2 });
  assert.equal(toDb(1), 0); assert.equal(toDb(0), -60); assert.equal(toDb(2), 6);
});

test('what cannot come across is kept as a Memo and reported, cue by cue', () => {
  const { doc, report } = load();
  const video = byNumber(doc, '6');
  assert.equal(video.type, 'video', 'a Video cue is one here (test/import-video.test.js)');
  assert.equal(video.continue, 'auto-follow', 'its place in the sequence is kept');
  const why = (re: RegExp) => report.issues.filter((i) => re.test(i.why)).map((i) => i.cue);
  assert.deepEqual(why(/Video cue/), ['6 Title card']);
  assert.deepEqual(why(/hotkey with no key/), ['6 Title card']);
  assert.deepEqual(why(/rate 1\.1|play count and slices/).sort(), ['Walk-in 1', 'Walk-in 1']);
  const pl = byNumber(doc, '8');
  assert.deepEqual([pl.mode, pl.shuffle, pl.repeat, pl.crossfade], ['playlist', true, true, 2.5]);
  assert.deepEqual(pl.children![0].loops, [{ start: 0, end: 10, name: 'Slice 1', count: 2 }], 'a slice with a play count is a counted loop region');
  assert.equal(pl.children![1].plays, 2, 'a play count comes across');
  assert.deepEqual(why(/output routing/), ['Walk-in 2'], 'a cue at QLab’s default routing is not flagged');
  assert.deepEqual(why(/cue cart/), [], 'a cart comes across as a cart');
  assert.deepEqual(why(/2 destinations/), ['Network patch Lighting desk']);
  assert.deepEqual(why(/no target/), ['18 points nowhere']);
  assert.equal(report.missing.length, 6);
  assert.match(doc.notes, /^Imported from the QLab 5\.6\.3 workspace “small\.qlab5”/);
  // the only broken cues are the ones that were broken in QLab too (a Video cue with no file, a Start with no target)
  assert.deepEqual(show.problems(doc).filter((p) => p.level === 'error').map((p) => show.index(doc).byId.get(p.id)!.number), ['6', '18']);
});

test('an imported show plays: the storm ducks the rain and brings it back', () => {
  const { doc } = load();
  const r = simulate(doc, { gos: 2, gap: 12, durations: { '/shows/demo/audio/rain.wav': 60, '/shows/demo/audio/thunder.wav': 30 } });
  const lines = r.events.map((e) => `${e.t} ${e.text}`);
  assert.ok(lines.some((l) => /^0 ▶ Rain plays .* at -6 dB.*looping/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /^12 ◢ Rain → -15 dB over 0\.3 s/.test(l)));
  assert.ok(lines.some((l) => /^12\.5 ▶ Thunder plays .* from 1\.5 s/.test(l)));
  assert.ok(lines.some((l) => /^20 ◢ Rain → -6 dB over 2 s/.test(l)));
});

test('a file that is not a QLab 5 workspace is refused with a reason', () => {
  assert.throws(() => importQlab(Buffer.from('{"format":"endless-cues-show"}')), /not a QLab workspace/);
});

test('MIDI cues, a hotkey, a MIDI trigger and a start-first group come across as QLab 5 writes them', () => {
  const { doc, report } = load();
  assert.deepEqual(['20', '21', '22'].map((n) => [byNumber(doc, n).type, byNumber(doc, n).midi]), [['midi', 'pc 12 ch 2'], ['midi', 'msc go 12.5 list 2 dev 3'], ['midi', 'note 60 100']]);
  assert.equal(byNumber(doc, '22').hotkey, 'shift+7');
  assert.equal(byNumber(doc, '22').midiTrigger, 'note 36 ch 10');
  const g = byNumber(doc, '23');
  assert.equal(g.mode, 'enter');
  assert.equal(g.children![0].continue, 'auto-continue');
  assert.ok(!report.issues.some((i) => /23 Phone call|ring/.test(i.cue)), 'nothing about it needs saying');
});

// A workspace saved by QLab itself (5.6.3), when one is there: `reference/` is not in the repository, so this
// runs only on a computer that has it. It is what the field names above were read from.
test('a workspace QLab itself saved is read', { skip: !require('fs').existsSync(require('path').join(__dirname, '../reference/qlab/made-by-qlab-5.6.3.qlab5')) }, () => {
  const fs = require('fs'), path = require('path');
  const { doc } = importQlab(fs.readFileSync(path.join(__dirname, '../reference/qlab/made-by-qlab-5.6.3.qlab5')));
  const n = (x: string) => byNumber(doc, x);
  assert.deepEqual(['1', '2', '3', '4', '5', '6'].map((x) => n(x).midi), ['note 60 100 ch 2', 'pc 12', 'cc 7 101 ch 3', 'note off 61 ch 16', 'msc go 12.5 list 2 dev 3', 'msc stop sound']);
  assert.deepEqual(['10', '11', '12', '13', '14'].map((x) => n(x).mode), ['playlist', 'enter', 'first', 'random', undefined]);
  assert.deepEqual([n('10').shuffle, n('10').repeat, n('10').crossfade], [true, true, 2.5]);
  assert.equal(n('40').plays, 3);
  assert.deepEqual(n('41').loops!.map((l) => [l.start, l.end, l.count]), [[0, 1, 2], [1, 2, 4], [2, 4, 2]]);
});

test('a QLab 4 workspace is read: sounds found beside it, a relative fade, its numbered network patch', () => {
  const file = path.join(__dirname, 'fixtures/small.qlab4');
  const { doc, report } = importQlab(fs.readFileSync(file), { file });
  assert.equal(report.qlabVersion, '4.7');
  const bed = byNumber(doc, 'Q1'), sting = byNumber(doc, 'Q2'), dip = byNumber(doc, 'Q3'), osc = byNumber(doc, 'Q4');
  assert.equal(bed.file, path.join(__dirname, 'fixtures/audio/four-bed.wav'));          // beside the workspace, not where QLab last saw it
  assert.deepEqual([bed.continue, bed.postWait, Math.round(bed.gainDb!)], ['auto-continue', 3, -6]);
  assert.deepEqual([sting.from, sting.cutAt], [0.5, 1]);
  assert.deepEqual([dip.type, dip.target, dip.relative, dip.duration], ['fade', bed.id, true, 2]);
  assert.deepEqual([osc.type, osc.message, osc.patch], ['network', '/eos/cue/1/5/fire', doc.settings.network.patches[0].id]);
  assert.deepEqual([doc.settings.network.patches[0].host, doc.settings.network.patches[0].port], ['10.0.0.20', 8000]);
  assert.equal(doc.settings.go.panicFade, 1.5);
  // every QLab 4 sound has an end time: the cues are named, for the host to drop the ones that are only the file's end
  assert.deepEqual(report.endAtFileEnd.sort(), [bed.id, sting.id].sort());
  assert.equal(report.missing.length, 0);
});
