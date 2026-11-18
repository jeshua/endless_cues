/**
 * The window's named places: what the assistant can point at (its tool show_in_app, core/assistant/tools.ts) and
 * the guide to the app names (core/assistant/app-guide.ts). Each name is a place a person looks for ("where is
 * Panic?"), mapped to how the window finds it (a CSS selector, a `data-*` attribute wherever one can be had) and,
 * when it is not always on screen, the steps that bring it there: open Settings at a pane, show the cue list,
 * select a cue, bring an inspector tab forward, open More.
 *
 * A step only changes what the window shows (the selection, a tab, which pane is open): none edits the show, plays
 * anything or takes the keyboard. The window does them (app/renderer/Point.ts) and says whether the place could be
 * shown; in Show mode nothing is pointed at at all (app/main/host.ts refuses first).
 *
 *   resolve(target, { doc })   a name → { ok, place } (what the window is sent) or { ok: false, why }
 *   names()                    every fixed name and every family, for the tool's description and the guide's test
 *
 * Fixed names are below. Families take what follows the colon: tab:<edit|rig|show>, add-type:<cue type>,
 * inspector-tab:<basics|type|time|design|triggers>, inspector-field:<field key>, cue:<number or id>,
 * settings:<pane>. A few plain words are kept as other names for one of these (`rig` is `tab:rig`).
 */
import { TYPES, TYPE_ORDER, COMMON } from '../show/cue-types';
import * as show from '../show/show';
import type { Cue, ShowDoc } from '../show/types';

/** One thing the window does before a place is on screen (`do`: cues | select | tab | more | settings | reveal). */
export interface PlaceStep { do: string; cue?: string; types?: string[]; tab?: string; section?: string }
/** A place as the table says it. */
export interface PlaceDef {
  label: string;
  sel: string | null;
  steps?: PlaceStep[];
  fallback?: string;
  absent?: string;
  menu?: string;
  words?: string;
  settings?: boolean;
}
/** A place as the window is sent it: its name, its steps, and its fallback resolved. */
export type Place = Omit<PlaceDef, 'steps' | 'fallback'> & { target: string; steps: PlaceStep[]; fallback?: Place | null };
export type Resolved = { ok: true; place: Place; why?: undefined } | { ok: false; why: string; place?: undefined };

