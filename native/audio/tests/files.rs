//! Sound files of every kind the engine may be given, and files that are not sound: each plays at the right
//! length and level, decoded and streamed, or is refused with a clear `error` / `missing`; none crashes or hangs.
//! (MP3, Ogg, FLAC, M4A, AIFF and CAF are made with afconvert or ffmpeg where this computer has them.)

mod common;
use common::*;
use ec_audio::pcm;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

fn dir() -> PathBuf {
    let d = std::env::temp_dir().join(format!("ec-audio-files-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// A WAV of a 440 Hz tone at `amp`, `bits` 16, 24 or 32 (float), with the tone on every channel.
fn wav_of(path: &Path, secs: f64, sr: u32, ch: u16, bits: u16, amp: f64) {
    let n = (secs * sr as f64) as usize;
    let bps = bits as usize / 8;
    let data = n * ch as usize * bps;
    let mut b = Vec::with_capacity(data + 44);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data as u32).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&(if bits == 32 { 3u16 } else { 1u16 }).to_le_bytes());
    b.extend_from_slice(&ch.to_le_bytes());
    b.extend_from_slice(&sr.to_le_bytes());
    b.extend_from_slice(&(sr * (ch as usize * bps) as u32).to_le_bytes());
    b.extend_from_slice(&((ch as usize * bps) as u16).to_le_bytes());
    b.extend_from_slice(&bits.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&(data as u32).to_le_bytes());
    for i in 0..n {
        let x = amp * (std::f64::consts::TAU * 440.0 * i as f64 / sr as f64).sin();
        for _ in 0..ch {
            match bits {
                16 => b.extend_from_slice(&((x * 32767.0) as i16).to_le_bytes()),
                24 => b.extend_from_slice(&((x * 8_388_607.0) as i32).to_le_bytes()[..3]),
                _ => b.extend_from_slice(&(x as f32).to_le_bytes()),
            }
        }
    }
    std::fs::write(path, b).unwrap();
}

fn peak(d: &[f32]) -> f32 {
    d.iter().fold(0f32, |m, x| m.max(x.abs()))
}

/// Played by the engine streamed, then decoded: its loudest sample on output 1, and that it ended.
fn plays(path: &Path) -> (f32, f32) {
    let file = path.to_str().unwrap().to_string();
    let mut rig = Rig::new(2);
    rig.cmd(json!({ "op": "play", "key": "s", "file": file }));
    let mut streamed = 0f32;
    let mut ended = false;
    for _ in 0..400 {
        streamed = streamed.max(peak(&rig.left(4800)));
        if !of(&rig.said(), "ended").is_empty() {
            ended = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(ended, "{file}: the stream ended");
    rig.cmd(json!({ "op": "decode", "file": file }));
    let said = rig.said();
    assert!(of(&said, "decoded")[0]["error"].is_null(), "{file}: {said:?}");
    rig.cmd(json!({ "op": "play", "key": "d", "file": file }));
    let decoded = peak(&rig.left(48000 * 2));
    (streamed, decoded)
}

#[test]
fn wav_of_every_depth_rate_and_width() {
    let d = dir();
    for bits in [16u16, 24, 32] {
        for sr in [44100u32, 48000, 96000] {
            for ch in [1u16, 2, 6] {
                let p = d.join(format!("t-{bits}-{sr}-{ch}.wav"));
                wav_of(&p, 0.5, sr, ch, bits, 0.25);
                let secs = pcm::probe(&p).unwrap();
                assert!((secs - 0.5).abs() < 0.001, "{}: {secs}", p.display());
                let x = pcm::decode(&p, 48000).unwrap();
                assert_eq!(x.channels, ch as usize);
                assert_eq!(x.frames, 24000, "{}: resampled to the device's rate, its length kept", p.display());
                let (s, dec) = plays(&p);
                // (six channels are folded to two by Web Audio's rules: the front left with the centre and the
                // left surround at −3 dB each, the tone being on all of them)
                let want = if ch == 6 { 0.25 * (1.0 + 2.0 * std::f32::consts::FRAC_1_SQRT_2) } else { 0.25 };
                assert!((s - want).abs() < 0.02 && (dec - want).abs() < 0.02, "{}: streamed {s}, decoded {dec}, want {want}", p.display());
            }
        }
    }
}

/// A converter on this computer: afconvert (macOS) or ffmpeg. None: the format is passed over.
fn convert(src: &Path, out: &Path, how: &[&str], tool: &str) -> bool {
    let mut cmd = Command::new(tool);
    if tool == "afconvert" {
        cmd.args(how).arg(src).arg(out);
    } else {
        cmd.args(["-y", "-loglevel", "error", "-i"]).arg(src).args(how).arg(out);
    }
    matches!(cmd.output(), Ok(o) if o.status.success()) && out.exists()
}

#[test]
fn compressed_and_other_containers() {
    let d = dir();
    let src = d.join("src.wav");
    wav_of(&src, 1.0, 44100, 2, 16, 0.25);
    let kinds: [(&str, &str, &[&str]); 8] = [
        ("m4a", "afconvert", &["-f", "m4af", "-d", "aac"]),
        ("alac.m4a", "afconvert", &["-f", "m4af", "-d", "alac"]),
        ("flac", "afconvert", &["-f", "flac", "-d", "flac"]),
        ("aif", "afconvert", &["-f", "AIFF", "-d", "BEI16"]),
        ("caf", "afconvert", &["-f", "caff", "-d", "LEI24"]),
        ("mp3", "ffmpeg", &["-c:a", "libmp3lame", "-b:a", "192k"]),
        ("ogg", "ffmpeg", &["-c:a", "vorbis", "-strict", "-2", "-ac", "2"]),
        ("opus.ogg", "ffmpeg", &["-c:a", "libopus"]),
    ];
    let mut tried = Vec::new();
    for (ext, tool, how) in kinds {
        let out = d.join(format!("c.{ext}"));
        if !convert(&src, &out, how, tool) {
            eprintln!("(no {tool} for .{ext}: passed over)");
            continue;
        }
        tried.push(ext);
        if ext == "opus.ogg" {
            // (symphonia has no Opus decoder: refused, clearly, and the host is told)
            let mut rig = Rig::new(2);
            rig.cmd(json!({ "op": "play", "key": "o", "file": out.to_str().unwrap() }));
            let mut said = rig.said();
            for _ in 0..100 {
                if !of(&said, "error").is_empty() {
                    break;
                }
                rig.left(480);
                std::thread::sleep(Duration::from_millis(5));
                said.extend(rig.said());
            }
            let e = of(&said, "error");
            assert_eq!(e.len(), 1, "an Opus file is refused: {said:?}");
            continue;
        }
        let secs = pcm::probe(&out).unwrap_or_else(|e| panic!(".{ext}: {e}"));
        assert!((secs - 1.0).abs() < 0.03, ".{ext}: {secs} s");
        // the sound starts where the file's does: no encoder's priming before it (AAC's 2112 frames were 48 ms of
        // silence before every GO, and every place in the file 48 ms late)
        let x = pcm::decode(&out, 44100).unwrap();
        let first = x.data.iter().position(|v| v.abs() > 0.01).unwrap() / x.channels;
        eprintln!(".{ext}: {secs:.4} s, {} frames, the sound from frame {first}", x.frames);
        let lossy = matches!(ext, "m4a" | "mp3" | "ogg");
        assert!(first <= if lossy { 8 } else { 1 }, ".{ext}: the sound starts {first} frames in");
        if ext != "ogg" {
            assert!(x.frames.abs_diff(44100) <= if lossy { 1200 } else { 0 }, ".{ext}: {} frames", x.frames);
        }
        let (s, dec) = plays(&out);
        assert!((s - 0.25).abs() < 0.03 && (dec - 0.25).abs() < 0.03, ".{ext}: streamed {s}, decoded {dec}");
    }
    eprintln!("formats tried: {tried:?}");
}

#[test]
fn what_is_not_a_sound_is_refused_clearly() {
    let d = dir();
    let good = d.join("good.wav");
    wav_of(&good, 1.0, 48000, 2, 16, 0.25);
    let bytes = std::fs::read(&good).unwrap();
    let truncated = d.join("truncated.wav");
    std::fs::write(&truncated, &bytes[..bytes.len() / 2]).unwrap();
    let header_only = d.join("header-only.wav");
    std::fs::write(&header_only, &bytes[..44]).unwrap();
    let empty = d.join("empty.wav");
    std::fs::write(&empty, b"").unwrap();
    let text = d.join("text.wav");
    std::fs::write(&text, b"this is not a sound, it only says it is\n").unwrap();
    let missing = d.join("missing.wav");
    let s = |p: &Path| p.to_str().unwrap().to_string();

    // a truncated file plays what there is, to its end
    let secs = pcm::decode(&truncated, 48000).unwrap().secs();
    assert!((secs - 0.5).abs() < 0.01, "{secs}");
    let (st, dec) = plays(&truncated);
    assert!(st > 0.2 && dec > 0.2);

    let mut rig = Rig::new(2);
    let files: Vec<_> = [s(&truncated), s(&header_only), s(&empty), s(&text), s(&missing)].iter().map(|f| json!({ "file": f })).collect();
    rig.cmd(json!({ "op": "probe", "files": files }));
    let said = rig.said();
    let missing_said: Vec<&str> = of(&said, "missing").iter().map(|e| e["file"].as_str().unwrap()).collect();
    for p in [&empty, &text, &missing] {
        assert!(missing_said.contains(&s(p).as_str()), "{} is said to be missing (not a sound): {said:?}", p.display());
    }
    for (k, p) in [&header_only, &empty, &text, &missing].iter().enumerate() {
        let key = format!("k{k}");
        rig.cmd(json!({ "op": "play", "key": key, "file": s(p) }));
        rig.cmd(json!({ "op": "decode", "file": s(p) }));
        let mut said = rig.said();
        for _ in 0..100 {
            if !of(&said, "error").is_empty() || !of(&said, "ended").is_empty() {
                break;
            }
            rig.left(480);
            std::thread::sleep(Duration::from_millis(5));
            said.extend(rig.said());
        }
        let errs = of(&said, "error");
        let ended = of(&said, "ended");
        assert!(errs.len() + ended.len() == 1, "{}: one error, or (a header and nothing after it) one end: {said:?}", p.display());
        if let Some(e) = errs.first() {
            assert_eq!(e["key"], key);
            assert!(!e["detail"].as_str().unwrap_or("").is_empty(), "with a reason: {e}");
        }
        let dec = of(&said, "decoded");
        assert!(dec.is_empty() || dec[0]["error"].is_string() || dec[0]["secs"] == 0, "{}: {said:?}", p.display());
    }
    assert_eq!(rig.control.playing(), 0);
}

#[test]
fn a_file_too_long_to_hold_is_not_decoded_but_streams() {
    // two hours at 8 kHz mono (115 MB on disk): decoded at 48 kHz it would be 1.4 GB
    let p = dir().join("two-hours.wav");
    {
        use std::io::Write;
        let n: u32 = 8000 * 7200;
        let mut f = std::io::BufWriter::new(std::fs::File::create(&p).unwrap());
        let mut h = Vec::new();
        h.extend_from_slice(b"RIFF");
        h.extend_from_slice(&(36 + n * 2).to_le_bytes());
        h.extend_from_slice(b"WAVEfmt ");
        h.extend_from_slice(&16u32.to_le_bytes());
        h.extend_from_slice(&1u16.to_le_bytes());
        h.extend_from_slice(&1u16.to_le_bytes());
        h.extend_from_slice(&8000u32.to_le_bytes());
        h.extend_from_slice(&16000u32.to_le_bytes());
        h.extend_from_slice(&2u16.to_le_bytes());
        h.extend_from_slice(&16u16.to_le_bytes());
        h.extend_from_slice(b"data");
        h.extend_from_slice(&(n * 2).to_le_bytes());
        f.write_all(&h).unwrap();
        let block: Vec<u8> =
            (0..8000).flat_map(|i| (((i as f64 / 8000.0 * 440.0 * std::f64::consts::TAU).sin() * 8000.0) as i16).to_le_bytes()).collect();
        for _ in 0..7200 {
            f.write_all(&block).unwrap();
        }
    }
    let file = p.to_str().unwrap().to_string();
    assert!((pcm::probe(&p).unwrap() - 7200.0).abs() < 0.01, "its length from its header, at once");
    let mut rig = Rig::new(2);
    rig.cmd(json!({ "op": "decode", "file": file }));
    let said = rig.said();
    let d = of(&said, "decoded");
    assert!(d[0]["error"].as_str().is_some_and(|e| e.contains("too long")), "refused, with the reason: {said:?}");
    // it streams, from near its end
    rig.cmd(json!({ "op": "play", "key": "long", "file": file, "from": 7190.0 }));
    let mut heard = 0f32;
    for _ in 0..200 {
        heard = heard.max(peak(&rig.left(4800)));
        if heard > 0.2 {
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(heard > 0.2, "{heard}");
    let _ = std::fs::remove_file(&p);
}
