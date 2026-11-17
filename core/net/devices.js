/**
 * Device templates: the OSC a piece of equipment understands, as commands a person picks from a list.
 *
 * A patch (Settings ▸ Integrations ▸ Network) can say what kind of device it is; a Network cue aimed at that patch
 * then offers these commands, each with its few parameters, and writes the OSC message for you.
 * The message stays plain text on the cue: a template is a way of typing it, never a lock-in, and
 * anything a template does not cover is typed by hand.
 *
 *   template   "/eos/cue/{list}/{cue}/fire"     {name} is replaced by that parameter's value
 *   fade       this command's last argument is a level that can be faded: the cue gets "#v#" there
 *
 * These are starting points written from each maker's published OSC documentation. Firmware
 * versions differ; check a command against the device itself (Settings ▸ Integrations ▸ Network ▸ Test) before a show.
 * `test` is a message that is safe to send to see whether the device is there; `answers` is true
 * when the device replies to it (so the app can say "answering" rather than only "sent").
 *
 * An entry is also a MODEL: what a device in a show (core/rig/devices.js) is started from. For that it may
 * say more, all optional: `kind` (a label: desk, prop, sound…), `alive` (how a device of this model is asked
 * whether it is there; without it, a model that answers its `test` is asked with that), `reports` (what it
 * says about itself), `resend`, `listenPort`, and `tryCommand` (the id of the command that is safe to send at
 * any time, which becomes the device's `test`). A model's commands are copied into the device when it is
 * made, so a model changing later never changes a show.
 */
const num = (key, label, def, help) => ({ key, label, kind: 'number', default: def, help });
const text = (key, label, def, help) => ({ key, label, kind: 'text', default: def, help });

