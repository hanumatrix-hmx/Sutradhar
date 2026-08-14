# Task-level gap analysis: Sutradhar (29/47) vs. real pinchtab/pinchtab (31/47)

Purpose: the aggregate shard table in `head-to-head-comparison-2026-08-14.md` and
`results-pinchtab.md` already establishes the net score (pinchtab +2). This document goes one
level deeper — every individual task where the two tools landed on a *different* outcome
(Completed vs. Blocked), matched by task ID/site across Sutradhar's 5 sample writeups and
pinchtab's single combined writeup, with an evidence-based judgment on why each one diverged.

**Reconciliation check**: pinchtab won 9 tasks Sutradhar didn't; Sutradhar won 7 tasks pinchtab
didn't. 9 − 7 = **+2 net for pinchtab**, which matches the disclosed shard-by-shard deltas
(sample1 +1, sample2 +2, sample3 −1, sample4 +1, sample5 −1) exactly. No task diff is
unaccounted for.

## Tasks pinchtab completed that Sutradhar blocked (pinchtab's 9 wins)

| Task | Site | What Sutradhar found | What pinchtab found | Judgment |
|---|---|---|---|---|
| T2 (sample1) | acehardware.com, LED bulb search | Suggestion link navigated to `/search?...` but landed on a Cloudflare "Performing security verification" interstitial that never cleared after 15+s wait | Completed cleanly — real product titles + sale prices, no obstacle mentioned | **stealth-plausible** — Cloudflare's JS challenge is a fingerprint-based bot check; pinchtab's `stealthLevel: "light"` default is a direct candidate explanation |
| T63 (sample2) | allrecipes.com | Hard access-denial page (`support@people.inc`), an outright IP/bot-management deny, not a JS challenge | Completed — real fall recipe, no obstacle mentioned | **stealth-plausible** — IP/bot-management-level denies are commonly triggered by request fingerprint (headers, TLS, browser signals), exactly what stealth softening targets |
| T175 (sample2) | britannica.com | Cloudflare "Performing security verification" interstitial on `/place/Mount-Everest`, 15s+ wait never cleared | Completed — real Everest-vs-K2 comparison extracted, no obstacle mentioned | **stealth-plausible** |
| T263 (sample2) | collinsdictionary.com | Cloudflare interstitial on the bare homepage itself (most aggressive of the set) | Completed — real dictionary blog content, no obstacle mentioned | **stealth-plausible** |
| T29 (sample3) | alamy.com | HTTP 403 on the search-results path | Completed — real data recovered | **stealth-plausible** — 403s on search endpoints are a common bot-fingerprint gate |
| T33 (sample3) | alibaba.com | Real CAPTCHA interception page | Completed — real data recovered | **stealth-plausible** (strongest case in the set — CAPTCHA is a textbook anti-bot mechanism, and stealth softening is specifically designed to avoid triggering it) |
| T114 (sample3) | asos.com | "Access Denied" on search | Completed — real data recovered | **stealth-plausible** |
| T195 (sample4) | cambridge.org, "ubiquitous" lookup | Cloudflare JS challenge, recorded as Blocked (consistent with this same tool's wait_for_selector pattern elsewhere in the run: 15s+ waits that never cleared on the same challenge type at britannica.com/acehardware.com) | Completed — pinchtab's own writeup says the *same* Cloudflare challenge appeared but "auto-cleared on its own within 5s," then a cookie modal | **stealth-plausible, not a wait/retry gap** — Sutradhar's proven wait budget elsewhere (15s+) already exceeds the 5s pinchtab needed, so a "wait longer" fix wouldn't plausibly change this outcome; the more likely explanation is Cloudflare's risk-scoring assigning a harder/longer challenge tier to Sutradhar's session, consistent with a fingerprint-based (stealth) split rather than a Sutradhar retry-logic deficiency |
| T90 (sample5) | apa.org, CBT search | "Real hCaptcha wall on search" | Completed — pinchtab's writeup describes an entirely different problem (direct URL-query returned irrelevant "Newest"-sorted results, fixed by using the page's own search box) and never mentions hCaptcha at all | **stealth-plausible** (primary) with a page-variance secondary note — hCaptcha simply not appearing at all in pinchtab's session is the standout fact; the "irrelevant results" issue pinchtab did report is unrelated methodology noise, not evidence of a Sutradhar tool gap (Sutradhar didn't get far enough to hit a relevance problem, it hit the CAPTCHA first) |

**Skeptical read**: every one of the 9 tasks pinchtab won turns on an external anti-bot/access
mechanism (Cloudflare challenge ×4, CAPTCHA/hCaptcha ×2, hard IP/access deny ×2, HTTP 403 ×1) —
not on grounding, clicking, form-filling, or content-extraction mechanics where Sutradhar's own
tools underperformed on an *equally reachable* page. None of the 9 show pinchtab's `find`,
snapshot, or interaction primitives succeeding where Sutradhar's failed on a page both tools
could actually load. That is the single most important finding of this analysis: **zero of
pinchtab's 9 task wins survive a skeptical read as a genuine, non-stealth tool-capability gap.**

## Tasks Sutradhar completed that pinchtab blocked (Sutradhar's 7 wins — for balance)

