/**
 * Endless Cues' cue engine: QLab's cue model, plus the moves a DJ makes inside a track.
 *
 * It plays a cue list document (see load()) the way QLab would, so an operator who
 * knows QLab knows it, and adds three things for music: a GO quantised to the beat,
 * exact loops of a section of a track ("holds"), and blended jumps from one place in
 * a track to another.
 *
 *  - GO fires the cue at the playhead and moves the playhead to the next one.
 *    A cue with `onBeat` waits for the next downbeat of the music playing (an audio
 *    cue's `downbeats`, from its beat analysis) and fires on it, like a DJ's quantised mix.
 *  - HOLD on a track with `loops` (sections known to loop cleanly) loops the section the
 *    track is in, or the next one coming, sample-exact, until it is let go; then the track
 *    plays on from where it is. Any track with sections can be held. A GO lets go of Hold
 *    (it is the operator moving on). Exact looping needs the track decoded by the audio
 *    backend (`exact`, reported per play); `wantedFiles()` says what to decode.
 *  - A cue's continue mode is QLab's: `autoContinue` fires the one after it too, after
 *    its `postWait`; `autoFollow` fires the one after it when it has finished (nothing
 *    under it waiting, sounding or fading), after its `postWait`. Stopping it by hand
 *    (Stop, Panic, Reset, a scene's fade-others) does not follow on.
 *  - A group fires all its children at once (QLab's timeline group); each
 *    child waits its own pre-wait. `fadeOthers` fades out whatever else is
 *    sounding, so a scene's GO is a crossfade from the scene before.
 *  - One music track per scene: started by the scene's GO, it is the only music. A `music`
 *    cue (in a group with `blend`) moves that track (its `target`) the way a DJ mixes (or,
 *    with `stay`, only its level): to `to`, looping `to`–`end` if it `loop`s, at `level` dB
 *    on the track's own if it says; on the group's `onBeat` ('beat', 'bar' or true; 'best':
 *    whichever of the next BLEND_WITHIN downbeats sounds most like where it lands, from
 *    `landings`, and which landing; none: now), as `blend` 'cut', 'fade' (equal power, a
 *    beat long) or 'dj' (a bar, the bass swapped on the downbeat), over `blendSecs` if it
 *    says. Where the beat grid is a guess (an ambient stretch) the fade is AMBIENT_FADE
 *    instead. The audio backend crossfades the two places inside the track, to the sample,
 *    told SYNC_LEAD ahead, so the track's level, ducks and trims stay as they are. A track
 *    not playing is started there (fading in over `fadeIn`).
 *  - Audio plays a file (`loop`: over and over until stopped or faded out).
 *  - Fade moves a running audio cue's level (and can stop it when it lands), and cancels
 *    any other cue's fade still waiting on that sound (the last word wins: a second duck
 *    keeps the music down instead of the first one's return bringing it up under it);
 *    Stop ends a cue, or cancels one still in its pre-wait; Start fires another cue;
 *    Load sets where an audio cue starts next time; Memo does nothing, but its pre-wait
 *    counts down in Active Cues, which is what makes the sections of a track visible;
 *    Network sends one OSC message; Mix moves the mixer's buses (music, effects, vocals;
 *    voices = the live mics) over its `duration` (the host's `mix` hook does it).
 *  - Every audio cue plays on a bus: `music` (a scene's music track, the `/mix`
 *    cues) or `effects` (everything else), unless it names its own `bus` (`vocals`: a
 *    recorded vocal track, on a fader of its own).
 *  - A cue with `armed: false` starts disarmed; toggleArm() flips it live.
 *  - Panic (Esc) fades everything out over PANIC_FADE; again within PANIC_HARD_WINDOW
 *    it stops everything dead. Pause All / Resume All, pause one cue, Reset (stop
 *    everything, playheads to the top) and Load to Time are QLab's too.
 *
 * Plain node, no Electron: the audio, the network and the clock are injected, so the
 * tests drive the engine with fakes. A host app owns one engine, plays the audio
 * wherever it likes (the "audio backend" in the comments below) and delivers the
 * network messages itself.
 *
 *   audio:  { play(key, {file, gainDb, from, loop}), move(key, {to, region, sync}), fade(key, db, secs), stop(key), setLoop(key, on) }
 *           play may also carry `pan` (−100 … 100), `automation` (its other lines: core/audio/lanes.js),
 *           `rate` (and `preservePitch`) and `envelope` ([[seconds, dB], …]: the sound's level drawn
 *           over its length, which the backend follows by where the sound is); fade(key, db, secs, range, shape, from):
 *           `shape` is the fade's curve (core/audio/curves.js; none: a straight line in dB) and `from` how far into that
 *           curve it starts (a paused fade taken up again); rate(key, rate, secs) moves how fast the sound plays.
 *           move: when sound `key` reaches sync.at s into its file (about sync.lead s from now) it
 *           crossfades, inside itself, to `to` over sync.xf s ('cut' | 'fade' | 'dj'), looping `region`
 *           and the host calls engine.audioEnded(key) / engine.setDuration(file, secs)
 *           / engine.setMissing(file) back.
 *   send:   (message: string) => void        "/some/address 1 2.5 text" (see encodeOsc)
 *   video:  { show(key, spec), move(key, props, secs), pause(key), resume(key), seek(key, t), hide(key) }
 *           the stage (an output window): a cue with a `picture` ('video' | 'image' | 'text' | 'camera') is
 *           drawn there. A video file is an audio cue to this engine (its sound plays, pauses, skips and
 *           fades as any sound does) with a picture kept in step; a still, a title or a camera is a
 *           `picture` cue, which runs until it is stopped. `move` takes some of opacity (0–100), x, y,
 *           scale, rotation to new values over `secs`.
 *   mix:    (cue) => void                    a Mix cue fired
 *   lights: (cue) => void                    a Light cue fired while light cues are on: the host
 *           can fire it on a lighting desk
 *   clock:  { now() (seconds), setTimeout, clearTimeout }
 *   log:    (line: string) => void           one line per thing the engine did
 */
import { EventEmitter } from 'events';
import { gridOf } from '../audio/tempo';
import { geometryOf, movesOf } from '../video/stage';
import * as networkCue from '../net/network-cue';
import * as midiText from '../net/midi';
import * as scriptOf from '../show/script';
import { limitDb } from '../audio/curves';
import { sequencing, type Sequencing } from './sequencing';
import { soundKinds, type SoundKinds } from './sound-kinds';
import type { CueFields, Region, Shape, Envelope, Automation, Sweep } from '../show/types';
import type { Geometry } from '../video/stage';

/** A cue as the engine plays it (show.js toEngineDoc makes one): the show file's fields, its continue mode as two
 *  flags, a video as an audio cue with a `picture`, a still, a title or a camera as a `picture` cue, a Devamp as a
 *  `release`, and anything that cannot work marked `broken`. */
export interface EngineCue extends Omit<CueFields, 'continue' | 'onBeat' | 'target' | 'fadeTo'> {
  id: string;
  type: string;
  children?: EngineCue[];
  target?: string | null;
  onBeat?: 'now' | 'beat' | 'bar' | 'best' | boolean;
  fadeTo?: number | '';
  autoContinue?: boolean;
  autoFollow?: boolean;
  /** on the stage: 'video' | 'image' | 'text' | 'camera' */
  picture?: string;
  /** a Device cue: what it is called where it is said ("Lantern A ▸ Effect (breathe)") */
  sends?: string;
  broken?: string;
  /** places that loop cleanly, besides its `loops` */
  loopOptions?: Span[];
  /** a music move's possible landings, with how well each downbeat of the track leaves for it */
  landings?: Landing[];
  /** whether its beats are its own (not made from its tempo) */
  ownGrid?: boolean;
}
/** Where a music move may land: `to`, and how well the track's downbeats leave for it ([t, score, grid]). */
export interface Landing { to: number; scores?: [number, number, number][]; grid?: number }
/** One cue list, as the engine has it. */
export interface EngineList { id?: string; name: string; cues: EngineCue[] }
/** What load() takes (format 'ec-cuelist'). */
export interface EngineDoc { format: string; version?: number; lists: EngineList[] }

/** A stretch of a sound's file, in seconds: a section it goes round, or a hold armed on it. */
export interface Span { start: number; end: number; count?: number; free?: boolean; bars?: number; index?: number; debug?: boolean; hold?: boolean }

/** A timer from the engine's clock: only ever handed back to it. */
export type Timer = unknown;
export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): Timer; clearTimeout(timer: Timer): void }

/** What the stage is told to draw (`show`), less where and from where. */
export interface PictureSpec {
  kind?: string; file: string; text: string; font: string; size: number; textColor: string; align: string;
  camera: string; mirror: boolean; fit: string; layer: number; loop: boolean;
}

/** What the engine knows of a sound (or a picture) it has started: `running`, by cue id. */
export interface Running {
  /** when it was at `from` (in a move's lead: when the move lands) */
  startedAt: number;
  from: number;
  file: string | undefined;
  db: number;
  fade: { to: number; until: number; shape?: Shape } | null;
  loop: boolean;
  rate?: number;
  warp?: number;
  stretched?: boolean;
  /** a live input, or a picture with no sound: no file, no end */
  live?: boolean;
  still?: boolean;
  pausedAt?: number | null;
  /** a video holding its last frame: where */
  ended?: number;
  prev?: Pick<Running, 'from' | 'startedAt' | 'region' | 'loopTo'> | null;
  tail?: Timer | null;
  counting?: Timer | null;
  region?: Span | null;
  loopTo?: Span | null;
  holdQueue?: Span[];
  exact?: boolean;
  cutSent?: boolean;
  noCut?: boolean;
  band?: number;
  duck?: number;
  pic?: Geometry | null;
  spec?: PictureSpec;
}

/** A pre-wait (or a continue's post-wait) counting down: `waits`, by cue id. */
export interface Wait { timer: Timer; startedAt: number; total: number; pausedAt?: number | null; run?: () => void; post?: boolean }

/** Anything else with a time of its own: a fade, a Wait cue, a script, a faded network value, timecode or a MIDI
 *  file, the app's lights: `fades`, by its own key. `done` is called when it has run its time. */
export interface Fade {
  timer: Timer;
  startedAt: number;
  total: number;
  target: string;
  done: () => void;
  pausedAt?: number | null;
  /** a sound's rate moving, to `to` */
  rate?: boolean;
  to?: number;
  last?: number;
  net?: boolean;
  steps?: boolean;
  wait?: boolean;
  /** played out by the host: 'timecode' | 'midifile' */
  run?: string;
  light?: boolean;
  sent?: number | null;
}

/** A music move worked out at its GO (blendPlan), carried out when it fires. */
export interface BlendPlan { out: string; at: number; to: number | null; score: number | null; xf: number; blend: string; centreIn: number; madeAt: number; wait: number }
/** How a track moves inside itself: from `at` s into it (the middle of the crossfade), over `xf` s, as `blend`, the audio
 *  backend told `lead` s ahead. */
export interface MovePlan { at: number; xf: number; blend: string; lead: number; beatLead?: number; secs?: number; to?: number | null; score?: number | null }

/** What the buses' kinds ask of the engine (sound-kinds.ts). */
export interface BusRule { stopFade?: number; oneAtATime?: number; live?: boolean }

/** The audio backend (see the top of this file). */
export interface PlayOptions {
  file?: string; mic?: { input: string; channel: number }; gainDb: number; from?: number; loop?: boolean; exact?: boolean; bus: string;
  rate?: number; preservePitch?: boolean; envelope?: Envelope; pan?: number; automation?: Automation;
}
export interface MoveOptions { to: number; region: Span | null; sync: { at: number; lead: number; xf: number; blend: string } }
export interface EngineAudio {
  play(key: string, o: PlayOptions): void;
  stop(key: string): void;
  fade(key: string, db: number, secs: number, range?: string, shape?: Shape, from?: number): void;
  move?(key: string, o: MoveOptions): void;
  pause?(key: string): void;
  resume?(key: string): void;
  seek?(key: string, t: number): void;
  cut?(key: string, at: number): void;
  setRegion?(key: string, start: number | null, end: number | null): void;
  setLoop?(key: string, on: boolean): void;
  rate?(key: string, rate: number, secs: number): void;
  duck?(key: string, db: number, secs: number): void;
  sweep?(key: string, to: Sweep, secs: number): void;
}
/** The stage (an output window). */
export interface EngineStage {
  show?(key: string, spec: PictureSpec & { from: number; geometry: Geometry }): void;
  move?(key: string, props: Partial<Geometry>, secs: number): void;
  pause?(key: string): void;
  resume?(key: string): void;
  seek?(key: string, t: number): void;
  hide?(key: string): void;
}
/** How a warped sound plays (the Live view): `rate` times its own, keeping its pitch or not. */
export interface Warp { rate: number; keepPitch?: boolean }
export type DmxAction = 'run' | 'fade' | 'done';
export interface EngineOptions {
  audio: EngineAudio;
  send?: (message: string, cue: EngineCue) => void;
  mix?: (cue: EngineCue) => void;
  lights?: (cue: EngineCue) => void;
  midi?: (cue: EngineCue) => void;
  run?: (cue: EngineCue, offset: number) => number;
  clock?: Clock;
  log?: (line: string) => void;
  panicFade?: number;
  random?: () => number;
  video?: EngineStage;
  warp?: (cue: EngineCue, from: number) => Warp | null;
  limits?: { min: number; max: number } | null;
}
/** What the engine emits: 'change', whenever anything an operator could see has. */
export interface EngineEvents { change: [] }

/** A map by id where a lookup by no id (a top-level cue's parent, a cue with no target) finds nothing. */
interface ById<V> extends Map<string, V> { get(id: string | null | undefined): V | undefined; has(id: string | null | undefined): boolean }
/** A set a file that may be none is looked for in. */
interface Files extends Set<string> { has(file: string | null | undefined): boolean }

/** One line of a Script cue (core/show/script.ts). */
type Step = ReturnType<typeof scriptOf.parse>['steps'][number];
/** A moment a music move may leave from: `d` s into the track, `t` s from now, with the crossfade it would take. */
interface Moment { d: number; xf: { xf: number; blend: string }; t: number; to?: number; s?: number; now?: boolean }

/** A place a scene's music cue loops a track (holdsOf). */
export interface Hold { id: string; start: number; end: number; number: string; name: string }

const BEAT_LEAD = 0.08;         // s: a downbeat closer than this to the GO is too near to land on; the next one is used
const PANIC_FADE = 1.0;         // s: Esc fades everything out over this
const PANIC_HARD_WINDOW = 1.5;  // s: Esc again inside this stops dead
const SILENT_DB = -60;
const CUT_LEAD = 0.3;           // s: how far ahead the audio backend is told of a cutAt
const SYNC_LEAD = 0.25;         // s: how far ahead a move on the beat is handed to the audio backend, which lines it up to the sample
const NOW_LEAD = 0.03;          // s: a move GOne for now goes this soon (the hop to the audio backend)
const BLEND_WITHIN = 4;         // bars a 'best' jump looks ahead for the moment it matches best...
const BLEND_MAX_WAIT = 5.0;     // ...and no more than this many seconds (the next downbeat always counts)
const GOOD_JUMP = 0.8;          // a departure that matches this well is taken at once (the earliest such)
const LOW_GRID = 0.3;           // below this the beat grid is a guess (an ambient stretch): a longer fade, not a downbeat cut
const NET_RATE = 30;             // messages a second while a Network cue fades a value
const AMBIENT_FADE = 3.0;       // s: the crossfade there
const RATE_MIN = 0.25, RATE_MAX = 4;   // how slow and how fast a sound can be played (outside this the backend's stretcher gives up)
const RATE_STEP = 0.05;         // s: while a rate fades, the engine's own clock for the sound is corrected this often
const REVERT_FADE = 0.5;        // s: "revert fade" puts the levels back over this
const clampRate = (v: unknown) => (Number(v) > 0 ? Math.max(RATE_MIN, Math.min(RATE_MAX, Number(v))) : 1);

class CueEngine extends EventEmitter<EngineEvents> {
  warpHook: (cue: EngineCue, from: number) => Warp | null;
  video: EngineStage;
  limits: { min: number; max: number } | null;
  reverts: Map<string, { id: string; db: number; band: number; rate: number }[]>;
  busRules: Record<string, BusRule>;
  midiHook: (cue: EngineCue) => void;
  runHook: (cue: EngineCue, offset: number) => number;
  random: () => number;
  playlists: ById<{ order: string[]; at: number; current: string | null; timer: Timer }>;
  entered: Map<string, number>;
  mixHook: (cue: EngineCue) => void;
  lightsHook: (cue: EngineCue) => void;
  dmxHook: (action: DmxAction, cue: EngineCue, light: EngineCue) => void;
  panicFade: number;
  audio: EngineAudio;
  send: (message: string, cue: EngineCue) => void;
  clock: Clock;
  log: (line: string) => void;
  lists: EngineList[];
  byId: ById<EngineCue>;
  parentOf: ById<string | null>;
  durations: ById<number>;
  missing: Files;
  played: Set<string>;
  listName: string;
  heads: Map<string, string | null>;
  parked: Set<string>;
  homes: ById<EngineList>;
  loads: Map<string, number>;
  ducks: Map<string, { db: number; secs: number }>;
  dealt: Map<string, { left: string[]; last: string | null }>;
  retargets: Map<string, { was: string | null | undefined; to: string }>;
  moved: Map<string, Set<string>>;
  waits: ById<Wait>;
  running: ById<Running>;
  fades: ById<Fade>;
  releaseThen: Map<string, string[]>;
  loadAt: Map<string, number>;
  lastPanic: number;
  lastGo: { id: string; at: number } | null;
  paused: Set<string>;
  disarmed: Set<string>;
  armTouched: Set<string>;
  following: Map<string, { next: string; post: number; advance?: boolean }>;
  checkingFollow: boolean;
  checkingPlaylists?: boolean;
  showStartedAt: number | null;
  loaded: { id: string; at: number } | null;
  held: boolean;
  plans: Map<string, BlendPlan>;
  gridMoves: Map<string, Timer>;
  skipLights: boolean;
  holdsCache?: Map<string, Hold[]>;
  /** a sequence is firing a cue by itself (not a GO's own cue) */
  autoFiring?: boolean;
  /** the plan of the music move whose group is firing now */
  blending?: MovePlan | null;
  /** a playlist crossfading into the cue it fires */
  fadeInOnce?: number;
  startDepth?: number;

