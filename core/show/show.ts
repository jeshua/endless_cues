/**
 * The show document: one JSON file that is the whole show.
 *
 *   MyShow.ecshow/
 *     show.json        this document (pretty-printed, stable key order: it diffs)
 *     media/           the show's sound files (a cue's `file` is relative to the folder)
 *     versions/        saved versions (versions.js)
 *
 * Plain data in, plain data out; nothing here touches the disk or Electron.
 * The format is specified in docs/specs/03-show-file.md.
 */
import * as crypto from 'crypto';
import { TYPES, STAGE_TYPES, fieldsOf, coerce, defaultName, stopsTarget } from './cue-types';
import { mediaKind, movesOf, FADEABLE } from '../video/stage';
import * as midi from '../net/midi';
import * as lightPatch from '../light/patch';
import * as lightCommands from '../light/commands';
import * as netRaw from '../net/raw';
import * as networkCue from '../net/network-cue';
import * as timecode from '../timecode/timecode';
import * as cart from './cart';
import * as script from './script';
import { cleanLimits } from '../audio/curves';
import * as rigDevices from '../rig/devices';

const FORMAT = 'endless-cues-show';
const VERSION = 1;

const DEFAULT_BUSES = [
  { id: 'music', name: 'Music', db: 0 },
  { id: 'effects', name: 'Effects', db: 0 },
  { id: 'vocals', name: 'Vocals', db: 0 },
];

function defaultSettings() {
  return {
    go: {
      doubleGoProtection: 0.3,   // s: a second GO this soon is ignored
      panicFade: 1.0,            // s: Esc fades everything out over this; Esc again stops dead
    },
    audio: {
      masterDb: 0,
      limiter: true,
      buses: DEFAULT_BUSES.map((b) => ({ ...b })),
      // ducking: one bus dips while another is sounding (music under the voices)
      duck: { on: false, key: 'vocals', target: 'music', threshold: -35, depth: -8, attack: 0.05, hold: 0.5, release: 1, range: 'voice' },
      // level limits: a cue or a fade asking for more than `max` dB is played at `max`; a level at or below `min` is silence
      levels: { min: -60, max: 12 },
      // the monitor feed: a mono copy of what outputs 1–2 get, on one more output of the device (`out`, counted from 1)
      monitor: { on: false, out: 3, db: -12 },
      // a newly added sound is listened to and put on the bus for its kind (core/audio/kinds.js): off unless asked for
      sortNew: false,
    },
    // how the list behaves while the show is being built
    editing: {
      autoNumber: true,          // a new top-level cue takes the next number after the cue it follows
      numberStep: 1,             // …counting by this much (10: 10, 20, 30)
      lockPlayhead: true,        // selecting a cue makes it the one standing by; off, the selection and the playhead go their own ways
      longSoundsToMusic: false,  // a sound added with no bus chosen goes on the Music bus when it is half a minute or longer (off: every new sound is on the bus an Audio cue starts on)
    },
    // what a new cue of a type starts with: { fade: { duration: 5 }, audio: { bus: 'music' } } (core/show/templates.js)
    templates: {},
    network: {
      // [{ id, name, host, port, protocol: 'udp' | 'tcp', framing: 'slip' | 'length', device, listenPort, notes,
      //    iface (the network interface it leaves by: a name such as en0; none: the system chooses),
      //    destinations: [{ host, port, protocol?, framing?, iface? }] (further places the same message goes) }]
      patches: [],
      inputPort: 53000,          // where this app listens for OSC (remote control, cue triggers); 53000 is QLab's
      listen: false,             // listen even when nothing needs it (to watch what arrives, in the monitor)
      // OSC messages that run the show, written as an OSC trigger is ("/box/1", "/desk/macro 1"): '' is none
      commands: { go: '', panic: '', pause: '', resume: '', next: '', previous: '' },
    },
    backup: {
      minutes: 5,                // a copy of the show as it is being worked on, this often while it is changing (0: never)
      keep: 30,                  // how many are kept (beyond these, the last of each day for two weeks)
    },
    midi: {
      output: '',                // the MIDI output MIDI cues go to, by name ('': every output there is)
      mscIn: false,              // MIDI Show Control arriving runs the show (GO, STOP, RESUME, ALL OFF, RESET)
      deviceId: 1,               // the device ID this app answers to (and to 127, "every device")
      // MIDI messages that run the show, written as a MIDI trigger is ("note 36", "cc 64 127"): '' is none
      commands: { go: '', panic: '', pause: '', resume: '', next: '', previous: '' },
    },
    // the app's own lighting: where DMX goes, the patch, groups, the show's fixtures (core/light/patch.js)
    light: lightPatch.defaults(),
    // the Live view (the mixing desk)
    live: {
      overlap: false,            // false: a clip launched on a track takes over from the one playing there; true: both play
      tempo: 0,                  // the desk's tempo, which a warped clip plays at (0: the tempo of the music playing)
      map: [],                   // [{ on: 'key q' | 'cc 7 ch 1' | 'note 60 ch 1', to: 'clip:<cue id>' | 'fader:<bus>' | … }] (core/audio/desk-map.js)
    },
    // the rig: the equipment this show talks to (core/rig/devices.js), the operator's own checklist, and the script
    rig: {
      devices: [],               // [{ id, name, kind, via, host, port, commands: [...], alive: {...}, … }]: changed only by device.add / device.set / device.remove
      checks: [],                // [{ id, text }]: the operator's own lines on the Rig page ("Fresh batteries in both lanterns")
      script: '',                // a text file in the show folder whose "@cue 12 Thunder" lines are checked against the cues ('': none)
    },
    timecode: {
      source: 'off',             // incoming timecode the show chases: 'off' | 'mtc' (any MIDI input) | 'ltc' (an audio input)
      rate: '30',                // the frame rate timecode triggers are written at: '24' | '25' | '29.97df' | '30'
      input: '',                 // LTC: the audio input, by name ('': this computer's default input)
      channel: 1,                // LTC: which of that device's inputs
      catchUp: true,             // timecode that arrives part way through a cue starts it that far in
      follow: true,              // the playhead stands on the next cue with a timecode trigger
    },
  };
}

