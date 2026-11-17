/**
 * Module: Web remote.
 *
 * A page any phone, tablet or laptop on the show network can open: the cue
 * list, what is standing by, what is running, and (if allowed) GO and Panic.
 * No app to install and nothing leaves the building: this computer serves it.
 *
 *   GET  /?k=<key>          the page (remote.html, self-contained)
 *   GET  /events?k=<key>    server-sent events: the show's state, as it changes
 *   POST /cmd?k=<key>       { op: 'go' | 'panic' | 'move' | 'jump' | 'pause' | 'resume' | 'playhead', … }
 *                           and, unless `levels` is off: { op: 'load', secs }  { op: 'bus', name, db }  { op: 'master', db }
 *
 * The key is in the address the app shows (Settings ▸ Modules); without it
 * every request is refused. `control: false` makes it a stage manager's
 * view: watching only.
 *
 * A level set from a remote is a hand on the fader, exactly as in the window: heard as it moves, and on
 * release it becomes the bus's level in the show (an unsaved change the operator can undo), so the window
 * and every other remote show the same fader. Nothing else of the show can be changed from a remote.
 * Load to Time is the cue standing by's.
 */
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import type { HostCommand, ModuleContext, ModuleField } from '../host';

interface Config { port?: number | string; control?: boolean; levels?: boolean; key?: string }
/** What a remote posts, as JSON: nothing in it is trusted until it is checked. */
type Posted = { op?: unknown; secs?: unknown; db?: unknown; name?: unknown; commit?: unknown } | null;

/** The page, its script written into it (remote.js, from remote.ts), so a phone loads one file. */
const page = () => fs.readFileSync(path.join(__dirname, 'remote.html'), 'utf8')
  .replace('<script src="remote.js"></script>', () => `<script>${fs.readFileSync(path.join(__dirname, 'remote.js'), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`);

const ALLOWED = new Set(['go', 'panic', 'move', 'jump', 'pause', 'resume', 'playhead']);
/** The commands a remote may send (besides a level and Load to Time). */
type Allowed = Extract<HostCommand, { op: 'go' | 'panic' | 'move' | 'jump' | 'pause' | 'resume' | 'playhead' }>;
const FADER = { min: -60, max: 12 };          // dB: what a remote's fader can ask for

/** A level or a Load to Time from a remote, as the host command it is: only these fields, only sane values. null: not one. */
function mixCommand(c: Posted): Extract<HostCommand, { op: 'load' | 'bus' | 'master' }> | null {
  if (!c || typeof c !== 'object') return null;
  if (c.op === 'load') { const secs = Number(c.secs); return Number.isFinite(secs) ? { op: 'load', secs } : null; }
  if (c.op !== 'bus' && c.op !== 'master') return null;
  const db = Number(c.db);
  if (!Number.isFinite(db) || (c.op === 'bus' && typeof c.name !== 'string')) return null;
  const level = Math.max(FADER.min, Math.min(FADER.max, Math.round(db * 10) / 10));
  const commit = c.commit === true ? { commit: true } : {};        // the finger came off: the level is the show's now
  return c.op === 'bus' ? { op: 'bus', name: c.name as string, db: level, ...commit } : { op: 'master', db: level, ...commit };
}

function lanAddresses() {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}

export const id = 'web-remote';
export const name = 'Web remote';
export const summary = 'The cue list and GO on any phone or tablet on the show network. No app to install.';
export const fields: ModuleField[] = [
    { key: 'port', label: 'Port', kind: 'number' },
    { key: 'control', label: 'Allow GO and Panic from the remote', kind: 'bool', help: 'Off: a view for the stage manager.' },
    { key: 'levels', label: 'Levels and Load to Time too', kind: 'bool', help: 'With GO allowed: the remote also has a fader for each bus and the master, and Load to Time for the cue standing by. A fader moved there is the same fader as in the window.' },
    { key: 'key', label: 'Key', kind: 'text', help: 'Part of the address. Leave empty and one is made.' },
  ];
