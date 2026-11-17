// What is happening now: the waveform of what is playing (with its markers and loop lane), Active Cues, and the mixer.
import { html, useState, useEffect, useRef, cmd, edit, setCue, clock, db, cx } from './lib.js';
import * as Lanes from '../../core/audio/lanes.js';
import { bpmText, sectionAt, barsOf, barBeatAt, nearestBar, loopFromHere } from './Tempo.js';
import { DialFace } from './Knob.js';

const peaksCache = new Map();        // file -> { peaks, rms } (null: none to be had)

/** A sound drawn as loudness (RMS) inside its peaks, with a cursor, markers and — above it — the loop lane. */
export function Waveform({ file, duration, position, markers = [], loops = [], active, from = 0, cutAt, onSeek, onLoop, small, pin = null, bars = [], tall, envelope = null }) {
  const canvas = useRef(), box = useRef();
  const [data, setData] = useState(peaksCache.get(file));
  const [width, setWidth] = useState(0);
  useEffect(() => {
    let alive = true, tries = 0;
    setData(peaksCache.get(file));
    if (!file || peaksCache.has(file)) return undefined;
    const ask = async () => {
      const r = await window.ec.cmd({ op: 'peaks', file });
      if (!alive) return;
      if (r && r.pending && tries++ < 40) { setTimeout(ask, 300); return; }
      const got = r && r.peaks ? { peaks: r.peaks, rms: r.rms } : null;
      peaksCache.set(file, got); setData(got);
    };
    ask();
    return () => { alive = false; };
  }, [file]);
  useEffect(() => {
    const ro = new ResizeObserver(() => setWidth(box.current ? box.current.clientWidth : 0));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !width) return;
    const dpr = window.devicePixelRatio || 1, h = c.clientHeight;
    c.width = Math.round(width * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, h);
    const css = getComputedStyle(document.documentElement);
    const mid = h / 2;
    g.fillStyle = css.getPropertyValue('--line'); g.fillRect(0, mid, width, 1);
    if (!data) return;
    const n = data.peaks.length;
    const played = duration > 0 && position != null ? (position / duration) * width : -1;
    const go = css.getPropertyValue('--go');
    for (const [arr, a] of [[data.peaks, css.getPropertyValue('--bg-4')], [data.rms || data.peaks, css.getPropertyValue('--text-2')]]) {
      const isRms = arr !== data.peaks || !data.rms;
      for (let x = 0; x < width; x++) {
        const v = arr[Math.min(n - 1, Math.floor((x / width) * n))] || 0;
        const y = Math.max(0.5, v * (mid - 3));
        g.fillStyle = x < played ? go : a;
        g.globalAlpha = x < played ? (isRms ? 0.95 : 0.35) : 1;
        g.fillRect(x, mid - y, 1, y * 2);
      }
    }
    g.globalAlpha = 1;
    // outside the part that plays (before Start at, after End at): dimmed
    g.fillStyle = 'rgba(8,9,10,.62)';
    if (duration > 0 && from > 0) g.fillRect(0, 0, (from / duration) * width, h);
    if (duration > 0 && cutAt > 0 && cutAt < duration) g.fillRect((cutAt / duration) * width, 0, width, h);
  }, [data, width, duration, Math.round((position || 0) * 4), from, cutAt]);

  const pct = (t) => (duration > 0 ? `${Math.max(0, Math.min(100, (t / duration) * 100))}%` : '0%');
  const near = (a, b) => a && b && Math.abs(a.start - b.start) < 0.02 && Math.abs(a.end - b.end) < 0.02;
  const armed = (active && active.armed) || [];
  return html`<div>
    ${loops.length > 0 && html`<div class="lane">${loops.map((g, i) => {
      const holding = active && active.holding && near(active.region, g);
      return html`<button class=${cx('loop', armed.some((x) => near(x, g)) && 'armed', holding && 'holding')} style=${`left:${pct(g.start)};width:calc(${pct(g.end - g.start)} - 2px)`}
        title=${onLoop ? (holding ? 'Holding: click to let go' : 'Click to hold here') : `${clock(g.start)}–${clock(g.end)}`}
        onClick=${() => onLoop && onLoop({ start: g.start, end: g.end })}>${holding ? '⟳ ' : ''}${g.name || `Loop ${i + 1}`}</button>`;
    })}</div>`}
    <div ref=${box} class=${cx('wave', small && 'small', tall && 'tall')} onClick=${(e) => { if (!onSeek || !(duration > 0)) return; const r = box.current.getBoundingClientRect(); onSeek(((e.clientX - r.left) / r.width) * duration); }}>
      <canvas ref=${canvas}></canvas>
      ${duration > 0 ? bars.slice(0, 600).map((t, i) => html`<div class=${cx('barline', i % 4 === 0 && 'four')} style=${`left:${pct(t)}`}></div>`) : null}
      ${markers.map((m) => html`<div class="marker" style=${`left:${pct(m.at)}`}><span>${m.name}</span></div>`)}
      ${envelope && envelope.length && duration > 0 && width ? html`<svg class="envline" width=${width} height="100%" viewBox=${`0 0 ${width} 100`} preserveAspectRatio="none" aria-hidden="true">
        <path d=${Array.from({ length: Math.floor(width / 3) + 1 }, (_, i) => { const x = Math.min(width, i * 3), d = Lanes.envelopeAt(envelope, (x / width) * duration); return `${i ? 'L' : 'M'}${x} ${((1 - toPos(d)) * 92 + 4).toFixed(1)}`; }).join(' ')} /></svg>` : null}
      ${position != null && duration > 0 ? html`<div class="cursor" style=${`left:${pct(position)}`}></div>` : null}
      ${pin != null && duration > 0 ? html`<div class="pin" style=${`left:${pct(pin)}`}><span>${clock(pin)}</span></div>` : null}
      ${!data && file ? html`<div class="nothing" style="padding:0;position:absolute;inset:0;display:grid;place-items:center">${data === null ? 'No waveform for this file' : 'Reading the waveform…'}</div>` : null}
    </div>
  </div>`;
}

