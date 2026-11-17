/**
 * The rig, end to end in the real app (docs/specs/15-assistant-and-rig.md, package A): a device added by an
 * edit, a Device cue fired, an answer heard, Hold Back, Show mode, and files written by an accepted proposal.
 *
 * A test run's hub sends nothing and hears nothing: what is "sent" is read from the monitor, and
 * `host.pretendHeard` stands in for the device's answer.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

async function run({ host, check, until, sleep }) {
  const snap = () => host.snapshot();
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-rig-')), 'Rig.ecshow');
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'mode', mode: 'edit' });
  host.open(dir);
  const rig = () => snap().rig;
  const row = (id) => rig().items.find((i) => i.id === id);

  // a plain show: the Rig is there, with its three rows, and nothing has been asked of the network
  check('the Rig of a new show has three rows and no equipment', rig().items.map((i) => i.id).join() === 'show.saved,show.backups,show.cues' && Object.keys(rig().devices).length === 0 && rig().found === null && rig().scanning === false, rig().items.map((i) => i.id));
  check('…and its summary says how many are ready', /^(All 3 are ready|\d of 3 ready)/.test(rig().summary.text) && rig().summary.total === 3, rig().summary);
  const before = host.cmd({ op: 'net-monitor' }).entries.length;

  // a device, added by an edit like any other
  const add = host.cmd({ op: 'edit', ops: [{ op: 'device.add', device: { name: 'Lantern A', model: 'ec-prop-light', host: '10.0.0.42' } },
    { op: 'cue.add', ref: 'q', cue: { type: 'device', number: 'R1', device: 'lantern_a', command: 'effect', args: { name: 'breathe' } } },
    { op: 'show.set', path: 'settings.rig.checks', value: [{ id: 'k1', text: 'Fresh batteries in both lanterns' }] }], label: 'add a lantern' });
  check('a device is added by an edit, undoable and unsaved like any other', !add.error && snap().doc.settings.rig.devices.length === 1 && snap().show.canUndo && snap().show.unsaved.some((c) => c.kind === 'device-added' && c.label === 'Lantern A'), add.error || snap().show.unsaved.map((c) => c.kind));
  check('…its row is on the Rig, not yet answering, with Ask again and Try', !!row('device.lantern_a') && row('device.lantern_a').label === 'Lantern A' && row('device.lantern_a').state !== 'ready' && row('device.lantern_a').actions.map((a) => a.id).join() === 'ask,try', row('device.lantern_a'));
  check('a Device cue is named for what it does', snap().rows.some((r) => r.type === 'device' && r.name === 'Lantern A ▸ Effect (breathe)') && !snap().problems.some((p) => p.id === add.refs.q), snap().rows.map((r) => r.name));

  // GO: its message goes to the device (three times with one id, written in the monitor once)
  host.cmd({ op: 'start', id: add.refs.q });
  check('a fired Device cue sends its command to the device', await until(() => snap().sent.some((x) => /^\/ec\/effect breathe #[0-9a-f]{6}$/.test(x.message) && /^Lantern A 10\.0\.0\.42:53100/.test(x.to) && x.ok), 3000), snap().sent.slice(-3));
  await sleep(150);
  const outs = host.cmd({ op: 'net-monitor' }).entries.filter((e) => e.dir === 'out' && /\/ec\/effect breathe/.test(e.text));
  check('…once in the monitor, though it is sent three times', outs.length === 1, outs.length);
  check('the device is asked quietly: no "are you there?" is in the monitor', !host.cmd({ op: 'net-monitor' }).entries.slice(before).some((e) => /\/ec\/hello/.test(e.text)));

  // an answer: the row goes ready, with what the device reports, and the summary moves
  const was = rig().summary;
  host.pretendHeard('lantern_a', '/ec/here lantern_a light 1.0 breathe 532 -52 87');
  check('an answer makes the device’s row ready', await until(() => row('device.lantern_a').state === 'ready', 4000), row('device.lantern_a'));
  const d = rig().devices.lantern_a;
  check('…with what it reports and the last messages each way', d.state === 'ready' && /^answering/.test(d.text) && d.reports.some((r) => r.key === 'battery' && r.value === 87 && r.unit === '%') && /^\/ec\/here lantern_a/.test(d.lastIn) && /^\/ec\/effect breathe/.test(d.lastOut), d);
  check('…and the summary changes', rig().summary.ready === was.ready + 1 && rig().summary.text !== was.text, [was.text, rig().summary.text]);

  // the checklist: a tick is this sitting's, not an edit
  const unsaved = snap().show.unsaved.length;
  host.cmd({ op: 'rig-tick', id: 'k1', on: true });
  check('a tick on the checklist is kept by the host and is not an edit', rig().ticks.k1 === true && row('check.k1').state === 'ready' && snap().show.unsaved.length === unsaved, rig().ticks);
  host.cmd({ op: 'rig-ticks-clear' });
  check('Start again clears the ticks', !rig().ticks.k1 && row('check.k1').state === 'look');

  // Try, and Hold Back
  const tried = host.cmd({ op: 'device-try', device: 'lantern_a', command: 'identify' });
  check('Try sends the command once', !!tried.sent && tried.sent.ok && /^\/ec\/identify #/.test(tried.sent.text) && tried.held === false, tried);
  check('Try refuses a value the command cannot take', host.cmd({ op: 'device-try', device: 'lantern_a', command: 'level', args: { level: 5 } }).error === 'level must be between 0 and 1');
  host.cmd({ op: 'override', what: 'osc', on: true });
  const held = host.cmd({ op: 'device-try', device: 'lantern_a', command: 'identify' });
  check('with OSC out held back, Try answers "held" and nothing is sent', held.held === true && /^Held back: nothing was sent/.test(held.text) && held.sent.held === true, held);
  check('…the Rig says what is held back, and offers to let it go', !!row('held') && row('held').state === 'look' && row('held').actions[0].cmd.what === 'osc', row('held'));
  const askHeld = await host.cmd({ op: 'device-ask', device: 'lantern_a' });
  check('…and an ask is held too', askHeld.held === true && askHeld.answered === false, askHeld);
  host.cmd({ op: 'override', what: 'osc', on: false });
  check('let go, the row is gone', await until(() => !row('held'), 3000));

  // Show mode: the safe command only, no scan, no files; asking and ticking still work
  host.cmd({ op: 'mode', mode: 'show' });
  const no = host.cmd({ op: 'device-try', device: 'lantern_a', command: 'effect', args: { name: 'pulse' } });
  check('Show mode refuses Try for a command that is not the safe one', /^Show mode: only Lantern A’s safe command \(Identify\)/.test(no.error || ''), no);
  check('…and allows the safe one while nothing is running', await until(() => snap().engine.active.length === 0, 3000) && !!host.cmd({ op: 'device-try', device: 'lantern_a', command: 'identify' }).sent);
  check('Show mode refuses Look for props, firmware files and the agent guide', /^Show mode/.test(host.cmd({ op: 'rig-scan' }).error || '') && /^Show mode/.test(host.cmd({ op: 'prop-files', device: 'lantern_a' }).error || '') && /^Show mode/.test(host.cmd({ op: 'agent-guide' }).error || ''));
  check('…and still ticks the checklist and checks the rig', host.cmd({ op: 'rig-tick', id: 'k1', on: true }).ticks.k1 === true && !!(await host.cmd({ op: 'rig-check' })).summary);
  host.cmd({ op: 'mode', mode: 'edit' });
  const found = await host.cmd({ op: 'rig-scan' });
  check('Look for props, in a test run, sends nothing and finds nothing', Array.isArray(found.found) && found.found.length === 0 && Array.isArray(rig().found) && rig().scanning === false, found);

  // files: a proposal of files alone, written when it is accepted
  const doc = host.document;
  doc.proposeDocument(doc.doc, { summary: 'Firmware for Lantern A', author: 'you', files: [{ path: 'props/lantern_a/lantern_a.ino', text: '// a stand-in for the kit’s sketch\nvoid setup() {}\nvoid loop() {}\n' }, { path: 'props/lantern_a/secrets.h', text: '#define WIFI_PASS "CHANGE-ME"\n' }] });
  check('a proposal of files alone is pushed with its files', await until(() => { const p = snap().proposal; return !!p && p.files.length === 2 && p.files[0].path === 'props/lantern_a/lantern_a.ino' && p.files[0].lines === 3 && p.files[0].replaces === false && p.counts.files === 2 && p.changes.length === 0; }, 3000), snap().proposal);
  check('…nothing is on disk until it is accepted', !fs.existsSync(path.join(dir, 'props')));
  const acc = host.cmd({ op: 'accept' });
  check('accepted, the files are in the show folder', !acc.error && (acc.files || []).length === 2 && fs.readFileSync(path.join(dir, 'props/lantern_a/lantern_a.ino'), 'utf8').includes('void setup()') && fs.existsSync(path.join(dir, 'props/lantern_a/secrets.h')) && snap().proposal === null, acc);
  // the two commands whose modules are another package's: an answer either way, never a throw
  const guide = host.cmd({ op: 'agent-guide' });
  check('the agent guide is staged for review, or says why not', !!guide && (typeof guide.error === 'string' || typeof guide.proposal === 'string'), guide);
  if (guide.proposal) host.cmd({ op: 'reject' });
  const fw = host.cmd({ op: 'prop-files', device: 'lantern_a', options: { sketch: 'light' } });
  check('firmware for a prop is staged for review, or says why not', !!fw && (typeof fw.error === 'string' || typeof fw.proposal === 'string'), fw);
  if (fw.proposal) host.cmd({ op: 'reject' });

  // removing the device breaks the cue that named it, and says so on the Rig
  host.cmd({ op: 'edit', ops: [{ op: 'device.remove', id: 'lantern_a' }] });
  check('a removed device leaves its cue broken, and the Rig says a cue cannot run', snap().problems.some((p) => p.id === add.refs.q && p.why === 'its device is gone') && row('show.cues').state === 'problem' && !row('device.lantern_a'), row('show.cues'));
  host.cmd({ op: 'undo' });
  check('…and undo brings both back', !!row('device.lantern_a') && row('show.cues').state === 'ready');
  host.cmd({ op: 'panic', hard: true });
}

module.exports = { run };
