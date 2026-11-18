//! The arithmetic the window and the engine share: written twice, held to one answer.
//!
//! Each function here is the one of the same name in core/audio/curves.ts or core/audio/lanes.ts, line for line;
//! tests/vectors.rs reads what the TypeScript gives (tests/vectors.json, `npm run native:vectors`) and asks these
//! for the same numbers. Plain functions: nothing allocates.

use std::f64::consts::{PI, SQRT_2};

/// The level that is silence, in dB.
pub const SILENT_DB: f64 = -60.0;

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}

/// dB to a gain, as the audio window's `toLin`: at or below −60 dB it is nothing.
pub fn to_lin(db: f64) -> f64 {
    if db <= SILENT_DB {
        0.0
    } else {
        10f64.powf(db / 20.0)
    }
}

/// A gain to dB, as the audio window's `toDb`: a gain at or below 0.001 is −60.
pub fn to_db(g: f64) -> f64 {
    if g <= 0.001 {
        SILENT_DB
    } else {
        20.0 * g.log10()
    }
}

/// A meter's reading in dB, as the audio window's `dbOf`: never below −60.
pub fn db_of(x: f64) -> f64 {
    if x > 0.0 {
        (20.0 * x.log10()).max(SILENT_DB)
    } else {
        SILENT_DB
    }
}

/// A fade's shape as the host sends it: progress at evenly spaced moments (`progressOf`), read at `x` (0–1) of its
/// time, joined by straight lines. Fewer than two numbers: a straight line. (audio.ts `fade`, its `along`.)
pub fn along(shape: &[f64], x: f64) -> f64 {
    if shape.len() < 2 {
        return x;
    }
    let f = x * (shape.len() - 1) as f64;
    let i = (f.floor() as usize).min(shape.len() - 2);
    shape[i] + (shape[i + 1] - shape[i]) * (f - i as f64)
}

/// A fade's shape as a cue keeps it: linear, s-curve, or points [[x, y], …] from (0, 0) to (1, 1).
pub enum Shape<'a> {
    Linear,
    SCurve,
    Points(&'a [[f64; 2]]),
}

/// How far along a fade of this shape is (0–1) when `x` (0–1) of its time has gone. (curves.ts `shapeAt`)
pub fn shape_at(shape: &Shape, x: f64) -> f64 {
    let x = clamp(x, 0.0, 1.0);
    match shape {
        Shape::Points(pts) => {
            for i in 1..pts.len() {
                let [x0, y0] = pts[i - 1];
                let [x1, y1] = pts[i];
                if x <= x1 {
                    return if x1 > x0 { y0 + (y1 - y0) * ((x - x0) / (x1 - x0)) } else { y1 };
                }
            }
            1.0
        }
        Shape::SCurve => (1.0 - (PI * x).cos()) / 2.0,
        Shape::Linear => x,
    }
}

/// How far along a segment of a line its value is (0–1) when `x` of its time has gone; `c` bends it.
/// (lanes.ts `bend`)
pub fn bend(x: f64, c: f64) -> f64 {
    let x = clamp(x, 0.0, 1.0);
    if c == 0.0 || !c.is_finite() {
        return x;
    }
    let k = clamp(c, -1.0, 1.0) * 4.0;
    ((k * x).exp() - 1.0) / (k.exp() - 1.0)
}

/// A line's point: seconds into the file, its value, and the bend to the next point (0: straight).
pub type Point = [f64; 3];

/// A Volume or Pan line's value at `t` seconds into the file; `None` with no points. (lanes.ts `valueAt` for a
/// lane that is not a chain's: straight in its own units.)
pub fn value_at(pts: &[Point], t: f64) -> Option<f64> {
    let first = pts.first()?;
    if t <= first[0] {
        return Some(first[1]);
    }
    for i in 1..pts.len() {
        let [t0, v0, c] = pts[i - 1];
        let [t1, v1, _] = pts[i];
        if t <= t1 {
            let f = bend((t - t0) / (t1 - t0), c);
            return Some(v0 + (v1 - v0) * f);
        }
    }
    Some(pts[pts.len() - 1][1])
}

/// The Volume line in dB at `t` (0: no line, no change). (lanes.ts `envelopeAt`)
pub fn envelope_at(env: &[Point], t: f64) -> f64 {
    value_at(env, t).unwrap_or(0.0)
}

/// Each side's gain for a pan, −100 … 100: equal power, unity on both at 0. (lanes.ts `panGains`)
pub fn pan_gains(pan: f64) -> (f64, f64) {
    let x = if pan.is_finite() { clamp(pan, -100.0, 100.0) } else { 0.0 };
    if x == 0.0 {
        return (1.0, 1.0);
    }
    let th = (x / 100.0 + 1.0) * PI / 4.0;
    (SQRT_2 * th.cos(), SQRT_2 * th.sin())
}

/// A place in the file played straight on from a start, as heard: a held region and a loop of the whole file
/// wrapped. (lanes.ts `wrap`)
pub fn wrap(u: f64, region: Option<(f64, f64)>, whole: f64) -> f64 {
    if let Some((start, end)) = region {
        if end > start && u >= end {
            return start + (u - end) % (end - start);
        }
    }
    if whole > 0.0 && u >= whole {
        u % whole
    } else {
        u
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pan_is_unity_in_the_middle_and_equal_power_at_the_sides() {
        assert_eq!(pan_gains(0.0), (1.0, 1.0));
        let (l, r) = pan_gains(-100.0);
        assert!((l - SQRT_2).abs() < 1e-12 && r.abs() < 1e-12);
        let (l, r) = pan_gains(37.0);
        assert!(((l * l + r * r) - 2.0).abs() < 1e-12);
    }

    #[test]
    fn along_reads_a_shape_between_its_numbers() {
        let s = [0.0, 0.25, 1.0];
        assert_eq!(along(&s, 0.0), 0.0);
        assert_eq!(along(&s, 0.25), 0.125);
        assert_eq!(along(&s, 1.0), 1.0);
        assert_eq!(along(&[], 0.3), 0.3);
    }
}