/** The place marked on a playing track: a click on its waveform leaves it there, with its time. Skip jumps to it,
 *  Fade to crossfades to it inside the track; the marker stays, so Skip again goes back to the same spot. */
export function usePin(a) {
  const [pin, setPin] = useState(null);         // { id, t }
  const t = a && pin && pin.id === a.id ? pin.t : null;
  const place = (x) => { if (!a) return; setPin({ id: a.id, t: Math.round(x * 100) / 100 }); cmd({ op: 'prepare', id: a.id }); };
  return { t, place, clear: () => setPin(null) };
}
export function PinControls({ a, pin, on = null, went = null }) {
  if (pin.t == null) return null;
  // (`on` 'bar': the Playing strip's "on the bar" is ticked, so both leave on the track's next bar line)
  const go = (c) => cmd({ ...c, ...(on ? { on } : {}) }).then((r) => went && went(r, clock(pin.t)));
  return html`<span class="row-flex" style="gap:5px"><span class="chip mark">◆ ${clock(pin.t)}</span>
    <button class="btn small" data-pin-skip onClick=${() => go({ op: 'seek', id: a.id, t: pin.t })} title=${on ? 'Jump there on the next bar' : 'Jump there now'}>Skip</button>
    <button class="btn small" onClick=${() => go({ op: 'fadeto', id: a.id, t: pin.t, secs: 1.5 })} title=${on ? 'Crossfade there over 1.5 s, on the next bar' : a.exact ? 'Crossfade there over 1.5 s' : 'Still reading the track: a jump for now'}>Fade to</button>
    <button class="btn ghost small" onClick=${pin.clear}>Clear</button></span>`;
}

// What the strip remembers while the window is open: whether its extra tools are folded out, and "on the bar".
const strip = { more: false, onBar: false };
const LOOP_BARS = [1, 2, 4, 8], LOOP_SECS = [2, 4, 8, 16];

