//! The mixer, rendered offline: what a command does to the samples that come out.

mod common;
use common::*;
use ec_audio::arith::{along, to_lin};
use ec_audio::limiter::CEILING;
use serde_json::json;

#[test]
fn a_decoded_sound_starts_on_the_first_frame_after_its_command() {
    let mut rig = Rig::new(2);
    rig.insert("/a.wav", dc(48000, 2, 0.5));
    assert!(rig.left(100).iter().all(|x| *x == 0.0));
    rig.cmd(json!({ "op": "play", "key": "a", "file": "/a.wav", "exact": true }));
    let out = rig.left(256);
    assert_eq!(out[0], 0.5, "the first frame after the command");
    assert!(out.iter().all(|x| *x == 0.5));
    assert_eq!(rig.control.started_frame("a"), Some(100));
    let said = rig.said();
    assert_eq!(of(&said, "mode")[0]["exact"], true);
}

#[test]
fn a_region_loops_to_the_sample_over_many_passes() {
    let mut rig = Rig::new(2);
    rig.insert("/r.wav", ramp(48000, 2));
    rig.cmd(json!({ "op": "play", "key": "r", "file": "/r.wav", "from": 0.2 }));
    rig.cmd(json!({ "op": "region", "key": "r", "start": 0.25, "end": 0.5 }));
    // ten seconds: forty times round a quarter-second loop
    let out = rig.left(480_000);
    let (start, end) = (12000usize, 24000usize);
    let mut want = 9600usize;
    for (i, x) in out.iter().enumerate() {
        assert_eq!(index_of(*x), want, "frame {i}");
        assert_eq!(*x, index_value(want), "frame {i} is the file's sample exactly");
        want += 1;
        if want == end {
            want = start;
        }
    }
    // let go: it plays on from where it is, to its end
    rig.cmd(json!({ "op": "region", "key": "r" }));
    let more = rig.left(1000);
    assert_eq!(index_of(more[0]), want);
    assert_eq!(index_of(more[999]), want + 999);
}

#[test]
fn seek_pause_resume_and_cut() {
    let mut rig = Rig::new(2);
    rig.insert("/r.wav", ramp(48000, 1));
    rig.cmd(json!({ "op": "play", "key": "r", "file": "/r.wav" }));
    let a = rig.left(100);
    assert_eq!(index_of(a[99]), 99);
    rig.cmd(json!({ "op": "seek", "key": "r", "t": 0.5 }));
    let b = rig.left(10);
    assert_eq!(index_of(b[0]), 24000);
    rig.cmd(json!({ "op": "pause", "key": "r" }));
    assert!(rig.left(500).iter().all(|x| *x == 0.0), "paused: silent");
    rig.cmd(json!({ "op": "resume", "key": "r" }));
    let c = rig.left(10);
    assert_eq!(index_of(c[0]), 24010, "on from where it was paused");
    // paused, then resumed from a place
    rig.cmd(json!({ "op": "pause", "key": "r" }));
    rig.left(50);
    rig.cmd(json!({ "op": "resume", "key": "r", "t": 0.1 }));
    assert_eq!(index_of(rig.left(1)[0]), 4800);

    // a cut: silent from its place in the file, after a 4 ms ramp
    let mut rig = Rig::new(2);
    rig.insert("/d.wav", dc(48000, 2, 0.5));
    rig.cmd(json!({ "op": "play", "key": "d", "file": "/d.wav" }));
    rig.cmd(json!({ "op": "cut", "key": "d", "at": 0.1 }));
    let out = rig.left(9600);
    let ramp = (0.004 * SR) as usize;
    assert!(out[..4800 - ramp].iter().all(|x| *x == 0.5));
    assert!(out[4800 - ramp + 10] < 0.5 && out[4800 - ramp + 10] > 0.0);
    assert!(out[4800..].iter().all(|x| *x == 0.0), "silent from the place");
    // the next fade takes it back
    rig.cmd(json!({ "op": "fade", "key": "d", "db": 0, "secs": 0 }));
    assert_eq!(rig.left(1)[0], 0.5);
}

