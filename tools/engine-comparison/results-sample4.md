# Engine comparison — WebBench sample 4 (7 tasks)

Real Playwright (via `pw-server.mjs`, aria-ref/AI-mode snapshot + raw-DOM `links` fallback) and
real Puppeteer (via `pp-server.mjs`, flat indexed `list` of visible `a/button/input/select/textarea`
elements — Puppeteer's honest out-of-box capability, no curated grounding layer) were each driven
independently, one action per HTTP round trip, against the same 7 tasks Sutradhar scored 6/7 on
(see `tools/webbench/claude-direct-run-2026-08-14-sample4.md`). No stealth/evasion was used; any
Cloudflare/anti-bot wall was recorded as an honest external block.

## Results

| Task ID | Site | Category | Playwright | Puppeteer |
|---|---|---|---|---|
| 84 | aol.com | READ | Completed | Completed |
| 120 | bandcamp.com | READ | Completed | Completed |
| 141 | bbc.com | READ | Completed | Completed |
| 195 | cambridge.org | READ | Blocked — Cloudflare (external) | Blocked — Cloudflare (external) |
| 231 | cdc.gov | READ | Completed | Blocked — tool-capability |
| 273 | cosmopolitan.com | READ | Completed | Completed |
| 336 | deadline.com | READ | Completed | Completed |

**Playwright: 6/7 completed. Puppeteer: 5/7 completed.** Both tools hit the identical external
wall on task 195. The one divergence (task 231) is a genuine tool-capability gap, not an external
block — see detail below.

## Per-task detail

### Task 84 — aol.com — Completed / Completed
Top 5 business headlines (via Business News section, `aol.com/news/business/`), identical for
both tools:
1. Reddit surges on S&P 500 inclusion, set to replace AvalonBay (Reuters)
2. The burger wars are heating up as McDonald's loses ground (Business Insider)
3. Wall Street's riskiest trades are suddenly back on top: Chart of the day (Yahoo Finance)
4. 'Big Short' Michael Burry says the bulletproof AI narrative reminds him of dot-com (Business Insider)
5. China July bank loans post record contraction as credit demand falters (Reuters)

Playwright found the section via its raw-DOM `links` fallback filtering on "business", then
navigated straight there. Puppeteer's homepage `list` (capped at 120 visible interactive
elements) did not surface a Business/Finance nav link at all — the cap was consumed by
decorative/trending-content anchors before reaching the nav's dropdown items. Retrying `list` on
`/news/` (reached via the visible "Latest News" link) surfaced a "Business" link at index 104;
clicking it by its `data-pp-idx` selector did not navigate (page stayed on `/news/` — Puppeteer's
raw `page.click` on that particular anchor silently no-op'd, unclear why, possibly an overlay/lazy
hydration issue), so the fallback was a direct `navigate` to the discovered href. Both tools ended
up extracting identical real headlines; Puppeteer needed one extra hop and a click workaround to
get there.

### Task 120 — bandcamp.com — Completed / Completed
Top 3 featured editorial articles, identical for both tools (visible directly on the bandcamp.com
homepage without needing to navigate to daily.bandcamp.com):
1. Essential Releases, August 14, 2026
2. Cuba's DIY Scene Endures in the Face of Constant Crackdowns
3. Sweeping Promises Pick Their Bandcamp Favorites

No divergence — both tools' respective link-discovery primitives (PW's `links` filter, PP's raw
`list`) found the same anchors on the homepage in one shot.

### Task 141 — bbc.com — Completed / Completed
Both tools navigated Home → Weather (`bbc.com/weather`) → Weather Warnings
(`bbc.com/weather/warnings/weather`) and extracted the identical, real, current status text:
**"No weather warnings are in force for the UK."** A legitimate real answer (absence of active
warnings), not a failure to find something. No divergence.

### Task 195 — cambridge.org — Blocked (external) / Blocked (external)
`www.cambridge.org` itself returned a Cloudflare `503 Service Temporarily Unavailable` page for
both tools on `newTask`. Trying the dictionary subdomain directly
(`dictionary.cambridge.org/dictionary/english/ubiquitous`) redirected both tools to an identical
Cloudflare JS challenge page (`title: "Just a moment..."`, `__cf_chl_rt_tk` query param). Same
wall for both engines — confirms this is environment/site-level, not tool-specific, and matches
what Sutradhar hit on this same task.

### Task 231 — cdc.gov — Completed (Playwright) / Blocked — tool-capability (Puppeteer)
**Playwright**: raw-DOM `links` filter for "measles" on the CDC homepage immediately surfaced
`cdc.gov/measles/data-research/` ("Measles" text, 2 matching anchors). Navigating there and
reading `text()` gave the real, dated data: as of **August 13, 2026**, **2,566 confirmed measles
cases** reported in the US in 2026, across **47 jurisdictions**, with **38 new outbreaks**
reported and 94% of cases outbreak-associated, plus the full 2025 year-end comparison figures.

