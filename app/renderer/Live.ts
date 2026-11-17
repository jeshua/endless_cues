// The Live view: the show's sound laid out the way Ableton Live's Session view is, for anyone who mixes there.
//
//   control bar   tempo and bar.beat of the music playing, launch quantisation, find tempos
//   session       a column for each track (bus), a row for each scene (a cue of the list: one GO), the sounds of
//                 that cue in their tracks' slots to launch; the scene launchers and Stop All in the Master column
//   mixer         under each track: pan, the fader and its meter, the track's on/off button, solo, crossfade A | B
//   crossfader
//   detail        Clip (the selected sound: waveform, bars, tempo, loops), Devices (the selected track: EQ Three,
//                 Auto Filter, Utility), or Decks (every sound that is playing, one under another)
//
// It sits beside the cue list, not in place of it: GO, the playhead and Panic work here as they do there.
//
// Map (in the control bar) gives a key or a MIDI control to anything marked `data-map` (a clip, a fader, a knob):
// click the control, then press the key or move the controller. The targets are core/audio/desk-map.js's.
import { html, useState, useRef, useEffect, cmd, ec, setCue, clock, db, cx } from './lib.js';
import * as Tidy from './tidy.js';
import { Waveform, usePin, PinControls, Was, toPos, toDb } from './Sidebar.js';
import { bpmText, sectionsOf, sectionAt, barsOf } from './Tempo.js';
import type { State, CueIndex, Cue, CueList, Op } from './lib.js';
import type { Pending } from './app.js';
import type { Bus, Marker, Tempo, DeskMapping } from '../../core/show/types';
import type { Sounding, Span } from './Sidebar.js';
import type { TempoEdit } from '../../core/audio/tempo';

/** A track as the mixer reports it: the show's bus, and what the desk has done to it since. */
type MixBus = Bus & { live?: number; liveStrip?: boolean; peak?: number | number[] };
/** A sound that is playing, as the engine reports it: what the desk reads of it. */
interface Playing extends Sounding {
  kind: string; parent?: string | null; name?: string; topNumber?: string; elapsed: number; total: number; end?: number; loop?: boolean; paused?: boolean;
  loops?: Span[] | null; markers?: Marker[]; file?: string; stretched?: boolean; rate?: number; db?: number; fadingTo?: number | null;
}
/** A scene: one cue of the list, and its sounds by the track they play on. */
interface Scene { cue: Cue; slots: Map<string, Cue[]>; sounds: number }
/** What a look for a sound's tempo found: a reading and the others it could be, or none. */
interface Reading { none?: boolean; bpm?: number; first?: number; sections?: unknown[]; others?: Reading[] }
type Say = (text: string, bad?: boolean) => void;
type Typed = Event & { target: HTMLInputElement };
type Keyed = KeyboardEvent & { target: HTMLInputElement };
type Dragged = DragEvent & { dataTransfer: DataTransfer };
/** What a strip control is given by `stripOf`: its pending mark, and what it does as it moves and when it is let go. */
interface Control { was: unknown; onLive: (v: number) => void; onCommit: (v: number) => void; onBack: () => void }

/** A round control: drag up or down (Shift: finer), or scroll; double-click sends it to rest. Heard as it moves
 *  (onLive), written on release (onCommit). The arc runs from rest, so a cut and a boost read at a glance. */
function Dial({ label, value, min, max, rest = 0, step = 0.5, text, was, onLive, onCommit, onBack, title, big, map }: {
  label: string; value: number; min: number; max: number; rest?: number; step?: number; text?: (v: number) => string | number; was?: unknown;
  onLive: (v: number) => void; onCommit: (v: number) => void; onBack?: () => void; title?: string; big?: boolean; map?: string;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; v: number } | null>(null), wheelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), live = useRef(value);
  const shown = drag !== null ? drag : value;
  live.current = shown;
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v / step) * step));
  const down = (e: PointerEvent & { currentTarget: Element }) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); start.current = { y: e.clientY, v: shown }; };
  const move = (e: PointerEvent) => { if (!start.current) return; const v = clamp(start.current.v + (start.current.y - e.clientY) * ((max - min) / (e.shiftKey ? 700 : 140))); if (v !== live.current) { setDrag(v); onLive(v); } };
  const up = () => { if (!start.current) return; start.current = null; const v = live.current; setDrag(null); if (v !== value) onCommit(v); };
  const wheel = (e: WheelEvent) => { e.preventDefault(); const v = clamp(live.current + (e.deltaY < 0 ? step : -step)); setDrag(v); onLive(v); clearTimeout(wheelTimer.current); wheelTimer.current = setTimeout(() => { setDrag(null); onCommit(live.current); }, 350); };
  const home = () => { setDrag(null); onLive(rest); onCommit(rest); };
  const p = (v: number) => (v - min) / (max - min);
  const ang = (x: number) => (-135 + x * 270) * Math.PI / 180;
  const pt = (x: number, r: number) => `${(24 + r * Math.sin(ang(x))).toFixed(2)} ${(24 - r * Math.cos(ang(x))).toFixed(2)}`;
  const arc = (a: number, b: number) => `M ${pt(a, 20)} A 20 20 0 ${Math.abs(b - a) * 270 > 180 ? 1 : 0} ${b > a ? 1 : 0} ${pt(b, 20)}`;
  const pos = p(shown), zero = p(rest);
  const [x1, y1] = pt(pos, 6).split(' '), [x2, y2] = pt(pos, 13.5).split(' ');
  return html`<div class=${cx('dial', big && 'big', was !== undefined && 'pending', shown !== rest && 'moved')} data-dial=${label} data-map=${map}>
    <svg viewBox="0 0 48 48" class="kdial" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onWheel=${wheel} onDblClick=${home}>
      <title>${title || label}. Double-click: rest.</title>
      <path class="ktrack" d=${arc(0, 1)} />
      <path class="kval" d=${arc(Math.min(zero, pos), Math.max(zero, pos) + 0.0001)} />
      <circle class="kring" cx="24" cy="24" r="14.5" />
      <line class="kneedle" x1=${x1} y1=${y1} x2=${x2} y2=${y2} />
    </svg>
    <div class="dname">${label}<${Was} was=${was} onBack=${onBack} /></div>
    <div class="dval">${text ? text(shown) : shown}</div>
  </div>`;
}

/** A channel fader, upright, with its meter beside it. A drag moves it from where it is (a click on the rail does
 *  not make it jump); Shift is finer; the wheel steps half a dB; double-click is 0 dB. */
