---
name: webbench-sample
description: Run a new Claude-direct WebBench benchmark sample against Sutradhar — pick fresh untested tasks, drive them live via browser.* MCP tools, score honestly, update the competitive-benchmarks docs, commit. Use when asked to benchmark Sutradhar, get a tighter completion-rate number, or continue the standing WebBench loop from CLAUDE.md.
user-invocable: true
---

# /webbench-sample — run another Claude-direct WebBench sample

This automates the exact procedure used for samples 1-4 (see
`.ai/competitive-benchmarks.md`'s iteration log and `tools/webbench/claude-direct-run-*.md`).
**You (Claude) are the brain** — this is not `agent.runGoal`. No LLM provider is needed. Read
`CLAUDE.md` first if you haven't this session; it explains why this is the primary
benchmarking mode, not a fallback.

Arguments passed (optional): `$ARGUMENTS` — a task count (default 10-14) and/or specific
category emphasis (e.g. "5 CREATE tasks", "large sample of 20").

## 1. Pick fresh tasks

- Read `tools/webbench/tested-domains.txt` — every domain listed there has already been
  attempted in a prior sample. Do not repeat one unless the user explicitly asks to re-test it
  (e.g. to check if a block has lifted).
- Fetch `https://raw.githubusercontent.com/Halluminate/WebBench/main/webbenchfinal.csv` via
  WebFetch. Ask it to exclude rows whose Starting URL matches any already-tested domain and
  return N rows (spread across N different new domains) with ID/Starting URL/Category/full
  Task text verbatim. **Verify the result yourself** — the fetch model doesn't always honor
  exclusions perfectly; drop any row whose domain is already in `tested-domains.txt` before
  proceeding.
- Bias toward READ (WebBench's largest real category, ~64%). CREATE tasks are fine ONLY if
  clearly safe/reversible and need no login or real personal-data submission (e.g. "add an
  item to cart", not "sign up for a newsletter" or "create an account"). Skip
  UPDATE/DELETE/FILE_MANIPULATION tasks that require an existing account — you won't have
  credentials, and creating one is an externally-visible action to check with the user about
  first, not do unprompted.
- Write the picked tasks to `tools/webbench/tasks-sampleN.json` (N = next unused number —
  check `tools/webbench/` for the highest existing `tasks-sampleN.json`), matching the
  existing files' schema (`_source`, `_note`, `tasks: [{id, startingUrl, category, task}]`).

## 2. Drive each task live

For each task: `browser.launch` a fresh headless session, attempt the task faithfully via
`browser.*` tools (snapshot/click/type/extract — whatever fits), then `browser.shutdown`
before the next one. Track progress with TodoWrite (one entry per task + a final "score and
write up" entry) so nothing gets dropped mid-sample.

Real friction you will likely hit, and how to handle it — **don't work around any of these
via stealth/evasion, per CLAUDE.md's scope boundary**, just document honestly:
- **Cloudflare/CAPTCHA/hard-deny walls** — genuinely blocked; note the exact wall (JS
  challenge that never clears, "Access Denied", a real CAPTCHA page, HTTP 403) and move on.
- **Occlusion errors on click** — usually a real popup/modal/cookie-banner/chat-widget.
  Diagnose via `browser.eval` (`document.elementFromPoint(x, y)` at the target's center) and
  dismiss it if it's a legitimate in-page element (close button, accept-cookies), then retry.
- **A search box that won't submit via Enter/button click** — try clicking an actual
  autocomplete suggestion `<a>` link instead (real navigation, not a bypass), or navigate
  directly to the site's own `/search?q=...` URL pattern if you can infer it — legitimate,
  since it's the same destination the site's own search would produce.
- **Multi-tab navigation** (a link opens `target="_blank"`) — `browser.list_tabs` then
  `browser.focus_tab` on the new tab.
- **Oversized tool results** (a big `failureScreenshot` blows the token limit) — the result
  gets saved to a file; peek at just the JSON header via `head -c 1500` in Bash rather than
  reading the whole thing.
- **A product/page genuinely doesn't exist anymore** — WebBench's dataset has a fixed capture
  date; real catalogs and programs drift. Confirm via the site's own search/API (not just one
  failed guess) before concluding this, and report it as a dataset-drift finding, not a
  Sutradhar failure.

## 3. Score honestly

WebBench itself uses human-in-the-loop review, not an automated answer key — match that.
Mark each task **Completed** only if you actually extracted/confirmed real, verifiable data
(or, for CREATE, a real confirmed state change like a cart count). Mark **Blocked** with the
specific external cause. Don't round a partial/reasonable-interpretation result up to
"Completed" without saying so in the writeup.

## 4. Write up and update docs

- Write `tools/webbench/claude-direct-run-2026-08-13-sampleN.md` (match the existing samples'
  structure: results table, per-task detail on completions, per-task detail on blocks, any new
  bugs found, a combined-total-so-far section).
- Append every newly-tested domain to `tools/webbench/tested-domains.txt`.
- Update `.ai/competitive-benchmarks.md`'s iteration log (new entry, newest-first) and its
  headline combined number near the top of the WebBench section.
- If a real Sutradhar bug was found (not an external block) — root-cause it, fix it, typecheck
  + run that package's vitest suite, and live-verify the fix (see the `dashboard-verify` skill
  if it's a dashboard-facing fix, or a direct `SutradharRuntime` script otherwise) before
  counting it as fixed rather than just found. Log it in
  `.ai/browsing-capability-loop.md`'s iteration log too.
- Update the `roadmap_maturity`/`browsing_capability_loop` memory files' Milestone summary if
  memory access is available this session (skip silently if it isn't — that's a
  session-specific capability, not a hard requirement).

## 5. Commit

One commit covering the new tasks JSON, the writeup, `tested-domains.txt`, and the doc
updates (plus any code fix + its test). Follow the repo's existing commit-message style
(see `git log` for recent Milestone-N commits) — state what was tested, the real number, and
any bug found/fixed. Push per the user's standing preference for this repo (check `CLAUDE.md`
and recent session context for whether routine pushes are expected without re-asking).
