// A QLab Light cue comes across as a Light cue that holds the same levels, where its text can be read.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { importQlab } from '../core/import/qlab';
import * as show from '../core/show/show';

// a made-up workspace (test/fixtures/make-qlab-light-fixture.py writes it): no real QLab file with Light cues has been read
const FILE = path.join(__dirname, 'fixtures', 'light.qlab5');
const load = () => importQlab(fs.readFileSync(FILE), { file: FILE });

test('QLab Light cues are imported as Light cues with their commands and fade time', () => {
  const { doc, report } = load();
  const [a, b, c, d] = doc.lists[0].cues;
  assert.deepEqual([a.type, a.number, a.name, a.notes, a.duration], ['light', '1', 'Opening look', 'Warm.', 4]);
  assert.equal(a.levels, 'front = 80\ncyc.red = 100\nall.blue = 25');
  // found by what it reads as, not by the name of the key it was under; a fade time of 0 stays 0
  assert.deepEqual([b.type, b.levels, b.duration, b.continue], ['light', '1 - 3 = 50\nfront = home', 0, 'auto-continue']);
  // a level pulled from another cue is kept as text and said not to be read
  assert.equal(c.type, 'light');
  assert.match(report.issues.filter((i) => i.id === c.id).map((i) => i.why).join('|'), /pulled levels from another cue/);
  // one with no commands to be found stays a Memo, as before
  assert.equal(d.type, 'memo');
  assert.match(report.issues.find((i) => i.id === d.id).why, /was a Light cue: kept as a Memo/);
  // the patch is not read: the report says which names the cues need
  const patch = report.issues.find((i) => i.cue === 'Light patch');
  assert.match(patch.why, /front, cyc, all, 1 - 3, side/);
  assert.deepEqual(doc.settings.light.instruments, []);
});

test('…and once instruments of those names are patched, the imported cues have no problems', () => {
  const { doc } = load();
  const [a, b] = doc.lists[0].cues;
  assert.match(show.problems(doc).find((p) => p.id === a.id).why, /no instrument or group “front”/);
  doc.settings.light.instruments = [{ name: 'front', fixture: 'dimmer' }, { name: 'cyc', fixture: 'rgb' }, { name: '1', fixture: 'dimmer' }, { name: '2', fixture: 'dimmer' }];
  assert.deepEqual(show.problems(doc).filter((p) => p.id === a.id || p.id === b.id), []);
});
