/**
 * What the assistant can do to a show, and what it is told about shows.
 *
 * The assistant is an agent: it works in steps, looking, changing, checking, until the job is done.
 * It works on a DRAFT — a private copy of the show that starts as the show is now:
 *
 *   look     read_show · find_cues · list_media          the show (or the draft), its cues, its sound files
 *   change   edit_show                                    edit operations applied to the draft, as often as it likes
 *   check    check_show · simulate                        what is broken; what a GO would actually do, second by second
 *   finish   propose_changes                              hand the draft over as one change for the person to review
 *
 * and, since the show has equipment and a folder (docs/specs/15-assistant-and-rig.md):
 *
 *   look     list_folder · read_file                      the files in the show folder; the text of one (a script, notes)
 *            rig_status · read_monitor                    what the show depends on and whether it is ready; what was sent and heard
 *   point    show_in_app                                  a place in the window ringed for the person (core/ui/places.ts): no
 *                                                         change and nothing sent, and nothing at all in Show mode
 *   ask      ask_device · find_devices                    "are you there?", to one device, or to any prop on the network
 *   stage    make_prop_files · hand_off                   files for the show folder, written by the app's own generators,
 *                                                         carried on the proposal and written only when a person accepts it
 *
 * There are three classes of tool and only three. A LOOK changes nothing and sends nothing. A CHANGE reaches the
 * show (or its folder) only through propose_changes and a person's Accept. An ASK is the one thing sent to
 * equipment: a device's own "are you there?" message, or a model's built-in one to a private address, never a
 * message the model wrote, never a command, at most 30 a turn, and nothing at all in Show mode.
 *
 * The edit operations (core/show/ops.ts) can do anything to a show: add, change, remove, move, duplicate and
 * renumber cues, restructure groups and lists, and set any setting or module option. What the assistant cannot do
 * is the safety design (docs/specs/08-assistant.md): it cannot play the show, it cannot save it, and nothing it
 * does to the draft touches the real show until a person accepts the proposal (or has chosen, on this computer,
 * to have proposals applied at once — still undoable, still unsaved).
 *
 * An edit that does not fit is refused whole, with the reason, so the model corrects itself instead of the person
 * seeing a broken result.
 */
import * as fs from 'fs';
import * as path from 'path';
import { TYPES, TYPE_ORDER, COMMON, COLORS, fieldsOf, defaultName, formatSeconds } from '../show/cue-types';
import * as show from '../show/show';
import { applyOps, OP_KEYS } from '../show/ops';
import { diffShows, summary } from '../show/diff';
import * as dryRun from '../engine/dry-run';
import * as devices from '../net/devices';
import * as rigDevices from '../rig/devices';
import * as rigCheck from '../rig/check';
import * as folder from '../rig/folder';
import * as scriptFile from '../rig/script';
import * as showFiles from '../show/files';
import * as kit from '../kit/kit';
import * as appGuide from './app-guide';
import * as places from '../ui/places';
import type { Bus, Cue, CueIndex, CueType, Patch, ShowDoc } from '../show/types';
import type { Field } from '../show/cue-types';
import type { Op } from '../show/ops';
import type { Change } from '../show/diff';
import type { ShowDocument } from '../show/document';
import type { Logged } from '../net/hub';

/** A tool's input, as a JSON schema: what the model is told it may send. */
export interface JsonSchema {
  type?: string;
  description?: string;
  enum?: readonly string[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
}
export interface Tool { name: string; description: string; input_schema: JsonSchema }

/** A tool call's arguments as the model sent them: each tool takes some of these (its schema in TOOLS says which). */
export interface ToolInput {
  cue?: string; device?: string; from?: string | number; count?: number;     // read_show (from: also simulate, read_file, read_monitor)
  about?: string | string[];                                                    // read_reference
  target?: string; say?: string;                                                // show_in_app
  text?: string; type?: string;                                                 // find_cues
  path?: string; lines?: number;                                                // list_folder, read_file
  ops?: Op[]; summary?: string;                                                 // edit_show, propose_changes
  gos?: number; gap?: number | null;                                            // simulate
  last?: number;                                                                // read_monitor
  host?: string; port?: number; probe?: string;                                 // ask_device
  sketch?: string; board?: string; pin?: number; order?: string; output?: string; ssid?: string; address?: string;
  look?: { r?: number; g?: number; b?: number; level?: number; effect?: string };   // make_prop_files
  why?: string;                                                                 // hand_off
  /** the provider's mark on arguments that were not JSON */
  __invalid_json?: unknown;
}

/** What a tool call answers: the tool_result's text, and what it staged or pointed at. */
export interface ToolResult {
  content: string;
  is_error?: boolean;
  /** the id of the proposal propose_changes staged */
  proposal?: string;
  /** the place show_in_app rang */
  point?: { target: string; say: string; cue: string | null };
}

/** As much of the cue engine as the tools read: how long each sound is, what is playing, the playhead. */
export interface EngineView { durations: Map<string, number>; running: { size: number }; playhead: string | null }

type RigItem = ReturnType<typeof rigCheck.items>[number];
/** A prop that answered Look for props. */
export interface FoundProp { name: string; kind?: string; fw?: string; host: string; port: number; known?: string | null; moved?: boolean }
/** One device's state as the running app has it. */
interface DeviceState { state: string; text?: string; heardAt?: number; ageMs?: number | null; lastIn?: string; reports?: { label: string; value: unknown; unit?: string; warn?: boolean }[] }
/** What the running app says of the Rig: the check's rows, each device, what the last look found, this computer. */
export interface RigStatus {
  items?: RigItem[];
  summary?: { text?: string; ready: number; total: number; at?: number };
  devices?: Record<string, DeviceState>;
  found?: FoundProp[] | null;
  computer?: {
    audio?: { device?: string; outputs?: number; devices?: string[] };
    displays?: string[];
    midi?: { inputs?: string[]; outputs?: string[] };
    interfaces?: { name: string; address: string }[];
  };
}
/** A line of the monitor: a message sent (out) or heard (in). */
type MonitorEntry = Logged;
/** An address sending here that is not the show's. */
interface Sender { address: string; port: number; messages?: { address: string; count: number; every?: number | null }[] }
/** What an "are you there?" heard. */
interface AskAnswer { ok?: boolean; held?: boolean; answered?: boolean; ms?: number; text?: string; why?: string }
export type AskTarget = string | { host: string; port: number; probe: string };
/** The host's rig service (app/main/rig-service.ts): the one door to the equipment the tools have. */
export interface RigService {
  status(): RigStatus | null;
  monitor(last: number): MonitorEntry[] | null;
  senders(): Sender[] | null;
  locked(): boolean;
  scan(): FoundProp[] | { error?: string } | Promise<FoundProp[] | { error?: string }>;
  ask(target: AskTarget): AskAnswer | null | Promise<AskAnswer | null>;
}
/** A place show_in_app asks the window to ring, and the window's answer. */
export interface PointerService {
  locked(): boolean;
  point(place: Record<string, unknown>): { ok?: boolean; why?: string; instead?: string } | null | Promise<{ ok?: boolean; why?: string; instead?: string } | null>;
}

/**
 * A turn's state, which execute() reads and replaces: the show, the draft and how it was made, what is staged for
 * the folder, and the services of the running app (absent with a show folder alone).
 */
export interface ToolContext {
  document: ShowDocument;
  engine?: EngineView | null;
  draft?: ShowDoc | null;
  base?: ShowDoc | null;
  log?: { ops: Op[]; made: string[] }[] | null;
  files?: Map<string, string> | [string, string][] | null;
  rig?: RigService | null;
  ui?: PointerService | null;
  asks?: { n: number; at: number };
  found?: FoundProp[];
  bin?: string;
}

/** A field of the devices table (core/rig/devices.ts). */
interface DeviceField {
  key: string; kind: string; help?: string; options?: readonly string[]; labels?: Record<string, string>;
  required?: boolean; default?: unknown; min?: number; max?: number; when?: string; network?: boolean;
}
const isType = (t: string): t is CueType => !!(TYPES as Record<string, unknown>)[t];

/** How many "are you there?" messages one turn may send. */
const MAX_ASKS = 30;
/** An agent outside the app has no turns: its count starts again after this long without asking. */
const ASKS_FORGET_MS = 5 * 60 * 1000;
/** More devices than this and the outline names them only: read_show {"device": …} has each in full. */
const MANY_DEVICES = 12;

const obj =(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });
/** A show with more cues than this gets the short outline (top-level cues only): the whole of it is too much to send with every question. */
const LONG_SHOW = 250;
/** The kinds of field whose value is words someone might search for. */
const TEXT_KINDS = new Set(['text', 'longtext', 'file', 'patch', 'bus', 'input', 'enum']);
const TOOLS: Tool[] = [
  {
    name: 'read_show',
    description: `Read the show as your draft has it. No arguments: the outline (every list and cue with its id, number, type, name and settings; buses, patches, devices, settings, modules). The outline sent with the request is the show before your edits: read again after editing for new ids. A show of more than ${LONG_SHOW} cues gets a short outline (top-level cues only): use \`from\` for a run in full, or find_cues.`,
    input_schema: obj({
      cue: { type: 'string', description: 'A cue id or "#<number>": that cue as JSON, children included.' },
      device: { type: 'string', description: 'A device id or name: that device as JSON (every command, how it is asked, what it reports).' },
      from: { type: 'string', description: 'A cue id or "#<number>": the cues from this one on at its level, in full.' },
      count: { type: 'integer', description: 'With `from`: how many (default 40, at most 200).' },
    }),
  },
  {
    name: 'read_reference',
    description: 'The reference in full, a part at a time: a cue type\'s every field with its values and help (the instructions carry only names and kinds), every setting path with its value in a new show, a device\'s fields, a model\'s commands and set-up notes. Look up before using a field, setting or model you are not sure of. It reads the app\'s own tables and changes nothing.',
    input_schema: obj({ about: { type: 'string', description: `One or more, separated by commas: a cue type (timecode, midifile, audio…), "every" (the fields every cue has), "settings", "devices", "models", a model id (etc-eos, x32…), "app" (its screens and keys), or "all".` } }, ['about']),
  },
  {
    name: 'show_in_app',
    description: 'Ring a place in the window for a few seconds, with your words, bringing it into view first. Changes nothing. Places: the [names] in read_reference "app" (panic, inspector-field:color, cue:12, settings:audio…).',
    input_schema: obj({ target: { type: 'string' }, say: { type: 'string', description: 'A few words.' }, cue: { type: 'string', description: 'The cue an inspector place is shown on.' } }, ['target']),
  },
  {
    name: 'find_cues',
    description: 'Search the cues by text (number, name, notes, file, bus, patch, message, triggers, hotkey: every word must appear) and/or type. Returns each match with its id, number, settings and where it is.',
    input_schema: obj({ text: { type: 'string', description: 'Words to look for; case does not matter.' }, type: { type: 'string', enum: TYPE_ORDER } }),
  },
  {
    name: 'list_media',
    description: 'The sound files under media/ and every file a cue names, with lengths where known and the cues that use each.',
    input_schema: obj({}),
  },
  {
    name: 'list_folder',
    description: 'The files in the show folder, two levels deep: path, kind (sound, video, image, midi, text, other), size, a sound\'s length, and the cues that use it or "not used by any cue". A path as listed is what a cue\'s `file` takes.',
    input_schema: obj({ path: { type: 'string', description: 'One sub-folder ("sfx"). Default: the top.' } }),
  },
  {
    name: 'read_file',
    description: 'Read a text file in the show folder (a script, cue sheet or notes: .txt .md .fountain .csv .docx and more), with line numbers, at most 400 lines a call. In the show\'s script each "@cue 12 Thunder" mark is noted with whether a cue has that number.',
    input_schema: obj({ path: { type: 'string', description: 'Its path, as list_folder gives it.' }, from: { type: 'integer', description: 'First line (default 1).' }, lines: { type: 'integer', description: 'How many (default and at most 400).' } }, ['path']),
  },
  {
    name: 'edit_show',
    description: 'Apply operations to your draft (cues, lists, settings, devices). Atomic: if one is invalid none is applied and you get the reason. Returns what changed, the ids of what you added, and any problem the batch leaves in the draft. Call it as often as the job needs.',
    input_schema: obj({ ops: { type: 'array', description: 'The operations, in order (OPERATIONS in the reference).', items: { type: 'object' } } }, ['ops']),
  },
  {
    name: 'check_show',
    description: 'What is wrong in your draft: missing targets and files, a Fade aimed at the wrong kind of cue, a cue whose patch, device or command is gone, values out of range, bad MIDI messages and hotkeys, duplicate numbers, script marks with no cue. Run it before proposing anything non-trivial.',
    input_schema: obj({}),
  },
  {
    name: 'simulate',
    description: 'Dry-run your draft on the real cue engine, silently and at once: press GO `gos` times from `from`, and read second by second what plays at what level, what fades, what is sent to which device, and what still sounds at the end. Use it whenever timing or sequence matters.',
    input_schema: obj({ from: { type: 'string', description: 'A top-level cue: "#<number>" or an id. Default: the top of the first list.' }, gos: { type: 'integer', description: 'GOs (default 1, at most 20).' }, gap: { type: 'number', description: 'Seconds between GOs. Default: until everything that happens by itself has happened (up to 30 s).' } }),
  },
  {
    name: 'rig_status',
    description: 'What the show depends on and whether each part is ready, worst first, with what is wrong and what to do; each device\'s state, when last heard and what it reports; this computer\'s sound outputs, displays, MIDI ports and networks. It sends nothing.',
    input_schema: obj({}),
  },
  {
    name: 'read_monitor',
    description: 'The last messages the show sent (→) and heard (←), with the time, who, the message and why (the cue, or "NOT SENT" and the reason); then unknown senders: addresses sending here that are not the show\'s, with what and how often. For whether a message went out, what a device answered, and the address and messages of equipment just switched on.',
    input_schema: obj({ last: { type: 'integer', description: 'How many (default 40, at most 200).' }, from: { type: 'string', description: 'Only to or from this device id or address.' } }),
  },
  {
    name: 'ask_device',
    description: `Ask one piece of equipment "are you there?" and wait 1.5 s for the answer. {"device": id}: a device in the show (accepted, not only in your draft) is sent its own question. {"host", "port", "probe"}: an address on the local network is sent the test message of the model named by probe (etc-eos sends /eos/ping), to check what the person said is there before proposing it. You cannot choose the message. At most ${MAX_ASKS} a turn.`,
    input_schema: obj({ device: { type: 'string', description: 'A device id in the show.' }, host: { type: 'string', description: 'A private address (10.x, 172.16–31.x, 192.168.x, 169.254.x, 127.x).' }, port: { type: 'integer', description: 'Default: the model\'s usual port.' }, probe: { type: 'string', description: 'A model id that has a test message.' } }),
  },
  {
    name: 'find_devices',
    description: 'Look for props running the kit\'s firmware: one broadcast hello, 1.5 s of listening. Returns each prop that answered (name, kind, firmware, address) and whether the show has it. It finds nothing else (not a desk or a mixer) and it puts a message on the network: call it only when the person asks to look for a prop or says one is on. To add one: device.add with the model for its kind (ec-prop-light, ec-prop-switch), its name and address.',
    input_schema: obj({}),
  },
  {
    name: 'make_prop_files',
    description: 'Stage the app\'s own firmware for a prop (an ESP32 with an LED strip, "light", or a relay or servo, "switch"), set up from these settings, under props/<device id>/, with the steps for putting it on the board. The device must be in the show or your draft (device.add first). Then propose_changes. Never ask for a Wi-Fi password.',
    input_schema: obj({
      device: { type: 'string', description: 'The device\'s id.' },
      sketch: { type: 'string', enum: ['light', 'switch'] },
      board: { type: 'string', enum: Object.keys(kit.BOARDS), description: 'Default esp32dev.' },
      pin: { type: 'integer', description: 'The GPIO of the data wire, relay or servo (default 5; on a C3, 4).' },
      count: { type: 'integer', description: 'A light: LEDs (default 30).' },
      order: { type: 'string', enum: ['GRB', 'RGB', 'BRG'], description: 'A light: colour order (default GRB; RGB for most WS2811).' },
      output: { type: 'string', enum: ['relay', 'servo'], description: 'A switch (default relay).' },
      ssid: { type: 'string', description: 'The Wi-Fi network\'s name, only if the person said it.' },
      address: { type: 'string', description: 'A fixed address, only if the person wants one.' },
      look: { type: 'object', description: 'A light at power-on: { r, g, b (0–255), level (0–1), effect: steady | breathe | pulse | flicker }. Default warm white, 0.4, steady.' },
    }, ['device', 'sketch']),
  },
  {
    name: 'hand_off',
    description: 'For what needs code (a protocol devices cannot describe, a login or checksum, a decision with state, firmware beyond the kit, a program beside the show): stages AGENTS.md and CLAUDE.md in the show folder, written by the app, for a coding agent. You give only the reason. Then propose_changes.',
    input_schema: obj({ why: { type: 'string', description: 'One sentence: what the person wants that needs a coding agent.' } }, ['why']),
  },
  {
    name: 'propose_changes',
    description: 'Finish: hand your draft (and any staged files) to the person as one change to review. `ops` applies a last batch first: for a small job this one call is the whole job. Call it once, when the draft is right.',
    input_schema: obj({ summary: { type: 'string', description: 'One short sentence on what the change does, in the operator\'s terms: the review\'s title and the version note.' }, ops: { type: 'array', description: 'Optional: operations to apply first.', items: { type: 'object' } } }, ['summary']),
  },
];