// name → { label, sel, steps?, fallback?, absent?, menu? }. `absent`: what to say when it is not on screen (it is
// drawn only some of the time). `menu`: the place is a menu item, which cannot be ringed: the button that opens its
// menu is pointed at instead (`sel`), with the item named. `sel: null`: there is nothing on screen to point at,
// only words (a menu bar item).
const FIXED: Record<string, PlaceDef | undefined> = {
  // the title bar
  save: { label: 'Save', sel: '[data-save]' },
  'more-menu': { label: 'The ⋯ menu', sel: '[data-more-menu]' },
  assistant: { label: 'Assistant', sel: '[data-assistant-button]' },
  'settings-button': { label: 'Settings (⚙)', sel: '[data-settings-button]' },
  undo: { label: 'Undo and redo', sel: '[data-undo]' },
  'list-picker': { label: 'The list on screen', sel: '.titlebar .listpick', absent: 'It is there only when the show has more than one list.' },
  versions: { label: 'Versions', sel: '[data-more-menu]', menu: 'more' },
  monitor: { label: 'Network and MIDI Monitor', sel: '[data-more-menu]', menu: 'more' },
  log: { label: 'Show Log', sel: '[data-more-menu]', menu: 'more' },
  lights: { label: 'Light Dashboard', sel: '[data-more-menu]', menu: 'more' },
  updates: { label: 'A new version', sel: '[data-update]', fallback: 'settings:general', absent: 'There is no new version waiting: updates are set in Settings ▸ General.' },
  // the masthead
  go: { label: 'GO', sel: '[data-go]' },
  'standing-by': { label: 'Standing by', sel: '[data-standby]' },
  panic: { label: 'Panic', sel: '[data-panic]' },
  'pause-all': { label: 'Pause all', sel: '[data-pause-all]' },
  'fade-all': { label: 'Fade all', sel: '[data-fade-all]' },
  reset: { label: 'Reset', sel: '[data-reset]' },
  // the add-cue bar and the list
  'add-cue': { label: 'The add-cue bar', sel: '[data-add-bar]', steps: [{ do: 'cues' }] },
  'add-cue-more': { label: 'Every other cue type (+)', sel: '[data-tools-more]', steps: [{ do: 'cues' }] },
  'cue-list': { label: 'The cue list', sel: '.centre .list', steps: [{ do: 'cues' }] },
  zoom: { label: 'Zoom the cue list', sel: '[data-list-zoom]', steps: [{ do: 'cues' }] },
  'row-stop': { label: 'A playing cue’s stop (■)', sel: '[data-row-stop]', steps: [{ do: 'cues' }], absent: 'It is on a cue’s row only while that cue plays.' },
  'row-meter': { label: 'A playing cue’s level', sel: '[data-row-meter]', steps: [{ do: 'cues' }], absent: 'It is on a cue’s row only while that cue plays.' },
  find: { label: 'Find', sel: null, words: 'Tools ▸ Find… (⌘F): a strip over the cue list.' },
  'load-to-time': { label: 'Load to Time', sel: null, words: 'Tools ▸ Load to Time… (⌘T).' },
  'jump-to-cue': { label: 'Jump to Cue', sel: null, words: 'Tools ▸ Jump to Cue… (⌘J).' },
  'run-from': { label: 'Run from here', sel: null, words: 'Right-click a cue ▸ Run from Here…, or Tools ▸ Run from the Selected Cue….' },
  // the inspector
  inspector: { label: 'The inspector', sel: '[data-inspector]', steps: [{ do: 'cues' }, { do: 'select' }] },
  audition: { label: 'Audition', sel: '[data-audition]', steps: [{ do: 'cues' }, { do: 'select' }] },
  // the right column
  'active-cues': { label: 'Active cues', sel: '[data-active-head]' },
  mixer: { label: 'The mixer', sel: '[data-mixer]' },
  master: { label: 'The master fader', sel: '[data-mixer] .strip.master' },
  'network-panel': { label: 'Network, in the side panel', sel: '[data-side-network]', fallback: 'more-menu', absent: 'It is shown once ⋯ ▸ Network in the Side Panel is ticked.' },
  resident: { label: 'The assistant in the side panel', sel: '[data-resident]', absent: 'It is hidden on this computer (Settings ▸ Assistant).' },
  // the footer
  check: { label: 'Check', sel: '[data-check]' },
  report: { label: 'Report', sel: '[data-report-open]' },
  'output-device': { label: 'The sound output', sel: '[data-output-device]' },
  // the assistant's own drawer
  'assistant-settings': { label: 'Assistant settings', sel: '[data-assistant-settings]', fallback: 'settings:assistant' },
};

/** Other names for a place (a word a model or a person might use first). */
const ALIASES: Record<string, string | undefined> = { rig: 'tab:rig', edit: 'tab:edit', 'show-mode': 'tab:show', keys: 'settings:keys', settings: 'settings-button',
  colour: 'inspector-field:color', color: 'inspector-field:color', triggers: 'inspector-tab:triggers', 'sound-design': 'inspector-tab:design', 'time-and-loops': 'inspector-tab:time' };

const TABS: Record<string, string | undefined> = { edit: 'Edit', rig: 'Rig', show: 'Show' };
const INSPECTOR_TABS: Record<string, string | undefined> = { basics: 'Basics', type: 'the cue type’s own tab', time: 'Time & Loops', design: 'Sound design', triggers: 'Triggers' };
// Settings: [pane, label, what it is in] — a pane under Integrations is a tab along its top
const PANES: [pane: string, label: string, within?: string][] = [['general', 'General'], ['show', 'Show'], ['audio', 'Audio'], ['integrations', 'Integrations'], ['network', 'Network', 'integrations'], ['video', 'Video', 'integrations'],
  ['light', 'Light', 'integrations'], ['triggers', 'Triggers', 'integrations'], ['modules', 'Modules', 'integrations'], ['assistant', 'Assistant'], ['keys', 'Keys'], ['about', 'About']];
