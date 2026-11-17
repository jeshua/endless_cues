// The cue list's own tools for running a show: the line down a chain of continues, a playing row's level and its
// stop, and the list zoomed out to the whole show. The arithmetic is list-view.ts (`ListView`, loaded as a
// plain script by index.html); nothing here holds show state, and nothing here moves the playhead.
import { html, useState, useEffect, useLayoutEffect, useRef, useCallback, ec, cmd, cx } from './lib.js';
import type { Cue, ShowDoc, State, Row, Active } from './lib.js';
import type { RefObject } from 'preact';
import * as ListView from './list-view.js';
import type { ChainMark } from './list-view.js';

export const LV = ListView;

/** A bus as the mixer state has it: the show's, with what is happening on it. */
interface MixerBus { id: string; name: string; out?: number | string; noOutput?: boolean }
/** A row kept still while the zoom changes: the row, how far down it, and where it was in the list. */
interface Anchor { el: Element; frac: number; y: number }

// ── the chain: a thin grey line down the left of the linked rows (solid: starts with it; dotted: starts after it) ──
const X0 = 7, STEP = 5;              // where the list's line runs, and how far in a group's children's runs
export function chainLine(m: ChainMark | null | undefined) {
  if (!m) return null;
  const at = (d: number) => `left:${X0 + d * STEP}px`;
  return html`${m.through.map((t) => html`<span class=${`cline thru k-${t.kind}`} style=${at(t.depth)}></span>`)}${m.up ? html`<span class=${`cline up k-${m.up}`} style=${at(m.depth)}></span>` : null}${m.down ? html`<span class=${`cline down k-${m.down}`} style=${at(m.depth)}></span>` : null}${m.tick ? html`<span class="cline tick" style=${at(m.depth)}></span>` : null}`;
}

/** A chain's words, for a title: what the cue does to the next. */
export const LINK_SAYS: Record<string, string> = { 'auto-continue': 'starts the next with it', 'auto-follow': 'starts the next when it ends' };

// ── where a playing sound goes, and whether that is anywhere ──
/** { text, ok, why }: its bus (and that bus's pair) or its own outputs, and the output device; `ok` false when the
 *  device or the outputs it needs are not there (the row says so in danger). */
export function routeOf(c: Cue, s: State): { text: string; ok: boolean; why: string } {
  const m = s.mixer || {}, buses: MixerBus[] = m.buses || [];
  const device = ((m.devices || []).find((d: { id: string }) => d.id === m.device) || {}).label || 'System default output';
  let text: string, missing = false;
  const own = Array.isArray(c.outputs) && c.outputs.some((r) => r && Object.keys(r).length);
  if (own) {
    const outs = [...new Set(c.outputs!.flatMap((r) => Object.keys(r || {}).map(Number)))].sort((a, b) => a - b);
    text = outs.length === 1 ? `output ${outs[0]}` : `outputs ${outs.join(', ')}`;
    missing = m.outputs > 0 && outs.some((o) => o > m.outputs);
  } else {
    // (a cue with no bus, or one that is gone, plays where the engine puts it: Live.ts `busOf`)
    const b = buses.find((x) => x.id === c.bus) || buses[buses.length > 1 ? 1 : 0];
    const out = b ? Number(b.out) || 1 : 1;
    text = `${b ? b.name : 'bus'} → outputs ${out}–${out + 1}`;
    missing = !!(b && b.noOutput);
  }
  const gone = m.deviceOk === false || !!m.fallback;
  const ok = !missing && !gone;
  const why = gone ? (m.fallback ? `${m.fallback.label} is not connected` : 'the output device failed') : missing ? `${device} has no ${text.replace(/^.*→ /, '')}` : '';
  return { text: `${text} · ${m.fallback ? `${m.fallback.label} (not connected)` : device}`, ok, why };
}

/** A playing row's level and its stop. The first click fades it out over the panic time; a second click while it
 *  fades, or ⌥-click, stops it dead. The stop never takes the keyboard (Space stays GO). */
