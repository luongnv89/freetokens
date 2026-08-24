// Tag glyph path data, mirrored from scripts/build.py TAG_ICONS. Kept out of
// the component files so they stay fast-refresh clean; the sprite renders
// once per page (OfferRow.tsx IconSprite) and every <use> resolves in-document.
export const TAG_ICONS: Record<string, string> = {
  api_provider:
    '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M6.8 7.5h.01M6.8 16.5h.01"/>',
  coding: '<path d="m9 6-6 6 6 6"/><path d="m15 6 6 6-6 6"/>',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.6" cy="9.4" r="1.4"/><path d="m3.5 17.5 4.6-4.6 4 4 3-3 5.4 5.4"/>',
  voice: '<path d="M4 10.5v3M8 6.5v11M12 3.5v17M16 6.5v11M20 10.5v3"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m10.4 9.4 5 2.6-5 2.6z"/>',
  hand_verified: '<circle cx="12" cy="12" r="9"/><path d="m8 12.2 2.7 2.7L16 9.4"/>',
  social_proof:
    '<path d="M20.5 13.5a2 2 0 0 1-2 2H8.5l-4.5 4V5.5a2 2 0 0 1 2-2h12.5a2 2 0 0 1 2 2z"/><path d="M8.5 9.5h8M8.5 12.5h5"/>',
  unverified:
    '<circle cx="12" cy="12" r="9" stroke-dasharray="3.2 3"/><path d="M9.7 9.4a2.4 2.4 0 0 1 4.7.6c0 1.6-2.4 1.9-2.4 3.4"/><path d="M12 16.8h.01"/>',
  none: '<rect x="4" y="10.5" width="16" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 7.7-1.6"/>',
  required: '<rect x="4" y="10.5" width="16" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
}
