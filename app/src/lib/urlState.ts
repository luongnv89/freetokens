// Parity with scripts/build.py ftParseState / ftSerializeState.
// Whitelist-only: unknown params are dropped, matching the analytics
// privacy stance of never persisting arbitrary query strings.

// `amount` was removed (#508): the catalog carries dollars, tokens, credits,
// characters, minutes and requests in one free-text field, so any single
// numeric magnitude fabricated a cross-unit value equivalence that does not
// exist. Only orderings backed by a real, comparable value are offered. A
// legacy `?sort=amount` URL (or a stored `ft-prefs` value) degrades to the
// default order via normalizeSort.
export const SORT_MODES = ["newest", "expiring"] as const;
export const DIMENSIONS = ["category", "verification", "signup"] as const;

export type SortMode = (typeof SORT_MODES)[number];
export type FilterDimension = (typeof DIMENSIONS)[number];

export type UrlState = {
  q: string;
  sort: string;
  category: string;
  verification: string;
  signup: string;
  page: number;
};

const VALID: Record<FilterDimension, readonly string[]> = {
  category: [
    "api_provider",
    "coding",
    "image",
    "voice",
    "video",
    "startup_program",
    "oss_program",
  ],
  verification: ["social_proof", "unverified"],
  signup: ["none", "required"],
};

export function emptyState(): UrlState {
  return {
    q: "",
    sort: "",
    category: "",
    verification: "",
    signup: "",
    page: 1,
  };
}

export function normalizeSort(value: string): string {
  return (SORT_MODES as readonly string[]).includes(value) ? value : "";
}

/** True when a query or any filter dimension is active (sort is not a filter). */
export function hasQueryOrFilters(state: UrlState): boolean {
  return !!(state.q || state.category || state.verification || state.signup);
}

export function parseState(search: string): UrlState {
  const params = new URLSearchParams(search || "");
  const state = emptyState();
  state.q = (params.get("q") || "").trim();
  state.sort = normalizeSort(params.get("sort") || "");
  for (const dim of DIMENSIONS) {
    const value = params.get(dim) || "";
    state[dim] = VALID[dim].includes(value) ? value : "";
  }
  // 1-based page (#548): only a bare positive integer counts — "0", "-1",
  // "2.5" and zero-padded "01" all fall back to the first page. There is no
  // upper clamp here; the listing clamps against its own result count.
  const rawPage = params.get("page") || "";
  state.page =
    /^[1-9]\d*$/.test(rawPage) && Number.isSafeInteger(Number(rawPage))
      ? Number(rawPage)
      : 1;
  return state;
}

export function serializeState(state: UrlState): string {
  const params = new URLSearchParams();
  for (const dim of DIMENSIONS) {
    if (state[dim]) params.set(dim, state[dim]);
  }
  if (state.q) params.set("q", state.q);
  if (state.sort) params.set("sort", state.sort);
  if (state.page > 1) params.set("page", String(state.page));
  return params.toString();
}
