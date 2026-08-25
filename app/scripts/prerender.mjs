#!/usr/bin/env node
// Prerender step (tasks.md Tasks 1.5 + 2.4, epic #114, issues #119/#123):
// bundles the page tree with esbuild (already in the tree via vite), renders
// EVERY static route the live site serves with react-dom/server, and injects
// each document's markup into a copy of the `vite build` shell so dist/
// carries one full HTML file per route — /, /archive, /privacy, and
// offers/<slug>.html per entry in src/data/offers.json — plus feed.xml.
//
// Route generation is data-driven: adding an offer YAML regenerates
// offers.json (prebuild load:data) and the next build emits its detail page
// with no source edit. Depth-1 documents get their asset hrefs rewritten
// from ./ to ../ so the relative base stays deploy-base safe under the
// GitHub Pages /<repo>/ subpath (#60).
//
// Chosen over vite-react-ssg and Vite built-in prerender for the POC because
// it adds no dependencies (ADR-002 supply-chain mitigation). See ADR-002.
//
// Usage: node scripts/prerender.mjs [--dist dist] [--entry src/prerender/entry.tsx]
//        [--data src/data/offers.json] [--base-url https://...]

import { build } from "esbuild";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFeed } from "./feed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let distDir = path.join(here, "..", "dist");
let entry = path.join(here, "..", "src", "prerender", "entry.tsx");
let dataFile = path.join(here, "..", "src", "data", "offers.json");
let baseUrl;
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === "--dist") distDir = path.resolve(process.argv[++i]);
  else if (process.argv[i] === "--entry") entry = path.resolve(process.argv[++i]);
  else if (process.argv[i] === "--data") dataFile = path.resolve(process.argv[++i]);
  else if (process.argv[i] === "--base-url") baseUrl = process.argv[++i];
}

if (!existsSync(dataFile)) {
  console.error(`error: ${dataFile} not found; run \`npm run load:data\` first`);
  process.exit(1);
}
const index = JSON.parse(await readFile(dataFile, "utf8"));

function resolveMeasurementId(raw) {
  const value = (raw ?? "").trim();
  if (!value) return "";
  return /^G-[A-Z0-9]{6,12}$/.test(value) ? value : "";
}
function resolveStatsSite(raw) {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const origin = `${parsed.protocol}//${parsed.host}`;
    if (
      parsed.protocol !== "https:" ||
      !parsed.host ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      !/^https:\/\/[^\s"'<>]+$/.test(origin)
    ) {
      return "";
    }
    return origin;
  } catch {
    return "";
  }
}

const outfile = path.join(distDir, ".prerender", "entry.cjs");
await mkdir(path.dirname(outfile), { recursive: true });
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  loader: { ".css": "empty" },
  logLevel: "silent",
  // Same env names as vite.config.ts / deploy.yml. Empty when unset so
  // prerendered HTML never leaks tracker ids or loader markup.
  define: {
    __FT_GA_ID__: JSON.stringify(resolveMeasurementId(process.env.GA_MEASUREMENT_ID)),
    __FT_GC_SITE__: JSON.stringify(resolveStatsSite(process.env.GOATCOUNTER_SITE_URL)),
  },
  // Render from the SAME dataset that drives route emission (--data), not
  // whatever was frozen into the bundle at build time.
  plugins: [
    {
      name: "offers-data-override",
      setup(b) {
        b.onLoad({ filter: /(?:^|\/)src\/data\/offers\.json$/ }, async () => ({
          contents: await readFile(dataFile, "utf8"),
          loader: "json",
        }));
      },
    },
  ],
});

