/** Cue carts: a list drawn as a grid of buttons (core/show/cart.js), and the edits that make and fill one. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const show = require('../core/show/show');
const cart = require('../core/show/cart');
const { applyOps } = require('../core/show/ops');
const { diffShows, describe } = require('../core/show/diff');
const { importQlab } = require('../core/import/qlab');
const { rig } = require('./helpers');

const make = (ops) => applyOps(show.newShow('Test'), ops);

test('a cell is a row and a column from 1; anything else is not one', () => {
  assert.deepEqual(cart.parseCell('2,3'), [2, 3]);
  assert.deepEqual(cart.parseCell([1, 15]), [1, 15]);
  assert.deepEqual(cart.parseCell({ row: 4, column: 2 }), [4, 2]);
  assert.deepEqual(cart.parseCell('{2, 3}'), [2, 3]);
  for (const bad of ['0,1', '2', '16,1', 'a,b', [1], null, '1,2,3', 1.5]) assert.equal(cart.parseCell(bad), null, JSON.stringify(bad));
});

test('a cart is a list with a size; its cues sit where they say, and the rest take the free buttons in reading order', () => {
  const r = make([
    { op: 'list.add', name: 'Stings', cart: { rows: 2, columns: 3 } },
    { op: 'cue.add', ref: 'a', list: 'Stings', cue: { type: 'memo', name: 'A', cell: '2,3' } },
    { op: 'cue.add', ref: 'b', list: 'Stings', cue: { type: 'memo', name: 'B' } },
    { op: 'cue.add', ref: 'c', list: 'Stings', cue: { type: 'memo', name: 'C', cell: [1, 2] } },
    { op: 'cue.add', ref: 'd', list: 'Stings', cue: { type: 'memo', name: 'D', cell: '2,3' } },      // taken already
    { op: 'cue.add', ref: 'e', list: 'Stings', cue: { type: 'memo', name: 'E', cell: '9,9' } },      // outside the grid
  ]);
  const list = r.doc.lists[1];
  assert.deepEqual(list.cart, { rows: 2, columns: 3 });
  assert.equal(show.index(r.doc).byId.get(r.refs.c).cell, '1,2', 'a cell is kept in one way of writing it');
  const l = cart.layout(list);
  assert.deepEqual(l.cells, [r.refs.b, r.refs.c, r.refs.d, r.refs.e, null, r.refs.a]);
  assert.deepEqual(l.extra, []);
  assert.equal(cart.freeCell(list), '2,2');
  // the cart survives the file, and a plain list has no such key
  const again = show.normalise(JSON.parse(show.stringify(r.doc))).doc;
  assert.deepEqual(again.lists[1].cart, { rows: 2, columns: 3 });
  assert.equal('cart' in again.lists[0], false);
});

test('a cart that is too small says which cues have no button; resizing is an edit, and so is making it a list again', () => {
  let r = make([
    { op: 'list.add', name: 'Tiny', cart: { rows: 1, columns: 1 } },
    { op: 'cue.add', list: 'Tiny', cue: { type: 'memo', name: 'one' } },
    { op: 'cue.add', ref: 'two', list: 'Tiny', cue: { type: 'memo', name: 'two' } },
  ]);
  assert.deepEqual(cart.layout(r.doc.lists[1]).extra, [r.refs.two]);
  assert.deepEqual(show.problems(r.doc).map((p) => [p.id, p.level]), [[r.refs.two, 'warning']]);
  const bigger = applyOps(r.doc, [{ op: 'list.cart', id: 'Tiny', rows: 1, columns: 2 }]).doc;
  assert.deepEqual(show.problems(bigger), []);
  assert.match(describe(diffShows(r.doc, bigger)), /Tiny is a cart of 1 × 2/);
  const plain = applyOps(bigger, [{ op: 'list.cart', id: 'Tiny', rows: null }]).doc;
  assert.equal('cart' in plain.lists[1], false);
  assert.throws(() => applyOps(r.doc, [{ op: 'list.cart', id: 'Tiny', rows: 0, columns: 4 }]), /whole number from 1 to 15/);
  assert.throws(() => applyOps(r.doc, [{ op: 'cue.set', id: r.refs.two, props: { cell: 'top left' } }]), /a row and a column/);
});

test('a button starts its cue and the playhead of the list being run stays where it is', () => {
  const r = make([
    { op: 'cue.add', ref: 'main', cue: { type: 'audio', number: '1', file: 'media/a.wav' } },
    { op: 'list.add', name: 'Stings', cart: { rows: 2, columns: 2 } },
    { op: 'cue.add', ref: 'sting', list: 'Stings', cue: { type: 'audio', name: 'Sting', file: 'media/sting.wav' } },
  ]);
  const { engine, audio } = rig(r.doc);
  assert.equal(engine.playhead, r.refs.main);
  engine.start(r.refs.sting);
  assert.deepEqual(audio.calls.filter((c) => c[0] === 'play').map((c) => c[1]), [r.refs.sting]);
  assert.equal(engine.playhead, r.refs.main, 'the main list is still standing by on its cue');
  assert.equal(engine.listName, 'Main');
  assert.ok(engine.active().some((a) => a.id === r.refs.sting), 'and the button can show that it is running');
});

test('a QLab cart is imported as a cart, each cue on the button it was on', () => {
  const file = path.join(__dirname, 'fixtures', 'small.qlab5');
  const { doc, report } = importQlab(fs.readFileSync(file), { file });
  const stings = doc.lists.find((l) => l.name === 'Stings');
  assert.deepEqual(stings.cart, { rows: 2, columns: 3 });
  assert.deepEqual(stings.cues.map((c) => [c.name, c.cell]), [['Sting', '2,3'], ['Sting 2', undefined]]);
  const l = cart.layout(stings);
  assert.equal(l.cells[5], stings.cues[0].id);
  assert.equal(l.cells[0], stings.cues[1].id, 'a cue with no position takes the first free button');
  assert.equal(report.issues.some((i) => /cart/.test(i.why)), false);
});
