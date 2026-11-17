// The Rig: everything the show depends on, whether each part is ready, and what to do about the parts that are not
// (docs/specs/15-assistant-and-rig.md, section 5). The rows are the host's (`s.rig.items`, from core/rig/check.ts);
// the devices are the show's (`settings.rig.devices`), drawn and edited from the tables in core/rig/devices.ts, as
// the inspector draws a cue from core/show/cue-types.ts. This file also has the Device cue's part of the inspector.
// Nothing here holds show state: a device changes through `device.add` / `device.set` / `device.remove`, a tick and
// a Try are host commands, and what is kept in this view is only what is selected and what is typed but not yet sent.
import { html, useState, useEffect, useRef, ec, cmd, edit, setCue, cx, keys, nextNumber } from './lib.js';
import { TextBox } from './Inspector.js';
import { Was } from './Sidebar.js';
import type { State, Info, Command, Op, CueIndex, Cue, CueList } from './lib.js';
import type { Pending, PendingField } from './app.js';
import type { Device, DeviceAlive, DeviceCommand, DeviceParam, RigCheck } from '../../core/show/types';
import type { OPTIONS as KIT_OPTIONS } from '../../core/kit/kit';

type Say = (text: string, bad?: boolean) => void;
type RigState = 'ready' | 'look' | 'problem' | 'unknown';
/** A button on a Rig row, as core/rig/check.ts names it: `cmd` is the host command that does it, `cue` the cue it shows. */
interface RigAction { id: string; label: string; cmd?: Command & { ops?: Op[]; label?: string; command?: string }; cue?: string }
/** A row of the Rig page (core/rig/check.ts `items`). */
export interface RigItem { id: string; group?: string; label: string; state: string; text?: string; fix?: string; actions?: RigAction[]; patch?: string; device?: string }
/** One of a device's reports, as it stands now. */
interface ReportNow { key: string; label: string; value?: unknown; unit?: string; warn?: boolean }
/** What the host knows of a device now (the Rig's `devices`): its state, its reports, the last message each way. */
interface DeviceNow { state?: string; text?: string; reports?: ReportNow[]; lastOut?: string; lastIn?: string }
/** A prop that answered the last look (core/rig/scan.ts), and what it is against the show now. */
interface FoundProp { name: string; host: string; port?: number; kind?: string; fw?: string }
/** Something heard on the network that is not a device (core/rig/senders.ts). */
interface Sender { address: string; port?: number; count?: number; messages?: { address?: string; every?: number | null }[] }
/** The Rig's summary line (core/rig/check.ts `summary`). */
interface RigSummary { ready?: number; total?: number; look?: number; problems?: number; unknown?: number; at?: number; text?: string }
/** The Rig part of the host's state, as this page reads it. */
interface RigView { items?: RigItem[]; devices?: Record<string, DeviceNow>; summary?: RigSummary; ticks?: Record<string, boolean>; found?: FoundProp[] | null; scanning?: boolean; senders?: Sender[] }
/** A field of one of core/rig/devices.ts's tables, as the editor reads it. */
interface TableField { key: string; label?: string; help?: string; labels?: Record<string, string> }
/** A button of a row: what it says and what it does. */
interface RowAction { id: string; label: string; run: () => unknown; disabled?: boolean; title?: string }
/** What a parameter's box holds, as typed (a cue's `args` once given). */
type Vals = Record<string, string | number | boolean>;
/** A change not saved yet, as the host lists them (`show.unsaved`). */
type Unsaved = State['show']['unsaved'][number];
/** core/rig/devices.ts's tables, as ec.init() gives them (`info.rig`). */
interface DeviceTables { fields?: TableField[]; commandFields?: TableField[]; aliveFields?: TableField[]; kinds?: string[]; vias?: string[] }
/** A change to a device, a command or a parameter: null takes a setting off. */
type DeviceChange = { [K in keyof Device]?: Device[K] | null };
type CommandChange = { [K in keyof DeviceCommand]?: DeviceCommand[K] | null };
/** A parameter as it is being edited: its default and limits may still be what was typed. */
type ParamChange = Omit<Partial<DeviceParam>, 'default' | 'min' | 'max'> & { default?: unknown; min?: unknown; max?: unknown };
/** One thing the kit's firmware form may set (core/kit/kit.ts `OPTIONS`). */
type KitOption = (typeof KIT_OPTIONS)[number];
/** What a test run lays over the pushed state (`window.ecFixture`): Rig states, the assistant's first-time offer, a proposal. */
export interface Fixture { rig?: Partial<State['rig']>; first?: State['assistant']['first']; proposal?: State['proposal'] }

// ── the four states (3.7). The mark is the only colour on a row, and it is a shape as well as a colour. ──
const MARK: Record<RigState, string> = { ready: '●', look: '◐', problem: '✕', unknown: '○' };
const WORD: Record<RigState, string> = { ready: 'Ready', look: 'To look at', problem: 'A problem', unknown: 'Cannot be told from here' };
const stateOf = (v: unknown): RigState => (MARK[v as RigState] ? v as RigState : 'unknown');
export function Mark({ state, big }: { state: unknown; big?: boolean }) {
  const st = stateOf(state);
  return html`<span class=${cx('rig-mark', `m-${st}`, big && 'big')} title=${WORD[st]} aria-label=${WORD[st]}>${MARK[st]}</span>`;
}

const GROUPS: [key: string, label: string][] = [['show', 'The show'], ['sound', 'Sound'], ['picture', 'Picture'], ['lights', 'Lights'], ['equipment', 'Equipment'], ['connections', 'Connections'], ['held', 'Held back'], ['before', 'Before the show']];
/** A row's group as one of the names above, whether the host gave the short word or the title. */
const groupKey = (g: unknown) => { const t = String(g || '').trim().toLowerCase(); const hit = GROUPS.find(([k, l]) => t === k || t === l.toLowerCase() || t.startsWith(k)); return hit ? hit[0] : t || 'show'; };
const groupLabel = (k: string) => (GROUPS.find((g) => g[0] === k) || [k, k.charAt(0).toUpperCase() + k.slice(1)])[1];

