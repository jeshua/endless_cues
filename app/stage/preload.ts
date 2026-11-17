// The stage (stage.html, the output window) ↔ the main process's cue engine.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('cueStage', {
  onCmd: (fn) => ipcRenderer.on('stage-cmd', (_e, cmd) => fn(cmd)),
  report: (event) => ipcRenderer.send('stage-event', event),
});