/** The strip under the list: the longest sound playing (or the selected one, if it is playing), big enough to steer by.
 *  Its row of tools is what a show needs when it leaves the script: go round the next few bars from here until let
 *  go (no region drawn first), skip or crossfade to a marker or to a place clicked on the waveform (on the bar, when
 *  that is ticked), mark where the track is. A sound with no tempo shows none of the bar tools, only the way to
 *  find one; the rest is behind More. */
export function Playing({ s, byId, selected }) {
  const audio = s.engine.active.filter((a) => a.kind === 'audio');
  const sel = selected.length === 1 ? audio.find((a) => a.id === selected[0].id || a.parent === selected[0].id) : null;
  // the longest thing sounding is the bed the operator steers by
  const a = sel || audio.slice().sort((x, y) => (y.total || 0) - (x.total || 0))[0] || null;
  const pin = usePin(a);
  const [more, setMoreState] = useState(strip.more);
  const [onBar, setOnBarState] = useState(strip.onBar);
  const [finding, setFinding] = useState(false);
  const [going, setGoing] = useState(null);           // { id, text }: a skip or a fade waiting for its bar line
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!a) return null;
  const x = byId.get(a.id);
  const cue = x ? x.cue : {};
  const editMode = s.mode !== 'show';
  const sec = sectionAt(cue.tempo, a.elapsed);
  const beat = sec ? 60 / sec.bpm : 0;
  const bb = barBeatAt(cue.tempo, a.elapsed);
  const on = sec && onBar ? 'bar' : null;
  const setMore = (v) => { strip.more = v; setMoreState(v); };
  const setOnBar = (v) => { strip.onBar = v; setOnBarState(v); };
  const near = (p, q) => p && q && Math.abs(p.start - q.start) < 0.02 && Math.abs(p.end - q.end) < 0.02;
  // a loop made here (not one of the cue's own regions) is drawn in the lane with the others, named by its length
  const free = [a.region, ...(a.armed || [])].filter((g) => g && !(a.loops || []).some((l) => near(l, g)));
  const nameOf = (g) => { const n = beat ? (g.end - g.start) / beat : 0, bars = n / (sec ? sec.bar : 4); return beat ? (Math.abs(bars - Math.round(bars)) < 0.01 && bars >= 1 ? `${Math.round(bars)} bar${Math.round(bars) === 1 ? '' : 's'}` : `${Math.round(n * 4) / 4} beat${Math.abs(n - 1) < 0.01 ? '' : 's'}`) : `${Math.round((g.end - g.start) * 10) / 10} s`; };
  const lane = [...(a.loops || []), ...free.filter((g, i) => !free.slice(0, i).some((y) => near(y, g))).map((g) => ({ ...g, name: nameOf(g) }))];
  const looping = a.holding || (a.armed || []).length > 0;
  const loop = (len, inBeats) => { const g = loopFromHere(cue.tempo, a, len, inBeats); if (g) cmd({ op: 'loop', id: a.id, region: g, free: true }); };
  // a move that waits for the bar says so until it lands (nothing is heard to change for up to a bar)
  const went = (r, name) => { if (!r || !(r.wait > 0.2)) return; clearTimeout(timer.current); setGoing({ id: a.id, text: `→ ${name} on the bar` }); timer.current = setTimeout(() => setGoing(null), r.wait * 1000); };
  const toMarker = (mk, fade) => { const t = on ? nearestBar(cue.tempo, mk.at) : mk.at; cmd({ op: fade ? 'fadeto' : 'seek', id: a.id, t, ...(fade ? { secs: 1.5 } : {}), ...(on ? { on } : {}) }).then((r) => went(r, mk.name)); };
  const markHere = () => cmd({ op: 'mark-here', id: a.id });      // (the host knows where the track is to the moment; this page, to its last redraw)
  const findTempo = async () => { setFinding(true); await cmd({ op: 'tempo-find', ids: [a.id], again: false }); setFinding(false); };
  const markers = (a.markers || []).slice(0, 8);
  const noLoop = a.stretched ? 'Keeping its pitch, it cannot loop' : '';
  return html`<div class="playing">
    <div class="head">
      <span class=${cx('dot', a.paused ? 'standby' : 'go')}></span>
      <span class="name">${a.topNumber ? a.topNumber + ' · ' : ''}${a.name}</span>
      ${a.holding ? html`<span class="chip warn">⟳ HOLDING</span>` : null}
      ${going && going.id === a.id ? html`<span class="chip" data-going>${going.text}</span>` : null}
      <span class="grow"></span>
      ${bb ? html`<span class="t bb" data-barbeat title=${`Bar ${bb.bar}, beat ${bb.beat} · ${bpmText(sec.bpm)} bpm`}>${bb.bar}.${bb.beat}</span>` : null}
      <span class="t">${clock(a.elapsed)} <span class="dim">/ ${a.total ? clock(a.total) : '—'}</span></span>
      <button class="btn small" onClick=${() => cmd({ op: 'toggle', id: a.id })}>${a.paused ? 'Resume' : 'Pause'}</button>
      <button class="btn small" onClick=${() => cmd({ op: 'stop', id: a.id })}>Stop</button>
    </div>
    <${Waveform} small file=${a.file} duration=${a.total} position=${a.elapsed} markers=${a.markers || []} loops=${lane} active=${a} from=${0} cutAt=${cue.cutAt} pin=${pin.t} envelope=${cue.envelope}
      bars=${barsOf(cue.tempo, a.total)} onSeek=${(t) => pin.place(on ? nearestBar(cue.tempo, t) : t)} onLoop=${(g) => cmd({ op: 'loop', id: a.id, region: g, free: true })} />
    <div class="ptools" data-ptools>
      ${looping ? html`<button class="btn small standby" data-letgo onClick=${() => cmd({ op: 'hold', id: a.id })} title="Plays this pass out (L)">${a.holding ? 'Let go' : 'Will hold · let go'}</button>`
        : sec ? html`<span class="lbl">Loop</span>${LOOP_BARS.map((n) => html`<button class="btn small" data-loop-bars=${n} disabled=${!!a.stretched} onClick=${() => loop(n * sec.bar, true)} title=${noLoop || `Loop ${n === 1 ? '1 bar' : `${n} bars`} from here (L lets go)`}>${n}</button>`)}<span class="lbl">bars</span>` : null}
      ${markers.length ? html`${looping || sec ? html`<span class="sep"></span>` : null}${markers.map((mk) => html`<button class="btn small" data-marker onClick=${(e) => toMarker(mk, e.shiftKey)} title=${`Skip to ${clock(mk.at)}${on ? ' on the bar' : ''} (⇧: crossfade)`}>${mk.name}</button>`)}` : null}
      ${looping || sec || markers.length ? html`<span class="sep"></span>` : null}
      <${PinControls} a=${a} pin=${pin} on=${on} went=${went} />
      <span class="grow"></span>
      ${!cue.tempo && cue.id && cue.file ? html`<button class="btn ghost small" data-find-tempo-here disabled=${finding || !editMode} onClick=${findTempo} title=${editMode ? 'Listen for this sound’s beat' : 'Show mode: switch to Edit to find it'}>${finding ? 'Listening…' : 'Find the tempo'}</button>` : null}
      <button class=${cx('btn ghost small', more && 'on')} data-more onClick=${() => setMore(!more)}>More ${more ? '▴' : '▾'}</button>
    </div>
    ${more ? html`<div class="ptools more" data-ptools-more>
      <span class="lbl">Loop</span>
      ${sec ? [[1, '1 beat'], ...(sec.bar > 2 ? [[2, '2 beats']] : [])].map(([n, name]) => html`<button class="btn small" data-loop-beats=${n} disabled=${!!a.stretched || looping} onClick=${() => loop(n, true)} title=${noLoop || `Loop ${name} from here (L lets go)`}>${name}</button>`)
        : LOOP_SECS.map((n) => html`<button class="btn small" data-loop-secs=${n} disabled=${!!a.stretched || looping} onClick=${() => loop(n, false)} title=${noLoop || `Loop ${n} s from here (L lets go)`}>${n} s</button>`)}
      <span class="sep"></span>
      <button class="btn small" data-mark-here disabled=${!editMode || !cue.id} onClick=${markHere} title=${editMode ? 'Keep a marker where it is now' : 'Show mode: markers are made in Edit'}>+ here</button>
      ${sec ? html`<label class="check" title="Skips and crossfades leave and land on the bar"><input type="checkbox" data-on-bar checked=${onBar} onChange=${(e) => setOnBar(e.target.checked)} /> on the bar</label>
        <span class="grow"></span><span class="dim" style="font-size:11.5px">${bpmText(sec.bpm)} bpm · ${sec.bar} in a bar</span>` : null}
    </div>` : null}
  </div>`;
}

