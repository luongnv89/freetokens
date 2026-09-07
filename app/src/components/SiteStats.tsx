import { humanDate } from "../lib/offers";

/**
 * Home-only proof-line layout. Kept out of python-parity.css so offer-detail
 * pages do not download or parse unused rules (Lighthouse unused-css /
 * render-blocking on /offers/*.html). CSP already allows style-src
 * 'unsafe-inline'. Compact on purpose: this string is in the shared JS
 * bundle, but it is not in the shared stylesheet.
 *
 * The traffic-strip overrides are gone with the strip itself, which now
 * mounts in the shared header; everything left here is build-derived and
 * present in the prerendered HTML, so nothing needs a reserved box.
 */
const RAIL_CSS =
  ".site-stats{display:flex;flex-wrap:wrap;align-items:baseline;gap:.2rem .5rem;" +
  "margin:0 0 clamp(.7rem,2.5vw,1.1rem);font:.74rem/1.45 var(--font-mono,monospace);" +
  "color:var(--gray)}" +
  // Four wrapped lines at 1.6 made this derived sentence the second-tallest
  // block on a phone. Tighter leading and a smaller size give the space back
  // to the offers without dropping a single fact from the claim.
  "@media(max-width:640px){.site-stats{font-size:.7rem;line-height:1.4;gap:.1rem .45rem}}" +
  ".site-stats strong{color:var(--ink);font-weight:600}" +
  ".site-stats .stat-sep{color:var(--hairline)}" +
  ".site-stats a{color:inherit;text-decoration:underline;" +
  "text-decoration-color:var(--hairline);text-underline-offset:3px}" +
  ".site-stats a:hover,.site-stats a:focus-visible{color:var(--ink);" +
  "text-decoration-color:var(--green);text-decoration-thickness:2px}";

/**
 * Home-only proof line. One mono sentence under the masthead carrying the
 * facts that back the curator claim:
 *
 *   1. how many offers are live right now — build-time and unfiltered, so it
 *      never competes with the toolbar's "Showing N of M" filtered counter;
 *   2. how many expired offers were taken off the list and moved to the
 *      archive — the strongest single piece of evidence that the list is
 *      maintained rather than accumulated.
 *
 * Both are prerendered, so they are correct with JavaScript off and are
 * indexable. The live traffic numbers moved to the header, where they render
 * on every route; this line is now purely build-derived and needs no
 * reserved box, because nothing in it arrives late.
 */

/**
 * Exact build timestamp when `generated_at` carries one (e.g. 06:00 UTC),
 * else "" so the caller drops the clause. `generated_at` is emitted by
 * load-offers.mjs as full ISO, so the time is normally present.
 */
function timestampLabel(generatedAt: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(generatedAt);
  if (!m) return "";
  const day = humanDate(m[1]);
  return day ? `${day} ${m[2]}:${m[3]} UTC` : "";
}

export function SiteStats({
  activeCount,
  archivedCount = 0,
  generatedAt,
}: {
  activeCount: number;
  archivedCount?: number;
  generatedAt: string;
}) {
  const timestamp = timestampLabel(generatedAt);
  return (
    <div className="site-stats">
      <style>{RAIL_CSS}</style>
      <span className="stat-deals">
        <strong>{activeCount}</strong>{" "}
        {activeCount === 1 ? "live offer" : "live offers"}
      </span>
      {archivedCount > 0 ? (
        <>
          <span className="stat-sep" aria-hidden="true">
            &middot;
          </span>
          <span className="stat-archived">
            <strong>{archivedCount}</strong> expired{" "}
            <a href="archive.html">moved to the archive</a>
          </span>
        </>
      ) : null}
      {timestamp ? (
        <>
          <span className="stat-sep" aria-hidden="true">
            &middot;
          </span>
          <span className="stat-updated">
            last updated at{" "}
            <strong>
              <time dateTime={generatedAt}>{timestamp}</time>
            </strong>
          </span>
        </>
      ) : null}
    </div>
  );
}
