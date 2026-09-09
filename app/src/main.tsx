import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import type { OffersIndex } from "./lib/offers.ts";
import offersUrl from "./data/offers.json?url";
import { scheduleAnalyticsInit } from "./lib/analytics.ts";

// Keep the catalog out of the executable bundle: it changes with every offer
// while the application code does not. The prerendered page stays fully visible
// if this same-origin request fails; only client-side interaction stays inactive.
async function hydrate() {
  try {
    const response = await fetch(offersUrl, { credentials: "same-origin" });
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
    console.error("Unable to hydrate FreeTokens; prerendered content remains available.", error);
  }
}

void hydrate();

// Consent banner + trackers stay off the critical path. prerender/entry.tsx
// never imports this file, so loaders cannot run at prerender time.
scheduleAnalyticsInit();
