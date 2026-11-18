//! The mixer: what the audio thread runs once per buffer. Voices into buses, buses into pairs of outputs, each
//! pair through the master and its limiter, each output through its trim, to the device.
//!
//!   voice ─▶ bus fader ─▶ its pair ─▶ master ─▶ limiter ─▶ [ per-output trim ] ─▶ device
//!   audition ─────────────▶ its pair ─┘
//!
//! Commands arrive on a lock-free queue (`Msg`) and are taken at the start of each buffer, so a sound decoded ahead
//! starts on the first frame of the next buffer. What the mixer is finished with leaves on another (`Back`):
//! nothing is allocated or freed here.

use crate::arith::db_of;
use crate::limiter::Limiter;
use crate::params::{Glide, SHAPE_MAX};
use crate::shared::{BusShared, Meters, MAX_OUT};
use crate::voice::{Bin, Fate, Head, Into, Lanes, Out, Pending, Trash, Voice};
use rtrb::{Consumer, Producer};
use std::sync::atomic::Ordering::Relaxed;
use std::sync::Arc;

/// Frames rendered at a time (a device's buffer is cut into blocks of at most this).
pub const BLOCK: usize = 512;
pub const MAX_VOICES: usize = 512;
pub const MAX_BUSES: usize = 64;
pub const MAX_PAIRS: usize = MAX_OUT / 2;

/// A command for the audio thread. Everything it carries was made on the control thread.
pub enum Msg {
    Play(Box<Voice>),
    Stop(u64),
    StopAll,
    Pause(u64),
    Resume(u64, Option<f64>),
    Seek(u64, f64),
    Fade {
        id: u64,
        db: f64,
        secs: f64,
        shape: Box<[f64; SHAPE_MAX]>,
        len: usize,
    },
    Cut(u64, f64),
    Loop(u64, bool),
    Region(u64, Option<(f64, f64)>),
    Rate {
        id: u64,
        rate: f64,
        secs: f64,
    },
    Others {
        id: u64,
        db: f64,
        secs: f64,
    },
    Lanes(u64, Box<Lanes>),
    /// a move inside a decoded track: to `to` s holding `region`, landing `lead` s from now, or when it reaches
    /// `at` s in its file if that is within 0.3 s of the lead; crossfading over `xf` s
    Move {
        id: u64,
        to: f64,
        region: Option<(f64, f64)>,
        lead: f64,
        at: Option<f64>,
        xf: f64,
        power: bool,
    },
    /// a new head for a voice (a stream from a new place, or a stream's decoded buffer): `delay` s from now,
    /// the old going out over `out_s`, the new coming in over `in_s` after `gap` s
    Swap {
        id: u64,
        into: Into,
        delay: f64,
        out_s: f64,
        in_s: f64,
        gap: f64,
    },
    AddBus(Box<Bus>),
    BusLevel {
        bus: usize,
        db: f64,
        secs: f64,
    },
    BusOut {
        bus: usize,
        pair: Option<usize>,
    },
    Master {
        db: f64,
        secs: f64,
    },
    MasterGain(f64),
    Limiter(bool),
    Trim {
        out: usize,
        gain: f64,
    },
    /// give the mixer back (the device is changing)
    Detach,
}

/// What the audio thread says back.
pub enum Back {
    Ended(u64),
    Trash(Trash),
}

/// A bus of the mixer: its fader and where it plays. Its two block buffers are made with it.
pub struct Bus {
    pub fader: Glide,
    pub pair: Option<usize>,
    pub shared: Arc<BusShared>,
    l: Box<[f32; BLOCK]>,
    r: Box<[f32; BLOCK]>,
}

impl Bus {
    pub fn new(db: f64) -> Self {
        let mut fader = Glide::new(1.0);
        fader.to_db(db, 0.0, 48000.0);
        Bus { fader, pair: Some(0), shared: Arc::new(BusShared::default()), l: Box::new([0.0; BLOCK]), r: Box::new([0.0; BLOCK]) }
    }
}

struct Pair {
    l: Box<[f32; BLOCK]>,
    r: Box<[f32; BLOCK]>,
    limiter: Limiter,
}

/// Hands what is finished with to the control thread (or, if that queue is ever full, keeps it forever rather
/// than free memory here).
struct Return<'a>(&'a mut Producer<Back>);
impl Bin for Return<'_> {
    fn put(&mut self, t: Trash) {
        if let Err(rtrb::PushError::Full(b)) = self.0.push(Back::Trash(t)) {
            std::mem::forget(b);
        }
    }
}

