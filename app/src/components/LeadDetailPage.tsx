import { humanDate } from "../lib/offers";
import {
  REASON_LABELS,
  sourceLabel,
  type Lead,
  type LeadsIndex,
} from "../lib/leads";
import { UnverifiedLeadBadge } from "./Badge";
import { Breadcrumbs } from "./Breadcrumbs";
import { IconSprite } from "./OfferRow";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { StructuredData } from "./StructuredData";
import { LEAD_SOURCE_REL, LeadBanner } from "./UnverifiedPage";

/** Other current leads, newest post first (the loader's order). */
function OtherLeads({ current, leads }: { current: Lead; leads: Lead[] }) {
  const others = leads.filter((l) => l.slug !== current.slug).slice(0, 4);
  if (others.length === 0) return null;
  return (
    <nav className="od-related" aria-labelledby="od-related-head">
      <h2 id="od-related-head">More unverified offers</h2>
      <ul className="od-related-list">
        {others.map((lead) => (
          <li key={lead.slug} className="od-related-card">
            <span className="od-related-prov">{lead.provider}</span>
            <a
              className="od-related-title"
              href={`${lead.slug}.html`}
              aria-label={`View details for ${lead.title}`}
            >
              {lead.title}
            </a>
            <span className="od-related-amount">
              {lead.amount_claimed ?? "Amount not stated"}
            </span>
          </li>
        ))}
      </ul>
      <p className="od-related-more">
        <a href="../unverified.html">All unverified offers</a>
        {" · "}
        <a href="../index.html">Browse the verified offers</a>
      </p>
    </nav>
  );
}

/**
 * One unverified lead's own page (#660), at unverified/<slug>.html. Same
 * skeleton as OfferDetailPage — masthead, status line, sticky facts rail,
 * prose body, related cards — filled only with lead fields. In place of the
 * "Claim at" button the rail carries the not-confirmed warning: a lead has
 * no checked claim link, only the posts that mention it (nofollow ugc) and
 * the official pages the hunt read. No apply prompt, no claim checklist and
 * no data-ft-offer-* hooks, so leads stay out of offer_click attribution.
 */
export default function LeadDetailPage({
  leads,
  slug,
  baseUrl,
}: {
  leads: LeadsIndex;
  slug: string;
  baseUrl?: string;
}) {
  const lead = leads.leads.find((l) => l.slug === slug);
  return (
    <>
      <IconSprite />
      <div className="wrap">
        <main>
          <SiteHeader depth={1} current="unverified" pageViews={false} />
          <Breadcrumbs
            page="lead"
            slug={lead?.slug ?? slug}
            title={lead?.title ?? "Lead not found"}
            baseUrl={baseUrl}
          />
          {lead ? (
            <article className="offer-detail lead-detail">
              <p className="od-back">
                <a href="../unverified.html">&larr; All unverified offers</a>
              </p>
              <header className="masthead masthead-offer">
                <p className="kicker">
                  <UnverifiedLeadBadge />
                </p>
                <h1>{lead.title}</h1>
                <p className="count">{lead.provider}</p>
              </header>
              <div className="od-hero">
                <div className="od-hero-metrics" />
                <p className="od-statusline mono">
                  <span className="status">
                    posted{" "}
                    <time dateTime={lead.posted}>{humanDate(lead.posted)}</time>
                  </span>
                  <span className="sep" aria-hidden="true">
                    &middot;
                  </span>
                  {REASON_LABELS[lead.reason]}
                  <span className="sep" aria-hidden="true">
                    &middot;
                  </span>
                  checked{" "}
                  <time dateTime={lead.last_seen}>
                    {humanDate(lead.last_seen)}
                  </time>
                </p>
              </div>
              <aside className="od-rail" aria-label="Lead summary">
                <LeadBanner single />
                <section className="od-facts" aria-label="Key lead details">
                  <h2>Details</h2>
                  <table className="od-table">
                    <tbody>
                      <tr>
                        <th scope="row">Provider</th>
                        <td>{lead.provider}</td>
                      </tr>
                      <tr>
                        <th scope="row">Amount claimed</th>
                        <td className="mono od-amount">
                          {lead.amount_claimed ?? "not stated"}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Posted</th>
                        <td>
                          <time dateTime={lead.posted}>
                            {humanDate(lead.posted)}
                          </time>
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Status</th>
                        <td>
                          <UnverifiedLeadBadge />
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Why unconfirmed</th>
                        <td>{REASON_LABELS[lead.reason]}</td>
                      </tr>
                      <tr>
                        <th scope="row">First spotted</th>
                        <td>
                          <time dateTime={lead.first_seen}>
                            {humanDate(lead.first_seen)}
                          </time>
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Last checked</th>
                        <td>
                          <time dateTime={lead.last_seen}>
                            {humanDate(lead.last_seen)}
                          </time>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </section>
              </aside>
              <div className="od-body">
                <section className="od-brief">
                  <h2>The claim</h2>
                  <p className="od-summary">{lead.claim}</p>
                </section>
                <section className="od-brief lead-reason">
                  <h2>Why it is not verified</h2>
                  <p>
                    <strong>{REASON_LABELS[lead.reason]}.</strong>{" "}
                    {lead.reason_detail}
                  </p>
                </section>
                <section className="od-brief">
                  <h2>Where it was posted</h2>
                  <ul className="lead-sources">
                    {lead.sources.map((source) => (
                      <li key={source.url}>
                        <a
                          href={source.url}
                          rel={LEAD_SOURCE_REL}
                          target="_blank"
                        >
                          {sourceLabel(source)}
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                        {source.date ? (
                          <>
                            {" "}
                            &middot; posted{" "}
                            <time dateTime={source.date}>
                              {humanDate(source.date)}
                            </time>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
                {lead.official_urls_tried?.length ? (
                  <section className="od-brief">
                    <h2>Official pages we checked</h2>
                    <ul className="lead-sources lead-official">
                      {lead.official_urls_tried.map((url) => (
                        <li key={url}>
                          <a
                            href={url}
                            rel="nofollow noopener noreferrer"
                            target="_blank"
                          >
                            {url.replace(/^https:\/\//, "")}
                            <span className="sr-only">
                              {" "}
                              (opens in a new tab)
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
              <OtherLeads current={lead} leads={leads.leads} />
            </article>
          ) : (
            <section
              className="empty"
              style={{ "--i": 0 } as React.CSSProperties}
            >
              <h2>Lead not found</h2>
              <p>
                No unverified lead lives at this address. Leads are listed for
                a few days after someone posts them, then removed.
              </p>
              <p>
                <a href="../unverified.html">See current unverified offers</a>{" "}
                or <a href="../index.html">browse the verified offers</a>.
              </p>
            </section>
          )}
        </main>
        <SiteFooter depth={1} current="unverified" />
      </div>
      <StructuredData
        page="lead"
        slug={lead?.slug ?? slug}
        title={lead?.title ?? "Lead not found"}
        baseUrl={baseUrl}
      />
    </>
  );
}
