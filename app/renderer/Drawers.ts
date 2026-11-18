// The two drawers: the assistant (a conversation that ends in changes you review) and the show's saved versions.
import { Monitor } from './Settings.js';
import { html, useState, useEffect, useRef, ec, cmd, cx, relTime, keys } from './lib.js';
import { Qirx, QirxSign, qirxState } from './Qirx.js';
import type { State, Info } from './lib.js';

type Say = (text: string, bad?: boolean) => void;
/** One line of a diff (core/show/diff.ts): a cue, a list, a device or a setting, and what changed of it. */
export interface Change { kind: string; label?: string; path?: string | null; from?: unknown; to?: unknown; count?: number; text?: string; fields?: { label: string; from: unknown; to: unknown }[] }
/** A file a proposal would write into the show folder. */
interface ProposalFile { path: string; lines: number; replaces: boolean; text?: string | null }
/** A change the assistant proposes, waiting to be accepted (host.ts `snapshot`: proposal). */
interface Proposal { id: string; summary: string; changes: Change[]; counts?: Record<string, number>; files?: ProposalFile[] }
/** What accepting wrote that is used outside this window: a guide for a coding agent, a prop's firmware. */
interface Wrote { guide: boolean; props: string[]; dir?: string }
/** One of the assistant's suggested asks (core/assistant/starters.ts). */
interface Ask { label: string; text?: string; action?: string; offline?: boolean }
/** A way to have someone answer: set at once (`set`), or Settings opened on it (`open`). */
interface SetupRow { id: string; label: string; says: string; set?: string | null; open?: string | null; signIn?: boolean }
/** What the assistant says first, of this show (core/assistant/starters.ts `first`). */
interface First { state?: string; line: string; asks?: Ask[]; next?: Ask; setup?: { title?: string; rows: SetupRow[]; foot?: string } | null }

const SIGN: Record<string, string> = { added: '+', removed: '−', changed: '~', moved: '↕', setting: '~', 'list-added': '+', 'list-removed': '−', 'list-renamed': '~', 'device-added': '+', 'device-removed': '−', 'device-changed': '~' };
const isDevice = (c: Change) => String(c.kind).startsWith('device-');

/** A diff, as an operator reads it: one line per cue, the fields that changed under it. */
export function Changes({ changes }: { changes: Change[] }) {
  if (!changes.length) return html`<div class="nothing">No differences.</div>`;
  return changes.map((c) => html`<div class=${cx('change', c.kind.replace('list-', '').replace('device-', ''))}>
    <span class="sign">${SIGN[c.kind] || '~'}</span>
    <div class="what">
      ${c.kind === 'setting' ? html`<span class="mono">${c.path}</span>` : html`<b>${c.label}</b>`}
      ${c.kind === 'added' ? html` <span class="dim">added${c.count ? ` with ${c.count} cue${c.count === 1 ? '' : 's'} inside` : ''}</span>` : null}
      ${c.kind === 'removed' ? html` <span class="dim">removed${c.count ? ` (and ${c.count} inside)` : ''}</span>` : null}
      ${c.kind === 'moved' ? html` <span class="dim">moved ${c.to}</span>` : null}
      ${c.kind === 'list-added' ? html` <span class="dim">list added</span>` : null}
      ${c.kind === 'list-removed' ? html` <span class="dim">list removed</span>` : null}
      ${c.kind === 'list-renamed' ? html` <span class="dim">list renamed from ${c.from}</span>` : null}
      ${c.kind === 'device-added' ? html` <span class="dim">· ${c.text || 'device added'}</span>` : null}
      ${c.kind === 'device-removed' ? html` <span class="dim">· device removed${c.text ? ` (${c.text})` : ''}</span>` : null}
      ${c.kind === 'setting' ? html`<div class="f"><del>${c.from}</del> → <ins>${c.to}</ins></div>` : null}
      ${(c.fields || []).map((f) => html`<div class="f">${f.label}: <del>${f.from}</del> → <ins>${f.to}</ins></div>`)}
    </div></div>`);
}

