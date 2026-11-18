//! A sound playing: where it reads from (a decoded buffer or a stream: its `head`), and everything between that
//! and its bus, as the audio window lays it out:
//!
//!   head (and a place being left, crossfading) ─▶ level (the cue's level, every Fade, a cut)
//!       ─▶ [ envelope ] ─▶ [ pan ] ─▶ [ "others" ] ─▶ its bus (or the audition pair)
//!
//! Everything here runs on the audio thread: nothing allocates, nothing is dropped that would free memory (what is
//! finished with goes back to the control thread as `Trash`).

use crate::arith::{envelope_at, pan_gains, to_lin, value_at, Point};
use crate::params::{Glide, Level, Line, SHAPE_MAX};
use crate::pcm::Pcm;
use crate::shared::VoiceShared;
use crate::stream::{Reader, STREAM_CH};
use std::f64::consts::FRAC_PI_2;
use std::sync::atomic::Ordering::Relaxed;
use std::sync::Arc;

/// One frame of a source, up to this many channels.
pub type Frame = [f32; STREAM_CH];

/// Reading a decoded buffer: where it is (frames of the buffer, fractional while the rate is not 1), the loop it
/// holds (frames), and whether it loops the whole file.
pub struct BufHead {
    pub pcm: Arc<Pcm>,
    pub pos: f64,
    pub region: Option<(f64, f64)>,
    pub loop_whole: bool,
}

impl BufHead {
    pub fn new(pcm: Arc<Pcm>, secs: f64, loop_whole: bool) -> Self {
        let last = (pcm.frames as f64 - 1.0).max(0.0);
        let pos = (secs * pcm.sr as f64).round().clamp(0.0, last);
        BufHead { pcm, pos, region: None, loop_whole }
    }
    #[inline]
    fn frame_at(&self, i: usize, out: &mut Frame) {
        let ch = self.pcm.channels.min(STREAM_CH);
        let base = i * self.pcm.channels;
        out[..ch].copy_from_slice(&self.pcm.data[base..base + ch]);
    }
    /// The frame after `i`, as it will be played: round a held loop, round the whole file, or none at the end.
    #[inline]
    fn after(&self, i: usize) -> Option<usize> {
        let j = i + 1;
        if let Some((s, e)) = self.region {
            if j as f64 >= e {
                return Some(s as usize);
            }
        }
        if j < self.pcm.frames {
            Some(j)
        } else if self.loop_whole {
            Some(0)
        } else {
            None
        }
    }
    #[inline]
    fn read(&self, out: &mut Frame) {
        let i = self.pos as usize;
        self.frame_at(i, out);
        let f = (self.pos - i as f64) as f32;
        if f > 0.0 {
            let mut b = [0f32; STREAM_CH];
            if let Some(j) = self.after(i) {
                self.frame_at(j, &mut b);
            }
            for c in 0..self.pcm.channels.min(STREAM_CH) {
                out[c] += (b[c] - out[c]) * f;
            }
        }
    }
    /// On by `step` frames; false when it has played its last.
    #[inline]
    fn advance(&mut self, step: f64) -> bool {
        self.pos += step;
        if let Some((s, e)) = self.region {
            if self.pos >= e {
                self.pos = s + (self.pos - e) % (e - s);
                return true;
            }
        }
        let n = self.pcm.frames as f64;
        if self.pos >= n {
            if self.loop_whole && n > 0.0 {
                self.pos %= n;
            } else {
                return false;
            }
        }
        true
    }
}

/// Reading a stream: two frames to read between (the rate may not be 1), and where it is in its file.
pub struct StreamHead {
    pub r: Reader,
    cur: Frame,
    nxt: Frame,
    phase: f64,
    primed: bool,
    over: bool,
    /// frames into the file at the stream's rate
    pub pos: f64,
}

