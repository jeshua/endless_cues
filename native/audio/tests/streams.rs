//! Sounds streamed from disk: started once their ring is filled, moved by a new stream, and moved over to their
//! buffer when it has been decoded.

mod common;
use common::*;
use serde_json::json;
use std::time::Duration;

/// Renders until `f` says so (the stream's thread runs on its own time), at most a few seconds.
fn until(rig: &mut Rig, mut f: impl FnMut(&[f32]) -> bool) -> usize {
    for i in 0..400 {
        let out = rig.left(480);
        if f(&out) {
            return i;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    panic!("it never happened");
}

#[test]
fn a_stream_starts_full_and_ends_once() {
    let path = wav("stream.wav", 0.5, 48000, 1, 0.5);
    let mut rig = Rig::new(2);
    rig.cmd(json!({ "op": "play", "key": "s", "file": path.to_str().unwrap(), "exact": true }));
    assert_eq!(of(&rig.said(), "mode")[0]["exact"], false, "asked to be exact, but not decoded: it streams");
    // nothing until its ring has enough in it; then the tone, unbroken
    until(&mut rig, |o| o.iter().any(|x| x.abs() > 0.1));
    let out = rig.left(4800);
    let peak = out.iter().fold(0f32, |m, x| m.max(x.abs()));
    assert!((peak - 0.5).abs() < 0.01, "{peak}");
    let mut ended = 0;
    for _ in 0..100 {
        rig.left(4800);
        ended += of(&rig.said(), "ended").len();
        std::thread::sleep(Duration::from_millis(2));
    }
    assert_eq!(ended, 1);
}

#[test]
fn a_stream_seeks_by_a_new_stream_and_moves_over_to_its_buffer() {
    let path = wav("long.wav", 3.0, 48000, 2, 0.25);
    let file = path.to_str().unwrap().to_string();
    let mut rig = Rig::new(2);
    rig.cmd(json!({ "op": "play", "key": "s", "file": file }));
    until(&mut rig, |o| o.iter().any(|x| x.abs() > 0.1));
    rig.cmd(json!({ "op": "seek", "key": "s", "t": 2.0 }));
    // the old place plays on until the new one is ready, then the new one
    let mut t = 0.0;
    for _ in 0..200 {
        rig.left(480);
        rig.cmd(json!({ "op": "where", "keys": ["s"] }));
        if let Some(w) = of(&rig.said(), "where").first() {
            t = w["t"].as_f64().unwrap();
            if t >= 2.0 {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!((2.0..2.5).contains(&t), "{t}");
    // decoded now: the stream becomes the buffer, where it is
    rig.cmd(json!({ "op": "decode", "file": file }));
    let said = rig.said();
    assert_eq!(of(&said, "decoded")[0]["secs"], 3.0);
    assert_eq!(of(&said, "mode")[0]["exact"], true);
    let out = rig.left(4800);
    assert!(out.iter().fold(0f32, |m, x| m.max(x.abs())) > 0.2, "it plays on");
    rig.cmd(json!({ "op": "where", "keys": ["s"] }));
    let w = of(&rig.said(), "where")[0]["t"].as_f64().unwrap();
    assert!(w > t && w < t + 0.5, "{w} after {t}");
    // a buffer now: a held loop is to the sample
    rig.cmd(json!({ "op": "region", "key": "s", "start": 2.5, "end": 2.6 }));
    rig.left(48000);
    rig.cmd(json!({ "op": "where", "keys": ["s"] }));
    let w = of(&rig.said(), "where")[0]["t"].as_f64().unwrap();
    assert!((2.5..2.6).contains(&w), "{w}");
}
