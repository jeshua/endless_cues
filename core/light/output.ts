/**
 * DMX out over the network: Art-Net and sACN, a packet per universe at every refresh.
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
 * `dryRun` (the app's test runs) builds every packet and keeps the last one, and opens no socket:
 * nothing reaches a network. Plain node, no Electron.
 */
import * as nodeDgram from 'dgram';
import * as os from 'os';
import * as crypto from 'crypto';
import * as artnet from './artnet';
import * as sacn from './sacn';

const POLL_MS = 3000;
const NODE_GONE_MS = 10000;

/** The broadcast address of each network this computer is on (IPv4, not loopback): [{ address, broadcast, mac }]. */
function broadcastAddresses(interfaces = os.networkInterfaces()) {
  const out = [];
  for (const list of Object.values(interfaces || {})) for (const i of list || []) {
    if (i.internal || (i.family !== 'IPv4' && i.family !== 4) || !i.netmask) continue;
    const a = i.address.split('.').map(Number), m = i.netmask.split('.').map(Number);
    out.push({ address: i.address, mac: i.mac || '', broadcast: a.map((x, k) => (x | (~m[k] & 0xff)) & 0xff).join('.') });
  }
  return out;
}

/** 16 bytes that name this sender for good (an sACN CID), made from any text that stays the same on this computer. */
function cidFor(text) {
  const b = crypto.createHash('sha256').update(`endless-cues:${text}`).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;      // shaped as a UUID, as receivers expect to print it
  return Buffer.from(b);
}

