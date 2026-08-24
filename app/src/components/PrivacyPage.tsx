import { IconSprite } from "./OfferRow"
import { SiteFooter } from "./SiteFooter"

/**
 * The privacy policy page (Task 3.5 / PRD §5.2), ported from build.py
 * _PRIVACY_HEADER + _PRIVACY_CONTENT: plain-language policy sharing the
 * site chrome. Every factual claim mirrors what the site actually does.
 */
export default function PrivacyPage() {
  return (
    <>
      <IconSprite />
      <div className="wrap">
        <header className="masthead">
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
                anonymization &mdash; and only after you allow it in the consent banner shown on your
                first visit.
              </li>
              <li>
                If the live traffic counter is switched on, page views are recorded cookie-free by{" "}
                <a href="https://www.goatcounter.com" rel="noopener noreferrer">
                  GoatCounter
                </a>{" "}
                and shown as anonymous totals on this site.
              </li>
              <li>
                Your raw search text is <strong>never</strong> collected &mdash; only how many
                characters you typed.
              </li>
              <li>The only thing this site saves on your device is a single-word remember of your cookie choice.</li>
              <li>You can block all of it with an ad blocker and every feature still works.</li>
            </ul>
          </section>

          <section aria-labelledby="privacy-what-this-is">
            <h2 id="privacy-what-this-is">What this site is</h2>
            <p>
              This site is a hand-built static page: a fixed HTML file served from GitHub Pages.
              There are no user accounts, no comment forms, no newsletter sign-ups, and no
              server-side database. Nothing about you is written down on our side &mdash; we
              couldn't store your name or email address even by accident, because v1.0 has no form
              that could submit them.
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
                out by IP anonymization, so we never see your full address.
              </li>
              <li>
                <strong>Coarse technical metadata</strong> &mdash; things like browser family, screen
                size buckets, and approximate region derived from the anonymized IP.
              </li>
              <li>
                <strong>Which filter category you picked</strong> (for example &ldquo;Image&rdquo;)
                &mdash; nothing else about your filtering.
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
              <li>
                <strong>Share actions</strong> &mdash; when you use a share button on an offer page,
                the offer's ID and which channel you picked (for example &ldquo;linkedin&rdquo; or
                &ldquo;copy&rdquo;). The share itself happens between you and that platform.
              </li>
            </ul>
          </section>

          <section aria-labelledby="privacy-live-traffic">
            <h2 id="privacy-live-traffic">What the site traffic counter measures</h2>
            <p>
              Separately from GA4, the site can show visit totals in its footer &mdash; the numbers
              you may see next to &ldquo;site traffic&rdquo;. They are a rough popularity signal
              rather than a live readout: GoatCounter caches the totals, so they can lag the real
              figure by a few hours. Counting is done by <strong>GoatCounter</strong>, open-source
              software provided as a hosted service (goatcounter.com) under the EU's strict GDPR
              rules. Like GA4 above, it is off entirely unless configured at build time &mdash; and
              its counting script is not loaded until you allow tracking.
            </p>
            <p>
              When it <em>is</em> active, each page view records only technical, non-identifying
              details: the page path, the site's hostname, your browser's reported language and
              user-agent string, a coarse country derived from the IP at request time and then
              discarded, and the referring site. GoatCounter sets <strong>no cookies</strong>, uses
              no browser fingerprinting, and stores no personal identifiers or full IP addresses.
              Only anonymous aggregate totals are shown publicly on this site; nobody can browse
              individual visits.
            </p>
            <p>
              Blocking the counter with an ad blocker changes nothing else: pages, filters, and
              links all keep working exactly the same, and the footer totals simply stay hidden.
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
              Your answer is remembered in your browser's local storage under the key{" "}
              <code>ft_ga_consent</code> as one word: <code>granted</code> or <code>denied</code>.
              That single word is the only data this site itself ever writes on your device &mdash;
              the site sets no cookies of its own. Once you allow counting, Google Analytics may set
              its own cookies (such as <code>_ga</code>) to tell repeat visits apart; those cookies
              belong to Google and follow Google's rules.
            </p>
            <p>
              Changed your mind? Use the <strong>Cookie settings</strong> link in the footer of any
              page to re-open the banner and switch your choice at any time.
            </p>
          </section>

          <section aria-labelledby="privacy-third-parties">
            <h2 id="privacy-third-parties">Who else receives data</h2>
            <ul>
              <li>
                <strong>Google LLC</strong> processes the analytics data under the{" "}
                <a href="https://policies.google.com/privacy" rel="noopener noreferrer">
                  Google Privacy Policy
                </a>{" "}
                and Google Analytics' own terms (
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
                described above on our behalf when the traffic counter is switched on; its own terms
                apply (
                <a href="https://www.goatcounter.com/privacy" rel="noopener noreferrer">
                  GoatCounter privacy policy
                </a>
                ).
              </li>
              <li>
                <strong>Google Fonts</strong> serves the typefaces this page displays; loading them
                is a plain request from your browser to Google's servers.
              </li>
              <li>
                <strong>Offer providers</strong> &mdash; clicking an offer takes you to a third-party
                website. Once you are there, that company's privacy policy applies, not this one.
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
                Change your mind anytime via the footer's <strong>Cookie settings</strong> link
                &mdash; it re-opens the banner on every page, even after you already answered.
              </li>
              <li>
                Block everything with an ad blocker or your browser's tracking protection. The site
                degrades silently: every offer, filter, and link keeps working exactly the same.
              </li>
            </ul>
          </section>

          <section aria-labelledby="privacy-changes">
            <h2 id="privacy-changes">Changes and contact</h2>
            <p>
              If the site's data practices change, this page will change with them &mdash; it is
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

        <SiteFooter current="privacy" />
      </div>
    </>
  )
}
