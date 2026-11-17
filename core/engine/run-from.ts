/**
 * Run from here: start a rehearsal at a cue with what would be going on there had the show run up to it.
 *
 * QLab starts a rehearsal at cue 40 in silence: the rain loop that cue 31 started, the music cue 35 faded to −12,
 * the lamp cue 38 turned blue are all missing, and the operator fires them by hand, guessing. Here the show is run
 * up to the cue in a moment, by the real engine on a clock of its own with no sound and nothing sent (as
 * dry-run.js does), and what it leaves behind is what is brought back:
 *
 *   - the sounds still going at that cue: anything that loops (a loop, a held section, a microphone, a picture that
 *     stays until it is stopped), and anything the show itself stops or fades at or after the cue (so it must
 *     still be playing there); each at the level the fades before left it at;
 *   - where each is: known only when the cue comes in the same run of continues as the GO that started the sound
 *     (the waits between are the show's own); after any other GO the operator's own pause is not known, so a
 *     sound starts from its start, or from the section it holds;
 *   - what the cues before it set on the equipment and the mixer, the last word on each thing winning: a device's
 *     command, an OSC address on a patch, a MIDI controller or program, the lighting desk's cue, the app's own
 *     lights, a bus's level. Those cues are fired again, in order.
 *
 * A sound that plays once and is never stopped by the show (a door slam) is left out: it ended by itself.
 *
 *   plan(doc, id, { durations, skipLights, disarmed })   → { from, list, sounds, sends, left, text } | { error }
 *     sounds [{ id, number, name, db, at, why }]  at: seconds into the cue (from its Start at), or 0
 *     sends  [{ id, number, name, kind }]          kind: device | network | midi | light | mix
 *   apply(engine, plan)                            stops what is playing, starts it all, puts the playhead on the cue
 *
 * Pure: the plan is worked out on its own engine; only apply() touches the real one.
 */
import { CueEngine } from './cue-engine';
import * as show from '../show/show';
import * as midi from '../net/midi';
import { cleanLimits } from '../audio/curves';

