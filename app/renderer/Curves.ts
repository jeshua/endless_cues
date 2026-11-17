// A fade's shape, chosen and drawn: linear, an S-curve, or a curve of your own (click to add a point, drag it,
// double-click it to take it away). The arithmetic is core/audio/curves.js; this draws the same curves.
import { html, useState, useRef, cx } from './lib.js';

const W = 132, H = 54, PAD = 5;
const kindOf = (v) => (Array.isArray(v) ? 'custom' : v === 's-curve' ? 's-curve' : 'linear');
/** How far along a fade of this shape is at x (0–1): as shapeAt in core/audio/curves.js. */
export function shapeAt(shape, x) {
  if (Array.isArray(shape)) {
    for (let i = 1; i < shape.length; i++) { const [x0, y0] = shape[i - 1], [x1, y1] = shape[i]; if (x <= x1) return x1 > x0 ? y0 + (y1 - y0) * ((x - x0) / (x1 - x0)) : y1; }
    return 1;
  }
  return shape === 's-curve' ? (1 - Math.cos(Math.PI * x)) / 2 : x;
}

/** `falling`: drawn as a level on its way down (the same curve, the other way up), which is how it will be heard. */
export function ShapeField({ value, onChange, falling, mixed }) {
  const kind = kindOf(value);
  const [drag, setDrag] = useState(null);          // { i, pts } while a point is being moved
  const svg = useRef();
  const pts = drag ? drag.pts : Array.isArray(value) ? value : null;
  const shape = pts || value;
  const px = (x) => PAD + x * (W - 2 * PAD);
  const py = (y) => (falling ? PAD + y * (H - 2 * PAD) : H - PAD - y * (H - 2 * PAD));
  const at = (e) => {
    const r = svg.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, ((e.clientX - r.left) / r.width * W - PAD) / (W - 2 * PAD)));
    const yy = ((e.clientY - r.top) / r.height * H - PAD) / (H - 2 * PAD);
    return [Math.round(x * 1000) / 1000, Math.round(Math.max(0, Math.min(1, falling ? yy : 1 - yy)) * 1000) / 1000];
  };
  const line = Array.from({ length: 41 }, (_, i) => `${i ? 'L' : 'M'}${px(i / 40).toFixed(1)} ${py(shapeAt(shape, i / 40)).toFixed(1)}`).join(' ');
  const down = (e, i) => {
    if (kind !== 'custom') return;
    e.preventDefault(); e.stopPropagation();
    svg.current.setPointerCapture(e.pointerId);
    if (i == null) {                                 // a click on the empty curve: a new point there
      const p = at(e), next = [...pts.slice(1, -1), p].sort((a, b) => a[0] - b[0]);
      setDrag({ i: next.indexOf(p) + 1, pts: [[0, 0], ...next, [1, 1]] });
    } else setDrag({ i, pts });
  };
  const move = (e) => {
    if (!drag) return;
    const p = at(e), lo = drag.pts[drag.i - 1][0] + 0.01, hi = drag.pts[drag.i + 1][0] - 0.01;
    setDrag({ i: drag.i, pts: drag.pts.map((q, k) => (k === drag.i ? [Math.max(lo, Math.min(hi, p[0])), p[1]] : q)) });
  };
  const up = () => { if (!drag) return; const next = drag.pts; setDrag(null); onChange(next); };
  return html`<div class="shapefield">
    <select value=${mixed ? '' : kind} onChange=${(e) => onChange(e.target.value)}>
      ${mixed ? html`<option value="">(mixed)</option>` : null}
      <option value="linear">Linear</option><option value="s-curve">S-curve</option><option value="custom">Custom</option></select>
    <svg ref=${svg} class=${cx('shape', kind === 'custom' && 'custom')} viewBox=${`0 0 ${W} ${H}`} width=${W} height=${H}
         onPointerDown=${(e) => down(e, null)} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
      <title>${kind === 'custom' ? 'Click: add a point. Drag: move. Double-click: remove.' : falling ? 'The level, falling' : 'The level, rising'}</title>
      <rect x="0.5" y="0.5" width=${W - 1} height=${H - 1} rx="4" class="sbox" />
      <path class="sline" d=${line} />
      ${kind === 'custom' ? pts.slice(1, -1).map((p, i) => html`<circle class=${cx('spoint', drag && drag.i === i + 1 && 'on')} cx=${px(p[0])} cy=${py(p[1])} r="4"
        onPointerDown=${(e) => down(e, i + 1)} onDblClick=${(e) => { e.stopPropagation(); const next = pts.filter((_, k) => k !== i + 1); onChange(next); }} />`) : null}
    </svg>
  </div>`;
}
