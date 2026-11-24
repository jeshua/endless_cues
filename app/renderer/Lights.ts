// Lights: the dashboard beside the cue list (what every light is at, a hand on them, and recording what is live
// into a cue), and Settings ▸ Integrations ▸ Light (where DMX goes, the patch, groups, the show's own fixtures).
//
// Colour here means what it means everywhere: green is "sending", yellow is a level a hand has changed and no cue
// holds yet, red is the blackout. An instrument's colour swatch is the light's own colour: data, not chrome.
import { html, useState, cmd, edit, cx, keys } from './lib.js';
import { TextBox } from './Inspector.js';
import type { State, CueIndex } from './lib.js';
import type { LightUniverse, LightInstrument, LightGroup } from '../../core/light/patch';
import { KINDS as USB_KINDS, kindOf as usbKindOf } from '../../core/light/usb.js';

/** The lights as the host has them now (core/light/lighting.ts `snapshot`). */
type LightState = State['light'];
/** An instrument as the dashboard shows it: its level, its parameters and where it is patched. */
type Instrument = LightState['instruments'][number];
type Typed = Event & { target: HTMLInputElement };

const set = (path: string, value: unknown, label?: string) => edit([{ op: 'show.set', path: `settings.light.${path}`, value }], label || path);
const span = (i: { address: number; footprint: number }) => (i.address ? (i.footprint > 1 ? `${i.address}–${i.address + i.footprint - 1}` : String(i.address)) : '');

/** One level: a slider, and the number beside it (typed, or dragged). A level a hand has moved is marked until it is recorded. */
function Level({ value, manual, onSet, title }: { value: number; manual?: boolean; onSet: (v: number) => void; title?: string }) {
  return html`<div class=${cx('lx-level', manual && 'manual')} title=${title || ''}>
    <div class="lx-track"><i style=${`width:${Math.max(0, Math.min(100, value))}%`}></i>
      <input type="range" min="0" max="100" step="1" value=${value} onInput=${(e: Typed) => onSet(Number(e.target.value))} onDblClick=${() => onSet(value >= 100 ? 0 : 100)} /></div>
    <${TextBox} mono style="width:46px" value=${String(value)} onCommit=${(v: string) => { const n = Number(v); if (Number.isFinite(n)) onSet(n); }} />
  </div>`;
}

function InstrumentRow({ i, secs, numberOf }: { i: Instrument; secs: number; numberOf: (id: string) => string }) {
  const [open, setOpen] = useState(false);
  const level = (param: string, value: number) => cmd({ op: 'light-level', name: i.name, param, value, secs });
  const others = i.params.filter((p) => p.key !== i.default);
  const main = i.params.find((p) => p.key === i.default);
  const from = main && main.cue ? numberOf(main.cue) : '';
  return html`<div class=${cx('lx-row', !i.patched && 'unpatched')} data-light=${i.name}>
    <div class="lx-name" title=${`${i.fixtureName}${i.patched ? ` · universe ${i.universe}, ${i.footprint > 1 ? 'channels' : 'channel'} ${span(i)}` : ' · not patched'}${from ? ` · set by cue ${from}` : ''}`}>
      ${others.length ? html`<button class="lx-fold" onClick=${() => setOpen(!open)} title="More parameters">${open ? '▾' : '▸'}</button>` : html`<span class="lx-fold"></span>`}
      ${i.colour ? html`<span class="lx-swatch" style=${`background:${i.colour}`}></span>` : null}
      <span class="nm">${i.name}</span>
    </div>
    <${Level} value=${i.level} manual=${main && main.manual} onSet=${(v: number) => level(i.default, v)} />
    ${open ? html`<div class="lx-params">
      ${i.colour ? html`<div class="lx-param"><span class="nm">colour</span><input type="color" value=${i.colour} onInput=${(e: Typed) => cmd({ op: 'light-set', text: `${i.name}.colour = ${e.target.value}`, secs })} /><span class="dim mono">${i.colour}</span></div>` : null}
      ${others.map((p) => html`<div class="lx-param" key=${p.key}><span class="nm">${p.key}</span><${Level} value=${p.value} manual=${p.manual} onSet=${(v: number) => level(p.key, v)} /></div>`)}
    </div>` : null}
  </div>`;
}

