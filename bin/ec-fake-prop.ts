#!/usr/bin/env node
/*!
 * A stand-in prop, in the foreground: it speaks the prop kit's protocol (OSC over UDP, port 53100) and prints
 * each message as it arrives, so the app can be seen working with no hardware.
 *
 *   ec fake-prop [--name lantern] [--kind light|switch] [--port 53100] [--host 127.0.0.1] [--battery 87] [--signal -52]
 *
 * Then, in Endless Cues: the Rig page ▸ Look for props. Or from another terminal: ec check <show> --ask
 * Ctrl-C stops it (as a prop losing its power would: the Rig says "not answering" a few seconds later).
 */
import { createFakeProp, PORT } from '../core/rig/fake-prop';

function options(argv) {
  const o = { name: 'lantern', kind: 'light', port: PORT, host: '127.0.0.1', battery: 87, signal: -52 };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(name|kind|port|host|battery|signal)(?:=(.*))?$/.exec(argv[i]);
    if (!m) { if (argv[i] === '--help' || argv[i] === '-h') return null; throw new Error(`${argv[i]} is not an option (--name, --kind light|switch, --port, --host, --battery, --signal)`); }
    const v = m[2] !== undefined ? m[2] : argv[++i];
    if (v === undefined) throw new Error(`--${m[1]} needs a value`);
    o[m[1]] = ['port', 'battery', 'signal'].includes(m[1]) ? Number(v) : v;
  }
  if (!['light', 'switch'].includes(o.kind)) throw new Error('--kind is light or switch');
  if (!(Number.isInteger(o.port) && o.port >= 0 && o.port < 65536)) throw new Error('--port is a number, 1–65535');
  return o;
}

async function main(argv, out = console.log) {
  const o = options(argv);
  if (!o) { out(require('fs').readFileSync(__filename, 'utf8').split('/*!')[1].split('*/')[0].split('\n').slice(1).map((l) => l.replace(/^ \* ?/, '')).join('\n')); return 0; }
  const time = () => new Date().toTimeString().slice(0, 8);
  let asks = 0, said = false;
  const prop = createFakeProp({ ...o, onMessage: (m) => {
    if (m.hello) {
      // asked every two seconds: the first is printed, the rest are counted
      if (++asks === 1) out(`${time()}  ← /ec/hello            asked “are you there?” by ${m.from}; ${m.did}`);
      else if (!said) { said = true; out('          (it is being asked every few seconds: further asks are counted, not printed)'); }
      return;
    }
    if (m.repeat) return;           // a command sent again with the same id: acted on once, so printed once
    out(`${time()}  ← ${m.text.padEnd(20)} ${m.did}   (now: ${prop.state()})`);
  } });
  try { await prop.start(); }
  catch (err) { console.error(err.code === 'EADDRINUSE' ? `Port ${o.port} is in use: another stand-in prop (or a real program) has it. Try --port ${o.port + 1}.` : `It could not start: ${err.message}`); return 1; }
  out(`${o.name}: a stand-in prop ${o.kind}, listening on ${o.host}:${prop.port} (the prop kit’s protocol, firmware 1.0). Ctrl-C stops it.`);
  out(prop.port === PORT ? 'In Endless Cues, on the Rig page, press Look for props. From a terminal: ec check <show> --ask' : `It is not on the kit’s port (${PORT}), so Look for props will not find it: add it as a device at ${o.host}:${prop.port}.`);
  out('');
  const bye = () => { prop.stop(); out(`\n${o.name} stopped. It was asked “are you there?” ${asks} time${asks === 1 ? '' : 's'}, acted on ${prop.heard.length - prop.hellos} command${prop.heard.length - prop.hellos === 1 ? '' : 's'} and ignored ${prop.repeats} repeat${prop.repeats === 1 ? '' : 's'}.`); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
  return new Promise(() => {});     // until it is stopped
}

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(err.message); process.exitCode = 2; });
export { main, options };
