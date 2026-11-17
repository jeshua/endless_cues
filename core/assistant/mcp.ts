/**
 * Endless Cues as a tool for other agents: an MCP server, and the bridge to a running app.
 *
 * Claude Code, Codex and anything else that speaks the Model Context Protocol can be given the
 * same tools the built-in assistant has (tools.js): read and search the show, list its folder and
 * read a script in it, edit a private draft (cues, settings, devices), check it, dry-run it on the
 * real engine, see the Rig and the monitor, ask a device whether it is there, and hand the result
 * over as one change. Nothing else: no playing the show, no saving it, no command to a device.
 * (With a show folder alone there is no rig to ask: those tools say so.)
 *
 *   ec-mcp                       talk to the Endless Cues app that is running on this computer:
 *                                the agent works on whatever show is open, and its change appears
 *                                in the app for review like the built-in assistant's
 *   ec-mcp --show My.ecshow      work on a show folder directly (the app need not be running):
 *                                an accepted change is left as UNSAVED changes, waiting and marked
 *                                the next time the show is opened; --save writes and versions it
 *
 * This file is three small things, none of which needs Electron:
 *   serve(io, backend)     the MCP server: JSON-RPC 2.0, one JSON message per line, over stdio
 *   fileBackend(showDir)   tool calls answered from a show folder
 *   bridge                 createBridge(): the local door the app opens for agents (HTTP on
 *                          127.0.0.1, a random port, a token in a file only this user can read);
 *                          appBackend(): the client for it
 */
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { TOOLS, SYSTEM, reference, execute } from './tools';

const PROTOCOL = '2025-06-18';

/** What an agent that was not written for Endless Cues needs to know: sent as the server's instructions (the brief
 *  reference; the read_reference tool has the rest). The app's own Claude Code and Codex turns are given these as
 *  their system prompt already, so their server is started with --no-instructions and sends none: twice would be
 *  the largest part of every request sent twice. */
const INSTRUCTIONS = `${SYSTEM.replace(/^You are the assistant inside Endless Cues/, 'These tools let you work on a show in Endless Cues')}\n\n${reference()}`;

// ── the MCP server ───────────────────────────────────────────────────────

