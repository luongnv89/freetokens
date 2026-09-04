import { useMemo } from "react"
import { humanDate, type OffersIndex } from "../lib/offers"
import { ftFormatCount } from "../lib/analytics"
import { useOfferViews } from "../lib/offerStats"
import {
  claimSteps,
  type DetailsMap,
  type OfferDetail,
} from "../lib/offerDetails"
import { offerAbsoluteUrl } from "../lib/site"
import detailsCatalog from "../data/details.json"
import type { Offer } from "../lib/offers"
import {
  CategoryBadge,
  ReviewStatusBadge,
  SignupBadge,
  VerificationBadge,
} from "./Badge"
import { ClaimChecklist } from "./ClaimChecklist"
import { CopyLinkButton } from "./CopyLinkButton"
import { IconSprite } from "./OfferRow"
import { SocialProofList } from "./SocialProofList"
import { SiteFooter } from "./SiteFooter"
import { SiteHeader } from "./SiteHeader"
import { Breadcrumbs } from "./Breadcrumbs"
import { StructuredData } from "./StructuredData"

const catalog = detailsCatalog as DetailsMap

function relatedOffers(index: OffersIndex, current: Offer, limit = 4): Offer[] {
  const sameCategory = index.offers.filter(
    (o) => o.category === current.category && o.slug !== current.slug,
  )
  const active = sameCategory.filter((o) => o.status !== "expired")
  const expired = sameCategory.filter((o) => o.status === "expired")
  active.sort((a, b) => b.verified_date.localeCompare(a.verified_date))
  expired.sort((a, b) => b.verified_date.localeCompare(a.verified_date))
  return [...active, ...expired].slice(0, limit)
}

/**
 * The outbound claim link. Rendered twice per offer — once in the hero beside
 * the amount, once after the claim steps — so the conversion action is
 * reachable without scrolling past the facts table. Both copies carry the
 * same data-ft-* hooks, which is what attributes the GA4 offer_click event.
 */
function ClaimCta({ offer }: { offer: Offer }) {
  return (
    <a
      className="od-cta"
      href={offer.source_url}
      target="_blank"
      rel="noopener noreferrer"
      data-ft-offer-id={offer.slug}
      data-ft-provider={offer.provider}
      data-ft-offer-category={offer.category}
      data-ft-outbound="true"
    >
      Claim at {offer.provider} <span aria-hidden="true">&#8599;</span>
    </a>
  )
}

function RelatedOffers({ current, index }: { current: Offer; index: OffersIndex }) {
  const related = relatedOffers(index, current)
  if (related.length === 0) return null
  return (
    <nav className="od-related" aria-label="Related offers">
      <h2>Related offers</h2>
      <p className="od-related-kicker">More in {current.category.replace(/_/g, " ")}</p>
      <ul className="od-related-list">
        {related.map((offer) => (
          <li key={offer.slug}>
            <a href={`${offer.slug}.html`} aria-label={`View details for ${offer.title}`}>
              {offer.title}
            </a>
            <span className="od-related-meta">
              {" "}
              — {offer.provider} · {offer.amount}
            </span>
          </li>
        ))}
      </ul>
      <p className="od-related-more">
        <a href="../index.html">Browse all offers</a>
        {" · "}
        <a href="../archive.html">Browse the archive</a>
      </p>
    </nav>
  )
}

/**
 * Offer detail page (F2 / #60, full content port #128). Everything the
 * page shows is real data from the frozen contract plus optional
 * `src/data/details.json`, server-rendered so a JS-off deep link to
 * /offers/<slug>.html renders the full document. An unknown slug renders
 * the graceful not-found state instead of throwing during hydration.
 * Offers without a details document still render the summary card and
 * fallback claim steps without layout breakage.
 */
