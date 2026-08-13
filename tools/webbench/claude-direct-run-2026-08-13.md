# Claude-direct WebBench run — 2026-08-13

Not produced by `run.mjs` (the `agent.runGoal`-based harness). This is a manual record of a
run where **Claude drove Sutradhar's `browser.*` MCP tools directly**, the same way Claude
already drives Playwright MCP in other sessions — the primary benchmarking mode per the user's
correction (see `.ai/competitive-benchmarks.md`). No LLM provider was needed; Claude supplied
the reasoning. Same 7-task sample as `tasks.json`, same no-invented-scoring philosophy as the
harness: this records what actually happened per task, for a human (or judge) to score the way
WebBench's own creators do — human-in-the-loop review, not automated pass/fail.

## Results

| ID | Category | Site | Outcome |
|---|---|---|---|
| 0 | READ | acehardware.com | Answered honestly: target product doesn't exist in the current catalog |
| 1 | READ | acehardware.com | Blocked: store-locator backend API returns HTTP 403 |
| 2 | READ | acehardware.com | Blocked: `/search` results page never clears a Cloudflare JS challenge |
| 3 | CREATE | agoda.com | Blocked: requires a logged-in account, no credentials available |
| 5 | DELETE | agoda.com | Blocked: requires a logged-in account, no credentials available |
| 12 | UPDATE | agoda.com | Blocked: requires a logged-in account, no credentials available |
| 312 | FILE_MANIPULATION | crunchbase.com | Blocked: Cloudflare hard-blocks the `/discover` path outright |

## Detail

**Task 0** — searched for "Black & Decker Power Tool Combo Kit". The site's search-submit
button (a `type="button"` React element wired to client-side routing) didn't navigate on
click — neither via Sutradhar's click nor a raw `element.click()` via `browser.eval`, ruling
out a Sutradhar click-fidelity issue. Worked around by clicking an actual `<a>` suggestion
link and by browsing the Power Tools → Combo Power Tool Sets category directly (real `<a>`
navigation worked correctly both times). Neither path surfaced a Black & Decker product.
Confirmed via the site's own suggest API: the "Black+Decker" brand category
(`categoryId 4300`) exists but reports `count: 0`, and `/brands/black-decker` 404s. **The
product genuinely no longer exists on the live site** — WebBench's dataset was captured at
some point in the past; site catalogs drift. This is an honest, correct answer to the task
as asked, not a tool failure.

**Task 1** — typed "California" into the store-locator's city/zip field, submitted. The
underlying API call (`/api/commerce/storefront/locationUsageTypes/SP/locations`) returned
HTTP 403 consistently — confirmed via `browser.get_network_log`, reproduced across two
independent fresh sessions. Geocoding itself worked fine (Google's `GeocodeService.Search`
correctly resolved "California,US" to its centroid); the failure is specifically Ace
Hardware's own backend rejecting the location-search request.

**Task 2** — same domain. A suggestion-link click correctly navigated to
`/search?query=led+light+bulbs`, but the destination is a Cloudflare "Performing security
verification" interstitial that did not clear after 15+ seconds of waiting
(`browser.wait_for_selector`, timed out). Reproduced identically when the harness's earlier
`agent.runGoal` run hit a real CAPTCHA on this same domain (see the Milestone 13 log entry) —
acehardware.com appears to run fairly aggressive bot protection across multiple endpoints.

**Tasks 3, 5, 12** — all three explicitly require "your Agoda account." Confirmed the site
shows real Sign in/Create account controls with no active session. No credentials exist for
this environment, and creating a real throwaway account on a third-party service is the kind
of externally-visible, hard-to-reverse action this project's operating norms call for
checking with the user first, not just doing — so these were left as honest blocks rather
than worked around.

**Task 312** — navigating to Crunchbase's `/discover` (the path toward data export) returned
a hard Cloudflare "Sorry, you have been blocked" page — not a JS challenge, a full deny.

## What this run is and isn't evidence of

**Not evidence of a Sutradhar bug.** Every block above is an external, site-side condition
(anti-bot protection, missing credentials, catalog drift) — the same walls a human WebBench
annotator or any other browsing tool (Playwright, Puppeteer, a real PinchTab, Claude's own
computer-use) would hit attempting these exact tasks from an unauthenticated, non-residential
automated session today. Per `CLAUDE.md`'s scope boundary, none of these were worked around
via stealth/evasion techniques — that stays deliberately out of scope.

**Is evidence that Sutradhar's own mechanics held up correctly under real, adversarial
conditions**: occlusion detection (`verifiedClickOnHandle`) correctly refused every blind
click into a store-locator modal that kept reappearing across page loads, every single time,
across both Ace Hardware sessions — no silent misclicks. `browser.get_network_log` and
`browser.eval` were what actually diagnosed each of the three distinct real blockers (a 403
API, a stuck Cloudflare challenge, a hard Cloudflare block) precisely enough to tell them
apart and rule out Sutradhar-side causes for each.

**Net for "can Sutradhar be used this way"**: yes — every tool call did exactly what it
reported doing, every failure was a real, correctly-surfaced external condition, and diagnosis
tools (network log, eval, console/page-error capture) were sufficient to root-cause all of
them without guesswork. The unresolved piece isn't a tool gap, it's that 5 of 7 real-world
targets in this sample actively resist unauthenticated automated access — which is closer to
"realistic browsing conditions in 2026" than a benchmark artifact.
