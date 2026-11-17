/**
 * The assistant: a conversation that ends in proposals.
 *
 * `ask(text)` runs one turn: the model reads the show (tools.js), stages a
 * proposal if the request calls for one, and replies. Nothing here can change
 * the show: accepting a proposal is the person's act, in the app.
 *
 * The model is reached through a provider, chosen per machine (never stored
 * in a show file):
 *
 *   cloud       the Endless Cues assistant: an account (signed in with the device
 *               flow, cloud.js); requests go through the Endless Cues service,
 *               which holds the model key and chooses the model. Free in the beta.
 *   anthropic   your own Anthropic key, straight from this computer.
 *   openrouter  your own OpenRouter key: any model OpenRouter carries.
 *   openai      your own OpenAI key.
 *   ollama      a model running on this computer (Ollama): no key, no internet.
 *   custom      any service that speaks the OpenAI chat-completions protocol
 *               (LM Studio, Groq, Gemini's compatible endpoint, a company proxy…).
 *   claude-code Claude Code, if it is installed on this computer: it does the thinking with the
 *   codex       account it is already signed in to (no key here), and uses Endless Cues' tools
 *               through the MCP server (mcp.js). Codex likewise.
 *   demo        no model at all: the built-in helper (helper.js), which does a few set jobs
 *               through the same tools (cues from a folder, a device from a model, "is
 *               everything ready?"). Shown as "Built-in helper"; the id stays `demo`.
 *   off         no assistant.
 *
 * `anthropic` is one code path (the official Anthropic SDK). The rest are one
 * other code path: the OpenAI chat-completions protocol with tool calls, which
 * is what nearly every other provider speaks, the Endless Cues service included
 * (`cloud`: the same request, the account's token as its key, three headers). Inside the app the
 * conversation is kept in one shape (Anthropic's content blocks) and translated
 * at the edge, so the turn loop, the tools and the tests do not care who answers.
 */
const { TOOLS, SYSTEM, reference, outline, execute, describeCall, quickListing } = require('./tools');
const starters = require('./starters');
const cloud = require('./cloud');
const history = require('./history');
const { randomUUID } = require('crypto');

const showFile = require('../show/show');

const MODEL = 'claude-opus-5-5';
const MAX_STEPS = 40;             // model round-trips in one turn: enough to look, build, check, dry-run and fix
const CLOUD_ENDPOINT = cloud.ENDPOINT;

function loadSdk() {
  const mod = require('@anthropic-ai/sdk');
  return mod.Anthropic || mod.default || mod;
}

/** A provider is { name, create({ system, tools, messages }) -> an Anthropic Message }. */
function sdkProvider(name, clientOptions) {
  let client = null, Anthropic = null;
  return {
    name,
    async create({ system, tools, messages }) {
      if (!client) { Anthropic = loadSdk(); client = new Anthropic(clientOptions); }
      return client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        // a declined request is re-run on a fallback model inside the same call
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // the instructions and the cue reference never change within a session: cached
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        // and so is the conversation, up to its newest message: it only ever grows at the end (history.js), so each
        // call reads all of it before from the cache
        cache_control: { type: 'ephemeral' },
        tools,
        messages,
      });
    },
    explain(err) {
      if (!Anthropic) return err.message;
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        return 'Those Anthropic credentials were not accepted. Check ANTHROPIC_API_KEY (or run `ant auth login`).';
      }
      if (err instanceof Anthropic.RateLimitError) return 'The assistant is being rate-limited. Try again in a moment.';
      if (err instanceof Anthropic.APIConnectionError) return 'The assistant could not be reached. The show does not need it: everything else works offline.';
      if (err instanceof Anthropic.APIError) return `The assistant service answered with an error (${err.status || 'unknown'}): ${err.message}`;
      return err.message;
    },
  };
}

