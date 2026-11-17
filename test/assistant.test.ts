import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistant, demoProvider } from '../core/assistant/assistant';
import type { Call, Reply, ToolUseBlock } from '../core/assistant/assistant';
import type { Change } from '../core/show/diff';
import { TOOLS, reference, outline, execute } from '../core/assistant/tools';
import type { AtOnce, ToolInput } from '../core/assistant/tools';
import { ShowDocument } from '../core/show/document';
import { build } from './helpers';

const doc = () => new ShowDocument({ doc: build([
  { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', name: 'Rain', file: 'media/rain.wav', gainDb: -6 } },
  { op: 'cue.add', cue: { type: 'fade', number: '2', target: '@a', db: -60, duration: 5, stopTarget: true } },
]).doc });

/** A provider that plays back scripted replies and records what it was sent. */
function scripted(replies: (Omit<Reply, 'role'> | Error)[]) {
  const seen: any[] = [];   // the messages as sent, through JSON
  return { name: 'scripted', seen, async create(req: Call) { seen.push(JSON.parse(JSON.stringify(req.messages))); const r = replies.shift(); if (r instanceof Error) throw r; return r as Reply; } };
}
const use = (id: string, name: string, input: unknown): ToolUseBlock => ({ type: 'tool_use', id, name, input });

test('the tools: a schema for each, and a reference written from the cue-type table', () => {
  for (const name of ['read_show', 'find_cues', 'list_media', 'edit_show', 'check_show', 'simulate', 'propose_changes']) assert.ok(TOOLS.some((t) => t.name === name), name);
  assert.equal(TOOLS.at(-1)!.name, 'propose_changes', 'the finishing tool is the last in the list');
  for (const t of TOOLS) assert.equal(t.input_schema.additionalProperties, false);
  const ref = reference();
  for (const word of ['fade — ', 'stopTarget', 'cue.add', 'show.set', 'auto-follow']) assert.ok(ref.includes(word), word);
});

test('the outline names every cue by id and number, and says what targets what', () => {
  const d = doc();
  const text = outline(d.doc);
  assert.match(text, /#1 Audio: Rain/);
  assert.match(text, /target→#1/);
  assert.match(text, /Buses: music/);
});

test('a proposal that does not apply goes back to the model as an error, and nothing is staged', () => {
  const d = doc();
  const r = execute('propose_changes', { summary: 'x', ops: [{ op: 'cue.set', id: '#9', props: { gainDb: 0 } }] }, { document: d });
  assert.equal(r.is_error, true);
  assert.match(r.content, /no cue numbered 9/);
  assert.equal(d.proposal, null);
  const same = execute('propose_changes', { summary: 'x', ops: [{ op: 'cue.set', id: '#1', props: { gainDb: -6 } }] }, { document: d });
  assert.match(same.content, /same as the show/);
});

test('a turn: the model reads, corrects itself after an error, stages a proposal, and replies', async () => {
  const d = doc();
  const p = scripted([
    { stop_reason: 'tool_use', content: [use('t1', 'read_show', {})] },
    { stop_reason: 'tool_use', content: [use('t2', 'propose_changes', { summary: 'Quieter rain', ops: [{ op: 'cue.set', id: '#1', props: { level: -12 } }] })] },
    { stop_reason: 'tool_use', content: [use('t3', 'propose_changes', { summary: 'Quieter rain', ops: [{ op: 'cue.set', id: '#1', props: { gainDb: -12 } }] })] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Rain is down to −12 dB. Listen for whether the bell still reads over it.' }] },
  ]);
  const a = createAssistant({ provider: p });
  const r = await a.ask('make the rain quieter', { document: d });
  assert.equal(r.ok, true);
  assert.equal(d.proposal!.summary, 'Quieter rain');
  assert.equal(d.doc.lists[0].cues[0].gainDb, -6, 'the show itself is untouched');
  // the first request carried the show's outline with the question
  assert.match(p.seen[0][0].content[0].text, /<show_outline>/);
  // the failed call's error was returned to the model as a tool_result
  const errTurn = p.seen[2].at(-1);
  assert.equal(errTurn.content[0].type, 'tool_result');
  assert.equal(errTurn.content[0].is_error, true);
  assert.match(errTurn.content[0].content, /no field “level”/);
  const t = a.status().transcript;
  assert.equal(t.at(-1)!.proposal, d.proposal!.id);
  d.accept(d.proposal!.id);
  assert.equal(d.doc.lists[0].cues[0].gainDb, -12);
});

test('a failed turn leaves the conversation clean and says why', async () => {
  const d = doc();
  const p = scripted([new Error('network down'), { stop_reason: 'end_turn', content: [{ type: 'text', text: 'hello' }] }]);
  const a = createAssistant({ provider: p });
  const r = await a.ask('hi', { document: d });
  assert.match(r.error!, /network down/);
  await a.ask('hi again', { document: d });
  assert.equal(p.seen[1].length, 1, 'the failed turn was not left in the history');
  const refused = createAssistant({ provider: scripted([{ stop_reason: 'refusal', content: [] }]) });
  assert.match((await refused.ask('x', { document: d })).error!, /declined/);
});

test('the built-in helper (the provider `demo`) stages real proposals, and says what it does when it does not understand', async () => {
  const d = doc();
  const a = createAssistant({ provider: demoProvider() });
  await a.ask('set cue 1 level to -9', { document: d });
  assert.equal((d.proposal!.changes[0] as Extract<Change, { kind: 'changed' }>).fields[0].to, '−9 dB');
  d.reject();
  await a.ask('what can you do?', { document: d });
  assert.equal(d.proposal, null);
  assert.match(a.status().transcript.at(-1)!.text, /built-in helper[\s\S]*no model[\s\S]*make cues from the sounds/);
  assert.equal(a.status().provider, 'demo');
  assert.equal(a.status().label, 'Built-in helper');
});

test('off: no provider, a plain answer', async () => {
  const a = createAssistant({ config: { provider: 'off' } });
  assert.equal(a.status().available, false);
  assert.match((await a.ask('x', { document: doc() })).error!, /off/);
});

test('OpenAI-compatible providers (OpenRouter, OpenAI, Ollama, custom): the same turn over chat-completions', async () => {
  const http = require('http') as typeof import('http');
  const { compatibleProvider, providerFor, missingFor } = require('../core/assistant/assistant') as typeof import('../core/assistant/assistant');
  const seen: { url?: string; auth?: string; body: any }[] = [];
  const replies = [
    { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'propose_changes', arguments: JSON.stringify({ summary: 'Quieter rain', ops: [{ op: 'cue.set', id: '#1', props: { gainDb: -12 } }] }) } }] } }] },
    { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Rain is at −12 dB.' } }] },
  ];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => { seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(replies.shift())); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const baseURL = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}/v1`;
  const d = doc();
  const a = createAssistant({ provider: compatibleProvider('custom', { baseURL, apiKey: 'k', model: 'some/model' }) });
  const r = await a.ask('make the rain quieter', { document: d });
  server.close();
  assert.equal(r.ok, true);
  assert.equal(d.proposal!.summary, 'Quieter rain');
  assert.equal(seen[0].url, '/v1/chat/completions');
  assert.equal(seen[0].auth, 'Bearer k');
  assert.equal(seen[0].body.model, 'some/model');
  assert.equal(seen[0].body.messages[0].role, 'system');
  assert.equal(seen[0].body.tools.length, TOOLS.length);
  assert.equal(seen[0].body.tools.at(-1).function.name, 'propose_changes');
  // the second request carries the call and its result in chat-completions' shape
  const m = seen[1].body.messages;
  assert.equal(m.at(-2).tool_calls[0].id, 'c1');
  assert.deepEqual([m.at(-1).role, m.at(-1).tool_call_id], ['tool', 'c1']);
  assert.match(m.at(-1).content, /Handed over for review/);

  // which configurations are usable, and what is missing when one is not
  assert.equal(providerFor({ provider: 'openrouter', model: 'x/y' }, {}), null);
  assert.match(missingFor({ provider: 'openrouter', model: 'x/y' }, {}), /OPENROUTER_API_KEY/);
  assert.equal(providerFor({ provider: 'openrouter', model: 'x/y' }, { OPENROUTER_API_KEY: 'k' })!.name, 'openrouter');
  assert.equal(providerFor({ provider: 'ollama', model: 'llama' }, {})!.name, 'ollama');
  assert.match(missingFor({ provider: 'custom', model: 'm' }, {}), /address/);
  assert.match(missingFor({ provider: 'openai', apiKey: 'k' }, {}), /model/);
});

test('a model that sends broken tool arguments is told, and the turn goes on', async () => {
  const { fromChat } = require('../core/assistant/assistant') as typeof import('../core/assistant/assistant');
  const msg = fromChat({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'c', function: { name: 'propose_changes', arguments: '{"summary": "x", "ops": [' } }] } }] });
  const call = msg.content[0] as ToolUseBlock;
  const r = execute(call.name as AtOnce, call.input as ToolInput, { document: doc() });
  assert.equal(r.is_error, true);
  assert.match(r.content, /not valid JSON/);
  assert.throws(() => fromChat({ error: { message: 'no credit' } }), /no credit/);
});

test('the agent: it searches, edits its draft in steps, checks, dry-runs, and only then proposes', async () => {
  const d = doc();
  const calls: unknown[] = [];
  const p = scripted([
    { stop_reason: 'tool_use', content: [use('a', 'find_cues', { text: 'rain' }), use('b', 'list_media', {})] },
    { stop_reason: 'tool_use', content: [use('c', 'edit_show', { ops: [{ op: 'cue.add', ref: 'g', after: '#2', cue: { type: 'group', number: '3', name: 'Thunder', children: [
      { type: 'audio', ref: 't', name: 'Thunder', file: 'media/rain.wav' },
      { type: 'fade', name: 'Rain dips', target: '#1', db: -10, duration: 0.5, relative: true },
      { type: 'fade', name: 'Rain returns', target: '#1', db: 0, duration: 2, relative: true, preWait: 3 }] } }] })] },
    { stop_reason: 'tool_use', content: [use('d', 'check_show', {}), use('e', 'simulate', { from: '1', gos: 1 }), use('f', 'simulate', { from: '3', gos: 1 })] },
    { stop_reason: 'tool_use', content: [use('g', 'edit_show', { ops: [{ op: 'cue.set', id: '#3', props: { notes: 'On the line' } }] })] },
    { stop_reason: 'tool_use', content: [use('h', 'propose_changes', { summary: 'A thunder cue that ducks the rain' })] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Cue 3 plays the thunder and dips the rain 10 dB for three seconds.' }] },
  ]);
  const a = createAssistant({ provider: p });
  const r = await a.ask('add a thunder cue after 2 that ducks the rain', { document: d });
  assert.equal(r.ok, true);
  const results = p.seen.slice(1).map((m) => m.at(-1).content.map((c: { content: string }) => c.content));
  assert.match(results[0][0], /2 cues:[\s\S]*#1 Audio: Rain/);     // find_cues (the fade is named after its target, so it matches too)
  assert.match(results[0][1], /media\/rain\.wav.*used by #1/);         // list_media
  assert.match(results[1][0], /1 added.*\n?New cues:/s);               // edit_show names what it made
  assert.match(results[2][0], /Nothing wrong/);                        // check_show on the draft
  assert.match(results[2][2], /GO 3 Thunder[\s\S]*▶ Thunder plays/);   // simulate ran the DRAFT (cue 3 does not exist in the show yet)
  assert.ok(!results[2][2].includes('◢'), 'and it is truthful: started from 3, the rain is not playing, so its fades do nothing');
  assert.equal(d.doc.lists[0].cues.length, 2, 'the show itself is untouched while the agent works');
  assert.equal(d.proposal!.counts.added, 1);
  assert.equal(d.proposal!.doc.lists[0].cues[2].notes, 'On the line');
  assert.equal(a.status().transcript.at(-1)!.steps!.length, 8);
  d.accept(d.proposal!.id);
  assert.equal(d.doc.lists[0].cues[2].children!.length, 3);
  assert.equal(d.undo() !== false, true);
  assert.equal(d.doc.lists[0].cues.length, 2, 'one undo takes the whole change back');
  void calls;
});

test('apply at once: the proposal lands without review, undoably, unless the host says not now', async () => {
  const turn = () => scripted([{ stop_reason: 'tool_use', content: [use('a', 'propose_changes', { summary: 'Quieter', ops: [{ op: 'cue.set', id: '#1', props: { gainDb: -20 } }] })] }, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] }]);
  const d = doc();
  const a = createAssistant({ provider: turn(), config: { autoApply: true } });
  const r = await a.ask('quieter', { document: d });
  assert.equal(r.applied, true);
  assert.equal(d.doc.lists[0].cues[0].gainDb, -20);
  assert.equal(d.proposal, null);
  d.undo();
  assert.equal(d.doc.lists[0].cues[0].gainDb, -6);
  const d2 = doc();
  const locked = createAssistant({ provider: turn(), config: { autoApply: true } });
  assert.equal((await locked.ask('quieter', { document: d2, canApply: () => false })).applied, false);
  assert.ok(d2.proposal, 'in Show mode it waits for review like any proposal');
});

test('apply at once never opens a door: a proposal that switches a module on waits for review', async () => {
  const d = doc();
  const a = createAssistant({ provider: scripted([{ stop_reason: 'tool_use', content: [use('a', 'propose_changes', { summary: 'Remote', ops: [{ op: 'show.set', path: 'modules.osc-control.enabled', value: true }] })] }, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] }]), config: { autoApply: true } });
  const r = await a.ask('turn on osc', { document: d });
  assert.ok(r.proposal, 'a proposal was made');
  assert.equal(r.applied, false);
  assert.ok(d.proposal, 'it waits for review');
  assert.equal(d.doc.modules['osc-control'].enabled, false);
});

test('the dry run tells what a GO does, second by second', () => {
  const { simulate, describe } = require('../core/engine/dry-run') as typeof import('../core/engine/dry-run');
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', name: 'Rain', file: 'r.wav', loop: true } },
    { op: 'cue.add', cue: { type: 'fade', number: '2', target: '@a', db: -60, duration: 4, stopTarget: true } },
  ]);
  const text = describe(simulate(s.doc, { gos: 2 }));
  assert.match(text, /0\.00 s {2}GO 1 Rain/);
  assert.match(text, /▶ Rain plays \(r\.wav\).*looping/);
  assert.match(text, /◢ Rain → silence over 4 s/);
  assert.match(text, /■ Rain stops/);
  assert.match(text, /Still sounding afterwards: nothing/);
  assert.match(describe(simulate(s.doc, { from: '9' })), /no cue numbered 9/);
});
