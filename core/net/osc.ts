/**
 * OSC 1.0 messages, both ways, with no dependency.
 *
 *   encode('/eos/cue/1/12/fire')            -> Buffer
 *   encode('/mixer/ch/3/level', [-6.5])     -> Buffer
 *   parseText('/led/all/off 1')             -> { address, args }   (a Network cue's text)
 *   decode(buffer)                          -> { address, args }   (bundles: the first message of each)
 *
 * Text arguments are typed the way QLab types them: an integer is an int32,
 * a number with a point is a float32, "quoted text" or anything else is a string.
 * A prefix forces the type when a device is particular: i:1  f:1  d:1  s:1  s:"two words".
 * OSC 1.1's arguments with no value are written as QLab writes them: \T true, \F false, \I impulse, \N null.
 */

const pad = (b) => Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]);
const str = (s) => pad(Buffer.from(String(s), 'utf8'));

/** "/address 1 2.5 word "two words"" -> { address, args } */
function parseText(text) {
  const parts = String(text).trim().match(/(?:[ifsd]:)?"[^"]*"|\S+/g) || [];
  const address = parts.shift();
  if (!address || !address.startsWith('/')) throw new Error(`not an OSC address: ${text}`);
  const unquote = (p) => (p.startsWith('"') && p.endsWith('"') && p.length > 1 ? p.slice(1, -1) : p);
  const args = parts.map((p) => {
    const forced = p.match(/^([ifsd]):([\s\S]*)$/);
    if (forced) {
      if (forced[1] === 's') return { type: 's', value: unquote(forced[2]) };
      const n = Number(forced[2]);
      if (!Number.isFinite(n)) throw new Error(`${p}: not a number`);
      return { type: forced[1], value: forced[1] === 'i' ? Math.round(n) : n };
    }
    if (/^\\[TFIN]$/.test(p)) return { type: p[1] };
    if (/^-?\d+$/.test(p)) return { type: 'i', value: parseInt(p, 10) };
    if (/^-?(\d+\.\d*|\.\d+|\d+)(e-?\d+)?$/i.test(p)) return { type: 'f', value: parseFloat(p) };
    return { type: 's', value: p.startsWith('"') && p.endsWith('"') && p.length > 1 ? p.slice(1, -1) : p };
  });
  return { address, args };
}

function encode(address, args = []) {
  if (args.length === 0 && /\s/.test(address.trim())) ({ address, args } = parseText(address));
  let tags = ',';
  const bufs = [];
  for (const raw of args) {
    const a = raw && typeof raw === 'object' && 'type' in raw ? raw
      : typeof raw === 'number' ? (Number.isInteger(raw) ? { type: 'i', value: raw } : { type: 'f', value: raw })
      : typeof raw === 'boolean' ? { type: raw ? 'T' : 'F' } : { type: 's', value: String(raw) };
    tags += a.type;
    if (a.type === 'i') { const b = Buffer.alloc(4); b.writeInt32BE(a.value); bufs.push(b); }
    else if (a.type === 'f') { const b = Buffer.alloc(4); b.writeFloatBE(a.value); bufs.push(b); }
    else if (a.type === 's') bufs.push(str(a.value));
    else if (a.type === 'd') { const b = Buffer.alloc(8); b.writeDoubleBE(a.value); bufs.push(b); }
    else if (a.type === 'h') { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(a.value)); bufs.push(b); }
    else if (a.type === 'b') { const data = Buffer.from(a.value); const n = Buffer.alloc(4); n.writeInt32BE(data.length); bufs.push(n, data, Buffer.alloc((4 - (data.length % 4)) % 4)); }
  }
  return Buffer.concat([str(address), str(tags), ...bufs]);
}

function decode(buf) {
  const readStr = (at) => {
    let end = at;
    while (end < buf.length && buf[end] !== 0) end++;
    return { value: buf.toString('utf8', at, end), next: (end + 4) & ~3 };
  };
  const head = readStr(0);
  if (head.value === '#bundle') {
    // time tag (8), then [size, element]…: return the first message
    let at = 16;
    while (at + 4 <= buf.length) {
      const size = buf.readInt32BE(at);
      const m = decode(buf.subarray(at + 4, at + 4 + size));
      if (m) return m;
      at += 4 + size;
    }
    return null;
  }
  if (!head.value.startsWith('/')) return null;
  const args = [];
  if (head.next >= buf.length) return { address: head.value, args };
  const tags = readStr(head.next);
  let at = tags.next;
  for (const t of tags.value.slice(1)) {
    if (t === 'i') { args.push(buf.readInt32BE(at)); at += 4; }
    else if (t === 'f') { args.push(buf.readFloatBE(at)); at += 4; }
    else if (t === 'd') { args.push(buf.readDoubleBE(at)); at += 8; }
    else if (t === 'h') { args.push(Number(buf.readBigInt64BE(at))); at += 8; }
    else if (t === 'b') { const n = buf.readInt32BE(at); args.push(buf.subarray(at + 4, at + 4 + n)); at += 4 + ((n + 3) & ~3); }
    else if (t === 'I') args.push(Infinity);
    else if (t === 's') { const s = readStr(at); args.push(s.value); at = s.next; }
    else if (t === 'T') args.push(true);
    else if (t === 'F') args.push(false);
    else if (t === 'N') args.push(null);
    else break;                          // a type this does not read: stop there
  }
  // (what each argument was on the wire, for a monitor to tell a float 1.0 from an int 1)
  return Object.defineProperty({ address: head.value, args }, 'types', { value: tags.value.slice(1), enumerable: false });
}