// faders: −60 … +12 dB, with more of the travel given to the top (where the work is)
export const toPos = (d) => (d <= -60 ? 0 : Math.pow((Math.max(-60, Math.min(12, d)) + 60) / 72, 2.2));
export const toDb = (p) => (p <= 0.001 ? -60 : Math.round((Math.pow(p, 1 / 2.2) * 72 - 60) * 2) / 2);

function Fader({ value, peaks, onLive, onCommit }) {
  const [drag, setDrag] = useState(null);
  const shown = drag !== null ? drag : value;
  const two = Array.isArray(peaks);
  return html`<div class="fader" onDblClick=${() => { onLive(0); onCommit(0); }} title="Double-click: 0 dB">
    ${(two ? peaks : [peaks]).map((p, i) => html`<div class=${cx('meter', two && 'two', i === 1 && 'b')}><i style=${`width:${toPos(p ?? -60) * 100}%`}></i></div>`)}
    <div class="zero" style=${`left:${toPos(0) * 100}%`}></div>
    <input type="range" min="0" max="1" step="0.001" value=${toPos(shown)}
      onInput=${(e) => { const d = toDb(Number(e.target.value)); setDrag(d); onLive(d); }}
      onChange=${(e) => { const d = toDb(Number(e.target.value)); setDrag(null); onCommit(d); }} />
  </div>`;
}

