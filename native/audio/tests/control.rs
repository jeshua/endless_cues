//! The control thread on its own: what it does while something slow is going on.

use crossbeam_channel::unbounded;
use ec_audio::control::{Control, In, Opened, Output};
use ec_audio::device::engine;
use ec_audio::mixer::Msg;
use ec_audio::pcm::Pcm;
use ec_audio::shared::Meters;
use rtrb::Producer;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// A device whose list takes as long as CoreAudio's (a third of a second).
struct Slow;
impl Output for Slow {
    fn lister(&self) -> Box<dyn FnOnce() -> Value + Send> {
        Box::new(|| {
            std::thread::sleep(Duration::from_millis(300));
            json!({ "list": [{ "id": "default", "label": "System default" }], "inputs": [], "current": "default" })
        })
    }
    fn open(&mut self, _id: Option<&str>, _tx: &mut Producer<Msg>) -> Opened {
        Opened { sr: 48000.0, channels: 2, id: "default".into(), fresh: None, error: None }
    }
}

#[test]
fn a_go_is_not_kept_waiting_by_the_list_of_devices() {
    let meters = Arc::new(Meters::default());
    let (ev_tx, events) = unbounded();
    let (in_tx, in_rx) = unbounded();
    let (_mixer, ends) = engine(48000.0, 2, meters);
    let mut c = Control::new(48000.0, 2, ends, ev_tx, in_tx, Box::new(Slow));
    c.insert("/a.wav", Pcm::new(48000, 2, vec![0.1; 4800]));
    let t = Instant::now();
    c.command(&json!({ "op": "devices" }));
    c.command(&json!({ "op": "play", "key": "a", "file": "/a.wav", "exact": true }));
    assert!(t.elapsed() < Duration::from_millis(50), "the play was taken at once: {:?}", t.elapsed());
    let first: Value = serde_json::from_str(&events.recv_timeout(Duration::from_secs(1)).unwrap()).unwrap();
    assert_eq!(first["type"], "mode", "the play is said before the devices are");
    // the list arrives later, from its helper, for the control thread to say
    match in_rx.recv_timeout(Duration::from_secs(2)).unwrap() {
        In::Events(list) => assert_eq!(list[0]["type"], "devices"),
        _ => panic!("the devices"),
    }
}
