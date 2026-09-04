import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import {
  acceptConsent,
  isTrackingConfigured,
  rejectConsent,
  subscribeConsentBanner,
} from "../lib/analytics";

/**
 * Non-modal consent region (build.py #ft-consent-banner). shadcn Button
 * default/secondary for Allow/Decline — there is no Dialog. Hidden until
 * initAnalytics decides the visitor has no stored ft_ga_consent.
 */
export function ConsentBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const unsub = subscribeConsentBanner(setOpen);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const banner = document.getElementById("ft-consent-banner");
      if (banner && !banner.hidden) rejectConsent();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      unsub();
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!isTrackingConfigured()) return null;

  return (
    <div
      id="ft-consent-banner"
      className="consent"
      role="region"
      aria-label="Analytics consent"
      hidden={!open}
    >
      <p className="consent-text">
        This site counts visits and offer clicks to see which offers help
        people. Counting uses Google Analytics 4 with IP anonymization (which
        may set cookies) and, when enabled, a cookie-free GoatCounter page
        counter. Nothing runs until you allow it. You can change your mind
        anytime via &ldquo;Cookie settings&rdquo; in the footer.
      </p>
      <div className="consent-actions">
        <Button
          type="button"
          id="ft-consent-accept"
          variant="default"
          onClick={() => acceptConsent()}
        >
          Allow
        </Button>
        <Button
          type="button"
          id="ft-consent-decline"
          variant="secondary"
          onClick={() => rejectConsent()}
        >
          Decline
        </Button>
      </div>
    </div>
  );
}