/** A cue's settings on one line, read from the cue-type table: every field it has a value for, the common ones included. */
function cueBits(c: Cue, byId: CueIndex) {
  const bits: string[] = [];
  for (const f of TYPES[c.type].fields) {
    const v = c[f.key as keyof Cue];
    if (f.hidden || v === undefined) continue;
    if (f.kind === 'cue') { const t = byId.get(v as string); bits.push(`${f.key}→${t ? (t.number ? `#${t.number}` : t.id) : 'MISSING'}`); }
    else if (typeof v === 'object') bits.push(`${f.key}:${JSON.stringify(v)}`);
    else if (f.kind === 'seconds') bits.push(`${f.key}=${v}s`);
    else bits.push(`${f.key}=${v}`);
  }
  for (const f of COMMON) {
    const v = c[f.key as keyof Cue];
    if (TYPES[c.type].fields.some((x) => x.key === f.key)) continue;      // (a type's own field of the same name is said above)
    if (f.key === 'number' || f.key === 'name' || v === undefined || v === '' || v === f.default) continue;
    if (f.key === 'continue') bits.push(v as string);
    else if (f.key === 'armed') bits.push('DISARMED');
    else if (f.key === 'flagged') bits.push('flagged');
    else if (f.kind === 'longtext') { const s = v as string; bits.push(`${f.key}=${JSON.stringify(s.length > 80 ? s.slice(0, 80) + '…' : s)}`); }
    else if (f.kind === 'seconds') bits.push(`${f.key}=${v}s`);
    else bits.push(`${f.key}=${v}`);
  }
  return bits.join(' ');
}
const cueRef = (c: Cue) => (c.number ? `#${c.number}` : c.id);
const cueHead = (c: Cue, byId: CueIndex, bare: Set<string> | null = null) => `${bare && bare.has(c.id) ? '' : `[${c.id}] `}${c.number ? `#${c.number} ` : ''}${TYPES[c.type].label}: ${c.name || defaultName(c, byId)}`;
/** The cues the outline names by number alone: "#12" finds each of them, so its id would be sent for nothing (a long show is mostly ids). */
function byNumberAlone(doc: ShowDoc) {
  const seen = new Map<string, string | null>();
  show.walk(doc, (c) => { if (c.number) seen.set(String(c.number), seen.has(String(c.number)) ? null : c.id); });
  return new Set([...seen.values()].filter((id): id is string => !!id));
}

/** Settings as `path=value`, every one there is (so a new setting is in the outline the day it exists). A passcode is never sent: only whether one is set. */
const secret = (k: string, prefix: string) => /pass|token|secret/i.test(k) || (/key/i.test(k) && !/duck\.$/.test(prefix));      // (a duck's key is the bus that ducks: not a secret)
function flatSettings(node: object | null | undefined, prefix = '', out: string[] = []) {
  for (const [k, v] of Object.entries(node || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) flatSettings(v, `${prefix}${k}.`, out);
    else out.push(`${prefix}${k}=${secret(k, prefix) ? (v ? '(set)' : '(none)') : JSON.stringify(v)}`);
  }
  return out;
}
/** The same, leaving out what is as a new show has it: most of a show's settings are, and the outline goes with every request. */
const changedSettings = (node: object, defaults: object) => { const was = new Set(flatSettings(defaults)); return flatSettings(node).filter((l) => !was.has(l)); };
const extras = (o: object, known: string[]) => Object.entries(o).filter(([k, v]) => !known.includes(k) && v !== undefined && v !== '').map(([k, v]) => `, ${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join('');
function settingsLines(doc: ShowDoc) {
  const s = doc.settings;
  const bus = (b: Bus) => (b && typeof b === 'object' ? `${b.id} (${b.name}, ${b.db} dB${Number(b.out) > 1 ? `, outputs ${b.out}–${Number(b.out) + 1}` : ''}${extras(b, ['id', 'name', 'db', 'out'])})` : '(not a bus)');
  const patch = (p: Patch) => (p && typeof p === 'object' ? `${p.id} = ${p.name} ${p.host}:${p.port}${extras(p, ['id', 'name', 'host', 'port', 'notes'])}` : '(not a patch)');
  // (the rig is drawn by rigLines: a device is not a setting to flatten)
  const { audio = {} as Partial<ShowDoc['settings']['audio']>, network = {} as Partial<ShowDoc['settings']['network']>, rig: _rig, ...rest } = s;
  const { buses = [], ...audioRest } = audio;
  const { patches = [], ...networkRest } = network;
  return [
    `Buses: ${Array.from(buses, bus).join('; ')}`,
    `Network patches: ${Array.from(patches, patch).join('; ') || 'none'}`,
    `Settings not as in a new show (read_reference "settings" has every path): ${changedSettings({ ...rest, audio: audioRest, network: networkRest }, (({ audio: a = {}, network: n = {}, rig: _r, ...r }) => ({ ...r, audio: { ...a, buses: undefined }, network: { ...n, patches: undefined } }))(show.defaultSettings())).join('; ') || 'none'}`,
    `Modules: ${Object.entries(doc.modules || {}).map(([id, m]) => { const opts = m ? changedSettings(Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'enabled')), show.defaultModules()[id as keyof ShowDoc['modules']] || {}) : []; return `${id} ${m && m.enabled ? 'ON' : 'off'}${opts.length ? ` (${opts.join(', ')})` : ''}`; }).join('; ')}`,
  ];
}

/**
 * The equipment and the folder, for the outline: one line a device, and at most three lines more (so a long show is
 * not made longer by anything else). `Rig now` is there only when the app is running, as the Playhead line is.
 * File names are not here: list_folder has them.
 */
function rigLines(doc: ShowDoc, { rig = null, showDir = null }: { rig?: RigService | null; showDir?: string | null } = {}) {
  const lines: string[] = [];
  const devs = rigDevices.list(doc);
  if (devs.length > MANY_DEVICES) lines.push(`Devices (${devs.length}; read_show {"device": "<id>"} for one in full): ${devs.map((d) => `${d.id} = ${d.name}`).join('; ')}`);
  else devs.forEach((d, i) => lines.push(`${i ? '         ' : 'Devices: '}${rigDevices.line(d)}`));
  if (!devs.length) lines.push('Devices: none');
  const r = doc.settings.rig || {};
  const bits: string[] = [];
  if (r.script) { const sc = showDir ? scriptFile.read(showDir, r.script) : null; bits.push(`script ${r.script}${sc ? (sc.ok ? ` (${sc.lines} lines, ${sc.marks.length} mark${sc.marks.length === 1 ? '' : 's'})` : ' (NOT FOUND in the folder)') : ''}`); }
  if ((r.checks || []).length) bits.push(`checklist ${r.checks.length} line${r.checks.length === 1 ? '' : 's'}`);
  if (showDir) {
    // (the show's material: not the firmware under props/, nor the guide for coding agents, which the app wrote itself)
    const n = folder.counts(quickListing(showDir, doc).filter((e) => !/^props\//.test(e.path) && !/^(AGENTS|CLAUDE)\.md$/.test(e.path)));
    const have = [n.sounds && `${n.sounds} sound${n.sounds === 1 ? '' : 's'}`, n.videos && `${n.videos} video${n.videos === 1 ? '' : 's'}`, n.texts && `${n.texts} text file${n.texts === 1 ? '' : 's'}`].filter(Boolean);
    bits.push(`folder: ${have.join(', ') || 'no sounds or text files'}${n.unused ? `; ${n.unused} file${n.unused === 1 ? '' : 's'} no cue uses` : ''}`);
  } else bits.push('not saved to a folder yet');
  lines.push(`Rig: ${bits.join(' · ')}`);
  const now = rig ? rigNow(rig) : '';
  if (now) lines.push(`Rig now: ${now}`);
  return lines;
}
/** The folder's files without opening each sound to measure it: for a count, the names are enough. */
const quickListing = (showDir: string, doc: ShowDoc, opts: { under?: string; depth?: number } = {}) => folder.listing(showDir, doc, { ...opts, durations: new Proxy({}, { get: () => 1 }) });
const STATE_ORDER = ['problem', 'look', 'unknown', 'ready'];
const STATE_WORD: Record<string, string> = { problem: 'problem', look: 'to look at', unknown: 'cannot be told', ready: 'ready' };
/** The Rig in one line: the summary, then what is not ready, worst first. '' when there is nothing to say. */
function rigNow(rig: RigService) {
  let st; try { st = rig.status(); } catch { return ''; }
  if (!st || !st.summary || !st.summary.total) return '';
  const not = (st.items || []).filter((i) => i.state === 'problem' || i.state === 'look').sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
  return [st.summary.text, ...not.slice(0, 4).map((i) => `${STATE_WORD[i.state]}: ${i.label}${i.text ? ` (${i.text})` : ''}`), ...(not.length > 4 ? [`and ${not.length - 4} more (rig_status)`] : [])].filter(Boolean).join(' · ');
}

/**
 * The show as text for the model: compact, but with every id it needs to name things.
 * A long show (more than LONG_SHOW cues) is given short unless `full`: its top-level cues by id, number, type and
 * name, with what is inside a group counted rather than listed. read_show's `from` and find_cues give the rest.
 */
function outline(doc: ShowDoc, { engine = null, full = false, rig = null, showDir = null }: { engine?: EngineView | null; full?: boolean; rig?: RigService | null; showDir?: string | null } = {}) {
  const { byId } = show.index(doc);
  const bare = byNumberAlone(doc);
  const lines = [`Show: ${doc.title}`, ...(doc.notes ? [`Notes on the show: ${JSON.stringify(doc.notes.length > 1500 ? doc.notes.slice(0, 1500) + '…' : doc.notes)}`] : []), ...settingsLines(doc), ...rigLines(doc, { rig, showDir })];
  const short = !full && byId.size > LONG_SHOW;
  if (short) lines.push(`This is a long show (${byId.size} cues), so this outline is the short one: top-level cues only, without their settings. For a run of cues in full: read_show {"from": "#<number>", "count": 40}. For one cue as JSON with its children: read_show {"cue": "#<number>"}. To search: find_cues.`);
  const under = (c: Cue) => { let n = 0; show.walk({ lists: [{ id: '', name: '', cues: c.children || [] }] }, () => { n++; }); return n; };
  const go = (cues: Cue[], depth: number) => {
    for (const c of cues) {
      if (short) { lines.push(`  - ${cueHead(c, byId, bare)}${c.children ? ` (${under(c)} inside)` : ''}`); continue; }
      const dur = engine && c.type === 'audio' && engine.durations.get(c.file!) ? ` (${formatSeconds(engine.durations.get(c.file!)!, 1)} long)` : '';
      const bits = cueBits(c, byId);
      lines.push(`${'  '.repeat(depth + 1)}- ${cueHead(c, byId, bare)}${dur}${bits ? ' · ' + bits : ''}`);
      if (c.children) go(c.children, depth + 1);
    }
  };
  for (const l of doc.lists) { lines.push(`List "${l.name}" [${l.id}] — ${l.cues.length} top-level cues:`); go(l.cues, 0); if (!l.cues.length) lines.push('  (empty)'); }
  if (engine) {
    const ph = engine.playhead && byId.get(engine.playhead);
    lines.push(`Playhead: ${ph ? cueRef(ph) : 'end of list'}${engine.running.size ? ` · ${engine.running.size} sound(s) playing right now` : ''}`);
  }
  return lines.join('\n');
}

/** A run of cues in full: `count` cues from `cue` on, at its level, with their children. */
function outlineFrom(doc: ShowDoc, cue: Cue, count: number, engine: EngineView | null) {
  const { byId } = show.index(doc);
  const bare = byNumberAlone(doc);
  const loc = show.locate(doc, cue.id)!;      // (the cue was found in this show)
  const run = loc.siblings.slice(loc.at, loc.at + count);
  const lines = [`${run.length} cue${run.length === 1 ? '' : 's'} from ${cueRef(cue)} in ${loc.parent ? `group ${cueRef(loc.parent)}` : `list "${loc.list.name}"`} (${loc.siblings.length - loc.at - run.length} more after these):`];
  const go = (cues: Cue[], depth: number) => {
    for (const c of cues) {
      const dur = engine && c.type === 'audio' && engine.durations.get(c.file!) ? ` (${formatSeconds(engine.durations.get(c.file!)!, 1)} long)` : '';
      const bits = cueBits(c, byId);
      lines.push(`${'  '.repeat(depth + 1)}- ${cueHead(c, byId, bare)}${dur}${bits ? ' · ' + bits : ''}`);
      if (c.children) go(c.children, depth + 1);
    }
  };
  go(run, 0);
  return lines.join('\n');
}

// ── the reference: generated from the tables the app uses ─────────────
//
// Two forms of it. The brief one (reference()) goes with every request: every cue type and every field by name,
// the common fields with their values, the operations, and the equipment in a line a model. The full one, a part at
// a time, is read_reference's answer: a type's every field with its help, every setting path, every device field,
// each model's commands. Both are written from the same tables (core/show/cue-types.ts, core/rig/devices.ts,
// core/net/devices.ts, the show's own defaults), so neither can fall behind them; what moved out of the brief is
// what a model needs on few asks, and the brief says where to read it.

const when = (f: Field) => (f.when ? `, only when ${Object.entries(f.when).map(([k, v]) => `${k} is ${v.join(' or ')}`).join(' and ')}` : '');
const dflt = (f: Field) => (f.default !== undefined && f.default !== '' ? `, default ${f.default}` : '');
const options = (f: Field | DeviceField) => f.options!.filter(Boolean).map((o) => (f.labels && f.labels[o] ? `${o} (“${f.labels[o]}”)` : o)).join(' | ');
/** One field in full: its kind, its values (the colours named once, as "colour"), required, default, the mode it belongs to, its help. */
const fieldLine = (f: Field) => `    ${f.key} (${f.kind}${f.options ? ': ' + (f.options === COLORS ? 'a colour' : options(f)) : ''}${f.targets ? `: a ${f.targets.map((t) => TYPES[t].label).join(', ')} cue` : ''}${f.required ? ', required' : ''}${dflt(f)}${when(f)})${f.help ? ' — ' + f.help : ''}`;
const COLOUR_LINE = `    (a colour is one of: ${COLORS.join(' ')}; or any colour as #rrggbb)`;
// (a heading has only some of the fields every cue has, and a place of its own: core/show/sections.ts)
const HEADING = (t: CueType) => (TYPES[t].heading ? ` Has only ${TYPES[t].common!.join(', ')}. A top-level entry of a list, over the cues after it up to the next section; never inside a group; GO and continues pass over it.` : '');
const typeHead = (t: CueType) => `${t} — ${TYPES[t].label}: ${TYPES[t].summary}${TYPES[t].container ? ' Has "children".' : ''}${HEADING(t)}`;
function typeFull(t: CueType) { return [typeHead(t), ...TYPES[t].fields.filter((f) => !f.hidden).map(fieldLine)].join('\n'); }
const commonFull = () => ['Every cue has:', ...COMMON.map(fieldLine), COLOUR_LINE].join('\n');

/** One field in brief: key:kind (text is the kind when none is said), * required, =default unless false, 0, empty
 *  or an enum's first value, an enum as a|b|c, and the mode it belongs to. A field the inspector keeps out of the
 *  way (advanced, or on its own tab) is named only. */
const SHORT_KIND: Record<string, string> = { text: '', seconds: 's', db: 'dB' };
const briefKind = (f: Field) => (f.options === COLORS ? 'colour' : f.options ? f.options.filter(Boolean).join('|') : f.targets ? `cue(${f.targets.join('|')})` : SHORT_KIND[f.kind] ?? f.kind);
const briefField = (f: Field) => {
  const k = briefKind(f), d = f.default;
  const shown = d !== undefined && d !== '' && d !== false && d !== 0 && !(f.options && d === f.options[0]);
  return `${f.key}${f.required ? '*' : ''}${k ? ':' + k : ''}${shown ? '=' + d : ''}${f.when ? `(${Object.entries(f.when).map(([w, v]) => `${w} ${v.join('|')}`).join(', ')})` : ''}`;
};
const asidesOf = (fields: Field[]) => fields.filter((f) => !f.hidden && (f.advanced || f.tab));
function briefFields(fields: Field[]) {
  const main = fields.filter((f) => !f.hidden && !f.advanced && !f.tab).map(briefField);
  const aside = asidesOf(fields).map((f) => f.key);
  return `${main.join(' ')}${aside.length ? `${main.length ? '; ' : ''}also ${aside.join(' ')}` : ''}`;
}

const OPERATIONS = () => [
  'OPERATIONS (the `ops` of edit_show and propose_changes)',
  '  { "op": "cue.add", "cue": { "type": "audio", "number": "12", "name": "…", …fields, "children": [ …cues ] }, "ref": "a", "after": "#11" }',
  '      Where: "after" or "before" a cue, "parent" (a group, appended) or "list" (a list id or name, appended); default the end of the first list. "ref" (optional, children too) names the new cue for later ops and target fields in the same batch: "@a".',
  '  { "op": "cue.set", "id": "#12", "props": { "gainDb": -8, "notes": null } }      null clears a field',
  '  { "op": "cue.remove", "id": "#12" }',
  '  { "op": "cue.move", "ids": ["#12", "#13"], "before": "#4" }      or "after", "parent", "list"',
  '  { "op": "cue.duplicate", "id": "#12", "ref": "copy" }      the copy lands after the original, with no number',
  '  { "op": "cue.renumber", "ids": ["…"], "start": 1, "step": 1, "prefix": "", "suffix": "" }      the cues named, in the order given; a number another cue has is passed over',
  '  { "op": "cue.unnumber", "ids": ["…"] }',
  '  { "op": "list.add", "name": "Preshow" }   { "op": "list.rename", "id": "…", "name": "…" }   { "op": "list.remove", "id": "…" }',
  '  { "op": "list.add", "name": "Stings", "cart": { "rows": 3, "columns": 4 } }      a cart: a grid of buttons, each starting its cue (a cue\'s "cell" is "row,column")',
  '  { "op": "list.cart", "id": "…", "rows": 3, "columns": 4 }      resize a cart, or make a list one ("rows": null: a plain list again)',
  '  { "op": "show.set", "path": "settings.go.panicFade", "value": 2 }      see SETTINGS',
  '  { "op": "device.add", "device": { … } }   { "op": "device.set", "id": "lantern_a", "props": { … } }   { "op": "device.remove", "id": "lantern_a" }      see DEVICES',
  `An operation takes only these keys: ${Object.entries(OP_KEYS).map(([op, keys]) => `${op}: ${keys.join(', ')}`).join(' · ')}.`,
  'Naming cues: "#<number>"; an id as shown in [brackets] (the outline shows one only for a cue with no number, or with a number another cue has); or "@<ref>" (only inside the batch that made it: later, the id the answer gave).',
  'Units: times in seconds; levels in dB (0 = the file\'s own level, -60 is silence).',
];

/** Every settings path, with its value in a new show, and what the lists hold. */
function settingsFull() {
  return [
    'SETTINGS (show.set; they are part of the show). Paths: title, notes, and these, shown with their value in a new show:',
    ...flatSettings({ settings: (({ audio, network, rig, ...rest }) => ({ ...rest, audio: { ...audio, buses: undefined }, network: { ...network, patches: undefined } }))(show.defaultSettings()), modules: show.defaultModules() }).filter((l) => !l.endsWith('=undefined')).map((l) => `    ${l.replace(/=\((set|none)\)$/, '=""')}`),
    '  settings.audio.buses — the mixer\'s buses, a list of { id, name, db }. One bus can be named in a path by its id: "settings.audio.buses.music.db".',
    '      A bus may also carry: out (routing: the first of the pair of the device\'s outputs it plays on; 1 = outputs 1–2, the default; 3 = outputs 3–4; 5 = 5–6 …), mute (true | false), pan (-1 left … 1 right), eq ({ low, mid, high } in dB).',
    '      To add or remove a bus, set the whole list. A cue\'s "bus" is a bus id.',
    '  settings.light — the app\'s own lights (DMX over Art-Net or sACN). To change a list, set the whole list:',
    '      settings.light.universes: [{ id (the number instruments name, from 1), protocol: "artnet" | "sacn", address (Art-Net from 0, sACN from 1), host ("" = broadcast / multicast) }]',
    '      settings.light.instruments: [{ name, fixture, universe, address (first DMX channel, 1–512) }]; fixture is one of dimmer, rgb, rgbw, rgba, dimmer-rgb, dimmer-rgbw, mover, mover-16, or the id of one in settings.light.fixtures.',
    '      settings.light.groups: [{ name, members: [instrument or group names] }]. A Light cue\'s `levels` names instruments and groups ("front = 80", "wash = 50", "all = 0", "cyc.red = 100").',
    '  settings.network.patches — the equipment OSC is sent to, a list of { id, name, host, port, protocol: "udp" | "tcp", device }. One patch can be named by its id in a path. A Network cue\'s "patch" is a patch id.',
    ...RIG_SETTINGS,
  ].join('\n');
}
const RIG_SETTINGS = [
  '  settings.rig.script — the show’s script: the path of one text file in the show folder ("script.md"; "" none). The app reads its "@cue <number> <name>" marks and never writes it.',
  '  settings.rig.checks — the operator’s own checklist on the Rig page, set whole: [{ "id": "k1", "text": "Fresh batteries in both lanterns" }].',
  '  settings.rig.devices — NOT set with show.set: see DEVICES.',
];

// the equipment: written from core/rig/devices.ts's tables, as the cue types are written from theirs
const dfield = (f: DeviceField) => `    ${f.key} (${f.kind}${f.options ? ': ' + options(f) : ''}${f.required ? ', required' : ''}${f.default !== undefined && f.default !== '' ? `, default ${f.default}` : ''}${f.min !== undefined ? `, ${f.min} to ${f.max}` : ''}${f.when ? `, only when how is ${f.when}` : ''}${f.network ? ', network devices only' : ''})${f.help ? ' — ' + f.help : ''}`;
const PATCH_TO_DEVICE = 'Making a network patch a device (so it has a Rig row, a Try button and an "are you there?"), in one batch: device.add with the patch’s own id, name, host and port (and the model its "device" names), and show.set of settings.network.patches to the list without that patch. Cues that named the patch then name the device, unchanged.';
function devicesFull() {
  return [
    'DEVICES (the equipment the show talks to: part of the show, under settings.rig.devices, changed only by the three device operations)',
    'A device is an address, named commands (each a message with {holes} for typed parameters), one way of telling whether it is there, and what to read out of what it says. Nothing in it is code.',
    '  { "op": "device.add", "device": { "name": "Lighting desk", "model": "etc-eos", "host": "10.0.0.20" } }',
    '      From a model (see MODELS): its commands, port, protocol, kind, "are you there?" and reports are copied in; give the name and the address. "id" is made from the name when left out (Lighting desk → lighting_desk); the answer names it.',
    '  With no model: its commands written from what the person gave you (FOG below). A device may be added with no address yet ("host" left out): it cannot be sent to until it has one.',
    '  { "op": "device.set", "id": "lantern_a", "props": { "host": "10.0.0.57", "notes": null } }',
    '      null clears a field. commands, reports and alive are each set WHOLE (to add one command, read the device with read_show {"device": …} and set the full list). The id cannot change.',
    '  { "op": "device.remove", "id": "lantern_a" }      cues that named it become broken, and the answer says which',
    FOG, PATCH_TO_DEVICE,
    'Device fields:', ...rigDevices.FIELDS.map(dfield),
    'COMMAND FIELDS (each entry of commands):', ...rigDevices.COMMAND_FIELDS.map(dfield),
    'PARAM FIELDS (each entry of a command’s params):', ...rigDevices.PARAM_FIELDS.map(dfield),
    'ALIVE FIELDS (alive):', ...rigDevices.ALIVE_FIELDS.map(dfield),
    'REPORT FIELDS (each entry of reports):', ...rigDevices.REPORT_FIELDS.map(dfield),
    NETWORK_FADE,
  ].join('\n');
}
const FOG = '  FOG: { "op": "device.add", "device": { "name": "Fog machine", "kind": "other", "host": "10.0.0.60", "port": 9000, "commands": [ { "id": "burst", "label": "Burst", "template": "/fog/burst {secs}", "params": [ { "key": "secs", "label": "Seconds", "kind": "number", "default": 2, "min": 0, "max": 10 } ] }, { "id": "off", "label": "Off", "template": "/fog/off" } ] } }';
const NETWORK_FADE = 'In the typed `message` of a Network cue (for a patch, or for something a device has no command for), "#v#" stands for a value that fades from fadeFrom to fadeTo over the cue\'s duration. A Network cue’s "patch" may be a patch id or a device id.';
type Model = ReturnType<typeof devices.list>[number];
const modelHead = (d: Model) => `${d.id} — ${d.label} (${d.kind}; usually ${d.protocol} port ${d.port}${d.test ? `; test message ${d.test}${d.answers ? ', which it answers' : ''}` : '; no test message: it cannot be asked'})`;
const modelFull = (d: Model) => [`${modelHead(d)}${d.notes ? `. ${d.notes}` : ''}`, ...d.commands.map((c) => `    ${c.id} — ${c.label}: ${c.template}${c.fade ? `   (fades ${c.fade})` : ''}`)].join('\n');
const MODELS_HEAD = 'MODELS (what a device is started from: "model" in device.add. The id is also what ask_device’s "probe" takes, for a model with a test message.)';

/** The whole reference, every part in full: what read_reference {"about": "all"} answers. */
function fullReference() {
  return ['CUE TYPES', '', commonFull(), '', ...TYPE_ORDER.map((t) => `${typeFull(t)}\n`), ...OPERATIONS(), '', settingsFull(), '', devicesFull(), '', MODELS_HEAD, ...devices.list().map(modelFull)].join('\n');
}

/** What the model is given with every request: the brief reference. */
function reference() {
  const common = COMMON.filter((f) => !f.hidden);
  return [
    'CUE TYPES, in brief. Each field is key:kind (no kind: text); * required; =default (none said: false, 0, empty, or the first value); a|b|c the values it takes; (mode playlist) only then. "also" names further fields. Every field means what read_reference {"about": "<type>"} says, with its help; read it before using a field whose shape or meaning you are not sure of (a loop, a chain, an envelope, a trigger).',
    `Every cue: ${briefFields(common)}. A colour: ${COLORS.join(' ')} or #rrggbb. (read_reference "every")`,
    ...TYPE_ORDER.map((t) => `${t}${TYPES[t].label.toLowerCase() === t ? '' : ` (${TYPES[t].label})`} — ${TYPES[t].summary}${TYPES[t].container ? ' Has "children".' : ''}${HEADING(t)} ${briefFields(TYPES[t].fields)}`.trim()),
    '',
    ...OPERATIONS(),
    '',
    'SETTINGS (show.set). The outline\'s Settings and Modules lines show what is not as in a new show; read_reference "settings" lists every path with its value in a new show, and the light lists (universes, instruments, groups).',
    '  settings.audio.buses — a list of { id, name, db } (also out, the first of its pair of outputs: 3 = outputs 3–4; mute; pan; eq). One by its id in a path: "settings.audio.buses.music.db". To add or remove a bus, set the whole list. A cue\'s "bus" is a bus id.',
    '  settings.network.patches — a list of { id, name, host, port, protocol: udp|tcp, device }. A Network cue\'s "patch" is a patch id or a device id; "#v#" in its message fades from fadeFrom to fadeTo over its duration.',
    ...RIG_SETTINGS,
    '',
    'DEVICES (the show\'s equipment: changed only by device.add, device.set, device.remove; read_reference "devices" has every field of a device, a command, a parameter, alive and reports)',
    '  { "op": "device.add", "device": { "name": "Lighting desk", "model": "etc-eos", "host": "10.0.0.20" } }      from a model: its commands, port and "are you there?" are copied in; "id" is made from the name (lighting_desk) and the answer names it',
    FOG.replace('  FOG: ', '  With no model, commands written from what the person gave you: '),
    '  device.set: null clears a field; commands, reports and alive are each set whole (read_show {"device": …} first). The id cannot change. "host" may be left out until it is known.',
    '  A Device cue: { "type": "device", "device": "lighting_desk", "command": "fire", "args": { "cue": "12" } } (a parameter left out takes its default); a command that fades: "args": { "level": 0 }, "fadeTo": 1, "duration": 4. Leave its name out: it is shown as “Lighting desk ▸ Fire cue (1, 12)”.',
    `  ${PATCH_TO_DEVICE}`,
    `MODELS (id — what; kind, usual port, test message for ask_device's "probe"; read_reference "<model id>" for its commands and how to set the equipment up): ${devices.list().map((d) => `${d.id} — ${d.label} (${d.kind}, ${d.protocol} ${d.port}${d.test ? `, ${d.test}` : ''})`).join('; ')}.`,
  ].join('\n');
}

/** read_reference's answer: the parts asked for, in full. `about` is one or more names, separated by commas. */
const TOPICS = ['every', 'settings', 'devices', 'models', 'app', 'keys', 'all'];
function lookup(about: string | string[] | undefined) {
  const want = (Array.isArray(about) ? about : String(about || '').split(/[,;]+/)).map((w) => String(w).trim().toLowerCase().replace(/^"|"$/g, '')).filter(Boolean);
  if (!want.length) return { ok: false, text: `Say what to read: a cue type (${TYPE_ORDER.join(', ')}), a model id (${devices.list().map((d) => d.id).join(', ')}), or one of ${TOPICS.join(', ')}.` };
  const byLabel = Object.fromEntries(TYPE_ORDER.map((t) => [TYPES[t].label.toLowerCase(), t]));
  const models = Object.fromEntries(devices.list().map((d) => [d.id, d]));
  const out: string[] = [], unknown: string[] = [];
  for (const w of want) {
    const t = isType(w) ? w : byLabel[w] || byLabel[w.replace(/ cue$/, '')];
    if (t) out.push(typeFull(t));
    else if (w === 'every' || w === 'common') out.push(commonFull());
    else if (w === 'settings' || w === 'lights' || w === 'light settings') out.push(settingsFull());
    else if (w === 'devices' || w === 'device fields') out.push(devicesFull());
    else if (w === 'models') out.push([MODELS_HEAD, ...devices.list().map(modelFull)].join('\n'));
    else if (models[w]) out.push(modelFull(models[w]));
    else if (w === 'operations') out.push(OPERATIONS().join('\n'));
    else if (w === 'app' || w === 'screens' || w === 'keys' || w === 'shortcuts' || w === 'ui') out.push(appGuide.guide(w === 'shortcuts' ? 'keys' : w === 'ui' ? 'app' : w));
    else if (w === 'places') out.push(`The places show_in_app takes: ${places.listOfNames()}.`);
    else if (w === 'all') out.push(fullReference());
    else unknown.push(w);
  }
  if (unknown.length) out.push(`Nothing called ${unknown.map((u) => `“${u}”`).join(', ')}. What can be read: a cue type (${TYPE_ORDER.join(', ')}), a model id (${Object.keys(models).join(', ')}), or one of ${TOPICS.join(', ')}.`);
  return { ok: !!out.length && unknown.length < want.length, text: [...new Set(out)].join('\n\n') };
}

const SYSTEM = `You are the assistant inside Endless Cues, a show-control application for live theatre and events (in the family of QLab). The person you are working with is a sound designer, stage manager or operator building or adjusting a show: lists of cues that an operator fires one at a time with a GO button during a performance.

You can do anything to the show: build sequences and scenes (from a folder of sounds, or from a script), restructure and renumber, set up fades, ducks and crossfades, triggers, buses, patches and module settings, describe the show's equipment and make cues that command it, see whether the show is ready, stage firmware for a simple prop, and explain why something does what it does.

How you work:
- You work on a private draft. edit_show changes it; read_show, find_cues, check_show and simulate look at it. Nothing reaches the show until propose_changes hands the draft to the person as one change, which they review and accept or reject.
- For more than a one-line change: look first, edit, run check_show, and when timing or sequence matters run simulate and read what actually happens; fix and run again until it does what was asked. For a small, unambiguous change, one propose_changes call with its ops is the whole job.
- You cannot play the show, hear it, or save it. Say what the person should listen for.
- Make the change asked for and nothing more: do not renumber, rename, reorder or tidy what was not part of the request. A real problem elsewhere (a missing target, a duplicate number) goes in your reply, not fixed unasked. Follow the show's own numbering and naming.
- Never invent a sound file: an Audio cue's file comes from list_folder or list_media, or is one the person named. If one is missing, build the rest, leave that cue out or make a Memo saying what is needed, and say so.
- If a request is ambiguous in a way that changes what you would build (two cues match "the storm"), ask one short question. If it is only slightly underspecified, choose the conventional theatre default and say what you chose.
- If an edit is refused, read the reason, fix it and try again.
- The reference below is the whole truth about cue types, fields, operations and settings (generated from the app's own tables); use no field or type that is not in it. It is in brief: read_reference has what it leaves out (a cue type's fields in full with their help, every setting, the device fields, each model's commands). Read it before using a field, setting or model you are not sure of, rather than guess.
- Asked how to use the app (where something is, what a key does): read_reference "app", never guess, and show_in_app to point at it.
- A tool result beginning NOTE means the person changed the show while you worked: read it before going on.

How cues work here:
- GO fires the cue at the playhead and moves the playhead to the next top-level cue. A Group's children fire together when it fires, each after its own pre-wait: that is how one GO does several things at once or in a timed sequence. Its "mode" makes it a playlist, one child per GO ("enter"), or one at random.
- continue: "auto-continue" fires the next cue as this one starts (after its post-wait); "auto-follow" fires it when this one finishes.
- A Fade plays nothing: it moves the level of a cue already playing (its target). Fade out and stop: db -60 and stopTarget true. Duck music under a line: a Fade down (relative true, db about -12, duration about 1) and a later Fade back (relative true, db 0), usually children of one group, the return's pre-wait at the line's end.
- "Fade & stop others" (fadeOthers on a Group) is the usual way to make a scene change one GO: the new scene's group fades out everything that was playing.
- A Light cue's "levels" fades the app's own lights over its duration, one command a line ("front = 80", "wash = 50", "all = 0", "cyc.colour = #ff8800"), naming only instruments and groups in settings.light; lights it does not name stay unless "block" is true. Its "lightCue" is a desk cue number: called by the operator, and fired on the desk when the lighting desk module is on.
- A Network cue sends one message to a patch or a device; with "#v#" and a duration it fades a value. Any cue can also be fired from outside the list, without moving the playhead, by a trigger of its own.
- A sound is shaped on its own cue with "chain" and "eq" ("on the phone", "next room", "under water"); a Fade's "chainTo" moves a setting over time. You cannot hear it: say what you set and that it should be listened to.
- A bus's "kind" (music, voice, effects, ambience, live) is a label. Ducking (settings.audio.duck; settings.audio.ducking, by kind, once the show has it), a bus's stopFade, oneAtATime and noDuck are off unless asked: the default is a plain cue list.
- Settings are part of the show, changed with show.set: buses and the outputs each plays on (routing is a bus's, not a cue's), patches, GO behaviour, MIDI, and each module's options.

Equipment:
- A piece of equipment is a device: its address, its named commands, how to tell it is there. Add and change devices with device.add, device.set and device.remove; the person reviews them like any change. Start from a model in the reference when one fits, and say which; otherwise write its commands from what the person tells you or pastes (a manual page, a list of messages). Write only commands you have been given or that the model has. Never invent an address, a port or a message: ask for it, or use read_monitor to see what has arrived and find_devices to look for props.
- A cue that makes a device do something is a Device cue (its device, one of its commands, its args); prefer it to a Network cue whenever the device has the command. A device and the cues that use it can go in one proposal.
- You may ask a device whether it is there (ask_device) and look for props (find_devices). You can never send a device a command: tell the person to press Try on the Rig page, and what they should see.
- Asked whether they are ready: read rig_status and answer with what is not ready and what to do about each, worst first. Do not list what is fine.

The folder:
- Asked to make cues from the folder: list it, put the sounds in the order their names give, number them in that order, name each cue from its file without numbers, extensions or words like FINAL or v2, group by scene only when the names or a script say so (a group of sounds played one per GO has mode "enter"), leave levels, fades and loops alone, and say in your reply exactly what you guessed and what you left for them (a file called "loop" you did not set to loop).
- Asked to work from the script: read it; a line "@cue 12 Thunder" is a cue to make, numbered and named so, with the line above it quoted in its notes (On “…and the sky answered.”). If the show names no script yet and you worked from one, set settings.rig.script to it.

A prop: make_prop_files writes firmware for a light or a switch on an ESP32 from the app's own kit; you give only its settings, using the defaults for anything not said (say which). You never write firmware, and you never ask for a Wi-Fi password: the person types it into a file. Say once, plainly, that the firmware has not been proven on hardware yet.

Beyond this: you write no code and this app runs none. If what is asked needs it (HTTP, MQTT or serial; equipment that needs a login; a decision with memory; firmware beyond the kit's settings; a program beside the show), say so in one sentence, do the part you can, and offer hand_off, which prepares the show folder for a coding agent. Do not pretend a device or a cue can do it.

Replies: short and plain; the person is usually mid-rehearsal. No preamble, no restating the request, no Markdown (the reply is shown as typed); a few lines beginning "- " are fine. After a proposal: one or two sentences on what it does and what to listen for, not the operations (the review shows those).`;

/** Every sound file in the show folder, with its length where the engine knows it and the cues that use it. */
function mediaList(doc: ShowDoc, { showDir = null, engine = null }: { showDir?: string | null; engine?: EngineView | null } = {}) {
  const used = new Map<string, string[]>();
  show.walk(doc, (c) => { if (c.type === 'audio' && c.file) { if (!used.has(c.file)) used.set(c.file, []); used.get(c.file)!.push(c.number ? `#${c.number}` : c.id); } });
  const files = new Set(used.keys());
  const dir = showDir ? path.join(showDir, 'media') : null;
  const walk = (d: string, rel: string) => { let names: fs.Dirent[] = []; try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const n of names) { if (n.name.startsWith('.')) continue; if (n.isDirectory()) walk(path.join(d, n.name), `${rel}${n.name}/`); else if (/\.(wav|aiff?|mp3|m4a|aac|flac|ogg|opus)$/i.test(n.name)) files.add(`${rel}${n.name}`); } };
  if (dir) walk(dir, 'media/');
  if (!files.size) return 'No sound files: the show folder\'s media/ is empty and no cue names a file.';
  return [...files].sort().map((f) => {
    const d = engine && engine.durations.get(f);
    const missing = showDir && !path.isAbsolute(f) && !fs.existsSync(path.join(showDir, f));
    return `${f}${d ? `  (${formatSeconds(d, 1)})` : ''}${missing ? '  MISSING ON DISK' : ''}${used.has(f) ? `  used by ${used.get(f)!.join(', ')}` : '  not used by any cue'}`;
  }).join('\n');
}

// What is checked before an edit reaches the draft (an operation's shape, a setting's kind) is checked by
// applyOps itself (core/show/ops.ts), so the inspector and the command line are held to the same rules and a
// refusal reads the same wherever it came from. "Applied" always means the thing asked for happened.

const refuse = (message: string): never => { const e = new Error(message); e.name = 'OpError'; throw e; };

/** What check_show reports, one line each: the show's own problems (show.ts) and files that are not on disk. */
function problemLines(doc: ShowDoc, document: ShowDocument) {
  const { byId } = show.index(doc);
  const label = (id: string) => { const c = byId.get(id); return c ? `${c.number ? `#${c.number} ` : ''}${c.name || defaultName(c, byId)} [${id}]` : id; };
  const lines = show.problems(doc).map((p) => `${p.level}: ${label(p.id)}: ${p.why}`);
  if (document.showDir) show.walk(doc, (c) => { if ((c.type === 'audio' || c.type === 'video') && c.file && !fs.existsSync(path.isAbsolute(c.file) ? c.file : path.join(document.showDir!, c.file))) lines.push(`error: ${label(c.id)}: its file is not on disk (${c.file})`); });
  // the equipment: a device that would not be kept as it is (an edit never leaves one so; a show from elsewhere may)
  for (const d of rigDevices.list(doc)) for (const why of rigDevices.trouble(d, doc)) lines.push(`error: device ${d.name} [${d.id}]: ${why}`);
  // the script: a mark with no cue is something to look at, not a broken show
  const script = (doc.settings.rig || {}).script;
  if (script && document.showDir) {
    const sc = scriptFile.read(document.showDir, script);
    if (!sc.ok) lines.push(`warning: the script ${script}: ${sc.why}`);
    else for (const m of scriptFile.compare(doc, sc.marks).missing) lines.push(`warning: the script’s mark @cue ${m.number}${m.name ? ` ${m.name}` : ''} (${script} line ${m.line}) has no cue numbered ${m.number}`);
  }
  return lines;
}
/** The problems `doc` has that `before` did not (a cue's id is in each line, so the same problem reads the same). */
function newProblems(before: ShowDoc, doc: ShowDoc, document: ShowDocument) {
  const had = new Set(problemLines(before, document));
  return problemLines(doc, document).filter((l) => !had.has(l));
}

/**
 * The draft was copied from the show at some moment, and a person can edit the show while the agent works (or,
 * for an agent outside the app, an hour later). A draft built on the old show would, when proposed, show their
 * edit being undone as if the agent had asked for it. So before any tool runs: if the show has moved on, the
 * draft is built again on the show as it is now, by applying the turn's batches to it in order (cues the draft
 * added get new ids; ids used by later batches follow). If they no longer fit, the draft is dropped and the
 * agent is told to look again. Returns what to tell the agent ('' when nothing happened).
 */
function sync(ctx: ToolContext): { note: string; lost?: boolean } {
  const { document } = ctx;
  if (!ctx.draft || !ctx.base || ctx.base === document.doc) return { note: '' };
  if (show.hash(ctx.base) === show.hash(document.doc)) { ctx.base = document.doc; return { note: '' }; }
  const log = ctx.log;
  ctx.draft = null; ctx.base = null; ctx.log = null;
  const lost = (why: string) => ({ lost: true, note: `NOTE: the person changed the show while you were working, and ${why}, so your draft was thrown away (nothing of it had reached the show). Read the show as it is now (read_show), then make your edits again.` });
  if (!log) return lost('your draft cannot be carried over');
  try {
    let doc = document.doc;
    const ids = new Map<string, string>(), done: { ops: Op[]; made: string[] }[] = [];
    for (const step of log) {
      let ops = step.ops;
      if (ids.size) { let text = JSON.stringify(ops); for (const [was, now] of ids) text = text.split(was).join(now); ops = JSON.parse(text); }
      const r = applyOps(doc, ops);
      if (r.made.length !== step.made.length) throw new Error('they add different cues now');
      step.made.forEach((id: string, i: number) => ids.set(id, r.made[i]));
      doc = r.doc; done.push({ ops, made: r.made });
    }
    ctx.draft = doc; ctx.base = document.doc; ctx.log = done;
    return { note: `NOTE: the person changed the show while you were working. Your draft has been rebuilt on the show as it is now, with every edit you made applied again${ids.size ? `. The cues you added have new ids: ${[...ids].map(([was, now]) => `${was} is now ${now}`).join(', ')}` : ''}. Their change is in your draft too; do not undo it.` };
  } catch (err) {
    return lost(`your edits no longer fit it (${(err as Error).message})`);
  }
}

// ── the rig, the monitor and the folder, as text ─────────────────────

const clock = (ms: number) => { const d = new Date(ms); const two = (n: number) => String(n).padStart(2, '0'); return Number.isFinite(d.getTime()) ? `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}` : ''; };
const ago = (ms: number) => (ms < 1500 ? 'just now' : ms < 90000 ? `${Math.round(ms / 1000)} s ago` : ms < 5400000 ? `${Math.round(ms / 60000)} min ago` : `${Math.round(ms / 3600000)} h ago`);
const size = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);

/** An address the assistant may ask: on this computer or a private network, written as numbers (a name could be anywhere). */
function privateAddress(host: unknown) {
  const h = String(host || '').trim().toLowerCase();
  if (h === 'localhost') return '127.0.0.1';
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return null;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return null;
  const ok = a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  return ok ? `${a}.${b}.${c}.${d}` : null;
}

/** The Rig as text: the summary, every row worst first, each device, then this computer. `st` is ctx.rig.status(), or null with no app. */
function rigText(doc: ShowDoc, document: ShowDocument, st: RigStatus | null) {
  const app = !!st;
  const items: RigItem[] = st ? (st.items || []) : rigCheck.items(doc, rigCheck.folderFacts(document.showDir, doc));
  const sum = st && st.summary ? st.summary : rigCheck.summary(items);
  const out: string[] = [];
  if (!items.length) out.push('The Rig has nothing to report on this show yet.');
  else {
    out.push(`The rig: ${sum.text || `${sum.ready} of ${sum.total} ready`}${app && sum.at ? ` (checked ${clock(sum.at)})` : ''}`);
    const rows = items.slice().sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
    for (const i of rows) out.push(`  ${STATE_WORD[i.state] || i.state}: ${i.label}${i.text ? `: ${i.text}` : ''}${i.fix ? ` → ${i.fix}` : ''}${i.needed === false ? ' (the show goes on without it)' : ''}`);
  }
  const devs = rigDevices.list(doc);
  if (devs.length) {
    out.push('', 'Devices:');
    const live = (st && st.devices) || {};
    for (const d of devs) {
      const l = live[d.id];
      if (!l) { out.push(`  ${d.id} = ${d.name}: ${app ? 'no state yet' : 'whether it is answering needs the app'}`); continue; }
      const reports = (l.reports || []).map((r) => `${r.label} ${r.value}${r.unit ? ` ${r.unit}` : ''}${r.warn ? ' (LOW: look at it)' : ''}`);
      out.push(`  ${d.id} = ${d.name}: ${STATE_WORD[l.state] || l.state}${l.text ? `, ${l.text}` : ''}${l.heardAt ? `; last heard ${ago(Number.isFinite(l.ageMs) ? l.ageMs! : Date.now() - l.heardAt)}` : (d.alive && d.alive.how !== 'none' ? '; never heard' : '')}${reports.length ? `; ${reports.join(', ')}` : ''}${l.lastIn ? `; it last said: ${l.lastIn}` : ''}`);
    }
  }
  if (st && st.found && st.found.length) { out.push('', 'The last Look for props found:'); for (const f of st.found) out.push(`  ${foundLine(f)}`); }
  const c = st && st.computer;
  if (c) {
    out.push('', 'This computer:');
    const a = c.audio || {};
    out.push(`  Sound output: ${a.device || 'the system default'}${a.outputs ? ` (${a.outputs} output${a.outputs === 1 ? '' : 's'})` : ''}${(a.devices || []).length ? `. Others: ${a.devices!.join('; ')}` : ''}`);
    out.push(`  Displays: ${(c.displays || []).join('; ') || 'none reported'}`);
    const m = c.midi || {};
    out.push(`  MIDI in: ${(m.inputs || []).join('; ') || 'none'} · MIDI out: ${(m.outputs || []).join('; ') || 'none'}`);
    out.push(`  Networks: ${(c.interfaces || []).map((n) => `${n.name} ${n.address}`).join('; ') || 'none'}`);
  } else if (!app) out.push('', 'This is the show folder alone, with no app running: whether each device is answering, the sound output, the displays and the MIDI ports need the app.');
  return out.join('\n');
}
const foundLine = (f: FoundProp) => `${f.name} (${f.kind || 'a prop'}${f.fw ? `, firmware ${f.fw}` : ''}) at ${f.host}:${f.port}: ${f.known ? (f.moved ? `the show’s device ${f.known}, which the show has at another address (correct it: device.set "${f.known}" host "${f.host}")` : `already the show’s device ${f.known}`) : 'not a device of the show yet'}`;

/** The monitor as text, oldest first, and who else is sending. */
function monitorText(doc: ShowDoc, rig: RigService, { last = 40, from = '' }: { last?: number; from?: string | number } = {}) {
  const n = Math.max(1, Math.min(200, Math.round(Number(last)) || 40));
  const want = String(from || '').trim().toLowerCase();
  // (asked for more than is wanted when filtering, so that a quiet device's last words are still found)
  let entries = rig.monitor(want ? 400 : n) || [];
  if (want) entries = entries.filter((e) => String(e.patch || '').toLowerCase() === want || String(e.who || '').toLowerCase().includes(want) || (e.from && String(e.from.address || '').toLowerCase() === want));
  entries = entries.slice(-n);
  const out: string[] = [];
  if (!entries.length) out.push(want ? `Nothing to or from ${from} in the monitor.` : 'The monitor is empty: nothing has been sent or heard since the app started (or since it was cleared).');
  for (const e of entries) {
    const why = e.dir === 'out' ? [e.label, e.ok === false ? `NOT SENT: ${e.why || 'it failed'}` : ''].filter(Boolean).join('; ') : [e.learned ? 'learned' : '', e.unused ? 'nothing here acted on it' : ''].filter(Boolean).join('; ');
    out.push(`${clock(e.at)}  ${e.dir === 'out' ? '→' : '←'}  ${e.who || '(nobody)'}  ${e.text}${why ? `  (${why})` : ''}`);
  }
  let unknown: Sender[] = []; try { unknown = rig.senders() || []; } catch { unknown = []; }
  if (unknown.length) {
    out.push('', 'Unknown senders (not one of the show’s devices or patches):');
    for (const u of unknown.slice(0, 20)) for (const m of (u.messages || []).slice(0, 4)) out.push(`  ${u.address}:${u.port} sent ${m.address} ${m.count} time${m.count === 1 ? '' : 's'}${m.every ? `, about every ${Number(m.every).toFixed(1)} s` : ''}`);
  }
  return out.join('\n');
}

/**
 * Run one tool call. `ctx` is the turn's state: { document, engine, draft } — `draft` is the working copy this
 * turn's edits have made (null until the first edit), and this function replaces it (with `base`, the show the
 * draft was copied from, and `log`, the batches that made it: see sync). Returns the tool_result content (a
 * string), whether it is an error, and `proposal` (its id) when one was staged.
 *
 * The turn may also hold `rig` (the host's service: absent with no app), `files` (a Map of path → text: the files
 * staged for the show folder, carried by the proposal), `asks` (how many "are you there?" it has sent) and `found`
 * (what the last find_devices heard). ask_device and find_devices wait for an answer and so return a PROMISE of
 * the result; everything else answers at once. Every caller awaits.
 */
const filesOf = (ctx: ToolContext) => { if (!(ctx.files instanceof Map)) ctx.files = new Map(ctx.files || []); return [...ctx.files].map(([p, text]) => ({ path: p, text })); };

/** The tools that answer at once (the rest wait for a device or the window, and may return a promise). */
export type AtOnce = 'read_show' | 'read_reference' | 'find_cues' | 'list_media' | 'list_folder' | 'read_file' | 'edit_show' | 'check_show' | 'simulate' | 'rig_status' | 'read_monitor' | 'make_prop_files' | 'hand_off' | 'propose_changes';
function execute(name: AtOnce, input: ToolInput, ctx: ToolContext): ToolResult;
function execute(name: string, input: ToolInput, ctx: ToolContext): ToolResult | Promise<ToolResult>;
function execute(name: string, input: ToolInput, ctx: ToolContext): ToolResult | Promise<ToolResult> {
  const { document, engine = null } = ctx;
  const current = () => ctx.draft || document.doc;
  let note = '';
  const answer = (r: ToolResult): ToolResult => (note ? { ...r, content: `${note}\n\n${r.content}` } : r);
  try {
    if (input && input.__invalid_json !== undefined) return { content: 'The arguments of that tool call were not valid JSON. Call it again with a JSON object.', is_error: true };
    input = input || {};
    const synced = sync(ctx);
    note = synced.note;
    const find = (want: unknown): Cue | null => { const s = String(want).trim(); return s.startsWith('#') ? show.findByNumber(current(), s.slice(1)) : (show.index(current()).byId.get(s) || show.findByNumber(current(), s)); };
    const edit = (ops: Op[]) => {
      const before = current();
      if (!Array.isArray(ops)) refuse('"ops" is a list of operations');
      const r = applyOps(before, ops);
      if (!ctx.draft) { ctx.base = document.doc; ctx.log = []; }
      if (ctx.log) ctx.log.push({ ops: JSON.parse(JSON.stringify(ops)), made: r.made });
      ctx.draft = r.doc;
      const changes = diffShows(before, r.doc);
      const n = summary(changes);
      const { byId } = show.index(r.doc);
      const made = r.made.map((id: string) => { const c = byId.get(id); return c ? cueHead(c, byId) : null; }).filter(Boolean);
      const lists = changes.filter((c) => c.kind.startsWith('list-')).length;
      const probs = newProblems(before, r.doc, document);
      const dv = r.devices || { added: [], changed: [], removed: [] };
      const devLine = [dv.added.length && `added ${dv.added.join(', ')}`, dv.changed.length && `changed ${dv.changed.join(', ')}`, dv.removed.length && `removed ${dv.removed.join(', ')}`].filter(Boolean).join('; ');
      const devText = devLine ? `\nDevices: ${devLine}.${dv.added.length ? ` (${dv.added.map((id: string) => { const d = rigDevices.find(r.doc, id); return d ? `${id}: ${rigDevices.describe(d)}; commands ${(d.commands || []).map((c) => c.id).join(', ') || 'none'}` : id; }).join(' · ')})` : ''}` : '';
      return (n.total ? `Applied to the draft: ${n.added} added, ${n.changed} changed, ${n.removed} removed, ${n.moved} moved, ${n.settings} settings${lists ? `, ${lists} lists` : ''}.` : 'Applied, but it changed nothing: the draft already was as these operations leave it.')
        + (made.length ? `\nNew cues:\n  ${made.slice(0, 60).join('\n  ')}${made.length > 60 ? `\n  … and ${made.length - 60} more` : ''}` : '')
        + devText
        + (probs.length ? `\nThis leaves ${probs.length} new problem${probs.length === 1 ? '' : 's'} in the draft (fix ${probs.length === 1 ? 'it' : 'them'}, unless it is what was asked for):\n  ${probs.slice(0, 20).join('\n  ')}` : '');
    };
    switch (name) {
      case 'read_show': {
        if (input.device) {
          const want = String(input.device).trim().toLowerCase();
          const d = rigDevices.list(current()).find((x) => x.id === want || String(x.name).toLowerCase() === want);
          if (!d) return answer({ content: `No device ${input.device}. The show has: ${rigDevices.list(current()).map((x) => `${x.id} (${x.name})`).join(', ') || 'none'}.`, is_error: true });
          return answer({ content: JSON.stringify(d, null, 1) });
        }
        if (input.cue) {
          const cue = find(input.cue);
          if (!cue) return answer({ content: `No cue ${input.cue}.`, is_error: true });
          const text = JSON.stringify(cue, null, 1);
          return answer({ content: text.length > 30000 ? `${text.slice(0, 30000)}\n… (cut: this cue holds ${text.length} characters. Read one of its children instead, or read_show {"from": …} for its outline.)` : text });
        }
        if (input.from) {
          const cue = find(input.from);
          if (!cue) return answer({ content: `No cue ${input.from}.`, is_error: true });
          return answer({ content: outlineFrom(current(), cue, Math.max(1, Math.min(200, Number(input.count) || 40)), engine) });
        }
        return answer({ content: outline(current(), { engine: ctx.draft ? null : engine, rig: ctx.rig || null, showDir: document.showDir }) });
      }
      case 'find_cues': {
        if (input.type && !isType(input.type)) return answer({ content: `There is no cue type “${input.type}”. The types: ${TYPE_ORDER.join(', ')}.`, is_error: true });
        const words = String(input.text || '').toLowerCase().split(/\s+/).filter(Boolean);
        const hits: string[] = [];
        const { byId } = show.index(current());
        show.walk(current(), (c, parent, list) => {
          if (input.type && c.type !== input.type) return;
          // everything written on the cue, by the table: a field added there is searchable here
          const hay = [TYPES[c.type].label, defaultName(c, byId), ...fieldsOf(c.type).filter((f) => TEXT_KINDS.has(f.kind)).map((f) => c[f.key as keyof Cue])].filter(Boolean).join(' ').toLowerCase();
          if (!words.every((w) => hay.includes(w))) return;
          const bits = cueBits(c, byId);
          hits.push(`${cueHead(c, byId)}${bits ? ' · ' + bits : ''}  — in ${parent ? `group ${cueRef(parent)}` : `list "${list.name}"`}`);
        });
        return answer({ content: hits.length ? `${hits.length} cue${hits.length === 1 ? '' : 's'}:\n${hits.slice(0, 80).join('\n')}${hits.length > 80 ? `\n… and ${hits.length - 80} more: narrow the search (add a word, or a type).` : ''}` : 'No cues match.' });
      }
      case 'read_reference': { const r = lookup(input.about); return answer({ content: r.text, ...(r.ok ? {} : { is_error: true }) }); }
      case 'list_media': return answer({ content: mediaList(current(), { showDir: document.showDir, engine }) });
      case 'list_folder': {
        if (!document.showDir) return answer({ content: `${folder.NO_FOLDER} (Its sounds are the files its cues name: list_media.)` });
        const under = String(input.path || '').trim().replace(/^\.?\/+|\/+$/g, '');
        const list = folder.listing(document.showDir, current(), { durations: engine ? Object.fromEntries(engine.durations) : {}, under, depth: under ? 1 : 2 });
        if (!list.length) return answer({ content: under ? `Nothing in ${under}/ (or there is no such folder in the show folder).` : 'The show folder holds nothing but the show itself.' });
        const lines = list.slice(0, 300).map((e) => `${e.path}  ${e.kind}  ${size(e.bytes)}${e.secs ? `  ${formatSeconds(e.secs, 1)}` : ''}${e.kind === 'sound' || e.kind === 'video' || e.kind === 'midi' || e.usedBy.length ? (e.usedBy.length ? `  used by ${e.usedBy.join(', ')}` : '  not used by any cue') : ''}${e.path === (current().settings.rig || {}).script ? '  (the show’s script)' : ''}`);
        const n = folder.counts(list);
        return answer({ content: `${lines.join('\n')}${list.length > 300 ? `\n… and ${list.length - 300} more files: list one sub-folder ({"path": …}).` : ''}\n\n${list.length} file${list.length === 1 ? '' : 's'}: ${n.sounds} sound${n.sounds === 1 ? '' : 's'}, ${n.videos} video${n.videos === 1 ? '' : 's'}, ${n.texts} text; ${n.unused} sound or video file${n.unused === 1 ? '' : 's'} no cue uses.` });
      }
      case 'read_file': {
        const r = folder.readText(document.showDir, input.path, { from: input.from as number | undefined, lines: input.lines });
        if (!r.ok) return answer({ content: r.why, is_error: true });
        if (!r.to) return answer({ content: `${input.path} has ${r.total} line${r.total === 1 ? '' : 's'}: there is nothing from line ${input.from}.` });
        // in the show's script, each mark is noted beside its line: what it asks for, and whether a cue has that number
        const rel = String(input.path).split('\\').join('/').replace(/^\.\//, '');
        const isScript = rel === (current().settings.rig || {}).script;
        const sc = scriptFile.read(document.showDir, rel);
        const marks = new Map((sc.ok ? sc.marks : []).map((m) => [m.line, m]));
        const missing = new Set(sc.ok ? scriptFile.compare(current(), sc.marks).missing.map((m) => m.line) : []);
        const text = r.text.split('\n').map((l, i) => { const at = r.from + i; const m = marks.get(at); return `${String(at).padStart(4)}  ${l}${m ? `      ← mark: cue ${m.number}${m.name ? ` “${m.name}”` : ''}${m.quote ? `, called on “${m.quote.length > 80 ? m.quote.slice(0, 80) + '…' : m.quote}”` : ''}${missing.has(at) ? ' (NO CUE has this number)' : ' (has a cue)'}` : ''}`; }).join('\n');
        return answer({ content: `${rel}: lines ${r.from}–${r.to} of ${r.total}${r.to < r.total ? ` (read on with {"from": ${r.to + 1}})` : ''}${marks.size ? ` · ${marks.size} mark${marks.size === 1 ? '' : 's'} in the whole file, ${missing.size} with no cue${isScript ? '' : ' · this file is not yet named as the show’s script (settings.rig.script)'}` : ''}\n${text}` });
      }
      case 'rig_status': return answer({ content: rigText(current(), document, ctx.rig ? ctx.rig.status() : null) });
      case 'read_monitor': {
        if (!ctx.rig) return answer({ content: 'The monitor is the running app’s: this is a show folder alone, so there is nothing to read.' });
        return answer({ content: monitorText(current(), ctx.rig, input) });
      }
      case 'ask_device': case 'find_devices': {
        // the one thing sent to equipment (docs/specs/15-assistant-and-rig.md, 4.1): refused before anything leaves
        if (!ctx.rig) return answer({ content: 'Asking equipment needs the Endless Cues app running: this is a show folder alone.', is_error: true });
        if (ctx.rig.locked()) return answer({ content: 'Show mode: an assistant sends nothing to the equipment.', is_error: true });
        const t = Date.now();
        if (!ctx.asks || t - ctx.asks.at > ASKS_FORGET_MS) ctx.asks = { n: 0, at: t };
        if (ctx.asks.n >= MAX_ASKS) return answer({ content: `That is ${MAX_ASKS} asks already: no more are sent this turn. Tell the person what you found so far.`, is_error: true });
        let target: AskTarget | undefined, who: string | undefined;
        if (name === 'ask_device') {
          if (input.device) {
            const id = String(input.device).trim();
            const d = rigDevices.find(document.doc, id);
            if (!d) {
              return answer({ content: rigDevices.find(current(), id)
                ? `${id} is only in your draft: the person has not accepted it, so nothing is sent to it. To check an address before proposing, use {"host", "port", "probe"} with its model; or propose it, and it can be asked once they accept.`
                : `No device with the id ${id} in the show. The show has: ${rigDevices.list(document.doc).map((x) => x.id).join(', ') || 'none'}.`, is_error: true });
            }
            if (!(d.alive && d.alive.how === 'ask' && d.alive.send)) return answer({ content: `${d.name} has no “are you there?” message (its alive.how is ${d.alive ? d.alive.how : 'none'}), so it cannot be asked. ${d.alive && d.alive.how === 'heartbeat' ? 'It says so by itself: rig_status has when it was last heard.' : 'The person can press Try on the Rig page and look at it.'}`, is_error: true });
            if (rigDevices.isNetwork(d) && (!d.host || !(Number(d.port) > 0))) return answer({ content: `${d.name} has no address yet, so there is nowhere to ask.`, is_error: true });
            target = id; who = d.name;
          } else {
            const host = privateAddress(input.host);
            if (!input.host || !input.probe) return answer({ content: 'ask_device takes {"device": <id>} or {"host", "port", "probe"}.', is_error: true });
            if (!host) return answer({ content: `${input.host} is not an address on this computer or a private network (10.x, 172.16–31.x, 192.168.x, 169.254.x, 127.x), written as numbers: nothing is sent anywhere else.`, is_error: true });
            const model = devices.DEVICES[String(input.probe)];
            if (!model || !model.test) return answer({ content: `“${input.probe}” is not a model with a test message. Those that have one: ${devices.list().filter((m) => m.test).map((m) => `${m.id} (${m.test})`).join(', ')}. You cannot send a message of your own.`, is_error: true });
            const port = Number(input.port) || model.port;
            if (!(Number.isInteger(port) && port > 0 && port < 65536)) return answer({ content: 'port is a number, 1 to 65535.', is_error: true });
            target = { host, port, probe: String(input.probe) }; who = `${host}:${port}`;
          }
        }
        if (name === 'find_devices') {
          // (never while a cue runs: a broadcast is not sent into a network that is carrying a show)
          if (engine && engine.running && engine.running.size) return answer({ content: 'A cue is running: props are looked for only when nothing is playing. Ask again when it has stopped.', is_error: true });
          ctx.asks.n++; ctx.asks.at = t;
          return Promise.resolve(ctx.rig.scan()).then((found) => {
            if (found && 'error' in found && found.error) return answer({ content: String(found.error), is_error: true });
            ctx.found = Array.isArray(found) ? found : [];
            return answer({ content: ctx.found.length ? `${ctx.found.length} prop${ctx.found.length === 1 ? '' : 's'} answered:\n${ctx.found.map((f) => `  ${foundLine(f)}`).join('\n')}` : 'Nothing answered. Props must be powered, on this network, and running the kit’s firmware.' });
          }).catch((err: Error) => answer({ content: `Could not look: ${err.message}`, is_error: true }));
        }
        ctx.asks.n++; ctx.asks.at = t;
        return Promise.resolve(ctx.rig.ask(target!)).then((r) => {
          r = r || {};
          if (r.held) return answer({ content: `Held back: ${r.why || 'OSC out is switched off for rehearsal'}. Nothing was sent.` });
          if (r.answered) return answer({ content: `${who} answered in ${Math.max(0, Math.round(r.ms || 0))} ms${r.text ? `: ${r.text}` : '.'}` });
          if (r.ok === false && r.why) return answer({ content: `${who} could not be asked: ${r.why}`, is_error: true });
          return answer({ content: `No answer from ${who} in 1.5 s.${typeof target === 'string' ? '' : ' Nothing there speaks that model’s protocol on that port, or it is off, or on another network.'}` });
        }).catch((err: Error) => answer({ content: `Could not ask: ${err.message}`, is_error: true }));
      }
      case 'make_prop_files': {
        if (!document.showDir) return answer({ content: showFiles.NO_FOLDER, is_error: true });
        const want = String(input.device || '').trim().toLowerCase();
        const d = rigDevices.list(current()).find((x) => x.id === want || String(x.name).toLowerCase() === want);
        if (!d) return answer({ content: `No device ${input.device} in the show or your draft: add it first (device.add with model "ec-prop-light" or "ec-prop-switch"). The show has: ${rigDevices.list(current()).map((x) => x.id).join(', ') || 'none'}.`, is_error: true });
        const { device: _d, ...options } = input;
        const made = kit.files(d, options);
        const o = kit.settle(d, options);
        // (the person's secrets.h, once it is there, is theirs: it is left out here, and files.ts would leave it out too)
        const kept = made.filter((f) => /\/secrets\.h$/.test(f.path) && fs.existsSync(path.join(document.showDir!, ...f.path.split('/'))));
        const staged = made.filter((f) => !kept.includes(f));
        const r = showFiles.check(document.showDir, [...filesOf(ctx).filter((f) => !staged.some((x) => x.path === f.path)), ...staged]);
        if (!r.ok) return answer({ content: `Refused, nothing staged. ${r.why}`, is_error: true });
        for (const f of staged) (ctx.files as Map<string, string>).set(f.path, f.text);
        const board = kit.BOARDS[o.board as keyof typeof kit.BOARDS];
        return answer({ content: `Staged ${staged.length} files for ${d.name} (${o.sketch === 'light' ? `a light: ${o.count} LEDs, ${o.order}, data on GPIO ${o.pin}` : `a switch: a ${o.output} on GPIO ${o.pin}`}; board ${board.label}${o.address ? `; fixed address ${o.address}` : ''}):\n${staged.map((f) => `  ${f.path}`).join('\n')}${kept.length ? `\n(${kept.map((f) => f.path).join(', ')} is already there and is left as it is: it holds their Wi-Fi password.)` : ''}`
          + `\nThey are written into the show folder when the person accepts: call propose_changes now.\nThen the person: types the Wi-Fi name and password into props/${d.id}/secrets.h, opens props/${d.id}/${d.id}.ino in the Arduino IDE, chooses the board “${board.name}”, uploads, and presses Look for props on the Rig page (the steps are in props/${d.id}/README.md).\n${kit.STATUS}` });
      }
      case 'hand_off': {
        if (!document.showDir) return answer({ content: showFiles.NO_FOLDER, is_error: true });
        const made = (require('./guide') as typeof import('./guide')).agentGuide(current(), { showDir: document.showDir, bin: ctx.bin || path.join(__dirname, '../../bin') });
        const r = showFiles.check(document.showDir, [...filesOf(ctx).filter((f) => !made.some((x) => x.path === f.path)), ...made]);
        if (!r.ok) return answer({ content: `Refused, nothing staged. ${r.why}`, is_error: true });
        for (const f of made) (ctx.files as Map<string, string>).set(f.path, f.text);
        return answer({ content: `Staged the guide for a coding agent: AGENTS.md (what this show is, its rules, the tools and command lines, every device, the prop protocol) and CLAUDE.md (which points at it). They are written when the person accepts: call propose_changes now.\nThen tell the person, in a terminal:\n  cd ${JSON.stringify(document.showDir)}\n  claude        (or: codex)\nand to say there what they want. The agent reads AGENTS.md by itself.` });
      }
      case 'show_in_app': {
        // (the window shows the show, not the draft: a cue is found there)
        const r = places.resolve(input.target, { doc: document.doc, cue: input.cue || null });
        if (!r.ok) return answer({ content: r.why, is_error: true });
        const p = r.place;
        if (p.sel === null) return answer({ content: `${p.label} has no button to point at: ${p.words} Say so in words.` });
        if (!ctx.ui) return answer({ content: 'Pointing needs the app’s window, and there is none here: say where it is in words.', is_error: true });
        if (ctx.ui.locked()) return answer({ content: 'Show mode: nothing is pointed at during a show. Say where it is in words.', is_error: true });
        const say = String(input.say || '').trim().slice(0, 80);
        const point = { ...p, say, cue: input.cue || null };
        return Promise.resolve(ctx.ui.point(point)).then((done) => {
          done = done || {};
          if (!done.ok) return answer({ content: `Could not show ${p.label}: ${done.why || 'the window did not answer'}. Say where it is in words.`, is_error: true });
          return { ...answer({ content: `Shown: ${p.label}${done.instead ? ` (${done.instead})` : ''}, ringed for a few seconds${say ? ` with “${say}”` : ''}. The person can show it again from your reply.` }), point: { target: p.target, say, cue: point.cue } };
        }).catch((err: Error) => answer({ content: `Could not show it: ${err.message}`, is_error: true }));
      }
      case 'edit_show': {
        if (!Array.isArray(input.ops) || !input.ops.length) return answer({ content: 'ops: a non-empty list of operations is required.', is_error: true });
        return answer({ content: edit(input.ops) });
      }
      case 'check_show': {
        const lines = problemLines(current(), document);
        return answer({ content: lines.length ? lines.join('\n') : 'Nothing wrong: every target, file, patch and number checks out.' });
      }
      case 'simulate': {
        let from: string | null = null;
        if (input.from != null && String(input.from).trim() !== '') {
          const cue = find(input.from);
          if (!cue) return answer({ content: `No cue ${input.from}.`, is_error: true });
          const { byId, parentOf } = show.index(current());
          let top = cue;
          while (parentOf.get(top.id)) top = byId.get(parentOf.get(top.id)!)!;
          if (top !== cue) return answer({ content: `${cueRef(cue)} is inside the group ${cueRef(top)}. A GO fires a top-level cue (a group fires its children), so simulate from "${cueRef(top)}".`, is_error: true });
          from = cue.id;
        }
        const durations = engine ? Object.fromEntries(engine.durations) : {};
        const r = dryRun.simulate(current(), { from, gos: Math.max(1, Math.min(20, Number(input.gos) || 1)), gap: Number.isFinite(Number(input.gap)) && input.gap != null ? Number(input.gap) : null, durations });
        return answer({ content: dryRun.describe(r), ...(r.error ? { is_error: true } : {}) });
      }
      case 'propose_changes': {
        // a draft that was just thrown away must not be proposed as its last batch alone
        if (synced.lost) return { content: `${note} Nothing was handed over.`, is_error: true };
        if (Array.isArray(input.ops) && input.ops.length) edit(input.ops);
        const files = filesOf(ctx);
        if (!ctx.draft && !files.length) return answer({ content: 'There is nothing to propose: the draft has no edits. Use edit_show, or pass ops here.', is_error: true });
        // (looked at before staging: staging replaces whatever is waiting for review)
        const draft = ctx.draft || document.doc;
        if (!files.length && !diffShows(document.doc, draft).length) return answer({ content: 'The draft is the same as the show: nothing to propose.', is_error: true });
        const probs = newProblems(document.doc, draft, document);
        let p: ReturnType<ShowDocument['proposeDocument']>;
        // (a file that may not be written is said as a refusal, and nothing is staged)
        try { p = document.proposeDocument(draft, { summary: String(input.summary || '').trim().slice(0, 200), author: 'assistant', files: files.length ? files : null }); } catch (err) { return answer({ content: `Refused, nothing handed over. ${(err as Error).message}`, is_error: true }); }
        const lists = p.changes.filter((c) => c.kind.startsWith('list-')).length;
        const devs = p.changes.filter((c): c is Extract<Change, { kind: `device-${string}` }> => c.kind.startsWith('device-'));
        const carried = p.files || [];
        return answer({ content: `Handed over for review as ${p.id}: ${p.counts.added} added, ${p.counts.changed} changed, ${p.counts.removed} removed, ${p.counts.moved} moved, ${p.counts.settings} settings${lists ? `, ${lists} lists` : ''}${devs.length ? `, ${devs.length} device${devs.length === 1 ? '' : 's'} (${devs.map((c) => `${c.kind.slice(7)} ${c.label || c.id}`).join(', ')})` : ''}${carried.length ? `, ${carried.length} file${carried.length === 1 ? '' : 's'} for the show folder (${carried.map((f) => f.path).join(', ')}), written when they accept` : ''}. The person now sees the difference and decides.`
          + (probs.length ? `\nIt has ${probs.length} problem${probs.length === 1 ? '' : 's'} the show did not have. Tell the person, or fix the draft and propose again:\n  ${probs.slice(0, 20).join('\n  ')}` : ''), proposal: p.id });
      }
      default: return { content: `No tool named ${name}. The tools: ${TOOLS.map((t) => t.name).join(', ')}.`, is_error: true };
    }
  } catch (e) {
    const err = e as Error;
    const hint = /no cue was added with ref/.test(err.message) ? ' ("@ref" names work only inside the batch that added the cue. Use the id edit_show gave back for it, or its "#number".)' : '';
    return answer({ content: err.name === 'OpError' ? `Refused, nothing applied. ${err.message}${hint}` : `Failed: ${err.message}`, is_error: true });
  }
}

/** What a tool call was, in a few words, for the person watching the agent work. */
function describeCall(name: string, input: ToolInput = {}) {
  switch (name) {
    case 'read_show': return input.device ? `reading the device ${input.device}` : input.cue ? `reading cue ${input.cue}` : input.from ? `reading from cue ${input.from}` : 'reading the show';
    case 'list_folder': return input.path ? `looking in ${input.path}/` : 'looking at the folder';
    case 'read_file': return `reading ${input.path || 'a file'}`;
    case 'rig_status': return 'looking at the rig';
    case 'read_monitor': return 'reading the monitor';
    case 'ask_device': return `asking ${input.device || (input.host ? `${input.host}${input.port ? `:${input.port}` : ''}` : 'a device')} if it is there`;
    case 'find_devices': return 'looking for props';
    case 'make_prop_files': return `writing firmware for ${input.device || 'a prop'}`;
    case 'hand_off': return 'preparing the hand-over';
    case 'find_cues': return `looking for ${[input.type, input.text && `“${input.text}”`].filter(Boolean).join(' ') || 'cues'}`;
    case 'read_reference': return `looking up ${input.about || 'the reference'}`;
    case 'show_in_app': return `pointing at ${input.target || 'a place'}`;
    case 'list_media': return 'looking at the sound files';
    case 'edit_show': return `editing (${(input.ops || []).length} operation${(input.ops || []).length === 1 ? '' : 's'})`;
    case 'check_show': return 'checking for problems';
    case 'simulate': return `dry-running ${input.gos || 1} GO${(input.gos || 1) === 1 ? '' : 's'}${input.from ? ` from ${input.from}` : ''}`;
    case 'propose_changes': return 'handing over the change';
    default: return name;
  }
}

export { TOOLS, SYSTEM, reference, fullReference, lookup, outline, execute, describeCall, mediaList, privateAddress, quickListing, LONG_SHOW, MAX_ASKS, OP_KEYS };
