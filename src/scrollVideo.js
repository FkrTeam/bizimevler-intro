import { clamp, damp } from "./utils/math.js";
import { prefersReducedMotion } from "./utils/motionPrefs.js";

/**
 * Scroll-driven video. Zero dependencies, no knowledge of the project using
 * it — everything comes in through options.
 *
 * ---------------------------------------------------------------------------
 * MODES
 * ---------------------------------------------------------------------------
 *
 * "forward"  Scroll scrubs the clip from its first frame to its last. The
 *            straightforward case: progress maps directly onto the timeline.
 *
 * "hold"     The clip autoplays once and stops on its last frame. Scroll never
 *            touches the timeline at all — it only drives whatever the page
 *            hangs off `onScrubProgress`, so the content rises over the frame
 *            the clip ended on.
 *
 *            The one thing it does decide is what happens when someone scrolls
 *            while the clip is still running. Letting it keep playing would put
 *            the content over a mid-clip frame, which is the one thing this mode
 *            promises not to do; so a scroll past the section's opening reads as
 *            "I'm done watching" and parks the timeline on the last frame there
 *            and then. Wait it out and nothing is skipped.
 *
 * "rewind"   The clip autoplays once, then scroll drives it backwards to zero.
 *            The interesting case, because the handover has to be solved: most
 *            people scroll before a ~10s clip ends, so "wait for it to finish"
 *            is not a real plan — do that and the rewind opens by yanking the
 *            timeline to a position nobody saw.
 *
 *            Instead, at handover we record where the clip was (T0) and how far
 *            the page had already scrolled (p0), then map the *remaining*
 *            scroll onto the *elapsed* playback:
 *
 *              local  = (p - p0) / (1 - p0)
 *              target = T0 × (1 - local / videoSpan)
 *
 *            Scroll early and a short clip rewinds over the distance that is
 *            left; let it finish and the whole thing rewinds over the whole
 *            section. Either way there is no jump, and the timeline lands on
 *            zero at the end of the video's span.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SCRUB IS NOT JUST `video.currentTime = progress * duration`
 * ---------------------------------------------------------------------------
 *
 *  1. Scroll fires far more often than a decoder can seek. Every write
 *     invalidates the in-flight seek, so the decoder restarts continuously and
 *     never presents a frame.
 *  2. A seek is only cheap when it lands on a keyframe. Issuing the next one
 *     before the current reports back multiplies the decode work.
 *  3. Sub-frame precision is decode cost for a change no display can show.
 *  4. On a cold cache, seeking past what has downloaded stalls the element and
 *     makes the browser throw away its read-ahead.
 *
 * Hence: scroll writes nothing directly, a single rAF loop damps toward the
 * target, seeks are gated one-at-a-time, quantised to a frame, and clamped to
 * what is actually buffered.
 *
 * @param {object}   o
 * @param {HTMLVideoElement} o.video
 * @param {HTMLElement}      o.section    tall, with a sticky child
 * @param {HTMLElement}     [o.bar]       progress bar inner element
 * @param {"rewind"|"forward"|"hold"} [o.mode]
 * @param {number}  [o.fps]               must match the encode
 * @param {number}  [o.playbackRate]      intro speed, "rewind" and "hold"
 * @param {number}  [o.videoSpan]         fraction of the section the clip uses;
 *                                        unused in "hold", where scroll drives
 *                                        no part of the timeline
 * @param {Function}[o.onScrubStart]
 * @param {Function}[o.onScrubProgress]   receives 0-1 across the section
 * @param {Function}[o.onAutoplayRefused] the browser wants a gesture first;
 *                                        the poster stays up until one comes
 * @param {Function}[o.onAutoplayRecovered] playback started after a refusal
 */
