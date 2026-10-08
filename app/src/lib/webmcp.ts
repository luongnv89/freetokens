// WebMCP registration (issue #535) — exposes the site's real actions to
// in-browser AI agents per the implementation guide
// (https://isitagentready.com/.well-known/agent-skills/webmcp/SKILL.md) and
// the draft spec (https://webmachinelearning.github.io/webmcp/).
//
// The API is a Draft Community Group Report: shipping browsers expose
// `document.modelContext`, older Chrome builds expose `navigator.modelContext`
// — the guide requires feature-detecting the former and falling back to the
// latter. Every tool maps to a capability the site genuinely has: searching
// and filtering the live offer list (the same offerMatches/applySort the UI
// uses), reading an offer record, and navigating to an offer's detail page.
// Nothing here touches `document`/`navigator` at module scope, so importing
// this file is safe under SSR/prerender (node) and registration is a silent
// no-op wherever the API is absent.

import {
  activeOffers,
  applySort,
  offerMatches,
  type Offer,
  type OffersIndex,
} from "./offers";
import { currentBaseUrl, offerAbsoluteUrl } from "./site";
import { parseState, serializeState, type UrlState } from "./urlState";

// Minimal mirrors of the draft IDL — the API is not in lib.dom yet, and a
// draft may still shift, so keep the shapes local instead of augmenting the
// global Document/Navigator interfaces.
type ToolExecuteCallback = (
  input: Record<string, unknown>,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  execute: ToolExecuteCallback;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
    consequentialHint?: boolean;
    debugging?: boolean;
  };
}

interface ModelContext {
  registerTool(
    tool: ModelContextTool,
    options?: { signal?: AbortSignal },
  ): Promise<undefined>;
}

type ModelContextCarrier = { modelContext?: ModelContext };

/**
 * `document.modelContext` per the current draft; `navigator.modelContext` is
 * the older-Chrome fallback the implementation guide names. Undefined on
 * unsupported browsers and under prerender — the caller treats that as "no
 * tools today".
 */
function resolveModelContext(): ModelContext | undefined {
  if (typeof document !== "undefined") {
    const mc = (document as ModelContextCarrier).modelContext;
    if (mc && typeof mc.registerTool === "function") return mc;
  }
  if (typeof navigator !== "undefined") {
    const mc = (navigator as ModelContextCarrier).modelContext;
    if (mc && typeof mc.registerTool === "function") return mc;
  }
  return undefined;
}

function asNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The tool's filter surface is exactly the URL-state contract: values the
 * search UI cannot represent (e.g. an unknown category) are dropped by the
 * same parseState whitelist the location bar goes through, and the caller
 * sees what was actually applied in the `applied_state` echo.
 */
function stateFromInput(input: Record<string, unknown>): UrlState {
  const params = new URLSearchParams();
  // The UI names the box `q`; agents get the friendlier `query` alias.
  const query = asNonEmptyString(input.query) || asNonEmptyString(input.q);
  if (query) params.set("q", query.slice(0, 200)); // ft-search maxLength
  for (const key of ["category", "verification", "signup", "sort"] as const) {
    const value = asNonEmptyString(input[key]);
    if (value) params.set(key, value);
  }
  const state = parseState(`?${params.toString()}`);
  // The toolbar's commit() stores q lowercased; keep the same normalization
  // so the pushed URL and the echoed applied_state match the live UI.
  state.q = state.q.toLowerCase();
  return state;
}

function offerSummary(offer: Offer) {
  return {
    slug: offer.slug,
    title: offer.title,
    provider: offer.provider,
    category: offer.category,
    amount: offer.amount,
    expiry_date: offer.expiry_date,
    verification: offer.verification,
    signup: offer.signup,
    url: offerAbsoluteUrl(offer.slug),
  };
}

function offerRecord(offer: Offer) {
  return {
    ...offerSummary(offer),
    review_status: offer.review_status,
    status: offer.status,
    source_url: offer.source_url,
    verified_date: offer.verified_date,
    markdown_url: offerAbsoluteUrl(offer.slug).replace(/\.html$/, ".md"),
  };
}

/**
 * Mirror the tool's state into the live page when the hydrated home listing
 * is present: push the serialized filters into the location (the same shape
 * the toolbar's commit() writes) and fire popstate so HomePage's listener
 * re-reads it. On any other page the listing cannot display the result, so
 * the URL is left untouched and the agent gets data plus a shareable link.
 */
