// Run from here (right-click a cue ▸ Run from Here…, or Tools ▸ Run from the Selected Cue…): a rehearsal at that
// cue with what would be going on there had the show run up to it (core/engine/run-from.ts). It says what it will
// start before it starts anything; Edit mode only.
import { html, useState, useEffect, ec } from './lib.js';
import type { Reply } from './lib.js';

export function RunFrom({ id, label, close, say }: { id: string; label: string; close: () => void; say: (text: string, bad?: boolean) => void }) {
  const [p, setP] = useState<Reply | null>(null);
  useEffect(() => { ec.cmd({ op: 'run-from', id, preview: true }).then((r: Reply | null) => setP(r || { error: 'no answer' })); }, [id]);
  const run = async () => {
    if (!p || p.error) return;
    const r: Reply | null = await ec.cmd({ op: 'run-from', id });
    close();
    if (r && !r.error) say(`From ${label}: ${r.text.charAt(0).toLowerCase()}${r.text.slice(1)}`); else say((r && r.error) || 'Could not run from here', true);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); run(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  const lines: string[] = p && !p.error ? p.lines || [] : [];
  return html`<div class="scrim" onMouseDown=${(e: MouseEvent) => { if (e.target === e.currentTarget) close(); }}><div class="sheet runfrom" data-run-from role="dialog" aria-label="Run from here">
    <h2>Run from ${label}</h2>
    <p data-run-from-text>${!p ? 'Working it out…' : p.error ? p.error : p.text}</p>
    ${lines.length ? html`<ul class="runfrom-list">${lines.slice(0, 8).map((l: string, i: number) => html`<li key=${i}>${l}</li>`)}${lines.length > 8 ? html`<li class="dim">and ${lines.length - 8} more</li>` : null}</ul>` : null}
    ${p && p.playing ? html`<p class="dim">What is playing now stops first.</p>` : null}
    <div class="acts"><span class="grow"></span>
      <button class="btn" onClick=${close}>Cancel</button>
      <button class="btn primary" data-run-from-go disabled=${!p || !!p.error} onClick=${run}>Run from here</button></div>
  </div></div>`;
}
