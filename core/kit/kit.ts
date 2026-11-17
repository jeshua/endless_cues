/**
 * The prop kit: firmware for a light or a switch on an ESP32, set up for one prop of one show.
 *
 * The kit is two Arduino sketches and a header (core/kit/firmware/), one protocol (PROTOCOL below; the
 * models ec-prop-light and ec-prop-switch in core/net/devices.ts describe it to the app), and this
 * generator, which fills in a prop's settings and writes the steps for putting it on the board. Nothing
 * here is written by a model: the assistant's make_prop_files and the Rig's "Write firmware…" both call
 * `files` with a few options, and the text is the kit's own.
 *
 *   OPTIONS                  what may be set, with defaults (the tool's schema and the Rig's form read it)
 *   BOARDS                   the boards the steps know by name, with each one's usual pin and the pins to keep off
 *   files(device, options)   → [{ path, text }] under props/<device id>/ (and props/.gitignore); throws, with the
 *                            sentence to show, for an option that cannot be used (a boot pin, an address that is not one)
 *   protocol()               the kit's protocol as text, for the steps and for the guide for coding agents
 *
 * The files are staged on a proposal and written when a person accepts it (core/show/files.ts), and
 * secrets.h, once it is there, is never replaced: it holds the person's Wi-Fi password, which is never
 * asked for, never in a show and never sent to a model.
 *
 * NOT RUN ON HARDWARE: the sketches compile for an ESP32; no board has ever been flashed with them. The
 * steps this writes say so.
 */
import * as fs from 'fs';
import * as path from 'path';

/** A board the steps know by name: its usual pin, its highest, and the pins to keep off (and why). */
export interface KitBoard { label: string; name: string; fqbn: string; pin: number; top: number; avoid: Record<number, string>; note?: string }
/** One option of `files` (OPTIONS). */
export interface KitOption {
  key: string; kind: string; options?: string[]; default: unknown; label: string; labels?: Record<string, string>; help: string;
  min?: number; max?: number; only?: string;
}
/** A prop's look at power-on. */
export interface KitLook { r: number; g: number; b: number; level: number; effect: string }
/** The options as `settle` leaves them. */
export interface KitSettings { sketch: string; board: string; pin: number; count: number; order: string; output: string; ssid: string; address: string; look: KitLook }
/** What the kit reads of the device a prop is. */
export interface KitDevice { id: string; name?: string; model?: string }

const FIRMWARE = path.join(__dirname, 'firmware');
const ID = /^[a-z][a-z0-9_]{0,31}$/;
const STATUS = 'This firmware compiles for an ESP32 and has not yet been run on a board by the people who wrote it. If it does something other than these steps say, the steps are wrong, not you.';

const flashPins = (from: number, to: number) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_x, i) => [from + i, 'it is wired to the board’s own memory chip']));
const BOOT = 'the board reads it as it starts, to decide how to start: something wired to it can stop the board starting';
const ESP32: Record<number, string> = { 0: BOOT, 2: BOOT, 12: BOOT, 15: BOOT, 1: 'it is the serial port’s', 3: 'it is the serial port’s', ...flashPins(6, 11), 34: 'it is an input only', 35: 'it is an input only', 36: 'it is an input only', 39: 'it is an input only' };
const C3: Record<number, string> = { 2: BOOT, 8: BOOT, 9: BOOT, ...flashPins(11, 17), 18: 'it is the USB port’s', 19: 'it is the USB port’s', 20: 'it is the serial port’s', 21: 'it is the serial port’s' };
const S3: Record<number, string> = { 0: BOOT, 3: BOOT, 45: BOOT, 46: BOOT, 19: 'it is the USB port’s', 20: 'it is the USB port’s', ...flashPins(26, 32), 43: 'it is the serial port’s', 44: 'it is the serial port’s' };
/** `name` is what the Arduino IDE's board menu calls it; `fqbn` what arduino-cli does; `pins` how many GPIO numbers it has. */
const BOARDS: Record<string, KitBoard> = {
  esp32dev: { label: 'ESP32 (a DevKit, a WROOM board)', name: 'ESP32 Dev Module', fqbn: 'esp32:esp32:esp32', pin: 5, top: 33, avoid: ESP32 },
  'esp32-c3': { label: 'ESP32-C3', name: 'ESP32C3 Dev Module', fqbn: 'esp32:esp32:esp32c3', pin: 4, top: 21, avoid: C3 },
  'esp32-s3': { label: 'ESP32-S3', name: 'ESP32S3 Dev Module', fqbn: 'esp32:esp32:esp32s3', pin: 5, top: 48, avoid: S3 },
  'xiao-esp32c3': { label: 'Seeed XIAO ESP32-C3', name: 'XIAO_ESP32C3', fqbn: 'esp32:esp32:XIAO_ESP32C3', pin: 4, top: 21, avoid: C3, note: 'On a XIAO the pads are lettered: GPIO 4 is the pad marked D2.' },
};
const EFFECTS = ['steady', 'breathe', 'pulse', 'flicker'];
const OWN_LOOK: KitLook = { r: 255, g: 180, b: 100, level: 0.4, effect: 'steady' };

