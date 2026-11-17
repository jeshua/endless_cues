// Dragging on a sound's waveform (app/renderer/edit-math.js, a module of the window with no imports, loaded here as
// it is there): snapping a time, moving several points of a line together, bending a segment, moving markers and
// loop regions.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

let E;
test.before(async () => {
  const src = fs.readFileSync(path.join(__dirname, '../app/renderer/edit-math.js'), 'utf8');
  E = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
});

test('a time snaps lightly to the nearest mark within a few pixels, and never with Shift', () => {
  const marks = [1, 2, 2.5];
  assert.strictEqual(E.snapTime(2.04, marks, 100), 2, '4 px away: it snaps');
  assert.strictEqual(E.snapTime(2.1, marks, 100), 2.1, '10 px away: it stays');
  assert.strictEqual(E.snapTime(2.04, marks, 100, true), 2.04, 'fine: no snap');
  assert.strictEqual(E.snapTime(2.26, marks, 20), 2.5, 'zoomed out, the same pixels are more time: to the nearer');
  assert.strictEqual(E.snapTime(3, [], 100), 3);
});

test('the beats of a tempo, section by section', () => {
  assert.deepEqual(E.beatsOf([{ from: 0, bpm: 120, first: 0.25, bar: 4 }], 2), [0.25, 0.75, 1.25, 1.75]);
  const two = E.beatsOf([{ from: 0, bpm: 60, first: 0, bar: 4 }, { from: 3, bpm: 120, first: 3, bar: 4 }], 4.2);
  assert.deepEqual(two, [0, 1, 2, 3, 3.5, 4]);
});

test('points moved together stop at a point that is not moving, at the sound’s ends and at the picture’s edges', () => {
  const pts = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  const ys = [50, 50, 20, 50, 90];
  const sel = new Set([1, 2]);
  assert.deepEqual(E.groupMove(pts, ys, sel, 0.5, 10, 10, 100), { dt: 0.5, dy: 10 });
  assert.strictEqual(E.groupMove(pts, ys, sel, 5, 0, 10, 100).dt, 0.99, 'not past the point at 3 s');
  assert.strictEqual(E.groupMove(pts, ys, sel, -5, 0, 10, 100).dt, -0.99, 'not past the point at 0 s');
  assert.strictEqual(E.groupMove(pts, ys, sel, 0, -60, 10, 100).dy, -20, 'the highest of them stops at the top');
  assert.strictEqual(E.groupMove(pts, ys, new Set([4]), 99, 99, 10, 100).dt, 6, 'the last one, to the end of the sound');
  assert.strictEqual(E.groupMove(pts, ys, new Set([4]), 0, 99, 10, 100).dy, 10, 'and to the foot of the picture');
});

test('an ⌥-drag up bulges a segment up whichever way it runs; the bend stays between −1 and 1', () => {
  assert.ok(E.bendFromDrag(0, 30, true) < 0, 'a rising line bulging up starts fast');
  assert.ok(E.bendFromDrag(0, 30, false) > 0, 'a falling line bulging up starts slow');
  assert.strictEqual(E.bendFromDrag(0.9, -600, true), 1);
  assert.strictEqual(E.bendFromDrag(0, 0, true), 0);
  assert.strictEqual(E.segmentAt([[0, 0], [2, 0], [5, 0]], 3), 1);
  assert.strictEqual(E.segmentAt([[1, 0], [2, 0]], 0.5), -1);
});

test('a marker moved stays inside the sound and the markers stay in time order; null removes it', () => {
  const ms = [{ at: 1, name: 'A' }, { at: 3, name: 'B' }];
  assert.deepEqual(E.moveMarker(ms, 0, 4, 10).map((m) => m.name), ['B', 'A']);
  assert.strictEqual(E.moveMarker(ms, 1, 12, 10).find((m) => m.name === 'B').at, 10);
  assert.strictEqual(E.moveMarker(ms, 1, -1, 10).find((m) => m.name === 'B').at, 0);
  assert.deepEqual(E.moveMarker(ms, 0, null, 10), [{ at: 3, name: 'B' }]);
  assert.strictEqual(ms[0].at, 1, 'the cue’s own list is left alone');
});

test('a loop region: an edge never passes the other, the middle moves it whole and keeps it inside the sound', () => {
  const g = { start: 2, end: 4, name: 'Vamp' };
  assert.deepEqual(E.moveRegion(g, 'start', 3, 10), { start: 3, end: 4, name: 'Vamp' });
  assert.strictEqual(E.moveRegion(g, 'start', 5, 10).start, 3.95);
  assert.strictEqual(E.moveRegion(g, 'end', 1, 10).end, 2.05);
  assert.strictEqual(E.moveRegion(g, 'end', 12, 10).end, 10);
  assert.deepEqual(E.moveRegion(g, 'body', 6.5, 10, 0.5), { start: 6, end: 8, name: 'Vamp' });
  assert.deepEqual(E.moveRegion(g, 'body', 9.9, 10, 0.5), { start: 8, end: 10, name: 'Vamp' });
  assert.deepEqual(E.moveRegion(g, 'body', 0.1, 10, 0.5), { start: 0, end: 2, name: 'Vamp' });
});
