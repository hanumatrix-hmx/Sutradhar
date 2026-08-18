# WebBench sample 13 — Claude-direct run (2026-08-18)

Run purpose: continuing the standing WebBench loop per the user's open-ended "you decide how to
proceed" directive, building on sample 12's post-0.4.0 baseline. Driven live via `browser.*` MCP
tools (Claude is the brain, no LLM provider).

Tasks picked via `tools/webbench/tasks-sample13.json`, filtered against
`tools/webbench/tested-domains.txt`. Dropped `aliexpress.us` as a same-brand duplicate of the
already-tested `aliexpress.com`.

## Results

| # | ID | Domain | Result |
|---|----|--------|--------|
| 1 | 555 | foodandwine.com | **Blocked** — People Inc./Dotdash Meredith access-denied page (same as `eatingwell.com` in sample 11) |
| 2 | 558 | forbes.com | **Blocked** — DataDome CAPTCHA on the Forbes Advisor subsection specifically |
| 3 | 568 | ford.com | **Blocked** — `ERR_HTTP2_PROTOCOL_ERROR`, reproduced on retry (same signature as `ea.com` in sample 11) |
| 4 | 574 | fortune.com | **Completed** |
| 5 | 580 | foxsports.com | **Blocked** — genuine dataset/timing drift (NBA off-season, no current "NBA Finals" article exists; search itself worked correctly once a real UI obstruction was diagnosed and worked around) |
| 6 | 589 | freepik.com | **Blocked** — site-wide "security filter" bot-detection wall, even on the plain homepage |
| 7 | 597 | frontiersin.org | **Completed** — and **found + fixed a real bug along the way, see below (`PROB-044`)** |
| 8 | 604 | gamerant.com | **Completed** |
| 9 | 613 | gamespot.com | **Blocked** — Cloudflare "Just a moment…" interstitial, confirmed not clearing after 6s+ |
| 10 | 622 | gamesradar.com | **Completed** |
| 11 | 633 | genius.com | **Blocked** — site-wide "Sorry, we have to make sure you're a human" wall |
| 12 | 636 | georgia.gov | **Completed** |

**5/12 completed (41.7%), 7/12 externally blocked (58.3%).** A notably bot-wall-heavy sample by
chance — 5 of the 7 blocks were CAPTCHA/Cloudflare/bot-detection specifically, pulling this
sample's rate below the established band. Zero Sutradhar-attributable *task* failures — but one
real Sutradhar bug was found and fixed while completing task 7, see below.

## Real bug found and fixed: `PROB-044`

While completing task 7 (frontiersin.org), `click_by_text` failed with "No element found
containing text" against a real search-result title where the matched query words
("artificial", "intelligence", "healthcare") were each wrapped in their own `<mark>` element for
highlighting — an extremely common real-world UI pattern. Root cause: the underlying XPath used
`contains(text(), ...)`, which only matches an element's *direct* text-node children, not text
concatenated across sibling elements. Fixed with the standard `contains(., ...) and
not(.//*[contains(., ...)])` idiom (matches concatenated descendant text, preferring the
deepest/most specific match). `packages/browser` 187/187 (1 new regression test). Full downstream
rebuild+retest: `capability-runtime` 90/90, `cli` 32/32, `mcp-server` 25/25, `sutradhar` 11/11,
`agent` 56/56, `apps/server` 28/28. Live-verified against the exact real page that surfaced it,
via direct `SutradharRuntime` scripting: `clickByText` now succeeds and opens the correct article.
Full detail: `PROB-044` in `.ai/known-problems.md`.

## Completions (real, verified data)

- **fortune.com**: top 5 featured business articles, real headlines extracted from the homepage.
- **frontiersin.org**: found the top AI-in-healthcare article via search, confirmed publication
  date (07 April 2025) and DOI (`10.3389/frai.2025.1518440`) directly from the article page.
- **gamerant.com**: top 5 search results for "Cyberpunk 2077", real headlines.
- **gamesradar.com**: top 3 search results for "comics", real headlines.
- **georgia.gov**: found the real "File Small Business Taxes" page via the site's own search,
  extracted the 3 essential steps (determine filing requirement, determine due date, gather
  required documents).

## Combined total so far (all thirteen samples)

**79/130 completed (60.8%), 51/130 externally blocked, 1 Sutradhar bug found and fixed this
sample (not counted as a task failure — `PROB-044` was root-caused and resolved within the same
session, matching this project's standing practice).** Down slightly from sample 12's 62.7% —
consistent with the established 52-63% variance band this rate has held across all thirteen
samples, this time pulled toward the lower end by an unusually bot-wall-heavy draw rather than
any real regression. Combined with this sample's real bug find+fix, this remains the pattern this
project has repeatedly confirmed: dogfooding real tasks finds real, fixable gaps in Sutradhar's
own tool surface even while the completion-rate ceiling itself stays dominated by the external
anti-bot landscape.
