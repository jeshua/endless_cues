/**
 * Payloads that are not OSC: a line of text or a string of bytes, for equipment with a protocol of
 * its own (a projector's "%1POWR 1\r", a video switcher's hex command).
 *
 *   text('PLAY 3\r\n')      -> Buffer   (escapes: \n \r \t \0 \\ \e, and \x41 for any byte)
 *   hex('FE 01 0a,0x10')    -> Buffer   (pairs of hex digits; spaces, commas and "0x" are ignored)
 *
 * Text is sent as UTF-8. Nothing is added: a device that wants a line ending gets one only if the
 * message says "\r" or "\n".
 */
const ESCAPES = { n: 0x0a, r: 0x0d, t: 0x09, 0: 0x00, e: 0x1b, '\\': 0x5c };

function text(message) {
  const s = String(message), parts = [];
  let plain = '';
  const flush = () => { if (plain) { parts.push(Buffer.from(plain, 'utf8')); plain = ''; } };
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i + 1 >= s.length) { plain += s[i]; continue; }
    const c = s[i + 1];
    if (c === 'x' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 2, i + 4))) { flush(); parts.push(Buffer.from([parseInt(s.slice(i + 2, i + 4), 16)])); i += 3; }
    else if (c in ESCAPES) { flush(); parts.push(Buffer.from([ESCAPES[c]])); i += 1; }
    else plain += s[i];                    // a backslash before anything else is a backslash
  }
  flush();
  return Buffer.concat(parts);
}

function hex(message) {
  const digits = String(message).replace(/0x/gi, '').replace(/[\s,:]/g, '');
  if (!digits) throw new Error('no bytes to send');
  if (/[^0-9a-fA-F]/.test(digits)) throw new Error(`not hex: ${digits.match(/[^0-9a-fA-F]/)[0]} (only 0-9 and A-F)`);
  if (digits.length % 2) throw new Error('an odd number of hex digits: each byte is two');
  return Buffer.from(digits, 'hex');
}

/** The bytes a Network cue's message becomes: { packet, osc } (osc: it is an OSC packet, to be framed on TCP). */
function packetFor(message, format = 'osc') {
  if (format === 'text') { const packet = text(message); if (!packet.length) throw new Error('no text to send'); return { packet, osc: false }; }
  if (format === 'hex') return { packet: hex(message), osc: false };
  const osc = require('./osc');
  const m = osc.parseText(message);
  return { packet: osc.encode(m.address, m.args), osc: true };
}

export { text, hex, packetFor };
