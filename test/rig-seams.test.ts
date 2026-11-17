// Where the rig's core, the assistant and the pages meet: things each side could only assume of the others.
import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as show from '../core/show/show';
import * as check from '../core/rig/check';
import * as starters from '../core/assistant/starters';
import { helperProvider, LIST } from '../core/assistant/helper';
import * as kit from '../core/kit/kit';
import { build } from './helpers';
import type { CheckFacts } from '../core/rig/check';
import type { FolderEntry } from '../core/assistant/starters';
import type { ToolContext } from '../core/assistant/tools';
import type { Call } from '../core/assistant/assistant';
import type { ShowDocument } from '../core/show/document';
import type { ShowDoc } from '../core/show/types';

const RIG_PAGE = fs.readFileSync(path.join(__dirname, '../app/renderer/Rig.ts'), 'utf8');

test('every button the check gives a row is one the Rig page carries out', () => {
  // a show that has every kind of row, with every row in the state that has a button
  const { doc } = build([
    { op: 'cue.add', cue: { type: 'audio', file: 'gone.wav' } },
    { op: 'cue.add', cue: { type: 'video', file: 'film.webm' } },
    { op: 'cue.add', cue: { type: 'fade' } },                                   // broken: no target
    { op: 'show.set', path: 'settings.network.patches', value: [{ id: 'desk', name: 'Desk', host: '10.0.0.20', port: 8000, protocol: 'udp', device: 'etc-eos' }] },
    { op: 'cue.add', cue: { type: 'network', patch: 'desk', message: '/eos/ping' } },
    { op: 'device.add', device: { id: 'lantern', name: 'Lantern', model: 'ec-prop-light', host: '10.0.0.42' } },
    { op: 'show.set', path: 'settings.rig.checks', value: [{ id: 'k1', text: 'Batteries' }] },
    { op: 'show.set', path: 'settings.light', value: { ...show.defaultSettings().light, on: true, instruments: [{ name: '1', fixture: 'dimmer', universe: 1, address: 1 }] } },
  ]);
  const overrides = [{ id: 'osc', label: 'OSC out', on: true }, { id: 'dmx', label: 'DMX out', on: true }];
  const states = [
    { saved: { untitled: true, dirty: false, changes: 0 }, files: { total: 2, missing: ['gone.wav'] }, stage: { open: false }, light: { held: true }, overrides, liveness: {}, ticks: {} },
    { saved: { untitled: false, dirty: true, changes: 2 }, files: { total: 2, missing: [] }, stage: { open: true, label: 'Display 2' }, light: {}, overrides: [], liveness: { lantern: { state: 'problem', text: 'not answering' } }, ticks: { k1: true } },
  ] as unknown as CheckFacts[];      // (invented: only as much of each as the rows read)
  const seen = new Set<string>();
  for (const facts of states) for (const item of check.items(doc, facts)) for (const a of item.actions || []) {
    seen.add(a.id);
    // the page sends the host's own command when there is one; the rest need the window, and are known to it by id
    const byId = new RegExp(`id === '${a.id}'`).test(RIG_PAGE);
    assert.ok(a.cmd || byId, `${item.id}: “${a.label}” (${a.id}) has no command and the page does not know it`);
    if (a.id === 'select') assert.ok(a.cue, 'Show it names the cue to show');
    if (a.id === 'make-device') assert.equal(a.cmd!.op, 'edit');
  }
  for (const id of ['save', 'select', 'relink', 'stage-open', 'stage-pattern', 'let-go-dmx', 'let-go-osc', 'ask', 'try', 'make-device', 'tick']) assert.ok(seen.has(id), `${id} was among the buttons`);
  // and the groups are the ones the page has titles for
  for (const g of Object.keys(check.GROUPS)) assert.match(RIG_PAGE, new RegExp(`\\['${g}', '`), `the page has the group ${g}`);
});

test('every ask the first screen offers the built-in helper is a job the helper does', async () => {
  const ctxOf = (doc: ShowDoc): ToolContext => ({ document: { doc, showDir: null } as ShowDocument, draft: null, engine: null, found: [] });
  const listing = (names: string[]): FolderEntry[] => names.map((p) => ({ path: p, kind: /\.wav$/.test(p) ? 'sound' : 'text', bytes: 1, usedBy: [] }));
  const shows = {
    empty: { doc: show.newShow('T') },
    folder: { doc: show.newShow('T'), showDir: '/x', folder: listing(['01 a.wav', '02 b.wav']) },
    cues: { doc: build([{ op: 'cue.add', cue: { type: 'memo', number: '3' } }, { op: 'cue.add', cue: { type: 'memo', number: '1' } }, { op: 'cue.add', cue: { type: 'memo', number: '1' } }]).doc, showDir: '/x', folder: listing(['a.wav']) },
    devices: { doc: build([{ op: 'device.add', device: { id: 'lantern', name: 'Lantern', model: 'ec-prop-light', host: '10.0.0.42' } }]).doc, showDir: '/x', folder: [], rig: { devices: { lantern: { state: 'problem' } } } },
    imported: { doc: { ...build([{ op: 'show.set', path: 'settings.network.patches', value: [{ id: 'eos', name: 'Eos', host: '10.0.0.20', port: 8000, protocol: 'udp', device: 'etc-eos' }] }]).doc, notes: 'Imported from the QLab workspace x\nA thing did not come across' } },
  };
  let asked = 0;
  for (const [name, input] of Object.entries(shows)) {
    const first = starters.first({ ...input, provider: 'demo' });
    assert.equal(first.state, name);
    for (const ask of first.asks) {
      assert.equal(ask.offline, true, `${name}: “${ask.label}” is offered to the helper, so the helper can do it`);
      const r = await helperProvider().create!({ messages: [{ role: 'user', content: ask.text }], ctx: ctxOf(input.doc) } as Call);      // (the helper reads only the messages and the show)
      const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      assert.notEqual(text, LIST, `${name}: “${ask.label}” (sent as “${ask.text}”) is understood`);
      asked++;
    }
  }
  assert.ok(asked >= 9, `asks tried: ${asked}`);
});

test('the Write firmware form draws from the kit’s table: every option has what the form needs', () => {
  for (const f of kit.OPTIONS) {
    assert.ok(f.key && f.label && f.kind, `${f.key} has a label and a kind`);
    assert.ok(['enum', 'integer', 'text', 'look'].includes(f.kind), `${f.key}: the form knows the kind ${f.kind}`);
    if (f.kind === 'enum') assert.ok(Array.isArray(f.options) && f.options.includes(f.default as string));
    if (f.only) assert.ok(['light', 'switch'].includes(f.only));
  }
  assert.equal(kit.OPTIONS[0].key, 'sketch');
});

test('invented states can be laid over the window only in a test run (by reading: the app as a person starts it never has window.ecFixture)', () => {
  const main = fs.readFileSync(path.join(__dirname, '../app/main/main.ts'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../app/renderer/app.ts'), 'utf8');
  assert.match(main, /const TEST = SMOKE \|\| !!DRIVE;/);
  assert.match(main, /\n\s*fixtures: TEST,/, 'ec.init() says fixtures only in a smoke run or a driven session');
  assert.equal((page.match(/window\.ecFixture\s*=/g) || []).length, 1);
  assert.match(page, /if \(i\.fixtures\) window\.ecFixture = /, 'and the page makes the door only when told so');
});
