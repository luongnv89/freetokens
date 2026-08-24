// One route per static document the site serves (issue #123). Kept out of
// App.tsx so the component file stays fast-refresh clean.

/** One route per static document the site serves (issue #123). */
export type Route =
  | { page: "home" }
  | { page: "archive" }
  | { page: "privacy" }
  | { page: "detail"; slug: string }

/**
 * Client-side route resolution: the prerenderer stamps data-page / data-slug
 * onto the #root mount of every generated document, so the same bundle
 * hydrates whichever page it ships with. Defaults to home (jsdom tests,
 * missing attribute) — an unknown slug resolves INSIDE OfferDetailPage as a
 * graceful not-found state, never a blank hydration error.
 */
export function resolveRoute(
  doc?: Document,
): Route {
  const root = doc?.getElementById("root")
  switch (root?.dataset.page) {
    case "archive":
      return { page: "archive" }
    case "privacy":
      return { page: "privacy" }
    case "detail":
      return { page: "detail", slug: root?.dataset.slug ?? "" }
    default:
      return { page: "home" }
  }
}
