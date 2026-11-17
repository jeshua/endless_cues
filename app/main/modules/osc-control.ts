/**
 * Module: OSC control.
 *
 * Other things run the show over OSC: a Stream Deck through Bitfocus Companion, QLab Remote, a
 * lighting desk's macro, a GO-button box, another computer. The addresses are QLab's dictionary,
 * as far as this app has the thing they name, so what already speaks to QLab on port 53000 finds
 * what it expects:
 *
 *   the show     /go  /go/<number>  /panic  /panicInTime <secs>  /stop  /hardStop  /pause  /resume  /reset
 *                /playhead/<number>  /playheadID/<id>  /playhead/next  previous  nextSequence  previousSequence
 *                /playhead/none  active  selected
 *                /select/<number>  /select_id/<id>  /select/next  previous        (the selection is the playhead)
 *                /showMode <0|1>  /toggleEditShowMode  /undo  /redo  /save
 *                /new <type> [<after cue id>]  /move/<id> <index> [<parent id>]  /delete/<number>  /delete_id/<id>
 *                /delete/selected  /delete/active  /renumber <start> <increment> [<prefix> [<suffix>]]
 *   one cue      /cue/<number>/…  /cue_id/<id>/…  /cue/selected/…  /cue/playhead/…  /cue/active/…
 *                (a number may be an OSC pattern, as in /cue/1?/stop)
 *     run it     start  go  preview  stop  hardStop  panic  pause  hardPause  resume  togglePause  load  loadAt <secs>  reset
 *     read it    number name notes preWait postWait duration continueMode armed flagged colorName  (an argument writes)
 *                uniqueID type displayName listName defaultName isRunning isPaused isLoaded isBroken isWarning
 *                actionElapsed percentActionElapsed children  valuesForKeys <a JSON list of those names>
 *   ask          /cueLists  /runningCues  /runningOrPausedCues  /selectedCues  /playheadID  /version  /workspaces
 *   a session    /connect <passcode>  /thump  /updates 1  /forgetMeNot 1  /disconnect
 *                /alwaysReply 1  /udpReplyPort <port>
 *   follow it    /listen  /listen/<event>  /listen/<event>/<field>  /ignore…  /eventFormat <text>
 *                (QLab's show control broadcast: core/net/qlab-events.ts)
 *
 * A "/workspace/<id>" prefix is accepted and ignored. A message that asks for something, or that is
 * refused, gets a QLab-style reply: "/reply/<address>" with one string, JSON { workspace_id, address,
 * status, data }. A plain command (/go) is answered only after "/alwaysReply 1", as in QLab.
 *
 * Over TCP (the same port; SLIP or length-prefixed) the reply goes back on the connection and may be
 * any size. Over UDP it goes to port 53001 of the sender's address, as QLab's does, until the sender
 * says "/udpReplyPort <n>"; the module's own setting can make that "the port it came from" instead.
 *
 * Who may do what: each passcode grants view (read), edit (change the show) and control (run it), in
 * any combination, and a row for "no passcode" says what a sender that never connects may do: view
 * and control at most. Editing always takes a passcode with edit access.
 *
 * Answers over UDP go only to a sender that has sent /connect (and /version, /workspaces and /connect's
 * own answer to anyone: they are small), and at most REPLY_BUDGET bytes a second to one address. A UDP
 * sender's address can be forged, so without this a short question with a forged address would send
 * someone else 9 KB. A plain command (/go) from a sender that never connected still works.
 *
 * Everything is done through host.cmd and read from host.snapshot: a property is written with a
 * cue.set edit, so Show mode refuses it. A message naming a cue that is not there is an error and
 * does nothing.
 *
 * It listens on the app's one OSC input port (Settings ▸ Network), through the network hub
 * (core/net/hub.ts), so everything it hears is in the OSC monitor.
 *
 * docs/specs/06-control-surfaces.md has the whole table, and what is not covered.
 */
import * as osc from '../../../core/net/osc';
import * as show from '../../../core/show/show';
import { TYPES, defaultName } from '../../../core/show/cue-types';
import * as events from '../../../core/net/qlab-events';
import type { OscMessage, OscTyped, OscValue } from '../../../core/net/osc';
import type { HubFrom, HubReply } from '../../../core/net/hub';
import type { Cue, Passcode } from '../../../core/show/types';
import type { Op as Edit, Props } from '../../../core/show/ops';
import type { HostCommand, HostResult, ModuleContext, ModuleField, ViewDoc } from '../host';

type Level = 'view' | 'edit' | 'control';
type Perms = Record<Level, boolean>;
/** The module's settings (the show's modules['osc-control']). */
interface Config { passcode?: string | number | null; passcodes?: Passcode[]; noPasscode?: Partial<Perms> | null; replyPort?: number | string | null }
/** A sender, as the module remembers it. */
interface Client {
  until: number; perms: Perms | null; connected: boolean; address: string; updates: boolean; keep: boolean; send: HubReply;
  always: boolean; replyPort: number | null; tcp: boolean; listen: Set<string>; format: string;
}
/** A reply: its status, and what it carries. */
interface Reply { status: string; data?: unknown }
/** A cue list, as QLab describes one: a cue whose children are the list's cues. */
interface ListThing {
  id: string; name: string; isList: true; children: Cue[];
  number?: undefined; notes?: undefined; color?: undefined; flagged?: undefined; preWait?: undefined; postWait?: undefined; duration?: undefined; type?: undefined; file?: undefined; continue?: undefined;
}
/** What an address can name: a cue, or a cue list. */
type Thing = (Cue & { isList?: false }) | ListThing;
/** A host command from an OSC message (its `from` is added as it is sent). */
type Cmd = HostCommand;

const QLAB_VERSION = '5.0.0';       // the dictionary this follows: a remote picks its dialect by it, so it is not the app's own version
const KEEP_MS = 61000;              // QLab forgets a UDP client after 61 s of silence
const MAX_REPLY = 9000;             // bytes: one UDP datagram (macOS sends no more than 9216 by default)
const QLAB_REPLY_PORT = 53001;      // where QLab answers a UDP client, whatever port the client sent from
const REPLY_BUDGET = 32768;         // bytes a second, at most, sent over UDP to any one address (answers, updates, events)
const ANSWERS_ANYONE = new Set(['/connect', '/version', '/workspaces']);     // answered over UDP before a /connect: short answers
const LEVELS: Level[] = ['view', 'edit', 'control'];
// QLab's names for the cues "/new" makes, where they are not this app's own type names
const NEW_TYPES: Record<string, string> = { 'go to': 'goto', 'goto': 'goto' };
const NO_SUCH_TYPE = new Set(['video', 'camera', 'text', 'midi file', 'timecode', 'reset', 'target', 'script', 'cart']);