/** What may be set. `only`: the option belongs to one sketch. */
const OPTIONS: KitOption[] = [
  { key: 'sketch', kind: 'enum', options: ['light', 'switch'], default: 'light', label: 'What it is', labels: { light: 'A light (a strip of addressable LEDs)', switch: 'A switch (a relay, or a servo)' }, help: 'light: a WS2812 or WS2811 strip. switch: a relay on a pin, or a servo.' },
  { key: 'board', kind: 'enum', options: Object.keys(BOARDS), default: 'esp32dev', label: 'Board', labels: Object.fromEntries(Object.entries(BOARDS).map(([k, b]) => [k, b.label])), help: 'Which ESP32 board: it chooses the board name the steps say to pick, and the usual pin.' },
  { key: 'pin', kind: 'integer', default: null, label: 'Pin', help: 'The GPIO number the strip’s data wire, the relay or the servo is on. Left out: 5 (on a C3: 4). A pin the board needs for starting up is refused.' },
  { key: 'count', kind: 'integer', default: 30, min: 1, max: 1000, only: 'light', label: 'LEDs', help: 'How many LEDs are on the strip.' },
  { key: 'order', kind: 'enum', options: ['GRB', 'RGB', 'BRG'], default: 'GRB', only: 'light', label: 'Colour order', help: 'GRB for most WS2812 strips, RGB for most WS2811. If red and green come out swapped, it is the other one.' },
  { key: 'output', kind: 'enum', options: ['relay', 'servo'], default: 'relay', only: 'switch', label: 'It drives', help: 'A relay (on and off), or a servo (a position between its two ends).' },
  { key: 'ssid', kind: 'text', default: '', label: 'Network name', help: 'The Wi-Fi network’s name, if the person said it. Not a secret. The password is, and is never given here: the person types it into secrets.h.' },
  { key: 'address', kind: 'text', default: '', label: 'Fixed address', help: 'An address the prop takes for itself (10.0.0.42). Empty: the router gives it one, and the steps say to reserve it.' },
  { key: 'look', kind: 'look', default: OWN_LOOK, only: 'light', label: 'Its own look', help: 'What a light shows at power-on, before anyone has told it anything: { r, g, b (0–255), level (0–1), effect (steady, breathe, pulse, flicker) }. Default: warm white at 40%, steady.' },
];

