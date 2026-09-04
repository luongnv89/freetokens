import { getStatsSite } from "../lib/analytics"

/**
 * Live-traffic line (#ft-traffic). Starts hidden; initTrafficStrip reveals
 * it once the all-time total arrives. The today and this-page windows stay
 * hidden until their own fetches succeed. Unconfigured site: null.
 *
 * Mounted once per page, in the header, so the same three numbers appear on
 * every route. The ids are what initTrafficStrip looks up, so there must
 * never be a second mount: getElementById returns only the first, and a
 * duplicate strip would sit permanently at an em dash.
 *
 * The 90-day window is deliberately absent. initTrafficStrip fetches it only
 * when `#ft-traffic-period` is in the DOM, so omitting it here costs one
 * fewer request per page load rather than leaving a dead element behind.
 *
 * There is no link out to the GoatCounter dashboard: it is readable only by
 * the site owner, so for every visitor it was a link to a login wall. The
 * numbers stand on their own. `site` is still what gates the whole strip —
 * unconfigured GoatCounter renders nothing at all.
 *
 * `pageViews` is false on offer detail pages, which already show that exact
 * count in the hero. Dropping the span there removes both the duplicated
 * number and a second request for a counter the page has already fetched,
 * because initTrafficStrip only fetches a window whose element is mounted.
 */
export function TrafficStrip({ pageViews = true }: { pageViews?: boolean }) {
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
      {pageViews ? (
        <span className="ft-stat ft-traffic-page" hidden>
          <strong id="ft-traffic-page">&mdash;</strong>{" "}
          <span className="ft-stat-label">this page</span>
        </span>
      ) : null}
    </p>
  )
}
