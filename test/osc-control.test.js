/**
 * OSC control, as a remote built for QLab meets it: cue properties, the ways of naming a cue, the
 * lists as JSON, a session (passcode, updates). The module is driven as the hub drives it, with a
 * fake host: a real show document and a real engine behind `cmd` and `snapshot`, nothing else.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('dgram');
const osc = require('../core/net/osc');
const show = require('../core/show/show');
const { applyOps } = require('../core/show/ops');
const { rig, build } = require('./helpers');
const oscControl = require('../app/main/modules/osc-control');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A host as the module sees one: `cmd` (the ops it uses), `snapshot`, `showId`. */
function fakeHost(doc) {
  let r = rig(doc), rev = 1, mode = 'edit';
  const cmds = [];
  const idOf = (c) => c.id || (c.number != null ? (show.findByNumber(doc, c.number) || {}).id : null) || null;
  const run = (c) => {
    if ((c.number != null || c.id != null) && ['pause', 'resume', 'toggle', 'stop', 'fire', 'start'].includes(c.op) && !r.engine.byId.has(idOf(c))) return { error: `no cue ${c.number != null ? `numbered ${c.number}` : c.id}` };
    if (mode === 'show' && ['edit', 'undo', 'redo'].includes(c.op)) return { error: 'Show mode: editing is locked' };
    switch (c.op) {
      case 'go': r.engine.go(); break;
      case 'start': r.engine.start(idOf(c)); break;
      case 'fire': r.engine.fire(idOf(c)); break;
      case 'stop': r.engine.stopCue(idOf(c)); break;
      case 'pause': r.engine.pause(idOf(c)); break;
      case 'resume': r.engine.resume(idOf(c)); break;
      case 'toggle': { const id = idOf(c); if (r.engine.isPaused(id)) r.engine.resume(id); else r.engine.pause(id); break; }
      case 'panic': r.engine.panic(); if (c.hard) r.engine.panic(); break;
      case 'fadeall': r.engine.fadeAll(Number(c.secs) || 5); break;
      case 'playhead': r.engine.setPlayhead(c.id); break;
      case 'move': r.engine.movePlayhead(Number(c.step) || 0); break;
      case 'jump': if (!r.engine.jumpTo(c.number)) return { error: `no cue numbered ${c.number}` }; break;
      case 'load': r.engine.loadToTime(Number(c.secs) || 0); return { loaded: r.engine.loaded };
      case 'arm': r.engine.toggleArm(c.id); break;
      case 'mode': mode = c.mode === 'show' ? 'show' : 'edit'; break;
      case 'save': return { needsFolder: true };
      case 'undo': return { error: 'nothing to undo' };
      case 'edit': { doc = applyOps(doc, c.ops).doc; r.engine.load(show.toEngineDoc(doc)); rev++; return { made: [], changed: true }; }
      default: return { error: `unknown command ${c.op}` };
    }
    return null;
  };
  return {
    cmds,
    get doc() { return doc; },
    get engine() { return r.engine; },
    advance: (secs) => r.advance(secs),
    showId: () => doc.id,
    cmd(c) { cmds.push(c); try { return run(c) || { ok: true }; } catch (err) { return { error: err.message }; } },
    snapshot() { const e = r.engine.snapshot(); delete e.cues; delete e.poem; return { rev, doc, engine: e, show: { title: doc.title }, problems: [], mode }; },
  };
}

/** A show with a sequence in it (1 continues into 2), a group, and a second list. */
function aShow() {
  const s = build([
    { op: 'cue.add', ref: 'a', cue: { type: 'wait', number: '1', name: 'House to half', duration: 10, continue: 'auto-continue', notes: 'on the nod' } },
    { op: 'cue.add', ref: 'b', cue: { type: 'wait', number: '2', duration: 4, color: 'red' } },
    { op: 'cue.add', ref: 'g', cue: { type: 'group', number: '10', name: 'Storm', children: [{ type: 'wait', ref: 'g1', number: '10.1', duration: 30 }, { type: 'memo', ref: 'g2', number: '10.2', name: 'Thunder' }] } },
    { op: 'cue.add', ref: 'm', cue: { type: 'memo', name: 'no number' } },
    { op: 'list.add', name: 'Preshow' },
  ]);
  return { ...s, list: s.doc.lists[0].id };
}

