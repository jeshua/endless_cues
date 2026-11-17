/**
 * Sections: headings in a cue list that organise it and never play.
 *
 * A section is an ordinary entry in a list (`{ type: 'section', name, color, notes }`), so the show file stays flat
 * and an older show is unchanged. It holds the top-level rows after it, up to the next section or the end of the
 * list. Sections are flat (never one inside a group, never one in a cart) and may hold groups.
 *
 * The engine never sees one: show.js toEngineDoc leaves sections out, so GO, the playhead, continues and
 * auto-follows go from the cue before a section to the cue after it. What can still name a section (the
 * window's selection, Stand By Here, Jump, Load) goes to its first cue instead: `landing`.
 *
 * How the list is folded is this computer's, not the show's: `keepFolds` is the per-computer record of it.
 */

const isSection = (c) => !!c && c.type === 'section';

/** The sections of a list, in order: [{ id, name, color, ids }] where `ids` are the top-level cues each holds. */
function sectionsOf(cues = []) {
  const out = [];
  let cur = null;
  for (const c of cues) {
    if (isSection(c)) { cur = { id: c.id, name: c.name || 'Section', color: c.color || 'none', ids: [] }; out.push(cur); }
    else if (cur) cur.ids.push(c.id);
  }
  return out;
}

/** The section a top-level cue is in (its id), or null: one before the first section, or one that is not there. */
function sectionOf(cues = [], id) {
  let cur = null;
  for (const c of cues) {
    if (isSection(c)) cur = c.id;
    if (c.id === id) return isSection(c) ? null : cur;
  }
  return null;
}

/** Where a cue named as somewhere to stand by lands: a section's first cue (the next cue after it, past any empty
 *  sections), anything else itself. null: a section with no cue after it. `cues` is the list the id is in. */
function landing(cues = [], id) {
  const i = cues.findIndex((c) => c.id === id);
  if (i < 0 || !isSection(cues[i])) return i < 0 ? null : id;
  const next = cues.slice(i + 1).find((c) => !isSection(c));
  return next ? next.id : null;
}

/** `landing` in a whole show: the list the id is in, found first. */
function landingIn(doc, id) {
  for (const l of (doc && doc.lists) || []) if (l.cues.some((c) => c.id === id)) return landing(l.cues, id);
  return id;
}

/** A section named as Jump to cue is typed ("scene 2"): the first whose name is that, or begins with it, in any
 *  case; null for none. Returns { id, list } (the list's name). */
function byName(doc, text) {
  const want = String(text || '').trim().toLowerCase();
  if (!want) return null;
  for (const exact of [true, false]) {
    for (const l of (doc && doc.lists) || []) {
      const c = l.cues.find((x) => isSection(x) && (exact ? String(x.name || '').trim().toLowerCase() === want : String(x.name || '').toLowerCase().startsWith(want)));
      if (c) return { id: c.id, list: l.name };
    }
  }
  return null;
}

/** What is wrong with where the show's sections are, as sentences (an edit that would leave one is refused). */
function trouble(doc) {
  const out = [];
  const inside = (cues) => { for (const c of cues || []) { if (isSection(c)) out.push(`a section (“${c.name || 'Section'}”) goes in a list, not inside a group`); inside(c.children); } };
  for (const l of doc.lists) {
    for (const c of l.cues) inside(c.children);
    if (l.cart && l.cues.some(isSection)) out.push(`the cart “${l.name}” has buttons, not sections`);
  }
  return out;
}

/** The fold record with one show's folded rows replaced: { [show folder]: [ids] }, the most recent last, at most
 *  `max` shows (the oldest is let go). Nothing folded: the show is left out. */
function keepFolds(folds, dir, ids, max = 40) {
  const out = {};
  for (const [k, v] of Object.entries(folds && typeof folds === 'object' ? folds : {})) if (k !== dir && Array.isArray(v)) out[k] = v;
  const clean = [...new Set((ids || []).filter((x) => typeof x === 'string' && x))];
  if (dir && clean.length) out[dir] = clean;
  const keys = Object.keys(out);
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete out[k];
  return out;
}

export { isSection, sectionsOf, sectionOf, landing, landingIn, byName, trouble, keepFolds };
