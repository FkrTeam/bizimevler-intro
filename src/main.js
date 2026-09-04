/* The stylesheet is deliberately NOT imported here. Importing it from the
   module makes the browser wait for this script to run before any style
   exists, which on the dev server means the page paints once as raw markup
   first: an unstyled skip link, a horizontal scrollbar from the video's
   1920px intrinsic width, and a black hole where the poster should be. Linked
   from index.html instead, where it is render-blocking and none of that frame
   can happen. See the <link> in the head. */

import config from "../template.config.js";
import { clamp } from "./utils/math.js";
import { initDebug } from "./debug.js";
import { initScrollVideo } from "./scrollVideo.js";

/* ---------------------------------------------------------------------------
   Wiring only. Every number below comes from template.config.js — nothing
   project-specific is hard-coded in src/.
--------------------------------------------------------------------------- */

const { scroll, video: videoCfg } = config;

const video = document.getElementById("film-video");
const section = document.getElementById("film");
const prompt = document.querySelector("[data-scroll-prompt]");
const content = document.getElementById("projects");

/* URL switches for isolating a stutter without a rebuild:
     ?debug    metrics overlay
     ?noblur   drop the content's backdrop blur
   Combine them: ?debug&noblur */
const flags = new URLSearchParams(location.search);
if (flags.has("noblur")) document.documentElement.classList.add("no-blur");

initDebug(video);

/* ---------------------------------------------------------------------------
   Poster retirement

   The poster is the video element's CSS background, and a background under an
   opaque video is a full-viewport layer the compositor blends for nothing on
   every frame — the kind of overdraw a phone GPU feels during playback. It is
   dropped the moment a frame has actually been presented: rVFC where it
   exists, otherwise the first `playing` or `seeked`, the two events that put a
   frame on screen. Not `loadeddata` — Safari holds a decodable-but-unplayed
   element blank, and the poster would be pulled from under nothing.
--------------------------------------------------------------------------- */

function retirePoster() {
  video.classList.add("has-frame");
  video.removeEventListener("playing", retirePoster);
  video.removeEventListener("seeked", retirePoster);
}

if (typeof video.requestVideoFrameCallback === "function") {
  video.requestVideoFrameCallback(retirePoster);
} else {
  video.addEventListener("playing", retirePoster);
  video.addEventListener("seeked", retirePoster);
}

/* ---------------------------------------------------------------------------
   Scroll-driven presentation

   Both the hint and the content are pure functions of scroll position rather
   than one-shot events. That is what makes the whole sequence reversible on
   the way back up without any extra bookkeeping.
--------------------------------------------------------------------------- */

let lastPromptFade = -1;
let lastReveal = -1;
let lastProgress = -1;
let interactive = false;

/* ---------------------------------------------------------------------------
   Timing, resolved once per breakpoint rather than per frame

   `scroll.narrow` overrides only the ramps it names; everything else falls
   through. Resolved into a flat object here because onScrubProgress runs every
   frame and must not be spreading objects to find out what its numbers are.
--------------------------------------------------------------------------- */

const narrow = scroll.narrow?.media ? matchMedia(scroll.narrow.media) : null;

function resolveTiming() {
  return narrow?.matches ? { ...scroll, ...scroll.narrow } : scroll;
}

let timing = resolveTiming();

// Crossing the breakpoint changes what every cached value below was derived
// from, so they have to be invalidated or the next frame compares against a
// number from the other layout and skips its write.
narrow?.addEventListener("change", () => {
  timing = resolveTiming();
  lastPromptFade = -1;
  lastReveal = -1;
});

/** 0 → 1 ramp across [from, to]. */
function ramp(value, [from, to]) {
  return clamp((value - from) / (to - from), 0, 1);
}

/** Two decimals is finer than the eye resolves; below that it is style
 *  recalculation for nothing. */
const quantise = (v) => Math.round(v * 100) / 100;

function onScrubProgress(progress) {
  /* Raw position, published for anything that needs to track the scroll rather
     than one of the ramps derived from it — currently the fill descending the
     prompt's track, and the hint it takes over from. Kept separate from
     --cards-reveal on purpose: that one is a ramp with a start and an end,
     this is simply where the page is. */
  const raw = quantise(progress);
  if (raw !== lastProgress) {
    lastProgress = raw;
    document.documentElement.style.setProperty("--film-progress", String(raw));
  }

  if (prompt && timing.promptFade) {
    const fade = quantise(1 - ramp(progress, timing.promptFade));
    if (fade !== lastPromptFade) {
      lastPromptFade = fade;
      prompt.style.setProperty("--prompt-fade", String(fade));
    }
  }

  if (content && timing.contentReveal) {
    const reveal = quantise(ramp(progress, timing.contentReveal));
    if (reveal !== lastReveal) {
      lastReveal = reveal;
      // On the root, not the content element: the masthead reads the same
      // value to fade itself out. Each card carries its own identity by then,
      // and the masthead sits exactly where the headline wants to be.
      document.documentElement.style.setProperty(
        "--cards-reveal",
        String(reveal)
      );
    }

    // Links must not be clickable while the content is still a ghost, or the
    // visitor hits invisible targets over the video.
    const shouldInteract = reveal >= timing.contentInteractiveAt;
    if (shouldInteract !== interactive) {
      interactive = shouldInteract;
      content.classList.toggle("is-interactive", shouldInteract);
    }
  }
}

/* ---------------------------------------------------------------------------
   Refused autoplay

   Some browsers will not start even a muted clip without a touch (Opera
   Mobile as shipped, iOS in Low Power Mode). The player keeps the poster up
   and retries on the first gesture; the visitor just needs to be told that
   a touch is what is wanted, since "scroll to explore" would send them past
   the intro instead. The hint swaps its text for that, and swaps back the
   moment playback starts — or when the intro is skipped and the hint takes
   up its normal job.
--------------------------------------------------------------------------- */

const promptText = prompt?.querySelector(".film__prompt-text");
const promptDefault = promptText?.textContent ?? "";

function showTapPrompt() {
  if (!prompt || !promptText || !config.promptTap) return;
  promptText.textContent = config.promptTap;
  prompt.classList.add("is-tap", "is-active");
}

function restorePrompt() {
  if (!prompt) return;
  prompt.classList.remove("is-tap");
  if (promptText) promptText.textContent = promptDefault;
}

initScrollVideo({
  video,
  section,
  bar: document.querySelector("[data-film-bar]"),
  mode: scroll.mode,
  fps: videoCfg.fps,
  playbackRate: videoCfg.playbackRate,
  videoSpan: scroll.videoSpan,
  onScrubStart: () => {
    restorePrompt();
    prompt?.classList.add("is-active");
  },
  onScrubProgress,
  onAutoplayRefused: showTapPrompt,
  onAutoplayRecovered: () => {
    restorePrompt();
    // Back to hidden; it fades in again when the intro settles, as normal.
    prompt?.classList.remove("is-active");
  },
});
