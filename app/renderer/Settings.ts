// Settings: everything that is set once and left, kept out of the operator's way. The show's settings are
// part of the show file (and so are versioned and undoable); this computer's (the output device, the
// assistant's sign-in) are not.
import { html, useState, useEffect, useRef, ec, cmd, edit, cx, keys, KEY_ACTIONS, FIXED_KEYS, comboOf, keysOf, comboLabel } from './lib.js';
import { Qirx, qirxState } from './Qirx.js';
import { TextBox } from './Inspector.js';
import { OutputsSettings, EffectsSettings } from './Routing.js';
import { BusKinds, Ducking } from './Kinds.js';
import { LightPane } from './Lights.js';
import { TriggersPane, TimecodeCard } from './Triggers.js';
import { askForReport } from './Report.js';
import { useUpdate, UpdateLine } from './Update.js';
import type { State, Info, Reply, KeyOver } from './lib.js';
import type { ComponentChildren } from 'preact';
import type { Settings as ShowSettings, Bus, Patch, Destination, ShowCommands, Passcode, Modules } from '../../core/show/types';

type Say = (text: string, bad?: boolean) => void;
/** An event from a control, with the control it came from. */
type On<T extends EventTarget> = Event & { target: T };
/** What every pane is given (each takes what it needs of it). */
interface PaneProps { s: State; info: Info; say: Say; refreshInfo: () => unknown; review?: () => void; section: string; setSection: (section: string) => void }

const set = (path: string, value: unknown, label?: string) => edit([{ op: 'show.set', path, value }], label || path.split('.').pop());