/** The module with a sender: `say('/address args')` returns { ret, reply } where reply is the JSON that came back. */
function remote(host, config = {}, opts = {}) {
  const m = oscControl.create({ log() {}, changed() {}, host, ...opts });
  m.start(config);
  const from = (port) => {
    const got = [];
    const send = (address, args = []) => got.push({ address, args: args.map((a) => (a && typeof a === 'object' ? a.value : a)) });
    const say = (text, args) => {
      const msg = args ? { address: text, args } : osc.decode(osc.encode(text));
      const n = got.length;
      const ret = m.onOsc(msg, { address: '10.0.0.9', port }, send);
      const back = got[n] && /^\/reply/.test(got[n].address) ? got[n] : null;
      return { ret, address: back && back.address, reply: back ? JSON.parse(back.args[0]) : null };
    };
    // (a plain command is answered only on request, as in QLab: these tests read every answer)
    if (opts.always !== false) m.onOsc({ address: '/alwaysReply', args: [1] }, { address: '10.0.0.9', port }, () => {});
    return { say, got, ask: (text, args) => say(text, args).reply.data };
  };
  return { m, ...from(5000), from };
}

test('OSC control: a cue’s properties are read by QLab’s names, in QLab’s reply', () => {
  const s = aShow(), host = fakeHost(s.doc), r = remote(host);
  const one = r.say('/cue/1/name');
  assert.equal(one.ret, 'done');
  assert.equal(one.address, '/reply/cue/1/name');
  assert.deepEqual(one.reply, { workspace_id: s.doc.id, address: '/cue/1/name', status: 'ok', data: 'House to half' });
  assert.equal(r.ask('/cue/1/number'), '1');
  assert.equal(r.ask('/cue/1/notes'), 'on the nod');
  assert.equal(r.ask('/cue/1/uniqueID'), s.id('a'));
  assert.equal(r.ask('/cue/1/type'), 'Wait');
  assert.equal(r.ask('/cue/10/type'), 'Group');
  assert.equal(r.ask('/cue/1/duration'), 10);
  assert.equal(r.ask('/cue/1/preWait'), 0);
  assert.equal(r.ask('/cue/1/continueMode'), 1);
  assert.equal(r.ask('/cue/2/continueMode'), 0);
  assert.equal(r.ask('/cue/2/colorName'), 'red');
  assert.equal(r.ask('/cue/1/colorName'), 'none');
  assert.equal(r.ask('/cue/1/armed'), true);
  assert.equal(r.ask('/cue/1/flagged'), false);
  assert.equal(r.ask('/cue/2/name'), '', 'its own name, which it has not');
  assert.equal(r.ask('/cue/2/displayName'), 'wait 4 s', 'what the list shows');
  assert.equal(r.ask('/cue/2/listName'), 'wait 4 s');
  assert.deepEqual(r.ask('/cue/10/children').map((c) => c.number), ['10.1', '10.2']);
  assert.deepEqual(r.ask('/cue/1/valuesForKeys', ['["number","name","type","armed","nonsense"]']), { number: '1', name: 'House to half', type: 'Wait', armed: true });
  assert.equal(r.say('/workspace/anything/cue/1/name').reply.address, '/workspace/anything/cue/1/name', 'a workspace prefix is taken off and given back');
  assert.equal(host.cmds.length, 0, 'reading does nothing to the show');
});