const DEVICES = {
  generic: {
    label: 'Generic OSC', kind: 'other', port: 8000, protocol: 'udp',
    notes: 'Anything that takes OSC. Type the message on the cue.',
    commands: [],
  },
  'etc-eos': {
    label: 'ETC Eos family (Eos, Ion, Element, Gio, Nomad)', kind: 'desk', port: 8000, protocol: 'udp',
    notes: 'On the desk: Setup ▸ System ▸ Show Control ▸ OSC. OSC RX on, UDP RX port 8000; OSC TX on, UDP TX port 8001 to this computer. For TCP use port 3032 (SLIP, OSC 1.1).',
    test: '/eos/ping', answers: true, listenPort: 8001,
    alive: { how: 'ask', send: '/eos/ping', reply: '/eos/out/*', every: 2 },
    commands: [
      { id: 'fire', label: 'Fire cue', template: '/eos/cue/{list}/{cue}/fire', params: [num('list', 'Cue list', 1), text('cue', 'Cue', '1')] },
      { id: 'go', label: 'GO (main playback)', template: '/eos/key/go_0', params: [] },
      { id: 'stop', label: 'Stop / Back (main playback)', template: '/eos/key/stop', params: [] },
      { id: 'macro', label: 'Fire macro', template: '/eos/macro/{macro}/fire', params: [num('macro', 'Macro', 1)] },
      { id: 'sub', label: 'Submaster level', template: '/eos/sub/{sub} {level}', fade: 'level', params: [num('sub', 'Submaster', 1), num('level', 'Level (0–1)', 1)] },
      { id: 'chan', label: 'Channel level', template: '/eos/chan/{chan} {level}', fade: 'level', params: [num('chan', 'Channel', 1), num('level', 'Level (0–100)', 100)] },
      { id: 'cmd', label: 'Command line', template: '/eos/newcmd "{command}"', params: [text('command', 'Command', 'Chan 1 At Full#', 'End with # to press Enter.')] },
    ],
  },
  grandma3: {
    label: 'grandMA3', kind: 'desk', port: 8000, protocol: 'udp',
    notes: 'On the desk: Menu ▸ In & Out ▸ OSC. Enable Input, and on the line for this computer set Receive and Receive Command to Yes. The messages here begin /gma3: set that line’s Prefix to “gma3” (the desk has no prefix until you give it one). The port is the one on that line.',
    commands: [
      { id: 'cmd', label: 'Command', template: '/gma3/cmd "{command}"', params: [text('command', 'Command', 'Go+ Sequence 1')] },
      { id: 'go', label: 'Go sequence', template: '/gma3/cmd "Go+ Sequence {sequence}"', params: [num('sequence', 'Sequence', 1)] },
      { id: 'goto', label: 'Go to cue', template: '/gma3/cmd "Goto Cue {cue} Sequence {sequence}"', params: [num('sequence', 'Sequence', 1), text('cue', 'Cue', '1')] },
    ],
  },
  x32: {
    label: 'Behringer X32 / Midas M32', kind: 'sound', port: 10023, protocol: 'udp',
    notes: 'Port 10023. Channels are two digits (01–32). Fader levels are 0–1 (0.75 is 0 dB). "On" is 1 for unmuted, 0 for muted.',
    test: '/info', answers: true,
    commands: [
      { id: 'fader', label: 'Channel fader', template: '/ch/{channel}/mix/fader {level}', fade: 'level', params: [text('channel', 'Channel (01–32)', '01'), num('level', 'Level (0–1)', 0.75)] },
      { id: 'mute', label: 'Channel on / mute', template: '/ch/{channel}/mix/on {on}', params: [text('channel', 'Channel (01–32)', '01'), num('on', 'On (1) or muted (0)', 0)] },
      { id: 'bus', label: 'Mix bus fader', template: '/bus/{bus}/mix/fader {level}', fade: 'level', params: [text('bus', 'Bus (01–16)', '01'), num('level', 'Level (0–1)', 0.75)] },
      { id: 'dca', label: 'DCA fader', template: '/dca/{dca}/fader {level}', fade: 'level', params: [num('dca', 'DCA (1–8)', 1), num('level', 'Level (0–1)', 0.75)] },
      { id: 'main', label: 'Main LR fader', template: '/main/st/mix/fader {level}', fade: 'level', params: [num('level', 'Level (0–1)', 0.75)] },
      { id: 'mutegroup', label: 'Mute group', template: '/config/mute/{group} {on}', params: [num('group', 'Mute group (1–6)', 1), num('on', 'Muted (1) or not (0)', 1)] },
      { id: 'scene', label: 'Recall scene', template: '/-action/goscene {scene}', params: [num('scene', 'Scene (0–99)', 0)] },
      { id: 'snippet', label: 'Recall snippet', template: '/-action/gosnippet {snippet}', params: [num('snippet', 'Snippet (0–99)', 0)] },
    ],
  },
  xair: {
    label: 'Behringer XR / Midas MR (X Air)', kind: 'sound', port: 10024, protocol: 'udp',
    notes: 'Port 10024. Fader levels are 0–1. "On" is 1 for unmuted, 0 for muted.',
    test: '/info', answers: true,
    commands: [
      { id: 'fader', label: 'Channel fader', template: '/ch/{channel}/mix/fader {level}', fade: 'level', params: [text('channel', 'Channel (01–16)', '01'), num('level', 'Level (0–1)', 0.75)] },
      { id: 'mute', label: 'Channel on / mute', template: '/ch/{channel}/mix/on {on}', params: [text('channel', 'Channel (01–16)', '01'), num('on', 'On (1) or muted (0)', 0)] },
      { id: 'main', label: 'Main LR fader', template: '/lr/mix/fader {level}', fade: 'level', params: [num('level', 'Level (0–1)', 0.75)] },
      { id: 'snapshot', label: 'Load snapshot', template: '/-snap/load {snapshot}', params: [num('snapshot', 'Snapshot (1–64)', 1)] },
    ],
  },
  qlab: {
    label: 'QLab (another computer)', kind: 'computer', port: 53000, protocol: 'udp',
    notes: 'QLab listens on port 53000. A workspace with a passcode needs "/connect <passcode>" first.',
    test: '/version', answers: true,
    commands: [
      { id: 'go', label: 'GO', template: '/go', params: [] },
      { id: 'start', label: 'Start cue', template: '/cue/{cue}/start', params: [text('cue', 'Cue number', '1')] },
      { id: 'stop', label: 'Stop cue', template: '/cue/{cue}/stop', params: [text('cue', 'Cue number', '1')] },
      { id: 'playhead', label: 'Playhead to cue', template: '/playhead/{cue}', params: [text('cue', 'Cue number', '1')] },
      { id: 'panic', label: 'Panic', template: '/panic', params: [] },
    ],
  },
  'endless-cues': {
    label: 'Endless Cues (another computer)', kind: 'computer', port: 53000, protocol: 'udp',
    notes: 'The other computer needs its OSC control module on.',
    test: '/thump', answers: true,
    commands: [
      { id: 'go', label: 'GO', template: '/go', params: [] },
      { id: 'start', label: 'Start cue', template: '/cue/{cue}/start', params: [text('cue', 'Cue number', '1')] },
      { id: 'stop', label: 'Stop cue', template: '/cue/{cue}/stop', params: [text('cue', 'Cue number', '1')] },
      { id: 'playhead', label: 'Playhead to cue', template: '/playhead/{cue}', params: [text('cue', 'Cue number', '1')] },
      { id: 'panic', label: 'Panic', template: '/panic', params: [] },
    ],
  },
  reaper: {
    label: 'REAPER', kind: 'sound', port: 8000, protocol: 'udp',
    notes: 'In REAPER: Preferences ▸ Control/OSC/web ▸ Add ▸ OSC, mode "Local port", with the default pattern config. The port is whatever you set there.',
    commands: [
      { id: 'play', label: 'Play', template: '/play', params: [] },
      { id: 'stop', label: 'Stop', template: '/stop', params: [] },
      { id: 'record', label: 'Record', template: '/record', params: [] },
      { id: 'volume', label: 'Track volume', template: '/track/{track}/volume {level}', fade: 'level', params: [num('track', 'Track', 1), num('level', 'Level (0–1)', 0.716)] },
      { id: 'mute', label: 'Track mute', template: '/track/{track}/mute {on}', params: [num('track', 'Track', 1), num('on', 'Muted (1) or not (0)', 1)] },
      { id: 'action', label: 'Run action', template: '/action/{action}', params: [text('action', 'Action id', '40044')] },
      { id: 'marker', label: 'Go to marker', template: '/marker/{marker}', params: [num('marker', 'Marker', 1)] },
    ],
  },
  resolume: {
    label: 'Resolume Arena / Avenue', kind: 'media', port: 7000, protocol: 'udp',
    notes: 'In Resolume: Preferences ▸ OSC ▸ OSC Input, port 7000.',
    commands: [
      { id: 'clip', label: 'Trigger clip', template: '/composition/layers/{layer}/clips/{clip}/connect 1', params: [num('layer', 'Layer', 1), num('clip', 'Clip', 1)] },
      { id: 'column', label: 'Trigger column', template: '/composition/columns/{column}/connect 1', params: [num('column', 'Column', 1)] },
      { id: 'clear', label: 'Clear layer', template: '/composition/layers/{layer}/clear 1', params: [num('layer', 'Layer', 1)] },
      { id: 'opacity', label: 'Layer opacity', template: '/composition/layers/{layer}/video/opacity {level}', fade: 'level', params: [num('layer', 'Layer', 1), num('level', 'Opacity (0–1)', 1)] },
      { id: 'master', label: 'Composition master', template: '/composition/master {level}', fade: 'level', params: [num('level', 'Level (0–1)', 1)] },
    ],
  },
};

