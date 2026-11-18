//! The control thread: reads the host's commands (the audio window's, app/audio/preload.ts `AudioCommand`, with a
//! file given by its path), turns each into what the audio thread does (`Msg`), and says what happened in the audio
//! window's events (`AudioEvent`). It may allocate, wait and read files; the audio thread never does.

use crate::arith::{db_of, to_lin, Point};
use crate::mixer::{db1, Back, Bus, Msg, BLOCK};
use crate::params::SHAPE_MAX;
use crate::pcm::{self, path_of, Pcm};
use crate::shared::{now_ns, BusShared, Meters, VoiceShared, MAX_OUT};
use crate::stream::{self, StreamInfo};
use crate::voice::{BufHead, Head, Into, Lanes, Out, StreamHead, Voice};
use crossbeam_channel::Sender;
use rtrb::{Consumer, Producer};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::Ordering::Relaxed;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

/// What reaches the control thread: a line from the host, or word from one of its helpers.
pub enum In {
    Line(String),
    Decoded { file: String, path: String, result: Result<Pcm, String>, quiet: bool },
    Events(Vec<Value>),
    StreamFailed { id: u64, key: String, detail: String },
    DeviceError(String),
    Quit,
}

/// The device side, as the control thread drives it: what devices there are, and opening one.
pub trait Output {
    /// The `devices` event's fields: `list`, `inputs`, `current`.
    fn devices(&mut self) -> Value;
    /// Opens an output (None: the system's default), moving the mixer over to it. Says the rate, outputs and id
    /// of the device it is on afterwards (the old one, if the new one would not open: `error` says why), and, if
    /// the mixer could not be got back from the old device, the queues of a new one.
    fn open(&mut self, id: Option<&str>, tx: &mut Producer<Msg>) -> Opened;
}

/// The control thread's ends of the mixer: its queue in, its queue back, its meters.
pub struct Ends {
    pub tx: Producer<Msg>,
    pub rx: Consumer<Back>,
    pub meters: Arc<Meters>,
}

pub struct Opened {
    pub sr: f64,
    pub channels: usize,
    pub id: String,
    pub fresh: Option<(Producer<Msg>, Consumer<Back>)>,
    pub error: Option<String>,
}

/// No device at all (a test run, or an offline render): every open is refused.
pub struct NoOutput(pub f64, pub usize);
impl Output for NoOutput {
    fn devices(&mut self) -> Value {
        json!({ "list": [], "inputs": [], "current": { "type": "none" } })
    }
    fn open(&mut self, _id: Option<&str>, _tx: &mut Producer<Msg>) -> Opened {
        Opened { sr: self.0, channels: self.1, id: "default".into(), fresh: None, error: Some("a test run opens no audio device".into()) }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    Buf,
    Stream,
}

/// A sound the control thread knows is playing.
struct Rec {
    id: u64,
    shared: Arc<VoiceShared>,
    file: String,
    kind: Kind,
    stream: Option<Arc<StreamInfo>>,
    paused: bool,
    underruns: u64,
}

struct BusRec {
    idx: usize,
    db: f64,
    out: f64,
    shared: Arc<BusShared>,
}

pub struct Control {
    pub sr: f64,
    pub channels: usize,
    tx: Producer<Msg>,
    rx: Consumer<Back>,
    meters: Arc<Meters>,
    events: Sender<String>,
    helpers: Sender<In>,
    /// decode and probe here and now, not on a helper thread (tests, `measure`)
    pub inline: bool,
    out: Box<dyn Output>,
    device: String,
    voices: HashMap<String, Rec>,
    ids: HashMap<u64, String>,
    next_id: u64,
    buses: HashMap<String, BusRec>,
    bus_count: usize,
    cache: HashMap<String, Arc<Pcm>>,
    decoding: HashSet<String>,
    said: HashSet<(String, String)>,
    trims: Vec<f64>,
    master_db: f64,
    master_gain: Option<f64>,
    limiter: bool,
    outch_said: String,
}

fn num(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(Value::as_f64).filter(|x| x.is_finite())
}
fn text<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}
fn r1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}
/// The wall clock, in ms since 1970, as `Date.now()`.
pub fn wall_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}
/// A moment of `shared::epoch()` (ns) on the wall clock.
pub fn wall_of(ns: u64) -> f64 {
    wall_ms() - (now_ns() as f64 - ns as f64) / 1e6
}