test('OSC control: running, paused, loaded and elapsed follow the engine', () => {
  const s = aShow(), host = fakeHost(s.doc), r = remote(host);
  assert.equal(r.ask('/cue/1/isRunning'), false);
  assert.equal(r.say('/cue/10.1/start').ret, 'done');
  host.advance(6);
  assert.equal(r.ask('/cue/10.1/isRunning'), true);
  assert.equal(r.ask('/cue/10/isRunning'), true, 'the group it is in is running too');
  assert.equal(r.ask('/cue/10.1/actionElapsed'), 0, 'a wait has no action of its own');
  assert.deepEqual(r.ask('/runningCues').map((c) => c.number), ['10', '10.1']);
  r.say('/cue/10.1/pause');
  assert.equal(r.ask('/cue/10.1/isPaused'), true);
  assert.equal(r.ask('/cue/10.1/isRunning'), false);
  assert.deepEqual(r.ask('/runningCues'), []);
  assert.deepEqual(r.ask('/runningOrPausedCues').map((c) => c.number), ['10', '10.1']);
  r.say('/cue/active/resume');
  assert.equal(r.ask('/cue/10.1/isRunning'), true);
  r.say('/cue/active/stop');
  assert.deepEqual(r.ask('/runningOrPausedCues'), []);
  // Load to Time is the cue standing by's
  assert.equal(r.say('/cue/playhead/loadAt 3.5').ret, 'done');
  assert.equal(r.ask('/cue/1/isLoaded'), true);
  assert.deepEqual(host.cmds.at(-1), { op: 'load', secs: 3.5, from: 'osc' });
  r.say('/cue/selected/loadAt 0 1 2');
  assert.equal(host.cmds.at(-1).secs, 62, 'hours, minutes, seconds');
  const other = r.say('/cue/2/loadAt 3');
  assert.equal(other.reply.status, 'error');
  assert.match(other.reply.data, /standing by/);
  r.say('/cue/1/load');
  assert.equal(r.ask('/cue/1/isLoaded'), false);
});

test('OSC control: a property is written with a cue.set edit, and Show mode refuses it', () => {
  const s = aShow(), host = fakeHost(s.doc), r = remote(host);
  const cue = (ref) => show.index(host.doc).byId.get(s.id(ref));
  assert.equal(r.say('/cue/1/name "Blackout"').ret, 'done');
  assert.deepEqual(host.cmds.at(-1), { op: 'edit', ops: [{ op: 'cue.set', id: s.id('a'), props: { name: 'Blackout' } }], label: 'name (OSC)', from: 'osc' });
  assert.equal(cue('a').name, 'Blackout');
  r.say('/cue/1/number 1.5');
  assert.equal(cue('a').number, '1.5', 'a float that is a cue number is written as text, not as 1.50000002');
  r.say('/cue/1.5/number A1');
  r.say('/cue/A1/notes "two words"');
  assert.equal(cue('a').notes, 'two words');
  r.say('/cue/A1/preWait 2.5');
  r.say('/cue/A1/preWait/+ 1');
  assert.equal(cue('a').preWait, 3.5);
  r.say('/cue/A1/preWait/-/10');
  assert.equal(cue('a').preWait ?? 0, 0, 'never below nothing');
  r.say('/cue/A1/postWait 1');
  r.say('/cue/A1/duration 12');
  assert.deepEqual([cue('a').postWait, cue('a').duration], [1, 12]);
  r.say('/cue/A1/continueMode 2');
  assert.equal(cue('a').continue, 'auto-follow');
  r.say('/cue/A1/continueMode/+');
  assert.equal(cue('a').continue ?? 'none', 'none', 'it rolls over');
  assert.equal(r.say('/cue/A1/continueMode 7').reply.status, 'error');
  r.say('/cue/A1/colorName green');
  assert.equal(cue('a').color, 'green');
  assert.equal(r.say('/cue/A1/colorName tartan').reply.status, 'error', 'the show’s own check refuses a colour it has not');
  r.say('/cue/A1/flagged 1');
  assert.equal(cue('a').flagged, true);
  r.say('/cue/A1/flagged/toggle');
  assert.equal(!!cue('a').flagged, false);
  r.say('/cue/A1/flagged', ['toggle']);
  assert.equal(cue('a').flagged, true);
  r.say('/cue/A1/flagged', [false]);
  assert.equal(!!cue('a').flagged, false);
  assert.equal(r.say('/cue/A1/flagged maybe').reply.status, 'error');
  // armed: the cue as written, and the engine with it
  r.say('/cue/A1/armed 0');
  assert.equal(cue('a').armed, false);
  assert.equal(r.ask('/cue/A1/armed'), false);
  r.say('/cue/A1/armed 1');
  assert.equal(r.ask('/cue/A1/armed'), true);
  host.cmd({ op: 'arm', id: s.id('a') });        // the operator disarms it live: the show file still says armed
  assert.equal(r.ask('/cue/A1/armed'), false);
  r.say('/cue/A1/armed 1');
  assert.equal(r.ask('/cue/A1/armed'), true, 'armed again, though the edit changed nothing');
  // what can only be read, and what a type does not have
  assert.match(r.say('/cue/A1/isRunning 1').reply.data, /only be read/);
  assert.equal(r.say('/cue/10.2/duration 3').reply.status, 'error', 'a Memo has no duration');
  // one edit for every cue a pattern names
  r.say('/cue/10.*/flagged 1');
  assert.equal(host.cmds.at(-1).ops.length, 2);
  assert.deepEqual([cue('g1').flagged, cue('g2').flagged], [true, true]);
  // Show mode
  r.say('/showMode 1');
  assert.equal(r.ask('/showMode'), true);
  const refused = r.say('/cue/A1/name "No"');
  assert.equal(refused.ret, true, 'refused: it did nothing');
  assert.equal(refused.reply.status, 'error');
  assert.match(refused.reply.data, /Show mode/);
  assert.equal(cue('a').name, 'Blackout');
  assert.match(r.say('/undo').reply.data, /Show mode/);
  assert.equal(r.ask('/cue/A1/name'), 'Blackout', 'reading is not editing');
  r.say('/toggleEditShowMode');
  assert.equal(r.ask('/showMode'), false);
  assert.match(r.say('/save').reply.data, /no folder/);
});

