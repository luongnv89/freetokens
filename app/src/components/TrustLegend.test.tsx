import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrustLegend, TRUST_LEGEND_HEADING_ID } from "./TrustLegend";
import { LAST_CHECKED } from "../lib/offers";
import {
  EVIDENCE_LEVEL,
  REVIEW_STATUS,
  SIGNUP,
  trustDefinitions,
} from "../../scripts/trust-vocabulary.mjs";

// T4 / #507: the meaning of review status and evidence level used to live only
// in `title` attributes, so the words a reader had to disambiguate were the
// words they had to hover to read. The legend must carry them as visible text.
const markup = renderToStaticMarkup(TrustLegend({}));

/** Everything above the nested disclosure: what a reader sees with no interaction. */
const visible = markup.slice(
  0,
  markup.indexOf('<details class="trust-legend-full"'),
);

/** React escapes text nodes; compare against the escaped form. */
function escaped(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&#x27;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

describe("hover-free trust legend (#507)", () => {
  it("renders expanded by default, so nothing has to be clicked to be read", () => {
    // `<details open>`: the tier below is in the prerendered text and painted
    // on first load; collapsing is an opt-in for a reader who knows the words.
    expect(markup).toMatch(/<details open(=""|)>/);
    expect(visible).not.toBe("");
  });

  it("renders a heading that anchors the block", () => {
    expect(markup).toContain(`id="${TRUST_LEGEND_HEADING_ID}"`);
    expect(markup).toContain("How to read these labels");
  });

  it("carries no title attribute at all — nothing here needs a hover", () => {
    expect(markup).not.toMatch(/\btitle=/);
  });

  it("prints every axis name and question without any interaction", () => {
    for (const group of trustDefinitions()) {
      expect(visible, group.field).toContain(escaped(group.name));
      expect(visible, group.field).toContain(escaped(group.question));
    }
  });

  it("gives every value its label and its meaning above the disclosure", () => {
    // The short meaning is the point of the visible tier: a reader who never
    // hovers and never opens anything still learns what each badge means.
    for (const [value, entry] of Object.entries({
      ...REVIEW_STATUS,
      ...EVIDENCE_LEVEL,
      ...SIGNUP,
    })) {
      expect(visible, value).toContain(escaped(entry.label));
      expect(visible, value).toContain(escaped(entry.short));
    }
  });

  it("prints the full definitions and claim-attempt answers as text", () => {
    for (const [value, entry] of Object.entries(REVIEW_STATUS)) {
      expect(markup, value).toContain(entry.label);
      expect(markup, value).toContain(`<code>${value}</code>`);
      expect(markup, value).toContain(escaped(entry.definition));
      expect(markup, value).toContain(escaped(entry.claim));
    }
    for (const [value, entry] of Object.entries(EVIDENCE_LEVEL)) {
      expect(markup, value).toContain(entry.label);
      expect(markup, value).toContain(escaped(entry.definition));
    }
  });

  it("names both schema fields so a reader can map a badge to the YAML", () => {
    expect(markup).toContain("review_status");
    expect(markup).toContain("verification");
  });

  it("states the Last checked meaning and the enrollment-deadline distinction", () => {
    expect(markup).toContain(LAST_CHECKED.label);
    expect(markup).toContain(escaped(LAST_CHECKED.definition));
    expect(markup).toMatch(/enrollment deadline/i);
  });

  it("spells out the reviewed + corroborated combination above the disclosure", () => {
    expect(visible).toMatch(/reviewed and corroborated/i);
  });

  it("prints the four verbs the labels answer as text", () => {
    expect(markup).toMatch(/corroborated = evidence level/);
    expect(markup).toMatch(/reviewed \/ tested = review status/);
  });
});
