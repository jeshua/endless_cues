/**
 * The conversation sent to a model is append-only: no message is changed once it has been sent, on any provider's
 * path. Prompt caching depends on it everywhere, and Anthropic's current models can refuse a request whose earlier
 * messages were edited (core/assistant/history.js says more). The show still travels with every question: whole the
 * first time, then as what changed, and what the model is told adds up to the show as it is.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAssistant, sdkProvider, compatibleProvider, cloudProvider, cliProvider } = require('../core/assistant/assistant');
const { outline } = require('../core/assistant/tools');
const history = require('../core/assistant/history');
const { ShowDocument } = require('../core/show/document');
const { build } = require('./helpers');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const showOf = (n = 30) => {
  const ops = [];
  for (let i = 1; i <= n; i++) ops.push({ op: 'cue.add', cue: i % 10 === 0
    ? { type: 'group', number: String(i), name: `Scene ${i / 10}`, children: [{ type: 'audio', name: `Bed ${i}`, file: `media/bed-${i}.wav`, gainDb: -8 }] }
    : { type: 'audio', number: String(i), name: `Sound ${i}`, file: `media/sound-${i}.wav`, gainDb: -3 } });
  return new ShowDocument({ doc: build(ops).doc });
};

// ── the diff itself ───────────────────────────────────────────────────────────────────────────────────────────

test('a diff of two outlines, applied to the first, gives the second: edits anywhere, lines that repeat, nothing changed', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const lines = Array.from({ length: 40 }, (_, i) => `  - #${i} Audio: Sound ${i}`);
  for (let round = 0; round < 300; round++) {
    const a = lines.slice(0, 5 + rnd(35));
    if (rnd(3) === 0) a.push('  (empty)', '  (empty)');      // a line that is not unique
    const b = a.slice();
    for (let k = rnd(4) + 1; k > 0; k--) {
      const at = rnd(b.length + 1);
      const what = rnd(3);
      if (what === 0) b.splice(at, 0, `  - #new${round}.${k} Memo: added`);
      else if (what === 1 && b.length) b.splice(Math.min(at, b.length - 1), 1);
      else if (b.length) b[Math.min(at, b.length - 1)] += ' gainDb=-9';
    }
    const A = a.join('\n'), B = b.join('\n');
    const d = history.diffLines(A, B);
    assert.equal(history.applyDiff(A, d), B, `round ${round}:\n${d}`);
    if (A === B) assert.equal(d, '');
  }
  assert.equal(history.diffLines('x\ny', 'x\ny'), '');
});

test('what a question says of the show: the outline the first time, a line when nothing changed, a diff when a little did, the outline again when much did', () => {
  const d = showOf(30);
  const one = outline(d.doc);
  const first = history.note(null, one);
  assert.match(first.text, /^<show_outline>\n[\s\S]*#29 Audio: Sound 29[\s\S]*<\/show_outline>$/);
  const same = history.note(first.state, one);
  assert.equal(same.text, '<show_unchanged>The show is as last sent.</show_unchanged>');
  d.edit([{ op: 'cue.set', id: '#7', props: { gainDb: -12 } }]);
  const two = outline(d.doc);
  const small = history.note(same.state, two);
  assert.match(small.text, /^<show_changes>/);
  assert.match(small.text, /^- {2}- #7 Audio: Sound 7 .*gainDb=-3$/m);
  assert.match(small.text, /^\+ {2}- #7 Audio: Sound 7 .*gainDb=-12$/m);
  assert.ok(small.text.length < 400, small.text);
  // most of the show changed: the diff would be no shorter, so the outline goes again
  d.edit(Array.from({ length: 30 }, (_, i) => ({ op: 'cue.set', id: `#${i + 1}`, props: { name: `Renamed ${i + 1}` } })));
  const big = history.note(small.state, outline(d.doc));
  assert.match(big.text, /^<show_outline>/);
  // small changes that add up to most of an outline: the outline again, so the model never adds up a long chain
  let st = history.note(null, one).state, whole = 0;
  for (let i = 0; i < 40; i++) {
    const lines = st.outline.split('\n'); lines.push(`  - #extra${i} Memo: a memo added at the end of the list ${'x'.repeat(40)}`);
    const n = history.note(st, lines.join('\n'));
    if (n.text.startsWith('<show_outline>')) whole++;
    st = n.state;
  }
  assert.ok(whole >= 1 && whole <= 6, `${whole} whole outlines in 40 small changes`);
});

// ── every provider: what was sent is never changed ──────────────────────────────────────────────────────────

const use = (id, name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '', signature: `sig-${id}` }, { type: 'tool_use', id, name, input }] });
const say = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: `sig-${text.length}` }, { type: 'text', text }] });
const FAIL = 'fail';

/**
 * Six questions: a look, a change accepted, a turn that fails half-way, a change left waiting, a follow-up on it,
 * a plain question. `wire` is the provider under test, built around `answer(i)` (the i-th reply, or FAIL), and gives
 * back what it put on the wire for each request as { messages, system, tools, body }.
 */