/** Serve MCP on a pair of streams. `backend.call(name, input)` → { content, is_error }. Resolves when input ends. */
function serve({ input, output, backend, version = '0', log = () => {}, instructions = INSTRUCTIONS }) {
  const send = (msg) => output.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  const handle = async (req) => {
    const { id, method, params = {} } = req;
    const isRequest = id !== undefined && id !== null;
    try {
      switch (method) {
        case 'initialize':
          return send({ id, result: { protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL, capabilities: { tools: {} },
                                      serverInfo: { name: 'endless-cues', title: 'Endless Cues', version }, ...(instructions ? { instructions } : {}) } });
        case 'ping': return send({ id, result: {} });
        case 'tools/list':
          return send({ id, result: { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) } });
        case 'tools/call': {
          if (!TOOLS.some((t) => t.name === params.name)) return send({ id, error: { code: -32602, message: `Unknown tool: ${params.name}` } });
          const r = await backend.call(params.name, params.arguments || {});
          return send({ id, result: { content: [{ type: 'text', text: String(r.content) }], isError: !!r.is_error } });
        }
        default:
          if (isRequest) send({ id, error: { code: -32601, message: `Method not found: ${method}` } });   // (notifications are simply taken)
      }
    } catch (err) {
      log(`${method}: ${err.stack || err}`);
      if (isRequest) send({ id, error: { code: -32603, message: err.message } });
    }
  };
  return new Promise((resolve) => {
    let held = '';
    let chain = Promise.resolve();
    input.setEncoding('utf8');
    input.on('data', (chunk) => {
      held += chunk;
      let nl;
      while ((nl = held.indexOf('\n')) >= 0) {
        const line = held.slice(0, nl).trim(); held = held.slice(nl + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { send({ id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
        chain = chain.then(() => handle(msg));      // in order: an edit and the check after it must not race
      }
    });
    input.on('end', () => chain.then(resolve));
  });
}

// ── a show folder, with no app ───────────────────────────────────────────

function fileBackend(showDir, { save = false } = {}) {
  const { ShowDocument } = require('../show/document');
  const { wavInfo } = require('../engine/waveform');
  const show = require('../show/show');
  if (!fs.existsSync(path.join(showDir, 'show.json'))) throw new Error(`${showDir} is not a show (it has no show.json)`);
  const document = ShowDocument.open(showDir);
  // enough of an engine for the outline and the dry run: how long each sound is
  const durations = new Map();
  show.walk(document.doc, (c) => { if (c.type === 'audio' && c.file && !durations.has(c.file)) { const info = wavInfo(document.resolveFile(c.file)); if (info) durations.set(c.file, Math.round(info.seconds * 100) / 100); } });
  // (no `rig`: with no app there is nothing to ask and no monitor; the folder, the script and the kit need none)
  const ctx = { document, engine: { durations, running: new Map(), playhead: null }, draft: null, files: new Map() };
  return {
    describe: `the show folder ${showDir}`,
    async call(name, input) {
      const r = await execute(name, input, ctx);
      if (!r.proposal) return r;
      // with no app there is nobody to review a proposal in a window: it lands as unsaved changes (marked, and
      // one Revert away, the next time the show is opened), or is saved outright when asked to be
      const summary = document.proposal.summary;
      const done = document.accept(r.proposal);
      ctx.draft = null; ctx.files = new Map();
      // (a proposal of files alone changes no cue: the files are in the folder now, and that is the whole of it)
      const wrote = done.files && done.files.length ? ` Written into the show folder: ${done.files.join(', ')}.` : '';
      if (!done.changed) return { content: `Done: “${summary}”.${wrote}` };
      if (save) { const v = document.save({ note: summary }); return { content: `Saved to ${path.join(showDir, 'show.json')} as version ${v.id}: ${v.note}${wrote}` }; }
      return { content: `Done: “${summary}”.${wrote} The changes are waiting as UNSAVED changes on this show. When it is next opened in Endless Cues they are there, each one marked; Save keeps them and Revert discards them. (show.json itself has not been modified.)` };
    },
  };
}

// ── the bridge to a running app ──────────────────────────────────────────

/** Where the app says how to reach it: in its settings folder, readable by this user only. */
function bridgeFile() {
  // (a test session's own door, so that it is never the one a person's running app has open)
  if (process.env.EC_BRIDGE_FILE) return process.env.EC_BRIDGE_FILE;
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
    : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  return path.join(base, 'EndlessCues', 'agent-bridge.json');
}

/**
 * The app's side. `call(session, name, input)` runs a tool; each agent session has its own draft.
 * Listens on 127.0.0.1 only, on a port the OS picks, and refuses anything without the token.
 */
function createBridge({ call, file = bridgeFile(), log = () => {} }) {
  const token = crypto.randomBytes(18).toString('hex');
  let server = null;
  return {
    start() {
      return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
          const done = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
          if (req.headers['x-ec-token'] !== token) return done(403, { error: 'no' });
          if (req.method === 'GET' && req.url === '/hello') return done(200, { ok: true });
          if (req.method !== 'POST' || req.url !== '/tool') return done(404, { error: 'not found' });
          let body = '';
          req.on('data', (d) => { body += d; if (body.length > 4 << 20) req.destroy(); });
          req.on('end', async () => {
            try { const m = JSON.parse(body); done(200, await call(String(m.session || 'agent'), String(m.name), m.input || {}, String(m.client || 'an agent'))); }
            catch (err) { log(`tool call failed: ${err.stack || err}`); done(200, { content: `Failed: ${err.message}`, is_error: true }); }
          });
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const port = server.address().port;
          try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ port, token, pid: process.pid }), { mode: 0o600 }); } catch (err) { log(`could not write ${file}: ${err.message}`); }
          resolve({ port, token });
        });
      });
    },
    stop() { try { server && server.close(); } catch { /* closed */ } server = null; try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j.token === token) fs.unlinkSync(file); } catch { /* not ours, or gone */ } },
    get running() { return !!server; },
  };
}

/** The agent's side: tool calls forwarded to the app. Null when no app is offering a bridge. */
async function appBackend({ file = bridgeFile(), session = crypto.randomBytes(4).toString('hex'), client = 'an agent' } = {}) {
  let info; try { info = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  const post = (pathname, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: info.port, path: pathname, method: body ? 'POST' : 'GET', headers: { 'x-ec-token': info.token, 'content-type': 'application/json' }, timeout: 60000 }, (res) => {
      let text = ''; res.on('data', (d) => { text += d; }); res.on('end', () => { try { resolve(JSON.parse(text)); } catch (err) { reject(err); } });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('the app did not answer')));
    req.end(body ? JSON.stringify(body) : undefined);
  });
  try { const hi = await post('/hello'); if (!hi || !hi.ok) return null; } catch { return null; }
  return {
    describe: 'the show open in Endless Cues',
    call: (name, input) => post('/tool', { session, name, input, client }).catch((err) => ({ content: `Endless Cues is not answering (${err.message}). Is the app still open, with agents allowed in Settings ▸ Assistant?`, is_error: true })),
  };
}

export { serve, fileBackend, createBridge, appBackend, bridgeFile, INSTRUCTIONS, PROTOCOL };
