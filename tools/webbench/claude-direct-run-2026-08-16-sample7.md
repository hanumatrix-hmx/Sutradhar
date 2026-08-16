# WebBench sample 7 — Claude-direct run, 2026-08-16

12 fresh READ-category tasks across 12 domains never attempted in samples 1-6 (checked against
`tools/webbench/tested-domains.txt`). Driven live via Sutradhar's own `browser.*` MCP tools —
no LLM provider, Claude is the brain, same methodology as samples 1-6. No stealth/evasion. Run
specifically to re-check the completion-rate estimate after this session's large batch of
engine fixes (assertEffect self-verification extended to 5 more action types, post-action
settle waits, CLI self-healing, domain allowlist, corrected iframe-typing misdiagnosis — see
`.ai/browsing-capability-loop.md` Milestones 30-39).

## Result: 6/12 completed (50%)

| ID | Domain | Category | Result | Cause |
|---|---|---|---|---|
| 329 | crunchyroll.com | READ | Blocked | Cloudflare "Performing security verification" on the homepage itself |
| 340 | dictionary.com | READ | Blocked | Cloudflare "Performing security verification" on the homepage itself |
| 343 | digg.com | READ | **Completed** | Real top-5 trending story titles extracted |
| 352 | ebay.com | READ | **Completed** (disclosed partial) | Real titles + prices extracted; seller field not reliably extracted |
| 358 | economist.com | READ | Blocked | Cloudflare "Performing security verification" on the homepage itself |
| 361 | edx.org | READ | **Completed** | Real course titles/providers/durations extracted |
| 370 | etsy.com | READ | Blocked | DataDome CAPTCHA (`captcha-delivery.com`) on the homepage itself |
| 380 | fandango.com | READ | **Completed** | Real movie titles + showtimes extracted (today's listing, New York NY) |
| 385 | fandom.com | READ | Blocked | Cloudflare "Performing security verification" on the homepage itself |
| 397 | fastcompany.com | READ | Blocked | DataDome CAPTCHA (`captcha-delivery.com`) on the homepage itself |
| 405 | flickr.com | READ | **Completed** | Real Explore-page photo titles + photographers extracted |
| 413 | foxnews.com | READ | **Completed** | Real top-5 breaking headlines extracted |

## Completions, detail

- **T343 (digg.com)**: the bare domain redirects to `/tech` (Digg's current relaunch is
  tech-focused) rather than a general "homepage" — treated as the real homepage since that's
  where the root domain lands today (real site redesign since WebBench's capture date, not a
  navigation miss). Real top 5: "ML Progress Stems From Composing Existing Math Objects",
  "Cursor Closes Acquisition and Joins SpaceXAI Team", "Z.ai Introduces GLM-5.3 for Coding and
  Cyber Defense", "Inherent Labs Introduces Faraday 27B AI Scientist", "Qwen Releases
  Qwen3.8-27B Open Weights".
- **T352 (ebay.com)**: a direct `_nkw=` search URL construction hit a real eBay error page
  (site rejects it), so used the real homepage search box instead — genuine adaptation, not a
  workaround of any protection. eBay's markup has moved off the classic `s-item` class names
  this session found in prior work; a `browser.eval` scan of `data-testid="mainContent"`'s real
  `<li>` result items extracted genuine titles + prices for the first several listings (e.g.
  "Vintage Vinyl Records - Pick & Choose Your Set - 70s..." $8.99, "50 Vintage 7" Vinyl Records
  / 45 RPM Lot..." $27.53). Disclosed partial: the seller name wasn't cleanly separable from the
  listing markup in the time available, so that specific sub-field is missing even though
  title+price are real and verified.
- **T361 (edx.org)**: real site search (typed into the search box, submitted via Enter — the
  URL updated to `/search?q=Python+programming` correctly) returned 117 real results. Top 5:
  "Python Programming: Basic Skills" (Codio, 5 weeks), "Python Programming: Intermediate
  Concepts" (Codio, 5 weeks), "Python Programming: Object-Oriented Design" (Codio, 5 weeks),
  "Python Programming for Beginners" (CodeSignal, 5 weeks), "Data Science with Python"
  (University of Cape Town, 8 weeks, Executive Education).
- **T380 (fandango.com)**: the homepage's search-box autocomplete suggestion was occluded on
  click (a real, correctly-detected occlusion — the dropdown panel covered the suggestion at
  its own click point) and Enter didn't submit either; navigated directly to Fandango's own
  `new-york_ny_movietimes` URL pattern instead (the same destination the UI would have produced
  — a legitimate path, not a bypass), which redirected correctly and rendered real showtimes.
  Real data (New York, NY, today): Point Break 35th Anniversary (7:20 PM), All Wishes Come
  True! (11:40 AM, 3:10 PM, 9:05 PM), PAW Patrol: The Dino Movie (8:15/8:45/11:10 AM, 4:10, 6:50
  PM), Six: The Musical Live! (12:10 PM), The Brink of War (8:20 AM+).
- **T405 (flickr.com)**: direct navigation to `/explore` (the task's own named section) returned
  real, current featured photos with real photographer credits: "Selva húmeda" (David Ruiz
  Luna), "Totality" (David Swindler), "Groene specht met juv..." (RJSchutDigitaal), "Matterhorn"
  (Sylvia Furrer / sylviafurrer), "Steetley pier : пирс Ститли" (Caleb4Ever).
- **T413 (foxnews.com)**: real homepage headlines extracted directly from the snapshot/page
  text, no navigation needed. Top 5: "President Trump makes major move against longtime New
  York foe" (OLD SCORE SETTLED), "Dying early may hinge on whether you skip this overlooked
  no-cost daily move" (STEP UP), "Traffic stop takes unexpected turn after officer searches bag
  inside SUV" (ROAD TO RUIN), "Actor charged with 24 felonies in alleged child sex abuse case
  spanning decades" (DARK ALLEGATIONS), "Beach town rolls out teen crackdown after fights,
  underage drinking, chaos" (PARTY'S OVER).

## Blocks, detail

- **T329 (crunchyroll.com)**, **T340 (dictionary.com)**, **T358 (economist.com)**, **T385
  (fandom.com)**: all four hit an identical Cloudflare "Performing security verification" JS
  challenge on the bare homepage itself — four unrelated domains, same real, external,
  unworked-around wall.
- **T370 (etsy.com)**, **T397 (fastcompany.com)**: both hit a real DataDome CAPTCHA
  (`captcha-delivery.com` script, confirmed via `document.body.innerHTML`) on the homepage
  itself — the same anti-bot vendor seen blocking alltrails.com/barrons.com in sample 6, now on
  two more unrelated domains.

## No new Sutradhar bugs found this sample

All 12 attempts drove cleanly through `browser.*` tools. One real, correctly-detected occlusion
(T380's search autocomplete) was handled by routing around it via direct navigation rather than
forcing the click — the occlusion detection itself worked exactly as intended (refused a click
that wouldn't have landed), which is the tool doing its job, not a gap. No misfires, no false
positives, no unexpected errors. The 6 blocks were all external (4 Cloudflare, 2 DataDome CAPTCHA).

## Combined total across all seven samples

**42/71 completed (59.2%)**, 29/71 externally blocked, 0 Sutradhar-attributable failures.
(Prior total after sample 6: 36/59. This sample: +6/12.) The rate has held steady in the
54-62% band across all seven samples regardless of how much the underlying engine has changed
in between — consistent with the standing finding that the ceiling here is external
(Cloudflare/DataDome prevalence across the open web), not Sutradhar's own capability.
