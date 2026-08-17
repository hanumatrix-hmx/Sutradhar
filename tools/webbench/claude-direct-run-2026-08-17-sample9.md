# WebBench sample 9 — Claude-direct run, 2026-08-17

7 fresh READ-category tasks across 7 domains never attempted in samples 1-8 (checked against
`tools/webbench/tested-domains.txt`). Driven live via the actual CLI binary (rebuilt fresh
immediately before the run — the connected MCP session in this environment is known-stale and
can't be restarted by Claude), no LLM provider, Claude is the brain, same methodology as
samples 1-8. No stealth/evasion. Run to continue building the post-fix completion-rate picture
after Milestones 66-83's real bug fixes (`beforeunload`-guarded navigation always failing,
keyboard repeat-key presses getting silently stuck, popup self-close leaving phantom tabs, real
PDF text extraction, virtualized-list node-id recycling safety) — none of those fixes turned out
to be directly exercised by this particular task set, but the sample is still a real, honest
data point on the current build.

## Result: 5/7 completed (71%)

| ID | Domain | Category | Result | Cause |
|---|---|---|---|---|
| 809 | howstuffworks.com | READ | Blocked | Real CAPTCHA wall on the site's own search results page (`s.howstuffworks.com/captcha`) |
| 815 | huffpost.com | READ | **Completed** | Real article summary extracted from the Politics section's top story |
| 818 | ign.com | READ | **Completed** (disclosed geo-redirect) | Bare domain geo-redirected to `in.ign.com` (IGN India) rather than the US site the dataset assumed; real top-5 headlines extracted from that edition's equivalent section |
| 890 | instructables.com | READ | **Completed** | Real project titles + authors extracted from a "woodworking" search |
| 943 | khanacademy.org | READ | **Completed** | Real course/exercise/video titles + descriptions extracted from an "Algebra" search |
| 1052 | livescience.com | READ | **Completed** | Real article titles + summaries extracted from a "volcano research" search |
| 1063 | lonelyplanet.com | READ | Blocked (dataset drift) | The site's own `/search` page is a functional stub — no real search input renders regardless of URL query params or the homepage's own "Search" link; genuinely appears to be a removed/redesigned feature since WebBench's capture date, not an external block or a Sutradhar failure |

## Completions, detail

- **T815 (huffpost.com)**: the homepage's compact `snap` listing didn't surface a "Politics" nav
  link directly, so navigated to the site's own `/news/politics` URL pattern (the same
  destination the nav would produce — legitimate, not a bypass). Clicked into the top story
  ("Donald Trump Absolutely Loses It With Fox News Anchor") and extracted a real summary via
  `text`: Trump publicly attacked Fox News anchor Shannon Bream over her coverage, calling her
  "milktoast" and comparing her show to CNN, after she challenged AG Todd Blanche on-air.
- **T818 (ign.com)**: real site behavior, not a navigation miss — the bare domain now
  geo-redirects to `in.ign.com` (IGN India). Real top 5 from that edition's equivalent featured
  section: "Grand Theft Auto 6: An Extended Look Premieres on Netflix This Month, Rockstar
  Confirms", "BGMI Lite Finally Becomes Official...", "New Avengers: Doomsday Trailer Shows
  Doctor Doom Raising an Army of Sentinels", "X-Men Cast Confirmed to Include Inde Navarrette as
  Rogue...", "Marvel's Wolverine PS5 Collection Could Arrive in India on September 15...".
- **T890 (instructables.com)**: the homepage had no visible search/filter control in the compact
  listing; navigated directly to the site's own `/search/?q=woodworking` URL pattern. Real first
  5: "Multi-Purpose Woodworking Bench" (gsport george), "18th Century Spice Cabinet by 21st
  Century Woodworking" (Imaginable), "Win-Win-Win-Win: Enjoy Woodworking, Look Manly, Save
  Money, AND Continue to Enjoy Functioning Lungs!" (HibbityDibbity), "'Tree-Nex' - woodworking
  with natural forms (UPDATED)" (bartworker), "scarf/mitten/hat rack - daughter's 1st
  woodworking build" (cdstudioNH).
- **T943 (khanacademy.org)**: real site search via `/search?page_search_query=Algebra`. Briefly
  showed a "Client Challenge" as the cached page title before the live title correctly updated
  to "Algebra | Khan Academy" once real content rendered (matching this session's own
  live-title-accuracy fix from Milestone 65 — the stale title never actually blocked reading the
  real, current content). Real results included exercises/videos across multiple courses:
  "Differentiability at a point: algebraic" (NCERT Math Class 12), "Algebraic rules for
  transformations" (Integrated Math 1), "Origins of algebra" (Algebra 1 video), among others.
- **T1052 (livescience.com)**: real site search via `/search?searchTerm=volcano+research`. Real
  first three: "Mount Etna is like no other volcano on Earth, representing 'a new type of
  volcanism,' new research reveals", "Philippines volcanic eruption: Kanlaon volcano 'may
  progress to further explosive eruptions'", "Kilauea volcano enters fourth eruption phase:
  Watch LIVE".

## Blocks, detail

- **T809 (howstuffworks.com)**: the homepage itself loaded and snapshotted fine (146 real
  interactive elements after a brief settle — the very first snap immediately after `nav`
  returned 0, a real timing artifact this project's own `settle` guidance already covers, not a
  new bug), but submitting a real search query for "climate change" redirected to a genuine
  CAPTCHA challenge page (`s.howstuffworks.com/captcha?q=climate+change...`) — an external,
  site-side anti-automation measure, not a Sutradhar-attributable failure.
- **T1063 (lonelyplanet.com)**: investigated thoroughly before concluding this (not a single
  failed guess) — tried the homepage's own "Search" link, a direct `/search?q=...` URL, and
  inspected the live DOM for any real search `<input>` (found only an unrelated cookie-consent
  widget's search box). The `/search` page consistently renders with only 3 total interactive
  elements across every approach — genuinely appears to be a non-functional stub, most likely a
  removed or redesigned feature since WebBench's dataset capture date. Reported as dataset
  drift, not an external block or a Sutradhar failure, per this project's own standing
  convention for site changes since capture.

## New bugs found this sample

None. Both non-completions were genuinely external (a real CAPTCHA, and apparent site-side
feature removal), independently confirmed rather than assumed.

## Combined total so far

**Combined across all nine samples: 52/85 completed (61.2%), 33/85 externally blocked, 0
Sutradhar-attributable failures.** The completion rate continues to hold in the same 52-71% band
this project has seen across every independent sample since 2026-08-13 — external factors
(anti-bot walls, CAPTCHAs, real site outages, apparent feature removal/dataset drift) remain the
dominant ceiling, not engine capability. See `.ai/competitive-benchmarks.md`'s iteration log for
the full sample-by-sample history.