function defaultModules() {
  return {
    // (who may do what is `passcodes` [{ code, view, edit, control }] and `noPasscode` { view, edit, control }, once set;
    //  `passcode` is the older single one, which grants everything. 53001 is where QLab answers a UDP sender.)
    'osc-control': { enabled: false, passcode: '', replyPort: 53001 },
    'show-feedback': { enabled: false, patch: '', prefix: '/endlesscues' },
    'lighting-desk': { enabled: false, kind: 'etc-eos', host: '', port: 8000, listenPort: 8001, list: 1 },
    'web-remote': { enabled: false, port: 8137, control: true, key: '' },
    'backup-link': { enabled: false, role: 'main', patch: '', passcode: '' },
  };
}

function newId(prefix = 'c') { return `${prefix}_${crypto.randomBytes(4).toString('hex')}`; }

/** A NEW show's settings: the defaults, and the one thing only a show made from now on has: its buses say what
 *  kind of sound each carries. That is a label and does nothing by itself: a new show plays as a plain cue
 *  list, with ducking off (the one pair, `duck`, as every show has had) and nothing a kind could bring switched
 *  on. Ducking by kind (`ducking`) is written only when a person asks for it in Settings ▸ Audio. */
function newSettings() {
  const s = defaultSettings();
  const KIND = { music: 'music', effects: 'effects', vocals: 'voice' };
  s.audio.buses = s.audio.buses.map((b) => ({ ...b, kind: KIND[b.id] }));
  return s;
}

function newShow(title = 'Untitled show') {
  return {
    format: FORMAT,
    version: VERSION,
    id: newId('show'),
    title,
    notes: '',
    settings: newSettings(),
    modules: defaultModules(),
    lists: [{ id: newId('list'), name: 'Main', cues: [] }],
  };
}

/** Every cue in the show, depth first: fn(cue, parentCue | null, list). */
function walk(doc, fn) {
  const go = (cues, parent, list) => {
    for (const c of cues || []) { fn(c, parent, list); if (c.children) go(c.children, c, list); }
  };
  for (const l of doc.lists || []) go(l.cues, null, l);
}

function index(doc) {
  const byId = new Map(), parentOf = new Map(), listOf = new Map();
  walk(doc, (c, parent, list) => { byId.set(c.id, c); parentOf.set(c.id, parent ? parent.id : null); listOf.set(c.id, list.id); });
  // (the cue lists by id, beside the cues: a Start, Stop or Fade cue can be aimed at a whole list)
  byId.lists = new Map((doc.lists || []).map((l) => [l.id, l]));
  // (and the show's devices, for a Device cue's name)
  byId.devices = new Map(rigDevices.list(doc).map((d) => [d.id, d]));
  return { byId, parentOf, listOf };
}

