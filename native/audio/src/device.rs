//! The audio device (cpal), and the clock a test run uses instead.
//!
//! The mixer lives in the device's callback. To move it to another device it is handed over through a queue, never
//! a lock: the control thread asks for it (`Msg::Detach`), the callback gives it back at the end of its next
//! buffer, and the new device's callback picks it up from its own queue at the start of its first.

use crate::control::{Ends, In, Opened, Output};
use crate::mixer::{Back, Mixer, Msg};
use crate::shared::{now_ns, Meters, MAX_OUT};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};
use crossbeam_channel::Sender;
use rtrb::{Consumer, Producer, RingBuffer};
use serde_json::{json, Value};
use std::sync::atomic::Ordering::Relaxed;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// A new mixer and the ends of its two queues (the control thread keeps `Producer<Msg>` and `Consumer<Back>`).
pub fn engine(sr: f64, channels: usize, meters: Arc<Meters>) -> (Mixer, Ends) {
    let (tx, rx) = RingBuffer::<Msg>::new(8192);
    let (btx, brx) = RingBuffer::<Back>::new(16384);
    (Mixer::new(sr, channels, rx, btx, meters.clone()), Ends { tx, rx: brx, meters })
}

/// A test run's clock: no device, the mixer rendered in real time on a thread of its own (into nothing). Each block
/// is said to be heard at the moment it is due (not when the thread woke), as a device's clock would say.
pub fn run_silent(mut mixer: Mixer, block: usize) {
    std::thread::Builder::new()
        .name("ec-silent".into())
        .spawn(move || {
            let ch = mixer.channels;
            let mut buf = vec![0f32; block * ch];
            let period = Duration::from_secs_f64(block as f64 / mixer.sr);
            let start = Instant::now();
            let mut next = start;
            loop {
                let due = now_ns().saturating_add((next.saturating_duration_since(Instant::now())).as_nanos() as u64);
                let t = Instant::now();
                mixer.render(&mut buf, due, 0);
                mixer.meters.load.put((t.elapsed().as_secs_f64() / period.as_secs_f64()) as f32);
                next += period;
                let now = Instant::now();
                if next > now {
                    std::thread::sleep(next - now);
                } else if now - next > Duration::from_millis(200) {
                    // (the computer slept, or the thread was held up: carry on from now, not by catching up)
                    mixer.meters.xruns.fetch_add(1, Relaxed);
                    next = now;
                }
            }
        })
        .expect("the silent clock's thread");
}

/// The real device.
pub struct CpalOut {
    host: cpal::Host,
    stream: Option<cpal::Stream>,
    /// the mixer while no device has it
    spare: Option<Box<Mixer>>,
    /// the running stream's way of giving the mixer back
    back: Option<Consumer<Box<Mixer>>>,
    current: String,
    /// the rate and outputs of the device it is on
    now: (f64, usize),
    meters: Arc<Meters>,
    errors: Sender<In>,
    /// frames per buffer asked of the device (0: its own)
    pub buffer: u32,
}

impl CpalOut {
    pub fn new(mixer: Mixer, meters: Arc<Meters>, errors: Sender<In>, buffer: u32) -> Self {
        CpalOut {
            host: cpal::default_host(),
            stream: None,
            spare: Some(Box::new(mixer)),
            back: None,
            current: "default".into(),
            now: (48000.0, 2),
            meters,
            errors,
            buffer,
        }
    }

    fn find(&self, id: Option<&str>) -> Result<cpal::Device, String> {
        match id {
            None => self.host.default_output_device().ok_or_else(|| "this computer has no audio output".to_string()),
            Some(name) => self
                .host
                .output_devices()
                .map_err(|e| e.to_string())?
                .find(|d| d.name().map(|n| n == name).unwrap_or(false))
                .ok_or_else(|| format!("there is no output named {name}")),
        }
    }

