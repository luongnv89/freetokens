// Fallback absolute origin used at build/prerender time (no `window`),
// e.g. for canonical tags and prerendered share markup. In the browser,
// share URLs must instead come from the live location so they always
// match the URL displayed in the address bar (#108).
export const DEFAULT_BASE_URL = "https://freetokens.custats.info";

/**
 * Base URL of the site as seen by the current visitor: derived from
 * `window.location` (origin + deploy subpath) when available, falling
 * back to DEFAULT_BASE_URL during SSR/prerender. Never use this for
 * in-page hrefs — those stay relative so they resolve under the GitHub
 * Pages /<repo>/ subpath (#60).
 */
export function currentBaseUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BASE_URL;
  const { origin, pathname } = window.location;
  const offersIdx = pathname.indexOf("/offers/");
  const basePath =
    offersIdx >= 0
      ? pathname.slice(0, offersIdx)
      : pathname.replace(/[^/]*$/, "");
  return `${origin}${basePath.replace(/\/+$/, "")}`;
}

/** Absolute offer URL used for canonical tags and copy-to-clipboard. */
export function offerAbsoluteUrl(
  slug: string,
  baseUrl = currentBaseUrl(),
): string {
  return `${baseUrl.replace(/\/+$/, "")}/offers/${slug}.html`;
}
