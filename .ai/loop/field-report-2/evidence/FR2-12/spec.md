# FR2-12: Machine-readable audit, implementation spec

**Item:** FR2-12 (Phase 3, packaging).
**Base:** HEAD `878dd92` on `claude/field-report-2-loop`. The only thing in the working tree besides HEAD is the untracked directory `.ai/loop/field-report-2/evidence/FR2-01/audit-3/`, and it contains no code. Every line number below was read at `878dd92`.

Before this item's DEVELOP starts, all of these merge first: FR2-01 through FR2-11 (in particular FR2-04, FR2-07, FR2-08, FR2-10 and FR2-11). Together they touch `runtime.ts`, `tools.ts`, `cli.ts`, `parse-args.ts`, `page.ts`, `browser-tab.ts` and every test file this item appends to. **The Executor therefore anchors by symbol name, not by line number.**

**Decisions in force:**
- §4.9: backward compatible > smallest diff > consistency.
- §4.8: never claim what wasn't checked. Here that means the report states its own coverage limits instead of implying completeness.
- §4.3: the 0.5.0 bump is shared by the whole loop, so this item does no bump of its own.

**Hard preconditions:** none.

**Soft dependencies:**
1. **FR2-08** (`waitForPageSettle`). It is only at SPEC today. D7 gives a branch that works whether or not FR2-08 has landed.
2. **FR2-04/FR2-07** (the CLI dialog-line switch in `--json` mode). D2.4 gives the rule for both cases.

**Step 0 is mandatory.** Before editing any code, the Executor runs the step-0 experiments (§5.1) against the pre-change build. E2 picks Branch A or Branch B for Web Vitals (D6). The choice is recorded in `evidence/FR2-12/step0-decision.md` before `site-audit.ts` is touched.

**Versioning:** no bump. The item writes `evidence/FR2-12/changelog-fragment.md` (§7.2).

---

## 0. Trace results

Everything below was read in code during this session unless it's marked *expected, to be confirmed by Step 0*.

### 0.1 Where audit lives: the real call chain

| # | Finding | Evidence |
|---|---|---|
| T1 | **Audit logic is split between two files.** `site-audit.ts` is pure data and in-page script strings:<br>- the types `A11yIssue` (`:10-14`), `WebVitals` (`:16-25`) and `AuditResult` (`:27-37`);<br>- `AUDIT_PAGE_SCRIPT` (`:40-89`): the 5 accessibility rules plus the vitals read;<br>- `VITALS_OBSERVER_SCRIPT` (`:93-109`).<br>It has no Node logic and no I/O. All orchestration is in **`SutradharRuntime.audit`** (`runtime.ts:1420-1465`) and **`compareUrls`** (`:1473-1495`). | files |
| T2 | **The chain, CLI `audit` → CDP:**<br>1. `main()` `case 'audit'` (`cli.ts:783-784`) calls `cmdAudit(cleanArgs[0], cleanArgs[1])`.<br>2. `cmdAudit` (`:372-424`) runs `withSession`, which attaches or spawns (`:92-147`), then calls `runtime.audit(sessionId, {url})` (`:374`).<br>3. In `runtime.audit`, **when url is given**:<br>&nbsp;&nbsp;- `assertNavigationAllowed(url)` (`:1422`);<br>&nbsp;&nbsp;- `resolveTab` and `requirePage` (`:1429-1430`);<br>&nbsp;&nbsp;- `page.evaluateOnNewDocument(VITALS_OBSERVER_SCRIPT)` (`:1431`);<br>&nbsp;&nbsp;- `this.navigate`, which is `tab.navigate` → `page.goto({waitUntil:'domcontentloaded'})` (`runtime.ts:377-387`, `browser-tab.ts:242`);<br>&nbsp;&nbsp;- **a fixed `setTimeout(settleMs ?? 1500)`** (`:1433`).<br>4. **In every mode:**<br>&nbsp;&nbsp;- `Promise.all([page.screenshot({fullPage:true, encoding:'base64'}), page.evaluate(AUDIT_PAGE_SCRIPT)])` (`:1439-1442`). This calls **`page.screenshot` directly, not `runtime.screenshot`**, so it has no verification layer;<br>&nbsp;&nbsp;- the tab's ring buffers are filtered: `getConsoleLogs` → `logType==='error'`, `getPageErrors`, and `getNetworkLog` → `phase==='response' && status>=400` (`:1444-1452`);<br>&nbsp;&nbsp;- `readTitle` (`:1456`).<br>5. **`--baseline`** calls `runtime.compareUrls(sessionId, baselineFlag, result.url)` (`cli.ts:403`), which navigates to the baseline, **sleeps 500**, takes a viewport screenshot, then navigates *back to the audited url*, **sleeps 500**, takes a second viewport screenshot and runs `compareScreenshots` (`runtime.ts:1486-1494`, `visual-compare.ts:28-58`). | as cited |
| T3 | **Consequence for exposure:** MCP and the SDK can call `runtime.audit` directly with no duplicated logic. The only CLI-specific pieces are file writing and text rendering. Those move into a shared, pure module (`audit-report.ts`) that the CLI, SDK and MCP all use (D1). | T1, T2 |

### 0.2 What is actually missing or broken (the finding re-verified, plus real bugs found while tracing)

