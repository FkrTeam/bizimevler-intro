import { defineConfig } from "vite";

import config from "./template.config.js";

/* ---------------------------------------------------------------------------
   Content injection

   The cards, masthead, video element and copy are written into index.html at
   BUILD time rather than rendered by the browser. That keeps the template
   data-driven without giving up the thing this page has been careful about
   throughout: the markup ships complete, so no-JS visitors, crawlers and
   reduced-motion users all get real content.

   enforce: "pre" so the asset URLs this emits still go through Vite's own
   asset pipeline and come out hashed.
--------------------------------------------------------------------------- */

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function renderMasthead(m) {
  if (!m) return "";
  return `<img class="film__logo" src="${esc(m.src)}" width="${m.width}" height="${
    m.height
  }" alt="${esc(m.alt)}" fetchpriority="high" />`;
}

function renderPrompt(text) {
  if (!text) return "";
  /* The track carries two children's worth of behaviour but only one element:
     the travelling hint is a pseudo-element, and this span is the scroll's own
     position filling the same groove once the hint retires. See main.css. */
  return `<p class="film__prompt" data-scroll-prompt>
            <span class="film__prompt-text">${esc(text)}</span>
            <span class="film__prompt-line" aria-hidden="true">
              <span class="film__prompt-fill"></span>
            </span>
          </p>`;
}

/* Vite rewrites and hashes `srcset` on <img> the same way it does `src`, so the
   whole set goes through the asset pipeline and comes out immutable-cacheable.
   Numeric object keys iterate in ascending order, which is also the order the
   descriptors want to be read in. */
function renderSrcset(photo, sizes) {
  if (!photo.srcset) return "";
  const set = Object.entries(photo.srcset)
    .map(([w, src]) => `${esc(src)} ${w}w`)
    .join(", ");
  return `\n                      srcset="${set}"\n                      sizes="${esc(sizes)}"`;
}

function renderCard(item, sizes) {
  const rel = item.external ? ` target="_blank" rel="noopener noreferrer"` : "";
  const tone = item.status?.tone && item.status.tone !== "none"
    ? ` card__status--${item.status.tone}`
    : "";

  const status = item.status?.label
    ? `<span class="card__status${tone}">${esc(item.status.label)}</span>
                        <span class="card__sep" aria-hidden="true"></span>`
    : "";

  return `<li>
                  <a class="card" href="${esc(item.href)}"${rel}>
                    <img class="card__photo" src="${esc(item.photo.src)}" alt=""${renderSrcset(item.photo, sizes)}
                      width="${item.photo.width}" height="${item.photo.height}"
                      loading="lazy" decoding="async" fetchpriority="low" />
                    <span class="card__content">
                      <h3 class="card__title">
                        <img class="card__logo" src="${esc(item.logo.src)}"
                          alt="${esc(item.name)}"
                          width="${item.logo.width}" height="${item.logo.height}"
                          loading="lazy" decoding="async" />
                      </h3>
                      <span class="card__meta">
                        ${status}${esc(item.meta ?? "")}
                      </span>
                    </span>
                    <span class="card__rule" aria-hidden="true"></span>
                  </a>
                </li>`;
}

function renderContent(content) {
  if (!content?.items?.length) return "";
  return `<div class="film__cards-inner">
              <h2 class="film__cards-title">${esc(content.title)}</h2>
              <ul class="cards">
                ${content.items
                  .map((item) => renderCard(item, content.photoSizes))
                  .join("\n                ")}
              </ul>
            </div>`;
}

/* Two cuts, one download.
   <source media> is resolved once, during resource selection, before anything
   is fetched — so the phone never pays for the wide file and the desktop never
   pays for the portrait one. Order matters: the first source whose media
   matches wins, so the narrow case is listed first and the wide cut is left
   unconditional as the fallback.

   The trade is that the choice is not re-evaluated when the viewport changes;
   resizing a desktop window past the breakpoint keeps the cut it started with.
   That is the right side of the trade here — the alternative costs a second
   download of a multi-megabyte file to fix a case that only arises when the
   window is being dragged.

   No `poster` attribute: it takes exactly one file, and the portrait cut needs
   its own. Both are emitted as CSS custom properties instead (see buildTokens)
   and painted as the element's background, which a media query can switch. */
