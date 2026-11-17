// The kinds of sound, in the window: a bus's kind and what it was offered (Settings ▸ Audio), ducking by kind,
// and the chooser that shows what newly added sounds were taken for. What a kind means is core/audio/kinds.ts
// (its table comes in `info.sound`); nothing here holds show state.
import { html, useState, useEffect, useRef, cmd, edit, setCue, cx } from './lib.js';
import type { State, Info, CueIndex } from './lib.js';
import type { Bus, Settings } from '../../core/show/types';
import type { DuckUnder } from '../../core/audio/kinds';
import type { ComponentType } from 'preact';

const set = (path: string, value: unknown, label?: string) => edit([{ op: 'show.set', path, value }], label || path.split('.').pop());

/** One small box that commits on Enter or when it loses the keyboard, and goes back on Esc. */
function Box({ value, onCommit, title, placeholder = '', width = 52, ...rest }: { value: string | number | null | undefined; onCommit: (text: string) => void; title?: string; placeholder?: string; width?: number; [attr: string]: unknown }) {
  const [draft, setDraft] = useState<string | null>(null);
  const typed = useRef<string | null>(null);
  const type = (v: string | null) => { typed.current = v; setDraft(v); };
  const drawn = useRef(false);
  useEffect(() => { if (drawn.current) type(null); drawn.current = true; }, [value]);
  const done = () => { const d = typed.current; type(null); if (d !== null && d !== String(value ?? '')) onCommit(d); };
  return html`<input type="text" class="mono" ...${rest} style=${`width:${width}px`} title=${title} placeholder=${placeholder} value=${draft !== null ? draft : (value ?? '')}
    onInput=${(e: Event) => type((e.target as HTMLInputElement).value)} onBlur=${done}
    onKeyDown=${(e: KeyboardEvent) => { const box = e.target as HTMLInputElement; if (e.key === 'Enter') { e.preventDefault(); done(); box.blur(); } if (e.key === 'Escape') { type(null); box.blur(); e.stopPropagation(); } }} />`;
}
/** How one kind dips under a voice: the show's, or what core/audio/kinds.ts offers. */
type Under = DuckUnder;
/** The kinds of sound (core/audio/kinds.ts, `info.sound`), looked up by a kind's name. */
type SoundTables = Omit<Info['sound'], 'kinds' | 'ducking'> & { kinds: Record<string, { label: string; what: string }>; ducking: Omit<Info['sound']['ducking'], 'under'> & { under: Record<string, Under> } };
const secsOf = (text: string) => { const t = String(text).trim(); if (t === '' || t === 'off') return 0; const n = Number(t.replace(/s$/i, '')); return Number.isFinite(n) ? Math.max(0, Math.min(60, n)) : null; };

