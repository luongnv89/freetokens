import { useState } from "react";

function copyLegacy(text: string): boolean {
  if (typeof document === "undefined") return false;
  let ok = false;
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.left = "-9999px";
  document.body.appendChild(box);
  box.select();
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(box);
  return ok;
}

/**
 * Copy-only share control (build.py `_SHARE_JS` clipboard path).
 * Modern `navigator.clipboard.writeText` with a textarea+execCommand
 * fallback. Visible confirmation via a polite live region. No social
 * share links and no `offer_share` analytics (#128).
 */
export function CopyLinkButton({ url }: { url: string }) {
  const [status, setStatus] = useState("");

  function confirm(ok: boolean) {
    setStatus(
      ok ? "Link copied!" : "Copy failed — long-press the address bar instead.",
    );
  }

  function onCopy() {
    const hasClipboard =
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function";
    if (hasClipboard) {
      navigator.clipboard.writeText(url).then(
        () => confirm(true),
        () => confirm(copyLegacy(url)),
      );
      return;
    }
    confirm(copyLegacy(url));
  }

  return (
    <section className="od-share" aria-label="Copy link to this offer">
      <h2>Copy link</h2>
      <div className="share-actions">
        <button type="button" className="share-copy" onClick={onCopy}>
          Copy link
        </button>
      </div>
      <p
        className="share-status"
        id="ft-share-status"
        role="status"
        aria-live="polite"
        hidden={!status}
      >
        {status}
      </p>
    </section>
  );
}
