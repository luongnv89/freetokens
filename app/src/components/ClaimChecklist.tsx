import { useEffect, useState } from "react";
import { readClaimProgress, writeClaimProgress } from "../lib/personalState";

/**
 * Checkable claim runbook (build.py `_claim_step_parts` + `_CHECKLIST_JS`).
 * Real checkboxes so ticking works with JS disabled; persistence and the
 * live progress readout are a hydrate-time enhancement via personalState,
 * honouring legacy `ft-claim-<slug>` bare arrays.
 */
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;

type StepPart = string | { href: string; text: string };

/** Split step text into plain segments and bare URLs, trimming
 * trailing punctuation and unbalanced closing parens out of the href. */
function splitStepLinks(text: string): StepPart[] {
  const parts: StepPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    let url = match[0];
    while (
      url.endsWith(")") &&
      (url.match(/\)/g) ?? []).length > (url.match(/\(/g) ?? []).length
    ) {
      url = url.slice(0, -1);
    }
    url = url.replace(/[.,;:!?]+$/, "");
    if (!url) continue;
    const start = match.index ?? 0;
    const end = start + url.length;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push({ href: url, text: url });
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function ClaimChecklist({
  slug,
  steps,
}: {
  slug: string;
  steps: readonly string[];
}) {
  const [done, setDone] = useState<number[]>([]);
  const total = steps.length;
  const completed = done.filter((i) => i >= 0 && i < total).length;
  const key = slug || "offer";

  useEffect(() => {
    setDone(readClaimProgress(slug));
  }, [slug]);

  function toggle(index: number) {
    setDone((prev) => {
      const next = prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index];
      writeClaimProgress(slug, next);
      return next;
    });
  }

  const readout =
    completed === 0 ? `${total}-step guide` : `${completed}/${total} done`;

  return (
    <section className="od-steps" data-ft-checklist>
      <header className="od-steps-head">
        <h2>How to claim</h2>
        <p className="steps-progress">
          <span
            className="progress-readout"
            id="ft-progress-readout"
            role="status"
            aria-live="polite"
          >
            {readout}
          </span>
          <span className="progress-track" aria-hidden="true">
            <span
              className="progress-fill"
              style={{ transform: `scaleX(${total ? completed / total : 0})` }}
            ></span>
          </span>
        </p>
      </header>
      <ol className="claim-list" role="list">
        {steps.map((step, i) => (
          <li className="claim-step" key={i}>
            <input
              type="checkbox"
              id={`ft-step-${key}-${i + 1}`}
              checked={done.includes(i)}
              onChange={() => toggle(i)}
            />
            <label htmlFor={`ft-step-${key}-${i + 1}`}>
              <span className="step-num" aria-hidden="true">
                <span className="num">{i + 1}</span>
                <span className="tick">&#10003;</span>
              </span>
              <span className="step-text">
                {splitStepLinks(step).map((part, j) =>
                  typeof part === "string" ? (
                    part
                  ) : (
                    <a
                      key={j}
                      href={part.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {part.text}
                    </a>
                  ),
                )}
              </span>
            </label>
          </li>
        ))}
      </ol>
    </section>
  );
}