/** A proposal's files: each a line (click it to read the file before accepting), a replaced one signed ~. */
function Files({ files }: { files: ProposalFile[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return files.map((f) => html`<div class=${cx('change file', f.replaces ? 'changed' : 'added')} key=${f.path} data-review-file=${f.path}>
    <span class="sign">${f.replaces ? '~' : '+'}</span>
    <div class="what">
      <button class=${cx('filename', open === f.path && 'on')} title=${f.path} onClick=${(ev: MouseEvent) => { const card = (ev.currentTarget as HTMLElement).closest('[data-review]'); setOpen(open === f.path ? null : f.path); /* (the card grows: its Accept stays in view) */ requestAnimationFrame(() => card && card.scrollIntoView({ block: 'nearest' })); }}><span class="mono">${f.path}</span></button>
      <span class="dim"> · ${f.lines} line${f.lines === 1 ? '' : 's'}${f.replaces ? ' · replaces one' : ''}</span>
      ${open === f.path ? html`<pre class="filetext mono" data-review-text>${f.text !== undefined && f.text !== null ? f.text : 'Not sent to this window.'}</pre>` : null}
    </div></div>`);
}

function Review({ p, s, say, onHanded }: { p: Proposal; s: State | null; say: Say; onHanded?: (w: Wrote) => void }) {
  const n: Record<string, number | undefined> = p.counts || {};
  const devices = p.changes.filter(isDevice), rest = p.changes.filter((c) => !isDevice(c)), files = p.files || [];
  const parts = ([[n.added, 'added'], [n.changed, 'changed'], [n.removed, 'removed'], [n.moved, 'moved'], [n.settings, 'settings'], [devices.length, devices.length === 1 ? 'device' : 'devices'], [files.length, files.length === 1 ? 'file' : 'files']] as [number | undefined, string][]).filter(([k]) => k).map(([k, w]) => `${k} ${w}`);
  const accept = async () => {
    const wrote: Wrote = { guide: files.some((f) => /(^|\/)AGENTS\.md$/.test(f.path)), props: [...new Set(files.map((f) => (/^(props\/[^/]+)\/[^/]+\.ino$/.exec(f.path) || [])[1]).filter((x): x is string => !!x))] };
    const r = await cmd({ op: 'accept', id: p.id });
    if (r && !r.error) { say(keys(files.length ? `Accepted: ${files.length} file${files.length === 1 ? '' : 's'} written — ⌘Z undoes the show’s part` : 'Accepted — ⌘Z undoes it')); if ((wrote.guide || wrote.props.length) && onHanded) onHanded(wrote); }
  };
  return html`<div class="review" data-review>
    <div class="rh"><span class="k">Proposed change · ${parts.join(' · ')}</span><span class="s">${p.summary}</span></div>
    <div class="rb">
      ${rest.length || (!devices.length && !files.length) ? html`<${Changes} changes=${rest} />` : null}
      ${devices.length ? html`<div class="rpart" data-review-devices>Devices</div><${Changes} changes=${devices} />` : null}
      ${files.length ? html`<div class="rpart" data-review-files>Files for the show folder</div><${Files} files=${files} />` : null}
    </div>
    <div class="rf">
      <span class="dim grow note">Nothing has changed yet.${files.length ? ' Undo does not remove files.' : ''}</span>
      <button class="btn" onClick=${() => cmd({ op: 'reject', id: p.id })}>Reject</button>
      <button class="btn go" data-accept disabled=${s && s.mode === 'show'} title=${s && s.mode === 'show' ? 'Show mode: nothing is accepted' : ''} onClick=${accept}>Accept</button>
    </div>
  </div>`;
}

/** After files were accepted: where they are and what to do with them, which is outside this window.
 *  A hand-over: what to type in a terminal. Firmware: the folder, and that its README.md has the steps. */
function Written({ w, said = '' }: { w: Wrote; said?: string }) {
  // (the terminal's two lines are said once: when the reply above already gives them, the card does not repeat them)
  const told = /^\s*claude\s*$/m.test(said) && /cd\s/.test(said);
  return html`${w.props.map((dir) => html`<div class="handover" data-written=${dir} key=${dir}><div>Firmware in <span class="mono">${dir}/</span>; steps in its <span class="mono">README.md</span>.</div>
      <div><button class="btn small" onClick=${() => ec.app({ op: 'reveal' })}>Show the folder</button></div></div>`)}
    ${w.guide && !told ? html`<div class="handover" data-handover><div>Next, in a terminal:</div>
      <pre class="mono snippet">cd "${w.dir || 'the show folder'}"\nclaude</pre></div>` : null}`;
}

const SUGGESTIONS = ['Fade out cue 1 over 6', 'Set cue 3 level to -6', 'Add a memo called Interval', 'Rename cue 2 to Storm arrives'];

/** Who should answer, when nobody does yet (spec 15, 4.6.1): the host's rows, each true of this computer
 *  (core/assistant/starters.ts `setupRows`). A row either sets a provider at once (`set`) or opens Settings on one (`open`). */
/** "1 December", from the ISO time a month ends. */
const dayWords = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`; };

const setupOf = (first: First | null) => (first && first.setup && Array.isArray(first.setup.rows) ? first.setup : null);

export function AssistantDrawer({ s, info, close, openSettings, say, refreshInfo }: { s: State; info: Info; close: () => void; openSettings: (section: string) => void; say: Say; refreshInfo?: () => unknown }) {
  const a = s.assistant;
  const first: First | null = a.first && typeof a.first === 'object' ? a.first : null;      // what the host says of THIS show (absent: nothing to say)
  const [text, setText] = useState('');
  const [handed, setHanded] = useState<Wrote | null>(null);       // files just accepted ({ guide, props, dir }): the next step is outside this window, and is said here
  const body = useRef<HTMLDivElement>(null);
  // the newest thing is kept in view: a reply, and above all a change waiting to be accepted (again a frame later, once it is laid out)
  useEffect(() => { const down = () => { if (body.current) body.current.scrollTop = body.current.scrollHeight; }; down(); const f = requestAnimationFrame(down); const t = setTimeout(down, 120); return () => { cancelAnimationFrame(f); clearTimeout(t); }; },
    [a.transcript && a.transcript.length, a.busy, s.proposal ? s.proposal.id : '', handed]);
  const locked = s.mode === 'show';
  const setProvider = async (config: { provider?: string | null }) => { await ec.app({ op: 'assistant-config', config }); if (refreshInfo) await refreshInfo(); await cmd({ op: 'state' }); };
  const send = (t: string = text) => { t = String(t).trim(); if (!t || a.busy || locked) return; setText(''); setHanded(null); cmd({ op: 'ask', text: t }); };
  // an ask: most are sent as written; "start from a folder" opens the picker; with no model, one the built-in helper can do switches it on first
  const press = async (k: Ask) => {
    if (k.action === 'start-in-folder') { ec.app({ op: 'start-in-folder' }); return; }
    if (locked) { say('Show mode: switch to Edit to make changes', true); return; }
    if (!a.available) { if (!k.offline) { say('That needs a model', true); return; } await setProvider({ provider: 'demo' }); }
    setHanded(null); cmd({ op: 'ask', text: k.text || k.label });
  };
  const choose = async (r: SetupRow) => {
    // (the Endless Cues assistant: chosen, then signed in here, unless this computer already is: the host knows)
    if (r.signIn) { await setProvider({ provider: r.set }); await ec.app({ op: 'cloud-sign-in' }); return; }
    if (r.set) { await setProvider({ provider: r.set }); }
    else { if (r.open) await setProvider({ provider: r.open }); openSettings('assistant'); }
  };
  const setup = !a.available ? setupOf(first) : null;
  // someone was chosen and cannot answer: one line saying why, never a screen that sits unchanged
  const whyNot = !a.available && a.chosen && a.chosen !== 'off' ? a.missing || 'That one cannot answer yet.' : '';
  const talked = (a.transcript || []).length > 0;
  const face = qirxState(s).state;
  const asks = first ? (first.asks || []).filter((k) => a.available || k.offline).slice(0, 4) : [];
  // the Endless Cues assistant past its allowance: one line, never a broken turn
  const month = a.available && a.provider === 'cloud' && a.cloud && a.cloud.usage ? a.cloud.usage : null;
  const monthLine = !month ? '' : month.tier === 'used_up' ? 'This month’s asks are used up: the built-in helper can still help.'
    : month.tier === 'after' ? `Using a smaller model${month.resets ? ` until ${dayWords(month.resets)}` : ''}.` : '';
  return html`<div class="drawer-pane" data-assistant>
    <div class="drawer-head"><span class="qhead"><${QirxSign} state=${face} /> Assistant</span>${a.available ? html`<span class="badge" data-helper=${a.provider === 'demo'}>${a.provider === 'demo' ? 'built-in helper' : a.model || a.label || a.provider}</span>` : null}<span class="grow"></span>
      ${talked ? html`<button class="btn ghost small" onClick=${() => cmd({ op: 'assistant-reset' })}>Clear</button>` : null}
      <button class="btn ghost small icon" data-assistant-settings onClick=${() => openSettings('assistant')} title="Assistant settings">⚙</button>
      <button class="btn ghost small icon" data-close onClick=${close} title="Close">×</button></div>
    <div class="drawer-body" ref=${body}>
      ${locked ? html`<div class="first asleep" data-asleep><div class="fface"><${Qirx} size=${48} state="asleep" /><div class="fline">Asleep in Show mode.</div></div></div>` : null}
      ${first && !talked && !locked ? html`<div class="first" data-first=${first.state || ''}>
          <div class="fface"><${Qirx} size=${48} state=${face} /><div class="fline">${first.line}</div></div>
          ${asks.length ? html`<div class="asks">${asks.map((k) => html`<button class="btn ask" key=${k.label} data-ask disabled=${a.busy} onClick=${() => press(k)}>${k.label}</button>`)}</div>` : null}
          ${first.next && first.next.label ? (first.next.text && a.available ? html`<button class="fnext link" disabled=${a.busy} onClick=${() => press(first.next!)}>${first.next.label}</button>` : html`<div class="fnext">${first.next.label}</div>`) : null}
          ${setup ? html`<div class="who" data-who>
            ${whyNot ? html`<div class="problem warning whynot" data-whynot>${whyNot}</div>` : null}
            <div class="wh">${setup.title || 'Who should answer?'}</div>
            ${setup.rows.map((r) => html`<button key=${r.id} data-provider=${r.id} onClick=${() => choose(r)}><b>${r.label}</b><span>${r.says}</span></button>`)}
            ${setup.foot ? html`<div class="dim wf">${setup.foot}</div>` : null}</div>` : null}
        </div>` : null}
      ${!setup && !a.available ? html`<div class="first" data-off>
          <div class="fline">The assistant is off.</div>
          ${whyNot ? html`<div class="problem warning whynot" data-whynot>${whyNot}</div>` : null}
          <div class="asks"><button class="btn ask" onClick=${() => openSettings('assistant')}>Choose who answers</button></div></div>` : null}
      ${!first && a.available && !talked ? html`<div class="first"><div class="fline">Ask for a change.</div></div>` : null}
      ${(a.transcript || []).map((m) => html`${m.steps && m.steps.length ? html`<details class="steps"><summary>${m.steps.length} step${m.steps.length === 1 ? '' : 's'}</summary>${m.steps.map((x) => html`<div>· ${x}</div>`)}</details>` : null}
        ${m.role === 'assistant' ? html`<div class="said"><${Qirx} size=${18} state=${locked ? 'asleep' : 'awake'} /><div class=${cx('msg', m.role, m.error && 'error')}>${m.text}</div></div>` : html`<div class=${cx('msg', m.role, m.error && 'error')}>${m.text}</div>`}
        ${m.points && m.points.length && !locked ? html`<div class="msg-points">${m.points.map((p) => html`<button class="btn ghost small" data-show-me=${p.target}
          onClick=${() => cmd({ op: 'point', target: p.target, say: p.say, cue: p.cue })} title="Point at it again">Show me${m.points!.length > 1 ? `: ${p.say || p.target}` : ''}</button>`)}</div>` : null}
        ${m.applied ? html`<div class="steps applied">Applied. ${keys('⌘Z')} undoes it.</div>` : null}`)}
      ${a.busy ? html`<div class="thinking" data-thinking><${Qirx} size=${18} state="thinking" /> ${(a.activity || []).slice(-1)[0] || 'thinking'}</div>${(a.activity || []).length > 1 ? html`<div class="steps">${a.activity!.slice(0, -1).map((x) => html`<div>· ${x}</div>`)}</div>` : null}` : null}
      ${s.proposal ? html`<${Review} p=${s.proposal} s=${s} say=${say} onHanded=${(w: Wrote) => setHanded({ ...w, dir: s.show.dir || '' })} />` : null}
      ${handed !== null && !s.proposal ? html`<${Written} w=${handed} said=${((a.transcript || []).filter((m) => m.role === 'assistant').slice(-1)[0] || {}).text || ''} />` : null}
      ${first && talked && !a.busy && !s.proposal && a.available && !locked && (asks.length || (first.next && first.next.label)) ? html`<div class="first after" data-first-after>
          ${asks.length ? html`<div class="asks">${asks.map((k) => html`<button class="btn small ask" key=${k.label} data-ask onClick=${() => press(k)}>${k.label}</button>`)}</div>` : null}
          ${first.next && first.next.label ? html`<div class="fnext">${first.next.label}</div>` : null}</div>` : null}
    </div>
    ${a.available ? html`<div class="compose">
      ${monthLine ? html`<div class="problem warning whynot" data-month=${month!.tier}>${monthLine}${month!.tier === 'used_up' ? html` <button class="btn small" onClick=${() => setProvider({ provider: 'demo' })}>Built-in helper</button>` : null}</div>` : null}
      ${!first && !talked ? html`<div class="suggest">${SUGGESTIONS.map((t) => html`<button onClick=${() => send(t)}>${t}</button>`)}</div>` : null}
      <textarea placeholder=${locked ? 'Show mode: switch to Edit to make changes' : 'What should change?'} value=${text} disabled=${locked}
        onInput=${(e: Event) => setText((e.target as HTMLTextAreaElement).value)} onKeyDown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}></textarea>
      <div class="row-flex"><span class="grow"></span><button class="btn primary" disabled=${!text.trim() || a.busy || locked} onClick=${() => send()}>Send</button></div>
    </div>` : html`<div></div>`}
  </div>`;
}

/** A saved version (core/show/versions.ts), newest first. */
interface Version { id: string; at: string; note?: string; author: string; cues: number }
/** A timed backup: its file's name, and the day and time it was taken. */
interface Backup { name: string; day: string; time: string }

export function VersionsDrawer({ s, close, saveVersion, say }: { s: State; close: () => void; saveVersion: (note?: string) => unknown; say: Say }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<{ id: string; other: string | null; from: string; to: string | null; changes: Change[] } | null>(null);       // { id, other, from, to, changes }: `other` is the version it is compared with (null: the show as it is now)
  const load = () => cmd({ op: 'versions' }).then((r) => setVersions((r && r.versions) || []));
  useEffect(() => { load(); }, [s.rev, s.show.dirty, s.show.dir]);
  // a comparison reads from the older to the newer, whichever of the two was clicked (the list is newest first)
  const compare = async (id: string, other: string | null = null) => {
    if (open && open.id === id && open.other === other) { setOpen(null); return; }
    const at = (x: string | null) => versions.findIndex((v) => v.id === x);
    const [from, to] = other && at(other) > at(id) ? [other, id] : [id, other];
    const r = await cmd({ op: 'compare-version', id: from, other: to });
    if (r && r.changes) setOpen({ id, other, from, to, changes: r.changes });
  };
  const restore = async (v: Version) => { const r = await cmd({ op: 'restore-version', id: v.id }); if (r && !r.error) { say(keys(`Back to ${v.id} — ⌘Z undoes it`)); setOpen(null); } };
  // timed backups: copies of the show as it was being worked on, unsaved changes and all
  const [backs, setBacks] = useState<Backup[] | null>(null);       // null: not looked at yet
  const [showBacks, setShowBacks] = useState(false);
  const loadBacks = () => cmd({ op: 'backups' }).then((r) => setBacks((r && r.backups) || []));
  useEffect(() => { if (showBacks) loadBacks(); }, [showBacks, s.rev]);
  const restoreBackup = async (b: Backup) => { const r = await cmd({ op: 'restore-backup', name: b.name }); if (r && !r.error) say(r.restored ? keys(`The show as it was at ${b.time.slice(0, 5)} — ⌘Z undoes it`) : 'That backup is the show as it is now'); };
  const mins = Number((s.doc.settings.backup || {}).minutes) || 0;
  return html`<div class="drawer-pane">
    <div class="drawer-head"><span>Versions</span><span class="grow"></span><button class="btn ghost small icon" onClick=${close}>×</button></div>
    <div class="drawer-body">
      <div class="dim lede">Changes are kept only when you save. Each save is a version.</div>
      ${s.show.untitled ? html`<div class="nothing"><p>Save to a folder to keep versions.</p><button class="btn primary" onClick=${() => saveVersion()}>Save the show…</button></div>` : null}
      ${!s.show.untitled && s.show.dirty ? html`<div class="version cur"><div class="vt"><span class="id">now</span><span class="badge">${s.show.unsaved.length} unsaved</span><span class="grow"></span>
          <button class="btn ghost small" disabled=${s.mode === 'show'} onClick=${() => cmd({ op: 'revert' })} title="Discard every unsaved change">Revert all</button></div>
        <div class="vdiff"><${Changes} changes=${s.show.unsaved} /></div>
        <div class="va"><input type="text" placeholder="Note (optional)" value=${note} onInput=${(e: Event) => setNote((e.target as HTMLInputElement).value)} onKeyDown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { saveVersion(note); setNote(''); } }} />
          <button class="btn standby" onClick=${() => { saveVersion(note); setNote(''); }}>Save</button></div></div>` : null}
      ${versions.map((v, i) => html`<div class=${cx('version', i === 0 && !s.show.dirty && 'cur')} key=${v.id}>
        <div class="vt"><span class="id">${v.id}</span><span class=${cx('badge', v.author === 'assistant' && 'ai')}>${v.author === 'assistant' ? '✦ assistant' : v.author}</span>
          ${i === 0 && !s.show.dirty ? html`<span class="badge">current</span>` : null}<span class="when">${relTime(v.at)}</span></div>
        <div class="note">${v.note || '(no note)'}</div>
        <div class="va"><span class="dim meta">${v.cues} cues</span><span class="grow"></span>
          <button class=${cx('btn small', open && open.id === v.id && !open.other && 'on')} onClick=${() => compare(v.id)}>Compare with now</button>
          ${versions.length > 1 ? html`<select class=${cx('vs', open && open.id === v.id && open.other && 'on')} title="Compare with another version" value=${open && open.id === v.id && open.other ? open.other : ''}
            onChange=${(e: Event) => ((e.target as HTMLSelectElement).value ? compare(v.id, (e.target as HTMLSelectElement).value) : setOpen(null))}>
            <option value="">with…</option>${versions.filter((x) => x.id !== v.id).map((x) => html`<option value=${x.id}>${x.id} · ${(x.note || '(no note)').slice(0, 40)}</option>`)}</select>` : null}
          <button class="btn small" disabled=${(i === 0 && !s.show.dirty) || s.mode === 'show'} onClick=${() => restore(v)}>Restore</button></div>
        ${open && open.id === v.id ? html`<div class="vdiff">
          <div class="dim vfrom">From ${open.from} to ${open.to || 'now'}</div><${Changes} changes=${open.changes} /></div>` : null}
      </div>`)}
      ${!s.show.untitled && !versions.length && !s.show.dirty ? html`<div class="nothing">No versions yet.</div>` : null}
      <div class="backups">
        <button class=${cx('btn ghost small', showBacks && 'on')} onClick=${() => setShowBacks(!showBacks)} title="Copies taken while you work">Backups ${showBacks ? '▾' : '▸'}</button>
        ${showBacks ? html`<div class="dim meta" style="margin:6px 0">${mins > 0 ? `Every ${mins} minute${mins === 1 ? '' : 's'} while the show changes.` : 'Timed backups are off.'} Going back is an undoable edit.</div>
          ${backs && !backs.length ? html`<div class="nothing">No backups yet.</div>` : null}
          ${(backs || []).slice(0, 40).map((b) => html`<div class="backup" key=${b.name}><span class="mono">${b.day} ${b.time.slice(0, 5)}</span><span class="grow"></span>
            <button class="btn small" disabled=${s.mode === 'show'} onClick=${() => restoreBackup(b)}>Go back to this</button></div>`)}
          <div class="row-flex" style="margin-top:6px"><button class="btn small" onClick=${() => cmd({ op: 'backup-now' }).then((r) => { say(r && r.backup ? 'Backed up' : 'Nothing changed since the last backup'); loadBacks(); })}>Back up now</button>
            ${backs && backs.length ? html`<button class="btn ghost small" onClick=${() => window.ec.app({ op: 'backups-reveal' })}>Show the folder</button>` : null}</div>` : null}
      </div>
    </div>
    <div></div>
  </div>`;
}

/** The monitor beside the cue list: what is sent and what arrives, while the show is worked on. */
export function MonitorDrawer({ s, close, openSettings }: { s: State; close: () => void; openSettings: (section: string) => void }) {
  return html`<div class="drawer-pane">
    <div class="drawer-head"><span>Monitor</span><span class="grow"></span><button class="btn ghost small" onClick=${() => openSettings('network')} title="Settings ▸ Integrations ▸ Network">Network settings</button><button class="btn ghost small icon" onClick=${close}>×</button></div>
    <div class="drawer-body" style="padding:10px"><${Monitor} s=${s} tall /></div>
  </div>`;
}
