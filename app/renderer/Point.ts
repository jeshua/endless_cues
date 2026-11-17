// The assistant pointing at a place in the window (its tool show_in_app; the places are core/ui/places.ts). The host
// pushes the place (`s.point`); this brings it into view with the place's own steps (Settings at a pane, the cue
// list, a cue selected, an inspector tab, More), rings it with a calm pulse and a few words beside it, and tells the
// host whether it could. The ring takes no clicks and no keyboard, and goes after a few seconds or at the first
// click or key. Nothing here edits or plays anything; in Show mode nothing is pointed at.
import { useEffect, useRef, cmd } from './lib.js';
import type { State } from './lib.js';

/** A step that brings a place on screen (core/ui/places.ts). */
export interface PlaceStep { do: 'settings' | 'cues' | 'reveal' | 'select' | 'tab' | 'more'; section?: string; cue?: string; types?: string[]; tab?: string }
/** A place as the host sends it (core/ui/places.ts `resolve`), `say` the assistant's words beside the ring. */
export interface Place { label: string; sel: string; steps?: PlaceStep[]; settings?: boolean; fallback?: Place; absent?: string; menu?: string; say?: string }
/** The window's part in pointing: what it shows, and how to change that. `choose` answers why it could not, or ''. */
export interface PointUI {
  mode: () => string | undefined;
  settingsOpen: () => boolean;
  openSettings: (section: string | undefined) => void;
  closeSettings: () => void;
  showCues: () => void;
  reveal: (id: string) => void;
  choose: (step: PlaceStep) => string;
}
/** What pointing came to. */
export interface Pointed { ok: boolean; why?: string; instead?: string }

const RING_MS = 6000;
let ring: { box: HTMLElement; say: HTMLElement; el: Element; until: number; raf: number; off: () => void } | null = null;

function unring() {
  if (!ring) return;
  cancelAnimationFrame(ring.raf);
  ring.off();
  ring.box.remove(); ring.say.remove();
  ring = null;
}

const shown = (el: Element | null) => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

/** Ring `el` with `words` beside it, following it if it moves, until the time is up or the person does anything. */
export function ringOf(el: Element, words: string) {
  unring();
  const box = document.createElement('div'); box.className = 'point-ring'; box.dataset.pointRing = '';
  const say = document.createElement('div'); say.className = 'point-say'; say.dataset.pointSay = ''; say.textContent = words || '';
  if (!words) say.style.display = 'none';
  document.body.append(box, say);
  // (any click or key ends it, and is let through: the ring is never in the way)
  const end = () => unring();
  window.addEventListener('mousedown', end, true); window.addEventListener('keydown', end, true);
  const off = () => { window.removeEventListener('mousedown', end, true); window.removeEventListener('keydown', end, true); };
  ring = { box, say, el, until: Date.now() + RING_MS, raf: 0, off };
  const place = () => {
    if (!ring || ring.box !== box) return;
    if (Date.now() > ring.until || !el.isConnected) { unring(); return; }
    const r = el.getBoundingClientRect(), pad = 4;
    Object.assign(box.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    // the words beside a small thing (to its right, where they cover least of what is near it), else below it, or
    // above when there is no room; kept inside the window
    const w = say.offsetWidth, h = say.offsetHeight;
    if (r.width < innerWidth / 3 && r.right + pad + 10 + w < innerWidth - 8) {
      say.style.left = `${r.right + pad + 10}px`;
      say.style.top = `${Math.max(8, Math.min(r.top + r.height / 2 - h / 2, innerHeight - h - 8))}px`;
    } else {
      const below = r.bottom + pad + 8 + h < innerHeight - 8;
      say.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
      say.style.top = `${below ? r.bottom + pad + 8 : Math.max(8, r.top - pad - 8 - h)}px`;
    }
    ring.raf = requestAnimationFrame(place);
  };
  place();
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The place's element once it is drawn (the steps before it take a frame or two to show), or null. */
async function found(sel: string, ms = 900) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const el = [...document.querySelectorAll(sel)].find(shown);
    if (el) return el;
    await wait(40);
  }
  return null;
}

/**
 * Bring `place` into view and ring it. `ui` is the window's: { mode, settingsOpen, openSettings, closeSettings,
 * showCues, reveal, choose({ cue, types }) → why or '' }. Resolves { ok, why, instead }.
 */
export async function pointAt(place: Place | null | undefined, ui: PointUI): Promise<Pointed> {
  if (!place) return { ok: false, why: 'nothing to show' };
  if (ui.mode() === 'show') return { ok: false, why: 'Show mode' };
  if (place.settings) ui.openSettings(place.steps!.find((x) => x.do === 'settings')!.section);
  else if (ui.settingsOpen()) ui.closeSettings();
  let more = false;
  for (const step of place.steps || []) {
    if (step.do === 'cues') ui.showCues();
    else if (step.do === 'reveal') ui.reveal(step.cue!);
    else if (step.do === 'select') { const why = ui.choose(step); if (why) return { ok: false, why }; }
    else if (step.do === 'tab') { await wait(30); window.dispatchEvent(new CustomEvent('ec-reveal', { detail: { tab: step.tab } })); }
    else if (step.do === 'more') more = true;
  }
  let el = await found(place.sel, more ? 300 : 900);
  // (a field kept under More: More opens, and it is looked for again)
  if (!el && more) { window.dispatchEvent(new CustomEvent('ec-reveal', { detail: { more: true } })); el = await found(place.sel); }
  if (!el && place.fallback) {
    const r = await pointAt({ ...place.fallback, say: place.say }, ui);
    return r.ok ? { ...r, instead: place.absent || `${place.label} is not on screen, so ${place.fallback.label} is` } : r;
  }
  if (!el) return { ok: false, why: place.absent || `${place.label} is not on the screen` };
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  await wait(30);
  // a menu item cannot be ringed: the button that opens its menu is, with the item named
  const words = place.say || (place.menu ? `${place.label} is in here` : place.label);
  ringOf(el, place.menu && place.say ? `${place.say} (⋯ ▸ ${place.label})` : words);
  return { ok: true };
}

/** The main window's part: each place the host pushes is shown once, and answered. */
export function usePointer(s: State | null, ui: PointUI) {
  const done = useRef<unknown>(0);
  const uiRef = useRef(ui); uiRef.current = ui;
  const p = (s && s.point) as (Place & { id: number }) | null;      // (the host sends what core/ui/places.ts resolved)
  useEffect(() => {
    if (!p || p.id === done.current) return;
    done.current = p.id;
    pointAt(p, uiRef.current).then((r) => cmd({ op: 'pointed', id: p.id, ...r })).catch((err: Error) => cmd({ op: 'pointed', id: p.id, ok: false, why: err.message }));
  }, [p && p.id]);
  // Show mode: a ring still showing goes at once
  useEffect(() => { if (s && s.mode === 'show') unring(); }, [s && s.mode]);
}
