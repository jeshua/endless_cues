// The inspector: the selected cue's settings, drawn from the cue-type table (core/show/cue-types.ts), so a
// new field or cue type appears here without this file changing.
import { html, useState, useEffect, useLayoutEffect, useRef, ec, cmd, edit, setCue, clock, db, cx, mod, keys, parseTime } from './lib.js';
import * as Tidy from './tidy.js';
import { Waveform, Was, usePin, PinControls } from './Sidebar.js';
import { Matrix, EqBands } from './Routing.js';
import { ShapeField } from './Curves.js';
import { SoundDesign, SweepField, chainCount } from './SoundDesign.js';
import { WaveEdit } from './WaveEdit.js';
import { TempoFix } from './Tempo.js';
import { DeviceCueField, deviceCueHides, devicesOf } from './Rig.js';
import type { State, Info as AppInfo, Cue, CueIndex, Sounding } from './lib.js';
import type { Pending, PendingField as PendingFieldOf } from './app.js';
import type { TriggerRow } from './Triggers.js';
import type { Region, Device } from '../../core/show/types';
import type { Field as FieldDef, TypeDef } from '../../core/show/cue-types';

/** A field's value: what it holds is said by its kind (the table), so it is read as that kind where it is drawn. */
type FieldValue = any;
/** A sound playing now, as the engine lists it (`kind` 'audio'). */
type Playing = State['engine']['active'][number];
const playingSound = (id: string) => (x: Playing): x is Sounding => x.id === id && x.kind === 'audio';

/** A text box that commits on Enter or when it loses the keyboard, and goes back on Esc. */
export interface TextBoxProps { value: unknown; onCommit: (text: string) => void; mono?: boolean; placeholder?: string; area?: boolean; type?: string; style?: string }
export function TextBox({ value, onCommit, mono, placeholder, area, type = 'text', style }: TextBoxProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);        // Esc: the blur that follows must not commit
  useEffect(() => setDraft(null), [value]);
  const shown = draft !== null ? draft : (value ?? '');
  const done = (ev?: Event) => { if (cancelled.current) { cancelled.current = false; setDraft(null); return; } if (draft !== null && draft !== String(value ?? '')) onCommit(draft); setDraft(null); if (ev && ev.type === 'keydown') (ev.target as HTMLElement).blur(); };
  const props = { value: shown, placeholder, style, class: cx(mono && 'mono'),
    onInput: (ev: InputEvent) => setDraft((ev.target as HTMLInputElement).value),
    onBlur: done,
    onKeyDown: (ev: KeyboardEvent) => { if (ev.key === 'Enter' && !(area && !mod(ev))) { ev.preventDefault(); done(ev); } if (ev.key === 'Escape') { cancelled.current = true; setDraft(null); (ev.target as HTMLElement).blur(); ev.stopPropagation(); } } };
  return area ? html`<textarea rows="3" ...${props}></textarea>` : html`<input type=${type} ...${props} />`;
}

/** A Network cue aimed at a patch whose device is known: pick a command, fill in its few parameters, and the
 *  message is written for you. It stays plain text on the cue, to be edited by hand whenever that is easier. */
function CommandPicker({ cue, s, info }: { cue: Cue; s: State; info: AppInfo }) {
  const patches = s.doc.settings.network.patches;
  const patch = patches.find((p) => p.id === cue.patch) || (patches.length === 1 ? patches[0] : null);
  const device = patch && info.devices.find((d) => d.id === patch.device);
  const [cmdId, setCmdId] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [fade, setFade] = useState(false);
  useEffect(() => { setCmdId(''); setVals({}); setFade(false); }, [cue.id, patch && patch.device]);
  if (!device || !device.commands.length) return null;
  const c = device.commands.find((x) => x.id === cmdId);
  const value = (p: { key: string; default?: unknown }) => (vals[p.key] !== undefined && vals[p.key] !== '' ? vals[p.key] : p.default);
  const compose = () => c!.template.replace(/\{(\w+)\}/g, (_m, k) => (fade && c!.fade === k ? '#v#' : String(value(c!.params.find((p) => p.key === k) || { key: k, default: '' }))));
  const use = () => {
    if (!c || !patch) return;
    const props = { message: compose(), ...(cue.name ? {} : { name: `${patch.name}: ${c.label}` }) };
    if (c.fade && fade) Object.assign(props, { fadeTo: Number(value(c.params.find((p) => p.key === c.fade)!)), duration: cue.duration || 3 });
    else if (c.fade) Object.assign(props, { fadeFrom: null, fadeTo: null, duration: null });
    setCue(cue.id, props, 'network command');
  };
  return html`<div class="cmdpick">
    <div><label>${device.label.split(' (')[0]} command</label><select style="width:210px" value=${cmdId} onChange=${(e: Event) => { setCmdId((e.target as HTMLSelectElement).value); setVals({}); setFade(false); }}>
      <option value="">Choose a command…</option>${device.commands.map((x) => html`<option value=${x.id}>${x.label}</option>`)}</select></div>
    ${c ? c.params.map((p) => html`<div title=${p.help || ''}><label>${fade && c.fade === p.key ? `${p.label}: fade to` : p.label}</label><input type="text" class="mono" style="width:120px" value=${vals[p.key] ?? ''} placeholder=${String(p.default)} onInput=${(e: InputEvent) => setVals({ ...vals, [p.key]: (e.target as HTMLInputElement).value })} /></div>`) : null}
    ${c && c.fade ? html`<div title="Fade the value over a time"><label>Fade it</label><button class=${cx('switch', fade && 'on')} onClick=${() => setFade(!fade)}></button></div>` : null}
    ${c ? html`<button class="btn primary" onClick=${use} title=${compose()}>Write the message</button>` : null}
  </div>`;
}

