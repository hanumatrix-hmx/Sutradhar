# WebBench run 2026-10-04: pre-registered protocol (Sutradhar 0.6.1), revision 5

**Status: planning only.** Nothing here was run against a WebBench task site. The only live browsing so far was the CLI smoke test and the surface measurement, both against example.com (sections 0b and 0c).

- Worktree: `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041`
- Branch: `bench/webbench-2026-10-04`, from master `1cde002`
- `<LOOP>` = `.ai/loop/webbench-2026-10-04/`
- `<SCR>` = the session scratchpad, `E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad` (160 characters)

Run artifacts are written only under `<LOOP>`. The final report and doc updates (section 6) are written after verification and adjudication.

**Files under `<LOOP>`:**

| File | Role |
|---|---|
| `protocol.md` | This file |
| `select.py`, `selection.json`, `inputs/` | Frozen selection |
| `lib.mjs` | Shared evidence rules: chain, domains, normalisation, verbs |
| `drive.mjs` | The logging wrapper; the only way to call the CLI |
| `check-evidence.mjs` | The mechanical evidence checker |
| `task-fields.json` | Pre-registered required answer fields per task |
| `make-verify-input.mjs` | Builds the blind verifier tree, applies canary mutations, computes the replay ids |
| `driver-brief.md`, `verifier-brief.md` | The frozen prompt templates |
| `tests/selftest/run.mjs` | Offline checker regression test: 39 cases |
| `tests/selftest/blind.mjs` | Blind-input test |
| `tests/selftest/live.mjs` | Live wrapper test: guards plus a dry run of every brief verb |
| `tests/selftest/transcript.mjs` | Transcript cross-check test |
| `log-view.mjs` | Read-only raw-log viewer for the verifier |
| `transcript-check.mjs` | Cross-checks a driver's harness transcript against its raw logs |
| `protocol-review-3.md` | The third independent review |
| `protocol-review-4.md` | The fourth independent review |
| `protocol-review-2.md` | The second independent review |
| `measure-surface.mjs` | The fingerprint measurement |
| `cli-smoke-2026-10-04.md` | The smoke test record |
| `protocol-review-1.md` | The first independent review |
| `MANIFEST.sha256` | Hashes of every frozen file, written last, before wave 1 |
| `.gitignore` | Keeps raw logs and PNGs out of git |

---

## Changes from review-4

Each row names the finding, its severity (M = MAJOR, m = MINOR), what changed, and the evidence. Every self-test was re-run on 2026-10-04 after these changes.

| # | Sev | Resolution | Evidence |
|---|---|---|---|
| A | M | **Decision tree reordered**, the same in protocol 4.1, the driver brief and the verifier brief. Rule 5 is now SUTRADHAR-FAIL and is evaluated **before** evidence-rule. It covers the read verbs (`text`/`snap`/`axsnap`/`read`/`links`/`attrs`) when they error, hang or crash, or when they return content that is provably missing or wrong: visible text shown by a read-only `innerText`/`textContent` eval, or by a screenshot, but absent from `text` on the same page. Rule 6, AGENT-FAIL(evidence-rule), applies only when every verb behaved correctly. It needs `uncitedValue {value, logSeq}`. **New mechanical check C8:** C8a `uncitedValue` is required and must point at an eval/screenshot; C8b a failed read verb in the attempt rejects evidence-rule; C8c the value is visible text that `text` omitted, which rejects evidence-rule. | `honest-evidence-rule` → PASS; `forged-evidence-rule-read-error` → C8b; `forged-evidence-rule-visible-text` → C8c; `forged-evidence-rule-no-uncited` → C8a |
| B | m | **`attrs` cannot launder text.** The wrapper refuses attribute names that do not match `^[A-Za-z_:][-A-Za-z0-9_:.]*$` (≤40 characters; exit 98) and logs the driver's own arguments (`dargs`) on every call. For `attrs`, the checker accepts only the innerText and the attribute **values**: names are stripped using `dargs`, giving C2e "value appears … only as driver-supplied attribute-name text". A value contained in any driver-supplied `attrs`/`read`/`links` argument (selector or names) is C2f. | `forged-attrs-name-echo` → C2e (+C2f); `forged-attrs-selector-value` → C2f; `honest-attrs`, `honest-attrs-value` → PASS; live `98 attrs with a prose attribute name` |
| C | m | **The "seen earlier" echo exemption counts only clean reads:** an evidence verb with exit 0, **untainted** (same `taintOf` as C2b), on an allowed domain of its attempt. | `forged-seen-earlier-tainted` → C2f; `honest-seen-before-typed` still PASS |
| D | nit | Hyphen-slug path echoes (`/search/Zylophone-Studios-555-0199`) are deliberately **not** mechanical echo sources, because many sites use legitimate slugs. They are left to the verifier, which reads every `nav` argv in `log-view.mjs`. | — |

---

## Changes from review-3

Each row names the finding, its severity (M = MAJOR, m = MINOR), what changed, and the evidence. All self-tests were re-run on 2026-10-04 after these changes (section 3.4).

