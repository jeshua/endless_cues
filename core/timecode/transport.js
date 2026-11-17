/**
 * The host's part of timecode and MIDI files, with everything it touches handed in (the engine, a clock, the MIDI
 * port, the audio window), so it runs in the tests on a fake clock with nothing connected.
 *
 * Out: a Timecode cue (MTC through the playout, or LTC made in the audio window) and a MIDI File cue. The cue
 * engine owns when each starts, how long it runs and whether it is held (its entry in `engine.fades`, marked
 * `run`); `tick`, every 20 ms while anything runs, reads that entry and plays to match. MIDI is handed over stamped
 * with the time it is due, a tenth of a second ahead (core/net/playout.js says why), so a stop or a pause takes
 * that long to reach the wire.
 *
 * In: MTC from any MIDI input, or LTC the audio window has decoded. With the show set to chase (settings.timecode),
 * cues with a timecode trigger start as their times are passed (core/timecode/chase.js) and the playhead stands on
 * the next of them. Timecode that has not been heard for a quarter of a second has stopped.
 *
 *   const t = createTransport({ engine, now, every, soon, sendMidi, audio, record, log, notice, read, midiWhyNot, settings })
 *   t.run(cue, offset)        the engine's `run` hook: start playing, answer with the length in seconds (0: until stopped)
 *   t.midiIn(bytes, at)       -> true when the message was timecode (and so is nobody else's business)
 *   t.ltcIn({ tc, rate }, at) a frame the audio window decoded, and when its last bit ended
 *   t.configure(doc)          the show changed: its timecode triggers, its chase settings
 *   t.lengthOf(file)          a MIDI file's length in seconds (0 when it cannot be read)
 *   t.status()                -> { out: [{ id, kind, text, rate, paused }], in: { source, text, rate, running } | null, chase, triggers }
 */
const tc = require('./timecode');
const { Chaser } = require('./chase');
const { Playout, mtcSource } = require('../net/playout');
const smf = require('../net/smf');

const TICK_MS = 20;
const LOOKAHEAD = 0.1;           // s: how far ahead MIDI is handed over
const GONE_AFTER = 0.25;         // s without a frame: incoming timecode has stopped

