/**
 * The scenes of the sound comparison (test/sound-compare/qlab.ts): each a small QLab workspace, built by AppleScript
 * from what is written here, and the GOs and starts to play it with, at their moments. The same workspace is then
 * imported into Endless Cues and played the same way.
 *
 * A cue is written as QLab has it: its type, number, file, the levels of its matrix ([row, column, dB], as
 * `setLevel` takes them) and any other property by its AppleScript name, with the value as AppleScript writes it.
 * `shape` is a Fade cue's curve for a level going up and down (QLab's FadeShape `type` and `curveParameter`), and
 * `trim` an Audio cue's trim on its main level, which AppleScript cannot set: they are written into the saved
 * workspace afterwards (qlab.ts `rewrite`).
 */
import type { Signal } from './signals';

export interface QCue {
  type: 'Audio' | 'Fade' | 'Group' | 'Stop' | 'Start' | 'Devamp' | 'Memo' | 'MIDI';
  n: string;
  name?: string;
  file?: string;
  levels?: [number, number, number][];
  set?: Record<string, string>;
  target?: string;
  children?: QCue[];
  shape?: { type: number; p?: number };
  /** the trim on its main level, in dB (QLab 4 kept one beside each level; QLab 5 has no word for it) */
  trim?: number;
}
/** What is done, at `at` seconds from the first step: GO, a cue started or stopped by its number, a panic. */
export interface Step { at: number; do: 'go' | 'start' | 'stop' | 'panic'; cue?: string }
export interface Scene {
  id: string;
  what: string;
  files: Record<string, Signal>;
  cues: QCue[];
  steps: Step[];
  /** how long to record after the first step */
  secs: number;
  /** what the analysis follows: each tone's frequency, by a name for it */
  tones: Record<string, number>;
  /** level traces worth reading closely: [tone, from s, to s] */
  traces?: [string, number, number][];
  /** when each tone should start as the workspace is written (s from the first step): the analysis says how late each is */
  nominal?: [string, number][];
}

const go = (at: number): Step => ({ at, do: 'go' });
const stereo = (f: number, secs: number): Signal => ({ kind: 'tone', f, secs, channels: 2 });

