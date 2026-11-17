// Endless Cues — the window. A view of the show host (app/main/host.ts): it sends commands and draws the state it is pushed.
import { html, render, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, ec, cmd, edit, setCue, setErrorHandler, clock, cx, typingIn, mod, keys, flatten, sectionsIn, indexCues, parseTime, comboOf, keymapOf, defaultKeyOf, DEFAULT_COMBOS, nextNumber } from './lib.js';
import { CueList, NEXT_CONTINUE, HAS_DURATION } from './CueList.js';
import { SectionStrip, foldAll } from './Sections.js';
import { Inspector } from './Inspector.js';
import { Sidebar, Playing } from './Sidebar.js';
import { AssistantDrawer, VersionsDrawer, MonitorDrawer } from './Drawers.js';
import { Settings } from './Settings.js';
import { Live } from './Live.js';
import { PasteProps, Checks } from './EditTools.js';
import { LightsDrawer } from './Lights.js';
import { Cart, cellsOf } from './Cart.js';
import { AddedChooser } from './Kinds.js';
import { Rig, rigDot, layFixture, RIG_TITLE } from './Rig.js';
import { Resident, QirxSign, qirxState } from './Qirx.js';
import { useReport, ReportForm } from './Report.js';
import { useUpdate, UpdateLine } from './Update.js';
import { LV } from './ListTools.js';
import { AddMore } from './AddCue.js';
import { LogDrawer } from './LogView.js';
import { RunFrom } from './RunFrom.js';
import { usePointer } from './Point.js';
import type { VNode } from 'preact';
import type { State, Info, Row, CueIndex, Cue, CueList as List, Op, Pushed } from './lib.js';
import type { Editing } from './CueList.js';
import type { ListZoom } from './ListTools.js';

// A second window on the same show (Window ▸ … in Its Own Window): `?list=<id>` shows that one list or cart,
// `?inspector` the inspector for whatever is selected in the main window. Each is a view like the main one.
const WIN = new URLSearchParams(location.search);
const OWN_LIST = WIN.get('list');
const OWN_INSPECTOR = WIN.has('inspector');
const OWN = !!OWN_LIST || OWN_INSPECTOR;

/** A changed field of a cue, not saved yet (host.ts `snapshot`: show.unsaved). */
export interface PendingField { field: string; label: string; from: unknown; to: unknown; rawFrom: unknown }
/** What is pending, by cue and by setting (its path, to what it was): each changed control marks itself from this. */
export interface Pending { cues: Map<string, { kinds: Set<string>; fields: Map<string, PendingField> }>; paths: Map<string, unknown>; count: number }
type Say = (text: string, bad?: boolean) => void;
type Select = (ids: string[], opts?: { playhead?: boolean }) => void;
/** Invented Rig states a test run lays over what the host pushes (Rig.ts `layFixture`). */
type Fixture = NonNullable<Parameters<typeof layFixture>[1]>;
/** What came across from a QLab workspace (host.ts `snapshot`: imported). */
interface ImportSummary { title: string; qlabVersion?: string; counts: { cues: number; lists: number; patches?: number }; summary: string[] }

declare global {
  interface Window {
    /** (a test run only) lay invented Rig states over the host's, or take them off (null) */
    ecFixture?: (f: Fixture | null) => void;
  }
}

function Welcome({ onDismiss }: { onDismiss: () => void }) {
  const [recent, setRecent] = useState<{ name: string; path: string }[]>([]);
  useEffect(() => { ec.app({ op: 'recent' }).then((r) => setRecent(r.recent || [])); }, []);
  return html`<div class="welcome"><div class="box">
    <img class="mark" src="images/mark.svg" alt="" />
    <h1>Endless Cues <small>public alpha</small></h1>
    <p>Start a show, open one, or try the demo.</p>
    <div class="acts">
      <button class="btn primary" onClick=${onDismiss}>New show</button>
      <button class="btn" data-start-folder onClick=${() => ec.app({ op: 'start-in-folder' })} title="A folder of sounds becomes the show. Nothing is moved.">Start from a folder…</button>
      <button class="btn" onClick=${() => ec.app({ op: 'open' })}>Open…</button>
      <button class="btn" onClick=${() => ec.app({ op: 'demo' })}>Open the demo show</button>
      <button class="btn" onClick=${() => ec.app({ op: 'import-qlab' })} title="A QLab 5 or QLab 4 workspace">Import from QLab…</button>
    </div>
    ${recent.length > 0 && html`<div class="recent"><div class="label">Recent</div>
      ${recent.map((r) => html`<button onClick=${() => ec.app({ op: 'open-path', path: r.path })}><b>${r.name}</b><span>${r.path}</span></button>`)}</div>`}
  </div></div>`;
}

/** After a QLab workspace is imported: what came across, and what did not. */
function Imported({ r, close }: { r: ImportSummary; close: () => void }) {
  const n = r.counts;
  return html`<div class="welcome imported"><div class="box">
    <h1>${r.title} <small>from QLab ${r.qlabVersion || '5'}</small></h1>
    <p>${n.cues} cue${n.cues === 1 ? '' : 's'} in ${n.lists} list${n.lists === 1 ? '' : 's'}${n.patches ? `, ${n.patches} network patch${n.patches === 1 ? '' : 'es'}` : ''}.
      Not saved yet. The QLab file is unchanged.</p>
    <div class="lines">${r.summary.map((line) => html`<div>${line}</div>`)}</div>
    <p class="dim">Kept in the show’s notes.</p>
    <div class="acts"><button class="btn primary" onClick=${close}>OK</button></div>
  </div></div>`;
}

/** The standing-by cue's notes, typed where they are read. Enter keeps them (Shift+Enter: a new line), Esc leaves them. */
function NotesBox({ value, done }: { value: string; done: (v: string | null) => void }) {
  const el = useRef<HTMLTextAreaElement>(null), over = useRef(false);
  const end = (v: string | null) => { if (over.current) return; over.current = true; done(v); };
  // (focused as it is drawn, as the list's own boxes are: a key pressed before a later focus would go to the list)
  useLayoutEffect(() => { el.current!.focus(); el.current!.select(); }, []);
  return html`<textarea ref=${el} class="notes-edit" rows="2" placeholder="Notes for this cue" defaultValue=${value}
    onKeyDown=${(ev: KeyboardEvent) => { ev.stopPropagation(); if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); end((ev.target as HTMLTextAreaElement).value); } if (ev.key === 'Escape') end(null); }}
    onBlur=${(ev: FocusEvent) => end((ev.target as HTMLTextAreaElement).value)}></textarea>`;
}

/** The title bar's tabs: Edit · Rig · Show, and Live once that view is switched on. Show is the cue list in Show mode,
 *  drawn in standby colours; while the app is in Show mode on another tab, the Show tab keeps its yellow words, so
 *  whoever looks up knows the show is locked. */
function Tabs({ tab, editMode, liveOn, rig, goTab }: { tab: string; editMode: boolean; liveOn: boolean; rig: ReturnType<typeof rigDot>; goTab: (t: string) => void }) {
  const T = (id: string, label: string, title: string, extra: VNode | null = null, attrs: Record<string, unknown> = {}) => html`<button role="tab" aria-selected=${tab === id ? 'true' : 'false'} data-tab=${id} ...${attrs}
    class=${cx(tab === id && 'on', id === 'show' && !editMode && 'show')} onClick=${() => goTab(id)} title=${title}>${label}${extra}</button>`;
  return html`<div class="tabs-main" role="tablist" data-tabs>
    ${T('edit', 'Edit', keys('Edit the cue list (⇧⌘M)'))}
    ${T('rig', 'Rig', RIG_TITLE, rig ? html`<span class=${cx('dot', rig)} data-rig-dot=${rig}></span>` : null, { 'data-view-rig': true })}
    ${T('show', 'Show', keys('Run the show: editing is locked (⇧⌘M)'))}
    ${liveOn ? T('live', 'Live', keys('The mixing desk (⌘L)'), null, { 'data-view-live': true }) : null}
  </div>`;
}

function Masthead({ s, byId, onGo, flash, blocked, editMode }: { s: State; byId: CueIndex; onGo: () => void; flash: boolean; blocked: boolean; editMode: boolean }) {
  const e = s.engine;
  const [noting, setNoting] = useState<string | null>(null);         // the id of the cue whose notes are being typed here (Edit mode)
  // double-GO protection: the button is red for as long as a GO would be ignored
  const [locked, setLocked] = useState(false);
  useEffect(() => { if (!(s.goLock > 0)) { setLocked(false); return undefined; } setLocked(true); const t = setTimeout(() => setLocked(false), s.goLock); return () => clearTimeout(t); }, [s.goLock, e.lastGo && e.lastGo.at]);
  const head = e.playhead ? byId.get(e.playhead) : null;
  const cue = head && head.cue;
  const list = (s.doc.lists.find((l) => l.name === e.listName) || s.doc.lists[0]).cues;
  const steps = (e.skipLights ? list.filter((c) => c.type !== 'light' || String(c.levels || '').trim()) : list).filter((c) => c.type !== 'section');
  const next = cue ? steps[steps.findIndex((c) => c.id === cue.id) + 1] : null;
  const disarmed = cue && e.disarmed.includes(cue.id);
  // how many cues this GO sets off: the one standing by and every cue its continues chain into
  const goCount = cue ? LV.chainFrom(list, cue.id, { skipLights: e.skipLights }).length : 0;
  const sounding = e.active.some((a) => a.kind === 'audio');
  const anyPaused = e.active.some((a) => a.paused);
  const [resetAsk, setResetAsk] = useState(0);
  const reset = () => { if (sounding && Date.now() - resetAsk > 3000) { setResetAsk(Date.now()); return; } setResetAsk(0); cmd({ op: 'reset' }); };
  const showClock = e.showStartedAt != null ? e.now - e.showStartedAt : null;
  // a voice-over's words, to follow: the cue standing by, or failing that the voice that is playing now
  const speaking = e.active.map((a) => a.kind === 'audio' && byId.get(a.id)).find((x) => x && x.cue.transcript);
  const said = cue && cue.transcript ? { text: cue.transcript } : speaking ? { text: speaking.cue.transcript, playing: true } : null;
  return html`<div class="masthead">
    <button data-go class=${cx('go-btn', !cue && 'idle', locked && cue && 'locked', flash && 'flash', blocked && 'blocked')} onMouseDown=${(ev: MouseEvent) => ev.preventDefault()} onClick=${onGo} title=${locked ? 'A GO now would be ignored' : 'GO (Space)'}>GO<span class="sub">SPACE</span></button>
    <div class="standby" data-standby>
      <div class="label"><span>${cue ? 'Standing by' : 'End of list'}</span>
        ${goCount > 1 ? html`<span class="go-count" data-go-count title="This cue and the cues its continues start">GO · ${goCount} cues</span>` : null}
        ${disarmed && html`<span class="armed-off">DISARMED · GO skips it</span>`}
        ${e.loaded && cue && e.loaded.id === cue.id && html`<span class="armed-off">LOADED TO ${clock(e.loaded.at)} · this GO only</span>`}
        ${cue && cue.type === 'group' && cue.mode === 'enter' && (cue.children || []).length ? html`<span>THIS GO: ${Math.min((e.entered || {})[cue.id] || 0, cue.children!.length - 1) + 1} OF ${cue.children!.length} · ${s.labels[cue.children![Math.min((e.entered || {})[cue.id] || 0, cue.children!.length - 1)].id]}</span>` : null}
        ${cue && editMode && !cue.notes && noting !== cue.id ? html`<button class="addnote" onClick=${() => setNoting(cue.id)} title="Add a note">+ note</button>` : null}
        ${cue && cue.type === 'light' && cue.lightCue && html`<span>CALL “LQ ${cue.lightCue} GO”${s.modules.some((m) => m.id === 'lighting-desk' && m.running) ? ' · sent to the desk' : ' · not sent: desk module off'}</span>`}</div>
      <div class="cue">${cue ? html`<span class="n">${cue.number || '•'}</span><span class="name">${s.labels[cue.id]}</span>` : html`<span class="name dim">Nothing standing by</span>`}</div>
      ${cue && editMode && noting === cue.id ? html`<${NotesBox} key=${cue.id} value=${cue.notes || ''} done=${(v: string | null) => { setNoting(null); if (v !== null && v !== (cue.notes || '')) setCue(cue.id, { notes: v }, 'notes'); }} />`
        : cue && cue.notes ? html`<div class=${cx('notes', editMode && 'editable')} onClick=${editMode ? () => setNoting(cue.id) : null} title=${editMode ? 'Click to edit' : ''}>${cue.notes}</div>` : cue && cue.transcript ? null : next ? html`<div class="then">${cue!.continue === 'auto-follow' ? 'then, when it ends: ' : cue!.continue === 'auto-continue' ? 'with it: ' : 'then '}${next.number ? next.number + ' · ' : ''}${s.labels[next.id]}</div>` : null}
      ${said ? html`<div class="transcript" data-transcript title="Its transcript"><span class="who">${said.playing ? 'SAYING' : 'IT SAYS'}</span>${said.text}</div>` : null}
    </div>
    <div class="transport">
      <div class="clock"><small>${showClock != null ? 'Show' : ''}</small>${showClock != null ? clock(showClock, 0) : ''}</div>
      <button class="btn danger panic" data-panic onClick=${() => cmd({ op: 'panic' })} title="Fade all out (Esc). Again: stop dead.">Panic</button>
      <div class="lesser">
        <button class=${cx('btn small', anyPaused && 'standby')} data-pause-all onClick=${() => cmd({ op: anyPaused ? 'resume' : 'pause' })} title="Pause all ([) · Resume all (])">${anyPaused ? 'Resume all' : 'Pause all'}</button>
        <button class="btn small" data-fade-all onClick=${() => cmd({ op: 'fadeall', secs: 5 })} title="Fade everything out over 5 s">Fade all</button>
        ${editMode ? html`<button class=${cx('btn small', resetAsk && 'standby')} data-reset onClick=${reset} title="Stop all, back to the top">${resetAsk ? 'Sure? Reset' : 'Reset'}</button>` : null}
      </div>
    </div>
  </div>`;
}