/** A refusal for want of a permission (view, edit or control): it is answered "denied". */
class Denied extends Error { level: Level; constructor(level: Level) { super(`this needs ${level} access`); this.level = level; } }

/**
 * Who may do what, from the module's settings:
 *   passcodes    [{ code, view, edit, control }]   (and the older single `passcode`, which grants everything)
 *   noPasscode   { view, control }                 what a sender that gave no passcode may do (never edit)
 * With no passcode at all, everyone may view and run the show, and nobody may change it; once there is
 * one, a sender without it may do nothing unless the no-passcode row says so (QLab's default too).
 */
function accessOf(cfg: Config = {}) {
  const row = (r: Partial<Perms> | null | undefined): Perms => ({ view: !!(r && r.view), edit: !!(r && r.edit), control: !!(r && r.control) });
  const codes = (Array.isArray(cfg.passcodes) ? cfg.passcodes : []).filter((p) => p && String(p.code ?? '').trim() !== '').map((p) => ({ code: String(p.code).trim(), ...row(p) }));
  if (cfg.passcode != null && String(cfg.passcode).trim() !== '') codes.push({ code: String(cfg.passcode).trim(), view: true, edit: true, control: true });
  // (a sender with no passcode never edits: changing the show takes a passcode with edit access)
  const none = { ...(cfg.noPasscode && typeof cfg.noPasscode === 'object' ? row(cfg.noPasscode) : row(codes.length ? {} : { view: true, control: true })), edit: false };
  return { codes, none };
}
const any = (perms: Perms) => LEVELS.some((l) => perms[l]);
/** Whether what was sent is this passcode ("0421" sent as a number arrives as 421). */
const sameCode = (code: string, given: string) => code === given || (/^\d+$/.test(code) && /^\d+$/.test(given) && Number(code) === Number(given));
const CONTINUE = ['none', 'auto-continue', 'auto-follow'];      // QLab's continueMode 0, 1, 2

// a cue's transport, by QLab's name: the host command it becomes
const VERBS: Record<string, Cmd> = {
  start: { op: 'start' }, go: { op: 'start' }, preview: { op: 'fire' },
  stop: { op: 'stop' }, hardStop: { op: 'stop' }, panic: { op: 'stop', fade: true },
  pause: { op: 'pause' }, hardPause: { op: 'pause' }, resume: { op: 'resume' }, togglePause: { op: 'toggle' },
};
const SELECTORS = new Set(['selected', 'playhead', 'playbackPosition', 'active']);
const PLAYHEAD_WORDS = new Set(['nextSequence', 'previousSequence', 'none', 'active', 'selected']);      // never a cue's number
const EDITS = new Set(['undo', 'redo', 'save']);             // of the plain commands, the ones that need edit access (the rest: control)
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isPattern = (s: string) => /[*?[\]{}]/.test(s);
const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
/** A boolean as QLab takes one: OSC true/false, a number (0 is false), or text (n, f, 0… false; y, t, 1-9… true). */
function bool(v: unknown) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (/^[nNfF0]/.test(String(v))) return false;
  if (/^[yYtT1-9]/.test(String(v))) return true;
  return null;
}
const num = (v: unknown) => (v === '' || v == null || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v));      // (a float32 1.1 arrives as 1.10000002…)

export const id = 'osc-control';
export const name = 'OSC control';
export const summary = 'Run the show from Companion, a Stream Deck, a desk or another computer (QLab-compatible addresses).';
export const needsInput = true;
export const details = 'QLab’s addresses, over UDP and TCP on the input port. The show: /go · /go/<number> · /panic · /panicInTime <secs> · /stop · /hardStop · /pause · /resume · /reset · /playhead/<number> (and next, previous, nextSequence, previousSequence) · /select/<number> · /showMode · /undo · /redo · /save · /new <type> · /move/<id> <index> · /delete/<number> · /renumber <start> <increment>. One cue, as /cue/<number>/… , /cue_id/<id>/… , /cue/selected/… (the cue standing by), /cue/playhead/… or /cue/active/… : start, preview, stop, panic, pause, resume, togglePause, loadAt; and its properties: name, number, notes, preWait, postWait, duration, continueMode, armed, flagged and colorName to read or write, isRunning, isPaused, type and the like to read. To ask: /cueLists · /runningCues · /selectedCues · /version · /workspaces · /updates 1. To follow the show: /listen (QLab’s /qlab/event/… messages). A cue is called by its number, so number the cues it should reach. Changing the show is an edit: Show mode refuses it. Over UDP, answers go only to a sender that has sent /connect; a command is answered only after /alwaysReply 1, a question always is.';
export const fields: ModuleField[] = [
    { key: 'access', label: 'Who may do what', kind: 'osc-access', help: 'View: read the show. Control: run it. Edit: change it, which only a passcode can allow. A sender gives a passcode with /connect <passcode>.' },
    { key: 'replyPort', label: 'UDP answers go to port', kind: 'number', help: '53001 is where QLab answers, whatever port the question came from, and what remotes built for QLab listen on. 0: back to the port each message came from. A sender can ask for its own with /udpReplyPort. Over TCP the answer goes back on the connection.' },
  ];
