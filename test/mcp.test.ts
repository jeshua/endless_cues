import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import * as mcp from '../core/assistant/mcp';
import * as tools from '../core/assistant/tools';
import { ShowDocument } from '../core/show/document';
import { makeDemo } from '../examples/make-demo';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ec-mcp-'));

/** An MCP client on a pair of in-memory streams. */
function client(backend) {
  const toServer = new PassThrough(), fromServer = new PassThrough();
  mcp.serve({ input: toServer, output: fromServer, backend });
  let held = ''; const waiting = new Map(); let id = 0;
  fromServer.on('data', (d) => { held += d; let nl; while ((nl = held.indexOf('\n')) >= 0) { const m = JSON.parse(held.slice(0, nl)); held = held.slice(nl + 1); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } });
  const request = (method, params) => new Promise((resolve) => { const n = ++id; waiting.set(n, resolve); toServer.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  return { request, call: async (name, args) => (await request('tools/call', { name, arguments: args })).result, notify: (method) => toServer.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n') };
}

test('MCP: the handshake, the tool list, and a show folder edited with no app', async () => {
  const dir = path.join(tmp(), 'Demo.ecshow'); makeDemo(dir);
  const before = fs.readFileSync(path.join(dir, 'show.json'), 'utf8');
  const c = client(mcp.fileBackend(dir));
  const init = (await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })).result;
  assert.equal(init.serverInfo.name, 'endless-cues');
  assert.match(init.instructions, /OPERATIONS/);
  assert.match(init.instructions, /read_reference/, 'the brief reference says where the rest is');
  c.notify('notifications/initialized');
  const list = (await c.request('tools/list')).result.tools;
  assert.deepEqual(list.map((t) => t.name), tools.TOOLS.map((t) => t.name));
  assert.ok(list.every((t) => t.inputSchema && t.inputSchema.type === 'object'));
  assert.match((await c.call('list_media', {})).content[0].text, /media\/rain\.wav {2}\(00:12\.0\)/, 'lengths are read from the files');
  const bad = await c.call('edit_show', { ops: [{ op: 'cue.set', id: '#999', props: { name: 'x' } }] });
  assert.equal(bad.isError, true);
  await c.call('edit_show', { ops: [{ op: 'cue.set', id: '#3', props: { notes: 'from an agent' } }] });
  assert.match((await c.call('simulate', { from: '2', gos: 2 })).content[0].text, /GO 3 Thunder[\s\S]*Thunder reaches its end/);
  const done = await c.call('propose_changes', { summary: 'A note on the thunder' });
  assert.match(done.content[0].text, /UNSAVED changes/);
  assert.equal(fs.readFileSync(path.join(dir, 'show.json'), 'utf8'), before, 'the show file itself is not touched');
  const opened = ShowDocument.open(dir);
  assert.equal(opened.recovered, true);
  assert.equal(opened.unsaved()[0].fields[0].to, 'from an agent');
  assert.equal((await c.request('nope')).error.code, -32601);
});

test('MCP with no instructions (the app’s own agent turns, whose system prompt has them): the handshake carries none', async () => {
  const dir = path.join(tmp(), 'Demo.ecshow'); makeDemo(dir);
  const toServer = new PassThrough(), fromServer = new PassThrough();
  mcp.serve({ input: toServer, output: fromServer, backend: mcp.fileBackend(dir), instructions: null });
  const reply = new Promise((resolve) => fromServer.once('data', (d) => resolve(JSON.parse(String(d)))));
  toServer.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
  const init = (await reply).result;
  assert.equal(init.serverInfo.name, 'endless-cues');
  assert.equal(init.instructions, undefined);
  toServer.end();
});

test('MCP --save writes and versions; an unknown tool is refused', async () => {
  const dir = path.join(tmp(), 'Demo.ecshow'); makeDemo(dir);
  const c = client(mcp.fileBackend(dir, { save: true }));
  const done = await c.call('propose_changes', { summary: 'Rename', ops: [{ op: 'cue.set', id: '#7', props: { name: 'Interval (20 min)' } }] });
  assert.match(done.content[0].text, /Saved to .*show\.json as version v1/);
  assert.match(fs.readFileSync(path.join(dir, 'show.json'), 'utf8'), /Interval \(20 min\)/);
  assert.ok((await c.request('tools/call', { name: 'play_show', arguments: {} })).error);
});

test('the bridge: an agent outside the app works on the open show, and only with the token', async () => {
  const dir = path.join(tmp(), 'Demo.ecshow'); makeDemo(dir);
  const document = ShowDocument.open(dir);
  const sessions = new Map(); const seen = [];
  const file = path.join(tmp(), 'agent-bridge.json');
  const bridge = mcp.createBridge({ file, call: (session, name, input, who) => { seen.push([who, name]); if (!sessions.has(session)) sessions.set(session, { document, engine: null, draft: null }); return tools.execute(name, input, sessions.get(session)); } });
  const { port } = await bridge.start();
  assert.equal((await fetch(`http://127.0.0.1:${port}/hello`)).status, 403, 'no token, no entry');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0, 'the token file is this user’s only');
  const c = client(await mcp.appBackend({ file, session: 's1', client: 'Claude Code' }));
  await c.call('edit_show', { ops: [{ op: 'cue.add', after: '#7', cue: { type: 'memo', number: '7.5', name: 'Places' } }] });
  assert.equal(document.proposal, null);
  await c.call('propose_changes', { summary: 'A places call' });
  assert.equal(document.proposal.summary, 'A places call');
  assert.equal(document.doc.lists[0].cues.some((x) => x.number === '7.5'), false, 'it waits for review in the app');
  assert.deepEqual(seen.at(-1), ['Claude Code', 'propose_changes']);
  bridge.stop();
  assert.equal(fs.existsSync(file), false);
  assert.equal(await mcp.appBackend({ file }), null, 'no app, no backend');
});

