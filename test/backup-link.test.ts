/**
 * Main and backup: what the main does to its transport is said again to the backup in OSC control's own
 * addresses (core/net/mirror.js), and the backup, which is only the OSC control module obeying, ends up in step.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as osc from '../core/net/osc';
import * as show from '../core/show/show';
import { mirror } from '../core/net/mirror';
import { rig, build } from './helpers';
import * as oscControl from '../app/main/modules/osc-control';
import * as backupLink from '../app/main/modules/backup-link';

/** A host as a module sees one: a real engine behind `cmd` and `snapshot` (the transport commands only). */
function fakeHost(doc) {
  const r = rig(doc);
  const idOf = (c) => c.id || (c.number != null ? (show.findByNumber(doc, c.number) || {}).id : null) || null;
  const notices = [];
  let lastGo = -Infinity;
  const run = (c) => {
    const e = r.engine;
    if ((c.number != null || c.id != null) && ['pause', 'resume', 'toggle', 'stop', 'fire', 'start'].includes(c.op) && !e.byId.has(idOf(c))) return { error: 'no such cue' };
    switch (c.op) {
      case 'go': if (r.now() - lastGo < 0.3) return { ignored: 'double GO' }; lastGo = r.now(); e.go(); break;
      case 'start': e.start(idOf(c)); break;
      case 'fire': e.fire(idOf(c)); break;
      case 'stop': e.stopCue(idOf(c)); break;
      case 'pause': e.pause(idOf(c)); break;
      case 'resume': e.resume(idOf(c)); break;
      case 'toggle': { const id = idOf(c); if (e.isPaused(id)) e.resume(id); else e.pause(id); break; }
      case 'panic': e.panic(); if (c.hard) e.panic(); break;
      case 'fadeall': e.fadeAll(Number(c.secs) || 5); break;
      case 'reset': e.reset(); break;
      case 'playhead': e.setPlayhead(c.id); break;
      case 'move': e.movePlayhead(Number(c.step) || 0); break;
      case 'jump': if (!e.jumpTo(c.number)) return { error: 'no such cue' }; break;
      case 'load': e.loadToTime(Number(c.secs) || 0); return { loaded: e.loaded };
      default: return { error: `unknown command ${c.op}` };
    }
    return null;
  };
  return { rig: r, engine: r.engine, notices, showId: () => doc.id, notice: (t) => notices.push(t),
           cmd(c) { try { return run(c) || { ok: true }; } catch (err) { return { error: err.message }; } },
           snapshot() { const e = r.engine.snapshot(); delete e.cues; delete e.poem; return { rev: 1, doc, engine: e, show: { title: doc.title }, problems: [], mode: 'show' }; } };
}

const aShow = () => build([
  { op: 'cue.add', ref: 'a', cue: { type: 'audio', number: '1', name: 'Rain', file: 'media/rain.wav', continue: 'auto-continue' } },
  { op: 'cue.add', ref: 'b', cue: { type: 'wait', number: '2', duration: 4 } },
  { op: 'cue.add', ref: 'c', cue: { type: 'audio', name: 'no number', file: 'media/bell.wav' } },
  { op: 'cue.add', ref: 'd', cue: { type: 'audio', number: '4', name: 'Thunder', file: 'media/thunder.wav' } },
]);

/** Two computers with the same show: the main with the link module, the backup with OSC control, and a wire between them. */
function pair({ passcode = '' } = {}) {
  const s = aShow();
  const main = fakeHost(s.doc), backup = fakeHost(JSON.parse(JSON.stringify(s.doc)));
  const control = oscControl.create({ log() {}, changed() {}, host: backup });
  control.start({ enabled: true, passcode });
  const wire = [];
  let lose = false;
  const net = {
    send(patch, text) { wire.push(text); if (!lose) control.onOsc(osc.decode(osc.encode(text)), { address: '10.0.0.2', port: 53001 }, () => {}); return { ok: true }; },
    status: () => ({ patches: { backup: { state: 'answering', text: 'answering' } } }),
    onMessage: () => () => {},
  };
  const beats = [];
  const link = backupLink.create({ host: main, net, every: (fn) => { beats.push(fn); return beats.length; }, never() {} });
  link.start({ enabled: true, role: 'main', patch: 'backup', passcode });
  // the main's `cmd`, as host.js runs it: the command, then the modules told of it
  const cmd = (c) => { const before = { playhead: main.engine.playhead }; const r = main.cmd(c); link.onCommand(c, r, before, { playhead: main.engine.playhead }); return r; };
  const state = (h) => ({ playhead: h.engine.playhead, running: [...h.engine.running.keys()].sort(), paused: [...h.engine.running].filter(([, r]) => r.pausedAt != null).map(([k]) => k).sort(), waits: h.engine.active().filter((a) => a.kind === 'wait').map((a) => a.id).sort() });
  const advance = (secs) => { main.rig.advance(secs); backup.rig.advance(secs); };
  return { s, main, backup, cmd, wire, link, beats, state, advance, lose: (on) => { lose = on; } };
}

