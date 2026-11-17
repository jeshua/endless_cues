import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { importQlab } from '../core/import/qlab';
import * as show from '../core/show/show';

// A made-up workspace (test/fixtures/make-qlab-stage-fixture.py). Its shape is a guess at what QLab writes for
// these cues: this shows what the importer does with such a file, not that QLab's files look like it.
const FILE = path.join(__dirname, 'fixtures', 'stage.qlab5');
const load = () => importQlab(fs.readFileSync(FILE), { file: FILE });

test('QLab’s Video, Text and Camera cues come across as cues for the stage, each with a note saying what to check', () => {
  const { doc, report } = load();
  const n = (x: string) => show.findByNumber(doc, x)!;
  const film = n('1');
  assert.deepEqual([film.type, film.gainDb, film.from, film.cutAt, film.loop, film.holdEnd], ['video', -6, 2, 30, true, true]);
  assert.match(film.file!, /film\.mov$/);
  assert.deepEqual([film.opacity, film.x, film.y, film.scale, film.layer, film.fit], [50, 120, -40, 0.5, 7, 'natural']);
  const why = (re: RegExp) => report.issues.filter((i) => re.test(i.why)).map((i) => i.cue);
  assert.deepEqual(why(/have not been checked against a real workspace/), ['1 Film']);
  assert.deepEqual(why(/was not found in the file, so it fits the stage/), ['2 Backdrop']);
  assert.deepEqual([n('2').type, n('2').fit, n('2').opacity], ['video', undefined, undefined]);
  assert.deepEqual([n('3').type, n('3').text], ['text', 'Act Two']);
  assert.deepEqual([n('4').type, n('4').text], ['text', 'Interval'], 'words that cannot be read: the cue’s name stands in');
  assert.deepEqual(why(/its words could not be read/), ['4 Interval']);
  assert.equal(n('5').type, 'camera');
  assert.deepEqual([n('6').type, n('6').target, n('6').stopTarget], ['fade', film.id, true]);
  assert.equal(why(/targets a Video cue/).length, 0, 'a Fade may be aimed at a Video cue');
  assert.deepEqual([n('7').type, n('7').target, n('7').at], ['load', film.id, 10]);
  assert.equal(why(/loads a Video/).length, 0);
  assert.equal(show.problems(doc).filter((p) => p.level === 'error').length, 0);
  assert.equal(report.missing.length, 2, 'its picture files are looked for like its sounds');
});