  constructor({ audio, send, mix, lights, midi, run, clock, log, panicFade, random, video, warp, limits }: EngineOptions) {
    super();
    // a warped sound (the Live view): `warp(cue, from)` says how fast it plays, { rate, keepPitch }, or null for as it is
    this.warpHook = warp || (() => null);
    this.video = video || {};       // the stage: where a cue with a picture is drawn
    // The show's level limits ({ min, max } dB, Settings ▸ Audio): every level a cue or a fade asks for goes through
    // them on its way to the sound. None: levels are played as written.
    this.limits = limits || null;
    this.reverts = new Map();       // Fade cue id -> what it moved, as it was before ("revert fade")
    this.busRules = {};             // what the buses' kinds ask for: { busId: { stopFade, oneAtATime, live } } (sound-kinds.js; the host sets it)
    this.midiHook = midi || (() => {});
    this.runHook = run || (() => 0);     // a cue the host plays out itself (timecode, a MIDI file): told to start, answers with its length
    this.random = random || Math.random;
    this.playlists = new Map();     // playlist group id -> { order, at, current, timer }: one child after another
    this.entered = new Map();       // a "start first and enter" group at the playhead -> how many of its children have gone
    this.mixHook = mix || (() => {});
    this.lightsHook = lights || (() => {});
    // the app's own lights (a Light cue that holds levels): the host sets this. (action, cue, x): 'run' when the cue
    // goes, 'fade' when a Fade aimed at it goes (x: the Light cue), 'done' when either has run its time
    this.dmxHook = () => {};
    this.panicFade = Number.isFinite(panicFade) ? panicFade! : PANIC_FADE;   // s: a show setting
    this.audio = audio;
    this.send = send || (() => {});
    this.clock = clock || { now: () => Date.now() / 1000, setTimeout, clearTimeout };
    this.log = log || (() => {});
    this.lists = [];
    this.byId = new Map();
    this.parentOf = new Map();
    this.durations = new Map();     // file -> seconds
    this.missing = new Set<string>();       // files that cannot be played
    this.played = new Set();        // cues that have fired since the last Reset (the list shows a cue's second colour)
    this.listName = 'Main';
    // Each cue list keeps its own playhead: list name -> the cue standing by in it. `playhead` (below) is the
    // one of the list on screen; a list that is not on screen keeps its place, and keeps running.
    this.heads = new Map();
    this.parked = new Set();        // lists whose playhead was put on no cue on purpose (a reload leaves it there)
    this.homes = new Map();         // cue id -> the list it is in
    this.loads = new Map();         // cue id -> seconds: its next fire starts that far in (a Load cue, a remote's load)
    this.ducks = new Map();         // a cue that ducks (or boosts) the others while it runs -> { db, secs }
    this.dealt = new Map();         // a "start one at random" group -> { left, last }: the children still to come this round
    this.retargets = new Map();     // a cue a Target cue has re-aimed -> { was, to }
    this.moved = new Map();         // a Fade cue that has run -> the sounds it moved (a Reset cue puts them back)
    this.waits = new Map();         // cue id -> { timer, startedAt, total, parent }
    this.running = new Map();       // audio cue id -> { startedAt, from, file, db, fade: {to, until} }
    this.fades = new Map();         // fade cue id -> { startedAt, total, target, timer }
    // a sound a Devamp has let out of its loop -> the cue that starts when its last pass ends (the Devamp's `startNext`)
    this.releaseThen = new Map();
    this.loadAt = new Map();        // audio cue id -> seconds to start from next time
    this.lastPanic = -Infinity;
    this.lastGo = null;
    this.paused = new Set();        // ids of waits, audio and fades that are paused
    this.disarmed = new Set();      // cue ids skipped when they would fire (QLab's Disarm)
    this.armTouched = new Set();    // flipped by hand (D) since launch: a reload keeps the operator's choice
    this.following = new Map();     // auto-follow: top cue id -> { next, post }: fire `next` when it finishes
    this.checkingFollow = false;
    this.showStartedAt = null;      // the Show list's first GO since Reset: the show clock
    this.loaded = null;             // { id, at }: the next fire of `id` starts `at` seconds in (Load to Time)
    this.held = false;              // Hold (H): the track playing loops a section until let go
    this.plans = new Map();         // blended jump group id -> { out, at, xf, blend }: decided at its GO, carried out when it fires
    this.gridMoves = new Map();     // audio cue id -> the timer of a skip or fade waiting for its bar line (moveOnGrid)
    // Light cues: cues for a lighting desk, listed among the others. In the engine they are GOs that do
    // nothing by themselves (the operator calls them, or the host's `lights` hook fires them on the desk). With
    // skipLights on they are not stops: steps() leaves them out, so GO, the arrows, auto-continue, Reset and a
    // reload never put the playhead on one.
    this.skipLights = false;
  }

  /** The playhead of the list on screen. */
  get playhead() { const id = this.heads.get(this.listName); return id == null ? null : id; }
  set playhead(id) { this.heads.set(this.listName, id == null ? null : id); if (id != null) this.parked.delete(this.listName); }

  // ── loading ───────────────────────────────────────────────────────────

  /** Load a cue list document (format 'ec-cuelist'; show.js's toEngineDoc makes one). Keeps the playhead on the same
   *  cue when it is still there, so a regenerated list does not lose the place. */
  load(doc: EngineDoc) {
    if (!doc || (doc.format !== 'ec-cuelist' && doc.format !== 'ef-cuelist') || !Array.isArray(doc.lists)) {
      throw new Error('not a cue list document');
    }
    this.lists = doc.lists;
    this.holdsCache = new Map();
    this.byId.clear();
    this.parentOf.clear();
    this.homes.clear();
    const walk = (cues: EngineCue[], parent: string | null, list: EngineList) => {
      for (const c of cues) {
        if (this.byId.has(c.id)) throw new Error(`two cues with the id ${c.id}`);
        this.byId.set(c.id, c);
        this.parentOf.set(c.id, parent);
        this.homes.set(c.id, list);
        if (c.children) walk(c.children, c.id, list);
      }
    };
    for (const l of this.lists) walk(l.cues, null, l);
    for (const c of this.byId.values()) if (c.type === 'audio' && c.tempo) this.gridFromTempo(c);
    for (const [id, c] of this.byId) {
      if (this.armTouched.has(id)) continue;
      if (c.armed === false) this.disarmed.add(id); else this.disarmed.delete(id);
    }
    for (const c of this.byId.values()) {
      if (c.target && !this.byId.has(c.target) && !this.listAt(c.target)) throw new Error(`cue ${c.id} targets ${c.target}, which is not in the list`);
    }
    this.keepRetargets();
    // A cue the new list no longer has cannot be shown or finished: drop what is
    // waiting on it. A sound still playing from it carries on (silence mid-show
    // because a file was regenerated would be worse) and stops on Stop/Panic.
    for (const id of [...this.waits.keys()]) if (!this.byId.has(id)) this.cancelWait(id);
    for (const id of [...this.playlists.keys()]) if (!this.byId.has(id)) this.endPlaylist(id);
    for (const [id, f] of [...this.fades]) if (!this.byId.has(id) && !String(id).includes(':')) { this.clock.clearTimeout(f.timer); this.fades.delete(id); }
    if (!this.list(this.listName)) this.listName = this.lists[0] ? this.lists[0].name : 'Main';
    for (const name of [...this.heads.keys()]) if (!this.list(name)) { this.heads.delete(name); this.parked.delete(name); }
    for (const l of this.lists) {
      const head = this.heads.get(l.name);
      if (head == null && this.parked.has(l.name)) continue;                    // on no cue, on purpose
      if (!head || !l.cues.some((c) => c.id === head)) this.heads.set(l.name, this.steps(l.name)[0] ? this.steps(l.name)[0].id : null);
      else if (this.skipLights) this.heads.set(l.name, this.stopFrom(head));   // a light cue added under the playhead
    }
    this.changed();
  }

  /** Every audio file the list plays (so the host can measure them and find the missing). */
  files() {
    return [...new Set([...this.byId.values()].filter((c) => c.type === 'audio').map((c) => c.file))];
  }

  /** Every still image the list shows (the host says which are missing; they have no length to measure). */
  stills(): string[] {
    return [...new Set([...this.byId.values()].filter((c) => c.type === 'picture' && c.file).map((c) => c.file as string))];
  }

  /** A cue that carries a tempo and no beat list of its own gets its beats and bar lines from the tempo,
   *  as far as its sound runs (half an hour, until its length is known). */
  gridFromTempo(c: EngineCue) {
    if (!c.tempo || (c.ownGrid === undefined ? (c.ownGrid = Array.isArray(c.beats) && c.beats.length > 0) : c.ownGrid)) return;
    const length = Number(c.cutAt) > 0 ? Number(c.cutAt) : this.durations.get(c.file) || 1800;
    const g = gridOf(c.tempo, length);
    c.beats = g.beats; c.downbeats = g.downbeats;
  }

  setDuration(file: string, secs: number) {
    this.durations.set(file, secs);
    for (const c of this.byId.values()) if (c.file === file && c.tempo) this.gridFromTempo(c);
    for (const [id, r] of this.running) if (r.file === file && !r.tail && !this.fades.has(`tail:${id}`)) this.scheduleTail(id);
    for (const [id, r] of this.running) if (r.file === file && !r.region && !r.loopTo) this.armCounted(id);     // a play count needs the length
    for (const gid of this.playlists.keys()) this.planCrossfade(gid);
    this.changed();
  }
  setMissing(file: string) { this.missing.add(file); this.changed(); }

  list(name: string) { return this.lists.find((l) => l.name === name); }
  /** The cue list with this id (a Start, Stop or Fade cue can be aimed at a whole list). */
  listAt(id: string | null | undefined) { return (id != null && this.lists.find((l) => l.id != null && l.id === id)) || null; }
  /** Whether `id` is `target` or under it; a target that is a cue list holds every cue in it. */
  within(id: string, target: string | null | undefined) { return id === target || this.isInside(id, target) || (target != null && (this.homes.get(id) || {}).id === target); }
  top() { const l = this.list(this.listName); return l ? l.cues : []; }
  /** The cues the playhead stops on: the list, less the light cues while they are off. Every
   *  "where does the playhead go next" goes through this. */
  steps(name = this.listName): EngineCue[] { const l = this.list(name), top = l ? l.cues : []; return this.skipLights ? top.filter((c) => !isCall(c)) : top; }
  /** The first stop at or after `id` in the list (null at the end): where a playhead on a
   *  cue that is no longer a stop goes. */
  stopFrom(id: string): string | null {
    const top = (this.homes.get(id) || { cues: [] }).cues;
    const i = top.findIndex((c) => c.id === id);
    if (i < 0) return null;
    const c = top.slice(i).find((x) => !(this.skipLights && isCall(x)));
    return c ? c.id : null;
  }
  /** Light cues on (stops) or off (skipped). Off with the playhead on one: it moves on to the next real GO. */
  setSkipLights(skip?: boolean | null) {
    skip = !!skip;
    if (skip === this.skipLights) return;
    this.skipLights = skip;
    if (skip) for (const [name, head] of this.heads) if (head && isCall(this.byId.get(head))) this.heads.set(name, this.stopFrom(head));
    if (this.loaded && this.loaded.id !== this.playhead) this.loaded = null;
    this.log(`LIGHT CUES ${skip ? 'OFF (skipped)' : 'ON'}`);
    this.changed();
  }

  // ── the operator's controls ───────────────────────────────────────────

  selectList(name: string) {
    if (!this.list(name)) return;
    this.listName = name;                           // (its own playhead is where it was left)
    if (!this.heads.has(name)) this.playhead = this.steps()[0] ? this.steps()[0].id : null;
    if (this.loaded && this.loaded.id !== this.playhead) this.loaded = null;
    this.changed();
  }

  /** The playhead onto a top-level cue, in whichever list it is in (that list's playhead; the list on screen stays).
   *  `null`: the list on screen has no cue standing by, and GO does nothing until the playhead is put on one. */
  setPlayhead(id: string | null | undefined) {
    if (id == null) { this.heads.set(this.listName, null); this.parked.add(this.listName); this.loaded = null; this.changed(); return; }
    const l = this.homes.get(id);
    if (!l || this.parentOf.get(id) !== null) return;
    this.heads.set(l.name, this.stopFrom(id));      // a light cue while they are off: the next real GO
    this.parked.delete(l.name);
    this.changed();
  }

  movePlayhead(step: number) {
    const top = this.steps();
    const i = top.findIndex((c) => c.id === this.playhead);
    const j = Math.max(0, Math.min(top.length - 1, (i < 0 ? 0 : i) + step));
    if (top[j]) this.setPlayhead(top[j].id);
  }

  /** Fire the cue at the playhead and move to the next one. `name`: the GO of that list, on its own playhead,
   *  whether or not it is the list on screen (`byCue`: a Start cue aimed at the list, not the operator's hand). */
  go(name = this.listName, byCue = false) {
    const l = this.list(name);
    if (!l) return null;
    const top = this.steps(l.name);
    const i = top.findIndex((c) => c.id === this.heads.get(l.name));
    if (i < 0) return null;
    const cue = top[i];
    const head = (id: string | null) => this.heads.set(l.name, id);
    if (this.held && !byCue) this.setHold(false);         // a GO is the operator moving on
    if (!byCue) this.lastGo = { id: cue.id, at: this.clock.now() };
    if (this.lists[0] && l.name === this.lists[0].name && this.showStartedAt == null) this.showStartedAt = this.clock.now();
    // "start first and enter": each GO fires the next child of the group (and whatever continues from it); the
    // playhead stays on the group until its last child has gone
    const kids = cue.type === 'group' && cue.mode === 'enter' && !this.disarmed.has(cue.id) ? cue.children || [] : [];
    const k = kids.length ? Math.min(this.entered.get(cue.id) || 0, kids.length - 1) : 0;
    if (kids.length) {
      this.entered.set(cue.id, k + 1);
      this.log(`GO ${cue.number || cue.id} ${cue.name}: ${k + 1} of ${kids.length}, ${kids[k].name}`);
      if (k === 0) this.fire(cue.id);
      else { this.fire(kids[k].id); this.continueAfter(kids[k].id, false); }
      if (this.loaded && this.loaded.id === cue.id) this.loaded = null;
      if ((this.entered.get(cue.id) || 0) < kids.length) { this.changed(); return cue.id; }
      this.entered.delete(cue.id);
      head(top[i + 1] ? top[i + 1].id : null);
      this.continueAfter(cue.id);
      this.changed();
      return cue.id;
    }
    head(top[i + 1] ? top[i + 1].id : null);
    this.log(`GO ${cue.number || cue.id} ${cue.name}` + (this.loaded && this.loaded.id === cue.id ? ` from ${this.loaded.at} s` : ''));
    const did = this.fire(cue.id);
    if (this.loaded && this.loaded.id === cue.id) this.loaded = null;
    if (did !== 'second') this.continueAfter(cue.id);     // (a second trigger of a running cue does not run its sequence again)
    this.changed();
    return cue.id;
  }

  /** QLab's continue modes, after `id` (a top-level cue) has fired. Auto-continue: the
   *  next cue fires `postWait` s later (now, with none) and the playhead passes it.
   *  Auto-follow: it fires `postWait` s after this one finishes. Either way the next
   *  cue is still a cue of its own, so it can be GOne again by itself. */
  continueAfter(id: string, advance = true) {
    // (in whichever list the cue is in: a sequence started by a trigger or a Start cue runs in a list that is not showing)
    const l = this.lists.find((x) => x.cues.some((c) => c.id === id));
    // (inside a group that starts its first child, the children's continue modes run from one to the next)
    const within = l ? null : this.byId.get(this.parentOf.get(id));
    if (!l && !(within && (within.mode === 'enter' || within.mode === 'first'))) return;
    const top = within ? within.children! : this.skipLights ? l!.cues.filter((c) => !isCall(c)) : l!.cues;
    const i = top.findIndex((c) => c.id === id);
    const cue = top[i];
    const next = top[i + 1];
    if (!cue || !next || !(cue.autoContinue || cue.autoFollow)) return;
    if (within) { advance = false; if (this.entered.has(within.id)) this.entered.set(within.id, Math.max(this.entered.get(within.id)!, i + 2)); }
    // a GO's sequence takes the playhead past itself; one started any other way leaves the playhead alone
    if (advance && l && this.heads.get(l.name) === next.id) this.heads.set(l.name, top[i + 2] ? top[i + 2].id : null);
    const own = this.waits.get(cue.id);                        // its own wait (an onBeat / bar GO): the next comes when it lands
    const post = (Number(cue.postWait) > 0 ? Number(cue.postWait) : 0) + (own && !cue.autoFollow ? own.total : 0);
    if (cue.autoFollow) { this.following.set(cue.id, { next: next.id, post, advance }); return; }
    this.chain(next, post, 'auto-continue', advance);
  }

  /** Start a cue as a trigger, a Start cue or a remote does (QLab's "start"): it fires and its sequence runs
   *  (auto-continue, auto-follow), and the playhead stays where it is. */
  start(id: string) {
    const cue = this.byId.get(id);
    if (!cue) return false;
    this.log(`START ${cue.number || cue.id} ${cue.name}`);
    const did = this.fire(id);
    if (did !== 'second' && this.parentOf.get(id) === null) this.continueAfter(id, false);
    this.changed();
    return true;
  }

  /** Fire `next` (and whatever continues from it) after `post` s; the wait shows in Active Cues. */
  chain(next: EngineCue, post: number, why: string, advance = true) {
    const run = () => {
      this.log(`  ↳ ${why} ${next.number || next.id} ${next.name}`);
      this.autoFiring = true;
      try { this.fire(next.id); } finally { this.autoFiring = false; }
      this.continueAfter(next.id, advance);
      this.changed();
    };
    if (!(post > 0)) { run(); return; }
    this.cancelWait(next.id);
    const timer = this.clock.setTimeout(() => { this.waits.delete(next.id); run(); }, post * 1000);
    this.waits.set(next.id, { timer, startedAt: this.clock.now(), total: post, run, post: true });
  }

  /** Auto-follow: a cue that has finished fires the one after it. */
  checkFollows() {
    if (!this.following.size || this.checkingFollow) return;
    this.checkingFollow = true;
    try {
      for (const [id, f] of [...this.following]) {
        if (this.isLive(id)) continue;
        this.following.delete(id);
        const next = this.byId.get(f.next);
        if (next) this.chain(next, f.post, 'auto-follow', f.advance !== false);
      }
    } finally { this.checkingFollow = false; }
  }

  /** Esc: everything out over PANIC_FADE; a second Esc soon after stops dead. */
  panic() {
    const now = this.clock.now();
    const hard = now - this.lastPanic < PANIC_HARD_WINDOW;
    this.lastPanic = now;
    this.following.clear();
    for (const id of [...this.playlists.keys()]) this.endPlaylist(id);
    for (const id of [...this.waits.keys()]) this.cancelWait(id);
    for (const [id, f] of this.fades) { this.clock.clearTimeout(f.timer); this.fades.delete(id); }
    this.releaseThen.clear();
    if (this.held) { this.held = false; for (const k of [...this.running.keys()]) this.release(k); }   // Esc lets go of Hold
    for (const [id, r] of [...this.running]) {
      if (hard || r.pausedAt != null) this.stopAudio(id);
      else this.fadeAudio(id, SILENT_DB, this.panicFade, true, `panic:${id}`);
    }
    this.loaded = null;
    this.log(hard ? 'STOP ALL (hard)' : `STOP ALL (fade ${this.panicFade} s)`);
    this.changed();
  }

  /** Stop one cue (from Active Cues). */
  stopCue(id: string) {
    this.following.delete(this.topOf(id));
    this.leavePlaylists(id);                    // the operator's stop on a playlist's sound ends the playlist, not only the song
    this.stopTree(id, true);
    this.changed();
  }

