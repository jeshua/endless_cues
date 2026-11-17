/**
 * What is on each virtual user's desk when they sit down: the sound files of their show (synthesised here, so
 * the repository ships no media) and, for the two who come from QLab with a show already built, its workspace
 * (materials/*.qlab5, written by materials/make-workspaces.py).
 *
 * The sounds are stand-ins: a pad with a pulse, short enough to keep a run small. Their lengths are the only
 * thing about them a task depends on.
 */
import * as fs from 'fs';
import * as path from 'path';
import { writeWav } from '../../examples/make-demo';

const RATE = 44100;
const TAU = Math.PI * 2;

/** A stand-in sound: `secs` long, pitched by `seed`, with a pulse every `beat` seconds (0: none). */
function sound(file, secs, seed, beat = 0) {
  const n = Math.round(secs * RATE);
  const L = new Float32Array(n), R = new Float32Array(n);
  const f = 110 * 2 ** ((seed % 12) / 12);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const edge = Math.min(1, t / 0.05, (secs - t) / 0.05);
    const pulse = beat ? Math.exp(-((t % beat) / 0.08)) * Math.sin(TAU * 880 * t) * 0.3 : 0;
    const pad = (Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * f * 1.5 * t + seed)) * 0.18 * (0.75 + 0.25 * Math.sin(TAU * t / 7));
    L[i] = (pad + pulse) * edge; R[i] = (pad * 0.9 + pulse) * edge;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeWav(file, L, R);
}