export const devicesOf = (s: State | null | undefined): Device[] => (s && s.doc && s.doc.settings && s.doc.settings.rig && s.doc.settings.rig.devices) || [];
const checksOf = (s: State | null | undefined): RigCheck[] => (s && s.doc && s.doc.settings && s.doc.settings.rig && s.doc.settings.rig.checks) || [];
const holesOf = (template: unknown) => [...String(template || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const given = (v: unknown) => v !== undefined && v !== null && v !== '';
/** The message a command would send for these values (a value left empty is the parameter's default), for showing:
 *  the host composes and checks the real one (core/rig/devices.ts `compose`). */
export function messageOf(command: DeviceCommand | null | undefined, vals: Vals = {}) {
  return String((command && command.template) || '').replace(/\{(\w+)\}/g, (_m, k: string) => { const p: Partial<DeviceParam> = ((command!.params || []).find((x) => x.key === k)) || {}; return String(given(vals[k]) ? vals[k] : p.default ?? ''); });
}
/** What is typed for a command's parameters, as a cue's `args`: only what was given, a number as a number. */
function argsOf(command: DeviceCommand | null | undefined, vals: Vals = {}) {
  const out: Vals = {};
  for (const p of (command && command.params) || []) if (given(vals[p.key])) out[p.key] = p.kind === 'number' && Number.isFinite(Number(vals[p.key])) ? Number(vals[p.key]) : vals[p.key];
  return out;
}
/** "Lantern A ▸ Effect (breathe)": a Device cue's default name, as the host's labels write it. */
function sendName(d: Device, c: DeviceCommand, vals: Vals = {}) {
  const shown = (c.params || []).map((p) => (given(vals[p.key]) ? vals[p.key] : p.default)).filter(given);
  return `${d.name} ▸ ${c.label || c.id}${shown.length ? ` (${shown.join(', ')})` : ''}`;
}
/** An id made from a name, as core/rig/devices.ts `idFrom` makes it (given with the edit, so the new one can be selected at once). */
function idFrom(name: unknown, taken: Set<string>) {
  let base = String(name || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'device';
  if (!/^[a-z]/.test(base)) base = `d_${base}`;
  base = base.slice(0, 28).replace(/_$/, '');
  let id = base;
  for (let k = 2; taken.has(id); k++) id = `${base}_${k}`;
  return id;
}
const takenIds = (s: State) => new Set([...devicesOf(s).map((d) => d.id), ...s.doc.settings.network.patches.map((p) => p.id)]);
/** A prop answers with its device's id ("lantern_a"): as a name a person reads, "Lantern a". */
const propName = (n: unknown) => { const t = String(n || '').replace(/_/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : 'Prop'; };
const hhmmss = (at: number | string | null | undefined) => (at ? new Date(at).toLocaleTimeString([], { hour12: false }) : '');
const heldOf = (s: State, d: Device | null) => (s.overrides || []).find((o) => o.on && o.id === (d && d.via === 'midi' ? 'midi' : 'osc')) || null;
/** A refusal from the host, as a person should read it (a part of the app that is not in this build says so plainly). */
const plain = (err: unknown) => (/cannot find module/i.test(String(err)) ? 'That part of Endless Cues is not in this build yet.' : /not built yet/i.test(String(err)) ? 'Not in this build yet: the Rig’s checks and Try arrive with the rest of it.' : String(err));
/** A host command whose refusal is said here, in plain words. Resolves the answer, or null when it was refused. */
async function ask(c: Command, say: Say) {
  let r;
  try { r = await ec.cmd(c); } catch (err) { r = { error: String((err && (err as Error).message) || err) }; }
  if (!r || r.error) { say(r ? plain(r.error) : 'The app did not answer', true); return null; }
  return r;
}

/**
 * A test run only (`ec.init().fixtures`): invented Rig and assistant states laid over what the host pushes, so the
 * pages can be looked at with no equipment and before the parts that compute them are in the build. `fix` is
 * { rig?, first?, proposal? }; null (as it always is outside a test run) leaves the state exactly as pushed.
 */
export function layFixture(s: State | null, fix: Fixture | null): State | null {
  if (!s || !fix) return s;
  const first = { first: fix.first };
  return { ...s, ...(fix.rig ? { rig: { ...(s.rig || {}), ...fix.rig } } : {}), ...(fix.first !== undefined ? { assistant: { ...(s.assistant || {}), ...first } } : {}),
    ...(fix.proposal !== undefined ? { proposal: fix.proposal } : {}) };
}

/** The Rig tab's dot: red when the show is not whole, yellow when something should be looked at, else nothing.
 *  Unsaved changes are not counted: the title bar's Save already says so, and a new show would wear a dot for it. */
export function rigDot(s: State | null) {
  const rig = s && (s.rig as RigView);
  const m: RigSummary = (rig && rig.summary) || {}, items = (rig && rig.items) || [];
  if ((m.problems ?? 0) > 0) return 'danger';
  const look = items.length ? items.filter((it) => it.state === 'look' && it.id !== 'show.saved').length : m.look;
  return (look ?? 0) > 0 ? 'standby' : '';
}

// ── adding a device ──────────────────────────────────────────────────────────
/** Add a device: from a model, a prop on this network, or empty. Each is one edit; the new device is selected. */
function AddDevice({ s, info, onAdded, scan, label = 'Add a device', primary }: { s: State; info: Info; onAdded: (id: string) => void; scan: () => void; label?: string; primary?: boolean }) {
  const [open, setOpen] = useState<'menu' | 'models' | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (ev: MouseEvent) => { if (box.current && !box.current.contains(ev.target as Node)) setOpen(null); };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);
  const add = async (device: Partial<Device> & { name: string }) => {
    setOpen(null);
    const names = new Set(devicesOf(s).map((d) => d.name));
    let name = device.name; for (let k = 2; names.has(name); k++) name = `${device.name} ${k}`;
    const id = idFrom(name, takenIds(s));
    const r = await edit([{ op: 'device.add', device: { ...device, name, id } }], `add ${name}`);
    if (r && !r.error) onAdded(id);
  };
  // the kit's props and the lighting desks first: they are what most people come here to add
  const models = (info.devices || []).filter((m) => m.id !== 'generic').sort((a, b) => (Number(/^ec-prop/.test(b.id)) - Number(/^ec-prop/.test(a.id))) || (Number(b.kind === 'desk') - Number(a.kind === 'desk')));
  return html`<span class="rig-add" ref=${box}>
    <button class=${cx('btn small', primary && 'primary', open && 'on')} data-rig-add onClick=${() => setOpen(open ? null : 'menu')}>${label} ▾</button>
    ${open === 'menu' ? html`<div class="rig-pop" onKeyDown=${(ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); setOpen(null); } }}>
      <button data-rig-add-model onClick=${() => setOpen('models')}><b>From a model…</b><span>Its commands come with it</span></button>
      <button onClick=${() => { setOpen(null); scan(); }}><b>A prop on this network</b><span>Look for kit props</span></button>
      <button data-rig-add-empty onClick=${() => add({ name: 'New device' })}><b>An empty device</b><span>Write its commands yourself</span></button>
    </div>` : null}
    ${open === 'models' ? html`<div class="rig-pop models">
      ${models.map((m) => html`<button key=${m.id} data-rig-model=${m.id} title=${m.label} onClick=${() => add({ name: m.label.split(' (')[0], model: m.id })}><b>${m.label}</b><span>${[m.kind, `${(m.commands || []).length} command${(m.commands || []).length === 1 ? '' : 's'}`, m.port ? `port ${m.port}` : null].filter(Boolean).join(' · ')}</span></button>`)}
    </div>` : null}
  </span>`;
}

// ── a row ────────────────────────────────────────────────────────────────────
function Row({ item, selected, onPick, actions = [], extra, pendingDot }: { item: RigItem; selected?: boolean; onPick?: (() => void) | null; actions?: RowAction[]; extra?: unknown; pendingDot?: boolean }) {
  const st = stateOf(item.state);
  return html`<div class=${cx('rig-row', selected && 'sel', onPick && 'pick')} data-rig-row=${item.id || ''} data-state=${st} onClick=${onPick || null}>
    <${Mark} state=${st} />
    <div class="rw">
      <div class="rl"><span class="lb">${item.label}${pendingDot ? html` <span class="unsaved-dot" title="Not saved yet"></span>` : null}</span>${item.text ? html`<span class="rt">${item.text}</span>` : null}${extra || null}</div>
      ${st !== 'ready' && item.fix ? html`<div class="rfix">${item.fix}</div>` : null}
    </div>
    ${actions.length ? html`<div class="ra" onClick=${(ev: MouseEvent) => ev.stopPropagation()}>${actions.map((a) => html`<button class="btn small" key=${a.id} data-rig-act=${a.id} disabled=${!!a.disabled} title=${a.title || ''} onClick=${a.run}>${a.label}</button>`)}</div>` : null}
  </div>`;
}

// ── the page ─────────────────────────────────────────────────────────────────
export function Rig({ s, info, byId, sel, list, editMode, say, reveal, saveVersion, openSettings, openDrawer, openCheck }: { s: State; info: Info; byId: CueIndex; sel: string[]; list: CueList; editMode: boolean; say: Say; reveal: (id: string) => void; saveVersion: () => unknown;
  openSettings: (section: string) => void; openDrawer: (drawer: string) => void; openCheck?: (() => void) | null }) {
  const rig = (s.rig || {}) as RigView;
  const items = rig.items || [], live = rig.devices || {}, sum = rig.summary || {};
  const devices = devicesOf(s), checks = checksOf(s), ticks = rig.ticks || {};
  const [picked, setPicked] = useState<string | null>(null);       // the device whose editor is open
  const [naming, setNaming] = useState<string | null>(null);       // the device just added: its name takes the keyboard, once
  const [looking, setLooking] = useState(false);
  const [firmware, setFirmware] = useState<string | null>(null);   // the device a firmware form is open for
  const device = picked && devices.find((d) => d.id === picked);
  // (a device that has gone is no longer selected; one just added is selected a moment before the show that has it arrives)
  const seen = useRef<string | null>(null);
  useEffect(() => { if (device) seen.current = device.id; else if (picked && seen.current === picked) { seen.current = null; setPicked(null); } }, [picked, !!device]);
  const unsaved = (id: string): Unsaved | null => (s.show.unsaved || []).find((c: Unsaved) => c.id === id && String(c.kind).startsWith('device-')) || null;

  const check = async () => { const r = await ask({ op: 'rig-check' }, say); if (r) say('Checked'); };
  const scan = async () => {
    if (looking) return;
    setLooking(true); setTimeout(() => setLooking(false), 1600);
    const r = await ask({ op: 'rig-scan' }, say);
    const found = r && (r.found || (Array.isArray(r) ? r : null));
    if (found && !found.length) say('Nothing answered');
    else if (found && found.every((f: FoundProp & { known?: string | null; moved?: boolean }) => f.known && !f.moved)) say(found.length === 1 ? `${propName(found[0].name)} answered: already a device` : `${found.length} props answered: all already devices`);
  };
  const askDevice = async (d: Device) => {
    const r = await ask({ op: 'device-ask', device: d.id }, say);
    if (!r) return;
    say(r.held ? `Held back: ${d.name} was not asked` : r.answered ? `${d.name} answered${Number.isFinite(r.ms) ? ` in ${Math.round(r.ms)} ms` : ''}` : `${d.name} did not answer${r.why ? `: ${r.why}` : ' in 1.5 s'}`, !r.held && !r.answered);
  };
  const tryIt = async (d: Device, c: DeviceCommand, vals: Vals = {}) => {
    const r = await ask({ op: 'device-try', device: d.id, command: c.id, args: argsOf(c, vals) }, say);
    if (!r) return null;
    // (the host answers { sent: the monitor's entry, held, message: what it composed, text: the sentence when held })
    say(r.held ? r.text || 'Held back: nothing was sent' : `Sent to ${d.name}: ${r.message || messageOf(c, vals)}`);
    return { held: !!r.held, at: Date.now() };
  };
  const addCue = async (d: Device, c: DeviceCommand, vals: Vals = {}) => {
    const after = sel && sel.length ? sel[sel.length - 1] : null, args = argsOf(c, vals);
    // (numbered as a cue added from the toolbar is: the next number after the cue it follows, when that is a top-level cue)
    const ed = s.doc.settings.editing || {}, x0 = after && byId.get(after);
    const number = ed.autoNumber === false || (x0 && x0.parent) ? {} : nextNumber(list.cues, after, ed.numberStep, [...byId.values()].map((y) => y.cue.number));
    const r = await edit([{ op: 'cue.add', cue: { type: 'device', device: d.id, command: c.id, ...number, ...(Object.keys(args).length ? { args } : {}) }, ...(after ? { after } : { list: list.id }) }], 'add a device cue');
    if (r && !r.error) { const x = after && byId.get(after); say(`Added “${sendName(d, c, vals)}” ${x ? `after ${x.cue.number ? `cue ${x.cue.number}` : `“${s.labels[after!]}”`}` : 'at the end of the list'}`); }
  };
  /** What a row's button does. The host names each action (core/rig/check.ts) and, for most, gives the command that
   *  does it (`cmd`); the few that need this window (a folder to choose, a cue to show, a device to select) are by id. */
  const act = (item: RigItem, a: RigAction, d: Device | null) => () => {
    const id = String(a.id || ''), c = a.cmd || null;
    if (id === 'ask') return d ? askDevice(d) : check();
    if (id === 'try') { const k = d && (d.commands || []).find((x) => x.id === ((c && c.command) || d.test)); return k ? tryIt(d, k) : say('It has no command that is safe to try', true); }
    if (id === 'save') return saveVersion();                       // (an untitled show is asked where first, which is the window's to ask)
    if (id === 'select') return a.cue ? reveal(a.cue) : undefined;
    if (id === 'relink') return ec.app({ op: 'relink' });          // (asks for the folder, and says what it found)
    if (c && c.op === 'edit') return edit(c.ops || [], c.label).then((r) => { if (r && !r.error && id === 'make-device') { setPicked(item.patch ?? null); say(`${String(item.label).split(':')[0]} is a device now`); } });
    if (c) return ask(c, say);
    return say(`“${a.label}” is not in this build`, true);
  };

  // the rows, in the host's order, by group; Equipment is always there (it is where a device is added)
  const order: string[] = [];
  for (const it of items) { const k = groupKey(it.group); if (!order.includes(k)) order.push(k); }
  if (!order.includes('equipment')) { const at = order.findIndex((k) => ['connections', 'held', 'before'].includes(k)); order.splice(at < 0 ? order.length : at, 0, 'equipment'); }
  const groups = order.filter((k) => k !== 'before');
  const deviceItem = (d: Device): RigItem => items.find((it) => it.id === `device.${d.id}`)
    || { id: `device.${d.id}`, label: d.name, state: 'unknown', text: d.via !== 'midi' && !(d.host && d.port) ? 'no address yet' : 'not checked yet', fix: d.via !== 'midi' && !(d.host && d.port) ? 'Give it an address.' : '', actions: [] };
  const deviceActions = (d: Device, it: RigItem): RowAction[] => {
    const given2: RowAction[] = (it.actions || []).map((a) => ({ id: a.id, label: a.label, run: act(it, a, d) }));
    if (given2.length || !editMode) return given2;
    const t = (d.commands || []).find((c) => c.id === d.test);
    const own: (RowAction | null)[] = [d.alive && d.alive.how === 'ask' ? { id: 'ask', label: 'Ask again', run: () => askDevice(d) } : null, t ? { id: 'try', label: `Try: ${t.label}`, run: () => tryIt(d, t) } : null];
    return own.filter((x): x is RowAction => !!x);
  };
  const found = rig.found;
  // what answered the last look, against the show as it is NOW (a prop added since is one of the show's devices, not one to add again)
  const foundNow = (f: FoundProp) => { const k = devices.find((d) => d.id === f.name || String(d.name).toLowerCase() === String(f.name).toLowerCase()) || devices.find((d) => d.host === f.host && Number(d.port) === Number(f.port)) || null;
    return { ...f, known: k ? k.id : null, moved: !!k && (k.host !== f.host || (f.port && Number(k.port) !== Number(f.port))), name: k ? k.name : f.name }; };
  const setChecks = (next: RigCheck[], label: string) => edit([{ op: 'show.set', path: 'settings.rig.checks', value: next }], label);
  const addCheck = (text: string) => { const t = String(text).trim(); if (!t) return; let k = checks.length + 1; while (checks.some((c) => c.id === `k${k}`)) k++; setChecks([...checks, { id: `k${k}`, text: t }], 'add a checklist line'); };
  const ticked = checks.filter((c) => ticks[c.id]).length;

  return html`<div class=${cx('rig', device && 'editing')} data-rig>
    <div class="rig-list">
      <div class="rig-head">
        <div class="rh1"><h2>The rig</h2>
          ${(sum.total ?? 0) > 0 ? html`<span class="rsum" data-rig-summary title=${sum.text || ''}>
              ${sum.ready === sum.total ? html`<span class="pc"><${Mark} state="ready" /><span>All <b>${sum.total}</b> are ready</span></span>`
                : html`<span class="pc"><${Mark} state="ready" /><span><b>${sum.ready}</b> of <b>${sum.total}</b> ready</span></span>`}
              ${(sum.problems ?? 0) > 0 ? html`<span class="pc"><${Mark} state="problem" /><span><b>${sum.problems}</b> ${sum.problems === 1 ? 'problem' : 'problems'}</span></span>` : null}
              ${(sum.look ?? 0) > 0 ? html`<span class="pc"><${Mark} state="look" /><span><b>${sum.look}</b> to look at</span></span>` : null}
              ${(sum.unknown ?? 0) > 0 ? html`<span class="pc"><${Mark} state="unknown" /><span><b>${sum.unknown}</b> cannot be told</span></span>` : null}</span>` : html`<span class="rsum dim" data-rig-summary>Nothing to check yet</span>`}</div>
        <div class="rh2"><span class="grow"></span>
          ${openCheck ? html`<button class="btn small" data-rig-show-check onClick=${openCheck} title="Every cue, target, loop and trigger, without playing anything">Check the show</button>` : null}
          <button class="btn small" data-rig-check onClick=${check} title=${sum.at ? `Ask everything again · last checked ${hhmmss(sum.at)}` : 'Ask everything again'}>Check again</button>
          <button class="btn small" data-rig-scan disabled=${!editMode || looking || rig.scanning} onClick=${scan} title=${editMode ? 'Say hello to kit props on this network' : 'Show mode: nothing is looked for'}>${looking || rig.scanning ? 'Looking…' : 'Look for props'}</button></div>
      </div>
      ${groups.map((g) => html`<div class="rig-group" key=${g} data-rig-group=${g}>
        <div class="rig-gl"><span>${groupLabel(g)}</span><span class="grow"></span>${g === 'equipment' && editMode && devices.length ? html`<${AddDevice} s=${s} info=${info} scan=${scan} onAdded=${(id: string) => { setPicked(id); setNaming(id); }} />` : null}</div>
        ${g === 'equipment' ? html`
          ${devices.map((d) => { const it = deviceItem(d), lv: DeviceNow = live[d.id] || {}; const warns = (lv.reports || []).filter((r) => r.warn);
            return html`<${Row} key=${d.id} item=${{ ...it, state: lv.state || it.state, text: it.text || lv.text }} selected=${picked === d.id} onPick=${() => setPicked(picked === d.id ? null : d.id)} pendingDot=${!!unsaved(d.id)}
              actions=${deviceActions(d, it)} extra=${[...(lv.reports || []).filter((r) => !r.warn && given(r.value) && (r.key === 'fw' || r.key === 'signal')).map((r) => html`<span class="rt" key=${r.key}>${r.label.toLowerCase()} ${r.value}${r.unit ? ` ${r.unit}` : ''}</span>`), ...warns.map((r) => html`<span class="rwarn" key=${r.key}><${Mark} state="look" />${r.label} ${r.value}${r.unit ? ` ${r.unit}` : ''}</span>`)]} />`; })}
          ${!devices.length ? html`<div class="rig-none" data-rig-none>
            <p>No devices yet.</p>
            ${editMode ? html`<div class="row-flex"><${AddDevice} s=${s} info=${info} scan=${scan} onAdded=${(id: string) => { setPicked(id); setNaming(id); }} />
</div>` : null}</div>` : null}
          ${(found || []).map(foundNow).map((f) => (f.known && !f.moved ? null     /* (one of the show's devices, where the show says: its own row says how it is) */
            : f.moved ? html`<div class="rig-found" key=${f.name + f.host}><${Mark} state="look" /><span class="grow">${f.name} is now at <span class="mono">${f.host}</span></span>
                <button class="btn small" disabled=${!editMode} onClick=${() => edit([{ op: 'device.set', id: f.known!, props: { host: f.host, ...(f.port ? { port: f.port } : {}) } }], `${f.name}: new address`)}>Use this address</button></div>`
              : html`<div class="rig-found" key=${f.name + f.host}><${Mark} state="ready" /><span class="grow">${f.name} answered at <span class="mono">${f.host}</span>${f.fw ? html` <span class="dim">· firmware ${f.fw}</span>` : null}</span>
                <button class="btn small" disabled=${!editMode} onClick=${async () => { const taken = takenIds(s), id = /^[a-z][a-z0-9_]{0,31}$/.test(f.name) && !taken.has(f.name) ? f.name : idFrom(f.name, taken), name = propName(f.name); const r = await edit([{ op: 'device.add', device: { id, name, model: f.kind === 'switch' ? 'ec-prop-switch' : 'ec-prop-light', host: f.host, ...(f.port ? { port: f.port } : {}) } }], `add ${name}`); if (r && !r.error) setPicked(id); }}>Add it</button></div>`))}
          ${found && !found.length ? html`<div class="rig-found dim"><${Mark} state="unknown" /><span class="grow">Nothing answered</span></div>` : null}` : null}
        ${items.filter((it) => groupKey(it.group) === g && !(g === 'equipment' && /^device\./.test(String(it.id)))).map((it) => html`<${Row} key=${it.id} item=${it}
          onPick=${(it.actions || []).some((a) => a.id === 'select' && a.cue) ? () => reveal(it.actions!.find((a) => a.id === 'select')!.cue!) : null}
          actions=${(it.actions || []).map((a) => ({ id: a.id, label: a.label, run: act(it, a, null), disabled: !editMode && (a.id === 'relink' || !!(a.cmd && a.cmd.op === 'edit')), title: !editMode && (a.id === 'relink' || (a.cmd && a.cmd.op === 'edit')) ? 'Show mode: switch to Edit to change the show' : '' }))} />`)}
      </div>`)}
      ${(rig.senders || []).length ? html`<div class="rig-group" data-rig-group="heard">
        <div class="rig-gl"><span>Heard on the network</span></div>
        ${rig.senders!.map((x) => { const m: { address?: string; every?: number | null } = (x.messages || [])[0] || {};
          return html`<div class="rig-found" key=${x.address + x.port}><${Mark} state="unknown" /><span class="grow"><span class="mono">${x.address}</span> sends <span class="mono">${m.address || 'messages'}</span>${m.every ? ` every ${Math.round(m.every * 10) / 10} s` : x.count ? ` (${x.count} so far)` : ''} <span class="dim">· not a device</span></span>
            <button class="btn small" disabled=${!editMode} onClick=${async () => { const name = `Device at ${x.address}`, id = idFrom(name, takenIds(s)); const r = await edit([{ op: 'device.add', device: { id, name, host: x.address, ...(x.port ? { port: x.port } : {}), alive: { how: 'heartbeat', ...(m.address ? { hears: m.address } : {}), within: 5 } } }], 'a device from what was heard'); if (r && !r.error) { setPicked(id); setNaming(id); } }}>Make it a device</button></div>`; })}
      </div>` : null}
      ${checks.length || editMode ? html`<div class="rig-group" data-rig-group="before">
        <div class="rig-gl"><span>Before the show</span>${checks.length ? html`<span class="dim num">${ticked} of ${checks.length}</span>` : null}<span class="grow"></span>
          ${checks.length ? html`<button class="btn small" data-rig-again disabled=${!ticked} onClick=${() => ask({ op: 'rig-ticks-clear' }, say)} title="Clear every tick">Start again</button>` : null}</div>
        ${checks.map((c) => html`<div class=${cx('rig-check', ticks[c.id] && 'done')} key=${c.id} data-rig-tick=${c.id}>
          <button class="tick" role="checkbox" aria-checked=${ticks[c.id] ? 'true' : 'false'} title=${ticks[c.id] ? 'Untick' : 'Tick when done'} onClick=${() => ask({ op: 'rig-tick', id: c.id, on: !ticks[c.id] }, say)}>${ticks[c.id] ? '☑' : '☐'}</button>
          ${editMode ? html`<${TextBox} value=${c.text} onCommit=${(v: string) => (String(v).trim() ? setChecks(checks.map((x) => (x.id === c.id ? { ...x, text: String(v).trim() } : x)), 'checklist line') : setChecks(checks.filter((x) => x.id !== c.id), 'remove a checklist line'))} />
            <button class="btn ghost small icon" title="Remove this line" onClick=${() => setChecks(checks.filter((x) => x.id !== c.id), 'remove a checklist line')}>×</button>` : html`<span class="ct">${c.text}</span>`}
        </div>`)}
        ${editMode ? html`<div class="rig-check new"><span class="tick dim">+</span><${TextBox} value="" placeholder=${checks.length ? 'Add a line' : 'Add a line: “Fresh batteries in both lanterns”'} onCommit=${addCheck} /></div>` : null}
      </div>` : null}
    </div>
    ${device ? html`<${DeviceEditor} key=${device.id} d=${device} live=${live[device.id] || {}} s=${s} info=${info} byId=${byId} editMode=${editMode} say=${say} naming=${naming === device.id} named=${() => setNaming(null)} unsaved=${unsaved(device.id)}
      tryIt=${tryIt} addCue=${addCue} askDevice=${askDevice} close=${() => setPicked(null)} openDrawer=${openDrawer} openFirmware=${() => setFirmware(device.id)} />` : null}
    ${firmware && devices.some((d) => d.id === firmware) ? html`<${Firmware} d=${devices.find((d) => d.id === firmware)} s=${s} info=${info} say=${say} close=${() => setFirmware(null)} openDrawer=${openDrawer} />` : null}
  </div>`;
}

// ── the device editor ────────────────────────────────────────────────────────
const TEMPLATE_FOR: Record<string, string> = { osc: '/address', text: 'TEXT', hex: '00', midi: 'note 60 100' };

/** One control for a parameter's value, by its kind. What is typed is this view's until Try or +cue sends it. */
function ParamBox({ p, value, onChange }: { p: DeviceParam; value: unknown; onChange: (value: string) => void }) {
  const title = `${p.label || p.key}${p.kind === 'number' && (p.min !== undefined || p.max !== undefined) ? ` (${p.min ?? '…'} to ${p.max ?? '…'})` : ''}${p.help ? `: ${p.help}` : ''}`;
  if (p.kind === 'enum') return html`<select class="pv" title=${title} value=${String(given(value) ? value : p.default ?? '')} onChange=${(ev: Event) => onChange((ev.target as HTMLSelectElement).value)}>${(p.options || []).map((o) => html`<option value=${String(o)}>${String(o)}</option>`)}</select>`;
  return html`<${TextBox} mono value=${value ?? ''} placeholder=${String(p.default ?? p.key)} style=${p.kind === 'number' ? 'width:50px' : 'width:110px'} onCommit=${onChange} />`;
}

function DeviceEditor({ d, live, s, info, byId, editMode, say, naming, named, unsaved, tryIt, addCue, askDevice, close, openDrawer, openFirmware }: { d: Device; live: DeviceNow; s: State; info: Info; byId: CueIndex; editMode: boolean; say: Say;
  naming: boolean; named: () => void; unsaved: Unsaved | null; tryIt: (d: Device, c: DeviceCommand, vals?: Vals) => Promise<{ held: boolean; at: number } | null>; addCue: (d: Device, c: DeviceCommand, vals?: Vals) => unknown;
  askDevice: (d: Device) => unknown; close: () => void; openDrawer: (drawer: string) => void; openFirmware: () => void }) {
  const R: DeviceTables = info.rig || {};
  const [vals, setVals] = useState<Record<string, Vals>>({});             // { commandId: { key: value } }: typed, not yet sent
  const [openCmd, setOpenCmd] = useState<string | null>(null);     // the command whose own settings are open
  const [more, setMore] = useState(false);
  const [sure, setSure] = useState(false);
  const [aliveHow, setAliveHow] = useState<'ask' | null>(null);   // "Ask it" chosen, its message not typed yet
  const [tried, setTried] = useState<{ id: string; held: boolean; at: number } | null>(null);         // { id, held, at }: the last Try from here
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (naming) setTimeout(() => { const el = root.current && root.current.querySelector<HTMLInputElement>('[data-rig-name] input'); if (el) { el.focus(); el.select(); } named(); }, 30); }, [naming]);
  const via = d.via || 'osc', network = via !== 'midi';
  const set = (props: DeviceChange, label?: string) => edit([{ op: 'device.set', id: d.id, props }], label || d.name);
  const changed = (key: string) => (unsaved && unsaved.fields ? (unsaved.fields.find((f) => f.field === key) || null) : null);
  const lab = (key: string, text: string) => { const c = changed(key); return html`<label title=${((R.fields || []).find((f) => f.key === key) || {}).help || ''}>${text}${c ? html`<${Was} was=${c.from} onBack=${() => set({ [key]: c.rawFrom === undefined ? null : c.rawFrom }, 'put back')} />` : null}</label>`; };
  const field = (key: string): TableField => (R.fields || []).find((f) => f.key === key) || { key, label: key };
  const model = d.model ? (info.devices || []).find((m) => m.id === d.model) : undefined;
  const held = heldOf(s, d), running = s.engine.active.length > 0;
  const alive: DeviceAlive = d.alive || { how: 'none' }, how = aliveHow || alive.how || 'none';
  const AL = Object.fromEntries((R.aliveFields || []).map((f) => [f.key, f]));
  const howLabels = (AL.how && AL.how.labels) || { none: 'It cannot be asked', ask: 'Ask it', heartbeat: 'It says so by itself' };
  const setAlive = (next: DeviceAlive) => { setAliveHow(null); set({ alive: next }, 'is it there'); };
  const pickHow = (h: string) => {
    if (h === 'none') return setAlive({ how: 'none' });
    if (h === 'heartbeat') return setAlive({ how: 'heartbeat', within: 5 });
    // asking needs the message it answers to: a model's is known; otherwise it waits to be typed
    const said: Partial<DeviceAlive> | undefined = model && model.alive;
    const send = alive.send || (said && said.send) || (model && model.answers && model.test) || '';
    if (send) return setAlive({ how: 'ask', send, ...(said && said.reply ? { reply: said.reply } : {}), every: 2 });
    return setAliveHow('ask');
  };
  const commands = d.commands || [];
  const setCommands = (next: DeviceCommand[], label: string) => set({ commands: next, ...(d.test && !next.some((c) => c.id === d.test) ? { test: null } : {}) }, label);
  const usedBy = (commandId: string) => { let n = 0; for (const x of byId.values()) if (x.cue.type === 'device' && x.cue.device === d.id && x.cue.command === commandId) n++; return n; };
  const setCommand = (id: string, change: CommandChange, label?: string) => setCommands(commands.map((c) => {
    if (c.id !== id) return c;
    const next: CommandChange = { ...c, ...change };
    if (change.template !== undefined) {
      // a parameter for every {key} in the message, and none it does not use (the show refuses anything else)
      const holes = [...new Set(holesOf(next.template))];
      next.params = holes.map((k): DeviceParam => (c.params || []).find((p) => p.key === k) || { key: k, label: k, kind: 'text', default: '' });
      if (next.fade && !next.params.some((p) => p.key === next.fade && p.kind === 'number')) delete next.fade;
    }
    for (const k of Object.keys(next) as (keyof CommandChange)[]) if (next[k] === null) delete next[k];
    return next as DeviceCommand;
  }), label || 'command');
  const setParam = (c: DeviceCommand, key: string, change: ParamChange) => setCommand(c.id, { params: c.params.map((p) => {
    if (p.key !== key) return p;
    const n: ParamChange = { ...p, ...change };
    if (change.kind === 'number') { n.default = Number.isFinite(Number(p.default)) && p.default !== '' ? Number(p.default) : 0; delete n.options; }
    if (change.kind === 'enum') { n.options = [String(given(p.default) ? p.default : 'one')]; n.default = n.options[0]; delete n.min; delete n.max; }
    if (change.kind === 'text') { n.default = String(p.default ?? ''); delete n.options; delete n.min; delete n.max; }
    if (n.kind === 'number') for (const k of ['default', 'min', 'max'] as const) { if (n[k] === '' || n[k] === null || (n[k] !== undefined && !Number.isFinite(Number(n[k])))) { if (k === 'default') n[k] = 0; else delete n[k]; } else if (n[k] !== undefined) n[k] = Number(n[k]); }
    if (n.kind === 'enum' && !n.options!.includes(String(n.default))) n.default = n.options![0];
    return n as DeviceParam;
  }), ...(change.kind && change.kind !== 'number' && c.fade === key ? { fade: null } : {}) }, 'parameter');
  const addCommand = async () => {
    let id = 'command'; for (let k = 2; commands.some((c) => c.id === id); k++) id = `command_${k}`;
    const r = await setCommands([...commands, { id, label: 'New command', template: TEMPLATE_FOR[via] || '/address', params: [] }], 'add a command');
    if (r && !r.error) setOpenCmd(id);
  };
  const rename = (c: DeviceCommand, label: string) => {
    // a command made here and not yet used by a cue takes its id from its name (cues name a command by its id, for life)
    const fresh = /^command(_\d+)?$/.test(c.id) && !usedBy(c.id) && String(label).trim();
    const id = fresh ? idFrom(label, new Set(commands.filter((x) => x.id !== c.id).map((x) => x.id))) : c.id;
    setCommands(commands.map((x) => (x.id === c.id ? { ...x, id, label: String(label).trim() || x.label } : x)), 'command name');
    if (id !== c.id) { setOpenCmd(id); if (d.test === c.id) set({ test: id }); }
  };
  const tryState = (c: DeviceCommand) => {
    if (network && !(d.host && d.port)) return { off: true, why: 'Give it an address first' };
    if (!editMode && c.id !== d.test) return { off: true, why: 'Show mode: only the command marked safe to try can be sent during a show' };
    if (!editMode && running) return { off: true, why: 'Show mode: not while a cue is running' };
    return { off: false, why: held ? `Held back: ${held.label} is off for rehearsal, so nothing will be sent` : `Send it once, now: ${messageOf(c, vals[c.id])}` };
  };
  const kit = /^ec-prop/.test(String(d.model || '')) || d.kind === 'prop';
  const st = stateOf(live.state);
  const reports = (live.reports || []).filter((r) => given(r.value));

  return html`<div class="rig-editor" ref=${root} data-rig-editor=${d.id}>
    <div class="re-head">
      <button class="btn ghost small back" onClick=${close}>‹ The rig</button>
      <div class="nm" data-rig-name title=${d.name}>${editMode ? html`<${TextBox} value=${d.name} placeholder="Its name" onCommit=${(v: string) => String(v).trim() && set({ name: String(v).trim() }, 'device name')} />` : html`<b>${d.name}</b>`}</div>
      ${editMode ? html`<select class="kind" title=${field('kind').help || ''} value=${d.kind || 'other'} onChange=${(ev: Event) => set({ kind: (ev.target as HTMLSelectElement).value }, 'kind')}>${(R.kinds || [d.kind || 'other']).map((k) => html`<option value=${k}>${k}</option>`)}</select>` : html`<span class="badge">${d.kind || 'other'}</span>`}
      <button class="btn ghost small icon x" onClick=${close} title="Close">×</button>
    </div>
    <div class="re-body">
      <div class="re-id mono" title="Its id, which cues use">${d.id}${model ? html`<span class="dim"> · started from ${model.label.split(' (')[0]}</span>` : null}${unsaved ? html`<span class="dim"> · </span><span class="unsaved-dot"></span><span class="dim"> ${unsaved.kind === 'device-added' ? 'new, not saved' : 'not saved'}</span>` : null}</div>

      ${editMode ? html`<div class="rig-f">${lab('via', 'Spoken to by')}<select value=${via} onChange=${(ev: Event) => { const v = (ev.target as HTMLSelectElement).value as Device['via']; return set(v === 'midi' ? { via: 'midi', host: null, port: null, alive: { how: 'none' } } : { via: v }, 'spoken to by'); }}>
          ${(R.vias || ['osc', 'text', 'hex', 'midi']).map((v: string) => html`<option value=${v}>${(field('via').labels || {})[v] || v}</option>`)}</select></div>` : null}
      <div class="rig-f">${lab('host', 'Address')}${!network ? html`<span class="dim">The show’s MIDI output</span>`
        : editMode ? html`<div class="addr"><${TextBox} mono value=${d.host || ''} placeholder="10.0.0.42" onCommit=${(v: string) => set({ host: String(v).trim() || null }, 'address')} /><span class="dim">:</span>
            <${TextBox} mono value=${d.port || ''} placeholder="port" style="width:64px" onCommit=${(v: string) => (String(v).trim() === '' ? set({ port: null }, 'port') : Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 65536 ? set({ port: Number(v) }, 'port') : say('A port is a number from 1 to 65535', true))} />
            <select style="width:64px" value=${d.protocol || 'udp'} onChange=${(ev: Event) => set({ protocol: (ev.target as HTMLSelectElement).value as Device['protocol'] }, 'protocol')}><option value="udp">udp</option><option value="tcp">tcp</option></select></div>`
          : html`<span class="mono">${d.host && d.port ? `${d.host} : ${d.port}  ${d.protocol || 'udp'}` : 'no address yet'}</span>`}</div>
      <div class="rig-f top">${lab('alive', 'Is it there')}<div class="alive">
        ${editMode ? html`<select value=${how} disabled=${!network} onChange=${(ev: Event) => pickHow((ev.target as HTMLSelectElement).value)}>${['none', 'ask', 'heartbeat'].map((h) => html`<option value=${h}>${howLabels[h]}</option>`)}</select>` : html`<span>${howLabels[how]}${how === 'ask' ? `, every ${alive.every || 2} s` : ''}</span>`}
        ${editMode ? html`<div class="alive-more">
          ${how === 'ask' ? html`<span class="dim">with</span><${TextBox} mono value=${alive.send || ''} placeholder=${via === 'osc' ? '/ping' : 'its message'} style="flex:1;min-width:70px" onCommit=${(v: string) => String(v).trim() && setAlive({ how: 'ask', every: 2, ...(alive.how === 'ask' ? alive : {}), send: String(v).trim() })} />
              <span class="dim">every</span><${TextBox} mono value=${alive.every || 2} style="width:40px" onCommit=${(v: string) => alive.how === 'ask' && setAlive({ ...alive, every: Math.max(1, Math.min(30, Number(v) || 2)) })} /><span class="dim">s</span>`
            : how === 'heartbeat' ? html`<span class="dim">it sends</span><${TextBox} mono value=${alive.hears || ''} placeholder="anything" style="flex:1;min-width:70px" onCommit=${(v: string) => { const { hears, ...rest } = alive; setAlive({ ...rest, ...(String(v).trim() ? { hears: String(v).trim() } : {}) }); }} />
              <span class="dim">within</span><${TextBox} mono value=${alive.within || 5} style="width:40px" onCommit=${(v: string) => setAlive({ ...alive, within: Math.max(1, Math.min(600, Number(v) || 5)) })} /><span class="dim">s</span>`
            : html`<span class="dim">${network ? 'Press Try and look' : 'MIDI cannot be asked'}</span>`}
        </div>${aliveHow === 'ask' ? html`<div class="dim hint">The message it answers, from its manual</div>` : how === 'heartbeat' ? html`<div class="dim hint">Opens the input port</div>` : null}` : null}
      </div></div>
      <div class="re-state" data-rig-state=${st}><${Mark} state=${st} /><span class="grow">${live.text || (st === 'unknown' ? (how === 'none' ? 'Cannot be told from here' : 'Not checked yet') : WORD[st])}${held ? html` <span class="dim">· held back</span>` : null}</span>
        ${how === 'ask' && alive.how === 'ask' ? html`<button class="btn small" onClick=${() => askDevice(d)}>Ask again</button>` : null}</div>
      ${reports.length ? html`<div class="re-reports">${reports.map((r) => html`<span key=${r.key} class=${cx(r.warn && 'warn')}>${r.warn ? html`<${Mark} state="look" />` : null}${r.label} <b class="mono">${r.value}${r.unit ? ` ${r.unit}` : ''}</b></span>`)}</div>` : null}

      <div class="rig-gl"><span>Commands</span><span class="dim num">${commands.length || ''}</span><span class="grow"></span></div>
      ${held ? html`<div class="re-note" data-rig-held>Held back: ${held.label} is off. Try sends nothing.</div>` : null}
      ${!editMode ? html`<div class="re-note">Show mode: ${d.test && commands.some((c) => c.id === d.test) ? `only “${commands.find((c) => c.id === d.test)!.label}” can be tried, while nothing runs.` : 'nothing can be tried.'}</div>` : null}
      ${!commands.length ? html`<div class="dim re-none">No commands yet</div>` : null}
      ${commands.map((c) => { const v = vals[c.id] || {}, ts = tryState(c), msg = messageOf(c, v), open = openCmd === c.id && editMode; const ch = (key: string, value: string) => setVals({ ...vals, [c.id]: { ...v, [key]: value } });
        return html`<div class=${cx('rig-cmd', open && 'open')} key=${c.id} data-rig-cmd=${c.id}>
          <div class="c1">
            <span class="cl" title=${`${c.label}${c.notes ? `: ${c.notes}` : ''}`}>${c.label}${d.test === c.id ? html`<span class="safe" title="Safe to try at any time">safe</span>` : null}</span>
            <div class="cp">${(c.params || []).map((p) => html`<${ParamBox} key=${p.key} p=${p} value=${v[p.key]} onChange=${(x: string) => ch(p.key, x)} />`)}</div>
            <div class="cb">
              <button class="btn small" data-rig-try=${c.id} disabled=${ts.off} title=${ts.why} onClick=${async () => { const r = await tryIt(d, c, v); if (r) setTried({ id: c.id, ...r }); }}>Try</button>
              ${editMode ? html`<button class="btn small" data-rig-cue=${c.id} title="Add a cue that sends this" onClick=${() => addCue(d, c, v)}>+cue</button>
                <button class=${cx('btn ghost small icon', open && 'on')} data-rig-cmd-edit=${c.id} title="Edit this command" onClick=${() => setOpenCmd(open ? null : c.id)}>✎</button>` : null}
            </div>
          </div>
          <div class="cm mono" title=${msg}><span class="dim">${held ? 'held' : 'sends'}</span> ${msg}${tried && tried.id === c.id ? html`<span class="dim"> · ${tried.held ? 'held back, not sent' : 'sent'} ${hhmmss(tried.at)}</span>` : null}</div>
          ${open ? html`<div class="ce">
            <div class="rig-f"><label>Name</label><${TextBox} value=${c.label} onCommit=${(x: string) => rename(c, x)} /></div>
            <div class="rig-f"><label title=${((R.commandFields || []).find((f) => f.key === 'template') || {}).help || ''}>Message</label><${TextBox} mono value=${c.template} onCommit=${(x: string) => String(x).trim() && setCommand(c.id, { template: String(x).trim() }, 'message')} /></div>
            ${(c.params || []).map((p) => html`<div class="rig-f top" key=${p.key}><label class="mono" title="A value a cue fills in">{${p.key}}</label><div class="pe">
              <${TextBox} value=${p.label || ''} placeholder="Its name" onCommit=${(x: string) => setParam(c, p.key, { label: String(x).trim() || p.key })} />
              <select style="width:86px" value=${p.kind || 'text'} onChange=${(ev: Event) => setParam(c, p.key, { kind: (ev.target as HTMLSelectElement).value as DeviceParam['kind'] })}><option value="number">number</option><option value="text">text</option><option value="enum">one of</option></select>
              ${p.kind === 'enum' ? html`<${TextBox} value=${(p.options || []).join(', ')} placeholder="steady, breathe" onCommit=${(x: string) => { const o = String(x).split(',').map((t) => t.trim()).filter(Boolean); if (o.length) setParam(c, p.key, { options: o }); }} />`
                : html`<span class="dim pl">default</span><${TextBox} mono value=${p.default ?? ''} placeholder="none" style="width:64px" onCommit=${(x: string) => setParam(c, p.key, { default: x })} />`}
              ${p.kind === 'number' ? html`<span class="dim pl">from</span><${TextBox} mono value=${p.min ?? ''} placeholder="any" style="width:48px" onCommit=${(x: string) => setParam(c, p.key, { min: x })} /><span class="dim pl">to</span><${TextBox} mono value=${p.max ?? ''} placeholder="any" style="width:48px" onCommit=${(x: string) => setParam(c, p.key, { max: x })} />` : null}
              ${p.kind === 'enum' ? html`<span class="dim pl">default</span><select style="width:110px" title="Default" value=${String(p.default ?? '')} onChange=${(ev: Event) => setParam(c, p.key, { default: (ev.target as HTMLSelectElement).value })}>${(p.options || []).map((o) => html`<option value=${String(o)}>${String(o)}</option>`)}</select>` : null}
            </div></div>`)}
            ${(c.params || []).some((p) => p.kind === 'number') ? html`<div class="rig-f"><label title=${((R.commandFields || []).find((f) => f.key === 'fade') || {}).help || ''}>Can fade</label><select value=${c.fade || ''} onChange=${(ev: Event) => setCommand(c.id, { fade: (ev.target as HTMLSelectElement).value || null }, 'fades')}><option value="">nothing</option>${c.params.filter((p) => p.kind === 'number').map((p) => html`<option value=${p.key}>${p.label || p.key}</option>`)}</select></div>` : null}
            <div class="row-flex"><span class="dim grow mono" title="Its id">${c.id}${usedBy(c.id) ? ` · used by ${usedBy(c.id)} cue${usedBy(c.id) === 1 ? '' : 's'}` : ''}</span>
              <button class="btn small" disabled=${d.test === c.id} title="Can be tried in Show mode" onClick=${() => set({ test: c.id }, 'safe to try')}>${d.test === c.id ? 'Safe to try' : 'Mark safe to try'}</button>
              <button class="btn small danger" onClick=${() => { setOpenCmd(null); setCommands(commands.filter((x) => x.id !== c.id), 'remove a command'); }}>Remove</button></div>
          </div>` : null}
        </div>`; })}
      ${editMode ? html`<div><button class="btn small" data-rig-add-cmd disabled=${commands.length >= 64} onClick=${addCommand}>Add a command</button></div>` : null}

      ${live.lastOut || live.lastIn ? html`<button class="re-last mono" title="Open the monitor" onClick=${() => openDrawer('monitor')}>
        ${live.lastOut ? html`<div><span class="dim">→</span> ${live.lastOut}</div>` : null}${live.lastIn ? html`<div><span class="dim">←</span> ${live.lastIn}</div>` : null}</button>` : null}

      <div class="rig-f top">${lab('notes', 'Notes')}${editMode ? html`<${TextBox} area value=${d.notes || ''} placeholder="Where it is, what powers it" onCommit=${(v: string) => set({ notes: String(v).trim() || null }, 'notes')} />` : html`<span class="notes">${d.notes || ''}</span>`}</div>

      ${editMode ? html`<button class="more" onClick=${() => setMore(!more)}>${more ? '▾' : '▸'} More</button>` : null}
      ${editMode && more ? html`
        <div class="rig-f">${lab('needed', 'The show needs it')}<div class="row-flex"><button class=${cx('switch', d.needed !== false && 'on')} onClick=${() => set({ needed: d.needed === false }, 'needed')}></button><span class="dim">${d.needed !== false ? 'Missing is a problem' : 'Missing is only a warning'}</span></div></div>
        <div class="rig-f">${lab('test', 'Safe to try')}<select value=${d.test || ''} onChange=${(ev: Event) => set({ test: (ev.target as HTMLSelectElement).value || null }, 'safe to try')}><option value="">no command</option>${commands.map((c) => html`<option value=${c.id}>${c.label}</option>`)}</select></div>
        ${network ? html`<div class="rig-f">${lab('resend', 'Send again')}<div class="row-flex"><${TextBox} mono value=${d.resend || 0} style="width:48px" onCommit=${(v: string) => set({ resend: Math.max(0, Math.min(5, Math.round(Number(v) || 0))) || null }, 'send again')} /><span class="dim" title=${field('resend').help || ''}>times</span></div></div>
          <div class="rig-f">${lab('listenPort', 'Answers on port')}<div class="row-flex"><${TextBox} mono value=${d.listenPort || ''} placeholder="the sender’s" style="width:96px" onCommit=${(v: string) => (String(v).trim() === '' ? set({ listenPort: null }) : Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 65536 ? set({ listenPort: Number(v) }, 'answers on port') : say('A port is a number from 1 to 65535', true))} /><span class="dim">on this computer</span></div></div>` : null}
        ${(d.reports || []).length ? html`<div class="rig-f top"><label title=${field('reports').help || ''}>It reports</label><div class="dim rep">${d.reports!.map((r) => html`<div key=${r.key}>${r.label}: argument ${r.arg || 0} of <span class="mono">${r.from}</span>${r.unit ? `, in ${r.unit}` : ''}${r.warnBelow !== undefined ? `, to look at below ${r.warnBelow}` : ''}${r.warnAbove !== undefined ? `, to look at above ${r.warnAbove}` : ''}</div>`)}</div></div>` : null}` : null}
    </div>
    ${editMode ? html`<div class="re-foot">
      ${kit ? html`<button class="btn small" data-rig-firmware onClick=${openFirmware} title="ESP32 firmware from the kit, for review">Write firmware…</button>` : null}
      <span class="grow"></span>
      <button class=${cx('btn small danger', sure && 'standby')} data-rig-remove onClick=${() => { if (!sure) { setSure(true); setTimeout(() => setSure(false), 3000); return; } edit([{ op: 'device.remove', id: d.id }], `remove ${d.name}`); }} title="Cues that use it break. Undo brings it back.">${sure ? 'Sure? Remove' : 'Remove'}</button>
    </div>` : null}
  </div>`;
}

