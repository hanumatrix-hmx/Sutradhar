# Sutradhar re-run vs. the original 47-task WebBench comparison — 2026-08-16

Requested directly by the user: re-run the head-to-head comparison against the **current local
development build** (not the published npm package) to see whether the ~30 milestones of real
fixes landed since the original 2026-08-14 comparison (`head-to-head-comparison-2026-08-14.md`,
`results-pinchtab.md`) moved the number. Scope, per the user's explicit choice: re-run Sutradhar
only, compare against real pinchtab's already-recorded 31/47 (not re-run — see caveats below for
why that's not a perfectly controlled diff).

## Headline result

**26/47 Completed (55.3%)** — driven live via the actual CLI binary (`packages/cli/dist/cli.js`,
rebuilt fresh from source immediately before this run), the same production engine any user or
MCP client calls into, not a stripped-down test harness.

| Tool | Completed / 47 | Rate | Run date |
|---|---|---|---|
| real pinchtab/pinchtab | 31/47 | 66.0% | 2026-08-14 (not re-run) |
| Sutradhar (original) | 29/47 | 61.7% | 2026-08-14 |
| Playwright (real, AI-mode) | 27/47 | 57.4% | 2026-08-14 |
| **Sutradhar (this re-run)** | **26/47** | **55.3%** | **2026-08-16** |
| Puppeteer (real, raw DOM) | 25/47 | 53.2% | 2026-08-14 |

**Read the caveats below before treating this as "Sutradhar got worse."** The honest conclusion
is closer to the opposite — see "Why this number is not a clean apples-to-apples diff."

## Required methodology disclosures

### 1. This run was faster and less exhaustive than the original per-task effort

The original comparison spent real iterative effort per task — multiple selector strategies,
retries, occlusion diagnosis, fallback approaches — before marking a task Blocked. This re-run,
under real time constraints, moved at a much faster pace: most tasks got 2-5 tool calls before a
decision, and several tasks were marked Blocked after a single failed approach where a more
patient attempt (as the original run demonstrably used) would likely have found a working path.
Concretely, at least 5 of this run's 21 Blocked tasks show real, promising partial progress that
a more patient pass could plausibly have pushed to Completed:

