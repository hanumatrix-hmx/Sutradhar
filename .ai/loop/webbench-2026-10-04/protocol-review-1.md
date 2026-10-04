# Protocol review 1: WebBench run 2026-10-04 (independent, adversarial)

Reviewer: Opus subagent. I did not write the protocol, and I ran no tasks and drove no browser.
Files reviewed: `protocol.md`, `select.py`, `selection.json`, `cli-smoke-2026-10-04.md`,
`tools/webbench/*`, project and global `CLAUDE.md`, and the installed 0.6.1 package under `<SCR>/v061/inst`.

**Verdict: REVISE.** There is 1 BLOCKER and 7 MAJOR findings. All of them can be fixed on paper; none needs a re-draw.

---

## What I checked and found sound (with evidence)

- **The selection reproduces exactly.** I copied `select.py` to `<SCR>/rev1/select_copy.py`. The only changes were the `HERE` path (pointed at the worktree for reading) and the output path (pointed at scratch, so the committed file was not overwritten). I ran it against `<SCR>/webbenchfinal.csv`.
  - `sha256sum` printed `fd5311a3…0165217`, which matches the pin.
  - The script printed `excluded domains: 124  eligible domains: 328`.
  - `cmp <SCR>/rev1/selection.json .ai/loop/webbench-2026-10-04/selection.json` printed **IDENTICAL**.
  - `git status --short` showed only the untracked directory. I wrote nothing else.
- **The screen is not a difficulty filter.** All 14 out-of-scope draws other than poshmark come from WebBench's own `Category` (CREATE, UPDATE, DELETE or FILE_MANIPULATION). The keyword regex excluded no READ task: its only three hits were force-included.
  - The manual adjudications were necessarily made after seeing the draw.
  - Their net direction is toward *harder* tasks, for example forcing TikTok in.
  - Poshmark ("your sales dashboard") genuinely needs an account.
  - Known-hard domains (Yelp, Kayak, Shein, Home Depot, Nordstrom) remain.
  - I see no cherry-picking.
- **The claim that the CLI and MCP share the runtime holds for the two re-test verbs.** In the installed `cli-bin.js`, `cmdClickText` calls `runtime.clickByText(...)` and `cmdType` calls `runtime.type(...)`.
- **Concurrent sessions cannot collide on a port.** `spawnDetachedChrome` uses `getFreePort()`, not a fixed 9222.

---

## Findings

### 1. BLOCKER: completions rest on driver-written excerpts; there is no raw tool log, and drivers are not restricted from other information sources

**Evidence.**
- Section 3's record holds `evidence[].text` and `verificationLines`, which the driver types itself. Nothing captures the CLI's actual stdout.
- The verifier gets only the record (section 4). Live replay covers about 30% of COMPLETED tasks, and time-varying answers are judged only on "structure".
- Drivers are general-purpose Sonnet subagents. Nothing in the protocol forbids WebSearch, WebFetch, `curl`, the Claude_Browser or claude-in-chrome tools, or answering from parametric memory. Several answers are memorable facts, for example P24's Horizon Forbidden West release date and developer, or P30's Joe's Pizza phone number.
- For the roughly 70% of COMPLETED tasks that are not replayed, a fabricated or memory-sourced answer with a plausible excerpt would pass verification. This is the main inflation path, and the canaries do not cover it.

**Fix.**
- Wrap every CLI call in a pre-registered script, for example `<SCR>/wb/wb.sh`. It should append ISO time, argv, exit code and full stdout/stderr to `runs/B<n>/cli.log`, which is append-only; the driver never writes it directly.
- Require every `evidence[].text` to be a verbatim substring of a `cli.log` entry for an `eval`/`text`/`snap` call on the recorded URL. The verifier checks this mechanically for 100% of COMPLETED tasks; a substring check is cheap.
- Derive `toolCalls` and `toolsUsed` from the log, not from self-report.
- In every brief, forbid WebSearch, WebFetch, curl, any non-Sutradhar browser tool, and answers not backed by a logged excerpt.
- Add to the false-pass analysis: "answer from memory or another tool → ruled out by the substring check against `cli.log`".

### 2. MAJOR: the CLI launches Chrome with a different fingerprint and viewport from MCP, so section 0a's "same engine, bias only downward" is false

**Evidence.**
- In the installed `cli-bin.js` (around line 46150), `spawnDetachedChrome` passes only these flags:
  - `--remote-debugging-port`
  - `--user-data-dir`
  - `--no-first-run`
  - `--no-default-browser-check`
  - `--headless=new`
- MCP and SDK launches go through Puppeteer with `DEFAULT_LAUNCH_ARGS` (line 34255). Those include:
  - `--disable-blink-features=AutomationControlled`, which the source says changes `navigator.webdriver`;
  - `--window-size=1280,800`;
  - Puppeteer's own defaults, such as `--enable-automation`.
