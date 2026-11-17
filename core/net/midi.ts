/**
 * MIDI messages as a person writes them, and as bytes, both ways, with no dependency.
 *
 *   parseText('note 60 100 ch 2')   -> { kind: 'note', number: 60, value: 100, channel: 2 }
 *   parseText('msc go 12 list 1')   -> { kind: 'msc', command: 'go', cue: '12', list: '1' }
 *   encode(msg)                     -> [0x91, 60, 100]
 *   decode([0x91, 60, 100])         -> { kind: 'note', number: 60, value: 100, channel: 2 }
 *   toText(msg)                     -> 'note 60 100 ch 2'
 *   matches(trigger, msg)           -> whether an incoming message is the one a trigger waits for
 *
 * The forms: note <n> [velocity] · note off <n> · pc <n> · cc <n> <value> · key pressure <n> <value> ·
 * pressure <value> (the whole channel's) · bend <0–16383> (8192 is the middle) · msc <command> [cue] · raw hex bytes.
 * "ch <1–16>" anywhere sets the channel (1 when left out). Numbers are the ones on the wire, 0–127.
 * MIDI Show Control: "list <n>", "dev <0–127>" (the device ID; 127, every device, when left out), the kind
 * of device (lighting when left out) and, for a timed go, "time hh:mm:ss:ff". Nothing here touches a MIDI port:
 * the app's audio window does that.
 *
 *   valueOf(msg), withValue(msg, v), valueMax(msg)   the one number of a message that can fade (a controller's
 *                                                    value, a pressure, a bend), for a MIDI cue that moves it
 */

const MSC_COMMANDS = { go: 0x01, stop: 0x02, resume: 0x03, 'timed-go': 0x04, load: 0x05, fire: 0x07, 'all-off': 0x08, restore: 0x09, reset: 0x0a, 'go-off': 0x0b };
const MSC_FORMATS = { lighting: 0x01, 'moving-lights': 0x02, sound: 0x10, machinery: 0x20, video: 0x30, projection: 0x40, all: 0x7f };
const nameOf = (table, byte) => Object.keys(table).find((k) => table[k] === byte);

function parseText(text) {
  const words = String(text || '').trim().toLowerCase().replace(/\bch(\d+)\b/g, 'ch $1').replace(/\bnote\s*off\b|\bnoteoff\b/, 'noteoff')
    .replace(/\b(key|poly)\s*(pressure|aftertouch)\b|\baftertouch\b/, 'kp').replace(/\b(channel\s*)?pressure\b/, 'cp').replace(/\bpitch\s*bend\b|\bpitchbend\b/, 'bend')
    .replace(/\btimed[\s-]*go\b/, 'timed-go').split(/[\s,]+/).filter(Boolean);
  if (!words.length) throw new Error('no MIDI message');
  // raw bytes
  if (words[0] !== 'cc' && words.every((w) => /^(0x)?[0-9a-f]{2}$/.test(w))) {
    const bytes = words.map((w) => parseInt(w.replace(/^0x/, ''), 16));
    if (bytes[0] < 0x80) throw new Error('raw MIDI starts with a status byte (80–FF)');
    if (bytes[0] === 0xf0 && bytes[bytes.length - 1] !== 0xf7) throw new Error('SysEx starts with F0 and ends with F7');
    return { kind: 'raw', bytes };
  }
  const take = (key, max, what) => {
    const i = words.indexOf(key);
    if (i < 0) return undefined;
    const v = words[i + 1];
    if (!/^\d+$/.test(v || '') || Number(v) > max) throw new Error(`${key} needs ${what}`);
    words.splice(i, 2);
    return Number(v);
  };
  const channel = take('ch', 16, 'a channel, 1 to 16');
  if (channel === 0) throw new Error('channels are 1 to 16');
  const kind = { note: 'note', noteoff: 'noteoff', pc: 'pc', program: 'pc', cc: 'cc', control: 'cc', kp: 'kp', cp: 'cp', bend: 'bend', pb: 'bend', msc: 'msc' }[words.shift()];
  if (!kind) throw new Error('a MIDI message starts with note, note off, pc, cc, key pressure, pressure, bend or msc (or is raw bytes in hex)');
  const withCh = (m) => (channel ? { ...m, channel } : m);
  if (kind === 'msc') {
    const device = take('dev', 127, 'a device ID, 0 to 127');
    const li = words.indexOf('list');
    let list;
    if (li >= 0) { list = words[li + 1]; if (!/^[\d.]+$/.test(list || '')) throw new Error('list needs a number'); words.splice(li, 2); }
    const ti = words.indexOf('time');
    let time;
    if (ti >= 0) { const m = /^(\d{1,2}):(\d{1,2}):(\d{1,2})[:;.](\d{1,2})$/.exec(words[ti + 1] || ''); if (!m || m[1] > 23 || m[2] > 59 || m[3] > 59 || m[4] > 29) throw new Error('time needs hours:minutes:seconds:frames (00:00:05:00)'); time = m.slice(1).map(Number).join(':'); words.splice(ti, 2); }
    const fi = words.findIndex((w) => w in MSC_FORMATS);
    const format = fi >= 0 ? words.splice(fi, 1)[0] : undefined;
    const command = words.shift();
    if (!(command in MSC_COMMANDS)) throw new Error(`msc needs a command: ${Object.keys(MSC_COMMANDS).join(', ')}`);
    const cue = words.shift();
    if (cue !== undefined && !/^[\d.]+$/.test(cue)) throw new Error('a show-control cue number is digits and points (12, 12.5)');
    if (words.length) throw new Error(`not understood: ${words.join(' ')}`);
    if (time !== undefined && command !== 'timed-go') throw new Error('only a timed go has a time');
    return { kind, command, ...(cue !== undefined ? { cue } : {}), ...(list !== undefined ? { list } : {}), ...(time !== undefined ? { time } : {}), ...(device !== undefined ? { device } : {}), ...(format ? { format } : {}) };
  }
  // a pitch bend is one fourteen-bit number; the whole channel's pressure is one seven-bit one
  if (kind === 'bend' || kind === 'cp') {
    const max = kind === 'bend' ? 16383 : 127;
    if (words.length !== 1 || !/^\d+$/.test(words[0]) || Number(words[0]) > max) throw new Error(kind === 'bend' ? 'bend <0 to 16383> (8192 is no bend)' : 'pressure <0 to 127>');
    return withCh({ kind, value: Number(words[0]) });
  }
  const nums = words.map((w) => (/^\d+$/.test(w) && Number(w) <= 127 ? Number(w) : NaN));
  if (nums.some(Number.isNaN)) throw new Error('MIDI numbers are 0 to 127');
  if (nums.length < 1 || nums.length > 2 || (kind === 'pc' && nums.length > 1)) throw new Error({ note: 'note <number> [velocity]', noteoff: 'note off <number>', pc: 'pc <program>', cc: 'cc <controller> <value>', kp: 'key pressure <note> <value>' }[kind]);
  return withCh({ kind, number: nums[0], ...(nums.length > 1 ? { value: nums[1] } : {}) });
}

