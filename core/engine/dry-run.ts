/**
 * A dry run: the real engine playing a show with no sound, no network and no waiting.
 *
 *   simulate(doc, { from: '12', gos: 2, durations: { 'media/rain.wav': 12 } })
 *     → { events: [{ t, text }], playing: [...], playhead }
 *
 * The clock is a number this advances by hand, the audio backend only writes down what it was
 * asked to do, and a sound "ends" when its known length has run. So what comes back is exactly
 * what the engine would do, second by second: which sounds start, at what level and where, which
 * fades move what, what is sent to which patch, and what is still sounding at the end.
 *
 * Used by the assistant to check a sequence it has built before proposing it, and by anyone who
 * wants to read a show rather than listen to it (`ec simulate`).
 */
import { CueEngine } from './cue-engine';
import * as show from '../show/show';

const fmt = (t) => `${t.toFixed(2).padStart(7)} s`;
const dB = (d) => (d <= -60 ? 'silence' : `${d > 0 ? '+' : ''}${Math.round(d * 10) / 10} dB`);

function simulate(doc, { from = null, gos = 1, durations = {}, settle = 30, gap = null, maxEvents = 400 } = {}) {
  let t = 0, timers = [], nextId = 1;
  const events = [];
  const say = (text) => { if (events.length < maxEvents) events.push({ t: Math.round(t * 100) / 100, text }); };
  const clock = {
    now: () => t,
    setTimeout: (fn, ms) => { const id = nextId++; timers.push({ id, at: t + Math.max(0, ms) / 1000, fn }); return id; },
    clearTimeout: (id) => { timers = timers.filter((x) => x.id !== id); },
  };
  const advance = (secs) => {
    const end = t + secs;
    for (let guard = 0; guard < 100000; guard++) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end + 1e-9) break;
      timers.shift(); t = next.at; next.fn();
    }
    t = end;
  };
  const { byId } = show.index(doc);
  const name = (id) => { const c = byId.get(id); return c ? (c.name || c.file || c.type) : id; };
  const ends = new Map();           // sound key -> the timer that ends it
  let engine;
  const endAt = (key, secs) => { clock.clearTimeout(ends.get(key)); if (secs > 0) ends.set(key, clock.setTimeout(() => { ends.delete(key); say(`${name(key)} reaches its end`); engine.audioEnded(key); }, secs * 1000)); };
  const audio = {
    play: (key, o) => { say(`▶ ${name(key)} plays (${o.file}) at ${dB(o.gainDb)} on ${o.bus}${o.from ? `, from ${o.from} s` : ''}${o.loop ? ', looping' : ''}`); const d = durations[o.file]; if (d > 0 && !o.loop) endAt(key, d - (o.from || 0)); },
    fade: (key, db, secs, range) => say(`◢ ${name(key)} ${range === 'voice' ? 'voice band ' : ''}→ ${range === 'voice' ? `${db} dB` : dB(db)}${secs > 0 ? ` over ${Math.round(secs * 100) / 100} s` : ''}`),
    duck: (key, db, secs) => say(db ? `${name(key)} is held ${db > 0 ? '+' : ''}${db} dB by a cue that ${db > 0 ? 'boosts' : 'ducks'} the others${secs > 0 ? ` (over ${secs} s)` : ''}` : `${name(key)} comes back to its level${secs > 0 ? ` (over ${secs} s)` : ''}`),
    stop: (key) => { clock.clearTimeout(ends.get(key)); ends.delete(key); say(`■ ${name(key)} stops`); },
    pause: (key) => say(`❙❙ ${name(key)} pauses`),
    resume: (key) => say(`▶ ${name(key)} resumes`),
    seek: (key, at) => say(`${name(key)} skips to ${at} s`),
    cut: () => {}, setRegion: (key, a, b) => say(a == null ? `${name(key)} lets go of its loop` : `${name(key)} loops ${a}–${b} s`),
    setLoop: (key, on) => say(`${name(key)} ${on ? 'loops' : 'will finish this pass and end'}`),
    move: (key, o) => say(`${name(key)} moves to ${Math.round(o.to * 100) / 100} s (${o.sync.blend}, ${o.sync.xf} s)`),
  };
  const patches = new Map(doc.settings.network.patches.map((p) => [p.id, p.name]));
  // (a device is somewhere a message can go, as a patch is; "the only patch" still counts patches only)
  const devices = new Map(((doc.settings.rig || {}).devices || []).map((d) => [d.id, d.name]));
  engine = new CueEngine({
    audio, clock, panicFade: doc.settings.go.panicFade,
    // a Device cue says what it is as well as what it sends: "⇄ Lantern A ▸ Effect (breathe)  /ec/effect breathe  → Lantern A"
    send: (message, cue) => say(`⇄ ${cue && cue.sends ? `${cue.sends}  ` : ''}${message}  → ${patches.get(cue && cue.patch) || devices.get(cue && cue.patch) || (patches.size === 1 ? [...patches.values()][0] : 'NO PATCH')}`),
    midi: (cue) => { if (cue && cue.sends) say(`⇄ ${cue.sends}  ${cue.midi}  → MIDI`); },
    lights: (cue) => say(`☀ light cue ${cue.lightCue || cue.number}: called, and fired on the desk if its module is on`),
    mix: (cue) => say(`⎚ mixer → ${JSON.stringify(cue.levels || {})} over ${cue.duration || 0} s`),
    log: (line) => { if (/^(GO|  ↳ auto|skipped|MISSING|STOP ALL)/.test(line)) say(line.trim()); },
  });
  engine.dmxHook = (action, cue, target) => { if (action === 'run') say(`☀ lights → ${String(cue.levels || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(', ')}${Number(cue.duration) > 0 ? ` over ${cue.duration} s` : ''}${cue.block ? ' (full state)' : ''}`); else if (action === 'fade') say(`☀ lights of ${target.number || target.name}: ${Number(cue.db) > -60 ? 'back to its levels' : 'home'} over ${cue.duration || 0} s`); };
  engine.load(show.toEngineDoc(doc));
  for (const [file, secs] of Object.entries(durations)) engine.setDuration(file, secs);
  if (from != null && !engine.jumpTo(String(from).replace(/^#/, ''))) return { error: `no cue numbered ${from}`, events: [] };
  const problems = show.problems(doc).filter((p) => p.level === 'error').map((p) => `${name(p.id)}: ${p.why}`);

  for (let i = 0; i < gos; i++) {
    if (!engine.playhead) { say('(end of the list: nothing to GO)'); break; }
    engine.go();
    // between GOs: a fixed gap if one is given, else until everything that will happen by itself has happened
    if (gap != null) advance(gap);
    else for (let waited = 0; waited < settle && (timers.length > 0); waited += 0.25) advance(0.25);
  }
  const playing = [...engine.running].map(([id, r]) => `${name(id)} at ${dB(r.fade ? r.fade.to : r.db)}${r.loop ? ' (looping)' : ''}`);
  const ph = engine.playhead && byId.get(engine.playhead);
  return { events, playing, playhead: ph ? `${ph.number ? '#' + ph.number + ' ' : ''}${ph.name || ph.type}` : 'end of list', problems, truncated: events.length >= maxEvents };
}

/** The same, as text. */
function describe(result) {
  if (result.error) return result.error;
  const lines = result.events.map((e) => `${fmt(e.t)}  ${e.text}`);
  lines.push('', `Still sounding afterwards: ${result.playing.length ? result.playing.join('; ') : 'nothing'}`, `Standing by: ${result.playhead}`);
  if (result.problems.length) lines.push(`Broken cues (skipped when fired): ${result.problems.join('; ')}`);
  if (result.truncated) lines.push('(more happened than is listed)');
  return lines.join('\n');
}

export { simulate, describe };
