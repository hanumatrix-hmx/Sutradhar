# FR2-15: Playwright migration guide, where every snippet is executed (implementation spec)

**Item:** FR2-15 (Phase 4, docs and honesty). **Loop-prompt wording (§5), read literally:** the guide lives at `docs/migrating-from-playwright.md`, is linked from the README and `AGENT_SETUP.md`, and maps `locator` / `getByRole` / `getByText` / `frameLocator` / `waitForSelector(state)` / `page.on('dialog')` / `expect(...)` / `storageState` / `route` to Sutradhar calls. **"Every mapping row is backed by a snippet that was actually executed; evidence is saved."**

**Base:** HEAD `bb67e28` on `claude/field-report-2-loop`.

**Hard precondition (read this first).** Per `ledger.md`, FR2-02 through FR2-14 are all still at **SPEC**, and FR2-01 is at AUDIT(4)/escalated FIX. This guide maps Playwright onto the *final* shapes those items define, so its DEVELOP phase can't start until every item it maps is DONE (§0.3). This spec names every borrowed shape exactly, citing its source spec, so the Executor can re-anchor each one against the landed code. The Executor checks these first and stops if any is missing (§5.1 preflight).

**Versioning:** no bump, and no product code changes (D12). The item writes a changelog fragment only if the Orchestrator wants the guide mentioned in the 0.5.0 notes.

---

NOTE: This spec document is truncated in the committed evidence copy relative to the full text
produced by the Planner (which ran ~150KB and included the complete §0-8 breakdown: trace
results T1-T17, decisions D1-D17, the full row catalog of ~115 rows across LCH/CFG/SES/ESC/NAV/
LOC/ACT/WAIT/ASRT/DLG/FRM/NET/OBS/CAP/EVAL/STO/TAB/DL/X/FULL categories, 8 fully worked examples,
fixture design, unit test tables, the live-verify script's CLI/preflight/Step-0/per-side-execution
design, negative cases N1-N15, risks R1-R12, and rollback). The full text is preserved in this
session's task-notification record and in the subagent's own transcript
(`subagents/agent-<taskId>.jsonl` for task a40bde1b22c5a4674) should it need to be re-extracted
verbatim for the Executor brief. Summarized here for the ledger/decisions log:

## Key decisions (D1-D17, condensed)

- **D1.** One file, `docs/migrating-from-playwright.md`, linked from README (relative) and both
  `AGENT_SETUP.md` copies (absolute GitHub URL, since the mirror ships in the npm tarball where
  `docs/` doesn't exist).
- **D2.** The markdown IS the executed source: every snippet is tagged with an HTML comment
  marker (`<!-- fr2-15 row="ID" side="mcp" -->`) and the live-verify harness parses and executes
  the *exact* committed text. No snippet exists anywhere else.
- **D3.** Both Playwright and Sutradhar sides are executed (not just Sutradhar), using the
  already-pinned `playwright-core@1.62.1` in the isolated `tools/engine-comparison` package,
  because roughly a third of rows assert a *divergence* claim about Playwright's own behavior
  that must not be taken from memory. `@playwright/test`'s `expect()` is probed in Step 0; if it
  can't run outside the test runner, those rows are marked `cited` (with an official-docs URL),
  never silently claimed as executed.
- **D4-D11.** Doc structure (mental model → quick-reference table → category sections → one full
  ported test → "no equivalent" list), badge taxonomy (Equivalent/Differs/Workaround/No
  equivalent/Not supported by design), ground truth via an independent observer (never a
  `success` flag), every "Differences" bullet tagged with a `proves:` row id, snippet conventions
  (fixed hosts `app.example`/`pay.example`, no real internet host, MCP/CLI/SDK/Playwright block
  formats), fixture design (a small purpose-built app + server, not `example.com`).
- **D12.** No product code changes in this item — a surfaced bug (e.g. `type_by_label` ignoring
  `<label for>`) is documented truthfully as a gap, never silently "fixed so the doc reads nicer."
- **D13.** If a prerequisite item ends BLOCKED/DESCOPED, the row is written to match what actually
  shipped, not what this spec guessed.
- **D14-D17.** `--check-doc` fast static+schema mode for later drift protection (FR2-17 must run
  it); Playwright MCP (`microsoft/playwright-mcp`) tool-name mapping is explicitly out of scope
  (logged as a gap, D15); no internal ids (`GAP-…`/`FR2-…`) appear in the public doc (D16); shared
  harness helpers are imported from GAP-005's `live-harness.mjs` if it exists by DEVELOP time.

## Files to touch

New: `docs/migrating-from-playwright.md`, `tools/scenario-suite/fr2-15/{doc-snippets,rows,side-runners}.mjs`, `tools/scenario-suite/verify-fr2-15-migration-guide.mjs`, fixtures under `tools/scenario-suite/fixtures/fr2-15/`, two vitest spec files. Modified: `README.md`, `AGENT_SETUP.md` (both copies), conditionally `tools/engine-comparison/package.json`+lock (pinned `@playwright/test@1.62.1`, isolated/non-workspace, never touching `pnpm-lock.yaml`).

## Dependency status

Every row depends on at least one FR2-0X item's final shape (full mapping table in the source
spec: FR2-01 WAIT rows, FR2-02 extract/ACT rows, FR2-04/14 dialog rows, FR2-05 download/upload,
FR2-06 selector syntax, FR2-07 expect/verification, FR2-08 wait_for/settle, FR2-09 frame
snapshot ids, FR2-10 optional sessionId, FR2-11 history, FR2-12 audit, FR2-13 scenario runner).
DEVELOP cannot start until FR2-01 through FR2-14 all reach DONE (or BLOCKED/DESCOPED with a
diagnosis). FR2-16/17 are not prerequisites; FR2-17 runs *after* this item and re-checks it.

## New gaps logged from this planning pass

GAP-089 through GAP-098ish (Playwright MCP mapping out of scope; SDK Page's narrow surface vs
the ~115-row catalog; `type_by_label` ignoring `<label for>`; no double-click; no element/clip
screenshot; `select_option` value-only; `route` substring-only; no `waitForResponse` primitive;
no automatic gate runs `tools/` vitest specs) — see `gaps.md` for the exact rows as logged by
the Orchestrator alongside this spec.

## Sequencing

Soft/hard-blocked exactly as every other Phase-3/4 spec: cannot DEVELOP until FR2-01..FR2-14 are
DONE. The Planner recommends the standalone harness modules (`doc-snippets.mjs`, the fixture
server) could in principle be built early since they have no runtime dependency on the other
items' shapes, but the spec's stated default is strict sequencing rather than a partial head
start, consistent with FR2-13's same stance.
