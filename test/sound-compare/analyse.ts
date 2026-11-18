/**
 * The sound comparison's measure (docs/internal/sound-compare.md): the recordings qlab.ts and ec.ts made of each
 * scene, read the same way and set side by side.
 *
 *   node test/sound-compare/analyse.js --dir DIR [scene…]      → a table per scene, and DIR/rec/<scene>/analysis.json
 *
 * Each recording is placed on the wall clock by its .blocks.csv (each buffer's moment as BlackHole's input stamped it),
 * so a time here is seconds from the moment the scene's first step was sent. Each tone of the scene is followed on
 * each channel by its amplitude over 5 ms (240 frames, a whole number of cycles of every tone: see signals.ts), every
 * millisecond. From that:
 *   segments   each stretch a tone sounds: where it starts and stops (the moment it crosses half its level, which for
 *              a sound that starts at once is the moment it starts) and its level on each output, in dB of the file's
 *   traces     a tone's level every 10 ms over a stretch the scene names (a fade, a duck), and the fade found in it:
 *              where it starts and ends, and its shape (how far along, in dB, at each tenth of its time)
 */
import * as fs from 'fs';
import * as path from 'path';
import { readWav, AMP } from './signals';
import { SCENES } from './scenes';
import type { Scene } from './scenes';

const WIN = 240, HOP = 48;
export const ENGINES = ['qlab', 'webaudio', 'native'] as const;
type Engine = typeof ENGINES[number];

export interface Seg { tone: string; on: number; off: number; gone: number; L: number; R: number }
export interface Trace { tone: string; from: number; to: number; db: number[]; fade: Fade | null }
export interface Fade { start: number; end: number; fromDb: number; toDb: number; at: number[] }
export interface Run { engine: Engine; steps: number[]; segs: Seg[]; traces: Trace[]; envelope: (tone: string, ch: 0 | 1, t: number) => number }

const db = (a: number) => (a > 1e-9 ? 20 * Math.log10(a / AMP) : -180);

