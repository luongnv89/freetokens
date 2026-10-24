/**
 * Shared clipboard write (build.py `_SHARE_JS` clipboard path, #128; reused
 * by the agent apply prompt, #625). Modern `navigator.clipboard.writeText`
 * first, then a hidden textarea + `execCommand("copy")` fallback for
 * browsers or contexts that lack or refuse the async API. Resolves true
 * when the text reached the clipboard. Never throws, and never reports
 * what was copied to analytics or anywhere else.
 */
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

export async function copyText(text: string): Promise<boolean> {
  const hasClipboard =
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function";
  if (hasClipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return copyLegacy(text);
    }
  }
  return copyLegacy(text);
}
