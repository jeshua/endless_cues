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
import type { defaultSettings, defaultModules } from './show';
import type { cleanCart } from './cart';

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
/** A Mix cue's kept Live desk: { crossfader, buses: { busId: { eq, filter, pan, mute, xf } } }. */
export interface Desk {
  crossfader?: number;
  buses?: Record<string, { eq?: Record<string, number>; filter?: number; pan?: number; mute?: boolean; xf?: string }>;
}

/** A cue as the show file keeps it. A group's (and a playlist's) cues are its `children`. */
export interface Cue extends CueFields {
  id: string;
  type: CueType;
  children?: Cue[];
}

/** One cue list (a show has one or more; a cart is a list drawn as buttons). */
export interface CueList {
  id: string;
  name: string;
  cues: Cue[];
  cart?: Cart;
}

export type Settings = ReturnType<typeof defaultSettings>;
export type Modules = ReturnType<typeof defaultModules>;

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
