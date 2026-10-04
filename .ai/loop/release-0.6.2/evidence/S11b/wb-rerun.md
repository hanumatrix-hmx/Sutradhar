# S11b - WebBench 982 / 2561 mini re-run through the packed CLI (regression check, NOT a scored sample)

CLI under test: `$R/S11-consumer/node_modules/sutradhar/dist/cli-bin.js` = the packed `sutradhar-0.6.2.tgz` installed into a clean dir,
sha256 `f221f536b9655e5580752adf8189145b9c4d8bb7ed2108633c89f923f5cae346` (printed in each harness header), `puppeteer-core` 25.12.0, version 0.6.2.
Harness `wb-rerun.mjs` (self-test `SELFTEST=1`: 13 PASS before any site contact), ISO `Wbt` (fail-closed, `.r062`, guarded delete after),
`SUTRADHAR_CONFIG=none`, state `Wbt/state`, <= 2 attempts per task, no stealth, nothing retried beyond the 2 attempts. Every command's exit, ms,
stdout/stderr sha256 and excerpts are in `982.jsonl` / `2561.jsonl`; full stdout/stderr per call in `raw/`.
Run 1 (`wb-rerun-run1.json`, harness sha `0ba7e227...`, log `harness-run1.*`): both tasks, attempt 1. Run 2 (`wb-rerun.json`, harness sha `5a4ae227...`,
log `harness.*`): 2561 attempt 2 only (`START_ATTEMPT=2`); the harness change between the runs only adds the attempt-2 branch (in-page "Stays" link
if `/stays` cannot be navigated to) and the `START_ATTEMPT` switch (`diff wb-rerun.run1.mjs wb-rerun.mjs`).

## Results
| task | attempts | outcome | regression verdict (no detached Frame / no empty snap) | notes |
|---|---|---|---|---|
| **982 lawinsider.com** | 1 | **COMPLETED** (the paging regression AC holds) | PASS | see numbers below |
| **2561 kayak.com** | 2 | **INCOMPLETE** (task not completed; attempt 1 also hit a site-side navigation abort) | PASS in both attempts: no output of any command contains `detached Frame`; neither `snap` printed `Interactive elements (0)` (94 and 106 elements in attempt 1, 61 and 64 in attempt 2) | a1: `nav /stays` -> `Fatal: net::ERR_ABORTED` (exit 1; same abort as the S4 supporting run, site-side/intermittent), flow ran on the flights home page; a2: fresh session, `nav /stays` exit 0 |

### 982 numbers (all from `wb-rerun-run1.json` / `982.jsonl`)
- `text --json`: `offset 0`, `returnedChars 4000`, `totalChars 9593`, `truncated true`, `source dom`; plain `text` marker
  `[page text truncated: showing characters 0-4000 of 9593. Continue with: sutradhar text --offset 4000]` (marker total == JSON total == 9593).
- `eval document.body.innerText.length` immediately after the first `text`: **9593**; again after the paging: **9593** (no difference this time; a difference on
  this dynamic page would have been recorded with both numbers, not auto-failed).
