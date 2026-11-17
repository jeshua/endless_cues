/**
 * The hand-over: a guide that makes a show folder a place a coding agent can work in.
 *
 * When what a person wants is beyond what the assistant does here (a protocol the devices cannot describe,
 * firmware beyond the kit's settings, a program beside the show), the honest answer is "not here", and a
 * show folder that Claude Code, Codex or any other coding agent can open and work in safely. This writes
 * the one file such an agent reads first.
 *
 *   agentGuide(doc, { showDir, bin, run, platform }) → [{ path: 'AGENTS.md', text }, { path: 'CLAUDE.md', text: '@AGENTS.md\n' }]
 *   runner() → how this app's scripts are run from a terminal here ({ command, env }): `node` from source, the app's own program from an installed app
 *
 * Generated from the show, never written by a model, and written again whole each time (its first line
 * says so). It holds what an agent needs and nothing more: what the folder is, the rules, the command
 * lines with this computer's real paths, the show as it is, the prop kit's protocol, and what the app
 * will not do. The files are staged on a proposal and written when a person accepts it.
 *
 * Plain node: it reads the names under props/ and nothing else.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as show from '../show/show';
import * as devices from '../rig/devices';
import * as kit from '../kit/kit';
import type { Device, ShowDoc } from '../show/types';

/** How this app's scripts are run here: the program, what it needs in its environment, and whether it is an installed app. */
export interface Runner { command: string; env: Record<string, string>; packaged: boolean }

// A path quoted for this computer's shell: a Unix shell escapes inside double quotes; PowerShell and cmd do not
// (a Windows path has no quote in it, and its backslashes are separators, not escapes).
const q = (p: string, win?: boolean) => (/^[\w@%+=:,./-]+$/.test(p) ? p : win ? `"${p}"` : `"${String(p).replace(/(["\\$`])/g, '\\$1')}"`);

/**
 * How a script of this app (bin/ec.js, bin/ec-mcp.js) is run from a terminal on this computer.
 * From source: `node`. From an installed app the scripts are inside the app's archive, which plain Node cannot
 * read, and the person may have no Node at all: the app's own program is run as Node instead (ELECTRON_RUN_AS_NODE),
 * which reads the archive. → { command, env }
 */
function runner({ dir = __dirname, versions = process.versions, execPath = process.execPath }: { dir?: string; versions?: Record<string, string | undefined>; execPath?: string } = {}): Runner {
  const packaged = !!versions.electron && /\.asar([\\/]|$)/.test(dir);
  return packaged ? { command: execPath, env: { ELECTRON_RUN_AS_NODE: '1' }, packaged } : { command: 'node', env: {}, packaged };
}
/**
 * The command lines for a runner: one for a shell, and the one that gives Claude Code the app's tools.
 * On Windows the shell is PowerShell (the terminal Windows opens): `$env:` for a variable, `&` to run a quoted program.
 */
function commandLines(script: string, run: Runner = runner(), platform: string = process.platform) {
  const env = Object.entries(run.env || {}), win = platform === 'win32';
  const shell = win
    ? `${env.map(([k, v]) => `$env:${k}=${v}; `).join('')}${/^"/.test(q(run.command, win)) ? '& ' : ''}${q(run.command, win)} ${q(script, win)}`
    : `${env.map(([k, v]) => `${k}=${v} `).join('')}${q(run.command)} ${q(script)}`;
  return {
    shell,
    claude: `claude mcp add endless-cues ${env.map(([k, v]) => `--env ${k}=${v} `).join('')}-- ${q(run.command, win)} ${q(script, win)}`,
    codex: `[mcp_servers.endless_cues]\ncommand = ${JSON.stringify(run.command)}\nargs = [${JSON.stringify(script)}]${env.length ? `\nenv = { ${env.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')} }` : ''}`,
  };
}

function deviceLines(d: Device) {
  const a = d.alive || {};
  const where = devices.isNetwork(d) ? `${devices.viaOf(d)} over ${d.protocol || 'udp'} to ${d.host && d.port ? `${d.host}:${d.port}` : 'no address yet'}` : 'MIDI, on the show’s MIDI output';
  const asked = a.how === 'ask' ? `asked “are you there?” with \`${a.send}\` every ${a.every || 2} s${a.reply ? `, answers \`${a.reply}\`` : ''}` : a.how === 'heartbeat' ? `listened for${a.hears ? ` (\`${a.hears}\`)` : ''}` : 'cannot be asked whether it is there';
  const out = [`- **${d.name}** (\`${d.id}\`): ${d.kind || 'other'}${d.model ? `, started from the model \`${d.model}\`` : ''}; ${where}; ${asked}.`];
  for (const c of d.commands || []) out.push(`    - \`${c.id}\` ${c.label}: \`${c.template}\`${c.fade ? ` (fades ${c.fade})` : ''}`);
  if (d.notes) out.push(`    - Notes: ${String(d.notes).replace(/\s+/g, ' ').slice(0, 300)}`);
  return out;
}

