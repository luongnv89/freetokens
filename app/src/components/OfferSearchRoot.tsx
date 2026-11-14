import { useMemo } from "react";
import type { StateOf } from "@ui-sdk/core";
import {
  usePart,
  usePrimitive,
  type PartProps,
} from "@ui-sdk/react/primitive";
import type { OffersIndex } from "../lib/offers";
import { filtersFromState, offerSearch } from "../lib/offerSearchPrimitive";
import type { UrlState } from "../lib/urlState";

export function OfferSearchRoot({
  index,
  state,
  ...props
}: { index: OffersIndex; state: UrlState } & PartProps<
  "section",
  StateOf<typeof offerSearch, "root">
>) {
  const value = useMemo(() => filtersFromState(state), [state]);
  const handle = usePrimitive(offerSearch, { index, value });
  return usePart(handle, "root", {}, props, "section");
}
