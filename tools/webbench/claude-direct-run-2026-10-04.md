# WebBench sample 14 (2026-10-04): pre-registered, blind-verified run of the published sutradhar@0.6.1 CLI

**Headline: 6 of 29 in-scope tasks completed under the strict, pre-registered evidence rules (H1 = 20.7%, 95% Wilson CI
9.8 to 38.4). 7 of 29 (24.1%, CI 12.2 to 42.1) if the one interpreted completion is counted. 13 of 30 tasks (43.3%) were
stopped by external anti-bot or protocol walls. 0 were classified SUTRADHAR-FAIL. 9 were AGENT-FAIL. This is far below
the August baseline (strict 55.1%), the difference is statistically clear (Newcombe 95% CI -48.6 to -14.4 points), and it is
not explained by external blocks alone: among tasks the open web let through, 6 of 16 completed (37.5%) versus 59 of 71
(83.1%) in August. Several confounds changed at once (section 3.3), so no part of the gap can be attributed to 0.6.1.**

Four confirmed Sutradhar defects surfaced (D1 to D4, filed as PROB-047 to PROB-050) plus one usability defect from the
smoke test (PROB-051). None was ruled to be the cause of a failed task, but D2 (silent 4000-character `text` truncation)
sits on the evidence path of most of the AGENT-FAILs (section 3.3).

Everything in this file is derived from committed files under `.ai/loop/webbench-2026-10-04/` (`<LOOP>`). The metrics are
computed by `<LOOP>/compute-metrics.mjs` (output: `<LOOP>/runs/metrics-output.json`), not by hand. The classification table
is `<LOOP>/runs/final-classes.json`.

---

## 1. Header

| Item | Value |
|---|---|
| Mode | host AI driving the **published sutradhar@0.6.1 CLI** (one process per command) through the logging wrapper `drive.mjs`; not the MCP surface, not a source build |
| Drivers / verifier | Sonnet subagents (slots B1 to B6, 6 tasks each) / one Opus verifier, blind, then an independent Opus evidence brief for adjudication; rulings by the orchestrator |
| Build pin | `cli-bin.js` sha256 `9858726a291e844e1f84089b18310e90379140e2dfabf7b2fda80eb550b5c59b`; package 0.6.1; tarball integrity `sha512-CXcYoKxWGEm79LjeaKuq4Tt4HoC/yG2iLOOS7a7CpGc0JzH+2YNIEOiLEoBP7ZIDAFAehWxAj8CnX0yURXX36Q==` (lockfile equals `npm view`); puppeteer-core 25.12.0; Node v25.0.0 |
| Pin held through the run | `drive.mjs` re-hashes the CLI on every call: 0 records with exit 99 in 534 CLI records (B1 to B6). The file was re-hashed after the run and is unchanged (same sha256). `sha256sum -c MANIFEST.sha256` after the run: every frozen file OK |
| Chrome (end-of-run check) | All 496 `auto-href` fingerprint records (B1 to B6 and K, 10:23:22Z to 10:47:23Z) report `HeadlessChrome/154.0.0.0`, `navigator.webdriver=false`, inner viewport **800x600**. One fingerprint only, so no mid-run Chrome change |
| Surface fingerprint | CLI and MCP are identical on webdriver, user agent, brands, languages. They differ in viewport: CLI 800x600 (this run) vs MCP 1264x705. Direction of the effect on blocks and layouts is unknown (protocol 0c). The headline is not adjusted |
| Dataset | Halluminate/WebBench `webbenchfinal.csv` @ `ea7a1628443321363989f354401f0653e0cba6f4` (MIT), sha256 `fd5311a38bdb6f941e8f544150735656c114d76fbfb17193da973d5de0165217` |
| Exclusion list | 124 previously tested domains, sha256 `3da40a4bae1071e7ed85026f3f109239b86881d5281a69b666ea70ecf5203f98`; 328 eligible domains |
| Seed | `sutradhar-webbench-2026-10-04`; rows ordered by `sha256(seed + ":" + ID)`, first row per eligible domain, first 30 in-scope draws are primary |
| Frozen-file hashes (`MANIFEST.sha256`) | `protocol.md` `7a0e02fb32a356d25fc3635f20009ae890977e5756bdad640816d942b0a1044a`; `driver-brief.md` `78b8bb438bd7e9f124fdddd63b61224ea9dcb05ed16e279de96c2ceff1aac130`; `verifier-brief.md` `81ae6403369cf7645b1acc12f751a2eaf8af26115e3e8ddd7f77994cee01d0f3`; `lib.mjs` `11a68072dcee21cd4de0126d562f5190dfa53384254f130d981b651d540f64ed`; `drive.mjs` `0519aacdedddc764c1d9c01393e6148e16b01a83b982d922cca71b62153ac724`; `check-evidence.mjs` `b5d5c14e254f11c5a648d7aa54cf5969cfcd8c0ad58c263bccd68841efc746cf`; `make-verify-input.mjs` `c8716cbc0ff39254e90bed63fb7d8d0ef866b72a90fb1b099d5a03f6c9fc7040`; `task-fields.json` `4b530d70e40975135c947f3cb89a1be9ac05bd00ec58df06ca1ea33eadf3ec81` |
| Tasks | `tools/webbench/tasks-sample14.json` (30 primary, 6 re-test). Domains appended to `tested-domains.txt` |

Deviations from the frozen protocol are listed in `<LOOP>/DEVIATIONS.md` (nine items). The ones that matter for reading this
report: briefs were delivered by path plus sha256 rather than pasted; slots rolled (at most 3 concurrent Chrome sessions was
kept); `raw.sha256` lists were generated after the run, not at progress snapshots; canary K1 was substituted (section 5.6);
a Git Bash path-conversion slip in drivers' `waitfor --js` calls was an environment problem, not a Sutradhar defect.

## 2. Results (30 primary tasks)

"Driver" is the driver's own class. "Verifier" is the Opus verifier's blind phase-1 class (for the three canary tasks its
input was a mutated copy, so that column is not a verifier class). "Final" is the adjudicated class used in all metrics.
Subflags in parentheses.

