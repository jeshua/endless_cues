// The show folder, read: its files, and the text of a text file (core/rig/folder.ts; docs/specs/15, section 3.9).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import * as folder from '../core/rig/folder';
import { build, linkFile, linkFolder } from './helpers';

/** One second of silence as a WAV, so a sound in the listing has a length. */
function wav(secs = 1, rate = 8000) {
  const data = Buffer.alloc(Math.round(secs * rate) * 2), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
/** A .docx, made here: a zip with one deflated file, word/document.xml. */
function docx(paragraphs: string[]) {
  const xml = Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${paragraphs.map((p) => `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t xml:space="preserve">${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('')}<w:p/></w:body></w:document>`);
  const name = Buffer.from('word/document.xml'), body = zlib.deflateRawSync(xml), crc = zlib.crc32 ? zlib.crc32(xml) : 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(xml.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(xml.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + body.length, 16);
  return Buffer.concat([local, name, body, central, name, end]);
}
function showFolder() {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-folder-')), 'Spring Concert');
  for (const d of ['sfx', 'sfx/deep/deeper', 'versions', 'backups', 'logs', 'recordings', '.git']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  for (const f of ['10 Finale.wav', '2 Waltz.wav', '01 Overture.wav', 'sfx/door.wav', 'sfx/deep/far.wav', 'sfx/deep/deeper/too far.wav']) fs.writeFileSync(path.join(dir, f), wav(f === '01 Overture.wav' ? 2 : 1));
  for (const [f, text] of Object.entries({ 'notes.txt': 'one\ntwo\nthree\n', 'show.json': '{}', 'show.unsaved.json': '{}', 'versions/a.json': '{}', 'backups/b.json': '{}', 'logs/playback.csv': 'x', 'recordings/r.wav': 'x', '.git/config': 'x', 'clip.mp4': 'x', 'poster.png': 'x', 'song.mid': 'x', 'thing.bin': 'x', 'half.tmp': 'x' })) fs.writeFileSync(path.join(dir, f), text);
  return dir;
}

test('the listing: every file two folders deep, in the order a person reads names, without the show’s own', () => {
  const dir = showFolder();
  const b = build([{ op: 'cue.add', cue: { type: 'audio', number: '1', file: '01 Overture.wav' } }, { op: 'cue.add', ref: 'd', cue: { type: 'audio', file: 'sfx/door.wav' } }, { op: 'cue.add', cue: { type: 'audio', number: '3', file: path.join(dir, 'sfx', 'door.wav') } }]);
  const list = folder.listing(dir, b.doc, { durations: { '2 Waltz.wav': 93.456 } });
  assert.deepEqual(list.map((e) => e.path), ['01 Overture.wav', '2 Waltz.wav', '10 Finale.wav', 'clip.mp4', 'notes.txt', 'poster.png', 'song.mid', 'thing.bin', 'sfx/door.wav', 'sfx/deep/far.wav']);
  const by = Object.fromEntries(list.map((e) => [e.path, e]));
  assert.deepEqual([by['01 Overture.wav'].kind, by['01 Overture.wav'].secs, by['01 Overture.wav'].usedBy], ['sound', 2, ['#1']]);
  assert.equal(by['2 Waltz.wav'].secs, 93.46, 'a length the app has measured is used');
  assert.deepEqual(by['sfx/door.wav'].usedBy, [b.id('d'), '#3'], 'a cue names a file by its path in the folder, or by its whole path');
  assert.deepEqual(['clip.mp4', 'notes.txt', 'poster.png', 'song.mid', 'thing.bin'].map((p) => by[p].kind), ['video', 'text', 'image', 'midi', 'other']);
  assert.ok(by['notes.txt'].bytes === 14);
  assert.deepEqual(folder.counts(list), { sounds: 5, videos: 1, texts: 1, unused: 4 });
  assert.deepEqual(folder.listing(dir, b.doc, { under: 'sfx' }).map((e) => e.path), ['sfx/door.wav', 'sfx/deep/far.wav', 'sfx/deep/deeper/too far.wav']);
  assert.deepEqual(folder.listing(null, b.doc), [], 'an untitled show has no folder');
});

test('reading a text file: some lines at a time, never more than 400', () => {
  const dir = showFolder();
  fs.writeFileSync(path.join(dir, 'long.md'), Array.from({ length: 1212 }, (_, i) => `line ${i + 1}`).join('\r\n'));
  let r = folder.readText(dir, 'long.md');
  assert.deepEqual([r.ok, r.from, r.to, r.total, r.text.split('\n').length, r.text.split('\n')[399]], [true, 1, 400, 1212, 400, 'line 400']);
  r = folder.readText(dir, 'long.md', { from: 1201, lines: 9999 });
  assert.deepEqual([r.from, r.to, r.text.split('\n')[0]], [1201, 1212, 'line 1201']);
  r = folder.readText(dir, 'notes.txt', { from: 2, lines: 1 });
  assert.deepEqual([r.text, r.from, r.to, r.total], ['two', 2, 2, 3]);
  assert.deepEqual(folder.readText(dir, 'notes.txt', { from: 50 }).text, '');
});

test('what is not read, each with its sentence: outside the folder, a link out of it, the show’s own, not text, too big, a PDF', () => {
  const dir = showFolder();
  const outside = path.join(path.dirname(dir), 'secret.txt');
  fs.writeFileSync(outside, 'the wifi password');
  const fileLinked = linkFile(outside, path.join(dir, 'link.txt'));   // (not on Windows without the right to)
  linkFolder(path.dirname(dir), path.join(dir, 'up'));
  fs.writeFileSync(path.join(dir, 'score.pdf'), '%PDF-1.7');
  fs.writeFileSync(path.join(dir, 'big.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 97));
  const why = (rel: string) => { const r = folder.readText(dir, rel); assert.equal(r.ok, false, rel); assert.equal(r.text, ''); return r.why; };
  assert.match(why('../secret.txt'), /outside the show folder/);
  assert.match(why(outside), /outside the show folder/);
  if (fileLinked) assert.match(why('link.txt'), /a link that points out of the show folder/);
  assert.match(why('up/secret.txt'), /a link that points out of the show folder/);
  assert.match(why('show.json'), /is the show itself/);
  assert.match(why('versions/a.json'), /the app’s own/);
  assert.match(why('score.pdf'), /Export it as text or \.docx and put that in the folder\./);
  assert.match(why('01 Overture.wav'), /is not a text file this reads/);
  assert.match(why('big.txt'), /too big to read \(2\.0 MB; at most 2 MB\)/);
  assert.match(why('nope.txt'), /There is no file nope\.txt/);
  assert.match(why('sfx'), /is a folder/);
  assert.equal(folder.readText(null, 'notes.txt').why, 'This show is not in a folder yet.');
  // and a link is never in the listing
  assert.ok(!folder.listing(dir).some((e) => e.path.startsWith('link') || e.path.startsWith('up')));
  // nor listed by asking for the folder through it
  assert.deepEqual(folder.listing(dir, null, { under: 'up' }), []);
  assert.deepEqual(folder.listing(dir, null, { under: 'up/' + path.basename(dir) }), []);
});

test('a .docx is read as its paragraphs', () => {
  const dir = showFolder();
  fs.writeFileSync(path.join(dir, 'script.docx'), docx(['ACT ONE', 'Tom & Jerry <enter>', '@cue 12 Thunder', '']));
  const r = folder.readText(dir, 'script.docx');
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(r.text.split('\n'), ['ACT ONE', 'Tom & Jerry <enter>', '@cue 12 Thunder', '', '']);
  assert.equal(folder.listing(dir).find((e) => e.path === 'script.docx')!.kind, 'text');
  // so a script may be one
  const marks = (require('../core/rig/script') as typeof import('../core/rig/script')).read(dir, 'script.docx').marks;
  assert.deepEqual(marks.map((m) => [m.number, m.name, m.quote, m.section]), [['12', 'Thunder', 'Tom & Jerry <enter>', 'ACT ONE']]);
  fs.writeFileSync(path.join(dir, 'broken.docx'), 'not a zip at all, only words');
  assert.match(folder.readText(dir, 'broken.docx').why, /could not be read: not a zip/);
});
