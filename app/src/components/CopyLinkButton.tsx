import { useState } from "react";
import { copyText } from "../lib/clipboard";

/**
 * Copy-only share control (build.py `_SHARE_JS` clipboard path).
 * Modern `navigator.clipboard.writeText` with a textarea+execCommand
 * fallback (shared `copyText`, lib/clipboard.ts). Visible confirmation via
 * a polite live region. No social share links and no `offer_share`
 * analytics (#128).
 */
export function CopyLinkButton({ url }: { url: string }) {
  const [status, setStatus] = useState("");

  function confirm(ok: boolean) {
    setStatus(
      ok ? "Link copied!" : "Copy failed — long-press the address bar instead.",
    );
  }

  function onCopy() {
    void copyText(url).then(confirm);
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