  /** Pause one top-level cue and everything under it (P), or everything (Pause All, '['). */
  pause(id: string | null = null) {
    const now = this.clock.now();
    this.log(id == null ? 'PAUSE ALL' : `PAUSE ${id}`);
    const mine = (x: string) => id == null || x === id || this.isInside(x, id);
    for (const [k, w] of this.waits) {
      if (!mine(k) || w.pausedAt != null) continue;
      this.clock.clearTimeout(w.timer); w.pausedAt = now;
    }
    for (const [k, f] of this.fades) {
      if (!(mine(k) || mine(f.target)) || f.pausedAt != null) continue;
      this.clock.clearTimeout(f.timer); f.pausedAt = now;
    }
    for (const [k, r] of this.running) {
      if (!mine(k) || r.pausedAt != null || r.ended != null) continue;     // (a video holding its last frame has nothing to pause)
      // in a move's lead: it has not moved yet, and the audio backend undoes it, so it is where it was
      if (r.prev && now < r.startedAt) { Object.assign(r, r.prev); this.log(`  ↳ ${k}: the move had not landed, undone`); }
      r.prev = null;
      r.pausedAt = now;
      if (r.tail) { this.clock.clearTimeout(r.tail); r.tail = null; }
      if (r.counting) { this.clock.clearTimeout(r.counting); r.counting = null; }
      this.audio.pause && this.audio.pause(k);
      if (r.pic) this.stage('pause', k);
    }
    this.changed();
  }

  /** Resume what pause() held (']' for everything). */
  resume(id: string | null = null) {
    const now = this.clock.now();
    this.log(id == null ? 'RESUME ALL' : `RESUME ${id}`);
    const mine = (x: string) => id == null || x === id || this.isInside(x, id);
    for (const [k, r] of this.running) {
      if (!mine(k) || r.pausedAt == null) continue;
      r.startedAt += now - r.pausedAt; r.pausedAt = null;
      this.audio.resume && this.audio.resume(k);
      if (r.pic) this.stage('resume', k);
      if (!this.fades.has(`tail:${k}`)) this.scheduleTail(k);
    }
    for (const [k, w] of this.waits) {
      if (!mine(k) || w.pausedAt == null) continue;
      const left = w.total - (w.pausedAt - w.startedAt);
      w.startedAt += now - w.pausedAt; w.pausedAt = null;
      const cue = this.byId.get(k);
      const run = w.run || (() => { this.act(cue!); this.changed(); });
      w.timer = this.clock.setTimeout(() => { this.waits.delete(k); run(); }, Math.max(0, left) * 1000);
    }
    for (const [k, f] of this.fades) {
      if (!(mine(k) || mine(f.target)) || f.pausedAt == null) continue;
      const left = f.total - (f.pausedAt - f.startedAt);
      f.startedAt += now - f.pausedAt; f.pausedAt = null;
      const r = this.running.get(f.target);
      // (a shaped fade goes on along what is left of its shape)
      if (f.rate) { if (r) this.audio.rate && this.audio.rate(f.target, f.to!, Math.max(0, left)); }
      else if (r && r.fade && r.fade.shape && left > 0) this.audio.fade(f.target, r.fade.to, left, undefined, r.fade.shape, Math.max(0, 1 - left / f.total));
      else if (r && r.fade) this.audio.fade(f.target, r.fade.to, Math.max(0, left));
      f.timer = this.clock.setTimeout(f.done, f.net || f.steps ? 0 : Math.max(0, left) * 1000);       // (a faded network value goes on ticking; a script finds its own place)
    }
    for (const gid of this.playlists.keys()) this.planCrossfade(gid);
    this.changed();
  }

  isPaused(id: string) {
    const mine = (x: string) => x === id || this.isInside(x, id);
    return [...this.running].some(([k, r]) => mine(k) && r.pausedAt != null)
      || [...this.waits].some(([k, w]) => mine(k) && w.pausedAt != null);
  }

  /** A level change on a playing sound, by `delta` dB from wherever it is now
   *  (so a duck holding it down stays a duck). The cue's own level is the
   *  host's to save, and comes back when the list is loaded again. */
  trim(id: string, delta: number) {
    const r = this.running.get(id);
    if (!r || !delta) return;
    const want = (r.fade ? r.fade.to : r.db) + delta, to = this.lim(want);
    delta += to - want;                         // (held at the show's level limit)
    if (!delta) return;
    r.db += delta;
    if (r.fade) r.fade.to = to;
    // during a fade (a tail, a fade-in) the fade goes on, to its new level, over what is left of it
    this.audio.fade(id, to, r.fade ? Math.max(0.25, r.fade.until - this.clock.now()) : 0.25);
    this.log(`TRIM ${id} ${delta > 0 ? '+' : ''}${delta} dB`);
    this.changed();
  }

  /** Fade everything out over `secs` and stop it; anything still waiting is dropped. */
  fadeAll(secs = 5) {
    this.following.clear();
    for (const id of [...this.playlists.keys()]) this.endPlaylist(id);
    for (const id of [...this.waits.keys()]) this.cancelWait(id);
    for (const [id, r] of [...this.running]) {
      if (r.pausedAt != null) this.stopAudio(id);
      else this.fadeAudio(id, SILENT_DB, secs, true, `fadeall:${id}`);
    }
    this.log(`FADE ALL OUT ${secs} s`);
    this.changed();
  }

  /** Disarm / arm a cue: a disarmed cue (and everything in it) is skipped when it would fire. */
  toggleArm(id: string) {
    if (!this.byId.has(id)) return;
    this.armTouched.add(id);
    if (this.disarmed.has(id)) this.disarmed.delete(id); else this.disarmed.add(id);
    this.log(`${this.disarmed.has(id) ? 'DISARMED' : 'ARMED'} ${id}`);
    this.changed();
  }

  /** Jump the playhead to a cue by its number, in whichever list has it. */
  jumpTo(number: unknown) {
    // "lq 2" is the light cue LQ2
    const want = String(number).trim().toLowerCase().replace(/^lq\s+/, 'lq');
    for (const l of this.lists) {
      // by its number; else by its id (a cue the operator renumbered is still found by its original id)
      const c = l.cues.find((x) => String(x.number || x.id).toLowerCase() === want) || l.cues.find((x) => String(x.id).toLowerCase() === want);
      if (c) { this.listName = l.name; this.playhead = c.id; if (this.skipLights) this.playhead = this.stopFrom(c.id); this.changed(); return true; }
    }
    return false;
  }

  /** Reset: everything stopped dead, every list's playhead back to its first cue. */
  reset() {
    for (const id of [...this.playlists.keys()]) this.endPlaylist(id);
    for (const id of [...this.waits.keys()]) this.cancelWait(id);
    for (const [id, f] of this.fades) { this.clock.clearTimeout(f.timer); this.fades.delete(id); }
    this.releaseThen.clear();
    for (const id of [...this.running.keys()]) this.stopAudio(id);
    this.loadAt.clear();
    this.loaded = null;
    this.showStartedAt = null;
    this.lastGo = null;
    this.played.clear();
    this.following.clear();
    this.held = false;
    this.entered.clear();
    this.loads.clear();
    this.ducks.clear();
    this.dealt.clear();
    this.moved.clear();
    for (const [id, t] of this.retargets) if (this.byId.has(id)) this.byId.get(id)!.target = t.was;
    this.retargets.clear();
    this.holdsCache = new Map();
    this.parked.clear();
    for (const l of this.lists) this.heads.set(l.name, this.steps(l.name)[0] ? this.steps(l.name)[0].id : null);
    this.log('RESET');
    this.changed();
  }

  /** Load to Time (⌘T): the next GO of the cue at the playhead starts `secs` into it. With an `id`, that cue is
   *  loaded instead, wherever it is (a remote's load): its next fire, however it comes, starts there. */
  loadToTime(secs: number, id = this.playhead) {
    if (!id || !this.byId.has(id)) return;
    this.setLoad(id, secs);
    this.changed();
  }

  /** A cue loaded to a time: the one standing by shows it (`loaded`); any other keeps it until it next fires. */
  setLoad(id: string, secs: number) {
    if (secs < 0) { const len = this.lengthOf(id); secs = len > 0 ? Math.max(0, len + secs) : 0; }   // that far back from its end
    const at = secs > 0 ? Math.round(secs * 1000) / 1000 : 0;
    if (id === this.playhead) { this.loaded = at ? { id, at } : null; this.loads.delete(id); }
    else if (at) this.loads.set(id, at);
    else this.loads.delete(id);
  }

  /** How long a cue runs from its GO, as far as it can be known: pre-wait, then its sound (from Start to End),
   *  fade or wait; a group, its longest child. 0 when it has no length (a looping sound, an unmeasured file). */
  lengthOf(id: string): number {
    const c = this.byId.get(id);
    if (!c) return 0;
    const pre = Number(c.preWait) > 0 ? Number(c.preWait) : 0;
    if (c.type === 'group') return pre + Math.max(0, ...(c.children || []).map((k) => this.lengthOf(k.id)));
    if (c.type === 'audio') {
      if (c.loop) return 0;
      const end = Number(c.cutAt) > 0 ? Number(c.cutAt) : this.durations.get(c.file) || 0;
      return end > 0 ? pre + Math.max(0, end - (Number(c.from) || 0)) * (Number(c.plays) > 1 ? Math.round(c.plays!) : 1) / clampRate(c.rate) : 0;
    }
    if (c.type === 'midifile') return pre + (this.durations.get(c.file) || 0) / (Number(c.rate) > 0 ? Number(c.rate) : 1);
    return pre + (Number(c.duration) > 0 ? Number(c.duration) : 0);
  }

  /** Hold (H): the track playing loops a section (its `loops`) until let go. `opts.id` + `opts.index`
   *  holds that section of that track; `opts.id` + `opts.region` ({start, end}) holds the
   *  place the loop brace was dragged to, if it is one of the track's `loopOptions`. */
  setHold(on?: boolean | null, opts: { id?: string; index?: number; region?: Span } = {}) {
    const want = typeof on === 'boolean' ? on : !this.held;
    if (want) {
      this.held = true;
      const id = opts.id && this.running.has(opts.id) ? opts.id : this.holdTarget();
      if (id) this.engage(id, opts.region || opts.index);
      this.log('HOLD' + (id && this.running.get(id)!.region ? ` ${this.byId.get(id)!.name} ${this.regionText(this.running.get(id)!.region!)}` : ''));
    } else {
      this.held = false;
      for (const k of [...this.running.keys()]) this.release(k);
      this.log('HOLD off: playing on');
    }
    this.changed();
  }

  /** The track Hold acts on: the newest running one that has sections, else the newest music track (a `/mix` cue). */
  holdTarget() {
    let best = null;
    for (const [id, r] of this.running) {
      const c = this.byId.get(id);
      if (!c || r.pausedAt != null) continue;
      const rank = (c.loops && c.loops.length ? 2 : 0) + (busOf(c) === 'music' ? 1 : 0);
      if (!best || rank > best.rank || (rank === best.rank && r.startedAt > best.r.startedAt)) best = { id, r, rank };
    }
    return best ? best.id : null;
  }

  regionText(g: { start: number; end: number }) { return `${g.start.toFixed(1)}–${g.end.toFixed(1)} s`; }

  /** Loop a section of a running track: `which` (an index into its `loops`, or a
   *  {start, end} that must be one of its `loops` or `loopOptions`), else the section it
   *  is in, else the next. */
  engage(id: string, which?: number | { start: number; end: number } | null) {
    const r = this.running.get(id);
    const c = this.byId.get(id);
    if (!r || !c) return;
    if (this.warped(r, c, 'held in a section')) return;
    const p = this.positionOf(r);
    const loops = (r.exact && c.loops) || [];
    let g: Span | null | undefined = Number.isInteger(which) ? loops[which as number] : null;
    if (which && typeof which === 'object' && r.exact) {
      // only a place checked to loop cleanly: a brace dragged anywhere else is refused
      const near = (l: Span) => Math.abs(l.start - which.start) < 0.02 && Math.abs(l.end - which.end) < 0.02;
      g = loops.find(near) || (c.loopOptions || []).find(near) || null;
      if (!g) return;
    }
    if (!g) g = loops.find((l) => l.start <= p && p < l.end - 0.15) || loops.find((l) => l.start > p);
    if (!g) return;
    if (r.region) this.release(id);
    const q = this.positionOf(r);
    if (q >= g.end - 0.05) this.seek(id, g.start);           // a section behind us: go to it
    r.region = { start: g.start, end: g.end, bars: g.bars, index: loops.indexOf(g) };
    this.audio.setRegion && this.audio.setRegion(id, g.start, g.end);
  }

  /** Loop any stretch of a running track, for debugging (e.g. a stretch dragged on a waveform): no check
   *  that it loops cleanly, so it may click at the wrap. Off (`null`): it lets go, and plays on from where it is. */
  debugLoop(id: string, g: { start: number; end: number } | null) {
    const r = this.running.get(id);
    if (!r) return;
    if (!g) { if (r.region && r.region.debug) { this.release(id); this.log(`  ↳ debug loop off: ${id} plays on`); this.changed(); } return; }
    const start = Math.max(0, Math.min(g.start, g.end)), end = Math.max(g.start, g.end);
    if (!(end - start >= 0.2)) return;
    if (r.region) this.release(id);
    const p = this.positionOf(r);
    if (p < start || p >= end - 0.05) this.seek(id, start);
    r.region = { start, end, index: -1, debug: true };
    this.audio.setRegion && this.audio.setRegion(id, start, end);
    this.log(`  ↳ debug loop: ${id} ${this.regionText(r.region)}${r.exact ? '' : ' (not decoded yet: it loops once it is)'}`);
    this.changed();
  }

  /** An audio cue with a start (`from`), an end (`cutAt`) and `loop`: it loops there, to the sample.
   *  Needs the track decoded; if it is not, it just plays on (decoded later, setExact comes back here). */
  armVamp(id: string): void {
    const r = this.running.get(id);
    const c: Partial<EngineCue> = this.byId.get(id) || {};
    // the section a music cue left it looping (`loopTo`), or the cue's own start to end
    const v: Span | null = (r && r.loopTo) || (c.loop && Number(c.cutAt) > 0 ? { start: Number(c.from) || 0, end: Number(c.cutAt) } : null);
    if (!r || !v || r.region || !r.exact || this.held) return;
    if (this.positionOf(r) >= v.end - 0.05) {
      if (v !== r.loopTo) return;                     // the cue's own start to end, passed: it plays on
      const p = this.positionOf(r), len = v.end - v.start, dur = this.durations.get(r.file) || Infinity;
      // decoded only after the track had gone past an armed loop (a long sound on a slow computer): a free stretch
      // moves on by whole lengths to the one the track is in (whole bars stay on the bar lines); a hold of the
      // show's own is dropped, and said, rather than left armed for ever
      const k = Math.floor((p - v.start) / len) + ((p - v.start) % len > len - 0.05 ? 1 : 0);
      const moved = { ...v, start: v.start + k * len, end: v.end + k * len };
      const c: Partial<EngineCue> = this.byId.get(id) || {};
      if (!v.free || len <= 0.05 || moved.end > dur) {
        this.log(`loop ${this.regionText(v)} on ${c.name || id}: passed before the sound was ready to go round, not held`);
        this.nextHold(r); this.changed();
        return this.armVamp(id);
      }
      this.log(`loop ${this.regionText(v)} on ${c.name || id}: ready only at ${p.toFixed(2)} s, so ${this.regionText(moved)}`);
      r.loopTo = moved;
      return this.armVamp(id);
    }
    r.region = { start: v.start, end: v.end, index: -1, ...(Number(v.count) > 1 ? { count: v.count } : {}) };
    this.audio.setRegion && this.audio.setRegion(id, v.start, v.end);
    this.scheduleCount(id);
  }

  /** The sections a sound goes round a set number of times by itself: its loop regions that carry a `count`, and
   *  its own play count (`plays`: Start to End that many times). A sound with neither takes those of the track
   *  beside it in its group, when it is as long as it (a click goes round with its track). */
  countedOf(c: EngineCue): Span[] {
    const own = (x: EngineCue) => {
      // (`hold`: it goes round until it is let go, with no key pressed to start it)
      const out = (x.loops || []).filter((l) => Number(l.count) > 1 || l.hold).map((l) => ({ start: l.start, end: l.end, count: l.hold ? 0 : Math.round(l.count!) }));
      const start = Number(x.from) || 0, end = Number(x.cutAt) > 0 ? Number(x.cutAt) : this.durations.get(x.file) || 0;
      if (Number(x.plays) > 1 && !x.loop && end > start) out.push({ start, end, count: Math.round(x.plays!) });
      return out;
    };
    const mine = own(c);
    if (mine.length || (c.loops && c.loops.length)) return mine;
    const parent = this.byId.get(this.parentOf.get(c.id));
    const len = this.durations.get(c.file) || 0;
    for (const k of (parent && parent.children) || []) {
      if (k.id === c.id || k.type !== 'audio' || !(len > 0) || Math.abs((this.durations.get(k.file) || 0) - len) >= 0.5) continue;
      const theirs = (k.loops || []).filter((l) => Number(l.count) > 1 || l.hold).map((l) => ({ start: l.start, end: l.end, count: l.hold ? 0 : Math.round(l.count!) }));
      if (theirs.length) return theirs;
    }
    return [];
  }

  /** A sound that has just started (or whose length has just been measured): its counted sections are armed. */
  armCounted(id: string) {
    const r = this.running.get(id), c = this.byId.get(id);
    if (!r || !c) return;
    const ahead = this.countedOf(c);
    if (!ahead.length) return;
    for (const l of ahead) this.armHold(r, l);
    this.armVamp(id);
  }

  /** A counted section lets go by itself in its last pass, so that pass plays out and the sound goes on. */
  scheduleCount(id: string) {
    const r = this.running.get(id);
    if (!r) return;
    if (r.counting) { this.clock.clearTimeout(r.counting); r.counting = null; }
    const g = r.region;
    if (!g || !(Number(g.count) > 1) || r.pausedAt != null) return;
    const len = g.end - g.start;
    const played = this.straight(r);                                   // straight on, not wrapped
    r.counting = this.clock.setTimeout(() => {
      r.counting = null;
      if (this.running.get(id) !== r || r.region !== g) return;
      this.log(`  ↳ ${(this.byId.get(id) || {}).name || id}: pass ${g.count} of ${g.count}, then on`);
      this.toggleHold(id, { start: g.start, end: g.end }, true, true);
    }, Math.max(0, g.start + (g.count! - 0.5) * len - played) / this.rateOf(r) * 1000);
  }

  /** Arm a hold on a running track. More than one can be armed at once: every
   *  armed hold still ahead of the track is kept, in time order; `loopTo` is the next, `holdQueue` the rest.
   *  When the track lets go of one (or is skipped past it) the next becomes `loopTo` (nextHold). */
  armHold(r: Running, loop: Span | null) {
    const p = this.positionOf(r);
    const all = [r.loopTo, ...(r.holdQueue || []), loop].filter((l): l is Span => !!l && l.end > p + 0.05);
    const seen = new Set(), ahead = [];
    for (const l of all.sort((a, b) => a.start - b.start)) {
      const k = `${l.start}:${l.end}`;
      if (!seen.has(k)) { seen.add(k); ahead.push(l); }
    }
    r.loopTo = ahead[0] || null;
    r.holdQueue = ahead.slice(1);
  }

  /** The next armed hold after the one let go of (or skipped past), still ahead of the track. */
  nextHold(r: Running) {
    const p = this.positionOf(r);
    const q = (r.holdQueue || []).filter((l) => l.end > p + 0.05);
    r.loopTo = q.shift() || null;
    r.holdQueue = q;
  }