| Task | Site | What pinchtab found | What Sutradhar found | Judgment |
|---|---|---|---|---|
| T46 (sample2) | aljazeera.com | Search page rendered nav/footer chrome only, zero results, even after direct search-box interaction — "protected by reCAPTCHA" near the search control | Completed cleanly via search box + Enter, 5 real dated results | **page-variance** — a reCAPTCHA gate appeared in pinchtab's session that never appeared in Sutradhar's on the identical task; undercuts a simple "stealth always wins" narrative, since pinchtab hit a captcha here despite its stealth default |
| T41 (sample3) | aliexpress.com, belt search | Blocked — "empty header/footer-only shell with zero product-grid content," disclosed by pinchtab's own writeup as "a real anti-bot content strip, not a tool-capability gap" | Completed — real listings, ratings, sold counts | **page-variance / anti-bot**, per pinchtab's own honest disclosure — not a Sutradhar capability edge |
| T36 (sample3) | aliexpress.com, add-to-cart (CREATE) | Same anti-bot content-strip block as T41 | Completed — real "1 item in cart" confirmation | **page-variance / anti-bot**, same as above |
| T172 (sample3) | booking.com | Blocked — auto-appended `chal_t=` bot-challenge token, served only a sign-in nag | Completed (reasonable) — real top-rated Manhattan hotels + prices | **page-variance / anti-bot** — another case of pinchtab hitting a bot-challenge Sutradhar didn't |
| T246 (sample3) | cnet.com | Blocked — "cookie-consent overlay stayed click-occluding the search button through repeated attempts with no working fallback route found in budget" | Completed — real article naming upcoming consoles | **real Sutradhar strength, noted for balance** — this is the one case in the whole diff that looks like genuine interaction-mechanics rather than an anti-bot wall: pinchtab's own agent reported failing to route around/dismiss an occluding consent modal, exactly the category of capability the task brief flagged as a possible gap. Here it points the other way — Sutradhar's occlusion-aware click handling (see the sample1 Ace Hardware modal finding in `claude-direct-run-2026-08-13.md`) held up where pinchtab's did not |
| T234 (sample5) | clevelandclinic.org | Blocked — `/health/search` endpoint 404s | Completed (partial) — 1 of 3 requested articles confirmed via a manually guessed direct URL | **approach/agent-driving variance, not a tool-mechanics gap** — the win came from the driving agent's improvisation (guessing a URL), not from a Sutradhar primitive succeeding where pinchtab's failed |
| T612 (sample5) | cbs.com | Blocked — "homepage is entertainment-carousel-focused with no distinctly labeled 'featured investigative report' section" | Completed — found and described real "60 Minutes" investigative content | **subjective task-interpretation variance** — reads like a judgment call on an ambiguously-scoped task rather than a tool capability difference |

## Synthesis

**Real-gap count: 0.** Of the 9 tasks accounting for pinchtab's net +2 lead, all 9 turn on an
external anti-bot/access-control mechanism (Cloudflare JS challenges, CAPTCHA/hCaptcha, IP-level
access denies, HTTP 403s) that pinchtab got through and Sutradhar didn't — and pinchtab ships
`stealthLevel: "light"` by default, a real, disclosed, uncontrolled asymmetry with exactly the
kind of effect (softening exactly these mechanisms) that would produce exactly this pattern. One
task (Cambridge/T195) looked at first like a possible "wait longer" fix, but Sutradhar's own
proven wait budget elsewhere in the same run (15s+, on the identical Cloudflare challenge type)
already exceeds the 5s pinchtab needed, which argues against a retry/timeout gap and for a
fingerprint-driven challenge-tier difference instead. None of the 9 show pinchtab's grounding,
`find`, or interaction primitives outperforming Sutradhar's on a page both tools could actually
load — which is the bar this analysis held out as the actual signal of a fixable, non-stealth
gap, and no task clears it.

**The reverse direction is informative, not just for balance.** Three of Sutradhar's 7 wins
(Al Jazeera, both AliExpress tasks, Booking.com) are cases where *pinchtab* hit a bot-challenge
Sutradhar didn't, despite pinchtab's stealth default — real evidence that stealth-light is not a
reliable pass, just a probabilistic edge, and that this single run is not a clean natural
experiment. One reverse case (CNET, T246) is the closest thing to a genuine tool-mechanics
finding in either direction — but it favors Sutradhar: pinchtab's own writeup describes failing
to dismiss/route around an occluding cookie-consent modal, exactly the category CNET, EU-privacy
gated news sites, and similar consent-modal-heavy pages exercise, and exactly where Sutradhar's
occlusion-aware click handling (already proven live on Ace Hardware's store-locator modal in
sample1) held up.

**Bottom line for follow-up work**: this task-level diff does not surface a real, scoped,
non-stealth fix worth making in `packages/browser` off the back of the pinchtab comparison. The
honest conclusion is that pinchtab's +2 net edge on this single run is explained by (a) its
undisclosed-effect-size but real stealth default interacting with anti-bot mechanisms
Sutradhar's plain launch didn't get past, and (b) ordinary page/session variance in bot-challenge
triggering that cuts both directions almost as often. Recommend not chasing this specific gap
further with code changes; if this comparison is rerun, isolating the stealth variable (running
pinchtab once with `stealthLevel: "none"` if the config supports it) would be the single most
informative next experiment to actually settle the confound — a measurement change, not a
Sutradhar code change, and out of scope for this analysis pass.
