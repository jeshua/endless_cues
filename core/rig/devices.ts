/**
 * Devices: the equipment a show talks to, as part of the show.
 *
 * A device is its address, its named commands (messages with typed holes in them), one way of telling
 * whether it is there, and what to read out of what it says about itself. Devices live in the show file
 * (`settings.rig.devices`, docs/specs/15-assistant-and-rig.md) and change only through the three device
 * operations in core/show/ops.ts. Nothing in a device is code: a show from a stranger stays safe to open.
 *
 * The tables below are to a device what core/show/cue-types.ts is to a cue: validation here, the device
 * editor in the app and the assistant's reference all read them. Add a field here, not in four places.
 *
 *   clean(raw)                         the reading side: forgiving. { device, warnings }
 *   trouble(device, doc?)              the writing side: strict. Sentences; none means it may be kept
 *   compose(device, commandId, args)   the message a command makes: { ok, message } or { ok: false, why }
 *   fromModel(modelId, over)           a new device started from a description in core/net/devices.ts
 *   patchesOf(doc)                     the network devices as the hub wants them (a device is also a patch to it)
 *   line(device)                       one line for the assistant's outline
 *   idFrom(name, taken)                an id made from a name
 *
 * Plain data in, plain data out: no disk, no network, no Electron.
 */
import * as osc from '../net/osc';
import * as netRaw from '../net/raw';
import * as midi from '../net/midi';
import type { Cue, Device, DeviceCommand, Destination } from '../show/types';

/** Data not yet checked: a device as a show file, an edit or the assistant gives it. */
type Raw = Record<string, any>;

/** One field of the tables below: what the editor draws and `clean` reads. */
export interface DeviceField {
  key: string; kind: string; label: string; required?: boolean; help?: string; options?: string[]; labels?: Record<string, string>;
  default?: unknown; min?: number; max?: number; whole?: boolean; network?: boolean; mono?: boolean; advanced?: boolean; when?: string;
}
/** A network device as the hub wants it: a patch, marked `isDevice`. */
export interface DevicePatch {
  id: string; name: string; host: string; port: number; protocol: 'udp' | 'tcp'; framing: 'slip' | 'length';
  listenPort?: number; iface?: string; destinations?: Destination[];
  format: Device['via']; resend: number; alive: Device['alive']; isDevice: true;
}

const ID = /^[a-z][a-z0-9_]{0,31}$/;
const KINDS = ['desk', 'prop', 'media', 'sound', 'computer', 'instrument', 'other'];
const VIAS = ['osc', 'text', 'hex', 'midi'];
const MAX_COMMANDS = 64, MAX_REPORTS = 12, MAX_RESEND = 5;
const RESEND_GAP_MS = 40;

/** A device's fields. `network: true`: only a device spoken to over the network has it (not a MIDI one). */
const FIELDS: DeviceField[] = [
  { key: 'id', kind: 'id', label: 'Id', required: true, help: 'Cues name it by this; it never changes. a–z, 0–9 and _, from a letter; unique. Made from the name if left out.' },
  { key: 'name', kind: 'text', label: 'Name', required: true, help: 'What the operator calls it.' },
  { key: 'kind', kind: 'enum', label: 'Kind', options: KINDS, default: 'other', help: 'A label only.' },
  { key: 'model', kind: 'text', label: 'Model', help: 'The model it was made from (see MODELS); its commands were copied then.' },
  { key: 'via', kind: 'enum', label: 'Spoken to by', options: VIAS, default: 'osc', labels: { osc: 'OSC', text: 'Plain text', hex: 'Bytes (hex)', midi: 'MIDI' },
    help: 'osc, text, hex: over the network. midi: the show’s MIDI output, no address.' },
  { key: 'host', kind: 'text', label: 'Address', network: true, mono: true, help: 'As 10.0.0.42. Nothing is sent until it has one.' },
  { key: 'port', kind: 'port', label: 'Port', network: true, help: '1 to 65535.' },
  { key: 'protocol', kind: 'enum', label: 'Protocol', options: ['udp', 'tcp'], default: 'udp', network: true },
  { key: 'framing', kind: 'enum', label: 'TCP framing', options: ['slip', 'length'], default: 'slip', network: true, advanced: true, help: 'slip: OSC 1.1, most equipment. length: OSC 1.0.' },
  { key: 'listenPort', kind: 'port', label: 'Answers on port', network: true, advanced: true, help: 'A fixed port it answers to, as an Eos’s 8001. Empty: the sender.' },
  { key: 'iface', kind: 'text', label: 'Leaves by', network: true, advanced: true, help: 'The network interface, as en0. Empty: the system chooses.' },
  { key: 'destinations', kind: 'destinations', label: 'Also sent to', network: true, advanced: true, help: 'More places every message goes: [{ host, port }].' },
  { key: 'commands', kind: 'commands', label: 'Commands', help: `See COMMAND FIELDS. Set whole; at most ${MAX_COMMANDS}.` },
  { key: 'test', kind: 'command', label: 'Safe to try', help: 'The id of a command safe to send any time, as Identify.' },
  { key: 'alive', kind: 'alive', label: 'Is it there', help: 'See ALIVE FIELDS. Set whole.' },
  { key: 'reports', kind: 'reports', label: 'What it reports', advanced: true, help: `Read out of what it sends: see REPORT FIELDS. Set whole; at most ${MAX_REPORTS}.` },
  { key: 'resend', kind: 'number', label: 'Send each command again', default: 0, min: 0, max: MAX_RESEND, whole: true, advanced: true,
    help: `Extra sends, ${RESEND_GAP_MS} ms apart, with one id (#a41f07) it acts on once. 0: once, no id.` },
  { key: 'needed', kind: 'bool', label: 'The show needs it', default: true, help: 'Off: its being away is to look at, never a problem.' },
  { key: 'notes', kind: 'longtext', label: 'Notes', help: 'Where it is, what powers it.' },
];