| # | Finding | Evidence |
|---|---|---|
| T4 | **No `mkdir`.** `cmdAudit` does `path.resolve(outDir ?? '.')` and then `writeFile` directly (`cli.ts:375-377`, `:405`). `node:fs/promises` imports only `readFile, writeFile` (`:12`). A non-existent outDir → `ENOENT` → `main().catch` → `Fatal:` and exit 1 (`:968-972`). And because the audit ran before the write, **the whole audit is wasted**. **Confirmed.** | `cli.ts` |
| T5 | **`--json` is parsed globally and ignored by `audit`.** `jsonMode = args.includes('--json')` (`parse-args.ts:97`). It's destructured at `cli.ts:25` and used only by `cmdSnap` (`:266-277`). `cmdAudit` never reads it. The help text says `--json` is for `"snap"` only (`cli.ts:933`). **Confirmed.** | as cited |
| T6 | **Audit isn't in MCP or the SDK.** grep for `audit\|compare` in `mcp-server/src/tools.ts` finds nothing. 71 `server.registerTool(` calls, none of them audit. `tools.spec.ts` `EXPECTED_BROWSER_TOOLS` (`:22-93`) has no audit. The SDK `Page` (`sutradhar/src/page.ts:78-217`) has no `audit`. **Confirmed.**<br>Side finding: `server.ts:55`'s doc comment claims `allowedDomains` gates `browser.compare`, which doesn't exist. That's stale doc, fixed in passing (§1 #14). | grep, files |
| T7 | **The schema exists only as a TS interface.** `AuditResult {url, title, timestamp, screenshotBase64, consoleErrors, pageErrors, brokenRequests, accessibilityIssues, webVitals}` (`site-audit.ts:27-37`). `index.ts:15` exports it as a type only. There's no JSON Schema anywhere in the repo. **Confirmed.** | as cited |
| T8 | **Five accessibility heuristics:** `img-alt`, `input-label`, `missing-title`, `missing-lang`, `button-name` (`site-audit.ts:44-65`). `push()` drops rules whose count is 0 (`:42`). They cover only the main document (no iframes, no shadow roots). **Confirmed.** | as cited |
| T9 | **LCP/CLS today:**<br>- **URL mode:** a stash that `VITALS_OBSERVER_SCRIPT` installs before navigation.<br>- **Current-page mode:** `lcpMs` falls back to `performance.getEntriesByType('largest-contentful-paint')`, which is always empty in Chrome (LCP is not "available from timeline"), and `cls` is hard-coded `null` when there's no stash (`:72-85`).<br>So current-page mode always gives `lcpMs:null, cls:null`. **Confirmed.**<br>**But the premise behind it is suspect.** The comment (`:66-71`) and `runtime.ts:1423-1428` both say LCP/CLS "only show up if a PerformanceObserver was actively listening BEFORE they occurred". Yet `VITALS_OBSERVER_SCRIPT` itself passes **`buffered: true`** (`:102`, `:109`). Per the W3C Performance Timeline `observe()` algorithm, a buffered observe **synchronously appends** the already-recorded entries of that type to the observer's buffer. The entry-type registry gives `largest-contentful-paint` and `layout-shift` a `maxBufferSize` of 150 each. The `web-vitals` library relies on exactly this when it's loaded late. So a *late* observer with `buffered:true` is **expected** to read past LCP/CLS. *Expected, to be confirmed by Step 0 E2.* See D6. | as cited |
| T10 | **Browser-pane probe during planning (inconclusive, but informative).** A buffered-observer read on example.com in the Claude browser pane returned `[]` for both LCP and layout-shift. It also returned **no `paint` entries at all**, and `visibility-state` entries were `[["hidden",0]]`: the pane was hidden during load. **A page that loads while hidden records no FCP/LCP at all.** So a null vital can mean "the page was hidden", not "we couldn't observe it". This is why the report gains `observation.pageWasHidden` (D6). The probe can't confirm T9 because Chrome never produced the entries. E2 runs in visible headless Chrome instead. | pane probe, this session |
| T11 | **Real bug B1: cross-document contamination.** `BrowserTab`'s ring buffers (`browser-tab.ts:159-161`, capped at 200/50/200, `:49-51`) are appended by listeners (`:588-692`). **Nothing ever clears or scopes them on navigation** (`navigate :234-254`). `runtime.audit` reads them whole (`runtime.ts:1444-1452`). In a long-lived process (MCP, SDK), `navigate(noisy)` → `navigate(clean)` → `audit()` reports the **noisy page's** console errors, page errors and 404s as the clean page's findings. `audit({url: clean})` after visiting a noisy page has the same problem. The CLI is mostly shielded, because each process builds a fresh `BrowserTab`. Exposing audit on MCP and the SDK makes this reachable, so it's fixed here (D9). *Pre-fix repro in Step 0 E1b.* | as cited |
| T12 | **Real bug B2: CLS multiplied by the number of audits.** Every `audit({url})` calls `evaluateOnNewDocument` (`runtime.ts:1431`) and never calls `removeScriptToEvaluateOnNewDocument`. After k URL-audits in one tab (same CDP session), every new document runs k copies of `VITALS_OBSERVER_SCRIPT`. Each copy reassigns `window.__sutradharVitals = {lcpMs:null, cls:0}` (`site-audit.ts:94`). The k observers' callbacks all do `window.__sutradharVitals.cls += entry.value` (`:107`) against whichever object is current. So **reported CLS = k × the real CLS**. The injected global also leaks into every later non-audit navigation of that tab, where the page can detect it. Puppeteer 25 has `removeScriptToEvaluateOnNewDocument(identifier)` (`puppeteer-core lib/types.d.ts:7244`). *Pre-fix repro in Step 0 E1c.* | as cited |
| T13 | **Current-page coverage in the CLI.** Each CLI process attaches (`cli.ts:99`), which builds new `BrowserTab` objects. Their listeners start at that moment. **Network events are not replayed on attach.** V8 may replay stored console messages when Runtime is enabled; *expected, to be recorded by Step 0 E1a*. So `sutradhar nav X` then `sutradhar audit` can report **0 broken requests for a page full of 404s**, which is a false clean report. Today nothing in the output says so. See D9. | `cli.ts:92-147`, `browser-tab.ts:588-692` |
| T14 | **FR2-11 boundary.**<br>- FR2-11 records CLI *commands* (`history.jsonl`) and runtime *actions*, including `audit`/`compareUrls`'s internal `navigate` (FR2-11 spec `:60`, `:415`).<br>- It stores no console, page-error or network data.<br>- Audit reads the per-tab observability buffers, which FR2-11 doesn't touch.<br>**There's no data overlap:** the audit is a quality snapshot of the page, the history is a journal of actions. Audit doesn't read `history.jsonl`, and history doesn't store audit findings (D12). | FR2-11 spec |
| T15 | **FR2-07 boundary.**<br>- FR2-07's spec never mentions audit (grep).<br>- It puts reads (snapshot, eval, extract, `get_*`) outside the contract (GAP-027).<br>- It makes `browser.screenshot` dual-content: `content[0]` image, `content[1]` JSON with `verification` (FR2-07 spec `:531`), and classes a screenshot as "unverifiable by design" (`:732-735`).<br>Audit captures through `page.screenshot`, not `runtime.screenshot` (T2). See D12. | FR2-07 spec |
| T16 | **Fixed sleeps (GAP-038).** `runtime.ts:1433` (`?? 1500`), `:1487` and `:1491` (`?? 500`). FR2-08 (still at SPEC in the ledger) plans `waitForPageSettle(page, settle)` in `packages/browser/src/actions/page-settle.ts`, exported through `actions/index.ts` (FR2-08 spec §1 #2-3, §2.3):<br>- mutation quiet 300 ms, network idle 500 ms, bound 5000 ms, plus a 500 ms Node-side hard bound;<br>- it never throws.<br>FR2-08 logged GAP-038 for this item and suggested "`waitForPageSettle` plus a bounded minimum dwell" (FR2-08 spec `:1019`). `capability-runtime` already depends on `@sutradhar/browser`. | as cited |
| T17 | **How MCP returns binaries today:**<br>- `browser.screenshot` returns an MCP `image` item (`tools.ts:911-929`), plus FR2-07's text item after it;<br>- `browser.export_pdf` returns base64 **as text** (`:961-978`).<br>**No tool uses `outputSchema`/`structuredContent`** (grep of `packages/*/src` is empty). | `tools.ts` |
| T18 | **JSON Schema tooling already in the tree (no new dependency needed).**<br>- `@modelcontextprotocol/sdk@1.30.0` depends on `ajv ^8.17.1`, `ajv-formats` and `zod-to-json-schema` (its `package.json:105-106,120`).<br>- It **publicly exports** `./validation/ajv` → `AjvJsonSchemaValidator`, whose default instance is draft-07 Ajv with `ajv-formats`, `strict:false`, `allErrors:true` (`dist/esm/validation/ajv-provider.js:1-16`). It has both ESM and CJS entries.<br>- `mcp-server` depends on the SDK directly, so its tests can import this. Verify scripts reach it via `createRequire(packages/mcp-server/package.json)`, the same technique `verify-fr2-01-wait-states.mjs:39` uses for puppeteer.<br>- The SDK's zod→JSON converter is internal (`dist/esm/server/zod-json-schema-compat.js`, not in its export map).<br>- `capability-runtime` has **no** zod. zod is in `mcp-server` (^3.25.76) and `config` (^3.22.4). | as cited |
| T19 | **Packaging.**<br>- The published `sutradhar` package ships `files: ["dist", …]` with an `exports` map covering only `"."` (`packages/sutradhar/package.json`).<br>- `capability-runtime` is bundled into the three entry points by esbuild (`scripts/build-bundle.mjs`), and pngjs/pixelmatch come in through it.<br>- The SDK `Page` imports only types from `capability-runtime` today (`page.ts:8-14`). | as cited |
| T20 | **Existing tests to keep green (append only):**<br>- `runtime.spec.ts:214-225`: audit with an unknown session → `BrowserNotAvailableError`; `restrictNavigationToLocal` rejects the audit url **before touching the browser**;<br>- `runtime.spec.ts:227-240`: the same pair for `compareUrls`;<br>- `parse-args.spec.ts:39-41`: `--json`; `:115-124`: `--baseline`;<br>- `tools.spec.ts:98-106`: the exact tool count; `:183-193`: `screenshot` `content[0]` is the image;<br>- `visual-compare.spec.ts`: 5 cases. | files |
| T21 | **There's no audit-related fixture yet.** grep of `tools/scenario-suite/**` finds `audit` only in a comment at `run-cli.mjs:5`. No scenario exercises audit, and no fixture has an unlabeled input, a 404 or a deliberate `console.error`. A new fixture is needed (§3). | grep |
| T22 | **`--baseline` has silent-wrongness edge cases.**<br>- `audit <url> --baseline` with no value gives `baselineFlag === undefined` (`parse-args.ts:110-111`), so the comparison is silently skipped while the user believes they gated on it.<br>- `--baseline --json` consumes `--json` as the URL (`:143`).<br>The precedent for rejecting these is `viewportFlagGivenButInvalid`/`stateFlagGivenButInvalid` (`:128-129`, `:165-166`). | as cited |
| T23 | **Positional ergonomics.** `sutradhar audit ./out` treats `./out` as the URL (`cli.ts:784`), so there's no way to audit the current page into a directory except `audit "" <outDir>`. An empty string is falsy, so it takes current-page mode (`runtime.ts:1421`). **It is documented, not changed** (GAP-new-C). | as cited |
| T24 | **Dialogs.** An open native dialog blocks `page.evaluate`, `page.screenshot` and `page.title`. Audit calls all three with no dialog check (`runtime.ts:1439-1456`), so an MCP audit on a page with an open `alert` hangs until the tab's 30 s auto-dismiss. `IBrowserTab.getPendingDialog()` exists (`browser-tab.ts:138`). | as cited |
| T25 | **`requestfailed` isn't recorded** (`browser-tab.ts:630-692` only has `request`/`response`). So a DNS error, a refused connection or a blocked request never shows up as a broken request; only HTTP status ≥ 400 does. This is out of scope, because the file belongs to FR2-04/FR2-11 and it's a separate capability. It is logged as GAP-new-A, with FR2-13 (`failOnBrokenRequests`) as its natural home. | as cited |
| T26 | Text-mode cosmetic bug: `LCP: ${lcpMs ?? 'n/a'}ms` prints `n/ams` (`cli.ts:383`, `:385`, `:386`). Fixed in passing because this item rewrites these exact lines (D2.5). | as cited |

### 0.3 Decisions (the Orchestrator records these in `decisions.md`)

**D1. Architecture (Q1): one runtime call, one pure report module, three thin surfaces.**
- `runtime.audit` stays the single orchestrator. It gains:
  - the D9 scoping and coverage;
  - the D11 dialog fast-fail;
  - the D6 vitals changes;
  - the D7 settle;
  - an optional `baselineUrl`, so the `--baseline` compare is part of the one call instead of CLI-only glue (T2 step 5).
- A new pure module, `capability-runtime/src/audit/audit-report.ts`, converts the in-memory `AuditResult` (which holds base64) into the **portable `AuditReport`** (file paths or `null`, never base64), and optionally writes the PNGs.
- The CLI (`--json` and text), the SDK (`page.audit`) and MCP (`browser.audit`) all call `runtime.audit` once, then `buildAuditReport` / `writeAuditArtifacts`. None of them re-implements any audit logic.
- Why the baseline goes into `runtime.audit`: otherwise the "call audit, then call compareUrls with `result.url`, then catch its error" glue would be copied into three surfaces.

**D2. CLI `--json` (Q2).**
- **D2.1** stdout is **exactly one pretty-printed (2-space) JSON document**, the `AuditReport` (§2.3), and nothing else. This matches `snap --json`. Notes go to stderr.
- **D2.2 The shape is `AuditResult`'s fields verbatim, except for these changes:**
  - `screenshotBase64` is replaced by `screenshot: {path, width, height, bytes, fullPage}`;
  - `schemaVersion: 1` is added;
  - `requestedUrl` is added;
  - `observation` is added (D9);
  - `baseline` is added (`null`, a success object with `diffPath`, or `{url, error}`).
  - **No key in the output ever holds base64.**
- **D2.3 Paths are absolute, OS-native** (`path.resolve`, so Windows backslashes, JSON-escaped). Text mode already prints absolute paths (`cli.ts:375`), so the two stay consistent. A relative path would be ambiguous to a consumer running in another cwd. `outDir` defaults to `.` as today.
- **The file names don't change:** `audit-screenshot.png`, `audit-baseline-diff.png`. **No `audit-report.json` file is written.** Writing one into the default outDir (`.`) would overwrite a user file of that name. `--json > file` covers the need.
- **D2.4 FR2-04 dialog output.** If FR2-04's `reportDialogs` exists at DEVELOP time, `audit --json` uses the same `{json:true}` switch FR2-07 defines for action verbs (FR2-07 spec `:782`):
  - no `dialogPending:` lines on stdout;
  - `dialogPending`/`dialogsHandled` merged into the report as the two optional keys the schema allows.

  If FR2-04 isn't there, the keys are simply absent. L2 asserts that stdout parses as one document.
- **D2.5 Text mode:**
  - the lines stay the same, in the same order;
  - the only changes are that `n/ams` becomes `n/a` (T26), and a baseline failure prints `Visual diff vs baseline (<url>) failed: <error>` instead of dying with `Fatal:` (the exit code is still 1);
  - coverage and hidden-page notes go to **stderr** in both modes.
- **D2.6 Exit codes:**
  - 0 otherwise;
  - 1 when `--fail-on-diff` and (console/page errors, broken requests, or baseline diff > 0), the same gate as today (`cli.ts:414-422`);
  - 1 when `baseline.error` is set (today that's an uncaught compare throw, also exit 1);
  - 1 on a fatal error, in which case stdout is empty in `--json` mode (no partial JSON).
- **D2.7 outDir is prepared before any session work.** `prepareAuditOutDir` does `mkdir -p` and runs **before** `withSession`, so a bad outDir fails without spawning or attaching Chrome, instead of wasting the audit (T4).

**D3. MCP `browser.audit` (Q3): inline only, no `outDir`, JSON first and then images.**
- **There is no `outDir` parameter.**
  - A stdio MCP server's filesystem isn't guaranteed to be the client's.
  - A tool that writes files to caller-chosen paths is the write-anywhere primitive FR2-05 deliberately fences with allowlists. Adding a second, unfenced one to get paths the client can't reliably open would be all cost and no benefit.
- **Result format:**
  - `content[0]` is `{type:'text'}` with the `AuditReport` JSON. There, `screenshot.path` and `baseline.diffPath` are `null`, meaning the image is delivered in this response instead of on disk.
  - `content[1]` is `{type:'image', mimeType:'image/png'}`, the full-page screenshot.
  - `content[2]` is the diff PNG, only when a baseline succeeded.
  - `includeImages:false` omits both images. The JSON still reports their `width/height/bytes`.
- **Why the JSON comes first**, unlike `browser.screenshot`'s image-first order (which FR2-07 kept for backward compatibility of `content[0]`):
  - this is a new tool, so no existing parser constrains it;
  - the report is the primary payload;
  - harness `jsonOf(content[0])` works;
  - a text-only client sees the report.

  FR2-10's auto-resolve note, if any, still comes last.
- **Why not `outputSchema`/`structuredContent`:** see D5.
- **Why not base64 inside the JSON:** the image block is the MCP-native binary channel `browser.screenshot` already uses (T17), and the `bytes` field lets a caller check it's complete.
- **Findings never set `isError`**, because the audit succeeded and the findings are data. `isError` is only for:
  - an unknown or unusable session;
  - a blocked `url`/`baselineUrl`;
  - an open dialog (D11);
  - a navigation throw on `url`.

  A **baseline** navigation failure is reported in `baseline.error`, not as `isError`, the same as the CLI.

**D4. SDK `page.audit(options)` (Q4): returns `{report, screenshotBase64, baselineDiffBase64?}`, with an optional `outDir`.**
- The Node SDK *has* filesystem access, so `outDir` is offered. When it's given, `prepareAuditOutDir` runs before the audit, then `writeAuditArtifacts`, so the report carries absolute paths, identical to the CLI's.
- When it isn't given, nothing is written, and the paths are `null`.
- The binaries are always returned as base64 strings, the same convention as `page.screenshot()` (`page.ts:148-152`).
- `report` is exactly the schema-described object, so `JSON.stringify(report)` validates.
- Runtime errors **throw** (the audit couldn't happen). A baseline failure is in `report.baseline.error` (the audit happened).
- Audit is a report, not an action, so it doesn't touch FR2-07's `lastResult`.

**D5. JSON Schema artifact (Q5): hand-written draft-07 file, drift-guarded by tests. Not zod, not `outputSchema`.**
- **Location:** `packages/capability-runtime/schemas/audit-report.schema.json`, next to the module that produces the format.
  - Outside `src/`, because tsc `rootDir` is `./src` and the runtime never needs to load it.
  - FR2-13's scenario schema can use the same convention.
- **Draft-07**, with `$id: "urn:sutradhar:audit-report:1"`. Draft-07 because the only validator already in the tree (T18) defaults to draft-07.
- **Zod as the single source was considered and rejected:**
  - (a) capability-runtime has no zod, so it would need a new runtime dependency;
  - (b) generating the committed file needs `zod-to-json-schema` as a new direct devDependency, since the MCP SDK's converter isn't exported;
  - (c) the only consumer that *needs* zod is MCP `outputSchema`, which (d) no tool uses today (T17) and which (e) turns any schema drift into a hard `McpError` that fails the **whole** call (`mcp.js:185-206`), making a reporting tool fail closed. It also (f) adds the full schema to every `tools/list`.
- **Drift is closed with three guards instead:**
  - (i) `AUDIT_REPORT_EXAMPLE`, exported in **src** and typed `DeepRequired<AuditReport>`, so `tsc` (which excludes tests, `tsconfig.json:8`) fails the moment the interface gains a key the example lacks;
  - (ii) unit tests assert the schema's `properties`/`required` key sets equal the example's key sets at every object level;
  - (iii) unit and live tests validate real reports with the SDK's `AjvJsonSchemaValidator`, plus negative mutations.
- `additionalProperties:false` everywhere, and **any shape change bumps `schemaVersion` and this file.**
- The schema isn't shipped in the npm tarball, because that would need a new `exports` entry. It is logged as GAP-new-D.

**D6. LCP/CLS in current-page mode (Q6): the premise is very likely false, gated by Step 0 E2.**
- **Branch B (expected):** E2 shows that a late `PerformanceObserver.observe({type, buffered:true})` followed by a synchronous `takeRecords()` returns the page's past LCP and layout-shift entries in visible headless Chrome, with CLS within 0.001 of the pre-injected stash, 3 out of 3 runs.

  If so, **delete `VITALS_OBSERVER_SCRIPT` and the `evaluateOnNewDocument` injection**, and read LCP/CLS the same buffered way in **both** modes. One code path, which also removes bug B2 and the global it leaks into the page.
  - `cls` becomes `0` (not `null`) when layout-shift is supported and no shift happened.
  - The 150-entry buffer cap is documented.
- **Branch A (E2 refutes):** keep the injection, but fix B2:
  - keep the returned `identifier` and `removeScriptToEvaluateOnNewDocument` it in a `finally` after navigate plus settle;
  - add an idempotence guard `if (window.__sutradharVitals) return;` at the top of the script.

  Current-page `lcpMs`/`cls` stay `null`, with the reason in the tool description.
- **E2 variant B′:** if sync `takeRecords()` is empty but the async callback delivers, read inside an `async` page script that resolves on the first callback or after 250 ms (bounded).
- **In either branch**, `observation.pageWasHidden` = "any `visibility-state` entry named `hidden`", or `null` if that entry type isn't supported. That's the honest explanation for null vitals (T10).
- LCP semantics (the last candidate's `startTime`) and CLS semantics (the legacy sum of all non-input shifts, not the session-window CLS of Core Web Vitals) **don't change**. The latter is documented and logged (GAP-new-G).

**D7. GAP-038 (Q7): settle plus the existing sleep as a floor, conditional on FR2-08 having landed.**
- **At DEVELOP time**, if `@sutradhar/browser` exports `waitForPageSettle`:
  - `audit({url})` becomes `await Promise.all([waitForPageSettle(page, true), delay(settleMs ?? 1500)])` after `navigate`;
  - `compareUrls` does the same after each navigate, with a floor of `settleMs ?? 500`.
- The floors keep today's minimum dwell. That's backward compatible: never shorter than before, only longer when the page is still loading, bounded by settle's own 5000 + 500 ms.
- It closes the real hazard (a request slower than 1.5 s missing from `brokenRequests`, live case L15), and the floor is a documented dwell rather than a guess.
- **If FR2-08 is BLOCKED or its API differs**, the Executor keeps the fixed sleeps exactly, leaves GAP-038 open with that reason, and L15 is recorded as `expected-miss`, not asserted. The Executor never forks a private copy of the settle algorithm.
- Current-page mode never settles. The composable answer is `wait_for`, then `audit()`, which now reports current-page vitals (Branch B) and is document-scoped.

**D8. Accessibility rules (Q8): not touched.**
- The Done-when doesn't ask for them, and tracing found no *bug* in them, only heuristic false positives:
  - an image link with `alt` flagged by `button-name`;
  - `aria-labelledby` ignored for buttons;
  - main document only.
- These are logged as GAP-new-B.
- The schema accepts any `^[a-z][a-z0-9-]*$` rule id (the 5 current ones are documented), so adding a rule later doesn't need a schema bump.

**D9. Scope entries to the audited document, and report coverage honestly (fixes B1 and makes T13 visible).**
- `BrowserTab` gains `public readonly observingSince: string`, the ISO time its listeners were attached, set in the constructor next to `attachPageListeners`. `IBrowserTab` gains it as **optional**, so test mocks are unaffected.
- `AUDIT_PAGE_SCRIPT` also returns `timeOrigin` (`performance.timeOrigin`, epoch ms).
- **The scoping instant `since`:**
  - **navigated mode:** `min(navStartedAt, documentStartedAt)`. `navStartedAt` is the Node ISO time taken immediately before `this.navigate`. The `min` keeps the whole document on a same-document (hash) navigation, and is robust to a browser clock ahead of Node;
  - **current-page mode:** `documentStartedAt` (`new Date(Math.floor(timeOrigin))`).
- Console errors, page errors and response entries with `timestamp < since` are dropped.
- **`observation.coversWholeDocument`** is `observingSince <= since` (false when `observingSince` is unknown).
  - In the CLI's current-page mode it's **false** (this process attached after the page loaded), and a stderr `Note:` says to pass the URL.
  - In MCP/SDK after a same-process navigate, it's true.
- Ring-buffer eviction (200/50/200) isn't detectable from outside `BrowserTab` today. It's documented and logged (GAP-new-E).

**D10. B2 is fixed by D6** (Branch B removes the injection; Branch A removes the script and guards it). L13 asserts equal CLS across 3 consecutive URL-audits, and no `window.__sutradharVitals` on a later plain navigation.

**D11. Dialog fast-fail.** After navigation and settle, before any page-touching call, if `tab.getPendingDialog?.()` is set, audit throws:
`a <dialogType> dialog is open ("<message, truncated to 120>") and blocks the page, so it can't be audited. Handle it first (browser.handle_dialog, or "sutradhar dialog accept|dismiss"), then audit again.`
- This is FR2-04's "never hang on a dialog" principle.
- A dialog that opens *during* capture still blocks until auto-dismiss (documented, rare).

**D12. Boundaries.**
- **FR2-07:** `browser.audit` / `page.audit` / `audit --json` carry **no `verification` field**. Audit is a report, in the same category as snapshot/extract (GAP-027).
  - The navigation inside URL mode is evidenced by `requestedUrl` versus the final `url` instead.
  - Its screenshot isn't an action result, so no `png-well-formed` check is attached. The `bytes/width/height` fields are read from the PNG header, so a broken capture throws in `pngDimensions`, not silently.
  - This is stated in the changelog so the Phase 3 cross-cutting Auditor doesn't flag it as a missing contract.
- **FR2-11:** no reads or writes of history (T14).
- **FR2-10:** `browser.audit`'s `sessionId: z.string()` is made optional automatically at registration. Nothing to do.
- **FR2-08:** its settle-classification test (M6 in the FR2-08 spec) must classify `browser.audit` as **excluded (read/report; settles internally when url is given)**.

**D13. `--baseline` validation (T22).** The new `baselineFlagGivenButInvalid` is true when `--baseline` is present but its next arg is missing or starts with `--`. `main()` then exits 1 with `--baseline requires a URL (e.g. audit <url> --baseline https://prod.example.com)`. In that case `baselineFlag` is `undefined`.

**D14. The baseline is asserted before any browser contact.** `runtime.audit` calls `assertNavigationAllowed(baselineUrl)` next to the `url` check, before `resolveTab`, the same ordering `runtime.spec.ts:220-225` pins. A baseline blocked by the allowlist is a thrown error (`isError`/`Fatal`), not a `baseline.error`: nothing was audited yet, and the caller's policy said no.

**Gaps to log (found while tracing; not fixed here):**
- **GAP-new-A (minor):** `requestfailed` isn't recorded, so network-level failures never count as broken requests (T25). Home: FR2-13.
- **GAP-new-B (minor):** a11y heuristic false positives, and main-document-only coverage (D8).
- **GAP-new-C (minor):** `audit <outDir>` without a URL treats outDir as the URL. The workaround `audit "" <outDir>` is documented, and a `--out` flag would fix it (T23).
- **GAP-new-D (minor):** the schema isn't shipped in the npm tarball, and `exports` has no subpath for it.
- **GAP-new-E (minor):** ring-buffer eviction isn't surfaced in the audit report.
- **GAP-new-F (minor):** `compare` has no `--json`.
- **GAP-new-G (minor):** `cls` is the legacy total, not Core Web Vitals' session-window CLS. It's documented but could mislead.
- **GAP-038:** CLOSED by D7 if FR2-08 landed, else stays TODO with the reason.

---

## 1. Files to touch

| # | File | Change | Prior items touching it |
|---|---|---|---|
| 1 | `packages/capability-runtime/src/audit/site-audit.ts` | `AuditResult` gains `requestedUrl`, `observation`, `baseline`. New `AuditObservation`, `AuditBaselineOutcome`. `AUDIT_PAGE_SCRIPT` returns `timeOrigin` and `pageWasHidden`, plus the Branch-B buffered vitals read. `VITALS_OBSERVER_SCRIPT` is deleted (B) or guarded (A). Pure helpers `scopeToDocument`, `computeObservation`. | — |
| 2 | `packages/capability-runtime/src/audit/audit-report.ts` (**new**) | `AUDIT_REPORT_SCHEMA_VERSION`, file-name constants, `AuditReport` types, `AUDIT_REPORT_EXAMPLE`, `pngDimensions`, `buildAuditReport`, `prepareAuditOutDir`, `writeAuditArtifacts` | — |
| 3 | `packages/capability-runtime/schemas/audit-report.schema.json` (**new**) | §2.4, verbatim | — |
| 4 | `packages/capability-runtime/src/runtime.ts` | `audit` (D6/D7/D9/D11/D14, `baselineUrl`); `compareUrls` (D7) | FR2-01…11 |
| 5 | `packages/capability-runtime/src/index.ts` | Exports (§2.2) | FR2-01, 05, 07, 08 |
| 6 | `packages/browser/src/session/browser-tab.ts` | `observingSince` (one field plus an optional interface member). **No other change.** | FR2-04, FR2-11 |
| 7 | `packages/cli/src/audit-output.ts` (**new**) | `formatAuditText`, `auditNotes`, `auditExitCode` (pure) | — |
| 8 | `packages/cli/src/cli.ts` | `cmdAudit` rewrite (D2); `main()` D13 check; help text | FR2-01, 03, 04, 05, 06, 07, 08, 11 |
| 9 | `packages/cli/src/parse-args.ts` | `baselineFlagGivenButInvalid` | FR2-01, 03, 04, 07, 08 |
| 10 | `packages/mcp-server/src/tools.ts` | `browser.audit` (D3) in the Capture section, right after `browser.screenshot` | FR2-01, 02, 05…11 |
| 11 | `packages/sutradhar/src/page.ts`, `src/index.ts` | `Page.audit`; export `PageAuditOptions`, `PageAuditResult`, `AuditReport` | FR2-01, 05, 07, 08 |
| 12 | Tests (**new**): `capability-runtime/tests/unit/audit-report.spec.ts`, `cli/tests/unit/audit-output.spec.ts` | §4 | — |
| 13 | Tests (**append only**): `capability-runtime/tests/unit/runtime.spec.ts`, `mcp-server/tests/unit/tools.spec.ts` (+ one `EXPECTED_BROWSER_TOOLS` entry, plus classifying `browser.audit` in FR2-08's settle test), `cli/tests/unit/parse-args.spec.ts`, `sutradhar/tests/unit/api.spec.ts`, `browser/tests/unit/browser-tab*.spec.ts` (whichever exists) | §4 | all prior |
| 14 | `packages/mcp-server/src/server.ts` | Doc comment only (`:55`): `compare` → `audit (url/baselineUrl)` (T6) | — |
| 15 | `tools/scenario-suite/fixtures/fr2-12-audit-server.mjs` (**new**) | §3 | — |
| 16 | `tools/scenario-suite/verify-fr2-12-audit.mjs` (**new**) | §5 | — |
| 17 | Docs: `AGENT_SETUP.md` **and** `packages/sutradhar/AGENT_SETUP.md` (the mirror must match); `packages/mcp-server/README.md` (tool table near `:70`); `packages/cli/README.md` (`:86-87`, `:105`, `:108-109`); `packages/sutradhar/README.md` (Page table near `:134`) | §2.8 | FR2-01…11 |
| 18 | `.ai/loop/field-report-2/evidence/FR2-12/changelog-fragment.md`, `step0-decision.md` (**new**) | §7.2, §5.1 | — |

**Not touched:**
- the five accessibility rules (D8);
- `visual-compare.ts` (`compareScreenshots` unchanged);
- `browser-tab.ts` beyond #6;
- `execution-verifier.ts` (D12);
- `packages/sutradhar/package.json` / `build-bundle.mjs` (GAP-new-D);
- `packages/agent`, `apps/server`.

---

## 2. API diff

### 2.1 `site-audit.ts`

```ts
export interface AuditObservation {
  /** 'navigated' = audit loaded `requestedUrl` itself; 'current-page' = audited the tab as-is. */
  readonly mode: 'navigated' | 'current-page';
  /** The audited document's navigation start (performance.timeOrigin), ISO. null if unreadable. */
  readonly documentStartedAt: string | null;
  /** When this process began recording the tab's console/page-error/network events (BrowserTab.observingSince). */
  readonly observingSince: string | null;
  /** true when observingSince <= the scoping instant: every console/page error and response of THIS
   *  document reached the ring buffers (subject to their 200/50/200 caps). false = earlier activity was
   *  not observed (typical for a CLI audit of the current page in a new process). */
  readonly coversWholeDocument: boolean;
  /** true if the page was hidden at any point (visibility-state entries); a hidden load records no
   *  FCP/LCP. null if the browser doesn't expose visibility-state entries. */
  readonly pageWasHidden: boolean | null;
}

export type AuditBaselineOutcome =
  | ({ readonly url: string } & VisualCompareResult)              // includes diffImageBase64
  | { readonly url: string; readonly error: string };

export interface AuditResult {
  // …existing 9 fields unchanged…
  /** The url option as given, or null in current-page mode. */
  readonly requestedUrl: string | null;
  readonly observation: AuditObservation;
  /** null unless baselineUrl was given. */
  readonly baseline: AuditBaselineOutcome | null;
}

/** Keep entries at or after `sinceIso` (ISO strings compare lexicographically; all are toISOString()).
 *  null → keep all. Pure. */
export function scopeToDocument<T extends { timestamp: string }>(entries: readonly T[], sinceIso: string | null): T[];

/** Pure: builds AuditObservation from the pieces (see D9 for the exact rule). */
export function computeObservation(i: {
  mode: 'navigated' | 'current-page'; navStartedAt: string | null; timeOrigin: number | null;
  observingSince: string | null; pageWasHidden: boolean | null;
}): { observation: AuditObservation; since: string | null };
```

`AUDIT_PAGE_SCRIPT` (**Branch B**). The accessibility block (`:41-65`) stays byte-identical. The vitals block becomes:

```js
  const readBuffered = (type) => {
    try {
      const po = new PerformanceObserver(() => {});
      po.observe({ type, buffered: true });          // appends already-recorded entries synchronously
      const recs = po.takeRecords();
      po.disconnect();
      return recs;
    } catch { return null; }                          // entry type unsupported
  };
  const lcp = readBuffered('largest-contentful-paint');
  const shifts = readBuffered('layout-shift');
  let pageWasHidden = null;
  try {
    const vis = performance.getEntriesByType('visibility-state');
    if (PerformanceObserver.supportedEntryTypes.includes('visibility-state')) pageWasHidden = vis.some((e) => e.name === 'hidden');
  } catch {}
  return {
    issues,
    timeOrigin: performance.timeOrigin,
    pageWasHidden,
    webVitals: {
      lcpMs: lcp && lcp.length ? Math.round(lcp[lcp.length - 1].startTime) : null,
      cls: shifts ? shifts.reduce((s, e) => (e.hadRecentInput ? s : s + e.value), 0) : null,
      fcpMs: fcp ? Math.round(fcp.startTime) : null,
      ttfbMs: nav ? Math.round(nav.responseStart) : null,
    },
  };
```

The comment at `:66-71` is replaced by a comment that states the buffered-observer fact, the 150-entry cap and the hidden-page caveat. `VITALS_OBSERVER_SCRIPT` is deleted, along with its import at `runtime.ts:51`.

**Branch A:**
- The vitals block keeps the stash path.
- `VITALS_OBSERVER_SCRIPT`'s first statement becomes `if (window.__sutradharVitals) return;`.
- The script still gains the `timeOrigin`/`pageWasHidden` return fields.

### 2.2 `runtime.ts`

```ts
public async audit(
  sessionId: string,
  options: { url?: string; tabId?: string; settleMs?: number; baselineUrl?: string } = {},
): Promise<AuditResult> {
  if (options.url) this.assertNavigationAllowed(options.url);
  if (options.baselineUrl) this.assertNavigationAllowed(options.baselineUrl);        // D14: before any browser contact
  let navStartedAt: string | null = null;
  if (options.url) {
    const { tab: preTab } = this.resolveTab(sessionId, options.tabId);
    const prePage = this.requirePage(preTab);
    // Branch A only: const { identifier } = await prePage.evaluateOnNewDocument(VITALS_OBSERVER_SCRIPT); try { … } finally { await prePage.removeScriptToEvaluateOnNewDocument(identifier).catch(() => {}); }
    navStartedAt = new Date().toISOString();
    await this.navigate(sessionId, options.url, options.tabId);
    await this.settleAfterNavigation(prePage, options.settleMs ?? 1500);            // D7
  }
  const { tab } = this.resolveTab(sessionId, options.tabId);
  const page = this.requirePage(tab);
  const pending = tab.getPendingDialog?.();
  if (pending) throw new Error(/* D11 exact text */);
  const [screenshotBase64, pr] = await Promise.all([
    page.screenshot({ type: 'png', encoding: 'base64', fullPage: true }) as Promise<string>,
    page.evaluate(AUDIT_PAGE_SCRIPT) as Promise<{ issues: A11yIssue[]; webVitals: WebVitals; timeOrigin: number | null; pageWasHidden: boolean | null }>,
  ]);
  const { observation, since } = computeObservation({
    mode: options.url ? 'navigated' : 'current-page', navStartedAt,
    timeOrigin: typeof pr.timeOrigin === 'number' ? pr.timeOrigin : null,
    observingSince: tab.observingSince ?? null, pageWasHidden: pr.pageWasHidden ?? null,
  });
  const consoleErrors = scopeToDocument(tab.getConsoleLogs(), since).filter((l) => l.logType === 'error')
    .map((l) => ({ text: l.text, timestamp: l.timestamp }));
  const pageErrors = scopeToDocument(tab.getPageErrors(), since).map((e) => ({ message: e.message, timestamp: e.timestamp }));
  const brokenRequests = scopeToDocument(tab.getNetworkLog(), since)
    .filter((n) => n.phase === 'response' && n.status !== undefined && n.status >= 400)
    .map((n) => ({ url: n.url, status: n.status! }));
  const url = page.url();
  const title = await this.readTitle(tab);
  const timestamp = new Date().toISOString();
  let baseline: AuditBaselineOutcome | null = null;
  if (options.baselineUrl) {
    try {
      baseline = { url: options.baselineUrl, ...(await this.compareUrls(sessionId, options.baselineUrl, url, { tabId: options.tabId })) };
    } catch (e) { baseline = { url: options.baselineUrl, error: (e as Error).message || String(e) }; }
  }
  return { url, title, timestamp, screenshotBase64, consoleErrors, pageErrors, brokenRequests,
           accessibilityIssues: pr.issues, webVitals: pr.webVitals,
           requestedUrl: options.url ?? null, observation, baseline };
}

/** D7: DOM-quiet + network-idle (FR2-08 waitForPageSettle, bounded, never throws) AND a minimum dwell of floorMs.
 *  Fallback when FR2-08 hasn't landed: the dwell alone (today's behavior) — see D7. */
private async settleAfterNavigation(page: Page, floorMs: number): Promise<void> {
  await Promise.all([waitForPageSettle(page, true), new Promise((r) => setTimeout(r, floorMs))]);
}
```

- **The audit's `timestamp` and `title` are read before the baseline** so they describe the audited page. `url` is taken before the baseline for the same reason. The baseline re-navigates, so the tab ends on a fresh load of `url` (documented).
- **`compareUrls`:** both `setTimeout(settleMs)` sleeps become `await this.settleAfterNavigation(<page of the resolved tab>, settleMs)`. The `settleMs ?? 500` default is unchanged, and the method is otherwise unchanged.
- **`index.ts` additions:**
  - `export type { AuditResult, A11yIssue, WebVitals, AuditObservation, AuditBaselineOutcome } from './audit/site-audit.js';`
  - `export { AUDIT_REPORT_SCHEMA_VERSION, AUDIT_SCREENSHOT_FILE, AUDIT_BASELINE_DIFF_FILE, buildAuditReport, prepareAuditOutDir, writeAuditArtifacts, pngDimensions, type AuditReport, type AuditReportScreenshot, type AuditReportBaseline } from './audit/audit-report.js';`

### 2.3 `audit-report.ts` (new) and the exact JSON shape

```ts
export const AUDIT_REPORT_SCHEMA_VERSION = 1 as const;
export const AUDIT_SCREENSHOT_FILE = 'audit-screenshot.png';
export const AUDIT_BASELINE_DIFF_FILE = 'audit-baseline-diff.png';

export interface AuditReportScreenshot {
  /** Absolute OS path of the written PNG; null when not written to disk (MCP delivers it as an image
   *  content item after the JSON; the SDK without outDir returns it as screenshotBase64). */
  readonly path: string | null;
  readonly width: number; readonly height: number; readonly bytes: number; readonly fullPage: true;
}
export type AuditReportBaseline =
  | { readonly url: string; readonly diffPath: string | null; readonly width: number; readonly height: number;
      readonly diffPixelCount: number; readonly totalPixels: number; readonly diffPercentage: number }
  | { readonly url: string; readonly error: string };
export interface AuditReport {
  readonly schemaVersion: 1;
  readonly url: string; readonly requestedUrl: string | null; readonly title: string; readonly timestamp: string;
  readonly screenshot: AuditReportScreenshot;
  readonly consoleErrors: AuditResult['consoleErrors']; readonly pageErrors: AuditResult['pageErrors'];
  readonly brokenRequests: AuditResult['brokenRequests']; readonly accessibilityIssues: AuditResult['accessibilityIssues'];
  readonly webVitals: WebVitals; readonly observation: AuditObservation;
  readonly baseline: AuditReportBaseline | null;
  /** CLI only, present only when FR2-04's dialog reporting is active (D2.4). */
  readonly dialogPending?: Record<string, unknown> | null;
  readonly dialogsHandled?: readonly Record<string, unknown>[];
}

/** tsc-enforced drift guard (D5): must list every key, including the two optional CLI keys. */
export const AUDIT_REPORT_EXAMPLE: DeepRequired<AuditReport> = { /* one fully populated success-baseline example */ };

/** Reads IHDR: throws Error('audit screenshot is not a PNG') unless bytes 0-7 are the PNG signature and len >= 24. */
export function pngDimensions(buf: Buffer): { width: number; height: number };
/** Pure. Never copies base64 into the report. */
export function buildAuditReport(r: AuditResult, files: { screenshotPath: string | null; diffPath: string | null }): AuditReport;
/** mkdir -p; returns the absolute dir. On failure throws Error(`Cannot create audit output directory "<abs>": <code or message>`). */
export async function prepareAuditOutDir(outDir: string): Promise<string>;
/** prepareAuditOutDir + write the screenshot (+ the diff when baseline succeeded); returns the report with absolute paths. */
export async function writeAuditArtifacts(r: AuditResult, outDir: string): Promise<AuditReport>;
```

Example CLI `--json` stdout (Windows):

```json
{
  "schemaVersion": 1,
  "url": "http://127.0.0.1:53121/audit?n=7",
  "requestedUrl": "http://127.0.0.1:53121/audit?n=7",
  "title": "FR2-12 audit 7",
  "timestamp": "2026-09-25T10:00:03.412Z",
  "screenshot": { "path": "C:\\tmp\\fr212\\a\\b\\audit-screenshot.png", "width": 800, "height": 1612, "bytes": 48213, "fullPage": true },
  "consoleErrors": [{ "text": "fr2-12-console-7", "timestamp": "2026-09-25T10:00:00.911Z" }],
  "pageErrors": [{ "message": "fr2-12-pageerror-7", "timestamp": "2026-09-25T10:00:00.915Z" }],
  "brokenRequests": [{ "url": "http://127.0.0.1:53121/missing-7.png", "status": 404 }, { "url": "http://127.0.0.1:53121/api/fail-7", "status": 500 }],
  "accessibilityIssues": [{ "rule": "img-alt", "description": "Images missing an alt attribute", "count": 1 }],
  "webVitals": { "lcpMs": 212, "cls": 0.0913, "fcpMs": 180, "ttfbMs": 3 },
  "observation": { "mode": "navigated", "documentStartedAt": "2026-09-25T10:00:00.850Z", "observingSince": "2026-09-25T10:00:00.402Z", "coversWholeDocument": true, "pageWasHidden": false },
  "baseline": null
}
```

(The `accessibilityIssues` list is abbreviated here. The fixture really yields 4 rules, §3.)

### 2.4 `audit-report.schema.json` (committed verbatim)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "urn:sutradhar:audit-report:1",
  "title": "Sutradhar audit report",
  "description": "Machine-readable output of `sutradhar audit --json`, MCP browser.audit (content[0]) and SDK page.audit().report. Accessibility checks are heuristics, not a WCAG audit. Console/page errors and broken requests are scoped to the audited document; see observation.coversWholeDocument. Any shape change bumps schemaVersion.",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "url", "requestedUrl", "title", "timestamp", "screenshot", "consoleErrors", "pageErrors", "brokenRequests", "accessibilityIssues", "webVitals", "observation", "baseline"],
  "definitions": {
    "iso": { "type": "string", "format": "date-time" },
    "isoOrNull": { "anyOf": [{ "type": "string", "format": "date-time" }, { "type": "null" }] },
    "msOrNull": { "type": ["number", "null"], "minimum": 0 }
  },
  "properties": {
    "schemaVersion": { "const": 1 },
    "url": { "type": "string", "description": "Final URL of the audited page (after redirects)." },
    "requestedUrl": { "type": ["string", "null"], "description": "The url that was requested; null when the current page was audited as-is." },
    "title": { "type": "string" },
    "timestamp": { "$ref": "#/definitions/iso" },
    "screenshot": {
      "type": "object", "additionalProperties": false,
      "required": ["path", "width", "height", "bytes", "fullPage"],
      "properties": {
        "path": { "type": ["string", "null"], "description": "Absolute path of the PNG file, or null when not written to disk (MCP: returned as the image content item after this JSON)." },
        "width": { "type": "integer", "minimum": 0 },
        "height": { "type": "integer", "minimum": 0 },
        "bytes": { "type": "integer", "minimum": 1 },
        "fullPage": { "const": true }
      }
    },
    "consoleErrors": { "type": "array", "items": { "type": "object", "additionalProperties": false, "required": ["text", "timestamp"],
      "properties": { "text": { "type": "string" }, "timestamp": { "$ref": "#/definitions/iso" } } } },
    "pageErrors": { "type": "array", "items": { "type": "object", "additionalProperties": false, "required": ["message", "timestamp"],
      "properties": { "message": { "type": "string" }, "timestamp": { "$ref": "#/definitions/iso" } } } },
    "brokenRequests": { "type": "array", "description": "HTTP responses with status >= 400. Network-level failures (DNS, refused, blocked) are not included.",
      "items": { "type": "object", "additionalProperties": false, "required": ["url", "status"],
        "properties": { "url": { "type": "string" }, "status": { "type": "integer", "minimum": 400, "maximum": 599 } } } },
    "accessibilityIssues": { "type": "array", "description": "Heuristic rules; current ids: img-alt, input-label, missing-title, missing-lang, button-name. Only rules with count >= 1 are listed.",
      "items": { "type": "object", "additionalProperties": false, "required": ["rule", "description", "count"],
        "properties": { "rule": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" }, "description": { "type": "string", "minLength": 1 }, "count": { "type": "integer", "minimum": 1 } } } },
    "webVitals": {
      "type": "object", "additionalProperties": false, "required": ["lcpMs", "cls", "fcpMs", "ttfbMs"],
      "properties": {
        "lcpMs": { "$ref": "#/definitions/msOrNull", "description": "Last LCP candidate startTime. null if none was recorded (e.g. the page was hidden while loading)." },
        "cls": { "type": ["number", "null"], "minimum": 0, "description": "Sum of all layout-shift values without recent input (legacy total, not session-windowed). null if unsupported." },
        "fcpMs": { "$ref": "#/definitions/msOrNull" },
        "ttfbMs": { "$ref": "#/definitions/msOrNull" }
      }
    },
    "observation": {
      "type": "object", "additionalProperties": false,
      "required": ["mode", "documentStartedAt", "observingSince", "coversWholeDocument", "pageWasHidden"],
      "properties": {
        "mode": { "enum": ["navigated", "current-page"] },
        "documentStartedAt": { "$ref": "#/definitions/isoOrNull" },
        "observingSince": { "$ref": "#/definitions/isoOrNull" },
        "coversWholeDocument": { "type": "boolean" },
        "pageWasHidden": { "type": ["boolean", "null"] }
      }
    },
    "baseline": {
      "oneOf": [
        { "type": "null" },
        { "type": "object", "additionalProperties": false,
          "required": ["url", "diffPath", "width", "height", "diffPixelCount", "totalPixels", "diffPercentage"],
          "properties": {
            "url": { "type": "string" }, "diffPath": { "type": ["string", "null"] },
            "width": { "type": "integer", "minimum": 0 }, "height": { "type": "integer", "minimum": 0 },
            "diffPixelCount": { "type": "integer", "minimum": 0 }, "totalPixels": { "type": "integer", "minimum": 0 },
            "diffPercentage": { "type": "number", "minimum": 0, "maximum": 100 } } },
        { "type": "object", "additionalProperties": false, "required": ["url", "error"],
          "properties": { "url": { "type": "string" }, "error": { "type": "string", "minLength": 1 } } }
      ]
    },
    "dialogPending": { "type": ["object", "null"], "description": "CLI only (FR2-04), when present." },
    "dialogsHandled": { "type": "array", "items": { "type": "object" }, "description": "CLI only (FR2-04), when present." }
  }
}
```

### 2.5 CLI (`parse-args.ts`, `audit-output.ts`, `cli.ts`)

- **`parse-args.ts`:** `baselineFlagGivenButInvalid: boolean` (D13), with a JSDoc in the `viewportFlagGivenButInvalid` style. When it's true, `baselineFlag` is `undefined`.
- **`audit-output.ts`:**
  - `formatAuditText(report): string[]` gives today's lines in today's order (`cli.ts:379-396`, `:407-411`). With `n/a` there's no unit (`LCP: n/a`, `FCP: n/a`, `TTFB: n/a`). The baseline error gives the D2.5 line.
  - `auditNotes(report): string[]`, for stderr:
    - if `!coversWholeDocument`: `Note: console/page errors and broken requests cover only activity since <observingSince>; this command attached after the page loaded (<documentStartedAt>). Pass the URL ("sutradhar audit <url>") to load and audit the page in one command.`
    - if `pageWasHidden`: `Note: the page was hidden (a background tab) at some point, so LCP/FCP may be missing or incomplete.`
  - `auditExitCode(report, failOnDiff): 0 | 1` implements D2.6.
- **`cmdAudit`:**

```ts
async function cmdAudit(urlArg: string | undefined, outDir: string | undefined) {
  let dir: string;
  try { dir = await prepareAuditOutDir(outDir ?? '.'); } catch (e) { printErrorAndExit((e as Error).message); }   // D2.7: before withSession
  await withSession(async (runtime, sessionId) => {
    const result = await runtime.audit(sessionId, { ...(urlArg ? { url: urlArg } : {}), ...(baselineFlag ? { baselineUrl: baselineFlag } : {}) });
    const report = await writeAuditArtifacts(result, dir!);
    // D2.4: merge FR2-04 dialog keys here if that mechanism exists (json mode)
    for (const n of auditNotes(report)) console.error(n);
    if (jsonMode) console.log(JSON.stringify(report, null, 2));
    else for (const line of formatAuditText(report)) console.log(line);
    if (auditExitCode(report, failOnDiff) === 1) process.exitCode = 1;
  });
}
```

- **`main()`:** add the D13 check next to the viewport/state checks.
- **Help text:** the `audit` rows (`cli.ts:903-907`) become:

```
  audit [url] [outDir] [--json]
                                Screenshot + console/page/network errors + accessibility
                                heuristics + Web Vitals for a page. With a url, loads it and
                                waits for it to settle; without one, audits the current page
                                (use "" as url to also pass an outDir). outDir is created if
                                missing. --json prints one JSON report (schemaVersion 1, see
                                packages/capability-runtime/schemas/audit-report.schema.json);
                                images are written as files and referenced by absolute path.
                                Auditing the current page only sees errors/requests since this
                                command attached; pass the url for full coverage.
  audit [url] [outDir] --baseline <baselineUrl>
                                Same, plus a pixel-diff of baselineUrl vs a fresh load of the
                                audited url (viewport screenshots; the page is reloaded)
```

- **The `--json` flag row:** `"snap": structured element data; "audit": the machine-readable report`. It merges with whatever FR2-07/FR2-11 made that row say.

### 2.6 MCP (`tools.ts`)

```ts
server.registerTool(
  'browser.audit',
  {
    description:
      'Audit a page and return a machine-readable report (JSON Schema: packages/capability-runtime/schemas/' +
      'audit-report.schema.json, schemaVersion 1): console errors, uncaught page errors, broken requests ' +
      '(HTTP 4xx/5xx), heuristic accessibility checks (img-alt, input-label, missing-title, missing-lang, ' +
      'button-name; not a WCAG audit) and Web Vitals (LCP, CLS, FCP, TTFB), plus a full-page screenshot. ' +
      'With url, loads it and waits for DOM/network to go quiet (bounded) first; without url, audits the ' +
      'current page as-is. Errors/requests are scoped to the current document and are complete only if this ' +
      'server was already attached when it loaded (observation.coversWholeDocument). LCP/FCP can be null if ' +
      'the page was hidden while loading (observation.pageWasHidden). Returns the JSON report first, then the ' +
      'screenshot PNG, then (with baselineUrl) a diff PNG; includeImages:false omits the images. baselineUrl ' +
      'navigates to it and then reloads the audited URL to pixel-diff their viewports, discarding the page\'s ' +
      'current state. Findings never make this call fail; only an unusable session, a blocked URL, a failed ' +
      'navigation to url, or an open dialog does. Not an action: no verification field.',
    inputSchema: {
      sessionId: z.string(),
      url: z.string().min(1).optional().describe('Load this URL first. Omit to audit the current page as-is.'),
      baselineUrl: z.string().min(1).optional().describe('Also pixel-diff this URL against a fresh load of the audited page.'),
      includeImages: z.boolean().optional().describe('Default true. false omits the screenshot/diff image items (sizes still reported).'),
      tabId: z.string().optional(),
    },
  },
  async ({ sessionId, url, baselineUrl, includeImages, tabId }) => {
    try {
      const result = await runtime.audit(sessionId, {
        ...(url !== undefined ? { url } : {}), ...(tabId !== undefined ? { tabId } : {}),
        ...(baselineUrl !== undefined ? { baselineUrl } : {}),
      });
      const report = buildAuditReport(result, { screenshotPath: null, diffPath: null });
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> =
        [{ type: 'text', text: JSON.stringify(report, null, 2) }];
      if (includeImages !== false) {
        content.push({ type: 'image', data: result.screenshotBase64, mimeType: 'image/png' });
        if (result.baseline && 'diffImageBase64' in result.baseline) {
          content.push({ type: 'image', data: result.baseline.diffImageBase64, mimeType: 'image/png' });
        }
      }
      return { content };
    } catch (e) {
      return errorResult(`audit failed: ${(e as Error).message}`);
    }
  },
);
```

### 2.7 SDK (`page.ts`, `index.ts`)

```ts
/** Options for {@link Page.audit}. */
export interface PageAuditOptions {
  /** Load this URL first (then wait for it to settle). Omit to audit the page as it is now. */
  url?: string;
  /** Write audit-screenshot.png (and audit-baseline-diff.png) here, creating it if needed; report paths are then absolute. */
  outDir?: string;
  /** Also pixel-diff this URL against a fresh load of the audited page (reloads this tab). */
  baselineUrl?: string;
}
/** Return value of {@link Page.audit}. `report` is exactly the audit-report JSON Schema object. */
export interface PageAuditResult {
  report: AuditReport;
  screenshotBase64: string;
  baselineDiffBase64?: string;
}

/**
 * Audit this tab: console/page errors, broken requests, accessibility heuristics, Web Vitals and a
 * full-page screenshot, as a machine-readable report (schemaVersion 1). Throws if the audit can't run
 * (no live page, blocked URL, open dialog). A failed baseline comparison is reported in
 * report.baseline.error, not thrown. Not an action: it doesn't update lastResult.
 */
public async audit(options: PageAuditOptions = {}): Promise<PageAuditResult> {
  const dir = options.outDir !== undefined ? await prepareAuditOutDir(options.outDir) : undefined;
  const result = await this.runtime.audit(this.sessionId, {
    tabId: this.tabId,
    ...(options.url !== undefined ? { url: options.url } : {}),
    ...(options.baselineUrl !== undefined ? { baselineUrl: options.baselineUrl } : {}),
  });
  const report = dir ? await writeAuditArtifacts(result, dir) : buildAuditReport(result, { screenshotPath: null, diffPath: null });
  const diff = result.baseline && 'diffImageBase64' in result.baseline ? result.baseline.diffImageBase64 : undefined;
  return { report, screenshotBase64: result.screenshotBase64, ...(diff !== undefined ? { baselineDiffBase64: diff } : {}) };
}
```

`page.ts` adds value imports of `prepareAuditOutDir`, `writeAuditArtifacts` and `buildAuditReport` (bundled). `index.ts` exports `type PageAuditOptions`, `type PageAuditResult`, and `type AuditReport` (re-exported from `@sutradhar/capability-runtime`).

### 2.8 Docs

- **`AGENT_SETUP.md` (+ its mirror):** the Capture row gains `audit`: `audit returns a JSON report (errors, broken requests, a11y heuristics, Web Vitals) plus the screenshot; pass url for full coverage; findings don't fail the call.` The tool count gets +1 over whatever it is at merge.
- **`mcp-server/README.md`:** `| browser.audit | Page audit as a JSON report (errors, broken requests, a11y heuristics, Web Vitals) + screenshot/diff images inline. |`
- **`cli/README.md`:** the audit rows mention `--json`, creating the outDir and the `""` form. The `--json` row lists `audit`.
- **`sutradhar/README.md`:** Page table `| audit(options?) | JSON audit report (+ files when outDir is given). |`

---

## 3. Fixture design

**New file:** `tools/scenario-suite/fixtures/fr2-12-audit-server.mjs`.
- It exports `startAuditFixtureServer(): Promise<{origin, close()}>` (listening on `127.0.0.1:0`).
- It's a reusable module rather than inline code, because FR2-13's `maxConsoleErrors`/`failOnBrokenRequests` gates need exactly this page.
- Nothing existing is reusable (T21).
- PNGs are generated at startup with `pngjs` (via `createRequire(packages/capability-runtime/package.json)`), so there's no binary in git.

Every page sets `<meta charset=utf-8>` and `body{margin:0}`. The nonce is `?n=N`: uniqueness goes in the query, not the fragment (the FR2-01 gotcha).

| Route | Content | Expected audit truth |
|---|---|---|
| `/audit?n=N[&slow=MS]` | `<html>` **without `lang`**, `<title>FR2-12 audit N</title>`, then in order:<br>- `<div id=slot style="height:0"></div>`;<br>- `<h1 style="font-size:48px">FR2-12 audit fixture N</h1>`;<br>- `<p style="height:1200px">…</p>`;<br>- `<img src="/img/ok.png" width=40 height=40>` (**no alt**);<br>- `<img src="/missing-N.png" alt="m">`;<br>- `<input id=q>` (**unlabeled**);<br>- `<label for=ok>OK</label><input id=ok>`;<br>- `<button></button>` (**no name**).<br>An inline script that:<br>- `console.error('fr2-12-console-N')`;<br>- `setTimeout(()=>{throw new Error('fr2-12-pageerror-N')},0)`;<br>- `fetch('/api/fail-N')`;<br>- if `slow`: `fetch('/slow-404-N?ms='+MS)`;<br>- `setTimeout(()=>{slot.style.height='200px'; window.__fr212ShiftDone=true},300)`. | accessibilityIssues exactly `{img-alt:1, input-label:1, missing-lang:1, button-name:1}`; consoleErrors ⊇ the nonce text; pageErrors ⊇ the nonce message; brokenRequests ⊇ `/missing-N.png` 404 and `/api/fail-N` 500 (and `/slow-404-N` 404 when slow is set and D7 applies); `cls > 0.01`; `lcpMs > 0`; `fcpMs > 0` |
| `/clean?n=N` | `<html lang=en>`, a title, `<h1>Clean N</h1>`, `<img src=/img/ok.png alt=ok width=40 height=40>` | no findings; `accessibilityIssues:[]` |
| `/noisy?n=N` | `console.error('noisy-N')`, `throw` of `noisy-pageerror-N` (via setTimeout), `<img src=/missing-noisy-N.png alt=x>` | used only to prove D9 scoping |
| `/shift?n=N` | the same deterministic 200px shift at 300 ms plus a big `<h1>`, `lang`, a title | used by E2 and L13 |
| `/img/ok.png` | 40×40 PNG | 200 |
| `/api/fail-*` | 500 `text/plain` | |
| `/missing-*` | 404 | |
| `/slow-404-*?ms=` | responds 404 after `ms` | |

---

## 4. Unit tests

Rule: **no existing test or assertion may be changed, loosened, skipped or deleted**, in particular the ones in T20. `EXPECTED_BROWSER_TOOLS` gets **one addition** (`'browser.audit'`). That's the only edit to an existing construct, and it's an addition.

### 4.1 `capability-runtime/tests/unit/audit-report.spec.ts` (new)

A fixture `png(w,h)` builds a real PNG base64 with pngjs. `fakeResult(overrides)` builds an `AuditResult`.

1. **AR1 (buildAuditReport):**
   - `schemaVersion === 1`;
   - every `AuditResult` field is copied by value;
   - `report.screenshot` deep-equals `{path:'/x/s.png', width:3, height:2, bytes:<decoded length>, fullPage:true}`;
   - `JSON.stringify(report)` doesn't contain the screenshot base64 string;
   - `'screenshotBase64' in report === false`.
2. **AR2 (baseline mapping):**
   - a success baseline gives `{url, diffPath, width, height, diffPixelCount, totalPixels, diffPercentage}` exactly, with no `diffImageBase64` key;
   - an error baseline gives `{url, error}` exactly;
   - `null` gives `null`.
3. **AR3 (pngDimensions):**
   - a 3×2 PNG gives `{width:3, height:2}`;
   - `Buffer.from('hello')` throws `/not a PNG/`;
   - a 10-byte PNG signature prefix throws.
4. **AR4 (prepareAuditOutDir):** `mkdtemp` + `a/b/c` (none exist) resolves to `path.resolve` of it, and `fs.stat` says it's a directory. Calling it again on the same path is idempotent.
5. **AR5:** outDir equal to an existing **file** rejects with `/^Cannot create audit output directory ".*"/`.
6. **AR6 (writeAuditArtifacts):**
   - into a non-existent nested dir: the file exists at `report.screenshot.path`, `path.isAbsolute`, and the bytes equal the decoded base64;
   - with a success baseline, the diff file exists at `report.baseline.diffPath`;
   - with an error baseline, `audit-baseline-diff.png` does **not** exist in a fresh dir.
7. **AR7:** a relative outDir (`'rel-out'` with `process.chdir(tmp)`, restored in `finally`) gives absolute paths inside `tmp`.
8. **AR8 (the schema file is well formed):** `JSON.parse(readFileSync('<pkg>/schemas/audit-report.schema.json'))`:
   - has `$schema` draft-07 and `$id === 'urn:sutradhar:audit-report:1'`;
   - `properties.schemaVersion.const === AUDIT_REPORT_SCHEMA_VERSION`.
9. **AR9 (drift, keys):**
   - `Object.keys(schema.properties).sort()` equals `Object.keys(AUDIT_REPORT_EXAMPLE).sort()`;
   - `schema.required.sort()` equals those keys minus `dialogPending` and `dialogsHandled`.
   - The same equality for `screenshot`, `webVitals`, `observation`, `consoleErrors.items`, `pageErrors.items`, `brokenRequests.items`, `accessibilityIssues.items`, and baseline `oneOf[1]` against `AUDIT_REPORT_EXAMPLE.baseline`.
   - `oneOf[2].required` equals `['url','error']`.
10. **AR10 (scopeToDocument):**
    - entries at `…:00.000Z`, `…:01.000Z`, `…:02.000Z` with since `…:01.000Z` give the last two (equality kept);
    - since `null` gives all 3;
    - an empty array gives an empty array.
11. **AR11 (computeObservation):**
    - (a) navigated, navStartedAt T, timeOrigin T+100, observingSince T−5000: `since` equals T, `coversWholeDocument:true`, `documentStartedAt` equals the ISO of floor(T+100);
    - (b) navigated, same-document (timeOrigin T−60000): `since` equals the ISO of T−60000;
    - (c) current-page, observingSince later than timeOrigin: `coversWholeDocument:false` and `since` equals the timeOrigin ISO;
    - (d) observingSince `null`: `false`;
    - (e) timeOrigin `null` in current-page mode: `since:null` and `coversWholeDocument:false`;
    - (f) `pageWasHidden` passes through `true`, `false` and `null`.

### 4.2 `capability-runtime/tests/unit/runtime.spec.ts`: append `describe('audit (FR2-12)')`

The fakes:
- `fakeTab`: `{id, url, page: fakePage, observingSince, getConsoleLogs, getPageErrors, getNetworkLog, getPendingDialog}`.
- `fakePage`: `{isClosed:()=>false, url:()=>URL, title:async()=>'T', screenshot: vi.fn(async()=>png(4,3)), evaluate: vi.fn(async()=>({issues:[], webVitals:{lcpMs:10,cls:0,fcpMs:5,ttfbMs:1}, timeOrigin, pageWasHidden:false})), waitForNetworkIdle: vi.fn(async()=>{}), evaluateOnNewDocument: vi.fn(), removeScriptToEvaluateOnNewDocument: vi.fn()}`.
- Injection goes through `vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({session:{}, tab: fakeTab})` and `vi.spyOn(runtime, 'navigate').mockResolvedValue({tabId:'t', url:URL, title:'T'})`.

1. **RA1:** `new SutradharRuntime({restrictNavigationToLocal:true}).audit('nope', {baselineUrl:'https://example.com'})` rejects `/restrictNavigationToLocal is enabled/`, not `BrowserNotAvailableError` (D14 ordering).
2. **RA2 (dialog fast-fail):** `getPendingDialog` returns `{dialogType:'alert', message:'hi'}`. The audit rejects `/a alert dialog is open \("hi"\)/`, and neither `fakePage.screenshot` nor `fakePage.evaluate` was called.
3. **RA3 (scoping, current page):**
   - `timeOrigin = Date.parse('2026-01-01T00:00:10.000Z')`;
   - the console logs hold an error at `…00:05.000Z` ("old") and at `…00:11.000Z` ("new");
   - the network log holds a 404 at `:05` and a 500 at `:11`;
   - `observingSince` is `…00:20.000Z`.

   Result:
   - `consoleErrors` has only `new`;
   - `brokenRequests` has only the 500;
   - `observation` equals `{mode:'current-page', coversWholeDocument:false, …}`;
   - `requestedUrl:null`, `baseline:null`.
4. **RA4 (scoping, navigated):** `observingSince` is far in the past, and entries have timestamps both before and after the moment `navigate` was called (make the `navigate` spy push a new entry). Only the entries after it survive, `coversWholeDocument:true`, and `requestedUrl` equals the url.
5. **RA5 (baseline success):** with `vi.spyOn(runtime,'compareUrls').mockResolvedValue({width:4,height:3,diffPixelCount:1,totalPixels:12,diffPercentage:8.33,diffImageBase64:'x'})`, `audit('s',{baselineUrl:'http://127.0.0.1/b'})` gives:
   - `compareUrls` called with `('s','http://127.0.0.1/b', URL, {tabId: undefined})`;
   - `baseline.url === 'http://127.0.0.1/b'`, and `diffPercentage` passed through.
6. **RA6 (baseline error):** `compareUrls` rejects `new Error('boom')` → the audit **resolves** with `baseline` deep-equal to `{url, error:'boom'}`.
7. **RA7 (settle, only if FR2-08 landed):** in URL mode, `fakePage.waitForNetworkIdle` was called once with `{idleTime:500, timeout:5000}` (FR2-08's pinned call shape). In current-page mode it's called 0 times.
8. **RA8 (dwell floor):** `audit('s',{url, settleMs:60})` takes at least 55 ms wall time. With the FR2-08-absent fallback, the same test holds.
9. **RA9 (Branch B):** `fakePage.evaluateOnNewDocument` was called 0 times in URL mode. **Branch A instead:** it's called once, and `removeScriptToEvaluateOnNewDocument` is called once with the returned identifier, **even when `navigate` rejects** (the finally path; assert the audit rejects and the remove still happened).
10. **RA10 (compareUrls settle):** with FR2-08 landed, `compareUrls('s', a, b, {settleMs:0})` on a fake page calls `waitForNetworkIdle` twice. The existing compareUrls tests at `:227-240` still pass untouched.

### 4.3 `browser` test: `observingSince`

1. **BT1:** `new BrowserTab(id)` gives an `observingSince` that matches ISO, and `Date.parse` is within 1000 ms of `Date.now()`. Append this to whichever `browser-tab` spec exists; if none exists, create `packages/browser/tests/unit/browser-tab-observing.spec.ts`.

### 4.4 `mcp-server/tests/unit/tools.spec.ts`: append `describe('browser.audit (FR2-12)')`

Validator: `import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'`. The schema is read by path from `../../../capability-runtime/schemas/audit-report.schema.json`.

1. **M1:** `EXPECTED_BROWSER_TOOLS` contains `'browser.audit'` (the addition). The existing count test (`:98-106`) passes with it.
2. **M2 (schema):**
   - `url.safeParse('')` fails, `url.safeParse(undefined)` succeeds;
   - the same for `baselineUrl`;
   - `includeImages.safeParse('yes')` fails;
   - `'outDir' in inputSchema === false`.
3. **M3 (content):** `runtime.audit` is spied to resolve `fakeResult` (a real 5×4 PNG).
   - `content.length === 2`;
   - `content[0].type === 'text'`, and its `JSON.parse` deep-equals `buildAuditReport(fakeResult, {screenshotPath:null, diffPath:null})`;
   - `content[1]` deep-equals `{type:'image', data: fakeResult.screenshotBase64, mimeType:'image/png'}`;
   - `content[0].text` doesn't contain `fakeResult.screenshotBase64`.
4. **M4 (baseline success):** `content.length === 3`, `content[2].data === diffImageBase64`, and `report.baseline.diffPath === null`.
5. **M5:** `includeImages:false` gives `content.length === 1`. A baseline error gives `content.length === 2` (no diff image) and `report.baseline.error` set, with **no `isError`**.
6. **M6 (argument pass-through, exact):**
   - `{sessionId:'s1', url:'http://127.0.0.1/a'}` → `toHaveBeenCalledWith('s1', {url:'http://127.0.0.1/a'})`;
   - `{sessionId:'s1'}` → `('s1', {})`;
   - all four arguments given → an object with exactly those keys.
7. **M7:** `runtime.audit` rejects `new Error('No browser session "x"')` → `isError`, the text starts with `audit failed: No browser session`, and the existing `Hint:` line is present.
8. **M8 (the schema validates real output):** the M3 report and the M4 report are `valid:true`. Then **negative mutations**, each `valid:false`:
   - an added `screenshotBase64` key;
   - `brokenRequests[0].status = 200`;
   - `delete webVitals`;
   - `observation.mode = 'other'`;
   - `schemaVersion = 2`;
   - `baseline = {url:'u'}` (matches neither branch);
   - `timestamp = 'yesterday'`;
   - `accessibilityIssues[0].count = 0`.

   `AUDIT_REPORT_EXAMPLE` itself is `valid:true`.
9. **M9 (FR2-08 settle classification):** if FR2-08's settle-classification test exists, `browser.audit` is in its **excluded** set and has no `settle` input key.
10. **M10 (FR2-10, if landed):** the registered `browser.audit` `sessionId.safeParse(undefined).success === true`. This is covered automatically by FR2-10's derived T1, so it's just asserted here as well.

### 4.5 `cli/tests/unit/audit-output.spec.ts` (new) and `parse-args.spec.ts` (append)

1. **C1 (`formatAuditText`, the full line list for a sample report):**
   - `URL: …`, `Title: …`, `Screenshot: <path>`, `''`, `Web Vitals:`, `  LCP: 212ms`, `  CLS: 0.09`, `  FCP: 180ms`, `  TTFB: 3ms`, `''`, `Console errors: 1`, `  - fr2-12-console-7`, `Page errors: 1`, …, `Broken requests (4xx/5xx): 2`, …, `''`, `Accessibility issues: 1`, `  - Images missing an alt attribute (1)`.

   Then (the order and blank lines match `cli.ts:379-396`, with the blank lines as separate entries because the old code used `\n` prefixes; a split on `\n` must give an identical sequence):
   - `lcpMs:null` gives `  LCP: n/a`;
   - a success baseline adds `''`, `Visual diff vs baseline (u):`, `  1 / 12 pixels (8.33%)`, `  Diff image: <path>`;
   - an error baseline adds `''`, `Visual diff vs baseline (u) failed: boom`.
2. **C2 (`auditNotes`):** empty for `coversWholeDocument:true, pageWasHidden:false`. Exactly one line starting `Note: console/page errors and broken requests cover only activity since` when coverage is false. A hidden-page note when `pageWasHidden:true`.
3. **C3 (`auditExitCode`):**
   - a clean report gives 0 whatever `failOnDiff` is;
   - console error + `failOnDiff` gives 1; without `failOnDiff`, 0;
   - brokenRequests only + `failOnDiff` gives 1;
   - baseline diff 0.5% + `failOnDiff` gives 1; without it, 0;
   - baseline error gives 1 even without `failOnDiff`.
4. **P1 (`parse-args`):**
   - `['audit','u','--baseline']` gives `baselineFlagGivenButInvalid:true` and `baselineFlag:undefined`;
   - `['audit','u','--baseline','--json']` gives `true`, and `jsonMode:true`;
   - `['audit','u','--baseline','https://b']` gives `false`, with `baselineFlag` equal to the URL;
   - no flag gives `false`.
5. **P2:** `['audit','u','out','--json']` gives `cleanArgs` equal to `['u','out']` and `jsonMode:true`.

### 4.6 `sutradhar/tests/unit/api.spec.ts`: append `describe('Page.audit (FR2-12)')`

The stub runtime's `audit` is a `vi.fn` resolving `fakeResult` (a real PNG, with an optional baseline).

1. **P3:** `page.audit()`:
   - `audit` is called with `('sess-1', {tabId:'tab-1'})` exactly;
   - the result has `report.screenshot.path === null`, `screenshotBase64` equal to `fakeResult`'s, and no `baselineDiffBase64` key.
2. **P4:** `page.audit({url:'http://x/', baselineUrl:'http://y/'})` → called with `{tabId:'tab-1', url:'http://x/', baselineUrl:'http://y/'}`, and `baselineDiffBase64` is present.
3. **P5:** `outDir` set to a non-existent nested tmp dir → both files exist, `report.screenshot.path` starts with `path.resolve(outDir)`, and the file bytes equal the decoded base64.
4. **P6:** `outDir` equal to an existing file → rejects `/Cannot create audit output directory/`, and the stub `audit` was called **0** times.
5. **P7:** the stub rejects `Error('no live browser page')` → `page.audit()` rejects with the same message.

---

## 5. Live-verify script: `tools/scenario-suite/verify-fr2-12-audit.mjs`

**Prerequisites:** `pnpm build`. Copy these helpers verbatim from `verify-fr2-01-wait-states.mjs` (GAP-005: don't refactor): `record`, `writeJsonl`, `resolveChromeExecutablePath`, `rmWithRetry`, `makeMcpClient`, `textOf`, `jsonOf`, `freshUrl`.

**The validator** is `createRequire(path.join(repoRoot,'packages','mcp-server','package.json'))('@modelcontextprotocol/sdk/validation/ajv').AjvJsonSchemaValidator`. No new dependency (T18).

**Surfaces:**
- CLI: `node packages/cli/dist/cli.js`, with `SUTRADHAR_CLI_STATE_DIR` set to a per-run tmp dir;
- MCP: `packages/mcp-server/dist/cli.js` over stdio;
- SDK: `packages/sutradhar/dist/index.js`;
- the bundle CLI, `packages/sutradhar/dist/cli-bin.js`, for L19 only.

**Outputs** go to `.ai/loop/field-report-2/evidence/FR2-12/`: `step0-*.json`, `step0-decision.md`, `live-cli.jsonl`, `live-mcp.jsonl`, `live-sdk.jsonl`, `live-summary.json`, `live-verify.log`, plus sample `report-*.json` files. PNGs go to a git-ignored tmp dir and are not committed. The script exits 1 on any failure.

**Helper `checkPng(path, report)`:**
- the file exists;
- bytes 0–7 are the PNG signature;
- `fs.stat.size === report.screenshot.bytes`;
- the IHDR width and height equal `report.screenshot.width/height`.

**Helper `noBase64(obj)`:**
- no key matches `/base64/i` at any depth;
- no string value is longer than 20000 characters.

### 5.1 Step 0: `--step0`, run on the **pre-change** build before any edits

Nothing is asserted here; everything is recorded.

- **E0a:** CLI `audit <origin>/audit?n=1 <tmp>/x/y/z` → record the exit code and stderr. Expected: 1, with `ENOENT`.
- **E0b:** CLI `audit <origin>/audit?n=2 <tmp> --json` → record stdout. Expected: human text, not JSON.
- **E1a (reattach coverage):** CLI `nav <origin>/audit?n=3` (process 1), then `audit` (process 2) → record `consoleErrors`/`pageErrors`/`brokenRequests` counts from the text. Expected: brokenRequests 0; console errors to be seen (the V8 replay question). This decides the exact wording of the stderr note only, not the design.
- **E1b (contamination, B1):** use the runtime directly (`packages/capability-runtime/dist/index.js`): `launch({headless:true})`, then `navigate(/noisy?n=4)`, then `navigate(/clean?n=4)`, then `audit(sid)` → record `consoleErrors`. Expected: it contains `noisy-4`. Then `audit(sid,{url:/clean?n=5})` → the same record.
- **E1c (CLS × k, B2):** in the same runtime, `audit(sid,{url:/shift?n=6})` three times → record `cls` each time. Expected: about 1×, 2× and 3×.
- **E1d:** the CLI runs `audit /shift?n=7` twice (separate processes) → record `cls`. Expected: equal, because the script doesn't persist across CDP sessions. This confirms B2 is MCP/SDK-only.
- **E2 (the buffered-read decision):** a fresh runtime; `navigate(tabB, /shift?n=8)`; then a Node-side poll with `runtime.eval('window.__fr212ShiftDone === true')` every 100 ms, bounded to 5 s (no bare sleep); then `runtime.eval` of the Branch-B `readBuffered` expression. It returns:
  - `{visibility: document.visibilityState, syncLcp: [...startTimes], syncCls, asyncLcp: <entries from a callback observer within 250 ms>}`.

  The reference is `runtime.audit(sid, {url:/shift?n=9, tabId: tabA})` on a **fresh** tab A (a first audit, so k = 1) → `webVitals`. Repeat 3 times with new nonces.
  - **Decision rule:**
    - **B** if every run has `visibility === 'visible'`, a non-empty `syncLcp`, and `|syncCls − refCls| < 0.001`;
    - **B′** if sync is empty but async isn't;
    - **A** otherwise.
  - Write the decision and the raw numbers to `step0-decision.md`.
  - If `visibility !== 'visible'`, the run is invalid, not a refutation: fix the harness and rerun.
- **E3 (fixed-sleep miss):** runtime `audit(sid,{url:/audit?n=10&slow=2500})` → record whether `/slow-404-10` is in `brokenRequests`. Expected: absent.

### 5.2 Cases, post-change

1. **L1 (mkdir).** CLI `audit <o>/audit?n=11 <tmp>/a/b/c` (none exist):
   - exit 0;
   - stdout has `Screenshot: <abs>` with `<abs> === path.resolve(<tmp>/a/b/c/audit-screenshot.png)`;
   - `checkPng` passes (using dimensions from the PNG itself).
2. **L2 (`--json`, the core case).** CLI `audit <o>/audit?n=12&slow=2500 <tmp>/j --json`:
   - exit 0;
   - `JSON.parse(stdout)` succeeds, and the whole of stdout is that one document (`JSON.stringify(parsed, null, 2) + '\n' === stdout`, allowing CRLF normalization);
   - it validates against the schema;
   - `noBase64` passes;
   - `checkPng(report.screenshot.path)`, and the path is absolute;
   - `consoleErrors[].text` includes `fr2-12-console-12`;
   - `pageErrors[].message` includes `fr2-12-pageerror-12`;
   - `brokenRequests` contains `{url:<o>/missing-12.png, status:404}` and `{url:<o>/api/fail-12, status:500}`, plus (D7 landed) `/slow-404-12` 404;
   - the `accessibilityIssues` rule→count map equals `{img-alt:1, input-label:1, missing-lang:1, button-name:1}`;
   - `webVitals`: `lcpMs > 0`, `cls > 0.01`, `fcpMs > 0`, `ttfbMs >= 0`;
   - `observation` has `mode:'navigated'`, `coversWholeDocument:true`, `pageWasHidden:false`;
   - `requestedUrl` equals the url, and `baseline:null`.
3. **L3.** The same with `--fail-on-diff` → exit 1, and stdout is still a valid report.
4. **L4 (baseline).**
   - `audit <o>/audit?n=13 <tmp>/b --json --baseline <o>/clean?n=13` → `baseline.diffPercentage > 0`, `diffPath` is absolute, `checkPng`-style signature and IHDR equal `baseline.width/height`, and exit 0.
   - `audit <o>/clean?n=14 <tmp>/b2 --json --fail-on-diff --baseline <o>/clean?n=14` → `diffPercentage === 0`, no findings, exit 0.
4. **L5 (baseline failure).** `audit <o>/clean?n=15 <fresh tmp> --json --baseline http://127.0.0.1:1/`:
   - exit 1;
   - a valid report with `baseline.error` non-empty;
   - `audit-baseline-diff.png` absent;
   - stderr has no `Fatal:`.
6. **L6 (current page, separate processes).** `nav <o>/audit?n=16`, then `audit "" <tmp>/cp --json`:
   - `mode:'current-page'`, `coversWholeDocument:false`, `requestedUrl:null`;
   - stderr has `Note: console/page errors and broken requests cover only activity since`;
   - **Branch B:** `lcpMs > 0` and `cls > 0.01` (the new capability). **Branch A:** both are `null` and the description says so.
   - The counts are recorded next to E1a.
7. **L7 (text mode unchanged).** `audit <o>/audit?n=17 <tmp>/t`: the line labels (text before the first `:`) equal E0's baseline run label sequence (recorded in step 0 from a pre-change run on `/audit?n=0` with an existing dir), and no line contains `n/ams`.
8. **L8 (bad outDir).** Write a file `<tmp>/file`, then `audit <o>/clean?n=18 <tmp>/file`:
   - exit 1, and stderr has `Cannot create audit output directory`;
   - with an empty `SUTRADHAR_CLI_STATE_DIR`, no `state.json` was created, and the Chrome process count is unchanged, so no spawn happened.
9. **L9 (MCP URL mode).** `browser.launch {headless:true}` → S. `browser.audit {sessionId:S, url:<o>/audit?n=19&slow=2500}`:
   - `content[0]` validates; its `screenshot.path` is `null`;
   - `content[1].type === 'image'`, and its base64 decodes to a PNG whose IHDR and byte length equal `report.screenshot` width/height/bytes;
   - `noBase64(report)`;
   - the findings match L2's criteria for nonce 19.
10. **L10.** `includeImages:false` → `content.length === 1`.
11. **L11 (MCP baseline).** `{url:<o>/audit?n=20, baselineUrl:<o>/clean?n=20}` → `content.length === 3`, `content[2]` is a PNG with IHDR equal to `baseline.width/height`, `baseline.diffPath === null`, and `diffPercentage > 0`.
12. **L12 (B1 fixed).**
    - `browser.navigate /noisy?n=21`, then `/clean?n=21`, then `browser.audit {sessionId:S}` → `consoleErrors`, `pageErrors` and `brokenRequests` are all `[]`, and `coversWholeDocument:true`.
    - `browser.navigate /noisy?n=22`, then `browser.audit {url:/clean?n=22}` → all `[]`.
    - E1b's pre-change record is cited next to it.
13. **L13 (B2 fixed).** `browser.audit {url:/shift?n=23..25}` three times:
    - `max(cls) − min(cls) < 0.005`, and each is within 0.005 of E2's reference;
    - then `browser.navigate /clean?n=26` and `browser.eval {code:'typeof window.__sutradharVitals'}` gives `"undefined"`.
14. **L14 (dialog).** `browser.eval {code:'setTimeout(()=>alert("fr212"),0); 1'}`, then `browser.audit {sessionId:S}`:
    - `isError`, and the text contains `alert dialog is open ("fr212")`;
    - it takes less than 3000 ms;
    - then `browser.handle_dialog dismiss`.
15. **L15 (GAP-038).** L9's `/slow-404-19` entry is present.
    - If D7 landed: asserted, with `executionMs` recorded.
    - Otherwise: recorded as `expected-miss` alongside E3.
16. **L16 (SDK).** `launch({headless:true})`, `page = (await browser.pages())[0]`, then:
    - `page.audit({url:<o>/audit?n=27, outDir:<tmp>/s/1})` → the report validates, `checkPng(report.screenshot.path)`, and `Buffer.from(screenshotBase64,'base64')` equals the file bytes;
    - `page.audit()` (current page, no outDir) → `path:null`, `mode:'current-page'`, `coversWholeDocument:true` (same process).
17. **L17 (SDK baseline).** `page.audit({url:/clean?n=28, baselineUrl:/audit?n=28, outDir:<tmp>/s/2})` → the diff file exists, and `baselineDiffBase64` equals the file bytes.
18. **L18 (the schema bites).** Apply M8's mutation list to L2's real report: each one is `valid:false`, and the unmutated report is `valid:true`.
19. **L19 (bundle).** `cli-bin.js audit <o>/clean?n=29 <tmp>/bundle --json` → a valid report, and `checkPng`.
20. **L20 (hidden page, informational).** In the MCP session:
    - `browser.new_tab {url:<o>/clean?n=30}` (becomes the foreground);
    - `browser.navigate {tabId:<original>, url:<o>/audit?n=30}`;
    - `browser.audit {tabId:<original>}` → record `observation.pageWasHidden` and `webVitals`.

    Assert only the honesty invariant: if `pageWasHidden === false`, then `fcpMs !== null`. If headless never hides the tab, record `not-reproducible-headless`. **No pass is fabricated.**

**Teardown:**
- `browser.shutdown_all`; close the MCP stdin (FR2-03 makes the server exit);
- SDK `browser.close()`; CLI `close`; the fixture `close()`;
- `rmWithRetry` every tmp dir.

The final check counts leftover Chrome processes whose command line holds this run's profile or state dirs, plus leftover `puppeteer_dev_chrome_profile-*` and `sutradhar-cli-*` dirs created after the script started. Both must be 0.

**Regression gates:**
- `vitest` for `browser`, `capability-runtime`, `mcp-server`, `cli`, `sutradhar`;
- `tsc` for those plus their dependents;
- `tools/scenario-suite/ci-gate.mjs` on all 3 surfaces (the runtime changed);
- `verify-fr2-08-conditions.mjs` if it exists (shared settle);
- `verify-fr2-10-optional-session.mjs` if it exists (tool registration).

---

## 6. Negative cases

| # | Case | Expected | Where |
|---|---|---|---|
| N1 | outDir doesn't exist (nested) | created; the audit succeeds | AR4, AR6, L1, P5 |
| N2 | outDir is an existing file | CLI exit 1 **before any Chrome spawn or attach**; SDK rejects before `runtime.audit` | AR5, L8, P6 |
| N3 | `--json` plus a fatal error (e.g. `--allowlist-domains other.com` blocking the url) | exit 1, empty stdout, `Fatal:` on stderr | L-extra in L8's block: run it and assert |
| N4 | `--baseline` with no value, or followed by a flag | exit 1 with the D13 message | P1, a live one-liner in L5's block |
| N5 | The baseline navigation fails | `baseline.error`, a valid JSON report, exit 1, no diff file; MCP not `isError` | RA6, M5, L5 |
| N6 | The baseline is blocked by policy | thrown before any browser contact (MCP `isError`, CLI `Fatal`) | RA1 |
| N7 | MCP `url: ""` | SDK validation error; the runtime isn't called | M2 |
| N8 | An open dialog | fast `isError`/throw, with no evaluate or screenshot | RA2, L14 |
| N9 | A previous document's errors in the tab buffers | excluded | RA3, RA4, L12 |
| N10 | Repeated URL audits in one tab | CLS isn't multiplied; no leaked global | RA9, L13 |
| N11 | CLI current-page audit in a new process | `coversWholeDocument:false`, plus a stderr note; never claimed as complete | AR11c, C2, L6 |
| N12 | The report carries base64 | never (key scan and size) | AR1, M3, L2, L9 |
| N13 | Schema drift or a malformed report | rejected by the schema; key-set drift fails AR9, and interface drift fails `tsc` | AR9, M8, L18 |
| N14 | `--fail-on-diff` on a clean page with a 0% baseline diff | exit 0 | C3, L4b |
| N15 | A stale `audit-baseline-diff.png` from an earlier run, and this run has no baseline | `baseline:null`; the file isn't touched or referenced (documented) | AR6 (fresh dir), documented |
| N16 | A hidden page | vitals may be null, flagged by `pageWasHidden`; no fabricated values | L20 |
| N17 | A garbage screenshot buffer | `pngDimensions` throws; the audit fails loudly | AR3 |
| N18 | An unknown session (MCP) | `isError` with the existing hint | M7 |

---

## 7. Risks

1. **R1 (FR2-08 hasn't landed).** Handled by D7's fallback (keep the sleeps; GAP-038 stays open; L15 is `expected-miss`). The Executor must never copy settle code into capability-runtime.
2. **R2 (E2 refutes the buffered read).** Branch A keeps today's current-page nulls, documented honestly, and still fixes B2. The branch is decided by data before any code is written.
3. **R3 (FR2-04 stdout dialog lines corrupting `--json`).** D2.4 follows FR2-07's switch. L2's "stdout is exactly one document" assertion catches a regression. If FR2-04's mechanism can't be switched without editing its code, the Executor stops and reports.
4. **R4 (clock skew).** Current-page scoping compares the browser's `timeOrigin` with Node timestamps. Local Chrome shares the clock. On a remote `attach`, skew can drop or keep entries near the boundary. Navigated mode uses `min(navStartedAt, documentStartedAt)`, which is robust to a browser clock running ahead. This is documented in the changelog.
5. **R5 (behavior changes, all intentional; changelog):**
   - MCP/SDK results can have **fewer** errors: contamination is removed (B1);
   - current-page `lcpMs`/`cls` go from `null` to numbers (Branch B);
   - `cls` in multi-audit sessions is no longer inflated (B2);
   - `audit(url)`/`compareUrls` can take longer on busy pages (up to ~5.5 s settle bound);
   - a baseline failure no longer dies with `Fatal:` (still exit 1);
   - text mode `n/ams` becomes `n/a`;
   - `--baseline` without a value now errors.
6. **R6 (context cost).** A full-page PNG inline on MCP. Mitigated by `includeImages:false` and the description.
7. **R7 (hostile page).** `AUDIT_PAGE_SCRIPT` runs in the page's main world, so a page can falsify its own audit. Console text is page-controlled (prompt-injection text inside the JSON). This matches the existing `get_console_logs`/`eval` exposure and isn't new. Noted in the changelog.
8. **R8 (cross-item test coupling).**
   - FR2-08's settle-classification test must list `browser.audit` (M9).
   - FR2-10's derived T1 covers it automatically.
   - FR2-07's contract sweep must **not** expect `verification` on `browser.audit`. If an FR2-07 test enumerates every tool for `verification`, the Executor adds audit to its documented exclusions, citing D12, and says so in the report.
   - The tool count is +1 over whatever it is at merge time; docs quote the real number.
9. **R9 (`--baseline` destroys page state).** It re-navigates. This is pre-existing and now documented on every surface.
10. **R10 (ring-buffer caps).** 200/50/200, so a noisy page can evict early entries (GAP-new-E).
11. **R11 (rebase).** `runtime.ts`, `cli.ts`, `tools.ts`, `page.ts`, `parse-args.ts` and `browser-tab.ts` are all touched by earlier items. Anchor by symbol: `audit`, `compareUrls`, `cmdAudit`, `main`'s flag checks, `registerTools`'s Capture section, `Page`, `parseArgs`, `BrowserTab` constructor.

### 7.1 Gaps to append to `gaps.md`

- GAP-new-A through GAP-new-G, exactly as §0.3 lists them.
- GAP-038: update its status as D7 dictates.

### 7.2 Changelog fragment (`evidence/FR2-12/changelog-fragment.md`)

- **New:** the MCP tool `browser.audit` (JSON report first, then the screenshot and optional diff images; `includeImages`; `baselineUrl`). SDK `page.audit({url?, outDir?, baselineUrl?})` → `{report, screenshotBase64, baselineDiffBase64?}`. CLI `audit --json` (one JSON document on stdout; images written to files, referenced by absolute path, never inlined).
- **New:** the committed JSON Schema `packages/capability-runtime/schemas/audit-report.schema.json` (`schemaVersion` 1, draft-07).
- **Fixed:**
  - `audit` creates `outDir` (it used to crash with ENOENT after running the audit);
  - audit findings are scoped to the audited document (previous pages' errors leaked into later audits in long-lived MCP/SDK sessions);
  - CLS is no longer multiplied by the number of URL audits in the same tab;
  - an open dialog fails the audit fast instead of hanging;
  - `--baseline` without a URL is rejected instead of silently skipped.
- **Changed:**
  - with a url, audit waits for DOM/network quiet (bounded), in addition to the previous minimum dwell (if FR2-08's settle landed);
  - current-page audits now report LCP/CLS (Branch B);
  - the report states coverage (`observation.coversWholeDocument`) and hidden-page state (`observation.pageWasHidden`);
  - a baseline comparison failure is reported in the output (exit 1) instead of aborting it;
  - text mode prints `n/a` instead of `n/ams`.
- **Not an action:** audit results carry no `verification` field (FR2-07 applies to actions only).
- **Known limits:**
  - network-level request failures aren't counted as broken requests;
  - accessibility checks are heuristics;
  - CLS is the legacy total;
  - scoping near the document boundary assumes the browser and Node share a clock.

---

## 8. Rollback

It's a single commit, and `git revert` is complete:
- no persisted state, no migration;
- the only new on-disk artifacts are the PNGs the user asked for;
- the schema file and the fixture are self-contained;
- reverting restores the fixed sleeps, the vitals injection, `--json` being ignored on audit, and the absence of `browser.audit`/`page.audit`.

**Partial rollbacks**, each self-contained:
- (a) Remove the `browser.audit` registration and its `EXPECTED_BROWSER_TOOLS` entry. The runtime, CLI and SDK stay.
- (b) Revert `settleAfterNavigation` to the plain `setTimeout(floorMs)`. This reopens GAP-038.
- (c) **Branch B → A:** restore `VITALS_OBSERVER_SCRIPT` with the idempotence guard and the `removeScriptToEvaluateOnNewDocument` finally, if Branch B misbehaves on some Chrome version in the field.

---

### Critical Files for Implementation
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\capability-runtime\src\runtime.ts (`audit` at :1420-1465 and `compareUrls` at :1473-1495)
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\capability-runtime\src\audit\site-audit.ts (the AuditResult type, AUDIT_PAGE_SCRIPT, and VITALS_OBSERVER_SCRIPT with its buffered:true premise)
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\cli.ts (`cmdAudit` at :372-424, the help text at :903-937, `main()` flag checks)
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\mcp-server\src\tools.ts (the new `browser.audit`, next to `browser.screenshot` at :911-929)
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\session\browser-tab.ts (ring buffers at :159-161 and :588-692; the one `observingSince` field)