export function RowLive({ id, c, s, a, sounding, show }: { id: string; c: Cue; s: State; a: Active | null | undefined; sounding: boolean; show: boolean }) {
  const e = s.engine;
  const kids = (e.active as Active[]).filter((x) => x.kind === 'audio' && (x.id === id || x.parent === id));
  const fading = kids.some((x) => x.fadingTo != null);
  const stop = (ev: MouseEvent) => {
    ev.stopPropagation(); ev.preventDefault();
    if (ev.altKey || fading || !kids.length) cmd({ op: 'stop', id });
    else for (const x of kids) cmd({ op: 'stop', id: x.id, fade: true });
  };
  const levels: Record<string, number> = s.cueLevels || {};
  const peak = kids.reduce((p, x) => Math.max(p, levels[x.id] ?? -60), -60);
  const r = sounding && a && !a.picture ? routeOf(c.type === 'audio' || c.type === 'mic' ? c : ((s.doc && kids[0] && findCue(s.doc, kids[0].id)) || c), s) : null;
  return html`<span class=${cx('row-live', show && 'big')} onClick=${(ev: MouseEvent) => ev.stopPropagation()} onDblClick=${(ev: MouseEvent) => ev.stopPropagation()}>
    ${r ? html`<span class="row-meter" data-row-meter title=${r.ok ? r.text : `${r.text}\n${r.why}`}><i style=${`width:${Math.max(0, Math.min(100, ((peak + 60) / 60) * 100))}%`}></i></span>` : null}
    ${r && !r.ok ? html`<span class="row-nout" data-row-nout title=${r.why}>no output</span>` : null}
    <button class=${cx('row-stop', fading && 'fading')} data-row-stop tabindex="-1" onMouseDown=${(ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation(); }} onClick=${stop}
      title=${fading ? 'Fading out. Click: stop dead' : 'Stop: fades out · again or ⌥: stop dead'}>■</button>
  </span>`;
}
function findCue(doc: ShowDoc, id: string) {
  let found: Cue | null = null;
  const walk = (cues: Cue[] | undefined): void => { for (const c of cues || []) { if (found) return; if (c.id === id) { found = c; return; } walk(c.children); } };
  for (const l of doc.lists || []) walk(l.cues);
  return found;
}

// ── zoom: 1 the list as it is, 0 the whole show in the window ──
const NORMAL: Record<string, number> = { normal: 30, compact: 22, large: 38 };
const HEAD_MIN = 18;                 // a section heading never gets thinner than this: it stays readable
/**
 * The list's zoom. Pinch (or ⌘-scroll), ⌘− ⌘=, the header's button. It is drawn by setting a few properties on the
 * list (no redraw of the rows), so a pinch is smooth; the row under the pointer stays under it. Kept per show on this
 * computer (config.json, `list-zoom`), never in the show. Returns { z, overview, step, toggle, zoomAt }.
 */
