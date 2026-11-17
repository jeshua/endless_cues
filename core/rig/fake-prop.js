/**
 * A stand-in prop: it speaks the kit's protocol (docs/specs/15-assistant-and-rig.md, section 6.1) to the
 * letter over real UDP, so the app can be seen working with no hardware.
 *
 *   const prop = createFakeProp({ name: 'lantern', kind: 'light', port: 53100 });
 *   await prop.start();          → { port }   (port 0: one the system picks, for a test)
 *   prop.heard                   [{ at, text, from }]: every message it acted on, in order
 *   prop.state()                 the one word it reports: own | look3 | breathe | on | off …
 *   prop.set({ battery, signal })
 *   prop.silent(true)            hears and answers nothing (a prop with a flat battery)
 *   prop.stop()
 *
 * It answers /ec/hello with /ec/here, obeys every command by changing its state, and acts once on a message
 * that ends with an id ("#a41f07"): a repeat is counted (`repeats`) and ignored, which is what a device's
 * `resend` relies on. `onMessage({ text, from, repeat, hello, did })` is told of everything that arrives.
 *
 * It is the prop for the unit tests (loopback sockets), for `ec fake-prop`, and for trying the Rig by hand.
 */
const dgram = require('dgram');
const osc = require('../net/osc');

const PORT = 53100;
const EFFECTS = ['steady', 'breathe', 'pulse', 'flicker'];

function createFakeProp({ name = 'lantern', kind = 'light', port = 0, host = '127.0.0.1', fw = '1.0', battery = 87, signal = -52, onMessage = null } = {}) {
  let sock = null, bound = 0, quiet = false;
  const started = Date.now();
  const heard = [];
  const ids = [];                   // the last eight message ids it acted on
  const light = kind !== 'switch';
  // what it is doing: a light comes up in its own look; a switch starts off
  const st = { word: light ? 'own' : 'off', level: light ? 0.4 : 0, color: [255, 160, 60], look: 0, effect: 'steady', on: light, identified: 0 };
  let pulseTimer = null;
  const prop = {
    heard, repeats: 0, hellos: 0,
    state: () => st.word,
    detail: () => ({ ...st, color: [...st.color], battery, signal }),
    set(v = {}) { if (v.battery !== undefined) battery = Math.round(Number(v.battery)); if (v.signal !== undefined) signal = Math.round(Number(v.signal)); },
    silent(on = true) { quiet = !!on; },
    get port() { return bound; },
    here: () => ['/ec/here', [name, light ? 'light' : 'switch', String(fw), st.word, Math.round((Date.now() - started) / 1000), signal, battery]],
    start() {
      return new Promise((resolve, reject) => {
        sock = dgram.createSocket({ type: 'udp4', reuseAddr: false });
        sock.once('error', reject);
        sock.on('message', (buf, from) => { try { arrived(buf, from); } catch { /* not OSC: a prop ignores what it cannot read */ } });
        sock.bind(port, host, () => { sock.removeListener('error', reject); sock.on('error', () => {}); bound = sock.address().port; resolve({ port: bound }); });
      });
    },
    stop() { clearTimeout(pulseTimer); try { sock && sock.close(); } catch { /* closed */ } sock = null; },
  };

  /** What a command does, in a few words (for whoever is watching); null: not a command it has. */
  function obey(address, args) {
    const secs = (i) => (Number(args[i]) > 0 ? ` over ${Number(args[i])} s` : '');
    switch (address) {
      case '/ec/identify': st.identified++; return light ? 'blinks white for 2 s, then goes back to what it was doing' : 'answers (a switch shows nothing)';
      case '/ec/look': { const n = Math.max(0, Math.min(8, Math.round(Number(args[0]) || 0))); st.look = n; st.word = n ? `look${n}` : 'own'; st.on = true; return `${n ? `look ${n}` : 'its own look'}${secs(1)}`; }
      case '/ec/color': if (!light) return null; st.color = [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(Number(args[i]) || 0)))); st.word = 'color'; st.on = true; return `colour ${st.color.join(' ')}${secs(3)}`;
      case '/ec/level': st.level = Math.max(0, Math.min(1, Number(args[0]) || 0)); return `${light ? 'brightness' : 'position'} ${Math.round(st.level * 100)}%${secs(1)}`;
      case '/ec/effect': if (!light) return null; { const e = EFFECTS.includes(String(args[0])) ? String(args[0]) : 'steady'; st.effect = e; st.word = e; st.on = true; return `${e}${Number(args[1]) > 0 && Number(args[1]) !== 1 ? ` at speed ${Number(args[1])}` : ''}`; }
      case '/ec/on': st.on = true; st.word = 'on'; return light ? `on (its last look)${secs(0)}` : 'on';
      case '/ec/off': st.on = false; st.word = 'off'; return light ? `dark${secs(0)}` : 'off';
      case '/ec/pulse': { if (light) return null; const ms = Math.max(1, Math.round(Number(args[0]) || 0)); st.on = true; st.word = 'on'; clearTimeout(pulseTimer); pulseTimer = setTimeout(() => { st.on = false; st.word = 'off'; }, ms); if (pulseTimer.unref) pulseTimer.unref(); return `on for ${ms} ms, then off`; }
      default: return null;
    }
  }

  function arrived(buf, from) {
    if (quiet) return;
    for (const msg of osc.decodeAll(buf)) {
      const text = osc.toText(msg);
      const who = `${from.address}:${from.port}`;
      const args = [...msg.args];
      // one more string argument beginning "#" is the message's id: acted on once
      let id = null;
      if (typeof args[args.length - 1] === 'string' && /^#\w+/.test(args[args.length - 1])) id = args.pop();
      if (id && ids.includes(id)) { prop.repeats++; if (onMessage) onMessage({ text, from: who, repeat: true, hello: false, did: 'a repeat: ignored' }); continue; }
      if (id) { ids.push(id); if (ids.length > 8) ids.shift(); }
      if (msg.address === '/ec/hello') {
        prop.hellos++;
        heard.push({ at: Date.now(), text, from: who });
        const [address, values] = prop.here();
        sock.send(osc.encode(address, values), from.port, from.address, () => {});
        if (onMessage) onMessage({ text, from: who, repeat: false, hello: true, did: `answered ${osc.toText({ address, args: values })}` });
        continue;
      }
      const did = obey(msg.address, args);
      heard.push({ at: Date.now(), text, from: who });
      if (onMessage) onMessage({ text, from: who, repeat: false, hello: false, did: did || 'not a message this prop knows: ignored', unknown: !did });
    }
  }
  return prop;
}

module.exports = { createFakeProp, PORT, EFFECTS };