test('OSC control: the ways of naming a cue, and a cue that is not there', () => {
  const s = aShow(), host = fakeHost(s.doc), r = remote(host);
  assert.equal(r.ask(`/cue_id/${s.id('g2')}/name`), 'Thunder');
  assert.equal(r.ask('/cue/selected/number'), '1', 'the selection is the playhead');
  assert.equal(r.ask('/cue/playhead/number'), '1');
  assert.equal(r.ask('/cue/playbackPosition/number'), '1');
  assert.deepEqual(r.ask('/selectedCues').map((c) => c.uniqueID), [s.id('a')]);
  assert.equal(r.ask('/playheadID'), s.id('a'));
  assert.equal(r.ask(`/cue_id/${s.list}/playheadID`), s.id('a'));
  assert.equal(r.ask(`/cue_id/${s.list}/playbackPositionId`), s.id('a'));
  assert.equal(r.ask(`/cue_id/${s.doc.lists[1].id}/playheadID`), 'none', 'a list that is not the one on screen');
  assert.equal(r.ask(`/cue_id/${s.list}/type`), 'Cue List');
  // a pattern
  assert.equal(r.say('/cue/10.?/start').ret, 'done');
  assert.deepEqual(host.cmds.slice(-2).map((c) => [c.op, c.id]), [['start', s.id('g1')], ['start', s.id('g2')]]);
  assert.match(r.say('/cue/1*/name').reply.data, /4 cues match/, 'a read is of one cue');
  assert.equal(r.say('/cue/{1,2}/stop').ret, 'done');
  // "/cue/start <number>" and "/cue_id/start <id>"
  r.say('/cue/start', ['2']);
  assert.deepEqual([host.cmds.at(-1).op, host.cmds.at(-1).id], ['start', s.id('b')]);
  r.say('/cue_id/start', [s.id('a')]);
  assert.equal(host.cmds.at(-1).id, s.id('a'));
  r.say('/reset'); host.cmd({ op: 'panic', hard: true });
  // preview fires the cue alone; panic takes it out
  r.say('/cue/2/preview');
  assert.deepEqual([host.cmds.at(-1).op, host.cmds.at(-1).id], ['fire', s.id('b')]);
  r.say('/cue/2/panic');
  assert.deepEqual([host.cmds.at(-1).op, host.cmds.at(-1).fade], ['stop', true]);

  // nothing there: an error, and nothing done
  const before = host.cmds.length;
  for (const address of ['/cue/99/start', '/cue/99/name', '/cue/99/name "x"', '/cue_id/nobody/stop', '/cue/9*/stop', '/cue/active/stop', '/playheadID/nobody', `/playheadID/${s.id('g1')}`]) {
    const x = r.say(address);
    assert.equal(x.ret, true, `${address}: did nothing`);
    assert.equal(x.reply.status, 'error', address);
  }
  assert.match(r.say('/cue/99/start').reply.data, /no cue numbered 99/);
  assert.equal(host.cmds.length, before, 'the host was asked nothing');
  host.engine.playhead = null;
  assert.match(r.say('/cue/selected/start').reply.data, /standing by/);
  assert.deepEqual(r.ask('/selectedCues'), []);
  assert.equal(r.ask('/playheadID'), 'none');
  assert.equal(host.cmds.length, before);
  // not ours at all: no reply, left for a cue's trigger
  const stranger = r.say('/sm/thunder 1');
  assert.equal(stranger.ret, false);
  assert.equal(stranger.reply, null);
  assert.equal(r.say('/cue/1/opacity').reply.status, 'error', 'a cue’s address this does not have says so');
});