/** Providers that speak the OpenAI chat-completions protocol: where they live, and which environment variable holds a key. */
const COMPATIBLE = {
  openrouter: { label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY', needsKey: true,
                headers: { 'HTTP-Referer': 'https://endlesscues.com', 'X-Title': 'Endless Cues' } },
  openai: { label: 'OpenAI', baseURL: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY', needsKey: true },
  ollama: { label: 'Ollama (this computer)', baseURL: 'http://localhost:11434/v1', env: '', needsKey: false },
  custom: { label: 'Custom (OpenAI-compatible)', baseURL: '', env: 'ASSISTANT_API_KEY', needsKey: false },
};

/** The conversation as chat-completions wants it: tool calls on the assistant message, each result a `tool` message. */
function toChat(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    if (m.role === 'assistant') {
      const calls = blocks.filter((b) => b.type === 'tool_use');
      const state = blocks.find((b) => b.type === 'ec_state');      // (the Endless Cues service's opaque reasoning: sent back as it came)
      out.push({ role: 'assistant', content: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n') || null,
                 ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input || {}) } })) } : {}),
                 ...(state ? { ec_state: state.data } : {}) });
      continue;
    }
    for (const r of blocks.filter((b) => b.type === 'tool_result')) out.push({ role: 'tool', tool_call_id: r.tool_use_id, content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content) });
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
    if (text) out.push({ role: 'user', content: text });
  }
  return out;
}

/** A chat-completions reply, back in the shape the turn loop reads. A tool call whose arguments are not JSON is
 *  handed on with a marker, so the model is told and can try again rather than the turn failing. */
function fromChat(data) {
  const choice = data && data.choices && data.choices[0];
  if (!choice) throw new Error((data && data.error && (data.error.message || JSON.stringify(data.error))) || 'the model returned nothing');
  const msg = choice.message || {};
  const content = [];
  if (msg.content) content.push({ type: 'text', text: typeof msg.content === 'string' ? msg.content : msg.content.map((p) => p.text || '').join('') });
  for (const c of msg.tool_calls || []) {
    let input;
    try { input = c.function.arguments ? JSON.parse(c.function.arguments) : {}; } catch { input = { __invalid_json: String(c.function.arguments).slice(0, 400) }; }
    content.push({ type: 'tool_use', id: c.id || `call_${content.length}`, name: c.function.name, input });
  }
  if (typeof msg.ec_state === 'string') content.push({ type: 'ec_state', data: msg.ec_state });
  const reason = choice.finish_reason;
  return { role: 'assistant', content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : reason === 'length' ? 'max_tokens' : reason === 'content_filter' ? 'refusal' : 'end_turn' };
}

/** `headers(call)` adds headers per call (call: { turn, step }); `onResponse(res)` sees each answer's headers. */
function compatibleProvider(name, { baseURL, apiKey, model, fetchImpl = fetch, label = '', headers = null, onResponse = null }) {
  const def = { ...(COMPATIBLE[name] || COMPATIBLE.custom), ...(label ? { label } : {}) };
  const url = `${String(baseURL || def.baseURL).replace(/\/+$/, '')}/chat/completions`;
  class HttpError extends Error { constructor(status, message, code = '') { super(message); this.status = status; this.code = code; } }
  return {
    name,
    async create({ system, tools, messages, turn = '', step = 0 }) {
      let res;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...(def.headers || {}), ...(headers ? headers({ turn, step }) : {}) },
          body: JSON.stringify({ model, messages: toChat(system, messages), tool_choice: 'auto',
                                 tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) }),
        });
      } catch (err) { throw new HttpError(0, err.message); }
      if (onResponse) onResponse(res);
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = null; }
      // (the Endless Cues service says { error: code, message }; OpenAI and the rest { error: { message } })
      if (!res.ok) throw new HttpError(res.status, (data && (typeof data.error === 'string' ? data.message || data.error : data.error && (data.error.message || data.error))) || text.slice(0, 300) || res.statusText, data && typeof data.error === 'string' ? data.error : '');
      return fromChat(data);
    },
    explain(err) {
      if (err.status === 0) return name === 'ollama' ? 'Ollama is not answering on this computer. Start it (and pull the model), then try again.' : `${def.label} could not be reached. The show does not need it: everything else works offline.`;
      if (err.status === 401 || err.status === 403) return `${def.label} did not accept that key. Check it in Settings ▸ Assistant.`;
      if (err.status === 404) return `${def.label} does not know the model “${model}”. Check its name in Settings ▸ Assistant.`;
      if (err.status === 429) return `${def.label} is rate-limiting, or the account is out of credit. Try again in a moment.`;
      return `${def.label}: ${err.message}`;
    },
  };
}