/** The array a cue sits in, and where: { siblings, at, parent, list } or null. */
function locate(doc, id) {
  let found = null;
  const go = (cues, parent, list) => {
    for (let i = 0; i < (cues || []).length && !found; i++) {
      if (cues[i].id === id) { found = { siblings: cues, at: i, parent, list }; return; }
      if (cues[i].children) go(cues[i].children, cues[i], list);
    }
  };
  for (const l of doc.lists || []) { if (found) break; go(l.cues, null, l); }
  return found;
}

function findByNumber(doc, number) {
  const want = String(number).trim().toLowerCase();
  let hit = null;
  walk(doc, (c) => { if (!hit && c.number != null && String(c.number).toLowerCase() === want) hit = c; });
  return hit;
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  // (a show file is anyone's: a key that would reach an object's prototype is not a setting)
  for (const [k, v] of Object.entries(over)) if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') out[k] = deepMerge(out[k], v);
  return out;
}

/**
 * A document as this version of the app wants it: defaults filled in, ids on
 * everything, fields coerced. Never throws on a hand-edited file: what cannot be
 * understood is reported in `warnings` and left out of the result.
 */
function normalise(input) {
  const warnings = [];
  if (!input || typeof input !== 'object') throw new Error('not a show file');
  if (input.format !== FORMAT) throw new Error(`not an Endless Cues show (format: ${JSON.stringify(input.format)})`);
  if (Number(input.version) > VERSION) throw new Error(`this show was saved by a newer Endless Cues (file version ${input.version}); update the app to open it`);
  const doc = {
    format: FORMAT,
    version: VERSION,
    id: input.id || newId('show'),
    title: String(input.title || 'Untitled show'),
    notes: String(input.notes || ''),
    settings: deepMerge(defaultSettings(), input.settings || {}),
    modules: deepMerge(defaultModules(), input.modules || {}),
    lists: [],
  };
  if (!Array.isArray(doc.settings.audio.buses) || !doc.settings.audio.buses.length) doc.settings.audio.buses = DEFAULT_BUSES.map((b) => ({ ...b }));
  // a strip's eq with every band back at rest is no eq (core/audio/strip.js)
  for (const b of doc.settings.audio.buses) if (b && b.eq && typeof b.eq === 'object' && !Object.keys(b.eq).length) delete b.eq;
  // the rig: each device as this version wants it (what it does not know is kept; what cannot be understood is said and left out)
  {
    const rig = doc.settings.rig = doc.settings.rig && typeof doc.settings.rig === 'object' && !Array.isArray(doc.settings.rig) ? doc.settings.rig : { devices: [], checks: [], script: '' };
    // (an id made for a device that had none keeps clear of every id a patch or another device already has)
    const taken = new Set([...doc.settings.network.patches.map((p) => p && p.id), ...(Array.isArray(rig.devices) ? rig.devices : []).map((d) => d && d.id).filter((id) => rigDevices.ID.test(String(id || '')))]);
    const devices = [];
    for (const raw of Array.isArray(rig.devices) ? rig.devices : []) {
      const r = rigDevices.clean(raw, { taken });
      for (const w of r.warnings) warnings.push(`rig: ${w}`);
      if (!r.device) continue;
      if (devices.some((d) => d.id === r.device.id)) { warnings.push(`rig: two devices had the id ${r.device.id}; the second was left out`); continue; }
      taken.add(r.device.id); devices.push(r.device);
    }
    rig.devices = devices;
    rig.checks = (Array.isArray(rig.checks) ? rig.checks : []).filter((k) => k && typeof k === 'object' && String(k.text || '').trim()).map((k, i) => ({ ...k, id: String(k.id || `k${i + 1}`), text: String(k.text) }));
    rig.script = typeof rig.script === 'string' ? rig.script : '';
  }
  const seen = new Set();
  const cleanCue = (raw, where) => {
    if (!raw || typeof raw !== 'object') { warnings.push(`${where}: not a cue, dropped`); return null; }
    if (!TYPES[raw.type]) { warnings.push(`${where}: unknown cue type ${JSON.stringify(raw.type)}, kept as a memo`); raw = { ...raw, type: 'memo', notes: `${raw.notes || ''}\n(was type ${raw.type})`.trim() }; }
    let id = raw.id && !seen.has(raw.id) ? String(raw.id) : newId();
    if (raw.id && seen.has(raw.id)) warnings.push(`${where}: two cues had the id ${raw.id}; one was given a new id`);
    seen.add(id);
    const cue = { id, type: raw.type };
    for (const f of fieldsOf(raw.type)) {
      if (raw[f.key] === undefined) continue;
      const r = coerce({ ...f, required: false }, raw[f.key]);
      if (!r.ok) { warnings.push(`${where} (${raw.number || id}): ${r.why}`); continue; }
      if (r.value !== undefined) cue[f.key] = r.value;
    }
    // what this version does not know (a field from a newer one, or written by hand) is kept as it was, and not played
    const known = new Set(['id', 'type', 'children', ...fieldsOf(raw.type).map((f) => f.key)]);
    for (const k of Object.keys(raw)) if (!known.has(k) && raw[k] !== undefined) cue[k] = raw[k];
    if (TYPES[raw.type].container) cue.children = (raw.children || []).map((k, i) => cleanCue(k, `${where} › ${i + 1}`)).filter(Boolean);
    return cue;
  };
  for (const [i, l] of (Array.isArray(input.lists) ? input.lists : []).entries()) {
    // (`cart`: the list is drawn as a grid of buttons, cart.js; a plain list has no such key)
    doc.lists.push({ id: l.id || newId('list'), name: String(l.name || `List ${i + 1}`), ...(cart.cleanCart(l.cart) ? { cart: cart.cleanCart(l.cart) } : {}), cues: (l.cues || []).map((c, j) => cleanCue(c, `${l.name || 'list'} #${j + 1}`)).filter(Boolean) });
  }
  if (!doc.lists.length) doc.lists.push({ id: newId('list'), name: 'Main', cues: [] });
  return { doc, warnings };
}

