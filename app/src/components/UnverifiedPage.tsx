import { humanDate } from "../lib/offers";
import {
  REASON_LABELS,
  sourceLabel,
  type Lead,
  type LeadsIndex,
} from "../lib/leads";
import { Breadcrumbs } from "./Breadcrumbs";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { StructuredData } from "./StructuredData";

/** Source links are user posts, not endorsements: never pass link equity. */
export const LEAD_SOURCE_REL = "nofollow ugc noopener noreferrer";

function LeadCard({ lead }: { lead: Lead }) {
  const headingId = `lead-${lead.slug}`;
  return (
    <li className="lead-card" aria-labelledby={headingId}>
      <p className="lead-provider">{lead.provider}</p>
      <h2 className="card-title" id={headingId}>
        {lead.title}
      </h2>
      <p className="lead-claim">
        <span className="lead-label">Claimed: </span>
        {lead.claim}
      </p>
      {lead.amount_claimed ? (
        <p className="lead-amount">
          <span className="lead-label">Amount claimed: </span>
          {lead.amount_claimed}
        </p>
      ) : null}
      <dl className="lead-meta">
        <div>
          <dt>First seen</dt>
          <dd>
            <time dateTime={lead.first_seen}>{humanDate(lead.first_seen)}</time>
          </dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>
            <time dateTime={lead.last_seen}>{humanDate(lead.last_seen)}</time>
          </dd>
        </div>
      </dl>
      <p className="lead-reason">
        <span className="lead-label">Not verified: </span>
        <strong>{REASON_LABELS[lead.reason]}.</strong> {lead.reason_detail}
      </p>
      <p className="lead-label">Sources</p>
      <ul className="lead-sources">
        {lead.sources.map((source) => (
          <li key={source.url}>
            <a href={source.url} rel={LEAD_SOURCE_REL} target="_blank">
              {sourceLabel(source)}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            {source.date ? (
              <>
                {" "}
                &middot; posted{" "}
                <time dateTime={source.date}>{humanDate(source.date)}</time>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * Unverified leads (#660): offers the hunter spotted on X, Reddit or the web
 * but could not confirm on an official page. Rendered from their own
 * artifact (unverified.json) — never part of the offer listing or search.
 */
export default function UnverifiedPage({
  leads,
  baseUrl,
}: {
  leads: LeadsIndex;
  baseUrl?: string;
}) {
  return (
    <div className="wrap">
      <main>
        <SiteHeader current="unverified" />
        <header className="masthead masthead-home">
          <Breadcrumbs page="unverified" baseUrl={baseUrl} />
          <p className="kicker">free ai credits &middot; unverified</p>
          <h1>Unverified offers</h1>
          <p className="tagline">
            Offers people posted about that we could not confirm on the
            provider&rsquo;s own pages yet &mdash; newest sightings first.
          </p>
          <p className="count">
            <strong>{leads.leads.length}</strong> unverified leads
          </p>
        </header>

        <aside className="lead-banner" role="note" aria-label="Before you claim">
          <p>
            <strong>Not confirmed.</strong> Each lead below was spotted on X or
            the web but not confirmed on an official page, so it may be
            inaccurate, may never happen, or may have ended.
          </p>
          <p>
            Claim only inside the provider&rsquo;s own site or product. Never
            share API keys, passwords or payment details, and never DM anyone
            to get an offer.
          </p>
        </aside>

        {leads.leads.length > 0 ? (
          <ol className="grid lead-grid" role="list">
            {leads.leads.map((lead) => (
              <LeadCard key={lead.slug} lead={lead} />
            ))}
          </ol>
        ) : (
          <section className="empty">
            <h2>No unverified leads right now</h2>
            <p>
              When the daily hunt finds an offer it cannot confirm, it shows
              up here until it is verified or 30 days pass.
            </p>
            <p>
              <a href="./index.html">Browse the verified offers</a> in the
              meantime.
            </p>
          </section>
        )}
      </main>
      <SiteFooter current="unverified" />
      <StructuredData page="unverified" baseUrl={baseUrl} />
    </div>
  );
}
