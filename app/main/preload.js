// The window ↔ the show host in the main process. The page can send commands and is pushed state; nothing else.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The keys (core/ui/keys.js): asked for once, at once, because the page's modules read them as
// they load. (null if the main process has no answer: the page then has no keys of its own.)
let tables = null;
try { tables = ipcRenderer.sendSync('ec-ui-tables'); } catch { tables = null; }

contextBridge.exposeInMainWorld('ec', {
  /** The keys, as core/ui/keys.js has them for the window. */
  ui: tables,
  /** What the app is: version, the cue-type table the inspector is drawn from. */
  init: () => ipcRenderer.invoke('ec-init'),
  /** A command for the show host: { op: 'go' | 'edit' | … }. Resolves to its result ({ error } when refused). */
  cmd: (c) => ipcRenderer.invoke('ec-cmd', c),
  /** Things only the app shell can do: file dialogs, opening shows. */
  app: (c) => ipcRenderer.invoke('ec-app', c),
  /** The show's state, whenever it changes and ten times a second while anything runs. */
  onState: (fn) => ipcRenderer.on('ec-state', (_e, s) => fn(s)),
  onMenu: (fn) => ipcRenderer.on('ec-menu', (_e, action) => fn(action)),
  /** A word to this show's other windows (the selection, for an inspector in a window of its own). */
  relay: (m) => ipcRenderer.send('ec-relay', m),
  onRelay: (fn) => ipcRenderer.on('ec-relay', (_e, m) => fn(m)),
  /** A newer version: found, downloading or ready (app/main/updates.js). */
  onUpdate: (fn) => ipcRenderer.on('ec-update', (_e, s) => fn(s)),
  /** Where a dropped file is on disk. */
  pathFor: (file) => webUtils.getPathForFile(file),
});
