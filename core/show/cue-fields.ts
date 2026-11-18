// Written by build/cue-fields.ts from the cue types table (core/show/cue-types.ts): never edited by hand.
// `npm run cue-fields` writes it again; test/cue-fields.test.ts fails while it is behind the table.
import type { Automation, BusLevels, Chain, DeviceArgs, Envelope, Eq, Marker, Matrix, Region, Shape, Sweep, Tempo } from './types';

/** The cue types, in the table's order. */
export type CueType = "section" | "group" | "audio" | "mic" | "video" | "text" | "camera" | "fade" | "stop" | "start" | "pause" | "load" | "reset" | "target" | "goto" | "arm" | "disarm" | "devamp" | "wait" | "memo" | "network" | "device" | "midi" | "midifile" | "timecode" | "light" | "mix" | "music" | "script";

/** Every field the table gives a cue (each type has some of them: TYPES[type].fields, and COMMON on every cue). */
export interface CueFields {
  /** Number: What the operator calls it. Any text, or none. (every cue) */
  number?: string;
  /** Name (every cue) */
  name?: string;
  /** Notes: Shown in the masthead while it stands by. (every cue) */
  notes?: string;
  /** Colour (every cue) */
  color?: string;
  /** Colour once played: Its colour after it has fired, until Reset. None: unchanged. (every cue) */
  color2?: string;
  /** Flagged (every cue) */
  flagged?: boolean;
  /** Armed: Disarmed: skipped, but still passes a continue on. (every cue) */
  armed?: boolean;
  /** Pre-wait: Delay from the GO to its action. (every cue) */
  preWait?: number;
  /** Post-wait: With auto-continue: delay before the next cue. (every cue) */
  postWait?: number;
  /** Continue: auto-continue: the next fires as this starts. auto-follow: as it ends. (every cue) */
  continue?: "none" | "auto-continue" | "auto-follow";
  /** OSC trigger: An OSC address that fires it ("/sm/thunder", "/sm/*"), then any arguments. (every cue) */
  oscTrigger?: string;
  /** Fade & stop others: Fades out and stops everything else over this time. 0: off. (every cue, group) */
  fadeOthers?: number;
  /** Others are: all: everything. list: what its list started. peers: its group. (every cue) */
  fadeOthersScope?: "all" | "list" | "peers";
  /** Duck others: While it runs, the rest is held down (−12) or up (+3). 0: off. (every cue) */
  duckOthers?: number;
  /** Duck fade time: How long they take to go down, and to come back. (every cue) */
  duckTime?: number;
  /** Auto-load: Loads its sounds while standing by, for a tight start. Uses memory. (every cue) */
  autoLoad?: boolean;
  /** Hotkey: A key that fires it: "7", "shift+b", "F5". Not the app’s own keys. (every cue) */
  hotkey?: string;
  /** Clock trigger: A time of day: 19:25, or 19:25 fri sat. Only while the app is open. (every cue) */
  clockTrigger?: string;
  /** MIDI trigger: "note 60", "note 60 ch 2", "pc 5", "cc 20 127". Left out: any. (every cue) */
  midiTrigger?: string;
  /** Timecode trigger: Incoming timecode that fires it. Needs Settings ▸ Integrations ▸ Network ▸ Timecode. (every cue) */
  timecodeTrigger?: string;
  /** Second trigger: When it is fired again while running. Fade out: over the panic time. (every cue) */
  secondTrigger?: "restart" | "nothing" | "panic" | "stop" | "devamp";
  /** Second trigger on release: Releasing its hotkey or MIDI note is its second trigger. (every cue) */
  secondOnRelease?: boolean;
  /** Cart button: Its cart button, "row,column" from 1 ("2,3"). Empty: the first free one. (every cue) */
  cell?: string;
  /** Mode: All on one GO, one after another, from the first child, or one at random. (group) */
  mode?: "timeline" | "playlist" | "enter" | "first" | "random";
  /** Shuffle: A new order each time round. (group) */
  shuffle?: boolean;
  /** Repeat: Goes round again until stopped. (group) */
  repeat?: boolean;
  /** Crossfade: The next comes in this long before one ends. (group) */
  crossfade?: number;
  /** Quantise: Waits for the next beat or bar. Needs a tempo on the playing track. (group) */
  onBeat?: "now" | "beat" | "bar";
  /** Beat lead-in (group) */
  beatLead?: number;
  /** Blend: For a Jump inside it. dj: a bar-long crossfade, bass swapped. (group) */
  blend?: "" | "cut" | "fade" | "dj";
  /** Blend length (group) */
  blendSecs?: number;
  /** File: In the show folder (media/…), or absolute. (audio, video, midifile) */
  file?: string;
  /** Level (audio, mic, video, timecode) */
  gainDb?: number;
  /** Pan: −100 left, 0 the middle, 100 right. (audio, mic) */
  pan?: number;
  /** Bus (audio, mic, video) */
  bus?: string;
  /** Start at (audio, video) */
  from?: number;
  /** End at: Stops here. With Loop: loops Start to End. (audio, video) */
  cutAt?: number;
  /** Transcript: A voice-over’s words, shown in the masthead. (audio) */
  transcript?: string;
  /** Loop (audio, video, music) */
  loop?: boolean;
  /** Play count: Plays Start to End this many times, then stops. (audio) */
  plays?: number;
  /** Fade in (6 types) */
  fadeIn?: number;
  /** Fade out: Fades to silence over its last seconds. (audio, video, text, camera) */
  fadeOut?: number;
  /** Fade in shape: Linear (in dB), S-curve, either of them along a fader (as QLab fades), or drawn. (audio) */
  fadeInShape?: Shape;
  /** Fade out shape: Linear (in dB), S-curve, either of them along a fader (as QLab fades), or drawn. (audio) */
  fadeOutShape?: Shape;
  /** Rate: 1 as recorded, 0.5 half speed. Pitch follows unless Keep pitch. (audio, fade, midifile) */
  rate?: number;
  /** Keep pitch: Stretched instead; then only a whole-file loop goes round. (audio) */
  preservePitch?: boolean;
  /** Level envelope: The Volume line: [[seconds, dB], …] on top of Level, drawn on Time & Loops. A third number on a point bends the line to the next (−1 to 1). (audio) */
  envelope?: Envelope;
  /** Automation: Other lines over its length, by lane: { "pan": [[seconds, −100…100], …], "chain.<tool>.<setting>": [[seconds, value], …] } (a setting of its Sound design that glides, as "chain.lowpass.hz"). A lane replaces Pan or that knob while it has points; a third number on a point bends the line to the next (−1 to 1). Drawn on Time & Loops. (audio) */
  automation?: Automation;
  /** Fade out from: Starts the fade-out this far in. A loop: after this long. (audio) */
  fadeAt?: number;
  /** Own outputs: Outputs instead of its bus’s pair: [{ "3": 0 }, { "4": 0 }]. Its bus still rides it. (audio, mic) */
  outputs?: Matrix;
  /** EQ: Four bands on this one sound: { low, mid, mid2, high } (a low shelf at 250 Hz, bells at 1 kHz and 3 kHz, a high shelf at 4 kHz). A band is a level in dB (−40 takes it out), or { db, hz, q } to move it: "mid": { "db": 4, "hz": 1800, "q": 2 }. Empty: none. (audio, mic, video) */
  eq?: Eq;
  /** Sound design: The tools this one sound is played through, one entry per tool in use, always run in this order: highpass { hz, slope }, lowpass { hz, slope }, gate { threshold, range, attack, hold, release }, comp { threshold, ratio, attack, release, makeup }, drive { db, tone, out }, crush { bits, hz }, pitch { semitones, cents }, chorus { rate, depth, delay, feedback, mix }, tremolo { rate, depth }, autopan { rate, depth }, stereo { width, invert }, delay { time, feedback, tone, pingpong, mix }, reverb { size, decay, predelay, mix, file }. As in { "highpass": { "hz": 300, "slope": 24 }, "reverb": { "decay": 2.5, "mix": 0.3 }, "tail": true }. A tool with "on": false keeps its settings and is out of the path; "bypass": true takes the whole chain out; "tail": true lets a reverb or a delay ring out after the sound stops. The cue’s eq runs after the filters. Empty: the sound plays as it is. (audio, mic, video) */
  chain?: Chain;
  /** Markers: Named places on the waveform: [{at, name}]. (audio) */
  markers?: Marker[];
  /** Loop regions: Sections that loop cleanly ([{start, end, name, count}]). With a count the track goes round one that many times by itself and plays on; with `hold: true` it goes round until it is let go (L, or a Devamp); with neither the operator starts it too (L). (audio) */
  loops?: Region[];
  /** Tempo: { bpm, first, bar, sections }: a track’s tempo, the time of a downbeat, and the beats in a bar; `sections` ([{ from, bpm, first, bar }]) where it changes tempo or time signature. Found by the app when asked (the sound’s Time & Loops tab) or set by hand. (audio) */
  tempo?: Tempo;
  /** Beat grid (audio) */
  beats?: number[];
  /** Bar grid (audio) */
  downbeats?: number[];
  /** Input: Empty: this computer’s default input. (mic) */
  input?: string;
  /** Channel: Which of the device’s inputs; 1 is the first. (mic, timecode) */
  channel?: number;
  /** Size: fit: all of it. fill: covers, cropped. stretch: distorted. natural: 1:1. (video, camera) */
  fit?: "fit" | "fill" | "stretch" | "natural";
  /** Opacity: Percent. 100 is solid. (video, text, camera, fade) */
  opacity?: number;
  /** Position X: Stage pixels from the centre; right is +. (video, text, camera, fade) */
  x?: number;
  /** Position Y: Stage pixels from the centre; up is +. (video, text, camera, fade) */
  y?: number;
  /** Scale: 1 is the size Size gives it. (video, text, camera, fade) */
  scale?: number;
  /** Rotation: Degrees, clockwise. (video, text, camera, fade) */
  rotation?: number;
  /** Layer: Higher is in front; on a tie, the latest. (video, text, camera) */
  layer?: number;
  /** Hold at end: The last frame stays up until stopped. (video) */
  holdEnd?: boolean;
  /** Still for: A still’s time up. Empty: until stopped. (11 types) */
  duration?: number;
  /** Text: A new line here is a new line on the stage. (text) */
  text?: string;
  /** Font: An installed font, by name. Empty: the system’s sans-serif. (text) */
  font?: string;
  /** Size: Type height, in stage pixels. (text) */
  size?: number;
  /** Text colour: #ffcc00, or a name (white, gold). (text) */
  textColor?: string;
  /** Align (text) */
  align?: "left" | "center" | "right";
  /** Camera: Empty: this computer’s default camera. (camera) */
  camera?: string;
  /** Mirror: Flipped left to right. (camera) */
  mirror?: boolean;
  /** Target: A sound, a group or list (all in it), a picture, or a Light cue (its lights go home). (12 types) */
  target?: string;
  /** To level (fade) */
  db?: number;
  /** Relative: dB from the target’s own level, not absolute. (fade) */
  relative?: boolean;
  /** Stop target when done: Left alone: on for a fade to silence. (fade) */
  stopTarget?: boolean;
  /** Shape, rising: Linear (in dB), S-curve, either of them along a fader (as QLab fades), or drawn. (fade) */
  shapeUp?: Shape;
  /** Shape, falling: Linear (in dB), S-curve, either of them along a fader (as QLab fades), or drawn. (fade) */
  shapeDown?: Shape;
  /** Rate only: With Rate to: the level stays. (fade) */
  keepLevel?: boolean;
  /** Sound design to: { "lowpass": { "hz": 400 } }: numbers of tools on in its target. Empty: none. (fade) */
  chainTo?: Sweep;
  /** Range: voice: dips only the speech band, around 1.2 kHz. (fade) */
  range?: "all" | "voice";
  /** Load to: Seconds in, pre-wait included. Negative: from the end. (load) */
  at?: number;
  /** New target (target, music) */
  to?: string | number;
  /** Then start next: The next cue starts as this pass ends. Leave Continue at none. (devamp) */
  startNext?: boolean;
  /** Patch: From Settings ▸ Integrations ▸ Network. (network) */
  patch?: string;
  /** Message is: text: as typed (\r, \n, \x41). hex: bytes (FE 01 0A). Both sent once. (network) */
  format?: "osc" | "text" | "hex";
  /** Message: Address, then arguments (\T true, \F false). #v# fades; #x# #y# follow Path. (network) */
  message?: string;
  /** Fade from: With #v#: where it starts. (network) */
  fadeFrom?: number;
  /** Fade to: With #v#: where it lands. No duration: sent once. (network, device, midi) */
  fadeTo?: number;
  /** Fade curve (network, device) */
  curve?: "linear" | "s-curve" | "ease-in" | "ease-out";
  /** Whole numbers: Sends the fading value as an integer. (network) */
  whole?: boolean;
  /** Messages a second: For a fade or a repeat: 1 to 120. (network, timecode) */
  fps?: number | "24" | "25" | "29.97df" | "30";
  /** Path: With #x# #y#: points as x,y, at an even speed: 0,0 1,0 1,1. (network) */
  path?: string;
  /** Loop the path: Round until stopped; one lap is the duration. (network) */
  pathLoop?: boolean;
  /** Device: A device of this show (the Rig), by its id. (device) */
  device?: string;
  /** Command: One of its commands, by its id. (device) */
  command?: string;
  /** Arguments: { "name": "breathe" }. Left out: its default. (device) */
  args?: DeviceArgs;
  /** MIDI message: Also note off 60, msc stop, hex bytes. Add ch 2; for MSC, list 1, dev 3. (midi) */
  midi?: string;
  /** Start at: hours:minutes:seconds:frames (timecode) */
  timecode?: string;
  /** Send as: MTC to the MIDI output (Settings ▸ Integrations ▸ Network). LTC on one audio output. (timecode) */
  output?: "mtc" | "ltc";
  /** Levels: One a line: 1 - 6 = 50, cyc.colour = #ff8800, spot.pan = home. Others stay. (light, mix) */
  levels?: string | BusLevels;
  /** Full state: Lights it does not name go home (out). (light) */
  block?: boolean;
  /** Desk cue number: Called, and fired on the desk with the Lighting desk module. (light) */
  lightCue?: string;
  /** Desk follows: The desk runs it after the one before; not fired from here. (light) */
  follows?: boolean;
  /** Loop end (music) */
  end?: number;
  /** Loop from: With Loop there: the loop starts here, not where it lands. (music) */
  loopFrom?: number;
  /** Hold: Arms the loop, and plays into it. (music) */
  hold?: boolean;
  /** Level offset (music) */
  level?: number;
  /** Stop the track (music) */
  stop?: boolean;
  /** Level only: Stays in place. (music) */
  stay?: boolean;
  /** Let go of loop (music) */
  letGo?: boolean;
  /** Script: /cue/<n>/start (stop, hardStop, pause, resume, preview), /cue_id/<id>/…, /go, /panic, /pause, /resume, /playhead/<n | next | previous>, wait <s>. # is a note. (script) */
  script?: string;
}
