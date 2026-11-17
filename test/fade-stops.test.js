// A fade to silence stops what it faded, unless the cue says otherwise (QLab leaves it playing at −∞).
const test = require('node:test');
const assert = require('node:assert');
const { rig, build } = require('./helpers');
const show = require('../core/show/show');
const { stopsTarget, defaultName } = require('../core/show/cue-types');

const add = (ref, cue) => ({ op: 'cue.add', ref, cue });
function faded(fade, more = []) {
  const s = build([...more, add('a', { type: 'audio', file: 'media/a.wav', loop: true }), add('f', { type: 'fade', target: '@a', duration: 2, ...fade })]);
  const r = rig(s.doc);
  r.engine.go(); r.engine.go();
  r.advance(3);
  return { ...r, a: s.id('a'), doc: s.doc, f: s.id('f') };
}

test('a fade to silence, left alone, stops its target when it is done', () => {
  const r = faded({});                                  // (a new Fade goes to −60 dB, the floor)
  assert.ok(!r.engine.running.has(r.a));
  assert.ok(!r.audio.playing.has(r.a));
});

test('a fade to a level that can be heard leaves its target playing', () => {
  const r = faded({ db: -20 });
  assert.ok(r.engine.running.has(r.a));
});

test('an explicit setting wins either way', () => {
  const kept = faded({ db: -60, stopTarget: false });
  assert.ok(kept.engine.running.has(kept.a), 'off: it plays on, silent, as QLab does');
  const stopped = faded({ db: -20, stopTarget: true });
  assert.ok(!stopped.engine.running.has(stopped.a), 'on: it stops though it can still be heard');
});

test('a relative dip, a voice-band duck and a rate-only fade are never a stop by default', () => {
  assert.ok(faded({ db: -60, relative: true }).engine.running.size > 0);
  assert.equal(stopsTarget({ type: 'fade', db: -60, range: 'voice' }), false);
  assert.equal(stopsTarget({ type: 'fade', rate: 0.5, keepLevel: true }), false);
  assert.equal(stopsTarget({ type: 'fade' }, { type: 'light' }), false, 'a light goes home; there is nothing to stop');
});

test('silence is the show’s own floor', () => {
  const r = faded({ db: -45 }, [{ op: 'show.set', path: 'settings.audio.levels.min', value: -40 }]);
  assert.ok(!r.engine.running.has(r.a));
  assert.equal(stopsTarget({ type: 'fade', db: -45 }, null, -60), false);
  assert.equal(stopsTarget({ type: 'fade', db: -45 }, null, -40), true);
});

test('on a picture: naming nothing takes it out; moving it does not; out of sight and silent does', () => {
  const pic = (type) => ({ type });
  assert.equal(stopsTarget({ type: 'fade' }, pic('text')), true);
  assert.equal(stopsTarget({ type: 'fade', x: 100 }, pic('video')), false);
  assert.equal(stopsTarget({ type: 'fade', opacity: 0 }, pic('text')), true);
  assert.equal(stopsTarget({ type: 'fade', opacity: 0 }, pic('video')), false, 'a video’s sound goes on');
  assert.equal(stopsTarget({ type: 'fade', opacity: 0, db: -60 }, pic('video')), true);
});

test('the engine document carries the decision, and a fade’s name says “out”', () => {
  const s = build([add('a', { type: 'audio', file: 'media/a.wav' }), add('f', { type: 'fade', target: '@a' }), add('g', { type: 'fade', target: '@a', db: -10 })]);
  const e = show.toEngineDoc(s.doc).lists[0].cues;
  assert.deepEqual(e.map((c) => c.stopTarget), [undefined, true, false]);
  const { byId } = show.index(s.doc);
  assert.match(defaultName(byId.get(s.id('f')), byId), / out$/);
  assert.doesNotMatch(defaultName(byId.get(s.id('g')), byId), / out$/);
});

test('a cue whose target is gone says so, whatever kind it is', () => {
  const s = build([add('a', { type: 'audio', file: 'media/a.wav' }), add('f', { type: 'fade', target: '@a' }), add('st', { type: 'stop', target: '@a' }), add('go', { type: 'start', target: '@a' }),
    { op: 'cue.remove', id: '@a' }]);
  const p = show.problems(s.doc);
  for (const ref of ['f', 'st', 'go']) assert.ok(p.some((x) => x.id === s.id(ref) && x.level === 'error' && /target is gone/.test(x.why)), ref);
});

test('an imported QLab workspace keeps QLab’s own word on each fade: a fade to −∞ left unticked there plays on, silent', () => {
  const fs = require('fs'), path = require('path');
  const { importQlab } = require('../core/import/qlab');
  const file = path.join(__dirname, 'fixtures', 'small.qlab5');
  const { doc } = importQlab(fs.readFileSync(file), { file });
  const fades = [];
  show.walk(doc, (c) => { if (c.type === 'fade') fades.push(c); });
  assert.ok(fades.length > 1);
  assert.ok(fades.every((c) => typeof c.stopTarget === 'boolean'), 'said outright on every one, so the default never decides for an imported show');
  const { byId } = show.index(doc);
  for (const c of fades) assert.equal(stopsTarget(c, byId.get(c.target)), c.stopTarget);
});

test('a new show keeps double-GO protection at 0.3 s', () => {
  assert.equal(show.newShow('x').settings.go.doubleGoProtection, 0.3);
});
