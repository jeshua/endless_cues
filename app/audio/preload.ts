// The hidden audio window (audio.html) ↔ the main process's cue engine.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('cueAudio', {
  onCmd: (fn) => ipcRenderer.on('audio-cmd', (_e, cmd) => fn(cmd)),
  report: (event) => ipcRenderer.send('audio-event', event),
});
