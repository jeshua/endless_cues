//! Levels that move, one step a sample. Each is the Web Audio automation the audio window uses for the same job,
//! computed here on the audio thread: nothing allocates.

use crate::arith::{along, to_db, to_lin};

/// The most numbers a fade's shape keeps (the host sends 65; more are read down to this many).
pub const SHAPE_MAX: usize = 129;

/// A gain that glides to where it is sent as `setTargetAtTime` does: an exponential approach in gain, with a time
/// constant of a third of the time asked for (by then it has gone 95% of the way in gain: a 10 dB move is 0.9 dB short).
/// The audio window's `ramp` (buses, the master). A cue ducking the others is a `Level` instead: it lands on its time.
#[derive(Clone, Copy, Debug)]
pub struct Glide {
    pub value: f64,
    target: f64,
    coef: f64,
    moving: bool,
}

impl Glide {
    pub fn new(value: f64) -> Self {
        Glide { value, target: value, coef: 0.0, moving: false }
    }
    /// To `db` over `secs` (0 or less: at once).
    pub fn to_db(&mut self, db: f64, secs: f64, sr: f64) {
        self.to_gain(to_lin(db), secs, sr);
    }
    /// To a gain over `secs` (0 or less: at once).
    pub fn to_gain(&mut self, g: f64, secs: f64, sr: f64) {
        self.target = g;
        if secs > 0.0 && secs.is_finite() {
            self.coef = (-1.0 / (secs / 3.0 * sr)).exp();
            self.moving = true;
        } else {
            self.value = g;
            self.moving = false;
        }
    }
    /// Set at once, as `gain.value =` does.
    pub fn set(&mut self, g: f64) {
        self.value = g;
        self.target = g;
        self.moving = false;
    }
    #[inline]
    pub fn tick(&mut self) -> f64 {
        if self.moving {
            self.value = self.target + (self.value - self.target) * self.coef;
            if (self.value - self.target).abs() < 1e-7 {
                self.value = self.target;
                self.moving = false;
            }
        }
        self.value
    }
    pub fn still(&self) -> bool {
        !self.moving
    }
}

/// A sound's level: steady, or fading straight in dB (bent by its shape) from where it was to where it is going,
/// as the audio window's `fade` does. A pause holds it where it is.
#[derive(Clone, Debug)]
pub struct Level {
    pub value: f64,
    fade: Option<Fade>,
}

#[derive(Clone, Debug)]
struct Fade {
    from_db: f64,
    to_db: f64,
    n: f64,
    i: f64,
    shape: [f64; SHAPE_MAX],
    len: usize,
}

impl Level {
    pub fn new(db: f64) -> Self {
        Level { value: to_lin(db), fade: None }
    }
    /// A fade to `db` over `secs`, from the level it has now. `shape`: progress at evenly spaced moments (none: a
    /// straight line in dB). The whole shape is kept in place; a longer one is read down to SHAPE_MAX numbers.
    pub fn fade(&mut self, db: f64, secs: f64, shape: &[f64], sr: f64) {
        if !secs.is_finite() || secs <= 0.0 {
            self.value = to_lin(db);
            self.fade = None;
            return;
        }
        let mut f =
            Fade { from_db: to_db(self.value), to_db: db, n: (secs * sr).round().max(1.0), i: 0.0, shape: [0.0; SHAPE_MAX], len: 0 };
        if shape.len() >= 2 {
            let len = shape.len().min(SHAPE_MAX);
            for (k, s) in f.shape[..len].iter_mut().enumerate() {
                *s = if len == shape.len() { shape[k] } else { along(shape, k as f64 / (len - 1) as f64) };
            }
            f.len = len;
        }
        self.fade = Some(f);
    }
    /// Held where it is (a pause, a cut): a fade under way stops.
    pub fn hold(&mut self) {
        self.fade = None;
    }
    pub fn fading(&self) -> bool {
        self.fade.is_some()
    }
    #[inline]
    pub fn tick(&mut self) -> f64 {
        if let Some(f) = &mut self.fade {
            f.i += 1.0;
            let x = (f.i / f.n).min(1.0);
            let p = if f.len >= 2 { along(&f.shape[..f.len], x) } else { x };
            self.value = to_lin(f.from_db + (f.to_db - f.from_db) * p);
            if f.i >= f.n {
                self.value = to_lin(f.to_db);
                self.fade = None;
            }
        }
        self.value
    }
}

/// A straight ramp from one number to another over a count of samples (a declick, a crossfade, a pan moved).
#[derive(Clone, Copy, Debug)]
pub struct Line {
    pub from: f64,
    pub to: f64,
    n: f64,
    i: f64,
}

impl Line {
    pub fn new(from: f64, to: f64, frames: f64) -> Self {
        Line { from, to, n: frames.max(1.0), i: 0.0 }
    }
    /// How far along it is (0–1) after this sample.
    #[inline]
    pub fn step(&mut self) -> f64 {
        if self.i < self.n {
            self.i += 1.0;
        }
        self.i / self.n
    }
    #[inline]
    pub fn tick(&mut self) -> f64 {
        let x = self.step();
        self.from + (self.to - self.from) * x
    }
    pub fn done(&self) -> bool {
        self.i >= self.n
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_glide_is_set_target_at_time_with_a_third_of_its_time() {
        // (an approach in gain, as Web Audio's: 95% of the way by its time)
        let sr = 48000.0;
        let mut g = Glide::new(1.0);
        g.to_db(-20.0, 1.0, sr);
        let mut v = 0.0;
        for _ in 0..48000 {
            v = g.tick();
        }
        let want = 0.1 + 0.9 * (-3.0f64).exp();
        assert!((v - want).abs() < 1e-6, "{v} vs {want}");
    }

    #[test]
    fn a_fade_lands_on_its_target_on_time() {
        let sr = 48000.0;
        let mut l = Level::new(0.0);
        l.fade(-12.0, 0.5, &[], sr);
        let mut v = 0.0;
        for _ in 0..24000 {
            v = l.tick();
        }
        assert_eq!(v, to_lin(-12.0));
        assert!(!l.fading());
    }
}
