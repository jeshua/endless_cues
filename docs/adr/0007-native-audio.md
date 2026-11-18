# 0007 · A native audio engine, in Rust, as a process of its own

**Status:** accepted; built and off by default. The spec is [18 · The native audio engine](../specs/18-native-audio.md).

## Decision

A second engine makes the sound: `ec-audio`, a small Rust program (`native/audio/`) that the main process starts as a
child when this computer chooses it (Settings ▸ Audio ▸ Audio engine, `audio.engine` in `config.json`).

- **Rust does what runs once per sample or must land on an exact sample; TypeScript decides what should happen.** The
  cue engine (`core/engine/`), the host and the show file do not change. They send the commands they send the audio
  window today, and either engine carries them out.
- **It is a process of its own, as the audio window is.** It speaks newline-delimited JSON on its standard input and
  output: the window's own commands in (a file by its path, never its bytes), the window's own events out. It holds no
  show state. If it dies the host starts it again and forgets what was playing, as it does when the audio window dies;
  three exits in a minute, or no program, and Web Audio plays for the rest of the sitting, said in a notice and the
  show log (`app/main/native-audio.ts`).
- **Off by default until it has played real shows.** Web Audio shipped a show; the native engine has not. It stays
  "experimental" in its own switch, and [00](../specs/00-defaults.md) lists it, until it has been run through real
  interfaces and real shows. The audio window keeps running beside it for MIDI and for reading waveforms, and is the
  fallback.

## Why

- **Latency and steadiness.** Web Audio streams a sound through an `<audio>` element and starts it "soon"; a decoded
  sound starts on the next render quantum, behind Chromium's own output buffering. A native engine opens the device at
  128 or 256 frames and starts a preloaded sound on the next buffer, loops to the sample, and can say how late it was.
- **The audio thread's safety.** In the audio window the mixing runs beside a garbage collector, a renderer process
  Chromium may throttle, and a DOM. In Rust the callback allocates nothing, takes no lock and cannot be paused by
  anything but the operating system.
- **What [05](../specs/05-audio.md) says Web Audio cannot reach**: device control (buffer size, sample rate, ASIO,
  JACK), more than one device, sample-synchronous starts, plugins. Each needs native code somewhere; this is the one
  place for it.
- **Crash isolation.** A fault in native code in the main process would take the show host with it: the document,
  the engine, every module. In a child process it takes only the sound, which the host already knows how to lose and
  get back.

## What it costs

- A Rust toolchain to build the app (`npm run native`, before `npm run pack`), and one more binary per platform and
  architecture to build, sign and ship (`docs/RELEASING.md`).
- Arithmetic written twice: fade shapes, the Volume and Pan lines and a knob's scale are drawn in TypeScript and
  played in Rust. They are held to one answer by shared vectors (`npm run native:vectors`) read by both test suites.
- Two engines to keep in step while both exist. What the native one cannot do yet it says (`operror`), and the sound
  plays without it; nothing is silently dropped.

## Not chosen

- **A native module in the main process (napi-rs).** No process boundary to cross for a command, but a crash in the
  audio code is a crash of the show host, and the audio callback would share a process with the cue engine's garbage
  collector and the modules' sockets. The JSON lines cost microseconds against a buffer of milliseconds.
- **All of `core/` in Rust.** The cue engine is where the show's meaning lives, it changes every week, and it is tested
  in milliseconds on a fake clock. Rewriting it would buy nothing the operator hears: the engine decides in tens of
  milliseconds what the audio thread then does to the sample.
- **Tauri (a Rust shell in place of Electron).** The whole app moved for the sake of one part of it: the window, the
  stage, the web remote and every page would change, and the system web views it uses differ per platform, which
  Electron's one Chromium spares us ([0001](0001-electron.md)).