/** Settings ▸ Audio: what kind of sound each bus carries, and what that kind was offered (each can be changed). */
export function BusKinds({ s, info }: { s: State; info: Info }) {
  const S: SoundTables = info.sound, buses = s.doc.settings.audio.buses, kinds: Record<string, string> = s.mixer.kinds || {};
  const save = (next: Bus[], label: string) => set('settings.audio.buses', next, label);
  // a kind is a label: choosing one changes nothing about how the bus plays. What is suggested for the kind is
  // switched on only by the button beside it.
  const choose = (i: number, kind: string) => save(buses.map((b, j) => (j === i ? { ...b, kind } : b)), `${buses[i].name}: ${S.kinds[kind].label.toLowerCase()}`);
  const suggest = (i: number, kind: string) => save(buses.map((b, j) => { if (j !== i) return b; const { stopFade, oneAtATime, noDuck, ...rest } = b; return { ...rest, kind, ...S.kindDefaults[kind] }; }), `${buses[i].name}: what is suggested for ${S.kinds[kind].label.toLowerCase()}`);
  const said = (kind: string) => { const d = S.kindDefaults[kind]; return [d.stopFade && `a stop fades over ${d.stopFade} s`, d.oneAtATime && `one at a time, crossfading over ${d.oneAtATime} s`, d.noDuck && 'left alone by cues that duck the others'].filter(Boolean).join('; '); };
  const same = (b: Bus, kind: string) => { const d = S.kindDefaults[kind]; return (b.stopFade || 0) === (d.stopFade || 0) && (b.oneAtATime || 0) === (d.oneAtATime || 0) && !!b.noDuck === !!d.noDuck; };
  const time = (i: number, key: 'stopFade' | 'oneAtATime', text: string, label: string) => { const n = secsOf(text); if (n === null) return; save(buses.map((b, j) => { if (j !== i) return b; const next = { ...b }; if (n > 0) next[key] = n; else delete next[key]; return next; }), label); };
  return html`<div class="setting" style="grid-template-columns:minmax(0,1fr)" data-bus-kinds><div class="txt"><b>What each bus carries</b><span>A kind is only a label. Use suggested sets the rest to suit it.</span></div>
    <div class="tablelike" style="margin-top:8px">
      <div class="tr dim" style="grid-template-columns:minmax(60px,1fr) 112px 104px 112px 84px 112px;font-size:11.5px"><span>Bus</span><span>Kind</span><span>A stop fades over</span><span>One at a time, over</span><span>Never ducked</span><span></span></div>
      ${buses.map((b, i) => { const k = kinds[b.id] || 'effects'; return html`<div class="tr" style="grid-template-columns:minmax(60px,1fr) 112px 104px 112px 84px 112px" key=${b.id} data-bus-kind=${b.id}>
        <span>${b.name}</span>
        <select data-kind=${b.id} style="width:100%" value=${k} title=${S.kinds[k].what} onChange=${(e: Event) => choose(i, (e.target as HTMLSelectElement).value)}>${S.kindOrder.map((x: string) => html`<option key=${x} value=${x}>${S.kinds[x].label}${!b.kind && x === k ? ' (from its name)' : ''}</option>`)}</select>
        <span class="with-unit"><${Box} data-stopfade=${b.id} placeholder="off" value=${(b.stopFade ?? 0) > 0 ? String(b.stopFade) : ''} title="A stopped sound fades out over this. Empty: a cut" onCommit=${(t: string) => time(i, 'stopFade', t, `${b.name} stop fade`)} /><span class="dim">s</span></span>
        <span class="with-unit"><${Box} data-oneatatime=${b.id} placeholder="off" value=${(b.oneAtATime ?? 0) > 0 ? String(b.oneAtATime) : ''} title="A new sound crossfades with the one playing. Empty: they overlap" onCommit=${(t: string) => time(i, 'oneAtATime', t, `${b.name} one at a time`)} /><span class="dim">s</span></span>
        <span title="Not dipped by “Duck others while running”"><button class=${cx('switch', b.noDuck && 'on')} data-noduck=${b.id} onClick=${() => save(buses.map((x, j) => { if (j !== i) return x; const { noDuck, ...rest } = x; return noDuck ? rest : { ...rest, noDuck: true }; }), `${b.name} never ducked`)}></button></span>
        <button class="btn small" data-suggest=${b.id} disabled=${!said(k) || same(b, k)} title=${said(k) ? `${said(k)}` : `Nothing suggested for ${S.kinds[k].label.toLowerCase()}`} onClick=${() => suggest(i, k)}>Use suggested</button></div>`; })}
    </div></div>`;
}

/** Ducking by kind, as the show has it (settings.audio.ducking, cleaned: core/audio/kinds.ts `duckingOf`). */
type DuckingBy = NonNullable<Settings['audio']['ducking']>;

const UNDER = [['music', 'Music'], ['ambience', 'Ambience'], ['effects', 'Effects']];
/** Settings ▸ Audio: ducking. A show with ducking by kind: which kinds dip under voices, each by its own depth and
 *  times. A show from before kinds: its one pair (`Old`, the card it always had), and the offer to change over. */