export function create({ log, changed, host }: ModuleContext) {
    let server: http.Server | null = null, cfg: Config | null = null, error = '', key = '';
    const clients = new Set<http.ServerResponse>();
    let lastText = '';

    /** What a remote needs, and no more: the top-level list, the playhead, what is live. */
    function view() {
      const s = host.snapshot();
      const e = s.engine, mixer = s.mixer || {};
      const mix = cfg!.control !== false && cfg!.levels !== false;
      return {
        title: s.show.title, list: e.listName, playhead: e.playhead, control: cfg!.control !== false,
        // (no meters here: a level that changes ten times a second would be sent to every phone ten times a second)
        mix: mix ? { masterDb: Number(mixer.masterDb) || 0, buses: (mixer.buses || []).map((b) => ({ id: b.id, name: b.name, db: Number(b.db) || 0 })), loaded: e.loaded ? { id: e.loaded.id, at: e.loaded.at } : null, min: FADER.min, max: FADER.max } : null,
        cues: (s.rows || []).filter((r) => r.depth === 0).map((r) => ({ id: r.id, number: r.number, name: r.name, type: r.type, notes: r.notes || '', color: r.color || '', live: e.live.includes(r.id), paused: e.paused.includes(r.id), disarmed: e.disarmed.includes(r.id) })),
        active: e.active.filter((a) => a.kind === 'audio').map((a) => ({ name: a.name, elapsed: a.elapsed, total: a.total, paused: a.paused })),
      };
    }
    function broadcast() {
      if (!clients.size) return;
      const text = JSON.stringify(view());
      if (text === lastText) return;
      lastText = text;
      for (const res of clients) res.write(`data: ${text}\n\n`);
    }

    return {
      start(config: Config) {
        cfg = { ...config }; error = '';
        // no key set: the host's for this show (the same every time it opens here, and not guessable from the show's
        // id, which OSC control tells anyone who asks); with no host to make one, a new one each start
        key = String(cfg.key || '').trim() || (host.remoteKey ? host.remoteKey() : crypto.randomBytes(8).toString('hex'));
        server = http.createServer((req, res) => {
          const url = new URL(req.url!, 'http://x');
          if (url.searchParams.get('k') !== key) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('This remote needs the address shown in Endless Cues ▸ Settings ▸ Modules.'); return; }
          if (req.method === 'GET' && url.pathname === '/') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            res.end(page());
          } else if (req.method === 'GET' && url.pathname === '/events') {
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
            res.write(`data: ${JSON.stringify(view())}\n\n`);
            clients.add(res);
            req.on('close', () => { clients.delete(res); changed(); });
            changed();
          } else if (req.method === 'POST' && url.pathname === '/cmd') {
            let body = '';
            req.on('data', (d) => { body += d; if (body.length > 4096) req.destroy(); });
            req.on('end', () => {
              let c; try { c = JSON.parse(body); } catch { c = null; }
              const mix = cfg!.levels !== false ? mixCommand(c) : null;
              if (!c || !(ALLOWED.has(c.op) || mix) || cfg!.control === false) { res.writeHead(403); res.end('{}'); return; }
              const r = host.cmd(mix ? { ...mix, from: 'web-remote' } : { ...c, guard: c.op === 'go', from: 'web-remote' } as Allowed);
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ ok: !(r && r.error), error: r && r.error }));
            });
          } else { res.writeHead(404); res.end(); }
        });
        server.on('error', (e) => { error = `cannot serve on port ${cfg!.port}: ${e.message}`; log(error); changed(); });
        server.listen(Number(cfg.port) || 8137, '0.0.0.0');
      },
      stop() { for (const res of clients) { try { res.end(); } catch { /* gone */ } } clients.clear(); try { server && server.close(); } catch { /* closed */ } server = null; },
      onState: broadcast,
      status() {
        const urls = lanAddresses().map((a) => `http://${a}:${cfg!.port}/?k=${key}`);
        return { ok: !error, text: error || `${clients.size} connected`, urls: urls.length ? urls : [`http://localhost:${cfg!.port}/?k=${key}`] };
      },
    };
  }
