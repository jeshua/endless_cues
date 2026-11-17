/**
 * Does this show use the Live view?
 *
 * The Live view (the mixing desk, tempo finding, warp, launches on the bar) is hidden until it is switched on
 * (docs/specs/00-defaults.md). A show made with it still plays as it was made when it is hidden: the engine does
 * what the show says. This says, in a few words, what in a show came from the Live view, so the window can say
 * so in one line and offer to show it.
 *
 *   usesLive(doc)  -> ['2 warped sounds', 'a Mix cue that recalls the desk', …]   (empty: a plain cue list)
 *
 * A tempo on a sound, and a cue that waits for the beat or the bar, are not counted: those are the cue list's own
 * (a tempo is asked for on the sound's Time & Loops tab; Quantise is a field of a group).
 */
import { settingsOf } from '../audio/strip';
import type { ShowDoc, Cue } from './types';

const many = (n: number, one: string, more: string) => (n === 1 ? one : `${n} ${more}`);

function usesLive(doc: Partial<ShowDoc> | null | undefined) {
  const out: string[] = [];
  if (!doc || typeof doc !== 'object') return out;
  let warped = 0, desks = 0;
  const walk = (cues: Cue[] | undefined) => {
    for (const c of cues || []) {
      if (c.type === 'audio' && c.warp && c.tempo) warped++;
      if (c.type === 'mix' && c.desk && typeof c.desk === 'object' && Object.keys(c.desk).length) desks++;
      if (c.children) walk(c.children);
    }
  };
  for (const l of doc.lists || []) walk(l.cues);
  const settings: Partial<ShowDoc['settings']> = doc.settings || {}, live: Partial<ShowDoc['settings']['live']> = settings.live || {}, audio: Partial<ShowDoc['settings']['audio']> = settings.audio || {};
  if (warped) out.push(many(warped, 'a warped sound', 'warped sounds'));
  if (desks) out.push(many(desks, 'a Mix cue that recalls the desk', 'Mix cues that recall the desk'));
  if (Array.isArray(live.map) && live.map.length) out.push(many(live.map.length, 'a key or control mapped to the desk', 'keys or controls mapped to the desk'));
  if (Number(live.tempo) > 0) out.push('a desk tempo');
  // a track's strip moved from rest (eq, filter, pan, mute, a crossfader side): only the desk shows and moves these
  const moved = (audio.buses || []).filter((b) => Object.values(settingsOf(b)).some((v) => !(v === 0 || v === false || v === '' || v === undefined)));
  if (moved.length || Number(audio.crossfader)) out.push('a desk moved from rest');
  return out;
}

export { usesLive };
