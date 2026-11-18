//! Endless Cues' native audio engine (docs/specs/18-native-audio.md): the `ec-audio` program's parts.
//!
//! The line between the two languages: Rust does what runs once per sample or must land on an exact sample;
//! TypeScript (the cue engine) decides what should happen, and says so in the audio window's own commands.
//!
//!   control   the commands in, the events out (the control thread)
//!   mixer     what the audio thread runs: voices, buses, pairs, the master, the limiter
//!   voice     one sound playing: where it reads from, its level, its lines, its pan
//!   params    levels that move, a sample at a time
//!   arith     the arithmetic shared with core/audio/curves.ts and lanes.ts
//!   pcm       decoding (symphonia) and resampling (rubato)
//!   stream    a sound streamed from disk through a ring buffer
//!   device    the audio device (cpal), and a test run's clock
//!   measure   `ec-audio measure`: how long from a GO to the sound
//!   shared    the atomics the audio thread says things through

pub mod arith;
pub mod control;
pub mod device;
pub mod limiter;
pub mod measure;
pub mod mixer;
pub mod params;
pub mod pcm;
pub mod shared;
pub mod stream;
pub mod voice;