test('a command becomes the OSC that makes another computer do the same', () => {
  assert.deepEqual(mirror({ op: 'go' }, { before: { playhead: 'c_1' }, after: { playhead: 'c_2' }, result: { ok: true } }), ['/playheadID/c_1', '/go', '/playheadID/c_2']);
  assert.deepEqual(mirror({ op: 'go' }, { before: { playhead: 'c_1' }, after: { playhead: 'c_1' }, result: { ignored: 'double GO' } }), [], 'a GO that did not happen is not passed on');
  assert.deepEqual(mirror({ op: 'stop', id: 'c_1', fade: true }, { before: { playhead: 'x' }, after: { playhead: 'x' } }), ['/cue_id/c_1/panic']);
  assert.deepEqual(mirror({ op: 'panic', hard: true }), ['/hardStop']);
  assert.deepEqual(mirror({ op: 'move', step: 1 }, { before: { playhead: 'c_1' }, after: { playhead: 'c_2' } }), ['/playheadID/c_2']);
  assert.deepEqual(mirror({ op: 'start', id: 'nope' }, { result: { error: 'no such cue' } }), [], 'nor one that was refused');
  for (const op of ['edit', 'save', 'undo', 'bus', 'master', 'mode', 'override', 'accept']) assert.deepEqual(mirror({ op, id: 'c_1' }, { before: { playhead: 'a' }, after: { playhead: 'b' } }), [], `${op} is not transport`);
});

test('the backup follows the main through a run: GO, a sequence, a pause, a cue started by hand, panic', () => {
  const p = pair();
  const same = (what) => assert.deepEqual(p.state(p.backup), p.state(p.main), what);
  p.cmd({ op: 'go' }); same('GO: the sound, the wait that continues from it, and the playhead');
  assert.deepEqual(p.state(p.backup).running, [p.s.id('a')]);
  p.advance(1);
  p.cmd({ op: 'pause', id: p.s.id('a') }); same('one cue paused');
  p.cmd({ op: 'resume' }); same('everything resumed');
  p.advance(0.1);
  assert.equal(p.cmd({ op: 'go' }).ok, true);
  assert.equal(p.cmd({ op: 'go' }).ignored, 'double GO');
  same('a GO the main ignored is not a GO on the backup');
  p.cmd({ op: 'start', id: p.s.id('d') }); same('a cart button, a hotkey: a cue started with the playhead where it was');
  p.cmd({ op: 'stop', id: p.s.id('d') }); same('and stopped');
  p.cmd({ op: 'move', step: -1 }); same('the playhead moved by hand');
  p.cmd({ op: 'jump', number: '1' }); same('…and jumped');
  p.cmd({ op: 'panic', hard: true }); same('a hard stop');
  assert.deepEqual(p.state(p.backup).running, []);
  p.cmd({ op: 'reset' }); same('reset');
});

test('a message lost on the way costs the backup one cue, not its place', () => {
  const p = pair();
  p.cmd({ op: 'go' });
  p.lose(true); p.advance(1); p.cmd({ op: 'go' }); p.lose(false);       // the second GO never arrives
  assert.notEqual(p.backup.engine.playhead, p.main.engine.playhead);
  p.advance(1); p.cmd({ op: 'go' });
  assert.equal(p.backup.engine.playhead, p.main.engine.playhead, 'the next GO names the cue to fire, so the two are on the same cue again');
  assert.ok(p.backup.engine.running.has(p.s.id('d')), 'and it fired the cue the main fired');
});

test('the link gives the backup its passcode first, and each end says whether it hears the other', () => {
  const p = pair({ passcode: '4321' });
  assert.equal(p.wire[0], '/connect 4321');
  p.cmd({ op: 'go' });
  assert.equal(p.backup.engine.running.size, 1, 'the backup obeys once it has been given the passcode');
  p.beats[0]();
  assert.equal(p.wire.at(-1), '/thump');
  assert.deepEqual(p.link.status().ok, true);
  assert.match(p.link.status().text, /the backup is answering/);
  // the backup's side: it only watches, and says so when the main goes quiet
  let t = 1000, heard = null;
  const ticks = [];
  const b = backupLink.create({ host: p.backup, net: { onMessage: (fn) => { heard = fn; return () => {}; }, status: () => ({ patches: {} }) }, now: () => t, every: (fn) => { ticks.push(fn); return 1; }, never() {} });
  b.start({ enabled: true, role: 'backup' });
  assert.match(b.status().text, /waiting to hear the main/);
  assert.equal(heard({ address: '/thump', args: [] }), false, 'it never takes a message from the module that obeys it');
  assert.deepEqual(b.status(), { ok: true, text: 'following the main · 1 heard' });
  t += 5000; ticks[0]();
  assert.equal(b.status().ok, false);
  assert.match(b.status().text, /has not been heard for 5 s/);
  assert.match(p.backup.notices[0], /The main computer has gone quiet/);
  t += 1000; ticks[0]();
  assert.equal(p.backup.notices.length, 1, 'said once');
});
