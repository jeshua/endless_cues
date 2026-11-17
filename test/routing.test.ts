import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as routing from '../core/audio/routing';
import * as show from '../core/show/show';
import { applyOps } from '../core/show/ops';
import { importQlab, toDb } from '../core/import/qlab';

const withCue = (cue, settings) => {
  let doc = show.newShow('t');
  doc = applyOps(doc, [{ op: 'cue.add', list: doc.lists[0].id, cue }, ...Object.entries(settings || {}).map(([p, value]) => ({ op: 'show.set', path: p, value }))]).doc;
  return doc;
};

test('a cue’s outputs are kept as rows of { output: dB }, with silence and nonsense left out', () => {
  assert.deepEqual(routing.cleanMatrix([{ 3: 0 }, { 4: '-6' }]), [{ 3: 0 }, { 4: -6 }]);
  assert.deepEqual(routing.cleanMatrix([{ 3: 0, 5: -60, 0: 0, 99: 0, x: 1, 4: null }, {}, {}]), [{ 3: 0 }], 'a silent crosspoint, an output that cannot be, and empty rows at the end are dropped');
  assert.deepEqual(routing.cleanMatrix([{}, {}, { 3: 20 }]), [{}, {}, { 3: 12 }], 'an empty row before a used one keeps its place: the row is the channel');
  assert.equal(routing.cleanMatrix([{}, {}]), null, 'nothing sent anywhere is no routing');
  assert.equal(routing.cleanMatrix(null), null);
  assert.throws(() => routing.cleanMatrix({ 3: 0 }), /one entry per channel/);
  assert.throws(() => routing.cleanMatrix([3]), /each channel/);
  assert.deepEqual(routing.outputsOf([{ 6: 0, 3: 0 }, { 3: -3 }]), [3, 6]);
  assert.equal(routing.describe([{ 3: 0 }, { 4: 0 }]), 'outputs 3–4');
  assert.equal(routing.describe([{ 5: 0 }, { 5: 0 }]), 'output 5');
  assert.equal(routing.describe([{ 1: 0 }, { 6: 0 }]), 'outputs 1, 6');
  assert.deepEqual(routing.straight(3, 4), [{ 3: 0 }, { 4: 0 }, { 5: 0 }, { 6: 0 }]);
  assert.deepEqual(routing.straight(7, 1, true), [{ 7: 0, 8: 0 }]);
});

test('outputs and eq are fields of an Audio and a Mic cue: set by an edit, checked, cleared, and given to the engine', () => {
  const doc = withCue({ type: 'audio', file: 'a.wav', outputs: [{ 3: 0 }, { 4: -6.04 }], eq: { low: -40, mid: 0, high: 9 } });
  const cue = doc.lists[0].cues[0];
  assert.deepEqual(cue.outputs, [{ 3: 0 }, { 4: -6 }]);
  assert.deepEqual(cue.eq, { low: -40, high: 6 }, 'a flat band is left out and a boost stops at +6');
  const e = show.toEngineDoc(doc).lists[0].cues[0];
  assert.deepEqual([e.outputs, e.eq], [cue.outputs, cue.eq]);
  const cleared = applyOps(doc, [{ op: 'cue.set', id: cue.id, props: { outputs: [{}, {}], eq: { low: 0 } } }]).doc.lists[0].cues[0];
  assert.equal('outputs' in cleared, false, 'a matrix that sends nothing is no routing: the cue is on its bus again');
  assert.equal('eq' in cleared, false);
  assert.throws(() => applyOps(doc, [{ op: 'cue.set', id: cue.id, props: { outputs: 'left' } }]), /outputs/);
  const mic = withCue({ type: 'mic', outputs: [{ 8: 0 }] }).lists[0].cues[0];
  assert.deepEqual(mic.outputs, [{ 8: 0 }]);
  assert.equal(show.stringify(show.newShow('x')).includes('outs'), false, 'a show that routes nothing says nothing about outputs');
});

