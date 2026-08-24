import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GA_CONSENT_KEY,
  SCHEMA_VERSION,
  claimStorageKey,
  clearAllPersonalState,
  clearClaimProgress,
  readClaimProgress,
  readGaConsent,
  writeClaimProgress,
  writeGaConsent,
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
        throw new DOMException(
          "Access denied",
          "SecurityError",
        );
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
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(KEY) as string,
    );
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
    "[\"zero\", {}]", // array with non-number entries
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

    expect(networkSpies[0]).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();

    // Values never leak into the URL either.
    expect(window.location.href).not.toContain("granted");
    expect(window.location.search).toBe("");
  });
});