async function conversation(makeProvider) {
  const replies = [
    use('a1', 'find_cues', { text: 'sound' }), say('There are 30 cues.'),
    use('b1', 'propose_changes', { summary: 'Cue 7 quieter', ops: [{ op: 'cue.set', id: '#7', props: { gainDb: -12 } }] }), say('Cue 7 is quieter.'),
    use('c1', 'read_show', {}), FAIL,
    use('d1', 'propose_changes', { summary: 'Fade after 9', ops: [{ op: 'cue.add', after: '#9', cue: { type: 'fade', number: '9.5', target: '#9', duration: 3, stopTarget: true } }] }), say('9.5 fades 9 out.'),
    use('e1', 'propose_changes', { summary: 'Fade after 9, over 5 s', ops: [{ op: 'cue.set', id: '#9.5', props: { duration: 5 } }] }), say('Five seconds.'),
    say('Cue 1 plays first.'),
  ];
  let n = 0;
  const sent = [];
  const provider = makeProvider({ answer: () => replies[n++], record: (r) => sent.push(r) });
  const d = showOf(30);
  const a = createAssistant({ provider });
  const asks = [['how many cues?', false], ['make cue 7 quieter', true], ['and read it again', false], ['fade 9 out after it', false], ['make it 5 seconds', false], ['what plays first?', false]];
  const turns = [];
  for (const [text, accept] of asks) {
    const from = sent.length;
    const r = await a.ask(text, { document: d });
    turns.push({ from, to: sent.length, failed: !!r.error });
    if (accept && d.proposal) d.accept(d.proposal.id);
  }
  assert.deepEqual(turns.map((t) => t.failed), [false, false, true, false, false, false], 'only the third turn fails');
  return { sent, turns, d, a };
}

/** Every request sent in a turn that did not fail is, message for message, the start of every request after it. */
function assertAppendOnly({ sent, turns }) {
  const failed = new Set(); for (const t of turns) if (t.failed) for (let i = t.from; i < t.to; i++) failed.add(i);
  assert.ok(sent.length >= 10);
  for (let i = 0; i < sent.length; i++) {
    assert.deepEqual(sent[i].system, sent[0].system, `request ${i}: the same instructions`);
    assert.deepEqual(sent[i].tools, sent[0].tools, `request ${i}: the same tools`);
    if (failed.has(i)) continue;
    for (let j = i + 1; j < sent.length; j++) {
      assert.ok(sent[j].messages.length > sent[i].messages.length, `request ${j} is longer than ${i}`);
      assert.deepEqual(sent[j].messages.slice(0, sent[i].messages.length), sent[i].messages, `request ${j} begins with request ${i}, unchanged`);
    }
  }
}

test('the conversation as the app keeps it: never changed, and what it says of the show adds up to the show', async () => {
  const run = await conversation(({ answer, record }) => ({ name: 'scripted', async create(req) {
    record({ messages: JSON.parse(JSON.stringify(req.messages)), system: req.system, tools: req.tools });
    const r = answer(); if (r === FAIL) throw new Error('network down'); return JSON.parse(JSON.stringify(r));
  } }));
  assertAppendOnly(run);
  // the questions, in order: the outline once, then changes; together they are the show as the last question saw it
  const last = run.sent.at(-1).messages;
  const notes = last.filter((m) => m.role === 'user' && m.content[0].type === 'text').map((m) => m.content[0].text.replace(/\n<waiting_for_review>[\s\S]*$/, ''));
  assert.equal(notes.length, 5, 'five questions kept (the failed one went)');
  assert.match(notes[0], /^<show_outline>/);
  assert.equal(notes.filter((t) => t.startsWith('<show_outline>')).length, 1, 'the outline is sent whole once');
  let have = '';
  for (const t of notes) {
    if (t.startsWith('<show_outline>')) have = t.replace(/^<show_outline>\n/, '').replace(/\n<\/show_outline>$/, '');
    else if (t.startsWith('<show_changes>')) have = history.applyDiff(have, t.replace(/^<show_changes>[^\n]*\n/, '').replace(/\n<\/show_changes>$/, ''));
    else assert.match(t, /^<show_unchanged>/);
  }
  // the last question was asked with a change waiting: the outline it carries is the show with that change in it
  const waiting = run.d.proposal;
  assert.ok(waiting, 'the fade is still waiting for review');
  assert.equal(have, outline(waiting.doc));
  // what five questions said of the show is one outline and a few short lines for each question after it
  const weight = notes.reduce((n, t) => n + t.length, 0);
  assert.ok(weight < outline(waiting.doc).length + 4 * 250, `${weight} characters of notes for an outline of ${outline(waiting.doc).length}`);
  assert.match(notes[4], /^<show_changes>[\s\S]*\+ {2}- #9\.5 Fade/m, 'the waiting fade arrived as a change');
});

test('your own Anthropic key: the requests on the wire are append-only, the thinking goes back as it came, and the conversation is cached', async () => {
  const run = await conversation(({ answer, record }) => sdkProvider('anthropic', {
    apiKey: 'test-key', maxRetries: 0,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      record({ messages: body.messages, system: body.system, tools: body.tools, body });
      const r = answer();
      if (r === FAIL) return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }), { status: 500, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: r.content, stop_reason: r.stop_reason, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  }));
  assertAppendOnly(run);
  const body = run.sent.at(-1).body;
  assert.deepEqual(body.cache_control, { type: 'ephemeral' }, 'the conversation is cached, not only the instructions');
  assert.equal(body.system[0].cache_control.type, 'ephemeral');
  const thinking = body.messages.filter((m) => m.role === 'assistant').flatMap((m) => m.content).filter((b) => b.type === 'thinking');
  assert.ok(thinking.length >= 6 && thinking.every((b) => b.thinking === '' && /^sig-/.test(b.signature)), 'every thinking block, empty ones too, sent back');
});

