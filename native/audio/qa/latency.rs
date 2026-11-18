//! `qa latency`: `ec-audio measure` on each device at 256, 128 and 64 frames: BlackHole with its loopback (the
//! round trip found in the recorded input), RØDE Connect Virtual, and the speakers at −40 dB (fewer clicks).

use crate::common::*;
use serde_json::{json, Value};

pub fn run(args: &[String]) -> Value {
    let clicks = crate::arg(args, "--clicks").unwrap_or("200").to_string();
    the_show_is_not_running();
    let mut out = Vec::new();
    for buffer in ["256", "128", "64"] {
        for (dev, loopback, db, n) in
            [(BLACKHOLE, true, "-20", clicks.as_str()), (RODE, false, "-20", clicks.as_str()), (SPEAKERS, false, "-40", "60")]
        {
            let mut a = vec!["measure", "--device", dev, "--buffer", buffer, "--clicks", n, "--db", db];
            if loopback {
                a.extend(["--loopback", dev]);
            }
            let o = std::process::Command::new(binary()).args(&a).output().unwrap();
            let v: Value = serde_json::from_slice(&o.stdout).unwrap_or(Value::Null);
            let log = String::from_utf8_lossy(&o.stderr).lines().filter(|l| l.contains("latency")).collect::<Vec<_>>().join(" ");
            eprintln!("{dev} @ {buffer}: {}", v["go_to_output_ms"]);
            out.push(json!({ "device": dev, "buffer": buffer, "result": v, "log": log }));
        }
    }
    json!(out)
}