/** A clock trigger: "19:30", "19:30:15", optionally followed by the days it holds on ("mon tue", "sat,sun").
 *  Returns { secs (since midnight), days: Set of 0–6 (Sunday 0) | null } or null. */
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function parseClock(text) {
  const parts = String(text || '').trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(parts.shift() || '');
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59 || Number(m[3] || 0) > 59) return null;
  const days = parts.map((d) => DAYS.indexOf(d.slice(0, 3)));
  if (days.includes(-1)) return null;
  return { secs: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0), days: days.length ? new Set(days) : null };
}

/** A hotkey as it is compared: "shift+b", "alt+7", "f5". null: not a key a cue can have. */
function normaliseHotkey(text) {
  const parts = String(text || '').trim().toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key || !/^([a-z0-9]|f([1-9]|1[0-2]))$/.test(key) || parts.some((p) => p !== 'shift' && p !== 'alt')) return null;
  return `${parts.includes('shift') ? 'shift+' : ''}${parts.includes('alt') ? 'alt+' : ''}${key}`;
}
// the single keys the app itself answers to (Settings ▸ Keys): a cue cannot take one bare
const APP_KEYS = new Set(['p', 's', 'v', 'l', 'a', 'q', 'n', 'o', 't', 'e', 'd', 'w', 'c', 'f', 'h']);

