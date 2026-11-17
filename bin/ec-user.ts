#!/usr/bin/env node
/*!
 * A virtual user's hands, eyes and ears on the app (test/users/README.md).
 *
 *   ec-user <session> start [--net] [show.ecshow | workspace.qlab5]   open the app for this session
 *   ec-user <session> look                       a picture of the window (its path) and what is on it, as text
 *   ec-user <session> click <x> <y> [--double] [--right] [--shift] [--cmd] [--alt]
 *   ec-user <session> click "<what it says>" [--nth N] [--double]
 *   ec-user <session> drag <x> <y> <x2> <y2>
 *   ec-user <session> scroll <x> <y> [by]        by: pixels down (negative: up)
 *   ec-user <session> type "<text>"              into whatever has the keyboard
 *   ec-user <session> key <Space | Escape | Enter | Tab | Up | Down | E | Cmd+S | Shift+Cmd+O | …>
 *   ec-user <session> menus                      the whole menu bar
 *   ec-user <session> menu "File > Save Show As…"
 *   ec-user <session> answer <path…> | --button "<label>" | --cancel      a file dialog or a message box
 *   ec-user <session> choose <x> <y> "<option>"  an option of a drop-down list
 *   ec-user <session> hear                       what would be coming out of the speakers
 *   ec-user <session> wait <seconds>
 *   ec-user <session> task <id>                  "I am starting this task" (the report's counts are per task)
 *   ec-user <session> note "<text>"              a thought worth keeping, as it happens
 *   ec-user <session> stop                       close the app
 *
 *   The equipment around the show, for a session started with --net:
 *   ec-user <session> osc listen <port>          stand in for a device: keep what arrives on this UDP port
 *   ec-user <session> osc heard <port>           what has arrived there
 *   ec-user <session> osc send <port> <address> [args…]     send the app a message, as a controller would
 *
 * Every action is written to <session>/journal.jsonl.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as dgram from 'dgram';
import { spawn, execSync } from 'child_process';

const ROOT = path.join(__dirname, '..');
const [session, verb, ...rest] = process.argv.slice(2);
if (!session || !verb) { console.log(fs.readFileSync(__filename, 'utf8').split('/*!')[1].split('*/')[0].split('\n').slice(1).map((l) => l.replace(/^ \* ?/, '')).join('\n')); process.exit(session ? 1 : 0); }
const dir = path.resolve(session);
const flags = new Set(rest.filter((a) => /^--[a-z]/.test(a)));
const flagValue = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const words = rest.filter((a, i) => !/^--[a-z]/.test(a) && !['--nth', '--button'].includes(rest[i - 1]));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mark = (line: Record<string, unknown>) => fs.appendFileSync(path.join(dir, 'journal.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...line }) + '\n');
const fail = (text: string): never => { console.error(text); process.exit(1); };

function door() {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'door.json'), 'utf8')); } catch { return null; }
}
/** What the app's drive answers (app/main/drive.ts). */
interface Answer { text?: string; shot?: string; error?: string }

function send(c: Record<string, unknown>) {
  const d = door();
  if (!d) fail('The app is not open for this session. Use: start');
  return new Promise<Answer>((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: d.port, method: 'POST', path: '/', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let body = ''; res.on('data', (x) => { body += x; }); res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ error: 'the app gave no answer' }); } });
    });
    req.on('error', () => resolve({ error: 'The app is not answering: it has closed or crashed. See app.log in the session folder; use start to open it again.' }));
    req.end(JSON.stringify(c));
  });
}
async function say(c: Record<string, unknown>) {
  const r = await send(c);
  if (r.error) fail(r.error);
  if (r.shot) console.log(`picture: ${r.shot}`);
  console.log(r.text);
}

async function start() {
  fs.mkdirSync(dir, { recursive: true });
  const was = door();
  if (was) { try { process.kill(was.pid, 0); fail('The app is already open for this session.'); } catch { fs.rmSync(path.join(dir, 'door.json'), { force: true }); } }
  const net = flags.has('--net');
  if (net && process.platform === 'darwin') {
    // a session with real network ports must not sit beside an app that is running a show on the same ports
    let other = '';
    try { other = execSync('pgrep -fl "Endless Cues.app/Contents/MacOS" || true', { encoding: 'utf8' }).trim(); } catch { /* no pgrep */ }
    if (other) fail(`An Endless Cues app is running on this computer:\n${other}\nA --net session opens network ports and is not started beside it.`);
  }
  const file = words[0] ? path.resolve(words[0]) : null;
  if (file && !fs.existsSync(file)) fail(`There is no ${file}`);
  const out = fs.openSync(path.join(dir, 'app.log'), 'a');
  const child = spawn(require('electron'), [ROOT, `--drive=${dir}`, ...(net ? ['--drive-net'] : []), ...(file ? [file] : [])], { detached: true, stdio: ['ignore', out, out], env: { ...process.env, EC_LOG: '1' } });
  child.unref();
  for (let i = 0; i < 150 && !door(); i++) await sleep(200);
  if (!door()) fail('The app did not open. See app.log in the session folder.');
  await sleep(1200);
  mark({ op: 'start', args: { net, file } });
  console.log(`The app is open${file ? ` on ${path.basename(file)}` : ''}${net ? ', with its network ports' : ''}. Use: look`);
}

