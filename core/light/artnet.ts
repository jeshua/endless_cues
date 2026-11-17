/**
 * Art-Net packets, as bytes: the three this app needs to be a controller that sends DMX.
 *
 *   ArtDmx        one universe's levels (what is sent, about 40 times a second)
 *   ArtPoll       "who is there?" (sent every few seconds, so the nodes on the network can be listed)
 *   ArtPollReply  "I am" (sent when someone else polls, so this app shows up in their list of devices)
 *
 * Written from the published Art-Net 4 specification (Artistic Licence, "Art-Net 4 Protocol
 * Release V1.4"). Everything is on UDP port 6454 (0x1936). A universe is a 15-bit "port address":
 * bits 14–8 the Net, 7–4 the Sub-Net, 3–0 the Universe; the first one is 0.
 *
 * Pure: buffers in, buffers out. Nothing here opens a socket (core/light/output.js does).
 * Art-Net™ Designed by and Copyright Artistic Licence.
 */
const PORT = 6454;
const ID = Buffer.from('Art-Net\0', 'latin1');
const OP: Record<string, number> = { poll: 0x2000, pollReply: 0x2100, dmx: 0x5000 };
const PROTOCOL = 14;
const MAX_UNIVERSE = 32767;

function header(op: number, length: number): Buffer {
  const b = Buffer.alloc(length);
  ID.copy(b, 0);
  b.writeUInt16LE(op, 8);                  // the OpCode is the one field sent low byte first
  return b;
}

/**
 * ArtDmx. `universe` is the 15-bit port address; `sequence` 1–255 lets a receiver put packets that
 * arrive out of order back in order (0 says "no sequence"); `data` is 1–512 levels and is sent
 * padded to an even length, as the specification asks.
 */
function artDmx({ universe = 0, sequence = 0, physical = 0, data }: { universe?: number; sequence?: number; physical?: number; data?: ArrayLike<number> | null }): Buffer {
  if (!(Number.isInteger(universe) && universe >= 0 && universe <= MAX_UNIVERSE)) throw new Error(`Art-Net universe ${universe}: 0 to ${MAX_UNIVERSE}`);
  const src = Buffer.from(data || []);
  if (src.length < 1 || src.length > 512) throw new Error(`ArtDmx carries 1 to 512 levels (got ${src.length})`);
  const n = src.length + (src.length % 2);
  const b = header(OP.dmx, 18 + n);
  b[10] = 0; b[11] = PROTOCOL;             // ProtVerHi, ProtVerLo
  b[12] = sequence & 0xff;
  b[13] = physical & 0xff;
  b[14] = universe & 0xff;                 // SubUni: Sub-Net in the high nibble, Universe in the low
  b[15] = (universe >> 8) & 0x7f;          // Net
  b.writeUInt16BE(n, 16);                  // the length is sent high byte first
  src.copy(b, 18);
  return b;
}

/** ArtPoll. Flags 0: reply only to a poll (no unsolicited replies, no diagnostics). */
function artPoll({ flags = 0, priority = 0 } = {}) {
  const b = header(OP.poll, 14);
  b[10] = 0; b[11] = PROTOCOL;
  b[12] = flags & 0xff;
  b[13] = priority & 0xff;
  return b;
}

const put = (b: Buffer, text: unknown, at: number, size: number) => { b.write(String(text || '').slice(0, size - 1), at, size - 1, 'latin1'); };   // (a name is null-terminated: one byte fewer than its field)

/**
 * ArtPollReply: this app, described as a controller (Style 0x01) that puts DMX onto the network.
 * A reply has room for four ports; `universes` (port addresses) beyond the first four that share
 * its Net and Sub-Net are not declared (a node needs them only to list what a controller sends).
 */
