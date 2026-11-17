#!/usr/bin/env node
/**
 * Gathers a run of the virtual users into one page (test/users/README.md).
 *
 *   node test/users/collect.js <run>
 *
 * Reads each person's report.json and journal.jsonl under test/users/runs/<run>/, checks the reports are in
 * the agreed shape, and writes docs/internal/usability/<run>/: every report as written, findings.json (all of them,
 * worst first) and summary.md. The counts of actions come from the journal, not from what a user says.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.join(__dirname, '../..');
const SEVERITY = ['blocker', 'major', 'minor', 'polish', 'praise'];
const KIND = ['bug', 'missing', 'confusing', 'wording', 'slow', 'praise'];
const AREA = ['import', 'cue-list', 'inspector', 'audio', 'mixer', 'transport', 'network', 'files', 'settings', 'show-mode', 'help', 'other'];
const OUTCOME = ['done', 'done-with-trouble', 'gave-up', 'not-possible', 'not-tried'];
const VERDICT = ['yes', 'with-workarounds', 'no'];
const RATINGS = ['learn', 'speed', 'clarity', 'trust'];
/** What only the hands do: a `look`, a note or a wait is not an action on the app. */
const ACTIONS = new Set(['click', 'drag', 'scroll', 'type', 'key', 'menu', 'answer', 'choose', 'osc send']);

/** The tasks a person was given: the bold ids in their page. */
function tasksOf(id) {
  const text = fs.readFileSync(path.join(__dirname, 'people', `${id}.md`), 'utf8');
  return [...text.matchAll(/^\d+\.\s+\*\*([a-z-]+)\*\*/gm)].map((m) => m[1]);
}

/** What is wrong with a report, as a list of sentences (empty: nothing). */
function check(report, id) {
  const bad = [];
  if (!report || typeof report !== 'object') return ['it is not an object'];
  if (report.person !== id) bad.push(`person is "${report.person}", not "${id}"`);
  if (!VERDICT.includes(report.verdict)) bad.push(`verdict "${report.verdict}" is not one of ${VERDICT.join(', ')}`);
  if (!String(report.verdictWhy || '').trim()) bad.push('verdictWhy is empty');
  for (const r of RATINGS) if (!(Number(report.ratings && report.ratings[r]) >= 1 && Number(report.ratings[r]) <= 5)) bad.push(`ratings.${r} is not 1 to 5`);
  const given = tasksOf(id), seen = (report.tasks || []).map((t) => t.id);
  for (const t of given) if (!seen.includes(t)) bad.push(`task "${t}" is not in the report`);
  for (const t of report.tasks || []) { if (!given.includes(t.id)) bad.push(`task "${t.id}" was not one of theirs`); if (!OUTCOME.includes(t.outcome)) bad.push(`task ${t.id}: outcome "${t.outcome}"`); }
  (report.findings || []).forEach((f, i) => {
    const at = `finding ${i + 1} ("${String(f.title || '').slice(0, 40)}")`;
    if (!String(f.title || '').trim()) bad.push(`${at}: no title`);
    if (!SEVERITY.includes(f.severity)) bad.push(`${at}: severity "${f.severity}"`);
    if (!KIND.includes(f.kind)) bad.push(`${at}: kind "${f.kind}"`);
    if (!AREA.includes(f.area)) bad.push(`${at}: area "${f.area}"`);
    if (!String(f.happened || '').trim()) bad.push(`${at}: does not say what happened`);
    if (f.kind === 'bug' && !String(f.steps || '').trim()) bad.push(`${at}: a bug with no steps`);
  });
  return bad;
}

