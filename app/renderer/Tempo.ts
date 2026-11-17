// A sound's tempo as the views read it (the Playing strip, Time & Loops, the Live view): its sections, the bar
// lines to draw, the bar and beat a place is in; and the controls that correct a tempo where it is found.
import { html, useState, useEffect, cmd, setCue, clock, cx } from './lib.js';
import type { Cue } from './lib.js';
import type { TempoEdit } from '../../core/audio/tempo';

/** A tempo as a cue keeps it (core/audio/tempo.ts): the first section's bpm, bar line and bar, then the later sections. */
export interface TempoLike { bpm: number; first?: number; bar?: number; sections?: { from: number; bpm: number; first?: number; bar?: number }[] }
/** One section of a tempo, filled in. */
export interface TempoSection { from: number; bpm: number; first: number; bar: number }

export const bpmText = (b: number) => (Math.round(b * 100) / 100).toFixed(2);
/** A tempo's sections in order, and the one a place is in (as core/audio/tempo.ts has them: the top of a tempo is
 *  the section from the start of the file, `sections` the later ones, each with its own bpm, bar line and bar). */
export function sectionsOf(tempo: TempoLike | null | undefined): TempoSection[] {
  if (!tempo || !(tempo.bpm > 0)) return [];
  return [{ from: 0, bpm: tempo.bpm, first: tempo.first || 0, bar: tempo.bar || 4 }, ...(tempo.sections || []).map((x) => ({ from: x.from, bpm: x.bpm, first: x.first ?? x.from, bar: x.bar || 4 }))];
}
export function sectionAt(tempo: TempoLike | null | undefined, t: number) {
  const all = sectionsOf(tempo);
  if (!all.length) return null;
  let i = 0;
  while (i + 1 < all.length && all[i + 1].from <= t + 1e-6) i++;
  return { index: i, ...all[i], to: i + 1 < all.length ? all[i + 1].from : Infinity };
}
/** The bar lines of a tempo across a length of sound (what the engine quantises to), section by section. */
export function barsOf(tempo: TempoLike | null | undefined, length: number) {
  const all = sectionsOf(tempo), out: number[] = [];
  if (!(length > 0)) return out;
  all.forEach((x, i) => {
    const bar = (60 / x.bpm) * x.bar, to = i + 1 < all.length ? Math.min(length, all[i + 1].from - 0.02) : length;
    for (let t = x.first + Math.ceil((x.from - x.first) / bar - 1e-6) * bar; t <= to && out.length < 600; t += bar) if (t >= 0) out.push(t);
  });
  return out;
}
/** The bar and the beat a place is in, counted from 1 from the start of the sound (bars before the first bar
 *  line count back from it: a pick-up is bar 0). null with no tempo. */
export function barBeatAt(tempo: TempoLike | null | undefined, t: number) {
  const all = sectionsOf(tempo);
  if (!all.length) return null;
  let bars = 0, sec = all[0];
  for (let i = 0; i < all.length; i++) {
    const x = all[i], next = all[i + 1];
    if (next && next.from <= t + 1e-6) { bars += Math.max(0, Math.round((next.from - x.first) / ((60 / x.bpm) * x.bar))); continue; }
    sec = x; break;
  }
  const beats = Math.floor((t - sec.first) / (60 / sec.bpm) + 1e-6);
  return { bar: bars + Math.floor(beats / sec.bar) + 1, beat: ((beats % sec.bar) + sec.bar) % sec.bar + 1, per: sec.bar };
}
/** The bar line nearest a place (a marker made by ear lands on the bar it was meant for). */
export function nearestBar(tempo: TempoLike | null | undefined, t: number) {
  const sec = sectionAt(tempo, t);
  if (!sec) return t;
  const bar = (60 / sec.bpm) * sec.bar;
  return Math.max(0, Math.round((sec.first + Math.round((t - sec.first) / bar) * bar) * 1000) / 1000);
}
/** A stretch of `len` beats (or, `inBeats` false, seconds) from where a track is, as a loop region: in beats it
 *  starts on the beat the track is on, so the loop is a whole number of them and stays in time. null when it
 *  would run off the end of the sound. */
export function loopFromHere(tempo: TempoLike | null | undefined, a: { elapsed: number; total?: number }, len: number, inBeats: boolean) {
  const sec = inBeats ? sectionAt(tempo, a.elapsed) : null;
  if (inBeats && !sec) return null;
  const beat = sec ? 60 / sec.bpm : 0;
  const start = Math.round((sec ? (sec.first || 0) + Math.floor((a.elapsed - (sec.first || 0)) / beat + 1e-6) * beat : a.elapsed) * 1000) / 1000;
  const end = Math.round((start + (sec ? len * beat : len)) * 1000) / 1000;
  if (start < 0 || (a.total && end > a.total)) return null;
  return { start, end };
}

