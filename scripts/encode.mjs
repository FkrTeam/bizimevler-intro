#!/usr/bin/env node
/**
 * Video encoding pipeline for the scroll-scrub template.
 *
 *   node scripts/encode.mjs <input> [options]
 *
 * Encodes to the flag set this template needs, writes a poster frame, and
 * prints the numbers you must copy into template.config.js.
 *
 * Options
 *   --out <path>      output file            (default: public/scroll-v1.mp4)
 *   --width <px>      target width           (default: 1792)
 *   --fps <n>         output frame rate      (default: 30)
 *   --gop <n>         keyframe interval      (default: 15)
 *   --crf <n>         quality, lower=better  (default: 27)
 *   --frames <n>      trim to N frames       (default: whole clip)
 *   --vmaf            measure quality against the source
 *   --no-poster       skip the poster frame
 *
 * WHY THESE DEFAULTS — every one was measured, not guessed:
 *
 *   fps must match the source's TRUE rate, which may not be the number the
 *   container declares. Lowering it looks fine while scrubbing (the visitor
 *   controls the rate) but visibly judders during the intro playback, and
 *   decimating genuinely-30fps footage to 24 is worse still: a non-integer
 *   conversion gives uneven frame spacing.
 *
 *   But a master that declares 30 while carrying a duplicate every fifth frame
 *   is really 24, padded — and shipping the padding causes the very judder you
 *   are avoiding. Check before encoding (README, "Video kodlama"), and if the
 *   source is padded, strip the copies with `decimate=cycle=5` first and pass
 *   the result here. Do NOT reach for --fps to do it: this script's `fps=`
 *   filter picks by timestamp, and where the rounding falls wrong it keeps the
 *   copy and drops the real frame.
 *
 *   GOP is the biggest single lever, and it cuts both ways. Seeking to an
 *   arbitrary frame means decoding from the previous keyframe forward, so a
 *   short GOP makes the scrub cheap — but on slow or near-static footage,
 *   frequent keyframes spend most of the file re-encoding a nearly identical
 *   picture. Going 10 → 15 on this project produced a file that was 15%
 *   smaller AND scored higher. Push to 20 for more, at 19 frames of worst-case
 *   seek. Drop to 5 if the scrub is the priority: expect roughly +60% size.
 *
 *   Resolution beats CRF. At a fixed budget, spending bytes on pixels scored
 *   higher than spending them on quantiser every time it was measured.
 *
 *   -level 4.0 -refs 4 is not cosmetic. Left off, `veryslow` raises the
 *   reference count to 16 and the file declares AVC level 5.0, which drops
 *   older devices from hardware to software decode — exactly the stutter you
 *   are trying to avoid. GOP 15 makes more than ~14 references pointless
 *   anyway, so the cap costs nothing measurable.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/* ---- locate ffmpeg ------------------------------------------------------ */

function findFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return "ffmpeg";
  } catch {
    /* not on PATH — try the usual Windows package location */
  }

  const root = join(
    process.env.LOCALAPPDATA ?? "",
    "Microsoft",
    "WinGet",
    "Packages"
  );
  if (!existsSync(root)) return null;

  for (const entry of readdirSync(root)) {
    if (!entry.toLowerCase().includes("ffmpeg")) continue;
    const dir = join(root, entry);
    for (const sub of readdirSync(dir)) {
      const candidate = join(dir, sub, "bin", "ffmpeg.exe");
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/* ---- args --------------------------------------------------------------- */

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0].startsWith("--")) {
  console.error("usage: node scripts/encode.mjs <input> [options]");
  process.exit(1);
}

const input = argv[0];
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const opts = {
  out: flag("out", "public/scroll-v1.mp4"),
  width: Number(flag("width", 1792)),
  fps: Number(flag("fps", 30)),
  gop: Number(flag("gop", 15)),
  crf: Number(flag("crf", 27)),
  frames: flag("frames", null),
  vmaf: has("vmaf"),
  poster: !has("no-poster"),
};