| P | ID | Domain | Driver | Verifier | **Final** | Answer or cause |
|---|---|---|---|---|---|---|
| P01 | 1172 | msu.edu | COMPLETED (strict) | COMPLETED (strict); replay agrees | **COMPLETED (strict)** | 3 service names from search.msu.edu results (Academic Support Services, PAL, TRiO SSS) |
| P02 | 2388 | bing.com | COMPLETED (strict) | COMPLETED (strict) | **COMPLETED (strict)**, with 1 tool defect | Top 5 Bing News titles, Past 24 hours. Time-varying: a replay could only confirm the kind of data |
| P03 | 2253 | europa.eu | COMPLETED (interpreted, linked-org) | COMPLETED (strict); replay agrees | **COMPLETED (strict)** | First 3 EUR-Lex results for "data protection". Ruled strict: protocol 2.5 names eur-lex.europa.eu as on-site for this task |
| P04 | 1661 | stackexchange.com | EXTERNAL-BLOCK (challenge) | EXTERNAL-BLOCK (challenge); replay agrees | **EXTERNAL-BLOCK (challenge)** | Cloudflare "Performing security verification", HTTP 403, both attempts. Verifier replay through a different browser tool saw an IP-level "Access Denied ... GEO: IN" |
| P05 | 751 | harpersbazaar.com | COMPLETED (strict) | COMPLETED (strict) | **COMPLETED (strict)** | First site-search result "The Best Spring 2025 Fashion Trends to Shop Now"; Loewe, Alaia, Miu Miu, Bottega Veneta, Saint Laurent |
| P06 | 1492 | science.org | EXTERNAL-BLOCK (challenge) | EXTERNAL-BLOCK (challenge) | **EXTERNAL-BLOCK (challenge)** | Cloudflare interstitial, 403, 30 s wait did not clear it, both attempts |
| P07 | 1946 | unesco.org | COMPLETED (strict) | COMPLETED (strict); replay agrees | **COMPLETED (strict)** | First 4 results for "heritage conservation" (stories and press releases, not a "documents" filter) |
| P08 | 1837 | tiktok.com | EXTERNAL-BLOCK (geo) | EXTERNAL-BLOCK (geo) | **EXTERNAL-BLOCK (geo)** | Start URL redirected to `/in/about`: TikTok unavailable in India (regional notice) |
| P09 | 1379 | polygon.com | TASK-INVALID (drift) | AGENT-FAIL (reasoning) | **AGENT-FAIL (reasoning)** | "5 most popular guides": drift not proven; one check was a repeat read, one a `text` cut at 4000 characters |
| P10 | 1266 | nytimes.com | EXTERNAL-BLOCK (captcha) | EXTERNAL-BLOCK (captcha) | **EXTERNAL-BLOCK (captcha)** | DataDome captcha iframe, 403, empty page text, both attempts |
| P11 | 2554 | johnlewis.com | EXTERNAL-BLOCK (protocol) | (canary copy; classified EXTERNAL-BLOCK) | **EXTERNAL-BLOCK (protocol)** | `ERR_HTTP2_PROTOCOL_ERROR` on both attempts, no content ever loaded, no curl control run |
| P12 | 2215 | yellowpages.com | EXTERNAL-BLOCK (edge-deny) | EXTERNAL-BLOCK (edge-deny) | **EXTERNAL-BLOCK (edge-deny)** | Cloudflare "Sorry, you have been blocked", Ray ID, first load |
| P13 | 929 | justdial.com | EXTERNAL-BLOCK (protocol) | EXTERNAL-BLOCK (protocol) | **EXTERNAL-BLOCK (protocol)** | `ERR_HTTP2_PROTOCOL_ERROR` on first nav, both attempts, no control run |
| P14 | 781 | homedepot.com | EXTERNAL-BLOCK (edge-deny) | EXTERNAL-BLOCK (edge-deny) | **EXTERNAL-BLOCK (edge-deny)** | Home page loads; the search results URL returned 403 "Oops!! Something went wrong", both attempts |
| P15 | 1236 | nordstrom.com | EXTERNAL-BLOCK (edge-deny) | EXTERNAL-BLOCK (edge-deny); replay agrees | **EXTERNAL-BLOCK (edge-deny)** | Redirect to `siteclosed.nordstrom.com/invitation.html` ("we don't allow unidentified, automated traffic"), both attempts |
| P16 | 1940 | umich.edu | EXTERNAL-BLOCK (challenge) | EXTERNAL-BLOCK (challenge) | **EXTERNAL-BLOCK (challenge)** | Cloudflare interstitial with Ray ID; 30 s wait and one re-nav did not clear it |
| P17 | 1979 | usa.gov | AGENT-FAIL (substitution) | COMPLETED (interpreted); replay agrees | **AGENT-FAIL (substitution)** | Categories were read from `/benefits`, not from the "Benefits & Services" search the task asked for. Disputed, see 5.5 |
| P18 | 2687 | uptodown.com | TASK-INVALID (drift) | AGENT-FAIL (reasoning) | **AGENT-FAIL (reasoning)** | PUBG Mobile update log: truncated app-page read plus a guessed URL; Android listing unchecked. Disputed, see 5.5 |
| P19 | 1925 | ucla.edu | COMPLETED (strict) | (canary copy; rejected) | **COMPLETED (strict)** | Planetary and Human Health; Equity, Diversity, Inclusion, & Justice; Curricula & Research (3 of the 4 listed plan goals on sustain.ucla.edu) |
| P20 | 2561 | kayak.com | AGENT-FAIL (partial) | SUTRADHAR-FAIL; replay agrees | **AGENT-FAIL (reasoning)** + confirmed defect D1 | No price read. Click/type on `/stays` failed with "detached Frame" (reproduced 3 times); causation not established, so the less favourable class. Disputed, see 5.5 |
| P21 | 2336 | tenor.com | COMPLETED (interpreted) | (canary copy; rejected) | **COMPLETED (interpreted)** | First 5 result slugs used as titles/hashtags; start URL auto-redirected to `/en-GB/`. Order unstable between reads (low-to-medium confidence) |
| P22 | 1789 | theguardian.com | AGENT-FAIL (evidence-rule claimed) | AGENT-FAIL (reasoning); replay agrees | **AGENT-FAIL** | Star ratings are graphics only (seen in a screenshot); no `uncitedValue` recorded, so the evidence-rule class cannot apply; premises never gathered |
| P23 | 1517 | shein.com | EXTERNAL-BLOCK (edge-deny) | EXTERNAL-BLOCK (edge-deny) | **EXTERNAL-BLOCK (edge-deny)** | Search URL redirected to a risk page, `STATUS: 403`, risk-id. The driver reached search by a guessed URL, which may have contributed |
| P24 | 1371 | playstation.com | AGENT-FAIL (partial) | AGENT-FAIL (partial); replay agrees | **AGENT-FAIL (partial)** | Release date and price cited; no developer field on the page text (read was truncated at 4000 characters) |
| P25 | 1434 | redfin.com | EXTERNAL-BLOCK (challenge) | EXTERNAL-BLOCK (edge-deny); replay agrees | **EXTERNAL-BLOCK (challenge / edge-deny)** | Redirect to `ratelimited.redfin.com`, HTTP 429 "Are You a Robot?", both attempts. Subflag differs between driver and verifier; class does not |
| P26 | 696 | goal.com | TASK-INVALID (drift) | AGENT-FAIL (reasoning) | **AGENT-FAIL (reasoning)** | Checks only proved "the site has no search"; the latest Manchester United match page was reachable. Disputed, see 5.5 |
| P27 | 1329 | pennmedicine.org | TASK-INVALID (drift) | TASK-INVALID (drift) | **TASK-INVALID (drift)** | No administrative customer-support email on the contact page or via site search (only a security-vulnerability address). Removed from the H1 denominator. Not replayed |
| P28 | 2582 | msdmanuals.com | AGENT-FAIL (partial) | AGENT-FAIL (reasoning); replay agrees | **AGENT-FAIL (reasoning)** | Correct article found; three `text` reads returned the same first 4000 characters and stopped before the risk-factor section; `read`/scroll never tried |
| P29 | 982 | lawinsider.com | AGENT-FAIL (substitution) | AGENT-FAIL (reasoning); replay agrees | **AGENT-FAIL (reasoning)** | Titles and "Filed" dates for the first five results were logged (via `read body`); no answer recorded; the site shows no "effective date". `text` showed only 3 of 10 result cards |
| P30 | 2218 | yelp.com | EXTERNAL-BLOCK (captcha) | EXTERNAL-BLOCK (captcha) | **EXTERNAL-BLOCK (captcha)** | DataDome captcha, 403, empty page text, both attempts |