pub struct Mixer {
    pub sr: f64,
    pub channels: usize,
    rx: Consumer<Msg>,
    tx: Producer<Back>,
    // (boxes, not values: a voice or a bus arrives as a Box made on the control thread, and a voice leaves as one,
    // to be freed there; the Vec only ever holds the pointers, within the room it was made with)
    #[allow(clippy::vec_box)]
    voices: Vec<Box<Voice>>,
    #[allow(clippy::vec_box)]
    buses: Vec<Box<Bus>>,
    pairs: Vec<Pair>,
    master: Glide,
    trims: Vec<Glide>,
    vl: Box<[f32; BLOCK]>,
    vr: Box<[f32; BLOCK]>,
    master_g: Box<[f32; BLOCK]>,
    pub meters: Arc<Meters>,
    pub frame: u64,
    pub detached: bool,
}

impl Mixer {
    pub fn new(sr: f64, channels: usize, rx: Consumer<Msg>, tx: Producer<Back>, meters: Arc<Meters>) -> Self {
        Mixer {
            sr,
            channels: channels.clamp(1, MAX_OUT),
            rx,
            tx,
            voices: Vec::with_capacity(MAX_VOICES),
            buses: Vec::with_capacity(MAX_BUSES),
            pairs: (0..MAX_PAIRS)
                .map(|_| Pair { l: Box::new([0.0; BLOCK]), r: Box::new([0.0; BLOCK]), limiter: Limiter::new(sr as f32) })
                .collect(),
            master: Glide::new(1.0),
            trims: (0..MAX_OUT).map(|_| Glide::new(1.0)).collect(),
            vl: Box::new([0.0; BLOCK]),
            vr: Box::new([0.0; BLOCK]),
            master_g: Box::new([0.0; BLOCK]),
            meters,
            frame: 0,
            detached: false,
        }
    }

    /// A new device: its rate and its outputs (called off the audio thread, while the mixer is detached).
    pub fn set_device(&mut self, sr: f64, channels: usize) {
        self.sr = sr;
        self.channels = channels.clamp(1, MAX_OUT);
        for p in &mut self.pairs {
            p.limiter.set_rate(sr as f32);
        }
        self.detached = false;
    }

    /// The pairs the device has: outputs 1–2 always, and each pair whose both outputs are there.
    fn pairs_on(&self) -> usize {
        (self.channels / 2).max(1)
    }

    fn take_msgs(&mut self) {
        while let Ok(m) = self.rx.pop() {
            self.apply(m);
        }
    }

