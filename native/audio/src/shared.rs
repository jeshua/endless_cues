//! What the audio thread says without a message: meters, where each sound is, the clock. Plain atomics, written by
//! the audio thread and read (and reset) by the control thread 30 times a second. Lock-free; nothing allocates.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering::Relaxed};
use std::sync::OnceLock;
use std::time::Instant;

/// The most outputs a device is opened with.
pub const MAX_OUT: usize = 64;

/// The moment every `_ns` here is counted from (the program's start).
pub fn epoch() -> Instant {
    static E: OnceLock<Instant> = OnceLock::new();
    *E.get_or_init(Instant::now)
}
/// Nanoseconds since `epoch()`.
pub fn now_ns() -> u64 {
    epoch().elapsed().as_nanos() as u64
}

/// A peak: the loudest sample since it was last read. (A positive f32's bits order as the number does, so
/// `fetch_max` on them is a max of the numbers.)
#[derive(Default, Debug)]
pub struct Peak(AtomicU32);
impl Peak {
    #[inline]
    pub fn put(&self, x: f32) {
        if x > 0.0 && x.is_finite() {
            self.0.fetch_max(x.to_bits(), Relaxed);
        }
    }
    pub fn take(&self) -> f32 {
        f32::from_bits(self.0.swap(0, Relaxed))
    }
}

/// An f64 kept in an atomic.
#[derive(Default, Debug)]
pub struct AtomicF64(AtomicU64);
impl AtomicF64 {
    pub fn new(v: f64) -> Self {
        AtomicF64(AtomicU64::new(v.to_bits()))
    }
    #[inline]
    pub fn set(&self, v: f64) {
        self.0.store(v.to_bits(), Relaxed);
    }
    pub fn get(&self) -> f64 {
        f64::from_bits(self.0.load(Relaxed))
    }
    #[inline]
    pub fn add(&self, v: f64) {
        let _ = self.0.fetch_update(Relaxed, Relaxed, |b| Some((f64::from_bits(b) + v).to_bits()));
    }
    pub fn take(&self) -> f64 {
        f64::from_bits(self.0.swap(0f64.to_bits(), Relaxed))
    }
}

/// One sound's: its peak after its own level and lines, where it is (seconds into its file, read at the start of
/// the last block), and the moment its first sample is heard.
#[derive(Debug)]
pub struct VoiceShared {
    pub peak: Peak,
    pub pos: AtomicF64,
    pub playing: AtomicBool,
    /// ns since `epoch()` its first sample reaches the output (u64::MAX: not yet).
    pub started_ns: AtomicU64,
    /// the mixer's frame its first sample is at (u64::MAX: not yet)
    pub started_frame: AtomicU64,
}
impl Default for VoiceShared {
    fn default() -> Self {
        VoiceShared {
            peak: Peak::default(),
            pos: AtomicF64::new(0.0),
            playing: AtomicBool::new(false),
            started_ns: AtomicU64::new(u64::MAX),
            started_frame: AtomicU64::new(u64::MAX),
        }
    }
}

/// One bus's peak, after its fader.
#[derive(Default, Debug)]
pub struct BusShared {
    pub peak: Peak,
}

/// The outputs' meters: each output's peak and RMS after the limiter (and its trim), each output's peak before the
/// master (where the audio window reads a pair's meter), the main pair's peak as one channel, and how hard the
/// limiter worked.
#[derive(Debug)]
pub struct Meters {
    pub post: Vec<Peak>,
    pub sq: Vec<AtomicF64>,
    pub frames: AtomicU64,
    pub pre: Vec<Peak>,
    pub main: Peak,
    /// the least gain any limiter gave since this was read, as 1 − gain (0: it did nothing)
    pub limited: Peak,
    /// the mixer's frame count and the moment (ns since `epoch()`) the first frame of the last block is heard
    pub frame: AtomicU64,
    pub frame_ns: AtomicU64,
    /// the device's own delay to the ear (ns), at the last block: cpal's, and on macOS what the device adds (mac.rs)
    pub latency_ns: AtomicU64,
    /// buffers the device played that the engine never filled (a gap in the device's own clock between two
    /// callbacks, or the silent clock having to catch up), since the program started
    pub xruns: AtomicU64,
    /// frames in the device's last buffer (what it gave, whatever was asked)
    pub buffer_frames: AtomicU64,
    /// the longest a buffer took to render since this was read, as a share of the buffer's own time (1: all of it)
    pub load: Peak,
}
impl Default for Meters {
    fn default() -> Self {
        Meters {
            post: (0..MAX_OUT).map(|_| Peak::default()).collect(),
            sq: (0..MAX_OUT).map(|_| AtomicF64::default()).collect(),
            frames: AtomicU64::new(0),
            pre: (0..MAX_OUT).map(|_| Peak::default()).collect(),
            main: Peak::default(),
            limited: Peak::default(),
            frame: AtomicU64::new(0),
            frame_ns: AtomicU64::new(0),
            latency_ns: AtomicU64::new(0),
            xruns: AtomicU64::new(0),
            buffer_frames: AtomicU64::new(0),
            load: Peak::default(),
        }
    }
}
