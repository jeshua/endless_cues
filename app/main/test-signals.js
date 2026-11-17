// Synthesised sounds for the kind tests and the smoke run (in app/, so a packaged build has it): each is the plainest signal that has what its kind is told by.
const RATE = 11025;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2147483648 - 1; }; }

/** Speech-like: syllables (a buzz at a voice's pitch, shaped into the band speech lives in) in phrases, with a
 *  breath between words and a pause between phrases. */
function speech(secs, seed = 1) {
  const x = new Float32Array(Math.round(RATE * secs)), r = rng(seed);
  let t = 0.3;
  while (t < secs - 0.5) {
    const words = 3 + Math.floor((r() + 1) * 2);
    for (let w = 0; w < words && t < secs - 0.4; w++) {
      const len = 0.14 + (r() + 1) * 0.09, f0 = 110 + (r() + 1) * 30, formant = 600 + (r() + 1) * 600;
      for (let i = 0; i < len * RATE; i++) {
        const k = Math.round(t * RATE) + i, env = Math.sin(Math.PI * i / (len * RATE));
        let v = 0;
        for (let h = 2; h * f0 < 3500; h++) v += Math.sin(2 * Math.PI * f0 * h * i / RATE) / (1 + Math.abs(h * f0 - formant) / 250);
        if (k < x.length) x[k] += 0.25 * env * v;
      }
      t += len + 0.05 + (r() + 1) * 0.03;
    }
    t += 0.45 + (r() + 1) * 0.3;
  }
  return x;
}
/** Music-like: a kick on every beat, a bass note and a chord, at a steady tempo. */
function music(secs, bpm = 120) {
  const x = new Float32Array(Math.round(RATE * secs)), beat = 60 / bpm;
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE, ph = t % beat;
    x[i] = 0.6 * Math.exp(-ph * 30) * Math.sin(2 * Math.PI * 55 * ph * (1 + 2 * Math.exp(-ph * 40)))      // kick
      + 0.2 * Math.sin(2 * Math.PI * 82.4 * t) + 0.08 * (Math.sin(2 * Math.PI * 330 * t) + Math.sin(2 * Math.PI * 415 * t) + Math.sin(2 * Math.PI * 494 * t));
  }
  return x;
}
/** An effect: one hit of noise dying away. */
function hit(secs = 0.8, seed = 3) { const x = new Float32Array(Math.round(RATE * secs)), r = rng(seed); for (let i = 0; i < x.length; i++) x[i] = 0.8 * r() * Math.exp(-i / RATE * 8); return x; }
/** Ambience: steady filtered noise (rain, room tone), with a slow swell too small to be a pause. */
function bed(secs, seed = 5) { const x = new Float32Array(Math.round(RATE * secs)), r = rng(seed); let lp = 0; for (let i = 0; i < x.length; i++) { lp = lp * 0.6 + r() * 0.4; x[i] = 0.3 * lp * (1 + 0.15 * Math.sin(2 * Math.PI * 0.07 * i / RATE)); } return x; }

module.exports = { RATE, speech, music, hit, bed };
