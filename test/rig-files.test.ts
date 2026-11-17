// The files a proposal may carry into the show folder (core/show/files.ts; docs/specs/15, section 3.9).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as files from '../core/show/files';
import { ShowDocument } from '../core/show/document';
import type { FilesChecked } from '../core/show/files';
import type { Op } from '../core/show/ops';

type Passed = Extract<FilesChecked, { ok: true }>;
type Refused = Extract<FilesChecked, { ok: false }>;

const temp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-files-')), 'Show.ecshow');
const open = () => ShowDocument.open(temp());

test('what may be written: the two guides at the top, and anything under props/', () => {
  const d = open();
  const r = files.check(d.showDir, [{ path: 'AGENTS.md', text: '# Guide\nline two\n' }, { path: 'CLAUDE.md', text: '@AGENTS.md\n' }, { path: 'props/lantern_a/lantern_a.ino', text: 'void setup() {}\n' }, { path: 'props/.gitignore', text: 'secrets.h\nbuild/\n' }]);
  assert.equal(r.ok, true);
  assert.deepEqual((r as Passed).files.map((f) => [f.path, f.lines, f.replaces]), [['AGENTS.md', 2, false], ['CLAUDE.md', 1, false], ['props/lantern_a/lantern_a.ino', 1, false], ['props/.gitignore', 2, false]]);
  assert.deepEqual((r as Passed).kept, []);
});

