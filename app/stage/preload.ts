// The stage (stage.html, the output window) ↔ the main process's cue engine.
import { contextBridge, ipcRenderer } from 'electron';
import type { PictureSpec } from '../../core/engine/cue-engine';
import type { Geometry } from '../../core/video/stage';

/** What the main process tells the stage window (app/main/stage.js `send`). */
export type StageCmd =
  | { op: 'stage'; width: number; height: number; matrix?: number[] | null }
  | ({ op: 'show'; id: string; url: string; from: number; geometry?: Partial<Geometry>; paused?: boolean } & PictureSpec)
  | { op: 'hide'; id: string }
  | { op: 'clear' }
  | { op: 'move'; id: string; props?: Partial<Geometry>; secs: number }
  | { op: 'pause'; id: string }
  | { op: 'resume'; id: string }
  | { op: 'seek'; id: string; t: number }
  | { op: 'sync'; id: string; t: number; at: number }
  | { op: 'pattern'; on?: boolean }
  | { op: 'blackout'; on?: boolean; secs?: number }
  | { op: 'cameras' };

/** What the stage window says back (app/main/stage.js, 'stage-event'). */
export type StageReport =
  | { type: 'ready' }
  | { type: 'shown'; id: string }
  | { type: 'cameras'; list: string[] }
  | { type: 'error'; id: string; detail: string }
  | { type: 'operror'; op: string; id: string; detail: string };

const bridge = {
  onCmd: (fn: (cmd: StageCmd) => void) => ipcRenderer.on('stage-cmd', (_e, cmd: StageCmd) => fn(cmd)),
  report: (event: StageReport) => ipcRenderer.send('stage-event', event),
};
contextBridge.exposeInMainWorld('cueStage', bridge);

/** What the stage window has of the app: `window.cueStage`. */
export type CueStageBridge = typeof bridge;
declare global { interface Window { cueStage: CueStageBridge } }
