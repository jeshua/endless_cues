//! `--capture <file.wav>` (a test's, off unless asked): exactly the frames the mixer hands to the device, written to
//! a WAV file, with each buffer's moment beside it.
//!
//! The audio thread copies each buffer into a ring (made with the capture, never grown) and says when it was, in a
//! second ring; a writer thread of its own empties both to disk. Nothing in the callback allocates, locks or waits:
//! a buffer the ring has no room for is counted, written as silence of its length, and marked in the log.
//!
//! What it writes, for `cap.wav`:
//!   cap.wav          32-bit float, the device's rate and outputs; a change of device starts `cap-1.wav`, `cap-2.wav`…
//!   cap.blocks.csv   one line a buffer: segment, frame in that segment's file, frames, the mixer's frame count, the
//!                    moment its first frame is heard and the moment the callback ran (ns since the program started),
//!                    the device's own latency (ns), and 1 if it was dropped from the capture
//!   cap.cmds.jsonl   each command as it was taken: {"ns": …, "line": …} (main.rs writes these)
//!
//! The ns are the program's own steady clock (`shared::now_ns`); `cap.blocks.csv`'s first line says what wall-clock
//! millisecond its zero was.

use crate::shared::{now_ns, MAX_OUT};
use rtrb::{Consumer, Producer, RingBuffer};
use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Seconds of the device's output the ring holds (at 48 kHz, eight outputs).
const RING_S: usize = 4;

/// One buffer, as the writer is told of it.
#[derive(Clone, Copy, Debug)]
pub struct Block {
    pub frames: u32,
    pub channels: u16,
    pub sr: u32,
    pub mixer_frame: u64,
    pub present_ns: u64,
    pub callback_ns: u64,
    pub latency_ns: u64,
    pub dropped: bool,
}

/// What the capture says without a message.
#[derive(Debug, Default)]
pub struct CaptureInfo {
    /// buffers that did not fit in the ring
    pub dropped: AtomicU64,
    /// buffers written
    pub blocks: AtomicU64,
    stop: AtomicBool,
}

/// The audio thread's end.
pub struct Capture {
    samples: Producer<f32>,
    blocks: Producer<Block>,
    pub info: Arc<CaptureInfo>,
}

/// The control side's end: stops the writer and waits for it to finish the files.
pub struct CaptureHandle {
    pub info: Arc<CaptureInfo>,
    writer: Option<std::thread::JoinHandle<()>>,
}

impl CaptureHandle {
    pub fn finish(&mut self) {
        self.info.stop.store(true, Relaxed);
        if let Some(w) = self.writer.take() {
            let _ = w.join();
        }
    }
}
impl Drop for CaptureHandle {
    fn drop(&mut self) {
        self.finish();
    }
}

impl Capture {
    /// Copies one buffer into the ring (the audio thread). `out` is interleaved, `channels` wide.
    #[inline]
    pub fn put(&mut self, out: &[f32], channels: usize, sr: f64, mixer_frame: u64, present_ns: u64, latency_ns: u64) {
        let ch = channels.max(1);
        let mut b = Block {
            frames: (out.len() / ch) as u32,
            channels: ch as u16,
            sr: sr as u32,
            mixer_frame,
            present_ns,
            callback_ns: now_ns(),
            latency_ns,
            dropped: false,
        };
        if self.blocks.slots() == 0 {
            self.info.dropped.fetch_add(1, Relaxed);
            return;
        }
        if self.samples.slots() < out.len() {
            b.dropped = true;
            self.info.dropped.fetch_add(1, Relaxed);
        } else if let Ok(chunk) = self.samples.write_chunk_uninit(out.len()) {
            chunk.fill_from_iter(out.iter().copied());
        }
        let _ = self.blocks.push(b);
    }
}

