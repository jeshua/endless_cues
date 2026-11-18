/**
 * The cue types, as one table.
 *
 * Everything that needs to know "what is a Fade cue" reads this: the show file's
 * validation (show.ts), the edit operations (ops.ts), the inspector in the app
 * (which draws a field per entry), the assistant's tool description
 * (core/assistant), and docs/specs/03-show-file.md.
 *
 * A field's `kind` says how it is typed in, checked and shown:
 *   text | longtext | number | seconds | db | bool | enum | cue | file | patch | bus | color | markers | regions | tempo | camera | cell
 *   | matrix (a sound's own outputs): core/audio/routing.ts
 *   | eq (four bands on one sound) | chain (the tools one sound is played through) | sweep (what of a chain a Fade moves): core/audio/chain.ts
 *   | shape (a fade's curve: 'linear', 's-curve' or custom points) | envelope (a level drawn over a sound's length)
 *   | automation (the other lines drawn over it: pan, and settings of its chain): core/audio/lanes.ts
 *   | device (a device's id) | command (the id of one of that device's commands) | args ({ key: value } for that command's
 *     parameters): core/rig/devices.ts
 *
 * A number with `min` / `max` is refused outside them.
 *
 * `when: { key: [values] }` shows a field only while another field has one of those values (a playlist's settings).
 * `signed: true` on a time lets it be negative (a Load cue's "from the end"). On a target, `lists: true` lets it
 * be a whole cue list as well as a cue.
 * `whenTarget: [types]` shows a field only while the cue's target is one of those types (what a Fade moves on a picture).
 *
 * `advanced: true` folds a field under "More" in the inspector; `tab: 'triggers'` puts it on the inspector's
 * Triggers tab instead of Basics, `tab: 'design'` on its Sound design tab. `engine` names
 * the engine's field when it differs from the show file's.
 */

import { cleanShape, cleanEnvelope } from '../audio/curves';
import { TOOLS as SOUND_TOOLS, cleanChain, cleanSweep } from '../audio/chain';
import { cleanAutomation } from '../audio/lanes';
import type { Cue, CueList, CueIndex, CueType } from './types';

/** A field of a cue type, as the table says it (the kinds and keys are those in the comment above). */
export interface Field {
  key: string;
  kind: string;
  label: string;
  help?: string;
  /** the one plain line the inspector's ⓘ shows (TIPS) */
  tip?: string;
  default?: unknown;
  options?: readonly string[];
  labels?: Record<string, string>;
  required?: boolean;
  min?: number;
  max?: number;
  signed?: boolean;
  advanced?: boolean;
  hidden?: boolean;
  mono?: boolean;
  placeholder?: string;
  tab?: string;
  accept?: string;
  /** a file field: what kind of file it takes ('picture': a video or an image) */
  media?: string;
  engine?: string;
  /** a cue field: the types it may aim at (null: any) */
  targets?: readonly string[] | null;
  lists?: boolean;
  when?: Record<string, readonly unknown[]>;
  whenTarget?: readonly string[];
}

/** One cue type: what the list and the inspector show, and its own fields. */
export interface TypeDef {
  label: string;
  glyph: string;
  summary: string;
  fields: Field[];
  container?: boolean;
  heading?: boolean;
  stage?: boolean;
  /** the only fields of every cue it has */
  common?: string[];
  /** the engine's type, when it differs */
  engineType?: string;
}

/** What `coerce` says of a value: the value as the field wants it, or why it cannot be. */
export type Coerced = { ok: true; value: unknown } | { ok: false; why: string };

const COLORS = ['none', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey',
  'coral', 'amber', 'lime', 'forest', 'mint', 'sky', 'indigo', 'lavender', 'magenta', 'brown'];
// The colours the inspector and the list's menu offer first; any other is chosen with "…" (a colour wheel). The
// other names stay valid (older shows, the QLab import, the assistant), and a colour chosen on the wheel is kept as
// '#rrggbb', so a show file's `color` is a name or a hex value and every reader takes both (`cleanColor`).
const PALETTE = ['none', 'red', 'orange', 'yellow', 'green', 'blue'];
/** A cue's colour as the show keeps it: a name from COLORS, or '#rrggbb' (lower case); null when it is neither. */
function cleanColor(value: unknown) {
  const v = String(value ?? '').trim().toLowerCase();
  if (COLORS.includes(v)) return v;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return null;
}

