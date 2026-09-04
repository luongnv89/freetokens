import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISMISSED_KEY,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  GA_CONSENT_KEY,
  IMPORT_MAX_LENGTH,
  PREFS_KEY,
  SAVED_KEY,
  SCHEMA_VERSION,
  claimSlugsInStorage,
  claimStorageKey,
  clearAllPersonalState,
  clearClaimProgress,
  clearDismissedSlugs,
  exportPersonalState,
  importPersonalState,
  readClaimProgress,
  readDismissedSlugs,
  readGaConsent,
  readPrefs,
  readSavedSlugs,
  writeClaimProgress,
  writeDismissedSlugs,
  writeGaConsent,
  writePrefs,
  writeSavedSlugs,
} from "../src/lib/personalState";

// The four hostile failure modes the issue requires us to simulate:
// 1. unavailable storage (SSR/prerender, missing localStorage)
// 2. disabled storage (private mode / SecurityError on access)
// 3. quota-exceeded storage (setItem throws QuotaExceededError)
// 4. corrupted JSON in stored values

type LS = Record<string, string>;

function makeLocalStorage(opts?: {
  throwOnAccess?: boolean;
  throwOnSet?: boolean;
}) {
  const store: LS = {};
  const impl = {
    getItem: vi.fn((key: string) => {
      if (opts?.throwOnAccess) {
        throw new DOMException("Access denied", "SecurityError");
      }
      return key in store ? store[key] : null;
    }),
    setItem: vi.fn((key: string, value: string) => {
      if (opts?.throwOnSet) {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      if (opts?.throwOnAccess) {
        throw new DOMException("Access denied", "SecurityError");
      }
      store[key] = String(value);
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(store)) delete store[k];
    }),
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    get length() {
      return Object.keys(store).length;
    },
  };
  return { impl, store };
}

function installStorage(mock: ReturnType<typeof makeLocalStorage>["impl"]) {
  Object.defineProperty(window, "localStorage", {
    value: mock,
    configurable: true,
    writable: true,
  });
}

const SLUG = "openai-free-credits";
const KEY = claimStorageKey(SLUG);

beforeEach(() => {
  installStorage(makeLocalStorage().impl);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GA consent (legacy ft_ga_consent compatibility)", () => {
  it("reads legacy bare-word values unchanged", () => {
    window.localStorage.setItem(GA_CONSENT_KEY, "granted");
    expect(readGaConsent()).toBe("granted");

    window.localStorage.setItem(GA_CONSENT_KEY, "denied");
    expect(readGaConsent()).toBe("denied");
  });

  it("writes the legacy bare-word format so old site code still parses it", () => {
    writeGaConsent("granted");
    expect(window.localStorage.getItem(GA_CONSENT_KEY)).toBe("granted");
    writeGaConsent("denied");
    expect(window.localStorage.getItem(GA_CONSENT_KEY)).toBe("denied");
  });

  it("returns null for unset or invalid consent values", () => {
    expect(readGaConsent()).toBeNull();
    window.localStorage.setItem(GA_CONSENT_KEY, "yes-please");
    expect(readGaConsent()).toBeNull();
    // Corrupted JSON must not throw either.
    window.localStorage.setItem(GA_CONSENT_KEY, "{not json");
    expect(readGaConsent()).toBeNull();
  });

  it("rejects invalid values at the type level via runtime check", () => {
    // writeGaConsent only accepts "granted" | "denied" per its signature.
    expect(writeGaConsent("granted")).toBe(true);
  });
});

describe("claim progress (legacy ft-claim-<slug> compatibility)", () => {
  it("reads legacy bare-array values unchanged", () => {
    window.localStorage.setItem(KEY, JSON.stringify([0, 2]));
    expect(readClaimProgress(SLUG)).toEqual([0, 2]);
  });

  it("round-trips through the versioned envelope", () => {
    expect(writeClaimProgress(SLUG, [3, 1])).toBe(true);
    const raw: unknown = JSON.parse(window.localStorage.getItem(KEY) as string);
    expect(raw).toEqual({ v: SCHEMA_VERSION, done: [1, 3] });
    expect(readClaimProgress(SLUG)).toEqual([1, 3]);
  });

  it("normalizes duplicates and negatives", () => {
    writeClaimProgress(SLUG, [2, 2, -1, 0]);
    expect(readClaimProgress(SLUG)).toEqual([0, 2]);
  });

  it("returns [] when unset", () => {
    expect(readClaimProgress(SLUG)).toEqual([]);
  });
});

