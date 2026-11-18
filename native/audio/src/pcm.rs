//! Sound files: opened and decoded with symphonia (WAV, AIFF, CAF, MP3, FLAC, Ogg Vorbis, AAC and ALAC in MP4/M4A),
//! and resampled to the device's rate with rubato, off the audio thread.

use rubato::{FftFixedIn, Resampler};
use std::fs::File;
use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

/// A decoded sound: interleaved samples at `sr`.
#[derive(Debug, Clone)]
pub struct Pcm {
    pub sr: u32,
    pub channels: usize,
    pub frames: usize,
    pub data: Vec<f32>,
}

impl Pcm {
    pub fn new(sr: u32, channels: usize, data: Vec<f32>) -> Self {
        let channels = channels.max(1);
        Pcm { sr, channels, frames: data.len() / channels, data }
    }
    pub fn secs(&self) -> f64 {
        self.frames as f64 / self.sr as f64
    }
}

/// An open file: its reader, its decoder, and what it says of itself.
pub struct Source {
    pub format: Box<dyn FormatReader>,
    pub decoder: Box<dyn Decoder>,
    pub track: u32,
    pub sr: u32,
    pub frames: Option<u64>,
    /// an encoder's own silence to leave out: frames at the start (AAC's priming), and how many there are after
    /// them (the rest is its padding). Symphonia reads these from an MP3's LAME header itself; an M4A says them in
    /// its iTunSMPB tag, which symphonia leaves to its reader (`smpb`).
    pub trim: Option<(u64, u64)>,
}

/// An iTunSMPB tag (" 00000000 00000840 0000037C 000000000000AC44 …", hexadecimal): the frames of priming at the
/// start, and the frames of sound after them.
pub fn smpb(text: &str) -> Option<(u64, u64)> {
    let f: Vec<u64> = text.split_whitespace().take(4).map(|x| u64::from_str_radix(x, 16)).collect::<Result<_, _>>().ok()?;
    (f.len() == 4 && f[3] > 0).then(|| (f[1], f[3]))
}

pub fn open(path: &Path) -> Result<Source, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions { enable_gapless: true, ..Default::default() }, &MetadataOptions::default())
        .map_err(|e| format!("not a sound this can read: {e}"))?;
    let mut probed_meta = probed.metadata;
    let mut format = probed.format;
    let track = format.tracks().iter().find(|t| t.codec_params.codec != CODEC_TYPE_NULL).ok_or("no sound in the file")?;
    let params = track.codec_params.clone();
    let track_id = track.id;
    let decoder =
        symphonia::default::get_codecs().make(&params, &DecoderOptions::default()).map_err(|e| format!("no decoder for it: {e}"))?;
    // (an M4A's priming and padding, where symphonia has not trimmed them itself)
    let mut trim = None;
    if params.delay.is_none() {
        let find = |tags: &[symphonia::core::meta::Tag]| {
            tags.iter().find(|t| t.key.ends_with("iTunSMPB")).and_then(|t| smpb(&t.value.to_string()))
        };
        trim = format.metadata().current().and_then(|m| find(m.tags()));
        if trim.is_none() {
            trim = probed_meta.get().and_then(|m| m.current().and_then(|r| find(r.tags())));
        }
    }
    let frames = match trim {
        Some((_, n)) => Some(n),
        None => params.n_frames,
    };
    Ok(Source { track: track_id, sr: params.sample_rate.unwrap_or(0), frames, format, decoder, trim })
}

/// What one packet decoded to.
pub enum Step {
    /// interleaved samples, their channel count, and the frame of the file the first one is
    Samples(Vec<f32>, usize, u64),
    End,
}