  /** The one loop control a UI needs (a loop lane, say: blocks drawn over the waveform): a click on a block
   *  there, `loop` = {start, end}, one of the track's holds (holdsOf), stall loops (`loops`) or
   *  `loopOptions`; anything else is refused. The scene's GO arms the scene's holds; this only changes that:
   *   - the block the track is in and looping (holdingIn): let go, this pass plays out, then on (a let-go GO's way);
   *   - armed, not reached yet: disarmed, the track plays through it (until the scene's GO again, Reset or Esc:
   *     the track's armed holds go with the track);
   *   - not armed, still ahead of the track or the track inside it: armed (inside it, it loops at its end);
   *   - behind the track: refused (going back to one is a skip on the waveform).
   *  `free` (the Live view's loop buttons): any stretch of the track is taken, cleanly looping or not.
   *  Returns what it did: 'let go' | 'disarmed' | 'armed' | null. */
  toggleHold(id: string, loop: { start: number; end: number } | null | undefined, free = false, alone = false): 'let go' | 'disarmed' | 'armed' | null {
    // a click runs with its track: the sounds its group started with it, as long as it is, go round with it
    if (!alone) for (const sib of this.withTrack(id)) this.toggleHold(sib, loop, true, true);
    const r = this.running.get(id);
    const c = this.byId.get(id);
    if (!r || !c || !loop) return null;
    if (this.warped(r, c, 'looped')) return null;
    const near = (l: Span | null | undefined) => !!l && Math.abs(l.start - loop.start) < 0.02 && Math.abs(l.end - loop.end) < 0.02;
    const known = free && loop.end > loop.start ? loop : [...this.holdsOf(id), ...(c.loops || []), ...(c.loopOptions || [])].find(near);
    if (!known) { this.log(`loop ${this.regionText(loop)} on ${c.name}: not a place it loops cleanly`); return null; }
    // (a free stretch is marked so: decoded too late to start where it was asked, it goes round where the track is then)
    const g = { start: known.start, end: known.end, ...(free && known === loop ? { free: true } : {}) };
    const queued = (r.holdQueue || []).some(near);
    let did: 'let go' | 'disarmed' | 'armed';
    if (near(r.region) && this.holdingIn(r)) {
      // looping it now: let go, as a let-go GO does
      if (near(r.loopTo)) this.nextHold(r);
      else if (queued) r.holdQueue = r.holdQueue!.filter((l) => !near(l));
      this.held = false;
      this.release(id);
      did = 'let go';
    } else if (near(r.loopTo)) {
      this.nextHold(r);                                 // the next armed one takes its place
      this.release(id);                                 // its region off (nothing has wrapped yet), the next armed
      did = 'disarmed';
    } else if (queued) {
      r.holdQueue = r.holdQueue!.filter((l) => !near(l));
      did = 'disarmed';
    } else {
      if (this.positionOf(r) >= g.end - 0.05) { this.log(`loop ${this.regionText(g)} on ${c.name}: behind the track, not armed`); return null; }
      this.armHold(r, g);
      // the new one comes first: whatever region was set for the one after it is taken off (rebased, as release does)
      const same = (a: Span | null | undefined, b: Span | null | undefined) => !!a && !!b && Math.abs(a.start - b.start) < 0.02 && Math.abs(a.end - b.end) < 0.02;
      if (r.region && !same(r.region, r.loopTo)) {
        const p = this.positionOf(r);
        r.region = null; r.from = p; r.startedAt = r.pausedAt != null ? r.pausedAt : this.clock.now();
        this.audio.setRegion && this.audio.setRegion(id, null, null);
      }
      if (r.tail) { this.clock.clearTimeout(r.tail); r.tail = null; }
      this.armVamp(id);
      did = 'armed';
    }
    this.log(`LOOP ${c.name} ${this.regionText(g)}: ${did}`);
    this.changed();
    return did;
  }

  /** The sounds that go round with a track when it is held: running Audio cues of the same group, the same
   *  length as it (a click cut to its track), started with it. */
  withTrack(id: string): string[] {
    const parent = this.byId.get(this.parentOf.get(id));
    const r = this.running.get(id);
    if (!parent || !r) return [];
    const len = this.durations.get(r.file) || 0;
    return (parent.children || []).filter((c) => {
      const o = c.id !== id && c.type === 'audio' && this.running.get(c.id);
      return o && len > 0 && Math.abs((this.durations.get(o.file) || 0) - len) < 0.5 && Math.abs(this.positionOf(o) - this.positionOf(r)) < 0.25;
    }).map((c) => c.id);
  }

  /** The operator's one key for a vamp (and what a Devamp cue does to a track with sections): the section a
   *  track is going round is let go; with none held, the next section ahead of it is armed.
   *  `only`: 'let go' never arms. Returns what it did, or null when there was nothing to do. */
  holdOrLetGo(id: string, only: 'let go' | null = null) {
    const r = this.running.get(id);
    if (!r) return null;
    if (r.region && this.holdingIn(r)) return this.toggleHold(id, { start: r.region.start, end: r.region.end }, true);
    if (r.loopTo) return only === 'let go' ? this.toggleHold(id, { start: r.loopTo.start, end: r.loopTo.end }, true) : null;
    if (only === 'let go') return null;
    const p = this.positionOf(r);
    const next = [...this.holdsOf(id), ...((this.byId.get(id) || {}).loops || [])].filter((h) => h.end > p + 0.05).sort((a, b) => a.start - b.start)[0];
    return next ? this.toggleHold(id, { start: next.start, end: next.end }) : null;
  }

  /** Let go of a held section: the track plays on from wherever it is. */
  release(id: string) {
    const r = this.running.get(id);
    if (!r) return;
    if (r.region) {
      const p = this.positionOf(r);
      const now = this.clock.now();
      r.region = null;
      r.from = p;
      r.startedAt = r.pausedAt != null ? r.pausedAt : now;
      this.audio.setRegion && this.audio.setRegion(id, null, null);
    }
    this.armVamp(id);
    this.scheduleTail(id);
  }

  /** From the audio backend: whether it is playing `key` exactly (decoded) or streaming. */
  setExact(key: string, exact: unknown) {
    const r = this.running.get(key);
    if (!r) return;
    r.exact = !!exact;
    if (this.held && r.exact && !r.region && this.holdTarget() === key) this.engage(key);
    this.armVamp(key);
    this.changed();
  }

  /** A sound played at another speed with its pitch kept is a stream (only a stream can be stretched): it cannot be
   *  held in a section or moved inside itself, which are timed to the sample on a decoded sound. Said in the log,
   *  once asked. A sound re-pitched by its rate is decoded like any other and can be. */
  warped(r: Running, c: EngineCue, what: string) {
    if (!r.stretched || this.rateOf(r) === 1) return false;
    this.log(`${c.name || c.id} is playing at ×${this.rateOf(r).toFixed(3)} with its pitch kept: it cannot be ${what}`);
    return true;
  }

  /** Whether a sound is played from a decoded buffer, so it can loop to the sample: it loops, it has loop
   *  regions, or a sound beside it in its group has (a click goes round with its track: withTrack). */
  loopsExactly(c: EngineCue) {
    const own = (x: EngineCue) => !!((x.loops && x.loops.length) || x.loop || Number(x.plays) > 1);
    if (c.picture) return false;            // a video is never decoded whole: its picture could not follow a loop to the sample
    if (own(c) || this.autoLoads(c)) return true;
    const parent = this.byId.get(this.parentOf.get(c.id));
    return !!parent && (parent.children || []).some((k) => k.type === 'audio' && k.loops && k.loops.length);
  }

  /** Files worth decoding ahead for exact looping: what is playing, and what the next GO plays. */
  wantedFiles() {
    const out = new Set<string | undefined>();
    // a track with loop sections, and any sound that loops: decoded, a buffer loops with no gap
    const add = (c: EngineCue | undefined) => { if (c && c.type === 'audio' && this.loopsExactly(c)) out.add(c.file); };
    for (const [id] of this.running) {
      const c = this.byId.get(id);
      add(c);
    }
    // (the cue standing by in every list, and what is in it: a list that is not on screen is GOne too)
    const deep = (c: EngineCue | undefined) => { if (!c) return; add(c); for (const k of c.children || []) deep(k); };
    for (const id of this.heads.values()) deep(this.byId.get(id));
    return [...out];
  }

  /** `cutAt`: the sound stops dead at this place in its file, by itself. The audio backend lands it
   *  to the sample, so it is told a moment ahead. A skip past it plays on (rehearsal pick-ups). */
  scheduleCut(id: string, r: Running, cut: number) {
    if (r.pausedAt != null || r.noCut) return;
    const p = this.positionOf(r);
    if (p >= cut - 0.01) return;
    r.tail = this.clock.setTimeout(() => {
      if (this.running.get(id) !== r) return;
      if (r.region) { r.tail = null; return; }               // held in a section: letting go looks again
      const q = this.positionOf(r);
      r.cutSent = true;
      this.audio.cut && this.audio.cut(id, cut);
      r.tail = this.clock.setTimeout(() => {
        r.tail = null;
        if (this.running.get(id) !== r) return;
        if (!this.holdEnd(id, r)) this.stopAudio(id);
        this.changed();
      }, ((cut - q) / this.rateOf(r) + 0.03) * 1000);
    }, Math.max(0, (cut - p) / this.rateOf(r) - CUT_LEAD) * 1000);
  }

  /** How a sound ends by itself: at its `cutAt`, or, with `fadeOut`, fading to silence over its last
   *  fadeOut seconds rather than stopping dead. Rescheduled on resume and skip. */
  scheduleTail(id: string) {
    const r = this.running.get(id);
    const cue = this.byId.get(id);
    if (!r) return;
    this.scheduleCount(id);
    if (r.tail) { this.clock.clearTimeout(r.tail); r.tail = null; }
    if (r.still) { this.scheduleStill(id); return; }
    if (!cue) return;                                         // (gone from the list: nothing more of its own to schedule)
    const cut = cue && Number(cue.cutAt);
    const secs = cue && Number(cue.fadeOut);
    // a video that loops Start–End cannot do it to the sample (it is not decoded): it is skipped back at its End
    if (cue && cue.picture && cue.loop && cut > 0) {
      if (r.pausedAt != null || r.ended != null) return;
      r.tail = this.clock.setTimeout(() => {
        r.tail = null;
        if (this.running.get(id) === r) this.seek(id, Number(cue.from) || 0);
      }, Math.max(0.05, (cut - this.positionOf(r)) / this.rateOf(r)) * 1000);      // (seconds of its file, at the rate it plays)
      return;
    }
    // an end time (`cutAt`): it stops there, to the sample. With a fade out too, the fade lands there instead.
    const ends = cut > 0 && !cue.loop;
    if (ends && !(secs > 0)) { this.scheduleCut(id, r, cut); return; }
    const dur = ends ? cut : this.durations.get(r.file) || 0;
    if (!(secs > 0) || r.pausedAt != null) return;
    if (r.region) return;                                     // going round a section: letting go looks again
    // A loop never reaches its end: it fades only at its fadeAt, counted in time played
    // (e.g. a siren heard for 30 s, then gone).
    if (r.loop && !(Number(cue.fadeAt) > 0)) return;
    const k = this.rateOf(r);                                 // (the fade's own length is seconds of the clock; places in the file are not)
    const at = r.loop ? this.clock.now() - r.startedAt : this.straight(r);   // seconds in
    // fadeAt: the fade starts that far in (and the sound stops when it lands);
    // otherwise it starts so as to land on the file's last sample.
    const early = Number(cue.fadeAt) > 0 && (r.loop || !(dur > 0) || cue.fadeAt! + secs * k < dur);
    if (!early && !(dur > 0)) return;
    const begin = early ? Number(cue.fadeAt) : dur - secs * k;
    const startIn = Math.max(0, begin - at) / (r.loop ? 1 : k);
    const length = early ? secs : Math.min(secs, Math.max(0.05, (dur - at) / k));
    r.tail = this.clock.setTimeout(() => {
      const cur = this.running.get(id);
      if (cur !== r) return;
      r.tail = null;
      if (r.region) return;
      this.fadeAudio(id, SILENT_DB, length, early || ends, `tail:${id}`, cue.fadeOutShape);
      this.changed();
    }, startIn * 1000);
  }

  /** Skip a playing (or paused) audio cue to `t` seconds. Its group's markers
   *  follow it: ones now behind are dropped, the rest count from the new place. */
  seek(id: string, t: number) {
    const r = this.running.get(id);
    const cue = this.byId.get(id);
    if (!r || !cue || r.still || r.ended != null) return;
    const dur = this.durations.get(r.file) || 0;
    t = Math.max(0, dur > 0 ? Math.min(t, dur - 0.05) : t);
    const now = this.clock.now();
    if (r.region && (t < r.region.start || t >= r.region.end)) {   // skipped out of the held section
      r.region = null;
      this.audio.setRegion && this.audio.setRegion(id, null, null);
    }
    if (r.loopTo && t >= r.loopTo.end) {   // skipped past a music cue's loop (before it, it still loops when it gets there): the next armed
      r.from = t; r.startedAt = now;
      this.nextHold(r);
    }
    r.from = t;
    r.startedAt = now;
    if (r.pausedAt != null) r.pausedAt = now;
    this.audio.seek && this.audio.seek(id, t);
    if (r.pic) this.stage('seek', id, t);
    if (r.cutSent) { r.cutSent = false; this.audio.fade(id, r.db, 0.01); }    // skipped back from a cut already on its way
    this.armVamp(id);
    // back from a tail fade: the level it had, then a new tail from here
    if (r.tail === null && this.fades.has(`tail:${id}`)) {
      this.clock.clearTimeout(this.fades.get(`tail:${id}`)!.timer); this.fades.delete(`tail:${id}`);
      r.fade = null; this.audio.fade(id, r.db, 0.05);
    }
    this.scheduleTail(id);
    const parent = this.parentOf.get(id);
    for (const m of (parent ? this.byId.get(parent)!.children : []) || []) {
      // timed children follow the track: its markers
      if (m.type !== 'memo') continue;
      this.cancelWait(m.id);
      const at = Number(m.preWait) || 0;
      if (at > t) this.startWait(m, at, t, r.pausedAt != null);
    }
    this.log(`SKIP ${cue.name} to ${t.toFixed(1)} s`);
    this.changed();
  }

  /** Fade to: the track crossfades inside itself to `t` over `secs`, as a Jump with a 'fade' blend does, where a
   *  skip jumps. It needs the track decoded (an exact voice); a streamed one can only jump, with a short dip.
   *  Paused, it only skips. Timed siblings (markers) follow, as after a skip. */
  fadeTo(id: string, t: number, secs = 1.5) {
    const r = this.running.get(id);
    const cue = this.byId.get(id);
    if (!r || !cue) return;
    if (r.pausedAt != null || (r.stretched && this.rateOf(r) !== 1)) { this.seek(id, t); return; }      // (a stretched sound is a stream: it can only skip)
    const dur = this.durations.get(r.file) || 0;
    t = Math.max(0, dur > 0 ? Math.min(t, dur - 0.05) : t);
    secs = Math.max(0.05, Number(secs) || 1.5);
    this.moveTrack({ id: `fadeto:${id}`, target: id, to: t },
      { at: this.positionOf(r) + NOW_LEAD + secs / 2, xf: secs, blend: 'fade', lead: NOW_LEAD, beatLead: 0, secs });
    const parent = this.parentOf.get(id);
    for (const m of (parent ? this.byId.get(parent)!.children : []) || []) {
      if (m.type !== 'memo') continue;
      this.cancelWait(m.id);
      const at = Number(m.preWait) || 0;
      if (at > t) this.startWait(m, at, t, false);
    }
    this.log(`FADE TO ${cue.name} ${t.toFixed(1)} s over ${secs} s${r.exact ? '' : ' (not decoded: a jump)'}`);
    this.changed();
  }

  /** Skip (or, with `secs`, crossfade) a playing track to `t` on its OWN next bar line (`grid` 'beats': its next
   *  beat), so the music stays in time: the waveform's markers "on the bar". The track plays on until the line,
   *  and the move is handed to the audio backend a moment before it, as a Jump on the bar is. With no grid on the
   *  track (no tempo), paused, or past its last line, it goes now, as Skip and Fade to do.
   *  Returns { wait } (seconds until it lands; 0: it went now), or null when the track is not playing. */
  moveOnGrid(id: string, t: number, { grid = 'downbeats', secs = 0 }: { grid?: 'beats' | 'downbeats'; secs?: number } = {}) {
    const r = this.running.get(id);
    const cue = this.byId.get(id);
    if (!r || !cue) return null;
    const now = () => { if (secs > 0) this.fadeTo(id, t, secs); else this.seek(id, t); return { wait: 0 }; };
    const lines = Array.isArray(cue[grid]) ? cue[grid] : [];
    const rate = this.rateOf(r);
    if (!lines.length || r.pausedAt != null || r.still || r.ended != null || (r.stretched && rate !== 1)) return now();
    const xf = secs > 0 ? Math.max(0.05, Number(secs)) : 0.03;
    const p = this.positionOf(r), need = (xf / 2 + SYNC_LEAD) * rate;
    // going round a held section, only its own lines come round (again and again)
    const g = r.region && this.holdingIn(r) ? r.region : null;
    let d = null, ahead = 0;
    if (g) {
      const inside = lines.filter((x) => x >= g.start - 1e-6 && x < g.end - 1e-6), len = g.end - g.start;
      d = inside.find((x) => x > p + need);
      if (d != null) ahead = d - p;
      else if (inside.length) { d = inside.find((x) => x + len > p + need); if (d != null) ahead = d + len - p; }
    } else {
      d = lines.find((x) => x > p + need);
      if (d != null) ahead = d - p;
    }
    if (d == null) return now();
    const dur = this.durations.get(r.file) || 0;
    t = Math.max(0, dur > 0 ? Math.min(t, dur - 0.05) : t);
    if (this.gridMoves.has(id)) this.clock.clearTimeout(this.gridMoves.get(id));      // asked again before it went: the last one asked for
    const wait = ahead / rate;
    this.gridMoves.set(id, this.clock.setTimeout(() => {
      this.gridMoves.delete(id);
      if (this.running.get(id) !== r || r.pausedAt != null) return;                  // stopped or paused while it waited: nothing moves
      const left = (g ? (((d - this.positionOf(r)) % (g.end - g.start)) + (g.end - g.start)) % (g.end - g.start) : d - this.positionOf(r)) / this.rateOf(r);
      this.moveTrack({ id: `ongrid:${id}`, target: id, to: t },
        { at: d, xf, blend: secs > 0 ? 'fade' : 'cut', lead: Math.max(0, left - xf / 2), beatLead: 0, secs: secs > 0 ? xf : 0 });
      const parent = this.parentOf.get(id);
      for (const m of (parent ? this.byId.get(parent)!.children : []) || []) {      // timed siblings (markers) follow, as after a skip
        if (m.type !== 'memo') continue;
        this.cancelWait(m.id);
        const at = Number(m.preWait) || 0;
        if (at > t) this.startWait(m, at, t, false);
      }
      this.changed();
    }, Math.max(0, wait - xf / 2 - SYNC_LEAD) * 1000));
    this.log(`${secs > 0 ? 'FADE TO' : 'SKIP'} ${cue.name} to ${t.toFixed(1)} s on the ${grid === 'beats' ? 'beat' : 'bar'} (in ${wait.toFixed(2)} s)`);
    this.changed();
    return { wait, at: d };
  }