For AGENT-FAIL tasks where driver and verifier agreed on the class but not the subflag (1789, 2582, 982), the verifier's subflag
is shown and the driver's is in the table; the orchestrator ruled on classes only.

## 3. Metrics

In-scope = 30 minus TASK-INVALID = 29. Wilson 95% intervals. Differences are October minus the clean August baseline with
Newcombe (method 10) 95% intervals, in percentage points. The Newcombe routine was checked against Newcombe's published
56/70 vs 48/80 example (it returns 0.0524 to 0.3339, as published). The Wilson routine reproduces the four baseline intervals
printed in protocol section 1.

### 3.1 Headline table

| Metric | Definition | October 2026 (this run) | Clean August baseline | Difference [Newcombe 95%] |
|---|---|---|---|---|
| **H1** (headline) | strict / attempted in-scope | **6/29 = 20.7% [9.8, 38.4]** | 59/107 = 55.1% [45.7, 64.2] | **-34.5 pp [-48.6, -14.4]** |
| H1-lenient | (strict + interpreted) / in-scope | 7/29 = 24.1% [12.2, 42.1] | 71/107 = 66.4% [57.0, 74.6] | -42.2 pp [-56.7, -21.9] |
| **H2** | strict / (in-scope - EXTERNAL-BLOCK) | **6/16 = 37.5% [18.5, 61.4]** | 59/71 = 83.1% [72.7, 90.1] | **-45.6 pp [-65.9, -19.6]** |
| H2-lenient | (strict + interpreted) / (in-scope - EXT) | 7/16 = 43.8% [23.1, 66.8] | 71/71 = 100.0% [94.9, 100.0] | -56.3 pp [-76.9, -32.6] |
| H1' | H1 with a2-after-block completions moved out | 6/29 = 20.7% [9.8, 38.4] | n/a | same as H1 |
| H2' | H2 with a2-after-block completions moved out | 6/16 = 37.5% [18.5, 61.4] | n/a | same as H2 |
| EXTERNAL-BLOCK share | EXT / 30 | 13/30 = 43.3% [27.4, 60.8] | 36/117 = 30.8% [23.1, 39.6] | +12.6 pp [-5.7, 31.6] (not distinguishable) |

Baseline definitions are those of protocol section 1: 117 unique dataset tasks, of which AUTH (3) and DRIFT (7) are
TASK-INVALID, leaving 107 in scope, 36 of them EXTERNAL-BLOCK; "strict" is August's completions minus the 12 that the August
reports themselves flag as interpretation, substitution, partial or "reasonable" (59), "lenient" is all reported completions (71).
**The August baseline is itself generous**: it counts mid-run-fixed bugs and disclosed substitutions as completions, so the
true gap on equal rules is probably not smaller than shown.

H1' and H2' equal H1 and H2 because none of the 7 completions needed an a2 (all 7 completed on the first attempt). A2 was
used on 10 tasks, all of which ended in a block or failure (1492, 1661, 1266, 2554, 1236, 781, 929, 2561, 1434, 2218).

At n=30 every interval above is wide (the H1 interval spans 9.8 to 38.4). The October and August H1
intervals do not overlap, but see 3.3 for why this is not a measure of 0.6.1.

