/**
 * The stage: the output window that Video, Text and Camera cues are drawn in, and the one thing that knows
 * which display it is on.
 *
 * It is to pictures what the hidden audio window is to sound: the engine (in the host) decides, this file
 * passes it on, and app/stage/stage.html draws. The window holds no show state, so it can be closed, opened,
 * moved to another display, or lose its display, with the show running: the sound goes on, and a stage that
 * (re)opens is told again what is up.
 *
 * Which display is this computer's business (config.json: `stage`), like the audio output. The stage's size and
 * its corner pin are the show's (settings.video; core/video/stage.js). The test pattern and the blackout are
 * neither: they are the operator's hand, gone when the app closes.
 *
 * The window never takes the keyboard: on a display it cannot be focused at all (a click on the projector's
 * screen must not take Space away from the cue list), and it is always shown "inactive". In a test run it is
 * drawn offscreen (nothing appears on any screen) and can be pictured from there.
 */
import * as path from 'path';
import type { BrowserWindow as Win, Display, IpcMain, IpcMainEvent, Screen } from 'electron';
import { stageOf, pinMatrix } from '../../core/video/stage';
import type { CueEngine, EngineStage, PictureSpec } from '../../core/engine/cue-engine';
import type { Geometry } from '../../core/video/stage';
import type { AppConfig } from './main';

const SYNC_MS = 500;              // how often a playing video's picture is checked against its sound

/** What the stage is told to draw (app/stage/stage.ts reads it). */
export interface StageMessage { op: string; [field: string]: unknown }
/** What the stage window says (app/stage/stage.ts). */
export type StageEvent =
  | { type: 'ready' | 'shown' }
  | { type: 'cameras'; list?: unknown }
  | { type: 'error'; id: string; detail: string }
  | { type: 'operror'; op: string; id?: string; detail: string };
/** The stage's commands, through the host's `cmd`: Settings ▸ Integrations ▸ Video. */
export type StageCommand =
  | { op: 'stage-open'; display?: string | null }
  | { op: 'stage-choose'; display?: string | null }
  | { op: 'stage-close' }
  | { op: 'stage-pattern'; on?: boolean }
  | { op: 'stage-blackout'; on?: boolean; secs?: number };
export interface StageOptions {
  BrowserWindow: typeof Win;
  screen: Screen | null;
  ipcMain: IpcMain;
  getConfig: () => AppConfig;
  saveConfig: (change: Partial<AppConfig>) => void;
  log: (line: string) => void;
  test?: boolean;
  engine: CueEngine;
  fileUrl: (file: string) => string;
  audioCmd: (c: { op: string; [field: string]: unknown }) => void;
  notice: (text: string, ms?: number) => void;
  changed: () => void;
  operatorWindow: () => Win | null;
}