export function initScrollVideo({
  video,
  section,
  bar,
  mode = "rewind",
  fps = 30,
  playbackRate = 1,
  videoSpan = 1,
  onScrubStart,
  onScrubProgress,
  onAutoplayRefused,
  onAutoplayRecovered,
}) {
  if (!video || !section) return null;

  const REWIND = mode === "rewind";
  const HOLD = mode === "hold";

  const PLAYING = "playing";
  const SCRUBBING = "scrubbing";

  const FRAME = 1 / fps;
  /** If a seek never reports back, unstick the pipeline rather than freeze. */
  const SEEK_WATCHDOG_MS = 400;
  /** Scroll past this and we treat it as intent to take over. */
  const HANDOVER_EPSILON = 0.002;
  /** Below this much section left, there is no runway to rewind over. */
  const MIN_HANDOVER_RUNWAY = 0.05;
  /**
   * "hold" only, and deliberately far larger than HANDOVER_EPSILON. Cutting the
   * intro is not reversible, so it must not fire on a stray wheel notch or the
   * couple of pixels a phone gives back after an overscroll — it should take a
   * gesture that clearly means "move on". On a touch screen that bar is
   * higher: 6% of a phone's travel is under 50px, which a thumb resting on
   * the glass produces without meaning anything, and every such touch was
   * cutting the intro to its last frame — which, being a still, read as the
   * video having frozen. 14% is a swipe.
   */
  const COARSE =
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const HOLD_SKIP_EPSILON = COARSE ? 0.14 : 0.06;
  /** "hold" only: how fast the clip runs to its end when it is skipped before
   *  the end has downloaded. See skipIntro(). */
  const HURRY_RATE = 3;
  /** Media time not moving for this long, while it should be, means the data
   *  is not coming. See watchForStall(). */
  const STALL_MS = 6000;

  /**
   * "hold" only. The intro is a one-shot: once it has ended or been skipped,
   * the timeline stays where it is. `video.ended` cannot answer this on its own
   * because skipping pauses and seeks rather than playing out, which leaves
   * `ended` false with nothing left to play.
   */
  let introSettled = false;
  /** "hold" only. The visitor moved on before the end had downloaded, so the
   *  clip is running to it at HURRY_RATE rather than seeking into data that
   *  is not there yet. */
  let hurrying = false;
  /** True once the intro's first play() has been issued — by the gate in
   *  startAutoplay(), or by a skip that hurried the clip. Until then the
   *  resume paths (section back on screen, tab back in front) have nothing
   *  to resume, and must not jump the gate. */
  let introStarted = false;

  // "hold" never scrubs the timeline, but the loop still has to run so scroll
  // keeps driving the reveal — SCRUBBING is what syncLoop() gates on.
  let phase = REWIND ? PLAYING : SCRUBBING;
  let duration = 0;
  let smoothed = 0;

  let handoffTime = 0;
  let handoffProgress = 0;

  let seeking = false;
  let seekStartedAt = 0;

  let running = false;
  let rafId = 0;
  let lastTime = 0;
  let onScreen = false;

  let lastBarStep = -1;

  /* ---- Progress bar ------------------------------------------------------
     1000 steps, not 100. Whole percent is one ~19px jump on a wide viewport,
     which is visible; a thousandth is under 2px at any realistic width while
     still skipping the writes that would change nothing.
  ------------------------------------------------------------------------ */

  const BAR_STEPS = 1000;

  function updateBar(fraction) {
    if (!bar) return;
    const value = clamp(fraction, 0, 1);
    const step = Math.round(value * BAR_STEPS);
    if (step === lastBarStep) return;
    lastBarStep = step;
    // scaleX, not width — the bar never touches layout
    bar.style.transform = `scaleX(${value})`;
  }

  /* ---- Seek completion ---------------------------------------------------
     requestVideoFrameCallback fires when a frame is actually presented to the
     compositor, a truer "done" signal than `seeked`, which can resolve before
     the new frame is on screen. It doubles as the bar's clock during playback,
     so playback needs no timer of its own.
  ------------------------------------------------------------------------ */

  const hasRVFC = typeof video.requestVideoFrameCallback === "function";

  function markSettled() {
    seeking = false;
  }

  if (hasRVFC) {
    const onPresented = () => {
      markSettled();
      if (phase === PLAYING && duration > 0) {
        updateBar(video.currentTime / duration);
      }
      video.requestVideoFrameCallback(onPresented);
    };
    video.requestVideoFrameCallback(onPresented);
  } else {
    video.addEventListener("timeupdate", () => {
      if (phase === PLAYING && duration > 0) {
        updateBar(video.currentTime / duration);
      }
    });
  }
  video.addEventListener("seeked", markSettled);

  /* ---- Metadata ---------------------------------------------------------- */

  function onMetadata() {
    duration = Number.isFinite(video.duration) ? video.duration : 0;
    // "forward" alone: nudge off zero so the first frame replaces the poster
    // before any scroll happens. The autoplay modes are about to render frames
    // of their own, and the seek would only compete with the decoder.
    if (!REWIND && !HOLD && duration > 0 && video.currentTime === 0) {
      video.currentTime = 0.001;
    }
  }

  if (video.readyState >= 1) onMetadata();
  else video.addEventListener("loadedmetadata", onMetadata, { once: true });

  /* ---- Scroll progress ---------------------------------------------------
     The section is taller than its sticky child, so the distance the
     section's top travels above the viewport top before the child unpins is
     exactly the section's height less the child's — and that is the divisor,
     not the viewport. On a phone the two differ: the child is sized in lvh so
     the address bar cannot resize it, while innerHeight follows the bar,
     growing by its height on the very first swipe. Dividing by innerHeight
     made the fraction jump mid-gesture, which read as the reveal lurching.
  ------------------------------------------------------------------------ */

  const sticky = section.firstElementChild;

  function readProgress() {
    const rect = section.getBoundingClientRect();
    const pinned = sticky ? sticky.offsetHeight : innerHeight;
    const scrollable = rect.height - pinned;
    if (scrollable <= 0) return 0;
    return clamp(-rect.top / scrollable, 0, 1);
  }

  /* ---- Buffer awareness --------------------------------------------------
     Never seek outside what has downloaded. Clamp to the nearest available
     edge instead and let the damper catch up when the data lands: the picture
     then lags slightly behind the scrollbar on a cold cache rather than
     freezing, which is a far better failure mode.
  ------------------------------------------------------------------------ */

  function clampToBuffered(t) {
    const ranges = video.buffered;
    if (!ranges || ranges.length === 0) return video.currentTime;

    let best = null;
    let bestGap = Infinity;

    for (let i = 0; i < ranges.length; i++) {
      const start = ranges.start(i);
      const end = ranges.end(i);
      if (t >= start && t <= end) return t;

      // Keep a frame inside the edge; a boundary is the position most likely
      // to stall.
      const edge = t < start ? start + FRAME : end - FRAME;
      const gap = Math.abs(t - edge);
      if (gap < bestGap) {
        bestGap = gap;
        best = edge;
      }
    }

    return best === null ? video.currentTime : clamp(best, 0, duration);
  }

  /** True once the whole clip is local, so seeks are pure decode work. */
  function fullyBuffered() {
    const ranges = video.buffered;
    if (!ranges || ranges.length !== 1 || duration <= 0) return false;
    return ranges.start(0) <= 0.05 && ranges.end(0) >= duration - 0.05;
  }

  /* ---- Handover ("rewind" only) ------------------------------------------
     During playback the only scroll work is this listener: passive, and it
     reads layout at most once per scroll event rather than 60 times a second.
  ------------------------------------------------------------------------ */

  function watchForHandover() {
    if (readProgress() > HANDOVER_EPSILON) beginScrub();
  }

  function beginScrub() {
    if (phase === SCRUBBING) return;
    phase = SCRUBBING;

    removeEventListener("scroll", watchForHandover);

    video.pause();
    handoffTime = video.currentTime || duration;

    // A jump to the foot of the section — End, a scrollbar drag — hands the
    // mapping a runway of zero, and (p - p0) / (1 - p0) then evaluates to the
    // same number at every scroll position there is: the picture stops
    // responding and everything above becomes dead scroll. Anchor to the top
    // of the section instead, so each position keeps a distinct frame; the
    // clip rewinds to zero straight away, which is what a jump to the end
    // asked for anyway.
    const progress = readProgress();
    handoffProgress = 1 - progress < MIN_HANDOVER_RUNWAY ? 0 : progress;

    // Start the damper where the picture already is, so the first scrubbed
    // frame continues from the last played one.
    smoothed = handoffTime;

    onScrubStart?.();
    syncLoop();
  }

  /* ---- Opening partway down ("rewind" only) ------------------------------
     The page asks to open at the top (see the head script in index.html), so
     a reload replays the sequence from the beginning and this path normally
     never runs. It is the fallback for the cases that request cannot cover:
     a browser without history.scrollRestoration, or a deep link that lands
     inside the section.

     Playing the intro from there would be wrong twice over — the visitor
     never sees it, and whatever position was restored gets recorded as the
     handover point, the degenerate case guarded against above, except that
     here there is not even a played frame to rewind from.

     Being partway down the section is simply the state scrolling there would
     have produced, so it is set up as exactly that: no intro, the whole
     section as the rewind's runway, and the timeline placed outright rather
     than damped toward — this is the first frame the visitor sees, not a
     movement they asked for.
  ------------------------------------------------------------------------ */

  function startFromRestoredScroll() {
    phase = SCRUBBING;
    video.pause();
    handoffProgress = 0;

    // `local` — and so everything the page reveals — is already correct
    // without the duration; only the timeline has to wait for metadata.
    const placeTimeline = () => {
      handoffTime = duration;
      smoothed = targetFor(readProgress()).target;
      if (duration > 0) {
        video.currentTime = clamp(smoothed, 0, Math.max(duration - FRAME, 0));
      }
    };

    if (duration > 0) placeTimeline();
    else video.addEventListener("loadedmetadata", placeTimeline, { once: true });

    onScrubStart?.();
    syncLoop();
  }

  if (REWIND) video.addEventListener("ended", beginScrub);

  /* ---- Settling on the last frame ("hold" only) --------------------------
     Three ways in, one exit: the clip played out, the visitor scrolled past it,
     or autoplay was refused outright. All of them end with the same state — no
     playback, the timeline on the final frame, the scroll listener gone — so
     they share one function rather than three near-copies that could drift.
  ------------------------------------------------------------------------ */

  /** The scrub-phase hook fires once per page, whichever path gets there
   *  first — a skip announces it as soon as the visitor starts scrolling,
   *  and settling must not repeat it. */
  let scrubAnnounced = false;
  function announceScrub() {
    if (scrubAnnounced) return;
    scrubAnnounced = true;
    onScrubStart?.();
  }

  /** @param {boolean} seek false when the clip already ended on that frame. */
  function settleOnLastFrame(seek) {
    if (introSettled) return;
    introSettled = true;
    hurrying = false;

    removeEventListener("scroll", watchForSkip);
    video.pause();
    video.playbackRate = playbackRate;

    if (seek) {
      // A frame short of the duration: seeking to the duration exactly is the
      // one position a decoder is entitled to have no frame for, and browsers
      // differ on whether it lands on the last frame or fires `ended`.
      const park = () => {
        if (duration > 0) video.currentTime = Math.max(duration - FRAME, 0);
      };
      if (duration > 0) park();
      else video.addEventListener("loadedmetadata", park, { once: true });
    }

    announceScrub();
  }

  /** True when the frame the intro settles on has already downloaded. */
  function lastFrameBuffered() {
    const ranges = video.buffered;
    if (duration <= 0 || !ranges) return false;
    const t = Math.max(duration - FRAME, 0);
    for (let i = 0; i < ranges.length; i++) {
      if (t >= ranges.start(i) - FRAME && t <= ranges.end(i) + FRAME) return true;
    }
    return false;
  }

  /* The visitor scrolled on before the clip finished. The promise is that the
     content lands over the ending, so the timeline has to get there — but a
     seek to the last frame is only free once that frame is on the device.
     Before that it is a request for the tail of the file: Safari waits on it
     and, from a server that will not answer a byte range, waits forever, the
     picture frozen on whatever frame it had; Chromium re-downloads from the
     top to reach it. Both are what "the video freezes and does not continue"
     looks like on a phone, where the swipe almost always comes before the
     1.6 MB has landed.

     So the cut is taken only when the end is buffered. Otherwise the clip is
     asked to hurry — play on at HURRY_RATE, which needs nothing but the bytes
     already arriving in order — and it settles through `ended` like an
     unhurried one does. If play() is refused (no gesture yet, Opera Mobile)
     there is nothing to hurry, and the seek is issued after all: it is then a
     paused element seeking, which is the one case the stall watchdog below
     can still rescue by parking on the nearest frame that is here. */
  function skipIntro() {
    if (introSettled || hurrying) return;
    removeEventListener("scroll", watchForSkip);
    announceScrub();

    if (lastFrameBuffered()) {
      settleOnLastFrame(true);
      return;
    }

    hurrying = true;
    // The gate in startAutoplay() has nothing left to start.
    introStarted = true;
    try {
      video.playbackRate = HURRY_RATE;
    } catch {
      video.playbackRate = 2;
    }
    tryPlay(() => settleOnLastFrame(true));
  }

  const onIntroEnded = () => settleOnLastFrame(false);
  const watchForSkip = () => {
    if (readProgress() > HOLD_SKIP_EPSILON) skipIntro();
  };

  /* ---- Stall watchdog ("hold" only) ---------------------------------------
     Sampled from the scrub loop, so it costs nothing while nothing should be
     moving. Two things can be stuck: playback the browser accepted but cannot
     feed (media time frozen, element not paused), and the settle seek waiting
     on bytes that are not coming. Either way, after STALL_MS the visitor has
     long since decided the video is broken, and the one useful thing left is
     to stop waiting: park on the nearest frame that is on the device and let
     the page be a page. The clip never plays out — but it was not going to.
  ------------------------------------------------------------------------ */

  let stallTime = -1;
  let stallSince = 0;

  function watchForStall(now) {
    const playing =
      introStarted && !introSettled && !video.paused && !video.ended;
    const parking = introSettled && video.seeking;
    if (!playing && !parking) {
      stallTime = -1;
      return;
    }
    const t = video.currentTime;
    if (t !== stallTime) {
      stallTime = t;
      stallSince = now;
      return;
    }
    if (now - stallSince < STALL_MS) return;
    stallSince = now;
    giveUp();
  }

  function giveUp() {
    settleOnLastFrame(false);
    if (duration > 0) {
      video.currentTime = clampToBuffered(Math.max(duration - FRAME, 0));
    }
  }

  if (HOLD) video.addEventListener("ended", onIntroEnded);

  /* ---- Autoplay ("rewind" and "hold") ------------------------------------
     Muted playback is permitted without a gesture. If it is refused anyway
     (data saver, an aggressive extension), park the timeline at the end: in
     "rewind" so there is still something to rewind, in "hold" because the end
     is where the content is supposed to arrive over either way.
  ------------------------------------------------------------------------ */

  /* play() starts the moment the next frame or two are decodable, and on a
     phone that is the wrong moment: with the file still arriving over a
     cellular link the intro sets off and then freezes the first time the
     decoder catches up with the download. `canplaythrough` is the browser's
     own estimate that it can now reach the end without stalling, so the
     start waits for it — the poster is already up and a beat on it costs
     nothing, while a stop mid-shot is the one thing this page cannot afford.

     Two things end the wait early. `suspend` means the browser has stopped
     fetching on its own — iOS treats preload as a hint and loads no further
     than metadata until play() is called — so waiting on it would only ever
     run out the clock. And the clock: the estimate is not a promise, and no
     engine gets to hold the poster indefinitely. */
  const PLAYABLE_WAIT_MS = 2500;
  const HAVE_ENOUGH_DATA = 4;

  function whenPlayable(callback) {
    if (video.readyState >= HAVE_ENOUGH_DATA) {
      callback();
      return;
    }
    let timer = 0;
    const go = () => {
      clearTimeout(timer);
      video.removeEventListener("canplaythrough", go);
      video.removeEventListener("suspend", go);
      callback();
    };
    timer = setTimeout(go, PLAYABLE_WAIT_MS);
    video.addEventListener("canplaythrough", go);
    video.addEventListener("suspend", go);
  }

  function startAutoplay() {
    video.playbackRate = playbackRate;
    whenPlayable(() => {
      // Skipped or settled while the clip was still arriving — or skipped
      // into a hurry, which issued the play() itself.
      if (!introPending() || introStarted) return;
      introStarted = true;
      tryPlay(retryOnGesture);
    });
  }

  /** play(), with a refused earlier attempt cleared once one succeeds. */
  function tryPlay(onRefused) {
    // Muted from script as well as from markup. The attribute alone has a
    // history of not being honoured by the autoplay check in some Chromium
    // builds, and an unmuted play() is refused everywhere without a gesture.
    video.muted = true;
    const attempt = video.play();
    if (!attempt || typeof attempt.then !== "function") return;
    attempt.then(() => {
      if (!autoplayRefused) return;
      autoplayRefused = false;
      disarmGestureRetry();
      onAutoplayRecovered?.();
    }, onRefused);
  }

  /* Autoplay was refused. That is not always final: iOS in Low Power Mode,
     Android browsers with a data saver on, and a few desktop policies all
     reject the first, gesture-less play() and accept the same call once the
     visitor has touched the page. So the poster stays up and the first
     gesture retries. A tap or a key is a gesture; so is the touchend at the
     end of a swipe — and if that swipe already scrolled past the intro, the
     skip handlers have settled things and the retry steps aside. Only when
     the retry is refused too do we park at the end as before.

     Not every rejection is a refusal, though. A policy says no with
     NotAllowedError. AbortError means the request was interrupted — and
     Chromium interrupts video-only playback whenever the document is hidden,
     which is what a link opened into a background tab, or a window sitting
     behind another one, looks like on load. Asking for a touch there would be
     wrong twice: nothing is stopping playback except the tab being out of
     sight, and the visitor cannot see the request anyway. So a hidden-time
     abort waits for the tab to come back (see onVisibilityChange), a visible
     one gets a single quiet retry, and only a second rejection is treated as
     the browser meaning it. */

  /* `click` alongside the pointer and touch events: it is the one event every
     engine agrees carries user activation, and on a phone a tap arrives as
     all three in a row — pointerup, touchend, click — so the retry has to
     treat that burst as one gesture, not three attempts. */
  const GESTURE_EVENTS = ["pointerup", "touchend", "click", "keydown"];
  const GESTURE_BURST_MS = 400;
  /* How many refused gestures before the poster is given up on. Opera Mobile
     refuses the gesture-less play() and, on some devices, the first
     gesture-backed one as well; a second tap has been seen to go through.
     Parking on the last frame after one refusal turned every such visit into
     "the video never played" — so the prompt stays up, and each tap tries
     again, until this many have been refused. */
  const GESTURE_ATTEMPTS = 4;
  let gestureRetryArmed = false;
  let gestureAttempts = 0;
  let lastGestureAt = -Infinity;
  let autoplayRefused = false;
  let abortRetried = false;

  function introPending() {
    return (REWIND && phase === PLAYING) || (HOLD && !introSettled);
  }

  function retryOnGesture(error) {
    if (error?.name === "AbortError") {
      if (document.visibilityState === "hidden") return;
      if (!abortRetried) {
        abortRetried = true;
        setTimeout(() => {
          if (introPending() && video.paused && !video.ended) {
            tryPlay(retryOnGesture);
          }
        }, 250);
        return;
      }
    }

    if (!autoplayRefused) {
      autoplayRefused = true;
      onAutoplayRefused?.();
    }
    if (gestureRetryArmed) return;
    gestureRetryArmed = true;
    for (const type of GESTURE_EVENTS) {
      addEventListener(type, onFirstGesture, { capture: true, passive: true });
    }
  }

  function disarmGestureRetry() {
    if (!gestureRetryArmed) return;
    gestureRetryArmed = false;
    for (const type of GESTURE_EVENTS) {
      removeEventListener(type, onFirstGesture, { capture: true });
    }
  }

  function onFirstGesture(event) {
    if ((HOLD && introSettled) || (REWIND && phase !== PLAYING)) {
      disarmGestureRetry();
      return;
    }
    const at = event?.timeStamp ?? performance.now();
    if (at - lastGestureAt < GESTURE_BURST_MS) return;
    lastGestureAt = at;

    gestureAttempts++;
    // Success disarms in tryPlay(); a refusal keeps the prompt and the
    // listeners up for the next tap, until the budget is spent.
    tryPlay(gestureAttempts >= GESTURE_ATTEMPTS ? parkAtEnd : () => {});
  }

  function parkAtEnd() {
    disarmGestureRetry();
    if (HOLD) {
      settleOnLastFrame(true);
      return;
    }
    if (phase !== PLAYING) return;
    phase = SCRUBBING;
    handoffTime = duration;
    handoffProgress = readProgress();
    smoothed = duration;
    if (duration > 0) video.currentTime = duration - FRAME;
    removeEventListener("scroll", watchForHandover);
    onScrubStart?.();
    syncLoop();
  }

  /* ---- Target ------------------------------------------------------------ */

  const span = Math.max(videoSpan, 0.001);

  function targetFor(progress) {
    if (!REWIND) {
      return {
        local: progress,
        target: clamp(progress / span, 0, 1) * duration,
      };
    }

    const remaining = Math.max(1 - handoffProgress, 0.001);
    const local = clamp((progress - handoffProgress) / remaining, 0, 1);
    return {
      local,
      target: handoffTime * (1 - clamp(local / span, 0, 1)),
    };
  }

  /* ---- Scrub loop -------------------------------------------------------- */

  function frame(time) {
    if (!running) return;

    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    const progress = readProgress();

    /* "hold" leaves the decoder alone entirely: no target, no damper, no seek.
       The section's own scroll is the only thing being reported, and the bar
       tracks that rather than the timeline — the clip's playback is not a
       journey through the section, so showing it there would fill the bar
       before the visitor had moved and then have to empty it again. */
    if (HOLD) {
      watchForStall(time);
      updateBar(progress);
      onScrubProgress?.(progress);
      rafId = requestAnimationFrame(frame);
      return;
    }

    const { local, target } = targetFor(progress);

    smoothed = damp(smoothed, target, 9, dt);

    if (seeking && time - seekStartedAt > SEEK_WATCHDOG_MS) seeking = false;

    // One frame of tolerance once everything is local. While the clip is still
    // arriving, widen it — a seek during download costs far more than one
    // against a complete buffer, so three frames of slack cuts that pressure
    // to a third for no perceptible loss.
    const tolerance = fullyBuffered() ? FRAME : FRAME * 3;

    if (!seeking && Math.abs(smoothed - video.currentTime) >= tolerance) {
      const reachable = clampToBuffered(smoothed);
      if (Math.abs(reachable - video.currentTime) >= tolerance) {
        seeking = true;
        seekStartedAt = time;
        video.currentTime = reachable;
      }
    }

    if (duration > 0) updateBar(smoothed / duration);

    // Reported every frame rather than as one-shot events, so anything driven
    // by it is a pure function of scroll position — which makes it reversible
    // for free when the visitor scrolls back up.
    onScrubProgress?.(local);

    rafId = requestAnimationFrame(frame);
  }

  function syncLoop() {
    const should = phase === SCRUBBING && onScreen && !document.hidden;
    if (should === running) return;

    running = should;
    if (running) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(frame);
    } else {
      cancelAnimationFrame(rafId);
    }
  }

  /* ---- Visibility --------------------------------------------------------
     Nothing runs while the section is off screen. A decoder held busy behind a
     screenful of content is pure battery drain.
  ------------------------------------------------------------------------ */

  const observer = new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;

      // Both intro modes: pause off screen, resume on return — but only while
      // the intro is still the thing running. Once "hold" has settled, the
      // paused element IS the finished state, and resuming it would replay the
      // clip out from under the content sitting on top of it.
      if (introPending() && introStarted) {
        if (onScreen && video.paused && !video.ended) {
          tryPlay(() => {});
        } else if (!onScreen && !video.paused) {
          video.pause();
        }
      }

      syncLoop();
    },
    { threshold: 0 }
  );
  observer.observe(section);

  /* Chromium pauses video-only media in a background tab "to save power" and
     rejects the play() that was in flight — which is exactly what a link
     opened from a chat app into a background tab looks like. Coming back to
     the tab is not a gesture, but muted playback needs none, so try again
     right then; otherwise the visitor is left on the poster until they touch
     the page. Only while the intro is still the thing that should be running. */
  function onVisibilityChange() {
    syncLoop();
    if (document.visibilityState !== "visible") return;
    if (introPending() && introStarted && onScreen && video.paused && !video.ended) {
      tryPlay(retryOnGesture);
    }
  }

  document.addEventListener("visibilitychange", onVisibilityChange);

  function destroy() {
    cancelAnimationFrame(rafId);
    observer.disconnect();
    disarmGestureRetry();
    removeEventListener("scroll", watchForHandover);
    removeEventListener("scroll", watchForSkip);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    video.removeEventListener("seeked", markSettled);
    video.removeEventListener("ended", beginScrub);
    video.removeEventListener("ended", onIntroEnded);
  }

  /* ---- Reduced motion ----------------------------------------------------
     No autoplay, no scrubbing, no loop. The poster stands in and everything
     the scroll would have revealed is visible from the start.
  ------------------------------------------------------------------------ */

  if (prefersReducedMotion()) {
    observer.disconnect();
    onScrubProgress?.(1);
    return { destroy };
  }

  if (REWIND) {
    if (readProgress() > HANDOVER_EPSILON) {
      startFromRestoredScroll();
    } else {
      addEventListener("scroll", watchForHandover, { passive: true });
      startAutoplay();
    }
  } else if (HOLD) {
    // The loop starts before the intro does: scroll has to keep driving the
    // reveal from the first frame, whether the clip is still playing or not.
    syncLoop();

    if (readProgress() > HOLD_SKIP_EPSILON) {
      // Opened partway down — a deep link, or a browser without
      // history.scrollRestoration. An intro nobody is positioned to watch is
      // not worth playing; go straight to the state scrolling there produces.
      settleOnLastFrame(true);
    } else {
      addEventListener("scroll", watchForSkip, { passive: true });
      startAutoplay();
    }
  } else {
    announceScrub();
    syncLoop();
  }

  return { destroy };
}