impl Source {
    /// The next packet of sound, decoded (a packet that will not decode is passed over, as players do).
    pub fn packet(&mut self) -> Result<Step, String> {
        loop {
            let packet = match self.format.next_packet() {
                Ok(p) => p,
                Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(Step::End),
                Err(SymError::ResetRequired) => return Ok(Step::End),
                Err(e) => return Err(e.to_string()),
            };
            if packet.track_id() != self.track {
                continue;
            }
            match self.decoder.decode(&packet) {
                Ok(buf) => {
                    let spec = *buf.spec();
                    if self.sr == 0 {
                        self.sr = spec.rate;
                    }
                    let ch = spec.channels.count().max(1);
                    let mut sb = SampleBuffer::<f32>::new(buf.capacity() as u64, spec);
                    sb.copy_interleaved_ref(buf);
                    let s = sb.samples();
                    let Some((delay, len)) = self.trim else { return Ok(Step::Samples(s.to_vec(), ch, packet.ts())) };
                    // the packet's frames on the trimmed timeline: the priming before 0 and the padding after the
                    // sound left out
                    let ts = packet.ts() as i64 - delay as i64;
                    let n = (s.len() / ch) as i64;
                    let a = (-ts).clamp(0, n);
                    let b = (len as i64 - ts).clamp(a, n);
                    if b <= a {
                        if ts >= len as i64 {
                            return Ok(Step::End);
                        }
                        continue;
                    }
                    return Ok(Step::Samples(s[a as usize * ch..b as usize * ch].to_vec(), ch, (ts + a) as u64));
                }
                Err(SymError::DecodeError(_)) => continue,
                Err(e) => return Err(e.to_string()),
            }
        }
    }
    /// To `secs` into the file; returns the frame it landed on (the first sample decoded after may be before it).
    pub fn seek(&mut self, secs: f64) -> Result<u64, String> {
        let delay = self.trim.map_or(0, |t| t.0);
        let lead = if self.sr > 0 { delay as f64 / self.sr as f64 } else { 0.0 };
        let to = self
            .format
            .seek(SeekMode::Accurate, SeekTo::Time { time: Time::from(secs.max(0.0) + lead), track_id: Some(self.track) })
            .map_err(|e| e.to_string())?;
        self.decoder.reset();
        Ok(to.required_ts.saturating_sub(delay))
    }
}

/// A file's length in seconds, from its header where it says, else by reading it through.
pub fn probe(path: &Path) -> Result<f64, String> {
    let mut src = open(path)?;
    if let (Some(n), true) = (src.frames, src.sr > 0) {
        return Ok(n as f64 / src.sr as f64);
    }
    let mut frames = 0u64;
    while let Step::Samples(s, ch, _) = src.packet()? {
        frames += (s.len() / ch) as u64;
    }
    if src.sr == 0 {
        return Err("no sample rate".into());
    }
    Ok(frames as f64 / src.sr as f64)
}

/// The most samples a decoded sound may hold (a gigabyte: 46 minutes of stereo at 48 kHz). A longer file is not
/// decoded (the host is told why) and streams, as any sound not decoded does.
pub const MAX_DECODED: usize = 1 << 28;

fn too_long(secs: f64) -> String {
    format!("too long to hold in memory ({:.0} minutes): it streams", secs / 60.0)
}

/// The whole file, decoded and resampled to `sr`.
pub fn decode(path: &Path, sr: u32) -> Result<Pcm, String> {
    let mut src = open(path)?;
    let mut data = Vec::new();
    let mut channels = 0;
    let ch0 = src.decoder.codec_params().channels.map(|c| c.count()).unwrap_or(2).max(1);
    if let (Some(n), true) = (src.frames, src.sr > 0) {
        // (its length from its header, at the device's rate: refused before anything is read)
        let at_sr = n as f64 * sr as f64 / src.sr as f64;
        if at_sr * ch0 as f64 > MAX_DECODED as f64 {
            return Err(too_long(n as f64 / src.sr as f64));
        }
        data.reserve((n as usize).saturating_mul(ch0).min(MAX_DECODED));
    }
    while let Step::Samples(s, ch, _) = src.packet()? {
        channels = ch;
        data.extend_from_slice(&s);
        let rate = src.sr.max(1) as f64;
        if data.len() as f64 * (sr as f64 / rate).max(1.0) > MAX_DECODED as f64 {
            return Err(too_long(data.len() as f64 / ch.max(1) as f64 / rate));
        }
    }
    if channels == 0 || src.sr == 0 {
        return Err("no sound in the file".into());
    }
    let pcm = Pcm::new(src.sr, channels, data);
    Ok(if pcm.sr == sr { pcm } else { resample(&pcm, sr)? })
}

