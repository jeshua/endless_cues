/**
 * Apple's binary property list, and the keyed archive (NSKeyedArchiver) that is usually inside one.
 *
 *   parseBinaryPlist(buffer)   → plain values; a UID (a reference inside a keyed archive) is a Uid
 *   unarchive(buffer)          → the archive's root object, references followed
 *
 * A QLab workspace is a keyed archive, with its cue lists as a second archive inside the first.
 * Only what such files use is read: no XML plists, no writing. Plain node, no dependency.
 *
 * An archived object comes out as { $type: 'ClassName', ...its keys }; the Foundation collections
 * come out as what they are (NSDictionary → an object, NSArray → an array, NSString → a string,
 * NSData → a Buffer). The object graph can be circular (a Fade cue holds its target cue): the same
 * archived object is always the same JavaScript object.
 */

class Uid { constructor(n) { this.uid = n; } }

function parseBinaryPlist(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 40 || buf.toString('latin1', 0, 6) !== 'bplist') throw new Error('not a binary property list');
  const t = buf.length - 32;
  const offSize = buf[t + 6], refSize = buf[t + 7];
  const count = Number(buf.readBigUInt64BE(t + 8)), top = Number(buf.readBigUInt64BE(t + 16)), table = Number(buf.readBigUInt64BE(t + 24));
  if (!offSize || !refSize || table + count * offSize > t) throw new Error('a damaged property list');
  const uint = (at, size) => { let n = 0; for (let i = 0; i < size; i++) n = n * 256 + buf[at + i]; return n; };
  const offsetOf = (i) => uint(table + i * offSize, offSize);
  const memo = new Array(count);
  const done = new Array(count).fill(false);

  function read(i) {
    if (i >= count) throw new Error('a damaged property list');
    if (done[i]) return memo[i];
    let at = offsetOf(i);
    const marker = buf[at++], kind = marker >> 4, low = marker & 0x0f;
    // a length of 15 means "the real length follows, as an integer object"
    const length = () => { if (low !== 15) return low; const m = buf[at++]; const size = 1 << (m & 0x0f); const n = uint(at, size); at += size; return n; };
    let v;
    switch (kind) {
      case 0x0: v = low === 0x8 ? false : low === 0x9 ? true : null; break;
      case 0x1: {
        const size = 1 << low;
        v = size === 8 ? Number(buf.readBigInt64BE(at)) : size === 16 ? Number(buf.readBigInt64BE(at + 8)) : uint(at, size);
        break;
      }
      case 0x2: v = low === 2 ? buf.readFloatBE(at) : buf.readDoubleBE(at); break;
      case 0x3: v = new Date(Date.UTC(2001, 0, 1) + buf.readDoubleBE(at) * 1000); break;
      case 0x4: { const n = length(); v = Buffer.from(buf.subarray(at, at + n)); break; }
      case 0x5: { const n = length(); v = buf.toString('latin1', at, at + n); break; }
      case 0x6: { const n = length(); const s = Buffer.from(buf.subarray(at, at + n * 2)); s.swap16(); v = s.toString('utf16le'); break; }
      case 0x8: v = new Uid(uint(at, low + 1)); break;
      case 0xa: case 0xc: {
        const n = length();
        v = []; memo[i] = v; done[i] = true;
        for (let k = 0; k < n; k++) v.push(read(uint(at + k * refSize, refSize)));
        return v;
      }
      case 0xd: {
        const n = length();
        v = {}; memo[i] = v; done[i] = true;
        for (let k = 0; k < n; k++) v[String(read(uint(at + k * refSize, refSize)))] = read(uint(at + (n + k) * refSize, refSize));
        return v;
      }
      default: throw new Error(`a property list with a kind of value this cannot read (0x${marker.toString(16)})`);
    }
    memo[i] = v; done[i] = true;
    return v;
  }
  return read(top);
}

const DICTS = new Set(['NSDictionary', 'NSMutableDictionary']);
const LISTS = new Set(['NSArray', 'NSMutableArray', 'NSSet', 'NSMutableSet', 'NSOrderedSet', 'NSMutableOrderedSet']);
const STRINGS = new Set(['NSString', 'NSMutableString']);
const DATAS = new Set(['NSData', 'NSMutableData']);

/** A keyed archive's root object. */
function unarchive(buf) {
  const plist = parseBinaryPlist(buf);
  if (!plist || plist.$archiver !== 'NSKeyedArchiver' || !Array.isArray(plist.$objects) || !plist.$top) throw new Error('not a keyed archive');
  const objects = plist.$objects;
  const memo = new Map();
  const className = (o) => { const c = o.$class instanceof Uid ? objects[o.$class.uid] : null; return c && c.$classname ? String(c.$classname) : 'Object'; };
  function value(v) {
    if (!(v instanceof Uid)) return v;
    if (memo.has(v.uid)) return memo.get(v.uid);
    const o = objects[v.uid];
    if (o === '$null' || o === undefined) return null;
    if (o === null || typeof o !== 'object' || Buffer.isBuffer(o) || o instanceof Date || Array.isArray(o)) return o;
    const cls = className(o);
    if (STRINGS.has(cls)) return String(o['NS.string'] ?? '');
    if (DATAS.has(cls)) return o['NS.data'] ?? Buffer.alloc(0);
    if (LISTS.has(cls)) { const a = []; memo.set(v.uid, a); for (const x of o['NS.objects'] || []) a.push(value(x)); return a; }
    if (DICTS.has(cls)) {
      const d = {}; memo.set(v.uid, d);
      const keys = o['NS.keys'] || [], vals = o['NS.objects'] || [];
      for (let i = 0; i < keys.length; i++) d[String(value(keys[i]))] = value(vals[i]);
      return d;
    }
    const out = { $type: cls }; memo.set(v.uid, out);
    for (const [k, x] of Object.entries(o)) if (k !== '$class') out[k] = value(x);
    return out;
  }
  return value(plist.$top.root);
}

module.exports = { parseBinaryPlist, unarchive, Uid };
