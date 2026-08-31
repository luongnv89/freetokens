# Provider outreach kit — attribution-backed pitches

Issue #28 · PRD §1.4, §7.1, Persona 3 (Alex, DevRel) · non-build document

Everything needed to pitch smaller AI providers with **real per-offer click
attribution** from this site's GA4 data instead of vague traffic promises.
One rule makes the whole kit credible: **every number in a pitch comes from a
GA4 export committed or quoted in this repo — never estimated, never padded.**

## Why a provider should care

Freetokens is small but unusually measurable for its size. Every outbound
offer link fires a consent-gated `offer_click` event carrying `offer_id`,
`provider`, and `category`. That means for any provider we can say things
like *"your free-tier listing sent 34 claim clicks in 14 days, 61% of them
while your promo was expiring"* — intent-heavy developer traffic, attributed
per listing, at zero cost to them. The long-term upside for providers is a
future sponsorship slot sold on exactly this data (PRD §7.1).

## Prerequisite: the ≥2-week measurement window

The v2 gate window opened with the v1.1 distribution kickoff on
**2026-08-22** ([outreach log](outreach-log.md)). Pitches lead with numbers,
so do not send before the first credible export:

| Milestone | Date |
|---|---|
| Measurement window opens (v1.1 tagged) | 2026-08-22 |
| Earliest ≥2-week GA4 export / first real pitches | 2026-09-05 |
| PRD check-in ("≥1 provider responds by week 6") | 2026-10-03 |

Until 2026-09-05 the example pitches below stay marked **ILLUSTRATIVE**;
their `[S]` values are sample placeholders showing the required shape, not
claims about this site's performance.

## Step 1 — Export per-provider click data from GA4

### One-time setup: register event parameters as custom dimensions

GA4 only reports custom event parameters after they are registered:

1. GA4 → **Admin → Data display → Custom definitions → Create custom
   dimensions**, three times, all **Event**-scoped:

   | Dimension name | Event parameter | Notes |
   |---|---|---|
   | Provider | `provider` | e.g. `Groq` — matches the card's data attribute |
   | Offer ID | `offer_id` | slug, e.g. `groq-free-tier` |
   | Offer category | `category` | one of the five site categories |

2. Allow ~24 h; historical events backfill into reports.

### Recurring export (weekly, via Explore)

3. **Explore → Free form**, new exploration named `offer_click weekly`.
4. Date range: the full window so far (minimum: since 2026-08-22).
5. Rows: drag in **Provider**; Values: **Event count**; add **Users** as a
   second value.
6. Filters: **Event name = offer_click** (exactly).
7. Tabs: duplicate the tab, swap Rows to **Offer ID**, then to **Offer
   category** — three views over the same range.
8. Total users for the same range: **Reports → Engagement → Overview** (or
   Explore, no filter) → note **Active users**.
9. **Export CSV** (or copy the table) per tab; save under
   `docs/outreach/exports/YYYY-MM-DD.csv` and commit it so every pitched
   number is auditable.

### Build the per-provider summary

One row per provider you intend to pitch (compute in the spreadsheet before
deleting nothing — keep formulas visible for audit):

| Column | How |
|---|---|
| Provider | row key |
| Offers listed | count of live offers with that provider |
| Clicks (window) | sum of event_count where provider matches |
| Distinct claimants | Users value for that row |
| Share of all clicks | provider clicks ÷ total offer_click events |
| Category mix | from the category tab, top category + % |
| Site users (window) | unfiltered Active-users figure |
| CTR contribution | distinct claimants ÷ site users |

Site-level CTR benchmark (PRD §1.4): **users with ≥1 `offer_click` ÷ total
users, target ≥25%**. Quote it site-wide in pitches; never silently divide a
provider's clicks by anything else.

## Step 2 — Pitch email template

Address DevRel / growth / partnerships contacts. Subject options:

- `Your free tier on <site>: <N> claim clicks in <W> weeks (attribution inside)`
- `<Provider> x freetokens: per-offer click data for your dev funnel`

