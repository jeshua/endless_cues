// The virtual users' paperwork: the keys they press, the shape of their reports, the counts made from their journals.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseKey, accelKey } = require('../app/main/drive');
const { check, counts, tasksOf } = require('./users/collect');
const { people } = require('./users/prepare');
const { DESKS } = require('./users/materials');

test('a key as a person names it', () => {
  assert.deepStrictEqual(parseKey('Cmd+Shift+S'), { key: 'S', mods: ['meta', 'shift'] });
  assert.deepStrictEqual(parseKey('esc'), { key: 'Escape', mods: [] });
  assert.deepStrictEqual(parseKey('e'), { key: 'e', mods: [] });
  assert.strictEqual(accelKey('Shift+CmdOrCtrl+O'), accelKey(process.platform === 'darwin' ? 'cmd+shift+o' : 'ctrl+shift+o'));
  assert.notStrictEqual(accelKey('CmdOrCtrl+R'), accelKey('Alt+CmdOrCtrl+R'));
});

test('every person has tasks and a desk', () => {
  assert.ok(people().length >= 4);
  for (const id of people()) { assert.ok(tasksOf(id).length >= 5, id); assert.strictEqual(typeof DESKS[id], 'function', id); }
});

test('a report is checked against the person it is for', () => {
  const id = people()[0];
  const good = { person: id, verdict: 'with-workarounds', verdictWhy: 'It would do.', ratings: { learn: 4, speed: 3, clarity: 4, trust: 2 },
    tasks: tasksOf(id).map((t) => ({ id: t, outcome: 'done', notes: '' })),
    findings: [{ title: 'GO did nothing', severity: 'major', kind: 'bug', area: 'transport', happened: 'Nothing played.', steps: 'Open the demo. Press GO.' }], rig: [] };
  assert.deepStrictEqual(check(good, id), []);
  const bad = JSON.parse(JSON.stringify(good));
  bad.verdict = 'maybe'; bad.tasks.pop(); bad.findings[0].severity = 'huge'; delete bad.findings[0].steps; bad.ratings.trust = 9;
  const said = check(bad, id).join('\n');
  for (const word of ['verdict', 'is not in the report', 'severity', 'a bug with no steps', 'ratings.trust']) assert.match(said, new RegExp(word));
});

test('the counts come from the journal', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-users-')), 'journal.jsonl');
  const at = (s) => new Date(Date.UTC(2026, 0, 1, 12, 0, s)).toISOString();
  fs.writeFileSync(file, [
    { at: at(0), op: 'start' }, { at: at(1), op: 'task', task: 'bring' }, { at: at(2), op: 'look' }, { at: at(3), op: 'click', did: 'clicked' },
    { at: at(4), op: 'key', error: 'A dialog is open' }, { at: at(5), op: 'note', text: 'where is import?' }, { at: at(62), op: 'menu', did: 'chose' },
    { at: at(63), op: 'task', task: 'save' }, { at: at(64), op: 'hear' }, { at: at(65), op: 'type', did: 'typed' },
  ].map((l) => JSON.stringify(l)).join('\n'));
  const c = counts(file);
  assert.deepStrictEqual([c.bring.actions, c.bring.refused, c.bring.looks, c.bring.minutes], [3, 1, 1, 1]);
  assert.deepStrictEqual(c.bring.notes, ['where is import?']);
  assert.strictEqual(c.save.actions, 1);
});
