/**
 * Endless Cues: the Electron entry.
 *
 * Thin on purpose. The show lives in host.ts (the document, the engine, the
 * audio window, the modules); this file makes the window, the menu and the
 * file dialogs, and keeps per-computer settings (config.json: the last show,
 * the audio output, the assistant's sign-in) apart from the show file.
 *
 *   electron .                      the app
 *   electron . path/to/My.ecshow    open that show
 *   electron . --smoke              the end-to-end check (smoke.ts): offscreen, silent, never takes focus
 */
import { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net, powerSaveBlocker, shell, safeStorage, screen, clipboard } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { createHost } from './host';
import { binaryPath } from './native-audio';
import type { HostCommand, HostResult } from './host';
import type { Relay } from './preload';
import { createAssistant, COMPATIBLE, CLI, findBinary } from '../../core/assistant/assistant';
import { createBridge } from '../../core/assistant/mcp';
import * as cueTypes from '../../core/show/cue-types';
// every key the window answers to, the menus' among them, is one table (core/ui/keys.ts): the menus are built from it
import * as uiKeys from '../../core/ui/keys';
const KEY = uiKeys.accel;
import { makeDemo } from '../../examples/make-demo';
import { showFolderFrom } from '../../core/show/picked';
import { createReports } from './report';
import { createAppUpdates } from './updates';
import type { ReportCommand, Reports } from './report';
import type { UpdateCommand } from './updates';
import type { UpdateConfig } from '../../core/update/updates';

/** This computer's settings (config.json in userData): never a show's. */
export interface AppConfig extends UpdateConfig {
  lastShow?: string | null;
  recent?: string[];
  audioDevice?: string;
  audioDeviceLabel?: string;
  /** the audio engine (docs/specs/18-native-audio.md): 'webaudio' (the default) or 'native', and the native engine's
   *  own choice of output (it names devices its own way) */
  audio?: { engine?: 'webaudio' | 'native'; device?: string; deviceLabel?: string };
  skipLights?: boolean;
  /** outputs held back for a rehearsal: { osc, midi, timecode, dmx } */
  overrides?: Record<string, boolean>;
  remoteSalt?: string;
  /** which show folders are this computer's own (core/show/trust.ts) */
  shows?: Record<string, string>;
  assistant?: AssistantSettings;
  keys?: KeyOver;
  theme?: string;
  view?: ViewSettings;
  folds?: Record<string, string[]>;
  listZoom?: Record<string, number>;
  /** the stage's display (app/main/stage.ts) */
  stage?: { open?: boolean; display?: string | null; label?: string };
  clientId?: string;
}
/** How the window is drawn on this computer: the row size, the assistant's face and its hint. */
export interface ViewSettings { rowSize?: string; qirx?: boolean; qirxHint?: boolean; [key: string]: unknown }
/** The assistant as this computer has it set up; its keys sealed by the keychain, under the provider they belong to. */
interface AssistantSettings {
  provider?: string; endpoint?: string; baseURL?: string; model?: string; cloudEmail?: string; autoApply?: boolean; agents?: boolean;
  secrets?: Record<string, string>; models?: Record<string, { model: string; baseURL: string }>;
}
/** The assistant's configuration as the code uses it (core/assistant/assistant.ts `config`): keys in the clear, in memory only. */
interface AssistantRun {
  provider: string; endpoint: string; baseURL: string; model: string; autoApply: boolean; agents: boolean; mcpServer: typeof mcpServer;
  version: string; email: string; cloudSignedOut: () => void; token?: string; apiKey?: string;
}
/** A change to it, from Settings ▸ Assistant (keys in the clear, on their way to being sealed). */
type AssistantChange = Partial<Omit<AssistantSettings, 'secrets' | 'models' | 'provider'>> & { provider?: string | null; token?: string; apiKey?: string };
/** An item of the right-click menu on a cue (the window says what to show; `id` comes back when it is picked). */
export interface CueMenuItem { id?: string; label?: string; sep?: boolean; enabled?: boolean; checked?: boolean; submenu?: CueMenuItem[] }
/** What only the app shell can do (`window.ec.app`): file dialogs, opening shows, this computer's settings. */
export type AppCommand =
  | { op: 'open' | 'new' | 'demo' | 'relink' | 'save-as' | 'recent' | 'reveal' | 'log' | 'issue' | 'issue-dismiss' | 'log-reveal' | 'backups-reveal' | 'pick-picture' }
  | { op: 'cloud-sign-in' | 'cloud-cancel' | 'cloud-sign-out' | 'cloud-usage' }
  | { op: 'open-path'; path: string }
  | { op: 'import-qlab' | 'start-in-folder' | 'template-save' | 'template-new' | 'settings-export' | 'settings-import' | 'playlog-export'; path?: string }
  | { op: 'copy-text'; text: string }
  | { op: 'own-window'; inspector?: boolean; list?: string; name?: string }
  | { op: 'cue-menu'; items: CueMenuItem[] }
  | ({ op: 'import' } & ImportPlace)
  | { op: 'native-edit'; what: string }
  | { op: 'pick-sound'; accept?: string }
  | { op: 'keys'; keys: KeyOver | null }
  | { op: 'view'; view: Partial<ViewSettings> }
  | { op: 'folds'; dir: string; ids?: string[] }
  | { op: 'list-zoom'; dir: string; z?: number }
  | { op: 'theme'; theme: string }
  | { op: 'assistant-config'; config?: AssistantChange & Record<string, unknown> }
  | ReportCommand
  | UpdateCommand;
/** Where sounds added from the dialog go (the list's + Sounds, a track's + Sounds). */
interface ImportPlace { after?: string | null; bus?: string | null; list?: string | null; cell?: string | null }
/** A person's own keys: { actionId: [combo…] }. */
export type KeyOver = Record<string, string[] | undefined>;
/** What the window is told of the app once, as it opens (`window.ec.init`). */
export interface AppInfo {
  version: string; build: { commit?: string; date?: string; [key: string]: unknown } | null; platform: NodeJS.Platform; smoke: boolean;
  keys: KeyOver;
  view: { rowSize: string; qirx: boolean; qirxHint: boolean };
  types: typeof cueTypes.TYPES; typeOrder: typeof cueTypes.TYPE_ORDER; common: typeof cueTypes.COMMON; colors: typeof cueTypes.COLORS; palette: typeof cueTypes.PALETTE;
  devices: ReturnType<typeof import('../../core/net/devices').list>;
  sound: {
    tools: Chain['TOOLS']; eq: Chain['EQ_BANDS']; presets: Chain['PRESETS']; offer: Chain['OFFER']; sweepable: Chain['SWEEPABLE'];
    kinds: Kinds['KINDS']; kindOrder: Kinds['KIND_ORDER']; kindDefaults: Record<string, ReturnType<Kinds['defaultsOf']>>; ducking: Kinds['DUCKING'];
  };
  rig: { fields: RigDevices['FIELDS']; commandFields: RigDevices['COMMAND_FIELDS']; paramFields: RigDevices['PARAM_FIELDS']; aliveFields: RigDevices['ALIVE_FIELDS']; reportFields: RigDevices['REPORT_FIELDS']; kinds: RigDevices['KINDS']; vias: RigDevices['VIAS'] };
  kit: { options: typeof import('../../core/kit/kit').OPTIONS } | null;
  fixtures: boolean;
  theme: string; themes: string[];
  // (a test window has only the built-in helper: no more than provider and providers)
  assistant: Pick<ReturnType<typeof assistantInfo>, 'provider' | 'providers'> & Partial<ReturnType<typeof assistantInfo>>;
  updates: ReturnType<Updates['settings']> | null;
}
type Chain = typeof import('../../core/audio/chain');
type Kinds = typeof import('../../core/audio/kinds');
type RigDevices = typeof import('../../core/rig/devices');
type Host = ReturnType<typeof createHost>;
type Item = Electron.MenuItemConstructorOptions;
type Assistant = ReturnType<typeof createAssistant>;
type Updates = ReturnType<typeof createAppUpdates>;
// (a test run's right-click menu: what would have been shown, and what to pick from it)
declare global { var ecCueMenu: { items: CueMenuItem[]; picks: (string | null)[] } | undefined }

