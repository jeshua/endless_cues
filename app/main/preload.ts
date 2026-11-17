// The window ↔ the show host in the main process. The page can send commands and is pushed state; nothing else.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { HostCommand, HostResult, HostState } from './host';
import type { AppCommand, AppInfo } from './main';
import type { UpdateView } from '../../core/update/updates';
import type { forPage } from '../../core/ui/keys';

/** The keys as the page has them (core/ui/keys.js `forPage`). */
export interface UiTables { keys: ReturnType<typeof forPage> }
/** A word between this show's windows: the selection, for an inspector in a window of its own, and whether that window is out. */
export type Relay = Record<string, unknown>;

// The keys (core/ui/keys.js): asked for once, at once, because the page's modules read them as
// they load. (null if the main process has no answer: the page then has no keys of its own.)
let tables: UiTables | null = null;
try { tables = ipcRenderer.sendSync('ec-ui-tables'); } catch { tables = null; }

const bridge = {
  /** The keys, as core/ui/keys.js has them for the window. */
  ui: tables,
  /** What the app is: version, the cue-type table the inspector is drawn from. */
  init: (): Promise<AppInfo> => ipcRenderer.invoke('ec-init'),
  /** A command for the show host: { op: 'go' | 'edit' | … }. Resolves to its result ({ error } when refused). */
  cmd: (c: HostCommand): Promise<HostResult> => ipcRenderer.invoke('ec-cmd', c),
  /** Things only the app shell can do: file dialogs, opening shows. */
  app: (c: AppCommand): Promise<HostResult> => ipcRenderer.invoke('ec-app', c),
  /** The show's state, whenever it changes and ten times a second while anything runs. */
  onState: (fn: (s: HostState) => void) => ipcRenderer.on('ec-state', (_e, s: HostState) => fn(s)),
  onMenu: (fn: (action: string) => void) => ipcRenderer.on('ec-menu', (_e, action: string) => fn(action)),
  /** A word to this show's other windows (the selection, for an inspector in a window of its own). */
  relay: (m: Relay) => ipcRenderer.send('ec-relay', m),
  onRelay: (fn: (m: Relay) => void) => ipcRenderer.on('ec-relay', (_e, m: Relay) => fn(m)),
  /** A newer version: found, downloading or ready (app/main/updates.js). */
  onUpdate: (fn: (s: UpdateView) => void) => ipcRenderer.on('ec-update', (_e, s: UpdateView) => fn(s)),
  /** Where a dropped file is on disk. */
  pathFor: (file: File) => webUtils.getPathForFile(file),
};
contextBridge.exposeInMainWorld('ec', bridge);

/** What the window has of the app: `window.ec`. */
export type EcBridge = typeof bridge;
declare global { interface Window { ec: EcBridge } }
