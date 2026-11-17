// Shared by every component: the view library (Preact + htm, vendored: no build step, no network) and small formatters.
export { h, html, render, Component, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from './vendor/preact-htm.js';

export const ec = window.ec;

/** A command to the show host. A refusal ({ error }) is shown as a toast by whoever set `onError`. */
let onError = () => {};
export function setErrorHandler(fn) { onError = fn; }
export async function cmd(c) {
  const r = await ec.cmd(c);
  if (r && r.error) onError(r.error);
  return r;
}
/** One undoable edit. */
export const edit = (ops, label = '') => cmd({ op: 'edit', ops: [].concat(ops), label });
export const setCue = (ids, props, label = '') => edit([].concat(ids).map((id) => ({ op: 'cue.set', id, props })), label);

export function clock(secs, places = 1) {
  if (!Number.isFinite(secs)) return '';
  const neg = secs < 0; secs = Math.abs(secs);
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  const ss = places ? s.toFixed(places).padStart(places + 3, '0') : String(Math.floor(s)).padStart(2, '0');
  return (neg ? '−' : '') + (h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`);
}
export function db(v, unit = true) {
  if (v === undefined || v === null || v === '') return '';
  const n = Number(v);
  if (n <= -60) return '−∞';
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n * 10) / 10)}${unit ? ' dB' : ''}`;
}
/** A typed time as seconds: "90", "1:30", "1:02:03.5"; a leading minus is kept (Load to Time: back from the end). NaN when it is not one. */
export function parseTime(text) {
  const t = String(text).trim().replace('−', '-');
  const neg = t.startsWith('-'), s = neg ? t.slice(1) : t;
  let n = NaN;
  if (/^\d+(\.\d+)?$/.test(s)) n = Number(s);
  else { const m = s.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/); if (m) n = Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]); }
  return neg ? -n : n;
}
export const cx = (...parts) => parts.filter(Boolean).join(' ');
export const isMac = navigator.platform.toLowerCase().includes('mac');
export const mod = (e) => (isMac ? e.metaKey : e.ctrlKey);
/** A shortcut as this platform writes it: ⌘S on a Mac, Ctrl+S elsewhere. */
export const keys = (text) => (isMac ? text : text.replace(/⇧⌘/g, 'Ctrl+Shift+').replace(/⌥⌘/g, 'Ctrl+Alt+').replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+').replace(/⌫/g, 'Delete'));

/** Whether the keyboard is in a field being typed in (the show's keys work everywhere else). */
export function typingIn(el = document.activeElement) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return !['checkbox', 'radio', 'range', 'button', 'submit'].includes(el.type);
  return false;
}

