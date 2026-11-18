//! `qa parity`: one scene through both engines, each recorded off BlackHole's input by `ec-audio listen`, and the
//! two recordings read the same way. Web Audio's half is run by Electron (test/native-qa/webaudio.ts `scene`), from
//! the scene this writes:
//!
//!   qa parity --write            the files and DIR/scene.json (DIR: $EC_QA_DIR/parity)
//!   npx electron test/native-qa/webaudio.js scene --scene DIR/scene.json      → DIR/web.wav
//!   qa parity                    the native engine plays it → DIR/native.wav; both are read and compared
//!
//! Each recording is lined up on its first sound (a click at 0 ms); every other part is found near its moment.

use crate::common::*;
use ec_audio::arith::{along, pan_gains, to_db, value_at};
use serde_json::{json, Value};
use std::path::Path;

const SR: f64 = 48000.0;
const LEVEL: f64 = 0.25;

fn shape() -> Vec<f64> {
    (0..65).map(|k| (1.0 - (std::f64::consts::PI * k as f64 / 64.0).cos()) / 2.0).collect()
}
fn pan_line() -> Value {
    json!([[0, -100], [1.0, 100, 0.5], [2.0, 0]])
}

/// The scene: (ms, command), commands as the host sends the native engine (a file by its path).
fn steps(dir: &Path) -> (Vec<String>, Vec<(u64, Value)>) {
    let f = |n: &str| dir.join(n).to_str().unwrap().to_string();
    let (click, dc, ramp_f) = (f("click.wav"), f("dc.wav"), f("ramp.wav"));
    let play = |key: &str, file: &str, extra: Value| {
        let mut c = json!({ "op": "play", "key": key, "file": file, "exact": true, "bus": "effects" });
        if let (Some(o), Some(e)) = (c.as_object_mut(), extra.as_object()) {
            for (k, v) in e {
                o.insert(k.clone(), v.clone());
            }
        }
        c
    };
    let s = vec![
        (0, play("sync", &click, json!({}))),
        (500, play("dc", &dc, json!({ "gainDb": -6 }))),
        (1500, json!({ "op": "fade", "key": "dc", "db": -30, "secs": 1.0, "shape": shape() })),
        (3000, json!({ "op": "stop", "key": "dc" })),
        (3500, play("pan", &dc, json!({ "pan": -50 }))),
        (4000, json!({ "op": "stop", "key": "pan" })),
        (4200, json!({ "op": "bus", "name": "effects", "db": -10 })),
        (4300, play("bus", &dc, json!({}))),
        (4800, json!({ "op": "stop", "key": "bus" })),
        (4900, json!({ "op": "bus", "name": "effects", "db": 0 })),
        (5000, json!({ "op": "masterDb", "db": -6, "secs": 0 })),
        (5100, play("master", &dc, json!({}))),
        (5600, json!({ "op": "stop", "key": "master" })),
        (5700, json!({ "op": "masterDb", "db": 0, "secs": 0 })),
        (6000, play("loop", &ramp_f, json!({ "from": 0.2 }))),
        (6001, json!({ "op": "region", "key": "loop", "start": 0.25, "end": 0.5 })),
        (9000, json!({ "op": "stop", "key": "loop" })),
        (9500, play("line", &dc, json!({ "automation": { "pan": pan_line() } }))),
        (11700, json!({ "op": "stop", "key": "line" })),
    ];
    (vec![click, dc, ramp_f], s)
}

fn write(dir: &Path) {
    let click: Vec<f32> = (0..96)
        .flat_map(|i| {
            let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / 96.0).cos();
            let x = if i == 0 { 0.05 } else { (0.1 * w * (std::f64::consts::TAU * 2000.0 * i as f64 / SR).sin()) as f32 };
            [x, x]
        })
        .collect();
    wav_f32(&dir.join("click.wav"), 48000, 2, &click);
    wav_f32(&dir.join("dc.wav"), 48000, 1, &vec![LEVEL as f32; 48000 * 3]);
    wav_f32(&dir.join("ramp.wav"), 48000, 2, &ramp(48000 * 3, 2));
    let (files, s) = steps(dir);
    let sc = json!({ "files": files, "steps": s.iter().map(|(ms, c)| json!({ "ms": ms, "cmd": c })).collect::<Vec<_>>() });
    std::fs::write(dir.join("scene.json"), serde_json::to_string_pretty(&sc).unwrap()).unwrap();
}

/// The native engine plays the scene while BlackHole's input is recorded to DIR/native.wav.
fn play_native(dir: &Path, device: &str) {
    let (files, s) = steps(dir);
    let mut e = Engine::start(&["--device", device]);
    e.must(5.0, "ready", |v| v["type"] == "ready");
    for f in &files {
        e.decode(Path::new(f));
    }
    let rec = dir.join("native.wav");
    let mut ear = std::process::Command::new(binary())
        .args(["listen", "--input", device, "--db", "-20", "--record", rec.to_str().unwrap()])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    sleep(1.0);
    let t0 = std::time::Instant::now();
    for (ms, c) in s {
        let at = std::time::Duration::from_millis(ms);
        if let Some(w) = at.checked_sub(t0.elapsed()) {
            std::thread::sleep(w);
        }
        e.send(c);
    }
    sleep(0.8);
    drop(ear.stdin.take());
    let _ = ear.wait();
    e.close();
}