test('Claude Code as the assistant: it is started with our tools only, and its proposal is the turn’s', async () => {
  const { createAssistant, cliProvider } = require('../core/assistant/assistant');
  const { EventEmitter } = require('events');
  const document = new ShowDocument();
  document.edit([{ op: 'cue.add', cue: { type: 'memo', number: '1', name: 'One' } }]);
  let started = null;
  // a stand-in for the `claude` program: it "calls a tool" (as the real one would, over MCP) and prints its result
  const spawn = (file, args, opts) => {
    started = { file, args, cwd: opts.cwd };
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    setTimeout(() => {
      tools.execute('propose_changes', { summary: 'Renamed', ops: [{ op: 'cue.set', id: '#1', props: { name: 'Uno' } }] }, { document, draft: null });
      child.stdout.end(JSON.stringify({ type: 'result', is_error: false, result: 'Cue 1 is now Uno.', session_id: 'abc' }) + '\n'); child.emit('close', 0);
    }, 5);
    return child;
  };
  const provider = cliProvider('claude-code', { spawn, find: () => '/usr/local/bin/claude', mcpServer: (session, who) => ({ command: 'node', args: ['ec-mcp.js', '--session', session, '--client', who] }) });
  const a = createAssistant({ provider });
  const r = await a.ask('rename cue 1 to Uno', { document });
  assert.equal(r.ok, true);
  assert.equal(document.proposal.id, r.proposal);
  assert.equal(a.status().transcript.at(-1).text, 'Cue 1 is now Uno.');
  const arg = (name) => started.args[started.args.indexOf(name) + 1];
  assert.equal(arg('--tools'), '', 'none of its own tools: no shell, no files');
  assert.match(arg('--allowedTools'), /^mcp__endless-cues__read_show,.*mcp__endless-cues__propose_changes$/);
  assert.deepEqual(Object.keys(JSON.parse(arg('--mcp-config')).mcpServers), ['endless-cues']);
  assert.ok(started.args.includes('--strict-mcp-config'));
  assert.match(arg('-p'), /<show_outline>[\s\S]*rename cue 1 to Uno/);
  assert.notEqual(started.cwd, process.cwd(), 'it runs in an empty folder of its own');
  // not installed: a plain sentence
  const none = createAssistant({ provider: cliProvider('codex', { find: () => null, mcpServer: () => ({}) }) });
  assert.match((await none.ask('x', { document })).error, /Codex is not installed/);
});
