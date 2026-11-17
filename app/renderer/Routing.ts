// Where sound goes, in the window: a cue's own outputs as a small matrix and its eq (the inspector), and the
// device's outputs, the audition pair and the effects (Settings ▸ Audio). What the fields mean is in
// core/audio/routing.js; nothing here holds show state.
import { html, useState, useEffect, useRef, edit, cx } from './lib.js';
import type { State } from './lib.js';
import type { Eq, Matrix } from '../../core/show/types';

const set = (path: string, value: unknown, label?: string) => edit([{ op: 'show.set', path, value }], label || path.split('.').pop());

/** A level typed into a small box: "6" and "-6" are both −6 dB (a level typed with no sign is a cut, as everywhere
 *  in the app), "+3" is a boost, "0" is unity; empty, "off" or "-inf" is nothing. null: not a level. */
function typedDb(text: string | number) {
  const t = String(text).trim().toLowerCase().replace('−', '-').replace(/db$/, '').trim();
  if (t === '' || t === 'off' || t === '-inf' || t === 'inf' || t === '-∞') return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n > 0 && !t.startsWith('+') ? -n : n;
}

/** One small box that commits on Enter or when it loses the keyboard, and goes back on Esc. */
function Cell({ value, onCommit, title, placeholder = '', width = 40, ...rest }: { value: string | number | null | undefined; onCommit: (text: string) => void; title?: string; placeholder?: string; width?: number; [attr: string]: unknown }) {
  const [draft, setDraft] = useState<string | null>(null);
  const typed = useRef<string | null>(null);            // what has been typed, whether or not the box has been drawn again since
  const type = (v: string | null) => { typed.current = v; setDraft(v); };
  // a new value from the show drops what was typed. (Not as the box is first drawn: that effect runs a frame late,
  // and would throw away what had been typed into the box in the meantime.)
  const drawn = useRef(false);
  useEffect(() => { if (drawn.current) type(null); drawn.current = true; }, [value]);
  const done = () => { const d = typed.current; type(null); if (d !== null && d !== String(value ?? '')) onCommit(d); };
  return html`<input type="text" class="mono" ...${rest} style=${`width:${width}px`} title=${title} placeholder=${placeholder} value=${draft !== null ? draft : (value ?? '')}
    onInput=${(e: Event) => type((e.target as HTMLInputElement).value)} onBlur=${done}
    onKeyDown=${(e: KeyboardEvent) => { const box = e.target as HTMLInputElement; if (e.key === 'Enter') { e.preventDefault(); done(); box.blur(); } if (e.key === 'Escape') { type(null); box.blur(); e.stopPropagation(); } }} />`;
}

/** The outputs' names and trims (settings.audio.outs), by output number. */
type Out = { name?: string; trim?: number };
/** A cue's own outputs: one { output: dB } per channel of its sound (core/audio/routing.js `cleanMatrix`). */
type MatrixValue = Matrix;
type Outs = Record<number, Out>;
type FxKind = 'reverb' | 'delay';
/** One effect's settings (settings.audio.fx.reverb or .delay). */
type FxSettings = { secs?: number; feedback?: number; db?: number; out?: number };
type FxFull = { secs: number; feedback?: number; db: number; out: number };
type Fx = Partial<Record<FxKind, FxSettings>>;

const nameOf = (audio: State['doc']['settings']['audio'], n: number) => { const o = (audio.outs || {})[n]; return o && o.name ? o.name : ''; };

/**
 * A cue's own outputs: a row per channel of its sound, a column per output of the device, a level in dB where
 * the channel goes there. Empty everywhere: the cue plays on its bus's pair.
 */