export function Ducking({ s, info, Old }: { s: State; info: Info; Old: ComponentType<{ s: State }> }) {
  const S: SoundTables = info.sound, a = s.doc.settings.audio, d: DuckingBy | null = s.mixer.duckingBy;
  if (!d) {
    return html`<${Old} s=${s} />
      <div class="setting" data-duck-convert><div class="txt"><b>Ducking by kind</b><span>Music and ambience dip under every voice and live bus.</span></div>
        <div class="ctl"><button class="btn" onClick=${() => cmd({ op: 'ducking-by-kind' })}>Duck by kind instead</button></div></div>`;
  }
  const up = (path: string, v: unknown) => set(`settings.audio.ducking.${path}`, v, 'ducking');
  const names = (kinds: string[]) => a.buses.filter((b) => kinds.includes(((s.mixer.kinds || {}) as Record<string, string>)[b.id])).map((b) => b.name);
  const num = (kind: string, k: keyof Under, text: string, lo: number, hi: number) => { const n = Number(String(text).trim().replace('−', '-')); if (String(text).trim() === '' || !Number.isFinite(n)) return; const cur = d.under[kind] || S.ducking.under[kind] || S.ducking.under.music; set('settings.audio.ducking.under', { ...d.under, [kind]: { ...cur, [k]: Math.max(lo, Math.min(hi, k === 'depth' ? -Math.abs(n) : n)) } }, 'ducking'); };
  const toggleUnder = (kind: string) => { const next: Record<string, Under> = { ...d.under }; if (next[kind]) delete next[kind]; else next[kind] = { ...(S.ducking.under[kind] || S.ducking.under.ambience) }; set('settings.audio.ducking.under', next, 'ducking'); };
  const toggleBy = (kind: string) => up('by', d.by.includes(kind) ? d.by.filter((k: string) => k !== kind) : [...d.by, kind]);
  const keys = names(d.by), ducked: string[] = s.mixer.ducked || [];
  return html`<div class="card" data-ducking><div class="ch"><button class=${cx('switch', d.on && 'on')} data-duck-on onClick=${() => up('on', !d.on)}></button><b>Ducking</b>
      <span class="st">${d.on ? html`<span class=${cx('dot', s.mixer.ducking && 'standby')}></span>${s.mixer.ducking ? `ducking now: ${a.buses.filter((b) => ducked.includes(b.id)).map((b) => b.name).join(', ')}` : keys.length ? 'waiting' : 'no voice or live bus to listen to'}` : 'off'}</span></div>
    <p>The kinds below dip under a voice. A recorded voice is ducked just before it speaks. Faders are untouched.</p>
    <div class="duck-by"><span class="dim">Listen to</span>
      ${[['voice', 'Voice buses'], ['live', 'Live buses']].map(([k, label]) => html`<label class="row-flex" key=${k}><button class=${cx('switch', d.by.includes(k) && 'on')} data-duck-by=${k} onClick=${() => toggleBy(k)}></button><span>${label}${names([k]).length ? ` (${names([k]).join(', ')})` : ' (none in this show)'}</span></label>`)}
      <span class="with-unit" title="A microphone counts as speaking above this"><span class="dim">above</span><${Box} data-duck-threshold value=${String(d.threshold)} onCommit=${(t: string) => { const n = Number(String(t).replace('−', '-')); if (Number.isFinite(n) && String(t).trim() !== '') up('threshold', Math.max(-80, Math.min(0, -Math.abs(n)))); }} /><span class="dim">dB</span></span></div>
    <div class="tablelike duck-under" style="margin-top:10px">
      <div class="tr dim" style="font-size:11.5px"><span></span><span>Under a voice</span><span>Dip by</span><span>Down in</span><span>Wait</span><span>Back in</span><span>Dip</span></div>
      ${UNDER.map(([k, label]) => { const on = !!d.under[k], u: Under = d.under[k] || S.ducking.under[k] || S.ducking.under.ambience; return html`<div class=${cx('tr', !on && 'off')} key=${k} data-duck-under=${k}>
        <button class=${cx('switch', on && 'on')} onClick=${() => toggleUnder(k)}></button>
        <span>${label}${names([k]).length ? html` <span class="dim">(${names([k]).join(', ')})</span>` : html` <span class="dim">(no such bus)</span>`}</span>
        <span class="with-unit"><${Box} data-duck=${`${k}.depth`} width=${44} value=${String(u.depth)} onCommit=${(t: string) => num(k, 'depth', t, -60, 0)} /><span class="dim">dB</span></span>
        <span class="with-unit"><${Box} data-duck=${`${k}.attack`} width=${44} value=${String(u.attack)} onCommit=${(t: string) => num(k, 'attack', t, 0.005, 5)} /><span class="dim">s</span></span>
        <span class="with-unit" title="Quiet this long before it comes back"><${Box} data-duck=${`${k}.hold`} width=${44} value=${String(u.hold)} onCommit=${(t: string) => num(k, 'hold', t, 0, 10)} /><span class="dim">s</span></span>
        <span class="with-unit"><${Box} data-duck=${`${k}.release`} width=${44} value=${String(u.release)} onCommit=${(t: string) => num(k, 'release', t, 0.02, 20)} /><span class="dim">s</span></span>
        <div class="seg" title="The voice band keeps the music’s bass and air">${[['voice', 'voice band'], ['all', 'all']].map(([x, l]) => html`<button key=${x} class=${cx(u.range === x && 'on')} onClick=${() => set('settings.audio.ducking.under', { ...d.under, [k]: { ...u, range: x } }, 'ducking')}>${l}</button>`)}</div></div>`; })}
    </div>
  </div>`;
}

