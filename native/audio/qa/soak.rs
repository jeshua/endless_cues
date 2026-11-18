//! `qa soak`: many sounds for a long time. 32 at once (streamed and decoded, long files at three rates), a GO,
//! stop, fade, seek, loop or move every few tens of milliseconds, for `--minutes` (20). Every five seconds: the
//! program's CPU and memory (`ps`), its buffers missed (`xruns`), streams run dry (`starved`), its busiest buffer
//! (`load`), and how long a `where` takes to come back (the events' backlog). At the end, 100 plays in one write.

use crate::common::*;
use serde_json::{json, Value};
use std::io::Write;
use std::time::{Duration, Instant};

/// A 16-bit WAV of a quiet tone, written a piece at a time (the files are long).
fn tone_file(path: &std::path::Path, secs: f64, sr: u32, ch: u16, hz: f64) {
    if path.exists() {
        return;
    }
    let n = (secs * sr as f64) as u64;
    let data = n * ch as u64 * 2;
    let mut f = std::io::BufWriter::new(std::fs::File::create(path).unwrap());
    let mut h = Vec::new();
    h.extend_from_slice(b"RIFF");
    h.extend_from_slice(&((36 + data) as u32).to_le_bytes());
    h.extend_from_slice(b"WAVEfmt ");
    h.extend_from_slice(&16u32.to_le_bytes());
    h.extend_from_slice(&1u16.to_le_bytes());
    h.extend_from_slice(&ch.to_le_bytes());
    h.extend_from_slice(&sr.to_le_bytes());
    h.extend_from_slice(&(sr * ch as u32 * 2).to_le_bytes());
    h.extend_from_slice(&(ch * 2).to_le_bytes());
    h.extend_from_slice(&16u16.to_le_bytes());
    h.extend_from_slice(b"data");
    h.extend_from_slice(&(data as u32).to_le_bytes());
    f.write_all(&h).unwrap();
    let a = 10f64.powf(-30.0 / 20.0) * 32767.0;
    for i in 0..n {
        let x = (a * (std::f64::consts::TAU * hz * i as f64 / sr as f64).sin()) as i16;
        for _ in 0..ch {
            f.write_all(&x.to_le_bytes()).unwrap();
        }
    }
}

/// The engine's CPU (%) and memory (RSS, MB), from `ps`.
fn ps(pid: u32) -> (f64, f64) {
    let o = std::process::Command::new("ps").args(["-o", "%cpu=,rss=", "-p", &pid.to_string()]).output().unwrap();
    let s = String::from_utf8_lossy(&o.stdout);
    let v: Vec<f64> = s.split_whitespace().filter_map(|x| x.parse().ok()).collect();
    (v.first().copied().unwrap_or(-1.0), v.get(1).copied().unwrap_or(0.0) / 1024.0)
}

struct Rng(u32);
impl Rng {
    fn next(&mut self) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0
    }
    fn below(&mut self, n: u32) -> u32 {
        self.next() % n.max(1)
    }
    fn f(&mut self) -> f64 {
        self.next() as f64 / u32::MAX as f64
    }
}

