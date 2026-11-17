// The waveform a sound is edited on (the inspector's Time & Loops): zoomed and scrolled, with handles for Start and
// End, a drag that draws a loop region, and the sound's lines drawn over it (its volume, its pan, the settings of its
// sound design: core/audio/lanes.js), edited as in a DAW. Above it, the loop lane and the marker strip, whose
// regions and markers are dragged where they go. The strip under the list and the Live view's decks draw the plainer
// one (Sidebar.js); this one asks for finer peaks, so it can be zoomed into.
//
// Everything that changes the show is one edit through its ops (undo, the unsaved marks); a drag is drawn as it is
// made and kept when the button is let go. In Show mode it is all drawn and nothing can be moved.
import { html, useState, useEffect, useRef, cmd, setCue, clock, db, cx, keys, mod } from './lib.js';
import { barsOf, sectionsOf } from './Tempo.js';
import { toPos } from './Sidebar.js';
import { format, quantize } from './dial.js';
import { Pop } from './SoundDesign.js';
import { snapTime, beatsOf, groupMove, bendFromDrag, segmentAt, moveMarker, moveRegion } from './edit-math.js';

const Lanes = window.Lanes;
const fine = new Map();              // file -> { peaks, rms } (null: none to be had)
const MAX_ZOOM = 64;
const r2 = (t) => Math.round(t * 100) / 100;
const near = (a, b) => a && b && Math.abs(a.start - b.start) < 0.02 && Math.abs(a.end - b.end) < 0.02;
const shown = { lane: 'volume' };    // the line last chosen, while the window is open
const HIT = 7;                       // px: how near a point or the line a click must be to take it

// A line's value on the picture and back. Volume: the fader's law (the top half of the height is the last 20 dB);
// anything else along its knob's own scale, as the line moves.
function yOf(spec, v, h) {
  const u = spec.kind === 'volume' ? toPos(v) : spec.kind === 'chain' ? Lanes.posOf(spec.p, v) : (v - spec.min) / (spec.max - spec.min);
  return (1 - u) * (h - 8) + 4;
}
function valueAtY(spec, y, h, fineHand) {
  const u = Math.max(0, Math.min(1, 1 - (y - 4) / (h - 8)));
  if (spec.kind === 'volume') { const d = u <= 0.001 ? -60 : Math.pow(u, 1 / 2.2) * 72 - 60; return Math.max(-60, Math.min(12, Math.round(d * (fineHand ? 10 : 2)) / (fineHand ? 10 : 2))); }
  if (spec.kind === 'pan') return Math.round((spec.min + (spec.max - spec.min) * u) * (fineHand ? 10 : 1)) / (fineHand ? 10 : 1);
  return quantize(spec.p, Lanes.valueAtPos(spec.p, u), fineHand);
}
function valueText(spec, v) {
  if (spec.kind === 'volume') return db(Math.round(v * 10) / 10);
  if (spec.kind === 'pan') { const n = Math.round(v); return n < 0 ? `L ${-n}` : n > 0 ? `R ${n}` : 'C'; }
  const f = format(spec.p, v);
  return `${f.text} ${f.unit}`.trim();
}

