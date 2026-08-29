import { describe, it, expect } from "vitest";
import {
  TAG_ICONS,
  TAG_LUCIDE_MAP,
  SPRITE_GLYPH_BUDGET_BYTES,
} from "./tagIcons";

// The thirteen honesty-tag values shared with scripts/offer_model.py TAG_ICONS.
const EXPECTED_TAGS = [
  "api_provider",
  "coding",
  "image",
  "voice",
  "video",
  "startup_program",
  "student",
  "review_verified",
  "social_proof",
  "unverified",
  "none",
  "required",
  "expired",
];

describe("lucide tag-icon mapping (#122)", () => {
  it("maps exactly the thirteen tag values", () => {
    expect(Object.keys(TAG_ICONS).sort()).toEqual([...EXPECTED_TAGS].sort());
    expect(Object.keys(TAG_LUCIDE_MAP).sort()).toEqual([...EXPECTED_TAGS].sort());
  });

  it("records a lucide icon name and shape note for every value", () => {
    for (const [value, meta] of Object.entries(TAG_LUCIDE_MAP)) {
      expect(meta.lucide, value).toMatch(/^[a-z0-9-]+$/);
      expect(meta.note.length, value).toBeGreaterThan(0);
    }
  });

  it("flags shape differences explicitly where glyphs diverge", () => {
    // unverified keeps its dashed-ring question mark in the hand-drawn set;
    // lucide's ring is solid, so the note must say SHAPE DIFFERS.
    expect(TAG_LUCIDE_MAP.unverified.note).toContain("SHAPE DIFFERS");
  });

  it("emits well-formed SVG element markup per glyph", () => {
    for (const [value, markup] of Object.entries(TAG_ICONS)) {
      expect(markup.length, value).toBeGreaterThan(0);
      // Glyphs carry no paint of their own — color/stroke inherit from the
      // consuming <symbol>/<svg> so currentColor drives every tag hue.
      expect(markup, value).not.toMatch(/stroke=|fill=|class=/);
      expect(markup, value).toMatch(/^<[a-z]+ /);
    }
  });

  it("keeps total glyph payload within the pre-migration sprite budget", () => {
    const total = Object.values(TAG_ICONS).join("").length;
    expect(total).toBeLessThanOrEqual(SPRITE_GLYPH_BUDGET_BYTES);
  });
});