function encode(msg) {
  const ch = (Number(msg.channel) || 1) - 1;
  switch (msg.kind) {
    case 'note': return [0x90 | ch, msg.number, msg.value === undefined ? 100 : msg.value];
    case 'noteoff': return [0x80 | ch, msg.number, msg.value === undefined ? 0 : msg.value];
    case 'pc': return [0xc0 | ch, msg.number];
    case 'cc': if (msg.value === undefined) throw new Error('cc <controller> <value>'); return [0xb0 | ch, msg.number, msg.value];
    case 'kp': if (msg.value === undefined) throw new Error('key pressure <note> <value>'); return [0xa0 | ch, msg.number, msg.value];
    case 'cp': return [0xd0 | ch, msg.value];
    case 'bend': return [0xe0 | ch, msg.value & 0x7f, (msg.value >> 7) & 0x7f];      // the low seven bits go first
    case 'msc': {
      const ascii = (s) => [...String(s)].map((c) => c.charCodeAt(0));
      // (a timed go carries a time before its cue number: hours, minutes, seconds, frames and fractions of a frame)
      const data = msg.command === 'fire' ? [Number(msg.cue) & 0x7f]
        : [...(msg.command === 'timed-go' ? [...String(msg.time || '0:0:0:0').split(':').map(Number), 0] : []),
           ...(msg.cue !== undefined ? ascii(msg.cue) : []), ...(msg.list !== undefined ? [0, ...ascii(msg.list)] : [])];
      return [0xf0, 0x7f, msg.device === undefined ? 0x7f : msg.device, 0x02, MSC_FORMATS[msg.format || 'lighting'], MSC_COMMANDS[msg.command], ...data, 0xf7];
    }
    case 'raw': return [...msg.bytes];
    default: throw new Error('not a MIDI message');
  }
}

