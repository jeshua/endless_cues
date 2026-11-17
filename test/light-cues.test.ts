// Light cues that hold levels, run by the cue engine: fades, tracking, pause, stop, panic, reset, a Fade aimed at one,
// and recording a cue from what is live. A fake clock and a dry-run output: nothing is sent anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rig as engineRig, build } from './helpers';
import * as show from '../core/show/show';
import { applyOps } from '../core/show/ops';
import { createLighting } from '../core/light/lighting';
import * as artnet from '../core/light/artnet';

const LIGHT = {
  on: true,
  universes: [{ id: 1, protocol: 'artnet', address: 0, host: '' }],
  instruments: [{ name: 'front', fixture: 'dimmer', universe: 1, address: 1 }, { name: 'side', fixture: 'dimmer', universe: 1, address: 2 }, { name: 'cyc', fixture: 'rgb', universe: 1, address: 10 }],
  groups: [{ name: 'wash', members: ['front', 'side'] }],
};

/** A show with a light patch and these cues, an engine on a fake clock, and the lighting driven by hand (no timer). */
function stage(cues, light = LIGHT) {
  const b = build([{ op: 'show.set', path: 'settings.light', value: light }, ...cues.map((cue) => ({ op: 'cue.add', cue, ref: cue.ref }))]);
  const e = engineRig(b.doc);
  let doc = b.doc;
  const lighting = createLighting({ dryRun: true, clock: e.now, timers: { setInterval: () => null, clearInterval() {} } });
  lighting.configure(doc.settings.light);
  lighting.attach(e.engine);
  const ctx = { cueOf: (id) => show.index(doc).byId.get(id), edit: (ops) => { const r = applyOps(doc, ops); doc = r.doc; e.engine.load(show.toEngineDoc(doc)); return r; } };
  const level = (k) => { lighting.step(); return Math.round(lighting.rig.level(k) * 10) / 10; };
  // (in the app a timer refreshes 40 times a second; here time only moves in `advance`, so that is when it refreshes)
  const advance = (secs) => { e.advance(secs); lighting.step(); };
  return { ...e, advance, b, lighting, level, ctx, doc: () => doc, dmx: (ch) => { lighting.step(); return artnet.parseDmx(lighting.output.last(1)).data[ch - 1]; } };
}

test('a Light cue with levels is a problem only when its lines cannot be read; one with nothing at all is an error', () => {
  const { doc } = build([
    { op: 'show.set', path: 'settings.light', value: LIGHT },
    { op: 'cue.add', cue: { type: 'light', number: '1', levels: 'front = 80' } },
    { op: 'cue.add', cue: { type: 'light', number: '2', levels: 'front = 80\nnobody = 3' } },
    { op: 'cue.add', cue: { type: 'light', number: '3' } },
    { op: 'cue.add', cue: { type: 'light', number: '4', lightCue: '12' } },
  ]);
  const of = (n) => show.problems(doc).filter((p) => p.id === show.findByNumber(doc, n).id);
  assert.deepEqual(of('1'), []);
  assert.equal(of('2')[0].level, 'warning');
  assert.match(of('2')[0].why, /line 2, “nobody = 3”/);
  assert.deepEqual(of('3').map((p) => [p.level, p.why]), [['error', 'no levels and no desk cue number']]);
  assert.deepEqual(of('4'), []);
  // a new show has an empty patch and nothing switched on
  assert.deepEqual(show.newShow().settings.light, { on: false, rate: 40, panicBlackout: false, universes: [], instruments: [], groups: [], fixtures: [] });
  // and a show saved before there was lighting opens with one
  const old = show.newShow(); delete old.settings.light;
  assert.deepEqual(show.normalise(old).doc.settings.light.instruments, []);
});

test('a Light cue is named by its levels, or by its desk cue number', () => {
  const { doc } = build([
    { op: 'cue.add', cue: { type: 'light', levels: '# opening\nfront = 80\ncyc.red = 100' } },
    { op: 'cue.add', cue: { type: 'light', lightCue: '12', levels: 'front = 80' } },
    { op: 'cue.add', cue: { type: 'light', levels: 'a = 1\nb = 2\nc = 3\nd = 4' } },
  ]);
  const names = show.toEngineDoc(doc).lists[0].cues.map((c) => c.name);
  assert.deepEqual(names, ['front = 80, cyc.red = 100', 'LQ 12', 'a = 1, b = 2, c = 3, …']);
});

