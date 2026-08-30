import { useRef, useState, type ChangeEvent } from "react"
import { IconSprite } from "./OfferRow"
import { SiteFooter } from "./SiteFooter"
import { SiteHeader } from "./SiteHeader"
import { Breadcrumbs } from "./Breadcrumbs"
import {
  IMPORT_MAX_LENGTH,
  clearAllPersonalState,
  claimSlugsInStorage,
  exportPersonalState,
  importPersonalState,
} from "../lib/personalState"

/**
 * The privacy policy page (Task 3.5 / PRD §5.2 / #132). Every factual claim
 * mirrors shipped React analytics (#127 / #131): query_length-only search,
 * cookieless GoatCounter, GA4 after grant with anonymize_ip, exclusive-end
 * counter windows, and ~4h CDN lag. No Google Fonts. No offer_share (#128).
 *
 * #141 adds the "Your local data" section: names every personal-state
 * localStorage key, hosts client-side-only export/import/erase controls,
 * and documents that nothing stored locally is ever transmitted.
 */

const EXPORT_FILENAME = "freetokens-personal-state.json"

/**
 * Client-side-only controls for the visitor's own localStorage snapshot.
 * Storage is touched strictly inside event handlers, so the static
 * prerender stays SSR-safe.
 */
function LocalDataControls() {
  const [status, setStatus] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  const onExport = () => {
    try {
      const blob = new Blob([JSON.stringify(exportPersonalState(), null, 2)], {
        type: "application/json",
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = EXPORT_FILENAME
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setStatus(`Exported your local data as ${EXPORT_FILENAME}.`)
    } catch {
      setStatus("Export failed in this browser.")
    }
  }

  const onImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ""
    if (!file) return
    if (file.size > IMPORT_MAX_LENGTH) {
      setStatus("That file is too large to be a personal-state export.")
      return
    }
    let text: string
    try {
      text = await file.text()
    } catch {
      setStatus("Could not read that file.")
      return
    }
    const result = importPersonalState(text)
    setStatus(
      result.ok
        ? "Backup restored: your saved offers, dismissed offers, filters, and claim progress were imported."
        : result.reason,
    )
  }

  const onClearAll = () => {
    if (
      !window.confirm(
        "Erase everything this site stores in this browser? Your saved offers, dismissed offers, filters, claim progress, and cookie choice will be removed. This cannot be undone.",
      )
    ) {
      return
    }
    clearAllPersonalState(claimSlugsInStorage())
    setStatus("All of your local data has been erased.")
  }

  return (
    <div className="local-data">
      <div className="local-data-actions">
        <button type="button" id="ft-export-data" onClick={onExport}>
          Export my data (JSON)
        </button>
        <button
          type="button"
          id="ft-import-data"
          onClick={() => fileRef.current?.click()}
        >
          Import a backup&hellip;
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="local-data-file"
          onChange={onImportFile}
        />
        <button
          type="button"
          id="ft-clear-data"
          className="local-data-danger"
          onClick={onClearAll}
        >
          Clear all my local data
        </button>
      </div>
      <p className="local-data-status" role="status" aria-live="polite">
        {status}
      </p>
    </div>
  )
}
export default function PrivacyPage({ baseUrl }: { baseUrl?: string }) {
  return (
    <>
      <IconSprite />
      <div className="wrap">
        <main>
          <header className="masthead">
            <SiteHeader current="privacy" />
            <Breadcrumbs page="privacy" baseUrl={baseUrl} />
            <p className="kicker">free ai credits</p>
            <h1>Privacy Policy</h1>
            <p className="tagline">
              The short version: this is a static page that stores almost nothing about you &mdash;
              and asks before it counts your visit.
            </p>
          </header>

          <div className="policy">
            <section className="summary" aria-labelledby="privacy-summary">
              <h2 id="privacy-summary">In short</h2>
              <ul>
                <li>No accounts, no forms, no logins &mdash; we have nowhere to store personal details.</li>
                <li>
                  If visit-counting is switched on, it runs through Google Analytics 4 with IP
                  anonymization (<code>anonymize_ip</code>) &mdash; and only after you allow it in
                  the consent banner shown on your first visit.
                </li>
                <li>
                  If the live traffic counter is switched on, page views are recorded cookie-free by{" "}
                  <a href="https://www.goatcounter.com" rel="noopener noreferrer">
                    GoatCounter
                  </a>{" "}
                  after you allow counting, shown as anonymous running totals on the home page and as
                  anonymous per-offer view counts next to each offer.
                </li>
                <li>
                  Your raw search text is <strong>never</strong> collected &mdash; only how many
                  characters you typed (<code>query_length</code>).
                </li>
                <li>
                  Everything this site saves on your device lives in your browser&apos;s local
                  storage &mdash; your cookie choice, saved offers, dismissed offers, filters, and
                  claim checklists. It never leaves your browser, and you can export or erase it in{" "}
                  <a href="#privacy-local-data">Your local data</a> below.
                </li>
                <li>You can block all of it with an ad blocker and every feature still works.</li>
              </ul>
            </section>

            <section aria-labelledby="privacy-what-this-is">
              <h2 id="privacy-what-this-is">What this site is</h2>
              <p>
                This site is a hand-built static page: a fixed HTML file served from GitHub Pages.
                There are no user accounts, no comment forms, no newsletter sign-ups, and no
                server-side database. Nothing about you is written down on our side &mdash; we
                couldn&apos;t store your name or email address even by accident, because v1.0 has no
                form that could submit them.
              </p>
            </section>

            <section aria-labelledby="privacy-analytics">
              <h2 id="privacy-analytics">What the analytics measure</h2>
              <p>
                To learn which offers people find useful, the site can count visits with Google
                Analytics 4 (GA4). This is off entirely unless the site owner has configured a
                measurement ID at build time &mdash; if it is not configured, no analytics code exists
                on the page at all.
              </p>
              <p>
                When counting <em>is</em> active and you have allowed it, GA4 records:
              </p>
              <ul>
                <li>
                  <strong>Page views</strong> &mdash; which page you viewed (the path only; anything
                  after <code>?</code> in the address is removed before sending).
                </li>
                <li>
                  <strong>Anonymized IP addresses</strong> &mdash; the last octet of your IP is zeroed
                  out by IP anonymization (<code>anonymize_ip</code>), so we never see your full
                  address.
                </li>
                <li>
                  <strong>Coarse technical metadata</strong> &mdash; things like browser family, screen
                  size buckets, and approximate region derived from the anonymized IP.
                </li>
                <li>
                  <strong>Which filters you picked</strong> &mdash; <code>category</code>,{" "}
                  <code>verification</code>, and <code>signup</code> as coarse values (for example
                  &ldquo;Image&rdquo; or &ldquo;all&rdquo;). Nothing else about your filtering.
                </li>
                <li>
                  <strong>Which sort option you picked</strong> (for example &ldquo;Expiring
                  soon&rdquo;) &mdash; nothing else about your sorting.
                </li>
                <li>
                  <strong>Search activity as a length only</strong> &mdash; when you search, the event
                  records just <code>query_length</code>, the number of characters typed. The words
                  themselves stay in your browser and are never sent anywhere.
                </li>
                <li>
                  <strong>Offer clicks</strong> &mdash; which listing you clicked (its ID, provider
                  name, and category).
                </li>
              </ul>
            </section>

            <section aria-labelledby="privacy-live-traffic">
              <h2 id="privacy-live-traffic">What the site traffic counter measures</h2>
              <p>
                Separately from GA4, the site can show running totals on the home page &mdash; the
                numbers you may see next to &ldquo;site traffic&rdquo;. They are not shown in the
                footer of every page. They are a rough popularity signal rather than a live readout:
                GoatCounter serves each total through a CDN that caches the response for around four
                hours, so the figures can lag by a few hours. The published today and 90-day totals
                use an exclusive-end calendar window (the range ends on tomorrow&apos;s date so today
                is included). Counting is done by <strong>GoatCounter</strong>, open-source software
                provided as a hosted service (goatcounter.com) under the EU&apos;s strict GDPR rules.
                Like GA4 above, it is off entirely unless configured at build time &mdash; and its
                counting script is not loaded until you allow tracking.
              </p>
              <p>
                When it <em>is</em> active, each page view records only technical, non-identifying
                details: the page path, the site&apos;s hostname, your browser&apos;s reported language
                and user-agent string, a coarse country derived from the IP at request time and then
                discarded, and the referring site. GoatCounter sets <strong>no cookies</strong>, uses
                no browser fingerprinting, and stores no personal identifiers or full IP addresses.
                Only anonymous aggregate totals are shown publicly on this site; nobody can browse
                individual visits.
              </p>
              <p>
                Blocking the counter with an ad blocker changes nothing else: pages, filters, and
                links all keep working exactly the same, and the home-page totals simply stay hidden.
              </p>
              <p>
                The same anonymous totals are also shown per offer: each listing can display how many
                times its detail page was viewed &mdash; an aggregate number only, with the same CDN
                caching lag. And when counting is allowed and you follow a &ldquo;Claim&rdquo; link
                from an offer page, GoatCounter records an anonymous event noting that this
                offer&apos;s claim link was used. The event carries the offer&apos;s ID alone &mdash;
                nothing about you, and nothing about what you do on the provider&apos;s site. If you
                decline counting, those claim-click events are never recorded.
              </p>
            </section>

            <section aria-labelledby="privacy-consent">
              <h2 id="privacy-consent">Consent, cookies, and local storage</h2>
              <p>
                Analytics starts from a denied state inside your browser: no counting code is loaded
                until permission exists. Every first-time visitor sees a small banner asking
                &ldquo;Allow?&rdquo; &mdash; declining means zero tracking requests leave your browser,
                and allowing is what switches GA4 (and the GoatCounter counter, when enabled) on.
              </p>
              <p>
                Your answer is remembered in your browser&apos;s local storage under the key{" "}
                <code>ft_ga_consent</code> as one word: <code>granted</code> or <code>denied</code>.
                It is one of several small entries this site keeps in your browser&apos;s local
                storage &mdash; every one of them is listed in <a href="#privacy-local-data">Your
                local data</a> below. The site sets no cookies of its own. Once you allow counting,
                Google Analytics may set its own cookies (such as <code>_ga</code>) to tell repeat
                visits apart; those cookies belong to Google and follow Google&apos;s rules.
              </p>
              <p>
                Changed your mind? Use the <strong>Cookie settings</strong> link in the footer of any
                page to re-open the banner and switch your choice at any time.
              </p>
            </section>

            <section aria-labelledby="privacy-local-data">
              <h2 id="privacy-local-data">Your local data</h2>
              <p>
                Besides the analytics choices above, this site keeps your personal settings in your
                browser&apos;s local storage, under these keys:
              </p>
              <ul>
                <li>
                  <code>ft_ga_consent</code> &mdash; your cookie and analytics choice (one word).
                </li>
                <li>
                  <code>ft-saved</code> &mdash; the offers you saved to your shortlist.
                </li>
                <li>
                  <code>ft-dismissed</code> &mdash; the offers you chose to hide.
                </li>
                <li>
                  <code>ft-prefs</code> &mdash; your last-used filters and sort order.
                </li>
                <li>
                  <code>ft-claim-&lt;offer&gt;</code> &mdash; your step-by-step checklist progress for
                  one offer.
                </li>
              </ul>
              <p>
                None of this ever leaves your browser. It is never transmitted to us or to anyone
                else &mdash; this is a static page with no server that could receive it. Clearing
                your browser data removes all of it automatically.
              </p>
              <p>You can also take it with you or erase it right here:</p>
              <LocalDataControls />
            </section>

            <section aria-labelledby="privacy-third-parties">
              <h2 id="privacy-third-parties">Who else receives data</h2>
              <ul>
                <li>
                  <strong>Google LLC</strong> processes the analytics data under the{" "}
                  <a href="https://policies.google.com/privacy" rel="noopener noreferrer">
                    Google Privacy Policy
                  </a>{" "}
                  and Google Analytics&apos; own terms (
                  <a
                    href="https://support.google.com/analytics/answer/6004245"
                    rel="noopener noreferrer"
                  >
                    how Google uses data from sites like this one
                  </a>
                  ).
                </li>
                <li>
                  <strong>GoatCounter (goatcounter.com)</strong> counts the live-traffic page views
                  and claim-click events described above on our behalf when the traffic counter is
                  switched on; its own terms apply (
                  <a href="https://www.goatcounter.com/privacy" rel="noopener noreferrer">
                    GoatCounter privacy policy
                  </a>
                  ).
                </li>
                <li>
                  <strong>Offer providers</strong> &mdash; clicking an offer takes you to a third-party
                  website. Once you are there, that company&apos;s privacy policy applies, not this
                  one.
                </li>
              </ul>
            </section>

            <section aria-labelledby="privacy-never">
              <h2 id="privacy-never">What we never do</h2>
              <ul>
                <li>We never sell, rent, or trade data &mdash; there is no ad business on this site.</li>
                <li>We never collect your name, email, or any identifier tied to you personally.</li>
                <li>We never collect the text you type into search.</li>
              </ul>
            </section>

            <section aria-labelledby="privacy-choices">
              <h2 id="privacy-choices">Your choices</h2>
              <ul>
                <li>
                  Decline or accept the banner shown on your first visit; press <kbd>Escape</kbd> to
                  decline it.
                </li>
                <li>
                  Change your mind anytime via the footer&apos;s <strong>Cookie settings</strong> link
                  &mdash; it re-opens the banner on every page, even after you already answered.
                </li>
                <li>
                  Export everything stored locally as a JSON backup, restore it on another browser,
                  or erase it all with one click &mdash; in{" "}
                  <a href="#privacy-local-data">Your local data</a> above.
                </li>
                <li>
                  Block everything with an ad blocker or your browser&apos;s tracking protection. The
                  site degrades silently: every offer, filter, and link keeps working exactly the same.
                </li>
              </ul>
            </section>

            <section aria-labelledby="privacy-changes">
              <h2 id="privacy-changes">Changes and contact</h2>
              <p>
                If the site&apos;s data practices change, this page will change with them &mdash; it is
                rebuilt together with the site on every update.
              </p>
              <p>
                Questions or concerns?{" "}
                <a
                  href="https://github.com/luongnv89/freetokens/issues"
                  rel="noopener noreferrer"
                >
                  Open an issue on GitHub
                </a>
                .
              </p>
            </section>
          </div>
        </main>

        <SiteFooter current="privacy" />
      </div>
    </>
  )
}
