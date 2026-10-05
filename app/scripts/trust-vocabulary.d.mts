/**
 * Types for trust-vocabulary.mjs (issues #507 / #509). It stays plain ESM
 * because scripts/generate-llms.mjs imports it from Node directly, with no
 * build step to strip types — the same arrangement as env-file.mjs.
 */

export type ReviewStatusValue =
  | "verified"
  | "unverified"
  | "under-review"
  | "to-be-verified";

export type EvidenceLevelValue = "social_proof" | "unverified";

export type SignupValue = "none" | "required";

export interface TrustValueDefinition {
  /** Display label: what a badge and the export print. */
  label: string;
  /**
   * The one-clause meaning the always-visible legend prints — the value in
   * words a reader gets without hovering or opening anything.
   */
  short: string;
  /** What the value means, in full. */
  definition: string;
  /** What the value does NOT attest — the claim-attempt answer. */
  claim: string;
}

export interface TrustAxis {
  /** The schema field the axis belongs to. */
  field: string;
  /** Human axis name. */
  name: string;
  /** The question the axis answers. */
  question: string;
}

export interface TrustDefinitionGroup extends TrustAxis {
  entries: (TrustValueDefinition & { value: string })[];
}

export interface TrustedOffer {
  review_status: string;
  verification: string;
  signup: string;
  verified_date: string;
}

export declare const TRUST_AXES: [TrustAxis, TrustAxis, TrustAxis];

export declare const REVIEW_STATUS: Record<ReviewStatusValue, TrustValueDefinition>;
export declare const EVIDENCE_LEVEL: Record<
  EvidenceLevelValue,
  TrustValueDefinition
>;
export declare const SIGNUP: Record<SignupValue, TrustValueDefinition>;

export declare const LAST_CHECKED: { label: string; definition: string };
export declare const ENROLLMENT_DEADLINE_NOTE: string;
export declare const TRUST_SUMMARY: string;
export declare const TRUST_COMBINED_EXAMPLE: string;
export declare const TRUST_VERB_MAP: string;

export function trustDefinitions(): TrustDefinitionGroup[];
export function trustFieldPairs(offer: TrustedOffer): string[];
export function trustFields(offer: TrustedOffer): string;
