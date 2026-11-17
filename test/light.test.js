// The app's own lighting: fixtures, the patch, the light commands a cue holds, and the rig that tracks and fades levels.
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('../core/light/fixtures');
const patchLib = require('../core/light/patch');
const commands = require('../core/light/commands');
const { createRig } = require('../core/light/rig');

const LIGHT = {
  universes: [{ id: 1, protocol: 'artnet', address: 0, host: '' }, { id: 2, protocol: 'sacn', address: 1, host: '' }],
  instruments: [
    { name: 'front', fixture: 'dimmer', universe: 1, address: 1 },
    { name: 'Side L', fixture: 'dimmer', universe: 1, address: 2 },
    { name: 'cyc', fixture: 'rgb', universe: 1, address: 10 },
    { name: 'par', fixture: 'dimmer-rgbw', universe: 1, address: 20 },
    { name: 'spot', fixture: 'mover-16', universe: 2, address: 101 },
    { name: '1', fixture: 'dimmer', universe: 2, address: 1 },
    { name: '2', fixture: 'dimmer', universe: 2, address: 2 },
    { name: '3', fixture: 'dimmer', universe: 2, address: 3 },
  ],
  groups: [{ name: 'wash', members: ['front', 'side l'] }, { name: 'colour', members: ['cyc', 'par'] }, { name: 'everything lit', members: ['wash', 'colour'] }],
};
const levelsOf = (text, p = patchLib.compile(LIGHT)) => Object.fromEntries(commands.evaluate(text, p).levels);

test('the fixture library: channels in DMX order, a default parameter, and a made-up intensity for a light with none', () => {
  const all = fixtures.all();
  assert.deepEqual([...all.keys()], ['dimmer', 'rgb', 'rgbw', 'rgba', 'dimmer-rgb', 'dimmer-rgbw', 'mover', 'mover-16']);
  assert.equal(all.get('dimmer').footprint, 1);
  assert.equal(all.get('rgbw').footprint, 4);
  assert.equal(all.get('mover-16').footprint, 5);
  assert.deepEqual(all.get('mover-16').params.map((p) => [p.key, p.offset, p.bits, p.home]), [['intensity', 0, 8, 0], ['pan', 1, 16, 50], ['tilt', 3, 16, 50]]);
  // an RGB light has no dimmer channel: its intensity scales its colours and takes no channel
  const rgb = all.get('rgb');
  assert.equal(rgb.virtual, true);
  assert.equal(rgb.default, 'intensity');
  assert.deepEqual(rgb.params.find((p) => p.key === 'intensity'), { key: 'intensity', bits: 8, home: 0, offset: -1, virtual: true });
  assert.equal(all.get('dimmer-rgb').virtual, false);
});

test('a fixture of the show’s own is written as text, one parameter a line', () => {
  const r = fixtures.parseText('intensity\nred\ngreen\nblue\npan 16\ntilt 16 home 40\n# a note\nstrobe\niris home 100');
  assert.equal(r.ok, true);
  assert.deepEqual(r.params, [
    { key: 'intensity', bits: 8, home: 0 }, { key: 'red', bits: 8, home: 100 }, { key: 'green', bits: 8, home: 100 }, { key: 'blue', bits: 8, home: 100 },
    { key: 'pan', bits: 16, home: 50 }, { key: 'tilt', bits: 16, home: 40 }, { key: 'strobe', bits: 8, home: 0 }, { key: 'iris', bits: 8, home: 100 },
  ]);
  const def = fixtures.all([{ id: 'wash7', name: 'Wash 7', params: r.params }]).get('wash7');
  assert.equal(def.footprint, 10);
  assert.equal(def.builtIn, false);
  // and it reads back as the same text
  assert.deepEqual(fixtures.parseText(fixtures.toText(def)).params, r.params);
  assert.match(fixtures.parseText('red\nred').why, /twice/);
  assert.match(fixtures.parseText('two words here').why, /line 1/);
  assert.match(fixtures.parseText('').why, /at least one/);
});