/** Fields every cue has (QLab's Basics tab). */
const COMMON: Field[] = [
  { key: 'number', kind: 'text', label: 'Number', help: 'What the operator calls it. Any text, or none.' },
  { key: 'name', kind: 'text', label: 'Name' },
  { key: 'notes', kind: 'longtext', label: 'Notes', help: 'Shown in the masthead while it stands by.' },
  { key: 'color', kind: 'enum', label: 'Colour', options: COLORS, default: 'none' },
  { key: 'color2', kind: 'enum', label: 'Colour once played', options: COLORS, default: 'none', advanced: true,
    help: 'Its colour after it has fired, until Reset. None: unchanged.' },
  { key: 'flagged', kind: 'bool', label: 'Flagged', default: false },
  { key: 'armed', kind: 'bool', label: 'Armed', default: true, help: 'Disarmed: skipped, but still passes a continue on.' },
  { key: 'preWait', kind: 'seconds', label: 'Pre-wait', default: 0, help: 'Delay from the GO to its action.' },
  { key: 'postWait', kind: 'seconds', label: 'Post-wait', default: 0, help: 'With auto-continue: delay before the next cue.' },
  { key: 'continue', kind: 'enum', label: 'Continue', options: ['none', 'auto-continue', 'auto-follow'], default: 'none',
    help: 'auto-continue: the next fires as this starts. auto-follow: as it ends.' },
  { key: 'oscTrigger', kind: 'text', label: 'OSC trigger', mono: true, tab: 'triggers',
    help: 'An OSC address that fires it ("/sm/thunder", "/sm/*"), then any arguments.' },
  { key: 'fadeOthers', kind: 'seconds', label: 'Fade & stop others', default: 0, advanced: true,
    help: 'Fades out and stops everything else over this time. 0: off.' },
  { key: 'fadeOthersScope', kind: 'enum', label: 'Others are', options: ['all', 'list', 'peers'], default: 'all', advanced: true,
    help: 'all: everything. list: what its list started. peers: its group.' },
  { key: 'duckOthers', kind: 'db', label: 'Duck others', default: 0, signed: true, advanced: true,
    help: 'While it runs, the rest is held down (−12) or up (+3). 0: off.' },
  { key: 'duckTime', kind: 'seconds', label: 'Duck fade time', default: 1, advanced: true, help: 'How long they take to go down, and to come back.' },
  { key: 'autoLoad', kind: 'bool', label: 'Auto-load', default: false, advanced: true,
    help: 'Loads its sounds while standing by, for a tight start. Uses memory.' },
  { key: 'hotkey', kind: 'text', label: 'Hotkey', mono: true, tab: 'triggers',
    help: 'A key that fires it: "7", "shift+b", "F5". Not the app’s own keys.' },
  { key: 'clockTrigger', kind: 'text', label: 'Clock trigger', mono: true, tab: 'triggers',
    help: 'A time of day: 19:25, or 19:25 fri sat. Only while the app is open.' },
  { key: 'midiTrigger', kind: 'text', label: 'MIDI trigger', mono: true, tab: 'triggers',
    help: '"note 60", "note 60 ch 2", "pc 5", "cc 20 127". Left out: any.' },
  { key: 'timecodeTrigger', kind: 'text', label: 'Timecode trigger', mono: true, tab: 'triggers', placeholder: '01:00:00:00',
    help: 'Incoming timecode that fires it. Needs Settings ▸ Integrations ▸ Network ▸ Timecode.' },
  { key: 'secondTrigger', kind: 'enum', label: 'Second trigger', options: ['restart', 'nothing', 'panic', 'stop', 'devamp'], default: 'restart', tab: 'triggers',
    labels: { restart: 'Restart', nothing: 'Nothing', panic: 'Fade out and stop', stop: 'Stop', devamp: 'Leave its loop' },
    help: 'When it is fired again while running. Fade out: over the panic time.' },
  { key: 'secondOnRelease', kind: 'bool', label: 'Second trigger on release', default: false, tab: 'triggers',
    help: 'Releasing its hotkey or MIDI note is its second trigger.' },
  // (set by dragging a button in the cart, not typed: the inspector does not draw it)
  { key: 'cell', kind: 'cell', label: 'Cart button', hidden: true,
    help: 'Its cart button, "row,column" from 1 ("2,3"). Empty: the first free one.' },
];

const TARGET = (label: string, types: readonly string[] | null, help?: string, more: Partial<Field> = {}): Field => ({ key: 'target', kind: 'cue', label, targets: types, required: true, help, ...more });

/** How a picture is sized to the stage, and where it sits on it: shared by the Video, Text and Camera cues. */
const FIT: Field = { key: 'fit', kind: 'enum', label: 'Size', options: ['fit', 'fill', 'stretch', 'natural'], default: 'fit',
  help: 'fit: all of it. fill: covers, cropped. stretch: distorted. natural: 1:1.' };
const GEOMETRY: Field[] = [
  { key: 'opacity', kind: 'number', label: 'Opacity', default: 100, help: 'Percent. 100 is solid.' },
  { key: 'x', kind: 'number', label: 'Position X', default: 0, advanced: true, help: 'Stage pixels from the centre; right is +.' },
  { key: 'y', kind: 'number', label: 'Position Y', default: 0, advanced: true, help: 'Stage pixels from the centre; up is +.' },
  { key: 'scale', kind: 'number', label: 'Scale', default: 1, advanced: true, help: '1 is the size Size gives it.' },
  { key: 'rotation', kind: 'number', label: 'Rotation', default: 0, advanced: true, help: 'Degrees, clockwise.' },
  { key: 'layer', kind: 'number', label: 'Layer', default: 1, advanced: true, help: 'Higher is in front; on a tie, the latest.' },
];
const STAGE_TYPES = ['video', 'text', 'camera'];

/** What one sound is played through (the inspector's Sound design tab; core/audio/chain.ts is what each means).
 *  (Neither help is drawn in the window: the Sound design tab draws its own. They are the assistant's reference.) */
const EQ: Field = { key: 'eq', kind: 'eq', label: 'EQ', tab: 'design',
  help: 'Four bands on this one sound: { low, mid, mid2, high } (a low shelf at 250 Hz, bells at 1 kHz and 3 kHz, a high shelf at 4 kHz). A band is a level in dB (−40 takes it out), or { db, hz, q } to move it: "mid": { "db": 4, "hz": 1800, "q": 2 }. Empty: none.' };
const CHAIN: Field = { key: 'chain', kind: 'chain', label: 'Sound design', tab: 'design',
  help: `The tools this one sound is played through, one entry per tool in use, always run in this order: ${SOUND_TOOLS.map((t) => `${t.key} { ${t.params.map((p) => p.key).join(', ')} }`).join(', ')}. As in { "highpass": { "hz": 300, "slope": 24 }, "reverb": { "decay": 2.5, "mix": 0.3 }, "tail": true }. A tool with "on": false keeps its settings and is out of the path; "bypass": true takes the whole chain out; "tail": true lets a reverb or a delay ring out after the sound stops. The cue’s eq runs after the filters. Empty: the sound plays as it is.` };

/** Where a sound sits between the speakers (equal power; a stereo sound is balanced): core/audio/lanes.ts panGains. */
const PAN: Field = { key: 'pan', kind: 'number', label: 'Pan', default: 0, min: -100, max: 100, help: '−100 left, 0 the middle, 100 right.' };

