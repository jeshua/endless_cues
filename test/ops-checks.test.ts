/** The checks every edit passes, whoever makes it: the shape of an operation, and the kind of a setting (core/show/ops.js). */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import * as show from '../core/show/show';
import { applyOps, OP_KEYS, settingsTrouble } from '../core/show/ops';
import { ShowDocument } from '../core/show/document';
import { createAssistant } from '../core/assistant/assistant';
import { execute, reference } from '../core/assistant/tools';
import { build } from './helpers';
import type { Op } from '../core/show/ops';
import type { Reply, ToolUseBlock } from '../core/assistant/assistant';
import type { ToolInput } from '../core/assistant/tools';

const base = () => build([
  { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', name: 'Rain', file: 'media/rain.wav' } },
  { op: 'cue.add', ref: 'b', cue: { type: 'memo', number: '2' } },
]).doc;
/** (the operations are of the wrong shape on purpose: what is checked is that they are refused) */
const refused = (ops: unknown[], re: RegExp) => assert.throws(() => applyOps(base(), ops as Op[]), (err: Error) => err.name === 'OpError' && re.test(err.message), JSON.stringify(ops));

test('an operation of the wrong shape is refused by applyOps itself, with what to send instead', () => {
  refused([{ op: 'cue.move', ids: ['#1'], to: '#2' }], /op 1 \(cue\.move\): “to” is not something a cue\.move takes \(it takes: ids, id, after, before, parent, list\)/);
  refused([{ op: 'cue.move', ids: ['#1'] }], /say where to: "before" or "after" a cue, "parent" \(a group\) or "list"/);
  refused([{ op: 'cue.move', ids: ['#1'], before: '#2', after: '#2' }], /say where once: after and before were both given/);
  refused([{ op: 'cue.set', id: '#1', gainDb: -6 }], /“gainDb” is not something a cue\.set takes/);
  refused([{ op: 'cue.set', id: '#1' }], /"props" is required/);
  refused([{ op: 'cue.set', id: '#1', props: {} }], /"props" is required/);
  refused([{ op: 'cue.add' }], /"cue" is required/);
  refused([{ op: 'cue.renumber', ids: [] }], /"ids" is required/);
  refused([{ op: 'cue.renumber', ids: ['#1'], start: 'A' }], /"start" is a number/);
  refused([{ op: 'show.set', path: 'settings.go.panicFade' }], /"value" is required/);
  refused([{ op: 'cue.explode', id: '#1' }], /unknown operation \(the operations are cue\.add, /);
  refused([null], /op 1: not an operation/);
  refused([{ op: 'cue.set', id: '#2', props: { name: 'ok' } }, { op: 'cue.move', id: '#1' }], /^op 2 \(cue\.move\)/);
  // every operation the switch knows is in the table the reference is written from
  for (const op of Object.keys(OP_KEYS)) assert.ok(reference().includes(`"${op}"`), op);
});

test('a setting of the wrong kind is refused; one that was already wrong is not this edit’s to answer for', () => {
  refused([{ op: 'show.set', path: 'settings.go.panicFade', value: 'slow' }], /settings\.go\.panicFade is a number \(it was given "slow"\)/);
  refused([{ op: 'show.set', path: 'settings.go', value: 3 }], /settings\.go cannot be replaced by 3/);
  refused([{ op: 'show.set', path: 'settings.audio', value: 3 }], /that would leave the show unreadable/);
  refused([{ op: 'show.set', path: 'settings.audio.buses', value: [] }], /a show keeps at least one bus/);
  refused([{ op: 'show.set', path: 'settings.audio.buses', value: 'music' }], /is a list/);
  refused([{ op: 'show.set', path: 'settings.network.patches', value: [{ id: 'desk', name: 'Desk', host: '10.0.0.5', port: 'eight thousand' }] }], /a patch needs a "port"/);
  refused([{ op: 'show.set', path: 'settings.audio.buses.drums.db', value: -3 }], /no bus with the id “drums” \(the show has: music, effects, vocals\)/);
  // a bus named by its id in the path, and one made earlier in the same batch
  const r = applyOps(base(), [
    { op: 'show.set', path: 'settings.audio.buses', value: [...show.defaultSettings().audio.buses, { id: 'drums', name: 'Drums', db: 0 }] },
    { op: 'show.set', path: 'settings.audio.buses.drums.db', value: -3 },
    { op: 'show.set', path: 'settings.audio.buses.music.out', value: 3 },
  ]);
  assert.deepEqual(r.doc.settings.audio.buses.map((b) => [b.id, b.db, b.out]), [['music', 0, 3], ['effects', 0, undefined], ['vocals', 0, undefined], ['drums', -3, undefined]]);
  assert.deepEqual(settingsTrouble(r.doc), []);
  // a show that arrives with something wrong (written by hand) can still be edited
  const odd = base(); odd.settings.go.panicFade = 'slow' as unknown as number;
  assert.equal(applyOps(odd, [{ op: 'cue.set', id: '#1', props: { gainDb: -3 } }]).doc.lists[0].cues[0].gainDb, -3);
});

test('the assistant’s refusals are the same sentences, and the open show and the command line get them too', () => {
  const d = new ShowDocument({ doc: base() });
  const r = execute('edit_show', { ops: [{ op: 'cue.move', ids: ['#1'], to: '#2' }] } as unknown as ToolInput, { document: d });
  assert.equal(r.is_error, true);
  assert.match(r.content, /^Refused, nothing applied\. op 1 \(cue\.move\): “to” is not something a cue\.move takes/);
  assert.throws(() => d.edit([{ op: 'show.set', path: 'settings.network.inputPort', value: 'fifty' }]), /inputPort is a number/);
  assert.equal(d.dirty, false);

  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-apply-')), 'T.ecshow');
  const saved = ShowDocument.open(dir); saved.edit([{ op: 'cue.add', cue: { type: 'memo', number: '1', name: 'Was' } }]); saved.save();
  const ec = path.join(__dirname, '..', 'bin', 'ec.js');
  const bad = spawnSync(process.execPath, [ec, 'apply', dir, '-'], { input: JSON.stringify([{ op: 'cue.set', id: '#1', name: 'Now' }]), encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Refused, nothing applied\. op 1 \(cue\.set\): “name” is not something a cue\.set takes/);
  const ops = path.join(path.dirname(dir), 'ops.json');
  fs.writeFileSync(ops, JSON.stringify([{ op: 'cue.set', id: '#1', props: { name: 'Now' } }]));
  const out = execFileSync(process.execPath, [ec, 'apply', dir, ops, 'renamed from the command line'], { encoding: 'utf8' });
  assert.match(out, /Saved as v2: renamed from the command line/);
  assert.equal(ShowDocument.open(dir).doc.lists[0].cues[0].name, 'Now');
});

test('a turn that fails after replacing a waiting proposal puts the waiting one back', async () => {
  const d = new ShowDocument({ doc: base() });
  const first = d.propose([{ op: 'cue.set', id: '#1', props: { gainDb: -9 } }], { summary: 'Rain down' });
  const use = (id: string, name: string, input: unknown): ToolUseBlock => ({ type: 'tool_use', id, name, input });
  // the turn stages a new proposal (which takes the first one's place), then the provider fails
  const replies: (Omit<Reply, 'role'> | Error)[] = [{ stop_reason: 'tool_use', content: [use('t1', 'propose_changes', { summary: 'Rename', ops: [{ op: 'cue.set', id: '#2', props: { name: 'Interval' } }] })] }, new Error('network down')];
  const a = createAssistant({ provider: { name: 'scripted', async create() { const r = replies.shift(); if (r instanceof Error) throw r; return r as Reply; } } });
  const r = await a.ask('rename cue 2', { document: d });
  assert.match(r.error!, /network down/);
  assert.ok(d.proposal, 'something is still waiting for review');
  assert.equal(d.proposal.id, first.id, 'and it is the change that was waiting before the turn');
  assert.equal(d.accept(first.id).changed, true);
  assert.equal(d.doc.lists[0].cues[0].gainDb, -9);

  // a person's own "no" still clears the review; and a displaced proposal that no longer fits the show is not brought back
  const e = new ShowDocument({ doc: base() });
  e.propose([{ op: 'cue.set', id: '#1', props: { gainDb: -9 } }]);
  const second = e.propose([{ op: 'cue.set', id: '#1', props: { gainDb: -3 } }]);
  e.edit([{ op: 'cue.set', id: '#2', props: { name: 'changed meanwhile' } }]);
  assert.equal(e.withdraw(second.id), true);
  assert.equal(e.proposal, null);
  e.propose([{ op: 'cue.set', id: '#1', props: { gainDb: -9 } }]); e.propose([{ op: 'cue.set', id: '#1', props: { gainDb: -3 } }]);
  assert.equal(e.reject(), true);
  assert.equal(e.proposal, null);
  assert.equal(e.withdraw(), false);
});