test('the patch: addresses, groups of groups, and what cannot work is reported, not thrown', () => {
  const p = patchLib.compile(LIGHT);
  assert.deepEqual(p.problems, []);
  assert.equal(p.instruments.get('side l').name, 'Side L');
  assert.deepEqual(p.resolve('WASH'), ['front', 'side l']);
  assert.deepEqual(p.resolve('everything lit'), ['front', 'side l', 'cyc', 'par']);
  assert.equal(p.resolve('all').length, 8);
  assert.equal(p.resolve('nobody'), null);
  assert.equal(patchLib.nextFree(p, 1, 1), 3);
  assert.equal(patchLib.nextFree(p, 1, 8), 25);       // 3–9 is seven channels: an eight-channel fixture goes after the par

  const bad = patchLib.compile({
    universes: [{ id: 1, protocol: 'artnet', address: 40000 }, { id: 1, protocol: 'sacn', address: 1 }, { id: 3, protocol: 'sacn', address: 0 }],
    instruments: [
      { name: 'a', fixture: 'rgbw', universe: 1, address: 1 }, { name: 'b', fixture: 'dimmer', universe: 1, address: 4 },
      { name: 'A', fixture: 'dimmer', universe: 1, address: 30 }, { name: 'all', fixture: 'dimmer' }, { name: '1-3', fixture: 'dimmer' }, { name: 'x.y', fixture: 'dimmer' },
      { name: 'end', fixture: 'mover-16', universe: 1, address: 510 }, { name: 'odd', fixture: 'laser' }, { name: 'far', fixture: 'dimmer', universe: 9, address: 1 },
      { name: 'loose', fixture: 'dimmer' },
    ],
    groups: [{ name: 'g', members: ['a', 'h', 'ghost'] }, { name: 'h', members: ['g', 'b'] }, { name: 'a', members: [] }],
  });
  const why = (where) => bad.problems.filter((x) => x.where === where).map((x) => x.why).join(' | ');
  assert.match(why('universe 1'), /0 to 32767/);
  assert.match(bad.problems.map((x) => x.why).join('|'), /is there twice/);
  assert.match(why('universe 3'), /1 to 63999/);
  assert.match(why('b'), /shares DMX channels with a/);
  assert.equal(bad.instruments.get('b').patched, false);
  assert.match(why('A'), /two instruments have this name/);
  assert.match(why('all'), /word the light commands use/);
  assert.match(why('1-3'), /range/);
  assert.match(why('x.y'), /character/);
  assert.match(why('end'), /does not fit/);
  assert.match(why('odd'), /not in the library/);
  assert.match(why('far'), /universe 9 is not set up/);
  assert.equal(bad.instruments.get('loose').patched, false);       // no address yet: fine, and not a problem
  assert.equal(why('loose'), '');
  assert.match(why('g'), /“ghost” is not an instrument or a group/);
  assert.deepEqual(bad.groups.get('g').members, ['a', 'b']);       // g holds h holds g: it stops there
  assert.match(why('a'), /already an instrument/);
  assert.doesNotThrow(() => patchLib.compile(null));
  assert.doesNotThrow(() => patchLib.compile({ instruments: 'no', groups: 7, universes: [null] }));
});

test('light commands: instruments, groups, all, parameters, colours, ranges and lists', () => {
  assert.deepEqual(levelsOf('front = 80'), { 'front.intensity': 80 });
  assert.deepEqual(levelsOf('FRONT=80%'), { 'front.intensity': 80 });
  assert.deepEqual(levelsOf('wash = 50'), { 'front.intensity': 50, 'side l.intensity': 50 });
  assert.deepEqual(levelsOf('side l = full\nfront = out'), { 'side l.intensity': 100, 'front.intensity': 0 });
  assert.deepEqual(levelsOf('cyc.red = 100'), { 'cyc.red': 100 });
  assert.deepEqual(levelsOf('cyc = 40'), { 'cyc.intensity': 40 });
  assert.deepEqual(levelsOf('cyc.colour = #ff8000'), { 'cyc.red': 100, 'cyc.green': 50.2, 'cyc.blue': 0 });
  assert.deepEqual(levelsOf('cyc.color = #000000'), { 'cyc.red': 0, 'cyc.green': 0, 'cyc.blue': 0 });
  assert.deepEqual(levelsOf('1 - 3 = 75'), { '1.intensity': 75, '2.intensity': 75, '3.intensity': 75 });
  assert.deepEqual(levelsOf('[1 - 2] = 10'), { '1.intensity': 10, '2.intensity': 10 });
  assert.deepEqual(levelsOf('1, 3, front = 20'), { '1.intensity': 20, '3.intensity': 20, 'front.intensity': 20 });
  assert.deepEqual(levelsOf('spot.pan = 33.33\nspot.tilt = home'), { 'spot.pan': 33.33, 'spot.tilt': 50 });
  assert.deepEqual(levelsOf('front = 33.33'), { 'front.intensity': 33.3 });      // an 8-bit level is kept to a tenth
  assert.deepEqual(levelsOf('front = 250\nside l = -4'), { 'front.intensity': 100, 'side l.intensity': 0 });
  assert.equal(Object.keys(levelsOf('all = 0')).length, 8);
  // a parameter on a group reaches the members that have it
  assert.deepEqual(levelsOf('everything lit.white = 30'), { 'par.white': 30 });
  assert.deepEqual(levelsOf('colour.red = 5'), { 'cyc.red': 5, 'par.red': 5 });
});

