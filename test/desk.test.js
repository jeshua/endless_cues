// The Live view's desk: kept whole in a Mix cue and recalled, and played from keys and a MIDI controller.
const test = require('node:test');
const assert = require('node:assert');
const { deskOf, cleanDesk, recallOf, deskText, withSettings, settingsOf, stripOf } = require('../core/audio/strip');
const map = require('../core/audio/desk-map');
const cueTypes = require('../core/show/cue-types');
const { build } = require('./helpers');

const BUSES = [
  { id: 'music', name: 'Music', db: -3, eq: { low: -40 }, filter: -0.5, xf: 'a' },
  { id: 'effects', name: 'Effects', db: 0, pan: 0.25, mute: true },
  { id: 'vocals', name: 'Vocals', db: 0 },
];

test('a desk as it stands: every bus, only what is not at rest, and the crossfader', () => {
  assert.deepStrictEqual(deskOf(BUSES, 0.5), {
    buses: { music: { eq: { low: -40 }, filter: -0.5, xf: 'a' }, effects: { pan: 0.25, mute: true }, vocals: {} },
    crossfader: 0.5,
  });
});

test('recalling a desk sets every strip setting of the buses it names: what it leaves out goes to rest', () => {
  const r = recallOf({ buses: { music: { pan: -1 } }, crossfader: -1 });
  assert.deepStrictEqual(r.buses.music, { 'eq.low': 0, 'eq.mid': 0, 'eq.high': 0, filter: 0, pan: -1, mute: false, xf: '' });
  assert.strictEqual(r.buses.effects, undefined);                    // a bus it does not name stays where it is
  assert.strictEqual(r.crossfader, -1);
  // laid over the bus as the show has it, the sound is the desk's
  const now = withSettings(BUSES[0], r.buses.music);
  assert.deepStrictEqual(stripOf(now, { crossfader: r.crossfader }), { name: 'music', low: 0, mid: 0, high: 0, filter: null, pan: -1, gate: 1 });
  assert.deepStrictEqual(settingsOf(now), r.buses.music);
});

test('a desk is made safe to keep: values in range, nonsense dropped; no crossfader means it is left alone', () => {
  assert.deepStrictEqual(cleanDesk({ buses: { music: { eq: { low: -99, wat: 3 }, pan: 7, mute: 'yes', xf: 'q' }, bad: 4 }, extra: 1 }),
    { buses: { music: { eq: { low: -40 }, pan: 1, mute: true } } });
  assert.strictEqual(cleanDesk('desk'), null);
  assert.strictEqual(recallOf({ buses: {} }).crossfader, undefined);
  assert.strictEqual(deskText({ buses: { music: { mute: true, eq: { low: -6 } }, vocals: {} }, crossfader: -1 }, { music: 'Music' }), 'Music: muted, eq · vocals: at rest · crossfader 100% A');
});

test('a Mix cue keeps a desk beside its levels', () => {
  const { doc, id } = build([{ op: 'cue.add', ref: 'm', cue: { type: 'mix', levels: { music: -6 }, desk: { buses: { music: { filter: -2 } }, crossfader: 1 }, duration: 4 } }]);
  const cue = doc.lists[0].cues.find((c) => c.id === id('m'));
  assert.deepStrictEqual(cue.desk, { buses: { music: { filter: -1 } }, crossfader: 1 });
  assert.ok(cueTypes.TYPES.mix.fields.some((f) => f.key === 'desk'));
});

test('a mapping: what is pressed or moved, and what it does', () => {
  assert.deepStrictEqual(map.parseOn('cc 7'), { type: 'cc', number: 7, channel: 1 });
  assert.deepStrictEqual(map.parseOn('Key Q'), { type: 'key', key: 'q' });
  assert.strictEqual(map.parseOn('key escape'), null);               // Panic is never given away
  assert.strictEqual(map.onOfKey(' '), null);
  assert.strictEqual(map.onOfKey('q', { meta: true }), null);
  assert.strictEqual(map.onOfKey('Q'), 'key q');
  assert.deepStrictEqual(map.onOfMidi({ kind: 'cc', number: 7, value: 90, channel: 2 }), { on: 'cc 7 ch 2', value: 90 });
  assert.deepStrictEqual(map.onOfMidi({ kind: 'noteoff', number: 60, channel: 1 }), { on: 'note 60 ch 1', value: 0 });
  assert.strictEqual(map.onOfMidi({ kind: 'pc', number: 3 }), null);
  assert.strictEqual(map.parseTo('fader'), null);
  assert.strictEqual(map.parseTo('crossfader:music'), null);
  assert.deepStrictEqual(map.parseTo('eq.low:music'), { what: 'eq.low', arg: 'music' });
});

