/**
 * Streaming ACN (sACN, ANSI E1.31) data packets, as bytes.
 *
 * One packet carries one universe's levels, in three layers one inside the other:
 *
 *   root layer      0–37     "ASC-E1.17", and the CID: 16 bytes that name the sender for good
 *   framing layer   38–114   the source's name, priority, a sequence number, the universe (1–63999)
 *   DMP layer       115–     the DMX start code (0) and up to 512 levels
 *
 * A full universe is 638 bytes. It goes to UDP port 5568, either to one receiver's address
 * (unicast) or to the universe's multicast group, 239.255.<high byte>.<low byte>. A source that
 * stops sends three packets with the "stream terminated" option, so receivers let go at once
 * instead of waiting out a timeout.
 *
 * Written from ANSI E1.31-2018. Pure: buffers in, buffers out.
 */
const PORT = 5568;
const ACN_ID = Buffer.from([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00]);   // "ASC-E1.17" and three nulls
const VECTOR_ROOT_DATA = 0x00000004;
const VECTOR_FRAMING_DATA = 0x00000002;
const VECTOR_DMP_SET_PROPERTY = 0x02;
const OPT_TERMINATED = 0x40;
const OPT_PREVIEW = 0x80;
const MAX_UNIVERSE = 63999;

/** The multicast group a universe is sent to. */
function multicastAddress(universe: number): string {
  check(universe);
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}
function check(universe: number) {
  if (!(Number.isInteger(universe) && universe >= 1 && universe <= MAX_UNIVERSE)) throw new Error(`sACN universe ${universe}: 1 to ${MAX_UNIVERSE}`);
}

/**
 * One E1.31 data packet. `cid`: 16 bytes, the same for as long as this sender is this sender.
 * `priority` 0–200 (100 is the default: where two sources send a universe, the higher wins).
 */
function dataPacket({ universe, cid, sequence = 0, data, name = 'Endless Cues', priority = 100, terminated = false, preview = false, sync = 0 }: { universe: number; cid: Buffer; sequence?: number; data?: ArrayLike<number> | null; name?: string; priority?: number; terminated?: boolean; preview?: boolean; sync?: number }): Buffer {
  check(universe);
  if (!Buffer.isBuffer(cid) || cid.length !== 16) throw new Error('sACN: the CID is 16 bytes');
  const levels = Buffer.from(data || []);
  if (levels.length > 512) throw new Error(`sACN carries up to 512 levels (got ${levels.length})`);
  const total = 126 + levels.length;
  const b = Buffer.alloc(total);
  // root layer
  b.writeUInt16BE(0x0010, 0);                         // preamble size
  b.writeUInt16BE(0x0000, 2);                         // postamble size
  ACN_ID.copy(b, 4);
  b.writeUInt16BE(0x7000 | (total - 16), 16);         // flags (0x7) and the length from here on
  b.writeUInt32BE(VECTOR_ROOT_DATA, 18);
  cid.copy(b, 22);
  // framing layer
  b.writeUInt16BE(0x7000 | (total - 38), 38);
  b.writeUInt32BE(VECTOR_FRAMING_DATA, 40);
  Buffer.from(String(name), 'utf8').copy(b, 44, 0, 63);   // the source name: 64 bytes, null-terminated
  b[108] = Math.max(0, Math.min(200, Math.round(priority)));
  b.writeUInt16BE(sync & 0xffff, 109);                // synchronisation address (0: none)
  b[111] = sequence & 0xff;
  b[112] = (terminated ? OPT_TERMINATED : 0) | (preview ? OPT_PREVIEW : 0);
  b.writeUInt16BE(universe, 113);
  // DMP layer
  b.writeUInt16BE(0x7000 | (total - 115), 115);
  b[117] = VECTOR_DMP_SET_PROPERTY;
  b[118] = 0xa1;                                      // address type and data type
  b.writeUInt16BE(0x0000, 119);                       // first property address
  b.writeUInt16BE(0x0001, 121);                       // address increment
  b.writeUInt16BE(levels.length + 1, 123);            // property count: the start code and the levels
  b[125] = 0x00;                                      // DMX start code
  levels.copy(b, 126);
  return b;
}

/** A data packet read back (tests): { universe, sequence, priority, name, terminated, cid, data } or null. */
function parse(buf: unknown) {
  if (!Buffer.isBuffer(buf) || buf.length < 126 || !buf.subarray(4, 16).equals(ACN_ID)) return null;
  if (buf.readUInt32BE(18) !== VECTOR_ROOT_DATA || buf.readUInt32BE(40) !== VECTOR_FRAMING_DATA) return null;
  const name = buf.subarray(44, 108); const end = name.indexOf(0);
  const count = buf.readUInt16BE(123) - 1;
  return { universe: buf.readUInt16BE(113), sequence: buf[111], priority: buf[108], name: name.subarray(0, end < 0 ? 64 : end).toString('utf8'),
           terminated: !!(buf[112] & OPT_TERMINATED), cid: Buffer.from(buf.subarray(22, 38)), data: Buffer.from(buf.subarray(126, 126 + count)) };
}

export { PORT, MAX_UNIVERSE, multicastAddress, dataPacket, parse };
