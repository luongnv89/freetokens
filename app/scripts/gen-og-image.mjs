#!/usr/bin/env node
// Deterministic OG image raster (1200×630) for freetokens — task 3.4 / #213.
// Renders brand wordmark + tagline + curator signal as an SVG, then
// rasterizes to PNG via sharp (pinned dep, supply-chain-minimal).
// No network, no fonts fetched — uses system sans-serif (Helvetica/Arial).
// Re-run: `node scripts/gen-og-image.mjs` -> writes app/public/og.png
// Output is exactly 1200×630, <300 KB.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(here, "..", "public", "og.png");

const W = 1200;
const H = 630;

// Colors from site design — dark slate + green accent
const bg = "#0f172a";
const bg2 = "#1e293b";
const green = "#22c55e";
const greenDark = "#15803d";
const muted = "#94a3b8";
const white = "#f8fafc";

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// SVG OG image — brand wordmark + tagline + curator signal
// Layout: left-aligned, generous padding, centered vertically.
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Free AI Credits — every claimable free AI credit offer">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${bg2}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <!-- accent bar -->
  <rect x="0" y="0" width="${W}" height="6" fill="${green}"/>
  <!-- logo monogram (same geometry as logo-mark.svg) -->
  <g transform="translate(64,84)">
    <path d="M14 10 H47 Q50 10 50 13 V16 Q50 19 47 19 H23 V28 H39 Q42 28 42 31 V34 Q42 37 39 37 H23 V54 H14 Z" fill="${green}"/>
    <path d="M43 47 H49 V24 H52 V50 H43 Z" fill="${green}" opacity="0.55"/>
  </g>
  <!-- wordmark -->
  <text x="152" y="134" font-family="Inter, Helvetica, Arial, sans-serif" font-size="22" font-weight="600" letter-spacing="2.5" fill="${green}">FREE AI CREDITS</text>
  <!-- headline -->
  <text x="64" y="232" font-family="Inter, Helvetica, Arial, sans-serif" font-size="54" font-weight="800" letter-spacing="-1.2" fill="${white}">Free AI Credits</text>
  <!-- tagline -->
  <text x="64" y="286" font-family="Inter, Helvetica, Arial, sans-serif" font-size="24" font-weight="400" fill="${white}" opacity="0.92">Every claimable free AI credit offer on one fast page.</text>
  <text x="64" y="320" font-family="Inter, Helvetica, Arial, sans-serif" font-size="17" font-weight="400" fill="${muted}">Labeled by verification level &amp; sign-up need — refreshed on every rebuild.</text>
  <!-- curator signal pills -->
  <g transform="translate(64,366)">
    <rect x="0" y="0" rx="16" ry="16" width="158" height="30" fill="${green}" opacity="0.16" stroke="${green}" stroke-width="1.2"/>
    <text x="16" y="20" font-family="Inter, Helvetica, Arial, sans-serif" font-size="12.5" font-weight="700" letter-spacing="0.6" fill="${green}">✓ VERIFIED OFFERS</text>
    <rect x="172" y="0" rx="16" ry="16" width="184" height="30" fill="white" opacity="0.08" stroke="white" stroke-width="1" stroke-opacity="0.18"/>
    <text x="188" y="20" font-family="Inter, Helvetica, Arial, sans-serif" font-size="12.5" font-weight="600" letter-spacing="0.4" fill="${white}">TAGGED BY SIGN-UP NEED</text>
    <rect x="370" y="0" rx="16" ry="16" width="142" height="30" fill="white" opacity="0.08" stroke="white" stroke-width="1" stroke-opacity="0.18"/>
    <text x="386" y="20" font-family="Inter, Helvetica, Arial, sans-serif" font-size="12.5" font-weight="600" letter-spacing="0.4" fill="${white}">ZERO RUNTIME</text>
  </g>
  <!-- URL footer -->
  <text x="64" y="520" font-family="Inter, Helvetica, Arial, sans-serif" font-size="14" font-weight="500" letter-spacing="0.3" fill="${muted}">freetokens.custats.info</text>
  <text x="64" y="544" font-family="Inter, Helvetica, Arial, sans-serif" font-size="12" font-weight="400" fill="${muted}" opacity="0.7">Curated &amp; rebuilt from verified provider sources.</text>
  <!-- bottom accent -->
  <rect x="64" y="564" width="48" height="3" rx="1.5" fill="${green}" opacity="0.85"/>
</svg>`;

await mkdir(path.dirname(outPath), { recursive: true });
const png = await sharp(Buffer.from(svg), { density: 72 })
  .resize(W, H, { fit: "fill" })
  .png({ compressionLevel: 9, palette: false })
  .toBuffer();

// Ensure size is valid 1200x630 by re-reading metadata
const meta = await sharp(png).metadata();
if (meta.width !== W || meta.height !== H) {
  console.error(`error: expected ${W}x${H}, got ${meta.width}x${meta.height}`);
  process.exit(1);
}
if (png.length > 300 * 1024) {
  console.warn(
    `warning: og.png is ${(png.length / 1024).toFixed(1)} KB (>300 KB)`,
  );
}

await writeFile(outPath, png);
console.log(
  `og.png ${W}x${H} ${(png.length / 1024).toFixed(1)} KB -> ${path.relative(process.cwd(), outPath)}`,
);
