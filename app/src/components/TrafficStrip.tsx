import { getStatsSite } from "../lib/analytics"

/**
 * Footer live-traffic line (build.py #ft-traffic). Starts hidden; analytics
 * initTrafficStrip reveals it only after both counter fetches succeed.
 * Home page only — archive/privacy/detail ship no strip (Python app_js gate).
 */
export function TrafficStrip() {
  const site = getStatsSite()
  if (!site) return null
  return (
    <p className="foot-traffic" id="ft-traffic" role="status" aria-live="polite" hidden>
      <span className="dot" aria-hidden="true"></span>site traffic &middot;{" "}
      <strong id="ft-traffic-today">&mdash;</strong> visitors today &middot;{" "}
      <strong id="ft-traffic-period">&mdash;</strong> in 90 days &middot;{" "}
      <a href={site} rel="noopener noreferrer">
        full stats
      </a>
    </p>
  )
}
