/**
 * Keys and MIDI controls mapped to the Live view's desk (the show's settings.live.map).
 *
 * A mapping is { on, to }:
 *
 *   on    'key q'  ·  'note 60 ch 1'  ·  'cc 7 ch 1'           what is pressed or moved
 *   to    'launch:<cue id>'                                    a clip or a scene, launched as its ▶ does
 *         'stop:<bus>'  ·  'stopall'                           a track's ■, Stop All Clips
 *         'mute:<bus>'  ·  'solo:<bus>'                        the track's on/off button, its solo
 *         'fader:<bus>' · 'pan:<bus>' · 'eq.low:<bus>' · 'eq.mid:<bus>' · 'eq.high:<bus>' · 'filter:<bus>'
 *         'crossfader'  ·  'master'
 *
 * A button (launch, stop, mute, solo) answers a key going down, a note on, or a controller arriving at 64 or
 * more. A continuous control follows a controller's value across its whole travel, with its rest in the middle
 * where it has one (pan, the eq, the filter, the crossfader); a key or a note sends it back to rest.
 *
 * actionOf turns one arriving input into what the host should do. What a controller moves is the desk as it
 * is played, not the show: the host lays it over the saved settings, as it does a Mix cue's.
 */
/** One mapping of the show's map: what is pressed or moved, and what it does. */
export interface Mapping { on: string; to: string }
/** An `on` read: a key, or a MIDI note or controller on a channel. */
export type MapInput = { type: 'key'; key: string } | { type: 'cc' | 'note'; number: number; channel: number };
/** An input arriving (a key: value 1 down, 0 up). */
export interface Arrived { type: string; value?: unknown }
/** A decoded MIDI message, as much of it as a mapping reads. */
export interface MidiIn { kind: string; channel?: number; number?: number; value?: number | null }

const BUTTONS = ['launch', 'stop', 'mute', 'solo'];
const CONTINUOUS = ['fader', 'pan', 'eq.low', 'eq.mid', 'eq.high', 'filter'];
const ALONE = ['stopall', 'crossfader', 'master'];
// keys that are the app's everywhere, and cannot be given away
const RESERVED = new Set([' ', 'escape', 'enter', 'tab', 'backspace', 'delete', '[', ']', 'shift', 'control', 'alt', 'meta', 'capslock']);

/** 'fader:music' → { what: 'fader', arg: 'music' }; null when it is not a target. */
function parseTo(to: unknown) {
  const t = String(to || ''), i = t.indexOf(':');
  const what = i < 0 ? t : t.slice(0, i), arg = i < 0 ? '' : t.slice(i + 1);
  if (ALONE.includes(what)) return arg ? null : { what, arg: '' };
  if ((BUTTONS.includes(what) || CONTINUOUS.includes(what)) && arg) return { what, arg };
  return null;
}
/** 'cc 7 ch 1' → { type: 'cc', number: 7, channel: 1 }; 'key q' → { type: 'key', key: 'q' }; null otherwise. */
function parseOn(on: unknown): MapInput | null {
  const t = String(on || '').trim().toLowerCase();
  let m = /^key (\S+)$/.exec(t);
  if (m) return RESERVED.has(m[1]) ? null : { type: 'key', key: m[1] };
  m = /^(cc|note) (\d{1,3})(?: ch (\d{1,2}))?$/.exec(t);
  if (m && Number(m[2]) <= 127) return { type: m[1] as 'cc' | 'note', number: Number(m[2]), channel: Math.max(1, Math.min(16, Number(m[3]) || 1)) };
  return null;
}
/** A key the page saw, as an `on` (null: a key that cannot be mapped, or one held with ⌘, Ctrl or Alt). */
function onOfKey(key: unknown, { meta = false, ctrl = false, alt = false } = {}) {
  const k = String(key || '').toLowerCase();
  if (meta || ctrl || alt || !k || RESERVED.has(k) || k.length > 12) return null;
  return `key ${k}`;
}
/** A decoded MIDI message (core/net/midi.ts) as an `on` and the value it carries (null: not something to map). */
function onOfMidi(msg: MidiIn | null | undefined) {
  if (!msg) return null;
  const ch = msg.channel || 1;
  if (msg.kind === 'cc') return { on: `cc ${msg.number} ch ${ch}`, value: msg.value };
  if (msg.kind === 'note') return { on: `note ${msg.number} ch ${ch}`, value: msg.value == null ? 100 : msg.value };
  if (msg.kind === 'noteoff') return { on: `note ${msg.number} ch ${ch}`, value: 0 };
  return null;
}