test('OSC control: the playhead by id and by sequence, and panic in a time', () => {
  const s = aShow(), host = fakeHost(s.doc), r = remote(host);
  r.say(`/playheadID/${s.id('g')}`);
  assert.equal(host.engine.playhead, s.id('g'));
  r.say(`/select_id/${s.id('b')}`);
  assert.equal(host.engine.playhead, s.id('b'));
  r.say('/playhead/1');
  // 1 continues into 2: the next sequence starts at 10
  assert.equal(r.say('/playhead/nextSequence').ret, 'done');
  assert.equal(host.engine.playhead, s.id('g'));
  r.say('/playhead/nextSequence');
  assert.equal(host.engine.playhead, s.id('m'));
  assert.equal(r.say('/playhead/nextSequence').reply.status, 'error', 'the last one');
  r.say('/playhead/previousSequence'); r.say('/playhead/previousSequence');
  assert.equal(host.engine.playhead, s.id('a'));
  r.say('/select/next');
  assert.equal(host.engine.playhead, s.id('b'));
  r.say('/playhead/2'); r.say('/playhead/previousSequence');
  assert.equal(host.engine.playhead, s.id('a'), 'from inside a sequence: back to its first cue');
  // QLab's other playhead words are never taken for a cue number
  const before = host.cmds.length;
  assert.equal(r.say('/playhead/none').reply.status, 'error');
  assert.equal(host.cmds.length, before);
  assert.equal(r.m.route('/playhead/none'), null);

  assert.deepEqual(r.m.route('/panicInTime', [3]), { op: 'fadeall', secs: 3 });
  assert.deepEqual(r.m.route('/panicInTime'), { op: 'panic' });
  assert.deepEqual(r.m.route('/panicInTime', [0]), { op: 'panic', hard: true });
  assert.deepEqual(r.m.route('/go', ['2']), [{ op: 'jump', number: '2' }, { op: 'go' }], '/go with a cue number as text');
  assert.deepEqual(r.m.route('/go', [2]), { op: 'go' });
  assert.deepEqual(r.m.route('/cue/3/preview'), { op: 'fire', number: '3' });
  assert.equal(r.m.route('/cue/3/constructor'), null);
});

