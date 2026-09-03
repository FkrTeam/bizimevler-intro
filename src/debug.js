/**
 * Diagnostic overlay. Off unless the URL carries ?debug.
 *
 * Exists because "it stutters" has three completely different causes that all
 * feel identical, and guessing between them wastes rounds:
 *
 *   low fps + low seek latency   → compositing/paint (grain, blur, layers)
 *   normal fps + high seek time  → decode cost (GOP too long, resolution)
 *   spikes with buffered < 100%  → network, seeking into undownloaded data
 *
 * Read the numbers while scrolling and the answer is unambiguous.
 */
export function initDebug(video) {
  if (!new URLSearchParams(location.search).has("debug")) return null;

  const box = document.createElement("div");
  box.style.cssText = [
    "position:fixed",
    "top:8px",
    "left:8px",
    "z-index:9999",
    "padding:8px 10px",
    "font:12px/1.5 ui-monospace,monospace",
    "color:#0f0",
    "background:rgba(0,0,0,.82)",
    "border:1px solid #0f04",
    "border-radius:6px",
    "white-space:pre",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(box);

  let frames = 0;
  let fps = 0;
  let windowStart = performance.now();

  let worstFrameGap = 0;
  let lastFrameAt = performance.now();

  let seekStart = 0;
  let lastSeek = 0;
  let worstSeek = 0;
  let seekCount = 0;

  // Patch currentTime so seek latency is measured where it actually happens,
  // without threading timing code through the player.
  const proto = Object.getPrototypeOf(video);
  const desc = Object.getOwnPropertyDescriptor(proto, "currentTime");
  if (desc && desc.set) {
    Object.defineProperty(video, "currentTime", {
      get() {
        return desc.get.call(video);
      },
      set(v) {
        seekStart = performance.now();
        seekCount++;
        desc.set.call(video, v);
      },
      configurable: true,
    });
  }

  video.addEventListener("seeked", () => {
    if (!seekStart) return;
    lastSeek = performance.now() - seekStart;
    if (lastSeek > worstSeek) worstSeek = lastSeek;
    seekStart = 0;
  });

  /* "It does not play" has as many causes as "it stutters": the element never
     got a byte (network), got bytes it cannot decode (error), or decoded fine
     and was refused autoplay (paused at 0, no error). The last media event
     and the error code tell them apart from a screenshot. */
  const MEDIA_EVENTS = [
    "loadstart", "loadedmetadata", "loadeddata", "canplay", "canplaythrough",
    "play", "playing", "pause", "waiting", "stalled", "suspend", "abort",
    "emptied", "error", "ended",
  ];
  let lastEvent = "-";
  let eventCount = 0;
  const t0 = performance.now();
  const log = [];
  function note(what) {
    lastEvent = what;
    eventCount++;
    log.push(`${((performance.now() - t0) / 1000).toFixed(2)}s ${what}`);
    if (log.length > 12) log.shift();
  }
  for (const type of MEDIA_EVENTS) {
    video.addEventListener(type, () => note(type));
  }

  // play() is where autoplay policy shows up: a refusal is a rejected promise,
  // not an event. Wrapped on the instance, so the player's own calls are seen.
  const nativePlay = video.play;
  video.play = function play() {
    note("play() called");
    const p = nativePlay.apply(this, arguments);
    if (p && typeof p.then === "function") {
      p.then(
        () => note("play() ok"),
        (e) => note(`play() REJECTED ${e?.name ?? ""} ${e?.message ?? ""}`.trim())
      );
    }
    return p;
  };

  function errorLine() {
    const e = video.error;
    if (!e) return "-";
    const names = ["", "ABORTED", "NETWORK", "DECODE", "SRC_NOT_SUPPORTED"];
    return `${e.code} ${names[e.code] ?? ""} ${e.message ?? ""}`.trim();
  }

  function bufferedPercent() {
    const r = video.buffered;
    if (!r || r.length === 0 || !video.duration) return 0;
    let total = 0;
    for (let i = 0; i < r.length; i++) total += r.end(i) - r.start(i);
    return (total / video.duration) * 100;
  }

  function tick(now) {
    frames++;

    const gap = now - lastFrameAt;
    if (gap > worstFrameGap) worstFrameGap = gap;
    lastFrameAt = now;

    if (now - windowStart >= 500) {
      fps = Math.round((frames * 1000) / (now - windowStart));
      frames = 0;
      windowStart = now;

      box.textContent = [
        `fps          ${fps}`,
        `worst frame  ${worstFrameGap.toFixed(1)} ms`,
        `seek last    ${lastSeek.toFixed(1)} ms`,
        `seek worst   ${worstSeek.toFixed(1)} ms`,
        `seeks        ${seekCount}`,
        `buffered     ${bufferedPercent().toFixed(0)} %`,
        `readyState   ${video.readyState}`,
        `network      ${video.networkState}`,
        `state        ${video.paused ? "paused" : "playing"}${video.ended ? " ended" : ""} @ ${video.currentTime.toFixed(2)}s`,
        `last event   ${lastEvent} (${eventCount})`,
        `error        ${errorLine()}`,
        `src          ${video.currentSrc.split("/").pop() || "-"}`,
        `viewport     ${innerWidth}×${innerHeight}`,
        `ua           ${navigator.userAgent.slice(0, 60)}`,
        `activation   ${navigator.userActivation?.hasBeenActive ?? "?"}`,
        `visibility   ${document.visibilityState}`,
        "--- events ---",
        ...log,
      ].join("\n");

      worstFrameGap = 0;
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  return {
    reset() {
      worstSeek = 0;
      seekCount = 0;
    },
  };
}