const COMMAND_FIELDS: DeviceField[] = [
  { key: 'id', kind: 'id', label: 'Id', required: true, help: 'Device cues name it by this; unique in the device.' },
  { key: 'label', kind: 'text', label: 'Name', required: true, help: 'What the operator reads: “Fire cue”.' },
  { key: 'template', kind: 'text', label: 'Message', required: true, mono: true,
    help: '{key} where a value goes: /eos/cue/{list}/{cue}/fire. Values go in as written: quote them if needed.' },
  { key: 'params', kind: 'params', label: 'Parameters', help: 'One for each {key} in the message: see PARAM FIELDS.' },
  { key: 'fade', kind: 'text', label: 'Fades', help: 'The number parameter a Device cue may fade, as a level.' },
  { key: 'notes', kind: 'text', label: 'Notes' },
];

const PARAM_FIELDS: DeviceField[] = [
  { key: 'key', kind: 'text', label: 'Key', required: true, help: 'The word between the braces in the message.' },
  { key: 'label', kind: 'text', label: 'Name' },
  { key: 'kind', kind: 'enum', label: 'Kind', options: ['number', 'text', 'enum'], default: 'text' },
  { key: 'default', kind: 'any', label: 'Default', help: 'Sent when a cue gives none.' },
  { key: 'min', kind: 'number', label: 'Least', help: 'A number: refused below this.' },
  { key: 'max', kind: 'number', label: 'Most', help: 'A number: refused above this.' },
  { key: 'whole', kind: 'bool', label: 'Whole numbers', help: 'A number: rounded to a whole one.' },
  { key: 'options', kind: 'list', label: 'Options', help: 'An enum: the values it may take.' },
  { key: 'help', kind: 'text', label: 'Help' },
];

const ALIVE_FIELDS: DeviceField[] = [
  { key: 'how', kind: 'enum', label: 'Is it there', options: ['none', 'ask', 'heartbeat'], default: 'none', labels: { none: 'It cannot be asked', ask: 'Ask it', heartbeat: 'It says so by itself' },
    help: 'ask: asked every few seconds. heartbeat: listened for; opens the input port. none: cannot be told.' },
  { key: 'send', kind: 'text', label: 'Ask with', mono: true, when: 'ask', help: 'The “are you there?” message, as /eos/ping.' },
  { key: 'reply', kind: 'text', label: 'It answers', mono: true, when: 'ask', help: 'Its answer’s OSC pattern, as /eos/out/*. Empty: anything.' },
  { key: 'every', kind: 'number', label: 'Every (s)', default: 2, min: 1, max: 30, when: 'ask', help: '“Not answering” after three with no answer.' },
  { key: 'hears', kind: 'text', label: 'It sends', mono: true, when: 'heartbeat', help: 'Its heartbeat’s OSC pattern. Empty: anything.' },
  { key: 'within', kind: 'number', label: 'Within (s)', default: 5, min: 1, max: 600, when: 'heartbeat', help: 'There while something arrived this recently.' },
];

const REPORT_FIELDS: DeviceField[] = [
  { key: 'key', kind: 'text', label: 'Key', required: true },
  { key: 'label', kind: 'text', label: 'Name', required: true, help: 'What the operator reads: “Battery”.' },
  { key: 'from', kind: 'text', label: 'In message', required: true, mono: true, help: 'The OSC pattern it is read from, as /ec/here.' },
  { key: 'arg', kind: 'number', label: 'Argument', default: 0, min: 0, max: 63, whole: true, help: 'Counted from 0.' },
  { key: 'unit', kind: 'text', label: 'Unit', help: 'dBm, %, °C.' },
  { key: 'warnBelow', kind: 'number', label: 'Warn below', help: 'The row is “to look at” below this.' },
  { key: 'warnAbove', kind: 'number', label: 'Warn above' },
  { key: 'none', kind: 'any', label: 'Means “not known”', help: 'Sent when it cannot tell, as -1: not shown, never a warning.' },
];

