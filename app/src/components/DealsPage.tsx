import { useEffect, useState } from "react";
import type { OffersIndex } from "../lib/offers";
import {
  NOT_FREE_NOTE,
  OCCASION_LABELS,
  dealsOf,
  filterDeals,
  occasionFromSearch,
  occasionsIn,
  type DealOccasion,
} from "../lib/deals";
import { Breadcrumbs } from "./Breadcrumbs";
import { DealRow } from "./DealRow";
import { IconSprite } from "./OfferRow";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { StructuredData } from "./StructuredData";
import { Button } from "./ui/button";

/** The not-free reminder, above the list and in each deal's rail. */
export function DealBanner() {
  return (
    <aside className="deal-banner" role="note" aria-label="Deals are not free">
      <p>
        <strong>Not free.</strong> {NOT_FREE_NOTE}
      </p>
      <p>
        Every deal links to the vendor&rsquo;s own page, which showed the
        discount and its end date when we checked. Deals disappear after
        their end date.
      </p>
    </aside>
  );
}

/**
 * Deals page (#809): seasonal discounts on paid AI subscriptions, coding
 * agents, AI tools and compute — kept apart from the free offers. Rendered
 * from offers.json's `deals` section (running deals only, soonest-ending
 * first), with an occasion filter that mirrors ?occasion= in the URL. The
 * prerender shows every deal; the filter applies after hydration only, so
 * the server and client markup always match.
 */
export default function DealsPage({
  index,
  baseUrl,
}: {
  index: OffersIndex;
  baseUrl?: string;
}) {
  const deals = dealsOf(index);
  const buildDay = index.generated_at.slice(0, 10);
  const [occasion, setOccasion] = useState<DealOccasion | "">("");
  useEffect(() => {
    setOccasion(occasionFromSearch(window.location.search));
  }, []);
  const choose = (value: DealOccasion | "") => {
    setOccasion(value);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("occasion", value);
    else url.searchParams.delete("occasion");
    window.history.replaceState(null, "", url);
  };
  const shown = filterDeals(deals, occasion);
  const available = occasionsIn(deals);
  return (
    <>
      <IconSprite />
      <div className="wrap">
        <main>
          <SiteHeader current="deals" />
          <header className="masthead masthead-home">
            <Breadcrumbs page="deals" baseUrl={baseUrl} />
            <p className="kicker">ai deals &middot; discounts, not free</p>
            <h1>AI deals</h1>
            <p className="tagline">
              Seasonal discounts on AI subscriptions, coding agents, AI tools
              and compute for agents, each checked on the vendor&rsquo;s own
              page &mdash; featured deals first, then soonest-ending.
            </p>
            <p className="count" aria-live="polite">
              <strong>{shown.length}</strong>
              {shown.length === 1 ? " running deal" : " running deals"}
            </p>
          </header>

          <DealBanner />

          {deals.length > 0 ? (
            <>
              <div
                className="chips"
                role="group"
                aria-label="Filter by occasion"
              >
                <Button
                  type="button"
                  variant="unstyled"
                  className="chip"
                  aria-pressed={occasion === "" ? "true" : "false"}
                  onClick={() => choose("")}
                >
                  <span>All</span>
                </Button>
                {available.map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant="unstyled"
                    className="chip"
                    data-occasion={value}
                    aria-pressed={occasion === value ? "true" : "false"}
                    onClick={() => choose(value)}
                  >
                    <span>{OCCASION_LABELS[value]}</span>
                  </Button>
                ))}
              </div>
              {shown.length > 0 ? (
                <ol className="grid" id="ft-deals-grid" role="list">
                  {shown.map((deal, i) => (
                    <DealRow
                      key={deal.slug}
                      deal={deal}
                      index={i}
                      buildDay={buildDay}
                    />
                  ))}
                </ol>
              ) : (
                <section className="empty">
                  <h2>No deals for this occasion</h2>
                  <p>
                    <Button
                      type="button"
                      variant="unstyled"
                      className="chip reset"
                      onClick={() => choose("")}
                    >
                      Show all deals
                    </Button>
                  </p>
                </section>
              )}
            </>
          ) : (
            <section className="empty">
              <h2>No running deals right now</h2>
              <p>
                Deals are collected during sales such as Black Friday and the
                year-end holidays, and each one disappears after its end date.
              </p>
              <p>
                <a href="./index.html">Browse the free offers</a> in the
                meantime.
              </p>
            </section>
          )}
        </main>
        <SiteFooter current="deals" />
      </div>
      <StructuredData page="deals" baseUrl={baseUrl} />
    </>
  );
}
