import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import type { OffersIndex } from "./lib/offers.ts";
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
    hydrateRoot(
      document.getElementById("root")!,
      <StrictMode>
        <App index={index} />
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
