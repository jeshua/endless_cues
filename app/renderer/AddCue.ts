// The add-cue bar's "+": every cue type the bar does not show, in a short list that narrows as you type (Enter adds
// the first, ↑ ↓ choose, Esc closes). Typed text finds any type, the ones on the bar too. Each type keeps its ⌘ key.
import { html, useState, useEffect, useRef, cx, keys } from './lib.js';
import * as Tidy from './tidy.js';


export function AddMore({ info, shown, add }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [at, setAt] = useState(0);
  const box = useRef();
  const rest = info.typeOrder.filter((t) => !shown.includes(t));
  const ids = text.trim() ? Tidy.matchTypes(info.types, info.typeOrder, text) : rest;
  const close = () => { setOpen(false); setText(''); setAt(0); };
  // a click anywhere else closes it
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) close(); };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, [open]);
  const pick = (t) => { if (!t) return; close(); add(t); };
  const key = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(ids[Math.min(at, ids.length - 1)]); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(ids.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
  };
  return html`<span class="add-more" ref=${box}>
    <button class=${cx('tool more', open && 'on')} data-tools-more onClick=${() => (open ? close() : setOpen(true))} title="Every other cue type (type to find one)">+</button>
    ${open ? html`<div class="add-list" data-add-list>
      <input type="text" placeholder="Find a cue type" value=${text} ref=${(el) => { if (el && document.activeElement !== el) el.focus(); }}
        onInput=${(e) => { setText(e.target.value); setAt(0); }} onKeyDown=${key} />
      <div class="opts">${ids.length ? ids.map((t, i) => { const n = info.typeOrder.indexOf(t); return html`<button key=${t} data-add-pick=${t} class=${cx(i === at && 'on')}
          onMouseEnter=${() => setAt(i)} onClick=${() => pick(t)} title=${info.types[t].summary}>
          <span class="g">${info.types[t].glyph}</span><span class="nm">${info.types[t].label}</span>${n < 10 ? html`<span class="k">${keys(`⌘${(n + 1) % 10}`)}</span>` : null}</button>`; })
        : html`<div class="none">No cue type is called that.</div>`}</div>
    </div>` : null}
  </span>`;
}