const SMOKE = process.argv.some((a) => a.startsWith('--smoke'));
// A virtual user's session (test/users): the app as the smoke test runs it, driven through app/main/drive.ts.
const DRIVE = (process.argv.find((a) => a.startsWith('--drive=')) || '').slice(8);
const DRIVE_NET = !!DRIVE && process.argv.includes('--drive-net');   // this session may open network ports
const TEST = SMOKE || !!DRIVE;
const RENDERER = path.join(__dirname, '../renderer');
import VERSION_json from '../../package.json'; const VERSION = VERSION_json.version;
// A packaged build carries which commit it was made from and when (bin/release.ts writes it; a run from source has none)
let BUILD: AppInfo['build'] = null;
try { BUILD = require('../build-info.json'); } catch { /* run from source */ }
const SOUND_EXT = ['wav', 'aif', 'aiff', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus'];
const MAC = process.platform === 'darwin';
const THEMES = ['lab', 'ocean', 'graphite'];

// Its own settings folder, whatever the bundle is called.
// "Public Alpha" while the show this grew from still runs an app called Endless Cues on the same computers.
const APP_NAME = 'Endless Cues Public Alpha';
app.setName(APP_NAME);
app.setPath('userData', SMOKE ? fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-')) : DRIVE ? path.join(path.resolve(DRIVE), 'settings') : path.join(app.getPath('appData'), 'EndlessCues'));
// A test run must never take the keyboard from whoever is working: no Dock icon, never frontmost.
if (TEST && app.setActivationPolicy) app.setActivationPolicy('accessory');

// Windows and Linux start a second copy of the program when a show is opened from the desktop while the app is
// running (macOS sends `open-file` to the one that is). Two copies would fight over the show's file, the audio
// device and the OSC port: the second hands what it was asked to open to the first, and goes.
const FIRST = MAC || TEST || app.requestSingleInstanceLock();
if (!FIRST) app.quit();
else if (!MAC && !TEST) app.on('second-instance', (_e, argv) => {
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); }
  const p = showArg(argv.slice(1));
  if (p) openFromDesktop(p);
});
/** The show (or QLab workspace) named on a command line: a ….ecshow folder, the show.json inside one, or a workspace file. */
function showArg(args: string[]) {
  const p = args.find((a) => !a.startsWith('-') && /(\.ecshow[\\/]?|[\\/]show\.json|\.qlab[45](backup)?)$/i.test(a) && fs.existsSync(a));
  return p ? path.resolve(p) : null;
}