function artPollReply({ ip = '0.0.0.0', mac = '00:00:00:00:00:00', shortName = 'Endless Cues', longName = 'Endless Cues', report = '', universes = [] as number[], version = 1 } = {}): Buffer {
  const b = header(OP.pollReply, 239);
  const quad = String(ip).split('.').map((x) => Number(x) & 0xff);
  for (let i = 0; i < 4; i++) b[10 + i] = quad[i] || 0;
  b.writeUInt16LE(PORT, 14);               // the port, low byte first (0x36 0x19)
  b.writeUInt16BE(version & 0xffff, 16);   // VersInfo
  const first = universes.length ? universes[0] : 0;
  b[18] = (first >> 8) & 0x7f;             // NetSwitch
  b[19] = (first >> 4) & 0x0f;             // SubSwitch
  b.writeUInt16BE(0x00ff, 20);             // Oem: 0x00ff, "OemUnknown" (this app has no registered code)
  b[22] = 0;                               // Ubea
  b[23] = 0xd0;                            // Status1: indicators normal, port addresses set on the device itself (here: in the app)
  b.writeUInt16LE(0x7ff0, 24);             // EstaMan: 0x7ff0, the code for prototypes (no ESTA id of its own)
  put(b, shortName, 26, 18);
  put(b, longName, 44, 64);
  put(b, report || '#0001 [0000] Endless Cues', 108, 64);
  const mine = universes.filter((u) => (u >> 4) === (first >> 4)).slice(0, 4);
  b.writeUInt16BE(mine.length, 172);       // NumPorts
  for (let i = 0; i < mine.length; i++) {
    b[174 + i] = 0x40;                     // PortTypes: DMX512, and it can input onto the Art-Net network
    b[178 + i] = 0x80;                     // GoodInput: data received (this port is sending)
    b[186 + i] = mine[i] & 0x0f;           // SwIn: the low nibble of the port address
  }
  b[200] = 0x01;                           // Style: StController
  const hw = String(mac).split(/[:-]/).map((x) => parseInt(x, 16) & 0xff);
  for (let i = 0; i < 6; i++) b[201 + i] = hw[i] || 0;
  for (let i = 0; i < 4; i++) b[207 + i] = quad[i] || 0;     // BindIp
  b[211] = 1;                              // BindIndex: the root device
  b[212] = 0x08;                           // Status2: 15-bit port addresses (Art-Net 3 and later)
  return b;
}

/** What kind of Art-Net packet a buffer is: 'poll' | 'pollReply' | 'dmx' | 'other' | null (not Art-Net). */
function kindOf(buf: unknown): string | null {
  if (!Buffer.isBuffer(buf) || buf.length < 10 || !buf.subarray(0, 8).equals(ID)) return null;
  const op = buf.readUInt16LE(8);
  return Object.keys(OP).find((k) => OP[k] === op) || 'other';
}

const str = (buf: Buffer, at: number, size: number) => { const s = buf.subarray(at, at + size); const end = s.indexOf(0); return s.subarray(0, end < 0 ? size : end).toString('latin1').trim(); };

/** A node's answer to a poll, as the list of devices shows it. null when the buffer is not one. */
function parsePollReply(buf: Buffer) {
  if (kindOf(buf) !== 'pollReply' || buf.length < 207) return null;
  const ports = Math.min(4, buf.readUInt16BE(172));
  const base = ((buf[18] & 0x7f) << 8) | ((buf[19] & 0x0f) << 4);
  const outputs: number[] = [];
  for (let i = 0; i < ports; i++) if (buf[174 + i] & 0x80) outputs.push(base | (buf[190 + i] & 0x0f));    // a port that outputs DMX from the network: its SwOut
  return { ip: [...buf.subarray(10, 14)].join('.'), shortName: str(buf, 26, 18), longName: str(buf, 44, 64), report: str(buf, 108, 64), style: buf[200], ports, outputs };
}

/** An ArtDmx packet read back (tests, and the monitor): { universe, sequence, data } or null. */
function parseDmx(buf: Buffer) {
  if (kindOf(buf) !== 'dmx' || buf.length < 20) return null;
  const n = buf.readUInt16BE(16);
  return { universe: ((buf[15] & 0x7f) << 8) | buf[14], sequence: buf[12], physical: buf[13], data: Buffer.from(buf.subarray(18, 18 + n)) };
}

export { PORT, OP, MAX_UNIVERSE, artDmx, artPoll, artPollReply, kindOf, parsePollReply, parseDmx };
