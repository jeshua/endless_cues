// A launch from the Live view: a clip takes over its track.
import test from 'node:test';
import assert from 'node:assert';
import { tracksOf, replacedBy } from '../core/audio/launch';
import { rig, build } from './helpers';

const made = () => build([
  { op: 'cue.add', ref: 'a', cue: { type: 'audio', file: 'a.wav', bus: 'music' } },
  { op: 'cue.add', ref: 'b', cue: { type: 'audio', file: 'b.wav', bus: 'music' } },
  { op: 'cue.add', ref: 'fx', cue: { type: 'audio', file: 'fx.wav', bus: 'effects' } },
  { op: 'cue.add', ref: 'mic', cue: { type: 'mic', bus: 'music' } },
  { op: 'cue.add', ref: 'scene', cue: { type: 'group' } },
  { op: 'cue.add', ref: 's1', parent: '@scene', cue: { type: 'audio', file: 'c.wav', bus: 'music' } },
  { op: 'cue.add', ref: 's2', parent: '@scene', cue: { type: 'audio', file: 'd.wav', bus: 'effects' } },
  { op: 'cue.add', ref: 'lx', parent: '@scene', cue: { type: 'light', lightCue: '4' } },
]);

test('a clip takes over from what is playing on its own track, and nothing else', () => {
  const { doc, id } = made();
  const { engine } = rig(doc);
  engine.fire(id('a')); engine.fire(id('fx')); engine.fire(id('mic'));
  const running = [...engine.running.keys()];
  assert.deepStrictEqual(replacedBy(engine.byId.get(id('b')), running, engine.byId), [id('a')]);
  // launched again, a clip does not take over from itself
  assert.deepStrictEqual(replacedBy(engine.byId.get(id('a')), running, engine.byId), []);
});

test('a scene takes over every track it has a sound on; its own sounds are not among them', () => {
  const { doc, id } = made();
  const { engine } = rig(doc);
  engine.fire(id('a')); engine.fire(id('fx')); engine.fire(id('s1'));
  const scene = engine.byId.get(id('scene'));
  assert.deepStrictEqual(tracksOf(scene).sort(), ['effects', 'music']);
  assert.deepStrictEqual(replacedBy(scene, [...engine.running.keys()], engine.byId).sort(), [id('a'), id('fx')].sort());
});

test('a cue with no sound in it takes over nothing', () => {
  const { doc, id } = made();
  const { engine } = rig(doc);
  engine.fire(id('a'));
  assert.deepStrictEqual(replacedBy(engine.byId.get(id('lx')), [...engine.running.keys()], engine.byId), []);
});
