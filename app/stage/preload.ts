// The stage (stage.html, the output window) ↔ the main process's cue engine.
import { contextBridge, ipcRenderer } from 'electron';

const bridge = {
  onCmd: (fn) => ipcRenderer.on('stage-cmd', (_e, cmd) => fn(cmd)),
  report: (event) => ipcRenderer.send('stage-event', event),
};
contextBridge.exposeInMainWorld('cueStage', bridge);

/** What the stage window has of the app: `window.cueStage`. */
export type CueStageBridge = typeof bridge;
declare global { interface Window { cueStage: CueStageBridge } }
