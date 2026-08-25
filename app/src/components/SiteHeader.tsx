import { BrandMark } from "./BrandMark"

/**
 * Shared header chrome for every page (#112): the same brand bar and
 * primary nav render on every route, so navigating between pages shows
 * no jump in layout or branding. `depth` mirrors SiteFooter (0 for root
 * pages, 1 for offers/<slug>.html) and prefixes every href; `current`
 * drives the active nav state. The home route owns the document <h1>;
 * every other route renders its own page heading below this bar.
 */
export function SiteHeader({
  depth = 0,
  current,
}: {
  depth?: number
  current?: "home" | "archive" | "privacy"
}) {
  const up = "../".repeat(depth)
  const homeHref = `${up || "./"}index.html`
  return (
    <div className="site-bar">
      <a className="site-brand" href={homeHref}>
        <BrandMark depth={depth} size={32} alt="" />
        {current === "home" ? (
          <h1>Free AI Credits</h1>
        ) : (
          <p className="site-wordmark">Free AI Credits</p>
        )}
      </a>
      <nav className="site-nav" aria-label="Primary">
        <a href={homeHref} aria-current={current === "home" ? "page" : undefined}>
          Offers
        </a>
        <span aria-hidden="true">&middot;</span>
        <a href={`${up}archive.html`} aria-current={current === "archive" ? "page" : undefined}>
          Archive
        </a>
        <span aria-hidden="true">&middot;</span>
        <a href={`${up}privacy.html`} aria-current={current === "privacy" ? "page" : undefined}>
          Privacy
        </a>
      </nav>
    </div>
  )
}