function Row({ title, help, children }: { title: string; help?: string; children?: ComponentChildren }) {
  return html`<div class="setting"><div class="txt"><b>${title}</b>${help ? html`<span>${help}</span>` : null}</div><div class="ctl">${children}</div></div>`;
}
const Switch = ({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) => html`<button class=${cx('switch', on && 'on')} onClick=${() => onChange(!on)}></button>`;
const Num = ({ value, onCommit, unit, width = 80 }: { value: unknown; onCommit: (n: number) => void; unit?: string; width?: number }) => html`<div class="row-flex"><${TextBox} mono style=${`width:${width}px`} value=${value} onCommit=${(v: string) => { const n = Number(v); if (Number.isFinite(n)) onCommit(n); }} />${unit ? html`<span class="dim">${unit}</span>` : null}</div>`;

function ShowPane({ s, info }: { s: State; info: Info }) {
  const lists = s.doc.lists;
  return html`<h2>Show</h2><p class="lede">Saved in the show file.</p>
    <${Row} title="Title"><${TextBox} value=${s.doc.title} onCommit=${(v: string) => set('title', v || 'Untitled show')} /><//>
    <${Row} title="Notes"><${TextBox} area value=${s.doc.notes} onCommit=${(v: string) => set('notes', v)} /><//>
    <${Row} title="Show folder" help=${s.show.dir || 'Not saved yet. Versions and media need a folder.'}>
      ${s.show.dir ? html`<button class="btn" onClick=${() => ec.app({ op: 'reveal' })}>${info.platform === 'darwin' ? 'Show in Finder' : 'Show in folder'}</button>` : html`<button class="btn primary" onClick=${() => ec.app({ op: 'save-as' })}>Save the show…</button>`}<//>
    ${s.show.dir ? html`<${UnusedMedia} s=${s} info=${info} />` : null}
    <${Building} s=${s} info=${info} />
    <div class="setting" style="grid-template-columns:1fr"><div class="txt"><b>Cue lists</b><span>Choose one in the title bar. A cart is a grid of buttons.</span></div>
      <div class="tablelike" style="margin-top:8px">
        ${lists.map((l) => html`<div class="tr" style="grid-template-columns:1fr 190px 70px 80px 30px" key=${l.id} data-list=${l.name}>
          <${TextBox} value=${l.name} onCommit=${(v: string) => { if (v && v !== l.name) edit([{ op: 'list.rename', id: l.id, name: v }], 'rename list'); }} />
          <span class="row-flex">${l.cart ? html`<span class="dim">cart</span>
              <${Num} value=${l.cart.rows} width=${34} onCommit=${(v: number) => edit([{ op: 'list.cart', id: l.id, rows: Math.round(v), columns: l.cart!.columns }], 'cart size')} /><span class="dim">×</span>
              <${Num} value=${l.cart.columns} width=${34} onCommit=${(v: number) => edit([{ op: 'list.cart', id: l.id, rows: l.cart!.rows, columns: Math.round(v) }], 'cart size')} />
              <button class="btn ghost small" onClick=${() => edit([{ op: 'list.cart', id: l.id, rows: null }], 'cart to list')}>as a list</button>`
            : html`<button class="btn ghost small" title="Draw it as a grid of buttons" onClick=${() => edit([{ op: 'list.cart', id: l.id, rows: 4, columns: 4 }], 'list to cart')}>make it a cart</button>`}</span>
          <span class="dim">${l.cues.length} cue${l.cues.length === 1 ? '' : 's'}</span>
          ${s.engine.listName === l.name ? html`<span class="dim">${l.cart ? 'showing' : 'being run'}</span>` : l.cart ? html`<span class="dim" title="Choose it in the title bar">title bar</span>` : html`<button class="btn small" onClick=${() => cmd({ op: 'list', name: l.name })}>Show</button>`}
          <button class="btn ghost small icon" disabled=${lists.length <= 1} title=${l.cues.length ? keys(`Remove the list and its ${l.cues.length} cues (⌘Z undoes)`) : 'Remove the list'} onClick=${() => edit([{ op: 'list.remove', id: l.id }], 'remove list')}>×</button></div>`)}
        <div class="row-flex"><button class="btn small" onClick=${() => edit([{ op: 'list.add', name: '' }], 'add list')}>Add a list</button>
          <button class="btn small" title="A grid of buttons, up to 15 × 15. The playhead stays put." onClick=${() => { let n = 1, name: string; do { name = n === 1 ? 'Cart' : `Cart ${n}`; n++; } while (lists.some((x) => x.name === name)); edit([{ op: 'list.add', name, cart: { rows: 4, columns: 4 } }], 'add cart'); }}>Add a cart</button></div>
      </div></div>`;
}

/** How the list behaves while the show is built: numbering, the playhead and the selection, and the cue templates. */
function Building({ s, info }: { s: State; info: Info }) {
  const ed: Partial<ShowSettings['editing']> = s.doc.settings.editing || {}, tpls = Object.entries(s.doc.settings.templates || {}).filter(([t, v]) => info.types[t] && v && typeof v === 'object');
  const labelOf = (t: string, k: string) => ([...info.types[t].fields, ...info.common].find((f) => f.key === k) || { label: k }).label;
  return html`<${Row} title="Number new cues" help="The next number after the cue before, counting by the step.">
      <div class="row-flex"><${Switch} on=${ed.autoNumber !== false} onChange=${(on: boolean) => set('settings.editing.autoNumber', on, 'number new cues')} />
        ${ed.autoNumber !== false ? html`<span class="dim">counting by</span><${Num} value=${ed.numberStep ?? 1} width=${54} onCommit=${(v: number) => { if (v > 0) set('settings.editing.numberStep', v, 'numbering step'); }} />` : null}</div><//>
    <${Row} title="Lock the playhead to the selection" help="On: selecting a cue stands it by. Off: they move apart.">
      <${Switch} on=${ed.lockPlayhead !== false} onChange=${(on: boolean) => set('settings.editing.lockPlayhead', on, 'lock the playhead to the selection')} /><//>
    <${Row} title="Long sounds go on the Music bus" help="A sound of 30 s or more, added with no bus chosen.">
      <${Switch} on=${!!ed.longSoundsToMusic} onChange=${(on: boolean) => set('settings.editing.longSoundsToMusic', on, 'long sounds go on the Music bus')} /><//>
    <div class="setting" style="grid-template-columns:1fr"><div class="txt"><b>Cue templates</b><span>Make one with “Start like this one” in a cue’s inspector.</span></div>
      ${tpls.length ? html`<div class="tablelike" style="margin-top:8px">${tpls.map(([t, v]) => html`<div class="tr" style="grid-template-columns:110px 1fr 30px" key=${t}>
        <span>${info.types[t].glyph} ${info.types[t].label}</span>
        <span class="dim" style="white-space:normal">${Object.entries(v).map(([k, x]) => `${labelOf(t, k)}: ${typeof x === 'object' ? '…' : x}`).join(' · ') || 'nothing set'}</span>
        <button class="btn ghost small icon" title="Clear the template" onClick=${() => cmd({ op: 'template', type: t, clear: true })}>×</button></div>`)}</div>`
        : html`<div class="dim" style="margin-top:6px">None yet: new cues start plain.</div>`}</div>`;
}

/** Sounds left in the media folder that no cue plays any more (a file that was replaced): said, and cleared on request. */
function UnusedMedia({ s, info }: { s: State; info: Info }) {
  const [files, setFiles] = useState<{ bytes: number }[] | null>(null);
  const look = () => window.ec.cmd({ op: 'media-unused' }).then((r: Reply) => setFiles((r && r.files) || []));
  useEffect(() => { look(); }, [s.rev, s.show.dirty]);
  if (!files || !files.length) return null;
  const mb = files.reduce((n, f) => n + f.bytes, 0) / 1e6;
  const bin = info.platform === 'darwin' ? 'Trash' : 'Recycle Bin';
  return html`<${Row} title="Media no cue uses" help=${`${files.length} sound${files.length === 1 ? '' : 's'}, ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB. Older versions may still use them.`}>
    <button class="btn" onClick=${async () => { await window.ec.cmd({ op: 'media-clean' }); look(); }}>Move to the ${bin}</button><//>`;
}

function GoPane({ s }: { s: State }) {
  const g = s.doc.settings.go;
  return html`<h3 class="subhead">GO and safety</h3>
    <${Row} title="Double-GO protection" help="A second GO this soon is ignored. 0: off.">
      <${Num} value=${g.doubleGoProtection} unit="s" onCommit=${(v: number) => set('settings.go.doubleGoProtection', Math.max(0, v))} /><//>
    <${Row} title="Panic fade" help="Esc fades out over this. Esc again stops dead.">
      <${Num} value=${g.panicFade} unit="s" onCommit=${(v: number) => set('settings.go.panicFade', Math.max(0, v))} /><//>
    <${Row} title="Timed backups" help="Unsaved work too, in Versions ▸ Backups. 0: off.">
      <${Num} value=${(s.doc.settings.backup || {}).minutes ?? 5} unit="min" onCommit=${(v: number) => set('settings.backup.minutes', Math.max(0, Math.round(v)))} />
      <${Num} value=${(s.doc.settings.backup || {}).keep ?? 30} unit="kept" onCommit=${(v: number) => set('settings.backup.keep', Math.max(1, Math.round(v)))} /><//>
    <div class="setting" style="grid-template-columns:1fr"><div class="txt"><b>Hold back outputs</b><span>What is held back is not sent; the monitor shows it. This computer only.</span></div>
      <div class="row-flex" style="margin-top:8px">${(s.overrides || []).map((o) => html`<label class="row-flex" data-override=${o.id}><${Switch} on=${o.on} onChange=${(on: boolean) => cmd({ op: 'override', what: o.id, on })} /><span>${o.label}</span></label>`)}</div></div>
    <${Row} title="Light cues are stops" help="Off: GO skips Light cues. This computer only.">
      <${Switch} on=${!s.engine.skipLights} onChange=${(on: boolean) => cmd({ op: 'lights', on })} /><//>`;
}

/** A bus as the mixer has it: the show's, and whether this device has its outputs. */
type MixerBus = Bus & { noOutput?: boolean };

/** A few words under the engine's switch: what it is, and what is happening to it. */
function engineHelp(e: State['mixer']['engine']) {
  if (e.wanted === 'native' && e.failed) return `The native engine failed (${e.failed}). Web Audio plays until the app is opened again.`;
  if (e.pending) return `${e.pending === 'native' ? 'Native' : 'Web Audio'} takes over when nothing is playing.`;
  return 'Native plays from its own program, with lower latency; not yet proven on a show. A change waits until nothing is playing. This computer’s.';
}

function AudioPane({ s, info }: { s: State; info: Info }) {
  const a = s.doc.settings.audio, m = s.mixer;
  const buses = a.buses;
  const save = (next: Bus[], label: string) => set('settings.audio.buses', next, label);
  const addBus = () => { let n = buses.length + 1, id: string; do { id = `bus${n++}`; } while (buses.some((b) => b.id === id)); save([...buses, { id, name: `Bus ${buses.length + 1}`, db: 0, kind: 'effects' }], 'add bus'); };
  const pairs = (b: Bus) => { const n = Math.max(1, Math.floor(m.outputs / 2), Math.ceil(((b.out || 1) + 1) / 2)); return Array.from({ length: n }, (_, k) => 2 * k + 1); };
  const lost: MixerBus[] = m.buses.filter((b: MixerBus) => b.noOutput);
  const mon = m.monitor || { on: false, out: 3, db: -12 };
  return html`<h2>Audio</h2><p class="lede">Each Audio cue plays on a bus. The device is this computer’s.</p>
    <${Row} title="Output device" help=${m.deviceOk ? '' : 'That output could not be used.'}>
      <div><select value=${m.device} onChange=${(e: On<HTMLSelectElement>) => cmd({ op: 'device', id: e.target.value })}>${m.devices.map((d) => html`<option value=${d.id}>${d.label}</option>`)}</select>
        <div class="dim" style="font-size:11.5px;margin-top:4px">${m.outputs} output${m.outputs === 1 ? '' : 's'}${s.midi && s.midi.test ? ' · test run, no device open' : ''}</div></div><//>
    <${Row} title="Audio engine" help=${engineHelp(m.engine)}>
      <select data-audio-engine value=${m.engine.wanted} onChange=${(e: On<HTMLSelectElement>) => cmd({ op: 'audio-engine', engine: e.target.value })}>
        <option value="webaudio">Web Audio (default)</option><option value="native">Native (experimental)</option></select><//>
    ${m.fallback ? html`<div class="problem" style="margin-bottom:10px">${m.fallback.label} is gone. Playing on the default output until it returns.</div>` : null}
    ${lost.map((b) => html`<div class="problem" style="margin-bottom:10px">${b.name} goes to outputs ${b.out}–${b.out! + 1}; this device has ${m.outputs}. It is silent until it has them.</div>`)}
    <${Row} title="Safety limiter" help="Catches peaks above −0.3 dBFS at the end of the chain.">
      <${Switch} on=${a.limiter !== false} onChange=${(on: boolean) => set('settings.audio.limiter', on)} /><//>
    <${Row} title="Level limits" help="For cues and fades, not the faders. The minimum is silence.">
      <div class="row-flex" data-limits><span class="dim">min</span><${Num} value=${m.levels.min} unit="dB" width=${54} onCommit=${(v: number) => set('settings.audio.levels.min', Math.max(-60, Math.min(m.levels.max - 1, v)), 'minimum level')} />
        <span class="dim">max</span><${Num} value=${m.levels.max} unit="dB" width=${54} onCommit=${(v: number) => set('settings.audio.levels.max', Math.max(m.levels.min + 1, Math.min(24, v)), 'maximum level')} /></div><//>
    <${Row} title="Monitor feed" help=${mon.on && !mon.live ? `No output ${mon.out} on this device: the feed is off.` : 'Outputs 1–2 in mono, on one more output.'}>
      <div class="row-flex" data-monitor><${Switch} on=${!!mon.on} onChange=${(on: boolean) => set('settings.audio.monitor.on', on, 'monitor feed')} />
        ${mon.on ? html`<select value=${mon.out} onChange=${(e: On<HTMLSelectElement>) => set('settings.audio.monitor.out', Number(e.target.value), 'monitor output')}>${Array.from({ length: Math.max(m.outputs, mon.out) - 2 }, (_, k) => k + 3).map((o) => html`<option value=${o}>Output ${o}${o > m.outputs ? ' (not on this device)' : ''}</option>`)}${m.outputs < 3 && mon.out < 3 ? html`<option value=${mon.out}>Output 3</option>` : null}</select>
          <${Num} value=${mon.db} unit="dB" width=${54} onCommit=${(v: number) => set('settings.audio.monitor.db', Math.max(-60, Math.min(12, v)), 'monitor level')} />
          <div class="fader" style="width:70px;pointer-events:none" title="Monitor level"><div class="meter"><i style=${`width:${Math.max(0, Math.min(100, (mon.peak + 60) / 60 * 100))}%`}></i></div></div>` : null}</div><//>
    <div class="setting" style="grid-template-columns:1fr"><div class="txt"><b>Buses</b><span>A cue on a removed bus plays on the first bus.</span></div>
      <div class="tablelike" style="margin-top:8px">
        ${buses.map((b, i) => html`<div class="tr" style="grid-template-columns:1fr 90px 90px 150px 30px" key=${b.id}>
          <${TextBox} value=${b.name} onCommit=${(v: string) => save(buses.map((x, j) => (j === i ? { ...x, name: v || x.name } : x)), 'rename bus')} />
          <span class="dim mono">${b.id}</span>
          <${Num} value=${b.db} unit="dB" width=${54} onCommit=${(v: number) => save(buses.map((x, j) => (j === i ? { ...x, db: v } : x)), 'bus level')} />
          <select data-bus-out=${b.id} title="Its output pair" value=${b.out || 1} onChange=${(e: On<HTMLSelectElement>) => save(buses.map((x, j) => (j === i ? { ...x, out: Number(e.target.value) > 1 ? Number(e.target.value) : undefined } : x)), `${b.name} outputs`)}>
            ${pairs(b).map((o) => html`<option value=${o}>Outputs ${o}–${o + 1}${o + 1 > m.outputs ? ' (not on this device)' : ''}</option>`)}</select>
          <button class="btn ghost small icon" disabled=${buses.length <= 1} title="Remove this bus" onClick=${() => save(buses.filter((_, j) => j !== i), 'remove bus')}>×</button></div>`)}
        <div><button class="btn small" onClick=${addBus}>Add a bus</button></div>
      </div></div>
    <${BusKinds} s=${s} info=${info} />
    <${Row} title="Sort new sounds by kind" help="New sounds are listened to and put on a bus; you confirm.">
      <button class=${cx('switch', a.sortNew === true && 'on')} data-sort-new onClick=${() => set('settings.audio.sortNew', a.sortNew !== true, 'sort new sounds by kind')}></button><//>
    <${Ducking} s=${s} info=${info} />
    <${OutputsSettings} s=${s} />
    <${EffectsSettings} s=${s} />`;
}

/** The stage: the output window Video, Text and Camera cues are drawn in. Which display is this computer's; its size and corners are the show's. */
function VideoPane({ s }: { s: State }) {
  const st = s.stage || { displays: [], cameras: [] };
  const v: NonNullable<ShowSettings['video']> = (s.doc.settings.video) || {};
  const SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1]], NAMES = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
  const pin: number[][] = Array.isArray(v.pin) && v.pin.length === 4 ? v.pin : SQUARE;
  const setPin = (i: number, k: number, pct: number) => { const next = pin.map((c) => [...c]); next[i][k] = Math.round(pct * 10) / 1000; set('settings.video.pin', next.every((c, j) => c[0] === SQUARE[j][0] && c[1] === SQUARE[j][1]) ? undefined : next, 'corner pin'); };
  const chosen = st.open ? st.where : st.waiting ? st.waiting.display : st.chosen;
  const others = st.displays.filter((d) => !d.operator);
  const openOn = (display: string) => cmd({ op: 'stage-open', display });
  const state = st.test ? 'Test run: drawn offscreen.'
    : st.waiting ? `Waiting for ${st.waiting.label || 'its display'} to be connected.`
    : st.open ? `Open ${st.where === 'window' ? 'in a window' : `on ${st.label}`}.`
    : 'Closed: cues play their sound and show nothing.';
  return html`<h2>Video</h2><p class="lede">Where Video, Text and Camera cues are drawn.</p>
    <${Row} title="The stage" help=${state}>
      <div class="row-flex" style="flex-wrap:wrap">
        <select data-stage-display value=${chosen || 'window'} onChange=${(e: On<HTMLSelectElement>) => cmd({ op: 'stage-choose', display: e.target.value })}>
          <option value="window">In a window (on this screen)</option>
          ${others.map((d) => html`<option value=${d.id}>${d.label} — ${d.width} × ${d.height}</option>`)}
          ${st.waiting && !others.some((d) => d.id === st.waiting!.display) ? html`<option value=${st.waiting.display}>${st.waiting.label || 'The display chosen'} (not connected)</option>` : null}
        </select>
        ${st.open || st.waiting ? html`<button class="btn" data-stage-close onClick=${() => cmd({ op: 'stage-close' })}>Close the stage</button>` : html`<button class="btn primary" data-stage-open onClick=${() => openOn(chosen || 'window')}>Open the stage</button>`}
      </div><//>
    ${!st.test && !others.length ? html`<div class="dim" style="font-size:12px;margin:-4px 0 12px">No second display. “In a window” opens an ordinary window.</div>` : null}
    <${Row} title="Test pattern" help="For focus and the corner pin.">
      <${Switch} on=${!!st.pattern} onChange=${(on: boolean) => cmd({ op: 'stage-pattern', on })} /><//>
    <${Row} title="Blackout" help=${keys('The stage goes black; sound goes on (⇧⌘B).')}>
      <${Switch} on=${!!st.blackout} onChange=${(on: boolean) => cmd({ op: 'stage-blackout', on })} /><//>
    <${Row} title="Stage size" help="Cue positions are in these pixels, scaled to fit.">
      <div class="row-flex"><${Num} value=${st.width || 1920} width=${64} onCommit=${(n: number) => set('settings.video.width', Math.round(n), 'stage width')} /><span class="dim">×</span><${Num} value=${st.height || 1080} width=${64} onCommit=${(n: number) => set('settings.video.height', Math.round(n), 'stage height')} /><span class="dim">px</span></div><//>
    <div class="setting" style="grid-template-columns:1fr"><div class="txt"><b>Corner pin</b><span>With the test pattern on, move each corner to the screen’s.</span></div>
      <div class="tablelike" style="margin-top:8px">
        ${pin.map((c, i) => html`<div class="tr" style="grid-template-columns:120px 150px 150px" key=${i}>
          <span>${NAMES[i]}</span>
          <div class="row-flex"><span class="dim">across</span><${Num} value=${Math.round(c[0] * 1000) / 10} unit="%" width=${58} onCommit=${(n: number) => setPin(i, 0, n)} /></div>
          <div class="row-flex"><span class="dim">down</span><${Num} value=${Math.round(c[1] * 1000) / 10} unit="%" width=${58} onCommit=${(n: number) => setPin(i, 1, n)} /></div></div>`)}
        <div class="row-flex"><button class="btn small" disabled=${!v.pin} onClick=${() => set('settings.video.pin', undefined, 'corner pin')}>Square the corners</button>
          ${v.pin && !st.pin ? html`<span class="dim">Not used: these corners cross or line up.</span>` : null}</div>
      </div></div>`;
}

