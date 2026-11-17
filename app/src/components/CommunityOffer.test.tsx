// Community offers (#748): badge, shared-by line, promo-code copy, giveaway
// line + "Reply on X", the show/hide filter, and the detail page panel.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import HomePage from "./HomePage";
import OfferDetailPage from "./OfferDetailPage";
import { OfferRow } from "./OfferRow";
import {
  COMMUNITY_BADGE_LABEL,
  giveawayLine,
  isCommunity,
  isXPost,
  offerMatches,
  type Offer,
  type OffersIndex,
} from "../lib/offers";
import { emptyState, parseState, serializeState } from "../lib/urlState";

const POST = "https://x.com/ben_ai_eng/status/2122616807404052781";

const REGULAR: Offer = {
  slug: "regular-offer",
  title: "Regular Offer",
  provider: "Example Co",
  category: "coding",
  amount: "$10 credits",
  expiry_date: null,
  source_url: "https://example.com/offer",
  verified_date: "2026-11-01",
  verification: "social_proof",
  review_status: "under-review",
  signup: "required",
  status: "active",
};

const GIVEAWAY: Offer = {
  slug: "devin-max-one-month-code-giveaway",
  title: "Devin Max giveaway — 10 codes for one month each",
  provider: "Devin (Cognition)",
  category: "coding",
  amount: "one month of Devin Max per code ($200 value each)",
  expiry_date: "2026-11-20",
  source_url: POST,
  verified_date: "2026-11-17",
  verification: "unverified",
  review_status: "unverified",
  signup: "required",
  status: "active",
  listing_type: "community",
  community: {
    subtype: "giveaway",
    added_by: "luong",
    shared_by: {
      handle: "ben_ai_eng",
      name: "Ben Newell",
      post_url: POST,
      post_date: "2026-11-17",
    },
    codes_available: 10,
    entries_close: "2026-11-20",
    timezone_note: "no time zone given",
  },
};

const PROMO: Offer = {
  ...GIVEAWAY,
  slug: "acme-promo",
  title: "Acme promo code",
  provider: "Acme",
  expiry_date: null,
  source_url: "https://www.reddit.com/r/x/comments/1/acme",
  community: {
    subtype: "promo_code",
    added_by: "luong",
    shared_by: {
      handle: "someone",
      post_url: "https://www.reddit.com/r/x/comments/1/acme",
      post_date: "2026-11-16",
    },
    promo_code: "ACME-10",
  },
};

function index(offers: Offer[]): OffersIndex {
  return {
    generated_at: "2026-11-17T12:00:00Z",
    count: offers.length,
    active_count: offers.length,
    expired_count: 0,
    offers,
  };
}