const TYPES: Record<string, TypeDef> = {
  // A heading in the list: it organises the rows after it (up to the next section) and never plays. It holds no
  // cues of its own, so the show file stays flat and the engine never sees it (show.ts toEngineDoc leaves it out).
  // `common`: the only fields of every cue it has.
  section: {
    label: 'Section', glyph: '§', heading: true, common: ['name', 'notes', 'color'],
    summary: 'A heading. Never plays.',
    fields: [],
  },
  group: {
    label: 'Group', glyph: '▤', container: true,
    summary: 'Fires its children, together or in turn.',
    fields: [
      { key: 'mode', kind: 'enum', label: 'Mode', options: ['timeline', 'playlist', 'enter', 'first', 'random'], default: 'timeline',
        labels: { timeline: 'All together', playlist: 'Playlist', enter: 'Start first and enter', first: 'Start first', random: 'Start one at random' },
        help: 'All on one GO, one after another, from the first child, or one at random.' },
      { key: 'shuffle', kind: 'bool', label: 'Shuffle', default: false, when: { mode: ['playlist'] }, help: 'A new order each time round.' },
      { key: 'repeat', kind: 'bool', label: 'Repeat', default: false, when: { mode: ['playlist'] }, help: 'Goes round again until stopped.' },
      { key: 'crossfade', kind: 'seconds', label: 'Crossfade', default: 0, when: { mode: ['playlist'] }, help: 'The next comes in this long before one ends.' },
      { key: 'fadeOthers', kind: 'seconds', label: 'Fade & stop others', default: 0, help: 'Fades out everything else as the group fires. 0: off.' },
      { key: 'onBeat', kind: 'enum', label: 'Quantise', options: ['now', 'beat', 'bar'], default: 'now', advanced: true,
        help: 'Waits for the next beat or bar. Needs a tempo on the playing track.' },
      { key: 'beatLead', kind: 'seconds', label: 'Beat lead-in', default: 0, advanced: true },
      { key: 'blend', kind: 'enum', label: 'Blend', options: ['', 'cut', 'fade', 'dj'], default: '', advanced: true,
        help: 'For a Jump inside it. dj: a bar-long crossfade, bass swapped.' },
      { key: 'blendSecs', kind: 'seconds', label: 'Blend length', advanced: true },
    ],
  },
  audio: {
    label: 'Audio', glyph: '♪',
    summary: 'Plays a sound file.',
    fields: [
      { key: 'file', kind: 'file', label: 'File', required: true, help: 'In the show folder (media/…), or absolute.' },
      { key: 'gainDb', kind: 'db', label: 'Level', default: 0 },
      PAN,
      { key: 'bus', kind: 'bus', label: 'Bus', default: 'effects' },
      { key: 'from', kind: 'seconds', label: 'Start at', default: 0 },
      { key: 'cutAt', kind: 'seconds', label: 'End at', help: 'Stops here. With Loop: loops Start to End.' },
      { key: 'transcript', kind: 'longtext', label: 'Transcript', advanced: true, help: 'A voice-over’s words, shown in the masthead.' },
      { key: 'loop', kind: 'bool', label: 'Loop', default: false },
      { key: 'plays', kind: 'number', label: 'Play count', default: 1, help: 'Plays Start to End this many times, then stops.' },
      { key: 'fadeIn', kind: 'seconds', label: 'Fade in', default: 0 },
      { key: 'fadeOut', kind: 'seconds', label: 'Fade out', default: 0, help: 'Fades to silence over its last seconds.' },
      { key: 'fadeInShape', kind: 'shape', label: 'Fade in shape', advanced: true, help: 'Linear (in dB), S-curve, or drawn.' },
      { key: 'fadeOutShape', kind: 'shape', label: 'Fade out shape', advanced: true, help: 'Linear (in dB), S-curve, or drawn.' },
      { key: 'rate', kind: 'number', label: 'Rate', default: 1, min: 0.25, max: 4, advanced: true,
        help: '1 as recorded, 0.5 half speed. Pitch follows unless Keep pitch.' },
      { key: 'preservePitch', kind: 'bool', label: 'Keep pitch', default: false, advanced: true,
        help: 'Stretched instead; then only a whole-file loop goes round.' },
      { key: 'envelope', kind: 'envelope', label: 'Level envelope', advanced: true, help: 'The Volume line: [[seconds, dB], …] on top of Level, drawn on Time & Loops. A third number on a point bends the line to the next (−1 to 1).' },
      { key: 'automation', kind: 'automation', label: 'Automation', advanced: true,
        help: 'Other lines over its length, by lane: { "pan": [[seconds, −100…100], …], "chain.<tool>.<setting>": [[seconds, value], …] } (a setting of its Sound design that glides, as "chain.lowpass.hz"). A lane replaces Pan or that knob while it has points; a third number on a point bends the line to the next (−1 to 1). Drawn on Time & Loops.' },
      { key: 'fadeAt', kind: 'seconds', label: 'Fade out from', advanced: true, help: 'Starts the fade-out this far in. A loop: after this long.' },
      { key: 'outputs', kind: 'matrix', label: 'Own outputs', advanced: true,
        help: 'Outputs instead of its bus’s pair: [{ "3": 0 }, { "4": 0 }]. Its bus still rides it.' },
      EQ, CHAIN,
      { key: 'markers', kind: 'markers', label: 'Markers', advanced: true, help: 'Named places on the waveform: [{at, name}].' },
      { key: 'loops', kind: 'regions', label: 'Loop regions', advanced: true, help: 'Sections that loop cleanly ([{start, end, name, count}]). With a count the track goes round one that many times by itself and plays on; with `hold: true` it goes round until it is let go (L, or a Devamp); with neither the operator starts it too (L).' },
      { key: 'tempo', kind: 'tempo', label: 'Tempo', advanced: true, hidden: true, help: '{ bpm, first, bar, sections }: a track’s tempo, the time of a downbeat, and the beats in a bar; `sections` ([{ from, bpm, first, bar }]) where it changes tempo or time signature. Found by the app when asked (the sound’s Time & Loops tab) or set by hand.' },
      { key: 'beats', kind: 'numbers', label: 'Beat grid', advanced: true, hidden: true },
      { key: 'downbeats', kind: 'numbers', label: 'Bar grid', advanced: true, hidden: true },
    ],
  },
  mic: {
    label: 'Mic', glyph: '🎙',
    summary: 'Opens an input onto a bus.',
    fields: [
      { key: 'input', kind: 'input', label: 'Input', help: 'Empty: this computer’s default input.' },
      { key: 'channel', kind: 'number', label: 'Channel', default: 1, help: 'Which of the device’s inputs; 1 is the first.' },
      { key: 'gainDb', kind: 'db', label: 'Level', default: 0 },
      PAN,
      { key: 'bus', kind: 'bus', label: 'Bus', default: 'vocals' },
      { key: 'fadeIn', kind: 'seconds', label: 'Fade in', default: 0 },
      { key: 'outputs', kind: 'matrix', label: 'Own outputs', advanced: true,
        help: 'Outputs instead of its bus’s pair: [{ "5": 0 }]. Its bus still rides it.' },
      EQ, CHAIN,
    ],
  },
  video: {
    label: 'Video', glyph: '▣', stage: true,
    summary: 'Plays a video or a still on the stage.',
    fields: [
      { key: 'file', kind: 'file', media: 'picture', label: 'File', required: true, help: 'A video (mp4, mov, webm) or an image (png, jpg).' },
      FIT,
      ...GEOMETRY,
      { key: 'gainDb', kind: 'db', label: 'Level', default: 0, help: 'Its own sound’s level.' },
      { key: 'bus', kind: 'bus', label: 'Bus', default: 'effects' },
      EQ, CHAIN,
      { key: 'from', kind: 'seconds', label: 'Start at', default: 0 },
      { key: 'cutAt', kind: 'seconds', label: 'End at', help: 'Stops here. With Loop: loops Start to End.' },
      { key: 'loop', kind: 'bool', label: 'Loop', default: false },
      { key: 'holdEnd', kind: 'bool', label: 'Hold at end', default: false, help: 'The last frame stays up until stopped.' },
      { key: 'duration', kind: 'seconds', label: 'Still for', help: 'A still’s time up. Empty: until stopped.' },
      { key: 'fadeIn', kind: 'seconds', label: 'Fade in', default: 0, help: 'Picture and sound together.' },
      { key: 'fadeOut', kind: 'seconds', label: 'Fade out', default: 0, help: 'Picture and sound, over its last seconds.' },
    ],
  },
  text: {
    label: 'Text', glyph: 'Ａ', stage: true,
    summary: 'Shows a title on the stage.',
    fields: [
      { key: 'text', kind: 'longtext', label: 'Text', required: true, help: 'A new line here is a new line on the stage.' },
      { key: 'font', kind: 'text', label: 'Font', placeholder: 'the system’s', help: 'An installed font, by name. Empty: the system’s sans-serif.' },
      { key: 'size', kind: 'number', label: 'Size', default: 96, help: 'Type height, in stage pixels.' },
      { key: 'textColor', kind: 'text', label: 'Text colour', default: '#ffffff', mono: true, help: '#ffcc00, or a name (white, gold).' },
      { key: 'align', kind: 'enum', label: 'Align', options: ['left', 'center', 'right'], default: 'center' },
      ...GEOMETRY,
      { key: 'duration', kind: 'seconds', label: 'Stays for', help: 'Empty: until stopped.' },
      { key: 'fadeIn', kind: 'seconds', label: 'Fade in', default: 0 },
      { key: 'fadeOut', kind: 'seconds', label: 'Fade out', default: 0, help: 'With Stays for: over its last seconds.' },
    ],
  },
  camera: {
    label: 'Camera', glyph: '◘', stage: true,
    summary: 'Shows a live camera on the stage.',
    fields: [
      { key: 'camera', kind: 'camera', label: 'Camera', help: 'Empty: this computer’s default camera.' },
      FIT,
      { key: 'mirror', kind: 'bool', label: 'Mirror', default: false, help: 'Flipped left to right.' },
      ...GEOMETRY,
      { key: 'duration', kind: 'seconds', label: 'Stays for', help: 'Empty: until stopped.' },
      { key: 'fadeIn', kind: 'seconds', label: 'Fade in', default: 0 },
      { key: 'fadeOut', kind: 'seconds', label: 'Fade out', default: 0, help: 'With Stays for: over its last seconds.' },
    ],
  },
  fade: {
    label: 'Fade', glyph: '◢',
    summary: 'Moves a level, or a picture, over a time.',
    fields: [
      TARGET('Target', ['audio', 'mic', 'group', ...STAGE_TYPES, 'light'], 'A sound, a group or list (all in it), a picture, or a Light cue (its lights go home).', { lists: true }),
      { key: 'db', kind: 'db', label: 'To level', default: -60, signed: true },
      { key: 'duration', kind: 'seconds', label: 'Duration', default: 3 },
      { key: 'relative', kind: 'bool', label: 'Relative', default: false, help: 'dB from the target’s own level, not absolute.' },
      // (left alone it is on for a fade to silence: stopsTarget below; `default` is what the table says when nothing else does)
      { key: 'stopTarget', kind: 'bool', label: 'Stop target when done', default: false, help: 'Left alone: on for a fade to silence.' },
      { key: 'shapeUp', kind: 'shape', label: 'Shape, rising', help: 'Linear (in dB), S-curve, or drawn.' },
      { key: 'shapeDown', kind: 'shape', label: 'Shape, falling', help: 'Linear (in dB), S-curve, or drawn.' },
      { key: 'rate', kind: 'number', label: 'Rate to', min: 0.25, max: 4, advanced: true, help: 'Also moves its speed to this (1: as recorded). Empty: left alone.' },
      { key: 'keepLevel', kind: 'bool', label: 'Rate only', default: false, advanced: true, help: 'With Rate to: the level stays.' },
      { key: 'chainTo', kind: 'sweep', label: 'Sound design to', advanced: true, whenTarget: ['audio', 'mic', 'video', 'group'],
        help: '{ "lowpass": { "hz": 400 } }: numbers of tools on in its target. Empty: none.' },
      { key: 'range', kind: 'enum', label: 'Range', options: ['all', 'voice'], default: 'all', advanced: true,
        help: 'voice: dips only the speech band, around 1.2 kHz.' },
      // (aimed at a picture: each of these that is set moves there over the fade; one left empty stays where it is)
      { key: 'opacity', kind: 'number', label: 'To opacity', whenTarget: STAGE_TYPES, help: 'Percent. Empty: stays.' },
      { key: 'x', kind: 'number', label: 'To position X', whenTarget: STAGE_TYPES, help: 'Pixels from the centre; right is +. Empty: stays.' },
      { key: 'y', kind: 'number', label: 'To position Y', whenTarget: STAGE_TYPES, help: 'Pixels from the centre; up is +. Empty: stays.' },
      { key: 'scale', kind: 'number', label: 'To scale', whenTarget: STAGE_TYPES, help: 'Empty: stays.' },
      { key: 'rotation', kind: 'number', label: 'To rotation', whenTarget: STAGE_TYPES, help: 'Degrees, clockwise. Empty: stays.' },
    ],
  },
  stop: { label: 'Stop', glyph: '■', summary: 'Stops a cue, or a whole list.', fields: [TARGET('Target', null, 'A cue, or a cue list.', { lists: true })] },
  start: { label: 'Start', glyph: '▶', summary: 'Fires a cue, or a list’s GO.',
    fields: [TARGET('Target', null, 'A cue, or a cue list (its GO).', { lists: true })] },
  pause: { label: 'Pause', glyph: '❙❙', summary: 'Pauses a cue; a Start resumes it.', fields: [TARGET('Target', null)] },
  load: {
    label: 'Load', glyph: '⤓', summary: 'Sets how far in a cue starts next.',
    fields: [TARGET('Target', null, 'A sound starts that far in; a group as if running that long.'),
      { key: 'at', kind: 'seconds', label: 'Load to', default: 0, signed: true, help: 'Seconds in, pre-wait included. Negative: from the end.' }],
  },
  reset: {
    label: 'Reset', glyph: '↺',
    summary: 'Puts a cue back as written.',
    fields: [TARGET('Target', null, 'A Fade: what it moved goes back to its own level.')],
  },
  target: {
    label: 'Target', glyph: '⌖',
    summary: 'Re-aims another cue, until Reset.',
    fields: [TARGET('Cue to re-aim', null, 'A cue with a target.'),
      { key: 'to', kind: 'cue', label: 'New target', targets: null, required: true, lists: true }],
  },
  goto: { label: 'GoTo', glyph: '↪', summary: 'Moves the playhead to a cue.', fields: [TARGET('Target', null)] },
  arm: { label: 'Arm', glyph: '◉', summary: 'Arms a cue.', fields: [TARGET('Target', null)] },
  disarm: { label: 'Disarm', glyph: '◌', summary: 'Disarms a cue.', fields: [TARGET('Target', null)] },
  devamp: {
    label: 'Devamp', glyph: '⤴', engineType: 'release',
    summary: 'Lets a sound out of its loop.',
    fields: [TARGET('Target', ['audio']),
      { key: 'startNext', kind: 'bool', label: 'Then start next', default: false,
        help: 'The next cue starts as this pass ends. Leave Continue at none.' }],
  },
  wait: { label: 'Wait', glyph: '◷', summary: 'Waits for a time.', fields: [{ key: 'duration', kind: 'seconds', label: 'Duration', default: 1 }] },
  memo: { label: 'Memo', glyph: '✎', summary: 'A note. Does nothing.', fields: [] },
  network: {
    label: 'Network', glyph: '⇄',
    summary: 'Sends OSC, text or bytes to a patch.',
    fields: [
      { key: 'patch', kind: 'patch', label: 'Patch', help: 'From Settings ▸ Integrations ▸ Network.' },
      { key: 'format', kind: 'enum', label: 'Message is', options: ['osc', 'text', 'hex'], default: 'osc', advanced: true,
        help: 'text: as typed (\\r, \\n, \\x41). hex: bytes (FE 01 0A). Both sent once.' },
      { key: 'message', kind: 'text', label: 'Message', required: true, mono: true, help: 'Address, then arguments (\\T true, \\F false). #v# fades; #x# #y# follow Path.' },
      { key: 'fadeFrom', kind: 'number', label: 'Fade from', help: 'With #v#: where it starts.' },
      { key: 'fadeTo', kind: 'number', label: 'Fade to', help: 'With #v#: where it lands. No duration: sent once.' },
      { key: 'duration', kind: 'seconds', label: 'Duration', help: 'With #v#: the fade. Without: repeats this long. 0: once.' },
      { key: 'curve', kind: 'enum', label: 'Fade curve', options: ['linear', 's-curve', 'ease-in', 'ease-out'], default: 'linear', advanced: true },
      { key: 'whole', kind: 'bool', label: 'Whole numbers', default: false, advanced: true, help: 'Sends the fading value as an integer.' },
      { key: 'fps', kind: 'number', label: 'Messages a second', default: 30, advanced: true, help: 'For a fade or a repeat: 1 to 120.' },
      { key: 'path', kind: 'text', label: 'Path', mono: true, advanced: true, help: 'With #x# #y#: points as x,y, at an even speed: 0,0 1,0 1,1.' },
      { key: 'pathLoop', kind: 'bool', label: 'Loop the path', default: false, advanced: true, help: 'Round until stopped; one lap is the duration.' },
    ],
  },
  device: {
    label: 'Device', glyph: '◈',
    summary: 'Sends a device’s command.',
    fields: [
      { key: 'device', kind: 'device', label: 'Device', required: true, help: 'A device of this show (the Rig), by its id.' },
      { key: 'command', kind: 'command', label: 'Command', required: true, help: 'One of its commands, by its id.' },
      { key: 'args', kind: 'args', label: 'Arguments', help: '{ "name": "breathe" }. Left out: its default.' },
      { key: 'fadeTo', kind: 'number', label: 'Fade to', help: 'For a value that fades: where it goes. Empty: sent once.' },
      { key: 'duration', kind: 'seconds', label: 'Duration', help: 'With Fade to: how long it takes.' },
      { key: 'curve', kind: 'enum', label: 'Fade curve', options: ['linear', 's-curve', 'ease-in', 'ease-out'], default: 'linear', advanced: true },
    ],
  },
  midi: {
    label: 'MIDI', glyph: '♬',
    summary: 'Sends one MIDI message.',
    fields: [
      { key: 'midi', kind: 'text', label: 'MIDI message', required: true, mono: true, placeholder: 'msc go 12   ·   note 60 100   ·   pc 3 ch 2   ·   cc 7 100',
        help: 'Also note off 60, msc stop, hex bytes. Add ch 2; for MSC, list 1, dev 3.' },
      { key: 'fadeTo', kind: 'number', label: 'Fade to', help: 'For cc, pressure or bend: where it moves to. Empty: once.' },
      { key: 'duration', kind: 'seconds', label: 'Length', help: 'A note: when its note off goes (0: none). Or the fade’s time.' },
    ],
  },
  midifile: {
    label: 'MIDI File', glyph: '♫',
    summary: 'Plays a MIDI file to the MIDI output.',
    fields: [
      { key: 'file', kind: 'file', label: 'File', required: true, accept: 'midi', placeholder: 'media/song.mid', help: 'A .mid file. Its tempo changes are followed.' },
      { key: 'rate', kind: 'number', label: 'Rate', default: 1, help: '1: as written. 2: twice as fast.' },
    ],
  },
  timecode: {
    label: 'Timecode', glyph: '◴',
    summary: 'Sends running timecode, MTC or LTC.',
    fields: [
      { key: 'timecode', kind: 'text', label: 'Start at', default: '01:00:00:00', mono: true, placeholder: '01:00:00:00', help: 'hours:minutes:seconds:frames' },
      { key: 'fps', kind: 'enum', label: 'Frames a second', options: ['24', '25', '29.97df', '30'], default: '30', labels: { '29.97df': '29.97 drop' },
        help: '29.97 drop: NTSC video.' },
      { key: 'output', kind: 'enum', label: 'Send as', options: ['mtc', 'ltc'], default: 'mtc', labels: { mtc: 'MTC (MIDI)', ltc: 'LTC (audio)' },
        help: 'MTC to the MIDI output (Settings ▸ Integrations ▸ Network). LTC on one audio output.' },
      { key: 'channel', kind: 'number', label: 'LTC output', default: 1, when: { output: ['ltc'] }, help: 'An audio output, alone, past the mixer and the limiter.' },
      { key: 'gainDb', kind: 'db', label: 'LTC level', default: -12, when: { output: ['ltc'] }, signed: true, help: 'dB below full scale.' },
      { key: 'duration', kind: 'seconds', label: 'Run for', help: 'Empty or 0: until stopped.' },
    ],
  },
  light: {
    label: 'Light', glyph: '☀',
    summary: 'Sets lights, fires a desk cue, or both.',
    fields: [
      { key: 'levels', kind: 'longtext', label: 'Levels', mono: true, placeholder: 'front = 80\ncyc.red = 100\nall = 0',
        help: 'One a line: 1 - 6 = 50, cyc.colour = #ff8800, spot.pan = home. Others stay.' },
      { key: 'duration', kind: 'seconds', label: 'Fade time', default: 3, help: '0: at once.' },
      { key: 'block', kind: 'bool', label: 'Full state', default: false, help: 'Lights it does not name go home (out).' },
      { key: 'lightCue', kind: 'text', label: 'Desk cue number', help: 'Called, and fired on the desk with the Lighting desk module.' },
      { key: 'follows', kind: 'bool', label: 'Desk follows', default: false, advanced: true, help: 'The desk runs it after the one before; not fired from here.' },
    ],
  },
  mix: {
    label: 'Mix', glyph: '⎚',
    summary: 'Moves the bus faders over a time.',
    fields: [
      { key: 'levels', kind: 'levels', label: 'Bus levels', help: '{ busId: dB }. Buses not named stay.' },
      { key: 'duration', kind: 'seconds', label: 'Duration', default: 2 },
    ],
  },
  music: {
    label: 'Jump', glyph: '⤳',
    summary: 'Moves a playing track to another place in it.',
    fields: [
      TARGET('Track', ['audio']),
      { key: 'to', kind: 'seconds', label: 'Land at', default: 0 },
      { key: 'loop', kind: 'bool', label: 'Loop there', default: false },
      { key: 'end', kind: 'seconds', label: 'Loop end' },
      { key: 'loopFrom', kind: 'seconds', label: 'Loop from', advanced: true, help: 'With Loop there: the loop starts here, not where it lands.' },
      { key: 'hold', kind: 'bool', label: 'Hold', default: false, advanced: true, help: 'Arms the loop, and plays into it.' },
      { key: 'level', kind: 'db', label: 'Level offset', advanced: true, signed: true },
      { key: 'fadeIn', kind: 'seconds', label: 'Starting fade-in', advanced: true, help: 'If the track is not playing yet.' },
      { key: 'stop', kind: 'bool', label: 'Stop the track', default: false, advanced: true },
      { key: 'stay', kind: 'bool', label: 'Level only', default: false, advanced: true, help: 'Stays in place.' },
      { key: 'letGo', kind: 'bool', label: 'Let go of loop', default: false, advanced: true },
    ],
  },
  script: {
    label: 'Script', glyph: '≡',
    summary: 'Runs show commands in order. Not code.',
    fields: [
      { key: 'script', kind: 'longtext', label: 'Script', required: true, mono: true,
        placeholder: '/cue/12/start\nwait 2\n/cue/13/stop',
        help: '/cue/<n>/start (stop, hardStop, pause, resume, preview), /cue_id/<id>/…, /go, /panic, /pause, /resume, /playhead/<n | next | previous>, wait <s>. # is a note.' },
    ],
  },
};

