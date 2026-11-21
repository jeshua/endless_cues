// A newer version, in one line in the title bar (a pill in the accent, its one action a primary button) (app/main/updates.ts decides when there is one). Never in
// Show mode or while anything plays: the line is not drawn, and the app does nothing about updates meanwhile. A copy
// that cannot install over itself (a Linux .deb) says only that a version is out, and its button opens the download page.
import { html, useState, useEffect, ec } from './lib.js';
import type { State } from './lib.js';
import type { UpdateView } from '../../core/update/updates';

export function useUpdate() {
  const [u, setU] = useState<UpdateView | null>(null);
  useEffect(() => { ec.app({ op: 'update-state' }).then((x) => setU(x as UpdateView)); ec.onUpdate((x) => setU((was) => ({ ...(was || {}), ...x }))); }, []);
  return u;
}

export function UpdateLine({ u, s, say }: { u: UpdateView | null; s: State; say: (text: string, bad?: boolean) => void }) {
  if (!u || !u.visible || s.mode === 'show' || (s.engine && s.engine.active && s.engine.active.length)) return null;
  const act = (op: 'update-download' | 'update-later' | 'update-restart') => ec.app({ op }).then((r) => { if (r && r.error) say(r.error, true); });
  const v = u.version;
  return html`<span class="update-line" data-update=${u.step}>
    ${u.step === 'available' && u.page ? html`<span>Version ${v} is out.</span>
        <button class="btn primary small" data-update-download data-update-page onClick=${() => act('update-download')}>Download page</button>
        <button class="btn ghost small" data-update-later onClick=${() => act('update-later')}>Not now</button>`
      : u.step === 'available' ? html`<span>Version ${v} is ready to download.</span>
        <button class="btn primary small" data-update-download onClick=${() => act('update-download')}>Download</button>
        <button class="btn ghost small" data-update-later onClick=${() => act('update-later')}>Not now</button>`
      : u.step === 'downloading' ? html`<span>Downloading version ${v}…${u.percent ? ` ${u.percent}%` : ''}</span>`
      : html`<span>Version ${v} will install when you quit.</span>
        <button class="btn primary small" data-update-restart onClick=${() => act('update-restart')}>Restart now</button>`}
  </span>`;
}