const refuse = (message: string): never => { const e = new Error(message); e.name = 'OpError'; throw e; };
const read = (...parts: string[]) => fs.readFileSync(path.join(FIRMWARE, ...parts), 'utf8');
const cString = (s: unknown) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Set one `#define NAME value` of a header, keeping the line's own comment. A name the header does not have is a bug here, said loudly. */
function define(text: string, name: string, value: unknown): string {
  const re = new RegExp(`^(#define\\s+${name}\\b[ \\t]+)(?:"(?:[^"\\\\]|\\\\.)*"|\\S+)([ \\t]*(?://.*)?)$`, 'm');
  if (!re.test(text)) throw new Error(`the kit's header has no #define ${name}`);
  return text.replace(re, (_m, head: string, tail: string) => `${head}${value}${tail}`);
}
/** A header from the kit with its opening comment replaced by one for this prop. */
const body = (text: string) => text.slice(text.search(/^#define/m));

/** The options as they will be used: defaults filled in, each one checked. */
function settle(device: KitDevice | null | undefined, options: Record<string, unknown> | null = {}): KitSettings {
  if (!device || !ID.test(String(device.id || ''))) refuse('firmware is written for a device of the show: it has none with that id');
  const o: Record<string, any> = {};
  for (const k of Object.keys(options || {})) if (!OPTIONS.some((f) => f.key === k)) refuse(`there is no option “${k}” (the options: ${OPTIONS.map((f) => f.key).join(', ')})`);
  for (const f of OPTIONS) o[f.key] = options![f.key] === undefined || options![f.key] === null || options![f.key] === '' ? f.default : options![f.key];
  // a device made from the switch's model is a switch unless told otherwise
  if (options!.sketch === undefined && device!.model === 'ec-prop-switch') o.sketch = 'switch';
  for (const f of OPTIONS.filter((x) => x.kind === 'enum')) if (!f.options!.includes(o[f.key])) refuse(`${f.key} is one of ${f.options!.join(', ')} (it was given ${JSON.stringify(o[f.key])})`);
  const board = BOARDS[o.board];
  if (o.pin === null) o.pin = board.pin;
  if (!Number.isInteger(o.pin) || o.pin < 0 || o.pin > board.top) refuse(`pin is a GPIO number, 0 to ${board.top} on this board (it was given ${JSON.stringify(o.pin)})`);
  if (board.avoid[o.pin]) refuse(`pin ${o.pin} cannot be used on ${board.label}: ${board.avoid[o.pin]}. Use another (${board.pin} is the usual one).`);
  if (!Number.isInteger(o.count) || o.count < 1 || o.count > 1000) refuse(`count is how many LEDs, 1 to 1000 (it was given ${JSON.stringify(o.count)})`);
  if (typeof o.ssid !== 'string' || o.ssid.length > 32 || /[\r\n\0]/.test(o.ssid)) refuse('ssid is the network’s name: at most 32 characters, on one line');
  if (o.address) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(o.address).trim());
    if (!m || m.slice(1).some((n) => Number(n) > 255) || Number(m[4]) === 0 || Number(m[4]) === 255) refuse(`address is a fixed address on the show’s network, such as 10.0.0.42 (it was given ${JSON.stringify(o.address)})`);
    o.address = m!.slice(1).map(Number).join('.');
  }
  const look: Record<string, any> = { ...OWN_LOOK, ...(o.look && typeof o.look === 'object' ? o.look : {}) };
  for (const k of ['r', 'g', 'b']) { if (!Number.isFinite(Number(look[k])) || look[k] < 0 || look[k] > 255) refuse(`look.${k} is 0 to 255`); look[k] = Math.round(Number(look[k])); }
  if (!Number.isFinite(Number(look.level)) || look.level < 0 || look.level > 1) refuse('look.level is 0 to 1');
  if (!EFFECTS.includes(look.effect)) refuse(`look.effect is one of ${EFFECTS.join(', ')}`);
  o.look = { ...look, level: Number(look.level) };
  return o as KitSettings;
}

/** The kit's protocol, version 1, as text (docs/specs/15-assistant-and-rig.md, 6.1). */
function protocol() {
  return [
    'OSC 1.0 over UDP. The prop listens on port 53100. It never needs the show computer: every rule holds with it switched off.',
    '',
    'To the prop:',
    '',
    '    /ec/hello                          it answers /ec/here to whoever asked',
    '    /ec/identify                       shows itself for 2 s (a light blinks white) and goes back to what it was doing',
    '    /ec/look <n> [secs]                look n: 0 is the one it starts with, 1 to 8 are the looks in config.h; over secs',
    '    /ec/color <r> <g> <b> [secs]       a light: this colour, each 0 to 255',
    '    /ec/level <level> [secs]           a light: brightness 0 to 1. A servo: its position, 0 to 1 between its two ends',
    '    /ec/effect <name> [speed]          a light: steady | breathe | pulse | flicker; speed 1 is normal',
    '    /ec/on [secs]   /ec/off [secs]     a switch: on, off. A light: its last look, dark',
    '    /ec/pulse <ms>                     a switch: on for that long, then off',
    '',
    'Numbers may be sent as OSC ints or floats. Any message may end with one more string argument that begins with #',
    '(#a41f07). The prop acts once on each such id (it remembers the last eight) and ignores a repeat, so a command can be',
    'sent three times over poor Wi-Fi and a relay still fires once. Endless Cues does this for a device whose "resend" is set.',
    '',
    'From the prop, only ever in answer to /ec/hello:',
    '',
    '    /ec/here <name:s> <kind:s light|switch> <firmware:s> <state:s> <uptime:i seconds> <signal:i dBm> <battery:i percent, -1 not known>',
    '',
    'state is one word a person can read: own (its own look: nobody has told it anything), look3, breathe, on, off.',
  ].join('\n');
}

