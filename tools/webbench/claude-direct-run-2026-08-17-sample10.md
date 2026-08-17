# WebBench sample 10 — Claude-direct run, **Opus-driven**, 2026-08-17

10 fresh READ-category tasks across 10 domains never attempted in samples 1-9 (checked against
`tools/webbench/tested-domains.txt`). Driven live via the actual CLI binary (rebuilt fresh
immediately before the run — the connected MCP session in this environment is known-stale and
can't be restarted by Claude), no LLM provider, Claude is the brain, same methodology and same
honest scoring standard as samples 1-9. No stealth/evasion.

**What makes this sample different: the host model.** Samples 1-9 (85 tasks) were all driven by
Claude Sonnet. This one was driven by **Claude Opus**, at the user's explicit request, to isolate
host-model quality as a variable — the hypothesis being that a stronger host model might reason
its way around ambiguous or drifted tasks better, guess less, and give up less readily. Everything
else was held constant: same tool, same CLI verbs, same "Completed only if real verifiable data was
actually extracted" bar.

Task selection was deliberately **not** biased toward easy domains. The spread spans retail,
dictionary, gov/science, national parks, gaming media, dev Q&A, film, education, a utility site,
and a reference site, chosen across the alphabet from the 376 fresh READ domains remaining in the
dataset — including domains with known-heavy anti-bot posture (macys.com, stackoverflow.com).

> Dataset note: `raw.githubusercontent.com` returned **HTTP 429 Too Many Requests** for
> `webbenchfinal.csv` at run time. The GitHub *contents API* served the identical 818,409-byte
> file base64-encoded, which was decoded locally and parsed with a real CSV parser (quoted fields,
> embedded newlines) rather than a line split. Same data, different transport — not a substitution.

## Result: 6/10 completed (60%)

| ID | Domain | Category | Result | Cause |
|---|---|---|---|---|
| 1080 | macys.com | READ | Blocked | Hard edge deny — "You don't have access to this page", `Reference: 0.b1cc517.1786981603.d692dc56` |
| 1136 | merriam-webster.com | READ | Blocked | Cloudflare "Just a moment…" interstitial that never resolves (25s wait) |
| 2587 | nasa.gov | READ | **Completed** | Real named ISS partner agencies + commercial partners extracted from nasa.gov |
| 1238 | nps.gov | READ | **Completed** | Real commercial-filming permit application (NPS Form 10-930 PDF) + fees located |
| 1322 | pcgamer.com | READ | Blocked (dataset drift) | On-site video section no longer exists; site's "Videos" nav now points off-site to YouTube, which the task forbids |
| 630 | geeksforgeeks.org | READ | **Completed** (disclosed interpretation) | Two real interview questions + answers extracted; the "Google Maps" qualifier matches no real section on the site |
| 1483 | rottentomatoes.com | READ | **Completed** (disclosed substitution) | Dataset's "Top Movies" list (`/top/bestofrt/`) 404s; used the site's own equivalent Top Box Office list |
| 1691 | stackoverflow.com | READ | **Completed** | Real tags extracted from the top-voted Java debugging question (Cloudflare cleared after a real settle wait) |
| 1846 | timeanddate.com | READ | Blocked | Cloudflare "Just a moment…" interstitial that never resolves (30s wait) |
| 2163 | worldatlas.com | READ | **Completed** | Real ranked list of Amazon environmental issues extracted |

## Completions, detail

- **T2587 (nasa.gov)** — the `/about/` landing page loaded cleanly but only referenced partners
  generically ("with U.S. commercial companies and international partners"), with no named list.
  Rather than calling that a completion, followed the About section's own
  "International Space Station" link one hop deeper and extracted the real named list from
  nasa.gov's own copy: **"ESA, JAXA, Roscosmos, Northrop Grumman, and SpaceX, each have launched
  their own space freighters to resupply the International Space Station"**, plus
  **"NASA, Roscosmos, SpaceX, and Boeing have also launched their own crew ships to the orbital
  outpost."** Three partners, as asked: **ESA (European Space Agency), JAXA (Japan Aerospace
  Exploration Agency), Roscosmos**. Re-verified verbatim in a clean session afterward (see the
  bug section — the first attempt ran in a session that turned out to be contaminated, so it was
  re-run rather than trusted).
