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

## 2026-09-25 — FR2-08 spec decisions (from the Planner)

Spec: `evidence/FR2-08/spec.md` (102KB). **Hard precondition:** FR2-07 must be DONE first — this
item's text/textGone condition reuses FR2-07's visible-text check as a shared function rather
than a second copy, and its result shares FR2-07's verification contract.

Adopted as written (full reasoning in the spec's §0.6):
1. `wait_for` polls from Node, not through Puppeteer's own `waitForFunction`. Traced why: that
   API defaults to requestAnimationFrame-based polling, which is exactly the mechanism FR2-01 had
   to work around for background tabs (GAP-008), and a string predicate for it gets compiled
   inside the page with `new Function`, which a strict Content-Security-Policy blocks outright.
   Node-side polling with CDP-based evaluation avoids both problems, reusing FR2-01's proven
   pattern.
2. `wait_for` is a runtime-level method, not an engine action type — a wait has no reason to go
   through the engine's retry loop (which would triple its length), duplicate-action guard, or
   failure screenshot (which can hang for minutes on a background tab, per GAP-010's history).
3. `textGone` succeeds immediately if the text was never there at all, matching FR2-01's
   `hidden` semantics for a non-existent selector — but this is flagged in the result
   (`presentAtStart:false`) precisely so a typo doesn't look identical to "already gone".
4. `settle` and `wait_for` and `expect` are kept strictly distinct, with a comparison table in
   the spec: settle is a heuristic quiet-period that can't see a page timer scheduled for later
   (demonstrated as a real, pre-existing bug — GAP-new-3 below); expect is a one-shot check right
   after an action, never a wait; wait_for is the only one of the three that actually blocks
   until a named condition is true.
5. A real bug found while tracing, not in the original ask: engine settle has no Node-side time
   bound at all — every one of its timers is either in-page or a Puppeteer timeout that never
   starts running until `page.evaluate` itself starts, so a click with settle:true that opens an
   alert() blocks until the tab's 30-second auto-dismiss. Fixed here by adding a real Node-side
   hard bound.
6. CLI condition flags (--text/--text-gone/--url/--js) are REJECTED outright on any verb other
   than `waitfor`, deliberately breaking the "silently ignored" precedent --settle set. A user
   writing `click 7 --text Saved` believes they asserted something; silently ignoring that flag
   would be exactly the silent-wrongness class this whole loop exists to close.
7. GAP-002 (stale "CLI has no wait command" comments in run-cli.mjs, with sleeps instead) is
   folded into this item, scoped to exactly the two lines carrying that stale claim — not a
   broader sleep-removal pass (the other bare sleeps are logged as a new gap for FR2-13, which
   ports these scenarios to files with real wait_for steps).

Sequencing: DEVELOP runs after FR2-07 (last in the merge order for shared files: the engine,
runtime.ts, tools.ts, cli.ts, page.ts and types.ts all overlap).

## 2026-09-25 — FR2-09 spec decisions (from the Planner)

Spec: `evidence/FR2-09/spec.md` (81KB). No hard precondition on another item — its file overlap
with FR2-02..08 is a handful of lines each, not shared logic.

The Planner corrected a real inaccuracy in the existing code and docs while tracing: the current
snapshot engine's own header comment and a note in browsing-capability-loop.md both claim
cross-origin iframes are skipped because of site isolation. That's false — Puppeteer already
reads cross-origin iframe content fine via its own per-frame CDP session, and the loop's own
prior milestones demonstrate this working (Stripe Elements, a real cross-origin case). What
actually falls into the "skipped" bucket today is: a frame that detached or navigated mid-scrape,
any other CDP error, and — newly identified as a real risk — a frame whose page script is busy,
which today doesn't throw, it just hangs the whole snapshot indefinitely (the same class of bug
as FR2-01's GAP-030, just for the snapshot engine instead of wait_for_selector).

Adopted as written (full reasoning in the spec's §0.1):
1. A node's frame is omitted entirely when it's in the main frame (the majority case) — adding an
   annotation to every node would bloat every snapshot for no benefit. Only non-main-frame nodes
   carry frame identity, and only shadow-DOM nodes carry a shadow-host chain.
2. Frames that can't be scraped get a real 5-second timeout added (there wasn't one before), so a
   busy iframe can no longer hang an entire snapshot — it becomes a listed placeholder instead.
3. Skipped-frame placeholders appear in every listing mode, including idsOnly, because hiding
   missing content is exactly the silent-wrongness bug class this loop exists to close.
4. Frame and shadow labels are both structured fields (for JSON/programmatic consumers) AND baked
   into the text listing (for LLM consumers) — not one or the other.
5. ax_snapshot gets Puppeteer's own includeIframes:true option, also with a bounded timeout and a
   fallback to the no-iframes read if that read is too slow or fails, rather than leaving iframe
   content silently absent from the accessibility tree as it is today.
6. No real tokenizer dependency is added for the token-size regression measurement — the repo
   already has a documented chars/4 proxy in an existing script, reused here rather than inventing
   a second convention.
7. Backward compatibility: every existing parser of the snapshot text targets main-frame-only
   elements, which stay byte-identical, so nothing in-repo breaks. External regex parsers of
   iframe-labeled lines are the one real compatibility risk, mitigated by publishing a tolerant
   \`^\\[#(\\d+)\` pattern in the tool description instead of the exact \`^\\[#(\\d+)\\]$\` some
   callers might have used.

Sequencing: no hard precondition; file overlap with prior items is minimal. Default merge order
is after FR2-08, but a parallel worktree Executor is acceptable if the Orchestrator wants to
develop it alongside another item.

## 2026-09-25 — FR2-10 spec decisions (from the Planner)

Spec: `evidence/FR2-10/spec.md` (62KB). No hard precondition. This item turns out to be MCP-only
by design -- the CLI and SDK already carry a concrete session id everywhere, so there's no
"omitted id" case for either of them to resolve.

Adopted as written (full reasoning in the spec's §0.1):
1. One shared mechanism at MCP tool-registration time, not a per-tool check copy-pasted onto ~66
   handlers. A required sessionId schema gets rewritten to optional automatically when a tool is
   registered; everything else passes through untouched by reference, so browser.launch,
   browser.attach, browser.health, browser.shutdown_all and agent.runGoal are provably unaffected.
2. "Live" for this purpose deliberately does NOT reuse FR2-03's CLI liveness probe. The CLI has to
   probe because its Chrome is detached across separate processes with nobody watching it; the
   MCP server IS the owner of its browser connection, so its own in-memory session registry is
   already a maintained, real-time liveness signal -- no network round-trip needed to answer
   "which sessions exist right now".
3. Only sessions the caller could plausibly hold an id for are candidates. Traced a real edge case
   from this: agent.runGoal creates its own short-lived session in the same manager when called
   with no sessionId, and that session must NEVER be picked when some other tool's sessionId is
   omitted, because the caller was never handed its id. A separate tracked set enforces this.
4. While a launch, attach or shutdown call is still running, an omitted-id call is refused rather
   than guessed at -- the traced race is real: the MCP protocol dispatches tool calls without
   awaiting them, so a client really can send two calls that overlap in-flight.
5. When the id was picked automatically, the result says which one was used, appended as an extra
   line, never replacing the original result content -- so the choice is always auditable, and
   the one irreducible risk (the caller's own picture of "the" session is stale because a prior
   session quietly idle-timed-out) is at least visible after the fact.
6. Distinguishes clearly: browser.launch/attach's OWN optional sessionId already means something
   different ("the id to create or reuse under") from what this item adds to every OTHER tool
   ("resolve to whichever existing session is live"). The two are not the same feature and the
   spec is explicit that launch/attach must never be touched by this change.

Sequencing: no hard precondition; default merge after FR2-09. Tools added by later items (FR2-08's
wait_for, FR2-12's audit) are covered automatically since the mechanism runs at registration time.

## 2026-09-25 — FR2-11 spec decisions (from the Planner)

Spec: `evidence/FR2-11/spec.md` (75KB). Soft dependency on FR2-07 (still at SPEC, not DONE) —
this item doesn't block on it reaching full audit, but the verification field it adds to history
entries must use FR2-07's exact field name and shape once that code lands.

A real gap found while tracing, beyond the original finding: in-memory history doesn't just
reset on an MCP server restart -- it resets on EVERY SEPARATE CLI PROCESS, because each CLI
invocation builds a brand-new runtime/session/tab object from scratch and re-attaches to the
same browser. So "the CLI's own action history" as a concept literally cannot exist without a
file, confirming the Done-when's history.jsonl requirement is the only way to satisfy it, not an
implementation preference.

Adopted as written (full reasoning in the spec's §0):
1. Session-wide history is its own real ring buffer fed by every tab, not a live re-read of
   whichever tabs happen to still be open -- because a tab that closes itself (the very common
   case of an OAuth popup) would otherwise take its whole action history with it the moment it
   closes, right when that history is most likely to matter.
2. The merged multi-tab view is opt-in (a new scope parameter, default unchanged), NOT a silent
   change to what an omitted tabId already means today. FR2-04 got away with a similar
   "omitted means everything" choice for its OWN brand-new getDialogHistory method, but
   get_action_history has existing callers relying on omitted-tabId meaning "the active tab" --
   flipping that quietly would be exactly the silent-wrongness class this whole loop exists to
   close.
3. Every field that reaches disk goes through one central sanitizer at the point of recording:
   URLs drop their query and fragment (reusing FR2-09's exact rule), typed text and clipboard
   content are stored as lengths only, eval code is stored as a whitespace-collapsed, URL-redacted
   200-character preview -- never its result. history.jsonl sits in the exact same per-session
   directory FR2-03 already defined, as a third append-only sidecar next to state.json and
   FR2-04's warden.json, deliberately inventing no new locking scheme since neither of those
   files needed one either.
4. Eviction counts are tracked separately at the per-tab AND per-session level, both exact and
   never silently reset while their owner (tab or session) is alive.
5. The CLI writes one history line per command that touches a session, including read-only
   commands like snap -- because "what did the agent actually see" is exactly what a debugging
   session most wants back, and excluding reads would make the record incomplete for that
   purpose. Rotation kicks in at 5MB into a single backup generation; there's deliberately no
   env knob to disable history writing at all, matching FR2-03's stance of not adding
   configuration knobs without a demonstrated need.

Sequencing: soft dependency only on FR2-07 (field-name compatibility, not full audit completion).
Default merge order after all of Phase 2, since runtime.ts/tools.ts/cli.ts/browser-session.ts are
touched by nearly every prior item.

## 2026-09-25 — FR2-01 audit-3: a NEW blocker introduced by fix-2 itself

audit-3 is genuinely fresh evidence, not a rerun of stale claims: it found GAP-057, a blocker
that fix-2's OWN GAP-030 fix introduced (a busy-frame probe timeout gets read as "no match",
which for state:hidden means "success" -- so a hidden wait can now falsely report success while
the element is still visible, if any frame is busy). This is the exact false-success bug class
GAP-031 was about, resurfacing through brand-new code in the very fix meant to close a different
gap. It's a clean illustration of why this loop insists on a genuinely independent audit after
every fix round rather than trusting a self-report, however thorough: fixing gap N can introduce
gap N+1 in the same code path, and only a fresh adversarial pass catches that.

Also worth keeping: audit-3 caught that fix-2's "ci-gate 38/42, matches baseline" claim had zero
real evidence behind it -- the gate script silently reads committed baseline files from an
EARLIER round rather than a fresh run, and fix-2 never actually ran it. The number turned out to
be correct when independently re-run, but the claim itself was unfounded when made. Recorded as
GAP-060. Executors must save fresh scenario-suite run output to their own evidence directory
every time they claim a gate result, not just cite whatever baseline file happens to be on disk.

FR2-01 moves to FIX(3) — its fourth fix round overall, third full audit cycle.

## 2026-09-25 — FR2-12 spec decisions (from the Planner)

Spec: `evidence/FR2-12/spec.md` (97KB). No hard precondition. Soft dependencies on FR2-08
(settle) and FR2-04/FR2-07 (dialog line formatting in --json mode) -- both have documented
fallback behavior if not yet landed, so this item isn't blocked by either.

Two real bugs found while tracing, beyond what the finding described:
1. Audit results leak between pages in any long-lived process (MCP or SDK): the browser tab's
   console/error/network buffers are never scoped to the currently audited document, so visiting
   a noisy page and then a clean one and running audit() on the clean page still reports the
   noisy page's errors. The CLI mostly dodges this by accident (each command is a fresh process),
   which is exactly why exposing audit on MCP/SDK for the first time makes this newly reachable.
2. CLS gets multiplied by the number of times audit() has run against the same tab: each URL
   audit injects a fresh vitals-tracking script via evaluateOnNewDocument and never removes it,
   so after k audits, k copies are all summing into the same live counter.

Also: the finding's claim that current-page audits can't retroactively get LCP/CLS is probably
just wrong. PerformanceObserver.observe({buffered:true}) is documented to synchronously return
already-recorded entries, which the existing vitals-capture script never actually uses -- it
takes the harder path of injecting a listener before every navigation instead. This needs a live
experiment (Step 0, mandatory before writing any audit code) to confirm before committing to a
design, since a browser-pane probe during planning got an inconclusive result (the pane itself
was hidden during load, which -- notably -- is exactly the "page was hidden" case that produces
no vitals at all; a real headless Chrome run is needed to settle it either way).

Adopted as written (full reasoning in the spec's §0.3):
1. One runtime.audit() call stays the single source of truth; CLI/MCP/SDK are three thin
   wrappers around it plus a pure report-shaping module, never three separate implementations.
2. MCP's browser.audit has no outDir option at all -- a stdio server's filesystem isn't the
   client's, and adding a second unfenced arbitrary-write path would undercut FR2-05's whole
   point. Images come back as real MCP image content blocks (the same mechanism
   browser.screenshot already uses), never as base64 buried inside the JSON text.
3. The committed JSON Schema is hand-written, not generated from Zod -- capability-runtime has
   no Zod dependency today and adding one, or a new devDependency just to convert schemas, would
   outweigh the benefit for one file. Drift is guarded three ways instead: a fully-populated
   TypeScript example object that the compiler itself enforces stays in sync with the interface,
   a test asserting the schema's own key sets match that example, and live validation of real
   audit output using a JSON Schema validator the MCP SDK already ships (avoiding a new
   dependency entirely).
4. An open dialog now fails an audit fast with a clear message rather than hanging until the
   30-second auto-dismiss -- the same "never silently hang on a dialog" principle FR2-04 already
   established elsewhere.
5. The 5 existing accessibility heuristics are deliberately NOT touched or extended in this item
   -- real false positives exist in them, but the Done-when doesn't ask for that work and it's
   logged as a separate gap rather than folded in here.

Sequencing: no hard precondition. Step 0's live experiment must run and its outcome recorded
BEFORE any audit code is written, since it decides between two meaningfully different designs
for the vitals-capture rewrite.

## 2026-09-25 — FR2-01 fix-3: root-caused the timeout-as-boolean pattern

Fix-3 (the 4th fix round) didn't patch GAP-057 in isolation. It introduced one shared
tri-state result type (`match` | `no-match` | `unknown`) used by every per-frame probe in
this file's wait_for_selector code, so "the check couldn't finish in time" can no longer be
silently read as either a positive or negative answer anywhere in this path. This is the
architectural fix the loop asked for after audit-3 found the same collapsing-timeout mistake
recurring a third time through a different call site.

One existing test's assertions were deliberately changed, with the change explained rather than
silently made: E5 previously pinned SEQUENTIAL per-frame probing as if that ordering were a
required invariant, when it was actually part of the GAP-059 latency bug. The Executor rewrote
E5 to assert genuine parallel probe starts instead, with the old assertion's removal justified
inline. This is the kind of test change the loop's rules allow: fixing forward with proof, not
silently weakening a check.

FR2-01 moves to audit-4 (its 4th independent audit, 5th fix-cycle attempt overall in the
loop-prompt's counting). This is at the edge of the loop's stated retry bound (4 FIX->AUDIT
cycles before the Orchestrator must do its own root-cause pass and get at most 2 more tries) --
fix-3 already represents that root-cause pass, made explicitly. If audit-4 still finds a
genuine new gap in this same code path, the next step is to treat it as one of the 2
Orchestrator-supervised bonus cycles, not to keep issuing open-ended standard fix rounds.

## 2026-09-25 — FR2-13 spec decisions (from the Planner)

Spec: `evidence/FR2-13/spec.md` (150KB, the largest so far). **This item has HARD
preconditions, not soft ones**: the loop prompt itself names FR2-07, FR2-08, FR2-11 and FR2-12
as prerequisites for FR2-13, and none of them is DONE yet (all still at SPEC; FR2-01 itself is
still mid-audit). DEVELOP cannot start. The spec is written so every borrowed shape is
referenced by name and cross-checked against each source spec, with a short list of grep checks
the Executor must run first and stop if any comes back empty.

Adopted as written (full reasoning in the spec's §0.5):
1. `sutradhar run` drives its own freshly-launched, fully isolated browser in-process, exactly
   like the existing scenario-suite's SDK driver does today -- never the CLI's persistent
   per-directory session. A scenario needs to start from known state and never touch or mutate
   whatever session a user already has open in that directory.
2. Every step's parameters use the exact same names MCP tools already use (target, value, role,
   etc.), not a new vocabulary -- so anyone who already knows the MCP tool surface can write a
   scenario file without learning a second dialect. expect and settle are options ON a step, not
   separate step types, matching how FR2-07 and FR2-08 already attach them to actions.
3. Gates (console errors, page errors, broken requests) are fed from the runtime's event bus --
   the same live stream that already feeds FR2-12's per-tab buffers -- rather than reading those
   buffers directly, specifically because the buffers are capped and die with their tab. A noisy
   page could silently evict its own early errors from a 200-entry buffer and turn a real gate
   failure into a pass; the event stream has neither problem.
4. No "expect this action to fail" mechanism. The Done-when's deliberately-failing scenario is
   one the RUNNER correctly diagnoses as failing (wrong exit code, right reason) -- not a
   scenario designed to assert failure. Negative-path testing is already expressible with the
   existing primitives (wait for hidden, assert a zero count, expect no URL change).
5. Directory- or glob-based multi-file runs are explicitly deferred, not built now -- a shell
   loop covers today's need, and doing it properly would need its own aggregate-report design.
6. Closes the design half of GAP-004 (the CLI/SDK field-map syntax for extract, deferred by
   FR2-02): a scenario's extract step, a future page.extract(), and a future CLI extract verb
   will all share one field-map syntax, fixed now so it only gets designed once.
7. Found and closes GAP-062 in passing: browser tabs never listen for the requestfailed CDP
   event at all today, so a DNS failure or a refused connection is completely invisible to any
   consumer -- only HTTP responses >= 400 are ever seen. A scenario's failOnBrokenRequests gate
   needs this to be meaningful, so the listener is added here (excluding net::ERR_ABORTED, which
   is what ordinary navigation-away and cancellation produce, to avoid a flaky gate).

Sequencing: hard-blocked on FR2-07, FR2-08, FR2-11 and FR2-12 all reaching DONE. Everything else
in the loop can and should proceed; this item simply cannot start DEVELOP until then. The new
standalone modules with no dependency on those items (the schema files, the loader, the gate
collector, the classifier, the field-map normalizer) could in principle be built early, but the
spec's default is strict sequencing rather than a partial head start.

## 2026-09-25 — FR2-14 spec decisions: config auto-discovery treated as a real attack surface

Spec: `evidence/FR2-14/spec.md` (92KB). First correction: the loop prompt's OWN precedence
order is "CLI flag > env var > config file > default" -- the original finding restated this
loosely as "env vars, then the config file, then flags", which is a different and wrong order.
The spec implements the loop prompt's literal order, not the restatement.

The central finding: auto-discovering a config file by walking up from the current directory is
itself a security-relevant feature, not just a settings convenience, because an agent regularly
cd's into directories (cloned repos, project folders) it doesn't fully control. A planted
.sutradhar.json in such a directory could otherwise redirect the default download location
somewhere sensitive (a Startup folder, ~/.ssh) or silently switch native dialogs to auto-accept,
removing an agent's last chance to not confirm something destructive. This is treated with the
same seriousness as this loop's "never guess" rule elsewhere, not accepted as a convenience
trade-off.

Adopted as written (full reasoning in the spec's §0.5 and §7.1):
1. Discovery differs by surface, deliberately: the CLI and MCP always search upward from their
   process's cwd (well-defined for the CLI; for MCP, made visible via one guaranteed startup log
   line naming which file loaded or where the search stopped, since an MCP host's cwd isn't
   always meaningful). The SDK does NOT auto-discover at all by default -- an embedding
   application's own process cwd is meaningful, but a library silently changing its own sandbox
   based on ambient files would still be a surprising thing for it to do, matching FR2-05's same
   stance on env vars. discoverConfig:true opts in explicitly.
2. The upward search stops at a .git boundary (inclusive) or at the user's home directory
   (inclusive), and NEVER reads a config placed at a filesystem root. This closes both the
   "planted file above a shared parent directory" case and the "config leaks across unrelated
   repositories" case.
3. Download-related keys from a DISCOVERED (not explicitly-loaded) config are contained: every
   resolved path must stay inside the config file's own directory and outside any .git folder,
   using FR2-05's existing symlink-safe canonicalization. A config loaded explicitly via
   SUTRADHAR_CONFIG is trusted like an env var and skips this containment -- the operator named
   it on purpose.
4. A discovered dialog.mode:"accept" is honored, never silently -- every CLI command where it's
   in effect prints a one-line stderr Note naming the file, and MCP prints an equivalent startup
   warning. An explicit CLI --dialog flag, or a previously-set sticky flag, still overrides it.
5. On POSIX, a discovered config file owned by someone other than the current user (or the root
   user), or writable by group/others, is refused outright -- borrowing git's own "dubious
   ownership" model. Windows can't check file ownership through Node at all; that gap is
   documented honestly as a residual, platform-specific risk rather than pretended away.
6. Unknown keys warn rather than error (per the loop prompt's own explicit instruction), but every
   warning is surfaced on every single command, not just once, and suggests the likely intended
   key name -- so a typo in a RESTRICTIVE key (e.g. allowedDomain instead of allowedDomains) is
   still very hard to miss even though it doesn't hard-fail.
7. A real bug found and closed in passing: today, an invalid SUTRADHAR_IDLE_TIMEOUT_MS value
   (e.g. a typo) silently DISABLES the MCP server's idle-session reaper entirely, which is
   exactly the kind of failure that reaper exists to prevent. It now fails MCP startup loudly
   instead.
8. Merge conflicts, precedence rules and layer-collapse rules cross-reference FR2-03/04/05's
   EXACT field names and shapes as already specified (DialogPolicy, resolveFsRoots's config
   layer, etc.) rather than approximating them, since none of those three items has landed yet
   either -- this is now the fourth spec in a row built entirely on top of other still-unbuilt
   specs' documented shapes.

One amendment proposed to FR2-04 (not yet built): --dialog report should PERSIST that choice in
CliState explicitly, rather than clearing it as FR2-04 originally specified -- otherwise a
config-file dialog policy could silently reassert itself after a user explicitly asked for
"report" (no auto-handling) on an earlier command. Recorded as a spec amendment for whoever
develops FR2-04, not a silent contradiction between the two documents.

Sequencing: builds on FR2-03/04/05 (soft-to-hard depending on the key), all still SPEC status.

## 2026-09-25 — FR2-01 audit-4: ESCALATION. Same root-cause pattern found in 3 more functions

audit-4 confirms fix-3's claim was false: "a timeout can no longer be silently read as a
definitive yes or no anywhere in this code" doesn't hold. The pattern (a probe that errors or
times out gets collapsed into a definite negative answer) exists in at least three more
functions fix-3 never touched: isHandleVisible (catches every error including tab-closed and
returns "not visible"), diagnoseSelectorVisibility (a timeout becomes "No element found", the
exact GAP-009 symptom), and countOtherVisibleMatches (a timeout silently drops its warning).
It also found that GAP-059's claimed fix only applies to the hidden-state code path -- the
visible/attached-state frame probing (firstVisibleHandleAnyFrame, firstAnyHandleAnyFrame) is
STILL sequential, so the original GAP-059 symptom (latency scaling with busy-frame count, and a
boundary-timing false-timeout risk) is unfixed for the more common visible-state case. And a new
tradeoff was introduced without being disclosed: waitForHiddenInAllFrames now reports "unknown"
(a busy neighbor frame) as "still visible", making a genuinely-hidden element's wait fail with a
message indistinguishable from the real-visible case.

This is now the FOURTH consecutive independent audit to find the same underlying mistake
recurring through different code paths in the same item. Per the loop's own retry-bound rule
(§9 of the loop prompt): at most 4 standard FIX->AUDIT cycles, then the Orchestrator itself does
root-cause work and gets up to 2 more supervised cycles before the item must be marked BLOCKED
with a full diagnosis rather than continuing indefinitely. fix-3 already represented an
Orchestrator-directed root-cause attempt (explicitly targeting the pattern, not the symptom) and
still missed 3 sibling functions with the identical shape. This is now escalation cycle 1 of the
2 remaining supervised attempts.

**Decision for this cycle:** the next Executor brief requires, as its FIRST deliverable before
touching any code, a complete line-by-line inventory of every place in
browser-action-engine.ts's wait_for_selector code path where a caught error, a timed-out probe,
or an empty/null result currently gets treated as a definite yes/no answer -- audit-4's own gap
list is the starting point, but the Executor must independently re-derive it by reading the
whole file, not just patch the 8 named sites. Only after that inventory is produced and reviewed
does the fix proceed. This is meant to catch a 5th sibling function neither fix-3 nor audit-4
found, if one exists.

**Also decided:** GAP-082's disclosed-but-undocumented tradeoff (a busy neighbor frame can make
a hidden wait time out even though the target is genuinely hidden) needs an explicit Orchestrator
call, not another silent choice by an Executor. Decision: correctness over liveness is the right
default here (an honest timeout beats a false "hidden"), but the error message in that specific
case must say "could not verify: one or more frames were unresponsive" rather than the plain
"still visible" text, so a caller isn't misled about which failure mode occurred. This is now a
REQUIRED distinction, not left to the Executor's judgment.

## 2026-09-25 — FR2-15 spec decisions (from the Planner)

Spec: `evidence/FR2-15/spec.md` (condensed to ~7KB in the committed copy; the Planner's full
output ran ~150KB with the complete row catalog -- retrievable from this session's own
task-notification record if needed verbatim). **Hard precondition, same shape as FR2-13**: this
guide maps Playwright onto the FINAL shapes of FR2-01 through FR2-14, none of which is DONE yet
(FR2-01 itself is mid-escalation). DEVELOP cannot start.

Adopted as written:
1. The markdown file IS the executed source of every snippet (tagged HTML comment markers,
   parsed and run verbatim by the live-verify harness) -- never a second copy that could drift
   from what the reader sees.
2. Both Playwright (pinned playwright-core@1.62.1, already isolated in tools/engine-comparison)
   and Sutradhar sides are executed for every row that claims a divergence, rather than trusting
   memory about Playwright's own behavior (case-sensitivity of getByText, strict-mode role
   matching, goto's load-vs-domcontentloaded default, auto-dismissed dialogs, fullPage default,
   storageState shape, etc.) -- about a third of the ~115 rows make exactly this kind of claim.
3. "No equivalent" rows are proven as absence checks against the live built tool list/CLI help/
   SDK prototype, not asserted from memory -- so the day a capability is added, the row fails
   loudly and forces a doc update (a drift detector, not just documentation).
4. No product code changes in this item (D12): a bug surfaced while tracing (e.g. type_by_label
   ignoring <label for>) is documented truthfully as a gap, never quietly patched so the doc can
   say something nicer.
5. Playwright MCP (microsoft/playwright-mcp) tool-name mapping is explicitly out of scope (D15) --
   covering it would need a second executed side; logged as a gap for later consideration.
6. No internal ids (GAP-/FR2-/PROB-) appear anywhere in the public-facing doc (D16).

Sequencing: same posture as FR2-13 -- hard-blocked on FR2-01..FR2-14 all reaching DONE (or
BLOCKED/DESCOPED with a diagnosis). The standalone harness modules have no dependency on those
items' shapes and could in principle be built early, but the spec's default is strict
sequencing, not a partial head start.

## 2026-09-25 — FR2-16 spec decisions (from the Planner)

Spec: `evidence/FR2-16/spec.md`. **No dependency on any other FR2-0X item** -- confirmed by
grep, unblocked and developable in parallel with FR2-01's ongoing escalation.

Key finding: enableStealth is a PROVABLE no-op today, not merely unused -- DEFAULT_LAUNCH_ARGS
already unconditionally includes --disable-blink-features=AutomationControlled, and the
conditional block that supposedly gates it just re-adds the same flag to a Set (a no-op on an
existing member). StealthEngine and its 4 script generators are fully dead: publicly exported,
never called by any runtime path, only exercised by their own isolated unit test.

Adopted as written:
1. Remove outright, don't deprecate -- no product-facing surface (CLI/MCP/SDK) exposes any of
   this; only a direct "import from @sutradhar/browser" would see the type removal, and the
   package is pre-1.0. Deprecating a no-op with a runtime warning would ship a warning for
   behavior that already does nothing.
2. AGENT_SETUP.md already has honest, specific boundary language (verified accurate, measured,
   not a hedge) -- no change needed there; --help and the README fix mirror the SAME wording
   rather than inventing new prose per surface, to avoid exactly the kind of divergence this item
   exists to fix.
3. packages/browser/README.md has FOUR contradictory spots, not just the one line named in the
   original finding (ADR frontmatter reference, package tagline, the numbered invariant, and the
   module-layout description) -- all four get fixed together.
4. A breaking type removal from @sutradhar/browser's public exports gets a changelog fragment
   that folds into the SAME 0.5.0 release item FR2-01 already requires (wait_for_selector's
   default-state change) -- not a separate version bump.
5. New negative case worth flagging for the Executor: check whether dist/ is committed (if so,
   its stale .d.ts files need removing in the same commit) and whether an actual
   docs/adr/0005-stealth-evasion.md file exists (if so, its status needs flipping, not left
   claiming an implemented policy that no longer exists).

Sequencing: unblocked. No hard or soft precondition on any other item.

## 2026-09-25 -- FR2-01 fix-4 (escalated bonus cycle 1/2): pattern claimed closed for wait_for_selector

Executor completed the escalation brief's required order: (1) an independent full inventory of
every function in the wait_for_selector call graph, written to inventory.md BEFORE any code
change, cross-checked against gaps.md's GAP-081..088 -- and found a 9th, previously-unnamed site
(checkWaitForSelectorOnce's own check-once hidden branch had the identical boolean-collapse bug,
one call path over from GAP-082); (2) one shared tri-state mechanism, not per-site patches:
extended FrameProbeVerdict one level down with a new HandleVisibilityVerdict
(visible/not-visible/unknown) plus a general-purpose raceBounded helper, reused across
isHandleVisible, diagnoseSelectorVisibility, and countOtherVisibleMatches; (3) every one of the
8 named gaps + the 9th site fixed with BOTH a failing-before/passing-after unit test AND a
mutation proof (7 mutations, each applied and reverted interactively, each confirmed to flip the
relevant new test from pass to fail) -- this is real proof-of-fix, not a self-report.

Fresh verification this round, not cited: tsc clean across all 5 touched/dependent packages,
vitest 404/404 across all 5 packages, a real pnpm build, and TWO live-verify runs against real
Chrome (48/48, then 47/48 with one Windows-specific OS file-lock flake on a Crashpad metrics file
from running two live-Chrome sessions back-to-back -- not a regression in the fix itself, logged
honestly rather than hidden). ci-gate.mjs was re-run fresh (38/42, exit 0) against freshly
regenerated (not stale) baseline files, per GAP-060's own standing rule.

Two things flagged, not silently absorbed:
1. GAP-100 (new): the scenario-suite's baseline-{cli,mcp,sdk}.json files are shared, unscoped,
   with no per-item ownership boundary -- regenerating them was necessary for a REAL fresh gate
   result, but the Executor deliberately left them uncommitted/unreverted rather than guess at
   reconciling them against a concurrently-running FR2-16 session's own use of the same files.
   This is a real gap in the loop's file-ownership conventions worth a standing rule, not yet
   decided here -- left as an open question for whoever finalizes both items' commits.
2. The Executor's own honest self-assessment: confident the wait_for_selector call graph
   specifically has now been read exhaustively three times over (audit-4, this inventory, the
   mutation pass) and does not expect a 10th sibling site WITHIN it -- but explicitly does NOT
   claim the same confidence for this file's OTHER action types (click/type/scroll/etc.), which
   were out of this inventory's scope by design. Recommends any further escalation widen scope
   rather than repeat wait_for_selector once more.

Per the loop's own retry-bound rule, this consumed escalation bonus cycle 1 of 2. Next step:
dispatch audit-5, a fresh independent Opus Auditor who did not write this code, to verify the
claim before accepting it. If audit-5 finds the pattern genuinely closed (no new gap of the SAME
shape), FR2-01 can move to DONE. If audit-5 finds one more instance of the same shape, exactly
one Orchestrator-supervised cycle (2 of 2) remains before the item must be marked BLOCKED with a
full diagnosis, per the loop's own stated bound -- not an open-ended sixth attempt.