### 3.2 Counts (final classes, primary 30)

| Class | Count | By subflag |
|---|---|---|
| COMPLETED | 7 | strict 6, interpreted 1 (tenor.com, geo auto-redirect, slug as title); `a2-after-block` 0; `linked-org` 0 |
| EXTERNAL-BLOCK | 13 | challenge 4 (1492, 1661, 1940, 1434), captcha 2 (1266, 2218), edge-deny 4 (2215, 781, 1236, 1517), protocol 2 (2554, 929), geo 1 (1837). 1434 is "challenge" by the driver and "edge-deny" by the verifier |
| AGENT-FAIL | 9 | reasoning 7 (1379, 2687, 696, 2561, 1789, 2582, 982), substitution 1 (1979), partial 1 (1371) |
| TASK-INVALID | 1 | drift 1 (1329) |
| SUTRADHAR-FAIL | 0 | the verifier proposed 1 (2561); ruled AGENT-FAIL, see 5.5 |
| COMPLETED with at least one recorded Sutradhar defect | 1 of 7 | 2388 (a false-failure click timeout and an `--expect-url-changed` miss when a click opens a new tab). Two more completions (1172, 1946) hit D3 and worked around it with the bare node number |
| AGENT-FAIL (evidence-rule) | 0 | The only claim (1789) was rejected: no `uncitedValue` was recorded, so protocol rule 6 cannot apply |
| `viewport-suspect` tags | 0 | none applied by drivers or verifier (one driver note, 1661, says it did not apply). 1172 reached search through a mobile-menu button at 800x600; whether the viewport changed any block is **unknown** |
| `cli-surface-gap` tags | 0 | none applied |

Verification coverage: phase 1 covered all 38 tasks (30 primary, 6 re-tests, 2 controls). Phase 2 replayed 12 tasks; all 12
agreed with phase 1. Of the 7 completions, 3 were replayed (1172, 2253, 1946), all through "same-tool replay" or a read-only
second channel. The replay confirmed the kind of data for time-varying tasks (P02, P04, P10, P26), not the values.

### 3.3 Why this is much lower than August

The October result is about 35 points below August on the strict headline and about 46 points below on the
"let-through" metric. These are the reasons, in the order I believe they matter, with what the evidence does and does not show.

1. **Stricter, pre-registered evidence rules and blind verification versus August's lenient counting.** In August the same
   agent that drove the browser decided what counted as completed. Substitutions, "reasonable" interpretations, partial
   answers and two bugs fixed mid-run (T36 `type` append, T597 `click_by_text`) were counted as completions (13 of the 79 were
   flagged interpretations, and by a frozen-build rule two would have been SUTRADHAR-FAIL). This run required every answer value to be a verbatim substring
   of a logged page-reading call, forbade `eval` as evidence, fenced domains, fixed one retry, and had a blind verifier plus
   an orchestrator who took the less favourable class in any unresolved dispute. Adjudication changed the picture
   (three driver drift claims and the usa.gov interpretation became AGENT-FAIL), but **it explains only a small part of the gap**:
   on the drivers' own classes, before verification, H1 would have been 5/26 = 19.2% [8.5, 37.9] and H2 5/13 = 38.5%
   [17.7, 64.5]. The low numbers were already there in the drivers' own records.
2. **Different, harder, fresh domains.** August's tasks were hand-picked and often chosen after earlier samples showed which sites
   worked. This draw was seeded, excluded all 124 previously tested domains, and had no difficulty filter: TikTok, Yelp, Shein,
   Kayak, Nordstrom and Home Depot stayed in. 13 of 30 (43.3%) were stopped by external walls, against 30.8% in August; that
   difference is not statistically distinguishable (Newcombe -5.7 to +31.6) and cannot by itself explain a fall in H2, which
   removes blocks from the denominator.
3. **External blocks are a large share.** 13 of 30. The verifier's replay through a different, non-headless browser tool saw
   the same Cloudflare/IP block on stackexchange.com, which is evidence that at least that block is IP-level and not specific to
   this tool. The India-based IP is a plausible common cause for several (tiktok.com is a pure geo block). Not every block was
   independently re-checked; only 3 of 13 were replayed.
4. **The CLI driver surface at 800x600.** The CLI renders at 800x600; the published 0.6.1 MCP surface measures about 1264x705
   (August build viewports were not recorded, so the August viewport is unknown). Responsive sites may collapse navigation or filters.
   This run tagged no failure as viewport-caused, but that is the absence of a tag, not evidence of no effect. Direction unknown.
5. **Sonnet drivers under a restrictive wrapper.** Every call went through a logging wrapper with a verb allow-list, a domain
   fence, a one-call-at-a-time lock and an evidence gate. That closes cheating routes but also removes August's flexibility
   (free `eval` reads, free retries, free edition changes). Several AGENT-FAILs (1379, 2687, 696) are drivers calling target-gone on thin checks (1379's own notes say "Weak drift"), and the protocol correctly refused to call that proven drift.
6. **Confirmed Sutradhar defects plausibly contributed, without changing the adjudicated classes.**
   - **D2, silent 4000-character `text` truncation.** In the 534 CLI records, 42 of 91 `text` calls returned exactly 4001
     characters (the 4000-character cap plus a newline), with no truncation marker. For 8 of the 9 AGENT-FAILs at least one
     `text` read was capped (the exception is 2561). It is the confirmed cause that the reads behind **1379** (homepage
     `text`, seq 17), **2687** (app page `text`, seq 63) and **982** (`text` showed 3 of 10 result cards, `read body` showed all
     10) could not show what was below the cut, and likely contributed to **2582** (three `text` reads stopped before the
     risk-factor section) and **1371** (the product page read stopped at 4000 characters, where the developer field might
     have been). Capped reads also occurred on 1979, 1789 and 696 and on four completions (2253, 2388, 751, 1925), so it is
     correlation, not proof of cause, for those. In the adjudicated classes these remain AGENT-FAIL because the driver could
     have used `read`/scroll and did not, and a truncated read cannot prove absence; but an agent had **no way to know the
     page was cut**, which is a product defect regardless of who is blamed.
   - **D1, "detached Frame" after same-origin navigation on kayak.com `/stays`.** `click` and `type` failed 4 times
     (seq 33, 37, 47, 49), reproduced 3 times by the verifier in 2 sessions; `clickrole` worked. Ruled AGENT-FAIL (2561)
     because on `/hotels` typing worked in both attempts and the agent never selected a typeahead suggestion, so "the defect
     caused the failure" was not established. It plausibly cost the task a working route.
   - D3 (a node id printed as `[#5]` is rejected as `#5`) produced 8 failed calls across 6 tasks in the logs (1172, 1946, 781, 2561, 1329, 597); no task was lost. D4
     (`back` prints "undefined") is cosmetic.
7. **Small n.** 30 tasks, 29 in scope. Every interval is wide. The H1 interval does exclude August's H1 (Newcombe -48.6 to
   -14.4), but a draw this size cannot separate "the web got harder", "the rules got stricter", "the tool changed" and
   "the driver changed".

