import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { envValue, readEnvFile } from "../scripts/env-file.mjs";

/**
 * Regression cover for the bug this file exists to fix: `app/.env` held a real
 * GoatCounter URL, nothing loaded it into `process.env`, and every local build
 * shipped with traffic stats silently disabled while CI — which injects the
 * secrets directly — looked fine.
 */
function withEnvFile(contents) {
  const dir = mkdtempSync(path.join(tmpdir(), "ft-env-"));
  writeFileSync(path.join(dir, ".env"), contents);
  return dir;
}

describe("build-time .env loading", () => {
  it("reads KEY=value pairs, ignoring comments and blank lines", () => {
    const dir = withEnvFile(
      [
        "# GoatCounter stats site",
        "GOATCOUNTER_SITE_URL=https://example.goatcounter.com",
        "",
        "   ",
        "GA_MEASUREMENT_ID=G-ABC1234567",
        "# trailing comment",
      ].join("\n"),
    );
    expect(readEnvFile(dir)).toEqual({
      GOATCOUNTER_SITE_URL: "https://example.goatcounter.com",
      GA_MEASUREMENT_ID: "G-ABC1234567",
    });
  });

  it("strips matched surrounding quotes but never mismatched ones", () => {
    const dir = withEnvFile(
      ['A="quoted"', "B='single'", 'C="unbalanced', "D=bare"].join("\n"),
    );
    expect(readEnvFile(dir)).toEqual({
      A: "quoted",
      B: "single",
      C: '"unbalanced',
      D: "bare",
    });
  });

  it("skips malformed lines rather than inventing keys", () => {
    const dir = withEnvFile(
      ["novalue", "=orphan", "2BAD=x", "has space=y", "OK=z"].join("\n"),
    );
    expect(readEnvFile(dir)).toEqual({ OK: "z" });
  });

  it("returns an empty record when there is no .env — the CI case", () => {
    expect(readEnvFile(mkdtempSync(path.join(tmpdir(), "ft-noenv-")))).toEqual(
      {},
    );
  });

  it("lets the real environment win over the file", () => {
    const dir = withEnvFile(
      "GOATCOUNTER_SITE_URL=https://stale.goatcounter.com",
    );
    // deploy.yml injects the production secret as a real env var; a stale
    // checked-out .env must never shadow it.
    expect(
      envValue("GOATCOUNTER_SITE_URL", dir, {
        GOATCOUNTER_SITE_URL: "https://live.goatcounter.com",
      }),
    ).toBe("https://live.goatcounter.com");
  });

  it("falls back to the file when the variable is unset or empty", () => {
    const dir = withEnvFile(
      "GOATCOUNTER_SITE_URL=https://example.goatcounter.com",
    );
    expect(envValue("GOATCOUNTER_SITE_URL", dir, {})).toBe(
      "https://example.goatcounter.com",
    );
    expect(
      envValue("GOATCOUNTER_SITE_URL", dir, { GOATCOUNTER_SITE_URL: "" }),
    ).toBe("https://example.goatcounter.com");
  });

  it("returns undefined when neither source has the key", () => {
    const dir = withEnvFile("OTHER=1");
    expect(envValue("GOATCOUNTER_SITE_URL", dir, {})).toBeUndefined();
  });
});