/** The monitor: every OSC and MIDI message in and out, as it happens, and a line to send one by hand. */
/** One message in or out, as the monitor lists it (the host's network hub). */
interface MonitorEntry { n: number; at: number; dir: 'in' | 'out'; who?: string; text: string; ok?: boolean; why?: string; label?: string; unused?: boolean }

export function Monitor({ s, tall }: { s: State; tall?: boolean }) {
  const [entries, setEntries] = useState<MonitorEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [dir, setDir] = useState('all');
  const [text, setText] = useState('');
  const [to, setTo] = useState('');
  const since = useRef(0), box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (paused) return undefined;
    let alive = true;
    const pull = async () => { const r: Reply = await window.ec.cmd({ op: 'net-monitor', since: since.current }); if (!alive || !r || !r.entries || !r.entries.length) return; since.current = r.entries[r.entries.length - 1].n; setEntries((old) => [...old, ...r.entries].slice(-300)); };
    pull(); const t = setInterval(pull, 400);
    return () => { alive = false; clearInterval(t); };
  }, [paused]);
  useEffect(() => { if (box.current && !paused) box.current.scrollTop = box.current.scrollHeight; }, [entries.length]);
  const patches = s.doc.settings.network.patches;
  const isMidi = text.trim() !== '' && !text.trim().startsWith('/');
  const send = () => { if (!text.trim()) return; if (isMidi) cmd({ op: 'midi-send', text: text.trim() }); else cmd({ op: 'net-send', patch: to || (patches[0] && patches[0].id) || null, text: text.trim() }); };
  const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour12: false }) + '.' + String(at % 1000).padStart(3, '0').slice(0, 2);
  const shown = entries.filter((e) => dir === 'all' || e.dir === dir);
  return html`<div class="monitor" style=${tall ? 'display:flex;flex-direction:column;flex:1;min-height:0' : ''}>
    <div class="row-flex" style="margin-bottom:6px"><b>Monitor</b><span class="grow"></span>
      <div class="seg">${['all', 'out', 'in'].map((d) => html`<button class=${cx(dir === d && 'on')} onClick=${() => setDir(d)}>${d === 'all' ? 'All' : d === 'out' ? 'Sent' : 'Received'}</button>`)}</div>
      <button class=${cx('btn small', paused && 'standby')} onClick=${() => setPaused(!paused)}>${paused ? 'Paused' : 'Pause'}</button>
      <button class="btn small" onClick=${() => { cmd({ op: 'net-clear' }); setEntries([]); }}>Clear</button></div>
    <div class="mon-list" style=${tall ? 'height:auto;flex:1;min-height:160px' : ''} ref=${box}>
      ${shown.length === 0 ? html`<div class="nothing" style="padding:18px">Nothing sent or received yet.</div>` : null}
      ${shown.map((e) => html`<div class=${cx('mon', e.dir, e.ok === false && 'bad', e.unused && 'unused')} key=${e.n} title=${e.unused ? 'No trigger or command matched it' : e.why || e.label || ''}>
        <span class="t">${time(e.at)}</span><span class="d">${e.dir === 'out' ? '→' : '←'}</span><span class="w">${e.who || '—'}</span><span class="m">${e.text}</span>${e.ok === false ? html`<span class="y">${e.why}</span>` : e.unused ? html`<span class="y">did nothing</span>` : null}</div>`)}
    </div>
    <div class="row-flex" style="margin-top:6px">
      <select style="width:150px" value=${to} onChange=${(e: On<HTMLSelectElement>) => setTo(e.target.value)} disabled=${!patches.length}>${patches.length ? patches.map((p) => html`<option value=${p.id}>${p.name}</option>`) : html`<option>no patches</option>`}</select>
      <input type="text" class="mono" placeholder="/address 1 2.5 word   · or note 60" value=${text} onInput=${(e: On<HTMLInputElement>) => setText(e.target.value)} onKeyDown=${(e: KeyboardEvent) => { if (e.key === 'Enter') send(); }} />
      <button class="btn" disabled=${!text.trim() || (!isMidi && !patches.length)} onClick=${send}>Send</button></div>
    <div class="dim" style="font-size:11.5px;margin-top:5px">1 is an integer, 1.0 a float. Force a type: <span class="mono">i:1</span> <span class="mono">f:1</span> <span class="mono">s:1</span></div>
  </div>`;
}