/** What takes the toolbar's place for a moment: Load to Time (⌘T), Jump to cue (⌘J), Renumber (⌘R). Enter does it, Esc closes. */
function ToolStrip({ tool, s, sel, rows, close, say, select, byId, reveal }: { tool: string; s: State; sel: string[]; rows: Row[]; close: () => void; say: Say; select: Select; byId: CueIndex; reveal: (id: string) => void }) {
  const e = s.engine;
  // Find: every cue (in a collapsed group too) whose name, number, notes, file, message or MIDI text has the words
  const [at, setAt] = useState(0);
  const findIn = (c: Cue) => [s.labels[c.id], c.number, c.notes, c.file, c.message, c.midi, c.lightCue, c.hotkey, c.oscTrigger, c.midiTrigger].filter(Boolean).join('\n').toLowerCase();
  const input = useRef<HTMLInputElement>(null);
  // Load to Time opens on the time this cue was last loaded to (selected, so typing replaces it)
  const [text, setText] = useState(tool === 'load' && (e.loaded || e.lastLoad) ? clock(e.loaded ? e.loaded.at : e.lastLoad!, 2) : '');
  const [rn, setRn] = useState({ start: '1', step: '1', prefix: '', suffix: '' });
  const found = tool === 'find' && text.trim() ? [...byId.values()].filter((x) => findIn(x.cue).includes(text.trim().toLowerCase())).map((x) => x.cue.id) : [];
  // (what is found is brought out of a folded section or group: reveal)
  useEffect(() => { if (tool === 'find' && found.length) reveal(found[0]); }, [text]);
  // (⌘T on a selected cue moves the playhead first: the time that cue was last loaded to arrives a moment later)
  useEffect(() => { if (tool === 'load' && !e.loaded && e.lastLoad && text === '') { setText(clock(e.lastLoad, 2)); setTimeout(() => input.current && input.current.select(), 20); } }, [e.playhead, e.lastLoad]);
  useEffect(() => { setTimeout(() => input.current && (input.current.focus(), input.current.select()), 20); }, [tool]);
  const onKey = (ev: KeyboardEvent) => { ev.stopPropagation(); if (ev.key === 'Escape') close(); if (ev.key === 'Enter') run(); };
  const len = e.headLength || 0;
  const load = (secs: number) => cmd({ op: 'load', secs }).then((r) => { if (r && !r.error) setText(r.loaded ? clock(r.loaded.at, 2) : ''); });
  const run = async () => {
    if (tool === 'load') {
      const secs = text.trim() === '' ? 0 : parseTime(text);
      if (!Number.isFinite(secs)) { say('A time: 90, 1:30 or −10', true); return; }
      if (secs < 0 && !len) { say('Its length is not known', true); return; }
      await load(secs); close();
    } else if (tool === 'jump') {
      if (!text.trim()) { close(); return; }
      const r = await cmd({ op: 'jump', number: text.trim() });
      if (r && !r.error) { if (r.playhead) reveal(r.playhead); close(); }
    } else if (tool === 'renumber') {
      const ids = rows.filter((r) => sel.includes(r.cue.id)).map((r) => r.cue.id);
      if (!ids.length) { say('Select cues first', true); return; }
      const start = Number(rn.start), step = Number(rn.step);
      if (!Number.isFinite(start) || !Number.isFinite(step) || step === 0) { say('Start and step are numbers', true); return; }
      const r = await edit([{ op: 'cue.renumber', ids, start, step, prefix: rn.prefix, suffix: rn.suffix }], `renumber ${ids.length} cue${ids.length === 1 ? '' : 's'}`);
      if (r && !r.error) close();
    }
  };
  const field = (key: keyof typeof rn, label: string, width: number) => html`<label>${label}<input type="text" class="mono" style=${`width:${width}px`} value=${rn[key]} onInput=${(ev: Event) => setRn({ ...rn, [key]: (ev.target as HTMLInputElement).value })} onKeyDown=${onKey} ref=${key === 'start' ? input : null} /></label>`;
  return html`<div class="toolbar toolstrip">
    ${tool === 'load' && html`<b>Load to time</b>
      <input ref=${input} type="text" class="mono" style="width:90px" placeholder="0:00" value=${text} onInput=${(ev: Event) => setText((ev.target as HTMLInputElement).value)} onKeyDown=${onKey} />
      ${len > 0 ? html`<input type="range" min="0" max=${len} step="0.1" value=${e.loaded ? e.loaded.at : 0} style="flex:1;max-width:420px"
        onInput=${(ev: Event) => load(Number((ev.target as HTMLInputElement).value))} /><span class="dim num">of ${clock(len)}</span>` : html`<span class="dim">length unknown</span>`}
      <span class="dim">−10: 10 s before the end</span>
      <span class="grow"></span>
      ${e.loaded && html`<button class="btn small" onClick=${() => load(0)}>Clear</button>`}
      <button class="btn small primary" onClick=${run}>Load</button>`}
    ${tool === 'find' && html`<b>Find</b>
      <input ref=${input} type="text" style="width:260px" placeholder="Name, number, note…" value=${text} onInput=${(ev: Event) => { setText((ev.target as HTMLInputElement).value); setAt(0); }} onKeyDown=${(ev: KeyboardEvent) => { ev.stopPropagation(); if (ev.key === 'Escape') close(); if (ev.key === 'Enter') { const n = found.length; if (n) { const j = (at + (ev.shiftKey ? n - 1 : 1)) % n; setAt(j); reveal(found[j]); } } }} />
      <span class="dim">${text.trim() ? (found.length ? `${Math.min(at + 1, found.length)} of ${found.length}` : 'nothing found') : 'Enter: next · ⇧Enter: previous'}</span><span class="grow"></span>
      <button class="btn small" disabled=${!found.length} onClick=${() => { select(found, { playhead: false }); close(); }}>Select all ${found.length || ''}</button>`}
    ${tool === 'jump' && html`<b>Jump to cue</b>
      <input ref=${input} type="text" class="mono" style="width:120px" placeholder="number" value=${text} onInput=${(ev: Event) => setText((ev.target as HTMLInputElement).value)} onKeyDown=${onKey} />
      <span class="dim">in any list</span><span class="grow"></span>
      <button class="btn small primary" onClick=${run}>Jump</button>`}
    ${tool === 'renumber' && html`<b>Renumber ${sel.length} cue${sel.length === 1 ? '' : 's'}</b>
      ${field('start', 'Start at', 60)}${field('step', 'Step', 50)}${field('prefix', 'Prefix', 60)}${field('suffix', 'Suffix', 60)}
      <span class="grow"></span>
      <button class="btn small" disabled=${!sel.some((id) => byId.get(id) && byId.get(id)!.cue.number)} onClick=${async () => { const ids = rows.filter((r) => sel.includes(r.cue.id)).map((r) => r.cue.id); const r = await edit([{ op: 'cue.unnumber', ids }], 'delete numbers'); if (r && !r.error) close(); }}>Delete numbers</button>
      <button class="btn small primary" onClick=${run}>Renumber</button>`}
    <button class="btn ghost small icon" onClick=${close} title="Close (Esc)">×</button>
  </div>`;
}

/** The side panel's Network section, shown or not: a viewer's own choice, kept in this browser (never the show's). */
function keepSideNet(on: boolean) { try { localStorage.setItem('ec.sideNetwork', on ? '1' : '0'); } catch { /* no storage: it is only for now */ } return on; }

/** The cue types the add-cue bar shows; the rest are behind its "+" (AddCue.ts). Every type keeps its ⌘ key. */
const COMMON_TOOLS = ['group', 'audio', 'fade', 'stop', 'memo'];

/** Whether selecting a cue also makes it the one standing by (the show's setting; on unless it says otherwise). */
const locked = (s: State | null) => !s || !s.doc || (s.doc.settings.editing || {}).lockPlayhead !== false;

/** What the window's handlers read when they run (each the latest, kept on a ref). */
interface Now {
  s: State; sel: string[]; drawer: string | null; settings: string | null | undefined; tool: string | null; view: string; checks: boolean;
  pasteProps: Clip | null; liveOn: boolean; report: boolean; goTab: (t: string) => void;
  byId: CueIndex; list: List | null; cart: CartLayout | null; spot: string | null; rows: Row[];
  shut: Set<string>; setFolded: (next: Set<string>) => void; secs: ReturnType<typeof sectionsIn>;
  keymap: Map<string, string>; hotkeys: Map<string, string>;
  /** the cue hotkeys held down: key -> cue id (for their release) */
  down?: Record<string, string>;
  pasteClip: () => void; copySel: (cut: boolean) => void; openPasteProps: () => void; unnumberSel: () => void; goToTarget: () => void; openRunFrom: (id: string) => void;
}
/** What is on the clipboard, while its properties are being chosen. */
type Clip = Parameters<typeof PasteProps>[0]['clip'];
/** A cart's buttons, as the host lays them out. */
type CartLayout = Parameters<typeof cellsOf>[0];