describe("failure mode 1: unavailable storage (SSR/prerender)", () => {
  it("degrades to defaults with no thrown error", () => {
    installStorage(makeLocalStorage().impl);
    // Simulate no window/localStorage at all.
    Object.defineProperty(window, "localStorage", {
      get() {
        return undefined;
      },
      configurable: true,
    });
    expect(readGaConsent()).toBeNull();
    expect(readClaimProgress(SLUG)).toEqual([]);
    expect(writeGaConsent("granted")).toBe(false);
    expect(writeClaimProgress(SLUG, [0])).toBe(false);
    expect(clearClaimProgress(SLUG)).toBeUndefined();
    expect(clearAllPersonalState([SLUG])).toBeUndefined();
  });

  it("works with typeof window === 'undefined' code path", async () => {
    vi.resetModules();
    const originalWindow = globalThis.window;
    // @ts-expect-error simulating SSR
    delete globalThis.window;
    try {
      const mod = await import("../src/lib/personalState");
      expect(mod.readGaConsent()).toBeNull();
      expect(mod.readClaimProgress(SLUG)).toEqual([]);
      expect(mod.writeGaConsent("granted")).toBe(false);
    } finally {
      globalThis.window = originalWindow;
    }
  });
});

describe("failure mode 2: disabled storage (SecurityError on access)", () => {
  it("degrades to defaults with no thrown error", () => {
    installStorage(makeLocalStorage({ throwOnAccess: true }).impl);
    expect(readGaConsent()).toBeNull();
    expect(readClaimProgress(SLUG)).toEqual([]);
    expect(writeGaConsent("granted")).toBe(false);
    expect(writeClaimProgress(SLUG, [0])).toBe(false);
    expect(clearClaimProgress(SLUG)).toBeUndefined();
    expect(clearAllPersonalState([SLUG])).toBeUndefined();
  });

  it("localStorage property access itself throwing also degrades", () => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("denied", "SecurityError");
      },
      configurable: true,
    });
    expect(() => readGaConsent()).not.toThrow();
    expect(readGaConsent()).toBeNull();
    expect(writeGaConsent("granted")).toBe(false);
  });
});

describe("failure mode 3: quota-exceeded writes", () => {
  it("write calls return false and reads keep working, no throw", () => {
    installStorage(makeLocalStorage({ throwOnSet: true }).impl);
    expect(writeGaConsent("granted")).toBe(false);
    expect(writeClaimProgress(SLUG, [0])).toBe(false);
    expect(readGaConsent()).toBeNull();
    expect(readClaimProgress(SLUG)).toEqual([]);
  });
});

describe("failure mode 4: corrupted JSON", () => {
  it.each([
    "{broken",
    '"just a string"',
    "42",
    "null",
    '{"v": 1}', // envelope missing done
    '{"v": 999, "done": [1]}', // unknown future schema version
    '["zero", {}]', // array with non-number entries
  ])("corrupt payload %j degrades to defaults without throwing", (bad) => {
    window.localStorage.setItem(KEY, bad);
    expect(readClaimProgress(SLUG)).toEqual([]);
  });

  it("unknown future schema version is treated as empty, not an error", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 99, done: [5] }));
    expect(readClaimProgress(SLUG)).toEqual([]);
  });
});

describe("schema versioning & migration path", () => {
  it("new writes carry the current schema version", () => {
    writeClaimProgress(SLUG, [1]);
    const rec = JSON.parse(window.localStorage.getItem(KEY) as string);
    expect(rec.v).toBe(SCHEMA_VERSION);
  });

  it("SCHEMA_VERSION starts at 1 and legacy (unversioned) data still reads", () => {
    expect(SCHEMA_VERSION).toBe(1);
    window.localStorage.setItem(KEY, "[0]");
    expect(readClaimProgress(SLUG)).toEqual([0]);
  });
});