test('OpenAI-compatible services and the Endless Cues assistant: the chat messages on the wire are append-only, ec_state included', async () => {
  const chatReply = (r, i) => {
    const calls = r.content.filter((b) => b.type === 'tool_use');
    const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { choices: [{ finish_reason: calls.length ? 'tool_calls' : 'stop', message: { role: 'assistant', content: text || null,
      ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}),
      ec_state: JSON.stringify({ m: 'm', items: [{ type: 'reasoning', encrypted_content: `enc-${i}` }] }) } }] };
  };
  const fake = ({ answer, record }) => {
    let i = 0;
    return async (url, init) => {
      const body = JSON.parse(init.body);
      record({ messages: body.messages, system: body.messages[0], tools: body.tools, body, headers: init.headers });
      const r = answer(); i++;
      if (r === FAIL) return new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 });
      return new Response(JSON.stringify(chatReply(r, i)), { status: 200, headers: { 'x-ec-tier': 'allowance', 'x-ec-used': '3' } });
    };
  };
  const open = await conversation((io) => compatibleProvider('openai', { apiKey: 'k', model: 'gpt-test', fetchImpl: fake(io) }));
  assertAppendOnly(open);
  const hosted = await conversation((io) => cloudProvider({ token: 't', version: '1.0.0', fetchImpl: fake(io) }));
  assertAppendOnly(hosted);
  const states = hosted.sent.at(-1).messages.filter((m) => m.role === 'assistant').map((m) => m.ec_state);
  assert.ok(states.length >= 6 && states.every((s) => /enc-\d+/.test(s)), 'the service’s reasoning goes back as it came');
  // each user message is one string: the note on the show, then the question (as the service's Worker reads it)
  const users = hosted.sent.at(-1).messages.filter((m) => m.role === 'user');
  assert.ok(users.every((m) => typeof m.content === 'string'));
  assert.match(users[0].content, /^<show_outline>[\s\S]*\n\nhow many cues\?$/);
  assert.match(users[1].content, /^<show_unchanged>.*\n\nmake cue 7 quieter$/);
});

test('Claude Code and Codex keep their own conversation: each question carries the whole outline, and Claude Code resumes its session', async () => {
  const d = showOf(12);
  const started = [];
  const spawn = (file, args, opts) => {
    started.push(args);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    setTimeout(() => { child.stdout.end(JSON.stringify({ type: 'result', is_error: false, result: 'Done.', session_id: 'sess-1' }) + '\n'); child.emit('close', 0); }, 2);
    return child;
  };
  const a = createAssistant({ provider: cliProvider('claude-code', { spawn, find: () => '/bin/claude', mcpServer: () => ({ command: 'node', args: [] }) }) });
  await a.ask('how many cues?', { document: d });
  await a.ask('and now?', { document: d });
  const arg = (args, name) => args[args.indexOf(name) + 1];
  assert.ok(!started[0].includes('--resume'));
  assert.equal(arg(started[1], '--resume'), 'sess-1', 'the follow-up continues the session Claude Code keeps (and keeps append-only itself)');
  for (const args of started) assert.match(arg(args, '-p'), /^<show_outline>\n[\s\S]*#11 Audio: Sound 11[\s\S]*<\/show_outline>/);
  // Codex keeps nothing between questions (no session to resume): each prompt is whole on its own
  const prompts = [];
  const codexSpawn = (file, args) => {
    prompts.push(args.at(-1));
    require('fs').writeFileSync(args[args.indexOf('-o') + 1], 'Done.');
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    setTimeout(() => { child.stdout.end(''); child.emit('close', 0); }, 2);
    return child;
  };
  const c = createAssistant({ provider: cliProvider('codex', { spawn: codexSpawn, find: () => '/bin/codex', mcpServer: () => ({ command: 'node', args: [] }) }) });
  await c.ask('how many cues?', { document: d });
  await c.ask('and now?', { document: d });
  assert.equal(prompts.length, 2);
  for (const p of prompts) assert.match(p, /<show_outline>\n[\s\S]*#11 Audio: Sound 11[\s\S]*<\/show_outline>/);
});