function createLightOutput({ dgram = nodeDgram, dryRun = false, log = () => {}, changed = () => {}, now = Date.now, cid = cidFor(os.hostname()), name = 'Endless Cues',
                             ports = {}, listenPort = null, listen = true, bindAddress = undefined, interfaces = () => os.networkInterfaces() } = {}) {
  const artPort = ports.artnet || artnet.PORT, sacnPort = ports.sacn || sacn.PORT;
  let universes = [];                 // [{ id, protocol, address, host }]
  let on = false;
  let held = false;                   // an override: packets are made and none is sent
  let art = null, artBound = false, artError = '';
  let acn = null;
  let poller = null;
  const seq = new Map();              // universe id -> the last sequence number sent
  const stat = new Map();             // universe id -> { packets, error, to }
  const last = new Map();             // universe id -> the last packet built
  const nodes = new Map();            // ip -> { ip, shortName, longName, outputs, at }
  let packets = 0;

  const st = (id) => { if (!stat.has(id)) stat.set(id, { packets: 0, error: '', to: '' }); return stat.get(id); };
  let own = null, ownAt = -Infinity;
  const mine = () => { if (now() - ownAt > 5000) { own = new Set(broadcastAddresses(interfaces()).map((i) => i.address)); ownAt = now(); } return own; };
  /** A socket that has just been given its last packets is closed a moment later, so they leave first. */
  const closeSoon = (sock) => { const t = setTimeout(() => { try { sock.close(); } catch { /* closed */ } }, 200); t.unref && t.unref(); };
  const fail = (u, why) => { const s = st(u.id); if (s.error !== why) { s.error = why; log(`universe ${u.id}: ${why}`); changed(); } };

  function heardArt(buf, from) {
    const kind = artnet.kindOf(buf);
    if (!kind || mine().has(from.address)) return;             // (our own broadcast, come back to us)
    if (kind === 'poll') {
      const me = broadcastAddresses(interfaces())[0] || { address: '0.0.0.0', mac: '' };
      const reply = artnet.artPollReply({ ip: me.address, mac: me.mac, shortName: name, longName: `${name} (show control)`, universes: universes.filter((u) => u.protocol === 'artnet' && u.address != null).map((u) => u.address) });
      try { art.send(reply, artPort, from.address, () => {}); } catch { /* closed */ }
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
    sock.on('error', (e) => {
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
    clearInterval(poller); poller = null;
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
  function terminate(list) {
    for (const u of list) {
      if (u.protocol !== 'sacn' || u.address == null || !seq.has(u.id)) continue;
      for (let i = 0; i < 3; i++) {
        const n = (seq.get(u.id) + 1) & 0xff; seq.set(u.id, n);
        const packet = sacn.dataPacket({ universe: u.address, cid, sequence: n, data: Buffer.alloc(0), name, terminated: true });
        last.set(u.id, packet);
        if (acn && !dryRun) { try { acn.send(packet, sacnPort, u.host || sacn.multicastAddress(u.address), () => {}); } catch { /* closed */ } }
      }
      seq.delete(u.id);
    }
  }

  return {
    configure(list = [], { on: want = false } = {}) {
      const next = (Array.isArray(list) ? list : []).filter((u) => u && u.address != null).map((u) => ({ id: u.id, protocol: u.protocol === 'sacn' ? 'sacn' : 'artnet', address: u.address, host: String(u.host || '').trim() }));
      const key = (u) => `${u.id}|${u.protocol}|${u.address}|${u.host}`;
      // whatever is no longer being sent as it was is let go of first
      terminate(universes.filter((u) => !want || !next.some((n) => key(n) === key(u))));
      for (const u of universes) if (!next.some((n) => n.id === u.id)) { stat.delete(u.id); last.delete(u.id); seq.delete(u.id); }
      universes = next; on = !!want;
      const live = on && universes.length > 0;
      if (live && universes.some((u) => u.protocol === 'artnet')) openArt(); else closeArt();
      if (live && universes.some((u) => u.protocol === 'sacn')) openAcn(); else if (acn) { closeSoon(acn); acn = null; }
    },

    /** One refresh. `frames`: Map(universe id → Buffer of up to 512 levels). Returns how many packets were made. */
    send(frames) {
      if (!on) return 0;
      let made = 0;
      for (const u of universes) {
        const data = frames.get(u.id);
        if (!data) continue;
        // 1–255, never 0 (in Art-Net a 0 says "ignore my sequence numbers")
        const n = u.protocol === 'artnet' ? ((seq.get(u.id) || 0) % 255) + 1 : ((seq.has(u.id) ? seq.get(u.id) : -1) + 1) & 0xff;
        seq.set(u.id, n);
        const s = st(u.id);
        let packet, to, port, sock;
        try {
          if (u.protocol === 'artnet') { packet = artnet.artDmx({ universe: u.address, sequence: n, data }); port = artPort; sock = art; to = u.host ? [u.host] : broadcastAddresses(interfaces()).map((i) => i.broadcast); }
          else { packet = sacn.dataPacket({ universe: u.address, cid, sequence: n, data, name }); port = sacnPort; sock = acn; to = [u.host || sacn.multicastAddress(u.address)]; }
        } catch (err) { fail(u, err.message); continue; }
        last.set(u.id, packet);
        made++; packets++; s.packets++;
        s.to = u.protocol === 'artnet' ? (u.host || 'broadcast') : (u.host || `multicast ${to[0]}`);
        if (dryRun || held) continue;           // (held back for a rehearsal: every packet is made, none leaves)
        if (!to.length) { fail(u, 'this computer is on no network to broadcast on'); continue; }
        if (!sock) continue;
        for (const address of to) {
          try { sock.send(packet, port, address, (err) => { if (err) fail(u, err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH' ? `${address} cannot be reached from this computer` : err.message); else if (s.error) { s.error = ''; changed(); } }); }
          catch (err) { fail(u, err.message); }
        }
      }
      return made;
    },

    /** Held back (an override, for rehearsing without the rig): packets are still built, and none is sent. */
    hold(on) { held = !!on; },

    /** The last packet built for a universe (a test run looks at this instead of a network). */
    last: (id) => last.get(id) || null,

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
      universes = []; on = false;
    },
  };
}

export { createLightOutput, broadcastAddresses, cidFor, POLL_MS };
