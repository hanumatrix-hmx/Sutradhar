# Claude-direct WebBench run — sample 4 — 2026-08-14

Fourth sample, run as the first iteration of an autonomous `/loop` continuing the standing
WebBench benchmarking work per `CLAUDE.md`. All READ, across 7 domains never touched in
samples 1-3 (news portals, an editorial music blog, a public broadcaster, a dictionary, a
government health agency, a magazine, and an entertainment trade publication) — cross-checked
against `tools/webbench/tested-domains.txt` before selecting.

## Results

| ID | Site | Outcome |
|---|---|---|
| 84 | aol.com | Completed — real top 5 business headlines |
| 120 | bandcamp.com | Completed — real top 3 featured article titles |
| 141 | bbc.com | Completed — real current UK weather-warning status |
| 195 | cambridge.org | Blocked — Cloudflare JS challenge |
| 231 | cdc.gov | Completed — real, dated measles case-count summary |
| 273 | cosmopolitan.com | Completed — real first-article summary |
| 336 | deadline.com | Completed — real series name + network |

**6 of 7 completed end-to-end with real, verifiable answers (86%).** 1 of 7 blocked
(Cloudflare — the same wall britannica.com and collinsdictionary.com hit in earlier samples;
dictionary/reference sites in this dataset seem to cluster on aggressive Cloudflare tiers).

## Detail

- **Task 84** (aol.com): homepage didn't have an obviously business-tagged section in the
  default view; found a real "Business News" link via `browser.eval` scanning `<a>` hrefs for
  `/finance|business/`, navigated directly, got 5 real headlines with real bylines (The
  Independent US, The Motley Fool ×2, CBS News, Moneywise).
- **Task 141** (bbc.com): the honest, current answer is "No weather warnings are in force for
  the UK" — BBC's real Met-Office-sourced warnings page. A legitimate real answer, not a
  failure to find something that happened to not exist right now.
- **Task 231** (cdc.gov): the literal "measles advisory" URL pattern I guessed
  (`emergency.cdc.gov/han/...`) 404'd; the real content lives on the topic's own
  "Cases and Outbreaks" page instead — real, dated (Aug. 7, 2026), with a full case-count
  breakdown (2,465 confirmed 2026 cases, 47 jurisdictions, 38 new outbreaks).
- **Task 336** (deadline.com): first real TV headline was "'Ted Lasso' Season 4 Enters The
  Pitch With Apple TV's Biggest Premiere Ever" — series name and network both directly in the
  headline.

## Combined result across all four samples

| Sample | Completed | Blocked | Total |
|---|---|---|---|
| 1 (2026-08-13) | 0 | 7 | 7 |
| 2 (2026-08-13) | 5 | 3 | 8 |
| 3 (2026-08-13) | 10 | 4 | 14 |
| 4 (2026-08-14) | 6 | 1 | 7 |
| **Total** | **21** | **15** | **36** |

**21 of 36 real WebBench tasks completed end-to-end with real, verifiable answers (58%).** 15
of 36 blocked by external anti-bot/auth walls (confirmed in Milestone 16 to be
environment-level, not Sutradhar-specific — any browser-automation tool from this machine
hits the same walls). Zero Sutradhar-attributable task failures across all 36 attempts.
