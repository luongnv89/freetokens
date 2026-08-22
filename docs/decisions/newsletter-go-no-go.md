# Decision record: newsletter digest (F13) go/no-go

Issue #29 · PRD §3.1 F13, §8.3 v2 gate · **Status: NO-GO (F13 not built)**

- Decided: 2026-08-22
- Re-evaluation trigger: on/after 2026-09-05, when the first ≥2-week GA4
  export exists (see [Re-evaluation](#re-evaluation))

## Decision

**NO-GO.** The newsletter digest (F13) is explicitly **not built** this
sprint, and no newsletter signup code, form, or email collection of any kind
ships. This is a gate decision, not an abandonment: the gate's own inputs
(≥2 weeks of GA4 reports) do not exist yet, so the criteria below cannot be
evaluated either way. F13 stays unbuilt until the scheduled re-evaluation
flips this verdict.

## Criteria (PRD §1.4 success metrics)

| # | Metric | GO threshold | Measurement |
|---|---|---|---|
| C1 | Monthly unique visitors | ≥500 by day 30 | GA4 users report |
| C2 | Offer click-through rate | ≥25% of visitors click ≥1 offer | `offer_click` users ÷ total users |
| C3 | Visitor→return rate | ≥15% returning by day 30 | GA4 new vs returning |

A newsletter is only worth a reader's inbox if people come back without one
(C3) and click offers at meaningful rates (C2); traffic volume alone (C1)
does not justify F13.

## Data snapshot (as of decision date)

| Input | Status on 2026-08-22 |
|---|---|
| GA4 property | Live since v1.0 deploy (2026-08-21), consent-gated; measurement window opened with the v1.1 distribution kickoff (**2026-08-22**) |
| ≥2-week GA4 export (weekly visitors, return rate, CTR) | **Does not exist yet** — earliest possible export: **2026-09-05** |
| Weekly figures table | _pending first export_ (`W1 …`, columns: visitors, % returning, CTR) |
| Available proxy: GitHub traffic API, repo views, trailing 14 days ending 2026-08-22 | 0 views / 0 unique viewers across all 14 days (2026-08-09 → 2026-08-22). Cited for completeness only; repo views are not site visitors and are **not** a substitute for the GA4 inputs above |

No target (C1–C3) is marked met or unmet this cycle because none has been
measured; recording invented or premature numbers would defeat the gate.

## Rationale

1. The gate requires ≥2 weeks of production analytics; the window opened
   today. Deciding GO now would mean shipping an email-capture flow on zero
   evidence — exactly what the gate exists to prevent.
2. A signup form is the only feature on this site that collects personal
   data. Its privacy policy (Task 3.5) and GDPR posture currently rest on
   *collecting nothing*; adding collection without demonstrated need is a
   regression risk, not a growth lever.
3. NO-GO costs nothing operationally: the RSS feed (#27) already gives
   willing subscribers a machine-readable digest channel with zero PII.

## If the verdict flips to GO

Activation checklist (executed in a future sprint, only after this record is
amended to GO):

- Processor: an EU-hosted or EU-represented provider with a signed DPA,
  double-opt-in enforced server-side (e.g. Buttondown, Mailchimp with
  standard contractual clauses, or listmonk self-hosted in the EU).
- Flow: double opt-in only; consent timestamp + source URL stored; one-click
  unsubscribe; digest content sourced from `/feed.xml` items.
- Cadence: weekly digest, sent Fridays, containing offers published that
  week (from the feed), no tracking pixels.
- Privacy policy updated before the form ships, never after.

## Re-evaluation

On/after **2026-09-05**: pull the GA4 reports using the export steps in
[docs/outreach-kit.md](../outreach-kit.md) (Step 1), fill the weekly figures
table above, mark C1–C3 met/unmet with dated numbers, and amend this record:

- All three criteria trending toward their thresholds → flip to GO and
  activate the checklist.
- Any criterion clearly unmet after 30 days of data → keep NO-GO and record
  F13 as evaluated-and-shelved rather than pending.

Until amended, this NO-GO stands and F13 remains **not built**.
