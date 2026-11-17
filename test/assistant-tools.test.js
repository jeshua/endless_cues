/**
 * The assistant's tools against the things a sound designer asks for, and the ways a model gets them wrong:
 * what it is told about cues (generated from the cue-type table), what an edit refuses and why, what happens
 * when the person edits the show while the agent works, and how much of a long show is sent.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAssistant } = require('../core/assistant/assistant');
const { TOOLS, SYSTEM, reference, lookup, outline, execute, LONG_SHOW, OP_KEYS } = require('../core/assistant/tools');
const { TYPES, TYPE_ORDER, COMMON } = require('../core/show/cue-types');
const show = require('../core/show/show');
const { ShowDocument } = require('../core/show/document');
const { build } = require('./helpers');

const doc = () => new ShowDocument({ doc: build([
  { op: 'cue.add', cue: { type: 'audio', number: '1', name: 'Walk-in A', file: 'media/a.wav', bus: 'music' } },
  { op: 'cue.add', cue: { type: 'audio', number: '2', name: 'Walk-in B', file: 'media/b.wav', bus: 'music' } },
  { op: 'cue.add', cue: { type: 'audio', number: '4', name: 'Rain', file: 'media/rain.wav', loop: true } },
  { op: 'cue.add', cue: { type: 'memo', number: '7', name: 'Places' } },
  { op: 'cue.add', cue: { type: 'audio', number: '12', name: 'Vamp', file: 'media/vamp.wav', bus: 'music' } },
  { op: 'cue.add', cue: { type: 'memo', number: '13', name: 'Act two' } },
  { op: 'cue.add', cue: { type: 'memo', number: '14', name: 'Storm' } },
]).doc });
const session = (d = doc()) => { const ctx = { document: d, draft: null }; return { d, ctx, run: (name, input) => execute(name, input, ctx), edit: (ops) => execute('edit_show', { ops }, ctx) }; };
const cueNumbered = (document, n) => show.findByNumber(document, n);

function scripted(replies) {
  const seen = [];
  return { name: 'scripted', seen, async create(req) { seen.push(JSON.parse(JSON.stringify(req.messages))); const r = replies.shift(); if (typeof r === 'function') return r(); return r; } };
}
const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
const say = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

test('the reference is the cue-type table: every type and field in brief, each in full through read_reference, and a field added to the table is in both', () => {
  const ref = reference();
  for (const t of TYPE_ORDER) {
    // the brief names every type and every field it has
    assert.match(ref, new RegExp(`^${t}( \\(${TYPES[t].label}\\))? — `, 'm'), `type ${t}`);
    for (const f of TYPES[t].fields) if (!f.hidden) assert.match(ref.split('\n').find((l) => l.startsWith(`${t} `)), new RegExp(`[ ;]${f.key}([*: =(;]|$)`), `${t}.${f.key} in brief`);
    // and read_reference has each in full: its kind, its options, its help
    const full = lookup(t).text;
    assert.ok(full.startsWith(`${t} — ${TYPES[t].label}:`), `type ${t} in full`);
    for (const f of TYPES[t].fields) if (!f.hidden) assert.ok(new RegExp(`^    ${f.key} \\(${f.kind}`, 'm').test(full), `${t}.${f.key} in full`);
  }
  for (const f of COMMON) if (!f.hidden) assert.ok(ref.split('\n').find((l) => l.startsWith('Every cue:')).includes(f.key), `common ${f.key} in brief`);
  for (const f of COMMON) assert.ok(new RegExp(`^    ${f.key} \\(`, 'm').test(lookup('every').text), `common ${f.key} in full`);
  // the ones a hand-copied reference would not know: they are in because the table has them
  for (const word of ['midi — ', 'midifile (MIDI File) — ', 'music (Jump) — ', 'mic — ', 'mode:timeline|playlist|enter', 'shuffle:bool(mode playlist)', 'crossfade:s(mode playlist)', 'plays:number=1', 'fps:24|25|29.97df|30=30']) assert.ok(ref.includes(word), word);
  for (const [about, word] of [['group', 'shuffle (bool, default false, only when mode is playlist)'], ['audio', 'loops (regions'], ['every', 'hotkey (text)'], ['every', 'midiTrigger (text)'], ['group', 'enter (“Start first and enter”)'], ['timecode', '29.97df (“29.97 drop”)']]) assert.ok(lookup(about).text.includes(word), `${about}: ${word}`);
  for (const op of Object.keys(OP_KEYS)) assert.ok(ref.includes(`"op": "${op}"`), op);
  // settings come from the show's own defaults, so a new one is known the day it exists: read_reference has every path
  for (const p of ['settings.midi.output', 'settings.midi.mscIn', 'settings.go.panicFade', 'modules.lighting-desk.enabled', 'out (routing', 'settings.light.instruments']) assert.ok(lookup('settings').text.includes(p), p);
  assert.ok(lookup('settings').text.includes('settings.audio.duck.key="vocals"'), 'a duck\'s key is a bus, not a secret');
  TYPES.memo.fields.push({ key: 'madeUpToday', kind: 'text', label: 'Made up', help: 'A field that did not exist this morning.' });
  try {
    assert.match(reference(), /^memo — .*madeUpToday/m);
    assert.match(lookup('memo').text, /madeUpToday \(text\) — A field that did not exist this morning\./);
  } finally { TYPES.memo.fields.pop(); }
  // "all" is the old whole reference; an unknown name says what can be read
  assert.ok(lookup('all').text.includes('MODELS (what a device is started from'));
  assert.equal(lookup('timecode, x32').ok, true);
  assert.match(lookup('timecode, x32').text, /fps \(enum[\s\S]*mutegroup — Mute group/);
  const nope = lookup('wobble');
  assert.equal(nope.ok, false);
  assert.match(nope.text, /Nothing called “wobble”\. What can be read: a cue type \(group, audio/);
  // the instructions do not carry a copy of the field list that could go stale
  for (const key of ['oscTrigger', 'midiTrigger', 'doubleGoProtection']) assert.ok(!SYSTEM.includes(key), `${key} is hand-copied into the instructions`);
});

test('read_reference is a tool that looks: it answers from the tables and touches nothing', () => {
  const d = doc();
  const ctx = { document: d, draft: null };
  const r = execute('read_reference', { about: 'midifile' }, ctx);
  assert.ok(!r.is_error);
  assert.match(r.content, /^midifile — MIDI File: /);
  assert.equal(ctx.draft, null);
  assert.equal(execute('read_reference', { about: 'nothing-at-all' }, ctx).is_error, true);
  assert.ok(TOOLS.findIndex((t) => t.name === 'read_reference') < TOOLS.findIndex((t) => t.name === 'propose_changes'));
});

test('there is no tool that plays, stops or saves, and no tool touches the running engine', () => {
  for (const t of TOOLS) assert.doesNotMatch(t.name, /play|go|fire|stop|panic|save|accept|undo/);
  // an engine that allows reading what is known (lengths, the playhead) and nothing else
  const touched = [];
  const engine = new Proxy({ durations: new Map([['media/a.wav', 10]]), running: new Map(), playhead: null }, {
    get(target, key) { if (!(key in target)) touched.push(String(key)); return target[key]; },
    set(target, key) { touched.push(`set ${String(key)}`); return true; },
  });
  const d = doc();
  const ctx = { document: d, engine, draft: null };
  const before = show.hash(d.doc);
  for (const [name, input] of [['read_show', {}], ['read_show', { cue: '#1' }], ['read_show', { from: '#1' }], ['find_cues', { text: 'rain' }], ['list_media', {}],
    ['edit_show', { ops: [{ op: 'cue.set', id: '#1', props: { gainDb: -3 } }] }], ['check_show', {}], ['simulate', { from: '#1', gos: 3 }], ['propose_changes', { summary: 'x' }]]) {
    assert.ok(!execute(name, input, ctx).is_error, name);
  }
  assert.deepEqual(touched, []);
  assert.equal(show.hash(d.doc), before, 'and the show itself is as it was: a proposal is not an edit');
  assert.equal(execute('go', {}, ctx).is_error, true);
});

test('what a designer asks for can be said in operations, and reads back in the outline', () => {
  const { ctx, edit, run } = session();
  const ok = (r) => { assert.ok(!r.is_error, r.content); return r.content; };
  ok(edit([{ op: 'cue.add', after: '#4', cue: { type: 'fade', number: '4.5', target: '#4', db: -60, duration: 3, stopTarget: true } }]));
  ok(edit([{ op: 'cue.set', id: '#12', props: { continue: 'auto-follow', loops: [{ start: 10, end: 20, name: 'vamp', count: 4 }] } }]));
  ok(edit([{ op: 'cue.renumber', ids: ['#13', '#14'], start: 20 }]));
  ok(edit([{ op: 'cue.add', ref: 'g', before: '#1', cue: { type: 'group', number: '0', name: 'Walk-in', mode: 'playlist', shuffle: true, crossfade: 3 } }, { op: 'cue.move', ids: ['#1', '#2'], parent: '@g' }]));
  ok(edit([{ op: 'cue.add', cue: { type: 'midi', number: '30', midi: 'pc 12' } }, { op: 'cue.add', cue: { type: 'mic', number: '40', bus: 'vocals' } }]));
  ok(edit([{ op: 'cue.set', id: '#7', props: { hotkey: 'F5', midiTrigger: 'note 60', oscTrigger: '/sm/places', color: 'red' } }]));
  // routing is a bus setting, and a bus is named by its id
  ok(edit([{ op: 'show.set', path: 'settings.audio.buses.music.out', value: 3 }, { op: 'show.set', path: 'settings.midi.output', value: 'IAC Driver' }, { op: 'show.set', path: 'modules.osc-control.passcode', value: 'hunter2' }]));
  assert.equal(ctx.draft.settings.audio.buses[0].out, 3);
  assert.match(ok(run('check_show', {})), /Nothing wrong/);
  const text = ok(run('read_show', {}));
  assert.match(text, /#0 Group: Walk-in · mode=playlist shuffle=true crossfade=3s/);
  assert.match(text, /#12 Audio: Vamp · .*loops:\[\{"start":10,"end":20,"name":"vamp","count":4\}\] auto-follow/);
  assert.match(text, /#7 Memo: Places · color=red oscTrigger=\/sm\/places hotkey=F5 midiTrigger=note 60/);
  assert.match(text, /#30 MIDI: MIDI pc 12 · midi=pc 12/);
  assert.match(text, /#40 Mic: Mic · bus=vocals/);
  assert.match(text, /Buses: music \(Music, 0 dB, outputs 3–4[^)]*\)/);
  assert.match(text, /midi\.output="IAC Driver"/);
  assert.match(text, /Modules: osc-control off \(passcode=\(set\)\); show-feedback off/, 'a module\'s options as a new show has them are left out');
  assert.ok(!text.includes('hunter2'), 'a passcode is not sent to a model');
  assert.match(ok(run('find_cues', { text: 'f5' })), /1 cue:\n.*#7 Memo: Places/);
  assert.match(ok(run('find_cues', { type: 'audio', text: 'music' })), /3 cues:[\s\S]*bus=music/);
  assert.match(run('find_cues', { type: 'sound' }).content, /no cue type “sound”.*audio/);
});

test('an operation that would do nothing, or something else, is refused with what to send instead', () => {
  const { ctx, edit } = session();
  const refused = (ops, why) => { const r = edit(ops); assert.equal(r.is_error, true, JSON.stringify(ops)); assert.match(r.content, /^Refused, nothing applied\./); assert.match(r.content, why); };
  refused([{ op: 'cue.set', id: '#12', gainDb: -3 }], /“gainDb” is not something a cue\.set takes \(it takes: id, props\)/);
  refused([{ op: 'cue.set', id: '#12' }], /"props" is required/);
  refused([{ op: 'cue.move', ids: ['#12'], to: '#1' }], /“to” is not something a cue\.move takes/);
  refused([{ op: 'cue.move', ids: ['#12'] }], /say where to/);
  refused([{ op: 'cue.add', cue: { type: 'memo' }, after: '#1', parent: '#2' }], /say where once/);
  refused([{ op: 'cue.renumber', start: 20 }], /"ids" is required/);
  refused([{ op: 'cue.rename', id: '#1', name: 'x' }], /unknown operation \(the operations are cue\.add/);
  refused([{ op: 'cue.add', cue: { type: 'fade', target: '@nowhere' } }], /"@ref" names work only inside the batch/);
  refused([{ op: 'cue.set', id: '#12', props: { level: -3 } }], /no field “level” \(it has: .*gainDb/);
  // a batch lands whole or not at all: the good first operation of a bad batch is not in the draft
  refused([{ op: 'cue.set', id: '#12', props: { name: 'Changed' } }, { op: 'cue.set', id: '#99', props: { name: 'x' } }], /op 2 \(cue\.set\): no cue numbered 99/);
  refused([{ op: 'cue.set', id: '#12', props: { name: 'Changed' } }, { op: 'cue.move', ids: ['#1'], to: 'top' }], /op 2/);
  assert.equal(ctx.draft, null, 'nothing of any refused batch reached the draft');
  const same = edit([{ op: 'cue.set', id: '#12', props: { name: 'Vamp' } }]);
  assert.match(same.content, /changed nothing/);
});

test('a setting of the wrong kind is refused, not written into the show', () => {
  const { ctx, edit } = session();
  const refused = (ops, why) => { const r = edit(ops); assert.equal(r.is_error, true, JSON.stringify(ops)); assert.match(r.content, why); };
  refused([{ op: 'show.set', path: 'settings.go.panicFade', value: 'fast' }], /settings\.go\.panicFade is a number \(it was given "fast"\)/);
  refused([{ op: 'show.set', path: 'settings.audio.buses.7.out', value: 3 }], /no bus at 7 \(3 in the show: music, effects, vocals\)/);
  refused([{ op: 'show.set', path: 'settings.audio.buses.foh.out', value: 3 }], /no bus with the id “foh”/);
  refused([{ op: 'show.set', path: 'settings.audio.buses.music.out', value: 2 }], /out is the first of a pair of outputs: 1, 3, 5/);
  refused([{ op: 'show.set', path: 'settings.audio.buses', value: 'music' }], /is a list/);
  refused([{ op: 'show.set', path: 'settings.audio.buses', value: [{ id: 'a', name: 'A', db: 0 }, { name: 'No id' }] }], /a bus needs an "id"/);
  refused([{ op: 'show.set', path: 'settings.audio', value: null }], /unreadable|cannot be replaced/);
  refused([{ op: 'show.set', path: 'settings.network.patches', value: [{ name: 'Desk', host: '10.0.0.5' }] }], /a patch needs an "id"/);
  refused([{ op: 'show.set', path: 'modules.osc-control.enabled', value: 'yes' }], /true or false/);
  refused([{ op: 'show.set', path: 'settings.go.panicFade' }], /"value" is required/);
  assert.equal(ctx.draft, null);
  const r = edit([{ op: 'show.set', path: 'settings.audio.buses', value: [...ctx.document.doc.settings.audio.buses, { id: 'foh', name: 'Front of house', db: 0, out: 3 }] },
    { op: 'show.set', path: 'settings.network.patches', value: [{ id: 'desk', name: 'Desk', host: '10.0.0.5', port: 8000 }] }, { op: 'cue.add', cue: { type: 'network', patch: 'desk', message: '/eos/cue/1/1/fire' } }]);
  assert.ok(!r.is_error, r.content);
  assert.doesNotMatch(r.content, /problem/);
});

test('an edit says what it has broken, so the model need not think to ask', () => {
  const { edit, run } = session();
  assert.match(edit([{ op: 'cue.add', ref: 'f', cue: { type: 'fade', number: '5', target: '#7' } }]).content, /1 added[\s\S]*1 new problem[\s\S]*targets a Memo cue; needs Audio or Mic or Group/);
  assert.match(edit([{ op: 'cue.add', cue: { type: 'midi', midi: 'program change 12' } }]).content, /new problem[\s\S]*its MIDI message is not one/);
  assert.match(edit([{ op: 'cue.add', cue: { type: 'mic', bus: 'vox' } }]).content, /no bus “vox”: plays on/);
  const hot = edit([{ op: 'cue.set', id: '#7', props: { hotkey: 'ctrl+space' } }]).content;
  assert.match(hot, /1 new problem[\s\S]*hotkey/);
  assert.doesNotMatch(hot, /Memo cue; needs/, 'only what this batch broke, not what was already wrong');
  assert.doesNotMatch(edit([{ op: 'cue.set', id: '#5', props: { target: '#4' } }]).content, /problem/);
  assert.match(edit([{ op: 'cue.remove', id: '#4' }]).content, /1 removed[\s\S]*#5 .*its target is gone/);
  const p = run('propose_changes', { summary: 'A mess' });
  assert.match(p.content, /Handed over for review[\s\S]*4 problems the show did not have/);
});

test('the person edits the show while the agent works: the draft follows, and their edit is not undone', () => {
  const { d, ctx, edit, run } = session();
  const made = edit([{ op: 'cue.add', after: '#4', cue: { type: 'fade', number: '4.5', target: '#4', duration: 3, stopTarget: true } }]);
  const fadeId = /\[(c_[0-9a-f]+)\] #4\.5/.exec(made.content)[1];
  edit([{ op: 'cue.set', id: fadeId, props: { name: 'Rain out' } }]);          // a later batch names the new cue by the id it was given
  d.edit([{ op: 'cue.set', id: '#1', props: { gainDb: -20 } }]);               // meanwhile, the person rides a level
  const r = run('propose_changes', { summary: 'Fade the rain out', ops: [{ op: 'cue.set', id: '#4.5', props: { duration: 5 } }] });
  assert.ok(!r.is_error, r.content);
  assert.match(r.content, /^NOTE: the person changed the show while you were working/);
  assert.match(r.content, new RegExp(`${fadeId} is now c_`), 'the model is told the new id of the cue it added');
  assert.deepEqual(d.proposal.changes.map((c) => `${c.kind} ${c.label}`), ['added 4.5 Rain out'], 'the review shows the assistant’s change and only that');
  d.accept(d.proposal.id);
  assert.equal(cueNumbered(d.doc, '1').gainDb, -20, 'the level the person set is still theirs');
  assert.deepEqual([cueNumbered(d.doc, '4.5').name, cueNumbered(d.doc, '4.5').duration], ['Rain out', 5]);
  // undo takes the proposal back in one step and leaves the person's own edit
  d.undo();
  assert.equal(cueNumbered(d.doc, '4.5'), null);
  assert.equal(cueNumbered(d.doc, '1').gainDb, -20);
});

test('a draft that no longer fits the show is dropped, said so, and never half-proposed', () => {
  const { d, ctx, edit, run } = session();
  edit([{ op: 'cue.set', id: '#14', props: { name: 'Storm, louder', notes: 'x' } }]);
  d.edit([{ op: 'cue.remove', id: '#14' }]);                                    // the person deletes the cue the draft was about
  const r = run('propose_changes', { summary: 'Storm', ops: [{ op: 'cue.set', id: '#1', props: { name: 'A' } }] });
  assert.equal(r.is_error, true);
  assert.match(r.content, /your edits no longer fit it \(.*no cue numbered 14\), so your draft was thrown away[\s\S]*Nothing was handed over/);
  assert.equal(d.proposal, null);
  assert.equal(ctx.draft, null);
  // and the agent can carry on from the show as it is
  assert.ok(!edit([{ op: 'cue.set', id: '#1', props: { name: 'A' } }]).is_error);
  assert.equal(run('propose_changes', { summary: 'Rename' }).proposal, d.proposal.id);
  // an undo that puts the show back exactly as the draft knew it disturbs nothing
  const s2 = session();
  s2.edit([{ op: 'cue.set', id: '#1', props: { name: 'B' } }]);
  s2.d.edit([{ op: 'cue.set', id: '#2', props: { name: 'Nudge' } }]); s2.d.undo();
  assert.doesNotMatch(s2.run('read_show', {}).content, /NOTE/);
});

test('a proposal cannot land on a show that changed after it was made, and an empty one does not displace one that is waiting', () => {
  const { d, run } = session();
  run('propose_changes', { summary: 'Quieter', ops: [{ op: 'cue.set', id: '#1', props: { gainDb: -9 } }] });
  const waiting = d.proposal.id;
  const other = { document: d, draft: null };
  assert.match(execute('propose_changes', { summary: 'Nothing', ops: [{ op: 'cue.set', id: '#2', props: { name: 'Walk-in B' } }] }, other).content, /same as the show/);
  assert.equal(d.proposal.id, waiting, 'the proposal on the screen is still there');
  d.edit([{ op: 'cue.set', id: '#2', props: { name: 'Edited since' } }]);
  assert.throws(() => d.accept(waiting), /the show changed since this was proposed/);
  assert.equal(cueNumbered(d.doc, '1').gainDb, undefined);
});

test('simulate starts from a cue named by number or id, and says why a cue inside a group cannot start one', () => {
  const { d, edit, run } = session();
  edit([{ op: 'cue.add', ref: 'g', before: '#1', cue: { type: 'group', number: '0', name: 'Walk-in' } }, { op: 'cue.move', ids: ['#1', '#2'], parent: '@g' }]);
  assert.match(run('simulate', { from: '#0' }).content, /GO 0 Walk-in[\s\S]*Walk-in A plays[\s\S]*Walk-in B plays/);
  assert.match(run('simulate', { from: cueNumbered(d.doc, '4').id }).content, /GO 4 Rain/);
  assert.match(run('simulate', { from: '4' }).content, /GO 4 Rain/);
  const inside = run('simulate', { from: '#2' });
  assert.equal(inside.is_error, true);
  assert.match(inside.content, /#2 is inside the group #0\..*simulate from "#0"/);
  assert.match(run('simulate', { from: '#99' }).content, /No cue #99/);
});

test('a long show: the outline is the short one, a run of cues can be read in full, and old outlines leave the conversation', async () => {
  const ops = [];
  for (let i = 1; i <= 400; i++) ops.push({ op: 'cue.add', cue: i % 10 === 0
    ? { type: 'group', number: String(i), name: `Scene ${i}`, children: Array.from({ length: 5 }, (_, k) => ({ type: 'audio', name: `Layer ${k}`, file: `media/scene${i}-${k}.wav`, gainDb: -6, notes: 'a note about this layer that runs on for a while' })) }
    : { type: 'audio', number: String(i), name: `Sound ${i}`, file: `media/sound-${i}.wav`, gainDb: -3 } });
  const d = new ShowDocument({ doc: build(ops).doc });
  const cues = show.index(d.doc).byId.size;
  assert.ok(cues > LONG_SHOW);
  const short = outline(d.doc), whole = outline(d.doc, { full: true });
  assert.ok(short.length < whole.length / 3 && short.length < 60 * cues, `${short.length} of ${whole.length}`);
  assert.match(short, /This is a long show \(600 cues\)/);
  assert.match(short, /#10 Group: Scene 10 \(5 inside\)/);
  assert.match(short, /#399 Audio: Sound 399/, 'every top-level cue is still named');
  assert.ok(!short.includes('Layer 3'));
  const ctx = { document: d, draft: null };
  const run = execute('read_show', { from: '#198', count: 4 }, ctx).content;
  assert.match(run, /4 cues from #198 in list "Main" \(199 more after these\)/);
  assert.match(run, /#200 Group: Scene 200\n\s+- \[c_\w+\] Audio: Layer 0 · file=media\/scene200-0\.wav gainDb=-6/);
  assert.ok(!run.includes('Sound 202'));
  assert.match(execute('find_cues', { text: 'sound' }, ctx).content, /360 cues:[\s\S]*… and 280 more: narrow the search/);
  // two questions: the second request carries one outline, not two (the first, as it was sent, and a line saying
  // nothing has changed since)
  const p = scripted([say('It has 600 cues.'), say('Still 600.')]);
  const a = createAssistant({ provider: p });
  await a.ask('how long is it?', { document: d });
  await a.ask('and now?', { document: d });
  const sent = JSON.stringify(p.seen[1]);
  assert.equal(sent.split('This is a long show').length - 1, 1);
  assert.ok(sent.length < short.length * 1.5);
  assert.deepEqual(p.seen[1][0], p.seen[0][0], 'the first question is sent again exactly as it was');
  assert.match(p.seen[1][2].content[0].text, /^<show_unchanged>/);
  assert.equal(p.seen[1][0].content[1].text, 'how long is it?', 'the question itself stays');
});

test('a follow-up while a proposal waits builds on it, and the result carries both', async () => {
  const d = doc();
  const p = scripted([
    { stop_reason: 'tool_use', content: [use('a', 'propose_changes', { summary: 'Fade the rain out after 4', ops: [{ op: 'cue.add', after: '#4', cue: { type: 'fade', number: '4.5', target: '#4', duration: 3, stopTarget: true } }] })] },
    say('Cue 4.5 fades the rain out over 3 seconds.'),
    { stop_reason: 'tool_use', content: [use('b', 'propose_changes', { summary: 'Fade the rain out after 4, over 5 s', ops: [{ op: 'cue.set', id: '#4.5', props: { duration: 5 } }] })] },
    say('Five seconds now.'),
    say('Nothing to do.'),
  ]);
  const a = createAssistant({ provider: p });
  await a.ask('add a 3 second fade out of the rain after cue 4', { document: d });
  const first = d.proposal.id;
  const r = await a.ask('make it 5 seconds', { document: d });
  assert.equal(r.ok, true);
  const asked = p.seen[2].at(-1).content[0].text;
  assert.match(asked, /#4\.5 Fade: fade Rain out/, 'the outline it is given includes the change that is waiting');
  assert.match(asked, /<waiting_for_review>.*“Fade the rain out after 4”/);
  assert.notEqual(d.proposal.id, first);
  assert.deepEqual(d.proposal.changes.map((c) => `${c.kind} ${c.label}`), ['added 4.5 fade Rain out']);
  d.accept(d.proposal.id);
  assert.equal(cueNumbered(d.doc, '4.5').duration, 5);
  // once it is in the show, the next question starts from the show, with nothing said to be waiting
  await a.ask('anything else?', { document: d });
  assert.doesNotMatch(p.seen[4].at(-1).content[0].text, /waiting_for_review/);
});