// The few fields whose name alone does not say what they do get an ⓘ in the inspector, clicked to read one plain
// line. `help` stays what the assistant reads (it may hold JSON shapes) and is never shown. "type.key" wins over "key".
const TIPS: Record<string, string> = {
  flagged: 'A reminder to come back to it. Does nothing in the show.',
  armed: 'Off: GO skips it, but its continue still passes on.',
  preWait: 'Wait this long after GO before it starts.',
  postWait: 'With auto-continue: wait this long, then start the next cue.',
  continue: 'What happens next. Auto-continue: the next cue starts with this one. Auto-follow: when this one ends.',
  fadeOthers: 'Fades out and stops everything else over this many seconds. 0: off.',
  duckOthers: 'Holds everything else down by this much while it plays. 0: off.',
  autoLoad: 'Gets its file ready while it stands by, so it starts on the dot.',
  bus: 'Which fader it plays through: Music, Effects, Vocals…',
  cutAt: 'Stops here. With Loop: loops between start and here.',
  outputs: 'Sends it to particular outputs instead of its bus’s.',
  beatLead: 'How early, before the beat, it starts.',
  blendSecs: 'How long the blend takes.',
  'fade.stopTarget': 'Stops the sound when the fade ends, instead of leaving it playing silently.',
  'fade.chainTo': 'Moves the target’s effects to these settings too.',
  'target.to': 'The cue it will point at from now on.',
  'goto.target': 'Moves the playhead here. Nothing plays.',
  'disarm.target': 'The cue to switch off: GO will skip it.',
  'devamp.target': 'The looping sound to let go of: it plays on past its loop.',
  'music.loop': 'Loops there until let go.',
  'music.letGo': 'Lets a held loop play on.',
};
for (const f of COMMON) if (TIPS[f.key]) f.tip = TIPS[f.key];
for (const [type, def] of Object.entries(TYPES)) for (const f of def.fields || []) {
  const tip = TIPS[`${type}.${f.key}`] || TIPS[f.key];
  if (tip) f.tip = tip;
}

