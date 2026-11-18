#!/usr/bin/env node
/** Counts docs/qlab-tracker.md: per area, how many items are done, partly done and not started. */
import * as fs from 'fs';
import * as path from 'path';

const text = fs.readFileSync(path.join(__dirname, '../docs/qlab-tracker.md'), 'utf8');
interface Stage { name: string; done: number; part: number; todo: number }
const stages: Stage[] = [];
for (const line of text.split('\n')) {
  const h = line.match(/^## (.+)/);
  if (h) { stages.push({ name: h[1], done: 0, part: 0, todo: 0 }); continue; }
  const m = line.match(/^- \[(x|~| )\]/);
  if (m && stages.length) stages[stages.length - 1][({ x: 'done', '~': 'part', ' ': 'todo' } as const)[m[1] as 'x' | '~' | ' ']]++;
}
const all: Stage = { name: 'All', done: 0, part: 0, todo: 0 };
for (const s of stages) for (const k of ['done', 'part', 'todo'] as const) all[k] += s[k];
const w = Math.max(...stages.map((s) => s.name.length));
for (const s of [...stages, all]) {
  const n = s.done + s.part + s.todo;
  console.log(`${s.name.padEnd(w)}  ${String(s.done).padStart(3)} done  ${String(s.part).padStart(3)} partly  ${String(s.todo).padStart(3)} to do  ${n ? Math.round((100 * s.done) / n) : 0}%`);
}
