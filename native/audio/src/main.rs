//! `ec-audio`: the native audio engine, a program the app starts beside itself.
//!
//!   ec-audio [--silent] [--outs N] [--device NAME] [--buffer FRAMES]
//!       Reads the audio window's commands on standard input, one JSON object a line, and writes its events on
//!       standard output; logs on standard error. `--silent`: no device at all (a test run), the mixer kept in
//!       time by a clock of its own, with `--outs` outputs pretended (2 if not said).
//!   ec-audio measure [--clicks N] [--db DB] [--device NAME] [--buffer FRAMES] [--loopback INPUT]
//!       How long from a GO to the sound leaving the device: see measure.rs.

use crossbeam_channel::{unbounded, RecvTimeoutError};
use ec_audio::control::{Control, In, NoOutput, SILENT_BLOCK};
use ec_audio::device::{engine, run_silent, CpalOut};
use ec_audio::shared::{epoch, Meters};
use serde_json::json;
use std::io::{BufRead, Write};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// The value after a flag (`--outs 8`).
pub fn arg<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(String::as_str)
}

fn main() {
    epoch();
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("measure") {
        std::process::exit(ec_audio::measure::run(&args[1..]));
    }
    std::process::exit(run(&args));
}

fn run(args: &[String]) -> i32 {
    let silent = args.iter().any(|a| a == "--silent");
    let outs: usize = arg(args, "--outs").and_then(|s| s.parse().ok()).unwrap_or(2).clamp(1, 64);
    let buffer: u32 = arg(args, "--buffer").and_then(|s| s.parse().ok()).unwrap_or(256);
    let meters = Arc::new(Meters::default());
    let (in_tx, in_rx) = unbounded::<In>();
    let (ev_tx, ev_rx) = unbounded::<String>();

    // the events, one a line, each written out as soon as it is said
    let writer = std::thread::Builder::new()
        .name("ec-events".into())
        .spawn(move || {
            let out = std::io::stdout();
            for line in ev_rx {
                let mut o = out.lock();
                if o.write_all(line.as_bytes()).and_then(|_| o.write_all(b"\n")).and_then(|_| o.flush()).is_err() {
                    break;
                }
            }
        })
        .expect("the events thread");

    let mut control = if silent {
        let sr = 48000.0;
        let (mixer, ends) = engine(sr, outs, meters);
        run_silent(mixer, SILENT_BLOCK);
        let c = Control::new(sr, outs, ends, ev_tx, in_tx.clone(), Box::new(NoOutput(sr, outs)));
        c.emit(json!({ "type": "outputs", "channels": outs }));
        c
    } else {
        let (mixer, ends) = engine(48000.0, 2, meters.clone());
        let out = CpalOut::new(mixer, meters, in_tx.clone(), buffer);
        let mut c = Control::new(48000.0, 2, ends, ev_tx, in_tx.clone(), Box::new(out));
        if let Err(e) = c.open(arg(args, "--device")) {
            eprintln!("[native] no audio device could be opened: {e}");
            return 2;
        }
        eprintln!("[native] playing at {} Hz on {} outputs", c.sr, c.channels);
        c
    };
    control.emit(json!({ "type": "ready" }));

    // the host's commands
    let lines = in_tx.clone();
    std::thread::Builder::new()
        .name("ec-commands".into())
        .spawn(move || {
            for line in std::io::stdin().lock().lines() {
                match line {
                    Ok(l) => {
                        if lines.send(In::Line(l)).is_err() {
                            return;
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = lines.send(In::Quit);
        })
        .expect("the commands thread");
    drop(in_tx);

    let mut last_level = Instant::now();
    loop {
        match in_rx.recv_timeout(Duration::from_millis(4)) {
            Ok(In::Line(l)) => control.line(&l),
            Ok(In::Decoded { file, path, result, quiet }) => control.decoded(file, path, result, quiet),
            Ok(In::Events(list)) => list.into_iter().for_each(|e| control.emit(e)),
            Ok(In::StreamFailed { id, key, detail }) => control.stream_failed(id, key, detail),
            Ok(In::DeviceError(e)) => control.device_error(e),
            Ok(In::Quit) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
        control.poll();
        if last_level.elapsed() >= Duration::from_millis(33) {
            last_level = Instant::now();
            control.level();
        }
    }
    drop(control);
    let _ = writer.join();
    0
}
