// Sections: the headings of a cue list (core/show/sections.js), their row in the list and the strip of their names
// above it. Folding is the view's: what is folded is kept per show on this computer (app.js), never in the show.
import { html, cx } from './lib.js';
import * as Tidy from './tidy.js';
import type { State, Cue, CueList, CueIndex, Row, Labels, sectionsIn } from './lib.js';

/** A section of a list: its heading and every cue under it (lib.js `sectionsIn`). */
export type Section = ReturnType<typeof sectionsIn>[number];
/** A problem the host found with a cue: what the status column shows. */
export type Problem = State['problems'][number];

/** Every group, every section, or both (`which`: 'groups', 'sections', 'all') folded (`fold`) or opened, from what is
 *  folded now, so the others stay as they are: < and > fold the groups and leave the sections alone. */
export function foldAll(byId: CueIndex, shut: Set<string>, fold: boolean, which: 'groups' | 'sections' | 'all' = 'all') {
  const n = new Set(shut);
  for (const x of byId.values()) {
    const sec = x.cue.type === 'section', grp = !!x.cue.children && !sec;
    if ((sec && which !== 'groups') || (grp && which !== 'sections')) { if (fold) n.add(x.cue.id); else n.delete(x.cue.id); }
  }
  return n;
}

/** ⌥-click on a caret: every one like it folded or opened as this one now is. A section: every section of the list;
 *  a group: every group beside it (its siblings). */
export function foldLike(row: Row, rows: Row[], list: CueList, byId: CueIndex, shut: Set<string>) {
  const fold = !shut.has(row.cue.id);
  const n = new Set(shut);
  const like = row.cue.type === 'section' ? list.cues.filter((c) => c.type === 'section')
    : (row.parent ? (byId.get(row.parent.id) || { cue: row.parent }).cue.children : list.cues)!.filter((c) => c.children);
  for (const c of like) { if (fold) n.add(c.id); else n.delete(c.id); }
  return n;
}

/** A section's heading row: its caret, its name, a rule in its colour; folded, how many cues it holds, and never
 *  hiding what matters: the cue standing by in it (number and name, as the masthead shows it), a running cue, a flag
 *  or a broken cue inside. */
export function SectionRow({ span = 9, row, sec, byId, shut, sel, s, labels, problems, editing, nameCell, onClick, onCaret, onMenu, drag, dropClass, chain = null }: {
  span?: number; row: Row; sec: Section | undefined; byId: CueIndex; shut: Set<string>; sel: string[]; s: State; labels: Labels; problems: Map<string, Problem>;
  editing: boolean | null; nameCell: unknown; onClick: (ev: MouseEvent) => void; onCaret: (ev: MouseEvent) => void; onMenu: (id: string) => void;
  drag: Record<string, unknown>; dropClass: string; chain?: unknown;
}) {
  const c = row.cue, id = c.id, e = s.engine;
  const folded = shut.has(id);
  const ids = sec ? sec.ids : new Set<string>();
  const head = e.playhead && ids.has(e.playhead) ? e.playhead : null;
  const live = [...ids].some((x) => e.live.includes(x) || e.active.some((a) => a.id === x));
  const cueOf = (x: string): Cue | undefined => (byId.get(x) || { cue: undefined }).cue;
  const headCue = head ? cueOf(head) : null;
  const flagged = folded && [...ids].some((x) => { const q = cueOf(x); return q && q.flagged; });
  const broken = folded && [...ids].some((x) => problems.has(x) && problems.get(x)!.level === 'error');
  const n = [...ids].filter((x) => byId.get(x) && !byId.get(x)!.parent).length;      // its top-level cues
  const col = Tidy.colorCss(c.color) || 'var(--line)';
  return html`<tr key=${id} data-section=${id} class=${cx('section', folded && 'folded', sel.includes(id) && 'sel', head && folded && 'holds-head', dropClass)}
      onClick=${onClick} onContextMenu=${(ev: MouseEvent) => { ev.preventDefault(); onMenu(id); }} ...${drag}>
    <td colspan=${span} style=${`--sec:${col}`}>${chain}
      <span class="sec-caret" title=${folded ? 'Unfold (→) · ⌥: all' : 'Fold (←) · ⌥: all'} onClick=${onCaret}>${folded ? '▶' : '▼'}</span>
      ${editing ? nameCell : html`<span class=${cx('sec-name', !c.name && 'auto')}>${labels[id]}</span>`}
      ${folded ? html`<span class="sec-count num">${n}</span>` : null}
      ${live ? html`<span class="sec-live" title="Running">▶</span>` : null}
      ${broken ? html`<span class="x" title="A cue inside is broken">✕</span>` : flagged ? html`<span class="flag hollow" title="A cue inside is flagged">⚐</span>` : null}
      ${head && folded ? html`<span class="sec-head" title="Standing by"><span class="ph">➤</span><b>${headCue && headCue.number ? headCue.number : ''}</b> ${labels[head]}</span>`
        : head ? html`<span class="sec-mark" title="The cue standing by is here">➤</span>` : null}
    </td>
  </tr>`;
}

/** The sections by name, above the list: a click goes there (and opens it). Not there when the list has none. */
export function SectionStrip({ secs, s, shut, go }: { secs: Section[]; s: State; shut: Set<string>; go: (id: string) => void }) {
  if (!secs.length) return null;
  const e = s.engine;
  return html`<div class="sec-strip" data-section-strip>
    ${secs.map((x) => html`<button key=${x.cue.id} class=${cx('sec-chip', x.ids.has(e.playhead!) && 'here', shut.has(x.cue.id) && 'folded')}
      style=${Tidy.colorCss(x.cue.color) ? `--sec:${Tidy.colorCss(x.cue.color)}` : ''} onClick=${() => go(x.cue.id)}
      title=${`${x.cue.name || 'Section'}${shut.has(x.cue.id) ? ' (folded)' : ''}`}>${x.cue.name || 'Section'}</button>`)}
  </div>`;
}
