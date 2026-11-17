/**
 * A bus's channel strip (the Live view's mixer): what its settings mean as numbers the audio window can set.
 *
 * A bus in the show file is { id, name, db } and, only when they are not at rest:
 *
 *   eq: { low, mid, high }   dB, −40 (killed) … +6
 *   filter                   −1 … +1: left of centre a low-pass closing down, right a high-pass opening up; 0 is out
 *   pan                      −1 (left) … +1 (right)
 *   mute                     true: silent
 *   xf                       'a' | 'b': which side of the crossfader it is on ('' or absent: neither)
 *
 * and the show's settings.audio.crossfader is −1 (all A) … +1 (all B). Solo is not in the show: it is the
 * operator's ear for a moment, kept by the host and gone when a show is opened.
 *
 * Everything at rest (no eq, filter out, centre pan, not muted, crossfader in the middle) changes nothing.
 */
import type { Desk } from '../show/types';

/** A bus as its strip reads it: the show's bus (settings.audio.buses), with whatever is live laid over. */
export interface StripBus { id: string; name?: string; eq?: Record<string, unknown>; filter?: unknown; pan?: unknown; mute?: unknown; xf?: unknown }
/** One bus's settings in a kept desk: only what is not at rest. */
export type DeskStrip = NonNullable<Desk['buses']>[string];
/** A desk as cleanDesk and deskOf make it: every bus it names, and the crossfader when it has one. */
export interface DeskValue { buses: Record<string, DeskStrip>; crossfader?: number }
/** A strip setting's value made safe: a number, a switch, or a side of the crossfader. */
export type StripValue = number | boolean | string;

const EQ_MIN = -40, EQ_MAX = 6;
const clamp = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || 0));

/** The filter knob as a filter: null when it is out. The sweep is even to the ear (exponential in Hz). */
function filterOf(v: unknown): { type: 'lowpass' | 'highpass'; hz: number } | null {
  const x = clamp(v, -1, 1);
  if (Math.abs(x) < 0.02) return null;
  return x < 0 ? { type: 'lowpass', hz: Math.round(20000 * (80 / 20000) ** -x) } : { type: 'highpass', hz: Math.round(20 * (8000 / 20) ** x) };
}

/** A side's gain at a crossfader position: full from its own end to the centre, then an equal-power fall to nothing. */
function crossGain(side: unknown, x: unknown) {
  const p = clamp(x, -1, 1);
  const away = side === 'a' ? p : side === 'b' ? -p : 0;
  return away <= 0 ? 1 : Math.round(Math.cos(away * Math.PI / 2) * 1e4) / 1e4;
}

/** What the audio window is told about one bus: { name, low, mid, high, filter, pan, gate } (gate: 0 … 1). */
function stripOf(bus: StripBus, { solo = [], crossfader = 0 }: { solo?: string[]; crossfader?: number } = {}) {
  const eq: Record<string, unknown> = bus.eq || {};
  const soloed = solo.length > 0;
  const silent = !!bus.mute || (soloed && !solo.includes(bus.id));
  return {
    name: bus.id,
    low: clamp(eq.low, EQ_MIN, EQ_MAX), mid: clamp(eq.mid, EQ_MIN, EQ_MAX), high: clamp(eq.high, EQ_MIN, EQ_MAX),
    filter: filterOf(bus.filter),
    pan: clamp(bus.pan, -1, 1),
    gate: silent ? 0 : crossGain(bus.xf, crossfader),
  };
}

/** The strip settings a command may set, and each one's value made safe. Returns undefined for anything else. */
function cleanSetting(key: string, value: unknown): StripValue | undefined {
  switch (key) {
    case 'eq.low': case 'eq.mid': case 'eq.high': return Math.round(clamp(value, EQ_MIN, EQ_MAX) * 2) / 2;
    case 'filter': case 'pan': { const v = Math.round(clamp(value, -1, 1) * 100) / 100; return Math.abs(v) < 0.02 ? 0 : v; }
    case 'mute': return !!value;
    case 'xf': return value === 'a' || value === 'b' ? value : '';
    default: return undefined;
  }
}

/** A bus with one setting changed (not written anywhere: for the sound while a knob is being turned). */
function withSetting<B extends StripBus>(bus: B, key: string, value: unknown): B {
  const v = cleanSetting(key, value);
  if (v === undefined) return bus;
  if (key.startsWith('eq.')) return { ...bus, eq: { ...(bus.eq || {}), [key.slice(3)]: v } };
  return { ...bus, [key]: v };
}