/** Every message in a packet: one, or all of a bundle's (bundles inside bundles too), in order. */
function decodeAll(buf) {
  if (buf.length >= 16 && buf.toString('latin1', 0, 7) === '#bundle') {
    const out = [];
    let at = 16;
    while (at + 4 <= buf.length) {
      const size = buf.readInt32BE(at);
      if (size <= 0 || at + 4 + size > buf.length) break;
      out.push(...decodeAll(buf.subarray(at + 4, at + 4 + size)));
      at += 4 + size;
    }
    return out;
  }
  const m = decode(buf);
  return m ? [m] : [];
}

/** A message as a person reads it: "/address 1 2.5 word". */
function toText(msg) {
  const types = msg.types || '';
  return [msg.address, ...msg.args.map((a, i) => ((types[i] === 'f' || types[i] === 'd') && Number.isInteger(a) ? `${a}.0` : typeof a === 'string' ? (/\s/.test(a) || a === '' ? `"${a}"` : a) : Buffer.isBuffer(a) ? `<${a.length} bytes>` : 'TFNI'.includes(types[i] || '-') ? `\\${types[i]}` : typeof a === 'number' && !Number.isInteger(a) ? String(Math.round(a * 10000) / 10000) : String(a)))].join(' ');
}

/** Whether an OSC address matches a pattern ("*", "?", "[abc]", "{a,b}", as OSC 1.0 defines them). */
function matches(pattern, address) {
  if (pattern === address) return true;
  const re = '^' + pattern.replace(/[.+^$()|\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\{([^}]*)\}/g, (_m, alts) => `(?:${alts.split(',').join('|')})`).replace(/\[!/g, '[^') + '$';
  try { return new RegExp(re).test(address); } catch { return false; }
}

// ── OSC over TCP: a stream has no packet edges, so each message is framed ─────────
// SLIP (OSC 1.1; what Eos, QLab and most current gear use) wraps a packet in END bytes; the older
// form (OSC 1.0) puts a 4-byte length before it.
const END = 0xc0, ESC = 0xdb, ESC_END = 0xdc, ESC_ESC = 0xdd;
function frame(packet, framing = 'slip') {
  if (framing === 'length') { const n = Buffer.alloc(4); n.writeInt32BE(packet.length); return Buffer.concat([n, packet]); }
  const out = [END];
  for (const b of packet) { if (b === END) out.push(ESC, ESC_END); else if (b === ESC) out.push(ESC, ESC_ESC); else out.push(b); }
  out.push(END);
  return Buffer.from(out);
}
/** A reader for one TCP connection: feed it chunks, get whole packets back. */
function deframer(framing = 'slip') {
  let held = Buffer.alloc(0);
  return (chunk) => {
    held = Buffer.concat([held, chunk]);
    const packets = [];
    if (framing === 'length') {
      while (held.length >= 4) { const n = held.readInt32BE(0); if (n < 0 || n > 1 << 20) { held = Buffer.alloc(0); break; } if (held.length < 4 + n) break; packets.push(held.subarray(4, 4 + n)); held = held.subarray(4 + n); }
      return packets;
    }
    let start = 0;
    for (let i = 0; i < held.length; i++) {
      if (held[i] !== END) continue;
      if (i > start) {
        const raw = held.subarray(start, i), out = [];
        for (let k = 0; k < raw.length; k++) { if (raw[k] === ESC && k + 1 < raw.length) { out.push(raw[k + 1] === ESC_END ? END : ESC); k++; } else out.push(raw[k]); }
        packets.push(Buffer.from(out));
      }
      start = i + 1;
    }
    held = held.subarray(start);
    if (held.length > 1 << 20) held = Buffer.alloc(0);       // not OSC: do not grow without end
    return packets;
  };
}

export { encode, decode, decodeAll, parseText, toText, matches, frame, deframer };
