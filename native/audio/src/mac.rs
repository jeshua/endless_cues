//! macOS: what an output device adds to the delay to the ear, which cpal does not say. cpal's timestamps on macOS
//! put a buffer's playing one buffer after its callback ("for now we assume a double-buffer offset"); the device
//! also holds a safety offset, its own latency and its stream's latency, in frames (CoreAudio's
//! kAudioDevicePropertySafetyOffset, kAudioDevicePropertyLatency and kAudioStreamPropertyLatency). Chromium adds the
//! device and stream latencies (not the safety offset) to Web Audio's `outputLatency`, so the two engines are
//! measured alike.
//!
//! And the moment a buffer is heard: cpal's timestamp is CoreAudio's own (the buffer's host time, when its first
//! frame reaches the device), but cpal keeps it to itself except relative to another; `instant_ns` reads it out
//! (without allocating) so that it can be put on this program's clock.

use coreaudio::audio_unit::macos_helpers::{get_default_device_id, get_device_id_from_name};
use coreaudio::sys::{
    kAudioDevicePropertyLatency, kAudioDevicePropertySafetyOffset, kAudioDevicePropertyStreams, kAudioHardwareNoError,
    kAudioObjectPropertyElementMaster, kAudioObjectPropertyScopeOutput, kAudioStreamPropertyLatency, AudioDeviceID,
    AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize, AudioObjectID, AudioObjectPropertyAddress,
};
use coreaudio::sys::{AudioConvertHostTimeToNanos, AudioGetCurrentHostTime};
use std::fmt::Write;
use std::ptr::null;

/// CoreAudio's host clock now, in ns (the clock a buffer's timestamp is on).
#[inline]
pub fn host_now_ns() -> u64 {
    // SAFETY: plain reads of the host clock.
    unsafe { AudioConvertHostTimeToNanos(AudioGetCurrentHostTime()) }
}

/// A cpal timestamp as CoreAudio's host clock in ns (cpal makes it from the host time and offers no way to read it
/// but its Debug form, `StreamInstant { secs: S, nanos: N }`, which is written here into a buffer on the stack).
#[inline]
pub fn instant_ns(t: &cpal::StreamInstant) -> Option<u64> {
    struct Buf([u8; 96], usize);
    impl Write for Buf {
        fn write_str(&mut self, s: &str) -> std::fmt::Result {
            let b = s.as_bytes();
            if self.1 + b.len() > self.0.len() {
                return Err(std::fmt::Error);
            }
            self.0[self.1..self.1 + b.len()].copy_from_slice(b);
            self.1 += b.len();
            Ok(())
        }
    }
    let mut b = Buf([0; 96], 0);
    write!(b, "{t:?}").ok()?;
    let mut nums = [0u64; 2];
    let mut k = 0;
    let mut inside = false;
    for &c in &b.0[..b.1] {
        if c.is_ascii_digit() {
            if k >= 2 {
                return None;
            }
            nums[k] = nums[k].checked_mul(10)?.checked_add((c - b'0') as u64)?;
            inside = true;
        } else if inside {
            inside = false;
            k += 1;
        }
    }
    if inside {
        k += 1;
    }
    (k == 2).then(|| nums[0] * 1_000_000_000 + nums[1])
}

/// The device's latency as Chromium counts it (its own and its stream's), in frames.
pub fn heard_frames(x: &Extra) -> u32 {
    x.device + x.stream
}

/// The device's frames between the end of its buffer and the ear: (safety offset, its latency, its stream's).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Extra {
    pub safety: u32,
    pub device: u32,
    pub stream: u32,
}
impl Extra {
    pub fn frames(&self) -> u32 {
        self.safety + self.device + self.stream
    }
}

fn u32_of(obj: AudioObjectID, selector: u32, scope: u32) -> Option<u32> {
    let addr = AudioObjectPropertyAddress { mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMaster };
    let mut v: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    // SAFETY: a u32 property read into a u32, its size said.
    let status = unsafe { AudioObjectGetPropertyData(obj, &addr, 0, null(), &mut size, &mut v as *mut u32 as *mut _) };
    (status == kAudioHardwareNoError as i32).then_some(v)
}