test('GO on a Light cue fades the lights over its time, on the engine’s clock, and the DMX follows', () => {
  const s = stage([{ type: 'light', number: '1', levels: 'front = 100\ncyc = 50', duration: 4 }]);
  s.engine.go();
  assert.equal(s.level('front.intensity'), 0);
  assert.deepEqual(s.engine.active().map((a) => [a.kind, a.number, a.total]), [['fade', '1', 4]]);
  s.advance(1);
  assert.equal(s.level('front.intensity'), 25);
  assert.equal(s.dmx(1), 64);
  s.advance(2);
  assert.equal(s.level('front.intensity'), 75);
  s.advance(1.01);
  assert.equal(s.level('front.intensity'), 100);
  assert.equal(s.dmx(1), 255);
  assert.equal(s.dmx(10), 128);                       // the cyc's colours at home (100) behind its intensity of 50
  assert.deepEqual(s.engine.active(), []);
  assert.deepEqual(s.lights, []);                     // no desk cue number: the desk hook was not called
});

test('a Light cue left at its grey default fades in 3 s; with a time of 0 it lands at once', () => {
  const s = stage([{ type: 'light', levels: 'front = 90' }, { type: 'light', levels: 'side = 40', duration: 0 }]);
  s.engine.go();
  s.advance(1.5);
  assert.equal(s.level('front.intensity'), 45);
  s.advance(2);
  s.engine.go();
  assert.equal(s.level('side.intensity'), 40);
  assert.deepEqual(s.engine.active(), []);
});

test('levels track from cue to cue; a full-state cue sends what it does not name home', () => {
  const s = stage([
    { type: 'light', levels: 'front = 80', duration: 0 }, { type: 'light', levels: 'side = 30', duration: 0 },
    { type: 'light', levels: 'cyc = 100', duration: 2, block: true },
  ]);
  s.engine.go(); s.engine.go();
  assert.deepEqual([s.level('front.intensity'), s.level('side.intensity')], [80, 30]);
  s.engine.go();
  s.advance(1);
  assert.deepEqual([s.level('front.intensity'), s.level('side.intensity'), s.level('cyc.intensity')], [40, 15, 50]);
  s.advance(1.1);
  assert.deepEqual([s.level('front.intensity'), s.level('side.intensity'), s.level('cyc.intensity')], [0, 0, 100]);
});

test('pausing the cue holds the lights where they are, and resuming carries on from there', () => {
  const s = stage([{ type: 'light', ref: 'a', levels: 'front = 100', duration: 4 }]);
  s.engine.go();
  s.advance(1);
  s.engine.pause();
  s.advance(10);
  assert.equal(s.level('front.intensity'), 25);
  s.engine.resume();
  s.advance(1);
  assert.equal(s.level('front.intensity'), 50);
  s.advance(2.1);
  assert.equal(s.level('front.intensity'), 100);
});

test('a Stop cue aimed at a Light cue stops its fade where it has got to', () => {
  const s = stage([{ type: 'light', ref: 'a', levels: 'front = 100', duration: 4 }, { type: 'stop', target: '@a' }]);
  s.engine.go();
  s.advance(1);
  s.engine.go();
  s.advance(5);
  assert.equal(s.level('front.intensity'), 25);
  assert.deepEqual(s.engine.active(), []);
});

test('Panic stops the fades and holds the levels: it does not black out', () => {
  const s = stage([{ type: 'light', levels: 'front = 100', duration: 0 }, { type: 'light', levels: 'side = 100', duration: 4 }]);
  s.engine.go(); s.engine.go();
  s.advance(2);
  s.engine.panic(); assert.equal(s.lighting.panic(false, 1), 'held');
  s.advance(5);
  assert.deepEqual([s.level('front.intensity'), s.level('side.intensity')], [100, 50]);
  assert.equal(s.dmx(1), 255);
});

