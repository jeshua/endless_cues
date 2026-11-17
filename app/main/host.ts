/**
 * The show host: everything that must outlive the operator's screen.
 *
 * It lives in the main process and owns the open show (ShowDocument), the cue
 * engine playing it, the hidden audio window that makes the sound, the mixer
 * and the modules. The window the operator looks at is only a view: it sends
 * commands (`cmd`) and is pushed state. Reloading it, or its renderer
 * crashing, changes nothing that is sounding. If the audio window itself dies
 * a new one is made and the engine forgets what was playing, so the next GO
 * works.
 *
 * `cmd(c)` is the one door: the window, the OSC control module and the web
 * remote all come through it, so they cannot disagree about what GO means.
 * docs/specs/02-architecture.md has the picture.
 */
import * as dgram from 'dgram';
import type { BrowserWindow as Win, IpcMain, IpcMainEvent, Screen, WebContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { CueEngine } from '../../core/engine/cue-engine';
import { wavPeaks } from '../../core/engine/waveform';
import * as show from '../../core/show/show';
import { ShowDocument } from '../../core/show/document';
import * as cueTypes from '../../core/show/cue-types';
import * as osc from '../../core/net/osc';
import * as midi from '../../core/net/midi';
import type { MidiMessage } from '../../core/net/midi';
import type { PlayoutMessage } from '../../core/net/playout';
import type { HubFrom, HubReply, MonitorEntry } from '../../core/net/hub';
import type { TrustRecord } from '../../core/show/trust';
import type { ToolContext, ToolInput } from '../../core/assistant/tools';
import type { Place } from '../../core/ui/places';
import { createHub } from '../../core/net/hub';
import { oscTriggers, firedBy } from '../../core/net/triggers';
import { createStage } from './stage';
import { mediaKind } from '../../core/video/stage';
import { createLighting } from '../../core/light/lighting';
import type { LightCmd } from '../../core/light/lighting';
import * as oscCommands from '../../core/net/commands';
import { createTransport } from '../../core/timecode/transport';
import type { LtcCmd } from '../../core/timecode/transport';
import type { createAssistant, AssistantView } from '../../core/assistant/assistant';
import type { Cue, CueList, CueType, Modules, ShowDoc } from '../../core/show/types';
import type { Problem } from '../../core/show/show';
import type { FieldChange } from '../../core/show/diff';
import type { TriggerRow } from '../../core/show/triggers';
import type { EngineCue, Running } from '../../core/engine/cue-engine';
import type { AppConfig } from './main';
import type { importQlab } from '../../core/import/qlab';
import { triggersOf, clockDue } from '../../core/show/triggers';
const MODULES: ModuleDef[] = [require('./modules/osc-control') as typeof import('./modules/osc-control'), require('./modules/lighting-desk') as typeof import('./modules/lighting-desk'), require('./modules/web-remote') as typeof import('./modules/web-remote'), require('./modules/show-feedback') as typeof import('./modules/show-feedback'), require('./modules/backup-link') as typeof import('./modules/backup-link')];

const TICK_MS = 100;
import { stripOf, cleanSetting, withSetting, withSettings, deskOf, recallOf } from '../../core/audio/strip';
import * as deskMap from '../../core/audio/desk-map';
import { usesLive } from '../../core/show/uses-live';
import { tempoMap, editTempo, sectionAt, warpRate, MIN_CONFIDENCE } from '../../core/audio/tempo';
import { replacedBy, TAKEOVER_FADE } from '../../core/audio/launch';
import * as clipboard from '../../core/show/clipboard';
import * as templates from '../../core/show/templates';
import * as routing from '../../core/audio/routing';
import * as kinds from '../../core/audio/kinds';
import * as Chain from '../../core/audio/chain';
import * as cartOf from '../../core/show/cart';
import * as sections from '../../core/show/sections';
import * as backups from '../../core/show/backups';
import * as showTemplates from '../../core/show/show-templates';
import { PlayLog, CSV_HEAD, csvLine, toCsv } from '../../core/engine/playlog';
import { ShowLog, bareLines } from '../../core/log/show-log';
import { createGoGuard } from '../../core/engine/go-guard';
import * as showCheck from '../../core/show/check';
import * as runFrom from '../../core/engine/run-from';
import * as rigDevices from '../../core/rig/devices';
import { createRig } from './rig-service';
import type { RigCommand } from './rig-service';
import type { StageCommand } from './stage';
import * as trust from '../../core/show/trust';
/** The outputs a rehearsal may want held back (Tools ▸ Hold Back …). */
const OVERRIDES = [{ id: 'osc', label: 'OSC out' }, { id: 'midi', label: 'MIDI out' }, { id: 'timecode', label: 'Timecode out' }, { id: 'dmx', label: 'DMX out' }];
const AUDIO_EXT = /\.(wav|aiff?|aifc|caf|mp3|m4a|aac|flac|ogg|opus)$/i;
const MIDI_EXT = /\.(mid|midi|smf)$/i;
import * as os from 'os';
import { progressOf, cleanLimits } from '../../core/audio/curves';
import * as deviceWatch from '../../core/audio/device-watch';
import type { WatchEvent, WatchState } from '../../core/audio/device-watch';
import { wavCopyOf } from '../../core/audio/pcm-container';
const MUSIC_SECS = 30;            // a sound added with no bus chosen: this long or longer goes on the Music bus
const PEAK_BINS = 1600, PEAK_DETAIL = 8000;      // a waveform's slices: for a strip, and for one that is zoomed into

// ── the host's commands: what `cmd` takes, by `op` ──────────────────────
/** Any command may name a cue, by id or by number, and say who sent it (`from`: 'osc', 'web-remote', 'midi', …). */
type CueNamed = { id?: string | null; number?: string | null; from?: string };
type Bar = 'bar' | 'beat';
/** Where new cues go: after a cue, inside a group, at the end of a list, on a cart's button. */
type Placing = { after?: string | null; before?: string | null; parent?: string | null; list?: string | null; cell?: string | null };
type ImportOptions = Placing & { copy?: boolean; bus?: string | null; busOf?: Record<string, string | null>; more?: Record<string, { loop: boolean }> };
interface Commands {
  // transport
  go: { list?: string | null };
  panic: { hard?: boolean };
  reset: {};
  pause: {}; resume: {}; toggle: {};
  stop: { fade?: boolean };
  'playlist-next': { id: string };
  fadeall: { secs?: number };
  playhead: { id: string | null };
  move: { step: number };
  sequence: { step: number };
  release: {};
  list: { name: string };
  jump: { number: string };
  load: { secs?: number };
  seek: { id: string; t: number; on?: Bar };
  fadeto: { id: string; t: number; secs?: number; on?: Bar };
  prepare: { id: string };
  'mark-here': { id: string };
  arm: { id: string };
  launch: {};
  'live-set': { key: string; value: unknown };
  'launch-q': { q: string };
  'tempo-find': { ids?: string[] | null; again?: boolean };
  'tempo-edit': { id: string; edit: Parameters<typeof editTempo>[1] & { do?: string } };
  'tempo-of': { file?: string };
  fire: {};
  start: {};
  loop: { id: string; region?: Parameters<CueEngine['toggleHold']>[1]; free?: boolean };
  hold: {};
  lights: { on: boolean };
  mode: { mode: string };
  // editing
  edit: { ops: Parameters<ShowDocument['edit']>[0]; label?: string };
  'clip-copy': { ids: string[]; cut?: boolean };
  'clip-info': {};
  'clip-paste': { after?: string; before?: string; parent?: string };
  'clip-props': { ids: string[]; keys: string[] };
  retarget: { id: string; path: string };
  template: { type?: string; clear?: boolean };
  undo: {}; redo: {};
  import: ImportOptions & { paths: string[] };
  // the mixer and the Live view's desk
  bus: { name: string; db: number; commit?: boolean };
  strip: { name: string; key: string; value: unknown; commit?: boolean };
  crossfader: { value: number; commit?: boolean };
  solo: { name?: string | null; on?: boolean; only?: boolean };
  'desk-live': { key: string; value: unknown; name?: string };
  mute: { name: string };
  'stop-track': { name: string };
  'stop-clips': {};
  'map-in': { on: string };
  'map-set': { on: string | null; to: string };
  'map-learn': { to: string; ms?: number };
  'map-learn-cancel': {};
  'desk-keep': { levels?: boolean; name?: string };
  level: { id: string; db: number };
  master: { db: number; commit?: boolean };
  device: { id: string; label?: string };
  'fade-from-target': {};
  'revert-fade': {};
  // the network and MIDI
  'net-test': { patch: string; text?: string };
  'net-send': { patch?: string | null; text: string };
  'net-monitor': { since?: number };
  'net-clear': {};
  'osc-learn': { ms?: number };
  'osc-learn-cancel': {};
  'hold-all': {};
  record: { on?: boolean };
  relink: { dir: string };
  'midi-send': { text: string };
  'midi-learn': { ms?: number };
  'midi-learn-cancel': {};
  'media-unused': {};
  'media-clean': {};
  peaks: { file: string; detail?: boolean };
  // versions
  versions: {};
  save: { note?: string };
  'save-version': { note?: string };
  revert: {};
  unset: { path: string };
  'compare-version': { id: string; other?: string | null };
  'restore-version': { id: string };
  // proposals, the assistant, pointing
  accept: { id?: string | null };
  reject: { id?: string | null };
  ask: { text: string };
  point: { target: string; cue?: string | null; say?: string };
  pointed: { id: number; ok?: boolean; why?: string; instead?: string };
  'assistant-reset': {};
  'assistant-config': { config?: Record<string, unknown> };
  'turn-on': {};
  override: { what: string; on?: boolean };
  backups: {};
  'backup-now': {};
  'restore-backup': { name: string };
  'run-from': { preview?: boolean };
  check: {};
  'log-tail': { since?: number };
  playlog: { last?: number };
  'settings-import': { file: Parameters<typeof showTemplates.settingsOps>[0] };
  'prop-files': { device: string; options?: Record<string, unknown> };
  'agent-guide': {};
  'import-seen': {}; 'added-seen': {};
  'ducking-by-kind': {};
  state: {};
}
/** A command of the host's own, by its op. */
type OwnCommand = { [K in keyof Commands]: { op: K } & Omit<CueNamed, keyof Commands[K]> & Commands[K] }[keyof Commands];
/** The Lights view's commands (core/light/lighting.js `cmd`). */
type LightCommand = Omit<LightCmd, 'op'> & { op: `light-${string}` };
/** Every command `cmd` takes: the window's, OSC control's, the web remote's, the modules' and the menus'. */
export type HostCommand = OwnCommand | ((StageCommand | RigCommand | LightCommand) & CueNamed);
export type HostOp = HostCommand['op'];
/** What a command answers: `{ error }` when it is refused, otherwise what that op says (an IPC payload to the window). */
export type HostResult = { error?: string; [field: string]: any };
/** The ops whose answer may come later: they wait for the audio window, a device, a person or a model (a refusal comes at once). */
type LaterOp = 'tempo-find' | 'map-learn' | 'osc-learn' | 'midi-learn' | 'media-clean' | 'ask' | 'device-ask' | 'rig-check' | 'import' | 'point' | 'rig-scan';
/** What the audio window says (app/audio/audio.ts `report`), by `type`. */
export type AudioEvent =
  | { type: 'ready' }
  | { type: 'duration'; file: string; secs: number }
  | { type: 'mode'; key: string; exact: boolean }
  | { type: 'decoded'; file: string; secs?: number; error?: string }
  | { type: 'ir'; file: string; secs?: number; error?: string }
  | { type: 'missing'; file: string }
  | { type: 'ended'; key: string }
  | { type: 'where'; key: string; t: number; at: number }
  | { type: 'error'; key: string; detail?: string; url?: string }
  | { type: 'devices'; list: AudioDevice[]; inputs?: unknown[]; current?: string }
  | { type: 'sink'; id: string; ok: boolean; detail?: string; fallback?: boolean }
  | { type: 'outputs'; channels: number }
  | { type: 'outch'; ch?: number[] }
  | { type: 'midi-ports'; inputs?: string[]; outputs?: string[]; error?: string }
  | { type: 'midi-in'; bytes: number[]; port?: string; at?: number }
  | { type: 'tc-in'; frame: Parameters<Transport['ltcIn']>[0]; at?: number }
  | { type: 'ltc'; ok: boolean; key?: string; detail?: string }
  | { type: 'ltc-in'; ok: boolean; detail?: string }
  | { type: 'rec'; rate: number; at?: number; pcm: ArrayBufferView }
  | { type: 'recording'; rate: number }
  | { type: 'operror'; op: string; key?: string; detail?: string }
  | { type: 'ctx'; state?: string; error?: unknown }
  | { type: 'level'; monitor?: number | null; db?: number; channels: Meter[] | null; buses: Record<string, number>; outs?: number[]; ducking?: boolean; ducked?: string[]; limiting?: boolean; voices: number; cues?: Record<string, number> }
  | { type: 'pcm'; file: string; samples: Float32Array; rate: number; error?: undefined }
  | { type: 'pcm'; file: string; samples: null; rate?: number; error: string }
  | { type: 'peaks'; file: string; bins?: number; peaks?: number[] | null; rms?: number[] }
  | { type: 'monitor'; on?: boolean; wanted?: boolean; out?: number; channels?: number; detail?: string };
/** One output channel's meter: its peak and its loudness, in dB. */
export interface Meter { peak: number; rms: number }
/** An output the audio window can play to. */
export interface AudioDevice { id: string; label?: string }
/** What the host tells the audio window (app/audio/audio.ts `onCmd`), by `op`. */
export interface AudioCommand { op: string; [field: string]: unknown }
type Transport = ReturnType<typeof createTransport>;
type Assistant = ReturnType<typeof createAssistant>;
/** A waveform: its slices' peaks, and their loudness when it was read here. */
interface Peaks { peaks: number[]; rms: number[] | null }
/** What was found of a sound's tempo (null: no steady pulse, or it could not be read). */
type Found = ReturnType<typeof tempoMap> | null;
/** Someone waiting for the next message to arrive (a MIDI or OSC "learn"), with the timer that gives up on it. */
interface Learner<T> { resolve: (v: T | null) => void; timer: ReturnType<typeof setTimeout> }
/** What the host knows of the running app, apart from the show: the audio window's reports, the mode, what was said. */
interface HostRun {
  audioReady: boolean; devices: AudioDevice[]; device: string; deviceOk: boolean; deviceDetail: string;
  level: Meter[] | null; busPeaks: Record<string, number>; limiting: boolean;
  mode: string; notice: { text: string; at: number; until: number } | null; muted: boolean; launchQ: string;
  outputs: number;
  midi: { inputs: string[]; outputs: string[]; error: string };
  inputs?: unknown[]; outPeaks?: number[]; outCh?: number[]; channels?: Record<string, number>;
  ducking?: boolean; ducked?: string[]; duckOn?: boolean; voices?: number; cuePeaks?: Record<string, number>;
  monitorPeak?: number | null; monitor?: { on: boolean; wanted: boolean; out: number };
  ltcIn?: string;
  imported?: ImportReport | null;
  added?: { at: number; items: { id: string; name: string; kind: string | null; why: string; bus: string; loop: boolean; template: boolean }[] } | null;
  point?: (PointAt & { id: number; at: number }) | null;
}
/** What came across from another program's file (core/import/qlab.js `report`). */
type ImportReport = ReturnType<typeof importQlab>['report'];
/** What `cmd(c)` returns for that command. */
export type ResultOf<C extends { op: string }> = C extends { op: LaterOp } ? HostResult | Promise<HostResult> : HostResult;

// ── modules (app/main/modules/*.js): each is { id, name, summary, fields, create } ──
type Hub = ReturnType<typeof createHub>;
/** A place in the window to ring (core/ui/places.js), with what is said beside it and the cue it is about. */
export type PointAt = Place & { say?: string; cue?: string | null };
/** The window's answer to a place pointed at: rung, or why not (and what it did instead). */
interface Pointed { ok: boolean; why: string; instead?: string }
/** A sound the engine is playing, as `active()` lists it (with its loop regions held and armed). */
type ActiveSound = Extract<ReturnType<CueEngine['active']>[number], { holding: unknown }>;
/** A pending change (core/show/diff.js), whichever kind it is. */
type AnyChange = { kind: string; id?: string; path?: string; label?: string; from?: unknown; to?: unknown; count?: number; fields?: FieldChange[] };
/** A row of the cue list as the window draws it. */
export interface Row { id: string; depth: number; parent: string | null; type: string; number: string; name: string; notes: string; color: string }
/** A cue as the window is sent it: without its beat grid (`beats`, `downbeats`: the engine's business), saying whether it has one. */
export type ViewCue = Cue & { hasGrid?: boolean; children?: ViewCue[] };
/** The show as the window is sent it. */
export type ViewDoc = Omit<ShowDoc, 'lists'> & { lists: (Omit<CueList, 'cues'> & { cues: ViewCue[] })[] };
/** A bus of the show's mixer. */
type Bus = ShowDoc['settings']['audio']['buses'][number];
/** One change to the show (core/show/ops.js), as `document.edit` takes them. */
type EditOp = Parameters<ShowDocument['edit']>[0][number];
/** What the modules are given of the host (`host` in each module's `create`). */
export interface HostApi {
  cmd: <C extends HostCommand>(c: C) => ResultOf<C>;
  snapshot: (full?: boolean) => HostState;
  notice: (text: string, ms?: number) => void;
  showId: () => string;
  remoteKey: () => string;
  /** told after each state push; returns how to stop being told */
  onPush: (fn: () => void) => () => void;
  /** told each command once it is done */
  onCmd: (fn: CmdListener) => () => void;
  supports: (what: string) => boolean;
}
type CmdListener = (c: HostCommand, result: HostResult | Promise<HostResult>) => void;
/** Where the playhead was before a command, and is after it (a module that follows what is done: backup-link). */
export interface Playhead { playhead: string | null }
/** One of a module's settings, as Settings ▸ Integrations draws it. */
export interface ModuleField { key: string; label: string; kind: string; options?: readonly string[]; placeholder?: string; [more: string]: unknown }
/** How a module is doing, as its row says it: the web remote's addresses (`urls`), a desk's steps to set it up (`setup`). */
export interface ModuleStatus { ok: boolean; text: string; urls?: string[]; setup?: string }
/** What a module is made with. */
export interface ModuleContext { log: (line: string) => void; changed: () => void; host: HostApi; net: Hub; failed: (id: string, why: string) => void }
/** A module's settings, from the show's `modules` (each module reads its own fields). */
export type ModuleConfig = Record<string, any> & { enabled?: boolean };
/** A module started for the open show. */
export interface ModuleInstance {
  start(config: ModuleConfig): void;
  stop(): void;
  status(): ModuleStatus;
  onState?(): void;
  onCommand?(c: HostCommand, result: HostResult | Promise<HostResult>, before: Playhead, after: Playhead): void;
  /** the lighting desk: a Light cue to fire; why it could not be (or null) */
  onLight?(cue: EngineCue): string | null | undefined;
}
export interface ModuleDef {
  id: string; name: string; summary: string; details?: string; needsInput?: boolean;
  fields: readonly ModuleField[];
  /** the lighting desk's kinds of desk (a patch whose `device` is one of these is the desk's address) */
  KINDS?: Record<string, { label: string }>;
  create(o: ModuleContext): ModuleInstance;
}

export interface HostOptions {
  BrowserWindow: typeof Win;
  ipcMain: IpcMain;
  getConfig: () => AppConfig;
  saveConfig: (change: Partial<AppConfig>) => void;
  log: (line: string) => void;
  smoke?: boolean;
  net?: boolean;
  assistant?: Assistant | null;
  trash?: ((file: string) => Promise<void>) | null;
  screen?: Screen | null;
  userDir?: string | null;
}

function createHost({ BrowserWindow, ipcMain, getConfig, saveConfig, log, smoke = false, net = false, assistant = null, trash = null, screen = null, userDir = null }: HostOptions) {
  let document = new ShowDocument();
  let clip: ReturnType<typeof clipboard.take> | null = null;     // the cue clipboard: kept here, not with the show, so a paste can land in another show
  let rev = 0;                      // bumps whenever the document changes
  let audioWin: Win | null = null;
  let pushPending = false;
  let ticker: ReturnType<typeof setInterval> | undefined;
  // ── the show log (core/log/show-log.js): what happened as the show ran, in the show's logs folder, one file a sitting ──
  const showLog = new ShowLog({ version: require('../../package.json').version });
  let goFrom = '', startFrom = '';  // who sent the GO, or what started a cue, while the engine is told (its own GO and START lines carry it)
  const FROM: Record<string, string> = { osc: 'OSC control', 'osc-command': 'an OSC show command', 'web-remote': 'the web remote', midi: 'a MIDI show command', msc: 'MIDI Show Control', backup: 'the main computer', hotkey: 'its hotkey', cart: 'the cart', assistant: 'the assistant', remote: 'a remote' };
  const fromText = (f?: string) => (f ? FROM[f] || String(f) : 'this window');
  // double-GO protection, whichever way a GO or a trigger arrives (core/engine/go-guard.js)
  const goGuard = createGoGuard({ now: () => Date.now(), secs: () => document.doc.settings.go.doubleGoProtection });
  /** A cue started by something other than GO (its trigger, a cart, a remote): the same trigger again within the
   *  double-GO time is a bounce, and ignored. `how`: what started it, said in the log ("OSC /sm/thunder"). */
  function startBy(id: string, how: string, key = how) {
    const c = engine.byId.get(id);
    if (!c) return false;
    if (!goGuard.trigger(`${key} · ${id}`, how)) { showLog.add('ignored', `${how} for ${c.number || c.name || id} again within ${document.doc.settings.go.doubleGoProtection} s: not started`, { cue: c.number }); return false; }
    startFrom = how;
    try { engine.start(id); } finally { startFrom = ''; }
    return true;
  }
  /** Each of the engine's lines, as the show log has it. */
  function engineLine(l: string) {
    const t = String(l).trim();
    if (/^GO /.test(t)) return showLog.add('go', `${t}${goFrom ? ` · from ${goFrom}` : ''}`);
    if (/^START /.test(t)) return showLog.add(startFrom ? 'trigger' : 'cue', `${t}${startFrom ? ` · by ${startFrom}` : ''}`);
    if (/^MISSING FILE/.test(t)) return showLog.add('error', t);
    if (/^STOPPED a loop|: no track|cannot|not a place|could not/i.test(t)) return showLog.add('warning', t);
    return showLog.add('cue', t);
  }
  const nameOf = (key: string) => { const c = engine.byId.get(key); return c ? `${c.number ? `${c.number} ` : ''}${c.name || c.id}` : String(key); };
  const dbText = (d: unknown) => (Number(d) <= -60 ? 'silence' : `${Number(d) > 0 ? '+' : ''}${Math.round(Number(d) * 10) / 10} dB`);
  const liveBus = new Map<string, number>();        // bus -> the level a Mix cue has taken it to (until Reset, or a hand on its knob)
  const tempos = new Map<string, Found>();         // file -> what was found in it: { bpm, first, confidence, others } | null (kept in a cue only when asked)
  const tempoWaits = new Map<string, ((found: Found) => void)[]>();     // file -> the callers waiting for its sound to come back from the audio window
  const launches = new Map<string, { at: number; timer: ReturnType<typeof setTimeout> }>();       // cue id -> { at, timer }: a clip launched in the Live view, waiting for the beat or the bar
  // the desk as it is played, over the show's: strip settings a Mix cue recalled or a controller moved (until Reset,
  // or a hand on that control), the crossfader and the master likewise
  const liveStrip = new Map<string, Record<string, unknown>>();      // bus -> { 'eq.low': …, pan: …, … }
  let liveXf: number | undefined, liveMaster: number | undefined;
  let mapLearner: Learner<string> | null = null;            // the Live view's Map mode waiting for a MIDI control to give to a desk control
  const solo = new Set<string>();           // buses soloed in the Live view: the operator's ear, never the show's (gone when a show is opened)
  // every OSC message in or out goes through the hub: one monitor, and each patch knows how it is doing
  const hub = createHub({ log: (l) => log(`[network] ${l}`), changed: () => schedulePush(), dryRun: smoke && !net });
  let triggers: ReturnType<typeof oscTriggers> = [];                // [{ id, address, args }]: cues an incoming OSC message fires
  let learning = false;             // waiting for a message to learn a trigger from: the input port is open meanwhile
  const views = new Set<WebContents>();          // webContents that are sent the state
  const sentRev = new Map<WebContents, number>();        // view -> the document revision it was last sent in full
  const peaks = new Map<string, Peaks | 'pending' | null>();          // file -> { peaks, rms } | 'pending' | null
  const state: HostRun = {
    audioReady: false, devices: [], device: 'default', deviceOk: true, deviceDetail: '',
    level: null, busPeaks: {}, limiting: false,
    mode: 'edit', notice: null, muted: !!smoke, launchQ: 'bar',
    outputs: 2,                      // how many outputs the device has (a bus can be sent to a pair of them)
    midi: { inputs: [], outputs: [], error: '' },
  };
  const lightFails = new Map<string, string>();     // light cue id -> why its last GO did not reach the desk
  const lastLoad = new Map<string, number>();       // cue id -> the time it was last loaded to (Load to Time offers it again)
  const probeWaits = new Map<string, (secs: number) => void>();     // a file being measured before it is added -> its resolver
  const listeners = new Set<() => void>();

  // Where a sound goes when not to its bus's pair (core/audio/routing.js): the cue's own outputs and eq, or, for a
  // cue being auditioned (V) in a show that has an audition pair, that pair.
  const audition = new routing.Audition();
  let lostFor = '', lostNow: ReturnType<typeof routing.lost> = [];
  function ownOf(key: string) {
    const c: Partial<EngineCue> = engine.byId.get(key) || {};
    const own: { eq?: unknown; chain?: unknown; audition?: unknown; outputs?: unknown } = {};
    if (c.eq) own.eq = c.eq;
    // its sound design (core/audio/chain.js): the chain, and the bytes of its reverb's impulse response if it names one
    if (c.chain) { own.chain = c.chain; sendIr(c.chain); }
    designSent.set(key, JSON.stringify([c.chain || null, c.eq || null]));
    if (audition.take(key)) own.audition = routing.settingsOf(document.doc.settings.audio).audition;
    if (!own.audition && c.outputs) own.outputs = c.outputs;
    return Object.keys(own).length ? own : undefined;
  }
  // ── sound design and the kinds of sound ──
  const guessWanted = new Set<string>();    // files being added with "sort new sounds by kind" on: only these are guessed at
  const kindGuess = new Map<string, ReturnType<typeof kinds.guessKind>>();      // a file that has been listened to -> { kind, why, features } (core/audio/kinds.js)
  const designSent = new Map<string, string>();     // a playing sound -> the chain and eq it was last told (an edit to either is heard at once)
  const irSent = new Set<string>();         // impulse-response files the audio window has been given
  /** A reverb that names an impulse-response file: its bytes to the audio window, once. */
  function sendIr(chain: Cue['chain']) {
    const file = chain && chain.reverb && chain.reverb.file;
    if (!file || irSent.has(file)) return;
    irSent.add(file);
    const abs = playPath(file);
    fs.readFile(abs || '', (err, bytes) => {
      if (err) { irSent.delete(file); log(`[audio] impulse response ${file}: ${err.message}`); notice(`Could not read the impulse response ${file}: using the built-in room.`, 7000); return; }
      audioCmd({ op: 'ir', file, bytes });
    });
  }
  /** After an edit: a playing sound whose chain or eq changed is told, so the change is heard at once. */
  function sendDesigns() {
    for (const key of [...designSent.keys()]) if (!engine.running.has(key)) designSent.delete(key);
    for (const key of engine.running.keys()) {
      const c: Partial<EngineCue> = engine.byId.get(key) || {};
      const now = JSON.stringify([c.chain || null, c.eq || null]);
      if (!designSent.has(key) || designSent.get(key) === now) continue;
      designSent.set(key, now);
      sendIr(c.chain);
      audioCmd({ op: 'design', key, chain: c.chain || null, eq: c.eq || null });
    }
    // its lines (the envelope, its pan and its automation: core/audio/lanes.js), drawn while it plays: heard at once
    for (const key of [...lanesSent.keys()]) if (!engine.running.has(key)) lanesSent.delete(key);
    for (const key of engine.running.keys()) {
      const c: Partial<EngineCue> = engine.byId.get(key) || {}, now = lanesKey(c);
      if (!lanesSent.has(key) || lanesSent.get(key) === now) continue;
      lanesSent.set(key, now);
      audioCmd({ op: 'lanes', key, envelope: c.envelope || null, pan: Number(c.pan) || 0, automation: c.automation || null });
    }
  }
  const lanesSent = new Map<string, string>();      // a playing sound -> its lines as it was last told them
  const lanesKey = (c: Partial<EngineCue> | undefined) => JSON.stringify([(c && c.envelope) || null, Number(c && c.pan) || 0, (c && c.automation) || null]);
  /** Where the speech is in a recorded voice, for the ducker to dip the music ahead of it: only for a sound on a
   *  bus the ducker listens to, and only once its waveform has been read (until then the ducker hears its level,
   *  as it does a microphone's). */
  const speechOf = new Map<string, ReturnType<typeof kinds.speechSpans>>();       // file -> [[from, to], …]
  function speechFor(key: string, file: string | undefined) {
    const c: Partial<EngineCue> = engine.byId.get(key) || {};
    if (!file || c.picture || !duckKeys.has(c.bus ?? '')) return undefined;
    if (speechOf.has(file)) return speechOf.get(file);
    const p = peaksFor(file, true), secs = engine.durations.get(file) ?? 0;
    if (!p || p === 'pending' || !p.rms || !(secs > 0)) return undefined;
    const spans = kinds.speechSpans(p.rms, secs);
    speechOf.set(file, spans);
    return spans;
  }
  let duckKeys = new Set<string>();         // the buses ducking by kind listens to (empty with it off, and for the older pair)
  /** The waveforms of the recorded voices, read ahead of their GO (a WAV is read here; anything else by the audio window). */
  function readVoices() {
    if (!duckKeys.size) return;
    show.walk(document.doc, (c) => { if (c.type === 'audio' && c.file && duckKeys.has(engine.byId.get(c.id)?.bus ?? '') && !speechOf.has(c.file) && state.audioReady) { try { peaksFor(c.file, true); } catch { /* read at its GO instead */ } } });
  }
  /** What this device cannot play of the show's routing (silent, and said), worked out once per change. */
  function lost() {
    const key = `${rev}:${state.outputs}`;
    if (key !== lostFor) { lostFor = key; lostNow = routing.lost(document.doc, state.outputs); }
    return lostNow;
  }
  const audioCmd = (cmd: AudioCommand | LtcCmd) => { if (audioWin && !audioWin.isDestroyed() && state.audioReady) audioWin.webContents.send('audio-cmd', cmd); };
  // The file the sound is read from: the show's own, but for AIFF and CAF (which Chromium cannot read), a WAV copy
  // of the same samples made beside the system's temporary files (core/audio/pcm-container.js).
  const copyFails = new Map<string, string>();      // a file that could not be copied -> why (said once)
  function playPath(file: string | undefined) {
    const abs = document.resolveFile(file);
    if (!abs || copyFails.has(abs)) return abs;
    try { return wavCopyOf(abs, path.join(os.tmpdir(), 'endless-cues-audio')); }
    catch (err) { copyFails.set(abs, (err as Error).message); log(`[audio] ${file}: ${(err as Error).message}`); return abs; }
  }
  const fileUrl = (file: string | undefined) => { const abs = playPath(file); return abs ? pathToFileURL(abs).href : ''; };

  // ── the engine ────────────────────────────────────────────────────────
  const engine = new CueEngine({
    audio: {
      play: (key, o) => { showLog.add('cue', `▶ ${nameOf(key)} plays${o.mic ? ' (a microphone)' : o.file ? ` (${path.basename(String(o.file))})` : ''}${o.from! > 0 ? ` from ${Math.round(o.from! * 10) / 10} s` : ''} at ${dbText(o.gainDb)}${o.loop ? ', looping' : ''}`, { cue: (engine.byId.get(key) || {}).number }); lightFails.delete(key); if (!o.mic) { const c: Partial<EngineCue> = engine.byId.get(key) || {}; playlog.started(key, { file: o.file, number: c.number, name: c.name, mode: state.mode }); } const own = ownOf(key); lanesSent.set(key, lanesKey(engine.byId.get(key))); audioCmd(o.mic ? { op: 'play', key, mic: o.mic, gainDb: o.gainDb, bus: o.bus, own, pan: o.pan } : { op: 'play', key, url: fileUrl(o.file), gainDb: o.gainDb, from: o.from, loop: o.loop, exact: o.exact, bus: o.bus, own, rate: o.rate, preservePitch: o.preservePitch, envelope: o.envelope, pan: o.pan, automation: o.automation, speech: own && own.audition ? undefined : speechFor(key, o.file) }); },
      move: (key, o) => audioCmd({ op: 'move', key, ...o }),
      // (a fade's shape goes to the audio window as numbers: how far along it is at 65 evenly spaced moments)
      fade: (key, db, secs, range, shape, from) => (showLog.add('cue', `◢ ${nameOf(key)} ${range === 'voice' ? 'voice band ' : ''}to ${dbText(db)}${secs > 0 ? ` over ${Math.round(secs * 100) / 100} s` : ''}`, { cue: (engine.byId.get(key) || {}).number }), audioCmd({ op: 'fade', key, db, secs, range, ...(shape ? { shape: progressOf(shape, 65, from) } : {}) })),
      rate: (key, rate, secs) => audioCmd({ op: 'rate', key, rate, secs }),
      // (a Fade cue's `chainTo`: settings of the sound's design, moved over the fade's time)
      sweep: (key, to, secs) => audioCmd({ op: 'sweep', key, to, secs }),
      stop: (key) => { showLog.add('cue', `■ ${nameOf(key)} stops`, { cue: (engine.byId.get(key) || {}).number }); playlog.ended(key); audioCmd({ op: 'stop', key }); },
      pause: (key) => { playlog.paused(key); audioCmd({ op: 'pause', key }); },
      resume: (key) => { playlog.resumed(key); audioCmd({ op: 'resume', key }); },
      seek: (key, t) => audioCmd({ op: 'seek', key, t }),
      cut: (key, at) => audioCmd({ op: 'cut', key, at }),
      setLoop: (key, on) => audioCmd({ op: 'loop', key, on }),
      setRegion: (key, start, end) => audioCmd({ op: 'region', key, start, end }),
      // (a cue that ducks the others while it runs: a gain of its own on each sound, apart from its level)
      duck: (key, db, secs) => audioCmd({ op: 'others', key, db, secs }),
    },
    send: sendNetwork,
    // a warped sound plays at the desk's tempo (settings.live.tempo, or the tempo of the music playing)
    warp: (cue, from) => (cue.warp && cue.tempo ? { rate: warpRate(cue.tempo, deskTempo(), from), keepPitch: cue.warp === 'keep' } : null),
    mix: (cue) => {
      const secs = Number(cue.duration) || 0;
      for (const [bus, db] of Object.entries(cue.levels || {})) { audioCmd({ op: 'bus', name: bus, db, secs }); liveBus.set(bus, Number(db) || 0); }
      // a desk kept in the cue: every strip of the buses it names, and the crossfader, glide to where it has them
      if (cue.desk) {
        const r = recallOf(cue.desk);
        for (const [bus, set] of Object.entries(r.buses)) liveStrip.set(bus, set);
        if (r.crossfader !== undefined) liveXf = r.crossfader;
        sendStrips(null, secs);
      }
    },
    lights: (cue) => {
      const m = running.get('lighting-desk');
      lightFails.delete(cue.id);
      // (the desk is reached by OSC: with OSC out held back, the cue is called and nothing is sent)
      if (overrides.osc && m && m.onLight) { hub.record({ dir: 'out', who: 'Lighting desk', patch: null, text: `LQ ${cue.lightCue || ''}`, ok: false, held: true, why: HELD('OSC out'), label: `${cue.number || ''} ${cue.name || ''}`.trim() }); return; }
      const why = m && m.onLight ? m.onLight(cue) : null;
      if (why) lightFailed(cue.id, why);
    },
    midi: (cue) => sendMidi(cue.midi, { label: `${cue.number || ''} ${cue.name || ''}`.trim(), secs: Number(cue.duration) || 0 }),
    run: (cue, offset) => transport.run(cue, offset),
    // A cue that throws when it fires is logged, never an uncaught exception in main.
    clock: { now: () => performance.now() / 1000, clearTimeout,
             setTimeout: (fn, ms) => setTimeout(() => { try { fn(); } catch (err) { log(`[engine] ${(err as Error).stack || err}`); } }, ms) },
    log: (l) => { log(`[cues] ${l}`); engineLine(l); },
  });
  // ── overrides: outputs held back for a rehearsal (this computer's choice, kept through a restart, and always shown) ──
  const HELD = (what: string) => `held back: ${what} is switched off for rehearsal (Tools ▸ Hold Back, or the chip in the title bar)`;
  const overrides = Object.fromEntries(OVERRIDES.map((o) => [o.id, !!(((getConfig() || {}).overrides || {})[o.id])]));
  // ── a show from another computer (core/show/trust.js): its network features are held back until a person turns them on ──
  let away = false;
  const AWAY = 'held back: this show came from another computer, and its network features are off until you turn them on';
  const heldNet = () => (overrides.osc ? HELD('OSC out') : away ? AWAY : '');
  hub.hold(heldNet());
  // the rig: the show's devices, whether each is there, and the readiness check (app/main/rig-service.js)
  const rig = createRig({ hub, state, engine, overrides, HELD, held: heldNet, away: () => (away ? AWAY : ''), smoke, net, log: (l) => log(`[rig] ${l}`), notice: (t, ms) => notice(t, ms), changed: () => schedulePush(), cmd: (c) => cmd(c),
    document: () => document, facts: () => rigFacts(), sendMidi: (text, o) => sendMidi(text, o) });
  const isMtc = (b: ArrayLike<number>) => b[0] === 0xf1 || (b[0] === 0xf0 && b[1] === 0x7f && b[3] === 0x01);      // a quarter frame, or a full-frame message
  const ltcRuns = new Map<string, LtcCmd>();        // Timecode cue id -> the command that started its LTC
  let heldSaid = 0;
  // ── the playback log: every sound that played, written down as it ends (core/engine/playlog.js) ──
  const playlogFile = () => (document.showDir ? path.join(document.showDir, 'logs', 'playback.csv') : null);
  const playlog = new PlayLog({ onEntry: (e) => {
    const file = playlogFile();
    if (!file) return;                // an untitled show: kept in memory, and exported from there
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); if (!fs.existsSync(file)) fs.writeFileSync(file, CSV_HEAD + '\n'); fs.appendFileSync(file, csvLine(e) + '\n'); } catch (err) { log(`[playlog] ${(err as Error).message}`); }
  } });
  engine.skipLights = !!(getConfig() || {}).skipLights;
  // The stage (the output window for Video, Text and Camera cues): app/main/stage.js. The engine tells it what to show.
  const stage = createStage({ BrowserWindow, screen, ipcMain, getConfig, saveConfig, log, test: smoke, engine, fileUrl, audioCmd: (c) => audioCmd(c), notice: (t, ms) => notice(t, ms), changed: () => schedulePush(),
    operatorWindow: () => { for (const wc of views) { const w = !wc.isDestroyed() && BrowserWindow.fromWebContents(wc); if (w) return w; } return null; } });
  engine.video = stage.hooks;
  // the app's own lights: the patch, the levels, DMX out. A test run makes every packet and sends none.
  const lighting = createLighting({ log: (l) => log(`[light] ${l}`), changed: () => schedulePush(), dryRun: smoke && !net });
  lighting.attach(engine);
  if (overrides.dmx) lighting.hold(true);
  /** What goes out, held or let go: OSC (and the devices) and DMX, for a rehearsal or for a show from elsewhere. */
  function holdOut() { hub.hold(heldNet()); lighting.hold(!!overrides.dmx || away); }
  engine.on('change', () => { schedulePush(); decodeAhead(); });

  // ── timecode and MIDI files: played out against the engine's clock (core/timecode/transport.js) ──
  // MIDI that must leave on time is handed to the audio window stamped with when it is due, as a time both
  // processes share (their clocks agree to within half a millisecond, measured); LTC is made there, as sound.
  // The engine's clock (performance.now()) as the wall clock's milliseconds, which is what this process and the audio
  // window share, and back. The two steady clocks can part (a computer that sleeps: Node's counts the sleep,
  // Chromium's does not), so each side keeps how far its own is from the wall and takes it up again when it has
  // moved by more than a frame's worth (the audio window says the rest, beside its own copy of this).
  let wallOff = Date.now() - (performance.timeOrigin + performance.now());
  const wallTimer = setInterval(() => { const o = Date.now() - (performance.timeOrigin + performance.now()); if (Math.abs(o - wallOff) > 20) wallOff = o; }, 1000);
  if (wallTimer.unref) wallTimer.unref();
  const epochOf = (secs: number) => performance.timeOrigin + secs * 1000 + wallOff;
  const clockOf = (epoch?: number) => (Number.isFinite(epoch) ? (epoch! - performance.timeOrigin - wallOff) / 1000 : performance.now() / 1000);
  const played: PlayoutMessage[] = [];                // the last MIDI handed over to be sent on time: { id, at, bytes } (a test run sends none of it, and reads this)
  const midiFiles = new Map<string, number>();      // a MIDI File cue's file -> its length in seconds (0: it cannot be read)
  const transport = createTransport({
    engine, now: () => performance.now() / 1000,
    every: (fn, ms) => { const t = setInterval(() => { try { fn(); } catch (err) { log(`[timecode] ${(err as Error).stack || err}`); } }, ms); return () => clearInterval(t); },
    sendMidi: (events) => {
      if (!events.length) return;
      // held back for a rehearsal: MIDI out holds everything on its way to the port (a MIDI file's notes, MTC);
      // Timecode out holds MTC alone. Said in the monitor once a second at most (MTC is 120 messages a second).
      if (overrides.midi || overrides.timecode) {
        const kept = overrides.midi ? [] : events.filter((e) => !isMtc(e.bytes));
        if (kept.length < events.length && Date.now() - heldSaid > 1000) { heldSaid = Date.now(); const mtc = events.some((e) => isMtc(e.bytes)); hub.record({ dir: 'out', who: 'MIDI', patch: null, via: 'midi', text: mtc ? 'MTC' : 'a MIDI file’s messages', ok: false, held: true, why: HELD(overrides.midi ? 'MIDI out' : 'Timecode out') }); }
        events = kept;
        if (!events.length) return;
      }
      played.push(...events); if (played.length > 4000) played.splice(0, played.length - 4000);
      if (!smoke) audioCmd({ op: 'midi', port: String((document.doc.settings.midi || {}).output || ''), events: events.map((e) => ({ bytes: e.bytes, at: epochOf(e.at) })) });
    },
    // (LTC: what is running is remembered, so that holding timecode back stops it and letting it go starts it where it would be)
    audio: (c) => {
      const out = c.at != null ? { ...c, at: epochOf(c.at) } : c;
      if (c.op === 'ltc') {
        if (c.on) ltcRuns.set(c.key, out); else ltcRuns.delete(c.key);
        if (c.on && overrides.timecode) { hub.record({ dir: 'out', who: 'Audio', patch: null, text: 'LTC', ok: false, held: true, why: HELD('Timecode out') }); return; }
      }
      audioCmd(out);
    },
    record: (e) => hub.record(e), log: (l) => log(`[timecode] ${l}`), notice: (text, ms) => notice(text, ms),
    read: (file) => { const abs = document.resolveFile(file); if (!abs) throw new Error('its file is missing'); return fs.readFileSync(abs); },
    midiWhyNot: () => {
      const port = String((document.doc.settings.midi || {}).output || '');
      if (smoke) return '';          // a test run records it and touches no port
      if (!state.midi.outputs.length) return state.midi.error || 'no MIDI output on this computer';
      return port && !state.midi.outputs.includes(port) ? `the MIDI output “${port}” is not connected` : '';
    },
    // (a show from another computer chases no timecode until it is turned on)
    settings: () => (away ? { ...(document.doc.settings.timecode || {}), source: 'off' } : document.doc.settings.timecode),
  });

  /** A Network cue: one OSC message to its patch (or to a device, which may ask for each command to be sent again: rig-service.js). */
  function sendNetwork(message: string, cue?: EngineCue) {
    rig.send(cue && cue.patch ? cue.patch : null, message, { label: cue ? `${cue.number || ''} ${cue.name || ''}`.trim() : '', format: (cue && cue.format) || 'osc',
      faded: !!cue && (/#[vxy]#/.test(String(cue.message || '')) || Number(cue.duration) > 0) });       // (a value on its way somewhere is never sent twice)
  }
  // an incoming message set to a show command (Settings ▸ Integrations ▸ Network ▸ Incoming OSC) does it, whoever sent it
  hub.onMessage((msg) => {
    const hits = oscCommands.commandsFor(document.doc.settings.network.commands, msg);
    for (const h of hits) { log(`[network] ${msg.address}: ${h.what}`); cmd({ ...h.cmd, from: 'osc-command' } as HostCommand); }
    return hits.length > 0;
  });
  // an incoming message that is a cue's trigger fires that cue (the playhead stays where it is)
  hub.onMessage((msg) => {
    let fired = false;
    for (const id of firedBy(triggers, msg)) {
      if (!engine.byId.has(id)) continue;
      log(`[network] ${msg.address} fires ${id}`);
      startBy(id, `OSC ${msg.address}`);
      fired = true;
    }
    return fired;
  });
  /** An imported QLab 4 cue always has an End at; where it is only the end of its file, it is taken off (once the
   *  file has been measured), so the cue reads as it did in QLab: playing to its end. */
  let endAtFileEnd = new Set<string>();
  function trimEndAt(file: string, secs: number) {
    if (!endAtFileEnd.size || !(secs > 0)) return;
    const ops: EditOp[] = [];
    show.walk(document.doc, (c) => { if (endAtFileEnd.has(c.id) && c.file === file) { endAtFileEnd.delete(c.id); if (Number(c.cutAt) >= secs - 0.06) ops.push({ op: 'cue.set', id: c.id, props: { cutAt: null } }); } });
    if (ops.length) { try { document.edit(ops, { label: 'plays to the end of its file' }); document.undoStack.pop(); } catch (err) { log(`[show] ${(err as Error).message}`); } }
  }

  /** A Light cue that did not reach the desk is marked, on the cue, until it next goes. */
  function lightFailed(id: string, why: string) {
    lightFails.set(id, String(why));
    const c: Partial<EngineCue> = engine.byId.get(id) || {};
    notice(`LQ ${c.lightCue || ''} not sent to the desk: ${why}`, 8000);
  }

  // ── MIDI: sent and heard through the audio window (Web MIDI); every message is in the one monitor ──
  let midiTriggers: { id: string; msg: MidiMessage }[] = [];            // [{ id, msg }]: cues an incoming MIDI message fires
  let midiLearner: Learner<{ text: string; from: string }> | null = null;
  function sendMidi(text: string | undefined, { label = '', secs = 0 }: { label?: string; secs?: number } = {}): MonitorEntry {
    const port = String((document.doc.settings.midi || {}).output || '');
    const entry: MonitorEntry = { dir: 'out', who: port ? `MIDI ${port}` : 'MIDI', patch: null, text: String(text), ok: true, label };
    try {
      const msg = midi.parseText(text);
      const bytes = midi.encode(msg);
      entry.text = `${midi.toText(msg)}   [${midi.hex(bytes)}]`;
      if (overrides.midi) { entry.ok = false; entry.held = true; entry.why = HELD('MIDI out'); hub.record(entry); return entry; }
      if (!smoke) {                 // a test run records it and touches no port
        if (!state.midi.outputs.length) throw new Error(state.midi.error || 'no MIDI output on this computer');
        if (port && !state.midi.outputs.includes(port)) throw new Error(`the MIDI output “${port}” is not connected`);
        audioCmd({ op: 'midi', bytes, port });
      }
      // a note's length: its note off follows
      if (msg.kind === 'note' && secs > 0) setTimeout(() => sendMidi(midi.toText({ ...msg, kind: 'noteoff' }), { label }), secs * 1000);
    } catch (err) { entry.ok = false; entry.why = (err as Error).message; log(`[midi] DROPPED ${text}: ${(err as Error).message}`); }
    hub.record(entry);
    return entry;
  }
  /** A MIDI message arrived: it may be a cue's trigger, or show control from a desk. */
  function midiIn(bytes: number[], port = '', at: number | undefined = undefined) {
    if (!bytes || !bytes.length || bytes[0] >= 0xf8) return;        // clock and active sensing: not the show's business
    if (transport.midiIn(bytes, clockOf(at))) return;               // timecode: chased if the show is set to (120 messages a second are not for the monitor)
    const msg = midi.decode(bytes);
    if (!msg) return;
    hub.record({ dir: 'in', who: `MIDI ${port}`.trim(), patch: null, text: midi.toText(msg), via: 'midi' });
    const mapped = deskMap.onOfMidi(msg);
    // Map mode: the first control moved (or pad struck) is given to the desk control that is waiting for one
    if (mapLearner && mapped && (msg.kind === 'cc' || (mapped.value ?? 0) > 0)) { const l = mapLearner; mapLearner = null; clearTimeout(l.timer); l.resolve(mapped.on); schedulePush(); return; }
    if (midiLearner) { const l = midiLearner; midiLearner = null; clearTimeout(l.timer); l.resolve({ text: midi.toText(msg, { brief: true }), from: port }); schedulePush(); return; }
    if (away) { schedulePush(); return; }      // (a show from another computer: no MIDI trigger, mapping or show command until it is turned on)
    for (const t of midiTriggers) {
      if (!midi.matches(t.msg, msg) || !engine.byId.has(t.id)) continue;
      log(`[midi] ${midi.toText(msg)} fires ${t.id}`);
      startBy(t.id, `MIDI ${midi.toText(msg, { brief: true })}`);
    }
    // the end of a note that is a cue's trigger: its "second trigger on release", if it has one
    if (msg.kind === 'noteoff') for (const t of midiTriggers) if (t.msg.kind === 'note' && midi.matches({ ...t.msg, kind: 'noteoff' }, msg)) engine.released(t.id);
    // a control mapped to the Live view's desk (settings.live.map)
    if (mapped) for (const hit of deskMap.matching((document.doc.settings.live || {}).map, mapped.on)) { const act = deskMap.actionOf(hit.to, { type: msg.kind === 'cc' ? 'cc' : 'note', value: mapped.value }); if (act) cmd(act as HostCommand); }
    const m = document.doc.settings.midi || {};
    // a note or a controller set to run the show (Settings ▸ Integrations ▸ Network ▸ MIDI)
    for (const [what, text] of Object.entries(m.commands || {})) {
      if (!text) continue;
      let want: MidiMessage; try { want = midi.parseText(text); } catch { continue; }
      if (!midi.matches(want, msg)) continue;
      log(`[midi] ${midi.toText(msg)}: ${what}`);
      cmd(what === 'next' ? { op: 'move', step: 1 } : what === 'previous' ? { op: 'move', step: -1 } : { op: what, from: 'midi' } as HostCommand);
    }
    if (msg.kind === 'msc' && m.mscIn && (msg.device === 0x7f || msg.device === Number(m.deviceId))) {
      const cue = msg.cue !== undefined ? show.findByNumber(document.doc, msg.cue) : null;
      log(`[midi] show control: ${midi.toText(msg)}${msg.cue !== undefined && !cue ? ' (no cue with that number)' : ''}`);
      // (a timed go is a go: the time it carries is the desk's fade time, which a cue here has of its own)
      // (a GO naming a cue is still a GO from the desk: double-GO protection covers it as it does any other)
      if (msg.command === 'go' || msg.command === 'timed-go') {
        if (cue) { if (goGuard.go('msc')) { startFrom = fromText('msc'); try { engine.start(cue.id); } finally { startFrom = ''; } } else showLog.add('ignored', `GO from ${fromText('msc')} within ${document.doc.settings.go.doubleGoProtection} s of the last: not done`); }
        else if (msg.cue === undefined) cmd({ op: 'go', from: 'msc' });
      }
      else if (msg.command === 'load') { if (cue) { engine.setPlayhead(engine.topOf(cue.id)); rowsFor = -1; } }      // standing by: the playhead goes to it
      else if (msg.command === 'stop') { if (cue) engine.stopCue(cue.id); else if (msg.cue === undefined) cmd({ op: 'panic' }); }
      else if (msg.command === 'resume') engine.resume(cue ? cue.id : null);
      else if (msg.command === 'all-off') cmd({ op: 'panic' });
      else if (msg.command === 'reset') cmd({ op: 'reset' });
    }
    schedulePush();
  }

  function configureNetwork() {
    const doc = document.doc, n = doc.settings.network;
    midiTriggers = [];
    if (!away) show.walk(doc, (c) => { if (c.midiTrigger) { try { midiTriggers.push({ id: c.id, msg: midi.parseText(c.midiTrigger) }); } catch { /* said in the cue's problems */ } } });
    triggers = away ? [] : oscTriggers(doc);
    const needs = MODULES.some((d) => d.needsInput && moduleCfg(doc, d.id).enabled);
    const commands = Object.values(n.commands || {}).some((t) => oscCommands.parse(t));       // a message set to GO, Panic…
    // (a device is also a patch to the hub, found by its id; a device that says it is there by itself is listened for)
    // (a show from another computer: no port opened and no connection made, until it is turned on)
    hub.configure({ patches: n.patches, devices: rigDevices.patchesOf(doc), inputPort: n.inputPort, connect: !away, listen: !away && (!!n.listen || needs || triggers.length > 0 || commands || learning || rig.wantsInput()) });
    rig.configure();
    transport.configure(doc);
    listenForLtc();
  }
  /** LTC is listened for on an audio input only while the show is set to chase it. */
  let ltcInKey = '';
  function listenForLtc() {
    const t = document.doc.settings.timecode || {};
    const key = t.source === 'ltc' && !away ? `${t.input || ''}|${Number(t.channel) || 1}` : '';
    if (key === ltcInKey || !state.audioReady) return;
    ltcInKey = key;
    audioCmd({ op: 'ltc-in', on: !!key, input: t.input || '', channel: Number(t.channel) || 1 });
  }

  // ── tracks decoded ahead, for exact looping ───────────────────────────
  // What is playing and what the next GO plays are decoded in the audio window (only a
  // decoded buffer loops a section to the sample); a whole show of decoded tracks would
  // not fit in memory, so anything else is let go.
  let decodedKey = '';
  const decodeSent = new Set<string>();     // files whose bytes the audio window has been sent, and is still keeping
  const prepared = new Set<string>();
  function decodeAhead() {
    // (and a track the operator has marked a place in, so that Fade to can crossfade inside it)
    for (const f of [...prepared]) if (![...engine.running.values()].some((r) => r.file === f)) prepared.delete(f);
    const files = [...new Set([...engine.wantedFiles(), ...prepared])];
    const key = files.join('|');
    if (key === decodedKey || !state.audioReady) return;
    decodedKey = key;
    for (const f of [...decodeSent]) if (!files.includes(f)) decodeSent.delete(f);
    audioCmd({ op: 'keep', urls: files.map(fileUrl) });
    for (const f of files) {
      const abs = playPath(f);
      if (!abs || !f) continue;
      if (decodeSent.has(f)) continue;            // (already there: a long track's bytes are not read and sent again each time the list of wanted ones changes)
      decodeSent.add(f);
      fs.promises.readFile(abs)
        // (no longer wanted by the time it has been read: not sent, or it would be decoded after the `keep` that let it go, and held)
        .then((bytes) => { if (decodeSent.has(f)) audioCmd({ op: 'decode', url: fileUrl(f), file: f, bytes }); })
        .catch((err) => { decodeSent.delete(f); log(`[audio] cannot read ${f} to decode: ${err.message}`); });
    }
  }

  // ── the document → the engine, the mixer, the modules ───────────────────
  let filesKey = '', midiKey = '';
  function applyDocument(reason: string) {
    rev++;
    const doc = document.doc;
    // a level changed on a sound that is playing is heard at once
    const before = new Map<string, number>();
    for (const [id] of engine.running) before.set(id, Number(engine.byId.get(id)?.gainDb) || 0);
    try { engine.load(show.toEngineDoc(doc)); } catch (err) { log(`[show] the engine could not load the list: ${(err as Error).stack || err}`); notice(`Could not load the show: ${(err as Error).message}`, 8000); }
    for (const [id, was] of before) {
      const c = engine.byId.get(id);
      if (c && (Number(c.gainDb) || 0) !== was) engine.trim(id, (Number(c.gainDb) || 0) - was);
    }
    engine.panicFade = Number(doc.settings.go.panicFade) >= 0 ? Number(doc.settings.go.panicFade) : 1;
    engine.limits = cleanLimits(doc.settings.audio.levels);
    engine.busRules = kinds.rulesOf(doc.settings.audio);      // what the buses' kinds ask of a stop and a start (core/engine/sound-kinds.js)
    sendMixer();
    sendDesigns();
    readVoices();
    stage.configure(doc.settings);
    configureNetwork();
    lighting.configure(doc.settings.light);
    const key = [...engine.files(), ...engine.stills()].join('|') + '|' + (document.showDir || '');
    if (key !== filesKey || reason === 'open') { filesKey = key; probe(); }
    // a MIDI File cue's length is its file's, read here (the list shows it, and an auto-follow needs it)
    const mids: string[] = []; show.walk(doc, (c) => { if (c.type === 'midifile' && c.file && !mids.includes(c.file)) mids.push(c.file); });
    const midKey = mids.join('|') + '|' + (document.showDir || '');
    if (midKey !== midiKey || reason === 'open') { midiKey = midKey; midiFiles.clear(); for (const f of mids) { midiFiles.set(f, transport.lengthOf(f)); engine.setDuration(f, midiFiles.get(f)!); } }
    reconcileModules();
    schedulePush();
  }
  function sendMixer() {
    const a = document.doc.settings.audio;
    // the outputs first (their trims, and the ones cues, audition and the effects send to), then the effects, then the buses and their sends
    const r = routing.settingsOf(a);
    audioCmd({ op: 'outputs', trims: r.trims, use: routing.outputsUsed(document.doc) });
    audioCmd({ op: 'fx', ...r.fx });
    // (a level a Mix cue has moved stays where the cue put it through an edit; Reset puts the saved levels back)
    audioCmd({ op: 'buses', list: a.buses.map((b) => (liveBus.has(b.id) ? { ...b, db: liveBus.get(b.id) } : b)) });
    sendStrips();
    audioCmd({ op: 'masterDb', db: state.muted ? -60 : liveMaster !== undefined ? liveMaster : Number(a.masterDb) || 0 });
    audioCmd({ op: 'limiter', on: a.limiter !== false });
    // ducking: by kind (music and ambience under voices), or an older show's one pair, as rules (core/audio/kinds.js)
    const rules = kinds.duckRules(a);
    // (only ducking by kind reads a voice ahead: an older show's pair listens to levels, as it always did)
    duckKeys = new Set(kinds.duckingOf(a) ? rules.flatMap((r) => r.keys) : []);
    state.duckOn = rules.length > 0;
    audioCmd({ op: 'ducker', rules });
    // the monitor feed: a mono copy of outputs 1–2 on one more output (the audio window counts outputs from 0)
    const mon: Partial<NonNullable<typeof a.monitor>> = a.monitor || {};
    audioCmd({ op: 'monitor', on: !!mon.on, out: Math.max(2, Math.round(Number(mon.out) || 3) - 1), db: Number.isFinite(Number(mon.db)) ? Number(mon.db) : -12 });
  }
  /** Each bus's channel strip (eq, filter, pan, and its gate: mute, solo and the crossfader as one gain).
   *  `over` is a setting being moved by hand and not yet written: { name, key, value } or { crossfader }. */
  function sendStrips(over: { name?: string; key?: string; value?: unknown; crossfader?: number } | null = null, secs = 0) {
    const a = document.doc.settings.audio;
    for (const id of [...solo]) if (!a.buses.some((b) => b.id === id)) solo.delete(id);
    const crossfader = over && over.crossfader !== undefined ? over.crossfader : crossfaderNow();
    audioCmd({ op: 'strips', secs, list: a.buses.map((b) => stripOf(over && over.name === b.id ? withSetting(busNow(b), over.key!, over.value) : busNow(b), { solo: [...solo], crossfader })) });
  }
  /** A bus as the desk has it now: the show's, with what a Mix cue or a controller has moved laid over. */
  function busNow(b: Bus) { return liveStrip.has(b.id) ? withSettings(b, liveStrip.get(b.id)) : b; }
  function crossfaderNow() { return liveXf !== undefined ? liveXf : Number(document.doc.settings.audio.crossfader) || 0; }
  function clearLiveDesk() { liveBus.clear(); liveStrip.clear(); liveXf = undefined; liveMaster = undefined; }
  /** A hand on a strip control: what a Mix cue or a controller had it at no longer stands. */
  function handOn(name: string, key: string) { const o = liveStrip.get(name); if (o) { delete o[key]; if (!Object.keys(o).length) liveStrip.delete(name); } }
  function probe() {
    if (!state.audioReady) return;
    engine.missing.clear();
    peaks.clear(); speechOf.clear(); kindGuess.clear();
    const files = engine.files().filter((f): f is string => !!f);
    for (const f of [...files, ...engine.stills()]) { const abs = document.resolveFile(f); if (!abs || !fs.existsSync(abs)) { if (!engine.missing.has(f)) showLog.add('error', `missing file: ${f}`); engine.setMissing(f); } }
    // how many channels each sound has, where it is not two (the inspector draws a row of outputs for each)
    state.channels = {};
    for (const f of files) { const n = engine.missing.has(f) ? 0 : routing.wavChannels(document.resolveFile(f)!); if (n && n !== 2) state.channels[f] = n; }
    audioCmd({ op: 'probe', files: files.filter((f) => !engine.missing.has(f)).map((f) => ({ file: f, url: fileUrl(f) })) });
  }
  /** `keep`: the same show carrying on somewhere else (Save As), so what is sounding plays on. */
  let showLogFor: string | null | undefined;                   // the folder the show log's sitting is in
  function bind(doc: ShowDocument, keep = false) {
    document = doc;
    state.imported = null;
    if (!keep) { solo.clear(); clearLaunches(); clearLiveDesk(); }
    document.on('change', ({ reason }: { reason: string }) => applyDocument(reason));
    document.on('proposal', () => schedulePush());
    if (!keep) { stopRecording(); playlog.endAll(); transport.stop(); engine.reset(); audioCmd({ op: 'stopAll' }); stage.clear(); lightFails.clear(); lastLoad.clear(); rig.opened(); }
    // a sitting of the show log for each show opened (an untitled show's goes in this computer's own logs folder)
    if (!keep || document.showDir !== showLogFor) { showLogFor = document.showDir; showLog.open(document.showDir ? path.join(document.showDir, 'logs') : userDir ? path.join(userDir, 'logs') : null, document.doc.title); }
    lastBackupAt = Date.now();
    applyDocument('open');
  }

  // ── modules ───────────────────────────────────────────────────────────
  // The web remote's key when the show has none of its own: the same for a show every time it opens on this
  // computer, and not to be worked out from the show's id alone (OSC control tells anyone who asks /workspaces
  // what that is). So it is made with a secret of this computer's, kept in its config.json.
  let remoteSalt = '';
  function remoteKey() {
    if (!remoteSalt) {
      remoteSalt = String((getConfig() || {}).remoteSalt || '');
      if (!/^[0-9a-f]{32}$/.test(remoteSalt)) { remoteSalt = require('crypto').randomBytes(16).toString('hex'); saveConfig({ remoteSalt }); }
    }
    return require('crypto').createHash('sha256').update(`remote:${document.doc.id}:${remoteSalt}`).digest('hex').slice(0, 16);
  }
  const running = new Map<string, ModuleInstance>();        // id -> instance
  const runningCfg = new Map<string, string>();     // id -> JSON of the config it was started with
  /** A module's settings in the show, by its id. */
  function moduleCfg(doc: ShowDoc, id: string): ModuleConfig { return (doc.modules || {})[id as keyof Modules] || {}; }
  function reconcileModules() {
    for (const def of MODULES) {
      let cfg = moduleCfg(document.doc, def.id);
      // the lighting desk is set up once: with no address of its own, the module sends to the desk's patch (Settings ▸ Integrations ▸ Network)
      if (def.id === 'lighting-desk' && !cfg.host) {
        const p = document.doc.settings.network.patches.find((x) => def.KINDS![x.device!] && x.host);
        if (p) cfg = { ...cfg, host: p.host, port: p.port, kind: p.device, fromPatch: p.name || def.KINDS![p.device!].label };
      }
      // a test run starts only the modules that open no socket of their own (the hub records and sends nothing then)
      // (and a show from another computer starts none until it is turned on)
      const want = !!cfg.enabled && !away && !(smoke && !net && !process.env.EC_SMOKE_MODULES && !['osc-control', 'show-feedback'].includes(def.id));
      const key = want ? JSON.stringify(cfg) : '';
      if ((runningCfg.get(def.id) || '') === key) continue;
      const old = running.get(def.id);
      if (old) { try { old.stop(); } catch (err) { log(`[${def.id}] stop: ${(err as Error).message}`); } running.delete(def.id); }
      runningCfg.set(def.id, key);
      if (!want) continue;
      try {
        const inst = def.create({ log: (l: string) => log(`[${def.id}] ${l}`), changed: schedulePush, host: api, net: hub, failed: lightFailed });
        inst.start(cfg);
        running.set(def.id, inst);
        log(`[${def.id}] started`);
      } catch (err) { log(`[${def.id}] could not start: ${(err as Error).stack || err}`); }
    }
  }
  function moduleStates() {
    return MODULES.map((def) => {
      const inst = running.get(def.id);
      let status: ModuleStatus | null = null;
      try { status = inst ? inst.status() : null; } catch (err) { status = { ok: false, text: (err as Error).message }; }
      const enabled = !!moduleCfg(document.doc, def.id).enabled;
      return { id: def.id, name: def.name, summary: def.summary, details: def.details || '', fields: def.fields, enabled, running: !!inst, status: !inst && enabled && away ? { ok: false, text: 'off: this show came from another computer' } : status, ...(away && enabled ? { away: true } : {}) };
    });
  }

  // ── the hidden audio window ───────────────────────────────────────────
  function startAudio() {
    if (audioWin && !audioWin.isDestroyed()) return;
    state.audioReady = false;
    audioWin = new BrowserWindow({
      show: false, width: 200, height: 100,
      // (--expose-gc: the audio window asks for its memory back when it lets go of decoded sound; see `tidy` in audio.html)
      webPreferences: { preload: path.join(__dirname, '../audio/preload.js'), backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', additionalArguments: ['--js-flags=--expose-gc'] },
    });
    audioWin.loadFile(path.join(__dirname, '../audio/audio.html'), smoke ? { query: { silent: '1', outs: '8' } } : {});      // (a test run plays to no device, one that it pretends has eight outputs)
    audioWin.webContents.on('render-process-gone', (_e, d) => {
      log(`[audio] the audio window died (${d.reason}); making a new one`);
      engine.running.clear();
      stage.clear();
      audioWin = null;
      setTimeout(startAudio, 500);
    });
    audioWin.on('closed', () => { audioWin = null; });
  }
  ipcMain.on('audio-event', (_e: IpcMainEvent, ev: AudioEvent) => { try { onAudioEvent(ev); } catch (err) { log(`[audio] event ${ev && ev.type}: ${(err as Error).stack || err}`); } });
  function onAudioEvent(ev: AudioEvent) {
    switch (ev.type) {
      case 'ready': {
        state.audioReady = true;
        const want = (getConfig() || {}).audioDevice;
        if (!smoke) outWatch = deviceWatch.step(null, { type: 'chosen', id: want || 'default', label: (getConfig() || {}).audioDeviceLabel || '' }).state;
        if (want && want !== 'default' && !smoke) audioCmd({ op: 'sink', id: want });
        irSent.clear();              // (a new audio window has no impulse responses)
        sendMixer(); probe(); decodedKey = ''; decodeAhead(); ltcInKey = ''; listenForLtc();
        break;
      }
      case 'duration': trimEndAt(ev.file, ev.secs); if (probeWaits.has(ev.file)) { probeWaits.get(ev.file)!(ev.secs); probeWaits.delete(ev.file); } engine.setDuration(ev.file, ev.secs); break;
      case 'mode': engine.setExact(ev.key, ev.exact); break;
      case 'decoded': if (ev.error) log(`[audio] could not decode ${ev.file}: ${ev.error}`); break;
      case 'missing': if (probeWaits.has(ev.file)) { probeWaits.get(ev.file)!(0); probeWaits.delete(ev.file); break; } engine.setMissing(ev.file); log(`[audio] cannot play ${ev.file}`); break;
      case 'ended': playlog.ended(ev.key); engine.audioEnded(ev.key); break;
      case 'where': stage.soundAt(ev); break;
      // (the audio window has dropped it; told again so the two can never disagree about what is sounding)
      case 'error': playlog.ended(ev.key); showLog.add('error', `${nameOf(ev.key)} cannot be played: ${ev.detail || 'its file cannot be read'}`); log(`[audio] ${ev.key}: ${ev.detail || 'cannot play'} (${ev.url})`); audioCmd({ op: 'stop', key: ev.key }); engine.audioEnded(ev.key); break;
      case 'devices': state.devices = ev.list; state.inputs = ev.inputs || []; if (!smoke) state.device = ev.current || 'default'; watchOutput({ type: 'devices', list: ev.list || [] }); schedulePush(); break;
      case 'sink':
        // (a move made by the watcher, to the default and back, is not the operator's choice: it is not kept as one)
        if (ev.fallback) { if (ev.ok) { state.device = ev.id; state.deviceOk = true; state.deviceDetail = ''; } else log(`[audio] the output could not be moved to ${ev.id}: ${ev.detail || ''}`); schedulePush(); break; }
        state.deviceOk = !!ev.ok; state.deviceDetail = ev.ok ? '' : String(ev.detail || '');
        if (ev.ok) { state.device = ev.id; saveConfig({ audioDevice: ev.id, audioDeviceLabel: (state.devices.find((d) => d.id === ev.id) || {}).label || '' }); }
        else if (watchOutput({ type: 'refused' })) { /* said by the watcher: the show is on the default until it shows up */ }
        else notice(`Could not use that output: ${state.deviceDetail}`, 6000);
        schedulePush();
        break;
      case 'outputs': if (state.outputs !== ev.channels) { state.outputs = ev.channels; schedulePush(); } break;
      case 'outch': state.outCh = ev.ch || []; break;
      case 'midi-ports': state.midi = { inputs: ev.inputs || [], outputs: ev.outputs || [], error: ev.error || '' }; schedulePush(); break;
      case 'midi-in': midiIn(ev.bytes, ev.port, ev.at); break;
      // LTC: a frame heard on the input (and when its last bit ended); and an output that could not carry it
      case 'tc-in': transport.ltcIn(ev.frame, clockOf(ev.at)); break;
      case 'ltc': if (!ev.ok) { log(`[timecode] LTC ${ev.key || ''}: ${ev.detail}`); notice(`LTC is not going out: ${ev.detail}`, 8000); } break;
      case 'ltc-in': state.ltcIn = ev.ok ? '' : String(ev.detail || 'the input could not be opened'); if (!ev.ok) log(`[timecode] LTC in: ${state.ltcIn}`); schedulePush(); break;
      // the show's sound being recorded: 16-bit stereo, a quarter of a second at a time, straight to the file
      case 'rec': if (recording) { recording.rate = ev.rate; const b = Buffer.from(ev.pcm.buffer, ev.pcm.byteOffset, ev.pcm.byteLength); try { fs.writeSync(recording.fd, b); recording.bytes += b.length; } catch (err) { log(`[rec] ${(err as Error).message}`); stopRecording(); notice(`Recording stopped: ${(err as Error).message}`, 8000); } } break;
      case 'recording': if (recording) recording.rate = ev.rate; break;
      case 'operror': log(`[audio] ${ev.op}${ev.key ? ` ${ev.key}` : ''} failed: ${ev.detail}`); break;
      // the output going away under the show (an interface unplugged): said at once, where the operator is looking
      case 'ctx':
        log(`[audio] context ${ev.error ? 'ERROR (the output failed)' : ev.state}`);
        if (ev.error || ev.state === 'suspended' || ev.state === 'interrupted') {
          // the chosen device gone: the show moves to the system default (and back when it returns); already on the default: it is opened again
          const moved = !smoke && watchOutput({ type: 'failed' });
          if (!smoke && !moved && state.deviceOk !== false) notice('The sound output stopped. Choose one in Settings ▸ Audio, then restart what was playing.', 15000);
          if (ev.error && !moved) { state.deviceOk = false; state.deviceDetail = 'the output failed'; }
          schedulePush();
        }
        else if (ev.state === 'running' && state.deviceOk === false && !state.deviceDetail.includes('could not')) { state.deviceOk = true; state.deviceDetail = ''; schedulePush(); }
        break;
      case 'level': state.monitorPeak = ev.monitor == null ? null : ev.monitor; state.level = ev.channels; state.busPeaks = ev.buses; state.outPeaks = ev.outs || []; state.ducking = !!ev.ducking; state.ducked = ev.ducked || []; state.limiting = !!ev.limiting && ev.voices > 0; state.voices = ev.voices; state.cuePeaks = ev.cues || {}; break;
      case 'pcm': {
        let found = null;
        if (ev.samples) { try { found = tempoMap(ev.samples, ev.rate); } catch (err) { log(`[tempo] ${ev.file}: ${(err as Error).message}`); } } else log(`[tempo] could not read ${ev.file}: ${ev.error || ''}`);
        log(`[tempo] ${ev.file}: ${found ? `${found.bpm} bpm, confidence ${found.confidence}${found.covers != null ? `, holds ${Math.round(found.covers * 100)}%` : ''}${found.sections && found.sections.length ? `, then ${found.sections.map((x) => `${x.bpm} from ${x.from} s`).join(', ')}` : ''}` : 'none'}`);
        // (what kind of sound it is, from the same reading: asked for when a sound is added)
        if (ev.samples && guessWanted.delete(ev.file)) { try { kindGuess.set(ev.file, kinds.guessKind(ev.samples, ev.rate, { tempo: found })); } catch (err) { log(`[kinds] ${ev.file}: ${(err as Error).message}`); } }
        settleTempo(ev.file, found);
        break;
      }
      case 'peaks': peaks.set(ev.bins && ev.bins !== PEAK_BINS ? `${ev.file}|${ev.bins}` : ev.file, ev.peaks ? { peaks: ev.peaks, rms: ev.rms || null } : null); schedulePush(); break;
      case 'monitor': state.monitor = { on: !!ev.on, wanted: !!ev.wanted, out: (Number(ev.out) || 0) + 1 }; schedulePush(); break;
      default: break;
    }
  }
  // ── the output device, watched (core/audio/device-watch.js decides; this carries it out and says so) ──
  let outWatch: WatchState = { wanted: null, fallback: null };
  const sinkTo = (id: string) => { if (smoke) onAudioEvent({ type: 'sink', id, ok: true, fallback: true }); else audioCmd({ op: 'sink', id, fallback: true }); };      // (a test run opens no device, ever)
  function watchOutput(event: WatchEvent) {
    const r = deviceWatch.step(outWatch, event);
    outWatch = r.state;
    const a = r.action;
    if (!a) return false;
    const name = a.label || 'The chosen output';
    if (a.do === 'fallback') {
      log(`[audio] ${name} is gone: on the system default output until it returns`);
      sinkTo('default');
      notice(`${name} has gone: playing on this computer’s output until it is back. Restart anything that stopped.`, 15000);
    } else if (a.do === 'return') {
      log(`[audio] ${name} is back: the show returns to it`);
      sinkTo(a.id!);
      notice(`${name} is back: playing on it again.`, 8000);
    } else if (a.do === 'revive') { if (!smoke) audioCmd({ op: 'sink', id: outWatch.wanted && !outWatch.fallback ? outWatch.wanted.id : 'default', fallback: true }); return false; }
    schedulePush();
    return true;
  }

  // ── tempo: found in a file's sound, written to a cue only when the operator asks ──
  function settleTempo(file: string, found: Found) {
    tempos.set(file, found);
    for (const done of tempoWaits.get(file) || []) done(found);
    tempoWaits.delete(file);
  }
  function tempoIn(file: string): Promise<Found> {
    if (tempos.has(file)) return Promise.resolve(tempos.get(file)!);
    const abs = playPath(file);
    if (!abs || !fs.existsSync(abs) || !audioWin) return Promise.resolve(null);
    return new Promise<Found>((resolve) => {
      const waiting = tempoWaits.get(file) || [];
      waiting.push(resolve); tempoWaits.set(file, waiting);
      if (waiting.length > 1) return;
      try { audioCmd({ op: 'pcm', file, bytes: fs.readFileSync(abs) }); } catch { settleTempo(file, null); return; }
      setTimeout(() => { if (tempoWaits.has(file)) { tempoWaits.delete(file); for (const done of waiting) done(null); } }, 90000);
    });
  }
  /** Find the tempo of the audio cues named (or of every one that has none), and keep what is found as one edit. */
  async function findTempos({ ids = null, again = false }: { ids?: string[] | null; again?: boolean } = {}) {
    const cues: Cue[] = [];
    const walk = (list: Cue[]) => { for (const c of list) { if (c.type === 'audio' && c.file && (ids ? ids.includes(c.id) : !c.tempo)) cues.push(c); if (c.children) walk(c.children); } };
    for (const l of document.doc.lists) walk(l.cues);
    const ops: EditOp[] = [], results: Record<string, Found> = {};
    for (const c of cues) {
      if (again) tempos.delete(c.file!);
      const r = await tempoIn(c.file!);
      results[c.id] = r;
      if (r && r.confidence >= MIN_CONFIDENCE) ops.push({ op: 'cue.set', id: c.id, props: { tempo: { bpm: r.bpm, first: r.first, bar: 4, confidence: r.confidence, ...(r.sections && r.sections.length ? { sections: r.sections.map((x) => ({ from: x.from, bpm: x.bpm, first: x.first, bar: 4 })) } : {}) } } });
    }
    if (ops.length) document.edit(ops, { label: ops.length === 1 ? 'tempo found' : `tempo found in ${ops.length} sounds` });
    // say what was not found, and where: a sound with no steady pulse, or one this could not choose a reading for
    const none = cues.filter((c) => !(results[c.id] && results[c.id]!.confidence >= MIN_CONFIDENCE)).map((c) => c.name || path.basename(String(c.file)).replace(/\.[a-z0-9]+$/i, ''));
    if (cues.length > 1 || none.length) notice(`Tempo found in ${ops.length} of ${cues.length}.${none.length ? ` Not in: ${none.slice(0, 4).join(', ')}${none.length > 4 ? '…' : ''}.` : ''} Check the bar lines in each Clip view.`, 9000);
    return { looked: cues.length, found: ops.length, results };
  }
  function clearLaunches() { for (const l of launches.values()) clearTimeout(l.timer); launches.clear(); }
  /** A launch from the Live view, now: the clip (or the scene) takes over the tracks it plays on, unless the show
   *  lets clips overlap. What it takes over is faded out under it and stopped (core/audio/launch.js). */
  function launchNow(id: string) {
    const cue = engine.byId.get(id);
    if (!cue) return;
    if (!(document.doc.settings.live || {}).overlap) {
      for (const old of replacedBy(cue, [...engine.running.keys()], engine.byId)) {
        engine.following.delete(engine.topOf(old)); engine.leavePlaylists(old);
        engine.fadeAudio(old, -60, TAKEOVER_FADE, true, `stop:${old}`);
      }
    }
    engine.fire(id); engine.changed();
  }
  /** Where the music is: the tempo, bar and beat of the newest sound playing that has a beat. null: nothing has. */
  function musicClock() {
    let best: { id: string; r: Running; c: EngineCue & { beats: number[] } } | null = null;
    for (const [id, r] of engine.running) { const c = engine.byId.get(id); if (c && Array.isArray(c.beats) && c.beats.length > 1 && (!best || r.startedAt > best.r.startedAt)) best = { id, r, c: c as EngineCue & { beats: number[] } }; }
    if (!best) return null;
    const p = engine.positionOf(best.r), downs = best.c.downbeats || [];
    const bars = downs.filter((d) => d <= p + 0.001);
    const from = bars.length ? bars[bars.length - 1] : -Infinity;
    // (the tempo and the beats in a bar are those of the section the track is in)
    const sec = best.c.tempo ? sectionAt(best.c.tempo, p) : null;
    const rate = best.r.rate || 1;                 // (a warped sound's tempo is the one it is heard at)
    return { id: best.id, name: best.c.name, bpm: Math.round((sec ? sec.bpm : 60 / (best.c.beats[1] - best.c.beats[0])) * rate * 100) / 100, per: sec ? sec.bar : 4, ...(rate !== 1 ? { rate } : {}),
             bar: bars.length, beat: best.c.beats.filter((b) => b >= from - 0.001 && b <= p + 0.001).length || 1 };
  }

  /** The desk's tempo: the one set on it, else the tempo of the music playing as it is heard; 0 when there is neither. */
  function deskTempo() {
    const set = Number((document.doc.settings.live || {}).tempo) || 0;
    if (set) return set;
    const c = musicClock();
    return c ? c.bpm : 0;
  }
  /** The desk's tempo moved: every warped sound playing moves with it, from where it is. */
  function rewarp() {
    const desk = Number((document.doc.settings.live || {}).tempo) || 0;
    if (!desk) return;
    for (const [id, r] of engine.running) { const c = engine.byId.get(id); if (c && c.warp && c.tempo) engine.rewarp(id, warpRate(c.tempo, desk, engine.positionOf(r))); }
  }

  /** `detail`: finer slices, for a waveform that is zoomed into (the inspector's). */
  function peaksFor(file: string, detail = false): Peaks | 'pending' | null | undefined {
    const bins = detail ? PEAK_DETAIL : PEAK_BINS, key = detail ? `${file}|${bins}` : file;
    if (peaks.has(key)) return peaks.get(key);
    const abs = playPath(file);
    if (!abs || !fs.existsSync(abs) || mediaKind(file)) { peaks.set(key, null); return null; }      // (a video is not read whole to draw its sound)
    const wav = /\.wav$/i.test(abs) ? wavPeaks(abs, bins) : null;
    if (wav) { peaks.set(key, wav); return wav; }
    peaks.set(key, 'pending');     // anything else: the audio window decodes it
    try { audioCmd({ op: 'peaks', file, bins, bytes: fs.readFileSync(abs) }); } catch { peaks.set(key, null); }
    return 'pending';
  }

  // ── what the views are sent ───────────────────────────────────────────
  let rowsFor = -1, rows: Row[] = [], labels: Record<string, string> = {}, docForView: ViewDoc | null = null, docProblems: Problem[] = [], triggerRows: TriggerRow[] = [], carts: Record<string, ReturnType<typeof cartOf.layout>> = {};
  let fadeStops: string[] = [];               // Fade cues that stop their target because they were left alone (a fade to silence: cueTypes.stopsTarget)
  let liveUsed: ReturnType<typeof usesLive> = [];                // what in this show came from the Live view (core/show/uses-live.js): said when that view is hidden
  function derive() {
    if (rowsFor === rev) return;
    rowsFor = rev;
    const doc = document.doc;
    const { byId } = show.index(doc);
    rows = []; labels = {};
    const list = doc.lists.find((l) => l.name === engine.listName) || doc.lists[0];
    const go = (cues: Cue[], depth: number, parent: string | null) => {
      for (const c of cues) {
        const name = c.name || cueTypes.defaultName(c, byId);
        labels[c.id] = name;
        rows.push({ id: c.id, depth, parent, type: c.type, number: c.number || '', name, notes: c.notes || '', color: c.color || '' });
        if (c.children) go(c.children, depth + 1, c.id);
      }
    };
    for (const l of doc.lists) { const start = rows.length; go(l.cues, 0, null); if (l !== list) rows.length = start; }
    docProblems = show.problems(doc);
    const floor = cleanLimits(doc.settings.audio.levels).min;
    fadeStops = [];
    show.walk(doc, (c) => { if (c.type === 'fade' && (c.stopTarget === undefined || c.stopTarget === null) && cueTypes.stopsTarget(c, byId.get(c.target!) || null, floor)) fadeStops.push(c.id); });
    liveUsed = usesLive(doc);
    for (const [file, secs] of midiFiles) if (!(secs > 0)) show.walk(doc, (c) => { if (c.type === 'midifile' && c.file === file) docProblems.push({ id: c.id, level: 'error', why: 'its file is missing, or is not a MIDI file' }); });
    triggerRows = triggersOf(doc);
    // each cart's buttons, decided in one place (core/show/cart.js): list id -> { rows, columns, cells, extra }
    carts = Object.fromEntries(doc.lists.filter((l) => l.cart).map((l) => [l.id, cartOf.layout(l)]));
    // the beat grids are the engine's business; the view gets the cues without them
    const strip = (c: Cue): ViewCue => { const { beats, downbeats, ...rest } = c; return { ...rest, ...(beats ? { hasGrid: true } : {}), ...(c.children ? { children: c.children.map(strip) } : {}) }; };
    docForView = { ...doc, lists: doc.lists.map((l) => ({ ...l, cues: l.cues.map(strip) })) };
  }
  function snapshot(full = true) {
    derive();
    const e: Omit<ReturnType<CueEngine['snapshot']>, 'cues'> & { cues?: unknown; poem?: unknown; lastLoad?: number } = engine.snapshot();
    delete e.cues; delete e.poem;
    // (a file that is there but cannot be played says so rather than "missing": a compressed AIFF-C or CAF, or a
    // video the audio window could not open, which is its format)
    const copyFail = (id: string) => { const c = engine.byId.get(id), abs = c && c.file && document.resolveFile(c.file); return abs ? copyFails.get(abs) : null; };
    const noFormat = (id: string) => { const c = engine.byId.get(id); const abs = c && c.picture && c.file && document.resolveFile(c.file); return !!abs && fs.existsSync(abs); };
    const onShare = (id: string) => { const c = engine.byId.get(id); return away && !!c && trust.isRemote(c.file); };
    const missing: Problem[] = e.problems.filter((p) => /^missing file/.test(p.why)).map((p) => ({ id: p.id, level: 'error', why: onShare(p.id) ? 'its file is on another computer: not opened until you turn on this show’s network features' : copyFail(p.id) ? `its file cannot be played: it is ${copyFail(p.id)}` : noFormat(p.id) ? 'its file cannot be played here: convert it (the manual says to what)' : 'its file is missing' }));
    for (const [id, why] of lightFails) if (engine.byId.has(id)) missing.push({ id, level: 'warning', why: `its last GO did not reach the lighting desk: ${why}` });
    e.lastLoad = (e.playhead && lastLoad.get(e.playhead)) || 0;
    for (const p of lost()) if (p.id && engine.byId.has(p.id)) missing.push(p as Problem);
    const noOut = (b: Bus) => (Number(b.out) > 1 && Number(b.out) + 1 > state.outputs);
    const a = document.doc.settings.audio;
    return {
      rev,
      ...(full ? { doc: docForView, labels, triggers: triggerRows, carts, fadeStops } : {}),
      rows,
      show: { title: document.doc.title, dir: document.showDir, untitled: !document.showDir, dirty: document.dirty, recovered: document.recovered,
              // what is pending, change by change: the view marks each changed control and can put one back
              unsaved: document.unsaved().map((c: AnyChange) => ({ kind: c.kind, id: c.id || null, path: c.path || null, label: c.label || c.path, from: c.from, to: c.to, count: c.count || 0,
                                                         fields: (c.fields || []).map((f: FieldChange) => ({ field: f.field, label: f.label, from: f.from, to: f.to, rawFrom: f.rawFrom === undefined ? null : f.rawFrom })) })),
              canUndo: document.undoStack.length > 0, canRedo: document.redoStack.length > 0,
              undoLabel: (document.undoStack.at(-1) || {}).label || '', warnings: document.warnings },
      problems: [...docProblems, ...missing],
      engine: e,
      live: { quantise: state.launchQ, queued: [...launches.keys()], clock: musicClock(), overlap: !!(document.doc.settings.live || {}).overlap, tempo: Number((document.doc.settings.live || {}).tempo) || 0, map: (document.doc.settings.live || {}).map || [], used: liveUsed },
      mixer: { masterDb: liveMaster !== undefined ? liveMaster : Number(a.masterDb) || 0, outputs: state.outputs, outPeaks: state.outPeaks || [], buses: a.buses.map((b) => ({ ...busNow(b), ...(liveStrip.has(b.id) ? { liveStrip: true } : {}), peak: state.busPeaks[b.id] ?? -60, ...(noOut(b) ? { noOutput: true } : {}), ...(liveBus.has(b.id) && liveBus.get(b.id) !== b.db ? { live: liveBus.get(b.id) } : {}) })), level: state.level, limiting: state.limiting, crossfader: crossfaderNow(), solo: [...solo],
               ducking: !!state.ducking, duckOn: !!state.duckOn, ducked: state.ducked || [], kinds: Object.fromEntries(a.buses.map((b) => [b.id, kinds.kindOf(b)])), duckingBy: kinds.duckingOf(a), recording: recording ? { file: path.basename(recording.file), secs: Math.round((Date.now() - recording.since) / 1000) } : null, device: state.device, devices: state.devices, inputs: state.inputs || [], deviceOk: state.deviceOk,
               // the chosen output is away and the show is on the default meanwhile; the monitor feed, and whether the device has the output it wants
               fallback: outWatch.fallback && outWatch.wanted ? { label: outWatch.wanted.label || 'the chosen output' } : null,
               monitor: { ...(a.monitor || {}), live: !!(state.monitor && state.monitor.on), peak: state.monitorPeak == null ? -60 : state.monitorPeak },
               levels: cleanLimits(a.levels), audioReady: state.audioReady, muted: state.muted },
      // each output's level, the sounds that have other than two channels, and what this device cannot play of the show's routing
      routing: { outCh: state.outCh || [], channels: state.channels || {}, lost: lost().filter((p) => !p.id).map((p) => p.why) },
      // each playing sound's own level, by cue id (the meter on its row in the cue list)
      cueLevels: state.cuePeaks || {},
      modules: moduleStates(),
      light: lighting.snapshot(),
      mode: state.mode,
      imported: state.imported || null,
      added: state.added || null,
      // double-GO protection: how long GO is still locked for (the button shows it)
      goLock: goGuard.lockLeft(),
      proposal: document.proposal ? { id: document.proposal.id, summary: document.proposal.summary, author: document.proposal.author, changes: document.proposal.changes, counts: document.proposal.counts,
                                      files: (document.proposal.files || []).map((f) => ({ path: f.path, lines: f.lines, replaces: !!f.replaces, text: f.text })) } : null,
      assistant: assistant ? assistant.status({ document, engine, rig: rig.service, imported: state.imported || null }) as AssistantView : { available: false } as AssistantView,
      // a place the assistant is pointing at (show_in_app): the main window rings it once and says whether it could
      point: state.point || null,
      rig: rig.snapshot(),
      network: { ...hub.status(), triggers: triggers.length, inputPort: document.doc.settings.network.inputPort },
      midi: { ...state.midi, triggers: midiTriggers.length, learning: !!midiLearner, mapping: !!mapLearner, test: !!smoke },
      stage: stage.status(),
      timecode: { ...transport.status(), ltcInError: state.ltcIn || '' },
      // outputs held back for a rehearsal: [{ id, label, on }]
      overrides: OVERRIDES.map((o) => ({ ...o, on: !!overrides[o.id] })),
      // a show from another computer, with its network features off (the title bar's line and its Turn on)
      away,
      sent: hub.monitor().filter((x) => x.dir === 'out').slice(-12).map((x) => ({ at: x.at, message: x.text, to: x.who, ok: x.ok, why: x.why })),
      notice: state.notice && state.notice.until > Date.now() ? state.notice.text : '',
      noticeAt: state.notice && state.notice.until > Date.now() ? state.notice.at : 0,   // (the page shows whichever was said last: this or its own)
    };
  }
  /** What only the running app knows, for the readiness check (core/rig/check.js `items`). */
  function rigFacts() {
    const label = (id: string) => (state.devices.find((d) => d.id === id) || {}).label || (id === 'default' || !id ? 'this computer’s default output' : String(id));
    const files = new Set<string>(), broken: { id: string; why: string }[] = [];
    show.walk(document.doc, (c) => { if (c.file) { files.add(c.file); if (engine.missing.has(c.file)) broken.push({ id: c.id, why: 'its file is missing' }); } });
    const st = stage.status(), l = lighting.snapshot(), tc = transport.status();
    return {
      saved: { untitled: !document.showDir, dirty: document.dirty, changes: document.dirty ? document.unsaved().length : 0 },
      broken, files: { total: files.size, missing: [...engine.missing].filter((f) => files.has(f)) },
      audio: state.audioReady ? { device: label(state.device), ok: state.deviceOk !== false, fallback: outWatch.fallback && outWatch.wanted ? outWatch.wanted.label || 'the chosen output' : null, outputs: state.outputs,
                                  inputs: (state.inputs || []).length ? state.inputs!.map(String) : null } : undefined,       // (inputs have names only once one has been opened: none listed is "cannot be told")
      stage: { open: !!st.open, waiting: !!st.waiting, label: st.label || '' },
      light: { error: l.outputError || '', held: !!l.held },
      network: hub.status(),
      midi: { outputs: state.midi.outputs, error: state.midi.error },
      modules: moduleStates().map((m) => ({ id: m.id, name: m.name, enabled: m.enabled, running: m.running, status: m.status })),
      timecode: { arriving: !!(tc.in && tc.in.running), text: (tc.in && tc.in.text) || '' },
      overrides: OVERRIDES.map((o) => ({ ...o, on: !!overrides[o.id] })),
      computer: { audio: { device: label(state.device), outputs: state.outputs, devices: state.devices.map((d) => d.label || d.id) }, displays: (st.displays || []).map((d) => d.label),
                  midi: { inputs: state.midi.inputs, outputs: state.midi.outputs }, interfaces: hub.status().interfaces },
    };
  }
  function push() {
    pushPending = false;
    let any = false;
    for (const wc of views) {
      if (wc.isDestroyed()) { views.delete(wc); sentRev.delete(wc); continue; }
      const full = sentRev.get(wc) !== rev;
      let s: HostState;
      try { s = snapshot(full); } catch (err) { log(`[host] could not build the state: ${(err as Error).stack || err}`); return; }
      sentRev.set(wc, rev);
      wc.send('ec-state', s);
      any = true;
    }
    if (listeners.size || running.size) {
      for (const inst of running.values()) if (inst.onState) { try { inst.onState(); } catch (err) { log(`[module] ${(err as Error).message}`); } }
      for (const fn of listeners) { try { fn(); } catch (err) { log(`[host] a listener failed: ${(err as Error).message}`); } }
    }
    return any;
  }
  function schedulePush() { if (pushPending) return; pushPending = true; setImmediate(push); }
  // (a notice is a line of the show log: a warning when it says something is wrong, else one of the show's own)
  function notice(text: string, ms = 3500) { showLog.add(/\b(gone|away|lost|missing|cannot|could not|failed|not answering|not connected|not sent|no output|has no)\b/i.test(text) ? 'warning' : 'show', text); state.notice = { text, at: Date.now(), until: Date.now() + ms }; schedulePush(); setTimeout(schedulePush, ms + 50); }

  // ── commands ──────────────────────────────────────────────────────────
  // What Show mode locks. Riding the mixer and saving are part of running a show, so they are not here.
  const EDITS = new Set<string>(['fade-from-target', 'ducking-by-kind', 'relink', 'edit', 'undo', 'redo', 'import', 'accept', 'restore-version', 'restore-backup', 'settings-import', 'revert', 'unset', 'tempo-find', 'clip-paste', 'clip-props', 'retarget', 'template', 'tempo-edit', 'map-set', 'map-learn', 'desk-keep', 'media-clean', 'mark-here', 'prop-files', 'agent-guide']);
  const cmdListeners = new Set<CmdListener>();   // told each command once it is done (a module reporting "pause all", "panic")
  function cmd<C extends HostCommand>(c: C): ResultOf<C> {
    const before: Playhead = { playhead: engine.playhead };
    try {
      const r: HostResult | Promise<HostResult> = run(c) || { ok: true };
      for (const fn of cmdListeners) { try { fn(c, r); } catch (err) { log(`[host] a listener failed on ${c && c.op}: ${(err as Error).message}`); } }
      // a module that follows what is done (the main telling its backup) hears each command once it has been carried out
      for (const inst of running.values()) if (inst.onCommand) { try { inst.onCommand(c, r, before, { playhead: engine.playhead }); } catch (err) { log(`[module] ${(err as Error).message}`); } }
      return r as ResultOf<C>;
    }
    catch (err) {
      if (err && (err as Error).name === 'OpError') return { error: (err as Error).message } as ResultOf<C>;
      log(`[host] ${c && c.op}: ${(err as Error).stack || err}`);
      return { error: (err as Error).message } as ResultOf<C>;
    } finally { schedulePush(); }
  }
  /** Skip or Fade to on the bar (the Playing strip's markers): the engine waits for the track's own line. */
  function onGrid(c: Extract<OwnCommand, { op: 'seek' | 'fadeto' }>, secs: number) {
    const r = engine.running.get(c.id);
    if (r && !r.exact) { prepared.add(r.file!); decodeAhead(); }
    const did = engine.moveOnGrid(c.id, Number(c.t) || 0, { grid: c.on === 'beat' ? 'beats' : 'downbeats', secs });
    return did || { error: 'that is not playing' };
  }
  function idOf(c: CueNamed) {
    if (c.id) return c.id;
    if (c.number != null) { const cue = show.findByNumber(document.doc, c.number); return cue ? cue.id : null; }
    return null;
  }
  function run(c: HostCommand): HostResult | Promise<HostResult> | null {
    if (!c || typeof c.op !== 'string') return { error: 'no command' };
    if (c.op === 'panic' || c.op === 'reset' || c.op === 'fadeall') clearLaunches();      // nothing waits for a beat through a panic
    if (['go', 'start', 'launch', 'fire', 'panic', 'reset'].includes(c.op)) audition.clear();   // only what V itself starts is an audition
    // a command that names a cue which is not there is refused: it must never fall through to "everything"
    if ((c.number != null || c.id != null) && ['pause', 'resume', 'toggle', 'stop', 'fire', 'start', 'reset', 'load', 'release'].includes(c.op) && !idOf(c as CueNamed)) return { error: `no cue ${c.number != null ? `numbered ${c.number}` : c.id}` };
    if (state.mode === 'show' && EDITS.has(c.op)) return { error: 'Show mode: editing is locked' };
    if (c.op.startsWith('stage-')) return stage.cmd(c as StageCommand);      // the output window: open, close, test pattern, blackout
    if (rig.handles(c.op)) return rig.cmd(c as RigCommand);                // the Rig page: try a command, ask, check, look for props, ticks (it says what Show mode refuses)
    // the Lights view: a hand on the levels, blackout, and recording what is live into a cue (which is an edit)
    if (c.op.startsWith('light-')) return lighting.cmd(c as LightCommand, { locked: state.mode === 'show', cueOf: (id) => show.index(document.doc).byId.get(id), edit: (ops, label) => document.edit(ops as EditOp[], { label }) });
    switch (c.op) {
      // transport
      case 'go': {
        if (!goGuard.go(c.from)) { const g = goGuard.ignored().at(-1)!; showLog.add('ignored', `GO from ${fromText(c.from)} ${g.after} ms after the last: not done`); return { ignored: 'double GO' }; }
        // (`list`: that list's GO, on its own playhead, whichever list is on screen)
        if (c.list != null && !engine.list(c.list)) return { error: `no list called ${c.list}` };
        goFrom = fromText(c.from);
        try { engine.go(c.list != null ? c.list : undefined); } finally { goFrom = ''; }
        break;
      }
      // a hard stop silences the audio window outright, whatever the engine believes is playing
      case 'panic': { const hard = c.hard || performance.now() / 1000 - engine.lastPanic < 1.5; engine.panic(); if (c.hard) engine.panic(); if (hard) { playlog.endAll(); audioCmd({ op: 'stopAll' }); } lighting.panic(hard, engine.panicFade); break; }
      // with a cue named: that cue alone is put back as the show has it (stopped, unloaded, armed as written, re-aimed)
      case 'reset': if (c.id != null || c.number != null) { engine.resetCue(idOf(c)!); engine.changed(); break; }
        engine.reset(); playlog.endAll(); audioCmd({ op: 'stopAll' }); stage.clear(); clearLiveDesk(); lightFails.clear(); lighting.reset(); sendMixer(); break;
      case 'pause': engine.pause(idOf(c)); break;
      case 'resume': engine.resume(idOf(c)); break;
      case 'toggle': { const id = idOf(c); if (id) (engine.isPaused(id) ? engine.resume(id) : engine.pause(id)); break; }
      // `fade` (the ■ beside one active sound): out over the panic time and then stopped, so one cue can be taken out gently
      case 'stop': { const id = idOf(c); if (id && c.fade && engine.running.has(id) && engine.panicFade > 0) { engine.following.delete(engine.topOf(id)); engine.leavePlaylists(id); engine.fadeAudio(id, -60, engine.panicFade, true, `stop:${id}`); } else if (id) engine.stopCue(id); break; }
      // a playlist's "next": what is playing fades out and the next sound comes in
      case 'playlist-next': if (!engine.skipPlaylist(c.id)) return { error: 'that playlist is not playing' }; break;
      case 'fadeall': engine.fadeAll(Number(c.secs) || 5); break;
      // (`id: null`: no cue standing by; a cue of a list that is not on screen moves that list's playhead)
      // (a section heading is not a stop: standing by on one is standing by on its first cue)
      case 'playhead': engine.setPlayhead(c.id == null ? null : sections.landingIn(document.doc, c.id)); break;
      case 'move': engine.movePlayhead(Number(c.step) || 0); break;
      // = and -: to the next or the previous cue that needs a GO of its own
      case 'sequence': if (!engine.moveSequence(Number(c.step) < 0 ? -1 : 1)) return { error: Number(c.step) < 0 ? 'no cue sequence before this one' : 'no cue sequence after this one' }; return { playhead: engine.playhead };
      // the key (or note) that fired a cue was let go: its second trigger, if it asks for one on release
      case 'release': return { did: engine.released(idOf(c)!) };
      case 'list': if (c.name !== engine.listName && document.doc.lists.some((l) => l.name === c.name)) { engine.selectList(c.name); rowsFor = -1; rev++; } break;
      // by a cue's number; failing that, a section's name ("scene 2"), which lands on its first cue
      case 'jump': {
        if (engine.jumpTo(c.number)) { rowsFor = -1; return { playhead: engine.playhead }; }
        const sec = sections.byName(document.doc, c.number), to = sec && sections.landingIn(document.doc, sec.id);
        if (!to || !engine.jumpTo(to)) return { error: sec ? `nothing after the section ${c.number}` : `no cue numbered ${c.number}` };
        rowsFor = -1; return { section: sec.id, playhead: engine.playhead };
      }
      // Load to Time: the cue standing by starts this far in (negative: this far back from its end; 0 clears it)
      // With a cue named: that cue, standing by or not (a remote's load); its next fire starts there.
      case 'load': {
        const id = c.id != null || c.number != null ? sections.landingIn(document.doc, idOf(c)!) : engine.playhead;
        engine.loadToTime(Number(c.secs) || 0, id);
        if (engine.loaded) lastLoad.set(engine.loaded.id, engine.loaded.at);
        return { loaded: id && id !== engine.playhead ? (engine.loads.has(id) ? { id, at: engine.loads.get(id) } : null) : engine.loaded };
      }
      // (`on` 'bar' | 'beat': it leaves on the track's own next bar line or beat, and is decoded so that lands to the sample)
      case 'seek': if (c.on === 'bar' || c.on === 'beat') return onGrid(c, 0); engine.seek(c.id, Number(c.t) || 0); break;
      // the waveform's Fade to: a crossfade inside the track, where a skip jumps
      case 'fadeto': if (c.on === 'bar' || c.on === 'beat') return onGrid(c, Number(c.secs) || 1.5); engine.fadeTo(c.id, Number(c.t) || 0, Number(c.secs) || 1.5); break;
      // a place marked on a playing track: decode it now, so a Fade to there is a real crossfade
      case 'prepare': { const r = engine.running.get(c.id); if (r && !r.exact) { prepared.add(r.file!); decodeAhead(); } break; }
      // "+ here" in the Playing strip: a marker where the track is at this moment, kept with the cue
      case 'mark-here': {
        const r = engine.running.get(c.id), cue = show.index(document.doc).byId.get(c.id);
        if (!r || !cue || cue.type !== 'audio') return { error: 'that sound is not playing' };
        const at = Math.round(engine.positionOf(r) * 100) / 100, was = cue.markers || [];
        return document.edit([{ op: 'cue.set', id: c.id, props: { markers: [...was, { at, name: `M${was.length + 1}` }].sort((x, y) => x.at - y.at) } }], { label: 'add marker' });
      }
      case 'arm': engine.toggleArm(c.id); break;
      // preview (V): the cue alone, where the playhead is
      // the Live view's launch: as `fire`, but on the next beat or bar of the music playing when the desk is set to
      case 'launch': {
        const id = idOf(c); if (!id || !engine.byId.has(id)) return { error: 'no such cue' };
        if (launches.has(id)) { clearTimeout(launches.get(id)!.timer); launches.delete(id); break; }      // launched again while it waits: called off
        const wait = state.launchQ === 'none' ? null : engine.toNextDownbeat(0.03, state.launchQ === 'beat' ? 'beats' : 'downbeats');
        if (!(wait! > 0.03)) { launchNow(id); break; }
        launches.set(id, { at: Date.now() + wait! * 1000, timer: setTimeout(() => { launches.delete(id); try { launchNow(id); } catch (err) { log(`[live] launch ${id}: ${(err as Error).stack || err}`); } schedulePush(); }, wait! * 1000) });
        break;
      }
      // a setting of the Live view that is the show's (settings.live): one clip per track or overlapping, the desk's tempo
      case 'live-set': {
        const v = c.key === 'overlap' ? !!c.value : c.key === 'tempo' ? (Number(c.value) >= 20 && Number(c.value) <= 400 ? Math.round(Number(c.value) * 100) / 100 : 0) : undefined;
        if (v === undefined) return { error: 'no such setting' };
        if (state.mode === 'show' && c.key !== 'tempo') return { error: 'Show mode: editing is locked' };
        if ((((document.doc.settings.live || {}) as Record<string, unknown>)[c.key] || 0) === (v || 0)) break;
        const r = document.edit([{ op: 'show.set', path: `settings.live.${c.key}`, value: v }], { label: c.key === 'overlap' ? (v ? 'clips overlap' : 'one clip per track') : 'desk tempo' });
        if (c.key === 'tempo') rewarp();
        return r;
      }
      case 'launch-q': state.launchQ = ['none', 'beat', 'bar'].includes(c.q) ? c.q : 'bar'; break;
      case 'tempo-find': return findTempos(c).catch((err) => ({ error: err.message }));
      // a tempo changed by hand in the Clip view: a section's bpm or beats in a bar, "1 is here", a new section (core/audio/tempo.js)
      case 'tempo-edit': {
        const cue = show.index(document.doc).byId.get(c.id);
        if (!cue || cue.type !== 'audio' || !cue.tempo) return { error: 'that sound has no tempo yet' };
        const next = editTempo(cue.tempo, c.edit || {});
        if (!next) return { error: c.edit && c.edit.do === 'split' ? 'a tempo change goes after the start of the section it is in' : c.edit && c.edit.do === 'join' ? 'the first section stays' : 'a tempo is 20 to 400 beats a minute' };
        return document.edit([{ op: 'cue.set', id: c.id, props: { tempo: next } }], { label: { split: 'tempo change', join: 'tempo change removed', one: 'beat one', nudge: 'grid moved', set: 'tempo' }[c.edit.do] || 'tempo' });
      }
      case 'tempo-of': return { tempo: tempos.get(c.file || '') || null, known: tempos.has(c.file || '') };
      case 'fire': { const id = idOf(c); if (!id || !engine.byId.has(id)) return { error: 'no such cue' }; if (routing.settingsOf(document.doc.settings.audio).audition) audition.mark(engine.byId.get(id)!); engine.fire(id); engine.changed(); break; }
      // start, as a trigger or a remote does: the cue and the sequence that continues from it; the playhead stays
      // (a start that says where it came from, a hotkey, a cart, a remote: the same cue started the same way again within
      // the double-GO time is a bounce, ignored and said so. One that does not say is the app's own, and goes.)
      case 'start': {
        const id = idOf(c); if (!id || !engine.byId.has(id)) return { error: 'no such cue' };
        if (c.from) { if (!startBy(id, fromText(c.from), `start ${c.from}`)) return { ignored: 'double GO' }; } else engine.start(id);
        break;
      }
      // (a sound that was not expected to loop is streaming: it is decoded now, and goes round once that lands)
      case 'loop': { const did = engine.toggleHold(c.id, c.region, !!c.free); const r = engine.running.get(c.id); if (did === 'armed' && r && !r.exact) { prepared.add(r.file!); decodeAhead(); } return { did }; }
      // the vamp key (L): the track going round a section is let go; with none held, the next section ahead is armed
      case 'hold': {
        const ids = c.id ? [c.id] : engine.active().filter((a): a is ActiveSound => a.kind === 'audio').sort((a, b) => (b.holding ? 1 : 0) - (a.holding ? 1 : 0) || (b.armed.length ? 1 : 0) - (a.armed.length ? 1 : 0)).map((a) => a.id);
        for (const id of ids) {
          const a = engine.active().find((x) => x.id === id) as ActiveSound | undefined;
          const did = a && !a.holding && a.armed.length ? engine.holdOrLetGo(id, 'let go') : engine.holdOrLetGo(id);
          if (did) { notice(did === 'armed' ? `${a!.name}: will go round its next section until you let go (L)` : did === 'let go' ? `${a!.name}: let go; it plays on after this pass` : `${a!.name}: section disarmed`, 4000); return { did }; }
        }
        return { error: 'nothing playing is looping or has a loop region ahead' };
      }
      case 'lights': engine.setSkipLights(!c.on); saveConfig({ skipLights: !c.on }); break;
      case 'mode': { const was = state.mode; state.mode = c.mode === 'show' ? 'show' : 'edit'; if (was !== state.mode) showLog.add('show', state.mode === 'show' ? 'Show mode' : 'Edit mode'); break; }

      // editing
      case 'edit': {
        const onlyPatch = document.doc.settings.network.patches.length === 1 ? document.doc.settings.network.patches[0].id : null;
        const r = document.edit(c.ops, { label: c.label || '' });
        // a cue that sent to "the only patch" goes on sending to it when a second patch is added
        if (onlyPatch && document.doc.settings.network.patches.length > 1 && document.doc.settings.network.patches.some((p) => p.id === onlyPatch)) {
          const fix: EditOp[] = [];
          show.walk(document.doc, (q) => { if (q.type === 'network' && !q.patch) fix.push({ op: 'cue.set', id: q.id, props: { patch: onlyPatch } }); });
          if (fix.length) { document.edit(fix, { label: 'keep cues on their patch' }); notice(`${fix.length} Network cue${fix.length === 1 ? ' stays' : 's stay'} on ${document.doc.settings.network.patches[0].name}.`, 6000); }
        }
        // the web remote's key is written down when the remote is first switched on, so the file says what the address is
        const wr = (document.doc.modules || {})['web-remote'];
        if (wr && wr.enabled && !String(wr.key || '').trim()) document.edit([{ op: 'show.set', path: 'modules.web-remote.key', value: remoteKey() }], { label: 'web remote key' });
        return r;
      }
      // the cue clipboard (core/show/clipboard.js): this computer's, so it is still there when another show is opened
      case 'clip-copy': {
        clip = clipboard.take(document.doc, c.ids || [], { showDir: document.showDir, cut: !!c.cut });
        if (!clip.cues.length) { clip = null; return { error: 'select a cue first' }; }
        return { count: clip.cues.length, cut: clip.cut };
      }
      case 'clip-info': return { clip: clip ? { count: clip.cues.length, cut: clip.cut, same: clipboard.sameShow(clip, document.doc, document.showDir), cue: clip.cues[0], properties: clipboard.properties(clip.cues[0]) } : null };
      case 'clip-paste': {
        if (!clip) return { error: 'nothing to paste: copy a cue first' };
        const where = c.after ? { after: c.after } : c.before ? { before: c.before } : c.parent ? { parent: c.parent } : { list: (document.doc.lists.find((l) => l.name === engine.listName) || document.doc.lists[0]).id };
        const p = clipboard.pasteOps(clip, document.doc, where, { fileFor: (abs) => adopt(abs), showDir: document.showDir });
        const r = document.edit(p.ops, { label: p.moved ? 'move' : `paste ${p.count} cue${p.count === 1 ? '' : 's'}` });
        if (p.moved) clip = { ...clip, cut: false };        // moved once; a second paste makes them again
        return { ...r, moved: p.moved, count: p.count, made: p.moved ? clip.ids : p.ops.filter((o) => o.op === 'cue.add').map((o) => (r.refs || {})[o.ref!]).filter(Boolean), fromAnotherShow: !p.same };
      }
      // Paste Cue Properties: the chosen fields of the cue on the clipboard, onto the cues named
      case 'clip-props': {
        if (!clip) return { error: 'nothing to paste from: copy a cue first' };
        const { byId } = show.index(document.doc);
        const ops = clipboard.propertyOps(clip.cues[0], (c.ids || []).map((id) => byId.get(id)).filter(Boolean), c.keys || []);
        if (!ops.length) return { error: 'none of the selected cues has those properties' };
        return { ...document.edit(ops, { label: 'paste cue properties' }), count: ops.length };
      }
      // a sound file dropped on an Audio cue: the cue plays that file from now on
      case 'retarget': {
        const cue = show.index(document.doc).byId.get(c.id);
        if (!cue || cue.type !== 'audio') return { error: 'only an Audio cue takes a sound file' };
        if (!AUDIO_EXT.test(String(c.path || ''))) return { error: 'not a sound file: wav, aiff, mp3, m4a, flac or ogg' };
        return document.edit([{ op: 'cue.set', id: cue.id, props: { file: adopt(c.path) } }], { label: 'file' });
      }
      // cue templates (core/show/templates.js): new cues of this cue's type start like it, or (clear) plain again
      case 'template': {
        const cue = c.id ? show.index(document.doc).byId.get(c.id) : null;
        const type = cue ? cue.type : c.type;
        if (!cueTypes.TYPES[type as CueType]) return { error: 'no such cue type' };
        return document.edit([{ op: 'show.set', path: `settings.templates.${type}`, value: cue && !c.clear ? templates.templateOf(cue) : undefined }], { label: `${cueTypes.TYPES[type as CueType].label} template` });
      }
      case 'undo': if (!document.undo()) return { error: 'nothing to undo' }; break;
      case 'redo': if (!document.redo()) return { error: 'nothing to redo' }; break;
      case 'import': return importFiles(c.paths || [], c);

      // the mixer: a fader moves the sound at once; `commit` (on release) writes it to the show
      case 'bus': {
        audioCmd({ op: 'bus', name: c.name, db: Number(c.db) || 0, secs: 0.03 });
        liveBus.delete(c.name);
        if (c.commit) { const i = document.doc.settings.audio.buses.findIndex((b) => b.id === c.name); if (i >= 0) document.edit([{ op: 'show.set', path: `settings.audio.buses.${i}.db`, value: Math.round(Number(c.db) * 10) / 10 }], { label: `${c.name} fader` }); }
        break;
      }
      // the Live view's strips: heard as the control moves; `commit` (on release) writes it to the show
      case 'strip': {
        const i = document.doc.settings.audio.buses.findIndex((b) => b.id === c.name);
        const v = cleanSetting(c.key, c.value);
        if (i < 0 || v === undefined) return { error: 'no such bus or setting' };
        handOn(c.name, c.key);
        if (!c.commit) { sendStrips({ name: c.name, key: c.key, value: v }); break; }
        // a setting back at rest is taken out of the file, so a show that uses none of this reads as it always did
        const rest = v === 0 || v === false || v === '';
        const now = c.key.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), document.doc.settings.audio.buses[i]);
        if (rest && now === undefined) { sendStrips(); break; }
        return document.edit([{ op: 'show.set', path: `settings.audio.buses.${i}.${c.key}`, value: rest ? undefined : v }], { label: `${c.name} ${c.key.replace('eq.', 'eq ')}` });
      }
      case 'crossfader': {
        const v = Math.max(-1, Math.min(1, Math.round((Number(c.value) || 0) * 100) / 100));
        liveXf = undefined;
        if (!c.commit) { sendStrips({ crossfader: v }); break; }
        if (v === 0 && document.doc.settings.audio.crossfader === undefined) { sendStrips(); break; }
        return document.edit([{ op: 'show.set', path: 'settings.audio.crossfader', value: v === 0 ? undefined : v }], { label: 'crossfader' });
      }
      case 'solo': {
        if (c.name == null) solo.clear(); else if (c.on === false || (c.on === undefined && solo.has(c.name))) solo.delete(c.name); else { if (c.only) solo.clear(); solo.add(c.name); }
        sendStrips();
        break;
      }
      // ── the desk played from keys and a controller (settings.live.map; core/audio/desk-map.js) ──
      // a control moved by a controller: heard and shown, and not the show's until a hand writes it
      case 'desk-live': {
        const a = document.doc.settings.audio;
        if (c.key === 'crossfader') { liveXf = Math.max(-1, Math.min(1, Number(c.value) || 0)); sendStrips(); break; }
        if (c.key === 'master') { liveMaster = Math.max(-60, Math.min(12, Number(c.value) || 0)); if (!state.muted) audioCmd({ op: 'masterDb', db: liveMaster }); break; }
        if (!a.buses.some((b) => b.id === c.name)) return { error: 'no such bus' };
        if (c.key === 'db') { const d = Math.max(-60, Math.min(12, Number(c.value) || 0)); liveBus.set(c.name!, d); audioCmd({ op: 'bus', name: c.name, db: d, secs: 0.03 }); break; }
        const v = cleanSetting(c.key, c.value);
        if (v === undefined) return { error: 'no such setting' };
        liveStrip.set(c.name!, { ...(liveStrip.get(c.name!) || {}), [c.key]: v });
        sendStrips();
        break;
      }
      // a track's on/off button, pressed (as a click on it: written to the show)
      case 'mute': { const b = document.doc.settings.audio.buses.find((x) => x.id === c.name); if (!b) return { error: 'no such bus' }; return run({ op: 'strip', name: c.name, key: 'mute', value: !busNow(b).mute, commit: true }); }
      // a track's ■: every clip on it stops; Stop All Clips: every sound
      case 'stop-track': case 'stop-clips': {
        for (const id of [...engine.running.keys()]) { const q = engine.byId.get(id); if (q && q.type === 'audio' && (c.op === 'stop-clips' || q.bus === c.name)) engine.stopCue(id); }
        break;
      }
      case 'map-in': {
        let did = 0;
        for (const hit of deskMap.matching((document.doc.settings.live || {}).map, String(c.on || ''))) { const act = deskMap.actionOf(hit.to, { type: 'key', value: 1 }); if (act) { did++; const r = run(act as HostCommand); if (r && (r as HostResult).error) return r; } }
        return { did };
      }
      // Map mode: give a key or a MIDI control to a desk control (`on` null: take its mappings away)
      case 'map-set': {
        if (!deskMap.parseTo(c.to) || (c.on != null && !deskMap.parseOn(c.on))) return { error: 'that cannot be mapped' };
        return document.edit([{ op: 'show.set', path: 'settings.live.map', value: deskMap.assign((document.doc.settings.live || {}).map, c.on == null ? null : c.on, c.to) }], { label: c.on == null ? 'mapping removed' : `${c.on} mapped` });
      }
      // …the next MIDI control moved is the one
      case 'map-learn': {
        if (!deskMap.parseTo(c.to)) return { error: 'that cannot be mapped' };
        if (mapLearner) { clearTimeout(mapLearner.timer); mapLearner.resolve(null); }
        return new Promise<string | null>((resolve) => { mapLearner = { resolve, timer: setTimeout(() => { mapLearner = null; resolve(null); }, Number(c.ms) || 30000) }; })
          .then((on) => (on ? cmd({ op: 'map-set', on, to: c.to }) : { none: true }));
      }
      case 'map-learn-cancel': if (mapLearner) { clearTimeout(mapLearner.timer); mapLearner.resolve(null); mapLearner = null; } break;
      // the desk as it stands, kept in a Mix cue (a new one after the cue standing by, or the Mix cue named): its levels and every strip
      case 'desk-keep': {
        const a = document.doc.settings.audio;
        const desk = deskOf(a.buses.map(busNow), crossfaderNow());
        const levels = Object.fromEntries(a.buses.map((b) => [b.id, liveBus.has(b.id) ? liveBus.get(b.id) : Number(b.db) || 0]));
        const { byId } = show.index(document.doc);
        if (c.id) {
          if (!byId.has(c.id) || byId.get(c.id)!.type !== 'mix') return { error: 'that is not a Mix cue' };
          return document.edit([{ op: 'cue.set', id: c.id, props: { desk, ...(c.levels === false ? {} : { levels }) } }], { label: 'desk kept in the cue' });
        }
        const list = document.doc.lists.find((l) => l.name === engine.listName) || document.doc.lists[0];
        const after = engine.playhead && list.cues.some((q) => q.id === engine.playhead) ? engine.playhead : null;
        return document.edit([{ op: 'cue.add', ref: 'desk', cue: { type: 'mix', name: c.name || 'Desk', levels, desk }, ...(after ? { after } : { list: list.id }) }], { label: 'desk kept as a Mix cue' });
      }
      // one playing sound's level, for this playing only (the cue keeps its own)
      case 'level': { if (!engine.running.has(c.id)) return { error: 'that is not playing' }; engine.fadeAudio(c.id, Math.max(-60, Math.min(Math.max(12, engine.limits ? engine.limits.max : 12), Number(c.db) || 0)), 0.05, false, `level:${c.id}`); break; }
      case 'master': {
        liveMaster = undefined;
        if (!state.muted) audioCmd({ op: 'masterDb', db: Number(c.db) || 0 });
        if (c.commit) document.edit([{ op: 'show.set', path: 'settings.audio.masterDb', value: Math.round(Number(c.db) * 10) / 10 }], { label: 'master fader' });
        break;
      }
      case 'device': {
        outWatch = deviceWatch.step(outWatch, { type: 'chosen', id: c.id, label: (state.devices.find((d) => d.id === c.id) || {}).label || c.label || '' }).state;
        if (smoke) { state.device = c.id || 'default'; break; }      // (a test run opens no device: the choice is only noted)
        audioCmd({ op: 'sink', id: c.id });
        break;
      }
      // a Fade cue's "set level from target": its level becomes the level its target has now (playing) or starts at
      case 'fade-from-target': {
        const f = show.index(document.doc).byId.get(idOf(c)!);
        const t = f && f.type === 'fade' && show.index(document.doc).byId.get(f.target!);
        if (!t) return { error: 'that Fade cue has no target' };
        const under = t.type === 'group' ? [...engine.running.keys()].filter((k) => engine.isInside(k, t.id)) : [t.id];
        const r = under.map((k) => engine.running.get(k)).find(Boolean);
        const first = show.index(document.doc).byId.get(under[0]) || t;
        const db = r ? (r.fade ? r.fade.to : r.db) : Number(first.gainDb) || 0;
        const rate = r ? Math.round(engine.rateOf(r) * 1000) / 1000 : Number(first.rate) || 1;
        document.edit([{ op: 'cue.set', id: f.id, props: { db: Math.round(db * 10) / 10, relative: false, ...(f.rate !== undefined ? { rate } : {}) } }], { label: 'level from target' });
        return { db, playing: !!r };
      }
      // "revert fade": what a Fade cue moved goes back to how it was before it fired
      case 'revert-fade': {
        const id = idOf(c)!;
        if (!engine.reverts.has(id)) return { error: 'that Fade cue has nothing to put back' };
        const n = engine.revertFade(id);
        return n ? { reverted: n } : { error: 'what it faded has stopped' };
      }
      // the network: a patch's Test button, the monitor, a message sent by hand, and "learn" for a trigger
      case 'net-test': return { sent: hub.test(c.patch, c.text || '') };
      case 'net-send': return { sent: hub.send(c.patch || null, String(c.text || ''), { label: 'by hand' }) };
      case 'net-monitor': return { entries: hub.monitor(Number(c.since) || 0) };
      case 'net-clear': hub.clearMonitor(); break;
      case 'osc-learn': {
        learning = true; configureNetwork();
        return hub.learn(Number(c.ms) || 15000).then((m) => { learning = false; configureNetwork(); schedulePush(); return m ? { learned: m } : { error: `Nothing arrived on port ${document.doc.settings.network.inputPort}.` }; });
      }
      case 'osc-learn-cancel': hub.cancelLearn(); break;
      // Hold (H): the track playing goes round the section it is in (or the next) until H again
      case 'hold-all': engine.setHold(); return { held: engine.held };
      case 'record': { if (c.on === false || (c.on === undefined && recording)) { const r = stopRecording(); if (r) notice(`Recorded ${Math.round(r.secs)} s: recordings/${path.basename(r.file)}`, 7000); return { stopped: r }; } return startRecording(); }
      // sounds whose files are missing, looked for by name in a folder (and the folders in it); found ones are re-aimed as one edit
      case 'relink': {
        const missing: Cue[] = [];
        show.walk(document.doc, (q) => { if ((q.type === 'audio' || q.type === 'video') && q.file && !(document.resolveFile(q.file) && fs.existsSync(document.resolveFile(q.file)!))) missing.push(q); });
        if (!missing.length) return { missing: 0, found: 0 };
        const names = new Map<string, string>();
        const look = (dir: string, depth: number) => { let list: fs.Dirent[] = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const d of list) { const p = path.join(dir, d.name); if (d.isDirectory()) { if (depth < 4 && !d.name.startsWith('.')) look(p, depth + 1); } else if ((AUDIO_EXT.test(d.name) || mediaKind(d.name)) && !names.has(d.name.toLowerCase())) names.set(d.name.toLowerCase(), p); } };
        look(String(c.dir || ''), 0);
        const ops: EditOp[] = [];
        for (const q of missing) { const hit = names.get(path.basename(String(q.file).split('\\').join('/')).toLowerCase()); if (hit) ops.push({ op: 'cue.set', id: q.id, props: { file: adopt(hit) } }); }
        if (ops.length) document.edit(ops, { label: `relink ${ops.length} sound${ops.length === 1 ? '' : 's'}` });
        return { missing: missing.length, found: ops.length };
      }
      case 'midi-send': return { sent: sendMidi(String(c.text || ''), { label: 'by hand' }) };
      case 'midi-learn': {
        if (midiLearner) { clearTimeout(midiLearner.timer); midiLearner.resolve(null); }
        return new Promise((resolve) => { midiLearner = { resolve, timer: setTimeout(() => { midiLearner = null; resolve(null); }, Number(c.ms) || 15000) }; })
          .then((m) => { schedulePush(); return m ? { learned: m } : { error: state.midi.inputs.length ? 'No MIDI message arrived.' : 'No MIDI input is connected to this computer.' }; });
      }
      case 'midi-learn-cancel': if (midiLearner) { clearTimeout(midiLearner.timer); midiLearner.resolve(null); midiLearner = null; } break;
      // sounds in the show's media folder that no cue uses (a file that was replaced): listed, and moved to the Trash when asked
      case 'media-unused': return { files: unusedMedia() };
      case 'media-clean': return cleanMedia();
      case 'peaks': { const p = peaksFor(c.file, !!c.detail); const ok = p && typeof p === 'object'; return { file: c.file, peaks: ok ? p.peaks : null, rms: ok ? p.rms : null, pending: p === 'pending' }; }

      // versions
      case 'versions': return { versions: document.listVersions().slice().reverse() };
      // Nothing is kept until this: write the show and record a version of it.
      case 'save':
      case 'save-version': {
        if (!document.showDir) return { needsFolder: true };
        const v = document.save({ note: c.note || '' });
        if (!away) keepMine(document.showDir, document.doc.id);      // (last saved here: this computer's. A show from elsewhere is not made so by a save)
        showLog.add('show', `saved${c.note ? `: ${c.note}` : ''}`);
        return v ? { version: v } : { version: { ...(document.listVersions().at(-1) || {}), same: true } };
      }
      case 'revert': if (!document.revert()) return { error: 'nothing to revert' }; break;
      // one pending change put back to its saved value (a setting by path; a cue's field is an ordinary cue.set)
      case 'unset': {
        const keys = String(c.path || '').split('.');
        let v: unknown = document.saved;
        for (const k of keys) v = v == null ? undefined : (v as Record<string, unknown>)[k];
        return document.edit([{ op: 'show.set', path: c.path, value: v }], { label: 'put back' });
      }
      case 'compare-version': if (!document.showDir) return { error: 'this show has no versions yet' }; return document.compareVersion(c.id, c.other || null);
      case 'restore-version': return { version: document.restoreVersion(c.id) };

      // proposals (the assistant's edits, reviewed before they land)
      case 'accept': return document.accept(c.id);
      case 'reject': document.reject(c.id); break;
      case 'ask': if (!assistant) return { error: 'the assistant is not available' }; agentSessions.delete('app');      // (a draft the last turn edited and never proposed does not carry into this one)
        return assistant.ask(c.text, { document, engine, rig: rig.service, ui: pointer, canApply: () => state.mode !== 'show' });
      // pointing at a place in the window (core/ui/places.js): the assistant's, or a test's; `pointed` is the window's answer
      case 'point': { const r = require('../../core/ui/places').resolve(c.target, { doc: document.doc, cue: c.cue || null }); if (!r.ok) return { error: r.why }; if (r.place.sel === null) return { ok: false, words: r.place.words }; return pointer.point({ ...r.place, say: String(c.say || '').slice(0, 80), cue: c.cue || null }); }
      case 'pointed': pointer.answered(c); break;
      case 'assistant-reset': if (assistant) assistant.reset(); agentSessions.delete('app'); break;
      case 'assistant-config': if (assistant) assistant.configure(c.config || {}); break;

      // a show from another computer: its network features turned on, here and from now on for this show on this computer.
      // Only from this computer's own window (nothing that came in over the network can ask, and nothing can while it is off).
      case 'turn-on': {
        if (c.from) return { error: 'only from this computer' };
        if (!away) return { on: true };
        away = false; document.localOnly = false;
        keepMine(document.showDir, document.doc.id);
        holdOut();
        log('[show] network features turned on for this show');
        showLog.add('show', 'Network features turned on for this show.');
        applyDocument('turn-on');
        probe(); decodedKey = ''; decodeAhead();      // (its sounds on another computer's share are opened now)
        return { on: true };
      }
      // an output held back for a rehearsal, or let go again: { what: 'osc' | 'midi' | 'timecode' | 'dmx', on } (on left out: the other way)
      case 'override': {
        if (!OVERRIDES.some((o) => o.id === c.what)) return { error: `no such output (${OVERRIDES.map((o) => o.id).join(', ')})` };
        overrides[c.what] = c.on === undefined ? !overrides[c.what] : !!c.on;
        holdOut();
        // (LTC that is running stops as timecode is held, and starts again, where it would have got to, as it is let go)
        if (c.what === 'timecode') for (const [key, on] of ltcRuns) audioCmd(overrides.timecode ? { op: 'ltc', key, on: false } : on);
        saveConfig({ overrides: { ...overrides } });
        log(`[override] ${c.what} out ${overrides[c.what] ? 'HELD BACK' : 'sent again'}`);
        return { overrides: { ...overrides } };
      }
      // timed backups (core/show/backups.js): the list, one taken now, and going back to one (an edit: undoable, unsaved)
      case 'backups': return { backups: backupDir() ? backups.list(backupDir()!).map(({ name, day, time, bytes }) => ({ name, day, time, bytes })) : [], dir: backupDir() };
      case 'backup-now': { const b = backupNow(); return { backup: b ? { name: b.name, day: b.day, time: b.time } : null }; }
      case 'restore-backup': {
        if (!backupDir()) return { error: 'this show has no backups' };
        const changed = document.replace(backups.read(backupDir()!, c.name), { label: `backup of ${String(c.name).replace(/\.json$/, '')}` });
        return { restored: changed };
      }
      // Run from here: what would be going on at a cue had the show run to it, said first (`preview`), then started
      // (core/engine/run-from.js). A rehearsal's tool: Show mode refuses it, so a show running is never reset by it.
      case 'run-from': {
        if (state.mode === 'show') return { error: 'Show mode: Run from here is for rehearsals. Switch to Edit.' };
        const asked = idOf(c);
        const id = asked && engine.byId.has(asked) ? sections.landingIn(document.doc, engine.topOf(asked)) : asked && sections.landingIn(document.doc, asked);
        if (!id || !engine.byId.has(id)) return { error: 'no such cue' };
        const p = runFrom.plan(document.doc, id, { durations: Object.fromEntries(engine.durations), skipLights: engine.skipLights, disarmed: [...engine.disarmed] });
        if (p.error) return p;
        const name = (x: { id: string; number?: string; name?: string }) => `${x.number ? `${x.number} · ` : ''}${labels[x.id] || x.name || ''}`;
        const lines = [...p.sounds.map((x) => `${name(x)} · ${dbText(x.db)}${x.at > 0 ? ` · from ${cueTypes.formatSeconds(x.at, 1)}` : ''}`), ...p.sends.map(name)];
        if (c.preview) return { text: p.text, lines, playing: engine.running.size > 0 || engine.waits.size > 0, from: id };
        // everything stops dead first (the hard Esc), then what the show would have left is started
        clearLaunches(); audition.clear();
        engine.panic(); engine.panic(); playlog.endAll(); audioCmd({ op: 'stopAll' }); lighting.panic(true, 0);
        runFrom.apply(engine, p);
        showLog.add('show', `run from ${name({ id, number: (engine.byId.get(id) || {}).number })}: ${p.text}`);
        rowsFor = -1;
        return { ok: true, text: p.text, playhead: engine.playhead };
      }
      // Check the show: everything that would go wrong in it, without playing anything (core/show/check.js)
      case 'check': { const snap = snapshot(false); const lines = showCheck.checkShow(document.doc, { problems: snap.problems, rig: snap.rig.items, triggers: triggerRows }); return { lines, summary: showCheck.summary(lines) }; }
      // the Log view: the lines after `since`, and where the sitting's file is
      case 'log-tail': return { lines: showLog.since(Number(c.since) || 0, 1000), file: showLog.file ? `${showLog.file}.log` : null, dir: showLog.dir };
      // the playback log: what played, when and for how long
      case 'playlog': return { entries: playlog.entries().slice(-(Number(c.last) || 200)), file: playlogFile() };
      // another show's settings (a file written by Export Settings) brought into this one: one undoable edit
      case 'settings-import': {
        const ops = showTemplates.settingsOps(c.file, document.doc);
        const r = document.edit(ops, { label: `settings from ${String((c.file && c.file.from) || 'a file').slice(0, 60)}` });
        return { changed: !!r.changed };
      }
      // files for the show folder, staged for review like any proposal (they are written when it is accepted): a prop's
      // firmware from the kit, and the guide for coding agents. Each module is asked for here, so the app runs without it.
      case 'prop-files': {
        const device = rigDevices.find(document.doc, c.device);
        if (!device) return { error: `no device with the id ${c.device}` };
        const files = require('../../core/kit/kit').files(device, c.options || {});
        const p = document.proposeDocument(document.doc, { summary: `Firmware for ${device.name}`, author: 'you', files });
        return { proposal: p.id, files: p.files.map((f) => f.path) };
      }
      case 'agent-guide': {
        const files = require('../../core/assistant/guide').agentGuide(document.doc, { showDir: document.showDir, bin: path.join(__dirname, '../../bin') });
        const p = document.proposeDocument(document.doc, { summary: 'The guide for coding agents', author: 'you', files });
        return { proposal: p.id, files: p.files.map((f) => f.path) };
      }
      case 'import-seen': state.imported = null; break;
      case 'added-seen': state.added = null; break;
      // an older show's one ducking pair, made ducking by kind: the same depth and times, on the kind its target is
      case 'ducking-by-kind': return document.edit([{ op: 'show.set', path: 'settings.audio.ducking', value: kinds.duckingFromPair(document.doc.settings.audio) }], { label: 'ducking by kind' });
      case 'state': sentRev.clear(); break;       // a page that has just loaded: everything, once
      default: return { error: `unknown command ${c.op}` };
    }
    return null;
  }

  /** Sound files dropped on the list (or picked): copied into the show's media folder, one Audio cue each. */
  function importFiles(paths: string[], opts: ImportOptions = {}): HostResult | Promise<HostResult> {
    if (document.doc.settings.audio.sortNew === true) return importSorted(paths, opts);     // (asked for in Settings ▸ Audio: below)
    const sounds = paths.filter((p) => AUDIO_EXT.test(p));
    const music = document.doc.settings.audio.buses.find((b) => b.id === 'music');
    // no bus asked for: a long sound is music, a short one an effect. Their lengths are measured first.
    // (only when the show asks for it, Settings ▸ Show: by itself a new sound goes on the bus every Audio cue starts on)
    if (!(document.doc.settings.editing || {}).longSoundsToMusic) return addSounds(paths, opts);
    if (opts.bus || !music || !state.audioReady || !sounds.length) return addSounds(paths, opts);
    const measure = (p: string) => new Promise<number>((resolve) => {
      probeWaits.set(p, resolve);
      setTimeout(() => { if (probeWaits.get(p) === resolve) { probeWaits.delete(p); resolve(0); } }, 4000);
    });
    const waits = sounds.map(measure);
    audioCmd({ op: 'probe', files: sounds.map((p) => ({ file: p, url: pathToFileURL(p).href })) });
    return Promise.all(waits).then((secs) => {
      const busOf = Object.fromEntries(sounds.map((p, i) => [p, secs[i] >= MUSIC_SECS ? 'music' : null]));
      try {
        const r = addSounds(paths, { ...opts, busOf });
        const n = Object.values(busOf).filter(Boolean).length;
        if (n && !r.error) notice(`${n === sounds.length ? (n === 1 ? 'Added' : `All ${n} added`) : `${n} of ${sounds.length} added`} on the ${music.name} bus: 30 s or longer counts as music.`, 7000);
        return r;
      } catch (err) { return { error: (err as Error).message }; }
    });
  }
  /** With "Sort new sounds by kind" on (settings.audio.sortNew; it is off unless a person turned it on), and no
   *  bus asked for: each sound is listened to first and put on the show's first bus of the kind it sounds
   *  like (core/audio/kinds.js `guessKind`: speech, a steady pulse, short, long and steady), and what was guessed
   *  is shown for the person to confirm or change (`state.added`: the chooser in the window). A guess is never
   *  silent, and a template that names a bus is kept over it. */
  function importSorted(paths: string[], opts: ImportOptions = {}): HostResult | Promise<HostResult> {
    const sounds = paths.filter((p) => AUDIO_EXT.test(p));
    if (opts.bus || !state.audioReady || !sounds.length) return addSounds(paths, opts);
    const audio = document.doc.settings.audio;
    // (the same small decode its tempo is found in; a sound that cannot be read in time is added with no guess)
    const hear = (p: string) => Promise.race([(guessWanted.add(p), tempoIn(p)).then(() => kindGuess.get(p) || null), new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000))]);
    return Promise.all(sounds.map(hear)).then((guesses) => {
      const busOf: Record<string, string | null> = {}, more: Record<string, { loop: boolean }> = {};
      sounds.forEach((p, i) => {
        const g = guesses[i];
        busOf[p] = g ? kinds.busFor(audio, g.kind) : null;
        if (g && g.kind === 'ambience' && busOf[p]) more[p] = { loop: true };             // a bed goes round
      });
      try {
        const r = addSounds(paths, { ...opts, busOf, more });
        if (r.error || !r.refs) return r;
        const tplBus = (templates.templateFor(document.doc, 'audio') || {}).bus;
        const items = sounds.map((p, i): NonNullable<HostRun['added']>['items'][number] | null => {
          const id = r.refs[`imp${paths.filter((x) => AUDIO_EXT.test(x) || MIDI_EXT.test(x) || mediaKind(x)).indexOf(p)}`];
          const c = id && show.index(document.doc).byId.get(id), g = guesses[i];
          return c ? { id, name: path.basename(p), kind: g ? g.kind : null, why: g ? g.why : 'it could not be listened to in time', bus: c.bus || 'effects', loop: !!c.loop, template: !!tplBus } : null;
        }).filter((x) => x !== null);
        const names: Record<string, string> = Object.fromEntries(audio.buses.map((b) => [b.id, b.name]));
        if (items.length === 1) {
          const it = items[0];
          notice(`Added on the ${names[it.bus] || it.bus} bus${it.template ? ', from the template' : it.kind ? `: it sounds like ${it.kind}` : ''}${it.loop ? ', as a loop' : ''}.`, 8000);
        } else if (items.length > 1) { state.added = { at: Date.now(), items }; schedulePush(); }
        return r;
      } catch (err) { return { error: (err as Error).message }; }
    });
  }
  function addSounds(paths: string[], { after = null, parent = null, list = null, cell = null, copy = true, bus = null, busOf = {}, more = {} }: ImportOptions = {}): HostResult {
    const ops: EditOp[] = [];
    let anchor = after;
    let n = 0;
    for (const p of paths) {
      const picture = !AUDIO_EXT.test(p) && !MIDI_EXT.test(p) && mediaKind(p);        // a video or a still dropped in: a Video cue
      const kind = MIDI_EXT.test(p) ? 'midifile' : picture ? 'video' : AUDIO_EXT.test(p) ? 'audio' : null;
      if (!kind) continue;
      const file = adopt(p, copy);
      const ref = `imp${n++}`;
      // (`list` and `cell`: sounds dropped on a cart's button; the first takes that button, the rest the free ones after it)
      // (the show's template for the cue's type first; a bus it names is kept over the guess from the sound's length)
      const tpl = templates.templateFor(document.doc, kind);
      ops.push({ op: 'cue.add', ref, cue: { type: kind, ...tpl, file, ...(kind === 'audio' && (bus || (!tpl.bus && busOf[p])) ? { bus: bus || busOf[p], ...(!bus && more[p] ? more[p] : {}) } : {}), ...(cell && n === 1 ? { cell } : {}) }, ...(anchor ? { after: anchor } : parent ? { parent } : { list: list || (document.doc.lists.find((l) => l.name === engine.listName) || document.doc.lists[0]).id }) });
      anchor = `@${ref}`;
    }
    if (!ops.length) return { error: 'no sound or MIDI files there' };
    return document.edit(ops, { label: `add ${ops.length} sound${ops.length === 1 ? '' : 's'}` });
  }
  /** A sound file made the show's: copied into its media folder (unless it is already inside the show), and
   *  named relative to the show so the folder can move. An untitled show keeps the absolute path until it is saved. */
  function adopt(p: string, copy = true) {
    if (!document.showDir) return p;
    const rel = path.relative(document.showDir, p);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
    if (!copy) return p;
    const media = path.join(document.showDir, 'media');
    fs.mkdirSync(media, { recursive: true });
    let name = path.basename(p), k = 1;
    while (fs.existsSync(path.join(media, name)) && !sameFile(path.join(media, name), p)) name = `${path.basename(p, path.extname(p))}-${++k}${path.extname(p)}`;
    if (!fs.existsSync(path.join(media, name))) fs.copyFileSync(p, path.join(media, name));
    return `media/${name}`;
  }
  /** Files in the show's media folder that neither the show as it is nor the show as saved plays. */
  function unusedMedia() {
    if (!document.showDir) return [];
    const media = path.join(document.showDir, 'media');
    const used = new Set();
    for (const d of [document.doc, document.saved]) if (d) show.walk(d, (c) => { if (c.file) used.add(String(c.file).split('\\').join('/')); });
    let names = [];
    try { names = fs.readdirSync(media); } catch { return []; }
    return names.filter((n) => AUDIO_EXT.test(n) && !used.has(`media/${n}`)).map((n) => ({ name: n, bytes: fs.statSync(path.join(media, n)).size }));
  }
  async function cleanMedia() {
    if (!trash) return { error: 'cannot move files to the Trash on this computer' };
    const files = unusedMedia();
    let moved = 0;
    for (const f of files) { try { await trash(path.join(document.showDir!, 'media', f.name)); moved++; } catch (err) { log(`[show] could not move ${f.name} to the Trash: ${(err as Error).message}`); } }
    return { moved, of: files.length };
  }
  /** The same sound: the same bytes (a copy has a new date, so the date says nothing). */
  function sameFile(a: string, b: string) {
    try {
      if (fs.statSync(a).size !== fs.statSync(b).size) return false;
      const hash = (p: string) => (require('crypto') as typeof import('crypto')).createHash('sha1').update(fs.readFileSync(p)).digest('hex');
      return hash(a) === hash(b);
    } catch { return false; }
  }

  // ── opening shows ─────────────────────────────────────────────────────
  // which shows are this computer's own (core/show/trust.js): kept in config.json as `shows`
  let shows: TrustRecord | null = null;
  function record() {
    if (shows) return shows;
    const c = getConfig() || {};
    if (c.shows && typeof c.shows === 'object') shows = { ...c.shows };
    else { shows = trust.firstRecord(c); saveConfig({ shows }); }      // (the first time: the recent shows are this computer's)
    return shows;
  }
  function keepMine(dir: string | null, id: string) { if (!dir) return; shows = trust.remember(record(), dir, id); saveConfig({ shows }); }
  /** Whether a show folder is this computer's: made here just now, in this computer's own settings folder (the demo),
   *  in the record, or (a test run, which makes its own shows) any show not opened `elsewhere`. */
  function isMine(doc: ShowDocument, showDir: string, elsewhere: boolean) {
    if (doc.made) return true;
    if (userDir) { const rel = path.relative(trust.keyOf(userDir), trust.keyOf(showDir)); if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return true; }
    if (trust.isMine(record(), showDir, doc.doc.id)) return true;
    return smoke && !elsewhere;
  }
  /** `elsewhere`: a test run's way of opening a show as one from another computer. */
  function open(showDir: string, keep = false, { elsewhere = false } = {}) {
    const doc = ShowDocument.open(showDir);
    away = !isMine(doc, showDir, elsewhere);
    doc.localOnly = away;
    if (doc.made) keepMine(showDir, doc.doc.id);
    holdOut();
    bind(doc, keep);
    if (away) { log(`[show] ${showDir} came from another computer: its network features are off until they are turned on`); showLog.add('show', 'This show came from another computer: its network features are off until you turn them on.'); }
    const recent = [showDir, ...((getConfig() || {}).recent || []).filter((p) => p !== showDir)].slice(0, 8);
    saveConfig({ lastShow: showDir, recent });
    log(`[show] opened ${showDir}${doc.warnings.length ? ` (${doc.warnings.length} warnings)` : ''}${doc.recovered ? ' with unsaved changes from last time' : ''}`);
    if (doc.recovered) notice('Unsaved changes from last time are back. Save keeps them; Revert discards them.', 9000);
    return doc;
  }
  /** A show made here (new, imported, from a template): this computer's. */
  function madeHere() { away = false; holdOut(); }
  function openUntitled() { madeHere(); bind(new ShowDocument()); saveConfig({ lastShow: null }); }
  /** A show read from another program's file (a QLab workspace): open, untitled, with the report of what came across. */
  function openImported(doc: ShowDoc, report: ImportReport) {
    madeHere();
    bind(new ShowDocument({ doc }));
    saveConfig({ lastShow: null });
    state.imported = report;
    endAtFileEnd = new Set(report.endAtFileEnd || []);
    log(`[show] imported ${report.source}: ${report.counts.cues} cues, ${report.issues.length} notes`);
    schedulePush();
  }
  /** A new show started from a template (core/show/show-templates.js): open, untitled, nothing saved. */
  function openTemplate(doc: ShowDoc) { madeHere(); bind(new ShowDocument({ doc })); saveConfig({ lastShow: null }); log(`[show] new from a template: ${doc.lists.reduce((n, l) => n + l.cues.length, 0)} cues`); }
  /** Save an untitled show (or a copy of this one) to a new folder and carry on there. */
  function saveAs(showDir: string) {
    fs.mkdirSync(path.join(showDir, 'media'), { recursive: true });
    const was = document.showDir;
    if (was && fs.existsSync(path.join(was, 'media'))) fs.cpSync(path.join(was, 'media'), path.join(showDir, 'media'), { recursive: true });
    fs.writeFileSync(ShowDocument.filePath(showDir), show.stringify({ ...document.doc, title: document.showDir ? document.doc.title : path.basename(showDir).replace(/\.ecshow$/i, '') }));
    const before = { undo: document.undoStack, redo: document.redoStack };
    // (saved here, a show of this computer's is this computer's in its new folder too; one from elsewhere stays held back)
    if (!away) keepMine(showDir, document.doc.id);
    const doc = open(showDir, true, { elsewhere: away });
    doc.undoStack = before.undo; doc.redoStack = before.redo;      // the same show carrying on: Undo still goes back through what was done
    // sounds an untitled show named by where they were on this computer come into the folder
    const ops: EditOp[] = [];
    show.walk(doc.doc, (c) => { if ((c.type === 'audio' || c.type === 'video') && c.file && path.isAbsolute(c.file) && !(away && trust.isRemote(c.file)) && fs.existsSync(c.file)) ops.push({ op: 'cue.set', id: c.id, props: { file: adopt(c.file) } }); });
    if (ops.length) {
      doc.edit(ops, { label: 'collect media' }); doc.undoStack.pop(); doc.write();
      let bytes = 0; show.walk(doc.doc, (c) => { if ((c.type === 'audio' || c.type === 'video') && c.file) { try { bytes += fs.statSync(doc.resolveFile(c.file)!).size; } catch { /* missing */ } } });
      notice(`${ops.length} sound${ops.length === 1 ? '' : 's'}, ${bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`}, copied into the media folder. The originals are untouched.`, 9000);
    }
    if (!doc.listVersions().length) doc.save({ note: 'first version' });      // a show saved to a folder has a version to go back to from then on
    return doc;
  }

  // ── pointing: the assistant rings a place in the window (show_in_app, core/ui/places.js) ───────────────
  // The place goes out with the state; the main window brings it into view, rings it, and says (`pointed`) whether it
  // could. Never in Show mode: nothing is drawn over the show while it runs.
  const pointer = (() => {
    let seq = 0;
    const waiting = new Map<number, (r: Pointed) => void>();
    return {
      locked: () => state.mode === 'show',
      point(place: PointAt): Pointed | Promise<Pointed> {
        if (state.mode === 'show') return { ok: false, why: 'Show mode' };
        const id = ++seq;
        state.point = { ...place, id, at: Date.now() };
        schedulePush();
        return new Promise<Pointed>((resolve) => {
          const t = setTimeout(() => { waiting.delete(id); if (state.point && state.point.id === id) state.point = null; resolve({ ok: false, why: 'the window did not answer' }); }, 3000);
          waiting.set(id, (r: Pointed) => { clearTimeout(t); resolve(r); });
        });
      },
      // (answered, it is not sent again: a window started afresh does not ring an old place)
      answered(c: Commands['pointed']) { if (state.point && c && state.point.id === c.id) state.point = null; const done = waiting.get(c && c.id); if (!done) return; waiting.delete(c.id); done({ ok: !!c.ok, why: c.why || '', instead: c.instead || '' }); },
    };
  })();

  // ── agents outside the app (Claude Code, Codex, anything speaking MCP), through the bridge ───────────────
  // Each has its own draft, exactly as the built-in assistant's turn does; a proposal lands in the same review.
  const agentTools = require('../../core/assistant/tools') as typeof import('../../core/assistant/tools');
  const agentSessions = new Map<string, Partial<ToolContext> & { draft: ShowDoc | null; of: ShowDocument }>();          // session -> { draft, of: the ShowDocument it was made from }
  async function agentCall(session: string, name: string, input: ToolInput, client = 'an agent') {
    let ctx = agentSessions.get(session);
    if (!ctx || ctx.of !== document) { ctx = { draft: null, of: document }; agentSessions.set(session, ctx); }
    ctx.document = document; ctx.engine = engine; ctx.rig = rig.service; ctx.ui = pointer;
    if (assistant) assistant.noteStep(agentTools.describeCall(name, input));
    const r = await agentTools.execute(name, input, ctx as ToolContext);      // (a tool that asks a device waits for its answer)
    log(`[agent] ${client}: ${name}${r.is_error ? ' (refused)' : ''}`);
    if (r.point && assistant) assistant.notePoint(r.point);
    if (r.proposal) {
      ctx.draft = null;
      const summary = document.proposal!.summary;
      let applied = false;
      // (a turn started from the app's own drawer applies or not when it ends; this is for an agent run from outside)
      if (assistant && !assistant.busy) {
        if (assistant.config.autoApply && state.mode !== 'show') { try { document.accept(r.proposal); applied = true; } catch { /* stale */ } }
        assistant.noteExternal(client, summary, applied);
        if (!applied) notice(`${client} has a change for you to review (Assistant).`, 6000);
      }
    }
    schedulePush();
    return { content: r.content, is_error: !!r.is_error };
  }

  // ── timed backups: a copy of the working document, every few minutes while it is changing ──
  let lastBackupAt = Date.now();
  /** Where this show's backups are: in its folder, or (a show not saved to a folder yet) in this computer's settings folder. */
  function backupDir() { return document.showDir ? backups.dirOf(document.showDir) : userDir ? path.join(userDir, 'backups', 'untitled') : null; }
  function backupNow() {
    lastBackupAt = Date.now();
    const dir = backupDir();
    if (!dir) return null;
    // (an untitled show with nothing in it is not worth a file)
    if (!document.showDir && !document.doc.lists.some((l) => l.cues.length)) return null;
    try { const b = backups.write(dir, document.doc, { keep: Number((document.doc.settings.backup || {}).keep) || backups.KEEP }); if (b) log(`[backup] ${b.name}`); return b; }
    catch (err) { log(`[backup] could not be written: ${(err as Error).message}`); return null; }
  }
  function checkBackup() {
    const mins = Number((document.doc.settings.backup || {}).minutes);
    if (mins > 0 && Date.now() - lastBackupAt >= mins * 60000) backupNow();
  }
  let backupTimer: ReturnType<typeof setInterval> | undefined;
  /** The playback log as CSV: all of it from the show's folder, or (an untitled show) what this session has played. */
  function playlogCsv() {
    const file = playlogFile();
    try { if (file && fs.existsSync(file)) return fs.readFileSync(file, 'utf8'); } catch { /* fall through to memory */ }
    return toCsv(playlog.entries());
  }
  /** This show as a template, and its settings as a file (core/show/show-templates.js). */
  const templateOf = (name: string) => showTemplates.templateOf(document.doc, { name, showDir: document.showDir });
  const settingsFile = () => showTemplates.settingsOf(document.doc);

  // Ops a module may only use where the host has them, named here once it does (OSC control asks before it sends
  // "/cue/x/loadAt" for a cue that is not standing by, "/cue/x/reset", "/playhead/none"):
  //   'load-id'  load { id, secs }      'reset-id'  reset { id }      'playhead-none'  playhead { id: null }
  //   'sequence'  sequence { step }: the playhead to the next or the previous cue that needs a GO
  const SUPPORTS = new Set(['load-id', 'reset-id', 'playhead-none', 'sequence']);
  const api: HostApi = { cmd, snapshot, notice, showId: () => document.doc.id, remoteKey, onPush: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
                onCmd: (fn) => { cmdListeners.add(fn); return () => cmdListeners.delete(fn); }, supports: (what) => SUPPORTS.has(what) };

  // ── recording the show's sound (what the main outputs get, after the limiter) into the show folder ──
  let recording: { fd: number; file: string; bytes: number; rate: number; since: number } | null = null;
  function wavHeader(bytes: number, rate: number) {
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + bytes, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
    h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(bytes, 40);
    return h;
  }
  function startRecording() {
    if (recording) return { file: recording.file };
    if (!document.showDir) { notice('Save the show to a folder first.', 6000); return { error: 'Save the show to a folder first' }; }
    const dir = path.join(document.showDir, 'recordings');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date(), p2 = (n: number) => String(n).padStart(2, '0');
    const file = path.join(dir, `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}.wav`);
    const fd = fs.openSync(file, 'w');
    fs.writeSync(fd, wavHeader(0, 48000));
    recording = { fd, file, bytes: 0, rate: 48000, since: Date.now() };
    audioCmd({ op: 'record', on: true });
    log(`[rec] recording to ${file}`);
    return { file };
  }
  function stopRecording() {
    if (!recording) return null;
    const r = recording; recording = null;
    audioCmd({ op: 'record', on: false });
    try { fs.writeSync(r.fd, wavHeader(r.bytes, r.rate), 0, 44, 0); fs.closeSync(r.fd); } catch (err) { log(`[rec] ${(err as Error).message}`); }
    log(`[rec] stopped: ${Math.round(r.bytes / (r.rate * 4))} s`);
    return { file: r.file, secs: r.bytes / (r.rate * 4) };
  }

  // ── clock triggers: a cue that fires at a time of day ───────────────────
  let clockDay = '', clockFired = new Set<string>();
  /** `now`: the time to check against (a test hands in a time of its own). */
  function checkClock(now = new Date()) {
    if (away) return;                 // (a show from another computer: no clock trigger until it is turned on)
    const day = now.toDateString();
    if (day !== clockDay) { clockDay = day; clockFired = new Set<string>(); }
    // (which are due, and that a time long past does not fire: core/show/triggers.js)
    for (const c of clockDue(document.doc, now, clockFired)) {
      if (!engine.byId.has(c.id)) continue;
      log(`[clock] ${c.clockTrigger} fires ${c.number || c.id}`); notice(`${c.clockTrigger}: ${c.number ? `${c.number} · ` : ''}${labels[c.id] || c.name || 'a cue'} started by its clock`, 6000); startBy(c.id, `the clock, ${c.clockTrigger}`);
    }
  }
  let clockTimer: ReturnType<typeof setInterval> | undefined;

  function start() {
    if (!smoke) clockTimer = setInterval(() => { try { checkClock(); } catch (err) { log(`[clock] ${(err as Error).message}`); } }, 500);
    if (!smoke) backupTimer = setInterval(() => { try { checkBackup(); } catch (err) { log(`[backup] ${(err as Error).message}`); } }, 20000);
    startAudio();
    stage.start();
    ticker = setInterval(() => { if (engine.active().length || state.level) schedulePush(); }, TICK_MS);
    bind(document);                 // the untitled show the app starts on is a show like any other: its edits reach the engine
  }
  /** The show log's last lines as a problem report may carry them: no cue's name and no file's (core/log/show-log.js). */
  function reportLog(count = 200) {
    const names = [];
    show.walk(document.doc, (c) => { names.push(c.name, labels[c.id]); if (c.file) names.push(path.basename(String(c.file)), String(c.file)); });
    names.push(document.doc.title);
    return bareLines(showLog.tail(count), names);
  }
  function stop() {
    stopRecording(); playlog.endAll(); transport.stop();
    showLog.add('show', 'closed'); showLog.flushSync();
    clearInterval(ticker); clearInterval(clockTimer); clearInterval(backupTimer); clearInterval(wallTimer);
    for (const inst of running.values()) { try { inst.stop(); } catch { /* going */ } }
    running.clear();
    rig.close();
    hub.close();
    lighting.close();
    if (audioWin && !audioWin.isDestroyed()) audioWin.destroy();
    stage.stop();
  }

  return { start, stop, cmd, snapshot, open, openUntitled, openImported, openTemplate, saveAs, adopt, agentCall, engine, lighting, addView: (wc: WebContents) => { views.add(wc); schedulePush(); }, removeView: (wc: WebContents) => views.delete(wc),
           get document() { return document; }, isDirty: () => document.dirty, isSounding: () => engine.running.size > 0, notice, midiIn, backupNow, playlogCsv, templateOf, settingsFile, checkClock, transport, played: () => played, moduleDefs: MODULES, stage, audioWindow: () => audioWin, audioEvent: onAudioEvent,
           pretendHeard: (id: string, text: string) => hub.pretendHeard(id, text), pretendInput: (text: string, from: HubFrom, reply?: HubReply) => hub.pretendInput(text, from, reply),
           showLog, reportLog };      // (a test run sends and hears nothing: this stands in for a device's answer)
}

/** The show host, as main.js and the modules have it. */
export type Host = ReturnType<typeof createHost>;
/** What the host pushes to each window on 'ec-state' (`window.ec.onState`): everything on a show's first push and
 *  whenever the document has changed since that window was last sent it (`doc`, `labels`, …), less otherwise. */
export type HostState = ReturnType<Host['snapshot']>;

export { createHost };