describe("saved shortlist (issue #140)", () => {
  it("round-trips through the versioned envelope", () => {
    expect(readSavedSlugs()).toEqual([]);
    expect(writeSavedSlugs(["alpha", "beta"])).toBe(true);
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(SAVED_KEY) as string,
    );
    expect(raw).toEqual({ v: SCHEMA_VERSION, slugs: ["alpha", "beta"] });
    expect(readSavedSlugs()).toEqual(["alpha", "beta"]);
  });

  it("normalizes duplicates, blanks, and oversized entries", () => {
    writeSavedSlugs([
      "alpha",
      "  ",
      "alpha",
      "  beta  ".trim(),
      "x".repeat(500),
    ]);
    const saved = readSavedSlugs();
    expect(saved).toContain("alpha");
    expect(saved.every((s) => s.length <= 128)).toBe(true);
    expect(new Set(saved).size).toBe(saved.length);
  });

  it("corrupted payloads degrade to [] without throwing", () => {
    for (const bad of [
      "{broken",
      '"just a string"',
      "42",
      "null",
      '["bare-legacy-array"]', // no envelope: not a saved record
      '{"v": 1}', // missing slugs
      '{"v": 999, "slugs": ["a"]}', // unknown future schema
      '{"v": 1, "slugs": ["a", 42, null]}', // non-string entries filtered
    ]) {
      window.localStorage.setItem(SAVED_KEY, bad);
      expect(() => readSavedSlugs()).not.toThrow();
      if (bad === '{"v": 999, "slugs": ["a"]}') {
        expect(readSavedSlugs()).toEqual([]);
      }
    }
    window.localStorage.setItem(
      SAVED_KEY,
      '{"v": 1, "slugs": ["a", 42, null]}',
    );
    expect(readSavedSlugs()).toEqual(["a"]);
  });
});

describe("dismissed list (issue #140)", () => {
  it("round-trips and clears with one call", () => {
    expect(writeDismissedSlugs(["gamma"])).toBe(true);
    expect(readDismissedSlugs()).toEqual(["gamma"]);
    clearDismissedSlugs();
    expect(readDismissedSlugs()).toEqual([]);
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBeNull();
  });

  it("degrades to [] on hostile storage like every other reader", () => {
    installStorage(makeLocalStorage({ throwOnAccess: true }).impl);
    expect(readDismissedSlugs()).toEqual([]);
    expect(writeDismissedSlugs(["x"])).toBe(false);
    expect(clearDismissedSlugs()).toBeUndefined();
  });
});

describe("last-used prefs (issue #140)", () => {
  it("round-trips through the versioned envelope", () => {
    expect(readPrefs()).toBeNull();
    expect(
      writePrefs({
        category: "coding",
        sort: "amount",
        verification: "",
        signup: "none",
      }),
    ).toBe(true);
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(PREFS_KEY) as string,
    );
    expect(raw).toMatchObject({
      v: SCHEMA_VERSION,
      category: "coding",
      sort: "amount",
    });
    expect(readPrefs()).toEqual({
      v: SCHEMA_VERSION,
      category: "coding",
      verification: "",
      signup: "none",
      sort: "amount",
    });
  });

  it("missing fields store as empty defaults; hostile data degrades to null", () => {
    writePrefs({ sort: "expiring" });
    expect(readPrefs()).toEqual({
      v: SCHEMA_VERSION,
      category: "",
      verification: "",
      signup: "",
      sort: "expiring",
    });
    for (const bad of [
      "{broken",
      '"s"',
      "42",
      "null",
      '{"v": 2, "sort": "x"}',
    ]) {
      window.localStorage.setItem(PREFS_KEY, bad);
      expect(readPrefs()).toBeNull();
    }
  });
});

