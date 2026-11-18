//! A sound streamed from disk: a thread of its own decodes it (and resamples it to the device's rate) a little
//! ahead into a ring buffer, which the audio thread reads. The thread ends when the sound is let go of (its reader
//! is dropped) or the file ends.

use crate::pcm::{self, Step};
use rtrb::{Consumer, Producer, RingBuffer};
use rubato::{FftFixedIn, Resampler};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
use std::sync::Arc;
use std::time::Duration;

/// The most channels a stream carries (more are left out).
pub const STREAM_CH: usize = 8;
/// How far ahead the thread decodes, and how much must be there before the sound starts.
const AHEAD_S: f64 = 1.0;
pub const PREFILL_S: f64 = 0.2;

/// What the stream's thread says of it, without a message.
#[derive(Debug, Default)]
pub struct StreamInfo {
    /// the file has ended and everything decoded is in the ring
    pub eof: AtomicBool,
    /// its length in frames at the device's rate (0: not known yet)
    pub frames: AtomicU64,
    /// go round to the start at the end (a `loop` of a streamed sound)
    pub looping: AtomicBool,
    /// how often the audio thread found the ring empty
    pub underruns: AtomicU64,
    /// it could not be read (the reason is sent to the control thread)
    pub failed: AtomicBool,
}

/// The audio thread's end: the ring and what it needs to read it.
pub struct Reader {
    pub rx: Consumer<f32>,
    pub info: Arc<StreamInfo>,
    pub channels: usize,
    pub sr: u32,
    /// seconds into the file it starts at
    pub from: f64,
}

/// A streamed sound started from `from` seconds into `path`, at `sr`. `channels`: how many it has (from the
/// header, read here before the thread starts so the reader knows); `fail` is called with the reason if it cannot
/// be read.
pub fn start(path: PathBuf, from: f64, sr: u32, looping: bool, fail: impl FnOnce(String) + Send + 'static) -> Result<Reader, String> {
    let mut src = pcm::open(&path)?;
    let channels = src.decoder.codec_params().channels.map(|c| c.count()).unwrap_or(2).clamp(1, STREAM_CH);
    let info = Arc::new(StreamInfo::default());
    info.looping.store(looping, Relaxed);
    if let (Some(n), true) = (src.frames, src.sr > 0) {
        info.frames.store(n * sr as u64 / src.sr as u64, Relaxed);
    }
    let cap = ((AHEAD_S * sr as f64) as usize).max(8192) * channels;
    let (tx, rx) = RingBuffer::<f32>::new(cap);
    let i2 = info.clone();
    std::thread::Builder::new()
        .name("ec-stream".into())
        .spawn(move || {
            if let Err(e) = run(&mut src, from, sr, channels, tx, &i2) {
                i2.failed.store(true, Relaxed);
                fail(e);
            }
            i2.eof.store(true, Relaxed);
        })
        .map_err(|e| e.to_string())?;
    Ok(Reader { rx, info, channels, sr, from })
}

/// Into the ring, waiting while it is full. false: nobody is reading any more.
fn put(tx: &mut Producer<f32>, samples: &[f32]) -> bool {
    let mut at = 0;
    while at < samples.len() {
        if tx.is_abandoned() {
            return false;
        }
        let n = tx.slots().min(samples.len() - at);
        if n == 0 {
            std::thread::sleep(Duration::from_millis(3));
            continue;
        }
        if let Ok(chunk) = tx.write_chunk_uninit(n) {
            chunk.fill_from_iter(samples[at..at + n].iter().copied());
        }
        at += n;
    }
    true
}

/// A file's samples to the ring's channel count (extra channels left out, a missing one silent).
fn fit(s: &[f32], have: usize, want: usize, out: &mut Vec<f32>) {
    out.clear();
    for f in s.chunks_exact(have) {
        out.extend((0..want).map(|c| f.get(c).copied().unwrap_or(0.0)));
    }
}

struct Rs {
    rs: FftFixedIn<f32>,
    pending: Vec<Vec<f32>>,
    skip: usize,
}

impl Rs {
    fn feed(&mut self, inter: &[f32], ch: usize, out: &mut Vec<f32>, last: bool) -> Result<(), String> {
        for f in inter.chunks_exact(ch) {
            for (c, x) in f.iter().enumerate() {
                self.pending[c].push(*x);
            }
        }
        out.clear();
        let mut put = |o: Vec<Vec<f32>>, skip: &mut usize| {
            let n = o[0].len();
            for i in 0..n {
                if *skip > 0 {
                    *skip -= 1;
                    continue;
                }
                for v in &o {
                    out.push(v[i]);
                }
            }
        };
        while self.pending[0].len() >= self.rs.input_frames_next() {
            let k = self.rs.input_frames_next();
            let chunk: Vec<&[f32]> = self.pending.iter().map(|c| &c[..k]).collect();
            let o = self.rs.process(&chunk, None).map_err(|e| e.to_string())?;
            for c in &mut self.pending {
                c.drain(..k);
            }
            put(o, &mut self.skip);
        }
        if last {
            let chunk: Vec<&[f32]> = self.pending.iter().map(|c| &c[..]).collect();
            let o = self.rs.process_partial(Some(&chunk), None).map_err(|e| e.to_string())?;
            put(o, &mut self.skip);
            let o = self.rs.process_partial::<&[f32]>(None, None).map_err(|e| e.to_string())?;
            put(o, &mut self.skip);
        }
        Ok(())
    }
}

fn run(src: &mut pcm::Source, from: f64, sr: u32, ch: usize, mut tx: Producer<f32>, info: &StreamInfo) -> Result<(), String> {
    let mut skip_to = if from > 0.0 { src.seek(from)? } else { 0 };
    let mut rs: Option<Rs> = None;
    let mut fitted = Vec::new();
    let mut resampled = Vec::new();
    loop {
        if tx.is_abandoned() {
            return Ok(());
        }
        match src.packet()? {
            Step::Samples(s, have, ts) => {
                if src.sr == 0 {
                    return Err("no sample rate".into());
                }
                if rs.is_none() && src.sr != sr {
                    let r = FftFixedIn::<f32>::new(src.sr as usize, sr as usize, 1024, 2, ch).map_err(|e| e.to_string())?;
                    rs = Some(Rs { skip: r.output_delay(), rs: r, pending: vec![Vec::new(); ch] });
                }
                // (after a seek the first packet may begin before the place asked for)
                let mut s = &s[..];
                if skip_to > ts {
                    let drop = ((skip_to - ts) as usize * have).min(s.len());
                    s = &s[drop..];
                }
                skip_to = 0;
                fit(s, have, ch, &mut fitted);
                let ok = match &mut rs {
                    Some(r) => {
                        r.feed(&fitted, ch, &mut resampled, false)?;
                        put(&mut tx, &resampled)
                    }
                    None => put(&mut tx, &fitted),
                };
                if !ok {
                    return Ok(());
                }
            }
            Step::End => {
                if info.looping.load(Relaxed) {
                    src.seek(0.0)?;
                    continue;
                }
                if let Some(r) = &mut rs {
                    r.feed(&[], ch, &mut resampled, true)?;
                    put(&mut tx, &resampled);
                }
                return Ok(());
            }
        }
    }
}
