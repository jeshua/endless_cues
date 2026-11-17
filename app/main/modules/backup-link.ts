/**
 * Module: Main and backup.
 *
 * Two computers run the same show, and the second follows the first so it can take over.
 *
 *   on the MAIN     role "main": every transport command carried out here (GO, the playhead, starts, stops,
 *                   pauses, panic, reset, Load to Time) is said again to the backup, as OSC control messages
 *                   (core/net/mirror.js), to a network patch that is the backup's address and input port.
 *                   A "/thump" goes once a second, so each end knows the other is there.
 *   on the BACKUP   role "backup", and the OSC control module on (it is what obeys). This module only watches:
 *                   it says whether the main is being heard, and says so loudly when it stops.
 *
 * The backup must have the same saved show (copy the show folder; the mirror names cues by id). What taking
 * over needs beyond this is set out in docs/specs/06-control-surfaces.md: it is a person's decision, and it is
 * made by hand.
 */
import { mirror, MIRRORED } from '../../../core/net/mirror';
import type { MirroredCmd, MirroredResult } from '../../../core/net/mirror';
import type { HostCommand, HostResult, ModuleContext, ModuleField, Playhead } from '../host';

interface Config { role: string; patch?: string; passcode?: string }

type Timer = ReturnType<typeof setInterval>;

const THUMP_MS = 1000;
const QUIET_MS = 3500;             // the main unheard for this long: said on the backup

export const id = 'backup-link';
export const name = 'Main and backup';
export const summary = 'A second computer follows this one in step (GO, the playhead, stops), ready to take over.';
export const needsInput = true;
export const details = 'Both computers open the same saved show. On the main: role “main”, and a network patch that is the backup’s address and its OSC input port (53000). On the backup: role “backup”, the OSC control module on (with the same passcode, if it has one), and its outputs held back (Tools ▸ Hold Back OSC Out, MIDI Out) with its sound muted or not patched, so the equipment hears one computer. To take over: let the outputs go and bring its sound up. Edits, the mixer and cues fired by OSC, MIDI or clock triggers are not mirrored.';
export const fields: ModuleField[] = [
    { key: 'role', label: 'This computer is', kind: 'enum', options: ['main', 'backup'] },
    { key: 'patch', label: 'The backup (on the main)', kind: 'patch' },
    { key: 'passcode', label: 'The backup’s OSC passcode', kind: 'text', placeholder: 'none' },
  ];
export function create({ host, net, log = () => {}, changed = () => {}, now = Date.now, every = setInterval, never = clearInterval }: ModuleContext & { now?: () => number; every?: (fn: () => void, ms: number) => Timer; never?: (t: Timer) => void }) {
    let cfg: Config | null = null, sent = 0, timer: Timer | null = null, heardAt = 0, heard = 0, off: (() => void) | null = null, lost = false, beats = 0;
    const send = (text: string, label = 'backup') => { if (net && cfg!.patch) { net.send(cfg!.patch, text, { label }); sent++; } };
    const connect = () => { if (cfg!.passcode) send(`/connect ${cfg!.passcode}`, 'backup'); };
    return {
      start(config: Partial<Config>) {
        cfg = { role: 'main', ...config }; sent = 0; heard = 0; heardAt = 0; lost = false; beats = 0;
        if (cfg!.role === 'main') {
          connect();
          // (the passcode again every half minute: the backup forgets a silent sender, and may have been restarted)
          timer = every(() => { if (++beats % 30 === 0) connect(); send('/thump', 'backup heartbeat'); sent--; }, THUMP_MS);
        } else {
          // everything the main says arrives on the input port; this only notes that it did (OSC control obeys it)
          if (net) off = net.onMessage(() => { heardAt = now(); heard++; if (lost) { lost = false; log('the main is being heard again'); } return false; });
          timer = every(() => {
            if (heardAt && !lost && now() - heardAt > QUIET_MS) { lost = true; log('the main has gone quiet'); if (host.notice) host.notice('The main computer has gone quiet. This backup is where the show was. To take over: let the outputs go (Tools ▸ Hold Back) and bring the sound up.', 20000); }
            changed();
          }, THUMP_MS);
        }
      },
      stop() { if (timer) never(timer); timer = null; if (off) off(); off = null; },
      /** A command the host has just carried out (main only): said again to the backup. */
      onCommand(c: HostCommand, result: HostResult | Promise<HostResult>, before: Playhead, after: Playhead) {
        if (!cfg || cfg.role !== 'main' || !c || !MIRRORED.has(c.op)) return;
        for (const text of mirror(c as MirroredCmd, { before, after, result: result as MirroredResult })) send(text);
      },
      status() {
        if (cfg!.role === 'main') {
          if (!cfg!.patch) return { ok: false, text: 'choose the patch that is the backup' };
          const p = net ? (net.status().patches[cfg!.patch] || null) : null;
          if (!p) return { ok: false, text: 'its patch is gone' };
          return p.state === 'answering' ? { ok: true, text: `the backup is answering · ${sent} sent` } : { ok: false, text: p.state === 'error' ? p.text : `no answer from the backup · ${sent} sent` };
        }
        if (!heardAt) return { ok: false, text: 'waiting to hear the main' };
        const quiet = now() - heardAt;
        return quiet > QUIET_MS ? { ok: false, text: `the main has not been heard for ${Math.round(quiet / 1000)} s` } : { ok: true, text: `following the main · ${heard} heard` };
      },
    };
  }