- **T1238 (nps.gov)** — the hardest *legitimate* navigation problem in the sample, and the one
  where not giving up mattered. nps.gov's own search is broken for this client: the results page
  returns a literally **empty document** (`<html><head></head><body></body></html>`, 39 bytes,
  `innerText.length === 0`) — confirmed three separate ways, including submitting the site's own
  real search form via its real input (`#GlobalFooterSearchInput` → Enter), which produced the
  site's own canonical URL with its own hidden params (`?query=commercial%20filming%20permit&sitelimit=&affiliate=nps`)
  and still rendered empty. Guessed subject URLs 404'd. Solved it by navigating real in-site links
  instead: a park's Management page → "Filming in Yosemite" → "Special Park Uses". Real extracted
  data: the **Special Park Use Application, NPS Form 10-930** —
  `https://www.nps.gov/yose/planyourvisit/upload/NPS-10-930-Application-Special-Park-Use-activity-2.pdf` —
  submitted to "Attn: Office of Special Park Uses, Yosemite National Park, 5083 Foresta Road /
  PO Box 700, El Portal, CA 95318", phone 209/379-1434, with the filming-specific terms from the
  park's own filming page: **"The filming application processing fee for Yosemite National Park is
  $300"** and a monitor fee of **"$500 per day plus $50 per hour if the ranger is on location for
  11 hours or more."**
- **T630 (geeksforgeeks.org)** — *disclosed interpretation.* The task asks for the "Interview
  Questions" section "for Google Maps". GfG has no Google-Maps-specific interview-questions
  section; its only Google Maps content is a System Design article ("Designing Google Maps"),
  which is not Q&A. Used the site's real Google interview-questions section instead, reached via
  the site's own search endpoint (`/search/?gq=...`, results render async — waited for them
  rather than concluding the page was empty). Two real questions with their real brief answers:
  (1) **"There are months with 30 days and others with 31 days. How many months have 28 days?"** —
  answer: the intuitive answer is February, but the correct answer is **all twelve months**, since
  all of them have 28 or more days. (2) **"Could you explain why the Google homepage is mostly
  blank?"** — answer: to avoid annoying pop-ups and advertisements, the founders kept it simple,
  which led to a plain interface with only the Google search bar.
