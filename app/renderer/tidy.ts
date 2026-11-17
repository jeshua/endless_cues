/**
 * What the window leaves out until it is needed, as rules that can be tested: none of it changes a show. The window
 * loads this file as a plain script (`Tidy` there), the tests require it in Node.
 *
 *   colorCss(color)                 a cue's colour as CSS: a named colour's token, or a colour chosen on the wheel
 *   usedColumns(cues, durationOf)   which of the list's optional columns anything in the list fills
 *   frozenColumns(state, used, show)   the columns to draw, held as they were while Show mode runs
 *   matchTypes(types, order, text)  the cue types the add-cue list keeps for what was typed, best first
 */
// ── colour: a show keeps a name ('red', the tokens --c-red in each theme) or a colour from the wheel ('#rrggbb') ──
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/;
const isCustomColor = (col) => HEX.test(String(col || '').trim().toLowerCase());
/** The CSS for a cue's colour, or null for none. A name is its theme's token, so it stays in tune with the theme;
 *  a chosen colour is drawn as it was chosen. Anything else (a word no theme has) is drawn as none. */
function colorCss(col) {
  const v = String(col || '').trim().toLowerCase();
  if (!v || v === 'none') return null;
  if (HEX.test(v)) return v;
  return /^[a-z]+$/.test(v) ? `var(--c-${v})` : null;
}

// ── the list's optional columns: one that nothing in the list fills is not drawn ──
const COLUMNS = ['target', 'preWait', 'duration', 'postWait'];
/** What the Target column shows for a cue (CueList.js draws the same): its target, a named sound's file or its
 *  bus, a network cue's message. */
function hasTarget(c) {
  if (c.target) return true;
  if (c.type === 'audio' || c.type === 'video') return !!((c.name && c.file) || c.bus);
  if (c.type === 'network') return !!c.message;
  return false;
}
/** { target, preWait, duration, postWait }: true where at least one cue of the list (inside groups too, folded or
 *  not) has something to show there. `durationOf(cue)` is the text the Duration column would show. */
function usedColumns(cues, durationOf = () => '') {
  const used = { target: false, preWait: false, duration: false, postWait: false };
  const walk = (list) => {
    for (const c of list || []) {
      if (c.type !== 'section') {
        if (!used.target && hasTarget(c)) used.target = true;
        if (!used.preWait && Number(c.preWait) > 0) used.preWait = true;
        if (!used.postWait && Number(c.postWait) > 0) used.postWait = true;
        if (!used.duration && durationOf(c)) used.duration = true;
      }
      if (c.children) walk(c.children);
    }
  };
  walk(cues);
  return used;
}
/** The columns to draw. In Edit mode they follow the list; in Show mode they stay as they were when Show began, so
 *  no row moves under the operator's eye (a sound measured late, a cue fired that changes its duration).
 *  `state` is the caller's own record ({ held }), kept between draws; returns the columns. */
function frozenColumns(state, used, show) {
  if (!show) { state.held = null; return used; }
  if (!state.held) state.held = { ...used };
  return state.held;
}

// ── the add-cue list: typed text narrows the cue types ──
/** The cue types (ids from `order`) whose label, id or summary has `text`, best first: a label that starts with it,
 *  then a word of the label that does, then the rest. An empty text keeps them all, in their order. */
function matchTypes(types, order, text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return order.slice();
  const rank = (id) => {
    const t = types[id] || {}, label = String(t.label || id).toLowerCase();
    if (label.startsWith(q) || id.toLowerCase().startsWith(q)) return 0;
    if (label.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 1;
    if (label.includes(q) || String(t.summary || '').toLowerCase().includes(q)) return 2;
    return -1;
  };
  return order.map((id, i) => ({ id, i, r: rank(id) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.id);
}

export { isCustomColor, colorCss, COLUMNS, hasTarget, usedColumns, frozenColumns, matchTypes };
