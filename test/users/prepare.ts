#!/usr/bin/env node
/**
 * Sets up a run of the virtual users (test/users/README.md).
 *
 *   node test/users/prepare.js [run] [person…]      run: a name for it (default: today's date)
 *
 * Makes test/users/runs/<run>/<person>/ for each person: their desk (the files of their show) and BRIEF.md,
 * which is everything an agent needs to be that person. Then give each brief to an agent, and afterwards run
 * collect.ts on the same run.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DESKS } from './materials';
import { siteDir } from '../../bin/site-dir';

const REPO = path.join(__dirname, '../..');
const NET = new Set(['theo', 'june']);  // whose session opens real network ports (june's talks to a stand-in prop on 53100)

function people() { return fs.readdirSync(path.join(__dirname, 'people')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort(); }

function prepare(run: string, ids = people()) {
  const help = fs.readFileSync(path.join(REPO, 'bin/ec-user.js'), 'utf8').split('*/')[0].split('\n').slice(4).map((l) => l.replace(/^ \* ?/, '')).join('\n')
    .replace(/ec-user <session>/g, 'ec-user <session>').trim();
  const out: { id: string; session: string; brief: string; net: boolean }[] = [];
  for (const id of ids) {
    if (!DESKS[id]) throw new Error(`no desk is defined for ${id} (materials.js)`);
    const session = path.join(__dirname, 'runs', run, id);
    if (fs.existsSync(path.join(session, 'journal.jsonl'))) throw new Error(`${session} has already been used: choose another run name`);
    fs.rmSync(session, { recursive: true, force: true });
    fs.mkdirSync(path.join(session, 'desk'), { recursive: true });
    DESKS[id](path.join(session, 'desk'));
    const fill = (text: string) => text.replace(/\{\{MANUAL\}\}/g, path.join(siteDir(), 'docs/index.html')).replace(/\{\{REPO\}\}/g, REPO).replace(/\{\{SESSION\}\}/g, session).replace(/\{\{ID\}\}/g, id)
      .replace(/\{\{START\}\}/g, NET.has(id) ? ' --net' : '').replace(/\{\{HELP\}\}/g, help);
    const brief = `${fs.readFileSync(path.join(__dirname, 'people', `${id}.md`), 'utf8').trim()}\n\nYour session folder is \`${session}\`. Your desk is \`${session}/desk\`.\n\n---\n\n${fill(fs.readFileSync(path.join(__dirname, 'brief.md'), 'utf8'))}`;
    fs.writeFileSync(path.join(session, 'BRIEF.md'), brief);
    out.push({ id, session, brief: path.join(session, 'BRIEF.md'), net: NET.has(id) });
  }
  return out;
}

export { prepare, people, NET };

if (require.main === module) {
  const [run = new Date().toISOString().slice(0, 10), ...ids] = process.argv.slice(2);
  for (const p of prepare(run, ids.length ? ids : undefined)) console.log(`${p.id.padEnd(8)} ${p.brief}${p.net ? '   (opens network ports)' : ''}`);
  console.log(`\nGive each BRIEF.md to an agent ("Read this file and do what it says."). Then: node test/users/collect.js ${run}`);
}
