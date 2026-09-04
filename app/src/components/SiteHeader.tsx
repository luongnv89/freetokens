import { BrandMark } from "./BrandMark"

/**
 * Shared header chrome for every page (#112): the same brand bar and
 * primary nav render on every route, so navigating between pages shows
 * no jump in layout or branding. `depth` mirrors SiteFooter (0 for root
 * pages, 1 for offers/<slug>.html) and prefixes every href; `current`
 * drives the active nav state. The shared bar renders a wordmark; each route
 * renders its own page heading below this bar.
 */
export function SiteHeader({
  depth = 0,
  current,
  slogan,
}: {
  depth?: number
  current?: "home" | "archive" | "privacy" | "about"
  slogan?: string
}) {
  const up = "../".repeat(depth)
  const homeHref = `${up || "./"}index.html`
  const showSlogan = slogan ?? (current === "home"
    ? "Free AI credits, checked one by one"
    : undefined)
  const SloganTag = current === "home" ? "h1" : "p"
  return (
    <div className="site-header">
      <div className="site-bar">
        <a className="site-brand" href={homeHref} aria-label="Free AI Credits — home">
          <BrandMark depth={depth} size={28} alt="" priority />
          <span className="site-wordmark">Free AI Credits</span>
        </a>
        <nav className="site-nav" aria-label="Primary">
          <a href={homeHref} aria-current={current === "home" ? "page" : undefined}>
            Offers
          </a>
          <a
            className="nav-archive"
            href={`${up}archive.html`}
            title="All deals"
            aria-label="Archive: all deals"
            aria-current={current === "archive" ? "page" : undefined}
          >
            <svg
              className="nav-i"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <rect width="20" height="5" x="2" y="3" rx="1" />
              <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
              <path d="M10 12h4" />
            </svg>
            Archive
          </a>
          <a href={`${up}about.html`} aria-current={current === "about" ? "page" : undefined}>
            About
          </a>
          <a href={`${up}privacy.html`} aria-current={current === "privacy" ? "page" : undefined}>
            Privacy
          </a>
        </nav>
      </div>
      {showSlogan ? <SloganTag className="site-slogan">{showSlogan}</SloganTag> : null}
      {current === "home" && !slogan ? (
        <p className="site-sub">
          One person opens every provider&rsquo;s own page before an offer goes on this list.
          Offers that expire come off it without anyone asking.
        </p>
      ) : null}
    </div>
  )
}
