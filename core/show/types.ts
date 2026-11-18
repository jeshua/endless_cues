/**
 * The show document's types: what show.json holds once `normalise` has read it (docs/specs/03-show-file.md).
 *
 * A cue's fields are the cue types table's (cue-types.ts), written out as CueFields by build/cue-fields.ts. The
 * values of the fields that are more than a number or a word are typed here, from the functions that clean them
 * where there is one, so a field's shape is said once.
 */
import type { CueFields, CueType } from './cue-fields';
import type { cleanTempo } from '../audio/tempo';
import type { cleanMatrix, cleanEq } from '../audio/routing';
import type { cleanChain, cleanSweep } from '../audio/chain';
import type { cleanShape, cleanEnvelope } from '../audio/curves';
import type { cleanAutomation } from '../audio/lanes';
import type { cleanCart } from './cart';
import type { defaults as lightDefaults } from '../light/patch';

export type { CueFields, CueType };

/** A point of a line drawn over a sound: [seconds into the file, value, bend to the next point (−1 … 1)?]. */
export type LanePoint = [number, number] | [number, number, number];
/** A marker on a sound: a place, named (`kind`: what found it, as 'bar'). */
export interface Marker { at: number; name: string; kind?: string }
/** A loop region of a sound: held (until a Devamp lets go), or played `count` times. */
export interface Region { start: number; end: number; name?: string; bars?: number; hold?: boolean; count?: number }
/** A Device cue's arguments, by the command's parameter. */
export type DeviceArgs = Record<string, string | number | boolean>;
/** A Mix cue's bus levels: { busId: dB }. */
export type BusLevels = Record<string, number>;

export type Tempo = NonNullable<ReturnType<typeof cleanTempo>>;
export type Matrix = NonNullable<ReturnType<typeof cleanMatrix>>;
export type Eq = NonNullable<ReturnType<typeof cleanEq>>;
export type Chain = NonNullable<ReturnType<typeof cleanChain>>;
export type Sweep = NonNullable<ReturnType<typeof cleanSweep>>;
export type Shape = Extract<ReturnType<typeof cleanShape>, { ok: true }>['value'];
export type Envelope = NonNullable<ReturnType<typeof cleanEnvelope>>;
export type Automation = NonNullable<ReturnType<typeof cleanAutomation>>;
/** A cart's grid (a list drawn as buttons). */
export type Cart = NonNullable<ReturnType<typeof cleanCart>>;

/** A cue as the show file keeps it. A group's (and a playlist's) cues are its `children`. What this version does
 *  not know (a field from a newer one, or written by hand) is kept as it was: any other key is there, unknown. */
export interface Cue extends CueFields {
  id: string;
  type: CueType;
  children?: Cue[];
  [field: string]: unknown;
}

/** One cue list (a show has one or more; a cart is a list drawn as buttons). */
export interface CueList {
  id: string;
  name: string;
  cues: Cue[];
  cart?: Cart;
}

/** A bus: where a cue's sound goes. `kind` is a label (core/audio/kinds.ts); the rest is said only when used. */
export interface Bus {
  id: string;
  name: string;
  db: number;
  kind?: string;
  /** the first of its pair of outputs, counted from 1 */
  out?: number;
  /** sends to the reverb and the delay, dB */
  reverb?: number;
  delay?: number;
  stopFade?: number;
  oneAtATime?: number;
  noDuck?: boolean;
}

/** A further place a patch's (or a device's) messages go. */
export interface Destination { host: string; port?: number; protocol?: 'udp' | 'tcp'; framing?: 'slip' | 'length'; iface?: string }

/** A network patch: somewhere Network cues send. */
export interface Patch {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol?: 'udp' | 'tcp';
  framing?: 'slip' | 'length';
  device?: string;
  listenPort?: number;
  notes?: string;
  /** the network interface it leaves by (en0); none: the system chooses */
  iface?: string;
  destinations?: Destination[];
}

