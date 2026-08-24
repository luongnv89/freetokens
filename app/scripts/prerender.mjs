#!/usr/bin/env node
// Prerender step (tasks.md Task 1.5, epic #114, issue #119): bundles the home
// page with esbuild (already in the tree via vite), renders it to static HTML
// with react-dom/server, and injects the markup into the `vite build` output
// so dist/index.html carries the full offer listing with zero client JS
// required.
//
// Chosen over vite-react-ssg and Vite built-in prerender for the POC because
// it adds no dependencies (ADR-002 supply-chain mitigation) while producing
// exactly the same static artifact. See ADR-002 addendum for the measured
// evidence behind the decision.
//
// Usage: node scripts/prerender.mjs [--dist dist] [--entry src/prerender/entry.tsx]

import { build } from "esbuild";
import { readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let distDir = path.join(here, "..", "dist");
let entry = path.join(here, "..", "src", "prerender", "entry.tsx");
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === "--dist") distDir = path.resolve(process.argv[++i]);
  else if (process.argv[i] === "--entry") entry = path.resolve(process.argv[++i]);
}

const outfile = path.join(distDir, ".prerender", "entry.cjs");
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  platform: "node",
  loader: { ".css": "empty" },
  logLevel: "silent",
});

try {
  const { renderHomeDocument } = await import(pathToFileURL(outfile).href);
  const html = await renderHomeDocument();
  const target = path.join(distDir, "index.html");
  if (!existsSync(target)) {
    console.error(`error: ${target} not found; run \`vite build\` first`);
    process.exit(1);
  }
  const template = await readFile(target, "utf8");
  // React SSR emits camelCase `dateTime`; normalize to the lowercase spelling
  // build.py ships for byte parity (HTML attribute names are case-insensitive,
  // but a rendered-HTML diff should not show phantom differences).
  const markup = html.replace(/<time dateTime=/g, "<time datetime=");
  const marker = '<div id="root"></div>';
  if (!template.includes(marker)) {
    console.error(`error: ${target} has no <div id="root"></div> mount point`);
    process.exit(1);
  }
  await writeFile(target, template.replace(marker, `<div id="root">${markup}</div>`));
  console.log(`prerendered home listing -> ${target} (${(html.length / 1024).toFixed(1)} KB markup)`);
} finally {
  await rm(path.join(distDir, ".prerender"), { recursive: true, force: true });
}