/** Things the operator should know about before a show: [{ id, level: 'error' | 'warning', why }]. */
function problems(doc) {
  const out = [];
  const { byId } = index(doc);
  const numbers = new Map();
  const hotkeys = new Map();
  const buses = new Set(doc.settings.audio.buses.map((b) => b.id));
  const patches = new Set(doc.settings.network.patches.map((p) => p.id));
  const devices = byId.devices;       // a device is also somewhere a Network cue can send (by its id)
  let rigPatch = null;              // the light patch, compiled the first time a Light cue with levels needs it
  const levelMax = cleanLimits(doc.settings.audio.levels).max;
  walk(doc, (c) => {
    if (c.type === 'light') {
      const has = String(c.levels || '').trim();
      if (!has && !String(c.lightCue || '').trim()) out.push({ id: c.id, level: 'error', why: 'no levels and no desk cue number' });
      if (has) {
        rigPatch = rigPatch || lightPatch.compile(doc.settings.light);
        const r = lightCommands.evaluate(c.levels, rigPatch);
        if (r.errors.length) out.push({ id: c.id, level: 'warning', why: `${r.errors.length === 1 ? 'a levels line is' : `${r.errors.length} levels lines are`} not understood: line ${r.errors[0].line}, “${r.errors[0].text}”: ${r.errors[0].why}` });
      }
    }
    for (const f of fieldsOf(c.type)) {
      if (f.required && (c[f.key] === undefined || c[f.key] === '')) out.push({ id: c.id, level: 'error', why: `no ${/^[A-Z]{2}/.test(f.label) ? f.label : f.label.toLowerCase()}` });
      if (f.kind === 'cue' && c[f.key]) {
        const t = byId.get(c[f.key]);
        if (!t && f.lists && byId.lists.has(c[f.key])) continue;                 // a whole cue list
        if (!t) out.push({ id: c.id, level: 'error', why: byId.lists.has(c[f.key]) ? 'targets a cue list; needs a cue' : f.key === 'target' ? 'its target is gone' : `its ${f.label.toLowerCase()} is gone` });
        else if (t.type === 'section') out.push({ id: c.id, level: 'error', why: 'targets a section heading; needs a cue' });
        else if (f.targets && !f.targets.includes(t.type)) out.push({ id: c.id, level: 'error', why: `targets a ${TYPES[t.type].label} cue; needs ${f.targets.map((x) => TYPES[x].label).join(' or ')}` });
      }
    }
    if (c.type === 'video' && c.file && !mediaKind(c.file)) out.push({ id: c.id, level: 'warning', why: `a .${String(c.file).split('.').pop()} file may not play` });
    if ((c.type === 'audio' || c.type === 'mic' || c.type === 'video' || c.type === 'fade') && Number(c[c.type === 'fade' ? 'db' : 'gainDb']) > levelMax && !(c.type === 'fade' && c.relative)) out.push({ id: c.id, level: 'warning', why: `+${Number(c[c.type === 'fade' ? 'db' : 'gainDb'])} dB is above this show’s maximum: plays at +${levelMax} dB` });
    if (c.chain && c.chain.bypass) out.push({ id: c.id, level: 'warning', why: 'its sound design is bypassed: no tools, no eq' });
    if (c.type === 'audio' && c.preservePitch && Number(c.rate) > 0 && Number(c.rate) !== 1 && ((c.loops && c.loops.length) || (c.loop && Number(c.cutAt) > 0) || Number(c.plays) > 1)) out.push({ id: c.id, level: 'warning', why: 'with Keep pitch at a rate other than 1, its loops and play count will not go round' });
    if ((c.type === 'audio' || c.type === 'mic' || c.type === 'video') && c.bus && !buses.has(c.bus)) out.push({ id: c.id, level: 'warning', why: `no bus “${c.bus}”: plays on ${[...buses][0]}` });
    if (c.type === 'network' && c.patch && !patches.has(c.patch)) {
      const d = devices.get(c.patch);
      if (!d) out.push({ id: c.id, level: 'error', why: 'its network patch is gone' });
      else if (!rigDevices.isNetwork(d)) out.push({ id: c.id, level: 'error', why: `${d.name} is a MIDI device: a Network cue cannot send to it` });
      else if (!d.host || !(Number(d.port) > 0)) out.push({ id: c.id, level: 'error', why: 'its device has no address yet' });
    }
    if (c.type === 'device' && c.device && c.command) {
      const d = devices.get(c.device);
      if (!d) out.push({ id: c.id, level: 'error', why: 'its device is gone' });
      else {
        const cmd = d.commands.find((x) => x.id === c.command);
        const fading = c.fadeTo !== undefined && !!(cmd && cmd.fade);
        const r = rigDevices.compose(d, c.command, c.args || {});
        if (!r.ok) out.push({ id: c.id, level: 'error', why: r.why });
        else if (rigDevices.isNetwork(d) && (!d.host || !(Number(d.port) > 0))) out.push({ id: c.id, level: 'error', why: 'its device has no address yet' });
        if (r.ok && cmd) for (const k of Object.keys(c.args || {})) if (!cmd.params.some((p) => p.key === k)) out.push({ id: c.id, level: 'warning', why: `“${cmd.label}” has no parameter ${k}, only ${cmd.params.map((p) => p.key).join(', ') || 'none'}: not sent` });
        if (r.ok && fading) { const why = rigDevices.valueTrouble(cmd, c.fadeTo); if (why) out.push({ id: c.id, level: 'error', why: `its “Fade to”: ${why}` }); else if (!(Number(c.duration) > 0)) out.push({ id: c.id, level: 'warning', why: '“Fade to” with no duration: sent once' }); }
        if (r.ok && c.fadeTo !== undefined && !fading) out.push({ id: c.id, level: 'warning', why: `“${cmd.label}” cannot fade: sent once` });
      }
    }
    if (c.type === 'network' && c.message && (c.format || 'osc') === 'osc' && !String(c.message).trim().startsWith('/')) out.push({ id: c.id, level: 'error', why: 'an OSC message starts with /, or set “Message is”' });
    if (c.type === 'network' && c.message && c.format === 'hex') { try { netRaw.hex(c.message); } catch (err) { out.push({ id: c.id, level: 'error', why: `its message is not hex: ${err.message}` }); } }
    if (c.type === 'network' && c.format && c.format !== 'osc' && Number(c.duration) > 0) out.push({ id: c.id, level: 'warning', why: 'text and hex are sent once: the duration does nothing' });
    if (c.type === 'network' && (c.format || 'osc') === 'osc' && /#[xy]#/.test(String(c.message || ''))) { try { if (!networkCue.parsePath(c.path).length) out.push({ id: c.id, level: 'error', why: '#x# or #y# with no path to follow' }); } catch (err) { out.push({ id: c.id, level: 'error', why: err.message }); } }
    if (c.type === 'network' && c.patch === undefined && patches.size > 1) out.push({ id: c.id, level: 'error', why: 'no network patch chosen' });
    if (c.type === 'midi' && c.midi) { try { midi.encode(midi.parseText(c.midi)); } catch (err) { out.push({ id: c.id, level: 'error', why: `its MIDI message is not one: ${err.message}` }); } }
    if (c.type === 'script' && c.script) {
      const parsed = script.parse(c.script);
      for (const e of parsed.errors.slice(0, 3)) out.push({ id: c.id, level: 'error', why: `its script, line ${e.line}: ${e.why}` });
      for (const st of parsed.steps) {
        if (st.number != null && !findByNumber(doc, st.number)) out.push({ id: c.id, level: 'error', why: `its script, line ${st.line}: no cue numbered ${st.number}` });
        if (st.id != null && !byId.has(st.id)) out.push({ id: c.id, level: 'error', why: `its script, line ${st.line}: no cue with the id ${st.id}` });
      }
      if (!parsed.steps.length && !parsed.errors.length) out.push({ id: c.id, level: 'warning', why: 'its script has no commands in it' });
    }
    if (c.midiTrigger) { try { midi.parseText(c.midiTrigger); } catch (err) { out.push({ id: c.id, level: 'warning', why: `its MIDI trigger is not a MIDI message: ${err.message}` }); } }
    if (c.type === 'midi' && c.fadeTo !== undefined && c.midi) { try { const m = midi.parseText(c.midi), max = midi.valueMax(m); if (!max) out.push({ id: c.id, level: 'warning', why: 'only a controller, pressure or pitch bend can fade' }); else if (c.fadeTo < 0 || c.fadeTo > max) out.push({ id: c.id, level: 'warning', why: `its “Fade to” is outside 0 to ${max}` }); else if (!(Number(c.duration) > 0)) out.push({ id: c.id, level: 'warning', why: '“Fade to” with no duration: sent once' }); } catch { /* said above */ } }
    if (c.type === 'timecode') { const why = timecode.whyNot(timecode.parse(c.timecode === undefined ? '01:00:00:00' : c.timecode), c.fps || '30'); if (why) out.push({ id: c.id, level: 'error', why: `its start is not a timecode: ${why}` }); }
    if (c.type === 'midifile' && c.rate !== undefined && !(Number(c.rate) > 0)) out.push({ id: c.id, level: 'error', why: 'its rate must be above 0' });
    if (c.timecodeTrigger) { const why = timecode.whyNot(timecode.parse(c.timecodeTrigger), ((doc.settings || {}).timecode || {}).rate || '30'); if (why) out.push({ id: c.id, level: 'warning', why: `its timecode trigger “${c.timecodeTrigger}” cannot be used: ${why}` }); }
    if (c.clockTrigger && !parseClock(c.clockTrigger)) out.push({ id: c.id, level: 'warning', why: `clock trigger “${c.clockTrigger}” is not a time, as 19:30 or 19:30 mon tue` });
    if (c.hotkey) {
      const k = normaliseHotkey(c.hotkey);
      if (!k) out.push({ id: c.id, level: 'warning', why: `hotkey “${c.hotkey}”: use a letter, digit or F1–F12, with shift+ or alt+` });
      else if (APP_KEYS.has(k)) out.push({ id: c.id, level: 'warning', why: `hotkey ${k} is the app’s own: add shift+ or alt+` });
      else if (hotkeys.has(k)) out.push({ id: c.id, level: 'warning', why: `its hotkey ${k} is also another cue’s` });
      if (k) hotkeys.set(k, c.id);
    }
    if (c.type === 'target' && byId.has(c.target)) {
      // the cue it re-aims must have a target, and the new one must be a kind that cue can take
      const aimed = byId.get(c.target), tf = fieldsOf(aimed.type).find((f) => f.key === 'target' && f.kind === 'cue');
      const to = byId.get(c.to);
      if (!tf) out.push({ id: c.id, level: 'error', why: `the ${TYPES[aimed.type].label} cue it re-aims has no target to change` });
      else if (to && tf.targets && !tf.targets.includes(to.type)) out.push({ id: c.id, level: 'error', why: `the ${TYPES[aimed.type].label} cue it re-aims cannot target a ${TYPES[to.type].label} cue` });
      else if (!to && c.to && byId.lists.has(c.to) && !tf.lists) out.push({ id: c.id, level: 'error', why: `the ${TYPES[aimed.type].label} cue it re-aims cannot target a cue list` });
    }
    if (c.duckOthers && c.fadeOthers > 0) out.push({ id: c.id, level: 'warning', why: 'fades and ducks the others: the fade wins' });
    if (c.type === 'devamp' && c.startNext && c.continue && c.continue !== 'none') out.push({ id: c.id, level: 'warning', why: 'starts the next cue twice: set Continue to none' });
    if (c.type === 'group' && c.mode === 'playlist' && !(c.children || []).length) out.push({ id: c.id, level: 'warning', why: 'a playlist with nothing in it' });
    if (c.oscTrigger && !String(c.oscTrigger).trim().startsWith('/')) out.push({ id: c.id, level: 'warning', why: 'its OSC trigger does not start with /' });
    if (c.number) {
      const k = String(c.number);
      if (numbers.has(k)) out.push({ id: c.id, level: 'warning', why: `number ${k} is used twice` });
      numbers.set(k, c.id);
    }
  });
  // a cart with more cues than buttons: the ones left over cannot be pressed
  for (const l of doc.lists) if (l.cart) for (const id of cart.layout(l).extra) out.push({ id, level: 'warning', why: `no button free in the cart “${l.name}”: make it bigger in Settings ▸ Show` });
  return out;
}

/**
 * The document as the engine plays it (core/engine/cue-engine.js): the same
 * cues with the show file's friendlier fields turned into the engine's, and
 * anything that cannot work marked `broken` instead of thrown.
 */
function toEngineDoc(doc) {
  const { byId } = index(doc);
  const bad = new Map();
  for (const p of problems(doc)) if (p.level === 'error' && !bad.has(p.id)) bad.set(p.id, p.why);
  const buses = doc.settings.audio.buses.map((b) => b.id);
  const floor = cleanLimits(doc.settings.audio.levels).min;
  const conv = (c) => {
    const t = TYPES[c.type];
    const e = { id: c.id, type: t.engineType || c.type, name: c.name || defaultName(c, byId), number: c.number || '' };
    for (const f of fieldsOf(c.type)) if (c[f.key] !== undefined && f.key !== 'name' && f.key !== 'number') e[f.key] = c[f.key];      // (only what the table knows reaches the engine)
    // a field left alone plays at the default the inspector shows in grey (a new Fade goes to silence in 3 s)
    for (const f of fieldsOf(c.type)) if (e[f.key] === undefined && f.default !== undefined && f.default !== '') e[f.key] = f.default;
    delete e.continue;
    if (c.continue === 'auto-continue') e.autoContinue = true;
    if (c.continue === 'auto-follow') e.autoFollow = true;
    if (c.type === 'group') {
      if (!c.onBeat || c.onBeat === 'now') delete e.onBeat;
      if (!c.blend) delete e.blend;
      e.children = (c.children || []).filter((k) => k.type !== 'section').map(conv);
    }
    if (c.type === 'audio') e.bus = buses.includes(c.bus) ? c.bus : buses[buses.length > 1 ? 1 : 0];
    if (c.type === 'mic') e.bus = buses.includes(e.bus) ? e.bus : buses[buses.length - 1];
    // A cue on the stage. A video file is a sound to the engine (it plays, pauses, skips and fades as one) that
    // carries a picture; a still, a title or a camera is a `picture`, which has no sound and no end of its own.
    if (STAGE_TYPES.includes(c.type)) {
      e.picture = c.type === 'video' ? (mediaKind(c.file) || 'video') : c.type;
      e.type = e.picture === 'video' ? 'audio' : 'picture';
      if (e.type === 'audio') { e.bus = buses.includes(c.bus) ? c.bus : buses[buses.length > 1 ? 1 : 0]; delete e.duration; }
      else for (const k of ['gainDb', 'bus', 'from', 'cutAt', 'loop', 'holdEnd']) delete e[k];
    }
    // A Fade aimed at a picture moves what it names. Naming some geometry and no level, it leaves the sound alone;
    // naming nothing at all, it takes its target out: the sound to silence (the default level) and the picture to nothing.
    if (c.type === 'fade') {
      const t = byId.get(c.target);
      // (left alone, a fade to silence stops what it faded: cue-types.js stopsTarget)
      e.stopTarget = stopsTarget(c, t || null, floor);
      if (t && STAGE_TYPES.includes(t.type)) {
        const named = Object.keys(movesOf(c)).length > 0;
        if (named && c.db === undefined) delete e.db;
        if (!named && c.db === undefined) e.opacity = 0;
      } else for (const k of FADEABLE) delete e[k];
    }
    // A Device cue is, to the engine, what it sends: a Network cue to the device (its id is a patch to the hub), or a
    // MIDI cue. The engine has no cue type of its own for it.
    if (c.type === 'device') {
      const d = byId.devices.get(c.device);
      const cmd = d && d.commands.find((x) => x.id === c.command);
      const net = !d || rigDevices.isNetwork(d);
      const fading = !!(cmd && cmd.fade) && c.fadeTo !== undefined;
      const r = d ? rigDevices.compose(d, c.command, c.args || {}, { fade: fading && net }) : { ok: false };
      for (const k of ['device', 'command', 'args']) delete e[k];
      e.sends = e.name;                    // what the dry run and the monitor call it: "Lantern A ▸ Effect (breathe)"
      if (!fading) { delete e.fadeTo; delete e.duration; }         // (a duration with nothing to fade would send the message again and again)
      if (net) {
        e.type = 'network'; e.patch = c.device || ''; e.format = d ? rigDevices.viaOf(d) : 'osc'; e.message = r.ok ? r.message : '';
        if (fading) { const from = Number(rigDevices.valuesOf(cmd, c.args)[cmd.params.findIndex((p) => p.key === cmd.fade)]); e.fadeFrom = Number.isFinite(from) ? from : 0; const p = cmd.params.find((x) => x.key === cmd.fade); if (p.whole) e.whole = true; }
      } else { e.type = 'midi'; e.midi = r.ok ? r.message : ''; delete e.curve; }
      // one that cannot be sent (its device or command gone, a value out of range, no address) does nothing when it
      // fires: the engine plays it as a memo, marked broken below, and nothing half-made reaches the equipment
      if (bad.has(c.id)) { e.type = 'memo'; for (const k of ['patch', 'format', 'message', 'midi', 'fadeFrom', 'fadeTo', 'duration', 'curve', 'whole']) delete e[k]; }
    }
    if (c.target && ((!byId.has(c.target) && !byId.lists.has(c.target)) || (byId.get(c.target) || {}).type === 'section')) e.target = null;
    if (bad.has(c.id)) e.broken = bad.get(c.id);
    return e;
  };
  // A section is a heading for the eye: it is not in the list the engine plays, so GO, the playhead, continues and
  // auto-follows run from the cue before it to the cue after it as if it were not there (core/show/sections.js).
  return { format: 'ec-cuelist', version: 1, lists: doc.lists.map((l) => ({ id: l.id, name: l.name, cues: l.cues.filter((c) => c.type !== 'section').map(conv) })) };
}

/** Stable text for the disk: two-space JSON, keys in a fixed order so a diff shows only what changed. */
const KEY_ORDER = ['format', 'version', 'id', 'title', 'notes', 'type', 'number', 'name', 'target', 'file', 'message', 'patch'];
function stringify(doc) {
  // (a rig with nothing in it is not written: a show with no equipment is, on disk, exactly what it was before
  // there was a rig, and an older app reading the file meets nothing new)
  const rig = doc && doc.settings && doc.settings.rig;
  if (rig && typeof rig === 'object' && !(rig.devices || []).length && !(rig.checks || []).length && !rig.script && Object.keys(rig).every((k) => ['devices', 'checks', 'script'].includes(k))) {
    const { rig: _none, ...settings } = doc.settings;
    doc = { ...doc, settings };
  }
  const order = (v) => {
    if (Array.isArray(v)) return v.map(order);
    if (!v || typeof v !== 'object') return v;
    const keys = Object.keys(v).sort((a, b) => {
      const ia = KEY_ORDER.indexOf(a), ib = KEY_ORDER.indexOf(b);
      if (a === 'children' || a === 'cues' || a === 'lists') return 1;
      if (b === 'children' || b === 'cues' || b === 'lists') return -1;
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const out = {};
    for (const k of keys) if (v[k] !== undefined) out[k] = order(v[k]);
    return out;
  };
  return JSON.stringify(order(doc), null, 2) + '\n';
}

function hash(doc) { return crypto.createHash('sha256').update(stringify(doc)).digest('hex').slice(0, 16); }

export { parseClock, normaliseHotkey, APP_KEYS, FORMAT, VERSION, newShow, newId, normalise, problems, toEngineDoc, stringify, hash, walk, index, locate, findByNumber, defaultSettings, newSettings, defaultModules, deepMerge };
