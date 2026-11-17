// A cue cart: a list drawn as a grid of buttons. Each button starts its cue, as a hotkey or a remote would:
// the cue fires, and the playhead of the list being run stays where it is. Which cue is on which button is
// decided by the host (core/show/cart.js) and arrives in `s.carts`.
import { html, useState, useRef, ec, cmd, edit, clock, cx } from './lib.js';
import * as Tidy from './tidy.js';
import type { State, Info, CueList, CueIndex, Active } from './lib.js';
import type { Problem } from './Sections.js';

/** Which cue is on which button (core/show/cart.js `layout`): cue ids (or null) in reading order, and the cues with no button. */
export interface CartLayout { rows: number; columns: number; cells: (string | null)[]; extra: string[] }
/** One button of the grid. */
export interface CartCell { at: number; row: number; column: number; cell: string; id: string | null }

/** A cart's cells as the grid draws them: [{ at, row, column, cell: "r,c", id | null }]. */
export function cellsOf(layout: CartLayout): CartCell[] {
  return layout.cells.map((id, at) => { const row = Math.floor(at / layout.columns) + 1, column = (at % layout.columns) + 1; return { at, row, column, cell: `${row},${column}`, id }; });
}

export function Cart({ s, list, layout, byId, sel, setSel, spot, setSpot, editMode, info, onMenu }: {
  s: State; list: CueList; layout: CartLayout; byId: CueIndex; sel: string[]; setSel: (ids: string[]) => void; spot: string | null; setSpot: (cell: string | null) => void;
  editMode: boolean; info: Info; onMenu?: (id: string) => void;
}) {
  const e = s.engine;
  const [over, setOver] = useState<string | null>(null);            // the cell a dragged button or file is over
  const dragged = useRef<string | null>(null);
  const cells = cellsOf(layout);
  const problems = new Map<string, Problem>();
  for (const p of s.problems) if (!problems.has(p.id) || p.level === 'error') problems.set(p.id, p);
  // what is running under each button: the cue itself, or (a group) the longest sound in it
  const act = new Map<string, Active>();
  for (const a of e.active as Active[]) for (const id of [a.id, a.parent]) { const was = act.get(id); if (id && (!was || (a.kind === 'audio' && (was.kind !== 'audio' || a.total > was.total)))) act.set(id, a); }

  const start = (id: string) => cmd({ op: 'start', id, from: 'cart' });
  // Show mode: a press starts the cue. Edit mode: a press selects it (the inspector shows it); ▶ on the button, or a double press, starts it.
  const press = (ev: MouseEvent, c: CartCell) => {
    setSpot(c.cell);
    if (!c.id) { setSel([]); return; }
    if (!editMode) { start(c.id); setSel([c.id]); return; }
    setSel(ev.shiftKey || ev.metaKey || ev.ctrlKey ? (sel.includes(c.id) ? sel.filter((x) => x !== c.id) : [...sel, c.id]) : [c.id]);
  };
  // a button dragged to another cell goes there; onto a cue, the two change places
  const dropOn = async (ev: DragEvent, c: CartCell) => {
    ev.preventDefault(); setOver(null);
    if (!editMode) return;
    if (ev.dataTransfer!.files && ev.dataTransfer!.files.length) {
      const paths = [...ev.dataTransfer!.files].map((f) => ec.pathFor(f)).filter(Boolean);
      const r = await cmd({ op: 'import', paths, list: list.id, cell: c.id ? null : c.cell });
      if (r && r.made) setSel(r.made);
      return;
    }
    const from = cells.find((x) => x.id && x.id === dragged.current); dragged.current = null;
    if (!from || from.at === c.at) return;
    edit([{ op: 'cue.set', id: from.id!, props: { cell: c.cell } }, ...(c.id ? [{ op: 'cue.set' as const, id: c.id, props: { cell: from.cell } }] : [])], c.id ? 'swap buttons' : 'move button');
    setSpot(c.cell);
  };

  return html`<div class="cart" style=${`grid-template-columns:repeat(${layout.columns},minmax(0,1fr));grid-template-rows:repeat(${layout.rows},minmax(64px,1fr))`}
      onClick=${(ev: MouseEvent) => { if (ev.target === ev.currentTarget) { setSel([]); setSpot(null); } }}>
    ${cells.map((c) => {
      const x = c.id && byId.get(c.id), q = x && x.cue;
      if (!q) return html`<button key=${c.cell} data-cell=${c.cell} class=${cx('cell empty-cell', spot === c.cell && 'spot', over === c.cell && 'over')}
          onClick=${(ev: MouseEvent) => press(ev, c)} onDragOver=${(ev: DragEvent) => { if (editMode) { ev.preventDefault(); setOver(c.cell); } }} onDragLeave=${() => setOver(null)} onDrop=${(ev: DragEvent) => dropOn(ev, c)}
          title=${editMode ? 'Empty: add a cue or drop a sound' : ''}>${editMode && spot === c.cell ? html`<span class="hint">add a cue or drop a sound</span>` : null}</button>`;
      const a = act.get(q.id);
      const running = !!a, paused = !!(a && a.paused);
      const p = problems.get(q.id);
      const off = e.disarmed.includes(q.id);
      const pct = a && a.total > 0 ? Math.min(100, (a.elapsed / a.total) * 100) : 0;
      const left = a && a.kind === 'audio' && !a.loop && (a.end || a.total) > 0 ? Math.max(0, (a.end || a.total) - a.elapsed) : null;
      return html`<button key=${q.id} data-cell=${c.cell} data-cue=${q.id} draggable=${editMode}
          class=${cx('cell', running && 'running', paused && 'paused', off && 'off', sel.includes(q.id) && 'sel', spot === c.cell && 'spot', over === c.cell && 'over', p && p.level === 'error' && 'broken')}
          onClick=${(ev: MouseEvent) => press(ev, c)} onDblClick=${() => { if (editMode) start(q.id); }}
          onContextMenu=${(ev: MouseEvent) => { ev.preventDefault(); if (onMenu) onMenu(q.id); }}
          onDragStart=${(ev: DragEvent) => { dragged.current = q.id; ev.dataTransfer!.effectAllowed = 'move'; ev.dataTransfer!.setData('text/plain', q.id); }}
          onDragEnd=${() => { dragged.current = null; setOver(null); }}
          onDragOver=${(ev: DragEvent) => { if (editMode) { ev.preventDefault(); setOver(c.cell); } }} onDragLeave=${() => setOver(null)} onDrop=${(ev: DragEvent) => dropOn(ev, c)}
          title=${p ? p.why : off ? 'Disarmed: a press does nothing' : editMode ? 'Double-click or ▶: start' : ''}>
        ${Tidy.colorCss(q.color) ? html`<span class="band" style=${`background:${Tidy.colorCss(q.color)}`}></span>` : null}
        <span class="top"><span class="g">${info.types[q.type].glyph}</span><span class="n">${q.number || ''}</span>
          ${q.hotkey ? html`<span class="tag">${q.hotkey}</span>` : null}
          <span class="st">${p ? html`<span class=${p.level === 'error' ? 'x' : 'flag'}>${p.level === 'error' ? '✕' : '▲'}</span>` : paused ? '❙❙' : running ? '▶' : ''}</span></span>
        <span class="name">${s.labels[q.id]}</span>
        <span class="foot">${running ? html`<span class="left">${left != null ? `−${clock(left)}` : a.loop ? 'loop' : clock(a.elapsed)}</span>` : html`<span></span>`}
          ${running ? html`<span class="act stop" role="button" title="Fade out and stop" onClick=${(ev: MouseEvent) => { ev.stopPropagation(); cmd({ op: 'stop', id: a.kind === 'audio' ? a.id : q.id, fade: a.kind === 'audio' }); if (a.id !== q.id) cmd({ op: 'stop', id: q.id }); }}>■</span>`
            : editMode ? html`<span class="act" role="button" title="Start" onClick=${(ev: MouseEvent) => { ev.stopPropagation(); start(q.id); }}>▶</span>` : null}</span>
        ${pct > 0 ? html`<span class=${cx('progress', a!.kind === 'wait' && 'wait')} style=${`width:${pct}%`}></span>` : null}
      </button>`;
    })}
    ${layout.extra.length > 0 && html`<div class="cart-extra">Full: ${layout.extra.length} cue${layout.extra.length === 1 ? '' : 's'} without a button. Settings ▸ Show.</div>`}
  </div>`;
}
