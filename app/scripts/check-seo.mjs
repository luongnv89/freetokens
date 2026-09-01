#!/usr/bin/env node
// CI guard (issue #209): fail when any prerendered dist/*.html lacks
// self-referencing canonical, complete Open Graph tags, or breadcrumb
// JSON-LD. Runs after `vite build` + `prerender` — naming file+field so a
// regression shows exactly which document lost its head metadata.
//
// Passes on green main; deliberately removing a canonical in a test branch
// exits non-zero with the affected file and field. Mirrors the headShape
// logic in app/tests/routes.test.mjs (canonical count, OG_PROPERTIES,
// JSON-LD BreadcrumbList) but as a fast post-build grep-style gate.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_BASE_URL = "https://freetokens.custats.info";
export const OG_PROPERTIES = ["og:title", "og:description", "og:url", "og:type", "og:site_name", "og:image"];

function headOf(html) {
  const end = html.indexOf("</head>");
  if (end < 0) throw new Error("document has no </head>");
  return html.slice(0, end);
}

function htmlAttr(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function metaContents(html, attribute, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    ...headOf(html).matchAll(
      new RegExp(`<meta\\s+${attribute}="${escapedName}"\\s+content="([^"]*)"\\s*/?>`, "g"),
    ),
  ].map((m) => m[1]);
}

function canonicalValues(html) {
  return [...headOf(html).matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?>(?:\s*)/g)].map((m) => m[1]);
}

function hasBreadcrumbJsonLd(html) {
  const marker = '<script type="application/ld+json">';
  let cursor = 0;
  while (true) {
    const start = html.indexOf(marker, cursor);
    if (start < 0) break;
    const end = html.indexOf("</script>", start);
    if (end < 0) break;
    try {
      const parsed = JSON.parse(html.slice(start + marker.length, end));
      if (parsed["@type"] === "BreadcrumbList") return true;
      // Also handle array of blocks
      if (Array.isArray(parsed) && parsed.some((p) => p["@type"] === "BreadcrumbList")) return true;
    } catch {
      // invalid JSON-LD counts as present but broken — caller will treat as missing
    }
    cursor = end + "</script>".length;
  }
  return false;
}

export function expectedCanonical(relativePath, baseUrl = DEFAULT_BASE_URL) {
  const origin = baseUrl.replace(/\/+$/, "");
  if (relativePath === "index.html") return `${origin}/`;
  return `${origin}/${relativePath}`;
}

export function collectIssues(html, relativePath, baseUrl = DEFAULT_BASE_URL) {
  const issues = [];
  const canon = canonicalValues(html);
  if (canon.length === 0) {
    issues.push(`${relativePath}: missing canonical`);
  } else if (canon.length !== 1) {
    issues.push(`${relativePath}: expected 1 canonical, found ${canon.length}`);
  } else {
    const expected = expectedCanonical(relativePath, baseUrl);
    if (canon[0] !== expected) {
      issues.push(`${relativePath}: canonical mismatch (expected ${expected} got ${canon[0]})`);
    }
    try {
      const url = new URL(canon[0]);
      if (!["http:", "https:"].includes(url.protocol) || !url.host) {
        issues.push(`${relativePath}: canonical href is not absolute: ${canon[0]}`);
      }
    } catch {
      issues.push(`${relativePath}: canonical href is not a valid URL: ${canon[0]}`);
    }
  }

  for (const prop of OG_PROPERTIES) {
    const vals = metaContents(html, "property", prop);
    if (vals.length === 0) {
      issues.push(`${relativePath}: missing ${prop}`);
    } else if (vals.length !== 1) {
      issues.push(`${relativePath}: expected 1 ${prop}, found ${vals.length}`);
    } else if (!vals[0].trim()) {
      issues.push(`${relativePath}: empty ${prop}`);
    }
  }

  // JSON-LD breadcrumb is required on every non-home HTML file.
  // Home (index.html) intentionally has no breadcrumbs (#208).
  const requiresJsonLd = relativePath !== "index.html";
  if (requiresJsonLd && !hasBreadcrumbJsonLd(html)) {
    issues.push(`${relativePath}: missing JSON-LD`);
  }

  return issues;
}

function collectHtmlFiles(distDir) {
  const files = [];
  // Top-level HTML files
  for (const entry of readdirSync(distDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(path.join(distDir, entry.name));
    }
  }
  // Nested HTML (e.g. offers/*.html)
  const offersDir = path.join(distDir, "offers");
  if (existsSync(offersDir)) {
    for (const entry of readdirSync(offersDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".html")) {
        files.push(path.join(offersDir, entry.name));
      }
    }
  }
  return files.sort();
}

export function checkDist(distDir, baseUrl = DEFAULT_BASE_URL) {
  if (!existsSync(distDir)) {
    return { ok: false, issues: [`dist directory not found: ${distDir}`], filesChecked: 0 };
  }
  const htmlFiles = collectHtmlFiles(distDir);
  if (htmlFiles.length === 0) {
    return { ok: false, issues: [`no HTML files found in: ${distDir}`], filesChecked: 0 };
  }
  const allIssues = [];
  for (const filePath of htmlFiles) {
    const relative = path.relative(distDir, filePath);
    let html;
    try {
      html = readFileSync(filePath, "utf8");
    } catch (e) {
      allIssues.push(`${relative}: cannot read file (${e.message})`);
      continue;
    }
    try {
      allIssues.push(...collectIssues(html, relative, baseUrl));
    } catch (e) {
      allIssues.push(`${relative}: cannot parse head (${e.message})`);
    }
  }
  return { ok: allIssues.length === 0, issues: allIssues, filesChecked: htmlFiles.length };
}

// CLI entry
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  let distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
  let baseUrl = DEFAULT_BASE_URL;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--dist" && process.argv[i + 1]) distDir = path.resolve(process.argv[++i]);
    else if (process.argv[i] === "--base-url" && process.argv[i + 1]) baseUrl = process.argv[++i];
  }
  // Allow env override consistent with prerender
  if (process.env.CHECK_SEO_BASE_URL) baseUrl = process.env.CHECK_SEO_BASE_URL;

  const result = checkDist(distDir, baseUrl);
  if (result.ok) {
    console.log(`SEO heads OK — ${result.filesChecked} HTML files checked`);
  } else {
    for (const issue of result.issues) {
      console.error(issue);
    }
    console.error(`SEO heads failed — ${result.issues.length} issue(s) in ${result.filesChecked} files`);
    process.exit(1);
  }
}
