/**
 * The smoke run's checks of the tools a show needs when it leaves the script, in the cue list's own window
 * (called from smoke.ts after smoke-defaults.ts):
 *
 *   the Playing strip   go round the next seconds or bars from here with no region drawn, and let go (the button, L);
 *                       bar lines and the bar.beat count once the sound has a tempo; "+ here"; a marker's button,
 *                       at once and on the bar
 *   Time & Loops        a found tempo corrected where it is found (half, double, beats in a bar, "1 is here", a change of tempo)
 *   a group's Quantise  a GO lands on the playing track's bar line
 *
 * Positions and what the engine says it is doing: nobody hears a test run.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Smoke, Snap } from './smoke';
import type { Cue } from '../../core/show/types';

async function rescue({ host, win, check, until, page, sleep, shot }: Pick<Smoke, 'host' | 'win' | 'check' | 'until' | 'page' | 'sleep' | 'shot'>) {
  const snap = () => host.snapshot() as Snap;
  const { writeWav } = require('../../examples/make-demo');
  const cueOf = (id: string): Partial<Cue> => { let hit: Cue | null = null; const walk = (l: Cue[]) => { for (const c of l) { if (c.id === id) hit = c; if (c.children) walk(c.children); } }; for (const l of host.document.doc.lists) walk(l.cues); return hit || {}; };
  const act = (id: string) => snap().engine.active.find((x) => x.id === id && x.kind === 'audio') || null;
  const has = (sel: string) => page<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`);
  const click = (sel: string) => page<boolean>(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`);

  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'mode', mode: 'edit' });
  host.openUntitled();
  await until(() => snap().show.untitled && snap().rows.length === 0 && snap().mixer.audioReady, 4000);
  // a click at 120 (a beat every 0.5 s from 0.25 s), a tone under it so the waveform has a body; and a short hit
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-rescue-'));
  const clickFile = path.join(tmp, 'steady120.wav'), hitFile = path.join(tmp, 'hit.wav');
  { const n = 44100 * 60, x = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / 44100, p = (t - 0.25 + 0.5) % 0.5; x[i] = Math.exp(-p / 0.04) * Math.sin(2 * Math.PI * 70 * p) * 0.8 + 0.05 * Math.sin(2 * Math.PI * 220 * t); } writeWav(clickFile, x); }
  { const n = 44100 * 3, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = Math.exp(-i / 44100 / 0.3) * Math.sin(2 * Math.PI * 440 * i / 44100) * 0.5; writeWav(hitFile, x); }
  const made = await host.cmd({ op: 'import', paths: [clickFile, hitFile] });
  const id = made.made[0], hit = made.made[1];
  host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id, props: { name: 'Steady' } }], label: 'name' });
  await until(() => Object.keys(snap().engine.durations).some((f) => /steady120/.test(f)), 4000);

  // 1. a sound with no tempo: the strip is quiet (no bar tools), and offers to find one
  host.cmd({ op: 'start', id });
  await until(() => act(id) && has('.playing [data-ptools]'), 4000);
  check('a playing sound with no tempo shows no bar tools in the Playing strip, only “Find the tempo” and More',
    await page(`(() => { const p = document.querySelector('.playing'); return !p.querySelector('[data-loop-bars]') && !p.querySelector('[data-barbeat]') && !p.querySelector('.barline') && !p.querySelector('[data-ptools-more]') && !!p.querySelector('[data-find-tempo-here]') && !!p.querySelector('[data-more]'); })()`));
  await click('.playing [data-more]');
  await until(() => has('.playing [data-loop-secs="2"]'), 2000);
  const e0 = act(id)!.elapsed;
  await click('.playing [data-loop-secs="2"]');
  // (from here, as far as the page knew it, a little behind the engine on a slow machine; or, decoded late, a whole two seconds on)
  check('Loop 2 s (under More) goes round the next two seconds from here, with no region drawn first', await until(() => { const a = act(id); return a && a.holding && a.region && Math.abs(a.region.end - a.region.start - 2) < 0.01 && a.region.start >= e0 - 0.25 && ((a.region.start - e0) % 2 < 0.6 || (a.region.start - e0) % 2 > 1.95); }, 10000), [e0, act(id) && act(id)!.region, act(id) && act(id)!.armed]);
  const g0 = act(id)!.region!;
  await sleep(2600);
  await until(() => act(id) && act(id)!.holding, 3000);      // (a slow machine decodes late: held once it is)
  check('…it is still inside those two seconds a pass later, and the loop is drawn over the waveform', act(id)!.holding && act(id)!.elapsed < g0.end + 0.05 && act(id)!.elapsed >= g0.start - 0.05 && (await page(`/2 s/.test((document.querySelector('.playing .lane .loop.holding') || {}).textContent || '')`)), [g0, act(id)!.elapsed]);
  await click('.playing [data-letgo]');
  check('Let go: it plays on out of the loop', await until(() => { const a = act(id); return a && !a.holding && !(a.armed || []).length && a.elapsed > g0.end + 0.2; }, 6000), act(id));

  // 2. its tempo, found from the strip; then bar lines, the count, loops in bars
  await click('.playing [data-find-tempo-here]');
  check('Find the tempo in the strip finds this sound’s tempo', await until(() => { const t = cueOf(id).tempo; return !!t && Math.abs(t.bpm - 120) < 0.05; }, 15000), cueOf(id).tempo);
  check('with a tempo the playing waveform has bar lines, and the bar and beat are counted beside the time',
    await until(() => page(`(() => { const p = document.querySelector('.playing'); const n = p.querySelectorAll('.wave .barline').length; return n >= 28 && n <= 31 && /^\\d+\\.[1-4]$/.test((p.querySelector('[data-barbeat]') || {}).textContent || ''); })()`), 3000),
    await page(`[document.querySelectorAll('.playing .wave .barline').length, (document.querySelector('.playing [data-barbeat]') || {}).textContent]`));
  { const first = cueOf(id).tempo!.first, a = act(id)!, said = await page<string>(`document.querySelector('.playing [data-barbeat]').textContent`), a2 = act(id)!;
    const bars = [a, a2].map((q) => Math.floor((q.elapsed - first) / 2) + 1);
    check('…the count is the bar the track is in', bars.includes(Number(said.split('.')[0])), [said, a.elapsed, first]); }
  host.cmd({ op: 'seek', id, t: 3.3 });
  await sleep(200);
  await click('.playing [data-loop-bars="2"]');
  const first = cueOf(id).tempo!.first;
  const onBeat = (t: number) => Math.abs((t - first) / 0.5 - Math.round((t - first) / 0.5)) < 0.03;
  check('Loop 2 bars goes round two bars of the track’s tempo from the beat it is on', await until(() => { const a = act(id); return a && a.holding && a.region && Math.abs(a.region.end - a.region.start - 4) < 0.01 && onBeat(a.region.start) && a.region.start <= a.elapsed; }, 5000), [act(id) && act(id)!.region, first]);
  check('…named in the loop lane, with Let go where the Loop buttons were', await until(() => page(`/2 bars/.test((document.querySelector('.playing .lane .loop.holding') || {}).textContent || '') && !!document.querySelector('.playing [data-letgo]') && !document.querySelector('.playing [data-loop-bars]')`), 2000));
  await shot('20-rescue-strip-wide');
  await page(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', bubbles: true }))`);
  check('L lets go of it', await until(() => { const a = act(id); return a && !(a.armed || []).length && (!a.region || !a.holding || a.elapsed > a.region.end); }, 6000) && await until(() => act(id) && !act(id)!.holding, 6000), act(id));

  // 3. mark this place; a marker's button skips there, at once and on the bar
  const before = (cueOf(id).markers || []).length, m0 = act(id)!.elapsed;
  await click('.playing [data-mark-here]');
  // (the place is the engine's, not the one the page last drew)
  check('“+ here” keeps a marker where the track is, and gives it a button', await until(() => { const m = cueOf(id).markers || []; return m.length === before + 1 && m.some((x) => x.at >= m0 - 0.02 && x.at < m0 + 0.8); }, 3000) && await until(() => has('.playing [data-marker]'), 2000), cueOf(id).markers);
  host.cmd({ op: 'edit', ops: [{ op: 'cue.set', id, props: { markers: [{ at: 40.2, name: 'Later' }] } }], label: 'a marker' });
  await until(() => page(`(document.querySelector('.playing [data-marker]') || {}).textContent === 'Later'`), 3000);
  await click('.playing [data-marker]');
  check('a marker’s button skips there at once', await until(() => { const a = act(id); return a && a.elapsed >= 40.2 && a.elapsed < 41.2; }, 3000), act(id) && act(id)!.elapsed);
  host.cmd({ op: 'seek', id, t: 8.6 });
  await sleep(250);
  await page(`(() => { const c = document.querySelector('.playing [data-on-bar]'); if (!c.checked) c.click(); })()`);
  await until(() => page(`document.querySelector('.playing [data-on-bar]').checked`), 2000);
  host.cmd({ op: 'prepare', id });
  await until(() => act(id) && act(id)!.exact, 6000);
  // where it will leave from: the track's next bar line at least 0.28 s ahead (bar lines are 2 s apart from `first`)
  const p0 = act(id)!.elapsed, t0 = Date.now();
  let line = first + Math.ceil((p0 + 0.28 - first) / 2) * 2;
  await click('.playing [data-marker]');
  check('with “on the bar” ticked the strip says the move is waiting for the bar', await until(() => has('.playing [data-going]'), 1000) && act(id)!.elapsed < 12);
  const landed = await until(() => act(id) && act(id)!.elapsed > 39, 5000);
  const e1 = act(id)!.elapsed, t1 = Date.now();
  // (it lands on the bar line nearest the marker, 40.25, as the track reaches its own line: so from then on it is
  // exactly 40.25 − line ahead of where it would have been. Tolerance 80 ms: the two clocks read 60 ms apart.)
  const off = e1 - (p0 + (t1 - t0) / 1000) - (first + Math.round((40.2 - first) / 2) * 2 - line);
  check('…and it leaves on the track’s next bar line and lands on the bar nearest the marker (within 80 ms)', landed && Math.abs(off) < 0.08, { p0, line, e1, off });

  // 4. a group with Quantise "bar": its GO lands on the playing track's bar line
  host.cmd({ op: 'edit', ops: [{ op: 'cue.add', cue: { type: 'group', name: 'On the bar', onBeat: 'bar', children: [] }, ref: 'g' }], label: 'a group' });
  const grp = host.document.doc.lists[0].cues.find((c) => c.type === 'group')!;
  host.cmd({ op: 'edit', ops: [{ op: 'cue.move', ids: [hit], parent: grp.id }], label: 'into the group' });
  check('(a group holds the hit, with Quantise on the bar)', (cueOf(grp.id).children || []).some((c) => c.id === hit) && cueOf(grp.id).onBeat === 'bar', cueOf(grp.id));
  host.cmd({ op: 'seek', id, t: 12.9 });
  await sleep(300);
  host.cmd({ op: 'playhead', id: grp.id });
  const went = host.cmd({ op: 'go' });
  const waited = !act(hit) && !(went && went.ignored);
  const began = await until(() => act(hit), 4000);
  // (the hit's own clock against the track's: when the hit was at 0 the track was at `at`, which is to be a bar line)
  const h = act(hit)!, k = act(id)!;
  const at = k.elapsed - h.elapsed, phase = ((at - first) % 2 + 2) % 2, miss = Math.min(phase, 2 - phase);
  check('a GO on a group quantised to the bar waits, and starts its sound on the playing track’s bar line (within 60 ms)', waited && began && miss < 0.06 && at > 13, { at, miss, waited });

  // 5. the tempo corrected where it was found: Time & Loops ▸ Tempo
  host.cmd({ op: 'stop', id: hit });
  await page(`(() => { const r = [...document.querySelectorAll('.list tbody tr')].find((x) => /Steady/.test(x.textContent)); r.scrollIntoView(); r.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); r.click(); })()`);
  await until(() => page(`[...document.querySelectorAll('.inspector .tabs button')].some((b) => b.textContent === 'Time & Loops')`), 3000);
  await page(`[...document.querySelectorAll('.inspector .tabs button')].find((b) => b.textContent === 'Time & Loops').click()`);
  check('Time & Loops has the tools to correct a found tempo, and bar lines on its waveform', await until(() => page(`!!document.querySelector('.inspector [data-tempofix] [data-one]') && document.querySelectorAll('.inspector .wavedit .barline').length > 5`), 3000));
  await click('.inspector [data-tempofix] [data-double]');
  const doubled = await until(() => Math.abs(cueOf(id).tempo!.bpm - 240) < 0.1, 2000) && await until(() => page(`document.querySelector('.inspector [data-tempofix] .bpmfield').value === '240.00'`), 2000);
  await click('.inspector [data-tempofix] [data-half]');
  check('×2 and ÷2 double and halve it', doubled && await until(() => Math.abs(cueOf(id).tempo!.bpm - 120) < 0.1, 2000), cueOf(id).tempo);
  await until(() => page(`document.querySelector('.inspector [data-tempofix] .bpmfield').value === '120.00'`), 2000);
  await page(`(() => { const sel = document.querySelector('.inspector [data-tempofix] .barsel'); sel.value = '3'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check('beats in a bar are set there', await until(() => cueOf(id).tempo!.bar === 3, 2000), cueOf(id).tempo);
  await page(`(() => { const sel = document.querySelector('.inspector [data-tempofix] .barsel'); sel.value = '4'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until(() => cueOf(id).tempo!.bar === 4 && page(`document.querySelector('.inspector [data-tempofix] .barsel').value === '4'`), 2000);
  host.cmd({ op: 'seek', id, t: 21.3 });        // (bar lines were at 0.25, 2.25, …: the beat it is at is 21.25 or, a moment later, 21.75)
  await sleep(250);
  await click('.inspector [data-tempofix] [data-one]');
  check('“1 is here” puts beat one of a bar on the beat the sound is at', await until(() => { const ph = ((cueOf(id).tempo!.first % 2) + 2) % 2; return Math.abs(ph - 1.25) < 0.03 || Math.abs(ph - 1.75) < 0.03; }, 2000), cueOf(id).tempo);
  // a change of tempo, added where the sound is and taken away again (its sections are the cue list's own)
  await click('.inspector [data-tempofix] [data-split]');
  check('“+ Change here” adds a change of tempo where the sound is', await until(() => (cueOf(id).tempo!.sections || []).length === 1, 2000), cueOf(id).tempo);
  check('…and “Remove change” is offered there', await until(() => page(`!!document.querySelector('.inspector [data-tempofix] [data-join]')`), 2000));
  await click('.inspector [data-tempofix] [data-join]');
  check('…which takes it away', await until(() => !(cueOf(id).tempo!.sections || []).length, 2000), cueOf(id).tempo);
  await shot('21-rescue-tempo-fix');

  // the strip in a narrow window: nothing runs off its edge
  win.setSize(1000, 700);
  await sleep(400);
  check('in a narrow window the Playing strip’s tools wrap inside it', await page(`(() => { const p = document.querySelector('.playing'); if (!p) return false; const r = p.getBoundingClientRect(); return [...p.querySelectorAll('.ptools > *')].every((b) => { const q = b.getBoundingClientRect(); return q.right <= r.right + 1 && q.left >= r.left - 1; }) && p.scrollWidth <= p.clientWidth + 1; })()`));
  await shot('22-rescue-strip-narrow');
  win.setSize(1480, 940);
  await sleep(200);

  // Show mode: steering is running the show (loops, markers); keeping a marker or finding a tempo is an edit
  host.cmd({ op: 'mode', mode: 'show' });
  check('in Show mode the loop buttons work and “+ here” is off', await until(() => page(`(() => { const p = document.querySelector('.playing'); return !!p && p.querySelector('[data-loop-bars="1"]') && !p.querySelector('[data-loop-bars="1"]').disabled && p.querySelector('[data-mark-here]').disabled; })()`), 3000));
  host.cmd({ op: 'mode', mode: 'edit' });
  host.cmd({ op: 'panic', hard: true });
  await sleep(150);

  // Settings ▸ About: the mark and the version
  win.webContents.send('ec-menu', 'settings');
  await until(() => has('.modal nav'), 3000);
  await page(`[...document.querySelectorAll('.modal nav button')].find((b) => b.textContent === 'About').click()`);
  check('Settings ▸ About shows the mark and the version', await until(() => page(`(() => { const i = document.querySelector('.modal .about-mark'), v = document.querySelector('.modal [data-version]'); return !!i && i.complete && i.naturalWidth > 0 && !!v && /^\\d+\\.\\d+\\.\\d+/.test(v.textContent); })()`), 3000));
  await shot('23-about');
  await page(`document.querySelector('.modal .close').click()`);
  await until(() => page(`!document.querySelector('.modal')`), 2000);
}

export { rescue };
