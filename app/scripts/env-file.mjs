import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Read `app/.env` into a plain record.
 *
 * Vite only exposes `VITE_`-prefixed vars, and only on `import.meta.env` —
 * it never populates `process.env` from a dotenv file. Both `vite.config.ts`
 * and `scripts/prerender.mjs` read the analytics secrets off `process.env`
 * (the shape deploy.yml injects), so without this a developer who filled in
 * `app/.env` still built a site with GA and GoatCounter silently disabled and
 * no traffic markup in the HTML at all.
 *
 * Parsing is deliberately minimal — `KEY=value`, `#` comments, blank lines,
 * optional matched surrounding quotes. It is a local developer convenience,
 * not a dotenv implementation: no interpolation, no multi-line values, no
 * `export` prefix. Anything more belongs in a real env var.
 *
 * A missing file is the normal case in CI and returns `{}`.
 */
export function readEnvFile(dir) {
  let raw;
  try {
    raw = readFileSync(path.join(dir, ".env"), "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    const quote = value[0];
    if (
      (quote === '"' || quote === "'") &&
      value.endsWith(quote) &&
      value.length > 1
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * The build-time value for `key`, with the real environment winning.
 *
 * Precedence matters: deploy.yml injects the production secrets as real env
 * vars, and a stale `app/.env` committed to a developer's machine must never
 * shadow them. The file is the fallback, never the override.
 */
export function envValue(key, dir, env = process.env) {
  const live = env[key];
  if (live != null && live !== "") return live;
  return readEnvFile(dir)[key];
}
