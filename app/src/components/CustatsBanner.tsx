/**
 * Sibling-product banner for custats.info and free-llm-models.custats.info
 * (issue #257).
 * Site-wide pointer from the free-credits audience (hunting free AI credits
 * implies tracking AI spend, and credits pair with free models) to the
 * team's AI usage tracking tool and free-model directory.
 * Must read as a sibling-product nudge, not an ad, and must never compete
 * with the offer list for attention — muted mono styling, small, hairline
 * border, centered text.
 */
export function CustatsBanner() {
  return (
    <aside
      className="custats-banner"
      aria-label="Sibling products: custats and free LLM models"
    >
      <p className="custats-banner__inner">
        <span className="custats-banner__kicker" aria-hidden="true">
          Sibling products
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
        <span aria-hidden="true" className="custats-banner__sep">
          {" "}
          ·{" "}
        </span>
        <strong>free LLM models</strong> — a free AI model directory —{" "}
        <a
          href="https://free-llm-models.custats.info"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Visit free-llm-models.custats.info — free AI model directory"
        >
          free-llm-models.custats.info
        </a>
      </p>
    </aside>
  );
}
