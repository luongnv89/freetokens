import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/* Two-scheme tag & palette contrast (warm-linen redesign).
 *
 * design-tokens.test.mjs pins the thirteen tag hues to their exact hexes and
 * checks them against WHITE, because that is the ground they were chosen for.
 * The site no longer has a single ground: it ships a warm light "linen"
 * palette by default and a warm-charcoal one under prefers-color-scheme:
 * dark, and neither can paint the raw hues directly — navy #1e3a5f is darker
 * than the dark page, and every hue is too loud as a light-scheme fill. So
 * .badge derives its colours per scheme through tokens:
 *
 *   text  color-mix(in srgb, <hue> var(--tag-text-mix), var(--tag-text-base))
 *   fill  color-mix(in srgb, <hue> var(--tag-fill-mix), var(--paper))
 *   edge  color-mix(in srgb, <hue> var(--tag-border-mix), var(--paper))
 *
 * Light darkens the hue toward black; dark lifts it toward white. This suite
 * parses BOTH palettes out of tokens.css — the first occurrence of each
 * token is the light value, the one inside the @media (prefers-color-scheme:
 * dark) block is the dark one — recomputes the mixes, and asserts AA on
 * every ground a tag is ever seen on, per scheme. It exists because the
 * ratios are the whole reason the "keep the hues frozen" direction is
 * shippable at all: nudge them and the quietest hues fail silently, since
 * nothing else in the suite looks at the derived treatment.
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

const DARK_BLOCK = (() => {
  const m = tokens.match(
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*)\}\s*\}/,
  );
  if (!m) throw new Error("no prefers-color-scheme: dark block in tokens.css");
  return m[1];
})();

/** Read a hex-valued token: light = first match in the file, dark = first
 *  match inside the dark media block. */
function token(name, scheme = "light") {
  const src = scheme === "dark" ? DARK_BLOCK : tokens;
  const m = src.match(
    new RegExp(`(?<![\\w-])${name}: (#[0-9a-fA-F]{6})\\b`),
  );
  if (!m) throw new Error(`token ${name} missing from ${scheme} tokens`);
  return m[1].toLowerCase();
}

/** Same for percentage-valued tokens like --tag-text-mix. */
function percentToken(name, scheme = "light") {
  const src = scheme === "dark" ? DARK_BLOCK : tokens;
  const m = src.match(new RegExp(`(?<![\\w-])${name}: (\\d+(?:\\.\\d+)?)%`));
  if (!m) throw new Error(`token ${name} missing from ${scheme} tokens`);
  return parseFloat(m[1]) / 100;
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

/** color-mix(in srgb, A p, B) — linear in gamma-encoded sRGB, as CSS does. */
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

const SCHEMES = ["light", "dark"];

describe.each(SCHEMES)("%s scheme contrast", (scheme) => {
  const PAPER = token("--color-paper", scheme);
  const SURFACE = token("--color-surface", scheme);
  const SURFACE_2 = token("--color-surface-2", scheme);
  const INK = token("--color-ink", scheme);
  const MUTED = token("--color-muted", scheme);
  const ACCENT = token("--color-accent", scheme);
  const TEXT_MIX = percentToken("--tag-text-mix", scheme);
  const TEXT_BASE = token("--tag-text-base", scheme);
  const FILL_MIX = percentToken("--tag-fill-mix", scheme);

  it("keeps the derivation in the stylesheet variable-driven, so both schemes paint through it", () => {
    // If .badge stops deriving through the mix tokens, every number below
    // becomes fiction — pin the three declarations the maths models.
    expect(parity).toContain(
      "color: color-mix(in srgb, var(--tag-hue) var(--tag-text-mix), var(--tag-text-base))",
    );
    expect(parity).toContain(
      "background: color-mix(in srgb, var(--tag-hue) var(--tag-fill-mix), var(--paper))",
    );
    expect(parity).toContain(
      "border-color: color-mix(in srgb, var(--tag-hue) var(--tag-border-mix), var(--paper))",
    );
  });

  it("clears AA for every hue against its own fill, the page and both surfaces", () => {
    for (const name of HUE_TOKENS) {
      const hue = token(name);
      const text = mix(hue, TEXT_MIX, TEXT_BASE);
      const fill = mix(hue, FILL_MIX, PAPER);
      for (const [ground, label] of [
        [fill, "own fill"],
        [PAPER, "page ground"],
        [SURFACE, "row surface"],
        [SURFACE_2, "control surface"],
      ]) {
        expect(
          contrast(text, ground),
          `${name} on ${label}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the active (inverted) tag readable — derived hue behind paper text", () => {
    // Active fills with the same text mix and writes in --paper.
    for (const name of HUE_TOKENS) {
      const filled = mix(token(name), TEXT_MIX, TEXT_BASE);
      expect(contrast(PAPER, filled), `${name} active`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("keeps the base palette legible on every plane", () => {
    for (const [ground, label] of [
      [PAPER, "paper"],
      [SURFACE, "surface"],
      [SURFACE_2, "surface-2"],
    ]) {
      expect(contrast(INK, ground), `ink on ${label}`).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrast(MUTED, ground),
        `muted on ${label}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(ACCENT, ground),
        `accent on ${label}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("scheme separation", () => {
  it("keeps ink and paper in genuinely opposite roles per scheme", () => {
    // The whole design rests on --ink/--paper being roles rather than
    // literals; if a future edit flips one, every rule silently inverts.
    expect(luminance(token("--color-paper", "light"))).toBeGreaterThan(
      luminance(token("--color-ink", "light")),
    );
    expect(luminance(token("--color-ink", "dark"))).toBeGreaterThan(
      luminance(token("--color-paper", "dark")),
    );
  });
});
