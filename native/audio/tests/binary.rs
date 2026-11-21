//! The program itself, as the host runs it: `ec-audio --silent`, commands on its standard input, events read from
//! its standard output.

mod common;
use common::*;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

struct Program {
    child: Child,
    stdin: Option<ChildStdin>,
    events: Receiver<Value>,
    seen: Vec<Value>,
}

impl Program {
    fn start() -> Self {
        Self::with(&[])
    }
    fn with(more: &[&str]) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_ec-audio"))
            .arg("--silent")
            .args(more)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("the program");
        let stdin = child.stdin.take().unwrap();
        let out = BufReader::new(child.stdout.take().unwrap());
        let (tx, events) = channel();
        std::thread::spawn(move || {
            for line in out.lines().map_while(Result::ok) {
                let v: Value = serde_json::from_str(&line).expect("every line is one JSON object");
                if tx.send(v).is_err() {
                    return;
                }
            }
        });
        Program { child, stdin: Some(stdin), events, seen: Vec::new() }
    }
    fn send(&mut self, v: Value) {
        let i = self.stdin.as_mut().unwrap();
        writeln!(i, "{v}").unwrap();
        i.flush().unwrap();
    }
    fn raw(&mut self, s: &str) {
        let i = self.stdin.as_mut().unwrap();
        i.write_all(s.as_bytes()).unwrap();
        i.flush().unwrap();
    }
    /// The first event (from now on) that `pick` takes, within `secs`.
    fn wait(&mut self, secs: f64, pick: impl Fn(&Value) -> bool) -> Value {
        let until = Instant::now() + Duration::from_secs_f64(secs);
        while let Some(left) = until.checked_duration_since(Instant::now()) {
            if let Ok(v) = self.events.recv_timeout(left) {
                self.seen.push(v.clone());
                if pick(&v) {
                    return v;
                }
            }
        }
        panic!("nothing came in {secs} s; seen: {:?}", self.seen.iter().map(|e| e["type"].clone()).collect::<Vec<_>>());
    }
}