/** Every cue of a list, flattened for the table: [{ cue, depth, parent }]. */
// The rows as drawn. A section (a heading, core/show/sections.js) holds the top-level rows after it up to the next
// one: folded, they are left out as a folded group's children are. Each row says the section it is in (`section`).
export function flatten(cues, collapsed, depth = 0, parent = null, out = [], within = null) {
  let sec = within, shut = false;
  for (const c of cues || []) {
    if (!depth && c.type === 'section') { sec = c; shut = collapsed.has(c.id); out.push({ cue: c, depth, parent, heading: true }); continue; }
    if (shut) continue;
    out.push({ cue: c, depth, parent, section: sec });
    if (c.children && !collapsed.has(c.id)) flatten(c.children, collapsed, depth + 1, c, out, sec);
  }
  return out;
}
/** The sections of a list: [{ cue, ids }], `ids` every cue under it (in its groups too). */
export function sectionsIn(cues) {
  const out = [];
  const all = (c, set) => { set.add(c.id); for (const k of c.children || []) all(k, set); };
  for (const c of cues || []) { if (c.type === 'section') out.push({ cue: c, ids: new Set() }); else if (out.length) all(c, out[out.length - 1].ids); }
  return out;
}
export function indexCues(doc) {
  const byId = new Map();
  const walk = (cues, parent) => { for (const c of cues || []) { byId.set(c.id, { cue: c, parent }); if (c.children) walk(c.children, c); } };
  for (const l of (doc && doc.lists) || []) walk(l.cues, null);
  return byId;
}
export function relTime(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// ── the keys that can be changed (Settings ▸ Keys) ────────────────────────────
// Each action has the key it comes with; a person may give it others (kept on this computer). The ⌘ shortcuts
// are the menus' and are not in this table. `key` is the event's own name for it (KeyboardEvent.key).
// Both tables are core/ui/keys.js's (the menus and the assistant's guide read the same one), handed over by the preload.
const UI = (ec && ec.ui) || {};
export const KEY_ACTIONS = (UI.keys && UI.keys.actions) || [];
export const FIXED_KEYS = (UI.keys && UI.keys.fixed) || [];
/** A key press as one word: "p", "shift+p", "alt+7", "space", "arrowup", "<". null: not a key on its own (a bare modifier, or one with ⌘ / ctrl). */
export function comboOf(e) {
  if (e.metaKey || e.ctrlKey || ['Shift', 'Alt', 'Meta', 'Control', 'CapsLock', 'Dead', 'Tab'].includes(e.key)) return null;
  const letter = /^Key[A-Z]$/.test(e.code || '') ? e.code.slice(3).toLowerCase() : /^Digit\d$/.test(e.code || '') && !e.shiftKey ? e.code.slice(5) : null;
  const key = letter || (e.key === ' ' ? 'space' : e.key.length === 1 ? e.key : e.key.toLowerCase());
  const symbol = !letter && e.key.length === 1 && e.key !== ' ';            // "<" is already shift+",": the shift is in the character
  return `${e.shiftKey && !symbol ? 'shift+' : ''}${e.altKey && (letter || !symbol) ? 'alt+' : ''}${key}`;
}
const comboOfDefault = (key) => (key === ' ' ? 'space' : key.length === 1 ? key : key.toLowerCase());
/** combo -> action id, for the keys as this person has them (`over`: { actionId: [combo…] }, an empty list: no key). */
export function keymapOf(over = {}) {
  const map = new Map();
  for (const [, list] of KEY_ACTIONS) for (const [id, , defs] of list) for (const c of (over && Array.isArray(over[id]) ? over[id] : defs.map(comboOfDefault))) if (!map.has(c)) map.set(c, id);
  return map;
}
export const keysOf = (id, over = {}) => { const a = KEY_ACTIONS.flatMap(([, l]) => l).find((x) => x[0] === id); return over && Array.isArray(over[id]) ? over[id] : a ? a[2].map(comboOfDefault) : []; };
export const defaultKeyOf = (id) => KEY_ACTIONS.flatMap(([, l]) => l).find((x) => x[0] === id)[2][0];
export const DEFAULT_COMBOS = new Set(KEY_ACTIONS.flatMap(([, l]) => l).flatMap((x) => x[2].map(comboOfDefault)));
/** A combo as it is shown on a key cap. */
export function comboLabel(c) {
  const parts = c.split('+'), key = parts.pop() || '+';
  const names = { space: 'Space', escape: 'Esc', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', backspace: isMac ? '⌫' : 'Backspace', delete: 'Del', enter: 'Enter' };
  return `${parts.includes('shift') ? (isMac ? '⇧' : 'Shift+') : ''}${parts.includes('alt') ? (isMac ? '⌥' : 'Alt+') : ''}${names[key] || (key.length === 1 ? key.toUpperCase() : key.replace(/^f(\d+)$/, 'F$1'))}`;
}

/** The number a new top-level cue takes (QLab's way): the next one after the cue it follows, counting by the show's
 *  step (Settings ▸ Show); part of a step when that is taken by the cue after it; none when the cue before it has
 *  no number to count from. */
export function nextNumber(cues, afterId, step = 1, taken = []) {
  step = Number(step) > 0 ? Number(step) : 1;
  const round = (n) => Math.round(n * 1000) / 1000;
  // (a section heading has no number: counting is from the cue before it, and up to the cue after it)
  cues = cues.filter((c) => c.type !== 'section' || c.id === afterId);
  let i = afterId ? cues.findIndex((c) => c.id === afterId) : cues.length - 1;
  if (i >= 0 && cues[i].type === 'section') { cues = cues.filter((c) => c.type !== 'section'); i -= 1; if (i < 0 && cues.length) return {}; }
  // (`taken`: the numbers of the whole show, so a cue in one list is not given a number a cue in another has)
  const used = new Set([...cues.map((c) => c.number), ...taken].filter(Boolean).map(String));
  if (i < 0) { if (cues.length) return {}; for (let n = step, k = 0; k < 10000; n = round(n + step), k++) if (!used.has(String(n))) return { number: String(n) }; return {}; }
  const prev = Number(cues[i].number), next = cues[i + 1] ? Number(cues[i + 1].number) : NaN;
  if (!cues[i].number || !Number.isFinite(prev)) return {};
  for (const n of [round((Math.floor(prev / step) + 1) * step), round(prev + step / 2), round(prev + step / 10)]) if (!used.has(String(n)) && !(n >= next)) return { number: String(n) };
  return {};
}
