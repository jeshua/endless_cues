//! The safety limiter: the last thing before each pair of outputs, so a fader pushed up never clips the PA.
//!
//! The audio window uses a compressor at −0.3 dBFS (ratio 20, 2 ms attack, 150 ms release), which lets the first
//! 2 ms of a transient through. This one holds a ceiling outright: it follows the louder of the two channels with
//! no attack time at all (so what it follows is never below the sample) and lets go over 150 ms, and the pair is
//! turned down by ceiling / that. No sample leaves above the ceiling; below it, nothing is touched.

/// −0.3 dBFS: not −1, since mastered music peaks at −0.01 dBFS and is meant to be heard at its own level.
pub const CEILING: f32 = 0.966_051; // 10^(−0.3/20)
const RELEASE_S: f32 = 0.15;

#[derive(Clone, Debug)]
pub struct Limiter {
    pub on: bool,
    env: f32,
    rel: f32,
    /// The most it turned the pair down since this was last read (a gain, 1: not at all).
    pub least: f32,
}

impl Limiter {
    pub fn new(sr: f32) -> Self {
        Limiter { on: true, env: 0.0, rel: (-1.0 / (RELEASE_S * sr)).exp(), least: 1.0 }
    }
    pub fn set_rate(&mut self, sr: f32) {
        self.rel = (-1.0 / (RELEASE_S * sr)).exp();
    }
    /// One frame of the pair, limited in place.
    #[inline]
    pub fn frame(&mut self, l: &mut f32, r: &mut f32) {
        if !self.on {
            return;
        }
        let peak = l.abs().max(r.abs());
        // (a NaN from anywhere upstream must not reach the PA, nor stick in the follower)
        if !peak.is_finite() {
            *l = 0.0;
            *r = 0.0;
            return;
        }
        self.env = if peak > self.env { peak } else { peak.max(self.env * self.rel) };
        if self.env > CEILING {
            let g = CEILING / self.env;
            // (clamped as well: the division's rounding can leave a sample one step of an f32 over)
            *l = (*l * g).clamp(-CEILING, CEILING);
            *r = (*r * g).clamp(-CEILING, CEILING);
            if g < self.least {
                self.least = g;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_passes_the_ceiling() {
        let mut lim = Limiter::new(48000.0);
        for i in 0..48000 {
            let x = (i as f32 * 0.05).sin() * 8.0;
            let (mut l, mut r) = (x, -x * 0.5);
            lim.frame(&mut l, &mut r);
            assert!(l.abs() <= CEILING && r.abs() <= CEILING);
        }
    }

    #[test]
    fn under_the_ceiling_it_changes_nothing() {
        let mut lim = Limiter::new(48000.0);
        for i in 0..4800 {
            let x = (i as f32 * 0.05).sin() * 0.9;
            let (mut l, mut r) = (x, x);
            lim.frame(&mut l, &mut r);
            assert_eq!(l, x);
        }
        assert_eq!(lim.least, 1.0);
    }
}