function NetworkPane({ s, info }: { s: State; info: Info }) {
  const n = s.doc.settings.network, patches = n.patches, net = s.network;
  const devices = info.devices, dev = (id: string) => devices.find((d) => d.id === id) || devices[0];
  const save = (next: Patch[], label: string) => set('settings.network.patches', next, label);
  const upd = (i: number, change: Partial<Patch>) => save(patches.map((x, j) => (j === i ? { ...x, ...change } : x)), 'network patch');
  const add = (deviceId: string) => {
    const d = dev(deviceId);
    let k = patches.length + 1, id: string; do { id = `patch${k++}`; } while (patches.some((p) => p.id === id));
    save([...patches, { id, name: d.id === 'generic' ? `Patch ${patches.length + 1}` : d.label.split(' (')[0], host: '', port: d.port, protocol: d.protocol as Patch['protocol'], device: d.id }], 'add patch');
  };
  const why = [s.modules.some((m) => m.id === 'osc-control' && m.enabled) && 'OSC control is on', net.triggers > 0 && `${net.triggers} cue trigger${net.triggers === 1 ? '' : 's'}`, Object.values(n.commands || {}).some((t) => String(t || '').trim().startsWith('/')) && 'a message is set to a show command', n.listen && 'set to always listen'].filter(Boolean);
  return html`<h2>Network</h2><p class="lede">OSC and MIDI. A patch is one piece of equipment, named once.</p>

    <p class="lede" style="margin-bottom:10px">Devices with named commands are in the Rig.</p>
    <div class="card">
      <div class="ch"><b>Patches</b><span class="st">${patches.length || 'none'}</span></div>
      ${patches.length === 0 ? html`<p>Choosing a kind fills in its port and commands.</p>` : null}
      ${patches.map((p, i) => { const st = net.patches[p.id] || { state: 'idle', text: '' }; const d = dev(p.device || 'generic'); return html`<div class="patch" key=${p.id}>
        <div class="row-flex">
          <span class=${cx('dot', st.state === 'answering' || st.state === 'connected' ? 'go' : st.state === 'error' ? 'danger' : st.state === 'connecting' ? 'standby' : '')} title=${st.text}></span>
          <${TextBox} style="width:170px;font-weight:600" value=${p.name} onCommit=${(v: string) => upd(i, { name: v || p.name })} />
          <select style="width:210px" value=${p.device || 'generic'} onChange=${(e: On<HTMLSelectElement>) => upd(i, { device: e.target.value })}>${devices.map((x) => html`<option value=${x.id}>${x.label}</option>`)}</select>
          <span class="grow dim" style="font-size:11.5px;text-align:right">${st.text}</span>
          <button class="btn small" disabled=${!p.host} title=${d.test ? `Sends ${d.test}${d.answers ? ' and listens for the answer' : ''}` : 'Sends /ping'} onClick=${() => cmd({ op: 'net-test', patch: p.id })}>Test</button>
          <button class="btn ghost small icon" title="Remove this patch" onClick=${() => save(patches.filter((_, j) => j !== i), 'remove patch')}>×</button>
        </div>
        <div class="pgrid">
          <div><label>Address</label><${TextBox} mono value=${p.host} placeholder="10.0.0.20" onCommit=${(v: string) => upd(i, { host: v.trim() })} /></div>
          <div><label>Port</label><${TextBox} mono value=${p.port} onCommit=${(v: string) => { const x = Number(v); if (x > 0 && x < 65536) upd(i, { port: x }); }} /></div>
          <div><label>Protocol</label><div class="seg">${(['udp', 'tcp'] as const).map((x) => html`<button class=${cx((p.protocol || 'udp') === x && 'on')} onClick=${() => upd(i, { protocol: x })}>${x.toUpperCase()}</button>`)}</div></div>
          ${p.protocol === 'tcp' ? html`<div title="SLIP is OSC 1.1; Length is OSC 1.0"><label>Framing</label><div class="seg">${([['slip', 'SLIP'], ['length', 'Length']] as const).map(([x, l]) => html`<button class=${cx((p.framing || 'slip') === x && 'on')} onClick=${() => upd(i, { framing: x })}>${l}</button>`)}</div></div>`
            : html`<div title="For equipment that replies to a fixed port"><label>Answers on port</label><${TextBox} mono value=${p.listenPort || ''} placeholder="optional" onCommit=${(v: string) => upd(i, { listenPort: Number(v) > 0 ? Number(v) : undefined })} /></div>`}
        </div>
        ${(p.destinations || []).map((d, k) => { const updD = (change: Partial<Destination>) => upd(i, { destinations: p.destinations!.map((x, j) => (j === k ? { ...x, ...change } : x)) }); return html`<div class="pgrid" key=${k} data-destination=${k}>
          <div><label>Also to</label><${TextBox} mono value=${d.host || ''} placeholder="10.0.0.21" onCommit=${(v: string) => updD({ host: v.trim() })} /></div>
          <div><label>Port</label><${TextBox} mono value=${d.port || p.port} onCommit=${(v: string) => { const x = Number(v); if (x > 0 && x < 65536) updD({ port: x }); }} /></div>
          <div><label>Protocol</label><div class="seg">${(['udp', 'tcp'] as const).map((x) => html`<button class=${cx((d.protocol || p.protocol || 'udp') === x && 'on')} onClick=${() => updD({ protocol: x })}>${x.toUpperCase()}</button>`)}</div></div>
          <div><label> </label><button class="btn ghost small" onClick=${() => { const rest = p.destinations!.filter((_, j) => j !== k); upd(i, { destinations: rest.length ? rest : undefined }); }}>Remove</button></div>
        </div>`; })}
        <div class="row-flex" style="margin-top:8px;gap:12px">
          <button class="btn ghost small" data-add-destination title="Send the same messages to another address too" onClick=${() => upd(i, { destinations: [...(p.destinations || []), { host: '', port: p.port }] })}>Add a destination</button>
          <span class="grow"></span>
          <label style="margin:0" title="The network this patch’s messages use">Leaves by</label>
          <select style="width:200px" data-iface value=${p.iface || ''} onChange=${(e: On<HTMLSelectElement>) => upd(i, { iface: e.target.value || undefined })}>
            <option value="">Automatic</option>${p.iface && !(net.interfaces || []).some((x) => x.name === p.iface) ? html`<option value=${p.iface}>${p.iface} (not on this computer now)</option>` : null}${(net.interfaces || []).map((x) => html`<option value=${x.name}>${x.name} · ${x.address}</option>`)}</select>
        </div>
        ${st.lastOut || st.lastIn ? html`<div class="plast mono">${st.lastOut ? html`<div>→ ${st.lastOut}</div>` : null}${st.lastIn ? html`<div>← ${st.lastIn}</div>` : null}</div>` : null}
        ${d.notes ? html`<p class="pnote">${d.notes}</p>` : null}
      </div>`; })}
      <div class="row-flex" style="margin-top:10px"><select style="width:260px" value="" onChange=${(e: On<HTMLSelectElement>) => { if (e.target.value) add(e.target.value); e.target.value = ''; }}>
        <option value="">Add a patch…</option>${devices.map((x) => html`<option value=${x.id}>${x.label}</option>`)}</select></div>
    </div>

    <div class="card">
      <div class="ch"><b>Incoming OSC</b><span class="st"><span class=${cx('dot', net.input.error ? 'danger' : net.input.listening ? 'go' : '')}></span>${net.input.error || (net.input.listening ? `listening on UDP${net.input.tcp ? ' and TCP' : ''} ${net.input.port}${net.input.tcpError ? ` (${net.input.tcpError})` : ''}${net.input.connections ? ` · ${net.input.connections} connected` : ''}` : 'not listening')}</span></div>
      <p>For remote control, cue triggers and show commands. ${why.length ? `Listening because ${why.join(' and ')}.` : 'Opens when something needs it.'}</p>
      <div class="cfg">
        <div><label>Port</label><${TextBox} mono value=${n.inputPort} onCommit=${(v: string) => { const x = Number(v); if (x > 0 && x < 65536) set('settings.network.inputPort', x); }} /></div>
        <div><label>Always listen</label><${Switch} on=${!!n.listen} onChange=${(on: boolean) => set('settings.network.listen', on)} /></div>
      </div>
      <p style="margin-top:14px">Any message can run the show: type it, or Capture it.</p>
      <div class="cfg">${OSC_COMMANDS.map(([k, label]) => html`<${OscCommand} key=${k} k=${k} label=${label} s=${s} />`)}</div>
    </div>

    <${MidiCard} s=${s} />
    <${TimecodeCard} s=${s} />

    <${Monitor} s=${s} />`;
}

