# WebBench sample 8 — Claude-direct run, 2026-08-17

7 fresh READ-category tasks across 7 domains never attempted in samples 1-7 (checked against
`tools/webbench/tested-domains.txt`). Driven live via the actual CLI binary (rebuilt fresh
immediately before the run — the connected MCP session in this environment is known-stale and
can't be restarted by Claude), no LLM provider, Claude is the brain, same methodology as
samples 1-7. No stealth/evasion. Run to re-check the completion-rate estimate after this
session's Milestones 61-67 (multi-hop iframe frame targeting, live SPA title accuracy in `snap`
and `tabs`, real PDF text extraction) — none of that batch's fixes turned out to be directly
exercised by this particular set of tasks, but the sample is still a real, honest data point.

## Result: 5/7 completed (71%)

| ID | Domain | Category | Result | Cause |
|---|---|---|---|---|
| 269 | commonsensemedia.org | READ | **Completed** | Real age rating + critique extracted from the Frozen review |
| 344 | delish.com | READ | **Completed** | Real recipe titles extracted from search results |
| 358 | deviantart.com | READ | **Completed** | Real artwork titles + usernames extracted from the homepage feed |
| 370 | dickssportinggoods.com | READ | Blocked | Genuine site outage ("Site Maintenance... try again after 12 hours") — external, not a block/anti-bot wall |
| 386 | drugs.com | READ | Blocked | Akamai edge "Access Denied" on the homepage itself |
| 431 | epa.gov | READ | **Completed** | Real press-release titles extracted from the homepage's own "Latest News Releases" section |
| 436 | espn.com | READ | **Completed** (disclosed caveat) | Real first-three article search results extracted, but their relevance to "Tokyo 2020 Olympics" is weak — see detail below |

## Completions, detail

- **T269 (commonsensemedia.org)**: typed "Frozen" into the site's own search box, clicked
  Search (not Enter — the search box has no form-submit-on-Enter wiring visible in the
  snapshot, so the button was used instead), clicked into the real "Frozen" review result.
  Extracted the real age badge ("age 5+") and the first sentence of the "Parents need to know"
  critique via `browser.eval` reading the actual rendered text (not the tool's own click
  success report) — a genuinely different verification than just trusting `snap`'s listing.
- **T344 (delish.com)**: typed "quick weeknight dinners" into the search box, clicked Search,
  real results page loaded (`/search/?q=quick+weeknight+dinners&type=Recipes`). Real first
  three: "Cheesy Bacon Ranch Chicken", "Dumpling Stir-Fry", "One-Pan Garlic Butter Chicken &
  Zucchini".
- **T358 (deviantart.com)**: the homepage feed's default 60-element `snap` cap only surfaced 3
  of the requested 5 artworks in the compact listing, so used `browser.eval` to directly query
  `a[aria-label*=", visual art"]` for the full set — a legitimate broader read of the same live
  DOM, not a different page. Real first five: "Etna saying hello" by JohnyG, "The Little Witch
  and the Forest Path" by Aum117, "Dream Team" by yonashek, "[Art exchange] Malakar stained
  glass" by Cutecumber-art, "Green" by Lumador.
- **T431 (epa.gov)**: the task's obvious next step — clicking "Search all news releases" to
  reach a dedicated listing — hit a real "Human Verification" interstitial (genuinely blocked,
  external, not attempted further per CLAUDE.md's scope boundary). But the homepage itself
  already lists exactly a "Latest News Releases"-style section with 3 real, current titles, which
  satisfies the task without needing the blocked page: "EPA Marks Two Cleanup Milestones and
  Announces Public Meeting for the Kerr-McGee Superfund Site in New...", "EPA Proposes Next Step
  in Chemsol Groundwater Cleanup in Piscataway, New Jersey", "New Hampshire: EPA and DOJ Protect
  Water Resources and Communities through Agreement to Stop Illegal...".
- **T436 (espn.com)**: the bare domain geo-redirected to `espn.in` (ESPN's India edition) rather
  than the US site WebBench's dataset assumed — a real, current site behavior, not a Sutradhar
  navigation bug. Typed "Tokyo 2020 Olympics" into the search box, submitted via Enter (the URL
  updated to `/search/_/q/Tokyo%202020%20Olympics` correctly), and extracted the real first
  three "Articles" results via `browser.eval` reading the actual page text: "Amanal Petros sets
  records with men's marathon win at…", "Marijne looks to take India into the top tier again at
  FIH Hock…", "Little League World Series winners: Baseball and softball". **Disclosed caveat**:
  these are ESPN's own real search results for that exact query, faithfully extracted — but
  none of them are actually about the 2020 Tokyo Olympics (a 6-year-old event by the dataset's
  capture date); this reads as ESPN's own search relevance/dataset-drift limitation on an old
  query, not a Sutradhar extraction failure. Counted Completed because the task ("search for X,
  list the first three results") was performed faithfully and accurately, not rounded up past
  what was actually found.

## Blocks, detail

- **T370 (dickssportinggoods.com)**: navigating to the homepage returned a genuine site-level
  "Oops, Something Went Wrong... We are working on the problem. Please try accessing the site
  again after 12 hours" page (confirmed via `browser.eval` reading the real body text, including
  a real Akamai error reference ID) — a real outage on the site's own infrastructure, not an
  anti-bot wall and not a Sutradhar-attributable failure.
- **T386 (drugs.com)**: navigating to the homepage returned a genuine Akamai edge "Access
  Denied... You don't have permission to access this server" page (confirmed via
  `browser.eval`, including a real Akamai error reference and `errors.edgesuite.net` link) —
  an external network-edge block, not something client-side automation can route around without
  crossing into stealth/evasion, which is out of scope per CLAUDE.md.

## New bugs found this sample

None. All 7 tasks either completed with real extracted data or hit a genuinely external,
independently-confirmed block/outage; nothing pointed to a Sutradhar-side defect.

## Combined total so far

**Combined across all eight samples: 47/78 completed (60.3%), 31/78 externally blocked, 0
Sutradhar-attributable failures.** The completion rate continues to hold in the same 52-62%
band this project has seen across every independent sample since 2026-08-13 — external
anti-bot walls, CAPTCHAs, and (this sample) real site outages/geo-redirects/edge blocks remain
the dominant ceiling, not any engine defect. See `.ai/competitive-benchmarks.md`'s iteration
log for the full sample-by-sample history.
