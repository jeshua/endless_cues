// The hidden audio window (audio.html) ↔ the main process's cue engine.
import { contextBridge, ipcRenderer } from 'electron';

const bridge = {
  onCmd: (fn) => ipcRenderer.on('audio-cmd', (_e, cmd) => fn(cmd)),
  report: (event) => ipcRenderer.send('audio-event', event),
};
contextBridge.exposeInMainWorld('cueAudio', bridge);

/** What the audio window has of the app: `window.cueAudio`. */
export type CueAudioBridge = typeof bridge;
declare global { interface Window { cueAudio: CueAudioBridge } }
