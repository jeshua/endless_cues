// The Live view's channel strips: what a bus's settings mean to the sound.
import test from 'node:test';
import assert from 'node:assert';
import { stripOf, filterOf, crossGain, cleanSetting, withSetting } from '../core/audio/strip';
import * as show from '../core/show/show';
import { applyOps } from '../core/show/ops';
import { rig, build } from './helpers';
import type { Bus } from '../core/show/types';
import type { CueEngine } from '../core/engine/cue-engine';

/** A line of Active Cues that is a sound (it has the loops armed on it). */
type SoundRow = Extract<ReturnType<CueEngine['active']>[number], { armed: unknown }>;

test('a bus at rest changes nothing', () => {
  assert.deepStrictEqual(stripOf({ id: 'music', name: 'Music', db: -3 } as Bus), { name: 'music', low: 0, mid: 0, high: 0, filter: null, pan: 0, gate: 1 });
});

test('the filter knob: a low-pass to the left, a high-pass to the right, out in the middle', () => {
  assert.strictEqual(filterOf(0), null);
  assert.strictEqual(filterOf(0.01), null);
  assert.deepStrictEqual(filterOf(-1), { type: 'lowpass', hz: 80 });
  assert.deepStrictEqual(filterOf(1), { type: 'highpass', hz: 8000 });
  assert.ok(filterOf(-0.5)!.hz > 80 && filterOf(-0.5)!.hz < 20000);
  assert.ok(filterOf(0.25)!.hz < filterOf(0.75)!.hz);
});

test('the crossfader: both sides full in the middle, one gone at the other end', () => {
  assert.strictEqual(crossGain('a', 0), 1);
  assert.strictEqual(crossGain('b', 0), 1);
  assert.strictEqual(crossGain('a', -1), 1);
  assert.strictEqual(crossGain('a', 1), 0);
  assert.strictEqual(crossGain('b', -1), 0);
  assert.strictEqual(crossGain('', 1), 1);                       // a track on neither side is not touched
  assert.ok(crossGain('a', 0.5) > 0.7 && crossGain('a', 0.5) < 0.71);
});

test('mute silences a bus; a solo silences every other', () => {
  const music = { id: 'music', mute: true }, fx = { id: 'effects' }, vox = { id: 'vocals', xf: 'b' };
  assert.strictEqual(stripOf(music).gate, 0);
  assert.strictEqual(stripOf(fx, { solo: ['vocals'] }).gate, 0);
  assert.strictEqual(stripOf(vox, { solo: ['vocals'] }).gate, 1);
  assert.strictEqual(stripOf(vox, { solo: ['vocals'], crossfader: -1 }).gate, 0);     // a soloed track still obeys the crossfader
  assert.strictEqual(stripOf({ id: 'music', mute: true }, { solo: ['music'] }).gate, 0);  // and its own mute
});

test('a setting is made safe before it is heard or kept', () => {
  assert.strictEqual(cleanSetting('eq.low', -200), -40);
  assert.strictEqual(cleanSetting('eq.high', 3.26), 3.5);
  assert.strictEqual(cleanSetting('pan', 0.013), 0);
  assert.strictEqual(cleanSetting('pan', 7), 1);
  assert.strictEqual(cleanSetting('xf', 'c'), '');
  assert.strictEqual(cleanSetting('db', 3), undefined);
  assert.deepStrictEqual(withSetting({ id: 'm', eq: { low: -3 } }, 'eq.mid', 2), { id: 'm', eq: { low: -3, mid: 2 } });
});

test('strip settings live in the show file and survive a save', () => {
  let doc = show.newShow('T');
  doc = applyOps(doc, [{ op: 'show.set', path: 'settings.audio.buses.0.eq.low', value: -40 }, { op: 'show.set', path: 'settings.audio.buses.0.xf', value: 'a' },
    { op: 'show.set', path: 'settings.audio.buses.1.pan', value: -0.5 }, { op: 'show.set', path: 'settings.audio.crossfader', value: 0.25 }]).doc;
  const again = show.normalise(JSON.parse(JSON.stringify(doc))).doc;
  assert.deepStrictEqual(again.settings.audio.buses[0].eq, { low: -40 });
  assert.strictEqual(again.settings.audio.buses[0].xf, 'a');
  assert.strictEqual(again.settings.audio.buses[1].pan, -0.5);
  assert.strictEqual(again.settings.audio.crossfader, 0.25);
});

test('a loop of any length can be held from where the track is, and let go', () => {
  const { doc, id } = build([{ op: 'cue.add', ref: 'a', cue: { type: 'audio', name: 'Track', file: 'media/t.wav' } }]);
  const r = rig(doc);
  r.engine.setDuration('media/t.wav', 60);
  r.engine.go();
  r.advance(10);
  const a = id('a');
  assert.strictEqual(r.engine.toggleHold(a, { start: 10, end: 14 }), null);            // not one of the track's own loops: refused…
  assert.strictEqual(r.engine.toggleHold(a, { start: 10, end: 14 }, true), 'armed');   // …unless it is asked for as a free loop
  const armed = (r.engine.active().find((x) => x.id === a) as SoundRow).armed;
  assert.deepStrictEqual(armed, [{ start: 10, end: 14 }]);
});
