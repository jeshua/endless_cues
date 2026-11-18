//! `ec-audio`: the native audio engine, a program the app starts beside itself.
//!
//!   ec-audio [--silent] [--outs N] [--device NAME] [--buffer FRAMES] [--capture FILE.wav]
//!       Reads the audio window's commands on standard input, one JSON object a line, and writes its events on
//!       standard output; logs on standard error. `--silent`: no device at all (a test run), the mixer kept in
//!       time by a clock of its own, with `--outs` outputs pretended (2 if not said). `--capture` (a test's, off
//!       unless given): every buffer handed to the device written to FILE.wav, each buffer's moment to
//!       FILE.blocks.csv and each command as it was taken to FILE.cmds.jsonl (capture.rs).
//!   ec-audio measure [--clicks N] [--db DB] [--device NAME] [--buffer FRAMES] [--loopback INPUT]
//!       How long from a GO to the sound leaving the device: see measure.rs.
//!   ec-audio listen --input NAME [--db DB] [--record FILE.wav]
//!       An input listened to for clicks, and recorded if asked (a test's: another program measured through a
//!       loopback). See measure.rs.

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
    if args.first().map(String::as_str) == Some("listen") {
        std::process::exit(ec_audio::measure::listen_run(&args[1..]));
    }
    std::process::exit(run(&args));
}

fn run(args: &[String]) -> i32 {
    let silent = args.iter().any(|a| a == "--silent");
    let outs: usize = arg(args, "--outs").and_then(|s| s.parse().ok()).unwrap_or(2).clamp(1, 64);
    let buffer: u32 = arg(args, "--buffer").and_then(|s| s.parse().ok()).unwrap_or(256);
    let meters = Arc::new(Meters::default());
    let mut capture = None;
    let mut cmd_log = None;
    if let Some(path) = arg(args, "--capture") {
        let path = std::path::PathBuf::from(path);
        match ec_audio::capture::start(&path) {
            Ok(c) => capture = Some(c),
            Err(e) => {
                eprintln!("[native] the capture could not be made: {e}");
                return 2;
            }
        }
        cmd_log = std::fs::File::create(ec_audio::capture::beside(&path, "cmds.jsonl")).ok().map(std::io::BufWriter::new);
        eprintln!("[native] capturing to {}", path.display());
    }
    let (cap, mut cap_handle) = match capture {
        Some((c, h)) => (Some(c), Some(h)),
        None => (None, None),
    };
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
        let (mut mixer, ends) = engine(sr, outs, meters);
        mixer.capture = cap;
        run_silent(mixer, SILENT_BLOCK);
        let c = Control::new(sr, outs, ends, ev_tx, in_tx.clone(), Box::new(NoOutput(sr, outs)));
        c.emit(json!({ "type": "outputs", "channels": outs }));
        c
    } else {
        let (mut mixer, ends) = engine(48000.0, 2, meters.clone());
        mixer.capture = cap;
        let out = CpalOut::new(mixer, meters, in_tx.clone(), buffer);
        let mut c = Control::new(48000.0, 2, ends, ev_tx, in_tx.clone(), Box::new(out));
        if let Err(e) = c.open(arg(args, "--device")) {
            eprintln!("[native] no audio device could be opened: {e}");
            return 2;
        }
        eprintln!("[native] playing at {} Hz on {} outputs", c.sr, c.channels);
        // (a device plugged in or taken out, or the system's default moved: said, as the audio window says it)
        #[cfg(target_os = "macos")]
        {
            let tx = in_tx.clone();
            ec_audio::mac::watch(move |default_moved| {
                let _ = tx.send(In::DevicesChanged(default_moved));
            });
        }
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
            Ok(In::Line(l)) => {
                let ns = ec_audio::shared::now_ns();
                control.line(&l);
                // (written after the command is carried out, so the capture's own writing never delays it)
                if let Some(f) = &mut cmd_log {
                    let _ = writeln!(f, "{}", json!({ "ns": ns, "line": l }));
                    let _ = f.flush();
                }
            }
            Ok(In::Decoded { file, path, result, quiet }) => control.decoded(file, path, result, quiet),
            Ok(In::Events(list)) => list.into_iter().for_each(|e| control.emit(e)),
            Ok(In::StreamFailed { id, key, detail }) => control.stream_failed(id, key, detail),
            Ok(In::DeviceError(e)) => control.device_error(e),
            Ok(In::DevicesChanged(default_moved)) => control.devices_changed(default_moved),
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
    if let Some(h) = &mut cap_handle {
        h.finish();
    }
    let _ = writer.join();
    0
}