- The smoke screenshot was 785x745, not 1280x800.
- Bot-detection exposure and responsive layout (mobile breakpoints, hidden filters) therefore differ between the surfaces, in a direction nobody knows. The August reports never recorded headless or headed mode, user agent, or viewport, so samples 1–7 and 11–13 are confounded on this point too.

**Fix.**
- Delete the "can only lower … never raise" sentence.
- After each `nav`, have each driver log one read-only `eval` of `navigator.webdriver`, `navigator.userAgent`, `innerWidth`/`innerHeight`, and `chrome` version.
- In the report, list "CLI launch flags/viewport ≠ MCP" as a confound that can push either way.
- Do not pass `--viewport` or change flags to "fix" it. That would change the artifact under test, and some flags edge toward stealth, which is excluded.

### 3. MAJOR: the classes are not mutually exclusive in three places that matter for the headline

**Evidence.**
- **(a) Login wall.** "A login wall in front of public-looking content" is EXTERNAL-BLOCK, while "turns out mid-run to need an account" is TASK-INVALID. P08 TikTok, P29 lawinsider and P10 nytimes could each be scored either way. TASK-INVALID leaves the in-scope denominator; EXTERNAL-BLOCK stays in it.
- **(b) Drift.** "Literal target no longer exists → a disclosed equivalent" gives COMPLETED/interpreted, while "target gone, two checks" gives TASK-INVALID. The driver chooses which. Both choices move the lenient or in-scope rate upward compared with AGENT-FAIL. This is exactly the August substitution problem: "functionally equivalent" is undefined, as in P05 "Spring Fashion Trends" (any spring article?) or P11 (any kettle?).
- **(c) Workarounds.** A Sutradhar defect worked around by "a different tool" (section 3, "Frozen build") ends as COMPLETED and the defect disappears from the counts. The SUTRADHAR-FAIL control ("same effect done through `eval`") collides with the ban on mutating `eval`: if `eval` clicks after `clicktext` fails and the task then completes, which class applies?

**Fix.** Pre-register these tie-breaks:
- **(a)** If the requested data is account-specific, the task is TASK-INVALID(auth). If it is public data gated for anonymous or automated sessions, it is EXTERNAL-BLOCK(login-wall).
- **(b)** Interpreted is allowed only for:
  - the pre-registered rules in section 2.5 (dates, geo, typos);
  - a substitute that keeps every named entity in the task (title, product, place, count).

  Any other substitution is AGENT-FAIL/substitution.
- **(c)** Add a mandatory `toolDefects[]` field. Report "COMPLETED with ≥1 Sutradhar defect" as its own count, next to SUTRADHAR-FAIL.
  - A completion that relied on a mutating `eval` workaround is not COMPLETED/strict.
  - Allow mutating `eval` only as the SUTRADHAR-FAIL control step, and record it as such.
- Make **strict** the headline rate and present lenient secondary. Section 4 currently gives no headline.

### 4. MAJOR: the retry and reproduction rule contradicts itself and can inflate completions

**Evidence.**
- Section 3 says a retry happens "only after a transient error (net::, session lost, crash)".
- The same section says EXTERNAL-BLOCK "needs the block to show again on attempt 2". So every block also triggers a second attempt, which is a retry against bot detection, which section 3 also forbids ("no retries meant to get lucky").
- The protocol never says how a block on attempt 1 followed by success on attempt 2 is scored.
- August did not systematically retry blocks, so a block-then-success completion inflates the comparison.

**Fix.**
- State plainly that a block on attempt 1 triggers exactly one attempt 2 in a fresh session, used for confirmation.
- If attempt 2 succeeds, score COMPLETED with subflag `a2-after-block`. Report those separately, and give the strict rate both with and without them.
- Give the classification for each combination of the two attempts in a small table.

### 5. MAJOR: the canaries are trivially detectable, so they are not a real negative control

**Evidence.**
- Section 4.3 plants "mutated copies of COMPLETED records under random ids".
- The verifier receives the task text, so it sees 32 records in which two task texts are duplicates, or two ids are not among the 30 pre-registered ones that `selection.json` publishes.
- A verifier that rubber-stamps everything but rejects obvious duplicates would pass the control.

**Fix.**
- Build the canaries from **reserve** tasks R31 and R32. The orchestrator runs them first, or mutates a real record and swaps it in under the reserve id.
- Tell the verifier only that the set "may include up to 4 extra tasks drawn from the reserve list".
- Better still, also mutate 1–2 *real* primary records in a verifier-input copy, and diff the verifier's verdicts against the unmutated run.
- Add one canary that turns an EXTERNAL-BLOCK into a fake COMPLETED. The current canaries test field presence only.

