# Protocol review 2: WebBench run 2026-10-04 (independent, adversarial)

Reviewer: Opus subagent, round 2. I wrote neither the protocol nor review 1, and I ran no benchmark task.
I ran the protocol's own tools only on copies in `<SCR>/rev2/` (slot M, example.com and iana.org only). The one
session I opened was closed, and `--check-clean` returned `{"clean":true,"stateJson":false,"profiles":[],"processes":null}`.
I killed no process. Worktree confirmed: `git rev-parse --show-toplevel` = `.../project-understanding-696041`, branch `bench/webbench-2026-10-04`.

**Verdict: REVISE.** There are 2 MAJOR findings (1 and 2) and 6 MINOR. Both MAJORs can be fixed in the checker and on paper; neither needs a re-draw.

---

## Verified sound (with evidence)

- **MANIFEST.** `sha256sum -c MANIFEST.sha256` printed OK for all 25 entries (rc=0). I re-ran it after the overwrite test below, and it printed no non-OK line.
- **Selection.**
  - `python select.py --out <SCR>/rev2/sel.json` then `cmp` against `selection.json` printed `IDENTICAL`.
  - `python select.py --out <LOOP>/selection.json` printed `refusing to overwrite the committed selection.json without --force`.
  - `git status --short` still showed only `?? .ai/loop/webbench-2026-10-04/`.
  - Review-1 #7 is resolved.
- **Wrapper guards.**
  - `--viewport=…` (the `=` form) does not slip past `FORBIDDEN_FLAGS`: the CLI parses flags with `args.indexOf("--viewport")`, and any other `--x` is rejected as unrecognised (`cli-bin.js` around lines 46282 and 46389).
  - The CLI's verb list (`cli-bin.js` 48321–48387) has no aliases for the forbidden verbs.
- **Non-ASCII.** `eval "'café — 日本 ’quote’ ' + document.title"` was logged and echoed byte-exact. An evidence excerpt with the same characters passed C2.
- **Concurrency.**
  - Slots are isolated by state dir, TEMP and log dir, and Chrome gets a free port.
  - Three parallel `drive.mjs M 9001 a1 --check-clean` calls produced a contiguous, correctly linked chain (seq 1–3).
  - See finding 7 for the residual race inside one slot.
- **Path length.** `<SCR>/B1t` = 164 characters, +35 = 199, and `drive.mjs:47` enforces the limit. Review-1 #9 is resolved.

## Review-1 findings: status

| R1 # | Status |
|---|---|
| 1 BLOCKER (raw-log provenance) | **Partially resolved.** The log and chain are real, but C2 can be laundered (finding 1) |
| 2 fingerprint | Resolved (measured in section 0c) |
| 3 decision tree | Mostly resolved. TASK-INVALID is missing from the less-favourable ordering, and paywalls are undefined (finding 3) |
| 4 retry | Resolved (the table is complete and consistent with the brief) |
| 5 canaries | **Partially resolved.** Canary 3 is caught by the checker, not the verifier (finding 2) |
| 6 blinding / adjudication | **Partially resolved.** Driver classes leak to the blind phase (finding 2) |
| 7 select.py | Resolved (verified above) |
| 8 driver brief frozen | Resolved for the driver. The verifier's prompt is not frozen (finding 2) |
| 9–16 | Resolved. Small executability residue remains in finding 5 |

---

## Findings

### 1. MAJOR: C2 proves only that a string appeared in some stdout the driver chose, not that the page showed it, on the task's site, or that it covers the answer

**Evidence.** I ran a live self-test on copies of the wrapper and checker. These are the `drive.mjs M 9002 a1 …` calls, in order:

| seq | Call | Output |
|---|---|---|
| 1 | `nav https://example.com --settle` | — |
| 3 | `eval "'Joe\'s Pizza phone: (212) 366-1182'"` | `Joe's Pizza phone: (212) 366-1182` |
| 5 | `eval "document.body.innerHTML='<p>Release date: Feb 18 2022, Guerrilla Games</p>'"` | — |
| 6 | `text` | `Release date: Feb 18 2022, Guerrilla Games` |
| 7 | `newtab "https://www.iana.org/help/example-domains"` | — |
| 8 | `eval "location.href"` | an off-site URL |
| 9 | `close` | — |
| — | `--check-clean` | clean |