const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const viaOf = (d: { via?: unknown } | null | undefined): Device['via'] => (VIAS.includes((d && d.via) as string) ? (d!.via as Device['via']) : 'osc');
const isNetwork = (d: { via?: unknown } | null | undefined) => viaOf(d) !== 'midi';
const holesOf = (template: unknown) => [...String(template || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const portOk = (v: unknown) => Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 65536 && typeof v !== 'boolean' && v !== '';

/** An id made from a name ("Lantern A" → lantern_a), not one of `taken` (lantern_a_2). */
function idFrom(name: unknown, taken: Iterable<string> | Set<string> = []): string {
  const has = taken instanceof Set ? taken : new Set(taken);
  let base = String(name || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!base) base = 'device';
  if (!/^[a-z]/.test(base)) base = `d_${base}`;
  base = base.slice(0, 28).replace(/_$/, '');
  let id = base;
  for (let k = 2; has.has(id); k++) id = `${base}_${k}`;
  return id;
}

// ── reading: forgiving ────────────────────────────────────────────────

function cleanParam(p: unknown): Raw | null {
  if (!isObj(p) || !/^\w+$/.test(String(p.key || ''))) return null;
  const out: Raw = { ...p, key: String(p.key), label: String(p.label || p.key), kind: ['number', 'text', 'enum'].includes(p.kind) ? p.kind : 'text' };
  for (const k of ['min', 'max']) { if (out[k] === undefined) continue; if (Number.isFinite(Number(out[k])) && out[k] !== '' && out[k] !== null) out[k] = Number(out[k]); else delete out[k]; }
  if (out.whole !== undefined) { if (out.whole) out.whole = true; else delete out.whole; }
  if (out.kind === 'enum') out.options = (Array.isArray(p.options) ? p.options : []).map(String);
  else delete out.options;
  if (out.default === undefined || out.default === null) delete out.default;
  return out;
}
function cleanCommand(c: unknown): Raw | null {
  if (!isObj(c) || !ID.test(String(c.id || '')) || typeof c.template !== 'string' || !c.template.trim()) return null;
  const out: Raw = { ...c, id: String(c.id), label: String(c.label || c.id), template: c.template, params: (Array.isArray(c.params) ? c.params : []).map(cleanParam).filter(Boolean) as Raw[] };
  if (out.fade !== undefined && !out.params.some((p: Raw) => p.key === out.fade && p.kind === 'number')) delete out.fade;
  if (out.notes !== undefined) { if (out.notes) out.notes = String(out.notes); else delete out.notes; }
  return out;
}
function cleanAlive(a: unknown): Device['alive'] {
  const how = isObj(a) && ['ask', 'heartbeat'].includes(a.how) ? a.how : 'none';
  if (how === 'none') return { how };
  const num = (v: unknown, def: number, lo: number, hi: number) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.max(lo, Math.min(hi, Number(v))) : def);
  if (how === 'ask') return { how, send: String((a as Raw).send || ''), ...((a as Raw).reply ? { reply: String((a as Raw).reply) } : {}), every: num((a as Raw).every, 2, 1, 30) };
  return { how, ...((a as Raw).hears ? { hears: String((a as Raw).hears) } : {}), within: num((a as Raw).within, 5, 1, 600) };
}
function cleanReport(r: unknown): Raw | null {
  if (!isObj(r) || !r.key || !r.from) return null;
  const out: Raw = { ...r, key: String(r.key), label: String(r.label || r.key), from: String(r.from), arg: Number.isInteger(Number(r.arg)) && Number(r.arg) >= 0 ? Number(r.arg) : 0 };
  for (const k of ['warnBelow', 'warnAbove']) { if (out[k] === undefined) continue; if (Number.isFinite(Number(out[k])) && out[k] !== '' && out[k] !== null) out[k] = Number(out[k]); else delete out[k]; }
  if (out.unit !== undefined) { if (out.unit) out.unit = String(out.unit); else delete out.unit; }
  return out;
}

/**
 * A device as this version of the app wants it. Forgiving: what it does not know is kept as it was, and a
 * field that cannot be understood is dropped and said. Every device that comes out has an id, a name, a
 * kind, a `via`, a list of commands (each with its params) and `alive.how`; everything else only if given.
 * `device` is null for something that is not a device at all.
 */
function clean(raw: unknown, { taken = [] as Iterable<string> } = {}): { device: Device | null; warnings: string[] } {
  const warnings: string[] = [];
  if (!isObj(raw)) return { device: null, warnings: ['not a device, dropped'] };
  const d: Raw = { ...raw };
  const who = String(raw.name || raw.id || 'a device');
  const drop = (key: string, why: string) => { warnings.push(`${who}: ${why}, dropped`); delete d[key]; };
  if (!ID.test(String(d.id || ''))) { const id = idFrom(d.name || d.id || 'device', taken); if (d.id !== undefined) warnings.push(`${who}: its id ${JSON.stringify(d.id)} is not one (lower-case letters, digits and _); it is now ${id}`); d.id = id; }
  d.name = String(d.name || d.id);
  if (!KINDS.includes(d.kind)) { if (d.kind !== undefined) warnings.push(`${who}: kind ${JSON.stringify(d.kind)} is not one of ${KINDS.join(', ')}; it is “other”`); d.kind = 'other'; }
  if (!VIAS.includes(d.via)) { if (d.via !== undefined) warnings.push(`${who}: via ${JSON.stringify(d.via)} is not one of ${VIAS.join(', ')}; it is “osc”`); d.via = 'osc'; }
  for (const f of FIELDS) {
    const v = d[f.key];
    if (v === undefined || ['id', 'name', 'kind', 'via'].includes(f.key)) continue;
    if (v === null || v === '') { delete d[f.key]; continue; }
    switch (f.kind) {
      case 'text': case 'longtext': case 'command': d[f.key] = String(v); break;
      case 'port': if (portOk(v)) d[f.key] = Number(v); else drop(f.key, `its ${f.label.toLowerCase()} ${JSON.stringify(v)} is not a port`); break;
      case 'enum': if (!f.options!.includes(v)) drop(f.key, `its ${f.label.toLowerCase()} ${JSON.stringify(v)} is not one of ${f.options!.join(', ')}`); break;
      case 'bool': d[f.key] = v === true || v === 'true' || v === 1; break;
      case 'number': { const n = Number(v); if (!Number.isFinite(n) || typeof v === 'boolean') drop(f.key, `its ${f.label.toLowerCase()} is not a number`); else d[f.key] = Math.max(f.min ?? -Infinity, Math.min(f.max ?? Infinity, f.whole ? Math.round(n) : n)); break; }
      case 'destinations': if (Array.isArray(v)) d[f.key] = v.filter((x) => isObj(x) && x.host).map((x: Raw) => ({ ...x, host: String(x.host), ...(portOk(x.port) ? { port: Number(x.port) } : {}) })); else drop(f.key, 'its further destinations are not a list'); if (d[f.key] && !d[f.key].length) delete d[f.key]; break;
      default: break;
    }
  }
  const commands: Raw[] = [], seen = new Set();
  for (const c of Array.isArray(raw.commands) ? raw.commands.slice(0, MAX_COMMANDS) : []) {
    const k = cleanCommand(c);
    if (!k || seen.has(k.id)) { warnings.push(`${who}: a command that cannot be understood (${JSON.stringify(c && c.id)}), dropped`); continue; }
    seen.add(k.id); commands.push(k);
  }
  d.commands = commands;
  d.alive = cleanAlive(raw.alive);
  if (raw.reports !== undefined) { d.reports = (Array.isArray(raw.reports) ? raw.reports.slice(0, MAX_REPORTS) : []).map(cleanReport).filter(Boolean); if (!d.reports.length) delete d.reports; }
  if (d.test !== undefined && !commands.some((c) => c.id === d.test)) drop('test', `its “safe to try” command ${JSON.stringify(d.test)} is not one of its commands`);
  return { device: d as Device, warnings };
}

// ── composing ─────────────────────────────────────────────────────────

/**
 * The message a command makes. Each {key} in its template becomes that argument's value, or the param's
 * default; a number is checked against `min` and `max` and rounded when `whole`; an enum against its options.
 * With `fade`, the command's `fade` param becomes "#v#" (a Network cue's faded value). `strict: false` is for
 * a patch's device templates (core/net/devices.ts), which do not check a value: what is given is put in as written.
 */
function compose(device: { name?: string; commands?: DeviceCommand[] } | null | undefined, commandId: string | null | undefined, args: unknown = {}, { fade = false, strict = true } = {}): { ok: true; message: string } | { ok: false; why: string } {
  const commands = (device && device.commands) || [];
  const cmd = commands.find((c) => c.id === commandId);
  const name = (device && device.name) || 'the device';
  if (!cmd) return { ok: false, why: `${name} has no command “${commandId ?? ''}” (${commands.length ? `it has: ${commands.map((c) => c.id).join(', ')}` : 'it has no commands yet'})` };
  if (fade && !cmd.fade) return { ok: false, why: `“${cmd.label || cmd.id}” has no value that can fade` };
  let why = '';
  const params = cmd.params || [];
  const message = String(cmd.template).replace(/\{(\w+)\}/g, (_m, key: string) => {
    if (fade && cmd.fade === key) return '#v#';
    const p = params.find((x) => x.key === key);
    const given = isObj(args) ? args[key] : undefined;
    const v = given !== undefined && given !== '' && given !== null ? given : p ? p.default : undefined;
    if (!strict) return String(v === undefined ? '' : v);
    if (!p) { why = why || `the command “${cmd.id}” has {${key}} in its message and no parameter called ${key}`; return ''; }
    if (v === undefined) { why = why || `${key} needs a value`; return ''; }
    if (p.kind === 'number') {
      let n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      if (!Number.isFinite(n)) { why = why || `${key} must be a number`; return ''; }
      if ((p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max)) { why = why || (p.min !== undefined && p.max !== undefined ? `${key} must be between ${p.min} and ${p.max}` : p.min !== undefined ? `${key} must be ${p.min} or more` : `${key} must be ${p.max} or less`); return ''; }
      if (p.whole) n = Math.round(n);
      return String(n);
    }
    if (p.kind === 'enum' && !(p.options || []).map(String).includes(String(v))) { why = why || `${key} must be one of ${(p.options || []).join(', ')}`; return ''; }
    return String(v);
  });
  return why ? { ok: false, why } : { ok: true, message };
}

/** A fading command's number, checked as compose checks it: null when it may be sent, else why not. */
function valueTrouble(command: DeviceCommand | null | undefined, value: unknown): string | null {
  const p = command && (command.params || []).find((x) => x.key === command.fade);
  if (!p) return 'this command has no value that can fade';
  const n = Number(value);
  if (!Number.isFinite(n)) return `${p.key} must be a number`;
  if ((p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max)) return p.min !== undefined && p.max !== undefined ? `${p.key} must be between ${p.min} and ${p.max}` : p.min !== undefined ? `${p.key} must be ${p.min} or more` : `${p.key} must be ${p.max} or less`;
  return null;
}

/** The value each of a command's params takes for these arguments (the given one, else its default), in the command's order. */
function valuesOf(command: DeviceCommand | null | undefined, args: unknown = {}): unknown[] {
  return ((command && command.params) || []).map((p) => { const v = isObj(args) ? args[p.key] : undefined; return v !== undefined && v !== '' && v !== null ? v : p.default; });
}

/** What a Device cue is called when it has no name: "Lantern A ▸ Effect (breathe)". */
function cueName(device: Device | null | undefined, cue: Partial<Cue> = {}): string {
  if (!device) return cue.device ? `${cue.device} ▸ ${cue.command || '…'}` : 'Device';
  const cmd = (device.commands || []).find((c) => c.id === cue.command);
  if (!cmd) return `${device.name} ▸ ${cue.command || '…'}`;
  const values = valuesOf(cmd, cue.args).map((v, i) => (cue.fadeTo !== undefined && cmd.fade === cmd.params[i].key ? `${v} → ${cue.fadeTo}` : v)).filter((v) => v !== undefined && v !== '');
  return `${device.name} ▸ ${cmd.label || cmd.id}${values.length ? ` (${values.join(', ')})` : ''}`;
}

// ── writing: strict ───────────────────────────────────────────────────

/** Whether a message is one, in the way a device is spoken to: null, or why not. */
function messageTrouble(via: string, text: unknown): string | null {
  const s = String(text || '').trim();
  if (!s) return 'is empty';
  try {
    if (via === 'osc') { if (!s.startsWith('/')) return 'is not OSC: an OSC message starts with /'; osc.parseText(s); }
    else if (via === 'hex') netRaw.hex(s);
    else if (via === 'midi') midi.encode(midi.parseText(s));
  } catch (err) { return `cannot be sent: ${(err as Error).message}`; }
  return null;
}

/**
 * What is wrong with a device, as sentences a person (or the assistant) can act on. Strict: this is what an
 * edit is held to. With `doc`, also what is wrong with it in that show (an id shared with a patch or another device).
 */
function trouble(device: unknown, doc: { settings?: { network?: { patches?: { id?: string }[] }; rig?: { devices?: { id?: string }[] } } } | null = null): string[] {
  const out: string[] = [];
  if (!isObj(device)) return ['a device is an object: { "name": …, "host": …, "port": …, "commands": [ … ] }'];
  const d = device, via = viaOf(d);
  const who = typeof d.name === 'string' && d.name.trim() ? d.name : typeof d.id === 'string' && d.id ? d.id : 'the device';
  if (!ID.test(String(d.id ?? ''))) out.push(`a device’s id is lower-case letters, digits and _, starting with a letter, at most 32 (it was given ${JSON.stringify(d.id ?? null)})`);
  if (typeof d.name !== 'string' || !d.name.trim()) out.push('a device needs a name');
  if (d.kind !== undefined && !KINDS.includes(d.kind)) out.push(`${who}: kind is one of ${KINDS.join(', ')} (it was given ${JSON.stringify(d.kind)})`);
  if (d.via !== undefined && !VIAS.includes(d.via)) out.push(`${who}: via is one of ${VIAS.join(', ')} (it was given ${JSON.stringify(d.via)})`);
  if (d.host !== undefined && typeof d.host !== 'string') out.push(`${who}: host is an address, as text (it was given ${JSON.stringify(d.host)})`);
  for (const k of ['port', 'listenPort']) if (d[k] !== undefined && !(typeof d[k] === 'number' && portOk(d[k]))) out.push(`${who}: ${k} is a number, 1–65535 (it was given ${JSON.stringify(d[k])})`);
  if (d.protocol !== undefined && !['udp', 'tcp'].includes(d.protocol)) out.push(`${who}: protocol is udp or tcp (it was given ${JSON.stringify(d.protocol)})`);
  if (d.framing !== undefined && !['slip', 'length'].includes(d.framing)) out.push(`${who}: framing is slip or length (it was given ${JSON.stringify(d.framing)})`);
  if (d.iface !== undefined && typeof d.iface !== 'string') out.push(`${who}: iface is the name of a network interface, as text`);
  if (d.destinations !== undefined && !(Array.isArray(d.destinations) && d.destinations.every((x: unknown) => isObj(x) && typeof x.host === 'string' && x.host && (x.port === undefined || portOk(x.port))))) out.push(`${who}: destinations is a list of { "host": …, "port": … }`);
  if (via === 'midi' && (d.host || d.port)) out.push(`${who}: a MIDI device has no address: it uses the show’s MIDI output (Settings ▸ Integrations ▸ Network)`);
  if (d.resend !== undefined && !(Number.isInteger(d.resend) && d.resend >= 0 && d.resend <= MAX_RESEND)) out.push(`${who}: resend is a whole number from 0 to ${MAX_RESEND} (it was given ${JSON.stringify(d.resend)})`);
  if (d.needed !== undefined && typeof d.needed !== 'boolean') out.push(`${who}: needed is true or false (it was given ${JSON.stringify(d.needed)})`);
  for (const k of ['notes', 'model']) if (d[k] !== undefined && typeof d[k] !== 'string') out.push(`${who}: ${k} is text`);

  const commands = d.commands === undefined ? [] : d.commands;
  if (!Array.isArray(commands)) out.push(`${who}: commands is a list of { "id": …, "label": …, "template": …, "params": [ … ] }`);
  else {
    if (commands.length > MAX_COMMANDS) out.push(`${who}: a device has at most ${MAX_COMMANDS} commands (it was given ${commands.length})`);
    const seen = new Set();
    for (const c of commands) {
      if (!isObj(c)) { out.push(`${who}: a command is an object: { "id": …, "label": …, "template": … }`); continue; }
      const cn = `the command “${c.id ?? ''}”`;
      if (!ID.test(String(c.id ?? ''))) { out.push(`${who}: a command’s id is lower-case letters, digits and _, starting with a letter (it was given ${JSON.stringify(c.id ?? null)})`); continue; }
      if (seen.has(c.id)) out.push(`${who}: two commands have the id ${c.id}`);
      seen.add(c.id);
      if (typeof c.label !== 'string' || !c.label.trim()) out.push(`${who}: ${cn} needs a label (what the operator reads)`);
      if (typeof c.template !== 'string' || !c.template.trim()) { out.push(`${who}: ${cn} needs a template (its message)`); continue; }
      const params = c.params === undefined ? [] : c.params;
      if (!Array.isArray(params) || params.some((p: unknown) => !isObj(p))) { out.push(`${who}: ${cn}: params is a list of { "key": …, "label": …, "kind": "number" | "text" | "enum", "default": … }`); continue; }
      const holes = holesOf(c.template), keys = new Set<string>();
      let bad = false;
      for (const p of params) {
        if (!/^\w+$/.test(String(p.key ?? ''))) { out.push(`${who}: ${cn} has a parameter with no key (a key is one word: letters, digits and _)`); bad = true; continue; }
        if (keys.has(p.key)) { out.push(`${who}: ${cn} has two parameters called ${p.key}`); bad = true; }
        keys.add(p.key);
        if (p.kind !== undefined && !['number', 'text', 'enum'].includes(p.kind)) { out.push(`${who}: ${cn}: the kind of ${p.key} is number, text or enum (it was given ${JSON.stringify(p.kind)})`); bad = true; }
        if (p.kind === 'enum' && !(Array.isArray(p.options) && p.options.length)) { out.push(`${who}: ${cn}: ${p.key} is an enum and needs its options`); bad = true; }
        if (p.kind === 'number') for (const k of ['min', 'max', 'default']) if (p[k] !== undefined && !(typeof p[k] === 'number' && Number.isFinite(p[k]))) { out.push(`${who}: ${cn}: the ${k === 'default' ? 'default' : k} of ${p.key} is a number (it was given ${JSON.stringify(p[k])})`); bad = true; }
        if (!holes.includes(p.key)) { out.push(`${who}: ${cn} has a parameter ${p.key} that its message does not use (put {${p.key}} in the message, or take the parameter out)`); bad = true; }
      }
      for (const h of new Set(holes)) if (!keys.has(h)) { out.push(`${who}: ${cn} has {${h}} in its message and no parameter called ${h}`); bad = true; }
      if (c.fade !== undefined && !params.some((p: Raw) => p.key === c.fade && p.kind === 'number')) { out.push(`${who}: ${cn}: fade names the one numeric parameter that may fade (${JSON.stringify(c.fade)} is not a number parameter of it)`); bad = true; }
      if (bad) continue;
      // the message it makes from its defaults must be one this device can be sent (a parameter with no default is taken as 1)
      const probe = Object.fromEntries(params.filter((p: Raw) => p.default === undefined).map((p: Raw) => [p.key, p.kind === 'enum' ? p.options[0] : p.kind === 'number' ? Math.max(p.min ?? 1, Math.min(p.max ?? 1, 1)) : '1']));
      const r = compose({ name: who, commands: [c as DeviceCommand] }, c.id, probe);
      const mt = r.ok ? messageTrouble(via, r.message) : `cannot be made from its defaults: ${r.why}`;
      if (mt) out.push(`${who}: ${cn}: its message ${via === 'osc' && /starts with \//.test(mt) ? `is not OSC (${JSON.stringify(c.template)}): an OSC message starts with /` : mt}`);
    }
    if (d.test !== undefined && d.test !== '' && !commands.some((c: unknown) => isObj(c) && c.id === d.test)) out.push(`${who}: test is the id of one of its commands, or empty (it was given ${JSON.stringify(d.test)}; it has: ${commands.map((c: Raw) => c && c.id).join(', ') || 'none'})`);
  }

  if (d.alive !== undefined) {
    const a = d.alive;
    if (!isObj(a) || !['ask', 'heartbeat', 'none'].includes(a.how)) out.push(`${who}: alive is { "how": "ask" | "heartbeat" | "none", … }`);
    else if (a.how === 'ask') {
      const mt = messageTrouble(via, a.send);
      if (mt) out.push(`${who}: the message it is asked with (alive.send) ${mt}`);
      if (a.reply !== undefined && a.reply !== '' && !(typeof a.reply === 'string' && a.reply.startsWith('/'))) out.push(`${who}: alive.reply is an OSC address pattern (it starts with /), or left out`);
      if (a.every !== undefined && !(typeof a.every === 'number' && a.every >= 1 && a.every <= 30)) out.push(`${who}: alive.every is a number of seconds, 1 to 30 (it was given ${JSON.stringify(a.every)})`);
      if (via === 'midi') out.push(`${who}: a MIDI device cannot be asked (alive.how is "none" for it)`);
    } else if (a.how === 'heartbeat') {
      if (a.hears !== undefined && a.hears !== '' && !(typeof a.hears === 'string' && a.hears.startsWith('/'))) out.push(`${who}: alive.hears is an OSC address pattern (it starts with /), or left out`);
      if (a.within !== undefined && !(typeof a.within === 'number' && a.within >= 1 && a.within <= 600)) out.push(`${who}: alive.within is a number of seconds, 1 to 600 (it was given ${JSON.stringify(a.within)})`);
      if (via === 'midi') out.push(`${who}: a MIDI device cannot be listened for (alive.how is "none" for it)`);
    }
  }
  if (d.reports !== undefined) {
    if (!Array.isArray(d.reports)) out.push(`${who}: reports is a list of { "key": …, "label": …, "from": "/address", "arg": 0 }`);
    else {
      if (d.reports.length > MAX_REPORTS) out.push(`${who}: a device has at most ${MAX_REPORTS} reports (it was given ${d.reports.length})`);
      const seen = new Set();
      for (const r of d.reports) {
        if (!isObj(r) || typeof r.key !== 'string' || !r.key || typeof r.from !== 'string' || !r.from.startsWith('/')) { out.push(`${who}: a report is { "key": …, "label": …, "from": "/address", "arg": 0 } (from is an OSC address pattern)`); continue; }
        if (seen.has(r.key)) out.push(`${who}: two reports have the key ${r.key}`);
        seen.add(r.key);
        if (r.arg !== undefined && !(Number.isInteger(r.arg) && r.arg >= 0)) out.push(`${who}: the report ${r.key}: arg is which argument, counted from 0 (it was given ${JSON.stringify(r.arg)})`);
        for (const k of ['warnBelow', 'warnAbove']) if (r[k] !== undefined && !(typeof r[k] === 'number' && Number.isFinite(r[k]))) out.push(`${who}: the report ${r.key}: ${k} is a number`);
      }
    }
  }
  if (doc && ID.test(String(d.id ?? ''))) {
    const s = doc.settings || {};
    if ((((s.network || {}).patches) || []).some((p) => p && p.id === d.id)) out.push(`a device and a patch both have the id ${d.id}`);
    if ((((s.rig || {}).devices) || []).filter((x) => x && x.id === d.id).length > 1) out.push(`two devices have the id ${d.id}`);
  }
  return out;
}

// ── models, the hub, the outline ──────────────────────────────────────

/**
 * A new device started from a model (core/net/devices.ts): its commands, how it is asked, what it reports,
 * its kind, port and protocol are copied in, so they can be edited and a model changing later never changes
 * a show. `over` is what the person said (name, host, …) and wins. null: no such model.
 */
function fromModel(modelId: string, over: Record<string, unknown> | null = {}): Raw | null {
  const model = (require('../net/devices') as typeof import('../net/devices')).DEVICES[modelId];
  if (!model) return null;
  const d: Raw = { name: model.label, kind: model.kind || 'other', model: modelId, via: 'osc', port: model.port, protocol: model.protocol || 'udp', commands: clone(model.commands || []) };
  if (model.listenPort) d.listenPort = model.listenPort;
  if (model.tryCommand) d.test = model.tryCommand;
  // a model that answers its test message can be asked with it
  if (model.alive) d.alive = clone(model.alive);
  else if (model.test && model.answers) d.alive = { how: 'ask', send: model.test, every: 2 };
  if (model.reports) d.reports = clone(model.reports);
  if (model.resend) d.resend = model.resend;
  for (const [k, v] of Object.entries(over || {})) if (v !== undefined && v !== null && !(k === 'commands' && Array.isArray(v) && !v.length)) d[k] = v;
  d.model = modelId;
  return d;
}

/** The show's devices (always a list). */
function list(doc: { settings?: { rig?: { devices?: Device[] } } } | null | undefined): Device[] { const l = doc && doc.settings && doc.settings.rig && doc.settings.rig.devices; return Array.isArray(l) ? l : []; }
function find(doc: { settings?: { rig?: { devices?: Device[] } } } | null | undefined, id: string | null | undefined): Device | null { return list(doc).find((d) => d && d.id === id) || null; }

/** The network devices as the hub wants them: a device is also a patch to it (same id, name, address), marked `isDevice`. */
function patchesOf(doc: { settings?: { rig?: { devices?: Device[] } } } | null | undefined): DevicePatch[] {
  return list(doc).filter(isNetwork).map((d): DevicePatch => ({
    id: d.id, name: d.name, host: d.host || '', port: Number(d.port) || 0, protocol: d.protocol || 'udp', framing: d.framing || 'slip',
    ...(d.listenPort ? { listenPort: d.listenPort } : {}), ...(d.iface ? { iface: d.iface } : {}), ...(d.destinations ? { destinations: d.destinations } : {}),
    format: viaOf(d), resend: Number(d.resend) || 0, alive: d.alive || { how: 'none' }, isDevice: true,
  }));
}

/** One line for the assistant's outline: "lantern_a = Lantern A (prop, osc udp 10.0.0.42:53100; commands: look(n), level(level, fades); asked every 2 s)". */
function line(d: Device): string {
  const via = viaOf(d);
  const where = via === 'midi' ? 'midi' : `${via} ${d.protocol || 'udp'} ${d.host && d.port ? `${d.host}:${d.port}` : d.host ? `${d.host} (no port yet)` : 'no address yet'}`;
  const commands = (d.commands || []).map((c) => { const inside = [...(c.params || []).map((p) => p.key), ...(c.fade ? ['fades'] : [])]; return `${c.id}${inside.length ? `(${inside.join(', ')})` : ''}`; });
  const a = d.alive || {};
  const alive = a.how === 'ask' ? `asked every ${a.every || 2} s` : a.how === 'heartbeat' ? `listened for (within ${a.within || 5} s)` : 'cannot be asked';
  return `${d.id} = ${d.name} (${[d.kind || 'other', d.model].filter(Boolean).join(', ')}, ${where}; commands: ${commands.join(', ') || 'none yet'}; ${alive})`;
}

/** A device as one line of a review: "prop · 10.0.0.42:53100 · 4 commands · asked every 2 s". */
function describe(d: Device): string {
  const a = d.alive || {}, n = (d.commands || []).length;
  return [d.kind || 'other', viaOf(d) === 'midi' ? 'MIDI' : d.host && d.port ? `${d.host}:${d.port}` : 'no address yet', `${n} command${n === 1 ? '' : 's'}`,
    a.how === 'ask' ? `asked every ${a.every || 2} s` : a.how === 'heartbeat' ? 'listened for' : null].filter(Boolean).join(' · ');
}

export { FIELDS, COMMAND_FIELDS, PARAM_FIELDS, ALIVE_FIELDS, REPORT_FIELDS, KINDS, VIAS, ID, MAX_COMMANDS, MAX_REPORTS, MAX_RESEND, RESEND_GAP_MS, clean, trouble, compose, valueTrouble, valuesOf, cueName, fromModel, patchesOf, line, describe, idFrom, list, find, viaOf, isNetwork, messageTrouble };
