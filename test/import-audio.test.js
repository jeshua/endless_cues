// What a QLab workspace's Audio and Fade cues bring across of rate and the integrated fade.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { importQlab, envelopeOf } = require('../core/import/qlab');
const show = require('../core/show/show');

test('an Audio cue’s rate comes across, with a note to check its pitch', () => {
  const file = path.join(__dirname, 'fixtures/small.qlab5');
  const { doc, report } = importQlab(fs.readFileSync(file), { file });
  let walk = null;
  show.walk(doc, (c) => { if (c.name === 'Walk-in 1') walk = c; });
  assert.equal(walk.rate, 1.1);
  assert.ok(report.issues.some((i) => i.cue.includes('Walk-in 1') && /plays at rate 1\.1/.test(i.why)));
  assert.equal(show.normalise(doc).warnings.length, 0, 'and the show it makes is a clean one');
});

test('an integrated fade is read as a level envelope over the stretch the cue plays, when it is written as points', () => {
  // (the shape guessed at: see envelopeOf; no real workspace has confirmed it)
  assert.deepEqual(envelopeOf({ integratedFade: { points: ['{0, 0}', '{0.25, 1}', '{1, 0.5}'] } }, 2, 10), [[2, -60], [4, 0], [10, -6]]);
  assert.deepEqual(envelopeOf({ integratedFadePoints: [{ x: 0, y: 1 }, { x: 1, y: 0 }] }, 0, 4), [[0, 0], [4, -60]]);
  assert.equal(envelopeOf({ integratedFade: { points: ['{0, 0}', 'nonsense'] } }, 0, 4), null);
  assert.equal(envelopeOf({ doFade: true }, 0, 4), null, 'nothing recognised: the report says to draw it again');
  assert.equal(envelopeOf({ integratedFade: [[0, 0], [1, 1]] }, 0, 0), null, 'a cue of unknown length cannot place it');
});