export const SCENES: Scene[] = [
  {
    id: 'levels',
    what: 'A cue\'s main level, its output and input levels, crosspoints, and a mono file on QLab\'s default crosspoints',
    files: { lr: { kind: 'tone', f: 1000, f2: 1400, secs: 1, channels: 2 }, mono: { kind: 'tone', f: 1800, secs: 1, channels: 1 } },
    tones: { L: 1000, R: 1400, M: 1800 },
    cues: [
      { type: 'Audio', n: '1', name: 'stereo at 0', file: 'lr' },
      { type: 'Audio', n: '2', name: 'stereo main -6', file: 'lr', levels: [[0, 0, -6]] },
      { type: 'Audio', n: '3', name: 'stereo main -6, output 1 -4', file: 'lr', levels: [[0, 0, -6], [0, 1, -4]] },
      { type: 'Audio', n: '4', name: 'crosspoints L-3 R-8', file: 'lr', levels: [[1, 1, -3], [2, 2, -8]] },
      { type: 'Audio', n: '5', name: 'mono default', file: 'mono' },
      { type: 'Audio', n: '6', name: 'mono to both at 0', file: 'mono', levels: [[1, 2, 0]] },
      { type: 'Audio', n: '7', name: 'mono to both at -3', file: 'mono', levels: [[1, 1, -3], [1, 2, -3]] },
      { type: 'Audio', n: '8', name: 'mono 0 and -10', file: 'mono', levels: [[1, 2, -10]] },
      { type: 'Audio', n: '9', name: 'stereo, L also to 2 at -6', file: 'lr', levels: [[1, 2, -6]] },
      { type: 'Audio', n: '10', name: 'stereo main +6', file: 'lr', levels: [[0, 0, 6]] },
      { type: 'Audio', n: '11', name: 'stereo input 1 -6', file: 'lr', levels: [[1, 0, -6]] },
    ],
    steps: Array.from({ length: 11 }, (_, i) => go(i * 1.2)),
    secs: 13.5,
  },
  {
    id: 'timing',
    what: 'Pre- and post-waits, auto-continue and auto-follow, groups in each mode, a Start cue',
    files: { e: stereo(2600, 0.3), f: stereo(3000, 0.3), g: stereo(3400, 0.3), h: stereo(600, 0.3) },
    tones: { E: 2600, F: 3000, G: 3400, H: 600 },
    cues: [
      { type: 'Audio', n: '1', file: 'e', set: { 'continue mode': 'auto_continue', 'post wait': '0.25' } },
      { type: 'Audio', n: '2', file: 'f', set: { 'pre wait': '0.4', 'continue mode': 'auto_follow' } },
      { type: 'Audio', n: '3', file: 'g', set: { 'continue mode': 'auto_continue' } },
      { type: 'Audio', n: '4', file: 'h', set: { 'pre wait': '0.2' } },
      { type: 'Group', n: '5', name: 'timeline', set: { mode: 'timeline' }, children: [
        { type: 'Audio', n: '5.1', file: 'e' }, { type: 'Audio', n: '5.2', file: 'f', set: { 'pre wait': '0.2' } }, { type: 'Audio', n: '5.3', file: 'g', set: { 'pre wait': '0.5' } }] },
      { type: 'Group', n: '6', name: 'start first and enter', set: { mode: 'start_first_and_enter' }, children: [
        { type: 'Audio', n: '6.1', file: 'e', set: { 'continue mode': 'auto_continue', 'post wait': '0.3' } }, { type: 'Audio', n: '6.2', file: 'f' }, { type: 'Audio', n: '6.3', file: 'g' }] },
      { type: 'Group', n: '7', name: 'start first', set: { mode: 'start_first' }, children: [
        { type: 'Audio', n: '7.1', file: 'e' }, { type: 'Audio', n: '7.2', file: 'f' }] },
      { type: 'Group', n: '8', name: 'random', set: { mode: 'start_random' }, children: [
        { type: 'Audio', n: '8.1', file: 'e' }, { type: 'Audio', n: '8.2', file: 'f' }, { type: 'Audio', n: '8.3', file: 'g' }] },
      { type: 'Audio', n: '9', file: 'h', set: { 'pre wait': '0.3', 'post wait': '0.4', 'continue mode': 'auto_continue' } },
      { type: 'Audio', n: '10', file: 'e' },
      { type: 'Start', n: '11', target: '4' },
    ],
    // (6 enters its group: the GO at 5 plays 6.3; the one at 6.5 plays 7)
    steps: [go(0), go(2), go(3.5), go(5), go(6.5), go(8), go(9.5), go(11)],
    secs: 12.5,
    // (2 after 1's post-wait and its own pre-wait; 3 when 2 ends; 4 after its pre-wait; the groups' children by their
    // pre-waits; 9 after its pre-wait, 10 after 9's post-wait; 11 starts 4, with 4's pre-wait)
    nominal: [['E', 0], ['F', 0.65], ['G', 0.95], ['H', 1.15], ['E', 2], ['F', 2.2], ['G', 2.5], ['E', 3.5], ['F', 3.8], ['G', 5], ['E', 6.5],
      ['E', 8], ['F', 8], ['G', 8], ['H', 9.8], ['E', 10.2], ['H', 11.2]],
  },
  {
    id: 'fades',
    what: 'Fade cues with QLab\'s default curve: down, up, relative, and to silence stopping the target',
    files: { d: stereo(2200, 13) },
    tones: { D: 2200 },
    cues: [
      { type: 'Audio', n: '1', file: 'd' },
      { type: 'Fade', n: '2', target: '1', levels: [[0, 0, -20]], set: { duration: '2' } },
      { type: 'Fade', n: '3', target: '1', levels: [[0, 0, 0]], set: { duration: '2' } },
      { type: 'Fade', n: '4', target: '1', levels: [[0, 0, -10]], set: { duration: '1', 'audio fade mode': 'relative' } },
      { type: 'Fade', n: '5', target: '1', levels: [[0, 0, -120]], set: { duration: '2', 'stop target when done': 'true' } },
    ],
    steps: [go(0), go(1), go(4), go(7), go(9)],
    secs: 12,
    traces: [['D', 0.9, 3.4], ['D', 3.9, 6.4], ['D', 6.9, 8.4], ['D', 8.9, 11.5]],
  },
  {
    id: 'shapes',
    what: 'Fade cues with each of QLab\'s curve shapes (its FadeShape type and curve parameter, written into the file), down and up',
    files: { d: stereo(2200, 30) },
    tones: { D: 2200 },
    cues: [
      { type: 'Audio', n: '1', file: 'd' },
      ...([[0, 1], [1, 1], [1, 0.5], [1, 2], [2, 1]] as const).flatMap(([type, p], i) => [
        { type: 'Fade' as const, n: `${2 * i + 2}`, name: `type ${type} p ${p} down`, target: '1', levels: [[0, 0, -20]] as [number, number, number][], set: { duration: '2' }, shape: { type, p } },
        { type: 'Fade' as const, n: `${2 * i + 3}`, name: `type ${type} p ${p} up`, target: '1', levels: [[0, 0, 0]] as [number, number, number][], set: { duration: '2' }, shape: { type, p } }]),
    ],
    steps: [go(0), ...Array.from({ length: 10 }, (_, i) => go(1 + i * 2.6))],
    secs: 28,
    traces: Array.from({ length: 10 }, (_, i) => ['D', 0.9 + i * 2.6, 3.4 + i * 2.6] as [string, number, number]),
  },
  {
    id: 'trim',
    what: 'A trim on a cue\'s main level, as QLab 4 kept one (written into the file)',
    files: { lr: { kind: 'tone', f: 1000, f2: 1400, secs: 1, channels: 2 } },
    tones: { L: 1000, R: 1400 },
    cues: [
      { type: 'Audio', n: '1', name: 'main -6, no trim', file: 'lr', levels: [[0, 0, -6]] },
      { type: 'Audio', n: '2', name: 'main -6, trim -6', file: 'lr', levels: [[0, 0, -6]], trim: -6 },
      { type: 'Audio', n: '3', name: 'main 0, trim -10', file: 'lr', trim: -10 },
    ],
    steps: [go(0), go(1.3), go(2.6)],
    secs: 4,
  },
  {
    id: 'loops',
    what: 'A play count, an infinite loop stopped, slices with a count, a slice looped until a Devamp, a Devamp that starts the next cue',
    files: { burst: { kind: 'burst', f: 1400, on: 0.3, secs: 0.5, channels: 2 }, sl: { kind: 'slices', fs: [2600, 3000, 3400], each: 1, channels: 2 }, h: stereo(600, 0.3) },
    tones: { B: 1400, E: 2600, F: 3000, G: 3400, H: 600 },
    cues: [
      { type: 'Audio', n: '1', file: 'burst', set: { 'play count': '3' } },
      { type: 'Audio', n: '2', file: 'burst', set: { 'infinite loop': 'true' } },
      { type: 'Stop', n: '3', target: '2' },
      { type: 'Audio', n: '4', file: 'sl', set: { 'slice markers': '{{time:1.0, playCount:1}, {time:2.0, playCount:3}}' } },
      { type: 'Audio', n: '5', file: 'sl', set: { 'slice markers': '{{time:1.0, playCount:1}, {time:2.0, playCount:-1}}' } },
      { type: 'Devamp', n: '6', target: '5' },
      { type: 'Audio', n: '7', file: 'burst', set: { 'infinite loop': 'true' } },
      { type: 'Devamp', n: '8', target: '7', set: { 'start next cue when slice ends': 'true' } },
      { type: 'Audio', n: '9', file: 'h' },
    ],
    steps: [go(0), go(2), go(3.6), go(4.5), go(10), go(13.3), go(16), go(17.2)],
    secs: 19,
    nominal: [['B', 0], ['B', 0.5], ['B', 1], ['B', 2], ['B', 2.5], ['B', 3], ['B', 3.5], ['E', 4.5], ['F', 5.5], ['G', 8.5], ['E', 10], ['F', 11], ['G', 14],
      ['B', 16], ['B', 16.5], ['B', 17], ['H', 17.5]],
  },
  {
    id: 'stops',
    what: 'Fade and stop others (peers), a Stop cue, a panic',
    files: { a: stereo(1000, 8), c: stereo(1800, 8), d: stereo(2200, 8) },
    tones: { A: 1000, C: 1800, D: 2200 },
    cues: [
      { type: 'Audio', n: '1', file: 'a' },
      { type: 'Audio', n: '2', file: 'c', set: { 'fade and stop others': '1', 'fade and stop others time': '1' } },
      { type: 'Stop', n: '3', target: '2' },
      { type: 'Audio', n: '4', file: 'd' },
    ],
    steps: [go(0), go(1), go(3), go(4), { at: 5, do: 'panic' }],
    secs: 8,
    traces: [['A', 0.9, 2.3], ['C', 2.9, 3.3], ['D', 4.9, 7.5]],
  },
  {
    id: 'duck',
    what: 'A cue that ducks the others while it plays',
    files: { a: stereo(1000, 8), c: stereo(1800, 2) },
    tones: { A: 1000, C: 1800 },
    cues: [
      { type: 'Audio', n: '1', file: 'a' },
      { type: 'Audio', n: '2', file: 'c', set: { 'duck others': 'enabled', 'duck level': '-10', 'duck time': '1' } },
      { type: 'Stop', n: '3', target: '1' },
    ],
    steps: [go(0), go(1), go(6)],
    secs: 7,
    traces: [['A', 0.5, 5.5]],
  },
  {
    id: 'second',
    what: 'A running cue started again: the second trigger at QLab\'s default (nothing), stop, and hard stop and restart',
    files: { a: stereo(1000, 3), c: stereo(1800, 3), d: stereo(2200, 3) },
    tones: { A: 1000, C: 1800, D: 2200 },
    cues: [
      { type: 'Audio', n: '1', file: 'a' },
      { type: 'Audio', n: '2', file: 'c', set: { 'second trigger action': '2' } },
      { type: 'Audio', n: '3', file: 'd', set: { 'second trigger action': '4' } },
    ],
    steps: [{ at: 0, do: 'start', cue: '1' }, { at: 1, do: 'start', cue: '1' }, { at: 4.5, do: 'start', cue: '2' }, { at: 5.5, do: 'start', cue: '2' }, { at: 9, do: 'start', cue: '3' }, { at: 10, do: 'start', cue: '3' }],
    secs: 14,
  },
];

