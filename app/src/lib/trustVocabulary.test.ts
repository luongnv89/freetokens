import { describe, it, expect } from "vitest";
import {
  ENROLLMENT_DEADLINE_NOTE,
  EVIDENCE_LEVEL,
  LAST_CHECKED,
  REVIEW_STATUS,
  SIGNUP,
  TRUST_COMBINED_EXAMPLE,
  TRUST_SUMMARY,
  TRUST_VERB_MAP,
  trustDefinitions,
  trustFieldPairs,
  trustFields,
} from "../../scripts/trust-vocabulary.mjs";
import {
  REVIEW_STATUS_LABELS,
  SIGNUP_LABELS,
  VERIFICATION_LABELS,
} from "./offers";

// The trust vocabulary is the single source the badges, the hover-free legend,
// the structured data and the llms exports all read (issues #507/#509). These
// assertions pin the two properties the review task asks for: every value is
// documented, and no value promotes an unknown method to "verified".
const sample = {
  review_status: "to-be-verified",
  verification: "social_proof",
  signup: "required",
  verified_date: "2026-09-30",
};

describe("trust vocabulary completeness", () => {
  it("documents every review-status value with a label, a meaning and a claim answer", () => {
    expect(Object.keys(REVIEW_STATUS).sort()).toEqual([
      "to-be-verified",
      "under-review",
      "unverified",
      "verified",
    ]);
    for (const [value, entry] of Object.entries(REVIEW_STATUS)) {
      expect(entry.label, value).toBeTruthy();
      expect(entry.definition.length, value).toBeGreaterThan(20);
      expect(entry.claim, value).toBeTruthy();
    }
  });

  it("documents every evidence-level value the same way", () => {
    expect(Object.keys(EVIDENCE_LEVEL).sort()).toEqual([
      "social_proof",
      "unverified",
    ]);
    for (const [value, entry] of Object.entries(EVIDENCE_LEVEL)) {
      expect(entry.label, value).toBeTruthy();
      expect(entry.definition.length, value).toBeGreaterThan(20);
      expect(entry.claim, value).toBeTruthy();
    }
  });

  it("labels the checked date 'Last checked', never 'Verified'", () => {
    expect(LAST_CHECKED.label).toBe("Last checked");
    expect(LAST_CHECKED.definition).toMatch(/freshness/i);
  });

  it("keeps the enrollment deadline separate from credit validity", () => {
    expect(ENROLLMENT_DEADLINE_NOTE).toMatch(/enrollment deadline/i);
    expect(ENROLLMENT_DEADLINE_NOTE).toMatch(/stay valid/i);
    expect(ENROLLMENT_DEADLINE_NOTE).toMatch(/amount/i);
  });

  it("uses one label per value across both axes — no 'unverified' collision", () => {
    const labels = [
      ...Object.values(REVIEW_STATUS).map((e) => e.label),
      ...Object.values(EVIDENCE_LEVEL).map((e) => e.label),
      ...Object.values(SIGNUP).map((e) => e.label),
    ];
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("claim-attempt honesty", () => {
  it("does not let review 'verified' attest a completed claim", () => {
    const entry = REVIEW_STATUS.verified;
    expect(entry.claim).toMatch(/no claim attempt is attested/i);
    expect(entry.definition).not.toMatch(/claim(ed|ing)? (was|is) (completed|made)/i);
    expect(entry.definition).not.toMatch(/successfully claimed/i);
  });

  it("records the under-review claim attempt as in progress, not concluded", () => {
    expect(REVIEW_STATUS["under-review"].claim).toMatch(/in progress/i);
    expect(REVIEW_STATUS["under-review"].claim).toMatch(/not recorded/i);
  });

  it("keeps the evidence axis silent about claim attempts", () => {
    for (const [value, entry] of Object.entries(EVIDENCE_LEVEL)) {
      expect(entry.claim, value).toMatch(/review status/i);
      expect(entry.definition, value).not.toMatch(/personally/i);
      expect(entry.definition, value).not.toMatch(/claim/i);
    }
  });

  it("explains the reviewed + corroborated combination without contradiction", () => {
    expect(TRUST_SUMMARY).toMatch(/independent/i);
    expect(TRUST_SUMMARY).toMatch(/neither one means the curator completed the claim/i);
    expect(TRUST_COMBINED_EXAMPLE).toMatch(/reviewed and corroborated/i);
    expect(TRUST_COMBINED_EXAMPLE).toMatch(/never contradict/i);
    expect(TRUST_VERB_MAP).toMatch(/corroborated = evidence level/);
    expect(TRUST_VERB_MAP).toMatch(/checked = the last-checked date/);
  });

  it("never invents a label for an unknown value", () => {
    // The maps the badges read carry no entry for a value outside the enum, so
    // an unknown method falls back to its raw name — never to "verified".
    expect(REVIEW_STATUS_LABELS["published"]).toBeUndefined();
    expect(VERIFICATION_LABELS["hand-verified"]).toBeUndefined();
    expect(SIGNUP_LABELS["maybe"]).toBeUndefined();
  });
});

describe("legend + export projections", () => {
  it("projects every value into the legend, carrying the raw schema value", () => {
    const groups = trustDefinitions();
    expect(groups.map((g) => g.field)).toEqual([
      "review_status",
      "verification",
      "signup",
    ]);
    const entries = groups.flatMap((g) => g.entries.map((e) => e.value));
    expect(entries).toEqual([
      ...Object.keys(REVIEW_STATUS),
      ...Object.keys(EVIDENCE_LEVEL),
      ...Object.keys(SIGNUP),
    ]);
    for (const group of groups) {
      expect(group.name, group.field).toBeTruthy();
      expect(group.question, group.field).toMatch(/\?$/);
    }
  });

  it("gives every value a short meaning the legend can print without a hover", () => {
    for (const group of trustDefinitions()) {
      for (const entry of group.entries) {
        expect(entry.short, entry.value).toBeTruthy();
        // One clause, not the full sentence: the visible tier stays scannable.
        expect(entry.short.length, entry.value).toBeLessThan(
          entry.definition.length,
        );
        expect(entry.short, entry.value).not.toMatch(/\.$/);
      }
    }
  });

  it("projects one offer into machine-readable field=value pairs", () => {
    expect(trustFieldPairs(sample)).toEqual([
      "review_status=to-be-verified",
      "verification=social_proof",
      "signup=required",
    ]);
    expect(trustFields(sample)).toBe(
      "review_status=to-be-verified · verification=social_proof · " +
        "signup=required · last_checked=2026-09-30",
    );
  });
});