protocol.registerSchemesAsPrivileged([{ scheme: 'ec', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
// Every window (the main one, its own-window lists, the audio window, the stage) stays on the page it was opened
// on, and hands only http(s) and mailto to the system (app/main/navigation.ts): each page has the bridge to the host.
import * as navigation from './navigation';
app.on('web-contents-created', (_e, wc) => navigation.guard(wc, { open: (url) => { if (!TEST) shell.openExternal(url); } }));

// ── per-computer settings ───────────────────────────────────────────────
const configPath = () => path.join(app.getPath('userData'), 'config.json');
let config: AppConfig = {};
function loadConfig() { try { config = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { config = {}; } }
function saveConfig(change: Partial<AppConfig>) {
  Object.assign(config, change);
  try { fs.mkdirSync(path.dirname(configPath()), { recursive: true }); fs.writeFileSync(configPath(), JSON.stringify(config, null, 2)); } catch (err) { log(`[config] ${(err as Error).message}`); }
}

const logLines: string[] = [];
// something gone wrong, for the status bar's "Report it?" (core/report/issues.ts): the window is told, and asks
const issues = (require('../../core/report/issues') as typeof import('../../core/report/issues')).createIssues();
function log(line: string) {
  const text = `${new Date().toISOString().slice(11, 23)} ${line}`;
  logLines.push(text); if (logLines.length > 2000) logLines.shift();
  try { if (issues.seen(text) && win && !win.isDestroyed()) win.webContents.send('ec-menu', 'issue'); } catch { /* before the window: it asks when it opens */ }
  if (SMOKE || process.env.EC_LOG) console.log(text);
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'app.log'), text + '\n'); } catch { /* not writable: the app goes on */ }
}

// The assistant's keys are this computer's, never a show's, and are kept encrypted by the OS keychain
// (safeStorage) when it offers one. `secrets` in config.json is { name: base64 ciphertext }.
const SECRET_FIELDS = ['token', 'apiKey'] as const;
function sealed(value: string) { return safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(value).toString('base64')}` : `plain:${value}`; }
function unsealed(stored: string | undefined) {
  if (!stored) return '';
  try { return stored.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64')) : stored.replace(/^plain:/, ''); } catch { return ''; }
}
/** The assistant's configuration as the code uses it (keys in the clear, in memory only). */
function assistantConfig() {
  const a: AssistantSettings = config.assistant || { provider: 'off' };
  const out: AssistantRun = { provider: a.provider || 'off', endpoint: a.endpoint || '', baseURL: a.baseURL || '', model: a.model || '', autoApply: !!a.autoApply, agents: !!a.agents, mcpServer,
                version: VERSION, email: a.cloudEmail || '', cloudSignedOut: () => setTimeout(cloudForget, 0) };
  for (const f of SECRET_FIELDS) out[f] = unsealed((a.secrets || {})[`${a.provider}:${f}`]);
  return out;
}
/** Change it: a key that is given is sealed under the provider it belongs to; switching provider keeps each one's own key and model. */
function setAssistantConfig(change: AssistantChange) {
  const a: AssistantSettings = { ...(config.assistant || {}) };
  a.secrets = { ...(a.secrets || {}) };
  a.models = { ...(a.models || {}) };
  if (change.provider) { if (a.provider) a.models[a.provider] = { model: a.model || '', baseURL: a.baseURL || '' }; a.provider = change.provider; Object.assign(a, { model: '', baseURL: '' }, a.models[change.provider] || {}); }
  for (const k of ['endpoint', 'baseURL', 'model', 'cloudEmail'] as const) if (k in change) a[k] = String(change[k] || '').trim();
  if ('autoApply' in change) a.autoApply = !!change.autoApply;
  if ('agents' in change) a.agents = !!change.agents;
  for (const f of SECRET_FIELDS) if (f in change) { if (change[f]) a.secrets[`${a.provider}:${f}`] = sealed(String(change[f]).trim()); else delete a.secrets[`${a.provider}:${f}`]; }
  saveConfig({ assistant: a });
  return assistantConfig();
}
function assistantInfo() {
  const c = assistantConfig();
  const def = COMPATIBLE[c.provider];
  return { provider: c.provider, endpoint: c.endpoint, baseURL: c.baseURL, model: c.model, autoApply: c.autoApply, signedIn: !!c.token, hasKey: !!c.apiKey, email: c.email,
           agents: c.agents, bridge: !!(bridge && bridge.running), mcpCommand: `node ${JSON.stringify(MCP_SCRIPT)}`, mcpLines: (() => { const g = require('../../core/assistant/guide'); return g.commandLines(MCP_SCRIPT, g.runner({ dir: __dirname })); })(),
           installed: Object.fromEntries(Object.entries(CLI).map(([k, v]) => [k, !!findBinary(v.bin)])),
           envKey: def && def.env ? !!process.env[def.env] : c.provider === 'anthropic' ? !!process.env.ANTHROPIC_API_KEY : false,
           providers: Object.fromEntries(Object.entries(COMPATIBLE).map(([k, v]) => [k, { label: v.label, baseURL: v.baseURL, env: v.env, needsKey: v.needsKey }])) };
}

// ── the Endless Cues account (core/assistant/cloud.ts, docs/specs/17 sections 4.3 and 7) ─────────────────────
// Nothing here runs until the person chooses the Endless Cues assistant: no request at start-up or in the background.
import * as cloud from '../../core/assistant/cloud';
// (a test run never reaches the service: a port nothing listens on, so no network is what it meets)
const cloudEndpoint = () => (TEST ? 'http://127.0.0.1:9' : process.env.EC_CLOUD_ENDPOINT || (config.assistant || {}).endpoint || cloud.ENDPOINT);
const cloudClient = () => cloud.client({ endpoint: cloudEndpoint(), version: VERSION });
let cloudFlow: ReturnType<typeof cloud.signIn> | null = null;
/** Sign in: a code, the browser, then the token (sealed, this computer's) once it is confirmed there. */
function cloudSignIn() {
  if (!TEST && (config.assistant || {}).provider === 'cloud' && assistantConfig().token) return { ok: true, signedIn: true };     // (already: nothing to do)
  if (cloudFlow) cloudFlow.cancel();
  assistant.setAccount({ step: 'starting', code: '', error: '' });
  const name = os.hostname().replace(/\.(local|lan|home)$/i, '') || 'A computer';
  // (the address to confirm the code at is the service's to say: it is opened only if it is a web page)
  const flow = cloud.signIn({ client: cloudClient(), name, open: (url) => { if (!TEST && navigation.mayOpenOutside(url) && !/^mailto:/i.test(url)) shell.openExternal(url); }, onState: (st) => assistant.setAccount({ ...st, error: '' }) });
  cloudFlow = flow;
  flow.done.then((r) => {
    if (cloudFlow !== flow) return;
    cloudFlow = null;
    assistant.setAccount({ step: '', code: '', error: '', email: r.email });
    if (!TEST) { assistant.configure(setAssistantConfig({ provider: 'cloud', token: r.token, cloudEmail: r.email })); cloudUsage(); }
  }, (err) => {
    if (cloudFlow !== flow) return;
    cloudFlow = null;
    assistant.setAccount({ step: err.code === 'cancelled' ? '' : 'error', code: '', error: cloud.said(err) });
  });
  return { ok: true };
}
function cloudCancel() { if (cloudFlow) { cloudFlow.cancel(); cloudFlow = null; } assistant.setAccount({ step: '', code: '', error: '' }); return { ok: true }; }
/** This computer's token forgotten (the service said it is gone, or the person signed out). */
function cloudForget() {
  if (!TEST && (config.assistant || {}).provider === 'cloud') assistant.configure(setAssistantConfig({ token: '', cloudEmail: '' }));
  assistant.setAccount({ email: '', usage: null, step: '', code: '', error: '' });
}
async function cloudSignOut() {
  const token = TEST ? '' : assistantConfig().token;
  if (token) await cloudClient().signOut(token).catch(() => { /* gone already, or no network: forgotten here either way */ });
  cloudForget();
  return { ok: true };
}
/** This month, for Settings: "23 of 100 asks". */
async function cloudUsage() {
  const token = TEST ? '' : assistantConfig().token;
  if (!token) return { usage: null };
  try {
    const u = await cloudClient().usage(token);
    const usage = { tier: u.tier, used: u.used_percent, resets: u.period_end, asks: u.asks_used, of: u.asks_allowance };
    assistant.setAccount({ usage });
    return { usage };
  } catch (err) {
    if ((err as cloud.CloudError).status === 401) cloudForget();
    return { usage: null, error: cloud.said(err as cloud.CloudError) };
  }
}

// ── the door for coding agents (Claude Code, Codex): bin/ec-mcp.ts talks to the app through this ──────────
const MCP_SCRIPT = path.join(__dirname, '../../bin/ec-mcp.js');
let bridge: ReturnType<typeof createBridge> | null = null;
/** How an agent this app starts reaches our tools: this same program, run as plain Node, running the MCP server. */
// (a driven session that may use the network has a door of its own, in its own settings folder: a real model can then be tried in it without touching the door of an app a person has open)
const DRIVE_DOOR = DRIVE_NET ? path.join(path.resolve(DRIVE), 'settings', 'agent-bridge.json') : null;
function mcpServer(session: string, client: string) { return { command: process.execPath, args: [MCP_SCRIPT, '--session', session, '--client', client, '--no-instructions'], env: { ELECTRON_RUN_AS_NODE: '1', ...(DRIVE_DOOR ? { EC_BRIDGE_FILE: DRIVE_DOOR } : {}) } }; }
/** Open the door while it is wanted (agents allowed, or the assistant is one of them), shut it otherwise. */
async function syncBridge() {
  const a = config.assistant || {};
  const want = TEST ? !!(DRIVE_DOOR && assistant && CLI[assistant.config.provider!]) : (!!a.agents || !!CLI[a.provider!]);
  if (want && !(bridge && bridge.running)) {
    bridge = createBridge({ ...(DRIVE_DOOR ? { file: DRIVE_DOOR } : {}), call: (session, name, input, client) => host.agentCall(session, name, input, client), log: (l) => log(`[bridge] ${l}`) });
    try { await bridge.start(); log('[bridge] open for coding agents on this computer'); } catch (err) { log(`[bridge] could not open: ${(err as Error).message}`); }
  } else if (!want && bridge && bridge.running) { bridge.stop(); log('[bridge] closed'); }
}

let win: BrowserWindow | null = null;
// (made as the app is ready, before any window or menu that uses them)
let host!: Host;
let assistant!: Assistant;
let reports!: Reports;            // Report a problem (app/main/report.ts)
let updates: Updates | null = null;               // new versions (app/main/updates.ts)
let quitAskedAt = 0;
let quitting = false;               // a quit that nothing has refused is under way: windows may close

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 980, minHeight: 620,
    show: false,
    backgroundColor: '#0d0907',
    // macOS: the window's own buttons sit in our title bar. Windows and Linux keep their native frame and menu bar.
    ...(MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } } : { autoHideMenuBar: false }),
    title: APP_NAME,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, offscreen: false },
  });
  win.loadURL('ec://app/index.html');
  host.addView(win.webContents);
  if (!TEST) win.once('ready-to-show', () => win!.show());
  win.webContents.on('render-process-gone', (_e, d) => { log(`[window] the window's page died (${d.reason}); reloading`); setTimeout(() => { if (win && !win.isDestroyed()) win.reload(); }, 300); });
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || Number(e.level) === 3 || SMOKE) log(`[page] ${e.message}`); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  // (a stage left up on the projector with no window to run it from would be worse than a dark one)
  // Closing the main window is quitting: the hidden audio window would otherwise keep the app alive with nothing
  // to click on (and on Windows and Linux, nothing in a dock either). It goes through the same questions as Quit
  // (unsaved changes, sound still playing), and the window stays if the answer is no.
  win.on('close', (e) => { if (quitting || TEST) return; e.preventDefault(); app.quit(); });
  win.on('closed', () => { win = null; if (host) host.stage.close(false); for (const w of [...ownWindows.values()]) if (!w.isDestroyed()) w.close(); });
}