export default function OfferDetailPage({
  index,
  slug,
  details,
  baseUrl,
}: {
  index: OffersIndex
  slug: string
  details?: DetailsMap
  baseUrl?: string
}) {
  const offer = index.offers.find((o) => o.slug === slug)
  const map = details ?? catalog
  const detail: OfferDetail | undefined = offer ? map[offer.slug] : undefined
  const viewSlug = useMemo(() => [slug], [slug])
  const views = useOfferViews(viewSlug)
  const viewCount = offer ? views[offer.slug] : null
  return (
    <>
      <IconSprite />
      <div className="wrap">
        <main>
        <SiteHeader depth={1} />
        <Breadcrumbs
          page="detail"
          slug={offer?.slug ?? slug}
          title={offer?.title ?? "Offer not found"}
          baseUrl={baseUrl}
        />
        {offer ? (
          <article className="offer-detail">
            <p className="od-back">
              <a href="../index.html">&larr; All offers</a>
            </p>
            <header className="masthead masthead-offer">
              <p className="kicker">
                <CategoryBadge offer={offer} hrefPrefix="../" />
              </p>
              <h1>{offer.title}</h1>
              <p className="count">{offer.provider}</p>
            </header>
            <div className="od-hero">
              <div className="od-hero-metrics">
                <p className="amount">{offer.amount}</p>
                {typeof viewCount === "number" && (
                  <p className="ft-stat od-views">
                    <strong>{ftFormatCount(viewCount)}</strong>
                    {" "}
                    <span className="ft-stat-label">views</span>
                  </p>
                )}
              </div>
              <p className="od-statusline mono">
                {offer.status === "expired" ? (
                  <span className="status">ended</span>
                ) : offer.expiry_date ? (
                  <span className="status">
                    expires{" "}
                    <time dateTime={offer.expiry_date}>{humanDate(offer.expiry_date)}</time>
                  </span>
                ) : (
                  <span className="status">
                    <span className="dot" aria-hidden="true"></span>ongoing
                  </span>
                )}
                <span className="sep" aria-hidden="true">&middot;</span>
                <SignupBadge offer={offer} hrefPrefix="../" />
                <span className="sep" aria-hidden="true">&middot;</span>
                <VerificationBadge offer={offer} hrefPrefix="../" />
                <span className="sep" aria-hidden="true">&middot;</span>
                <ReviewStatusBadge offer={offer} />
                <span className="sep" aria-hidden="true">&middot;</span>
                checked{" "}
                <time dateTime={offer.verified_date}>{humanDate(offer.verified_date)}</time>
              </p>
              {offer.status !== "expired" ? (
                <p className="od-hero-cta">
                  <ClaimCta offer={offer} />
                  <span className="od-cta-note">
                    Opens {offer.provider}. This site takes no cut.
                  </span>
                </p>
              ) : null}
            </div>
            <section className="od-facts" aria-label="Key offer details">
              <h2>Details</h2>
              <table className="od-table">
                <tbody>
                  <tr>
                    <th scope="row">Provider</th>
                    <td>{offer.provider}</td>
                  </tr>
                  <tr>
                    <th scope="row">Amount</th>
                    <td className="mono">{offer.amount}</td>
                  </tr>
                  <tr>
                    <th scope="row">Category</th>
                    <td>
                      <CategoryBadge offer={offer} hrefPrefix="../" />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Sign-up</th>
                    <td>
                      <SignupBadge offer={offer} hrefPrefix="../" />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Ends</th>
                    <td>
                      {offer.status === "expired" ? (
                        <>ended</>
                      ) : offer.expiry_date ? (
                        <time dateTime={offer.expiry_date}>{humanDate(offer.expiry_date)}</time>
                      ) : (
                        <>ongoing &mdash; no fixed end date</>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Verification</th>
                    <td>
                      <VerificationBadge offer={offer} hrefPrefix="../" />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Review status</th>
                    <td>
                      <ReviewStatusBadge offer={offer} />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Last checked</th>
                    <td>
                      <time dateTime={offer.verified_date}>{humanDate(offer.verified_date)}</time>
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
            {detail?.summary ? (
              <section className="od-brief">
                <h2>The offer</h2>
                <p className="od-summary">{detail.summary}</p>
              </section>
            ) : null}
            <ClaimChecklist slug={offer.slug} steps={claimSteps(detail)} />
            {offer.status === "expired" ? (
              <p className="od-ended">This offer ended &mdash; nothing here is claimable anymore.</p>
            ) : (
              <ClaimCta offer={offer} />
            )}
            <SocialProofList proofs={detail?.social_proof} relPrefix="../" />
            <CopyLinkButton url={offerAbsoluteUrl(offer.slug)} />
            <RelatedOffers current={offer} index={index} />
          </article>
        ) : (
          <section className="empty" style={{ "--i": 0 } as React.CSSProperties}>
            <h2>Offer not found</h2>
            <p>
              No offer lives at this address. It may have been renamed or removed from the
              directory.
            </p>
            <p>
              <a href="../index.html">Browse all live offers</a> instead.
            </p>
          </section>
        )}
        </main>
        <SiteFooter depth={1} />
      </div>
      {/* JSON-LD last: crawlers read the whole document, but FCP content parses first. */}
      <StructuredData page="detail" index={index} slug={slug} detail={detail ?? null} baseUrl={baseUrl} />
    </>
  )
}