  /** A pre-wait of `total` s that has already run `elapsed` s (seek, resume). */
  startWait(cue: EngineCue, total: number, elapsed = 0, paused = false) {
    const now = this.clock.now();
    const w: Wait = { timer: null, startedAt: now - elapsed, total, pausedAt: paused ? now : null };
    if (!paused) w.timer = this.clock.setTimeout(() => { this.waits.delete(cue.id); this.act(cue); this.changed(); }, Math.max(0, total - elapsed) * 1000);
    this.waits.set(cue.id, w);
  }

  // ── firing ────────────────────────────────────────────────────────────

  fire(id: string, offset = 0, preWaited = false): 'second' | undefined {
    const cue = this.byId.get(id);
    if (!cue) return;
    if (this.disarmed.has(id)) { this.log(`skipped (disarmed): ${cue.number || id} ${cue.name}`); return; }
    // fired again while it is still running: what its "second trigger" says, in place of starting it again
    if (!preWaited && cue.secondTrigger && cue.secondTrigger !== 'restart' && this.isLive(id)) { this.secondAction(cue); return 'second'; }
    this.played.add(id);
    if (this.loaded && this.loaded.id === id && !offset) offset = this.loaded.at;
    else if (this.loads.has(id) && !offset) offset = this.loads.get(id)!;         // loaded by a Load cue or a remote
    this.loads.delete(id);
    // a music move with a pre-wait of its own (music that comes in a few seconds into a spoken line): the pre-wait
    // first, then its crossfade planned from where the track is then (preWaitOf plans a move's wait from the beat)
    if (cue.blend && Number(cue.preWait) > 0 && !preWaited) {
      const pw = Math.max(0, Number(cue.preWait) - offset);
      this.cancelWait(id);
      const timer = this.clock.setTimeout(() => { this.waits.delete(id); this.fire(id, 0, true); this.changed(); }, pw * 1000);
      this.waits.set(id, { timer, startedAt: this.clock.now(), total: pw });
      return;
    }
    let wait = this.preWaitOf(cue);
    let into = offset;
    if (offset > 0 && !cue.blend && !cue.onBeat) {
      // Loaded to a time: the time counts through the pre-wait. A child whose moment has passed is
      // skipped (a marker already behind us); a cue still in its pre-wait waits what is left of it;
      // one past it starts that much less far in.
      if (cue.type === 'memo' && wait <= offset && this.parentOf.get(id) !== null) return;
      into = Math.max(0, offset - wait);
      wait = Math.max(0, wait - offset);
    }
    if (wait > 0) {
      this.cancelWait(id);
      const startedAt = this.clock.now();
      const timer = this.clock.setTimeout(() => { this.waits.delete(id); this.act(cue); this.changed(); }, wait * 1000);
      this.waits.set(id, { timer, startedAt, total: wait });
    } else {
      this.act(cue, into);
    }
  }

  /** Seconds to the next downbeat (`grid` 'beats': the next beat), at least `atLeast` s away, of the
   *  newest running audio cue that has that grid (from the track's beat analysis); null when nothing with
   *  a beat is playing. A loop's grid wraps; past a one-shot's last downbeat there is none. */
  toNextDownbeat(atLeast = BEAT_LEAD, grid: 'beats' | 'downbeats' = 'downbeats') {
    const w = this.nextOnGrid(atLeast, grid);
    // (in the file's seconds; a warped track reaches it sooner or later than that)
    return w ? w.secs / this.rateOf(w.r) : null;
  }
  nextOnGrid(atLeast: number, grid: 'beats' | 'downbeats') {
    let best: { r: Running; c: EngineCue } | null = null;
    for (const [id, r] of this.running) {
      const c = this.byId.get(id);
      if (!c || !Array.isArray(c[grid]) || !c[grid].length || r.pausedAt != null) continue;
      if (!best || r.startedAt > best.r.startedAt) best = { r, c };
    }
    if (!best) return null;
    const p = this.positionOf(best.r);
    atLeast *= this.rateOf(best.r);                           // (a track played faster reaches its next beat sooner)
    const g = best.r.region;
    if (g && p >= g.start) {                                  // looping a section: only its own beats come round
      const inside = best.c[grid]!.filter((d) => d >= g.start && d < g.end);
      if (!inside.length) return null;
      const next = inside.find((d) => d > p + atLeast);
      return { r: best.r, secs: next != null ? next - p : inside.find((d) => d + (g.end - g.start) > p + atLeast)! + (g.end - g.start) - p };
    }
    const dur = this.durations.get(best.r.file) || 0;         // (0 until it is measured: its grid still counts, once through)
    const laps = best.r.loop && dur > 0 ? 3 : 1;
    for (let k = 0; k < laps; k++) {
      const next = best.c[grid]!.find((d) => d + k * dur > p + atLeast);
      if (next != null) return { r: best.r, secs: next + k * dur - p };
    }
    return null;
  }

  /** An `onBeat` GO: when to fire it, and how far into its sound to start, so that the
   *  sound's own first downbeat lands on the next downbeat of the music playing. Its lead-in
   *  (the bit before its first downbeat) plays over the end of the bar going out. `onBeat: 'beat'`
   *  is the next beat, with the lead-in `beatLead`. */
  beatPlan(cue: EngineCue) {
    const audio = (cue.children || []).find((c) => c.type === 'audio');
    // a jump into the middle of a file lands its `from` on the beat, less `beatLead`; a part lands its first downbeat
    const lead = cue.onBeat === 'beat' || (audio && Number(audio.from) > 0) ? Number(cue.beatLead) || 0
      : audio && Array.isArray(audio.downbeats) && audio.downbeats.length ? audio.downbeats[0] : 0;
    const wait = this.toNextDownbeat(lead + BEAT_LEAD, cue.onBeat === 'beat' ? 'beats' : 'downbeats');
    if (wait == null) return { wait: 0, from: 0 };            // nothing with a beat playing: now
    return { wait: wait - lead, from: 0 };
  }

  /** A group's music cue: the move it makes in the scene's track. */
  musicOf(cue: EngineCue) { return (cue.children || []).find((c) => c.type === 'music') || null; }

  /** A music move (a group with `blend`): which moment of the track it leaves from (`at`, seconds into
   *  it: the middle of the crossfade), where it lands, how long the crossfade is, and how long to wait. */
  blendPlan(cue: EngineCue): BlendPlan | null {
    const m = this.musicOf(cue);
    const r0 = m && this.running.get(m.target);
    if (!m || !r0 || r0.pausedAt != null || (r0.fade && r0.fade.to <= SILENT_DB)) return null;   // not playing: the move starts it
    const out = { id: m.target!, r: r0, c: this.byId.get(m.target)! };
    const audio = { from: Number(m.to) || 0 };
    if (m.stop || m.stay) return null;                         // a stop, or a level only (`stay`): now
    const held = r0.region || r0.loopTo;
    if (held && Math.abs(audio.from - held.end) < 0.05) return null;   // to the end of the loop playing: it lets go, now
    if (m.letGo) return null;                                   // a let-go with nothing to let go of: plays on, now
    if (m.hold && m.loop && (this.positionOf(r0) < Number(m.end) - 0.05 || this.autoFiring)) return null;   // a hold before its end (or fired with a GO): now, no move
    const p = this.positionOf(out.r);
    const downs = Array.isArray(out.c.downbeats) ? out.c.downbeats : [];
    const beats = Array.isArray(out.c.beats) && out.c.beats.length ? out.c.beats : downs;
    // where it may land (`landings`, precomputed with the cue list: its own `to`, or a few bars either side), each with how
    // well every downbeat of the track leaves for it ([t, score, grid]). Scores made for another target
    // (a `to` edited since) are not used: it goes on the beat or bar instead.
    const lands = Array.isArray(cue.landings) && cue.landings.length && Math.abs(cue.landings[0].to - audio.from) < 0.05 ? cue.landings : [];
    const scores = lands.length ? lands[0].scores || [] : [];
    const scoreOf = (L: Landing, t: number) => { const s = (L.scores || []).find((x) => Math.abs(x[0] - t) < 0.05); return s ? s[1] : 0; };
    const gridAt = (t: number) => { const s = scores.filter((x) => x[0] <= t + 0.05).pop(); return s ? s[2] : 1; };
    const barAt = (t: number) => { const i = downs.findIndex((d) => d > t); return i > 0 ? downs[i] - downs[i - 1] : 2; };
    const blend = ['cut', 'fade', 'dj'].includes(cue.blend!) ? cue.blend! : 'fade';
    const xfFor = (t: number, L: Landing | undefined = lands[0]): Moment['xf'] => {
      if (Number(cue.blendSecs) > 0) return { xf: Number(cue.blendSecs), blend };
      if (blend === 'cut') return { xf: 0.03, blend };
      const ambient = scores.length && Math.min(gridAt(t), L && L.grid != null ? Number(L.grid) : 1) < LOW_GRID;
      if (ambient) return { xf: AMBIENT_FADE, blend: 'fade' };
      return { xf: blend === 'dj' ? barAt(t) : barAt(t) / 4, blend };
    };
    // seconds from now until the track is at `pos` (far enough ahead to set it up); a looping section comes round
    const g = out.r.region;
    const len = g ? g.end - g.start : 0;
    const timeTo = (pos: number, xf: number) => {
      const need = xf / 2 + SYNC_LEAD;
      let t = (g ? (((pos - p) % len) + len) % len : pos - p) / this.rateOf(out.r);
      while (g && t < need - 1e-6) t += len / this.rateOf(out.r);
      return t >= need - 1e-6 ? t : null;
    };
    let pick: Moment | null = null;
    let xf = xfFor(p);
    if (!out.r.loop && cue.onBeat) {
      const grid = (cue.onBeat === 'beat' ? beats : downs).filter((d) => !g || (d >= g.start && d < g.end));
      const ahead = grid.map((d) => ({ d, xf: xfFor(d), t: timeTo(d, xfFor(d).xf) })).filter((x): x is Moment => x.t != null).sort((a, b) => a.t - b.t);
      if (cue.onBeat === 'best' && lands.length) {
        // every pair of (one of the next downbeats, a landing): a landing other than `from` itself has to
        // be a little better to be taken. The earliest pair that is good enough goes, else the best.
        const own = Number(audio.from) || 0;
        const pairs: (Moment & { to: number; s: number })[] = [];
        for (const x of ahead.slice(0, BLEND_WITHIN).filter((y, i) => i === 0 || y.t <= BLEND_MAX_WAIT)) {
          for (const L of lands) {
            const s = scoreOf(L, x.d) - (Math.abs(L.to - own) > 0.05 ? 0.02 : 0);
            pairs.push({ ...x, xf: xfFor(x.d, L), to: L.to, s });
          }
        }
        const top = Math.max(0, ...pairs.map((x) => x.s));
        const ok = pairs.filter((x) => x.s >= Math.min(GOOD_JUMP, top - 0.05));
        const first = ok.length ? Math.min(...ok.map((x) => x.t)) : null;
        pick = ok.filter((x) => x.t === first).sort((a, b) => b.s - a.s)[0] || null;
      } else pick = ahead[0] || null;
    }
    // now (or no grid): as soon as it can
    if (!pick) pick = { d: g ? g.start + ((p + NOW_LEAD + xf.xf / 2 - g.start) % len) : p + NOW_LEAD + xf.xf / 2, xf, t: NOW_LEAD + xf.xf / 2, now: true };
    return { out: out.id, at: pick.d, to: pick.to ?? null, score: pick.s ?? null, xf: pick.xf.xf, blend: pick.xf.blend,
             centreIn: pick.t, madeAt: this.clock.now(), wait: Math.max(0, pick.t - pick.xf.xf / 2 - (pick.now ? NOW_LEAD : SYNC_LEAD)) };
  }

  preWaitOf(cue: EngineCue): number {
    if (cue.blend) {
      const plan = this.blendPlan(cue);
      if (plan) {
        // a second jump GOne before the first has gone: the last word wins, as with fades
        for (const [k, q] of [...this.plans]) if (k !== cue.id && q.out === plan.out && this.waits.has(k)) { this.cancelWait(k); this.plans.delete(k); }
        this.plans.set(cue.id, plan);
      } else this.plans.delete(cue.id);
      return plan ? plan.wait : 0;
    }
    // On the beat: a part GO waits so its first downbeat lands on the next one of the part playing
    if (cue.onBeat) return this.beatPlan(cue).wait;
    return Number(cue.preWait) > 0 ? Number(cue.preWait) : 0;
  }

  /** QLab's "fade and stop others": everything else sounding fades out over the cue's `fadeOthers` and stops, and
   *  anything else still waiting to happen (a duck's return) is dropped. What is inside the cue, and the sound
   *  a Fade cue is itself moving, are not "others". `fadeOthersScope` keeps it to the cue's own list, or to its
   *  peers (the cues beside it in its group; at the top level, its list). */
  fadeOutOthers(cue: EngineCue) {
    const mine = (id: string) => id === cue.id || this.isInside(id, cue.id) || (cue.target && this.within(id, cue.target));
    const others = this.othersOf(cue);          // how far "others" reaches: everything, the cue's list, or its peers
    for (const id of [...this.running.keys()]) if (!mine(id) && others(id)) this.fadeAudio(id, SILENT_DB, cue.fadeOthers!, true, `others:${id}`);
    for (const id of [...this.waits.keys()]) if (!mine(id) && others(id) && this.topOf(id) !== this.topOf(cue.id)) this.cancelWait(id);
    for (const id of [...this.following.keys()]) if (id !== cue.id && id !== this.topOf(cue.id) && others(id)) this.following.delete(id);   // faded out: not finished
    for (const id of [...this.playlists.keys()]) if (!mine(id) && others(id)) this.endPlaylist(id);
  }