const FAMILIES: Record<string, string[] | string> = {
  tab: Object.keys(TABS),
  'add-type': TYPE_ORDER.filter((t) => !TYPES[t].heading),
  'inspector-tab': Object.keys(INSPECTOR_TABS),
  'inspector-field': '<a field key: color, notes, gainDb…>',
  cue: '<its number, or its id>',
  settings: PANES.map((p) => p[0]),
};

// a field's place in the inspector: which tab, and whether it waits under More (app/renderer/Inspector.ts draws them so)
const TIME_KINDS = new Set(['markers', 'regions', 'numbers', 'envelope', 'automation']);
function fieldPlace(key: string) {
  const common = COMMON.find((f) => f.key === key && !f.hidden);
  const types = TYPE_ORDER.filter((t) => TYPES[t].fields.some((f) => f.key === key && !f.hidden));
  if (!common && !types.length) return null;
  const f = common || TYPES[types[0]].fields.find((x) => x.key === key)!;
  const tab = f.tab === 'triggers' ? 'triggers' : f.tab === 'design' || f.kind === 'chain' || f.kind === 'eq' && f.tab ? 'design' : TIME_KINDS.has(f.kind) ? 'time' : common ? 'basics' : 'type';
  // (a common field a type keeps for itself, or one no heading has: any cue but a section)
  const fits = common ? TYPE_ORDER.filter((t) => !TYPES[t].heading && !(TYPES[t].common && !TYPES[t].common.includes(key))) : types;
  return { f, tab, fits, more: !!f.advanced || key === 'preWait' || key === 'postWait' };
}

/** A cue named by "#12", "12" or its id, in `doc`. */
function cueIn(doc: ShowDoc | null, want: unknown): Cue | null {
  const w = String(want || '').trim();
  if (!doc || !w) return null;
  return w.startsWith('#') ? show.findByNumber(doc, w.slice(1)) : (show.index(doc).byId.get(w) || show.findByNumber(doc, w));
}

const settingsPlace = (pane: string): PlaceDef | null => {
  const p = PANES.find((x) => x[0] === pane);
  if (!p) return null;
  return { label: `Settings ▸ ${p[2] ? 'Integrations ▸ ' : ''}${p[1]}`, sel: p[2] ? `.modal .settings-subtabs [data-section="${p[0]}"]` : `.modal nav [data-section="${p[0]}"]`, steps: [{ do: 'settings', section: p[0] }], settings: true };
};

function listOfNames() {
  return `${Object.keys(FIXED).join(', ')}; ${Object.entries(FAMILIES).map(([k, v]) => `${k}:${Array.isArray(v) ? `<${v.join('|')}>` : v}`).join(', ')}`;
}

/**
 * A name, as the window is to be sent it. `cue` (optional) is a cue the person is talking about: an inspector place
 * is shown on it. Unknown names, fields and cues are refused with what there is, so a model can correct itself.
 */