const TRIGGER_KIND: Record<string, string> = { hotkey: 'The hotkey', osc: 'The OSC trigger', midi: 'The MIDI trigger', clock: 'The clock trigger', timecode: 'The timecode trigger' };

function LearnTrigger({ cue, s, midi }: { cue: Cue; s: State; midi: boolean }) {
  const [waiting, setWaiting] = useState(false);
  const [why, setWhy] = useState('');
  const learn = async () => {
    if (waiting) { cmd({ op: midi ? 'midi-learn-cancel' : 'osc-learn-cancel' }); return; }
    setWaiting(true); setWhy('');
    const r = await window.ec.cmd({ op: midi ? 'midi-learn' : 'osc-learn' });
    setWaiting(false);
    if (r && r.learned) setCue(cue.id, midi ? { midiTrigger: r.learned.text } : { oscTrigger: r.learned.text || r.learned.address }, midi ? 'MIDI trigger' : 'OSC trigger');   // with its arguments: a sensor's 1 fires it, its 0 does not
    else if (r && r.error && midi) setWhy(r.error);
  };
  return html`<button class=${cx('btn small', waiting && 'standby')} onClick=${learn} title=${why || (midi ? 'Then send it from the MIDI device' : `Then send it to UDP port ${s.network.inputPort}`)}>${waiting ? (midi ? 'Waiting for MIDI… (cancel)' : `Waiting on ${s.network.inputPort}… (cancel)`) : why ? 'Nothing came · Learn' : 'Learn'}</button>`;
}

/** A colour: the six (none, red, orange, yellow, green, blue), and "…" for any other, on the system's colour wheel.
 *  A colour from the wheel is kept as '#rrggbb'; one of the other names (teal, purple…) shows on "…" as it is. */
function Colours({ f, cur, palette, set }: { f: FieldDef; cur: string; palette: readonly string[]; set: (v: string) => void }) {
  const other = !!cur && cur !== 'none' && !palette.includes(cur);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // (the wheel reports every move as it is dragged: one edit is made once it rests, not one per step)
  const picked = (v: string, now?: boolean) => { clearTimeout(timer.current); if (now) { if (v !== cur) set(v); } else timer.current = setTimeout(() => { if (v !== cur) set(v); }, 400); };
  // the wheel opens on the colour the cue has (a named colour as the theme draws it)
  const hex = (() => {
    if (Tidy.isCustomColor(cur)) return cur.length === 4 ? `#${cur[1]}${cur[1]}${cur[2]}${cur[2]}${cur[3]}${cur[3]}` : cur;
    const probe = cur && cur !== 'none' ? getComputedStyle(document.documentElement).getPropertyValue(`--c-${cur}`).trim() : '';
    return /^#[0-9a-f]{6}$/i.test(probe) ? probe : '#808080';
  })();
  return html`<div class="swatches" data-swatches=${f.key}>
    ${palette.map((o) => html`<button class=${cx(cur === o && 'on', o === 'none' && 'none')} style=${o === 'none' ? '' : `background:var(--c-${o})`} title=${o} onClick=${() => set(o)}></button>`)}
    <label class=${cx('any', other && 'on')} data-colour-any title=${other ? `${cur}. Click for any colour` : 'Any colour'} style=${other ? `background:${Tidy.colorCss(cur)}` : ''}>${other ? '' : '…'}
      <input type="color" value=${hex} onInput=${(ev: InputEvent) => picked((ev.target as HTMLInputElement).value)} onChange=${(ev: Event) => picked((ev.target as HTMLInputElement).value, true)} /></label>
  </div>`;
}

function shownValue(f: FieldDef, v: unknown) {
  if (v === undefined || v === null) return '';
  if (f.kind === 'seconds') return clock(Number(v), 2);
  if (f.kind === 'db') return Number(v) <= -60 ? '-inf' : String(v);
  return String(v);
}

