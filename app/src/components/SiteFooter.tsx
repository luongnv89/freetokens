import { Fragment } from "react"

const CONTACT_LINKS = [
  ["X", "https://x.com/luongnv89"],
  ["LinkedIn", "https://linkedin.com/in/luongnv89"],
  ["Website", "https://luongnv.com"],
] as const

/**
 * Shared footer chrome for every page (build.py _foot_nav + _contact_nav).
 * `depth` is the page's directory distance from site root (0 for
 * index/archive/privacy, 1 for offers/<slug>.html) and prefixes every href
 * so links stay relative and deploy-base safe (#60).
 */
export function SiteFooter({ depth = 0, current }: { depth?: number; current?: "home" | "archive" | "privacy" }) {
  const up = "../".repeat(depth)
  return (
    <footer className="foot" id="site-footer">
      <nav className="foot-nav" aria-label="Site">
        <a href={`${up || "./"}index.html`} aria-current={current === "home" ? "page" : undefined}>
          Offers
        </a>
        <span aria-hidden="true">&middot;</span>
        <a href={`${up}archive.html`} aria-current={current === "archive" ? "page" : undefined}>
          Archive
        </a>
        <span aria-hidden="true">&middot;</span>
        <a href={`${up}privacy.html`} aria-current={current === "privacy" ? "page" : undefined}>
          Privacy policy
        </a>
        <span aria-hidden="true">&middot;</span>
        <a href={`${up}feed.xml`}>RSS</a>
      </nav>
      <nav className="foot-nav" aria-label="Contact">
        {CONTACT_LINKS.map(([label, url], i) => (
          <Fragment key={label}>
            {i > 0 && <span aria-hidden="true">&middot;</span>}
            <a href={url} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          </Fragment>
        ))}
      </nav>
    </footer>
  )
}
