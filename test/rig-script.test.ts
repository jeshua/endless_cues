// The script: a text file in the show folder whose "@cue" lines say where the cues are (docs/specs/15, section 3.8).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as script from '../core/rig/script';
import * as check from '../core/rig/check';
import { build } from './helpers';
import type { Op } from '../core/show/ops';
import type { ShowDoc } from '../core/show/types';

const TEXT = ['# The Storm', '', 'ACT ONE', '', 'MARA', 'I never asked for rain.', '…and the sky answered.', '<!-- @cue 12 Thunder -->', '', '## Scene 2', 'A door, somewhere.', '@cue 12.5', '@cue A7   Door slam  ', 'Not a mark: write @cue 9 in the middle of a line.', '', 'SCENE 3: the shore', '<!-- a note for the director -->', '@CUE 31 Waves'].join('\n');
const folderWith = (files: Record<string, string | Buffer>) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-script-')); for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text); return dir; };

test('a script’s marks: the number, the name, the line it is called on and the section it is in', () => {
  const dir = folderWith({ 'script.md': TEXT });
  const r = script.read(dir, 'script.md');
  assert.equal(r.ok, true);
  assert.equal(r.lines, 18);
  assert.deepEqual(r.marks, [
    { line: 8, number: '12', name: 'Thunder', quote: '…and the sky answered.', section: 'ACT ONE' },
    { line: 12, number: '12.5', name: '', quote: 'A door, somewhere.', section: 'Scene 2' },
    { line: 13, number: 'A7', name: 'Door slam', quote: 'A door, somewhere.', section: 'Scene 2' },
    { line: 18, number: '31', name: 'Waves', quote: '', section: 'SCENE 3: the shore' },
  ]);
  assert.deepEqual(r.sections, [{ line: 1, name: 'The Storm' }, { line: 3, name: 'ACT ONE' }, { line: 10, name: 'Scene 2' }, { line: 16, name: 'SCENE 3: the shore' }]);
});

test('compare: the marks whose number no cue has', () => {
  const dir = folderWith({ 'script.md': TEXT });
  const { marks } = script.read(dir, 'script.md');
  const b = build([{ op: 'cue.add', cue: { type: 'memo', number: '12' } }, { op: 'cue.add', cue: { type: 'group', number: 'G', children: [{ type: 'memo', number: 'a7' }] } }]);
  assert.deepEqual(script.compare(b.doc, marks).missing.map((m) => [m.number, m.line]), [['12.5', 12], ['31', 18]]);
  assert.deepEqual(script.compare(b.doc, []).missing, []);
});

test('a script that is not there, is not text, or is not in a folder says so; one with no marks has nothing to compare', () => {
  const dir = folderWith({ 'notes.txt': 'A clap of thunder.\nThen rain.\n', 'score.pdf': '%PDF' });
  assert.deepEqual(script.read(dir, 'script.md'), { ok: false, why: 'There is no file script.md in the show folder.', lines: 0, marks: [], sections: [] });
  assert.match(script.read(dir, 'score.pdf').why, /Export it as text or \.docx/);
  assert.match(script.read(dir, '../outside.md').why, /outside the show folder/);
  assert.equal(script.read(null, 'script.md').why, 'This show is not in a folder yet.');
  assert.equal(script.read(dir, '').why, 'This show names no script.');
  const none = script.read(dir, 'notes.txt');
  assert.deepEqual([none.ok, none.lines, none.marks], [true, 2, []]);
  // the app never writes the script
  assert.equal(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), 'A clap of thunder.\nThen rain.\n');
});

test('the Rig’s row for the script, from the folder alone', () => {
  const dir = folderWith({ 'script.md': TEXT });
  const b = build([{ op: 'show.set', path: 'settings.rig.script', value: 'script.md' }, { op: 'cue.add', cue: { type: 'memo', number: '12' } }, { op: 'cue.add', cue: { type: 'memo', number: 'A7' } }, { op: 'cue.add', cue: { type: 'memo', number: '31' } }]);
  const row = (doc: ShowDoc, d = dir) => check.items(doc, check.folderFacts(d, doc)).find((i) => i.id === 'show.script')!;
  assert.deepEqual([row(b.doc).state, row(b.doc).text, row(b.doc).label], ['look', '12.5 (line 12) has no cue.', 'Every script mark has a cue']);
  const all = build([{ op: 'show.set', path: 'settings.rig.script', value: 'script.md' }, ...['12', '12.5', 'A7', '31'].map((number): Op => ({ op: 'cue.add', cue: { type: 'memo', number } }))]);
  assert.deepEqual([row(all.doc).state, row(all.doc).text], ['ready', '4 marks']);
  const gone = build([{ op: 'show.set', path: 'settings.rig.script', value: 'lost.md' }]);
  assert.deepEqual([row(gone.doc).state, row(gone.doc).text], ['look', 'lost.md cannot be read']);
  assert.equal(check.items(build([]).doc, check.folderFacts(dir, build([]).doc)).some((i) => i.id === 'show.script'), false, 'no script named: no row');
});
