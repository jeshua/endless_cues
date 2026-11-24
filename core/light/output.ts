/**
 * DMX out: Art-Net and sACN over the network, a packet per universe at every refresh; and a universe
 * of its own for each USB DMX interface.
 *
 *   configure(universes, { on })   which universes go where; opens and closes sockets to suit
 *   send(frames)                   one refresh: Map(universe id → 512 levels) from the rig
 *
 * The caller (app/main/lighting.js) owns the clock and calls `send` about 40 times a second with the
 * rig's whole state, changed or not. That steady stream is what "the last frame is held" means on
 * the wire: a receiver that misses a packet has the same levels again 25 ms later, and one that
 * joins late is right at once. Nothing is sent while `on` is false or no universe is set up, so a
 * show with no lights opens no socket at all.
 *
 * Art-Net: one socket on UDP 6454, shared for sending, for hearing other controllers' polls (each
 * is answered with an ArtPollReply, so this app shows up in their device lists) and for hearing
 * the answers to its own poll every 3 s (so the nodes on the network can be listed). A universe
 * with no address of its own is broadcast on every network this computer is on; with one, it is
 * sent to that address only. If 6454 is taken by another program the levels are still sent, from
 * another port, and nodes cannot be listed.
 *
 * sACN: one socket, to the universe's multicast group or to one address. When a universe stops
 * being sent (output off, the universe removed, the app closing) three "stream terminated" packets
 * say so, as E1.31 asks, so receivers let go at once.
 *
 * USB: a universe whose protocol is 'usb' goes to a USB DMX interface (core/light/usb.ts). There is no
 * serial port in Node, so the port is somebody else's: `usb` is handed in (the host's, which has the
 * audio window open it), and told three things: open(id, { kind, port }), levels(id, data), close(id).
 * It answers through `usbState(id, …)`: open, failed (no interface, or the port would not open) or
 * lost (the cable came out). A universe that is not open is tried again every 2 s for as long as it
 * is wanted, so plugging the interface in is enough. Levels are handed over when they change, and once
 * a second regardless (an interface repeats its last frame by itself). With no `usb` handed in (a
 * test, a script) a USB universe says so and sends nothing.
 *
 * `dryRun` (the app's test runs) builds every packet and keeps the last one, and opens no socket and
 * no port: nothing reaches a network or an interface. Plain node, no Electron.
 */
import * as nodeDgram from 'dgram';
import * as os from 'os';
import * as crypto from 'crypto';
import * as artnet from './artnet';
import * as sacn from './sacn';
import { enttecProFrame, openDmxFrame, kindOf } from './usb';
import type { UsbKind } from './usb';

/** A universe as the output sends it (one with an address). A USB one has a kind of interface and a port instead. */
export interface OutUniverse { id: number; protocol: 'artnet' | 'sacn' | 'usb'; address: number; host: string; device: UsbKind; port: string }
/** Whoever has the serial ports (the host, through the audio window). */
export interface UsbDmx {
  open(id: number, want: { kind: UsbKind; port: string }): void;
  levels(id: number, data: Buffer): void;
  close(id: number): void;
}
/** What is heard back about a USB universe: it is open (on the port named), it could not be opened, or it has gone. */
export interface UsbState { state: 'open' | 'failed' | 'lost'; name?: string; detail?: string }
type ErrnoError = NodeJS.ErrnoException;

const POLL_MS = 3000;
const NODE_GONE_MS = 10000;
const USB_RETRY_MS = 2000;
const USB_REPEAT_MS = 1000;

/** The broadcast address of each network this computer is on (IPv4, not loopback): [{ address, broadcast, mac }]. */
function broadcastAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): { address: string; mac: string; broadcast: string }[] {
  const out: { address: string; mac: string; broadcast: string }[] = [];
  for (const list of Object.values(interfaces || {})) for (const i of list || []) {
    if (i.internal || (i.family !== 'IPv4' && (i.family as unknown) !== 4) || !i.netmask) continue;
    const a = i.address.split('.').map(Number), m = i.netmask.split('.').map(Number);
    out.push({ address: i.address, mac: i.mac || '', broadcast: a.map((x, k) => (x | (~m[k] & 0xff)) & 0xff).join('.') });
  }
  return out;
}

/** 16 bytes that name this sender for good (an sACN CID), made from any text that stays the same on this computer. */
function cidFor(text: string): Buffer {
  const b = crypto.createHash('sha256').update(`endless-cues:${text}`).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;      // shaped as a UUID, as receivers expect to print it
  return Buffer.from(b);
}