const STOP = Symbol('reached');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function plan(doc, fromId, { durations = {}, skipLights = false, disarmed = null, maxSecs = 6 * 3600 } = {}) {
  const edoc = show.toEngineDoc(doc);
  const list = edoc.lists.find((l) => l.cues.some((c) => c.id === fromId));
  if (!list) return { error: 'run from a cue at the top of a list' };

  // ── an engine of its own, on a clock that is moved by hand ──
  let t = 0, timers = [], nextId = 1;
  const clock = {
    now: () => t,
    setTimeout: (fn, ms) => { const id = nextId++; timers.push({ id, at: t + Math.max(0, ms) / 1000, fn }); return id; },
    clearTimeout: (id) => { timers = timers.filter((x) => x.id !== id); },
  };
  let goNo = 0;
  const startedIn = new Map();      // sound -> the GO whose sequence started it
  const ends = new Map();           // sound -> the timer that ends it (a sound of known length that does not loop)
  let sim;
  const audio = {
    play: (key, o) => {
      startedIn.set(key, goNo);
      clock.clearTimeout(ends.get(key));
      const d = durations[o.file];
      if (d > 0 && !o.loop) ends.set(key, clock.setTimeout(() => { ends.delete(key); sim.audioEnded(key); }, Math.max(0, d - (o.from || 0)) * 1000));
    },
    stop: (key) => { clock.clearTimeout(ends.get(key)); ends.delete(key); },
  };
  for (const op of ['fade', 'move', 'rate', 'sweep', 'pause', 'resume', 'seek', 'cut', 'setLoop', 'setRegion', 'duck']) audio[op] = () => {};
  // what was set on the equipment and the mixer, by what: the last word on each thing wins
  const last = new Map();           // what it set -> { id, seq, kind }
  let seq = 0;
  const said = (key, cue, kind) => { if (key && cue && cue.id) last.set(key, { id: cue.id, seq: ++seq, kind }); };
  const addressOf = (m) => { const s = String(m || '').trim(); return s.startsWith('/') ? s.split(/\s+/)[0] : s; };
  sim = new CueEngine({
    audio, clock, panicFade: doc.settings.go.panicFade, limits: cleanLimits(doc.settings.audio.levels),
    send: (message, cue) => said(`net ${cue && cue.patch || ''} ${addressOf(message)}`, cue, cue && cue.sends ? 'device' : 'network'),
    midi: (cue) => {
      let m; try { m = midi.parseText(cue.midi); } catch { return; }
      const ch = m.channel || 1;
      // (a note is a moment, not a state: it is not played again)
      const key = m.kind === 'cc' ? `cc ${ch} ${m.number}` : m.kind === 'kp' ? `kp ${ch} ${m.number}` : ['pc', 'cp', 'bend'].includes(m.kind) ? `${m.kind} ${ch}` : null;
      if (key) said(`midi ${key}`, cue, cue.sends ? 'device' : 'midi');
    },
    lights: (cue) => said('light desk', cue, 'light'),
    mix: (cue) => { for (const bus of Object.keys(cue.levels || {})) said(`mix ${bus}`, cue, 'mix'); if (cue.desk) said('mix desk', cue, 'mix'); },
  });
  sim.dmxHook = (action, cue) => { if (action === 'run') said(`dmx ${cue.id}`, cue, 'light'); };
  sim.skipLights = !!skipLights;
  sim.load(edoc);
  if (disarmed) sim.disarmed = new Set(disarmed);

  // the cue itself is never fired: reaching it (by a GO, a continue or a Start cue) is where the run stops
  let reached = false, reachedIn = -1;
  const fire = sim.fire.bind(sim);
  sim.fire = (id, ...rest) => { if (id === fromId) { reached = true; reachedIn = goNo; throw STOP; } return fire(id, ...rest); };
  const step = (fn) => { try { fn(); } catch (err) { if (err !== STOP) throw err; } };
  // after a GO: its waits, fades and follows run out (a sound followed by the next cue plays to its end first);
  // then the next GO comes at once, as no one knows how long the operator would have waited
  const settle = () => {
    const until = t + maxSecs;
    for (let k = 0; k < 20000 && !reached; k++) {
      if (!sim.waits.size && !sim.following.size && !sim.fades.size) break;
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > until) break;
      timers.shift(); t = next.at;
      step(next.fn);
    }
  };
  const stops = sim.steps(list.name);
  const at = stops.findIndex((c) => c.id === fromId);
  if (at < 0) return { error: 'that cue is not one the playhead stops on (light cues are off)' };
  sim.heads.set(list.name, stops.length ? stops[0].id : null);
  for (let n = 0; n < stops.length * 4 + 10 && !reached; n++) {
    const i = stops.findIndex((c) => c.id === sim.heads.get(list.name));
    if (i < 0 || i >= at) break;
    goNo++;
    step(() => sim.go(list.name));
    settle();
  }

  // ── what is still going, and which of it to bring back ──
  const { byId } = show.index(doc);
  const later = new Set();          // cues that something at or after the cue stops, fades, pauses or moves
  const fromHere = list.cues.slice(list.cues.findIndex((c) => c.id === fromId));
  const ACTS_ON = new Set(['fade', 'stop', 'pause', 'devamp', 'music']);
  const walk = (cues) => { for (const c of cues) { if (ACTS_ON.has(c.type) && c.target) later.add(c.target); if (c.children) walk(c.children); } };
  walk(fromHere);
  const expected = (id) => { for (let x = id; x; x = sim.parentOf.get(x)) if (later.has(x)) return true; return false; };
  const sounds = [], left = [];
  for (const [id, r] of sim.running) {
    const c = sim.byId.get(id);
    if (!c) continue;
    const held = (c.loops || []).find((g) => g && g.hold);
    const goesOn = c.type === 'mic' || !!r.loop || !!c.loop || !!held || (r.still && !(Number(c.duration) > 0)) || (c.picture && c.holdEnd);
    const known = reached && startedIn.get(id) === reachedIn;
    const why = goesOn ? 'goes on' : known ? 'still playing' : expected(id) ? 'stopped later' : null;
    if (!why) { left.push(id); continue; }
    const into = known ? Math.max(0, sim.positionOf(r) - (Number(c.from) || 0)) : held ? Math.max(0, Number(held.start) - (Number(c.from) || 0)) : 0;
    const src = byId.get(id) || {};
    sounds.push({ id, number: src.number || '', name: src.name || c.name || '', db: Math.round((r.fade ? r.fade.to : r.db) * 10) / 10, at: Math.round(into * 100) / 100, why,
      kind: c.type === 'mic' ? 'mic' : r.still || c.picture ? 'picture' : 'sound' });
  }
  // in the order they started
  const firstAt = new Map([...sim.running].map(([id, r]) => [id, r.startedAt]));
  sounds.sort((a, b) => firstAt.get(a.id) - firstAt.get(b.id));
  // each cue that has the last word on something, once, in the order it said it
  const latest = new Map();
  for (const v of last.values()) { const was = latest.get(v.id); if (!was || v.seq > was.seq) latest.set(v.id, v); }
  const sends = [...latest.values()].sort((a, b) => a.seq - b.seq).map((v) => { const src = byId.get(v.id) || {}; return { id: v.id, number: src.number || '', name: src.name || (sim.byId.get(v.id) || {}).name || '', kind: v.kind }; });
  const out = { from: fromId, list: list.name, sounds, sends, left, reachedByContinue: reached };
  out.text = describe(out);
  return out;
}

/** "Starts 3 sounds and sets 2 devices." in as few words as it takes. */
function describe(p) {
  const n = (k) => p.sounds.filter((x) => x.kind === k).length, s = (k) => p.sends.filter((x) => x.kind === k).length;
  const parts = [
    n('sound') ? `starts ${plural(n('sound'), 'sound')}` : '', n('mic') ? `opens ${plural(n('mic'), 'microphone')}` : '', n('picture') ? `shows ${plural(n('picture'), 'picture')}` : '',
    s('device') ? `sets ${plural(s('device'), 'device')}` : '', s('network') ? `sends ${plural(s('network'), 'message')}` : '', s('midi') ? `sends ${plural(s('midi'), 'MIDI message')}` : '',
    s('light') ? `sets the lights${s('light') > 1 ? ` (${s('light')} cues)` : ''}` : '', s('mix') ? 'sets the mixer' : '',
  ].filter(Boolean);
  if (!parts.length) return 'Nothing to bring back: it starts from silence.';
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** Do it on the engine that plays: everything stops dead, what was worked out starts, the playhead goes to the cue. */
function apply(engine, p) {
  engine.panic(); engine.panic();                       // (twice: the second is the hard stop)
  for (const x of p.sends) if (engine.byId.has(x.id)) engine.fire(x.id);
  for (const x of p.sounds) {
    const c = engine.byId.get(x.id);
    if (!c) continue;
    engine.fire(x.id, (Number(c.preWait) || 0) + (x.at || 0));
    const r = engine.running.get(x.id);
    // at the level the fades before left it at (over its own fade in, if it has one)
    if (r && Math.abs((r.fade ? r.fade.to : r.db) - x.db) > 0.05) engine.fadeAudio(x.id, x.db, Number(c.fadeIn) || 0, false, `level:${x.id}`);
  }
  engine.setPlayhead(p.from);
  engine.changed();
}

export { plan, apply, describe };