const BARS = [2, 3, 4, 5, 6, 7, 9, 12];

/** Correcting a found tempo, where it is found (Time & Loops ▸ Tempo): the number itself, half and double, the
 *  other readings the listen offered, the beats in a bar, and where beat one is. `at` is the place the edits
 *  act at (where the sound is playing, or the place picked on the waveform); a tempo that changes is edited in
 *  the section `at` is in. Sections themselves (a new change of tempo, removing one) are made in the Live view. */
/** What a listen heard: a reading and the others it offered. */
type Heard = { none?: boolean; bpm: number; first?: number; others?: { bpm: number; first?: number }[] };
export function TempoFix({ cue, at, playing, locked }: { cue: Cue; at: number; playing?: boolean; locked?: boolean }) {
  const [found, setFound] = useState<Heard | null>(null);           // what the last listen heard in this file (its other readings)
  const [typed, setTyped] = useState<string | null>(null);
  const tempo = cue.tempo || null;
  useEffect(() => { let alive = true; setTyped(null); cmd({ op: 'tempo-of', file: cue.file! }).then((r) => { if (alive) setFound(r && r.known ? r.tempo || { none: true } : null); }); return () => { alive = false; }; }, [cue.id, cue.file, tempo && tempo.bpm]);
  if (!tempo) return null;
  const sec = sectionAt(tempo, at) || sectionsOf(tempo)[0];
  const editAt = (e: TempoEdit) => cmd({ op: 'tempo-edit', id: cue.id, edit: { ...e, at } });
  const commit = () => { const b = Number(typed); setTyped(null); if (b >= 20 && b <= 400 && Math.abs(b - sec.bpm) > 0.004) editAt({ do: 'set', bpm: b }); };
  const others = found && !found.none ? [found, ...(found.others || [])].filter((o) => Math.abs(o.bpm - tempo.bpm) > 0.3).slice(0, 3) : [];
  const where = playing ? 'where it is now' : clock(at);
  return html`<div class="tempofix" data-tempofix>
    <input class="mono bpmfield" type="text" disabled=${locked} value=${typed !== null ? typed : bpmText(sec.bpm)} title="Beats a minute"
      onInput=${(e: InputEvent) => setTyped((e.target as HTMLInputElement).value)} onBlur=${commit} onKeyDown=${(e: KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLElement).blur(); if (e.key === 'Escape') { setTyped(null); (e.target as HTMLElement).blur(); } }} />
    <span class="dim">bpm</span>
    <button class="btn small" data-half disabled=${locked} onClick=${() => editAt({ do: 'set', bpm: sec.bpm / 2 })} title="Half time">÷2</button>
    <button class="btn small" data-double disabled=${locked} onClick=${() => editAt({ do: 'set', bpm: sec.bpm * 2 })} title="Double time">×2</button>
    ${others.length > 0 ? html`<span class="dim">or</span>${others.map((o) => html`<button class="btn small" data-reading disabled=${locked} onClick=${() => setCue(cue.id, { tempo: { bpm: o.bpm, first: o.first, bar: 4 } }, 'tempo')} title="Another reading, for the whole sound">${bpmText(o.bpm)}</button>`)}` : null}
    <span class="sep"></span>
    <select class="barsel" disabled=${locked} value=${String(sec.bar)} onChange=${(e: Event) => editAt({ do: 'set', bar: Number((e.target as HTMLSelectElement).value) })} title="Beats in a bar">
      ${[...new Set([...BARS, sec.bar])].sort((x, y) => x - y).map((n) => html`<option value=${String(n)}>${n} in a bar</option>`)}</select>
    <button class=${cx('btn small')} data-one disabled=${locked} onClick=${() => editAt({ do: 'one' })} title=${`The beat nearest ${where} is beat one of a bar`}>1 is here</button>
    <button class="btn small" disabled=${locked} onClick=${() => editAt({ do: 'nudge', by: -0.01 })} title="Bar lines 10 ms earlier">◀</button>
    <button class="btn small" disabled=${locked} onClick=${() => editAt({ do: 'nudge', by: 0.01 })} title="Bar lines 10 ms later">▶</button>
  </div>`;
}
