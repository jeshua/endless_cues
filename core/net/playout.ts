/**
 * Playout: MIDI that has to leave on time (timecode, a MIDI file), handed over a little ahead of when it is due.
 *
 * A timer in this process wakes late by a millisecond or several, and never the same amount twice; a MIDI Timecode
 * quarter frame is due every 8 ms. So nothing here is sent "now". Each tick asks every running source for what falls
 * in the next `lookahead` seconds and hands it on stamped with the time it is due; the audio window gives the
 * stamp to the computer's MIDI system, which sends at that time. The timer's lateness then costs nothing until it
 * is longer than the lookahead (and then what is late is sent at once, in order).
 *
 * A source is anything with `between(t0, t1) -> [{ at, bytes }]` in seconds of its own time; it may have
 * `locate(t) -> [bytes]` (sent when it starts or resumes at t) and `flush() -> [bytes]` (sent when it stops or
 * pauses: the notes still sounding ended). Where a run is, and whether it is paused, is not kept here: `tick` is
 * told by `stateOf(id)` (the cue engine's own record), so the two cannot disagree. No clock and no port in this
 * file: it is driven with a fake time in the tests.
 *
 *   const p = new Playout({ lookahead: 0.1 });
 *   p.start(id, source)                 -> messages that end what `id` was playing before, if anything
 *   p.tick(now, (id) => ({ startedAt, pausedAt } | null))   -> [{ id, at, bytes }], `at` on the same clock as `now`
 */
class Playout {
  constructor({ lookahead = 0.1 } = {}) { this.lookahead = lookahead; this.runs = new Map(); }
  get size() { return this.runs.size; }
  has(id) { return this.runs.has(id); }

  start(id, source, now = 0) {
    const out = this.end(id, now);
    this.runs.set(id, { source, upTo: 0, going: false, fresh: true, edge: now });
    return out;
  }
  /** What ends a run's sound, stamped after everything already handed over for it (so no note it started is left on). */
  end(id, now) {
    const run = this.runs.get(id);
    if (!run) return [];
    this.runs.delete(id);
    return this.quiet(id, run, now);
  }
  quiet(id, run, now) {
    if (!run.going) return [];
    run.going = false;
    const at = Math.max(now, run.edge);
    return (run.source.flush ? run.source.flush() : []).map((bytes) => ({ id, at, bytes }));
  }

  tick(now, stateOf) {
    const out = [];
    for (const [id, run] of [...this.runs]) {
      const st = stateOf(id);
      if (!st) { out.push(...this.end(id, now)); continue; }                     // stopped, or it ran its length
      if (st.pausedAt != null) { out.push(...this.quiet(id, run, now)); continue; }
      const elapsed = now - st.startedAt;
      if (!run.going) {
        // (started a moment ago: from its top, so its first messages are not lost to the time it took to get here)
        run.going = true; run.upTo = run.fresh && elapsed < this.lookahead ? 0 : Math.max(0, elapsed); run.fresh = false;
        for (const bytes of (run.source.locate ? run.source.locate(run.upTo) : [])) out.push({ id, at: now, bytes });
      }
      const horizon = elapsed + this.lookahead;
      if (horizon <= run.upTo) continue;
      for (const e of run.source.between(run.upTo, horizon)) out.push({ id, at: st.startedAt + e.at, bytes: e.bytes });
      run.upTo = horizon;
      run.edge = st.startedAt + horizon;
    }
    return out;
  }
}

/** MIDI Timecode as a source: quarter frames from `start` (in frames) at `rate`, and a full frame wherever it starts or resumes. */
function mtcSource(tc, start, rate) {
  return {
    between: (t0, t1) => tc.mtcBetween(start, rate, t0, t1),
    locate: (t) => [tc.fullFrame(tc.fromFrames(start + Math.floor(tc.framesAt(t, rate) + 1e-6), rate), rate)],
  };
}

export { Playout, mtcSource };
