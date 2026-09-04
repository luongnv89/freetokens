import { CATEGORY_LABELS, type Offer } from "../lib/offers"
import { ftFormatCount } from "../lib/analytics"

/**
 * The "Hot today" shelf: the three most-viewed offers, above the toolbar.
 *
 * Two things about it are deliberate and worth not undoing.
 *
 * It says TODAY, not "last 24 hours". GoatCounter's counter route windows by
 * calendar date, not by timestamp, so `days: 1` means "since midnight UTC" and
 * a rolling 24-hour window is not something this data can express. Labelling
 * it 24h would be a claim the numbers cannot support, which is the one thing
 * this site is built not to do.
 *
 * It renders nothing at all rather than an empty shelf. The counts arrive
 * after mount, only when the visitor has consented and GoatCounter answers,
 * and every offer needs to clear the minimum-views floor. Blocked, declined,
 * unconfigured, or simply a quiet morning all end the same way: no section,
 * and the listing below is untouched. That also keeps it out of the
 * prerendered HTML, so nothing here can go stale in a cached page.
 */
export function HotDeals({
  ranked,
  bySlug,
}: {
  ranked: { slug: string; views: number }[]
  bySlug: Map<string, Offer>
}) {
  const rows = ranked
    .map((entry) => ({ entry, offer: bySlug.get(entry.slug) }))
    .filter((row): row is { entry: { slug: string; views: number }; offer: Offer } =>
      Boolean(row.offer),
    )
  if (rows.length === 0) return null
  return (
    <section className="hot-deals" aria-labelledby="ft-hot-heading">
      <h2 className="hot-deals-head" id="ft-hot-heading">
        {/* Not "Hot today": that exact string is the row badge's label, and
            two different things answering to one name is how a reader stops
            trusting either. This names the measure; the badge marks the rows. */}
        <span className="hot-deals-title">Most viewed today</span>
        <span className="hot-deals-sub">updates a few times a day</span>
      </h2>
      <ol className="hot-deals-list">
        {rows.map(({ entry, offer }, i) => (
          <li key={offer.slug} className="hot-deal" data-category={offer.category}>
            <span className="hot-rank" aria-hidden="true">
              {i + 1}
            </span>
            <span className="hot-prov">{offer.provider}</span>
            <a
              className="hot-title"
              href={`offers/${offer.slug}.html`}
              data-ft-offer-id={offer.slug}
              data-ft-provider={offer.provider}
              data-ft-offer-category={offer.category}
            >
              {offer.title}
            </a>
            <span className="hot-meta">
              <span className="hot-cat">
                {CATEGORY_LABELS[offer.category] ?? offer.category}
              </span>
              <span className="hot-sep" aria-hidden="true">
                &middot;
              </span>
              {/* The number is the whole reason this row is here, so it is the
                  one thing in the shelf set at full ink. */}
              <strong>{ftFormatCount(entry.views)}</strong> views
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