    /// The mixer back from the running stream (it is asked for, and given at the end of the stream's next buffer).
    fn take_back(&mut self, tx: &mut Producer<Msg>) -> Option<Box<Mixer>> {
        if let Some(m) = self.spare.take() {
            return Some(m);
        }
        let back = self.back.as_mut()?;
        let _ = tx.push(Msg::Detach);
        let until = Instant::now() + Duration::from_millis(1500);
        while Instant::now() < until {
            if let Ok(m) = back.pop() {
                return Some(m);
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        None
    }

    /// A stream on `device` with the mixer handed to it; on failure the mixer is given back.
    fn start(&mut self, device: &cpal::Device, mut mixer: Box<Mixer>) -> Result<(), (String, Box<Mixer>)> {
        let cfg = match device.default_output_config() {
            Ok(c) => c,
            Err(e) => return Err((e.to_string(), mixer)),
        };
        let channels = (cfg.channels() as usize).min(MAX_OUT);
        let sr = cfg.sample_rate().0 as f64;
        let mut config: cpal::StreamConfig = cfg.config();
        config.channels = channels as u16;
        if self.buffer > 0 {
            if let cpal::SupportedBufferSize::Range { min, max } = cfg.buffer_size() {
                if (*min..=*max).contains(&self.buffer) {
                    config.buffer_size = cpal::BufferSize::Fixed(self.buffer);
                }
            }
        }
        mixer.set_device(sr, channels);
        let (mut inbox_tx, inbox) = RingBuffer::<Box<Mixer>>::new(1);
        let (outbox, back) = RingBuffer::<Box<Mixer>>::new(1);
        let slot = Slot { mixer: None, inbox, outbox, clock: Clock::new(extra_ns(device, sr), self.meters.clone()) };
        let errors = self.errors.clone();
        let built = match cfg.sample_format() {
            SampleFormat::F32 => build_f32(device, &config, slot, errors),
            SampleFormat::I16 => build_conv::<i16>(device, &config, slot, errors),
            SampleFormat::U16 => build_conv::<u16>(device, &config, slot, errors),
            SampleFormat::I32 => build_conv::<i32>(device, &config, slot, errors),
            f => Err(format!("the device's samples are {f:?}, which this cannot write")),
        };
        let stream = match built {
            Ok(s) => s,
            Err(e) => return Err((e, mixer)),
        };
        if let Err(e) = stream.play() {
            return Err((e.to_string(), mixer));
        }
        if let Err(rtrb::PushError::Full(m)) = inbox_tx.push(mixer) {
            return Err(("the device's queue was full".into(), m));
        }
        self.stream = Some(stream);
        self.back = Some(back);
        self.now = (sr, channels);
        Ok(())
    }
}

/// What a stream's callback does with the mixer: picks it up when it arrives, renders, and gives it back when asked.
struct Slot {
    mixer: Option<Box<Mixer>>,
    inbox: Consumer<Box<Mixer>>,
    outbox: Producer<Box<Mixer>>,
    clock: Clock,
}

/// The device's clock as the callback reads it: when a buffer is heard, and whether one was missed.
struct Clock {
    /// the device's own latency and its stream's, after the buffer's host time (ns; macOS, mac.rs)
    extra_ns: u64,
    /// the last callback's device timestamp, and how long its buffer was (ns)
    last: Option<(cpal::StreamInstant, u64)>,
    meters: Arc<Meters>,
}

impl Clock {
    fn new(extra_ns: u64, meters: Arc<Meters>) -> Self {
        Clock { extra_ns, last: None, meters }
    }
    /// When this buffer's first frame will be heard and the device's part of that (ns), counting a gap in the
    /// device's clock since the last buffer as buffers missed.
    #[inline]
    fn tick(&mut self, info: &cpal::OutputCallbackInfo, frames: usize, sr: f64) -> (u64, u64) {
        let ts = info.timestamp();
        let lat = ts.playback.duration_since(&ts.callback).unwrap_or_default().as_nanos() as u64 + self.extra_ns;
        let len = (frames as f64 / sr * 1e9) as u64;
        self.meters.buffer_frames.store(frames as u64, Relaxed);
        if let Some((prev, prev_len)) = self.last {
            if let Some(gap) = ts.callback.duration_since(&prev) {
                let gap = gap.as_nanos() as u64;
                if prev_len > 0 && gap > prev_len + prev_len / 2 {
                    self.meters.xruns.fetch_add(((gap + prev_len / 2) / prev_len).saturating_sub(1).max(1), Relaxed);
                }
            }
        }
        self.last = Some((ts.callback, len));
        let now = now_ns();
        // (macOS: the buffer's own host time, which cpal has, put on this program's clock)
        #[cfg(target_os = "macos")]
        if let Some(h) = crate::mac::instant_ns(&ts.callback) {
            let ahead = h as i64 - crate::mac::host_now_ns() as i64 + self.extra_ns as i64;
            let lat = ahead.max(0) as u64;
            return (now + lat, lat);
        }
        (now + lat, lat)
    }
    /// How long the buffer took to render, as a share of its own time.
    #[inline]
    fn busy(&self, started_ns: u64, frames: usize, sr: f64) {
        let len = frames as f64 / sr * 1e9;
        if len > 0.0 {
            self.meters.load.put(((now_ns().saturating_sub(started_ns)) as f64 / len) as f32);
        }
    }
}

/// What the device adds to cpal's idea of the delay (ns): on macOS its safety offset and latencies (mac.rs).
fn extra_ns(device: &cpal::Device, sr: f64) -> u64 {
    #[cfg(target_os = "macos")]
    {
        let name = device.name().ok();
        if let Some(x) = crate::mac::extra(name.as_deref()) {
            eprintln!("[native] the device's latency: {} frames and its stream's {} (its safety offset {})", x.device, x.stream, x.safety);
            return (crate::mac::heard_frames(&x) as f64 / sr * 1e9) as u64;
        }
    }
    let _ = (device, sr);
    0
}

impl Slot {
    /// The mixer for this buffer (None: it has not arrived, or has gone).
    #[inline]
    fn get(&mut self) -> Option<&mut Mixer> {
        if self.mixer.is_none() {
            self.mixer = self.inbox.pop().ok();
        }
        self.mixer.as_deref_mut()
    }
    /// After the buffer: the mixer handed back if it was asked for.
    #[inline]
    fn done(&mut self) {
        if self.mixer.as_ref().is_some_and(|m| m.detached) {
            if let Some(b) = self.mixer.take() {
                if let Err(rtrb::PushError::Full(b)) = self.outbox.push(b) {
                    self.mixer = Some(b);
                }
            }
        }
    }
}

/// A stream of f32 samples (the usual case): the mixer writes into the device's buffer directly.
fn build_f32(device: &cpal::Device, config: &cpal::StreamConfig, mut slot: Slot, errors: Sender<In>) -> Result<cpal::Stream, String> {
    let (ch, sr) = (config.channels as usize, config.sample_rate.0 as f64);
    let cb = move |data: &mut [f32], info: &cpal::OutputCallbackInfo| {
        let t0 = now_ns();
        let frames = data.len() / ch.max(1);
        let (present, lat) = slot.clock.tick(info, frames, sr);
        match slot.get() {
            Some(m) => m.render(data, present, lat),
            None => data.fill(0.0),
        }
        slot.clock.busy(t0, frames, sr);
        slot.done();
    };
    device
        .build_output_stream(
            config,
            cb,
            move |e| {
                let _ = errors.send(In::DeviceError(e.to_string()));
            },
            None,
        )
        .map_err(|e| e.to_string())
}

/// A stream of other samples: the mixer renders f32 into a buffer of its own (made here, large enough for any
/// buffer a device asks for, else rendered in parts), converted as it is copied out.
fn build_conv<T>(device: &cpal::Device, config: &cpal::StreamConfig, mut slot: Slot, errors: Sender<In>) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32> + Send + 'static,
{
    let ch = config.channels as usize;
    let mut scratch = vec![0f32; 8192 * ch];
    let sr = config.sample_rate.0 as f64;
    let cb = move |data: &mut [T], info: &cpal::OutputCallbackInfo| {
        let t0 = now_ns();
        let (present, lat) = slot.clock.tick(info, data.len() / ch.max(1), sr);
        let Some(m) = slot.get() else {
            data.fill(T::EQUILIBRIUM);
            return;
        };
        let mut at = 0;
        while at < data.len() {
            let n = (data.len() - at).min(scratch.len());
            let ns = present + ((at / ch) as f64 / sr * 1e9) as u64;
            m.render(&mut scratch[..n], ns, lat);
            for (d, s) in data[at..at + n].iter_mut().zip(&scratch[..n]) {
                *d = T::from_sample(*s);
            }
            at += n;
        }
        slot.clock.busy(t0, data.len() / ch.max(1), sr);
        slot.done();
    };
    device
        .build_output_stream(
            config,
            cb,
            move |e| {
                let _ = errors.send(In::DeviceError(e.to_string()));
            },
            None,
        )
        .map_err(|e| e.to_string())
}

impl Output for CpalOut {
    fn lister(&self) -> Box<dyn FnOnce() -> Value + Send> {
        let current = self.current.clone();
        Box::new(move || {
            let host = cpal::default_host();
            let mut list = vec![json!({ "id": "default", "label": "System default" })];
            if let Ok(devs) = host.output_devices() {
                for d in devs {
                    if let Ok(n) = d.name() {
                        list.push(json!({ "id": n, "label": n }));
                    }
                }
            }
            let inputs: Vec<String> = host.input_devices().map(|ds| ds.filter_map(|d| d.name().ok()).collect()).unwrap_or_default();
            json!({ "list": list, "inputs": inputs, "current": current })
        })
    }

    fn open(&mut self, id: Option<&str>, tx: &mut Producer<Msg>) -> Opened {
        let (sr0, ch0) = self.now;
        let device = match self.find(id) {
            Ok(d) => d,
            Err(e) => return Opened { sr: sr0, channels: ch0, id: self.current.clone(), fresh: None, error: Some(e) },
        };
        let mut fresh = None;
        let mixer = match self.take_back(tx) {
            Some(m) => m,
            None => {
                let (m, ends) = engine(sr0, ch0, self.meters.clone());
                fresh = Some((ends.tx, ends.rx));
                Box::new(m)
            }
        };
        drop(self.stream.take());
        self.back = None;
        let was = self.current.clone();
        match self.start(&device, mixer) {
            Ok(()) => {
                self.current = id.unwrap_or("default").to_string();
                Opened { sr: self.now.0, channels: self.now.1, id: self.current.clone(), fresh, error: None }
            }
            Err((e, mixer)) => {
                // back to the device it was on, if it is still there
                let old = if was == "default" { self.find(None) } else { self.find(Some(&was)) };
                match old {
                    Ok(d) => {
                        if let Err((_, m)) = self.start(&d, mixer) {
                            self.spare = Some(m);
                        }
                    }
                    Err(_) => self.spare = Some(mixer),
                }
                Opened { sr: self.now.0, channels: self.now.1, id: self.current.clone(), fresh, error: Some(e) }
            }
        }
    }
}
