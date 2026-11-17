/**
 * The assistant on the rig, in the real app (docs/specs/15-assistant-and-rig.md, package B). The provider in a
 * test run is the built-in helper (no model), so these are the turns a person with no model can have: cues
 * from the folder, a device, a cue for its command, "is everything ready?", firmware, and the hand-over.
 *
 * A test run's hub sends nothing, so nothing here reaches a network.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeWav } from '../../examples/make-demo';

async function run({ host, check }) {
  const snap = () => host.snapshot();
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-assistant-')), 'Spring Concert');
  fs.mkdirSync(dir, { recursive: true });
  // a folder as a person has it: numbered sounds, a note, and the litter a Mac leaves
  const blip = new Float32Array(4410);
  for (const name of ['01 Overture.wav', '02 Storm FINAL.wav', '03 rain loop.wav']) writeWav(path.join(dir, name), blip, blip);
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'Storm is loud.\n');
  fs.writeFileSync(path.join(dir, '.DS_Store'), 'x');
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'mode', mode: 'edit' });
  host.cmd({ op: 'assistant-reset' });
  host.open(dir);
  const ask = async (text) => { const r = await host.cmd({ op: 'ask', text }); return { r, said: (snap().assistant.transcript.at(-1) || {}).text || '' }; };
  const accept = () => host.cmd({ op: 'accept', id: snap().proposal.id });

  // before anything is typed: a line that is true of this folder, and an ask that works with no model
  const first = snap().assistant.first;
  check('the assistant’s first screen is about this folder', !!first && first.line === '3 sounds and 1 text file not in a cue yet.' && first.asks.length === 1 && first.asks[0].label === 'Make cues from these 3 sounds' && first.asks[0].offline === true, first);
  check('…and says who is answering', first && first.helper === true && snap().assistant.label === 'Built-in helper' && typeof snap().assistant.installed === 'object', snap().assistant.label);

  const cues = await ask(first.asks[0].text);
  check('pressing it stages the folder’s sounds as cues, and says what was guessed', cues.r.ok && !!snap().proposal && snap().proposal.counts.added === 3 && /numbered 1 to 3/.test(cues.said) && /I did not make it loop/.test(cues.said) && /Nothing else is set/.test(cues.said), cues.said);
  accept();
  check('…accepted, they are in order, named without numbers, and nothing loops', snap().rows.map((r) => `${r.number} ${r.name}`).join('|') === '1 Overture|2 Storm|3 Rain loop' && !snap().doc.lists[0].cues.some((c) => c.loop) && !snap().problems.length, snap().rows.map((r) => `${r.number} ${r.name}`));

  const dev = await ask('add a device called Lantern at 127.0.0.1');
  check('“add a device called Lantern at 127.0.0.1” stages a proposal with one device', dev.r.ok && !!snap().proposal && snap().proposal.counts.devices === 1 && snap().proposal.changes.some((c) => c.kind === 'device-added' && c.label === 'Lantern'), dev.said);
  accept();
  check('…accepted, the device is in the show with its address', (snap().doc.settings.rig.devices[0] || {}).host === '127.0.0.1' && snap().doc.settings.rig.devices[0].id === 'lantern');
  check('the first screen has moved on to the equipment', snap().assistant.first.state === 'devices' && snap().assistant.first.asks.some((a) => a.label === 'Is everything ready?'), snap().assistant.first);

  const cue = await ask('add a cue that sends identify to Lantern');
  check('“add a cue that sends identify to Lantern” stages a Device cue', cue.r.ok && !!snap().proposal && snap().proposal.counts.added === 1 && /Lantern ▸ Identify/.test(cue.said), cue.said);
  accept();
  check('…which is in the list, named for what it does', snap().rows.some((r) => r.type === 'device' && r.name === 'Lantern ▸ Identify'), snap().rows.map((r) => r.name));

  const ready = await ask('is everything ready?');
  const summary = snap().rig.summary;
  check('“is everything ready?” answers with the Rig’s summary, and proposes nothing', ready.r.ok && !snap().proposal && (summary.text ? ready.said.toLowerCase().startsWith(summary.text.toLowerCase().slice(0, 12)) : /Rig/.test(ready.said)), { said: ready.said, summary: summary.text });

  const fw = await ask('write firmware for Lantern');
  check('“write firmware for Lantern” stages the kit’s files, with a placeholder where the password goes', fw.r.ok && !!snap().proposal && snap().proposal.counts.files === 6 && snap().proposal.files.some((f) => f.path === 'props/lantern/lantern.ino') && /WIFI_PASS "CHANGE-ME"/.test((snap().proposal.files.find((f) => f.path === 'props/lantern/secrets.h') || {}).text || ''), fw.said);
  accept();
  check('…accepted, they are in the show folder', fs.existsSync(path.join(dir, 'props', 'lantern', 'config.h')) && /#define PROP_NAME +"lantern"/.test(fs.readFileSync(path.join(dir, 'props', 'lantern', 'config.h'), 'utf8')));

  const over = await ask('hand the show over');
  check('“hand the show over” stages two files and says what to type', over.r.ok && !!snap().proposal && snap().proposal.files.map((f) => f.path).join() === 'AGENTS.md,CLAUDE.md' && /claude/.test(over.said), over.said);
  accept();
  check('…the guide names the device', /\*\*Lantern\*\* \(`lantern`\)/.test(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')));

  // what it is not: asked something in a person's own words, it says so and stages nothing
  const no = await ask('make the storm feel further away');
  check('the helper says plainly what it cannot do', /built-in helper/.test(no.said) && /Settings ▸ Assistant/.test(no.said) && !snap().proposal, no.said);
  // Show mode: the assistant sends nothing, and changes nothing
  host.cmd({ op: 'mode', mode: 'show' });
  const locked = await host.agentCall('smoke', 'ask_device', { device: 'lantern' });
  check('in Show mode an assistant asks nothing of the equipment', locked.is_error && /^Show mode: an assistant sends nothing to the equipment/.test(locked.content), locked);
  host.cmd({ op: 'mode', mode: 'edit' });
  host.cmd({ op: 'assistant-reset' });
}

export { run };
