/**
 * The prop kit (core/kit/): the generator that sets firmware up for one prop, and the two sketches as text.
 * The sketches are compiled by hand with arduino-cli, never here, and have never run on a board: what is
 * checked is that each speaks every address of the protocol and carries the six rules' markers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const kit = require('../core/kit/kit');
const showFiles = require('../core/show/files');
const models = require('../core/net/devices');

const lantern = { id: 'lantern_a', name: 'Lantern A', model: 'ec-prop-light' };
const text = (files, name) => files.find((f) => f.path.endsWith(name)).text;
const FW = path.join(__dirname, '../core/kit/firmware');

test('a light: the pin, the count, the order and the name are in config.h, and every file is under props/<id>/', () => {
  const files = kit.files(lantern, { pin: 13, count: 12, order: 'RGB', look: { r: 10, g: 20, b: 30, level: 0.25, effect: 'breathe' }, address: '10.0.0.42' });
  assert.deepEqual(files.map((f) => f.path), ['props/lantern_a/lantern_a.ino', 'props/lantern_a/ec_osc.h', 'props/lantern_a/config.h', 'props/lantern_a/secrets.h', 'props/lantern_a/README.md', 'props/.gitignore']);
  const config = text(files, 'config.h');
  for (const line of ['#define PROP_NAME   "lantern_a"', '#define LED_PIN   13', '#define LED_COUNT 12', '#define LED_ORDER NEO_RGB', '#define OWN_R      10', '#define OWN_LEVEL  0.25', '#define OWN_EFFECT "breathe"', '#define FIXED_ADDRESS "10.0.0.42"', '#define EC_PORT     53100', '#define OTA         0']) assert.ok(config.includes(line), line);
  assert.match(config, /const Look LOOKS\[8\]/);
  assert.equal(text(files, '.ino'), fs.readFileSync(path.join(FW, 'prop-light/prop-light.ino'), 'utf8'), 'the sketch is the kit’s, unchanged');
  assert.equal(text(files, '.gitignore'), 'secrets.h\nbuild/\n');
  // they are files a proposal may carry
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ec-kit-'));
  assert.equal(showFiles.check(dir, files).ok, true);
});

test('the Wi-Fi password is a placeholder and never an option; the name of the network may be given', () => {
  assert.ok(!kit.OPTIONS.some((o) => /pass/i.test(o.key)));
  assert.match(text(kit.files(lantern), 'secrets.h'), /#define WIFI_SSID "CHANGE-ME"[\s\S]*#define WIFI_PASS "CHANGE-ME"/);
  const named = text(kit.files(lantern, { ssid: 'Stage "B"' }), 'secrets.h');
  assert.match(named, /#define WIFI_SSID "Stage \\"B\\""/);
  assert.match(named, /#define WIFI_PASS "CHANGE-ME"/);
  assert.throws(() => kit.files(lantern, { password: 'x' }), /no option “password”/);
});

test('a switch, a servo, another board; and what is refused, with the reason', () => {
  const sw = kit.files({ id: 'trap', name: 'Trap', model: 'ec-prop-switch' }, { output: 'servo', board: 'esp32-c3' });
  assert.match(text(sw, 'config.h'), /#define OUT_PIN {10}4 /, 'a C3’s usual pin');
  assert.match(text(sw, 'config.h'), /#define OUTPUT_KIND {6}OUTPUT_SERVO/);
  assert.equal(text(sw, 'trap.ino'), fs.readFileSync(path.join(FW, 'prop-switch/prop-switch.ino'), 'utf8'));
  const steps = text(sw, 'README.md');
  for (const words of ['ESP32C3 Dev Module', 'esp32:esp32:esp32c3', 'secrets.h', 'Look for props', 'read_flash', '2.4 GHz', 'has not yet been run on a board', '/ec/pulse']) assert.ok(steps.includes(words), words);
  assert.throws(() => kit.files(lantern, { pin: 0 }), /pin 0 cannot be used on ESP32[\s\S]*as it starts/);
  assert.throws(() => kit.files(lantern, { pin: 9, board: 'xiao-esp32c3' }), /cannot be used/);
  assert.throws(() => kit.files(lantern, { pin: 99 }), /GPIO number/);
  assert.throws(() => kit.files(lantern, { count: 0 }), /how many LEDs/);
  assert.throws(() => kit.files(lantern, { address: 'lantern.local' }), /fixed address/);
  assert.throws(() => kit.files(lantern, { look: { effect: 'strobe' } }), /look\.effect/);
  assert.throws(() => kit.files(lantern, { sketch: 'motor' }), /sketch is one of light, switch/);
  assert.throws(() => kit.files({ id: '../x', name: 'X' }), /device of the show/);
  for (const f of [...sw, ...kit.files(lantern)]) assert.ok(f.path === 'props/.gitignore' || /^props\/[a-z][a-z0-9_]*\/[^/]+$/.test(f.path), f.path);
});

test('the sketches: every address of the protocol, the six rules, no blocking wait, and the honest status (never compiled here, never run on a board)', () => {
  const light = fs.readFileSync(path.join(FW, 'prop-light/prop-light.ino'), 'utf8');
  const sw = fs.readFileSync(path.join(FW, 'prop-switch/prop-switch.ino'), 'utf8');
  const osc = fs.readFileSync(path.join(FW, 'ec_osc.h'), 'utf8');
  for (const a of ['/ec/hello', '/ec/identify', '/ec/look', '/ec/color', '/ec/level', '/ec/effect', '/ec/on', '/ec/off']) assert.ok(light.includes(a), `light ${a}`);
  for (const a of ['/ec/hello', '/ec/identify', '/ec/on', '/ec/off', '/ec/pulse', '/ec/level']) assert.ok(sw.includes(a), `switch ${a}`);
  assert.ok(osc.includes('/ec/here'));
  for (const s of [light, sw]) {
    for (let n = 1; n <= 6; n++) assert.ok(s.includes(`RULE ${n}`), `RULE ${n}`);
    assert.doesNotMatch(s.replace(/\/\/.*$/gm, ''), /\bdelay\s*\(/, 'nothing holds the loop');
    assert.match(s, /NEVER flashed to a board or run/);
    for (const inc of ['#include "config.h"', '#include "secrets.h"', '#include "ec_osc.h"']) assert.ok(s.includes(inc), inc);
  }
  // each sketch folder holds the same header as the kit's own
  for (const d of ['prop-light', 'prop-switch']) assert.equal(fs.readFileSync(path.join(FW, d, 'ec_osc.h'), 'utf8'), osc);
  // the example secrets hold no secret
  assert.match(fs.readFileSync(path.join(FW, 'prop-light/secrets.example.h'), 'utf8'), /WIFI_PASS "CHANGE-ME"/);
});

test('the kit’s models describe what the sketches speak, and the protocol text names every command', () => {
  const p = kit.protocol();
  for (const id of ['ec-prop-light', 'ec-prop-switch']) for (const c of models.DEVICES[id].commands) assert.ok(p.includes(c.template.split(' ')[0]), `${id} ${c.id}`);
  assert.match(p, /\/ec\/here <name:s> <kind:s light\|switch>/);
  assert.match(p, /port 53100/);
});