export function WaveEdit({ cue, duration, active, pin, onPick, locked = false, tools = [] }) {
  const file = cue.file, a = active;
  const canvas = useRef(), box = useRef(), root = useRef();
  const [data, setData] = useState(fine.get(file));
  const [width, setWidth] = useState(0);
  const [view, setView] = useState({ zoom: 1, start: 0 });
  const [drag, setDrag] = useState(null);       // what the mouse is doing while it is down (see `down`)
  const [lane, setLaneState] = useState(shown.lane);
  const [sel, setSel] = useState(() => new Set());      // the selected points of the line shown (indices)
  const [msel, setMsel] = useState(-1);                 // the selected marker
  const [naming, setNaming] = useState(-1);             // the marker being renamed
  const [menu, setMenu] = useState(null);               // { kind: 'lanes', anchor } | { kind: 'marker', x, t, i }
  const live = useRef({});
  const setLane = (id) => { shown.lane = id; setLaneState(id); setSel(new Set()); };
  useEffect(() => { setSel(new Set()); setMsel(-1); setNaming(-1); setMenu(null); }, [cue.id]);
  useEffect(() => {
    let alive = true, tries = 0;
    setData(fine.get(file)); setView({ zoom: 1, start: 0 });
    if (!file || fine.has(file)) return undefined;
    const ask = async () => {
      const r = await window.ec.cmd({ op: 'peaks', file, detail: true });
      if (!alive) return;
      if (r && r.pending && tries++ < 60) { setTimeout(ask, 300); return; }
      const got = r && r.peaks ? { peaks: r.peaks, rms: r.rms } : null;
      fine.set(file, got); setData(got);
    };
    ask();
    return () => { alive = false; };
  }, [file]);
  useEffect(() => {
    const ro = new ResizeObserver(() => setWidth(box.current ? box.current.clientWidth : 0));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const dur = duration > 0 ? duration : 0;
  const span = dur / view.zoom;
  const start = Math.max(0, Math.min(dur - span, view.start));
  const xOf = (t) => (span > 0 ? ((t - start) / span) * width : 0);
  // (the box's own width, as it is now: the picture's may be a redraw behind the mouse)
  const boxW = () => Math.max(1, (box.current && box.current.clientWidth) || width);
  const tOf = (x) => Math.max(0, Math.min(dur, start + (x / boxW()) * span));
  const pxPerSec = span > 0 ? boxW() / span : 0;
  const from = Number(cue.from) || 0, end = Number(cue.cutAt) > 0 && Number(cue.cutAt) < dur ? Number(cue.cutAt) : dur;
  const position = a ? a.elapsed : null;
  const shownFrom = drag && drag.kind === 'start' ? drag.t : from, shownEnd = drag && drag.kind === 'end' ? drag.t : end;
  const lanes = Lanes.lanesOf(cue, tools);
  const spec = lanes.find((x) => x.id === lane) || Lanes.VOLUME;
  const pts = drag && (drag.kind === 'points' || drag.kind === 'bend') ? drag.pts : Lanes.pointsOf(cue, spec.id);
  const base = Lanes.baseOf(cue, spec);
  const markers = drag && drag.kind === 'marker' ? drag.markers : cue.markers || [];
  const loops = drag && drag.kind === 'loop' ? drag.loops : cue.loops || [];
  live.current = { view, start, span, dur, width };

  // what a time snaps to: the markers, the bar lines and beats, Start and End (Shift: nothing)
  const grid = sectionsOf(cue.tempo);
  const marks = (skip = []) => [...(cue.markers || []).map((m) => m.at), ...barsOf(cue.tempo, dur), ...(grid.length ? beatsOf(grid, dur) : []), from, end, ...skip];

  // the picture: peaks, and loudness inside them, for the stretch in view (each pixel the loudest of its slices)
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
    if (!data || !(dur > 0)) return;
    const n = data.peaks.length, per = (span / dur) * n / width;
    const played = position != null ? xOf(position) : -1;
    const go = css.getPropertyValue('--go');
    for (const [arr, col, isRms] of [[data.peaks, css.getPropertyValue('--bg-4'), false], [data.rms || data.peaks, css.getPropertyValue('--text-2'), true]]) {
      for (let x = 0; x < width; x++) {
        const i0 = Math.floor((start / dur) * n + x * per), i1 = Math.max(i0 + 1, Math.floor((start / dur) * n + (x + 1) * per));
        let v = 0;
        for (let i = i0; i < i1 && i < n; i++) if (arr[i] > v) v = arr[i];
        const y = Math.max(0.5, v * (mid - 3));
        g.fillStyle = x < played ? go : col;
        g.globalAlpha = x < played ? (isRms ? 0.95 : 0.35) : 1;
        g.fillRect(x, mid - y, 1, y * 2);
      }
    }
    g.globalAlpha = 1;
    // outside the part that plays (before Start, after End): dimmed
    g.fillStyle = 'rgba(8,9,10,.62)';
    if (shownFrom > start) g.fillRect(0, 0, Math.min(width, xOf(shownFrom)), h);
    if (shownEnd < start + span) g.fillRect(Math.max(0, xOf(shownEnd)), 0, width, h);
  }, [data, width, dur, view.zoom, start, Math.round((position || 0) * 4), shownFrom, shownEnd]);

  // zoom about a place (the pointer, or the middle), and scroll: the wheel sideways scrolls, with ⌘ / ctrl (or a pinch) it zooms
  const zoomTo = (zoom, about = start + span / 2, frac = 0.5) => {
    const z = Math.max(1, Math.min(MAX_ZOOM, zoom)), sp = dur / z;
    setView({ zoom: z, start: Math.max(0, Math.min(dur - sp, about - frac * sp)) });
  };
  useEffect(() => {
    const el = box.current;
    const wheel = (e) => {
      const L = live.current;
      if (!(L.dur > 0)) return;
      const r = el.getBoundingClientRect(), frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const z = Math.max(1, Math.min(MAX_ZOOM, L.view.zoom * Math.exp(-e.deltaY * 0.01))), sp = L.dur / z;
        setView({ zoom: z, start: Math.max(0, Math.min(L.dur - sp, L.start + frac * L.span - frac * sp)) });
      } else if (L.view.zoom > 1 && (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey)) {
        e.preventDefault();
        const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        setView({ zoom: L.view.zoom, start: Math.max(0, Math.min(L.dur - L.span, L.start + (dx / Math.max(1, L.width)) * L.span)) });
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  // ── the line ──
  const h = box.current ? box.current.clientHeight : 128;
  const lineAt = (t) => { const v = Lanes.valueAt(pts, t, spec); return v == null ? base : v; };
  const put = (next, label) => setCue(cue.id, Lanes.propsFor(cue, spec.id, next), label || `${spec.label.toLowerCase()} line`);
  const removePoints = (idx) => { put(pts.filter((_, k) => !idx.has(k))); setSel(new Set()); };
  const removeMarker = (i) => { setCue(cue.id, { markers: moveMarker(cue.markers || [], i, null, dur) }, 'remove marker'); setMsel(-1); };
  // Delete (or Backspace) takes the selected points, or the selected marker: the window's own key for a cue gives way
  useEffect(() => {
    if (locked || (!sel.size && msel < 0)) return undefined;
    const hook = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return false;
      e.preventDefault();
      if (sel.size) removePoints(sel); else removeMarker(msel);
      return true;
    };
    window.ecKeyHook = hook;
    // (a click anywhere else lets go of the selection, so Delete is the cue list's again)
    const away = (e) => { if (root.current && !root.current.contains(e.target)) { setSel(new Set()); setMsel(-1); } };
    document.addEventListener('pointerdown', away, true);
    return () => { if (window.ecKeyHook === hook) window.ecKeyHook = null; document.removeEventListener('pointerdown', away, true); };
  });

  const where = (e) => { const r = box.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, h: r.height }; };
  const pointAt = (m) => pts.findIndex((p) => Math.abs(xOf(p[0]) - m.x) < HIT && Math.abs(yOf(spec, p[1], m.h) - m.y) < HIT);
  const onLine = (m) => Math.abs(yOf(spec, lineAt(tOf(m.x)), m.h) - m.y) < HIT - 1;
  const down = (e) => {
    if (!(dur > 0) || e.button !== 0) return;
    const m = where(e);
    try { box.current.setPointerCapture(e.pointerId); } catch { /* a pointer that is already gone */ }
    setMenu(null); setMsel(-1);
    if (!locked) {
      const i = pointAt(m);
      // ⌥ on the line between two points: bend it
      if (e.altKey && i < 0 && pts.length > 1) {
        const k = segmentAt(pts, tOf(m.x));
        if (k >= 0 && onLine(m)) {
          setDrag({ kind: 'bend', k, y0: m.y, c0: pts[k][2] || 0, rising: yOf(spec, pts[k + 1][1], m.h) < yOf(spec, pts[k][1], m.h), pts: pts.map((p) => [...p]), moved: false });
          return;
        }
      }
      if (i >= 0) {
        if (e.shiftKey) { const n = new Set(sel); if (n.has(i)) n.delete(i); else n.add(i); setSel(n); return; }
        const moving = sel.has(i) ? sel : new Set([i]);
        setSel(moving);
        setDrag({ kind: 'points', anchor: i, sel: moving, x0: m.x, y0: m.y, orig: pts.map((p) => [...p]), pts: pts.map((p) => [...p]), moved: false });
        return;
      }
      // on the line: a new point there, on the line, that can be dragged at once
      if (onLine(m) && !mod(e)) {
        const t = r2(snapTime(tOf(m.x), marks(pts.map((p) => p[0])), pxPerSec, e.shiftKey));
        const p = [t, spec.kind === 'volume' ? Math.round(lineAt(t) * 10) / 10 : spec.kind === 'chain' ? quantize(spec.p, lineAt(t), true) : Math.round(lineAt(t))];
        const next = [...pts.map((q) => [...q]), p].sort((x, y) => x[0] - y[0]);
        const at = next.indexOf(p);
        setSel(new Set([at]));
        setDrag({ kind: 'points', anchor: at, sel: new Set([at]), x0: m.x, y0: m.y, orig: next.map((q) => [...q]), pts: next, moved: false, added: true });
        return;
      }
      // ⌘-drag: a box that selects the points inside it
      if (mod(e)) { setDrag({ kind: 'select', x0: m.x, y0: m.y, x1: m.x, y1: m.y }); return; }
    }
    if (sel.size) setSel(new Set());
    const grab = (t) => Math.abs(xOf(t) - m.x) < 6;
    // (where the two handles are on top of each other, the End is the one that can be told from a click on the picture)
    if (grab(end) && (end < dur || m.y < 16)) setDrag({ kind: 'end', t: end });
    else if (grab(from) && (from > 0 || m.y < 16)) setDrag({ kind: 'start', t: from });
    else setDrag({ kind: 'region', x0: m.x, t0: tOf(m.x), t1: tOf(m.x), moved: false });
  };
  const move = (e) => {
    if (!drag) return;
    const m = where(e), t = tOf(m.x);
    if (drag.kind === 'start') setDrag({ ...drag, t: r2(Math.max(0, Math.min(end - 0.05, t))) });
    else if (drag.kind === 'end') setDrag({ ...drag, t: r2(Math.max(from + 0.05, Math.min(dur, t))) });
    else if (drag.kind === 'region') setDrag({ ...drag, t1: t, moved: drag.moved || Math.abs(m.x - drag.x0) > 4 });
    else if (drag.kind === 'select') setDrag({ ...drag, x1: m.x, y1: m.y });
    else if (drag.kind === 'bend') {
      const next = drag.pts.map((p) => [...p]), c = bendFromDrag(drag.c0, drag.y0 - m.y, drag.rising);
      next[drag.k] = c ? [next[drag.k][0], next[drag.k][1], c] : [next[drag.k][0], next[drag.k][1]];
      setDrag({ ...drag, pts: next, moved: true });
    } else if (drag.kind === 'points') {
      if (!drag.moved && Math.abs(m.x - drag.x0) < 3 && Math.abs(m.y - drag.y0) < 3) return;
      const o = drag.orig, ys = o.map((p) => yOf(spec, p[1], m.h));
      // the point held snaps (lightly) in time; the others keep their distance from it
      const want = snapTime(o[drag.anchor][0] + (m.x - drag.x0) / pxPerSec, marks(o.filter((_, k) => !drag.sel.has(k)).map((p) => p[0])), pxPerSec, e.shiftKey);
      const g = groupMove(o, ys, drag.sel, want - o[drag.anchor][0], (m.y - drag.y0) * (e.shiftKey ? 0.2 : 1), dur, m.h);
      setDrag({ ...drag, moved: true, pts: o.map((p, k) => (drag.sel.has(k) ? [r2(p[0] + g.dt), valueAtY(spec, ys[k] + g.dy, m.h, e.shiftKey), ...(p[2] ? [p[2]] : [])] : p)) });
    }
  };
  const up = () => {
    const d = drag;
    if (!d) return;
    setDrag(null);
    if (d.kind === 'start') { if (d.t !== from) setCue(cue.id, { from: d.t > 0.005 ? d.t : null }, 'start at'); }
    else if (d.kind === 'end') { if (d.t !== end) setCue(cue.id, { cutAt: d.t < dur - 0.005 ? d.t : null }, 'end at'); }
    else if (d.kind === 'points') { if (d.moved || d.added) put(d.pts); }
    else if (d.kind === 'bend') { if (d.moved) put(d.pts, `${spec.label.toLowerCase()} curve`); }
    else if (d.kind === 'select') {
      const [x0, x1] = [Math.min(d.x0, d.x1), Math.max(d.x0, d.x1)], [y0, y1] = [Math.min(d.y0, d.y1), Math.max(d.y0, d.y1)];
      setSel(new Set(pts.map((p, k) => [p, k]).filter(([p]) => { const x = xOf(p[0]), y = yOf(spec, p[1], h); return x >= x0 && x <= x1 && y >= y0 && y <= y1; }).map(([, k]) => k)));
    } else if (!d.moved) { if (onPick) onPick(d.t0); }
    else {
      const s0 = r2(Math.min(d.t0, d.t1)), e0 = r2(Math.max(d.t0, d.t1));
      if (e0 - s0 >= 0.1) setCue(cue.id, { loops: [...(cue.loops || []), { start: s0, end: e0 }].sort((p, q) => p.start - q.start) }, 'add loop region');
    }
  };
  const dbl = (e) => {
    if (locked) return;
    const i = pointAt(where(e));
    if (i >= 0) removePoints(new Set([i]));
  };

  // ── the marker strip: drag a marker, double-click its name, ⌥-click it away; a drag on the strip makes one ──
  const stripX = (e) => { const r = box.current.getBoundingClientRect(); return e.clientX - r.left; };
  const markerDown = (e, i) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setMenu(null); setSel(new Set());
    if (locked) return;
    if (e.altKey) { removeMarker(i); return; }
    setMsel(i);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* gone */ }
    setDrag({ kind: 'marker', i, x0: stripX(e), at0: (cue.markers || [])[i].at, markers: (cue.markers || []).map((m) => ({ ...m })), moved: false });
  };
  const stripDown = (e) => {
    if (locked || e.button !== 0 || !(dur > 0)) return;
    setMenu(null); setSel(new Set());
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* gone */ }
    const t = r2(snapTime(tOf(stripX(e)), marks(), pxPerSec, e.shiftKey));
    const made = [...(cue.markers || []).map((m) => ({ ...m })), { at: t, name: `Marker ${(cue.markers || []).length + 1}` }];
    setDrag({ kind: 'marker', i: made.length - 1, x0: stripX(e), at0: t, markers: made, moved: false, added: true });
  };
  const stripMove = (e) => {
    if (!drag || drag.kind !== 'marker') return;
    const x = stripX(e);
    if (!drag.moved && Math.abs(x - drag.x0) < 3) return;
    const t = r2(snapTime(drag.at0 + (x - drag.x0) / pxPerSec, marks().filter((m) => m !== drag.at0), pxPerSec, e.shiftKey));
    const next = drag.markers.map((m, k) => (k === drag.i ? { ...m, at: Math.max(0, Math.min(dur, t)) } : m));
    setDrag({ ...drag, markers: next, moved: true });
  };
  const stripUp = () => {
    const d = drag;
    if (!d || d.kind !== 'marker') return;
    setDrag(null);
    if (!d.moved && !d.added) return;
    const mine = d.markers[d.i], sorted = moveMarker(d.markers, d.i, mine.at, dur);
    setCue(cue.id, { markers: sorted }, d.added ? 'add marker' : 'move marker');
    setMsel(sorted.findIndex((m) => m.name === mine.name && Math.abs(m.at - mine.at) < 0.001));
  };
  const rename = (i, name) => { setNaming(-1); const n = String(name).trim(); if (!n || n === (cue.markers || [])[i].name) return; setCue(cue.id, { markers: (cue.markers || []).map((m, k) => (k === i ? { ...m, name: n } : m)) }, 'rename marker'); };
  const context = (e) => {
    if (locked || !(dur > 0)) return;
    e.preventDefault();
    const x = stripX(e), t = r2(tOf(x)), i = (cue.markers || []).findIndex((m) => Math.abs(xOf(m.at) - x) < 6);
    const r = box.current.getBoundingClientRect();
    setMenu({ kind: 'marker', left: e.clientX - r.left, t, i });
  };
  const addMarkerAt = (t) => { setMenu(null); const made = [...(cue.markers || []), { at: t, name: `Marker ${(cue.markers || []).length + 1}` }]; setCue(cue.id, { markers: moveMarker(made, made.length - 1, t, dur) }, 'add marker'); };

  // ── the loop lane: drag a region's edge, or its middle to move it whole; a click holds it (as before) ──
  const loopDown = (e, i) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const g = (cue.loops || [])[i], x = stripX(e);
    const part = Math.abs(x - xOf(g.start)) < 6 ? 'start' : Math.abs(x - xOf(g.end)) < 8 ? 'end' : 'body';
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* gone */ }
    setDrag({ kind: 'loop', i, part, x0: x, grab: tOf(x) - g.start, g, loops: (cue.loops || []).map((q) => ({ ...q })), moved: false });
  };
  const loopMove = (e) => {
    if (!drag || drag.kind !== 'loop' || locked) return;
    const x = stripX(e);
    if (!drag.moved && Math.abs(x - drag.x0) < 4) return;
    const raw = tOf(x);
    const t = drag.part === 'body' ? snapTime(raw - drag.grab, marks(), pxPerSec, e.shiftKey) + drag.grab : snapTime(raw, marks(), pxPerSec, e.shiftKey);
    const g = moveRegion(drag.g, drag.part, t, dur, drag.grab);
    setDrag({ ...drag, moved: true, loops: drag.loops.map((q, k) => (k === drag.i ? g : q)) });
  };
  const loopUp = () => {
    const d = drag;
    if (!d || d.kind !== 'loop') return;
    setDrag(null);
    if (!d.moved) { if (a) cmd({ op: 'loop', id: cue.id, region: { start: d.g.start, end: d.g.end } }); return; }
    setCue(cue.id, { loops: [...d.loops].sort((p, q) => p.start - q.start) }, d.part === 'body' ? 'move loop region' : 'loop region edge');
  };

  const inView = (t) => t >= start - 1e-6 && t <= start + span + 1e-6;
  const left = (t) => `${xOf(t)}px`;
  const armed = (a && a.armed) || [];
  // a line across the whole view, drawn from what it plays (so a bend is drawn as it is heard)
  const pathOf = (sp, ps, b) => {
    if (!(width > 0) || !(span > 0)) return '';
    const out = [];
    for (let x = 0; x <= width; x += 2) { const t = start + (x / width) * span, v = Lanes.valueAt(ps, t, sp); out.push(`${x ? 'L' : 'M'}${x} ${yOf(sp, v == null ? b : v, h).toFixed(1)}`); }
    return out.join(' ');
  };
  const others = lanes.filter((x) => x.id !== spec.id && Lanes.pointsOf(cue, x.id).length);
  const ghost = drag && drag.kind === 'region' && drag.moved ? { a: Math.min(drag.t0, drag.t1), b: Math.max(drag.t0, drag.t1) } : null;
  const tipPt = drag && drag.kind === 'points' && drag.moved ? drag.pts[drag.anchor] : null;
  const box2 = drag && drag.kind === 'select' ? drag : null;
  const markerTip = drag && drag.kind === 'marker' && (drag.moved || drag.added) ? drag.markers[drag.i] : null;
  const loopTip = drag && drag.kind === 'loop' && drag.moved ? drag.loops[drag.i] : null;
  return html`<div class=${cx('wavedit', locked && 'locked')} ref=${root}>
    <div class="wavetop">
      <button class="btn small lane-pick" data-lane-pick title="Which line is drawn and edited" onClick=${(e) => { const anchor = e.currentTarget; setMenu((m) => (m && m.kind === 'lanes' ? null : { kind: 'lanes', anchor })); }}>${spec.label} ▾</button>
      <span class="dim mono">${pts.length ? `${pts.length} point${pts.length === 1 ? '' : 's'}${sel.size ? ` · ${sel.size} selected` : ''}` : ''}</span>
      <span class="grow"></span>
    </div>
    ${menu && menu.kind === 'lanes' ? html`<${Pop} anchor=${menu.anchor} onClose=${() => setMenu(null)} width=${250} data-lane-menu>
      <div class="sd-menu-group"><div class="lane-list">${lanes.map((x) => html`<button key=${x.id} class=${cx('sd-menu-item lane-item', x.id === spec.id && 'on')} data-lane=${x.id} onClick=${() => { setLane(x.id); setMenu(null); }}>
        <i class=${cx('lane-dot', Lanes.pointsOf(cue, x.id).length && 'has')}></i>${x.label}</button>`)}</div></div>
      ${pts.length && !locked ? html`<button class="sd-menu-item danger" data-lane-clear onClick=${() => { setMenu(null); put([], `clear ${spec.label.toLowerCase()} line`); setSel(new Set()); }}>Clear this line</button>` : null}
    <//>` : null}
    ${loops.length > 0 && html`<div class="lane loops" style="overflow:hidden" onPointerMove=${loopMove} onPointerUp=${loopUp} onPointerCancel=${loopUp}>${loops.map((g, i) => {
      if (g.end < start || g.start > start + span) return null;
      const holding = a && a.holding && near(a.region, g);
      return html`<button key=${i} data-loop=${i} class=${cx('loop', armed.some((x) => near(x, g)) && 'armed', holding && 'holding', !locked && 'movable')} style=${`left:${Math.max(0, xOf(g.start))}px;width:${Math.max(4, Math.min(width, xOf(g.end)) - Math.max(0, xOf(g.start)) - 2)}px`}
        title=${locked ? (a ? 'Click to hold here' : `${clock(g.start)}–${clock(g.end)}`) : `${a ? 'Click: hold. ' : ''}Drag an edge, or the middle to move it`}
        onPointerDown=${(e) => loopDown(e, i)}>${holding ? '⟳ ' : ''}${g.name || `Loop ${i + 1}`}</button>`;
    })}</div>`}
    <div class="mstrip" data-markers onPointerDown=${stripDown} onPointerMove=${stripMove} onPointerUp=${stripUp} onPointerCancel=${stripUp} onContextMenu=${context}
      title=${locked ? '' : 'Drag here: a new marker. Right-click: add one.'}>
      ${markers.map((m, i) => (inView(m.at) ? html`<div key=${i} data-mflag=${i} class=${cx('mflag', msel === i && 'on', !locked && 'movable')} style=${`left:${left(m.at)}`}
        onPointerDown=${(e) => markerDown(e, i)}
        onDblClick=${(e) => { e.stopPropagation(); if (!locked) setNaming(i); }} title=${locked ? `${m.name} · ${clock(m.at, 2)}` : `${m.name} · ${clock(m.at, 2)}: drag to move, double-click to rename, ⌥-click to remove`}>
        ${naming === i ? html`<input class="mname" data-marker-name value=${m.name} ref=${(el) => { if (el && !el.dataset.held) { el.dataset.held = '1'; el.focus(); el.select(); } }}
            onPointerDown=${(e) => e.stopPropagation()} onBlur=${(e) => { if (naming === i) rename(i, e.target.value); }}
            onKeyDown=${(e) => { e.stopPropagation(); if (e.key === 'Enter') rename(i, e.target.value); if (e.key === 'Escape') setNaming(-1); }} />`
          : html`<span>${m.name}</span>`}</div>` : null))}
      ${markerTip ? html`<div class="mtip mono" style=${`left:${left(markerTip.at)}`}>${clock(markerTip.at, 2)}</div>` : null}
      ${loopTip ? html`<div class="mtip mono" style=${`left:${left(loopTip.start)}`}>${clock(loopTip.start, 2)} – ${clock(loopTip.end, 2)}</div>` : null}
    </div>
    ${menu && menu.kind === 'marker' ? html`<div class="popover wave-menu" data-marker-menu style=${`left:${Math.min(menu.left, Math.max(0, width - 170))}px`}>
      <button class="sd-menu-item" data-add-marker-here onClick=${() => addMarkerAt(menu.t)}>Add marker here · ${clock(menu.t, 1)}</button>
      ${menu.i >= 0 ? html`<button class="sd-menu-item" onClick=${() => { setMenu(null); setNaming(menu.i); }}>Rename</button><button class="sd-menu-item danger" onClick=${() => { setMenu(null); removeMarker(menu.i); }}>Remove marker</button>` : null}
    </div>` : null}
    <div ref=${box} data-wavedit class=${cx('wave tall', !locked && 'drawing')} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onDblClick=${dbl} onContextMenu=${context}>
      <canvas ref=${canvas}></canvas>
      ${barsOf(cue.tempo, dur).filter(inView).map((t) => html`<div class="barline" style=${`left:${left(t)}`}></div>`)}
      ${markers.filter((m) => inView(m.at)).map((m) => html`<div class="marker" style=${`left:${left(m.at)}`}></div>`)}
      ${ghost ? html`<div class="ghost" style=${`left:${left(ghost.a)};width:${xOf(ghost.b) - xOf(ghost.a)}px`}><span>${clock(ghost.a, 2)} – ${clock(ghost.b, 2)}</span></div>` : null}
      ${dur > 0 ? html`<svg class="envelope" data-lane-svg=${spec.id} width=${width} height=${h}>
        ${spec.kind === 'volume' ? html`<line class="zero" x1="0" x2=${width} y1=${yOf(spec, 0, h)} y2=${yOf(spec, 0, h)} />` : spec.kind === 'pan' ? html`<line class="zero" x1="0" x2=${width} y1=${yOf(spec, 0, h)} y2=${yOf(spec, 0, h)} />` : null}
        ${others.map((x) => html`<path key=${x.id} class="other" d=${pathOf(x, Lanes.pointsOf(cue, x.id), Lanes.baseOf(cue, x))} />`)}
        <path class=${cx('line', !pts.length && 'flat')} d=${pathOf(spec, pts, base)} />
        ${pts.filter((p) => inView(p[0])).map((p) => { const k = pts.indexOf(p); return html`<circle key=${k} class=${cx(sel.has(k) && 'on')} cx=${xOf(p[0])} cy=${yOf(spec, p[1], h)} r="4" />`; })}
        ${box2 ? html`<rect class="selbox" x=${Math.min(box2.x0, box2.x1)} y=${Math.min(box2.y0, box2.y1)} width=${Math.abs(box2.x1 - box2.x0)} height=${Math.abs(box2.y1 - box2.y0)} />` : null}
      </svg>` : null}
      ${tipPt ? html`<div class="envtip" style=${`left:${left(tipPt[0])};top:${Math.max(0, yOf(spec, tipPt[1], h) - 20)}px`}>${clock(tipPt[0], 2)} · ${valueText(spec, tipPt[1])}</div>` : null}
      ${dur > 0 && inView(shownFrom) ? html`<div data-handle="start" class=${cx('handle start', drag && drag.kind === 'start' && 'on')} style=${`left:${left(shownFrom)}`} title="Start at"><i>S</i>${drag && drag.kind === 'start' ? html`<span>${clock(shownFrom, 2)}</span>` : null}</div>` : null}
      ${dur > 0 && inView(shownEnd) ? html`<div data-handle="end" class=${cx('handle end', drag && drag.kind === 'end' && 'on')} style=${`left:${left(shownEnd)}`} title="End at"><i>E</i>${drag && drag.kind === 'end' ? html`<span>${clock(shownEnd, 2)}</span>` : null}</div>` : null}
      ${position != null && dur > 0 && inView(position) ? html`<div class="cursor" style=${`left:${left(position)}`}></div>` : null}
      ${pin != null && dur > 0 && inView(pin) ? html`<div class="pin" style=${`left:${left(pin)}`}><span>${clock(pin)}</span></div>` : null}
      ${!data && file ? html`<div class="nothing" style="padding:0;position:absolute;inset:0;display:grid;place-items:center">${data === null ? 'No waveform for this file' : 'Reading the waveform…'}</div>` : null}
    </div>
    <div class="wavebar">
      <div class="seg"><button data-zoom="out" disabled=${view.zoom <= 1} onClick=${() => zoomTo(view.zoom / 2)} title="Zoom out">−</button>
        <button data-zoom="fit" disabled=${view.zoom <= 1} onClick=${() => setView({ zoom: 1, start: 0 })} >Fit</button>
        <button data-zoom="in" disabled=${view.zoom >= MAX_ZOOM || !dur} onClick=${() => zoomTo(view.zoom * 2, position != null && inView(position) ? position : undefined)} title=${keys('Zoom in (or ⌘-scroll)')}>+</button></div>
      <span class="dim mono">${view.zoom > 1 ? `${clock(start, 1)} – ${clock(start + span, 1)} · ×${Math.round(view.zoom * 10) / 10}` : dur ? clock(dur, 1) : ''}</span>
      <span class="grow"></span>
      <span class="dim wavehint">${locked ? 'Show mode: nothing moves.' : keys('Line: click adds · drag · ⌥ bends · ⌘ selects · double-click removes')}</span>
    </div>
  </div>`;
}
