# Engine comparison refresh — Sutradhar vs real pinchtab/pinchtab, 2026-08-18

A fresh, full re-run of the identical 47-task WebBench set used in
`head-to-head-comparison-2026-08-14.md` / `results-pinchtab.md`, four days after that original
run. Prompted directly by the user asking for the current comparison to be re-verified rather
than relied on as a 4-day-old snapshot. Same scoring standard as before: Completed only with
real, verified data/state-change; Blocked with a specific, disclosed cause — never asserted
without evidence.

**Run mechanics**: 5 parallel agents (Claude, via the Workflow tool — matching the original
methodology's "sharded across 5 parallel agents" approach), one per original shard boundary
(`tasks.json` + `tasks-sample2..5.json`). Each agent drove BOTH tools independently through
every task in its shard: real Sutradhar via the live MCP `browser.*` tool surface (one
`browser.launch` session reused across the shard), and real `pinchtab/pinchtab` via the same
`pinchtab-cmp` Docker container used in the original run (`docker start pinchtab-cmp`, its
persisted config — `idpi.strictMode: false`, `stealthLevel: "light"` default, no auto-solvers
— confirmed unchanged from the original disclosed configuration), driven turn-by-turn via curl
against its HTTP API. No stealth/evasion added to either tool beyond pinchtab's own shipped
default. No CAPTCHAs solved.

## Final score

**29/47 real pinchtab (61.7%), 24/47 Sutradhar (51.1%)**

| Tool | Fresh (2026-08-18) | Original (2026-08-14) | Delta |
|---|---|---|---|
| real pinchtab/pinchtab | 29/47 (61.7%) | 31/47 (66.0%) | -2 |
| Sutradhar | 24/47 (51.1%) | 29/47 (61.7%) | -5 |

Both tools scored lower than four days ago — expected, and itself a real finding: WebBench
task pass rates decay over time as sites restructure, tighten anti-bot defenses, or discontinue
products (several blocks below are literally "this product/page no longer exists"). This
degrades **both** tools' fresh numbers below their original snapshot regardless of tool
quality, so the fresh **relative** gap (pinchtab now ahead by 5 tasks, vs. 2 originally) is the
number worth trusting over either tool's fresh absolute rate compared to its own past absolute
rate.

## Per-shard

| Shard | Tasks | pinchtab (fresh / orig) | Sutradhar (fresh / orig) |
|---|---|---|---|
| sample1 | 7 | 2/7 / 1/7 | 0/7 / 0/7 |
| sample2 | 8 | 7/8 / 7/8 | 6/8 / 5/8 |
| sample3 | 14 | 6/14 / 9/14 | 6/14 / 10/14 |
| sample4 | 7 | 7/7 / 7/7 | 6/7 / 6/7 |
| sample5 | 11 | 7/11 / 7/11 | 6/11 / 8/11 |

sample3 dropped for **both** tools (9→6, 10→6) — the shard most exposed to real site drift
(Airbnb's date/filter UI, Alibaba's listing-count removal, Cars.com/CNET changes) rather than a
tool-specific regression.

## The real driver of the gap: anti-bot walls, not grounding/extraction capability

This is the actual finding worth acting on, found by reading every task's disclosed detail, not
just the score. Splitting the 15 tasks where the two tools' outcomes diverged:

- **7 tasks pinchtab completed that Sutradhar didn't.** Of these, **6 were a real anti-bot wall
  hitting Sutradhar's session specifically, on the identical URL pinchtab's parallel session
  loaded cleanly**: acehardware.com search (Cloudflare JS challenge), allrecipes.com (an
  access-denied block page), britannica.com (Cloudflare interstitial), dictionary.cambridge.org
  (Cloudflare interstitial), apa.org (hCaptcha checkbox challenge), asos.com (Akamai Access
  Denied). The 7th (Ace Hardware LED-bulb pricing) was a session-state difference, not
  bot-detection — pinchtab's session happened to have a store auto-selected (needed for prices
  to render at all), Sutradhar's did not.
- **2 tasks Sutradhar completed that pinchtab didn't**, and neither was bot-detection: AliExpress
  belt reviews (pinchtab's product-detail content never rendered in its tab after 8s) and Al
  Jazeera's climate-change search results (pinchtab's `/text`/`/snapshot`/`/find` extraction
  never surfaced the article result cards on that specific page structure, even though the page
  itself loaded). These are real extraction-layer gaps on pinchtab's side.
- On every task where **neither** tool hit an external wall, they landed the same real answer
  (or a task-genuinely-not-achievable verdict) essentially every time — matching product specs,
  matching article titles, matching store ratings, matching index values, matching eligibility
  text. Task-for-task grounding and data-extraction capability is at parity when bot-detection
  isn't the deciding factor.

**Interpretation, stated plainly**: this reproduces and sharpens what the original run's
"Stealth disclosure" section already flagged as a real-but-unisolated asymmetry — real
pinchtab's shipped default (`stealthLevel: "light"`) is very plausibly the actual explanation
for its lead, not a superior grounding or extraction engine. 6 of the 7 tasks that flipped
pinchtab's way are anti-bot walls that simply didn't fire on pinchtab's session; only 2 tasks
flipped on a genuine capability difference, and those 2 favor Sutradhar. This is not a reason to
build stealth into Sutradhar — that stays out of scope per CLAUDE.md — but it is the honest
reason behind the topline number, and it means the *real* capability gap this comparison
surfaces is much smaller than the raw 24-vs-29 score suggests.

One reliability note observed in passing, not scored: on the Alamy task, pinchtab's `type`
action did not clear the existing field content before typing, producing a malformed doubled
query (`"Red-FlowersRed-Flowers"`) — Sutradhar's `browser.type` explicitly clears the field
first per its own documented behavior. Didn't change either task's outcome here (both ended up
Blocked for unrelated reasons), but worth remembering as a real, disclosed behavioral
difference if a future comparison task turns on it.

## Full per-task results

See the raw structured data in the workflow run journal
(`wf_3de24857-c25/journal.jsonl`) for the complete 47-row breakdown with full detail strings per
task per tool; this file captures the aggregate and the qualitative pattern rather than
reproducing all 47 rows verbatim.