interface FieldProps { f: FieldDef; cues: Cue[]; s: State; byId: CueIndex; info: AppInfo; pending: Pending; reveal?: (id: string) => void }
function Field({ f, cues, s, byId, info, pending, reveal }: FieldProps) {
  const first = cues[0];
  const mixed = cues.some((c) => JSON.stringify(c[f.key]) !== JSON.stringify(first[f.key]));
  const value: FieldValue = mixed ? undefined : first[f.key];
  const ids = cues.map((c) => c.id);
  const set = (v: unknown) => setCue(ids, { [f.key]: v === '' ? null : v }, f.label.toLowerCase());
  let control: unknown;
  // a Device cue: its device, its command and that command's values are drawn from the show's devices (Rig.ts)
  if (first.type === 'device' && deviceCueHides(f, cues, s)) return null;
  if (f.kind === 'device' || f.kind === 'command' || f.kind === 'args') return html`<${DeviceCueField} f=${f} cues=${cues} s=${s} pending=${pending} />`;
  switch (f.kind) {
    case 'bool': {
      // (a Fade's "stop target" left alone is on for a fade to silence: the host says which)
      const on = value === undefined ? (f.key === 'stopTarget' && first.type === 'fade' ? (s.fadeStops || []).includes(first.id) : !!f.default) : !!value;
      control = html`<button class=${cx('switch', on && 'on')} onClick=${() => set(!on)}></button>`;
      break;
    }
    case 'enum': {
      const cur = value === undefined ? (f.default ?? '') : value;
      control = f.options!.length <= 4
        ? html`<div class="seg">${f.options!.map((o) => html`<button class=${cx(cur === o && 'on')} onClick=${() => set(o)}>${(f.labels && f.labels[o]) || o || 'none'}</button>`)}</div>`
        : f.key === 'color' || f.key === 'color2'
          ? html`<${Colours} f=${f} cur=${cur} palette=${info.palette || f.options} set=${set} />`
          : html`<select value=${cur} onChange=${(ev: Event) => set((ev.target as HTMLSelectElement).value)}>${f.options!.map((o) => html`<option value=${o}>${(f.labels && f.labels[o]) || o || 'none'}</option>`)}</select>`;
      break;
    }
    case 'cue': {
      const options: Cue[] = [];
      for (const [id, x] of byId) if (!ids.includes(id) && (!f.targets || f.targets.includes(x.cue.type))) options.push(x.cue);
      control = html`<div class="with-unit"><select value=${value || ''} onChange=${(ev: Event) => set((ev.target as HTMLSelectElement).value)}>
        <option value="">${mixed ? '(mixed)' : '— choose —'}</option>
        ${value && !byId.has(value) && !(f.lists && s.doc.lists.some((l) => l.id === value)) ? html`<option value=${value}>(missing)</option>` : null}
        ${f.lists ? s.doc.lists.map((l) => html`<option value=${l.id}>The list “${l.name}”</option>`) : null}
        ${options.map((c) => html`<option value=${c.id}>${c.number ? c.number + ' · ' : ''}${s.labels[c.id]}</option>`)}</select>
        ${reveal ? html`<button class="btn small" disabled=${!value || !byId.has(value)} onClick=${() => reveal(value)} title=${keys('Select its target (⌘E)')}>Go to</button>` : null}</div>`;
      break;
    }
    case 'bus':
      control = html`<select value=${value || f.default} onChange=${(ev: Event) => set((ev.target as HTMLSelectElement).value)}>${s.doc.settings.audio.buses.map((b) => html`<option value=${b.id}>${b.name}</option>`)}</select>`;
      break;
    case 'input':
      control = html`<select value=${value || ''} onChange=${(ev: Event) => set((ev.target as HTMLSelectElement).value)}>
        <option value="">This computer’s default input</option>
        ${value && !(s.mixer.inputs || []).includes(value) ? html`<option value=${value}>${value} (not connected)</option>` : null}
        ${(s.mixer.inputs || []).map((n) => html`<option value=${n}>${n}</option>`)}</select>`;
      break;
    case 'camera': {
      // the cameras are known once the stage has been open on this computer; until then (or for one not here) the name is typed
      const known = (s.stage && s.stage.cameras) || [];
      control = known.length ? html`<select value=${value || ''} onChange=${(ev: Event) => set((ev.target as HTMLSelectElement).value)}>
        <option value="">This computer’s default camera</option>
        ${value && !known.includes(value) ? html`<option value=${value}>${value} (not connected)</option>` : null}
        ${known.map((n) => html`<option value=${n}>${n}</option>`)}</select>`
        : html`<${TextBox} value=${value} placeholder=${mixed ? '(mixed)' : 'the default camera'} onCommit=${set} />`;
      break;
    }
    case 'patch': {
      const patches = s.doc.settings.network.patches;
      // (the patches, then the show's devices: a message typed by hand may go to a device too)
      const devs: Device[] = devicesOf(s).filter((d: Device) => d.via !== 'midi');
      control = html`<select value=${value || ''} onChange=${(ev: Event) => set((ev.target as HTMLSelectElement).value)}>
        <option value="">${patches.length === 1 ? `${patches[0].name} (the only patch)` : patches.length || devs.length ? '— choose —' : 'No patches yet: Settings ▸ Integrations ▸ Network'}</option>
        ${patches.map((p) => html`<option value=${p.id}>${p.name} — ${p.host}:${p.port}</option>`)}
        ${devs.length ? html`<optgroup label="Devices (the Rig)">${devs.map((d) => html`<option value=${d.id}>${d.name}${d.host && d.port ? ` — ${d.host}:${d.port}` : ' — no address yet'}</option>`)}</optgroup>` : null}</select>`;
      break;
    }
    case 'file':
      control = html`<div class="with-unit"><${TextBox} mono value=${value} placeholder=${mixed ? '(mixed)' : f.media === 'picture' ? 'media/film.mp4' : f.placeholder || 'media/sound.wav'} onCommit=${set} />
        <button class="btn small" onClick=${async () => { const r = await ec.app(f.media === 'picture' ? { op: 'pick-picture' } : { op: 'pick-sound', accept: f.accept || '' }); if (r && r.file) set(r.file); }}>Choose…</button></div>`;
      break;
    case 'levels': {
      const lv: Record<string, number> = value || {};
      control = html`<div style="display:grid;gap:4px">${s.doc.settings.audio.buses.map((b) => html`<div class="with-unit"><span class="unit" style="width:70px">${b.name}</span>
        <${TextBox} mono value=${lv[b.id] ?? ''} placeholder="leave" onCommit=${(v: string) => { const n = { ...lv }; if (v === '') delete n[b.id]; else n[b.id] = Number(v); set(n); }} /><span class="unit">dB</span></div>`)}</div>`;
      break;
    }
    case 'longtext':
      control = html`<${TextBox} area mono=${f.mono} value=${value} placeholder=${mixed ? '(mixed)' : f.placeholder || ''} onCommit=${set} />`;
      break;
    case 'seconds': case 'db': case 'number':
      control = html`<div class="with-unit"><${TextBox} mono value=${shownValue(f, value)} placeholder=${mixed ? '(mixed)' : f.default !== undefined ? shownValue(f, f.default) : ''} onCommit=${set} />
        <span class="unit">${f.kind === 'db' ? 'dB' : f.kind === 'seconds' ? 's' : ''}</span></div>`;
      break;
    case 'matrix':
      // (a row per channel of the sound: a file's count is read from it, a mic is one)
      control = html`<${Matrix} value=${value} mixed=${mixed} s=${s} channels=${first.type === 'mic' ? 1 : ((s.routing || {}).channels || {})[first.file!] || 2} onCommit=${set} />`;
      break;
    case 'eq':
      control = html`<${EqBands} value=${value} onCommit=${set} />`;
      break;
    case 'sweep':
      control = html`<${SweepField} value=${value} info=${info} target=${first.target && byId.has(first.target) ? byId.get(first.target)!.cue : null} onCommit=${set} />`;
      break;
    case 'chain':
      return null;                                  // edited on the Sound design tab
    case 'shape':
      control = html`<${ShapeField} value=${value} mixed=${mixed} falling=${f.key === 'shapeDown' || f.key === 'fadeOutShape'} onChange=${set} />`;
      break;
    case 'markers': case 'regions': case 'numbers': case 'envelope': case 'automation':
      return null;                                  // edited on the Time & Loops tab
    default:
      control = (f.key === 'oscTrigger' || f.key === 'midiTrigger') && cues.length === 1
        ? html`<div class="with-unit"><${TextBox} mono value=${value} placeholder=${f.key === 'midiTrigger' ? 'note 60' : '/address'} onCommit=${set} /><${LearnTrigger} cue=${first} s=${s} midi=${f.key === 'midiTrigger'} /></div>`
        : f.key === 'number' && cues.length > 1
          ? html`<input type="text" disabled placeholder=${keys(`${cues.length} cues: use Tools ▸ Renumber (⌘R)`)} />`
          : html`<${TextBox} mono=${f.mono} value=${value} placeholder=${mixed ? '(mixed)' : f.placeholder || ''} onCommit=${set} />`;
  }
  const wide = f.kind === 'shape' || f.tab === 'triggers' || f.kind === 'longtext' || f.key === 'message' || f.key === 'file' || f.kind === 'camera' || f.key === 'color' || f.key === 'color2' || f.kind === 'levels' || f.kind === 'matrix' || f.kind === 'eq' || f.kind === 'sweep' || f.key === 'oscTrigger' || f.key === 'midiTrigger' || f.key === 'midi' || f.key === 'mode';
  // pending: this field differs from the saved show on at least one of the selected cues
  const changed = cues.map((c) => [c, pending.cues.get(c.id) && pending.cues.get(c.id)!.fields.get(f.key)] as const).filter((x): x is readonly [Cue, PendingFieldOf] => !!x[1]);
  const back = () => edit(changed.map(([c, p]) => ({ op: 'cue.set', id: c.id, props: { [f.key]: p.rawFrom } })), 'put back');
  return html`<div data-field=${f.key} class=${cx('field', changed.length && 'pending', wide && 'wide', (f.key === 'name' || f.key === 'continue') && 'two', (f.kind === 'longtext' || f.kind === 'levels' || f.kind === 'matrix' || f.kind === 'sweep') && 'top')} ><label>${f.label}${f.tip ? html`<${Info} text=${f.tip} />` : null}${changed.length ? html`<${Was} was=${changed.length === 1 ? changed[0][1].from : 'several values'} onBack=${back} />` : null}</label>${control}</div>`;
}