function VFader({ value, peaks, onLive, onCommit, map }: { value: number; peaks?: number | number[]; onLive: (d: number) => void; onCommit: (d: number) => void; map?: string }) {
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; p: number } | null>(null), rail = useRef<HTMLDivElement>(null), wheelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), live = useRef(value);
  const shown = drag !== null ? drag : value;
  live.current = shown;
  const down = (e: PointerEvent & { currentTarget: Element }) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); start.current = { y: e.clientY, p: toPos(shown) }; };
  const move = (e: PointerEvent) => { if (!start.current) return; const h = rail.current!.clientHeight || 1; const d = toDb(Math.max(0, Math.min(1, start.current.p + (start.current.y - e.clientY) / h / (e.shiftKey ? 5 : 1)))); if (d !== live.current) { setDrag(d); onLive(d); } };
  const up = () => { if (!start.current) return; start.current = null; const d = live.current; setDrag(null); if (d !== value) onCommit(d); };
  const wheel = (e: WheelEvent) => { e.preventDefault(); const d = Math.max(-60, Math.min(12, live.current + (e.deltaY < 0 ? 0.5 : -0.5))); setDrag(d); onLive(d); clearTimeout(wheelTimer.current); wheelTimer.current = setTimeout(() => { setDrag(null); onCommit(live.current); }, 350); };
  return html`<div class="vfader" data-map=${map} ref=${rail} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onWheel=${wheel}
      onDblClick=${() => { setDrag(null); onLive(0); onCommit(0); }} title="⇧: finer. Double-click: 0 dB.">
    ${[6, 0, -12, -24, -48].map((d) => html`<span class="vtick" style=${`bottom:${toPos(d) * 100}%`}>${d}</span>`)}
    ${([] as (number | undefined)[]).concat(peaks).map((pk, i, all) => html`<div class=${cx('vmeter', all.length > 1 && (i ? 'r' : 'l'))}><i style=${`height:${toPos(pk ?? -60) * 100}%`}></i></div>`)}
    <div class="vthumb" style=${`bottom:${toPos(shown) * 100}%`}></div>
  </div>`;
}