test('with “Panic takes the lights out” on, Esc fades everything home over the panic time; the second Esc is at once', () => {
  const s = stage([{ type: 'light', levels: 'wash = 100', duration: 0 }], { ...LIGHT, panicBlackout: true });
  s.engine.go();
  s.engine.panic(); assert.equal(s.lighting.panic(false, 2), 'out');
  s.advance(1);
  assert.equal(s.level('front.intensity'), 50);
  s.lighting.panic(true, 2);
  assert.deepEqual([s.level('front.intensity'), s.level('side.intensity')], [0, 0]);
});

test('Reset stops the fades and leaves the lights as they are', () => {
  const s = stage([{ type: 'light', levels: 'front = 100', duration: 4 }]);
  s.engine.go();
  s.advance(1);
  s.engine.reset(); s.lighting.reset();
  s.advance(5);
  assert.equal(s.level('front.intensity'), 25);
});

test('a Fade aimed at a Light cue takes that cue’s lights home over the Fade’s time, and is a fade like any other', () => {
  const s = stage([
    { type: 'light', levels: 'front = 60', duration: 0 }, { type: 'light', ref: 'sp', number: 'SP', levels: 'side = 100\ncyc = 80', duration: 0 },
    { type: 'fade', ref: 'f', number: 'F', target: '@sp', duration: 2 },
    { type: 'fade', number: 'B', target: '@sp', db: 0, duration: 0 },
  ]);
  assert.deepEqual(show.problems(s.b.doc), []);
  s.engine.go(); s.engine.go(); s.engine.go();
  assert.deepEqual(s.engine.active().map((a) => [a.kind, a.number]), [['fade', 'F']]);
  s.advance(1);
  assert.deepEqual([s.level('side.intensity'), s.level('cyc.intensity'), s.level('front.intensity')], [50, 40, 60]);
  s.engine.pause(); s.advance(3);
  assert.equal(s.level('side.intensity'), 50);
  s.engine.resume(); s.advance(1.1);
  assert.deepEqual([s.level('side.intensity'), s.level('cyc.intensity'), s.level('front.intensity')], [0, 0, 60]);
  // a Fade "to 0 dB" brings that cue's levels back
  s.engine.go();
  assert.deepEqual([s.level('side.intensity'), s.level('cyc.intensity')], [100, 80]);
});

test('a Light cue with levels is always a stop; one that is only a desk cue is skipped while light cues are off', () => {
  const s = stage([{ type: 'light', number: '1', lightCue: '5' }, { type: 'light', number: '2', levels: 'front = 50', duration: 0 }, { type: 'light', number: '3', lightCue: '7', levels: 'side = 50', duration: 0 }]);
  s.engine.setSkipLights(true);
  assert.equal(s.engine.byId.get(s.engine.playhead).number, '2');
  s.engine.go();
  assert.equal(s.level('front.intensity'), 50);
  s.engine.go();
  assert.equal(s.level('side.intensity'), 50);        // its levels run
  assert.deepEqual(s.lights, []);                     // and the desk is left alone while light cues are off
  s.engine.setSkipLights(false);
  s.engine.reset();
  s.engine.go(); s.engine.go(); s.engine.go();
  assert.deepEqual(s.lights, ['5', '7']);             // with them on, the desk cues are fired; the cue of levels alone never is
});

test('the dashboard: a hand on the lights, a blackout, and the picture the window is sent', () => {
  const s = stage([{ type: 'light', levels: 'front = 40', duration: 0 }]);
  s.engine.go();
  assert.deepEqual(s.lighting.cmd({ op: 'light-set', text: 'side = 70\ncyc.colour = #0000ff' }), { ok: true, count: 4 });
  assert.match(s.lighting.cmd({ op: 'light-set', text: 'ghost = 1' }).error, /no instrument or group “ghost”/);
  s.lighting.cmd({ op: 'light-level', name: 'wash', value: 20, secs: 2 });
  s.advance(1);
  assert.deepEqual([s.level('front.intensity'), s.level('side.intensity')], [30, 45]);
  s.advance(1.1);
  let snap = s.lighting.snapshot();
  assert.equal(snap.changed, 5);
  assert.equal(snap.instruments.find((i) => i.name === 'cyc').colour, '#0000ff');
  assert.equal(snap.universes[0].to, 'broadcast');
  assert.equal(snap.dryRun, true);
  assert.ok(snap.fixtures.some((f) => f.id === 'rgbw'));
  s.lighting.cmd({ op: 'light-blackout', on: true });
  assert.equal(s.dmx(1), 0);
  assert.equal(s.lighting.snapshot().blackout, true);
  s.lighting.cmd({ op: 'light-blackout' });
  assert.equal(s.dmx(1), 51);
  assert.equal(s.lighting.cmd({ op: 'light-revert' }).count, 5);
  assert.deepEqual([s.level('front.intensity'), s.level('side.intensity')], [40, 0]);
  s.lighting.cmd({ op: 'light-clear' });
  assert.equal(s.level('front.intensity'), 0);
});