/** An audio cue's own tab opens on its waveform: the Volume line (and the menu of its other lines) and the markers,
 *  edited right there, as on Time & Loops, which keeps the typed-in times, the tempo and the loop regions. */
function AudioWave({ cue, s, info }: { cue: Cue; s: State; info: AppInfo }) {
  const dur = s.engine.durations[cue.file!] || 0;
  const a = s.engine.active.find(playingSound(cue.id));
  const pin = usePin(a);
  if (!cue.file) return null;
  return html`<div class="field wide audio-wave" data-audio-wave>
    <${WaveEdit} cue=${cue} duration=${dur} active=${a} pin=${pin.t} locked=${s.mode === 'show'} tools=${(info && info.sound && info.sound.tools) || []} onPick=${(t: number) => { if (a) pin.place(t); }} />
    ${a ? html`<${PinControls} a=${a} pin=${pin} />` : null}
  </div>`;
}

function TimeAndLoops({ cue, s, info }: { cue: Cue; s: State; info: AppInfo }) {
  const dur = s.engine.durations[cue.file!] || 0;
  const a = s.engine.active.find(playingSound(cue.id));
  const pos: number | null = a ? a.elapsed : null;
  const markers = cue.markers || [], loops = cue.loops || [];
  const [name, setName] = useState('');
  const [at, setAt] = useState('');           // a time typed, or picked by a click on the waveform while nothing plays
  const pin = usePin(a);
  const r2 = (t: number) => Math.round(t * 100) / 100;
  const [reg, setReg] = useState({ from: '', to: '' });      // a region typed in, start and end
  const addRegion = () => { const a0 = parseTime(reg.from), b0 = parseTime(reg.to); if (!(b0 > a0) || !(a0 >= 0)) return; setCue(cue.id, { loops: [...loops, { start: r2(a0), end: r2(b0) }].sort((x, y) => x.start - y.start) }, 'add loop region'); setReg({ from: '', to: '' }); };
  const typed = at.trim() === '' ? null : parseTime(at);
  // The sound's tempo, looked for only when it is asked for here: with one, a group can
  // wait for this track's beat or bar (its Quantise), and a Jump can cross on the bar.
  const [finding, setFinding] = useState(false);
  const [tempoSaid, setTempoSaid] = useState('');
  useEffect(() => { setTempoSaid(''); setFinding(false); }, [cue.id]);
  const findTempo = async () => {
    setFinding(true);
    const r = await cmd({ op: 'tempo-find', ids: [cue.id], again: !!cue.tempo });
    setFinding(false);
    setTempoSaid(!r || r.error ? '' : r.found ? '' : 'No steady tempo found.');
  };
  // Find loops: the stretches of this sound that go round cleanly, added as regions (one edit; Undo takes them away)
  const [looking, setLooking] = useState(false);
  const [loopsSaid, setLoopsSaid] = useState('');
  useEffect(() => { setLooking(false); setLoopsSaid(''); }, [cue.id]);
  const findLoops = async () => {
    setLooking(true); setLoopsSaid('');
    const r = await cmd({ op: 'loops-find', id: cue.id });
    setLooking(false);
    setLoopsSaid(!r || r.error ? (r && r.error) || '' : r.found ? '' : 'No clean loops found.');
  };
  const where = typed !== null && Number.isFinite(typed) && typed >= 0 ? typed : (pin.t ?? pos ?? 0);
  const addMarker = () => { setCue(cue.id, { markers: [...markers, { at: r2(where), name: name.trim() || `Marker ${markers.length + 1}` }] }, 'add marker'); setName(''); setAt(''); };
  // a region's count: a number goes round that many times; ∞ goes round until let go; empty waits for L
  const setCount = (i: number, v: string) => { const t = String(v).trim().toLowerCase(), n = Math.round(Number(t)); const hold = ['∞', 'inf', 'hold', 'forever', '0'].includes(t);
    setCue(cue.id, { loops: loops.map((x: Region, k: number) => { if (k !== i) return x; const { count, hold: _h, ...rest } = x; return { ...rest, ...(hold ? { hold: true } : n > 1 ? { count: n } : {}) }; }) }, 'loop count'); };
  return html`<div style="display:grid;gap:10px">
    <${WaveEdit} cue=${cue} duration=${dur} active=${a} pin=${pin.t} locked=${s.mode === 'show'} tools=${(info && info.sound && info.sound.tools) || []} onPick=${(t: number) => (a ? pin.place(t) : setAt(clock(r2(t), 2)))} />
    ${a ? html`<${PinControls} a=${a} pin=${pin} />` : null}
    ${a || cue.hasGrid ? html`<div class="dim" style="font-size:12px">${a ? 'Click a loop to hold it; again to let go.' : ''}${cue.hasGrid ? ' Has a beat grid.' : ''}${a && a.rate && a.rate !== 1 ? ` Rate ×${Math.round(a.rate * 100) / 100}.` : ''}</div>` : null}
    <div class="form">
      <div class="field wide"><label>Start · End</label><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        <${TextBox} mono style="width:76px" value=${cue.from ? clock(cue.from, 2) : ''} placeholder="0:00.00" onCommit=${(v: string) => setCue(cue.id, { from: v === '' ? null : v }, 'start at')} />
        <span class="dim">to</span>
        <${TextBox} mono style="width:76px" value=${cue.cutAt ? clock(cue.cutAt, 2) : ''} placeholder=${dur ? clock(dur, 2) : 'the end'} onCommit=${(v: string) => setCue(cue.id, { cutAt: v === '' ? null : v }, 'end at')} /></div></div>
      <div class="field wide" data-tempo><label>Tempo</label><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        ${cue.tempo ? html`<span class="chip">${(Math.round(cue.tempo.bpm * 100) / 100).toFixed(2)} bpm${cue.tempo.sections && cue.tempo.sections.length ? ` · ${cue.tempo.sections.length} change${cue.tempo.sections.length === 1 ? '' : 's'}` : ''}</span>` : null}
        <button class="btn small" data-find-tempo disabled=${finding || !cue.file || s.mode === 'show'} onClick=${findTempo} title="Listen for this sound’s beat">${finding ? 'Listening…' : cue.tempo ? 'Find again' : 'Find the tempo'}</button>
        ${cue.tempo ? html`<button class="btn ghost small" disabled=${s.mode === 'show'} onClick=${() => setCue(cue.id, { tempo: null }, 'tempo removed')} title="Forget its tempo">Remove</button>` : null}
        <span class="dim">${tempoSaid || (cue.tempo ? '' : 'Only needed to move on the beat.')}</span></div>
        ${cue.tempo ? html`<div style="margin-top:6px"><${TempoFix} cue=${cue} at=${where} playing=${!!a} locked=${s.mode === 'show'} /></div>` : null}</div>
      <div class="field wide"><label>Markers</label><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        <input type="text" style="width:130px" placeholder="marker name" value=${name} onInput=${(e: InputEvent) => setName((e.target as HTMLInputElement).value)} onKeyDown=${(e: KeyboardEvent) => { if (e.key === 'Enter') addMarker(); }} />
        <span class="dim">at</span>
        <input type="text" class="mono" data-marker-at style="width:76px" title="Empty: where it is now" placeholder=${clock(pin.t ?? pos ?? 0, 2)} value=${at} onInput=${(e: InputEvent) => setAt((e.target as HTMLInputElement).value)} onKeyDown=${(e: KeyboardEvent) => { if (e.key === 'Enter') addMarker(); }} />
        <button class="btn small" onClick=${addMarker}>Add marker</button>
        ${!a && typed != null && Number.isFinite(typed) ? html`<button class="btn small" onClick=${() => { setCue(cue.id, { from: r2(typed) }, 'start at'); setAt(''); }}>Start here</button><button class="btn small" onClick=${() => { setCue(cue.id, { cutAt: r2(typed) }, 'end at'); setAt(''); }}>End here</button>` : null}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px">${markers.length > 1 && s.mode !== 'show' ? html`<button class="btn ghost small" data-markers-clear onClick=${() => setCue(cue.id, { markers: [] }, 'remove all markers')}>Remove all</button>` : null}${markers.map((m, i) => html`<span class="chip">${clock(m.at, 2)} ${m.name}<button class="btn ghost small icon" style="width:16px;height:16px" onClick=${() => setCue(cue.id, { markers: markers.filter((_, j) => j !== i) }, 'remove marker')}>×</button></span>`)}</div></div>
      <div class="field wide"><label>Loop regions</label><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        ${loops.length ? loops.map((g, i) => html`<span class="chip" style="height:26px">${g.name || `Loop ${i + 1}`} · ${clock(g.start, 2)}–${clock(g.end, 2)} · round
          <${TextBox} mono style="width:44px;height:20px;padding:0 4px;text-align:center" placeholder="on L" value=${g.hold ? '∞' : g.count || ''} onCommit=${(v: string) => setCount(i, v)} />
          <button class="btn ghost small icon" style="width:16px;height:16px" onClick=${() => setCue(cue.id, { loops: loops.filter((_, j) => j !== i) }, 'remove loop')}>×</button></span>`)
          : html`<span class="dim">None.</span>`}
        <span class="dim">from</span><input type="text" class="mono" data-region-from style="width:70px" placeholder="0:30" value=${reg.from} onInput=${(e: InputEvent) => setReg({ ...reg, from: (e.target as HTMLInputElement).value })} />
        <span class="dim">to</span><input type="text" class="mono" data-region-to style="width:70px" placeholder="0:38" value=${reg.to} onInput=${(e: InputEvent) => setReg({ ...reg, to: (e.target as HTMLInputElement).value })} onKeyDown=${(e: KeyboardEvent) => { if (e.key === 'Enter') addRegion(); }} />
        <button class="btn small" disabled=${!(parseTime(reg.to) > parseTime(reg.from) && parseTime(reg.from) >= 0)} onClick=${addRegion}>Add region</button>
        <button class="btn small" data-find-loops disabled=${looking || !cue.file || s.mode === 'show'} onClick=${findLoops} title="Listen for stretches of this sound that go round cleanly, and add them as loop regions">${looking ? 'Listening…' : 'Find loops'}</button>
        ${loopsSaid ? html`<span class="dim">${loopsSaid}</span>` : null}
        ${markers.length >= 2 && html`<button class="btn small" title="One region between each pair of markers" onClick=${() => setCue(cue.id, { loops: markers.slice(0, -1).map((m, i) => ({ start: m.at, end: markers[i + 1].at, name: m.name })) }, 'loops from markers')}>Make from markers</button>`}
      </div></div>
      ${loops.length ? html`<div class="field wide"><label></label><span class="dim"><b>Round:</b> a number, <b>∞</b> until let go (L), or empty: only on L.</span></div>` : null}
      <div class="field wide"><label>Whole sound</label><div style="display:flex;gap:8px;align-items:center">
        <button class=${cx('switch', cue.loop && 'on')} onClick=${() => setCue(cue.id, { loop: !cue.loop }, 'loop')}></button><span class="dim">Loops Start to End.</span></div></div>
      ${cue.loop ? null : html`<div class="field wide"><label>Play count</label><div style="display:flex;gap:8px;align-items:center">
        <${TextBox} mono style="width:44px" placeholder="1" value=${cue.plays! > 1 ? cue.plays : ''} onCommit=${(v: string) => { const n = Math.round(Number(v)); setCue(cue.id, { plays: n > 1 ? n : null }, 'play count'); }} /><span class="dim">times, then stops</span></div></div>`}
    </div>
  </div>`;
}