  act(cue: EngineCue, offset = 0) {
    if (cue.type !== 'group' && Number(cue.fadeOthers) > 0) this.fadeOutOthers(cue);
    switch (cue.type) {
      case 'group': {
        if (cue.blend) this.blending = this.takePlan(cue);
        else if (Number(cue.fadeOthers) > 0) this.fadeOutOthers(cue);
        // "start first": only its first child, and what continues from it; "start random": one child, any one
        if (cue.mode === 'enter' || cue.mode === 'first' || cue.mode === 'random') {
          const armed = (cue.children || []).filter((c) => !this.disarmed.has(c.id));     // (one at random: each once before any comes again)
          const c = cue.mode === 'random' ? this.deal(cue, armed) : (cue.children || [])[0];
          if (c) { this.fire(c.id, offset); if (cue.mode !== 'random') this.continueAfter(c.id, false); }
          this.blending = null;
          break;
        }
        // a playlist: one child, and the next when it has finished
        if (cue.mode === 'playlist') { this.startPlaylist(cue); this.blending = null; break; }
        for (const child of cue.children || []) this.fire(child.id, offset);
        this.blending = null;
        break;
      }
      case 'audio': {
        if (this.missing.has(cue.file)) { this.log(`MISSING FILE ${cue.file} (${cue.id})`); break; }
        if (this.running.has(cue.id)) this.stopAudio(cue.id);
        // loaded to a time (a Load cue, or Load to Time on this cue's own GO), else its own start
        const from = this.loadAt.get(cue.id) || (offset > 0 ? (Number(cue.from) || 0) + offset : 0) || Number(cue.from) || 0;    // `from`: starts this far into its file
        this.loadAt.delete(cue.id);
        const db = this.lim(Number(cue.gainDb) || 0);
        const whole = !!cue.loop && !(Number(cue.cutAt) > 0);            // with an end, it loops from its start to its end (armVamp)
        // How fast it plays: its own `rate`, times the desk's tempo over its own when it is warped (the Live view).
        // Keeping its pitch (the cue's `preservePitch`, or a 'keep' warp) is the stretcher of a streamed sound, which a
        // decoded one does not have: such a sound is never decoded, so it has no sample-exact loops.
        const warp = this.warpHook(cue, from);
        const warpRate = warp && warp.rate > 0 ? warp.rate : 1;
        const rate = clampRate(clampRate(cue.rate) * warpRate);
        const keepPitch = rate !== 1 && ((!!cue.preservePitch && clampRate(cue.rate) !== 1) || (!!(warp && warp.keepPitch) && warpRate !== 1));
        const exact = this.loopsExactly(cue) && !keepPitch;
        // `fadeIn`: from silence up to its level (a scene's mix as its GO starts it); the level itself stays db
        const over = this.takeOver(cue);                                  // (a bus that plays one sound at a time: sound-kinds.js)
        const fadeIn = Number(cue.fadeIn) || this.fadeInOnce || over || 0;       // (fadeInOnce: a playlist crossfading into it)
        this.running.set(cue.id, { startedAt: this.clock.now(), from, file: cue.file, db: fadeIn > 0 ? SILENT_DB : db, fade: null, loop: whole, ...(rate !== 1 ? { rate } : {}), ...(warpRate !== 1 ? { warp: warpRate } : {}), ...(keepPitch ? { stretched: true } : {}) });
        this.audio.play(cue.id, { file: cue.file, gainDb: fadeIn > 0 ? SILENT_DB : db, from, loop: whole, exact, bus: busOf(cue),
                                  ...(rate !== 1 ? { rate, preservePitch: keepPitch } : {}),
                                  ...(Array.isArray(cue.envelope) && cue.envelope.length ? { envelope: cue.envelope } : {}),
                                  // (its pan, and its other lines: core/audio/lanes.js; read at a place in the file, as the envelope is)
                                  ...(Number(cue.pan) ? { pan: Number(cue.pan) } : {}), ...(cue.automation ? { automation: cue.automation } : {}) });
        if (cue.picture) this.showPicture(cue, from, fadeIn);         // a video: its picture, in step with its sound
        if (fadeIn > 0) this.fadeAudio(cue.id, db, fadeIn, false, `level:${cue.id}`, cue.fadeInShape);
        this.scheduleTail(cue.id);
        if (!cue.picture) this.armCounted(cue.id);
        if (this.ducks.size) this.applyDucks(0);                 // started under a cue that ducks the others: it is one of them
        break;
      }
      case 'mic': {
        // a live input, open on its bus until it is stopped or faded out: a sound with no file and no end
        if (this.running.has(cue.id)) this.stopAudio(cue.id);
        const db = this.lim(Number(cue.gainDb) || 0), fadeIn = Number(cue.fadeIn) || 0;
        this.running.set(cue.id, { startedAt: this.clock.now(), from: 0, file: `mic:${cue.id}`, db: fadeIn > 0 ? SILENT_DB : db, fade: null, loop: true, live: true });
        this.audio.play(cue.id, { mic: { input: cue.input || '', channel: Math.max(1, Math.round(Number(cue.channel) || 1)) }, gainDb: fadeIn > 0 ? SILENT_DB : db, bus: busOf(cue), ...(Number(cue.pan) ? { pan: Number(cue.pan) } : {}) });
        if (fadeIn > 0) this.fadeAudio(cue.id, db, fadeIn, false, `level:${cue.id}`);
        if (this.ducks.size) this.applyDucks(0);
        break;
      }
      case 'picture': {
        // a still image, a title or a camera on the stage: like a Mic cue, it has no end of its own; it runs
        // until it is stopped or faded out, or for its `duration`
        if (cue.file && this.missing.has(cue.file)) { this.log(`MISSING FILE ${cue.file} (${cue.id})`); break; }
        if (this.running.has(cue.id)) this.stopAudio(cue.id);
        this.running.set(cue.id, { startedAt: this.clock.now(), from: Math.max(0, offset), file: `picture:${cue.id}`, db: 0, fade: null, loop: false, live: true, still: true });
        this.showPicture(cue, 0, Number(cue.fadeIn) || 0);
        this.scheduleStill(cue.id);
        break;
      }
      case 'music':
        this.moveTrack(cue, this.blending);
        break;
      case 'fade': {
        // The last word wins: a fade on a sound replaces any other cue's fade still waiting on it
        // (a duck's return), so ducks fired close together keep the music down with no Stop cues.
        const top = this.topOf(cue.id);
        for (const [k] of [...this.waits]) {
          const w = this.byId.get(k);
          if (w && w.type === 'fade' && w.target === cue.target && this.topOf(k) !== top) this.cancelWait(k);
        }
        // Its shape: one for a level on its way up, one for a level on its way down (a crossfade made of two Fade
        // cues wants them different). `rate`: the sound's rate moves too, over the same time; `keepLevel`: only that.
        const dur = Number(cue.duration) || 0;
        const toRate = Number(cue.rate) > 0 ? clampRate(cue.rate) : null;
        const levelOf = (k: string) => { const x = this.running.get(k); return x ? (x.fade ? x.fade.to : x.db) : SILENT_DB; };
        const shapeTo = (k: string, db: number) => (this.lim(db) >= levelOf(k) ? cue.shapeUp : cue.shapeDown);
        // (aimed at a cue list: every sound playing in the list, whichever cue started it)
        const whole = this.listAt(cue.target);
        const many = !!whole || (this.byId.get(cue.target) || {}).type === 'group';
        const targets = many ? [...this.running.keys()].filter((k) => this.within(k, cue.target)) : this.running.has(cue.target) ? [cue.target!] : [];
        // how each was, for "revert fade"
        if (targets.length) this.reverts.set(cue.id, targets.map((k) => ({ id: k, db: levelOf(k), band: this.running.get(k)!.band || 0, rate: this.rateOf(this.running.get(k)) })));
        this.sweepDesign(cue, targets, dur);                    // its `chainTo`: settings of the sounds' design move too (sound-kinds.js)
        const move = (k: string, db: number, fadeId: string) => {
          // (a picture is not re-timed: a video's sound keeps the speed its picture has)
          const rated = toRate && !this.running.get(k)!.pic;
          if (rated) this.fadeRate(k, toRate, dur, `rate:${fadeId}`, !!cue.keepLevel && !!cue.stopTarget);
          if (cue.keepLevel && rated) return;
          // an absolute fade is the last word on the sound's level: a dip still held in its voice band (a relative
          // duck that never came back) is let go over the same time, so it lands exactly on the level asked for
          if (!cue.relative && this.running.get(k)!.band) this.fadeBand(k, 0, dur, `band:${fadeId}`);
          this.fadeAudio(k, db, dur, !!cue.stopTarget, fadeId, shapeTo(k, db));
        };
        // A Fade on a Group moves every sound playing under it together; with "stop target when done", what in
        // the group was still waiting to start (a pre-wait counting down) is called off now, so it cannot start later.
        if (many) {
          const under = targets;
          if (cue.stopTarget) {
            for (const c of whole ? whole.cues.filter((x) => x.id !== top) : [{ id: this.topOf(cue.target!) }]) this.following.delete(c.id);
            for (const id of [...this.playlists.keys()]) if (this.within(id, cue.target)) this.endPlaylist(id);
            const quiet = (c: { id: string; children?: EngineCue[] }) => { if (!this.running.has(c.id)) this.cancelWait(c.id); for (const k of c.children || []) quiet(k); };
            for (const c of whole ? whole.cues.filter((x) => x.id !== top) : [this.byId.get(cue.target)!]) quiet(c);
          }
          this.moved.set(cue.id, new Set(under));
          under.forEach((k, i) => {
            const own = cue.relative ? Number((this.byId.get(k) || {}).gainDb) || 0 : 0;
            move(k, own + Number(cue.db), i ? `${cue.id}:${k}` : cue.id);
          });
          break;
        }
        // A Fade aimed at a Light cue: what that cue set goes home (or back to its levels) over this Fade's time
        if ((this.byId.get(cue.target) || {}).type === 'light') { this.lightFade(cue, 'fade', this.byId.get(cue.target)!, Number(cue.duration) || 0); break; }
        if (!this.running.has(cue.target)) break;      // nothing to fade: QLab does nothing too
        this.moved.set(cue.id, new Set([cue.target!]));
        // A duck's fades are `relative`: dB from the sound's own level (its cue's gainDb, the
        // operator's trim included), so a track trimmed to -8 dips from -8 and comes back to -8, not
        // to the level the cue list was built with (an absolute return would undo the trim at every duck).
        const base = cue.relative ? Number((this.byId.get(cue.target) || {}).gainDb) || 0 : 0;
        // In the voice range (a duck that carves room for words) the dip is in the speech
        // band and the sound's level stays where it is.
        if (cue.range === 'voice' && !cue.stopTarget && !(cue.keepLevel && toRate)) {
          const r = this.running.get(cue.target)!;
          const dip = cue.relative ? Number(cue.db) : Number(cue.db) - (r.fade ? r.fade.to : r.db);
          this.fadeBand(cue.target!, Math.min(0, dip), Number(cue.duration) || 0, cue.id);
          if (toRate && !r.pic) this.fadeRate(cue.target!, toRate, dur, `rate:${cue.id}`);
          break;
        }
        // Aimed at a picture, a Fade moves what it names of its opacity, place, scale and rotation over the same
        // time. One that names no level (`db` absent) leaves the sound where it is, and still runs its time.
        const tr = this.running.get(cue.target)!;
        move(cue.target!, cue.db === undefined || cue.db === null || tr.still ? levelOf(cue.target!) : base + Number(cue.db), cue.id);
        if (tr.pic && this.running.get(cue.target) === tr) {
          const moves = movesOf(cue);
          if (Object.keys(moves).length) this.movePicture(cue.target!, moves, dur);
        }
        break;
      }
      case 'stop': {
        // aimed at a cue list: everything in the list stops
        const whole = this.listAt(cue.target);
        if (whole) { for (const c of whole.cues) { if (c.id !== this.topOf(cue.id)) this.following.delete(c.id); this.stopTree(c.id, true); } break; }
        // stopped, not finished: what was to follow it does not (unless this Stop is part of that same cue)
        if (this.topOf(cue.target!) !== this.topOf(cue.id)) this.following.delete(this.topOf(cue.target!));
        this.stopTree(cue.target!, true);
        break;
      }
      case 'release': {
        // A looping sound plays out its current pass and ends (e.g. a build-up loop's last pass, into what it builds to).
        // What in this GO waits for it (`after` the target) fires when it ends.
        const r = this.running.get(cue.target);
        if (!r) break;
        // `startNext`: the cue after the Devamp starts when the pass the sound is in ends (QLab's "start next cue
        // when the loop ends"), so what comes out of a vamp lands on the bar
        const next = cue.startNext ? this.nextOf(cue.id) : null;
        // a track going round a section (or about to): the Devamp lets it go, and it plays on after this pass
        const g = r.region || r.loopTo;
        if (g) {
          const left = (g.end - this.positionOf(r)) / this.rateOf(r);   // (measured before it is let go: this pass ends at the section's end, sooner or later by the sound's rate)
          this.holdOrLetGo(cue.target!, 'let go');
          if (next && left > 0 && r.pausedAt == null) { this.passHead(next.id); this.chain(next, left, 'the loop ends:'); }
          break;
        }
        this.devamp(cue.target!);
        if (next) { this.passHead(next.id); this.releaseThen.set(cue.target!, [next.id]); }
        break;
      }
      case 'start':
        // QLab: starting a paused cue resumes it
        if (cue.target && this.isPaused(cue.target)) this.resume(cue.target);
        else {
          // its sequence runs too. (Sequences that start each other with no wait between would never end: stopped.)
          this.startDepth = (this.startDepth || 0) + 1;
          try {
            if (this.startDepth > 24) { this.log(`STOPPED a loop of Start cues at ${cue.number || cue.id}: put a wait in it`); break; }
            // aimed at a cue list, it is that list's GO: its own playhead fires and moves on, on screen or not
            const whole = this.listAt(cue.target);
            if (whole) { this.go(whole.name, true); break; }
            const did = this.fire(cue.target!);
            if (did !== 'second' && this.parentOf.get(cue.target) === null) this.continueAfter(cue.target!, false);
          } finally { this.startDepth--; }
        }
        break;
      case 'pause':
        if (cue.target && this.byId.has(cue.target)) this.pause(cue.target);
        break;
      case 'goto':
        // the playhead of the target's list goes to the target (its top-level cue): that list's next GO fires it
        if (cue.target && this.byId.has(cue.target)) {
          const top = this.topOf(cue.target), l = this.homes.get(top);
          if (l) { this.heads.set(l.name, this.stopFrom(top)); this.parked.delete(l.name); }
        }
        break;
      case 'arm':
      case 'disarm':
        if (cue.target && this.byId.has(cue.target)) {
          this.armTouched.add(cue.target);
          if (cue.type === 'arm') this.disarmed.delete(cue.target); else this.disarmed.add(cue.target);
        }
        break;
      case 'wait': {
        // nothing happens for `duration` s; it is live meanwhile, so an auto-follow waits for it
        const total = Number(cue.duration) || 0;
        if (total > 0) {
          const key = `hold:${cue.id}`;
          const prev = this.fades.get(key);
          if (prev) this.clock.clearTimeout(prev.timer);
          const done = () => { this.fades.delete(key); this.changed(); };
          this.fades.set(key, { timer: this.clock.setTimeout(done, total * 1000), startedAt: this.clock.now(), total, target: cue.id, done, wait: true });
        }
        break;
      }
      case 'light':
        // a cue that holds levels fades the app's own lights to them: a fade like any other (it shows in Active
        // Cues, pauses, stops where it has got to), whose clock the host reads to move the lights
        if (String(cue.levels || '').trim()) this.lightFade(cue, 'run', cue, Number(cue.duration) || 0);
        if (!cue.lightCue && String(cue.levels || '').trim()) break;      // only its levels: nothing to call or to fire on a desk
        // a lighting cue: the host fires it on the desk (when its module is on); the operator calls it either way
        if (!this.skipLights && !cue.follows) {
          try { this.lightsHook(cue); } catch (err) { this.log(`light cue ${cue.id}: ${(err as Error).message}`); }
        }
        break;
      case 'load':
        // its target's next fire starts `at` s into it, counted as Load to Time counts (through a pre-wait, into
        // a group); a negative time is that far back from its end
        if (cue.target && this.byId.has(cue.target)) this.setLoad(cue.target, Number(cue.at) || 0);
        break;
      case 'reset':
        if (cue.target && this.byId.has(cue.target)) this.resetCue(cue.target);
        break;
      case 'target':
        this.retarget(cue.target!, cue.to as string);
        break;
      case 'network': {
        // What it sends over its time is worked out in core/net/network-cue.js: one message, the same one again
        // and again for a duration, or a value (or a point on a path) that moves. Anything with a duration is a
        // fade like any other: it shows in Active Cues, pauses, and stops.
        const p = networkCue.plan(cue);
        const out = (t: string) => { try { this.send(t, cue); } catch (err) { this.log(`network cue ${cue.id}: ${(err as Error).message}`); } };
        const prev = this.fades.get(cue.id);
        if (prev) { this.clock.clearTimeout(prev.timer); this.fades.delete(cue.id); }
        if (!(p.total > 0)) { out(p.at(1)); break; }
        const f = { startedAt: this.clock.now(), total: p.total, target: cue.id, net: true, timer: null } as Fade;
        f.done = () => {
          if (this.fades.get(cue.id) !== f) return;
          const x = Math.min(1, (this.clock.now() - f.startedAt) / p.total);
          out(p.at(x));
          if (x >= 1) {
            if (!p.loop) { this.fades.delete(cue.id); this.changed(); return; }
            f.startedAt = this.clock.now();          // a path that loops goes round again, until the cue is stopped
          }
          f.timer = this.clock.setTimeout(f.done, 1000 / p.rate);
        };
        this.fades.set(cue.id, f);
        f.done();
        break;
      }
      case 'midi': {
        // a MIDI message (a note, a program change, show control): the host sends it
        const out = (c: EngineCue) => { try { this.midiHook(c); } catch (err) { this.log(`midi cue ${cue.id}: ${(err as Error).message}`); } };
        const prev = this.fades.get(cue.id);
        if (prev) this.clock.clearTimeout(prev.timer);
        let msg = null;
        try { msg = midiText.parseText(cue.midi); } catch { /* the host says why when it tries to send it */ }
        const total = Number(cue.duration) || 0;
        if (!msg || !midiText.valueMax(msg) || cue.fadeTo == null || cue.fadeTo === '' || !(total > 0)) { out(cue); break; }
        // A faded value (a controller, a pressure, a bend) runs from the one in the message to `fadeTo` over `duration`:
        // looked at NET_RATE times a second and sent whenever the whole number has moved. A fade like any other: it
        // shows in Active Cues, pauses, and stops.
        const a = midiText.valueOf(msg)!, b = Number(cue.fadeTo);
        const f = { startedAt: this.clock.now(), total, target: cue.id, net: true, timer: null, sent: null } as Fade;
        f.done = () => {
          if (this.fades.get(cue.id) !== f) return;
          const x = Math.min(1, (this.clock.now() - f.startedAt) / total);
          const now = midiText.withValue(msg, a + (b - a) * x);
          if (now.value !== f.sent) { f.sent = now.value; out({ ...cue, midi: midiText.toText(now), duration: 0 }); }
          if (x >= 1) { this.fades.delete(cue.id); this.changed(); return; }
          f.timer = this.clock.setTimeout(f.done, 1000 / NET_RATE);
        };
        this.fades.set(cue.id, f);
        f.done();
        break;
      }
      case 'timecode':
      case 'midifile': {
        // A cue the host plays out against this engine's clock (running timecode, a MIDI file). The host is told
        // to start it, `offset` s in, and answers with how long it runs (0: until it is stopped). Here it is live
        // for that long, filed with the fades: it shows in Active Cues, pauses, resumes and stops as they do, an
        // auto-follow waits for it, and the host reads this entry to know where it is and whether it is held.
        const prev = this.fades.get(cue.id);
        if (prev) this.clock.clearTimeout(prev.timer);
        this.fades.delete(cue.id);
        let total = 0;
        try { total = Number(this.runHook(cue, offset)) || 0; } catch (err) { this.log(`${cue.type} cue ${cue.id}: ${(err as Error).message}`); break; }
        if (total > 0 && offset >= total) break;
        const f = { startedAt: this.clock.now() - offset, total, target: cue.id, run: cue.type, timer: null } as Fade;
        f.done = () => {
          if (this.fades.get(cue.id) !== f || f.pausedAt != null || !(f.total > 0)) return;
          const left = f.total - (this.clock.now() - f.startedAt);
          if (left <= 0.0005) { this.fades.delete(cue.id); this.changed(); return; }
          f.timer = this.clock.setTimeout(f.done, left * 1000);
        };
        this.fades.set(cue.id, f);
        f.done();
        break;
      }
      case 'mix':
        try { this.mixHook(cue); } catch (err) { this.log(`mix cue ${cue.id}: ${(err as Error).message}`); }
        break;
      case 'script':
        this.runScript(cue);
        break;
      case 'memo':
      default:
        break;
    }
    if (Number(cue.duckOthers)) this.startDuck(cue);
  }

  /**
   * A Script cue: its commands in order, each wait on this engine's clock (core/show/script.js says what a
   * script may say, and why it is a list and not a program). The run is filed like a wait under the cue's id,
   * so it shows in Active Cues, pauses with the cue, and a Stop on the cue (or a panic) ends it where it is.
   */
  runScript(cue: EngineCue) {
    const { steps } = scriptOf.parse(cue.script);
    const prev = this.fades.get(cue.id);
    if (prev) this.clock.clearTimeout(prev.timer);
    const f = { startedAt: this.clock.now(), total: scriptOf.lengthOf(steps), target: cue.id, wait: true, steps: true, timer: null } as Fade;
    let i = 0, due = 0;               // the next step, and when (from the start) it is due
    const find = (st: Step) => (st.id != null ? this.byId.get(st.id) : [...this.byId.values()].find((c) => String(c.number || '').toLowerCase() === String(st.number).toLowerCase())) || null;
    f.done = () => {
      // (it stops being this cue's run when something has taken it away: a Stop, a panic, the cue fired again)
      while (this.fades.get(cue.id) === f && f.pausedAt == null && i < steps.length) {
        const elapsed = this.clock.now() - f.startedAt;
        if (due > elapsed + 1e-6) { f.timer = this.clock.setTimeout(f.done, (due - elapsed) * 1000); return; }
        const st = steps[i++];
        if (st.do === 'wait') { due += st.secs!; continue; }
        const target = (st.number != null || st.id != null ? find(st) : null)!;
        if ((st.number != null || st.id != null) && !target) { this.log(`script ${cue.number || cue.id}, line ${st.line}: no cue ${st.number != null ? `numbered ${st.number}` : st.id}`); continue; }
        this.startDepth = (this.startDepth || 0) + 1;
        try {
          if (this.startDepth > 24) { this.log(`STOPPED a loop of scripts at ${cue.number || cue.id}: put a wait in it`); i = steps.length; break; }
          switch (st.do) {
            case 'start': if (this.isPaused(target.id)) this.resume(target.id); else this.start(target.id); break;
            case 'preview': this.fire(target.id); break;
            case 'stop': this.stopCue(target.id); break;
            case 'pause': this.pause(target.id); break;
            case 'resume': this.resume(target.id); break;
            case 'toggle': if (this.isPaused(target.id)) this.resume(target.id); else this.pause(target.id); break;
            case 'playhead': { const top = this.topOf(target.id); for (const l of this.lists) if (l.cues.some((c) => c.id === top)) { this.listName = l.name; this.playhead = this.stopFrom(top); } break; }
            case 'move': this.movePlayhead(st.step!); break;
            case 'go': this.go(); break;
            case 'panic': this.panic(); break;
            case 'pause-all': this.pause(); break;
            case 'resume-all': this.resume(); break;
            default: break;
          }
        } catch (err) { this.log(`script ${cue.number || cue.id}, line ${st.line}: ${(err as Error).message}`); } finally { this.startDepth--; }
      }
      if (this.fades.get(cue.id) === f && f.pausedAt == null && i >= steps.length) { this.fades.delete(cue.id); this.changed(); }
    };
    this.fades.set(cue.id, f);
    f.done();
  }

  /** A music move's group fires: its plan, with how long until the audio backend starts the crossfade. */
  takePlan(cue: EngineCue): MovePlan | null {
    const plan = this.plans.get(cue.id);
    this.plans.delete(cue.id);
    if (!plan || !this.running.has(plan.out)) return null;
    const lead = Math.max(0, plan.centreIn - (this.clock.now() - plan.madeAt) - plan.xf / 2);
    // a follow lands where the track already is: no beat to wait for, so no lead before one
    return { ...plan, lead, beatLead: cue.onBeat ? Number(cue.beatLead) || 0 : 0, secs: Number(cue.blendSecs) || 0 };
  }