#[test]
fn a_fade_lands_on_its_target_at_its_time_with_its_shape() {
    for name in ["linear", "s-curve"] {
        let shape: Vec<f64> = (0..65)
            .map(|i| {
                let x = i as f64 / 64.0;
                if name == "linear" {
                    x
                } else {
                    (1.0 - (std::f64::consts::PI * x).cos()) / 2.0
                }
            })
            .collect();
        let mut rig = Rig::new(2);
        rig.insert("/d.wav", dc(96000, 2, 0.5));
        rig.cmd(json!({ "op": "play", "key": "d", "file": "/d.wav" }));
        rig.cmd(json!({ "op": "fade", "key": "d", "db": -20, "secs": 0.5, "shape": shape }));
        let out = rig.left(48000);
        let n = 24000.0;
        for k in [1usize, 1000, 6000, 12000, 18000, 23999] {
            let want = 0.5 * to_lin(-20.0 * along(&shape, k as f64 / n));
            // (frame k has had k + 1 steps of the fade)
            let want_next = 0.5 * to_lin(-20.0 * along(&shape, (k + 1) as f64 / n));
            let got = out[k] as f64;
            assert!((got - want_next).abs() < 1e-6 || (got - want).abs() < 1e-6, "{name} at {k}: {got} vs {want_next}");
        }
        let end = 0.5 * to_lin(-20.0);
        assert!((out[23999] as f64 - end).abs() < 1e-7, "{name}: on its target at its time");
        assert!(out[24000..].iter().all(|x| (*x as f64 - end).abs() < 1e-7), "{name}: and stays there");
        // the s-curve is still near the top a tenth of the way in; the straight line is well on its way
        let tenth = out[2400] as f64;
        if name == "s-curve" {
            assert!(tenth > 0.5 * to_lin(-1.0))
        } else {
            assert!(tenth < 0.5 * to_lin(-1.5))
        }
    }
}

#[test]
fn bus_and_master_gains() {
    let mut rig = Rig::new(2);
    rig.insert("/d.wav", dc(480000, 2, 0.5));
    rig.cmd(json!({ "op": "bus", "name": "music", "db": -6, "secs": 0 }));
    rig.cmd(json!({ "op": "play", "key": "d", "file": "/d.wav", "bus": "music" }));
    let x = rig.left(10)[9] as f64;
    assert!((x - 0.5 * to_lin(-6.0)).abs() < 1e-6);
    rig.cmd(json!({ "op": "masterDb", "db": -6, "secs": 0 }));
    let x = rig.left(10)[9] as f64;
    assert!((x - 0.5 * to_lin(-12.0)).abs() < 1e-6);
    // a bus fader's glide is Web Audio's setTargetAtTime with a time constant of a third of its time: from -6 to
    // -26 dB over a second, it is 95% of the way there (in gain) by then
    rig.cmd(json!({ "op": "bus", "name": "music", "db": -26, "secs": 1 }));
    let out = rig.left(48000);
    let (v0, v1) = (to_lin(-6.0), to_lin(-26.0));
    let want = v1 + (v0 - v1) * (-3.0f64).exp();
    let got = out[47999] as f64 / (0.5 * to_lin(-6.0));
    assert!((got - want).abs() < 1e-4, "{got} vs {want}");
    // the buses list: a level, and a pair the device does not have is nowhere
    rig.cmd(json!({ "op": "buses", "list": [{ "id": "music", "db": 0, "out": 3 }] }));
    rig.left(4800);
    assert!(rig.left(10).iter().all(|x| *x == 0.0), "outputs 3–4 on a two-output device: silent");
    // the smoke run's mute
    rig.cmd(json!({ "op": "buses", "list": [{ "id": "music", "db": 0, "out": 1 }] }));
    rig.cmd(json!({ "op": "master", "gain": 0 }));
    assert!(rig.left(100).iter().all(|x| *x == 0.0));
}

#[test]
fn a_bus_on_another_pair_plays_there() {
    let mut rig = Rig::new(4);
    rig.insert("/d.wav", dc(48000, 2, 0.25));
    rig.cmd(json!({ "op": "buses", "list": [{ "id": "fx", "db": 0, "out": 3 }] }));
    rig.cmd(json!({ "op": "play", "key": "d", "file": "/d.wav", "bus": "fx" }));
    let out = rig.render(100);
    let last = &out[99 * 4..];
    assert_eq!(last, &[0.0, 0.0, 0.25, 0.25]);
    // a trim on output 4 only
    rig.cmd(json!({ "op": "outputs", "trims": { "4": -6 } }));
    let out = rig.render(4800);
    let last = &out[4799 * 4..];
    assert_eq!(last[2], 0.25);
    assert!((last[3] as f64 - 0.25 * to_lin(-6.0)).abs() < 1e-4);
}

