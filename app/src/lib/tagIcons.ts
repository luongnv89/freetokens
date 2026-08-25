// Tag glyph markup for the page sprite. The path data is GENERATED from
// lucide-react icon nodes (issue #122) — see scripts/gen-tag-icons.mjs and
// TAG_LUCIDE_MAP below for the committed tag-value → lucide-icon mapping
// table with shape-diff notes. Kept out of the component files so they stay
// fast-refresh clean; the sprite renders once per page (OfferRow.tsx
// IconSprite) and every <use> resolves in-document.
export { TAG_ICONS, TAG_LUCIDE_MAP } from "./tagIcons.generated";
export type { TagIconMeta } from "./tagIcons.generated";

// Baseline recorded before the lucide migration (#122): the 11 hand-authored
// <symbol> payloads totalled 1630 bytes of glyph markup. The generated
// lucide set must stay at or under that so the home listing's icon payload
// never regresses (acceptance criterion 2; asserted in tagIcons.test.ts).
export const SPRITE_GLYPH_BUDGET_BYTES = 1630;
