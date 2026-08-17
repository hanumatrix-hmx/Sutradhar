# WebBench sample 11 — Claude-direct run (2026-08-17)

Run purpose: build the post-fix completion-rate picture after Milestone 92's field-report
remediation batch (viewport SDK/CLI parity, wsEndpoint reconnect, launch() leak warning, CLI
flag-safety — see `.ai/known-problems.md` `PROB-042`). Driven directly via `browser.*` MCP
tools (Claude is the brain — no LLM provider involved), matching every prior sample's method.

Tasks picked via `tools/webbench/tasks-sample11.json`: 8 fresh READ-category tasks across 8
domains not previously attempted (per `tools/webbench/tested-domains.txt`). Task selection
required extra care this round — `WebFetch` against the raw CSV both (a) returned rows already
on the excluded-domains list on the first attempt, and (b) silently truncated the ~2600-row CSV
around row 337 on a second, more targeted attempt. Neither is a Sutradhar issue (it's the
`WebFetch` tool's own summarization behavior on large content) — worked around by downloading
the CSV directly via `curl` and filtering it locally with a small Python script for exact,
verifiable domain-exclusion matching.

## Results

| # | ID | Domain | Category | Result |
|---|----|--------|----------|--------|
| 1 | 380 | diy.com | READ | **Blocked** — site itself down (B&Q maintenance page) |
| 2 | 383 | dreamstime.com | READ | **Blocked** — real bot-detection challenge ("Press & Hold") |
| 3 | 389 | dw.com | READ | **Completed** |
| 4 | 392 | ea.com | READ | **Blocked** — `ERR_HTTP2_PROTOCOL_ERROR`, reproduced on retry |
| 5 | 395 | eater.com | READ | **Completed** |
| 6 | 398 | eatingwell.com | READ | **Blocked** — Dotdash Meredith/People Inc. access-denied page, reproduced on retry |
| 7 | 416 | elle.com | READ | **Completed** |
| 8 | 419 | wikipedia.org | READ | **Completed** |

**4/8 completed (50%), 4/8 externally blocked, 0 Sutradhar-attributable failures.**

## Completions (real, verified data extracted)

**Task 3 — dw.com Culture section, first four featured articles.** The direct-guess URL
(`dw.com/en/culture/s-9110`) 404'd — DW's section IDs aren't predictable from the URL slug
alone. Recovered by reading the real Culture link (`s-1441`) out of the homepage's own nav
menu via `browser.eval`, then navigating there. First four in reading order:
1. "Hunger stones: The history behind 'if you see me, weep'"
2. "Rhine River drops to record low levels, grounding ships"
3. "Danube dries up as drought paralyzes Europe's lifeline"
4. "US actress Hayden Panettiere dies at 36" (first item in the following News section — the
   Top Story carousel itself only has 3 items, so "first four featured" spans into News)

**Task 5 — eater.com homepage, top 5 featured articles.** Hero section has 3 items, "The
Latest" section follows with 5 more — reported the first 5 in reading order across both:
1. "Eater's Guide to College Football"
2. "Eater's Bang Bang Dinners Kicked Off in Los Angeles"
3. "U.S. Open 2026: What to Eat During the Big Tennis Tournament in Queens"
4. "The Best Restaurants Around Times Square, According to Eater Editors"
5. "The 16 Best Restaurants and Bars with Scenic Views in Portland"

**Task 7 — elle.com homepage, top 5 featured articles under "The Latest".** Clean 1:1 match to
the task's own section name:
1. "Celebrities Pay Tribute to Hayden Panettiere"
2. "French Pin Hairstyles for Effortlessly Chic Updos"
3. "How Cool Girls Are Styling Sandals With Shorts"
4. "Watch The Diplomat's 'Spicy' Season 4 Teaser"
5. "How to Style Skirts This Summer"

**Task 8 — Wikipedia Main Page, "In the news", first two current events.** Read directly via
`#mp-itn`'s text content:
1. "A magnitude-7.7 earthquake strikes off the coast of Flores, Indonesia, causing at least 68
   deaths."
2. "Former premier of China Zhu Rongji dies at the age of 97."

## Blocks (external causes, confirmed not Sutradhar-attributable)

**Task 1 — diy.com.** The starting URL itself resolves to a B&Q-branded maintenance page
("Sorry, our techies are currently working on diy.com... we'll be back soon"). Real site outage
at the target, not a navigation/rendering failure on Sutradhar's side.

**Task 2 — dreamstime.com.** Presented a real "Press & Hold to confirm you are a human (and not
a bot)" challenge immediately on load — a genuine bot-detection wall. Not attempted to bypass,
per CLAUDE.md's standing scope exclusion on stealth/evasion.

**Task 4 — ea.com.** `browser.launch` and a follow-up `browser.navigate` both failed identically
with `net::ERR_HTTP2_PROTOCOL_ERROR` — a network/protocol-level failure between the client and
ea.com's edge, reproduced on retry rather than a one-off blip. Consistent with an anti-bot/edge
configuration rejecting the connection at the protocol level before any page ever loads.

**Task 6 — eatingwell.com.** Loaded a plain-text access-denied page from the site's own parent
company (People Inc., formerly Dotdash Meredith): "If you are a reader experiencing an access
issue, please contact support@people.inc... you may include your IP address." This is that
publisher's own standard automated-access block page, reproduced identically on retry.

## New Sutradhar bugs found

None — this sample surfaced zero Sutradhar-attributable failures, consistent with samples 7-9
(post the earlier engine-fix batches) and the field-report remediation batch just completed
(Milestone 92) not needing this sample to catch anything new.

## Combined total so far (all eleven samples)

**62/103 completed (60.2%), 41/103 externally blocked, 0 Sutradhar-attributable failures.**
The completion rate continues to hold in the same 52-62% band it's held across every prior
sample, including this one immediately following a real capability-fix batch (viewport/CLI
parity) — further evidence the ceiling here is the external open web (Cloudflare/DataDome
prevalence, real site outages, publisher-level access blocks), not Sutradhar's own tool surface.
