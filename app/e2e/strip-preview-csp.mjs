// Runs between `npm run build` and `vite preview` in playwright.config's
// webServer. The CSP meta's `upgrade-insecure-requests` is correct in
// production (HTTPS) but makes WebKit upgrade every subresource on the
// http://127.0.0.1 preview and TLS-fail — flakily, since interception of the
// upgraded requests is unreliable (#254). dist/ is a build artifact, so
// rewriting it here only affects the e2e preview.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../dist");

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) yield* htmlFiles(file);
    else if (entry.endsWith(".html")) yield file;
  }
}

for (const file of htmlFiles(DIST)) {
  const html = readFileSync(file, "utf8");
  const stripped = html.replace(/;?\s*upgrade-insecure-requests/g, "");
  if (stripped !== html) writeFileSync(file, stripped);
}
