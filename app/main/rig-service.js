/**
 * The rig, in the running app: what the host knows about the show's equipment and its readiness
 * (docs/specs/15-assistant-and-rig.md, sections 3.6, 3.7 and 5.1).
 *
 * Kept beside app/main/host.js and not in it, so that the host's own file changes by a few lines: the host
 * makes one of these, gives it the hub and the open show, and asks it for:
 *
 *   service        what the assistant's tools are given as `ctx.rig`: { status, monitor, senders, ask, scan, locked }
 *   snapshot()     the `rig` part of every state push
 *   cmd(c)         the Rig page's commands: device-try, device-ask, rig-check, rig-scan, rig-tick, rig-ticks-clear
 *   send(...)      a message to a patch or a device, with a device's `resend` (the host's sendNetwork is this)
 *   configure()    the show changed          opened()   a show was opened (the ticks are this sitting's)
 *   wantsInput()   a device that says it is there by itself wants the input port open
 *
 * Simple until asked: with no device in the show nothing here sends, listens or keeps a timer. A device that
 * is asked whether it is there is the switch for asking; one that says so by itself is the switch for
 * listening. Nothing here is awaited by a GO.
 */
const check = require('../../core/rig/check');
const rigDevices = require('../../core/rig/devices');
const { createLiveness, ASK_WAIT_MS } = require('../../core/rig/liveness');
const { scan } = require('../../core/rig/scan');
const { senders } = require('../../core/rig/senders');
const folder = require('../../core/rig/folder');
const script = require('../../core/rig/script');
const osc = require('../../core/net/osc');
const { DEVICES: MODELS } = require('../../core/net/devices');

const OPS = ['device-try', 'device-ask', 'rig-check', 'rig-scan', 'rig-tick', 'rig-ticks-clear'];
const TICK_MS = 250;
const SHOW_MODE = 'Show mode: an assistant sends nothing to the equipment';