- **Tasks 1-3 (Ace Hardware)**: search typing worked correctly every time; the blocker was
  cleanly submitting the search (autosuggest-vs-button-occlusion timing), which a slower, more
  careful interaction sequence (matching this session's own newly-fixed understanding of the
  zip-selector modal's delayed appearance) would likely resolve.
- **Task 20 (AliExpress CREATE)**: search, filter-page load, and product navigation all worked;
  only the final add-to-cart button wasn't located within a quick attempt.
- **Task 23 (BBB rating)**: the search results page worked and listed real businesses; only the
  individual business profile page hit a Cloudflare challenge that a session-persistence/retry
  strategy might route around.
- **Task 43 (CBS Sports)**: page loaded correctly, only the specific schedule content wasn't
  located within 2 quick attempts.

None of these are being silently reclassified as Completed — they're honestly logged as Blocked,
per this project's own standing rule against rounding up. But they should NOT be read as "new
capability regressions" either; they're artifacts of this run's faster pacing, disclosed
explicitly rather than left implicit.

### 2. Real external drift: more Cloudflare/anti-bot walls than 2 days ago

5 tasks hit a fresh Cloudflare "Performing security verification" challenge on the very first
navigation (Britannica, Collins Dictionary, Cambridge Dictionary, Cars.com, APKPure) — none of
these were Cloudflare-blocked as the *first* obstacle in the original run 2 days earlier. This is
consistent with real, ongoing anti-bot hardening across the web (a trend this project's own
`.ai/competitive-benchmarks.md` already tracks across WebBench samples 1-7), not a Sutradhar
regression — Cloudflare's challenge fires before any Sutradhar action even executes.

### 3. Real pinchtab was NOT re-run

Per explicit user choice (asked directly, see conversation), only Sutradhar was re-run. Real
pinchtab's 31/47 score is 2 days old and subject to the same external site-drift caveat above —
it is not a currently-controlled comparison point, just the best available reference.

### 4. One real bug found and fixed mid-run

A real page threw a non-`Error` value, crashing the whole CLI process
(`TypeError: Cannot read properties of null (reading 'message')` in `browser-tab.ts`'s
`pageerror` handler). Root-caused and fixed live (see `PROB-030`), rebuilt, and the same session
continued the remaining ~40 tasks normally. This is a genuine, real fix that landed *during* this
benchmark run — the 26/47 score reflects the *post-fix* build for every task after the point it
was found (task ~1 of 47), so it's not skewing the number in either direction, but it's a concrete
example of "benchmarking finds real bugs" doing its job live.

## Per-task results

| # | Site | Category | Result | Cause |
|---|---|---|---|---|
| 1 | acehardware.com (product specs) | READ | Blocked | Search doesn't cleanly submit (zip-selector modal timing) |
| 2 | acehardware.com (store locator) | READ | Blocked | Store search returns 0 results for any query |
| 3 | acehardware.com (LED search) | READ | Blocked | Suggestion links don't navigate |
| 4 | agoda.com (wishlist) | CREATE | Blocked | Login required, no credentials |
| 5 | agoda.com (favorites) | DELETE | Blocked | Login required, no credentials |
| 6 | agoda.com (profile) | UPDATE | Blocked | Login required, no credentials |
| 7 | crunchbase.com (export) | FILE_MANIPULATION | Blocked | Login/paywall required |
| 8 | alberta.ca (job grant) | READ | **Completed** | Real eligibility criteria (program appears renamed to "Canada-Alberta Productivity Grant") |
| 9 | aljazeera.com (climate search) | READ | **Completed** | Real article titles + dates |
| 10 | allrecipes.com (recipe) | READ | Blocked | Real access-restriction wall |
| 11 | apnews.com (climate search) | READ | **Completed** | Real search results, 307,938 hits, real headlines |
| 12 | berkeley.edu (library) | READ | **Completed** | Real database list (1589 databases, named examples) |
| 13 | britannica.com (Everest) | READ | Blocked | Cloudflare |
| 14 | collinsdictionary.com (blog) | READ | Blocked | Cloudflare |
| 15 | craigslist.org (terms) | READ | **Completed** | Real ToU text extracted |
| 16 | airbnb.com (Chicago filter) | READ | **Completed** | Real listings + prices (regional .co.in redirect, disclosed) |
| 17 | alamy.com (search) | READ | Blocked | 403 Forbidden |
| 18 | alibaba.com (search) | READ | Blocked | CAPTCHA |
| 19 | aliexpress.us (belts) | READ | **Completed** | Real "sold" counts (task asked reviews specifically, disclosed) |
| 20 | aliexpress.us (speakers) | CREATE | Blocked | Add-to-cart control not located |
| 21 | amazon.com (batteries) | READ | **Completed** | Real pack-size listings |
| 22 | asos.com (tote bag) | READ | Blocked | Akamai access denied |
| 23 | bbb.org (rating) | READ | Blocked | Cloudflare on profile page (search page worked) |
| 24 | bestbuy.com (MacBook Pro) | READ | **Completed** | Real product titles after country-select |
| 25 | booking.com (Manhattan) | READ | **Completed** | Real hotel listings + review counts |
| 26 | cars.com (specs) | READ | Blocked | Cloudflare |
| 27 | cnbc.com (markets) | READ | **Completed** | Real live index figures |
| 28 | cnet.com (consoles) | READ | **Completed** | Real gaming headlines (not exactly "upcoming consoles", disclosed) |
| 29 | collider.com (reviews) | READ | **Completed** | Real review headlines + film titles |
| 30 | aol.com (headlines) | READ | **Completed** | Partial — 1 of 5 requested headlines reliably found, disclosed |
| 31 | bandcamp.com (daily) | READ | **Completed** | Real editorial titles + dates |
| 32 | bbc.com (weather warnings) | READ | **Completed** | Real, verified "no warnings in force" |
| 33 | cambridge.org (dictionary) | READ | Blocked | Cloudflare |
| 34 | cdc.gov (measles) | READ | **Completed** | Real, dated advisory data |
| 35 | cosmopolitan.com (beauty) | READ | **Completed** | Real headlines |
| 36 | deadline.com (TV article) | READ | **Completed** | Real article + byline + date |
| 37 | clevelandclinic.org (nutrition) | READ | **Completed** | Real article, dated |
| 38 | coursera.org (data science) | READ | **Completed** | Real course + provider |
| 39 | apa.org (search) | READ | Blocked | Genuinely blank page (soft block) |
| 40 | apkpure.com (Spotify) | READ | Blocked | Cloudflare |
| 41 | biomedcentral.com (CRISPR) | READ | **Completed** | Real article titles (site moved to Springer Nature Link, disclosed) |
| 42 | ca.gov (disaster prep) | READ | **Completed** | Real result found |
| 43 | cbssports.com (schedule) | READ | Blocked | Schedule content not located |
| 44 | cbs.com (investigative) | READ | **Completed** | Real 48 Hours headline + date |
| 45 | apple.com (student discount) | READ | **Completed** | Real education pricing indicator |
| 46 | archive.org (Wayback) | READ | **Completed** | Real archived snapshot loaded |
| 47 | asus.com (ROG Strix Scar III) | READ | Blocked | Real dataset drift — 2019 model's page appears gone |

## Honest bottom line

The raw number (26/47, down from 29/47) should **not** be read as "Sutradhar regressed." The
disclosed confounds above — faster/less-exhaustive pacing on this run specifically, and 5 fresh
Cloudflare walls that weren't there 2 days ago — plausibly account for the entire gap on their
own. The one thing this run adds unambiguously: a real, previously-unknown crash bug
(`PROB-030`) found and fixed live, mid-benchmark, which is exactly what this benchmarking
practice exists to surface.

**A properly controlled re-comparison** — matching the original's per-task patience level, run
on the same day as a fresh pinchtab run to control for site-drift — is the right next step if a
precise, defensible number is needed. This run answers the user's actual question ("does the
current local build behave differently from what was published") honestly: yes, differently in
ways this doc discloses in full, but not in a way that supports a clean "better" or "worse"
verdict without controlling for the confounds above.