function configFor(device: KitDevice, o: KitSettings): string {
  const light = o.sketch === 'light';
  let text = body(read(light ? 'prop-light' : 'prop-switch', 'config.h'));
  const set = (name: string, value: unknown) => { text = define(text, name, value); };
  set('PROP_NAME', cString(device.id));
  set('BOARD_LABEL', cString(o.board));
  set('FIXED_ADDRESS', cString(o.address || ''));
  if (light) {
    set('LED_PIN', o.pin); set('LED_COUNT', o.count); set('LED_ORDER', `NEO_${o.order}`);
    set('OWN_R', o.look.r); set('OWN_G', o.look.g); set('OWN_B', o.look.b);
    set('OWN_LEVEL', Number(o.look.level).toFixed(2)); set('OWN_EFFECT', cString(o.look.effect));
  } else {
    set('OUT_PIN', o.pin); set('OUTPUT_KIND', o.output === 'servo' ? 'OUTPUT_SERVO' : 'OUTPUT_RELAY');
  }
  return [
    `// config.h: the settings of ${device.name || device.id}, ${light ? 'a light' : `a switch (a ${o.output})`}.`,
    '//',
    '// Written by Endless Cues for this prop. Everything about the prop that is not a secret is here, and the',
    '// sketch has no other line that is this prop’s alone. Change a value and upload again; asking Endless Cues',
    '// to write the firmware again writes this file again.',
    '//',
    `// PROP_NAME is the device’s id in the show (${device.id}): it is the name the prop answers “are you there?” with.`,
    '',
    text.replace(/\s+$/, ''), '',
  ].join('\n');
}

function secretsFor(o: KitSettings): string {
  let text = body(read('prop-light', 'secrets.example.h'));
  if (o.ssid) text = define(text, 'WIFI_SSID', cString(o.ssid));
  return [
    '// secrets.h: this prop’s Wi-Fi name and password. THIS FILE IS YOURS.',
    '//',
    '// Type the network’s name and password between the quotes. Do not share this file, and do not put it in a',
    '// repository (props/.gitignore keeps it out of git). Endless Cues never reads it, never sends it anywhere,',
    '// and never writes over it once it is here. While WIFI_SSID is still "CHANGE-ME" the prop does not look',
    '// for a network: it runs its own look.',
    '',
    text.replace(/\s+$/, ''), '',
  ].join('\n');
}

