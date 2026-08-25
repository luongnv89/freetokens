import { humanDate, type OffersIndex } from "../lib/offers"
import {
  claimSteps,
  type DetailsMap,
  type OfferDetail,
} from "../lib/offerDetails"
import { offerAbsoluteUrl } from "../lib/site"
import detailsCatalog from "../data/details.json"
import { CategoryBadge, SignupBadge, VerificationBadge } from "./Badge"
import { ClaimChecklist } from "./ClaimChecklist"
import { CopyLinkButton } from "./CopyLinkButton"
import { IconSprite } from "./OfferRow"
import { SocialProofList } from "./SocialProofList"
import { SiteFooter } from "./SiteFooter"

const catalog = detailsCatalog as DetailsMap

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
}: {
  index: OffersIndex
  slug: string
  details?: DetailsMap
}) {
  const offer = index.offers.find((o) => o.slug === slug)
  const map = details ?? catalog
  const detail: OfferDetail | undefined = offer ? map[offer.slug] : undefined
  return (
    <>
      <IconSprite />
      <div className="wrap">
        <main>
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
              <p className="amount">{offer.amount}</p>
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
                checked{" "}
                <time dateTime={offer.verified_date}>{humanDate(offer.verified_date)}</time>
              </p>
            </div>
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
              <a
                className="od-cta"
                href={offer.source_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Claim at {offer.provider} <span aria-hidden="true">&#8599;</span>
              </a>
            )}
            <SocialProofList proofs={detail?.social_proof} relPrefix="../" />
            <CopyLinkButton url={offerAbsoluteUrl(offer.slug)} />
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
    </>
  )
}
