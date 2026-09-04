import { BrandMark } from "./BrandMark";
import { TrafficStrip } from "./TrafficStrip";

/**
 * Shared header chrome for every page (#112): the same brand bar and
 * primary nav render on every route, so navigating between pages shows
 * no jump in layout or branding. `depth` mirrors SiteFooter (0 for root
 * pages, 1 for offers/<slug>.html) and prefixes every href; `current`
 * drives the active nav state.
 *
 * The bar carries brand, nav and the live traffic strip, and nothing else.
 * The editorial slogan and its sub-paragraph are gone: the masthead proof
 * line below already states what the list is and how it is maintained, in
 * numbers that are derived rather than asserted.
 *
 * The wordmark is the home page's `h1`. That is not cosmetic — dropping the
 * slogan removed the only `h1` home had, and every other route carries its
 * own page heading, so the wordmark is promoted on home and stays a span
 * everywhere else rather than competing with those headings.
 *
 * TrafficStrip mounts here and ONLY here. Its element ids are looked up with
 * getElementById, so a second mount elsewhere on the page would never be
 * populated. `pageViews` is false where the page already shows its own view
 * count — offer detail pages — so the number is not printed twice.
 */
export function SiteHeader({
  depth = 0,
  current,
  pageViews = true,
}: {
  depth?: number;
  current?: "home" | "archive" | "privacy" | "about";
  pageViews?: boolean;
}) {
  const up = "../".repeat(depth);
  const homeHref = `${up || "./"}index.html`;
  const Wordmark = current === "home" ? "h1" : "span";
  return (
    <div className="site-header">
      <div className="site-bar">
        <a
          className="site-brand"
          href={homeHref}
          aria-label="Free AI Credits — home"
        >
          <BrandMark depth={depth} size={28} alt="" priority />
          <Wordmark className="site-wordmark">Free AI Credits</Wordmark>
        </a>
        <nav className="site-nav" aria-label="Primary">
          <a
            href={homeHref}
            aria-current={current === "home" ? "page" : undefined}
          >
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
          <a
            href={`${up}about.html`}
            aria-current={current === "about" ? "page" : undefined}
          >
            About
          </a>
          <a
            href={`${up}privacy.html`}
            aria-current={current === "privacy" ? "page" : undefined}
          >
            Privacy
          </a>
        </nav>
      </div>
      <TrafficStrip pageViews={pageViews} />
    </div>
  );
}