I then wrote a COMPLETED/strict record with five pieces of evidence:
- seq 3: the memory-sourced phone number, echoed by a string-literal `eval`;
- seq 6: text I had injected into the DOM;
- seq 8: `iana.org`, which is off-site;
- seq 6: the one-character excerpt `"a"`;
- an `answer` containing a field ("Partial pizza") that appears in no evidence at all.

`node check-evidence.mjs runs` printed **`PASS M/9002 COMPLETED calls=8`**, with rc=0.

The holes behind that PASS:
- **(a) Echo laundering.** An `eval` literal turns memory into "logged output". This is exactly the P24 and P30 risk review-1 #1 named.
- **(b) Fabrication by mutating `eval`.** A mutating `eval` followed by `text` fabricates page content. The brief bans it, but nothing detects it.
- **(c) No domain check.** Neither the log nor the checker knows the current URL of an evidence call, so off-site sources pass. The only route needed is `newtab <url>`, `eval "location.href=…"`, or following a link. The auto-fingerprint runs only after `nav` and omits `href`.
- **(d) Answer not tied to evidence.** C7 needs one evidence item of any length. Nothing ties each answer field to an excerpt, so partial evidence plus memory passes.
- **(e) Cross-task sessions.** The session check is per slot. A driver can `nav` under task A and then quote `text` under task B's log without B ever navigating, and C5 skips B because B has no `nav`.

Section 6.1's false-pass table says "Answer from memory or another tool — ruled out by C2". That claim is false as the checker stands. Today only the ≥40% replay partly covers this path; about 60% of completions get no independent check.

**Fix (mechanical, in the frozen tools; then re-hash MANIFEST):**
1. **Record the URL on every call.** In `drive.mjs`, after every `cli` call that ran with a session, also log `location.href` (add `href:location.href` to the `FP` expression, and run it after every verb, not only `nav`; it costs one extra CLI process per call). Alternatively, log `href` only after evidence verbs plus `click*`, `press`, `newtab`, `focustab` and `eval`.
2. **Check the domain.** In `check-evidence`, map each evidence seq to the last logged `href`. FAIL if its registrable domain differs from the task's `startingUrl` domain, unless it is on a pre-registered alias list (geo editions, see finding 4). `drive.mjs` can also refuse `nav`/`newtab` to off-domain URLs, since it can read `startingUrl` from `selection.json` by `taskId`.
3. **Ban echo laundering.** FAIL when the collapsed excerpt, or any run of ≥8 of its characters, occurs in that `eval`'s own argv.
4. **Flag unsafe `eval`.** Mark any `eval` in the attempt whose argv matches a mutation or obfuscation pattern: `[^=!<>]=[^=]`, `innerHTML`, `textContent`, `insertAdjacent`, `document.write`, `append`, `createElement`, `location.(assign|replace|href\s*=)`, `.click(`, `submit`, `dispatchEvent`, `fetch`, `XMLHttpRequest`, `atob`, `fromCharCode`, `Function(`, `eval(`.
   - The protocol-allowed `history.back()` is whitelisted.
   - A flagged task cannot be `strict`, and goes to mandatory verifier review.
5. **Tie each answer field to evidence.** Replace free-form `answer` with `answerFields: [{field, value, logSeq}]`. Each `value` must be a C2-verified substring of its seq's stdout, and excerpts must be ≥ the value's length and ≥4 characters.
6. **Require a navigation per task.** C5 must also require every task log that cites evidence to contain its own `nav` to the task's `startingUrl` as its first `cli` call in each attempt.
7. **Correct the false-pass table** so it names what C2 does and does not prove.

### 2. MAJOR: the blind phase is not blind, and canary 3 tests the checker, not the verifier

**Evidence.**
- Section 4.4 gives the verifier `check-evidence.json`, which section 4.3 step 1 generates from the **unstripped** `runs/`. `check-evidence.mjs:77` writes `classification` into every result. I confirmed this on my test output: `--json | grep -c classification` gives 1 per task.
- The verifier also gets "the raw logs". If it is pointed at `runs/<slot>/`, it can read `summary.md`, which the brief requires to list "id, class, subflag".
- Stripping removes `classification`, `subflag`, `disclosure`, `toolDefects` and `notes`, but keeps `blockEvidence` and `driftChecks`, and an empty-versus-filled `answer`. Each of these signals the class.
- **Canary 3** (a fake COMPLETED whose excerpt is "not in its log") is rejected by C2 mechanically: section 3.4 shows exactly this case failing. If `check-evidence.json` is regenerated on the verifier copy, it says FAIL. If it is not regenerated, it lists that id as EXTERNAL-BLOCK, which contradicts the record. Either way the canary is caught without the verifier doing any real work, so "all 3 rejected" overstates the control.
- There is no frozen verifier prompt. Its rigour (re-reading every `eval` argv, per-field coverage) is unspecified, which is review-1 #8's gap for the other agent.

