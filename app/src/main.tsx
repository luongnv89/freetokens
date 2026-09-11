import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import type { OffersIndex } from "./lib/offers.ts";
import type { DetailsMap } from "./lib/offerDetails.ts";
import { resolveRoute } from "./routes.ts";
import { scheduleAnalyticsInit } from "./lib/analytics.ts";

// Keep the catalog out of the executable bundle: it changes with every offer
// while the application code does not. Resolve against this module URL so
// nested routes like /offers/<slug>.html do not request ./assets/ from
// inside /offers/. The prerendered page stays visible if the fetch fails;
// only client-side interaction stays inactive.
async function boot() {
  try {
    const catalogUrl = new URL("./data/offers.json", import.meta.url).href;
    const response = await fetch(catalogUrl, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`catalog request failed: ${response.status}`);
    }
    const index = (await response.json()) as OffersIndex;
    const root = document.getElementById("root")!;
    const route = resolveRoute();
    // The aggregate details map (~129 KB gzip) ships only with detail routes
    // via a route-guarded dynamic import, so home/archive never request it
    // (#369). On failure skip hydration entirely: hydrating without details
    // would mismatch the prerendered document, while the prerendered page
    // itself stays fully readable.
    let details: DetailsMap | undefined;
    if (route.page === "detail") {
      try {
        details = (await import("./data/details.json"))
          .default as DetailsMap;
      } catch (error) {
        console.error(
          "Unable to load offer details; prerendered content remains available.",
          error,
        );
        return;
      }
    }
    // The prerenderer stamps the production base URL on #root; reading it
    // keeps StructuredData's JSON-LD byte-identical across prerender and
    // hydration instead of recomputing it from window.location — the root
    // cause of React hydration error #418 and the TBT bloat it caused (#369).
    hydrateRoot(
      root,
      <StrictMode>
        <App
          index={index}
          details={details}
          baseUrl={root.dataset.baseUrl}
        />
      </StrictMode>,
    );
  } catch (error) {
    console.error(
      "Unable to hydrate FreeTokens; prerendered content remains available.",
      error,
    );
  }
  // Traffic strip + consent banner mutate live DOM. Queue after hydrate so
  // React does not replace already-filled #ft-traffic nodes (#361).
  queueMicrotask(() => {
    scheduleAnalyticsInit();
  });
}

void boot();
