import { TrafficStrip } from "./TrafficStrip"
import { buildDate, humanDate } from "../lib/offers"

/**
 * Masthead stats rail (#279 / #280 / #281). One mono strip sits directly
 * under the site header on the home page and carries, left to right:
 *
 *   1. the TOTAL active deal count (#281) — build-time and unfiltered, so it
 *      never competes with the toolbar's "Showing N of M" filtered counter;
 *   2. the catalog's last-updated date (#280) from `index.generated_at`,
 *      marked up as <time> so it is machine-readable as well as visible;
 *   3. the live visitor stats (#279), moved up here from the footer.
 *
 * (1) and (2) are prerendered, so they are correct with JavaScript off and
 * are indexable. TrafficStrip arrives asynchronously, so `.site-stats`
 * reserves its box with `visibility` rather than `display` — the reveal
 * costs zero layout shift above the fold.
 */
export function SiteStats({
  activeCount,
  generatedAt,
}: {
  activeCount: number
  generatedAt: string
}) {
  const day = buildDate(generatedAt || "")
  return (
    <aside className="site-stats" aria-label="Catalog and visitor stats">
      <span className="ft-stat stat-deals">
        <strong>{activeCount}</strong>{" "}
        <span className="ft-stat-label">{activeCount === 1 ? "active deal" : "active deals"}</span>
      </span>
      {day ? (
        <span className="ft-stat stat-updated">
          <span className="ft-stat-label">updated</span>{" "}
          <strong>
            <time dateTime={generatedAt}>{humanDate(day)}</time>
          </strong>
        </span>
      ) : null}
      <TrafficStrip />
    </aside>
  )
}