impl StreamHead {
    pub fn new(r: Reader) -> Self {
        let pos = r.from * r.sr as f64;
        StreamHead { r, cur: [0.0; STREAM_CH], nxt: [0.0; STREAM_CH], phase: 0.0, primed: false, over: false, pos }
    }
    fn pop(&mut self) -> Option<Frame> {
        let ch = self.r.channels;
        if self.r.rx.slots() < ch {
            return None;
        }
        let mut f = [0f32; STREAM_CH];
        if let Ok(chunk) = self.r.rx.read_chunk(ch) {
            let (a, b) = chunk.as_slices();
            f[..a.len()].copy_from_slice(a);
            f[a.len()..a.len() + b.len()].copy_from_slice(b);
            chunk.commit_all();
        }
        Some(f)
    }
    /// Enough decoded to start (or the file was shorter than that).
    fn ready(&mut self) -> bool {
        if !self.primed {
            let want = (crate::stream::PREFILL_S * self.r.sr as f64) as usize * self.r.channels;
            if self.r.rx.slots() >= want.min(self.r.rx.buffer().capacity()) || self.r.info.eof.load(Relaxed) {
                self.primed = true;
                match self.pop() {
                    Some(f) => self.cur = f,
                    None => self.over = true,
                }
                self.nxt = self.pop().unwrap_or(self.cur);
            }
        }
        self.primed
    }
    #[inline]
    fn read(&self, out: &mut Frame) {
        let f = self.phase as f32;
        let ch = self.r.channels;
        for ((o, a), b) in out[..ch].iter_mut().zip(&self.cur[..ch]).zip(&self.nxt[..ch]) {
            *o = a + (b - a) * f;
        }
    }
    #[inline]
    fn advance(&mut self, step: f64) -> bool {
        if self.over {
            return false;
        }
        self.pos += step;
        if self.r.info.looping.load(Relaxed) {
            let n = self.r.info.frames.load(Relaxed) as f64;
            if n > 0.0 && self.pos >= n {
                self.pos %= n;
            }
        }
        self.phase += step;
        while self.phase >= 1.0 {
            self.phase -= 1.0;
            self.cur = self.nxt;
            match self.pop() {
                Some(f) => self.nxt = f,
                None if self.r.info.eof.load(Relaxed) => {
                    self.over = true;
                    return false;
                }
                None => {
                    self.r.info.underruns.fetch_add(1, Relaxed);
                }
            }
        }
        true
    }
}

pub enum Head {
    Buf(BufHead),
    Stream(StreamHead),
}

impl Head {
    #[inline]
    fn read(&self, out: &mut Frame) {
        match self {
            Head::Buf(b) => b.read(out),
            Head::Stream(s) => s.read(out),
        }
    }
    #[inline]
    fn advance(&mut self, step: f64) -> bool {
        match self {
            Head::Buf(b) => b.advance(step),
            Head::Stream(s) => s.advance(step),
        }
    }
    fn ready(&mut self) -> bool {
        match self {
            Head::Buf(_) => true,
            Head::Stream(s) => s.ready(),
        }
    }
    pub fn channels(&self) -> usize {
        match self {
            Head::Buf(b) => b.pcm.channels.min(STREAM_CH),
            Head::Stream(s) => s.r.channels,
        }
    }
    pub fn sr(&self) -> f64 {
        match self {
            Head::Buf(b) => b.pcm.sr as f64,
            Head::Stream(s) => s.r.sr as f64,
        }
    }
    /// Where it is in its file, in seconds, as heard (a held loop wrapped).
    pub fn secs(&self) -> f64 {
        match self {
            Head::Buf(b) => b.pos / b.pcm.sr as f64,
            Head::Stream(s) => s.pos / s.r.sr as f64,
        }
    }
}

/// A frame of any number of channels as two, by Web Audio's speaker rules: mono on both, quad and 5.1 folded,
/// anything else its first two.
#[inline]
fn stereo(f: &Frame, ch: usize) -> (f32, f32) {
    const H: f32 = std::f32::consts::FRAC_1_SQRT_2;
    match ch {
        1 => (f[0], f[0]),
        4 => (0.5 * (f[0] + f[2]), 0.5 * (f[1] + f[3])),
        6 => (f[0] + H * (f[2] + f[4]), f[1] + H * (f[2] + f[5])),
        _ => (f[0], f[1]),
    }
}

/// A voice's lines: the Volume line (dB on its level), the Pan line, and the Pan field. Made off the audio thread.
#[derive(Default, Debug)]
pub struct Lanes {
    pub env: Vec<Point>,
    pub pan: Vec<Point>,
    pub pan_base: f64,
}

/// Where a voice plays into.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Out {
    Bus(usize),
    Pair(usize),
    Nowhere,
}

/// What a move brings in.
pub enum Into {
    /// the same buffer, from `to` frames, holding `region` (frames)
    Place { to: f64, region: Option<(f64, f64)> },
    /// another head made by the control thread (a stream from a new place)
    Given(Head),
    /// the buffer a stream has been decoded into, taken up where the stream is
    Upgrade(Arc<Pcm>),
}

/// A change of place waiting for its moment: a move on the bar, a stream's jump, a stream becoming a buffer.
pub struct Pending {
    pub countdown: f64,
    pub into: Into,
    /// frames the place being left takes to go, and the one arriving to come in (after `delay`)
    pub out_n: f64,
    pub in_n: f64,
    pub delay: f64,
    /// equal power (sine and cosine) or equal gain (straight lines)
    pub power: bool,
    /// a move to the sample: the place in the file it lands on (`countdown` is then worked out on arrival)
    pub at: Option<(f64, f64)>,
}