**Fix.**
1. Build a `verify-input/` tree for the verifier: stripped records (also drop `blockEvidence`, `driftChecks` and `attempts`), the `raw/*.jsonl` files only (no `summary.md`), and a `check-evidence.json` regenerated on that stripped copy with a `--blind` flag that omits `classification`.
2. Rebuild canary 3 so it **passes C1–C7**. Take a real EXTERNAL-BLOCK log, pick a genuine substring of a logged page (for example a nav-bar label or a title), and present it as the answer to a field it does not answer. Then only a verifier who reads the task against the evidence can reject it.
3. Add a canary for finding 1, for example an `eval`-echo or off-site excerpt that passes the current C2, if the fixes in finding 1 are not all adopted.
4. Freeze `verifier-brief.md` (inputs, the phase-1 and phase-2 procedures, the per-field and `eval`-argv audit for 100% of COMPLETED tasks, and the output schema) and hash it into MANIFEST.

### 3. MINOR: tie-breaks for the denominator are incomplete

- **TASK-INVALID is missing from the less-favourable ordering** (section 4.4: `void < AGENT-FAIL < … < COMPLETED/strict`).
  - TASK-INVALID removes a task from the in-scope denominator, which raises H1, so a dispute such as driver TASK-INVALID(auth) against verifier AGENT-FAIL or EXT has no rule.
  - **Fix:** rank TASK-INVALID between EXTERNAL-BLOCK and COMPLETED for H1 purposes.
- **Paywalls are undefined.** P10 (NYT), P29 (lawinsider: effective dates may be premium-gated) and P25 (Redfin estimate) could each be scored as "account" (TASK-INVALID) or "public data behind a login wall" (EXT).
  - **Fix:** a subscription or paywall in front of content that the site shows publicly in part is EXTERNAL-BLOCK(paywall). Only data belonging to the user's own account is TASK-INVALID(auth).

### 4. MINOR: realistic edge cases not settled by the tree