export function create({ log, changed, host, net, now = Date.now }: Pick<ModuleContext, 'log' | 'changed' | 'host'> & { net?: ModuleContext['net'] | null; now?: () => number }) {
    let cfg: Config = {}, heard = 0, last = '', off: (() => unknown) | null = null, offGone: (() => unknown) | null = null, offCmd: (() => unknown) | null = null;
    let access = accessOf({});
    type View = ReturnType<typeof view>;
    type State = ReturnType<typeof host.snapshot>;
    type Heard = ReturnType<typeof heardNow>;
    type Picture = ReturnType<typeof picture>;
    /** A cue's property, as QLab names it: how it is read, and how it is written (a cue.set's props), if it can be. */
    interface Prop { get: (c: Thing, v: View) => unknown; set?: (v: unknown) => Props; flag?: 'flagged' | 'armed'; seconds?: 'preWait' | 'postWait' | 'duration'; options?: number }
    const clients = new Map<string, Client>();          // "addr:port" ("tcp/addr:port" for a connection) -> { until, perms, updates, keep, send, always, replyPort, tcp, listen, format }
    let playing: Heard | null = null;                 // what the listeners (/listen) were last told about (null: nobody listens)
    let saying = '';                    // the event a command being done is to be reported as, when its own name does not say ("/stop": stopAll)
    const can = (what: string) => !!(host.supports && host.supports(what));       // an op a newer host has (a cue loaded by id, one cue reset, the playhead taken off)
    const fails = new Map<string, { n: number; until: number }>();            // address -> { n, until }: wrong passcodes, and when the next try is listened to
    let seen: Picture | null = null;                    // what the subscribers were last told about (null: nobody is subscribed)
    const spent = new Map<string, { at: number; bytes: number }>();            // address -> { at, bytes }: what has gone to it over UDP this second
    let overSaid = 0;
    /** Whether `bytes` more may go to this address over UDP this second (a forged sender's address gets little). */
    function budget(address: string, bytes: number) {
      const t = now(), b = spent.get(address);
      if (!b || t - b.at >= 1000) { if (spent.size > 256) spent.clear(); spent.set(address, { at: t, bytes }); return bytes <= REPLY_BUDGET; }
      if (b.bytes + bytes > REPLY_BUDGET) { if (t - overSaid > 5000) { overSaid = t; log(`answers to ${address} held back: more than ${REPLY_BUDGET} bytes a second`); } return false; }
      b.bytes += bytes;
      return true;
    }

    /** One message → a host command (or a list of them, done in order until one is refused). null: not one of these. */
    function route(address: string, args: OscValue[] = []): Cmd | Cmd[] | null {
      const a = address.replace(/^\/workspace\/[^/]+/, '');
      const m = (re: RegExp) => re.exec(a);
      let r: RegExpExecArray | null;
      if (a === '/go') return typeof args[0] === 'string' && args[0] ? [{ op: 'jump', number: args[0] }, { op: 'go' }] : { op: 'go' };
      if ((r = m(/^\/go\/(.+)$/))) return [{ op: 'jump', number: decode(r[1]) }, { op: 'go' }];
      if (a === '/panic') return { op: 'panic' };
      if (a === '/panicInTime') {         // its time, when it comes with one; no time at all is a stop
        const secs = num(args[0]);
        return secs == null ? { op: 'panic' } : secs > 0 ? { op: 'fadeall', secs } : { op: 'panic', hard: true };
      }
      if (a === '/stop' || a === '/hardStop') return { op: 'panic', hard: true };
      if (a === '/reset') return { op: 'reset' };
      if (a === '/pause') return { op: 'pause' };
      if (a === '/resume') return { op: 'resume' };
      if (a === '/undo') return { op: 'undo' };
      if (a === '/redo') return { op: 'redo' };
      if (a === '/save') return { op: 'save' };
      if ((r = m(/^\/(?:playhead|playbackPosition|select)\/(next|previous)$/))) return { op: 'move', step: r[1] === 'next' ? 1 : -1 };
      if ((r = m(/^\/(?:playhead|playbackPosition|select)\/(.+)$/))) return PLAYHEAD_WORDS.has(r[1]) ? null : { op: 'jump', number: decode(r[1]) };
      if ((r = m(/^\/cue\/([^/]+)\/([^/]+)$/)) && has(VERBS, r[2])) return { ...VERBS[r[2]], number: decode(r[1]) };
      return null;
    }

    // ── the show, as QLab describes one (read from the host's snapshot) ─────────────────────
    function view() {
      const s = host.snapshot(true);
      const doc = (s.doc || { lists: [] }) as ViewDoc;
      const e = s.engine || {};
      const { byId, parentOf } = show.index(doc);
      const lists = new Map((doc.lists || []).map((l): [string, ListThing] => [l.id, { id: l.id, name: l.name, isList: true, children: l.cues }]));
      const list = (doc.lists || []).find((l) => l.name === e.listName) || (doc.lists || [])[0] || null;
      // what is going on under each cue: every active thing counts for the cue and for the groups it is in
      const going = new Map<string, typeof e.active>();
      for (const x of e.active || []) for (let id: string | null | undefined = x.id; id; id = parentOf.get(id)) { if (!going.has(id)) going.set(id, []); going.get(id)!.push(x); }
      const live = new Set(e.live || []), held = new Set(e.paused || []), disarmed = new Set(e.disarmed || []);
      const isPaused = (c: Thing) => held.has(c.id) || (going.has(c.id) && going.get(c.id)!.every((x) => x.paused));
      const isRunning = (c: Thing) => (going.has(c.id) || live.has(c.id)) && !isPaused(c);
      const action = (c: Thing) => (e.active || []).find((x) => x.id === c.id && x.kind !== 'wait') || null;
      const label = (c: Thing) => (c.isList ? c.name : c.name || defaultName(c, byId));
      const typeOf = (c: Thing) => (c.isList ? 'Cue List' : (TYPES[c.type] || {}).label || c.type);
      const problem = (c: Thing, level: string) => (s.problems || []).some((p) => p.id === c.id && p.level === level);
      const dict = (c: Thing): Record<string, unknown> => ({ uniqueID: c.id, number: c.isList ? '' : c.number || '', name: c.name || '', listName: label(c), type: typeOf(c),
                             colorName: c.color || 'none', flagged: !!c.flagged, armed: !disarmed.has(c.id), cues: (c.children || []).map(dict) });
      const all: Thing[] = []; show.walk(doc, (c) => all.push(c));
      return { s, doc, e, byId, lists, list, all, dict, label, typeOf, isPaused, isRunning, action, problem, disarmed,
               playhead: e.playhead ? byId.get(e.playhead) || null : null };
    }

    /** What a cue's properties are called in QLab: how each is read, and (where it can be) the cue.set that writes it. */
    const PROPS: Record<string, Prop> = {
      uniqueID: { get: (c) => c.id },
      number: { get: (c) => (c.isList ? '' : c.number || ''), set: (v) => ({ number: text(v) }) },
      name: { get: (c) => c.name || '', set: (v) => ({ name: text(v) }) },
      notes: { get: (c) => c.notes || '', set: (v) => ({ notes: text(v) }) },
      displayName: { get: (c, v) => v.label(c) },
      listName: { get: (c, v) => v.label(c) },
      defaultName: { get: (c, v) => (c.isList ? c.name : defaultName(c, v.byId)) },
      type: { get: (c, v) => v.typeOf(c) },
      colorName: { get: (c) => c.color || 'none', set: (v) => ({ color: String(v) }) },
      flagged: { get: (c) => !!c.flagged, flag: 'flagged' },
      armed: { get: (c, v) => !v.disarmed.has(c.id), flag: 'armed' },
      preWait: { get: (c) => Number(c.preWait) || 0, seconds: 'preWait' },
      postWait: { get: (c) => Number(c.postWait) || 0, seconds: 'postWait' },
      // a sound's length is the file's, as measured; anything else has the duration it was given
      duration: { get: (c, v) => (Number(c.duration) > 0 ? Number(c.duration) : c.type === 'audio' ? Number((v.e.durations || {})[c.file!]) || 0 : 0), seconds: 'duration' },
      continueMode: { get: (c) => Math.max(0, CONTINUE.indexOf(c.continue || 'none')), options: CONTINUE.length,
                      set: (v) => { const n = num(v); if (n == null || !CONTINUE[n]) throw new Error('continueMode: 0 (none), 1 (auto-continue) or 2 (auto-follow)'); return { continue: CONTINUE[n] }; } },
      isRunning: { get: (c, v) => v.isRunning(c) },
      isPaused: { get: (c, v) => v.isPaused(c) },
      isLoaded: { get: (c, v) => !!(v.e.loaded && v.e.loaded.id === c.id) },
      isBroken: { get: (c, v) => v.problem(c, 'error') },
      isWarning: { get: (c, v) => v.problem(c, 'warning') },
      actionElapsed: { get: (c, v) => { const x = v.action(c); return x ? Math.max(0, x.elapsed) : 0; } },
      percentActionElapsed: { get: (c, v) => { const x = v.action(c); return x && x.total > 0 ? Math.max(0, Math.min(1, x.elapsed / x.total)) : 0; } },
      children: { get: (c, v) => (c.children || []).map(v.dict) },
    };

    /** The cues an address names: [cues], or a sentence saying why there are none. */
    function cuesOf(v: View, kind: string, sel: string): Thing[] | string {
      if (kind === 'cue_id') { const c = v.byId.get(sel) || v.lists.get(sel); return c ? [c] : `no cue with the id ${sel}`; }
      if (sel === 'selected' || sel === 'playhead' || sel === 'playbackPosition') return v.playhead ? [v.playhead] : 'no cue is standing by';
      if (sel === 'active') { const on = v.all.filter((c) => v.isRunning(c) || v.isPaused(c)); return on.length ? on : 'no cue is running'; }
      if (isPattern(sel)) { const hit = v.all.filter((c) => c.number && osc.matches(sel, String(c.number))); return hit.length ? hit : `no cue’s number matches ${sel}`; }
      const c = show.findByNumber(v.doc, sel);
      return c ? [c] : `no cue numbered ${sel}`;
    }

    const ok = (data?: unknown): Reply => ({ status: 'ok', data });
    const err = (why: unknown): Reply => ({ status: 'error', data: why });
    /** The host's answer as a reply. */
    const told = (res: HostResult | null) => (res && res.error ? err(res.error) : ok());
    const act = (c: Cmd) => host.cmd({ ...c, from: 'osc' } as Cmd) as HostResult;

    /** "/cue/…" and "/cue_id/…". */
    function onCue(a: string, args: OscValue[], need: (level: Level) => void): Reply {
      const head = /^\/(cue|cue_id)\/(.+)$/.exec(a)!;
      const kind = head[1], segs = head[2].split('/');
      const v = view();
      let sel: string, rest: string[];
      if (segs.length === 1 && segs[0] === 'start' && args[0] != null) { sel = text(args[0]); rest = ['start']; }      // "/cue/start <number>", "/cue_id/start <id>"
      else if (kind === 'cue_id') {
        // (an id may have a "/" in it: the longest start of the address that is a cue's id)
        let k = segs.length - 1;
        while (k > 1 && !(v.byId.has(segs.slice(0, k).join('/')) || v.lists.has(segs.slice(0, k).join('/')))) k--;
        k = Math.max(1, k);
        sel = segs.slice(0, k).join('/'); rest = segs.slice(k);
      } else { sel = SELECTORS.has(segs[0]) ? segs[0] : decode(segs[0]); rest = segs.slice(1); }
      const method = rest[0];
      if (!method) return err('nothing asked of the cue');
      const cues = cuesOf(v, kind, sel);
      if (typeof cues === 'string') return err(cues);

      // its transport
      if (has(VERBS, method) && rest.length === 1) {
        need('control');
        let res: HostResult | null = null;
        for (const c of cues) { res = act({ ...VERBS[method], id: c.id } as Cmd); if (res && res.error) break; }
        return told(res);
      }
      if ((method === 'load' || method === 'loadAt') && rest.length === 1) {
        need('control');
        const t = args.slice(0, 3).map(num);
        if (method === 'loadAt' && (!t.length || t.includes(null))) return err('loadAt: a time in seconds (or hours, minutes, seconds)');
        const secs = method === 'load' ? 0 : t.length === 3 ? t[0]! * 3600 + t[1]! * 60 + t[2]! : t[0]!;
        // Load to Time is the cue standing by's; a cue elsewhere is loaded by its id, where the host can do that
        if (cues.length === 1 && v.playhead && cues[0].id === v.playhead.id) return told(act({ op: 'load', secs }));
        if (!can('load-id')) return err('only the cue standing by can be loaded: move the playhead to it first');
        let res: HostResult | null = null;
        for (const c of cues) { res = act({ op: 'load', id: c.id, secs }); if (res && res.error) break; }
        return told(res);
      }
      if (method === 'reset' && rest.length === 1) {
        need('control');
        if (!can('reset-id')) return err('one cue cannot be reset from here yet: /reset resets the whole show');
        let res: HostResult | null = null;
        for (const c of cues) { res = act({ op: 'reset', id: c.id }); if (res && res.error) break; }
        return told(res);
      }
      if (/^(playheadid|playbackpositionid)$/i.test(method) && rest.length === 1 && args.length === 0) {
        need('view');
        if (!cues[0].isList) return err('only a cue list has a playhead');
        return ok(v.list && v.list.id === cues[0].id && v.e.playhead ? v.e.playhead : 'none');
      }
      if (method === 'valuesForKeys' && rest.length === 1) {
        need('view');
        let keys: unknown; try { keys = JSON.parse(String(args[0])); } catch { keys = null; }
        if (!Array.isArray(keys)) return err('valuesForKeys: a JSON list of property names');
        if (cues.length !== 1) return err(`${cues.length} cues match: a read is of one cue`);
        return ok(Object.fromEntries(keys.filter((k): k is string => has(PROPS, k)).map((k) => [k, PROPS[k].get(cues[0], v)])));
      }

      // a property: read with no argument, written with one ("/+ 1", "/- 1", "/toggle" and "toggle" as QLab has them)
      const p = has(PROPS, method) ? PROPS[method] : null;
      if (!p) return err(`${method}: not something this answers to`);
      let how = rest[1] || '', arg: OscValue | undefined = args[0];
      if ((how === '+' || how === '-') && rest.length === 3) arg = rest[2];       // "/cue/10/preWait/+/1"
      else if (rest.length > 2 || (how && !['+', '-', 'toggle'].includes(how))) return err(`${rest.join('/')}: not something this answers to`);
      if (!how && arg === undefined) {
        need('view');
        if (cues.length !== 1) return err(`${cues.length} cues match: a read is of one cue`);
        return ok(p.get(cues[0], v));
      }
      need('edit');
      if (!how && arg === 'toggle' && p.flag) how = 'toggle';
      if (!p.set && !p.flag && !p.seconds) return err(`${method} can only be read`);
      if (cues.some((c) => c.isList)) return err('a cue list’s properties can only be read from here');
      const ops: Edit[] = [];
      const want = new Map<string, boolean>();             // cue id -> armed, as asked
      try {
        for (const c of cues) {
          let props: Props;
          if (p.flag) {
            const b = how === 'toggle' ? !p.get(c, v) : how ? null : bool(arg);
            if (b == null) throw new Error(`${method}: true or false`);
            props = { [p.flag]: b };
            if (p.flag === 'armed') want.set(c.id, b);
          } else if (p.seconds) {
            const n = num(arg);
            if (n == null || how === 'toggle') throw new Error(`${method}: a number of seconds`);
            props = { [p.seconds]: Math.max(0, how === '+' ? (p.get(c, v) as number) + n : how === '-' ? (p.get(c, v) as number) - n : n) };
          } else if (how === '+' || how === '-') {
            if (!p.options) throw new Error(`${method} cannot be stepped`);
            const n = arg === undefined ? 1 : num(arg);
            if (n == null) throw new Error(`${method}: a number of steps`);
            props = p.set!(((((p.get(c, v) as number) + (how === '+' ? n : -n)) % p.options) + p.options) % p.options);      // it rolls over
          } else if (how) throw new Error(`${method} cannot be toggled`);
          else props = p.set!(arg);
          ops.push({ op: 'cue.set', id: c.id, props });
        }
      } catch (e) { return err((e as Error).message); }
      const res = act({ op: 'edit', ops, label: `${method} (OSC)` });
      if (res && res.error) return err(res.error);
      // armed is also the engine's (the operator arms and disarms live): where the cue as written already said so, flip that
      if (want.size) { const after = new Set((host.snapshot(false).engine || {}).disarmed || []); for (const [id, b] of want) if (after.has(id) === b) act({ op: 'arm', id }); }
      return ok();
    }

    /** Whether onShow has an answer for this address (asked before the passcode is checked, so nothing is done yet). */
    function onShowKnows(a: string, args: OscValue[]) {
      if (/^\/(version|workspaces|cueLists|selectedCues|runningCues|runningOrPausedCues|showMode|toggleEditShowMode|save|new|renumber)$/.test(a)) return true;
      if (/^\/(playheadI[Dd]|playbackPositionI[Dd])$/.test(a)) return args.length === 0;
      if (/^\/(playhead|playbackPosition)\/[^/]+$/.test(a) && PLAYHEAD_WORDS.has(a.split('/')[2])) return true;
      return /^\/(playheadI[Dd]|playbackPositionI[Dd]|select_id|move|delete|delete_id)\/./.test(a);
    }
    /** One edit, as the host takes one (so Show mode refuses it, and it is one undo step). */
    const edit = (ops: Edit[], label: string) => act({ op: 'edit', ops, label: `${label} (OSC)` });
    /** What the show is asked or told, beyond the plain transport of `route` and a cue's own addresses. */
    function onShow(a: string, args: OscValue[], from: HubFrom, need: (level: Level) => void): Reply {
      switch (a) {
        case '/version': return ok(QLAB_VERSION);
        case '/workspaces': { const s = host.snapshot(true); return ok([{ uniqueID: wid(s), displayName: (s.show || {}).title || '', port: net ? net.status().input.port : 0, udpReplyPort: replyPortOf(clients.get(keyOf(from))) || from.port, version: QLAB_VERSION }]); }
        case '/cueLists': { need('view'); const v = view(); return ok([...v.lists.values()].map(v.dict)); }
        case '/selectedCues': { need('view'); const v = view(); return ok(v.playhead ? [v.dict(v.playhead)] : []); }
        case '/runningCues': { need('view'); const v = view(); return ok(v.all.filter(v.isRunning).map(v.dict)); }
        case '/runningOrPausedCues': { need('view'); const v = view(); return ok(v.all.filter((c) => v.isRunning(c) || v.isPaused(c)).map(v.dict)); }
        case '/playheadID': case '/playheadId': case '/playbackPositionID': case '/playbackPositionId': need('view'); return ok((host.snapshot(false).engine || {}).playhead || 'none');
        case '/showMode': {
          const on = host.snapshot(false).mode === 'show';
          if (!args.length) { need('view'); return ok(on); }
          need('control');
          const b = args[0] === 'toggle' ? !on : bool(args[0]);
          return b == null ? err('showMode: true or false') : told(act({ op: 'mode', mode: b ? 'show' : 'edit' }));
        }
        case '/toggleEditShowMode': need('control'); return told(act({ op: 'mode', mode: host.snapshot(false).mode === 'show' ? 'edit' : 'show' }));
        case '/save': { need('edit'); const res = act({ op: 'save' }); return res && res.needsFolder ? err('this show has no folder yet: save it from the app first') : told(res); }
        case '/playhead/nextSequence': case '/playhead/previousSequence': case '/playbackPosition/nextSequence': case '/playbackPosition/previousSequence': {
          need('control');
          if (can('sequence')) return told(act({ op: 'sequence', step: /next/.test(a) ? 1 : -1 }));      // the host's own (the = and - keys)
          // a sequence starts at a cue the one before it does not continue into
          const v = view(), top = v.list ? v.list.cues : [], next = /next/.test(a);
          const starts = top.map((c, i) => i).filter((i) => i === 0 || !['auto-continue', 'auto-follow'].includes(top[i - 1].continue!));
          const at = top.findIndex((c) => c.id === v.e.playhead);
          const to = next ? starts.find((i) => i > at) : starts.filter((i) => i < at).pop();
          return to === undefined ? err(next ? 'no cue sequence after this one' : 'no cue sequence before this one') : told(act({ op: 'playhead', id: top[to].id }));
        }
        // a new cue, after the one named (or the one standing by, or at the end of the list on screen); it then stands by, as QLab selects it
        case '/new': {
          need('edit');
          const said = String(args[0] ?? '').trim().toLowerCase();
          if (!said) return err('new: a kind of cue (audio, fade, group, memo…)');
          const v = view();
          if (said === 'cue list') {
            const res = edit([{ op: 'list.add' }], 'new list');
            if (res && res.error) return err(res.error);
            const made = ((host.snapshot(true).doc || {}).lists || []).find((l) => !v.lists.has(l.id));
            return ok(made ? made.id : '');
          }
          const type = NEW_TYPES[said] || said;
          if (NO_SUCH_TYPE.has(said) || !has(TYPES, type)) return err(NO_SUCH_TYPE.has(said) ? `there is no ${said} cue in this app` : `${said}: not a kind of cue`);
          const after = args[1] != null && String(args[1]) !== '' ? text(args[1]) : v.playhead ? v.playhead.id : null;
          if (after && !v.byId.has(after)) return err(`no cue with the id ${after}`);
          const res = edit([{ op: 'cue.add', cue: { type }, ...(after ? { after } : v.list ? { list: v.list.id } : {}) }], `new ${TYPES[type].label} cue`);
          if (res && res.error) return err(res.error);
          const id = (res.made || [])[0] || '';
          if (id && view().list && view().list.cues.some((c) => c.id === id)) act({ op: 'playhead', id });
          return ok(id);
        }
        // the number of the cue standing by (this app's selection is one cue), from a start, with QLab's prefix and suffix
        case '/renumber': {
          need('edit');
          const v = view(), start = num(args[0]), step = args[1] == null ? 1 : num(args[1]);
          if (start == null || step == null) return err('renumber: a start and an increment (then, if wanted, a prefix and a suffix)');
          if (!v.playhead) return err('no cue is standing by');
          return told(edit([{ op: 'cue.renumber', ids: [v.playhead.id], start, step, prefix: args[2] == null ? '' : text(args[2]), suffix: args[3] == null ? '' : text(args[3]) }], 'renumber'));
        }
        default:
      }
      let r: RegExpExecArray | null;
      // "/move/<id> <index> [<parent id>]": to that place among the cues of a list or a group (its own, when none is named)
      if ((r = /^\/move\/(.+)$/.exec(a))) {
        need('edit');
        const v = view(), c = v.byId.get(r[1]), index = num(args[0]);
        if (!c) return err(`no cue with the id ${r[1]}`);
        if (index == null || index < 0) return err('move: the place it goes to (0 is first)');
        const { parentOf } = show.index(v.doc);
        const home = parentOf.get(c.id) || (v.doc.lists.find((l) => l.cues.some((x) => x.id === c.id)) || {}).id;
        const to = args[1] != null && String(args[1]) !== '' ? text(args[1]) : home;
        const list = v.lists.get(to!), group = list ? null : v.byId.get(to!);
        if (!list && !(group && Array.isArray(group.children))) return err(`${to} is not a cue list or a group`);
        const others = (list ? list.children : group!.children!).filter((x) => x.id !== c.id);
        const at = Math.min(Math.floor(index), others.length);
        const res = edit([{ op: 'cue.move', ids: [c.id], ...(at < others.length ? { before: others[at].id } : list ? { list: list.id } : { parent: group!.id }) }], 'move');
        return res && res.error ? err(res.error) : ok({ parent: to, index: at });
      }
      // "/delete/<number>", "/delete/selected", "/delete/active", "/delete_id/<id>": one edit, whatever it takes away
      if ((r = /^\/(delete|delete_id)\/(.+)$/.exec(a))) {
        need('edit');
        const v = view(), sel = r[1] === 'delete_id' || SELECTORS.has(r[2]) ? r[2] : decode(r[2]);
        const cues = cuesOf(v, r[1] === 'delete_id' ? 'cue_id' : 'cue', sel);
        if (typeof cues === 'string') return err(cues);
        if (cues.some((c) => c.isList)) return err('a cue list is not deleted from here');
        const { parentOf } = show.index(v.doc);
        const ids = new Set(cues.map((c) => c.id));
        // (a cue inside a group that is going too goes with it)
        const inside = (id: string) => { for (let p: string | null | undefined = parentOf.get(id); p; p = parentOf.get(p)) if (ids.has(p)) return true; return false; };
        return told(edit(cues.filter((c) => !inside(c.id)).map((c) => ({ op: 'cue.remove', id: c.id })), 'delete'));
      }
      // QLab's other places for the playhead
      if ((r = /^\/(?:playhead|playbackPosition)\/([^/]+)$/.exec(a))) {
        need('control');
        if (r[1] === 'selected') return ok();                   // the selection is the playhead: it is there already
        if (r[1] === 'none') return can('playhead-none') ? told(act({ op: 'playhead', id: null })) : err('the playhead cannot be taken off the list from here yet');
        const v = view(), on = (v.list ? v.list.cues : []).find((c) => v.isRunning(c) || v.isPaused(c));        // "active": the first cue that is running
        return on ? told(act({ op: 'playhead', id: on.id })) : err('no cue is running');
      }
      need('control');
      const id = a.replace(/^\/[^/]+\//, '');             // "/playheadID/<id>", "/select_id/<id>"
      const v = view(), c = v.byId.get(id);
      if (!c) return err(`no cue with the id ${id}`);
      if (!v.doc.lists.some((l) => l.cues.includes(c))) return err('the playhead stands on a cue of the list, not on one inside a group');
      return told(act({ op: 'jump', number: c.id }));
    }

    // ── who is talking ────────────────────────────────────────────────────
    const wid = (s?: State) => { try { return String(host.showId ? host.showId() : ((s || host.snapshot(true)).doc || {}).id || ''); } catch { return ''; } };
    const keyOf = (from: HubFrom) => `${from.tcp ? 'tcp/' : ''}${from.address}:${from.port}`;
    // (a connection is remembered until it closes; a UDP sender for 61 s after its last message, unless it asked to be kept)
    const alive = (c: Client | null | undefined) => !!c && (c.tcp || c.keep || c.until > now());
    function client(from: HubFrom, send: HubReply) {
      const who = keyOf(from);
      let c: Client | null | undefined = clients.get(who);
      if (c && !alive(c)) { clients.delete(who); c = null; }
      if (!c) { c = { until: 0, perms: null, connected: false, address: from.address, updates: false, keep: false, send, always: false, replyPort: null, tcp: !!from.tcp, listen: new Set(), format: '' }; clients.set(who, c); }
      c.until = now() + KEEP_MS; c.send = send;
      return c;
    }
    const subscribed = () => [...clients.values()].some((c) => c.updates);
    const listening = () => [...clients.values()].some((c) => c.listen.size);
    function forget(who: string) { clients.delete(who); if (!subscribed()) seen = null; if (!listening()) playing = null; }
    /** The port a UDP sender is answered on: its own choice, or the module's (53001 as QLab; 0: the port it sent from). */
    const replyPortOf = (c: Client | null | undefined) => (c && c.replyPort != null ? c.replyPort : cfg.replyPort == null || cfg.replyPort === '' ? QLAB_REPLY_PORT : Number(cfg.replyPort) || 0);
    /** Something sent to a client that it did not ask for just now (an update, an event). */
    const tell = (c: Client, address: string, args: OscTyped[]) => {
      // (over UDP only to a client that connected, and within its address's budget)
      if (!c.tcp && (!c.connected || !budget(c.address, osc.encode(address, args).length))) return;
      try { c.send(address, args, c.tcp ? {} : { port: replyPortOf(c) }); } catch { /* gone */ }
    };

    /** A message from the input port. 'done': understood, and acted on or answered. true: ours, and refused. false: not ours. */
    function onOsc(msg: OscMessage, from: HubFrom, send: HubReply): 'done' | boolean {
      const who = keyOf(from);
      const a = msg.address.replace(/^\/workspace\/[^/]+/, '');
      const args = msg.args || [];
      let known: Client | null | undefined = clients.get(who);
      if (known && !alive(known)) { clients.delete(who); known = null; }
      /** One reply to the sender; returns the status that went. */
      const reply = (status: string, data?: unknown) => {
        const c = clients.get(who);
        // a plain command that went well is answered only where the sender asked for that ("/alwaysReply 1"), as QLab does
        if (status === 'ok' && data === undefined && !(c && c.always)) return status;
        const id = wid();
        const body = (st: string, d: unknown) => [{ type: 's', value: JSON.stringify({ ...(id ? { workspace_id: id } : {}), address: msg.address, status: st, ...(d !== undefined ? { data: d } : {}) }) }];
        let out = body(status, data);
        // (a datagram the system will not send is an error on the input port's socket: say so instead. A connection carries any size.)
        if (!from.tcp) {
          // (over UDP, only a sender that has connected is answered, bar the few short answers anyone gets: a forged address gets nothing)
          if (!(c && c.connected) && !ANSWERS_ANYONE.has(a)) return status;
          let size = osc.encode(`/reply${msg.address}`, out).length;
          if (size > MAX_REPLY) { status = 'error'; out = body(status, `the answer is ${size} bytes, more than one UDP message carries: ask over TCP (the same port)`); size = osc.encode(`/reply${msg.address}`, out).length; }
          if (!budget(from.address, size)) return status;
        }
        send(`/reply${msg.address}`, out, from.tcp ? {} : { port: replyPortOf(c) });
        return status;
      };
      // what this sender may do: what its passcode grants, or what a sender with none may
      const perms = (known && known.perms) || access.none;
      const need = (level: Level) => { if (!perms[level]) throw new Denied(level); };

      if (a === '/connect') {
        const f = fails.get(from.address);
        if (access.codes.length && f && f.until > now()) { reply('error', 'error'); return true; }      // too soon after a wrong one
        const given = args.length ? text(args[0]).trim() : '';
        const code = given === '' ? null : access.codes.find((c) => sameCode(c.code, given));
        // (with no passcode set at all, whatever is sent is welcome, as before)
        const granted = code || (given === '' || !access.codes.length ? access.none : null);
        const good = !!granted && any(granted);
        if (good) { const c = client(from, send); c.perms = code ? { view: code.view, edit: code.edit, control: code.control } : null; c.connected = true; fails.delete(from.address); }
        else { const n = (f ? f.n : 0) + 1; fails.set(from.address, { n, until: now() + Math.min(32, 2 ** (n - 1)) * 1000 }); }
        reply(good ? 'ok' : 'denied', good ? `ok:${LEVELS.filter((l) => granted[l]).join('|')}` : 'badpass');
        return good ? 'done' : true;
      }
      if (a === '/thump') {
        if (!any(perms)) { forget(who); reply('denied', 'thump'); return true; }
        if (known) client(from, send);
        reply('ok', 'thump');
        return 'done';
      }

      // is it one of ours at all? (anything else is left for a cue's trigger, with no reply)
      const hears = /^\/(listen|ignore)(\/.*)?$/.exec(a);
      const session = !!hears || ['/updates', '/forgetMeNot', '/udpKeepAlive', '/disconnect', '/alwaysReply', '/udpReplyPort', '/eventFormat'].includes(a);
      const cueish = !session && /^\/(cue|cue_id)\/./.test(a);
      const showish = !session && !cueish && onShowKnows(a, args);
      const cmds = session || cueish || showish ? null : route(a, args);
      if (!session && !cueish && !showish && !cmds) return false;
      // (QLab's /version and /workspaces answer whoever asks)
      if (!any(perms) && a !== '/version' && a !== '/workspaces') { reply('denied'); return true; }
      if (known) client(from, send);         // any message keeps a client remembered
      heard++; last = msg.address;

      if (session) {
        if (a === '/disconnect') { forget(who); reply('ok'); return 'done'; }
        const c = client(from, send);
        const fine = (data?: unknown) => { reply('ok', data); return 'done' as const; };
        const no = (why: string) => { reply('error', why); return true; };
        if (a === '/udpReplyPort') {
          if (!args.length) return fine(replyPortOf(c) || from.port);
          const n = num(args[0]);
          if (n == null || n < 0 || n > 65535) return no('udpReplyPort: a port number (0 puts it back)');
          c.replyPort = n > 0 ? Math.floor(n) : null;
          return fine();
        }
        if (a === '/eventFormat') {
          if (!args.length) return fine(c.format);
          const f = text(args[0]).trim();
          if (f) { try { events.parseFormat(f); } catch (e) { return no(`eventFormat: ${(e as Error).message}`); } }
          c.format = f;
          return fine();
        }
        if (hears) {
          const keys = events.keysOf(hears[2] || '');
          if (!keys) return no(`${(hears[2] || '').slice(1)}: not an event (${[...events.CUE_EVENTS, ...events.ALL_EVENTS].join(', ')}; a cue’s may end /number, /name, /uniqueID or /type)`);
          for (const k of keys) { if (hears[1] === 'listen') c.listen.add(k); else c.listen.delete(k); }
          // what is already so is not news: only what happens from here on is told
          if (listening()) { if (!playing) playing = heardNow(); } else playing = null;
          return fine();
        }
        const b = args.length ? bool(args[0]) : true;
        if (b == null) return no(`${a.slice(1)}: true or false`);
        if (a === '/updates') { c.updates = b; if (b && !seen) seen = picture(); else if (!subscribed()) seen = null; }
        else if (a === '/alwaysReply') c.always = b;
        else c.keep = b;
        return fine();
      }

      let r: Reply;
      try {
        if (cueish) r = onCue(a, args, need);
        else if (showish) r = onShow(a, args, from, need);
        else {
          let res: HostResult | null = null;
          const list = ([] as Cmd[]).concat(cmds!);
          for (const c of list) need(EDITS.has(c.op) ? 'edit' : 'control');
          saying = a === '/stop' ? 'stopAll' : '';
          // a step that is refused ends it: "/go/99" with no cue 99 must not GO whatever is standing by
          for (const c of list) { res = act(c); if (res && res.error) break; }
          r = told(res);
        }
      } catch (e) {
        if (e instanceof Denied) { reply('denied', e.message); changed(); return true; }
        log(`${msg.address}: ${(e as Error).message}`); r = err((e as Error).message);
      } finally { saying = ''; }
      const status = reply(r.status, r.data);
      if (r.data === undefined || status !== 'ok') changed();          // (something was done or refused: the status line says so; a read changes nothing)
      return status === 'ok' ? 'done' : true;        // ('done': it did something; a command for a cue that is not there did not)
    }

    // ── "/listen": QLab's show control broadcast (core/net/qlab-events.ts has the wording) ────────────
    /** What is going on, as far as an event is about it: the last GO, the cues running or paused, the playhead. */
    function heardNow() {
      const v = view();
      return { v, go: v.e.lastGo ? v.e.lastGo.at : null, on: new Set(v.all.filter((c) => v.isRunning(c) || v.isPaused(c)).map((c) => c.id)), head: v.e.playhead || null, list: v.list ? v.list.id : '' };
    }
    function emit(event: string, cue: Thing | null | undefined, v: View | null) {
      const info = cue ? { number: cue.number || '', name: v!.label(cue), uniqueID: cue.id, type: v!.typeOf(cue) } : null;
      for (const c of clients.values()) {
        if (!c.listen.size) continue;
        for (const [address, args] of events.messages(event, info, c.listen, { format: c.format, workspaceId: wid() })) tell(c, address, args);
      }
    }
    /** After every push of the host's state: a GO, cues starting and stopping, the playhead moving. */
    function onPlaying() {
      if (!playing) return;
      for (const [who, c] of clients) if (!alive(c)) clients.delete(who);
      if (!listening()) { playing = null; return; }
      const was = playing, is = (playing = heardNow()), v = is.v;
      // a cue started by GO is a "go"; one started any other way (a trigger, a Start cue, a preview, a continue) is a "cue/start"
      const gone = is.go != null && is.go !== was.go ? v.e.lastGo!.id : null;
      if (gone && v.byId.has(gone)) emit('go', v.byId.get(gone), v);
      for (const id of is.on) if (!was.on.has(id) && id !== gone && v.byId.has(id)) emit('cue/start', v.byId.get(id), v);
      for (const id of was.on) if (!is.on.has(id) && v.byId.has(id)) emit('cue/stop', v.byId.get(id), v);
      if (is.head !== was.head || is.list !== was.list) emit('playhead', is.head ? v.byId.get(is.head) || null : null, v);
    }
    /** A command the host has just done, whoever asked: the ones about everything at once are events of their own. */
    function onCmd(c: HostCommand, result: HostResult | Promise<HostResult>) {
      const res = result as HostResult;
      if (!playing || !c || (res && (res.error || res.ignored))) return;
      const one = c.id != null || c.number != null;
      const event = c.op === 'panic' ? (saying || (c.hard ? 'hardStopAll' : 'panicAll')) : c.op === 'fadeall' ? 'panicAll'
        : c.op === 'pause' && !one ? 'pauseAll' : c.op === 'resume' && !one ? 'resumeAll' : c.op === 'reset' && !one ? 'resetAll' : '';
      if (event) emit(event, null, null);
    }

    // ── "/updates 1": a subscriber is told what changed, in QLab's words ─────────────────────
    /** What a subscriber could have been told so far: the lists, each cue as written, and each cue's state. */
    function picture() {
      const s = host.snapshot(true), e = s.engine || {}, doc = (s.doc || { lists: [] }) as ViewDoc;
      const cues = new Map(), state = new Map();
      const mark = (id: string, ch: string) => state.set(id, (state.get(id) || '') + ch);
      for (const l of doc.lists || []) cues.set(l.id, JSON.stringify([l.name, l.cues.map((c) => c.id)]));
      show.walk(doc, (c) => { const { children, ...own } = c; cues.set(c.id, JSON.stringify([own, (children || []).map((k) => k.id)])); });
      for (const x of e.active || []) mark(x.id, x.paused ? 'p' : 'r');
      for (const id of e.live || []) mark(id, 'L');
      for (const id of e.paused || []) mark(id, 'P');
      for (const id of e.disarmed || []) mark(id, 'd');
      if (e.loaded) mark(e.loaded.id, `@${e.loaded.at}`);
      const list = (doc.lists || []).find((l) => l.name === e.listName) || (doc.lists || [])[0] || null;
      return { id: wid(s), cues, state, list: list ? list.id : '', playhead: e.playhead || null };
    }
    /** After every push of the host's state: what is different goes to whoever asked for updates. */
    function onState() {
      if (!seen) return;
      for (const [who, c] of clients) if (!alive(c)) clients.delete(who);
      const to = [...clients.values()].filter((c) => c.updates);
      if (!to.length) { seen = null; return; }
      const was = seen, is = (seen = picture());
      const out: [string, OscTyped[]][] = [];
      const base = `/update/workspace/${is.id}`;
      // cues added or taken away, another list on screen, another show: everything is to be read again
      if (is.id !== was.id || is.list !== was.list || is.cues.size !== was.cues.size || [...is.cues.keys()].some((id) => !was.cues.has(id))) out.push([base, []]);
      else {
        const ids = new Set<string>();
        for (const [id, json] of is.cues) if (was.cues.get(id) !== json) ids.add(id);
        for (const id of new Set([...is.state.keys(), ...was.state.keys()])) if (is.state.get(id) !== was.state.get(id) && is.cues.has(id)) ids.add(id);
        for (const id of ids) out.push([`${base}/cue_id/${id}`, []]);
      }
      if (is.playhead !== was.playhead || is.list !== was.list) out.push([`${base}/cueList/${is.list}/playbackPosition`, is.playhead ? [{ type: 's', value: is.playhead }] : []]);
      for (const c of to) for (const [address, args] of out) tell(c, address, args);
    }

    return {
      route, onOsc,
      onState() { onState(); onPlaying(); },
      start(config: Config) {
        cfg = { ...config }; access = accessOf(cfg); heard = 0;
        if (net) off = net.onMessage((msg, from, send) => onOsc(msg, from, send) === 'done');
        // a remote that hangs up is forgotten at once (its passcode with it)
        if (net && net.onGone) offGone = net.onGone((from) => forget(keyOf(from)));
        if (host.onCmd) offCmd = host.onCmd(onCmd);
      },
      stop() { for (const f of [off, offGone, offCmd]) if (f) f(); off = offGone = offCmd = null; clients.clear(); fails.clear(); seen = null; playing = null; },
      status() {
        const input: { listening: boolean; port: number; error?: string; tcp?: boolean; tcpError?: string } = net ? net.status().input : { listening: true, port: 0 };
        const tcp = [...clients.values()].filter((c) => c.tcp).length;
        return { ok: input.listening && !input.error, text: input.error || (input.listening ? `listening on UDP${input.tcp ? ' and TCP' : ''} ${input.port}${input.tcpError ? ` (${input.tcpError})` : ''}${tcp ? ` · ${tcp} connected` : ''}${heard ? ` · ${heard} received, last ${last}` : ''}` : 'not listening') };
      },
    };
  }
export { accessOf };
