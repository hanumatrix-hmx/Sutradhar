# Engine comparison — WebBench sample 2 (real Playwright vs real Puppeteer)

Same 8 tasks as `tools/webbench/tasks-sample2.json`, on which Sutradhar (driven by Claude via
`browser.*` MCP tools) scored **5/8** (see
`tools/webbench/claude-direct-run-2026-08-13-sample2.md`). This run attempts each task
independently through real Playwright (`pw-server.mjs`, port 9501 — AI-mode ARIA snapshot +
ref-based grounding) and real bare Puppeteer (`pp-server.mjs`, port 9511 — raw indexed DOM
`list` of interactive elements only, no curated grounding layer, since Puppeteer has none out
of the box). No stealth/evasion. Same Chrome binary, headless, both servers.

## Results

| Task ID | Category | Site | Playwright | Puppeteer |
|---|---|---|---|---|
| 31 | READ | alberta.ca | **Completed** | **Completed** |
| 46 | READ | aljazeera.com | **Completed** | **Completed** |
| 63 | READ | allrecipes.com | Blocked — external (IP-level access deny) | Blocked — external (IP-level access deny) |
| 104 | READ | apnews.com | **Completed** | **Completed** |
| 145 | READ | berkeley.edu | **Completed** | **Completed** |
| 175 | READ | britannica.com | Blocked — external (Cloudflare JS challenge) | Blocked — external (Cloudflare JS challenge) |
| 263 | READ | collinsdictionary.com | Blocked — external (Cloudflare JS challenge, on homepage) | Blocked — external (Cloudflare JS challenge, on homepage) |
| 297 | READ | craigslist.org | **Completed** | Blocked — **tool-capability** (see detail) |

**Playwright: 5/8 completed. Puppeteer: 4/8 completed.** Both hit the identical 3 external
walls (allrecipes, britannica, collinsdictionary) — same as Sutradhar's independent run on this
sample, confirming those are genuinely site-side, not client-specific. The one divergence
(task 297) is a real tool-capability gap, not an external block — detailed below.

## Detail on completions

- **Task 31** (alberta.ca): Both tools typed "Alberta Job Grant eligibility" into the homepage
  search box and submitted. Both landed on the same search results, both found the program had
  been renamed to **"Canada-Alberta Productivity Grant"** (same content-drift finding Sutradhar
  hit on this task), and both navigated to `alberta.ca/canada-alberta-productivity-grant` and
  extracted the full **Eligibility** section verbatim: eligible employers (private sector,
  non-profit, First Nations/Metis Settlements) and eligible trainees (Canadian citizens,
  permanent residents, protected persons under IRPA).
- **Task 46** (aljazeera.com): Both tools revealed the hidden search UI, searched "climate
  change", and reached `aljazeera.com/search/climate%20change`. Both extracted the same 5 real
  titles + dates: "Afghanistan: Caught between climate change and global indifference" (21 Nov
  2024), "What does Islam say about climate change and climate action?" (12 Aug 2020), "Climate
  change is an emergency for everyone, everywhere" (5 Nov 2021), "Is climate change to blame for
  the California wildfires?" (last update 23 Jan 2025), "Iran's failure to tackle climate
  change – a question of priority" (9 Nov 2021).
