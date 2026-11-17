/**
 * The network hub: every OSC message the app sends or hears goes through here.
 *
 *   out   a Network cue, a patch's Test button, a module  → send(patchId, "/address args")
 *   in    one input port (Settings ▸ Integrations ▸ Network) for remote control and triggers, over UDP and,
 *         on the same number, TCP (a remote that wants long answers connects that way),
 *         plus whatever a device answers on the socket we sent from, on its TCP connection,
 *         or on a reply port of its own (an Eos desk answers to a fixed port, not to the sender)
 *
 * Because there is one place, there is one monitor (the last few hundred messages, both ways,
 * with who and when), and each patch can say how it is doing: sent, failed, connected, answering.
 * That is the difference between "the cue fired" and "the desk heard it".
 *
 * UDP patches share one socket. A TCP patch keeps a connection open and reconnects by itself;
 * messages are framed with SLIP (OSC 1.1) or a length prefix (OSC 1.0), per patch. A patch may
 * have more destinations than one (a main and a backup desk): a message goes to each. A
 * destination may name the network interface it leaves by, on a computer with two networks.
 * A message need not be OSC: `format` 'text' or 'hex' sends those bytes as they are (core/net/raw.ts).
 *
 * A device of the show's rig (core/rig/devices.ts) is also a patch here: it is found by its id as a patch
 * is, and a few things are done for it that are not done for a patch. Its "are you there?" is sent quietly
 * (`quiet`: not in the monitor), and its answers, or its heartbeat, are kept out of the monitor too, the
 * first after a silence excepted: asked every two seconds, a device would otherwise be all the monitor showed.
 * What arrives on the input port from a device's address is credited to it. `onHeard` tells whoever is
 * keeping count (core/rig/liveness.ts) of everything that arrives.
 *
 * Plain node, no Electron. `dryRun` (the app's test runs) records everything and opens no socket;
 * `pretendHeard(id, text)` stands in for a device's answer there.
 */
import * as dgram from 'dgram';
import * as net from 'net';
import * as os from 'os';
import * as osc from './osc';
import * as raw from './raw';
import { DEVICES } from './devices';
import type { OscMessage } from './osc';
import type { DeviceAlive, Destination, Patch } from '../show/types';

/** A patch as the hub keeps it: one of the show's, or a device of its rig (`isDevice`, with how it is known to be there). */
export type HubPatch = Patch & { isDevice?: boolean; alive?: DeviceAlive; format?: string; resend?: number };
/** One place a patch's messages go, with nothing left to its patch. */
export interface HubDestination { host: string; port: number; protocol: 'udp' | 'tcp'; framing: 'slip' | 'length'; iface: string }
/** Who a message came from. */
export interface HubFrom { address: string; port: number; tcp?: boolean }
/** Answers the sender of a message on the input port. */
export type HubReply = (address: string, args?: unknown[], opts?: { port?: number }) => void;
/** A line of the monitor. */
export interface MonitorEntry {
  dir: 'in' | 'out'; who: string; patch: string | null; text: string; via?: string; from?: { address: string; port: number };
  ok?: boolean; why?: string; label?: string; held?: boolean; learned?: boolean; unused?: boolean; n?: number; at?: number;
}
/** A line of the monitor as it is kept: numbered, and when. */
export type Logged = MonitorEntry & { n: number; at: number };
/** What `learn` resolves with. */
export interface Learned { address: string; text: string; from: string }
type Via = { kind: 'input' | 'reply'; patch?: HubPatch };
type HeardFn = (msg: OscMessage, from: HubFrom, patch: HubPatch | null, info: { via: string; alive: boolean; at: number }) => void;
type MessageFn = (msg: OscMessage, from: HubFrom, reply: HubReply) => unknown;
interface Stat { sentAt: number; heardAt: number; error: string; lastOut: string; lastIn: string; askedAt: number; aliveAt: number }
interface TcpLink { key: string; sock: net.Socket | null; state: string; timer: NodeJS.Timeout | null; patch: string }
type ErrnoError = NodeJS.ErrnoException;

const MONITOR_MAX = 400;
const ANSWERING_MS = 6000;
const RECONNECT_MS = 2000;

