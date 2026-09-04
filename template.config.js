/**
 * ============================================================================
 * TEMPLATE CONFIGURATION — the only file you normally edit
 * ============================================================================
 *
 * Everything project-specific lives here: the clip, the timeline, the copy and
 * the cards. `src/` contains no knowledge of this project; swap this file and
 * the assets it points at and you have a different site.
 *
 * Read alongside README.md, which explains the reasoning behind the numbers
 * that are not obvious (why 43dvh per second, why GOP 15, why fps must match).
 */

export default {
  /* --------------------------------------------------------------------
     VIDEO
     Produce the file with `npm run encode` — it applies the flag set these
     numbers assume. `fps` and the dimensions must describe the actual file:
     fps drives the seek tolerance, and the dimensions reserve the layout box.
  -------------------------------------------------------------------- */
  video: {
    src: "./be-v13.mp4",
    poster: "./poster.jpg",
    width: 1920,
    height: 1000,
    /**
     * 24, and this is the source's true rate rather than a conversion: the
     * master arrived as 30fps with every fifth frame duplicated. Those copies
     * were dropped with `decimate`, which picks the redundant frame in each
     * cycle by content — a plain `fps=24` resample drops by timestamp and on
     * this clip kept the copy and discarded the real frame.
     */
    fps: 24,
    /** Seconds. Only used to size the scroll runway. */
    duration: 7.917,
    /**
     * Intro playback speed. The clip plays once at this rate before scroll
     * takes over. 1 = as encoded. Raising it shortens the wait before the
     * visitor can act; past ~1.5 footage starts reading as fast-forward.
     * Ignored when mode is "forward".
     *
     * Held at 1: the clip is now trimmed to the frame its last marker lands on,
     * so there is no dead tail left to hurry through, and the markers read as
     * placed rather than rushed.
     */
    playbackRate: 1,

    /* ------------------------------------------------------------------
       PORTRAIT CUT
       A separate framing for narrow screens, not a re-encode of the wide
       one. The landscape master is 1.92:1; covering a phone's 0.46:1
       viewport with it throws away roughly three quarters of the picture
       and lands the crop wherever object-fit happens to put it. This cut
       is composed for that shape instead.

       Delivered through a <source media>, so the browser picks one file
       and downloads only that. Set to null to serve the wide cut
       everywhere.

       `media` is also what the poster and aspect tokens are emitted
       under, so the breakpoint lives in exactly one place.

       Note the frame rate differs from the wide cut: this master carries
       a blended 24→30 conversion rather than clean duplicated frames, and
       blended frames cannot be decimated back without losing real
       information — so it ships at its native 30. Nothing reads
       `video.fps` per source; it only sets the seek tolerance, and a
       frame of slack either way is below what a seek resolves.
    ------------------------------------------------------------------ */
    portrait: {
      src: "./be-v13-mobile.mp4",
      poster: "./poster-mobile.jpg",
      width: 500,
      height: 900,
      media: "(max-width: 719px)",
    },
  },

  /* --------------------------------------------------------------------
     SCROLL CHOREOGRAPHY
     All timeline values are fractions of the pinned section's own scroll,
     so they read top-to-bottom as one sequence.
  -------------------------------------------------------------------- */
  scroll: {
    /**
     * "hold"    — clip autoplays once and stops on its last frame; scroll never
     *             touches the timeline, it only brings the content up over that
     *             frame. Scrolling while the clip is still running is taken as
     *             "move on": if the ending has downloaded the clip cuts to it
     *             straight away, otherwise it hurries there at 3x — so the
     *             cards always land over the ending, never over whatever was
     *             mid-shot when the visitor decided to scroll, and never wait
     *             on a seek into bytes that have not arrived.
     * "rewind"  — clip autoplays forward, then scroll rewinds it to zero.
     * "forward" — no autoplay; scroll scrubs the clip from start to end.
     */
    mode: "hold",

    /**
     * Section height in dvh, overriding the runwayPerSecond calculation below.
     * Set because the mode is "hold": the clip is not scrubbed, so its duration
     * has nothing to say about how far the page should scroll. All the distance
     * has to buy is a beat before the content moves, the reveal itself, and a
     * stretch at the end where the composition sits still and can be read.
     *
     * 200dvh leaves 100dvh of actual travel under the pinned screen, which the
     * fractions below divide up. Remove this line and the clip-derived number
     * takes over again.
     */
    runway: 200,

    /**
     * How much scroll distance each second of footage gets, in dvh.
     * ~43 is a comfortable scrub. Lower feels frantic, higher leaves the
     * visitor scrolling past a near-frozen frame wondering if it broke.
     * The section height is derived from this × duration — unless `runway`
     * above overrides it. Only meaningful when scroll drives the timeline,
     * i.e. in "rewind" and "forward".
     */
    runwayPerSecond: 43,

    /**
     * Fraction of the section the video occupies. Whatever is left over is
     * runway for the content that follows it. At 1 the video ends exactly as
     * the section unpins, leaving nothing on screen long enough to read.
     * Unused in "hold", where scroll drives no part of the timeline.
     */
    videoSpan: 0.7,

    /**
     * [start, end] fractions over which the scroll hint fades out. It has to be
     * gone before the content it sits under starts arriving, not while.
     */
    promptFade: [0.28, 0.46],

    /**
     * [start, end] fractions over which the content rises into place. The gap
     * before it starts is deliberate: the first stretch of scroll is what the
     * visitor spends looking at the frame the clip landed on, and starting the
     * reveal at zero would mean the ending is never on screen by itself.
     */
    contentReveal: [0.4, 0.75],

    /** Reveal fraction past which the content becomes clickable. */
    contentInteractiveAt: 0.6,

    /**
     * Narrow screens run the same sequence on a tighter clock.
     *
     * The fractions above are of the section, and the section is one screen of
     * travel — so on a phone `contentReveal` starting at 0.40 means roughly a
     * full swipe during which the scroll does nothing visible. On a desktop
     * wheel that reads as a considered beat before the content arrives; under
     * a thumb it reads as the page having ignored the gesture, which is
     * exactly the complaint this exists to answer.
     *
     * Everything not named here falls through to the values above. Applied by
     * matchMedia in main.js and mirrored into --film-prompt-span by
     * vite.config.js, so the CSS and the JS cannot disagree about where the
     * prompt ends.
     */
    narrow: {
      media: "(max-width: 719px)",
      promptFade: [0.12, 0.26],
      contentReveal: [0.18, 0.5],
    },
  },

  /* --------------------------------------------------------------------
     MASTHEAD — logo over the video. Fades out as the content arrives.
     Set to null to omit it.
  -------------------------------------------------------------------- */
  masthead: {
    src: "/src/assets/logo.png",
    width: 200,
    height: 68,
    alt: "Bizim Evler",
  },

  /** Scroll hint. Set to null to omit it. */
  prompt: "Keşfetmek için kaydırın",

  /** Shown in the hint's place when the browser refuses to autoplay the
   *  intro (Opera Mobile does, iOS in Low Power Mode does) — the visitor has
   *  to touch the page once, and this tells them so. Set to null to keep the
   *  scroll hint regardless. */
  promptTap: "İzlemek için dokunun",

  /* --------------------------------------------------------------------
     CONTENT — the cards revealed over the held frame.

     Rendered into index.html at build time, not by the browser, so the
     markup ships complete: no JavaScript, no crawler and no reduced-motion
     visitor is served an empty page.

     `status.tone` maps to a colour: "ready" | "new" | "none".
  -------------------------------------------------------------------- */
  content: {
    title: "Haydi Gel Bizim'le Ol!",

    /**
     * How wide a card photograph actually renders, so the browser can pick a
     * width from `photo.srcset` before it knows the layout. Read it against
     * main.css: below 720px the card turns on its side and the photo takes
     * 42% of it; above that the row is two columns inside a 54rem container,
     * so each one is (viewport − padding − gap) / 2 until the container caps.
     *
     * These are the render widths, not the file widths — the browser
     * multiplies by the device pixel ratio itself. A 410px slot on a 2× screen
     * asks for 820px and gets the 1200.
     */
    photoSizes: "(max-width: 719px) 44vw, (max-width: 919px) 46vw, 410px",

    items: [
      {
        name: "Bizim Evler 12",
        href: "https://bizimevler.com.tr/bizimevler12/",
        external: true,
        /* `width`/`height` describe the largest file: they exist to give the
           image its intrinsic ratio, and the ratio is the same at every size.
           `src` is the middle one — it is what a browser too old for srcset
           falls back to, and there the safe choice is the one that is never
           badly wrong rather than the largest. */
        photo: {
          src: "/src/assets/projects/be12-800.webp",
          srcset: {
            480: "/src/assets/projects/be12-480.webp",
            800: "/src/assets/projects/be12-800.webp",
            1200: "/src/assets/projects/be12-1200.webp",
          },
          width: 1200,
          height: 676,
        },
        logo: { src: "/src/assets/projects/be12logo.png", width: 308, height: 93 },
        status: { label: "Yeni proje", tone: "new" },
        meta: "Ispartakule",
      },
      {
        name: "Bizim Evler 11",
        href: "https://bizimevler.com.tr/bizimevler11/",
        external: true,
        photo: {
          src: "/src/assets/projects/be11-800.webp",
          srcset: {
            480: "/src/assets/projects/be11-480.webp",
            800: "/src/assets/projects/be11-800.webp",
            1200: "/src/assets/projects/be11-1200.webp",
          },
          width: 1200,
          height: 776,
        },
        logo: { src: "/src/assets/projects/be11logo.png", width: 308, height: 93 },
        status: { label: "Taşınmaya hazır", tone: "ready" },
        meta: "Ispartakule",
      },
      /* Bizim Evler 10 — pulled from the page for now. Kept here so putting it
         back is a matter of removing this comment; the grid in main.css is set
         for two cards, so restore it to three columns at the same time. */
      // {
      //   name: "Bizim Evler 10",
      //   href: "https://bizimevler.com.tr/landing_page_10/",
      //   external: true,
      //   photo: {
      //     src: "/src/assets/projects/be10-800.webp",
      //     srcset: {
      //       480: "/src/assets/projects/be10-480.webp",
      //       800: "/src/assets/projects/be10-800.webp",
      //       1200: "/src/assets/projects/be10-1200.webp",
      //     },
      //     width: 1200,
      //     height: 898,
      //   },
      //   logo: { src: "/src/assets/projects/be10logo.png", width: 308, height: 93 },
      //   status: { label: "Taşınmaya hazır", tone: "ready" },
      //   meta: "Ispartakule",
      // },
    ],
  },

  /* --------------------------------------------------------------------
     PAGE
  -------------------------------------------------------------------- */
  page: {
    lang: "tr",
    title: "Bizim Evler — Ispartakule projeleri",
    description:
      "Bizim Evler — Ispartakule projeleri. Kaydırmaya bağlı video tanıtımı.",
    skipLinkLabel: "İçeriğe geç",

    /**
     * Live origin, with the trailing slash. Two things need it and neither can
     * work from a relative path: the canonical link, and og:image — the
     * scrapers behind link previews (WhatsApp, Facebook, Slack) fetch the
     * image on their own, from a context where "./og-image.jpg" means nothing.
     *
     * Set to null to omit the canonical and emit relative social tags. That
     * degrades the preview rather than breaking the page, but it is a real
     * degradation — keep this pointing at wherever the site actually lives.
     */
    url: "https://bizimevler.com.tr/",

    /** Shown when the link is shared. 1200×630 is the size every platform
     *  crops from; anything else gets cut somewhere unpredictable. */
    ogImage: "og-image.jpg",

    /** Appears above the title in most previews. */
    siteName: "Bizim Evler",
  },
};
