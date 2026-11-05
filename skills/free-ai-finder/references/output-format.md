# Output format

Read at Step 4 (Find output), Step 5 (Re-check report), and Step 7 (Claim
output). The examples show the expected output; their offers and values are
illustrative and change daily. Put the main result first, keep every check
mark honest, and adapt wording to the user's need.

## Report block

Every phase report uses this block. The first line carries the result.

    ◆ <phase> — <need or offer>: <one-line result>
      <check>:  √ | × | — <short note>
      Result:   PASS | PARTIAL | FAIL

`√` passed, `×` failed, `—` skipped or not applicable. A skipped check is
never `√`.

## Find output (Step 4)

Result rules: **PASS** when the catalog script and the web pass both ran
(any row count, including fewer than 10); **PARTIAL** when one of them
failed or no row qualified; **FAIL** when both failed.

Expected output for "free text-to-speech API, no credit card":

    ◆ Find — "text-to-speech API, no card": 6 offers (5 free, 1 promo)
      Catalog:   √ 5 fits of 15 matches (live catalog, built 2026-11-05)
      Web pass:  √ 1 promo confirmed, 2 dropped (no official quote)
      Rows:      √ 6 complete
      Result:    PASS

    | # | Offer (provider) | What you get | Free/Promo | Card | Claim by | Checked |
    |---|------------------|--------------|------------|------|----------|---------|
    | 1 | Cartesia Free Plan (Cartesia) | Free monthly TTS credits | Free | no-card | ongoing | 2026-11-05 |
    | 2 | AssemblyAI $50 Free Credits (AssemblyAI) | $50 speech-to-text credit, no expiry | Free | no-card | ongoing | 2026-11-05 |
    | … | | | | | | |
    | 6 | Pro plan 50% off (ExampleVoice) | 3 months at $11/mo, then $22/mo | Promo | card | 2026-11-30 | 2026-11-05 (web) |

    **How to get each**
    1. Cartesia — sign up at play.cartesia.ai (no card), create an API key,
       use the free credits. Labels: review_status=under-review ·
       verification=social_proof · signup=required. Source: https://cartesia.ai/pricing
    …
    6. ExampleVoice — official page says "50% off Pro for your first 3 months
       through Nov 30". Price after the promo: $22/month. Source: <official URL>

    **Evidence** — rows 1–5: freetokens catalog listings as last checked on
    the date shown. Row 6: confirmed today on the quoted official page.

    **Not checked** — no claim was attempted; terms can change after the
    check date; region and eligibility limits may apply.

    **Decision** — Reply with a number to claim it — I'll re-check it live
    and walk you through each step.

Rules for the table:

- **What you get** paraphrases the amount in at most 12 words; the full
  amount text stays in the source. Add a stated commercial-use, watermark,
  or region limit in a few words.
- **Claim by** is the enrollment deadline, `ongoing`, or `unknown`.
- **Checked** is the catalog `last_checked` date, or today with `(web)` for a
  web row.
- Copy each catalog row's trust labels verbatim into its "How to get each"
  line.
- List dropped matches and gated programs that did not fit, one line each,
  only when the user asks why an offer is missing.

## Re-check report (Step 5)

Result rules: **PASS** = confirmed, **PARTIAL** = changed, **FAIL** =
unconfirmed. On PARTIAL or FAIL the user decides whether to continue.

    ◆ Re-check — AssemblyAI $50 Free Credits: confirmed
      Official page:  √ https://www.assemblyai.com/docs/billing-and-pricing (read 2026-11-05)
      Quote:          √ "New accounts receive $50 in free credits …"
      Result:         PASS

## Claim output (Step 7)

Result rules: **PASS** = claimed (the verify step passed), **PARTIAL** =
stopped by the user, **FAIL** = blocked.

    ◆ Claim — AssemblyAI $50 Free Credits: claimed (5 of 5 steps)
      Steps:      √ 5/5 done (user-reported)
      Verify:     √ $50.00 credit on the billing page (user-reported)
      Test call:  — skipped by the user
      Result:     PASS

Then four short lines:

- **Evidence**: the Step 5 URL and quote; every checkpoint reply is labeled
  user-reported, because you did not see the user's account.
- **Not checked**: credit expiry, usage limits, and terms after today.
- **Next**: dates to remember (credit expiry, trial end, auto-renew). When
  blocked, name the next-ranked row. When a catalog listing proved wrong,
  name the field (for example "claim step 2 no longer matches the page").
- **Decision**: the one choice left to the user, or "No approval needed."