/// A place being left, going out over its line.
struct Leaving {
    head: Head,
    line: Line,
    power: bool,
}

/// The place arriving, coming in over its line once `delay` frames have gone.
struct Arriving {
    delay: f64,
    line: Line,
    power: bool,
}

/// What a voice has finished with, for the control thread to let go of.
pub enum Trash {
    Voice(Box<Voice>),
    Head(Head),
    Lanes(Box<Lanes>),
    Shape(Box<[f64; SHAPE_MAX]>),
    Pcm(Arc<Pcm>),
}

/// The audio thread's way of handing back what it has finished with (it never frees memory itself).
pub trait Bin {
    fn put(&mut self, t: Trash);
}

pub struct Voice {
    pub id: u64,
    pub shared: Arc<VoiceShared>,
    pub out: Out,
    pub head: Head,
    leaving: Option<Leaving>,
    arriving: Option<Arriving>,
    pub pending: Option<Pending>,
    pub level: Level,
    pub under: Glide,
    rate0: f64,
    rate1: f64,
    rate_n: f64,
    rate_i: f64,
    /// a cut at a place in the file: output frames until it is silent, and the 4 ms ramp before it
    cut: Option<(f64, f64)>,
    cut_shut: bool,
    pub lanes: Box<Lanes>,
    pan_now: (f64, f64),
    pan_line: Option<PanGlide>,
    pub paused: bool,
    stopping: Option<Line>,
    pub started: bool,
}

/// A pan moved with no line: its two gains from, to, and how far along.
type PanGlide = ((f64, f64), (f64, f64), Line);

/// What became of a voice in a block.
#[derive(Debug, PartialEq, Eq)]
pub enum Fate {
    Playing,
    /// it played to its end
    Ended,
    /// it was stopped, and has now gone quiet
    Stopped,
}

impl Voice {
    pub fn new(id: u64, head: Head, gain_db: f64, rate: f64, lanes: Box<Lanes>, out: Out) -> Self {
        let rate = if rate > 0.0 && rate.is_finite() { rate } else { 1.0 };
        let pan_now =
            if lanes.pan.is_empty() { pan_gains(lanes.pan_base) } else { pan_gains(value_at(&lanes.pan, head.secs()).unwrap_or(0.0)) };
        Voice {
            id,
            shared: Arc::new(VoiceShared::default()),
            out,
            head,
            leaving: None,
            arriving: None,
            pending: None,
            level: Level::new(gain_db),
            under: Glide::new(1.0),
            rate0: rate,
            rate1: rate,
            rate_n: 0.0,
            rate_i: 0.0,
            cut: None,
            cut_shut: false,
            lanes,
            pan_now,
            pan_line: None,
            paused: false,
            stopping: None,
            started: false,
        }
    }

    pub fn rate_now(&self) -> f64 {
        if self.rate_i < self.rate_n {
            self.rate0 + (self.rate1 - self.rate0) * self.rate_i / self.rate_n
        } else {
            self.rate1
        }
    }
    /// To `rate` over `frames` (0: at once), from the rate it has now.
    pub fn set_rate(&mut self, rate: f64, frames: f64) {
        self.rate0 = self.rate_now();
        self.rate1 = rate;
        self.rate_n = frames.max(0.0);
        self.rate_i = 0.0;
    }

    /// Stopped: out over 2 ms (so the stop does not click), then gone.
    pub fn stop(&mut self, sr: f64) {
        if self.stopping.is_none() {
            self.stopping = Some(Line::new(1.0, 0.0, 0.002 * sr));
        }
    }

    /// A fade from where the level is now (taking back a cut, as the window's next fade does).
    pub fn fade(&mut self, db: f64, secs: f64, shape: &[f64], sr: f64) {
        self.cut = None;
        self.cut_shut = false;
        self.level.fade(db, secs, shape, sr);
    }

    /// Silent from `at` seconds into the file, with a 4 ms ramp to it; the level is held where it is.
    pub fn cut_at(&mut self, at: f64, sr: f64) {
        let here = self.head.secs();
        let rate = self.rate_now().max(1e-6);
        let until = ((at - here) / rate * sr).max(0.0);
        self.level.hold();
        self.cut = Some((until, 0.004 * sr));
        self.cut_shut = until <= 0.0;
    }

