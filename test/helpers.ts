/** A cue engine on a fake clock with a fake audio backend, and a small show to play. */
import { CueEngine } from '../core/engine/cue-engine';
import type { Clock, EngineAudio, EngineCue, EngineOptions, PlayOptions, Timer } from '../core/engine/cue-engine';
import * as show from '../core/show/show';
import { applyOps } from '../core/show/ops';
import type { Op } from '../core/show/ops';
import type { ShowDoc } from '../core/show/types';
import * as fs from 'fs';

/** One call the engine made of the fake audio: its name, then its arguments as given. */
export type AudioCall = [op: string, ...args: any[]];
/** The fake audio backend: every call recorded, and what is playing now (`db`: its level after fades). */
export interface FakeAudio extends Required<Pick<EngineAudio, 'play' | 'stop' | 'fade' | 'pause' | 'resume' | 'seek' | 'setLoop' | 'setRegion' | 'move' | 'cut'>>,
  Pick<EngineAudio, 'rate' | 'duck' | 'sweep'> {
  calls: AudioCall[];
  playing: Map<string, PlayOptions & { db: number }>;
}

function rig(doc: ShowDoc, opts: Partial<EngineOptions> = {}) {
  let t = 0, timers: { id: number; at: number; fn: () => void }[] = [], nextId = 1;
  const clock: Clock = {
    now: () => t,
    setTimeout: (fn, ms) => { const id = nextId++; timers.push({ id, at: t + ms / 1000, fn }); return id; },
    clearTimeout: (id: Timer) => { timers = timers.filter((x) => x.id !== id); },
  };
  const advance = (secs: number) => {
    const end = t + secs;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end + 1e-9) break;
      timers.shift(); t = next.at; next.fn();
    }
    t = end;
  };
  const audio = { calls: [], playing: new Map() } as unknown as FakeAudio;
  audio.play = (key, o) => { audio.calls.push(['play', key, o]); audio.playing.set(key, { ...o, db: o.gainDb }); };
  audio.fade = (key, db, secs, range) => { audio.calls.push(['fade', key, db, secs, range]); const p = audio.playing.get(key); if (p && range !== 'voice') p.db = db; };
  audio.stop = (key) => { audio.calls.push(['stop', key]); audio.playing.delete(key); };
  for (const op of ['pause', 'resume', 'seek', 'setLoop', 'setRegion', 'move', 'cut'] as const) audio[op] = (...a: unknown[]) => { audio.calls.push([op, ...a]); };
  const sent: string[] = [], lights: (string | number | null | undefined)[] = [], mixes: EngineCue[] = [], logs: string[] = [];
  const engine = new CueEngine({ audio, clock, send: (m, cue) => sent.push(m), lights: (c) => lights.push(c.lightCue || c.number), mix: (c) => mixes.push(c), log: (l) => logs.push(l), ...opts });
  engine.load(show.toEngineDoc(doc));
  return { engine, audio, advance, sent, lights, mixes, logs, now: () => t };
}
/** What `rig` gives back. */
export type Rig = ReturnType<typeof rig>;
/** One line of the engine's Active Cues, and the kind a sound has (its `kind` is 'audio'). */
export type ActiveLine = ReturnType<CueEngine['active']>[number];
export type SoundLine = Extract<ActiveLine, { armed: unknown }>;

/** A show built with the same ops the app uses. Returns { doc, id(ref) }. */
function build(ops: readonly Op[]) {
  const r = applyOps(show.newShow('Test'), ops);
  return { doc: r.doc, refs: r.refs, id: (ref: string) => r.refs[ref] };
}
/** What `build` gives back. */
export type Built = ReturnType<typeof build>;

export { rig, build };

/** A link at `at` to the folder `target`. On Windows it is a junction, which anyone may make (a symbolic link needs
 *  an administrator or Developer Mode); Node, and so the app, sees either as a link. */
export function linkFolder(target: string, at: string): void {
  fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
}

/** A link at `at` to the file `target`, or false where this computer may not make one (Windows, unless an
 *  administrator or in Developer Mode: a file has no junction). */
export function linkFile(target: string, at: string): boolean {
  try { fs.symlinkSync(target, at, 'file'); return true; } catch (e) {
    if (process.platform === 'win32' && (e as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw e;
  }
}