// the show commands an OSC message can be set to: the same ones, in the same order, as MIDI's below
const OSC_COMMANDS: [keyof ShowCommands, string][] = [['go', 'GO on'], ['panic', 'Panic on'], ['pause', 'Pause all on'], ['resume', 'Resume all on'], ['next', 'Playhead down on'], ['previous', 'Playhead up on']];
/** One show command's OSC message: typed, or captured from the next message to arrive (which is then not acted on). */
function OscCommand({ k, label, s }: { k: keyof ShowCommands; label: string; s: State }) {
  const [waiting, setWaiting] = useState(false);
  const value = ((s.doc.settings.network.commands || {} as Partial<ShowCommands>)[k]) || '';
  const save = (v: string) => set(`settings.network.commands.${k}`, v.trim(), `OSC ${k}`);
  const capture = async () => {
    if (waiting) { cmd({ op: 'osc-learn-cancel' }); return; }
    setWaiting(true);
    const r: Reply = await window.ec.cmd({ op: 'osc-learn' });
    setWaiting(false);
    if (r && r.learned) save(r.learned.text || r.learned.address);
  };
  return html`<div data-osc-command=${k}><label>${label}</label>
    <div class="row-flex" style="gap:6px"><${TextBox} mono value=${value} placeholder="none" onCommit=${save} />
      <button class=${cx('btn small', waiting && 'standby')} onClick=${capture} title=${waiting ? 'Cancel' : `Then send it to port ${s.network.inputPort}`}>${waiting ? `Waiting on ${s.network.inputPort}…` : 'Capture'}</button></div></div>`;
}

/** OSC control's "who may do what": a row for senders with no passcode, and a row for each passcode. */
/** What a sender may do: read the show, change it, run it. */
type Access = { view?: boolean; edit?: boolean; control?: boolean };

function OscAccess({ cfg }: { cfg: Partial<Modules['osc-control']> }) {
  const codes: Passcode[] = Array.isArray(cfg.passcodes) ? cfg.passcodes : [];
  // (as the module reads it: with no passcode at all everyone may view and run the show; once there is one, a sender without it may do
  // nothing unless this row says so. Editing always takes a passcode.)
  const none: Access = { ...(cfg.noPasscode && typeof cfg.noPasscode === 'object' ? cfg.noPasscode : codes.length ? {} : { view: true, control: true }), edit: false };
  // (one edit, so one undo step and one restart of the module)
  const save = (nextCodes: Passcode[], nextNone: Access) => edit([{ op: 'show.set', path: 'modules.osc-control.passcodes', value: nextCodes },
    { op: 'show.set', path: 'modules.osc-control.noPasscode', value: { view: !!nextNone.view, edit: false, control: !!nextNone.control } }], 'OSC access');
  const fresh = () => { let c: string; do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (codes.some((x) => x.code === c)); return c; };
  // (`open`: the no-passcode row, which can never edit)
  const boxes = <R extends Access>(row: R, change: (row: R) => void, open = false) => (['view', 'edit', 'control'] as const).map((l) => { const off = open && l === 'edit'; return html`<label class="row-flex" style="gap:5px;margin:0" title=${off ? 'Changing the show takes a passcode' : { view: 'Read the show', edit: 'Change the show', control: 'Run the show: GO, stop, the playhead' }[l]}><input type="checkbox" style="accent-color:var(--accent)" data-level=${l} disabled=${off} checked=${!!row[l] && !off} onChange=${(e: On<HTMLInputElement>) => change({ ...row, [l]: e.target.checked })} />${l}</label>`; });
  return html`<div class="tablelike" data-osc-access>
    <div class="tr" style="grid-template-columns:150px 1fr 30px" data-access-row="none"><span>No passcode</span><div class="row-flex" style="gap:14px">${boxes(none, (r) => save(codes, r), true)}</div><span></span></div>
    ${codes.map((c, i) => html`<div class="tr" style="grid-template-columns:150px 1fr 30px" key=${i} data-access-row=${i}>
      <${TextBox} mono value=${c.code} onCommit=${(v: string) => { if (v.trim()) save(codes.map((x, j) => (j === i ? { ...x, code: v.trim() } : x)), none); }} />
      <div class="row-flex" style="gap:14px">${boxes(c, (r) => save(codes.map((x, j) => (j === i ? r : x)), none))}</div>
      <button class="btn ghost small icon" title="Remove this passcode" onClick=${() => save(codes.filter((_, j) => j !== i), none)}>×</button></div>`)}
    <div><button class="btn small" data-add-passcode title="A new four-digit code; untick what it may not do" onClick=${() => save([...codes, { code: fresh(), view: true, edit: true, control: true }], codes.length ? none : {})}>Add a passcode</button></div>
  </div>`;
}

/** MIDI: which output MIDI cues go to, what is connected, and show control coming in. */
function MidiCard({ s }: { s: State }) {
  const cfg: Partial<ShowSettings['midi']> = s.doc.settings.midi || {}, md = s.midi || { inputs: [], outputs: [] };
  const gone = cfg.output && !md.outputs.includes(cfg.output);
  return html`<div class="card">
    <div class="ch"><b>MIDI</b><span class="st"><span class=${cx('dot', md.error || gone ? 'danger' : md.outputs.length || md.inputs.length ? 'go' : '')}></span>${md.test ? 'test run: not sent' : md.error || `${md.outputs.length} output${md.outputs.length === 1 ? '' : 's'}, ${md.inputs.length} input${md.inputs.length === 1 ? '' : 's'}`}</span></div>
    ${md.triggers || md.inputs.length ? html`<p>${md.triggers ? `${md.triggers} MIDI trigger${md.triggers === 1 ? '' : 's'} set. ` : ''}${md.inputs.length ? `Listening to ${md.inputs.join(', ')}.` : ''}</p>` : null}
    <div class="cfg">
      <div><label>Send to</label><select data-midi-out value=${cfg.output || ''} onChange=${(e: On<HTMLSelectElement>) => set('settings.midi.output', e.target.value, 'MIDI output')}>
        <option value="">Every MIDI output</option>${gone ? html`<option value=${cfg.output}>${cfg.output} (not connected)</option>` : null}${md.outputs.map((o) => html`<option value=${o}>${o}</option>`)}</select></div>
      <div title="MIDI Show Control in: GO, STOP, RESUME, ALL OFF, RESET"><label>Obey show control</label><${Switch} on=${!!cfg.mscIn} onChange=${(on: boolean) => set('settings.midi.mscIn', on, 'MIDI show control')} /></div>
      ${(['go', 'panic', 'pause', 'resume', 'next', 'previous'] as const).map((k) => html`<div title="Written as a trigger: note 36, cc 64 127"><label>${{ go: 'GO on', panic: 'Panic on', pause: 'Pause all on', resume: 'Resume all on', next: 'Playhead down on', previous: 'Playhead up on' }[k]}</label><${TextBox} mono value=${(cfg.commands || {} as Partial<ShowCommands>)[k] || ''} placeholder="none" onCommit=${(v: string) => set(`settings.midi.commands.${k}`, v.trim(), `MIDI ${k}`)} /></div>`)}
      ${cfg.mscIn ? html`<div title="Obeys this ID and 127, all devices"><label>Device ID</label><${TextBox} mono value=${cfg.deviceId ?? 1} onCommit=${(v: string) => { const x = Number(v); if (x >= 0 && x <= 126) set('settings.midi.deviceId', x, 'MIDI device ID'); }} /></div>` : null}
    </div>
  </div>`;
}