**What is not claimed:** that 0.6.1 is worse than the August builds. There are four uncontrolled differences (domain mix,
Chrome version, surface and viewport, rules and verification), and the protocol states in advance that no difference is to be
attributed to 0.6.1. **What is claimed:** under strict independent evidence rules, a Sonnet agent driving this CLI against 30
fresh domains completed 6 tasks; 13 were stopped by the open web; 9 were failures of the agent, aggravated by at least one
product defect (D2) that hides truncation; and the 0 Sutradhar-attributable failures that August reported should be read as a
counting convention, not as a measured property.

## 4. Re-test table (slot B6, reported separately, not merged into the headline)

| ID | Domain | August outcome | October outcome (final) | Probe result |
|---|---|---|---|---|
| 597 | frontiersin.org | Completed (S13), after PROB-044 was found and fixed mid-run | **AGENT-FAIL (substitution)**: "highly cited" criterion unsupported (only "17 citations" seen, no sort or comparison) | **PROB-044 PASS**: `count "mark"` = 44 (seq 19); `clicktext` with the full mark-split title exit 0, "verified (confidence 0.90)" (seq 23), article page loaded (seq 25). The task failure is the agent's, the probe passed regardless |
| 41 | aliexpress.us | Completed (S3, again S12) | **AGENT-FAIL (substitution)**: the first result matching all named terms was #3 and was skipped without a stated reason. Checker C2d failed on one excerpt (15 characters), resolved by a passing citation in the same record (protocol 4.3-2) | **Type-append PASS**: after searching "wallet", the second `type` left `href` without "wallet" (seq 15) and `snap` shows the input value "black leather belts for men" (seq 17) |
| 192 | ca.gov | Completed (S5, listed there as id 401) | **COMPLETED (interpreted, linked-org)**: answer from listoscalifornia.org reached by clicking a ca.gov-linked result (ready.ca.gov). Weak; flagged by the driver | **Type-append PASS**: first query "parking", second query typed into the results input; `snap` shows `value="disaster preparedness"` with no "parking" residue (seq 15) |
| 392 | ea.com | Blocked (S11, `ERR_HTTP2_PROTOCOL_ERROR`, no control) | **EXTERNAL-BLOCK (client-fingerprint)** | Orchestrator curl control (`runs/B6/curl-392.txt`): `200 1.1`, while Chrome failed twice with `ERR_HTTP2_PROTOCOL_ERROR`. Per the pre-registered curl mapping, curl 200 plus Chrome failure is EXTERNAL-BLOCK (client-fingerprint), never SUTRADHAR-FAIL. **It is not shown that a different Chrome would load the page**, so a client-side HTTP/2 cause cannot be ruled out; the same signature is on 2554 and 929 with no control |
| 568 | ford.com | Blocked (S13, `ERR_HTTP2_PROTOCOL_ERROR`) | **EXTERNAL-BLOCK (edge-deny)**: HTTP 403 Akamai "Access Denied", reference `#18.25f9da17...` | Curl control not triggered (no `net::` failure); a different signature from August |
| 1691 | stackoverflow.com | Completed (S10, Opus, after a Cloudflare wait) | **EXTERNAL-BLOCK (edge-deny)**: after the interstitial wait cleared (INTERSTITIAL_JS: "Condition met after 1ms", both attempts), site search redirected to a "Human verification" captcha and tag pages returned an IP-block page naming this IP | Interstitial probe PASS (the wait ran and the interstitial cleared); the later block is separate |

**PROB-043 is not probeable through the CLI** (it needs a long-lived MCP session), so it was not re-tested.

All three bug probes ran against the published 0.6.1 and passed: PROB-044 (597), type-append (41 and 192). Task outcomes of
the re-test set are scored separately and are not in any headline number.

## 5. Detail

### 5.1 Completions (7)

Excerpts are trimmed from the driver records (each is verbatim in the cited log call; the full excerpt is at most 300
characters in the record).