- Paging from the end of the first window: `--offset 4000` -> marker `4000-8000 of 9593`, `--offset 8000` -> `[page text: showing characters 8000-9593 of 9593 (end)]`;
  3 windows, concatenation length 9593 == the eval total; an `eval` of the full text printed 9594 characters (the CLI's trailing newline).
- Every `Filed <date>` entry in the eval of the full text (10 of them) is in the paged text (10/10): December 26, 2022; July 01, 2021; September 06, 2020;
  January 29, 2022; February 02, 2023; October 02, 2024; March 21, 2023; April 29, 2022; September 19, 2024; May 29, 2020.
- The first five results (title, "Filed"): NON-DISCLOSURE AGREEMENT (Dec 26, 2022); NON-DISCLOSURE AGREEMENT (Jul 01, 2021); NON-DISCLOSURE AGREEMENT
  (Sep 06, 2020); "Non disclosure agreement template word" (Jan 29, 2022); Non-Disclosure Agreement (Feb 02, 2023). In 0.6.1 the same page showed 3 of the 10
  cards in `text` with no marker (WebBench 982); the 4001-character cut is gone and the marker names the total.
- Regression checks (all true): first JSON read self-consistent; the plain read's marker describes its own window; last marker is `(end)`; paged text contains every
  eval `Filed` entry. No `detached Frame` anywhere.

### 2561 details (`2561.jsonl`, `wb-rerun-run1.json`, `wb-rerun.json`)
- a1: `nav kayak.com` ok; `nav /stays` aborted (`net::ERR_ABORTED`); `snap` (94 elements) and `text` (2124 chars) on the home page; the scripted destination
  heuristic picked `[#35] div "Swap origin and destination locations"`; `click "#35"` -> `Click failed: No visible element found for selector: [data-sd-node-id="35"]`
  (the `#35` form was accepted and mapped to the node id), `type "[#35]" Rome` -> `Type failed: No element found ...`, `clickrole option Rome` -> no match. Not a
  frame error in any command.
- a2 (fresh session): `nav /stays` exit 0; `snap` 61 elements; `click "#32"` (`div "Enter a city, hotel, airport, address or landmark" role=button`) **exit 0,
  verified** - the click class that failed with `Attempted to use detached Frame` on 0.6.1 (WebBench 2561 seq 33/37/47/49); then `type "[#32]" Rome` failed with
  `No element found for selector: [data-sd-node-id="32"] ... Call browser.snapshot again and use a fresh node id` because the button is replaced by an input
  after the click and my scripted flow did not re-snapshot (a harness limitation, the tool's stale-id message is the intended behaviour); no suggestion was
  picked, `Rome` is not in the final text. The task was therefore **not completed**; 2 of 2 attempts used.
- What this does and does not show: on the real `/stays` page `click`, `type` and `snap` ran without any `detached Frame` and without an empty element list, but the
  page's iframe churn was not measured here (the deterministic churn fixture in S4/S11 item 8c is the proof; this is supporting evidence only). No NEG061 run of
  Kayak was made (a further site contact beyond the two allowed attempts).

## Honest summary
n = 2, not pre-registered, not comparable to the scored 2026-10-04 sample (15/29 completed there; this is a different, tiny, post-fix regression check).
982: completed, and the old defect (silent 4000-character cut) is visibly gone on the real site. 2561: not completed (site-side abort + my scripted flow's stale
id), regression AC met. No Sutradhar-attributable failure; external/site-side: the `/stays` navigation abort in attempt 1.

`node scripts/check-release-ready.mjs` after the S11 commit `a96d284` (S11b evidence moved aside so the tree was clean): `[check-release-ready] working tree clean,
all workspace dependencies fresh — OK to publish.` exit 0. After this S11b commit it is re-run and recorded in `../HANDOFF.md`.

## False-pass analysis
| check | way it could pass while broken | what rules it out |
|---|---|---|
| "no detached Frame" | the churn condition never occurred, so the check is vacuous | stated openly above: supporting only; the discriminating proof is S11 8c (NEG061 fails 5/5, 30/30, 5/5 on the same fixture) |
| 982 paging equality | windows compared with themselves | the reference is an independent `eval document.body.innerText` taken after the paging; lengths 9593 == 9593 and 10/10 `Filed` entries |
| 982 completion | stale `text` served from cache | each `text` is a separate CLI process (`raw/982-a1-0xx.out`, sha in the jsonl) reading the live DOM; the marker offsets advance 0 -> 4000 -> 8000 |
| CLI under test | the repo dist instead of the packed one | header prints the consumer path and sha `f221f536...` (equal to the repo dist because the CLI bundle embeds no version; `index.js`/`mcp-cli.js` in the consumer carry `0.6.2`, S11 item 6b) |
| isolation | Chrome/state outside Wbt | path-log check over all per-call stderr logs: `cleanup-lines=30 outside-iso=0`; wrong-root control exit 1; final CIM query empty (`pathcheck-and-leftovers.txt`) |