describe("clearAllPersonalState covers the issue #140 keys", () => {
  it("wipes saved, dismissed, and prefs alongside consent and claims", () => {
    writeGaConsent("granted");
    writeClaimProgress(SLUG, [0]);
    writeSavedSlugs(["alpha"]);
    writeDismissedSlugs(["beta"]);
    writePrefs({ sort: "amount" });
    clearAllPersonalState([SLUG]);
    expect(window.localStorage.getItem(GA_CONSENT_KEY)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem(SAVED_KEY)).toBeNull();
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBeNull();
    expect(window.localStorage.getItem(PREFS_KEY)).toBeNull();
    expect(readSavedSlugs()).toEqual([]);
    expect(readDismissedSlugs()).toEqual([]);
    expect(readPrefs()).toBeNull();
  });
});

describe("claimSlugsInStorage (issue #141)", () => {
  it("enumerates only ft-claim-<slug> keys", () => {
    writeClaimProgress("alpha", [0]);
    writeClaimProgress("beta", []);
    window.localStorage.setItem(SAVED_KEY, '{"v":1,"slugs":["x"]}');
    expect(claimSlugsInStorage()).toEqual(["alpha", "beta"]);
  });

  it("returns [] on hostile storage without throwing", () => {
    installStorage(makeLocalStorage({ throwOnAccess: true }).impl);
    expect(claimSlugsInStorage()).toEqual([]);
  });
});

describe("exportPersonalState / importPersonalState (issue #141)", () => {
  function seedAll() {
    writeGaConsent("granted");
    writeSavedSlugs(["alpha", "beta"]);
    writeDismissedSlugs(["gamma"]);
    writePrefs({ category: "coding", sort: "amount" });
    writeClaimProgress(SLUG, [2, 0]);
  }

  function snapshot(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(exportPersonalState())) as Record<
      string,
      unknown
    >;
  }

  it("export carries the format envelope and every personal-state key", () => {
    seedAll();
    const data = exportPersonalState();
    expect(data.format).toBe(EXPORT_FORMAT);
    expect(data.version).toBe(EXPORT_VERSION);
    expect(data.consent).toBe("granted");
    expect(data.saved).toEqual(["alpha", "beta"]);
    expect(data.dismissed).toEqual(["gamma"]);
    expect(data.prefs).toMatchObject({ category: "coding", sort: "amount" });
    expect(data.claims).toEqual({ [SLUG]: [0, 2] });
    expect(new Date(data.exported_at).toString()).not.toBe("Invalid Date");
  });

  it("round-trip: export → wipe → import restores all three groups plus consent", () => {
    seedAll();
    const data = exportPersonalState();
    clearAllPersonalState(claimSlugsInStorage());
    expect(readSavedSlugs()).toEqual([]);
    expect(readDismissedSlugs()).toEqual([]);
    expect(readPrefs()).toBeNull();
    expect(readGaConsent()).toBeNull();
    expect(readClaimProgress(SLUG)).toEqual([]);

    const result = importPersonalState(JSON.stringify(data));
    expect(result).toEqual({
      ok: true,
      saved: 2,
      dismissed: 1,
      claims: 1,
    });
    expect(readGaConsent()).toBe("granted");
    expect(readSavedSlugs()).toEqual(["alpha", "beta"]);
    expect(readDismissedSlugs()).toEqual(["gamma"]);
    expect(readPrefs()).toMatchObject({ category: "coding", sort: "amount" });
    expect(readClaimProgress(SLUG)).toEqual([0, 2]);
  });

  it.each([
    ["not JSON at all", "{broken"],
    ["a bare string", '"just a string"'],
    ["a bare number", "42"],
    ["foreign JSON object", '{"hello": "world"}'],
    [
      "wrong format marker",
      JSON.stringify({ format: "other-app", version: 1 }),
    ],
    [
      "unknown future export version",
      JSON.stringify({ format: EXPORT_FORMAT, version: 99 }),
    ],
    [
      "invalid consent value",
      JSON.stringify({
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        consent: "yes-please",
      }),
    ],
    [
      "saved list with non-string entries",
      JSON.stringify({
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        saved: ["ok", 42],
      }),
    ],
    [
      "dismissed list not an array",
      JSON.stringify({
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        dismissed: "gamma",
      }),
    ],
    [
      "prefs with non-string fields",
      JSON.stringify({
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        prefs: { sort: 3 },
      }),
    ],
    [
      "claims value not an array of integers",
      JSON.stringify({
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        claims: { [SLUG]: ["zero"] },
      }),
    ],
    [
      "claims with negative step index",
      JSON.stringify({
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        claims: { [SLUG]: [-1] },
      }),
    ],
    [
      "oversized slug in claims",
      JSON.stringify({
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        claims: { ["x".repeat(500)]: [0] },
      }),
    ],
  ])("import rejects %s with no partial write", (_label, bad) => {
    seedAll();
    const before = { ...snapshot(), exported_at: null };
    const result = importPersonalState(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    // Nothing changed — rejection happens before any key is written.
    expect({ ...snapshot(), exported_at: null }).toEqual(before);
  });

  it("rejects payloads over the size cap before parsing", () => {
    const big = JSON.stringify({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      saved: ["x".repeat(IMPORT_MAX_LENGTH)],
    });
    expect(big.length).toBeGreaterThan(IMPORT_MAX_LENGTH);
    const result = importPersonalState(big);
    expect(result.ok).toBe(false);
    expect(readSavedSlugs()).toEqual([]);
  });

  it("missing optional fields import cleanly as empty state", () => {
    const result = importPersonalState(
      JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION }),
    );
    expect(result).toEqual({ ok: true, saved: 0, dismissed: 0, claims: 0 });
    expect(readSavedSlugs()).toEqual([]);
    expect(readGaConsent()).toBeNull();
  });

  it("already-parsed objects are accepted too (defensive re-validation)", () => {
    const result = importPersonalState({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      saved: ["alpha"],
    });
    expect(result.ok).toBe(true);
    expect(readSavedSlugs()).toEqual(["alpha"]);
  });

  it("degrades to ok:false on unavailable storage without throwing", () => {
    Object.defineProperty(window, "localStorage", {
      get() {
        return undefined;
      },
      configurable: true,
    });
    expect(
      importPersonalState('{"format":"freetokens-personal-state","version":1}')
        .ok,
    ).toBe(false);
    expect(() => exportPersonalState()).not.toThrow();
  });

  it("degrades to ok:false on disabled storage (SecurityError)", () => {
    installStorage(makeLocalStorage({ throwOnAccess: true }).impl);
    const result = importPersonalState(
      JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION }),
    );
    expect(result.ok).toBe(false);
    expect(() => exportPersonalState()).not.toThrow();
  });

  it("no network request is made during export or import", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("network use forbidden");
    });
    seedAll();
    exportPersonalState();
    importPersonalState(JSON.stringify(exportPersonalState()));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a crafted __proto__ claim key cannot reach Object.prototype", () => {
    window.localStorage.setItem(claimStorageKey("__proto__"), "[0]");
    const data = exportPersonalState();
    expect(Object.getPrototypeOf(data.claims)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(data, "claims")).toBe(true);
    expect(function () {
      JSON.stringify(data);
    }).not.toThrow();
    expect(Object.keys(data.claims)).toContain("__proto__");
  });
});

