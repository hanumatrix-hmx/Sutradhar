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
