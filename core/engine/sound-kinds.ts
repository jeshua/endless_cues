/**
 * What a bus's kind asks of the cue engine, and a Fade that moves a sound's design.
 *
 *  - a bus that fades its stops (`stopFade`: music): a Stop cue, or the operator's stop, fades a sound on it out
 *    over that time and then stops it, instead of cutting it. A hard stop (Panic twice, Reset, a second trigger
 *    that says "Stops it") still cuts; Panic has its own fade.
 *  - a bus that plays one sound at a time (`oneAtATime`: ambience): a sound starting on it fades out whatever
 *    else is playing on it over that time, and comes in over the same time unless it has a fade-in of its own.
 *  - a bus whose sounds are left alone (`noDuck`: microphones): they are left out of another cue's "Duck others while running".
 *  - a Fade cue's `chainTo`: settings of its target's sound design moved over the Fade's time (a filter sweep).
 *
 * `engine.busRules` is { busId: { stopFade, oneAtATime, live } } (core/audio/kinds.js `rulesOf`; the host sets
 * it from the show; `live` is the bus's `noDuck`). Empty, as it is for a new show and for every show that has
 * switched none of these on, nothing here does anything.
 *
 * These are methods of CueEngine (cue-engine.js installs them).
 */
import type { CueEngine } from './cue-engine';
export function soundKinds({ SILENT_DB, busOf }) {
  return {
    /** The rules of the bus a cue plays on (none: an empty object). */
    busRule(id) {
      const c = this.byId.get(id);
      return (c && (c.type === 'audio' || c.type === 'mic') && this.busRules && this.busRules[busOf(c)]) || {};
    },

    /** A sound stopped by a Stop cue or by the operator: on a bus that fades its stops, it goes out over that
     *  time. Returns whether it did (false: the caller stops it dead, as always). */
    softStop(id) {
      const r = this.running.get(id), secs = this.busRule(id).stopFade;
      if (!r || !(secs > 0) || r.pausedAt != null || this.paused.has(id)) return false;
      // (already on its way out, by this or by a Fade that stops it: left to land)
      if (this.fades.has(`stop:${id}`)) return true;
      this.fadeAudio(id, SILENT_DB, secs, true, `stop:${id}`);
      return true;
    },

    /** A sound about to start on a bus that plays one at a time: the others on it fade out and stop. Returns the
     *  time the new one should come in over (0: nothing was playing there, or the bus has no such rule). */
    takeOver(cue) {
      const secs = this.busRule(cue.id).oneAtATime;
      if (!(secs > 0)) return 0;
      const bus = busOf(cue);
      let any = false;
      for (const k of [...this.running.keys()]) {
        const c = this.byId.get(k);
        if (k === cue.id || !c || (c.type !== 'audio' && c.type !== 'mic') || busOf(c) !== bus) continue;
        any = true;
        if (this.running.get(k).pausedAt != null || this.paused.has(k)) { this.stopAudio(k); continue; }
        this.following.delete(this.topOf(k));               // taken over, not finished: what was to follow it does not
        this.leavePlaylists(k);
        this.fadeAudio(k, SILENT_DB, secs, true, `stop:${k}`);
      }
      if (any) this.log(`  ↳ ${cue.id} takes over its bus (${bus}): a ${secs} s crossfade`);
      return any ? secs : 0;
    },

    /** A Fade cue's `chainTo`, on each sound it moves. */
    sweepDesign(cue, ids, secs) {
      if (!cue.chainTo || typeof cue.chainTo !== 'object' || !this.audio.sweep) return;
      for (const k of ids) if (this.running.has(k)) this.audio.sweep(k, cue.chainTo, secs);
    },
  } satisfies ThisType<CueEngine>;
}

export type SoundKinds = ReturnType<typeof soundKinds>;
