// Parity with scripts/build.py ftParseState / ftSerializeState.
// Whitelist-only: unknown params are dropped, matching the analytics
// privacy stance of never persisting arbitrary query strings.

// `amount` was removed (#508): the catalog carries dollars, tokens, credits,
// characters, minutes and requests in one free-text field, so any single
// numeric magnitude fabricated a cross-unit value equivalence that does not
// exist. Only orderings backed by a real, comparable value are offered. A
// legacy `?sort=amount` URL (or a stored `ft-prefs` value) degrades to the
// default order via normalizeSort.
//
// The empty value is the default "Recently checked" order (newest
// verified_date first); `recommended` is the scored ranking
// (src/lib/ranking.ts); `added` is newest-added first, the build's index
// order. The old `?sort=newest` named today's default, so it normalizes to
// the empty value and keeps one canonical URL per view.
export const SORT_MODES = ["recommended", "added", "expiring"] as const;
export const DIMENSIONS = ["category", "verification", "signup"] as const;

// Community listings (#748) — promo codes and giveaways people shared, not
// verified by freetokens — are shown by default. `?community=hide` drops them,
// `?community=only` lists nothing else. Not a tag dimension: every row is
// either community or not, so the control is a show/hide switch.
export const COMMUNITY_VIEWS = ["hide", "only"] as const;

export type SortMode = (typeof SORT_MODES)[number];
export type CommunityView = (typeof COMMUNITY_VIEWS)[number];
export type FilterDimension = (typeof DIMENSIONS)[number];

export type UrlState = {
  q: string;
  sort: string;
  category: string;
  verification: string;
  signup: string;
  community: string;
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
    community: "",
    page: 1,
  };
}

export function normalizeSort(value: string): string {
  return (SORT_MODES as readonly string[]).includes(value) ? value : "";
}

/** True when a query or any filter dimension is active (sort is not a filter). */
export function hasQueryOrFilters(state: UrlState): boolean {
  return !!(
    state.q ||
    state.category ||
    state.verification ||
    state.signup ||
    state.community
  );
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
  const community = params.get("community") || "";
  state.community = (COMMUNITY_VIEWS as readonly string[]).includes(community)
    ? community
    : "";
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
  if (state.community) params.set("community", state.community);
  if (state.q) params.set("q", state.q);
  if (state.sort) params.set("sort", state.sort);
  if (state.page > 1) params.set("page", String(state.page));
  return params.toString();
}
