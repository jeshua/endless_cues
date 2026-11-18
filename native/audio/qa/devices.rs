//! `qa devices`: the output changed under the sound, again and again. A decoded sound (on the left) and a streamed
//! one (on the right) play while `sink` moves the engine between the speakers (44.1 kHz) and RØDE Connect Virtual
//! (48 kHz); both are ramps whose every frame says which frame it is, at −40 dB at most (the speakers are in the
//! room). From the capture: the silence at each change, that each sound carries on from where it was at the right
//! speed, and what the engine said. Then an output that does not exist, asked for while playing.

use crate::common::*;
use serde_json::{json, Value};

const STEP: f64 = 2e-7;
fn val(i: usize) -> f32 {
    (((i % 50000) + 1) as f64 * STEP) as f32
}
fn idx(x: f32) -> f64 {
    x as f64 / STEP - 1.0
}

pub fn run(args: &[String]) -> Value {
    let rounds: usize = crate::arg(args, "--rounds").and_then(|s| s.parse().ok()).unwrap_or(6);
    let a = crate::arg(args, "--a").unwrap_or(SPEAKERS).to_string();
    let b = crate::arg(args, "--b").unwrap_or(RODE).to_string();
    the_show_is_not_running();
    let dir = scratch("devices");
    let cap = dir.join("cap.wav");
    let f_dec = dir.join("dec.wav");
    let f_str = dir.join("str.wav");
    let mono = |n: usize| (0..n).map(val).collect::<Vec<f32>>();
    wav_f32(&f_dec, 48000, 1, &mono(48000 * 10));
    wav_f32(&f_str, 48000, 1, &mono(48000 * 120));
    let p = |x: &std::path::Path| x.to_str().unwrap().to_string();

    let mut e = Engine::start(&["--device", &b, "--capture", cap.to_str().unwrap()]);
    e.must(5.0, "ready", |v| v["type"] == "ready");
    e.decode(&f_dec);
    e.send(json!({ "op": "play", "key": "d", "file": p(&f_dec), "loop": true, "pan": -100 }));
    e.send(json!({ "op": "play", "key": "s", "file": p(&f_str), "pan": 100 }));
    sleep(1.5);
    let mut sinks = Vec::new();
    for r in 0..rounds {
        for dev in [&a, &b] {
            e.send(json!({ "op": "sink", "id": dev }));
            let s = e.must(5.0, "sink", |v| v["type"] == "sink");
            // (`outputs` is said as the device opens, before `sink`)
            let o = e.seen.iter().rev().find(|v| v["type"] == "outputs").map(|v| v["channels"].clone());
            sinks.push(json!({ "round": r, "to": dev, "ok": s["ok"], "outputs": o }));
            sleep(1.2);
        }
    }
    // a new play of the decoded sound, now it has been decoded again at this device's rate
    e.send(json!({ "op": "play", "key": "d2", "file": p(&f_dec), "exact": true, "gainDb": -60 }));
    let mode = e.wait(2.0, |v| v["type"] == "mode" && v["key"] == "d2");
    // an output that is not there
    e.send(json!({ "op": "sink", "id": "No Such Output" }));
    let bad = e.must(5.0, "sink", |v| v["type"] == "sink");
    sleep(1.0);
    e.send(json!({ "op": "stopAll" }));
    sleep(0.3);
    let said = e.drain();
    let devices_said = e.seen.iter().filter(|v| v["type"] == "devices").count();
    let errors: Vec<Value> = e.seen.iter().filter(|v| v["type"] == "error" || v["type"] == "ctx").cloned().collect();
    let _ = said;
    let clean = e.close();

    let c = read_capture(&cap);
    let mut changes = Vec::new();
    for k in 1..c.segments.len() {
        let prev: Vec<&CapBlock> = c.blocks.iter().filter(|x| x.segment == k - 1).collect();
        let next: Vec<&CapBlock> = c.blocks.iter().filter(|x| x.segment == k).collect();
        let (last, first) = (prev[prev.len() - 1], next[0]);
        let gap_ms = (first.present_ns as f64 - (last.present_ns as f64 + last.frames as f64 / last.sr as f64 * 1e9)) / 1e6;
        // each sound's place just before and just after, and its speed within the new segment
        let (ps, pc, pd) = &c.segments[k - 1];
        let (ns, nc, nd) = &c.segments[k];
        let lp = |d: &Vec<f32>, ch: usize, f: usize, side: usize| d[f * ch + side];
        let pf = pd.len() / pc - 1;
        let nf = 2000;
        let at = |d: &Vec<f32>, ch: usize, f: usize, side: usize, g: f64| idx((lp(d, ch, f, side) as f64 / g) as f32);
        let g = std::f64::consts::SQRT_2;
        let before = (at(pd, *pc, pf, 0, g), at(pd, *pc, pf, 1, g));
        let after = (at(nd, *nc, 0, 0, g), at(nd, *nc, 0, 1, g));
        let speed = |side: usize| (at(nd, *nc, nf + 1000, side, g) - at(nd, *nc, nf, side, g)) / 1000.0;
        let jump = |b: f64, a: f64| {
            let d = (a - b).rem_euclid(50000.0);
            if d > 25000.0 {
                d - 50000.0
            } else {
                d
            }
        };
        changes.push(json!({ "to_rate": ns, "from_rate": ps, "silence_ms": gap_ms,
            "decoded_jump_frames": jump(before.0, after.0), "streamed_jump_frames": jump(before.1, after.1),
            "decoded_speed": speed(0), "streamed_speed": speed(1), "want_speed": 48000.0 / *ns as f64 }));
    }
    let gaps = c.gaps();
    json!({ "rounds": rounds, "a": a, "b": b, "sinks": sinks, "changes": changes, "device_gaps_within_a_device": gaps.len(),
        "capture_dropped": c.blocks.iter().filter(|x| x.dropped).count(),
        "new_play_after_changes_exact": mode.map(|m| m["exact"].clone()),
        "no_such_output": bad, "devices_events": devices_said, "errors_or_ctx": errors, "exited_cleanly": clean })
}