function stepsFor(device: KitDevice, o: KitSettings): string {
  const board = BOARDS[o.board], light = o.sketch === 'light', id = device.id;
  const thing = light ? `the strip’s data wire on GPIO ${o.pin}, ${o.count} LEDs, ${o.order}` : `a ${o.output} on GPIO ${o.pin}`;
  return [
    `# ${device.name || id}: firmware`,
    '',
    `Written by Endless Cues for the device **${device.name || id}** (\`${id}\`): ${light ? 'a light' : 'a switch'} on an ${board.label}, ${thing}.`,
    '',
    `> ${STATUS}`,
    '',
    '## What it does',
    '',
    light
      ? '- At power-on it comes up in its own look (in `config.h`), before it has looked for the network.'
      : '- At power-on it is off (`START_ON` in `config.h` changes that), before it has looked for the network.',
    '- It carries on alone: if the show computer or the Wi-Fi goes away, it keeps doing the last thing it was told.',
    '- It answers “are you there?” by name, which is how the Rig page knows it is ready.',
    '- With a button wired from `BUTTON_PIN` to GND, a press ' + (light ? 'steps through its looks' : 'switches it') + ', whatever the show last said.',
    '',
    '## Putting it on the board',
    '',
    `1. Install the Arduino IDE (free). In it, add the ESP32 boards (Boards Manager ▸ “esp32”, by Espressif)${light ? '; then add the library “Adafruit NeoPixel” (Library Manager)' : ''}.`,
    '2. Open `secrets.h` in this folder and type the network’s name and password between the quotes. This file is yours: do not share it. The show never holds it.',
    `3. Open \`${id}.ino\`. Choose the board (**${board.name}**) and the port.${board.note ? ` ${board.note}` : ''} *If this board already runs something you care about, save it first:* \`esptool.py read_flash 0 ALL before.bin\`.`,
    `4. Upload. ${light ? 'The light comes up in its own look within two seconds, before it has found the network.' : 'It starts in its resting state at once, before it has found the network.'}`,
    '5. In Endless Cues, on the Rig page, press **Look for props**. It should answer by name. If it does not: is it on the same network as this computer? Is that network 2.4 GHz? (An ESP32 does not join 5 GHz, or a WPA3-only network.)',
    `6. Press **Try ▸ Identify**. ${light ? 'It blinks white for two seconds.' : 'A switch does not move for Identify: its row on the Rig page turning ready is the sign. Try ▸ Pulse moves it.'}`,
    `7. ${o.address ? `It takes the address ${o.address} for itself (\`FIXED_ADDRESS\` in \`config.h\`): make sure your router gives that address to nothing else.` : 'Give it a fixed address in your router (reserve the one it has), so that it is in the same place tomorrow.'}`,
    '',
    'From a terminal, the same with `arduino-cli`, run in this folder’s parent (`props/`):',
    '',
    '```',
    `arduino-cli compile --fqbn ${board.fqbn} ${id}`,
    `arduino-cli upload  --fqbn ${board.fqbn} -p <port> ${id}`,
    '```',
    '',
    '## Wiring',
    '',
    ...(light ? [
      `- The strip’s data wire to GPIO ${o.pin}; its ground to the board’s GND **and** to the power supply’s ground.`,
      `- Power the strip from its own 5 V supply, not from the board: ${o.count} LEDs at full white can draw about ${(o.count * 0.06).toFixed(1)} A.`,
      '- If the first LED flickers, a 330 Ω resistor in the data wire and a 1000 µF capacitor across the strip’s power usually cure it.',
    ] : o.output === 'servo' ? [
      `- The servo’s signal wire to GPIO ${o.pin}; power it from its own 5 V supply, with its ground joined to the board’s GND.`,
      '- `SERVO_MIN_US` and `SERVO_MAX_US` in `config.h` are its two ends. Start with a small range and widen it: a servo driven past its stop gets hot.',
    ] : [
      `- The relay board’s input to GPIO ${o.pin}, its ground to the board’s GND, its power as the relay board says.`,
      '- If the relay is on when it should be off, set `RELAY_ACTIVE_LOW` to 1 in `config.h`.',
      '- Mains voltage on a relay is a job for someone qualified to wire it.',
    ]),
    '',
    '## The files',
    '',
    `- \`${id}.ino\`, \`ec_osc.h\`: the sketch, as the kit has it. Asking Endless Cues to write the firmware again replaces them.`,
    '- `config.h`: this prop’s settings.',
    '- `secrets.h`: your Wi-Fi name and password. Never replaced once it is here.',
    '',
    '## What it understands',
    '',
    protocol(),
    '',
  ].join('\n');
}

/** The files for one prop: props/<id>/<id>.ino, ec_osc.h, config.h, secrets.h, README.md, and props/.gitignore. */
function files(device: KitDevice, options: Record<string, unknown> | null = {}): { path: string; text: string }[] {
  const o = settle(device, options);
  const dir = `props/${device.id}`;
  const sketch = o.sketch === 'light' ? read('prop-light', 'prop-light.ino') : read('prop-switch', 'prop-switch.ino');
  return [
    { path: `${dir}/${device.id}.ino`, text: sketch },
    { path: `${dir}/ec_osc.h`, text: read('ec_osc.h') },
    { path: `${dir}/config.h`, text: configFor(device, o) },
    { path: `${dir}/secrets.h`, text: secretsFor(o) },
    { path: `${dir}/README.md`, text: stepsFor(device, o) },
    { path: 'props/.gitignore', text: 'secrets.h\nbuild/\n' },
  ];
}

export { files, settle, protocol, OPTIONS, BOARDS, EFFECTS, STATUS };
