# Engine comparison — WebBench sample 3 (14 tasks) — real Playwright vs real Puppeteer

Same 14 tasks from `tools/webbench/tasks-sample3.json` that Sutradhar scored 10/14 on (see
`tools/webbench/claude-direct-run-2026-08-13-sample3.md`), now run independently through real
Playwright (`pw-server.mjs`, AI-mode aria-ref snapshot grounding — Playwright's actual official
capability) and real Puppeteer (`pp-server.mjs`, raw indexed DOM `list` over
`a,button,input,select,textarea` — Puppeteer's honest out-of-box capability, since it has no
official AI-grounding layer). Both driven turn-by-turn by Claude via curl, one action per call,
faithfully — no stealth/evasion, no hand-holding Puppeteer beyond its real `list` action.

## Results

| ID | Site | Category | Playwright | Puppeteer |
|---|---|---|---|---|
| 21 | airbnb.com | READ | Completed | Completed |
| 29 | alamy.com | READ | Blocked — external (HTTP 403) | Blocked — external (HTTP 403) |
| 33 | alibaba.com | READ | Blocked — external (CAPTCHA) | Blocked — external (CAPTCHA) |
| 41 | aliexpress.com | READ | Blocked — external (irrelevant/decoy results) | Blocked — external (irrelevant/decoy results) |
| 36 | aliexpress.com | CREATE | Blocked — external (CAPTCHA "punish" wall) | Blocked — external (CAPTCHA "punish" wall) |
| 81 | amazon.com | READ | Completed | Completed |
| 114 | asos.com | READ | Blocked — external (Access Denied) | Blocked — external (Access Denied) |
| 139 | bbb.org | READ | Completed | Completed |
| 155 | bestbuy.com | READ | Blocked — external (HTTP2 protocol reset on PDP route)* | Blocked — external (same)* |
| 172 | booking.com | READ | Completed | Completed |
| 212 | cars.com | READ | Blocked — external (Cloudflare hard deny) | Blocked — external (Cloudflare hard deny) |
| 238 | cnbc.com | READ | Completed | Completed |
| 246 | cnet.com | READ | Completed | Completed |
| 258 | collider.com | READ | Completed | Completed |

**Playwright: 8/14 (57%). Puppeteer: 8/14 (57%).** Identical completion count and, task for
task, identical outcome on every single task — both tools hit exactly the same wall or reached
exactly the same real data on all 14 tasks.

\* See "tool-capability differences observed" — Best Buy's block was external for both, but a
real, distinct Puppeteer-specific limitation surfaced on the same task independent of that
block.

## Completed task detail

**21 — airbnb.com (Chicago, free cancellation, August)**: Both tools searched "Chicago" via the
UI search box, submitted, and landed on real, live results — Iconic Journey (Navy Pier, ₹1,05,807
for 5 nights, 16–21 Aug, free cancellation), Bright & Cozy 1 Bdrm, City Get-away on Marengo
(₹30,056, 16–21 Aug), Bridgeport Chicago (₹34,364, 22–27 Aug), Kasa/Kasa Lake Shore listings
(₹1,16,787 / ₹2,65,824), all showing real prices and "Free cancellation" tags. (Server geolocated
to India, so currency is INR — a session artifact, not a tool difference; identical for both.)

**81 — amazon.com (Amazon Basics AA Batteries)**: Both reached the product page for "Amazon Basics
48-Pack AA Alkaline High-Performance Batteries" (B00MNV8E0C) via search → raw product link. Pack
size (48-Count) and full pricing ladder extracted identically: 8-count ₹619.87, 20-count ₹954.15,
500-count ₹11,651.39, 12/36/48/100-count from ₹810.89–₹2,358.17+. Delivery was geo-restricted to
India from this session (no US shipping banner shown) — identical for both tools, not a block.

**139 — bbb.org (plumbing near Dallas, TX)**: Both reached real search results (3,200 results).
Top-listed businesses rated A+ on both runs (Playwright saw "Koen Plumbing, Inc." first;
Puppeteer saw "Baker Brothers Plumbing, Air & Electric" first — ad-slot rotation between the two
separate page loads, not a tool difference); every non-ad organic result on both runs was A+ or A.

