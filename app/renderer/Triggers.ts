// What starts a cue besides GO, for the whole show: the table of every trigger (Settings ▸ Integrations ▸ Triggers), and the
// timecode card (Settings ▸ Integrations ▸ Network). Both only draw what the host worked out (core/show/triggers.js,
// core/timecode/transport.js).
import { html, edit, cx } from './lib.js';
import type { State } from './lib.js';
import type { TriggerRow } from '../../core/show/triggers';

const set = (path: string, value: unknown, label?: string) => edit([{ op: 'show.set', path, value }], label || path.split('.').pop());
const KIND: Record<string, string> = { hotkey: 'Hotkey', osc: 'OSC', midi: 'MIDI', clock: 'Clock', timecode: 'Timecode' };
const RATES = [['24', '24'], ['25', '25'], ['29.97df', '29.97 drop'], ['30', '30']];

/** Every trigger in the show, by kind, with whatever else each would set off beside its own cue. */
/** A trigger as the host lists it (core/show/triggers.js): the cue it starts, or what it does to the show. */
export type { TriggerRow };

export function TriggersPane({ s }: { s: State }) {
  const rows: TriggerRow[] = s.triggers || [];
  const clashing = rows.filter((r) => r.clash.length).length, bad = rows.filter((r) => r.bad).length;
  const order = Object.keys(KIND);
  const sorted = [...rows].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.text.localeCompare(b.text, undefined, { numeric: true }));
  return html`<h2>Triggers</h2><p class="lede">What starts a cue besides GO. Set on each cue’s Triggers tab.
    ${rows.length ? ` ${rows.length} in all${clashing ? `; ${clashing} shared` : ''}${bad ? `; ${bad} cannot work` : ''}.` : ''}</p>
    ${rows.length ? html`<div class="tablelike trig-table">
      <div class="tr head"><span>Kind</span><span>Trigger</span><span>Starts</span><span>Also sets off</span></div>
      ${sorted.map((r, i) => html`<div class=${cx('tr', (r.clash.length || r.bad) && 'marked')} key=${i} data-trigger=${r.kind}>
        <span class="dim">${KIND[r.kind]}</span>
        <span class="mono">${r.text}</span>
        <span>${r.id ? html`${r.number ? html`<b>${r.number}</b> · ` : ''}${r.name}${(s.doc.lists || []).length > 1 ? html` <span class="dim">(${r.list})</span>` : ''}` : html`<i>${r.what}</i> <span class="dim">(the show)</span>`}</span>
        <span>${r.bad ? html`<span>Cannot work: ${r.bad}</span>` : r.clash.length ? html`<b>${r.clash.join(', ')}</b>` : html`<span class="dim">—</span>`}</span>
      </div>`)}
    </div>` : html`<div class="nothing">No cue has a trigger. Add one on a cue’s Triggers tab.</div>`}
    ${clashing ? html`<p class="dim" style="margin-top:12px">Cues that share a trigger all start.</p>` : null}`;
}

/** Timecode: what is going out (Timecode cues), and incoming timecode the show chases. */
export function TimecodeCard({ s }: { s: State }) {
  const cfg = s.doc.settings.timecode || {}, t = s.timecode || { out: [], in: null, triggers: 0 };
  const src = cfg.source || 'off';
  const running = t.in && t.in.running;
  const up = (k: string, v: unknown) => set(`settings.timecode.${k}`, v, 'timecode');
  return html`<div class="card" data-card="timecode">
    <div class="ch"><b>Timecode</b><span class="st">${src === 'off' ? 'not chasing' : html`<span class=${cx('dot', running && 'go')}></span>${t.in ? html`<span class="mono" data-tc-in>${t.in.text}</span> · ${RATES.find((r) => r[0] === t.in!.rate)![1]} fps · ${running ? 'running' : 'stopped'}` : `waiting for ${src === 'mtc' ? 'MTC on any MIDI input' : 'LTC'}`}`}</span></div>
    <p>Timecode cues send MTC or LTC. When chasing, ${t.triggers ? `${t.triggers} cue${t.triggers === 1 ? '' : 's'} with a Timecode trigger start` : 'cues with a Timecode trigger start'} as their time passes.${t.out.length ? html` Going out now: ${t.out.filter((o) => o.text).map((o) => html`<span class="mono">${o.text}</span> ${o.kind === 'ltc' ? 'LTC' : 'MTC'}${o.paused ? ', held' : ''} `)}` : ''}</p>
    <div class="cfg">
      <div title="MTC: any MIDI input. LTC: an audio input"><label>Chase</label><div class="seg">${[['off', 'Off'], ['mtc', 'MTC'], ['ltc', 'LTC']].map(([v, l]) => html`<button class=${cx(src === v && 'on')} data-chase=${v} onClick=${() => up('source', v)}>${l}</button>`)}</div></div>
      <div><label>Triggers are written at</label><select value=${cfg.rate || '30'} onChange=${(e: Event) => up('rate', (e.target as HTMLSelectElement).value)}>${RATES.map(([v, l]) => html`<option value=${v}>${l} fps</option>`)}</select></div>
      ${src === 'ltc' ? html`<div><label>LTC input</label><select value=${cfg.input || ''} onChange=${(e: Event) => up('input', (e.target as HTMLSelectElement).value)}>
          <option value="">This computer’s default input</option>${cfg.input && !(s.mixer.inputs || []).includes(cfg.input) ? html`<option value=${cfg.input}>${cfg.input} (not connected)</option>` : null}${(s.mixer.inputs || []).map((n) => html`<option value=${n}>${n}</option>`)}</select></div>
        <div><label>Input channel</label><select value=${Number(cfg.channel) || 1} onChange=${(e: Event) => up('channel', Number((e.target as HTMLSelectElement).value))}>${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => html`<option value=${n}>${n}</option>`)}</select></div>` : null}
      ${src !== 'off' ? html`<div title="Timecode arriving mid-cue starts that cue part way in"><label>Start part way in</label><button class=${cx('switch', cfg.catchUp !== false && 'on')} onClick=${() => up('catchUp', cfg.catchUp === false)}></button></div>
        <div title="It stands on the next cue timecode will start"><label>Playhead follows</label><button class=${cx('switch', cfg.follow !== false && 'on')} onClick=${() => up('follow', cfg.follow === false)}></button></div>` : null}
    </div>
    ${t.ltcInError && src === 'ltc' ? html`<div class="problem" style="margin-top:10px">LTC cannot be heard: ${t.ltcInError}.</div>` : null}
  </div>`;
}