/** The dashboard: a drawer, so the cue list stays where it is and what is selected there is what Update writes to. */
export function LightsDrawer({ s, sel, byId, close, openSettings, say }: {
  s: State; sel: string[]; byId: CueIndex; close: () => void; openSettings: (section: string) => void; say: (text: string, bad?: boolean) => void;
}) {
  const l = s.light;
  const [text, setText] = useState('');
  const [over, setOver] = useState('');
  const secs = Math.max(0, Number(over) || 0);
  const numberOf = (id: string) => { const c = byId.get(id); return c ? (c.cue.number || s.labels[id] || '') : ''; };
  const picked = sel.length === 1 && byId.get(sel[0]) && byId.get(sel[0])!.cue.type === 'light' ? byId.get(sel[0])!.cue : null;
  const run = async () => { if (!text.trim()) return; const r = await cmd({ op: 'light-set', text, secs }); if (r && !r.error) setText(''); };
  const record = async (mode: 'changes' | 'all', id?: string) => {
    const r = await cmd({ op: 'light-record', mode, ...(id ? { id } : { after: sel.at(-1) || undefined }) });
    if (r && r.ok) say(id ? `Updated ${numberOf(id) || 'the cue'} with ${r.count} level${r.count === 1 ? '' : 's'}` : `Recorded ${r.count} level${r.count === 1 ? '' : 's'} into a new Light cue`);
  };
  const sending = l.on && l.universes.length > 0 && l.instruments.length > 0;
  const bad = l.universes.find((u) => u.error);
  const status = !l.instruments.length ? 'no instruments' : !l.universes.length ? 'no universe set up' : !l.on ? 'output off'
    : l.dryRun ? 'test run: nothing is sent' : l.held ? 'held back: nothing is sent' : bad ? `universe ${bad.id}: ${bad.error}` : `sending ${l.universes.length} universe${l.universes.length === 1 ? '' : 's'}`;
  return html`<div class="drawer-pane lights">
    <div class="drawer-head"><span>Lights</span>
      <button class=${cx('chip', bad && 'bad')} onClick=${() => openSettings('light')} title="Light settings"><span class=${cx('dot', bad ? 'danger' : sending && !l.dryRun && !l.held ? 'go' : '')}></span>${status}</button>
      <span class="grow"></span><button class="btn ghost small" onClick=${() => openSettings('light')}>Patch</button><button class="btn ghost small icon" onClick=${close}>×</button></div>
    <div class="drawer-body">
      ${!l.instruments.length ? html`<div class="nothing">No lights patched.<br/><br/><button class="btn primary" onClick=${() => openSettings('light')}>Patch lights…</button></div>` : html`
      <div class="row-flex">
        <input type="text" class="mono grow" data-light-command placeholder="front = 80" value=${text} onInput=${(e: Typed) => setText(e.target.value)}
          onKeyDown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); run(); } }} title="A light command, as a Light cue holds. Enter runs it" />
        <span class="dim">over</span><input type="text" class="mono" style="width:44px" placeholder="0" value=${over} onInput=${(e: Typed) => setOver(e.target.value)} title="Fade time" /><span class="dim">s</span>
      </div>
      <div class="row-flex lx-actions">
        <button class=${cx('btn small', l.blackout ? 'lx-blackout on' : 'danger')} data-light-blackout onClick=${() => cmd({ op: 'light-blackout' })} title="Intensities out; the levels come back when it is off">${l.blackout ? 'BLACKOUT · on' : 'Blackout'}</button>
        <button class="btn small" onClick=${() => cmd({ op: 'light-clear', secs })} title="Everything home, as if no cue had run">Clear</button>
        <span class="grow"></span>
        ${l.changed ? html`<button class="btn small standby" onClick=${() => cmd({ op: 'light-revert', secs })} title="Back to what the cues set">Revert ${l.changed}</button>` : null}
      </div>
      <div class="row-flex lx-actions">
        <button class="btn small" data-light-record="changes" disabled=${!l.changed} onClick=${() => record('changes')} title="Only what you changed; the rest tracks through">New cue: changes</button>
        <button class="btn small" data-light-record="all" onClick=${() => record('all')} title="Every level, marked Full state">New cue: everything</button>
        <button class="btn small" data-light-update disabled=${!picked || !l.changed} onClick=${() => record('changes', picked!.id)} title=${picked ? 'Write your changes into this cue' : 'Select one Light cue'}>Update ${picked ? (picked.number || 'selected') : 'selected'}</button>
      </div>
      ${l.groups.length ? html`<div class="lx-section">Groups</div>${l.groups.map((g) => html`<div class="lx-row" key=${g.name} data-light=${g.name} title=${g.members.join(', ')}>
        <div class="lx-name"><span class="lx-fold"></span><span class="nm">${g.name}</span>${g.mixed ? html`<span class="dim" title="Members differ: this is the highest">≠</span>` : null}</div>
        <${Level} value=${g.level} manual=${g.manual} onSet=${(v: number) => cmd({ op: 'light-level', name: g.name, value: v, secs })} /></div>`)}` : null}
      <div class="lx-section">Instruments</div>
      ${l.instruments.map((i) => html`<${InstrumentRow} key=${i.key} i=${i} secs=${secs} numberOf=${numberOf} />`)}
      ${l.problems.length ? html`<div class="problem warning" onClick=${() => openSettings('light')}>${l.problems.length} patch problem${l.problems.length === 1 ? '' : 's'}: ${l.problems[0].where} ${l.problems[0].why}${l.problems.length > 1 ? ' …' : ''}</div>` : null}`}
    </div>
  </div>`;
}

