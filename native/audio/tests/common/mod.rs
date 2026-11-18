//! The offline renderer the tests use: the control thread and the mixer in one place, no device, no threads. A
//! command goes in as the host sends it; `render` runs the mixer for so many frames into a buffer.
#![allow(dead_code)]

use crossbeam_channel::{unbounded, Receiver};
use ec_audio::control::{Control, NoOutput};
use ec_audio::device::engine;
use ec_audio::mixer::Mixer;
use ec_audio::pcm::Pcm;
use ec_audio::shared::Meters;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;

pub const SR: f64 = 48000.0;

pub struct Rig {
    pub control: Control,
    pub mixer: Mixer,
    pub events: Receiver<String>,
    pub ch: usize,
}

impl Rig {
    pub fn new(ch: usize) -> Self {
        let meters = Arc::new(Meters::default());
        let (ev_tx, events) = unbounded();
        let (in_tx, _in_rx) = unbounded();
        let (mixer, ends) = engine(SR, ch, meters);
        let mut control = Control::new(SR, ch, ends, ev_tx, in_tx, Box::new(NoOutput(SR, ch)));
        control.inline = true;
        Rig { control, mixer, events, ch }
    }
    pub fn cmd(&mut self, v: Value) {
        self.control.command(&v);
    }
    /// `frames` of every output, interleaved.
    pub fn render(&mut self, frames: usize) -> Vec<f32> {
        let mut out = vec![0f32; frames * self.ch];
        self.mixer.render(&mut out, 0, 0);
        self.control.poll();
        out
    }
    /// `frames` of output `c` (0: the first).
    pub fn out(&mut self, frames: usize, c: usize) -> Vec<f32> {
        let ch = self.ch;
        self.render(frames).chunks(ch).map(|f| f[c]).collect()
    }
    pub fn left(&mut self, frames: usize) -> Vec<f32> {
        self.out(frames, 0)
    }
    /// Every event said since the last time asked.
    pub fn said(&mut self) -> Vec<Value> {
        self.control.poll();
        self.events.try_iter().map(|s| serde_json::from_str(&s).unwrap()).collect()
    }
    pub fn insert(&mut self, path: &str, pcm: Pcm) {
        self.control.insert(path, pcm);
    }
}

/// A buffer whose every frame says which frame it is: frame i is (i mod 50000) / 100000, on every channel, so a
/// sample in the output names the sample of the file it came from.
pub fn ramp(frames: usize, ch: usize) -> Pcm {
    let mut d = Vec::with_capacity(frames * ch);
    for i in 0..frames {
        for _ in 0..ch {
            d.push(index_value(i));
        }
    }
    Pcm::new(SR as u32, ch, d)
}
pub fn index_value(i: usize) -> f32 {
    (i % 50000) as f32 / 100000.0
}
/// Which frame of a `ramp` a sample is.
pub fn index_of(x: f32) -> usize {
    (x * 100000.0).round() as usize
}

/// A steady level, `frames` long.
pub fn dc(frames: usize, ch: usize, v: f32) -> Pcm {
    Pcm::new(SR as u32, ch, vec![v; frames * ch])
}

/// A 16-bit WAV file of a tone, written where the tests can find it; its path.
pub fn wav(name: &str, secs: f64, sr: u32, ch: u16, amp: f64) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("ec-audio-tests-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    let n = (secs * sr as f64) as u32;
    let mut b = Vec::new();
    let data_len = n * ch as u32 * 2;
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data_len).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&ch.to_le_bytes());
    b.extend_from_slice(&sr.to_le_bytes());
    b.extend_from_slice(&(sr * ch as u32 * 2).to_le_bytes());
    b.extend_from_slice(&(ch * 2).to_le_bytes());
    b.extend_from_slice(&16u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data_len.to_le_bytes());
    for i in 0..n {
        let x = (amp * (std::f64::consts::TAU * 440.0 * i as f64 / sr as f64).sin() * 32767.0) as i16;
        for _ in 0..ch {
            b.extend_from_slice(&x.to_le_bytes());
        }
    }
    std::fs::write(&path, b).unwrap();
    path
}

/// The events of a type.
pub fn of<'a>(evs: &'a [Value], ty: &str) -> Vec<&'a Value> {
    evs.iter().filter(|e| e["type"] == ty).collect()
}
