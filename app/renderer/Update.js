// A newer version, in one line in the title bar (a pill in the accent, its one action a primary button) (app/main/updates.js decides when there is one). Never in
// Show mode or while anything plays: the line is not drawn, and the app does nothing about updates meanwhile.
import { html, useState, useEffect, ec } from './lib.js';

export function useUpdate() {
  const [u, setU] = useState(null);
  useEffect(() => { ec.app({ op: 'update-state' }).then((x) => setU(x)); ec.onUpdate((x) => setU((was) => ({ ...(was || {}), ...x }))); }, []);
  return u;
}

export function UpdateLine({ u, s, say }) {
  if (!u || !u.visible || s.mode === 'show' || (s.engine && s.engine.active && s.engine.active.length)) return null;
  const act = (op) => ec.app({ op }).then((r) => { if (r && r.error) say(r.error, true); });
  const v = u.version;
  return html`<span class="update-line" data-update=${u.step}>
    ${u.step === 'available' ? html`<span>Version ${v} is ready to download.</span>
        <button class="btn primary small" data-update-download onClick=${() => act('update-download')}>Download</button>
        <button class="btn ghost small" data-update-later onClick=${() => act('update-later')}>Not now</button>`
      : u.step === 'downloading' ? html`<span>Downloading version ${v}…${u.percent ? ` ${u.percent}%` : ''}</span>`
      : html`<span>Version ${v} will install when you quit.</span>
        <button class="btn primary small" data-update-restart onClick=${() => act('update-restart')}>Restart now</button>`}
  </span>`;
}
