/**
 * Sibling-product banner for custats.info (issue #257).
 * Site-wide pointer from the free-credits audience (hunting free AI credits
 * implies tracking AI spend) to the team's AI usage tracking tool.
 * Must read as a sibling-product nudge, not an ad, and must never compete
 * with the offer list for attention — muted mono styling, small, hairline
 * border, centered text.
 */
export function CustatsBanner() {
  return (
    <aside className="custats-banner" aria-label="Sibling product: custats">
      <p className="custats-banner__inner">
        <span className="custats-banner__kicker" aria-hidden="true">
          Sibling product
        </span>
        <span aria-hidden="true" className="custats-banner__sep">
          {" "}
          ·{" "}
        </span>
        <strong>custats</strong> — an AI usage tracking tool —{" "}
        <a
          href="https://custats.info"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Visit custats.info — custats AI usage tracking tool"
        >
          custats.info
        </a>
      </p>
    </aside>
  );
}