/** An address on a private network, written as numbers (10/8, 172.16/12, 192.168/16, 169.254/16, 127/8): the only kind an assistant may ask. */
function isPrivate(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(host || '').trim());
  if (!m || m.slice(1).some((n) => Number(n) > 255)) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function createRig({ hub, state, engine, overrides, HELD, held: heldBy = null, away = () => '', smoke = false, net = false, log = () => {}, notice = () => {}, changed = () => {}, document, facts = () => ({}), sendMidi = null }) {
  const doc = () => document().doc;
  // (why nothing goes to the equipment: OSC out held back for a rehearsal, or the host's own reason. `away`: why the
  // network is off altogether, for a show from another computer: then nothing is looked for either)
  const held = heldBy || (() => (overrides.osc ? HELD('OSC out') : ''));
  let ticks = {};                   // the checklist's ticks: this sitting's, never the show's
  let found = null, scanning = false;
  let checkedAt = Date.now();
  let timer = null;
  let built = null;                 // { doc, at, items, summary, facts }: the rows, worked out at most once a second and when something changes
  let stale = true;
  let files = null, marks = null;   // the folder and the script as last read: { key, at, … }
  let heldWas = '';
  let needed = new Set();           // devices a cue uses (and that are not marked "the show goes on without it")
  let again = null;                 // a push owed to the page, because it was last sent rows that were a moment old

  const live = createLiveness({
    send: (d, text) => hub.send(d.id, text, { format: rigDevices.viaOf(d), quiet: true, ask: true, label: 'are you there?' }),
    log,
    changed: () => { stale = true; changed(); },
    // said once, when it stops, and only for a thing the show needs: its row and the Rig tab's dot say the rest
    stopped: (d) => { if (needed.has(d.id)) notice(`${d.name} has stopped answering`, 8000); },
    facts: (id) => ({ tcp: (hub.status().patches[id] || {}).tcp, midi: state.midi.outputs.length > 0 }),
  });
  hub.onHeard((msg, _from, patch, how) => { if (patch && patch.isDevice) live.heard(patch.id, msg, how.at); });

  const devices = () => rigDevices.list(doc());
  function timerFor(list) {
    const want = list.length > 0;
    if (want && !timer) { timer = setInterval(() => { try { live.tick(); } catch (err) { log(`liveness: ${err.stack || err}`); } }, TICK_MS); if (timer.unref) timer.unref(); }
    if (!want && timer) { clearInterval(timer); timer = null; }
  }

  function readFolder(force = false) {
    const d = document();
    const key = `${d.showDir || ''}`;
    if (!force && files && files.key === key && files.doc === d.doc) return;
    if (!force && files && files.key === key && Date.now() - files.at < 2000) return;       // (a run of edits does not read the folder for each)
    let list = [];
    try { list = folder.listing(d.showDir, d.doc, { durations: Object.fromEntries(engine.durations || []) }); } catch (err) { log(`folder: ${err.message}`); }
    files = { key, at: Date.now(), doc: d.doc, counts: folder.counts(list) };
  }
  function readScript(force = false) {
    const d = document();
    const file = d.doc.settings.rig.script || '';
    const key = `${d.showDir || ''}|${file}`;
    if (!force && marks && marks.key === key) return;
    if (!file) { marks = { key, file: '', found: false, why: '', lines: 0, marks: [] }; return; }
    const r = d.showDir ? script.read(d.showDir, file) : { ok: false, why: folder.NO_FOLDER, lines: 0, marks: [] };
    marks = { key, file, found: r.ok, why: r.why, lines: r.lines, marks: r.marks };
  }
  const scriptFact = () => ({ file: marks.file, found: marks.found, why: marks.why, lines: marks.lines, marks: marks.marks.length, missing: marks.found ? script.compare(doc(), marks.marks).missing : [] });

  function build() {
    const d = doc(), now = Date.now();
    if (held() !== heldWas) { heldWas = held(); live.configure(devices(), { held: heldWas }); stale = true; }
    if (built && built.doc === d && !stale && now - built.at < 1000) {
      // (rows a moment old were sent: the page is told again once they can be worked out afresh, so a row is never left stale)
      if (!again) { again = setTimeout(() => { again = null; stale = true; changed(); }, 1020 - (now - built.at)); if (again.unref) again.unref(); }
      return built;
    }
    readFolder(); readScript();
    const f = { ...facts(), liveness: live.states(), script: scriptFact(), ticks };
    const items = check.items(d, f);
    needed = new Set(items.filter((i) => i.device && i.needed).map((i) => i.device));
    built = { doc: d, at: now, items, summary: check.summary(items, checkedAt), facts: f };
    stale = false;
    return built;
  }

  function snapshot() {
    const b = build();
    const net2 = b.facts.network || hub.status();
    const out = {};
    for (const dev of devices()) {
      const l = b.facts.liveness[dev.id] || {}, item = b.items.find((i) => i.device === dev.id);
      const st = net2.patches ? net2.patches[dev.id] : null;
      // (the row's state: a fault on a device the show does not need is "to look at" there, and so it is here)
      out[dev.id] = { ...l, state: item ? item.state : l.state || 'unknown', text: item ? item.text : l.text || '', lastOut: (st && st.lastOut) || midiOut.get(dev.id) || '', lastIn: l.lastIn || (st && st.lastIn) || '' };
    }
    const sc = b.facts.script;
    return {
      summary: b.summary, items: b.items, devices: out, ticks: { ...ticks }, found, scanning,
      senders: net2.input && net2.input.listening ? senders(hub.monitor(), { devices: devices(), patches: doc().settings.network.patches }) : [],
      script: { file: sc.file, found: sc.found, lines: sc.lines, marks: sc.marks, missing: sc.missing.map((m) => m.number) },
      folder: files ? files.counts : { sounds: 0, videos: 0, texts: 0, unused: 0 },
    };
  }

  // ── sending: a device's commands go out as a patch's messages do, and a device may ask for each to be sent again ──
  const midiOut = new Map();        // a MIDI device -> the last message sent to it (the hub keeps this for the others)
  /** One message to a patch or a device. A device with `resend` gets it that many times, 40 ms apart, with one id on the
   *  end, so a prop that acts once on each id is covered against a lost datagram; a faded value is never sent again. */
  function send(id, message, { label = '', format = 'osc', faded = false } = {}) {
    const d = id ? rigDevices.find(doc(), id) : null;
    const again = d && format === 'osc' && !faded ? Math.min(rigDevices.MAX_RESEND, Number(d.resend) || 0) : 0;
    if (again < 1) return hub.send(id, message, { label, format });
    const text = `${message} #${Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0')}`;
    const entry = hub.send(id, text, { label, format });
    // (the repeats are not written in the monitor; held back, or refused, there is nothing to repeat)
    if (entry.ok) for (let k = 1; k < again; k++) { const t = setTimeout(() => hub.send(id, text, { label, format, quiet: true }), k * rigDevices.RESEND_GAP_MS); if (t.unref) t.unref(); }
    return entry;
  }

  /** A device's command, sent once by a person's hand (the Rig's Try). */
  function tryCommand(c) {
    const d = rigDevices.find(doc(), c.device);
    if (!d) return { error: `no device with the id ${c.device}` };
    if (state.mode === 'show') {
      // in a show, only the command marked safe may be tried, and only while nothing is running
      if (!d.test || c.command !== d.test) return { error: `Show mode: only ${d.name}’s safe command${d.test ? ` (${(d.commands.find((x) => x.id === d.test) || {}).label || d.test})` : ' (it has none)'} can be tried (switch to Edit to try the others)` };
      if (engine.active().length) return { error: 'Show mode: a command is tried only while no cue is running' };
    }
    const r = rigDevices.compose(d, c.command, c.args || {});
    if (!r.ok) return { error: r.why };
    const cmdOf = d.commands.find((x) => x.id === c.command);
    const label = `try: ${rigDevices.cueName(d, { command: c.command, args: c.args || {} })}`;
    let entry;
    if (rigDevices.isNetwork(d)) {
      if (!d.host || !(Number(d.port) > 0)) return { error: `${d.name} has no address yet` };
      entry = send(d.id, r.message, { label, format: rigDevices.viaOf(d) });
    } else {
      if (!sendMidi) return { error: 'MIDI cannot be sent from here' };
      entry = sendMidi(r.message, { label });
      midiOut.set(d.id, r.message);
    }
    stale = true;
    if (entry.held) return { sent: entry, held: true, message: r.message, text: away() && rigDevices.isNetwork(d) ? 'Held back: nothing was sent (this show came from another computer: turn on its network features first)' : `Held back: nothing was sent (${rigDevices.isNetwork(d) ? 'OSC' : 'MIDI'} out is off for rehearsal)` };
    if (!entry.ok) return { error: `${cmdOf.label} was not sent: ${entry.why}`, sent: entry };
    return { sent: entry, held: false, message: r.message };
  }

  function lookForProps() {
    scanning = true; changed();
    // a test run opens no socket and sends nothing: nothing answers
    const going = smoke && !net ? Promise.resolve([]) : scan({ devices: devices() });
    return going.catch((err) => { log(`scan: ${err.message}`); return []; }).then((list) => { scanning = false; found = list; changed(); return list; });
  }

  function cmd(c) {
    switch (c.op) {
      case 'device-try': return tryCommand(c);
      case 'device-ask': {
        if (!rigDevices.find(doc(), c.device)) return { error: `no device with the id ${c.device}` };
        return live.ask(c.device).then((r) => { stale = true; changed(); return r; });
      }
      // ask every device that can be asked now, read the folder and the script again, and stamp the time
      case 'rig-check': {
        readFolder(true); readScript(true);
        const asked = devices().filter((d) => (d.alive || {}).how === 'ask' && d.host && Number(d.port) > 0 && !held());
        return Promise.all(asked.map((d) => live.ask(d.id))).then(() => { checkedAt = Date.now(); stale = true; changed(); return { summary: build().summary }; });
      }
      case 'rig-scan': {
        if (state.mode === 'show') return { error: 'Show mode: nothing is looked for on the network during a show (switch to Edit)' };
        if (engine.active().length) return { error: 'A cue is running: look for props when nothing is playing' };
        if (scanning) return { error: 'It is already looking' };
        if (away()) return { error: 'This show came from another computer: turn on its network features first' };
        return lookForProps().then((list) => ({ found: list }));
      }
      case 'rig-tick': {
        if (!(doc().settings.rig.checks || []).some((k) => k.id === c.id)) return { error: 'no such line in the checklist' };
        if (c.on === false || (c.on === undefined && ticks[c.id])) delete ticks[c.id]; else ticks[c.id] = true;
        stale = true;
        return { ticks: { ...ticks } };
      }
      case 'rig-ticks-clear': ticks = {}; stale = true; return { ticks: {} };
      default: return { error: `unknown command ${c.op}` };
    }
  }

  // ── what the assistant's tools are given (ctx.rig). It may ask whether a device is there; it can never send a command. ──
  const service = {
    status: () => ({ ...snapshot(), computer: (build().facts.computer) || { audio: { device: '', outputs: 0, devices: [] }, displays: [], midi: { inputs: [], outputs: [] }, interfaces: [] } }),
    monitor: (last = 40) => hub.monitor().slice(-Math.max(1, Math.min(400, Number(last) || 40))),
    senders: () => senders(hub.monitor(), { devices: devices(), patches: doc().settings.network.patches }),
    /** One "are you there?": to a device of the show (its id), or, before it is one, to { host, port, probe } with a
     *  model's own test message. → Promise<{ ok, held, answered, ms, text, why }> */
    ask(target) {
      const no = (why, more = {}) => Promise.resolve({ ok: false, held: false, answered: false, ms: 0, text: '', why, ...more });
      if (state.mode === 'show') return no(SHOW_MODE);
      if (typeof target === 'string') return live.ask(target).then((r) => { stale = true; return r; });
      const t = target || {};
      const model = MODELS[t.probe];
      if (!model || !model.test) return no(`“${t.probe}” is not a model with a test message (those are: ${Object.keys(MODELS).filter((k) => MODELS[k].test).join(', ')})`);
      if (!isPrivate(t.host)) return no(`${t.host} is not an address on a private network (10.x, 172.16–31.x, 192.168.x, 169.254.x, 127.x): only those are asked`);
      if (!(Number.isInteger(Number(t.port)) && Number(t.port) > 0 && Number(t.port) < 65536)) return no('the port is a number, 1–65535');
      if (held()) return no(held(), { held: true });
      return new Promise((resolve) => {
        const started = Date.now();
        let off = () => {}, timer2 = null;
        const done = (msg) => { off(); clearTimeout(timer2); resolve(msg ? { ok: true, held: false, answered: true, ms: Math.max(1, Date.now() - started), text: osc.toText(msg), why: '' } : { ok: true, held: false, answered: false, ms: Date.now() - started, text: '', why: `No answer in ${ASK_WAIT_MS / 1000} s.` }); };
        off = hub.onHeard((msg, from) => { if (from.address === String(t.host)) done(msg); });
        timer2 = setTimeout(() => done(null), ASK_WAIT_MS);
        const e = hub.sendTo({ host: String(t.host), port: Number(t.port) }, model.test, { label: 'are you there?' });
        if (!e.ok) { off(); clearTimeout(timer2); resolve({ ok: false, held: !!e.held, answered: false, ms: 0, text: '', why: e.why || 'it could not be sent' }); }
      });
    },
    /** Look for props (the one fixed hello). Nothing in Show mode, nothing while a cue runs. */
    scan() { return state.mode === 'show' || engine.active().length || scanning || away() ? Promise.resolve([]) : lookForProps(); },
    locked: () => state.mode === 'show',
  };

  return {
    service, snapshot, send,
    handles: (op) => OPS.includes(op),
    cmd,
    /** The show changed: its devices to the liveness, and the rows are worked out again. */
    configure() { const list = devices(); heldWas = held(); live.configure(list, { held: heldWas }); timerFor(list); stale = true; },
    /** A show was opened: the ticks, what a scan found and what was read of the folder belonged to the last one. */
    opened() { ticks = {}; found = null; files = null; marks = null; checkedAt = Date.now(); stale = true; midiOut.clear(); },
    wantsInput: () => devices().some((d) => (d.alive || {}).how === 'heartbeat'),
    close() { if (timer) clearInterval(timer); timer = null; clearTimeout(again); live.close(); },
  };
}

module.exports = { createRig, OPS, isPrivate };