test('a button answers a key, a note on, or a controller pressed; never the release', () => {
  assert.deepStrictEqual(map.actionOf('launch:c_1', { type: 'key', value: 1 }), { op: 'launch', id: 'c_1' });
  assert.deepStrictEqual(map.actionOf('launch:c_1', { type: 'note', value: 100 }), { op: 'launch', id: 'c_1' });
  assert.strictEqual(map.actionOf('launch:c_1', { type: 'note', value: 0 }), null);
  assert.deepStrictEqual(map.actionOf('mute:music', { type: 'cc', value: 127 }), { op: 'mute', name: 'music' });
  assert.strictEqual(map.actionOf('mute:music', { type: 'cc', value: 0 }), null);
  assert.deepStrictEqual(map.actionOf('stop:music', { type: 'key', value: 1 }), { op: 'stop-track', name: 'music' });
  assert.deepStrictEqual(map.actionOf('stopall', { type: 'key', value: 1 }), { op: 'stop-clips' });
});

test('a controller moves a control across its travel, its rest in the middle where it has one', () => {
  const cc = (to, value) => map.actionOf(to, { type: 'cc', value });
  assert.deepStrictEqual(cc('fader:music', 0), { op: 'desk-live', key: 'db', value: -60, name: 'music' });
  assert.deepStrictEqual(cc('fader:music', 127), { op: 'desk-live', key: 'db', value: 12, name: 'music' });
  assert.ok(Math.abs(cc('fader:music', 85).value) <= 1.5, 'unity is about two thirds up');
  assert.strictEqual(cc('pan:music', 64).value, 0);
  assert.strictEqual(cc('pan:music', 0).value, -1);
  assert.strictEqual(cc('pan:music', 127).value, 1);
  assert.strictEqual(cc('eq.low:music', 0).value, -40);
  assert.strictEqual(cc('eq.low:music', 64).value, 0);
  assert.strictEqual(cc('eq.low:music', 127).value, 6);
  assert.deepStrictEqual(cc('crossfader', 127), { op: 'desk-live', key: 'crossfader', value: 1 });
  assert.deepStrictEqual(cc('master', 127), { op: 'desk-live', key: 'master', value: 12 });
  // a key on a knob sends it home
  assert.deepStrictEqual(map.actionOf('filter:music', { type: 'key', value: 1 }), { op: 'desk-live', key: 'filter', value: 0, name: 'music' });
});

test('assigning: an input does one thing; a control has one key and one MIDI control', () => {
  let m = map.assign([], 'key q', 'launch:c_1');
  m = map.assign(m, 'cc 7 ch 1', 'fader:music');
  m = map.assign(m, 'key q', 'launch:c_2');                           // q is taken from the first clip
  assert.deepStrictEqual(m, [{ on: 'cc 7 ch 1', to: 'fader:music' }, { on: 'key q', to: 'launch:c_2' }]);
  m = map.assign(m, 'key w', 'launch:c_2');                           // the clip's key is now w, not q
  m = map.assign(m, 'note 36 ch 10', 'launch:c_2');                   // …and it keeps a pad as well
  assert.deepStrictEqual(m.filter((x) => x.to === 'launch:c_2').map((x) => x.on), ['key w', 'note 36 ch 10']);
  assert.deepStrictEqual(map.matching(m, 'key w'), [{ on: 'key w', to: 'launch:c_2' }]);
  m = map.assign(m, null, 'launch:c_2');
  assert.deepStrictEqual(m, [{ on: 'cc 7 ch 1', to: 'fader:music' }]);
  assert.deepStrictEqual(map.cleanMap([{ on: 'key escape', to: 'stopall' }, { on: 'cc 200', to: 'master' }, { on: 'key a', to: 'nothing' }, null]), []);
});
