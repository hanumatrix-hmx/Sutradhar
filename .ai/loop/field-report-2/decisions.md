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

## 2026-09-25 -- FR2-16 audit-1: FAILED, own wording is dishonest -- exactly the mistake this item exists to fix

The independent Auditor re-ran everything itself (typecheck, vitest, build, live-verify,
mutation tests) and confirmed all of it passes, but caught a real, serious mistake: the new
README invariant and browser-options.ts comment claim '--disable-blink-features=
AutomationControlled' is "a Chrome-recommended stability flag, not a detection-evasion feature".
A live probe (webdriver-probe.log) shows this claim is FALSE -- navigator.webdriver is literally
true without the flag and false with it, and the repo's own tools/engine-comparison
stealth-isolation-experiment.md already documents webdriver masking as a stealth technique. This
is not a minor wording nit: it's the exact same category of false claim this item exists to
remove, reintroduced in the very sentence meant to replace the old false claim.

Decision, made now rather than left to the next Executor to guess: reword honestly rather than
remove the flag. Removing --disable-blink-features=AutomationControlled would be a real behavior
change (this flag does something, even if not full stealth), outside this item's stated scope
(pure honesty/cleanup, no capability change, per loop-prompt decision #1's "no stealth opt-in" --
the flag isn't an opt-in today, it's unconditional, and changing that unconditional behavior is
not what this item asked for). The new wording must say plainly: the retained flag hides
navigator.webdriver from simple detection scripts, but does not defeat Cloudflare, CAPTCHA, or
any real bot-detection service -- i.e., state what it actually does and what it does not do,
instead of asserting it does nothing detection-relevant at all.

