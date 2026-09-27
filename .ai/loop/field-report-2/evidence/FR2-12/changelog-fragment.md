# FR2-12: Machine-readable audit — changelog fragment

**New:**
- MCP tool `browser.audit` — JSON report first, then the full-page screenshot, then (with
  `baselineUrl`) an optional diff image. `includeImages:false` omits both images; findings never
  set `isError`.
- SDK `page.audit({url?, outDir?, baselineUrl?})` → `{report, screenshotBase64,
  baselineDiffBase64?}`. `outDir` writes the PNGs to disk and gives absolute paths in `report`;
  omitting it returns them as base64 only.
- CLI `audit --json` — one pretty-printed JSON document on stdout (the same `AuditReport` shape),
  with images always written to files and referenced by absolute path (never inlined). Text mode
  is unchanged except for the fixes below.
- Committed JSON Schema `packages/capability-runtime/schemas/audit-report.schema.json`
  (`schemaVersion` 1, draft-07, `$id: "urn:sutradhar:audit-report:1"`).

**Fixed:**
- `sutradhar audit` now creates a missing `outDir` instead of running the whole audit and then
  crashing with `ENOENT` on write.
- Cross-document contamination (B1): in a long-lived MCP/SDK session, a previous page's console
  errors, page errors and broken requests no longer leak into a later audit of a different page —
  findings are scoped to the audited document (`observation.coversWholeDocument` reports whether
  this process was already observing before the document started).
- CLS is no longer multiplied by the number of URL audits run against the same tab (B2) — the
  before-navigation vitals-tracking script injection this bug came from is gone entirely (see
  "Changed" below).
- An open native dialog now fails the audit immediately with a clear message instead of hanging
  until the tab's 30-second auto-dismiss.
- `--baseline` given with no URL (or immediately followed by another flag, which used to silently
  consume it as the baseline URL) is now rejected with a usage error instead of silently doing the
  wrong thing.
- Text-mode cosmetic bug: `LCP: n/ams` when LCP was unavailable now prints `LCP: n/a`.

**Changed:**
- Web Vitals (LCP/CLS) are read via a buffered `PerformanceObserver` at audit time in BOTH url and
  current-page mode, not injected before navigation — confirmed live by this item's Step 0
  experiment (`evidence/FR2-12/run-1/step0-decision.md`, Branch B) that a late buffered `observe()`
  returns the same values a live observer would have collected. Current-page audits now report
  real LCP/CLS instead of always `null`.
- A baseline comparison failure is now reported in the output (`baseline.error`, exit 1) instead
  of aborting the whole command with `Fatal:`.
- `browser.audit`'s doc-comment reference in `server.ts` (previously a stale mention of a
  nonexistent `browser.compare` tool) now correctly names `audit (url/baselineUrl)`.

**Not an action:** `browser.audit`/`page.audit`/`audit --json` carry no `verification` field —
audit is a report, in the same category as `snapshot`/`extract_data`, not an action FR2-07's
contract applies to.

**Known limits (see `.ai/loop/field-report-2/gaps.md` after the Orchestrator appends GAP-new-A
through GAP-new-G, and GAP-038):**
- Network-level request failures (DNS, refused, blocked) are not counted as broken requests —
  only HTTP responses with status ≥ 400 are (GAP-new-A).
- The 5 accessibility checks are heuristics, not a WCAG audit, and have known false positives —
  not touched by this item (GAP-new-B).
- `audit <outDir>` with no URL treats `outDir` as the URL; the workaround is `audit "" <outDir>`
  (GAP-new-C).
- The schema file isn't shipped in the npm tarball / `exports` map (GAP-new-D).
- Ring-buffer eviction (200 console / 50 page-error / 200 network entries per tab) isn't surfaced
  in the report — a very noisy page can silently evict early entries (GAP-new-E).
- `compare` still has no `--json` (GAP-new-F).
- `cls` is the legacy total of every layout-shift entry's value, not Core Web Vitals'
  session-windowed CLS (GAP-new-G).
- GAP-038 (fixed/bounded settle before capture) is **not closed** by this item: FR2-08
  (`waitForPageSettle`) had not landed in this worktree at DEVELOP time (still at SPEC), so
  `audit`/`compareUrls` still use the pre-existing fixed dwell (`settleMs ?? 1500`/`?? 500`)
  rather than a real DOM-quiet/network-idle condition. A request slower than that dwell can still
  be missing from `brokenRequests` (confirmed live, Step 0's E3 and this item's L15/"expected-miss").

**Deviation from spec D2.4 (FR2-04 dialog keys in `--json` mode):** the spec's mechanism assumed
FR2-07's verb-level `{json:true}` switch would exist by DEVELOP time; FR2-07 is still at SPEC in
this worktree, so that switch doesn't exist. `dialogPending`/`dialogsHandled` are therefore left
off every `audit --json` report (the schema's own documented fallback for "FR2-04 isn't there"
also covers this case). FR2-04's own `reportDialogs()` (untouched by this item) still
unconditionally prints `dialogPending:`/`dialogHandled:` lines to stdout whenever a dialog
actually exists, independent of `--json` mode — a pre-existing, whole-CLI gap this item neither
introduces nor fixes. None of this item's fixtures or live-verify cases open a dialog during a
normal CLI audit run, so it was never observed corrupting `--json` stdout in practice here.
