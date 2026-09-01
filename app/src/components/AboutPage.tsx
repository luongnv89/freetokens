import { type OffersIndex, activeOffers } from "../lib/offers"
import { IconSprite } from "./OfferRow"
import { SiteFooter } from "./SiteFooter"
import { SiteHeader } from "./SiteHeader"
import { Breadcrumbs } from "./Breadcrumbs"
import { StructuredData } from "./StructuredData"

export default function AboutPage({
  index,
  baseUrl,
}: {
  index: OffersIndex
  baseUrl?: string
}) {
  const offers = activeOffers(index)
  const ongoing = offers.filter((o) => !o.expiry_date).length
  const corroborated = offers.filter((o) => o.verification === "social_proof").length

  return (
    <>
      <IconSprite />
      <StructuredData page="about" baseUrl={baseUrl} />
      <div className="wrap">
        <main>
          <header className="masthead masthead-home">
            <SiteHeader current="about" />
            <Breadcrumbs page="about" baseUrl={baseUrl} />
            <p className="kicker">free ai credits &middot; about</p>
            <h1>About Free AI Credits</h1>
            <p className="tagline">
              Every claimable free-credit offer worth your time, on one fast page. Each carries a
              curator review status, verification level (corroborated or community-sourced), and a
              sign-up tag, refreshed on every rebuild.
            </p>
          </header>

          <div className="policy">
            <section aria-labelledby="about-what">
              <h2 id="about-what">What this is</h2>
              <p>
                This site collects every currently claimable free AI credit offer — API providers,
                coding assistants, image, voice and video tools — on one fast page. Each listing is
                labeled with review status, verification level and sign-up need so you can see at a
                glance what is worth your time.
              </p>
              <p className="muted">
                zero runtime &middot; every offer labeled with review status, verification level &amp;
                sign-up need
              </p>
              <p className="count">
                <strong>{offers.length}</strong> live offers &middot; <strong>{ongoing}</strong>{" "}
                ongoing &middot; <strong>{corroborated}</strong> corroborated by official source
              </p>
            </section>

            <section aria-labelledby="about-how">
              <h2 id="about-how">How it works</h2>
              <ul>
                <li>Static build — no accounts, no server, just prerendered HTML from YAML.</li>
                <li>Verification tags: corroborated by the official site + social proof, or community-sourced.</li>
                <li>Sign-up need: none vs. required (free account).</li>
                <li>Refreshed on every rebuild — expired offers move to the archive automatically.</li>
              </ul>
            </section>

            <section aria-labelledby="about-contact">
              <h2 id="about-contact">Contact</h2>
              <p>
                Questions or corrections? Open an issue on{" "}
                <a href="https://github.com/luongnv89/freetokens/issues" rel="noopener noreferrer">
                  GitHub
                </a>{" "}
                or reach the curator via the links in the footer.
              </p>
            </section>
          </div>
        </main>
        <SiteFooter current="about" />
      </div>
    </>
  )
}
