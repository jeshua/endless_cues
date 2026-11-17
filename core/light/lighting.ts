/**
 * Lighting, put together: the patch from the show file, the rig that holds the levels, the cue
 * engine that says when a Light cue goes, and the output that puts DMX on the network.
 *
 *   show file (settings.light) ──▶ configure() ──▶ rig (levels) ──▶ render ──▶ output ──▶ Art-Net / sACN
 *   cue engine: a Light cue goes ──▶ rig.run … and every refresh asks the engine how far that fade has got
 *   dashboard: cmd({ op: 'light-…' }) ──▶ a hand on the levels; record them into a cue (an edit, like any other)
 *
 * One timer runs it, at the refresh rate (40 a second unless the show says otherwise): it moves the
 * fades on, renders, and sends every universe whether it changed or not. With no instrument patched
 * there is no timer and no socket: a show that has no lights pays nothing.
 *
 * What stops the lights, and what does not (decided here, and said in the manual):
 *
 *   Panic (Esc)   the fades in flight stop where they are; the levels stay. It does NOT black out:
 *                 Esc is the key for sound gone wrong, pressed in a hurry, and a stage that goes
 *                 dark under people who are moving is a hazard a wrong sound is not. A show that
 *                 wants Esc to take the lights too says so (settings.light.panicBlackout): then
 *                 everything goes home over the panic time, and at once on the second Esc.
 *   Reset         the fades stop; the levels stay as they are (a rehearsal goes back to the top
 *                 with the work lights of the last cue still on, not in the dark).
 *   Blackout      its own control, in the dashboard: every intensity out on the wire, the levels
 *                 untouched underneath, until it is switched off again.
 *
 * Plain node: the engine, the document's edit function and the clock are handed in. `dryRun` (the
 * app's test runs) makes every packet and sends none (core/light/output.js).
 */
import * as patchLib from './patch';
import * as fixtures from './fixtures';
import * as commands from './commands';
import { createRig } from './rig';
import { createLightOutput } from './output';