export function useListZoom(wrap: RefObject<HTMLElement>, { dir, rowSize, rows }: { dir: string | null | undefined; rowSize: string; rows: Row[] }) {
  const zRef = useRef(1);
  const [mode, setMode] = useState({ zoomed: false, overview: false });
  const anim = useRef(0), keep = useRef<() => void>(() => {});
  const normal = NORMAL[rowSize] || NORMAL.normal;
  const counts = useRef({ cues: 0, heads: 0 });
  counts.current = { cues: rows.filter((r) => !r.heading).length, heads: rows.filter((r) => r.heading).length };

  // the zoom drawn: the properties the stylesheet reads, and the row at `anchor` ({ el, frac, y }) kept where it was
  const apply = useCallback((z: number, anchor?: Anchor | null) => {
    const el = wrap.current; if (!el) return;
    z = LV.clamp01(z); zRef.current = z;
    const head = el.querySelector<HTMLElement>('thead');
    const avail = el.clientHeight - (head ? head.offsetHeight : 24) - 4;
    const { cues, heads } = counts.current;
    // (each row has a 1 px line under it, which does not shrink)
    const fit = LV.fitHeight(avail - cues - heads, cues, heads, HEAD_MIN, normal);
    const h = LV.rowHeight(z, normal, fit);
    const zs = h / normal, op = Math.max(0, Math.min(1, (h - 9) / 9));
    if (z >= 0.999) { for (const p of ['--zrow', '--zs', '--zop', '--zhead', '--zhs']) el.style.removeProperty(p); }
    else {
      el.style.setProperty('--zrow', `${h}px`); el.style.setProperty('--zs', String(zs)); el.style.setProperty('--zop', String(op));
      el.style.setProperty('--zhead', `${Math.max(HEAD_MIN, h + 8)}px`); el.style.setProperty('--zhs', String(Math.max(0.72, zs)));
    }
    const next = { zoomed: z < 0.999, overview: z < 0.999 && op < 0.5 };
    setMode((m) => (m.zoomed === next.zoomed && m.overview === next.overview ? m : next));
    if (z < 0.999) el.classList.add('zoomed'); else el.classList.remove('zoomed');      // (now, not at the next draw: no frame at the wrong size)
    if (anchor && anchor.el && anchor.el.isConnected) {
      const box = el.getBoundingClientRect(), r = anchor.el.getBoundingClientRect();
      el.scrollTop += (r.top + anchor.frac * r.height) - (box.top + anchor.y);
    }
    keep.current();
  }, [normal]);

  // the row at a height in the list (clientY), and how far down it the point is
  const anchorAt = (clientY: number): Anchor | null => {
    const el = wrap.current; if (!el) return null;
    const box = el.getBoundingClientRect(), y = clientY - box.top;
    const trs = el.querySelectorAll('tbody tr');
    for (const tr of trs) { const r = tr.getBoundingClientRect(); if (r.bottom >= clientY) return { el: tr, frac: Math.max(0, Math.min(1, (clientY - r.top) / Math.max(1, r.height))), y }; }
    return trs.length ? { el: trs[trs.length - 1], frac: 1, y } : null;
  };
  // the row to keep still for a key or the button: the one selected or standing by if it is in view, or the middle
  const anchorKept = (): Anchor | null => {
    const el = wrap.current; if (!el) return null;
    const box = el.getBoundingClientRect();
    for (const q of ['tr.sel', 'tr.head']) { const tr = el.querySelector(q); if (tr) { const r = tr.getBoundingClientRect(); if (r.bottom > box.top && r.top < box.bottom) return { el: tr, frac: 0.5, y: r.top + r.height / 2 - box.top }; } }
    return anchorAt(box.top + box.height / 2);
  };

  // a smooth move to `to`, the anchor kept (and, with `toY`, brought to that height on the way)
  const glide = useCallback((to: number, anchor: Anchor | null, toY: number | null = null) => {
    cancelAnimationFrame(anim.current);
    const from = zRef.current, y0 = anchor ? anchor.y : 0, t0 = performance.now(), ms = 220;
    const frame = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), ease = 1 - Math.pow(1 - k, 3);
      apply(from + (to - from) * ease, anchor ? { ...anchor, y: toY == null ? y0 : y0 + (toY - y0) * ease } : null);
      if (k < 1) anim.current = requestAnimationFrame(frame);
    };
    anim.current = requestAnimationFrame(frame);
  }, [apply]);

  const step = useCallback((dirn: number) => glide(LV.clamp01(zRef.current + dirn * 0.25), anchorKept()), [glide]);
  const toggle = useCallback(() => glide(zRef.current < 0.999 ? 1 : 0, anchorKept()), [glide]);
  /** A click on the zoomed-out list: back to normal there, with that row brought to the middle. */
  const zoomAt = useCallback((clientY: number) => { const a = anchorAt(clientY); const el = wrap.current; glide(1, a, el ? el.clientHeight / 2 : null); }, [glide]);

  // pinch (the trackpad sends it as a wheel with ctrl held) and ⌘-scroll; anything else scrolls as ever
  useEffect(() => {
    const el = wrap.current; if (!el) return undefined;
    const wheel = (ev: WheelEvent) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      cancelAnimationFrame(anim.current);
      apply(zRef.current - ev.deltaY * 0.004, anchorAt(ev.clientY));      // (a full pinch, about 250 px of it, is the whole range)
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [apply]);

  // kept per show: read when the show is opened, written a moment after it stops changing
  const loaded = useRef<string | null>(null), dirNow = useRef(dir), timer = useRef<ReturnType<typeof setTimeout>>();
  dirNow.current = dir;
  useEffect(() => {
    loaded.current = null;
    if (!dir) { apply(1); return; }
    ec.app({ op: 'list-zoom', dir }).then((r) => { if (dirNow.current !== dir) return; apply(r && Number.isFinite(r.z) ? r.z : 1); loaded.current = dir; });
  }, [dir]);
  keep.current = () => {
    const d = dirNow.current;
    if (!d || loaded.current !== d) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => ec.app({ op: 'list-zoom', dir: d, z: Math.round(zRef.current * 1000) / 1000 }), 500);
  };
  // the rows that fit change with the window and with what is folded: the zoom stays, the height follows
  useLayoutEffect(() => { if (zRef.current < 0.999) apply(zRef.current); }, [rows.length, normal]);
  useEffect(() => {
    const el = wrap.current; if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { if (zRef.current < 0.999) apply(zRef.current); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [apply]);

  return { z: zRef, zoomed: mode.zoomed, overview: mode.overview, step, toggle, zoomAt, reset: () => glide(1, anchorKept()) };
}
/** The list's zoom, as `useListZoom` hands it over. */
export type ListZoom = ReturnType<typeof useListZoom>;