test('recording: a new cue from what was changed, a full-state cue of everything, and an update of a cue', () => {
  const s = stage([{ type: 'light', ref: 'a', number: '1', levels: 'wash = 50\nfront = 60', duration: 0 }]);
  s.engine.go();
  assert.match(s.lighting.cmd({ op: 'light-record', mode: 'changes' }, s.ctx).error, /nothing has been changed by hand/);
  s.lighting.cmd({ op: 'light-set', text: 'side = 75\ncyc = 20' });
  // a tracking cue: only what the hand changed
  const made = s.lighting.cmd({ op: 'light-record', mode: 'changes', after: s.b.id('a') }, s.ctx);
  assert.equal(made.count, 2);
  let cues = s.doc().lists[0].cues;
  assert.deepEqual(cues.map((c) => c.levels), ['wash = 50\nfront = 60', 'side = 75\ncyc = 20']);
  assert.equal(cues[1].id, made.id);
  assert.equal(s.lighting.snapshot().changed, 0);     // recorded: no longer a hand's
  assert.equal(s.lighting.snapshot().instruments.find((i) => i.name === 'side').params[0].cue, made.id);
  // update: the change is written into the cue's own text
  s.lighting.cmd({ op: 'light-set', text: 'front = 85' });
  assert.equal(s.lighting.cmd({ op: 'light-record', mode: 'changes', id: s.b.id('a') }, s.ctx).ok, true);
  assert.equal(s.doc().lists[0].cues[0].levels, 'wash = 50\nfront = 85');
  // everything: a full state
  const all = s.lighting.cmd({ op: 'light-record', mode: 'all' }, s.ctx);
  const full = s.doc().lists[0].cues.find((c) => c.id === all.id);
  assert.equal(full.block, true);
  assert.equal(full.levels, 'front = 85\nside = 75\ncyc = 20\ncyc.red = 100\ncyc.green = 100\ncyc.blue = 100');
  // what it recorded is what it plays back
  s.lighting.cmd({ op: 'light-clear' });
  s.engine.fire(all.id); s.advance(3.1);
  assert.deepEqual([s.level('front.intensity'), s.level('side.intensity'), s.level('cyc.intensity')], [85, 75, 20]);
  // Show mode locks it; a cue that is not a Light cue cannot be updated
  assert.match(s.lighting.cmd({ op: 'light-record', mode: 'all' }, { ...s.ctx, locked: true }).error, /Show mode/);
  assert.match(s.lighting.cmd({ op: 'light-record', mode: 'all', id: 'nope' }, s.ctx).error, /select a Light cue/);
});

test('a show with no instruments runs no timer; one with instruments refreshes at its rate, on or off', () => {
  const made = [];
  const timers = { setInterval: (fn, ms) => { made.push(ms); return { unref() {} }; }, clearInterval() { made.push('cleared'); } };
  const l = createLighting({ dryRun: true, timers });
  l.configure({});
  assert.deepEqual(made, []);
  l.configure({ ...LIGHT, on: false });
  assert.deepEqual(made, [25]);
  l.step();
  assert.equal(l.output.last(1), null);               // switched off: the levels are kept, nothing is made for the wire
  l.configure({ ...LIGHT, rate: 30 });
  assert.equal(made.at(-1), 1000 / 30);
  l.step();
  assert.equal(artnet.parseDmx(l.output.last(1)).universe, 0);
  l.configure({});
  assert.equal(made.at(-1), 'cleared');
  l.close();
});
