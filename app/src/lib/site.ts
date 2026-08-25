// Mirrors scripts/build.py DEFAULT_BASE_URL: the absolute origin used
// wherever a URL must be absolute regardless of deploy base (RSS links,
// share URLs). Never use this for in-page hrefs — those stay relative so
// they resolve under the GitHub Pages /<repo>/ subpath (#60).
export const DEFAULT_BASE_URL = "https://luongnv89.github.io/freetokens"

/** Absolute offer URL used for canonical tags and copy-to-clipboard. */
export function offerAbsoluteUrl(slug: string, baseUrl = DEFAULT_BASE_URL): string {
  return `${baseUrl.replace(/\/+$/, "")}/offers/${slug}.html`
}
