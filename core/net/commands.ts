/**
 * Show commands from any OSC message: for a device that cannot be told what to send (a button box with
 * fixed addresses, a desk's macro), the show is told what to listen for instead.
 *
 *   settings.network.commands   { go: '/box/button/1', panic: '/box/button/4 1', … }      '' is none
 *
 * Each is written as a cue's OSC trigger is: an address (OSC patterns allowed), then, if it should only
 * count with certain arguments, those arguments. It mirrors settings.midi.commands, command for command.
 * These are obeyed whether or not the OSC control module is on, and need no passcode (as in QLab 5).
 */
import * as osc from './osc';
import type { ShowCommands } from '../show/types';

/** A show command: its label, and the host `cmd` it sends. */
export interface ShowCommand { label: string; cmd: { op: string; step?: number } }

// what each command is to the host (app/main/host.js `cmd`)
const COMMANDS: Record<string, ShowCommand> = {
  go: { label: 'GO', cmd: { op: 'go' } },
  panic: { label: 'Panic', cmd: { op: 'panic' } },
  pause: { label: 'Pause all', cmd: { op: 'pause' } },
  resume: { label: 'Resume all', cmd: { op: 'resume' } },
  next: { label: 'Playhead down', cmd: { op: 'move', step: 1 } },
  previous: { label: 'Playhead up', cmd: { op: 'move', step: -1 } },
};

/** "/address 1 two" as a thing to match: { address, args } ('' for args: any), or null if it is not an address. */
function parse(text: unknown): { address: string; args: string } | null {
  const t = String(text || '').trim();
  if (!t.startsWith('/')) return null;
  const [address, ...rest] = t.split(/\s+/);
  return { address, args: rest.join(' ') };
}

/** The commands a message is set to: [{ what, cmd }] (none: []). */
function commandsFor(commands: Partial<ShowCommands> | null | undefined, msg: { address: string; args?: unknown[] }): { what: string; cmd: ShowCommand['cmd'] }[] {
  const said = (msg.args || []).map(String).join(' ');
  const out: { what: string; cmd: ShowCommand['cmd'] }[] = [];
  for (const [what, text] of Object.entries(commands || {})) {
    const want = COMMANDS[what] && parse(text);
    if (!want || !osc.matches(want.address, msg.address) || (want.args && want.args !== said)) continue;
    out.push({ what, cmd: { ...COMMANDS[what].cmd } });
  }
  return out;
}

export { COMMANDS, parse, commandsFor };
