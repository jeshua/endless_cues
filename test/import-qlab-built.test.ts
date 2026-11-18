import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { importQlab } from '../core/import/qlab';
import * as show from '../core/show/show';
import * as midi from '../core/net/midi';
import type { Cue } from '../core/show/types';

// A made-up workspace (test/fixtures/make-qlab-built-fixture.py) whose cues keep each setting under the name, and in
// the form, that QLab 5.6.3 saved it in workspaces built with QLab itself (test/qlab-compare): each cue one thing the
// importer once missed or said wrongly.
const FILE = path.join(__dirname, 'fixtures', 'qlab-built', 'fields.qlab5');
const load = () => importQlab(fs.readFileSync(FILE), { file: FILE });
const cueOf = (r: ReturnType<typeof load>, n: string) => show.findByNumber(r.doc, n) as Cue & Record<string, any>;
const said = (r: ReturnType<typeof load>, n: string) => r.report.issues.filter((i) => i.id === cueOf(r, n).id).map((i) => i.why);

test('the main level down on QLab’s own outputs says nothing; on outputs of its own it says the cue is silent', () => {
  const r = load();
  // every QLab cue's output levels are at unity: a cue with its main level down and nothing else changed is just quiet
  assert.equal(cueOf(r, '2').gainDb, -60);
  assert.ok(!said(r, '2').some((w) => /outputs of its own/.test(w)), said(r, '2').join(' / '));
  // sent to outputs 3 and 4 by its crosspoints, with its main level down: that is worth a word
  assert.deepEqual(cueOf(r, '3').outputs, [{ 3: 0 }, { 4: 0 }]);
  assert.ok(said(r, '3').some((w) => /played only on outputs of its own, with its main level down/.test(w)));
  // its main level down and one input up: still silent (QLab's main level is on everything), not a pan made louder
  assert.equal(cueOf(r, '22').gainDb, -60);
});

test('a MIDI cue with no message says what it held, not a guess', () => {
  const r = load();
  assert.equal(cueOf(r, '10').type, 'memo');
  assert.match(said(r, '10').join(' '), /an empty SysEx message/);
  assert.match(said(r, '11').join(' '), /no message at all/);
  for (const n of ['10', '11']) assert.ok(!said(r, n).some((w) => /MIDI timecode/.test(w)), 'not “MIDI timecode, or an empty SysEx”');
  assert.match(String(cueOf(r, '11').notes), /no message at all/);
});

test('an MSC message with no words here goes as its bytes; a timed go keeps its time', () => {
  const r = load();
  // SET: control 3 to 90, each as 14 bits, low first
  assert.equal(cueOf(r, '12').midi, 'F0 7F 00 02 01 06 03 00 5A 00 F7');
  assert.equal(cueOf(r, '13').midi, 'msc timed-go 3 time 01:02:03:04');
  const bytes = midi.encode(midi.parseText(cueOf(r, '13').midi));
  assert.deepEqual(bytes.slice(5, 11), [0x04, 1, 2, 3, 4, 0], 'the time is sent before the cue number');
  assert.doesNotThrow(() => midi.encode(midi.parseText(cueOf(r, '12').midi)));
});

test('a Timecode cue’s start, rate and LTC output are read as QLab saves them', () => {
  const r = load();
  assert.deepEqual([cueOf(r, '6').timecode, cueOf(r, '6').fps, cueOf(r, '6').output, cueOf(r, '6').channel, cueOf(r, '6').duration], ['01:02:03:04', '25', 'ltc', 2, 10]);
  assert.deepEqual([cueOf(r, '7').timecode, cueOf(r, '7').fps, cueOf(r, '7').output], ['10:00:00;00', '29.97df', 'mtc']);
  assert.ok(!said(r, '6').some((w) => /could not be read/.test(w)));
});

test('wall-clock and timecode triggers, ducking, the second trigger and auto-load come across', () => {
  const r = load();
  assert.equal(cueOf(r, '8').clockTrigger, '13:45 mon fri');
  assert.ok(show.parseClock(cueOf(r, '8').clockTrigger));
  assert.equal(cueOf(r, '9').timecodeTrigger, '01:00:10:00');
  const a = cueOf(r, '1');
  assert.deepEqual([a.duckOthers, a.duckTime, a.secondTrigger, a.secondOnRelease, a.autoLoad], [-10, 2, 'devamp', true, true]);
  assert.deepEqual([a.fadeOthers, a.fadeOthersScope], [3, 'peers'], 'QLab’s 1 is its peers');
  assert.equal(a.preservePitch, true, 'doPitchShift 0 is a rate that keeps its pitch');
  assert.match(said(r, '1').join(' '), /plays at rate 1\.5, keeping its pitch/);
  assert.equal(a.color, 'red', 'crimson is a QLab 5 colour');
  assert.equal(a.color2, 'yellow');
  assert.ok(!r.report.issues.some((i) => /not carried over/.test(i.why) && i.id === a.id), said(r, '1').join(' / '));
});

