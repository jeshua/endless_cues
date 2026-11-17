/**
 * The output device, watched: what to do when the interface the show plays on goes away, and when it comes back.
 *
 * The audio window says which outputs the computer has (whenever that changes) and when its output fails. This
 * decides, and the host carries it out: with the chosen device gone the show moves to the system's default output
 * (sound out of the wrong speakers is better than no sound, and the operator is told), and when the chosen device
 * is seen again the show goes back to it. A device that failed while still plugged in is not gone: the show stays
 * on the default until it has been seen to leave and return, or the operator chooses again.
 *
 *   state:  { wanted: { id, label } | null, fallback: null | { sawGone } }      (wanted null: the system default)
 *   event:  { type: 'devices', list: [{ id, label }] } | { type: 'failed' } | { type: 'chosen', id, label }
 *           | { type: 'refused' }      the device asked for could not be opened
 *   step(state, event) → { state, action: null | { do: 'fallback' | 'return' | 'revive', id?, label? } }
 *
 * Pure: no Electron, no audio.
 */
const isDefault = (id) => !id || id === 'default';

function find(list, wanted) {
  if (!wanted) return null;
  // by its id; else by its name (some systems give a device a new id each time it is plugged in)
  return list.find((d) => d.id === wanted.id) || (wanted.label ? list.find((d) => d.label === wanted.label && !isDefault(d.id)) : null) || null;
}

function step(state, event) {
  const s = { wanted: state && state.wanted ? state.wanted : null, fallback: state && state.fallback ? state.fallback : null };
  switch (event.type) {
    case 'chosen':
      return { state: { wanted: isDefault(event.id) ? null : { id: event.id, label: event.label || '' }, fallback: null }, action: null };
    case 'refused':
      // asked for and not to be had (not plugged in when the app started): on the default until it shows up
      if (!s.wanted || s.fallback) return { state: s, action: null };
      return { state: { ...s, fallback: { sawGone: true } }, action: { do: 'fallback', label: s.wanted.label } };
    case 'failed':
      // the system default failing is the system's to mend: the output is opened again, on whatever is the default now
      if (!s.wanted || s.fallback) return { state: s, action: { do: 'revive' } };
      return { state: { ...s, fallback: { sawGone: false } }, action: { do: 'fallback', label: s.wanted.label } };
    case 'devices': {
      const list = event.list || [];
      if (!s.wanted || !list.length) return { state: s, action: null };
      const here = find(list, s.wanted);
      if (!s.fallback) return here ? { state: s, action: null } : { state: { ...s, fallback: { sawGone: true } }, action: { do: 'fallback', label: s.wanted.label } };
      if (!here) return { state: { ...s, fallback: { sawGone: true } }, action: null };
      if (!s.fallback.sawGone) return { state: s, action: null };
      return { state: { wanted: { id: here.id, label: here.label || s.wanted.label }, fallback: null }, action: { do: 'return', id: here.id, label: here.label || s.wanted.label } };
    }
    default: return { state: s, action: null };
  }
}

module.exports = { step, isDefault };
