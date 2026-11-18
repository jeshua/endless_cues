//! `ec-audio measure`: how long from a GO to the sound, and how steady that is.
//!
//! A short quiet click (2 ms of 2 kHz, −40 dB unless `--db` says) is decoded ahead and played N times (`--clicks`,
//! 200) through the same path a cue takes: a `play` line handed to the control thread, the queue, the mixer, the
//! device. For each, the time from the line being taken to the moment the click's first sample reaches the output
//! (the device's callback, plus the delay the device reports from that callback to its output) is the GO-to-output
//! latency. With `--loopback <input>` (a cable from outputs 1–2 back to that input) the input is recorded too and
//! each click found in it: the round trip, as heard.
//!
//! Prints one JSON object: milliseconds, as mean, p50, p95, max, min and jitter (the standard deviation).

use crate::control::{Control, In};
use crate::device::{engine, CpalOut};
use crate::pcm::Pcm;
use crate::shared::{now_ns, Meters};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use crossbeam_channel::unbounded;
use rtrb::RingBuffer;
use serde_json::{json, Value};
use std::sync::atomic::Ordering::Relaxed;
use std::sync::Arc;
use std::time::{Duration, Instant};

fn arg<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(String::as_str)
}

/// mean, p50, p95, max, min and jitter of a list of milliseconds.
pub fn stats(v: &[f64]) -> Value {
    if v.is_empty() {
        return Value::Null;
    }
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.total_cmp(b));
    let n = s.len() as f64;
    let mean = s.iter().sum::<f64>() / n;
    let sd = (s.iter().map(|x| (x - mean) * (x - mean)).sum::<f64>() / n).sqrt();
    let at = |q: f64| s[((n * q) as usize).min(s.len() - 1)];
    let r = |x: f64| (x * 1000.0).round() / 1000.0;
    json!({ "n": s.len(), "mean": r(mean), "p50": r(at(0.5)), "p95": r(at(0.95)), "max": r(s[s.len() - 1]), "min": r(s[0]), "jitter": r(sd) })
}

/// The click: 2 ms of 2 kHz under a Hann window, at `db`, in stereo.
pub fn click(sr: f64, db: f64) -> Pcm {
    let n = (0.002 * sr) as usize;
    let a = 10f64.powf(db / 20.0);
    let mut data = Vec::with_capacity(n * 2);
    for i in 0..n {
        let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / n as f64).cos();
        let x = (a * w * (std::f64::consts::TAU * 2000.0 * i as f64 / sr).sin()) as f32;
        data.push(x);
        data.push(x);
    }
    // (its first sample is not quite silent, so a loopback finds its start, not its middle)
    data[0] = (a * 0.5) as f32;
    data[1] = data[0];
    Pcm::new(sr as u32, 2, data)
}