impl Drop for Program {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

#[test]
fn the_program_with_no_device() {
    let tone = wav("tone.wav", 1.0, 44100, 2, 0.25);
    let file = tone.to_str().unwrap().to_string();
    let mut p = Program::start();
    let outs = p.wait(2.0, |e| e["type"] == "outputs");
    assert_eq!(outs["channels"], 2);
    p.wait(2.0, |e| e["type"] == "ready");

    p.send(json!({ "op": "devices" }));
    let d = p.wait(2.0, |e| e["type"] == "devices");
    assert_eq!(d["current"], json!({ "type": "none" }));

    p.send(json!({ "op": "probe", "files": [{ "file": file, "url": "" }, { "file": "/no/such/file.wav" }] }));
    let dur = p.wait(2.0, |e| e["type"] == "duration");
    assert!((dur["secs"].as_f64().unwrap() - 1.0).abs() < 0.01);
    assert_eq!(p.wait(2.0, |e| e["type"] == "missing")["file"], "/no/such/file.wav");

    // streamed: from disk, resampled from 44.1 kHz
    p.send(json!({ "op": "play", "key": "s", "file": file, "gainDb": -6 }));
    let lv = p.wait(2.0, |e| e["type"] == "level" && e["cues"]["s"].as_i64().is_some_and(|d| d > -60));
    assert_eq!(lv["voices"], 1);
    let peak = lv["cues"]["s"].as_i64().unwrap();
    assert!((-19..=-17).contains(&peak), "a quarter's peak, 6 dB down: {peak}");
    std::thread::sleep(Duration::from_millis(200));
    p.send(json!({ "op": "where", "keys": ["s"] }));
    let w = p.wait(2.0, |e| e["type"] == "where");
    let t = w["t"].as_f64().unwrap();
    assert!(t > 0.1 && t < 1.0, "{t}");
    let at = w["at"].as_f64().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64() * 1000.0;
    assert!((now - at).abs() < 1000.0, "the wall clock: {at} vs {now}");
    let ended = p.wait(3.0, |e| e["type"] == "ended");
    assert_eq!(ended["key"], "s");

    // decoded ahead, then played to the sample
    p.send(json!({ "op": "decode", "file": file }));
    let dec = p.wait(3.0, |e| e["type"] == "decoded");
    assert_eq!(dec["secs"], 1.0);
    p.send(json!({ "op": "play", "key": "x", "file": file, "exact": true, "loop": true }));
    assert_eq!(p.wait(1.0, |e| e["type"] == "mode")["exact"], true);
    p.send(json!({ "op": "region", "key": "x", "start": 0.1, "end": 0.2 }));
    p.wait(1.0, |e| e["type"] == "level" && e["voices"] == 1);
    p.send(json!({ "op": "stop", "key": "x" }));
    p.wait(1.0, |e| e["type"] == "level" && e["voices"] == 0);

    // what it cannot read, and what it cannot do yet
    p.send(json!({ "op": "play", "key": "m", "file": "/no/such/file.wav" }));
    assert_eq!(p.wait(1.0, |e| e["type"] == "error")["key"], "m");
    p.send(json!({ "op": "ltc", "key": "tc", "on": true }));
    let e = p.wait(1.0, |e| e["type"] == "operror");
    assert_eq!((e["op"].as_str(), e["key"].as_str()), (Some("ltc"), Some("tc")));
    assert!(e["detail"].as_str().unwrap().starts_with("not in the native engine yet"));

    // its standard input closed: it goes
    drop(p.stdin.take());
    let until = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(status) = p.child.try_wait().unwrap() {
            assert!(status.success());
            break;
        }
        assert!(Instant::now() < until, "it did not exit when its input closed");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn what_is_not_a_command_is_said_and_nothing_breaks() {
    let tone = wav("bad.wav", 0.5, 48000, 2, 0.25);
    let file = tone.to_str().unwrap().to_string();
    let mut p = Program::start();
    p.wait(2.0, |e| e["type"] == "ready");
    // not JSON; JSON but not an object; an object with no op; an op nobody has; ten megabytes on one line
    p.raw("{ this is not json\n");
    let e = p.wait(2.0, |e| e["type"] == "operror");
    assert_eq!(e["op"], "");
    assert!(e["detail"].as_str().unwrap().starts_with("not a command"), "{e}");
    p.raw("[1, 2, 3]\n{\"key\": \"x\"}\n{\"op\": \"frobnicate\", \"key\": \"x\"}\n");
    let e = p.wait(2.0, |e| e["type"] == "operror" && e["op"] == "frobnicate");
    assert_eq!(e["detail"], "not a command this engine knows");
    // (written by serde_json, so a Windows path's backslashes are escaped)
    let big = json!({ "op": "play", "key": "big", "file": file, "pad": "x".repeat(10 << 20) }).to_string();
    p.raw(&format!("{big}\n"));
    let mut junk = "y".repeat(10 << 20);
    junk.push('\n');
    p.raw(&junk);
    // commands for keys that are not playing do nothing, and say nothing
    for op in ["stop", "pause", "resume", "fade", "seek", "cut", "loop", "region", "rate", "others", "lanes", "move"] {
        p.send(json!({ "op": op, "key": "nobody", "t": 1, "db": -6, "secs": 1, "at": 1, "rate": 2, "sync": {} }));
    }
    // the ten-megabyte play played
    p.wait(5.0, |e| e["type"] == "level" && e["cues"]["big"].as_i64().is_some_and(|d| d > -60));
    p.send(json!({ "op": "stopAll" }));
    p.wait(2.0, |e| e["type"] == "level" && e["voices"] == 0);
    // its standard input closed: it goes, cleanly
    drop(p.stdin.take());
    let until = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(status) = p.child.try_wait().unwrap() {
            assert!(status.success());
            break;
        }
        assert!(Instant::now() < until, "it did not exit when its input closed");
        std::thread::sleep(Duration::from_millis(20));
    }
    let errs: Vec<&Value> = p.seen.iter().filter(|e| e["type"] == "operror" || e["type"] == "error").collect();
    assert!(errs.iter().all(|e| e["key"] != "nobody"), "nothing said of a key that is not playing: {errs:?}");
}

#[test]
fn the_level_event_says_buffers_missed_and_streams_run_dry() {
    let mut p = Program::start();
    let lv = p.wait(2.0, |e| e["type"] == "level");
    assert_eq!(lv["xruns"], 0);
    assert_eq!(lv["starved"], 0);
    assert!(lv["load"].as_f64().is_some_and(|l| (0.0..1.0).contains(&l)), "{lv}");
}

#[test]
fn a_capture_is_what_the_mixer_gave_with_each_buffers_moment_and_each_command() {
    let dir = std::env::temp_dir().join(format!("ec-audio-capture-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let cap = dir.join("cap.wav");
    let tone = wav("cap-tone.wav", 0.25, 48000, 2, 0.25);
    let file = tone.to_str().unwrap().to_string();
    let mut p = Program::with(&["--capture", cap.to_str().unwrap()]);
    p.wait(2.0, |e| e["type"] == "ready");
    p.send(json!({ "op": "decode", "file": file }));
    p.wait(2.0, |e| e["type"] == "decoded");
    p.send(json!({ "op": "play", "key": "t", "file": file, "gainDb": -6 }));
    p.wait(2.0, |e| e["type"] == "ended");
    drop(p.stdin.take());
    let until = Instant::now() + Duration::from_secs(3);
    while p.child.try_wait().unwrap().is_none() {
        assert!(Instant::now() < until, "it exits");
        std::thread::sleep(Duration::from_millis(20));
    }
    let b = std::fs::read(&cap).unwrap();
    assert_eq!(&b[8..16], b"WAVEfmt ");
    assert_eq!(u16::from_le_bytes([b[20], b[21]]), 3, "32-bit float");
    let data: Vec<f32> = b[58..].chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    let peak = data.iter().fold(0f32, |m, x| m.max(x.abs()));
    assert!((peak - 0.25 * 0.501).abs() < 0.002, "the tone, 6 dB down: {peak}");
    let loud = data.chunks(2).filter(|f| f[0].abs() > 0.0).count();
    assert!((11000..=12100).contains(&loud), "a quarter of a second of it: {loud} frames");
    let blocks = std::fs::read_to_string(dir.join("cap.blocks.csv")).unwrap();
    let rows: Vec<Vec<u64>> = blocks
        .lines()
        .filter(|l| !l.starts_with('#') && !l.starts_with("segment"))
        .map(|l| l.split(',').map(|x| x.parse().unwrap()).collect())
        .collect();
    let frames: u64 = rows.iter().map(|r| r[2]).sum();
    assert_eq!(frames as usize, data.len() / 2, "every frame in the file is in a buffer of the log");
    assert!(rows.windows(2).all(|w| w[1][4] > w[0][4]), "each buffer heard after the one before");
    let cmds = std::fs::read_to_string(dir.join("cap.cmds.jsonl")).unwrap();
    let ops: Vec<String> = cmds
        .lines()
        .map(|l| {
            let v: Value = serde_json::from_str(l).unwrap();
            assert!(v["ns"].as_u64().is_some());
            let c: Value = serde_json::from_str(v["line"].as_str().unwrap()).unwrap();
            c["op"].as_str().unwrap().to_string()
        })
        .collect();
    assert_eq!(ops, ["decode", "play"]);
}
