/**
 * A second computer in step with the first: what the main does to its transport, said again to the backup.
 *
 * `mirror(c, { before, after, result })` turns one host command that the main has just carried out into the
 * OSC messages that make the backup do the same, in the OSC control module's addresses (QLab's), so the
 * backup needs nothing but that module switched on and the same show open. Cues are named by id: both
 * computers have the same show file, and a number can be missing or used twice.
 *
 * Only the transport is mirrored: GO, the playhead, starts and stops, pauses, panic, reset, Load to Time.
 * Not mirrored, on purpose: edits (the backup must be given the same saved show), the mixer, a seek or a loop
 * held by hand, and Show mode. A cue fired by an OSC, MIDI or clock trigger is not a command and is not
 * mirrored either: send the trigger to both computers.
 *
 * A GO is sent as "stand by on the cue the main fired, then GO", and every command is followed by where the
 * main's playhead now is when that changed: a message lost on the way costs the backup one cue, never its place.
 */
/** A host command, as mirror reads it. */
export interface MirroredCmd { op?: unknown; id?: string | null; [field: string]: unknown }
/** What the main's command did: the host's answer. */
export interface MirroredResult { error?: unknown; ignored?: unknown; loaded?: { at?: unknown } | null }

const cueAddr = (id: string, verb: string) => `/cue_id/${encodeURIComponent(id)}/${verb}`;
const head = (id: string | null | undefined) => `/playheadID/${id ? encodeURIComponent(id) : 'none'}`;

function mirror(c: MirroredCmd | null | undefined, { before = {}, after = {}, result = null }: { before?: { playhead?: string | null }; after?: { playhead?: string | null }; result?: MirroredResult | null } = {}): string[] {
  if (!c || typeof c.op !== 'string' || (result && result.error)) return [];
  const out: string[] = [];
  const id = c.id || null;
  switch (c.op) {
    case 'go':
      if (result && result.ignored) return [];                      // double-GO protection dropped it here: it did not happen
      if (before.playhead) out.push(head(before.playhead));
      out.push('/go');
      break;
    case 'panic': out.push(c.hard ? '/hardStop' : '/panic'); break;
    case 'fadeall': out.push(`/panicInTime ${Number(c.secs) || 5}`); break;
    case 'reset': out.push('/reset'); break;
    case 'pause': out.push(id ? cueAddr(id, 'pause') : '/pause'); break;
    case 'resume': out.push(id ? cueAddr(id, 'resume') : '/resume'); break;
    case 'toggle': if (id) out.push(cueAddr(id, 'togglePause')); break;
    case 'stop': if (id) out.push(cueAddr(id, c.fade ? 'panic' : 'stop')); break;
    case 'start': if (id) out.push(cueAddr(id, 'start')); break;
    case 'fire': if (id) out.push(cueAddr(id, 'preview')); break;
    case 'load': if (after.playhead && result && result.loaded) out.push(`${cueAddr(after.playhead, 'loadAt')} ${Number(result.loaded.at) || 0}`); else if (after.playhead) out.push(`${cueAddr(after.playhead, 'loadAt')} 0`); break;
    case 'playhead': case 'move': case 'jump': case 'list': break;   // (only where the playhead ends up matters: below)
    default: return [];
  }
  if (after.playhead !== before.playhead || c.op === 'go') out.push(head(after.playhead));
  return out;
}

/** The commands that are transport (the rest are never looked at). */
const MIRRORED = new Set(['go', 'panic', 'fadeall', 'reset', 'pause', 'resume', 'toggle', 'stop', 'start', 'fire', 'load', 'playhead', 'move', 'jump', 'list']);

export { mirror, MIRRORED };