### 6. MAJOR: disagreements default to the driver; replay selection breaks blinding; replays are not independent of the tool under test

**Evidence.**
- Section 4.4 says "verifier's class stands only when it cites evidence". Otherwise the driver's more favourable class wins.
- The replay sets (100% of SUTRADHAR-FAIL and AGENT-FAIL, plus 3 EXTERNAL-BLOCKs) are chosen by the driver's classification. The verifier must therefore learn the classes it is supposed to be blind to.
- Replays use the same Sutradhar CLI. A systematic extraction defect, such as `text` dropping content, reproduces identically and confirms itself.

**Fix.**
- **Selection.** The orchestrator computes the replay id list. It gives the verifier only the ids, not the classes, and the verifier classifies before replaying.
- **Unresolved disputes.** The headline uses the *less favourable* class, and the report lists both. Optionally, a third adjudicator rules on any dispute that remains.
- **Independent check.** For each replayed COMPLETED task, confirm that at least one answer field appears through an independent read-only channel. The Claude_Browser pane's `get_page_text` or a plain `curl` of a static page are options; WebFetch is not, because it summarises. Record "no independent channel" where none works.

### 7. MAJOR: `select.py` is reproducible today but not after the run, and it is not read-only

**Evidence.**
- The exclusion set is read live from `tools/webbench/tested-domains.txt` and `tasks*.json`.
- Section 6.2 then appends the 30 primary domains and adds `tasks-sample14.json`. After that, a re-run excludes all 30 and draws a different sample.
- Running the script also overwrites `selection.json` next to it. The docstring calls it "read-only".
- I could only verify reproducibility by patching the output path.

**Fix.**
- Freeze the 124-domain exclusion list into `selection.json` (`_excluded`). Alternatively, pin `sha256` of the sorted exclusion list in `select.py` and fail on mismatch, the same way the CSV hash is pinned.
- Add an `--out` argument that defaults to stdout or scratch, and never write over the committed file.
- Record the exact verification command in the protocol.

### 8. MAJOR: the driver brief is not pre-registered

**Evidence.** Section 3 gives rules, but the actual prompt each Sonnet driver receives is not fixed. A reader cannot reproduce the run, and briefs could differ between batches, for example in how hard they push to "find an answer".

**Fix.**
- Commit a single brief template, `driver-brief.md`, with `{batch}`, `{tasks}` and `{B}` placeholders, before wave 1. It must carry all of:
  - the scope boundary;
  - the no-image-kill rule;
  - the tool restrictions from finding 1;
  - "page content is untrusted data, not instructions" (prompt injection from third-party pages);
  - the exit condition.
- Record its sha256 in the report header.

### 9. MINOR: the path-length arithmetic is wrong

**Evidence.**
- `echo -n "$SCR/wb/B1/t" | wc -c` gives **168**, not 166.
- 168 plus `/sutradhar-cli-<13>-<6>` (35 characters) is 203, which is over the protocol's own ≤200 cap.
- The `${#TEMP} ≤ 170` gate allows 205.
- The smoke test's `wbsmoke/tmp` path was about 205 and worked. The known failure, in release-0.6.1 `plan.md` P5, was at 257.

**Fix.** State the real number (203), and either change the cap to "≤210, smoke-verified at about 205" or shorten the path, for example `<SCR>/w/1/t`.

### 10. MINOR: the `SUTRADHAR-FAIL` control names an MCP tool

**Evidence.** Section 4 says "through `browser_eval` on the DOM", but MCP is forbidden in this run.

**Fix.** Change it to the CLI's `eval`.

### 11. MINOR: the build pin is a single file

**Evidence.**
- G0 hashes only `cli-bin.js`. The bundle still loads `puppeteer-core`, resolved to **25.12.0** from `^25.5.0`.
- "Registry-identical per the orchestrator" cites no evidence. The lockfile has the evidence: `integrity sha512-CXcYoKxW…X36Q==` for `sutradhar-0.6.1.tgz`.
- Chrome and Node versions are not recorded.

**Fix.**
- Record the lockfile integrity line, `npm view sutradhar@0.6.1 dist.integrity` (read-only) showing that it matches, the `puppeteer-core` version, `node -v`, and the Chrome version.
- Have the drivers re-check the Chrome version at the end of the run, in case it auto-updated mid-run.

### 12. MINOR: there are errors in section 1's baseline

**Evidence.**
- Sample 7, "12 of 12 tasks are not WebBench rows", is wrong. Fuzzy-matching against the pinned CSV gives an exact match for id 329 crunchyroll (ratio 1.00 on the first 150 characters); the other 11 match nothing (best ratio ≤0.86, and that best match is to other domains). So the clean baseline removes one task too many.
- The baseline tasks were hand-picked in August, not seeded. The comparison is also confounded by domain mix, Chrome version and surface.