function agentGuide(doc: ShowDoc, { showDir = null, bin = path.join(__dirname, '../../bin'), run = runner(), platform = process.platform }: { showDir?: string | null; bin?: string; run?: Runner; platform?: string } = {}) {
  const join = (platform === 'win32' ? path.win32 : path.posix).join;
  let cues = 0; show.walk(doc, () => { cues++; });
  const devs = devices.list(doc);
  const rig = doc.settings.rig || {};
  let props: string[] = [];
  if (showDir) { try { props = fs.readdirSync(path.join(showDir, 'props'), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort(); } catch { /* none */ } }
  const ec = commandLines(join(bin, 'ec.js'), run, platform).shell, mcp = commandLines(join(bin, 'ec-mcp.js'), run, platform).claude;
  const text = [
    '<!-- Written by Endless Cues, and written again, whole, each time the guide is made: do not edit it. Keep your own notes in another file. -->',
    `# ${doc.title}: an Endless Cues show`,
    '',
    'This folder is a show for Endless Cues, a show-control app: lists of cues that an operator fires one at a time with a GO button during a performance. You have been asked in because the person wants something the app’s own assistant does not do. Ask them what, if they have not said.',
    '',
    '## What is here',
    '',
    '- `show.json`: the show. Its cues, its settings, and the equipment it talks to (`settings.rig.devices`). Read it freely; change it only as the rules below say.',
    '- `versions/`, `backups/`, `logs/`, `recordings/`, `show.unsaved.json`: the app’s own. Never edit, move or delete them. `show.unsaved.json`, when it is there, is changes made in the app that have not been saved.',
    `- Everything else is the person’s: the sounds (a cue names a sound by its path in this folder)${rig.script ? `, the script (\`${rig.script}\`: a line \`@cue 12 Thunder\` in it marks where cue 12 is called; the app reads it and never writes it)` : ''}, and \`props/\` (firmware for the show’s props, one folder each).`,
    '',
    '## Rules',
    '',
    '1. **Change the show only through the Endless Cues tools or `ec apply`.** Both check every edit as the app does and apply a batch whole or not at all. Never write `show.json` yourself.',
    '2. **If `show.unsaved.json` exists, do not use `ec apply` or `--show`**: the app holds changes that would be lost. Work through the running app (the first command below), or ask the person to save first.',
    '3. **You propose; the person decides.** A change made through the tools appears in the app for them to review and accept. Never play, stop or save the show for them, and do not try to.',
    '4. **Send nothing to the equipment unless they ask.** A command does something on a stage, to people. `ec try` sends one; it is theirs to ask for.',
    '5. **`secrets.h` under `props/` holds a Wi-Fi password.** Never print it, copy it or commit it.',
    '',
    '## How to work on it',
    '',
    'With the show open in the app (Settings ▸ Assistant ▸ “Let coding agents work on the show” on), give yourself its tools:',
    '',
    '```',
    mcp,
    '```',
    '',
    'They are the tools the app’s own assistant has: read and search the show, edit a private draft, check it, dry-run it, and hand the result over as one change to review. The server’s instructions carry the rules and the reference in brief (cue types, edit operations, devices); its read_reference tool has each part in full. With no app running, the same tools on this folder directly (an accepted change is left as unsaved changes for the person to look at):',
    '',
    '```',
    `${mcp} --show .`,
    '```',
    '',
    `From ${platform === 'win32' ? 'PowerShell' : 'a shell'}, in this folder${run.packaged ? ' (each line runs the installed app’s own program as Node, so no separate Node.js is needed; the app may be open or not)' : ''}:`,
    '',
    '```',
    `${ec} outline .             every cue and device, as text`,
    `${ec} validate .            what would not work in a performance`,
    `${ec} check .               the Rig: what the show depends on and whether each part is ready (--ask asks each device)`,
    `${ec} devices .             each device and its commands`,
    `${ec} simulate . [from] [gos]   a dry run: what pressing GO does, second by second`,
    `${ec} apply . ops.json "note"   apply edit operations, saved as a new version`,
    '```',
    '',
    '## The show as it is',
    '',
    `- **${doc.title}**: ${cues} cue${cues === 1 ? '' : 's'} in ${doc.lists.length} list${doc.lists.length === 1 ? '' : 's'} (${doc.lists.map((l) => `${l.name}: ${l.cues.length} at the top level`).join('; ')}).`,
    `- Script: ${rig.script ? `\`${rig.script}\`` : 'none named.'}`,
    `- Under \`props/\`: ${props.length ? props.map((p) => `\`${p}/\``).join(', ') : 'nothing yet.'}`,
    `- Equipment: ${devs.length ? `${devs.length} device${devs.length === 1 ? '' : 's'}.` : 'no devices yet.'}`,
    ...devs.flatMap(deviceLines),
    '',
    'A device is data: an address, named commands (a message with `{holes}` for typed parameters), one way of asking whether it is there, and what to read out of its answers. A cue of type `device` sends one command. A new command for a device is a `device.set` edit, not code.',
    '',
    '## The prop kit’s protocol',
    '',
    'Props made with the app’s kit (the sketches under `props/`, the models `ec-prop-light` and `ec-prop-switch`) speak this. The likeliest job here is making a prop do something the kit does not: keep to this protocol where you can, so that the app’s Rig page still sees the prop, and add your own addresses beside `/ec/…` (then give the device a command for each). `config.h` is written again when the person asks the app for the firmware again; put code of your own in the sketch, and say so in a note on the device.',
    '',
    kit.protocol(),
    '',
    '## What the app will not do',
    '',
    'Do not try to make it: these are decisions, not gaps.',
    '',
    '- **It runs no code from a show.** Nothing in `show.json` is executed; a Script cue is a list of transport commands. Logic belongs in a program of yours beside the show, or in a prop.',
    '- **It speaks OSC, plain text and bytes over UDP and TCP, and MIDI. Not HTTP, MQTT or a serial port.** For equipment that needs one of those, the usual answer is a small bridge program in this folder that listens for OSC from the show and speaks the other protocol; then add it to the show as a device (address `127.0.0.1`, your port, a command for each message, and an “are you there?” it answers), so that it has a row on the Rig page.',
    '- **It does not compile or flash firmware.** That is the Arduino IDE or `arduino-cli`, with the board on a cable; each prop’s `README.md` has the steps.',
    '',
  ].join('\n');
  return [{ path: 'AGENTS.md', text }, { path: 'CLAUDE.md', text: '@AGENTS.md\n' }];
}

export { agentGuide, runner, commandLines };