/** A sound just added, and what it was taken for (the host's `added`, core/audio/kinds.ts `guessKind`). */
interface AddedItem { id: string; name: string; kind: string | null; why: string; bus: string; loop: boolean; template: boolean }

/** Several sounds were added at once: what each was taken for, and the bus it was put on, to confirm or change. */
export function AddedChooser({ s, info, byId }: { s: State; info: Info; byId: CueIndex }) {
  const S: SoundTables = info.sound, added = s.added;
  if (!added || !added.items.length) return null;
  const items: AddedItem[] = added.items.filter((it: AddedItem) => byId.has(it.id));
  if (!items.length) return null;
  const buses = s.doc.settings.audio.buses, kinds = s.mixer.kinds || {};
  return html`<div class="added" data-added>
    <div class="added-head"><b>${items.length} sounds added.</b><span class="dim">Guessed by sound: change any that are wrong.</span>
      <span class="grow"></span><button class="btn small primary" data-added-done onClick=${() => cmd({ op: 'added-seen' })}>Done</button></div>
    <div class="added-rows">${items.map((it) => { const cue = byId.get(it.id)!.cue, bus = cue.bus || 'effects'; return html`<div class="added-row" key=${it.id} data-added-row=${it.name}>
      <span class="name" title=${it.name}>${it.name}</span>
      <span class="guess">${it.kind ? html`sounds like <b>${S.kinds[it.kind].label.toLowerCase()}</b> <span class="dim">(${it.why})</span>` : html`<span class="dim">not listened to (${it.why})</span>`}${it.template ? html` <span class="dim">· bus from the template</span>` : it.kind && kinds[it.bus] !== it.kind ? html` <span class="dim">· the show has no ${S.kinds[it.kind].label.toLowerCase()} bus</span>` : null}</span>
      <select data-added-bus=${it.name} value=${bus} onChange=${(e: Event) => setCue(it.id, { bus: (e.target as HTMLSelectElement).value }, 'bus')}>${buses.map((b) => html`<option key=${b.id} value=${b.id}>${b.name}</option>`)}</select>
      <label class="row-flex" title="Loops until stopped"><button class=${cx('switch', cue.loop && 'on')} onClick=${() => setCue(it.id, { loop: !cue.loop }, 'loop')}></button><span class="dim">loop</span></label></div>`; })}</div>
  </div>`;
}
