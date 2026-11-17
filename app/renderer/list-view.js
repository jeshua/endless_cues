/**
 * The cue list as it is looked at: what one GO sets off, where a chain of continues is drawn, what has to be
 * unfolded to show a cue, and how far the list is zoomed out. None of it changes a show: the window draws from it
 * (index.html loads this file as a plain script, so it is `ListView` there) and the tests require it in Node.
 *
 *   linksOf(cues, opts)               which cue continues into which: { kind: id -> mode, next: id -> id }
 *   chainFrom(cues, id, opts)         the cues one GO on `id` starts, in order (itself first)
 *   chainMarks(cues, rows, shut, links)   what each drawn row carries of a chain's line
 *   strayLinks(cues, removed, opts)   the continues that will reach a new cue once these cues are gone
 *   revealPath(cues, id)              the sections and groups to unfold so `id` is drawn
 *   rowHeight / fitHeight / keepZoom  the zoomed-out list: a row's height, the height that fits, and the record
 *
 * A chain is QLab's: a cue set to auto-continue starts the next as it starts, one set to auto-follow starts the next
 * as it ends. The next is the next cue GO would stand by on: a section heading is passed over (the engine never sees
 * one), and so is a light cue that is only called while light cues are skipped (`skipLights`). Inside a group the
 * children's continues count only where the group starts its first child (enter, first, random); a timeline starts
 * them all at once and a playlist plays them in turn, so a continue there links nothing.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ListView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MODES = ['auto-continue', 'auto-follow'];
  const STARTS_FIRST = ['enter', 'first', 'random'];
  const isSection = (c) => !!c && c.type === 'section';
  const isCall = (c) => !!c && c.type === 'light' && !String(c.levels || '').trim();

  /** The cues of a list GO steps through, in order. */
  function steps(cues, opts = {}) {
    return (cues || []).filter((c) => !isSection(c) && !(opts.skipLights && isCall(c)));
  }

  function linksOf(cues, opts = {}) {
    const kind = new Map(), next = new Map();
    const link = (row) => {
      for (let i = 0; i < row.length - 1; i++) if (MODES.includes(row[i].continue)) { kind.set(row[i].id, row[i].continue); next.set(row[i].id, row[i + 1].id); }
    };
    link(steps(cues, opts));
    const walk = (list) => {
      for (const c of list || []) {
        if (!c.children) continue;
        if (STARTS_FIRST.includes(c.mode)) link(c.children);
        walk(c.children);
      }
    };
    walk(cues);
    return { kind, next };
  }

  function chainFrom(cues, id, opts = {}) {
    if (!id) return [];
    const { next } = opts.links || linksOf(cues, opts);
    const out = [id], seen = new Set(out);
    for (let at = next.get(id); at && !seen.has(at); at = next.get(at)) { out.push(at); seen.add(at); }
    return out;
  }

  /**
   * The line each drawn row carries. `rows` are the rows as drawn ({ cue, depth, heading }), `shut` the folded ids,
   * `links` from linksOf. For each row that has a part of a line: { depth, up, down, through: [{ depth, kind }], tick }:
   * `up` the link coming into it from the cue above (its kind), `down` the link leaving it, `through` the lines of
   * the levels above it that pass by (a group's children between two linked cues, a heading between two scenes),
   * `tick` that it is one of the linked cues. A folded section's heading stands for what it hides: a chain that goes
   * into it and one that comes out of it end and start on it.
   */
  function chainMarks(cues, rows, shut, links, opts = {}) {
    const out = new Map();
    const stepIds = new Set(steps(cues, opts).map((c) => c.id));
    const top = cues || [];
    // a folded section's last step: the link that leaves it is that cue's
    const lastStepIn = (secId) => {
      const i = top.findIndex((c) => c.id === secId);
      let last = null;
      for (let j = i + 1; j < top.length && !isSection(top[j]); j++) if (stepIds.has(top[j].id)) last = top[j].id;
      return last;
    };
    let open = [];
    const put = (id, m) => { if (m.up || m.down || m.through.length) out.set(id, m); };
    for (const r of rows) {
      const id = r.cue.id;
      if (r.heading) {
        const inKind = open[0] || null;
        open = [inKind];
        if (shut && shut.has(id)) {
          const last = lastStepIn(id), down = last ? links.kind.get(last) || null : null;
          // (an empty folded section hands the line straight on)
          const hasSteps = !!last;
          const m = hasSteps ? { depth: 0, up: inKind, down, through: [], tick: !!(inKind || down) } : { depth: 0, up: null, down: null, through: inKind ? [{ depth: 0, kind: inKind }] : [], tick: false };
          if (hasSteps) open = [down];
          put(id, m);
        } else put(id, { depth: 0, up: null, down: null, through: inKind ? [{ depth: 0, kind: inKind }] : [], tick: false });
        continue;
      }
      const d = r.depth;
      const through = [];
      for (let k = 0; k < d; k++) if (open[k]) through.push({ depth: k, kind: open[k] });
      if (d === 0 && !stepIds.has(id)) {
        // a cue GO passes over (a light cue only called): the line goes by it
        if (open[0]) through.push({ depth: 0, kind: open[0] });
        open = open.slice(0, 1);
        put(id, { depth: 0, up: null, down: null, through, tick: false });
        continue;
      }
      const up = open[d] || null, down = links.kind.get(id) || null;
      open = open.slice(0, d);
      open[d] = down;
      put(id, { depth: d, up, down, through, tick: !!(up || down) });
    }
    return out;
  }

  /** The cues with their children, without `removed` (and anything inside one). */
  function without(cues, removed) {
    return (cues || []).filter((c) => !removed.has(c.id)).map((c) => (c.children ? { ...c, children: without(c.children, removed) } : c));
  }

  /** Each cue that is kept and continues into a cue being removed: after the removal it continues into whatever
   *  comes next, which nobody chose. [{ from, to, kind, was }]: `to` is null when there is nothing after it now. */
  function strayLinks(cues, removed, opts = {}) {
    const gone = new Set(removed);
    const before = linksOf(cues, opts), after = linksOf(without(cues, gone), opts);
    const out = [];
    for (const [from, was] of before.next) {
      if (gone.has(from) || !gone.has(was)) continue;
      out.push({ from, to: after.next.get(from) || null, kind: before.kind.get(from), was });
    }
    return out;
  }

  /** The sections and groups to unfold so that `id` is drawn: every group it is inside and the section its
   *  top-level cue is in. [] when nothing hides it, or it is not in these cues. */
  function revealPath(cues, id) {
    const top = cues || [];
    const trail = (list, path) => {
      for (const c of list || []) {
        if (c.id === id) return path;
        if (c.children) { const p = trail(c.children, [...path, c.id]); if (p) return p; }
      }
      return null;
    };
    const groups = trail(top, []);
    if (!groups) return [];
    const topId = groups.length ? groups[0] : id;
    let sec = null;
    for (const c of top) { if (isSection(c)) sec = c.id; if (c.id === topId) break; }
    if (top.find((c) => c.id === topId) && isSection(top.find((c) => c.id === topId))) sec = null;   // (a heading is never inside a section)
    return [...(sec ? [sec] : []), ...groups];
  }

  // ── zoom: 1 is the list as it is, 0 the whole list in the window ──
  const clamp01 = (z) => Math.max(0, Math.min(1, Number.isFinite(z) ? z : 1));

  /** A cue row's height at zoom `z`, from the normal height down to the height that fits. On a log scale, so each
   *  step of a pinch looks the same size whether the rows are tall or thin. */
  function rowHeight(z, normal, fit) {
    const lo = Math.min(fit, normal);
    return lo * Math.pow(normal / lo, clamp01(z));
  }

  /** The cue row height at which every row fits `avail` pixels: headings keep `headingH` (they stay readable).
   *  Never less than `min`, never more than `normal`. */
  function fitHeight(avail, cueRows, headings, headingH, normal, min = 1.5) {
    if (!(cueRows > 0)) return normal;
    return Math.max(min, Math.min(normal, (avail - headings * headingH) / cueRows));
  }

  /** The zoom kept for each show on this computer (config.json, never the show): `dir` set to `z`, the rest kept;
   *  a list at its normal size is not kept; at most `max` shows remembered (the oldest forgotten). */
  function keepZoom(zooms, dir, z, max = 40) {
    const out = {};
    for (const [k, v] of Object.entries(zooms && typeof zooms === 'object' ? zooms : {})) if (k !== dir && Number.isFinite(v)) out[k] = v;
    const v = clamp01(z);
    if (dir && v < 0.999) out[dir] = Math.round(v * 1000) / 1000;
    const keys = Object.keys(out);
    for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete out[k];
    return out;
  }

  return { MODES, STARTS_FIRST, steps, linksOf, chainFrom, chainMarks, strayLinks, revealPath, rowHeight, fitHeight, keepZoom, clamp01 };
});
