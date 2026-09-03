import { getStatsSite } from "../lib/analytics"

/**
 * Live-traffic line (#ft-traffic). Starts hidden; initTrafficStrip reveals
 * it once the all-time total arrives. Today and 90-day windows stay hidden
 * until their own fetches succeed. Unconfigured site: null.
 *
 * Mounted at the top of the home page inside SiteStats (#279) and in the
 * footer on every other page; the element ids are what initTrafficStrip
 * looks up, so they are identical in both placements.
 */
export function TrafficStrip() {
  const site = getStatsSite()
  if (!site) return null
  return (
    <p className="stat-strip" id="ft-traffic" role="status" aria-live="polite" hidden>
      <span className="ft-stat ft-traffic-total">
        <strong id="ft-traffic-total">&mdash;</strong>{" "}
        <span className="ft-stat-label">visits</span>
      </span>
      <span className="ft-stat ft-traffic-today" hidden>
        <strong id="ft-traffic-today">&mdash;</strong>{" "}
        <span className="ft-stat-label">today</span>
      </span>
      <span className="ft-stat ft-traffic-period" hidden>
        <strong id="ft-traffic-period">&mdash;</strong>{" "}
        <span className="ft-stat-label">90 days</span>
      </span>
      <a href={site} rel="noopener noreferrer">
        full stats
      </a>
    </p>
  )
}
