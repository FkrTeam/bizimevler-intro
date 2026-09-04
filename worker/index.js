/**
 * Cloudflare Worker in front of the static build.
 *
 * Everything is served straight from the asset store — except video. Static
 * assets answer a `Range` request with `200` and the whole file, and Safari
 * refuses to play media from a server that does that: it probes with a range
 * request first and gives up without a `206`. Chromium copes, but seeking
 * (which the scroll scrub does constantly) then means re-downloading the clip.
 *
 * So `.mp4` requests are routed here (see `run_worker_first` in
 * wrangler.jsonc). When a single byte range is asked for, the Worker fetches
 * the asset, slices it, and answers `206 Partial Content` with the headers a
 * media pipeline expects. Requests without a `Range` header pass through.
 *
 * The file is read into memory rather than streamed because the asset binding
 * does not report a Content-Length, and a `206` cannot be written without
 * knowing the total size. The clips are a few megabytes, well inside the
 * Worker's memory; the asset fetch itself is served from Cloudflare's cache.
 *
 * That read is then kept. A phone does not ask for the clip once: Safari
 * probes with a two-byte range, then walks the file in chunks, and Chromium
 * opens a new range every time it seeks or its buffer runs dry — a dozen or
 * more requests for one playback. Paying a full multi-megabyte asset fetch
 * for each of them is what turned the intro into a stop-start affair on
 * mobile. So once a file has been read, the isolate holds on to it and every
 * later range is a slice of memory. Keyed by path and validator, so a redeploy
 * that reuses a filename (which the cache headers say not to do) still cannot
 * serve a stale body.
 */

const VIDEO = /\.mp4$/i;

/** @type {Map<string, {file: ArrayBuffer, headers: Headers}>} */
const held = new Map();
const HOLD_LIMIT = 4;

/** The whole asset, from memory when this isolate has read it before. */
async function readAsset(env, url) {
  // Ask the store for the whole file. It ignores Range anyway; a bare request
  // keeps the upstream identical to a plain download and so cache-friendly.
  const upstream = await env.ASSETS.fetch(new Request(url));
  if (upstream.status !== 200 || !upstream.body) return { upstream };

  const key = `${url.pathname}|${upstream.headers.get("ETag") ?? ""}|${
    upstream.headers.get("Last-Modified") ?? ""
  }`;
  const hit = held.get(key);
  if (hit) {
    // The body was fetched only to learn the validator; let it go unread.
    await upstream.body.cancel().catch(() => {});
    return { ...hit, headers: upstream.headers };
  }

  const file = await upstream.arrayBuffer();
  if (held.size >= HOLD_LIMIT) held.delete(held.keys().next().value);
  held.set(key, { file, headers: upstream.headers });
  return { file, headers: upstream.headers };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const range = request.headers.get("Range");

    if (!VIDEO.test(url.pathname) || !range || request.method !== "GET") {
      return env.ASSETS.fetch(request);
    }

    const { upstream, file, headers: assetHeaders } = await readAsset(env, url);
    if (!file) return upstream;

    const full = () =>
      new Response(file, { status: 200, headers: withLength(assetHeaders, file) });

    // If-Range: the client holds a version and only wants the slice if it is
    // still that version. On a mismatch the spec says: send the whole thing.
    const ifRange = request.headers.get("If-Range");
    if (ifRange) {
      const etag = assetHeaders.get("ETag");
      const lastModified = assetHeaders.get("Last-Modified");
      if (ifRange !== etag && ifRange !== lastModified) return full();
    }

    const total = file.byteLength;

    const slice = parseRange(range, total);
    if (slice === null) {
      // Not a single byte range we serve (multipart, malformed): the full
      // file is the safe answer.
      return full();
    }
    if (slice === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${total}`,
          "Accept-Ranges": "bytes",
        },
      });
    }

    const { start, end } = slice;
    const out = new Headers(assetHeaders);
    out.set("Content-Range", `bytes ${start}-${end}/${total}`);
    out.set("Content-Length", String(end - start + 1));
    out.set("Accept-Ranges", "bytes");
    out.delete("Content-Encoding");

    return new Response(file.slice(start, end + 1), { status: 206, headers: out });
  },
};

/** A full-body answer built from memory: the store's headers, plus the size
 *  the store never states, minus the encoding it no longer has. */
function withLength(headers, file) {
  const out = new Headers(headers);
  out.set("Content-Length", String(file.byteLength));
  out.set("Accept-Ranges", "bytes");
  out.delete("Content-Encoding");
  return out;
}

/**
 * `bytes=a-b`, `bytes=a-`, `bytes=-n` → { start, end } (inclusive), or
 * "unsatisfiable" when the range lies past the end, or null when it is not a
 * single byte range this worker will serve.
 */
function parseRange(value, total) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === "" && b === "") return null;

  let start;
  let end;
  if (a === "") {
    // Suffix form: the last n bytes.
    const n = Number(b);
    if (n === 0) return "unsatisfiable";
    start = Math.max(total - n, 0);
    end = total - 1;
  } else {
    start = Number(a);
    end = b === "" ? total - 1 : Math.min(Number(b), total - 1);
  }

  if (start >= total || start > end) return "unsatisfiable";
  return { start, end };
}