try {
  const { renderRoute } = await import(pathToFileURL(outfile).href);
  const indexPath = path.join(distDir, "index.html");
  if (!existsSync(indexPath)) {
    console.error(`error: ${indexPath} not found; run \`vite build\` first`);
    process.exit(1);
  }
  const template = await readFile(indexPath, "utf8");

  // React SSR emits camelCase `dateTime`; normalize to the lowercase spelling
  // build.py ships for byte parity (HTML attribute names are case-insensitive,
  // but a rendered-HTML diff should not show phantom differences).
  const normalize = (html) => html.replace(/<time dateTime=/g, "<time datetime=");

  // Matches both a fresh vite shell (<div id="root"></div>) and an already
  // prerendered document, so re-running the script over the same dist is
  // idempotent. The mount sits immediately before </body>; the injected
  // markup's own divs close inside it.
  const MOUNT_RE = /<div id="root"( data-page="[^"]*")?( data-slug="[^"]*")?>[\s\S]*<\/div>(?=\s*<\/body>)/;

  function fillPage({ markup, title, description, depth = 0, page, slug }) {
    let doc = template;
    doc = doc.replace(/<title>.*?<\/title>/s, `<title>${title}</title>`);
    // Vite pretty-prints the shell meta tag across lines; match either form
    // so archive/privacy/detail get their own description (#132).
    doc = doc.replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/>/,
      `<meta name="description" content="${description}" />`,
    );
    // Depth-1 documents must climb out of offers/: every root-relative asset
    // reference emitted by Vite gets one ../ prefix.
    if (depth > 0) doc = doc.replaceAll(/((?:src|href)=")\.\//g, `$1${"../".repeat(depth)}`);
    const attrs =
      (page ? ` data-page="${page}"` : "") + (slug ? ` data-slug="${slug}"` : "");
    if (!MOUNT_RE.test(doc)) {
      console.error(`error: dist/index.html has no <div id="root"></div> mount point`);
      process.exit(1);
    }
    return doc.replace(
      MOUNT_RE,
      `<div id="root"${attrs}>${normalize(markup)}</div>`,
    );
  }

  const written = [];

  // Home (/) — replaces vite's own index.html with the hydrated listing.
  await writeFile(
    indexPath,
    fillPage({
      markup: await renderRoute({ page: "home" }),
      title: "Free AI Credits",
      description:
        "Every currently-claimable free AI credit offer, labeled per offer with its verification level and sign-up need, on one fast page.",
      page: "home",
    }),
  );
  written.push("index.html");

  // Archive (/archive.html).
  await writeFile(
    path.join(distDir, "archive.html"),
    fillPage({
      markup: await renderRoute({ page: "archive" }),
      title: "Offer Archive · Free AI Credits",
      description:
        "Reference archive of expired free AI credit offers, kept newest-first with their original terms.",
      page: "archive",
    }),
  );
  written.push("archive.html");

  // Privacy policy (/privacy.html).
  await writeFile(
    path.join(distDir, "privacy.html"),
    fillPage({
      markup: await renderRoute({ page: "privacy" }),
      title: "Privacy Policy · Free AI Credits",
      description:
        "How the Free AI Credits site handles data: consent-gated anonymized analytics, no forms, no personal data storage.",
      page: "privacy",
    }),
  );
  written.push("privacy.html");

  // One detail page per offer — active AND expired (#60), placeholder shells
  // until task #128 ports the full layout. Unknown slugs can only come from
  // stale links, which GitHub Pages answers with its own 404; the graceful
  // not-found state still ships inside the app for hydration safety.
  const offersDir = path.join(distDir, "offers");
  await mkdir(offersDir, { recursive: true });
  for (const offer of index.offers) {
    const blurb =
      `${offer.amount} from ${offer.provider} — free AI credits, ` +
      "tagged by verification level and sign-up need.";
    await writeFile(
      path.join(offersDir, `${offer.slug}.html`),
      fillPage({
        markup: await renderRoute({ page: "detail", slug: offer.slug }),
        title: `${offer.title} · Free AI Credits`,
        description: blurb,
        depth: 1,
        page: "detail",
        slug: offer.slug,
      }),
    );
  }
  written.push(`offers/*.html (${index.offers.length})`);

  // RSS at the previous URL, absolute links off DEFAULT_BASE_URL (#27).
  await writeFile(path.join(distDir, "feed.xml"), buildFeed(index, baseUrl));
  written.push("feed.xml");

  const kb = (n) => (n / 1024).toFixed(1);
  console.log(
    `prerendered ${written.length + index.offers.length - 1} routes -> ` +
      `${written.join(", ")} (${kb(Buffer.byteLength(template))} KB shell)`,
  );
} finally {
  await rm(path.join(distDir, ".prerender"), { recursive: true, force: true });
}