/* Icons and social tags.

   The icons are emitted as explicit <link>s rather than left to the browser's
   /favicon.ico probe, so there is no speculative 404 on every cold visit — and
   so the 32px PNG is what actually gets used, the .ico being kept only for the
   clients that still ask for it by convention.

   og:image is absolute because the crawlers that read it (WhatsApp, Facebook,
   Slack) fetch the URL from their own infrastructure, where a document-relative
   path resolves against nothing. When no origin is configured the tags are
   still written — a preview with a title and no image beats no preview — but
   the canonical is dropped, since a relative canonical says nothing. */
function renderMeta(p) {
  const origin = p.url ? p.url.replace(/\/+$/, "/") : null;
  const abs = (path) => (origin ? origin + path.replace(/^\.?\//, "") : path);

  return [
    `<link rel="icon" type="image/png" sizes="32x32" href="./favicon-32.png" />`,
    `<link rel="icon" sizes="48x48" href="./favicon.ico" />`,
    `<link rel="apple-touch-icon" href="./apple-touch-icon.png" />`,
    ...(origin ? [`<link rel="canonical" href="${esc(origin)}" />`] : []),
    ``,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(p.siteName ?? p.title)}" />`,
    `<meta property="og:title" content="${esc(p.title)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    ...(origin ? [`<meta property="og:url" content="${esc(origin)}" />`] : []),
    ...(p.ogImage
      ? [
          `<meta property="og:image" content="${esc(abs(p.ogImage))}" />`,
          `<meta property="og:image:width" content="1200" />`,
          `<meta property="og:image:height" content="630" />`,
          `<meta property="og:image:alt" content="${esc(p.title)}" />`,
        ]
      : []),
    `<meta property="og:locale" content="${esc(
      p.lang === "tr" ? "tr_TR" : p.lang
    )}" />`,
    ``,
    /* summary_large_image, not summary: the image is a 1.91:1 landscape still
       and the small card would centre-crop it to a square, cutting off most of
       the projects it exists to show. */
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join("\n    ");
}

/* `not all and (...)` rather than `not (...)`: the bare form is Media Queries
   Level 4 and the `all` form works everywhere, for a query that has to be
   understood by the preload scanner rather than the cascade. */
/* Vite scans both `link[href]` and the url() inside an inline <style> through
   its asset pipeline, and a document-relative path to a file in public/ is the
   one thing it cannot resolve — it warns, then passes the string through
   untouched. A leading slash is how you tell it "this is a public asset"; it
   still rewrites the result against `base`, so a subpath deploy keeps working.
   Config keeps writing "./poster.jpg" because that is the form the file is
   actually served at; this is the translation for the two places Vite looks. */
