// Parity with scripts/build.py ftParseState / ftSerializeState.
// Whitelist-only: unknown params are dropped, matching the analytics
// privacy stance of never persisting arbitrary query strings.

export const SORT_MODES = ["newest", "expiring", "amount"] as const
export const DIMENSIONS = ["category", "verification", "signup"] as const

export type SortMode = (typeof SORT_MODES)[number]
export type FilterDimension = (typeof DIMENSIONS)[number]

export type UrlState = {
  q: string
  sort: string
  category: string
  verification: string
  signup: string
}

const VALID: Record<FilterDimension, readonly string[]> = {
  category: ["api_provider", "coding", "image", "voice", "video"],
  verification: ["hand_verified", "social_proof", "unverified"],
  signup: ["none", "required"],
}

export function emptyState(): UrlState {
  return { q: "", sort: "", category: "", verification: "", signup: "" }
}

export function normalizeSort(value: string): string {
  return (SORT_MODES as readonly string[]).includes(value) ? value : ""
}

/** True when a query or any filter dimension is active (sort is not a filter). */
export function hasQueryOrFilters(state: UrlState): boolean {
  return !!(state.q || state.category || state.verification || state.signup)
}

export function parseState(search: string): UrlState {
  const params = new URLSearchParams(search || "")
  const state = emptyState()
  state.q = (params.get("q") || "").trim()
  state.sort = normalizeSort(params.get("sort") || "")
  for (const dim of DIMENSIONS) {
    const value = params.get(dim) || ""
    state[dim] = VALID[dim].includes(value) ? value : ""
  }
  return state
}

export function serializeState(state: UrlState): string {
  const params = new URLSearchParams()
  for (const dim of DIMENSIONS) {
    if (state[dim]) params.set(dim, state[dim])
  }
  if (state.q) params.set("q", state.q)
  if (state.sort) params.set("sort", state.sort)
  return params.toString()
}