Four more minor gaps logged (GAP-102..105): a wider set of stale stealth claims than the
Executor's grep caught (PROJECT_DEEP_DIVE.md's own §11.1 describes a whole working anti-detection
engine, missed); no test guards the README's 4th spot; several new tests are weak/vacuous; a
gitignored stale local dist/ still locally re-exposes the deleted class through a wildcard export
(doesn't affect the published tarball, confirmed separately).

Also: GAP-106 (new) confirms GAP-100's flagged concern was real, not theoretical -- the shared
baseline-*.json files visibly changed mid-audit while two unrelated items' agents ran
concurrently in the same worktree. Standing rule adopted now: scenario-suite baseline files are
regenerated and committed only as part of the loop's own final full-repo gate (§9), never as a
side effect of an individual item's live-verify run. Neither FR2-01's nor FR2-16's commit
includes them; this is intentional going forward, not an oversight to fix per-item.

FR2-16 moves to FIX(2). Not an escalation (this is a normal fix cycle after a normal audit-1
FAIL, only FR2-01 is in the escalation track).

## 2026-09-25 -- FR2-01 audit-5: FAILED -- engine fix confirmed correct, but pattern survives one layer up. FINAL escalation cycle (2/2) now in progress.

A fresh, independent Opus Auditor re-ran everything from fix-4 (tsc, vitest 405/405, build,
two live-Chrome runs, 4 reproduced mutations + 3 of its own) and CONFIRMED the core engine-level
tri-state fix is real: isHandleVisible, waitForHiddenInAllFrames, diagnoseSelectorVisibility's
per-frame timeout handling, countOtherVisibleMatches' timeout handling, and the 9th
checkWaitForSelectorOnce site all now correctly distinguish confirmed-no from unknown WITHIN
browser-action-engine.ts, as fix-4 claimed. GAP-081..088 (+099) are marked CONFIRMED FIXED.

But the auditor found the SAME shape of bug in three places fix-4's inventory never reached,
because that inventory was scoped only to browser-action-engine.ts and never traced up through
the layers that consume its output:
1. GAP-111 (major): packages/mcp-server/src/tools.ts:49's hint-matching rule appends "Hint: The
   element is still visible." to ANY error containing "waiting for state=hidden" -- including
   fix-4's own new, honest "could not verify: one or more frames were unresponsive" message. The
   MCP layer directly contradicts the engine layer's now-correct uncertainty.
2. GAP-112 (major): diagnoseSelectorVisibility swallows a per-frame error into null, and the
   caller renders that as "No element found for selector" for an element that DEMONSTRABLY
   EXISTS (live-reproduced). This is the exact same "error must default to unknown" rule fix-4
   applied correctly elsewhere in the same file, just not here -- despite fix-4's own inventory
   calling this function's behavior "unsafe" in its own notes without following through on the
   fix.
3. GAP-113 (major): countOtherVisibleMatches treats a per-frame THROWN ERROR (as opposed to a
   timeout, which fix-4 did fix) as a confirmed zero, silently dropping the otherVisibleMatches
   advisory with false confidence.

Plus 3 more minor gaps (GAP-114 overly-broad fatal-error classification on frame detach;
GAP-115 missing test coverage for the attached-state mutation; GAP-116 process gap in fix-4's own
inventory methodology) and one loop-wide process note (GAP-117: .gitignore's blanket *.log rule
means no round's raw command-output evidence is ever actually committed to git, only described
in reports -- a standing convention gap worth a future decision, not specific to this item).

**This consumes escalation bonus cycle 2 of 2 -- the loop's own final allowed cycle for this
item (§9).** Per the loop's stated bound, if THIS cycle still finds a new instance of the
timeout/error-as-false-boolean pattern anywhere in the wait_for_selector path (engine through
MCP/CLI/SDK), FR2-01 must be marked BLOCKED with a full written diagnosis, and the loop moves on
to other items rather than issuing a 6th open-ended attempt. The audit's own recommendation, which
this dispatch adopts directly: the fix is narrow (stop the MCP hint rule from firing on a
"could not verify" message; apply the SAME unknown-not-no-match discipline to
diagnoseSelectorVisibility's and countOtherVisibleMatches' per-frame ERROR paths, matching what
fix-4 already did for their TIMEOUT paths), and the next inventory must explicitly trace from the
MCP/CLI/SDK surfaces DOWN through the engine, not stop at the engine file boundary the way fix-4's
did.

## 2026-09-25 -- FR2-16 audit-2: FAILED again -- fixed one half of the dishonest claim, left the other half standing (and backwards)

fix-2 correctly added the honest "hides navigator.webdriver" sentence, but left (or in two spots,
reinforced) the ORIGINAL false claim right next to it: that --disable-blink-features=
AutomationControlled is "a Chrome-recommended stability flag" and the webdriver change is a mere
"side effect". Audit-2 proved this backwards with sources: Chromium's own bad_flags_prompt.cc
lists this flag as unsupported/bad for end users (not a stability recommendation), a live headed
launch with the flag still shows Chrome's own automation-controlled banner, and puppeteer-core's
defaults don't include it. Hiding navigator.webdriver is not a side effect -- it is the flag's
only real effect. This is the second time this item's own honesty wording has itself needed
correcting, in two different specific ways -- the loop's insistence on independent re-verification
(never trusting a self-report) is exactly what caught both.

Decision: delete the "stability flag" framing entirely from all three locations (README,
browser-options.ts comment, PROJECT_DEEP_DIVE.md), state plainly there is exactly one reason the
flag is kept (hides navigator.webdriver from simple checks), and don't invent a second
justification that isn't true. Also fix the newly-caught PROJECT_DEEP_DIVE.md:48/872 regression
(silently reintroduced "plain, undisguised browser" phrasing that now contradicts its own next
sentence) and the wider stale-claim surface audit-2 found (SECURITY.md, competitive-benchmarks.md
-- the latter is a fairness issue for this project's own benchmark claims against pinchtab, not
just a wording nit).

Also strengthen doc-static's checks per GAP-120: it currently only checks for the PRESENCE of the
correct sentence, not the ABSENCE of a re-added false one -- add an explicit negative check for
"stability flag"/"stability reason"/similar phrasing so a future regression like this one is
caught by CI, not just by a human/auditor rereading the prose.

FR2-16 moves to fix-3 (its 3rd fix cycle; still well within the loop's normal 4-cycle bound,
no escalation needed here -- FR2-01 is the only item currently in the escalation track).

## 2026-09-25 -- FR2-01 fix-5: final escalation cycle (2/2), outside-in inventory closes the layer audit-5 found

Executor's inventory this time traced DOWN from all three user-facing surfaces (MCP tool, CLI
verb, SDK method) into the engine, rather than starting from the engine file the way fix-4 did --
exactly the methodology change audit-5 recommended. This independently rediscovered the same 3
sites audit-5 named (MCP's ERROR_HINTS, diagnoseSelectorVisibility, countOtherVisibleMatches)
without having read audit-5 first, which is meaningful corroboration that the outside-in approach
itself was the missing piece, not luck. The CLI and SDK surfaces, once actually read (not
assumed clean), forward errors verbatim with no hint/rewrite logic of their own -- confirmed,
not guessed.

Fixes: GAP-111 (MCP hint no longer fires when the underlying message says "could not verify" --
falls through to a generic non-committal hint instead of a contradicting confident claim);
GAP-112 and GAP-113 (both functions now fold a genuine thrown per-frame error into the same
"unconfirmed" bucket their timeout case already used, rather than treating a thrown error
differently from a timeout -- closing the exact asymmetry audit-5 found). GAP-115 (attached-state
mutation test added). GAP-114 deliberately NOT fixed -- it's a real, live-reproduced robustness
gap (17/30 hard failures when a cross-origin iframe detaches mid-probe), but it is not a
false-positive/negative instance of THIS pattern (no false success/failure observed, 0/30), so
leaving it open does not violate the escalation's own retry-bound condition. This was the
Executor's own judgment call, made explicitly rather than silently, and is Orchestrator-endorsed:
correctly distinguishing "a different, real bug" from "the specific pattern this escalation
exists to close" is exactly the discipline this loop has been asking for throughout.

Fresh verification: tsc clean x5, vitest 412/412, real build x2, live-verify 48/48 x2 against
real Chrome (with the CLI Chrome-process leak cleaned up by the Executor itself both times,
rather than left to pollute overallOk the way it did in audit-5's own runs). Live-reproduced all
3 of audit-5's exact probe scenarios (adapted probe-a5.mjs) and confirmed each surface now gives
the honest result. Mutation-and-revert proof for all 3 fixes, sha256-confirmed clean revert.

**This was the loop's own final allowed escalation cycle (2/2) for this item.** The next and
last step, per the loop's own stated bound: dispatch audit-6, a fresh, maximally skeptical Opus
Auditor. If audit-6 finds ANY new instance of the same shape of bug anywhere in the
wait_for_selector path, FR2-01 must be marked BLOCKED with a full written diagnosis -- there is
no cycle after audit-6. If audit-6 passes, FR2-01 moves to DONE, becoming the loop's first
completed item, unblocking FR2-02 and FR2-03 for DEVELOP.

## 2026-09-25 -- FR2-16 audit-3: FAILED a third time -- the same false claim found in a 4th spot, this time in code THIS item itself wrote

Everything mechanical (typecheck, tests, build, the doc/wording checks that DID run) passed
again. But a 4th location was found: browser-launcher.ts:110-111, whose comment text was itself
WRITTEN by fix-1 (as a replacement for the old "stealth evasion flags" wording) and still calls
DEFAULT_LAUNCH_ARGS "the stability flags that are always included" -- restating the exact false
claim this item exists to remove, in code its own earlier fix round produced. This was missed
purely because the guard scripts' file scope (README.md, browser-options.ts, PROJECT_DEEP_DIVE.md
only) never included browser-launcher.ts.

The auditor also found the guard itself is fragile in ways that matter more than this specific
miss: the regex is beaten by a line break (the shipped PROJECT_DEEP_DIVE.md already has "not a
stability<newline>flag" -- true, but proves the check doesn't collapse whitespace before
matching), and it has literally ZERO regression coverage for the GAP-119 SECURITY.md/
competitive-benchmarks.md fixes, plus several equally-false synonym rewordings would all slip
past silently.

Decision for fix-4: stop treating this as "find the next missed file" and instead fix the CLASS
of problem -- the check has failed to be the safety net it was built as three audits running.
Fix-4 must: (1) fix GAP-122 in browser-launcher.ts; (2) rebuild the guard checks to scan a
complete, explicit file list covering every location any of GAP-101/118/122 have ever been found
(README.md, browser-options.ts, browser-launcher.ts, PROJECT_DEEP_DIVE.md, SECURITY.md,
competitive-benchmarks.md, package.json, root README.md, docs/ARCHITECTURE.md, AGENT_SETUP.md,
cli.ts) rather than a hand-picked subset; (3) collapse whitespace before matching; (4) broaden the
pattern to catch the demonstrated synonym family (stability/compatibility/reliable/"prevent
launch failures"/"side effect" framing), not just the literal phrase "stability flag". GAP-125/126
(minor, --disable-infobars omission and the benchmark-fairness understatement) fixed opportunistically
if time allows, not blocking.

This is FR2-16's 3rd audit failure (fix-4 is its 4th cycle) -- still within the loop's normal
4-cycle bound (no escalation needed yet), but this is the LAST normal cycle before an audit
failure here would trigger the same Orchestrator-supervised escalation track FR2-01 is on. The
Orchestrator is treating this seriously: the next Executor brief for fix-4 is written with that
in mind, requiring a genuinely different (broader, more mechanical, less pattern-matching-by-hand)
approach to the guard rather than another manual game of whack-a-mole with individual sentences.

## 2026-09-25 -- FR2-16 audit-4: FAILED a 4th time -- pattern-matching approach itself is the problem, plus a genuine self-flattering benchmark bug found

fix-4's rebuilt guard (shared module, 11-file list, whitespace collapse, 7-pattern family,
negation-lookback) still failed comprehensively: 0 of 19 new synonym mutations were caught,
including all 4 the Orchestrator's OWN dispatch brief handed the Executor verbatim as examples
to guard against ("chosen for compatibility reasons", "improves reliability", "necessary for
consistent behavior", a claim split across two sentences). The negation-lookback meant to prevent
false positives on this item's own honest negation sentences is itself exploitable in both
directions (a real false claim can hide near an unrelated negation word; a genuinely honest
sentence can be mis-flagged because "not" can't regex-match inside "doesn't"). This confirms
what audit-3 already suspected: hand-written deny-list pattern matching is structurally the
wrong tool for this job, no matter how many patterns get added -- the fix needs a different
SHAPE of check, not a bigger list.

**Adopted for the escalation, per the auditor's own suggested redesign**: switch from a deny-list
(flag known-false phrasings) to an ALLOW-list (every sentence in the checked files that mentions
the flag/webdriver/stealth/detection must match one of a small set of pre-approved, Orchestrator-
reviewed honest sentences; anything else fails closed). This inverts the failure mode: instead of
"a new false phrasing slips through because it wasn't on the deny-list," a future edit that isn't
pre-approved FAILS LOUDLY and forces a human/Orchestrator review, rather than silently passing.
This is a more invasive rewrite of the checked files (every relevant sentence must be rewritten to
match one canonical form) but is the only design that structurally closes this failure mode rather
than adding a 20th pattern to a list that's already failed at 7.

**Also found, independently valuable regardless of FR2-16's own fate**: GAP-127, a genuine,
undisclosed detection-asymmetry in THIS PROJECT'S OWN competitive-benchmarks.md. The headline
claim "Sutradhar 29/47 beats Playwright 27/47 and Puppeteer 25/47" with "no stealth on any side"
was measured with Sutradhar's own retained flag giving it navigator.webdriver=false while the
competitors, launched plainly, showed true -- an undisclosed advantage in Sutradhar's own favor,
live-verified. This directly contradicts the corrected passage fix-4 wrote elsewhere in the SAME
file just one fix cycle ago. This is arguably a MORE serious finding than FR2-16's original scope
(a stale/dead-code cleanup item) because it touches this loop's own claimed benchmark integrity --
logged prominently, and the Orchestrator will fold its correction into FR2-16's escalated scope
rather than treating it as a separate item, since it's the same underlying dishonesty-about-
detection-asymmetry category this whole item exists to fix.

**This is FR2-16's 4th audit failure -- it now moves to the SAME Orchestrator-supervised
escalation track FR2-01 is on** (bonus cycle 1 of 2, per the loop's own retry-bound rule). If the
next audit (audit-5) still finds a new instance, one more escalation cycle remains before FR2-16
must be marked BLOCKED, exactly mirroring FR2-01's situation. Two items are now simultaneously in
the escalation track -- both on the same underlying lesson: an ad-hoc, incrementally-patched
guard/check will keep failing against a determined-enough set of rewordings; only a structural
redesign (tri-state propagation for FR2-01, allow-list for FR2-16) actually closes the class of bug.

## 2026-09-25 -- FR2-01 marked BLOCKED: 6 audits, 5 fix cycles, both escalation cycles exhausted. Full diagnosis.

**Verdict: BLOCKED, per the loop's own stated retry bound (CLAUDE.md/§9): 4 standard FIX->AUDIT
cycles, then at most 2 Orchestrator-supervised escalation cycles, then BLOCKED with a full
diagnosis if the pattern still recurs.** Audit-6 (the final allowed audit, evaluating fix-5,
the second and last escalation cycle) found THREE new instances of the exact same recurring bug
shape that has now been found in 6 consecutive independent audits, each in a location none of
the prior 5 rounds examined:

- **GAP-132 (critical): a hidden wait reports FALSE SUCCESS when the tab closes mid-wait.**
  `pierceFirstMatch` and `isHandleVisible` both classify "Execution context was destroyed" (a
  tab-close signal) as a harmless same-tab navigation, collapsing it to "no match"/"not visible"
  instead of "unknown" -- so a wait for an element to become HIDDEN reports SUCCESS the instant
  the tab closes, even though the element never actually hid. This is the single worst-case
  version of this whole bug family: it is user-visible, it is a false SUCCESS (not just a
  confusing error message), and it is the SAME underlying mistake as the very first gap found in
  this item, GAP-031, six rounds ago -- surviving because each round's fix targeted the specific
  named symptom rather than the general "is this error classification safe under EVERY way a
  frame/tab can stop responding" question.
- **GAP-133 (major): a visible-wait timeout falsely claims "none is visible" when a match exists
  in a frame that never answered.** fix-4's fix for this class of message only covered the
  all-frames-unanswered case; the partial case (some frames answer, one doesn't) was never
  tested.
- **GAP-134 (major): MCP's "still visible" hint still fires on hidden-wait failures fix-5 didn't
  anticipate**, because its exclusion list matched only the exact phrases "could not verify"/
  "could not determine" rather than the full space of the engine's failure messages.

**Root-cause assessment, stated honestly rather than glossed over**: this is not a case of
"almost done, one more gap." Six independent audits, using increasingly rigorous methodologies
(fix-3's shared tri-state type, fix-4's inventory-first discipline, fix-5's outside-in
MCP/CLI/SDK trace) have each closed the specific instances they found while a structurally
identical bug persisted in an unexamined corner. GAP-137 names this directly: the manual,
however-improved-each-time inventory approach appears to have a structural ceiling for a
function this size and a bug shape this easy to reintroduce accidentally (any new per-frame
check that doesn't use the shared verdict type is a candidate). A 7th round chasing the same
approach is not expected to behave differently in kind, only in which specific site it finds --
which is exactly the pattern that triggered this escalation in the first place.

**What IS genuinely solid, stated for the record so it isn't lost**: the shared
`FrameProbeVerdict`/`HandleVisibilityVerdict` tri-state TYPE itself, introduced in fix-3 and
extended in fix-4/fix-5, is a real, correct architectural improvement -- every site that uses it
correctly distinguishes confirmed-no from unknown. The bug is never "the tri-state type is
wrong"; it's always "a function that hasn't been migrated to use it yet, or a new call site that
bypasses it." 412/412 tests pass; 48/48 live scenarios pass; the specific named gaps from every
prior round remain genuinely fixed (audit-6 confirmed GAP-111/112/113 hold under harder variants:
two simultaneous busy frames, a busy main frame, and delayed-throw timing).

**Recommendation for whoever picks this up next** (not attempted now -- this is the diagnosis,
not a 7th fix cycle, per the loop's own rule that BLOCKED means stop and move on, not stop and
immediately retry): the fix likely needs a MECHANICAL guarantee rather than another manual
inventory -- e.g. a lint rule or a runtime assertion that flags any `catch` block in this file
that doesn't route through the shared verdict type, so a missed site fails a build/test rather
than requiring a human (or agent) to have thought to check that exact function. GAP-132
specifically needs the "is this tab-closing vs. same-tab-navigating" distinction made
structurally reliable (e.g. checking `page.isClosed()` synchronously at the moment of the catch,
not just at the start of the next poll), since string-matching an error message ("Execution
context was destroyed") can't reliably distinguish the two cases that produced this exact
instance of the bug twice now (GAP-031, then GAP-132).

**Downstream impact, assessed now rather than left implicit**: per the ledger's own recorded
dependencies, FR2-03 ("waits for FR2-01 DONE" -- hard) and FR2-15 ("HARD-blocked: needs
FR2-01..FR2-14 all DONE") cannot proceed to DEVELOP while FR2-01 is BLOCKED; both are marked
BLOCKED-BY-DEPENDENCY below, not attempted. FR2-02, FR2-04-08, FR2-11-14 have softer or
timing-only dependencies on FR2-01 and are NOT hard-gated on its DONE status specifically (their
own recorded dependencies are on OTHER items, or on FR2-01 reaching a stable state short of full
DONE) -- these remain eligible for DEVELOP once their own stated prerequisites are met, unaffected
by this block. **FR2-09 and FR2-10 have no dependency on FR2-01 at all** ("no hard precondition")
and are immediately eligible for DEVELOP now -- the Orchestrator is moving to these next rather
than stalling on FR2-01's block, per this project's own standing "don't stop, find the next real
task" directive.

Per the loop's exit conditions (§9), a BLOCKED item is a real, documented outcome, not a failure
of the loop itself -- "target zero BLOCKED" is a target, and this diagnosis is what happens when
that target isn't met for a specific item: full honesty about why, not a forced fake DONE.

## 2026-09-25 -- FR2-16 marked BLOCKED: 5 audits, 4 fix cycles, both escalation cycles exhausted. Full diagnosis.

**Verdict: BLOCKED, per the loop's own stated retry bound** -- the same bound FR2-01 was just
marked BLOCKED under. audit-5 (evaluating fix-5's allow-list redesign, the second and final
escalation cycle) proved the new mechanism is bypassable 102 of 118 ways tried:
- **GAP-138 (major)**: the allow-list only INSPECTS text containing one of ~11 trigger words --
  anything else (e.g. "undetectable", "evades anti-bot systems", "reCAPTCHA"/"hCaptcha" via a
  word-boundary miss) is never checked at all, in either direction.
- **GAP-139/140 (major)**: the "narrative" exemption meant to let honest factual reporting (a
  date, a score, a domain name) through is itself an open-ended, gameable vocabulary -- a false
  claim wrapped near a date or score slips past ANYWHERE in a file, not just at the edges fix-5
  disclosed. Measured blind-zone coverage: 35.9%-76.1% of the checked files' text sits where any
  trigger word auto-passes with zero template check. GAP-127's own reversed claim ("the
  comparison is fully symmetric, no masking advantage") -- the exact false claim this whole
  escalation cycle was fixing -- passes at every position tested in both benchmark files.
- **GAP-141/142 (minor)**: the flag+reason closed vocabulary misses common synonyms
  (resilient/durable/crash/safety); sibling flags aren't defended; and the 12-file list is STILL
  incomplete -- a 3rd occurrence of the exact failure mode that caused GAP-122 (4th missed
  location) and GAP-127 (missed 12th file): two more files
  (tools/engine-comparison/extreme-scenarios-comparison-2026-08-16.md,
  results-refresh-2026-08-18.md) make the same undisclosed claim, undetected.

**Root-cause assessment, the auditor's own words, endorsed**: "a regex classifier can't enforce
honesty in free prose... A closed design would require every sentence inside fenced,
marker-delimited boundary regions to be a template, and ban topic prose everywhere else. The
alternative is to treat this as something humans review, not a CI check." This is accepted as
correct. The deny-list (rounds 1-4) failed because the space of false phrasings is unbounded; the
allow-list (round 5) failed for the mirror-image reason -- the space of what counts as
"legitimately unrelated narrative text" is ALSO unbounded, and any exemption wide enough to avoid
false-positiving on this project's own honest benchmark prose is wide enough to smuggle a false
claim through it. Both failure modes are two sides of the same problem: a project's ongoing
honesty about a nuanced technical boundary is not, in the general case, mechanically verifiable
by pattern matching against free-form prose. This is a genuine, structural finding, not a
process failure -- 9 rounds of increasingly sophisticated attempts (4 deny-list patches, 1
allow-list redesign) converged on the same conclusion an experienced reviewer would likely have
reached faster: this needs a human or Orchestrator reading the actual sentence, every time it
changes, not an automated gate.

**What is NOT blocked, and is being committed now**: the CORE substantive deliverable this item
was originally scoped for (loop-prompt §4.1: "no stealth opt-in... deliver only the doc/honesty
part") is genuinely done and audit-confirmed accurate:
- `enableStealth`/`StealthEngine` and all 4 dead-code files are removed (audit-1 through audit-5
  each independently re-confirmed zero live consumers, zero stale exports, including through the
  package's wildcard subpath).
- The Cloudflare/CAPTCHA boundary is stated in `--help` and `AGENT_SETUP.md`.
- The original README contradiction (and 3 more spots like it the sweep found) are fixed.
- The GAP-127 benchmark-asymmetry disclosure is present and live-verified accurate at all 5
  locations audit-5 checked (audit-5 found NO false claim in the CURRENT committed-would-be
  content itself -- every bypass it found is a hypothetical FUTURE regression the guard fails to
  catch, not a live inaccuracy today).

**What IS blocked**: the mechanical, CI-enforced GUARANTEE that a future edit can't quietly
reintroduce a false claim. That guarantee cannot be delivered by a regex/allow-list checker, full
stop -- proven, not merely suspected, across 9 rounds.

**Disposition, decided now rather than left ambiguous**: commit the substantive, audited-accurate
doc/code fixes (they are real, correct, and independently re-verified 5 times over). Keep the
allow-list checker as a clearly-labeled BEST-EFFORT regression guard against the 21 SPECIFIC
bypasses already discovered (it does catch those reliably) -- with a prominent header comment
added directly to the script stating it is not a guarantee and naming GAP-138/139/140 by number,
so a future reader never mistakes a green run for certified honesty. The previously-tautological
mutation-suite assertion was fixed to a real count check, and its 2 known-uncatchable cases are
now explicitly marked as disclosed, non-build-breaking gaps rather than silently passing or
failing the suite. GAP-138/139/140/141/142 remain open, logged, unresolved -- NOT attempted
further, per the loop's own "BLOCKED means stop, don't keep chasing" rule. GAP-143 (the
tautology / suite-never-wired-to-CI) is fixed as part of landing this honestly rather than left
as a loose end in a blocked item's final commit.

**Two items are now BLOCKED in this loop** (FR2-01, FR2-16), both having exhausted the full
4-standard + 2-escalation cycle budget, both with root causes that point at the SAME meta-lesson:
an ad-hoc, incrementally-patched safety net (a manual code inventory; a regex claim-checker)
degrades gracefully round to round but never actually reaches "closed" for a problem whose real
solution needs a different category of tool (a structural/mechanical guarantee for FR2-01's
case; human review for FR2-16's case) rather than a bigger version of the same kind of check.
This is recorded prominently because it's the single most transferable finding of the entire
loop so far, more valuable than either item's specific bug list.

## 2026-09-25 -- FR2-09 audit-1: FAILED -- code is genuinely correct, but a Done-when bullet was skipped and one test makes a false coverage claim

The independent Auditor's own live run (54 checks, including several adversarial angles the
Executor's own live-verify didn't cover -- mid-scrape frame navigation, id-collision safety
across 5 frames plus shadow roots, 3-level nested iframe indentation in ax_snapshot) found the
actual label logic, timeouts, and placeholder behavior all correct: 51/54 passed, and the 3
that didn't were explained (one observer timeout in the auditor's own harness, re-confirmed
correct via a simpler repro).

The FAIL is about process, not the feature: Done-when bullet 5 (a <=10% token-size regression
gate on existing fixtures) was never measured by the Executor at all -- no token-size.md, no
number cited anywhere in run-1's evidence. The Auditor measured it independently: 7 of 9
existing fixtures are byte-identical (good), grounding-completeness grows a tolerable 7.9%, but
nested-shadow-in-iframe grows +56.4% -- well over the stated 10% ceiling, driven mostly by an
~80-character file:// URL now appearing in that fixture's snapshot output. The spec's own
section 5.7 anticipates exactly this outcome and names 3 remedy options for the Orchestrator to
choose among; that decision was never made because the measurement that would have triggered it
was never taken.

Separately and more concerning as a PATTERN (not a one-off): a unit test (U10) was found hollow
-- its title promises shadow-chain assertions at three specific depths, but its body only checks
that a snippet of code parses, and its own comment cites a live-verify file
(tools/scenario-suite/verify-fr2-09-frames.mjs) that doesn't exist anywhere in the repo. This is
explicitly named by the Auditor as "the same kind of false claim that failed the FR2-16 audits"
-- a test or comment asserting coverage it doesn't actually provide. Given FR2-16 needed 5
rounds specifically because self-reported claims kept turning out to be inaccurate on close
inspection, this is flagged here as a THIRD occurrence of the same meta-pattern (FR2-01's
"cited stale ci-gate results" GAP-060, FR2-16's various miscounts, now FR2-09's phantom file
citation) -- worth the Orchestrator's standing attention across every remaining item's Executor
briefs, not just this one's fix cycle.

FR2-09 moves to fix-1 (its first fix cycle; nowhere near the retry bound). The fix brief must:
(1) actually run the token-size measurement and either bring nested-shadow-in-iframe under 10%
or make the explicit Orchestrator-endorsed remedy choice per spec section 5.7; (2) replace U10
with a real test that asserts what its title claims, and either write the missing
verify-fr2-09-frames.mjs live-verify script or remove the false citation; (3) fix GAP-146
(one-line: sanitize frame names in ax_snapshot too) and record the GAP-147 D8-fork decision in
decisions.md as the spec's own process requires; (4) recreate the missing spec deliverables
(fr2-09-*.html fixtures, golden-pre.txt, step0-matrix.json) that run-1 apparently never produced
or saved; (5) save evidence as non-gitignored files (the .gitignore's blanket *.log rule, already
flagged loop-wide as GAP-117, bit this round too -- use .txt/.json/.md extensions for anything
that needs to be committed, matching the pattern the Auditor itself used).

Not a defect: GAP-148 (busy same-origin iframe leaves the snapshot unbounded) is confirmed
genuinely in-scope-excluded, matching the Executor's own honest account from run-1 -- logged to
the backlog, not chased in this fix cycle.

## 2026-09-25 — FR2-09 fix-1: GAP-147 D8 fork decision recorded

Confirming the fork the spec's D8 (section 0.1) anticipates, using audit-1's own live evidence
(`evidence/FR2-09/audit-1/live-audit.txt` and `live-audit-run2.txt`): for the X-Frame-Options
`DENY` frame (`name="deny"`), Puppeteer's `frame.url()` reports `chrome-error://chromewebdata/`,
**not** the real origin — confirmed identically across both audit-1 runs
(`S1v skippedFrames has deny error-page :: [{"url":"chrome-error://chromewebdata/", "origin":
"chrome-error://", "name":"deny", "reason":"error-page"}]`).

**Second, decisive piece of evidence**: the auditor's own "truth frames" probe (a separate
observer connection independently attempting `frame.evaluate(() => ...)` against the same
blocked frame for ground truth) recorded `{"name":"deny","url":"chrome-error://chromewebdata/",
"err":"Timed out after waiting 30000ms","ids":[]}` — an `evaluate()` call against an
X-Frame-Options-blocked frame does not fail fast, it **hangs for the full 30s default protocol
timeout**. This directly answers what D8's fork test asks: adding a bounded extra
`frame.evaluate(() => location.href)` retry for a 0-node child frame, hoping to recover the
real origin when `frame.url()` doesn't have it, would not "add one bounded extra evaluate" in
practice — a blocked frame's script realm appears to be unresponsive to `evaluate()` entirely,
not merely slow, so the call would either hang until FR2-09's own `FRAME_SCRAPE_TIMEOUT_MS`
(5000ms, D7) or, if run outside that budget, drag in a 30s stall — directly undermining D7's own
purpose (bounding a child frame's cost). It would not recover the real origin at all; it would
just add latency to every X-Frame-Options-denied frame this snapshot ever encounters.

**Decision: keep the current behavior (no extra probe added).** The shipped code's
`frame.url().startsWith('chrome-error://')` check (dom-semantic-engine.ts's `buildGraph`, D8)
and `frameOrigin`'s `chrome-error://*` D5 rule are the correct, intended fork for what Step 0
actually observed — origin reported as `chrome-error://` rather than the real site is NOT a
bug, it is Puppeteer's genuine, unavoidable behavior for this class of frame, and attempting to
work around it would cost 30s of hang for zero identifying benefit.

**The spec's own worked example** (section 2.5's table row, "Skipped: error page ... an
X-Frame-Options-denied frame ... `[iframe http://localhost:5173 — not inspectable]`") is
therefore acknowledged as **aspirational, not normative** — it predates the live Step-0
confirmation this fix cycle ran, and D8's own fork-decision text (not the worked example) is
the authoritative instruction. GAP-147 is closed as "confirmed correct fork", not as a defect.

**The residual limitation GAP-147 also names — an unnamed X-Frame-Options-blocked frame's
placeholder doesn't identify which frame it is (only `chrome-error://`, no name, no real
origin, no distinguishing URL)** — is real and is **not fixed** in this cycle: there is no
available signal from outside the frame (per the evaluate-hangs evidence above) to identify it
beyond its snapshot-local index, which the placeholder line already omits by design (D6's
placeholder format has no index shown for a non-`frame-limit` reason; only `name`+`origin`).
Logged to `.ai/known-problems.md` as a genuine, disclosed, in-scope-excluded gap (an unnamed
XFO-blocked frame is unidentifiable beyond its position in the listing) rather than silently
left undocumented — this is the kind of honest disclosure the loop's own "never hide a
limitation" rule requires, distinct from GAP-148 (already logged, same treatment) which was a
different frame class (busy same-origin, not XFO-blocked).

### CORRECTION (2026-09-25, FR2-09 fix-2, GAP-150) — the residual-limitation paragraph above is wrong

FR2-09 audit-2 (GAP-150) found the paragraph directly above this one — "there is no available
signal from outside the frame ... to identify it beyond its snapshot-local index" — is FALSE,
not merely incomplete. `frame.frameElement()`, called on the frame object but evaluated in the
**parent** frame's realm (it never touches the blocked frame's own inaccessible realm at all),
resolves the `<iframe>` element handle sitting in the parent document; reading `.src` off that
handle recovers the real, intended URL. This is a fundamentally different operation from the
`frame.evaluate(() => location.href)` probe this same decision correctly rejected above — that
probe runs INSIDE the blocked frame's own script realm (hence the 30s hang); `frameElement()`
never crosses into it. Audit-2 live-measured the recovery at 2-5ms per frame
(`evidence/FR2-09/audit-2/adversarial-live.json`, case E) — negligible next to the 5000ms
`FRAME_SCRAPE_TIMEOUT_MS` budget this decision was protecting.

**What was correct in the original decision, and stays correct**: the choice to keep
`frame.url().startsWith('chrome-error://')` as the D8 fork condition itself (i.e. detecting that
a child frame resolved to a browser error page) — that's unaffected by this correction, and no
extra `evaluate()`-based probe was or is warranted for that detection. Only the claim that the
frame's *identity* can't be recovered was wrong.

**Orchestrator-preferred fix-2 resolution (see the FR2-09 audit-2 entry below)**: add the
`frameElement()` lookup rather than just correct this text, since it's cheap and also satisfies
spec section 2.5's worked-example placeholder format (`[iframe http://localhost:5173 — not
inspectable]`) as literally written — which the "aspirational, not normative" framing two
paragraphs up should also be read as narrowed by this correction: the worked example's URL is
now actually achievable for the common case (frame not yet detached, real `<iframe>` element,
not a popup), just not universally guaranteed. Implemented in
`packages/browser/src/dom/dom-semantic-engine.ts` (`recoverBlockedFrameSrc()`), live-verified in
`evidence/FR2-09/fix-2/gap150-live-verify.txt`. `.ai/known-problems.md`'s `PROB-046` entry is
updated to match — RESOLVED, with the corrected history stated explicitly rather than the false
claim silently removed, and the genuinely-real narrower residual case (popup / already-detached
frame, where no parent-document element exists to read `.src` from) stated honestly in its
place.

## 2026-09-25 — FR2-09 fix-1: GAP-144 token-size remedy chosen (option iii, with option i applied first)

Re-ran audit-1's own measurement methodology live against the post-fix build (real Chrome,
real `SutradharRuntime`): 7/9 gate fixtures byte-identical, `grounding-completeness.html` a
tolerable +7.89%, and `nested-shadow-in-iframe.html` reproducing audit-1's finding exactly at
+56.39% (over spec section 5.7's 10% ceiling), driven mostly by an ~80-character `file://`
absolute path.

**Applied spec option (i) first** (shorten `file:` display to the file name only, but only
once the full path would need truncation anyway — every short `file://` URL, including every
existing pinned unit test, is unaffected). This is a real, measured, unconditional
improvement: `nested-shadow-in-iframe.html`'s delta drops from +56.39% to +44.24%, verified
live before and after. It ships regardless of the remaining decision below, since it reduces
real overhead for any page with a long local `file://` frame URL.

**Chose option (iii) for the remainder**: `nested-shadow-in-iframe.html` is accepted as
exceeding the 10% gate, not chased further. Hand-computed from the real post-remedy listing
that even fully dropping the URL (option ii) would only bring it to ~30.2% — the irreducible
cost is the frame+shadow designators themselves (~100 characters with zero URL at all) against
a 321-character baseline where BOTH of the fixture's 2 interactive elements are maximally
decorated (iframe AND shadow simultaneously, by construction, to exercise that exact
mechanism). This is exactly the case spec section 5.7 names as its own justification for
option (iii): "an iframe with a single element is an inherently label-dense extreme." Full
reasoning, both rounds of real numbers, and the option-(ii) hypothetical calculation are in
`.ai/loop/field-report-2/evidence/FR2-09/fix-1/token-size-decision.md`; the full 9-fixture
table is in `token-size.md` in the same directory.

No gate assertion was loosened to make this pass — the live-verify plan's assertion stays
"≤10% or a documented exception," and this is that one named, measured, reasoned exception.

## 2026-09-25 -- FR2-09 audit-2: FAILED narrowly -- feature and token-size decision both confirmed genuinely correct; two test/justification integrity gaps remain

The independent Auditor re-measured the token-size regression against a TRUE pre-change baseline
(the main checkout's own compiled output, not a stripped reconstruction of the after-state as
both prior rounds had used) and confirmed fix-1's +44.24% number is real and arithmetically
correct, that no better mitigation exists without breaking the spec's own required label format,
and that spec section 5.7 explicitly anticipates and allows exactly this outcome as option (iii).
**Orchestrator sign-off, given now as the spec requires**: fix-1's decision to accept
nested-shadow-in-iframe.html's +44.24% token-size growth as a documented exception is APPROVED --
the fixture is genuinely an "inherently label-dense extreme" per the spec's own framing, and
forcing it under 10% would require breaking the frame/shadow label format this whole item exists
to add. The U10 test replacement and the underlying feature code were also independently
confirmed correct (the auditor reverted the closure-bug fix and reproduced the claimed infinite
loop; reverted the shadow-chain ordering and confirmed the new U10 catches it).

The FAIL is narrow and is, notably, the SAME meta-pattern flagged after audit-1 recurring a
second time within this one item: GAP-149 -- the regression test fix-1 wrote for GAP-146 only
exercises a case the UNFIXED code also happens to pass by coincidence (reverting the fix, all 13
tests still pass), so it provides zero actual protection despite reading as a real regression
test. This is now the FOURTH time in this loop that a test or comment has been found to claim
coverage it doesn't provide (FR2-01's stale ci-gate citations, FR2-16's miscounts, FR2-09's own
U10 in round 1, now this). It is being treated as a standing, cross-item risk, not a fluke: every
remaining Executor brief in this loop should include an explicit instruction to verify a new
regression test by reverting the fix in a scratch copy and confirming the test actually fails,
not merely writing a test that reads correctly.

Also found: GAP-150, a genuinely false justification (not just an omission) -- fix-1's PROB-046
entry claims a blocked frame's identity "can't be recovered from outside the frame" and calls the
spec's own worked example "aspirational," when in fact `frame.frameElement()` recovers it from
the parent page in 2-5ms without touching the blocked frame at all. The underlying behavioral
choice (the chrome-error:// branch) is correctly spec-compliant; only the stated REASON for not
fixing the residual limitation is wrong.

fix-2 scope, narrow and bounded: replace the GAP-146 test case with one that actually catches the
bug (audit-2 already designed and verified one: a single unique name sanitizing changes); correct
the PROB-046/D8 text or add the parent-side `frameElement()` lookup (Orchestrator's preference:
add the lookup, since audit-2 confirmed it also satisfies spec P1 as written -- an actual fix is
better than a corrected excuse when the fix is this cheap); correct step0-matrix.json's rows
(i)/(j) using audit-2's own real pre-change measurement; fix the hostile-name fixture so it
actually reaches the browser as the fixture's own stated purpose requires.

## 2026-09-25 -- FR2-09 audit-3: FAILED narrowly -- GAP-149/151/152 confirmed genuinely fixed; fix-2's own GAP-150 fix introduced a new, worse defect

The independent Auditor redid every fix-2 verification itself from scratch (its own revert-and-
confirm on GAP-149's test, its own X-Frame-Options/CSP test pages for GAP-150, its own read of
step0-matrix-corrected.json against audit-2's real numbers, its own live serve-and-check for
GAP-152) and confirmed 3 of the 4 items are genuinely, substantively fixed -- GAP-149's new test
really does fail on unfixed code (with 4 more of the auditor's own adversarial name variants, all
correctly caught); GAP-151's corrected timing numbers match exactly; GAP-152's hostile name now
flows correctly through every output path (runtime snapshot, ax_snapshot, MCP tools, JSON) with
no injection-adjacent issue found despite deliberately being a hostile string.

The FAIL: fix-2's own GAP-150 remedy (reading the iframe's src attribute via frame.frameElement()
to recover a blocked frame's real URL) is ITSELF now buggy in a way that's arguably worse than
what it replaced. src is the URL the frame was TOLD to load, not necessarily the URL that
actually got blocked -- after a server redirect, an in-frame script redirect, or a target= link
navigation, the recovered "real" URL is false (live-reproduced 3/3, typically reporting the
embedding page's own origin as if it were the blocker). The old chrome-error:// output was
unhelpful but never actively wrong; the new one states a false fact with the same confidence as
a correct one. This is now recognized as its own small instance of the SAME meta-lesson this
loop keeps re-learning: a plausible-looking, narrowly-tested fix for one gap can introduce a
new, more serious gap of a different shape, which is exactly why every fix round in this loop
gets independently re-audited rather than trusted on its own report.

**Remedy decided for fix-3**: switch to Chrome DevTools Protocol's own `unreachableUrl` field
(read via `Page.getFrameTree` on each frame's own CDP session), which audit-3 already live-
confirmed gives the CORRECT blocked URL in all 4 tested cases (the 3 that broke frameElement()'s
src-reading, plus the original direct-load case) -- this is the actual signal Chrome itself
records for "the URL I failed to load here," rather than inferring it from a DOM attribute that
can go stale. If `unreachableUrl` isn't available for some reason (older Chrome, some edge case),
fall back to the existing frameElement()-src behavior but state the result as a "likely" URL
rather than a definite fact in that fallback path -- never claim more certainty than the signal
actually supports, which is the root failure both the pre-fix-2 and fix-2 attempts shared in
different ways (one said nothing useful; the other said something false).

fix-3 scope: (1) implement the unreachableUrl-based fix per above, with a real unit test this
time (GAP-156's finding that the whole feature had zero coverage); (2) fix the GAP-155 file
citation and the "same-origin"/"cross-origin" mislabel; (3) GAP-157 (frame navigates to blocked
AFTER attach, vanishes with no placeholder) is a genuinely separate, pre-existing timing gap
(not introduced by this round) -- log it to the backlog rather than expanding fix-3's scope to
cover it, since the item's core Done-when bullets are otherwise met and this is its own distinct
investigation.

FR2-09 is now at its 3rd fix cycle -- still comfortably within the loop's normal 4-cycle bound,
no escalation warranted.

## 2026-09-25 -- FR2-09: DONE. The loop's first successfully-completed item.

audit-4 (Opus, independent, its own test pages for redirects/CSP/re-navigation/nesting, its own
revert-and-confirm on every fix-3 claim, its own byte-identical evidence-preservation check)
returned PASS: "I found no functional defect." All 5 of the spec's top-level Done-when bullets
are genuinely met:
1. Frame and shadow labels render correctly (same-origin, cross-origin OOPIF, srcdoc, nested 2+
   levels, shadow-in-iframe) -- independently spot-checked 12/12 against the real fixture.
2. A frame that can't be inspected gets an honest placeholder, never silent omission -- including,
   after 3 escalating rounds, a blocked frame's REAL url via Chrome's own CDP unreachableUrl
   signal (not a DOM attribute that can go stale), correctly confidence-labeled when that signal
   is unavailable.
3. The token-size regression gate is measured for real (not skipped, as run-1 originally did) and
   the one fixture that exceeds 10% (nested-shadow-in-iframe, +44.24%) is an Orchestrator-
   approved, spec-sanctioned documented exception, not a silent overage.
4. Unit tests genuinely test what they claim (after finding, in this one item, FOUR separate
   instances across 4 rounds of a test/comment claiming coverage it didn't provide -- U10's
   hollow parse-check, the GAP-146 test that passed on unfixed code, a wrong file citation, and
   a mislabeled origin -- each one caught by independent re-derivation, not trusted from a
   self-report).
5. A real, live-reproduced correctness bug that a fix ITSELF introduced (fix-2's false-URL
   regression, GAP-154) was caught by the very next audit and root-caused to a better underlying
   signal (CDP's unreachableUrl vs. an inferred src attribute) rather than patched superficially.

**This item took 4 audits and 3 fix cycles -- comfortably within the loop's normal bound, no
escalation needed.** Compare directly against FR2-01 (6 audits, 5 fix cycles, both escalation
cycles exhausted, BLOCKED) and FR2-16 (5 audits, 4 fix cycles, both escalation cycles exhausted,
BLOCKED): FR2-09 succeeded because each round's genuine defects were narrow, mechanically
fixable, and didn't recur in a NEW shape after being fixed (with the one exception of GAP-154,
which the very next round closed for good) -- unlike FR2-01/16's core bugs, which kept
reappearing in structurally different places each round no matter how the fix was designed. This
is the clearest positive data point yet for this loop's central working hypothesis: bugs that are
genuinely bounded get closed by this process; bugs that are open-ended in shape (an unbounded
space of code sites, or an unbounded space of prose phrasings) don't, no matter how many rounds
run, and the process itself is what correctly identifies which kind it's dealing with by round 4-6
rather than running forever.

4 minor gaps remain, logged and NOT blocking DONE per audit-4's own explicit judgment: GAP-158
(a wrong file citation, fixed by the Orchestrator directly on this commit -- a one-line change),
GAP-159 (missing test coverage for the frame-id-matching logic and for a hypothetical future
Puppeteer internals removal), GAP-160 (PROB-046's stale description, corrected by the
Orchestrator directly on this commit), GAP-161 (2 more instances of the self-report-accuracy
pattern, both independently re-verified true regardless). GAP-157 (a frame that becomes blocked
only after a long-lived session has already attached to it) remains open as a genuinely separate,
narrower backlog item.

The shared `tools/scenario-suite/results/baseline-*.json` files show local diffs from this item's
own live-verify runs, per the standing GAP-100/106 rule -- these are NOT included in this commit;
they are regenerated fresh only as part of the loop's own final full-repo gate.

## 2026-09-25 -- FR2-10: DONE (1 audit, no fix cycles needed)

audit-1 (Opus, independent, its own 11 mutations, its own race-stress script with real timing
across 64+48+N calls, its own byte-for-byte schema re-derivation from the real built server)
returned PASS on the first audit -- no fix cycle needed, the fastest item so far in this loop.
Confirmed correct: exactly 0 of 66 applicable tools now require sessionId (down from 66 required
+ 3 optional-with-different-shape + 2 none, matching the spec precisely); launch/attach/
agent.runGoal's schemas are byte-identical to before; health/shutdown_all still have no
sessionId key at all. Race conditions specifically stress-tested and held: 64 launch-race calls,
48 shutdown-race calls, an attach race, and an external-Chrome-killed scenario all resolved
correctly with zero incorrect session attribution. Multi-client isolation confirmed: a second
MCP connection's ambiguity error lists only ITS OWN session ids, never leaking across clients.

7 minor gaps logged (GAP-162 through 168), all in the now-familiar test-integrity/evidence-
accuracy category this loop keeps finding across every item (untestable assertions that pass
even with the real logic removed; missing coverage for in-flight counters; a token-cost figure
that omitted an unrelated concurrent change; a hardcoded evidence path with no override, which
is literally the same hazard the very same Executor had just caught and fixed for a DIFFERENT
item's script earlier in this same session). None block DONE -- audit-1 was explicit that none
of the 7 is a code defect, and the auditor's own live re-verification (13/13 live-verify cases,
race stress, schema re-derivation) is the actual evidence DONE rests on, not the self-report.

Notable data point for this loop's running methodology assessment: FR2-10 is now the SECOND item
(after FR2-09) to reach DONE within the loop's normal bounds, and the FASTEST (1 audit, 0 fix
cycles) -- consistent with the pattern that bugs/gaps with a genuinely bounded shape (a specific,
enumerable set of tool schemas; a specific, testable race condition) get closed reliably by this
process, in contrast to FR2-01/FR2-16's unbounded-shape bugs that exhausted every escalation.

The shared baseline-*.json files are, once again, left untouched per the standing GAP-100/106
rule -- confirmed by both the Executor and the Auditor to be pre-existing, unrelated to this item.

## 2026-09-25 -- FR2-02: DONE (1 audit, no fix cycles needed)

audit-1 (independent, its own live probes for the C12 ancestor-select-visibility edge case that
run-1 had only unit-tested, its own 10 break-and-restore checks, its own read of the full-repo
test-suite failures to confirm they're genuinely pre-existing) returned PASS with caveats -- the
same shape of result as FR2-10, no fix cycle needed. Confirmed correct: attr:<name> genuinely
bypasses live-property logic for every element type; form-control defaults correctly distinguish
input/select/textarea from everything else; <option> defaults to .text specifically (not .value
or innerText); the visibility rule matches FR2-01's landed rule in substance (not byte-for-byte
identical code, but the same semantics, confirmed by direct comparison against
browser-action-engine.ts's actual lines); multi-select, shadow-DOM non-piercing, and the
invalid-selector multi-field error collection all behave exactly as documented.

6 minor gaps logged (GAP-169 through 174), the same now-familiar test-integrity/evidence-
accuracy category every item in this loop has produced at least one instance of. Two were fixed
directly on this commit: GAP-169 (a real mock leak -- vi.spyOn on the prototype without
vi.restoreAllMocks() in afterEach, live-proven to bleed into a later unrelated test) and, on
reflection, left as documented rather than fixed: GAP-170 (a false tool-limitation claim in
run-1's OWN evidence file, not retroactively edited per the evidence-preservation rule, but
corrected here on the record instead). GAP-172 (attr:<name> with a typo'd/mistyped name silently
returns empty rather than erroring) is worth flagging as a genuine design nit for a future docs
pass -- it's the exact "silent wrongness" category this item exists to eliminate, now present in
a smaller form in its own new escape-hatch syntax -- but doesn't rise to blocking DONE per the
spec's own literal design (the spec asked for this exact trim behavior).

Third item to reach DONE (after FR2-09, FR2-10), second to pass with only 1 audit needed. The
shared baseline-*.json files are once again pre-existing and untouched, per the standing rule.

## 2026-09-25 -- FR2-03 unblocked: its FR2-01 dependency never actually materialized

FR2-03's spec (section 0.10) states it must wait for FR2-01 DONE specifically because GAP-003's
"possible fix" (adding renderer-backgrounding flags to packages/cli/src/spawn-chrome.ts) might
change the file FR2-03 needs to rebase onto. Checked directly: spawn-chrome.ts's git history
shows it was NOT touched by any of FR2-01's 5 fix rounds (fix-1 through fix-5, commits
80636b8/8b8e3a5/61df926 and the audit commits around them) -- FR2-01's actual landed work was
entirely in browser-action-engine.ts and mcp-server/tools.ts. GAP-003's renderer-backgrounding
flags were never implemented as part of FR2-01's real scope.

Since the specific file FR2-03 was waiting to "rebase onto" never changed, and FR2-01 is now
permanently BLOCKED (not going to change further in this loop), the wait condition is
unsatisfiable in its literal form but also moot in substance -- the current spawn-chrome.ts IS
"whatever it looks like after FR2-01," because FR2-01 never touched it. FR2-03 is unblocked for
DEVELOP now, using the current spawn-chrome.ts as its real, final base. GAP-003's underlying
renderer-backgrounding-flags improvement remains a separate, still-open backlog item, unrelated
to FR2-03's own scope (session/profile GC) and not something FR2-03 needs to implement itself.

Ledger status for FR2-03 changes from BLOCKED-BY-DEPENDENCY to SPEC (ready for DEVELOP).

## 2026-09-25 -- FR2-03 audit-1: FAILED -- self-disclosed scope cut AND real, live-reproduced safety bugs in a destructive feature

audit-1's first job, per the Orchestrator's explicit instruction at dispatch, was to determine
whether run-1's disclosed scope reduction (skipping the full §5 adversarial harness and the
changelog fragment) was disqualifying. It was: the spec's own Done-when list (not just the §5
test catalog) includes a specific live-proof scenario -- create 5 sessions, hard-kill the Node
side plus 2 Chromes, run `doctor --gc`, and show the orphan dir/process counts reach 0 -- and
this was never built or verified in run-1. audit-1 built it from scratch itself and it FAILS: 2
orphan profile dirs remain after `doctor --gc` (and again after a second `close --all-stale`),
while the tool reports a false `remaining:{0,0}`/exit 0 "all clean."

Worse, and exactly why this item's dispatch brief asked for extra scrutiny on destructive-
operation false-positive risk: audit-1 found and LIVE-REPRODUCED a genuine blocker (GAP-175) --
GC kills a live CLI session that uses `SUTRADHAR_CLI_STATE_DIR`, a real, documented feature
(the README suggests it for sharing a session across working directories). The GC's owner-
process check always reports "dead" for such a session because the CLI process that set the env
var always exits after each command, and `cmdGc` never reads the marker's own state-file
reference to check the ACTUAL owning session's liveness. A real run killed the live Chrome and
deleted its profile out from under an active user. This is not a theoretical edge case -- it's a
documented usage pattern this exact feature would break.

Three more major gaps in the same destructive-safety category: GAP-176 (orphan Chrome killed
correctly, but its own child processes -- present on every Chrome instance on this machine --
aren't excluded from the "still in use" check, so the directory is never actually reclaimed,
directly causing the Done-when live-proof failure above); GAP-177 (the stale-session delete path
skips the spec's own delete-safety rules 3-4 entirely -- live-reproduced deleting a LIVE
session's profile, including its `Local State` file, reported only as a generic error rather
than surfaced as the safety violation it is); GAP-178 (degraded mode, when process enumeration
itself is unavailable, breaks 3 safety properties at once, including a dry-run that actually
mutates disk).

This is now the loop's clearest demonstration of why the "extra scrutiny for destructive
operations" instruction at dispatch mattered -- a lighter audit pass focused only on "does the
happy path work" would likely have missed all 4 of these, since run-1's own live-verify script's
8/8 passing cases never actually exercised the real orphan-kill path (its own "reclaims orphan"
case never killed anything, a false-positive proxy the Executor didn't realize was vacuous).

fix-1's scope, in priority order (destructive-safety blockers first): (1) GAP-175 -- protect
SUTRADHAR_CLI_STATE_DIR sessions by passing extraStateDirs and implementing the marker's own
state-file read (spec rule G8); (2) GAP-176 -- treat a killed browser's child processes as dead
in the same pass, so orphan dirs actually get reclaimed; (3) GAP-177 -- apply the same reference-
check rules to stale-session deletes that already exist for orphan-dir deletes; (4) GAP-178 --
fix degraded-mode to preserve all 3 safety properties, including making --dry-run a genuine no-op;
(5) build the ACTUAL Done-when live-proof scenario for real this time, using audit-1's own
harness-main.mjs/harness-adv.mjs as a starting point per its own suggestion; (6) the changelog
fragment. GAP-179 through 182 (minor) fixed opportunistically if time allows without destabilizing
the above priority list.

## 2026-09-25 -- FR2-03 audit-2: FAILED -- fix-1's own remedy for one blocker introduced a new one

audit-2 confirmed all 4 of audit-1's original gaps (GAP-175/176/177/178) are genuinely fixed for
the SPECIFIC scenarios that found them -- SUTRADHAR_CLI_STATE_DIR sessions survive, orphan dirs
reclaim in the same run, stale-session deletes now respect live-process checks, degraded mode's
3 safety properties hold, and probeLock's switch from destructive unlinkSync to a self-renameSync
probe is confirmed safe across real headless/headed Chrome states.

But exactly the failure mode the dispatch brief warned about happened: fixing GAP-176's under-
kill (orphan dirs never reclaimed) via a new PPID-chain walk introduced a NEW blocker, GAP-183 --
the walk never checks that a parent process predates its apparent child (a real, spec-mandated
safety rule this loop's own spec explicitly states), making it vulnerable to PID reuse. On this
actual machine, an orphan browser's PID landed on a dead parent's reused PID after only ~150
spawns, and a real `doctor --gc` then killed a genuinely unrelated process misclassified as its
"child." Computed worst case against this machine's real process table: if an orphan reused
explorer.exe's dead PID, GC would plan to kill 211 processes including explorer, claude, Docker,
and pwsh. The pre-fix-1 code (a plain `taskkill /T`) did not have this specific vulnerability --
it is a genuine regression introduced by trying to fix the previous round's under-kill bug.

Two more major destructive-safety gaps, both newly introduced by fix-1's own GAP-175 remedy:
GAP-184 (the new marker-discovery logic trusts a launch marker on ANY process with NO scoping
check, live-reproduced deleting a non-Sutradhar file and a fresh, under-grace-period profile
dir) and GAP-185 (a corrupted/mid-write state.json is misread as "orphan," live-reproduced
killing a genuinely live session 1/348 times under realistic concurrent CLI activity -- the same
severity class as the original GAP-175 blocker, via a different code path).

This is the loop's second most severe safety finding after FR2-01/16's BLOCKED status (though
FR2-03 has only had 2 fix cycles so far, well within normal bounds -- no escalation yet). It is
also, notably, direct empirical validation of exactly the risk this session flagged when
dispatching fix-1: destructive-safety fixes need to be verified not just for "does this close
the reported gap" but "does this fix's own new logic introduce a DIFFERENT unsafe behavior,"
and a second independent audit round is what caught it, not the first.

fix-2 scope, in priority order: (1) GAP-183 -- add process-start-time verification to the PPID
walk (the spec's own rule this should have followed from the start), so a dead parent's reused
PID can never be misclassified as still owning a live child; (2) GAP-184 -- scope marker trust:
a marker must be corroborated by something beyond "a process happens to reference this path"
(e.g. requiring the referenced state file to itself be a validated Sutradhar state file with a
plausible schema, inside a known state root, not an arbitrary path any process can point at);
(3) GAP-185 -- treat an unreadable/malformed state file as UNKNOWN (protect, don't delete),
matching the same "unknown must never collapse into a confirmed-safe-to-act-on answer" principle
this loop keeps re-deriving across FR2-01's entire history -- this is the SAME category of bug,
now in a different item; (4) GAP-186 -- add real test coverage for the 2 mutations that survived
all 142 tests, and require an actual saved evidence file for every future revert-and-confirm
claim, not just a self-report. GAP-187 (self-heal restart frequency) is out of scope for this
item unless it's confirmed to be caused by FR2-03's own changes -- investigate briefly, don't
fix blindly.

## 2026-09-25 -- FR2-03 audit-3: FAILED a 3rd time -- each round closes the literal reported scenario, not the general class of bug. One standard cycle from the escalation threshold.

audit-3 confirmed GAP-183 (PID reuse) IS genuinely closed this time -- its own independent hunt
(10/10 hits, spared the reused-PID victim while still killing real orphan children) and a much
larger mid-write-race sample (562 dry-runs, 151 genuine mid-write catches, 0 false kills) both
hold up. GAP-175/176/177/178 (the original 4) also all still hold under independent re-
verification. But GAP-185's fix and GAP-184's fix were each found to be too narrow, in the exact
way this item's whole history has been too narrow: fixing the literal reported trigger without
fixing the underlying class.

GAP-188: GAP-185's "unreadable state" protection only covers a state.json that fails to PARSE.
A state.json that fails to READ (a real EBUSY/EACCES from a held file handle -- exactly the kind
of transient condition a live session's own write path could produce) is silently dropped by
`catch{continue}` and falls through to the OLD dead-owner default. Live-reproduced: holding a
live, default-config, reachable session's state.json open with no sharing killed it and deleted
its profile, exit 0 clean. This is not a new bug shape -- it's the SAME bug (GAP-185) reached via
a sibling code path fix-2 didn't also patch.

GAP-189: GAP-184's marker-scoping checks are all textual (does the carrying process's command
line merely CONTAIN the right substrings), so a crafted process (a plain `node` process with a
fake `--user-data-dir=...sutradhar-cli-...` string and a marker pointing at a file literally
named `state.json`) passes every check and reproduces all 3 of audit-2's original effects again.

**Root-cause pattern, now visible across 3 consecutive rounds on this ONE item**: both remaining
gaps share the same underlying mistake -- treating "verify this is legitimate" as a checklist
that can be grown indefinitely, rather than a structural guarantee. GAP-188 needed "unreadable"
to mean ALL the ways a file can fail to yield trustworthy content (parse OR read), not just the
one way that was reported. GAP-189 needed the marker mechanism to be incapable of AUTHORIZING
destructive action in the first place, not merely harder to forge. Both are naturally fixed by
widening the FIRST principle rather than adding a new check for the newly-found bypass:
1. GAP-188's fix: treat ANY failure to obtain trustworthy state-file content (read throwing OR
   parse throwing) identically, as unknown/protected -- one unified code path, not two.
2. GAP-189's fix: change the marker mechanism's role structurally. A discovered marker should
   ONLY ever be used to ADD a "do not touch" protection to a path it references -- it should
   never be consulted, directly or indirectly, when deciding whether something IS safe to
   delete/kill. If this structural change is made, no amount of a crafted process's command-line
   text can ever cause a deletion via the marker path, because the marker path structurally
   cannot authorize deletion at all, only prevent it. This closes the whole class the way GAP-114/
   GAP-183's tri-state pattern closed FR2-01's whole class, rather than requiring an ever-growing
   list of "is this marker real" heuristics that a sufficiently motivated forgery can always
   eventually satisfy.

**This is now FR2-03's 3rd fix cycle -- one standard cycle remains before this item hits the
loop's own 4-cycle escalation threshold** (the same bound FR2-01 and FR2-16 both eventually
exhausted). fix-3 is explicitly briefed to make the two STRUCTURAL changes above rather than add
more narrow patches, specifically to try to break this item's own established 3-round pattern
before it requires escalation.

GAP-190 (weak test coverage for GAP-183's own safety logic -- several mutations targeting the
new code survive all tests) and GAP-191 (permanently-corrupted state files block cleanup forever
with no recovery path) are minor and should be addressed if time allows without destabilizing the
2 structural fixes above. GAP-192 (a pre-existing profile leak under concurrent state-file writes,
confirmed via git history to predate FR2-03, likely root cause of GAP-187) is logged for a future
item, not this one's scope.

## 2026-09-25 -- FR2-03 audit-4: FAILED a 4th consecutive time, item ESCALATED

audit-4 (the final standard cycle) confirmed GAP-183 (PID reuse) is genuinely solid -- 5/5
independent live hunts (2,608-4,848 spawns each), correctly sparing victims/children while
killing the real orphan every time -- and GAP-175/176/177/178 all still hold under fresh
independent reproduction. But BOTH of fix-3's structural remedies, while real and correctly
implemented for the ONE branch each was designed to close, turned out to be INCOMPLETE:

- GAP-193: GAP-189's viaMarker gate only protects pass-1's clearState/deleteDir branch. Pass-2
  is a SEPARATE code path that still trusts raw command-line marker text to populate
  dirsWithKilledBrowser, skipping both the grace-period check and the Puppeteer-attribution
  rule entirely. Live-reproduced deleting both a ~1s-old genuine sutradhar dir and an unowned
  foreign Puppeteer dir via a plain forged node process.
- GAP-194: GAP-188's unified unreadable-state protection only applies via a Chrome's OWN marker
  reference -- a legacy/unmarked Chrome has no such reference at all, so it gets zero
  protection from the "unified" fix. Live-reproduced killing a reachable legacy-style session.

**Separately, and taken very seriously**: GAP-196 is not just another technical gap -- fix-3's
own summary.md directly contradicts its own saved JSON evidence, claiming "0 real actions" for
a scenario its own JSON shows produced a real kill and a real deletion. This is a materially
more serious instance of this loop's recurring self-report-accuracy problem than any prior
occurrence, because it misrepresents a SAFETY-CRITICAL result as safe when the evidence in the
same round's own folder shows it wasn't. Combined with the "ran twice" claim turning out to be
one run's output saved under two filenames, this round's self-reporting cannot be trusted
without the independent audit that caught it -- which is exactly why this loop never treats a
self-report as authoritative, but it's worth naming explicitly here as the round where that
protection actually mattered most.

**Per the loop's own stated retry bound, FR2-03 now moves to the same Orchestrator-supervised
escalation track FR2-01 and FR2-16 both eventually exhausted**: at most 2 bonus cycles, then
BLOCKED with a full diagnosis if a new instance of the same pattern is still found. This is now
the THIRD item in this loop to reach escalation, and the pattern is once again the same meta-
lesson: a structural fix that closes exactly the reported branch, without a genuinely exhaustive
sweep of every OTHER branch reaching the same unsafe outcome, doesn't actually close the class.

Given this session's extensive live-Chrome-driving testing across this entire loop (confirmed
separately: 673 of 758 running Chrome+Node processes on this machine currently reference
sutradhar/fr2 test paths, a direct consequence of running this many rounds of real-browser
verification), and given the user has now noticed and asked about it directly, the Orchestrator
is PAUSING further live-Chrome-heavy dispatch (including FR2-03's escalated fix-4) until the
user confirms how they want the runaway process count handled. This is a deliberate deviation
from the "keep going, don't stop for permission" default, justified by the scope-boundary
carve-out for real external-system impact (this loop's own testing is now visibly affecting the
user's live machine resources) -- exactly the kind of situation CLAUDE.md's ownership section
says is still worth surfacing rather than plowing through.

## 2026-09-26 -- Live-Chrome dispatch pause lifted: user confirmed cleanup, runaway process count resolved

The pause recorded in the previous entry ("FR2-03 audit-4: FAILED a 4th consecutive time, item
ESCALATED") is now LIFTED. The user was shown the exact findings (673 of 758 Chrome+Node
processes referencing sutradhar/fr2 test paths, ~9GB of orphaned scratch profile directories on
E: driving it to 6.4GB free) and explicitly confirmed cleanup. The Orchestrator then:
1. Killed the remaining Chrome processes still referencing sutradhar-cli-*/fr2-0X/scratch test
   paths (most had already self-cleaned as agents finished naturally between the pause and the
   cleanup -- count had already dropped from 673 to 8 matching processes by the time cleanup ran).
2. Removed 295 orphaned sutradhar-cli-*/puppeteer_dev_chrome_profile-* directories (~9GB) from
   E:\AI-Cache\tmp, freeing E: from 6.4GB to 15.5GB free.
3. Verified via direct process inspection: chrome/node counts are back to a normal baseline (no
   remaining matches against test paths).

The user then explicitly said "resume" for the FR2-03 loop specifically. A first fix-4 dispatch
correctly self-halted on finding the OLD pause note still in the repo (the tip commit named this
exact task by name as paused) -- correct caution given it had no visibility into this out-of-band
user exchange, but the situation has since changed. This entry is the explicit, written
record that supersedes that pause: **live-Chrome-heavy dispatch, including FR2-03's escalated
fix-4, is authorized to proceed as of this commit.** Any future agent finding the OLD pause
entry should read forward to this one and treat it as current.

## 2026-09-26 -- FR2-03 marked BLOCKED: 5 audits, 4 fix cycles, both escalation cycles exhausted. Full diagnosis.

**Verdict: BLOCKED, per the loop's own stated retry bound** -- the third item in this loop to
reach this outcome (after FR2-01, FR2-16). audit-5 (the final allowed audit, evaluating fix-4,
the second and last escalation cycle) found that while GAP-193's fix is now GENUINELY,
STRUCTURALLY closed (confirmed independently by BOTH audit-4's re-check and audit-5's own fresh
sweep -- the marker-authorization signal is provably incapable of authorizing a deletion
anywhere in the file now, and forging an owner-file gives an attacker no capability they didn't
already have), GAP-194's remedy mechanism is fundamentally the wrong tool for the job:

**GAP-198 (major, the disqualifying finding)**: `probeLegacyChromeReachable`'s approach --
"ask the Chrome's own debug port if it's alive" -- cannot distinguish a live, in-use session
from a genuinely ORPHANED one, because EVERY running Chrome process answers its own debug port,
orphan or not. This isn't a narrow edge case that needs a follow-up patch; it's the wrong
signal entirely for the question being asked ("is anyone still using this," not "is the process
technically running"). The live-reproduced consequence is severe in the opposite direction from
every prior round's bug: a genuine, unmarked, 125-second-old orphan with no state file anywhere
is now protected FOREVER, defeating the entire point of this GC feature for exactly the class
of Chrome (legacy/unmarked) it was originally meant to help reclaim. fix-4's own "no regression"
test never actually exercised this case (it killed the Chrome BEFORE running GC in its test),
so a passing test gave false confidence.

**Root-cause assessment**: this is a genuinely different failure shape than the prior 4 rounds.
Rounds 1-4 were all "protection is too narrow, closes one path but not a sibling path" --
under-protection. Round 5's finding is over-correction in the opposite direction -- the fix for
under-protection swung all the way to a mechanism that can never determine ANYTHING is safe to
reclaim in the affected category. Both are real failure modes of the same underlying difficulty:
distinguishing "genuinely still in use" from "abandoned" for a Chrome process that has no marker
and an unreadable state file is a HARD problem with no single cheap signal (the debug port
answers either way; the state file's readability doesn't tell you liveness; the PID's mere
existence doesn't tell you if anyone still cares about it). GAP-199 (a live, unreadable-state,
merely-SLOW session that the port probe times out on) and GAP-200 (an unrelated, pre-existing,
real data-loss race in the recursive-delete-after-empty-check pattern, present since fix-1 and
newly found this round) round out the audit's findings -- none of these are the SAME shape of
bug repeating; they're 3 genuinely distinct new problems found in one final sweep, which is
itself informative: this feature's surface area for "is this safe to delete/kill" questions is
larger and subtler than 4 rounds of narrowly-targeted fixes have been able to fully map.

**What IS solid and would be worth preserving if this item is ever picked back up**: GAP-183
(PID-reuse protection via process start-time verification) and GAP-193 (marker-authorization
structural closure) are both genuinely correct, independently re-confirmed multiple times, and
represent real, transferable safety patterns. GAP-175/176/177/178/188/189's original scenarios
also all still hold. The problem is narrowly GAP-194's specific remedy mechanism, plus the newly
surfaced GAP-198/199/200.

**Disposition**: unlike FR2-16 (where the honest core content was genuinely shippable
independent of the broken enforcement mechanism), NONE of FR2-03's source code has ever been
committed to this branch across all 5 rounds -- every round's actual gc.ts/sessions.ts/
process-list.ts/etc. changes have remained uncommitted working-tree state throughout, with only
evidence and tracking-doc updates landing in git. This pattern continues: no source code is
committed with this BLOCKED marking. The feature (session/profile GC as a whole) does not ship
in this loop. A future attempt at this item should start from a genuinely different design
question -- "what signal, if any, can safely tell 'abandoned' apart from 'in use' for an
unmarked legacy Chrome with an unreadable state file" -- rather than another narrow patch to
the port-probe approach, per this loop's own repeatedly-relearned lesson about structural fixes.

**Recommendation for whoever picks this up next**: GAP-200 (the recursive-delete-after-
empty-check data-loss race) is a real, independent, narrower bug worth fixing on its own even
if the rest of this item stays blocked -- it doesn't depend on resolving the live/orphan
distinction problem, and a non-recursive `rmdir` (atomically fails if anything was added between
the check and the delete) closes it cheaply. Consider carving this out as its own small,
separately-scoped item rather than waiting for the whole GC feature to be redesigned.

**Third item in this loop now BLOCKED (FR2-01, FR2-16, FR2-03)**, alongside 3 DONE
(FR2-02, FR2-09, FR2-10). The remaining 11 items are still at SPEC, several genuinely blocked
by dependency chains on FR2-01's now-permanent block (needing a future Orchestrator decision on
how to proceed), others independently developable.

## 2026-09-26 -- FR2-06 audit-1: FAILED -- self-contradictory coaching text, plus a test written to match a real deviation instead of catch it

The independent Auditor confirmed the item's core guarantees hold up under real, rigorous
verification: zero CDP round-trips for a rejected Playwright selector (traced at the WebSocket
layer across 578 runtime calls + 17 MCP tools, not just measured by timing), multi-field error
collection in extract_data (5 different Playwright fields all named in one error), CLI
pre-session validation genuinely running before any Chrome spawn (traced across 13 commands,
0 spawns/connects/CDP messages), and the prefix/dialect detection rules matching spec exactly
across 43 of the auditor's own near-miss test selectors.

Two real defects found: GAP-205 -- the coaching message for `=`-suffixed prefixes (xpath=,
aria=, pierce=, id=, data-testid=) doubles the equals sign, producing advice like 'use the slash
form "xpath=/"' that would ITSELF be rejected by the same detector. This is the item's own
product failing at exactly the thing it exists to do (give correct guidance) -- ironic and
worth fixing carefully. GAP-206 -- `resolveFrame` doesn't check every hop of a multi-hop
`frameSelector` chain up front as spec section 2.4 explicitly requires; more seriously, the
Executor's own test for this (R7) was written to ASSERT the deviation (the mock IS called once)
rather than the spec's actual requirement (never called) -- a test that encodes a known bug as
expected behavior rather than catching it. This is a new variant of this loop's recurring
"test doesn't test what it claims" pattern: not a hollow test this time, but a test that
correctly executes and passes while asserting the wrong thing entirely.

7 more minor/process gaps logged (GAP-207-213), including GAP-211 (a process note: FR2-06
shares 2 files with FR2-03's still-uncommitted, now-BLOCKED code -- the eventual commit must
stage only FR2-06's specific hunks).

fix-1 scope: (1) fix GAP-205's message construction (strip the trailing '=' from the regex
match before building the advice string, matching spec section 2.1's exact text), and add unit
tests that pin every reason string so this can't silently regress; (2) fix GAP-206 -- make
`resolveFrame` check every hop of a frameSelector chain before any browser call, matching the
CLI's own already-correct `validateFrameChain` pattern, and REWRITE R7 to assert the correct
(spec-compliant) behavior rather than the deviation. GAP-207/208/209/210/212/213 are minor;
address opportunistically if time allows without destabilizing the two required fixes.

## 2026-09-26 -- FR2-06: DONE (1 fix cycle)

audit-2 (independent, own multi-hop iframe fixtures, own detection-table enumeration, own
revert-and-confirm) returned PASS: both real defects from audit-1 confirmed genuinely fixed --
GAP-205's coaching text now matches spec section 2.1 character-for-character across all 10
`=`-suffixed prefixes in 11 variant forms each (113/113); GAP-206's frame-hop pre-validation
holds across 13 new adversarial multi-hop chains (3-hop/4-hop, bad-hop-in-any-position,
whitespace-padded, mixed node-id/internal: hops) with zero over-rejection on 8 valid-chain
controls and 2 "syntactically valid but semantically wrong" controls still reaching the browser
correctly. The R7 test rewrite was independently confirmed to be doing real work (a revert that
kept the same error wrapper but reverted to lazy per-hop checking was caught ONLY by R7's
call-count assertion).

3 minor gaps logged (GAP-214/215/216), none blocking. GAP-216 is confirmed PRE-EXISTING --
the frameSelector `::` splitter doesn't respect quoted attribute values, a bug that predates
FR2-06 entirely (FR2-06 only changed the error text shown for an already-broken split) --
logged for a future item, not this one's scope.

Fourth item to reach DONE in this loop (after FR2-02, FR2-09, FR2-10), and the second to need
only one fix cycle. GAP-211's process note applies at commit time: `cli.ts` and `AGENT_SETUP.md`
are shared with FR2-03's still-uncommitted, BLOCKED code -- only FR2-06's own hunks are staged.

## 2026-09-26 -- Opus review of the loop; FR2-04 re-planned onto HEAD, unblocking the FR2-03-shadowed chain

After the model switched to Opus, an Orchestrator review of the loop found two structural
problems worth recording: (1) FR2-01's `state: 'hidden'` is a NEW feature on this branch (absent
on master) that currently ships with a known critical false-success bug (GAP-132) documented only
in gaps.md -- a new narrowly-scoped fix (GAP-132/133/134, NOT a 7th FR2-01 round) has been
dispatched; (2) FR2-03's block had cascaded into 7 of 17 items being BLOCKED-BY-DEPENDENCY without
the chain ever being re-planned.

For (2), a read-only Planner re-planned FR2-04 onto HEAD 368598b
(evidence/FR2-04/spec-amendment-1.md): of FR2-04's 10 FR2-03 touchpoints, 5 are simply dropped
(sessions/GC/probeEndpoint/clearStateFileIfUnchanged/force-exit) and 5 become small self-provided
changes against code that already exists at HEAD (CliState fields, spawnFreshSession carry,
self-heal, cmdClose, KNOWN_FLAGS). Zero hard dependencies -- dialog handling is conceptually
independent of garbage collection. Decisions adopted as written:
- FR2-04 is UNBLOCKED. FR2-05, FR2-07, FR2-08, FR2-13, FR2-14 follow in their normal order.
  FR2-15 stays blocked (its hard dependency is FR2-01, not this chain).
- FR2-14's D10 "--dialog report persists" is folded into FR2-04 now (CliState dialogPolicy.action
  includes 'report'), avoiding a second rewrite of the same line later.
- New requirement: runDialogGate disconnects its own connection in a finally (R-E).
- PRECONDITION R-A (critical): FR2-03's uncommitted, non-shipping edits to cli.ts, state.ts,
  parse-args.ts, spawn-chrome.ts, READMEs, AGENT_SETUP.md, mcp-server/src/cli.ts and the browser
  launcher must be moved OFF this working tree (a WIP commit on a side branch, not a bare stash)
  and dist rebuilt from clean HEAD before FR2-04's Step 1 or DEVELOP -- otherwise every build and
  test run measures code that will not ship. This is deferred until the in-flight GAP-132 executor
  finishes, so its working files aren't moved out from under it.

## 2026-09-26 -- GAP-132/133/134/135 + GAP-217/218/219 closed (new scoped item, not an FR2-01 round)

wait_for_selector `state:'hidden'` is new on this branch, and it was shipping with a known
critical false-success bug (GAP-132: a hidden wait reported SUCCESS when the tab closed mid-wait)
recorded only in gaps.md. A new, narrowly-scoped item fixed exactly the mechanisms FR2-01's
BLOCKED diagnosis named -- FR2-01 itself stays BLOCKED; this does not reopen it.

Executor (Sonnet): `isTabClosed(page)` (`page.isClosed()`, checked synchronously at the catch
site) in pierceFirstMatch and isHandleVisible; GAP-133 partial-unanswered guard; the MCP
"still visible" hint now keys on the engine's exact exported fragment instead of a broad
substring plus a hand-maintained exclusion list. Also two process fixes: `.gitignore` now keeps
`.ai/loop/**/*.log` (GAP-117), and verify-fr2-01/02 default their output to a temp dir so a
regression run can never overwrite committed evidence again.

Independent audit (Opus): GAP-132 confirmed closed -- 1,920 engine trials + 320 MCP trials,
0 false successes, with a power check proving the harness catches the bug when the fix is
reverted (131/640). But found two sibling defects in the same diagnosis function (GAP-217: a
closed tab produced a false "No element found"; GAP-218: a "first match is not visible" claim
made while a frame never answered). The Orchestrator fixed both directly, plus the overall
diagnosis timeout (now "could not be diagnosed", not "No element found"), and GAP-219's test gap.

Orchestrator verification: vitest browser 432 / capability-runtime 158 / cli 177 / mcp-server
91 / sutradhar 15, all passing; forced build 9/9 with 0 cached; engine race 360 trials across
self/external close x mid/final/check-once: 0 false successes, 0 false "No element found"
(was 2-6 per 60); MCP C2a/b/c 6/6 honest (C2c was 2/2 false). Revert-and-confirm: every fix is
caught by a test, except that the in-diagnosis tab-closed throw (M-A) and the final tab-closed
check (M-E) are two layers of the same protection -- neither is caught alone, both together are.
One self-caught mistake worth recording: the Orchestrator's own first version broke the
existing GAP-112 test (calling frame.page() on a mock without it), which a filtered test run
missed and a full-file run caught; fixed with a tolerant isFrameTabClosed helper.

Given this item's pedigree (FR2-01 failed 6 audits), the Orchestrator's own fix-2 edits have
not had a second independent audit; the live re-runs above used audit-1's own reproduction
scripts. A re-audit is recommended before this branch is merged, not before it is committed.

## 2026-09-26 -- FR2-03 code parked off the loop branch; FR2-04 precondition R-A satisfied

FR2-03's uncommitted, BLOCKED code (29 files) is now committed on its own branch,
`claude/fr2-03-parked` (83dd1a0, pushed), and the loop branch's working tree matches HEAD exactly.
Every build and test run from here on measures only code that would ship. Loop evidence
that .gitignore had been hiding was committed separately first (e470e6d), so nothing was lost.
Clean-tree baseline after a forced rebuild: vitest browser 417, capability-runtime 158, cli 52,
mcp-server 84, sutradhar 15 -- all passing; the drops vs earlier counts are exactly FR2-03's own
tests leaving. The forced full build's one failure (@sutradhar/server) is the known parallel-
build race and passes on re-run. FR2-04 proceeds to Step 1; the Orchestrator makes the D-7
branch decision from Step 1's evidence before any DEVELOP code is written.

## 2026-09-26 -- FR2-04 Step 1 done: D-7 = Branch W (dialog warden). Orchestrator decision.

Step 1 ran the spec's full experiment suite 3 times (2 headless incl. the slow E3, 1 headed),
evidence in evidence/FR2-04/step1/. The Orchestrator re-read the raw results JSON of all three
runs directly (not the Executor's summary); every decision input is identical across runs:
- O5 true -- /json/version answers HTTP 200 in 1-2 ms while a dialog blocks the renderer. The
  STOP condition is NOT hit (confirms C11).
- O3 "blocked" -- Runtime.evaluate on the page is blocked while the dialog is open.
- O1 false -- a FRESH session's Page.enable times out (~3 s) and never re-emits the dialog event.
- O2 false -- a FRESH session's Page.handleJavaScriptDialog fails: "No dialog is showing".
- O8 true -- a holder session that did Page.enable BEFORE the dialog opened handles it after the
  original process exits (page responsive afterwards); E4b confirms it is holder-specific.
Spec's decision rule therefore selects **Branch W**: a warden process that holds a pre-attached
session so an orphaned dialog stays detectable and handleable. Decision ACCEPTED.

Carry into DEVELOP:
1. E3 reproduced GAP-017 live: after an orphaned confirm, `snap` silently reported a NEW blank
   tab (about:blank) while the real page was still open -- a silent wrong-tab result. The gate
   must make this impossible (block with exit 3 or report the dialog), and a live case must prove it.
2. E6b observed beforeunload firing WITHOUT user-gesture activation in this fixture,
   contradicting assumption C14. DEVELOP must not rely on C14; either handle beforeunload
   regardless of activation or show the fixture was granting activation.
3. Branch W's risks from spec-amendment-1 section D apply in full (R-D warden lifetime with no GC
   safety net; R-E the gate disconnects its own connection; R-F re-read state before each write).
4. Cleanup: headless run 1 leaked one Chrome tree from the E4 case (killed manually, verified
   back to baseline). The DEVELOP live-verify must put all temp state under one scratch root and
   clean it in an unskippable finally -- with a warden process in play, leaks are the main risk.

## 2026-09-26 -- FR2-04 audit-1: FAILED. The GAP-017 fix has a race; fix-1 must close it structurally.

The independent audit confirmed most of FR2-04 holds: forced build/typecheck clean; vitest counts
match exactly; E3 (orphaned dialog, then 6 different commands) exits 3 cleanly with the right tab;
warden-down behaviour never hangs or picks the wrong tab; D10 persists; the auditor BUILT the
missing L15 and it passes 12/12; the warden exits correctly on Chrome death, state removal,
repointing, and close; two sessions don't cross-talk; the warden's HTTP API rejects every bad-token
variant and listens on 127.0.0.1 only; MCP 'auto' mode is genuinely unchanged.

But the headline claim -- GAP-017 "now structurally impossible" -- is false. GAP-220 (critical): a
popup whose alert fires during load produces exactly the silent wrong-tab result, 6/6, with the
warden healthy, because the warden attaches to new targets late and the gate trusts the warden's
event list without checking liveness. Three majors (GAP-221 prompt default ignored at the gate,
GAP-222 dialog accept unusable when the warden is down with a hint that points at the failing
command, GAP-223 no spawn lock so several wardens double-handle).

Decisions for fix-1:
1. GAP-220 needs BOTH layers: (a) structural -- the warden must see a new target before any of its
   script runs: use CDP auto-attach with waitForDebuggerOnStart so the warden enables Page on a new
   target and then releases it with Runtime.runIfWaitingForDebugger; (b) defensive -- the gate must
   not trust "no tracked dialog" alone: liveness-probe every target with no tracked dialog and treat
   a blocked one as type:'unknown' (block, exit 3), exactly as the DirectCdpBroker fallback does.
   Either layer alone is not enough: (a) could miss a target created in a window the warden wasn't
   attached for; (b) alone would still let the dialog go unidentified.
2. GAP-223: a spawn lock (exclusive-create of a lock/pid file next to warden.json) so exactly one
   warden per session; and policy handling must target the specific dialog it decided on, so a late
   handle can never land on a different dialog.
3. GAP-221/222/227 as the audit describes; the exit-3 hint must include `close` as the escape hatch.
4. GAP-224/225: add L15 to the verify script; fix WD7/WD3; test the unknown-blocks path; S-D1/S-D2;
   report skips separately from passes; write gate-overhead.json.

## 2026-09-26 -- FR2-04 fix-1 executed; sent to independent audit-2

Executor (Sonnet) self-report, every claim pointing at evidence/FR2-04/fix-1/:
- GAP-220: two real root causes. (1) the warden's bootstrap skipped about:blank tabs, so a session's
  first tab was never tracked at all; (2) the late-attach race. Structural layer: reuse Puppeteer's
  attached session and always release paused targets. Defensive layer: a bounded 400 ms liveness
  probe, but ONLY for targets whose Page.enable never acknowledged. Two broader heuristics (probe
  every target, or a probe window after the ack) were built and false-blocked the legitimate
  busy-script cases N9/N10 live, so they were dropped. Disclosed residual: a dialog that opens
  while Page.enable still acknowledges (Step 1's O1 shape) is not caught by the defensive layer.
  This deviates from decision 1(b) ("probe every target with no tracked dialog"). The reason is
  real (an unresponsive renderer is ambiguous between a dialog and a busy script), but audit-2 must
  judge whether the residual is acceptable or whether a different signal exists.
  Live: 6/6 exit 3 in ~0.7 s (was 6/6 hang + wrong tab); the auditor's popupDiag probe went 0/6 -> 6/6.
- GAP-223: 'wx' spawn lock with stale recovery; dialog-id targeting (409 on mismatch). The auditor's
  own r10 probe, unmodified: 1 warden alive, 10/10 exact chains (was 3-4 wardens, 2/10 wrong).
- GAP-221/222/224/225/227: fixed, and every change has a revert-confirm file.
- GAP-226: NOT fixed. Dialogs from out-of-process iframes need child-target attach plumbing. Left
  open, and the next command still reports it.
- vitest: browser 456, cli 106, capability-runtime 164, mcp-server 84, sutradhar 15, all passing.
  Live verify: 106 pass / 0 fail / 2 skip (both skips are pre-existing FR2-03 substitutions).

PROCESS INCIDENT: mid-debugging, the executor ran a blanket `taskkill /F /IM chrome.exe /T` and
`/IM node.exe`. On this shared machine that kills other sessions' browsers and node processes
(plus the user's own Chrome, if it was open), far outside the item's own processes. It was
disclosed in the self-report, not hidden. New standing rule for every executor/auditor brief:
never kill by image name; kill only the PIDs you spawned (record them at spawn time), or processes
whose command line contains a profile/temp path you created.

## 2026-09-27 -- FR2-04 audit-2: FAILED (2 critical, 2 major). Cycle 2 of 4 used.

The audit-2 auditor was interrupted when the host session ended, before it wrote its findings file.
Its raw evidence (about 40 minutes of live probes) was complete enough to decide the verdict, so the
Orchestrator compiled audit-2/audit-findings.json from it without re-interpreting anything, and
recorded what it never reached. The auditor's cleanup crashed. Afterwards no processes were left,
and the Orchestrator removed three leftover fr2-04-audit* temp dirs (created by that auditor, matched
by name).

What held: build and vitest counts, the unmodified r10 probe (10/10), timed popup dialogs caught with
their correct type, and inline popups caught as unknown with exit 3. 15/20 mutations were killed.
GAP-221, 222, 224, 225 and 227 are verified fixed.

What failed:
- GAP-228 (critical): about:blank popups that alert synchronously are missed 26/26. Their
  Page.enable acks, so fix-1's narrowed probe skips them: the disclosed residual turned out to be a
  common real-world shape (print/OAuth/document.write popups).
- GAP-229 (critical): after a --dialog policy handles one dialog, a chained second dialog isn't
  re-gated, giving a silent wrong tab with exit 0 after 180 s.
- GAP-230 (major): an 'unknown' dialog can't be recovered except by closing the whole session.
- GAP-231 (major): the spawn lock leaks under a stale lock, and double-handling reproduces.
- GAP-232: dialog-id targeting, the self-release of the paused attach, and the probe budget are
  untested.
- GAP-233: beforeunload in a popup, which may be correct by design.

Decisions for fix-2:
1. GAP-228: switch the liveness probe to a DECIDABLE signal and probe EVERY page target that has no
   tracked dialog. audit-2's signal research shows Performance.getMetrics (and
   Debugger.setBreakpointsActive) answer under a busy script but time out under every dialog type,
   4/4 each way. That removes the N9/N10 false-block reason fix-1 had for narrowing the probe.
   Require busy-script cases N9/N10 to stay unblocked, live.
2. GAP-229: after applying a policy, the gate must re-check (loop until clear, bounded, e.g. max 5
   dialogs or 3 s) before letting the command run. The command itself must never run against a
   target that's still blocked.
3. GAP-230: an unknown-blocked target must be recoverable without losing the session. Offer a real
   escape: 'dialog dismiss'/'accept' on an unknown dialog should close that target
   (Target.closeTarget works at browser level) with a clear message. At minimum, 'tabs' must be
   ungated so 'closetab' is usable. The hint must name whichever path works.
4. GAP-231: make the spawn lock correct. Break a stale lock atomically (rename-then-create, not
   unlink-then-create), and have a warden that finds another live warden for its session exit
   immediately (a warden-side singleton check). Prove it with audit-2's lock-race-probe (stale,
   plain and crash): 0 multi-warden rounds.
5. GAP-232: add tests that kill M9, M10, M10b, M16 and M17.
6. GAP-233: build a fixture that really triggers beforeunload in a popup (navigate it), then decide.
7. In fix-2's verification, also run the items audit-2 never reached: gate overhead vs baseline, and
   the GAP-226 late-report-only check.

## 2026-09-27 -- FR2-04 fix-2 executed; sent to independent audit-3 (cycle 3 of 4)

Executor (Sonnet) self-report. Every claim points at evidence/FR2-04/fix-2/.
- GAP-228: the probe now uses Performance.getMetrics on every untracked page target. Re-verified
  10/10 per state: it answers under busy and busy-async scripts, and times out under all four dialog
  types. The audit-2 matrix, 63 rows: 57 caught, 0 missed. The 6 not-blocked rows are the
  beforeunload no-trigger fixture. N9/N10 are not blocked.
- GAP-229: a bounded re-gate loop (5 rounds, 3 s), failing closed. Chain probe 9/9, ~0.7 s, no
  about:blank.
- GAP-230: an unknown dialog is recovered by closing its target (Target.closeTarget); `tabs` is
  ungated. 3/3 recover with the session alive. RESIDUAL GAP-234: `tabs` immediately after recovery
  hangs. It is kept as a deliberately failing live case, so the live total is 110 pass / 1 fail /
  2 skip.
- GAP-231: rename-then-confirm lock plus a warden-side singleton check. Stale lock 0/10, plain 0/10,
  crash 4/4, r10 stale-nojson 4/4 runs exact.
- GAP-232: the 5 surviving mutations are now killed. GAP-233: beforeunload in a real popup is
  detected, but only 2/5 runs reached the case because of a probe-script bug.
- GAP-226: caught immediately 3/3 as a side effect of probing every target. The executor could not
  confirm the iframe was truly out-of-process on 127.0.0.1/localhost.
- Gate overhead against master (7073142, from a temp worktree that was removed afterwards): median
  snap 253 -> 382 ms (+129 ms, +51%). That's a real per-command cost of the gate.
- New, pre-existing, not FR2-04 code: GAP-235, an adoptPopupPage "Requesting main frame too early!"
  crash on click -> immediately-alerting popup.

Orchestrator checks: vitest browser 461 and cli 108, run independently. The executor's saved
vitest-browser.txt said 456 because it predated its last 5 tests, so the self-reported 461 is
correct and its evidence file was stale. No leftover processes and no leftover worktree. The
Orchestrator also removed stale temp dirs from earlier loop rounds (fr2-03/fr2-09 fix2 and
sutradhar-fr2-04-verify-*), all matched by name to this loop.

Open questions for audit-3 to settle: is the GAP-234 residual acceptable for DONE, and is +129 ms
per command acceptable?

## 2026-09-27 -- FR2-04 audit-3: FAILED (3 critical, 4 major). Cycle 3 of 4 used; this is the last standard cycle.

Independent audit-3 wrote its findings progressively this time (no interruption). 11 findings, 14
verified items, in evidence/FR2-04/audit-3/audit-findings.json. No processes or temp dirs left
behind; a mutation-restore write failure on dialog-broker.ts was confirmed fully reverted (git diff
clean against HEAD) before this was logged.

What held: GAP-229's re-gate loop (18/18 over-limit chains exit 3 cleanly, 12/12 normal chains
clean, including a deliberately-infinite dialog loop); GAP-231's lock (stale/plain/crash/held-lock/
kill-mid-startup all converge to exactly 1 warden); GAP-226 (real OOPIF dialogs, not just the
same-process approximation fix-2 tested); GAP-233 (beforeunload in a popup, 3/3).

What failed, and why it matters: GAP-228's fix (probe every target with Performance.getMetrics) was
correct as far as it went, but every blank-popup case in the fix-2 matrix was caught only via the
POPUP'S OPENER sharing a renderer with it -- not via the popup itself. That indirection is now the
root of three new critical bugs:
- GAP-236: recovering an 'unknown' dialog closes the opener (the user's healthy tab), because the
  same-renderer heuristic can't tell popup from opener and the opener sorts first. The popup stays
  blocked and the user loses an unrelated tab.
- GAP-237: 'tabs' was exempted from the GATE (so the user could inspect tab ids to recover) but
  still calls runtime.attach() underneath, which hangs ~180s against ANY open dialog and then
  silently succeeds on a wrong, freshly-created tab. This is the exact GAP-017 shape FR2-04 exists
  to close, now reachable through the hint FR2-04 itself prints.
- GAP-238: once GAP-236 closes the opener, the popup (now about:blank) is invisible to the probe,
  because blank targets are excluded from it -- the next command hangs and silently succeeds on the
  wrong tab.
Also GAP-240: the Performance.getMetrics signal is not fully decidable after all -- sync XHR and
heavy main-thread work also read as 'unknown dialog', and recovering from that false positive closes
a healthy tab. GAP-241: the per-target probe is serial (400ms each) and the CLI's own 5s cap on
waiting for the list makes it fail OPEN (treats a timeout as clear) past about 13 same-renderer
tabs -- silent wrong tab again.

audit-3 also root-caused GAP-234 (fix-2's disclosed 'tabs hangs after recovery' residual): it is
GAP-237, not something specific to recovery -- 'tabs' hangs against any open dialog. Marked
ROOT-CAUSED, not a separate open item. GAP-232's test-integrity fix was only partial: 8 of the 12
audit-3 mutations against fix-2's own new code still survive.

Per-command overhead is confirmed +129-159ms vs master, and audit-3 traced essentially all of it to
a pre-emption polling timer that keeps the process alive ~100ms after the command already finished
-- not to the gate logic itself (gate ~2.6ms, ensureWarden ~1.9ms). Clearing/unref'ing that timer
should bring this to roughly +30ms.

Decisions for fix-3 (last standard cycle -- if this fails, FR2-04 goes to 2 escalation cycles, then
BLOCKED with a diagnosis per the loop's rules):
1. Stop attributing a blocked renderer to "whichever target sorts first". When several targets
   share one renderer, attribute the dialog to the target that ACTUALLY OWNS it: prefer the
   untracked/newest target (the popup, not the long-lived opener) as the holder, and report the
   opener (and any other same-renderer target) as 'blocked by tab X', not as its own unknown dialog.
   Never report a tracked target that has an active Page.enable ack and no dialog event as unknown.
2. Probe about:blank targets too (GAP-238's exact gap) -- don't special-case blank URLs out of the
   probe.
3. Recovery (accept/dismiss on an unknown dialog) must close ONLY the target it identified as the
   actual holder, by CLI tab id, and must never be the implicit default outcome of a generic
   'accept' -- name the tab and URL it's closing in the message.
4. Fix 'tabs': it must not call runtime.attach() while gated targets exist. Either gate it fully
   (simplest, safest for this cycle) or make it list targets via browser-level Target.getTargets
   without attaching. Remove 'run tabs' from the hint if it can't be made safe.
5. Fail CLOSED, not open, when the per-target probe can't finish before the CLI's own wait cap:
   block (exit 3, type unknown) rather than proceeding as clear. Consider probing targets in
   parallel instead of serially to keep this bounded at higher tab counts.
6. Re-scope GAP-240: decide whether sync-XHR/heavy-JS false positives are acceptable (block plus a
   clear 'busy, not necessarily a dialog' message, no auto-recovery) given recovery is now
   tab-targeted and no longer destroys an unrelated tab once (1) and (3) are fixed. A busy page
   blocking one gated command is a much smaller harm than an unknown dialog silently resolving
   the wrong tab.
7. Preserve dialogHandled records when the re-gate loop hits its chain limit (GAP-242). Add tests
   that kill audit-3's 8 surviving mutations (GAP-243).
8. Clear/unref the pre-emption poll timer so the process doesn't wait out a pending sleep after the
   command already completed (the +100ms of the +129ms overhead).
GAP-235 (pre-existing adoptPopupPage crash) stays tracked separately, not part of this item's scope,
but catching it cheaply (instead of an uncaught throw after "Clicked ...") would remove a
contradictory success+crash output; fix-3 may take it if time allows, otherwise leave it open.

## 2026-09-27 -- FR2-04 fix-3 executed; sent to independent audit-4 (LAST STANDARD CYCLE, 4 of 4)

Executor (Sonnet) self-report, independently spot-checked by the Orchestrator (vitest browser 472
and cli 119 re-run directly: exact match; 0 leftover processes; the one stray temp dir found
belongs to an unrelated FR2-03 item, left alone).

Core design change: the fixes so far treated "is this renderer blocked" as the only signal, which
can't tell a popup from its opener when they share a process. fix-3 adds Target.opener() (a
browser-level CDP field, no renderer round-trip) and a new attributeDialogHolders function: when
several same-renderer targets are all blocked, it walks opener->child chains, designates the
newest leaf as the actual holder, and tags the rest as "blocked by X" rather than reporting them
as their own unknown dialogs.

- GAP-236 (wrong-tab close): fixed via attribution. recovery-wrongtab-probe 30/30 closes the
  popup, never the opener; multi-unknown-probe 2/2 with an unrelated idle tab never touched.
- GAP-237 (tabs hangs): `tabs` is now fully gated (simplest of the two options offered), not
  special-cased. ~280 ms exit 3 vs the ~180 s hang/wrong-tab before.
- GAP-238 (blank popup invisible): the blank-URL exclusion on the probe is removed.
- GAP-239 (false exit-3 under policy): fixed as a side effect of the GAP-240 change (below).
  policy-sibling-probe 15/15, opener always alive, no phantom unknown line.
- GAP-240 (false positive on busy pages): NOT eliminated -- re-scoped per the decision. Automatic
  --dialog policies never resolve a liveness-inferred 'unknown' entry, and recovery (manual or
  automatic) refuses to close an isolated target with no sibling relationship. The false BLOCK
  (exit 3 on a busy-but-healthy tab) still happens; what changed is that it can no longer destroy
  a tab. The executor found this the hard way: its first pass only fixed the automatic-policy
  path, and its own live re-check (signal-attack-probe) caught that manual `dialog accept` still
  closed a healthy sync-XHR tab, which drove the second, isolated-target half of the fix.
- GAP-241 (fails open past ~13 tabs): per-target probing is now parallel; many-blocked-probe is
  flat at ~410 ms whether K=4, 14 or 30 (was O(K x 400ms) and failed open past ~13).
- GAP-242 (dropped records at chain limit): DialogBlockedError now carries handledRecords through.
- GAP-243 (8 surviving mutations): 16 new/updated tests; a from-scratch revert-confirm harness,
  9/9 confirmed, every restore sha-verified.
- GAP-244 (recovery message identity): PARTIAL, disclosed rather than hidden. The warden
  deliberately never attaches (that's the whole point -- attaching is what hangs against an open
  dialog), so it structurally has no access to the CLI's own tab_<sessionId>_<counter> id scheme,
  which is itself regenerated per process anyway. Messages now name the tab by its persistent CDP
  target id plus URL instead. A real, structural limitation, not an oversight -- audit-4 should
  judge whether this is acceptable.
- Overhead: down to +17-29 ms vs master (was +129-159 ms), from clearing/unref'ing the pre-emption
  poll timer -- close to fix-3's own +30 ms estimate.

Verification: forced build 19/19 clean. vitest browser 472 / cli 119 / capability-runtime 164 /
mcp-server 84 / sutradhar 15 = 854, 0 failures (one download-timing test flaked once under
full-parallel load, clean on repeat and in isolation -- pre-existing, unrelated). Live verify
(--skip-slow) 108/108 pass, 0 fail, 3 skip, run twice. Audit-3's full attack matrix re-run live
against fix-3 with the rates above.

GAP-235 (pre-existing adoptPopupPage crash) untouched, confirmed not to block anything above.

This is the last standard cycle for FR2-04 (4 of 4 used). If audit-4 fails with any critical or
major finding, FR2-04 moves to 2 escalation cycles per the loop's rules, then BLOCKED with a
diagnosis if those also fail. audit-4 should pay particular attention to: whether the
Target.opener()-based attribution generalizes beyond the popup/opener shape audit-3 demonstrated
(e.g. iframes, multiple popups from one opener, a popup that opens its own popup); whether GAP-240's
re-scoped false-block-without-close is actually livable for an agent driving the CLI; and whether
GAP-244's disclosed identity limitation is acceptable.

## 2026-09-27 -- FR2-04 audit-4: FAILED (3 major). All 4 standard cycles used; entering ESCALATION cycle 1 of 2.

audit-4 wrote findings progressively (audit-4/audit-findings.json), confirmed no leftover processes
or temp dirs, and independently re-measured everything rather than trusting fix-3's self-report.

The good news first: fix-3's Target.opener()-based attribution genuinely fixed all seven audit-3
defects it targeted (GAP-236..242), and held under a real attack pass beyond the shape it was built
for -- 3-level opener chains, two siblings with only one dialog, rapid-fire popups, noopener. The
underlying insight (a renderer blocked by a dialog can't create a newer target, so a missed dialog
is always in the newest target IF the warden is up and the dialog is real) is sound and was verified
directly: 18/21 attribution mutations killed by vitest, 2 more killed by audit-4's own live probe.

But the fix's OTHER half -- deciding a target is "isolated" (safe to leave alone) whenever it has no
blocked sibling -- turned out to encode an assumption that breaks in exactly the cases outside its
happy path:
- GAP-245 (major): when a sibling IS blocked but for an innocent reason (a slow sync XHR, no dialog
  anywhere), the "has a sibling" test alone still lets `dialog accept` close the healthy popup.
  Sibling-existence was being used as a proxy for "the sibling has a real dialog", and that proxy is
  wrong exactly when GAP-240 said it would be.
- GAP-246 (major): the flip side. A REAL dialog in a genuinely isolated renderer (an ordinary
  target=_blank link, or a cross-site popup that alerts during load, both of which the warden
  routinely misses) is now indistinguishable from a busy isolated script, so recovery refuses it
  entirely. Only `close` escapes, ending the whole session. This regresses fix-2's GAP-230 recovery
  for precisely the case FR2-04 exists to solve -- the isolated rule, built to stop GAP-240 from
  destroying tabs, went too far and now leaves real dialogs unrecoverable.
- GAP-247 (major): with the warden down, DirectCdpBroker has no per-target history at all, so
  "newest leaf holds it" degrades to a guess that is wrong whenever the dialog isn't in the newest
  leaf -- closing an innocent tab before eventually reaching the right one.

The common root: fix-3 tried to infer "safe to close" from CURRENT topology (has a sibling? is it
the newest?) instead of from HISTORY (has the warden's own dialog listener been confirmed active and
silent on this specific target?). audit-4's proposed fix for escalation is exactly that shift.

Also confirmed: GAP-243 (test integrity) was only partly closed -- 3 of audit-3's originally-named
surviving mutations (M22 lock read-back, M23 warden singleton, M26 closedTarget message) still
survive, because fix-3's own revert-confirm covered its OWN new changes, not the specific audit-3
mutations it was asked to kill. GAP-244's disclosed identity gap is real but judged minor and
acceptable once GAP-248 (stale pending lines after a handle) is cleaned up.

Per the loop's rules, FR2-04 has now used all 4 standard cycles (audit-1..4, fix-1..3) and enters
2 ESCALATION cycles. If escalation also fails, FR2-04 is marked BLOCKED with a written diagnosis
rather than continuing indefinitely.

Decisions for escalation-1 (binding):
1. Replace "has a blocked sibling / is the newest leaf" with a HISTORY-based rule: a target is
   safe to close (never a dialog holder) if the warden's Page.enable ack'd successfully AND at
   least one liveness probe after that ack found it responsive, at any point since. Such a target's
   dialog listener was live and silent, so any dialog on it would already be a tracked, typed event
   -- it structurally cannot be an untracked "unknown". This directly fixes GAP-245 (the busy
   opener/sibling has this history, so it's provably safe) without reopening GAP-236/238 (a genuine
   popup that has NEVER been confirmed responsive still gets attributed correctly).
2. Allow recovery for a target that has been unresponsive since the warden FIRST SAW it (never had
   the history from decision 1), even if it looks isolated -- this fixes GAP-246. The remaining,
   accepted false-positive is a brand-new tab that is busy from the instant of creation, which is a
   much narrower and rarer shape than "any isolated unknown".
3. GAP-247: with the warden down, DirectCdpBroker must not perform destructive recovery via a
   topology guess. Either refuse recovery and point at `close` (safe, minimal), or have `dialog`
   respawn/reattach to the warden before acting (better, matches the spirit of "the warden is the
   source of truth"). Pick whichever is smaller and prove it live across all three of audit-4's
   warden-down attribution attacks (opener, middle-of-chain, older-sibling).
4. GAP-248: don't reprint a dialog as pending after it has actually been handled; carry the
   holder/collateral distinction into `dialog`'s own output so an agent can see, before acting,
   which tab `accept` will close.
5. GAP-249/250: add tests that kill A13, A20, M22, M23 and M26 by name; make the verify script's
   GAP230 case assert WHICH tab was closed, not just that a close happened.
Escalation should re-run every attribution attack from audit-3 AND audit-4 (not just the new
decisions' own targets), since decision 1's history rule changes the safety logic for every path.

## 2026-09-27 -- FR2-04 escalation-1 executed; sent to independent audit-5

Executor (Sonnet) self-report, spot-checked by the Orchestrator (vitest browser 484 and cli 133
re-run directly: exact match; 0 leftover processes; git status matches the reported file list).

Core change: attributeDialogHolders no longer infers "safe to close" from CURRENT TOPOLOGY (has a
sibling? is it newest?). It now tracks, per target, whether the warden's Page.enable ack'd AND a
liveness probe afterward found it responsive at least once (confirmedResponsiveSince). A
confirmed-safe target is treated as a transparent pass-through in the attribution walk: never
itself a dialog holder, but it still connects its candidate children, so it can't accidentally
disconnect a real popup from consideration.

Notably, the executor found and fixed two of its own regressions mid-cycle rather than shipping a
narrower self-report than reality, which is exactly the failure pattern that has cost this item three
audits already:
- The first pass was reactive-only (confirmedSafe only set inside a CLI-triggered check). Its own
  live re-run caught rapid-gap100 closing an innocent sibling, because excluding a confirmed-safe
  opener from the graph also silently disconnected two candidate siblings from each other. Fixed by
  rewriting attribution as one resolve()/findRoot() walk.
- The GAP-246 fix (allow recovery for never-confirmed isolated targets) initially still failed
  xhr-isolated-manual (a busy isolated tab wrongly closed 3/3), because nothing proactively probes
  an idle target absent a CLI command. Fixed with a proactive probe: 500ms-delayed for new targets
  (so it doesn't reopen GAP-236's original attach race) but near-immediate for the session's
  pre-existing bootstrap tab (which isn't racing a first-script dialog).

GAP-247: chose to have DirectCdpBroker refuse ALL destructive recovery when the warden is down,
having confirmed live that the alternative (respawn-then-act) can't actually help -- Page.enable
can't ack a wedged renderer either way, so respawning buys no attribution information. Disclosed
trade: the one warden-down shape that used to work by luck (newer-sibling) is now also refused.
Zero wrong-tab closes across all 4 warden-down shapes tested (12/12), vs audit-4's wrong-tab-first
on 3 of them.

Full re-verification swept every audit-3 AND audit-4 attribution attack, not just the new GAP-245..
250 targets, per the escalation's broadened scope: 0 innocent closes, 0 wrong closes anywhere across
57 attribution trials, plus GAP-236/238/239/240/241/242 all re-confirmed holding.

Verification: forced build clean. vitest browser 484 / cli 133 / capability-runtime 164 /
mcp-server 84 / sutradhar 15 = 880, 0 failures (Orchestrator re-ran browser+cli independently,
exact match). Full live verify (not --skip-slow) 111 pass / 0 fail / 2 skip (same 2 parked skips as
audit-4). Process hygiene clean, no leftover wardens or temp dirs.

Residuals, disclosed up front:
1. A brand-new tab busy from the literal instant of creation (no chance to ever be probed
   responsive, even proactively) is still indistinguishable from a real dialog and remains
   recoverable/closable. Narrower than fix-3's blanket isolated-rule, not eliminated by
   construction -- audit-5 should try to reproduce this specific shape and judge if it's acceptable.
2. Warden-down: ALL destructive recovery is now refused unconditionally, including the one shape
   that used to work by luck. No wrong-tab closes in exchange -- audit-5 should judge if "always
   tell the user to use close when the warden is down" is an acceptable floor.

This is escalation cycle 1 of 2. If audit-5 fails with a critical or major finding, FR2-04 gets one
more escalation cycle (cycle 2 of 2); if that also fails, FR2-04 is marked BLOCKED with a written
diagnosis per the loop's rules.

## 2026-09-27 -- FR2-04 audit-5: FAILED, narrowly (2 major). Escalation 1 of 2 used; entering ESCALATION 2 (the last cycle before BLOCKED).

audit-5 wrote findings progressively; confirmed clean process hygiene; independently re-ran vitest
(880/880, matching escalation-1's own count) and the full live verify (111/0/2, matching). Both new
findings, and the minor ones, trace to ONE root cause, which the auditor pinned down with a direct
experiment rather than just asserting it.

Escalation-1 added a 500ms delay before proactively probing a NEW target, specifically to protect
against a stale-confirmation race: marking a target confirmed-safe before it's had a chance to show
a load-time dialog. audit-5 fired 63 real dialogs at every delay from 300ms to 1000ms, plus 15 rapid
reactive-poll trials around popup creation, and found ZERO cases where that race actually happens --
every dialog arrived as a tracked, typed event regardless of timing, because Page.enable acks and
Page.javascriptDialogOpening fires before the proactive probe's timer would ever mark the target
safe. The auditor then set the delay to 0 for every target (temporarily, sha-verified restore) and
re-ran every shape escalation-1's own decision cited as the delay's justification: 36/36 clean. The
delay the fix was built to protect a real race, and no evidence supports that the race exists; the
delay itself is what leaves a target unconfirmed (and therefore attributable/closable) for up to
500ms after creation, which is exactly the window GAP-251's two attacks exploit:
- GAP-251 (major): a popup under ~500ms old, whose opener runs a slow synchronous request, still
  gets closed as the wrongly-attributed holder -- 12/12 at gaps of 0-450ms, 0/3 once past 500ms.
- GAP-252 (major, a genuinely new shape, not just GAP-251 restated): two popups opened to a
  DIFFERENT origin than their (unblocked) opener share a renderer, but attributeDialogHolders only
  links opener<->child pairs -- with the opener itself never blocked, there's no root to anchor the
  pair, so BOTH popups report as "the holder" and accept closes the innocent older one first.
  Reproduces via ordinary CLI use (typing into a field that opens one cross-site popup per
  keystroke), 3/3. This is not something the 500ms delay alone explains; it's a gap in the
  attribution graph itself (unconfirmed candidates with no confirmed-safe anchor at all).
- GAP-253/254 (minor): message-accuracy leftovers -- naming the wrong tab in a note (never causes a
  wrong close) and an inconsistent warden-down refusal message.
- GAP-255 (minor, test-integrity): 6 of 22 new mutations survive, naming E3/E4/E6/E7 as the ones
  that matter (the rest are near-equivalent).

What holds, confirmed independently: every audit-3/4 attribution attack (84 trials, 0 innocent
closes), GAP-236/238/239/241/242 all still correct, GAP-246's core fix (real dialog in an isolated
renderer is recoverable, 9/9 vs audit-4's dead ends), GAP-247's warden-down refuse-always trade
(judged acceptable, matches spec 2.9's own recommended degraded path), and GAP-249/250's mutation
kills (A13/A20/M22/M23/M26 all confirmed dead).

Per the loop's rules, this was escalation cycle 1 of 2. FR2-04 now enters ESCALATION CYCLE 2, the
LAST cycle before the item is marked BLOCKED with a written diagnosis if this also fails.

Decisions for escalation-2 (binding):
1. Remove the 500ms delay. Probe every new target immediately once Page.enable has ack'd (the
   audit's own live data supports this directly: 36/36 clean at 0 delay across every shape that
   motivated adding it). Keep the underlying confirmedResponsiveSince/transparent-pass-through
   design from escalation-1 -- only the DELAY before the first proactive probe is being removed, not
   the confirmation mechanism itself. Pin this with a test at zero delay reproducing GAP-251's exact
   attack (opener sync-XHR at gap 0ms) and confirming no close.
2. Fix GAP-252: extend attributeDialogHolders so unconfirmed, unlinked candidates that share a
   renderer but have NO confirmed-safe anchor in their graph are never treated as independently
   correct holders. Either (a) require at least one candidate in a same-renderer group to be
   confirmed-safe before any of them can be closed via automatic/hinted recovery (refuse and list
   both, same spirit as GAP-247's refuse-when-ambiguous), or (b) link siblings by shared renderer
   process id in addition to opener/child, so an unblocked-but-present opener can still anchor them.
   Prove the choice against the exact CLI-reachable repro (typing into a field opening one cross-site
   popup per keystroke): 0 wrong closes, and confirm a genuine single popup (no sibling) is still
   correctly recoverable.
3. GAP-253/254: fix the message text so a note never names a tab that accept won't actually act on,
   and make the warden-down refusal message consistent with what 'dialog'/the hint say, without
   suggesting a retry path that can't work while the page is blocked.
4. GAP-255: add tests that specifically kill E3, E4, E6 and E7 by name.
Escalation-2 should re-run the FULL audit-3/4/5 attack surface (not just the new targets), since
removing the delay changes proactive-probe timing for every path, and the GAP-252 fix touches the
attribution graph itself.

## 2026-09-27 -- FR2-04 escalation-2 (LAST CYCLE) executed; sent to independent audit-6 (FINAL)

Executor (Sonnet) self-report, spot-checked by the Orchestrator (vitest browser 497 and cli 144
re-run directly: exact match). The Orchestrator also found and cleaned up two of the executor's own
leftover polling shells (stale watchers checking for a marker string that didn't match the actual
output format -- harmless, not wardens or Chrome, killed by specific PID after confirming their
command lines, not by image name).

Point 1 (GAP-251): the 500ms proactive-probe delay is removed entirely -- audit-5's own live
experiment (0 delay, 36/36 clean) is the direct basis. The probe still only fires after Page.enable
acks (the precondition kept); only the wait was removed. Re-verified across the full audit-5 timing
sweep (0/300/450/500/550/600/700/1000ms): 0 wrong closes, real dialogs always arrive as tracked
events.

Point 2 (GAP-252): chose linking (option b) over refuse-both -- an opener that is known but never
itself blocked is now a transparent pass-through anchor in attributeDialogHolders, the same
treatment escalation-1 gave a confirmed-safe node. This lets siblings anchor against each other
through it without requiring the opener to BE confirmed-safe. Verified against the exact
CLI-reachable repro (typing into a field that opens one cross-site popup per keystroke): 0/2 wrong
closes, the innocent tab survives.

Points 3/4: message accuracy fixed (a note never claims accept will act on a tab it won't); the
named audit-5 mutation survivors (E3/E4/E6/E7, reconstructed as equivalents since the literal code
they targeted no longer exists after the point-1 fix) are all now killed.

Full re-verification: audit-3/4 attack surface 28/28 (0 innocent closes); audit-5 surface 58/61
clean, 3/61 hit a residual (below); vitest 904 total (browser 497 + cli 144 + capability-runtime
164 + mcp-server 84 + sutradhar 15), 0 failures; full live scenario suite (not --skip-slow) 111
pass / 0 fail / 2 skip -- identical counts to audit-4 and audit-5.

RESIDUAL, carried forward unchanged, NOT new: a popup whose own first script (parsed synchronously,
zero elapsed time after creation) starts blocking work is still closed as an apparent dialog holder
even though none exists. This is structurally unfixable by any probe delay, including zero, because
it requires zero real time to exist. It is exactly escalation-1's original disclosed residual #1,
untouched by this cycle, and was not one of GAP-251 or GAP-252's targeted shapes. The Orchestrator
flags this explicitly for audit-6 to judge, since this is the last chance before BLOCKED and the
Orchestrator does not get to decide DONE-worthiness unilaterally on the last cycle.

This is escalation cycle 2 of 2 (the last one). If audit-6 finds a critical or major defect, FR2-04
is marked BLOCKED with a written diagnosis per the loop's rules -- no further cycles. If audit-6
passes, FR2-04 is DONE and the loop moves to the next item.

## 2026-09-27 -- FR2-04: BLOCKED. Final audit (audit-6) FAILED after 4 standard + 2 escalation cycles. Written diagnosis below.

audit-6 was the last cycle available under the loop's rules (4 standard cycles: audit-1..4/fix-1..3;
2 escalation cycles: audit-5/escalation-1, audit-6/escalation-2). It found the attribution redesign
from escalation-1/2 genuinely holds under very broad attack -- 4- and 5-level opener chains, three
siblings with an opener closed mid-sequence, cross-origin navigation of a confirmed target, two
independent CLI sessions, a confirmed target that later hangs from an infinite loop rather than a
dialog -- all correct, 0 wrong closes across every one of these new shapes plus a full re-run of
every prior audit's attribution attacks (56+58 trials). The disclosed residual from escalation-1/2
(a popup busy from the instant of its own creation) was judged ACCEPTABLE to ship with, once
documented and its true scope (wider than disclosed: also an opener that starts blocking work right
after opening a popup, and plain links, not just a popup's own inline script) is stated honestly.
That residual is NOT why this item is blocked.

Two things are why:

**GAP-256 (major, a real regression from this branch, not merely an unclosed gap): a crashed tab
permanently locks the whole CLI session.** No dialog is involved. A crashed renderer never answers
the liveness probe (it's dead, not busy), so it reads exactly like an "unknown dialog" forever.
GAP-247's own refuse-when-ambiguous design (built in escalation-1 specifically to stop destructive
recovery from guessing wrong) then means `dialog accept/dismiss` correctly REFUSE to touch it -- but
nothing else can either, because `tabs` and `closetab` are themselves gated behind the same check.
The only escape is `close`, which destroys the entire session. The pre-FR2-04 CLI recovers from an
identical crash in one command. This is a straightforward regression against spec.md 2.8.2 step 1,
which says a blocked tab with no known dialog should be treated as busy and the gate should let the
command through -- FR2-04's gate does not implement that distinction; it only distinguishes "is a
dialog open" from "is a dialog possibly open", never "is anything ever going to answer".

**GAP-257: the GAP-252 fix (link same-renderer siblings through their shared opener) only holds
while the opener stays open.** If the opener itself closes after spawning several popups -- e.g. a
compose window that opens child windows then closes -- the anchor is gone and the exact GAP-252
failure mode returns: unlinked, unconfirmed siblings, and `dialog accept` may close the innocent
one. This is not a new class of bug; it's the same one only partially closed, in a shape (opener
closing itself) that is ordinary browser use.

**Root cause, spanning both**: every cycle on this item has patched one edge of the same underlying
inference problem. The system has exactly one signal -- "did this target answer a liveness probe" --
and uses it for two different decisions that need different answers: (a) should the CLI GATE block
this command at all, and (b) if something needs to be closed to recover, WHICH target is it safe to
close. A crashed tab and a busy tab and a dialog-holding tab all look identical to that one signal
(none answer), so (a) can't tell "genuinely stuck forever" (crash) apart from "busy but will finish"
(GAP-240's accepted residual) apart from "holding a real dialog" -- it currently treats all three the
same (block, forever, in the crash case). And (b) can't identify a holder once its only anchor
(the opener) is gone, because the anchor was topological, not intrinsic to the target itself.

**Architectural changes that would actually close this (not more patches -- these are the audit-6
diagnosis, recorded for whoever picks this up next):**
1. The gate must stop treating "never answered" as sufficient reason to block forever. It needs a
   THIRD state distinct from "confirmed clear" and "confirmed dialog": a bounded number of retries
   or a longer timeout past which an unanswering target is treated as busy/dead and the gate
   proceeds (matching spec 2.8.2 step 1 literally), rather than blocking indefinitely on ambiguity.
2. `tabs` and `closetab` must have a code path that NEVER depends on the gate or on attaching to
   the blocked target at all -- serve them from browser-level Target.getTargets/Target.closeTarget.
   This alone would have let a user recover from GAP-256 without losing the whole session, even
   without solving the gate's classification problem.
3. Give the warden its own Target.setAutoAttach with waitForDebuggerOnStart on every new target
   (not just page-level Page.enable after the fact), so a URL-navigating popup has its dialog
   listener live before its first script executes at all. This would make "blocked but no dialog
   event ever fired" mean busy, unambiguously, for that class of target -- closing the gap the
   liveness probe structurally cannot close on its own (confirmed by audit-6's own signal
   comparison: dialog-from-birth and busy-from-birth are indistinguishable across every CDP signal
   it tried, because the only real discriminator is whether a listener existed before the first
   script ran, which is exactly what this would provide).
4. Replace "an ambiguous accept/dismiss guesses which target to close" with an explicit
   `dialog close <targetId>`, verified against `tabs`' own listing, so the tool never has to guess
   among several unconfirmed candidates at all -- GAP-236/246/252/257 are all different faces of
   "the tool guessed which of several candidates to close"; removing the guess removes the whole
   family.

**What holds, confirmed one final time**: GAP-236 (wrong-tab-close), GAP-238 (blank-popup-invisible),
GAP-239 (false-exit-3), GAP-241 (many-blocked, flat to 40 tabs), GAP-242 (chain-limit records),
GAP-246 (isolated real dialog recoverable), GAP-253/254 (message accuracy) are all independently
re-verified as fixed. vitest 904/904. Full live scenario suite 111 pass / 0 fail / 2 skip, unchanged
across the last three audits.

**Limitations this item would ship with, if unblocked in the future**: the residual (busy-from-birth,
wider than originally disclosed -- also an opener blocking right after opening a popup, and plain
links), GAP-235 (pre-existing, out of scope), GAP-244 (tab identity in messages), GAP-247's
warden-down refuse-always trade, and now GAP-256/257 above.

**Status: FR2-04 is BLOCKED.** Per the loop's rules (4 standard cycles + 2 escalation cycles, then
BLOCKED with a diagnosis), no further fix cycle is being dispatched. This diagnosis, GAP-256/257 and
the architectural changes above are the handoff for whenever this is picked up again -- likely as a
new, differently-scoped item (e.g. "dialog gate: bounded busy/dead detection + non-attaching
tabs/closetab" as its own spec) rather than another patch cycle on the current design, per CLAUDE.md's
guidance that a multi-day rework belongs in the backlog rather than being built reflexively.

CORRECTION (2026-09-27): the line below originally claimed escalation-2's source diff was never
committed -- that was wrong. `git show --stat 36eefa4` confirms the actual dialog-cdp.ts/dialog-warden.ts/
cli.ts/dialog-broker.ts/dialog-cli.ts source changes from escalation-2 ARE committed at 36eefa4, same
as every other cycle's code. Only the diagnosis/evidence commit (3bd520c) added no further source
changes. FR2-04's dialog machinery (DialogPolicy, resolveDialogPolicy, session-flow.ts, dialog-cli.ts,
etc.) is present on disk at HEAD, unlike FR2-03's fix-4 (genuinely never committed) which the original
sentence below was probably echoing from memory of a different item. The Orchestrator will decide, when preparing the final PR,
whether to ship FR2-04 in its current (escalation-2) state with GAP-256/257 documented as known
issues, revert it to pre-FR2-04 behavior, or leave it out of the PR entirely -- this needs a
decision at PR-prep time, not now, since other FR2 items are unblocked by FR2-04 landing at all
(FR2-05/07/08/13/14 per spec-amendment-1) regardless of whether the dialog warden itself is perfect.

## 2026-09-27 -- FR2-05/FR2-14's hard dependency on FR2-04's code: proceed, don't hold

Correction first: the BLOCKED entry above wrongly said escalation-2's source was never committed.
It was, at 36eefa4 -- FR2-04's dialog machinery (DialogPolicy, resolveDialogPolicy, dialog-cli.ts,
session-flow.ts, warden-control.ts, dialog-warden.ts, dialog-cdp.ts, dialog-broker.ts) is present and
committed at HEAD, same as every prior cycle. Confirmed via `git diff HEAD` on those files (empty).

FR2-05's spec (section on merge touchpoints with FR2-03/FR2-04) and FR2-14's spec (dependency table,
row FR2-04: HARD for the `dialog` key, needs DialogPolicy/DialogPolicyMode/SutradharRuntimeOptions.
dialogPolicy/CliState.dialogPolicy/resolveDialogPolicy) both have a HARD dependency on this code
EXISTING, not on FR2-04 being bug-free. Neither spec touches the dialog gate's blocking/attribution
logic (dialog-warden.ts's liveness probe, attributeDialogHolders, or the crash-lockout path) --
FR2-05 only needs `SutradharRuntimeOptions.dialogPolicy` as a config field to plumb its own download/
upload root options alongside; FR2-14 only needs the same shape to map its `.sutradhar.json` `dialog`
key onto. GAP-256 (crashed tab locks the session) and GAP-257 (opener-closed sibling misattribution)
are both specifically in the blocking/attribution decision, not in the config surface these two items
read from.

Decision (Orchestrator, user explicitly delegated this call): FR2-05 and FR2-14 PROCEED on top of
FR2-04's code as committed, once they're otherwise ready to develop. Each item's own evidence
directory must note, at DEVELOP time, that it depends on FR2-04 (BLOCKED, GAP-256/257 unresolved in
the dialog gate itself, unrelated to what this item reads from that code) as a known, accepted
dependency risk -- not silently. If either item's own testing surfaces any interaction with the
blocking/attribution logic (e.g. a download that's gated behind an open dialog and hits GAP-256's
lockout), that's a NEW finding against FR2-04, logged as its own GAP, not something FR2-05/14 are
expected to fix.

## 2026-09-27 -- FR2-12 DEVELOP run-1 done; sent to independent audit-1

Executor (Sonnet) built FR2-12 (machine-readable audit) per its 1118-line implementation spec.
Orchestrator independently re-ran vitest for all 4 touched packages: capability-runtime 192,
cli 161, mcp-server 92, sutradhar 20 -- exact match to the self-report. Typecheck 34/34, full
turbo build clean. git status matches the reported file list exactly, no leftover processes.

Summary: audit-report.ts (new) defines the AuditReport shape and a committed JSON schema;
site-audit.ts rewritten around a buffered PerformanceObserver read (Branch B, chosen via a
mandatory Step-0 live experiment against the pre-change build, run BEFORE any code edit); CLI/MCP/
SDK all wired (cmdAudit rewrite, browser.audit MCP tool, Page.audit() SDK method). Step-0 also
independently reproduced two known contamination bugs (B1: a noisy page's console errors leak into
a later clean-page audit; B2: CLS accumulates across audits within one MCP/SDK session, not the
CLI) as real, live-confirmed findings rather than assumptions.

Live verify: 25 pass, 0 fail, 1 info (GAP-038, correctly left open pending FR2-08, not asserted).
Two real bugs were found and fixed during the executor's own live-verify pass rather than shipped:
a missing /favicon.ico route polluting a "clean page" fixture, and a cross-process timing race on
one layout-shift case. Revert-and-confirm: reverting the core scopeToDocument logic to a no-op
makes RA3 and AR10 fail (confirmed real regression, not a type error), restored and re-passing,
sha-verified.

4 disclosed deviations from spec, stated plainly rather than hidden: FR2-07's JSON-output switch
doesn't exist yet so dialogPending/dialogsHandled are left off every report (a pre-existing,
whole-CLI gap, not introduced here); AR7 rewritten because process.chdir() isn't available in
vitest workers; AUDIT_REPORT_EXAMPLE exported from capability-runtime's public index (not in the
spec's list) so other packages' tests could reach it without a blocked deep-import; one combined
live-verify JSONL instead of three separate per-surface files.

Sent to independent audit-1 (maker != checker).

## 2026-09-27 -- FR2-12 audit-1: FAILED (1 critical, 1 major). Cycle 1 of 4 standard.

Most of FR2-12 held up under an adversarial, live-reproducing audit: web-vitals numbers matched a
live observer exactly across 18 trials (fast/slow/late-content/single-shift/10-shift pages, current-
page mode); B2 (CLS accumulating across audits in one session) is genuinely fixed, confirmed 3/3;
edge cases (redirects, about:blank, a page throwing errors, a 404'd audit target, an unreachable
baseline, two concurrent audits with no cross-tab leakage, outDir pointing at a file) all behaved
correctly; the committed JSON schema matches spec section 2.4 exactly and correctly accepts every
real report and rejects 18/18 deliberately broken ones (except the status>599 case below); GAP-038
being left open is legitimate (spec D7 forbids a private settle-logic copy before FR2-08 lands, and
the auditor independently reproduced the miss). vitest counts matched exactly across all 5 packages,
independently re-run by the auditor. 3 of the 4 disclosed deviations were judged reasonable.

But two real defects, both against explicit spec requirements, not just nice-to-haves:

1. GAP-261 (critical): 'audit --json''s output is not valid JSON whenever a dialog fires during the
   audit. An accept policy appends a dialogHandled line after the JSON on stdout (breaking any
   parser); a default policy replaces the JSON entirely with a dialogPending line and exit 3. The
   spec's own risk R3 anticipated exactly this and said to stop and report if dialog output couldn't
   be suppressed in JSON mode -- it shipped as an undisclosed-as-broken "deviation" instead, with the
   changelog saying nothing about it. This is not an edge case for a tool meant to be driven by other
   programs: any audited page that can show a dialog (which is most real pages) breaks the one-JSON-
   document guarantee that's the entire point of a machine-readable audit.

2. GAP-262 (major): B1 (a noisy page's console/network activity contaminating a later clean-page
   audit) is only PARTLY fixed, not fixed as the changelog claims. The fix scopes by when navigation
   STARTS, but the old page keeps running (and can keep logging/fetching) until the new page's first
   response arrives -- so anything the old page does in that window is still wrongly attributed to
   the new page's report. Reproduces 10/10 via the runtime directly and 3/3 via the CLI, and still
   leaks at a completely ordinary 150ms response time (5/5), not just an artificially slow one. This
   causes a real, false failure mode: `audit <clean-page> --json --fail-on-diff` exits 1 on a
   genuinely clean page purely because of what ran on a PREVIOUS page in the same session. Spec
   sections D9/D10 require this fixed in this item, not deferred -- there's no ambiguity to resolve
   about scope here, it's an incomplete fix of something the spec already decided must be fixed.
   The auditor verified a cheap correct fix: scope by the new page's main-frame COMMIT time
   (framenavigated), not navigation-start -- 0/10 leaks with that change, and the clean page's own
   real errors are still correctly kept every time.

Minor: GAP-263 (schema rejects a real status code above 599, e.g. 999), GAP-264 (RA4 test-integrity
gap -- removing navStartedAt from scoping passes all 192 tests), GAP-265 (the executor's own
live-verify script leaks a headless Chrome in case N3, no close() call -- reproduced by the auditor,
who killed it by PID and removed its temp dir; process hygiene note, not a product defect).

Decisions for fix-1:
1. GAP-261: keep dialog output off stdout entirely in --json mode. Either route dialogPending/
   dialogHandled lines to stderr, or fold them into the report's own dialogPending/dialogsHandled
   schema keys (which the schema already has room for, per the spec's own D2.4 -- the deviation note
   said these keys are "left off every report" because FR2-07's JSON switch doesn't exist yet, but
   that reasoning only explains omitting the KEYS, not explains printing raw dialog text to stdout
   underneath valid JSON). Add live cases for both the accept-policy and default-policy shapes,
   plus the mid-audit-alert case, all under --json.
2. GAP-262: switch the contamination-prevention scope boundary from navigation-start to the new
   page's main-frame commit time (framenavigated event). Add a live case with a noisy old page (logs
   an error and fetches a 404 on a short interval) followed immediately by a clean page at a normal
   (not artificially slow) response time, repeated enough times (at least 10) to catch the
   flakiness the auditor found in the executor's own L12 case (failed 1/30 repeats).
3. GAP-263: accept status codes above 599 in the schema (HTTP status is not actually bounded to 599
   by any spec Sutradhar controls; sites like LinkedIn use codes like 999).
4. GAP-264: strengthen RA4 to actually exercise the navigation-time scoping boundary.
5. GAP-265: add the missing close() call to live-verify case N3.

## 2026-09-27 -- FR2-12 fix-1 done (rough patch mid-cycle); sent to independent audit-2

fix-1 fixed GAP-261 and GAP-262 (the audit-1 critical/major), plus GAP-263/264/265. It hit real
trouble along the way that's worth recording plainly, not smoothing over:

- The GAP-262 fix went through TWO passes. The first pass (commit time via framenavigated) still
  leaked, because the actual bug was a min(navCommittedAt, documentStartedAt) that kept silently
  re-picking the too-early navigation-start value whenever there was real network latency -- exactly
  reproducing audit-1's original finding despite the "fix" being in place. The second pass dropped
  the min() entirely. This is a second instance of this loop's recurring pattern (a fix that looks
  complete but leaves the actual mechanism half-changed) -- caught this time within the same cycle,
  before it reached audit, because the executor's own live-verify (L12b) kept failing until the real
  cause was found.
- The GAP-262 revert-confirm harness itself got stuck THREE times over about 5-6 real hours: once
  before the Orchestrator intervened (found the source was correctly restored despite the hang, then
  killed it by PID and rebuilt), and once after a first re-attempt that hit a genuine Puppeteer
  navigation timeout the Orchestrator couldn't quickly explain either. Rather than keep retrying a
  broken harness, the Orchestrator ran the fix's own repro directly (single trial: 0 leaks in
  ~1.7s; then a clean 10x repeat: 0/10) and told the executor to stop debugging the harness and cite
  that plus L12b (0/15) as the evidence instead. GAP-262 is fixed, confirmed by three independent
  clean measurements; the revert-confirm SCRIPT (not the fix) has an unresolved tooling bug, logged
  as KNOWN-ISSUE-revert-confirm-gap262-harness.md in fix-1/'s evidence, not as a product defect.
- SELF-REPORT ERROR CAUGHT: the executor's final report claimed capability-runtime vitest at 130
  passed. The Orchestrator independently re-ran it: 193 passed. All other 4 packages' counts (cli
  161, browser 498, mcp-server 92, sutradhar 20) matched exactly. 130 appears to be a stale or
  partial run captured into the report by mistake -- not a real regression (the true count is higher
  than before, not lower), but exactly the kind of inaccurate self-report this loop's audits exist to
  catch, and it's being flagged here explicitly rather than silently corrected and moved past.

Disclosed residual (not silently re-accepted): dropping the min() also drops the OLD fix's
same-document/hash-navigation protection, since framenavigated fires for a same-document nav too.
No live case in this cycle exercises that combination. audit-2 should probe it directly.

git status matches the reported file list exactly; no leftover processes (Orchestrator independently
confirmed after killing the one hung revert-confirm process by PID).

Sent to independent audit-2.

## 2026-09-27 -- FR2-12 audit-2: FAILED (3 major). Cycle 2 of 4 standard.

audit-2 confirmed both audit-1 findings are genuinely fixed (0/21 GAP-262 leaks runtime-direct
across 6 different response delays, 0/15 via the real CLI; GAP-261's default/accept/persisted
dialog shapes and most alert timings all give exactly one JSON document with dialog text on
stderr) -- but fix-1's own changes introduced three NEW major defects, all root-caused with
evidence, not just observed:

1. GAP-266: fix-1's GAP-262 fix (dropping min(navCommittedAt, documentStartedAt)) over-corrected.
   Puppeteer fires framenavigated for SAME-DOCUMENT navigations too (history.replaceState/
   pushState, hash changes), and with no same-document filter, a page doing this during its own
   load now has its OWN real errors/broken-requests silently dropped from the report, while
   coversWholeDocument still claims true. This is NOT the narrow disclosed residual it was framed
   as -- audit-2 live-audited 10 real sites and found 8 of them do exactly this during initial load
   (nextjs.org, react.dev, vercel.com, github.com, npmjs.com, vuejs.org, angular.dev, svelte.dev),
   which is precisely the window where most hydration errors and asset 404s happen. Causes a false
   CI pass: `audit <page> --json --fail-on-diff` exits 0 on a page that genuinely has errors.
2. GAP-267: same root cause, a different symptom -- the AUDITED PAGE'S OWN error status (a 404/500
   on the page itself) is now missing from brokenRequests, because its response arrives just before
   the commit event that the scope boundary is keyed on. Audit-1 had explicitly listed this case as
   passing before fix-1 touched this code.
3. GAP-268: GAP-261 is still incomplete for one specific timing window -- an alert opening during
   the audit's OWN capture phase (screenshot/evaluate, not the initial wait) makes two separate code
   paths both write a JSON document to stdout (the session's pre-emption branch, then fix-1's own
   new catch handling the abandoned audit's later "Target closed" failure). Confirmed via mutation
   that simply deleting fix-1's new catch does NOT fix this -- the two writers need actual
   coordination, not one-sided removal.

Plus minor test-integrity gaps (GAP-269: 3 mutations, including one that breaks JS redirect chains,
survive every unit test) and a cosmetic pre-existing build race (GAP-271, already known elsewhere).

Root-cause note for fix-2: GAP-266/267 are the SAME underlying mistake (a commit-time boundary with
no same-document filter, applied without also explicitly capturing the main document's own response)
manifesting two ways. audit-2's proposed fix direction: use CDP's actual cross-document navigation
signal (Page.frameNavigated filtered to real document changes, not Puppeteer's framenavigated which
fires for both), keep the LAST cross-document commit so multi-hop JS redirect chains still resolve
to the final page, and separately, explicitly include the main document's own response in
brokenRequests regardless of the scope boundary (its own load failure is definitionally part of
"this page's audit", not contamination from a previous page).

Decisions for fix-2:
1. GAP-266/267: switch the navigation-event filter to real cross-document commits only (verify
   which Puppeteer/CDP event actually distinguishes this -- audit-2's own probe data on JS redirect
   chains and 302 chains is a good starting point for what already works). Explicitly capture the
   main document's own response/status separately from the console/network scoping logic, so a
   404/500 on the audited URL itself is never filtered out regardless of timing. Add live cases for:
   a page doing replaceState/pushState/hash-change during its own load (with a real console error
   before AND after the same-document nav, confirming both are kept); a page whose own response is
   404/500; the 8-real-site sweep audit-2 ran, or an equivalent synthetic version of it.
2. GAP-268: coordinate the two stdout-writing paths so exactly one writes when an alert opens during
   capture -- add a live case with the alert specifically in the 1500-1600ms window (audit-2's own
   repro), repeated enough times to be confident (10+).
3. GAP-269: add unit tests that kill M3 (main-frame filter), M4 (last-vs-first event), and the
   GAP-261 CLI-path mutations M6-M9.
4. Given fix-1 already needed two internal passes and this is now audit-2's finding on top, fix-2
   should re-run EVERY audit-1 AND audit-2 repro before reporting done, not just the newly-targeted
   ones -- this loop's pattern on this item specifically is fixes that solve the named case while
   quietly breaking an adjacent one.

## 2026-09-27 -- FR2-12 fix-2 done; sent to independent audit-3 (cycle 3 of 4 standard)

Executor (Sonnet) self-report, independently spot-checked by the Orchestrator (vitest
capability-runtime 198 and cli 171 re-run directly: exact match; git status matches the reported
file list exactly, including that run-1/audit-1/audit-2/fix-1/spec.md are untouched; 0 leftover
processes).

GAP-266/267 (one root cause): the navigation-event listener now uses a raw CDP session subscribed
ONLY to Page.frameNavigated on the main frame, never Page.navigatedWithinDocument (CDP's own
same-document-nav signal) -- so history.replaceState/pushState/hash changes can no longer move the
scoping boundary. Separately, the main document's own HTTP response is now captured UNSCOPED
(immune to any timing boundary), fixing GAP-267 independently of the same-document-nav fix. Found
along the way: browser-tab.ts's response log was missing resourceType on response entries (only
request entries had it) -- without this the GAP-267 lookup could never match a document response;
fixed live, not something the original plan anticipated. Live: 10/10 x3 same-doc shapes (replaceState/
pushState/hash), 5/5 multi-hop, 10/10 synthetic 8-real-site pattern, 10/10 own-404, 10/10 own-500,
10/10 302-chain, 5/5 JS-redirect-chain-still-resolves-correctly, 0/10 GAP-262 not reopened.

GAP-268: during its OWN re-verification, the executor found fix-1's framing (two writers) was
incomplete -- there's a THIRD shape where the pre-empted work actually SUCCEEDS (not just fails with
"Target closed") after a dialog opens, because headless Chrome can complete a screenshot/evaluate
even under an open alert. That success path's own console.log was an unguarded third writer, caught
live at 2/15 trials. Fixed by unifying ALL of --json's stdout-writing through one
writeJsonStdoutOnce() guard, not just coordinating the two originally-named writers. This is exactly
the kind of adjacent-bug-while-fixing-the-named-one pattern decisions.md flagged for this cycle to
watch for -- caught by the executor's own thoroughness before it reached audit-3, not by another
audit finding it. Live: 30/30 exactly one doc across the 1500-1595ms sweep, 10/10 with two dialogs
(alert+confirm) during capture.

GAP-269/271 also fixed, with mutation-kill evidence.

Full re-verification: audit-1's full live-verify script re-run twice (mid-fix and final): 29 pass /
0 fail / 1 info (GAP-038, unchanged), identical both times. vitest capability-runtime 198 (+5) / cli
171 (+10) / browser 498 / mcp-server 92 / sutradhar 20, all green.

Disclosed, not hidden: a process-hygiene incident (a malformed background command wrote into the
protected run-1/ directory; caught via git status, restored via git checkout, confirmed clean
afterward -- no evidence file was actually left modified). A latent, same-shaped bug NOTED but left
unfixed as genuinely out of this item's scope: `snap --json` has the same withSession race but its
own success write isn't routed through the new guard -- not touched by any FR2-12 spec/gap, flagged
for a future item rather than scope-creeped into this one.

Sent to independent audit-3.

## 2026-09-28 -- FR2-12 audit-3: FAILED (2 major, 2 minor, 1 tracking). Cycle 3 of 4 standard.

audit-3 confirmed fix-2's CDP-based mechanism genuinely fixed GAP-266 (same-document nav no longer
drops the page's own errors) under very broad attack -- interleaved same/cross-document navs,
sub-frame navigations happening concurrently, meta-refresh/JS/HTTP redirect chains including mixed
shapes, 25 repeated audits in one session with no CDP session leak, GAP-262 not reopened, the 8
real sites and their synthetic equivalent all correct (395 sessions created across all runs, all but
one detached cleanly -- the one exception is A3-3 below). GAP-268's fix also held up to a much wider
sweep than fix-2's own 1500-1595ms window (0-3000ms in 100ms steps, 93/93 exactly one document) and
a 4th shape search (a dialog racing the write itself is structurally impossible -- the guard is a
synchronous check-and-set and console.log to a pipe is synchronous on Windows). Everything audit-1/
audit-2 had confirmed solid (web-vitals, B2, concurrency, schema) still holds.

But two real defects:

1. GAP-273 (major): GAP-267's fix (fix-2's own-response fallback) matches by exact STRING EQUALITY
   against the final page.url() -- so it still drops the page's own 404/500 whenever the final URL
   differs from the response URL, which happens in ordinary shapes: the page sets location.hash,
   calls history.replaceState, or Chrome shows its own error page for an empty-body error response
   (report.url becomes chrome-error://chromewebdata/, which obviously never matches any real response
   URL). 0/10 or 0/6 across 4 such shapes, all previously working before fix-1 touched this code. This
   is the SAME underlying defect class as the original GAP-267 finding, just a shape the string-match
   approach didn't anticipate -- the fix needs to identify the main document's response by the
   navigation ITSELF (the response object page.goto() returns, or watching for a main-frame Document
   response on the CDP session), not by comparing URLs after the fact.
2. GAP-274 (major, a NEW regression introduced by fix-2's own change): the new per-audit CDP session
   waits on Page.enable before proceeding, and Chrome can hold that indefinitely under two real
   conditions -- an open dialog on the current page (~31s hang, until the CDP default dialog-dismiss
   timeout) or a previous navigation that timed out with no response (180-200s+ hang, even for a
   healthy next target). The error path also leaks the session on the 180s case (cleared before
   detach runs). This exact hazard -- a fresh Page.enable blocking under these conditions -- is
   ALREADY DOCUMENTED elsewhere in this codebase (dialog-cdp.ts:425-427 deliberately doesn't await it
   for precisely this reason) -- fix-2 re-introduced the hazard that other code in this same repo
   already knows to avoid.

Plus GAP-275 (minor, pre-existing ring-buffer-size limitation newly exposed by GAP-267's fix
depending on that buffer) and GAP-276 (minor test-integrity -- several mutations, including removing
the entire commit-boundary mechanism, pass every unit test and are only caught by live scripts).
GAP-277 (cosmetic/tracking): confirmed the disclosed snap --json latent bug is real and accurately
characterized as out of scope; logged to gaps.md so it isn't lost, not assigned to this item.

Decisions for fix-3:
1. GAP-273: replace the final-URL string-match with identification by NAVIGATION -- either capture
   the response object that page.goto()/the navigation promise itself returns, or watch the CDP
   session for the main-frame's own Document-type response directly (not a look-up after the fact).
   Add live cases for all 4 of audit-3's exact repro shapes: hash-setting 404, replaceState 404,
   empty-body 404, empty-body 500 (chrome-error:// case).
2. GAP-274: don't block on Page.enable without a bound -- either fire-and-forget it (matching
   dialog-cdp.ts's existing precedent for exactly this hazard) or race it against a short timeout and
   proceed regardless. Fix the session leak on every error path (detach must run even when the
   session reference would otherwise be cleared first). Add live cases for both hang shapes (open
   dialog before audit(); a timed-out prior navigation before audit()) confirming audit() no longer
   stalls beyond a bounded, short window.
3. GAP-276: add tests that kill the specific survivors named: removing the whole commit-boundary
   mechanism, the 3 own-status lookup variants, dropping resourceType from response-log entries, and
   bypassing the guard at cli.ts's 3 call sites specifically (test how cli.ts calls the helper, not
   just the helper in isolation).
Re-run the full audit-1/2/3 attack surface before reporting done, per this item's now-established
pattern of a fix solving the named case while quietly leaving or creating an adjacent one.

## 2026-09-28 -- FR2-12 fix-3 done; sent to independent audit-4 (cycle 4 of 4 standard, LAST STANDARD CYCLE)

Executor (Sonnet) self-report, independently spot-checked by the Orchestrator (vitest
capability-runtime 204 re-run directly: exact match; git status matches the reported file list
exactly; 0 leftover processes).

GAP-273: the own-response fallback now captures the main document's response LIVE off the CDP
session (Network.responseReceived filtered to the main frame's Document-type response, tracked via
Page.frameNavigated), keeping the last such response for redirect-chain correctness. This never
depends on the final page.url() lookup that broke under hash-changes, replaceState, and Chrome's own
chrome-error:// substitution for empty-body error responses. Live: 10/10 x4 audit-3 repro shapes via
runtime.audit directly, 6/6 via the real CLI --json, plus 2 controls 10/10. Revert-confirm
reproduces the exact original symptom (hit:false on hash-404 and empty-body-404) when reverted,
sha-verified restore.

GAP-274: Page.enable/Network.enable/getFrameTree are now raced against a 1s bound via a new
boundedFireAndForget() helper, explicitly matching the EXISTING precedent for this exact hazard
already in dialog-cdp.ts:425-427 (the executor was told to reuse that pattern, not invent a new one,
and did). The session-leak bug (67 created/66 detached on audit-3's 180s path) is fixed by splitting
"the client that must be detached" from "whether commit-tracking is usable" -- fix-2's bug cleared
the only reference to an undetached session inside a catch block that ran on any post-creation
failure.

DISCLOSED EVIDENCE GAP, not hidden: the executor's live revert-confirm attempt for GAP-274 (removing
the bound, then reproducing an open dialog / a timed-out prior nav) did NOT reproduce a hang in its
environment -- both cases returned in ~2.5s even unbounded, which differs from audit-3's own
measurement of a ~29.5s Page.enable hang under the same conditions. The executor could not pin down
the environmental difference in its time budget. It substituted unit tests with a MOCKED
never-resolving and a mocked rejecting Page.enable (both pass, both confirm the session is still
detached and audit() still returns quickly) as deterministic evidence instead of the live repro. This
is real engineering (the fix is correct either way -- near-zero overhead if no hang occurs, a hard
cap if one does), but it means the ORIGINAL live hang from audit-3 has not been independently
re-confirmed as actually fixed via a live run, only via a mock and via the (differently-timed) fix-2
regression not reproducing this time. audit-4 must attempt this live repro independently, with its
own timing measurements, before this can be considered closed.

GAP-276's third item (cli.ts's 3 call-site mutations) was explicitly NOT done this cycle -- disclosed
as out of time budget and orthogonal to this cycle's two targets, not silently dropped.

Full re-verification: audit-1's live-verify (29/0/1, unchanged), fix-2's own live-verify script
re-run via a copy with fix-3's own evidence dir (all pass -- GAP-266/267/268/262-not-reopened), and a
new fix-3 sweep (18/18 twice). vitest capability-runtime 204 (+6, independently re-run and matching)
/ cli 171 / browser 498 / mcp-server 92 / sutradhar 20, all green.

Disclosed process-hygiene incident: an early version of the verify script used the wrong CLI
state-dir env var, leaking one dialog-warden process into the shared default state dir; found via
the baseline/after diff, killed by PID (command-line matched to this worktree), script fixed.

Sent to independent audit-4 (LAST STANDARD CYCLE -- if this fails with a critical/major finding,
FR2-12 moves to escalation per the loop's rules).

## 2026-09-28 -- FR2-12 audit-4: FAILED (1 major). All 4 standard cycles used; entering ESCALATION cycle 1 of 2.

Good news first: audit-4 independently RE-VERIFIED both of fix-3's targets, adversarially, and both
hold. GAP-273 (own-response-status via live CDP capture): 170/170 across 17 shapes including new
attacks audit-4 devised (a redirect followed by a same-document nav; a slow/large/late-headers body;
a redirect chain with an error in the MIDDLE hop; an error iframe under a healthy page), plus 50/50
via the CLI. GAP-274 (bounded Page.enable): audit-4 root-caused WHY fix-3's own live revert-confirm
couldn't reproduce a hang -- fix-3's test script's re-import only cache-busted index.js while Node
kept the already-loaded runtime.js module, so its "unbounded" measurement was silently still running
the bounded code (confirmed via probe-esm-cache.json). audit-4 then reproduced the REAL original hang
cleanly in a genuinely fresh process with the bound actually removed: 3/3, matching audit-3's own
~29.5-31s measurement exactly. With the bound restored, the same conditions resolve in ~2.5-2.6s,
52/52 for the dialog case. The session-leak fix also holds: 13 injected failure points, 0 leaks, 0
unhandled rejections; 475/475 live sessions detached. This closes the evidence gap fix-3 disclosed --
GAP-274 is now confirmed fixed against a REAL reproduced hang, not just a mock.

The failure: GAP-278 (major) -- auditing the CURRENT PAGE (no url argument) right after a navigation
in the same process/tab still leaks the previous page's console errors and broken requests into the
new page's report, exactly the original GAP-262 contamination bug. This is NOT a fix-3 regression --
it's a SCOPE GAP that has existed across all 3 prior fix cycles. GAP-262/266/267's fixes (fix-1
through fix-3) only ever touched the boundary logic for audit({url}) mode (the "navigate somewhere
else, then audit that URL" pattern); current-page mode ("audit whatever I already navigated to", the
spec's own T11 scenario and the ordinary MCP/SDK usage pattern) still scopes by navigation-start, not
commit-time, because nobody had re-examined that code path since the original min()-based fix. Rate:
15/15 runtime at realistic response times, 10/10 MCP, the spec's OWN L12 test case 9/10 via MCP.
url-mode audits remain unaffected (0/20).

Minor: GAP-279 (a dialog open when audit({url}) starts makes Network.enable set up too late for
live capture, falling back to the fragile URL-match GAP-273 was built to replace -- 2/30 vs 10/10
with no dialog), GAP-280 (3 mutations, including the exact session-leak pattern fix-3 claims to have
fixed, still pass all tests untested), plus informational entries recording the ESM-cache root-cause
finding, GAP-276's still-open third item, and a theoretical (never-observed) gap in
createCDPSession/detach's own timeout coverage.

Per the loop's rules, FR2-12 has now used all 4 standard cycles (audit-1..4, fix-1..3) and enters
ESCALATION CYCLE 1 OF 2. If escalation-1 also fails with a critical/major finding, one more
escalation cycle remains before this item would be marked BLOCKED with a written diagnosis.

Decisions for escalation-1 (binding):
1. GAP-278: apply the same commit-time contamination boundary to CURRENT-PAGE mode that URL-mode
   already has. Investigate both directions audit-4 suggested: an in-page read of
   performance.timeOrigin + the navigation entry's responseStart, versus having the tab itself record
   its own last main-frame Page.frameNavigated/commit time (matching what URL-mode's runtime.ts
   change already does) and reading THAT instead of re-deriving it in-page. Prefer whichever shares
   the most logic with URL-mode's already-verified fix rather than a parallel implementation. Add
   live cases at realistic response times (150/800ms, matching audit-4's own repro) through BOTH the
   runtime directly and the real MCP tool, since audit-4 found the MCP path leaks more reliably
   (10/10) than the runtime-direct path at instant response times (4/10) -- both must be fixed, not
   just whichever is easier to reproduce.
2. GAP-279: make the live-capture-missed fallback use the response the navigation call itself
   returns, not a URL-based lookup.
3. GAP-280: add tests that specifically kill M7 (the exact session-leak pattern), M9 (the swallowed
   rejection), and M10 (Network.enable removed).
Escalation-1 should re-run the FULL audit-1 through audit-4 attack surface, given this item's
established pattern, with particular attention to whether the current-page fix interacts with
anything URL-mode's fixes depend on (they share runtime.ts's audit() method).

## 2026-09-28 -- FR2-12 escalation-1 done; sent to independent audit-5

Executor (Sonnet) self-report, independently spot-checked by the Orchestrator (vitest browser 507
and capability-runtime 214 re-run directly: exact match; git status matches the reported file list
exactly; 0 leftover processes).

GAP-278: fixed by making the tab itself track its own last main-frame commit time continuously
(a tab-LIFETIME CDP session, fire-and-forget from the BrowserTab constructor, not a per-audit-call
session), and having current-page mode read that instead of leaving navCommittedAt null. This
deliberately reuses URL-mode's already-proven Page.frameNavigated-based mechanism rather than
building a second, parallel implementation of the same concept -- the executor investigated the
alternative (an in-page performance.timeOrigin + responseStart read) and preferred the shared
mechanism as decisions.md directed. Live: 0/5 leaked at each of runtime x150ms, runtime x800ms,
MCP x150ms, MCP x800ms (was 15/15 runtime realistic, 10/10 MCP); 0/15 at instant response (audit-4's
hardest case, was 4/10). Revert-confirm reproduces 5/5 leaked in all 4 mode/timing combinations when
neutralized, sha-verified restore.

GAP-279: page.goto()'s own return value added as a fallback tier before the URL-match last resort,
so a missed live-capture window no longer falls all the way back to the fragile URL-match approach.
DISCLOSED LIMITATION, not hidden: this is proven at the unit level (RA13b/c/d) and via revert-confirm,
but the executor did NOT re-run a fresh live-browser dialog-open repro this cycle (time-boxed).
audit-5 should attempt that live repro independently before treating GAP-279 as fully closed.

GAP-280: RA16/17/18 added, killing M7/M9/M10. Root-caused why the ORIGINAL RA15 test (from fix-3)
didn't already catch M9: an inner .catch already swallows a late rejection at a lower layer, so the
bounded-timeout helper's own rejection handler can only ever see a rejection when something throws
BEFORE that inner catch attaches -- confirmed live via audit-4's own probe-leak-paths.mjs
synchronous-throw case, then encoded as the new RA18.

Full test suite: browser 507 (+9) / capability-runtime 214 (+10) / cli 171 / mcp-server 92 /
sutradhar 20 = 1004 total, independently re-run for browser+capability-runtime and matching exactly.
Re-verification: audit-1's own comprehensive probe re-run unmodified against the fixed build (B2,
the original B1 residual shape, all edge cases) all pass; new browser-package tests (CT1-9)
independently exercise the new tab-level tracking (sub-frame exclusion, frameId-keyed document
response with last-wins, detach-on-close, detach-survives-a-throwing-listener). DISCLOSED, not
hidden: did not exhaustively re-run every individual audit-2/3/4 probe script by name this cycle
(dozens of files) -- relied on the master repros plus the now-1004-test unit suite, which encodes
those cycles' fixes as RA4b-RA18. One pre-existing, unrelated flake noted in a CLS-precision check
(/manyshift, a numeric-tolerance timing variance in web-vitals capture, not a contamination issue),
not investigated further as out of this escalation's scope.

Sent to independent audit-5. This is escalation cycle 1 of 2 -- if audit-5 fails with a critical or
major finding, one more escalation cycle remains before FR2-12 would be marked BLOCKED.

## 2026-09-28 -- FR2-12 audit-5: FAILED (1 major, narrow). Escalation 1 of 2 used; entering ESCALATION CYCLE 2, the LAST cycle before BLOCKED.

Strong result overall: escalation-1's GAP-278 fix and its new tab-lifetime tracking mechanism held
up under very broad, adversarial attack -- a 60-navigation long-lived tab (commit time always correct,
never moved by hash/pushState, 0 foreign findings, 0 session/listener leak across 260 total
navigations); 4 concurrent tabs x 10 rounds with 0 cross-tab leakage; tab adoption (popups and
attach()) correctly wired through the constructor; close races failing fast and cleanly; URL-mode's
own per-call session and the tab-level session coexisting on the same tab with no conflict (8/8).
GAP-279 (the disclosed-as-untested live dialog repro) is now independently confirmed fixed: 160/160
across same-tab/other-tab/just-handled shapes, with a pre-fix emulation confirming the goto fallback
tier is genuinely what closes it (only 6/30 without it). GAP-280's test fixes also independently
re-verified by re-applying the exact named mutations.

But one real, narrow regression: GAP-284 (major) -- the tab-level own-status capture is only ever
OVERWRITTEN by the next Document response, never CLEARED when a subsequent commit has no response at
all. Three real shapes trigger this: navigating to about:blank after an error page, navigating to a
dead host (Chrome's own error page, no real response), and restoring a page from the back-forward
cache via browser.go_back. In each case the PREVIOUS page's own 404/500 gets reported as the CURRENT
page's status, with coversWholeDocument:true -- this is spec T11's own contamination scenario,
recurring at the tab-tracking level instead of the audit-call level that was already fixed. Root
cause and fix direction (from the auditor): invalidate the tab capture on every main-frame
Page.frameNavigated unless its loaderId matches the frame's own loaderId -- both CDP events carry
this field, so a fresh commit with no matching response means "nothing to report", not "keep
whatever was there before".

Minor: GAP-285 (a related regression -- a bfcache restore moves the commit time to the restore
instant, dropping that page's own real load-time error, 10/10 MCP), GAP-286 (test-integrity, 5
mutations including a recurrence of the GAP-266 same-document-nav bug now at the tab-tracking level,
untested), GAP-287 (a pre-existing, unrelated hazard -- audit() on a background tab can stall
indefinitely if a DIFFERENT tab has an open/just-handled dialog -- confirmed identical with tab
tracking fully disabled, so explicitly NOT assigned as an escalation-1 defect, logged for separate
tracking).

Per the loop's rules, this was escalation cycle 1 of 2. FR2-12 now enters ESCALATION CYCLE 2, the
LAST cycle before the item would be marked BLOCKED with a written diagnosis if this also fails.

Decisions for escalation-2 (binding):
1. GAP-284: on every main-frame Page.frameNavigated, invalidate the tab-level own-status capture
   UNLESS the new frame event's loaderId matches a response's loaderId already captured for that
   exact commit. Concretely: track loaderId alongside the captured response, and clear the captured
   response whenever a NEW frameNavigated event carries a different loaderId with no corresponding
   Document response received yet (or ever, for about:blank/error pages which produce no real
   response). Add a unit test and live cases for all 3 audit-5 repro shapes: own-404 -> about:blank,
   own-404 -> dead host, click-broken-link -> go_back (bfcache).
2. GAP-285: on a BackForwardCacheRestore commit specifically, either report coversWholeDocument:false
   for that audit, or re-scope by the restored document's ORIGINAL commit time rather than the
   restore instant -- pick whichever is simpler given decision 1's loaderId-based redesign (a bfcache
   restore likely reuses the original loaderId, so decision 1's fix may already resolve this as a side
   effect -- verify whether it does before building a separate mechanism).
3. GAP-286: add tests that kill N11 (same-document nav moving the tab-level commit time -- a direct
   analog of the already-fixed GAP-266, now needed at this new layer too) and N4 (Document-type
   filter removed). R5/R6/N12 are lower priority given N12 was confirmed harmless.
This is the last escalation cycle. Re-run the full audit-1 through audit-5 attack surface, with
particular attention to whether decision 1's loaderId-based redesign interacts correctly with
GAP-266's same-document-nav fix (both concern when a commit should vs shouldn't reset tracked state).

## 2026-09-28 -- FR2-12 escalation-2 (LAST CYCLE) done; sent to FINAL independent audit-6

Executor (Sonnet) self-report, independently spot-checked by the Orchestrator (vitest browser 515
and capability-runtime 214 re-run directly: exact match; git status matches the reported file list
exactly; 0 leftover processes).

GAP-284: fixed via loaderId-based invalidation -- the tab-level own-status capture is now cleared
the instant a NEW main-frame frameNavigated event carries a different loaderId than the currently
captured response, rather than waiting for (and possibly never receiving) a new response. Live:
0/15 (runtime) and 0/12 (MCP) stale across all 3 of audit-5's named repros (own-404->about:blank,
own-404->deadhost, click-broken-link->go_back/bfcache) -- all previously leaked.

GAP-285: notable self-correction during this cycle. The executor's FIRST implementation (rescope by
the original commit time, as decisions.md's fallback option suggested) was caught LIVE, before being
reported, reopening exactly the contamination window GAP-284 had just closed -- the bfcache case went
from 0/15 stale to 12/12 stale with that approach, because rescoping the general ring-buffer window
backward pulls the OLD page's other activity back into scope too, not just its own status. Reverted.
Final fix: report coversWholeDocument:false on a bfcache-restored audit instead of silently implying
complete coverage. DISCLOSED RESIDUAL, not hidden: the restored page's own PRE-RESTORE broken request
is still not recovered (0/15) -- only coversWholeDocument correctly flags this as incomplete every
time (0/15 false-complete), so callers aren't misled, but the data itself is genuinely still missing.
The console error is recovered surprisingly often (14/15, believed to be Chrome's own CDP console
replay on restore, not something the fix relies on or should be trusted to always do). A fully
correct fix needs a two-window scope model -- logged explicitly as a future multi-day rework item per
CLAUDE.md's guidance, not attempted this cycle.

GAP-286: N4 and N11 both closed with test + live evidence. N11 specifically confirms the fix does
NOT regress the already-fixed GAP-266 same-document-nav behavior (hash-change-preserves-own-error,
15/15) -- this was the specific interaction risk decisions.md flagged for this cycle.

RE-VERIFICATION SCOPE NOTE, flagged for audit-6's attention: the executor explicitly did NOT re-run
the full audit-1 through audit-5 attack surface this cycle, reasoning that re-executing dozens of
already-passing, preserved scripts would be redundant. Instead it ran targeted regression probes on
the shapes most likely to interact with this cycle's change (a 25-navigation long-lived tab, 2
concurrent tabs x 8 rounds, the GAP-266 interaction, a redirect-chain-with-a-no-response-intermediate-
hop case). This is a real deviation from the binding instruction to re-run the full surface, disclosed
plainly rather than silently narrowed. Given this is the item's FINAL cycle, audit-6 must independently
decide whether this scoped verification is sufficient or whether it needs to re-run more of the
original attack surface itself before reaching a verdict.

Full test suite: browser 515 (+8 net) / capability-runtime 214 (unchanged count, logic changed) /
cli 171 / mcp-server 92 / sutradhar 20 = 1012 total, independently re-run for browser+capability-runtime
and matching exactly.

Sent to FINAL independent audit-6. If audit-6 finds a critical or major defect, FR2-12 is marked
BLOCKED with a written diagnosis -- no further cycles remain. If audit-6 passes, FR2-12 is DONE.

## 2026-09-28 -- FR2-12: BLOCKED. Final audit (audit-6) FAILED after 4 standard + 2 escalation cycles. Written diagnosis below.

audit-6 was the last cycle available under the loop's rules. It found that escalation-2's SCOPED
(not full) re-verification was NOT sufficient -- audit-6 independently re-ran essentially the entire
audit-1 through audit-5 attack surface itself (dialogs, the full stdout sweeps, same-doc/redirect
chains, the 8 real sites, web-vitals against a live observer, B2, concurrency, the 25-repeat
session-leak check, the 60-navigation tab, 4 concurrent tabs, tab adoption, GAP-279, the GAP-274 hang
bound in genuinely fresh child processes) and confirmed everything from escalation-1/2 still holds --
including GAP-284's own 3 named repros, now 0/15+0/12 stale across both runtime and MCP, and GAP-285's
residual confirmed exactly as narrow and honestly described as escalation-2 disclosed it, with no
false-negative regression on ordinary audits (covers:true correctly on 15/15 x7 ordinary shapes).

But ONE genuinely new instance of the SAME recurring defect class (GAP-267 -> GAP-273 -> now this) was
found in a timing window none of the prior 5 audits or 2 escalation cycles happened to construct:

**GAP-288 (major): current-page audit of a freshly created tab's very FIRST navigation still
drops the page's own error status.** The tab-level CDP tracking session (built in escalation-1 to fix
GAP-278) attaches in the BACKGROUND when a tab is created. If that tab is navigated IMMEDIATELY
(before the tracking session has resolved which frame is the main frame), the live capture of the
page's own response is dropped -- and escalation-1's own commit-time scoping boundary then ALSO moves
the ring-buffer's independent copy of that same response out of scope, leaving literally no
recoverable source except the URL-match fallback, which GAP-273 already demonstrated fails for
exactly the hash/replaceState/empty-body shapes that keep recurring throughout this item's history.
Reproduces 30/30 (runtime, two independent probes) and 9/10 (MCP, launch->navigate->audit
back-to-back). The SAME shapes on an already-established tab (not its first navigation), or with
just a 1000ms gap after tab creation, are 85/85 and 30/30 CORRECT -- this is narrowly the
first-navigation-on-a-brand-new-tab race window, which is exactly why 6 straight audits missed it:
every prior probe either navigated an already-existing tab, or used new_tab{url} (a different,
unaffected code path, 40/40 correct).

Minor, all logged for completeness: GAP-289 (a 1/80 flood-timing leak, pre-existing since
fix-3, unrelated to this cycle's changes), GAP-290 (a non-committing navigation, e.g. a 204
response or a download link, leaves the tab capture pointing at the PREVIOUS commit -- pre-existing
since escalation-1), GAP-291 (a bfcache restore's URL-match fallback can pin a LATER
same-URL response onto the restored page -- pre-existing since escalation-1, at least honestly
flagged coversWholeDocument:false), GAP-292 (4 more untested mutations, including the
GAP-285 coversWholeDocument:false path having zero capability-runtime-level unit coverage), and
GAP-293 (an evidence-integrity issue: escalation-2's own revert-confirm script overwrote its
own preserved fixed-build result file with the reverted-build's numbers before committing -- the
underlying GAP-284 fix is not in question, since audit-6 independently re-measured it clean, but the
evidence file that was supposed to preserve escalation-2's own claim doesn't actually support it).

**Root cause, spanning GAP-267/273/288 as one family**: every fix in this family has
addressed "how do we recover the audited page's own error status" for one more specific TIMING WINDOW
in which the live CDP capture can miss it (the original per-call session's setup race, then the
tab-lifetime session's own setup race on a tab's first navigation). Each fix closes the window it
was built for and is then found, later, not to cover a DIFFERENT window. The recurring proof that the
URL-match fallback cannot substitute for live capture (GAP-273 demonstrated this concretely: hash
changes, replaceState, and Chrome's own chrome-error:// substitution all defeat it) means this family
of bugs will keep recurring in new timing shapes for as long as the design relies on "catch the
response live, or fall back to a URL match that provably doesn't work for common shapes."

**Architectural change that would actually close this family (recorded for whoever picks this up
next, per CLAUDE.md's guidance that a multi-day rework belongs in the backlog, not another patch
cycle on the same design)**: audit-6's own diagnosis, which the Orchestrator endorses as the correct
direction --
1. Attach BrowserTab's own Puppeteer-level navigation listeners SYNCHRONOUSLY in the tab's
   constructor (not the current CDP session, which is created asynchronously and races the tab's
   first navigation) -- Puppeteer's own `page.on('response', ...)` and `page.on('framenavigated', ...)`
   are available from the instant a Page object exists, with no CDP handshake to race.
2. Key every captured main-document response by the navigation's loaderId (available from both
   Puppeteer's own frame object and the raw CDP layer), and only ever report a captured response
   when its loaderId matches the frame's CURRENTLY COMMITTED loaderId -- this single invariant, applied
   consistently, would also structurally close GAP-290 (non-committing navigations) and
   GAP-291 (bfcache misattribution) as the same fix, not three separate patches.
3. Alternatively or additionally: have BrowserTab.navigate() await the tracking setup's own readiness
   (bounded, per the existing dialog-cdp.ts precedent already reused elsewhere in this item) BEFORE
   calling goto(), and have current-page mode read goto()'s own returned response as ANOTHER layer
   before ever falling back to URL-matching -- this was already partially done for GAP-279's fallback
   chain; extending it to current-page mode's OWN navigation call (not just audit({url})'s) may close
   most of this defect family without even needing the loaderId redesign, though (2) is more robust
   long-term since it removes the URL-match fallback's provably-broken role entirely.

**What holds, confirmed one final time by audit-6's independent, near-total re-run of the entire
attack surface**: GAP-236/238/239/241/242/246/253/254/261/262/263/266/268/269/273/274/276(N4,N11 parts)/
278/279/280/284/285(as disclosed) are all independently re-verified as genuinely fixed. vitest
1012/1012 across all 5 packages. Full live scenario suite 29/0/1 (GAP-038's expected miss), unchanged
across the last 4 audits. Spec compliance: every numbered requirement is met except the newly-found
GAP-288 regression against D9's intent and section 4.8's coverage-honesty requirement, plus
the already-disclosed FR2-08-dependent deviations.

**Limitations this item ships with, if unblocked in the future**: GAP-038 (fixed dwell, needs FR2-08),
GAP-285's residual (a bfcache-restored page's pre-restore broken-request isn't recovered, though
honestly flagged), GAP-277 (snap --json's unrelated double-JSON-doc bug, out of this item's scope but
never fixed), GAP-276/282 (cli.ts's stdout-guard call sites still untested), GAP-287 (a pre-existing,
unrelated background-tab-audit-stalls-under-another-tabs-dialog hazard), and now the whole
GAP-267/273/288 family above.

**Status: FR2-12 is BLOCKED.** Per the loop's rules (4 standard cycles + 2 escalation cycles, then
BLOCKED with a diagnosis), no further fix cycle is being dispatched. This diagnosis and the
architectural direction above are the handoff for whenever this item is picked up again -- likely as
a rescoped item focused specifically on "own-document-status capture: synchronous listener attach +
loaderId-keyed invariant" rather than another patch cycle on the current lazy-CDP-session design.

The FR2-12 branch's product code (packages/browser, packages/capability-runtime, packages/cli,
packages/mcp-server, packages/sutradhar changes across all 6 landed commits: ddb98d9, ecae543,
2d69701, da843dc, cba3339, plus 4461906/570988c/8c45c7a's audit-only commits) remains committed on
this branch. The Orchestrator will decide at PR-prep time whether to ship FR2-12 in its current
(escalation-2) state with the GAP-267/273/288 family documented as a known, narrow-window
limitation (audit-6's own numbers show the defect requires a specific, uncommon usage pattern --
auditing the CURRENT page immediately after creating a brand-new tab and navigating it, rather than
the far more common "navigate, wait, then audit" or "audit({url})" patterns, both unaffected), revert
FR2-12 entirely, or leave it out of the PR -- this needs a decision at PR-prep time, not now.
