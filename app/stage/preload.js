// The stage (stage.html, the output window) ↔ the main process's cue engine.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cueStage', {
  onCmd: (fn) => ipcRenderer.on('stage-cmd', (_e, cmd) => fn(cmd)),
  report: (event) => ipcRenderer.send('stage-event', event),
});