/// A line's points as the show keeps them: [[seconds, value, bend?], …] (or { t, v, c } objects).
fn points(v: Option<&Value>) -> Vec<Point> {
    let Some(Value::Array(a)) = v else { return Vec::new() };
    let mut out = Vec::with_capacity(a.len());
    for p in a {
        let (t, x, c) = match p {
            Value::Array(q) => (q.first().and_then(Value::as_f64), q.get(1).and_then(Value::as_f64), q.get(2).and_then(Value::as_f64)),
            Value::Object(_) => (num(p, "at").or(num(p, "t")), num(p, "db").or(num(p, "v")).or(num(p, "value")), num(p, "c")),
            _ => (None, None, None),
        };
        match (t, x) {
            (Some(t), Some(x)) if t.is_finite() && x.is_finite() => out.push([t, x, c.filter(|c| c.is_finite()).unwrap_or(0.0)]),
            _ => return Vec::new(),
        }
    }
    out
}

impl Control {
    pub fn new(sr: f64, channels: usize, ends: Ends, events: Sender<String>, helpers: Sender<In>, out: Box<dyn Output>) -> Self {
        let Ends { tx, rx, meters } = ends;
        Control {
            sr,
            channels,
            tx,
            rx,
            meters,
            events,
            helpers,
            inline: false,
            out,
            device: "default".into(),
            voices: HashMap::new(),
            ids: HashMap::new(),
            next_id: 1,
            buses: HashMap::new(),
            bus_count: 0,
            cache: HashMap::new(),
            decoding: HashSet::new(),
            said: HashSet::new(),
            trims: vec![1.0; MAX_OUT],
            master_db: 0.0,
            master_gain: None,
            limiter: true,
            outch_said: String::new(),
        }
    }

    pub fn emit(&self, v: Value) {
        let _ = self.events.send(v.to_string());
    }
    fn send(&mut self, m: Msg) {
        if self.tx.push(m).is_err() {
            eprintln!("[native] the audio thread's queue is full: a command was lost");
        }
    }
    /// A command (or a part of one) this engine cannot carry out yet: said once for that op and key.
    fn not_yet(&mut self, op: &str, key: &str, what: &str) {
        if self.said.insert((op.to_string(), key.to_string())) {
            let detail =
                if what.is_empty() { "not in the native engine yet".to_string() } else { format!("not in the native engine yet: {what}") };
            self.emit(json!({ "type": "operror", "op": op, "key": key, "detail": detail }));
        }
    }

    /// The device, opened (None: the default). Says `sink` (when asked by a command) and `outputs`.
    pub fn open(&mut self, id: Option<&str>) -> Result<(), String> {
        let Opened { sr, channels, id, fresh, error } = self.out.open(id, &mut self.tx);
        if let Some((tx, rx)) = fresh {
            // the old device never gave the mixer back: a new one, set as the old one was (what was playing is gone)
            eprintln!("[native] the old device did not answer: starting the mixer again");
            self.tx = tx;
            self.rx = rx;
            for (_, r) in self.voices.drain() {
                self.ids.remove(&r.id);
            }
            let mut list: Vec<(String, usize, f64, f64)> = self.buses.iter().map(|(n, b)| (n.clone(), b.idx, b.db, b.out)).collect();
            list.sort_by_key(|b| b.1);
            self.buses.clear();
            self.bus_count = 0;
            for (name, _, db, out) in list {
                let idx = self.ensure_bus(&name);
                if let Some(b) = self.buses.get_mut(&name) {
                    b.out = out;
                }
                self.send(Msg::BusLevel { bus: idx, db, secs: 0.0 });
                self.route_bus(&name);
            }
            let db = self.master_db;
            self.send(Msg::Master { db, secs: 0.0 });
            if let Some(g) = self.master_gain {
                self.send(Msg::MasterGain(g));
            }
            let on = self.limiter;
            self.send(Msg::Limiter(on));
        }
        let rate_changed = (sr - self.sr).abs() > 0.5;
        self.sr = sr;
        self.channels = channels;
        self.device = id;
        // every bus finds its pair again (or finds it gone); the trims are the outputs'
        let names: Vec<String> = self.buses.keys().cloned().collect();
        for n in names {
            self.route_bus(&n);
        }
        for o in 0..MAX_OUT {
            let gain = self.trims[o];
            self.send(Msg::Trim { out: o, gain });
        }
        if rate_changed {
            // what was decoded ahead plays at the right speed as it is; it is decoded again at the new rate
            let stale: Vec<String> = self.cache.iter().filter(|(_, p)| p.sr as f64 != sr).map(|(k, _)| k.clone()).collect();
            for path in stale {
                self.decode_file(path.clone(), path, true);
            }
        }
        self.emit(json!({ "type": "outputs", "channels": channels }));
        error.map_or(Ok(()), Err)
    }

