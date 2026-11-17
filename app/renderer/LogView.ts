// The show log (View ▸ Show Log, ⌥⌘L): what happened as the show ran, as it is written in the show's logs folder
// (core/log/show-log.ts). Read-only. It follows as lines come in, unless it has been scrolled up; it can be
// narrowed to one kind of line and searched; Copy takes what is shown, and Reveal opens the folder.
import { html, useState, useEffect, useRef, cx, ec } from './lib.js';
import type { LogEntry } from '../../core/log/show-log';

const KINDS = [['all', 'All'], ['go', 'GO'], ['cue', 'Cues'], ['trigger', 'Triggers'], ['problems', 'Problems'], ['show', 'Show']];
const isProblem = (k: string) => k === 'error' || k === 'warning' || k === 'ignored';
const p2 = (n: number) => String(n).padStart(2, '0');
const time = (at: number) => { const d = new Date(at); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`; };

export function LogDrawer({ close, say }: { close: () => void; say: (text: string, bad?: boolean) => void }) {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [kind, setKind] = useState('all');
  const [find, setFind] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const since = useRef(0), box = useRef<HTMLDivElement>(null), follow = useRef(true);
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const r = await ec.cmd({ op: 'log-tail', since: since.current }) as { error?: string; file?: string; lines: LogEntry[] };
      if (!alive || !r || r.error) return;
      setFile(r.file || null);
      if (!r.lines.length) return;
      // (a new sitting, another show opened, counts from where it is: the lines go on from there)
      since.current = r.lines[r.lines.length - 1].n;
      setLines((old) => [...old, ...r.lines].slice(-3000));
    };
    pull(); const t = setInterval(pull, 500);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const q = find.trim().toLowerCase();
  const shown = lines.filter((e) => (kind === 'all' || (kind === 'problems' ? isProblem(e.kind) : e.kind === kind)) && (!q || e.text.toLowerCase().includes(q) || (e.cue || '').toLowerCase() === q));
  useEffect(() => { if (box.current && follow.current) box.current.scrollTop = box.current.scrollHeight; }, [shown.length, kind, q]);
  const onScroll = () => { const b = box.current; if (b) follow.current = b.scrollHeight - b.scrollTop - b.clientHeight < 24; };
  const copy = async () => {
    const text = shown.map((e) => `${time(e.at)}  ${e.kind.padEnd(8)}${e.text}`).join('\n');
    const r = await ec.app({ op: 'copy-text', text });
    say(r && r.ok ? `${shown.length} line${shown.length === 1 ? '' : 's'} copied` : 'Could not copy', !(r && r.ok));
  };
  return html`<div class="drawer-pane showlog" data-log>
    <div class="drawer-head"><span>Log</span><span class="grow"></span>
      <button class="btn ghost small" data-log-copy onClick=${copy} disabled=${!shown.length} title="Copy the lines shown">Copy</button>
      <button class="btn ghost small" data-log-reveal onClick=${() => ec.app({ op: 'log-reveal' })} disabled=${!file} title=${file || 'An untitled show’s log is kept until it is saved'}>Reveal</button>
      <button class="btn ghost small icon" onClick=${close} title="Close">×</button></div>
    <div class="drawer-body">
      <div class="seg log-kinds">${KINDS.map(([k, l]) => html`<button key=${k} data-log-kind=${k} class=${cx(kind === k && 'on')} onClick=${() => setKind(k)}>${l}</button>`)}</div>
      <input type="text" data-log-find placeholder="Find" value=${find} onInput=${(e: Event) => setFind((e.target as HTMLInputElement).value)} />
      <div class="log-list" ref=${box} onScroll=${onScroll}>
        ${shown.length ? shown.map((e) => html`<div class=${cx('logl', e.kind)} key=${e.n}><span class="t">${time(e.at)}</span><span class="k">${e.kind}</span><span class="m">${e.text}</span></div>`)
          : html`<div class="dim" style="padding:14px">${lines.length ? 'Nothing matches.' : 'Nothing yet.'}</div>`}
      </div>
    </div>
  </div>`;
}