test('every refusal has its sentence, and nothing outside the folder can be named', () => {
  const d = open();
  const no = (list: unknown, re: RegExp, dir: string | null = d.showDir) => { const r = files.check(dir, list); assert.equal(r.ok, false, JSON.stringify(list).slice(0, 80)); assert.match((r as Refused).why, re); };
  const f = (p: string, text = 'x') => [{ path: p, text }];
  no(f('AGENTS.md'), /^Save the show to a folder first: this writes files into it\.$/, null);
  no([], /no files to write/);
  no(new Array(25).fill(0).map((_, i) => ({ path: `props/a/f${i}.h`, text: 'x' })), /at most 24 files \(this has 25\)/);
  no([{ path: 'AGENTS.md' }], /a file is \{ "path": …, "text": … \}/);
  no([{ path: 'props/a.bin', text: Buffer.from([1, 2]) }], /a file is/);
  no(f('show.json'), /show\.json may not be written: only AGENTS\.md and CLAUDE\.md at the top of the show folder, and files under props\//);
  no(f('media/rain.wav'), /may not be written/);
  no(f('README.md'), /may not be written/);
  no(f('agents.md'), /may not be written/);
  no(f('versions/x.json'), /may not be written/);
  no(f('props'), /may not be written/);
  no(f('../AGENTS.md'), /leaves the show folder/);
  no(f('props/../show.json'), /leaves the show folder/);
  no(f('props/../../etc/passwd'), /leaves the show folder/);
  no(f('props//a.h'), /leaves the show folder, or is not a plain path/);
  no(f('/tmp/AGENTS.md'), /is not a path inside the show folder/);
  no(f('C:/AGENTS.md'), /is not a path inside the show folder/);
  no(f('props\\a.h'), /is not a path inside the show folder/);
  no(f('props/a/big.h', 'x'.repeat(200 * 1024 + 1)), /too big \(200 KB; at most 200 KB a file\)/);
  no(f('props/a/bin.h', 'a\0b'), /is not text/);
  no([{ path: 'props/a/x.h', text: '1' }, { path: 'props/a/X.h', text: '2' }], /is in the list twice/);
  // a link inside the folder that points out of it is not a way out
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-outside-'));
  fs.symlinkSync(outside, path.join(d.showDir!, 'props'));
  no(f('props/lantern/a.h'), /would be written outside the show folder \(a link in it points elsewhere\)/);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.throws(() => files.write(d.showDir!, f('props/lantern/a.h')), /outside the show folder/);
});

test('a file that is there is marked as replaced; the same text is not; secrets.h, once it exists, is never touched', () => {
  const d = open();
  files.write(d.showDir!, [{ path: 'props/lantern/config.h', text: '#define PIN 5\n' }, { path: 'props/lantern/secrets.h', text: '#define WIFI_PASS "CHANGE-ME"\n' }, { path: 'props/lantern/lantern.ino', text: 'v1\n' }]);
  fs.writeFileSync(path.join(d.showDir!, 'props/lantern/secrets.h'), '#define WIFI_PASS "the real one"\n');      // the person types their password
  const r = files.check(d.showDir, [{ path: 'props/lantern/config.h', text: '#define PIN 4\n' }, { path: 'props/lantern/secrets.h', text: '#define WIFI_PASS "CHANGE-ME"\n' }, { path: 'props/lantern/lantern.ino', text: 'v1\n' }]);
  assert.deepEqual((r as Passed).files.map((f) => [f.path, f.replaces]), [['props/lantern/config.h', true], ['props/lantern/lantern.ino', false]]);
  assert.deepEqual((r as Passed).kept, ['props/lantern/secrets.h']);
  files.write(d.showDir!, [{ path: 'props/lantern/secrets.h', text: 'gone' }, { path: 'props/lantern/config.h', text: '#define PIN 4\n' }]);
  assert.equal(fs.readFileSync(path.join(d.showDir!, 'props/lantern/secrets.h'), 'utf8'), '#define WIFI_PASS "the real one"\n');
  assert.equal(fs.readFileSync(path.join(d.showDir!, 'props/lantern/config.h'), 'utf8'), '#define PIN 4\n');
  assert.match((files.check(d.showDir, [{ path: 'props/lantern/secrets.h', text: 'x' }]) as Refused).why, /already there and is kept as it is/);
  assert.deepEqual(fs.readdirSync(path.join(d.showDir!, 'props/lantern')).sort(), ['config.h', 'lantern.ino', 'secrets.h'], 'no temporary file is left behind');
});

test('a proposal carries files: listed in the review, written on accept, and undo leaves them', () => {
  const d = open();
  const ops: Op[] = [{ op: 'device.add', device: { name: 'Lantern', model: 'ec-prop-light', host: '10.0.0.42' } }];
  const p = d.propose(ops, { files: [{ path: 'props/lantern/lantern.ino', text: 'void setup() {}\nvoid loop() {}\n' }, { path: 'props/lantern/config.h', text: '#define NAME "lantern"\n' }] });
  assert.deepEqual(p.files.map((f) => [f.path, f.lines, f.replaces]), [['props/lantern/lantern.ino', 2, false], ['props/lantern/config.h', 1, false]]);
  assert.deepEqual([p.counts.devices, p.counts.files], [1, 2]);
  assert.equal(p.summary, 'device Lantern added · 2 files for the show folder');
  assert.equal(fs.existsSync(path.join(d.showDir!, 'props')), false, 'nothing is written until it is accepted');
  const r = d.accept(p.id);
  assert.deepEqual(r.files, ['props/lantern/lantern.ino', 'props/lantern/config.h']);
  assert.equal(fs.readFileSync(path.join(d.showDir!, 'props/lantern/config.h'), 'utf8'), '#define NAME "lantern"\n');
  assert.equal(d.doc.settings.rig.devices.length, 1);
  d.undo();
  assert.equal(d.doc.settings.rig.devices.length, 0, 'undo takes back the change to the show');
  assert.ok(fs.existsSync(path.join(d.showDir!, 'props/lantern/lantern.ino')), '…and leaves the files');
});

test('a proposal may be files alone; an untitled show cannot take one; a file that cannot be written leaves the proposal waiting', () => {
  const d = open();
  const before = d.doc;
  const p = d.proposeDocument(d.doc, { summary: 'The guide for coding agents', author: 'you', files: [{ path: 'AGENTS.md', text: '# This folder\n' }, { path: 'CLAUDE.md', text: '@AGENTS.md\n' }] });
  assert.deepEqual([p.changes.length, p.files.length, p.counts.files, p.author], [0, 2, 2, 'you']);
  assert.equal(d.proposeDocument(d.doc, { files: [{ path: 'AGENTS.md', text: 'x' }] }).summary, '1 file for the show folder');
  d.reject();
  const q = d.proposeDocument(d.doc, { files: [{ path: 'AGENTS.md', text: '# This folder\n' }, { path: 'CLAUDE.md', text: '@AGENTS.md\n' }] });
  const r = d.accept(q.id);
  assert.deepEqual([r.changed, r.files], [false, ['AGENTS.md', 'CLAUDE.md']]);
  assert.equal(d.doc, before, 'the show itself did not change');
  assert.equal(d.dirty, false);
  assert.equal(fs.readFileSync(path.join(d.showDir!, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  // a second time: the same text replaces nothing, a new text is marked
  assert.deepEqual(d.proposeDocument(d.doc, { files: [{ path: 'AGENTS.md', text: '# This folder\n' }, { path: 'CLAUDE.md', text: 'changed\n' }] }).files.map((f) => f.replaces), [false, true]);
  // refused before it is staged
  assert.throws(() => d.propose([], { files: [{ path: 'show.json', text: '{}' }] }), /show\.json may not be written/);
  assert.throws(() => new ShowDocument().proposeDocument(new ShowDocument().doc, { files: [{ path: 'AGENTS.md', text: 'x' }] }), /Save the show to a folder first: this writes files into it\./);
  // the folder changed under a waiting proposal: accepting says why, and it is still there to accept
  const w = d.propose([{ op: 'show.set', path: 'notes', value: 'with a file' }], { files: [{ path: 'props/a/a.ino', text: 'x' }] });
  fs.writeFileSync(path.join(d.showDir!, 'props'), 'a file where the folder should be');
  assert.throws(() => d.accept(w.id));
  assert.equal(d.proposal!.id, w.id);
  assert.equal(d.doc.notes, '', 'and the show did not change');
});