| ID | Values (call seq) | Excerpt (trimmed) |
|---|---|---|
| 1172 | Academic Support Services; Peer-Assisted Learning (PAL); TRiO Student Support Services (seq 33) | "Peer-Assisted Learning (PAL) - College of Social Science Michigan State University > undergraduate > student-success > pal-program" |
| 2388 | 5 Bing News titles, e.g. "New AI task force to report on risks of technology after public and industry concerns" (seq 41; filter applied, seq 39) | The 4th title is literally "Tech News" (Indiatimes). Click on "Past 24 hours" reported a 15 s timeout though the filter was applied (defect, seq 35) |
| 2253 | Regulation (EU) 2016/679; Regulation (EU) 2018/1725; Directive (EU) 2016/680 (seq 37) | "Regulation (EU) 2016/679 of the European Parliament and of the Council of 27 April 2016 on the protection of natural persons..." |
| 751 | "The Best Spring 2025 Fashion Trends to Shop Now"; Loewe, Alaia, Miu Miu, Bottega Veneta, Saint Laurent (seq 15) | "...wafty florals at Loewe, or Alaia's soft separates, or the way Miu Miu's preppy girl..." Which five of the many brands in the article is a choice; disclosed |
| 1946 | 4 result titles, first "What a geological heritage and conservation training looks like in Kenya's Great Rift Valley" (seq 17) | Default "Most relevant" sort, all content types |
| 1925 | Planetary and Human Health; Equity, Diversity, Inclusion, & Justice; Curricula & Research (seq 29) | "Sustainability Plan Goals Planetary and Human Health Equity, Diversity, Inclusion, & Justice Curricula & Research Sustainable Campus Engagement" (four goals listed, three requested) |
| 2336 (interpreted) | 5 slugs from the first five result links, e.g. `squid-game-squid-game-3-...-gif` (seq 17) | `href=/en-GB/view/squid-game-squid-game-3-squid-game-season-3-gi-hun-front-man-gif-...`. The result order differs between two reads (seq 11 vs 17) for 2 of the 5 values |

### 5.2 Blocks (13)

| ID | Vendor / mechanism | Evidence (seq) |
|---|---|---|
| 1492 science.org | Cloudflare interstitial (403) | "Performing security verification" (seq 21); 30 s wait did not clear it (seq 19) |
| 1661 stackexchange.com | Cloudflare interstitial (403) | seq 19; replay through another tool: IP-level "Access Denied" |
| 1940 umich.edu | Cloudflare interstitial with Ray ID | seq 23 |
| 1266 nytimes.com | DataDome captcha (403) | `geo.captcha-delivery.com` iframe, empty text (seq 17) |
| 2218 yelp.com | DataDome captcha (403) | seq 11 |
| 2215 yellowpages.com | Cloudflare deny, Ray ID | "Sorry, you have been blocked" (seq 3) |
| 781 homedepot.com | Akamai-style error on the search route (403) | "Oops!! Something went wrong" (seq 39); home page itself loaded |
| 1236 nordstrom.com | Bot-traffic deny page | `siteclosed.nordstrom.com/invitation.html` (seq 13), both attempts |
| 1517 shein.com | Risk deny page (403, risk-id) | `STATUS: 403` (seq 5). Reached by a guessed search URL |
| 1434 redfin.com | Rate-limit page (HTTP 429) | `ratelimited.redfin.com` "Are You a Robot?" (seq 9) |
| 1837 tiktok.com | Regional unavailability | "On June 29, 2020 the Govt. of India decided to block 59 apps..." (seq 3) |
| 2554 johnlewis.com | Transport reset | `ERR_HTTP2_PROTOCOL_ERROR` on both attempts (seq 9); no control |
| 929 justdial.com | Transport reset | `net::ERR_HTTP2_PROTOCOL_ERROR` (seq 7); no control |

For 2554 and 929, no curl control was run (the control is only defined for the B6 ids). A client-side transport cause cannot be
ruled out for these two; they are classed EXTERNAL-BLOCK(protocol) under the pre-registered table.

### 5.3 SUTRADHAR-FAIL

None. One was proposed (2561) and ruled AGENT-FAIL; see 5.5. The confirmed defects are in section 6.

### 5.4 AGENT-FAILs (9)

| ID | Why |
|---|---|
| 1979 usa.gov | Substitution: values from `/benefits`, not from the "Benefits & Services" search the task named |
| 1379 polygon.com | Gave up as "drift" on weak checks ("popular" appears nowhere; homepage `text` truncated) |
| 2687 uptodown.com | Gave up as "drift"; truncated read, guessed URL |
| 696 goal.com | Gave up as "drift"; latest match page was reachable |
| 2561 kayak.com | No answer. Detached-frame defect plus agent handling; see 5.5 |
| 1371 playstation.com | Developer field missing; read truncated; partial answer is never COMPLETED |
| 1789 theguardian.com | Star ratings graphical only; no answer; premises never gathered |
| 2582 msdmanuals.com | Reads stopped before the risk-factor section; never used `read` or scroll |
| 982 lawinsider.com | Data was in the log; no answer recorded; the site shows "Filed", not "effective date" |

### 5.5 Disputes and rulings (orchestrator, from logs only; no default to the driver)