function row(offer: Offer) {
  return render(
    <ol>
      <OfferRow
        offer={offer}
        index={0}
        buildDay="2026-11-17"
        pressed={{ category: "", verification: "", signup: "" }}
        onToggleTag={() => {}}
      />
    </ol>,
  );
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("community helpers", () => {
  it("recognises community entries and X posts", () => {
    expect(isCommunity(GIVEAWAY)).toBe(true);
    expect(isCommunity(REGULAR)).toBe(false);
    expect(isXPost(POST)).toBe(true);
    expect(isXPost("https://twitter.com/a/status/1")).toBe(true);
    expect(isXPost(PROMO.source_url)).toBe(false);
  });

  it("formats the giveaway line from what the post states", () => {
    expect(giveawayLine(GIVEAWAY.community!)).toBe(
      "10 codes · entries close Nov 20, 2026",
    );
    expect(
      giveawayLine({ ...GIVEAWAY.community!, codes_available: undefined }),
    ).toBe("entries close Nov 20, 2026");
  });

  it("filters: shown by default, hidden with hide, alone with only", () => {
    const state = emptyState();
    expect(offerMatches(GIVEAWAY, state)).toBe(true);
    expect(offerMatches(GIVEAWAY, { ...state, community: "hide" })).toBe(false);
    expect(offerMatches(REGULAR, { ...state, community: "hide" })).toBe(true);
    expect(offerMatches(GIVEAWAY, { ...state, community: "only" })).toBe(true);
    expect(offerMatches(REGULAR, { ...state, community: "only" })).toBe(false);
  });

  it("round-trips ?community= and drops unknown values", () => {
    expect(parseState("?community=hide").community).toBe("hide");
    expect(parseState("?community=only").community).toBe("only");
    expect(parseState("?community=bogus").community).toBe("");
    expect(serializeState({ ...emptyState(), community: "only" })).toBe(
      "community=only",
    );
  });
});

describe("community listing row", () => {
  it("renders the badge, shared-by link, giveaway line and Reply on X", () => {
    row(GIVEAWAY);
    expect(screen.getByText(COMMUNITY_BADGE_LABEL)).toBeInTheDocument();
    expect(COMMUNITY_BADGE_LABEL).toBe("Community · not verified by freetokens");
    const by = screen.getByRole("link", { name: "@ben_ai_eng" });
    expect(by).toHaveAttribute("href", POST);
    expect(screen.getByText(/Ben Newell/)).toBeInTheDocument();
    expect(
      screen.getByText("10 codes · entries close Nov 20, 2026", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText("(no time zone given)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Reply on X/ })).toHaveAttribute(
      "href",
      POST,
    );
    // Never re-checked, so the rail says "added", not "checked".
    expect(screen.getByText(/^added/)).toBeInTheDocument();
    // The review-status badge is replaced, not shown beside the community one.
    expect(document.querySelector(".badge-review-status")).toBeNull();
    expect(document.querySelector("article")).toHaveAttribute(
      "data-listing-type",
      "community",
    );
  });

  it("shows a promo code with a working copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    row(PROMO);
    expect(screen.getByText("ACME-10").tagName).toBe("CODE");
    expect(screen.queryByRole("link", { name: /Reply on X/ })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Copy code ACME-10 for Acme promo code" }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ACME-10"));
    expect(await screen.findByText("Code copied")).toBeInTheDocument();
  });

  it("regular rows are unchanged", () => {
    row(REGULAR);
    expect(screen.queryByText(COMMUNITY_BADGE_LABEL)).toBeNull();
    expect(document.querySelector(".r-community")).toBeNull();
    expect(screen.getByText(/^checked/)).toBeInTheDocument();
  });
});

describe("home page community filter", () => {
  it("offers show/hide chips and applies ?community=hide", async () => {
    window.history.replaceState({}, "", "/?community=hide");
    render(<HomePage index={index([REGULAR, GIVEAWAY])} />);
    await waitFor(() =>
      expect(screen.queryByText(GIVEAWAY.title)).toBeNull(),
    );
    expect(screen.getByText(REGULAR.title)).toBeInTheDocument();
    const hide = screen.getByRole("button", { name: "Hide community" });
    expect(hide).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(hide);
    expect(await screen.findByText(GIVEAWAY.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Community only" }));
    await waitFor(() => expect(screen.queryByText(REGULAR.title)).toBeNull());
    expect(window.location.search).toBe("?community=only");
  });
});

describe("offer detail page for a community entry", () => {
  it("renders the community panel, claim steps and post CTA", () => {
    const html = renderToStaticMarkup(
      <OfferDetailPage
        index={index([GIVEAWAY])}
        slug={GIVEAWAY.slug}
        details={{
          [GIVEAWAY.slug]: {
            claim_steps: [
              "Open the post by @ben_ai_eng on X.",
              "Reply with what you're building.",
            ],
          },
        }}
      />,
    );
    expect(html).toContain("Community giveaway");
    expect(html).toContain(COMMUNITY_BADGE_LABEL);
    expect(html).toContain("10 codes · entries close Nov 20, 2026");
    expect(html).toContain("(no time zone given)");
    expect(html).toContain("Reply on X");
    expect(html).toContain("Open @ben_ai_eng&#x27;s post on X");
    expect(html).toContain("Reply with what you&#x27;re building.");
    expect(html).toContain("Not verified by freetokens.");
    expect(html).not.toContain("Claim at Devin");
  });
});