/** One recording read: its tones' envelopes, placed on the scene's clock. */
export function read(dir: string, scene: Scene, engine: Engine): Run | null {
  const wav = path.join(dir, `${engine}.wav`), info = path.join(dir, `${engine}.json`);
  if (!fs.existsSync(wav) || !fs.existsSync(info)) return null;
  const { rate, channels, data } = readWav(wav);
  const steps = (JSON.parse(fs.readFileSync(info, 'utf8')).steps as { at: number }[]).map((s) => s.at);
  // the wall clock of each frame: a straight line through every buffer's stamp
  const csv = fs.readFileSync(wav.replace(/\.wav$/, '.blocks.csv'), 'utf8').split('\n');
  const zero = Number((/zero_ns_is_wall_ms=([\d.]+)/.exec(csv[0]) || [])[1]);
  const pts = csv.slice(2).filter(Boolean).map((l) => l.split(',').map(Number)).filter((p) => p[0] === 0).map((p) => [p[1], zero + p[4] / 1e6]);
  const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const slope = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  const t0 = steps[0];
  const timeOf = (frame: number) => (my + (frame - mx) * slope - t0) / 1000;
  const frames = Math.floor(data.length / channels);
  const hops = Math.floor((frames - WIN) / HOP);
  const env: Record<string, Float32Array[]> = {};
  for (const [name, f] of Object.entries(scene.tones)) {
    const c = new Float64Array(WIN), s = new Float64Array(WIN);
    for (let i = 0; i < WIN; i++) { c[i] = Math.cos((2 * Math.PI * f * i) / rate); s[i] = Math.sin((2 * Math.PI * f * i) / rate); }
    env[name] = [0, 1].map((ch) => {
      const out = new Float32Array(hops);
      for (let h = 0; h < hops; h++) {
        let re = 0, im = 0;
        const base = h * HOP * channels + Math.min(ch, channels - 1);
        for (let i = 0; i < WIN; i++) { const x = data[base + i * channels]; re += x * c[i]; im += x * s[i]; }
        out[h] = (2 * Math.sqrt(re * re + im * im)) / WIN;
      }
      return out;
    });
  }
  // (a hop's amplitude is stamped at its window's middle)
  const tOf = (h: number) => timeOf(h * HOP + WIN / 2);
  const hAt = (t: number) => Math.max(0, Math.min(hops - 1, Math.round(((t * 1000 + t0 - my) / slope + mx - WIN / 2) / HOP)));
  const envelope = (tone: string, ch: 0 | 1, t: number) => db(env[tone][ch][hAt(t)]);

  const segs: Seg[] = [];
  const floor = AMP * 10 ** (-50 / 20);
  for (const tone of Object.keys(scene.tones)) {
    const [l, r] = env[tone];
    const m = (h: number) => Math.max(l[h], r[h]);
    let h = 0;
    while (h < hops) {
      if (m(h) < floor) { h++; continue; }
      let e = h, quiet = 0;
      while (e < hops && quiet < 4) { quiet = m(e) < floor ? quiet + 1 : 0; e++; }
      e -= quiet;
      // (shorter than 15 ms is not a sound of the scene's: a window half over another tone's start leaks a little)
      if (e - h >= 15) {
        // its level: the median from 20 to 120 ms in (or what there is of it)
        const a = Math.min(e - 1, h + 20), b = Math.max(a + 1, Math.min(e - 10, h + 120));
        const med = (x: Float32Array) => { const v = Array.from(x.slice(a, b)).sort((p, q) => p - q); return v[Math.floor(v.length / 2)]; };
        const L = med(l), R = med(r), top = Math.max(L, R);
        let on = h; while (on < e && m(on) < top / 2) on++;
        const tail = Math.max(h, e - 30);
        const before = Math.max(l[tail], r[tail]);
        let off = e - 1; while (off > on && m(off) < before / 2) off--;
        segs.push({ tone, on: tOf(on), off: tOf(off), gone: tOf(e), L: db(L), R: db(R) });
      }
      h = e + 1;
    }
  }
  segs.sort((p, q) => p.on - q.on);
  const traces: Trace[] = (scene.traces || []).map(([tone, from, to]) => {
    const pts: number[] = [];
    for (let t = from; t <= to + 1e-9; t += 0.01) pts.push(Math.round(Math.max(envelope(tone, 0, t), envelope(tone, 1, t)) * 100) / 100);
    return { tone, from, to, db: pts, fade: fadeIn(tone, from, to) };
  });
  /** The fade in a stretch: from where the level leaves where it was to where it settles. */
  function fadeIn(tone: string, from: number, to: number): Fade | null {
    const lv = (t: number) => Math.max(envelope(tone, 0, t), envelope(tone, 1, t));
    const h0 = hAt(from), h1 = hAt(to);
    const at = (h: number) => Math.max(db(env[tone][0][h]), db(env[tone][1][h]));
    const first = at(h0 + 5), last = at(h1 - 5);
    if (Math.abs(first - last) < 1) return null;
    const down = last < first;
    // (settled: within 0.2 dB of where it was, or of where it ends; an end at silence is −50 dB)
    const endDb = Math.max(last, -50);
    let s = h0 + 5; while (s < h1 && Math.abs(at(s) - first) < 0.2) s++;
    let e = h1 - 5; while (e > s && (down ? at(e) <= endDb + 0.2 : at(e) >= endDb - 0.2)) e--;
    const start = tOf(s), end = tOf(e);
    const tenths = Array.from({ length: 11 }, (_, k) => Math.round(((lv(start + ((end - start) * k) / 10) - first) / (endDb - first)) * 1000) / 1000);
    return { start, end, fromDb: Math.round(first * 100) / 100, toDb: Math.round(endDb * 100) / 100, at: tenths };
  }
  return { engine, steps: steps.map((s) => (s - t0) / 1000), segs, traces, envelope };
}

const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '—');
const f1 = (x: number) => (x <= -49 ? 'off' : x.toFixed(2));