// ── the Endless Cues assistant: the service is OpenAI-compatible, so it is the provider above with three headers ──
/** What the service's answers say about the month (x-ec-tier, x-ec-used, x-ec-resets) is kept on `usage`; a 401 calls signedOut(). */
function cloudProvider({ endpoint = CLOUD_ENDPOINT, token, version = '', fetchImpl = fetch, signedOut = () => {} }) {
  const p = { name: 'cloud', label: 'Endless Cues assistant', usage: null };
  const inner = compatibleProvider('cloud', {
    baseURL: `${String(endpoint || CLOUD_ENDPOINT).replace(/\/+$/, '')}/v1`, apiKey: token, model: 'endless-cues', fetchImpl, label: p.label,
    headers: ({ turn, step }) => ({ 'x-ec-turn': turn || randomUUID(), 'x-ec-step': String(step || 0), 'x-ec-version': version || 'dev', 'user-agent': `EndlessCues/${version || 'dev'} (${process.platform})` }),
    onResponse: (res) => {
      const tier = res.headers.get('x-ec-tier');
      if (res.ok && tier) p.usage = { ...(p.usage || {}), tier, used: Number(res.headers.get('x-ec-used')) || 0, resets: res.headers.get('x-ec-resets') || (p.usage && p.usage.resets) || '' };
    },
  });
  p.create = async (call) => {
    try { return await inner.create(call); } catch (err) {
      if (err.status === 401) signedOut();
      if (err.code === 'allowance_used') p.usage = { ...(p.usage || {}), tier: 'used_up' };
      throw err;
    }
  };
  p.explain = (err) => {
    if (err.status === 0 || err.status >= 500) return err.code === 'busy_today' ? 'The Endless Cues assistant is resting until tomorrow. Your show isn’t affected.' : 'The Endless Cues assistant isn’t answering. Your show isn’t affected.';
    if (err.status === 401) return 'Signed out. Sign in again in Settings ▸ Assistant.';
    if (err.code === 'allowance_used') return 'This month’s asks are used up: the built-in helper can still help.';
    if (err.code === 'build_not_allowed') return 'This build can’t use the hosted assistant. Use your own key.';
    return err.message || 'The Endless Cues assistant could not answer.';
  };
  return p;
}