function createStage({ BrowserWindow, screen, ipcMain, getConfig, saveConfig, log, test = false, engine, fileUrl, audioCmd, notice, changed, operatorWindow }: StageOptions) {
  let win: Win | null = null;
  let ready = false;
  let where: string | null = null;  // what the open window is on: 'window', or a display's id
  let label = '';
  let waiting: { display: string; label: string } | null = null;     // its display is not connected; it opens when that comes back
  let settings = stageOf({});
  let pattern = false, blackout = false;
  let cameras: string[] = [];
  let saidClosed = false;           // "the stage is not open" is said once, not at every cue
  const movies = new Set();         // cue ids of the videos playing: their pictures are kept in step with their sound
  let syncTimer: ReturnType<typeof setInterval> | undefined;
  let chosen: string | null = null;                // the display the stage opens on when it is opened (this computer's; kept in config.json)
  let quitting = false;             // the app is closing: the stage going with it is not the operator closing the stage

  const send = (cmd: StageMessage) => { if (win && !win.isDestroyed() && ready) win.webContents.send('stage-cmd', cmd); };
  const cfg = () => ((getConfig() || {}).stage) || {};
  const remember = (change: NonNullable<AppConfig['stage']>) => saveConfig({ stage: { ...cfg(), ...change } });

  // ── displays ──────────────────────────────────────────────────────────
  const idOf = (d: Display) => String(d.id);
  function displays() {
    if (!screen) return [];
    const primary = screen.getPrimaryDisplay();
    const mine = operatorDisplay();
    return screen.getAllDisplays().map((d, i) => ({ id: idOf(d), label: d.label || `Display ${i + 1}`, width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor),
      primary: d.id === primary.id, operator: !!mine && d.id === mine.id }));
  }
  function operatorDisplay(): Display | null {
    const w = operatorWindow && operatorWindow();
    try { return w && !w.isDestroyed() && screen ? screen.getDisplayMatching(w.getBounds()) : null; } catch { return null; }
  }
  /** The display asked for: by its id, or (ids change when a cable is moved to another socket) by its name. */
  function find(display: string | null, name?: string): Display | null {
    if (!screen) return null;
    const all = screen.getAllDisplays();
    return all.find((d) => idOf(d) === String(display)) || (name ? all.find((d) => d.label && d.label === name) : null) || null;
  }

  // ── the window ────────────────────────────────────────────────────────
  function open(display: string | null = 'window'): { ok?: boolean; error?: string } {
    close(false);
    waiting = null;
    chosen = String(display);
    const webPreferences: Electron.WebPreferences = { preload: path.join(__dirname, '../stage/preload.js'), backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', ...(test ? { offscreen: true } : {}) };
    if (test) {
      // 960 x 540, or the largest 16:9 the screen holds: Windows narrows a window wider than its screen (an 800 x 600
      // server console), and a stage letterboxed by that would read as a picture that does not fill it
      let width = 960;
      try { width = Math.min(960, screen!.getPrimaryDisplay().workAreaSize.width); } catch { /* no screen: as asked */ }
      win = new BrowserWindow({ show: false, width, height: Math.round(width * 9 / 16), frame: false, backgroundColor: '#000000', webPreferences });
      where = 'window'; label = 'offscreen (a test run)';
    } else if (display === 'window') {
      // an ordinary window, for a computer with one screen, or to drag to a display and make full screen by hand
      win = new BrowserWindow({ show: false, width: 960, height: 540, title: 'Endless Cues stage', backgroundColor: '#000000', webPreferences });
      where = 'window'; label = 'in a window';
      win.once('ready-to-show', () => { if (win && !win.isDestroyed()) win.showInactive(); });
    } else {
      const d = find(display, cfg().label);
      if (!d) { waiting = { display: String(display), label: cfg().label || '' }; log(`[stage] display ${waiting.label || display} is not connected: waiting for it`); changed(); return { error: 'That display is not connected. The stage will open on it when it is.' }; }
      const mine = operatorDisplay();
      if (mine && mine.id === d.id) return { error: 'That is the screen this window is on: the stage would cover it. Choose another display, or “In a window”.' };
      win = new BrowserWindow({ show: false, ...d.bounds, frame: false, resizable: false, movable: false, minimizable: false, fullscreenable: false, focusable: false, skipTaskbar: true,
        hasShadow: false, roundedCorners: false, enableLargerThanScreen: true, backgroundColor: '#000000', webPreferences });
      // above the menu bar and the Dock of its display, without becoming a full-screen Space (which would take the front)
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setBounds(d.bounds);
      where = idOf(d); label = d.label || 'a display';
      win.once('ready-to-show', () => { if (win && !win.isDestroyed()) { win.setBounds(d.bounds); win.showInactive(); } });
    }
    const mine = win;
    ready = false;
    win!.setMenuBarVisibility && win!.setMenuBarVisibility(false);
    win!.loadFile(path.join(__dirname, '../stage/stage.html'), test ? { query: { test: '1' } } : {});
    win!.webContents.on('render-process-gone', (_e, d) => {
      if (win !== mine) return;
      log(`[stage] the stage window died (${d.reason}); making a new one`);
      const again = where;
      close(false);
      setTimeout(() => open(again), 500);
    });
    win.webContents.on('console-message', (e) => { if (e.level === 'error' || Number(e.level) === 3) log(`[stage page] ${e.message}`); });
    // closed by its own close button (the windowed stage): it stays closed until it is opened again
    win.on('closed', () => { if (win !== mine) return; win = null; ready = false; where = null; movies.clear(); if (!test && !quitting) remember({ open: false }); changed(); });
    saidClosed = false;
    if (!test) remember({ open: true, display: where, label: where === 'window' ? '' : label });
    log(`[stage] open ${where === 'window' ? label : `on ${label}`}`);
    changed();
    return { ok: true };
  }
  function close(forget = true) {
    const w = win;
    win = null; ready = false; where = null; movies.clear();
    if (w && !w.isDestroyed()) w.destroy();
    if (forget) { waiting = null; if (!test) remember({ open: false }); log('[stage] closed'); changed(); }
  }

  /** A stage that has just loaded is told everything: its shape, and what the engine has up. */
  function restore() {
    send({ op: 'stage', width: settings.width, height: settings.height, matrix: pinMatrix(settings.width, settings.height, settings.pin) });
    send({ op: 'pattern', on: pattern });
    send({ op: 'blackout', on: blackout });
    send({ op: 'clear' });
    movies.clear();
    for (const p of engine.pictures()) hooks.show(p.id, p.spec, p.paused);
  }

  ipcMain.on('stage-event', (e: IpcMainEvent, ev: StageEvent) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    try {
      switch (ev.type) {
        case 'ready': ready = true; restore(); changed(); break;
        case 'shown': break;
        case 'cameras': cameras = Array.isArray(ev.list) ? ev.list.map(String) : []; changed(); break;
        case 'error': {
          const c = engine.byId.get(ev.id);
          log(`[stage] ${ev.id}: ${ev.detail}`);
          notice(`The stage cannot show ${c ? `${c.number ? `${c.number} ` : ''}${c.name}` : 'a cue'}: ${ev.detail}`, 8000);
          break;
        }
        case 'operror': log(`[stage] ${ev.op}${ev.id ? ` ${ev.id}` : ''} failed: ${ev.detail}`); break;
        default: break;
      }
    } catch (err) { log(`[stage] event ${ev && ev.type}: ${(err as Error).stack || err}`); }
  });

  // ── a display unplugged, or back ──────────────────────────────────────
  // The stage must never land on the operator's screen (the OS would move its window there): it is closed, the
  // sound goes on, and it opens again by itself when the display returns.
  function displayRemoved(_e: unknown, d: Display) {
    if (!win || where === 'window' || where !== idOf(d)) { changed(); return; }
    waiting = { display: where, label };
    close(false);
    log(`[stage] its display (${waiting.label}) was unplugged`);
    notice(`The stage’s display (${waiting.label}) has gone: the picture is off, the show goes on. It comes back when the display does.`, 12000);
    changed();
  }
  function displayAdded() {
    if (waiting && find(waiting.display, waiting.label)) { const w = waiting; const r = open(idOf(find(w.display, w.label)!)); if (r.ok) notice(`The stage is back on ${w.label || 'its display'}.`, 5000); }
    changed();
  }
  function displayChanged(_e: unknown, d: Display) { if (win && !win.isDestroyed() && where === idOf(d)) win.setBounds(d.bounds); changed(); }
  if (screen && !test) { screen.on('display-removed', displayRemoved); screen.on('display-added', displayAdded); screen.on('display-metrics-changed', displayChanged); }

  // ── what the engine asks of the stage ─────────────────────────────────
  const hooks = {
    show(id: string, spec: Partial<PictureSpec> & { from: number; geometry: Geometry }, paused = false) {
      if (!win) {
        if (!saidClosed) { saidClosed = true; log('[stage] a cue with a picture fired with the stage closed'); notice(waiting ? `The stage’s display (${waiting.label || 'the one chosen'}) is not connected: its pictures are not shown.` : 'The stage is not open, so this cue’s picture is not shown. Open it in Settings ▸ Integrations ▸ Video.', 7000); }
        return;
      }
      send({ op: 'show', id, ...spec, url: spec.file ? fileUrl(spec.file) : '', paused });
      if (spec.kind === 'video' && !paused) movies.add(id);
    },
    move: (id: string, props: Partial<Geometry>, secs: number) => send({ op: 'move', id, props, secs }),
    pause: (id: string) => { movies.delete(id); send({ op: 'pause', id }); },
    resume: (id: string) => { if (engine.running.get(id)?.spec?.kind === 'video') movies.add(id); send({ op: 'resume', id }); },
    seek: (id: string, t: number) => send({ op: 'seek', id, t }),
    hide: (id: string) => { movies.delete(id); send({ op: 'hide', id }); },
  } satisfies EngineStage;
  /** From the audio window: where a video's sound is. Its picture is brought to it. */
  function soundAt(ev: { key: string; t: number; at: number }) { if (movies.has(ev.key)) send({ op: 'sync', id: ev.key, t: ev.t, at: ev.at }); }

  /** The show's stage settings (its size and corner pin), whenever the show changes. */
  function configure(showSettings: Parameters<typeof stageOf>[0]) {
    const next = stageOf(showSettings);
    if (JSON.stringify(next) === JSON.stringify(settings)) return;
    settings = next;
    send({ op: 'stage', width: settings.width, height: settings.height, matrix: pinMatrix(settings.width, settings.height, settings.pin) });
  }

  function cmd(c: StageCommand) {
    switch (c.op) {
      case 'stage-open': return open(c.display == null ? (chosen || cfg().display || 'window') : String(c.display));
      // which display, without opening it; a stage that is open (or waiting for its display) moves there
      case 'stage-choose': {
        chosen = String(c.display || 'window');
        const d = find(chosen);
        if (!test) remember({ display: chosen, label: d ? d.label || '' : '' });
        return win || waiting ? open(chosen) : { ok: true };
      }
      case 'stage-close': close(); return { ok: true };
      case 'stage-pattern': pattern = c.on === undefined ? !pattern : !!c.on; send({ op: 'pattern', on: pattern }); return { pattern };
      case 'stage-blackout': blackout = c.on === undefined ? !blackout : !!c.on; send({ op: 'blackout', on: blackout, secs: Math.max(0, Number(c.secs) || 0) }); log(`[stage] blackout ${blackout ? 'on' : 'off'}`); return { blackout };
      default: return { error: 'unknown stage command' };
    }
  }

  function status() {
    return { open: !!win, ready, where, label: win ? label : '', waiting: waiting ? { ...waiting } : null, chosen: chosen || cfg().display || 'window',
             pattern, blackout, displays: displays(), cameras, width: settings.width, height: settings.height, pin: settings.pin, test };
  }

  function start() {
    syncTimer = setInterval(() => { if (ready && movies.size) audioCmd({ op: 'where', keys: [...movies] }); }, SYNC_MS);
    // as it was left: a stage that was open when the app was closed opens again (or waits for its display)
    if (!test && cfg().open) open(cfg().display || 'window');
  }
  function stop() {
    clearInterval(syncTimer);
    if (screen && !test) { screen.removeListener('display-removed', displayRemoved); screen.removeListener('display-added', displayAdded); screen.removeListener('display-metrics-changed', displayChanged); }
    close(false);
  }

  return { hooks, cmd, status, configure, soundAt, start, stop, open, close, quitting: () => { quitting = true; }, window: () => win, clear: () => { movies.clear(); send({ op: 'clear' }); } };
}

export { createStage };