/** A pending change's mark beside its control: yellow, says what the saved value was, and ↺ puts that one control back. */
export function Was({ was, onBack }) {
  if (was === undefined) return null;
  return html`<span class="was" title=${`Not saved yet. Saved: ${was}`}><i></i>${onBack ? html`<button onClick=${(e) => { e.stopPropagation(); onBack(); }} title=${`Put back to ${was}`}>↺</button>` : null}</span>`;
}

/** A bus level as a round knob, and nothing beside it: drag up or down (Shift: finer), or the scroll wheel;
 *  double-click to type a level; ⌥-click sends it home (0 dB). It takes the keyboard too (Tab to it): the arrows
 *  step it by 1 dB (Shift: 0.5), Enter types a level. The move is heard as it is made, and is
 *  pending until the show is saved. */
function Knob({ name, value, peak, was, onLive, onCommit, onBack }) {
  const [drag, setDrag] = useState(null);
  const [typing, setTyping] = useState(false);
  const start = useRef(null), wheelTimer = useRef(null), live = useRef(value), dial = useRef(null);
  const shown = drag !== null ? drag : value;
  live.current = shown;
  const clamp = (d) => Math.max(-60, Math.min(12, Math.round(d * 2) / 2));
  const set = (d) => { d = clamp(d); onLive(d); onCommit(d); };
  const step = (by) => set((live.current <= -60 && by > 0 ? -40 : live.current) + by);
  const down = (e) => {
    if (e.altKey) { e.preventDefault(); set(0); return; }
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); start.current = { y: e.clientY, v: Math.max(-60, shown) };
  };
  const move = (e) => { if (!start.current) return; const d = clamp(start.current.v + (start.current.y - e.clientY) * (e.shiftKey ? 0.05 : 0.25)); if (d !== live.current) { setDrag(d); onLive(d); } };
  const up = () => { if (!start.current) return; start.current = null; const d = live.current; setDrag(null); if (d !== value) onCommit(d); };
  const wheel = (e) => { e.preventDefault(); const d = clamp(live.current + (e.deltaY < 0 ? 0.5 : -0.5)); setDrag(d); onLive(d); clearTimeout(wheelTimer.current); wheelTimer.current = setTimeout(() => { setDrag(null); onCommit(live.current); }, 350); };
  // (the keys a knob takes are only these, and only once Tab has given it the keyboard (a click does not): Space and Esc
  // still reach GO and Panic. The window's own keys step aside for them, app.js)
  const key = (e) => {
    const by = e.shiftKey ? 0.5 : 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); step(by); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); step(-by); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setTyping(true); }
  };
  const typed = (text) => {
    setTyping(false);
    if (text !== null) { const t = String(text).trim().replace(/\s*db$/i, '').replace('−', '-'); const d = /^-?inf/i.test(t) ? -60 : Number(t); if (t !== '' && Number.isFinite(d)) set(d); }
    setTimeout(() => { const d = dial.current && dial.current.querySelector('svg'); if (d) d.focus(); }, 0);
  };
  // the dial: −60 dB at 7 o'clock round to +12 dB at 5 o'clock; the arc from 0 dB shows a cut or a boost at a glance
  return html`<div class=${cx('knob', was !== undefined && 'pending')}>
    <div class="kname">${name}<${Was} was=${was} onBack=${onBack} /></div>
    <div class="kbody">
      <span class="kwrap" ref=${dial}><${DialFace} pos=${toPos(shown)} origin=${toPos(0)} peak=${toPos(peak ?? -60)} title="Drag or scroll. Double-click to type. ⌥-click: 0 dB."
        tabindex="0" role="slider" aria-label=${`${name} level`} aria-valuemin="-60" aria-valuemax="12" aria-valuenow=${shown}
        onMouseDown=${(e) => e.preventDefault()} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onWheel=${wheel} onKeyDown=${key}
        onDblClick=${(e) => { if (!e.altKey) setTyping(true); }} /></span>
    </div>
    ${typing ? html`<input class="kval-type mono" data-knob-type autofocus value=${shown <= -60 ? '-inf' : String(shown)}
        ref=${(el) => { if (el && document.activeElement !== el) { el.focus(); el.select(); } }}
        onKeyDown=${(e) => { e.stopPropagation(); if (e.key === 'Enter') typed(e.currentTarget.value); else if (e.key === 'Escape') typed(null); }}
        onBlur=${(e) => typing && typed(e.currentTarget.value)} />`
      : html`<div class="kval-text" onDblClick=${() => setTyping(true)}>${db(shown, false)}</div>`}
  </div>`;
}