// ── the prop kit (docs/specs/15-assistant-and-rig.md, section 6.1): a light or a switch on an ESP32 ──
// Both listen on UDP 53100, answer /ec/hello with /ec/here <name> <kind> <fw> <state> <uptime> <signal> <battery>,
// and act once on a message that ends with an id (#a41f07), which is what `resend` relies on.
const PROP_HERE = [
  { key: 'fw', label: 'Firmware', from: '/ec/here', arg: 2 },
  { key: 'state', label: 'Doing', from: '/ec/here', arg: 3 },
  { key: 'signal', label: 'Signal', from: '/ec/here', arg: 5, unit: 'dBm', warnBelow: -70 },
  { key: 'battery', label: 'Battery', from: '/ec/here', arg: 6, unit: '%', warnBelow: 25, none: -1 },
];
const PROP = { port: 53100, protocol: 'udp', kind: 'prop', test: '/ec/hello', answers: true, tryCommand: 'identify', resend: 3,
  alive: { how: 'ask', send: '/ec/hello', reply: '/ec/here', every: 2 }, reports: PROP_HERE };
const lim = (p, min, max, whole) => ({ ...p, min, max, ...(whole ? { whole: true } : {}) });
Object.assign(DEVICES, {
  'ec-prop-light': {
    label: 'Prop light (the Endless Cues kit)', ...PROP,
    notes: 'A strip of addressable LEDs on an ESP32 running the kit’s prop-light firmware. It comes up in its own look, carries on alone, and answers “are you there?” by name.',
    commands: [
      { id: 'look', label: 'Look', template: '/ec/look {n}', params: [lim(num('n', 'Look (0 is its own)', 1), 0, 8, true)] },
      { id: 'color', label: 'Colour', template: '/ec/color {r} {g} {b}', params: [lim(num('r', 'Red (0–255)', 255), 0, 255, true), lim(num('g', 'Green (0–255)', 160), 0, 255, true), lim(num('b', 'Blue (0–255)', 60), 0, 255, true)] },
      { id: 'level', label: 'Level', template: '/ec/level {level}', fade: 'level', params: [lim(num('level', 'Level (0–1)', 1), 0, 1)] },
      { id: 'effect', label: 'Effect', template: '/ec/effect {name}', params: [{ key: 'name', label: 'Effect', kind: 'enum', options: ['steady', 'breathe', 'pulse', 'flicker'], default: 'breathe' }] },
      { id: 'on', label: 'On (its last look)', template: '/ec/on', params: [] },
      { id: 'off', label: 'Off (dark)', template: '/ec/off', params: [] },
      { id: 'identify', label: 'Identify', template: '/ec/identify', params: [] },
    ],
  },
  'ec-prop-switch': {
    label: 'Prop switch (the Endless Cues kit)', ...PROP,
    notes: 'A relay or a servo on an ESP32 running the kit’s prop-switch firmware.',
    commands: [
      { id: 'on', label: 'On', template: '/ec/on', params: [] },
      { id: 'off', label: 'Off', template: '/ec/off', params: [] },
      { id: 'pulse', label: 'Pulse', template: '/ec/pulse {ms}', params: [lim(num('ms', 'On for (ms)', 500), 1, 60000, true)] },
      { id: 'level', label: 'Position (a servo)', template: '/ec/level {level}', fade: 'level', params: [lim(num('level', 'Position (0–1)', 1), 0, 1)] },
      { id: 'identify', label: 'Identify', template: '/ec/identify', params: [] },
    ],
  },
});

