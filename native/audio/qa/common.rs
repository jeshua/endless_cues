//! What the QA scripts share: the program run as the host runs it, its capture read back, an input recorded
//! (BlackHole's, a digital loop of its output), and test files written.
#![allow(dead_code)]

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const BLACKHOLE: &str = "BlackHole 2ch";
pub const RODE: &str = "RØDE Connect Virtual";
pub const SPEAKERS: &str = "MacBook Pro Speakers";

/// The program built by `cargo build --release` (next to this example's own binary's folder).
pub fn binary() -> PathBuf {
    let exe = std::env::current_exe().unwrap();
    // target/release/examples/qa → target/release/ec-audio
    let p = exe.parent().unwrap().parent().unwrap().join("ec-audio");
    assert!(p.exists(), "build it first: cargo build --release ({})", p.display());
    p
}

/// A folder for this run's files.
pub fn scratch(name: &str) -> PathBuf {
    let d = std::env::var("EC_QA_DIR").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir().join("ec-audio-qa")).join(name);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// The show app is not running (it would share the device; a run never starts beside it).
pub fn the_show_is_not_running() {
    let out = Command::new("pgrep").args(["-f", "^/[^-]*Endless Cues\\.app/Contents/MacOS/"]).output().unwrap();
    if !out.stdout.is_empty() {
        eprintln!("the show's app is running: not starting");
        std::process::exit(3);
    }
}

pub struct Engine {
    pub child: Child,
    stdin: Option<ChildStdin>,
    events: Receiver<Value>,
    pub seen: Vec<Value>,
    pub log: Arc<Mutex<Vec<String>>>,
}

impl Engine {
    pub fn start(args: &[&str]) -> Engine {
        let mut child = Command::new(binary())
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("the program");
        let stdin = child.stdin.take().unwrap();
        let out = BufReader::new(child.stdout.take().unwrap());
        let err = BufReader::new(child.stderr.take().unwrap());
        let (tx, events) = channel();
        std::thread::spawn(move || {
            for line in out.lines().map_while(Result::ok) {
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    if tx.send(v).is_err() {
                        return;
                    }
                }
            }
        });
        let log = Arc::new(Mutex::new(Vec::new()));
        let l2 = log.clone();
        std::thread::spawn(move || {
            for line in err.lines().map_while(Result::ok) {
                if std::env::var("EC_QA_VERBOSE").is_ok() {
                    eprintln!("{line}");
                }
                l2.lock().unwrap().push(line);
            }
        });
        Engine { child, stdin: Some(stdin), events, seen: Vec::new(), log }
    }
    pub fn send(&mut self, v: Value) {
        let i = self.stdin.as_mut().unwrap();
        writeln!(i, "{v}").unwrap();
        i.flush().unwrap();
    }
    pub fn send_raw(&mut self, s: &str) -> std::io::Result<()> {
        let i = self.stdin.as_mut().unwrap();
        i.write_all(s.as_bytes())?;
        i.flush()
    }
    /// The first event (from now on) `pick` takes, within `secs`; None if none came.
    pub fn wait(&mut self, secs: f64, pick: impl Fn(&Value) -> bool) -> Option<Value> {
        let until = Instant::now() + Duration::from_secs_f64(secs);
        while let Some(left) = until.checked_duration_since(Instant::now()) {
            match self.events.recv_timeout(left) {
                Ok(v) => {
                    self.seen.push(v.clone());
                    if pick(&v) {
                        return Some(v);
                    }
                }
                Err(_) => return None,
            }
        }
        None
    }
    pub fn must(&mut self, secs: f64, what: &str, pick: impl Fn(&Value) -> bool) -> Value {
        self.wait(secs, pick).unwrap_or_else(|| panic!("{what}: nothing came in {secs} s"))
    }
    /// Everything said since.
    pub fn drain(&mut self) -> Vec<Value> {
        let v: Vec<Value> = self.events.try_iter().collect();
        self.seen.extend(v.iter().cloned());
        v
    }
    pub fn decode(&mut self, file: &Path) -> Value {
        let f = file.to_str().unwrap().to_string();
        self.send(json!({ "op": "decode", "file": f }));
        self.must(30.0, "decoded", |e| e["type"] == "decoded" && e["file"] == f)
    }
    /// Its input closed, and it gone (true if it went by itself, cleanly).
    pub fn close(mut self) -> bool {
        drop(self.stdin.take());
        let until = Instant::now() + Duration::from_secs(5);
        while Instant::now() < until {
            if let Ok(Some(s)) = self.child.try_wait() {
                return s.success();
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let _ = self.child.kill();
        false
    }
    pub fn pid(&self) -> u32 {
        self.child.id()
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

// ── files ──

/// A 32-bit float WAV of `data` (interleaved).
pub fn wav_f32(path: &Path, sr: u32, ch: u16, data: &[f32]) {
    let n = data.len() as u32 * 4;
    let mut b = Vec::with_capacity(n as usize + 44);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + n).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&3u16.to_le_bytes());
    b.extend_from_slice(&ch.to_le_bytes());
    b.extend_from_slice(&sr.to_le_bytes());
    b.extend_from_slice(&(sr * ch as u32 * 4).to_le_bytes());
    b.extend_from_slice(&(ch * 4).to_le_bytes());
    b.extend_from_slice(&32u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&n.to_le_bytes());
    for x in data {
        b.extend_from_slice(&x.to_le_bytes());
    }
    std::fs::write(path, b).unwrap();
}

/// Frame i says which frame it is: (i mod 50000 + 1) / 100000 (never zero, so silence is never a frame).
pub fn index_value(i: usize) -> f32 {
    ((i % 50000) + 1) as f32 / 100000.0
}
pub fn index_of(x: f32) -> i64 {
    (x as f64 * 100000.0).round() as i64 - 1
}
pub fn ramp(frames: usize, ch: usize) -> Vec<f32> {
    (0..frames).flat_map(|i| std::iter::repeat_n(index_value(i), ch)).collect()
}

/// A WAV file read back: (rate, channels, interleaved f32). Float and 16/24/32-bit integer.
pub fn read_wav(path: &Path) -> (u32, usize, Vec<f32>) {
    let b = std::fs::read(path).unwrap();
    let mut at = 12;
    let (mut fmt, mut ch, mut sr, mut bits) = (0u16, 0usize, 0u32, 0u16);
    while at + 8 <= b.len() {
        let id = &b[at..at + 4];
        let len = u32::from_le_bytes(b[at + 4..at + 8].try_into().unwrap()) as usize;
        let body = &b[at + 8..];
        if id == b"fmt " {
            fmt = u16::from_le_bytes([body[0], body[1]]);
            ch = u16::from_le_bytes([body[2], body[3]]) as usize;
            sr = u32::from_le_bytes(body[4..8].try_into().unwrap());
            bits = u16::from_le_bytes([body[14], body[15]]);
        } else if id == b"data" {
            let len = len.min(body.len());
            let d = &body[..len];
            let data = match (fmt, bits) {
                (3, 32) => d.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect(),
                (1, 16) => d.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0).collect(),
                _ => panic!("a format these scripts do not read: {fmt}/{bits}"),
            };
            return (sr, ch, data);
        }
        at += 8 + len + (len & 1);
    }
    panic!("no data in {}", path.display());
}