const Switch = ({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) => html`<button class=${cx('switch', on && 'on')} onClick=${() => onChange(!on)}></button>`;

/** Settings ▸ Integrations ▸ Light. */
export function LightPane({ s }: { s: State }) {
  const cfg = s.doc.settings.light || {}, l = s.light;
  const universes = cfg.universes || [], instruments = cfg.instruments || [], groups = cfg.groups || [], own = cfg.fixtures || [];
  const [count, setCount] = useState('1');
  const [draft, setDraft] = useState<{ id?: string; name?: string; text: string; why: string } | null>(null);           // a fixture being written: { id, name, text, why }
  const live = (name: string): Instrument | { patched?: undefined } => l.instruments.find((x) => x.name === name) || {};
  const footprint = (fixture: string) => (l.fixtures.find((f) => f.id === fixture) || { footprint: 1 }).footprint;

  const updU = (i: number, change: Partial<LightUniverse>) => set('universes', universes.map((x, j) => (j === i ? { ...x, ...change } : x)), 'universe');
  const addU = () => { let id = 1; while (universes.some((u) => Number(u.id) === id)) id++; set('universes', [...universes, { id, protocol: 'artnet', address: Math.max(0, id - 1), host: '' }], 'add universe'); };
  const updI = (i: number, change: Partial<LightInstrument>) => set('instruments', instruments.map((x, j) => (j === i ? { ...x, ...change } : x)), 'instrument');
  const addI = (fixture: string) => {
    const n = Math.max(1, Math.min(64, Math.round(Number(count)) || 1)), fp = footprint(fixture);
    const universe = universes.length ? Number(universes[0].id) : 0;
    // the next free channels in the first universe, one after another (auto-patch)
    const used = new Array(514).fill(false);
    for (const x of l.instruments) if (x.patched && x.universe === universe) for (let c = x.address; c < x.address + x.footprint; c++) used[c] = true;
    const next = [...instruments];
    let num = 1, at = 1;
    for (let k = 0; k < n; k++) {
      while (next.some((x) => String(x.name).toLowerCase() === String(num))) num++;
      let address = 0;
      for (; universe && at + fp - 1 <= 512; at++) { let free = true; for (let c = at; c < at + fp; c++) if (used[c]) free = false; if (free) { address = at; for (let c = at; c < at + fp; c++) used[c] = true; break; } }
      next.push({ name: String(num), fixture, universe: address ? universe : 0, address });
    }
    set('instruments', next, n > 1 ? `add ${n} instruments` : 'add instrument');
  };
  const updG = (i: number, change: Partial<LightGroup>) => set('groups', groups.map((x, j) => (j === i ? { ...x, ...change } : x)), 'light group');
  const saveFixture = async () => {
    const r = await cmd({ op: 'light-fixture', id: draft!.id || '', name: draft!.name, text: draft!.text });
    if (r && r.error) setDraft({ ...draft!, why: r.error }); else setDraft(null);
  };

  return html`<h2>Light</h2><p class="lede">DMX over Art-Net, sACN or a USB interface, played by Light cues. Works beside a lighting desk.</p>
    <div class="problem warning" style="margin-bottom:12px">Public alpha: no fixture has ever been lit by this. Try it on your rig before a show depends on it.</div>

    <div class="card">
      <div class="ch"><b>Output</b><span class="st"><span class=${cx('dot', l.sending && !l.dryRun && !l.held ? 'go' : '')}></span>${l.dryRun && l.on ? 'test run: nothing is sent' : l.held && l.on ? 'held back: nothing is sent' : l.sending ? `sending, ${l.rate} times a second` : cfg.on ? 'on, with nothing to send yet' : 'off'}</span></div>
      <div class="cfg">
        <div title="Off: levels are kept; nothing is sent"><label>Send DMX</label><${Switch} on=${!!cfg.on} onChange=${(on: boolean) => set('on', on, on ? 'DMX on' : 'DMX off')} /></div>
        <div title="Off: Esc holds the lights. On: Esc fades them home too"><label>Esc also takes the lights out</label><${Switch} on=${!!cfg.panicBlackout} onChange=${(on: boolean) => set('panicBlackout', on, 'panic and lights')} /></div>
      </div>
      ${universes.map((u, i) => { const st: Partial<LightState['universes'][number]> = l.universes.find((x) => x.id === Number(u.id)) || {}; return html`<div class="patch" key=${i}>
        <div class="row-flex">
          <span class=${cx('dot', st.error ? 'danger' : l.sending && !l.dryRun ? 'go' : '')}></span><b style="width:92px">Universe ${u.id}</b>
          <div class="seg">${([['artnet', 'Art-Net'], ['sacn', 'sACN'], ['usb', 'USB']] as const).map(([x, label]) => html`<button data-light-protocol=${x} class=${cx((u.protocol || 'artnet') === x && 'on')} onClick=${() => updU(i, { protocol: x, address: x === 'sacn' ? Math.max(1, Number(u.address) || 1) : Number(u.address) || 0 })}>${label}</button>`)}</div>
          <span class="grow dim" style="font-size:11.5px;text-align:right">${st.error || (st.packets ? `${st.to || ''}` : '')}</span>
          <button class="btn ghost small icon" title="Remove this universe" onClick=${() => set('universes', universes.filter((_, j) => j !== i), 'remove universe')}>×</button>
        </div>
        ${u.protocol === 'usb' ? html`<div class="pgrid">
          <div style="grid-column: span 2" title="A Pro makes the DMX signal itself. An Open DMX cable is fed by this computer: slower, and less steady"><label>Interface</label><select data-light-usb-kind value=${usbKindOf(u.device)} onChange=${(e: Typed) => updU(i, { device: usbKindOf(e.target.value) })}>${USB_KINDS.map((k) => html`<option value=${k.id}>${k.name}</option>`)}</select></div>
          <div style="grid-column: span 2" title="Empty: the first interface found. Or a port’s name (ttyUSB0, COM3, cu.usbserial-…)"><label>Port</label><${TextBox} mono value=${u.port || ''} placeholder="the first one found" onCommit=${(v: string) => updU(i, { port: v.trim() })} /></div>
        </div>` : html`<div class="pgrid">
          <div title=${u.protocol === 'sacn' ? '1 to 63999' : '0 to 32767; the first is 0'}><label>${u.protocol === 'sacn' ? 'sACN universe' : 'Art-Net universe'}</label><${TextBox} mono value=${u.address} onCommit=${(v: string) => { const x = Math.round(Number(v)); if (Number.isFinite(x)) updU(i, { address: x }); }} /></div>
          <div style="grid-column: span 3" title=${u.protocol === 'sacn' ? 'Empty: multicast. An address: that receiver only' : 'Empty: broadcast. An address: that node only'}><label>Send to</label><${TextBox} mono value=${u.host || ''} placeholder=${u.protocol === 'sacn' ? 'multicast' : 'broadcast'} onCommit=${(v: string) => updU(i, { host: v.trim() })} /></div>
        </div>`}
      </div>`; })}
      <div class="row-flex" style="margin-top:10px"><button class="btn small" data-light-add-universe onClick=${addU}>Add a universe</button>
        ${l.nodes.length ? html`<span class="dim" style="font-size:11.5px">Art-Net nodes answering: ${l.nodes.map((n) => `${n.name} (${n.ip})`).join(', ')}</span>` : l.outputError ? html`<span class="dim" style="font-size:11.5px">${l.outputError}</span>` : null}</div>
    </div>

    <div class="card">
      <div class="ch"><b>Instruments</b><span class="st">${instruments.length || 'none'}</span></div>
      ${instruments.length === 0 ? html`<p>One row per light. Cues call it by name: “front = 80”.</p>` : html`<div class="lx-patch head"><span>Name</span><span>Fixture</span><span>Universe</span><span>Address</span><span>Note</span><span></span></div>`}
      ${instruments.map((x, i) => { const lv = live(x.name); return html`<div class="lx-patch" key=${i}>
        <${TextBox} value=${x.name} onCommit=${(v: string) => { if (v.trim()) updI(i, { name: v.trim() }); }} />
        <select value=${x.fixture || 'dimmer'} onChange=${(e: Typed) => updI(i, { fixture: e.target.value })}>${l.fixtures.map((f) => html`<option value=${f.id}>${f.name} (${f.footprint} ch)</option>`)}</select>
        <select value=${String(x.universe || 0)} onChange=${(e: Typed) => updI(i, { universe: Number(e.target.value) })}><option value="0">none</option>${universes.map((u) => html`<option value=${String(u.id)}>${u.id}</option>`)}</select>
        <${TextBox} mono value=${x.address || ''} placeholder="—" onCommit=${(v: string) => updI(i, { address: Math.max(0, Math.round(Number(v)) || 0) })} />
        <${TextBox} value=${x.note || ''} placeholder=${lv.patched && lv.footprint > 1 ? `channels ${span(lv)}` : ''} onCommit=${(v: string) => updI(i, { note: v })} />
        <button class="btn ghost small icon" title="Remove this instrument" onClick=${() => set('instruments', instruments.filter((_, j) => j !== i), 'remove instrument')}>×</button>
      </div>`; })}
      <div class="row-flex" style="margin-top:10px">
        <select style="width:240px" data-light-add value="" onChange=${(e: Typed) => { if (e.target.value) addI(e.target.value); e.target.value = ''; }}><option value="">Add an instrument…</option>${l.fixtures.map((f) => html`<option value=${f.id}>${f.name} (${f.footprint} ch)</option>`)}</select>
        <span class="dim">how many</span><input type="text" class="mono" style="width:44px" value=${count} onInput=${(e: Typed) => setCount(e.target.value)} />
        <span class="dim" style="font-size:11.5px">Patched to the next free addresses.</span></div>
      ${l.problems.map((p) => html`<div class="problem warning" style="margin-top:8px"><b>${p.where}</b> ${p.why}</div>`)}
    </div>

    <div class="card">
      <div class="ch"><b>Groups</b><span class="st">${groups.length || 'none'}</span></div>
      <p>A name for several instruments: “wash = 50”. Every one is in “all”.</p>
      ${groups.map((g, i) => html`<div class="lx-patch group" key=${i}>
        <${TextBox} value=${g.name} onCommit=${(v: string) => { if (v.trim()) updG(i, { name: v.trim() }); }} />
        <${TextBox} value=${(g.members || []).join(', ')} placeholder="front, side L, 1, 2" onCommit=${(v: string) => updG(i, { members: v.split(',').map((m) => m.trim()).filter(Boolean) })} />
        <button class="btn ghost small icon" title="Remove this group" onClick=${() => set('groups', groups.filter((_, j) => j !== i), 'remove light group')}>×</button>
      </div>`)}
      <div class="row-flex" style="margin-top:10px"><button class="btn small" onClick=${() => { let k = groups.length + 1; while (groups.some((g) => g.name === `group ${k}`)) k++; set('groups', [...groups, { name: `group ${k}`, members: [] }], 'add light group'); }}>Add a group</button></div>
    </div>

    <div class="card">
      <div class="ch"><b>Fixtures</b><span class="st">${l.fixtures.length} kinds</span></div>
      <p>A light’s DMX channels, in order. Yours are kept in the show.</p>
      ${own.map((f) => html`<div class="patch" key=${f.id}><div class="row-flex"><b>${f.name || f.id}</b><span class="dim mono" style="font-size:11.5px">${(l.fixtures.find((x) => x.id === f.id) || { params: [] }).params.join(' · ')}</span><span class="grow"></span>
        <button class="btn small" onClick=${() => setDraft({ id: f.id, name: f.name || f.id, text: (l.fixtures.find((x) => x.id === f.id) || { text: '' }).text || '', why: '' })}>Edit</button>
        <button class="btn ghost small icon" title="Remove this fixture" disabled=${instruments.some((x) => x.fixture === f.id)} onClick=${() => set('fixtures', own.filter((x) => x.id !== f.id), 'remove fixture')}>×</button></div></div>`)}
      ${draft ? html`<div class="patch">
        <div class="pgrid"><div style="grid-column: span 4"><label>Name</label><input type="text" data-fixture-name value=${draft.name} onInput=${(e: Typed) => setDraft({ ...draft, name: e.target.value })} /></div></div>
        <label style="margin-top:8px">One parameter a line, in DMX order. “pan 16” is two channels; “iris home 100” rests at 100.</label>
        <textarea class="mono" rows="7" data-fixture-text placeholder=${'intensity\nred\ngreen\nblue\npan 16\ntilt 16'} value=${draft.text} onInput=${(e: Typed) => setDraft({ ...draft, text: e.target.value })}></textarea>
        ${draft.why ? html`<div class="problem" style="margin-top:8px">${draft.why}</div>` : null}
        <div class="row-flex" style="margin-top:8px"><button class="btn primary small" data-fixture-save onClick=${saveFixture}>Save fixture</button><button class="btn small" onClick=${() => setDraft(null)}>Cancel</button></div>
      </div>` : html`<div class="row-flex" style="margin-top:10px"><button class="btn small" data-fixture-new onClick=${() => setDraft({ id: '', name: '', text: '', why: '' })}>New fixture…</button></div>`}
    </div>
    <p class="dim" style="font-size:12px">${keys('Dashboard: ⇧⌘D.')}</p>`;
}