/** Per task: how many actions, how many of them the app refused, and how long from first to last. */
function counts(journalFile) {
  const out = {};
  let task = '(before any task)';
  let lines = [];
  try { lines = fs.readFileSync(journalFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return out; }
  for (const l of lines) {
    if (l.op === 'task') { task = l.task; continue; }
    const t = out[task] || (out[task] = { actions: 0, refused: 0, looks: 0, notes: [], from: l.at, to: l.at });
    t.to = l.at;
    if (l.op === 'look') t.looks++;
    else if (l.op === 'note') t.notes.push(l.text);
    else if (ACTIONS.has(l.op)) { t.actions++; if (l.error) t.refused++; }
  }
  for (const t of Object.values(out)) t.minutes = Math.round((new Date(t.to) - new Date(t.from)) / 6000) / 10;
  return out;
}

function collect(run) {
  const from = path.join(__dirname, 'runs', run);
  if (!fs.existsSync(from)) throw new Error(`there is no run ${run}`);
  const to = path.join(REPO, 'docs/internal/usability', run);
  fs.mkdirSync(to, { recursive: true });
  const people = [], findings = [], problems = [];
  for (const id of fs.readdirSync(from).sort()) {
    const dir = path.join(from, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    let report = null;
    try { report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')); } catch (err) { problems.push(`${id}: no readable report.json (${err.message})`); }
    const count = counts(path.join(dir, 'journal.jsonl'));
    if (!report) { people.push({ id, report: null, count }); continue; }
    for (const b of check(report, id)) problems.push(`${id}: ${b}`);
    fs.writeFileSync(path.join(to, `${id}.json`), JSON.stringify(report, null, 2) + '\n');
    if (fs.existsSync(path.join(dir, 'report.md'))) fs.copyFileSync(path.join(dir, 'report.md'), path.join(to, `${id}.md`));
    // the pictures a finding points at go with it; the rest stay in the run
    for (const f of report.findings || []) for (const shot of f.evidence || []) {
      const src = path.join(dir, 'shots', path.basename(String(shot)));
      if (fs.existsSync(src)) { fs.mkdirSync(path.join(to, 'shots'), { recursive: true }); fs.copyFileSync(src, path.join(to, 'shots', `${id}-${path.basename(src)}`)); }
    }
    (report.findings || []).forEach((f) => findings.push({ person: id, ...f }));
    people.push({ id, report, count });
  }
  findings.sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity) || AREA.indexOf(a.area) - AREA.indexOf(b.area));
  fs.writeFileSync(path.join(to, 'findings.json'), JSON.stringify(findings, null, 2) + '\n');

  const n = (list, sev) => list.filter((f) => f.severity === sev).length;
  const md = [`# Usability run ${run}`, '',
    'Virtual users, each an agent standing in for a person with a show of their own, using the app through its window (`test/users/README.md`). A virtual user is not a person: read this as a list of things to look at, not as a measure of how usable the app is.', '',
    '## Verdicts', '',
    '| Person | Would run their show on it | Learn | Speed | Clarity | Trust | Blockers | Major | Minor | Polish | Praise | Actions |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const p of people) {
    const all = Object.values(p.count).reduce((s, t) => s + t.actions, 0);
    if (!p.report) { md.push(`| ${p.id} | no report | | | | | | | | | | ${all} |`); continue; }
    const f = p.report.findings || [], r = p.report.ratings || {};
    md.push(`| [${p.id}](${p.id}.md) | ${p.report.verdict} | ${RATINGS.map((k) => r[k] ?? '').join(' | ')} | ${SEVERITY.map((s) => n(f, s)).join(' | ')} | ${all} |`);
  }
  md.push('');
  for (const p of people) if (p.report) md.push(`**${p.id}:** ${p.report.verdictWhy}`, '');
  md.push('## Tasks', '', '| Person | Task | Outcome | Actions | Refused | Minutes | Notes |', '|---|---|---|---|---|---|---|');
  for (const p of people) for (const t of (p.report ? p.report.tasks : []) || []) {
    const c = p.count[t.id] || {};
    md.push(`| ${p.id} | ${t.id} | ${t.outcome} | ${c.actions ?? ''} | ${c.refused || ''} | ${c.minutes ?? ''} | ${String(t.notes || '').replace(/\|/g, '/').replace(/\n/g, ' ')} |`);
  }
  md.push('', '## Findings', '');
  for (const sev of SEVERITY) {
    const list = findings.filter((f) => f.severity === sev);
    if (!list.length) continue;
    md.push(`### ${sev[0].toUpperCase()}${sev.slice(1)} (${list.length})`, '');
    for (const f of list) {
      md.push(`- **${f.title}** (${f.person}, ${f.area}, ${f.kind}${f.task ? `, task ${f.task}` : ''})`);
      if (sev !== 'praise') { if (f.expected) md.push(`  - Expected: ${f.expected}`); md.push(`  - Happened: ${f.happened}`); if (f.steps) md.push(`  - Steps: ${f.steps}`); if (f.suggestion) md.push(`  - Suggestion: ${f.suggestion}`); }
      else md.push(`  - ${f.happened}`);
      if ((f.evidence || []).length) md.push(`  - Pictures: ${f.evidence.map((s) => `[${path.basename(String(s))}](shots/${f.person}-${path.basename(String(s))})`).join(', ')}`);
    }
    md.push('');
  }
  const rig = people.flatMap((p) => ((p.report && p.report.rig) || []).map((r) => `- ${p.id}: ${r}`));
  if (rig.length) md.push('## The test rig got in the way', '', ...rig, '');
  if (problems.length) md.push('## Reports not in the agreed shape', '', ...problems.map((b) => `- ${b}`), '');
  fs.writeFileSync(path.join(to, 'summary.md'), md.join('\n'));
  return { to, people: people.length, findings: findings.length, problems };
}

export { collect, check, counts, tasksOf };

if (require.main === module) {
  const run = process.argv[2];
  if (!run) { console.error('node test/users/collect.js <run>'); process.exit(1); }
  const r = collect(run);
  console.log(`${r.people} people, ${r.findings} findings → ${path.join(r.to, 'summary.md')}`);
  for (const b of r.problems) console.log(`  not in shape: ${b}`);
  process.exit(r.problems.length ? 1 : 0);
}