test('OSC control: /cueLists, /workspaces and /version in QLab’s shapes', () => {
  const s = aShow(), host = fakeHost(s.doc), r = remote(host);
  const lists = r.ask('/cueLists');
  assert.deepEqual(lists.map((l) => [l.uniqueID, l.name, l.listName, l.type, l.number]), [[s.list, 'Main', 'Main', 'Cue List', ''], [s.doc.lists[1].id, 'Preshow', 'Preshow', 'Cue List', '']]);
  assert.deepEqual(Object.keys(lists[0]), ['uniqueID', 'number', 'name', 'listName', 'type', 'colorName', 'flagged', 'armed', 'cues']);
  assert.deepEqual(lists[0].cues[1], { uniqueID: s.id('b'), number: '2', name: '', listName: 'wait 4 s', type: 'Wait', colorName: 'red', flagged: false, armed: true, cues: [] });
  assert.deepEqual(lists[0].cues[2].cues.map((c) => c.number), ['10.1', '10.2']);
  assert.equal(r.ask('/version'), '5.0.0');
  assert.deepEqual(r.ask('/workspaces'), [{ uniqueID: s.doc.id, displayName: 'Test', port: 0, udpReplyPort: 53001, version: '5.0.0' }]);
});

test('OSC control: an answer too big for one UDP message is an error, not a datagram that cannot be sent', () => {
  const s = build(Array.from({ length: 120 }, (_, i) => ({ op: 'cue.add', cue: { type: 'memo', number: String(i + 1), name: `A cue with a name of some length ${i}` } })));
  const r = remote(fakeHost(s.doc));
  const x = r.say('/cueLists');
  assert.equal(x.ret, true);
  assert.equal(x.reply.status, 'error');
  assert.match(x.reply.data, /more than one UDP message/);
  assert.ok(r.got.every((g) => osc.encode(g.address, g.args).length < 9216));
  assert.equal(r.say('/cue/5/name').reply.status, 'ok');
});

test('OSC control: one passcode; a client is forgotten after 61 s of silence; wrong tries are made to wait', () => {
  let t = 1e6;
  const s = aShow(), host = fakeHost(s.doc), r = remote(host, { passcode: '4321' }, { now: () => t });
  assert.equal(r.say('/cue/1/name').reply.status, 'denied');
  assert.equal(r.say('/cueLists').reply.status, 'denied');
  assert.equal(r.say('/thump').reply.status, 'denied');
  assert.equal(r.ask('/version'), '5.0.0', '/version and /workspaces answer whoever asks');
  assert.equal(r.ask('/workspaces').length, 1);
  assert.equal(r.say('/sm/thunder').reply, null, 'what is not ours is not answered, connected or not');
  // wrong, then right too soon, then right
  assert.deepEqual([r.say('/connect 1111').reply.status, r.say('/connect 1111').reply.data], ['denied', 'error']);
  assert.equal(r.say('/connect 4321').reply.status, 'error', 'within a second of a wrong try');
  t += 1100;
  assert.equal(r.say('/connect 0000').reply.data, 'badpass');
  t += 1100;
  assert.equal(r.say('/connect 4321').reply.status, 'error', 'the wait doubles');
  t += 1000;
  const inn = r.say('/connect 4321');
  assert.deepEqual([inn.ret, inn.reply.status, inn.reply.data], ['done', 'ok', 'ok:view|edit|control']);
  assert.equal(r.ask('/cue/1/name'), 'House to half');
  assert.equal(r.from(5001).say('/cue/1/name').reply.status, 'denied', 'another sender is another client');
  // any message keeps it remembered; silence does not
  t += 60000; assert.equal(r.say('/cue/1/name').reply.status, 'ok');
  t += 60000; assert.equal(r.say('/thump').reply.data, 'thump');
  t += 62000; assert.equal(r.say('/cue/1/name').reply.status, 'denied');
  r.say('/connect 4321'); r.say('/forgetMeNot 1');
  t += 3600000; assert.equal(r.say('/cue/1/name').reply.status, 'ok', '/forgetMeNot');
  r.say('/disconnect');
  assert.equal(r.say('/cue/1/name').reply.status, 'denied');
  assert.equal(host.cmds.length, 0);
});