  /** A music cue: the scene's track moves. To `to` (or the landing its plan chose), crossfaded inside
   *  the track by the audio backend, to the sample; looping `to`–`end` if it loops; to `level` dB on the
   *  track's own level if it says. Only that track moves: its level, its ducks and its trims stay with
   *  it. If the track is not playing (a rehearsal GO, or after it was cut) the move starts it there. */
  moveTrack(cue: Partial<EngineCue> & { id: string }, plan?: MovePlan | null) {
    const id = cue.target!;
    const track = this.byId.get(id);
    if (!track || track.type !== 'audio') { this.log(`music cue ${cue.id}: no track ${id}`); return; }
    const to0 = Number(cue.to) || 0;
    // the loop: from where it lands, or from `loopFrom` (it lands, plays on, and loops later on)
    const ls = Number(cue.loopFrom) > 0 ? Number(cue.loopFrom) : to0;
    const loop = cue.loop && Number(cue.end) > ls ? { start: ls, end: Number(cue.end) } : null;
    const base = Number(track.gainDb) || 0;
    const level = Number.isFinite(Number(cue.level)) && cue.level != null ? base + Number(cue.level) : null;
    const fadeIn = Number(cue.fadeIn) || 0;
    let r: Running | null | undefined = this.running.get(id);
    // a track on its way out (Esc, a scene's fade-others, Fade all) is not moved but started again
    // (the same for one already silent: a cue can fade a track to silence without stopping it, and a move
    // that was still waiting on it then starts it where the move says)
    if (r && !cue.stop && (r.fade ? r.fade.to : r.db) <= SILENT_DB) { this.stopAudio(id); r = null; }
    if (cue.stop) {
      // the music stops dead (a 30 ms fade, no click); the next music cue starts it again where it says
      if (r) { this.fadeAudio(id, SILENT_DB, 0.03, true, `stop:${id}`); this.log(`  ↳ ${track.name} stops`); }
      return;
    }
    if (r && !cue.stay && this.warped(r, track, 'moved inside itself')) return;
    if (cue.stay) {
      // the track stays where it is, looping as it was: only its level moves
      const group: Partial<EngineCue> = this.byId.get(this.parentOf.get(cue.id)) || {};
      if (r && level != null) this.fadeAudio(id, level, Math.max(Number(group.blendSecs) || 0, 0.05), false, `level:${id}`);
      this.log(`  ↳ ${track.name} stays where it is${level != null ? `, to ${level} dB` : ''}`);
      return;
    }
    const held = r && (r.region || r.loopTo);
    if (held && !loop && Math.abs(to0 - held.end) < 0.05) {
      // to the end of the loop it is playing (or is to play): it lets go, and plays on out of it (this pass ends, then on);
      // the next armed hold, if any, is armed now
      this.nextHold(r!);
      this.release(id);
      const group: Partial<EngineCue> = this.byId.get(this.parentOf.get(cue.id)) || {};
      if (level != null) this.fadeAudio(id, level, Math.max(Number(group.blendSecs) || 0, 0.05), false, `level:${id}`);
      this.log(`  ↳ ${track.name} lets go of its loop, and plays on`);
      return;
    }
    if (r && cue.letGo) { this.log(`  ↳ ${track.name}: no loop to let go of, it plays on`); return; }
    if (r && loop && cue.hold && this.autoFiring && this.positionOf(r) >= loop.end - 0.05) {
      // fired with its scene's GO, which was loaded to a time past it: nothing to hold, it plays on
      this.log(`  ↳ ${track.name} is past ${loop.start.toFixed(2)}–${loop.end.toFixed(2)} s: plays on`);
      return;
    }
    if (r && loop && cue.hold && this.positionOf(r) < loop.end - 0.05) {
      // a hold: the track plays on and loops when it gets there (or loops now, if it is in it already)
      // a hold armed while another is: both stay armed, in time order (the one looping now keeps looping)
      const looping = r.region && r.loopTo && r.region.start === r.loopTo.start && r.region.end === r.loopTo.end;
      if (r.region && !looping) { r.region = null; this.audio.setRegion && this.audio.setRegion(id, null, null); }
      this.armHold(r, loop);
      if (r.tail) { this.clock.clearTimeout(r.tail); r.tail = null; }
      this.armVamp(id);
      if (level != null) {
        // a hold with a level: it fades there where it is, over the group's blend
        const group: Partial<EngineCue> = this.byId.get(this.parentOf.get(cue.id)) || {};
        this.fadeAudio(id, level, Math.max(Number(group.blendSecs) || 0, 0.05), false, `level:${id}`);
      }
      this.log(`  ↳ ${track.name} holds ${loop.start.toFixed(2)}–${loop.end.toFixed(2)} s${level != null ? `, to ${level} dB` : ''}`);
      return;
    }
    if (!r) {
      // nothing playing: the track starts here (from silence, if it fades in)
      this.loadAt.set(id, to0);
      this.act(track);
      r = this.running.get(id);
      if (!r) return;
      // (its own loop regions that go round by themselves were armed as it started, and stay armed: a track
      // brought back from silence must not run straight through one into what comes after it)
      if (loop) this.armHold(r, loop);
      this.armVamp(id);
      const db = level ?? base;
      if (fadeIn > 0) { this.audio.fade(id, SILENT_DB, 0); r.db = SILENT_DB; this.fadeAudio(id, db, fadeIn, false, `level:${id}`); }
      else if (level != null) this.fadeAudio(id, db, 0, false, `level:${id}`);
      this.log(`  ↳ ${track.name} starts at ${to0.toFixed(2)} s`);
      return;
    }
    if (r.pausedAt != null) {
      // paused: it goes there and stays paused (the audio backend only moves its place), looping there if it says
      const ahead = [r.loopTo, ...(r.holdQueue || [])].filter((l): l is Span => !!l && l.start >= to0 - 0.05 && !(loop && l.start === loop.start && l.end === loop.end)).sort((a, b) => a.start - b.start);
      r.loopTo = loop || ahead.shift() || null;
      r.holdQueue = ahead;
      this.seek(id, to0);
      this.log(`  ↳ ${track.name} (paused) moves to ${to0.toFixed(2)} s`);
      return;
    }
    if (!plan) plan = { at: this.positionOf(r) + NOW_LEAD + 0.015, xf: 0.03, blend: 'cut', lead: NOW_LEAD, beatLead: 0 };
    // where it was, for a pause before the move lands (the audio backend then puts it back): a move replacing
    // one still in its lead keeps the place before that one
    const prev = r.prev && this.clock.now() < r.startedAt ? r.prev
      : { from: r.from, startedAt: r.startedAt, region: r.region, loopTo: r.loopTo };
    const land = (plan.to != null ? plan.to : to0) + (plan.beatLead || 0);
    if (r.region) { r.region = null; this.audio.setRegion && this.audio.setRegion(id, null, null); }
    // where it lands: its own loop, or the next armed hold still ahead of it (the others behind it are gone)
    const ahead = [r.loopTo, ...(r.holdQueue || [])].filter((l): l is Span => !!l && l.start >= land - 0.05 && !(loop && l.start === loop.start && l.end === loop.end)).sort((a, b) => a.start - b.start);
    r.loopTo = loop || ahead.shift() || null;
    r.holdQueue = ahead;
    if (Math.abs(land - plan.at) < 0.02) {
      // already there (a loop the track runs into, at its own start): it only begins to loop
      this.armVamp(id);
    } else {
      const start = Math.max(0, land - plan.xf / 2);
      const region = r.loopTo && r.exact ? r.loopTo : null;   // its own loop, or the next armed hold ahead of where it lands
      this.audio.move && this.audio.move(id, { to: start, region, sync: { at: plan.at - plan.xf / 2, lead: plan.lead, xf: plan.xf, blend: plan.blend } });
      r.prev = prev;
      r.from = start;
      r.startedAt = this.clock.now() + plan.lead;
      r.region = region ? { ...region, index: -1 } : null;
      if (r.cutSent) this.audio.fade(id, r.db, 0.01);          // a cut already on its way: the level back, as a skip does
      r.cutSent = false;
      // landing at (or past) the track's own end time is the music going on from it: that end no longer cuts
      if (Number(track.cutAt) > 0 && land >= Number(track.cutAt) - 0.05) r.noCut = true;
      if (r.pic) this.stage('seek', id, land);
      this.log(`  ↳ ${track.name}: ${plan.blend} from ${plan.at.toFixed(2)} s to ${land.toFixed(2)} s over ${plan.xf.toFixed(2)} s`
               + (plan.score != null ? ` (match ${plan.score.toFixed(2)})` : ''));
    }
    if (r.tail) { this.clock.clearTimeout(r.tail); r.tail = null; }
    if (level != null) this.fadeAudio(id, level, Math.max(plan.secs || 0, plan.xf, 0.05), false, `level:${id}`);
    this.scheduleTail(id);
  }

  // ── the stage: cues with a picture ────────────────────────────────────

  /** One call to the stage. It is another window: whatever it throws is logged, and the cue goes on. */
  stage<K extends keyof EngineStage>(op: K, ...args: Parameters<NonNullable<EngineStage[K]>>) {
    const fn = this.video && this.video[op];
    if (!fn) return;
    try { (fn as (...a: typeof args) => void)(...args); } catch (err) { this.log(`stage ${op}: ${(err as Error).message}`); }
  }

  /** A cue's picture goes up on the stage, `from` s into its file; with `fadeIn`, from nothing up to its opacity. */
  showPicture(cue: EngineCue, from: number, fadeIn = 0) {
    const r = this.running.get(cue.id);
    if (!r) return;
    const g = geometryOf(cue);
    r.pic = g;                      // where its picture is, or is on its way to: what a restored stage is told
    r.spec = { kind: cue.picture, file: cue.file || '', text: cue.text || '', font: cue.font || '', size: Number(cue.size) || 96, textColor: cue.textColor || '#ffffff', align: cue.align || 'center',
               camera: cue.camera || '', mirror: !!cue.mirror, fit: cue.fit || 'fit', layer: Number(cue.layer) || 0, loop: !!cue.loop && !(Number(cue.cutAt) > 0) };
    this.stage('show', cue.id, { ...r.spec, from, geometry: fadeIn > 0 ? { ...g, opacity: 0 } : g });
    if (fadeIn > 0) this.stage('move', cue.id, { opacity: g.opacity }, fadeIn);
  }

  /** Some of a picture's opacity, place, scale and rotation go to new values over `secs`. */
  movePicture(id: string, props: Partial<Geometry>, secs: number) {
    const r = this.running.get(id);
    if (!r || !r.pic) return;
    r.pic = { ...r.pic, ...props };
    this.stage('move', id, props, Math.max(0, Number(secs) || 0));
  }

  /** What is on the stage now, as `show` would be told it: for a stage window that has just been (re)opened. */
  pictures() {
    const out = [];
    for (const [id, r] of this.running) if (r.pic) out.push({ id, spec: { ...r.spec, from: r.still ? 0 : this.positionOf(r), geometry: r.pic }, paused: r.pausedAt != null || r.ended != null });
    return out;
  }

  /** A still, a title or a camera with a `duration` ends by itself then, fading over its last `fadeOut` seconds. */
  scheduleStill(id: string) {
    const r = this.running.get(id), cue = this.byId.get(id);
    if (!r || !r.still || !cue) return;
    if (r.tail) { this.clock.clearTimeout(r.tail); r.tail = null; }
    const total = Number(cue.duration);
    if (!(total > 0) || r.pausedAt != null) return;
    const left = total - this.positionOf(r), out = Math.min(Number(cue.fadeOut) || 0, total);
    const fading = out > 0 && left > out;
    r.tail = this.clock.setTimeout(() => {
      r.tail = null;
      if (this.running.get(id) !== r) return;
      if (fading) this.fadeAudio(id, SILENT_DB, out, true, `tail:${id}`);
      else this.audioEnded(id);
      this.changed();
    }, Math.max(0, fading ? left - out : left) * 1000);
  }

  /** A video with "hold at end" that has reached its end: its last frame stays up and it stays running (so an
   *  auto-follow waits) until it is stopped or faded out. Not one that never got going (a file that would not play). */
  holdEnd(id: string, r: Running) {
    const cue = this.byId.get(id);
    if (!cue || !cue.holdEnd || !r.pic || r.still || r.ended != null) return false;
    const p = this.positionOf(r);
    if (!(p > 0.5)) return false;
    if (r.tail) { this.clock.clearTimeout(r.tail); r.tail = null; }
    const dur = this.durations.get(r.file) || 0;
    r.ended = dur > 0 ? Math.min(p, dur) : p;
    this.stage('pause', id);
    this.log(`  ↳ ${cue.name || id}: holding its last frame`);
    return true;
  }

  fadeAudio(id: string, db: number, secs: number, stopWhenDone: boolean, fadeId: string, shape?: Shape | null) {
    const r = this.running.get(id);
    if (!r) return;
    db = this.lim(db);
    const prev = this.fades.get(fadeId);
    if (prev) this.clock.clearTimeout(prev.timer);
    const startedAt = this.clock.now();
    r.fade = { to: db, until: startedAt + secs, ...(shape ? { shape } : {}) };
    if (shape && secs > 0) this.audio.fade(id, db, secs, undefined, shape, 0); else this.audio.fade(id, db, secs);
    // a picture on its way out goes with its sound (a Fade and stop, a panic, "fade and stop others", its own fade out)
    if (r.pic && secs > 0 && (stopWhenDone || String(fadeId).startsWith('tail:'))) this.movePicture(id, { opacity: 0 }, secs);
    const done = () => {
      this.fades.delete(fadeId);
      const cur = this.running.get(id);
      if (cur) { cur.db = db; cur.fade = null; }
      if (stopWhenDone) this.stopAudio(id);
      this.changed();
    };
    if (secs <= 0) { done(); return; }
    const timer = this.clock.setTimeout(done, secs * 1000);
    this.fades.set(fadeId, { timer, startedAt, total: secs, target: id, done });
  }

  /** The app's own lights move for `total` s on behalf of `cue` (a Light cue, or a Fade aimed at one): the host is told
   *  ('run' | 'fade'), and while the entry is in `fades` it reads how far the fade has got from it. */
  lightFade(cue: EngineCue, action: DmxAction, light: EngineCue, total: number) {
    const prev = this.fades.get(cue.id);
    if (prev) this.clock.clearTimeout(prev.timer);
    this.fades.delete(cue.id);
    const f = { startedAt: this.clock.now(), total, target: cue.id, light: true, timer: null } as Fade;
    f.done = () => {
      if (this.fades.get(cue.id) !== f) return;
      this.fades.delete(cue.id);
      try { this.dmxHook('done', cue, light); } catch (err) { this.log(`light cue ${cue.id}: ${(err as Error).message}`); }
      this.changed();
    };
    if (total > 0) { f.timer = this.clock.setTimeout(f.done, total * 1000); this.fades.set(cue.id, f); }
    try { this.dmxHook(action, cue, light); } catch (err) { this.log(`light cue ${cue.id}: ${(err as Error).message}`); }
  }

  /** A sound's voice-band dip moved to `db` (0 = flat) over `secs`: a fade like any other
   *  for what is running, waiting and cancelled, that leaves the sound's level alone. */
  fadeBand(id: string, db: number, secs: number, fadeId: string) {
    const r = this.running.get(id);
    if (!r) return;
    const prev = this.fades.get(fadeId);
    if (prev) this.clock.clearTimeout(prev.timer);
    r.band = db;
    this.audio.fade(id, db, secs, 'voice');
    const done = () => { this.fades.delete(fadeId); this.changed(); };
    if (secs <= 0) { done(); return; }
    const timer = this.clock.setTimeout(done, secs * 1000);
    this.fades.set(fadeId, { timer, startedAt: this.clock.now(), total: secs, target: id, done });
  }

  stopAudio(id: string) {
    if (!this.running.has(id)) return;
    const gone = this.running.get(id)!;
    if (gone.tail) this.clock.clearTimeout(gone.tail);
    if (gone.counting) this.clock.clearTimeout(gone.counting);
    this.running.delete(id);
    this.releaseThen.delete(id);                // stopped, not played out: what waited for its end does not fire
    for (const k of [...this.waits.keys()]) {
      // a music move still waiting for its beat on this track would start it again
      const m = this.byId.get(k) && this.musicOf(this.byId.get(k)!);
      if (m && m.target === id) { this.cancelWait(k); this.plans.delete(k); this.log(`  ↳ ${k} cancelled: ${id} stopped`); }
    }
    if (gone.pic) this.stage('hide', id);
    for (const [fid, f] of this.fades) {
      if (f.target === id) { this.clock.clearTimeout(f.timer); this.fades.delete(fid); }
    }
    this.audio.stop(id);
  }

  cancelWait(id: string) {
    const w = this.waits.get(id);
    if (w) { this.clock.clearTimeout(w.timer); this.waits.delete(id); }
  }

  /** Stop a cue and everything under it: waits cancelled, audio stopped. */
  stopTree(id: string, soft = false) {
    const cue = this.byId.get(id);
    if (!cue) return;
    this.endPlaylist(id);
    this.cancelWait(id);
    for (const k of [id, `hold:${id}`]) if (this.fades.has(k)) { this.clock.clearTimeout(this.fades.get(k)!.timer); this.fades.delete(k); }
    // (`soft`: a Stop cue or the operator's stop; a sound on a bus that fades its stops goes out over that time: sound-kinds.js)
    if (cue.type === 'audio' || cue.type === 'mic' || cue.type === 'picture') { if (!(soft && this.softStop(id))) this.stopAudio(id); }
    for (const child of cue.children || []) this.stopTree(child.id, soft);
  }

  // ── playlists: a group that plays one child after another ─────────────

  startPlaylist(cue: EngineCue) {
    this.endPlaylist(cue.id);
    const order = (cue.children || []).filter((c) => !this.disarmed.has(c.id)).map((c) => c.id);
    if (!order.length) return;
    if (cue.shuffle) this.shuffle(order);
    this.playlists.set(cue.id, { order, at: -1, current: null, timer: null });
    this.playNext(cue.id);
  }
  shuffle<T>(a: T[]) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  endPlaylist(gid: string) {
    const pl = this.playlists.get(gid);
    if (!pl) return;
    if (pl.timer) this.clock.clearTimeout(pl.timer);
    this.playlists.delete(gid);
  }
  /** A sound stopped by hand: the playlists it is in end with it. */
  leavePlaylists(id: string) { for (const gid of [...this.playlists.keys()]) if (gid === id || this.isInside(id, gid)) this.endPlaylist(gid); }

  /** The playlist's next child (round again at the end when it repeats; shuffled again, never the same one twice running). */
  playNext(gid: string, fadeIn = 0) {
    const pl = this.playlists.get(gid), g = this.byId.get(gid);
    if (!pl || !g) return;
    if (pl.timer) { this.clock.clearTimeout(pl.timer); pl.timer = null; }
    pl.at++;
    if (pl.at >= pl.order.length) {
      if (!g.repeat) { this.endPlaylist(gid); return; }
      pl.at = 0;
      if (g.shuffle && pl.order.length > 1) { const last = pl.order[pl.order.length - 1]; do this.shuffle(pl.order); while (pl.order[0] === last); }
    }
    const id = pl.current = pl.order[pl.at];
    this.log(`  ↳ playlist ${g.name}: ${(this.byId.get(id) || {}).name || id}`);
    this.fadeInOnce = fadeIn;
    try { this.fire(id); } finally { this.fadeInOnce = 0; }
    this.planCrossfade(gid);
  }