const HERE = __dirname;
const DESKS = {
  // a play: a QLab workspace with its audio folder beside it
  priya(desk) {
    const dir = path.join(desk, 'The Glass Orchard');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(HERE, 'materials/glass-orchard.qlab5'), path.join(dir, 'The Glass Orchard.qlab5'));
    const files = { 'walkin-1': 40, 'walkin-2': 40, rain: 30, thunder: 8, phone: 4, door: 2, letter: 45, interval: 40, wind: 30, bows: 30 };
    Object.entries(files).forEach(([name, secs], i) => sound(path.join(dir, 'audio', `${name}.wav`), secs, i));
    sound(path.join(desk, 'new from the composer', 'letter v2.wav'), 50, 5);
    fs.writeFileSync(path.join(desk, 'tech notes.txt'), [
      'Notes from tech, The Glass Orchard',
      '',
      '- Thunder in Q3 is too loud: down 3 dB.',
      '- Rain should take longer to come back after the thunder: 5 s, not 3.',
      '- New cue between 6 and 7, numbered 6.5: the door again, quieter (-10 dB). Director wants it as a memory of the slam.',
      '- Q7: the composer sent a new version of the letter underscore (new from the composer/letter v2.wav). Swap it in, same level.',
      '- Phone (Q4) is cut tonight. Do not delete it: it is back tomorrow.',
      '- Q13 blackout must take everything out over 3 s.',
    ].join('\n'));
  },
  // a musical: a QLab workspace of tracks and clicks
  marcus(desk) {
    const dir = path.join(desk, 'Songbook');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(HERE, 'materials/songbook.qlab5'), path.join(dir, 'Songbook.qlab5'));
    const files = { opening: [48, 0], 'click-opening': [48, 0.5], ballad: [60, 0], 'click-ballad': [60, 0.75], finale: [56, 0], 'click-finale': [56, 0.5] };
    Object.entries(files).forEach(([name, [secs, beat]], i) => sound(path.join(dir, 'audio', `${name}.wav`), secs, i + 3, beat));
    fs.writeFileSync(path.join(desk, 'from the MD.txt'), [
      'From the music director',
      '',
      '- Opening: the band vamps bars 9-12 (0:16 to 0:24 on the track) until the scene change is done, then on. That has to be solid.',
      '- Ballad: in rehearsal we start from the second verse most days. That is 0:25 into the track.',
      '- Finale: bows vamp is 0:30 to the end of that phrase at 0:38. Round and round until the last bow.',
      '- Click must never reach the house. It goes to the band\'s in-ears only (outputs 3 and 4 on the interface).',
      '- Renumber the Finale cues 300, 301, 302… so there is room to add things.',
    ].join('\n'));
  },
  // a dance company on tour: a folder of tracks and a running order, no show built yet
  dana(desk) {
    const tracks = { '00 house music': 40, '01 Tide': 50, '02 Salt': 60, '03 Undertow': 45, '04 Driftwood': 35, '05 Lantern': 40, '06 bows': 30 };
    Object.entries(tracks).forEach(([name, secs], i) => sound(path.join(desk, 'tour music', `${name}.wav`), secs, i + 1));
    fs.writeFileSync(path.join(desk, 'running order.txt'), [
      'Running order (the choreographer\'s notes)',
      '',
      'House music: loops while the audience comes in. Fades out over 8 seconds on the stage manager\'s call.',
      '1. Tide',
      '2. Salt        (in rehearsal we often pick this up from 0:30)',
      '3. Undertow    starts 12 seconds into the file (the count-in is cut). Fade it out over the last 5 seconds: it ends at 0:40, not at the end of the file.',
      '4. Driftwood   goes straight into Lantern: no call, 3 seconds of silence between them.',
      '5. Lantern',
      'Bows.',
      '',
      'Levels: Salt is mastered hot, take it down 4 dB.',
    ].join('\n'));
  },
  // an immersive show: a few sounds and a rig to talk to
  theo(desk) {
    const files = { 'room tone': 40, 'door creak': 3, 'radio static': 20, 'heartbeat': 30 };
    Object.entries(files).forEach(([name, secs], i) => sound(path.join(desk, 'sounds', `${name}.wav`), secs, i + 7, name === 'heartbeat' ? 1 : 0));
    fs.writeFileSync(path.join(desk, 'rig.txt'), [
      'The rig (everything is on this computer for the bench test)',
      '',
      'Lighting desk     ETC Eos family    127.0.0.1   OSC in on UDP 8001',
      'Media server      Resolume          127.0.0.1   OSC in on UDP 7000',
      'Stage manager     a tally display   127.0.0.1   listens on UDP 9100 for what the show is doing',
      'Controllers       a button box and a door sensor, both send OSC to the show computer on UDP 53000',
      '                  button box:  /go   /panic   /cue/<number>/start',
      '                  door sensor: /sensor/door 1   when the audience opens the cellar door',
      '',
      'Stand in for the three devices with:  ec-user <session> osc listen <port>   then   osc heard <port>',
      'Be the controllers with:              ec-user <session> osc send 53000 <address> [args]',
    ].join('\n'));
  },
  // a puppeteer's own show: a folder of sounds named as people name them, a script with marks, and a rig to describe
  june(desk) {
    const dir = path.join(desk, 'The Lighthouse');
    const files = { '01 sea wash': 40, '02 gulls FINAL': 12, '03 foghorn': 6, '04 lamp hum loop': 20, '05 storm v2': 30, '06 bows': 25 };
    Object.entries(files).forEach(([name, secs], i) => sound(path.join(dir, `${name}.wav`), secs, i + 2));
    fs.writeFileSync(path.join(dir, 'script.md'), [
      '# The Lighthouse', '',
      '## Scene 1: The shore', '',
      'The house lights go. The sea is already there.', '<!-- @cue 1 Sea wash -->', '',
      'A gull lands on the rail.', '<!-- @cue 2 Gulls -->', '',
      '## Scene 2: The lamp', '',
      'KEEPER: I have not seen a ship in forty days.', '<!-- @cue 3 Foghorn -->', '',
      'He climbs. The lamp turns once.', '<!-- @cue 4 Lamp hum -->', '',
      '## Scene 3: The storm', '',
      'The window bangs open.', '<!-- @cue 5 Storm -->', '',
      'KEEPER: Still here.', '<!-- @cue 5.5 Storm out -->', '',
      'He puts the lamp out with his hand.', '<!-- @cue 6 Bows -->', '',
    ].join('\n'));
    fs.writeFileSync(path.join(desk, 'rig.txt'), [
      'The rig (everything is on this computer for the bench test)',
      '',
      'Lighting desk     ETC Ion (the Eos family)      127.0.0.1   the venue\'s; the foghorn is its cue 12',
      'Lantern A         an ESP32 and a strip of LEDs   built, running the Endless Cues prop firmware',
      'Lantern B         an ESP32, 30 LEDs on pin 5     not built yet: it needs its firmware',
      'Wi-Fi             the network is called StageNet (the password is on the router; it is nobody else\'s business)',
      '',
      `Stand in for Lantern A, in a terminal of its own:   node ${path.join(__dirname, '../../bin/ec.js')} fake-prop --name lantern_a`,
      'It prints every message it is sent. Stop it with Ctrl-C (a lantern with a flat battery).',
      'Stand in for the lighting desk with:                 ec-user <session> osc listen 8000   then   osc heard 8000',
    ].join('\n'));
  },
};

export { DESKS, sound };
