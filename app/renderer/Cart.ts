// A cue cart: a list drawn as a grid of buttons. Each button starts its cue, as a hotkey or a remote would:
// the cue fires, and the playhead of the list being run stays where it is. Which cue is on which button is
// decided by the host (core/show/cart.js) and arrives in `s.carts`.
import { html, useState, useRef, ec, cmd, edit, clock, cx } from './lib.js';
import * as Tidy from './tidy.js';

/** A cart's cells as the grid draws them: [{ at, row, column, cell: "r,c", id | null }]. */
export function cellsOf(layout) {
  return layout.cells.map((id, at) => { const row = Math.floor(at / layout.columns) + 1, column = (at % layout.columns) + 1; return { at, row, column, cell: `${row},${column}`, id }; });
}

export function Cart({ s, list, layout, byId, sel, setSel, spot, setSpot, editMode, info, onMenu }) {
  const e = s.engine;
  const [over, setOver] = useState(null);            // the cell a dragged button or file is over
  const dragged = useRef(null);
  const cells = cellsOf(layout);
  const problems = new Map();
  for (const p of s.problems) if (!problems.has(p.id) || p.level === 'error') problems.set(p.id, p);
  // what is running under each button: the cue itself, or (a group) the longest sound in it
  const act = new Map();
  for (const a of e.active) for (const id of [a.id, a.parent]) { const was = act.get(id); if (id && (!was || (a.kind === 'audio' && (was.kind !== 'audio' || a.total > was.total)))) act.set(id, a); }

  const start = (id) => cmd({ op: 'start', id, from: 'cart' });
  // Show mode: a press starts the cue. Edit mode: a press selects it (the inspector shows it); ▶ on the button, or a double press, starts it.
  const press = (ev, c) => {
    setSpot(c.cell);
    if (!c.id) { setSel([]); return; }
    if (!editMode) { start(c.id); setSel([c.id]); return; }
    setSel(ev.shiftKey || ev.metaKey || ev.ctrlKey ? (sel.includes(c.id) ? sel.filter((x) => x !== c.id) : [...sel, c.id]) : [c.id]);
  };
  // a button dragged to another cell goes there; onto a cue, the two change places
  const dropOn = async (ev, c) => {
    ev.preventDefault(); setOver(null);
    if (!editMode) return;
    if (ev.dataTransfer.files && ev.dataTransfer.files.length) {
      const paths = [...ev.dataTransfer.files].map((f) => ec.pathFor(f)).filter(Boolean);
      const r = await cmd({ op: 'import', paths, list: list.id, cell: c.id ? null : c.cell });
      if (r && r.made) setSel(r.made);
      return;
    }
    const from = cells.find((x) => x.id && x.id === dragged.current); dragged.current = null;
    if (!from || from.at === c.at) return;
    edit([{ op: 'cue.set', id: from.id, props: { cell: c.cell } }, ...(c.id ? [{ op: 'cue.set', id: c.id, props: { cell: from.cell } }] : [])], c.id ? 'swap buttons' : 'move button');
    setSpot(c.cell);
  };

  return html`<div class="cart" style=${`grid-template-columns:repeat(${layout.columns},minmax(0,1fr));grid-template-rows:repeat(${layout.rows},minmax(64px,1fr))`}
      onClick=${(ev) => { if (ev.target === ev.currentTarget) { setSel([]); setSpot(null); } }}>
    ${cells.map((c) => {
      const x = c.id && byId.get(c.id), q = x && x.cue;
      if (!q) return html`<button key=${c.cell} data-cell=${c.cell} class=${cx('cell empty-cell', spot === c.cell && 'spot', over === c.cell && 'over')}
          onClick=${(ev) => press(ev, c)} onDragOver=${(ev) => { if (editMode) { ev.preventDefault(); setOver(c.cell); } }} onDragLeave=${() => setOver(null)} onDrop=${(ev) => dropOn(ev, c)}
          title=${editMode ? 'Empty: add a cue or drop a sound' : ''}>${editMode && spot === c.cell ? html`<span class="hint">add a cue or drop a sound</span>` : null}</button>`;
      const a = act.get(q.id);
      const running = !!a, paused = !!(a && a.paused);
      const p = problems.get(q.id);
      const off = e.disarmed.includes(q.id);
      const pct = a && a.total > 0 ? Math.min(100, (a.elapsed / a.total) * 100) : 0;
      const left = a && a.kind === 'audio' && !a.loop && (a.end || a.total) > 0 ? Math.max(0, (a.end || a.total) - a.elapsed) : null;
      return html`<button key=${q.id} data-cell=${c.cell} data-cue=${q.id} draggable=${editMode}
          class=${cx('cell', running && 'running', paused && 'paused', off && 'off', sel.includes(q.id) && 'sel', spot === c.cell && 'spot', over === c.cell && 'over', p && p.level === 'error' && 'broken')}
          onClick=${(ev) => press(ev, c)} onDblClick=${() => { if (editMode) start(q.id); }}
          onContextMenu=${(ev) => { ev.preventDefault(); if (onMenu) onMenu(q.id); }}
          onDragStart=${(ev) => { dragged.current = q.id; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', q.id); }}
          onDragEnd=${() => { dragged.current = null; setOver(null); }}
          onDragOver=${(ev) => { if (editMode) { ev.preventDefault(); setOver(c.cell); } }} onDragLeave=${() => setOver(null)} onDrop=${(ev) => dropOn(ev, c)}
          title=${p ? p.why : off ? 'Disarmed: a press does nothing' : editMode ? 'Double-click or ▶: start' : ''}>
        ${Tidy.colorCss(q.color) ? html`<span class="band" style=${`background:${Tidy.colorCss(q.color)}`}></span>` : null}
        <span class="top"><span class="g">${info.types[q.type].glyph}</span><span class="n">${q.number || ''}</span>
          ${q.hotkey ? html`<span class="tag">${q.hotkey}</span>` : null}
          <span class="st">${p ? html`<span class=${p.level === 'error' ? 'x' : 'flag'}>${p.level === 'error' ? '✕' : '▲'}</span>` : paused ? '❙❙' : running ? '▶' : ''}</span></span>
        <span class="name">${s.labels[q.id]}</span>
        <span class="foot">${running ? html`<span class="left">${left != null ? `−${clock(left)}` : a.loop ? 'loop' : clock(a.elapsed)}</span>` : html`<span></span>`}
          ${running ? html`<span class="act stop" role="button" title="Fade out and stop" onClick=${(ev) => { ev.stopPropagation(); cmd({ op: 'stop', id: a.kind === 'audio' ? a.id : q.id, fade: a.kind === 'audio' }); if (a.id !== q.id) cmd({ op: 'stop', id: q.id }); }}>■</span>`
            : editMode ? html`<span class="act" role="button" title="Start" onClick=${(ev) => { ev.stopPropagation(); start(q.id); }}>▶</span>` : null}</span>
        ${pct > 0 ? html`<span class=${cx('progress', a.kind === 'wait' && 'wait')} style=${`width:${pct}%`}></span>` : null}
      </button>`;
    })}
    ${layout.extra.length > 0 && html`<div class="cart-extra">Full: ${layout.extra.length} cue${layout.extra.length === 1 ? '' : 's'} without a button. Settings ▸ Show.</div>`}
  </div>`;
}