test('light commands: top to bottom, the later line wins; pass carves an exception; notes are skipped', () => {
  assert.deepEqual(levelsOf('all = 0\nfront = 60'), { ...Object.fromEntries(Object.keys(levelsOf('all = 0')).map((k) => [k, 0])), 'front.intensity': 60 });
  assert.deepEqual(levelsOf('wash = 50\nfront = pass'), { 'side l.intensity': 50 });
  assert.deepEqual(levelsOf('colour.colour = #ffffff\ncyc.red = pass'), { 'cyc.green': 100, 'cyc.blue': 100, 'par.red': 100, 'par.green': 100, 'par.blue': 100 });
  assert.deepEqual(levelsOf('# the opening look\n\n// warm\nfront = 10'), { 'front.intensity': 10 });
});

test('light commands: a line that cannot be read is reported with its line number, and the rest still count', () => {
  const r = commands.evaluate('front = 50\nnobody = 10\nfront\nfront = bright\nfront.zoom = 3\nfront = cue 12\nfront.colour = #ff0000\ncyc.colour = 50\n9 - 12 = 5\nfront = #ff0000', patchLib.compile(LIGHT));
  assert.deepEqual(Object.fromEntries(r.levels), { 'front.intensity': 50 });
  assert.deepEqual(r.errors.map((e) => e.line), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const why = r.errors.map((e) => e.why);
  assert.match(why[0], /no instrument or group “nobody”/);
  assert.match(why[1], /name = level/);
  assert.match(why[2], /is not a level/);
  assert.match(why[3], /parameter “zoom”/);
  assert.match(why[4], /pulled from another cue/);
  assert.match(why[5], /red, green and blue/);
  assert.match(why[6], /takes a colour/);
  assert.match(why[7], /numbered 9 to 12/);
  assert.match(why[8], /\.colour/);
});

test('levels are written back as text a person can read, and merged into a cue’s text where they are', () => {
  const p = patchLib.compile(LIGHT);
  const levels = new Map([['cyc.red', 20], ['front.intensity', 80], ['spot.pan', 12.5], ['cyc.intensity', 100]]);
  assert.equal(commands.format(levels, p), 'front = 80\ncyc = 100\ncyc.red = 20\nspot.pan = 12.5');
  // text → levels → text → the same levels
  assert.deepEqual(commands.evaluate(commands.format(levels, p), p).levels, levels);
  // Update: a line for that one level is rewritten in place; a group's line is left, and the new level added after it
  assert.equal(commands.merge('# look 1\nwash = 50\nfront = 60\ncyc.red = 5', new Map([['front.intensity', 70], ['side l.intensity', 20]]), p),
    '# look 1\nwash = 50\nfront = 70\ncyc.red = 5\nSide L = 20');
  assert.equal(commands.merge('', new Map([['front.intensity', 70]]), p), 'front = 70');
});

const dmx = (rig, universe, from, n) => [...rig.render().get(universe).subarray(from - 1, from - 1 + n)];

test('the rig renders DMX: 8- and 16-bit channels at their addresses, home levels, a made-up intensity scaling colours', () => {
  const rig = createRig();
  rig.setPatch(LIGHT);
  assert.deepEqual([...rig.render().keys()], [1, 2]);
  assert.equal(rig.render().get(1).length, 512);
  assert.deepEqual(dmx(rig, 1, 1, 2), [0, 0]);
  assert.deepEqual(dmx(rig, 2, 101, 5), [0, 0x80, 0x00, 0x80, 0x00]);       // the mover at home: dark, pan and tilt in the middle (32768)
  rig.run({ id: 'a', levels: 'front = 100\nside l = 50\ncyc = 50\ncyc.blue = 0\npar = 100\npar.white = 20\nspot = 10\nspot.pan = 25\nspot.tilt = 100' });
  assert.deepEqual(dmx(rig, 1, 1, 2), [255, 128]);
  assert.deepEqual(dmx(rig, 1, 10, 3), [128, 128, 0]);                      // red and green at 100 behind an intensity of 50; blue out
  assert.deepEqual(dmx(rig, 1, 20, 5), [255, 255, 255, 255, 51]);           // a real dimmer channel: the colours go out as they are
  assert.deepEqual(dmx(rig, 2, 101, 5), [26, 0x40, 0x00, 0xff, 0xff]);
  // an instrument with no address has levels and sends nothing
  rig.setPatch({ ...LIGHT, instruments: [...LIGHT.instruments, { name: 'loose', fixture: 'dimmer' }] });
  rig.run({ id: 'b', levels: 'loose = 100' });
  assert.equal(rig.level('loose.intensity'), 100);
  assert.equal(rig.level('front.intensity'), 100);                          // and a patch change kept what was live
  assert.equal(rig.render().get(1).reduce((a, b) => a + b, 0), 255 + 128 + 128 + 128 + 255 * 4 + 51);
});

test('levels track: a cue changes only what it names; a full-state cue sends the rest home', () => {
  const rig = createRig();
  rig.setPatch(LIGHT);
  rig.run({ id: 'a', levels: 'front = 80\ncyc = 100\ncyc.blue = 10' });
  rig.run({ id: 'b', levels: 'side l = 30' });
  assert.equal(rig.level('front.intensity'), 80);
  assert.equal(rig.level('side l.intensity'), 30);
  const s = rig.snapshot();
  assert.equal(s.instruments.find((i) => i.name === 'front').params[0].cue, 'a');
  assert.equal(s.instruments.find((i) => i.name === 'Side L').params[0].cue, 'b');
  assert.equal(s.latest, 'b');
  rig.run({ id: 'c', levels: 'side l = 40', block: true });
  assert.equal(rig.level('front.intensity'), 0);
  assert.equal(rig.level('side l.intensity'), 40);
  assert.equal(rig.level('cyc.blue'), 100);                                 // home for a colour is 100
  assert.equal(rig.level('cyc.intensity'), 0);
  assert.equal(rig.level('spot.pan'), 50);
});

test('a cue’s fade is driven from outside: progress moves it, a halt leaves it where it had got to', () => {
  const rig = createRig();
  rig.setPatch(LIGHT);
  rig.run({ id: 'a', levels: 'front = 20' });
  const r = rig.run({ id: 'b', levels: 'front = 100\nside l = 50', duration: 4 }, { external: true });
  assert.equal(r.count, 2);
  assert.equal(rig.level('front.intensity'), 20);                           // nothing moves until it is told how far it has got
  assert.deepEqual(rig.moving(), [{ id: 'b', external: true, x: 0 }]);
  rig.progress('b', 0.5);
  assert.equal(rig.level('front.intensity'), 60);
  assert.equal(rig.level('side l.intensity'), 25);
  assert.equal(rig.tick(999), true);                                        // its own clock does not move an engine's fade
  assert.equal(rig.level('front.intensity'), 60);
  rig.halt('b');
  assert.equal(rig.level('front.intensity'), 60);
  assert.equal(rig.progress('b', 1), false);
  // run again and let it land
  rig.run({ id: 'b', levels: 'front = 100', duration: 4 }, { external: true });
  rig.progress('b', 0.25); assert.equal(rig.level('front.intensity'), 70);
  rig.finish('b'); assert.equal(rig.level('front.intensity'), 100);
  assert.deepEqual(rig.moving(), []);
});

test('the latest word wins, parameter by parameter: a new fade takes a level from one still running', () => {
  const rig = createRig();
  rig.setPatch(LIGHT);
  rig.run({ id: 'a', levels: 'front = 100\nside l = 100', duration: 10 }, { external: true });
  rig.progress('a', 0.5);
  rig.run({ id: 'b', levels: 'front = 0', duration: 2 }, { external: true });
  rig.progress('a', 1);                                                     // a lands: side l arrives, front is no longer its
  assert.equal(rig.level('side l.intensity'), 100);
  assert.equal(rig.level('front.intensity'), 50);
  rig.progress('b', 1);
  assert.equal(rig.level('front.intensity'), 0);
});

test('a hand on the lights: at once or over a time, marked as changed, reverted to what the cues set', () => {
  const rig = createRig();
  rig.setPatch(LIGHT);
  rig.run({ id: 'a', levels: 'front = 40\nside l = 40' });
  assert.deepEqual(rig.set('front = 90'), { count: 1, errors: [] });
  assert.equal(rig.level('front.intensity'), 90);
  assert.equal(rig.changed(), 1);
  assert.equal(rig.snapshot().instruments[0].manual, true);
  rig.setLevel('Side L', null, 10, { secs: 2, now: 100 });
  assert.equal(rig.tick(101), true);
  assert.equal(rig.level('side l.intensity'), 25);
  assert.equal(rig.tick(102), false);
  assert.equal(rig.level('side l.intensity'), 10);
  assert.equal(rig.set('nobody = 3').errors.length, 1);
  // what to record: only the changes, or everything
  assert.deepEqual(Object.fromEntries(rig.capture({ changes: true })), { 'front.intensity': 90, 'side l.intensity': 10 });
  assert.equal(rig.capture().size, 17);
  assert.equal(rig.revert(), 2);
  assert.equal(rig.level('front.intensity'), 40);
  assert.equal(rig.changed(), 0);
  // recorded into a cue: no longer a hand's, and that cue is where it came from
  rig.set('front = 70');
  rig.recorded(['front.intensity'], 'z');
  assert.equal(rig.changed(), 0);
  assert.equal(rig.revert(), 0);
  assert.equal(rig.level('front.intensity'), 70);
  assert.equal(rig.snapshot().instruments[0].params[0].cue, 'z');
  // a level on its way somewhere is recorded as where it is going
  rig.set('front = 0', { secs: 5, now: 0 });
  rig.tick(1);
  assert.equal(rig.capture({ changes: true }).get('front.intensity'), 0);
});

test('a blackout takes every intensity out on the wire and leaves the levels alone; clear sends everything home', () => {
  const rig = createRig();
  rig.setPatch(LIGHT);
  rig.run({ id: 'a', levels: 'front = 100\ncyc = 100\npar = 100\nspot = 100\nspot.pan = 25' });
  rig.setBlackout(true);
  assert.deepEqual(dmx(rig, 1, 1, 1), [0]);
  assert.deepEqual(dmx(rig, 1, 10, 3), [0, 0, 0]);                          // colour channels behind a made-up intensity
  assert.deepEqual(dmx(rig, 1, 20, 5), [0, 255, 255, 255, 0]);              // a real dimmer channel goes out; its colours stay put
  assert.deepEqual(dmx(rig, 2, 101, 5), [0, 0x40, 0x00, 0x80, 0x00]);       // a moving head goes dark and does not swing home
  assert.equal(rig.level('front.intensity'), 100);
  assert.equal(rig.snapshot().blackout, true);
  rig.setBlackout(false);
  assert.deepEqual(dmx(rig, 1, 1, 1), [255]);
  rig.clear();
  assert.equal(rig.level('front.intensity'), 0);
  assert.equal(rig.level('spot.pan'), 50);
  assert.equal(rig.snapshot().latest, null);
});

test('a Fade aimed at a Light cue takes what that cue set back home, or to its levels again', () => {
  const rig = createRig();
  rig.setPatch(LIGHT);
  const special = { id: 'sp', levels: 'spot = 100\nspot.pan = 20' };
  rig.run({ id: 'a', levels: 'front = 50' });
  rig.run(special);
  rig.fadeCue('f', special, { out: true, secs: 3, external: true });
  rig.progress('f', 0.5);
  assert.equal(rig.level('spot.intensity'), 50);
  assert.equal(rig.level('spot.pan'), 35);
  rig.finish('f');
  assert.equal(rig.level('spot.intensity'), 0);
  assert.equal(rig.level('front.intensity'), 50);                           // what other cues set is not touched
  rig.fadeCue('g', special, { out: false });
  assert.equal(rig.level('spot.intensity'), 100);
});

test('the dashboard’s picture: each instrument’s level, its colour as data, groups with mixed members', () => {
  const rig = createRig();
  rig.setPatch(LIGHT);
  rig.run({ id: 'a', levels: 'front = 100\nside l = 20\ncyc = 80\ncyc.colour = #ff8000' });
  const s = rig.snapshot();
  const cyc = s.instruments.find((i) => i.name === 'cyc');
  assert.equal(cyc.level, 80);
  assert.equal(cyc.colour, '#ff8000');
  assert.equal(cyc.address, 10); assert.equal(cyc.footprint, 3); assert.equal(cyc.patched, true);
  assert.equal(s.instruments.find((i) => i.name === 'front').colour, null);
  const wash = s.groups.find((g) => g.name === 'wash');
  assert.deepEqual([wash.level, wash.mixed, wash.members], [100, true, ['front', 'Side L']]);
  assert.equal(s.changed, 0);
});
