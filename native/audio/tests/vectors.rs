//! The arithmetic held to the TypeScript's answers: tests/vectors.json is what core/audio/curves.ts and
//! core/audio/lanes.ts give (written by `npm run native:vectors`), read here both by the functions alone and as the
//! mixer plays them.

mod common;
use common::*;
use ec_audio::arith::{self, Shape};
use serde_json::{json, Value};

const TOL: f64 = 1e-6;

fn vectors() -> Value {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/vectors.json");
    serde_json::from_str(&std::fs::read_to_string(p).expect("tests/vectors.json (npm run native:vectors)")).unwrap()
}
fn nums(v: &Value) -> Vec<f64> {
    v.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()
}
fn points(v: &Value) -> Vec<arith::Point> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|p| {
            let p = nums(p);
            [p[0], p[1], p.get(2).copied().unwrap_or(0.0)]
        })
        .collect()
}
fn close(a: f64, b: f64, what: &str) {
    assert!((a - b).abs() <= TOL, "{what}: {a} (Rust) vs {b} (TypeScript)");
}

#[test]
fn shapes_bends_envelopes_pans_and_wraps_equal_the_typescript() {
    let v = vectors();
    for s in v["shapeAt"].as_array().unwrap() {
        let pts: Vec<[f64; 2]> = s["shape"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|p| {
                        let p = nums(p);
                        [p[0], p[1]]
                    })
                    .collect()
            })
            .unwrap_or_default();
        let shape = match s["shape"].as_str() {
            Some("s-curve") => Shape::SCurve,
            Some(_) => Shape::Linear,
            None => Shape::Points(&pts),
        };
        for (x, y) in nums(&s["xs"]).iter().zip(nums(&s["ys"])) {
            close(arith::shape_at(&shape, *x), y, &format!("shapeAt {} {x}", s["name"]));
        }
    }
    for f in v["fades"].as_array().unwrap() {
        let p = nums(&f["progress"]);
        for (x, g) in nums(&f["xs"]).iter().zip(nums(&f["gains"])) {
            close(arith::to_lin(-30.0 * arith::along(&p, *x)), g, &format!("fade {} {x}", f["name"]));
        }
    }
    for b in v["bend"].as_array().unwrap() {
        let c = b["c"].as_f64().unwrap();
        for (x, y) in nums(&b["xs"]).iter().zip(nums(&b["ys"])) {
            close(arith::bend(*x, c), y, &format!("bend {c} {x}"));
        }
    }
    for e in v["envelopeAt"].as_array().unwrap() {
        let pts = points(&e["pts"]);
        for ((t, db), g) in nums(&e["ts"]).iter().zip(nums(&e["dbs"])).zip(nums(&e["gains"])) {
            close(arith::envelope_at(&pts, *t), db, &format!("envelopeAt {} {t}", e["name"]));
            close(arith::to_lin(arith::envelope_at(&pts, *t)), g, &format!("envelope gain {} {t}", e["name"]));
        }
    }
    for p in v["panLine"].as_array().unwrap() {
        let pts = points(&p["pts"]);
        for ((t, val), g) in nums(&p["ts"]).iter().zip(nums(&p["values"])).zip(p["gains"].as_array().unwrap()) {
            let got = arith::value_at(&pts, *t).unwrap();
            close(got, val, &format!("pan line {} {t}", p["name"]));
            let (l, r) = arith::pan_gains(got);
            close(l, g[0].as_f64().unwrap(), "pan line left");
            close(r, g[1].as_f64().unwrap(), "pan line right");
        }
    }
    for p in v["panGains"].as_array().unwrap() {
        let (l, r) = arith::pan_gains(p["pan"].as_f64().unwrap());
        close(l, p["gains"][0].as_f64().unwrap(), &format!("panGains {}", p["pan"]));
        close(r, p["gains"][1].as_f64().unwrap(), &format!("panGains {}", p["pan"]));
    }
    for w in v["wrap"].as_array().unwrap() {
        let region = w["region"].as_object().map(|g| (g["start"].as_f64().unwrap(), g["end"].as_f64().unwrap()));
        close(arith::wrap(w["u"].as_f64().unwrap(), region, w["whole"].as_f64().unwrap()), w["value"].as_f64().unwrap(), "wrap");
    }
}

#[test]
fn the_mixer_plays_the_envelope_and_the_pan_line_as_the_typescript_reads_them() {
    let v = vectors();
    for e in v["envelopeAt"].as_array().unwrap() {
        let mut rig = Rig::new(2);
        rig.insert("/d.wav", dc(48000 * 3, 2, 0.1));
        rig.cmd(json!({ "op": "play", "key": "d", "file": "/d.wav", "envelope": e["pts"] }));
        let out = rig.left(48000 * 3);
        for (t, g) in nums(&e["ts"]).iter().zip(nums(&e["gains"])) {
            let k = (t * SR).round() as usize;
            close(out[k] as f64, 0.1 * g, &format!("envelope {} at {t} s", e["name"]));
        }
    }
    for p in v["panLine"].as_array().unwrap() {
        let mut rig = Rig::new(2);
        rig.insert("/d.wav", dc(48000 * 3, 2, 0.1));
        rig.cmd(json!({ "op": "play", "key": "d", "file": "/d.wav", "automation": { "pan": p["pts"] } }));
        let out = rig.render(48000 * 3);
        for (t, g) in nums(&p["ts"]).iter().zip(p["gains"].as_array().unwrap()) {
            let k = (t * SR).round() as usize;
            close(out[2 * k] as f64, 0.1 * g[0].as_f64().unwrap(), &format!("pan {} left at {t}", p["name"]));
            close(out[2 * k + 1] as f64, 0.1 * g[1].as_f64().unwrap(), &format!("pan {} right at {t}", p["name"]));
        }
    }
    // the Pan field alone, and a mono sound panned (on both sides first, as Web Audio's speakers rule does)
    for p in v["panGains"].as_array().unwrap() {
        let mut rig = Rig::new(2);
        rig.insert("/m.wav", dc(4800, 1, 0.1));
        rig.cmd(json!({ "op": "play", "key": "m", "file": "/m.wav", "pan": p["pan"] }));
        let out = rig.render(10);
        close(out[18] as f64, 0.1 * p["gains"][0].as_f64().unwrap(), &format!("pan {} left", p["pan"]));
        close(out[19] as f64, 0.1 * p["gains"][1].as_f64().unwrap(), &format!("pan {} right", p["pan"]));
    }
}

#[test]
fn the_mixer_plays_a_fade_of_each_shape_as_the_typescript_reads_it() {
    let v = vectors();
    for f in v["fades"].as_array().unwrap() {
        let mut rig = Rig::new(2);
        rig.insert("/d.wav", dc(48000 * 2, 2, 0.5));
        rig.cmd(json!({ "op": "play", "key": "d", "file": "/d.wav" }));
        rig.cmd(json!({ "op": "fade", "key": "d", "db": -30, "secs": 1, "shape": f["progress"] }));
        let out = rig.left(48000);
        for (x, g) in nums(&f["xs"]).iter().zip(nums(&f["gains"])) {
            if *x == 0.0 {
                continue;
            }
            // (frame k has had k + 1 steps of the fade: it is x = (k + 1) / n of the way)
            let k = (x * SR).round() as usize - 1;
            close(out[k] as f64, 0.5 * g, &format!("fade {} at {x}", f["name"]));
        }
    }
}
