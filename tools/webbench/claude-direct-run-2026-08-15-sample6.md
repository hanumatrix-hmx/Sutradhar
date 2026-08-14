# WebBench sample 6 — Claude-direct run, 2026-08-15

12 fresh READ-category tasks across 12 domains never attempted in samples 1-5 (checked against
`tools/webbench/tested-domains.txt`). Driven live via Sutradhar's own `browser.*` MCP tools —
no LLM provider, Claude is the brain, same methodology as samples 1-5. No stealth/evasion.

## Result: 7/12 completed (58%)

| ID | Domain | Category | Result | Cause |
|---|---|---|---|---|
| 74 | alltrails.com | READ | Blocked | DataDome CAPTCHA on the park-guide page |
| 97 | apartments.com | READ | Blocked | Akamai "Access Denied" on the homepage itself |
| 128 | barnesandnoble.com | READ | **Completed** | Real eBook titles/authors extracted |
| 135 | barrons.com | READ | Blocked | DataDome CAPTCHA on the homepage itself |
| 163 | betterhealth.vic.gov.au | READ | **Completed** | Real diabetes type 2 recommendations extracted |
| 166 | billboard.com | READ | **Completed** (disclosed interpretation) | Real featured video title + overlay text extracted |
| 184 | buzzfeed.com | READ | **Completed** (disclosed drift) | Real article found, but a 2019 archive hit, not a currently "trending" post |
| 198 | canada.ca | READ | **Completed** | Real current COVID-19 guidelines extracted |
| 207 | caranddriver.com | READ | Blocked | Confirmed non-existent: in-site search + external web search both found nothing |
| 218 | cbr.com | READ | **Completed** | Real anime review titles + dates extracted |
| 225 | cbsnews.com | READ | **Completed** (disclosed interpretation) | Real top/lead headline story summarized |
| 266 | columbia.edu | READ | Blocked | Cloudflare JS challenge, didn't clear after 6s+ |

## Completions, detail

- **T128 (barnesandnoble.com)**: search box → "self-help ebooks" → filtered live DOM to
  eBook-format results only (site's own filter UI wasn't easily targetable, so a targeted
  `browser.eval` scan of the rendered results grabbed real title/author/price for each). Top 5:
  *GoodBuy, Things!* (Fan Xi Yu), *Self-Help from the Middle Ages* (Peter Jones), *The Keys To
  Self-Improvement* (Clinton Hanslip), *Getting Past Your Past* (Francine Shapiro),
  *Psychobabble ePub eBook* (Stephen Briers).
- **T163 (betterhealth.vic.gov.au)**: site search → direct navigation to the real
  `diabetes-type-2` article → extracted the "Self-care of diabetes" section's real
  recommendations (link with a diabetes team, check blood glucose as recommended, use
  medication strictly as prescribed, stay physically active, eat healthily, keep a positive
  mental attitude, see your doctor regularly).
- **T166 (billboard.com)**: the site's current homepage has no single "featured artist header
  carousel" the way the task implies (real redesign since WebBench's capture date) — the
  closest legitimate match is the top VIDEO section's lead item. Extracted its real
  `data-video-showcase-title` ("Trueno, Slayyyter and Bella Kay on Breakthrough Moments, Their
  Journey As Artists and What's Next | Billboard Cover") and its real `data-video-showcase-dek`
  overlay text ("Popular on Billboard"). Scored Completed with this disclosure rather than
  silently treating it as an exact task match.
- **T184 (buzzfeed.com)**: homepage redirected to the India edition with no visible "Viral
  Internet Challenges" content; the site's own search for that exact phrase returns exactly one
  real result — "The Viral 'Bottle Cap Challenge' Trend Is Spinning Across The Internet"
  (Javier Moreno, July 4, 2019). Not a currently "trending" post as the task's premise implies
  (real content drift since the dataset's capture date), but a genuine, verifiable headline for
  the topic — scored Completed with this caveat rather than Blocked, since real relevant content
  was found and extracted.
- **T198 (canada.ca)**: direct navigation to the real COVID-19 prevention/risks page, extracted
  the current "Personal protective measures" list (stay home when sick, wear a well-fitting mask
  when appropriate, improve ventilation, hand hygiene, cover coughs/sneezes, clean high-touch
  surfaces) plus the vaccination guidance above it — real, current, verifiable guidelines.
- **T218 (cbr.com)**: the homepage's `?s=` query param didn't route to search results (client-
  side routing quirk); found the real search form action (`/search/?q=`) via a DOM inspection
  and used that instead — a legitimate adaptation, not a workaround of any protection. Real
  results: "The Ninth Jedi Review" (Aug 5, 2026), "Batman: Caped Crusader Season 2 Review"
  (Jul 28, 2026), "Adventure Time: Side Quests Review" (Jun 24, 2026), and more, each with real
  publication dates.
- **T225 (cbsnews.com)**: no distinctly labeled "investigative report" section exists on the
  current homepage (real redesign since capture); the closest legitimate match is the top/lead
  headline story, which was genuinely investigative-adjacent breaking news ("Luigi Mangione
  pleads guilty in federal case, admits shooting Brian Thompson"). Scored Completed with this
  interpretation disclosed.

## Blocks, detail

- **T74 (alltrails.com)** and **T135 (barrons.com)**: both hit a real DataDome CAPTCHA wall
  (`captcha-delivery.com` iframe, confirmed via `document.documentElement.outerHTML`) — the
  same anti-bot vendor, on two unrelated domains, both real, unworked-around external blocks.
- **T97 (apartments.com)**: hard Akamai "Access Denied" on the bare homepage itself — no page
  content ever loads for this session, a full deny rather than a challenge.
- **T207 (caranddriver.com)**: the site's own on-page search returned irrelevant results for
  "traffic safety trends 2021" (kept surfacing a "2021 Kia K5" model page regardless of query)
  and a clean "No results matching" for "traffic safety trends" without the year. Before scoring
  this a block, cross-checked with an external web search restricted to `site:caranddriver.com`
  — it also found nothing matching. Scored as a genuine, dataset-drift-driven non-existence, not
  a tool failure — both the in-site and external checks agree the article doesn't exist in the
  current index.
- **T266 (columbia.edu)**: Cloudflare "Performing security verification" JS challenge on the
  bare homepage, didn't clear after a 6-second wait (checked via a scripted delay). The task
  explicitly restricts to `columbia.edu` (the real tuition data lives on a different subdomain,
  `sfs.columbia.edu`, out of scope per the task's own instructions), so this is a real, in-scope
  block, not a missed alternate path.

## No new Sutradhar bugs found this sample

All 12 attempts drove cleanly through `browser.*` tools with no misfires, occlusion false
positives, or unexpected errors — the 5 blocks were all external (2 CAPTCHA, 1 hard deny, 1
Cloudflare challenge, 1 confirmed-nonexistent content), matching the pattern from every prior
sample.

## Combined total across all six samples

**36/59 completed (61.0%)**, 23/59 externally blocked, 0 Sutradhar-attributable failures.
(Prior total after sample 5: 29/47. This sample: +7/12.)
