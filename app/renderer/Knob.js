// A round knob, as the mixer's bus levels and the sound-design devices have it. `DialFace` is the drawing alone (the
// mixer's level knob wraps it in its own dB handling); `ParamKnob` is a whole knob for one setting of a table
// (core/audio/chain.js): its name above, the dial, its value and unit below. The arithmetic is dial.js.
import { html, useState, useRef, useEffect, cx } from './lib.js';
import { toPos, fromPos, format, parseTyped, scaleOf } from './dial.js';

const ang = (p) => (-135 + p * 270) * Math.PI / 180;
const pt = (p, r) => [24 + r * Math.sin(ang(p)), 24 - r * Math.cos(ang(p))];
const at = (p, r) => pt(p, r).map((n) => n.toFixed(2)).join(' ');
const arc = (a, b) => `M ${at(a, 20)} A 20 20 0 ${Math.abs(b - a) * 270 > 180 ? 1 : 0} ${b > a ? 1 : 0} ${at(b, 20)}`;

/** A dial's face: the track from 7 o'clock round to 5, the arc from `origin` to `pos` (both 0…1), a needle, and a
 *  meter's arc under it when there is a `peak`. Every other prop (pointer events, a title) goes on the svg. */
export function DialFace({ pos, origin = 0, peak = null, title, cls = 'kdial', children, ...events }) {
  const [x1, y1] = pt(pos, 6), [x2, y2] = pt(pos, 13.5);
  return html`<svg viewBox="0 0 48 48" class=${cls} ...${events}>${title ? html`<title>${title}</title>` : null}
    <path class="ktrack" d=${arc(0, 1)} />
    ${peak !== null && peak > 0.01 ? html`<path class="kpeak" d=${arc(0, peak)} />` : null}
    <path class="kval" d=${arc(Math.min(origin, pos), Math.max(origin, pos) + 0.0001)} />
    <circle class="kring" cx="24" cy="24" r="14.5" />
    <line class="kneedle" x1=${x1.toFixed(2)} y1=${y1.toFixed(2)} x2=${x2.toFixed(2)} y2=${y2.toFixed(2)} />
    ${children}
  </svg>`;
}

/**
 * One setting as a knob. Drag up or down (Shift: ten times finer), the scroll wheel, or the arrow keys when it has
 * the keyboard; double-click the dial for the setting's default; double-click the value to type one ("1.8k",
 * "350 ms", "30%"). A drag is shown as it is made and kept (one undoable edit) when the button is let go; the wheel
 * keeps its turn once it rests. `p`: { key, label, unit, min, max, def }. `id` goes on as data-knob.
 */
export function ParamKnob({ p, value, pending = false, disabled = false, id, onCommit, label, automated = false }) {
  const [drag, setDrag] = useState(null);
  const [typing, setTyping] = useState(false);
  const start = useRef(null), wheelTimer = useRef(null), wheelPos = useRef(null), live = useRef(value);
  useEffect(() => () => clearTimeout(wheelTimer.current), []);
  const shown = drag !== null ? drag : value;
  live.current = shown;
  const s = scaleOf(p);
  const pos = toPos(p, shown), origin = toPos(p, s.origin);
  const done = (v) => { if (v !== null && v !== undefined && v !== value) onCommit(v); };
  const down = (e) => {
    if (disabled || e.button > 0) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer the page made up */ }
    start.current = { y: e.clientY, pos: toPos(p, shown) };
    if (e.currentTarget.focus) e.currentTarget.focus();
  };
  const move = (e) => {
    if (!start.current) return;
    const v = fromPos(p, start.current.pos + (start.current.y - e.clientY) / (e.shiftKey ? 1500 : 150), e.shiftKey);
    if (v !== live.current) { live.current = v; setDrag(v); }
  };
  const up = () => { if (!start.current) return; start.current = null; const v = live.current; setDrag(null); done(v); };
  // one press of an arrow key: a hundredth of the way round, or as far as it takes to land on the next value (a bit, a semitone)
  const nudge = (by, fine) => {
    const from = toPos(p, live.current);
    for (let k = 1; k <= 100; k++) { const v = fromPos(p, from + by * k * (fine ? 0.001 : 0.01), fine); if (v !== live.current) return v; }
    return live.current;
  };
  const wheel = (e) => {
    if (disabled) return;
    e.preventDefault();
    // (a turn as long as the scroll: a mouse's notch is two hundredths of the way round, a trackpad's small steps less)
    // (the turn is added up unrounded, so many small steps arrive somewhere even on a knob that rounds coarsely)
    const by = Math.max(-2, Math.min(2, -e.deltaY / 50)) * (e.shiftKey ? 0.001 : 0.01);
    wheelPos.current = Math.max(0, Math.min(1, (wheelPos.current ?? toPos(p, live.current)) + by));
    const v = fromPos(p, wheelPos.current, e.shiftKey);
    live.current = v; setDrag(v);
    clearTimeout(wheelTimer.current);
    wheelTimer.current = setTimeout(() => { wheelPos.current = null; setDrag(null); done(live.current); }, 350);
  };
  const key = (e) => {
    if (disabled) return;
    const by = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!by) return;
    e.preventDefault(); e.stopPropagation();
    done(nudge(by, e.shiftKey));
  };
  const f = format(p, shown);
  const typed = (text) => { setTyping(false); const v = parseTyped(p, text); if (v !== null) done(v); };
  return html`<div class=${cx('pknob', pending && 'pending', disabled && 'disabled', automated && 'auto')} data-knob=${id} data-automated=${automated ? '1' : null}>
    <div class="pk-name" title=${automated ? `${p.label}: follows its line on Time & Loops; turning it moves the whole line` : p.label}>${label || p.label}</div>
    <${DialFace} cls="kdial pk-dial" pos=${pos} origin=${origin} tabIndex=${disabled ? -1 : 0} role="slider"
      aria-label=${p.label} aria-valuemin=${p.min} aria-valuemax=${p.max} aria-valuenow=${shown} aria-valuetext=${`${f.text} ${f.unit}`.trim()}
      title=${`${p.label}: drag or scroll (Shift: finer). Double-click: ${format(p, p.def).text} ${format(p, p.def).unit}`.trim()}
      onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onWheel=${wheel} onKeyDown=${key}
      onDblClick=${() => { if (!disabled && p.def !== undefined) done(p.def); }} />
    ${typing
      ? html`<input class="pk-input mono" data-knob-input=${id} value=${f.text} ref=${(el) => { if (el && !el.dataset.held) { el.dataset.held = '1'; el.focus(); el.select(); } }}
          onBlur=${(e) => typed(e.target.value)}
          onKeyDown=${(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } if (e.key === 'Escape') { e.target.value = f.text; setTyping(false); } }} />`
      : html`<div class="pk-val mono" data-knob-value=${id} title="Double-click to type a value" onDblClick=${() => { if (!disabled) setTyping(true); }}>${f.text}<span class="pk-unit">${f.unit}</span></div>`}
  </div>`;
}