/// A recording read: each part's moment and levels.
fn read(path: &Path) -> Value {
    let (sr, ch, d) = read_wav(path);
    assert_eq!(ch, 2);
    let l: Vec<f64> = d.chunks_exact(2).map(|f| f[0] as f64).collect();
    let r: Vec<f64> = d.chunks_exact(2).map(|f| f[1] as f64).collect();
    let sr = sr as f64;
    // (a sound is "there" above −80 dB: Web Audio's context may run at another rate than the device, and its
    // resampler rings a little before and after each sound)
    let on = |x: f64| x.abs() > 1e-4;
    let Some(s0) = l.iter().position(|x| on(*x)) else { return json!({ "error": "silent" }) };
    let fr = |ms: f64| s0 + (ms / 1000.0 * sr) as usize;
    // the first sound at or after (nominal − 60 ms)
    let onset = |ms: f64| (fr(ms - 60.0)..l.len()).find(|&i| on(l[i]) || on(r[i])).unwrap_or(0);
    let ms_of = |i: usize| (i as f64 - s0 as f64) / sr * 1000.0;
    let lv = |i: usize| (l[i], r[i]);
    let mut out = json!({ "rate": sr, "frames": l.len() });

    let dc = onset(500.0);
    let (a, b) = lv(dc + 9600);
    out["level"] = json!({ "onset_ms": ms_of(dc), "l": a, "r": b, "db": to_db(a / LEVEL), "want_db": -6.0 });
    let steady = a;
    // the fade: from where the level first moves, its level at tenths of its time
    let f0 = (fr(1440.0)..l.len()).find(|&i| (l[i] - steady).abs() > steady * 1e-4).unwrap_or(0);
    let sh = shape();
    let pts: Vec<Value> = (1..=10)
        .map(|k| {
            let x = k as f64 / 10.0;
            let i = f0 + (x * sr) as usize - 1;
            let got = to_db(l[i] / steady);
            // (from the level it is at, −6 dB, to −30: 24 dB of travel)
            let want = -24.0 * along(&sh, x);
            json!({ "x": x, "db": (got * 1000.0).round() / 1000.0, "want": (want * 1000.0).round() / 1000.0 })
        })
        .collect();
    let worst = pts.iter().map(|p| (p["db"].as_f64().unwrap() - p["want"].as_f64().unwrap()).abs()).fold(0.0, f64::max);
    out["fade"] = json!({ "onset_ms": ms_of(f0), "points": pts, "worst_db": worst });
    // the stop: how long from the level moving to silence
    let faded = l[fr(2900.0)];
    let s_start = (fr(2950.0)..l.len()).find(|&i| l[i] < faded * 0.999).unwrap_or(0);
    let s_end = (s_start..l.len()).find(|&i| !on(l[i])).unwrap_or(0);
    out["stop"] = json!({ "onset_ms": ms_of(s_start), "frames_to_silence": s_end - s_start, "from_db": to_db(faded / LEVEL) });
    let p = onset(3500.0);
    let (a, b) = lv(p + 9600);
    let (pl, pr) = pan_gains(-50.0);
    out["pan"] = json!({ "onset_ms": ms_of(p), "l": a / LEVEL, "r": b / LEVEL, "want_l": pl, "want_r": pr });
    let bs = onset(4300.0);
    out["bus"] = json!({ "onset_ms": ms_of(bs), "db": to_db(l[bs + 9600] / LEVEL), "want_db": -10.0 });
    let m = onset(5100.0);
    out["master"] = json!({ "onset_ms": ms_of(m), "db": to_db(l[m + 9600] / LEVEL), "want_db": -6.0 });
    // the loop: the sound a quarter of a second on is the same sound, to the sample
    let lp = onset(6000.0);
    let (mut worst, mut same) = (0f64, 0usize);
    let n = (2.5 * sr) as usize;
    let period = 12000;
    for i in lp + 4800..lp + 4800 + n {
        let d = (l[i] - l[i + period]).abs();
        worst = worst.max(d);
        if d == 0.0 {
            same += 1;
        }
    }
    let idx0 = index_of(l[lp] as f32);
    out["loop"] = json!({ "onset_ms": ms_of(lp), "first_index": idx0, "want_first": 9600, "worst_difference_a_loop_apart": worst, "frames_identical_a_loop_apart": same, "frames": n,
        "gain_on_the_ramp": l[lp] / index_value(9600) as f64 });
    let pl0 = onset(9500.0);
    let line: Vec<[f64; 3]> = pan_line()
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            let a = p.as_array().unwrap();
            [a[0].as_f64().unwrap(), a[1].as_f64().unwrap(), a.get(2).and_then(Value::as_f64).unwrap_or(0.0)]
        })
        .collect();
    let mut worst = 0f64;
    for k in 0..(2.0 * sr) as usize {
        let (wl, wr) = pan_gains(value_at(&line, k as f64 / sr).unwrap());
        worst = worst.max((l[pl0 + k] / LEVEL - wl).abs()).max((r[pl0 + k] / LEVEL - wr).abs());
    }
    out["pan_line"] = json!({ "onset_ms": ms_of(pl0), "worst_gain_error": worst });
    out
}

pub fn run(args: &[String]) -> Value {
    let device = crate::arg(args, "--device").unwrap_or(BLACKHOLE).to_string();
    let dir = scratch("parity");
    if args.iter().any(|a| a == "--write") {
        write(&dir);
        return json!({ "scene": dir.join("scene.json") });
    }
    if !args.iter().any(|a| a == "--read-only") {
        the_show_is_not_running();
        if !dir.join("scene.json").exists() {
            write(&dir);
        }
        play_native(&dir, &device);
    }
    let native = read(&dir.join("native.wav"));
    let web = if dir.join("web.wav").exists() { read(&dir.join("web.wav")) } else { Value::Null };
    json!({ "native": native, "webaudio": web })
}