  /** With a crossfade, the next child starts that long before the one playing ends. */
  planCrossfade(gid: string) {
    const pl = this.playlists.get(gid), g = this.byId.get(gid);
    const xf = g ? Number(g.crossfade) || 0 : 0;
    if (!pl || !(xf > 0)) return;
    if (pl.timer) { this.clock.clearTimeout(pl.timer); pl.timer = null; }
    const id = pl.current!, r = this.running.get(id), c = this.byId.get(id);
    if (!r || !c || r.loop || r.pausedAt != null || !(pl.at + 1 < pl.order.length || g!.repeat)) return;
    const end = Number(c.cutAt) > 0 ? Number(c.cutAt) : this.durations.get(r.file) || 0;
    if (!(end > 0)) return;                                   // not measured yet: setDuration comes back here
    pl.timer = this.clock.setTimeout(() => {
      pl.timer = null;
      const now = this.running.get(id);
      if (this.playlists.get(gid) !== pl || pl.current !== id || !now || now.pausedAt != null) return;
      const left = (end - this.positionOf(now)) / this.rateOf(now);
      if (left > xf + 0.15 || now.region) { this.planCrossfade(gid); return; }     // skipped back, or going round a section
      this.fadeAudio(id, SILENT_DB, Math.max(0.05, left), true, `pl:${id}`);
      this.playNext(gid, xf);
      this.changed();
    }, Math.max(0, (end - this.positionOf(r)) / this.rateOf(r) - xf) * 1000);
  }

  /** The operator's "next" on a playlist: what is playing fades out, the next child comes in. */
  skipPlaylist(gid: string) {
    const pl = this.playlists.get(gid), g = this.byId.get(gid);
    if (!pl || !g) return false;
    const xf = Math.max(0.3, Number(g.crossfade) || 0), was = pl.current!;
    if (pl.at + 1 >= pl.order.length && !g.repeat) { this.endPlaylist(gid); if (this.running.has(was)) this.fadeAudio(was, SILENT_DB, xf, true, `pl:${was}`); else this.stopTree(was); this.changed(); return true; }
    if (this.running.has(was)) this.fadeAudio(was, SILENT_DB, xf, true, `pl:${was}`); else this.stopTree(was);
    this.playNext(gid, xf);
    this.changed();
    return true;
  }

  /** A playlist's child has finished: the next one. (Children that cannot play are passed over; a playlist with
   *  nothing that plays ends, rather than going round for ever.) */
  checkPlaylists() {
    if (!this.playlists.size || this.checkingPlaylists) return;
    this.checkingPlaylists = true;
    try {
      for (const [gid, pl] of [...this.playlists]) {
        let tries = pl.order.length + 1;
        while (this.playlists.get(gid) === pl && !this.isLive(pl.current!) && tries-- > 0) this.playNext(gid);
        if (tries < 0 && this.playlists.get(gid) === pl) { this.log(`playlist ${(this.byId.get(gid) || {}).name || gid}: nothing in it plays`); this.endPlaylist(gid); }
      }
    } finally { this.checkingPlaylists = false; }
  }

  isInside(id: string, ancestor: string | null | undefined) {
    for (let p = this.parentOf.get(id); p; p = this.parentOf.get(p)) if (p === ancestor) return true;
    return false;
  }

  /** The host: audio cue `key` reached the end of its file. */
  audioEnded(key: string) {
    if (!this.running.has(key)) return;
    const r = this.running.get(key)!;
    if (r.ended != null) return;
    if (this.holdEnd(key, r)) { this.changed(); return; }
    if (r.tail) this.clock.clearTimeout(r.tail);
    this.running.delete(key);
    if (r.pic) this.stage('hide', key);
    const then = this.releaseThen.get(key);
    if (then) {
      this.releaseThen.delete(key);
      for (const id of then) if (this.byId.has(id)) this.chain(this.byId.get(id)!, 0, `after ${key}'s last pass:`);
    }
    this.changed();
  }

  /** A warped sound's desk tempo changed while it plays: `warp` is the new ratio of the desk's tempo to its own.
   *  Its rate is its own rate (as a Fade may have left it) times that; it carries on from where it is. */
  rewarp(id: string, warp: number) {
    const r = this.running.get(id);
    if (!r || r.live || !(warp > 0)) return;
    const was = r.warp && r.warp > 0 ? r.warp : 1;
    if (Math.abs(was - warp) < 1e-4) return;
    const to = clampRate(this.rateOf(r) / was * warp);
    r.warp = warp;
    this.fadeRate(id, to, 0, `rate:warp:${id}`);
    this.changed();
  }

  /** How fast a running sound plays (1: as recorded). A second of the clock is this many seconds of its file, so
   *  everything that waits for a place in the file (its end, its End at, a loop's count, a downbeat) divides by it. */
  rateOf(r: Running | null | undefined) { return r && r.rate && r.rate > 0 ? r.rate : 1; }
  /** Seconds of file played through, straight on (a loop not wrapped). */
  straight(r: Running) { return r.from + ((r.pausedAt != null ? r.pausedAt : this.clock.now()) - r.startedAt) * this.rateOf(r); }
  lim(db: number): number { return this.limits ? limitDb(db, this.limits) : db; }

  /** A running sound's rate changes now: its clock is rebased where it is, and whatever was waiting for a place
   *  in its file (its tail, its cut, a counted loop, a playlist's crossfade) is planned again at the new rate. */
  setRate(id: string, rate: number) {
    const r = this.running.get(id);
    if (!r || !(rate > 0)) return;
    const now = this.clock.now();
    if (now >= r.startedAt) { r.from = this.straight(r); r.startedAt = r.pausedAt != null ? r.pausedAt : now; }   // (not in a move's lead: it has not landed)
    r.rate = rate;
    if (r.pausedAt != null) return;
    if (!this.fades.has(`tail:${id}`)) this.scheduleTail(id);
    for (const gid of this.playlists.keys()) this.planCrossfade(gid);
  }

  /** A sound's rate moved to `to` over `secs` (a Fade cue's "rate to"). The backend ramps it; here the sound's
   *  clock is corrected every RATE_STEP, each step counted at the rate half way through it, which is exact for a
   *  straight ramp. A fade like any other for what is running, paused and cancelled. */
  fadeRate(id: string, to: number, secs: number, fadeId: string, stopWhenDone = false) {
    const r = this.running.get(id);
    if (!r) return;
    to = clampRate(to);
    for (const [k, f] of [...this.fades]) if (f.rate && f.target === id) { this.clock.clearTimeout(f.timer); this.fades.delete(k); }   // the last word wins
    this.audio.rate && this.audio.rate(id, to, secs);
    if (!(secs > 0)) { this.setRate(id, to); if (stopWhenDone) this.stopAudio(id); return; }
    const from = this.rateOf(r);
    this.setRate(id, from);                        // (its clock rebased here, where the ramp begins)
    const f = { startedAt: this.clock.now(), total: secs, target: id, rate: true, net: true, to, timer: null, last: from } as Fade;
    f.done = () => {
      if (this.fades.get(fadeId) !== f) return;
      const cur = this.running.get(id);
      if (!cur) { this.fades.delete(fadeId); return; }
      const gone = this.clock.now() - f.startedAt;
      const x = gone >= secs - 1e-6 ? 1 : gone / secs;
      const at = from + (to - from) * x;
      cur.rate = (f.last! + at) / 2;                // the step just gone, at its middle rate…
      this.setRate(id, at);                        // …and on from here at the rate it has reached
      f.last = at;
      if (x >= 1) { this.fades.delete(fadeId); if (stopWhenDone) this.stopAudio(id); this.changed(); return; }
      f.timer = this.clock.setTimeout(f.done, Math.min(RATE_STEP, secs - gone) * 1000);      // (the last step lands on the end)
    };
    this.fades.set(fadeId, f);
    f.timer = this.clock.setTimeout(f.done, RATE_STEP * 1000);
  }

  /** "Revert fade": what a Fade cue moved goes back to how it was before the cue fired (level, voice-band dip,
   *  rate), over REVERT_FADE, and the cue's own fade, if it is still running, is called off. A sound the cue has
   *  already stopped is gone and is not brought back. Returns how many sounds were put back. */
  revertFade(cueId: string) {
    const was = this.reverts.get(cueId);
    if (!was) return 0;
    for (const [k, f] of [...this.fades]) {
      if (k === cueId || String(k).startsWith(`${cueId}:`) || String(k).startsWith(`rate:${cueId}`) || String(k).startsWith(`band:${cueId}`)) { this.clock.clearTimeout(f.timer); this.fades.delete(k); }
    }
    let n = 0;
    for (const w of was) {
      const r = this.running.get(w.id);
      if (!r) continue;
      n++;
      this.fadeAudio(w.id, w.db, REVERT_FADE, false, `revert:${w.id}`);
      if ((r.band || 0) !== w.band) this.fadeBand(w.id, w.band, REVERT_FADE, `revertband:${w.id}`);
      if (Math.abs(this.rateOf(r) - w.rate) > 1e-6 || [...this.fades.values()].some((f) => f.rate && f.target === w.id)) this.fadeRate(w.id, w.rate, REVERT_FADE, `rate:revert:${w.id}`);
    }
    this.reverts.delete(cueId);
    const c = this.byId.get(cueId);
    this.log(`REVERT FADE ${c ? c.number || c.name || cueId : cueId}: ${n} sound${n === 1 ? '' : 's'} back as ${n === 1 ? 'it was' : 'they were'}`);
    this.changed();
    return n;
  }

  /** Seconds into the file a running audio cue is now (a loop wraps). */
  positionOf(r: Running): number {
    if (r.ended != null) return r.ended;          // a video holding its last frame
    let t = this.straight(r);
    if (r.region && t >= r.region.end) {
      const len = r.region.end - r.region.start;
      t = r.region.start + ((t - r.region.end) % len);
    }
    const dur = this.durations.get(r.file) || 0;
    return r.loop && dur > 0 ? t % dur : t;
  }

  // ── what the operator sees ────────────────────────────────────────────

  /** Whether a track is in the section it loops now (not on its way there), for a UI to show. */
  holdingIn(r: Running | null | undefined) {
    if (!r || !r.region) return false;
    const p = this.positionOf(r);
    return p >= r.region.start - 0.05 && p <= r.region.end + 0.05;
  }

  /** Active Cues: what is waiting, sounding or fading, with times to show. */
  active() {
    const now = this.clock.now();
    const out = [];
    const el = (x: { pausedAt?: number | null; startedAt: number }) => (x.pausedAt != null ? x.pausedAt : now) - x.startedAt;
    for (const [id, w] of this.waits) {
      const c: Partial<EngineCue> = this.byId.get(id) || { type: 'memo', name: id };
      out.push({ id, kind: 'wait' as const, type: c.type, name: c.name, number: c.number || '',
                 parent: this.topOf(id), elapsed: el(w), total: w.total, paused: w.pausedAt != null });
    }
    for (const [id, r] of this.running) {
      const c: Partial<EngineCue> = this.byId.get(id) || { name: id, file: r.file };
      const dur = r.still ? Number(c.duration) || 0 : this.durations.get(r.file) || 0;
      out.push({ id, kind: 'audio' as const, type: 'audio', name: c.name, number: c.number || '',
                 parent: this.topOf(id), elapsed: this.positionOf(r), total: dur, loop: !!r.loop, mic: !!r.live,
                 // on the stage: 'video' | 'image' | 'text' | 'camera', and where its picture is (or is fading to)
                 picture: r.pic ? r.spec!.kind : null, geometry: r.pic || null, heldEnd: r.ended != null,
                 // where it stops: its End at when it has one (the countdown is to here, not to the end of the file)
                 end: Number(c.cutAt) > 0 && Number(c.cutAt) < dur ? Number(c.cutAt) : dur,
                 loops: c.loops || null, loopOptions: c.loopOptions || null, region: r.region || null, exact: !!r.exact,
                 holds: this.holdsOf(id), holding: this.holdingIn(r),
                 // a counted section: which pass of how many
                 count: r.region && r.region.count ? { of: r.region.count, pass: Math.min(r.region.count, Math.max(1, Math.floor((this.straight(r) - r.region.start) / (r.region.end - r.region.start)) + 1)) } : null,
                 rate: this.rateOf(r), ...(r.stretched ? { stretched: true } : {}),      // (stretched: at a rate with its pitch kept, so a stream: no loops or holds)
                 playlist: [...this.playlists].filter(([, pl]) => pl.current === id || this.isInside(id, pl.current)).map(([gid]) => gid)[0] || null,
                 // the loop lane: every hold armed on the track, in time order (the next first)
                 armed: [r.loopTo, ...(r.holdQueue || [])].filter((l): l is Span => !!l).map((l) => ({ start: l.start, end: l.end })),
                 db: r.db, fadingTo: r.fade ? r.fade.to : null, paused: r.pausedAt != null,
                 duck: r.duck || 0,                             // dB a cue that ducks (or boosts) the others holds it at, on top of its level
                 // for a now-playing view, whatever list is on screen
                 file: r.file, gainDb: Number(c.gainDb) || 0, markers: c.markers || [],
                 topNumber: (this.byId.get(this.topOf(id)) || {}).number || '' });
    }
    for (const [id, f] of this.fades) {
      if (f.wait) {
        const wc: Partial<EngineCue> = this.byId.get(f.target) || { name: f.target };
        out.push({ id: f.target, kind: 'wait' as const, type: 'wait', name: wc.name, number: wc.number || '', parent: this.topOf(f.target), elapsed: el(f), total: f.total, paused: f.pausedAt != null });
        continue;
      }
      if (f.rate && this.fades.has(String(id).replace(/^rate:/, ''))) continue;      // a Fade cue moving level and rate: one line
      const c = this.byId.get(id) || this.byId.get(String(id).replace(/^rate:/, '').split(':')[0]);
      out.push({ id, kind: 'fade' as const, type: 'fade', name: c ? c.name : 'fade out', number: c?.number || '',
                 parent: c ? this.topOf(c.id) : this.topOf(f.target), elapsed: el(f), total: f.total, paused: f.pausedAt != null, ...(f.run ? { run: f.run } : {}) });
    }
    return out.sort((a, b) => (a.kind === 'audio' ? 0 : 1) - (b.kind === 'audio' ? 0 : 1)
                              || (a.total - a.elapsed) - (b.total - b.elapsed));
  }

  /** Every place the scene's music cues loop a track (holds and lands-then-loops), in time order, for the
   *  UI to draw on the track's waveform from the scene's start, so the operator sees them coming. */
  holdsOf(trackId: string): Hold[] {
    if (!this.holdsCache) this.holdsCache = new Map();
    if (this.holdsCache.has(trackId)) return this.holdsCache.get(trackId)!;
    const out: Hold[] = [];
    for (const c of this.byId.values()) {
      if (c.type !== 'music' || c.target !== trackId || !c.loop) continue;
      const start = Number(c.loopFrom) > 0 ? Number(c.loopFrom) : Number(c.to) || 0, end = Number(c.end);
      if (!(end > start)) continue;
      const top: Partial<EngineCue> = this.byId.get(this.topOf(c.id)) || {};
      out.push({ id: c.id, start, end, number: top.number || '', name: String(c.name || '').replace(/^♪\s*/, '') });
    }
    out.sort((a, b) => a.start - b.start);
    this.holdsCache.set(trackId, out);
    return out;
  }

  topOf(id: string) {
    let top = id;
    for (let p = this.parentOf.get(id); p; p = this.parentOf.get(p)) top = p;
    return top;
  }

  /** Whether a top-level cue has anything going on under it. */
  isLive(id: string) {
    const under = (x: string) => x === id || this.isInside(x, id);
    // (a Fade cue's own fade is filed under the cue's id, with the sound it moves as its target)
    return [...this.waits.keys(), ...this.running.keys()].some(under)
      || [...this.fades].some(([k, f]) => under(k) || under(f.target));
  }

  /** Cues that cannot play as written (a missing file), for the yellow flag. */
  problems() {
    const out = [];
    for (const c of this.byId.values()) {
      if ((c.type === 'audio' || c.type === 'picture') && c.file && this.missing.has(c.file)) out.push({ id: c.id, top: this.topOf(c.id), why: `missing file ${c.file}` });
      else if (c.broken) out.push({ id: c.id, top: this.topOf(c.id), why: c.broken });
    }
    return out;
  }

  snapshot() {
    return {
      // (each list's own playhead, and how many of its cues have something going on: a list runs on while another is on screen)
      lists: this.lists.map((l) => ({ name: l.name, count: l.cues.length, playhead: this.heads.get(l.name) ?? null, live: l.cues.filter((c) => this.isLive(c.id)).length })),
      listName: this.listName,
      cues: this.top(),
      playhead: this.playhead,
      skipLights: this.skipLights,
      live: this.top().filter((c) => this.isLive(c.id)).map((c) => c.id),
      paused: this.top().filter((c) => this.isPaused(c.id)).map((c) => c.id),
      disarmed: [...this.disarmed],
      played: [...this.played].filter((id) => this.byId.has(id)),
      showStartedAt: this.showStartedAt,
      loaded: this.loaded,
      loads: Object.fromEntries(this.loads),
      held: this.held,
      entered: Object.fromEntries(this.entered),
      active: this.active(),
      problems: this.problems(),
      durations: Object.fromEntries(this.durations),
      lastGo: this.lastGo,
      headLength: this.playhead ? this.lengthOf(this.playhead) : 0,      // for Load to Time's slider
      now: this.clock.now(),
    };
  }

  changed() { this.checkPlaylists(); this.checkFollows(); this.checkDucks(); this.emit('change'); }
}
// (the methods of sequencing.ts and sound-kinds.ts are this class's too)
interface CueEngine extends Sequencing, SoundKinds {}
Object.assign(CueEngine.prototype, sequencing({ SILENT_DB }), soundKinds({ SILENT_DB, busOf }));

/** The bus an audio cue plays on: a scene's music, or everything else. */
function busOf(cue: { id: string; bus?: string }) {
  if (typeof cue.bus === 'string' && cue.bus) return cue.bus;
  return /\/mix$/.test(cue.id) ? 'music' : 'effects';       // (the id convention of lists made before buses were named)
}

/** A cue the operator only calls (a lighting cue): skipped as a stop while light cues are off. */
function isCall(c: EngineCue | null | undefined) { return !!c && c.type === 'light' && !String(c.levels || '').trim(); }

/** One OSC message from "/address arg arg": ints, floats and strings, as QLab
 *  types them. A host can use it to send network cues over UDP. */
function encodeOsc(text: unknown) {
  const parts = String(text).trim().split(/\s+/);
  const address = parts.shift();
  if (!address || !address.startsWith('/')) throw new Error(`not an OSC address: ${text}`);
  const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]);
  const str = (s: string) => pad(Buffer.from(s, 'utf8'));
  let tags = ',';
  const args = [];
  for (const p of parts) {
    if (/^-?\d+$/.test(p)) {
      tags += 'i';
      const b = Buffer.alloc(4); b.writeInt32BE(parseInt(p, 10)); args.push(b);
    } else if (/^-?(\d+\.\d*|\.\d+|\d+)(e-?\d+)?$/i.test(p)) {
      tags += 'f';
      const b = Buffer.alloc(4); b.writeFloatBE(parseFloat(p)); args.push(b);
    } else {
      tags += 's'; args.push(str(p));
    }
  }
  return Buffer.concat([str(address), str(tags), ...args]);
}

export { CueEngine, encodeOsc, busOf, isCall, PANIC_FADE, SYNC_LEAD };
