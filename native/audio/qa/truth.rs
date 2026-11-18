//! `qa truth`: what really leaves the engine, on a real device. The program is run as the host runs it, on
//! BlackHole (a virtual device whose output loops back to its input, digitally), with `--capture`; BlackHole's
//! input is recorded at the same time. Each scene is then read back out of the capture, and the recording is held
//! against the capture sample for sample.

use crate::common::*;
use ec_audio::arith::{along, pan_gains, to_db, to_lin, value_at};
use serde_json::{json, Value};

const SR: usize = 48000;

pub fn run(args: &[String]) -> Value {
    let num = |name: &str, d: f64| crate::arg(args, name).and_then(|s| s.parse().ok()).unwrap_or(d);
    let loop_s = num("--loop-s", 120.0);
    let stream_s = num("--stream-s", 180.0);
    let device = crate::arg(args, "--device").unwrap_or(BLACKHOLE).to_string();
    let buffer = crate::arg(args, "--buffer").unwrap_or("256").to_string();
    the_show_is_not_running();
    let dir = scratch("truth");
    let cap = dir.join("cap.wav");

    // the files: a click, an index ramp (each frame says which it is), a steady level, a long ramp to stream
    let click: Vec<f32> = (0..96)
        .flat_map(|i| {
            let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / 96.0).cos();
            let x = if i == 0 { 0.05 } else { (0.1 * w * (std::f64::consts::TAU * 2000.0 * i as f64 / SR as f64).sin()) as f32 };
            [x, x]
        })
        .collect();
    let f_click = dir.join("click.wav");
    wav_f32(&f_click, SR as u32, 2, &click);
    let f_ramp = dir.join("ramp.wav");
    wav_f32(&f_ramp, SR as u32, 2, &ramp(SR * 3, 2));
    let f_dc = dir.join("dc.wav");
    wav_f32(&f_dc, SR as u32, 1, &vec![0.5f32; SR * 4]);
    let f_long = dir.join("long.wav");
    wav_f32(&f_long, SR as u32, 2, &ramp((SR as f64 * (stream_s + 5.0)) as usize, 2));

    let rec = record(&device);
    let mut e = Engine::start(&["--device", &device, "--buffer", &buffer, "--capture", cap.to_str().unwrap()]);
    e.must(5.0, "ready", |v| v["type"] == "ready");
    for f in [&f_click, &f_ramp, &f_dc] {
        e.decode(f);
    }
    let path = |p: &std::path::Path| p.to_str().unwrap().to_string();
    sleep(0.5);

    // A: decoded starts
    let mut seed = 0x2545_f491u32;
    for i in 0..30 {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        e.send(json!({ "op": "play", "key": format!("c{i}"), "file": path(&f_click) }));
        sleep(0.08 + (seed % 70) as f64 / 1000.0);
    }
    sleep(0.3);
    // C: a fade with a shape (an s-curve, as curves.ts sends it: 65 readings of its progress)
    let shape: Vec<f64> = (0..65).map(|k| (1.0 - (std::f64::consts::PI * k as f64 / 64.0).cos()) / 2.0).collect();
    e.send(json!({ "op": "play", "key": "fade", "file": path(&f_dc) }));
    sleep(0.4);
    e.send(json!({ "op": "fade", "key": "fade", "db": -40, "secs": 1.0, "shape": shape }));
    sleep(1.3);
    e.send(json!({ "op": "stop", "key": "fade" }));
    sleep(0.3);
    // D: pans, then a Pan line
    let pans = [-100.0, -50.0, 0.0, 30.0, 100.0];
    for (k, p) in pans.iter().enumerate() {
        e.send(json!({ "op": "play", "key": format!("pan{k}"), "file": path(&f_dc), "pan": p }));
        sleep(0.25);
        e.send(json!({ "op": "stop", "key": format!("pan{k}") }));
        sleep(0.15);
    }
    let line = json!([[0, -100], [1.0, 100, 0.5], [2.0, 0]]);
    e.send(json!({ "op": "play", "key": "panline", "file": path(&f_dc), "automation": { "pan": line } }));
    sleep(2.3);
    e.send(json!({ "op": "stop", "key": "panline" }));
    sleep(0.3);
    // F: a stop, declicked
    e.send(json!({ "op": "play", "key": "st", "file": path(&f_dc) }));
    sleep(0.3);
    e.send(json!({ "op": "stop", "key": "st" }));
    sleep(0.3);
    // E: a stream from a place, for minutes
    e.send(json!({ "op": "play", "key": "long", "file": path(&f_long), "from": 1.234 }));
    eprintln!("streaming {stream_s} s…");
    sleep(stream_s);
    e.send(json!({ "op": "stop", "key": "long" }));
    sleep(0.3);
    // B: a held loop, for minutes
    e.send(json!({ "op": "play", "key": "loop", "file": path(&f_ramp), "from": 0.2 }));
    e.send(json!({ "op": "region", "key": "loop", "start": 0.25, "end": 0.5 }));
    eprintln!("looping {loop_s} s…");
    sleep(loop_s);
    e.send(json!({ "op": "stop", "key": "loop" }));
    sleep(0.5);
    let levels: Vec<Value> = e.drain().into_iter().filter(|v| v["type"] == "level").collect();
    let xruns = levels.last().map(|l| l["xruns"].clone()).unwrap_or(Value::Null);
    let load_max = levels.iter().filter_map(|l| l["load"].as_f64()).fold(0.0, f64::max);
    let clean = e.close();
    sleep(0.3);
    let recorded = rec.take();
    drop(rec);

    let c = read_capture(&cap);
    let l = c.channel(0, 0);
    let r = c.channel(0, 1);
    let heard = |f: usize| c.heard_ns(0, f).unwrap_or(0);
    // the first frame at or after `from` where `pick` is true
    let first = |from: usize, pick: &dyn Fn(usize) -> bool| (from..l.len()).find(|&f| pick(f));
    // the first frame heard after the moment `ns`
    let after = |ns: u64| c.frame_after(ns).min(l.len());
    let mut report = json!({ "device": device, "buffer": buffer, "xruns": xruns, "load_max": load_max, "exited_cleanly": clean,
        "capture_blocks": c.blocks.len(), "capture_dropped": c.blocks.iter().filter(|b| b.dropped).count(), "device_gaps": c.gaps().len() });

    // A
    let mut lat = Vec::new();
    let mut nth = [0usize; 4];
    let mut not_on_a_buffer = 0;
    for i in 0..30 {
        let Some(t) = c.cmd("play", &format!("c{i}")) else { continue };
        let Some(f) = first(after(t.saturating_sub(50_000_000)), &|f| l[f] != 0.0 && heard(f) > t) else { continue };
        lat.push((heard(f) - t) as f64 / 1e6);
        let b = c.block_of(0, f).unwrap();
        if f != b.file_frame {
            not_on_a_buffer += 1;
        }
        // which buffer after the command it is in: 0, the first rendered after it
        let k = c.blocks.iter().filter(|x| x.callback_ns > t && x.callback_ns < b.callback_ns).count();
        nth[k.min(3)] += 1;
    }
    report["starts"] = json!({ "found": lat.len(), "command_to_first_sample_heard_ms": stats(&lat),
        "in_buffer_after_command": { "first": nth[0], "second": nth[1], "third": nth[2], "later": nth[3] },
        "not_at_a_buffer_start": not_on_a_buffer });

    // C
    let fc = c.cmd("fade", "fade").unwrap();
    let f0 = first(after(fc), &|f| l[f] > 0.0 && l[f] < 0.5 - 1e-6).unwrap();
    let n = SR;
    let (mut worst, mut worst_at) = (0f64, 0);
    let mut web_worst = 0f64;
    for k in 0..n {
        let x = (k + 1) as f64 / n as f64;
        let want = to_lin(-40.0 * along(&shape, x)) * 0.5;
        let got = l[f0 + k] as f64;
        let err = (to_db(got / 0.5) - to_db(want / 0.5)).abs();
        if err > worst {
            worst = err;
            worst_at = k;
        }
        // the audio window's own: 50 readings a second, joined by straight lines in gain (setValueCurveAtTime)
        let m = 50usize;
        let pos = x * (m - 1) as f64;
        let i = (pos.floor() as usize).min(m - 2);
        let a = to_lin(-40.0 * along(&shape, i as f64 / (m - 1) as f64));
        let b = to_lin(-40.0 * along(&shape, (i + 1) as f64 / (m - 1) as f64));
        let web = a + (b - a) * (pos - i as f64);
        web_worst = web_worst.max((to_db(web) - to_db(want / 0.5)).abs());
    }
    let landed = (l[f0 + n + 10] as f64 / 0.5, to_lin(-40.0));
    report["fade"] = json!({ "worst_db_from_curves": worst, "at_frame": worst_at, "landed": landed.0, "want": landed.1,
        "web_audio_curve_worst_db_from_the_same": web_worst, "started_ms_after_command": (heard(f0) as f64 - fc as f64) / 1e6 });

    // D
    let mut pan_err = Vec::new();
    for (k, p) in pans.iter().enumerate() {
        let t = c.cmd("play", &format!("pan{k}")).unwrap();
        let f = first(after(t), &|f| l[f] != 0.0 || r[f] != 0.0).unwrap() + 2000;
        let (pl, pr) = pan_gains(*p);
        pan_err.push(json!({ "pan": p, "l": l[f] as f64 / 0.5, "r": r[f] as f64 / 0.5, "want_l": pl, "want_r": pr,
            "err": ((l[f] as f64 / 0.5 - pl).abs()).max((r[f] as f64 / 0.5 - pr).abs()) }));
    }
    let t = c.cmd("play", "panline").unwrap();
    let p0 = first(after(t), &|f| l[f] != 0.0 || r[f] != 0.0).unwrap();
    let pts: Vec<[f64; 3]> = line
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            let a = p.as_array().unwrap();
            [a[0].as_f64().unwrap(), a[1].as_f64().unwrap(), a.get(2).and_then(Value::as_f64).unwrap_or(0.0)]
        })
        .collect();
    let mut line_worst = 0f64;
    for k in 0..(2 * SR) {
        let (pl, pr) = pan_gains(value_at(&pts, k as f64 / SR as f64).unwrap());
        let e1 = (l[p0 + k] as f64 / 0.5 - pl).abs().max((r[p0 + k] as f64 / 0.5 - pr).abs());
        line_worst = line_worst.max(e1);
    }
    report["pan"] = json!({ "fields": pan_err, "line_worst_gain_error": line_worst });

    // F
    let ts = c.cmd("stop", "st").unwrap();
    let s0 = first(after(ts.saturating_sub(20_000_000)), &|f| l[f] > 0.0 && l[f] < 0.5 - 1e-6).unwrap();
    let s1 = first(s0, &|f| l[f] == 0.0).unwrap();
    let step = (s0.saturating_sub(1)..s1).map(|f| (l[f + 1] - l[f]).abs()).fold(0f32, f32::max);
    report["stop"] =
        json!({ "frames_to_silence": s1 - s0 + 1, "want": (0.002 * SR as f64) as usize, "largest_step": step, "of_level": 0.5 });

    // E
    let t = c.cmd("play", "long").unwrap();
    let e0 = first(after(t), &|f| l[f] != 0.0).unwrap();
    let want0 = ((1.234 * SR as f64).round() as usize % 50000) as i64;
    let te = c.cmd("stop", "long").unwrap();
    let e_end = after(te);
    let mut breaks = Vec::new();
    for f in e0 + 1..e_end {
        let (a, b) = (index_of(l[f - 1]), index_of(l[f]));
        if b != (a + 1) % 50000 || l[f] != r[f] {
            breaks.push(f);
        }
    }
    report["stream"] = json!({ "first_index": index_of(l[e0]), "want": want0, "seconds": (e_end - e0) as f64 / SR as f64,
        "breaks": breaks.len(), "first_breaks": breaks.iter().take(5).collect::<Vec<_>>(), "start_ms_after_command": (heard(e0) as f64 - t as f64) / 1e6 });

    // B
    let t = c.cmd("play", "loop").unwrap();
    let b0 = first(after(t), &|f| l[f] != 0.0).unwrap();
    let tb = c.cmd("stop", "loop").unwrap();
    let b_end = after(tb);
    let (start, end) = (12000i64, 24000i64);
    let mut want = index_of(l[b0]);
    let mut wrong = 0usize;
    let mut first_wrong = None;
    for (k, x) in l[b0..b_end].iter().enumerate() {
        if index_of(*x) != want || *x != index_value(want as usize) {
            wrong += 1;
            first_wrong.get_or_insert(k);
            want = index_of(*x);
        }
        want += 1;
        if want == end {
            want = start;
        }
    }
    report["loop"] = json!({ "first_index": index_of(l[b0]), "want_first": 9600, "seconds": (b_end - b0) as f64 / SR as f64,
        "passes": (b_end - b0) as f64 / (end - start) as f64, "frames_wrong": wrong, "first_wrong": first_wrong });

    // the recording against the capture: lined up by the first sound in each (the first click), then frame by frame
    let (_, cch, cdata) = &c.segments[0];
    let cch = *cch;
    let nz = |d: &[f32]| d.iter().position(|x| *x != 0.0).map(|i| i / cch);
    report["recording"] = match (nz(cdata), nz(&recorded)) {
        (Some(a), Some(b)) => {
            let off = b as i64 - a as i64;
            let frames = cdata.len() / cch;
            let (mut same, mut differ, mut first_diff) = (0usize, 0usize, None);
            for f in 0..frames {
                let g = f as i64 + off;
                if g < 0 || (g as usize + 1) * cch > recorded.len() {
                    continue;
                }
                let g = g as usize;
                if cdata[f * cch..(f + 1) * cch] == recorded[g * cch..(g + 1) * cch] {
                    same += 1;
                } else {
                    differ += 1;
                    first_diff.get_or_insert(f);
                }
            }
            json!({ "offset_frames": off, "capture_frames": frames, "recorded_frames": recorded.len() / cch, "frames_compared": same + differ,
                "frames_identical": same, "frames_different": differ, "first_different": first_diff })
        }
        _ => json!({ "found": false, "recorded_frames": recorded.len() / cch }),
    };
    report
}