// ── Claude Code and Codex: an agent that is already installed does the turn ─────────────
// These do not answer one model call at a time: they run their own loop, calling Endless Cues' tools over MCP
// (bin/ec-mcp.js → the app's bridge), and come back with what they have to say. So a provider of this kind has
// `turn()` instead of `create()`. They get only our tools: no shell, no files.
const TOOL_NAMES = TOOLS.map((t) => t.name);      // (from the one table, so the allow-list can never fall behind it)
const CLI = {
  'claude-code': { label: 'Claude Code', bin: 'claude' },
  codex: { label: 'Codex', bin: 'codex' },
};
/** Where a command-line tool is, looking beyond the short PATH an app started from the Dock is given. */
function findBinary(bin, env = process.env) {
  const fs = require('fs'), path = require('path'), os = require('os');
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  const dirs = [...String(env.PATH || '').split(path.delimiter), path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin',
                path.join(os.homedir(), '.npm-global', 'bin'), path.join(os.homedir(), 'AppData', 'Roaming', 'npm')].filter(Boolean);
  for (const d of dirs) for (const e of exts) { const f = path.join(d, bin + e); try { if (fs.statSync(f).isFile()) return f; } catch { /* not there */ } }
  return null;
}
function cliProvider(name, { mcpServer, spawn = require('child_process').spawn, find = findBinary } = {}) {
  const def = CLI[name];
  const os = require('os'), fs = require('fs'), path = require('path');
  let resume = null;        // Claude Code's session, so a follow-up question continues the conversation
  const run = (file, args, { cwd }) => new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
  return {
    name, kind: 'cli',
    reset() { resume = null; },
    available: () => !!find(def.bin),
    async turn({ system, prompt, session }) {
      const file = find(def.bin);
      if (!file) { const e = new Error('not installed'); e.missing = true; throw e; }
      const server = mcpServer(session, def.label);      // { command, args, env }
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-agent-'));   // an empty folder: it has no project to read or touch
      try {
        if (name === 'claude-code') {
          const args = ['-p', prompt, '--mcp-config', JSON.stringify({ mcpServers: { 'endless-cues': server } }), '--strict-mcp-config',
                        '--tools', '', '--allowedTools', TOOL_NAMES.map((t) => `mcp__endless-cues__${t}`).join(','),
                        '--system-prompt', system, '--output-format', 'json', ...(resume ? ['--resume', resume] : [])];
          const r = await run(file, args, { cwd });
          const line = r.out.split('\n').reverse().find((l) => l.trim().startsWith('{') && l.includes('"result"'));
          let j = null; try { j = line ? JSON.parse(line) : null; } catch { j = null; }
          if (!j) throw new Error((r.err || r.out).trim().split('\n').slice(-3).join(' ').slice(0, 400) || `Claude Code exited with code ${r.code}`);
          if (j.session_id) resume = j.session_id;
          if (j.is_error) throw new Error(String(j.result || 'Claude Code reported an error').slice(0, 400));
          return { text: String(j.result || '').trim() };
        }
        // Codex: its one-shot mode, read-only sandbox, our MCP server given on the command line, the last message to a file
        const last = path.join(cwd, 'last.txt');
        const toml = (v) => JSON.stringify(v);
        const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-o', last,
                      '-c', `mcp_servers.endless_cues.command=${toml(server.command)}`, '-c', `mcp_servers.endless_cues.args=${toml(server.args)}`,
                      ...(server.env ? ['-c', `mcp_servers.endless_cues.env={${Object.entries(server.env).map(([k, v]) => `${k}=${toml(v)}`).join(',')}}`] : []),
                      `${system}\n\nUse only the endless_cues tools.\n\n${prompt}`];
        const r = await run(file, args, { cwd });
        let text = ''; try { text = fs.readFileSync(last, 'utf8').trim(); } catch { /* none */ }
        if (!text && r.code !== 0) throw new Error((r.err || r.out).trim().split('\n').slice(-3).join(' ').slice(0, 400) || `Codex exited with code ${r.code}`);
        return { text: text || r.out.trim().split('\n').slice(-12).join('\n') };
      } finally { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* temp */ } }
    },
    explain(err) {
      if (err.missing) return `${def.label} is not installed on this computer (no “${def.bin}” command was found). Install it and sign in, or choose another way in Settings ▸ Assistant.`;
      if (/log ?in|auth|credential|api key/i.test(err.message)) return `${def.label} is not signed in. Run “${def.bin}” once in a terminal and sign in, then try again.`;
      return `${def.label}: ${err.message}`;
    },
  };
}

/** No model: the built-in helper (helper.js). The name is kept for the tests and the configurations that have it. */
function demoProvider() { return require('./helper').helperProvider(); }

/** The provider a configuration asks for, or null with the reason it cannot be used yet. A key typed into
 *  Settings wins; otherwise the provider's usual environment variable is read. */