/// Interleaved to one list per channel.
pub fn planar(data: &[f32], ch: usize) -> Vec<Vec<f32>> {
    let n = data.len() / ch;
    (0..ch).map(|c| (0..n).map(|i| data[i * ch + c]).collect()).collect()
}

/// A decoded sound at another rate (rubato's FFT resampler; its delay is taken off, its length kept).
pub fn resample(pcm: &Pcm, sr: u32) -> Result<Pcm, String> {
    let ch = pcm.channels;
    let input = planar(&pcm.data, ch);
    let want = ((pcm.frames as u64 * sr as u64 + pcm.sr as u64 / 2) / pcm.sr as u64) as usize;
    let mut rs = FftFixedIn::<f32>::new(pcm.sr as usize, sr as usize, 1024, 2, ch).map_err(|e| e.to_string())?;
    let delay = rs.output_delay();
    let mut out: Vec<Vec<f32>> = vec![Vec::with_capacity(want + delay + 4096); ch];
    let mut at = 0;
    let add = |out: &mut Vec<Vec<f32>>, o: Vec<Vec<f32>>| {
        for (c, v) in o.into_iter().enumerate() {
            out[c].extend_from_slice(&v);
        }
    };
    while at + rs.input_frames_next() <= pcm.frames {
        let k = rs.input_frames_next();
        let chunk: Vec<&[f32]> = input.iter().map(|c| &c[at..at + k]).collect();
        add(&mut out, rs.process(&chunk, None).map_err(|e| e.to_string())?);
        at += k;
    }
    if at < pcm.frames {
        let chunk: Vec<&[f32]> = input.iter().map(|c| &c[at..]).collect();
        add(&mut out, rs.process_partial(Some(&chunk), None).map_err(|e| e.to_string())?);
    }
    while out[0].len() < delay + want {
        add(&mut out, rs.process_partial::<&[f32]>(None, None).map_err(|e| e.to_string())?);
    }
    let mut data = vec![0f32; want * ch];
    for (c, v) in out.iter().enumerate() {
        for i in 0..want {
            data[i * ch + c] = v[delay + i];
        }
    }
    Ok(Pcm::new(sr, ch, data))
}

/// A path from what the host sends: a path, or a file:// URL (its %-escapes read).
pub fn path_of(s: &str) -> String {
    let Some(rest) = s.strip_prefix("file://") else { return s.to_string() };
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    let bytes = rest.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&rest[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    let p = String::from_utf8_lossy(&out).into_owned();
    // (file:///C:/x on Windows)
    if cfg!(windows) && p.len() > 2 && p.as_bytes()[0] == b'/' && p.as_bytes()[2] == b':' {
        return p[1..].to_string();
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_m4a_says_its_priming_and_length() {
        let t = " 00000000 00000840 0000037C 000000000000AC44 00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000000";
        assert_eq!(smpb(t), Some((2112, 44100)));
        assert_eq!(smpb("nonsense"), None);
    }

    #[test]
    fn a_file_url_is_a_path() {
        assert_eq!(path_of("file:///tmp/a%20b.wav"), "/tmp/a b.wav");
        assert_eq!(path_of("/tmp/x.wav"), "/tmp/x.wav");
    }

    #[test]
    fn resampling_keeps_the_length_and_the_tone() {
        let sr = 44100;
        let data: Vec<f32> = (0..sr).map(|i| (i as f32 / sr as f32 * 440.0 * std::f32::consts::TAU).sin() * 0.5).collect();
        let pcm = Pcm::new(sr as u32, 1, data);
        let out = resample(&pcm, 48000).unwrap();
        assert_eq!(out.frames, 48000);
        // the middle of it is the same tone, at its level
        let peak = out.data[10000..40000].iter().fold(0f32, |m, x| m.max(x.abs()));
        assert!((peak - 0.5).abs() < 0.01, "{peak}");
    }
}
