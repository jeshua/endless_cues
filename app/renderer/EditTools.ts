// Small tools for building a show: Paste Cue Properties' chooser, and Check the show (with the flagged cues),
// which the footer's Check and its counts open.
import { html, useState, useEffect, cx, keys, ec } from './lib.js';

/** What makes a cue that cue, more than how it behaves: left unticked until asked for. */
const ITS_OWN = ['name', 'notes', 'file', 'target', 'hotkey', 'oscTrigger', 'midiTrigger', 'clockTrigger', 'flagged', 'message', 'midi', 'lightCue'];

/**
 * Paste Cue Properties (⌥⌘V): which settings of the copied cue go onto the selected cues. `clip` is the host's
 * word on what is on the clipboard ({ cue, properties: [{ key, label, set }] }); `last` the keys ticked the time
 * before, so doing the same again is one key and Enter.
 */
export function PasteProps({ clip, label, typeLabel, count, last, onPaste, close }) {
  const props = clip.properties;
  const [on, setOn] = useState(() => new Set(last && last.some((k) => props.some((p) => p.key === k)) ? last.filter((k) => props.some((p) => p.key === k)) : props.filter((p) => p.set && !ITS_OWN.includes(p.key)).map((p) => p.key)));
  const flip = (k) => { const n = new Set(on); if (n.has(k)) n.delete(k); else n.add(k); setOn(n); };
  const paste = () => { if (on.size) onPaste([...on]); };
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); paste(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  return html`<div class="scrim" onMouseDown=${(e) => { if (e.target === e.currentTarget) close(); }}><div class="sheet pasteprops">
    <h2>Paste cue properties</h2>
    <p class="dim">From ${typeLabel} cue <b>${label}</b> onto ${count === 1 ? 'the selected cue' : `${count} selected cues`}. Faint settings go back to their default.</p>
    <div class="props">${props.map((p) => html`<label class=${cx(!p.set && 'unset')} key=${p.key}><input type="checkbox" checked=${on.has(p.key)} onChange=${() => flip(p.key)} />${p.label}</label>`)}</div>
    <div class="acts">
      <button class="btn small" onClick=${() => setOn(new Set(props.filter((p) => p.set).map((p) => p.key)))}>Everything it sets</button>
      <button class="btn small" onClick=${() => setOn(new Set())}>None</button>
      <span class="grow"></span>
      <button class="btn" onClick=${close}>Cancel</button>
      <button class="btn primary" disabled=${!on.size} onClick=${paste}>Paste ${on.size || ''}</button>
    </div>
  </div></div>`;
}

/**
 * Check the show (⇧⌘F, the footer's Check and its counts, the Rig page): everything that would go wrong in it,
 * found without playing anything, in one list (the host's `check`, core/show/check.js), and the cues someone
 * flagged. A line about a cue goes to the cue (opening the group it is in); one about the equipment, to the Rig.
 * It asks again as the show changes, and every two seconds while it is open (a device can stop answering).
 */
export function Checks({ s, byId, reveal, close, openRig }) {
  const [r, setR] = useState(null);
  useEffect(() => {
    let gone = false;
    const ask = () => ec.cmd({ op: 'check' }).then((x) => { if (!gone && x && !x.error) setR(x); });
    ask();
    const t = setInterval(ask, 2000);
    return () => { gone = true; clearInterval(t); };
  }, [s.rev]);
  const lines = r ? r.lines : [];
  const problems = lines.filter((x) => x.level === 'problem'), looks = lines.filter((x) => x.level !== 'problem');
  const flagged = [...byId.values()].filter((x) => x.cue.flagged).map((x) => x.cue);
  const name = (id) => { const x = byId.get(id); return x ? `${x.cue.number ? x.cue.number + ' · ' : ''}${s.labels[id] || ''}` : ''; };
  const go = (x) => (x.id && byId.has(x.id) ? reveal(x.id) : x.rig && openRig ? openRig() : null);
  const row = (x, mark, kind, k) => html`<button key=${k} class="check" data-check-line=${x.level} onClick=${() => go(x)} title=${x.text}><span class=${cx('mk', kind)}>${mark}</span><span class="nm">${x.id ? name(x.id) : 'Rig'}</span>${x.text ? html`<span class="why">${x.text}</span>` : null}</button>`;
  return html`<div class="checks" data-checks>
    <div class="ch"><b>Check</b><span class="dim" style="margin-left:10px" data-check-summary>${r ? r.summary : 'Checking…'}</span><span class="grow"></span><button class="btn ghost small icon" onClick=${close} title="Close (Esc)">×</button></div>
    <div class="cb">
      ${problems.length ? html`<h4>Problems · ${problems.length}</h4>${problems.map((x, i) => row(x, '✕', 'x', `p${i}`))}` : null}
      ${looks.length ? html`<h4>To look at · ${looks.length}</h4>${looks.map((x, i) => row(x, '▲', 'w', `l${i}`))}` : null}
      ${r && !lines.length ? html`<div class="dim" style="padding:8px 10px 4px">Nothing wrong. Nothing was played to find out.</div>` : null}
      <h4>Flagged · ${flagged.length}</h4>
      ${flagged.length ? flagged.map((c) => row({ id: c.id, text: c.notes ? String(c.notes).split('\n')[0] : '' }, '⚑', 'w', `f${c.id}`))
        : html`<div class="dim" style="padding:4px 10px 8px">No cue is flagged. F flags the selected cue.</div>`}
    </div>
  </div>`;
}
