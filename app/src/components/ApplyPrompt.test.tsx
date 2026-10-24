import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApplyPrompt } from "./ApplyPrompt";
import {
  bindAnalyticsListeners,
  configureAnalytics,
  grantConsent,
  resetAnalyticsForTests,
} from "../lib/analytics";
import type { Offer } from "../lib/offers";
import { PROFILE_KEY, SCHEMA_VERSION } from "../lib/personalState";

const URL = "https://example.test/freetokens/offers/example-offer.html";

const OFFER: Offer = {
  slug: "example-offer",
  title: "Example Offer",
  provider: "Example Co",
  category: "coding",
  amount: "$10 credits",
  expiry_date: null,
  source_url: "https://example.com/offer",
  verified_date: "2026-08-01",
  verification: "social_proof",
  review_status: "unverified",
  signup: "required",
  status: "active",
};

function makeLocalStorage(opts?: { throwOnAccess?: boolean }) {
  const store: Record<string, string> = {};
  const guard = () => {
    if (opts?.throwOnAccess) {
      throw new DOMException("Access denied", "SecurityError");
    }
  };
  return {
    getItem: (key: string) => {
      guard();
      return key in store ? store[key] : null;
    },
    setItem: (key: string, value: string) => {
      guard();
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      guard();
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
}

function installStorage(impl: ReturnType<typeof makeLocalStorage>) {
  Object.defineProperty(window, "localStorage", {
    value: impl,
    configurable: true,
    writable: true,
  });
}

function installClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

function renderPanel() {
  return render(<ApplyPrompt offer={OFFER} offerUrl={URL} />);
}

function promptBox(): HTMLTextAreaElement {
  return screen.getByLabelText(/^Prompt/) as HTMLTextAreaElement;
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

beforeEach(() => {
  installStorage(makeLocalStorage());
  resetAnalyticsForTests();
});

afterEach(() => {
  resetAnalyticsForTests();
  vi.restoreAllMocks();
});

describe("ApplyPrompt (#625)", () => {
  it("prerenders the placeholder prompt with the #apply-prompt anchor", () => {
    const markup = renderToStaticMarkup(
      <ApplyPrompt offer={OFFER} offerUrl={URL} />,
    );
    expect(markup).toContain('id="apply-prompt"');
    expect(markup).toContain("[YOUR FULL NAME]");
    expect(markup).toContain("https://example.com/offer");
    // Never a <form>: JS-off submission would put details in the URL.
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("data-ft-");
  });

  it("without a profile shows placeholders and a nudge, and copy still works", async () => {
    const writeText = installClipboard();
    renderPanel();
    expect(screen.getByText(/No details saved/)).toBeInTheDocument();
    expect(promptBox().value).toContain("[YOUR EMAIL]");
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(promptBox().value);
      expect(screen.getByText(/Prompt copied/)).toBeInTheDocument();
    });
  });

  it("creates a profile that fills the prompt and survives a remount", async () => {
    const { unmount } = renderPanel();
    fireEvent.change(field("Full name"), { target: { value: "Ada Lovelace" } });
    fireEvent.change(field("Email"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(
      JSON.parse(window.localStorage.getItem(PROFILE_KEY) as string),
    ).toMatchObject({ v: SCHEMA_VERSION, name: "Ada Lovelace" });
    expect(promptBox().value).toContain("- Full name: Ada Lovelace");
    expect(promptBox().value).not.toContain("[YOUR FULL NAME]");
    unmount();

    renderPanel();
    await waitFor(() => {
      expect(promptBox().value).toContain("- Email: ada@example.com");
    });
    expect(field("Full name").value).toBe("Ada Lovelace");
    expect(screen.queryByText(/No details saved/)).toBeNull();
  });

  it("edits and deletes the saved profile", async () => {
    window.localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ v: SCHEMA_VERSION, name: "Ada Lovelace" }),
    );
    renderPanel();
    await waitFor(() => expect(field("Full name").value).toBe("Ada Lovelace"));

    fireEvent.change(field("Full name"), { target: { value: "Grace Hopper" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(promptBox().value).toContain("- Full name: Grace Hopper");

    fireEvent.click(screen.getByRole("button", { name: "Delete details" }));
    expect(window.localStorage.getItem(PROFILE_KEY)).toBeNull();
    expect(field("Full name").value).toBe("");
    expect(promptBox().value).toContain("[YOUR FULL NAME]");
    expect(screen.getByText(/deleted from this browser/)).toBeInTheDocument();
    // Delete unmounts itself; focus lands on Save details, not <body>.
    expect(screen.queryByRole("button", { name: "Delete details" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Save details" }),
    );
  });

  it("saving an all-blank form over a saved profile says it was deleted", async () => {
    window.localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ v: SCHEMA_VERSION, name: "Ada Lovelace" }),
    );
    renderPanel();
    await waitFor(() => expect(field("Full name").value).toBe("Ada Lovelace"));
    fireEvent.change(field("Full name"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(window.localStorage.getItem(PROFILE_KEY)).toBeNull();
    expect(screen.getByText(/deleted from this browser/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing to save/)).toBeNull();
  });

  it("saving an all-blank form with nothing saved says nothing to save", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(screen.getByText(/Nothing to save/)).toBeInTheDocument();
  });

  it("copies exactly the edited prompt text, and Undo restores the generated one", async () => {
    const writeText = installClipboard();
    renderPanel();
    const generated = promptBox().value;
    const edited = `${generated}\nAlso mention I am a student.`;
    fireEvent.change(promptBox(), { target: { value: edited } });
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(edited));

    // Saving details keeps the visitor's edits rather than clobbering them.
    fireEvent.change(field("Full name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(promptBox().value).toBe(edited);

    fireEvent.click(screen.getByRole("button", { name: "Undo my edits" }));
    // Undo unmounts itself; focus moves to the prompt box, not <body>.
    expect(screen.queryByRole("button", { name: "Undo my edits" })).toBeNull();
    expect(document.activeElement).toBe(promptBox());
    expect(promptBox().value).toContain("- Full name: Ada");
    expect(promptBox().value).not.toContain("Also mention I am a student.");
  });

  it("announces a copy failure when no clipboard path works", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    document.execCommand = vi.fn().mockReturnValue(false);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    await waitFor(() => {
      expect(screen.getByText(/Copy failed/)).toBeInTheDocument();
    });
  });

  it("keeps working for this page when storage is blocked", () => {
    installStorage(makeLocalStorage({ throwOnAccess: true }));
    renderPanel();
    fireEvent.change(field("Full name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(promptBox().value).toContain("- Full name: Ada");
    expect(screen.getByText(/blocks local storage/)).toBeInTheDocument();
  });

  it("sends nothing to analytics: no offer_click, no profile values", async () => {
    configureAnalytics({ measurementId: "G-ABCDEF12345" });
    const gtag = vi.fn();
    Object.defineProperty(window, "gtag", {
      value: gtag,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "dataLayer", {
      value: [],
      configurable: true,
      writable: true,
    });
    const count = vi.fn();
    Object.defineProperty(window, "goatcounter", {
      value: { count },
      configurable: true,
      writable: true,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    installClipboard();
    grantConsent();
    gtag.mockClear();
    bindAnalyticsListeners();

    renderPanel();
    fireEvent.change(field("Email"), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    await waitFor(() => screen.getByText(/Prompt copied/));
    fireEvent.click(screen.getByRole("button", { name: "Delete details" }));

    expect(gtag.mock.calls.filter((c) => c[1] === "offer_click")).toEqual([]);
    expect(JSON.stringify(gtag.mock.calls)).not.toContain("ada@example.com");
    expect(count).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
