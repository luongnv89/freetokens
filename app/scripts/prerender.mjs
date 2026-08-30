#!/usr/bin/env node
// Prerender step (tasks.md Tasks 1.5 + 2.4, epic #114, issues #119/#123):
// bundles the page tree with esbuild (already in the tree via vite), renders
// EVERY static route the live site serves with react-dom/server, and injects
// each document's markup into a copy of the `vite build` shell so dist/
// carries one full HTML file per route — /, /archive, /privacy, and
// offers/<slug>.html per entry in src/data/offers.json — plus feed.xml and
// sitemap.xml.
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
import { readFile, writeFile, rm, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFeed, DEFAULT_BASE_URL } from "./feed.mjs";
import { buildSitemap } from "./sitemap.mjs";

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
        // Aggregated details map (issue #128). Sibling of --data when present,
        // else the generated src/data/details.json. Empty object if neither
        // exists so a synthetic --data-only prerender still bundles.
        b.onLoad({ filter: /(?:^|\/)src\/data\/details\.json$/ }, async () => {
          const sibling = path.join(path.dirname(dataFile), "details.json");
          const fallback = path.join(here, "..", "src", "data", "details.json");
          const file = existsSync(sibling) ? sibling : fallback;
          return {
            contents: existsSync(file) ? await readFile(file, "utf8") : "{}",
            loader: "json",
          };
        });
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
  const origin = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");

  // React SSR emits camelCase `dateTime`; normalize to the lowercase spelling
  // build.py ships for byte parity (HTML attribute names are case-insensitive,
  // but a rendered-HTML diff should not show phantom differences).
  const normalize = (html) => html.replace(/<time dateTime=/g, "<time datetime=");

  // Matches both a fresh vite shell (<div id="root"></div>) and an already
  // prerendered document, so re-running the script over the same dist is
  // idempotent. The mount sits immediately before </body>; the injected
  // markup's own divs close inside it.
  const MOUNT_RE = /<div id="root"( data-page="[^"]*")?( data-slug="[^"]*")?>[\s\S]*<\/div>(?=\s*<\/body>)/;

  function htmlAttr(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  // build.py render_offer_html: summary truncated at 160 chars, else generic.
  function offerMetaDescription(offer, detail) {
    const summary = detail?.summary ?? "";
    if (summary) {
      return summary.length > 160 ? summary.slice(0, 157).trimEnd() + "..." : summary;
    }
    return (
      `${offer.amount} from ${offer.provider} — free AI credits, ` +
      "tagged by verification level and sign-up need."
    );
  }

  const SOCIAL_META_START = "<!-- free-ai-credits:social-meta:start -->";
  const SOCIAL_META_END = "<!-- free-ai-credits:social-meta:end -->";
  const SOCIAL_META_RE =
    /[ \t]*<!-- free-ai-credits:social-meta:start -->[\s\S]*?[ \t]*<!-- free-ai-credits:social-meta:end -->/g;
  const DESCRIPTION_META_RE =
    /[ \t]*<meta\s+name="description"\s+content="[^"]*"\s*\/?>(?:[ \t]*(?:\r?\n))?/gi;
  const CANONICAL_LINK_RE =
    /[ \t]*<link\b(?=[^>]*\brel="[^"]*\bcanonical\b[^"]*")[^>]*>(?:[ \t]*(?:\r?\n))?/gi;

  function renderSocialMetadata({ title, description, canonical, type }) {
    const image = `${origin}/logo-mark.svg`;
    return [
      `    ${SOCIAL_META_START}`,
      `    <link rel="canonical" href="${htmlAttr(canonical)}" />`,
      `    <meta property="og:title" content="${htmlAttr(title)}" />`,
      `    <meta property="og:description" content="${htmlAttr(description)}" />`,
      `    <meta property="og:url" content="${htmlAttr(canonical)}" />`,
      `    <meta property="og:type" content="${type}" />`,
      `    <meta property="og:site_name" content="Free AI Credits" />`,
      `    <meta property="og:image" content="${htmlAttr(image)}" />`,
      `    <meta name="twitter:card" content="summary_large_image" />`,
      `    <meta name="twitter:title" content="${htmlAttr(title)}" />`,
      `    <meta name="twitter:description" content="${htmlAttr(description)}" />`,
      `    <meta name="twitter:image" content="${htmlAttr(image)}" />`,
      `    ${SOCIAL_META_END}`,
    ].join("\n");
  }

  function renderHeadJsonLd({ page, canonical }) {
    // Task 3.6: satisfy audit_seo's head-or-body JSON-LD requirement without
    // duplicating the body BreadcrumbList that archive/privacy/detail already
    // emit via <Breadcrumbs>. Home has no breadcrumbs, so it needs a WebSite
    // block in <head> to reach 0 criticals on a filtered dist audit.
    if (page === "home") {
      const data = {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Free AI Credits",
        url: canonical,
      };
      return `    <script type="application/ld+json">${JSON.stringify(data)}</script>`;
    }
    return "";
  }

  function fillPage({ markup, title, description, canonical, depth = 0, page, slug }) {
    // All dynamic replacements go through replacer FUNCTIONS: offer copy
    // routinely contains "$15K"-style amounts, and a string replacement
    // would treat "$1" as a regex backreference and corrupt the text.
    let doc = template;
    // Strip any prior head WebSite JSON-LD so re-running prerender over an
    // already-prerendered dist is idempotent (matches routes.test.mjs
    // "does not duplicate metadata" expectation).
    doc = doc.replace(
      /\s*<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"WebSite".*?<\/script>\s*/g,
      "\n",
    );
    doc = doc.replace(/<title>.*?<\/title>/s, () => `<title>${htmlAttr(title)}</title>`);
    // Vite pretty-prints the shell meta tag across lines; match either form
    // so archive/privacy/detail get their own description (#132).
    let descriptionCount = 0;
    doc = doc.replace(DESCRIPTION_META_RE, () => {
      descriptionCount += 1;
      return descriptionCount === 1
        ? `    <meta name="description" content="${htmlAttr(description)}" />\n`
        : "";
    });
    if (descriptionCount === 0) {
      console.error("error: expected one description meta tag, found none");
      process.exit(1);
    }
    doc = doc.replace(CANONICAL_LINK_RE, "");
    const socialBlocks = doc.match(SOCIAL_META_RE) ?? [];
    if (socialBlocks.length !== 1) {
      console.error(
        `error: expected one social metadata block, found ${socialBlocks.length}`,
      );
      process.exit(1);
    }
    doc = doc.replace(SOCIAL_META_RE, () => {
      const social = renderSocialMetadata({
        title,
        description,
        canonical,
        type: page === "detail" ? "article" : "website",
      });
      const jsonLd = renderHeadJsonLd({ page, canonical });
      return jsonLd ? `${social}\n${jsonLd}` : social;
    });
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
      () => `<div id="root"${attrs}>${normalize(markup)}</div>`,
    );
  }

  const written = [];

  // Home (/) — replaces vite's own index.html with the hydrated listing.
  await writeFile(
    indexPath,
    fillPage({
      markup: await renderRoute({ page: "home" }, origin),
      title: "Free AI Credits",
      description:
        "Every currently-claimable free AI credit offer, labeled with review status, verification level, and sign-up need, on one fast page.",
      canonical: `${origin}/`,
      page: "home",
    }),
  );
  written.push("index.html");

  // Archive (/archive.html).
  await writeFile(
    path.join(distDir, "archive.html"),
    fillPage({
      markup: await renderRoute({ page: "archive" }, origin),
      title: "Offer Archive · Free AI Credits",
      description:
        "Reference archive of expired free AI credit offers, kept newest-first with their original terms.",
      canonical: `${origin}/archive.html`,
      page: "archive",
    }),
  );
  written.push("archive.html");

  // Privacy policy (/privacy.html).
  await writeFile(
    path.join(distDir, "privacy.html"),
    fillPage({
      markup: await renderRoute({ page: "privacy" }, origin),
      title: "Privacy Policy · Free AI Credits",
      description:
        "How the Free AI Credits site handles data: consent-gated anonymized analytics, no forms, no personal data storage.",
      canonical: `${origin}/privacy.html`,
      page: "privacy",
    }),
  );
  written.push("privacy.html");

  // One detail page per offer — active AND expired (#60), with summary /
  // claim steps / social proof when details.json has an entry (#128).
  // Unknown slugs can only come from stale links, which GitHub Pages
  // answers with its own 404; the graceful not-found state still ships
  // inside the app for hydration safety.
  const detailsSibling = path.join(path.dirname(dataFile), "details.json");
  const detailsFallback = path.join(here, "..", "src", "data", "details.json");
  const detailsPath = existsSync(detailsSibling) ? detailsSibling : detailsFallback;
  const details = existsSync(detailsPath)
    ? JSON.parse(await readFile(detailsPath, "utf8"))
    : {};
  const offersDir = path.join(distDir, "offers");
  await mkdir(offersDir, { recursive: true });
  const offerFileMtimes = new Map();
  for (const offer of index.offers) {
    const canonical = `${origin}/offers/${offer.slug}.html`;
    const offerPath = path.join(offersDir, `${offer.slug}.html`);
    await writeFile(
      offerPath,
      fillPage({
        markup: await renderRoute({ page: "detail", slug: offer.slug }, origin),
        title: `${offer.title} · Free AI Credits`,
        description: offerMetaDescription(offer, details[offer.slug]),
        canonical,
        depth: 1,
        page: "detail",
        slug: offer.slug,
      }),
    );
    offerFileMtimes.set(offer.slug, (await stat(offerPath)).mtime);
  }
  written.push(`offers/*.html (${index.offers.length})`);

  // RSS at the previous URL, absolute links off DEFAULT_BASE_URL (#27).
  await writeFile(path.join(distDir, "feed.xml"), buildFeed(index, baseUrl));
  written.push("feed.xml");

  // Sitemap covers every prerendered route, including expired offers (#205).
  await writeFile(
    path.join(distDir, "sitemap.xml"),
    buildSitemap(index, baseUrl, { fileMtimes: offerFileMtimes }),
  );
  written.push("sitemap.xml");

  const kb = (n) => (n / 1024).toFixed(1);
  console.log(
    `prerendered ${written.length + index.offers.length - 1} routes -> ` +
      `${written.join(", ")} (${kb(Buffer.byteLength(template))} KB shell)`,
  );
} finally {
  await rm(path.join(distDir, ".prerender"), { recursive: true, force: true });
}
