const QUERY = "(prefers-reduced-motion: reduce)";

const mql = typeof matchMedia === "function" ? matchMedia(QUERY) : null;

/** True when the user has asked the OS to minimise animation. */
export function prefersReducedMotion() {
  return mql ? mql.matches : false;
}

/**
 * Subscribe to live changes. Users can toggle the OS setting while the page is
 * open, so anything that branches on the preference should react rather than
 * read it once at boot.
 *
 * @param {(reduced: boolean) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onMotionPreferenceChange(callback) {
  if (!mql) return () => {};
  const handler = (event) => callback(event.matches);
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}