/** A Fade cue's two actions: take its level from its target, and put back what it last moved. */
function FadeTools({ cue, s }: { cue: Cue; s: State }) {
  const [said, setSaid] = useState('');
  useEffect(() => setSaid(''), [cue.id]);
  const playing = s.engine.active.some((x) => x.kind === 'audio' && (x.id === cue.target || x.parent === cue.target));
  const fromTarget = async () => { const r = await cmd({ op: 'fade-from-target', id: cue.id }); if (r && !r.error) setSaid(`Level set to ${db(Math.round(r.db * 10) / 10)}: ${r.playing ? 'where its target is now' : 'its target’s own level'}.`); };
  const revert = async () => { const r = await cmd({ op: 'revert-fade', id: cue.id }); if (r && r.reverted) setSaid(`Put back: ${r.reverted === 1 ? 'its target is' : `${r.reverted} sounds are`} as before this fade.`); };
  return html`<div class="field wide" data-fadetools><label>Actions</label><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
    <button class="btn small" disabled=${!cue.target} onClick=${fromTarget} title=${playing ? 'To level: where the target is now' : 'To level: the target’s own level'}>Set level from target</button>
    <button class="btn small" disabled=${!cue.target} onClick=${revert} title="Put back what it last faded, over 0.5 s. Not a stopped sound.">Revert fade</button>
    ${said ? html`<span class="dim">${said}</span>` : null}</div></div>`;
}

