// The web remote's code (remote.html). A plain script: web-remote.ts writes remote.js
// into the page it serves, so the page stays one file.

/** What the page is sent (web-remote.ts `view`). */
interface RemoteView {
  title: string; list: string; playhead: string | null; control: boolean;
  mix: { masterDb: number; buses: { id: string; name: string; db: number }[]; loaded: { id: string; at: number } | null; min: number; max: number } | null;
  cues: { id: string; number: string; name: string; type: string; notes: string; color: string; live: boolean; paused: boolean; disarmed: boolean }[];
  active: { name: string; elapsed: number; total: number; paused: boolean }[];
}
/** What the page sends: a host command. */
type RemoteCmd = { op: string; [field: string]: unknown };

const k = new URLSearchParams(location.search).get('k') || '';
// (every id asked for is in remote.html)
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);
const clock = (t: number) => { t = Math.max(0, t); return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
let state: RemoteView | null = null, lastHead: string | null = null;
function cmd(c: RemoteCmd) { fetch(`/cmd?k=${encodeURIComponent(k)}`, { method: 'POST', body: JSON.stringify(c) }).catch(() => {}); }
function paint() {
  const s = state; if (!s) return;
  document.body.classList.toggle('view', !s.control);
  $('title').textContent = s.title;
  const head = s.cues.find((c) => c.id === s.playhead);
  $('sn').textContent = head ? head.number : '';
  $('sname').textContent = head ? head.name : 'End of list';
  $('notes').textContent = head ? head.notes : '';
  $<HTMLButtonElement>('go').disabled = !head;
  $('list').innerHTML = s.cues.map((c) => `<div class="row${c.id === s.playhead ? ' head' : ''}${c.live ? ' live' : ''}${c.disarmed ? ' off' : ''}" data-id="${esc(c.id)}"><span class="n">${esc(c.number)}</span><span class="name">${esc(c.name)}</span></div>`).join('');
  if (s.playhead !== lastHead) { lastHead = s.playhead; const el = document.querySelector('.row.head'); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  const a = $('active');
  a.classList.toggle('on', s.active.length > 0);
  paintMix();
  a.innerHTML = s.active.slice(0, 3).map((x) => `<div>${esc(x.name)} <span style="float:right">${x.total ? '−' + clock(x.total - x.elapsed) : clock(x.elapsed)}${x.paused ? ' ❙❙' : ''}</span></div><div class="bar"><i style="width:${x.total ? Math.min(100, 100 * x.elapsed / x.total) : 0}%"></i></div>`).join('');
}
function connect() {
  const es = new EventSource(`/events?k=${encodeURIComponent(k)}`);
  es.onopen = () => $('dot').classList.add('on');
  es.onmessage = (e) => { state = JSON.parse(e.data); paint(); };
  es.onerror = () => { $('dot').classList.remove('on'); es.close(); setTimeout(connect, 1500); };
}
// ── levels and Load to Time ──
const dB = (v: number) => (v <= -60 ? '−∞' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`);
/** "1:30", "1:02:03" or "90" as seconds (a leading − counts back from the end); null if it is not a time. */
function seconds(text: unknown): number | null {
  const t = String(text).trim().replace(/^[-−]/, '');
  if (!/^\d+(\.\d+)?(:\d{1,2}(\.\d+)?){0,2}$/.test(t)) return null;
  const n = t.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
  return /^[-−]/.test(String(text).trim()) ? -n : n;
}
let touching: string | null = null, sendAt = 0, pending: RemoteCmd | null = null;       // the fader under a finger is not moved by what arrives meanwhile
function level(c: RemoteCmd) {                                    // at most ten a second while a fader is dragged, and always the last one
  pending = c;
  const wait = Math.max(0, sendAt + 100 - Date.now());
  setTimeout(() => { if (pending) { cmd(pending); pending = null; sendAt = Date.now(); } }, wait);
}
function paintMix() {
  const m = state && state.mix;
  document.body.classList.toggle('mix', !!m);
  if (!m) return;
  const rows = [...m.buses.map((b) => ({ key: `bus:${b.id}`, name: b.name, db: b.db })), { key: 'master', name: 'Master', db: m.masterDb }];
  const box = $('faders');
  if (box.dataset.keys !== rows.map((r) => r.key + r.name).join('|')) {
    box.dataset.keys = rows.map((r) => r.key + r.name).join('|');
    box.innerHTML = rows.map((r) => `<div class="fader"><span class="name">${esc(r.name)}</span><input type="range" min="${m.min}" max="${m.max}" step="0.5" data-key="${esc(r.key)}"><span class="db"></span></div>`).join('');
  }
  for (const r of rows) {
    const el = box.querySelector<HTMLInputElement>(`input[data-key="${CSS.escape(r.key)}"]`);
    if (!el) continue;
    if (touching !== r.key) el.value = String(r.db);
    el.nextElementSibling!.textContent = dB(Number(el.value));
  }
  $('loaded').textContent = m.loaded && m.loaded.id === state!.playhead ? `loaded to ${clock(Math.abs(m.loaded.at))}${m.loaded.at < 0 ? ' from the end' : ''}` : '';
}
$('more').onclick = () => document.body.classList.toggle('open');
$('faders').oninput = (e) => {
  const input = e.target as HTMLInputElement;
  const key = input.dataset.key; if (!key) return;
  touching = key;
  const db = Number(input.value);
  input.nextElementSibling!.textContent = dB(db);
  level(key === 'master' ? { op: 'master', db } : { op: 'bus', name: key.slice(4), db });
};
$('faders').onchange = (e) => {           // the finger came off: that is the level now, in the window too
  const input = e.target as HTMLInputElement;
  const key = input.dataset.key; if (!key) return;
  const db = Number(input.value);
  pending = null;
  cmd(key === 'master' ? { op: 'master', db, commit: true } : { op: 'bus', name: key.slice(4), db, commit: true });
  setTimeout(() => { touching = null; }, 600);
};
$('load').onclick = () => { const secs = seconds($<HTMLInputElement>('loadat').value); if (secs == null) { $<HTMLInputElement>('loadat').select(); return; } cmd({ op: 'load', secs }); };       // (not a time: it is left selected, to be typed again)
$('unload').onclick = () => { $<HTMLInputElement>('loadat').value = ''; cmd({ op: 'load', secs: 0 }); };
$('go').onclick = () => cmd({ op: 'go' });
$('up').onclick = () => cmd({ op: 'move', step: -1 });
$('down').onclick = () => cmd({ op: 'move', step: 1 });
$('panic').onclick = () => cmd({ op: 'panic' });
$('list').onclick = (e) => { const r = (e.target as HTMLElement).closest<HTMLElement>('.row'); if (r && state && state.control) cmd({ op: 'playhead', id: r.dataset.id }); };
connect();