test('the audio settings as the sound window is told them: defaults filled in, numbers made safe', () => {
  const s = routing.settingsOf({ outs: { 3: { name: ' Click ', trim: -6 }, 4: { trim: 6 }, 5: { name: '' }, x: {}, 70: { name: 'no' } }, auditionOut: 8,
    fx: { reverb: { secs: 99, out: 6 } }, buses: [{ id: 'music', reverb: -12 }, { id: 'effects', delay: -80 }, { id: 'vocals' }] });
  assert.deepEqual(s.outs, { 3: { name: 'Click', trim: -6 } }, 'a trim only turns an output down; an output with neither a name nor a trim is not kept');
  assert.deepEqual(s.trims, { 3: -6 });
  assert.equal(s.audition, 7, 'the audition output is a pair, named by its first');
  assert.deepEqual(s.fx.reverb, { secs: 10, db: -6, out: 5 });
  assert.deepEqual(s.fx.delay, routing.FX_DEFAULTS.delay);
  assert.deepEqual(s.sends, { music: { reverb: -12 } }, 'a send at silence is no send');
  assert.equal(routing.settingsOf(undefined).audition, 0);
  assert.equal(routing.outName({ outs: { 3: { name: 'Click' } } }, 3), 'Click');
  assert.equal(routing.outName({}, 3), '3');
});

test('the outputs a show uses, and what a device with too few cannot play (silent, and said)', () => {
  const doc = withCue({ type: 'group', children: [{ type: 'audio', file: 'a.wav', outputs: [{ 5: 0 }, { 6: 0 }] }] },
    { 'settings.audio.auditionOut': 7, 'settings.audio.buses.0.reverb': -6, 'settings.audio.fx': { reverb: { out: 3 } } });
  assert.deepEqual(routing.outputsUsed(doc), [3, 4, 5, 6, 7, 8]);
  assert.deepEqual(routing.lost(doc, 8), []);
  const on4 = routing.lost(doc, 4);
  assert.equal(on4.length, 2);
  assert.equal(on4[0].id, doc.lists[0].cues[0].children[0].id);
  assert.match(on4[0].why, /outputs 5, 6, and this device has 4/);
  assert.match(on4[1].why, /Audition .* 7–8/);
  assert.equal(routing.lost(doc, 2).length, 3, 'the reverb’s return on 3–4 is lost too');
  assert.equal(routing.lost(withCue({ type: 'audio', file: 'a.wav', outputs: [{ 3: 0 }] }), 3).length, 1, 'an output is there when its whole pair is');
});

test('audition marks: only what V starts, each sound once, and never for longer than the cue’s own waits', () => {
  let now = 0;
  const a = new routing.Audition(() => now);
  const group = { id: 'g', preWait: 1, children: [{ id: 'a', preWait: 3 }, { id: 'b' }] };
  a.mark(group);
  assert.equal(a.take('a'), true);
  assert.equal(a.take('a'), false, 'a mark is spent by the sound it sent to the audition pair');
  assert.equal(a.take('other'), false);
  now = 6001;                                   // the longest wait under it is 4 s, and two more
  assert.equal(a.take('b'), false, 'a mark does not outlive the audition it was made for');
  a.mark(group); a.clear();
  assert.equal(a.take('g'), false, 'a GO clears the marks');
  a.mark(group); a.mark({ id: 'z' });
  assert.equal(a.take('a'), false, 'a new audition replaces the last');
  assert.equal(a.take('z'), true);
});