/// One buffer of a capture (capture.rs).
#[derive(Debug, Clone)]
pub struct CapBlock {
    pub segment: usize,
    pub file_frame: usize,
    pub frames: usize,
    pub mixer_frame: u64,
    pub present_ns: u64,
    pub callback_ns: u64,
    pub latency_ns: u64,
    pub dropped: bool,
    pub sr: u32,
    pub channels: usize,
}

pub struct Captured {
    pub blocks: Vec<CapBlock>,
    /// each segment: (rate, channels, samples)
    pub segments: Vec<(u32, usize, Vec<f32>)>,
    /// each command: (ns, the line)
    pub cmds: Vec<(u64, Value)>,
    pub zero_wall_ms: f64,
}

pub fn read_capture(base: &Path) -> Captured {
    let stem = base.file_stem().unwrap().to_str().unwrap().to_string();
    let csv = std::fs::read_to_string(base.with_file_name(format!("{stem}.blocks.csv"))).unwrap();
    let mut zero_wall_ms = 0.0;
    let mut blocks = Vec::new();
    for l in csv.lines() {
        if let Some(z) = l.strip_prefix("# zero_ns_is_wall_ms=") {
            zero_wall_ms = z.parse().unwrap();
            continue;
        }
        if l.starts_with("segment") || l.is_empty() {
            continue;
        }
        let f: Vec<u64> = l.split(',').map(|x| x.parse().unwrap()).collect();
        blocks.push(CapBlock {
            segment: f[0] as usize,
            file_frame: f[1] as usize,
            frames: f[2] as usize,
            mixer_frame: f[3],
            present_ns: f[4],
            callback_ns: f[5],
            latency_ns: f[6],
            dropped: f[7] != 0,
            sr: f[8] as u32,
            channels: f[9] as usize,
        });
    }
    let nseg = blocks.iter().map(|b| b.segment).max().map_or(0, |m| m + 1);
    let segments = (0..nseg)
        .map(|k| {
            let p = if k == 0 { base.to_path_buf() } else { base.with_file_name(format!("{stem}-{k}.wav")) };
            read_wav(&p)
        })
        .collect();
    let cmds = std::fs::read_to_string(base.with_file_name(format!("{stem}.cmds.jsonl")))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .map(|v| (v["ns"].as_u64().unwrap(), serde_json::from_str(v["line"].as_str().unwrap()).unwrap_or(Value::Null)))
        .collect();
    Captured { blocks, segments, cmds, zero_wall_ms }
}