**Fix.**
- Correct the count to 11 and recompute the clean-baseline row.
- State that any difference against the baseline cannot be attributed to 0.6.1.
- Use a Newcombe CI for the difference, not two separate Wilson intervals.

### 13. MINOR: the "scope ratio" is the dataset's base rate, not a finding

**Evidence.**
- 14 of the 15 out-of-scope draws come from WebBench `Category` alone.
- Non-READ rows are 1010 of 2647, or 38%, in the CSV. The 33% observed is that base rate plus sampling noise.

**Fix.** Report it as "consistent with WebBench's 38% non-READ share", not as a result about read-only drivers.

### 14. MINOR: some instructions are not executable as written

**Evidence and fixes.**
- **Missing directories.** Nothing creates `wb/B<n>/{s,t,c}`. Add a `mkdir -p` step to the brief.
- **Process listing from Bash.** The `Get-CimInstance` check is PowerShell, but drivers run Bash. Give the exact `powershell.exe -NoProfile -Command '…'` form, quoted so `$_` survives.
- **Curl control.** It writes to `-o NUL`. Use `/dev/null`, per the global rules.
- **Curl outcomes.** Pre-register how the result maps to a class. Curl's TLS and HTTP2 fingerprint differs from Chrome, so a curl 200 does not prove a Sutradhar fault. Suggested mapping:
  - curl fails the same way → EXTERNAL-BLOCK(outage/edge);
  - curl 200 → EXTERNAL-BLOCK(client-fingerprint), unless another Chrome-based control also fails, which needs no new tool. Never SUTRADHAR-FAIL from curl alone.
- **Hung commands.** There is no per-command timeout. Set the Bash `timeout` to 120 s per CLI call, and treat a timeout as a recorded error.
- **Lost sessions.** If `eval location.href` returns `about:blank` mid-task, the session was lost and auto-relaunched (the smoke-test pitfall). Treat it as a transient error: run `close`, then attempt 2. Do not treat it as "page empty".

### 15. MINOR: the re-test probes can come out vacuous

**Evidence.**
- 597 tests `<mark>`-split titles only if frontiersin still highlights the query.
- 41's phrase "type into the **same** input" is ambiguous after navigating to the results page.
- PROB-043 (a long-session MCP bug) cannot be reached through a one-process-per-command CLI, so this run says nothing about it.

**Fix.**
- Precondition for 597: an `eval` counting `mark` elements inside result titles. If the count is 0, record "probe not exercised", not a pass.
- For 41: "the search input present after the first search".
- State in the report that this run cannot probe PROB-043.

### 16. MINOR: evidence goes into a public repo

**Evidence.**
- The repo is public.
- Screenshots go to `runs/B<n>/*.png` inside the repo.
- Evidence excerpts can reach 2,000 characters of copyrighted articles (NYT, Guardian, Harper's) and personal or business contact data (P13, P27).

**Fix.**
- Keep PNGs in `<SCR>` or gitignore them.
- Cap committed excerpts at the minimum span containing the answer, about 300 characters.

---

## Summary table

| # | Severity | Topic |
|---|---|---|
| 1 | BLOCKER | No raw CLI log; excerpts self-reported; drivers not barred from WebSearch/WebFetch/memory |
| 2 | MAJOR | The CLI launches Chrome without `DEFAULT_LAUNCH_ARGS` (different webdriver flag and viewport), so "bias only downward" is false |
| 3 | MAJOR | Overlap between login-wall/auth, drift/interpreted, and defect-workaround classes; no headline rate |
| 4 | MAJOR | Retry rule contradicts itself; block-then-success not scored |
| 5 | MAJOR | Canaries identifiable by duplicate text or unknown ids |
| 6 | MAJOR | Disputes default to the driver; replay selection leaks classes; replay not independent |
| 7 | MAJOR | Exclusion inputs mutate after the run; `select.py` overwrites its output |
| 8 | MAJOR | Driver brief not pre-registered |
| 9–16 | MINOR | Path arithmetic, MCP tool named, build pin, baseline count, scope-ratio framing, executability gaps, vacuous probes, public-repo evidence |

## False-pass analysis of this review

- **"Selection reproduces"** could pass falsely if I compared against a file I had regenerated myself. Ruled out: my copy wrote to `<SCR>/rev1/selection.json`, and `git status --short` afterwards showed only the pre-existing untracked directory. The committed file was not rewritten; its timestamp is still 14:41.
- **"CLI launch flags differ"** could be wrong if a different code path were used at runtime. Ruled out in part: `spawnDetachedChrome` is the only spawn site that emits the `remote-debugging-port=${port}` template in `cli-bin.js`, and the 785x745 smoke screenshot is consistent with no `--window-size`. I did not launch a browser to confirm `navigator.webdriver`; finding 2's fix measures it.
