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
use std::sync::Arc;
use std::time::{Duration, Instant};

/// A new mixer and the ends of its two queues (the control thread keeps `Producer<Msg>` and `Consumer<Back>`).
pub fn engine(sr: f64, channels: usize, meters: Arc<Meters>) -> (Mixer, Ends) {
    let (tx, rx) = RingBuffer::<Msg>::new(8192);
    let (btx, brx) = RingBuffer::<Back>::new(16384);
    (Mixer::new(sr, channels, rx, btx, meters.clone()), Ends { tx, rx: brx, meters })
}

/// A test run's clock: no device, the mixer rendered in real time on a thread of its own (into nothing).
pub fn run_silent(mut mixer: Mixer, block: usize) {
    std::thread::Builder::new()
        .name("ec-silent".into())
        .spawn(move || {
            let ch = mixer.channels;
            let mut buf = vec![0f32; block * ch];
            let period = Duration::from_secs_f64(block as f64 / mixer.sr);
            let mut next = Instant::now();
            loop {
                mixer.render(&mut buf, now_ns(), 0);
                next += period;
                let now = Instant::now();
                if next > now {
                    std::thread::sleep(next - now);
                } else if now - next > Duration::from_millis(200) {
                    next = now; // (the computer slept: carry on from now, not by catching up)
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
        let slot = Slot { mixer: None, inbox, outbox };
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

/// When the buffer's first frame will be heard, and the device's own part of that, from cpal's timestamps.
#[inline]
fn when(info: &cpal::OutputCallbackInfo) -> (u64, u64) {
    let ts = info.timestamp();
    let lat = ts.playback.duration_since(&ts.callback).unwrap_or_default().as_nanos() as u64;
    (now_ns() + lat, lat)
}

/// A stream of f32 samples (the usual case): the mixer writes into the device's buffer directly.
fn build_f32(device: &cpal::Device, config: &cpal::StreamConfig, mut slot: Slot, errors: Sender<In>) -> Result<cpal::Stream, String> {
    let cb = move |data: &mut [f32], info: &cpal::OutputCallbackInfo| {
        let (present, lat) = when(info);
        match slot.get() {
            Some(m) => m.render(data, present, lat),
            None => data.fill(0.0),
        }
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
        let (present, lat) = when(info);
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
    fn devices(&mut self) -> Value {
        let mut list = vec![json!({ "id": "default", "label": "System default" })];
        if let Ok(devs) = self.host.output_devices() {
            for d in devs {
                if let Ok(n) = d.name() {
                    list.push(json!({ "id": n, "label": n }));
                }
            }
        }
        let inputs: Vec<String> = self.host.input_devices().map(|ds| ds.filter_map(|d| d.name().ok()).collect()).unwrap_or_default();
        json!({ "list": list, "inputs": inputs, "current": self.current })
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