```text
Hi {{FIRST_NAME}},

I run freetokens (https://freetokens.custats.info/) — a curator-reviewed
directory of free AI credit offers. Every listing is checked against your own
pricing/docs pages, and every outbound link is click-attributed.

Your {{PROVIDER}} listing has been live since {{LIVE_DATE}}. Numbers from our
GA4 export for {{WINDOW_START}}–{{WINDOW_END}}:

- Claim clicks on your listing(s): {{CLICKS}} across {{OFFERS_LISTED}}
  offer(s) ({{DISTINCT_CLAIMANTS}} distinct developers)
- That's {{SHARE}}% of all offer clicks on the site
- Category mix around your listing: {{CATEGORY_MIX}}
- Site-wide click-through: {{SITE_CTR}}% of visitors clicked ≥1 offer
  (our internal bar is 25%)

What that means practically: developers arrive mid-task, filter straight to
{{CATEGORY}}, and click out to claim — high-intent traffic you can't see in
referrer logs.

Two easy asks, pick either:

1. Tell me the best deep link for your signup flow and I'll point the
   listing's primary button there (free, takes a day).
2. If the numbers interest you, I'm reserving a sponsored slot on the
   category page for {{SPONSOR_PRICE_OR_TERMS}} — same attribution,
   labeled, first-come.

Happy to share the raw export for your rows. Either way, thanks for running
a free tier worth listing.

{{YOUR_NAME}}
maintainer, freetokens — {{CONTACT}}
```

Rules: fill every `{{…}}` from the latest committed export; if a value is
unavailable, cut the bullet rather than guess. Follow up once after 5
business days, then stop.

## Worked example pitches — ILLUSTRATIVE until 2026-09-05

> **[S] marks a sample placeholder.** These two examples show tone and
> structure with invented values. Before sending, replace every `[S]` with
> figures from the committed export, then delete this banner section.

**Example A — voice API provider with an ongoing free plan**

> Subject: Your free tier on Free AI Credits: [S]47 claim clicks in 2 weeks
>
> Hi Sam, I run freetokens — a curator-reviewed directory of free AI credit
> offers. Your listing has been live since [S]Aug 21. From our GA4 export for
> [S]Aug 22–Sep 5: [S]47 claim clicks ([S]31 distinct developers), [S]12% of
> all offer clicks on the site, strongest around the Voice category
> ([S]70% of your clicks). Site-wide, [S]29% of visitors clicked at least one
> offer (our bar is 25%). Developers land mid-task and click out to claim —
> intent you can't see in referrer logs. Two asks, pick one: (1) give me your
> best signup deep link and I'll wire it to the listing's primary button, or
> (2) if the numbers interest you, a sponsored Voice-category slot is open —
> same attribution, clearly labeled. Happy to send your raw export rows.
> — [S]Maintainer Name

**Example B — image-generation promo about to expire**

> Subject: [S]38 clicks in 6 days on your expiring credits — renewal data
>
> Hi Dana, quick one from freetokens (curator-reviewed free-AI-credit directory).
> Your [S]double-credits promo listing went up [S]Aug 24; through [S]Aug 30 it
> drew [S]38 claim clicks ([S]26 distinct developers) — [S]18% of all offer
> clicks that week, and [S]64% arrived in the final 48 hours before expiry.
> That spike pattern repeats across expiring promos on the site, which is
> exactly why we keep listings fresh: when you renew or extend, one commit
> re-verifies and republishes within two minutes, feed subscribers included.
> Want me to (1) point your listing at a dedicated landing URL, or (2) talk
> about the sponsored image-category slot while the renewal traffic is warm?
> Raw export rows available anytime. — [S]Maintainer Name

## Tracking log (live)

Supports the PRD metric **"≥1 provider responds to an attribution-backed
pitch by week 6"**. One row per provider touch; append, never rewrite
history. Sending email is a human action (account-owned), so — matching the
#24 precedent — rows are added when sends actually happen, not pre-checked.

| # | Provider | Contact role | Offer(s) cited | First sent | Follow-up | Response | Outcome |
|---|---|---|---|---|---|---|---|
| 1 | _pending_ | _pending_ | _pending_ | _pending_ (≥ 2026-09-05, post-export) | _pending_ | _pending_ | _pending_ |

Outcome vocabulary: `replied-interested` / `replied-pass` / `no-response`
(after follow-up + 2 weeks) / `bounced`. On any reply, quote it in the epic
(#31) thread and move deal terms to a dedicated issue.