    fn apply(&mut self, m: Msg) {
        let sr = self.sr;
        let mut bin = Return(&mut self.tx);
        match m {
            Msg::Play(v) => {
                if self.voices.len() < MAX_VOICES {
                    self.voices.push(v);
                } else {
                    bin.put(Trash::Voice(v));
                }
            }
            Msg::Stop(id) => {
                if let Some(v) = self.voices.iter_mut().find(|v| v.id == id) {
                    v.stop(sr);
                }
            }
            Msg::StopAll => {
                for v in self.voices.drain(..) {
                    bin.put(Trash::Voice(v));
                }
            }
            Msg::Pause(id) => {
                if let Some(v) = self.voices.iter_mut().find(|v| v.id == id) {
                    v.pause(&mut bin);
                }
            }
            Msg::Resume(id, t) => {
                if let Some(v) = self.voices.iter_mut().find(|v| v.id == id) {
                    if let Some(t) = t {
                        v.seek(t, &mut bin);
                    }
                    v.paused = false;
                }
            }
            Msg::Seek(id, t) => {
                if let Some(v) = self.voices.iter_mut().find(|v| v.id == id) {
                    v.seek(t, &mut bin);
                }
            }
            Msg::Fade { id, db, secs, shape, len } => {
                if let Some(v) = self.voices.iter_mut().find(|v| v.id == id) {
                    v.fade(db, secs, &shape[..len], sr);
                }
                bin.put(Trash::Shape(shape));
            }
            Msg::Cut(id, at) => {
                if let Some(v) = self.voices.iter_mut().find(|v| v.id == id) {
                    v.cut_at(at, sr);
                }
            }
            Msg::Loop(id, on) => {
                if let Some(v) = self.voices.iter_mut().find(|v| v.id == id) {
                    match &mut v.head {
                        Head::Buf(b) => b.loop_whole = on,
                        Head::Stream(s) => s.r.info.looping.store(on, Relaxed),
                    }
                }
            }
            Msg::Region(id, region) => {
                if let Some(v) = self.voices.iter_mut().find(|v| v.id == id) {
                    if let Head::Buf(b) = &mut v.head {
                        let k = b.pcm.sr as f64;
                        b.region = region.and_then(|(s, e)| {
                            let (s, e) = ((s * k).round().max(0.0), (e * k).round().min(b.pcm.frames as f64));
                            (e > s).then_some((s, e))
                        });
                    }
                }
            }
            Msg::Rate { id, rate, secs } => {
                if let Some(v) = self.voices.iter_mut().find(|v| v.id == id) {
                    v.set_rate(rate, secs.max(0.0) * sr);
                }
            }
            Msg::Others { id, db, secs } => {
                if let Some(v) = self.voices.iter_mut().find(|v| v.id == id) {
                    v.under.to_db(db, secs, sr);
                }
            }
            Msg::Lanes(id, lanes) => match self.voices.iter_mut().find(|v| v.id == id) {
                Some(v) => v.set_lanes(lanes, sr, &mut bin),
                None => bin.put(Trash::Lanes(lanes)),
            },
            Msg::Move { id, to, region, lead, at, xf, power } => {
                if let Some(v) = self.voices.iter_mut().find(|v| v.id == id) {
                    if let Head::Buf(b) = &v.head {
                        let k = b.pcm.sr as f64;
                        let last = (b.pcm.frames as f64 - 1.0).max(0.0);
                        let region = region.and_then(|(s, e)| {
                            let (s, e) = ((s * k).round().max(0.0), (e * k).round().min(b.pcm.frames as f64));
                            (e > s).then_some((s, e))
                        });
                        let to = (to * k).round().clamp(0.0, last);
                        v.settle(&mut bin);
                        let xf_n = xf.max(0.005) * sr;
                        v.pending = Some(Pending {
                            countdown: lead.max(0.0) * sr,
                            into: Into::Place { to, region },
                            out_n: xf_n,
                            in_n: xf_n,
                            delay: 0.0,
                            power,
                            at: at.map(|a| (a, lead.max(0.0))),
                        });
                    }
                }
            }
            Msg::Swap { id, into, delay, out_s, in_s, gap } => match self.voices.iter_mut().find(|v| v.id == id) {
                Some(v) => {
                    v.settle(&mut bin);
                    v.pending = Some(Pending {
                        countdown: delay.max(0.0) * sr,
                        into,
                        out_n: out_s * sr,
                        in_n: in_s * sr,
                        delay: gap * sr,
                        power: false,
                        at: None,
                    });
                }
                None => match into {
                    Into::Given(h) => bin.put(Trash::Head(h)),
                    Into::Upgrade(p) => bin.put(Trash::Pcm(p)),
                    Into::Place { .. } => {}
                },
            },
            Msg::AddBus(b) => {
                if self.buses.len() < MAX_BUSES {
                    self.buses.push(b);
                }
            }
            Msg::BusLevel { bus, db, secs } => {
                if let Some(b) = self.buses.get_mut(bus) {
                    b.fader.to_db(db, secs, sr);
                }
            }
            Msg::BusOut { bus, pair } => {
                if let Some(b) = self.buses.get_mut(bus) {
                    b.pair = pair;
                }
            }
            Msg::Master { db, secs } => self.master.to_db(db, secs, sr),
            Msg::MasterGain(g) => self.master.set(g),
            Msg::Limiter(on) => {
                for p in &mut self.pairs {
                    p.limiter.on = on;
                }
            }
            Msg::Trim { out, gain } => {
                if let Some(t) = self.trims.get_mut(out) {
                    t.to_gain(gain, 0.02, sr);
                }
            }
            Msg::Detach => self.detached = true,
        }
    }

    /// One device buffer: `out` is interleaved, `self.channels` wide. `present_ns`: the moment its first frame is
    /// heard (ns since `shared::epoch()`), as the device says; `latency_ns` the device's own part of that.
    pub fn render(&mut self, out: &mut [f32], present_ns: u64, latency_ns: u64) {
        self.take_msgs();
        let ch = self.channels;
        let frames = out.len() / ch;
        self.meters.latency_ns.store(latency_ns, Relaxed);
        let mut at = 0;
        while at < frames {
            let n = (frames - at).min(BLOCK);
            let ns = present_ns + (at as f64 / self.sr * 1e9) as u64;
            self.block(&mut out[at * ch..(at + n) * ch], n, ns);
            at += n;
        }
    }