// ── Write firmware… ──────────────────────────────────────────────────────────
// The form is the kit's own table of what may be set (core/kit/kit.ts `OPTIONS`, given by ec.init()): each option's
// label, choices, default and help are the kit's. Only what an empty box means is said here. The light's own look is
// not in the form (it is three colours and an effect: the assistant's make_prop_files takes it, and so does config.h).
const KIT_EMPTY: Record<string, string> = { ssid: 'typed into secrets.h', address: 'from the router' };
const kitFields = (info: Info): KitOption[] => ((info.kit && info.kit.options) || []).filter((f) => f && f.key && f.kind !== 'look');
function Firmware({ d, s, info, say, close, openDrawer }: { d: Device; s: State; info: Info; say: Say; close: () => void; openDrawer: (drawer: string) => void }) {
  const fields = kitFields(info);
  const [o, setO] = useState<Record<string, unknown>>(() => ({ sketch: d.model === 'ec-prop-switch' ? 'switch' : 'light' }));
  const val = (f: KitOption) => (o[f.key] !== undefined ? o[f.key] : f.default);
  const sketch = o.sketch;
  const shown = fields.filter((f) => !f.only || f.only === sketch);
  const write = async () => {
    const options: Record<string, unknown> = {};
    for (const f of shown) { const v = val(f); if (!given(v)) continue; if (f.kind === 'integer') { if (!Number.isInteger(Number(v))) { say(`${f.label} is a whole number`, true); return; } options[f.key] = Number(v); } else options[f.key] = v; }
    const r = await ask({ op: 'prop-files', device: d.id, options }, say);
    if (!r) return;
    close(); openDrawer('assistant');
    say(`${(r.files || []).length} files to review: nothing is written until you accept`);
  };
  return html`<div class="scrim" onMouseDown=${(ev: MouseEvent) => { if (ev.target === ev.currentTarget) close(); }}><div class="sheet rig-fw" data-rig-fw>
    <h2>Firmware for ${d.name}</h2>
    <p>Written to <span class="mono">props/${d.id}/</span> with the steps, after you review it. <b>Never yet run on a board:</b> a first draft.</p>
    ${s.show.untitled ? html`<div class="problem warning">Save the show to a folder first.</div>` : null}
    <div class="fw-form">${shown.map((f) => html`<div class="rig-f" key=${f.key} title=${f.help || ''} data-rig-fw-field=${f.key}><label>${f.label || f.key}</label>
      ${f.kind === 'enum' ? html`<select value=${String(val(f))} onChange=${(ev: Event) => setO({ ...o, [f.key]: (ev.target as HTMLSelectElement).value })}>${(f.options || []).map((x: string) => html`<option value=${x}>${(f.labels || {})[x] || x}</option>`)}</select>`
        : html`<${TextBox} mono value=${val(f) ?? ''} placeholder=${f.key === 'pin' ? (/c3/i.test(String(o.board || '')) ? '4' : '5') : KIT_EMPTY[f.key] || ''} onCommit=${(v: string) => setO({ ...o, [f.key]: String(v).trim() })} />`}</div>`)}</div>
    <p class="dim">The Wi-Fi password goes in <span class="mono">secrets.h</span>, never in the show.</p>
    <div class="acts"><button class="btn" onClick=${close}>Cancel</button><button class="btn primary" data-rig-fw-write disabled=${s.show.untitled} onClick=${write}>Review the files</button></div>
  </div></div>`;
}