function resolve(target: unknown, { doc = null, cue = null }: { doc?: ShowDoc | null; cue?: unknown } = {}): Resolved {
  let name = String(target || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!name) return { ok: false, why: `Say which place. The places: ${listOfNames()}.` };
  const raw = ALIASES[name] || String(target).trim();
  name = ALIASES[name] || name;
  const colon = name.indexOf(':');
  const fam = colon > 0 ? name.slice(0, colon) : null, arg = colon > 0 ? raw.slice(raw.indexOf(':') + 1).trim() : '';
  const named = cue ? cueIn(doc, cue) : null;
  if (cue && doc && !named) return { ok: false, why: `No cue ${cue} in the show.` };
  const place = (p: PlaceDef): Resolved => ({ ok: true, place: { target: fam ? `${fam}:${arg}` : name, ...p, steps: p.steps || [], ...(p.fallback ? { fallback: resolve(p.fallback, { doc }).place || null } : {}) } as Place });
  if (!fam) {
    const p = FIXED[name];
    if (!p) return { ok: false, why: `There is no place called “${target}”. The places: ${listOfNames()}.` };
    // (the inspector of a cue the person named: that cue is selected first)
    if (named && p.steps && p.steps.some((s) => s.do === 'select')) return place({ ...p, steps: p.steps.map((s) => (s.do === 'select' ? { do: 'select', cue: named.id } : s)) });
    return place(p);
  }
  const a = arg.toLowerCase();
  switch (fam) {
    case 'tab':
      if (!TABS[a]) break;
      return place({ label: `The ${TABS[a]} tab`, sel: `.tabs-main [data-tab="${a}"]` });
    case 'add-type': {
      const t = TYPES[a] ? a : TYPE_ORDER.find((x) => TYPES[x].label.toLowerCase() === a);
      if (!t || TYPES[t].heading) break;
      return place({ label: `Add a ${TYPES[t].label} cue`, sel: `[data-add-type="${t}"]`, steps: [{ do: 'cues' }], fallback: 'add-cue-more' });
    }
    case 'inspector-tab':
      if (!INSPECTOR_TABS[a]) break;
      // (the tab a cue has: Time & Loops and Sound design are a sound's; the type's own tab is any cue's but a Memo's)
      return place({ label: `The inspector’s ${INSPECTOR_TABS[a]}`, sel: `[data-insp-tab="${a}"]`,
        steps: [{ do: 'cues' }, { do: 'select', ...(named ? { cue: named.id } : {}), ...(a === 'time' ? { types: ['audio'] } : a === 'design' ? { types: TYPE_ORDER.filter((t) => TYPES[t].fields.some((f) => f.kind === 'chain')) } : {}) }, { do: 'tab', tab: a }] });
    case 'inspector-field': {
      const key = arg.trim();
      const fp = fieldPlace(key) || fieldPlace(key.replace(/^colou?r$/i, 'color'));
      if (!fp) return { ok: false, why: `No cue has a field “${arg}”. read_reference "every" or "<type>" lists the fields.` };
      if (named && !fp.fits.includes(named.type)) return { ok: false, why: `A ${TYPES[named.type].label} cue has no ${fp.f.label || fp.f.key}: ${fp.fits.slice(0, 6).map((t) => TYPES[t].label).join(', ')} cues have it.` };
      const steps = [{ do: 'cues' }, { do: 'select', types: fp.fits, ...(named ? { cue: named.id } : {}) }, { do: 'tab', tab: fp.tab }, ...(fp.more ? [{ do: 'more' }] : [])];
      // (a field drawn on Time & Loops or Sound design is that whole tab: its tab is what is pointed at)
      const sel = fp.tab === 'time' || fp.tab === 'design' ? `[data-insp-tab="${fp.tab}"]` : `[data-field="${fp.f.key}"]`;
      return place({ label: fp.f.label || fp.f.key, sel, steps });
    }
    case 'cue': {
      const c = cueIn(doc, arg);
      if (!c) return { ok: false, why: `No cue ${arg} in the show.` };
      const label = `${c.number ? `Cue ${c.number}` : TYPES[c.type].label}${c.name ? `, ${c.name}` : ''}`;
      return place({ label, sel: `.centre .list tr[data-${c.type === 'section' ? 'section' : 'cue'}="${c.id}"]`, steps: [{ do: 'cues' }, { do: 'reveal', cue: c.id }] });
    }
    case 'settings': {
      const p = settingsPlace(a === 'go' || a === 'appearance' || a === 'updates' ? 'general' : a);
      if (p) return place(p);
      break;
    }
    default: return { ok: false, why: `There is no place called “${target}”. The places: ${listOfNames()}.` };
  }
  return { ok: false, why: `“${arg}” is not one of ${fam}:${Array.isArray(FAMILIES[fam]) ? FAMILIES[fam].join('|') : FAMILIES[fam]}.` };
}

/** Every name a person or a test can check: the fixed ones, the aliases, and one of each family per value it takes. */
function names() {
  return { fixed: Object.keys(FIXED), aliases: Object.keys(ALIASES), families: FAMILIES };
}

export { resolve, names, listOfNames, FIXED, ALIASES, FAMILIES, PANES, fieldPlace };