export function Matrix({ value, channels, s, mixed, onCommit }: { value: MatrixValue | null | undefined; channels?: number; s: State; mixed?: boolean; onCommit: (value: MatrixValue | null) => void }) {
  const audio = s.doc.settings.audio, have = s.mixer.outputs || 2;
  const rows: MatrixValue = Array.isArray(value) ? value : [];
  const top = Math.max(0, ...rows.flatMap((r) => Object.keys(r || {}).map(Number)));
  const cols = Math.min(64, Math.max(2, have, top));
  const n = Math.max(1, channels || 2, rows.length);
  const there = (o: number) => o <= Math.max(2, have - (have % 2));
  const put = (r: number, o: number, text: string) => {
    const db = typedDb(text);
    if (db === null) return;
    const next: MatrixValue = Array.from({ length: n }, (_, i) => ({ ...(rows[i] || {}) }));
    if (db === undefined || db <= -60) delete next[r][o]; else next[r][o] = Math.min(12, Math.round(db * 10) / 10);
    while (next.length && !Object.keys(next[next.length - 1]).length) next.pop();
    onCommit(next.length ? next : null);
  };
  // the plain sends: each channel to the next output from a first one (one channel: to both of the pair)
  const straight = (first: number): MatrixValue => (n === 1 ? [{ [first]: 0, [first + 1]: 0 }] : Array.from({ length: n }, (_, i) => ({ [first + i]: 0 })));
  const firsts: number[] = []; for (let o = 1; o + Math.max(2, n) - 1 <= cols; o += 2) firsts.push(o);
  const routed = rows.some((r) => Object.keys(r || {}).length);
  const gone = [...new Set(rows.flatMap((r) => Object.keys(r || {}).map(Number)))].filter((o) => !there(o)).sort((a, b) => a - b);
  return html`<div class="matrix-wrap">
    <div class="row-flex" style="gap:6px;flex-wrap:wrap;margin-bottom:6px">
      <button class=${cx('btn small', !routed && !mixed && 'on')} title="Play on its bus’s pair" onClick=${() => onCommit(null)}>On its bus</button>
      <select style="width:150px" value="" title="Each channel to its own output" onChange=${(e: Event) => { const box = e.target as HTMLSelectElement; if (box.value) onCommit(straight(Number(box.value))); box.value = ''; }}>
        <option value="">Send it to outputs…</option>
        ${firsts.map((o) => html`<option value=${o}>${n <= 2 ? `${o}–${o + 1}` : `${o}–${o + n - 1}`}${there(o + Math.max(2, n) - 1) ? '' : ' (not on this device)'}</option>`)}</select>
      <span class="dim" style="font-size:11.5px">${mixed ? 'The selected cues differ.' : routed ? 'A level in dB; empty: not sent. Its bus still moves it.' : `On its bus’s pair${n > 2 ? `, its ${n} channels folded to two` : ''}.`}</span>
    </div>
    <div class="matrix-scroll"><table class="matrix"><thead><tr><th></th>${Array.from({ length: cols }, (_, i) => html`<th class=${cx(!there(i + 1) && 'gone')} title=${there(i + 1) ? nameOf(audio, i + 1) || `Output ${i + 1}` : `Output ${i + 1} is not on this device`}>${nameOf(audio, i + 1) || i + 1}</th>`)}</tr></thead>
      <tbody>${Array.from({ length: n }, (_, r) => html`<tr><th title="A channel of the sound">${n === 1 ? 'in' : `ch ${r + 1}`}</th>
        ${Array.from({ length: cols }, (_, i) => { const v = (rows[r] || {})[i + 1]; return html`<td class=${cx(v !== undefined && 'on', v !== undefined && !there(i + 1) && 'gone')}><${Cell} data-cell=${`${r + 1}:${i + 1}`} value=${v === undefined ? '' : String(v)} title=${`Channel ${r + 1} to output ${i + 1}, dB`} onCommit=${(t: string) => put(r, i + 1, t)} /></td>`; })}</tr>`)}</tbody></table></div>
    ${gone.length ? html`<div class="problem warning" style="margin-top:6px">Output${gone.length === 1 ? '' : 's'} ${gone.join(', ')} ${gone.length === 1 ? 'is' : 'are'} not on this device: silent.</div>` : null}
  </div>`;
}

