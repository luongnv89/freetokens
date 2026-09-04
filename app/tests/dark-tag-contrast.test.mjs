import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/* Dark-listing tag contrast (elegant redesign).
 *
 * design-tokens.test.mjs pins the thirteen tag hues to their exact hexes and
 * checks them against WHITE, because that is the ground they were chosen for.
 * The listing no longer has that ground. These hexes are ink-side colours —
 * social_proof navy #1e3a5f is literally darker than the #0e1013 page — so
 * .badge derives two colours per hue at paint time instead of using them raw:
 *
 *   text  color-mix(in srgb, <hue> 60%, white)
 *   fill  color-mix(in srgb, <hue> 18%, var(--paper))
 *
 * This suite recomputes that mix from the tokens actually in the stylesheet
 * and asserts AA against all three grounds a tag is ever seen on. It exists
 * because the two ratios are the whole reason the "keep the hues loud"
 * direction is shippable at all: nudge them and the quietest hues fail
 * silently, since nothing else in the suite looks at the dark treatment.
 */

const APP_ROOT = path.resolve(import.meta.dirname, "..");
const tokens = readFileSync(
  path.join(APP_ROOT, "src/styles/tokens.css"),
  "utf8",
);
const parity = readFileSync(
  path.join(APP_ROOT, "src/styles/python-parity.css"),
  "utf8",
);

/** Read a hex-valued @theme token straight out of tokens.css. */
function token(name) {
  const m = tokens.match(
    new RegExp(`(?<![\\w-])${name}: (#[0-9a-fA-F]{6})\\b`),
  );
  if (!m) throw new Error(`token ${name} missing from tokens.css`);
  return m[1].toLowerCase();
}

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) =>
  `#${c.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;

function luminance(h) {
  const [r, g, b] = rgb(h)
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** color-mix(in srgb, A p%, B) — linear in gamma-encoded sRGB, as CSS does. */
const mix = (a, p, b) => hex(rgb(a).map((c, i) => c * p + rgb(b)[i] * (1 - p)));

// Every hue a tag or ranking accent can take, read from the tokens rather
// than restated, so a token rename fails here instead of skipping silently.
const HUE_TOKENS = [
  "--color-tag-api-provider",
  "--color-tag-coding",
  "--color-tag-image",
  "--color-tag-voice",
  "--color-tag-video",
  "--color-tag-startup-program",
  "--color-tag-student",
  "--color-tag-review-verified",
  "--color-tag-social-proof",
  "--color-tag-unverified",
  "--color-tag-none",
  "--color-tag-required",
  "--color-tag-expired",
  "--color-hot",
];

const TEXT_MIX = 0.6;
const FILL_MIX = 0.18;

describe("dark listing tag contrast", () => {
  const PAPER = token("--color-paper");
  const SURFACE = token("--color-surface");
  const SURFACE_2 = token("--color-surface-2");

  it("keeps the derivation in the stylesheet in step with the ratios asserted here", () => {
    // If .badge stops deriving, or derives differently, every number below
    // becomes fiction — so pin the two declarations the maths models.
    expect(parity).toContain(
      `color: color-mix(in srgb, var(--tag-hue) ${TEXT_MIX * 100}%, white)`,
    );
    expect(parity).toContain(
      `background: color-mix(in srgb, var(--tag-hue) ${FILL_MIX * 100}%, var(--paper))`,
    );
  });

  it("clears AA for every hue against its own fill, the page and both surfaces", () => {
    for (const name of HUE_TOKENS) {
      const hue = token(name);
      const text = mix(hue, TEXT_MIX, "#ffffff");
      const fill = mix(hue, FILL_MIX, PAPER);
      for (const [ground, label] of [
        [fill, "own fill"],
        [PAPER, "page ground"],
        [SURFACE, "row surface"],
        [SURFACE_2, "row hover surface"],
      ]) {
        expect(
          contrast(text, ground),
          `${name} on ${label}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the active (inverted) tag readable — lifted hue behind page-ground text", () => {
    // Active fills with the same 60% mix and writes in --paper.
    for (const name of HUE_TOKENS) {
      const lifted = mix(token(name), TEXT_MIX, "#ffffff");
      expect(contrast(PAPER, lifted), `${name} active`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("keeps the base palette legible on every plane after the inversion", () => {
    const ink = token("--color-ink");
    const muted = token("--color-muted");
    const green = token("--color-accent");
    for (const ground of [PAPER, SURFACE, SURFACE_2]) {
      expect(contrast(ink, ground), `ink on ${ground}`).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrast(muted, ground),
        `muted on ${ground}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(green, ground),
        `accent on ${ground}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps ink and paper genuinely inverted, so `ink on paper` still means text", () => {
    // The whole redesign rests on --ink/--paper being roles rather than
    // literals; if a future edit flips one back, ~1900 rules silently invert.
    expect(luminance(token("--color-ink"))).toBeGreaterThan(
      luminance(token("--color-paper")),
    );
  });
});