/** The message a command makes from its parameters. With `fade`, that parameter becomes "#v#" (a faded value).
 *  (One function with a device in a show: core/rig/devices.js `compose`. A template never checked a value, so here none is refused.) */
function compose(deviceId, commandId, values = {}, { fade = false } = {}) {
  const dev = DEVICES[deviceId];
  if (!dev) return null;
  const cmd = dev.commands.find((c) => c.id === commandId);
  const r = require('../rig/devices').compose({ name: dev.label, commands: dev.commands }, commandId, values, { fade: fade && !!(cmd && cmd.fade), strict: false });
  return r.ok ? r.message : null;
}

/** For the UI: the table without functions. */
function list() {
  return Object.entries(DEVICES).map(([id, d]) => ({ id, label: d.label, port: d.port, protocol: d.protocol, notes: d.notes || '', test: d.test || '', answers: !!d.answers, commands: d.commands,
    kind: d.kind || 'other', ...(d.alive ? { alive: d.alive } : {}), ...(d.reports ? { reports: d.reports } : {}), ...(d.resend ? { resend: d.resend } : {}), ...(d.tryCommand ? { tryCommand: d.tryCommand } : {}), ...(d.listenPort ? { listenPort: d.listenPort } : {}) }));
}

module.exports = { DEVICES, compose, list };