| # | Sev | Resolution | Evidence |
|---|---|---|---|
| 1 | M | **New evidence verb `attrs <css> <name[,name…]>`.** It is wrapper-authored, uses `getAttribute` only, embeds its arguments with `JSON.stringify`, does not taint, and caps output at 60 matches, one line per match: `innerText \| name=value …`. It is in `EVIDENCE_VERBS`, the allow-list, the brief's verb table and the checker. Rule 5 is amended in the brief and in section 4.1: a value the page carries but no evidence verb can surface is **AGENT-FAIL(evidence-rule)**, reported as its own count and **never SUTRADHAR-FAIL**. | `honest-attrs` → PASS; `forged-attrs-after-setattribute` → C2b; live `attrs a href,class` → `\| href=/…` |
| 2a | m | **`waitfor --js` is driver JavaScript.** It taints, and it is an echo source, unless its expression is byte-equal to the pre-registered `INTERSTITIAL_JS` (`!/Just a moment\|Verif/i.test(document.title)`). The wrapper logs `runsDriverJs` per call. | `forged-waitfor-js-injection` → C2b; `honest-interstitial-waitfor` → PASS; live: the log marks only the driver expression as JS |
| 2b | m | **bfcache taint.** A read is tainted when the attempt ran driver JS earlier **and** a `back`/`focustab` happened after the last `nav`. `closetab` is not allowed at all. | `forged-back-bfcache` → C2b ("after back/focustab in an attempt that ran driver JavaScript") |
| 3 | m | **Echo check.** Now case-insensitive (`normLower`), on both the argv and the task-text exemption. `nav`/`newtab` URLs are URL-decoded (`+` → space) echo sources: their query string, fragment, and path segments with encoded spaces. `waitfor --js` is also an echo source. **Mechanical override:** a value already seen in a page-reading output **before** the echoing call is not an echo. The adjudicator may also overrule C2f with a recorded reason. | `forged-nav-url-echo` → C2f; `forged-echo-case` → C2f; `honest-seen-before-typed` (N7) → PASS |
| 4 | m | **Honest cases no longer rejected.** `focustab` onto a tab that appeared after a click from an allowed page is a valid linked-org entry (N3). A read whose own `auto-href` failed inherits the previous call's URL (N4). `norm()` strips U+00AD, U+200B–U+200D, U+2060 and U+FEFF. | `honest-newtab-linked-org`, `honest-failed-autohref`, `honest-soft-hyphen` → PASS |
| 5 | m | **Checker tightened.** `geo-redirect:<domain>` is now flagged, capped at `interpreted`. C7 counts **distinct** values. `--blind` applies C7 to any record with `answerFields`. The verifier brief's same-organisation rule: linked-org is accepted only if shared ownership is evident from the logged page; otherwise AGENT-FAIL(substitution). | `honest-geo-redirect-flagged` → PASS + flag; `forged-duplicate-values` → C7; `blind.mjs` "blind mode applies C7" ok |
| 6 | m | **Verb allow-list** (exactly the brief's table) plus `audit` added to the forbidden verbs (exit 98). The wrapper warns when a call leaves the site (for example `eval location.href=…`); the checker still rejects such reads. | live `98 verb not in allow-list (hover)`, `98 audit forbidden` |
| 7 | m | **Frozen `log-view.mjs`** (per-call table, `--record` ±400-character windows, `--seq`, `--grep`), named in the verifier brief, with the Read tool on raw JSONL forbidden. B6 probes no longer taint: 597 uses `count "mark"`, 41 reads the input value with `snap`, 1691 uses the exact `INTERSTITIAL_JS`. The brief's exit-code table adds 99 and 2, and says linked-org sites are reachable only by clicking (`nav` → 93). | live `log-view lists calls` |
| 8 | m | **Transcript cross-check.** `transcript-check.mjs` compares a driver's own harness transcript (`…/subagents/agent-*.jsonl`, written by Claude Code, not by the driver) with its raw logs. Flags: T1 direct `cli-bin.js` call, raw-path access, hashing, or HTTP client; T2 a forbidden tool, or Write/Edit on raw logs; T3 a log record with no matching `logged … seq N exit E` in the transcript; T4 more CLI records than `drive.mjs` calls. **The verifier runs it in phase 2** (it reads only the script output, never the transcript, so blinding holds); the orchestrator also runs it in 4.3. This closes residual (b) and makes residual (a) visible. **Replay limitation stated:** on time-varying tasks (P02, P04, P10, P26), a replay can confirm only the kind of data, not the value. | `tests/selftest/transcript.mjs`: honest OK; T3, T1, T2 each flagged |

---

## Changes from review-2

Each row names the finding, its severity (M = MAJOR, m = MINOR), what changed, and the evidence.

| # | Sev | Resolution | Evidence |
|---|---|---|---|
| 1a | M | **Echo laundering.** Raw `eval` output is never evidence. Evidence verbs are only the page-reading verbs `text`, `snap`, `axsnap` and the wrapper-authored `read <css>` / `links <css>`, whose CSS argument is embedded with `JSON.stringify`, so no driver code runs. (C2a) | `run.mjs` case `forged-eval-echo` → `C2a … is cli/eval: not a page-reading verb`; live: `checker FAIL on eval-echo live record` |
| 1b | M | **DOM injection.** I chose something stronger than the reviewer's pattern list: **any** raw `eval` taints the attempt until the driver's next `nav` (fresh document). Syntax patterns can be obfuscated; an unconditional rule cannot. Reads in a tainted window are never evidence (C2b). Values that appear in the driver's own `type`/`select`/`press`/`eval` argv are rejected unless they are in the task text (C2f, covering contenteditable injection). | Cases `forged-dom-injection`, `forged-obfuscated-injection` (`['inner'+'HTML']` + `atob`) → C2b; `forged-typed-echo` → C2f |
| 1c | M | **Domain fence.** After every call that has a session, the wrapper logs an `auto-href` record (href, title, fingerprint). `nav`/`newtab` outside the task's allowed domains is refused (exit 93). The checker maps each evidence read to its URL and fails it when the domain is off-site (C2g). The only exceptions are the attempt's own automatic start-URL redirect, and a `linked-org` page reached by a click from an allowed page. Linked-org is flagged and cannot be strict. | Live `93 off-domain newtab`; case `forged-off-site-newtab` → C2g; case `honest-linked-org` → PASS with `flags=linked-org` |
| 1d | M | **Answers tied to evidence.** Free-form `answer` is replaced by `answerFields[{field, value, logSeq, excerpt}]`. Field keys and minimum counts are pre-registered in `task-fields.json`. Excerpts must be 20–300 characters and contain the value; summary fields need ≥40 characters of support (C2d, C2e, C7). | Cases `forged-1-char-excerpt` → C2d; `forged-unsupported-value` → C2e; `forged-unregistered-field` → C2e; `forged-missing-required-field` → C7 |
| 1e | M | **Cross-task sessions.** The wrapper enforces session ownership (`<task>:<attempt>`, exit 96). Each attempt's first `nav` must be the task's startingUrl (exit 93). The checker requires that start for any cited read (C2c). | Live `96 other task cannot use this session`, `93 first nav must be startingUrl`; cases `forged-cross-task-session`, `forged-wrong-start` → C2c |
| 1f | M | **Regression suite.** The reviewer's self-test cases are committed as `tests/selftest/run.mjs`: 18 cases (3 honest PASS, 15 forged FAIL with specific codes), all as expected → `SELFTEST OK`. | Section 3.4 |
| 2a | M | **Blind inputs.** `make-verify-input.mjs` copies only `{id, answerFields, shortList}` plus raw logs and `tasks.json`. It never copies `summary.md` or briefs. It writes `check-evidence.mjs --blind` output with no `classification`, and aborts if any class-revealing field or string remains. | `tests/selftest/blind.mjs`: 7/7 ok |
| 2b | M | **Canaries the checker passes.** All three canaries are genuine page substrings presented as wrong answers, so they pass C1–C7 and only a reading verifier can reject them (section 4.4). | `blind.mjs` "canary passes the mechanical checker" ok |
| 2c | M | **`verifier-brief.md` frozen** with sha256 in `MANIFEST.sha256`. It covers phase 1 (per-field and eval-argv audit of 100% of tasks), phase 2 replay, the output schemas and the less-favourable rule. The replay ids are delivered only after `phase1.json` exists. | — |
| 3 | m | TASK-INVALID added to the less-favourable ordering (between EXT and COMPLETED). Paywall defined: a paywall in front of partly public content is EXTERNAL-BLOCK(paywall); only the user's own account data is TASK-INVALID(auth). | Section 4.1/4.4 |
| 4 | m | Edge-case rules added: linked-org, automatic-only geo redirect, regional-unavailability single attempt, `shortList`, first match on multiple matches, rename only when the site shows the mapping, consent wall (never accept) → EXTERNAL-BLOCK(consent-wall). | Section 4.1, driver brief |
| 5 | m | **Brief executability:** Bash timeout 300000; one call at a time (the wrapper lock, exit 95); absolute record paths; pinned `{TASKS}` block format; `probe` field; `needsCurlControl` handoff (the orchestrator logs `runs/B6/curl-<id>.txt`). Every verb in the brief's table was **dry-run live** through `drive.mjs`. | `tests/selftest/live.mjs`: 35/35 ok |
| 6 | m | C2 compares after NFKC normalisation, quote and dash folding, and whitespace collapse. | Case `honest-punct-folding` → PASS |
| 7 | m | **Residuals stated** (section 3.3). Mitigations added: an O_EXCL per-slot lock; state.json mtime gap detection (an unlogged CLI call shows up as a `gap` record → C1 FAIL, case `forged-unlogged-call`). | — |
| 8 | m | **No independent channel:** same-tool replay counts as confirmation and is reported as "same-tool replay". | Verifier brief |

---

## Changes from review-1

Each row names the finding, its severity (B = BLOCKER, M = MAJOR, m = MINOR) and the resolution.

| # | Sev | Resolution |
|---|---|---|
| 1 | B | **Raw-log provenance.** Every CLI call goes through `drive.mjs`. It appends a hash-chained JSONL record (ISO time, argv, exit code, full stdout/stderr, duration) to `runs/<slot>/raw/<task>.jsonl`. Drivers may not write there. `check-evidence.mjs` mechanically requires every evidence excerpt to be a verbatim substring of the stdout of the logged call it cites, derives the call counts from the log, and detects tampering through the chain.<br>Negative tests: a fabricated excerpt fails with `C2 … not found verbatim`, and an edited log fails with `C1 hash mismatch`. Both outputs are in section 3.4.<br>WebSearch, WebFetch, curl, other browser tools and memory are forbidden in the frozen `driver-brief.md`. |
| 2 | M | **Surface fingerprint measured** (section 0c), not asserted. On this machine the CLI and the MCP server are identical on `navigator.webdriver` (false), user agent (HeadlessChrome/154) and languages. They differ in viewport: CLI 800×600, MCP 1264×705 inner.<br>The "bias only downward" claim is deleted. The difference is a two-way caveat.<br>Product code and launch flags are not touched. Every `nav` auto-logs the fingerprint. Blocks or layout-dependent failures that the viewport plausibly affected are flagged `viewport-suspect`. |
| 3 | M | **Decision tree** with first-match-wins tie-breaks (section 4.1): account-specific data → TASK-INVALID(auth); public data behind a login wall → EXTERNAL-BLOCK(login-wall); substitutions allowed only under the pre-registered rules; a mandatory `toolDefects[]` field, with "COMPLETED with defect" counted separately. Headline metrics are defined in section 4.2. |
| 4 | M | **One retry rule** (section 4.1): exactly one a2, only after a transient error or a suspected block. A table maps each a1/a2 outcome to a class. `a2-after-block` is reported separately, and the headline is given with and without it. |
| 5 | M | **Canaries** built from reserves R31 and R32, plus one mutated real record and one EXTERNAL-BLOCK turned into a fake COMPLETED. The verifier is told only that "up to 4 extra tasks from the reserve list may be included" (section 4.4). |
| 6 | M | **Verifier:** classifies blind first; the replay id list comes from the orchestrator as ids only; it replays 100% of SUTRADHAR-FAIL and a seeded ≥40% of COMPLETED; it checks answers through an independent channel. Disputes go to **orchestrator adjudication** with evidence. **Never default to the driver;** an unresolved dispute takes the less favourable class (section 4.4). |
| 7 | M | **Inputs frozen** in `inputs/`: the dataset (MIT, with its LICENSE), the tested-domains snapshot and the 13 historical task files, all hash-pinned in `select.py`. The 124-domain exclusion list is hash-pinned and stored in `selection.json._excluded`. `select.py` writes only with `--out`, and refuses to overwrite `selection.json` without `--force`. The verification command is in section 2.1. |
| 8 | M | **`driver-brief.md` frozen;** its sha256 goes into `MANIFEST.sha256` before wave 1. Only `{SLOT}` and `{TASKS}` are substituted. |
| 9 | m | **TEMP path** shortened to `<SCR>/<slot>t`, 164 characters. The measured user-data-dir is 199 ≤ 200 (section 3.2). `drive.mjs` refuses to run if it would exceed 200. |
| 10 | m | No MCP tool is named as a control any more. The control step is CLI `eval`. |
| 11 | m | **Build pin** extended (section 0b): lockfile integrity matches `npm view`; puppeteer-core 25.12.0; Node v25.0.0; Chrome 154 (re-checked at the end of the run). |
| 12 | m | **Sample 7 corrected:** 11 of 12 tasks are not in the dataset (id 329 crunchyroll matches). The clean baseline is recomputed with n=117. Comparison uses a Newcombe CI. The report states that no difference can be attributed to 0.6.1 (section 1). |
| 13 | m | **Scope ratio** reframed as consistent with WebBench's 38% non-READ share (section 2.3). |
| 14 | m | **Executability:** the wrapper creates its own directories, applies a per-call 120 s timeout (child PID only), and runs the PowerShell process check itself (`--check-clean`). Curl uses `/dev/null`, and its outcomes are mapped to classes in advance (section 2.6). `about:blank` mid-task means the session was lost: a2. The wrapper refuses non-`nav` verbs when no session exists. |
| 15 | m | **Re-test preconditions:** 597 requires `<mark>` elements in result titles, else "probe not exercised". For 41, the probe uses "the search input present after the first search". The report states that PROB-043 is not probeable through the CLI (section 2.6). |
| 16 | m | **Public repo:** raw logs and PNGs are gitignored, with only their hashes committed. Committed excerpts are capped at ≤300 characters (`check-evidence` C3). |

---

## 0a. Methodology

**This run is "host AI driving the published sutradhar@0.6.1 CLI".** Sonnet subagents call the npm artifact's `cli-bin.js` only through `drive.mjs`. The CLI runs one process per command, with session state re-attached from a per-slot state directory.

The `mcp__sutradhar__*` tools in this session are a 0.5.0 build from the main checkout: `fdae749`, `MCP_SERVER_VERSION='0.5.0'`, 71 tools, no `browser.wait_for`. They are **not used**. The orchestrator decided not to change the MCP config or restart.

**Shared engine, different launch.** The CLI and the MCP server share `capability-runtime`. In the bundle, `cmdClickText` → `runtime.clickByText` and `cmdType` → `runtime.type`. They do **not** share Chrome launch arguments:
- MCP and SDK go through Puppeteer with `DEFAULT_LAUNCH_ARGS`, which include `--disable-blink-features=AutomationControlled` and `--window-size=1280,800`.
- The CLI's `spawnDetachedChrome` passes only `--headless=new`, `--no-first-run`, `--no-default-browser-check`, the debug port and `--user-data-dir`.

What this changes on this machine is measured in section 0c.

**Comparability with August:**

| Samples | Driver | Surface | Build |
|---|---|---|---|
| 1–7, 11–13 | Sonnet | MCP `browser.*` | Then-current source builds; launch flags and viewport not recorded |
| 8–9 | Sonnet | CLI | Fresh source builds |
| 10 | Opus | CLI | Fresh source build |
| **This run** | Sonnet | **CLI via `drive.mjs`** | **Published 0.6.1 artifact** |

August differed in four ways that are uncontrolled confounds, not effects of 0.6.1: domain mix (hand-picked vs. seeded), Chrome version, surface, and viewport. **No difference from the August baseline can be attributed to 0.6.1.**

## 0b. Build pin (artifact under test)

| Item | Value | Evidence |
|---|---|---|
| CLI file | `<SCR>/v061/inst/node_modules/sutradhar/dist/cli-bin.js` | — |
| sha256 | `9858726a291e844e1f84089b18310e90379140e2dfabf7b2fda80eb550b5c59b` | `sha256sum`; `drive.mjs` re-checks it on **every** call (exit 99 on mismatch) |
| package version | 0.6.1 | `node_modules/sutradhar/package.json` |
| tarball integrity | `sha512-CXcYoKxWGEm79LjeaKuq4Tt4HoC/yG2iLOOS7a7CpGc0JzH+2YNIEOiLEoBP7ZIDAFAehWxAj8CnX0yURXX36Q==` | `package-lock.json` line 222 **equals** `npm view sutradhar@0.6.1 dist.integrity` (read-only), run 2026-10-04 |
| puppeteer-core | 25.12.0 (from `^25.5.0`) | `package-lock.json` |
| Node | v25.0.0 | `node -v` |
| Chrome | 154 (`HeadlessChrome/154.0.0.0`; brands "Chromium 154; Google Chrome 154") | Measured in section 0c. The orchestrator re-checks it after wave 2 from the `auto-href` log records (logged after every call). A change mid-run is reported. |

## 0c. Surface fingerprint, measured on this machine (`measure-surface.mjs`, 2026-10-04)

Command: `node <LOOP>/measure-surface.mjs <SCR>/v061/inst <SCR>/m`. It used an isolated TEMP and state directory and navigated only to example.com. Both surfaces were shut down, leaving `leftover state.json: false | TEMP entries: 0`. The MCP side is the **published 0.6.1** `mcp-cli.js` (`serverInfo {"name":"sutradhar","version":"0.6.1"}`), not the 0.5.0 build connected to this session.

| Property | CLI (`nav` then `eval`) | MCP (`browser.launch` then `browser.eval`) |
|---|---|---|
| `navigator.webdriver` | false | false |
| userAgent | `…HeadlessChrome/154.0.0.0 Safari/537.36` | identical |
| UA brands | Chromium 154; Google Chrome 154; Not A(Brand 99 | identical |
| languages / plugins / hardwareConcurrency | en-GB,en-US,en / 5 / 32 | identical |
| **inner viewport** | **800×600** | **1264×705** |
| outer window | 780×580 | 1280×800 |
| screen | 800×600 | 800×600 |

**Caveat, which may push either way.**
- The CLI renders at 800×600. Sites may serve tablet or mobile breakpoints: filters collapsed into drawers, different navigation, sometimes fewer bot checks, sometimes more.
- No product change is made during the benchmark. No `--viewport` flag is passed, because it would change the artifact under test.
- Drivers and the verifier tag a failure or block `viewport-suspect` when the logged page shows a collapsed or mobile layout element the task needed, or a block page whose trigger is unknown. The report lists all such tags.
- The headline is **not** adjusted.

---

## 1. Baseline, re-derived from the 13 existing reports

Sources: `tools/webbench/claude-direct-run-*.md` (13 files), the historical `tasks*.json` (frozen copies in `inputs/historical-tasks/`), and the pinned CSV. Each historical task was fuzzy-matched to the CSV, because the CSV contains U+FFFD mojibake in place of smart quotes.

Column key:
- C = completed, as reported.
- C-int = completions the report itself flags as an interpretation, substitution, partial answer, or "reasonable". These are included in C.
- EXT = anti-bot, CAPTCHA, Cloudflare, edge deny, 403 API, outage, or HTTP2 reset.
- AUTH = needs the user's own account.
- DRIFT = target gone.
- S-defect = a Sutradhar defect that surfaced during the run.

| # | File date (actual run) | Driver / surface | Att. | C | C-int | EXT | AUTH | DRIFT | S-defect surfaced | Dataset issues |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 08-13 | Sonnet / MCP | 7 | 0 | 0 | 3 | 3 (agoda) | 1 (T0) | – | – |
| 2 | 08-13 | Sonnet / MCP | 8 | 5 | 0 | 3 | 0 | 0 | – | – |
| 3 | 08-13 | Sonnet / MCP | 14 | 10 | 1 | 4 | 0 | 0 | `type` appended instead of replacing (T36); fixed mid-run, then counted C | – |
| 4 | 08-14 | Sonnet / MCP | 7 | 6 | 0 | 1 | 0 | 0 | – | – |
| 5 | 08-14 | Sonnet / MCP | 11 | 8 | 0 | 2 | 0 | 1 (asus) | `type` append seen live (stale MCP), task not lost | **6 of 11 ids wrong** (e.g. "401" is CSV 192); **T612 cbs.com not in the dataset** |
| 6 | 08-15 | Sonnet / MCP | 12 | 7 | 3 | 4 | 0 | 1 | – | – |
| 7 | 08-16 | Sonnet / MCP | 12 | 6 | 1 (ebay partial) | 6 | 0 | 0 | – | **11 of 12 tasks are not WebBench rows** (only T329 crunchyroll matches; it was EXT). 5 domains (digg, economist, edx, fandango, fastcompany) have no CSV rows; ids collide with samples 8 and 11 |
| 8 | 08-17 | Sonnet / CLI | 7 | 5 | 1 | 2 (1 outage) | 0 | 0 | – | – |
| 9 | 08-17 | Sonnet / CLI | 7 | 5 | 1 | 1 | 0 | 1 | – | – |
| 10 | 08-17 | **Opus** / CLI | 10 | 6 | 2 | 3 | 0 | 1 | PROB-041: CLI shared state let another job hijack the session; affected tasks re-run | – |
| 11 | file "08-13", run 08-17 | Sonnet / MCP | 8 | 4 | 0 | 4 (1 outage, 1 HTTP2) | 0 | 0 | – | – |
| 12 | file "08-13", run 08-18 | Sonnet / MCP (0.4.0) | 15 | 12 | 4 | 2 | 0 | 1 | Session lost mid-run, unexplained | T41 aliexpress repeats sample 3 T41 |
| 13 | file "08-13", run 08-18 | Sonnet / MCP | 12 | 5 | 0 | 6 (1 HTTP2) | 0 | 1 | PROB-044: `click_by_text` failed on `<mark>`-split text (T597); fixed mid-run, then counted C | – |
| **Total** | | | **130** | **79** | **13** | **41** | **3** | **7** | **2 task-level** (S3 T36, S13 T597) + 2 infra incidents | 12 not in dataset, 1 duplicate, 6 mis-ids |

The reported "blocked" figure of 51 breaks down as 41 EXT + 3 AUTH + 7 DRIFT.

**Clean baseline.** Remove the 11 non-dataset sample-7 tasks (6 C, 5 EXT, including the 1 C-int), sample-5 cbs.com (C), and the sample-12 duplicate (C). That leaves **117 unique dataset tasks**: C 71, C-int 12, EXT 36, AUTH 3, DRIFT 7.

Mapped onto this protocol's metrics (AUTH and DRIFT → TASK-INVALID, so in-scope n = 107):

| Metric | Strict (C − C-int = 59) | Lenient (C = 71) |
|---|---|---|
| H1: completed / attempted in-scope | 59/107 = **55.1% [45.7, 64.2]** | 71/107 = 66.4% [57.0, 74.6] |
| H2: completed / (in-scope − EXT) | 59/71 = 83.1% [72.7, 90.1] | 71/71 = 100% [94.9, 100] |

Brackets are 95% Wilson intervals. August recorded no AGENT-FAIL and no SUTRADHAR-FAIL, which is why lenient H2 is 100%.

Under a frozen-build rule, two of those tasks (S3 T36 and S13 T597) would have been SUTRADHAR-FAIL.

**Inconsistencies, proposed for correction only** (this protocol does not edit these files):
1. `CLAUDE.md`'s "15/29 … 0 Sutradhar-attributable" is the state after sample 3, and the 14 "anti-bot/auth" blocks in it include 3 login tasks and 1 drift task. `.ai/competitive-benchmarks.md` says 79/130.
2. The "0 Sutradhar-attributable failures" figure comes from a counting convention (fix the bug mid-run, then count C).
3. Sample 7: 11 of 12 tasks are not WebBench rows. Sample 5 has 6 wrong ids and 1 invented task. The 47-task head-to-head against Playwright, Puppeteer and pinchtab (samples 1–5) contains that 1 invented task.
4. The skill hard-codes `2026-08-13` into report filenames, so sample 11–13 file dates are wrong.
5. Samples 8–10 used the CLI, and sample 10 used Opus. The baseline tasks were hand-picked, not seeded.

---

## 2. Task selection (pre-registered, frozen)

### 2.1 Inputs and reproduction
`inputs/` holds every input file. `select.py` pins each one by sha256 and refuses to run on any mismatch or on any unpinned extra file.

| File | sha256 |
|---|---|
| `webbenchfinal.csv` (Halluminate/WebBench `ea7a1628443321363989f354401f0653e0cba6f4`, MIT; `WEBBENCH-LICENSE` included) | `fd5311a38bdb6f941e8f544150735656c114d76fbfb17193da973d5de0165217` |
| `tested-domains.snapshot.txt` (from `tools/webbench/tested-domains.txt` at `1cde002`) | `434ff9d14c424dbf0a1ab0217b45944dc7e5bf44ab29a3acff10d326417dbe20` |
| `historical-tasks/*.json` (13 files) | each pinned in `select.py` |
| derived exclusion list (124 domains, `selection.json._excluded`) | `3da40a4bae1071e7ed85026f3f109239b86881d5281a69b666ea70ecf5203f98` |

The CSV has 2,647 rows, ids 0–2724. By category: READ 1637, CREATE 594, UPDATE 206, DELETE 166, FILE_MANIPULATION 44.

**Verification (read-only).** This was done on 2026-10-04 and printed `IDENTICAL`:
```bash
python <LOOP>/select.py --out <SCR>/sel-check.json && cmp <SCR>/sel-check.json <LOOP>/selection.json && echo IDENTICAL
```
Negative control: a copy with one pinned character altered exited with `exclusion list hash mismatch: 3da40a… != 00000a…`.

### 2.2 Rule
1. **Exclude:** every registrable domain in the tested-domains snapshot and in any historical `tasks*.json`, with the alias `aliexpress.us` → `aliexpress.com`. That leaves 124 excluded and 328 eligible domains.
   - Every domain previously seen hard-blocking is already in this set.
   - Untested sister sites are not excluded, to avoid biasing toward easy sites.
2. **Order:** sort all rows by `sha256("sutradhar-webbench-2026-10-04:" + ID)` ascending. The first row seen for each eligible domain is that domain's single draw.
3. **Out-of-scope screen:** a draw is out of scope if its category is not READ, or its first line matches the state-change/account keyword regex, or a manual adjudication marks it out (section 2.4). An out-of-scope draw consumes its domain and is recorded, never attempted, never replaced.
4. **Primary and reserve:** the first 30 in-scope draws are the primary sample. The next 6 are reserves.
   - Reserves R31 and R32 are used as verifier canaries (section 4.4).
   - R33–R36 replace a primary only if a protocol reviewer finds, **before any driver starts**, that the primary violates this rule.
   - A primary that fails during the run is never replaced.

There is no difficulty filter. TikTok, Yelp, Shein, Kayak, Nordstrom and Home Depot stay in.

### 2.3 Scope ratio
It took 45 draws to reach 30 in-scope tasks, so 15 were out of scope:
- 14 by WebBench's own category;
- 1 (poshmark) by manual adjudication.

15/45 = 33% is **consistent with WebBench's 38% non-READ share** (1010/2647). It is a dataset base rate, not a finding about read-only drivers.

### 2.4 Manual adjudications (fixed in `select.py`)
These were made after seeing the draw. Their net direction is toward harder tasks.
- **Forced in** (keyword false positives; the tasks are read-only): 1492 science.org (FAQ about "PDF downloads"), 1837 tiktok.com ("comments" is a metric), 1329 pennmedicine.org (read email addresses).
- **Forced out:** 2292 poshmark.com ("your sales dashboard" needs a seller login).
- **Kept out by the category rule:** 2088 wikidata. It reads as read-only, but WebBench files it as CREATE.

### 2.5 Primary sample (30 tasks; full verbatim text in `selection.json.primary`)

| # | Slot | ID | Starting URL | Task (first line; U+FFFD shown as quotes) |
|---|---|---|---|---|
| P01 | B1 | 1172 | https://msu.edu | Search for information on academic support services (like tutoring or counseling) and list the names of the services mentioned. |
| P02 | B1 | 2388 | https://www.bing.com | Search Bing for the latest news on the "Tech Industry" by filtering results from the past 24 hours, then list the titles of the top 5 articles. |
| P03 | B1 | 2253 | https://european-union.europa.eu/index_en | Access the integrated EUR-Lex search tool, search for "data protection", and list the titles of the first three documents returned. |
| P04 | B1 | 1661 | https://stackexchange.com | Visit the Meta site of StackExchange and list the titles of the 3 most recent community discussion topics. |
| P05 | B1 | 751 | https://www.harpersbazaar.com | Search for the article on "Spring Fashion Trends" and extract the names of the five luxury brands mentioned in it. |
| P06 | B1 | 1492 | https://www.science.org | Locate the FAQ related to copyright restrictions on PDF downloads and extract the answer that details which formats are permitted. |
| P07 | B2 | 1946 | https://www.unesco.org/en | Use the website's search function to look for "heritage conservation" documents and present the titles of the first four results. |
| P08 | B2 | 1837 | https://www.tiktok.com/explore | Visit Mr. Beast's profile and record the engagement metrics (likes and comments) on their three most-viewed videos. |
| P09 | B2 | 1379 | https://www.polygon.com | Navigate to the "Guides" section and give me the 5 most popular guides title and url. |
| P10 | B2 | 1266 | https://www.nytimes.com | Search for the most recent article on climate change and provide its headline. |
| P11 | B2 | 2554 | https://www.johnlewis.com | Go to the product detail page for the "John Lewis & Partners Simplicity Electric Kettel" and list its specifications such as capacity and wattage. |
| P12 | B2 | 2215 | https://www.yellowpages.com | Use the search filters to display health clinic listings in Miami, FL and note two business's average user rating. |
| P13 | B3 | 929 | https://www.justdial.com | Search for reputed plumber services in Mumbai and list the names, phone numbers, and addresses of the top 5 verified listings. |
| P14 | B3 | 781 | https://www.homedepot.com | Search for "cordless drill" on Home Depot's website, filter the results by the DEWALT brand, and list the top 5 products based on customer ratings. |
| P15 | B3 | 1236 | https://www.nordstrom.com | Navigate to the "Under $100" section in the Women's Handbags category and record the names, prices, and availability of the first three items. |
| P16 | B3 | 1940 | https://umich.edu | Search for "undergraduate admissions requirements" on the website and summarize three key criteria mentioned. |
| P17 | B3 | 1979 | https://www.usa.gov | Search "Benefits & Services" on USA.gov and list the categories of government services available. |
| P18 | B3 | 2687 | https://www.uptodown.com/mac | Locate the "PUBG Mobile" app page, read its detailed description and technical specifications, and summarize the two most recent update log entries. |
| P19 | B4 | 1925 | https://www.ucla.edu | Visit the sustainability initiatives page on the site and extract three main sustainability goals outlined by UCLA. |
| P20 | B4 | 2561 | https://www.kayak.com | Look up the current hotel price trends in Rome, Italy, for a stay during the first week of October and provide the lowest forecasted rate. |
| P21 | B4 | 2336 | https://tenor.com | Use the search bar to search for GIFs related to "celebration" and list the titles or hashtags of the first 5 results. |
| P22 | B4 | 1789 | https://www.theguardian.com/us | Show me the Film section. Make a list of the top 5 highest rated reviews and provide a two sentence description of the premise of each film. |
| P23 | B4 | 1517 | https://us.shein.com/?ref=www&rep=dir&ret=us | Search for reviews on a "denim jacket" and record the text and star ratings of the first 3 customer reviews. |
| P24 | B4 | 1371 | https://www.playstation.com/en-us | Locate the product details for "Horizon Forbidden West" and extract the release date, developer, and price information. |
| P25 | B5 | 1434 | https://www.redfin.com | Access the property valuation tool and check the estimated home value for a "3560 Nashville Hwy" property; record the valuation along with the estimate's date. |
| P26 | B5 | 696 | https://www.goal.com/en-us | Search for the latest match report on Manchester United and list the headline of the report. |
| P27 | B5 | 1329 | https://www.pennmedicine.org | Access the contact information page and extract the email addresses provided for administrative customer support. |
| P28 | B5 | 2582 | https://www.msdmanuals.com | Use the search bar to locate the "Hypertension" article and list the first three risk factors mentioned. |
| P29 | B5 | 982 | https://www.lawinsider.com | Search for "Non-Disclosure Agreement" contracts and list the contract titles and effective dates for the first five results. |
| P30 | B5 | 2218 | https://www.yelp.com | Return the phone number of "Joe's Pizza" in Manhattan |

Reserves: R31 1414 realsimple.com and R32 1310 osu.edu (canaries); R33 2330 streeteasy.com, R34 981 latimes.com, R35 2501 express.co.uk, R36 1703 stardewvalleywiki.com (pre-run replacements only).

**Pre-registered interpretation rules.** These are the only allowed bases for COMPLETED/interpreted.
- **Same site:** subdomains of the starting URL's registrable domain count as on-site. For example, `eur-lex.europa.eu` for P03 and `meta.stackexchange.com` for P04.
- **Relative dates:** resolved against 2026-10-04. For P20, "first week of October" means 2026-10-01..07. If the site cannot quote that window, use the next 7-night window and disclose it.
- **Geo:** the machine geolocates to India. If the redirected edition answers the task, the result is interpreted. If content is withheld, the result is EXTERNAL-BLOCK(geo).
- **Typos:** P11's "Kettel" is searched as written first, then as "Kettle". Neither counts as a substitution.
- **Anything else** (a different article, product, section or list than the one named) is not a completion (section 4.1).

### 2.6 Re-test set (slot B6; scored separately, never merged into the headline)
For B6, `{TASKS}` contains each task's verbatim text followed by its probe line from this table, verbatim.

| ID | URL | Why re-test | Probe (pre-registered) |
|---|---|---|---|
| 597 | https://www.frontiersin.org | PROB-044: `click_by_text` on `<mark>`-split text | After searching, log `count "mark"` (non-tainting). If the count is 0, record "probe not exercised". Otherwise open the top result with `clicktext "<full title text>"` and record the exit code and Verification line. |
| 41 | https://www.aliexpress.us/?gatewayAdapt=glo2usa&_randl_shipto=US | Type-append bug (Milestone 17) | Search `wallet` first. On the results page, `type` the task query into **the search input present after the first search** and press Enter. Log `href`, and read the input's current value with `snap` (it lists input values). Pass only if neither contains "wallet". No `eval`. |
| 192 | https://www.ca.gov | Type-append observed through the live MCP in S5 | The same clear-then-retype probe on the site search (first query `parking`) |
| 392 | https://www.ea.com | `ERR_HTTP2_PROTOCOL_ERROR` labelled external with no control | If nav fails: the orchestrator (not the driver) runs one read-only `curl -sS -o /dev/null -w "%{http_code} %{http_version}" https://www.ea.com/` |
| 568 | https://www.ford.com | Same HTTP2 signature | Same curl control |
| 1691 | https://stackoverflow.com/questions | Cloudflare cleared only after waiting (S10) | `waitfor 30000 --js "!/Just a moment|Verif/i.test(document.title)"` (the exact pre-registered `INTERSTITIAL_JS`, which does not taint) before calling it a block |

**Curl-control mapping.** Curl's TLS and HTTP2 fingerprint differs from Chrome's, so curl alone never yields SUTRADHAR-FAIL.

| Curl result | Class |
|---|---|
| Fails the same way (reset, 4xx/5xx) | EXTERNAL-BLOCK(outage/edge) |
| 200 while Chrome fails | EXTERNAL-BLOCK(client-fingerprint) |

**Not probeable here:** PROB-043 (the long-lived MCP-session keyboard false positive) cannot be reached through a one-process-per-command CLI. The report must say so.

### 2.7 Out-of-scope draws (recorded, never attempted)
Before the 30th primary: 2088 wikidata (CREATE), 729 grubhub (order), 991 letterboxd (diary/review), 1472 resy (reservation), 2292 poshmark (seller login), 829 ikea (favorites), 2195 x.com (login), 1017 linkedin (comment), 694 glassdoor (login/review), 2368 bbcgoodfood (login/comment), 1734 studocu (login), 808 housebeautiful (account), 1215 newegg (login), 1719 steam (forum post), 712 goodhousekeeping (profile).

After it: 2136 wired, 910 jagranjosh, 1605 spotify.

---

## 3. Execution

### 3.1 The driver prompt is frozen
- Each driver (Sonnet subagent) receives exactly `driver-brief.md` (revision 3), with `{SLOT}` and `{TASKS}` filled using the pinned block format in the brief's header (`### Task <id>` / `startingUrl:` / `requiredFields:` from `task-fields.json` / verbatim task text; for B6 also the probe line from section 2.6).
- The verifier receives exactly `verifier-brief.md` (section 4.4).
- The brief is the single source of driver rules: tools, read-only rules, forbidden sources, prompt-injection rule, CAPTCHA and stealth exclusion, no image-name kills, retry rule, decision tree, record schema, and exit condition.
- Its sha256 is in `MANIFEST.sha256`. The orchestrator also saves each filled brief as `runs/<slot>/brief.md` and hashes it, so the substitution can be audited.

### 3.2 `drive.mjs` (revision 3; the only route to the CLI; rules shared with the checker through `lib.mjs`)
`node <LOOP>/drive.mjs <slot> <taskId> <a1|a2|r1..r9> <verb> [args…]`

| Slot | Use |
|---|---|
| B1–B6 | drivers |
| K | canaries and setup |
| V1/V2 | verifier replays |
| M | self-tests only |

`taskId` must be a `selection.json` id, or one of the pseudo tasks `setup`, `selftest1`, `selftest2`.

**Isolation per slot:**
- `SUTRADHAR_CLI_STATE_DIR=<SCR>/w/<slot>/s`
- `TEMP=TMP=<SCR>/<slot>t`: 164 characters. The measured user-data-dir is 199 ≤ 200, and the wrapper refuses above 200.
- cwd `<SCR>/w/<slot>/c`
- `SUTRADHAR_CONFIG=none`
- `SUTRADHAR_CLI_DEADLINE_MS=110000`

**Guards, with their exit codes:**

| Exit | Guard |
|---|---|
| 99 | CLI sha256 mismatch |
| 95 | Another call in this slot holds the O_EXCL lock |
| 98 | Forbidden verb (`download`, `upload`, `profile`, `grant`, `setclipboard`, `getclipboard`, `compare`) or flag (`--user-agent`, `--profile`, `--headed`, `--viewport`, `--baseline`) |
| 97 | Any verb except `nav`/`doctor` while no session exists (prevents the blank-browser auto-launch) |
| 96 | Session owned by a different `<task>:<attempt>` |
| 93 | The attempt's first `nav` is not the task's `startingUrl`, or `nav`/`newtab` goes outside the task's allowed domains. Allowed domains: the registrable domain of the startingUrl and of the task's "Only use" line, plus the domain the startingUrl automatically redirected to in this attempt. |

**Per call it logs**, hash-chained in `runs/<slot>/raw/<taskId>.jsonl`:
- one `cli` record: `verb` as typed, the actual `argv`, exit, `timedOut`, `durationMs` (from `performance.now()`), stdout, stderr, `tainted`, state.json mtime before and after, `prevHash`, `hash`;
- while a session exists, one `auto-href` record `{href, title, webdriver, ua, inner}` tied to that call (`forSeq`). Every call is thereby bound to the URL it ran on, and the fingerprint is captured continuously;
- a `gap` record when state.json changed between two logged calls, meaning an unlogged CLI call happened;
- `refused` and `check-clean` records.

**Pseudo-verbs.** The JavaScript is authored by the wrapper; the driver supplies only data, and that data is embedded with `JSON.stringify`:

| Verb | Evidence-eligible? |
|---|---|
| `href` | no |
| `back` | no |
| `status` | no |
| `count <css>` | no |
| `read <css>` | yes |
| `links <css>` | yes |
| `attrs <css> <name[,name…]>` (innerText + named attributes via `getAttribute`) | yes |

**Driver JavaScript taints.** Raw `eval`, and `waitfor --js` with any expression other than the pre-registered `INTERSTITIAL_JS`, taint the attempt until the next driver `nav`. `back`/`focustab` after driver JS keeps the taint (bfcache).

**Allow-list.** Only the verbs in the driver brief's table run; anything else (`hover`, `drag`, `clickpoint`, `closetab`, `audit`, …) is refused with exit 98. The wrapper prints a warning when a call leaves the task's site.

**Screenshots** are forced to `<SCR>/w/<slot>/shots/`.

**`--check-clean`** is read-only. It checks that there is no state.json, no `sutradhar-cli-*` directory in the slot TEMP, and no process whose command line contains the slot TEMP (its own PowerShell excluded).

### 3.3 Sources of truth and residual risk

**What the mechanical checks prove** (section 4.3, self-tested in 3.4): each cited value appears, after normalisation, in the output of a page-reading verb that:
- ran on a page whose logged URL is on the task's site (or a flagged linked-org page reached by a click, or the start URL's own redirect);
- ran in an attempt that started at the task's startingUrl;
- had no driver JavaScript (`eval`, or `waitfor --js` other than the interstitial check) since the last `nav`, and no `back`/`focustab` after the last `nav` in an attempt that ran driver JavaScript;
- did not echo, case-insensitively, the driver's own typed, evaluated or URL-requested text, unless the value had already appeared in an earlier page read;
- is covered by the pre-registered field list;
- sits in an intact, gap-free log.

**What they do not prove:**
- That the value answers the field. A genuine page string can be the wrong item; that is the verifier's job, and the canaries test it.
- That the log was not rebuilt.

**Residual risks, stated plainly:**
- **(a) The chain has no secret.** The algorithm is public (`lib.mjs`), so a driver that deliberately broke the brief could write a whole valid chain in a short script. The wrapper cannot hold a secret the driver's own shell can't read.
- **(b) Unlogged CLI calls.** A direct `node cli-bin.js` call with the slot env changes nothing the wrapper sees unless it changes state.json. It **is** visible in the driver's harness transcript, and `transcript-check.mjs` flags it (T1).
- **(c) `raw.sha256` timing.** The orchestrator snapshots `raw.sha256` per slot at each subagent progress notification and again when the batch returns. This constrains only what happens after each snapshot.

**Mitigations:**
- Forging needs deliberate rule-breaking, not a slip.
- **(d) Replays.** The verifier replays ≥40% of completions, plus all failures, live. On time-varying tasks (P02, P04, P10, P26) a replay confirms only the kind of data, not the value.
- **(e) Transcript cross-check.** `transcript-check.mjs` compares the harness-written transcript with the raw logs (T1–T4). A rebuilt chain would show T3 (records the transcript never produced) unless the driver also simulated matching tool output, which the transcript records verbatim.
- The verifier reads every raw `eval`/`type` argv in every log (`verifier-brief.md`).

**Race inside a slot:** prevented by the O_EXCL lock (exit 95), and live-tested.

### 3.4 Self-tests (all run 2026-10-04; regression suite committed under `tests/selftest/`)

**Offline checker suite:**
- Command: `node tests/selftest/run.mjs <SCR>/st-offline`.
- Result: **39/39 as expected** (`SELFTEST OK`): 12 honest cases PASS, 27 forged cases FAIL with their expected codes. All outputs were re-run after the revision-5 changes.

| Case | Expected | Got |
|---|---|---|
| honest | PASS | PASS |
| honest-linked-org | PASS + flag | PASS `flags=linked-org:example.net@5` |
| honest-punct-folding (page `’ —`, excerpt `' -`) | PASS | PASS |
| honest-attrs | PASS | PASS |
| honest-interstitial-waitfor | PASS | PASS |
| honest-seen-before-typed | PASS | PASS |
| honest-newtab-linked-org | PASS + flag | PASS `flags=linked-org:example.net@7` |
| honest-failed-autohref | PASS | PASS |
| honest-soft-hyphen | PASS | PASS |
| honest-geo-redirect-flagged | PASS + flag | PASS `flags=geo-redirect:example.co.in@3` |
| forged-eval-echo | C2a | `C2a … is cli/eval: not a page-reading verb` |
| forged-dom-injection | C2b | `C2b … read after driver JavaScript without a fresh nav (tainted)` |
| forged-obfuscated-injection (`['inner'+'HTML']=atob(…)`) | C2b | C2b |
| forged-attrs-after-setattribute | C2b | C2b (+C2f) |
| forged-waitfor-js-injection | C2b | C2b (+C2f on the `waitfor` argv) |
| forged-back-bfcache | C2b | `C2b … after back/focustab in an attempt that ran driver JavaScript` |
| forged-off-site-newtab | C2g | `C2g … read on example.net, outside allowed` |
| forged-1-char-excerpt | C2d | `C2d … excerpt 1 chars < 20` |
| forged-unsupported-value | C2e | `C2e … value not contained in its excerpt` |
| forged-missing-required-field | C7 | `C7 field page_sentence: 0 of 1 required values` |
| forged-duplicate-values | C7 | `C7 field page_sentence: 1 of 2 required values` |
| forged-unregistered-field | C2e | `C2e … field key not pre-registered` |
| forged-typed-echo | C2f | `C2f … driver's own type argv` |
| forged-nav-url-echo | C2f | `C2f … driver's own nav argv` |
| forged-echo-case | C2f | `C2f … driver's own type argv` |
| forged-cross-task-session | C2c | `C2c … did not start with nav to https://example.com/` |
| forged-wrong-start | C2c | C2c |
| forged-tampered-log | C1 | `C1 hash mismatch at seq 3` |
| forged-unlogged-call | C1 | `C1 unlogged state change before seq 3` |
| forged-no-close | C5 | `C5 a1: last CLI call is not a successful close` |
| forged-excerpt-too-long | C3 | `C3 … 343 chars > 300` |
| honest-attrs-value (names stripped, value kept) | PASS | PASS |
| forged-attrs-name-echo | C2e | `C2e … only as driver-supplied attribute-name text` (+C2f) |
| forged-attrs-selector-value | C2f | `C2f … value matches a driver-supplied attrs argument` |
| forged-seen-earlier-tainted | C2f | `C2f … driver's own type argv (seq 9)`: the tainted read no longer exempts |
| honest-evidence-rule (attribute-only value, all reads exit 0) | PASS | PASS |
| forged-evidence-rule-read-error | C8b | `C8b read verb text seq 3 exited 1 …` |
| forged-evidence-rule-visible-text | C8c | `C8c value is visible text … text seq 3 on the same page omits it` |
| forged-evidence-rule-no-uncited | C8a | `C8a evidence-rule needs uncitedValue …` |

**Blind-input test:**
- Command: `node tests/selftest/blind.mjs <SCR>/st-blind`.
- Result: **8/8 ok**:
  - stripped record has no class fields;
  - `summary.md` not copied;
  - blind `check-evidence.json` has no `classification`;
  - the mutation is applied to the copy only;
  - the original is untouched;
  - **the canary PASSes the mechanical checker**;
  - blind mode applies C7 with distinct values.

**Transcript cross-check test:**
- Command: `node tests/selftest/transcript.mjs <SCR>/st-transcript`.
- Result: **4/4 ok**: honest → `TRANSCRIPT CHECK OK`; extra log record → T3; direct `cli-bin.js` → T1; WebFetch → T2.

**Live wrapper test:**
- Command: `node tests/selftest/live.mjs <SCR>/st-live`, using the real published CLI, slot M, example.com/iana.org.
- Result: **43/43 ok**, ending with `--check-clean` → `"clean":true`. Revision 5 adds `98 attrs with a prose attribute name`, and the log carries `dargs` (`['a','href,class']`).
- Guards: 97 before session, 98 forbidden verb and flag, 93 wrong first nav, 93 off-domain `newtab`, 96 foreign task, 95 lock held, 98 `hover` (allow-list), 98 `audit`, 97 after close.
- **Every verb in the brief's table**, dry-run: `href`, `text`, `snap`, `axsnap`, `read`, `links`, `attrs`, `count`, `status`, `waitfor --text`, `waitfor --js` (interstitial: not JS; driver expression: JS), `wait`, `scroll`, `type`, `select` (argument form → exit 1), `press`, `screenshot` (path forced to `\w\M\shots\`), `click --expect-url-changed --settle`, `back`, `waitfor --url`, `clicktext --expect-url-changed`, `tabs`, raw `eval`, `close`.
- Checker: PASS on the honest live record, FAIL (C2a) on the live eval-echo record.
- `log-view.mjs` lists the live log.
- Fingerprint: `{"href":"https://example.com/",…,"webdriver":false,…HeadlessChrome/154…,"inner":[800,600]}`.

Before each wave the orchestrator re-runs `run.mjs`, `blind.mjs` and `transcript.mjs`, which are offline and cheap. It runs `live.mjs` once before wave 1. Any failure stops the run.

### 3.5 Budgets and retry
- **Calls:** ≤40 CLI calls per task (soft), 60 (hard), counted from the log.
- **Time:** about 15 minutes per task. The orchestrator gives each batch a hard 2-hour timeout.
- **Retry:** see the table in section 4.1.

---

## 4. Scoring

### 4.1 Decision tree (first match wins; the same text is in the driver brief)
1. **Needs the user's own account data, or an irreversible action** → **TASK-INVALID**(auth | irreversible).
2. **Every required field (`task-fields.json`) has logged page-reading evidence** on the task's site, with no substitution beyond the rules below → **COMPLETED**.
   - Subflags: `strict`, `interpreted`, `a2-after-block`, `linked-org` (`linked-org` implies interpreted).
   - Any Sutradhar misbehaviour worked around goes in `toolDefects[]` and counts toward "completed with defect".
3. **The site stopped an anonymous read-only session on both attempts** → **EXTERNAL-BLOCK**(captcha | challenge | edge-deny | login-wall | paywall | consent-wall | geo | outage | protocol). One attempt is enough for a deny page with a reference id, or a page that states regional unavailability.
   - **Paywall rule:** a paywall or login wall in front of content the site shows publicly in part is EXTERNAL-BLOCK(paywall | login-wall). Only data belonging to the user's own account is TASK-INVALID(auth).
   - **Consent rule:** drivers never accept consent terms. Content left unreadable behind an accept-only wall is EXTERNAL-BLOCK(consent-wall).
   - Add `viewport-suspect` where section 0c applies.
4. **The named target is proven gone** by two independent in-site checks → **TASK-INVALID**(drift).
5. **A CLI verb misbehaved on a workable page, and that is why the task was not completed** → **SUTRADHAR-FAIL**. This is evaluated **before** rule 6, and it covers the read verbs (`text`, `snap`, `axsnap`, `read`, `links`, `attrs`):
   - an error on a valid target, a hang/timeout, a crash, or a false success / `contradicted`; or
   - read output provably missing or wrong: visible text shown by a read-only `eval` of `innerText`/`textContent`, or by a screenshot, that `text`/`snap`/`axsnap` omitted or garbled on the same page.

   The control (another verb, a2, a read-only `eval`, or a screenshot) and its seq numbers go in `toolDefects`.
6. **Every Sutradhar verb behaved correctly, and the value is not reachable by the allowed evidence verbs** (canvas, image, or a property none of the six read verbs exposes, seen via a non-text `eval` or a screenshot) → **AGENT-FAIL(evidence-rule)**. It is reported as its own count, because it is a limit of this protocol, not of the product.
   - The record must carry `uncitedValue {value, logSeq}`.
   - The checker's C8 rejects the claim (C8b) if any read verb in that attempt failed, and (C8c) if the value is visible text, shown by an `innerText`/`textContent` eval, that a `text` read on the same page omitted. Either way the task goes to rule 5.
7. **Otherwise** → **AGENT-FAIL**(budget | reasoning | substitution | partial | unsupported).
   - A partial answer is never COMPLETED.
   - A field missing because a verb failed makes the task SUTRADHAR-FAIL.

**Interpretation and edge-case rules.** These are the only grounds for `interpreted`, unless a rule below says the result stays `strict`.

| Situation | Rule |
|---|---|
| Relative dates | Resolved against 2026-10-04. For a past window, use the next equivalent window, disclosed (interpreted). |
| Geo | Only an **automatic** redirect of the startingUrl counts (interpreted; the checker flags `geo-redirect`). Driver-chosen editions are not allowed; the wrapper refuses other domains. |
| Typos | Searched as written, then corrected. Neither is a substitution. |
| Several items match the named target | The first site-search result matching every named entity, disclosed. This stays `strict`. |
| Linked same-organisation site | Only when reached by clicking a link on an allowed page, or by `focustab` onto the tab such a click opened (checker flag `linked-org`). Interpreted. The verifier accepts it only if shared ownership is evident from the logged page; otherwise AGENT-FAIL(substitution). |
| Fewer items than requested | COMPLETED if `shortList` cites logged output showing the list ends. The checker flags it, and the verifier must confirm it. |
| Renamed section | Interpreted only if the site itself shows the mapping (a redirect or a label). Otherwise AGENT-FAIL(substitution). |
| Any other substitution | AGENT-FAIL(substitution) |

**Single retry rule.** There is exactly one a2, in a fresh session, and only when a1 ended in a transient error (`net::`, exit 124, session lost/`about:blank`) or a suspected block. There is no other retry.

| a1 | a2 | Class |
|---|---|---|
| completed | — (none) | COMPLETED |
| transient error | completed | COMPLETED (note a1) |
| transient error | transient error | SUTRADHAR-FAIL if the error is client-side (control shows the site reachable), else EXTERNAL-BLOCK(outage) |
| transient error | blocked | EXTERNAL-BLOCK |
| suspected block | blocked | EXTERNAL-BLOCK |
| suspected block | completed | COMPLETED + `a2-after-block` |
| suspected block | transient error | EXTERNAL-BLOCK(unconfirmed) |
| deny page with reference id | — (a2 optional) | EXTERNAL-BLOCK |

The `EXTERNAL-BLOCK(unconfirmed)` result is reported in the EXT count with its subflag shown.

### 4.2 Metrics (headline first)
In-scope = 30 − TASK-INVALID.

| Metric | Definition |
|---|---|
| **H1 (headline)** | COMPLETED/strict ÷ attempted in-scope, with a 95% Wilson CI |
| H1-lenient | (strict + interpreted) ÷ attempted in-scope |
| **H2** | COMPLETED/strict ÷ (attempted in-scope − EXTERNAL-BLOCK): the completion rate on tasks the open web let through. Wilson CI. |
| H1′ and H2′ | H1 and H2 with `a2-after-block` completions moved out of COMPLETED, to remove the retry advantage August did not have |

Also report:
- counts per class and subflag;
- "COMPLETED with ≥1 Sutradhar defect";
- SUTRADHAR-FAIL;
- `viewport-suspect` tags;
- `cli-surface-gap` tags (a failure caused by a verb the MCP surface has and the CLI lacks);
- **AGENT-FAIL(evidence-rule)**: values present on the page that no evidence verb could cite (a protocol limit, reported separately).

**Comparison with the clean baseline** (H1: 59/107; H2: 59/71): report the difference with a **Newcombe (method 10) 95% CI**. Keep the section 0a caveat: no attribution to 0.6.1.

At n=30 the H1 CI is about ±17 percentage points.

### 4.3 Mechanical checks (orchestrator, before verification)
1. Run `node <LOOP>/check-evidence.mjs <LOOP>/runs --json > <LOOP>/runs/check-evidence.json`. The codes are defined in the file header and self-tested in section 3.4:

| Code | Check |
|---|---|
| C1 | chain intact, no `gap` records |
| C2a | page-reading verb only |
| C2b | not tainted by a raw `eval` |
| C2c | attempt began at the startingUrl |
| C2d | excerpt verbatim after normalisation, ≥20 characters |
| C2e | value inside the excerpt (summary fields: ≥40 characters of support); field key pre-registered |
| C2f | no echo of the driver's own `type`/`select`/`press`/`eval` text |
| C2g | domain fence |
| C3 | excerpt ≤300 characters |
| C4 | call counts derived from the log |
| C5 | close plus a passing check-clean |
| C6 | refusals, timeouts and gaps reported |
| C7 | required fields present `min` times (distinct values) |
| C8 | an AGENT-FAIL(evidence-rule) claim is valid: `uncitedValue` present (C8a), no failed read verb in the attempt (C8b), not visible text omitted by `text` (C8c) |

2. **COMPLETED tasks that fail checks.** A COMPLETED task failing C2 or C7 becomes **AGENT-FAIL(unsupported)**, unless the adjudicator finds a passing citation in the same log. A COMPLETED task failing only C3 has its excerpt trimmed by the orchestrator and is re-checked; this is not a scoring change.
3. **C1 failure** makes the task **void (log integrity)**, reported as such and never re-run to raise the score. C5 failures are reported and do not change the class.
4. **Flags** (`linked-org`, `geo-redirect`, `short-list`, raw evals present) send the task to mandatory verifier attention.
5. **Transcript cross-check.** For each driver slot, the orchestrator runs `node <LOOP>/transcript-check.mjs <agent-*.jsonl> <LOOP>/runs <slot> --json > <LOOP>/runs/<slot>/transcript-check.json`. A T1–T4 flag sends the task to adjudication, and the adjudicator may rule it `void`. Excluding that file from the blind tree is automatic, because `make-verify-input` copies only records and raw logs. `linked-org` caps the subflag at `interpreted`.

### 4.4 Independent verification (Opus subagent, frozen `verifier-brief.md`) and adjudication

**Blind input.** The orchestrator runs:
```
node <LOOP>/make-verify-input.mjs <LOOP>/runs <SCR>/verify-input --mutations <SCR>/sealed/mutations.json --replay-out <SCR>/sealed/replay.json
```
- The tree it writes contains only `{id, answerFields, shortList}` per task, the raw logs, `tasks.json`, and a `--blind` `check-evidence.json`.
- The script aborts on any class-revealing field.
- `<SCR>/sealed/` is never given to the verifier.

The verifier is launched with exactly `verifier-brief.md`, with `{VERIFY_INPUT}` and `{OUT}` filled in.

**Phase 1** (blind, no browsing): the verifier writes `verify/phase1.json`, covering every task, with a per-field audit and an eval-argv audit.

**Phase 2:** only after `phase1.json` exists, the orchestrator sends the `replayIds` list from `replay.json`, ids only and sorted. The list is:
- every SUTRADHAR-FAIL;
- every AGENT-FAIL;
- ceil(40%) of COMPLETED, ranked by `sha256("sutradhar-webbench-2026-10-04:verify:"+ID)`;
- 3 EXTERNAL-BLOCKs by the same rank.

In the same message the orchestrator gives `{TRANSCRIPTS}` (one `<slot>=<agent-*.jsonl path>` per line). The verifier runs `transcript-check.mjs` on each and reads only its output (section 4.4 of the verifier brief). Replays go through `drive.mjs` V1/V2 (at most 2 concurrent) and are checked through an independent channel where one exists. Otherwise the result is "same-tool replay", which counts as confirmation and is reported separately.

**Residual leakage.** The composition of the replay list, and whether a record has any `answerFields`, hint at classes. Phase 1 is frozen before either becomes visible, apart from an empty-vs-filled `answerFields`, which is inherent to the evidence.

**Canaries.** Each canary passes the mechanical checker, so only a reading verifier can catch it (`tests/selftest/blind.mjs` demonstrates the pattern):
- **K1:** reserve R31 (1414) run honestly in slot K, then its titles replaced in the verifier copy with genuine strings from the same page that are not article titles (nav, footer or promo text).
- **K2:** one real primary COMPLETED record, chosen as the lowest `sha256(seed+":canary:"+ID)`. One extract value is replaced with a different genuine item from the same cited output (wrong rank or wrong item) in the verifier copy.
- **K3:** one real primary EXTERNAL-BLOCK record (same hash rule) turned into a fake COMPLETED in the verifier copy. Its required fields are filled with genuine block-page strings (title, button label, reference text) at the required counts. **If this cannot be made checker-passing**, for example because the block page lacks enough text, the orchestrator substitutes a second K2-style canary and records the substitution.
- **Control:** reserve R32 (1310), run honestly in K and left unmutated, so slot K does not reveal which reserve is mutated.

The verifier is told only "up to 4 extra tasks drawn from the reserve list". **All three canaries must be classified non-COMPLETED in phase 1.** Otherwise the verification is void and is redone with a fresh verifier. The originals in `runs/` are never modified, and scores use them.

**Adjudication.** Every task where the driver's class and the verifier's phase-1 or phase-2 class differ goes to **orchestrator adjudication**. The orchestrator is a third party, not the driver. It works from the logs and evidence only, and records each ruling with its reasoning and seq numbers in `verify/adjudication.md`.
- **No default to the driver.**
- An unresolved dispute takes the **less favourable** class. Ordering, least favourable first: void < AGENT-FAIL < SUTRADHAR-FAIL < EXTERNAL-BLOCK < TASK-INVALID < COMPLETED/interpreted < COMPLETED/strict. TASK-INVALID ranks above EXTERNAL-BLOCK because it removes the task from the H1 denominator.
- Both classes are listed in the report.

---

## 5. Batching, concurrency, cleanup

### 5.1 Batches
| Slot | Tasks |
|---|---|
| B1 | P01–P06 |
| B2 | P07–P12 |
| B3 | P13–P18 |
| B4 | P19–P24 |
| B5 | P25–P30 |
| B6 | re-test set |
| K | canaries R31 and R32 (orchestrator, before verification) |
| V1, V2 | verifier replays |

### 5.2 Concurrency
- **At most 3 driver subagents at once**, each running tasks sequentially, so at most 3 Chrome instances.
  - Wave 1: B1, B2, B3.
  - Wave 2: B4, B5, B6.
  - Then K.
  - Then verification, with at most 2 replay sessions.
- The orchestrator writes a `RUNNING` marker file (wave, ISO start time, slot → subagent id) and removes it at the end.
- Each subagent carries a hard 2-hour timeout and the brief's exit condition. A subagent that times out has its slot checked with `--check-clean`, and its unfinished tasks are reported as **void (driver timeout)**, never silently re-run.

### 5.3 Cleanup and gates
**Gates before wave 1:**

| Gate | Check |
|---|---|
| G0 | CLI sha256 (`drive.mjs` does this on every call) |
| G1 | `drive.mjs K setup a1 doctor` detects Chrome |
| G2 | `df -h`: E: 52G free; C: 52G free (91% used) |
| G3 | No `RUNNING` marker exists |
| G4 | Canary `nav https://example.com` → `close` → `--check-clean` passes in slot K |

**Every attempt** ends with `close` and then `--check-clean` (checker rule C5).

**Never:**
- `taskkill`, `Stop-Process` or `kill` by image name, or at all, by drivers;
- deleting any directory;
- touching real-TEMP `sutradhar-cli-*`, `~/.sutradhar-cli`, another slot's directories, or the main checkout;
- using any `mcp__sutradhar__*` tool.

**Leftovers.** A failed clean check is recorded and reported to the user with the PIDs. Only the user decides on killing anything.

**Handoff, per the global rules:** list every subagent (id, slot, status), each slot's last `--check-clean` result, and the exact next step.

---

## 6. Outputs

### 6.1 `tools/webbench/claude-direct-run-2026-10-04.md`
1. **Header:**
   - "host AI driving the published sutradhar@0.6.1 CLI";
   - the build pin (section 0b), including the end-of-run Chrome check;
   - the surface fingerprint and viewport caveat (section 0c);
   - driver model Sonnet, verifier model Opus;
   - CSV and exclusion hashes;
   - the seed;
   - the sha256 of `protocol.md`, `driver-brief.md`, `verifier-brief.md`, `lib.mjs`, `drive.mjs`, `check-evidence.mjs`, `make-verify-input.mjs` and `task-fields.json`, from `MANIFEST.sha256`.
2. **Results table:** P#, ID, domain, driver class, verifier class, final (adjudicated) class, subflags, and a one-line answer or cause.
3. **Metrics:** H1 (headline), H1-lenient, H2, H1′/H2′, all with Wilson CIs; Newcombe CIs for the differences from the clean baseline; plus the section 4.2 counts.
4. **Re-test table:** August outcome vs. October outcome, with each probe's result. This run cannot probe PROB-043.
5. **Detail sections:**
   - completions, with ≤300-character excerpts and log seq numbers;
   - blocks, with vendor and evidence;
   - each SUTRADHAR-FAIL: verb, exit code, output, control, proposed PROB id;
   - AGENT-FAILs;
   - disputes and rulings;
   - canary outcomes.
6. **Baseline correction section:** a summary of section 1.
7. **False-pass analysis.** For each headline claim, one way it could be wrong and what rules that out:

| Failure mode | What rules it out | What does NOT rule it out (residual) |
|---|---|---|
| Stale or wrong build | sha256 checked on every call; lockfile integrity = `npm view` | — |
| Answer from memory, echoed through `eval` | C2a: `eval` output is never evidence (self-test `forged-eval-echo`) | — |
| Text injected into the page, then read | C2b: driver JS (`eval`, `waitfor --js`) taints until the next `nav`, and `back`/`focustab` after driver JS stays tainted; C2f: typed, evaluated or URL-requested text is never evidence (self-tests, including obfuscated, `waitfor` and bfcache variants) | Page-side scripts the driver did not write are out of scope |
| Off-site or other-task source | C2g domain fence on the logged `auto-href`; wrapper exit 93/96; C2c start check (self-tests) | — |
| Partial evidence plus memory | C2e/C7 per-field coverage from the frozen `task-fields.json` | The value may be a genuine page string that is the *wrong item*: only the verifier can rule that out, and canaries K1–K3 test the verifier |
| Forged log | C1 chain + gap detection + `raw.sha256` snapshots + transcript cross-check (T1–T4) + ≥40% live replay | A rebuilt chain plus matching simulated tool output in the transcript; replay confirms only the kind of data on time-varying tasks (P02, P04, P10, P26) |
| Verifier rubber-stamping | 3 checker-passing canaries must be rejected in phase 1 | — |
| Verifier biased by driver classes | `make-verify-input` strips them, checked by `blind.mjs` | Replay-list composition and empty-vs-filled `answerFields` (stated in section 4.4) |
| Mislabelled block | a2 confirmation + curl mapping | — |
| Sutradhar failures hidden as agent failures | Rule 5 is evaluated before evidence-rule; C8b/C8c mechanically; 100% AGENT-FAIL replay | A read defect on shadow-DOM/iframe content that neither a `textContent` eval nor a screenshot exposes |
| Retry inflation | H1′/H2′ | — |
| Viewport confound | measured, and tagged per task | Direction unknown |
| Selection drift | frozen inputs + `cmp` | — |

### 6.2 Other files
- `tools/webbench/tasks-sample14.json`: the 30 primary tasks verbatim, plus `_seed`, `_protocol`, and a separate `retest` key.
- `tools/webbench/tested-domains.txt`: append the 30 primary domains. This does not affect re-running the selection, because the inputs are frozen.

### 6.3 Docs
- **`.ai/competitive-benchmarks.md`:** a new iteration entry and a corrected headline (the clean baseline and this run as separate figures).
- **`.ai/browsing-capability-loop.md`:** an entry for each SUTRADHAR-FAIL or defect, the re-test outcomes, and the smoke-test finding (a verb with no session auto-launches a blank browser and exits 0).
- **`.ai/known-problems.md`:** a new PROB id for each new defect.
- **`CLAUDE.md`'s "15/29" paragraph:** propose replacement text only. It is edited only with the user's approval.

### 6.4 Repo hygiene and commits
- `<LOOP>/.gitignore` excludes `runs/*/raw/` and `*.png`. Their sha256 lists (`runs/<slot>/raw.sha256`) are committed.
- Committed excerpts are capped at ≤300 characters.

One logical step per commit:
1. protocol revision + frozen inputs + tools + `MANIFEST.sha256`;
2. run records;
3. canaries + verification + adjudication;
4. report + docs.

Push only per the repo's standing preference.