pub fn run(args: &[String]) -> Value {
    let num = |name: &str, d: f64| crate::arg(args, name).and_then(|s| s.parse().ok()).unwrap_or(d);
    let minutes = num("--minutes", 20.0);
    let want_voices = num("--voices", 32.0) as usize;
    let device = crate::arg(args, "--device").unwrap_or(BLACKHOLE).to_string();
    the_show_is_not_running();
    let dir = scratch("soak");
    eprintln!("writing the files…");
    let streamed = [dir.join("long-44k.wav"), dir.join("long-48k.wav"), dir.join("long-96k-mono.wav")];
    tone_file(&streamed[0], 600.0, 44100, 2, 220.0);
    tone_file(&streamed[1], 600.0, 48000, 2, 330.0);
    tone_file(&streamed[2], 600.0, 96000, 1, 440.0);
    let decoded: Vec<_> = (0..4).map(|k| dir.join(format!("short-{k}.wav"))).collect();
    for (k, p) in decoded.iter().enumerate() {
        tone_file(p, 30.0, [44100, 48000, 48000, 96000][k], 2, 500.0 + 100.0 * k as f64);
    }
    let s = |p: &std::path::Path| p.to_str().unwrap().to_string();

    let mut e = Engine::start(&["--device", &device]);
    e.must(5.0, "ready", |v| v["type"] == "ready");
    for p in &decoded {
        e.decode(p);
    }
    e.send(json!({ "op": "buses", "list": [{ "id": "music", "db": -6 }, { "id": "effects", "db": 0 }] }));
    let pid = e.pid();
    let mut rng = Rng(0x1234_5678);
    let mut playing: Vec<(String, bool)> = Vec::new();
    let mut next_key = 0usize;
    let mut samples = Vec::new();
    let mut gos = 0usize;
    let mut actions = 0usize;
    let mut errors = Vec::new();
    let started = Instant::now();
    let until = started + Duration::from_secs_f64(minutes * 60.0);
    let mut next_sample = Instant::now();
    let (mut xruns, mut starved, mut load_max) = (0u64, 0u64, 0f64);
    let mut voices_seen = 0u64;
    while Instant::now() < until {
        // keep `want_voices` playing; else a change to one of them
        let r = rng.below(100);
        if playing.len() < want_voices || r < 10 {
            let stream = rng.below(2) == 0;
            let file = if stream { s(&streamed[rng.below(3) as usize]) } else { s(&decoded[rng.below(4) as usize]) };
            let key = format!("v{next_key}");
            next_key += 1;
            let from = if rng.below(2) == 0 { rng.f() * 20.0 } else { 0.0 };
            e.send(
                json!({ "op": "play", "key": key, "file": file, "from": from, "loop": rng.below(3) == 0, "gainDb": -12.0 - rng.f() * 12.0,
                "bus": if rng.below(2) == 0 { "music" } else { "effects" }, "pan": rng.f() * 200.0 - 100.0, "exact": !stream }),
            );
            playing.push((key, stream));
            gos += 1;
        } else if !playing.is_empty() {
            let i = rng.below(playing.len() as u32) as usize;
            let key = playing[i].0.clone();
            match rng.below(10) {
                0 | 1 => {
                    e.send(json!({ "op": "stop", "key": key }));
                    playing.swap_remove(i);
                }
                2 => e.send(json!({ "op": "fade", "key": key, "db": -60.0 * rng.f(), "secs": rng.f() * 3.0 })),
                3 => e.send(json!({ "op": "seek", "key": key, "t": rng.f() * 25.0 })),
                4 => {
                    let a = rng.f() * 20.0;
                    e.send(json!({ "op": "region", "key": key, "start": a, "end": a + 0.2 + rng.f() * 2.0 }))
                }
                5 => e.send(json!({ "op": "rate", "key": key, "rate": 0.8 + rng.f() * 0.4, "secs": rng.f() })),
                6 => {
                    e.send(json!({ "op": "move", "key": key, "to": rng.f() * 20.0, "sync": { "lead": 0.1, "xf": 0.05, "blend": "fade" } }))
                }
                7 => e.send(json!({ "op": "masterDb", "db": -rng.f() * 6.0, "secs": 0.2 })),
                8 => e.send(json!({ "op": "pause", "key": key })),
                _ => e.send(json!({ "op": "resume", "key": key })),
            }
        }
        actions += 1;
        for v in e.drain() {
            match v["type"].as_str() {
                Some("ended") => playing.retain(|(k, _)| v["key"] != k.as_str()),
                Some("error") => {
                    if errors.len() < 10 {
                        errors.push(v.clone());
                    }
                    playing.retain(|(k, _)| v["key"] != k.as_str());
                }
                Some("level") => {
                    xruns = v["xruns"].as_u64().unwrap_or(0);
                    starved = v["starved"].as_u64().unwrap_or(0);
                    load_max = load_max.max(v["load"].as_f64().unwrap_or(0.0));
                    voices_seen = voices_seen.max(v["voices"].as_u64().unwrap_or(0));
                }
                _ => {}
            }
        }
        if Instant::now() >= next_sample {
            next_sample += Duration::from_secs(5);
            let (cpu, rss) = ps(pid);
            let t0 = Instant::now();
            e.send(json!({ "op": "where", "keys": [] }));
            e.send(json!({ "op": "devices" }));
            let back = e.wait(5.0, |v| v["type"] == "devices").map(|_| t0.elapsed().as_secs_f64() * 1000.0);
            samples.push(json!({ "t": started.elapsed().as_secs(), "cpu": cpu, "rss_mb": rss, "xruns": xruns, "starved": starved,
                "voices": playing.len(), "round_trip_ms": back }));
            if samples.len() % 12 == 0 {
                eprintln!("{}", samples.last().unwrap());
            }
        }
        sleep(0.02 + rng.f() * 0.1);
    }
    // the burst: 100 plays in one write
    e.send(json!({ "op": "stopAll" }));
    sleep(1.0);
    let x0 = xruns;
    let mut burst = String::new();
    for k in 0..100 {
        let file = if k % 2 == 0 { s(&decoded[k % 4]) } else { s(&streamed[k % 3]) };
        burst.push_str(&json!({ "op": "play", "key": format!("b{k}"), "file": file, "gainDb": -40 }).to_string());
        burst.push('\n');
    }
    let t0 = Instant::now();
    e.send_raw(&burst).unwrap();
    let all = e.wait(10.0, |v| v["type"] == "level" && v["voices"].as_u64().unwrap_or(0) >= 100);
    let burst_ms = t0.elapsed().as_secs_f64() * 1000.0;
    sleep(3.0);
    let lv = e.wait(2.0, |v| v["type"] == "level");
    let (cpu_b, rss_b) = ps(pid);
    e.send(json!({ "op": "stopAll" }));
    sleep(1.0);
    let (_, rss_after) = ps(pid);
    let clean = e.close();
    let rss: Vec<f64> = samples.iter().filter_map(|s| s["rss_mb"].as_f64()).collect();
    let cpu: Vec<f64> = samples.iter().filter_map(|s| s["cpu"].as_f64()).collect();
    let rt: Vec<f64> = samples.iter().filter_map(|s| s["round_trip_ms"].as_f64()).collect();
    let tenth = rss.len() / 10;
    json!({
        "device": device, "minutes": minutes, "voices_wanted": want_voices, "most_voices_at_once": voices_seen, "gos": gos, "actions": actions,
        "xruns": xruns, "starved_frames": starved, "load_max": load_max, "errors": errors,
        "cpu_percent": stats(&cpu), "rss_mb": stats(&rss),
        "rss_first_tenth_mean": rss[..tenth.max(1)].iter().sum::<f64>() / tenth.max(1) as f64,
        "rss_last_tenth_mean": rss[rss.len() - tenth.max(1)..].iter().sum::<f64>() / tenth.max(1) as f64,
        "devices_round_trip_ms": stats(&rt),
        "burst": { "all_100_playing": all.is_some(), "ms_until_level_said_100": burst_ms, "xruns_during": lv.as_ref().and_then(|l| l["xruns"].as_u64()).map(|x| x - x0),
            "cpu_after": cpu_b, "rss_mb_after": rss_b, "rss_mb_after_stop_all": rss_after },
        "exited_cleanly": clean,
        "samples": samples,
    })
}