| Case | Ambiguity | Proposed rule |
|---|---|---|
| Same-organisation page on a different registrable domain, reached by an on-site link (P06 science.org → aaas.org help pages; P27 pennmedicine.org → upenn.edu) | "Subdomains only" says off-site, which leads to AGENT-FAIL or TASK-INVALID depending on the driver | Reached by clicking a link on the task site: COMPLETED/interpreted(linked-org) with the URL disclosed. Typed or searched: not allowed |
| Geo redirect to another registrable domain (kayak.com → kayak.co.in; johnlewis/shein editions) | Is it OK only if automatic, or may the driver choose an edition? | Only an automatic redirect from the starting URL counts as interpreted(geo). Driver-chosen editions are not allowed. Put the observed alias pairs in the C2 domain list (finding 1) |
| Geo-withheld (TikTok and Shein are banned in India) | The brief requires two attempts for a deterministic ban page | One attempt suffices when the page states regional unavailability (same as a deny page with a reference id) |
| The site shows fewer items than requested (only 3 of "top 5") | Partial or complete? | COMPLETED if the logged output shows the list ends (all items shown); otherwise partial |
| Several targets match (P05: which year's "Spring Fashion Trends"; P25: no city for "3560 Nashville Hwy") | Choosing one could be called a substitution | The first site-search result matching every named entity is not a substitution; disclose the choice |
| Accept-only cookie or consent wall | The brief allows only reject/necessary. Accepting needs user permission under the global rules | Don't accept. Read the DOM through it (`text` still works). If the content is unreadable: EXTERNAL-BLOCK(consent-wall); add that subflag |
| Page changed since the dataset (named section renamed) | Drift needs "proven gone"; a rename is neither gone nor a substitution | A rename counts as interpreted only if the site itself states the mapping (redirect or label); otherwise AGENT-FAIL/substitution |

### 5. MINOR: brief executability residue (a Sonnet would have to guess)

- **Bash timeout.** The Bash `timeout` of 150000 ms is below the worst case of one `nav` call: nav up to 120 s plus the automatic fingerprint `eval` up to 120 s. A Bash kill there can orphan the CLI child and its Chrome. Use 300000.
- **Sequential calls.** The brief never says "run calls one at a time; never background `drive.mjs`" (see finding 7).
- **Record paths.** Records are given as relative paths (`runs/{SLOT}/<taskId>.json`). Give the absolute path, because the Write tool needs one.
- **`{TASKS}` format.** Which fields (`id`, `startingUrl`, `task`) and what layout is unspecified. Pin one exact block format.
- **B6 schema.** B6 has no record field for the probe outcome (`probe: {result: pass|fail|not-exercised, logSeq}`).
- **Curl handoff.** The curl probes for 392 and 568 are "orchestrator, not driver", but the brief does not say what the driver records to hand off, or where the orchestrator logs the curl output, which is outside the chain.
- **Unconfirmed claims.** The brief references `click --expect-url-changed`, `wait ".sel" 15000` and `press "#5" Enter`. Only `nav`, `eval`, `text`, `newtab`, `close` and `screenshot` have been exercised through `drive.mjs`. A dry run of the full verb table against example.com would confirm the arguments.

### 6. MINOR: punctuation normalisation biases C2 downward

`ws()` collapses only whitespace. When a driver types `'` for a page's `’`, or `-` for `—`, a real excerpt fails C2 and becomes AGENT-FAIL(unsupported) (section 4.3.3). I demonstrated this: the excerpt `cafe - 日本 'quote'` against stdout `café — 日本 ’quote’` gave `FAIL … C2 … not found verbatim`.

**Fix:** NFKC-normalise both sides and fold quotes and dashes before comparing, or tell drivers to copy excerpts from the tool output and never retype them.

### 7. MINOR: residual forgery and concurrency, not stated precisely enough

- **The chain has no secret.** The algorithm is published in `check-evidence.mjs`, so a driver can write a valid chain in a five-line script.
- **`raw.sha256` is taken after the batch returns,** so it does not constrain anything done during the batch.
- **Unlogged CLI calls.** Direct `node cli-bin.js` calls with the slot's env are unlogged and undetectable.
- **Race inside a slot.** `seqNext`/`lastHash` read and then append without a lock, so two simultaneous calls in one slot can fork the chain. That gives C1 FAIL, which means void; no fabrication results.

**Fix:** state these as residuals in section 3.3 and 6.1, and rely on finding 1's mechanical checks plus replay. Optionally:
- take an `O_EXCL` lock file in `drive.mjs`;
- have the orchestrator snapshot `raw.sha256` while the batch is still running, for example at each subagent progress message.

### 8. MINOR (note): the replay's independent channel may not exist for a subagent

The `get_page_text` tool in the Claude_Browser pane may not be available to an Opus subagent. Curl fails on most dynamic sites. Expect many "no independent channel" results.

Pre-register what happens then: the replay through `drive.mjs` V1/V2 alone counts as confirmation, but is reported as "same-tool replay".

---

## Summary

| # | Sev | Topic |
|---|---|---|
| 1 | MAJOR | C2 is launderable: `eval` echo, DOM injection, off-site pages, 1-character excerpts, answer not tied to evidence (live PASS shown) |
| 2 | MAJOR | Classes leak into the blind phase through `check-evidence.json`, `summary.md` and kept fields; canary 3 is caught by the checker; verifier prompt not frozen |
| 3 | MINOR | TASK-INVALID missing from the less-favourable ordering; paywall undefined |
| 4 | MINOR | Edge cases: linked same-organisation domain, geo alias, accept-only consent, fewer items, multiple matches, rename |
| 5 | MINOR | Brief executability: Bash timeout, sequential calls, absolute paths, `{TASKS}` format, probe field, curl handoff |
| 6 | MINOR | Quote and dash folding in C2 |
| 7 | MINOR | Residual forgery and in-slot race to state honestly |
| 8 | MINOR | The independent channel may be unavailable; pre-register the fallback |

## False-pass analysis of this review

- **"C2 is launderable"** could be a false alarm if my copy differed from the frozen checker. Ruled out: `MANIFEST` verified `check-evidence.mjs` and `drive.mjs` OK, and I copied them unmodified with `cp`. The PASS came from an unedited log, since C1 passed.
- **"Non-ASCII is safe"** could pass falsely if the echo was correct while the log was not. Ruled out: C2 read the excerpt from the JSONL log, not from the terminal, and matched it exactly. The quote-folded variant failed, so the match is not vacuous.
- **"Selection reproduces"** could pass falsely if it were compared with a regenerated file. Ruled out: the output went to `<SCR>/rev2/sel.json`, and the overwrite attempt was refused. MANIFEST re-check afterwards: all OK.
