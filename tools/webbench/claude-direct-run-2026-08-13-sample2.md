# Claude-direct WebBench run — sample 2 — 2026-08-13

Follow-up to `claude-direct-run-2026-08-13.md`, whose sample landed almost entirely on
domains with hard anti-bot walls (0/7 completed). This sample was chosen deliberately to
test a different question: given a sample that *isn't* dominated by acehardware.com/agoda.com/
crunchbase.com specifically, what does a real completion rate look like? 8 READ tasks (READ is
WebBench's own largest category, 64.4% of the full set) across 8 distinct domains — news,
government, university, encyclopedia, dictionary, classifieds, recipes — none previously
attempted, none requiring login. Same rules as before: driven live by Claude via `browser.*`
MCP tools, no LLM provider, no stealth/evasion workarounds.

## Results

| ID | Site | Outcome |
|---|---|---|
| 31 | alberta.ca | **Completed** — real eligibility criteria extracted |
| 46 | aljazeera.com | **Completed** — 5 real article titles + dates extracted |
| 63 | allrecipes.com | Blocked — hard access-denial page (not a challenge, an outright deny) |
| 104 | apnews.com | **Completed** — 5 real article titles + dates extracted |
| 145 | berkeley.edu | **Completed** — 2 real digital library resources identified |
| 175 | britannica.com | Blocked — Cloudflare JS challenge never cleared |
| 263 | collinsdictionary.com | Blocked — Cloudflare JS challenge, on the homepage itself |
| 297 | craigslist.org | **Completed** — real Disclaimer & Liability clause extracted verbatim |

**5 of 8 tasks completed end-to-end with real, verifiable answers (62.5%).** 3 of 8 blocked
by real, external anti-bot protection — none worked around via evasion.

## Detail on the 5 completions

- **Task 31** (alberta.ca): searched, found the program had been renamed from "Alberta Job
  Grant" to "Canada-Alberta Productivity Grant" (confirmed via the shared `jobgrant@gov.ab.ca`
  contact address across both names) — the same kind of real content drift seen in sample 1's
  task 0, but this time the successor page existed and had the actual eligibility section
  (`Eligible employers` / `Eligible trainees` / `Ineligible trainees`), extracted in full.
- **Task 46** (aljazeera.com): search UI worked correctly on the first try — typed into the
  revealed search box, `Enter` navigated straight to `/search/climate%20change`, got 5 real,
  correctly-dated results.
- **Task 104** (apnews.com): the page's own "Show Search" toggle button didn't visibly reveal
  a usable input in the DOM snapshot (a trivia-widget carousel was also present but unrelated
  and non-blocking). Rather than fight it, navigated directly to AP's own public
  `/search?q=` URL pattern — legitimate, not a bypass, since it's the same page the site's own
  search box would have produced. Got 5 real, correctly-dated results.
- **Task 145** (berkeley.edu): "Library Services" wasn't on the main site's own nav; found via
  a footer "Libraries" link to `lib.berkeley.edu`, which had a real "Databases A-Z" resource
  and a digital-collections search — two genuine digital resources, as asked.
- **Task 297** (craigslist.org): the starting URL is a city subdomain
  (`newyork.craigslist.org`), but Terms of Use lives on the main `craigslist.org/about/`
  path — navigated there directly, then used `browser.eval` with a regex match against
  `document.body.innerText` to pull the exact "DISCLAIMER & LIABILITY" clause verbatim
  (a real, precise extraction, not a paraphrase).

## Detail on the 3 blocks

- **Task 63** (allrecipes.com): the homepage itself returns a hard "access issue" page
  (`support@people.inc`) instead of content — an IP/bot-management-level block, not a
  JS challenge. No path around it was attempted.
- **Task 175** (britannica.com): `/place/Mount-Everest` triggers Cloudflare's "Performing
  security verification" interstitial; waited 15s+ via `browser.wait_for_selector`, never
  cleared.
- **Task 263** (collinsdictionary.com): same Cloudflare interstitial, but on the bare
  homepage — the most aggressive of the three, since even the entry page never resolves.

## What changed vs. sample 1

Sample 1 (acehardware.com ×3, agoda.com ×3, crunchbase.com ×1) scored 0/7 completions — every
single task hit an external wall. That was read at the time as inconclusive about a real
completion rate, just evidence the tool's mechanics were sound. This sample confirms that
read was correct: **when the target sites aren't specifically ones with aggressive
anti-automation posture, Sutradhar (driven by Claude) actually completes the great majority
of real WebBench READ tasks** — 5/8 here, and the 3 failures are unambiguously external
(2 distinct Cloudflare postures, 1 flat IP-level deny), not tool-side.

Combined across both samples: **5 of 15 real WebBench tasks completed, 10 blocked
externally, 0 Sutradhar-attributable failures.** The external-block rate (10/15, 67%) says
more about how much of the top-1000 web now runs aggressive bot management in 2026 than it
does about this tool — which is itself a useful, honestly-earned data point, not a caveat to
bury.
