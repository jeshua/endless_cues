/**
 * How the assistant starts (core/assistant/starters.js): cues made from a folder of sounds, and the first
 * screen, which must be true of the show it is shown for (docs/specs/15-assistant-and-rig.md, 4.6).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as starters from '../core/assistant/starters';
import * as show from '../core/show/show';
import { applyOps } from '../core/show/ops';
import { build } from './helpers';

const kindOf = (p) => (/\.(wav|mp3|aif)$/.test(p) ? 'sound' : /\.(md|txt)$/.test(p) ? 'text' : /\.mp4$/.test(p) ? 'video' : 'other');
const listing = (paths, used = {}) => paths.map((p) => ({ path: p, kind: kindOf(p), bytes: 1, usedBy: used[p] || [] }));
const MESSY = ['01 walk-in.wav', '02 Overture FINAL.wav', 'notes.txt', 'rain loop.aif', 'Sc2_door.wav', 'Sc2_thunder FINAL v3.mp3', 'script.md'];
const first = (o) => starters.first({ provider: 'anthropic', installed: {}, ...o });

test('cues from a messy folder: file-name order, numbered, names cleaned, a scene prefix is a section, and nothing else is set', () => {
  const plan = starters.folderPlan(listing(MESSY));
  const cues = plan.ops.map((o) => o.cue);
  assert.deepEqual(cues.map((c) => [c.type, c.name]), [['audio', 'Walk-in'], ['audio', 'Overture'], ['audio', 'Rain loop'], ['section', 'Scene 2'], ['audio', 'Door'], ['audio', 'Thunder']]);
  assert.deepEqual(cues.slice(4).map((c) => [c.number, c.name, c.file]), [['4', 'Door', 'Sc2_door.wav'], ['5', 'Thunder', 'Sc2_thunder FINAL v3.mp3']]);
  // one GO a sound, not all at once: a heading over a run of cues, never a group that fires them together
  assert.ok(!cues.some((c) => c.type === 'group'));
  // nothing but a type, a number, a name and the file: no level, no fade, no loop
  for (const c of cues.filter((x) => x.type === 'audio')) assert.deepEqual(Object.keys(c).sort(), ['file', 'name', 'number', 'type']);
  assert.deepEqual(plan.loops, ['Rain loop']);
  assert.deepEqual(plan.texts, ['notes.txt', 'script.md']);
  const said = starters.said(plan);
  for (const words of [/5 cues in file-name order, numbered 1 to 5/, /without words like “FINAL” or “v3”/, /Scene 2/, /Each sound is its own GO/, /“Rain loop” is called a loop\. I did not make it loop\./, /I did not read notes\.txt and script\.md/, /Nothing else is set: no levels, fades or loops/]) assert.match(said, words);
  // the ops really apply, and the sounds are where they were
  const doc = applyOps(show.newShow('T'), plan.ops).doc;
  assert.equal(show.findByNumber(doc, '5').file, 'Sc2_thunder FINAL v3.mp3');
  assert.deepEqual(show.problems(doc).filter((p) => p.level === 'error'), []);
});

test('cues from a folder: a sub-folder is a section, a folder that only holds the sounds is not, and a used file is left alone', () => {
  const plan = starters.folderPlan(listing(['01 Overture.wav', 'act two/01 storm.wav', 'act two/02 calm.wav', 'media/bell.wav', 'props/x/readme.wav'], { '01 Overture.wav': ['#1'] }), { from: 2 });
  assert.deepEqual(plan.ops.map((o) => [o.cue.type, o.cue.number, o.cue.name]), [['section', undefined, 'Act two'], ['audio', '2', 'Storm'], ['audio', '3', 'Calm'], ['audio', '4', 'Bell']]);
  assert.deepEqual(plan.groups, [{ name: 'Act two', by: 'folder', count: 2 }]);
  // every sound in one sub-folder: that folder means nothing, so there is no group of everything
  assert.deepEqual(starters.folderPlan(listing(['tracks/01 a.wav', 'tracks/02 b.wav'])).ops.map((o) => o.cue.type), ['audio', 'audio']);
  // one file with a scene prefix is not a section; two versions of one sound keep what tells them apart
  const odd = starters.folderPlan(listing(['Sc2_thunder.wav', 'crash v2.wav', 'crash v3.wav']));
  assert.deepEqual(odd.ops.map((o) => o.cue.name), ['Sc2 thunder', 'Crash v2', 'Crash v3']);
  assert.equal(starters.said(starters.folderPlan([])), 'There are no sounds in this folder that a cue does not already use.');
  const doc = build([{ op: 'cue.add', cue: { type: 'memo', number: '7.5' } }, { op: 'cue.add', cue: { type: 'memo', number: 'A' } }]).doc;
  assert.equal(starters.nextNumber(doc), 8);
});

test('the first screen: an empty show, and a folder of sounds', () => {
  const empty = first({ doc: show.newShow('T') });
  assert.equal(empty.state, 'empty');
  assert.equal(empty.line, 'An empty show.');
  assert.deepEqual(empty.asks.map((a) => [a.label, a.action]), [['Start from a folder of sounds…', 'start-in-folder']]);
  assert.equal(empty.next.label, '', 'one line and one button');
  const f = first({ doc: show.newShow('T'), showDir: '/x', folder: listing(['01 a.wav', '02 b.wav', 'notes.txt']) });
  assert.equal(f.state, 'folder');
  assert.equal(f.line, '2 sounds and 1 text file not in a cue yet.');
  assert.deepEqual(f.asks.map((a) => [a.label, a.text, a.offline]), [['Make cues from these 2 sounds', 'Make cues from the 2 sounds in this folder.', true], ['Make cues from notes.txt', 'Read notes.txt and make cues from it.', false]]);
  assert.match(f.next.label, /^Next: tell me how each one should end/);
  assert.equal(f.next.text, '', 'a hint, not a button');
  // two text files and neither says it is the script: no guess at which to read
  assert.equal(first({ doc: show.newShow('T'), showDir: '/x', folder: listing(['a.wav', 'notes.txt', 'todo.txt']) }).asks.length, 1);
  assert.match(first({ doc: show.newShow('T'), showDir: '/x', folder: listing(['a.wav', 'notes.txt', 'script.md']) }).asks[1].label, /^Make cues from script\.md/);
});

test('the first screen: cues. An ask is offered only when it is true', () => {
  const tidy = build([{ op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', file: 'a.wav' } }, { op: 'cue.add', cue: { type: 'fade', number: '2', target: '@a', db: -60, duration: 3 } }, { op: 'cue.add', cue: { type: 'memo', number: '3' } }]).doc;
  const t = first({ doc: tidy, showDir: '/x', folder: listing(['a.wav'], { 'a.wav': ['#1'] }) });
  assert.equal(t.state, 'cues');
  assert.equal(t.line, '3 cues.');
  assert.deepEqual(t.asks, [], 'nothing broken, nothing unused, numbers in order, the one sound has its fade: nothing to offer');
  assert.equal(t.next.label, 'Next: tell me about your equipment.');
  const rough = build([
    { op: 'cue.add', cue: { type: 'audio', number: '1', file: 'a.wav' } }, { op: 'cue.add', cue: { type: 'audio', number: '1.5', file: 'b.wav' } },
    { op: 'cue.add', cue: { type: 'audio', number: '2', file: 'c.wav' } }, { op: 'cue.add', cue: { type: 'fade', number: '9' } },
  ]).doc;
  const r = first({ doc: rough, showDir: '/x', folder: listing(['a.wav', 'b.wav', 'c.wav', 'd.wav', 'e.wav'], { 'a.wav': ['#1'], 'b.wav': ['#1.5'], 'c.wav': ['#2'] }) });
  assert.equal(r.line, '4 cues, 1 of them broken.');
  assert.deepEqual(r.asks.map((a) => a.label), ['Fix the broken cue', 'Make cues for 2 unused sounds', 'Renumber Main in tens', 'Add fade-outs to the Music cues']);
  assert.equal(r.asks.length, 4, 'never more than four');
});

test('the first screen: devices, with and without the running app; an imported show', () => {
  const doc = applyOps(build([{ op: 'cue.add', cue: { type: 'memo', number: '1' } }]).doc, [
    { op: 'device.add', device: { name: 'Lantern A', model: 'ec-prop-light', host: '10.0.0.42' } },
    { op: 'device.add', device: { name: 'Lantern B', model: 'ec-prop-light', host: '10.0.0.43' } },
    { op: 'cue.add', cue: { type: 'device', device: 'lantern_a', command: 'identify' } },
  ]).doc;
  const cold = first({ doc, showDir: '/x', folder: listing(['props/lantern_a/lantern_a.ino']) });
  assert.equal(cold.state, 'devices');
  assert.equal(cold.line, '2 devices: Lantern A and Lantern B.');
  assert.deepEqual(cold.asks.map((a) => a.label), ['Add a cue: Identify to Lantern B', 'Is everything ready?', 'Write firmware for Lantern B']);
  assert.ok(cold.asks.every((a) => a.offline));
  assert.equal(cold.next.label, 'Next: ask me to hand the show over.');
  const live = first({ doc, showDir: '/x', rig: { devices: { lantern_a: { state: 'ready' }, lantern_b: { state: 'problem' } } } });
  assert.equal(live.line, '2 devices: 1 answering, Lantern B is not.');
  assert.equal(live.asks[0].label, 'Why is Lantern B not answering?');
  assert.equal(first({ doc, rig: { devices: { lantern_a: { state: 'ready' }, lantern_b: { state: 'ready' } } } }).line, '2 devices: both answering.');
  // untitled: nowhere to write firmware, so it is not offered
  assert.ok(!first({ doc }).asks.some((a) => /firmware/.test(a.label)));

  const imp = applyOps(build([{ op: 'cue.add', cue: { type: 'memo', number: '1' } }]).doc, [{ op: 'show.set', path: 'settings.network.patches', value: [{ id: 'eos', name: 'Eos', host: '10.0.0.20', port: 8000, protocol: 'udp', device: 'etc-eos' }] }]).doc;
  const i = first({ doc: imp, imported: { issues: [{ why: 'x' }, { why: 'y' }] } });
  assert.equal(i.state, 'imported');
  assert.equal(i.line, 'Imported from QLab: 1 cue, 1 network patch, 2 things did not come across.');
  assert.deepEqual(i.asks.map((a) => a.label), ['What did not come across?', 'Check the show for problems', 'Make “Eos” a device']);
  assert.equal(i.next.label, '');
});

test('the first screen with no model: only what the helper can do, and five true rows for choosing who answers (the Endless Cues assistant first)', () => {
  const doc = show.newShow('T');
  const f = starters.first({ doc, showDir: '/x', folder: listing(['a.wav', 'b.wav', 'notes.txt']), provider: 'off', installed: { 'claude-code': true, codex: true } });
  assert.equal(f.state, 'no-model');
  assert.equal(f.under, 'folder');
  assert.equal(f.line, '2 sounds and 1 text file not in a cue yet.');
  assert.deepEqual(f.asks.map((a) => a.label), ['Make cues from these 2 sounds'], 'reading the notes needs a model: not offered');
  assert.equal(f.next.label, '', 'nobody answers yet: there is nobody to tell');
  assert.deepEqual(f.setup.rows.map((r) => [r.id, r.set, r.open]), [['cloud', 'cloud', null], ['claude-code', 'claude-code', null], ['key', null, 'anthropic'], ['local', null, 'ollama'], ['helper', 'demo', null]]);
  assert.deepEqual(f.setup.rows.map((r) => `${r.label} · ${r.says}`), ['Endless Cues assistant · free during the beta', 'Claude Code · uses your Claude plan', 'Your own key · Anthropic, OpenAI…', 'Ollama · free, on this computer', 'Built-in helper · no model, a few jobs']);
  for (const r of f.setup.rows) assert.ok(r.says.split(/\s+/).length <= 5 && !/[()]/.test(r.says), `${r.label}: at most five words, no parentheses`);
  assert.equal(f.setup.foot, '', 'no foot line');
  // Codex takes the second place when it alone is found; neither found, there are four rows and no claim that one was
  assert.equal(starters.setupRows({ codex: true }).rows[1].id, 'codex');
  assert.deepEqual(starters.setupRows({}).rows.map((r) => r.id), ['cloud', 'key', 'local', 'helper']);
  // the helper answering: its own asks only, and it says what it is
  const h = starters.first({ doc, showDir: '/x', folder: listing(['a.wav', 'notes.txt']), provider: 'demo' });
  assert.equal(h.state, 'folder');
  assert.equal(h.helper, true);
  assert.deepEqual(h.asks.map((a) => a.offline), [true]);
  assert.equal(h.note, undefined, 'the drawer’s header says who answers');
  assert.equal(h.next.label, '', 'with sounds waiting, the ask above is the step');
  const hc = starters.first({ doc: { ...doc, lists: [{ ...doc.lists[0], cues: [{ id: 'c1', type: 'memo', name: 'x' }] }] }, showDir: '/x', folder: [], provider: 'demo' });
  assert.equal(hc.next.label, 'Next: ask me to “look for props”.', 'the next rung, in words the helper takes');
});