fn first_stream(dev: AudioDeviceID, scope: u32) -> Option<AudioObjectID> {
    let addr =
        AudioObjectPropertyAddress { mSelector: kAudioDevicePropertyStreams, mScope: scope, mElement: kAudioObjectPropertyElementMaster };
    let mut size = 0u32;
    // SAFETY: the size of a list of stream ids, then the list into a Vec of that many.
    unsafe {
        if AudioObjectGetPropertyDataSize(dev, &addr, 0, null(), &mut size) != kAudioHardwareNoError as i32 || size == 0 {
            return None;
        }
        let mut ids = vec![0 as AudioObjectID; size as usize / std::mem::size_of::<AudioObjectID>()];
        if AudioObjectGetPropertyData(dev, &addr, 0, null(), &mut size, ids.as_mut_ptr() as *mut _) != kAudioHardwareNoError as i32 {
            return None;
        }
        ids.first().copied()
    }
}

/// The device by its name (None: the default output).
pub fn extra(name: Option<&str>) -> Option<Extra> {
    extra_of(name, kAudioObjectPropertyScopeOutput)
}
/// The same for an input (its stream's latency, its own, its safety offset: between the sound arriving and the
/// time its buffer is stamped with).
pub fn extra_in(name: &str) -> Option<Extra> {
    extra_of(Some(name), coreaudio::sys::kAudioObjectPropertyScopeInput)
}

fn extra_of(name: Option<&str>, scope: u32) -> Option<Extra> {
    let dev = match name {
        Some(n) => get_device_id_from_name(n)?,
        None => get_default_device_id(false)?,
    };
    let global = coreaudio::sys::kAudioObjectPropertyScopeGlobal;
    Some(Extra {
        safety: u32_of(dev, kAudioDevicePropertySafetyOffset, scope).unwrap_or(0),
        device: u32_of(dev, kAudioDevicePropertyLatency, scope).unwrap_or(0),
        stream: first_stream(dev, scope)
            .and_then(|s| u32_of(s, kAudioStreamPropertyLatency, global).or_else(|| u32_of(s, kAudioStreamPropertyLatency, scope)))
            .unwrap_or(0),
    })
}

/// Says when the computer's devices change (one plugged in or taken out) or its default output does: `changed` is
/// called on CoreAudio's own thread with whether the default output changed. For the life of the program.
pub fn watch(changed: impl Fn(bool) + Send + Sync + 'static) {
    use coreaudio::sys::{
        kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal,
        kAudioObjectSystemObject, AudioObjectAddPropertyListener, OSStatus,
    };
    type Said = Box<dyn Fn(bool) + Send + Sync>;
    unsafe extern "C" fn heard(
        _: AudioObjectID,
        n: u32,
        addrs: *const AudioObjectPropertyAddress,
        data: *mut std::ffi::c_void,
    ) -> OSStatus {
        // SAFETY: CoreAudio passes the client data it was given (a leaked Said) and `n` addresses.
        let said = unsafe { &*(data as *const Said) };
        let list = unsafe { std::slice::from_raw_parts(addrs, n as usize) };
        said(list.iter().any(|a| a.mSelector == kAudioHardwarePropertyDefaultOutputDevice));
        0
    }
    let said: &'static Said = Box::leak(Box::new(Box::new(changed) as Said));
    for sel in [kAudioHardwarePropertyDevices, kAudioHardwarePropertyDefaultOutputDevice] {
        let addr = AudioObjectPropertyAddress {
            mSelector: sel,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMaster,
        };
        // SAFETY: a listener on the system object with data that lives for the program.
        let st = unsafe { AudioObjectAddPropertyListener(kAudioObjectSystemObject, &addr, Some(heard), said as *const Said as *mut _) };
        if st != 0 {
            eprintln!("[native] the devices cannot be watched ({st})");
        }
    }
}