test('a QLab level matrix becomes a cue’s outputs: masters multiplied in, the default left as no routing', () => {
  const knob = (row, column, initialLevel, trimLevel = 1) => ({ row, column, initialLevel, trimLevel });
  const plain = { a: knob(0, 0, 0.5), b: knob(0, 1, 1), c: knob(0, 2, 1), d: knob(1, 1, 1), e: knob(2, 2, 1) };
  assert.equal(routing.fromQlab(plain, { toDb }), null, 'QLab’s default is what a bus does');
  assert.equal(routing.fromQlab({ ...plain, e: undefined, f: knob(1, 2, 1) }, { toDb }), null, 'one channel on both of 1–2 is plain too');
  // a click: channel 1 to output 3, channel 2 to output 4 at −6; output 4's own level at −6 more; a silent crosspoint
  const click = routing.fromQlab({ m: knob(0, 0, 1), o3: knob(0, 3, 1), o4: knob(0, 4, 0.5011872336), x: knob(1, 3, 1), y: knob(2, 4, 0.5011872336), z: knob(2, 1, 0) }, { toDb });
  assert.deepEqual(click.matrix, [{ 3: 0 }, { 4: -12 }]);
  assert.deepEqual(click.outputs, [3, 4]);
  assert.deepEqual(routing.fromQlab({ ...plain, i: knob(1, 0, 0.5011872336) }, { toDb }).matrix, [{ 1: -6 }, { 2: 0 }], 'an input level off unity is a routing of its own');
  assert.deepEqual(routing.fromQlab({ ...plain, d: knob(1, 1, 1, 0.5011872336) }, { toDb }).matrix, [{ 1: -6 }, { 2: 0 }], 'a trim is part of the level');
  assert.equal(routing.fromQlab({}, { toDb }), null);
  // QLab 4 writes all 24 rows, each to its own output: for a stereo file, or one whose channels are not known, that is the default
  const wide = { m: knob(0, 0, 0.7) };
  for (let i = 1; i <= 24; i++) { wide['o' + i] = knob(0, i, 1); wide['i' + i] = knob(i, 0, 1); wide['x' + i] = knob(i, i, 1); }
  assert.equal(routing.fromQlab(wide, { toDb }), null, 'an untouched diagonal is no routing');
  assert.equal(routing.fromQlab(wide, { toDb, channels: 2 }), null);
  assert.deepEqual(routing.fromQlab(wide, { toDb, channels: 4 }).outputs, [1, 2, 3, 4], 'a four-channel file keeps its four');
  assert.deepEqual(routing.fromQlab({ ...wide, x1: knob(1, 3, 1) }, { toDb }).matrix, [{ 3: 0 }, { 2: 0 }], 'and with the channels unknown, the untouched rows are not kept');
  assert.deepEqual(routing.fromQlab({ ...wide, x1: knob(1, 3, 1) }, { toDb, channels: 2 }).matrix, [{ 3: 0 }, { 2: 0 }], 'a real routing is kept, without the rows past the file');
});

test('importing a QLab workspace carries a cue’s matrix across, and says how', () => {
  const file = path.join(__dirname, 'fixtures', 'small.qlab5');
  const { doc, report } = importQlab(fs.readFileSync(file), { file });
  const w2 = show.findByNumber(doc, '8').children[1];
  assert.deepEqual(w2.outputs, [{ 1: 0, 2: -6 }, { 2: 0 }], 'channel 1 also to output 2 at half: kept');
  const said = report.issues.filter((i) => /output routing/.test(i.why));
  assert.equal(said.length, 1);
  assert.match(said[0].why, /came across as outputs 1–2/);
  assert.equal(show.findByNumber(doc, '1').outputs, undefined, 'a cue at QLab’s default routing has none here');
});

test('a WAV file’s channels are read from its header', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-routing-'));
  const wav = (channels) => { const b = Buffer.alloc(44 + 8 * channels); b.write('RIFF', 0); b.writeUInt32LE(36 + 8 * channels, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22); b.writeUInt32LE(44100, 24); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(8 * channels, 40); return b; };
  fs.writeFileSync(path.join(dir, 'six.wav'), wav(6));
  fs.writeFileSync(path.join(dir, 'not.wav'), 'hello, this is not a sound file at all');
  assert.equal(routing.wavChannels(path.join(dir, 'six.wav')), 6);
  assert.equal(routing.wavChannels(path.join(dir, 'not.wav')), 0);
  assert.equal(routing.wavChannels(path.join(dir, 'missing.wav')), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a change to a cue’s outputs is said in words in the list of unsaved changes', () => {
  const { diffShows } = require('../core/show/diff');
  const a = withCue({ type: 'audio', file: 'a.wav' });
  const b = applyOps(a, [{ op: 'cue.set', id: a.lists[0].cues[0].id, props: { outputs: [{ 3: 0 }, { 4: 0 }], eq: { low: -6 } } }]).doc;
  const text = JSON.stringify(diffShows(a, b));
  assert.match(text, /outputs 3–4/);
  assert.match(text, /low -6 dB/);
});
