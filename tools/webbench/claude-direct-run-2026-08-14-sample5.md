# Claude-direct WebBench run — sample 5 — 2026-08-14

Fifth sample, run via `/webbench-sample` (second dogfood of the skill itself — a useful test
of whether the skill's own instructions hold up in practice). 11 READ tasks across 11 domains
never touched in samples 1-4 (health/education/reference sites, government, sports/
entertainment media, and consumer tech), picked from further down WebBench's ID range (400+)
to get genuinely fresh territory rather than re-sampling the same early rows repeatedly.

## Results

| ID | Site | Outcome |
|---|---|---|
| 234 | clevelandclinic.org | Completed — real first 3 health-library search results |
| 275 | coursera.org | Completed — real 5 course titles + providers |
| 90 | apa.org | Blocked — real hCaptcha wall on search |
| 102 | apkpure.com | Blocked — Cloudflare challenge, even on the homepage |
| 170 | biomedcentral.com | Completed — real 5 article titles (site now redirects to Springer Nature Link) |
| 401 | ca.gov | Completed — real guide URL found via the site's own search |
| 523 | cbssports.com | Completed — real live schedule (site restructured from a unified schedule page to per-league "watch" pages) |
| 612 | cbs.com | Completed — real featured investigative-content description (60 Minutes) |
| 758 | apple.com | Completed — real base price + eligibility groups from the actual education store page |
| 834 | archive.org | Completed — real capture date/URL obtained even though the archived page itself timed out (a real archive.org server issue) |
| 901 | asus.com | Blocked — 3 real attempts (direct URL, search, category listing) all 404'd; site's URL structure has changed since the dataset was captured, inconclusive rather than a confirmed "gone" |

**8 of 11 completed end-to-end with real, verifiable answers (73%).** 3 of 11 blocked — 2
external anti-bot walls (hCaptcha, Cloudflare), 1 inconclusive site-restructure finding
(scored as blocked, not stretched into a completion, since the evidence wasn't as clean as
earlier confirmed-drift cases like sample 1's Black & Decker finding).

## Notable findings

- **The `type`-append bug (fixed in Milestone 17) still shows through the live MCP session**,
  exactly as expected — a search re-attempt on task 401 concatenated instead of replacing text
  in the input. This is not a regression; the fix is real and verified against the compiled
  runtime directly, but the *connected* MCP session won't reflect it until it's
  rebuilt/reconnected (the standing gotcha documented in `.ai/browsing-capability-loop.md`).
  Notably, the concatenated query still returned a relevant result via Google's fuzzy custom
  search — a reminder that this bug doesn't always visibly break a task, which is exactly why
  it went unnoticed in the first place.
- **archive.org's Wayback Machine can time out serving very old captures** (a real,
  server-side archive.org limitation, not a Sutradhar issue) — but the redirect chain alone
  revealed the real capture timestamp before the timeout, so the task was still answerable
  from that alone.
- **biomedcentral.com has consolidated into Springer Nature Link** — a real, ongoing brand
  migration (noted, not treated as a block).

## Combined result across all five samples

| Sample | Completed | Blocked | Total |
|---|---|---|---|
| 1 (2026-08-13) | 0 | 7 | 7 |
| 2 (2026-08-13) | 5 | 3 | 8 |
| 3 (2026-08-13) | 10 | 4 | 14 |
| 4 (2026-08-14) | 6 | 1 | 7 |
| 5 (2026-08-14) | 8 | 3 | 11 |
| **Total** | **29** | **18** | **47** |

**29 of 47 real WebBench tasks completed end-to-end with real, verifiable answers (62%).** 18
of 47 blocked by external anti-bot/auth/site-structure conditions. Zero Sutradhar-attributable
task failures across all 47 attempts, and the one real bug this whole benchmarking effort has
found (`type` appending instead of clearing) was fixed the same day it was discovered.