/** One of a device command's parameters (core/rig/devices.ts PARAM_FIELDS). */
export interface DeviceParam {
  key: string;
  label: string;
  kind: 'number' | 'text' | 'enum';
  default?: string | number | boolean;
  min?: number;
  max?: number;
  whole?: boolean;
  options?: string[];
  help?: string;
}
/** A device's named command: a message with holes in it (COMMAND_FIELDS). */
export interface DeviceCommand { id: string; label: string; template: string; params: DeviceParam[]; fade?: string; notes?: string }
/** How a device is known to be there (ALIVE_FIELDS). */
export interface DeviceAlive { how: 'none' | 'ask' | 'heartbeat'; send?: string; reply?: string; every?: number; hears?: string; within?: number }
/** What is read out of what a device says about itself (REPORT_FIELDS). */
export interface DeviceReport { key: string; label: string; from: string; arg: number; unit?: string; warnBelow?: number; warnAbove?: number; none?: unknown }
/** A piece of the show's equipment (settings.rig.devices), as core/rig/devices.ts `clean` leaves it. */
export interface Device {
  id: string;
  name: string;
  kind: string;
  via: 'osc' | 'text' | 'hex' | 'midi';
  model?: string;
  host?: string;
  port?: number;
  protocol?: 'udp' | 'tcp';
  framing?: 'slip' | 'length';
  listenPort?: number;
  iface?: string;
  destinations?: Destination[];
  commands: DeviceCommand[];
  test?: string;
  alive: DeviceAlive;
  reports?: DeviceReport[];
  resend?: number;
  needed?: boolean;
  notes?: string;
  /** what this version does not know is kept as it was */
  [field: string]: unknown;
}
/** A line of the operator's own checklist on the Rig page. */
export interface RigCheck { id: string; text: string }

/** OSC or MIDI messages that run the show, written as a trigger is: '' is none. */
export interface ShowCommands { go: string; panic: string; pause: string; resume: string; next: string; previous: string }

/** How one kind dips under the ones listened to (settings.audio.ducking.under). */
export interface DuckUnder { depth: number; attack: number; hold: number; release: number; range: 'voice' | 'all' }

/** The show's settings (show.json `settings`): `defaultSettings()` in show.ts, and what is written only when used. */
export interface Settings {
  go: { doubleGoProtection: number; panicFade: number };
  audio: {
    masterDb: number;
    limiter: boolean;
    buses: Bus[];
    duck: { on: boolean; key: string; target: string; threshold: number; depth: number; attack: number; hold: number; release: number; range: 'voice' | 'all' };
    levels: { min: number; max: number };
    monitor: { on: boolean; out: number; db: number };
    sortNew: boolean;
    /** ducking by kind, once a person has asked for it */
    ducking?: { on: boolean; threshold: number; by: string[]; under: Record<string, DuckUnder> };
    /** the outputs' names and trims: { "3": { name, trim } } */
    outs?: Record<string, { name?: string; trim?: number }>;
    /** the first of the pair an audition plays to */
    auditionOut?: number;
    fx?: { reverb?: { secs?: number; db?: number; out?: number }; delay?: { secs?: number; feedback?: number; db?: number; out?: number } };
    /** the show's own sound design presets, by name */
    chains?: Record<string, { chain?: Chain; eq?: Eq }>;
  };
  editing: { autoNumber: boolean; numberStep: number; lockPlayhead: boolean; longSoundsToMusic: boolean };
  /** what a new cue of a type starts with: { fade: { duration: 5 } } */
  templates: Partial<Record<CueType, Partial<CueFields>>>;
  network: { patches: Patch[]; inputPort: number; listen: boolean; commands: ShowCommands };
  backup: { minutes: number; keep: number };
  midi: { output: string; mscIn: boolean; deviceId: number; commands: ShowCommands };
  light: ReturnType<typeof lightDefaults>;
  rig: { devices: Device[]; checks: RigCheck[]; script: string };
  timecode: { source: 'off' | 'mtc' | 'ltc'; rate: '24' | '25' | '29.97df' | '30'; input: string; channel: number; catchUp: boolean; follow: boolean };
  /** the stage: its size, and four corners (each [x, y], 0–1) or none */
  video?: { width?: number; height?: number; pin?: [number, number][] };
}

/** Who may do what over OSC: a passcode and what it allows. */
export interface Passcode { code: string; view?: boolean; edit?: boolean; control?: boolean }

/** The show's modules (show.json `modules`): `defaultModules()` in show.ts. */
export interface Modules {
  'osc-control': { enabled: boolean; passcode: string; replyPort: number; passcodes?: Passcode[]; noPasscode?: { view?: boolean; edit?: boolean; control?: boolean } };
  'show-feedback': { enabled: boolean; patch: string; prefix: string };
  'lighting-desk': { enabled: boolean; kind: string; host: string; port: number; listenPort: number; list: number };
  'web-remote': { enabled: boolean; port: number; control: boolean; key: string };
  'backup-link': { enabled: boolean; role: 'main' | 'backup'; patch: string; passcode: string };
}

/** The cues by id (show.index), with the show's cue lists and devices hung on it by id: a target may be a whole list. */
export type CueIndex = Map<string, Cue> & { lists: Map<string, CueList>; devices: Map<string, Device> };

/** The whole show (show.json). */
export interface ShowDoc {
  format: string;
  version: number;
  id: string;
  title: string;
  notes: string;
  settings: Settings;
  modules: Modules;
  lists: CueList[];
}
