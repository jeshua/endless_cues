// The hidden audio window (audio.html) ↔ the main process's cue engine.
import { contextBridge, ipcRenderer } from 'electron';
import type { ChainValue, EqValue, SweepValue } from '../../core/audio/chain';
import type { AutomationValue } from '../../core/audio/lanes';
import type { MatrixRow, settingsOf as routingOf } from '../../core/audio/routing';
import type { DuckRule } from '../../core/audio/kinds';
import type { LtcCmd } from '../../core/timecode/transport';
import type { TC, Rate } from '../../core/timecode/timecode';
import type { LanePoint } from '../../core/show/types';

/** A file's bytes as they arrive over IPC (a Buffer sent from main arrives as a Uint8Array), or an ArrayBuffer. */
type Bytes = Uint8Array<ArrayBuffer> | (ArrayBuffer & { buffer?: undefined });
/** A place in a file to hold a loop between, in seconds. */
type Span = { start: number; end: number };
/** What a sound has of its own: its eq and sound design, and outputs of its own (a matrix, or the audition pair). */
export interface Own { eq?: EqValue | null; chain?: ChainValue | null; audition?: number; outputs?: MatrixRow[] }
/** One rule of the ducker, as the host sends it (core/audio/kinds.ts duckRules). */
export type DuckerRule = Partial<Omit<DuckRule, 'keys' | 'range'>> & { keys?: (string | undefined)[]; range?: string };

/** What the host tells the audio window, by `op` (app/audio/audio.ts says what each does). */
export interface AudioCommands {
  play: { key: string; url?: string; gainDb?: number; from?: number; loop?: boolean; exact?: boolean; bus?: string; mic?: { input?: string; channel: number }; own?: Own; rate?: number; preservePitch?: boolean;
    envelope?: LanePoint[] | null; pan?: number; automation?: AutomationValue | null; speech?: [number, number][] };
  move: { key: string; to: number; region?: Span | null; sync?: { at: number; lead?: number; xf?: number; blend?: string } };
  fade: { key: string; db: number; secs?: number; range?: string; shape?: number[] };
  cut: { key: string; at: number };
  stop: { key: string };
  pause: { key: string };
  resume: { key: string; t?: number | null };
  seek: { key: string; t: number };
  loop: { key: string; on: boolean };
  region: { key: string; start: number; end: number } | { key: string; start?: null; end?: null };
  rate: { key: string; rate: number; secs?: number };
  others: { key: string; db: number; secs?: number };
  design: { key: string; chain?: ChainValue | null; eq?: EqValue | null };
  lanes: { key: string; envelope?: LanePoint[] | null; pan?: number; automation?: AutomationValue | null };
  sweep: { key: string; to: SweepValue | null; secs: number };
  ir: { file: string; bytes: Bytes };
  decode: { url: string; file: string; bytes: Bytes };
  keep: { urls: string[] };
  peaks: { file: string; bytes: Bytes; bins?: number };
  pcm: { file: string; bytes: Bytes };
  probe: { files: { file: string; url: string }[] };
  where: { keys?: string[] };
  devices: Record<string, never>;
  sink: { id?: string; fallback?: boolean };
  stopAll: Record<string, never>;
  master: { gain?: number };
  masterDb: { db?: number; secs?: number | null };
  limiter: { on?: boolean };
  bus: { name: string; db: number; secs?: number };
  buses: { list?: { id: string; db?: number; out?: number; reverb?: number; delay?: number }[] };
  duck: { bus?: string; db: number; secs?: number; range?: string };
  ducker: { rules?: DuckerRule[] | null; on?: boolean; key?: string; target?: string; threshold?: number; depth?: number; attack?: number; hold?: number; release?: number; range?: string };
  monitor: { on?: boolean; out?: number; db?: number };
  outputs: { trims?: Record<string, number>; use?: number[] };
  fx: Partial<ReturnType<typeof routingOf>['fx']>;
  midi: { bytes?: number[]; port?: string; events?: { bytes: number[]; at: number }[] };
  record: { on?: boolean };
  ltc: Omit<LtcCmd, 'op'>;
  'ltc-in': { on?: boolean; input?: string; channel?: number };
}
export type AudioOp = keyof AudioCommands;
export type AudioCommand = { [K in AudioOp]: { op: K } & AudioCommands[K] }[AudioOp];

/** What the audio window says, by `type`. */
export interface AudioEvents {
  ready: {};
  duration: { file: string; secs: number };
  missing: { file: string };
  decoded: { file: string; secs: number; error?: string };
  mode: { key: string; exact: boolean };
  ended: { key: string };
  error: { key: string; url: string; detail?: string };
  where: { key: string; t: number; at: number };
  devices: { list: { id: string; label: string }[]; inputs: string[]; current: string | { type: 'none' } };
  sink: { id: string | undefined; ok: boolean; detail?: string; fallback: boolean };
  outputs: { channels: number };
  outch: { ch: number[] };
  monitor: { on: boolean; wanted?: boolean; out?: number; channels: number; detail?: string };
  ir: { file: string; secs: number; error?: string };
  pcm: { file: string; rate?: number; samples: Float32Array | null; error?: string };
  peaks: { file: string; bins: number | undefined; peaks: number[] | null; rms?: number[] };
  rec: { rate: number; at: number; pcm: Uint8Array };
  recording: { rate: number };
  'midi-ports': { inputs: string[]; outputs: string[]; error: string };
  'midi-in': { port: string; bytes: number[]; at: number };
  ltc: { key: string; ok: boolean; detail?: string };
  'ltc-in': { ok: boolean; detail?: string };
  'tc-in': { frame: { tc: TC; rate: Rate }; at: number };
  operror: { op: string; key: string; detail: string };
  ctx: { state: AudioContextState; error?: true };
  level: { monitor: number | null; ducking: boolean; ducked: string[]; db: number; channels: { peak: number; rms: number }[]; buses: Record<string, number>; outs: number[];
    cues: Record<string, number>; voices: number; limiting: boolean };
}
export type AudioEventType = keyof AudioEvents;
export type AudioEvent = { [K in AudioEventType]: { type: K } & AudioEvents[K] }[AudioEventType];

const bridge = {
  onCmd: (fn: (cmd: AudioCommand) => void) => ipcRenderer.on('audio-cmd', (_e, cmd: AudioCommand) => fn(cmd)),
  report: (event: AudioEvent) => ipcRenderer.send('audio-event', event),
};
contextBridge.exposeInMainWorld('cueAudio', bridge);

/** What the audio window has of the app: `window.cueAudio`. */
export type CueAudioBridge = typeof bridge;
declare global { interface Window { cueAudio: CueAudioBridge } }
