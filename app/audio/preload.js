// The hidden audio window (audio.html) ↔ the main process's cue engine.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cueAudio', {
  onCmd: (fn) => ipcRenderer.on('audio-cmd', (_e, cmd) => fn(cmd)),
  report: (event) => ipcRenderer.send('audio-event', event),
});