    /// The Pan field moved with no Pan line: its two gains glide there over 20 ms.
    pub fn set_lanes(&mut self, lanes: Box<Lanes>, sr: f64, bin: &mut dyn Bin) {
        let old = std::mem::replace(&mut self.lanes, lanes);
        bin.put(Trash::Lanes(old));
        if self.lanes.pan.is_empty() {
            let to = pan_gains(self.lanes.pan_base);
            if to != self.pan_now {
                self.pan_line = Some((self.pan_now, to, Line::new(0.0, 1.0, 0.02 * sr)));
            }
        } else {
            self.pan_line = None;
        }
    }

    /// Paused: the sound holds where it is, and its level (a fade stops part way); a move under way is settled.
    pub fn pause(&mut self, bin: &mut dyn Bin) {
        self.settle(bin);
        self.paused = true;
        self.level.hold();
        self.rate0 = self.rate_now();
        self.rate1 = self.rate0;
        self.rate_n = 0.0;
    }

    /// A move under way when something else comes: before it lands it is undone (the place it was leaving plays
    /// on); once crossfading it lands at once.
    pub fn settle(&mut self, bin: &mut dyn Bin) {
        if let Some(p) = self.pending.take() {
            if let Into::Given(h) = p.into {
                bin.put(Trash::Head(h));
            } else if let Into::Upgrade(pcm) = p.into {
                bin.put(Trash::Pcm(pcm));
            }
        }
        if let Some(l) = self.leaving.take() {
            bin.put(Trash::Head(l.head));
        }
        self.arriving = None;
    }

    /// To `secs` into the file (a buffer; a stream is moved by the control thread, as a new head).
    pub fn seek(&mut self, secs: f64, bin: &mut dyn Bin) {
        self.settle(bin);
        if let Head::Buf(b) = &mut self.head {
            let last = (b.pcm.frames as f64 - 1.0).max(0.0);
            b.pos = (secs.max(0.0) * b.pcm.sr as f64).round().min(last);
        }
    }

    /// A move lands: the place it brings becomes the head, the old one goes out over its line.
    fn land(&mut self, p: Pending, bin: &mut dyn Bin) {
        if let Some(l) = self.leaving.take() {
            bin.put(Trash::Head(l.head));
        }
        let new = match p.into {
            Into::Place { to, region } => match &self.head {
                Head::Buf(b) => {
                    let last = (b.pcm.frames as f64 - 1.0).max(0.0);
                    Head::Buf(BufHead { pcm: b.pcm.clone(), pos: to.clamp(0.0, last), region, loop_whole: false })
                }
                Head::Stream(_) => return,
            },
            Into::Given(h) => h,
            Into::Upgrade(pcm) => {
                let secs = self.head.secs();
                let loop_whole = matches!(&self.head, Head::Stream(s) if s.r.info.looping.load(Relaxed));
                let mut b = BufHead::new(pcm, 0.0, loop_whole);
                b.pos = (secs * b.pcm.sr as f64).min((b.pcm.frames as f64 - 1.0).max(0.0));
                Head::Buf(b)
            }
        };
        let old = std::mem::replace(&mut self.head, new);
        self.leaving = Some(Leaving { head: old, line: Line::new(1.0, 0.0, p.out_n), power: p.power });
        self.arriving = Some(Arriving { delay: p.delay, line: Line::new(0.0, 1.0, p.in_n), power: p.power });
    }

    /// Frames until a buffer plays the place `at` frames into its file (a held loop comes round), at its rate now.
    fn until_place(&self, at: f64) -> Option<f64> {
        let Head::Buf(b) = &self.head else { return None };
        let rate = self.rate_now() * b.pcm.sr as f64;
        let ahead = match b.region {
            Some((s, e)) if at >= s && at < e && b.pos >= s => {
                let len = e - s;
                ((at - b.pos) % len + len) % len
            }
            _ if at >= b.pos => at - b.pos,
            _ => return None,
        };
        Some(ahead / rate)
    }

