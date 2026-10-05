import {
  ENROLLMENT_DEADLINE_NOTE,
  LAST_CHECKED,
  TRUST_COMBINED_EXAMPLE,
  TRUST_SUMMARY,
  TRUST_VERB_MAP,
  trustDefinitions,
} from "../lib/offers";

export const TRUST_LEGEND_HEADING_ID = "trust-legend-head";

/**
 * The hover-free trust legend (issue #507, task T4).
 *
 * Review status and evidence level used to be explained only through `title`
 * attributes, so the words a reader had to disambiguate were the words they had
 * to hover to read — and the deployed metadata called the whole mixed directory
 * "verified" on top of that.
 *
 * The block has two tiers, both read from `scripts/trust-vocabulary.mjs` so the
 * site and the llms exports cannot drift apart:
 *
 *  - the always-visible tier: each axis with its question, each value with its
 *    one-clause meaning, and the reviewed + corroborated combination spelled
 *    out. No hover, no click, no JavaScript — the prerender ships it as text,
 *    so a touch reader and a screen reader get the same words a mouse reader
 *    does;
 *  - the exhaustive tier, behind one disclosure: the full definitions, the
 *    claim-attempt answer each value does or does not attest, the
 *    enrollment-deadline note and the four-verb map.
 *
 * The whole legend is a `<details open>`: it renders expanded (so nothing needs
 * an interaction to be read) and a reader who already knows the words can
 * collapse it to get to the offers. It was made collapsible after measuring the
 * open version at 375 CSS px, where it pushed the first offer roughly one and a
 * half screens down the page.
 *
 * No `title` attribute appears here on purpose: the explanation must survive
 * without a pointer, a touch hover or a screen reader's title-quirk handling.
 */
export function TrustLegend({ className }: { className?: string }) {
  const groups = trustDefinitions();
  return (
    <div
      className={
        className ? `policy trust-legend ${className}` : "policy trust-legend"
      }
    >
      <details open>
        <summary id={TRUST_LEGEND_HEADING_ID}>
          How to read these labels
        </summary>
        {groups.map((group) => (
          <section key={group.field}>
            <p className="trust-legend-axis">
              <strong>{group.name}</strong> &mdash; {group.question}
            </p>
            <ul className="trust-legend-values">
              {group.entries.map((entry) => (
                <li key={entry.value}>
                  <strong>{entry.label}</strong> &mdash; {entry.short}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="muted">{TRUST_COMBINED_EXAMPLE}</p>
        <details className="trust-legend-full">
          <summary>Full definitions and claim-attempt answers</summary>
          <p>{TRUST_SUMMARY}</p>
          {groups.map((group) => (
            <section key={group.field}>
              <p className="trust-legend-axis">
                <strong>{group.name}</strong> <code>{group.field}</code> &mdash;{" "}
                {group.question}
              </p>
              <ul className="trust-legend-values">
                {group.entries.map((entry) => (
                  <li key={entry.value}>
                    <strong>{entry.label}</strong> <code>{entry.value}</code>{" "}
                    &mdash; {entry.definition}
                    {entry.claim ? ` ${entry.claim}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p>
            <strong>{LAST_CHECKED.label}</strong> <code>last_checked</code>{" "}
            &mdash; {LAST_CHECKED.definition} {ENROLLMENT_DEADLINE_NOTE}
          </p>
          <p className="muted">{TRUST_VERB_MAP}</p>
        </details>
      </details>
    </div>
  );
}