function providerFor(config = {}, env = process.env) {
  const name = config.provider;
  if (CLI[name]) return config.mcpServer ? cliProvider(name, { mcpServer: config.mcpServer }) : null;
  if (name === 'cloud') return config.token ? cloudProvider({ endpoint: config.endpoint, token: config.token, version: config.version, signedOut: config.cloudSignedOut }) : null;
  if (name === 'anthropic') return sdkProvider('anthropic', config.apiKey ? { apiKey: config.apiKey } : {});
  if (name === 'demo') return demoProvider();
  if (COMPATIBLE[name]) {
    const def = COMPATIBLE[name];
    const apiKey = config.apiKey || (def.env && env[def.env]) || '';
    if (!config.model || (def.needsKey && !apiKey) || !(config.baseURL || def.baseURL)) return null;
    return compatibleProvider(name, { baseURL: config.baseURL, apiKey, model: config.model });
  }
  return null;
}
/** Why a configuration gives no provider, in words for Settings. */
function missingFor(config = {}, env = process.env) {
  const def = COMPATIBLE[config.provider];
  if (config.provider === 'cloud') return config.token ? '' : 'Sign in first.';
  if (CLI[config.provider]) {
    const label = CLI[config.provider].label;
    if (!findBinary(CLI[config.provider].bin, env)) return `${label} wasn’t found on this computer.`;
    // (found, but this window has no way to hand it the app's tools: `noDoor` says where that is so, a test window above all)
    return config.mcpServer ? '' : `${label} can’t be used ${config.noDoor || 'here'}.`;
  }
  if (!def) return '';
  const label = def.label.replace(/\s*\(.*$/, '');
  if (!(config.baseURL || def.baseURL)) return `${label} needs an address.`;
  if (def.needsKey && !(config.apiKey || (def.env && env[def.env]))) return `${label} needs a key, or ${def.env} set.`;
  if (!config.model) return `${label} needs a model name.`;
  return '';
}

function createAssistant({ config = {}, log = () => {}, changed = () => {}, provider = null } = {}) {
  let cfg = { ...config };
  let active = provider || providerFor(cfg);
  let messages = [];            // what the model is sent: append-only, a message once sent is never changed (history.js)
  let told = null;              // what `messages` has told the model of the show so far (history.note's state)
  let transcript = [];          // what the person sees: { role, text, proposal?, error? }
  let busy = false;
  let activity = [];            // what the agent has done so far this turn, for the person watching
  let points = [];              // the places it pointed at this turn (show_in_app): its reply carries a "Show me" for each
  let account = null;           // the Endless Cues account, as the app knows it: { email, step, code, error, usage }
  const system = `${SYSTEM}\n\n${reference()}`;

  // The first screen is asked for with every state push, so what costs something is kept a moment: which agents
  // are installed (a look round the disk) for half a minute, the folder's file names for two seconds, and the
  // whole answer until the show, the provider or the Rig's summary changes.
  let found = null, foundAt = 0;
  const installed = () => { const t = Date.now(); if (!found || t - foundAt > 30000) { found = Object.fromEntries(Object.entries(CLI).map(([id, def]) => [id, !!findBinary(def.bin)])); foundAt = t; } return found; };
  let seen = { key: null, at: 0, first: null };
  function firstFor(ctx, provider, inst) {
    const { document, rig = null, imported = null } = ctx;
    let st = null; try { st = rig ? rig.status() : null; } catch { st = null; }
    const t = Date.now();
    const key = [provider, document.showDir || '', st && st.summary ? st.summary.text : '', st ? JSON.stringify(Object.fromEntries(Object.entries(st.devices || {}).map(([id, d]) => [id, d && d.state]))) : '', imported ? 'imported' : '', JSON.stringify(inst)].join('|');
    if (seen.first && seen.doc === document.doc && seen.key === key && t - seen.at < 2000) return seen.first;
    let listing = null;
    try { listing = document.showDir ? quickListing(document.showDir, document.doc) : null; } catch { listing = null; }
    let first = null;
    try { first = starters.first({ doc: document.doc, showDir: document.showDir, folder: listing, rig: st, imported, provider, installed: inst }); } catch (err) { log(`first screen: ${err.message}`); }
    seen = { doc: document.doc, key, at: t, first };
    return first;
  }

  /** A proposal that changes what the show listens on or sends to (its modules, its network patches, its devices) is
   *  always shown for review, even with "apply at once": show text the model read must not open a door by itself. */
  function reachesOut(document) {
    const p = document.proposal, d = document.doc;
    if (!p || !p.doc) return false;
    const part = (x) => JSON.stringify([x.modules, x.settings && x.settings.network, x.rig && x.rig.devices]);
    return part(p.doc) !== part(d);
  }

  async function ask(text, { document, engine = null, ...opts }) {
    text = String(text || '').trim();
    if (!text) return { error: 'nothing asked' };
    if (!active) return { error: 'The assistant is off. Turn it on in Settings ▸ Assistant.' };
    if (busy) return { error: 'The assistant is still working on the last request.' };
    busy = true;
    transcript.push({ role: 'user', text });
    changed();
    const mark = messages.length;
    // A change still waiting for review (and still fitting the show) is where this turn starts: "and make it five
    // seconds" is about the proposal on the screen, which is not in the show yet. The turn's draft begins as that
    // proposal, so what comes out of the turn carries both. (An agent that runs its own loop keeps its own draft:
    // it is only told.)
    const pending = document.proposal && document.proposal.doc && document.proposal.base === showFile.hash(document.doc) ? document.proposal : null;
    const waiting = pending && !active.turn ? pending : null;
    const about = waiting
      ? `\n<waiting_for_review>A change you proposed is still waiting for the person to accept or reject: “${waiting.summary}”. It is not in the show yet, but the outline above and your draft already include it. If this request adds to it or adjusts it, edit and call propose_changes: the new proposal takes its place and carries both. If the person wants something else instead of it, undo its parts in your draft first.</waiting_for_review>`
      : pending ? `\n<waiting_for_review>A change is still waiting for the person to accept or reject: “${pending.summary}”. It is NOT in the show or in the outline above, and a new proposal replaces it.</waiting_for_review>` : '';
    // the show as it is at this moment travels with the question: the whole outline the first time, then only what
    // changed since the conversation last said (earlier messages are never edited: history.js says why)
    const now = outline(waiting ? waiting.doc : document.doc, { engine, rig: opts.rig || null, showDir: document.showDir });
    const sketch = `<show_outline>\n${now}\n</show_outline>${about}`;
    const wasTold = told;
    const shown = history.note(told, now);
    told = shown.state;
    messages.push({ role: 'user', content: [{ type: 'text', text: `${shown.text}${about}` }, { type: 'text', text }] });
    let proposal = null;
    // the draft lives for this turn: its edits reach the show only through a proposal
    // (with it: the rig, when there is a running app; and the files staged for the show folder, which start as the waiting proposal's)
    const ctx = { document, engine, draft: waiting ? waiting.doc : null, base: waiting ? document.doc : null, log: null, rig: opts.rig || null, ui: opts.ui || null,
                  files: new Map(((waiting && waiting.files) || []).map((f) => [f.path, f.text])) };
    activity = []; points = [];
    const turn = randomUUID();      // one id for every model call of this turn (the Endless Cues service counts asks by it)
    try {
      if (active.turn) {
        // Claude Code or Codex runs the loop itself, calling our tools over MCP; what it did arrives through noteStep()
        const before = document.proposal ? document.proposal.id : null;
        const r = await active.turn({ system, session: 'app', prompt: `${sketch}\n\n${text}` });
        proposal = document.proposal && document.proposal.id !== before ? document.proposal.id : null;
        messages.push({ role: 'assistant', content: [{ type: 'text', text: r.text }] });
        let applied = false;
        if (proposal && cfg.autoApply && (!opts.canApply || opts.canApply()) && !reachesOut(document)) { try { document.accept(proposal); applied = true; } catch (err) { log(`could not apply: ${err.message}`); } }
        transcript.push({ role: 'assistant', text: r.text || (proposal ? 'Ready for review.' : '(no reply)'), steps: activity.slice(), ...(points.length ? { points: points.slice() } : {}), ...(proposal ? { proposal, applied } : {}) });
        return { ok: true, proposal, applied };
      }
      for (let step = 0; step < MAX_STEPS; step++) {
        const res = await active.create({ system, tools: TOOLS, messages, ctx, turn, step });      // (ctx: the built-in helper reads the show to script its turn; a model never sees it)
        if (res.stop_reason === 'refusal') throw new Error('The assistant declined that request.');
        messages.push({ role: 'assistant', content: res.content });
        if (res.stop_reason === 'pause_turn') continue;
        const calls = res.content.filter((b) => b.type === 'tool_use');
        const said = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (res.stop_reason === 'max_tokens' && !calls.length) throw new Error('The reply was cut off. Ask for a smaller change.');
        if (!calls.length || res.stop_reason !== 'tool_use') {
          let applied = false;
          // "apply at once" (a choice made on this computer): the proposal lands without the review step. It is still
          // one undo step and still unsaved, and never happens in Show mode (the host passes canApply).
          if (proposal && cfg.autoApply && (!opts.canApply || opts.canApply()) && !reachesOut(document)) { try { document.accept(proposal); applied = true; } catch (err) { log(`could not apply: ${err.message}`); } }
          transcript.push({ role: 'assistant', text: said || (proposal ? 'Ready for review.' : '(no reply)'), steps: activity.slice(), ...(points.length ? { points: points.slice() } : {}), ...(proposal ? { proposal, applied } : {}) });
          return { ok: true, proposal, applied };
        }
        // every tool call answered, all in one message
        const results = [];
        for (const call of calls) {
          activity.push(describeCall(call.name, call.input || {})); changed();
          const r = await execute(call.name, call.input || {}, ctx);      // (a tool that asks a device waits for its answer)
          if (r.proposal) proposal = r.proposal;
          if (r.point) points.push(r.point);
          log(`${call.name}${r.is_error ? ' (error)' : ''}: ${String(r.content).slice(0, 160)}`);
          results.push({ type: 'tool_result', tool_use_id: call.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) });
        }
        messages.push({ role: 'user', content: results });
      }
      throw new Error('That took too many steps; try asking for it in smaller pieces.');
    } catch (err) {
      messages.length = mark;       // a failed turn leaves no half-finished exchange behind (only the end goes: nothing earlier changes)
      told = wasTold;               // and what it told the model of the show went with it
      const why = active.explain ? active.explain(err) : err.message;
      log(`failed: ${err.stack || err}`);
      // (what this turn staged goes; a change that was waiting before the turn, and that it replaced, is waiting again)
      if (document.proposal && proposal) document.withdraw(proposal);
      transcript.push({ role: 'assistant', text: why, error: true, steps: activity.slice() });
      return { error: why };
    } finally { busy = false; changed(); }
  }

  return {
    ask,
    reset() { messages = []; told = null; transcript = []; if (active && active.reset) active.reset(); changed(); },
    /** A tool call made through the bridge (an agent outside this loop): shown as a step if it is this turn's. */
    noteStep(text) { if (busy) { activity.push(text); changed(); } },
    /** A place an agent outside this loop pointed at (show_in_app through the bridge): its reply gets a "Show me" for it. */
    notePoint(p) { if (busy && p) points.push(p); },
    /** A change proposed by an agent the person is running themselves (Claude Code in a terminal, say). */
    noteExternal(client, summary, applied) { if (busy) return; transcript.push({ role: 'assistant', text: `${client} proposed a change: ${summary}`, external: true, applied }); changed(); },
    get busy() { return busy; },
    /** What the app knows of the Endless Cues account (main.js tells it): signed in as, a sign-in under way, this month. null forgets it. */
    setAccount(patch) { account = patch === null ? null : { ...(account || {}), ...patch }; changed(); },
    configure(next) { cfg = { ...cfg, ...next }; active = providerFor(cfg); messages = []; told = null; changed(); return cfg; },
    /** `ctx` ({ document, engine, rig, imported }), when the host gives it, adds `first`: what the drawer shows before the first message (starters.js). */
    status(ctx = null) {
      const provider = active ? active.name : 'off';
      const out = { available: !!active, provider, label: active && active.label ? active.label : (CLI[provider] || COMPATIBLE[provider] || {}).label || '', model: active && COMPATIBLE[active.name] ? cfg.model : '', busy, activity: busy ? activity.slice(-6) : [], autoApply: !!cfg.autoApply, transcript: transcript.slice(-60), signedIn: !!cfg.token,
        // `chosen` is what was asked for, `provider` what is answering: when they differ, `missing` says why in one line
        chosen: cfg.provider || 'off', missing: active ? '' : missingFor(cfg) };
      if (cfg.provider === 'cloud') {
        // the month as the last answer said it, else as Settings last asked; a sign-in under way says where it is, in one line
        const usage = { ...((account && account.usage) || {}), ...((active && active.usage) || {}) };
        out.cloud = { email: (account && account.email) || '', step: (account && account.step) || '', code: (account && account.code) || '', error: (account && account.error) || '', usage: Object.keys(usage).length ? usage : null };
        if (!active) out.missing = out.cloud.error || (out.cloud.code ? `Your code: ${out.cloud.code}. Confirm it in the browser.` : out.cloud.step === 'starting' ? 'Signing in…' : out.missing);
      }
      if (ctx && ctx.document) { out.installed = installed(); out.first = firstFor(ctx, provider, out.installed); }
      return out;
    },
    get config() { return cfg; },
  };
}

module.exports = { createAssistant, demoProvider, providerFor, sdkProvider, missingFor, compatibleProvider, cloudProvider, cliProvider, findBinary, toChat, fromChat, COMPATIBLE, CLI, MODEL, CLOUD_ENDPOINT };
