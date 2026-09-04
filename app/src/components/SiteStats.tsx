import { buildDate, humanDate } from "../lib/offers";

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

/** Days between two YYYY-MM-DD days; -1 when either is unparseable. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return -1;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * The widest window the day-granular data actually proves. `verified_date` is
 * a calendar day, not a timestamp, so a gap of N days between the check and
 * the build bounds the real elapsed time only by (N + 1) * 24h: a check on the
 * build's own day is at most a day old, yesterday's check at most two days
 * old. Rounding that down — "24 hours" for a one-day gap — invents precision
 * the schema cannot carry and makes the proof line a claim we cannot stand on.
 * Returns "" when the age is unknown, so the caller drops the clause.
 */
function checkWindowFor(age: number): string {
  if (age < 0) return "";
  return age === 0 ? "1 day" : `${age + 1} days`;
}

/**
 * The proof line (#279 / #280 / #281, reworked). One mono sentence under the
 * masthead carrying the three facts that back the curator claim:
 *
 *   1. how many offers are live right now — build-time and unfiltered, so it
 *      never competes with the toolbar's "Showing N of M" filtered counter;
 *   2. how stale the *oldest* live offer is, phrased as the widest window the
 *      day-granular `verified_date` actually proves (see `checkWindowFor`)
 *      rather than a date, so the claim is derived and can never rot into a
 *      lie;
 *   3. how many expired offers were taken off the list and moved to the
 *      archive — the strongest single piece of evidence that the list is
 *      maintained rather than accumulated.
 *
 * All three are prerendered, so they are correct with JavaScript off and are
 * indexable. The live traffic numbers moved to the header, where they render
 * on every route; this line is now purely build-derived and needs no
 * reserved box, because nothing in it arrives late.
 */
export function SiteStats({
  activeCount,
  archivedCount = 0,
  oldestVerified = "",
  generatedAt,
}: {
  activeCount: number;
  archivedCount?: number;
  oldestVerified?: string;
  generatedAt: string;
}) {
  const day = buildDate(generatedAt || "");
  // humanDate echoes its input verbatim on a malformed date; never print that.
  const updated = day ? humanDate(day) : "";
  const age = oldestVerified && day ? daysBetween(oldestVerified, day) : -1;
  const checkWindow = checkWindowFor(age);
  return (
    <div className="site-stats">
      <style>{RAIL_CSS}</style>
      <span className="stat-deals">
        <strong>{activeCount}</strong>{" "}
        {activeCount === 1 ? "live offer" : "live offers"}
      </span>
      {checkWindow ? (
        <>
          <span className="stat-sep" aria-hidden="true">
            &middot;
          </span>
          <span className="stat-checked">
            every one re-checked within <strong>{checkWindow}</strong>
          </span>
        </>
      ) : null}
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
      {updated && updated !== day ? (
        <>
          <span className="stat-sep" aria-hidden="true">
            &middot;
          </span>
          <span className="stat-updated">
            list built{" "}
            <strong>
              <time dateTime={generatedAt}>{updated}</time>
            </strong>
          </span>
        </>
      ) : null}
    </div>
  );
}