/// A capture to `path`: the audio thread's end and the handle that finishes it.
pub fn start(path: &Path) -> std::io::Result<(Capture, CaptureHandle)> {
    let (stx, srx) = RingBuffer::<f32>::new(RING_S * 48000 * 8);
    let (btx, brx) = RingBuffer::<Block>::new(RING_S * 48000 / 16);
    let info = Arc::new(CaptureInfo::default());
    let mut w = Writer::new(path)?;
    let i2 = info.clone();
    let writer = std::thread::Builder::new().name("ec-capture".into()).spawn(move || w.run(srx, brx, &i2))?;
    Ok((Capture { samples: stx, blocks: btx, info: info.clone() }, CaptureHandle { info, writer: Some(writer) }))
}

/// The writer's thread: the files and where it is in them.
struct Writer {
    base: PathBuf,
    log: BufWriter<File>,
    wav: Option<Wav>,
    segment: usize,
}

struct Wav {
    file: BufWriter<File>,
    sr: u32,
    channels: u16,
    frames: u64,
}

impl Wav {
    fn create(path: &Path, sr: u32, channels: u16) -> std::io::Result<Wav> {
        let mut file = BufWriter::new(File::create(path)?);
        file.write_all(&header(sr, channels, 0))?;
        Ok(Wav { file, sr, channels, frames: 0 })
    }
    /// Its header made true to what is in it (so a file is whole even if the program is killed later).
    fn seal(&mut self) -> std::io::Result<()> {
        self.file.flush()?;
        let f = self.file.get_mut();
        f.seek(SeekFrom::Start(0))?;
        f.write_all(&header(self.sr, self.channels, self.frames))?;
        f.seek(SeekFrom::End(0))?;
        Ok(())
    }
}

/// A 32-bit float WAV header for `frames` frames.
fn header(sr: u32, ch: u16, frames: u64) -> Vec<u8> {
    let data = (frames * ch as u64 * 4).min(u32::MAX as u64 - 64) as u32;
    let mut b = Vec::with_capacity(58);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(50 + data).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&18u32.to_le_bytes());
    b.extend_from_slice(&3u16.to_le_bytes());
    b.extend_from_slice(&ch.to_le_bytes());
    b.extend_from_slice(&sr.to_le_bytes());
    b.extend_from_slice(&(sr * ch as u32 * 4).to_le_bytes());
    b.extend_from_slice(&(ch * 4).to_le_bytes());
    b.extend_from_slice(&32u16.to_le_bytes());
    b.extend_from_slice(&0u16.to_le_bytes());
    b.extend_from_slice(b"fact");
    b.extend_from_slice(&4u32.to_le_bytes());
    b.extend_from_slice(&(frames.min(u32::MAX as u64) as u32).to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data.to_le_bytes());
    b
}

/// The file of segment `k`: `cap.wav`, then `cap-1.wav`, …
pub fn segment_path(base: &Path, k: usize) -> PathBuf {
    if k == 0 {
        return base.to_path_buf();
    }
    let stem = base.file_stem().and_then(|s| s.to_str()).unwrap_or("capture");
    base.with_file_name(format!("{stem}-{k}.wav"))
}
/// `cap.wav` → `cap.<what>`.
pub fn beside(base: &Path, what: &str) -> PathBuf {
    let stem = base.file_stem().and_then(|s| s.to_str()).unwrap_or("capture");
    base.with_file_name(format!("{stem}.{what}"))
}

impl Writer {
    fn new(path: &Path) -> std::io::Result<Writer> {
        let mut log = BufWriter::new(File::create(beside(path, "blocks.csv"))?);
        let wall = crate::control::wall_of(0);
        writeln!(log, "# zero_ns_is_wall_ms={wall:.3}")?;
        writeln!(log, "segment,file_frame,frames,mixer_frame,present_ns,callback_ns,latency_ns,dropped,sr,channels")?;
        Ok(Writer { base: path.to_path_buf(), log, wav: None, segment: 0 })
    }