// ── more windows on the same show ───────────────────────────────────────
// A list (or a cart) or the inspector in a window of its own: the same page with a word in its address saying what
// to draw, and one more view of the host. Closing one changes nothing; the show lives in the host.
const ownWindows = new Map<string, BrowserWindow>();       // 'list:<id>' | 'inspector' -> BrowserWindow
function everyWindow() { return [win, ...ownWindows.values()].filter((w): w is BrowserWindow => !!w && !w.isDestroyed()); }
function openOwnWindow(kind: 'inspector' | 'list', { list = '', name = '' } = {}) {
  const key = kind === 'inspector' ? 'inspector' : `list:${list}`;
  const had = ownWindows.get(key);
  if (had && !had.isDestroyed()) { if (!TEST) had.focus(); return had; }
  const w = new BrowserWindow({
    width: kind === 'inspector' ? 900 : 760, height: kind === 'inspector' ? 420 : 620, minWidth: 420, minHeight: 260, show: false, backgroundColor: '#0d0907',
    ...(MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } } : { autoHideMenuBar: true }),
    title: kind === 'inspector' ? 'Inspector' : name || 'List',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  w.loadURL(`ec://app/index.html?${kind === 'inspector' ? 'inspector=1' : `list=${encodeURIComponent(list)}`}`);
  host.addView(w.webContents);
  const wc = w.webContents;
  if (!TEST) w.once('ready-to-show', () => w.show());
  wc.on('render-process-gone', () => setTimeout(() => { if (!w.isDestroyed()) w.reload(); }, 300));
  wc.on('console-message', (e) => { if (e.level === 'error' || Number(e.level) === 3 || SMOKE) log(`[page] ${e.message}`); });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  ownWindows.set(key, w);
  const told = () => { if (kind === 'inspector' && win && !win.isDestroyed()) win.webContents.send('ec-relay', { inspectorOut: ownWindows.has('inspector') }); };
  w.on('closed', () => { host.removeView(wc); ownWindows.delete(key); told(); });
  told();
  return w;
}

// ── opening and saving shows ────────────────────────────────────────────
const SHOWS_DIR = () => path.join(app.getPath('documents'), 'Endless Cues');
function openShow(dir: string): HostResult {
  try { host.open(dir); return { ok: true }; }
  catch (err) { log(`[show] could not open ${dir}: ${(err as Error).stack || err}`); dialog.showErrorBox('Could not open the show', `${dir}\n\n${(err as Error).message}`); return { error: (err as Error).message }; }
}
async function pickShow(): Promise<HostResult> {
  // a show is a package on a Mac (chosen like a file) and a folder everywhere else, or when it is not named .ecshow:
  // both are allowed (Windows and Linux show a folder chooser for this pair), and picked.ts says which was meant
  const r = await dialog.showOpenDialog(win!, { title: 'Open a show', defaultPath: SHOWS_DIR(), properties: ['openFile', 'openDirectory'], message: 'Choose a show (….ecshow)' });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const p = showFolderFrom(r.filePaths[0]);
  return 'error' in p ? { error: p.error } : openShow(p.dir);
}
async function saveShowAs(): Promise<HostResult> {
  fs.mkdirSync(SHOWS_DIR(), { recursive: true });
  const r = await dialog.showSaveDialog(win!, { title: 'Save the show as', defaultPath: path.join(SHOWS_DIR(), `${host.document.doc.title || 'Untitled'}.ecshow`), buttonLabel: 'Save', nameFieldLabel: 'Show name:' });
  if (r.canceled || !r.filePath) return { canceled: true };
  const dir = r.filePath.endsWith('.ecshow') ? r.filePath : `${r.filePath}.ecshow`;
  if (fs.existsSync(path.join(dir, 'show.json'))) return { error: 'There is already a show there.' };
  try { host.saveAs(dir); return { ok: true }; } catch (err) { return { error: (err as Error).message }; }
}
/** Start from a Folder…: any folder becomes a show (a show.json is written beside what is in it; nothing is moved
 *  or copied). A folder that is already a show is opened as it is. The sounds in it are not made into cues: the
 *  assistant's first ask, or dropping them on the list, does that (docs/specs/15-assistant-and-rig.md, 3.9). */
