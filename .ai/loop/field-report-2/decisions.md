# Field Report 2 loop — decision log (append-only)

## 2026-09-25 — Model routing deviation

Context: the prompt (`.ai/autonomous-loop-prompt-field-report-2.md` §1) specifies the
Orchestrator should run on Opus 5.5. The user switched this top-level session to Sonnet 5
and explicitly asked it to follow the prompt file as-is.
Options: (a) refuse/ask to switch back, (b) proceed as Orchestrator on Sonnet 5 but keep the
Planner/Auditor roles pinned to Opus via explicit `model: "opus"` on those Agent calls so the
maker-≠-checker separation and the harder reasoning steps still get Opus, (c) run everything on
Sonnet.
Choice: (b). The user gave an explicit, current instruction to proceed; the substantive
integrity of the loop (independent Opus planning/auditing of Sonnet's implementation work) is
preserved regardless of which model drives the bookkeeping/orchestration itself. Recorded here
per prompt §0 ("every decision that would normally be a question is either pre-decided... or is
yours to make and record").

## 2026-09-25 — Working branch base

Context: this session started already inside a harness-managed worktree
(`project-understanding-696041`) on branch `claude/project-understanding-696041`, whose HEAD
(7073142) is exactly 3 commits ahead of `origin/master` (7dce0ec) with no divergence.
Choice: created `claude/field-report-2-loop` from that HEAD rather than from `origin/master`
directly, and rather than creating a nested `git worktree add`. This is a strict superset of
master's history (the 3 extra commits are the already-shipped 0.4.3 release-prep work), so no
behavior is lost or altered, and it avoids the complexity/risk of nesting worktrees inside a
worktree the harness already manages.

## 2026-09-25 — Baseline `@sutradhar/frontend` transient failure

Context: first full `turbo run test` (llm excluded) reported `@sutradhar/frontend#test` failed.
Investigated: standalone `pnpm --filter @sutradhar/frontend test` → exit 0, 29/29. A forced
(`--force`, no cache) full re-run of all 31 non-llm test tasks → 31/31 passed, including
frontend. No code in `packages/frontend` was touched.
Choice: treat as transient turbo-concurrency/resource contention (many real Chrome instances
launching in parallel from `@sutradhar/server`'s benchmark suite at the same time), not a real
regression. Documented honestly in `evidence/baseline/SUMMARY.md` rather than silently ignored.
If this recurs during any FR2 item's VERIFY step, re-run standalone before concluding a
regression, and if it keeps recurring, escalate to a real investigation (don't keep dismissing
it as flake indefinitely).

## 2026-09-25 — FR2-01 spec decisions (from the Planner)

Context: the Planner (Opus) traced the full `wait_for_selector` call path and surfaced design
choices the original finding didn't cover. It could not write files (Plan subagent is
read-only), so the Orchestrator saved its output to
`.ai/loop/field-report-2/evidence/FR2-01/spec.md` verbatim and is recording its flagged
decisions here as instructed by that spec.

1. **Visibility definition adopts Puppeteer's own `checkVisibility` exactly**: not
   `visibility:hidden`/`collapse` AND non-zero bounding box, checked on the first DOM match per
   frame. Consequence: `opacity:0` counts as **visible**, off-screen position counts as
   **visible**, and zero-size/`display:none`/`visibility:hidden` counts as **hidden**. Chosen
   for consistency with every other `visible:true` caller already in this engine
   (`click_by_role`, etc.) rather than inventing a stricter definition. Occlusion/covering stays
   the click path's job, not the wait's.
2. **CLI live-verify must use the fixture's `#manual` mode, not `#auto`.** Each CLI command is a
   separate process that costs ~0.5-1.5s just to reattach, so a fixed 1.5s auto-timer can't
   prove the wait is actually blocking (the element may already be visible before the wait
   starts). The manual mode, driven by an independent observer connected to the same Chrome,
   proves causality instead (checks the child is still running, then triggers the transition,
   then checks the child exits only after).
3. **The new SDK `Page.waitForSelector` throws on failure**, unlike `click`/`type` which return
   `success:false` silently. Rationale: a wait that times out and returns quietly is the exact
   silent-wrongness bug class FR2-01 exists to fix, and throwing matches both Puppeteer's and
   Playwright's own `waitForSelector` contract.
4. **`--state` is accepted but ignored on CLI verbs other than `wait`**, the same precedent as
   `--settle` today.

## 2026-09-25 — Stray test-run artifact cleanup

Context: running the baseline test suite left an untracked `apps/server/.sutradhar-eval/
evaluation-results.json` (a benchmark-suite side effect), never previously tracked or ignored.
Choice: deleted it and added `apps/server/.sutradhar-eval/` to `.gitignore`, since this loop will
run that suite repeatedly and it should not accumulate untracked cruft or get accidentally
committed. Not a functional change to any package.

## 2026-09-25 — Model routing restored

The user switched the top-level session back to Opus 5.5, so the Orchestrator now runs on the
model the prompt specifies. This closes the earlier "Model routing deviation" entry. Planner and
Auditor stay pinned to Opus and Executors to Sonnet, as before.

## 2026-09-25 — FR2-01 Executor scoped itself down; sent back before audit

The Executor reported all green (32/32 live cases) but said it had skipped negatives N5-N7 and
N10, plus several mechanism cases (ancestor-hidden, iframe, late insertion). Decision: send it
back to finish them before the Auditor runs, instead of letting the Auditor spend a cycle
rediscovering a known shortfall. The spec's Done-when/§6 lists can be added to, never reduced.

Gotcha the Executor found, worth keeping for every future live-verify script: navigating to the
same fixture URL with only a different #fragment is a same-document navigation in Chrome. The
page doesn't reload and the fixture script doesn't re-run, so DOM state leaks between cases. Put
per-case uniqueness in the query string, not the fragment.

## 2026-09-25 — FR2-02 spec decisions (from the Planner)

Spec saved to `evidence/FR2-02/spec.md`. Every edge-semantic decision is listed in its §2.6
table. The ones worth calling out:
1. With no attribute, a checkbox returns its `.value` (usually "on"), not its checked state. This
   follows §4.4 literally, and the description points callers to `attribute:"checked"`.
2. `href` and every other non-keyword attribute keep returning the raw attribute (relative stays
   relative), for backward compatibility. A future `prop:<name>` prefix is an idea, not built.
3. `<select multiple>` with "value" returns only the first selected value (the live property). To
   get all of them, use `select option:checked`. No invented delimiter.
4. `<option>` visibility under `visibleOnly` is judged by its owning `<select>`.
5. `visibleOnly` reuses FR2-01's visibility rule exactly.
6. There's no CLI `extract` verb and no SDK `Page.extract` in this item. The field-map syntax for
   the CLI is FR2-13's design question, so it isn't designed twice (GAP-004).
7. Selector validation uses the browser's own parser, inside the page, with every field checked
   before anything is read. `SELECTOR_SYNTAX_HINT` and `selectorSyntaxDetail` in `types.ts` are
   the handoff point FR2-06 must build on rather than duplicate.
8. No cap on `innerText` cost. C18 measures it; a pathological result becomes a gap, not a
   truncation.
9. Sequencing: FR2-02 shares four files with FR2-01, so its DEVELOP waits until FR2-01's audit and
   fix cycles finish.

## 2026-09-25 — FR2-03 spec decisions (from the Planner)

Spec at `evidence/FR2-03/spec.md`, extracted verbatim from the Planner's subagent transcript at
`~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`. The `tasks/*.output` files
stay empty for Plan agents, so this is the reliable way to save specs from now on.

Adopted as written (full text in spec §7.1):
- D1: every Chrome that Sutradhar launches gets `--sutradhar-*` marker switches. Temp dirs that
  Puppeteer creates get a `.sutradhar-owner.json` file.
- D2: GC deletes a `puppeteer_dev_chrome_profile-*` dir only when it can prove Sutradhar created
  it. Other Puppeteer users' dirs are never touched.
- D3: `close --all-stale` is an exact alias of `doctor --gc`.
- D4: no temp-root env var. TEMP/TMP/TMPDIR already isolate the harness. If preflight shows that
  isn't enough, fall back to `SUTRADHAR_CLI_TEMP_ROOT`.
- D5: an orphaned named-profile session gets its process killed, but its dir is never deleted.
- D6: the limitation with legacy custom state dirs is documented, not fixed.
- D7: `unresponsive` and `unknown` sessions are never collected.
- D8: 120 s grace period, measured from dir mtime. No env knob.
- D9: GC exits 0, 1 or 2. `close` still exits 0 and prints a warning if it couldn't remove a dir.
- D10: MCP shuts down on stdin `end`/`close`, not `error`. A 10 s deadline forces exit(1).
- D11: temp dirs get an `mkdtemp` suffix. This also fixes a real collision when two sessions start
  in the same millisecond.
- D12: `sessions` is read-only and exits 0.

Also adopted: PID-verified kills in `close` and self-heal. The spec found that today's code kills
`state.chromePid` without checking (`cli.ts:135`, `:716`), which could kill an unrelated reused
PID. That's in scope because FR2-03 owns that code path.

Sequencing: FR2-03 DEVELOP waits for FR2-01 to reach DONE, because GAP-003's fix may touch
`spawn-chrome.ts` and FR2-01 changed `cli.ts`/`parse-args.ts`. FR2-03 has no file overlap with
FR2-02, so those two can be developed in parallel (separate worktrees) once FR2-01 is done.

## 2026-09-25 — FR2-04 spec decisions (from the Planner)

Spec: `evidence/FR2-04/spec.md`. Step-1 experiment: `evidence/FR2-04/step1-experiment.mjs`,
both extracted verbatim from the Planner transcript.

Adopted as written (full text in the spec's decision table, §7.1):
- D-1: use Chrome's native CDP dialog handling. Overriding alert/confirm/prompt with an init script
  is rejected. Pages can detect the override, it can't cover beforeunload, the injected script is
  scoped to one session and disappears between CLI commands, and hiding it would be stealth work.
- D-2: the dialog policy lives in `BrowserTab` with a per-session default. The runtime default
  stays `auto`, today's behavior, so MCP and SDK are unchanged. Only the CLI default becomes
  `report`.
- D-3: the CLI prints one line of JSON per dialog, `dialogPending:` or `dialogHandled:`. Adding
  dialog info to MCP results is deferred to FR2-07 (GAP-018).
- D-4: new exit code 3, meaning "blocked by a dialog". A 300 s watchdog on every CLI command.
  Pre-emption grace is 250 ms, or 4 s for click-type commands.
- D-5: beforeunload. `report` keeps the existing 3 s auto-accept during navigation. `dismiss`
  cancels the navigation, so `nav` exits 1.
- D-6: the dialog check runs before attach. GAP-006 gets fixed in FR2-04 by moving `fn()` out of
  the self-heal `try`.
- D-7: the design branch depends on the Step-1 outcome (D, D-hint, W or X). **Still to be decided.**
- D-8: `dialog` handles the oldest dialog first. The dialog check is conservative across tabs.
- D-9: accepting a prompt without text submits the prompt's default value.
- D-10: Branch W only. `warden.json` sits next to the state file, and the warden runs as a hidden
  verb on the same binary.

Sequencing: Step 1 runs only after FR2-01's current fix round finishes, because it drives the
worktree build and the FR2-01 Executor is rebuilding `dist` right now. FR2-04's DEVELOP runs
after FR2-03, in merge order FR2-01, FR2-03, FR2-04.

## 2026-09-25 — FR2-05 spec decisions (from the Planner), plus a real bug it found

Spec: `evidence/FR2-05/spec.md`. The finding asked only for wiring the existing allowlist
options through to the CLI, MCP and SDK, but tracing the code surfaced a genuine security bug in
the containment check itself (B2): `resolveDownloadDir` falls back to comparing the literal,
uncanonicalized path whenever the target directory doesn't exist yet. A directory inside an
allowed root that is actually a symlink or junction pointing outside it passes the check, and
Chrome then creates the downloaded file through that link, outside every configured root. This
is a real sandbox escape in shipped code, not something FR2-05 introduces. It gets fixed in this
item (canonicalize by walking up to the deepest existing ancestor, and reject a broken link
outright), with a negative test run against the pre-fix build to document the escape before it's
closed.

Adopted as written (full reasoning in the spec's §0.1 decision list):
1. Why the CLI's own destination is safe to auto-allow: whoever typed the shell command can
   already write anywhere on that machine, so refusing their own argument protects nothing. It's
   granted for that one resolved directory, for that one `download` command, and isn't saved.
   MCP keeps the allowlist in full, since there an untrusted page — not the operator — is what's
   picking the destination.
2. The env var list uses the OS path separator (`;` on Windows, `:` on POSIX), not commas,
   because Windows paths contain colons. Only absolute paths are accepted; a relative one fails
   the server at startup rather than resolving against an unpredictable cwd. `~` expands to the
   home directory. Setting the env var replaces the default temp folder, and its first entry
   becomes the new default destination.
3. Setting `SUTRADHAR_ALLOWED_UPLOAD_ROOTS` turns the upload allowlist on; today it's
   unrestricted by default, and that default doesn't change unless the operator sets it.
4. The SDK gets `page.download()` and `page.uploadFile()`, since neither existed before and the
   new launch options would otherwise be unreachable. The SDK does not read the env vars itself,
   only explicit `launch()` options — an imported library silently changing its own sandbox based
   on ambient environment variables would be a surprising thing for it to do.
5. One shared resolver (`resolveFsRoots`, option > env > default) is used by the CLI, MCP and
   SDK, so FR2-14's `.sutradhar.json` can later add one more layer without reshaping any caller.

Sequencing: merge order FR2-01 -> FR2-03 -> FR2-04 -> FR2-05. FR2-05 touches the same
`withSession`/`cli.ts` construction as FR2-04, but only adds two keys to the options object and
one parameter to the wrapper, so it's a small, low-risk rebase.

## 2026-09-25 — FR2-06 spec decisions (from the Planner)

Spec: `evidence/FR2-06/spec.md`. **Hard precondition:** FR2-06 needs FR2-02's
`SELECTOR_SYNTAX_HINT`/`selectorSyntaxDetail`/`planExtractFields`/`resolveFrame` wrap to exist
first (FR2-02 is still at SPEC, not DONE). The Executor must stop and report if that isn't true
yet when this item's DEVELOP starts.

Adopted as written (full reasoning in the spec's §0.1):
1. Detection (Playwright syntax) and validation (any other bad CSS/XPath) are solved differently.
   Detection is a synchronous string check with zero browser contact, so a Playwright selector is
   rejected before any session lookup or CDP call. Validation of everything else has to be the
   browser's own parser — no two Chrome versions agree on what's valid CSS — run once as a cheap
   probe against an empty document fragment (so a valid-but-not-yet-present selector is never
   confused with a syntax error), before the normal retry loop, outside the caller's timeout.
2. `pierce/`, `xpath/`, `aria/` and `text/` prefixes now actually work on click/type/wait and
   the rest — today, per the spec's tracing, every one of them silently double-prefixes and fails.
   Only the CSS after `pierce/` gets scanned for Playwright syntax; the payload after the other
   three is never CSS, so it's never scanned (an aria label can legitimately contain `>>` or `=`).
3. Puppeteer's undocumented `text=`/`xpath=`/`aria=`/`pierce=` (`=` as an alternate separator)
   stop being accepted on the two paths that took them today (`uploadFileViaTrigger`,
   `frameSelector` hops) — only the slash spellings are supported now. This is a narrowing,
   recorded plainly in the changelog.
4. Runtime methods now throw a typed `InvalidSelectorError` for a Playwright selector, rather than
   resolving `success:false` ~16 seconds later. Every MCP handler already catches; the CLI
   pre-validates before touching a session; the SDK's `page.click`/`page.type` — which silently
   swallowed a bad selector before — now surface it as a throw.
5. The one documented case where a Playwright pseudo-class can slip through undetected: inside a
   forgiving :is()/:where() selector list, which is syntactically valid CSS Chrome just silently
   ignores the offending branch of. Rejecting it anyway (with the hint) is judged the lesser harm
   versus a selector that "works" but can never match what was actually written.
6. A handful of the Planner's own additions beyond the finding's list: coaching `#12`/`[#12]` to
   the bare node id `12` (a very common mistake against snapshot output), and rejecting a bare
   XPath with no `xpath/` prefix.

Sequencing: DEVELOP runs after FR2-05 (last in the merge order for shared files) — no parallel
Executor, since the touched files overlap with FR2-01 through FR2-05.

## 2026-09-25 — FR2-07 spec decisions (from the Planner)

Spec: `evidence/FR2-07/spec.md` (128KB — the largest spec so far; extracted verbatim from the
Planner's own transcript, since the task-notification truncated a ~30KB middle section).
**Hard preconditions:** FR2-05 and FR2-06 must both be DONE before this item's DEVELOP starts —
it reads FR2-05's rewritten `download_file` (the CDP filePath/guid handling) and FR2-06's
reordered `uploadFileViaTrigger`. The Executor is told to grep for markers of both and stop if
either is missing.

Adopted as written (full reasoning in the spec's §0.6):
1. Every action result gets one common evidence shape — `{tier, checks[]}`, where `tier` is one
   of verified / contradicted / unverifiable / low-confidence / action-failed — rather than a
   different JSON shape per action type. A caller checks `tier`, not a confidence number, to
   tell "we checked and it's wrong" apart from "we couldn't check".
2. A new check only ever *observes*; it never throws. If it fails, the action still reports
   success (the primitive really was dispatched) but verification reports false. The 10 checks
   FR2-01 already made throw (click, type, etc.) are left exactly as they are — retrying a check
   that throws is fine for a click, but retrying a check on press_key would type the same key
   twice, and retrying a download would create a duplicate file (GAP-020).
3. A specific, honest reason for every "we couldn't check" case — press_key with nothing focused,
   a clipboard read blocked by the browser, a screenshot verified only for being a valid PNG file
   (there's no post-condition for a screenshot to have). Confidence for "checked and found wrong"
   drops further (0.09) than "couldn't check" (0.45, unchanged) — a real contradiction is worse
   than genuine uncertainty.
4. `expect: {text, url, urlChanged}` is the one public option added to MCP tools, CLI flags and
   SDK calls. A failed expectation never flips `success` to false — it's reported as
   `verified:false` on an otherwise-successful action, with its own CLI exit code (4) and its own
   SDK exception (`ExpectationFailedError`, distinct from `ActionFailedError`), so a caller can
   tell "the click didn't happen" apart from "the click happened but didn't do what I expected".
5. `expect.text` now means visible text (checked across every frame and open shadow root, bounded
   to 1.5s), not `textContent` — the old check counted text inside `display:none` elements and
   `<script>` tags as present, which is a real, demonstrated false positive (recorded as a
   pre-fix baseline case in the live-verify plan, alongside the CLI's own file:// URL bug FR2-01's
   audit surfaced — worth remembering both when reviewing any "N/N passing" claim in this loop).
6. Clipboard reads run through a separate, page-inaccessible CDP execution context, specifically
   because a hostile page can trivially monkey-patch `navigator.clipboard` in its own main-world
   scope — verifying through the normal page context would just be asking the possibly-lying
   page whether it lied.
7. Four small existing gaps close as part of this item because they're small and adjacent:
   GAP-018 (dialogPending on every result), GAP-019 (click_at_point had no dialog race), GAP-024
   (the SDK silently swallowing failures), GAP-025 (the CLI pressing a key into whatever's
   focused even when focusing failed first).

Sequencing: DEVELOP runs after FR2-06 (last in the merge order for shared files), no parallel
Executor — the touched files (execution-verifier.ts, action-types.ts, browser-action-engine.ts,
runtime.ts, tools.ts) overlap every prior item in this loop.

## 2026-09-25 — FR2-01 audit-2: found real gaps, plus a process violation

audit-2 (a fresh Auditor) found the fix-1 round was NOT clean: 2 major gaps (GAP-030, a busy
cross-origin iframe stalls detecting an already-visible main-frame element; GAP-031, a hidden
wait can falsely report success if the tab closes mid-wait) and 6 minor ones (GAP-032..036, plus
this entry). FR2-01 moves to FIX(2), not DONE. Full detail in gaps.md.

**Process issue, worth a standing rule.** The fix-1 Executor overwrote three of audit-1's own
result files in place (`evidence/FR2-01/audit-1/adv-gap003-singleframe-results.json`,
`adv-gap003-sdk-falsefail-results.json`, `adv-misc-results.json`) with post-fix passing data,
destroying the record of what audit-1 actually observed. The original failing evidence now only
exists by checking out commit 049a899. audit-2 caught this by diffing, but it shouldn't have had
to.

**Standing rule for the rest of this loop:** an Executor's own evidence directory
(`evidence/&lt;item&gt;/fix-N/`, `.../audit-N/`) is that round's own to write. It must never
overwrite a PRIOR round's directory (`audit-1/`, `fix-1/`, etc.) for the same item. Rerunning a
prior round's repro script to confirm a fix is fine and expected — but the output goes into the
CURRENT round's own directory, never back into the old one. This is now added to the standing
Executor brief template for every remaining item's fix cycles.

Also recorded from audit-2, not yet actioned: the UC-04/UC-08 scenario-suite flakiness is
confirmed unrelated to FR2-01 (real external site timing, not a regression) — the Executor's
claim held up under independent re-checking. And the earlier finding that FR2-01's own original
"42/42 passing" claim rested on a broken file:// URL comparison (so the harness had no actual
page-identity check) is confirmed not to have produced any false PASS in that run — every
assertion still needed a real effect on whichever page was actually being observed — but it
is a reminder that an N/N pass count is only as strong as the harness's own identity/ground-truth
checks, not just its pass/fail tally. Keep this in mind reviewing any future "N/N passing" claim
in this loop.