impl Captured {
    /// The block a frame of segment 0's file is in.
    pub fn block_of(&self, seg: usize, frame: usize) -> Option<&CapBlock> {
        // (blocks are in order of segment, then frame: found by halving)
        let i = self.blocks.partition_point(|b| (b.segment, b.file_frame + b.frames) <= (seg, frame));
        self.blocks.get(i).filter(|b| b.segment == seg && frame >= b.file_frame && frame < b.file_frame + b.frames)
    }
    /// The first frame of segment 0 heard after the moment `ns`.
    pub fn frame_after(&self, ns: u64) -> usize {
        let i = self.blocks.partition_point(|b| b.segment == 0 && b.present_ns + (b.frames as f64 / b.sr as f64 * 1e9) as u64 <= ns);
        match self.blocks.get(i).filter(|b| b.segment == 0) {
            Some(b) => {
                let k = ns.saturating_sub(b.present_ns) as f64 / 1e9 * b.sr as f64;
                b.file_frame + (k.ceil() as usize).min(b.frames)
            }
            None => usize::MAX,
        }
    }
    /// The moment (engine ns) a frame of a segment is heard.
    pub fn heard_ns(&self, seg: usize, frame: usize) -> Option<u64> {
        let b = self.block_of(seg, frame)?;
        Some(b.present_ns + ((frame - b.file_frame) as f64 / b.sr as f64 * 1e9) as u64)
    }
    /// The command `op` for `key` and when it was taken.
    pub fn cmd(&self, op: &str, key: &str) -> Option<u64> {
        self.cmds.iter().find(|(_, c)| c["op"] == op && c["key"] == key).map(|(n, _)| *n)
    }
    /// One output of a segment.
    pub fn channel(&self, seg: usize, c: usize) -> Vec<f32> {
        let (_, ch, d) = &self.segments[seg];
        d.chunks_exact(*ch).map(|f| f[c]).collect()
    }
    /// Gaps in the device's clock between consecutive buffers (each: the gap in ns past the buffer's length).
    pub fn gaps(&self) -> Vec<(usize, i64)> {
        let mut out = Vec::new();
        for w in self.blocks.windows(2) {
            if w[0].segment != w[1].segment {
                continue;
            }
            let len = (w[0].frames as f64 / w[0].sr as f64 * 1e9) as i64;
            let d = w[1].present_ns as i64 - w[0].present_ns as i64 - len;
            if d.abs() > len / 2 {
                out.push((w[1].file_frame, d));
            }
        }
        out
    }
}

// ── an input, recorded ──

/// An input recorded in the background (BlackHole's: what its output was given, digitally). Each buffer's first
/// frame is stamped with the input's own host time, on this process's clock is not needed: only the samples are
/// compared here.
pub struct Recorder {
    _stream: cpal::Stream,
    pub data: Arc<Mutex<Vec<f32>>>,
    pub channels: usize,
    pub sr: u32,
}

pub fn record(name: &str) -> Recorder {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    let host = cpal::default_host();
    let dev = host.input_devices().unwrap().find(|d| d.name().map(|n| n == name).unwrap_or(false)).expect("the input");
    let cfg = dev.default_input_config().unwrap();
    assert_eq!(cfg.sample_format(), cpal::SampleFormat::F32);
    let channels = cfg.channels() as usize;
    let sr = cfg.sample_rate().0;
    let data = Arc::new(Mutex::new(Vec::with_capacity(sr as usize * channels * 600)));
    let d2 = data.clone();
    let stream = dev
        .build_input_stream(
            &cfg.config(),
            move |x: &[f32], _: &cpal::InputCallbackInfo| {
                // (a test's recorder: a lock here is harmless, it is not the engine)
                d2.lock().unwrap().extend_from_slice(x);
            },
            |e| eprintln!("the recorder: {e}"),
            None,
        )
        .unwrap();
    stream.play().unwrap();
    Recorder { _stream: stream, data, channels, sr }
}

impl Recorder {
    pub fn take(&self) -> Vec<f32> {
        std::mem::take(&mut *self.data.lock().unwrap())
    }
}

/// Where `needle` (interleaved, `ch` wide) first appears in `hay` exactly, as a frame; None if nowhere.
pub fn find_exact(hay: &[f32], needle: &[f32], ch: usize) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    let nf = needle.len() / ch;
    (0..=(hay.len() / ch - nf)).find(|&i| hay[i * ch..(i + nf) * ch] == *needle)
}

/// mean, p95, max, min and the standard deviation of a list.
pub fn stats(v: &[f64]) -> Value {
    if v.is_empty() {
        return Value::Null;
    }
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.total_cmp(b));
    let n = s.len() as f64;
    let mean = s.iter().sum::<f64>() / n;
    let sd = (s.iter().map(|x| (x - mean) * (x - mean)).sum::<f64>() / n).sqrt();
    let r = |x: f64| (x * 1000.0).round() / 1000.0;
    json!({ "n": s.len(), "mean": r(mean), "p95": r(s[((n * 0.95) as usize).min(s.len() - 1)]), "max": r(s[s.len() - 1]), "min": r(s[0]), "sd": r(sd) })
}

pub fn sleep(secs: f64) {
    std::thread::sleep(Duration::from_secs_f64(secs));
}
