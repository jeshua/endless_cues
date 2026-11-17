/**
 * Chasing incoming timecode: which cues to start as the time goes by, and which to start part way in when the
 * time arrives already in the middle of them.
 *
 * It is told where the timecode is each time the host hears (`update`), and answers with the cues to start. While
 * the time runs on from where it was, a cue starts as its time is passed. When the time appears, or jumps (the
 * tape was located somewhere else), nothing that was skipped over is fired: a cue whose time is just here starts,
 * and, with `catchUp`, so does a cue that would by now be part way through, that far in. Positions are in frames
 * at the incoming rate; `real` is how many of them go by in a second. No clock of its own: `now` is the caller's.
 *
 *   const c = new Chaser();
 *   c.set([{ id, frames, length }])            the cues with a timecode trigger (length in seconds, or a function
 *                                              that answers with it when asked; 0: not known)
 *   c.update(pos, real, now, { catchUp })      -> [{ id, offset }]   (offset in seconds; 0: from its start)
 *   c.park()                                   the timecode stopped, or was only located: the next update is an arrival
 *   c.next(pos)                                -> the id of the first cue whose time is still ahead, or null
 */
const JUMP_SECS = 0.25;         // further than this from where it should be by now: the time was moved, not played
const START_FRAMES = 3;         // a cue this close behind an arrival starts from its top (MTC is known two frames late)

class Chaser {
  constructor() { this.triggers = []; this.last = null; }
  set(triggers) { this.triggers = [...triggers].filter((t) => Number.isFinite(t.frames)).sort((a, b) => a.frames - b.frames); }
  park() { this.last = null; }
  update(pos, real, now, { catchUp = true } = {}) {
    const last = this.last, out = [];
    this.last = { pos, now };
    const jumped = !last || pos < last.pos - 0.01 || Math.abs(pos - (last.pos + (now - last.now) * real)) > JUMP_SECS * real;
    // (a jump forward has not been back over a time already passed: that cue had its moment, so it is not started
    // again; LTC heard in bursts on a busy computer looks like a run of small jumps)
    const ahead = last && pos >= last.pos - 0.01;
    for (const t of this.triggers) {
      const into = pos - t.frames;
      if (into < 0) break;
      if (!jumped) { if (t.frames > last.pos) out.push({ id: t.id, offset: 0 }); continue; }
      if (ahead && t.frames <= last.pos) continue;
      if (into <= START_FRAMES) out.push({ id: t.id, offset: 0 });
      else if (catchUp) { const length = typeof t.length === 'function' ? t.length() : t.length; if (length > 0 && into / real < length) out.push({ id: t.id, offset: into / real }); }
    }
    return out;
  }
  next(pos) { const t = this.triggers.find((x) => x.frames > pos); return t ? t.id : null; }
}

module.exports = { Chaser, JUMP_SECS, START_FRAMES };
