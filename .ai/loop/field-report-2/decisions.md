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
