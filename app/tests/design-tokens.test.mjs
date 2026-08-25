import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Design-system tokens (issue #121): the 11 tag hues ported from build.py
// `_CSS` into Tailwind v4 @theme tokens must stay numerically identical and
// keep clearing WCAG AA (>= 4.5:1) in every painted state a tag has.

const APP_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");

// value: (token, hex) — mirrors scripts/build.py TAG_HUES / `_CSS` --t-*.
const EXPECTED = {
  api_provider: ["--color-tag-api-provider", "#3538cd"],
  coding: ["--color-tag-coding", "#0e7490"],
  image: ["--color-tag-image", "#955906"],
  voice: ["--color-tag-voice", "#7e22ce"],
  video: ["--color-tag-video", "#be123c"],
  hand_verified: ["--color-tag-hand-verified", "#15803d"],
  social_proof: ["--color-tag-social-proof", "#1e3a5f"],
  unverified: ["--color-tag-unverified", "#5f6673"],
  none: ["--color-tag-none", "#15803d"],
  required: ["--color-tag-required", "#5f6673"],
  expired: ["--color-tag-expired", "#5f6673"],
};

function tokensCss() {
  return readFileSync(path.join(APP_ROOT, "src/styles/tokens.css"), "utf8");
}

function themeToken(name) {
  const m = tokensCss().match(new RegExp(`(?<![\\w-])${name}: (#[0-9a-fA-F]{6})\\b`));
  if (!m) throw new Error(`@theme token ${name} missing from tokens.css`);
  return m[1].toLowerCase();
}

function pythonTagTokens() {
  const css = readFileSync(path.join(REPO_ROOT, "scripts/build.py"), "utf8");
  const m = css.match(/_CSS = """\n([\s\S]*?)\n"""/);
  if (!m) throw new Error("could not extract _CSS from scripts/build.py");
  const found = {};
  for (const match of m[1].matchAll(/--t-([a-z_]+): (#[0-9a-f]{6});/g)) {
    found[match[1]] = match[2];
  }
  return found;
}

function luminance(hex) {
  const channels = [1, 3, 5].map((i) =>
    parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** The 7% tint a tag sits on at rest: color-mix(in srgb, hue 7%, white). */
function tint(hex) {
  const mix = (i) =>
    Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.07 + 255 * 0.93);
  return `#${[1, 3, 5].map(mix).map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

describe("Tailwind tag-hue tokens (#121)", () => {
  it("defines all 11 hues as @theme tokens with the exact ported values", () => {
    for (const [value, [token, hex]] of Object.entries(EXPECTED)) {
      expect(themeToken(token), value).toBe(hex);
    }
    // No extras beyond the eleven.
    const defined = [...tokensCss().matchAll(/--color-tag-[a-z-]+:/g)].length;
    expect(defined).toBe(11);
  });

  it("stays in lockstep with build.py `_CSS` — no cross-language drift", () => {
    const python = pythonTagTokens();
    expect(Object.keys(python).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [value, [token]] of Object.entries(EXPECTED)) {
      expect(themeToken(token), value).toBe(python[value]);
    }
  });

  it("clears WCAG AA as text on white AND under white text when filled", () => {
    for (const [value, [token, hex]] of Object.entries(EXPECTED)) {
      const onWhite = contrast(hex, "#ffffff");
      const filled = contrast("#ffffff", hex);
      expect(onWhite, `${value} text-on-white`).toBeGreaterThanOrEqual(4.5);
      // Symmetric mathematically; asserted per the acceptance criterion's
      // two states so a future edit cannot quietly drop one.
      expect(filled, `${value} white-on-filled`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("also clears WCAG AA over its own 7% rest-state tint", () => {
    for (const [, [token, hex]] of Object.entries(EXPECTED)) {
      expect(contrast(hex, tint(hex)), token).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("never collides with the ink fallback for unknown values", () => {
    for (const [, [token, hex]] of Object.entries(EXPECTED)) {
      expect(themeToken(token)).not.toBe("#000000");
    }
  });
});

describe("Clear-all-filters chip rest-state contrast (#126)", () => {
  const parityCss = readFileSync(
    path.join(APP_ROOT, "src/styles/python-parity.css"),
    "utf8",
  );

  it("paints gray-on-paper at rest so 0.7rem text clears WCAG AA", () => {
    const rest = parityCss.match(/\.chip\.clear \{([^}]+)\}/);
    expect(rest, ".chip.clear rest rule").toBeTruthy();
    expect(rest[1]).toMatch(/background:\s*var\(--paper\)/);
    expect(rest[1]).toMatch(/color:\s*var\(--gray\)/);
    // --gray → --color-muted #6b7280 on --paper #ffffff is ~4.83:1.
    // The inherited 7% ink wash (~#ededed) drops that to ~4.1:1.
    expect(contrast(themeToken("--color-muted"), themeToken("--color-paper")))
      .toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the ink fill on hover and focus-visible", () => {
    const hover = parityCss.match(
      /\.chip\.clear:hover,\s*\.chip\.clear:focus-visible \{([^}]+)\}/,
    );
    expect(hover, ".chip.clear hover/focus rule").toBeTruthy();
    expect(hover[1]).toMatch(/background:\s*var\(--ink\)/);
    expect(hover[1]).toMatch(/color:\s*var\(--paper\)/);
  });
});