    fn run(&mut self, mut samples: Consumer<f32>, mut blocks: Consumer<Block>, info: &CaptureInfo) {
        let mut buf: Vec<u8> = Vec::with_capacity(BLOCK_BYTES);
        let mut sealed = Instant::now();
        loop {
            let stopping = info.stop.load(Relaxed);
            let mut any = false;
            while let Ok(b) = blocks.pop() {
                any = true;
                if let Err(e) = self.block(&b, &mut samples, &mut buf) {
                    eprintln!("[native] the capture: {e}");
                    return;
                }
                info.blocks.fetch_add(1, Relaxed);
            }
            if sealed.elapsed() > Duration::from_millis(250) || stopping {
                sealed = Instant::now();
                let _ = self.log.flush();
                if let Some(w) = &mut self.wav {
                    let _ = w.seal();
                }
            }
            if stopping && !any {
                return;
            }
            if !any {
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }

    fn block(&mut self, b: &Block, samples: &mut Consumer<f32>, buf: &mut Vec<u8>) -> std::io::Result<()> {
        let ch = (b.channels as usize).clamp(1, MAX_OUT);
        let n = b.frames as usize * ch;
        let new = match &self.wav {
            None => true,
            Some(w) => w.sr != b.sr || w.channels as usize != ch,
        };
        if new {
            if let Some(w) = &mut self.wav {
                w.seal()?;
                self.segment += 1;
            }
            self.wav = Some(Wav::create(&segment_path(&self.base, self.segment), b.sr, ch as u16)?);
        }
        let Some(w) = &mut self.wav else { return Ok(()) };
        writeln!(
            self.log,
            "{},{},{},{},{},{},{},{},{},{}",
            self.segment, w.frames, b.frames, b.mixer_frame, b.present_ns, b.callback_ns, b.latency_ns, b.dropped as u8, b.sr, ch
        )?;
        buf.clear();
        if b.dropped {
            buf.resize(n * 4, 0);
        } else {
            // (the samples of a block are in the ring before the block is: they are there)
            let chunk = samples.read_chunk(n.min(samples.slots())).map_err(|e| std::io::Error::other(e.to_string()))?;
            let (x, y) = chunk.as_slices();
            for s in x.iter().chain(y) {
                buf.extend_from_slice(&s.to_le_bytes());
            }
            chunk.commit_all();
            buf.resize(n * 4, 0);
        }
        w.file.write_all(buf)?;
        w.frames += b.frames as u64;
        Ok(())
    }
}

const BLOCK_BYTES: usize = 4096 * MAX_OUT * 4;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_capture_writes_what_it_is_given_and_starts_a_new_file_for_a_new_device() {
        let dir = std::env::temp_dir().join(format!("ec-capture-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cap.wav");
        let (mut cap, mut handle) = start(&path).unwrap();
        let a: Vec<f32> = (0..512).map(|i| i as f32 / 1024.0).collect();
        cap.put(&a, 2, 48000.0, 0, 1000, 5);
        cap.put(&a, 2, 48000.0, 256, 2000, 5);
        cap.put(&a[..300], 3, 44100.0, 512, 3000, 5);
        handle.finish();
        let one = std::fs::read(&path).unwrap();
        assert_eq!(&one[0..4], b"RIFF");
        let data: Vec<f32> = one[58..].chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
        assert_eq!(data.len(), 1024);
        assert_eq!(&data[..512], &a[..]);
        assert_eq!(u32::from_le_bytes([one[54], one[55], one[56], one[57]]), 1024 * 4, "the header says how much");
        let two = std::fs::read(segment_path(&path, 1)).unwrap();
        assert_eq!(u16::from_le_bytes([two[22], two[23]]), 3);
        assert_eq!(u32::from_le_bytes([two[24], two[25], two[26], two[27]]), 44100);
        let log = std::fs::read_to_string(beside(&path, "blocks.csv")).unwrap();
        let lines: Vec<&str> = log.lines().filter(|l| !l.starts_with('#') && !l.starts_with("segment")).collect();
        let want = ["0,0,256,0,1000,", "0,256,256,256,2000,", "1,0,100,512,3000,"];
        assert_eq!(lines.len(), 3);
        for (l, w) in lines.iter().zip(want) {
            assert!(l.starts_with(w), "{l} is {w}…");
        }
        assert_eq!(cap.info.dropped.load(Relaxed), 0);
    }
}
