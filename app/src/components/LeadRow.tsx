import { humanDate, relativeDate } from "../lib/offers";
import { REASON_LABELS, leadHref, type Lead } from "../lib/leads";
import { UnverifiedLeadBadge } from "./Badge";

/**
 * One unverified lead as a ledger row (#660). Same skeleton and classes as
 * OfferRow — eyebrow, title, amount, quiet line, right rail — so a lead reads
 * exactly like an offer row, filled only with lead fields. Deliberately
 * absent: filter tag buttons (a lead has no category / evidence / sign-up
 * tags), Save / Hide, the apply prompt, and every data-ft-offer-* hook, so a
 * lead never enters the offer_click attribution data.
 */
export function LeadRow({
  lead,
  index,
  buildDay,
}: {
  lead: Lead;
  index: number;
  buildDay: string;
}) {
  const detailHref = leadHref(lead.slug);
  const sourceCount = lead.sources.length;
  return (
    // `style` first, like OfferRow (React emits attributes in prop order).
    <li style={{ "--i": index } as React.CSSProperties} data-lead={lead.slug}>
      <article
        className="card"
        id={`lead-${lead.slug}`}
        data-posted={lead.posted}
        data-checked={lead.last_seen}
      >
        <p className="row-eyebrow">
          <span className="r-prov">{lead.provider}</span>
          <UnverifiedLeadBadge />
        </p>
        <h2 className="card-title">
          <a href={detailHref} aria-label={`View details for ${lead.title}`}>
            {lead.title}
          </a>
        </h2>
        <p className="r-amount">{lead.amount_claimed ?? "Amount not stated"}</p>
        <p className="row-meta row-quiet">
          <span>{REASON_LABELS[lead.reason]}</span>
          <span className="sep" aria-hidden="true">
            &middot;
          </span>
          <span>
            {sourceCount} {sourceCount === 1 ? "source" : "sources"}
          </span>
        </p>
        <div className="row-rail">
          <span className="status">
            posted{" "}
            <time dateTime={lead.posted}>{humanDate(lead.posted)}</time>
          </span>
          <span className="r-vfd" title={`checked ${humanDate(lead.last_seen)}`}>
            checked{" "}
            <time dateTime={lead.last_seen}>
              {relativeDate(lead.last_seen, buildDay)}
            </time>
          </span>
          <span className="r-actions">
            <a
              className="r-details"
              href={detailHref}
              aria-label={`View details for ${lead.title}`}
            >
              Details
            </a>
          </span>
        </div>
      </article>
    </li>
  );
}