// ── the Device cue, in the inspector ─────────────────────────────────────────
/** Whether a Device cue's field has nothing to say for the command chosen (Fade to and Duration, for a command with no value that fades). */
export function deviceCueHides(f: { key: string }, cues: Cue[], s: State) {
  if (!['fadeTo', 'duration', 'curve'].includes(f.key)) return false;
  return !cues.every((c) => { const d = devicesOf(s).find((x) => x.id === c.device), k = d && (d.commands || []).find((x) => x.id === c.command); return !!(k && k.fade); });
}
/** Device, Command, and one control for each of the command's parameters: the three fields a Device cue is made of. */
export function DeviceCueField({ f, cues, s, pending }: { f: { key: string; kind: string; label: string; help?: string }; cues: Cue[]; s: State; pending: Pending }) {
  const first = cues[0], ids = cues.map((c) => c.id), devices = devicesOf(s);
  const same = (key: keyof Cue) => cues.every((c) => JSON.stringify(c[key]) === JSON.stringify(first[key]));
  const d = same('device') ? devices.find((x) => x.id === first.device) : null;
  const k = d && same('command') ? (d.commands || []).find((x) => x.id === first.command) : null;
  const changed = cues.map((c): [Cue, PendingField | undefined] => [c, pending.cues.get(c.id) && pending.cues.get(c.id)!.fields.get(f.key)]).filter((x): x is [Cue, PendingField] => !!x[1]);
  const back = () => edit(changed.map(([c, p]) => ({ op: 'cue.set', id: c.id, props: { [f.key]: p.rawFrom === undefined ? null : p.rawFrom } })), 'put back');
  let control;
  if (f.kind === 'device') {
    control = html`<select value=${same('device') ? first.device || '' : ''} onChange=${(ev: Event) => { const v = (ev.target as HTMLSelectElement).value, nd = devices.find((x) => x.id === v); setCue(ids, { device: v || null, command: nd && nd.commands[0] ? nd.commands[0].id : null, args: null, fadeTo: null }, 'device'); }}>
      <option value="">${!devices.length ? 'No devices: add one on the Rig' : same('device') ? '— choose —' : '(mixed)'}</option>
      ${first.device && same('device') && !d ? html`<option value=${first.device}>${first.device} (gone)</option>` : null}
      ${devices.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select>`;
  } else if (f.kind === 'command') {
    control = html`<select value=${k ? k.id : same('command') && d ? first.command || '' : ''} disabled=${!d} onChange=${(ev: Event) => setCue(ids, { command: (ev.target as HTMLSelectElement).value || null, args: null, fadeTo: null }, 'command')}>
      <option value="">${!d ? 'Choose the device first' : (d.commands || []).length ? '— choose —' : `${d.name} has no commands yet`}</option>
      ${d && first.command && same('command') && !k ? html`<option value=${first.command}>${first.command} (gone)</option>` : null}
      ${d ? (d.commands || []).map((x) => html`<option value=${x.id}>${x.label}</option>`) : null}</select>`;
  } else {
    const args: Vals = same('args') && first.args && typeof first.args === 'object' ? first.args : {};
    const setArg = (key: string, v: unknown, p: DeviceParam) => { const next = { ...args }; if (!given(v)) delete next[key]; else next[key] = p.kind === 'number' && Number.isFinite(Number(v)) ? Number(v) : String(v); setCue(ids, { args: Object.keys(next).length ? next : null }, (p.label || key).toLowerCase()); };
    control = !k ? html`<span class="dim">${d ? 'Choose a command' : 'Choose a device and a command'}</span>`
      : !same('args') ? html`<span class="dim">Mixed: select one cue</span>`
        : !(k.params || []).length ? html`<span class="dim">No values</span>`
          : html`<div class="rig-args">${k.params.map((p) => html`<div class="arg" key=${p.key} title=${`${p.label || p.key}${p.kind === 'number' && (p.min !== undefined || p.max !== undefined) ? ` (${p.min ?? '…'} to ${p.max ?? '…'})` : ''}${p.help ? `: ${p.help}` : ''}`}>
              <span class="al">${k.fade === p.key && first.fadeTo !== undefined && first.fadeTo !== null ? `${p.label || p.key}: from` : p.label || p.key}</span>
              ${p.kind === 'enum' ? html`<select value=${String(given(args[p.key]) ? args[p.key] : p.default ?? '')} onChange=${(ev: Event) => setArg(p.key, (ev.target as HTMLSelectElement).value, p)}>${(p.options || []).map((o) => html`<option value=${String(o)}>${String(o)}</option>`)}</select>`
                : html`<${TextBox} mono value=${args[p.key] ?? ''} placeholder=${String(p.default ?? '')} onCommit=${(v: string) => setArg(p.key, v, p)} />`}</div>`)}
            <div class="sends mono" title="What it sends"><span class="dim">sends</span> ${messageOf(k, args)}</div></div>`;
  }
  const label = f.kind === 'args' ? 'Values' : f.label;
  return html`<div data-field=${f.key} class=${cx('field', changed.length && 'pending', f.kind === 'args' && 'wide top')} title=${f.help || ''}><label>${label}${changed.length ? html`<${Was} was=${changed.length === 1 ? changed[0][1].from : 'several values'} onBack=${back} />` : null}</label>${control}</div>`;
}

/** The view switch's words for the Rig (the title bar), kept here so the page and its tab agree. */
export const RIG_TITLE = keys('What the show needs, and whether it is ready (⇧⌘R)');
