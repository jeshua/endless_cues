/** The hand-over (core/assistant/guide.ts): the guide a coding agent reads first, written from the show. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { agentGuide } from '../core/assistant/guide';
import * as showFiles from '../core/show/files';
import { build } from './helpers';
import type { Device } from '../core/show/types';

const doc = () => build([
  { op: 'cue.add', cue: { type: 'memo', number: '1', name: 'Places' } },
  { op: 'device.add', device: { name: 'Lantern A', model: 'ec-prop-light', host: '10.0.0.42' } },
  { op: 'device.add', device: { name: 'Sampler', kind: 'instrument', via: 'midi', commands: [{ id: 'scene', label: 'Scene', template: 'pc {n} ch 10', params: [{ key: 'n', kind: 'number', default: 1 }] }] } as Partial<Device> },
  { op: 'show.set', path: 'settings.rig.script', value: 'script.md' },
]).doc;

test('the guide names every device with its commands, the script, the props, and this computer’s real paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec guide-'));
  fs.mkdirSync(path.join(dir, 'props', 'lantern_a'), { recursive: true });
  const bin = path.join(dir, 'app dir', 'bin');
  const files = agentGuide(doc(), { showDir: dir, bin });
  assert.deepEqual(files.map((f) => f.path), ['AGENTS.md', 'CLAUDE.md']);
  assert.equal(files[1].text, '@AGENTS.md\n');
  const g = files[0].text;
  assert.match(g.split('\n')[0], /written again, whole, each time/);
  for (const words of ['# Test: an Endless Cues show', '**Lantern A** (`lantern_a`)', '10.0.0.42:53100', '`effect` Effect: `/ec/effect {name}`', '`/ec/hello` every 2 s', '**Sampler** (`sampler`)', 'MIDI', '`pc {n} ch 10`', '`script.md`', '`lantern_a/`',
    `claude mcp add endless-cues -- node "${path.join(bin, 'ec-mcp.js')}"`, `node "${path.join(bin, 'ec.js')}" apply . ops.json`, '--show .', 'show.unsaved.json', 'versions/', 'secrets.h', '/ec/here <name:s>', 'Not HTTP, MQTT or a serial port', 'does not compile or flash']) assert.ok(g.includes(words), words);
  // the rules an agent must not get wrong
  for (const rule of [/Change the show only through the Endless Cues tools or `ec apply`/, /If `show\.unsaved\.json` exists, do not use `ec apply`/, /Never play, stop or save/, /Send nothing to the equipment unless they ask/]) assert.match(g, rule);
  assert.ok(g.split('\n').length < 140, 'what an agent needs and nothing more');
  assert.equal(showFiles.check(dir, files).ok, true, 'a proposal may carry them');
});

test('a show with no equipment and no folder still gets a true guide', () => {
  const g = agentGuide(build([]).doc)[0].text;
  assert.match(g, /Equipment: no devices yet\./);
  assert.match(g, /Script: none named\./);
  assert.match(g, /Under `props\/`: nothing yet\./);
  assert.match(g, /0 cues in 1 list/);
});

test('from an installed app the guide’s command lines run the app’s own program as Node (its scripts are in an archive plain Node cannot read)', () => {
  const { runner, commandLines } = require('../core/assistant/guide');
  assert.deepEqual(runner({ dir: '/src/endless_cues/core/assistant', versions: { node: '22' } }), { command: 'node', env: {}, packaged: false });
  assert.equal(runner({ dir: '/src/endless_cues/core/assistant', versions: { electron: '43' } }).command, 'node', 'run from source in Electron: still node');
  const exe = '/Applications/Endless Cues Public Alpha.app/Contents/MacOS/Endless Cues Public Alpha';
  const run = runner({ dir: '/Applications/Endless Cues Public Alpha.app/Contents/Resources/app.asar/core/assistant', versions: { electron: '43' }, execPath: exe });
  assert.deepEqual(run, { command: exe, env: { ELECTRON_RUN_AS_NODE: '1' }, packaged: true });
  const bin = '/Applications/Endless Cues Public Alpha.app/Contents/Resources/app.asar/bin';
  const lines = commandLines(`${bin}/ec-mcp.js`, run, 'darwin');
  assert.equal(lines.claude, `claude mcp add endless-cues --env ELECTRON_RUN_AS_NODE=1 -- "${exe}" "${bin}/ec-mcp.js"`);
  assert.equal(lines.shell, `ELECTRON_RUN_AS_NODE=1 "${exe}" "${bin}/ec-mcp.js"`);
  const g = agentGuide(build([]).doc, { bin, run, platform: 'darwin' })[0].text;
  assert.ok(g.includes(`ELECTRON_RUN_AS_NODE=1 "${exe}" "${bin}/ec.js" check .`), 'the shell lines');
  assert.ok(g.includes(`${lines.claude} --show .`), 'the tools on the folder alone');
  assert.match(g, /no separate Node\.js is needed/);
});

test('on Windows the command lines are PowerShell’s: backslashes as they are, `$env:` for the variable, `&` before a quoted program', () => {
  const { runner, commandLines } = require('../core/assistant/guide');
  const exe = 'C:\\Users\\Ana\\AppData\\Local\\Programs\\Endless Cues Public Alpha\\Endless Cues Public Alpha.exe';
  const bin = 'C:\\Users\\Ana\\AppData\\Local\\Programs\\Endless Cues Public Alpha\\resources\\app.asar\\bin';
  const run = runner({ dir: `${bin}\\..\\core\\assistant`, versions: { electron: '43' }, execPath: exe });
  assert.equal(run.packaged, true);
  const lines = commandLines(`${bin}\\ec-mcp.js`, run, 'win32');
  assert.equal(lines.shell, `$env:ELECTRON_RUN_AS_NODE=1; & "${exe}" "${bin}\\ec-mcp.js"`);
  assert.equal(lines.claude, `claude mcp add endless-cues --env ELECTRON_RUN_AS_NODE=1 -- "${exe}" "${bin}\\ec-mcp.js"`);
  assert.ok(!/\\\\/.test(lines.claude), 'no doubled backslash');
  const src = 'C:\\Users\\Ana\\My Shows\\endless_cues\\bin';
  assert.equal(commandLines(`${src}\\ec.js`, runner({ dir: 'C:\\src\\core\\assistant', versions: { node: '22' } }), 'win32').shell, `node "${src}\\ec.js"`, 'from source: node needs no &');
  const g = agentGuide(build([]).doc, { bin, run, platform: 'win32' })[0].text;
  assert.ok(g.includes(`$env:ELECTRON_RUN_AS_NODE=1; & "${exe}" "${bin}\\ec.js" check .`), 'the PowerShell lines');
  assert.match(g, /From PowerShell, in this folder/);
});