/** A scene's runs side by side: each segment of QLab's beside the same tone's next segment in each other run. */
export function compare(scene: Scene, runs: Run[]) {
  const lines: string[] = [];
  lines.push(`## ${scene.id}: ${scene.what}`);
  lines.push(`steps sent at (s): ${runs.map((r) => `${r.engine} ${r.steps.map((s) => s.toFixed(3)).join(' ')}`).join(' | ')}`);
  const head = ['tone', ...runs.flatMap((r) => [`${r.engine} on`, 'off', 'L dB', 'R dB'])];
  lines.push(head.join('\t'));
  const used = runs.map(() => new Set<number>());
  const base = runs[0];
  const rows: Record<string, unknown>[] = [];
  for (const sg of base.segs) {
    const row: (string)[] = [sg.tone];
    const rec: Record<string, unknown> = { tone: sg.tone };
    runs.forEach((r, k) => {
      // (the same tone's segment nearest in time, within half a second, not yet taken)
      let best = -1;
      r.segs.forEach((x, i) => { if (x.tone === sg.tone && !used[k].has(i) && Math.abs(x.on - sg.on) < 0.5 && (best < 0 || Math.abs(x.on - sg.on) < Math.abs(r.segs[best].on - sg.on))) best = i; });
      if (best < 0) { row.push('—', '—', '—', '—'); return; }
      used[k].add(best);
      const x = r.segs[best];
      row.push(f3(x.on), f3(x.off), f1(x.L), f1(x.R));
      rec[r.engine] = x;
    });
    // (how late each run is, in ms, against when the workspace says it should start)
    const nom = (scene.nominal || []).filter(([t, at]) => t === sg.tone && Math.abs(at - sg.on) < 0.3).sort((p, q) => Math.abs(p[1] - sg.on) - Math.abs(q[1] - sg.on))[0];
    if (nom) { row.push(`nominal ${nom[1].toFixed(2)}: late ${runs.map((r) => (rec[r.engine] ? `${Math.round(((rec[r.engine] as Seg).on - nom[1]) * 1000)}` : '—')).join(' / ')} ms`); rec.nominal = nom[1]; }
    lines.push(row.join('\t'));
    rows.push(rec);
  }
  runs.forEach((r, k) => r.segs.forEach((x, i) => { if (!used[k].has(i)) { lines.push(`only in ${r.engine}: ${x.tone} ${f3(x.on)}–${f3(x.off)} L ${f1(x.L)} R ${f1(x.R)}`); rows.push({ tone: x.tone, only: r.engine, [r.engine]: x }); } }));
  (scene.traces || []).forEach((_, i) => {
    for (const r of runs) {
      const t = r.traces[i];
      if (!t) continue;
      const fd = t.fade;
      lines.push(`trace ${t.tone} ${t.from.toFixed(2)}–${t.to.toFixed(2)} ${r.engine}: ${fd ? `fade ${f3(fd.start)}–${f3(fd.end)} (${(fd.end - fd.start).toFixed(3)} s) ${fd.fromDb} → ${fd.toDb} dB; along at tenths ${fd.at.join(' ')}` : 'no one fade'}`);
      lines.push(`  every 0.1 s: ${t.db.filter((_, k) => k % 10 === 0).map((x) => x.toFixed(1)).join(' ')}`);
    }
  });
  return { lines, rows };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--dir');
  const dir = path.resolve(args[i + 1]);
  const wanted = args.filter((a, k) => !a.startsWith('--') && k !== i + 1);
  for (const s of SCENES.filter((x) => !wanted.length || wanted.includes(x.id))) {
    const d = path.join(dir, 'rec', s.id);
    const runs = ENGINES.map((e) => read(d, s, e)).filter((r): r is Run => !!r);
    if (!runs.length) continue;
    const { lines, rows } = compare(s, runs);
    console.log(`${lines.join('\n')}\n`);
    fs.writeFileSync(path.join(d, 'analysis.json'), JSON.stringify({ scene: s.id, rows, traces: runs.map((r) => ({ engine: r.engine, traces: r.traces })) }, null, 1));
  }
}