/** A cue's eq: three bands in dB on that one sound. */
export function EqBands({ value, onCommit }: { value: Eq | null | undefined; onCommit: (value: Eq | null) => void }) {
  const eq: Eq = value && typeof value === 'object' ? value : {};
  const put = (k: keyof Eq, text: string) => {
    const t = String(text).trim().replace('−', '-');
    const n = t === '' ? 0 : Number(t);
    if (!Number.isFinite(n)) return;
    const next: Eq = { ...eq };
    if (n === 0) delete next[k]; else next[k] = Math.max(-40, Math.min(6, n));
    onCommit(Object.keys(next).length ? next : null);
  };
  return html`<div class="row-flex" style="gap:10px;flex-wrap:wrap">${([['low', 'Low', '250 Hz shelf'], ['mid', 'Mid', '1 kHz'], ['high', 'High', '4 kHz shelf']] as const).map(([k, label, what]) => html`<span class="with-unit" title=${`${what}: −40 to +6 dB`}>
      <span class="unit">${label}</span><${Cell} data-eq=${k} width=${46} placeholder="0" value=${eq[k] === undefined ? '' : String(eq[k])} onCommit=${(t: string) => put(k, t)} /><span class="unit">dB</span></span>`)}
    <span class="dim" style="font-size:11.5px">From the next time it plays.</span></div>`;
}

/** A small level bar for one output (its peak, before the master). */
const Level = ({ dbv }: { dbv: number | undefined }) => html`<span class="outlevel"><i style=${`width:${Math.max(0, Math.min(100, ((Number(dbv) || -60) + 60) / 60 * 100))}%`}></i></span>`;

/** Settings ▸ Audio: the device's outputs (a name and a trim each), and where V auditions to. */
export function OutputsSettings({ s }: { s: State }) {
  const a = s.doc.settings.audio, m = s.mixer, r = s.routing || { outCh: [], lost: [] };
  const outs: Outs = a.outs || {};
  const top = Math.max(0, ...Object.keys(outs).map(Number).filter((n) => outs[n] && (outs[n].name || outs[n].trim)));
  const count = Math.min(64, Math.max(2, m.outputs || 2, top));
  const there = (o: number) => o <= Math.max(2, m.outputs - (m.outputs % 2));
  const put = (n: number, change: Out) => {
    const next: Out = { ...(outs[n] || {}), ...change };
    if (!next.name) delete next.name;
    if (!((next.trim ?? 0) < 0)) delete next.trim;
    const all = { ...outs };
    if (Object.keys(next).length) all[n] = next; else delete all[n];
    set('settings.audio.outs', Object.keys(all).length ? all : undefined, `output ${n}`);
  };
  const trim = (n: number, text: string) => { const v = typedDb(text); if (v === null) return; put(n, { trim: v === undefined ? 0 : Math.max(-60, Math.min(0, v)) }); };
  const pairs: number[] = []; for (let o = 1; o + 1 <= Math.max(count, (a.auditionOut || 0) + 1); o += 2) pairs.push(o);
  const label = (o: number) => `Outputs ${o}–${o + 1}${outs[o] && outs[o].name ? ` (${outs[o].name}${outs[o + 1] && outs[o + 1].name ? `, ${outs[o + 1].name}` : ''})` : ''}`;
  return html`
    ${(r.lost || []).map((w: string) => html`<div class="problem" style="margin-bottom:10px">${w}.</div>`)}
    <div class="setting"><div class="txt"><b>Audition (V) plays to</b><span>On its own pair, V plays the cue there only.</span></div>
      <div class="ctl"><select data-audition value=${a.auditionOut || 0} onChange=${(e: Event) => { const v = Number((e.target as HTMLSelectElement).value); set('settings.audio.auditionOut', v > 0 ? v : undefined, 'audition output'); }}>
        <option value="0">The house</option>${pairs.map((o) => html`<option value=${o}>${label(o)}${there(o + 1) ? '' : ' (not on this device)'}</option>`)}</select></div></div>
    <div class="setting" style="grid-template-columns:1fr"><div class="txt"><b>Outputs</b><span>A name for each, and a trim that only turns it down.</span></div>
      <div class="tablelike outputs" style="margin-top:8px">
        ${Array.from({ length: count }, (_, i) => i + 1).map((n) => html`<div class="tr" data-output=${n} style="grid-template-columns:28px 1fr 96px 90px" key=${n}>
          <span class=${cx('mono', !there(n) && 'dim')} title=${there(n) ? '' : 'Not on this device'}>${n}</span>
          <${Cell} width=${180} placeholder=${there(n) ? `Output ${n}` : `Output ${n}, not on this device`} value=${(outs[n] || {}).name || ''} onCommit=${(t: string) => put(n, { name: t.trim().slice(0, 40) })} />
          <span class="with-unit"><${Cell} width=${50} placeholder="0" value=${((outs[n] || {}).trim ?? 0) < 0 ? String(outs[n].trim) : ''} title="Trim, 0 down to −60 dB" onCommit=${(t: string) => trim(n, t)} /><span class="dim">dB</span></span>
          <${Level} dbv=${(r.outCh || [])[n - 1]} /></div>`)}
      </div></div>`;
}