const TYPE_ORDER: CueType[] = ['group', 'audio', 'fade', 'stop', 'start', 'pause', 'devamp', 'load', 'goto', 'arm', 'disarm', 'reset', 'target', 'wait', 'memo', 'mic', 'network', 'device', 'midi', 'midifile', 'timecode', 'light', 'mix', 'music', 'video', 'text', 'camera', 'script', 'section'];

function fieldsOf(type: string): Field[] {
  const t = TYPES[type];
  // (a field a type has of its own, a Group's "Fade & stop others", takes the place of the common one of that name)
  return t ? [...COMMON.filter((c) => !t.fields.some((f) => f.key === c.key) && (!t.common || t.common.includes(c.key))), ...t.fields] : COMMON;
}
function fieldOf(type: string, key: string) { return fieldsOf(type).find((f) => f.key === key) || null; }

/** A value as the field's kind wants it. Returns { ok, value } or { ok: false, why }. `null`/'' clears an optional field. */
function coerce(field: Field, value: unknown): Coerced {
  const clear = value === null || value === undefined || value === '';
  if (clear) return field.required ? { ok: false, why: `${field.label} is required` } : { ok: true, value: undefined };
  switch (field.kind) {
    case 'text': case 'longtext': case 'file': case 'patch': case 'bus': case 'cue': case 'input': case 'camera': case 'device': case 'command':
      return { ok: true, value: String(value) };
    case 'args': {
      // (a Device cue's arguments: plain values by the parameter's key; whether they fit the command is the show's to say, show.problems)
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some((v) => v !== null && typeof v === 'object')) return { ok: false, why: `${field.label}: { "parameter": value } (each value a number or text)` };
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) if (v !== null && v !== undefined && v !== '') out[k] = v;
      return { ok: true, value: Object.keys(out).length ? out : undefined };
    }
    case 'number': case 'seconds': case 'db': {
      // (a time that may be negative: "-10", "-1:30")
      const back = field.kind === 'seconds' && field.signed && typeof value === 'string' && /^\s*[-−]/.test(value);
      const n = typeof value === 'number' ? value : back ? -parseSmart('seconds', value.replace(/^\s*[-−]/, '')) : parseSmart(field.kind, String(value));
      if (!Number.isFinite(n)) return { ok: false, why: `${field.label}: not a number` };
      if (field.kind === 'seconds' && n < 0 && !field.signed) return { ok: false, why: `${field.label}: cannot be negative` };
      if ((field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) return { ok: false, why: `${field.label}: between ${field.min} and ${field.max}` };
      return { ok: true, value: Math.round(n * 1000) / 1000 };
    }
    case 'bool': return { ok: true, value: value === true || value === 'true' || value === 1 };
    case 'enum': case 'color':
      if (field.options === COLORS) {
        const c = cleanColor(value);
        if (!c) return { ok: false, why: `${field.label}: one of ${COLORS.join(', ')}, or a colour as #rrggbb` };
        return { ok: true, value: c };
      }
      if (!field.options!.includes(value as string)) return { ok: false, why: `${field.label}: one of ${field.options!.filter(Boolean).join(', ')}` };
      return { ok: true, value };
    case 'markers':
      if (!Array.isArray(value)) return { ok: false, why: 'markers: a list of {at, name}' };
      return { ok: true, value: value.filter((m) => m && Number.isFinite(Number(m.at)) && String(m.name ?? '').trim())
        .map((m) => ({ at: Math.round(Number(m.at) * 1000) / 1000, name: String(m.name).trim(), ...(m.kind ? { kind: String(m.kind) } : {}) }))
        .sort((a, b) => a.at - b.at) };
    case 'regions':
      if (!Array.isArray(value)) return { ok: false, why: 'loop regions: a list of {start, end}' };
      // (one that cannot be is refused, not dropped: dropping it would silently take the cue's other regions' place)
      { const bad = value.find((r) => !r || !(Number(r.end) > Number(r.start)) || !(Number(r.start) >= 0)); if (bad) return { ok: false, why: `loop region ${JSON.stringify(bad)}: its end must come after its start, and its start cannot be negative` }; }
      return { ok: true, value: value.filter((r) => r && Number(r.end) > Number(r.start) && Number(r.start) >= 0)
        .map((r) => ({ start: Number(r.start), end: Number(r.end), ...(r.name ? { name: String(r.name) } : {}), ...(r.bars ? { bars: Number(r.bars) } : {}), ...(r.hold ? { hold: true } : Number(r.count) > 1 ? { count: Math.min(999, Math.round(Number(r.count))) } : {}) }))
        .sort((a, b) => a.start - b.start) };
    case 'cell': {
      const p = require('./cart').parseCell(value);
      if (!p) return { ok: false, why: `${field.label}: a row and a column counted from 1, as "2,3"` };
      return { ok: true, value: `${p[0]},${p[1]}` };
    }
    case 'tempo': {
      const t = require('../audio/tempo').cleanTempo(value);
      if (!t) return { ok: false, why: 'tempo: { bpm (20–400), first, bar }' };
      return { ok: true, value: t };
    }
    case 'matrix': case 'eq': {
      const routing = require('../audio/routing');
      try { const v = field.kind === 'matrix' ? routing.cleanMatrix(value) : routing.cleanEq(value); return { ok: true, value: v === null ? undefined : v }; }
      catch (err) { return { ok: false, why: (err as Error).message }; }
    }
    case 'chain': case 'sweep': {
      try { const v = field.kind === 'chain' ? cleanChain(value) : cleanSweep(value); return { ok: true, value: v === null ? undefined : v }; }
      catch (err) { return { ok: false, why: (err as Error).message }; }
    }
    case 'shape': { const r = cleanShape(value); return r.ok ? { ok: true, value: r.value } : { ok: false, why: `${field.label}: ${r.why}` }; }
    case 'envelope': {
      const env = cleanEnvelope(value);
      if (!env) return { ok: false, why: 'level envelope: a list of [seconds, dB] points' };
      return { ok: true, value: env.length ? env : undefined };
    }
    case 'automation': {
      try { const v = cleanAutomation(value, SOUND_TOOLS); return { ok: true, value: v === null ? undefined : v }; }
      catch (err) { return { ok: false, why: (err as Error).message }; }
    }
    case 'numbers':
      if (!Array.isArray(value) || value.some((n) => !Number.isFinite(Number(n)))) return { ok: false, why: `${field.label}: a list of numbers` };
      return { ok: true, value: value.map(Number) };
    case 'levels': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, why: 'levels: { bus: dB }' };
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(value)) if (Number.isFinite(Number(v))) out[k] = Number(v);
      return { ok: true, value: out };
    }
    default: return { ok: true, value };
  }
}

