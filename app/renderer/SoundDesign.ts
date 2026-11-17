// Sound design in the window: the inspector's tab for one sound's chain of tools and its eq, and the little
// editor for what of a chain a Fade cue moves. What each tool is and does is core/audio/chain.js (the table comes
// in `info.sound`); nothing here holds show state.
//
// The tab is a rack, as a sound engineer knows it from a channel strip or a DAW: one device per tool in use, left to
// right in the order they run, each with a power button and its main settings as knobs (Knob.js).
import { html, useState, useEffect, useRef, ec, edit, setCue, cx } from './lib.js';
import * as Lanes from '../../core/audio/lanes.js';
import { ParamKnob } from './Knob.js';
import { curvePath, filterDb, eqDb, quantize } from './dial.js';


/** One small box that commits on Enter or when it loses the keyboard, and goes back on Esc. */
function Box({ value, onCommit, title, placeholder = '', width = 52, ...rest }) {
  const [draft, setDraft] = useState(null);
  const typed = useRef(null);            // what has been typed, whether or not the box has been drawn again since
  const type = (v) => { typed.current = v; setDraft(v); };
  const drawn = useRef(false);
  useEffect(() => { if (drawn.current) type(null); drawn.current = true; }, [value]);
  const done = () => { const d = typed.current; type(null); if (d !== null && d !== String(value ?? '')) onCommit(d); };
  return html`<input type="text" class="mono" ...${rest} style=${`width:${width}px`} title=${title} placeholder=${placeholder} value=${draft !== null ? draft : (value ?? '')}
    onInput=${(e) => type(e.target.value)} onBlur=${done}
    onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); done(); e.target.blur(); } if (e.key === 'Escape') { type(null); e.target.blur(); e.stopPropagation(); } }} />`;
}
const numberOf = (text) => { const t = String(text).trim().replace('−', '-').replace(/\s*(hz|db|ms|s|st|ct)$/i, ''); const k = /k$/i.test(t) ? 1000 : 1; const n = Number(t.replace(/k$/i, '')) * k; return t !== '' && Number.isFinite(n) ? n : null; };
const shown = (v) => (v === undefined || v === null ? '' : String(v));
const defaultsOf = (t) => Object.fromEntries(t.params.filter((p) => p.def !== undefined).map((p) => [p.key, p.def]));

/** What a chain has switched on, in a few words: for the tab's name and the cue's summary. */
export function chainCount(cue) {
  const c = cue.chain || {};
  return Object.keys(c).filter((k) => c[k] && typeof c[k] === 'object' && c[k].on !== false).length + (cue.eq ? 1 : 0);
}