**Puppeteer**: the homepage's `list` action (visible `a/button/input/select/textarea` only, capped
at 120) never surfaced a measles-related link — the cap was exhausted by the site's A–Z
health-topics index links before reaching any topic-specific navigation. Following the visible
"Outbreaks" nav link (`cdc.gov/outbreaks/index.html`) and re-running `list` there returned only 62
total elements, none related to measles, even though `text()` on that same page clearly showed
"Measles Outbreaks 2025" as visible page content — meaning the actual outbreak-card links on that
page are not plain `<a>` tags with a non-zero bounding rect matching Puppeteer's raw selector
(likely JS-hydrated custom card components). No exposed search `<input>` was found on the homepage
list either (CDC's search is hidden behind a toggle not captured by the raw query). With no
element to target and no permitted hand-holding beyond the raw `list` capability, this is a
genuine **tool-capability block**: Puppeteer's flat, tag-restricted, visibility-filtered DOM query
could not discover a path to content that Playwright's less-restrictive raw-href/text scan found
in one query.

### Task 273 — cosmopolitan.com — Completed / Completed
Both tools navigated Home → Beauty section
(`cosmopolitan.com/style-beauty/beauty/`) → first article, and agreed independently on the same
first article: **"The Halo Braid Is the Romantic Hairstyle Trend Zendaya and Olivia Rodrigo Are
Loving for Summer"** (by Beth Gillette, published Aug 14, 2026). Both extracted essentially
identical body text: a halo braid — a braid wrapped around the head's perimeter — trending after
Zendaya wore one on the red carpet and Olivia Rodrigo wore one on stage with The Smashing
Pumpkins at Lollapalooza; hairstylist Stephanie Angelone's how-to (two braided pigtails bobby-
pinned up, or a wrap-around French braid) and tips (braid on second-day/greasy hair, use
texturizing powder for grip). No meaningful divergence.

### Task 336 — deadline.com — Completed / Completed
Both tools' first-pass homepage scan surfaced a TV-tagged story ("'Power Rangers' Live-Action
Series Not Moving Forward At Disney+") — real and verifiable, but a cancellation, not a "release,"
so a poorer fit for the task's "recent TV series release" framing (also noted as the discrepancy
Sutradhar's own run avoided). Both tools were then pointed at `deadline.com/v/tv/` and independently
found the same better-fitting article via their respective link-discovery primitives (PW's `links`
filter on "premiere"/"season", PP's `list` filter on the same terms): **"'Ted Lasso' Season 4
Enters The Pitch With Apple TV's Biggest Premiere Ever."** Series name: **Ted Lasso**. Network:
**Apple TV (Apple TV+)**. No divergence — same article, same extracted answer.

## Tool-capability differences observed

- **Link discovery breadth**: Playwright's `links` fallback action queries *all* `<a>` tags
  site-wide via `href`/`textContent` substring match, uncapped except for a final `slice(0,15)`.
  Puppeteer's `list` action restricts to `a, button, input, select, textarea`, filters to elements
  with a non-zero bounding rect (visible only), and hard-caps at 120 total elements in document
  order. On simple pages (bandcamp, bbc, cosmopolitan, deadline) both found the same targets with
  equal ease. On pages with large, noisy navigation (aol.com's mega-menu, cdc.gov's A–Z
  topic index) Puppeteer's cap got consumed by decorative/navigational chrome before reaching the
  actually-relevant link, forcing an extra manual hop (aol.com) or failing outright (cdc.gov) where
  Playwright's unrestricted, unfiltered query found the target directly.
- **Non-standard interactive elements**: cdc.gov's outbreak-topic cards were visible in rendered
  text but were not captured by Puppeteer's tag-restricted `querySelectorAll('a, button, input,
  select, textarea')` — consistent with JS-hydrated/non-anchor clickable components that a
  semantic accessibility-tree-based tool (Playwright's `ariaSnapshot(mode:'ai')`, or Sutradhar's
  own AX-tree grounding) would expose as clickable regardless of underlying markup, but that a
  flat DOM-tag query genuinely cannot see.
- **Click reliability**: on aol.com, Puppeteer's `click` by `data-pp-idx` selector silently failed
  to navigate on one occasion (URL stayed unchanged) where a direct `navigate` to the same href
  succeeded; Playwright's `aria-ref` click did not show this issue anywhere in this sample. Only
  one occurrence in 7 tasks, not enough to generalize, but noted as observed.
- **External walls affect both equally**: task 195's Cloudflare block hit both tools identically,
  confirming (again) that anti-bot walls in this environment are site/network-level, not a
  differentiator between browser-automation tools.