/**
 * QLab's smart entry, for text a person typed (a number is taken as it is). Times: "90" = 90 s,
 * "1:30" = 90 s, "1:02:03". Levels: a number with no sign is a cut ("12" = −12 dB), "+12" a
 * boost; "-inf" / "off" = −60 (the engine's silence).
 */
function parseSmart(kind: string, text: string) {
  const s = text.trim().toLowerCase();
  if (kind === 'seconds') {
    if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
    const m = s.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
    if (m) return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
    return NaN;
  }
  if (kind === 'db') {
    if (s === '-inf' || s === 'inf' || s === 'off' || s === '-∞' || s === '−∞') return -60;
    const t = s.replace(/db$/, '').replace('−', '-').trim();
    const n = Number(t);
    // typed with no sign, a level is a cut: "12" is −12 dB, "+12" is a boost (QLab's safety)
    return n > 0 && !t.startsWith('+') ? -n : n;
  }
  return Number(s);
}

function formatSeconds(n: number, places = 2) {
  if (!Number.isFinite(n)) return '';
  const neg = n < 0; n = Math.abs(n);
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
  const ss = s.toFixed(places).padStart(places ? places + 3 : 2, '0');
  return (neg ? '-' : '') + (h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`);
}

/**
 * Whether a Fade cue stops its target when it is done. Its own `stopTarget` wins when it is set (true or false: an
 * imported QLab fade always says). Left alone, a fade that takes its target to silence stops it: QLab leaves the
 * sound playing at −∞ until "Stop target when done" is ticked, and a sound nobody hears that is still running is a
 * trap (it is still "playing" for a later Fade, a Devamp, a second GO). `min`: the show's floor in dB (Settings ▸
 * Audio, levels), at or below which a level is silence. `target`: the cue it is aimed at, when known.
 */
const PICTURE_MOVES = ['opacity', 'x', 'y', 'scale', 'rotation'];
function stopsTarget(cue: Cue | null | undefined, target: Cue | null = null, min = -60) {
  if (!cue || cue.type !== 'fade') return false;
  if (cue.stopTarget !== undefined && cue.stopTarget !== null) return !!cue.stopTarget;
  // a dip from its own level, a duck in the voice band, a change of speed alone, a light going home: none of these
  // is the sound leaving
  if (cue.relative || cue.range === 'voice' || (cue.keepLevel && Number(cue.rate) > 0)) return false;
  if (target && target.type === 'light') return false;
  const set = (v: unknown) => v !== undefined && v !== null && v !== '';
  const level = set(cue.db) ? Number(cue.db) : null;
  if (target && STAGE_TYPES.includes(target.type)) {
    const moves = PICTURE_MOVES.filter((k) => set(cue[k as keyof Cue]));
    if (!moves.length && level === null) return true;          // naming nothing, it takes the picture and its sound out
    const unseen = moves.includes('opacity') && Number(cue.opacity) <= 0;
    // (a title or a camera has no sound of its own: out of sight is gone)
    return unseen && (target.type !== 'video' || (level !== null && level <= min));
  }
  return (level === null ? -60 : level) <= min;
}

const isCue = (x: Cue | CueList): x is Cue => 'type' in x;
/** What a target is called: its name, or (a cue's) its own default name, as far as `depth` allows. */
function nameOf(target: Cue | CueList, byId: CueIndex | null | undefined, depth: number): string | undefined {
  return target.name || (depth < 3 ? (isCue(target) ? defaultName(target, byId, depth + 1) : undefined) : (isCue(target) && target.number) || '…');
}

/** The name a cue shows when it has none of its own (QLab: "fade Fanfare"). `depth`: how many targets in it is
 *  (two Start cues with no names that start each other would otherwise name each other for ever). */
function defaultName(cue: Cue, byId?: CueIndex | null, depth = 0): string {
  const t = TYPES[cue.type];
  // (a target may be a whole cue list: show.index() hangs the lists on the map it returns)
  const target = cue.target && byId ? byId.get(cue.target) || (byId.lists && byId.lists.get(cue.target)) || null : null;
  const tn = target ? nameOf(target, byId, depth) : cue.target ? '(missing)' : '';
  switch (cue.type) {
    case 'audio': return cue.file ? String(cue.file).split(/[\\/]/).pop()!.replace(/\.[a-z0-9]+$/i, '') : 'Audio';
    case 'fade': return `fade ${tn || '…'}${stopsTarget(cue, target && isCue(target) ? target : null) ? ' out' : ''}`;
    case 'stop': case 'start': case 'pause': case 'load': case 'arm': case 'disarm': case 'devamp': case 'reset':
      return `${cue.type} ${tn || '…'}`;
    case 'target': { const to = cue.to && byId ? byId.get(String(cue.to)) || (byId.lists && byId.lists.get(String(cue.to))) : null; return `aim ${tn || '…'} at ${to ? nameOf(to, byId, depth) : '…'}`; }
    case 'goto': return `go to ${target ? ((isCue(target) && target.number) || tn) : '…'}`;
    case 'wait': return `wait ${Number(cue.duration) || 0} s`;
    case 'network': return cue.message || 'Network';
    // (the show's devices hang on the map show.index() returns, as its lists do)
    case 'device': return require('../rig/devices').cueName(byId && byId.devices ? byId.devices.get(cue.device ?? '') : null, cue);
    case 'video': return cue.file ? String(cue.file).split(/[\\/]/).pop()!.replace(/\.[a-z0-9]+$/i, '') : 'Video';
    case 'text': return cue.text ? String(cue.text).trim().split('\n')[0].slice(0, 40) : 'Text';
    case 'camera': return `Camera${cue.camera ? ` ${cue.camera}` : ''}`;
    case 'mic': return `Mic${cue.input ? ` ${cue.input}` : ''}${Number(cue.channel) > 1 ? ` in ${cue.channel}` : ''}`;
    case 'midi': return cue.midi ? `MIDI ${cue.midi}` : 'MIDI';
    case 'midifile': return cue.file ? String(cue.file).split(/[\\/]/).pop()!.replace(/\.[a-z0-9]+$/i, '') : 'MIDI File';
    case 'timecode': return `${cue.output === 'ltc' ? 'LTC' : 'MTC'} from ${cue.timecode || '01:00:00:00'}`;
    case 'light': {
      // a cue of levels is named by them ("front = 80, cyc.red = 100"); a desk cue by its number
      const lines = String(cue.levels || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));
      if (cue.lightCue || !lines.length) return `LQ ${cue.lightCue || '…'}`;
      return `${lines.slice(0, 3).join(', ')}${lines.length > 3 ? ', …' : ''}`;
    }
    case 'script': { const first = String(cue.script || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#')); return first ? `script: ${first}` : 'Script'; }
    case 'music': return `jump ${tn || '…'} to ${formatSeconds(Number(cue.to) || 0, 1)}`;
    default: return t ? t.label : cue.type;
  }
}

export { TYPES, TYPE_ORDER, STAGE_TYPES, COMMON, COLORS, PALETTE, cleanColor, fieldsOf, fieldOf, coerce, parseSmart, formatSeconds, defaultName, stopsTarget };