// What each device shows on its face: at most four knobs, in this order; the rest of its settings are behind its
// ‹ › (a choice or a switch is a small row of its own under the knobs, a file is behind the ‹ ›).
const FRONT = {
  highpass: ['hz'], lowpass: ['hz'],
  gate: ['threshold', 'range', 'attack', 'release'],
  comp: ['threshold', 'ratio', 'release', 'makeup'],
  drive: ['db', 'tone', 'out'],
  crush: ['bits', 'hz'],
  pitch: ['semitones', 'cents'],
  chorus: ['rate', 'depth', 'feedback', 'mix'],
  tremolo: ['rate', 'depth'], autopan: ['rate', 'depth'],
  stereo: ['width'],
  delay: ['time', 'feedback', 'tone', 'mix'],
  reverb: ['size', 'decay', 'predelay', 'mix'],
};
// (a knob's name is short: the device's title says what it belongs to)
const SHORT = { 'gate.threshold': 'Thresh', 'comp.threshold': 'Thresh', 'gate.range': 'Range', 'crush.hz': 'Rate', 'pitch.semitones': 'Semi', 'comp.makeup': 'Make-up', 'reverb.predelay': 'Pre-dly', 'highpass.hz': 'Freq', 'lowpass.hz': 'Freq', 'drive.out': 'Out', 'chorus.feedback': 'Fdbk', 'delay.feedback': 'Fdbk' };
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A small popover under the button that opened it; it goes away on a click outside it, or on that button again.
 *  (Not on Esc: Esc is the show's panic key everywhere but a text field, and a menu does not take it over.) */
export function Pop({ anchor, onClose, width = 240, children, ...rest }) {
  const el = useRef(null);
  useEffect(() => {
    const away = (e) => { if (el.current && !el.current.contains(e.target) && !(anchor && anchor.contains(e.target))) onClose(); };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, [anchor]);
  const r = anchor ? anchor.getBoundingClientRect() : { left: 0, bottom: 0, top: 0 };
  // (below the button when there is room, else above it; never off the window's right edge)
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
  const below = window.innerHeight - r.bottom > 260;
  return html`<div class="popover sd-pop" ref=${el} ...${rest} style=${`left:${left}px;width:${width}px;${below ? `top:${r.bottom + 4}px` : `bottom:${window.innerHeight - r.top + 4}px`}`}>${children}</div>`;
}

const POWER = html`<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5.2 3.6a5.5 5.5 0 1 0 5.6 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 1.6v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

/** One device of the rack: a title bar (power, name, ‹ ›, ×), maybe a response curve, its knobs, and its small choices. */
function Device({ id, label, help, on, power = true, pending, curve, zero = 12 / 42, knobs, extra = [], options, open, onOpen, onPower, onRemove, children }) {
  return html`<div class=${cx('dev', on ? 'on' : 'off', pending && 'pending', open && 'open')} data-device=${id}>
    <div class="dev-head" title=${help}>
      ${power ? html`<button class=${cx('dev-power', on && 'on')} data-power=${id} aria-pressed=${on} aria-label=${`${label} on`} title=${on ? 'On: click to switch it off (its settings are kept)' : 'Off: click to switch it on'} onClick=${onPower}>${POWER}</button>` : html`<span class="dev-power fixed" title="In while a band is moved">${POWER}</span>`}
      <span class="dev-name">${label}${pending ? html`<i class="dev-dot" title="Changed since the show was saved"></i>` : null}</span>
      ${extra.length ? html`<button class="dev-more" data-more=${id} title=${open ? 'Fewer settings' : `${extra.length} more setting${extra.length > 1 ? 's' : ''}`} onClick=${onOpen}>${open ? '‹' : '›'}</button>` : null}
      <button class="dev-x" data-remove=${id} title="Remove from the chain" onClick=${onRemove}>×</button>
    </div>
    ${curve ? html`<svg class="dev-curve" viewBox="0 0 120 34" preserveAspectRatio="none" aria-hidden="true"><line class="zero" x1="0" x2="120" y1=${zero * 34} y2=${zero * 34} /><path d=${curve} /></svg>` : null}
    ${children}
    <div class="dev-knobs">${knobs}${open ? extra : null}</div>
    ${options ? html`<div class="dev-opts">${options}</div>` : null}
  </div>`;
}

/**
 * The inspector's Sound design tab: the cue's chain as a rack of devices, left to right in the order they run. Only
 * the tools in use are drawn; "+" adds one. The order is fixed (core/audio/chain.js): a device added is placed where
 * it runs, so there is nothing to drag. Every change is one edit through the show's ops (undo works); a device or a
 * knob changed since the show was saved is marked in the standby colour.
 */
/** A field of the cue as last sent from here, until the host's copy says it back (or 2 s go by): two changes made
 *  faster than that round trip each build on the one before, instead of the second undoing the first. */
function useSent(cue, field) {
  const ref = useRef(null);
  const now = cue[field] ?? null;
  if (ref.current && (ref.current.id !== cue.id || JSON.stringify(now) === ref.current.json || Date.now() - ref.current.at > 2000)) ref.current = null;
  return [ref.current ? ref.current.value : now, (value) => { ref.current = { id: cue.id, value, json: JSON.stringify(value), at: Date.now() }; }];
}

export function SoundDesign({ cue, s, info, pending }) {
  const [chainNow, sentChain] = useSent(cue, 'chain'), [eqNow, sentEq] = useSent(cue, 'eq');
  const S = info.sound, chain = chainNow || {}, eq = eqNow || {};
  const [name, setName] = useState('');
  const [eqShown, setEqShown] = useState(false);          // an eq added and not yet moved (an eq of nothing is not kept)
  const [band, setBand] = useState('low');
  const [opened, setOpened] = useState(() => new Set());
  const [pop, setPop] = useState(null);                   // { kind: 'add' | 'presets', anchor }
  useEffect(() => { setName(''); setEqShown(false); setPop(null); setOpened(new Set()); }, [cue.id]);
  // (a device removed takes its lines with it, in the same edit: core/audio/lanes.js pruneFor)
  const withLanes = (props) => { const kept = Lanes.pruneFor(cue.automation, props.chain); return kept === cue.automation ? props : { ...props, automation: kept }; };
  const put = (next, label) => {
    const tools = Object.keys(next).filter((k) => next[k] && typeof next[k] === 'object');
    const value = tools.length ? next : null;
    sentChain(value);
    setCue(cue.id, withLanes({ chain: value }), label);
  };
  const have = (t) => chain[t.key] || null;
  const valuesOf = (t) => ({ ...defaultsOf(t), ...(have(t) || {}) });
  const isOn = (t) => !!have(t) && have(t).on !== false;
  const add = (t) => { setPop(null); if (t === 'eq') { setEqShown(true); return; } put({ ...chain, [t.key]: defaultsOf(t) }, `${t.label} added`); };
  const remove = (t) => { const { [t.key]: _gone, ...rest } = chain; put(rest, `${t.label} removed`); };
  const power = (t) => { const cur = have(t); put({ ...chain, [t.key]: cur.on === false ? (({ on, ...rest }) => rest)(cur) : { ...cur, on: false } }, `${t.label} ${isOn(t) ? 'off' : 'on'}`); };
  // (a setting changed on a device that is off leaves it off, as its power button says)
  const setParam = (t, p, v) => put({ ...chain, [t.key]: { ...valuesOf(t), [p.key]: v } }, `${t.label} ${p.label.toLowerCase()}`);
  const flag = (k) => put({ ...chain, [k]: chain[k] ? undefined : true }, k === 'tail' ? 'let the tail ring' : 'bypass');
  const toggleOpen = (k) => setOpened((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // what the saved show has, to mark what has changed since (nothing is marked when the field is not pending)
  const was = (pending && pending.cues.get(cue.id)) || null;
  // (a cue added since the save has nothing saved: every device on it is new)
  const added = !!(was && was.kinds.has('added'));
  const savedChain = added ? {} : was && was.fields.get('chain') ? (was.fields.get('chain').rawFrom || {}) : chain;
  const savedEq = added ? {} : was && was.fields.get('eq') ? (was.fields.get('eq').rawFrom || {}) : eq;

  // the eq's bands: a level alone while a band sits at its usual place, { db, hz, q } once it is moved
  const bandOf = (b, from = eq) => { const v = from[b.key]; const o = v && typeof v === 'object' ? v : { db: v }; return { db: Number(o.db) || 0, hz: o.hz ?? b.hz, q: o.q ?? b.q }; };
  const setEq = (b, k, n) => {
    const cur = { ...bandOf(b), [k]: n };
    const next = { ...eq };
    if (!cur.db) delete next[b.key]; else next[b.key] = cur.hz !== b.hz || (b.q && cur.q !== b.q) ? { db: cur.db, hz: cur.hz, ...(b.q ? { q: cur.q } : {}) } : cur.db;
    // (an eq brought back to flat stays on the rack until another cue is chosen)
    if (!Object.keys(next).length) setEqShown(true);
    const value = Object.keys(next).length ? next : null;
    sentEq(value);
    setCue(cue.id, { eq: value }, 'eq');
  };

  // presets: the built-in ones and the show's own (settings.audio.chains)
  const mine = s.doc.settings.audio.chains || {};
  const apply = (id) => {
    const p = id.startsWith('b:') ? S.presets[id.slice(2)] : mine[id.slice(2)];
    if (p) { sentChain(p.chain || null); sentEq(p.eq || null); setCue(cue.id, withLanes({ chain: p.chain || null, eq: p.eq || null }), `preset ${id.slice(2)}`); }
    setPop(null);
  };
  const save = () => {
    const n = name.trim().slice(0, 40);
    if (!n || (!cue.chain && !cue.eq)) return;
    const { bypass, ...kept } = chain;
    edit([{ op: 'show.set', path: 'settings.audio.chains', value: { ...mine, [n]: { ...(Object.keys(kept).length ? { chain: kept } : {}), ...(cue.eq ? { eq: cue.eq } : {}) } } }], `save preset ${n}`);
    setName('');
  };
  const forget = (n) => { const next = { ...mine }; delete next[n]; edit([{ op: 'show.set', path: 'settings.audio.chains', value: Object.keys(next).length ? next : undefined }], `remove preset ${n}`); };

  const kind = ((s.mixer.kinds || {})[cue.bus || (cue.type === 'mic' ? 'vocals' : 'effects')]) || '';
  const offer = S.offer[kind] && !cue.chain && !cue.eq ? S.offer[kind] : null;
  const rings = isOn({ key: 'reverb' }) || isOn({ key: 'delay' });
  const playing = s.engine.active.some((a) => a.id === cue.id && a.kind === 'audio');
  const showEq = !!cue.eq || eqShown;

  // ── the devices, in the order they run (the eq after the filters) ──
  // A knob with a line over it (Time & Loops) shows where the line is (where the sound is playing, else at its
  // Start), and turning it moves the whole line by as much, along the knob's own scale.
  const here = (s.engine.active.find((a) => a.id === cue.id && a.kind === 'audio') || {}).elapsed ?? (Number(cue.from) || 0);
  // (a setting's line, where it is now; none: the knob's own)
  const lineOr = (t, key, own) => { const id = `chain.${t.key}.${key}`, line = (cue.automation || {})[id], sp = line && Lanes.specOf(id, S.tools); return sp ? Lanes.valueAt(line, here, sp) : own; };
  const knobOf = (t, p, v) => {
    const id = `chain.${t.key}.${p.key}`, line = ((cue.automation || {})[id]) || null, spec = line && Lanes.specOf(id, S.tools);
    const value = spec ? quantize(p, Lanes.valueAt(line, here, spec)) : v[p.key];
    const shift = (x) => {
      const by = Lanes.posOf(p, x) - Lanes.posOf(p, value);
      const moved = line.map((q) => [q[0], quantize(p, Lanes.valueAtPos(p, Lanes.posOf(p, q[1]) + by), true), ...(q[2] ? [q[2]] : [])]);
      setCue(cue.id, Lanes.propsFor(cue, id, moved), `${t.label} ${p.label.toLowerCase()} line`);
    };
    return html`<${ParamKnob} key=${p.key} id=${`${t.key}.${p.key}`} p=${p} label=${SHORT[`${t.key}.${p.key}`]} value=${value} automated=${!!spec}
      pending=${!!savedChain[t.key] && !same(savedChain[t.key][p.key], (chain[t.key] || {})[p.key])} onCommit=${(x) => (spec ? shift(x) : setParam(t, p, x))} />`;
  };
  const deviceOf = (t) => {
    const v = valuesOf(t), front = FRONT[t.key] || [];
    const nums = t.params.filter((p) => !p.bool && !p.file && !p.options);
    const shown = front.map((k) => nums.find((p) => p.key === k)).filter(Boolean);
    const extra = nums.filter((p) => !front.includes(p.key)).map((p) => knobOf(t, p, v));
    const file = t.params.find((p) => p.file);
    if (file) {
      extra.push(html`<div class="dev-file" key="file"><span class="pk-name">IR file</span>
        <button class="btn small" data-param=${`${t.key}.${file.key}`} title=${v[file.key] ? `${v[file.key]}: replaces Size and Decay` : 'A room’s impulse response (WAV); replaces Size and Decay'}
          onClick=${async () => { const r = await ec.app({ op: 'pick-sound', accept: '' }); if (r && r.file) setParam(t, file, r.file); }}>${v[file.key] ? String(v[file.key]).split(/[\\/]/).pop() : 'Choose…'}</button>
        ${v[file.key] ? html`<button class="btn ghost small icon" title="Back to the built-in room" onClick=${() => setParam(t, file, undefined)}>×</button>` : null}</div>`);
    }
    const choices = t.params.filter((p) => p.options || p.bool);
    const options = choices.length ? choices.map((p) => (p.options
      ? html`<span class="seg" key=${p.key} title=${`${p.label} (${p.unit})`}>${p.options.map((o) => html`<button key=${String(o)} class=${cx(v[p.key] === o && 'on')} data-option=${`${t.key}.${p.key}`} data-value=${o} onClick=${() => setParam(t, p, o)}>${o}</button>`)}<span class="pk-unit">${p.unit}</span></span>`
      : html`<button key=${p.key} class=${cx('dev-opt', v[p.key] && 'on')} data-option=${`${t.key}.${p.key}`} aria-pressed=${!!v[p.key]} onClick=${() => setParam(t, p, !v[p.key])}>${p.label}</button>`)) : null;
    const curve = t.key === 'highpass' || t.key === 'lowpass' ? curvePath((hz) => filterDb(t.key, lineOr(t, 'hz', v.hz), v.slope, hz), 120, 34, 12, -30) : null;
    return html`<${Device} key=${t.key} id=${t.key} label=${t.label} help=${t.help} on=${isOn(t)} pending=${!same(savedChain[t.key], chain[t.key])}
      curve=${curve} knobs=${shown.map((p) => knobOf(t, p, v))} extra=${extra} options=${options} open=${opened.has(t.key)}
      onOpen=${() => toggleOpen(t.key)} onPower=${() => power(t)} onRemove=${() => remove(t)} />`;
  };
  const eqDevice = () => {
    const bands = S.eq.map((b) => ({ ...b, ...bandOf(b), type: b.type }));
    const b = S.eq.find((x) => x.key === band) || S.eq[0], v = bandOf(b), sv = bandOf(b, savedEq);
    const P = { gain: { key: 'db', label: 'Gain', unit: 'dB', min: -40, max: 6, def: 0 }, hz: { key: 'hz', label: 'Freq', unit: 'Hz', min: 20, max: 20000, def: b.hz }, q: { key: 'q', label: 'Q', unit: '', min: 0.1, max: 18, def: b.q } };
    const k = (p) => html`<${ParamKnob} key=${`${b.key}.${p.key}`} id=${`eq.${b.key}.${p.key}`} p=${p} value=${v[p.key]} pending=${v[p.key] !== sv[p.key]} onCommit=${(x) => setEq(b, p.key, x)} />`;
    return html`<${Device} key="eq" id="eq" label="EQ" help="Four bands, after the filters. A band at 0 dB is out of the path." on=${true} power=${false} pending=${!same(savedEq, eq)}
      curve=${curvePath((hz) => eqDb(bands, hz), 120, 34, 18, -18)} zero=${0.5} knobs=${[k(P.gain), k(P.hz), b.q ? k(P.q) : null]}
      onRemove=${() => { setEqShown(false); sentEq(null); setCue(cue.id, { eq: null }, 'eq removed'); }}>
      <div class="seg dev-bands">${S.eq.map((x) => html`<button key=${x.key} class=${cx(band === x.key && 'on', bandOf(x).db && 'set')} data-band=${x.key} title=${x.label} onClick=${() => setBand(x.key)}>${{ low: 'Low', mid: '1', mid2: '2', high: 'High' }[x.key] || x.label}</button>`)}</div>
    <//>`;
  };
  const devices = [];
  for (const t of S.tools) {
    if (t.key === 'gate' && showEq) devices.push(eqDevice());
    if (have(t)) devices.push(deviceOf(t));
  }
  if (showEq && !S.tools.some((t) => t.key === 'gate')) devices.push(eqDevice());

  // the list "+" opens: every tool, lightly grouped, the eq with the filters; one of each
  const groups = [];
  for (const t of S.tools) { let g = groups.find((x) => x.name === t.group); if (!g) groups.push(g = { name: t.group, tools: [] }); g.tools.push(t); if (t.key === 'lowpass') g.tools.push('eq'); }
  const open = (kind) => (e) => { const anchor = e.currentTarget; setPop((p) => (p && p.kind === kind ? null : { kind, anchor })); };

  return html`<div class=${cx('sd', chain.bypass && 'bypassed')} data-sound-design>
    <div class="sd-top">
      <button class="btn small" data-presets title="Presets: apply, save or remove" onClick=${open('presets')}>Presets ▾</button>
      ${offer ? html`<span class="sd-offer" data-offer><span class="dim">${kind === 'live' ? 'Live' : 'Voice'} bus:</span><button class="btn ghost small" title="An 80 Hz high-pass and a light compressor" onClick=${() => apply(`b:${offer}`)}>Use ${offer}</button></span>` : null}
      <span class="grow"></span>
      ${playing && devices.length ? html`<span class="dim sd-note" title="Switching a device, a slope or a reverb’s size rebuilds the chain under the playing sound">a change may click</span>` : null}
      <button class=${cx('btn small sd-flag', chain.bypass && 'standby')} data-bypass aria-pressed=${!!chain.bypass} disabled=${!cue.chain} title="A/B: the sound with none of its effects (they are kept). A cue left bypassed plays bypassed." onClick=${() => flag('bypass')}>Bypass</button>
      <button class=${cx('btn small sd-flag', chain.tail && 'on')} data-tail aria-pressed=${!!chain.tail} disabled=${!rings} title="Let the tail ring: reverb and delay ring out after a stop. Panic twice ends it." onClick=${() => flag('tail')}>Tail</button>
    </div>
    <div class="rack" data-rack>
      ${devices}
      <button class=${cx('rack-add', !devices.length && 'first')} data-add-effect title="Add an effect" onClick=${open('add')}>${devices.length ? '+' : '+ Add effect'}</button>
    </div>
    ${pop && pop.kind === 'add' ? html`<${Pop} anchor=${pop.anchor} onClose=${() => setPop(null)} width=${300} data-add-menu>
      ${groups.map((g) => html`<div class="sd-menu-group" key=${g.name}><h5>${g.name}</h5><div class="sd-menu-items">${g.tools.map((t) => (t === 'eq'
        ? html`<button key="eq" class="sd-menu-item" data-add-tool="eq" disabled=${showEq} title="Four bands: a low shelf, two bells, a high shelf" onClick=${() => add('eq')}>EQ</button>`
        : html`<button key=${t.key} class="sd-menu-item" data-add-tool=${t.key} disabled=${!!have(t)} title=${t.help} onClick=${() => add(t)}>${t.label}</button>`))}</div></div>`)}
    <//>` : null}
    ${pop && pop.kind === 'presets' ? html`<${Pop} anchor=${pop.anchor} onClose=${() => setPop(null)} width=${260} data-preset-menu>
      <div class="sd-menu-group"><h5>Built in</h5><div class="sd-menu-items">${Object.keys(S.presets).map((n) => html`<button key=${n} class="sd-menu-item" data-preset=${`b:${n}`} title="Replaces this cue’s effects" onClick=${() => apply(`b:${n}`)}>${n}</button>`)}</div></div>
      ${Object.keys(mine).length ? html`<div class="sd-menu-group"><h5>This show’s</h5>${Object.keys(mine).map((n) => html`<div class="sd-menu-row" key=${n}><button class="sd-menu-item" data-preset=${`s:${n}`} title="Replaces this cue’s effects" onClick=${() => apply(`s:${n}`)}>${n}</button><button class="btn ghost small icon" data-preset-forget=${n} title="Remove the preset (cues keep their effects)" onClick=${() => forget(n)}>×</button></div>`)}</div>` : null}
      <div class="sd-menu-row"><input type="text" data-preset-name placeholder="Save these as…" value=${name} onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => { e.stopPropagation(); if (e.key === 'Enter') save(); }} />
        <button class="btn small" data-preset-save disabled=${!name.trim() || (!cue.chain && !cue.eq)} onClick=${save}>Save</button></div>
      <button class="sd-menu-item danger" data-clear disabled=${!cue.chain && !cue.eq} onClick=${() => { setEqShown(false); setPop(null); sentChain(null); sentEq(null); setCue(cue.id, withLanes({ chain: null, eq: null }), 'clear sound design'); }}>Remove every effect</button>
    <//>` : null}
  </div>`;
}

/** A Fade cue's "Sound design to": the settings of its target's chain that move over the fade (a filter sweep). */
export function SweepField({ value, target, info, onCommit }) {
  const S = info.sound, to = value && typeof value === 'object' ? value : {};
  const rows = Object.entries(to).flatMap(([tool, set]) => Object.entries(set || {}).map(([key, v]) => ({ tool, key, v, p: S.sweepable.find((x) => x.tool === tool && x.key === key) }))).filter((r) => r.p);
  const chain = (target && target.chain) || {};
  const put = (tool, key, v) => {
    const next = JSON.parse(JSON.stringify(to));
    if (v === undefined) { if (next[tool]) { delete next[tool][key]; if (!Object.keys(next[tool]).length) delete next[tool]; } } else (next[tool] = next[tool] || {})[key] = v;
    onCommit(Object.keys(next).length ? next : null);
  };
  // a setting added starts where the target has it now (so nothing moves until a destination is typed)
  const add = (id) => { const p = S.sweepable.find((x) => x.id === id); if (!p) return; const tool = S.tools.find((t) => t.key === p.tool), now = (chain[p.tool] || {})[p.key]; put(p.tool, p.key, now !== undefined ? now : tool.params.find((x) => x.key === p.key).def); };
  const off = [...new Set(rows.map((r) => r.tool))].filter((t) => !chain[t] || chain[t].on === false);
  return html`<div data-sweep style="display:grid;gap:5px">
    ${rows.map((r) => html`<div class="with-unit" key=${r.p.id}><span class="unit" style="width:170px">${r.p.label}</span><span class="unit">to</span>
      <${Box} data-sweep-to=${r.p.id} width=${64} value=${shown(r.v)} title=${`${r.p.min} to ${r.p.max}${r.p.unit ? ` ${r.p.unit}` : ''}`} onCommit=${(t) => { const n = numberOf(t); if (n !== null) put(r.tool, r.key, Math.max(r.p.min, Math.min(r.p.max, n))); }} /><span class="unit">${r.p.unit}</span>
      <button class="btn ghost small icon" title="Leave this alone" onClick=${() => put(r.tool, r.key, undefined)}>×</button></div>`)}
    <div class="with-unit"><select data-sweep-add style="width:230px" value="" onChange=${(e) => { const v = e.target.value; e.target.value = ''; if (v) add(v); }}>
      <option value="">Move a setting…</option>
      ${S.tools.map((t) => { const list = S.sweepable.filter((p) => p.tool === t.key && !rows.some((r) => r.p.id === p.id)); return list.length ? html`<optgroup key=${t.key} label=${`${t.label}${chain[t.key] && chain[t.key].on !== false ? '' : ' (not on in its target)'}`}>${list.map((p) => html`<option key=${p.id} value=${p.id}>${p.label}</option>`)}</optgroup>` : null; })}</select></div>
    ${off.length ? html`<div class="problem warning">Its target has no ${off.join(', ')} on: nothing to move. Switch it on in the target’s Sound design.</div>` : null}
  </div>`;
}