#[test]
fn the_limiter_never_lets_a_sample_past_its_ceiling() {
    let mut rig = Rig::new(2);
    let n = 96000;
    let mut d = Vec::with_capacity(n * 4);
    let mut s = 1u32;
    for i in 0..2 * n {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        let noise = (s as f32 / u32::MAX as f32) * 2.0 - 1.0;
        let tone = (i as f32 * 0.03).sin();
        d.push(noise);
        d.push(tone);
    }
    rig.insert("/loud.wav", ec_audio::pcm::Pcm::new(48000, 2, d));
    rig.cmd(json!({ "op": "play", "key": "l", "file": "/loud.wav", "gainDb": 12 }));
    rig.cmd(json!({ "op": "masterDb", "db": 8, "secs": 0 }));
    let out = rig.render(n);
    let peak = out.iter().fold(0f32, |m, x| m.max(x.abs()));
    assert!(peak <= CEILING, "{peak}");
    assert!(peak > 0.9 * CEILING, "it is at work, not silent");
    rig.control.level();
    let said = rig.said();
    assert_eq!(of(&said, "level")[0]["limiting"], true);
    // off: it does nothing
    rig.cmd(json!({ "op": "limiter", "on": false }));
    let out = rig.render(4800);
    assert!(out.iter().fold(0f32, |m, x| m.max(x.abs())) > 2.0);
}

#[test]
fn ended_is_said_once_and_a_stop_says_nothing() {
    let mut rig = Rig::new(2);
    rig.insert("/short.wav", dc(4800, 2, 0.1));
    rig.cmd(json!({ "op": "play", "key": "s", "file": "/short.wav" }));
    let out = rig.left(9600);
    assert!(out[4799] == 0.1 && out[4800] == 0.0, "it ends on its last sample");
    rig.left(48000);
    let said = rig.said();
    let ended = of(&said, "ended");
    assert_eq!(ended.len(), 1);
    assert_eq!(ended[0]["key"], "s");
    assert_eq!(rig.control.playing(), 0);

    rig.cmd(json!({ "op": "play", "key": "t", "file": "/short.wav", "loop": true }));
    rig.left(20000);
    rig.cmd(json!({ "op": "stop", "key": "t" }));
    let out = rig.left(1000);
    assert!(out[200..].iter().all(|x| *x == 0.0), "gone after its 2 ms declick");
    assert!(of(&rig.said(), "ended").is_empty());
    // the same key again is a new sound; the old one's end is not said for it
    rig.cmd(json!({ "op": "play", "key": "u", "file": "/short.wav" }));
    rig.cmd(json!({ "op": "play", "key": "u", "file": "/short.wav" }));
    rig.left(10000);
    assert_eq!(of(&rig.said(), "ended").len(), 1);
}

#[test]
fn a_loop_of_the_whole_file_goes_round_and_is_told_to_finish() {
    let mut rig = Rig::new(2);
    rig.insert("/r.wav", ramp(1000, 1));
    rig.cmd(json!({ "op": "play", "key": "r", "file": "/r.wav", "loop": true }));
    let out = rig.left(3500);
    for (i, x) in out.iter().enumerate() {
        assert_eq!(index_of(*x), i % 1000);
    }
    rig.cmd(json!({ "op": "loop", "key": "r", "on": false }));
    let out = rig.left(1000);
    assert_eq!(index_of(out[499]), 999);
    assert_eq!(out[500], 0.0);
    assert_eq!(of(&rig.said(), "ended").len(), 1);
}

#[test]
fn rate_moves_through_the_file_faster_or_slower() {
    let mut rig = Rig::new(2);
    rig.insert("/r.wav", ramp(48000, 1));
    rig.cmd(json!({ "op": "play", "key": "r", "file": "/r.wav", "rate": 2 }));
    let out = rig.left(100);
    assert_eq!(index_of(out[50]), 100);
    rig.cmd(json!({ "op": "rate", "key": "r", "rate": 0.5 }));
    let out = rig.left(4);
    // half a frame a frame: between two of the file's samples, read between them
    assert!((out[1] as f64 * 100000.0 - 200.5).abs() < 0.01, "{}", out[1] * 100000.0);
    // a ramp of the rate: 1 to 2 over a second covers a second and a half of the file
    let mut rig = Rig::new(2);
    rig.insert("/r.wav", ramp(48000 * 2, 1));
    rig.cmd(json!({ "op": "play", "key": "r", "file": "/r.wav" }));
    rig.cmd(json!({ "op": "rate", "key": "r", "rate": 2, "secs": 1 }));
    let out = rig.left(48001);
    let at = out[48000] as f64 * 100000.0 + 50000.0;
    assert!((at - 72000.0).abs() < 2.0, "{at}");
}

