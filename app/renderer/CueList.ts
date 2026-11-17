// The cue list: QLab's table. Status, type, number, name, target, pre-wait, duration, post-wait, continue.
import { html, useState, useEffect, useLayoutEffect, useRef, useMemo, ec, cmd, edit, setCue, clock, cx, mod, keys } from './lib.js';
import * as Tidy from './tidy.js';
import { SectionRow, foldLike } from './Sections.js';
import { LV, chainLine, RowLive, useListZoom, LINK_SAYS } from './ListTools.js';

const CONTINUE = { 'auto-continue': ['↓', 'Auto-continue: the next fires as this starts'], 'auto-follow': ['⤓', 'Auto-follow: the next fires as this ends'] };
const TIME_LABEL = { preWait: 'pre-wait', postWait: 'post-wait', duration: 'duration' };
/** The cue types whose duration is a field of their own (a sound's is its file's). */
export const HAS_DURATION = ['fade', 'wait', 'mix', 'network', 'device', 'midi', 'timecode'];
export const NEXT_CONTINUE = { none: 'auto-continue', 'auto-continue': 'auto-follow', 'auto-follow': 'none' };

function Inline({ value, onDone, mono }) {
  const ref = useRef(), over = useRef(false);        // Enter or Esc ends it once; the blur that follows is ignored
  const end = (v) => { if (over.current) return; over.current = true; onDone(v); };
  // (as it is drawn, not a frame later: a focus that lands late takes the keyboard back from whatever was typed or
  // pressed meanwhile, and until it lands the keys meant for the box are the list's single-key commands)
  useLayoutEffect(() => { ref.current.focus(); ref.current.select(); }, []);
  return html`<input ref=${ref} class=${cx('inline', mono && 'mono')} type="text" defaultValue=${value}
    onKeyDown=${(e) => { e.stopPropagation(); if (e.key === 'Enter') end(e.target.value); if (e.key === 'Escape') end(null); }}
    onBlur=${(e) => end(e.target.value)} onClick=${(e) => e.stopPropagation()} onDblClick=${(e) => e.stopPropagation()} />`;
}