    /// One block: this voice's sound added into `l` and `r` (its own peak said). `sr` is the device's rate;
    /// `present_ns` the moment the block's first frame is heard, `frame0` the mixer's count of it.
    pub fn render(&mut self, l: &mut [f32], r: &mut [f32], sr: f64, present_ns: u64, frame0: u64, bin: &mut dyn Bin) -> Fate {
        if self.paused {
            if self.stopping.is_some() {
                return Fate::Stopped;
            }
            return Fate::Playing;
        }
        if !self.head.ready() {
            return Fate::Playing;
        }
        // a move to the sample: when it will be there, worked out now it is here
        if let Some((at, lead)) = self.pending.as_mut().and_then(|p| p.at.take()) {
            let frames = self.until_place_frames(at, sr);
            if let Some(p) = &mut self.pending {
                p.countdown = match frames {
                    Some(f) if (f / sr - lead).abs() < 0.3 => f,
                    _ => lead * sr,
                };
            }
        }
        self.shared.pos.set(self.head.secs());
        let mut peak = 0f32;
        let mut fate = Fate::Playing;
        let mut f = [0f32; STREAM_CH];
        let mut g = [0f32; STREAM_CH];
        let sr_out = sr;
        for i in 0..l.len() {
            // a change of place waiting for its moment (and, for a stream, for its new place to be decoded)
            let due = match &mut self.pending {
                Some(p) => {
                    if p.countdown <= 0.0 {
                        match &mut p.into {
                            Into::Given(h) => h.ready(),
                            _ => true,
                        }
                    } else {
                        p.countdown -= 1.0;
                        false
                    }
                }
                None => false,
            };
            if due {
                if let Some(p) = self.pending.take() {
                    self.land(p, bin);
                }
            }
            if !self.started {
                self.started = true;
                self.shared.started_frame.store(frame0 + i as u64, Relaxed);
                self.shared.started_ns.store(present_ns + (i as f64 / sr * 1e9) as u64, Relaxed);
                self.shared.playing.store(true, Relaxed);
            }
            let rate = self.rate_now();
            if self.rate_i < self.rate_n {
                self.rate_i += 1.0;
            }
            // the head, and the place being left if a move is crossfading
            self.head.read(&mut f);
            let (mut sl, mut sr_) = stereo(&f, self.head.channels());
            if let Some(a) = &mut self.arriving {
                let k = if a.delay > 0.0 {
                    a.delay -= 1.0;
                    0.0
                } else {
                    let x = a.line.step();
                    if a.power {
                        (x * FRAC_PI_2).sin()
                    } else {
                        x
                    }
                };
                sl *= k as f32;
                sr_ *= k as f32;
                if a.delay <= 0.0 && a.line.done() {
                    self.arriving = None;
                }
            }
            if let Some(lv) = &mut self.leaving {
                lv.head.read(&mut g);
                let (ol, or) = stereo(&g, lv.head.channels());
                let x = lv.line.step();
                let k = (if lv.power { (x * FRAC_PI_2).cos() } else { 1.0 - x }) as f32;
                sl += ol * k;
                sr_ += or * k;
                let step = rate * lv.head.sr() / sr_out;
                let on = lv.head.advance(step);
                if lv.line.done() || !on {
                    if let Some(lv) = self.leaving.take() {
                        bin.put(Trash::Head(lv.head));
                    }
                }
            }
            let place = self.head.secs();
            let step = rate * self.head.sr() / sr_out;
            if !self.head.advance(step) {
                fate = Fate::Ended;
            }
            // its level, a cut, the Volume line, "others", a stop's declick
            let mut gain = self.level.tick() * self.under.tick();
            if let Some((until, ramp)) = &mut self.cut {
                if self.cut_shut || *until <= 0.0 {
                    self.cut_shut = true;
                    gain = 0.0;
                } else {
                    if *until <= *ramp {
                        gain *= *until / *ramp;
                    }
                    *until -= 1.0;
                }
            }
            if !self.lanes.env.is_empty() {
                gain *= to_lin(envelope_at(&self.lanes.env, place));
            }
            if let Some(s) = &mut self.stopping {
                gain *= s.tick();
                if s.done() {
                    fate = Fate::Stopped;
                }
            }
            // its pan: the Pan line where it has one, else the field (gliding when it was moved)
            let (pl, pr) = if !self.lanes.pan.is_empty() {
                self.pan_now = pan_gains(value_at(&self.lanes.pan, place).unwrap_or(0.0));
                self.pan_now
            } else if let Some((a, b, line)) = &mut self.pan_line {
                let x = line.step();
                self.pan_now = (a.0 + (b.0 - a.0) * x, a.1 + (b.1 - a.1) * x);
                if line.done() {
                    self.pan_line = None;
                }
                self.pan_now
            } else {
                self.pan_now
            };
            let ol = sl * (gain * pl) as f32;
            let or = sr_ * (gain * pr) as f32;
            l[i] += ol;
            r[i] += or;
            peak = peak.max(ol.abs()).max(or.abs());
            if fate != Fate::Playing {
                break;
            }
        }
        self.shared.peak.put(peak);
        fate
    }

    fn until_place_frames(&self, at_secs: f64, sr: f64) -> Option<f64> {
        let Head::Buf(b) = &self.head else { return None };
        self.until_place(at_secs * b.pcm.sr as f64).map(|s| s * sr)
    }
}