/// An input listened to for clicks: each one's moment (ns since `shared::epoch()`), as the device stamped it.
fn listen(name: &str, threshold: f32, mut record: Option<crate::capture::Capture>) -> Result<(cpal::Stream, rtrb::Consumer<u64>), String> {
    let host = cpal::default_host();
    let dev = host
        .input_devices()
        .map_err(|e| e.to_string())?
        .find(|d| d.name().map(|n| n == name).unwrap_or(false))
        .ok_or_else(|| format!("there is no input named {name}"))?;
    let cfg = dev.default_input_config().map_err(|e| e.to_string())?;
    if cfg.sample_format() != cpal::SampleFormat::F32 {
        return Err(format!("the input's samples are {:?}; only f32 is read here", cfg.sample_format()));
    }
    let ch = cfg.channels() as usize;
    let sr = cfg.sample_rate().0 as f64;
    // (macOS: the time from a sound reaching the input to its buffer's stamp, which cpal leaves out)
    #[cfg(target_os = "macos")]
    let in_lat_ns = crate::mac::extra_in(name).map(|x| (crate::mac::heard_frames(&x) as f64 / sr * 1e9) as u64).unwrap_or(0);
    #[cfg(not(target_os = "macos"))]
    let in_lat_ns = 0u64;
    let (mut tx, rx) = RingBuffer::<u64>::new(1024);
    let mut finder = Finder::new(threshold);
    let mut frames = 0u64;
    let stream = dev
        .build_input_stream(
            &cfg.config(),
            move |data: &[f32], info: &cpal::InputCallbackInfo| {
                let ts = info.timestamp();
                // the moment the buffer's first frame was taken in, on this program's clock: from the input's own
                // host time where it can be read (independent of the output's estimate), else cpal's guess
                let t0 = first_frame_ns(&ts).saturating_sub(in_lat_ns);
                finder.feed(data, ch, t0, sr, |t| {
                    let _ = tx.push(t);
                });
                if let Some(r) = &mut record {
                    r.put(data, ch, sr, frames, t0, in_lat_ns);
                    frames += (data.len() / ch) as u64;
                }
            },
            |e| eprintln!("[native] the loopback input: {e}"),
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok((stream, rx))
}

/// Finds clicks in an input: the first sample over the threshold, once a click. One 2 ms click is many samples
/// over it; the GOs are 60 ms or more apart, so anything 20 ms after the last is the next. (It was 100 ms, which
/// lost each click that came sooner than that after the one before: 9 of 50 in a first run.)
pub struct Finder {
    threshold: f32,
    last: Option<u64>,
}
impl Finder {
    pub const APART_NS: u64 = 20_000_000;
    pub fn new(threshold: f32) -> Self {
        Finder { threshold, last: None }
    }
    /// One buffer, `ch` wide, its first frame at `t0` ns: `found` is told each click's moment.
    pub fn feed(&mut self, data: &[f32], ch: usize, t0: u64, sr: f64, mut found: impl FnMut(u64)) {
        for (i, f) in data.chunks_exact(ch.max(1)).enumerate() {
            if f.iter().any(|x| x.abs() > self.threshold) {
                let t = t0 + (i as f64 / sr * 1e9) as u64;
                if self.last.is_none_or(|l| t > l + Self::APART_NS) {
                    self.last = Some(t);
                    found(t);
                }
            }
        }
    }
}

/// When an input buffer's first frame arrived, on this program's clock (ns since `shared::epoch()`).
fn first_frame_ns(ts: &cpal::InputStreamTimestamp) -> u64 {
    #[cfg(target_os = "macos")]
    if let Some(h) = crate::mac::instant_ns(&ts.callback) {
        // (CoreAudio stamps an input buffer with the host time of its first frame)
        let ago = crate::mac::host_now_ns() as i64 - h as i64;
        return (now_ns() as i64 - ago).max(0) as u64;
    }
    let back = ts.callback.duration_since(&ts.capture).unwrap_or_default().as_nanos() as u64;
    now_ns().saturating_sub(back)
}

pub fn run(args: &[String]) -> i32 {
    let clicks: usize = arg(args, "--clicks").and_then(|s| s.parse().ok()).unwrap_or(200).max(1);
    let db: f64 = arg(args, "--db").and_then(|s| s.parse().ok()).unwrap_or(-40.0f64).min(-6.0);
    let buffer: u32 = arg(args, "--buffer").and_then(|s| s.parse().ok()).unwrap_or(256);
    let meters = Arc::new(Meters::default());
    let (in_tx, _in_rx) = unbounded::<In>();
    let (ev_tx, ev_rx) = unbounded::<String>();
    let (mixer, ends) = engine(48000.0, 2, meters.clone());
    let out = CpalOut::new(mixer, meters.clone(), in_tx.clone(), buffer);
    let mut control = Control::new(48000.0, 2, ends, ev_tx, in_tx, Box::new(out));
    control.inline = true;
    if let Err(e) = control.open(arg(args, "--device")) {
        eprintln!("[native] no audio device could be opened: {e}");
        return 2;
    }
    control.insert("<click>", click(control.sr, db));
    let mut loopback = match arg(args, "--loopback") {
        Some(name) => match listen(name, (10f64.powf(db / 20.0) * 0.2) as f32, None) {
            Ok(l) => Some(l),
            Err(e) => {
                eprintln!("[native] {e}");
                return 2;
            }
        },
        None => None,
    };
    std::thread::sleep(Duration::from_millis(400));
    if let Some((_, rx)) = &mut loopback {
        while rx.pop().is_ok() {}
    }
    let mut go = Vec::new();
    let mut wait = Vec::new();
    let mut device = Vec::new();
    let mut round = Vec::new();
    let mut agree = Vec::new();
    let mut seed = 0x9e37_79b9u32;
    for i in 0..clicks {
        // a pause of 60–160 ms, so the GOs fall anywhere in the device's buffer
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        std::thread::sleep(Duration::from_millis(60 + (seed % 100) as u64));
        let key = format!("click{i}");
        let line = json!({ "op": "play", "key": key, "file": "<click>", "bus": "effects" }).to_string();
        let t0 = now_ns();
        control.line(&line);
        let until = Instant::now() + Duration::from_secs(1);
        let started = loop {
            if let Some(ns) = control.started_ns(&key) {
                break Some(ns);
            }
            if Instant::now() > until {
                break None;
            }
            std::thread::sleep(Duration::from_micros(200));
        };
        let Some(started) = started else {
            eprintln!("[native] click {i} was never heard");
            continue;
        };
        let lat = meters.latency_ns.load(Relaxed) as f64 / 1e6;
        let g = (started as f64 - t0 as f64) / 1e6;
        go.push(g);
        device.push(lat);
        wait.push(g - lat);
        if let Some((_, rx)) = &mut loopback {
            let until = Instant::now() + Duration::from_millis(500);
            while Instant::now() < until {
                if let Ok(t) = rx.pop() {
                    if t > t0 {
                        round.push((t - t0) as f64 / 1e6);
                        agree.push((t as f64 - started as f64) / 1e6);
                        break;
                    }
                }
                std::thread::sleep(Duration::from_millis(1));
            }
        }
        control.poll();
        while ev_rx.try_recv().is_ok() {}
    }
    let report = json!({
        "clicks": clicks, "heard": go.len(), "db": db, "rate": control.sr, "outputs": control.channels, "buffer": buffer,
        "go_to_output_ms": stats(&go),
        "until_the_next_buffer_ms": stats(&wait),
        "device_latency_ms": stats(&device),
        "loopback_ms": if loopback.is_some() { stats(&round) } else { Value::Null },
        "loopback_found": round.len(),
        // (where each click was found in the input, less where the program said it would leave: the device's own
        // round trip, or the error in the program's estimate)
        "loopback_minus_estimate_ms": if loopback.is_some() { stats(&agree) } else { Value::Null },
        "xruns": meters.xruns.load(Relaxed),
        "device_buffer_frames": meters.buffer_frames.load(Relaxed),
    });
    println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
    0
}

/// `ec-audio listen --input NAME [--db DB] [--record FILE.wav]`: an input listened to for clicks (each said as
/// `{"click": <wall-clock ms>}` on a line of its own, the moment its first sample reached the input), and recorded
/// if asked (as `--capture` records an output: FILE.wav, FILE.blocks.csv). Until its standard input closes. For
/// measuring another program's sound through a loopback (the audio window's, in test/native-qa/webaudio.ts).
pub fn listen_run(args: &[String]) -> i32 {
    let Some(name) = arg(args, "--input") else {
        eprintln!("[native] listen: --input NAME");
        return 2;
    };
    let db: f64 = arg(args, "--db").and_then(|s| s.parse().ok()).unwrap_or(-40.0f64);
    let mut handle = None;
    let record = match arg(args, "--record") {
        Some(p) => match crate::capture::start(std::path::Path::new(p)) {
            Ok((c, h)) => {
                handle = Some(h);
                Some(c)
            }
            Err(e) => {
                eprintln!("[native] listen: {e}");
                return 2;
            }
        },
        None => None,
    };
    let (_stream, mut rx) = match listen(name, (10f64.powf(db / 20.0) * 0.2) as f32, record) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[native] {e}");
            return 2;
        }
    };
    println!("{}", json!({ "listening": name }));
    let (done_tx, done) = crossbeam_channel::bounded::<()>(1);
    std::thread::spawn(move || {
        let mut s = String::new();
        while std::io::stdin().read_line(&mut s).map(|n| n > 0).unwrap_or(false) {
            s.clear();
        }
        let _ = done_tx.send(());
    });
    loop {
        while let Ok(t) = rx.pop() {
            println!("{}", json!({ "click": crate::control::wall_of(t) }));
        }
        if done.recv_timeout(Duration::from_millis(5)).is_ok() {
            break;
        }
    }
    drop(_stream);
    if let Some(h) = &mut handle {
        h.finish();
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clicks_close_together_are_each_found_once() {
        let sr = 48000.0;
        let c = click(sr, -20.0);
        let mut input = vec![0f32; 48000 * 2];
        // clicks 61 ms apart (the least pause between GOs is 60 ms)
        let starts = [1000usize, 1000 + 2928, 1000 + 2 * 2928, 30000];
        for s in starts {
            input[s * 2..s * 2 + c.data.len()].copy_from_slice(&c.data);
        }
        let mut f = Finder::new((10f64.powf(-20.0 / 20.0) * 0.2) as f32);
        let mut got = Vec::new();
        // (in buffers of 256, as a device gives them)
        for (k, buf) in input.chunks(512).enumerate() {
            let t0 = (k as f64 * 256.0 / sr * 1e9) as u64;
            f.feed(buf, 2, t0, sr, |t| got.push(t));
        }
        let want: Vec<u64> = starts.iter().map(|s| (*s as f64 / sr * 1e9) as u64).collect();
        assert_eq!(got.len(), 4, "{got:?}");
        for (g, w) in got.iter().zip(want) {
            assert!(g.abs_diff(w) < 30_000, "{g} vs {w}");
        }
    }
}