    fn block(&mut self, out: &mut [f32], n: usize, present_ns: u64) {
        let ch = self.channels;
        let npairs = self.pairs_on();
        self.meters.frame.store(self.frame, Relaxed);
        self.meters.frame_ns.store(present_ns, Relaxed);
        for b in &mut self.buses {
            b.l[..n].fill(0.0);
            b.r[..n].fill(0.0);
        }
        for p in &mut self.pairs[..npairs] {
            p.l[..n].fill(0.0);
            p.r[..n].fill(0.0);
        }
        // the voices, each into its bus (or its pair)
        let mut i = 0;
        while i < self.voices.len() {
            self.vl[..n].fill(0.0);
            self.vr[..n].fill(0.0);
            let fate = {
                let mut bin = Return(&mut self.tx);
                self.voices[i].render(&mut self.vl[..n], &mut self.vr[..n], self.sr, present_ns, self.frame, &mut bin)
            };
            let (dl, dr) = match self.voices[i].out {
                Out::Bus(b) if b < self.buses.len() => {
                    let b = &mut *self.buses[b];
                    (&mut b.l, &mut b.r)
                }
                Out::Pair(p) if p < npairs => {
                    let p = &mut self.pairs[p];
                    (&mut p.l, &mut p.r)
                }
                _ => {
                    i += 1;
                    continue;
                }
            };
            for k in 0..n {
                dl[k] += self.vl[k];
                dr[k] += self.vr[k];
            }
            if fate == Fate::Playing {
                i += 1;
                continue;
            }
            let v = self.voices.swap_remove(i);
            if fate == Fate::Ended {
                let _ = self.tx.push(Back::Ended(v.id));
            }
            Return(&mut self.tx).put(Trash::Voice(v));
        }
        // the buses, each through its fader into its pair
        for b in &mut self.buses {
            let mut peak = 0f32;
            for k in 0..n {
                let g = b.fader.tick() as f32;
                b.l[k] *= g;
                b.r[k] *= g;
                peak = peak.max(b.l[k].abs()).max(b.r[k].abs());
            }
            b.shared.peak.put(peak);
            if let Some(p) = b.pair.filter(|&p| p < npairs) {
                let pair = &mut self.pairs[p];
                for k in 0..n {
                    pair.l[k] += b.l[k];
                    pair.r[k] += b.r[k];
                }
            }
        }
        // the master, once for every pair
        for k in 0..n {
            self.master_g[k] = self.master.tick() as f32;
        }
        let m = &self.meters;
        let mut main_peak = 0f32;
        for (p, pair) in self.pairs[..npairs].iter_mut().enumerate() {
            let (o0, o1) = (2 * p, 2 * p + 1);
            let (mut pre0, mut pre1) = (0f32, 0f32);
            let (mut post0, mut post1) = (0f32, 0f32);
            let (mut sq0, mut sq1) = (0f64, 0f64);
            pair.limiter.least = 1.0;
            for k in 0..n {
                let (mut l, mut r) = (pair.l[k], pair.r[k]);
                pre0 = pre0.max(l.abs());
                pre1 = pre1.max(r.abs());
                l *= self.master_g[k];
                r *= self.master_g[k];
                pair.limiter.frame(&mut l, &mut r);
                l *= self.trims[o0].tick() as f32;
                if o1 < MAX_OUT {
                    r *= self.trims[o1].tick() as f32;
                }
                if p == 0 {
                    main_peak = main_peak.max(((l + r) * 0.5).abs());
                }
                post0 = post0.max(l.abs());
                post1 = post1.max(r.abs());
                sq0 += (l * l) as f64;
                sq1 += (r * r) as f64;
                if ch == 1 {
                    out[k] = (l + r) * 0.5;
                } else {
                    out[k * ch + o0] = l;
                    if o1 < ch {
                        out[k * ch + o1] = r;
                    }
                }
            }
            m.pre[o0].put(pre0);
            m.pre[o1].put(pre1);
            m.post[o0].put(post0);
            m.post[o1].put(post1);
            m.sq[o0].add(sq0);
            m.sq[o1].add(sq1);
            m.limited.put(1.0 - pair.limiter.least);
        }
        // an odd last output, or outputs past the pairs, are silent
        if ch > 1 {
            for k in 0..n {
                for c in 2 * npairs..ch {
                    out[k * ch + c] = 0.0;
                }
            }
        }
        m.main.put(main_peak);
        m.frames.fetch_add(n as u64, Relaxed);
        self.frame += n as u64;
    }

    pub fn voices(&self) -> usize {
        self.voices.len()
    }
}

/// A peak as the level event has it: dB, floored at −60, to a tenth.
pub fn db1(x: f32) -> f64 {
    (db_of(x as f64) * 10.0).round() / 10.0
}
