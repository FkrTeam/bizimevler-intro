export const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

export const lerp = (a, b, t) => a + (b - a) * t;

export const easeOutCubic = (t) => 1 - (1 - t) ** 3;

export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/**
 * Frame-rate independent smoothing.
 *
 * The naive `lerp(current, target, 0.1)` per frame moves twice as fast at
 * 120 Hz as it does at 60 Hz, so the scrub feel changes with the display.
 * Folding dt into an exponential decay keeps it identical on any refresh rate.
 *
 * @param {number} current
 * @param {number} target
 * @param {number} lambda  higher = snappier (4-10 is a useful range)
 * @param {number} dt      seconds since last frame
 */
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));