    // ── buses ──
    fn ensure_bus(&mut self, name: &str) -> usize {
        if let Some(b) = self.buses.get(name) {
            return b.idx;
        }
        let bus = Bus::new(0.0);
        let shared = bus.shared.clone();
        let idx = self.bus_count;
        self.bus_count += 1;
        self.send(Msg::AddBus(Box::new(bus)));
        self.buses.insert(name.to_string(), BusRec { idx, db: 0.0, out: 1.0, shared });
        idx
    }
    /// A bus to its pair (`out`: the first output of the pair, 1, 3, 5…); a pair the device does not have: nowhere.
    fn route_bus(&mut self, name: &str) {
        let Some(b) = self.buses.get(name) else { return };
        let want = ((b.out.max(1.0) - 1.0) / 2.0).floor() as usize;
        let pair = (want == 0 || want * 2 + 2 <= self.channels).then_some(want);
        let bus = b.idx;
        self.send(Msg::BusOut { bus, pair });
    }

    /// Takes a line from the host.
    pub fn line(&mut self, line: &str) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        match serde_json::from_str::<Value>(line) {
            Ok(cmd) => self.command(&cmd),
            Err(e) => eprintln!("[native] not a command ({e}): {}", line.chars().take(200).collect::<String>()),
        }
    }

    pub fn command(&mut self, c: &Value) {
        let op = text(c, "op").unwrap_or("");
        let key = text(c, "key").unwrap_or("").to_string();
        match op {
            "play" => self.play(c, &key),
            "stop" => self.stop(&key),
            "stopAll" => {
                self.send(Msg::StopAll);
                self.voices.clear();
                self.ids.clear();
            }
            "pause" => {
                if let Some(r) = self.voices.get_mut(&key) {
                    r.paused = true;
                    let id = r.id;
                    self.send(Msg::Pause(id));
                }
            }
            "resume" => self.resume(c, &key),
            "seek" => {
                if let Some(t) = num(c, "t") {
                    self.seek(&key, t.max(0.0));
                }
            }
            "fade" => self.fade(c, &key),
            "cut" => {
                if let (Some(id), Some(at)) = (self.id(&key), num(c, "at")) {
                    self.send(Msg::Cut(id, at));
                }
            }
            "loop" => {
                if let Some(r) = self.voices.get(&key) {
                    let on = c.get("on").and_then(Value::as_bool).unwrap_or(false);
                    if let Some(s) = &r.stream {
                        s.looping.store(on, Relaxed);
                    }
                    let id = r.id;
                    self.send(Msg::Loop(id, on));
                }
            }
            "region" => {
                if let Some(r) = self.voices.get(&key) {
                    let id = r.id;
                    let region = match (num(c, "start"), num(c, "end")) {
                        (Some(s), Some(e)) => Some((s, e)),
                        _ => None,
                    };
                    self.send(Msg::Region(id, region));
                }
            }
            "rate" => {
                if let (Some(id), Some(rate)) = (self.id(&key), num(c, "rate").filter(|r| *r > 0.0)) {
                    if c.get("preservePitch").and_then(Value::as_bool) == Some(true) {
                        self.not_yet("preservePitch", &key, "a rate that keeps the pitch (it plays as a tape)");
                    }
                    let secs = num(c, "secs").unwrap_or(0.0);
                    self.send(Msg::Rate { id, rate, secs });
                }
            }
            "others" => {
                if let Some(id) = self.id(&key) {
                    let db = num(c, "db").unwrap_or(0.0);
                    let secs = num(c, "secs").unwrap_or(0.0);
                    self.send(Msg::Others { id, db, secs });
                }
            }
            "lanes" => {
                if let Some(id) = self.id(&key) {
                    let lanes = self.lanes_of(c, &key);
                    self.send(Msg::Lanes(id, lanes));
                }
            }
            "move" => self.move_to(c, &key),
            "decode" => {
                if let Some(f) = text(c, "file").or(text(c, "url")) {
                    let path = path_of(f);
                    self.decode_file(f.to_string(), path, false);
                }
            }
            "keep" => self.keep(c),
            "probe" => self.probe(c),
            "where" => self.where_(c),
            "devices" => self.devices(),
            "sink" => self.sink(c),
            "master" => {
                if let Some(g) = num(c, "gain") {
                    self.master_gain = Some(g);
                    self.send(Msg::MasterGain(g));
                }
            }
            "masterDb" => {
                let db = num(c, "db").unwrap_or(0.0);
                let secs = num(c, "secs").unwrap_or(0.03);
                self.master_db = db;
                self.master_gain = None;
                self.send(Msg::Master { db, secs });
            }
            "limiter" => {
                let on = c.get("on").and_then(Value::as_bool) != Some(false);
                self.limiter = on;
                self.send(Msg::Limiter(on));
            }
            "bus" => {
                if let Some(name) = text(c, "name") {
                    let idx = self.ensure_bus(name);
                    let db = num(c, "db").unwrap_or(0.0);
                    let secs = num(c, "secs").unwrap_or(0.0);
                    if let Some(b) = self.buses.get_mut(name) {
                        b.db = db;
                    }
                    self.send(Msg::BusLevel { bus: idx, db, secs });
                }
            }
            "buses" => self.set_buses(c),
            "outputs" => {
                let trims = c.get("trims").and_then(Value::as_object).cloned().unwrap_or_default();
                for o in 0..MAX_OUT {
                    let db = trims.get(&(o + 1).to_string()).and_then(Value::as_f64).unwrap_or(0.0);
                    let gain = if db < 0.0 { to_lin(db.max(-60.0)) } else { 1.0 };
                    if gain != self.trims[o] {
                        self.trims[o] = gain;
                        self.send(Msg::Trim { out: o, gain });
                    }
                }
            }
            "monitor" => {
                let on = c.get("on").and_then(Value::as_bool).unwrap_or(false);
                if on {
                    self.not_yet("monitor", "", "the monitor feed");
                }
                self.emit(json!({ "type": "monitor", "on": false, "wanted": on, "out": c.get("out").cloned().unwrap_or(json!(2)), "channels": self.channels }));
            }
            "ducker" => {
                let rules = c.get("rules").and_then(Value::as_array).map(|a| !a.is_empty()).unwrap_or(false);
                if rules || c.get("on").and_then(Value::as_bool) == Some(true) {
                    self.not_yet("ducker", "", "ducking by listening");
                }
            }
            "duck" => {
                if num(c, "db").unwrap_or(0.0) != 0.0 {
                    self.not_yet("duck", text(c, "bus").unwrap_or(""), "the ducker's dip");
                }
            }
            "record" => {
                if c.get("on").and_then(Value::as_bool) == Some(true) {
                    self.not_yet("record", "", "recording");
                }
            }
            "design" | "sweep" | "ir" | "strips" | "fx" | "midi" | "ltc" | "ltc-in" | "peaks" | "pcm" => {
                let what = match op {
                    "design" | "sweep" | "ir" => "sound design",
                    "strips" => "the Live desk",
                    "fx" => "the reverb and delay sends",
                    "midi" => "MIDI (the audio window sends it)",
                    "ltc" | "ltc-in" => "LTC",
                    _ => "waveforms and samples (the audio window reads them)",
                };
                let k = text(c, "key").or(text(c, "file")).unwrap_or("").to_string();
                self.not_yet(op, &k, what);
            }
            "" => eprintln!("[native] a command with no op"),
            other => self.not_yet(other, &key, ""),
        }
    }

    fn id(&self, key: &str) -> Option<u64> {
        self.voices.get(key).map(|r| r.id)
    }

    fn lanes_of(&mut self, c: &Value, key: &str) -> Box<Lanes> {
        let auto = c.get("automation").and_then(Value::as_object);
        if let Some(a) = auto {
            if a.keys().any(|k| k != "pan") {
                self.not_yet("automation", key, "lines over a sound's design (only Volume and Pan play)");
            }
        }
        Box::new(Lanes {
            env: points(c.get("envelope")),
            pan: points(auto.and_then(|a| a.get("pan"))),
            pan_base: num(c, "pan").unwrap_or(0.0),
        })
    }

    fn stop(&mut self, key: &str) {
        if let Some(r) = self.voices.remove(key) {
            self.ids.remove(&r.id);
            self.send(Msg::Stop(r.id));
        }
    }

    fn play(&mut self, c: &Value, key: &str) {
        self.stop(key);
        if c.get("mic").is_some_and(|m| !m.is_null()) {
            self.not_yet("mic", key, "microphones");
            return;
        }
        let Some(file) = text(c, "file").or(text(c, "url")).map(str::to_string) else {
            self.emit(json!({ "type": "error", "key": key, "url": "", "detail": "no file" }));
            return;
        };
        let path = path_of(&file);
        let own = c.get("own").filter(|o| o.is_object());
        let mut out = None;
        if let Some(o) = own {
            let has = |k: &str| o.get(k).is_some_and(|v| !v.is_null() && v.as_object().map(|m| !m.is_empty()).unwrap_or(true));
            if has("chain") || has("eq") {
                self.not_yet("design", key, "sound design (it plays without it)");
            }
            if o.get("outputs").and_then(Value::as_array).is_some_and(|a| !a.is_empty()) {
                self.not_yet("outputs", key, "a sound's outputs of its own (it plays on its bus)");
            }
            if let Some(a) = num(o, "audition").filter(|a| *a >= 1.0) {
                let k = ((a - 1.0) / 2.0).floor() as usize;
                out = Some(if k == 0 || k * 2 + 2 <= self.channels { Out::Pair(k) } else { Out::Nowhere });
            }
        }
        let out = match out {
            Some(o) => o,
            None => Out::Bus(self.ensure_bus(text(c, "bus").unwrap_or("effects"))),
        };
        let gain_db = num(c, "gainDb").unwrap_or(0.0);
        let from = num(c, "from").unwrap_or(0.0).max(0.0);
        let looped = c.get("loop").and_then(Value::as_bool).unwrap_or(false);
        let rate = num(c, "rate").filter(|r| *r > 0.0).unwrap_or(1.0);
        if c.get("preservePitch").and_then(Value::as_bool) == Some(true) && rate != 1.0 {
            self.not_yet("preservePitch", key, "a rate that keeps the pitch (it plays as a tape)");
        }
        let exact = c.get("exact").and_then(Value::as_bool).unwrap_or(false);
        let lanes = self.lanes_of(c, key);
        let id = self.next_id;
        self.next_id += 1;
        let (head, kind, info) = match self.cache.get(&path) {
            Some(pcm) => {
                let pcm = pcm.clone();
                let last = (pcm.secs() - 0.01).max(0.0);
                (Head::Buf(BufHead::new(pcm, from.min(last), looped)), Kind::Buf, None)
            }
            None => {
                let helpers = self.helpers.clone();
                let k = key.to_string();
                match stream::start(PathBuf::from(&path), from, self.sr as u32, looped, move |detail| {
                    let _ = helpers.send(In::StreamFailed { id, key: k, detail });
                }) {
                    Ok(r) => {
                        let info = r.info.clone();
                        (Head::Stream(StreamHead::new(r)), Kind::Stream, Some(info))
                    }
                    Err(detail) => {
                        self.emit(json!({ "type": "error", "key": key, "url": file, "detail": detail }));
                        return;
                    }
                }
            }
        };
        let voice = Voice::new(id, head, gain_db, rate, lanes, out);
        let shared = voice.shared.clone();
        self.send(Msg::Play(Box::new(voice)));
        if kind == Kind::Buf || exact {
            self.emit(json!({ "type": "mode", "key": key, "exact": kind == Kind::Buf }));
        }
        self.voices.insert(key.to_string(), Rec { id, shared, file: path, kind, stream: info, paused: false, underruns: 0 });
        self.ids.insert(id, key.to_string());
    }

    /// A streamed sound from a new place: a new stream, taken over once it has something to play.
    fn restream(&mut self, key: &str, t: f64, delay: f64, out_s: f64, gap: f64, in_s: f64) {
        let Some(r) = self.voices.get(key) else { return };
        let (id, path) = (r.id, r.file.clone());
        let looping = r.stream.as_ref().map(|s| s.looping.load(Relaxed)).unwrap_or(false);
        let helpers = self.helpers.clone();
        let k = key.to_string();
        match stream::start(PathBuf::from(&path), t, self.sr as u32, looping, move |detail| {
            let _ = helpers.send(In::StreamFailed { id, key: k, detail });
        }) {
            Ok(rd) => {
                if let Some(r) = self.voices.get_mut(key) {
                    r.stream = Some(rd.info.clone());
                }
                self.send(Msg::Swap { id, into: Into::Given(Head::Stream(StreamHead::new(rd))), delay, out_s, in_s, gap });
            }
            Err(detail) => self.emit(json!({ "type": "error", "key": key, "url": path, "detail": detail })),
        }
    }

    fn seek(&mut self, key: &str, t: f64) {
        let Some(r) = self.voices.get(key) else { return };
        match r.kind {
            Kind::Buf => {
                let id = r.id;
                self.send(Msg::Seek(id, t));
            }
            Kind::Stream => self.restream(key, t, 0.0, 0.005, 0.0, 0.005),
        }
    }

    fn resume(&mut self, c: &Value, key: &str) {
        let Some(r) = self.voices.get_mut(key) else { return };
        r.paused = false;
        let (id, kind) = (r.id, r.kind);
        let t = num(c, "t");
        match (kind, t) {
            (Kind::Stream, Some(t)) => {
                self.restream(key, t.max(0.0), 0.0, 0.005, 0.0, 0.005);
                self.send(Msg::Resume(id, None));
            }
            _ => self.send(Msg::Resume(id, t.map(|t| t.max(0.0)))),
        }
    }

    fn fade(&mut self, c: &Value, key: &str) {
        let Some(id) = self.id(key) else { return };
        if text(c, "range") == Some("voice") {
            self.not_yet("fade", key, "a fade of the voice range (the level is left as it is)");
            return;
        }
        let db = num(c, "db").unwrap_or(0.0);
        let secs = num(c, "secs").unwrap_or(0.0);
        let mut shape = Box::new([0f64; SHAPE_MAX]);
        let mut len = 0;
        if let Some(a) = c.get("shape").and_then(Value::as_array) {
            let s: Vec<f64> = a.iter().filter_map(Value::as_f64).collect();
            if s.len() >= 2 {
                len = s.len().min(SHAPE_MAX);
                for (k, x) in shape[..len].iter_mut().enumerate() {
                    *x = if len == s.len() { s[k] } else { crate::arith::along(&s, k as f64 / (len - 1) as f64) };
                }
            }
        }
        self.send(Msg::Fade { id, db, secs, shape, len });
    }

    fn move_to(&mut self, c: &Value, key: &str) {
        let Some(r) = self.voices.get(key) else { return };
        let Some(sync) = c.get("sync").filter(|s| s.is_object()) else { return };
        let (id, kind) = (r.id, r.kind);
        let to = num(c, "to").unwrap_or(0.0).max(0.0);
        let xf = num(sync, "xf").unwrap_or(0.0).max(0.005);
        let lead = num(sync, "lead").unwrap_or(0.0).max(0.0);
        let blend = text(sync, "blend").unwrap_or("fade");
        let region = c.get("region").and_then(|g| Some((num(g, "start")?, num(g, "end")?))).filter(|(s, e)| e > s);
        match kind {
            Kind::Buf => {
                if blend == "dj" {
                    self.not_yet("move", key, "the bass swap of a dj blend (it crossfades)");
                }
                self.send(Msg::Move { id, to, region, lead, at: num(sync, "at"), xf, power: blend != "cut" });
            }
            // a stream can only jump: a 30 ms dip, then it plays from the new place
            Kind::Stream => self.restream(key, to + xf / 2.0, (lead + xf / 2.0 - 0.03).max(0.0), 0.03, 0.035, 0.05),
        }
    }

    // ── files ──
    fn decode_file(&mut self, file: String, path: String, quiet: bool) {
        if !quiet && (self.cache.contains_key(&path) || self.decoding.contains(&path)) {
            return;
        }
        self.decoding.insert(path.clone());
        let sr = self.sr as u32;
        if self.inline {
            let result = pcm::decode(std::path::Path::new(&path), sr);
            self.decoded(file, path, result, quiet);
            return;
        }
        let helpers = self.helpers.clone();
        let _ = std::thread::Builder::new().name("ec-decode".into()).spawn(move || {
            let result = pcm::decode(std::path::Path::new(&path), sr);
            let _ = helpers.send(In::Decoded { file, path, result, quiet });
        });
    }

    /// A file decoded: kept, said, and whatever is streaming it moves over to the buffer.
    pub fn decoded(&mut self, file: String, path: String, result: Result<Pcm, String>, quiet: bool) {
        if !self.decoding.remove(&path) {
            return; // let go while decoding (`keep`)
        }
        match result {
            Ok(pcm) => {
                let secs = pcm.secs();
                let pcm = Arc::new(pcm);
                self.cache.insert(path.clone(), pcm.clone());
                if !quiet {
                    self.emit(json!({ "type": "decoded", "file": file, "secs": r1(secs) }));
                }
                let moving: Vec<String> = self
                    .voices
                    .iter()
                    .filter(|(_, r)| r.kind == Kind::Stream && r.file == path && r.shared.pos.get() < secs - 0.25)
                    .map(|(k, _)| k.clone())
                    .collect();
                for key in moving {
                    if let Some(r) = self.voices.get_mut(&key) {
                        r.kind = Kind::Buf;
                        let id = r.id;
                        self.send(Msg::Swap { id, into: Into::Upgrade(pcm.clone()), delay: 0.0, out_s: 0.03, in_s: 0.03, gap: 0.0 });
                        self.emit(json!({ "type": "mode", "key": key, "exact": true }));
                    }
                }
            }
            Err(e) => {
                if !quiet {
                    self.emit(json!({ "type": "decoded", "file": file, "secs": 0, "error": e }));
                }
            }
        }
    }

    /// Let go of decoded files no longer wanted (a sound playing from one keeps it until it ends).
    fn keep(&mut self, c: &Value) {
        let mut want = HashSet::new();
        for k in ["urls", "files"] {
            if let Some(a) = c.get(k).and_then(Value::as_array) {
                for f in a.iter().filter_map(Value::as_str) {
                    want.insert(path_of(f));
                }
            }
        }
        self.cache.retain(|p, _| want.contains(p));
        self.decoding.retain(|p| want.contains(p));
    }

    fn probe(&mut self, c: &Value) {
        let files: Vec<(String, String)> = c
            .get("files")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|f| {
                        let file = text(f, "file").or(text(f, "url"))?;
                        Some((file.to_string(), path_of(text(f, "file").unwrap_or(file))))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let work = move || {
            files
                .into_iter()
                .map(|(file, path)| match pcm::probe(std::path::Path::new(&path)) {
                    Ok(secs) => json!({ "type": "duration", "file": file, "secs": secs }),
                    Err(_) => json!({ "type": "missing", "file": file }),
                })
                .collect::<Vec<Value>>()
        };
        if self.inline {
            for e in work() {
                self.emit(e);
            }
            return;
        }
        let helpers = self.helpers.clone();
        let _ = std::thread::Builder::new().name("ec-probe".into()).spawn(move || {
            let _ = helpers.send(In::Events(work()));
        });
    }

    /// Where each sound is in its file, and when that was so (the wall clock).
    fn where_(&mut self, c: &Value) {
        let keys: Vec<String> = match c.get("keys").and_then(Value::as_array) {
            Some(a) => a.iter().filter_map(Value::as_str).map(str::to_string).collect(),
            None => self.voices.keys().cloned().collect(),
        };
        let at = wall_of(self.meters.frame_ns.load(Relaxed));
        for key in keys {
            if let Some(r) = self.voices.get(&key) {
                if r.paused || !r.shared.playing.load(Relaxed) {
                    continue;
                }
                self.emit(json!({ "type": "where", "key": key, "t": r.shared.pos.get(), "at": at }));
            }
        }
    }

    fn devices(&mut self) {
        let mut d = self.out.devices();
        if let Some(o) = d.as_object_mut() {
            o.insert("type".into(), json!("devices"));
        }
        self.emit(d);
    }

    fn sink(&mut self, c: &Value) {
        let id = text(c, "id").map(str::to_string);
        let fallback = c.get("fallback").and_then(Value::as_bool).unwrap_or(false);
        let want = id.clone().filter(|i| !i.is_empty() && i != "default");
        match self.open(want.as_deref()) {
            Ok(()) => self.emit(json!({ "type": "sink", "id": id.unwrap_or_else(|| "default".into()), "ok": true, "fallback": fallback })),
            Err(detail) => self.emit(json!({ "type": "sink", "id": id, "ok": false, "detail": detail, "fallback": fallback })),
        }
        self.devices();
    }

    fn set_buses(&mut self, c: &Value) {
        let Some(list) = c.get("list").and_then(Value::as_array) else { return };
        for b in list {
            let Some(name) = text(b, "id") else { continue };
            let idx = self.ensure_bus(name);
            let db = num(b, "db").unwrap_or(0.0);
            let out = num(b, "out").filter(|o| *o > 1.0).unwrap_or(1.0);
            if let Some(r) = self.buses.get_mut(name) {
                r.db = db;
                r.out = out;
            }
            self.send(Msg::BusLevel { bus: idx, db, secs: 0.02 });
            self.route_bus(name);
            if num(b, "reverb").is_some_and(|x| x > -60.0) || num(b, "delay").is_some_and(|x| x > -60.0) {
                self.not_yet("fx", name, "the reverb and delay sends");
            }
        }
    }

    /// What the audio thread has said since: sounds that ended, and what it has finished with (let go of here).
    pub fn poll(&mut self) {
        while let Ok(b) = self.rx.pop() {
            match b {
                Back::Ended(id) => {
                    if let Some(key) = self.ids.remove(&id) {
                        if self.voices.get(&key).is_some_and(|r| r.id == id) {
                            self.voices.remove(&key);
                            self.emit(json!({ "type": "ended", "key": key }));
                        }
                    }
                }
                Back::Trash(t) => drop(t),
            }
        }
    }

    pub fn stream_failed(&mut self, id: u64, key: String, detail: String) {
        if self.voices.get(&key).is_some_and(|r| r.id == id) {
            let file = self.voices.get(&key).map(|r| r.file.clone()).unwrap_or_default();
            self.stop(&key);
            self.emit(json!({ "type": "error", "key": key, "url": file, "detail": detail }));
        }
    }

    pub fn device_error(&mut self, detail: String) {
        eprintln!("[native] the output device: {detail}");
        self.emit(json!({ "type": "ctx", "state": "interrupted", "error": true }));
        self.devices();
    }

    /// The meters, as the audio window's `level` (and `outch` when it changes): about 30 times a second.
    pub fn level(&mut self) {
        let m = &self.meters;
        let frames = m.frames.swap(0, Relaxed).max(1) as f64;
        let ch = self.channels.min(MAX_OUT);
        let mut channels = Vec::with_capacity(ch);
        let mut pre = Vec::with_capacity(ch);
        for o in 0..ch.max(2) {
            let p = m.post[o].take() as f64;
            let rms = (m.sq[o].take() / frames).sqrt();
            channels.push(json!({ "peak": r1(db_of(p)), "rms": r1(db_of(rms)) }));
            pre.push(m.pre[o].take());
        }
        let outs: Vec<f64> = pre.chunks(2).map(|p| db1(p.iter().fold(0f32, |a, b| a.max(*b)))).collect();
        let outch: Vec<i64> = pre.iter().map(|p| db_of(*p as f64).round() as i64).collect();
        let main = db_of(m.main.take() as f64);
        let limiting = m.limited.take() as f64 > 1.0 - to_lin(-0.5);
        let mut buses = Map::new();
        for (name, b) in &self.buses {
            buses.insert(name.clone(), json!(db1(b.shared.peak.take())));
        }
        let mut cues = Map::new();
        let mut slow = Vec::new();
        for (key, r) in &mut self.voices {
            cues.insert(key.clone(), json!(db_of(r.shared.peak.take() as f64).round() as i64));
            if let Some(s) = &r.stream {
                let u = s.underruns.load(Relaxed);
                if u > r.underruns {
                    slow.push((key.clone(), u - r.underruns));
                    r.underruns = u;
                }
            }
        }
        for (key, n) in slow {
            eprintln!("[native] {key}: the stream ran dry {n} times (the disk was slow)");
        }
        let said = outch.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(",");
        if said != self.outch_said {
            self.outch_said = said;
            self.emit(json!({ "type": "outch", "ch": outch }));
        }
        self.emit(json!({
            "type": "level", "monitor": null, "ducking": false, "ducked": [], "db": main, "channels": channels,
            "buses": buses, "outs": outs, "cues": cues, "voices": self.voices.len(), "limiting": limiting,
        }));
    }

    /// The moment (ns since `shared::epoch()`) a sound's first sample was heard, once it has been.
    pub fn started_ns(&self, key: &str) -> Option<u64> {
        self.voices.get(key).map(|r| r.shared.started_ns.load(Relaxed)).filter(|n| *n != u64::MAX)
    }
    /// The mixer's frame a sound's first sample is at, once it has played.
    pub fn started_frame(&self, key: &str) -> Option<u64> {
        self.voices.get(key).map(|r| r.shared.started_frame.load(Relaxed)).filter(|n| *n != u64::MAX)
    }
    /// A decoded sound put in the cache directly (tests, `measure`).
    pub fn insert(&mut self, path: &str, pcm: Pcm) {
        self.cache.insert(path.to_string(), Arc::new(pcm));
    }
    pub fn playing(&self) -> usize {
        self.voices.len()
    }
}

/// The block the silent clock renders at a time.
pub const SILENT_BLOCK: usize = BLOCK / 2;