const eqText = (v: number) => (v <= -40 ? 'kill' : db(v, false));
const hz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`);
const filterText = (v: number) => (Math.abs(v) < 0.02 ? 'off' : v < 0 ? `LP ${hz(20000 * (80 / 20000) ** -v)}` : `HP ${hz(20 * (8000 / 20) ** v)}`);
const panText = (v: number) => (Math.abs(v) < 0.02 ? 'C' : `${Math.round(Math.abs(v) * 50)}${v < 0 ? 'L' : 'R'}`);
const COLORS = ['none', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey'];
const tint = (color: string | undefined) => (Tidy.colorCss(color) ? `--clip: ${Tidy.colorCss(color)}` : '');
/** What is being dragged over the session: a clip of this show, a track header, or files from outside. */
const dragOf = (ev: DragEvent) => { const t = [...(ev.dataTransfer ? ev.dataTransfer.types : [])]; return t.includes('application/x-ec-clip') ? 'clip' : t.includes('application/x-ec-track') ? 'track' : t.includes('Files') ? 'files' : null; };
/** What a bus's strip is set to do, written for one track: the helpers every strip control uses. */
function stripOf(bus: MixBus, i: number, pending: Pending) {
  const path = (key: string) => `settings.audio.buses.${i}.${key}`;
  // a pending change marks its control; an eq band that was never set shows as the whole eq being new
  const was = (key: string) => (pending.paths.has(path(key)) ? pending.paths.get(path(key)) ?? 'at rest' : key.startsWith('eq.') && pending.paths.has(path('eq')) ? 'at rest' : undefined);
  const set = (key: string, value: unknown, commit = true) => cmd({ op: 'strip', name: bus.id, key, value, commit });
  const control = (key: string): Control => ({ was: was(key), onLive: (v) => set(key, v, false), onCommit: (v) => set(key, v), onBack: () => cmd({ op: 'unset', path: pending.paths.has(path(key)) ? path(key) : path('eq') }) });
  return { path, was, set, control };
}

// ── the session: tracks across, scenes down ─────────────────────────────

/** A sound in its slot: ▶ launches it (on the beat or the bar, if the desk is set to and music with a beat is
 *  playing), ■ stops it; a click on its name selects it for the Clip view. */
function ClipSlot({ cue, label, active, queued, length, selected, onSelect, editMode }: {
  cue: Cue; label: string; active: Playing | null; queued: boolean; length: number; selected: boolean; onSelect: () => void; editMode: boolean;
}) {
  const a = active;
  return html`<div class=${cx('clip', a && 'on', a && a.paused && 'paused', queued && 'queued', selected && 'sel')} data-clip=${cue.id} data-map=${`launch:${cue.id}`}
      style=${tint(cue.color)} onClick=${onSelect} draggable=${editMode ? 'true' : undefined}
      onDragStart=${(ev: Dragged) => { ev.dataTransfer.setData('application/x-ec-clip', cue.id); ev.dataTransfer.effectAllowed = 'move'; }}>
    <button class="launch" onClick=${(e: MouseEvent) => { e.stopPropagation(); cmd(a ? { op: 'stop', id: cue.id } : { op: 'launch', id: cue.id }); }}
      title=${a ? 'Stop' : queued ? 'Waiting for the beat. Click to call off.' : 'Launch; the playhead stays'}>${a ? '■' : '▶'}</button>
    <span class="nm">${label}</span>
    ${cue.warp && cue.tempo ? html`<span class="bpm" title=${cue.warp === 'keep' ? 'Warped, pitch kept' : 'Warped, re-pitched'}>≈</span>` : null}
    ${cue.tempo ? html`<span class="bpm" title=${cue.tempo.sections ? 'Its tempo at the start' : 'Its tempo'}>${Math.round(cue.tempo.bpm)}${cue.tempo.sections ? '…' : ''}</span>` : null}
    <span class="len">${a ? (a.loop ? `${clock(a.elapsed, 0)} ⟳` : a.total ? `−${clock(Math.max(0, (a.end || a.total) - a.elapsed), 0)}` : clock(a.elapsed, 0)) : length ? clock(length, 0) : ''}</span>
    ${a && a.total ? html`<i class="prog" style=${`width:${Math.min(100, (a.elapsed / a.total) * 100)}%`}></i>` : null}
  </div>`;
}

function MixerStrip({ s, bus, i, n, pending, selected, onSelect }: { s: State; bus: MixBus; i: number; n: number; pending: Pending; selected: boolean; onSelect: () => void }) {
  const m = s.mixer;
  const st = stripOf(bus, i, pending);
  const eq = bus.eq || {};
  const soloed = m.solo.includes(bus.id);
  const level = bus.live !== undefined ? bus.live : bus.db;
  const eqOn = !!(Number(eq.low) || Number(eq.mid) || Number(eq.high)), filterOn = Math.abs(Number(bus.filter) || 0) >= 0.02;
  return html`<div class=${cx('mstrip', selected && 'sel', (bus.mute || (m.solo.length > 0 && !soloed)) && 'silenced')} data-track=${bus.id} onClick=${onSelect}>
    <div class="mleft">
      <${Dial} label="Pan" map=${`pan:${bus.id}`} value=${Number(bus.pan) || 0} min=${-1} max=${1} step=${0.02} text=${panText} ...${st.control('pan')} />
      <button class=${cx('tbtn activator', !bus.mute && 'on')} data-map=${`mute:${bus.id}`} onClick=${(e: MouseEvent) => { e.stopPropagation(); st.set('mute', !bus.mute); }} title="Track on or off">${n}</button>
      <button class=${cx('tbtn solo', soloed && 'on')} data-map=${`solo:${bus.id}`} onClick=${(e: MouseEvent) => { e.stopPropagation(); cmd({ op: 'solo', name: bus.id, only: !(e.shiftKey || e.metaKey || e.ctrlKey) && !soloed }); }}
        title="Solo (⇧: add). Not saved.">S</button>
      <div class="xfpick" title="Crossfader side">
        ${['a', 'b'].map((side) => html`<button class=${cx(bus.xf === side && 'on')} onClick=${(e: MouseEvent) => { e.stopPropagation(); st.set('xf', bus.xf === side ? '' : side); }}>${side.toUpperCase()}</button>`)}
      </div>
    </div>
    <div class="mright">
      <${VFader} map=${`fader:${bus.id}`} value=${level} peaks=${bus.peak} onLive=${(d: number) => cmd({ op: 'bus', name: bus.id, db: d })} onCommit=${(d: number) => cmd({ op: 'bus', name: bus.id, db: d, commit: true })} />
      <div class="fval">${db(level, false)}<${Was} was=${pending.paths.get(st.path('db'))} onBack=${() => cmd({ op: 'unset', path: st.path('db') })} /></div>
      <div class="devs">${eqOn ? html`<span class="devchip" title="EQ Three is on">EQ</span>` : null}${filterOn ? html`<span class="devchip" title="Auto Filter is on">FLT</span>` : null}</div>
    </div>
  </div>`;
}

// ── the detail view ─────────────────────────────────────────────────────

/** A device, drawn as Live draws one: a titled box in the track's chain. */
const Device = ({ name, on, children }: { name: string; on: boolean; children?: unknown }) => html`<div class=${cx('device', on && 'on')}><div class="dvt"><span class=${cx('dot', on && 'go')}></span>${name}</div><div class="dvb">${children}</div></div>`;

function Devices({ s, bus, i, pending }: { s: State; bus: MixBus; i: number; pending: Pending }) {
  const st = stripOf(bus, i, pending);
  const eq: Record<string, number> = bus.eq || {};
  const band = (key: string, label: string, title: string) => {
    const v = Number(eq[key]) || 0;
    return html`<div class="band">
      <${Dial} big label=${label} map=${`eq.${key}:${bus.id}`} title=${title} value=${v} min=${-40} max=${6} text=${eqText} ...${st.control(`eq.${key}`)} />
      <button class=${cx('tbtn kill', v > -40 && 'on')} onClick=${() => st.set(`eq.${key}`, v <= -40 ? 0 : -40)} title=${v <= -40 ? 'Bring back' : 'Kill'}>${label[0]}</button>
    </div>`;
  };
  const f = Number(bus.filter) || 0;
  return html`<div class="chain" data-devices=${bus.id}>
    <div class="chain-of"><b>${bus.name}</b></div>
    <${Device} name="EQ Three" on=${!!(Number(eq.low) || Number(eq.mid) || Number(eq.high))}>
      ${band('low', 'Low', 'Below 250 Hz')}${band('mid', 'Mid', 'Around 1 kHz')}${band('high', 'High', 'Above 4 kHz')}
    <//>
    <${Device} name="Auto Filter" on=${Math.abs(f) >= 0.02}>
      <${Dial} big label="Freq" map=${`filter:${bus.id}`} title="Left: low-pass. Right: high-pass. Centre: out" value=${f} min=${-1} max=${1} step=${0.02} text=${filterText} ...${st.control('filter')} />
      <div class="ftype"><span class=${cx(f < -0.02 && 'on')}>Low-pass</span><span class=${cx(f > 0.02 && 'on')}>High-pass</span></div>
    <//>
    <${Device} name="Utility" on=${!!bus.mute || Math.abs(Number(bus.pan) || 0) >= 0.02}>
      <${Dial} big label="Pan" map=${`pan:${bus.id}`} value=${Number(bus.pan) || 0} min=${-1} max=${1} step=${0.02} text=${panText} ...${st.control('pan')} />
      <button class=${cx('tbtn mute', bus.mute && 'on')} onClick=${() => st.set('mute', !bus.mute)}>Mute</button>
    <//>
  </div>`;
}

const LOOP_SECS = [1, 2, 4, 8, 16];
const loopBeats = (bar: number): [number, string][] => [[1, '1 beat'], ...(bar > 2 ? [[2, '2 beats'] as [number, string]] : []), [bar, '1 bar'], [bar * 2, '2 bars'], [bar * 4, '4 bars']];

/** One playing sound, big enough to steer: its waveform with the bar lines, the loop lane and markers, a place to
 *  mark and skip or fade to, loops from where it is now (in beats when it has a tempo), and its own level. */
function Deck({ a, bus, cue, editMode, tall }: { a: Playing; bus: MixBus | null | undefined; cue: Partial<Cue>; editMode: boolean; tall?: boolean }) {
  const pin = usePin(a);
  const near = (x: Span | null | undefined, y: Span | null | undefined) => x && y && Math.abs(x.start - y.start) < 0.02 && Math.abs(x.end - y.end) < 0.02;
  // the tempo, the beat and the bar are those of the section the track is in now
  const tempo = sectionAt(cue.tempo, a.elapsed);
  const beat = tempo ? 60 / tempo.bpm : 0;
  // a loop made here (not one of the cue's own) is drawn in the lane with the others
  const free = [a.region, ...(a.armed || [])].filter((g): g is Span => !!g && !(a.loops || []).some((l) => near(l, g)));
  const lane = [...(a.loops || []), ...free.filter((g, i) => !free.slice(0, i).some((x) => near(x, g))).map((g) => ({ ...g, name: beat ? `${Math.round((g.end - g.start) / beat * 4) / 4} beats` : `${Math.round((g.end - g.start) * 10) / 10} s` }))];
  const looping = a.holding || (a.armed || []).length > 0;
  const loop = (len: number, inBeats: boolean) => {
    cmd({ op: 'prepare', id: a.id });
    // in beats: from the beat the track is on, so the loop is a whole number of them
    const start = Math.round((inBeats ? (tempo!.first || 0) + Math.floor((a.elapsed - (tempo!.first || 0)) / beat + 1e-6) * beat : a.elapsed) * 1000) / 1000;
    const end = Math.round((start + (inBeats ? len * beat : len)) * 1000) / 1000;
    if (start < 0 || (a.total && end > a.total)) return;
    cmd({ op: 'loop', id: a.id, region: { start, end }, free: true });
  };
  const letGo = () => { const g = a.holding ? a.region : (a.armed || [])[0]; if (g) cmd({ op: 'loop', id: a.id, region: g, free: true }); };
  const markers = (a.markers || []).slice(0, 8);
  const addMarker = () => setCue(a.id, { markers: [...(cue.markers || []), { at: Math.round(a.elapsed * 10) / 10, name: `M${(cue.markers || []).length + 1}` }].sort((x, y) => x.at - y.at) }, 'add marker');
  return html`<div class=${cx('deck', a.paused && 'paused')} data-deck=${a.id}>
    <div class="dhead">
      <span class=${cx('dot', a.paused ? 'standby' : 'go')}></span>
      <span class="chip">${bus ? bus.name : ''}</span>
      <span class="name">${a.topNumber ? a.topNumber + ' · ' : ''}${a.name}</span>
      ${tempo ? html`<span class="chip">${bpmText(tempo.bpm * (a.rate || 1))} bpm${tempo.bar !== 4 ? ` · ${tempo.bar} in a bar` : ''}</span>` : null}
      ${a.rate && a.rate !== 1 ? html`<span class="chip" title=${`Its own tempo: ${tempo ? bpmText(tempo.bpm) : '—'}${a.stretched ? '. Pitch kept: cannot loop' : ''}`}>≈ ×${a.rate.toFixed(2)}</span>` : null}
      ${a.holding ? html`<span class="chip warn">⟳ LOOPING</span>` : null}
      <span class="grow"></span>
      <span class="t">${clock(a.elapsed)} <span class="dim">/ ${a.total ? clock(a.total) : '—'}</span></span>
      <button class="btn small" onClick=${() => cmd({ op: 'toggle', id: a.id })}>${a.paused ? 'Resume' : 'Pause'}</button>
      <button class="btn small" onClick=${() => cmd({ op: 'stop', id: a.id })}>Stop</button>
    </div>
    <div class="dbody">
      <div class="dwave">
        <${Waveform} small=${!tall} tall=${tall} file=${a.file} duration=${a.total} position=${a.elapsed} markers=${a.markers || []} loops=${lane} active=${a} from=${0} cutAt=${cue.cutAt} pin=${pin.t}
          bars=${barsOf(cue.tempo, a.total)} onSeek=${pin.place} onLoop=${(g: Span) => cmd({ op: 'loop', id: a.id, region: g, free: true })} />
        <div class="dctl">
          <span class="lbl">Loop</span>
          ${looping ? html`<button class="btn small standby" onClick=${letGo} title="Plays this pass out">Let go</button>`
            : tempo ? loopBeats(tempo.bar).map(([n, name]) => html`<button class="btn small" disabled=${!!a.stretched} onClick=${() => loop(n, true)} title=${a.stretched ? 'Keeping its pitch, it cannot loop' : `Loop ${name} from here`}>${name}</button>`)
            : LOOP_SECS.map((n) => html`<button class="btn small" disabled=${!!a.stretched} onClick=${() => loop(n, false)} title=${`Loop ${n} s from here`}>${n} s</button>`)}
          <span class="sep"></span>
          <span class="lbl">Places</span>
          ${markers.map((mk) => html`<button class="btn small" onClick=${(e: MouseEvent) => cmd(e.shiftKey ? { op: 'fadeto', id: a.id, t: mk.at, secs: 1.5 } : { op: 'seek', id: a.id, t: mk.at })} title=${`Skip to ${clock(mk.at)} (⇧: crossfade)`}>${mk.name}</button>`)}
          ${editMode && cue.id ? html`<button class="btn ghost small" onClick=${addMarker} title="Keep a marker where it is now">+ here</button>` : null}
          <span class="grow"></span>
          <${PinControls} a=${a} pin=${pin} />
        </div>
      </div>
      <${Dial} big label="Level" title="This playing only" value=${Math.max(-60, Math.round((a.fadingTo != null ? a.fadingTo : a.db!) * 2) / 2)} min=${-60} max=${12} rest=${0} text=${(v: number) => db(v, false)}
        onLive=${(v: number) => cmd({ op: 'level', id: a.id, db: v })} onCommit=${(v: number) => cmd({ op: 'level', id: a.id, db: v })} />
    </div>
  </div>`;
}

const BARS = [2, 3, 4, 5, 6, 7, 9, 12];

/** The Clip view: the selected sound. On the left its box (what it is, its tempo); on the right its waveform.
 *  A tempo is edited a section at a time: the section where the track is now, or, when it is not playing, where
 *  the waveform was last clicked. */
function ClipView({ s, cue, bus, active, length, editMode, say, desk }: {
  s: State; cue: Cue; bus: MixBus | undefined; active: Playing | null; length: number; editMode: boolean; say: Say; desk: number;
}) {
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Reading | null>(null);           // what the last look found in this file (its other readings)
  const [typed, setTyped] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);            // the place the tempo controls act at, when the sound is not playing
  useEffect(() => { setFound(null); setTyped(null); setCursor(0); cmd({ op: 'tempo-of', file: cue.file }).then((r) => { if (r && r.known) setFound(r.tempo || { none: true }); }); }, [cue.id, cue.file]);
  const tempo = cue.tempo || null;
  const at = active ? active.elapsed : cursor;
  const sec = sectionAt(tempo, at), all = sectionsOf(tempo);
  const setTempo = (t: Partial<Tempo> | null, label = 'tempo') => setCue(cue.id, { tempo: t }, label);
  const editAt = async (e: Omit<TempoEdit, 'at'>) => { const r = await cmd({ op: 'tempo-edit', id: cue.id, edit: { ...e, at } }); if (r && r.error) say(r.error, true); };
  const find = async (again: boolean) => {
    setBusy(true);
    const r = await cmd({ op: 'tempo-find', ids: [cue.id], again });
    setBusy(false);
    if (!r || r.error) return;
    const got: Reading | undefined = r.results[cue.id];
    setFound(got || { none: true });
    const changes = got && got.sections ? got.sections.length : 0;
    say(r.found ? `${cue.name || 'This sound'}: ${bpmText(got!.bpm!)} bpm${changes ? `, and ${changes} change${changes === 1 ? '' : 's'} of tempo` : ''}` : got ? `No steady tempo found (the nearest reading, ${bpmText(got.bpm!)}, is not a firm one)` : 'No tempo found in this sound', !r.found);
  };
  const others = found && !found.none ? [found, ...(found.others || [])].filter((o) => !tempo || Math.abs(o.bpm! - tempo.bpm) > 0.3) : [];
  const commitTyped = () => {
    const b = Number(typed), text = typed; setTyped(null);
    if (b >= 20 && b <= 400) { if (tempo) editAt({ do: 'set', bpm: b }); else setTempo({ bpm: b, first: 0, bar: 4 }); }
    else if (text !== null && text.trim() !== '') say('A tempo is 20 to 400 beats a minute', true);
  };
  const where = active ? 'where it is now' : `at ${clock(cursor)}`;
  const rate = tempo && cue.warp && desk ? desk / (sec || tempo).bpm : 0;
  return html`<div class="clipview" data-clipview=${cue.id}>
    <div class="clipbox" style=${tint(cue.color)}>
      <div class="cbt">${cue.number ? `${cue.number} · ` : ''}${s.labels[cue.id] || cue.name}</div>
      <div class="cbrow dim">${(cue.file || '').split('/').pop()} · ${length ? clock(length) : 'length not known'} · ${bus ? bus.name : ''}${tempo && tempo.confidence != null ? html` · <span title="How sure, 0 to 1">heard ${tempo.confidence}</span>` : null}</div>
      <div class="cbrow tempo">
        <span class="lbl">Tempo</span>
        <input class="mono bpmfield" type="text" disabled=${!editMode} placeholder="—" value=${typed !== null ? typed : sec ? bpmText(sec.bpm) : ''}
          onInput=${(e: Typed) => setTyped(e.target.value)} onBlur=${commitTyped} onKeyDown=${(e: Keyed) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setTyped(null); e.target.blur(); } }} title=${all.length > 1 ? `Beats a minute, ${where}` : 'Beats a minute'} />
        <span class="dim">bpm</span>
        <button class="btn small" disabled=${!editMode || !tempo} onClick=${() => editAt({ do: 'set', bpm: sec!.bpm / 2 })} title="Half time">÷2</button>
        <button class="btn small" disabled=${!editMode || !tempo} onClick=${() => editAt({ do: 'set', bpm: sec!.bpm * 2 })} title="Double time">×2</button>
        <button class=${cx('btn small', !tempo && 'primary')} disabled=${!editMode || busy} onClick=${() => find(!!tempo || !!found)} title="Listen for its beat and tempo changes">${busy ? 'Listening…' : tempo || found ? 'Find again' : 'Find tempo'}</button>
      </div>
      ${others.length > 0 ? html`<div class="cbrow"><span class="lbl">${tempo ? 'Or' : 'Could be'}</span>
        ${others.slice(0, 4).map((o) => html`<button class="btn small" disabled=${!editMode} onClick=${() => setTempo({ bpm: o.bpm, first: o.first, bar: 4 })} title="Use this reading">${bpmText(o.bpm!)}</button>`)}</div>` : null}
      ${found && found.none && !tempo ? html`<div class="cbrow dim">No steady pulse found.</div>` : null}
      ${tempo ? html`<div class="cbrow">
        <span class="lbl">Bar</span>
        <select class="barsel" disabled=${!editMode} value=${String(sec!.bar)} onChange=${(e: Typed) => editAt({ do: 'set', bar: Number(e.target.value) })} title="Beats in a bar">
          ${[...new Set([...BARS, sec!.bar])].sort((x, y) => x - y).map((n) => html`<option value=${String(n)}>${n} beats</option>`)}</select>
        <button class="btn small" data-one disabled=${!editMode} onClick=${() => editAt({ do: 'one' })} title=${`The beat nearest ${where} is beat one of a bar`}>1 is here</button>
        <button class="btn small" disabled=${!editMode} onClick=${() => editAt({ do: 'nudge', by: -0.01 })} title="Bar lines 10 ms earlier">◀</button>
        <button class="btn small" disabled=${!editMode} onClick=${() => editAt({ do: 'nudge', by: 0.01 })} title="Bar lines 10 ms later">▶</button>
      </div>
      <div class="cbrow sections">
        <span class="lbl">Changes</span>
        ${all.map((x, i) => html`<button class=${cx('btn small secchip', sec!.index === i && 'on')} onClick=${() => { if (active) cmd({ op: 'seek', id: cue.id, t: x.from }); else setCursor(x.from); }} title=${`From ${clock(x.from)}: ${bpmText(x.bpm)} bpm, ${x.bar} in a bar`}>${all.length > 1 ? `${clock(x.from, 0)} ` : ''}${bpmText(x.bpm)}${x.bar !== 4 ? ` · ${x.bar}` : ''}</button>`)}
        <button class="btn small" data-split disabled=${!editMode} onClick=${() => editAt({ do: 'split' })} title=${`A tempo change on the beat nearest ${where}`}>+ here</button>
        ${sec!.index > 0 ? html`<button class="btn ghost small" disabled=${!editMode} onClick=${() => editAt({ do: 'join' })} title="Remove this change">Remove</button>` : null}
        <button class="btn ghost small" disabled=${!editMode} onClick=${() => setTempo(null, 'no tempo')} title="Forget its tempo">Clear</button>
      </div>
      <div class="cbrow">
        <span class="lbl">Warp</span>
        <select class="warpsel" disabled=${!editMode} value=${cue.warp || ''} onChange=${(e: Typed) => setCue(cue.id, { warp: e.target.value || null }, 'warp')} title="At the desk’s tempo, from its next launch. Keep pitch cannot loop a section.">
          <option value="">Off: its own tempo</option><option value="repitch">Re-pitch</option><option value="keep">Keep pitch</option></select>
        ${cue.warp ? html`<span class="dim">${rate ? (rate >= 0.5 && rate <= 2 ? `×${rate.toFixed(2)} at ${bpmText(desk)}` : `${bpmText(desk)} is too far: plays as it is`) : 'no desk tempo: plays as it is'}</span>` : null}
      </div>` : null}
    </div>
    <div class="clipwave">
      ${active ? html`<${Deck} a=${active} bus=${bus} cue=${cue} editMode=${editMode} tall />`
        : html`<div class="deck"><div class="dhead"><span class="dot"></span><span class="name">${s.labels[cue.id] || cue.name}</span><span class="grow"></span>
            <button class="btn small go" onClick=${() => cmd({ op: 'launch', id: cue.id })}>▶ Launch</button></div>
          <${Waveform} tall file=${cue.file} duration=${length} position=${tempo ? cursor : null} markers=${cue.markers || []} loops=${cue.loops || []} from=${cue.from || 0} cutAt=${cue.cutAt} bars=${barsOf(tempo, length)} onSeek=${tempo ? (t: number) => setCursor(Math.round(t * 100) / 100) : undefined} /></div>`}
    </div>
  </div>`;
}

/** A track's header: click selects it (its devices show below). In Edit: double-click renames it, the swatch
 *  gives it a colour, and it drags onto another header to change the order of the tracks. */
function TrackHead({ bus, i, n, selected, editMode, onSelect, onMove }: {
  bus: MixBus; i: number; n: number; selected: boolean; editMode: boolean; onSelect: () => void; onMove: (id: string, onto: string) => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const set = (key: string, value: unknown, label: string) => cmd({ op: 'edit', ops: [{ op: 'show.set', path: `settings.audio.buses.${i}.${key}`, value }], label });
  const commit = () => { const v = (name || '').trim(); setName(null); if (v && v !== bus.name) set('name', v, 'rename track'); };
  const next = () => set('color', COLORS[(COLORS.indexOf(bus.color || 'none') + 1) % COLORS.length] === 'none' ? undefined : COLORS[(COLORS.indexOf(bus.color || 'none') + 1) % COLORS.length], 'track colour');
  if (name !== null) return html`<div class="th naming"><span class="tn">${n}</span><input class="thname" value=${name} ref=${(el: HTMLInputElement | null) => el && document.activeElement !== el && (el.focus(), el.select())}
    onInput=${(e: Typed) => setName(e.target.value)} onBlur=${commit} onKeyDown=${(e: KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') setName(null); }} /></div>`;
  return html`<button class=${cx('th', selected && 'sel', over && 'dropping', bus.color && 'tinted')} data-th=${bus.id} style=${tint(bus.color)} onClick=${onSelect} onDblClick=${() => editMode && setName(bus.name)}
      draggable=${editMode ? 'true' : undefined} onDragStart=${(ev: Dragged) => { ev.dataTransfer.setData('application/x-ec-track', bus.id); ev.dataTransfer.effectAllowed = 'move'; }}
      onDragOver=${(ev: DragEvent) => { if (dragOf(ev) === 'track') { ev.preventDefault(); setOver(true); } }} onDragLeave=${() => setOver(false)}
      onDrop=${(ev: Dragged) => { setOver(false); const id = ev.dataTransfer.getData('application/x-ec-track'); if (id) { ev.preventDefault(); onMove(id, bus.id); } }}
      title=${editMode ? 'Double-click: rename. Drag: reorder.' : ''}>
    <span class="tn">${n}</span><span class="tname">${bus.name}</span>${bus.live !== undefined || bus.liveStrip ? html`<span class="dim" title="Moved from the show’s level. Reset puts it back."> ·mix</span>` : null}
    ${editMode ? html`<span class="swatch" data-swatch onClick=${(e: MouseEvent) => { e.stopPropagation(); next(); }} onDblClick=${(e: MouseEvent) => e.stopPropagation()} title="Colour"></span>` : null}
  </button>`;
}

export function Live({ s, list, byId, pending, editMode, say }: { s: State; list: CueList | null; byId: CueIndex; pending: Pending; editMode: boolean; say: Say }) {
  const m = s.mixer, e = s.engine, live = s.live || { quantise: 'bar', queued: [], clock: null, map: [] };
  const [selTrack, setSelTrack] = useState<string | null>(null);
  const [selClip, setSelClip] = useState<string | null>(null);
  const [detail, setDetail] = useState<'clip' | 'devices' | 'decks'>('decks');      // 'clip' | 'devices' | 'decks'
  const [allScenes, setAllScenes] = useState(false);
  const [finding, setFinding] = useState(false);
  const [mapping, setMapping] = useState(false);      // Map mode: a click chooses a control, the next key or MIDI control is given to it
  const [mapSel, setMapSel] = useState<string | null>(null);
  const [deskTyped, setDeskTyped] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);         // the slot a clip or a file is being dragged over
  const root = useRef<HTMLDivElement>(null);
  const buses: MixBus[] = m.buses;
  const ids = buses.map((b) => b.id);
  // where a cue with no bus (or one that is gone) plays: as the engine decides it (core/show/show.js)
  const busOf = (cue: Partial<Cue>) => (typeof cue.bus === 'string' && ids.includes(cue.bus) ? cue.bus : ids[ids.length > 1 ? 1 : 0]);
  const audio: Playing[] = e.active.filter((a) => a.kind === 'audio');
  const activeOf = (id: string) => audio.find((a) => a.id === id) || null;
  const lengthOf = (cue: Cue): number => (e.durations ? e.durations[cue.file!] : 0) || 0;
  // a scene is one cue of the list (one GO); its sounds, wherever they are inside it, sit in their tracks' slots
  const scenes: Scene[] = (list ? list.cues : []).map((top) => {
    const slots = new Map(ids.map((id) => [id, [] as Cue[]]));
    const walk = (c: Cue) => { if (c.type === 'audio') slots.get(busOf(c))!.push(c); for (const k of c.children || []) walk(k); };
    walk(top);
    return { cue: top, slots, sounds: [...slots.values()].reduce((n, x) => n + x.length, 0) };
  });
  const shown = allScenes ? scenes : scenes.filter((sc) => sc.sounds > 0);
  const hidden = scenes.length - scenes.filter((sc) => sc.sounds > 0).length;
  const stopTrack = (id: string) => cmd({ op: 'stop-track', name: id });
  const pickClip = (cue: Cue) => { setSelClip(cue.id); setSelTrack(busOf(cue)); setDetail('clip'); };
  const pickTrack = (id: string) => { setSelTrack(id); setDetail('devices'); };
  const clipCue = selClip && byId.get(selClip) ? byId.get(selClip)!.cue : null;
  const trackI = Math.max(0, ids.indexOf(selTrack!));
  const order = new Map<string | undefined, number>(ids.map((id, i) => [id, i]));
  const decks = audio.map((a) => ({ a, cue: (byId.get(a.id) || { cue: null }).cue || {} })).map((d) => ({ ...d, bus: buses.find((b) => b.id === busOf(d.cue)) }))
    .sort((x, y) => (order.get(x.bus && x.bus.id) ?? 99) - (order.get(y.bus && y.bus.id) ?? 99));
  const noTempo = [...byId.values()].filter((x) => x.cue.type === 'audio' && x.cue.file && !x.cue.tempo).length;
  const findAll = async () => {
    setFinding(true);
    const r = await cmd({ op: 'tempo-find' });
    setFinding(false);
    if (r && !r.error) say(r.looked ? `Tempo found in ${r.found} of ${r.looked} sounds${r.found < r.looked ? ' (the others have no steady pulse)' : ''}` : 'Every sound already has a tempo');
  };
  const [drag, setDrag] = useState<number | null>(null);
  const xf = drag !== null ? drag : m.crossfader;
  const sideNames = (side: string) => buses.filter((b) => b.xf === side).map((b) => b.name).join(', ');
  const xfUsed = buses.some((b) => b.xf === 'a' || b.xf === 'b');
  const lv: { peak: number; rms: number }[] = m.level || [];
  const cols = `--cols: repeat(${ids.length}, minmax(150px, 1fr)) 200px`;
  const desk = live.tempo || (live.clock ? live.clock.bpm : 0);
  const per = live.clock ? live.clock.per || 4 : 4;

  // ── dragging: a clip to another track (or scene), a file into a slot, a track header onto another ──
  const moveTrack = (id: string, onto: string) => {
    if (id === onto) return;
    const doc = s.doc.settings.audio.buses, from = doc.findIndex((b) => b.id === id), to = doc.findIndex((b) => b.id === onto);
    if (from < 0 || to < 0) return;
    const next = doc.slice(); next.splice(to, 0, next.splice(from, 1)[0]);
    cmd({ op: 'edit', ops: [{ op: 'show.set', path: 'settings.audio.buses', value: next }], label: 'reorder tracks' });
  };
  /** Where in the list a sound dropped on a scene's slot goes: into the scene when it is a group, else just after it. */
  const placeIn = (sc: Scene | null) => (!sc ? {} : sc.cue.type === 'group' ? { parent: sc.cue.id } : { after: sc.cue.id });
  const dropOn = async (ev: Dragged, bus: string, sc: Scene | null) => {
    const kind = dragOf(ev);
    setDropAt(null);
    if (!editMode || !(kind === 'clip' || kind === 'files')) return;
    ev.preventDefault();
    if (kind === 'files') {
      const paths = [...ev.dataTransfer.files].map((f) => ec.pathFor(f)).filter(Boolean);
      const r = paths.length ? await cmd({ op: 'import', paths, bus, ...placeIn(sc) }) : null;
      if (r && r.error) say(r.error, true);
      return;
    }
    const id = ev.dataTransfer.getData('application/x-ec-clip'), found = byId.get(id);
    if (!found) return;
    const home = scenes.find((x) => [...x.slots.values()].some((l) => l.some((c) => c.id === id)));
    const ops: Op[] = [];
    if (busOf(found.cue) !== bus) ops.push({ op: 'cue.set', id, props: { bus } });
    if (sc && home && sc.cue.id !== home.cue.id && sc.cue.id !== id) ops.push({ op: 'cue.move', ids: [id], ...placeIn(sc) });
    if (ops.length) { const r = await cmd({ op: 'edit', ops, label: 'move clip' }); if (r && r.error) say(r.error, true); }
  };
  const slotDrag = (bus: string, sc: Scene | null) => ({
    onDragOver: (ev: DragEvent) => { const k = dragOf(ev); if (editMode && (k === 'clip' || k === 'files')) { ev.preventDefault(); const key = `${sc ? sc.cue.id : ''}:${bus}`; if (dropAt !== key) setDropAt(key); } },
    onDragLeave: (ev: DragEvent) => { if (ev.currentTarget === ev.target) setDropAt(null); },
    onDrop: (ev: Dragged) => dropOn(ev, bus, sc),
  });
  const dropping = (bus: string, sc: Scene | null) => dropAt === `${sc ? sc.cue.id : ''}:${bus}` && 'dropping';

  // ── Map mode, and the keys that are mapped ──
  const mapOf = (to: string | null) => (live.map || []).filter((x: DeskMapping) => x.to === to).map((x: DeskMapping) => x.on.replace(/^key /, '').replace(/ ch 1$/, '')).join(' · ');
  useEffect(() => {
    // each control that can be mapped says what it is mapped to (drawn by the stylesheet, only in Map mode)
    if (!root.current) return;
    for (const el of root.current.querySelectorAll('[data-map]')) {
      const to = el.getAttribute('data-map'), tag = mapping ? mapOf(to) : '';
      if (tag) el.setAttribute('data-maptag', tag); else el.removeAttribute('data-maptag');
      if (mapping && mapSel === to) el.setAttribute('data-mapsel', ''); else el.removeAttribute('data-mapsel');
    }
  });
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.repeat) return;
      const t = ev.target as HTMLElement | null, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing || document.querySelector('.settings, .modal')) return;
      const k = String(ev.key || '').toLowerCase();
      if (mapping) {
        if (!mapSel || k === ' ' || k === 'escape') return;
        ev.preventDefault(); ev.stopPropagation();
        if (k === 'backspace' || k === 'delete') { cmd({ op: 'map-learn-cancel' }); cmd({ op: 'map-set', on: null, to: mapSel }); return; }
        cmd({ op: 'map-learn-cancel' });
        cmd({ op: 'map-set', on: `key ${k}`, to: mapSel }).then((r) => { if (r && r.error) say(`That key cannot be mapped (Space, Esc, Enter, [ and ] are the app’s)`, true); });
        return;
      }
      if ((live.map || []).some((x: DeskMapping) => x.on === `key ${k}`)) { ev.preventDefault(); ev.stopPropagation(); cmd({ op: 'map-in', on: `key ${k}` }).then((r) => { if (r && r.error) say(r.error, true); }); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  useEffect(() => () => { cmd({ op: 'map-learn-cancel' }); }, []);
  const pickMap = (ev: Event & { target: Element }) => {
    if (!mapping) return;
    const el = ev.target.closest && ev.target.closest('[data-map]');
    if (ev.target.closest && ev.target.closest('[data-mapbar]')) return;
    ev.preventDefault(); ev.stopPropagation();
    if (!el || ev.type !== 'click') return;
    const to = el.getAttribute('data-map')!;
    setMapSel(to);
    // the next MIDI control moved is given to it (a key is caught above)
    cmd({ op: 'map-learn', to }).then((r) => { if (r && r.error) say(r.error, true); });
  };
  const leaveMap = () => { setMapping(false); setMapSel(null); cmd({ op: 'map-learn-cancel' }); };
  const commitDesk = () => { const text = deskTyped; setDeskTyped(null); if (text === null) return; const b = Number(text); if (text.trim() === '' || b === 0) cmd({ op: 'live-set', key: 'tempo', value: 0 }); else if (b >= 20 && b <= 400) cmd({ op: 'live-set', key: 'tempo', value: b }); else say('A tempo is 20 to 400 bpm', true); };
  const keep = async () => { const r = await cmd({ op: 'desk-keep' }); if (r && r.error) say(r.error, true); else say('Kept in a new Mix cue, after the one standing by'); };

  return html`<div class=${cx('desk', mapping && 'mapping')} style=${cols} ref=${root} onClickCapture=${pickMap} onPointerDownCapture=${pickMap} onDblClickCapture=${pickMap}>
    <div class="lbar">
      <span class="tempo" title=${live.tempo ? 'Set by hand. Empty: follow the music.' : live.clock ? `The tempo of ${live.clock.name}` : 'The desk’s tempo'}>
        <input class=${cx('mono desktempo', live.tempo && 'set')} type="text" placeholder="—" value=${deskTyped !== null ? deskTyped : desk ? bpmText(desk) : ''}
          onInput=${(ev: Typed) => setDeskTyped(ev.target.value)} onBlur=${commitDesk} onKeyDown=${(ev: Keyed) => { ev.stopPropagation(); if (ev.key === 'Enter') ev.target.blur(); if (ev.key === 'Escape') { setDeskTyped(null); ev.target.blur(); } }} /><small>${live.tempo ? 'bpm set' : 'bpm'}</small></span>
      <span class=${cx('pos', live.clock && 'on')} title="Bar and beat of the music playing">${live.clock ? `${live.clock.bar}.${live.clock.beat}` : '–.–'}</span>
      <span class="beats" title=${`${per} beats in a bar`}>${Array.from({ length: Math.min(12, per) }, (_, i) => i + 1).map((b) => html`<i class=${cx(live.clock && live.clock.beat === b && 'on', b === 1 && 'one')}></i>`)}</span>
      <label title="Launches wait for the next beat or bar">Quantise
        <select value=${live.quantise} onChange=${(ev: Typed) => cmd({ op: 'launch-q', q: ev.target.value })}><option value="none">None</option><option value="beat">1 Beat</option><option value="bar">1 Bar</option></select></label>
      <label class="check" title="A launch takes over its track. A GO never stops anything.">
        <input type="checkbox" data-overlap checked=${!live.overlap} disabled=${!editMode} onChange=${(ev: Typed) => cmd({ op: 'live-set', key: 'overlap', value: !ev.target.checked })} />One clip per track</label>
      <span class="grow"></span>
      <span data-mapbar class="mapbar">
        ${mapping ? html`<span class="maphint">${mapSel ? html`<b>${mapSel.replace(/^launch:.*/, 'this clip').replace(':', ' · ')}</b>: press a key or move a control${s.midi && !s.midi.inputs.length && !s.midi.test ? ' (no MIDI input)' : ''}. ⌫ unmaps.` : 'Click a control to map it.'}</span>` : null}
        <button class=${cx('btn small', mapping && 'on standby')} data-mapbtn disabled=${!editMode && !mapping} onClick=${() => (mapping ? leaveMap() : setMapping(true))} title="Keys and MIDI controls for the desk. They never change the show.">${mapping ? 'Done mapping' : `Map${(live.map || []).length ? ` · ${live.map.length}` : ''}`}</button>
      </span>
      ${hidden > 0 || allScenes ? html`<button class=${cx('btn small ghost', allScenes && 'on')} onClick=${() => setAllScenes(!allScenes)}>${allScenes ? 'Hide' : 'Show'} ${hidden} without sound</button>` : null}
      <button class="btn small" disabled=${!editMode || finding || !noTempo} onClick=${findAll} title="Listen to every sound with no tempo yet">${finding ? 'Listening…' : noTempo ? `Find tempos (${noTempo})` : 'Tempos found'}</button>
    </div>

    <div class="session">
      <div class="shead">
        ${buses.map((b, i) => html`<${TrackHead} key=${b.id} bus=${b} i=${i} n=${i + 1} selected=${selTrack === b.id} editMode=${editMode && !mapping} onSelect=${() => pickTrack(b.id)} onMove=${moveTrack} />`)}
        <div class="th master">Master</div>
      </div>
      <div class="slots">
        ${shown.map((sc) => html`<div class=${cx('scene', e.playhead === sc.cue.id && 'head', audio.some((a) => a.id === sc.cue.id || a.parent === sc.cue.id) && 'running')} key=${sc.cue.id} data-scene=${sc.cue.id}>
          ${ids.map((id) => html`<div class=${cx('slot', dropping(id, sc))} data-slot=${id} ...${slotDrag(id, sc)}>
            ${sc.slots.get(id)!.map((c) => html`<${ClipSlot} key=${c.id} cue=${c} label=${s.labels[c.id] || c.name} active=${activeOf(c.id)} queued=${live.queued.includes(c.id) || live.queued.includes(sc.cue.id)} length=${lengthOf(c)} selected=${selClip === c.id} onSelect=${() => pickClip(c)} editMode=${editMode && !mapping} />`)}
            ${sc.slots.get(id)!.length === 0 ? html`<button class="stopslot" onClick=${() => stopTrack(id)} title="Stop this track">■</button>` : null}
          </div>`)}
          <div class="slot scenecell">
            <button class="launch" data-map=${`launch:${sc.cue.id}`} onClick=${() => cmd({ op: 'launch', id: sc.cue.id })} title="Launch this scene; the playhead stays">▶</button>
            <button class="sname" onClick=${() => cmd({ op: 'playhead', id: sc.cue.id })} title="Stand by on it"><span class="cn">${sc.cue.number || ''}</span>${s.labels[sc.cue.id] || sc.cue.name}</button>
          </div>
        </div>`)}
        ${shown.length === 0 ? html`<div class="nothing">No sounds yet. Drop files on a track below.</div>` : null}
      </div>
      <div class="stops">
        ${buses.map((b) => html`<div class=${cx('slot', dropping(b.id, null))} data-slot=${b.id} ...${slotDrag(b.id, null)}><button class="stopslot big" data-map=${`stop:${b.id}`} onClick=${() => stopTrack(b.id)} title="Stop this track">■</button>
          ${editMode ? html`<button class="btn ghost small" onClick=${() => ec.app({ op: 'import', bus: b.id })} title="Add sound files to this track">+ Sounds</button>` : null}</div>`)}
        <div class="slot scenecell"><button class="stopslot big" data-map="stopall" onClick=${() => cmd({ op: 'stop-clips' })} title="Stop every sound">■</button><span class="dim">Stop All Clips</span></div>
      </div>
      <div class="mixer">
        ${buses.map((b, i) => html`<${MixerStrip} key=${b.id} s=${s} bus=${b} i=${i} n=${i + 1} pending=${pending} selected=${selTrack === b.id} onSelect=${() => setSelTrack(b.id)} />`)}
        <div class="mstrip master" data-track="master">
          <div class="mleft">
            <span class=${cx('limit', m.limiting && 'on')} title="The limiter is working">LIMIT</span>
            <button class="tbtn" onClick=${() => cmd({ op: 'fadeall', secs: 5 })} title="Fade everything out over 5 s">Fade all</button>
            <button class="tbtn" data-keepdesk disabled=${!editMode} onClick=${keep} title="Keep the whole desk in a new Mix cue">Keep desk</button>
            <button class=${cx('tbtn solo', m.solo.length > 0 && 'on')} style=${m.solo.length > 0 ? '' : 'visibility:hidden'} onClick=${() => cmd({ op: 'solo', name: null })}>Solo off</button>
          </div>
          <div class="mright">
            <${VFader} map="master" value=${m.masterDb} peaks=${[lv[0] ? lv[0].rms : -60, lv[1] ? lv[1].rms : -60]} onLive=${(d: number) => cmd({ op: 'master', db: d })} onCommit=${(d: number) => cmd({ op: 'master', db: d, commit: true })} />
            <div class="fval">${db(m.masterDb, false)}<${Was} was=${pending.paths.get('settings.audio.masterDb')} onBack=${() => cmd({ op: 'unset', path: 'settings.audio.masterDb' })} /></div>
          </div>
        </div>
      </div>
    </div>

    <div class=${cx('xfader', !xfUsed && 'unused')}>
      <span class="xside a">${sideNames('a') || html`<span class="dim">no track</span>`} <b>A</b></span>
      <span class="xrail" data-map="crossfader"><input type="range" min="-1" max="1" step="0.01" value=${xf} title="Double-click: centre"
        onInput=${(ev: Typed) => { const v = Number(ev.target.value); setDrag(v); cmd({ op: 'crossfader', value: v }); }}
        onChange=${(ev: Typed) => { setDrag(null); cmd({ op: 'crossfader', value: Number(ev.target.value), commit: true }); }}
        onDblClick=${() => { setDrag(null); cmd({ op: 'crossfader', value: 0, commit: true }); }} /></span>
      <span class="xside b"><b>B</b> ${sideNames('b') || html`<span class="dim">no track</span>`}</span>
      <span class="xtail">${pending.paths.has('settings.audio.crossfader') ? html`<${Was} was=${pending.paths.get('settings.audio.crossfader') ?? 'centre'} onBack=${() => cmd({ op: 'unset', path: 'settings.audio.crossfader' })} />` : null}
        ${!xfUsed ? html`<span class="dim hint">Put tracks on A and B to use it.</span>` : null}</span>
    </div>

    <div class="detail">
      <div class="dtabs">
        <button class=${cx(detail === 'clip' && 'on')} onClick=${() => setDetail('clip')}>Clip</button>
        <button class=${cx(detail === 'devices' && 'on')} onClick=${() => setDetail('devices')}>Devices</button>
        <button class=${cx(detail === 'decks' && 'on')} onClick=${() => setDetail('decks')}>Decks${decks.length ? ` · ${decks.length}` : ''}</button>
      </div>
      <div class="dview">
        ${detail === 'clip' ? (clipCue ? html`<${ClipView} key=${clipCue.id} s=${s} cue=${clipCue} bus=${buses.find((b) => b.id === busOf(clipCue))} active=${activeOf(clipCue.id)} length=${lengthOf(clipCue)} editMode=${editMode} say=${say} desk=${desk} />`
          : html`<div class="nothing">Click a sound above.</div>`) : null}
        ${detail === 'devices' ? html`<${Devices} s=${s} bus=${buses[trackI]} i=${trackI} pending=${pending} />` : null}
        ${detail === 'decks' ? html`${decks.length === 0 ? html`<div class="nothing">Nothing playing. <span class="kbd">Space</span> to GO.</div>` : null}
          ${decks.map((d) => html`<${Deck} key=${d.a.id} a=${d.a} bus=${d.bus} cue=${d.cue} editMode=${editMode} />`)}` : null}
      </div>
    </div>
  </div>`;
}