function App() {
  const [s0, setS] = useState<State | null>(null);
  // (a test run may lay invented Rig states over what the host pushes: Rig.ts `layFixture`. Outside one, `fix` is never set.)
  const [fix, setFix] = useState<Fixture | null>(null);
  const s = useMemo(() => layFixture(s0, fix), [s0, fix]);
  const [info, setInfo] = useState<Info | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const collapsedRef = useRef(collapsed); collapsedRef.current = collapsed;
  const [drawer, setDrawer] = useState<string | null>(null);         // 'assistant' | 'versions' | null
  // the assistant is not there in Show mode at all: no resident, no button, its drawer shut, its keys doing nothing
  const mode = s && s.mode;
  const modeRef = useRef(mode); modeRef.current = mode;
  useEffect(() => { if (mode === 'show') setDrawer((d) => (d === 'assistant' ? null : d)); }, [mode]);
  const [settings, setSettings] = useState<string | null | undefined>(null);     // a section name, or null
  const [toast, setToast] = useState<{ text: string; bad: boolean; at: number } | null>(null);
  const [flash, setFlash] = useState(false);
  const [blocked, setBlocked] = useState(false);     // a GO that double-GO protection ignored
  const [tool, setTool] = useState<string | null>(null);             // 'load' | 'jump' | 'renumber': in the toolbar's place
  const [view, setView] = useState('cues');           // 'cues' | 'rig' | 'live': the cue list, the Rig (⇧⌘R), or the mixing desk (⌘L)
  const [focus, setFocus] = useState<{ key: string; n: number; pick?: boolean } | null>(null);           // { key, n }: a field the inspector is asked to bring forward
  // something went wrong (core/report/issues.ts): the status bar offers to report it; in Show mode only a mark until Edit
  const [issue, setIssue] = useState<{ line: string } | null>(null);
  const askIssue = () => ec.app({ op: 'issue' }).then((r) => setIssue((r && r.issue) || null));
  useEffect(() => { askIssue(); }, []);
  // the side panel's Network section: hidden until asked for, remembered by this viewer (the ⋯ menu, or View)
  const [sideNet, setSideNet] = useState(() => { try { return localStorage.getItem('ec.sideNetwork') === '1'; } catch { return false; } });
  const [welcomed, setWelcomed] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);       // { id, field } typed in place in the list
  const [pasteProps, setPasteProps] = useState<Clip | null>(null); // what is on the clipboard, while its properties are being chosen (⌥⌘V)
  const [runFrom, setRunFrom] = useState<{ id: string; label: string } | null>(null);       // Run from here, while its preview is open: { id, label }
  const [checks, setChecks] = useState(false);        // the list of flagged cues and problems, over the footer
  const [revealed, setRevealed] = useState(0);        // counts up when a cue is gone to: the list brings the selection into view
  const listZoom = useRef<ListZoom | null>(null);                      // the cue list's zoom (ListTools.ts useListZoom), for ⌘− ⌘=
  const [linked, setLinked] = useState<{ ids: string[]; at: number } | null>(null);         // { ids }: a continue a deletion has pointed at a new cue, shown for a moment
  const lastProps = useRef<string[] | null>(null);                     // the properties pasted last time
  const [cartId, setCartId] = useState<string | null>(null);         // a cart being shown in place of the list (the list being run stays the engine's)
  const [spot, setSpot] = useState<string | null>(null);             // the cart button the keyboard is on: "row,column"
  const [inspectorOut, setInspectorOut] = useState(false);   // the inspector is in a window of its own
  const ref = useRef<Now>({} as Now);
  // The Live view (the mixing desk, tempo finding, warp) is hidden until it is switched on, on this computer
  // (Settings ▸ General, or the View menu): out of the box the window is a cue list and nothing else.
  const liveOn = !!(info && info.view && info.view.live);
  // (the handlers that read it run once a state has come: the keys and the menus of a window that is drawn)
  ref.current = { ...ref.current, s: s as State, sel, drawer, settings, tool, view, checks, pasteProps, liveOn };
  useEffect(() => { if (!liveOn) setView((v) => (v === 'live' ? 'cues' : v)); }, [liveOn]);
  const showLive = async () => { await ec.app({ op: 'view', view: { live: true } }); setView('live'); };
  // The tabs. Edit and Show are the cue list in each mode, so choosing one sets the mode; the Rig and Live are pages
  // that keep whichever mode the app is in (from Show they open under Show mode's locks: only Edit unlocks).
  const goTab = (t: string) => {
    const mode = ref.current.s && ref.current.s.mode;
    if (t === 'edit' || t === 'show') { const want = t === 'show' ? 'show' : 'edit'; if (mode !== want) cmd({ op: 'mode', mode: want }); setView('cues'); }
    else if (t === 'rig') setView('rig');
    else if (t === 'live' && ref.current.liveOn) setView('live');
  };
  ref.current.goTab = goTab;
  // Report a problem (Help, or Settings ▸ About): the window is pictured as it is, then the form opens (Report.ts).
  // What was on screen goes with it: the tab (or the Settings page), the drawer, and the one selected cue's number and type.
  const report = useReport(() => {
    const st = ref.current, one = st.sel.length === 1 && st.byId && st.byId.get(st.sel[0]);
    const where = st.settings ? `settings: ${st.settings}` : st.view === 'rig' ? 'rig' : st.view === 'live' ? 'live' : 'cue list';
    return { view: `${where}${st.drawer ? ` + ${st.drawer} drawer` : ''}`, selected: one ? { number: one.cue.number || '', type: one.cue.type } : null, closeSettings: () => setSettings(null) };
  });
  ref.current.report = !!report.taken;
  const update = useUpdate();          // a newer version (Update.ts): one line in the title bar, never in Show mode
  // a show just read from a QLab file says what came across, in the cue list
  useEffect(() => { if (s && s.imported) setView('cues'); }, [s && s.imported]);

  const say = useCallback((text: string, bad = false) => { setToast({ text, bad, at: Date.now() }); setTimeout(() => setToast((t) => (t && Date.now() - t.at >= 2900 ? null : t)), 3000); }, []);
  useEffect(() => {
    setErrorHandler((err) => say(err, true));
    ec.init().then((i) => { document.documentElement.dataset.theme = i.theme; setInfo(i); if (i.fixtures) window.ecFixture = (f: Fixture | null) => setFix((was) => (f ? { ...(was || {}), ...f } : null)); });
    ec.onState((push: Pushed) => setS((prev) => ({ ...(prev || {}), ...push, doc: push.doc || (prev && prev.doc), labels: push.labels || (prev && prev.labels) }) as State));
    ec.onMenu((action: string) => {
      if (action === 'settings') setSettings('show');
      else if (action === 'help-keys') setSettings('keys');
      else if (action === 'tool-hold') cmd({ op: 'hold' }).then((r) => { if (r && r.error) say(r.error, true); });
      else if (action === 'assistant') { if (modeRef.current !== 'show') setDrawer((d) => (d === 'assistant' ? null : 'assistant')); }
      else if (action === 'assistant-open') { if (modeRef.current !== 'show') setDrawer('assistant'); }
      else if (action === 'view-rig') setView((v) => (v === 'rig' ? 'cues' : 'rig'));
      else if (action === 'view-live') { if (ref.current.liveOn) setView((v) => (v === 'live' ? 'cues' : 'live')); }
      else if (action === 'info') ec.init().then((i) => { document.documentElement.dataset.theme = i.theme; setInfo(i); });
      else if (action === 'own-list') { const l = ref.current.list; if (l) ec.app({ op: 'own-window', list: l.id, name: l.name }); }
      else if (action === 'edit-cut' || action === 'edit-copy' || action === 'edit-paste') {
        // in a text box these are the text's; anywhere else, the cues'
        const what = action.slice(5);
        if (typingIn() || ref.current.settings || ref.current.view !== 'cues' || (what !== 'copy' && ref.current.s.mode === 'show')) ec.app({ op: 'native-edit', what });
        else if (what === 'paste') ref.current.pasteClip(); else ref.current.copySel(what === 'cut');
      }
      else if (action === 'edit-paste-props') ref.current.openPasteProps();
      else if (action === 'tool-unnumber') ref.current.unnumberSel();
      else if (action === 'tool-target') ref.current.goToTarget();
      else if (action === 'tool-checks') setChecks((c) => !c);
      else if (action === 'versions') setDrawer((d) => (d === 'versions' ? null : 'versions'));
      else if (action === 'monitor') setDrawer((d) => (d === 'monitor' ? null : 'monitor'));
      else if (action === 'issue') askIssue();
      else if (action === 'side-network') setSideNet((v) => keepSideNet(!v));
      else if (action === 'log') setDrawer((d) => (d === 'log' ? null : 'log'));
      else if (action === 'tool-run-from') ref.current.openRunFrom(ref.current.sel[0]);
      else if (action === 'lights') setDrawer((d) => (d === 'lights' ? null : 'lights'));
      else if (action === 'toggle-mode') ref.current.goTab(ref.current.s.mode === 'show' ? 'edit' : 'show');
      else if (action === 'save-version') saveVersion();
      else if (action === 'tool-find') { setView('cues'); setTool((t) => (t === 'find' ? null : 'find')); }
      else if (action === 'tool-jump') { setView('cues'); setTool((t) => (t === 'jump' ? null : 'jump')); }
      else if (action === 'tool-load' || action === 'tool-renumber') { if (ref.current.s.mode === 'show') say('Show mode: switch to Edit for this', true); else {
        // Load to Time is about the cue standing by: with one cue selected somewhere else (a sound inside a group,
        // reached with the arrows), its top-level cue is made the one standing by first
        const st = ref.current; let x = action === 'tool-load' && st.sel.length === 1 ? st.byId.get(st.sel[0]) : null;
        while (x && x.parent) x = st.byId.get(x.parent.id);
        if (x && x.cue.id !== st.s.engine.playhead) { lastHead.current = x.cue.id; cmd({ op: 'playhead', id: x.cue.id }); }
        setView('cues'); setTool((t) => (t === action.slice(5) ? null : action.slice(5))); } }
      else if (action === 'save-version-named') setDrawer('versions');
      else if (/^(un)?fold-(all|groups|sections)$/.test(action)) { const st = ref.current; if (st.byId) st.setFolded(foldAll(st.byId, st.shut, !action.startsWith('un'), action.split('-')[1] as Parameters<typeof foldAll>[3])); }
      else if (action === 'revert') { if (ref.current.s.show.dirty) cmd({ op: 'revert' }).then((r) => r && !r.error && say(keys('Back to the saved show — ⌘Z undoes it'))); }
    });
    // between this show's windows: the selection (for an inspector in its own window), and whether there is one
    ec.onRelay((m: { inspectorOut?: boolean; sel?: string[]; wantSel?: boolean } | null) => {
      if (!m) return;
      if ('inspectorOut' in m && !OWN) setInspectorOut(!!m.inspectorOut);
      if (m.sel && OWN_INSPECTOR) setSel(m.sel);
      if (m.wantSel && !OWN) ec.relay({ sel: ref.current.sel });
    });
    if (OWN_INSPECTOR) ec.relay({ wantSel: true });
    cmd({ op: 'state' });
  }, []);
  useEffect(() => { if (!OWN) ec.relay({ sel }); }, [sel]);

  // Nothing is kept until this (⌘S): the show is written and a version of it recorded.
  const saveVersion = async (note = '') => {
    const st = ref.current.s;
    if (st.show.untitled) { const r = await ec.app({ op: 'save-as' }); if (!r || !r.ok) { if (r && r.error) say(r.error, true); return; } }
    const r = await cmd({ op: 'save', note });
    if (r && r.version) say(r.version.same ? 'Nothing to save' : `Saved ${r.version.id} — ${r.version.note}`);
  };

  const byId = useMemo(() => indexCues(s && s.doc), [s && s.doc]);
  ref.current.byId = byId;
  // the list being run (the engine's), and the list on screen: the same, unless a cart (or, in a window of its own, any list) is being shown
  const engineList = s && s.doc ? (s.doc.lists.find((l) => l.name === s.engine.listName) || s.doc.lists[0]) : null;
  const list = s && s.doc ? ((OWN_LIST ? s.doc.lists.find((l) => l.id === OWN_LIST) : cartId && view !== 'live' ? s.doc.lists.find((l) => l.id === cartId && l.cart) : null) || (OWN_LIST ? null : engineList)) : null;
  const cart = list && list.cart && s!.carts ? s!.carts[list.id] || null : null;
  // What is folded is this computer's way of looking at this show (kept per show folder in config.json, never in the
  // show): read when a show is opened, written when it changes.
  const showDir = s && s.show && s.show.dir;
  const foldsFor = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (OWN || !showDir) { foldsFor.current = null; return; }
    foldsFor.current = undefined;
    ec.app({ op: 'folds', dir: showDir }).then((r) => { if (r && Array.isArray(r.ids)) setCollapsed(new Set(r.ids)); foldsFor.current = showDir; });
  }, [showDir]);
  useEffect(() => { if (foldsFor.current && foldsFor.current === showDir) ec.app({ op: 'folds', dir: showDir, ids: [...collapsed] }); }, [collapsed]);
  // Never hide what matters: in Show mode the section the standing-by cue is in is open, whatever was folded, and
  // closes again when the playhead leaves it (only if it had been folded). A fold made on it then holds (`heldShut`).
  const secs = useMemo(() => (list ? sectionsIn(list.cues) : []), [list]);
  const headSec = s && list ? (secs.find((x) => x.ids.has(s.engine.playhead!)) || {} as { cue?: Cue }).cue : null;
  const [heldShut, setHeldShut] = useState<string | null>(null);
  useEffect(() => setHeldShut(null), [headSec && headSec.id]);
  const forcedOpen = s && s.mode === 'show' && headSec && headSec.id !== heldShut && collapsed.has(headSec.id) ? headSec.id : null;
  const shut = useMemo(() => { if (!forcedOpen) return collapsed; const n = new Set(collapsed); n.delete(forcedOpen); return n; }, [collapsed, forcedOpen]);
  // a fold by hand: on the section held open in Show mode, it closes and stays closed until the playhead moves on
  // (`next` is made from what is drawn: the section held open is kept as folded underneath, so it closes again later)
  const setFolded = (next: Set<string>) => {
    next = new Set(next);
    if (forcedOpen) { if (next.has(forcedOpen)) setHeldShut(forcedOpen); else next.add(forcedOpen); }
    else if (headSec && heldShut === headSec.id && !next.has(headSec.id)) setHeldShut(null);
    setCollapsed(next);
  };
  ref.current.shut = shut; ref.current.setFolded = setFolded; ref.current.secs = secs;
  const rows = useMemo(() => (list ? flatten(list.cues, shut) : []), [list, shut]);
  ref.current.rows = rows; ref.current.list = list; ref.current.cart = cart; ref.current.spot = spot;
  ref.current.keymap = useMemo(() => keymapOf(info && info.keys), [info && info.keys]);
  // the cues' hotkeys, as the keyboard will be asked for them ("shift+b" -> cue id); the app's own keys are never taken
  ref.current.hotkeys = useMemo(() => {
    const m = new Map<string, string>(), own = new Set('psvlaqnotedwcfh');
    for (const [id, x] of byId) {
      const parts = String(x.cue.hotkey || '').trim().toLowerCase().split('+').map((p) => p.trim()).filter(Boolean), key = parts.pop();
      if (!key || !/^([a-z0-9]|f([1-9]|1[0-2]))$/.test(key) || parts.some((p) => p !== 'shift' && p !== 'alt')) continue;
      const k = `${parts.includes('shift') ? 'shift+' : ''}${parts.includes('alt') ? 'alt+' : ''}${key}`;
      if (!own.has(k) && !m.has(k)) m.set(k, id);
    }
    return m;
  }, [byId]);
  const editMode = s && s.mode !== 'show';
  // what is pending, by cue and by setting: each changed control marks itself from this
  const pending = useMemo(() => {
    const cues: Pending['cues'] = new Map(), paths: Pending['paths'] = new Map();
    for (const c of (s && s.show.unsaved) || []) {
      if (c.id) { const e = cues.get(c.id) || { kinds: new Set(), fields: new Map() }; e.kinds.add(c.kind); for (const f of c.fields) e.fields.set(f.field, f); cues.set(c.id, e); }
      if (c.path) paths.set(c.path, c.from);
    }
    return { cues, paths, count: ((s && s.show.unsaved) || []).length };
  }, [s && s.rev, s && s.show.dirty, s && s.show.unsaved.length]);

  // the selection follows the playhead when something else moved it (a GO, a remote, a GoTo cue)
  const lastHead = useRef<string | null>(null);
  useEffect(() => {
    if (!s) return;
    const ph = s.engine.playhead;
    // (only in a window that is showing the list being run: a cart, or a list in a window of its own, keeps its own selection)
    if (ph !== lastHead.current) { lastHead.current = ph; if (ph && locked(s) && !OWN_INSPECTOR && list && list.cues.some((c) => c.id === ph) && !(sel.length > 1 && sel.includes(ph))) setSel([ph]); }
  }, [s && s.engine.playhead]);
  // another list is shown: what was selected in the one before is not selected any more (a new cue would have
  // been added after it, in the list that is not on the screen)
  useEffect(() => {
    if (!list) return;
    const here = new Set(flatten(list.cues, new Set()).map((r) => r.cue.id));
    if (sel.some((id) => !here.has(id))) setSel(sel.filter((id) => here.has(id)));
  }, [list && list.id]);
  // a selected cue that no longer exists is dropped
  useEffect(() => { if (sel.some((id) => !byId.has(id))) setSel(sel.filter((id) => byId.has(id))); }, [byId]);

  const go = useCallback(() => {
    cmd({ op: 'go' }).then((r) => { if (r && r.ignored) { setBlocked(true); setTimeout(() => setBlocked(false), 180); } });
    setFlash(true); setTimeout(() => setFlash(false), 120);
  }, []);
  const select = useCallback((ids: string[], { playhead = true }: { playhead?: boolean } = {}) => {
    setSel(ids);
    // (a section heading is selected to be named or coloured; it is never stood by, so the playhead stays)
    const top = ids.length === 1 && ref.current.s && byId.get(ids[0]) && !byId.get(ids[0])!.parent && byId.get(ids[0])!.cue.type !== 'section' ? ids[0] : null;
    // (with "lock the playhead to the selection" off, selecting a cue leaves the cue standing by where it is)
    if (playhead && top && locked(ref.current.s)) { lastHead.current = top; cmd({ op: 'playhead', id: top }); }
  }, [byId]);

  const addCue = useCallback(async (type: string, at: { before?: string; after?: string } | null = null) => {
    // `at` ({ before } | { after }): a cue type dragged from the toolbar to a place in the list
    const st = ref.current, last = at ? (at.after || (() => { const i = st.rows.findIndex((r) => r.cue.id === at.before); return i > 0 && st.rows[i - 1].depth === st.rows[i].depth ? st.rows[i - 1].cue.id : null; })()) : st.sel[st.sel.length - 1];
    // in a cart a new cue goes on the button the keyboard is on when that one is empty, or else the first free one
    if (st.cart) {
      const free = cellsOf(st.cart).find((c) => !c.id && c.cell === st.spot) || cellsOf(st.cart).find((c) => !c.id);
      if (!free) { say('The cart is full: resize it in Settings ▸ Show', true); return; }
      const r = await edit([{ op: 'cue.add', cue: { type, cell: free.cell }, list: list!.id }], `add ${type}`);
      if (r && r.made && r.made[0]) { setSel([r.made[0]]); setSpot(free.cell); }
      return;
    }
    // a section heading goes above the selected row (its top-level cue: a section is never inside a group), and is
    // given no number and no target
    if (type === 'section') {
      let x: { cue: Cue; parent?: Cue | null } | null | undefined = !at && st.sel.length ? st.rows.find((r) => st.sel.includes(r.cue.id)) : null;
      while (x && x.parent) x = { cue: x.parent, parent: (byId.get(x.parent.id) || {} as { parent?: Cue | null }).parent };
      const spot = at ? (byId.get((at.before || at.after)!) && byId.get((at.before || at.after)!)!.parent ? null : at) : x ? { before: x.cue.id } : { list: list!.id };
      const r = await edit([{ op: 'cue.add', cue: { type: 'section', name: 'Section' }, ...(spot || { list: list!.id }) }], st.sel.length > 1 && !at ? 'section from selection' : 'add section');
      if (r && r.made && r.made[0]) { setSel([r.made[0]]); setEditing({ id: r.made[0], field: 'name' }); }
      return;
    }
    const where = at || (last ? { after: last } : { list: list!.id });
    // QLab's way: a Fade or Stop added with a cue selected is aimed at it, and a new cue takes the next number
    const on = last && byId.get(last) && byId.get(last)!.cue;
    const tf = info && info.types[type].fields.find((f) => f.key === 'target');
    const target = tf && on && on.type !== 'section' && (!tf.targets || tf.targets.includes(on.type)) ? { target: on.id } : {};
    const ed: Partial<State['doc']['settings']['editing']> = st.s.doc.settings.editing || {};
    const inGroup = at ? byId.get((at.before || at.after)!) && byId.get((at.before || at.after)!)!.parent : last && byId.get(last) && byId.get(last)!.parent;
    const number = inGroup || ed.autoNumber === false ? {} : at && at.before && !last ? {} : nextNumber(list!.cues, last, ed.numberStep, [...byId.values()].map((x) => x.cue.number));
    // the show's template for this type (Settings ▸ Show): what a new cue of it starts with
    const tpl = Object.fromEntries(Object.entries((st.s.doc.settings.templates || {})[type as Cue['type']] || {}).filter(([k]) => info && [...info.common, ...info.types[type].fields].some((f) => f.key === k)));
    const r = await edit([{ op: 'cue.add', cue: { type, ...tpl, ...target, ...number }, ...where }], `add ${type}`);
    if (r && r.made && r.made[0]) { setSel([r.made[0]]); if (type !== 'audio') setEditing({ id: r.made[0], field: 'name' }); }
  }, [list, byId, info]);
  // A cue taken out of the middle of a chain leaves the cue before it continuing into whatever comes next. Before a
  // delete or a cut: which continues that will be; after it, the list shows the new link for a moment and says so.
  const strayOf = (ids: string[]) => { const l = ref.current.list; return l ? LV.strayLinks(l.cues, ids, { skipLights: ref.current.s.engine.skipLights }).filter((x): x is typeof x & { to: string } => !!x.to) : []; };
  const sayStray = (stray: ReturnType<typeof strayOf>) => {
    if (!stray.length) return;
    const name = (id: string) => { const x = ref.current.byId.get(id); return x ? x.cue.number || ref.current.s.labels[id] || 'the next cue' : 'the next cue'; };
    const x = stray[0];
    say(keys(`${name(x.from)} now ${x.kind === 'auto-follow' ? 'auto-follows' : 'auto-continues'} into ${name(x.to)} · ⌘Z undoes it`));
    setLinked({ ids: stray.flatMap((y) => [y.from, y.to]), at: Date.now() });
    setTimeout(() => setLinked((v) => (v && Date.now() - v.at >= 2400 ? null : v)), 2500);
  };
  // (the cue after the ones deleted is selected, so the list stays where it was and the next key has something to act on)
  const removeSel = async () => {
    const ids = ref.current.sel; if (!ids.length) return;
    const left = ref.current.rows.filter((r) => !ids.includes(r.cue.id) && !ids.some((id) => { for (let p: Cue | null | undefined = r.parent; p; p = (ref.current.byId.get(p.id) || {} as { parent?: Cue | null }).parent) if (p.id === id) return true; return false; }));
    const last = ref.current.rows.findIndex((r) => r.cue.id === ids[ids.length - 1]);
    const next = left.find((r) => ref.current.rows.indexOf(r) > last) || left[left.length - 1];
    const stray = strayOf(ids);
    const r = await edit(ids.map((id) => ({ op: 'cue.remove', id })), `delete ${ids.length} cue${ids.length === 1 ? '' : 's'}`);
    if (r && !r.error) sayStray(stray);
    // (unless something else has been selected in the meantime)
    if (r && !r.error && next && ref.current.sel.every((id) => ids.includes(id))) select([next.cue.id], { playhead: false });
  };
  // cut, copy and paste of cues (⌘X ⌘C ⌘V when no text is being typed): a cut cue is moved, a copied one is made again
  // (the clipboard is the host's, not this page's and not the show's: what is copied here can be pasted into another show)
  const copySel = async (cut: boolean) => {
    const ids = rows.filter((r) => ref.current.sel.includes(r.cue.id) && !ref.current.sel.includes((r.parent && r.parent.id)!)).map((r) => r.cue.id);
    if (!ids.length) { say('Select a cue first'); return; }
    const stray = cut ? strayOf(ids) : [];
    const r = await cmd({ op: 'clip-copy', ids, cut });
    if (r && !r.error) { say(keys(`${r.count} cue${r.count === 1 ? '' : 's'} ${cut ? 'cut: ⌘V pastes after the selection' : 'copied'}`)); if (stray.length) sayStray(stray); }
  };
  const pasteClip = async () => {
    const st = ref.current;
    // after the selected cue; with nothing selected, at the end of the list (never inside the last group)
    const after = st.sel[st.sel.length - 1] || null;
    const r = await cmd({ op: 'clip-paste', ...(after ? { after } : {}) });
    if (!r || r.error || !r.made) return;
    setSel(r.made);
    if (r.fromAnotherShow) say(`${r.count} cue${r.count === 1 ? '' : 's'} pasted from another show${st.s.show.untitled ? '' : ': their sounds are copied into this one'}`);
  };
  // Paste Cue Properties (⌥⌘V): choose which settings of the copied cue go onto the selection
  const openPasteProps = async () => {
    const st = ref.current;
    if (typingIn() || st.settings || st.view !== 'cues') return;
    if (st.s.mode === 'show') { say('Show mode: switch to Edit for this', true); return; }
    const r = await cmd({ op: 'clip-info' });
    if (!r || !r.clip) { say(keys('Copy a cue first (⌘C)'), true); return; }
    if (!st.sel.length) { say('Select cues to paste onto', true); return; }
    setPasteProps(r.clip);
  };
  const unnumberSel = async () => {
    const st = ref.current;
    if (st.s.mode === 'show') { say('Show mode: switch to Edit for this', true); return; }
    if (!st.sel.length) { say('Select cues first', true); return; }
    edit([{ op: 'cue.unnumber', ids: st.sel }], 'delete numbers');
  };
  // go to a cue wherever it is: the groups it is inside are opened, it is selected, and the list brings it into view
  // (and the section it is in, for Find and Jump too)
  const reveal = (id: string) => {
    const st = ref.current; if (!st.byId.has(id)) return;
    const open = new Set(collapsedRef.current); let changed = false;
    const home = st.s.doc.lists.find((l) => l.cues.some((c) => c.id === id) || LV.revealPath(l.cues, id).length);
    for (const x of home ? LV.revealPath(home.cues, id) : []) if (open.delete(x)) changed = true;
    if (changed) setCollapsed(open);
    setView('cues');
    setSel([id]); setRevealed((n) => n + 1);
  };
  // the assistant pointing at a place (Point.ts): the steps that bring it into view are these, and change only what is shown
  usePointer(OWN ? null : s, {
    mode: () => ref.current.s && ref.current.s.mode, settingsOpen: () => !!ref.current.settings, openSettings: (x?: string) => setSettings(x), closeSettings: () => setSettings(null),
    showCues: () => setView('cues'), reveal,
    // a cue to show an inspector place on: the one named, else the selection if it fits, else the one standing by, else the first that does
    choose: ({ cue = null, types = null }: { cue?: string | null; types?: string[] | null }) => {
      const st = ref.current, fits = (id: string) => { const x = st.byId.get(id); return !!x && x.cue.type !== 'section' && (!types || types.includes(x.cue.type)); };
      if (cue) { if (!st.byId.has(cue)) return 'that cue is not in the show'; reveal(cue); return ''; }
      if (st.sel.length && st.sel.every(fits)) return '';
      const pick = [st.s.engine.playhead, ...st.byId.keys()].find((id) => id && fits(id));
      if (!pick) return types && info ? `the show has no ${types.slice(0, 3).map((t) => info.types[t].label).join(' or ')} cue to show it on` : 'the show has no cues yet';
      reveal(pick); return '';
    },
  });
  // the section strip: a click brings that heading to the top of the list, and selects it
  const goSection = (id: string) => {
    setView('cues'); setSel([id]);
    setTimeout(() => { const el = document.querySelector(`tr[data-section="${id}"]`); if (el) el.scrollIntoView({ block: 'start' }); }, 0);
  };
  const goToTarget = () => {
    const st = ref.current, x = st.sel.length === 1 ? st.byId.get(st.sel[0]) : null;
    if (!x) { say('Select one cue to go to its target', true); return; }
    if (x.cue.target && st.byId.has(x.cue.target)) { reveal(x.cue.target); return; }
    // a cue with no target of its own: the first cue that targets it
    const aimed = [...st.byId.values()].find((y) => y.cue.target === x.cue.id);
    if (aimed) reveal(aimed.cue.id); else say(x.cue.target ? 'Its target is gone' : 'No target, and nothing targets it');
  };
  ref.current.openPasteProps = openPasteProps; ref.current.unnumberSel = unnumberSel; ref.current.goToTarget = goToTarget;
  ref.current.copySel = copySel; ref.current.pasteClip = pasteClip;
  const groupSel = async () => {
    const ids = rows.filter((r) => ref.current.sel.includes(r.cue.id) && !ref.current.sel.includes((r.parent && r.parent.id)!)).map((r) => r.cue.id);
    if (!ids.length) return;
    const r = await edit([{ op: 'cue.add', ref: 'g', cue: { type: 'group', name: 'Group' }, before: ids[0] }, { op: 'cue.move', ids, parent: '@g' }], 'group');
    // the new group stands by: the cue that was (now inside it) cannot, and the playhead would fall to the top
    if (r && r.made) { lastHead.current = r.made[0]; cmd({ op: 'playhead', id: r.made[0] }); setSel([r.made[0]]); setEditing({ id: r.made[0], field: 'name' }); }
  };

  // a right-click on a cue: what can be done to it (or to the selection it is part of)
  // the six colours of the inspector, and Other… for any colour (core/show/cue-types.ts PALETTE)
  const colourMenu = (key: 'color' | 'color2', label: string, cue: Cue, edits: boolean) => ({ label, enabled: edits, submenu: [
    ...(info!.palette || ['none']).map((o) => ({ id: `${key}:${o}`, label: o.charAt(0).toUpperCase() + o.slice(1), checked: (cue[key] || 'none') === o })),
    { sep: true }, { id: `${key}:other`, label: 'Other…', checked: !!cue[key] && !(info!.palette || []).includes(cue[key]) }] });
  const rowMenu = async (id: string) => {
    if (!ref.current.sel.includes(id)) select([id], { playhead: false });
    const x = ref.current.byId.get(id); if (!x) return;
    const edits = ref.current.s.mode !== 'show', many = ref.current.sel.includes(id) && ref.current.sel.length > 1;
    const off = ref.current.s.engine.disarmed.includes(id);
    const has = await cmd({ op: 'clip-info' }), hasClip = !!(has && has.clip);
    const aims = !!x.cue.target || [...ref.current.byId.values()].some((y) => y.cue.target === id);
    const folded = ref.current.shut.has(id);
    // a section heading: what can be done to a heading, and nothing that plays
    const heading = x.cue.type === 'section';
    const r = await ec.app({ op: 'cue-menu', items: heading ? [
      { id: 'fold', label: folded ? 'Unfold' : 'Fold' }, { id: 'fold-sections', label: 'Fold All Sections' }, { id: 'unfold-sections', label: 'Unfold All Sections' }, { sep: true },
      { id: 'rename', label: 'Rename', enabled: edits && !many }, { id: 'section', label: 'Add Section Above', enabled: edits }, { sep: true },
      { id: 'cut', label: 'Cut', enabled: edits }, { id: 'copy', label: 'Copy' }, { id: 'paste', label: 'Paste After', enabled: edits && hasClip }, { sep: true },
      { id: 'delete', label: many ? `Delete ${ref.current.sel.length} Cues` : 'Delete Heading', enabled: edits },
    ] : [
      { id: 'standby', label: 'Stand By Here' }, { id: 'audition', label: 'Audition', enabled: edits }, { id: 'run-from', label: 'Run from Here…', enabled: edits && !many }, { id: 'arm', label: off ? 'Arm' : 'Disarm' }, { sep: true },
      { id: 'rename', label: 'Rename', enabled: edits && !many }, { id: 'number', label: 'Number', enabled: edits && !many }, { id: 'flag', label: x.cue.flagged ? 'Remove Flag' : 'Flag', enabled: edits },
      colourMenu('color', 'Colour', x.cue, edits), colourMenu('color2', 'Colour Once Played', x.cue, edits), { sep: true },
      { id: 'cut', label: 'Cut', enabled: edits }, { id: 'copy', label: 'Copy' }, { id: 'paste', label: 'Paste After', enabled: edits && hasClip }, { id: 'paste-props', label: 'Paste Cue Properties…', enabled: edits && hasClip }, { id: 'duplicate', label: 'Duplicate', enabled: edits }, { sep: true },
      { id: 'target', label: x.cue.target ? 'Go to Its Target' : 'Go to the Cue That Targets It', enabled: aims && !many }, { id: 'unnumber', label: many ? 'Delete Numbers' : 'Delete Number', enabled: edits && ref.current.sel.some((q) => (ref.current.byId.get(q) || { cue: {} }).cue.number) }, { sep: true },
      { id: 'group', label: many ? 'Group These' : 'Put in a Group', enabled: edits }, { id: 'ungroup', label: 'Ungroup', enabled: edits && x.cue.type === 'group' },
      { id: 'section', label: many ? 'Section from Selection' : 'Add Section Above', enabled: edits }, { sep: true },
      { id: 'delete', label: many ? `Delete ${ref.current.sel.length} Cues` : 'Delete', enabled: edits },
    ] });
    const top = (() => { let t = x; while (t.parent) t = ref.current.byId.get(t.parent.id)!; return t.cue.id; })();
    // Colour ▸ a colour of the six; Other… brings the inspector's colour wheel up for the selection
    const colour = r && /^(color2?):(.*)$/.exec(r.picked || '');
    if (colour) {
      if (colour[2] === 'other') setFocus({ key: colour[1], pick: true, n: Date.now() });
      else setCue(ref.current.sel, { [colour[1]]: colour[2] }, colour[1] === 'color' ? 'colour' : 'colour once played');
      return;
    }
    switch (r && r.picked) {
      case 'standby': cmd({ op: 'playhead', id: top }); break;
      case 'audition': cmd({ op: 'fire', id }); break;
      case 'run-from': openRunFrom(top); break;
      case 'arm': cmd({ op: 'arm', id }); break;
      case 'rename': setEditing({ id, field: 'name' }); break;
      case 'number': setEditing({ id, field: 'number' }); break;
      case 'flag': setCue(ref.current.sel, { flagged: !x.cue.flagged }, 'flag'); break;
      case 'cut': copySel(true); break;
      case 'copy': copySel(false); break;
      case 'paste': pasteClip(); break;
      case 'paste-props': openPasteProps(); break;
      case 'target': goToTarget(); break;
      case 'unnumber': unnumberSel(); break;
      case 'duplicate': edit(ref.current.sel.map((q) => ({ op: 'cue.duplicate', id: q })), 'duplicate'); break;
      case 'group': groupSel(); break;
      case 'ungroup': ungroupSel(); break;
      case 'section': addCue('section'); break;
      case 'fold': { const n = new Set(ref.current.shut); if (n.has(id)) n.delete(id); else n.add(id); ref.current.setFolded(n); break; }
      case 'fold-sections': case 'unfold-sections': ref.current.setFolded(foldAll(ref.current.byId, ref.current.shut, r.picked === 'fold-sections', 'sections')); break;
      case 'delete': removeSel(); break;
      default: break;
    }
  };

  // Run from here: on the top-level cue of the one picked (a sound inside a group runs from its group); Edit mode only
  const openRunFrom = (id: string) => {
    const st = ref.current;
    let x = id && st.byId.get(id);
    if (!x) { say('Select a cue to run from', true); return; }
    if (st.s.mode === 'show') { say('Show mode: Run from here is for rehearsals', true); return; }
    while (x.parent) x = st.byId.get(x.parent.id)!;
    setRunFrom({ id: x.cue.id, label: x.cue.number || st.s.labels[x.cue.id] || 'here' });
  };
  ref.current.openRunFrom = openRunFrom;
  // a group taken apart: its cues take its place in the list, and the group goes
  const ungroupSel = async () => {
    const groups = ref.current.sel.map((id) => ref.current.byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x && x.cue.type === 'group');
    if (!groups.length) { say('Select a group to ungroup', true); return; }
    const ops: Op[] = [];
    for (const g of groups) { const kids = (g.cue.children || []).map((c) => c.id); if (kids.length) ops.push({ op: 'cue.move', ids: kids, after: g.cue.id }); ops.push({ op: 'cue.remove', id: g.cue.id }); }
    const kept = groups.flatMap((g) => (g.cue.children || []).map((c) => c.id));
    const r = await edit(ops, groups.length === 1 ? 'ungroup' : `ungroup ${groups.length} groups`);
    if (r && !r.error && kept.length) select(kept, { playhead: false });
  };

  // ── the keys: the show's keys work everywhere but a text field being typed in ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = ref.current;
      if (!st.s || !st.s.doc) return;
      if (st.pasteProps) return;              // the chooser is up: Enter and Esc are its own
      if (st.report) return;                  // so is Report a problem
      const typing = typingIn();
      if (e.key === 'Escape') {
        if (typing) return;                 // Esc in a field cancels the typing (the field's own business); it never panics
        if (st.settings) { setSettings(null); return; }
        if (st.tool) { setTool(null); return; }
        if (st.checks) { setChecks(false); return; }
      }
      if (mod(e) && e.key === ',') { e.preventDefault(); setSettings('show'); return; }
      if (st.settings) return;
      if (typing) return;
      // (a part of the window that has something of its own selected takes Delete first: points on a sound's line)
      if (typeof window.ecKeyHook === 'function' && st.s.mode !== 'show' && window.ecKeyHook(e)) return;
      // a mixer knob that Tab gave the keyboard takes the arrows and Enter (Sidebar.ts); every other key is the window's
      if (!mod(e) && /^(Arrow|Enter$)/.test(e.key) && document.activeElement && document.activeElement.closest && document.activeElement.closest('.kdial')) return;
      // a cue's hotkey fires it (the playhead stays), in Edit and in Show mode alike
      if (!mod(e) && !e.ctrlKey && st.hotkeys && st.hotkeys.size) {
        const base = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : /^Digit\d$/.test(e.code) ? e.code.slice(5) : /^F\d{1,2}$/.test(e.key) ? e.key.toLowerCase() : '';
        const id = base && st.hotkeys.get(`${e.shiftKey ? 'shift+' : ''}${e.altKey ? 'alt+' : ''}${base}`);
        if (id) { e.preventDefault(); if (!e.repeat) { cmd({ op: 'start', id, from: 'hotkey' }); st.down = { ...(st.down || {}), [e.code || e.key]: id }; } return; }
      }
      // the keys as this person has set them (Settings ▸ Keys): a key bound to an action is handled as that action's
      // own key would be; a key that was an action's and has been taken off it does nothing. ⌘ shortcuts are not remapped.
      const pressed = comboOf(e);
      if (pressed) {
        const act = st.keymap.get(pressed);
        if (act) { const real = e; e = { key: defaultKeyOf(act), code: '', shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, repeat: real.repeat, preventDefault: () => real.preventDefault() } as KeyboardEvent; }
        else if (DEFAULT_COMBOS.has(pressed)) return;
      }
      if (e.key === 'Escape') { e.preventDefault(); cmd({ op: 'panic' }); return; }
      const edits = st.s.mode !== 'show';
      const one = st.sel.length === 1 ? st.sel[0] : null;
      const k = e.key;
      if (k === ' ') { e.preventDefault(); if (!e.repeat) go(); return; }
      // the Live view and the Rig: the list is not on screen, so its keys (arrows, Delete, the single letters) do nothing here
      if (st.view !== 'cues') {
        if (mod(e) && k.toLowerCase() === 'z') { e.preventDefault(); if (edits) cmd({ op: e.shiftKey ? 'redo' : 'undo' }); }
        else if (k === '[') cmd({ op: 'pause' });
        else if (k === ']') cmd({ op: 'resume' });
        return;
      }
      // a cart: the arrows walk the buttons, Enter starts the one the keyboard is on (Space is still the GO of the list being run)
      if (st.cart && !mod(e) && !e.altKey && (k.startsWith('Arrow') || k === 'Enter')) {
        e.preventDefault();
        const cells = cellsOf(st.cart);
        const here = cells.find((c) => c.cell === st.spot) || cells.find((c) => c.id && c.id === one) || null;
        if (k === 'Enter') { if (here && here.id) cmd({ op: 'start', id: here.id, from: 'cart' }); return; }
        const row = here ? here.row : 1, column = here ? here.column : 1;
        const to = !here ? cells[0] : cells.find((c) => c.row === Math.max(1, Math.min(st.cart!.rows, row + (k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : 0))) && c.column === Math.max(1, Math.min(st.cart!.columns, column + (k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0))));
        if (to) { setSpot(to.cell); setSel(to.id ? [to.id] : []); }
        return;
      }
      // ⌥⌘↑ ⌥⌘↓: the selected cue moves one place among its siblings
      if (mod(e) && e.altKey && (k === 'ArrowUp' || k === 'ArrowDown') && edits && one) {
        e.preventDefault();
        const x = byId.get(one)!, sibs = x.parent ? x.parent.children! : (st.s.doc.lists.find((l) => l.cues.some((q) => q.id === one)) || { cues: [] }).cues;
        const i = sibs.findIndex((q) => q.id === one), other = sibs[i + (k === 'ArrowUp' ? -1 : 1)];
        if (other) edit([{ op: 'cue.move', ids: [one], ...(k === 'ArrowUp' ? { before: other.id } : { after: other.id }) }], 'move');
        return;
      }
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        const i = rows.findIndex((r) => r.cue.id === (st.sel[st.sel.length - 1] || st.s.engine.playhead));
        const j = Math.max(0, Math.min(rows.length - 1, (i < 0 ? 0 : i) + (k === 'ArrowDown' ? 1 : -1)));
        if (rows[j]) { if (e.shiftKey) setSel([...new Set([...st.sel, rows[j].cue.id])]); else select([rows[j].cue.id]); }
        return;
      }
      if (mod(e) && !e.shiftKey && k.toLowerCase() === 'f') { e.preventDefault(); setView('cues'); setTool('find'); return; }      // (⇧⌘F and ⇧⌘D are the menu's: flagged cues, the Light Dashboard)
      if (mod(e) && k.toLowerCase() === 'z') { e.preventDefault(); if (edits) cmd({ op: e.shiftKey ? 'redo' : 'undo' }); return; }
      if (mod(e) && k.toLowerCase() === 'a') { e.preventDefault(); setSel(rows.map((r) => r.cue.id)); return; }
      if (mod(e) && !e.shiftKey && k.toLowerCase() === 'd' && edits) { e.preventDefault(); if (st.sel.length) edit(st.sel.map((id) => ({ op: 'cue.duplicate', id })), 'duplicate'); return; }
      if (mod(e) && k.toLowerCase() === 'g' && edits) { e.preventDefault(); if (e.shiftKey) ungroupSel(); else groupSel(); return; }
      if (mod(e) && !e.altKey && (k === '-' || k === '=' || k === '+' || (k === '0' && listZoom.current && listZoom.current.zoomed))) { e.preventDefault(); const z = listZoom.current; if (z) { if (k === '0') z.reset(); else z.step(k === '-' ? -1 : 1); } return; }
      if (mod(e) && /^[0-9]$/.test(k) && edits && info) { e.preventDefault(); const t = info.typeOrder[(Number(k) + 9) % 10]; if (t === 'audio') ec.app(st.cart ? { op: 'import', list: st.list!.id } : { op: 'import', after: st.sel[st.sel.length - 1] || null }); else if (t) addCue(t); return; }
      if (mod(e) || e.altKey) return;
      if ((k === 'Backspace' || k === 'Delete') && edits) { e.preventDefault(); removeSel(); return; }
      if (k === '[') { cmd({ op: 'pause' }); return; }
      if (k === ']') { cmd({ op: 'resume' }); return; }
      // = and -: the playhead to the next / the previous cue that needs a GO (past what continues by itself)
      if (k === '=' || k === '-') { cmd({ op: 'sequence', step: k === '=' ? 1 : -1 }).then((r) => { if (r && r.error) say(r.error); }); return; }
      const key = k.toLowerCase();
      if (key === 'p' && one) { cmd({ op: 'toggle', id: one }); return; }
      // S: the selected cue fades out and stops; S again while it fades stops it dead
      if (key === 's' && one) { const fading = st.s.engine.active.some((a) => (a.id === one || a.parent === one) && a.kind === 'audio' && a.fadingTo != null); const kids = st.s.engine.active.filter((a) => a.kind === 'audio' && (a.id === one || a.parent === one)); if (fading || !kids.length) cmd({ op: 'stop', id: one }); else for (const a of kids) cmd({ op: 'stop', id: a.id, fade: true }); return; }
      if (key === 'h') { cmd({ op: 'hold-all' }).then((r) => say(r && r.held ? 'Holding: H again lets go' : 'Hold off')); return; }
      // < >: every group folded, or open (the sections stay as they are); ← →: the selected one
      if (k === '<' || k === '>') { st.setFolded(foldAll(byId, st.shut, k === '<', 'groups')); return; }
      if ((k === 'ArrowLeft' || k === 'ArrowRight') && one && byId.get(one) && (byId.get(one)!.cue.children || byId.get(one)!.cue.type === 'section')) {
        e.preventDefault();
        const n = new Set(st.shut); if (k === 'ArrowLeft') n.add(one); else n.delete(one);
        if (n.has(one) !== st.shut.has(one)) st.setFolded(n);
        return;
      }
      // V plays a cue on top of whatever is running: in Show mode a stray V must not
      if (key === 'v' && one && !(byId.get(one) && byId.get(one)!.cue.type === 'section')) { if (edits) cmd({ op: 'fire', id: one }); else say('Show mode: V is off'); return; }
      if (key === 'l') { cmd({ op: 'hold' }).then((r) => { if (r && r.error) say(r.error, true); }); return; }
      // ⇧I ⇧O: the selected sound's Start at / End at, set to the place it is playing (QLab's in and out)
      if (key === 'shift+i' || key === 'shift+o') {
        const c = one && byId.get(one) && byId.get(one)!.cue, a = c && st.s.engine.active.find((x) => x.kind === 'audio' && x.id === one);
        if (!edits || !c || c.type !== 'audio') return;
        if (!a) { say('Audition it first (V)'); return; }
        const t = Math.round(a.elapsed * 100) / 100;
        setCue(one, key === 'shift+i' ? { from: t } : { cutAt: t }, key === 'shift+i' ? 'start at' : 'end at').then((r) => { if (r && !r.error) say(`${key === 'shift+i' ? 'Start at' : 'End at'} ${clock(t, 2)}`); });
        return;
      }
      if (key === 'a' && one) { cmd({ op: 'arm', id: one }); return; }
      if (edits && one && (key === 'q' || key === 'n' || k === 'Enter')) { e.preventDefault(); setEditing({ id: one, field: key === 'n' ? 'number' : 'name' }); return; }
      // QLab's single keys: E pre-wait, D duration, W post-wait in place; C continue; F flag; O notes and T target in the inspector
      if (!edits || !st.sel.length) return;
      const cue = one && byId.get(one) && byId.get(one)!.cue.type !== 'section' && byId.get(one)!.cue;
      if (cue && (key === 'e' || key === 'w')) { e.preventDefault(); setEditing({ id: one, field: key === 'e' ? 'preWait' : 'postWait' }); return; }
      if (cue && key === 'd') { e.preventDefault(); if (HAS_DURATION.includes(cue.type)) setEditing({ id: one, field: 'duration' }); else say(cue.type === 'audio' ? 'Set Start and End on its Audio tab' : 'This cue has no duration'); return; }
      // (a section heading has no continue mode and no flag: C and F are for the cues selected with it)
      const cues = st.sel.map((id) => byId.get(id)).filter(Boolean).map((x) => x!.cue).filter((c) => c.type !== 'section');
      if (key === 'c' && cues.length) { const next = NEXT_CONTINUE[cues[0].continue || 'none']; setCue(cues.map((c) => c.id), { continue: next }, 'continue'); return; }
      if (key === 'f' && cues.length) { setCue(cues.map((c) => c.id), { flagged: !cues[0].flagged }, cues[0].flagged ? 'unflag' : 'flag'); return; }
      if (key === 'o') { e.preventDefault(); setFocus({ key: 'notes', n: Date.now() }); return; }
      if (key === 't' && cue) {
        e.preventDefault();
        if (cue.type === 'audio') ec.app({ op: 'pick-sound' }).then((r) => { if (r && r.file) setCue(one, { file: r.file }, 'file'); });
        else if (cue.type === 'video') ec.app({ op: 'pick-picture' }).then((r) => { if (r && r.file) setCue(one, { file: r.file }, 'file'); });
        else if (info!.types[cue.type].fields.some((f) => f.key === 'target')) setFocus({ key: 'target', n: Date.now() });
        else say('This cue has no target');
        return;
      }
    };
    // capture: a focused button or slider never takes Space or an arrow for itself
    // a cue's hotkey let go: its "second trigger on release" (a sound that plays while the key is held)
    const onKeyUp = (e: KeyboardEvent) => { const st = ref.current, id = st.down && st.down[e.code || e.key]; if (id) { delete st.down![e.code || e.key]; cmd({ op: 'release', id }); } };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKeyUp, true); };
  }, [rows, info, select, go, addCue, byId]);
  // a click leaves no control holding the keyboard
  useEffect(() => {
    const up = (e: MouseEvent) => { const el = document.activeElement; if (el && el !== document.body && !typingIn(el) && el.tagName !== 'SELECT') (el as HTMLElement).blur(); };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  if (!s || !s.doc || !info) return html`<div class="app"></div>`;
  // the title bar's ⋯: what is used now and then (each keeps its key, and is in the app's menus too)
  const moreMenu = async () => {
    const r = await ec.app({ op: 'cue-menu', items: [
      { id: 'versions', label: keys('Versions (⇧⌘V)'), checked: drawer === 'versions' },
      { id: 'lights', label: keys(lightsSetUp ? 'Light Dashboard (⇧⌘D)' : 'Light Dashboard… (⇧⌘D)'), checked: drawer === 'lights' },
      { id: 'monitor', label: keys('Network and MIDI Monitor (⇧⌘N)'), checked: drawer === 'monitor' },
      { id: 'log', label: keys('Show Log (⌥⌘L)'), checked: drawer === 'log' },
      { id: 'side-network', label: 'Network in the Side Panel', checked: sideNet },
      { sep: true },
      { id: 'report', label: 'Report a Problem…' },
    ] });
    const p = r && r.picked;
    if (p === 'versions' || p === 'lights' || p === 'monitor' || p === 'log') setDrawer((d) => (d === p ? null : p));
    else if (p === 'side-network') setSideNet((v) => keepSideNet(!v));
    else if (p === 'report') report.open();
  };
  // a cue of this type, from the add-cue bar or its "+": a sound is chosen from the disk first
  const addOfType = (t: string) => (t === 'audio' ? ec.app(cart ? { op: 'import', list: list!.id, cell: spot && cellsOf(cart).some((c) => c.cell === spot && !c.id) ? spot : null } : { op: 'import', after: sel[sel.length - 1] || null }) : addCue(t));
  const errors = s.problems.filter((p) => p.level === 'error'), warns = s.problems.filter((p) => p.level !== 'error');
  const empty = !s.doc.lists.some((l) => l.cues.length);
  let cueCount = 0; for (const x of byId.values()) if (x.cue.type !== 'section') cueCount++;     // (a heading is not a cue)
  let flaggedCount = 0; for (const x of byId.values()) if (x.cue.flagged) flaggedCount++;
  const selected = sel.map((id) => byId.get(id)).filter(Boolean).map((x) => x!.cue);
  const running = s.modules.filter((m) => m.running);
  // the host's notice or the page's own, whichever was said last
  const hostLast = s.notice && !(toast && toast.at > (s.noticeAt || 0));
  const notice = hostLast ? s.notice : (toast && toast.text) || s.notice;
  // the assistant's face, standing in the side panel (unless it has been hidden on this computer)
  // the tab on screen: the Rig and Live are pages; the cue list is Edit or Show, as the mode is (the mode is the host's)
  // the Lights button is there once the show has lights of its own (Settings ▸ Integrations ▸ Light); ⇧⌘D opens the dashboard anyway
  const lightsSetUp = !!(s.light && (s.light.on || (s.light.instruments || []).length || s.light.blackout));
  const tab = view === 'rig' ? 'rig' : view === 'live' && liveOn ? 'live' : editMode ? 'edit' : 'show';
  const resident = (info.view || {}).qirx !== false && s.mode !== 'show' ?html`<${Resident} s=${s} info=${info} isOpen=${drawer === 'assistant'} open=${() => setDrawer((d) => (d === 'assistant' ? null : 'assistant'))} refreshInfo=${() => ec.init().then((i) => setInfo(i))} />` : null;

  // a window of its own: one list or cart, or the inspector, and nothing else of the main window around it
  if (OWN) {
    const gone = OWN_LIST && !list;
    return html`<div class=${cx('app own', !editMode && 'show-mode', info.platform === 'darwin' && 'mac')}>
      <div class="wash"></div>
      <div class="titlebar"><div class="title"><span class="name">${OWN_INSPECTOR ? 'Inspector' : gone ? 'List' : list!.name}</span><span class="chip">${s.show.title}</span></div>
        <div class="grow" style="-webkit-app-region:drag;align-self:stretch"></div>
        ${!editMode && html`<span class="chip warn">Show mode</span>`}</div>
      <div class="work own-work"><div class="centre">
        ${OWN_INSPECTOR ? html`<div></div><div class="own-inspector">${!editMode ? html`<div class="empty"><div><b>Show mode</b>Editing is locked.</div></div>` : selected.length ? html`<${Inspector} s=${s} info=${info} selected=${selected} byId=${byId} pending=${pending} focus=${focus} reveal=${reveal} say=${say} openSettings=${setSettings} />` : html`<div class="empty"><div><b>Nothing selected</b></div></div>`}</div>`
          : gone ? html`<div></div><div class="list"><div class="empty"><div><b>This list is gone</b></div></div></div>`
          : html`${editMode ? html`<div class="toolbar">${info.typeOrder.map((t) => html`<button class="tool" title=${info.types[t].summary} onClick=${() => (t === 'audio' ? ec.app({ op: 'import', list: list!.id, cell: cart && spot && cellsOf(cart).some((c) => c.cell === spot && !c.id) ? spot : null }) : addCue(t))}><span class="g">${info.types[t].glyph}</span>${info.types[t].label}</button>`)}</div>` : html`<div></div>`}
            ${cart ? html`<${Cart} s=${s} list=${list} layout=${cart} byId=${byId} sel=${sel} setSel=${setSel} spot=${spot} setSpot=${setSpot} editMode=${editMode} info=${info} onMenu=${rowMenu} />`
              : html`<${CueList} lockPlayhead=${locked(s)} revealed=${revealed} rowSize=${(info.view || {}).rowSize} addCue=${addCue} say=${say} onMenu=${rowMenu} s=${s} list=${list} rows=${rows} byId=${byId} sel=${sel} select=${select} setSel=${setSel} collapsed=${shut} setCollapsed=${setFolded} secs=${secs}
                  editMode=${editMode} editing=${editing} setEditing=${setEditing} info=${info} pending=${pending} />`}
            <div></div>
            ${editMode && selected.length > 0 && html`<${Inspector} s=${s} info=${info} selected=${selected} byId=${byId} pending=${pending} focus=${focus} reveal=${reveal} say=${say} openSettings=${setSettings} />`}`}
      </div></div>
      ${notice && html`<div class=${cx('toast', toast && toast.bad && !hostLast && 'bad')}>${notice}</div>`}
    </div>`;
  }

  return html`<div class=${cx('app', !editMode && 'show-mode', info.platform === 'darwin' && 'mac')}>
    <div class="wash"></div>
    <div class="titlebar">
      <div class="title"><span class="name">${s.show.title}</span>
        ${s.show.untitled ? html`<span class="chip">not saved to a folder</span>` : null}</div>
      <${Tabs} tab=${tab} editMode=${editMode} liveOn=${liveOn} rig=${rigDot(s)} goTab=${goTab} />
      ${liveOn ? null : s.live && s.live.used && s.live.used.length ? html`<button class="chip" data-uses-live onClick=${showLive}
        title=${`Made with the Live view: ${s.live.used.join(', ')}. It plays as made.`}>Uses the Live view</button>` : null}
      ${s.doc.lists.length > 1 && html`<select class="listpick" style="width:auto;height:24px" value=${list ? list.name : s.engine.listName} title="The list on screen"
        onChange=${(e: Event) => { const l = s.doc.lists.find((x) => x.name === (e.target as HTMLSelectElement).value); setView('cues'); setSel([]); setSpot(null); if (l && l.cart) setCartId(l.id); else { setCartId(null); cmd({ op: 'list', name: (e.target as HTMLSelectElement).value }); } }}>${s.doc.lists.map((l) => html`<option value=${l.name}>${l.cart ? `▦ ${l.name}` : l.name}${(s.engine.lists.find((x) => x.name === l.name) || {}).live && l.name !== s.engine.listName ? ' ▶' : ''}</option>`)}</select>`}
      ${cart && engineList && !engineList.cart && html`<button class="chip" onClick=${() => { setCartId(null); setSel([]); }} title="Back to the list GO runs">GO runs ${engineList.name}</button>`}
      <div class="grow" style="-webkit-app-region:drag;align-self:stretch"></div>
      <${UpdateLine} u=${update} s=${s} say=${say} />
      ${s.away && html`<span class="away-line" data-away title="Until then nothing listens on the network, nothing is sent to equipment, and no clock, OSC, MIDI or timecode trigger starts a cue."><span>This show came from another computer. Its network features are off until you turn them on.</span>
        <button class="btn small" data-turn-on onMouseDown=${(ev: MouseEvent) => ev.preventDefault()} onClick=${() => cmd({ op: 'turn-on' }).then((r) => { if (r && r.error) say(r.error, true); })}>Turn on</button></span>`}
      ${running.map((m) => html`<button class=${cx('chip', m.status && !m.status.ok && 'bad')} onClick=${() => setSettings('modules')} title=${m.status ? m.status.text : ''}><span class=${cx('dot', m.status && m.status.ok ? 'go' : 'danger')}></span>${m.name}</button>`)}
      ${s.light.blackout && html`<button class="chip bad loud" onClick=${() => setDrawer('lights')} title="The lights are blacked out">LIGHTS BLACKOUT</button>`}
      ${s.mixer.solo.length > 0 && html`<button class="chip warn" onClick=${() => cmd({ op: 'solo', name: null })} title="Only these are heard. Click to hear all.">SOLO: ${s.mixer.buses.filter((b) => s.mixer.solo.includes(b.id)).map((b) => b.name).join(', ')}</button>`}
      ${s.mixer.buses.some((b) => b.mute) && html`<button class="chip warn" data-muted onClick=${() => (liveOn ? setView('live') : s.mixer.buses.filter((b) => b.mute).forEach((b) => cmd({ op: 'mute', name: b.id })))} title=${liveOn ? 'Muted in the Live view' : 'Muted. Click to unmute.'}>MUTED: ${s.mixer.buses.filter((b) => b.mute).map((b) => b.name).join(', ')}</button>`}
      ${(() => {
        // outputs held back for a rehearsal: one red chip that names them all (a chip each would push the bar out of the window)
        const held = (s.overrides || []).filter((o) => o.on);
        if (!held.length) return null;
        const names = held.map((o) => o.label.replace(/ out$/i, '').toUpperCase());
        return html`<button class="chip bad held loud" onClick=${() => { for (const o of held) cmd({ op: 'override', what: o.id, on: false }); }} title=${`Held back: nothing is sent by ${held.map((o) => o.label).join(', ')}. Click to send again.`}>${held.length === 1 ? `${held[0].label.toUpperCase()} HELD BACK` : `HELD BACK: ${names.join(' · ')}`}</button>`;
      })()}
      ${!s.mixer.deviceOk && html`<button class="chip bad" onClick=${() => setSettings('audio')}>Audio output problem</button>`}
      ${s.stage && s.stage.blackout && html`<button class="chip warn loud" onClick=${() => cmd({ op: 'stage-blackout', on: false })} title="The stage is blacked out. Click to bring it back.">STAGE BLACKOUT</button>`}
      ${s.stage && s.stage.waiting && html`<button class="chip bad" onClick=${() => setSettings('video')} title="The stage’s display is not connected">Stage display gone</button>`}
      ${editMode && html`<button class="btn ghost small" data-undo disabled=${!s.show.canUndo} onClick=${() => cmd({ op: 'undo' })} title=${keys(`Undo ${s.show.undoLabel} (⌘Z)`)}>↶</button>
        <button class="btn ghost small" disabled=${!s.show.canRedo} onClick=${() => cmd({ op: 'redo' })} title=${keys('Redo (⇧⌘Z)')}>↷</button>`}
      ${(() => {
        // Save carries the count of what is not kept yet ("Save · 28"), and lists it when hovered; clean, it says Saved
        const unsaved = s.show.dirty ? `Not kept until you save:\n${s.show.unsaved.slice(0, 12).map((c) => `· ${c.label}${c.fields.length ? `: ${c.fields.map((f: PendingField) => f.label.toLowerCase()).join(', ')}` : c.kind === 'setting' ? '' : ` (${c.kind})`}`).join('\n')}${pending.count > 12 ? '\n…' : ''}\n\n` : '';
        return html`<button class=${cx('btn small save', s.show.dirty && 'standby')} data-save disabled=${!s.show.dirty && !s.show.untitled} onClick=${() => saveVersion()} title=${unsaved + keys('Save the show and record a version (⌘S)')}>${s.show.dirty ? `Save · ${pending.count}` : s.show.untitled ? 'Save' : 'Saved'}</button>`;
      })()}
      <button class=${cx('btn ghost small icon', ['versions', 'lights', 'monitor', 'log'].includes(drawer!) && 'on')} data-more-menu onClick=${moreMenu} title="Versions, lights, network, the show log, report a problem">⋯</button>
      ${s.mode !== 'show' ? html`<button class=${cx('btn ghost small', drawer === 'assistant' && 'on')} onClick=${() => setDrawer(drawer === 'assistant' ? null : 'assistant')} data-assistant-button title=${keys('Assistant (⌘K)')}><${QirxSign} state=${qirxState(s).state} /> Assistant${s.proposal ? html` <span class="dot standby"></span>` : ''}</button>` : null}
      <button class="btn ghost small icon" data-settings-button onClick=${() => setSettings('show')} title=${keys('Settings (⌘,)')}>⚙</button>
    </div>

    <${Masthead} s=${s} byId=${byId} onGo=${go} flash=${flash} blocked=${blocked} editMode=${editMode} />

    <div class=${cx('work', drawer && 'drawer', view === 'live' && liveOn && 'live-view')}>
      ${view === 'live' && liveOn ? html`<${Live} s=${s} list=${engineList} byId=${byId} pending=${pending} editMode=${editMode} say=${say} />` : view === 'rig' ? html`<div class="centre rig-centre">
        <${Rig} s=${s} info=${info} byId=${byId} sel=${sel} list=${engineList} editMode=${editMode} say=${say} reveal=${reveal} saveVersion=${saveVersion} openSettings=${setSettings} openDrawer=${(d: string) => setDrawer(d)} openCheck=${() => { setView('cues'); setChecks(true); }} />
        ${s.imported && html`<${Imported} r=${s.imported} close=${() => cmd({ op: 'import-seen' })} />`}
      </div>
      <${Sidebar} s=${s} byId=${byId} openSettings=${setSettings} openMonitor=${() => setDrawer('monitor')} pending=${pending} resident=${resident} network=${sideNet} />` : html`<div class="centre">
        ${tool ? html`<${ToolStrip} key=${tool} tool=${tool} s=${s} sel=${sel} rows=${rows} close=${() => setTool(null)} say=${say} select=${select} byId=${byId} reveal=${reveal} />` : editMode ? html`<div class="toolbar" data-add-bar>
          ${info.typeOrder.filter((t) => COMMON_TOOLS.includes(t)).map((t) => { const i = info.typeOrder.indexOf(t); return html`<button class="tool" data-add-type=${t} draggable=${t !== 'audio'} onDragStart=${(ev: DragEvent) => { ev.dataTransfer!.effectAllowed = 'copy'; ev.dataTransfer!.setData('application/x-ec-type', t); }} title=${keys(`${info.types[t].summary}${i < 10 ? `  (⌘${(i + 1) % 10})` : ''}`)} onClick=${() => addOfType(t)}><span class="g">${info.types[t].glyph}</span>${info.types[t].label}</button>`; })}
          <${AddMore} info=${info} shown=${COMMON_TOOLS} add=${addOfType} />
          ${sel.length > 1 || sel.some((id) => byId.get(id) && byId.get(id)!.cue.type === 'group') ? html`<span class="sep"></span>` : null}
          ${sel.length > 1 ? html`<button class="tool" onClick=${groupSel} title=${keys('Group the selected cues (⌘G)')}>Group selection</button>` : null}
          ${sel.some((id) => byId.get(id) && byId.get(id)!.cue.type === 'group') ? html`<button class="tool" onClick=${ungroupSel} title=${keys('Ungroup: its cues stay in its place (⇧⌘G)')}>Ungroup</button>` : null}
        </div>` : html`<div></div>`}
        ${cart ? null : html`<${SectionStrip} secs=${secs} s=${s} shut=${shut} go=${goSection} />`}
        ${cart ? html`<${Cart} s=${s} list=${list} layout=${cart} byId=${byId} sel=${sel} setSel=${setSel} spot=${spot} setSpot=${setSpot} editMode=${editMode} info=${info} onMenu=${rowMenu} />`
          : html`<${CueList} lockPlayhead=${locked(s)} revealed=${revealed} zoomRef=${listZoom} linked=${linked} rowSize=${(info.view || {}).rowSize} addCue=${addCue} say=${say} onMenu=${rowMenu} s=${s} list=${list} rows=${rows} byId=${byId} sel=${sel} select=${select} setSel=${setSel} collapsed=${shut} setCollapsed=${setFolded} secs=${secs}
          editMode=${editMode} editing=${editing} setEditing=${setEditing} info=${info} pending=${pending} />`}
        <${Playing} s=${s} byId=${byId} selected=${selected} />
        ${editMode && !inspectorOut && html`<${Inspector} s=${s} info=${info} selected=${selected} byId=${byId} pending=${pending} focus=${focus} reveal=${reveal} say=${say} openSettings=${setSettings} />`}
        ${empty && s.show.untitled && !welcomed && !s.imported && html`<${Welcome} onDismiss=${() => setWelcomed(true)} />`}
        ${s.imported && html`<${Imported} r=${s.imported} close=${() => cmd({ op: 'import-seen' })} />`}
      </div>
      <${Sidebar} s=${s} byId=${byId} openSettings=${setSettings} openMonitor=${() => setDrawer('monitor')} pending=${pending} resident=${resident} network=${sideNet} />`}
      ${drawer === 'assistant' && html`<${AssistantDrawer} s=${s} info=${info} close=${() => setDrawer(null)} openSettings=${setSettings} say=${say} refreshInfo=${() => ec.init().then((i) => setInfo(i))} />`}
      ${drawer === 'lights' && html`<${LightsDrawer} s=${s} sel=${sel} byId=${byId} close=${() => setDrawer(null)} openSettings=${setSettings} say=${say} />`}
      ${drawer === 'monitor' && html`<${MonitorDrawer} s=${s} close=${() => setDrawer(null)} openSettings=${setSettings} />`}
      ${drawer === 'log' && html`<${LogDrawer} close=${() => setDrawer(null)} say=${say} />`}
      ${drawer === 'versions' && html`<${VersionsDrawer} s=${s} close=${() => setDrawer(null)} saveVersion=${saveVersion} say=${say} />`}
    </div>

    <div class="footer">
      <span>${cueCount} cue${cueCount === 1 ? '' : 's'}</span>
      ${editMode && html`<button data-check onClick=${() => setChecks(!checks)} title=${keys('Check the show without playing it (⇧⌘F)')}>Check</button>`}
      ${errors.length > 0 && html`<button class="bads" onClick=${() => setChecks(!checks)} title=${errors.map((p) => `${s.labels[p.id] || p.id}: ${p.why}`).join('\n')}>✕ ${errors.length} broken</button>`}
      ${warns.length > 0 && html`<button class="warns" onClick=${() => setChecks(!checks)} title=${warns.map((p) => `${s.labels[p.id] || p.id}: ${p.why}`).join('\n')}>▲ ${warns.length} warning${warns.length === 1 ? '' : 's'}</button>`}
      ${flaggedCount > 0 && html`<button class="flags" onClick=${() => setChecks(!checks)} title=${keys('The flagged cues, listed (⇧⌘F)')}>⚑ ${flaggedCount} flagged</button>`}
      ${!editMode && html`<span style="color:var(--standby)">SHOW MODE — editing is locked</span>`}
      ${issue ? (editMode
        ? html`<span class="issue" data-issue title=${issue.line}>Something went wrong. Report it?
            <button class="btn small" data-issue-report onClick=${() => { report.open({ issue: issue.line }); ec.app({ op: 'issue-dismiss' }); setIssue(null); }}>Report</button>
            <button class="x" data-issue-dismiss onClick=${() => { ec.app({ op: 'issue-dismiss' }); setIssue(null); }} title="Dismiss">×</button></span>`
        // (in Show mode it waits as a mark, takes no keys and no focus, and says itself in full back in Edit)
        : html`<span class="issue-mark" data-issue-mark title="Something went wrong. Shown in Edit, to report."><span class="dot standby"></span></span>`) : null}
      <span class="grow"></span>
      ${s.mixer.muted && html`<span class="warns">output muted (test run)</span>`}
      <button data-output-device onClick=${() => setSettings('audio')}>${(s.mixer.devices.find((d) => d.id === s.mixer.device) || {}).label || 'System default output'}</button>
      <button data-report-open onMouseDown=${(ev: MouseEvent) => ev.preventDefault()} onClick=${() => report.open()} title="Report a problem, or send an idea">Report</button>
      <span>public alpha · v${info.version}</span>
    </div>
    ${checks && html`<${Checks} s=${s} byId=${byId} reveal=${reveal} close=${() => setChecks(false)} openRig=${() => { setChecks(false); setView('rig'); }} />`}
    ${pasteProps && html`<${PasteProps} clip=${pasteProps} label=${pasteProps.cue.name || pasteProps.cue.number || info.types[pasteProps.cue.type].label} typeLabel=${info.types[pasteProps.cue.type].label} count=${sel.length} last=${lastProps.current} close=${() => setPasteProps(null)}
      onPaste=${async (ks: string[]) => { lastProps.current = ks; setPasteProps(null); const r = await cmd({ op: 'clip-props', ids: sel, keys: ks }); if (r && !r.error) say(keys(`${ks.length} propert${ks.length === 1 ? 'y' : 'ies'} pasted onto ${r.count} cue${r.count === 1 ? '' : 's'} — ⌘Z undoes it`)); }} />`}
    ${runFrom && html`<${RunFrom} key=${runFrom.id} id=${runFrom.id} label=${runFrom.label} close=${() => setRunFrom(null)} say=${say} />`}
    ${editMode && s.added ? html`<${AddedChooser} s=${s} info=${info} byId=${byId} />` : null}
    ${notice && html`<div class=${cx('toast', toast && toast.bad && !hostLast && 'bad')}>${notice}</div>`}
    ${report.taken && html`<${ReportForm} key=${report.taken.capturedAt} taken=${report.taken} close=${report.close} />`}
    ${settings && html`<${Settings} s=${s} info=${info} section=${settings} setSection=${setSettings} close=${() => setSettings(null)} say=${say} review=${() => { setSettings(null); setDrawer('assistant'); }} refreshInfo=${() => ec.init().then((i) => { document.documentElement.dataset.theme = i.theme; setInfo(i); })} />`}
  </div>`;
}

render(html`<${App} />`, document.getElementById('root')!);
