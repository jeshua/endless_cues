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
        let mut child = Command::new(env!("CARGO_BIN_EXE_ec-audio"))
            .arg("--silent")
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
