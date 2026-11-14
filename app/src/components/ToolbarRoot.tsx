import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import type { OffersIndex } from "../lib/offers";
import type { UrlState } from "../lib/urlState";
import { hasModelContext } from "../lib/webmcp";

// ui-sdk trial (#726): the ui-sdk runtime is fetched only where WebMCP
// exists, and the swap waits for an effect so hydration sees the prerender.
const OfferSearchRoot = lazy(() =>
  import("./OfferSearchRoot").then((m) => ({ default: m.OfferSearchRoot })),
);

const LABEL = "Search and filter offers";

export function ToolbarRoot({
  index,
  state,
  children,
}: {
  index: OffersIndex;
  state: UrlState;
  children: ReactNode;
}) {
  const [agentReady, setAgentReady] = useState(false);
  useEffect(() => {
    if (hasModelContext()) setAgentReady(true);
  }, []);

  const plain = (
    <section className="toolbar" aria-label={LABEL}>
      {children}
    </section>
  );
  if (!agentReady) return plain;
  return (
    <Suspense fallback={plain}>
      <OfferSearchRoot
        index={index}
        state={state}
        className="toolbar"
        aria-label={LABEL}
      >
        {children}
      </OfferSearchRoot>
    </Suspense>
  );
}