/** The side panel: what is playing, the assistant's resident, the network's last messages (only once this viewer
 *  has asked for them: `network`, from the ⋯ menu) and the mixer. With nothing playing, the first part is one line;
 *  the mixer stays where it is either way, so it never moves under a hand when a cue starts. */
export function Sidebar({ s, byId, openSettings, openMonitor, pending, resident = null, network = false }) {
  const e = s.engine, m = s.mixer;
  const audio = e.active.filter((a) => a.kind === 'audio');
  const minor = e.active.filter((a) => a.kind !== 'audio');
  // a Timecode cue running: the time it is sending now
  const tcOut = (id) => { const t = ((s.timecode || {}).out || []).find((x) => x.id === id); return t ? t.text : ''; };
  const lv = m.level || [];
  return html`<div class="side">
    <div class="tabs"><button class=${cx('on', !e.active.length && 'idle')} data-active-head>${e.active.length ? `Active cues · ${e.active.length}` : 'Nothing playing'}</button></div>
    <div class="side-body" style="display:flex;flex-direction:column">
      <div style="flex:1;min-height:120px">
        ${audio.map((a) => html`<div class=${cx('act', a.paused && 'paused')} key=${a.id}>
          <div class="top"><span class="n">${a.topNumber}</span><span class="name">${a.name}</span><span class="t">${a.loop ? clock(a.elapsed) + ' ⟳' : a.total ? '−' + clock(Math.max(0, (a.end || a.total) - a.elapsed)) : clock(a.elapsed)}</span></div>
          <div class="bar" title=${s.mode === 'show' ? 'Show mode: skip from the waveform below' : 'Click to skip there'} onClick=${(ev) => { if (!a.total || s.mode === 'show') return; const r = ev.currentTarget.getBoundingClientRect(); cmd({ op: 'seek', id: a.id, t: ((ev.clientX - r.left) / r.width) * a.total }); }}><i style=${`width:${a.total ? Math.min(100, (a.elapsed / a.total) * 100) : 0}%`}></i></div>
          <div class="ctl">
            <button class="btn small" onClick=${() => cmd({ op: 'toggle', id: a.id })}>${a.paused ? '▶' : '❙❙'}</button>
            <button class="btn small" title="Fade out and stop (again, or ⇧: stop dead)" onClick=${(ev) => cmd({ op: 'stop', id: a.id, fade: !ev.shiftKey && a.fadingTo == null })}>■</button>
            ${a.holding ? html`<button class="chip warn" title=${a.count ? 'Lets go after its last pass. Click or L: now' : 'Click or L to let go'} onClick=${() => cmd({ op: 'hold', id: a.id })}>${a.count ? `⟳ ${a.count.pass} of ${a.count.of} · let go` : '⟳ holding · let go'}</button>`
              : (a.armed || []).length ? html`<button class="chip" title="A loop ahead is armed. Click or L to disarm" onClick=${() => cmd({ op: 'hold', id: a.id })}>⟳ will hold</button>`
              : (a.loops || []).some((l) => l.end > a.elapsed + 0.05) ? html`<button class="chip" title="Hold the next loop (L)" onClick=${() => cmd({ op: 'hold', id: a.id })}>⟳ hold next</button>` : null}
            ${a.playlist ? html`<button class="chip" title="Fade out, play the next" onClick=${() => cmd({ op: 'playlist-next', id: a.playlist })}>next ▸</button>` : null}
            <span class="lvl" title=${a.duck ? `${a.duck > 0 ? 'Boosted' : 'Ducked'} ${a.duck > 0 ? '+' : ''}${a.duck} dB by a running cue` : ''}>${a.fadingTo != null ? `${db(a.db, false)} → ${db(a.fadingTo)}` : db(a.db)}${a.duck ? ` ${a.duck > 0 ? '▴' : '▾'}${Math.abs(a.duck)}` : ''}</span>
          </div></div>`)}
        ${minor.map((a) => html`<div class=${cx('act minor', a.kind, a.paused && 'paused')} key=${a.kind + a.id}>
          <div class="top"><span class="n">${a.kind === 'wait' ? '◷' : a.run === 'timecode' ? '◴' : a.run ? '♫' : '◢'}</span><span class="name">${a.name}</span><span class="t">${a.run === 'timecode' && tcOut(a.id) ? html`<span class="mono">${tcOut(a.id)}</span> ` : ''}${a.run && !a.total ? '' : `−${clock(Math.max(0, a.total - a.elapsed))}`}</span></div>
          <div class="bar"><i style=${`width:${a.total ? Math.min(100, (a.elapsed / a.total) * 100) : 0}%`}></i></div></div>`)}
      </div>

      ${resident}
      ${network && html`<div class="section" data-side-network style="border-top:1px solid var(--line)"><h4>Network <span class="grow"></span><button class="btn ghost small" style="font-size:11px" onClick=${() => (openMonitor ? openMonitor() : openSettings('network'))}>Monitor</button></h4>
        ${s.sent.length ? null : html`<div class="sent dim">Nothing sent yet.</div>`}
        ${s.sent.slice(-4).map((x) => html`<div class=${cx('sent', !x.ok && 'bad')} title=${x.why || x.to}>${x.ok ? '→' : '✕'} ${x.message}${x.to ? `  (${x.to})` : ''}</div>`)}</div>`}

      <div class="section" data-mixer style="border-top:1px solid var(--line);border-bottom:0">
        <h4>Mixer <span class="grow"></span>${m.duckOn ? html`<span class=${cx('limit', m.ducking && 'on')} title=${m.ducking && (m.ducked || []).length ? `Ducked under a voice: ${m.buses.filter((b) => m.ducked.includes(b.id)).map((b) => b.name).join(', ')}` : 'Lit while a bus is ducked'}>DUCK</span>` : null}<span class=${cx('limit', m.limiting && 'on')} title="The limiter is working">LIMIT</span>
          <button class="btn ghost small" style="font-size:11px" title="All levels to 0 dB (not kept until you save)" onClick=${() => { for (const b of m.buses) cmd({ op: 'bus', name: b.id, db: 0 }); cmd({ op: 'master', db: 0 }); edit([...m.buses.map((b, i) => ({ op: 'show.set', path: `settings.audio.buses.${i}.db`, value: 0 })), { op: 'show.set', path: 'settings.audio.masterDb', value: 0 }], 'mixer defaults'); }}>Defaults</button>
          <button class=${cx('btn ghost small', m.recording && 'on')} style="font-size:11px" title=${m.recording ? `Recording to recordings/${m.recording.file}. Click to stop.` : 'Record the main outputs to the show folder'} onClick=${() => cmd({ op: 'record' })}>${m.recording ? `● ${clock(m.recording.secs, 0)}` : '● Rec'}</button>
          <button class="btn ghost small icon" onClick=${() => openSettings('audio')} title="Buses and output">⚙</button></h4>
        <div class="knobs">${m.buses.map((b, i) => html`<${Knob} key=${b.id} name=${(b.live !== undefined ? `${b.name} ·mix` : b.name) + (b.out > 1 ? ` ${b.noOutput ? '✕' : '›'}${b.out}–${b.out + 1}` : '')} value=${b.live !== undefined ? b.live : b.db} peak=${b.peak} was=${pending.paths.get(`settings.audio.buses.${i}.db`)}
          onLive=${(d) => cmd({ op: 'bus', name: b.id, db: d })} onCommit=${(d) => cmd({ op: 'bus', name: b.id, db: d, commit: true })}
          onBack=${() => cmd({ op: 'unset', path: `settings.audio.buses.${i}.db` })} />`)}</div>
        ${m.fallback ? html`<div class="sent bad" title="Settings ▸ Audio">✕ ${m.fallback.label} is gone: on the default output</div>` : null}
        ${m.monitor && m.monitor.on && !m.monitor.live ? html`<div class="sent bad" title="Settings ▸ Audio">✕ Monitor feed: this device has no output ${m.monitor.out}</div>` : null}
        ${m.buses.filter((b) => b.noOutput).map((b) => html`<div class="sent bad" title="Settings ▸ Audio">✕ ${b.name}: no outputs ${b.out}–${b.out + 1}; silent</div>`)}
        ${((s.routing || {}).lost || []).map((w) => html`<div class="sent bad" title="Settings ▸ Audio">✕ ${w}</div>`)}
        <div class="strip master"><span class="nm">Master<${Was} was=${pending.paths.get('settings.audio.masterDb')} onBack=${() => cmd({ op: 'unset', path: 'settings.audio.masterDb' })} /></span>
          <${Fader} value=${m.masterDb} peaks=${[lv[0] ? lv[0].rms : -60, lv[1] ? lv[1].rms : -60]} onLive=${(d) => cmd({ op: 'master', db: d })} onCommit=${(d) => cmd({ op: 'master', db: d, commit: true })} />
          <span class="val">${db(m.masterDb, false)}</span></div>
      </div>
    </div>
  </div>`;
}