const ffmpeg = findFfmpeg();
if (!ffmpeg) {
  console.error(
    "ffmpeg not found.\nInstall it with:  winget install Gyan.FFmpeg\nThen reopen the terminal."
  );
  process.exit(1);
}

if (!existsSync(input)) {
  console.error(`input not found: ${input}`);
  process.exit(1);
}

mkdirSync(dirname(resolve(opts.out)), { recursive: true });

/* ---- encode ------------------------------------------------------------- */

const run = (args) => {
  const r = spawnSync(ffmpeg, args, { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(r.stderr?.slice(-2000) ?? "ffmpeg failed");
    process.exit(1);
  }
  return r.stderr ?? "";
};

const filters = `scale=${opts.width}:-2,fps=${opts.fps}`;

const encodeArgs = [
  "-y",
  "-loglevel", "error",
  "-i", input,
  "-vf", filters,
  ...(opts.frames ? ["-frames:v", String(opts.frames)] : []),
  // Audio is dead weight: a scrubbed clip never plays it, and the track still
  // costs bytes and decoder setup.
  "-an",
  "-c:v", "libx264",
  "-profile:v", "high",
  "-level", "4.0",
  "-refs", "4",
  "-preset", "veryslow",
  "-crf", String(opts.crf),
  "-g", String(opts.gop),
  "-keyint_min", String(opts.gop),
  // Stops the encoder inserting extra keyframes at scene changes, which would
  // make the interval — and therefore the seek cost — unpredictable.
  "-sc_threshold", "0",
  "-pix_fmt", "yuv420p",
  // Moves the index to the front so the file streams progressively instead of
  // needing a full download before the first frame.
  "-movflags", "+faststart",
  opts.out,
];

console.log(`encoding  ${opts.width}px · ${opts.fps}fps · GOP ${opts.gop} · crf ${opts.crf}`);
run(encodeArgs);

/* ---- poster ------------------------------------------------------------- */

const posterPath = join(dirname(opts.out), "poster.jpg");
if (opts.poster) {
  run([
    "-y", "-loglevel", "error",
    "-i", opts.out,
    "-vf", "select=eq(n\\,0),scale=1024:-2",
    "-frames:v", "1",
    "-q:v", "6",
    posterPath,
  ]);
}

/* ---- report ------------------------------------------------------------- */

const probe = run(["-hide_banner", "-i", opts.out, "-f", "null", "-"]);
const stream = /Video:.*?(\d{3,5})x(\d{3,5}).*?(\d+(?:\.\d+)?) fps/.exec(probe);
const dur = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(probe);

const bytes = statSync(opts.out).size;
const seconds = dur
  ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])
  : 0;

console.log(`\nwrote     ${opts.out}  ${(bytes / 1048576).toFixed(2)} MB`);
if (opts.poster) console.log(`poster    ${posterPath}`);

if (opts.vmaf) {
  console.log("\nmeasuring VMAF against the source…");
  const out = run([
    "-hide_banner", "-nostats",
    "-i", opts.out,
    "-i", input,
    "-lavfi",
    "[0:v]scale=1920:1080:flags=bicubic,setpts=PTS-STARTPTS[d];" +
      "[1:v]scale=1920:1080:flags=bicubic,setpts=PTS-STARTPTS[r];[d][r]libvmaf",
    "-f", "null", "-",
  ]);
  const m = /VMAF score:\s*([\d.]+)/.exec(out);
  if (m) console.log(`VMAF      ${Number(m[1]).toFixed(2)}   (90+ is good for web)`);
}

/* The two values that must be copied by hand — a mismatch between the config
   and the file is silent and shows up as a scrub that feels slightly wrong. */
console.log(`
Copy into template.config.js → video:
  src:      "./${opts.out.replace(/^public[\\/]/, "")}"
  width:    ${stream?.[1] ?? "?"}
  height:   ${stream?.[2] ?? "?"}
  fps:      ${stream?.[3] ?? opts.fps}
  duration: ${seconds.toFixed(3)}
`);