async function osc() {
  const { encode, decode, parseText, toText } = require('../core/net/osc');
  const [what, port, ...more] = words;
  const log = path.join(dir, `osc-${port}.log`);
  if (what === 'listen') {
    fs.mkdirSync(dir, { recursive: true });
    const child = spawn(process.execPath, [__filename, dir, 'osc', '_listen', port], { detached: true, stdio: 'ignore' });
    child.unref();
    fs.appendFileSync(path.join(dir, 'listeners.txt'), `${child.pid}\n`);
    mark({ op: 'osc listen', args: { port } });
    console.log(`Listening on UDP ${port}. Use: osc heard ${port}`);
  } else if (what === '_listen') {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('message', (buf, from) => { let text; try { const m = decode(buf); const at = (buf.indexOf(0) + 4) & ~3; const tags = buf[at] === 0x2c ? buf.toString('latin1', at + 1, buf.indexOf(0, at)) : ''; text = `${toText(m)}${tags ? `   [types: ${[...tags].map((t) => ({ i: 'int', f: 'float', s: 'string', T: 'true', F: 'false', h: 'int64', d: 'double', b: 'blob', N: 'nil' }[t] || t)).join(', ')}]` : ''}`; } catch { text = `(not OSC: ${buf.length} bytes)`; } fs.appendFileSync(log, `${new Date().toISOString().slice(11, 23)}  ${text}   from ${from.address}:${from.port}\n`); });
    sock.bind(Number(port));
    setTimeout(() => process.exit(0), 3 * 3600 * 1000);
  } else if (what === 'heard') {
    console.log(fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() || 'Nothing has arrived.' : 'Nothing has arrived.');
  } else if (what === 'send') {
    const msg = parseText(more.join(' '));
    const sock = dgram.createSocket('udp4');
    sock.send(encode(msg.address, msg.args), Number(port), '127.0.0.1', () => { sock.close(); mark({ op: 'osc send', args: { port, message: more.join(' ') } }); console.log(`sent ${more.join(' ')} to UDP ${port}`); });
  } else fail('osc listen <port> | osc heard <port> | osc send <port> <address> [args…]');
}

(async () => {
  const mods = ['shift', 'cmd', 'alt', 'ctrl'].filter((m) => flags.has(`--${m}`));
  const num = (i: number) => Number(words[i]);
  const byText = words.length && Number.isNaN(Number(words[0]));
  switch (verb) {
    case 'start': return start();
    case 'look': return say({ op: 'look' });
    case 'click': return say(byText ? { op: 'click', text: words[0], nth: Number(flagValue('--nth')) || 0, double: flags.has('--double'), right: flags.has('--right'), mods }
                                    : { op: 'click', x: num(0), y: num(1), double: flags.has('--double'), right: flags.has('--right'), mods });
    case 'drag': return say({ op: 'drag', x: num(0), y: num(1), x2: num(2), y2: num(3) });
    case 'scroll': return say({ op: 'scroll', x: num(0), y: num(1), by: words[2] === undefined ? 300 : num(2) });
    case 'type': return say({ op: 'type', text: words.join(' ') });
    case 'key': return say({ op: 'key', key: words[0] });
    case 'menus': return say({ op: 'menus' });
    case 'menu': return say({ op: 'menu', path: words.join(' ') });
    case 'answer': return say(flags.has('--cancel') ? { op: 'answer', cancel: true } : flagValue('--button') ? { op: 'answer', button: flagValue('--button') } : { op: 'answer', paths: words });
    case 'choose': return say(byText ? { op: 'choose', text: words[0], option: words[1], nth: Number(flagValue('--nth')) || 0 } : { op: 'choose', x: num(0), y: num(1), option: words[2] });
    case 'hear': return say({ op: 'hear' });
    case 'wait': await sleep(Math.min(60, Math.max(0, num(0) || 1)) * 1000); mark({ op: 'wait', args: { seconds: num(0) } }); return console.log(`waited ${num(0)} s`);
    case 'task': mark({ op: 'task', task: words[0] }); return console.log(`task ${words[0]} started`);
    case 'note': mark({ op: 'note', text: words.join(' ') }); return console.log('noted');
    case 'osc': return osc();
    case 'stop': {
      if (door()) { const r = await send({ op: 'stop' }); console.log(r.text || r.error); fs.rmSync(path.join(dir, 'door.json'), { force: true }); }
      try { for (const pid of fs.readFileSync(path.join(dir, 'listeners.txt'), 'utf8').split('\n').filter(Boolean)) { try { process.kill(Number(pid)); } catch { /* gone */ } } fs.rmSync(path.join(dir, 'listeners.txt')); } catch { /* none */ }
      return undefined;
    }
    default: fail(`unknown: ${verb}`);
  }
})();
