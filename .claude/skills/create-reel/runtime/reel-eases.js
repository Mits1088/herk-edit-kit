/* reel-eases.js - motionmaxxing's 12 measured eases as plain GSAP ease functions.
 *
 * The curve math is copied verbatim from motionmaxxing runtime/motion.js (Apache-2.0, Tejas Makwana,
 * github.com/Tejashmakwana/motionmaxxing). Only the eases are taken: motion.js itself registers its own
 * clock (__timelines.main, __seek) and bundles GSAP 3.12.5, so it must not be loaded inside a HyperFrames
 * composition. Load this file AFTER the project's own assets/gsap.min.js, then use the curves on the
 * composition's single paused timeline:
 *
 *   tl.fromTo('#title', { y: 80, opacity: 0 }, { y: 0, opacity: 1, ease: ReelEases.softLand, duration: ReelEases.dur('softLand') }, 0.3);
 *
 * Every ease is a pure function of t with f(0)=0 and f(1)=1, so seeking stays deterministic.
 * Durations are the measured medians in frames (references/motion.md section 2); dur() converts to seconds.
 */
(function (root) {
  'use strict';
  const powerOut = p => t => 1 - Math.pow(1 - t, p);
  const powerIn = p => t => Math.pow(t, p);
  const expoOut = k => { const d = 1 - Math.exp(-k); return t => (1 - Math.exp(-k * t)) / d; };
  const snapRamp = (w, tau) => { const n = w * (1 - Math.exp(-1 / tau)) + (1 - w); return t => (w * (1 - Math.exp(-t / tau)) + (1 - w) * t) / n; };
  const snapOver = (A, ta, td) => { const f = t => (1 + A * Math.exp(-t / td)) * (1 - Math.exp(-t / ta)); const n = f(1); return t => f(t) / n; };
  const spring = (c, om) => { const f = t => 1 - Math.exp(-c * t) * (Math.cos(om * t) + (c / om) * Math.sin(om * t)); const n = f(1); return t => f(t) / n; };
  const smoothP = p => t => { const a = Math.pow(t, p), b = Math.pow(1 - t, p); return a / (a + b); };
  const guard = f => t => (t <= 0 ? 0 : t >= 1 ? 1 : f(t));
  const EASE = {
    crashIn: guard(snapOver(2.0, 0.19, 0.218)),   // slams: hits and slightly passes its mark at once
    popOver: guard(spring(2.67, 4.36)),           // slow late overshoot, 1.08 at t~.72
    bounceHard: guard(spring(1.34, 5.07)),        // big overshoot 1.48, use sparingly
    snapSettle: guard(snapRamp(0.942, 0.118)),    // hero / CTA entry
    softLand: guard(expoOut(3.41)),               // text and panels landing
    whip: guard(powerOut(2.52)),                  // hard decelerating big move
    glide: guard(powerOut(1.7)),                  // gentle ease-out for medium moves
    cruise: guard(t => t),                        // linear: fades, drifts, counters
    softInOut: guard(smoothP(1.42)),              // symmetric S for opacity / blur / colour ramps
    gentleIn: guard(powerIn(2.07)),               // mild acceleration, fade-out starts
    accelExit: guard(powerIn(2.6)),               // the leaving curve
    crashOut: guard(powerIn(3.97)),               // hard acceleration into a cut
  };
  const FRAMES = { crashIn: 10, popOver: 15, bounceHard: 22, snapSettle: 11, softLand: 12, whip: 7, glide: 10, cruise: 9, softInOut: 9, gentleIn: 9, accelExit: 13, crashOut: 17 };
  const api = Object.assign({}, EASE, {
    names: Object.keys(EASE),
    frames: FRAMES,
    // Measured median duration in seconds at the composition's fps (default 30).
    dur: (name, fps) => FRAMES[name] / (fps || 30),
    // Frames to seconds.
    f: (n, fps) => n / (fps || 30),
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelEases = api;
})(typeof window !== 'undefined' ? window : globalThis);
