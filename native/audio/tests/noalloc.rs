//! The audio thread never allocates or frees memory: every render here runs under assert_no_alloc, whose
//! allocator stops the test at the first allocation or free on this thread while it is on. The scene asks for
//! everything the mixer does: starts, stops, a sound ending, fades with shapes, a held loop, a move, a rate ramp, a
//! cut, the lines, a stream, buses and the master. (assert_no_alloc checks only in a debug build, so the test is one.)
#![cfg(debug_assertions)]

use assert_no_alloc::{assert_no_alloc, AllocDisabler};

#[global_allocator]
static A: AllocDisabler = AllocDisabler;

mod common;
use common::*;
use serde_json::json;

fn render(rig: &mut Rig, frames: usize) {
    let mut out = vec![0f32; frames * rig.ch];
    let mixer = &mut rig.mixer;
    assert_no_alloc(|| {
        for chunk in out.chunks_mut(256 * 2) {
            mixer.render(chunk, 0, 0);
        }
    });
    rig.control.poll();
}

#[test]
fn rendering_allocates_nothing() {
    let mut rig = Rig::new(2);
    rig.insert("/r.wav", ramp(48000 * 4, 2));
    rig.insert("/short.wav", dc(2000, 1, 0.1));
    let streamed = wav("noalloc.wav", 2.0, 44100, 2, 0.1);
    rig.cmd(json!({ "op": "buses", "list": [{ "id": "music", "db": -3 }, { "id": "fx", "db": 0, "out": 3 }] }));
    rig.cmd(json!({ "op": "play", "key": "a", "file": "/r.wav", "bus": "music", "envelope": [[0, -6], [1, 0, 0.5]], "automation": { "pan": [[0, -50], [2, 50]] } }));
    rig.cmd(json!({ "op": "play", "key": "b", "file": "/short.wav", "pan": 30 }));
    rig.cmd(json!({ "op": "play", "key": "s", "file": streamed.to_str().unwrap(), "gainDb": -6 }));
    render(&mut rig, 4800);
    // the stream's thread has had time to fill its ring before it is needed
    std::thread::sleep(std::time::Duration::from_millis(300));
    render(&mut rig, 48000);
    rig.cmd(json!({ "op": "region", "key": "a", "start": 1.0, "end": 1.25 }));
    rig.cmd(json!({ "op": "fade", "key": "a", "db": -12, "secs": 0.5, "shape": (0..65).map(|i| i as f64 / 64.0).collect::<Vec<_>>() }));
    rig.cmd(json!({ "op": "rate", "key": "s", "rate": 1.5, "secs": 0.5 }));
    rig.cmd(json!({ "op": "masterDb", "db": -3, "secs": 0.2 }));
    rig.cmd(json!({ "op": "bus", "name": "music", "db": -10, "secs": 0.3 }));
    rig.cmd(json!({ "op": "others", "key": "a", "db": -6, "secs": 0.1 }));
    render(&mut rig, 24000);
    rig.cmd(json!({ "op": "move", "key": "a", "to": 2.0, "region": { "start": 2.0, "end": 2.5 }, "sync": { "at": 1.1, "lead": 0.05, "xf": 0.05, "blend": "fade" } }));
    rig.cmd(json!({ "op": "lanes", "key": "a", "envelope": [[0, 0]], "pan": -20 }));
    rig.cmd(json!({ "op": "pause", "key": "s" }));
    render(&mut rig, 24000);
    rig.cmd(json!({ "op": "resume", "key": "s" }));
    rig.cmd(json!({ "op": "cut", "key": "a", "at": 2.3 }));
    rig.cmd(json!({ "op": "seek", "key": "a", "t": 2.1 }));
    render(&mut rig, 24000);
    rig.cmd(json!({ "op": "stop", "key": "a" }));
    rig.cmd(json!({ "op": "play", "key": "c", "file": "/short.wav", "own": { "audition": 1 } }));
    render(&mut rig, 24000);
    rig.cmd(json!({ "op": "stopAll" }));
    render(&mut rig, 4800);
    let said = rig.said();
    assert!(of(&said, "ended").iter().any(|e| e["key"] == "b"), "the short one ended, under the assert");
}