export function CueList({ secs = [], lockPlayhead = true, revealed = 0, zoomRef = null, linked = null, rowSize = 'normal', addCue, say, onMenu, s, list, rows, byId, sel, select, setSel, collapsed, setCollapsed, editMode, editing, setEditing, info, pending }) {
  const e = s.engine;
  const [drop, setDrop] = useState(null);            // { id, where: 'before' | 'after' | 'into' | 'target' | 'file' }
  const [filesOver, setFilesOver] = useState(false);
  const dragged = useRef(null);
  const wrap = useRef();

  // keep the playhead in view when it moves
  useEffect(() => {
    const el = wrap.current && wrap.current.querySelector('tr.head');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [e.playhead]);

  // a cue that was gone to (its target, a flagged cue, a problem, a match of Find) is brought to the middle of the
  // list, and flashes for a moment so the eye lands on it (zoomed out too)
  const [found, setFound] = useState(null);
  useEffect(() => {
    const el = revealed && wrap.current && wrap.current.querySelector('tr.sel');
    if (!el) return undefined;
    el.scrollIntoView({ block: 'center' });
    setFound({ id: sel[0], n: revealed });
    const t = setTimeout(() => setFound(null), 900);
    return () => clearTimeout(t);
  }, [revealed]);

  // chains of continues: what links to what, and the line each drawn row carries (list-view.js)
  const links = useMemo(() => LV.linksOf(list ? list.cues : [], { skipLights: e.skipLights }), [list, e.skipLights]);
  const marks = useMemo(() => LV.chainMarks(list ? list.cues : [], rows, collapsed, links, { skipLights: e.skipLights }), [rows, collapsed, links]);
  // zoomed out: the whole show in the window; a click there zooms back in at that place (and selects nothing)
  const zoom = useListZoom(wrap, { dir: s.show && s.show.dir, rowSize, rows });
  if (zoomRef) zoomRef.current = zoom;

  // the cues related to the selected one: the cue it is aimed at, and the cues aimed at it
  const one = sel.length === 1 && byId.get(sel[0]) ? byId.get(sel[0]).cue : null;
  const related = new Map();
  if (one) {
    for (const [id, x] of byId) if (x.cue.target === one.id) related.set(id, 'source');
    if (one.target && byId.has(one.target)) related.set(one.target, 'target');
  }
  const played = new Set(e.played || []);
  // a collapsed group that holds a flagged cue shows a hollow flag, so a flag is never folded out of sight
  const holdsFlag = (c) => (c.children || []).some((k) => k.flagged || holdsFlag(k));

  const problems = new Map();
  for (const p of s.problems) if (!problems.has(p.id) || p.level === 'error') problems.set(p.id, p);
  const proposed = new Map();
  if (s.proposal) for (const c of s.proposal.changes) if (c.id) proposed.set(c.id, c.kind === 'removed' ? 'remove' : 'change');
  const act = new Map();                               // cue id -> its own running entry
  const under = new Map();                             // top-level id -> the longest sound under it
  for (const a of e.active) {
    if (!act.has(a.id) || a.kind === 'audio') act.set(a.id, a);
    if (a.kind === 'audio' && a.parent && (!under.has(a.parent) || a.total > under.get(a.parent).total)) under.set(a.parent, a);
  }

  const click = (ev, id) => {
    if (ev.shiftKey && sel.length) {
      const a = rows.findIndex((r) => r.cue.id === sel[0]), b = rows.findIndex((r) => r.cue.id === id);
      setSel(rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.cue.id).sort((x, y) => (x === sel[0] ? -1 : y === sel[0] ? 1 : 0)));
    } else if (mod(ev)) setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
    else select([id]);
  };
  const toggle = (ev, id) => { ev.stopPropagation(); const n = new Set(collapsed); if (n.has(id)) n.delete(id); else n.add(id); setCollapsed(n); };
  const commit = (id, field, value) => { setEditing(null); if (value !== null && value !== (byId.get(id).cue[field] || '')) setCue(id, { [field]: value }, field); };
  // a time typed in place ("1:30", "90"); emptied, a wait goes back to none
  const commitTime = (id, field, value) => { setEditing(null); if (value === null) return; const v = value.trim(); const c = byId.get(id).cue; if (v === (c[field] ? clock(Number(c[field]), 2) : '')) return; setCue(id, { [field]: v === '' ? (field === 'duration' ? null : 0) : v }, TIME_LABEL[field]); };
  const timeCell = (c, field, shown) => (editing && editing.id === c.id && editing.field === field
    ? html`<${Inline} mono value=${c[field] ? clock(Number(c[field]), 2) : ''} onDone=${(v) => commitTime(c.id, field, v)} />` : shown);

  const duration = (c) => {
    // (a video's length is its file's, as a sound's is; a still, a title or a camera has one only if it was given one)
    if (['video', 'text', 'camera'].includes(c.type) && !e.durations[c.file]) return Number(c.duration) > 0 ? clock(Number(c.duration)) : '';
    if (c.type === 'audio' || c.type === 'video') {
      const d = e.durations[c.file];
      if (!d) return '';
      const end = c.cutAt > 0 ? Math.min(c.cutAt, d) : d;
      return clock(Math.max(0, end - (c.from || 0)));
    }
    if (c.type === 'fade' || c.type === 'wait' || c.type === 'mix') {
      // left alone, it runs for the default the inspector shows in grey
      const f = ((info.types[c.type] || {}).fields || []).find((x) => x.key === 'duration');
      return clock(Number(c.duration ?? (f && f.default)) || 0);
    }
    if ((c.type === 'network' || c.type === 'device' || c.type === 'midi' || c.type === 'timecode') && Number(c.duration) > 0) return clock(Number(c.duration));
    if (c.type === 'midifile' && e.durations[c.file]) return clock(e.durations[c.file] / (Number(c.rate) > 0 ? Number(c.rate) : 1));
    return '';
  };

  // the optional columns (Target, Pre-wait, Duration, Post-wait): one that nothing in this list fills is left out, and
  // comes back with the first cue that has a value. Decided in Edit; in Show mode they stay as they were when it began
  // (tidy.js), so no row moves while the show runs.
  const usedNow = useMemo(() => Tidy.usedColumns(list ? list.cues : [], duration), [list, e.durations, info]);
  const heldCols = useRef({});
  const cols = Tidy.frozenColumns(heldCols.current, usedNow, !editMode);

  // ── drag: cues to reorder (or into a group), sound files from the desktop to add ──
  const over = (ev, row) => {
    const files = ev.dataTransfer.types.includes('Files'), newType = ev.dataTransfer.types.includes('application/x-ec-type');
    if (!files && !dragged.current && !newType) return;
    if (!editMode) return;
    ev.preventDefault();
    const r = ev.currentTarget.getBoundingClientRect();
    const y = (ev.clientY - r.top) / r.height;
    const mid = y > 0.25 && y < 0.75;
    const into = row.cue.type === 'group' && y > 0.3 && y < 0.7 && !files && !newType;
    // the middle of a row is the cue itself: a cue dropped there becomes its target (when it is a kind of cue this
    // one can be aimed at), and one sound file dropped on an Audio cue becomes the file it plays
    const d = dragged.current && byId.get(dragged.current) ? byId.get(dragged.current).cue : null;
    const tf = d && d.id !== row.cue.id && info.types[row.cue.type].fields.find((f) => f.key === 'target');
    const aim = mid && tf && (!tf.targets || tf.targets.includes(d.type));
    const swap = mid && files && row.cue.type === 'audio' && ev.dataTransfer.items.length === 1;
    setDrop({ id: row.cue.id, where: aim ? 'target' : swap ? 'file' : into ? 'into' : y < 0.5 ? 'before' : 'after' });
  };
  const dropOn = async (ev) => {
    ev.preventDefault();
    const d = drop; setDrop(null); setFilesOver(false);
    if (ev.dataTransfer.files && ev.dataTransfer.files.length) {
      const paths = [...ev.dataTransfer.files].map((f) => ec.pathFor(f)).filter(Boolean);
      // a QLab workspace dropped on the window is imported as a new show
      const qlab = paths.find((p) => /\.qlab[45](backup)?$/i.test(p));
      if (qlab) { ec.app({ op: 'import-qlab', path: qlab }); return; }
      if (d && d.where === 'file' && paths.length === 1) { const r = await cmd({ op: 'retarget', id: d.id, path: paths[0] }); if (r && !r.error) { setSel([d.id]); if (say) say(`${s.labels[d.id]} now plays ${paths[0].split(/[\\/]/).pop()}`); } return; }
      let after = d ? d.id : null;
      if (d && d.where === 'before') { const i = rows.findIndex((r) => r.cue.id === d.id); after = i > 0 && rows[i - 1].depth === rows[i].depth ? rows[i - 1].cue.id : null; }
      const r = await cmd({ op: 'import', paths, after });
      if (r && r.made) setSel(r.made);
      return;
    }
    // a cue type dragged from the toolbar: a new cue of it, where it was dropped
    const newType = ev.dataTransfer.getData('application/x-ec-type');
    if (newType && !dragged.current) { if (addCue && info.types[newType]) addCue(newType, d && d.where !== 'into' ? { [d.where === 'before' ? 'before' : 'after']: d.id } : null); return; }
    const id = dragged.current; dragged.current = null;
    if (!id || !d) return;
    if (d.where === 'target') { const r = await setCue(d.id, { target: id }, 'target'); if (r && !r.error && say) say(`${s.labels[d.id] || 'The cue'} now targets ${byId.get(id).cue.number ? byId.get(id).cue.number + ' · ' : ''}${s.labels[id]}`); return; }
    // (a section heading dragged alone takes the cues under it along: the scene moves, not only its title)
    const sec = !sel.includes(id) || sel.length === 1 ? secs.find((x) => x.cue.id === id) : null;
    const ids = sec ? [id, ...list.cues.filter((c) => sec.ids.has(c.id)).map((c) => c.id)] : sel.includes(id) ? rows.filter((r) => sel.includes(r.cue.id) && !(r.parent && sel.includes(r.parent.id))).map((r) => r.cue.id) : [id];
    if (ids.includes(d.id)) return;
    edit([{ op: 'cue.move', ids, ...(d.where === 'into' ? { parent: d.id } : { [d.where]: d.id }) }], 'move');
  };

  return html`<div ref=${wrap} class=${cx('list', filesOver && 'dropping', rowSize && rowSize !== 'normal' && `rows-${rowSize}`, zoom.zoomed && 'zoomed', zoom.overview && 'overview',
      !cols.target && 'no-target', !cols.preWait && 'no-pre', !cols.duration && 'no-dur', !cols.postWait && 'no-post')} tabindex="-1"
      onDragOver=${(ev) => { if (editMode && ev.dataTransfer.types.includes('Files')) { ev.preventDefault(); setFilesOver(true); } else if (editMode && ev.dataTransfer.types.includes('application/x-ec-type')) ev.preventDefault(); }}
      onDragLeave=${(ev) => { if (ev.target === wrap.current) { setFilesOver(false); setDrop(null); } }}
      onDrop=${dropOn}
      onClick=${(ev) => { if (ev.target === wrap.current || ev.target.tagName === 'TABLE') setSel([]); }}>
    <table>
      <thead><tr>
        <th class="c-status"></th><th class="c-type"></th><th class="c-num">Number</th><th>Name</th><th class="c-target">Target</th>
        <th class="c-time c-pre r">Pre-wait</th><th class="c-time c-dur r">Duration</th><th class="c-time c-post r">Post-wait</th><th class="c-cont" title="Continue"><button class="zoom-btn" data-list-zoom tabindex="-1" onMouseDown=${(ev) => ev.preventDefault()} onClick=${() => zoom.toggle()}
          title=${keys(zoom.zoomed ? 'Back to normal size (⌘=, or pinch)' : 'The whole show (⌘−, or pinch)')}>${zoom.zoomed ? '+' : '−'}</button></th>
      </tr></thead>
      <tbody>
        ${rows.map((row) => {
          const c = row.cue, id = c.id;
          // a section: a heading across the whole row; a plain click folds it (and selects it, so it can be renamed)
          if (row.heading) {
            return html`<${SectionRow} key=${id} span=${9 - ['target', 'preWait', 'duration', 'postWait'].filter((k) => !cols[k]).length} row=${row} sec=${secs.find((x) => x.cue.id === id)} byId=${byId} shut=${collapsed} sel=${sel} s=${s} labels=${s.labels} problems=${problems}
              editing=${editing && editing.id === id && editing.field === 'name'}
              nameCell=${html`<${Inline} value=${c.name || ''} onDone=${(v) => commit(id, 'name', v)} />`}
              chain=${chainLine(marks.get(id))}
              onClick=${(ev) => { if (zoom.overview) { zoom.zoomAt(ev.clientY); return; } if (ev.shiftKey || mod(ev)) { click(ev, id); return; } if (ev.altKey) setCollapsed(foldLike(row, rows, list, byId, collapsed)); else toggle(ev, id); select([id], { playhead: false }); }}
              onCaret=${(ev) => { ev.stopPropagation(); if (ev.altKey) setCollapsed(foldLike(row, rows, list, byId, collapsed)); else toggle(ev, id); }}
              onMenu=${(x) => onMenu && onMenu(x)}
              dropClass=${drop && drop.id === id ? `drop-${drop.where}` : ''}
              drag=${{ draggable: editMode && !editing && !zoom.zoomed, onDblClick: (ev) => { if (editMode && ev.target.closest('.sec-name')) setEditing({ id, field: 'name' }); },
                onDragStart: (ev) => { dragged.current = id; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', id); },
                onDragEnd: () => { dragged.current = null; setDrop(null); }, onDragOver: (ev) => over(ev, row) }} />`;
          }
          const top = row.depth === 0;
          const live = top ? e.live.includes(id) : act.has(id);
          const paused = top ? e.paused.includes(id) : !!(act.get(id) && act.get(id).paused);
          const disarmed = e.disarmed.includes(id) || (row.parent && e.disarmed.includes(row.parent.id));
          const p = problems.get(id);
          const a = top ? (act.get(id) && act.get(id).kind === 'audio' ? act.get(id) : under.get(id) || act.get(id)) : act.get(id);
          const pct = a && a.total > 0 ? Math.min(100, (a.elapsed / a.total) * 100) : 0;
          const target = c.target ? byId.get(c.target) : null;
          const cont = CONTINUE[c.continue];
          const isEditing = (f) => editing && editing.id === id && editing.field === f;
          const col = Tidy.colorCss(c.color);
          return html`<tr key=${id} data-cue=${id} draggable=${editMode && !editing && !zoom.zoomed} style=${col ? `--cc:${col}` : ''}
              class=${cx(sel.includes(id) && 'sel', e.playhead === id && 'head', live && 'live', disarmed && 'off', !top && 'child',
                         drop && drop.id === id && `drop-${drop.where}`, related.has(id) && `rel-${related.get(id)}`, proposed.has(id) && `proposed-${proposed.get(id)}`,
                         found && found.id === id && 'found', linked && linked.ids.includes(id) && 'chain-new')}
              onClick=${(ev) => (zoom.overview ? zoom.zoomAt(ev.clientY) : click(ev, id))}
              onContextMenu=${(ev) => { ev.preventDefault(); if (onMenu) onMenu(id); }}
              onDragStart=${(ev) => { dragged.current = id; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', id); }}
              onDragEnd=${() => { dragged.current = null; setDrop(null); }}
              onDragOver=${(ev) => over(ev, row)}>
            <td class="c-status" title=${marks.has(id) && marks.get(id).down ? `Linked: ${LINK_SAYS[marks.get(id).down]}` : lockPlayhead ? '' : 'Stand by on this cue'} onClick=${lockPlayhead || zoom.overview ? null : (ev) => { ev.stopPropagation(); let t = row; while (t.parent) t = { cue: t.parent, parent: (byId.get(t.parent.id) || {}).parent }; cmd({ op: 'playhead', id: t.cue.id }); }}>
              ${chainLine(marks.get(id))}
              ${(() => { const col = c.color2 && c.color2 !== 'none' && played.has(id) ? c.color2 : c.color; return Tidy.colorCss(col) ? html`<span class=${cx('swatch', col !== c.color && 'played')} style=${`background:${Tidy.colorCss(col)}`}></span>` : null; })()}
              <span class="st">
                ${p ? html`<span class=${p.level === 'error' ? 'x' : 'flag'} title=${p.why}>${p.level === 'error' ? '✕' : '▲'}</span>`
                  : paused ? html`<span class="pause">❙❙</span>` : live ? html`<span class="play">▶</span>` : e.playhead === id ? html`<span class="ph">➤</span>` : null}
                ${c.flagged ? html`<span class="flag" title="Flagged">⚑</span>` : c.children && collapsed.has(id) && holdsFlag(c) ? html`<span class="flag hollow" title="A cue inside this group is flagged">⚐</span>` : null}
                ${related.has(id) ? html`<span class="rel" title=${related.get(id) === 'target' ? 'The selected cue’s target' : 'Aimed at the selected cue'}>${related.get(id) === 'target' ? '◎' : '↗'}</span>` : null}
                ${pending.cues.has(id) ? html`<span class="unsaved-dot" title=${`Not saved yet (${[...pending.cues.get(id).kinds].join(', ')})`}></span>` : null}
              </span></td>
            <td class="c-type" title=${info.types[c.type].label}>${info.types[c.type].glyph}</td>
            <td class="c-num" onDblClick=${() => editMode && setEditing({ id, field: 'number' })}>${isEditing('number') ? html`<${Inline} mono value=${c.number || ''} onDone=${(v) => commit(id, 'number', v)} />` : c.number || ''}</td>
            <td class="c-name" onDblClick=${() => editMode && setEditing({ id, field: 'name' })}>
              <span class="indent" style=${`width:${row.depth * 18}px`}></span>
              ${c.children ? html`<span class="caret" title="⌥: every group beside it" onClick=${(ev) => { if (ev.altKey) { ev.stopPropagation(); setCollapsed(foldLike(row, rows, list, byId, collapsed)); } else toggle(ev, id); }}>${collapsed.has(id) ? '▶' : '▼'}</span>` : row.depth ? html`<span class="caret"></span>` : null}
              ${isEditing('name') ? html`<${Inline} value=${c.name || (c.type === 'audio' ? s.labels[id] : '')} onDone=${(v) => commit(id, 'name', v === s.labels[id] && !c.name ? null : v)} />`
                : html`<span class=${c.name ? '' : 'auto'}>${s.labels[id]}</span>`}
              ${drop && drop.id === id && (drop.where === 'target' || drop.where === 'file') ? html`<span class="tag drophint">${drop.where === 'target' ? 'drop: make it the target' : 'drop: play this file'}</span>` : null}
              ${c.type === 'light' ? html`<span class="tag">LIGHTS</span>` : null}
              ${c.loop ? html`<span class="tag">loop</span>` : null}
              ${c.children && collapsed.has(id) ? html`<span class="tag">${c.children.length}</span>` : null}
              ${c.fadeOthers > 0 ? html`<span class="tag">fade others ${c.fadeOthers}s</span>` : null}
              ${c.onBeat && c.onBeat !== 'now' ? html`<span class="tag">on the ${c.onBeat}</span>` : null}
              ${live ? html`<${RowLive} id=${id} c=${c} s=${s} a=${a} sounding=${!!(a && a.kind === 'audio')} show=${!editMode} />` : null}
            </td>
            <td class="c-target">${target ? `${target.cue.number ? target.cue.number + ' · ' : ''}${s.labels[c.target]}` : c.target && s.doc.lists.some((l) => l.id === c.target) ? `the list ${s.doc.lists.find((l) => l.id === c.target).name}` : c.type === 'audio' || c.type === 'video' ? html`<span title=${`${c.file || ''}${c.bus ? `  ·  bus: ${c.bus}` : ''}`}>${c.name && c.file ? String(c.file).split(/[\\/]/).pop() : c.bus || ''}</span>` : c.type === 'network' ? c.message : ''}</td>
            <td class="c-time c-pre r num" onDblClick=${() => editMode && setEditing({ id, field: 'preWait' })}>${timeCell(c, 'preWait', c.preWait ? clock(c.preWait) : '')}</td>
            <td class="c-time c-dur r num" onDblClick=${() => editMode && HAS_DURATION.includes(c.type) && setEditing({ id, field: 'duration' })}>${timeCell(c, 'duration', a && a.kind === 'audio' && live ? html`<span style="color:var(--go)">−${clock(Math.max(0, (a.end || a.total) - a.elapsed))}</span>` : duration(c))}</td>
            <td class="c-time c-post r num" onDblClick=${() => editMode && setEditing({ id, field: 'postWait' })}>${timeCell(c, 'postWait', c.postWait ? clock(c.postWait) : '')}</td>
            <td class="c-cont" title=${cont ? cont[1] : editMode ? 'Continue mode' : ''}
                onClick=${(ev) => { if (!editMode) return; ev.stopPropagation(); setCue(id, { continue: NEXT_CONTINUE[c.continue || 'none'] }, 'continue'); }}>${cont ? cont[0] : ''}
              ${pct > 0 ? html`<span class=${cx('progress', a.kind === 'wait' && 'wait')} style=${`width:${pct}%`}></span>` : null}</td>
          </tr>`;
        })}
      </tbody>
    </table>
    ${rows.length === 0 && html`<div class="empty"><div><b>No cues yet</b>${editMode ? 'Drop sound files here.' : 'Switch to Edit to add some.'}</div></div>`}
  </div>`;
}
