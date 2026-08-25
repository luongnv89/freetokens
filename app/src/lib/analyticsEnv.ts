/**
 * Build-time analytics env resolution. Mirrors scripts/build.py
 * resolve_measurement_id / resolve_stats_site so a typo never embeds a
 * tracker. Pure: no DOM, no network, safe to import from vite.config and
 * from prerender.
 */

/** Same pattern as scripts/build.py MEASUREMENT_ID_RE. */
export const MEASUREMENT_ID_RE = /^G-[A-Z0-9]{6,12}$/;

/** Same pattern as scripts/build.py STATS_SITE_RE. */
export const STATS_SITE_RE = /^https:\/\/[^\s"'<>]+$/;

/**
 * Return a valid GA4 measurement ID, or "" when analytics is disabled.
 * Unset/empty disables silently; malformed disables with an optional warning.
 */
export function resolveMeasurementId(
  raw: string | undefined | null,
  warn = false,
): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  if (!MEASUREMENT_ID_RE.test(value)) {
    if (warn) {
      console.warn(
        `warning: ignoring malformed GA_MEASUREMENT_ID=${JSON.stringify(value)} ` +
          "(expected G-XXXXXXXXXX); analytics disabled",
      );
    }
    return "";
  }
  return value;
}

/**
 * Return a normalized https GoatCounter origin, or "" when disabled.
 * Origin-only: the beacon and counter URLs append their own paths.
 */
export function resolveStatsSite(
  raw: string | undefined | null,
  warn = false,
): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return "";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    if (warn) {
      console.warn(
        `warning: ignoring malformed GOATCOUNTER_SITE_URL=${JSON.stringify(raw)} ` +
          "(expected an https:// origin); traffic stats disabled",
      );
    }
    return "";
  }
  const origin = `${parsed.protocol}//${parsed.host}`;
  if (
    parsed.protocol !== "https:" ||
    !parsed.host ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    !STATS_SITE_RE.test(origin)
  ) {
    if (warn) {
      console.warn(
        `warning: ignoring malformed GOATCOUNTER_SITE_URL=${JSON.stringify(raw)} ` +
          "(expected an https:// origin); traffic stats disabled",
      );
    }
    return "";
  }
  return origin;
}