| Task | Driver | Verifier | Ruling | Basis |
|---|---|---|---|---|
| 2561 | AGENT-FAIL (partial) | SUTRADHAR-FAIL | AGENT-FAIL (reasoning), D1 recorded as confirmed | detached-Frame reproduced 3 times (seq 33/37/47/49 and replay), but on `/hotels` typing worked and no suggestion was selected, so causation is contested; less favourable class applies |
| 1979 | AGENT-FAIL (substitution) | COMPLETED (interpreted) | AGENT-FAIL (substitution) | Values from `/benefits`, not from the requested search; no interpretation ground; renamed-section rule |
| 1379 | TASK-INVALID (drift) | AGENT-FAIL | AGENT-FAIL (reasoning) | Drift needs two independent in-site checks; one was a repeat read, one a read cut at 4000 characters |
| 2687 | TASK-INVALID (drift) | AGENT-FAIL | AGENT-FAIL (reasoning) | Truncated read plus a guessed URL; Android listing unchecked |
| 696 | TASK-INVALID (drift) | AGENT-FAIL | AGENT-FAIL (reasoning) | Both checks only prove "no site search"; match page reachable (seq 20) |
| 597 (re-test) | COMPLETED (strict) | AGENT-FAIL (unsupported) | AGENT-FAIL (substitution) | "Highly cited" unsupported. Probe PASS regardless |
| 41 (re-test) | COMPLETED (strict) | COMPLETED (interpreted) | AGENT-FAIL (substitution) | First all-terms match (#3) skipped without reason. Probe PASS regardless |
| 2253 | COMPLETED (interpreted) | COMPLETED (strict) | COMPLETED (strict) | Protocol 2.5 names eur-lex.europa.eu as on-site |
| 1925 original | COMPLETED (strict) | (saw mutated copy) | COMPLETED (strict) | All three goals real in seq 29; sustain.ucla.edu on-site |
| 2336 original | COMPLETED (interpreted) | (saw mutated copy) | COMPLETED (interpreted) | Slugs are the first five links at seq 17; en-GB auto-redirect is a valid ground. Order risk noted; if "first 5" were held unsupported the fallback is AGENT-FAIL, which would leave strict H1 unchanged and lower the lenient figure to 6/29 |

Both classes are listed above in every case. A 2336 downgrade would not change the headline.

Classes where the driver and verifier agreed but with different subflags (1789, 2582, 982, 1434, 192) were not disputes.
The mechanical checker (C1 to C8) passed 35 of 36 records; the one failure (41, C2d) was resolved under protocol 4.3-2.
Transcript cross-check: T1 flags in all six slots are the drivers hashing their own brief (instructed); T4 flags in B1 to
B3 are chained `drive.mjs` calls (re-derived per task: 35 of 36 match exactly; 1434 differs by one because of a
variable-path `close`). No fabricated records were found. Chaining is a rule slip, not score-changing.

### 5.6 Canaries (protocol 4.4)

| Canary | Task | Mutation (verifier copy only) | Phase-1 result |
|---|---|---|---|
| K2 | B4/1925 | 3rd goal replaced by "Housing & Hospitality", a footer nav label from the same output | Classified AGENT-FAIL; mutated value singled out. **Caught** |
| K1 (substitute) | B4/2336 | 5th slug replaced by the 7th link in the same output (wrong rank) | Classified AGENT-FAIL; 5th value singled out. **Caught** |
| K3 | B2/2554 | EXTERNAL-BLOCK turned into a fake COMPLETED with "This site can't be reached" and "ERR_HTTP2_PROTOCOL_ERROR" as kettle specs | Classified EXTERNAL-BLOCK(protocol), values judged error text. **Caught** |
| Control | K/1310 | none (osu.edu, honest) | COMPLETED, kept |

K1 as specified (reserve 1414 turned into a completion) was impossible: the honest run of 1414 was EXTERNAL-BLOCK (HTTP 402) and
had no titles. The substitution to 2336 is recorded in DEVIATIONS 6. All three canaries passed the mechanical checker, so only
a reading verifier could catch them, and it did. The verification is therefore valid. Scores use the original records.

## 6. Defects and observations (filed in `.ai/known-problems.md`)

| ID | Defect | Evidence | Effect in this run |
|---|---|---|---|
| PROB-047 (D1) | `click`/`type` fail with "Attempted to use detached Frame" after same-origin navigation on kayak.com `/stays`; snapshot returned 0 interactive elements once | 2561 seq 33/37/47/49, `text` works on same page (seq 43); verifier replay 3 times via an independent frame inventory; `clickrole` works | Plausibly cost 2561 a route; ruled agent failure |
| PROB-048 (D2) | `text` silently truncates page text at 4000 characters, no marker, no way to page; MCP `snapshot` slices again to 2000 | `runtime.ts:2959` `document.body.innerText.slice(0, 4000)` (PDF path 2986); 42 of 91 `text` calls returned exactly 4001 characters; 982 `text` showed 3 of 10 cards, `read body` all 10 (seq 19 vs 33) | See 3.3 item 6 |
| PROB-049 (D3) | `snap` prints `[#5]` but `click "#5"` / `type "#5"` exit 1: `Invalid selector "#5" ... pass just the number` | 8 failed calls across 6 task logs: 1172 (seq 19), 1946 (seq 7/9), 781, 2561, 1329, 597 | One wasted call each; also the driver brief's own example used `#12` |
| PROB-050 (D4) | `back` prints `undefined` to stdout (exit 0, navigation correct). Precisely: the CLI has no native `back` verb; the wrapper's `back` pseudo-verb is `eval history.back()`, and `eval` of a void expression prints the literal `undefined`. So the user-visible defect is that CLI `eval` echoes `undefined` and there is no first-class back-navigation verb with a verified result | 192 notes; smoke test `eval "history.back()"` printed `undefined` (exit 0); `lib.mjs` line 88 maps `back` to that eval | Cosmetic |
| PROB-051 | A read verb (`text`, `snap`, `eval`) run with no session silently launches a blank browser and exits 0 | Smoke test `cli-smoke-2026-10-04.md` finding 3 | The wrapper added a guard (exit 97); a driver following the help text could read "empty page" as a real result |

Observations, not filed as separate problems:
- `nav` to a page that answers with an HTTP error prints `Verification: NOT verified — contradicted (confidence 0.09)` but
  exits **0**. In the 534 B1 to B6 records this happened on 21 navs (403 x 15, 404 x 3, 429 x 2, 410 x 1) and on 2 more in
  slot K (HTTP 402, realsimple.com). The text is honest; an agent or script that trusts the exit code alone would not see
  the contradiction.
- Unconfirmed possible false failures, not shown by a control: 2388 `click` timeout although the filter applied (seq 35) and
  `--expect-url-changed` exit 4 when a click opens a new tab (seq 17); several `occluded` refusals (1925 seq 23, 2561 Dismiss,
  41 seq 21).
- Harness weakness, found by canary K3: the checker treats the `chrome-error://chromewebdata/` page as an allowed automatic
  redirect domain (flag `geo-redirect`). Suggested fix: exclude non-http(s) hrefs from the redirect allowance.

## 7. Baseline correction (summary of protocol section 1)

- The 13 August reports total 130 attempts: 79 completed (13 of those flagged by the reports themselves as interpretation,
  substitution or partial), 41 EXTERNAL-BLOCK, 3 AUTH (agoda), 7 DRIFT.
- Removing 11 tasks of sample 7 that are not WebBench rows, the invented sample-5 cbs.com task, and the sample-12 duplicate
  leaves **117 unique dataset tasks: 71 completed (12 interpreted), 36 EXT, 3 AUTH, 7 DRIFT**. With AUTH and DRIFT as
  TASK-INVALID, in-scope is 107; strict 59/107 and lenient 71/107.
- Sample 5 had 6 wrong ids; samples 11 to 13 carry a wrong file date; sample 10 used Opus; samples 8 to 10 used the CLI.
- "0 Sutradhar-attributable failures" came from fixing a bug mid-run and then counting the task as completed (S3 T36, S13 T597).
  Under a frozen-build rule those two would have been SUTRADHAR-FAIL.
- `CLAUDE.md`'s "15/29" paragraph is the state after sample 3, and its "14 anti-bot/auth blocks" include 3 login tasks and 1
  drift task. `.ai/competitive-benchmarks.md` already says 79/130. Proposed replacement text is in Appendix A. **CLAUDE.md is not
  edited here.**

## 8. False-pass analysis

For each headline claim, one way it could be wrong and what rules it out. Commands were re-run against live files after the
final classification (not reused from earlier output).

| Claim | How it could pass while wrong | What rules it out | Residual |
|---|---|---|---|
| H1 6/29, H2 6/16 are computed correctly | Hand arithmetic, a wrong denominator, or interval code that is subtly off | `node compute-metrics.mjs` computes everything from the records and asserts the six class counts and the four published baseline intervals (it would throw on any mismatch); Newcombe routine reproduces the published 0.0524 to 0.3339 example | The OVERRIDES table in the script is a transcription of `verify/adjudication.md`; a typo there would show up as an assertion failure on the counts, but a swapped subflag would not |
| The 7 completions are genuine | An answer taken from memory, from injected text, or from the wrong item | Checker C1 to C8 passed all 7 (chain intact, verbatim in page-reading output, no driver JS, domain fence); verifier read every field; 3 replayed; three checker-passing canaries were rejected | 4 completions were not replayed; replay on time-varying tasks (2388) confirms only the kind of data |
| The verifier was not rubber-stamping | A verifier that agrees with everything | All 3 canaries (wrong-item and fake-completion) classified non-COMPLETED; the control stayed COMPLETED; it disagreed with the drivers on class for 7 tasks (5 primary, 2 re-test) | The canary design (checker-passing, real page strings) is the only test of the verifier |
| 0 SUTRADHAR-FAIL | A defect hidden behind an AGENT-FAIL label | All 9 AGENT-FAILs were read by the verifier in phase 1; 6 of 9 were also replayed in phase 2 (1979, 1371, 1789, 2561, 2582, 982). 1379, 2687 and 696 were not replayed because the drivers had classed them TASK-INVALID, so they were not on the replay list (a protocol gap: the list is built from driver classes); rule 5 is evaluated before the evidence rule; D1 to D3 were surfaced precisely because they were checked rather than dismissed | 2561 is a close call: the less-favourable-class rule put it in AGENT-FAIL; a reader who weights D1 more could call it SUTRADHAR-FAIL (then 1 SUTRADHAR-FAIL and 8 AGENT-FAIL, H1 unchanged) |
| Stale build | Another sutradhar build answering | cli-bin.js sha256 re-checked now: `9858726a...5c59b`; 0 exit-99 records; manifest check OK | Tarball integrity compared to `npm view` before the run, not after |
| Blocks are genuine | A block caused by the tool, not the site | Two attempts each; Cloudflare/DataDome/Akamai ids in the page; another-tool replay on 3 blocks; curl control on 392 | 2554, 929 (no control) and 392 (curl 200) leave a client-side transport cause open |
| Drift or substitution rulings are not biased down | The orchestrator taking the harshest reading each time | Each ruling lists seq numbers and the protocol rule; the drivers' own classes are shown as a sensitivity (5/26 = 19.2%); an unresolved dispute takes the less favourable class **by pre-registered rule** | This rule is deliberately unfavourable to completions; the headline is an honest lower-leaning figure, not a neutral estimate |
| Replay was independent | A same-tool replay reproducing the same artefact | 7 of 12 replays used a second, non-headless browser tool | 5 replays were same-tool and are counted as confirmation only |
| Log not forged | A driver rebuilding a valid chain | Hash chains + gap detection + transcript cross-check (T1 to T4); every log record maps to a driver call (35/36 exact, 1 explained) | No secret in the chain; `raw.sha256` was generated after the run, not at progress snapshots (DEVIATIONS 5) |

## Appendix A. Proposed replacement for CLAUDE.md's "15/29" paragraph (not applied)

The current paragraph says that three real WebBench samples (29 tasks) gave "15/29 completed with real, verifiable answers;
14/29 blocked by external anti-bot/auth walls; 0 Sutradhar-attributable failures", and calls it the honest current number.
Proposed replacement for that paragraph (the two sentences that follow it about `browser.type` can stay):

> **Current honest numbers (two figures, never merged).** *Historical, self-judged:* 13 August samples, 130 attempts, 79
> reported completions (13 of them interpretations or substitutions), 41 external blocks, 3 login tasks, 7 target-gone
> tasks; deduplicated to the 117 real dataset tasks, strict 59/107 (55.1%) and lenient 71/107 (66.4%) on in-scope tasks. The old
> "0 Sutradhar-attributable failures" is a counting convention (bugs fixed mid-run, then counted as completed), not a
> measurement. *Pre-registered, blind-verified, published 0.6.1 CLI (2026-10-04, `tools/webbench/claude-direct-run-2026-10-04.md`):*
> 30 fresh seeded tasks, 6 completed strictly (H1 20.7%, 95% CI 9.8 to 38.4), 1 more under an interpretation, 13 stopped by
> external walls (43%), 9 agent failures, 0 Sutradhar-attributable failures after adjudication, with 4 confirmed product defects
> (PROB-047 to PROB-050) and 1 usability defect (PROB-051). The two figures use different rules, domains, surfaces and viewports,
> so neither supports a claim about version-to-version change. The primary benchmarking mode is still the host AI driving
> `browser.*` or the CLI directly, but new runs must use the pre-registered wrapper and blind verification, and results
> must be reported as completed / externally blocked / agent failed / Sutradhar failed, not as a completion rate alone.
