import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { OffersIndex } from "../lib/offers";
import type { UrlState } from "../lib/urlState";
import { hasDocumentModelContext } from "../lib/webmcp";
import type { OfferSearchRoot as OfferSearchRootType } from "./OfferSearchRoot";

// ui-sdk trial (#726): the ui-sdk runtime is fetched only where
// document.modelContext exists, and the swap waits for an effect so
// hydration sees the prerender. The module is loaded before the swap so the
// toolbar remounts once; focus and caret inside it are carried across.

const LABEL = "Search and filter offers";

type SavedFocus = {
  id: string;
  start: number | null;
  end: number | null;
  direction: "forward" | "backward" | "none" | null;
};

function saveFocus(container: HTMLElement | null): SavedFocus | null {
  const active = document.activeElement;
  if (!container || !(active instanceof HTMLElement) || !active.id) return null;
  if (!container.contains(active)) return null;
  const input = active instanceof HTMLInputElement ? active : null;
  let start: number | null = null;
  let end: number | null = null;
  let direction: SavedFocus["direction"] = null;
  try {
    start = input?.selectionStart ?? null;
    end = input?.selectionEnd ?? null;
    direction = input?.selectionDirection ?? null;
  } catch {
    // selection* throws on input types without a caret (e.g. checkbox).
  }
  return { id: active.id, start, end, direction };
}

function restoreFocus(saved: SavedFocus) {
  const el = document.getElementById(saved.id);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (el instanceof HTMLInputElement && saved.start !== null) {
    try {
      el.setSelectionRange(saved.start, saved.end ?? saved.start, saved.direction ?? undefined);
    } catch {
      // input type without a caret.
    }
  }
}

export function ToolbarRoot({
  index,
  state,
  children,
}: {
  index: OffersIndex;
  state: UrlState;
  children: ReactNode;
}) {
  const [Root, setRoot] = useState<typeof OfferSearchRootType | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const savedFocus = useRef<SavedFocus | null>(null);

  useEffect(() => {
    if (!hasDocumentModelContext()) return;
    let live = true;
    import("./OfferSearchRoot")
      .then((m) => {
        if (!live) return;
        savedFocus.current = saveFocus(sectionRef.current);
        setRoot(() => m.OfferSearchRoot);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (!Root || !savedFocus.current) return;
    restoreFocus(savedFocus.current);
    savedFocus.current = null;
  }, [Root]);

  if (!Root) {
    return (
      <section ref={sectionRef} className="toolbar" aria-label={LABEL}>
        {children}
      </section>
    );
  }
  return (
    <Root index={index} state={state} className="toolbar" aria-label={LABEL}>
      {children}
    </Root>
  );
}