const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** The AppleScript that builds a scene's cues in the workspace named `ws` and saves it. */
export function applescript(scene: Scene, ws: string, media: (file: string) => string): string {
  const lines: string[] = [];
  const cue = (c: QCue, depth: number, parent: string | null) => {
    const v = `c${depth}`;
    lines.push(`      set ${v} to my mk(${q(c.type)}, ${q(c.n)}, ${q(c.name || '')})`);
    if (c.file) lines.push(`      set file target of ${v} to POSIX file ${q(media(c.file))}`);
    if (c.target) lines.push(`      set cue target of ${v} to cue ${q(c.target)}`);
    for (const [r, col, db] of c.levels || []) lines.push(`      setLevel ${v} row ${r} column ${col} db ${db}`);
    for (const [k, val] of Object.entries(c.set || {})) lines.push(`      set ${k} of ${v} to ${val}`);
    if (parent) lines.push(`      move cue id (uniqueID of ${v}) to end of cue id (uniqueID of ${parent})`);
    for (const k of c.children || []) cue(k, depth + 1, v);
    if (c.children) lines.push(`      set selected to ${v}`);
  };
  for (const c of scene.cues) cue(c, 0, null);
  return `property W : missing value
on mk(t, n, nm)
  tell application id "com.figure53.QLab.5" to tell W
    make type t
    set s to selected
    if class of s is list then
      set c to last item of s
    else
      set c to s
    end if
    set q number of c to n
    if nm is not "" then set q name of c to nm
    return c
  end tell
end mk
on run argv
  tell application id "com.figure53.QLab.5"
    set W to workspace ${q(ws)}
    tell W
${lines.join('\n')}
      save
    end tell
  end tell
  return "saved"
end run
`;
}