// ── a whole desk, kept and recalled (a Mix cue's `desk`) ────────────────────────────────────────────────────
//
// A desk is { crossfader, buses: { <bus id>: { eq: { low, mid, high }, filter, pan, mute, xf } } }, written like a
// bus's own settings: only what is not at rest. Recalling one puts every strip setting of each bus it names
// where the desk has it (what the desk leaves out goes to rest), and the crossfader if it names it; a bus it
// does not name stays where it is. Fader levels are not in it: a Mix cue's `levels` has those.
const STRIP_KEYS = ['eq.low', 'eq.mid', 'eq.high', 'filter', 'pan', 'mute', 'xf'];
const atRest = (v: unknown) => v === 0 || v === false || v === '' || v === undefined;
const read = (bus: object, key: string) => key.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), bus);

/** A bus's strip settings as { 'eq.low': …, filter: …, … }: every key, the ones at rest too. */
function settingsOf(bus: Omit<StripBus, 'id'> | null | undefined): Record<string, StripValue | undefined> {
  return Object.fromEntries(STRIP_KEYS.map((k) => [k, cleanSetting(k, read(bus || {}, k))]));
}
/** A bus with strip settings laid over it ({ 'eq.low': …, pan: … }: a Mix cue's recall, a controller's move). */
function withSettings<B extends StripBus>(bus: B, over: Record<string, unknown> | null | undefined): B {
  let b = bus;
  for (const [k, v] of Object.entries(over || {})) b = withSetting(b, k, v);
  return b;
}
/** The desk as it stands: `buses` are the show's (settings.audio.buses), with anything live already laid over. */
function deskOf(buses: StripBus[] | null | undefined, crossfader: unknown = 0): DeskValue {
  const out: DeskValue = { buses: {} };
  for (const b of buses || []) {
    const mine: DeskStrip & Record<string, unknown> = {};
    for (const [k, v] of Object.entries(settingsOf(b))) { if (atRest(v)) continue; if (k.startsWith('eq.')) (mine.eq = mine.eq || {})[k.slice(3)] = v as number; else mine[k] = v; }
    out.buses[b.id] = mine;
  }
  const x = Math.round(clamp(crossfader, -1, 1) * 100) / 100;
  out.crossfader = x;
  return out;
}
/** A desk made safe to keep in a cue: null when it is not one. */
function cleanDesk(d: unknown): DeskValue | null {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const out: DeskValue = { buses: {} };
  for (const [id, b] of Object.entries((d as Desk).buses && typeof (d as Desk).buses === 'object' && !Array.isArray((d as Desk).buses) ? (d as Desk).buses! : {})) {
    if (!b || typeof b !== 'object' || /^(__proto__|constructor|prototype)$/.test(id)) continue;
    out.buses[id] = deskOf([{ id, ...b }]).buses[id];
  }
  if ((d as Desk).crossfader !== undefined && Number.isFinite(Number((d as Desk).crossfader))) out.crossfader = Math.round(clamp((d as Desk).crossfader, -1, 1) * 100) / 100;
  return out;
}
/** What recalling a desk sets: { buses: { id: { every strip key: value } }, crossfader | undefined }. */
function recallOf(desk: unknown) {
  const d: DeskValue = cleanDesk(desk) || { buses: {} };
  return { buses: Object.fromEntries(Object.entries(d.buses).map(([id, b]) => [id, settingsOf(b)])), crossfader: d.crossfader };
}
/** A desk in a few words, for a cue's row and its inspector. */
function deskText(desk: unknown, names: Record<string, string> = {}) {
  const d = cleanDesk(desk);
  if (!d) return '';
  const parts: string[] = [];
  for (const [id, b] of Object.entries(d.buses)) {
    const bits = [b.mute ? 'muted' : '', b.eq ? 'eq' : '', b.filter ? 'filter' : '', b.pan ? `pan ${b.pan < 0 ? 'L' : 'R'}` : '', b.xf ? b.xf.toUpperCase() : ''].filter(Boolean);
    parts.push(`${names[id] || id}: ${bits.join(', ') || 'at rest'}`);
  }
  if (d.crossfader !== undefined) parts.push(`crossfader ${d.crossfader === 0 ? 'centre' : d.crossfader < 0 ? `${Math.round(-d.crossfader * 100)}% A` : `${Math.round(d.crossfader * 100)}% B`}`);
  return parts.join(' · ');
}

export { stripOf, filterOf, crossGain, cleanSetting, withSetting, withSettings, settingsOf, deskOf, cleanDesk, recallOf, deskText, STRIP_KEYS, EQ_MIN, EQ_MAX };