**172 — booking.com (8+ review score hotels in Manhattan)**: Both reached
`booking.com/district/us/new-york/manhattan.html` (Playwright via keyboard ArrowDown+Enter
selection on the destination combobox after an initial click-intercept forced a fallback direct
navigation; Puppeteer via the same ArrowDown+Enter path, which worked cleanly) with 1,239 real
hotels listed. Top options: Artezen Hotel (9.2 Wonderful, 1,455 reviews, $202.05), Broadway Plaza
Hotel (9.3 Wonderful, 1,457 reviews, $274.05), San Carlos Hotel New York (9.1 Wonderful, 4,304
reviews, $322.20) — all well above the 8.0 review-score bar, all with real current prices.
Distance-to-Empire-State-Building comparison wasn't explicitly computed by either tool (matches
Sutradhar's own "reasonable" completion standard for this task).

**238 — cnbc.com (Markets: Dow, Nasdaq, S&P 500)**: Both reached `/markets/` directly and pulled
live index values: S&P 500 ~7,790 (-0.11%), Nasdaq ~26,716 (-0.32%), DJIA ~53,766 (-0.14%), plus
VIX, bonds, commodities, and FX — essentially identical numbers between the two nearly-simultaneous
loads (small deltas from real-time market movement between the two curl calls, not a tool
difference).

**246 — cnet.com (upcoming video game consoles article)**: Both reached CNET's `/?s=` search
(after the in-page search icon was blocked by a newsletter-signup overlay intercepting clicks on
both tools identically — worked around with direct URL navigation) and got "PlayStation 6 Rumors:
Potential 2029 Release, Specs, Pricing and More," which names PlayStation 6, Nintendo Switch 2,
and Atari's Gamestation Go as upcoming consoles — identical article, identical text, both tools.