const COMING = [
  ['Motion capture', 'Tracked performers driving visuals.'],
];

/** A setting of a module, as its definition gives it (app/main/modules). */
interface ModuleField { key: string; label: string; kind: string; help?: string; options?: readonly string[]; labels?: Record<string, string>; placeholder?: string }

function ModulesPane({ s }: { s: State }) {
  return html`<h2>Modules</h2><p class="lede">Each is off until you turn it on. Saved with the show.</p>
    ${s.modules.map((m) => {
      const cfg: Record<string, unknown> = s.doc.modules[m.id as keyof Modules] || {};
      const up = (key: string, value: unknown) => set(`modules.${m.id}.${key}`, value, m.name);
      return html`<div class="card" key=${m.id}>
        <div class="ch"><${Switch} on=${m.enabled} onChange=${(on: boolean) => up('enabled', on)} /><b>${m.name}</b>
          ${m.enabled ? html`<span class="st"><span class=${cx('dot', m.status ? (m.status.ok ? 'go' : 'danger') : '')}></span>${m.status ? m.status.text : m.running ? '' : 'not running in a test run'}</span>` : null}</div>
        <p>${m.summary}</p>
        ${m.enabled && m.details ? html`<p class="dim">${m.details}</p>` : null}
        ${m.enabled && m.id === 'lighting-desk' && !cfg.host ? html`<p class="dim">No address: the desk’s Network patch is used.</p>` : null}
        ${m.enabled ? html`<div class="cfg">${m.fields.map((f: ModuleField) => html`<div key=${f.key} title=${f.help || ''} style=${f.kind === 'osc-access' ? 'grid-column:1 / -1' : ''}><label>${f.label}</label>
          ${f.kind === 'osc-access' ? html`<${OscAccess} cfg=${cfg} />`
            : f.kind === 'bool' ? html`<${Switch} on=${cfg[f.key] !== false} onChange=${(on: boolean) => up(f.key, on)} />`
            : f.kind === 'enum' ? html`<select value=${cfg[f.key]} onChange=${(e: On<HTMLSelectElement>) => up(f.key, e.target.value)}>${f.options!.map((o) => html`<option value=${o}>${(f.labels && f.labels[o]) || o}</option>`)}</select>`
            : f.kind === 'patch' ? html`<select value=${cfg[f.key] || ''} onChange=${(e: On<HTMLSelectElement>) => up(f.key, e.target.value)}><option value="">— choose a patch —</option>${s.doc.settings.network.patches.map((p) => html`<option value=${p.id}>${p.name}</option>`)}</select>`
            : html`<${TextBox} mono value=${cfg[f.key] ?? ''} placeholder=${f.placeholder || ''} onCommit=${(v: string) => up(f.key, f.kind === 'number' ? Number(v) || 0 : v)} />`}</div>`)}</div>` : null}
        ${m.enabled && m.status && m.status.urls ? html`<div class="urls">${m.status.urls.map((u: string) => html`<div>${u}</div>`)}</div><p>Open it on a phone on the same network.</p>` : null}
        ${m.enabled && m.status && m.status.setup ? html`<p>${m.status.setup}</p>` : null}
      </div>`;
    })}
    <p class="lede" style="margin-top:22px">Planned</p>
    ${COMING.map(([name, text]) => html`<div class="card soon"><div class="ch"><b>${name}</b><span class="st">planned</span></div><p>${text}</p></div>`)}`;
}

const MODEL_HINT: Record<string, string> = { openrouter: 'vendor/model-name', ollama: 'llama3.1' };

const dayWords = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`; };

/** The Endless Cues assistant's rows: sign in (a code, the browser), who is signed in, this month's asks. */
function CloudRows({ s, refreshInfo }: { s: State; refreshInfo: () => unknown }) {
  const st = s.assistant || {};
  const c: Partial<NonNullable<typeof st.cloud>> = st.cloud || {};
  const signedIn = !!st.signedIn;
  useEffect(() => { if (signedIn) ec.app({ op: 'cloud-usage' }); }, [signedIn]);
  const u = c.usage;
  const signOut = async () => { await ec.app({ op: 'cloud-sign-out' }); await refreshInfo(); cmd({ op: 'state' }); };
  if (signedIn) {
    return html`<${Row} title="Signed in"><span data-cloud-email>${c.email || 'on this computer'}</span><button class="btn ghost small" data-cloud-signout onClick=${signOut}>Sign out</button><//>
      ${u && u.of ? html`<${Row} title="This month"><span class="dim" data-cloud-usage>${u.asks} of ${u.of} asks${u.tier === 'after' ? ' · smaller model now' : u.tier === 'used_up' ? ` · back on ${dayWords(u.resets || '')}` : ''}</span><//>` : null}`;
  }
  if (c.code) {
    return html`<${Row} title="Your code" help="Confirm it in the browser."><span class="mono" data-cloud-code style="font-size:18px;letter-spacing:2px">${c.code}</span>
      <button class="btn ghost small" onClick=${() => ec.app({ op: 'cloud-cancel' })}>Cancel</button><//>`;
  }
  return html`<${Row} title="Account" help=${c.error || 'Free during the beta.'}>
    <button class="btn" data-cloud-signin disabled=${c.step === 'starting'} onClick=${() => ec.app({ op: 'cloud-sign-in' })}>${c.step === 'starting' ? 'Signing in…' : 'Sign in'}</button><//>`;
}

