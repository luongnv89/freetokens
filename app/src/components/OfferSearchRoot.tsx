import type { StateOf } from "@ui-sdk/core";
import {
  usePart,
  usePrimitive,
  type PartProps,
} from "@ui-sdk/react/primitive";
import type { OffersIndex } from "../lib/offers";
import { offerSearch, type OfferFilters } from "../lib/offerSearchPrimitive";

export function OfferSearchRoot({
  index,
  value,
  ...props
}: { index: OffersIndex; value: OfferFilters } & PartProps<
  "section",
  StateOf<typeof offerSearch, "root">
>) {
  const handle = usePrimitive(offerSearch, { index, value });
  return usePart(handle, "root", {}, props, "section");
}
