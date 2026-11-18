# 18 · The native audio engine

Source: `native/audio/` (Rust: the `ec-audio` program), `app/main/native-audio.ts` (starting it, talking to it, and
falling back), `app/main/host.ts` (which of the two engines a command goes to). Decided in
[ADR 0007](../adr/0007-native-audio.md).

## What it is

A second way to make the sound: a small Rust program the app starts beside itself, which opens the audio device
directly and does, once per sample, what the hidden audio window ([05](05-audio.md)) does with Web Audio. It is
**off until switched on** (Settings ▸ Audio ▸ Audio engine ▸ Native, experimental; `audio.engine` in this computer's
`config.json`, never in a show), and the Web Audio window stays the default until the native engine has played real
shows ([00](00-defaults.md)).

The line between the two languages: **Rust does what runs once per sample or must land on an exact sample; TypeScript
decides what should happen.** The cue engine (`core/engine/`) is unchanged: it says what to play, fade, loop and stop,
in the same commands it sends the audio window, and either engine carries them out.

Why: latency, steadiness and the audio thread's safety. Web Audio streams a sound through an `<audio>` element and
starts it "soon"; the native engine starts a preloaded sound on the next audio buffer (a few milliseconds at 128 or
256 frames), loops and lands to the sample, and has no garbage collector between the GO and the sound.

## The process

- One program, `ec-audio`, per platform and architecture. In development it is `native/target/release/ec-audio`
  (`npm run native`, which runs `cargo build --release`); in a packaged app it is in the app's resources, outside the
  archive (`process.resourcesPath`), signed with the app.
- The host starts it when the native engine is chosen, and starts it again if it exits (as it makes a new audio window
  today: nothing the engine knows about the show is in it). Three exits in a minute, or no binary at all: the host
  goes back to Web Audio for this sitting and says so in a notice and the show log.
- It never opens a network port, never reads a show, never writes a file except the recording it is asked to make.

## The protocol

Newline-delimited JSON on the program's standard input and output, one object a line; anything it prints on standard
error is a log line (`[native]`).

- **In:** exactly the audio window's commands (`AudioCommand` in `app/audio/preload.ts`), with one change: a file is
  given by its path (`file`), never by its bytes or a `file://` URL. (`decode`, `ir`, `peaks` and `pcm` carry no
  `bytes`; the program reads the file itself.)
- **Out:** exactly the audio window's events (`AudioEvent`), the same `type`s with the same fields. Times named `at` are
  the wall clock in milliseconds, as `Date.now()` gives them, so the host reads both engines' events the same way.
- **A command it cannot carry out yet** (a sound design, ducking by listening, LTC, a microphone, …): it says
  `{ "type": "operror", "op", "key", "detail": "not in the native engine yet" }` once for that op and key, and plays
  the sound without it. Nothing is silently dropped.

## What it does (the first version)

| Part | Commands | Notes |
|---|---|---|
| The device | `devices`, `sink`, `outputs` | Lists outputs and inputs; opens the chosen output with as many channels as it has; falls back to the default, and says so, as the audio window does. `--silent` (a test run): no device at all, the clock runs on a timer. |
| Sounds | `play`, `stop`, `stopAll`, `pause`, `resume`, `seek`, `cut`, `loop`, `region`, `rate`, `move` | A sound that was decoded ahead (`decode`, kept by `keep`) starts on the next buffer and loops to the sample (`mode` exact). Any other sound streams from disk through a decoding thread and a ring buffer. `rate` is varispeed (the pitch moves with it); keep-pitch is not in this version. |
| Files | `decode`, `keep`, `probe` | `decoded` and `duration` and `missing` as the audio window reports them. WAV, AIFF, MP3, FLAC, Ogg/Vorbis, AAC/M4A (symphonia). |
| Levels | `fade` (with `shape`), `others`, `masterDb`, `master`, `bus`, `buses`, `limiter`, `play`'s `gainDb`, `envelope` and `pan` | Every change of level is a ramp computed on the audio thread, per sample. The limiter is the last thing before each pair of outputs, as now. |
| Where things are | `where`, events `where`, `ended`, `level` | `level` about 30 times a second: the same fields the audio window sends. |
| Measuring itself | `ec-audio measure` | GO-to-output latency and its spread, by the program's own clock and the device's reported output latency; with `--loopback <input>` (a cable from an output back to an input) by ear, as it were. |

Not in the first version (each says so by `operror`, and the sound plays without it): sound design (`design`,
`sweep`, `ir`, a `play`'s `own.chain`/`own.eq`), a sound's outputs of its own (`own.outputs`), the ducker (`ducker`,
`duck`), the Live desk (`strips`), sends (`fx`), the monitor feed, lines over a sound other than Volume and Pan
(`automation`), microphones, recording, LTC in and out, keep-pitch rate. While the native engine is chosen, the audio
window still runs for what is not sound: MIDI (Web MIDI), and reading a file's peaks and samples for the waveform and
the tempo (`peaks`, `pcm`).

## The arithmetic both sides use

Fade shapes, the Volume and Pan lines, and a knob's scale are drawn by the window (TypeScript) and played by the
engine (Rust). They are written twice, and held to one answer: `test/native-audio.test.ts` asks
`core/audio/curves.ts` and `core/audio/lanes.ts` for values at many points and the native engine's own tests read the
same vectors (`native/audio/tests/vectors.json`, written by `npm run native:vectors`).

## Not verified yet

Everything about this engine on real equipment: its latency and steadiness on an interface (`ec-audio measure`
is the script), a lost device, Windows (WASAPI) and Linux (ALSA), more than two outputs, and listening to any of it.