test('a Text cue’s words and style, a MIDI File’s rate, Reset, Target, Devamp, Load and Script cues', () => {
  const r = load();
  const t = cueOf(r, '5');
  assert.deepEqual([t.text, t.font, t.size, t.textColor, t.align], ['Hello stage', 'Helvetica Neue', 72, '#ff8000', 'left']);
  assert.equal(cueOf(r, '14').rate, 1.2);
  assert.equal(cueOf(r, '15').type, 'reset');
  assert.equal(cueOf(r, '15').target, cueOf(r, '1').id);
  assert.equal(cueOf(r, '16').type, 'target');
  assert.deepEqual([cueOf(r, '16').target, cueOf(r, '16').to], [cueOf(r, '2').id, cueOf(r, '3').id], 'aimed at the cue numbered 3');
  assert.equal(cueOf(r, '17').startNext, true);
  assert.equal(cueOf(r, '18').at, -1.5, 'a time from the end, here as in QLab');
  assert.equal(cueOf(r, '19').type, 'memo');
  assert.match(String(cueOf(r, '19').notes), /AppleScript[\s\S]*return 1/);
});

test('a Fade that moves a picture keeps where it moves it to, and leaves its sound alone', () => {
  const r = load();
  const f = cueOf(r, '20');
  assert.deepEqual([f.opacity, f.x, f.y, f.db], [0, 10, 0, undefined]);
  assert.ok(!said(r, '20').some((w) => /not carried over|does not fade its target/.test(w)), said(r, '20').join(' / '));
});

test('a QLab 4 Video cue’s level is read from the sound inside it', () => {
  assert.equal(cueOf(load(), '23').gainDb, -60);
});

test('a Light cue with a command a Light cue here cannot read keeps its commands in its notes, and says which', () => {
  const r = load();
  assert.equal(cueOf(r, '24').type, 'memo');
  assert.match(String(cueOf(r, '24').notes), /front = 50\nfront\.color = rgbw\(100, 0, 0, 0\)/);
  assert.match(said(r, '24').join(' '), /rgbw\(100, 0, 0, 0\).*kept as a Memo, its commands in its notes/);
});

test('a MIDI trigger keeps QLab’s value for its second byte where it asked for one', () => {
  const r = load();
  // (QLab saves the condition as 0 for "=", 1 for any, 2 for below, 3 for above)
  assert.equal(cueOf(r, '25').midiTrigger, 'cc 22 127 ch 5', 'a controller at one value only: one cue for each value');
  assert.equal(cueOf(r, '26').midiTrigger, 'note 60');
  assert.equal(cueOf(r, '27').midiTrigger, 'note 60');
  assert.match(said(r, '27').join(' '), /fires on any velocity, where QLab’s fired only above 64/);
  assert.deepEqual(said(r, '25'), []);
});

test('a playlist’s cues play one after another: their own continue modes are not kept', () => {
  const r = load();
  const g = cueOf(r, '21');
  assert.equal(g.mode, 'playlist');
  assert.equal(g.children![0].continue, undefined);
});

test('the made-up workspace imports with nothing broken', () => {
  const r = load();
  const broken = show.problems(r.doc).filter((p) => p.level === 'error' && !/file|no target/.test(p.why));
  assert.deepEqual(broken, []);
});

// A workspace QLab 5.6.3 saved itself, built by AppleScript from nothing (reference: test/qlab-compare), its cues
// without files so it holds no path of the computer it was made on. The same checks, on QLab's own bytes.
test('a workspace QLab saved: levels, text, timecode, triggers, MSC, colours and the rest', () => {
  const FEW = path.join(__dirname, 'fixtures', 'qlab-built', 'few.qlab5');
  const r = importQlab(fs.readFileSync(FEW), { file: FEW });
  const c = (n: string) => show.findByNumber(r.doc, n) as Cue & Record<string, any>;
  const notes = (n: string) => r.report.issues.filter((i) => i.id === c(n).id).map((i) => i.why).join(' / ');
  assert.equal(r.report.qlabVersion, '5.6.3');
  assert.equal(c('1').gainDb, -60);
  // QLab's second trigger "nothing" (its default) leaves a running cue playing when it is started again; a Memo has none
  assert.deepEqual([c('1').secondTrigger, c('3').secondTrigger, c('5').secondTrigger, c('10').secondTrigger], ['nothing', 'nothing', undefined, 'devamp']);
  assert.doesNotMatch(notes('1'), /outputs of its own/);
  assert.deepEqual(c('2').outputs, [{ 3: 0 }, { 4: 0 }]);
  assert.match(notes('2'), /played only on outputs of its own/);
  assert.deepEqual([c('3').text, c('3').font, c('3').size], ['Hello stage', 'Helvetica Neue', 72]);
  assert.deepEqual([c('4').timecode, c('4').fps, c('4').output, c('4').channel], ['01:02:03:04', '25', 'ltc', 2]);
  assert.equal(c('5').clockTrigger, '13:45');
  assert.equal(c('6').timecodeTrigger, '01:00:10:00');
  assert.equal(c('7').midi, 'F0 7F 00 02 01 06 03 00 5A 00 F7');
  assert.match(notes('8'), /an empty SysEx message/);
  assert.deepEqual([c('9').color, c('9').color2], ['red', 'sky']);
  assert.deepEqual([c('10').secondTrigger, c('10').duckOthers, c('10').fadeOthers, c('10').fadeOthersScope], ['devamp', -10, 2, 'list']);
});
