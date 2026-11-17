/**
 * Looking for props: one /ec/hello to UDP 53100 on each network's broadcast address and on this computer
 * itself, then a second and a half of listening for /ec/here (docs/specs/15-assistant-and-rig.md, 3.6).
 *
 *   scan({ devices })  → Promise<[{ name, kind, fw, host, port, state, known: <device id> | null, moved }]>
 *
 * `known` is the device of the show this prop is (a prop's name is its device's id; one at the same address
 * counts too), and `moved` says that device is written at another address, which the Rig offers to correct.
 *
 * That one hello to one port is all this ever sends. It sweeps nothing: a sweep of a network once made a
 * printer print. It runs only when a person presses Look for props, or the assistant's find_devices asks;
 * whoever calls it keeps it out of Show mode and away from a running cue.
 *
 * `targets` ([{ host, port }]) replaces where the hello goes (a test with two stand-in props on one computer).
 */
import * as dgram from 'dgram';
import * as os from 'os';
import * as osc from '../net/osc';

const PORT = 53100;
const WAIT_MS = 1500;

/** Each network's broadcast address (IPv4), and this computer itself. */
function targetsOf(port = PORT, interfaces = os.networkInterfaces()) {
  const out = [{ host: '127.0.0.1', port }];
  for (const list of Object.values(interfaces)) for (const i of list || []) {
    if (i.family !== 'IPv4' || i.internal || !i.netmask) continue;
    const a = i.address.split('.').map(Number), m = i.netmask.split('.').map(Number);
    const host = a.map((x, k) => (x & m[k]) | (~m[k] & 255)).join('.');
    if (!out.some((t) => t.host === host)) out.push({ host, port });
  }
  return out;
}

function scan({ devices = [], port = PORT, wait = WAIT_MS, targets = null } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const done = () => { try { sock.close(); } catch { /* closed */ } resolve([...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }) || a.host.localeCompare(b.host))); };
    sock.on('error', done);
    sock.on('message', (buf, from) => {
      let msgs = []; try { msgs = osc.decodeAll(buf); } catch { /* not OSC */ }
      for (const m of msgs) {
        if (m.address !== '/ec/here') continue;
        const name = String(m.args[0] ?? '');
        // (a prop that heard the hello twice, on the broadcast and on its own address, is one prop)
        if (!name || [...found.values()].some((f) => f.name === name && f.port === from.port && (f.host === from.address || f.host === '127.0.0.1' || from.address === '127.0.0.1'))) continue;
        const same = devices.find((d) => d.id === name) || devices.find((d) => String(d.name).toLowerCase() === name.toLowerCase());
        const here = devices.find((d) => d.host === from.address && Number(d.port) === from.port);
        const known = same || here || null;
        found.set(`${from.address}:${from.port}`, { name, kind: String(m.args[1] ?? 'light'), fw: String(m.args[2] ?? ''), host: from.address, port: from.port, state: String(m.args[3] ?? ''),
          known: known ? known.id : null, moved: !!same && (same.host !== from.address || Number(same.port) !== from.port) });
      }
    });
    sock.bind(0, () => {
      try { sock.setBroadcast(true); } catch { /* loopback only, then */ }
      const hello = osc.encode('/ec/hello');
      for (const t of targets || targetsOf(port)) { try { sock.send(hello, Number(t.port) || port, t.host, () => {}); } catch { /* that network is not there now */ } }
      const timer = setTimeout(done, wait);
      if (timer.unref) timer.unref();
    });
  });
}

export { scan, targetsOf, PORT, WAIT_MS };