function createLightOutput({ dgram = nodeDgram, dryRun = false, log = () => {}, changed = () => {}, now = Date.now, cid = cidFor(os.hostname()), name = 'Endless Cues',
                             ports = {}, listenPort = null, listen = true, bindAddress = undefined, interfaces = () => os.networkInterfaces(), usb = null }: {
  dgram?: Pick<typeof nodeDgram, 'createSocket'>; dryRun?: boolean; log?: (line: string) => void; changed?: () => void; now?: () => number; cid?: Buffer; name?: string;
  ports?: { artnet?: number; sacn?: number }; listenPort?: number | null; listen?: boolean; bindAddress?: string; interfaces?: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  usb?: UsbDmx | null;
} = {}) {
  const artPort = ports.artnet || artnet.PORT, sacnPort = ports.sacn || sacn.PORT;
  let universes: OutUniverse[] = [];                 // [{ id, protocol, address, host }]
  let on = false;
  let held = false;                   // an override: packets are made and none is sent
  let art: nodeDgram.Socket | null = null, artBound = false, artError = '';
  let acn: nodeDgram.Socket | null = null;
  let poller: NodeJS.Timeout | null = null;
  const seq = new Map<number, number>();              // universe id -> the last sequence number sent
  const stat = new Map<number, { packets: number; error: string; to: string }>();             // universe id -> { packets, error, to }
  const last = new Map<number, Buffer>();             // universe id -> the last packet built
  const nodes = new Map<string, NonNullable<ReturnType<typeof artnet.parsePollReply>> & { at: number }>();            // ip -> { ip, shortName, longName, outputs, at }
  let packets = 0;
  // universe id -> a USB interface as far as is known: asked for, open, or not there (and when it was last asked for)
  const usbPorts = new Map<number, { state: 'opening' | 'open' | 'failed'; askedAt: number; name: string; sent: Buffer | null; sentAt: number }>();

  const st = (id: number) => { if (!stat.has(id)) stat.set(id, { packets: 0, error: '', to: '' }); return stat.get(id)!; };
  let own: Set<string> | null = null, ownAt = -Infinity;
  const mine = () => { if (now() - ownAt > 5000) { own = new Set(broadcastAddresses(interfaces()).map((i) => i.address)); ownAt = now(); } return own!; };
  /** A socket that has just been given its last packets is closed a moment later, so they leave first. */
  const closeSoon = (sock: nodeDgram.Socket) => { const t = setTimeout(() => { try { sock.close(); } catch { /* closed */ } }, 200); t.unref && t.unref(); };
  const fail = (u: OutUniverse, why: string) => { const s = st(u.id); if (s.error !== why) { s.error = why; log(`universe ${u.id}: ${why}`); changed(); } };

  function openUsb(u: OutUniverse) {
    if (dryRun || !usb) return;
    usbPorts.set(u.id, { state: 'opening', askedAt: now(), name: '', sent: null, sentAt: -Infinity });
    try { usb.open(u.id, { kind: u.device, port: u.port }); } catch (err) { usbPorts.get(u.id)!.state = 'failed'; fail(u, (err as Error).message); }
  }
  function closeUsb(id: number) {
    if (!usbPorts.delete(id) || !usb) return;
    try { usb.close(id); } catch { /* gone already */ }
  }

  function heardArt(buf: Buffer, from: nodeDgram.RemoteInfo) {
    const kind = artnet.kindOf(buf);
    if (!kind || mine().has(from.address)) return;             // (our own broadcast, come back to us)
    if (kind === 'poll') {
      const me = broadcastAddresses(interfaces())[0] || { address: '0.0.0.0', mac: '' };
      const reply = artnet.artPollReply({ ip: me.address, mac: me.mac, shortName: name, longName: `${name} (show control)`, universes: universes.filter((u) => u.protocol === 'artnet' && u.address != null).map((u) => u.address) });
      try { art!.send(reply, artPort, from.address, () => {}); } catch { /* closed */ }
    } else if (kind === 'pollReply') {
      const n = artnet.parsePollReply(buf);
      if (!n) return;
      const fresh = !nodes.has(n.ip);
      nodes.set(n.ip, { ...n, ip: n.ip === '0.0.0.0' ? from.address : n.ip, at: now() });
      if (fresh) { log(`Art-Net node ${n.shortName || n.ip} answered`); changed(); }
    }
  }
  function poll() {
    for (const [ip, n] of nodes) if (now() - n.at > NODE_GONE_MS) { nodes.delete(ip); changed(); }
    if (!art || !artBound) return;
    const packet = artnet.artPoll();
    for (const i of broadcastAddresses(interfaces())) { try { art.send(packet, artPort, i.broadcast, () => {}); } catch { /* closed */ } }
  }

  function openArt() {
    if (art || dryRun) return;
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    art = sock; artBound = false; artError = '';
    sock.on('message', heardArt);
    sock.on('error', (e: ErrnoError) => {
      if (art !== sock) return;
      // the port is someone else's (another lighting program on this computer): send from any port instead
      if (!artBound && listen) {
        artError = e.code === 'EADDRINUSE' ? `port ${listenPort || artPort} is in use by another program: levels are still sent, nodes cannot be listed` : e.message;
        log(`art-net: ${artError}`);
        try { sock.close(); } catch { /* closed */ }
        const plain = dgram.createSocket('udp4');
        art = plain;
        plain.on('error', (err) => { artError = err.message; log(`art-net: ${err.message}`); changed(); });
        plain.bind(0, bindAddress, () => { try { plain.setBroadcast(true); } catch { /* not bound */ } });
        plain.unref();
        changed();
        return;
      }
      artError = e.message; log(`art-net: ${e.message}`); changed();
    });
    sock.bind(listen ? (listenPort || artPort) : 0, bindAddress, () => { if (art !== sock) return; artBound = listen; try { sock.setBroadcast(true); } catch { /* closed */ } poll(); changed(); });
    sock.unref();
    if (listen) { poller = setInterval(poll, POLL_MS); poller.unref(); }
  }
  function closeArt() {
    clearInterval(poller ?? undefined); poller = null;
    if (art) { try { art.close(); } catch { /* closed */ } }
    art = null; artBound = false; nodes.clear();
  }
  function openAcn() {
    if (acn || dryRun) return;
    const sock = dgram.createSocket('udp4');
    acn = sock;
    sock.on('error', (e) => { log(`sacn: ${e.message}`); changed(); });
    sock.bind(0, bindAddress);
    sock.unref();
  }
  /** E1.31: a source that stops says so three times. */
  function terminate(list: OutUniverse[]) {
    for (const u of list) {
      if (u.protocol !== 'sacn' || u.address == null || !seq.has(u.id)) continue;
      for (let i = 0; i < 3; i++) {
        const n = (seq.get(u.id)! + 1) & 0xff; seq.set(u.id, n);
        const packet = sacn.dataPacket({ universe: u.address, cid, sequence: n, data: Buffer.alloc(0), name, terminated: true });
        last.set(u.id, packet);
        if (acn && !dryRun) { try { acn.send(packet, sacnPort, u.host || sacn.multicastAddress(u.address), () => {}); } catch { /* closed */ } }
      }
      seq.delete(u.id);
    }
  }

  /** One refresh of a USB universe: the frame is made (and kept, for a test to look at) and handed to whoever has the port. */
  function sendUsb(u: OutUniverse, data: Buffer): number {
    const s = st(u.id);
    last.set(u.id, Buffer.from(u.device === 'open' ? openDmxFrame(data) : enttecProFrame(data)));
    packets++; s.packets++;
    if (dryRun || held) return 1;
    if (!usb) { fail(u, 'USB DMX needs the app: there is no serial port here'); return 1; }
    const p = usbPorts.get(u.id);
    const t = now();
    if (!p || (p.state === 'failed' && t - p.askedAt >= USB_RETRY_MS)) { openUsb(u); return 1; }
    if (p.state !== 'open') return 1;
    if (p.sent && t - p.sentAt < USB_REPEAT_MS && p.sent.equals(data)) return 1;
    p.sent = Buffer.from(data); p.sentAt = t;
    try { usb.levels(u.id, p.sent); } catch (err) { fail(u, (err as Error).message); }
    return 1;
  }

  return {
    configure(list: { id: number; protocol?: string; address: number | null; host?: string; device?: unknown; port?: string }[] = [], { on: want = false } = {}) {
      const next: OutUniverse[] = (Array.isArray(list) ? list : []).filter((u) => u && u.address != null).map((u) => ({
        id: u.id, protocol: u.protocol === 'sacn' ? 'sacn' : u.protocol === 'usb' ? 'usb' : 'artnet', address: u.address!, host: String(u.host || '').trim(), device: kindOf(u.device), port: String(u.port || '').trim() }));
      const key = (u: OutUniverse) => `${u.id}|${u.protocol}|${u.address}|${u.host}|${u.device}|${u.port}`;
      // whatever is no longer being sent as it was is let go of first
      const gone = universes.filter((u) => !want || !next.some((n) => key(n) === key(u)));
      terminate(gone);
      // (and what was said of it, where it went and what went wrong, is no longer true)
      for (const u of gone) { if (u.protocol === 'usb') closeUsb(u.id); const s = stat.get(u.id); if (s) { s.error = ''; s.to = ''; } }
      for (const u of universes) if (!next.some((n) => n.id === u.id)) { stat.delete(u.id); last.delete(u.id); seq.delete(u.id); }
      universes = next; on = !!want;
      const live = on && universes.length > 0;
      if (on) for (const u of universes) if (u.protocol === 'usb' && !usbPorts.has(u.id)) openUsb(u);
      if (live && universes.some((u) => u.protocol === 'artnet')) openArt(); else closeArt();
      if (live && universes.some((u) => u.protocol === 'sacn')) openAcn(); else if (acn) { closeSoon(acn); acn = null; }
    },

    /** One refresh. `frames`: Map(universe id → Buffer of up to 512 levels). Returns how many packets were made. */
    send(frames: Map<number, Buffer>): number {
      if (!on) return 0;
      let made = 0;
      for (const u of universes) {
        const data = frames.get(u.id);
        if (!data) continue;
        if (u.protocol === 'usb') { made += sendUsb(u, data); continue; }
        // 1–255, never 0 (in Art-Net a 0 says "ignore my sequence numbers")
        const n = u.protocol === 'artnet' ? ((seq.get(u.id) || 0) % 255) + 1 : ((seq.has(u.id) ? seq.get(u.id)! : -1) + 1) & 0xff;
        seq.set(u.id, n);
        const s = st(u.id);
        let packet: Buffer, to: string[], port: number, sock: nodeDgram.Socket | null;
        try {
          if (u.protocol === 'artnet') { packet = artnet.artDmx({ universe: u.address, sequence: n, data }); port = artPort; sock = art; to = u.host ? [u.host] : broadcastAddresses(interfaces()).map((i) => i.broadcast); }
          else { packet = sacn.dataPacket({ universe: u.address, cid, sequence: n, data, name }); port = sacnPort; sock = acn; to = [u.host || sacn.multicastAddress(u.address)]; }
        } catch (err) { fail(u, (err as Error).message); continue; }
        last.set(u.id, packet);
        made++; packets++; s.packets++;
        s.to = u.protocol === 'artnet' ? (u.host || 'broadcast') : (u.host || `multicast ${to[0]}`);
        if (dryRun || held) continue;           // (held back for a rehearsal: every packet is made, none leaves)
        if (!to.length) { fail(u, 'this computer is on no network to broadcast on'); continue; }
        if (!sock) continue;
        for (const address of to) {
          try { sock.send(packet, port, address, (err: ErrnoError | null) => { if (err) fail(u, err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH' ? `${address} cannot be reached from this computer` : err.message); else if (s.error) { s.error = ''; changed(); } }); }
          catch (err) { fail(u, (err as Error).message); }
        }
      }
      return made;
    },

    /** What the host has heard of a USB universe's interface (see the top of this file). */
    usbState(id: number, { state, name = '', detail = '' }: UsbState) {
      const p = usbPorts.get(id), u = universes.find((x) => x.id === id);
      if (!p || !u) return;                       // (an answer about a universe that has since been let go)
      const s = st(id);
      if (state === 'open') { p.state = 'open'; p.name = name; p.sent = null; s.error = ''; s.to = name || 'USB'; log(`universe ${id}: USB DMX on ${name || 'a serial port'}`); }
      else { p.state = 'failed'; p.askedAt = now(); s.to = ''; const why = detail || (state === 'lost' ? 'the USB DMX interface has gone' : 'the USB DMX interface could not be opened'); if (s.error !== why) { s.error = why; log(`universe ${id}: ${why}`); } }
      changed();
    },

    /** Every USB interface went at once (whoever had the ports is gone): each is asked for again. */
    usbGone(detail: string) {
      for (const [id, p] of usbPorts) { p.state = 'failed'; p.askedAt = now(); const s = st(id); s.to = ''; s.error = detail; }
      if (usbPorts.size) { log(`USB DMX: ${detail}`); changed(); }
    },

    /** Held back (an override, for rehearsing without the rig): packets are still built, and none is sent. */
    hold(on: unknown) { held = !!on; },

    /** The last packet built for a universe (a test run looks at this instead of a network). */
    last: (id: number) => last.get(id) || null,

    status() {
      const t = now();
      return {
        on, dryRun, held, packets,
        error: artError,
        listing: !!(art && artBound),
        universes: universes.map((u) => ({ id: u.id, protocol: u.protocol, address: u.address, host: u.host, ...st(u.id) })),
        nodes: [...nodes.values()].filter((n) => t - n.at <= NODE_GONE_MS).map((n) => ({ ip: n.ip, name: n.shortName || n.longName || n.ip, outputs: n.outputs })),
      };
    },

    close() {
      terminate(universes);
      closeArt();
      if (acn) { closeSoon(acn); acn = null; }
      for (const id of [...usbPorts.keys()]) closeUsb(id);
      universes = []; on = false;
    },
  };
}

export type LightOutput = ReturnType<typeof createLightOutput>;

export { createLightOutput, broadcastAddresses, cidFor, POLL_MS, USB_RETRY_MS };