function AssistantPane({ s, info, refreshInfo, say, review }: { s: State; info: Info; refreshInfo: () => unknown; say: Say; review?: () => void }) {
  const a = info.assistant;
  const provider = a.provider || 'off';
  const [key, setKey] = useState('');
  const apply = async (config: Record<string, unknown>) => { await ec.app({ op: 'assistant-config', config }); await refreshInfo(); cmd({ op: 'state' }); };
  const compat = (a.providers || {})[provider];
  const status = s.assistant;
  const keyRow = (label: string, field: string, help: string) => html`<${Row} title=${label} help=${help}>
      <input type="password" placeholder=${(field === 'token' ? a.signedIn : a.hasKey) ? '•••••••• (saved on this computer)' : a.envKey ? 'using the environment’s key' : 'paste it here'} value=${key} onInput=${(e: On<HTMLInputElement>) => setKey(e.target.value)}
        onKeyDown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && key.trim()) { apply({ [field]: key.trim() }); setKey(''); say('Saved on this computer'); } }} />
      <button class="btn" disabled=${!key.trim()} onClick=${async () => { await apply({ [field]: key.trim() }); setKey(''); say('Saved on this computer'); }}>Save</button>
      ${(field === 'token' ? a.signedIn : a.hasKey) ? html`<button class="btn ghost small" title="Forget it" onClick=${() => apply({ [field]: '' })}>Forget</button>` : null}<//>`;
  return html`<div class="qtitle"><${Qirx} size=${30} state=${qirxState(s).state} /><h2>Assistant</h2></div><p class="lede">Describe a change, then review it. It cannot play or save the show.</p>
    <${Row} title="Who answers" help="Off: nothing is sent anywhere.">
      <select value=${provider} onChange=${(e: On<HTMLSelectElement>) => { setKey(''); apply({ provider: e.target.value }); }}>
        <option value="off">Off</option>
        <option value="cloud">Endless Cues assistant</option>
        <optgroup label="Your own key">
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openrouter">OpenRouter</option>
          <option value="openai">OpenAI</option>
          <option value="custom">Other, OpenAI-compatible</option>
        </optgroup>
        <optgroup label="An agent you already have">
          <option value="claude-code">Claude Code${a.installed && !a.installed['claude-code'] ? ' (not found)' : ''}</option>
          <option value="codex">Codex${a.installed && !a.installed.codex ? ' (not found)' : ''}</option>
        </optgroup>
        <optgroup label="No internet">
          <option value="ollama">Ollama</option>
          <option value="demo">Built-in helper</option>
        </optgroup>
      </select><//>
    ${provider === 'cloud' ? html`<${CloudRows} s=${s} refreshInfo=${refreshInfo} />` : null}
    ${provider === 'anthropic' ? keyRow('Anthropic API key', 'apiKey', 'Or set ANTHROPIC_API_KEY in the environment.') : null}
    ${compat && compat.needsKey ? keyRow(`${compat.label} key`, 'apiKey', `Or set ${compat.env} in the environment.`) : null}
    ${provider === 'custom' ? html`<${Row} title="Address"><${TextBox} mono value=${a.baseURL} placeholder="https://host/v1" onCommit=${(v: string) => apply({ baseURL: v })} /><//>
      ${keyRow('Key, if it needs one', 'apiKey', 'Sent as a bearer token.')}` : null}
    ${provider === 'ollama' ? html`<${Row} title="Address" help="Empty: this computer."><${TextBox} mono value=${a.baseURL} placeholder=${compat.baseURL} onCommit=${(v: string) => apply({ baseURL: v })} /><//>` : null}
    ${compat ? html`<${Row} title="Model" help="It must be able to call tools."><${TextBox} mono value=${a.model} placeholder=${MODEL_HINT[provider] || 'model id'} onCommit=${(v: string) => apply({ model: v })} /><//>` : null}
    ${provider === 'claude-code' || provider === 'codex' ? html`<${Row} title=${provider === 'codex' ? 'Codex' : 'Claude Code'} help=${`${a.installed && a.installed[provider] ? 'Uses its own sign-in.' : 'Not found: install it and sign in first.'} ${provider === 'codex' ? 'It can also read files on this computer and run commands that only read: Codex has no way to turn that off. It cannot change files.' : 'It gets this app’s tools only: no files, no commands.'}`}><span class="dim">${a.installed && a.installed[provider] ? 'found' : 'not found'}</span><//>` : null}
    ${provider === 'demo' ? html`<${Row} title="Built-in helper" help="No model, nothing sent. Ask it what it can do."><span class="dim">ready</span><//>` : null}
    ${provider !== 'off' && provider !== 'cloud' ? html`<${Row} title="Status" help=${status.available ? '' : status.missing || ''}><span class=${cx('dot', status.available ? 'go' : 'standby')}></span><span class="dim">${status.available ? `ready${status.model ? ` · ${status.model}` : ''}` : 'not ready'}</span><//>` : null}
    ${provider !== 'off' ? html`<${Row} title="Apply changes at once" help="Off: you review each change first. Either way: one undo step, not kept until you save, never in Show mode."><${Switch} on=${!!a.autoApply} onChange=${(on: boolean) => apply({ autoApply: on })} /><//>` : null}
    <${Row} title="Let coding agents work on the show" help="MCP clients get the assistant’s tools; you review. This computer only."><${Switch} on=${!!a.agents} onChange=${(on: boolean) => apply({ agents: on })} /><//>
    ${a.agents ? html`<div class="card"><div class="ch"><b>Connect an agent</b><span class="st"><span class=${cx('dot', a.bridge ? 'go' : 'danger')}></span>${a.bridge ? 'ready' : 'not open'}</span></div>
      <p>Claude Code, once, in a terminal:</p><pre class="mono snippet">${a.mcpLines ? a.mcpLines.claude : `claude mcp add endless-cues -- ${a.mcpCommand}`}</pre>
      <p>Codex, in ~/.codex/config.toml:</p><pre class="mono snippet">${a.mcpLines ? a.mcpLines.codex : `[mcp_servers.endless_cues]\ncommand = "node"\nargs = [${a.mcpCommand!.replace(/^node /, '')}]`}</pre>
      <p>Add <span class="mono">--show path/to/My.ecshow</span> to work without the app.</p></div>` : null}
    <${Row} title="Write the guide for coding agents" help="AGENTS.md and CLAUDE.md in the show folder. You review them first.">
      <button class="btn" data-agent-guide disabled=${s.mode === 'show'} onClick=${async () => { let r: Reply; try { r = await ec.cmd({ op: 'agent-guide' }); } catch (err) { r = { error: String((err as Error).message || err) }; } if (!r || r.error) say(/cannot find module/i.test(String(r && r.error)) ? 'Not in this build yet.' : (r && r.error) || 'The app did not answer', true); else { say('The guide is ready to review: nothing is written until you accept'); if (review) review(); } }}>Write the guide…</button><//>
    <${Row} title="Show the QIRX" help="The eye in the side panel.">
      <span data-qirx-switch><${Switch} on=${(info.view || {}).qirx !== false} onChange=${async (on: boolean) => { await ec.app({ op: 'view', view: { qirx: on } }); refreshInfo(); }} /></span><//>
    <${Row} title="What is sent" help="Only when you ask: your message; the show’s outline (cues, settings, file names, each device’s name, address and commands); what it reads to answer (the show folder’s file names, a file you ask it to read, the Rig, the monitor). Never audio, a password or anything outside the show folder. Ollama and the built-in helper send nothing off this computer."><span></span><//>
    <p class="lede" style="margin-top:14px">Small local models often cannot call tools reliably.</p>`;
}

/** The keys: every single key the show answers to can be changed here, kept on this computer; the ⌘ shortcuts are the menus'. */
/** The key being set: one already there (`at`), or one more (`add`). */
type Asking = { id: string; at: number; add?: undefined } | { id: string; add: true; at?: undefined };

function KeysPane({ info, refreshInfo, say }: { info: Info; refreshInfo: () => unknown; say: Say }) {
  const over: KeyOver = info.keys || {};
  const [asking, setAsking] = useState<Asking | null>(null);            // { id, at } | { id, add: true }: waiting for the new key
  const save = async (next: KeyOver) => { await ec.app({ op: 'keys', keys: next }); await refreshInfo(); };
  const all = KEY_ACTIONS.flatMap(([, l]) => l);
  const labelOf = (id: string) => (all.find((x) => x[0] === id) || [])[1];
  const changed = (id: string) => Array.isArray(over[id]);
  useEffect(() => {
    if (!asking) return undefined;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopImmediatePropagation();
      if (['Shift', 'Alt', 'Meta', 'Control', 'CapsLock'].includes(e.key)) return;
      if (e.key === 'Escape' && asking.id !== 'panic') { setAsking(null); return; }
      const c = comboOf(e);
      if (!c) { say('⌘ and Ctrl shortcuts belong to the menus: choose a key without them', true); return; }
      const next = { ...over };
      // the key leaves whatever had it
      const had = all.find(([id]) => id !== asking.id && keysOf(id, over).includes(c));
      if (had) next[had[0]] = keysOf(had[0], over).filter((x) => x !== c);
      const mine = keysOf(asking.id, over).slice();
      if (asking.add) { if (!mine.includes(c)) mine.push(c); } else mine[asking.at] = c;
      next[asking.id] = [...new Set(mine)];
      setAsking(null);
      save(next).then(() => { if (had) say(`${comboLabel(c)} is now ${labelOf(asking.id)}; ${had[1]} ${next[had[0]]!.length ? 'keeps its other key' : 'has no key now'}`); });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [asking, info.keys]);
  const reset = (id: string) => { const next = { ...over }; delete next[id]; save(next); };
  const count = Object.keys(over).length;
  return html`<h2>Keys</h2>
    <p class="lede">Click a key, then press the new one. Kept on this computer.</p>
    <div class="keybar"><span class="dim">${count ? `${count} changed` : 'No keys changed'}</span><span class="grow"></span>
      <button class="btn" disabled=${!count} onClick=${() => { setAsking(null); save({}).then(() => say('Every key is back to its default')); }}>Reset all to defaults</button></div>
    ${KEY_ACTIONS.map(([group, list]) => html`<h3 class="keygroup">${group}</h3>
      <div class="keytable">${list.map(([id, label]) => { const mine = keysOf(id, over); return html`<div class=${cx('keyrow', changed(id) && 'changed')} key=${id}>
        <span class="what">${label}</span>
        <span class="caps">
          ${mine.map((c, at) => html`<button class=${cx('keycap', asking && asking.id === id && asking.at === at && 'asking')} title="Click, then press a key. Esc cancels" onClick=${() => setAsking({ id, at })}>${asking && asking.id === id && asking.at === at ? 'press a key…' : comboLabel(c)}</button>`)}
          ${asking && asking.id === id && asking.add ? html`<button class="keycap asking">press a key…</button>` : html`<button class="keycap add" title=${mine.length ? 'Add another key' : 'Add a key'} onClick=${() => setAsking({ id, add: true })}>${mine.length ? '+' : 'no key · set one'}</button>`}
          ${mine.length > 1 ? html`<button class="keycap add" title="Remove its last key" onClick=${() => save({ ...over, [id]: mine.slice(0, -1) })}>−</button>` : null}
          <button class="keycap reset" style=${changed(id) ? '' : 'visibility:hidden'} title="Back to the default" onClick=${() => reset(id)}>↺</button>
        </span></div>`; })}</div>`)}
    <h3 class="keygroup">In the menus <span class="dim" style="font-weight:400">· fixed</span></h3>
    <div class="keytable fixed">${FIXED_KEYS.map(([label, key]) => html`<div class="keyrow"><span class="what">${label}</span><span class="caps">${keys(key).split(/\s{2,}/).map((k) => html`<span class="keycap still">${k}</span>`)}</span></div>`)}
      <div class="keyrow"><span class="what">A cue’s hotkey, on its Triggers tab</span><span class="caps"><span class="keycap still">any free key</span></span></div></div>`;
}

function AboutPane({ info }: { info: Info }) {
  const [log, setLog] = useState<string[] | null>(null);
  return html`<img class="about-mark" src="images/mark.svg" alt="" /><h2>Endless Cues <small class="dim" style="font:500 12px var(--font);letter-spacing:.04em" data-version>${info.version}</small></h2><p class="lede">${info.build ? `Build ${info.build.commit}, ${info.build.date}${info.build.dirty ? ', with uncommitted changes' : ''}. ` : 'Run from source. '}A free, open cue list that reads QLab’s.</p>
    <${Row} title="Made for a show" help="Made to run Endless Forms. Please credit: “Show control: Endless Cues, by Endless Forms Puppetry (endlesscues.com)”."><a class="btn" href="https://endlessformspuppetry.com" target="_blank">endlessformspuppetry.com</a><//>
    <${Row} title="QIRX" help="The eye of QIRX-G, one of three robot puppets from Endless Forms."><span data-about-qirx><${Qirx} size=${30} state="awake" label="The eye of QIRX-G, a robot puppet from Endless Forms" /></span><//>
    <${Row} title="The show file" help="A folder of plain text and media. Nothing needs the internet."><span></span><//>
    <${Row} title="Log" help="Everything said since launch.">
      <button class="btn" onClick=${async () => setLog(log ? null : (await ec.app({ op: 'log' })).lines)}>${log ? 'Hide' : 'Show the log'}</button><//>
    ${log ? html`<pre class="mono" style="user-select:text;white-space:pre-wrap;background:var(--bg-0);border:1px solid var(--line);border-radius:6px;padding:10px;max-height:300px;overflow:auto;color:var(--text-1)">${log.join('\n') || '(empty)'}</pre>` : null}
    <p style="margin-top:18px"><button class="about-report" data-about-report onClick=${askForReport}>Report a problem…</button></p>`;
}

function AppearancePane({ info, refreshInfo }: { info: Info; refreshInfo: () => unknown }) {
  const NAMES: Record<string, [string, string]> = { lab: ['Lab', 'Bronze, bone and copper.'], ocean: ['Ocean', 'Green dusk into deep water.'], graphite: ['Graphite', 'Plain grey, system fonts.'] };
  return html`<h3 class="subhead">Appearance</h3><p class="lede">On this computer only.</p>
    ${info.themes.map((t: string) => html`<div class=${cx('card', info.theme === t && 'picked')} onClick=${async () => { await ec.app({ op: 'theme', theme: t }); refreshInfo(); }}>
      <div class="ch"><span class=${cx('dot', info.theme === t && 'go')}></span><b>${NAMES[t][0]}</b></div><p>${NAMES[t][1]}</p></div>`)}
    <${Row} title="Cue list rows">
      <div class="seg rowsize">${[['compact', 'Compact'], ['normal', 'Normal'], ['large', 'Large']].map(([k, l]) => html`<button class=${cx(((info.view || {}).rowSize || 'normal') === k && 'on')} onClick=${async () => { await ec.app({ op: 'view', view: { rowSize: k } }); refreshInfo(); }}>${l}</button>`)}</div><//>`;
}