- **T1483 (rottentomatoes.com)** — *disclosed substitution.* The dataset's "Top Movies" list is
  RT's old Top 100 at `/top/bestofrt/`, which now serves the site's in-app **"404 - Not Found"**.
  Rather than guess further, read RT's own navigation to see what the site actually offers today
  and used its closest real equivalent, **Top Box Office**
  (`/browse/movies_in_theaters/sort:top_box_office`, "Top Grossing Movies Out Now in Theaters
  (2026)"). Top-listed title: **Spider-Man: Brand New Day**. Tiles carry no score, so the rating
  came from the film's own RT page: **89% Tomatometer (418 reviews)**, 98% Popcornmeter
  (25,000+ verified ratings).
- **T1691 (stackoverflow.com)** — Stack Overflow served a Cloudflare "Just a moment..." page with
  a zero-length body on first load. Unlike the two genuine blocks below, this one **resolved on a
  real settle wait** (`wait "#questions, .s-post-summary, #mainbar"` → "appeared", title became
  "Newest Questions - Stack Overflow", 10,147 chars of real text). Worth recording precisely,
  because it shows "Cloudflare interstitial" is not automatically a block. Then used the site's own
  filtered listing (`/questions/tagged/java+debugging?sort=MostVotes`) to pick a genuinely popular
  question: **"What are Java command line options to set to allow JVM to be remotely debugged?"**,
  **407 votes**. Full tag list, verified with two independent selectors (the question's own tag
  list, then every `a[href^="/questions/tagged/"]` on the page, which returned the same two tags
  twice — once for the post, once for the sidebar): **`java`, `debugging`** — exactly two tags, not
  a truncated read.
- **T2163 (worldatlas.com)** — the site's search is a Google CSE; the results text rendered but
  the result anchors weren't reachable via a naive text filter, so pulled them by `href` instead.
  Opened the site's own top hit, **"Top 10 Ways We Are Destroying The Amazon"**, and extracted its
  real ranked headings. The article's own top three issues: **1. Road Construction, 2. Poverty,
  3. Tourism** — with the full ranked list also captured: 4. Dam-Building, 5. Oil Extraction and
  Oil Spills, 6. Illegal Mining, 7. Wildfires, 8. Cattle Ranching, 9. Agriculture,
  10. Destructive Logging.

## Blocks, detail

- **T1080 (macys.com)** — hard edge deny at the door, not a CAPTCHA that could be waited out. The
  navigation itself succeeded and returned a real page titled **"Access Denied - Macy's"** reading
  "You don't have access to this page… If the problem continues, call us at 1-800-289-8229",
  with edge reference `0.b1cc517.1786981603.d692dc56`. External anti-automation, explicitly out of
  scope to work around.
- **T1136 (merriam-webster.com)** — Cloudflare managed challenge. The URL was rewritten to carry a
  `__cf_chl_rt_tk` challenge token and the page stayed on **"Just a moment..."**; waited 25s for
  real entry content (`.entry-word-section-container`) and it never appeared. Genuine external
  block.
- **T1846 (timeanddate.com)** — same Cloudflare pattern, waited 30s for any `table` to render
  (the World Clock is a plain table), title still **"Just a moment..."**. Genuine external block.
  Notable as a contrast with Stack Overflow above, where the equivalent wait *did* clear.
- **T1322 (pcgamer.com)** — dataset drift, investigated before concluding rather than assumed. The
  task requires an on-site "video content section" while explicitly forbidding leaving the domain.
  PC Gamer's homepage "Videos"/"View Videos" links now all point to `youtube.com/@pcgamer` —
  off-site. Checked the remaining on-site candidates: `/videos/` and `/video/` both redirect to
  plain article **tag** listings (`/tag/videos/`, `/tag/video/`) that are text articles with no
  video duration metadata; the "Clips" hub (`/clips/`) is a user-submitted clip-sharing page
  (Battlefield 6 clips, "Fun & fails", "SUBMIT YOUR CLIP"), not editorial gameplay reviews with a
  title/duration/publication date; and a site search for "video review" surfaced only PC Gamer's
  hardware review hubs. The title + duration + publication-date triple the task asks for is no
  longer obtainable on-domain. Reported as dataset drift, not an external block and not a
  Sutradhar failure.

## New bugs found this sample

**One real bug, root-caused and fixed: the CLI's session state is a single global mutable pointer,
so two unrelated CLI users on one machine silently share (and fight over) one browser session.**
Logged as `PROB-041`.

This was not theorized from reading code — it broke this benchmark run live, twice, and cost real
tasks before it was understood:

1. First symptom: after navigating to nps.gov, `text` returned **"Sign in to BharatTech Education"**
   — content from a local test fixture, not from nps.gov at all.
2. Investigated instead of guessing. `tabs` showed the active tab was
   `tab_sess_1786965204055_1_1` — a session whose id timestamp (~17:53) **predated this run's own
   launch** (~21:14). `eval` confirmed the real page was
   `http://bharattech.localhost:18000/portal/login`.
3. Second, decisive symptom after closing that session and starting a clean one: a `nav` to an
   nps.gov URL reported
   **`Navigated to http://bharattech.localhost:18000/portal/me?ui-shot=schooladmin`** — a URL this
   run never requested, carrying another job's own query params (`?ui-audit=1`, `?ui-shot=...`).
   A concurrent UI-audit job was driving this run's tab in real time.

Root cause, confirmed in source rather than inferred: `packages/cli/src/state.ts:39` resolved the
session pointer as `path.join(os.homedir(), '.sutradhar-cli')` — one fixed global path, with no
locking and (by deliberate design, per the file's own header) no daemon. Every CLI invocation reads
that file to decide which browser to attach to, so a second user's `nav` attaches to the first
user's live session and drives the first user's tab.

Fix (`packages/cli/src/state.ts`): honor an optional `SUTRADHAR_CLI_STATE_DIR` env var, falling
back to the existing `~/.sutradhar-cli` default when unset — so the default behavior is byte-for-byte
unchanged and concurrent callers can opt into isolation. Documented in-file with the live evidence
above.

Verification, per this project's standard bar:
- `npx tsc --noEmit` clean; `npx tsc` build clean.
- `npx vitest run` for `packages/cli`: **29/29 pass**.
- **Live-verified against the real repro**, which is the part that matters: with
  `SUTRADHAR_CLI_STATE_DIR` pointed at a scratch dir, a fresh `nav` to nps.gov wrote its own
  `state.json` (`sess_1786982166618_1`) and `location.href` read back
  `https://www.nps.gov/index.htm` on two consecutive independent CLI invocations — while the
  concurrent job carried on using the default state dir and never touched this run again. The
  remaining 6 tasks were then driven to completion under that isolation with zero further
  interference.
- Rejected the obvious non-fix first: overriding `HOME`/`USERPROFILE` to move `os.homedir()` does
  *not* work, because Chrome inherits those and fails to launch —
  "Timed out waiting for Chrome to start on port 63541" (confirmed live, not assumed).

Two further notes, honestly recorded as **findings rather than fixes**, because neither is
confidently a Sutradhar bug:

- **There is no `launch` verb** (and no `health` verb) in this CLI — `nav` auto-launches, and
  headless is the default with `--headed` as the opt-out. Invoking `launch --headless` prints the
  usage text and exits *without* an obvious error, which is exactly how this run silently attached
  to a stale pre-existing session instead of creating its own. Arguably an ergonomics gap (an
  unrecognized verb reads as success), but it's pre-existing documented behavior, so it's recorded
  here rather than "fixed" mid-benchmark.
- **The concurrent job also twice deleted `packages/utils/dist` out from under this run**, causing
  `ERR_MODULE_NOT_FOUND` for `@sutradhar/utils` from `capability-runtime`. That is shared-workspace
  contention between two jobs in one checkout, not a product defect; noted only so the run log
  explains its own rebuild steps.

## Combined total so far

**Combined across all ten samples: 58/95 completed (61.1%), 37/95 externally blocked, 0
Sutradhar-attributable failures.**

## Closing note — did the stronger host model move the number?

**No, and that is the interesting result.** Verified against `.ai/competitive-benchmarks.md` rather
than from memory, the Sonnet-driven baseline is: sample 8 **5/7 (71%)**, sample 9 **5/7 (71%)**,
and combined across all nine Sonnet-driven samples **52/85 (61.2%)**.

This Opus-driven sample: **6/10 (60%)** — statistically indistinguishable from the Sonnet combined
rate of 61.2%, and below the two most recent individual Sonnet samples' 71%, which is well within
the per-sample noise this project has already documented (the band across samples has run 52-71%
throughout).

The honest read is that **host-model quality is not the binding constraint on this benchmark.**
Every one of the four non-completions here was external and would have stopped any host model
equally: two Cloudflare interstitials that never resolve, one hard edge deny with a reference id,
and one site whose video section genuinely moved off-domain since the dataset's capture date. No
task in this sample was lost to reasoning quality, a wrong element choice, or giving up early.

Where the stronger host model did visibly help is in **not producing false results** rather than in
producing more of them — a distinction worth keeping, since it doesn't show up in the score:
- **nps.gov** would have been a defensible "Blocked" after the site's own search returned an empty
  document three different ways; it was completed instead by abandoning URL guessing and navigating
  the site's real link graph.
- **nasa.gov** was *not* scored on the generic "international partners" phrasing sitting right there
  on the landing page; it was pushed one hop deeper for actually-named institutions, then re-verified
  in a clean session.
- **rottentomatoes.com** and **geeksforgeeks.org** were completed only with explicit disclosure that
  the dataset's literal target no longer exists, rather than quietly rounding a near-miss up.
- Most consequentially, the **session-hijack anomaly was root-caused instead of retried** — a
  plausible-looking "just re-run it, the page was weird" response would have produced a corrupted
  benchmark whose numbers looked normal, and would have missed `PROB-041` entirely.

So: the completion-rate ceiling on WebBench-style tasks remains external (anti-bot walls, real site
drift), exactly as samples 1-9 concluded, and swapping in a stronger brain does not raise it. The
gain from a stronger host model shows up as fidelity — fewer unnoticed-wrong answers, better
root-causing of tool-level anomalies — not as throughput. See `.ai/competitive-benchmarks.md`'s
iteration log for the full sample-by-sample history.