function createTransport({ engine, now, every, soon = (fn) => Promise.resolve().then(fn), sendMidi, audio, record = () => {}, log = () => {}, notice = () => {}, read, midiWhyNot = () => '', settings = () => ({}) }) {
  const playout = new Playout({ lookahead: LOOKAHEAD });
  const runs = new Map();          // cue id -> { kind: 'mtc' | 'ltc' | 'file', rate, start (frames), on, startedAt, label }
  let stopTick = null;
  const reader = new tc.MtcReader();
  const chaser = new Chaser();
  let heard = null;                // { frames, rate, at, source, running }: the last incoming timecode
  let texts = [];                  // [{ id, text }]: the show's timecode triggers, as written
  let chaseRate = '';              // the rate the chaser's frames were worked out at

  const entryOf = (id) => { const f = engine.fades.get(id); return f && f.run ? f : null; };
  // (and a first look as soon as the engine has filed what it just started, rather than up to 20 ms later)
  const wake = () => { if (!stopTick) stopTick = every(tick, TICK_MS); soon(() => { if (stopTick) tick(); }); };
  const sleepIfIdle = () => { if (stopTick && !runs.size && !(heard && heard.running)) { stopTick(); stopTick = null; } };
  const labelOf = (cue) => `${cue.number || ''} ${cue.name || ''}`.trim();

  /** The engine fires a Timecode or MIDI File cue. Throws (and the engine logs it) when it cannot play. */
  function run(cue, offset = 0) {
    const label = labelOf(cue);
    const fail = (why, text) => { record({ dir: 'out', who: 'MIDI', patch: null, text, ok: false, why, label }); notice(`${cue.number ? `${cue.number} · ` : ''}${cue.name || 'A cue'} did not start: ${why}`, 8000); throw new Error(why); };
    drop(cue.id);
    if (cue.type === 'midifile') {
      let file;
      try { file = smf.parse(read(cue.file)); } catch (err) { fail(/ENOENT|no such file/.test(err.message) ? 'its file is missing' : err.message, `MIDI file ${cue.file}`); }
      const why = midiWhyNot();
      if (why) fail(why, `MIDI file ${cue.file}`);
      const stream = new smf.MidiFileStream(file, { rate: cue.rate });
      sendMidi(playout.start(cue.id, stream, now()));
      runs.set(cue.id, { kind: 'file', label });
      record({ dir: 'out', who: 'MIDI', patch: null, ok: true, label, text: `MIDI file ${String(cue.file).split(/[\\/]/).pop()}: ${file.events.length} messages over ${Math.round(stream.total * 10) / 10} s${stream.rate !== 1 ? ` (rate ${stream.rate})` : ''}` });
      wake();
      return stream.total;
    }
    const rate = tc.RATES[cue.fps] ? cue.fps : '30';
    const at = tc.parse(cue.timecode === undefined ? '01:00:00:00' : cue.timecode);
    const bad = tc.whyNot(at, rate);
    if (bad) fail(bad, `timecode ${cue.timecode}`);
    const start = tc.toFrames(at, rate);
    const text = `${cue.output === 'ltc' ? 'LTC' : 'MTC'} from ${tc.format(at, rate)} at ${tc.rateOf(rate).label} fps`;
    if (cue.output === 'ltc') {
      runs.set(cue.id, { kind: 'ltc', rate, start, on: false, startedAt: null, label, channel: Math.max(1, Math.round(Number(cue.channel) || 1)), db: Number.isFinite(Number(cue.gainDb)) ? Number(cue.gainDb) : -12 });
      record({ dir: 'out', who: `audio output ${Math.max(1, Math.round(Number(cue.channel) || 1))}`, patch: null, ok: true, label, text });
    } else {
      const why = midiWhyNot();
      if (why) fail(why, text);
      sendMidi(playout.start(cue.id, mtcSource(tc, start, rate), now()));
      runs.set(cue.id, { kind: 'mtc', rate, start, label });
      record({ dir: 'out', who: 'MIDI', patch: null, ok: true, label, text });
    }
    wake();
    return Number(cue.duration) > 0 ? Number(cue.duration) : 0;
  }
  function drop(id) {
    const r = runs.get(id);
    if (!r) return;
    runs.delete(id);
    if (r.kind === 'ltc') { if (r.on) audio({ op: 'ltc', key: id, on: false }); } else sendMidi(playout.end(id, now()));
  }

  function tick() {
    const t = now();
    // MIDI: what is due in the next tenth of a second, and the ends of what has stopped
    const state = (id) => { const f = entryOf(id); return f ? { startedAt: f.startedAt, pausedAt: f.pausedAt == null ? null : f.pausedAt } : null; };
    const due = playout.tick(t, state);
    if (due.length) sendMidi(due);
    for (const [id, r] of [...runs]) {
      const f = entryOf(id);
      if (!f) { if (r.kind === 'ltc' && r.on) audio({ op: 'ltc', key: id, on: false }); runs.delete(id); continue; }
      if (r.kind !== 'ltc') continue;
      // LTC: the audio window makes the sound; it is told where the timecode is at a moment of this clock, and when to stop
      const going = f.pausedAt == null;
      if (going && (!r.on || r.startedAt !== f.startedAt)) { r.on = true; r.startedAt = f.startedAt; audio({ op: 'ltc', key: id, on: true, rate: r.rate, frames: r.start + tc.framesAt(t - f.startedAt, r.rate), at: t, channel: r.channel, db: r.db }); }
      else if (!going && r.on) { r.on = false; audio({ op: 'ltc', key: id, on: false }); }
    }
    // incoming timecode that has gone quiet has stopped: the next frame heard is an arrival, not a continuation
    if (heard && heard.running && t - heard.at > GONE_AFTER) { heard.running = false; chaser.park(); reader.reset(); log(`timecode in stopped at ${tc.format(tc.fromFrames(heard.frames, heard.rate), heard.rate)}`); engine.changed(); }
    sleepIfIdle();
  }

  // ── in ─────────────────────────────────────────────────────────────────────────────────────────────────
  const source = () => { const s = (settings() || {}).source; return s === 'mtc' || s === 'ltc' ? s : 'off'; };
  function setChase(rate) {
    chaseRate = rate;
    chaser.set(texts.map((x) => ({ id: x.id, frames: tc.framesOf(x.text, rate), length: () => engine.lengthOf(x.id) })).filter((x) => x.frames != null));
  }
  function configure(doc) {
    texts = [];
    const walk = (cues) => { for (const c of cues || []) { if (c.timecodeTrigger) texts.push({ id: c.id, text: c.timecodeTrigger }); walk(c.children); } };
    for (const l of doc.lists || []) walk(l.cues);
    setChase(chaseRate || (settings() || {}).rate || '30');
    if (source() === 'off' && heard) { heard = null; chaser.park(); }
  }
  /** Where incoming timecode is: `frames` (a fraction allowed) at `at` on this clock. `located`: said outright
   *  while not running (an MTC full frame), so it is shown and nothing is started by it. */
  function arrived(src, frames, rate, at, located) {
    const was = heard;
    heard = { frames, rate, at, source: src, running: !located };
    if (rate !== chaseRate) setChase(rate);
    if (located) { chaser.park(); if (!was || !was.running) engine.changed(); return; }
    if (!was || !was.running) { log(`timecode in (${src}) running from ${tc.format(tc.fromFrames(frames, rate), rate)} at ${tc.rateOf(rate).label} fps`); wake(); }
    const cfg = settings() || {};
    const fire = chaser.update(frames, tc.rateOf(rate).real, at, { catchUp: cfg.catchUp !== false });
    for (const f of fire) {
      if (!engine.byId.has(f.id)) continue;
      log(`timecode ${tc.format(tc.fromFrames(frames, rate), rate)} fires ${f.id}${f.offset ? `, ${Math.round(f.offset * 100) / 100} s in` : ''}`);
      if (f.offset > 0) { engine.fire(f.id, f.offset); engine.changed(); } else engine.start(f.id);
    }
    // the list follows: the playhead stands on the next cue the timecode will start
    if (cfg.follow !== false && (fire.length || !was || !was.running)) { const next = chaser.next(frames); if (next && engine.byId.has(next) && engine.playhead !== engine.topOf(next)) engine.setPlayhead(engine.topOf(next)); }
    if (!was || !was.running) engine.changed();
  }
  function midiIn(bytes, at = now()) {
    const quarter = bytes[0] === 0xf1, full = bytes[0] === 0xf0 && bytes[1] === 0x7f && bytes[3] === 0x01 && bytes[4] === 0x01;
    if (!quarter && !full) return false;
    if (source() !== 'mtc') return true;                 // timecode nobody asked for: not shown 120 times a second in the monitor either
    const r = reader.feed(bytes);
    if (r) arrived('mtc', r.frames, r.rate, at, r.full);
    return true;
  }
  function ltcIn(frame, at = now()) {
    if (source() !== 'ltc' || !frame || !frame.tc) return;
    const rate = tc.RATES[frame.rate] ? frame.rate : '30';
    if (tc.whyNot(frame.tc, rate)) return;
    arrived('ltc', tc.toFrames(frame.tc, rate) + 1, rate, at, false);      // (a frame is known once it has gone by: the time now is the one after)
  }

  function lengthOf(file) { try { return smf.parse(read(file)).seconds; } catch { return 0; } }
  function status() {
    const t = now(), out = [];
    for (const [id, r] of runs) {
      const f = entryOf(id);
      if (!f) continue;
      const el = (f.pausedAt != null ? f.pausedAt : t) - f.startedAt;
      out.push({ id, kind: r.kind, paused: f.pausedAt != null, ...(r.kind === 'file' ? {} : { rate: r.rate, text: tc.format(tc.fromFrames(r.start + tc.framesAt(Math.max(0, el), r.rate), r.rate), r.rate) }) });
    }
    const pos = heard ? heard.frames + (heard.running ? tc.framesAt(Math.min(t - heard.at, GONE_AFTER), heard.rate) : 0) : 0;
    return {
      out,
      in: heard ? { source: heard.source, rate: heard.rate, running: heard.running, text: tc.format(tc.fromFrames(pos, heard.rate), heard.rate) } : null,
      chase: source(), triggers: texts.length,
    };
  }
  function stop() { for (const id of [...runs.keys()]) drop(id); if (stopTick) { stopTick(); stopTick = null; } }

  return { run, tick, midiIn, ltcIn, configure, lengthOf, status, stop, get size() { return runs.size; } };
}

module.exports = { createTransport, TICK_MS, LOOKAHEAD, GONE_AFTER };