/** New versions, on this computer (app/main/updates.ts): whether it looks by itself, and whether test versions are offered. */
function UpdatesPane({ s, info, refreshInfo, say }: { s: State; info: Info; refreshInfo: () => unknown; say: Say }) {
  const u = info.updates || { auto: true, test: false };
  const found = useUpdate();     // (Settings covers the title bar: a newer version is said here too)
  const change = async (c: Record<string, unknown>) => { await ec.app({ op: 'update-settings', ...c }); refreshInfo(); };
  return html`<h3 class="subhead">Updates</h3>
    ${found && found.visible ? html`<div class="settings-update" data-settings-update><${UpdateLine} u=${found} s=${s} say=${say} /></div>` : null}
    <${Row} title="Check for updates automatically" help="Once a day, in Edit mode. Sends nothing about you or your show.">
      <span data-update-auto><${Switch} on=${u.auto !== false} onChange=${(on: boolean) => change({ auto: on })} /></span><//>
    <${Row} title="Test versions" help="Before everyone else. Not for a show.">
      <span data-update-test><${Switch} on=${!!u.test} onChange=${(on: boolean) => change({ test: on })} /></span><//>`;
}

/** General: GO and safety, updates, then how the app looks on this computer. */
const GeneralPane = (p: PaneProps) => html`<h2>General</h2><${GoPane} ...${p} /><${UpdatesPane} ...${p} /><${AppearancePane} ...${p} />`;

// Integrations: one entry, its panes chosen by the row of tabs at its top. The section ids are the panes' own, so
// a caller's setSettings('network') opens it on Network.
/** A pane: drawn with everything a pane may be given. */
type Pane = (p: PaneProps) => unknown;
const INTEGRATIONS: [string, string, Pane][] = [['network', 'Network', NetworkPane], ['video', 'Video', VideoPane], ['light', 'Light', LightPane], ['triggers', 'Triggers', TriggersPane], ['modules', 'Modules', ModulesPane]];
let lastIntegration = 'network';            // the tab the Integrations entry opens on: the one last looked at
function IntegrationsPane(p: PaneProps) {
  const [id, , Pane] = INTEGRATIONS.find(([x]) => x === p.section) || INTEGRATIONS[0];
  return html`<div class="seg settings-subtabs">${INTEGRATIONS.map(([x, label]) => html`<button key=${x} data-section=${x} class=${cx(x === id && 'on')} onClick=${() => p.setSection(x)}>${label}</button>`)}</div>
    <${Pane} ...${p} />`;
}

// the nav: [id, label, pane, the section ids it also answers to, the section its button opens, the Show-mode notice]
const NAV: [id: string, label: string, pane: Pane, also: string[], opens: (() => string) | null, lockable: boolean][] = [
  ['general', 'General', GeneralPane, ['go', 'appearance'], () => 'go', true],
  ['show', 'Show', ShowPane, [], null, true],
  ['audio', 'Audio', AudioPane, [], null, true],
  ['integrations', 'Integrations', IntegrationsPane, INTEGRATIONS.map(([x]) => x), () => lastIntegration, true],
  ['assistant', 'Assistant', AssistantPane, [], null, false],
  ['keys', 'Keys', KeysPane, [], null, false],
  ['about', 'About', AboutPane, [], null, false],
];
const entryOf = (section: string) => NAV.find(([id, , , also]) => id === section || also.includes(section)) || NAV[1];

export function Settings({ s, info, section, setSection, close, say, refreshInfo, review }: { s: State; info: Info; section: string; setSection: (section: string) => void; close: () => void; say: Say; refreshInfo: () => unknown; review?: () => void }) {
  const [entry, , pane, , , lockable] = entryOf(section);
  if (entry === 'integrations' && INTEGRATIONS.some(([x]) => x === section)) lastIntegration = section;
  const locked = s.mode === 'show';
  return html`<div class="scrim" onMouseDown=${(e: MouseEvent) => { if (e.target === e.currentTarget) close(); }}>
    <div class="modal">
      <nav><h3>Settings</h3>${NAV.map(([id, label, , , opens]) => html`<button key=${id} data-section=${id} class=${cx(entry === id && 'on')} onClick=${() => setSection(opens ? opens() : id)}>${label}</button>`)}</nav>
      <div class="pane">
        <button class="btn ghost small icon close" onClick=${close}>×</button>
        ${locked && lockable ? html`<div class="problem warning" style="margin-bottom:14px">Show mode: the show’s settings are locked. Switch to Edit to change them.</div>` : null}
        <${pane} s=${s} info=${info} say=${say} refreshInfo=${refreshInfo} review=${review} section=${section} setSection=${setSection} />
      </div>
    </div>
  </div>`;
}