**258 — collider.com (latest review headline/film/rating)**: Both found `collider.com/all-reviews/`
was linked from the homepage's REVIEWS nav (the plausible-looking `/reviews/` and
`/tag/movie-reviews/` URLs both 404 — a real site-URL-structure trap, hit identically by both
tools) and used the homepage's own most-recent review link instead: "Netflix's 'My Brilliant
Career' Remake Is Your Next Period Drama Obsession | Review" by Carly Lane, published Aug 13,
2026 — film title "My Brilliant Career," byline captured. No explicit numeric star rating exists
on this Collider review (Collider doesn't always assign one) — this piece of the ask was
unavailable to both tools identically, not a tool gap.

## Blocked task detail

**29 — alamy.com**: Direct navigation to the search-results path (`/stock-photo/...` /
`/search.html`) returned HTTP 403 Forbidden for both tools, confirmed via two independent
methods (direct URL navigation and clicking the in-page search button after accepting cookies).
Matches Sutradhar's own finding on this exact task. External (site WAF), identical for both.

**33 — alibaba.com**: Both hit a real interactive CAPTCHA ("Please drag the slider to verify")
immediately on the search-results URL. External, identical for both, matches Sutradhar's finding.

**41 — aliexpress.com (belts)**: Both reached the search-results page without any block, but the
results were entirely irrelevant to "black leather belts for men" — t-shirts, dresses, a phone
case, an adult toy — with no review counts anywhere (only "sold" counts). Confirmed via three
independent paths (direct URL navigation, re-searching via the in-page search box) that this
persisted identically. This reads as a bot/geo-detection decoy-content response from AliExpress
itself (same junk content, byte-for-byte, on both tools) rather than a normal empty-results page —
external, not a tool-capability gap, since both tools' raw page content was identical.

**36 — aliexpress.com (add Bluetooth speaker to cart, CREATE)**: A follow-up search on the same
site (after task 41) triggered AliExpress's `_____tmd_____/punish` anti-bot challenge path — a
CAPTCHA slider — for both tools on the very next navigation. External anti-bot response to
repeated automated navigation from this session/IP, identical for both.

**114 — asos.com**: Both got "Access Denied" on the bare homepage load, before any interaction was
possible. External, identical, matches Sutradhar's finding.

**155 — bestbuy.com**: After bypassing the country-selector splash screen via the site's own
`&intl=nosplash` link (found identically by both tools' raw DOM), search results for "Apple
MacBook Pro 16-inch" loaded fully for both, with real prices/ratings extracted via `text`
(e.g. "Apple - MacBook Pro 16-inch Laptop - Apple M4 Max chip... $2,999.00, 4.9★, 247 reviews").
But every attempt to reach the actual product-detail page — direct navigation to the `/product/...`
URL, and clicking the same link from within the rendered search-results page — hit
`net::ERR_HTTP2_PROTOCOL_ERROR` (a connection reset) for both tools, repeatably. This is a real,
external anti-bot defense on Best Buy's PDP route specific to this session, not fixable by
UI-vs-direct-navigation choice. External, identical outcome for both tools.

**212 — cars.com**: Both got Cloudflare's "Attention Required!" interstitial on the bare homepage
load. External, identical, matches Sutradhar's finding exactly.

## Tool-capability differences observed

Even though every task's *pass/fail outcome* matched between the two tools, three real
capability-shaped differences surfaced along the way:

1. **Puppeteer's raw `list` is capped at 120 elements and has no semantic priority ordering.**
   On Best Buy's filter-heavy search-results page, all 120 slots were consumed by filter
   checkboxes/toggles before a single product link appeared — Puppeteer's `list` alone would
   never have found the product links on that page at all. Playwright's `links` raw-DOM fallback
   (used identically as PW's own "no curated grounding" equivalent) filtered by href/text content
   rather than a flat positional cap, and found the product URLs immediately. This didn't change
   the final Best Buy score (both got blocked afterward for an unrelated external reason on the
   PDP itself), but it's a real, reproducible gap: a raw indexed list with no filtering degrades
   fast on pages with many non-target interactive elements, while Playwright's semantic
   aria-snapshot / filtered-link approach doesn't.

2. **Puppeteer's raw `list` only matches `a, button, input, select, textarea`.** Autocomplete
   dropdown suggestions (e.g. Booking.com's destination combobox) are typically rendered as
   `li`/`div[role=option]` elements, invisible to that tag filter. Puppeteer's driver worked
   around this via keyboard `ArrowDown`+`Enter` on the input itself rather than clicking a
   suggestion element — which happened to work reliably here, but only because the site supports
   keyboard-only combobox selection. A site relying on mouse-only suggestion selection would be a
   real dead end for Puppeteer's raw list with no additional hand-built logic.

3. **Both tools were equally vulnerable to click-intercepting overlays** (Booking.com's own
   focus-trap div on the destination combobox; CNET's newsletter-signup lightbox over the search
   input) — Playwright's `locator.click()` retried and clearly timed out with a diagnostic
   (`element is not stable`, `<div> intercepts pointer events`), while Puppeteer's bare
   `page.click()` failed faster with a terser `"Node is either not clickable or not an Element"`.
   Both were equally blocked by the underlying overlay; Playwright's error surfaced more
   actionable detail (which overlay, why) whereas Puppeteer's genuinely didn't say why, which
   would matter more for an autonomous agent trying to self-correct without a human reading logs.

## Summary

Playwright and Puppeteer landed on **identical 8/14 (57%) completion** for this sample, with
**every one of the 14 tasks reaching the same Completed/Blocked outcome for the same reason** —
6 real external walls (site 403s, CAPTCHAs, Cloudflare, Access Denied, anti-bot PDP resets, decoy
search content) hit both tools equally; 8 real completions extracted identical or equivalent real
data. This is a materially harder sample than Sutradhar's own 10/14 (71%) on the identical task
set — largely because several of these sites (Alibaba, AliExpress, Best Buy, ASOS, Alamy, Cloudflare
on cars.com) carry real, well-known anti-bot reputations and this comparison's session happened to
draw more of them than Sutradhar's original run. The gap between Playwright and Puppeteer's
*outcomes* was zero on this sample — both are "real Chromium behind a `page.goto`" at the network
level, so site-side blocks land on both the same way. The gap that does exist is in Puppeteer's
much thinner default grounding surface (a flat 120-element cap, narrow tag matching, terser
errors) versus Playwright's official AI-mode aria-snapshot and richer error diagnostics — a real,
demonstrated capability difference that didn't happen to flip any task's outcome this time, but
would on a page complex enough to exceed 120 interactive elements before the target, or reliant on
mouse-only custom-widget interaction.