function createLighting({ log = () => {}, changed = () => {}, dryRun = false, clock = () => Date.now() / 1000, output = null, timers = { setInterval, clearInterval } } = {}) {
  const rig = createRig();
  const out = output || createLightOutput({ dryRun, log, changed });
  let engine = null;
  let light = patchLib.defaults();
  let patch = rig.patch();
  let timer = null, rate = 0;
  let lastPush = 0;
  let frames = 0;

  /** One refresh: the fades move on, and every universe is sent. */
  function step() {
    const now = clock();
    for (const m of rig.moving()) {
      if (!m.external) continue;
      // a cue's fade is the engine's: how far it has got is read from there, so pause, resume and stop need no second clock
      const f = engine && engine.fades.get(m.id);
      if (!f || !f.light) { rig.halt(m.id); continue; }
      rig.progress(m.id, Math.min(0.9999, ((f.pausedAt != null ? f.pausedAt : engine.clock.now()) - f.startedAt) / f.total));      // (it lands when the engine says it is done)
    }
    const moving = rig.tick(now);
    frames++;
    out.send(rig.render());
    // a hand's fade has no cue running to keep the window fed: ask for a redraw ten times a second while one moves
    if (moving && now - lastPush > 0.1) { lastPush = now; changed(); }
  }
  function retime() {
    const want = patch.instruments.size ? patch.rate : 0;
    if (want === rate && (timer || !want)) return;
    if (timer) timers.clearInterval(timer);
    timer = null; rate = want;
    if (!want) return;
    timer = timers.setInterval(() => { try { step(); } catch (err) { log(`refresh: ${err.stack || err}`); } }, 1000 / want);
    if (timer && timer.unref) timer.unref();
  }

  const api = {
    rig, output: out, step,

    /** The show's light settings, whenever the show changes. Levels are kept for the instruments that are still there. */
    configure(settings) {
      light = { ...patchLib.defaults(), ...(settings && typeof settings === 'object' ? settings : {}) };
      patch = rig.setPatch(patchLib.compile(light));
      out.configure(patch.universes, { on: patch.on && patch.instruments.size > 0 });
      retime();
    },

    /** The engine whose Light cues these are. */
    attach(eng) {
      engine = eng;
      engine.dmxHook = (action, cue, target) => {
        const secs = Number(cue.duration) || 0;
        if (action === 'run') {
          const r = rig.run(cue, { external: secs > 0 });
          for (const e of r.errors) log(`${cue.number || cue.id}: line ${e.line} (“${e.text}”) ${e.why}`);
          log(`${cue.number || cue.id}: ${r.count} level${r.count === 1 ? '' : 's'}${secs > 0 ? ` over ${secs} s` : ''}${cue.block ? ' (full state)' : ''}`);
        } else if (action === 'fade') {
          const outwards = !(Number(cue.db) > -60);
          const r = rig.fadeCue(cue.id, target, { out: outwards, secs, external: secs > 0 });
          log(`${cue.number || cue.id}: ${r.count} level${r.count === 1 ? '' : 's'} of ${target.number || target.name || target.id} ${outwards ? 'home' : 'back'}${secs > 0 ? ` over ${secs} s` : ''}`);
        } else if (action === 'done') rig.finish(cue.id);
        step();
      };
    },

    /** Esc. `hard`: the second one. Returns what it did, for the log. */
    panic(hard, fadeSecs = 1) {
      rig.haltAll();
      if (!patch.panicBlackout || !patch.instruments.size) return 'held';
      rig.clear({ secs: hard ? 0 : fadeSecs, now: clock() });
      log(hard ? 'PANIC: lights out' : `PANIC: lights out over ${fadeSecs} s`);
      step();
      return 'out';
    },
    /** Reset: nothing moves any more; the levels stay. */
    reset() { rig.haltAll(); step(); },
    /** DMX out held back for a rehearsal (the host's override): the lights are worked out as ever, and nothing is sent. */
    hold(on) { out.hold(on); changed(); },

    /**
     * The dashboard's commands. `ctx`: { edit(ops, label) → { made }, cueOf(id), locked } from the host.
     * Returns { ok } | { error } like any host command.
     */
    cmd(c, ctx = {}) {
      const now = clock();
      const secs = Math.max(0, Number(c.secs) || 0);
      switch (c.op) {
        case 'light-set': {
          const r = rig.set(String(c.text || ''), { secs, now });
          step();
          if (r.errors.length) return { error: r.errors.map((e) => `“${e.text}”: ${e.why}`).join(' · '), count: r.count };
          return { ok: true, count: r.count };
        }
        case 'light-level': {
          const r = rig.setLevel(c.name, c.param || null, c.value, { secs, now });
          step();
          return r.errors.length ? { error: r.errors[0].why } : { ok: true };
        }
        case 'light-blackout': rig.setBlackout(c.on === undefined ? !rig.blackout() : !!c.on); log(rig.blackout() ? 'BLACKOUT' : 'blackout off'); step(); return { ok: true, blackout: rig.blackout() };
        case 'light-clear': rig.clear({ secs, now }); log('lights cleared (everything home)'); step(); return { ok: true };
        case 'light-revert': { const n = rig.revert({ secs, now }); step(); return { ok: true, count: n }; }
        // what is live becomes a cue: a new one (only what hands changed, or everything as a full state), or the cue named is updated
        case 'light-record': {
          if (ctx.locked) return { error: 'Show mode: editing is locked (switch to Edit to record a cue)' };
          const all = c.mode === 'all';
          const levels = rig.capture({ changes: !all });
          if (!levels.size) return { error: all ? 'there are no instruments to record (Settings ▸ Integrations ▸ Light)' : 'nothing has been changed by hand: move a level first, or record everything' };
          let id = c.id || null;
          if (id) {
            const cue = ctx.cueOf && ctx.cueOf(id);
            if (!cue || cue.type !== 'light') return { error: 'select a Light cue to update' };
            const text = all ? commands.format(levels, patch) : commands.merge(cue.levels || '', levels, patch);
            ctx.edit([{ op: 'cue.set', id, props: { levels: text, ...(all ? { block: true } : {}) } }], 'update light cue');
          } else {
            const r = ctx.edit([{ op: 'cue.add', cue: { type: 'light', levels: commands.format(levels, patch), ...(all ? { block: true } : {}) }, ...(c.after ? { after: c.after } : {}) }], 'record light cue');
            id = r && r.made && r.made[0];
          }
          rig.recorded([...levels.keys()], id);
          return { ok: true, id, count: levels.size };
        }
        // a fixture of the show's own, written as text (Settings ▸ Integrations ▸ Light): checked here, kept in the show file
        case 'light-fixture': {
          if (ctx.locked) return { error: 'Show mode: editing is locked' };
          const name = String(c.name || '').trim();
          if (!name) return { error: 'a fixture needs a name' };
          const r = fixtures.parseText(c.text);
          if (!r.ok) return { error: r.why };
          const own = Array.isArray(light.fixtures) ? light.fixtures : [];
          let id = c.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fixture';
          if (!c.id) { const base = id; for (let n = 2; fixtures.all(own).has(id); n++) id = `${base}-${n}`; }
          const def = { id, name, params: r.params };
          ctx.edit([{ op: 'show.set', path: 'settings.light.fixtures', value: own.some((f) => f.id === id) ? own.map((f) => (f.id === id ? def : f)) : [...own, def] }], 'light fixture');
          return { ok: true, id };
        }
        default: return { error: `no lighting command ${c.op}` };
      }
    },

    /** What the views are sent. */
    snapshot() {
      const s = rig.snapshot();
      const o = out.status();
      return {
        ...s,
        on: patch.on, rate: patch.rate, panicBlackout: patch.panicBlackout, dryRun: !!o.dryRun, held: !!o.held,
        problems: patch.problems,
        universes: patch.universes.map((u) => ({ ...u, ...(o.universes.find((x) => x.id === u.id) || {}) })),
        nodes: o.nodes, listing: o.listing, outputError: o.error, packets: o.packets, sending: o.on,
        fixtures: fixtures.list(light.fixtures),
      };
    },
    /** The levels last made for a universe, as they would be on the wire (a test run looks here): Buffer of 512, or null. */
    frame(universe) { const f = rig.render().get(universe); return f || null; },
    stats: () => ({ frames, rate, timer: !!timer }),

    close() {
      if (timer) timers.clearInterval(timer);
      timer = null; rate = 0;
      out.close();
    },
  };
  return api;
}

export { createLighting };
