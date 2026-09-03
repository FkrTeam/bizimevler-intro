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
 */

const VIDEO = /\.mp4$/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const range = request.headers.get("Range");

    if (!VIDEO.test(url.pathname) || !range || request.method !== "GET") {
      return env.ASSETS.fetch(request);
    }

    // Ask the store for the whole file. It ignores Range anyway; dropping the
    // header keeps the upstream request identical to a plain download.
    const headers = new Headers(request.headers);
    headers.delete("Range");
    headers.delete("If-Range");
    const upstream = await env.ASSETS.fetch(new Request(url, { headers }));

    if (upstream.status !== 200 || !upstream.body) return upstream;

    // If-Range: the client holds a version and only wants the slice if it is
    // still that version. On a mismatch the spec says: send the whole thing.
    const ifRange = request.headers.get("If-Range");
    if (ifRange) {
      const etag = upstream.headers.get("ETag");
      const lastModified = upstream.headers.get("Last-Modified");
      if (ifRange !== etag && ifRange !== lastModified) return upstream;
    }

    const file = await upstream.arrayBuffer();
    const total = file.byteLength;

    const slice = parseRange(range, total);
    if (slice === null) {
      // Not a single byte range we serve (multipart, malformed): the full
      // file is the safe answer.
      return new Response(file, { status: 200, headers: upstream.headers });
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
    const out = new Headers(upstream.headers);
    out.set("Content-Range", `bytes ${start}-${end}/${total}`);
    out.set("Content-Length", String(end - start + 1));
    out.set("Accept-Ranges", "bytes");
    out.delete("Content-Encoding");

    return new Response(file.slice(start, end + 1), { status: 206, headers: out });
  },
};

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
