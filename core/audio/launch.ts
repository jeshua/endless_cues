/**
 * A launch from the Live view: what it takes over.
 *
 * A track plays one clip at a time, the way a deck plays one record: a clip launched on a track takes over from
 * whatever is playing there, and a scene (a cue with sounds on several tracks) takes over every track it has a
 * sound on. A show can let clips overlap instead (`settings.live.overlap`). Only a launch does this: a GO fires
 * its cue as the cue list always has, and stops nothing it was not told to.
 *
 *   tracksOf(cue)                       the buses the sounds at or under an engine cue play on
 *   replacedBy(cue, running, byId)      the ids of the running sounds a launch of `cue` takes over
 */
/** An engine cue, as much of it as a launch reads. */
export interface LaunchCue { id: string; type: string; bus?: string; children?: LaunchCue[] }

const TAKEOVER_FADE = 0.08;       // s: the clip leaving is faded out under the one arriving, so the cut does not click

/** The audio cues at or under an engine cue (one that plays a file: a Mic cue is an input, not a clip). */
function soundsOf(cue: LaunchCue | null | undefined, out: LaunchCue[] = []) {
  if (!cue) return out;
  if (cue.type === 'audio') out.push(cue);
  for (const k of cue.children || []) soundsOf(k, out);
  return out;
}

function tracksOf(cue: LaunchCue | null | undefined) {
  return [...new Set(soundsOf(cue).map((c) => c.bus).filter(Boolean))];
}

/** `running`: the ids of what is sounding; `byId`: id → engine cue (its `bus` already decided). */
function replacedBy(cue: LaunchCue | null | undefined, running: Iterable<string>, byId: Map<string, LaunchCue>) {
  const mine = new Set(soundsOf(cue).map((c) => c.id));
  const tracks = new Set(tracksOf(cue));
  const out: string[] = [];
  for (const id of running) {
    const c = byId.get(id);
    if (c && c.type === 'audio' && !mine.has(id) && tracks.has(c.bus)) out.push(id);
  }
  return out;
}

export { soundsOf, tracksOf, replacedBy, TAKEOVER_FADE };
