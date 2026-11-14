// ui-sdk trial (#726): the home toolbar as a ui-sdk primitive, so ui-sdk's
// WebMCP bridge (snapshot/query/act) can see it and call `search`. The
// action runs the same runOfferSearch as the #535 `search_offers` tool.
import { definePrimitive } from "@ui-sdk/core";
import type { OffersIndex } from "./offers";
import type { UrlState } from "./urlState";
import { runOfferSearch, type OfferSearchInput } from "./webmcp";

export type OfferFilters = {
  query: string;
  category: string;
  verification: string;
  signup: string;
  sort: string;
};

export function filtersFromState(state: UrlState): OfferFilters {
  return {
    query: state.q,
    category: state.category,
    verification: state.verification,
    signup: state.signup,
    sort: state.sort,
  };
}

type OfferSearchOptions = { index?: OffersIndex; value?: OfferFilters };

const EMPTY: OfferFilters = {
  query: "",
  category: "",
  verification: "",
  signup: "",
  sort: "",
};

export const offerSearch = definePrimitive({
  name: "offer-search",
  options: { index: "value", value: "value" },
  state: (options: OfferSearchOptions) => ({ value: options.value ?? EMPTY }),
  sync: (options) => (options.value === undefined ? {} : { value: options.value }),
  api: (context) => ({
    search(input?: OfferSearchInput) {
      const { index } = context.options();
      if (!index) return { total: 0, offers: [], page_updated: false };
      return runOfferSearch(index, input && typeof input === "object" ? input : {});
    },
  }),
  slots: (slot) => ({
    root: slot({}),
  }),
  agent: { actions: ["search"] },
});