/** Settings ▸ Audio: the reverb and the delay, each with the buses' sends to it. */
export function EffectsSettings({ s }: { s: State }) {
  const a = s.doc.settings.audio, m = s.mixer, fx: Fx = a.fx || {};
  const DEF: Record<FxKind, FxFull> = { reverb: { secs: 1.8, db: -6, out: 1 }, delay: { secs: 0.35, feedback: 0.35, db: -6, out: 1 } };
  const count = Math.max(2, m.outputs || 2);
  const card = (kind: FxKind, title: string, what: string, knobs: [key: keyof FxSettings, label: string, unit: string, lo: number, hi: number][]) => {
    const c: FxFull = { ...DEF[kind], ...(fx[kind] || {}) };
    const sending = a.buses.some((b) => b[kind] != null);
    const up = (k: keyof FxSettings, v: number) => set(`settings.audio.fx.${kind}.${k}`, v, title.toLowerCase());
    const num = (k: keyof FxSettings, lo: number, hi: number) => (t: string) => { const n = Number(String(t).trim().replace('−', '-')); if (Number.isFinite(n) && String(t).trim() !== '') up(k, Math.max(lo, Math.min(hi, n))); };
    const pairs: number[] = []; for (let o = 1; o + 1 <= Math.max(count, c.out + 1); o += 2) pairs.push(o);
    return html`<div class="card" data-fx=${kind}><div class="ch"><b>${title}</b><span class="st">${sending ? `fed by ${a.buses.filter((b) => b[kind] != null).map((b) => b.name).join(', ')}` : 'not in use'}</span></div>
      <p>${what}</p>
      <div class="cfg">
        ${knobs.map(([k, label, unit, lo, hi]) => html`<div><label>${label}</label><span class="with-unit"><${Cell} width=${54} value=${String(c[k])} onCommit=${num(k, lo, hi)} /><span class="dim">${unit}</span></span></div>`)}
        <div><label>Comes back on</label><select value=${c.out} onChange=${(e: Event) => up('out', Number((e.target as HTMLSelectElement).value))}>${pairs.map((o) => html`<option value=${o}>Outputs ${o}–${o + 1}${o + 1 > m.outputs && o > 1 ? ' (not on this device)' : ''}</option>`)}</select></div>
        ${a.buses.map((b, i) => html`<div title="dB, after the fader. Empty: none"><label>Send from ${b.name}</label><span class="with-unit"><${Cell} data-send=${`${kind}:${b.id}`} width=${54} placeholder="none" value=${b[kind] == null ? '' : String(b[kind])}
          onCommit=${(t: string) => { const v = typedDb(t); if (v === null) return; set(`settings.audio.buses.${i}.${kind}`, v === undefined ? undefined : Math.max(-59.9, Math.min(6, v)), `${b.name} ${kind} send`); }} /><span class="dim">dB</span></span></div>`)}
      </div></div>`;
  };
  return html`
    ${card('reverb', 'Reverb', 'One room for the show. Buses send to it.', [['secs', 'Rings for', 's', 0.1, 10], ['db', 'Return level', 'dB', -60, 6]])}
    ${card('delay', 'Delay', 'One echo for the show. Buses send to it.', [['secs', 'Repeats every', 's', 0.01, 4], ['feedback', 'Feedback (0–0.9)', '', 0, 0.9], ['db', 'Return level', 'dB', -60, 6]])}`;
}