/** Find Missing Sounds: ask for a folder, look in it for each missing sound by name, and say what was found (the menu's item, and the Rig's "Find them…"). */
// (the pickers for sounds, pictures and a folder to look in go inside a show, which a Mac shows as one file: a show's
// media are where people keep their sounds; `treatPackageAsDirectory` is macOS's and ignored elsewhere)
async function findMissing() {
  const r = await dialog.showOpenDialog(win!, { title: 'Look for the missing sounds in', properties: ['openDirectory', 'treatPackageAsDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const x = host.cmd({ op: 'relink', dir: r.filePaths[0] });
  host.notice(x.error || `${x.found} of ${x.missing} missing sound${x.missing === 1 ? '' : 's'} found there${x.found ? ' (not saved until you save)' : ''}.`, 7000);
  return x;
}

async function startInFolder(dir?: string): Promise<HostResult> {
  if (!dir) {
    const r = await dialog.showOpenDialog(win!, { title: 'Start from a folder', properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Start here',
      message: 'The folder your sounds are in becomes the show. Nothing is moved or copied.' });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    dir = r.filePaths[0];
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { error: 'That is not a folder.' };
  const r = openShow(dir);
  // a folder with no cues yet: the assistant's drawer says what is in it and offers the first step (it does nothing until pressed)
  if (r.ok && win && !win.isDestroyed() && host.document.doc.lists.every((l) => !l.cues.length)) win.webContents.send('ec-menu', 'assistant-open');
  return r;
}
function openDemo() {
  const dir = path.join(app.getPath('userData'), 'Demo.ecshow');
  if (!fs.existsSync(path.join(dir, 'show.json'))) makeDemo(dir);
  return openShow(dir);
}
/** A QLab 5 workspace, read from its file and opened as a new, unsaved show. */
function importQlabFile(file: string) {
  try {
    const { importQlab } = require('../../core/import/qlab') as typeof import('../../core/import/qlab');
    const { doc, report } = importQlab(fs.readFileSync(file), { file });
    host.openImported(doc, report);
    return { ok: true, report };
  } catch (err) { log(`[show] could not import ${file}: ${(err as Error).stack || err}`); dialog.showErrorBox('Could not import the workspace', `${file}\n\n${(err as Error).message}`); return { error: (err as Error).message }; }
}
async function pickQlab() {
  const r = await dialog.showOpenDialog(win!, { title: 'Import a QLab workspace', properties: ['openFile'], filters: [{ name: 'QLab 4 or 5 workspace', extensions: ['qlab5', 'qlab5backup', 'qlab4', 'qlab4backup'] }] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  return importQlabFile(r.filePaths[0]);
}
async function importSounds(c: ImportPlace = {}) {
  const r = await dialog.showOpenDialog(win!, { title: 'Add sounds', properties: ['openFile', 'multiSelections', 'treatPackageAsDirectory'], filters: [{ name: 'Sound', extensions: SOUND_EXT }] });
  if (r.canceled) return { canceled: true };
  return host.cmd({ op: 'import', paths: r.filePaths, after: c.after || null, bus: c.bus || null, list: c.list || null, cell: c.cell || null });
}

// ── templates, settings files, the playback log ─────────────────────────
import * as templates from '../../core/show/show-templates';
const TEMPLATES_DIR = () => path.join(app.getPath('userData'), 'templates');
const writeText = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
/** Where to write: the path given (a test run, which has no dialogs), or the one the person chooses. */
async function saveTo(given: string | undefined, options: Electron.SaveDialogOptions) {
  if (given) return given;
  if (TEST) return null;
  const r = await dialog.showSaveDialog(win!, options);
  return r.canceled || !r.filePath ? null : r.filePath;
}
async function openFrom(given: string | undefined, options: Electron.OpenDialogOptions) {
  if (given) return given;
  if (TEST) return null;
  const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], ...options });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
}
/** This show kept as a template: its cues, lists and settings, to start other shows from (never its passcodes). */
async function saveTemplate(given?: string) {
  fs.mkdirSync(TEMPLATES_DIR(), { recursive: true });
  let file = await saveTo(given, { title: 'Save this show as a template', defaultPath: path.join(TEMPLATES_DIR(), `${host.document.doc.title || 'Template'}.ectemplate`), buttonLabel: 'Save Template', filters: [{ name: 'Endless Cues template', extensions: ['ectemplate'] }] });
  if (!file) return { canceled: true };
  if (!/\.ectemplate$/i.test(file)) file += '.ectemplate';
  try { writeText(file, JSON.stringify(host.templateOf(path.basename(file).replace(/\.ectemplate$/i, '')), null, 2) + '\n'); } catch (err) { return { error: (err as Error).message }; }
  buildMenu();
  host.notice(`Saved as the template “${path.basename(file).replace(/\.ectemplate$/i, '')}”: File ▸ New Show from Template.`, 6000);
  return { ok: true, file };
}
async function newFromTemplate(given?: string) {
  const file = await openFrom(given, { title: 'New show from a template', defaultPath: TEMPLATES_DIR(), filters: [{ name: 'Endless Cues template', extensions: ['ectemplate'] }] });
  if (!file) return { canceled: true };
  try { host.openTemplate(templates.showFrom(templates.read(file))); return { ok: true }; }
  catch (err) { if (!TEST) dialog.showErrorBox('Could not open the template', `${file}\n\n${(err as Error).message}`); return { error: (err as Error).message }; }
}
async function exportSettings(given?: string) {
  let file = await saveTo(given, { title: 'Export this show’s settings', defaultPath: path.join(app.getPath('documents'), `${host.document.doc.title || 'Show'} settings.ecsettings`), filters: [{ name: 'Endless Cues settings', extensions: ['ecsettings'] }] });
  if (!file) return { canceled: true };
  if (!/\.ecsettings$/i.test(file)) file += '.ecsettings';
  try { writeText(file, JSON.stringify(host.settingsFile(), null, 2) + '\n'); } catch (err) { return { error: (err as Error).message }; }
  host.notice('Settings exported: buses, patches, GO, MIDI and modules (no passcodes or keys).', 6000);
  return { ok: true, file };
}
async function importSettings(given?: string) {
  const file = await openFrom(given, { title: 'Import settings into this show', filters: [{ name: 'Endless Cues settings', extensions: ['ecsettings', 'json'] }] });
  if (!file) return { canceled: true };
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { error: 'That file cannot be read as settings.' }; }
  const r = host.cmd({ op: 'settings-import', file: data });
  if (r && !r.error) host.notice(r.changed ? `Settings from “${data.from || path.basename(file)}” are in this show, not saved yet (undo puts the old ones back).` : 'Those settings are the ones this show already has.', 7000);
  return r;
}
async function exportPlaylog(given?: string) {
  const d = new Date(), p2 = (n: number) => String(n).padStart(2, '0');
  const file = await saveTo(given, { title: 'Export the playback log', defaultPath: path.join(app.getPath('documents'), `${host.document.doc.title || 'Show'} playback log ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}.csv`), filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (!file) return { canceled: true };
  try { writeText(file, host.playlogCsv()); } catch (err) { return { error: (err as Error).message }; }
  return { ok: true, file };
}
const failed = (title: string) => (r: HostResult | undefined) => { if (r && r.error && !TEST) dialog.showErrorBox(title, r.error); };

// How the window is drawn on this computer (config.json's `view`): the row size, the assistant's face.
function setView(change: Partial<ViewSettings> | null | undefined) {
  const v = { ...(config.view || {}), ...(change && typeof change === 'object' ? change : {}) };
  if (SMOKE || TEST) config.view = v; else saveConfig({ view: v });
  buildMenu();
  for (const w of everyWindow()) w.webContents.send('ec-menu', 'info');       // every window reads its settings again
  return { ok: true };
}

function buildMenu() {
  const kept = templates.list(TEMPLATES_DIR());
  const held = Object.fromEntries(host.snapshot(false).overrides.map((o) => [o.id, o]));
  const hold = (id: string): Item => ({ label: `Hold Back ${held[id].label.replace(' out', ' Out')}`, type: 'checkbox', checked: held[id].on, click: () => { host.cmd({ op: 'override', what: id }); buildMenu(); } });
  const recent = (config.recent || []).filter((p) => fs.existsSync(path.join(p, 'show.json')));
  const send = (action: string) => () => { if (win && !win.isDestroyed()) win.webContents.send('ec-menu', action); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(MAC ? [{ label: APP_NAME, submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: 'Settings…', accelerator: KEY('settings'), click: send('settings') },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] }] satisfies Item[] : []),
    { label: 'File', submenu: [
      { label: 'New Show', accelerator: KEY('newShow'), click: () => host.openUntitled() },
      { label: 'Open…', accelerator: KEY('open'), click: () => pickShow().then((r) => r && r.error && dialog.showErrorBox('Open', r.error)) },
      { label: 'Open Recent', submenu: recent.length ? recent.map((p) => ({ label: path.basename(p), click: () => openShow(p) })) : [{ label: 'None', enabled: false }] },
      { label: 'Open the Demo Show', click: openDemo },
      { label: 'New Show from Template', submenu: [...kept.map((t) => ({ label: t.name, click: () => newFromTemplate(t.file) })), ...(kept.length ? [{ type: 'separator' }] satisfies Item[] : []), { label: 'Choose a Template File…', click: () => newFromTemplate() }] },
      { label: 'Import a QLab Workspace…', click: () => pickQlab() },
      { label: 'Start from a Folder…', click: () => startInFolder().then((r) => r && r.error && dialog.showErrorBox('Start from a folder', r.error)) },
      { type: 'separator' },
      { label: 'Save', accelerator: KEY('save'), click: send('save-version') },
      { label: 'Save with a Note…', accelerator: KEY('saveNote'), click: send('save-version-named') },
      { label: 'Revert to Saved', click: send('revert') },
      { label: 'Save Show As…', click: () => saveShowAs().then((r) => r && r.error && dialog.showErrorBox('Save', r.error)) },
      { label: 'Save as a Template…', click: () => saveTemplate().then(failed('Save as a Template')) },
      { type: 'separator' },
      { label: 'Import Settings…', click: () => importSettings().then(failed('Import Settings')) },
      { label: 'Export Settings…', click: () => exportSettings().then(failed('Export Settings')) },
      { label: 'Export the Playback Log…', click: () => exportPlaylog().then(failed('Export the Playback Log')) },
      { type: 'separator' },
      { label: 'Add Sounds…', accelerator: KEY('addSounds'), click: () => importSounds() },
      { label: MAC ? 'Show in Finder' : 'Show in Folder', click: () => { if (host.document.showDir) shell.showItemInFolder(path.join(host.document.showDir, 'show.json')); } },
      ...(MAC ? [] : [{ type: 'separator' }, { label: 'Settings…', accelerator: KEY('settings'), click: send('settings') }, { role: 'quit' }] satisfies Item[]),
    ] },
    // the roles act on a text field being typed in; in the list, the page's own keys do undo / redo
    // Cut, Copy and Paste are the page's to decide: text in a field being typed in, cues anywhere else
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { label: 'Cut', accelerator: KEY('cut'), click: send('edit-cut') }, { label: 'Copy', accelerator: KEY('copy'), click: send('edit-copy') }, { label: 'Paste', accelerator: KEY('paste'), click: send('edit-paste') },
      { label: 'Paste Cue Properties…', accelerator: KEY('pasteProps'), click: send('edit-paste-props') },
      { role: 'selectAll' }] },
    { label: 'View', submenu: [
      { label: 'Show Mode', accelerator: KEY('showMode'), click: send('toggle-mode') },
      // (the list's own keys fold the groups: < and >; ⌥-click on a caret folds every one like it)
      { label: 'Fold All Groups (<)', click: send('fold-groups') },
      { label: 'Unfold All Groups (>)', click: send('unfold-groups') },
      { label: 'Fold All Sections', click: send('fold-sections') },
      { label: 'Unfold All Sections', click: send('unfold-sections') },
      { label: 'Unfold Everything', click: send('unfold-all') },
      // the Rig: what the show depends on and whether each part is ready (always there; it opens no port and sends nothing)
      { label: 'Rig', accelerator: KEY('rig'), click: send('view-rig') },
      { label: 'Assistant', accelerator: KEY('assistant'), click: send('assistant') },
      { label: 'Versions', accelerator: KEY('versions'), click: send('versions') },
      { label: 'Network and MIDI Monitor', accelerator: KEY('monitor'), click: send('monitor') },
      { label: 'Show Log', accelerator: KEY('log'), click: send('log') },
      { label: 'Black Out the Stage (or Bring It Back)', accelerator: KEY('blackout'), click: () => { const r = host.cmd({ op: 'stage-blackout' }); host.notice(r.blackout ? 'The stage is blacked out. The same key brings it back.' : 'The stage is back.', 4000); } },
      { label: 'Light Dashboard', accelerator: KEY('lights'), click: send('lights') },
      { type: 'separator' }, { role: 'reload', accelerator: KEY('reload') }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { label: 'Tools', submenu: [
      { label: 'Load to Time…', accelerator: KEY('loadToTime'), click: send('tool-load') },
      { label: 'Jump to Cue…', accelerator: KEY('jump'), click: send('tool-jump') },
      { label: 'Find…', accelerator: KEY('find'), click: send('tool-find') },
      { label: 'Find Missing Sounds in a Folder…', click: () => findMissing() },
      { label: 'Renumber Selected Cues…', accelerator: KEY('renumber'), click: send('tool-renumber') },
      { label: 'Delete the Numbers of Selected Cues', click: send('tool-unnumber') },
      { label: 'Go to the Selected Cue’s Target', accelerator: KEY('target'), click: send('tool-target') },
      { label: 'Check the Show', accelerator: KEY('checks'), click: send('tool-checks') },
      { label: 'Run from the Selected Cue…', click: send('tool-run-from') },
      { label: 'Hold or Let Go of a Loop Region (L)', click: send('tool-hold') },
      { type: 'separator' },
      // overrides: for a rehearsal without the equipment. Shown in the title bar for as long as one is on.
      hold('osc'), hold('midi'), hold('timecode'), hold('dmx'),
    ] },
    { role: 'windowMenu', submenu: [
      { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' },
      { label: 'This List in Its Own Window', accelerator: KEY('ownList'), click: send('own-list') },
      { label: 'Inspector in Its Own Window', accelerator: KEY('ownInspector'), click: () => openOwnWindow('inspector') },
      ...(MAC ? [{ type: 'separator' }, { role: 'front' }] satisfies Item[] : [{ type: 'separator' }, { role: 'close' }] satisfies Item[]),
    ] },
    { role: 'help', submenu: [
      { label: 'Keyboard Shortcuts', click: send('help-keys') },
      { label: 'Manual (endlesscues.com)', click: () => { if (!TEST) shell.openExternal('https://endlesscues.com/docs/'); } },
      // (no key: there is no conventional one, and a key pressed by accident would take a picture of the show)
      { label: 'Report a Problem…', click: send('report') },
      { label: 'Check for Updates…', click: () => { if (updates) updates.check(); } },
      // (macOS has About in the app's own menu; Windows and Linux have no such menu)
      ...(MAC ? [] : [{ type: 'separator' }, { role: 'about' }] satisfies Item[]),
    ] },
  ] satisfies Item[]));
}

app.whenReady().then(async () => {
  if (!FIRST) return;
  loadConfig();
  if (TEST) { app.dock && app.dock.hide(); }
  app.setAboutPanelOptions({ credits: 'Mark designed by Esme Roszel. Textures by Callie Nicole Richards.' });
  // The window's pages, served from the app's own folder: ES modules need a real origin.
  protocol.handle('ec', (req) => {
    const url = new URL(req.url);
    const file = path.normalize(path.join(RENDERER, decodeURIComponent(url.pathname)));
    if (file !== RENDERER && !file.startsWith(RENDERER + path.sep)) return new Response('no', { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });

  assistant = createAssistant({ config: TEST ? { provider: 'demo' } : assistantConfig(), log: (l) => log(`[assistant] ${l}`), changed: () => host && host.cmd({ op: 'state' }) });
  if (!TEST && (config.assistant || {}).cloudEmail) assistant.setAccount({ email: config.assistant!.cloudEmail });
  host = createHost({ BrowserWindow, ipcMain, getConfig: () => config, saveConfig: (c) => { if (!SMOKE) { saveConfig(c); if ('recent' in c || 'overrides' in c) buildMenu(); } }, log, smoke: TEST, net: DRIVE_NET, assistant, trash: (p) => shell.trashItem(p), screen, userDir: app.getPath('userData'),
    // the native audio engine's program, used only once this computer chooses it (Settings ▸ Audio ▸ Audio engine)
    nativeBinary: binaryPath({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, root: path.join(__dirname, '..', '..') }) });

  // the keys, asked for once by the preload before the page's modules load (core/ui/keys.ts)
  ipcMain.on('ec-ui-tables', (e) => { e.returnValue = { keys: uiKeys.forPage() }; });
  ipcMain.handle('ec-init', (): AppInfo => ({ version: VERSION, build: BUILD, platform: process.platform, smoke: SMOKE,
    keys: config.keys || {},
    view: { rowSize: ['compact', 'normal', 'large'].includes((config.view || {}).rowSize!) ? config.view!.rowSize! : 'normal',
      // the assistant's face in the side panel (docs/brand-assistant.md): there unless it has been hidden; its one hint, until it has been clicked
      qirx: (config.view || {}).qirx !== false, qirxHint: (config.view || {}).qirxHint !== false },
    types: cueTypes.TYPES, typeOrder: cueTypes.TYPE_ORDER, common: cueTypes.COMMON, colors: cueTypes.COLORS, palette: cueTypes.PALETTE, devices: (require('../../core/net/devices') as typeof import('../../core/net/devices')).list(),
    // sound design (the tools, the eq's bands, the built-in presets) and the kinds of sound, for the inspector and Settings
    sound: (() => { const C = require('../../core/audio/chain') as Chain, K = require('../../core/audio/kinds') as Kinds; return { tools: C.TOOLS, eq: C.EQ_BANDS, presets: C.PRESETS, offer: C.OFFER, sweepable: C.SWEEPABLE, kinds: K.KINDS, kindOrder: K.KIND_ORDER, kindDefaults: Object.fromEntries(K.KIND_ORDER.map((k) => [k, K.defaultsOf(k)])), ducking: K.DUCKING }; })(),
    // the Rig: the tables a device is drawn and edited from (core/rig/devices.ts; the models are `devices` above), and
    // what the prop kit can be told when it writes firmware (absent in a build without the kit)
    rig: (() => { const R = require('../../core/rig/devices') as RigDevices; return { fields: R.FIELDS, commandFields: R.COMMAND_FIELDS, paramFields: R.PARAM_FIELDS, aliveFields: R.ALIVE_FIELDS, reportFields: R.REPORT_FIELDS, kinds: R.KINDS, vias: R.VIAS }; })(),
    kit: (() => { try { return { options: (require('../../core/kit/kit') as typeof import('../../core/kit/kit')).OPTIONS }; } catch { return null; } })(),
    // a test run may lay invented Rig states over what the host pushes, to look at pages no equipment is here to make (app/renderer/Rig.ts `layFixture`)
    fixtures: TEST,
    theme: THEMES.includes(config.theme!) ? config.theme! : 'lab', themes: THEMES,
    assistant: TEST ? { provider: 'demo', providers: {} } : assistantInfo(),
    updates: updates ? updates.settings() : null }));
  ipcMain.handle('ec-cmd', (_e, c: HostCommand) => host.cmd(c));
  // a word from one of this show's windows to the others (the selection, for an inspector in a window of its own)
  ipcMain.on('ec-relay', (e, m: Relay) => { for (const w of everyWindow()) if (w.webContents !== e.sender) w.webContents.send('ec-relay', m); });
  // Report a problem: nothing is sent until the person presses Send in the form
  reports = createReports({ app, mainWindow: () => win, host, getConfig: () => config, saveConfig, log, logLines: () => logLines.slice(-400), version: VERSION, test: TEST, notice: (t, ms) => host.notice(t, ms) });
  ipcMain.handle('ec-app', async (_e, c: AppCommand) => {
    if (c && /^report-/.test(String(c.op))) return reports.handle(c as ReportCommand);
    if (c && /^update-/.test(String(c.op))) return updates!.handle(c as UpdateCommand);
    switch (c?.op) {
      case 'open': return pickShow();
      case 'open-path': return openShow(c.path);
      case 'new': host.openUntitled(); return { ok: true };
      case 'demo': return openDemo();
      case 'import-qlab': return c.path ? importQlabFile(c.path) : pickQlab();
      case 'start-in-folder': return startInFolder(c.path ? String(c.path) : '');
      case 'relink': return findMissing();
      case 'save-as': return saveShowAs();
      case 'template-save': return saveTemplate(c.path);
      case 'template-new': return newFromTemplate(c.path);
      case 'settings-export': return exportSettings(c.path);
      case 'settings-import': return importSettings(c.path);
      case 'playlog-export': return exportPlaylog(c.path);
      // the show log (View ▸ Show Log): its folder, and its lines copied
      case 'log-reveal': { const r = host.cmd({ op: 'log-tail', since: Infinity }); if (r.file && fs.existsSync(r.file) && !TEST) shell.showItemInFolder(r.file); return { ok: !!r.file }; }
      case 'copy-text': clipboard.writeText(String(c.text || '')); return { ok: true };
      case 'backups-reveal': { const r = host.cmd({ op: 'backups' }); if (r.dir && fs.existsSync(r.dir) && !TEST) shell.openPath(r.dir); return { ok: true }; }
      case 'own-window': openOwnWindow(c.inspector ? 'inspector' : 'list', { list: String(c.list || ''), name: String(c.name || '') }); return { ok: true };
      // a right-click on a cue: the system's own menu, and which item was chosen (none in a test run, which has no screen)
      case 'cue-menu': {
        // (a test run has no screen for a menu: it keeps what would have been shown, and may be handed what to pick)
        if (TEST || !win) { global.ecCueMenu = { items: c.items || [], picks: (global.ecCueMenu || {}).picks || [] }; return { picked: global.ecCueMenu.picks.shift() || null }; }
        return new Promise((resolve) => {
          let done = false; const end = (picked: string | null | undefined) => { if (!done) { done = true; resolve({ picked }); } };
          // (an item may hold a submenu (Colour ▸ …), and may be ticked: the colour a cue has now)
          const item = (it: CueMenuItem): Item => (it.sep ? { type: 'separator' } : it.submenu ? { label: String(it.label), enabled: it.enabled !== false, submenu: it.submenu.map(item) }
            : { label: String(it.label), enabled: it.enabled !== false, ...(it.checked !== undefined ? { type: 'checkbox', checked: !!it.checked } : {}), click: () => end(it.id) });
          const menu = Menu.buildFromTemplate((c.items || []).map(item));
          menu.popup({ window: win!, callback: () => setTimeout(() => end(null), 80) });
        });
      }
      case 'import': return importSounds(c);
      case 'native-edit': if (win && ['cut', 'copy', 'paste'].includes(c.what)) win.webContents[c.what as 'cut' | 'copy' | 'paste'](); return { ok: true };
      case 'pick-sound': {
        const midi = c.accept === 'midi';
        const r = await dialog.showOpenDialog(win!, { title: midi ? 'Choose a MIDI file' : 'Choose a sound', properties: ['openFile', 'treatPackageAsDirectory'], filters: [midi ? { name: 'MIDI file', extensions: ['mid', 'midi', 'smf'] } : { name: 'Sound', extensions: SOUND_EXT }] });
        return r.canceled || !r.filePaths[0] ? { canceled: true } : { file: host.adopt(r.filePaths[0]) };
      }
      case 'pick-picture': {
        const { VIDEO_EXT, IMAGE_EXT } = require('../../core/video/stage');
        const r = await dialog.showOpenDialog(win!, { title: 'Choose a video or an image', properties: ['openFile', 'treatPackageAsDirectory'], filters: [{ name: 'Video or image', extensions: [...VIDEO_EXT, ...IMAGE_EXT] }] });
        return r.canceled || !r.filePaths[0] ? { canceled: true } : { file: host.adopt(r.filePaths[0]) };
      }
      case 'recent': return { recent: (config.recent || []).filter((p) => fs.existsSync(path.join(p, 'show.json'))).map((p) => ({ path: p, name: path.basename(p).replace(/\.ecshow$/i, '') })) };
      case 'reveal': if (host.document.showDir && !TEST) shell.showItemInFolder(path.join(host.document.showDir, 'show.json')); return { ok: true };
      case 'log': return { lines: logLines.slice(-300) };
      case 'issue': return { issue: issues.latest() };
      case 'issue-dismiss': issues.dismiss(); return { ok: true };
      // the keys as this person has set them: { actionId: [key…] } (null: every key back to the one it came with)
      case 'keys': { const k = c.keys && typeof c.keys === 'object' ? c.keys : {}; if (SMOKE || TEST) config.keys = k; else saveConfig({ keys: k }); return { ok: true }; }
      // how the list is drawn on this computer (the row size): a matter of the screen and the eyes, not of the show
      case 'view': return setView(c.view);
      // which sections and groups are folded, per show folder: how this computer looks at a show, never the show's
      // own (core/show/sections.ts keepFolds). With `ids`, kept; without, read.
      case 'folds': {
        if (!Array.isArray(c.ids)) return { ids: ((config.folds || {})[c.dir] || []) };
        const folds = require('../../core/show/sections').keepFolds(config.folds, c.dir, c.ids);
        if (SMOKE || TEST) config.folds = folds; else saveConfig({ folds });
        return { ok: true };
      }
      // how far the cue list is zoomed out, per show folder: this computer's too (app/renderer/list-view.ts keepZoom).
      // With `z`, kept; without, read (1: as it is).
      case 'list-zoom': {
        if (!Number.isFinite(c.z)) { const z = (config.listZoom || {})[c.dir]; return { z: Number.isFinite(z) ? z : 1 }; }
        const listZoom = require('../renderer/list-view').keepZoom(config.listZoom, c.dir, c.z);
        if (SMOKE || TEST) config.listZoom = listZoom; else saveConfig({ listZoom });
        return { ok: true };
      }
      case 'theme': if (THEMES.includes(c.theme) && !SMOKE) saveConfig({ theme: c.theme }); else if (SMOKE) config.theme = c.theme; return { ok: true };
      case 'cloud-sign-in': return cloudSignIn();
      case 'cloud-cancel': return cloudCancel();
      case 'cloud-sign-out': return cloudSignOut();
      case 'cloud-usage': return cloudUsage();
      case 'assistant-config': {
        if (TEST) { assistant.configure({ ...(c.config || {}), ...(DRIVE_DOOR ? { mcpServer } : { noDoor: 'in a test window' }) }); await syncBridge(); return { ok: true }; }
        assistant.configure(setAssistantConfig(c.config || {}));
        await syncBridge();
        return { ok: true };
      }
      default: return { error: 'unknown' };
    }
  });

  // New versions: one GET of the feed's file a day, in Edit mode with nothing playing; nothing downloaded until asked
  updates = createAppUpdates({ app, host, getConfig: () => config, saveConfig: (c) => { if (TEST) Object.assign(config, c); else saveConfig(c); }, log, version: VERSION, test: TEST,
    views: () => everyWindow().map((w) => w.webContents), notice: (t, ms) => host.notice(t, ms), quit: askToSave,
    install: (updater) => { quitDecided = true; quitting = true; if (host) host.stage.quitting(); updater.quitAndInstall(); } });

  host.start();
  syncBridge();
  reports.start();
  updates.start();
  // (a folder with a trailing \ as Windows may give it, or the show.json inside one: a folder cannot be given an app to open with there)
  const named = showArg(process.argv.slice(1));
  const qlab = named && /\.qlab[45](backup)?$/i.test(named) ? named : null;
  const arg = named && !qlab ? (/show\.json$/i.test(named) ? path.dirname(named) : named.replace(/[\\/]+$/, '')) : null;
  if (SMOKE) { /* smoke.ts opens its own show */ }
  else if (arg) openShow(arg);
  else if (qlab) importQlabFile(qlab);
  else if (openWhenReady && /\.qlab[45](backup)?$/i.test(openWhenReady)) importQlabFile(openWhenReady);
  else if (openWhenReady) openShow(openWhenReady);
  else if (config.lastShow && fs.existsSync(path.join(config.lastShow, 'show.json'))) openShow(config.lastShow);
  buildMenu();
  createWindow();
  // A show computer does not go to sleep mid-performance.
  powerSaveBlocker.start('prevent-display-sleep');

  if (DRIVE) require('./drive').open({ dir: path.resolve(DRIVE), win, host, log });
  if (SMOKE) require('./smoke').run({ app, host, win, log, makeDemo }).then((code: number) => { host.stop(); app.exit(code); });
});

// Quitting with unsaved changes asks what to do with them (they are journalled, so even "Cancel" loses nothing).
let quitDecided = false;
/** The unsaved-changes question, as quitting asks it: resolves true when the app may go (saved, not saved, or nothing to save). */
async function askToSave() {
  if (TEST || !host || !host.isDirty()) return true;
  const untitled = !host.document.showDir;
  const n = host.document.unsaved().length;
  const r = dialog.showMessageBoxSync(win!, { type: 'warning', buttons: [untitled ? 'Save…' : 'Save', 'Don’t Save', 'Cancel'], defaultId: 0, cancelId: 2,
    message: `Save the ${n} unsaved change${n === 1 ? '' : 's'} to “${host.document.doc.title}”?`, detail: untitled ? 'This show is not in a folder yet.' : 'Changes are kept only when you save.' });
  if (r === 2) return false;
  if (r === 1) { host.document.revert(); return true; }
  if (untitled) { const x = await saveShowAs(); return !!(x && x.ok); }
  host.cmd({ op: 'save' });
  return true;
}
app.on('before-quit', (e) => {
  if (TEST || !host || quitDecided || !host.isDirty() || (host.isSounding() && Date.now() - quitAskedAt >= 3000)) return;
  e.preventDefault();
  askToSave().then((ok) => { if (ok) { quitDecided = true; app.quit(); } });
});

// Quitting with the show sounding asks once more: ⌘Q again within 3 s.
app.on('before-quit', (e) => {
  if (TEST || !host || !host.isSounding()) return;
  if (Date.now() - quitAskedAt < 3000) return;
  e.preventDefault();
  quitAskedAt = Date.now();
  host.notice(`Sound is playing. ${MAC ? 'Press ⌘Q' : 'Quit'} again to quit.`, 3000);
});
app.on('before-quit', (e) => { if (!e.defaultPrevented) { quitting = true; if (host) host.stage.quitting(); } });
app.on('will-quit', () => { if (bridge) bridge.stop(); if (updates) updates.stop(); if (host) host.stop(); });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { if (bridge) bridge.stop(); if (host) host.stop(); app.exit(0); });
app.on('window-all-closed', () => app.quit());
// a show opened from the desktop (double-clicked, or dropped on the app's icon): a folder ….ecshow, or the show.json in it
let openWhenReady: string | null = null;
function openFromDesktop(p: string) {
  const qlab = /\.qlab[45](backup)?$/i.test(p);        // a QLab workspace: read into a new, untitled show (the file itself is never changed)
  const dir = qlab ? p : /show\.json$/i.test(p) ? path.dirname(p) : p.replace(/[\\/]+$/, '');
  if (!qlab && !fs.existsSync(path.join(dir, 'show.json'))) return;
  if (!host) { openWhenReady = dir; return; }
  if (host.isSounding()) { host.notice(`Not opened while the show is sounding: ${path.basename(dir)}. Stop first, then File ▸ Open.`, 8000); return; }
  if (qlab) importQlabFile(dir); else openShow(dir);
}
if (!TEST) app.on('open-file', (e, p) => { e.preventDefault(); openFromDesktop(p); });
process.on('uncaughtException', (err) => log(`[main] uncaught: ${err.stack || err}`));