// The ⓘ beside a field whose name alone does not say what it does: a click shows one plain line under it, a
// click anywhere else (or Esc) puts it away. Nothing on hover.
function Info({ text }: { text: string }) {
  const [open, setOpen] = useState<string | null>(null);        // where its line goes: under the ⓘ, or over it near the window's foot
  const me = useRef<HTMLSpanElement>(null);
  const place = (b: HTMLElement) => { const r = b.getBoundingClientRect(), left = Math.max(8, Math.min(r.left - 6, innerWidth - 268));
    return r.bottom > innerHeight - 140 ? `left:${left}px;bottom:${innerHeight - r.top + 6}px` : `left:${left}px;top:${r.bottom + 6}px`; };
  // (attached as soon as it is drawn, not a frame later: a click that comes first must still put it away)
  useLayoutEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!me.current || !me.current.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); } };
    window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  return html`<span class="info" ref=${me}><button type="button" class=${cx('info-btn', open && 'on')} data-info aria-label="What is this?" aria-expanded=${!!open}
      onClick=${(e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); setOpen(open ? null : place(e.currentTarget as HTMLElement)); }}>i</button>
    ${open ? html`<span class="info-pop" role="note" style=${open}>${text}</span>` : null}</span>`;
}

export interface InspectorProps {
  s: State; info: AppInfo; selected: Cue[]; byId: CueIndex; pending: Pending;
  /** a field asked for (O: notes, T: target; `pick`: open its colour wheel) */
  focus?: { key: string; n?: number; pick?: boolean } | null;
  reveal?: (id: string) => void; say?: (text: string, bad?: boolean) => void; openSettings?: (section: string) => void;
}
export function Inspector({ s, info, selected, byId, pending, focus, reveal, say, openSettings }: InspectorProps) {
  const [tab, setTab] = useState('basics');
  const [more, setMore] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  // a key asked for a field (O: notes, T: target): its tab comes forward and the field takes the keyboard
  useEffect(() => {
    if (!focus || !selected.length) return;
    const t: TypeDef | null = selected.every((c) => c.type === selected[0].type) ? info.types[selected[0].type] : null;
    const inType = t && t.fields.find((f) => f.key === focus.key);
    const f: FieldDef | undefined = inType || info.common.find((x: FieldDef) => x.key === focus.key);
    if (!f) return;
    setTab(inType ? 'type' : f.tab || 'basics');
    if (f.advanced) setMore(true);
    setTimeout(() => {
      const el = body.current && body.current.querySelector<HTMLInputElement>(`[data-field="${focus.key}"] :is(input, textarea, select)`);
      if (!el) return;
      // (a colour asked for from the list's menu, Colour ▸ Other…: its wheel opens)
      if (focus.pick && el.type === 'color') { try { el.showPicker(); } catch { el.focus(); } return; }
      el.focus(); if (el.select) el.select();
    }, 40);
  }, [focus]);
  // the assistant pointing at a tab or a field (Point.ts): the tab comes forward, More opens; nothing takes the keyboard
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ tab?: string; more?: boolean }>).detail || {}; if (d.tab) setTab(d.tab); if (d.more) setMore(true); };
    window.addEventListener('ec-reveal', on);
    return () => window.removeEventListener('ec-reveal', on);
  }, []);
  const type = selected.length && selected.every((c) => c.type === selected[0].type) ? selected[0].type : null;
  const def: TypeDef | null = type ? info.types[type] : null;
  const tabs: [string, string][] = [['basics', 'Basics']];
  if (def && def.fields.some((f) => !f.hidden && !['markers', 'regions'].includes(f.kind))) tabs.push(['type', def.label]);
  if (type === 'audio' && selected.length === 1) tabs.push(['time', 'Time & Loops']);
  // what one sound is played through (its chain of tools and its eq) has a tab of its own; it says how many are in
  if (def && selected.length === 1 && def.fields.some((f) => f.kind === 'chain')) { const n = chainCount(selected[0]); tabs.push(['design', `Sound design${selected[0].chain && selected[0].chain.bypass ? ' (bypassed)' : n ? ` (${n})` : ''}`]); }
  // what starts a cue besides GO has a tab of its own; it says how many the selection has
  const trigFields: FieldDef[] = info.common.filter((f: FieldDef) => f.tab === 'triggers');
  const trigCount = trigFields.filter((f) => f.key !== 'secondTrigger' && f.key !== 'secondOnRelease').filter((f) => selected.some((c) => c[f.key] !== undefined && c[f.key] !== '')).length;
  // (a section heading never plays: nothing can start it)
  if (!(def && def.heading)) tabs.push(['triggers', `Triggers${trigCount ? ` (${trigCount})` : ''}`]);
  const cur = tabs.some((t) => t[0] === tab) ? tab : 'basics';
  if (!selected.length) return html`<div class="inspector" data-inspector><div class="tabs"><button class="on">Inspector</button></div><div class="nothing">Select a cue.</div></div>`;
  const probs: { id: string; level: string; why: string }[] = s.problems.filter((p: { id: string }) => selected.some((c) => c.id === p.id));
  // (a field with a `when` shows only while the field it depends on has one of those values: a playlist's settings)
  const shows = (f: FieldDef) => !f.when || Object.entries(f.when).every(([k, vals]) => selected.every((c) => vals.includes(c[k] === undefined ? (def!.fields.find((x) => x.key === k) || { default: undefined }).default : c[k])));
  // (a field with a `whenTarget` shows only while every selected cue is aimed at one of those types: what a Fade moves on a picture)
  const aimed = (f: FieldDef) => !f.whenTarget || selected.every((c) => c.target && byId.has(c.target) && f.whenTarget!.includes(byId.get(c.target)!.cue.type));
  const fields: FieldDef[] = cur === 'triggers' ? trigFields : cur === 'basics' ? info.common.filter((f: FieldDef) => !f.tab && !f.hidden && !(def && def.fields.some((x) => x.key === f.key)) && !(def && def.common && !def.common.includes(f.key))) : def!.fields.filter((f) => !f.hidden && !f.tab && shows(f) && aimed(f));
  // on the Triggers tab: whatever else in the show the same key or message would set off
  const clashes: TriggerRow[] = cur === 'triggers' ? (s.triggers || []).filter((t: TriggerRow) => t.clash.length && selected.some((c) => c.id === t.id)) : [];
  // Pre-wait and Post-wait are on Basics only once one is set (a post-wait also with auto-continue, the only time it
  // matters); otherwise they wait under More
  const anySet = (k: 'preWait' | 'postWait') => selected.some((c) => Number(c[k]) > 0);
  const LIFT: Record<string, () => boolean> = { preWait: () => anySet('preWait'), postWait: () => anySet('postWait') || selected.some((c) => c.continue === 'auto-continue') };
  const advanced = (f: FieldDef) => (cur === 'basics' && LIFT[f.key] ? !LIFT[f.key]() : f.advanced);
  const basic = fields.filter((f: FieldDef) => !advanced(f)), adv: FieldDef[] = fields.filter(advanced);
  const one = selected.length === 1 ? selected[0] : null;
  return html`<div class="inspector" data-inspector>
    <div class="tabs">
      ${tabs.map(([id, label]) => html`<button class=${cx(cur === id && 'on')} data-insp-tab=${id} onClick=${() => setTab(id)}>${label}</button>`)}
      <div class="what">${one ? html`<span>${info.types[one.type].glyph} ${info.types[one.type].summary}</span>` : `${selected.length} cues selected`}
        ${one && !info.types[one.type].heading && html`<button class="btn small" data-audition onClick=${() => cmd({ op: 'fire', id: one.id })} title="Fire it; the playhead stays (V)">Audition</button>`}</div>
    </div>
    <div class="insp-body" key=${selected.map((c) => c.id).join()} ref=${body}>
      ${cur === 'design' ? html`<${SoundDesign} cue=${one} s=${s} info=${info} pending=${pending} />` : cur === 'time' ? html`<${TimeAndLoops} cue=${one} s=${s} info=${info} />` : html`<div class="form">
        ${probs.map((p) => html`<div class=${cx('problem', p.level !== 'error' && 'warning')}>${selected.length > 1 ? `${s.labels[p.id]}: ` : ''}${p.why.charAt(0).toUpperCase() + p.why.slice(1)}.</div>`)}
        ${cur === 'type' && type === 'audio' && one ? html`<${AudioWave} cue=${one} s=${s} info=${info} />` : null}
        ${cur === 'type' && type === 'network' && one ? html`<${CommandPicker} cue=${one} s=${s} info=${info} />` : null}
        ${cur === 'triggers' ? html`<div class="field wide"><label></label><span class="dim">Each fires it; the playhead stays. <button class="btn ghost small" data-all-triggers onClick=${() => openSettings && openSettings('triggers')}>All triggers…</button></span></div>` : null}
        ${basic.map((f) => html`<${Field} key=${f.key} f=${f} cues=${selected} s=${s} byId=${byId} info=${info} pending=${pending} reveal=${reveal} />`)}
        ${clashes.map((t) => html`<div class="problem warning" key=${t.kind + t.id}>${selected.length > 1 ? `${s.labels[t.id!]}: ` : ''}${TRIGGER_KIND[t.kind]} ${t.text} is also ${t.clash.join(', and ')}${t.clash.length === 1 ? '’s' : ''}: one ${t.kind === 'hotkey' ? 'press' : t.kind === 'clock' || t.kind === 'timecode' ? 'moment' : 'message'} starts them all.</div>`)}
        ${cur === 'type' && type === 'fade' && one ? html`<${FadeTools} cue=${one} s=${s} />` : null}
        ${adv.length > 0 && html`<button class="more" onClick=${() => setMore(!more)}>${more ? '▾' : '▸'} More (${adv.length})</button>`}
        ${more && adv.map((f) => html`<${Field} key=${f.key} f=${f} cues=${selected} s=${s} byId=${byId} info=${info} pending=${pending} reveal=${reveal} />`)}
        ${one && !(def && def.heading) && (cur === 'type' || !tabs.some((t) => t[0] === 'type')) ? html`<${Template} cue=${one} s=${s} info=${info} say=${say} />` : null}
      </div>`}
    </div>
  </div>`;
}

/** Cue templates: "new Fade cues start like this one". Kept in the show (Settings ▸ Show lists them). */
function Template({ cue, s, info, say }: { cue: Cue; s: State; info: AppInfo; say?: (text: string) => void }) {
  const label = info.types[cue.type].label;
  const has = !!((s.doc.settings.templates || {})[cue.type]);
  return html`<div class="template"><span class="dim">New ${label} cues${has ? ': from a template' : ''}</span>
    <button class="btn small" title="All but number, name, notes, target and file"
      onClick=${async () => { const r = await cmd({ op: 'template', id: cue.id }); if (r && !r.error && say) say(`New ${label} cues will start like this one`); }}>${has ? 'Start like this one instead' : 'Start like this one'}</button>
    ${has ? html`<button class="btn small" onClick=${async () => { const r = await cmd({ op: 'template', type: cue.type, clear: true }); if (r && !r.error && say) say(`New ${label} cues start plain again`); }}>Clear template</button>` : null}</div>`;
}
