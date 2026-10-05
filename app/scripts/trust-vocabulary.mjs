/**
 * Canonical trust vocabulary for the freetokens directory (issues #507 / #509).
 *
 * Every offer carries two INDEPENDENT trust labels, and the two are easy to
 * confuse because both are about "verification":
 *
 *   review_status  — how far the CURATOR has reviewed the listing
 *   verification   — what the offer's TERMS rest on (its evidence level)
 *
 * Nothing else in the codebase may restate these definitions: the listing
 * badges and their hover text, the hover-free legend on the home and detail
 * surfaces, the JSON-LD copy and the llms.txt / llms-full.txt exports all read
 * this module, so a wording fix lands everywhere at once and no surface can
 * promote an unknown method to "verified".
 *
 * Plain ESM with a sibling `.d.mts`, exactly like `env-file.mjs`: the Vite
 * build loads it through `src/lib/offers.ts`, and `scripts/generate-llms.mjs`
 * imports it from Node at build time with no TS transform step.
 */

/** Axis names, in the order the UI and the exports present them. */
export const TRUST_AXES = [
  {
    field: "review_status",
    name: "Review status",
    question: "How far has the curator reviewed this listing?",
  },
  {
    field: "verification",
    name: "Evidence level",
    question: "What do this offer's terms rest on?",
  },
  {
    field: "signup",
    name: "Sign-up need",
    question: "Does claiming need an account?",
  },
];

/**
 * `review_status` values. `claim` records whether a claim attempt is attested
 * by the value — the question the review task (T4 / #507) asks each value to
 * answer out loud, so no reader has to infer it. `short` is the one-clause form
 * the always-visible legend prints, so a reader gets the meaning without a
 * hover or a click; `definition` is the long form the docs and the llms
 * exports carry.
 */
export const REVIEW_STATUS = {
  verified: {
    label: "reviewed",
    short: "read against the source",
    definition:
      "The curator has read this listing against the provider's own source and its terms match what is listed.",
    claim: "No claim attempt is attested by this value.",
  },
  "under-review": {
    label: "under review",
    short: "being checked now",
    definition: "The curator is testing this listing now.",
    claim:
      "A claim attempt is in progress; its outcome is not recorded yet.",
  },
  unverified: {
    label: "not reviewed",
    short: "not read yet",
    definition:
      "The curator has not reviewed this listing firsthand yet.",
    claim: "No claim attempt is attested.",
  },
  "to-be-verified": {
    label: "to be verified",
    short: "needs follow-up",
    definition:
      "The listing's current details need follow-up verification before they can be relied on.",
    claim: "No claim attempt is attested.",
  },
};

/**
 * `verification` values (the evidence level). Each `claim` says explicitly that
 * this axis is silent about claim attempts — that answer belongs to the review
 * status — which is what untangles the old "social proof says not personally
 * verified, verified review says reviewed firsthand" contradiction.
 */
export const EVIDENCE_LEVEL = {
  social_proof: {
    label: "corroborated",
    short: "official + social source",
    definition:
      "The offer's terms are corroborated by the provider's own site plus at least one social or community source.",
    claim:
      "This axis records corroboration only — whether a claim was attempted is the review status.",
  },
  unverified: {
    label: "community-sourced",
    short: "social sources only",
    definition:
      "Only social or community sources describe this offer; there is no official-site confirmation yet, so treat every term as unconfirmed.",
    claim:
      "This axis records corroboration only — whether a claim was attempted is the review status.",
  },
};

/** `signup` values. */
export const SIGNUP = {
  none: {
    label: "no sign-up",
    short: "no account needed",
    definition: "Claimable without creating an account.",
    claim: "",
  },
  required: {
    label: "sign-up required",
    short: "free account needed",
    definition: "Claiming needs a (free) account.",
    claim: "",
  },
};

/** The checked date, and the deadline it must never be confused with. */
export const LAST_CHECKED = {
  label: "Last checked",
  definition:
    "The date the curator last confirmed the entry against its source. It describes the listing's freshness, not the offer's expiry.",
};

export const ENROLLMENT_DEADLINE_NOTE =
  "An offer's expiry date is its enrollment deadline — the last date to claim — not how long the credits stay valid. When a provider states how long claimed credits last, that term is in the amount text.";

/** One-paragraph explanation both the UI legend and the llms exports carry. */
export const TRUST_SUMMARY =
  "Two independent labels qualify every offer: review status says how far the curator has reviewed the listing; evidence level says what the offer's terms rest on. Neither one means the curator completed the claim, and the last-checked date is when the entry was last confirmed against its source.";

/** The verified + social_proof combination, spelled out (T4 acceptance). */
export const TRUST_COMBINED_EXAMPLE =
  "An entry can be reviewed and corroborated at once: review status and evidence level answer different questions, so they never contradict each other.";

/** The four verbs of the task, mapped to the field that answers each. */
export const TRUST_VERB_MAP =
  "corroborated = evidence level · reviewed / tested = review status · checked = the last-checked date";

/**
 * Hover-free definition rows: one group per axis, `value` always the schema's
 * own enum value so a reader can map a badge to the YAML field without
 * guessing. The UI legend and the llms `## Trust labels` section both render
 * these rows, so the site and the exports define the words identically.
 */
export function trustDefinitions() {
  const entriesByField = {
    review_status: REVIEW_STATUS,
    verification: EVIDENCE_LEVEL,
    signup: SIGNUP,
  };
  return TRUST_AXES.map((axis) => ({
    ...axis,
    entries: Object.entries(entriesByField[axis.field]).map(
      ([value, entry]) => ({ value, ...entry }),
    ),
  }));
}

/**
 * The three trust axes of one offer (without the date), as `field=value`
 * pairs — for a line that already carries the checked date in its own label.
 */
export function trustFieldPairs(offer) {
  return [
    `review_status=${offer.review_status}`,
    `verification=${offer.verification}`,
    `signup=${offer.signup}`,
  ];
}

/**
 * The trust fields of one offer, as `field=value` pairs. Used by the llms
 * exports so a machine reads the same schema names the YAML uses, and so the
 * two generated files cannot drift apart.
 */
export function trustFields(offer) {
  return [...trustFieldPairs(offer), `last_checked=${offer.verified_date}`].join(
    " · ",
  );
}
