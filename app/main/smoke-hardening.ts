/**
 * Run by smoke.ts at its end: a show from another computer opens with its network features held back (no module,
 * nothing sent, no clock trigger, a sound on another computer's share not opened) and one line in the title bar;
 * Turn on gives it all back and is remembered. Then OSC control with no passcode: it runs the show and does not edit
 * it, and a UDP sender that has not connected is not answered (core/show/trust.ts, docs/specs/06 "No UDP reflector").
 * A test run opens no socket: OSC arrives through the hub's `pretendInput`. Picture: hardening-away.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as show from '../../core/show/show';
import { applyOps } from '../../core/show/ops';
import type { Smoke, Snap } from './smoke';
import type { MonitorEntry } from '../../core/net/hub';

async function run({ host, win, check, until, page, sleep, shot }: Pick<Smoke, 'host' | 'win' | 'check' | 'until' | 'page' | 'sleep' | 'shot'>) {
  const snap = () => host.snapshot() as Snap;
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-away-')), 'From Elsewhere.ecshow');
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  let doc = show.newShow('From elsewhere');
  doc = applyOps(doc, [
    { op: 'show.set', path: 'settings.network.patches', value: [{ id: 'lamp', name: 'Lamp', host: '127.0.0.1', port: 9 }] },
    { op: 'show.set', path: 'modules.osc-control.enabled', value: true },
    { op: 'cue.add', cue: { type: 'memo', number: '1', name: 'House' } },
    { op: 'cue.add', cue: { type: 'network', number: '2', name: 'Lamp on', patch: 'lamp', message: '/lamp/on', clockTrigger: '03:04:05' } },
    { op: 'cue.add', cue: { type: 'audio', number: '3', name: 'On a share', file: '//nas/show/rain.wav' } },
  ]).doc;
  fs.writeFileSync(path.join(dir, 'show.json'), show.stringify(doc));
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'mode', mode: 'edit' });
  host.open(dir, false, { elsewhere: true });
  const osc = () => snap().modules.find((m) => m.id === 'osc-control');
  const out = () => host.cmd({ op: 'net-monitor' }).entries.filter((e: MonitorEntry) => e.dir === 'out');

  check('a show from another computer opens with its network features off: OSC control is not started, nothing listens',
    snap().away === true && !osc()!.running && !snap().network.input.listening, [snap().away, osc(), snap().network.input]);
  check('…and the title bar says so in one line, with Turn on',
    await until(() => page(`(() => { const l = document.querySelector('.titlebar [data-away]'); return !!l && /came from another computer/.test(l.textContent) && !!l.querySelector('[data-turn-on]'); })()`), 3000));
  await shot('hardening-away');
  host.cmd({ op: 'net-clear' });
  host.checkClock(new Date(2030, 0, 4, 3, 4, 5));
  await sleep(150);
  check('…its clock trigger does not fire', out().length === 0, out());
  host.cmd({ op: 'fire', number: '2' });
  check('…a Network cue fired by hand sends nothing, and says why', await until(() => out().some((e: MonitorEntry) => e.held && /another computer/.test(e.why!)), 2000), out());
  const share = () => (snap().problems.find((p) => p.why && /on another computer/.test(p.why)) || null);
  check('…and a sound on another computer’s share is not opened: the cue says why', await until(() => !!share(), 3000), snap().problems);
  check('…while GO plays as ever', (() => { host.cmd({ op: 'jump', number: '1' }); const r = host.cmd({ op: 'go' }); return !r.error; })());
  check('a remote cannot turn it on', !!host.cmd({ op: 'turn-on', from: 'osc' }).error && snap().away === true);

  // Turn on, from the window
  await page(`document.querySelector('.titlebar [data-turn-on]').click()`);
  check('Turn on gives it all back: OSC control starts, the line goes', await until(() => !snap().away && osc()!.running, 3000) && await until(() => page(`!document.querySelector('.titlebar [data-away]')`), 3000), [snap().away, osc()]);
  host.cmd({ op: 'net-clear' });
  host.checkClock(new Date(2030, 0, 4, 3, 4, 5));
  check('…its clock trigger fires', await until(() => out().some((e: MonitorEntry) => /\/lamp\/on/.test(e.text) && !e.held), 2000), out());
  check('…the sound’s file is looked for where it is named', await until(() => !share(), 3000), snap().problems);
  host.open(dir, false, { elsewhere: true });
  check('…and it is remembered: opened again, it is this computer’s', snap().away === false && osc()!.running, [snap().away, osc()]);

  // OSC control with no passcode: anyone may run the show, nobody may change it, and a forged sender is not answered
  host.cmd({ op: 'panic', hard: true });
  const said: { address: string; json: { status?: string } }[] = [];
  const reply = (address: string, args?: unknown[]) => said.push({ address, json: JSON.parse(((args![0] || {}) as { value?: string }).value || '{}') });
  const forged = { address: '192.0.2.7', port: 53535 }, remote = { address: '127.0.0.1', port: 50001, tcp: true };
  host.pretendInput('/cueLists', forged, reply);
  host.pretendInput('/cue/1/name', forged, reply);
  check('OSC control: a UDP sender that never connected is not answered (no reflector)', said.length === 0, said);
  host.pretendInput('/connect', forged, reply);
  host.pretendInput('/cueLists', forged, reply);
  check('…once it has connected, it is', said.some((x) => x.address === '/reply/cueLists' && x.json.status === 'ok'), said);
  said.length = 0;
  host.pretendInput('/connect', remote, reply);
  host.pretendInput('/cue/1/name Changed', remote, reply);
  host.pretendInput('/delete/1', remote, reply);
  host.pretendInput('/save', remote, reply);
  check('…with no passcode, setting a cue’s name, /delete and /save are denied, and the show is as it was',
    ['/reply/cue/1/name', '/reply/delete/1', '/reply/save'].every((a) => said.find((x) => x.address === a)!.json.status === 'denied') && show.findByNumber(host.document.doc, '1')!.name === 'House' && !host.document.dirty, said);
  host.cmd({ op: 'jump', number: '1' });
  await sleep(400);                 // (past the double-GO time of the GO above)
  const before = (snap().engine.lastGo || {}).at;
  host.pretendInput('/go', remote, reply);
  check('…and /go runs the show', await until(() => (snap().engine.lastGo || {}).at !== before, 2000), snap().engine.lastGo);
  host.cmd({ op: 'panic', hard: true });
}

export { run };