- **Task 104** (apnews.com): Both tools navigated to AP's own `/search?q=climate%20change` URL
  (the same destination AP's own search box produces — legitimate, not a bypass) and extracted 5
  real titled/dated results: "The warming climate is forcing marathons to consider changes..."
  (Yesterday), "Human-caused climate change made Spanish, French fires much more likely..."
  (Jul 31), "Climate change created conditions for Canada fires..." (Aug 6), "How climate change
  is 'supercharging' Europe's droughts" (Jul 25), "Most of the Maldives may be unlivable in 50
  years..." (Aug 7).
- **Task 145** (berkeley.edu): "Library Services" isn't in the main nav for either tool; both
  found a footer "Libraries" link to `lib.berkeley.edu`, and both identified the same two real
  digital resources: **"Databases A-Z"** (`guides.lib.berkeley.edu/az.php`) and **"Search our
  digital collections"** (`digital.lib.berkeley.edu`).
- **Task 297** (craigslist.org) — **Playwright only**: navigated directly to
  `craigslist.org/about/terms.of.use` (the real Terms of Use page; the starting URL was the
  `newyork.craigslist.org` city subdomain, but Terms of Use lives on the main domain). Playwright's
  AI-mode ARIA snapshot (which surfaces generic/paragraph text nodes, not just interactive
  elements, up to a 14,000-char cap) reached far enough down the page to capture the
  **"DISCLAIMER & LIABILITY"** clause verbatim: *"To the full extent permitted by law,
  craigslist, Inc., and its officers, directors, employees, agents, licensors, affiliates, and
  successors in interest ('CL Entities') (1) make no promises, warranties, or representations as
  to CL... (2) provide CL on an 'AS IS' and 'AS AVAILABLE' basis... (3) disclaim all warranties...
  and (4) disclaim any liability or responsibility for acts, omissions, or conduct of you or any
  party in connection with CL. CL Entities are NOT liable for any direct, indirect, consequential,
  incidental, special, punitive, or other losses... and in no event shall such liability exceed
  $100 or the amount you paid us in the year preceding such loss."*

## Detail on blocks

- **Task 63** (allrecipes.com) — both: homepage returns a flat "access issue" page
  (`support@people.inc`) instead of content for both tools — an IP/bot-management-level deny,
  not a JS challenge. Identical failure mode for both engines; clearly external.
- **Task 175** (britannica.com) — both: `/place/Mount-Everest` redirects to a Cloudflare "Just a
  moment..." interstitial (`__cf_chl_rt_tk=...` query param) for both tools; waited 8s+, page
  title never resolved past "Just a moment...". Identical for both engines; clearly external.
- **Task 263** (collinsdictionary.com) — both: same Cloudflare "Just a moment..." interstitial,
  but on the bare homepage itself, for both tools — the most aggressive of the three blocks since
  even the entry page never resolves. Identical for both engines; clearly external.
- **Task 297** (craigslist.org) — **Puppeteer only, tool-capability block, not external**: the
  page loaded fully and normally (HTTP 200, real title, no challenge) for Puppeteer exactly as it
  did for Playwright. The failure is entirely in what `pp-server.mjs`'s honest baseline
  capability can extract: its `list` action only enumerates `a, button, input, select, textarea`
  elements — it never captures plain paragraph/body text at all, interactive or not. Its `text`
  action returns a **fixed** `document.body.innerText.slice(0, 3000)` — always the same first
  3000 characters from the top of the page, with no scroll/offset/paging parameter. The
  Disclaimer & Liability clause sits well past character 3000 on this single long terms-of-use
  page, and there is no in-page anchor/TOC link in the `list` output to jump to it either. This
  is a genuine reflection of bare Puppeteer's real out-of-box capability: with no AI/ARIA
  grounding layer, reading arbitrary non-interactive content beyond a fixed slice requires the
  operator to hand-write a `page.evaluate()` extraction/scroll script — which is exactly the gap
  this comparison is designed to surface honestly, not paper over.

## Tool-capability differences observed

1. **Non-interactive text depth (the main divergence this run surfaced).** Playwright's AI-mode
   ARIA snapshot (`locator('body').ariaSnapshot({mode:'ai'})`) captures paragraph/generic text
   nodes structurally, not just interactive elements, up to a 14,000-char cap — so it can reach
   content deep in a long page's DOM order. Puppeteer's honest raw baseline (`list`) only
   enumerates interactive tags, and its `text` action is a fixed top-of-page slice with no way to
   page further. On a short/interactive-heavy page this makes no difference (see tasks 31, 46,
   104, 145, all identical outcomes); on a long, mostly-static single page like craigslist's
   terms of use, it's the difference between Completed and Blocked.
2. **Search-box discovery required more trial on Puppeteer for task 46.** Both tools completed
   it, but getting there differed: Playwright's ARIA snapshot immediately labeled the hidden
   search toggle `"Click here to search"` by its accessible name. Puppeteer's raw `list` gave two
   unlabeled `<button text="">` candidates (icon-only buttons with no accessible-name extraction
   in the raw DOM query) — reaching the actual search input took one wrong click (a menu toggle)
   before finding the right one. Both eventually got the same 5 results, so this didn't change the
   score, but it's a real reflection of Puppeteer's raw DOM query lacking accessible-name
   grounding that Playwright's semantic snapshot provides for free.
3. Everywhere both tools succeeded or failed identically (tasks 31, 46, 63, 104, 145, 175, 263),
   the outcome tracked the *site*, not the *tool* — consistent with Sutradhar's own experience on
   this same sample (also 3 identical external blocks, same domains).