function decode(bytes) {
  const b = [...(bytes || [])];
  if (!b.length || b[0] < 0x80) return null;
  const hi = b[0] & 0xf0, channel = (b[0] & 0x0f) + 1;
  if (hi === 0x90 && b[2] > 0) return { kind: 'note', number: b[1], value: b[2], channel };
  if (hi === 0x90 || hi === 0x80) return { kind: 'noteoff', number: b[1], value: b[2] || 0, channel };
  if (hi === 0xc0) return { kind: 'pc', number: b[1], channel };
  if (hi === 0xb0) return { kind: 'cc', number: b[1], value: b[2], channel };
  if (hi === 0xa0) return { kind: 'kp', number: b[1], value: b[2], channel };
  if (hi === 0xd0) return { kind: 'cp', value: b[1], channel };
  if (hi === 0xe0) return { kind: 'bend', value: (b[1] & 0x7f) | ((b[2] & 0x7f) << 7), channel };
  if (b[0] === 0xf0 && b[1] === 0x7f && b[3] === 0x02 && b.length >= 7) {
    const command = nameOf(MSC_COMMANDS, b[5]);
    if (command) {
      const timed = command === 'timed-go' && b.length >= 12;
      const data = b.slice(timed ? 11 : 6, -1), cut = data.indexOf(0);
      const time = timed && b.slice(6, 10).some(Boolean) ? [b[6] & 31, b[7], b[8], b[9] & 31].join(':') : undefined;
      const text = (a) => String.fromCharCode(...a);
      const cue = command === 'fire' ? (data.length ? String(data[0]) : undefined) : text(cut < 0 ? data : data.slice(0, cut)) || undefined;
      const rest = cut < 0 ? [] : data.slice(cut + 1), cut2 = rest.indexOf(0);
      const list = text(cut2 < 0 ? rest : rest.slice(0, cut2)) || undefined;
      return { kind: 'msc', command, ...(cue !== undefined ? { cue } : {}), ...(list !== undefined ? { list } : {}), ...(time !== undefined ? { time } : {}), device: b[2], format: nameOf(MSC_FORMATS, b[4]) || 'all' };
    }
  }
  return { kind: 'raw', bytes: b };
}

const hex = (bytes) => bytes.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/** A message as a person reads it. `brief`: as a trigger is written (no velocity, no device). */
function toText(msg, { brief = false } = {}) {
  if (!msg) return '';
  const ch = msg.channel ? ` ch ${msg.channel}` : '';
  switch (msg.kind) {
    case 'note': return `note ${msg.number}${!brief && msg.value !== undefined ? ` ${msg.value}` : ''}${ch}`;
    case 'noteoff': return `note off ${msg.number}${ch}`;
    case 'pc': return `pc ${msg.number}${ch}`;
    case 'cc': return `cc ${msg.number}${msg.value !== undefined ? ` ${msg.value}` : ''}${ch}`;
    case 'kp': return `key pressure ${msg.number}${msg.value !== undefined ? ` ${msg.value}` : ''}${ch}`;
    case 'cp': return `pressure ${msg.value}${ch}`;
    case 'bend': return `bend ${msg.value}${ch}`;
    case 'msc': return `msc ${msg.command}${msg.cue !== undefined ? ` ${msg.cue}` : ''}${msg.list !== undefined ? ` list ${msg.list}` : ''}${!brief && msg.time !== undefined ? ` time ${msg.time.split(':').map((x) => x.padStart(2, '0')).join(':')}` : ''}${!brief && msg.device !== undefined && msg.device !== 0x7f ? ` dev ${msg.device}` : ''}${!brief && msg.format && msg.format !== 'lighting' ? ` ${msg.format}` : ''}`;
    default: return hex(msg.bytes || []);
  }
}

/** Whether `msg` (decoded, as it arrived) is what `trigger` (parsed from a cue's text) waits for: what the
 *  trigger leaves out matches anything. */
function matches(trigger, msg) {
  if (!trigger || !msg || trigger.kind !== msg.kind) return false;
  if (trigger.kind === 'raw') return hex(trigger.bytes) === hex(msg.bytes);
  if (trigger.kind === 'msc') return trigger.command === msg.command && (trigger.cue === undefined || trigger.cue === msg.cue) && (trigger.list === undefined || trigger.list === msg.list);
  return trigger.number === msg.number && (trigger.channel === undefined || trigger.channel === msg.channel)
    && (trigger.value === undefined || trigger.kind === 'noteoff' || trigger.value === msg.value);
}

/** The one number of a message that a MIDI cue can move over a time: a controller's or a key pressure's value, the
 *  channel's pressure, a bend. `valueMax` is how high it goes (0 for a message with nothing to fade). */
const valueMax = (msg) => (!msg ? 0 : msg.kind === 'bend' ? 16383 : ['cc', 'kp', 'cp'].includes(msg.kind) ? 127 : 0);
const valueOf = (msg) => (valueMax(msg) ? Number(msg.value) || 0 : null);
const withValue = (msg, v) => ({ ...msg, value: Math.max(0, Math.min(valueMax(msg), Math.round(v))) });

export { parseText, encode, decode, toText, matches, hex, valueOf, withValue, valueMax, MSC_COMMANDS, MSC_FORMATS };
