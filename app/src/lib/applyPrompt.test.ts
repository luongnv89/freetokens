import { describe, it, expect } from "vitest";
import {
  PROFILE_LABELS,
  SAFETY_RULES,
  buildApplyPrompt,
  profilePlaceholder,
} from "./applyPrompt";
import { FALLBACK_STEPS } from "./offerDetails";
import type { Offer } from "./offers";
import { PROFILE_FIELDS, type Profile } from "./personalState";

const URL = "https://example.test/freetokens/offers/example-offer.html";

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    slug: "example-offer",
    title: "Example Offer",
    provider: "Example Co",
    category: "coding",
    amount: "$10 credits for students with a .edu email",
    expiry_date: null,
    source_url: "https://example.com/offer",
    verified_date: "2026-08-01",
    verification: "social_proof",
    review_status: "unverified",
    signup: "required",
    status: "active",
    ...overrides,
  };
}

const PROFILE: Profile = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  github: "ada",
  country: "United Kingdom",
  organization: "",
  role: "student",
  website: "",
  notes: "",
};

describe("buildApplyPrompt (#625)", () => {
  it("names the provider, offer, eligibility text, official URL and listing", () => {
    const prompt = buildApplyPrompt(offer(), undefined, null, URL);
    expect(prompt).toContain("Provider: Example Co");
    expect(prompt).toContain("Offer: Example Offer");
    expect(prompt).toContain(
      "What it gives and who qualifies: $10 credits for students with a .edu email",
    );
    expect(prompt).toContain(
      "Official page (start here): https://example.com/offer",
    );
    expect(prompt).toContain(`Listing I found it on: ${URL}`);
    expect(prompt).toContain("Ends: ongoing, no fixed end date");
    expect(prompt).toContain("Account needed: yes");
  });

  it("uses the offer's own summary and claim steps when details exist", () => {
    const prompt = buildApplyPrompt(
      offer({ expiry_date: "2026-12-31", signup: "none" }),
      {
        summary: "Free tier for coding agents.",
        claim_steps: ["Open the console.", "Click Claim."],
      },
      null,
      URL,
    );
    expect(prompt).toContain("Summary: Free tier for coding agents.");
    expect(prompt).toContain("1. Open the console.\n2. Click Claim.");
    expect(prompt).toContain("Ends: Dec 31, 2026");
    expect(prompt).toContain("Account needed: no");
  });

  it("falls back to the generic claim steps without a details document", () => {
    const prompt = buildApplyPrompt(offer(), undefined, null, URL);
    expect(prompt).toContain(`1. ${FALLBACK_STEPS[0]}`);
    expect(prompt).not.toContain("Summary:");
  });

  it("without a profile, every field is a placeholder plus an ask-me note", () => {
    const prompt = buildApplyPrompt(offer(), undefined, null, URL);
    for (const field of PROFILE_FIELDS) {
      expect(prompt).toContain(
        `- ${PROFILE_LABELS[field]}: ${profilePlaceholder(field)}`,
      );
    }
    expect(profilePlaceholder("name")).toBe("[YOUR FULL NAME]");
    expect(prompt).toContain("I have not filled these in yet");
  });

  it("with a profile, fills the given values and omits blank fields", () => {
    const prompt = buildApplyPrompt(offer(), undefined, PROFILE, URL);
    expect(prompt).toContain("- Full name: Ada Lovelace");
    expect(prompt).toContain("- Email: ada@example.com");
    expect(prompt).toContain("- Role: student");
    expect(prompt).not.toContain("School or company");
    expect(prompt).not.toContain("[YOUR");
    expect(prompt).not.toContain("I have not filled these in yet");
  });

  it("always carries the step-by-step, check-each-step and ask-first rules", () => {
    for (const profile of [null, PROFILE]) {
      const prompt = buildApplyPrompt(offer(), undefined, profile, URL);
      for (const rule of SAFETY_RULES) expect(prompt).toContain(rule);
    }
    const rules = SAFETY_RULES.join(" ");
    expect(rules).toMatch(/one step at a time/);
    expect(rules).toMatch(/After each step, check the result/);
    expect(rules).toMatch(
      /explicit yes before ANY action that submits a form, creates an account or signs up.*payment.*sends any of my details/,
    );
  });

  it("asks the agent to confirm an unverified early listing first", () => {
    const early = buildApplyPrompt(
      offer({ verification: "unverified" }),
      undefined,
      null,
      URL,
    );
    expect(early).toContain("early listing");
    const checked = buildApplyPrompt(offer(), undefined, null, URL);
    expect(checked).not.toContain("early listing");
  });
});