const publicPath = (href) => href.replace(/^\.\//, "/");

function renderPosterPreload(v) {
  const p = v.portrait;

  const tag = (href, media) =>
    `<link rel="preload" as="image" href="${esc(publicPath(href))}"${
      media ? ` media="${esc(media)}"` : ""
    } />`;

  if (!p) return tag(v.poster);

  return [
    tag(p.poster, p.media),
    tag(v.poster, `not all and ${p.media}`),
  ].join("\n    ");
}

function renderVideo(v) {
  const p = v.portrait;

  const sources = [
    ...(p
      ? [`<source src="${esc(p.src)}" type="video/mp4" media="${esc(p.media)}" />`]
      : []),
    `<source src="${esc(v.src)}" type="video/mp4" />`,
  ].join("\n            ");

  return `<video id="film-video" class="film__video"
            width="${v.width}" height="${v.height}"
            muted playsinline preload="auto" disablepictureinpicture
            aria-hidden="true">
            ${sources}
          </video>`;
}

function templatePlugin() {
  const c = config;

  /* Scroll runway. When scroll drives the timeline it is derived from the clip
     rather than hand-tuned per project: change the video and the section
     resizes itself; leave it fixed and a shorter clip drags while a longer one
     races.

     `scroll.runway` overrides that, and "hold" is why it exists — there the
     clip is not scrubbed, so scaling the section by its duration would buy
     nothing but dead scroll, and the distance is only ever about giving the
     content room to arrive and be read. */
  const runway =
    c.scroll.runway ?? Math.round(c.video.duration * c.scroll.runwayPerSecond);

  /* The whole <style> block, not just the declarations inside :root — the
     portrait cut needs its tokens under a media query, and a media query
     cannot live inside a rule. Emitting the block here also means the
     breakpoint is written once, in template.config.js, and the markup and the
     styling cannot drift apart on it. */
  function buildTokens() {
    const p = c.video.portrait;

    const root = [
      /* lvh for the same reason .film__sticky uses it: the runway must not
         change length while a mobile browser retracts its address bar, or the
         scroll fraction driving the whole sequence jumps mid-gesture. */
      `--film-runway:${runway}lvh;`,
      `--film-aspect:${c.video.width}/${c.video.height};`,
      /* How far the prompt lives, so the fill descending its track can be
         scaled to finish exactly as the prompt finishes fading. Emitted rather
         than written into the stylesheet because the number belongs to the
         choreography in template.config.js — hard-coding it in CSS is how the
         two quietly drift apart. */
      `--film-prompt-span:${c.scroll.promptFade?.[1] ?? 0.46};`,
    ].join("");

    /* The poster is a rule here, not a custom property. A url() inside a
       custom property is resolved where the var() is substituted, and that is
       .film__video in the hashed stylesheet under /assets/ — so a relative
       poster path, which is what a "./" base leaves after Vite's rewrite,
       was being fetched as /assets/poster.jpg and 404ing. Nobody saw it on a
       fast connection because the first decoded frame covers the same box;
       on a phone it was the black screen before the clip arrived. Declared
       in this inline block, the URL resolves against the document, which is
       where the file actually sits relative to. main.css sets every other
       background longhand and leaves background-image alone, so source order
       between this block and the stylesheet does not matter. */
    const poster = (href) =>
      `.film__video{background-image:url("${publicPath(href)}")}`;

    const blocks = [`:root{${root}}`, poster(c.video.poster)];

    if (p) {
      blocks.push(
        `@media ${p.media}{:root{--film-aspect:${p.width}/${p.height};}${poster(
          p.poster
        )}}`
      );
    }

    /* The narrow breakpoint moves where the prompt ends, and the fill
       descending its track is scaled by exactly that number. Emitted here from
       the same override main.js reads, so the two cannot end up describing
       different moments — the fill reaching the bottom of the track IS the
       prompt finishing its fade, on either layout. */
    const n = c.scroll.narrow;
    if (n?.media && n.promptFade?.[1] != null) {
      blocks.push(
        `@media ${n.media}{:root{--film-prompt-span:${n.promptFade[1]};}}`
      );
    }

    return blocks.join("");
  }

  return {
    name: "template-content",
    // order:"pre" on the hook itself, not just enforce on the plugin. Vite
    // resolves and hashes asset URLs inside index.html during its own
    // transformIndexHtml pass; injecting after that pass ships the raw
    // /src/... paths, which 404 in production while building without error.
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html
          .replace(/%LANG%/g, esc(c.page.lang))
          .replace(/%TITLE%/g, esc(c.page.title))
          .replace(/%DESCRIPTION%/g, esc(c.page.description))
          .replace(/%SKIP_LABEL%/g, esc(c.page.skipLinkLabel))
          .replace(/%META%/g, renderMeta(c.page))
          .replace(/%TOKENS%/g, buildTokens())
          .replace(/%POSTER_PRELOAD%/g, renderPosterPreload(c.video))
          .replace(/%VIDEO%/g, renderVideo(c.video))
          .replace(/%MASTHEAD%/g, renderMasthead(c.masthead))
          .replace(/%PROMPT%/g, renderPrompt(c.prompt))
          .replace(/%CONTENT%/g, renderContent(c.content));
      },
    },
  };
}

export default defineConfig({
  // Relative base so dist/ works from any subpath, not just the domain root.
  base: "./",

  plugins: [templatePlugin()],

  server: {
    port: 5173,
    open: true,
  },

  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: false,
    // Emit every asset as a hashed file instead of inlining the small ones.
    // Inlined assets land inside index.html, which is served no-cache, so a
    // 3.5 kB logo would re-download on every visit while its two siblings sat
    // in the immutable cache. Consistency is worth one extra request.
    assetsInlineLimit: 0,
  },
});
