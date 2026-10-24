import { useEffect, useMemo, useRef, useState } from "react";
import { PROFILE_LABELS, buildApplyPrompt } from "../lib/applyPrompt";
import { copyText } from "../lib/clipboard";
import type { OfferDetail } from "../lib/offerDetails";
import type { Offer } from "../lib/offers";
import {
  PROFILE_FIELDS,
  clearProfile,
  readProfile,
  writeProfile,
  type Profile,
  type ProfileField,
} from "../lib/personalState";

export const APPLY_PROMPT_ID = "apply-prompt";

const EMPTY_PROFILE = Object.fromEntries(
  PROFILE_FIELDS.map((field) => [field, ""]),
) as Profile;

/** Input type + browser autofill hint per field; notes is a textarea. */
const FIELD_INPUT: Record<
  Exclude<ProfileField, "notes">,
  { type: string; autoComplete: string }
> = {
  name: { type: "text", autoComplete: "name" },
  email: { type: "email", autoComplete: "email" },
  github: { type: "text", autoComplete: "off" },
  country: { type: "text", autoComplete: "country-name" },
  organization: { type: "text", autoComplete: "organization" },
  role: { type: "text", autoComplete: "organization-title" },
  website: { type: "url", autoComplete: "url" },
};

/**
 * "Apply with an AI agent" panel on the offer detail page (issue #625).
 *
 * The visitor's applicant profile lives only in this browser (`ft-profile`
 * via personalState) and is read after hydration, so the prerender ships the
 * placeholder prompt and the client swaps the saved values in — the same
 * SSR-safe pattern ClaimChecklist uses. The prompt is an editable textarea:
 * until the visitor types in it, it follows the profile; once edited, Copy
 * sends exactly what is in the box.
 *
 * Deliberately NOT a <form>: with JavaScript off, a form would submit the
 * typed details to the server in the URL. No element here carries data-ft-*
 * hooks, and nothing — profile or prompt — reaches analytics.
 */
export function ApplyPrompt({
  offer,
  detail,
  offerUrl,
}: {
  offer: Offer;
  detail?: OfferDetail;
  offerUrl: string;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<Profile>(EMPTY_PROFILE);
  const [edited, setEdited] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  // Delete and Undo unmount their own buttons; these refs give focus a
  // stable landing spot so keyboard users are not dropped to <body>.
  const saveRef = useRef<HTMLButtonElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const saved = readProfile();
    setProfile(saved);
    setDraft(saved ?? EMPTY_PROFILE);
  }, []);

  const generated = useMemo(
    () => buildApplyPrompt(offer, detail, profile, offerUrl),
    [offer, detail, profile, offerUrl],
  );
  const prompt = edited ?? generated;

  function onSave() {
    if (writeProfile(draft)) {
      const next = readProfile();
      setProfile(next);
      setProfileStatus(
        !next
          ? profile
            ? "Your details were deleted from this browser."
            : "Nothing to save: every field is empty."
          : edited !== null
            ? "Saved in this browser. Your edited prompt was kept; use Undo my edits to rebuild it with your details."
            : "Saved in this browser. The prompt below now uses your details.",
      );
      return;
    }
    // Storage blocked: keep the details for this page view only.
    const trimmed = Object.fromEntries(
      PROFILE_FIELDS.map((f) => [f, draft[f].trim()]),
    ) as Profile;
    const blank = PROFILE_FIELDS.every((f) => trimmed[f] === "");
    setProfile(blank ? null : trimmed);
    setProfileStatus(
      "This browser blocks local storage, so your details are used on this page only and will not be remembered.",
    );
  }

  function onDelete() {
    clearProfile();
    setProfile(null);
    setDraft(EMPTY_PROFILE);
    setProfileStatus("Your details were deleted from this browser.");
    saveRef.current?.focus();
  }

  function onUndo() {
    setEdited(null);
    promptRef.current?.focus();
  }

  function onCopy() {
    void copyText(prompt).then((ok) =>
      setCopyStatus(
        ok
          ? "Prompt copied. Paste it into your agent."
          : "Copy failed. Select the text in the box and copy it yourself.",
      ),
    );
  }

  return (
    <section
      className="ap-panel"
      id={APPLY_PROMPT_ID}
      aria-labelledby="ap-head"
    >
      <h2 id="ap-head">Apply with an AI agent</h2>
      <p className="ap-note">
        Copy a prompt for Claude Code, Codex, or any agent that can use a
        browser. It walks the agent through this offer one step at a time and
        makes it ask you before it submits, signs up, pays, or sends anything.
      </p>
      <details className="ap-profile">
        <summary>
          {profile ? "Edit your details" : "Add your details (optional)"}
        </summary>
        <p className="ap-note">
          Saved only in this browser, never sent to this site, analytics, or
          anyone else. Do not enter passwords, API keys, or payment details.
        </p>
        <div className="ap-fields">
          {PROFILE_FIELDS.map((field) => (
            <label
              key={field}
              className={field === "notes" ? "ap-wide" : undefined}
            >
              {PROFILE_LABELS[field]}
              {field === "notes" ? (
                <textarea
                  id={`ft-profile-${field}`}
                  rows={3}
                  value={draft[field]}
                  onChange={(e) =>
                    setDraft({ ...draft, [field]: e.target.value })
                  }
                />
              ) : (
                <input
                  id={`ft-profile-${field}`}
                  type={FIELD_INPUT[field].type}
                  autoComplete={FIELD_INPUT[field].autoComplete}
                  value={draft[field]}
                  onChange={(e) =>
                    setDraft({ ...draft, [field]: e.target.value })
                  }
                />
              )}
            </label>
          ))}
        </div>
        <div className="share-actions">
          <button
            ref={saveRef}
            type="button"
            className="share-copy"
            onClick={onSave}
          >
            Save details
          </button>
          {profile ? (
            <button type="button" className="share-copy" onClick={onDelete}>
              Delete details
            </button>
          ) : null}
        </div>
        <p
          className="share-status"
          role="status"
          aria-live="polite"
          hidden={!profileStatus}
        >
          {profileStatus}
        </p>
      </details>
      {profile ? null : (
        <p className="ap-note">
          No details saved, so the prompt has [PLACEHOLDERS]. Add your details
          above to fill them in, or edit the text below.
        </p>
      )}
      <label className="ap-label" htmlFor="ft-apply-prompt-text">
        Prompt (edit it before copying if you like)
      </label>
      <textarea
        ref={promptRef}
        id="ft-apply-prompt-text"
        className="ap-text"
        rows={14}
        spellCheck={false}
        value={prompt}
        onChange={(e) => setEdited(e.target.value)}
      />
      <div className="share-actions">
        <button type="button" className="share-copy" onClick={onCopy}>
          Copy prompt
        </button>
        {edited !== null ? (
          <button type="button" className="share-copy" onClick={onUndo}>
            Undo my edits
          </button>
        ) : null}
      </div>
      <p
        className="share-status"
        role="status"
        aria-live="polite"
        hidden={!copyStatus}
      >
        {copyStatus}
      </p>
    </section>
  );
}