#[test]
fn a_move_lands_on_its_place_and_crossfades() {
    let mut rig = Rig::new(2);
    rig.insert("/r.wav", ramp(48000, 1));
    rig.cmd(json!({ "op": "play", "key": "r", "file": "/r.wav" }));
    rig.left(480);
    // to 0.5 s, when the track reaches 0.1 s (to the sample), crossfading over 10 ms with equal gain
    rig.cmd(json!({ "op": "move", "key": "r", "to": 0.5, "sync": { "at": 0.1, "lead": 0.09, "xf": 0.01, "blend": "cut" } }));
    let out = rig.left(9600);
    // before the landing: on as it was
    assert_eq!(index_of(out[4799 - 480 - 1]), 4798);
    // well after it: the new place, exactly
    let k = 4800 - 480 + 480 + 10;
    assert_eq!(index_of(out[k]), 24000 + 480 + 10);
    // in the crossfade the two sum to the straight line between the two places' values
    let mid = 4800 - 480 + 240;
    let want = (1.0 - 241.0 / 480.0) * index_value(4800 + 240) as f64 + (241.0 / 480.0) * index_value(24000 + 240) as f64;
    assert!((out[mid] as f64 - want).abs() < 1e-4, "{} vs {want}", out[mid]);
    // a region the move brings is held from then on
    rig.cmd(json!({ "op": "move", "key": "r", "to": 0.25, "region": { "start": 0.25, "end": 0.26 }, "sync": { "at": 1.0, "lead": 0.0, "xf": 0.005, "blend": "cut" } }));
    let out = rig.left(4800);
    assert_eq!(index_of(out[4799]), 12000 + 4799 % 480, "from the landing on, round its new loop");
}

#[test]
fn others_and_audition() {
    let mut rig = Rig::new(4);
    rig.insert("/d.wav", dc(48000, 2, 0.5));
    rig.cmd(json!({ "op": "play", "key": "d", "file": "/d.wav" }));
    rig.cmd(json!({ "op": "others", "key": "d", "db": -12, "secs": 0 }));
    let x = rig.left(10)[9] as f64;
    assert!((x - 0.5 * to_lin(-12.0)).abs() < 1e-6);
    // audition to outputs 3–4: there and nowhere else, past its bus
    rig.cmd(json!({ "op": "bus", "name": "effects", "db": -60 }));
    rig.cmd(json!({ "op": "play", "key": "v", "file": "/d.wav", "own": { "audition": 3 } }));
    let out = rig.render(10);
    assert_eq!(&out[36..40], &[0.0, 0.0, 0.5, 0.5]);
}

#[test]
fn what_it_cannot_do_yet_it_says_once_and_plays_without() {
    let mut rig = Rig::new(2);
    rig.insert("/d.wav", dc(48000, 2, 0.5));
    let play = json!({ "op": "play", "key": "d", "file": "/d.wav", "own": { "chain": { "reverb": { "mix": 0.3 } } }, "automation": { "chain.lowpass.hz": [[0, 300]] } });
    rig.cmd(play.clone());
    rig.cmd(play);
    rig.cmd(json!({ "op": "strips", "list": [] }));
    let said = rig.said();
    let errs = of(&said, "operror");
    let ops: Vec<&str> = errs.iter().map(|e| e["op"].as_str().unwrap()).collect();
    assert_eq!(ops, ["design", "automation", "strips"], "{errs:?}");
    assert!(errs.iter().all(|e| e["detail"].as_str().unwrap().starts_with("not in the native engine yet")));
    // (the first play of the key, replaced, goes over its 2 ms; the two together met the limiter, which lets go
    // over 150 ms)
    assert_eq!(rig.left(24000)[23999], 0.5, "and the sound plays");
}

#[test]
fn level_and_where() {
    let mut rig = Rig::new(2);
    rig.insert("/d.wav", dc(48000, 2, 0.5));
    rig.cmd(json!({ "op": "bus", "name": "music", "db": 0 }));
    rig.cmd(json!({ "op": "play", "key": "d", "file": "/d.wav", "bus": "music" }));
    rig.left(4800);
    rig.control.level();
    rig.cmd(json!({ "op": "where", "keys": ["d", "nobody"] }));
    let said = rig.said();
    let lv = of(&said, "level")[0];
    assert_eq!(lv["voices"], 1);
    assert_eq!(lv["cues"]["d"], -6);
    assert_eq!(lv["buses"]["music"], -6.0);
    assert_eq!(lv["channels"][0]["peak"], -6.0);
    assert_eq!(lv["channels"][1]["rms"], -6.0);
    assert_eq!(lv["outs"][0], -6.0);
    assert_eq!(lv["limiting"], false);
    let w = of(&said, "where");
    assert_eq!(w.len(), 1);
    // where it was at the start of the last block (the renderer's blocks are 512)
    let t = w[0]["t"].as_f64().unwrap();
    assert!((t - (4800 - 4800 % 512) as f64 / SR).abs() < 1e-9, "{t}");
}
