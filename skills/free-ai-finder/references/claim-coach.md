# Claim coaching playbook

Read at Step 6. You coach; the user does every action in their own browser.
You never click, fill forms, sign up, or pay for the user, and you never use
browser-automation tools on the provider's site.

## The plan

1. Build 3–7 claim steps from the catalog's `claim_steps` or from the
   official page read in Step 5.
2. Label any step that neither source supports "(general guidance — the
   provider's screens may differ)".
3. End the plan with a **verify** step: the user sees the credit, free plan,
   or quota on the account's billing, usage, or dashboard page. The test
   call (below) is optional on top.
4. Show the plan as one numbered line per step. Then show step 1 only.

When the user reports steps already done, mark them √ in the plan and start
at the first open step.

## One step per message

Each step message has three parts:

- **Do**: one action, with the official URL when there is one.
- **You should see**: the observable result that means it worked.
- **If not**: the one or two most likely snags for this step.

End with: "Reply done, describe what you see, or say stop." Do not show the
next step before the user's checkpoint.

## Checkpoints

| User reply | Your action |
| --- | --- |
| done, or a description that matches "You should see" | Mark the step √. Show the next step. |
| a problem | Troubleshoot (below). |
| stop, later | Go to Step 7 with "stopped at step k of n". |
| a pasted secret | Secret response (below), then repeat the current step. |

## Troubleshooting

At most 3 rounds per step. Each round is one targeted question or one fix.

| Snag | Try |
| --- | --- |
| No verification email | Check spam and promotions folders, resend once, then try another email address. |
| Phone check rejects the number | Virtual and VoIP numbers are often refused; use a mobile number, or pick another offer. |
| Region not supported | Stop this offer. Suggest a fallback (below) without a region limit. |
| Credit not showing | Wait a few minutes, reload the billing page, and check the official FAQ: many grants apply to new accounts only. |
| Card or payment requested unexpectedly | Card disclosure (below). |
| Form error or bot check | Try another browser and turn off the VPN; still failing → blocked. |

After 3 rounds without progress, the step is blocked: offer a fallback, or
stop. The fallback is the next-ranked row from Step 4; on the Claim branch,
which has no ranking, offer a Find for the same need.

## Card disclosure

Before any step that asks for a card or payment method, state three facts
from the official page — the price after the free period, whether it
auto-renews, and how to cancel — writing "unknown" for any fact the page
does not give. Ask "Continue?" and wait for the answer.

## Secret response

- Never ask for, accept, or repeat passwords, card numbers, one-time codes,
  or API keys. Do not use a pasted key in any command.
- When the user pastes a secret: say it is now exposed in this chat, tell
  the user to revoke it in the provider's dashboard and create a new one,
  and do not quote it back.
- Keep keys in an environment variable the user sets in their own terminal:
  `read -rs PROVIDER_API_KEY && export PROVIDER_API_KEY` keeps the key out
  of shell history and out of this chat.

## Optional test call

Offer it after the verify step shows the credit.

1. Take the endpoint and request shape from the provider's official
   quickstart or API reference page. If you cannot read one, skip the test
   and say so. Never invent an endpoint.
2. Default: give the user one command to run in their own terminal. It reads
   the key from the environment variable and prints only the HTTP status,
   for example with `curl -s -o /dev/null -w '%{http_code}\n'`. Ask the user
   to report the status code.
3. Never run the call yourself: a variable the user exports never reaches
   your shell, and asking for the key would break secret-safe. Choose the
   cheapest request (list models, or one short word) and never `-v`.
4. Read the status the user reports: 2xx → the verify step passes. 401 or 403 → the key is
   wrong or not active yet. 402 or 429 → the credit is not applied or the
   quota is used; check the billing page.