test('OSC control: /updates 1 pushes what changed, in QLab’s addresses', () => {
  let t = 1e6;
  const s = aShow(), host = fakeHost(s.doc), r = remote(host, {}, { now: () => t });
  const base = `/update/workspace/${s.doc.id}`;
  const pushed = () => { r.m.onState(); return r.got.splice(0).filter((g) => /^\/update/.test(g.address)).map((g) => [g.address, ...g.args].join(' ')); };
  host.cmd({ op: 'move', step: 1 });
  assert.deepEqual(pushed(), [], 'nobody asked');
  assert.equal(r.say('/updates 1').ret, 'done');
  assert.deepEqual(pushed(), [], 'nothing has changed since it asked');
  // the playhead
  host.cmd({ op: 'move', step: 1 });
  assert.deepEqual(pushed(), [`${base}/cueList/${s.list}/playbackPosition ${s.id('g')}`]);
  // a cue starts, and stops
  host.cmd({ op: 'start', id: s.id('g1') });
  assert.deepEqual(pushed().sort(), [`${base}/cue_id/${s.id('g')}`, `${base}/cue_id/${s.id('g1')}`].sort());
  host.advance(1);
  assert.deepEqual(pushed(), [], 'time passing is not a change');
  host.cmd({ op: 'stop', id: s.id('g1') });
  assert.equal(pushed().length, 2);
  // a cue is edited; cues are added
  r.say('/cue/2/name "Renamed"');
  assert.deepEqual(pushed(), [`${base}/cue_id/${s.id('b')}`]);
  host.cmd({ op: 'edit', ops: [{ op: 'cue.add', cue: { type: 'memo', number: '50' } }] });
  assert.deepEqual(pushed(), [base], 'cues came or went: the lists are to be read again');
  // the playhead off the end
  host.engine.playhead = null;
  assert.deepEqual(pushed(), [`${base}/cueList/${s.list}/playbackPosition`]);
  // a silent client is dropped, and one that says so
  t += 62000;
  host.cmd({ op: 'move', step: 1 });
  assert.deepEqual(pushed(), []);
  r.say('/updates 1'); r.say('/updates 0');
  host.cmd({ op: 'move', step: 1 });
  assert.deepEqual(pushed(), []);
});

test('OSC control through the hub, over UDP: a read answered, an update pushed, and what the hub is told did nothing', async () => {
  const { createHub } = require('../core/net/hub');
  const port = await new Promise((res) => { const x = dgram.createSocket('udp4'); x.bind(0, '127.0.0.1', () => { const p = x.address().port; x.close(() => res(p)); }); });
  const s = aShow(), host = fakeHost(s.doc);
  const hub = createHub();
  hub.configure({ patches: [], inputPort: port, listen: true });
  // (what the module's listener tells the hub: exactly true when the message did something)
  const told = {};
  const net = { ...hub, onMessage: (fn) => hub.onMessage((msg, from, send) => (told[msg.address] = fn(msg, from, send))) };
  const m = oscControl.create({ log() {}, changed() {}, net, host });
  m.start({ replyPort: 0 })        // (answers back to the port that asked, where QLab's go to 53001);
  const sock = dgram.createSocket('udp4'), got = [];
  sock.on('message', (b) => got.push(osc.decode(b)));
  const say = async (text) => { await new Promise((r) => sock.send(osc.encode(text), port, '127.0.0.1', r)); await sleep(40); };
  await sleep(40);
  await say('/cue/10/name');
  assert.equal(got.at(-1).address, '/reply/cue/10/name');
  assert.equal(JSON.parse(got.at(-1).args[0]).data, 'Storm');
  await say('/cue/77/name');
  await say('/workspaces');
  assert.equal(JSON.parse(got.at(-1).args[0]).data[0].port, port);
  await say('/updates 1');
  await say('/playhead/2');
  m.onState(); await sleep(40);
  assert.deepEqual([got.at(-1).address, got.at(-1).args[0]], [`/update/workspace/${s.doc.id}/cueList/${s.list}/playbackPosition`, s.id('b')]);
  assert.deepEqual(told, { '/cue/10/name': true, '/cue/77/name': false, '/workspaces': true, '/updates': true, '/playhead/2': true });
  assert.equal(hub.monitor().filter((e) => e.dir === 'in').length, 5, 'everything heard is in the monitor');
  m.stop(); hub.close(); sock.close();
});
