import type { LeadsIndex } from "../lib/leads";
import { Breadcrumbs } from "./Breadcrumbs";
import { LeadRow } from "./LeadRow";
import { IconSprite } from "./OfferRow";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { StructuredData } from "./StructuredData";

/** Source links are user posts, not endorsements: never pass link equity. */
export const LEAD_SOURCE_REL = "nofollow ugc noopener noreferrer";

/** Days a lead stays listed after its newest post (schemas/unverified-lead.rules.json). */
export const FRESH_DAYS = 3;

/** The not-confirmed warning, shown above the list and in each lead's rail. */
export function LeadBanner({ single = false }: { single?: boolean }) {
  return (
    <aside className="lead-banner" role="note" aria-label="Before you claim">
      <p>
        <strong>Not confirmed.</strong>{" "}
        {single ? "This lead was" : "Each lead below was"} spotted on X or the
        web but not confirmed on an official page, so it may be inaccurate,
        may never happen, or may have ended.
      </p>
      <p>
        Claim only inside the provider&rsquo;s own site or product. Never
        share API keys, passwords or payment details, and never DM anyone
        to get an offer.
      </p>
    </aside>
  );
}

/**
 * Unverified leads (#660): offers someone posted about in the last
 * FRESH_DAYS days that the hunt could not confirm on an official page.
 * Rendered from their own artifact (unverified.json), newest post first,
 * as the same ledger rows the home listing uses, each linking to its own
 * unverified/<slug>.html page — never part of the offer listing or search.
 */
export default function UnverifiedPage({
  leads,
  baseUrl,
}: {
  leads: LeadsIndex;
  baseUrl?: string;
}) {
  const count = leads.leads.length;
  const buildDay = leads.generated_at.slice(0, 10);
  return (
    <>
      <IconSprite />
      <div className="wrap">
        <main>
          <SiteHeader current="unverified" />
          <header className="masthead masthead-home">
            <Breadcrumbs page="unverified" baseUrl={baseUrl} />
            <p className="kicker">free ai credits &middot; unverified</p>
            <h1>Unverified offers</h1>
            <p className="tagline">
              {`Offers people posted about in the last ${FRESH_DAYS} days that we could not confirm on the provider’s own pages yet — newest posts first.`}
            </p>
            <p className="count">
              <strong>{count}</strong>
              {count === 1 ? " unverified lead" : " unverified leads"}
            </p>
          </header>

          <LeadBanner />

          {count > 0 ? (
            <>
              <a className="skip-list" href="#site-footer">
                Skip the offer list
              </a>
              <ol className="grid" id="ft-unverified-grid" role="list">
                {leads.leads.map((lead, i) => (
                  <LeadRow
                    key={lead.slug}
                    lead={lead}
                    index={i}
                    buildDay={buildDay}
                  />
                ))}
              </ol>
            </>
          ) : (
            <section className="empty lead-empty">
              <h2>Nothing unconfirmed right now</h2>
              <p>
                {`Leads appear here for ${FRESH_DAYS} days after someone posts them, and are checked every night.`}
              </p>
              <p>
                <a href="./index.html">Browse the verified offers</a> in the
                meantime.
              </p>
            </section>
          )}
        </main>
        <SiteFooter current="unverified" />
      </div>
      <StructuredData page="unverified" baseUrl={baseUrl} />
    </>
  );
}