function applyStateToPage(state: UrlState): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  if (!document.getElementById("ft-search")) return false;
  try {
    const query = serializeState(state);
    window.history.pushState(
      {},
      "",
      query ? `?${query}` : window.location.pathname,
    );
    // HomePage applies URL state on popstate; pushState alone does not fire
    // it, so dispatch the event the listener is waiting on.
    window.dispatchEvent(new Event("popstate"));
    return true;
  } catch {
    return false;
  }
}

type Navigate = (url: string) => void;

function defaultNavigate(url: string) {
  window.location.assign(url);
}

function buildTools(index: OffersIndex, navigate: Navigate): ModelContextTool[] {
  const stateInput = (description: string) => ({
    type: "object",
    description,
    properties: {
      query: {
        type: "string",
        description:
          "Free-text search over offer title, provider, and amount (matches the site search box).",
        maxLength: 200,
      },
      category: {
        type: "string",
        description: "Filter by offer category.",
        enum: [
          "api_provider",
          "coding",
          "image",
          "voice",
          "video",
          "startup_program",
          "student",
          "oss_program",
        ],
      },
      verification: {
        type: "string",
        description: "Filter by how the listing was checked.",
        enum: ["social_proof", "unverified"],
      },
      signup: {
        type: "string",
        description: "Filter by whether claiming needs an account.",
        enum: ["none", "required"],
      },
      sort: {
        type: "string",
        description:
          "Result order: 'newest' = recently checked first, 'expiring' = soonest expiry first.",
        enum: ["newest", "expiring"],
      },
    },
    additionalProperties: false,
  });

  const slugInput = {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description: "The offer slug, e.g. 'tavily-free-tier'.",
      },
    },
    required: ["slug"],
    additionalProperties: false,
  };

  return [
    {
      name: "search_offers",
      title: "Search offers",
      description:
        "Search and filter this site's directory of free AI credit offers. Returns the matching live offers; on the home page the on-page listing is updated to the same filters.",
      inputSchema: stateInput(
        "Optional filters; omitting everything lists all live offers.",
      ),
      annotations: { untrustedContentHint: true },
      execute: async (input) => {
        const state = stateFromInput(input ?? {});
        const matched = applySort(activeOffers(index), state.sort).filter(
          (offer) => offerMatches(offer, state),
        );
        const serialized = serializeState(state);
        return {
          total: matched.length,
          offers: matched.map(offerSummary),
          applied_state: serialized
            ? Object.fromEntries(new URLSearchParams(serialized))
            : {},
          results_url: `${currentBaseUrl()}/${serialized ? `?${serialized}` : ""}`,
          page_updated: applyStateToPage(state),
        };
      },
    },
    {
      name: "get_offer",
      title: "Get offer details",
      description:
        "Read a single offer's full record — provider, amount, category, expiry, trust labels, claim source URL, and detail/Markdown page URLs — by its slug.",
      inputSchema: slugInput,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        const slug = asNonEmptyString(input?.slug);
        const offer = index.offers.find((o) => o.slug === slug);
        if (!offer) {
          return { found: false, slug, error: "No offer with that slug." };
        }
        return { found: true, offer: offerRecord(offer) };
      },
    },
    {
      name: "view_offer",
      title: "Open offer page",
      description:
        "Navigate the browser to an offer's detail page by slug. Use search_offers first to discover slugs.",
      inputSchema: slugInput,
      annotations: { consequentialHint: true },
      execute: async (input) => {
        const slug = asNonEmptyString(input?.slug);
        const offer = index.offers.find((o) => o.slug === slug);
        if (!offer) {
          return { found: false, navigated: false, slug };
        }
        const url = offerAbsoluteUrl(offer.slug);
        try {
          navigate(url);
          return { found: true, navigated: true, url };
        } catch {
          // Navigation blocked (sandboxed frame, test env) — still report
          // the URL so the agent can follow the link itself.
          return { found: true, navigated: false, url };
        }
      },
    },
  ];
}

/**
 * Register the site's tools with the browser's WebMCP model context. Returns
 * the AbortController whose signal unregisters every tool, or undefined when
 * the API is absent (unsupported browser, non-secure context, prerender).
 * Registration failures — draft shape drift, validation rejection — are
 * swallowed: agents losing tools must never break the page for humans.
 */
export function registerWebMcpTools(
  index: OffersIndex,
  navigate: Navigate = defaultNavigate,
): AbortController | undefined {
  const modelContext = resolveModelContext();
  if (!modelContext) return undefined;
  const controller = new AbortController();
  for (const tool of buildTools(index, navigate)) {
    try {
      const registered = modelContext.registerTool(tool, {
        signal: controller.signal,
      });
      if (registered && typeof registered.catch === "function") {
        registered.catch(() => {});
      }
    } catch {
      /* unsupported draft shape — stay silent */
    }
  }
  return controller;
}