describe("privacy: personal state never leaves the browser", () => {
  it("no network request of any kind is made during reads or writes", () => {
    const networkSpies = [
      vi.spyOn(globalThis, "fetch").mockImplementation(() => {
        throw new Error("network use forbidden");
      }),
    ];
    const beacon = vi.fn(() => {
      throw new Error("beacon use forbidden");
    });
    const xhrOpen = vi.fn(() => {
      throw new Error("XHR use forbidden");
    });
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
    });
    // @ts-expect-error stubbing global XHR
    globalThis.XMLHttpRequest = class {
      open = xhrOpen;
    };

    window.localStorage.setItem(GA_CONSENT_KEY, "granted");
    window.localStorage.setItem(KEY, "[0,1]");

    readGaConsent();
    readClaimProgress(SLUG);
    writeGaConsent("granted");
    writeClaimProgress(SLUG, [2]);
    readSavedSlugs();
    readDismissedSlugs();
    readPrefs();
    writeSavedSlugs(["a"]);
    writeDismissedSlugs(["b"]);
    clearDismissedSlugs();
    writePrefs({ sort: "amount" });

    expect(networkSpies[0]).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();

    // Values never leak into the URL either.
    expect(window.location.href).not.toContain("granted");
    expect(window.location.search).toBe("");
  });
});