/** A fader's travel (0 … 1) as dB, by the law the faders on screen are drawn with: −60 … +12, 0 dB about three quarters up. */
function faderDb(p: unknown) {
  const x = Math.max(0, Math.min(1, Number(p) || 0));
  return x <= 0.001 ? -60 : Math.round((Math.pow(x, 1 / 2.2) * 72 - 60) * 2) / 2;
}
/** A controller's 0 … 127 across −1 … +1, with 64 the middle exactly. */
const bipolar = (v: number) => (v >= 64 ? (v - 64) / 63 : (v - 64) / 64);

/**
 * What one input does to one target. `input`: { type: 'key' | 'note' | 'cc', value } (a key: value 1 down).
 * Returns a command for the host, or null (a release, a target that is not one).
 *
 *   { op: 'launch', id } · { op: 'stop-track', name } · { op: 'stop-clips' } · { op: 'mute', name } · { op: 'solo', name }
 *   { op: 'desk-live', key, value, name? }      key: 'db' | 'pan' | 'eq.low' | … | 'filter' | 'crossfader' | 'master'
 */
function actionOf(to: unknown, input: Arrived | null | undefined) {
  const t = parseTo(to);
  if (!t || !input) return null;
  const v = Math.max(0, Math.min(127, Number(input.value) || 0));
  const pressed = input.type === 'cc' ? v >= 64 : v > 0;
  if (BUTTONS.includes(t.what) || t.what === 'stopall') {
    if (!pressed) return null;
    return t.what === 'launch' ? { op: 'launch', id: t.arg } : t.what === 'stop' ? { op: 'stop-track', name: t.arg } : t.what === 'stopall' ? { op: 'stop-clips' } : { op: t.what, name: t.arg };
  }
  const key = t.what === 'fader' ? 'db' : t.what;
  const name = t.arg ? { name: t.arg } : {};
  if (input.type !== 'cc') return pressed ? { op: 'desk-live', key, value: 0, ...name } : null;       // a key or a note: back to rest
  const x = bipolar(v);
  const value = key === 'db' || key === 'master' ? faderDb(v / 127)
    : key.startsWith('eq.') ? Math.round((x < 0 ? x * 40 : x * 6) * 2) / 2
    : Math.round(x * 100) / 100;
  return { op: 'desk-live', key, value, ...name };
}

/** The show's map made safe: each `on` once (the last stands), nothing that is not a mapping. */
function cleanMap(list: unknown): Mapping[] {
  const seen = new Map<string, Mapping>();
  for (const m of Array.isArray(list) ? list : []) {
    if (!m || !parseTo(m.to)) continue;
    const on = parseOn(m.on);
    if (!on) continue;
    const text = on.type === 'key' ? `key ${on.key}` : `${on.type} ${on.number} ch ${on.channel}`;
    seen.delete(text);
    seen.set(text, { on: text, to: String(m.to) });
  }
  return [...seen.values()].slice(-256);
}
/** A map with `on` given to `to`: what `on` did before it no longer does, and the target's other mapping of
 *  the same sort (its other key, or its other MIDI control) is replaced. `on` null: the target's mappings go. */
function assign(map: unknown, on: string | null | undefined, to: string) {
  const sort = (text: unknown) => (String(text).startsWith('key ') ? 'key' : 'midi');
  const kept = cleanMap(map).filter((m) => (on == null ? m.to !== to : m.on !== on && !(m.to === to && sort(m.on) === sort(on))));
  return on == null ? kept : cleanMap([...kept, { on, to }]);
}
/** The mappings an input sets off. */
function matching(map: unknown, on: string) { return cleanMap(map).filter((m) => m.on === on); }

export { parseTo, parseOn, onOfKey, onOfMidi, actionOf, cleanMap, assign, matching, faderDb };