/** This computer's networks, for a patch to choose from: [{ name, address }] (IPv4, loopback last). */
function interfaces(): { name: string; address: string; internal: boolean }[] {
  const out: { name: string; address: string; internal: boolean }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4') out.push({ name, address: i.address, internal: !!i.internal });
  return out.sort((a, b) => Number(a.internal) - Number(b.internal));
}
/** Everywhere a patch sends: itself, then its further destinations (each takes the patch's protocol unless it has its own). */
function destinationsOf(p: { host: string; port: number; protocol?: 'udp' | 'tcp'; framing?: 'slip' | 'length'; iface?: string; destinations?: Destination[] }): HubDestination[] {
  const more = Array.isArray(p.destinations) ? p.destinations : [];
  return [{ host: p.host, port: p.port, protocol: p.protocol || 'udp', framing: p.framing || 'slip', iface: p.iface || '' },
    ...more.filter((d) => d && d.host).map((d) => ({ host: d.host, port: d.port || p.port, protocol: d.protocol || p.protocol || 'udp', framing: d.framing || p.framing || 'slip', iface: d.iface || p.iface || '' }))];
}

function createHub({ log = () => {}, changed = () => {}, dryRun = false, now = Date.now }: { log?: (line: string) => void; changed?: () => void; dryRun?: boolean; now?: () => number } = {}) {
  let patches: HubPatch[] = [];                 // [{ id, name, host, port, protocol, framing, device, listenPort }]
  let held = '';                    // why nothing is being sent, while an override holds the output back
  let input = { port: 0, listen: false };
  let udp: dgram.Socket | null = null;                   // the socket UDP patches send from (and hear answers on)
  const udpOn = new Map<string, dgram.Socket>();          // a local address -> the socket for patches that leave by that interface
  let inSock: dgram.Socket | null = null, inPort = 0, inError = '';
  let inServer: net.Server | null = null, inTcpError = '';        // the same port over TCP
  const inConns = new Set<net.Socket>();        // the remotes connected to it
  const gone = new Set<(from: HubFrom) => void>();           // told when one of them hangs up
  const tcp = new Map<string, TcpLink>();            // "patch id" (or "patch id+1" for a further destination) -> { sock, state, key, timer }
  const replySocks = new Map<number, dgram.Socket>();     // listenPort -> socket
  const stat = new Map<string, Stat>();           // patch id -> { sentAt, heardAt, error, lastOut, lastIn }
  const monitor: Logged[] = [];
  const heardBy = new Set<HeardFn>();        // told of every message that arrives: fn(msg, from, patch | null, { via, alive })
  const listeners = new Set<MessageFn>();
  let learner: { resolve: (v: Learned | null) => void; timer: NodeJS.Timeout } | null = null;
  let seq = 0;

  const st = (id: string) => { if (!stat.has(id)) stat.set(id, { sentAt: 0, heardAt: 0, error: '', lastOut: '', lastIn: '', askedAt: 0, aliveAt: 0 }); return stat.get(id)!; };
  const noteEntry = (entry: MonitorEntry) => note(entry);
  function note(entry: MonitorEntry) {
    Object.assign(entry, { n: ++seq, at: now() });            // (the entry itself is kept, so that what is learned about it afterwards shows: "did nothing")
    monitor.push(entry as Logged);
    if (monitor.length > MONITOR_MAX) monitor.shift();
    changed();
  }
  // (who sent it: the patch or device at exactly that address and port first, which is what tells two props on one computer apart)
  const patchFrom = (address: string, port: number) => (port && patches.find((p) => p.host === address && Number(p.port) === port)) || patches.find((p) => p.host === address && (!port || Number(p.port) === port || p.protocol === 'udp')) || patches.find((p) => p.host === address) || null;
  const deviceFrom = (address: string, port: number) => (port && patches.find((p) => p.isDevice && p.host === address && Number(p.port) === port)) || patches.find((p) => p.isDevice && p.host === address) || null;
  /** Whether a message from a device is its answer to "are you there?", or its heartbeat (and so not for the monitor). */
  function isAlive(patch: HubPatch, msg: OscMessage, s: Stat, t: number): boolean {
    const a = patch.isDevice && patch.alive;
    if (!a || a.how === 'none' || !a.how) return false;
    const pattern = a.how === 'ask' ? a.reply : a.hears;
    if (pattern) return osc.matches(pattern, msg.address);
    // no pattern: anything from it counts. For a device that is asked, only what follows an ask is taken for its answer.
    if (a.how === 'ask') { const hit = s.askedAt > 0 && t - s.askedAt < 1500; if (hit) s.askedAt = 0; return hit; }
    return true;
  }

  /** Something arrived: from a device (an answer) or on the input port (a command or a trigger). */
  function heard(buf: Buffer, from: HubFrom, via: Via, reply?: HubReply) {
    let msgs: OscMessage[]; try { msgs = osc.decodeAll(buf); } catch { msgs = []; }
    for (const msg of msgs) heardOne(msg, from, via, reply);
  }
  function heardOne(msg: OscMessage, from: HubFrom, via: Via, reply?: HubReply) {
    // (what arrives on the input port is from whoever sent it: it is not credited to a patch that happens to share its address)
    // (…but a device of the show's rig is: its address is the show's own word for who it is)
    const patch = via.patch || (via.kind === 'input' ? deviceFrom(from.address, from.port) : patchFrom(from.address, from.port));
    const t = now();
    let alive = false, quiet = false;
    if (patch) {
      const s = st(patch.id);
      alive = isAlive(patch, msg, s, t);
      // an answer or a heartbeat is not written in the monitor, except the first after a silence (it is still counted)
      if (alive) { const a = patch.alive!, gap = (a.how === 'ask' ? 3 * (Number(a.every) || 2) : Number(a.within) || 5) * 1000; quiet = s.aliveAt > 0 && t - s.aliveAt <= gap; s.aliveAt = t; }
      s.heardAt = t; s.lastIn = osc.toText(msg); s.error = '';
    }
    const entry: MonitorEntry = { dir: 'in', who: patch ? (via.kind === 'input' ? `${patch.name} (${from.address}:${from.port})` : patch.name) : `${from.address}:${from.port}${from.tcp ? ' (TCP)' : ''}`,   // on the input port the sender is a guess by address: its address is shown too
          patch: patch ? patch.id : null, text: osc.toText(msg), via: via.kind, from: { address: from.address, port: from.port } };
    if (quiet) Object.assign(entry, { n: seq, at: t }); else note(entry);
    for (const fn of heardBy) { try { fn(msg, from, patch, { via: via.kind, alive, at: t }); } catch (err) { log(`a listener failed on ${msg.address}: ${(err as Error).message}`); } }
    if (quiet) changed();
    if (via.kind !== 'input' || alive) return;        // (a device saying it is there is not a command, a trigger or a message to learn)
    // a message being learned (a trigger, a show command's address) is only learned: capturing a desk's "GO" must not GO
    if (learner) { entry.learned = true; const l = learner; learner = null; clearTimeout(l.timer); l.resolve({ address: msg.address, text: osc.toText(msg), from: `${from.address}:${from.port}` }); return; }
    // a listener that acted on it says so (true); a message nothing acted on is marked in the monitor
    let used = false;
    for (const fn of listeners) { try { if (fn(msg, from, reply || (() => {})) === true) used = true; } catch (err) { log(`a listener failed on ${msg.address}: ${(err as Error).message}`); } }
    if (!used) entry.unused = true;
  }

  function ensureUdp() {
    if (udp || dryRun) return;
    udp = dgram.createSocket('udp4');
    udp.on('error', (e) => log(`udp: ${e.message}`));
    udp.on('message', (buf, from) => heard(buf, from, { kind: 'reply' }));
    udp.bind(0);
    udp.unref();
  }
  /** The address on this computer an interface has: `iface` is its name (en0) or the address itself. Throws when it is not here. */
  function localOf(iface: string): string {
    const all = interfaces();
    const hit = all.find((i) => i.name === iface) || all.find((i) => i.address === iface);
    if (!hit) throw new Error(`the network interface ${iface} is not on this computer (now)`);
    return hit.address;
  }
  /** The UDP socket for one destination: the shared one, or one bound to the interface it names. */
  function udpFor(dest: HubDestination): dgram.Socket {
    if (!dest.iface) { ensureUdp(); return udp!; }
    const local = localOf(dest.iface);
    let sock = udpOn.get(local);
    if (!sock) {
      sock = dgram.createSocket('udp4');
      udpOn.set(local, sock);
      sock.on('error', (e) => { log(`udp on ${local}: ${e.message}`); try { sock!.close(); } catch { /* closed */ } if (udpOn.get(local) === sock) udpOn.delete(local); });
      sock.on('message', (buf, from) => heard(buf, from, { kind: 'reply' }));
      sock.bind(0, local);
      sock.unref();
    }
    return sock;
  }

  /** The connection for one TCP destination of a patch (`at`: 0 is the patch itself). */
  function connectTcp(p: HubPatch, dest: HubDestination = destinationsOf(p)[0], at = 0): TcpLink {
    const id = at ? `${p.id}+${at}` : p.id;
    const key = `${dest.host}:${dest.port}:${dest.framing}:${dest.iface}`;
    const old = tcp.get(id);
    if (old && old.key === key) return old;
    if (old) dropTcp(id);
    const c: TcpLink = { key, sock: null, state: 'connecting', timer: null, patch: p.id };
    tcp.set(id, c);
    if (dryRun) { c.state = 'connected'; return c; }
    const open = () => {
      if (tcp.get(id) !== c) return;
      c.state = 'connecting';
      const read = osc.deframer(dest.framing);
      let sock: net.Socket;
      try { sock = net.createConnection({ host: dest.host, port: Number(dest.port), ...(dest.iface ? { localAddress: localOf(dest.iface) } : {}) }); }
      catch (e) { st(p.id).error = (e as Error).message; c.state = 'down'; c.timer = setTimeout(open, RECONNECT_MS); c.timer.unref && c.timer.unref(); return; }
      c.sock = sock;
      sock.setNoDelay(true);
      sock.on('connect', () => { c.state = 'connected'; st(p.id).error = ''; log(`${p.name}: connected (TCP ${dest.host}:${dest.port})`); changed(); });
      sock.on('data', (chunk: Buffer) => { for (const packet of read(chunk)) heard(packet, { address: dest.host, port: Number(dest.port) }, { kind: 'reply', patch: p }); });
      sock.on('error', (e: ErrnoError) => { st(p.id).error = e.code === 'ECONNREFUSED' ? `${at ? `${dest.host}:${dest.port} ` : ''}refused the connection` : e.message; });
      sock.on('close', () => { if (tcp.get(id) !== c) return; const was = c.state; c.state = 'down'; c.sock = null; if (was === 'connected') log(`${p.name}: connection lost`); changed(); c.timer = setTimeout(open, RECONNECT_MS); c.timer.unref && c.timer.unref(); });
    };
    open();
    return c;
  }
  function dropTcp(id: string) { const c = tcp.get(id); if (!c) return; tcp.delete(id); clearTimeout(c.timer ?? undefined); try { c.sock && c.sock.destroy(); } catch { /* gone */ } }

  function openInput() {
    const want = input.listen && Number(input.port) > 0 ? Number(input.port) : 0;
    if (want === inPort) return;
    if (inSock) { try { inSock.close(); } catch { /* closed */ } inSock = null; }
    closeInServer();
    inPort = want; inError = ''; inTcpError = '';
    if (!want || dryRun) return;
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    inSock = sock;
    sock.on('error', (e: ErrnoError) => { inError = e.code === 'EADDRINUSE' ? `port ${want} is in use by another program` : e.message; log(`input: ${inError}`); try { sock.close(); } catch { /* closed */ } if (inSock === sock) inSock = null; changed(); });
    // A reply goes back to the sender's own port, or to the port the answerer names (QLab answers a UDP client on a fixed port).
    sock.on('message', (buf, from) => heard(buf, from, { kind: 'input' }, (address: string, args: unknown[] = [], { port }: { port?: number } = {}) => { try { sock.send(osc.encode(address, args), Number(port) > 0 ? Number(port) : from.port, from.address, (err) => { if (err) log(`a reply to ${from.address}:${Number(port) > 0 ? port : from.port} could not be sent (${err.message})`); }); } catch { /* gone */ } }));       // (with the callback, a reply too big for one packet is an error here and not one that closes the port)
    sock.bind(want);
    openInServer(want);
  }

  // ── the input port over TCP ───────────────────────────────────────────
  // A stream has no packet edges, so a remote frames each message: SLIP (OSC 1.1, what QLab's remotes use) or a
  // 4-byte length (OSC 1.0). Which one is read off the connection's first byte: a SLIP sender starts with END
  // (0xC0) or with the "/" of an address, a length is a small number and so starts with 0. Answers go back on
  // the connection in the same framing, and have no size limit.
  function openInServer(port: number) {
    const server = net.createServer((conn) => {
      const from: HubFrom = { address: String(conn.remoteAddress || '').replace(/^::ffff:/, ''), port: conn.remotePort!, tcp: true };
      let framing: string | null = null, read: ((chunk: Buffer) => Buffer[]) | null = null;
      inConns.add(conn);
      conn.setNoDelay(true);
      const reply = (address: string, args: unknown[] = []) => { if (conn.destroyed || !framing) return; try { conn.write(osc.frame(osc.encode(address, args), framing)); } catch { /* gone */ } };
      conn.on('data', (chunk: Buffer) => {
        if (!read) { framing = chunk[0] === 0 ? 'length' : 'slip'; read = osc.deframer(framing); }
        for (const packet of read!(chunk)) heard(packet, from, { kind: 'input' }, reply);
      });
      conn.on('error', () => { /* the close that follows says it */ });
      conn.on('close', () => { inConns.delete(conn); for (const fn of gone) { try { fn(from); } catch (err) { log(`a listener failed on a disconnect: ${(err as Error).message}`); } } changed(); });
      changed();
    });
    inServer = server;
    server.on('error', (e: ErrnoError) => { inTcpError = e.code === 'EADDRINUSE' ? `TCP port ${port} is in use by another program` : e.message; log(`input (TCP): ${inTcpError}`); if (inServer === server) inServer = null; changed(); });
    server.listen(port, '0.0.0.0');
    server.unref();
  }
  function closeInServer() {
    for (const c of inConns) { try { c.destroy(); } catch { /* gone */ } }
    inConns.clear();
    if (inServer) { try { inServer.close(); } catch { /* closed */ } inServer = null; }
  }

  function openReplyPorts(on = true) {
    const want = new Set(on ? patches.map((p) => Number(p.listenPort)).filter((n) => n > 0 && n !== inPort) : []);
    for (const [port, sock] of replySocks) if (!want.has(port)) { try { sock.close(); } catch { /* closed */ } replySocks.delete(port); }
    if (dryRun) return;
    for (const port of want) {
      if (replySocks.has(port)) continue;
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      replySocks.set(port, sock);
      sock.on('error', (e) => { log(`reply port ${port}: ${e.message}`); for (const p of patches) if (Number(p.listenPort) === port) st(p.id).error = `cannot listen for its answers on ${port}: ${e.message}`; try { sock.close(); } catch { /* closed */ } replySocks.delete(port); changed(); });
      sock.on('message', (buf, from) => heard(buf, from, { kind: 'reply', patch: patches.find((p) => Number(p.listenPort) === port && p.host === from.address) || patches.find((p) => Number(p.listenPort) === port) }));
      sock.bind(port);
      sock.unref();
    }
  }

  return {
    /** The show's patches and input settings, whenever they change. `connect` false: no TCP connection is made and no
     *  reply port opened (a show from another computer, until it is turned on; what is sent is held back by `hold`). */
    configure({ patches: list = [], devices = [], inputPort = 0, listen = false, connect = true }: { patches?: HubPatch[]; devices?: HubPatch[]; inputPort?: number; listen?: boolean; connect?: boolean } = {}) {
      // (a device of the show's rig is also a patch here, found by its id as a patch is; it comes marked `isDevice`)
      patches = [...list.map((p) => ({ ...p })), ...devices.map((d) => ({ ...d, isDevice: true }))];
      input = { port: inputPort, listen };
      const wanted = new Set<string>();
      if (connect) for (const p of patches) destinationsOf(p).forEach((d, at) => { if (d.protocol === 'tcp' && d.host && d.port) { wanted.add(at ? `${p.id}+${at}` : p.id); connectTcp(p, d, at); } });
      for (const id of [...tcp.keys()]) if (!wanted.has(id)) dropTcp(id);
      for (const id of [...stat.keys()]) if (!patches.some((p) => p.id === id)) stat.delete(id);
      openInput();
      openReplyPorts(connect);
    },

    /** Send one message to a patch: "/address args", or with `format` 'text' or 'hex' those bytes. Returns the monitor entry: { ok, why }. */
    send(patchId: string | null | undefined, text: unknown, { label = '', format = 'osc', quiet = false, ask = false } = {}): MonitorEntry {
      // (quiet: not written in the monitor: an "are you there?" sent every few seconds (`ask`), or a command's repeats)
      const note = quiet ? () => {} : noteEntry;
      // (with no patch named: "the only patch", counting patches only, so that adding a device never re-aims a cue)
      const own = patches.filter((p) => !p.isDevice);
      const patch = patches.find((p) => p.id === patchId) || (patchId == null && own.length === 1 ? own[0] : null);
      const dests = patch ? destinationsOf(patch) : [];
      const entry: MonitorEntry = { dir: 'out', who: patch ? `${patch.name}${patch.host ? ` ${patch.host}:${patch.port}` : ''}${dests.length > 1 ? ` +${dests.length - 1}` : ''}` : '', patch: patch ? patch.id : null, text: format === 'osc' ? String(text) : `${format}: ${text}`, ok: true, label };
      const fail = (why: string) => { entry.ok = false; entry.why = entry.why ? `${entry.why}; ${why}` : why; if (patch) st(patch.id).error = why; if (!quiet) log(`DROPPED ${text}: ${why}`); };      // (an ask that cannot be sent is the device's row's to say, once: not a line in the log every two seconds)
      // an override (rehearsing without the equipment): said in the monitor, sent nowhere, and no fault of the patch's
      if (held) { entry.ok = false; entry.why = held; entry.held = true; note(entry); return entry; }
      try {
        if (!patch) throw new Error(own.length ? 'this cue has no patch chosen' : 'no network patch (Settings ▸ Integrations ▸ Network)');
        if (!patch.host || !(Number(patch.port) > 0)) throw new Error(`${patch.name} has no address or port`);
        const { packet, osc: isOsc } = raw.packetFor(text, format);
        const s = st(patch.id);
        if (ask) s.askedAt = now();
        if (!quiet) { s.sentAt = now(); s.lastOut = entry.text; }
        let failed = false;
        dests.forEach((d, at) => {
          const where = dests.length > 1 ? `${d.host}:${d.port}: ` : '';
          try {
            if (!(Number(d.port) > 0)) throw new Error('no port');
            if (dryRun) { if (d.iface) localOf(d.iface); return; }      // recorded, not sent
            if (d.protocol === 'tcp') {
              const c = connectTcp(patch!, d, at);
              if (c.state !== 'connected' || !c.sock) throw new Error(`${dests.length > 1 ? '' : `${patch!.name} is `}not connected${s.error && dests.length === 1 ? ` (${s.error})` : ''}`);
              c.sock.write(isOsc ? osc.frame(packet, d.framing) : packet);       // (text and bytes go as they are: the device's own protocol says where one ends)
            } else {
              udpFor(d).send(packet, Number(d.port), d.host, (err: Error | null) => { if (err) { fail(`${where}${err.message}`); changed(); } });
            }
          } catch (err) { failed = true; fail(`${where}${(err as Error).message}`); }
        });
        if (!failed && s.error && !/listen/.test(s.error)) s.error = '';
      } catch (err) { fail((err as Error).message); }
      note(entry);
      return entry;
    },

    /** One message to an address that is no patch's and no device's (asking a piece of equipment whether it is there
     *  before it is in the show). UDP only, never in the monitor's way: it is written there once, as any send is. */
    sendTo({ host, port }: { host: string; port: number }, text: unknown, { label = '', quiet = false } = {}): MonitorEntry {
      const entry: MonitorEntry = { dir: 'out', who: `${host}:${port}`, patch: null, text: String(text), ok: true, label };
      if (held) { entry.ok = false; entry.why = held; entry.held = true; if (!quiet) note(entry); return entry; }
      try {
        if (!host || !(Number(port) > 0)) throw new Error('no address or port');
        const { packet } = raw.packetFor(text, 'osc');
        if (!dryRun) { ensureUdp(); udp!.send(packet, Number(port), String(host), (err: Error | null) => { if (err) { entry.ok = false; entry.why = err.message; changed(); } }); }
      } catch (err) { entry.ok = false; entry.why = (err as Error).message; }
      if (!quiet) note(entry);
      return entry;
    },

    /** In a test run nothing arrives: this stands in for a device's (or a patch's) answer, "/ec/here lantern light 1.0 own 12 -52 87". */
    pretendHeard(patchId: string, text: string): boolean {
      const patch = patches.find((p) => p.id === patchId);
      if (!patch) return false;
      const m = osc.parseText(text);
      heardOne(osc.decode(osc.encode(m.address, m.args))!, { address: patch.host || '127.0.0.1', port: Number(patch.port) || 0 }, { kind: 'reply', patch });
      return true;
    },

    /** In a test run nothing arrives on the input port either: this stands in for a message from `from` ({ address, port, tcp? }),
     *  with `reply` taking what would be sent back (address, args, { port }). */
    pretendInput(text: string, from: HubFrom, reply: HubReply = () => {}) {
      const m = osc.parseText(text);
      heardOne(osc.decode(osc.encode(m.address, m.args))!, from, { kind: 'input' }, reply);
    },

    /** Everything that arrives, as it arrives: fn(msg, from, patch | null, { via, alive, at }). Returns a function that stops it. */
    onHeard(fn: HeardFn) { heardBy.add(fn); return () => heardBy.delete(fn); },

    /** Hold back everything that would be sent (`why` is what the monitor says of each message), or let it go again (''). */
    hold(why = '') { held = String(why || ''); },

    /** Something that went another way than OSC (a MIDI message), for the one monitor. */
    record(entry: MonitorEntry) { note(entry); },

    /** A patch's Test button: its device's own "are you there?" message, or one you give. */
    test(patchId: string, text = ''): MonitorEntry {
      const patch = patches.find((p) => p.id === patchId);
      const dev = patch && DEVICES[patch.device as string];
      return this.send(patchId, text || (dev && dev.test) || '/ping', { label: 'test' });
    },

    /** Messages arriving on the input port: fn(msg, from, reply). `from` is { address, port, tcp? }; `reply(address, args, { port }?)`
     *  answers the sender (on its connection; over UDP to its own port, or to `port`). Returns a function that stops listening. */
    onMessage(fn: MessageFn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** A remote connected over TCP hung up: fn(from). Returns a function that stops listening. */
    onGone(fn: (from: HubFrom) => void) { gone.add(fn); return () => gone.delete(fn); },

    /** The next message to arrive on the input port (for "learn"): resolves null after `ms`. */
    learn(ms = 15000) {
      if (learner) { clearTimeout(learner.timer); learner.resolve(null); }
      return new Promise<Learned | null>((resolve) => { learner = { resolve, timer: setTimeout(() => { learner = null; resolve(null); }, ms) }; });
    },
    cancelLearn() { if (learner) { clearTimeout(learner.timer); learner.resolve(null); learner = null; } },

    status() {
      const t = now();
      return {
        input: { port: inPort, listening: !!inSock || (dryRun && inPort > 0), error: inError, learning: !!learner,
                 tcp: !!inServer && !inTcpError, tcpError: inTcpError, connections: inConns.size },
        interfaces: interfaces().map(({ name, address }) => ({ name, address })),
        patches: Object.fromEntries(patches.map((p) => {
          const s = st(p.id);
          const conns = [...tcp.values()].filter((c) => c.patch === p.id);         // every TCP destination it has
          const answering = s.heardAt > 0 && t - s.heardAt < ANSWERING_MS;
          const state = s.error ? 'error' : conns.length ? (conns.every((c) => c.state === 'connected') ? (answering ? 'answering' : 'connected') : 'connecting')
            : answering ? 'answering' : s.sentAt ? 'sent' : 'idle';
          const text = s.error || ({ answering: 'answering', connected: 'connected', connecting: 'connecting…', sent: 'sent (no answer heard)', idle: 'not used yet' } as Record<string, string>)[state];
          return [p.id, { state, text, sentAt: s.sentAt, heardAt: s.heardAt, lastOut: s.lastOut, lastIn: s.lastIn, ...(conns.length ? { tcp: conns.every((c) => c.state === 'connected') } : {}) }];
        })),
      };
    },
    monitor: (since = 0) => monitor.filter((e) => e.n > since),
    clearMonitor() { monitor.length = 0; changed(); },

    close() {
      for (const id of [...tcp.keys()]) dropTcp(id);
      for (const s of [udp, inSock, ...udpOn.values(), ...replySocks.values()]) try { s && s.close(); } catch { /* closed */ }
      closeInServer();
      udp = inSock = null; udpOn.clear(); replySocks.clear(); inPort = 0;
      if (learner) { clearTimeout(learner.timer); learner = null; }
    },
  };
}

export type Hub = ReturnType<typeof createHub>;

export { createHub, interfaces, destinationsOf };
