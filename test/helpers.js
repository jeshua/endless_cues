/** A cue engine on a fake clock with a fake audio backend, and a small show to play. */
const { CueEngine } = require('../core/engine/cue-engine');
const show = require('../core/show/show');
const { applyOps } = require('../core/show/ops');

function rig(doc, opts = {}) {
  let t = 0, timers = [], nextId = 1;
  const clock = {
    now: () => t,
    setTimeout: (fn, ms) => { const id = nextId++; timers.push({ id, at: t + ms / 1000, fn }); return id; },
    clearTimeout: (id) => { timers = timers.filter((x) => x.id !== id); },
  };
  const advance = (secs) => {
    const end = t + secs;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end + 1e-9) break;
      timers.shift(); t = next.at; next.fn();
    }
    t = end;
  };
  const audio = { calls: [], playing: new Map() };
  audio.play = (key, o) => { audio.calls.push(['play', key, o]); audio.playing.set(key, { ...o, db: o.gainDb }); };
  audio.fade = (key, db, secs, range) => { audio.calls.push(['fade', key, db, secs, range]); const p = audio.playing.get(key); if (p && range !== 'voice') p.db = db; };
  audio.stop = (key) => { audio.calls.push(['stop', key]); audio.playing.delete(key); };
  for (const op of ['pause', 'resume', 'seek', 'setLoop', 'setRegion', 'move', 'cut']) audio[op] = (...a) => { audio.calls.push([op, ...a]); };
  const sent = [], lights = [], mixes = [], logs = [];
  const engine = new CueEngine({ audio, clock, send: (m, cue) => sent.push(m), lights: (c) => lights.push(c.lightCue || c.number), mix: (c) => mixes.push(c), log: (l) => logs.push(l), ...opts });
  engine.load(show.toEngineDoc(doc));
  return { engine, audio, advance, sent, lights, mixes, logs, now: () => t };
}

/** A show built with the same ops the app uses. Returns { doc, id(ref) }. */
function build(ops) {
  const r = applyOps(show.newShow('Test'), ops);
  return { doc: r.doc, refs: r.refs, id: (ref) => r.refs[ref] };
}

module.exports = { rig, build };
