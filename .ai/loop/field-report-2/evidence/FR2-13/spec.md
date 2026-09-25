# FR2-13: `sutradhar run <scenario.(yaml|json)>`, a declarative scenario runner (implementation spec)

**Item:** FR2-13 (Phase 3, packaging). It adds a new CLI verb that runs a declarative scenario file. Each step maps onto a runtime call that already exists. Assertions reuse FR2-07's `expect`, FR2-08's `wait_for` and FR2-02's `extract_data` shapes. Gates count console errors, page errors and broken requests over the whole run. The runner writes a versioned JSON report, a per-run history JSONL (FR2-11's line family) and screenshots on failure (FR2-12's path-not-base64 convention).

**Base:** HEAD `45e7b79` on `claude/field-report-2-loop`. All line numbers below were read in this planning session at that commit. Every prerequisite item changes files this item touches, so **the Executor anchors by symbol name, not by line number.**

**Decisions in force:**
- §4.5: accept `.json` and `.yaml`, add the `yaml` package, and validate the committed JSON Schema at load. This is not reopened.
- §4.8: honesty. A check that can't really be verified returns `verified:false` with a concrete reason.
- §4.9: additive, then smallest diff, then consistency.
- FR2-07 D1/D5/D6/D11: one evidence shape. `expect` never changes `success`. `expect.text` means visible text. Evidence never holds field values.
- FR2-08 D1/D4/D6/D8/D10: `wait_for` runs at runtime level, `textGone` can be vacuous, `js` is an expression, `timeoutMs: 0` means "check once", and wait, expect and settle are distinct.
- FR2-11 D1/D3 and §2.2/§2.7: the session ring with `seq`, the exact `verification` field, the sanitizer, the 200/300 caps, the 64 KiB line guard, and the versioned `{v:1, type}` JSONL lines.
- FR2-12 D2.1/D2.3/D2.7/D5: in `--json` mode stdout is exactly one JSON document. Paths are absolute and OS-native. The out dir is prepared before any browser work. The schema is hand-written draft-07 in `packages/<pkg>/schemas/`, with a tsc-enforced example plus key-set tests and ajv validation.

**Hard preconditions** (the loop prompt §5 names them; they are not softened here): **FR2-07, FR2-08, FR2-11 and FR2-12 must all be DONE before DEVELOP starts.** FR2-02 is also required in practice, because three of the four ports assert on `extract_data` live `.value` / `visibleOnly` semantics (§7.1). Before writing any code, the Executor runs every grep in §7.1 and stops and reports if any of them finds nothing.

**Versioning:** no bump of its own. The item writes `evidence/FR2-13/changelog-fragment.md`.

---

## 0. Trace results

### 0.1 What `tools/scenario-suite` is today (it is not a runner)

| # | Finding | Evidence |
|---|---|---|
| T1 | `SCENARIOS` is 14 objects `{id, title, url, steps, successCriteria}`. **`steps` and `successCriteria` are free English prose.** Nothing parses them. | `tools/scenario-suite/scenarios.mjs:18-117` |
| T2 | Each surface re-implements all 14 UCs by hand, in code. `run-sdk.mjs` drives `SutradharRuntime` in-process (`:12`, `:17`) with a `withSession` that uses `runtime.launch({headless})` + `setViewport(1280x800)` + `shutdown` in a `finally` (`:19-27`). `run-cli.mjs` spawns `node packages/cli/dist/cli.js <verb>` once per step, with a run-scoped `SUTRADHAR_CLI_STATE_DIR` (`:28-31`, `:43-60`), and scrapes stdout with regexes (e.g. `:312`, `:336`). `run-mcp.mjs` speaks raw JSON-RPC to `packages/mcp-server/dist/cli.js` (`:13`, `:23-79`). | as cited |
| T3 | **Fixed sleeps (GAP-037).** `run-sdk.mjs:85, 126, 214, 261, 336, 388, 488, 588, 646, 652`. `run-cli.mjs:152, 189, 257, 271, 437, 459, 537`. `run-mcp.mjs:150, 170, 228, 345, 360, 403, 518, 667`. **The four ports chosen in §3 cover the equivalents of 8 of them:** sdk `:261` (UC-05), `:336` (UC-06), `:646` and `:652` (UC-14); cli `:437` (UC-06); mcp `:345` and `:360` (UC-06), `:667` (UC-14). | grep this session |
| T4 | Result shape is `{id, title, surface, success, ms, detail, error}` per UC. `ci-gate.mjs` only reads the **committed** `results/baseline-{sdk,cli,mcp}.json` files (`:21-33`). This is GAP-060's lesson: it is a health gate over stored files, not a run. | `ci-gate.mjs:13-57` |
| T5 | Ground truth the ports depend on, confirmed from stored live evidence and driver comments:<br>- UC-06's modal Close is `<div class="modal-footer"><p>Close</p></div>` ("verified live", `run-mcp.mjs:348-351`);<br>- `#finish` reads `Hello World!` (`results/post-fix-cli-phase7.json`, `dynamicLoadingText`);<br>- the saucedemo confirmation text is `Thank you for your order!`;<br>- the aria-menu fixture's result node is `#action-result` (`fixtures/aria-menu.html:24`);<br>- the prompt-injection fixture hides its injected span with `display:none` (`fixtures/prompt-injection.html:7-11`). | as cited |

### 0.2 The CLI today, where `run` slots in, and the conflicts

| # | Finding | Evidence |
|---|---|---|
| T6 | **No `run` verb exists.** The dispatch `switch (verb)` covers doctor…profile, and anything else prints help and exits 1. | `packages/cli/src/cli.ts:760-965` |
| T7 | Every existing verb is one-shot. Browser verbs go through `withSession`, which **attaches to this directory's persistent detached Chrome** (from `state.json`) or spawns one and writes state. | `cli.ts:92-147`, `state.ts:69-93` |
| T8 | **Three places force exit 1, which would break `run`'s exit-2 contract:**<br>- `printErrorAndExit` calls `process.exit(1)` (`:50-53`);<br>- `main()`'s pre-dispatch validation (unrecognized flags, `--viewport`, `--state`) uses it (`:748-759`);<br>- `main().catch` sets `process.exitCode = 1` (`:968-972`).<br>`run` must therefore be dispatched **before** these checks, and must never let an error escape to `main().catch`. | as cited |
| T9 | `main().finally` disconnects the active session's CDP client and arms a 3 s `unref`'d force-exit (`:974-992`). A `run` that has already shut down its own browser is compatible with this. | as cited |
| T10 | `parse-args.ts` has a fixed `KNOWN_FLAGS` set plus `isConsumedValue` for valued flags (`:135-161`). Unknown `--x` goes into `unrecognizedFlags` (`:164`). There is no `--out` and no `--base-url`. | `parse-args.ts` |
| T11 | Packaging: `scripts/build-bundle.mjs` esbuild-bundles `packages/cli/src/cli.ts` into `packages/sutradhar/dist/cli-bin.js` with **only `puppeteer-core` external** (`:92-113`). Every other dependency is inlined, which is how pngjs/pixelmatch ship today. `packages/sutradhar/package.json` has exactly one runtime dependency, `puppeteer-core`. | as cited |
| T12 | **No YAML library anywhere.** A grep of every `package.json` under `packages apps tools scripts` for `yaml` finds nothing, and `node_modules/.pnpm` has no `yaml@*`. **`ajv@8.20.0` is already in the install graph**, transitively through `@modelcontextprotocol/sdk@1.30.0` (FR2-12 T18). | grep, `ls node_modules/.pnpm` |

### 0.3 The runtime surfaces the runner drives

| # | Finding | Evidence |
|---|---|---|
| T13 | `runtime.launch()` returns `{sessionId, activeTabId, hasRealBrowser}`. **If Chrome can't be launched it falls back silently to a mock instance** (`browser-launcher.ts:145-170` swallows the Puppeteer error, and `runtime.ts:267-271` reports `hasRealBrowser:false`). This is GAP-046's class. The runner must treat `hasRealBrowser:false` as an infrastructure failure and shut that session down. | as cited |
| T14 | `CHROME_PATH` is honoured only if the file exists (`browser-launcher.ts:82-84`). If it names an existing non-Chrome binary (such as `node.exe`), `puppeteer.launch` fails and the mock fallback kicks in. That is a real, deterministic way to test exit 2 for a launch failure (§5 L22). | as cited |
| T15 | `runtime.screenshot(sid, tabId?, fullPage = true)` returns `{base64}` (`runtime.ts:834-843`, `types.ts:62-65`). `ActionResult.failureScreenshot?: string` is the engine's own capture at final failure (`types.ts:100`). | as cited |
| T16 | Duplicate-action guard: the same `actionType` plus the same target on the same tab within **1000 ms** gives `success:false` with "Duplicate '…'" (`browser-action-engine.ts:71`, `:488-525`). The target key includes the role, name or text (a fix already landed). A scenario that repeats an identical mutating step within 1 s will hit this (§7.3 R8). | as cited |
| T17 | **Observability sinks.** The per-tab ring buffers are capped at 200/50/200 (`browser-tab.ts:49-51`). The same listener callbacks also `publish` `browser:console:message` `{sessionId, tabId, logType, text}`, `browser:page:error` `{sessionId, tabId, message, stack?}` and `browser:network:response` `{sessionId, tabId, url, status}` on the runtime's `EventBus` (`browser-tab.ts:588-692`). Popup tabs get the bus too (`browser-session.ts:155`, `:233`, `:277`). | as cited |
| T18 | `EventBus.publishEvent` calls every subscriber for each event. There is no cap and no buffering, and handlers are error-isolated (`packages/events/src/bus/event-bus.ts:47-82`). `runtime.getEventBus()` is public (`runtime.ts:1618-1620`). The only code that references `browser:network:response` is its publisher and the event map (grep), so **adding an event type breaks no consumer.** | as cited |
| T19 | **`requestfailed` is never listened to** (`browser-tab.ts:630-692`, GAP-062). A DNS error, a refused connection or an in-flight abort is invisible to both the ring buffer and the bus. `NetworkLogEntry.phase` is `'request' \| 'response'` (`:77-84`). The only test that pins network-log shape uses `toMatchObject` on `phase:'request'/'response'` entries (`browser-tab-observability.spec.ts:153-154`), and an extra listener doesn't affect it. | as cited |
| T20 | `assertNavigationAllowed` throws `Navigation to "<url>" was blocked: …` before any browser contact. `file:`, `about:` and `data:` always pass (`runtime.ts:1726-1760`). | as cited |

### 0.4 The shapes this item composes (each checked against the specs; no approximated names)

| From | Exact name and shape this spec uses | Source |
|---|---|---|
| FR2-07 | `ActionExpectation {text?, url?, urlChanged?}`. `toVerificationSpec` throws a `TypeError` before `resolveTab`. `failedExpectations(v): string[]` returns the keys `'text'\|'url'\|'urlChanged'` whose outcome isn't `pass`. `VerificationResultDto {verified, urlChanged, elementFound, confidence, reason, evidence}`. `VerificationEvidence {tier, checks[]}`. `EvidenceCheck {check, outcome, expected?, observed?, detail?}`. Tiers are `verified \| contradicted \| unverifiable \| low-confidence \| action-failed`. `expect` goes **last** on every action method, and the arity rule passes it only when it's defined. Its §7.2 hand-off: *"FR2-13 maps its scenario `expect` onto `ActionExpectation` and uses `failedExpectations`."* | FR2-07 spec §2.1, §2.6, §2.9, §7.2.11 |
| FR2-07 | Exit-code precedence for the other CLI verbs: action failed → 1, expectation failed or not evaluated → 4. **`run` keeps its own 0/1/2 contract** (Done-when). Both "expectation failed" and "action failed" map to run-exit 1, with different `failure.kind` values (§2.6). | FR2-07 §2.9 table |
| FR2-08 | `runtime.waitFor(sid, condition: WaitForCondition, tabId?)`. `WaitForCondition {text?, textGone?, url?, js?, timeoutMs?}` (default 10000, max 300000, 0 = check once, no retries). It returns an `ActionResult` with `actionType:'wait_for'`, `output.presentAtStart` (only with `textGone`), `error` = `formatConditionFailure(...)` text, or the fatal message `wait_for blocked by an open <type> dialog …`. `normalizePageCondition` throws `TypeError('wait_for: …')`. `SettleSpec {mutationQuietMs, networkIdleMs, timeoutMs}` and `DEFAULT_SETTLE_SPEC` come from `page-settle.ts`. `settle` is the **new last** positional parameter (D13). | FR2-08 spec §2.1, §2.3, §2.4, D13 |
| FR2-01/07 | The `wait_for_selector` output keys are `state`, `matchedAtStart`, `otherVisibleMatches`. A vacuous `hidden` (nothing matched) comes back as tier `unverifiable`. | FR2-07 D14 |
| FR2-02 | `extractData(sid, fields: Record<string, ExtractFieldSpec>, tabId?, frameSelector?, options?: ExtractDataOptions)` returns `Record<string, string[]>`. `ExtractFieldSpec {selector, attribute?, visibleOnly?}`. `ExtractDataOptions {visibleOnly?}`. An invalid selector throws `Error` starting `Invalid selector for field "…"`. With no attribute, a form control gives its live `.value`; any other element gives trimmed `innerText`, which **falls back to `textContent` for a `display:none` element** (edge table). | FR2-02 spec §2.1-§2.3, §2.6 |
| FR2-11 | `getActionHistoryReport(sid, {scope:'session'})` returns `{scope, entries: SessionActionHistoryEntry[], evicted, capacity}`. Entries are `{...ActionHistoryEntry, tabId, seq}`, with `seq` strictly increasing. `capHistoryString`, `redactHistoryUrl`, `redactUrlsInText`, `sanitizeHistoryEntry`, `HISTORY_STRING_CAP = 200`, `HISTORY_TEXT_CAP = 300` come from `@sutradhar/browser`. `CliHistoryLineV1 {v:1, type:'command', …}` has *"`type`: discriminator: FR2-13's runner may add other types later"*. `HISTORY_MAX_LINE_BYTES = 64 KiB`, `appendHistoryLine`, `readHistoryFile` (valid iff `v` is a positive integer). `packages/cli/src/index.ts` exports `type CliHistoryLineV1` "for FR2-13". The CLI records **only commands that go through `withSession`**. | FR2-11 spec §2.1-§2.7 |
| FR2-12 | Schema at `packages/capability-runtime/schemas/audit-report.schema.json`: draft-07, `$id` `urn:sutradhar:audit-report:1`, `additionalProperties:false`, *"FR2-13's scenario schema can use the same convention"*. The drift guards are `AUDIT_REPORT_EXAMPLE: DeepRequired<…>`, key-set tests and `AjvJsonSchemaValidator`. `runtime.audit(sid, {url?, tabId?, settleMs?, baselineUrl?})` returns `AuditResult`. `writeAuditArtifacts(result, outDir)` returns an `AuditReport` with absolute paths. `pngDimensions(buf)`. The audit filters are console `logType === 'error'` and `phase === 'response' && status >= 400` (D9). Fixture: `tools/scenario-suite/fixtures/fr2-12-audit-server.mjs` → `startAuditFixtureServer(): Promise<{origin, close()}>` with `/audit?n=N`, `/clean?n=N` and `/slow-404-*`. It is *"a reusable module … because FR2-13's `maxConsoleErrors`/`failOnBrokenRequests` gates need exactly this page"*. | FR2-12 spec D5, D9, §2.2-§2.4, §3 |

### 0.5 Decisions (the Orchestrator records these in `decisions.md`)

**D1. `sutradhar run` is a new CLI verb that drives `SutradharRuntime` in-process on its own freshly launched, isolated browser. It does not use `withSession`, does not attach to the directory's session, and does not spawn the CLI's detached Chrome.**
- *Why a CLI verb:* the name is a CLI command, and the Done-when's exit codes are process exit codes. The published `sutradhar` bin is the CLI bundle (T11).
- *Why in-process `runtime.launch`, the same path as `run-sdk.mjs` (T2), not `withSession`:*
  - (a) A scenario is one process from start to end, so the cross-process persistence `withSession` exists for is pure cost.
  - (b) A scenario must start from a known state. Attaching to `state.json`'s session would inherit the user's cookies, tabs and page, and would mutate that session. That is non-repeatable, which is the same reason `run-cli.mjs:23-31` isolates state.
  - (c) The Puppeteer-owned browser is shut down in a `finally`, so no detached Chrome or `sutradhar-cli-*` dir is left behind (§10 anti-pattern).
  - (d) Gates need to observe from before the first navigation, and only an owned launch gives that (D5).
- *Not over MCP or the SDK package:* the CLI package already depends on `@sutradhar/capability-runtime`, and `sutradhar` (the SDK) bundles the CLI, so depending the other way would be circular.

**D2. A step is `{action: <verb>, …params}`. `action` is the discriminator. The verbs are the MCP tool names without `browser.`, and **every parameter name is the MCP input-schema name**:**
- `target`, `value`, `values`, `key`, `modifiers`, `text`, `role`, `name`, `label`, `filePath`, `direction`, `amount`, `state`, `timeoutMs`;
- `fields`, `frameSelector`, `visibleOnly` (the `browser.extract_data` names, `tools.ts:442-1000`).

`expect` and `settle` are **options on an action step**, exactly as on MCP/CLI/SDK (FR2-07 D5, FR2-08 D12). They are not separate steps.
- *Why not keyed steps (`- click: "#x"`):* a keyed form makes ajv use `oneOf` over 21 branches, which gives unreadable validation errors. `if/then` on a discriminator gives precise errors (§2.1.3).
- *Why MCP names:* they are the one vocabulary agents already use. The CLI's positional verbs (`clicktext`, `nav`) have no parameter names.
- **The collision this avoids by exclusion:** MCP `handle_dialog` and `route` also use a parameter called `action`, which is why neither is a step type in v1 (GAP-new-3).

**D3. The step vocabulary is 21 types (§2.2). There is deliberately no fixed-sleep step.** Waiting is `wait_for` (FR2-08) or `wait_for_selector` (FR2-01). A "check once, now" assertion is `wait_for` with `timeoutMs: 0` (FR2-08 D8). That is what makes GAP-037's sleeps unrepresentable in a scenario file rather than merely avoided.

**D4. The assertion mapping:**

| Assertion | Scenario syntax | Maps to | Fails when |
|---|---|---|---|
| `expect` | `expect: {text?, url?, urlChanged?}` on any action step in the FR2-07 24-tool set | the trailing `expect` argument of the runtime method (FR2-07 §2.6), **verbatim** | `failedExpectations(result.verification).length > 0` (contradicted **or** not-run, which is FR2-07's exit-4 rule) |
| `wait_for` | `action: wait_for` + `text/textGone/url/js/timeoutMs` | `runtime.waitFor(sid, {…})` (FR2-08), **verbatim** `WaitForCondition` | `result.success === false` |
| `wait_for_selector` | `action: wait_for_selector` + `target/state/timeoutMs` | `runtime.waitForSelector` | `result.success === false` |
| `extract` | `action: extract_data` + `fields` (FR2-02 `ExtractFieldSpec`, plus a string shorthand) + optional `assert` per field | `runtime.extractData(sid, fields, undefined, frameSelector, {visibleOnly})` | any `assert` matcher fails (§2.3) |

`extract_data` is the **one place** this item defines new assertion syntax: four matchers (`equals`, `count`, `contains`, `notContains`) over FR2-02's `string[]`. Nothing in FR2-07 or FR2-08 asserts on extracted arrays, so this doesn't parallel an existing language.

**D5. Gates are fed by the runtime's `EventBus`, which is the same listener callbacks that fill FR2-12's ring buffers (T17). The ring buffers themselves are not used, and gates are evaluated after every step.**
- *Why not the ring buffers FR2-12 reads:*
  - (a) They cap at 200/50/200 and evict silently (GAP-066). A noisy page could push its early errors out and turn a failing gate into a pass.
  - (b) They die with their tab, so a popup that closes itself takes its errors with it. That's FR2-11 §0.5's argument for a session ring, applied here.
- The bus has neither problem and carries exactly the same payload (T18). This is not a new listener setup. It is an additional subscriber to events the tabs already publish.
- **FR2-12 conventions reused verbatim:**
  - the console-error predicate `logType === 'error'`;
  - the broken-response predicate `status >= 400` on a response;
  - scoping by an observation instant (`observedSince`, the ISO time the subscription started, before `launch`).
- Because the runner launched the browser, the "whole document" coverage FR2-12 has to report honestly with `coversWholeDocument` is **structurally true** for every document the run loads. The one exception, popup events emitted before adoption, is documented in the report (R5).
- *Evaluated after each step:* the failure is attributed to the step during which the threshold was crossed, the runner stops early, and a screenshot shows the page in that state. Evaluation after the final step is the end-of-run check. There is **no implicit audit** at the end: audit is document-scoped and gates are run-scoped, which are two different questions (D12).

**D6. GAP-062 closes here, minimally.**
- `BrowserTab` gains a `requestfailed` listener. It records `NetworkLogEntry {phase:'failed', url, method, resourceType, errorText, timestamp}` into the existing ring and publishes the new event `browser:network:failed` `{sessionId, tabId, url, errorText}`.
- `failOnBrokenRequests` counts responses with status ≥ 400 **and** failed requests, **except `errorText === 'net::ERR_ABORTED'`**. That code is what navigating away, `AbortController` and `window.stop` produce, and counting it would make the gate flaky on every normal navigation.
- FR2-12's audit filter is `phase === 'response'`, so audit output is unchanged. GAP-062 is updated to say the audit still doesn't count them.

**D7. `run` writes to the output directory `--out <dir>`, default `./.sutradhar-runs/<runId>/`. It never writes into `.` itself.** FR2-12 D2.3 declined to write `audit-report.json` into `.` for the same reason: it could overwrite a user file. Outputs:
- `report.json`: the versioned report (§2.5). It is written atomically: `.tmp`, then `rename`.
- `history.jsonl`: this run's history. It is truncated at run start and holds one line per executed step (D8).
- `screenshots/`: failure screenshots and explicit `screenshot` steps.
- `audit/step-NN/`: FR2-12 artifacts, when `audit` steps exist.

Every path in the report is absolute and OS-native (FR2-12 D2.3). **No base64 appears anywhere in the report.**

**D8. The run's history is its own file (`<outDir>/history.jsonl`), in FR2-11's line family, as a new `type:'scenario-step'` line. `run` appends nothing to the directory's `~/.sutradhar-cli/<hash>/history.jsonl`.**
- *Why a separate file:* FR2-11 defines the directory history as the journal of the directory's **persistent session**, recorded only for `withSession` commands (FR2-11 §2.7: "no session was touched → nothing appended"). `run` never touches that session (D1), so appending there would mix an ephemeral session into it.
- The run's complete journal travels with its report, which is what a CI artifact upload wants.
- *Why a new `type` and not a fake `command` line:* a step isn't a CLI command. FR2-11 reserved the `type` discriminator for exactly this. `v` stays 1, and FR2-11's `readHistoryFile` accepts any object with a positive integer `v`.
- Each line's `actions` are the FR2-11 session-ring entries with `seq` greater than the previous step's maximum `seq`. That is exact attribution using `seq`, never timestamps, per FR2-11 D1.
- Logged as a gap: the directory history has no trace of runs (GAP-new-4).

**D9. Exit codes are three classes with no overlap (§2.6).**
- **0:** every step passed and every gate passed.
- **1:** the scenario was evaluated and something it required didn't hold. That covers an action result with `success:false`, a failed expectation, an unsatisfied wait, an extract mismatch, a gate breach, a step-timeout, or a blocking dialog.
- **2:** no verdict could be reached. That covers usage errors, an unreadable, invalid or semantically invalid scenario, an out dir that can't be written, a Chrome launch failure, the browser disconnecting or crashing mid-run, a navigation blocked by the caller's own `--allowlist-domains`, a syntactically invalid selector (FR2-06/FR2-02 errors), an interruption, or an internal error.
- An action failure mid-scenario is **1**, unless a liveness probe shows the browser is gone, in which case it's **2**. A liveness probe is used rather than message regexes alone.

**D10. No `expectFailure`.** The Done-when's deliberately failing scenario is a scenario **the runner must diagnose as failing** (exit 1, with the right step, kind and message). It is not a scenario that asserts an action fails.
- Negative-path intent is already expressible positively with existing primitives: `wait_for_selector state: hidden`, `wait_for textGone`, `extract_data assert {count: 0}` or `notContains`, and `expect.urlChanged: false`.
- An "expected to fail" flag would also blur exit code 1's meaning.
- It is not added, and it isn't logged as a gap, because no concrete need exists.

**D11. The validator:** the committed schema is validated at load by **`ajv`** (8.x), added as a **direct dependency of `@sutradhar/cli`**.
- `ajv@8.20.0` is already in the lockfile via the MCP SDK (T12). No new third-party package enters the install graph, and it gets inlined into `cli-bin.js` like pngjs (T11).
- *Why not the MCP SDK's `AjvJsonSchemaValidator` (FR2-12's test validator):* it only returns an `errorMessage` string. The runner needs `errors[]` (instancePath, keyword, params) to say `steps[2] (click): unknown key "selector" (did you mean "target"?)`, and ajv's `errorsText` for `additionalProperties` doesn't even name the key.
- *Why not a hand-written validator:* "validated at load" against the committed schema then wouldn't literally be true.
- Recorded under §4.9.

**D12. An `audit` step exists but is report-only.** It calls `runtime.audit` and `writeAuditArtifacts` into `<outDir>/audit/step-NN/`, and writes that step's `audit-report.json` inside the run dir.
- It has no pass/fail semantics except the runtime throwing. Gates stay event-stream-based (D5).
- It composes FR2-12 without inventing a second a11y gate language. An audit-threshold gate is logged as GAP-new-5.

**D13. The `yaml` package** (ISC, zero dependencies, pinned `^2.8.0`, whatever 2.x pnpm resolves) is added to `@sutradhar/cli` `dependencies` and gets inlined into `packages/sutradhar/dist/cli-bin.js` by esbuild.
- This is how "add to the bundled `sutradhar` package" is met.
- `packages/sutradhar/package.json` `dependencies` stays `puppeteer-core` only (T11 invariant). The license is recorded in the changelog fragment.
- Parse options: `parseDocument(text, { prettyErrors: true, uniqueKeys: true, strict: true, maxAliasCount: 100 })`. That's YAML 1.2 core schema, so `no` stays a string. It rejects duplicate keys, bounds alias expansion (the billion-laughs guard) and rejects multi-document files.

**D14. One file per invocation.** Directory or glob runs are **deferred** (GAP-new-1).
- A multi-file run needs an aggregate report schema.
- It needs exit-code aggregation (max over runs? first infra error?).
- It needs a browser-reuse vs. isolation decision per file.

None of that is needed by the Done-when, and CI can loop in the shell today.

**D15. The extract field map (closes the *design* half of GAP-004).** This is the one syntax that later CLI and SDK surfaces reuse:
- **Scenario and SDK form:** `fields: Record<fieldName, string | ExtractFieldSpec>`. A string is shorthand for `{selector}`, and the object is FR2-02's `ExtractFieldSpec` verbatim. It is normalized by one pure function, `normalizeExtractFieldMap`, in `@sutradhar/capability-runtime`.
- **Future SDK:** `page.extract(fields, {frameSelector?, visibleOnly?})` with the same `fields` type. It returns `Record<string, string[]>`.
- **Future CLI grammar**, fixed now: `sutradhar extract <name>=<selector> [<name>=<selector>…] [--attr <name>=<attribute>]… [--visible-only] [--frame <sel>] [--json]`.
  - Each pair is split on the **first** `=`. The field name can't contain `=`, so `email=input[type="email"]` parses correctly.
  - `--attr` sets `ExtractFieldSpec.attribute` for that name.
  - An unknown name in `--attr` is an error.
  - There's no inline mini-language (such as `sel@attr` or `sel::attr`), because `::` collides with CSS pseudo-elements.

Implementing the CLI verb and `Page.extract` stays out of scope. GAP-004 is re-worded to "syntax designed in FR2-13 D15; implementation TODO".

**D16. Values and secrets.**
- The report and history never contain `type`/`type_by_label` values. They show `<N chars>` (FR2-11 `redactCliArgs` rule).
- URLs pass through `redactHistoryUrl`/`redactUrlsInText`, and strings are capped at 200 (text at 300), per FR2-11 §2.2.
- Extracted values appear in the report **only for fields whose assertion failed** (capped: 20 values, 200 characters each). A passing field records only its count.
- The scenario file itself is the author's own and is not rewritten.

**D17. Stop at the first failure.** Remaining steps are `skipped`. Gates are still reported with final counts, and the failure stays the first one detected. There's no `continueOnFailure` in v1.

**D18. Flag precedence:** CLI flag > scenario file > default. The defaults are headless `true`, viewport **1280×800** (the `run-sdk.mjs:22` convention) and `stepTimeoutMs` 120000.

---

## 1. Files to touch

| # | File | Change | Prior items touching it |
|---|---|---|---|
| 1 | `packages/cli/src/scenario/scenario-types.ts` (**new**) | Scenario and report types, `SCENARIO_STEP_ACTIONS`, constants, `SCENARIO_STEP_EXAMPLES`, `SCENARIO_EXAMPLE`, `SCENARIO_RUN_REPORT_EXAMPLE`, the cross-spec key maps (§2.1.4) | — |
| 2 | `packages/cli/src/scenario/scenario-schema.ts` (**new**) | `SCENARIO_SCHEMA`, a TS constant that must deep-equal the committed file (test S2) | — |
| 3 | `packages/cli/schemas/scenario.schema.json` (**new**) | §2.1.1, verbatim | — |
| 4 | `packages/cli/schemas/scenario-run-report.schema.json` (**new**) | §2.5.2, verbatim | — |
| 5 | `packages/cli/src/scenario/load-scenario.ts` (**new**) | read, size guard, BOM, parse (YAML/JSON), ajv validation, error formatting, semantic checks, URL/path resolution. Pure, with injectable fs | — |
| 6 | `packages/cli/src/scenario/gates.ts` (**new**) | `GateCollector`, the predicates, `evaluateGates` | — |
| 7 | `packages/cli/src/scenario/classify.ts` (**new**) | `classifyThrown`, `classifyResult`, `exitCodeForKind`, `isBrowserGoneError` | — |
| 8 | `packages/cli/src/scenario/run-scenario.ts` (**new**) | `runScenario(loaded, opts, port)`: the executor. `ScenarioRuntimePort`, the step → runtime mapping, bounded steps, screenshots, history lines, SIGINT | — |
| 9 | `packages/cli/src/scenario/scenario-report.ts` (**new**) | `buildReport`, `writeReportAtomic`, `formatRunHuman`, `summarizeStep`, `prepareRunOutDir`, `newRunId` | — |
| 10 | `packages/cli/src/history-file.ts` (FR2-11's) | **Additive:** `ScenarioStepHistoryLineV1`, `CliHistoryLine` union, `buildScenarioStepHistoryLine` (with the same 64 KiB guard, factored out as `applyLineGuard`), `appendHistoryLine` widened to `CliHistoryLine`, `formatHistoryHuman` prints a one-line placeholder for non-`command` lines | FR2-11 |
| 11 | `packages/cli/src/parse-args.ts` | `--out`, `--base-url` (valued), `outFlag`, `outFlagGivenButInvalid`, `baseUrlFlag`, `baseUrlFlagGivenButInvalid`, `presentFlags` | FR2-01, 03, 04, 07, 08, 12 |
| 12 | `packages/cli/src/cli.ts` | `main()`'s **first statement** dispatches `run` to `cmdRun`. Non-`run` verbs reject `--out`/`--base-url` with exit 1. Help text | FR2-01, 03…12 |
| 13 | `packages/cli/src/index.ts` | Export the scenario types and report types | FR2-03, FR2-11 |
| 14 | `packages/cli/package.json` | `dependencies`: `yaml`, `ajv`. `devDependencies`: `@modelcontextprotocol/sdk: "1.30.0"` (tests only: formats-aware report validation, the FR2-12 technique) | — |
| 15 | `packages/capability-runtime/src/extract/field-map.ts` (**new**) + `src/index.ts` export | `normalizeExtractFieldMap` (D15) | FR2-02 (same dir) |
| 16 | `packages/browser/src/session/browser-tab.ts` | `requestfailed` listener; `NetworkLogEntry.phase` gains `'failed'`, plus `errorText?` (D6) | FR2-04, 11, 12 |
| 17 | `packages/contracts/src/events/domain-events.ts`, `event-map.ts` | `BrowserNetworkFailedEventPayload`, `'browser:network:failed'` | — |
| 18 | `packages/browser/src/session/action-history.ts` (FR2-11's) | Export `sanitizeVerification(v)`, extracted from `sanitizeHistoryEntry`'s inline verification branch. **Behavior-preserving**, with FR2-11's H6 as the gate | FR2-11 |
| 19 | `packages/mcp-server/src/tools.ts` | `browser.get_network_log` description only: `…request/response activity, and failed requests (phase "failed", with errorText)…`. **If a test pins the old text, the description change is dropped** (no test is edited) | many |
| 20 | Tests (**new**): `packages/cli/tests/unit/{load-scenario,scenario-schema,gates,classify,run-scenario,scenario-report}.spec.ts`, `packages/capability-runtime/tests/unit/field-map.spec.ts` | §4 | — |
| 21 | Tests (**append only**): `cli/tests/unit/parse-args.spec.ts`, `cli/tests/unit/history-file.spec.ts`, `browser/tests/unit/browser-tab-observability.spec.ts`, `browser/tests/unit/action-history.spec.ts` | §4 | prior |
| 22 | `tools/scenario-suite/scenarios/uc-05-saucedemo-checkout.yaml`, `uc-06-modal-and-dynamic-content.yaml`, `uc-10-prompt-injection.yaml`, `uc-14-aria-menu.yaml`, `uc-14-aria-menu.json`, `uc-12-cart-outcome.yaml` (alternate), `failing/uc-14-wrong-expectation.yaml` (**new**) | §3 | — |
| 23 | `tools/scenario-suite/fixtures/fr2-13/*.yaml` (negative cases, §3.7) + `tools/scenario-suite/fixtures/fr2-13-server.mjs` (**new**) | §3.7 | — |
| 24 | `tools/scenario-suite/verify-fr2-13-scenario-runner.mjs` (**new**) | §5 | — |
| 25 | Docs: `packages/cli/README.md` (a "Scenario files" section, the `run` row, flags), `AGENT_SETUP.md` + `packages/sutradhar/AGENT_SETUP.md` (a short "Scenario files for CI" paragraph pointing at the schema), `packages/sutradhar/README.md` (one CLI row) | Match behavior | FR2-01…12 |
| 26 | `.gitignore` | `.sutradhar-runs/` | — |
| 27 | `.ai/loop/field-report-2/evidence/FR2-13/changelog-fragment.md` (**new**) | §7.4 | — |

**Not touched:**
- `tools/scenario-suite/run-{sdk,cli,mcp}.mjs`, `ci-gate.mjs`, `report.mjs`, `scenarios.mjs`. The per-surface harness stays what it is: a measurement of three surfaces. GAP-037 is updated, not closed (§7.3 R11).
- `runtime.ts` (the runner uses only the public API).
- The engine, the verifier, and FR2-12's `site-audit.ts`/`audit-report.ts` (only called).
- `EXPECTED_BROWSER_TOOLS` (no tool added).
- `packages/sutradhar/package.json` / `build-bundle.mjs` (inlining is automatic).

**Why the new code lives in `packages/cli/src/scenario/`:** YAML, files, exit codes and report writing are CLI concerns. The executor takes an injected `ScenarioRuntimePort`, so a later SDK `runScenario()` can reuse it without moving anything (GAP-new-6).

---

## 2. API diff

### 2.1 The scenario file

#### 2.1.1 `packages/cli/schemas/scenario.schema.json` (committed verbatim)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "urn:sutradhar:scenario:1",
  "title": "Sutradhar scenario file",
  "description": "Input of `sutradhar run <file.yaml|file.yml|file.json>`. YAML is parsed as YAML 1.2 (core schema) into the same data model as JSON. Steps run in order in a fresh, isolated browser; the first failing step stops the run. Step parameter names are the MCP browser.* input names; expect is FR2-07's ActionExpectation, wait_for is FR2-08's WaitForCondition, extract_data fields are FR2-02's ExtractFieldSpec. Any shape change bumps schemaVersion.",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "name", "steps"],
  "properties": {
    "schemaVersion": { "const": 1 },
    "name": { "type": "string", "minLength": 1, "maxLength": 200 },
    "description": { "type": "string", "maxLength": 4000 },
    "baseUrl": { "type": "string", "pattern": "^https?://[^/?#\\s]+(/[^?#\\s]*)?$", "description": "Base for step urls that start with a single '/'. Overridden by --base-url." },
    "browser": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "headless": { "type": "boolean", "description": "Default true. --headed overrides." },
        "viewport": {
          "type": "object", "additionalProperties": false, "required": ["width", "height"],
          "properties": {
            "width": { "type": "integer", "minimum": 1, "maximum": 10000 },
            "height": { "type": "integer", "minimum": 1, "maximum": 10000 }
          }
        }
      }
    },
    "stepTimeoutMs": { "type": "integer", "minimum": 1000, "maximum": 600000, "description": "Hard bound per step (default 120000). Exceeding it fails the run with kind step-timeout." },
    "gates": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "maxConsoleErrors": { "type": "integer", "minimum": 0, "description": "Fail when more console messages of type error than this were observed during the run (all tabs). Chrome's own 'Failed to load resource' errors count." },
        "maxPageErrors": { "type": "integer", "minimum": 0, "description": "Fail when more uncaught page errors than this were observed (all tabs)." },
        "failOnBrokenRequests": { "type": "boolean", "description": "Fail on any HTTP response >= 400 or any failed request (DNS, refused, blocked) except net::ERR_ABORTED cancellations." },
        "ignoreUrls": { "type": "array", "maxItems": 50, "items": { "$ref": "#/definitions/nonEmptyString" }, "description": "Substrings; a broken request whose URL contains any of them is counted as ignored, not broken." }
      }
    },
    "steps": { "type": "array", "minItems": 1, "maxItems": 500, "items": { "$ref": "#/definitions/step" } }
  },
  "definitions": {
    "nonEmptyString": { "type": "string", "minLength": 1, "maxLength": 10000 },
    "stepId": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$" },
    "target": { "type": "string", "minLength": 1, "maxLength": 2000, "description": "CSS selector or snapshot node id (same as MCP target)." },
    "url": { "type": "string", "minLength": 1, "maxLength": 8000, "pattern": "^(?:[A-Za-z][A-Za-z0-9+.-]*:|\\.{1,2}/|/(?!/))", "description": "Absolute URL (scheme:), a path relative to this scenario file (./ or ../, loaded as file://), or a path relative to baseUrl (/path)." },
    "expect": {
      "type": "object", "additionalProperties": false, "minProperties": 1,
      "description": "FR2-07 ActionExpectation, checked once right after the action (after settle).",
      "properties": {
        "text": { "type": "string", "minLength": 1 },
        "url": { "type": "string", "minLength": 1 },
        "urlChanged": { "type": "boolean" }
      }
    },
    "settle": {
      "type": ["boolean", "object"], "additionalProperties": false,
      "description": "FR2-08 settle: true, or a SettleSpec.",
      "properties": {
        "mutationQuietMs": { "type": "integer", "minimum": 0, "maximum": 60000 },
        "networkIdleMs": { "type": "integer", "minimum": 0, "maximum": 60000 },
        "timeoutMs": { "type": "integer", "minimum": 0, "maximum": 60000 }
      }
    },
    "modifiers": { "type": "array", "uniqueItems": true, "maxItems": 4, "items": { "enum": ["Control", "Shift", "Alt", "Meta"] } },
    "waitTimeoutMs": { "type": "integer", "minimum": 0, "maximum": 300000 },
    "fieldName": { "type": "string", "pattern": "^(?!__)[A-Za-z_][A-Za-z0-9_-]{0,63}$" },
    "extractField": {
      "type": ["string", "object"], "minLength": 1, "additionalProperties": false, "required": ["selector"],
      "description": "A selector string, or FR2-02's ExtractFieldSpec.",
      "properties": {
        "selector": { "$ref": "#/definitions/target" },
        "attribute": { "type": "string", "maxLength": 200 },
        "visibleOnly": { "type": "boolean" }
      }
    },
    "extractAssertion": {
      "type": "object", "additionalProperties": false, "minProperties": 1,
      "properties": {
        "equals": { "type": "array", "maxItems": 1000, "items": { "type": "string" } },
        "count": { "type": "integer", "minimum": 0 },
        "contains": { "$ref": "#/definitions/nonEmptyString" },
        "notContains": { "$ref": "#/definitions/nonEmptyString" }
      }
    },
    "step": {
      "type": "object", "required": ["action"],
      "properties": {
        "action": { "enum": ["navigate", "go_back", "go_forward", "reload", "click", "type", "press_key", "focus", "hover", "scroll", "select_option", "select_options", "click_by_text", "click_by_role", "type_by_label", "upload_file", "wait_for_selector", "wait_for", "extract_data", "screenshot", "audit"] }
      },
      "allOf": [
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "navigate" } } }, "then": { "$ref": "#/definitions/navigate" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "go_back" } } }, "then": { "$ref": "#/definitions/history_nav" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "go_forward" } } }, "then": { "$ref": "#/definitions/history_nav" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "reload" } } }, "then": { "$ref": "#/definitions/history_nav" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "click" } } }, "then": { "$ref": "#/definitions/click" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "type" } } }, "then": { "$ref": "#/definitions/type" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "press_key" } } }, "then": { "$ref": "#/definitions/press_key" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "focus" } } }, "then": { "$ref": "#/definitions/target_only" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "hover" } } }, "then": { "$ref": "#/definitions/target_only" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "scroll" } } }, "then": { "$ref": "#/definitions/scroll" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "select_option" } } }, "then": { "$ref": "#/definitions/select_option" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "select_options" } } }, "then": { "$ref": "#/definitions/select_options" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "click_by_text" } } }, "then": { "$ref": "#/definitions/click_by_text" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "click_by_role" } } }, "then": { "$ref": "#/definitions/click_by_role" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "type_by_label" } } }, "then": { "$ref": "#/definitions/type_by_label" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "upload_file" } } }, "then": { "$ref": "#/definitions/upload_file" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "wait_for_selector" } } }, "then": { "$ref": "#/definitions/wait_for_selector" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "wait_for" } } }, "then": { "$ref": "#/definitions/wait_for" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "extract_data" } } }, "then": { "$ref": "#/definitions/extract_data" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "screenshot" } } }, "then": { "$ref": "#/definitions/screenshot" } },
        { "if": { "type": "object", "required": ["action"], "properties": { "action": { "const": "audit" } } }, "then": { "$ref": "#/definitions/audit" } }
      ]
    },
    "navigate": { "type": "object", "additionalProperties": false, "required": ["action", "url"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "navigate" }, "url": { "$ref": "#/definitions/url" }, "expect": { "$ref": "#/definitions/expect" }, "settle": { "$ref": "#/definitions/settle" } } },
    "history_nav": { "type": "object", "additionalProperties": false, "required": ["action"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "enum": ["go_back", "go_forward", "reload"] }, "expect": { "$ref": "#/definitions/expect" }, "settle": { "$ref": "#/definitions/settle" } } },
    "click": { "type": "object", "additionalProperties": false, "required": ["action", "target"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "click" }, "target": { "$ref": "#/definitions/target" }, "modifiers": { "$ref": "#/definitions/modifiers" }, "expect": { "$ref": "#/definitions/expect" }, "settle": { "$ref": "#/definitions/settle" } } },
    "type": { "type": "object", "additionalProperties": false, "required": ["action", "target", "value"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "type" }, "target": { "$ref": "#/definitions/target" }, "value": { "type": "string", "maxLength": 10000 }, "expect": { "$ref": "#/definitions/expect" }, "settle": { "$ref": "#/definitions/settle" } } },
    "press_key": { "type": "object", "additionalProperties": false, "required": ["action", "key"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "press_key" }, "key": { "type": "string", "minLength": 1, "maxLength": 50 }, "modifiers": { "$ref": "#/definitions/modifiers" }, "expect": { "$ref": "#/definitions/expect" }, "settle": { "$ref": "#/definitions/settle" } } },
    "target_only": { "type": "object", "additionalProperties": false, "required": ["action", "target"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "enum": ["focus", "hover"] }, "target": { "$ref": "#/definitions/target" }, "expect": { "$ref": "#/definitions/expect" }, "settle": { "$ref": "#/definitions/settle" } } },
    "scroll": { "type": "object", "additionalProperties": false, "required": ["action"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "scroll" }, "direction": { "enum": ["up", "down", "top", "bottom"] }, "amount": { "type": "integer", "minimum": 1, "maximum": 100000 }, "target": { "$ref": "#/definitions/target" }, "expect": { "$ref": "#/definitions/expect" }, "settle": { "$ref": "#/definitions/settle" } } },
    "select_option": { "type": "object", "additionalProperties": false, "required": ["action", "target", "value"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "select_option" }, "target": { "$ref": "#/definitions/target" }, "value": { "type": "string", "maxLength": 2000 }, "expect": { "$ref": "#/definitions/expect" }, "settle": { "$ref": "#/definitions/settle" } } },
    "select_options": { "type": "object", "additionalProperties": false, "required": ["action", "target", "values"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "select_options" }, "target": { "$ref": "#/definitions/target" }, "values": { "type": "array", "minItems": 1, "maxItems": 500, "items": { "type": "string", "maxLength": 2000 } }, "expect": { "$ref": "#/definitions/expect" }, "settle": { "$ref": "#/definitions/settle" } } },
    "click_by_text": { "type": "object", "additionalProperties": false, "required": ["action", "text"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "click_by_text" }, "text": { "$ref": "#/definitions/nonEmptyString" }, "expect": { "$ref": "#/definitions/expect" }, "settle": { "$ref": "#/definitions/settle" } } },
    "click_by_role": { "type": "object", "additionalProperties": false, "required": ["action", "role"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "click_by_role" }, "role": { "type": "string", "minLength": 1, "maxLength": 100 }, "name": { "$ref": "#/definitions/nonEmptyString" }, "expect": { "$ref": "#/definitions/expect" }, "settle": { "$ref": "#/definitions/settle" } } },
    "type_by_label": { "type": "object", "additionalProperties": false, "required": ["action", "label", "value"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "type_by_label" }, "label": { "$ref": "#/definitions/nonEmptyString" }, "value": { "type": "string", "maxLength": 10000 }, "expect": { "$ref": "#/definitions/expect" }, "settle": { "$ref": "#/definitions/settle" } } },
    "upload_file": { "type": "object", "additionalProperties": false, "required": ["action", "target", "filePath"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "upload_file" }, "target": { "$ref": "#/definitions/target" }, "filePath": { "type": "string", "minLength": 1, "maxLength": 4000, "description": "Absolute, or relative to this scenario file." }, "expect": { "$ref": "#/definitions/expect" }, "settle": { "$ref": "#/definitions/settle" } } },
    "wait_for_selector": { "type": "object", "additionalProperties": false, "required": ["action", "target"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "wait_for_selector" }, "target": { "$ref": "#/definitions/target" }, "state": { "enum": ["visible", "attached", "hidden"] }, "timeoutMs": { "$ref": "#/definitions/waitTimeoutMs" }, "expect": { "$ref": "#/definitions/expect" } } },
    "wait_for": { "type": "object", "additionalProperties": false, "required": ["action"],
      "anyOf": [{ "required": ["text"] }, { "required": ["textGone"] }, { "required": ["url"] }, { "required": ["js"] }],
      "description": "FR2-08 WaitForCondition. Given keys are ANDed. timeoutMs 0 = check once.",
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "wait_for" }, "text": { "$ref": "#/definitions/nonEmptyString" }, "textGone": { "$ref": "#/definitions/nonEmptyString" }, "url": { "$ref": "#/definitions/nonEmptyString" }, "js": { "$ref": "#/definitions/nonEmptyString" }, "timeoutMs": { "$ref": "#/definitions/waitTimeoutMs" } } },
    "extract_data": { "type": "object", "additionalProperties": false, "required": ["action", "fields"],
      "properties": {
        "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "extract_data" },
        "fields": { "type": "object", "minProperties": 1, "maxProperties": 50, "propertyNames": { "$ref": "#/definitions/fieldName" }, "additionalProperties": { "$ref": "#/definitions/extractField" } },
        "frameSelector": { "$ref": "#/definitions/target" },
        "visibleOnly": { "type": "boolean" },
        "assert": { "type": "object", "minProperties": 1, "propertyNames": { "$ref": "#/definitions/fieldName" }, "additionalProperties": { "$ref": "#/definitions/extractAssertion" } }
      } },
    "screenshot": { "type": "object", "additionalProperties": false, "required": ["action"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "screenshot" }, "name": { "type": "string", "pattern": "^[A-Za-z0-9_-]{1,40}$" }, "fullPage": { "type": "boolean" } } },
    "audit": { "type": "object", "additionalProperties": false, "required": ["action"],
      "properties": { "id": { "$ref": "#/definitions/stepId" }, "action": { "const": "audit" }, "url": { "$ref": "#/definitions/url" } } }
  }
}
```

Ajv is compiled once with `new Ajv({ allErrors: true, strict: true, allowUnionTypes: true })`. Test S1 proves the schema compiles in strict mode: every `if` carries `type: object`, and every union is explicit.

#### 2.1.2 TypeScript (`scenario-types.ts`)

```ts
import type { ActionExpectation } from '@sutradhar/capability-runtime';          // FR2-07
import type { WaitForCondition } from '@sutradhar/capability-runtime';           // FR2-08
import type { ExtractFieldSpec } from '@sutradhar/capability-runtime';           // FR2-02
import type { SettleSpec } from '@sutradhar/browser';                            // FR2-08 page-settle

export const SCENARIO_SCHEMA_VERSION = 1 as const;
export const SCENARIO_MAX_FILE_BYTES = 1024 * 1024;
export const DEFAULT_STEP_TIMEOUT_MS = 120_000;
export const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;
export const FAILURE_SCREENSHOT_TIMEOUT_MS = 5_000;
export const SHUTDOWN_TIMEOUT_MS = 10_000;
export const REPORT_GATE_ENTRY_CAP = 50;
export const REPORT_EXTRACT_VALUE_CAP = 20;
export const SCENARIO_STEP_ACTIONS = ['navigate','go_back','go_forward','reload','click','type','press_key','focus',
  'hover','scroll','select_option','select_options','click_by_text','click_by_role','type_by_label','upload_file',
  'wait_for_selector','wait_for','extract_data','screenshot','audit'] as const;
export type ScenarioStepAction = typeof SCENARIO_STEP_ACTIONS[number];

interface StepBase<A extends ScenarioStepAction> { id?: string; action: A }
interface ActionOpts { expect?: ActionExpectation; settle?: boolean | SettleSpec }
export type NavigateStep       = StepBase<'navigate'> & ActionOpts & { url: string };
export type HistoryNavStep     = StepBase<'go_back' | 'go_forward' | 'reload'> & ActionOpts;
export type ClickStep          = StepBase<'click'> & ActionOpts & { target: string; modifiers?: Modifier[] };
export type TypeStep           = StepBase<'type'> & ActionOpts & { target: string; value: string };
export type PressKeyStep       = StepBase<'press_key'> & ActionOpts & { key: string; modifiers?: Modifier[] };
export type TargetOnlyStep     = StepBase<'focus' | 'hover'> & ActionOpts & { target: string };
export type ScrollStep         = StepBase<'scroll'> & ActionOpts & { direction?: 'up'|'down'|'top'|'bottom'; amount?: number; target?: string };
export type SelectOptionStep   = StepBase<'select_option'> & ActionOpts & { target: string; value: string };
export type SelectOptionsStep  = StepBase<'select_options'> & ActionOpts & { target: string; values: string[] };
export type ClickByTextStep    = StepBase<'click_by_text'> & ActionOpts & { text: string };
export type ClickByRoleStep    = StepBase<'click_by_role'> & ActionOpts & { role: string; name?: string };
export type TypeByLabelStep    = StepBase<'type_by_label'> & ActionOpts & { label: string; value: string };
export type UploadFileStep     = StepBase<'upload_file'> & ActionOpts & { target: string; filePath: string };
export type WaitForSelectorStep = StepBase<'wait_for_selector'> & { target: string; state?: 'visible'|'attached'|'hidden'; timeoutMs?: number; expect?: ActionExpectation };
export type WaitForStep        = StepBase<'wait_for'> & WaitForCondition;                          // FR2-08 verbatim
export interface ExtractAssertion { equals?: string[]; count?: number; contains?: string; notContains?: string }
export type ExtractFieldInput  = string | ExtractFieldSpec;                                        // D15
export type ExtractDataStep    = StepBase<'extract_data'> & { fields: Record<string, ExtractFieldInput>; frameSelector?: string; visibleOnly?: boolean; assert?: Record<string, ExtractAssertion> };
export type ScreenshotStep     = StepBase<'screenshot'> & { name?: string; fullPage?: boolean };
export type AuditStep          = StepBase<'audit'> & { url?: string };
export type ScenarioStep = NavigateStep | HistoryNavStep | ClickStep | TypeStep | PressKeyStep | TargetOnlyStep | ScrollStep
  | SelectOptionStep | SelectOptionsStep | ClickByTextStep | ClickByRoleStep | TypeByLabelStep | UploadFileStep
  | WaitForSelectorStep | WaitForStep | ExtractDataStep | ScreenshotStep | AuditStep;
export interface ScenarioGates { maxConsoleErrors?: number; maxPageErrors?: number; failOnBrokenRequests?: boolean; ignoreUrls?: string[] }
export interface ScenarioFileV1 {
  schemaVersion: 1; name: string; description?: string; baseUrl?: string;
  browser?: { headless?: boolean; viewport?: { width: number; height: number } };
  stepTimeoutMs?: number; gates?: ScenarioGates; steps: ScenarioStep[];
}
```

#### 2.1.3 Loading (`load-scenario.ts`)

```ts
export interface LoadedScenario {
  file: ScenarioFileV1;                     // as validated
  path: string;                             // absolute
  format: 'yaml' | 'json';
  sha256: string;                           // of the raw bytes
  resolvedUrls: ReadonlyMap<number, string>;       // step index (0-based) → absolute URL, for navigate/audit
  resolvedFilePaths: ReadonlyMap<number, string>;  // step index → absolute path, for upload_file
  resolvedFields: ReadonlyMap<number, Record<string, ExtractFieldSpec>>; // normalizeExtractFieldMap output
}
export class ScenarioLoadError extends Error { constructor(public readonly kind: 'usage' | 'scenario-invalid', message: string) }
export async function loadScenario(filePath: string, opts: { baseUrlOverride?: string }, deps?: { fs?: FsLike }): Promise<LoadedScenario>;
export function formatAjvErrors(errors: readonly ErrorObject[], data: unknown): string[];   // pure; exported for tests
```

**The algorithm.** Each stage's failure message is exact.

1. `abs = path.resolve(filePath)`. Choose the format from the extension: `.yaml` and `.yml` give yaml, `.json` gives json, anything else is `usage`: `unsupported scenario file extension "<ext>" — use .yaml, .yml or .json`.
2. `stat`:
   - ENOENT → `usage`: `scenario file not found: <abs>`.
   - Not a file → `usage`: `not a file: <abs>`.
   - Larger than 1 MiB → `scenario-invalid`: `scenario file is <n> bytes; the maximum is 1048576`.
3. Read the bytes, compute `sha256` over them, decode UTF-8 and strip a leading U+FEFF.
4. Parse.
   - **JSON:** `JSON.parse`. On failure → `scenario-invalid`: `<abs> is not valid JSON: <message>`.
   - **YAML:** `parseAllDocuments(text, D13 options)`.
     - More than one document → `<abs> must contain exactly one YAML document (found <n>)`.
     - `doc.errors.length` > 0 → `<abs> is not valid YAML: <first error message>`. The `yaml` package's pretty message includes `at line L, column C`.
     - Otherwise `doc.toJS({ maxAliasCount: 100 })`.
5. Validate against the schema (`SCENARIO_SCHEMA`, compiled once). If invalid → `scenario-invalid`, message `Invalid scenario <abs>:\n` followed by `formatAjvErrors(...)` lines joined with `\n  - `. **`formatAjvErrors` rules:**
   - Drop errors with `keyword === 'if'`, and drop `anyOf` errors when a more specific error exists at the same `instancePath`.
   - Location: `/steps/2` becomes `steps[2] (<action>)` when `data.steps[2].action` is a string. The root is `(top level)`.
   - `additionalProperties` → `unknown key "<params.additionalProperty>"`, plus the hint ` (did you mean "<x>"?)` from the alias map `{selector:'target', ref:'target', timeout:'timeoutMs', expectText:'expect', waitFor:'wait_for'}`.
   - `required` → `missing required key "<params.missingProperty>"`.
   - `enum` at `/steps/N/action` → `unknown action "<value>" — allowed: <SCENARIO_STEP_ACTIONS joined ", ">`.
   - `const` at `/schemaVersion` → `schemaVersion must be 1`.
   - `pattern` on a `url` → `url "<v>" must be absolute (scheme:), relative to the scenario file (./ or ../), or relative to baseUrl (/path)`.
   - The `anyOf` on `wait_for` → `wait_for: give at least one of text, textGone, url, js` (FR2-08 §2.1.1 wording).
   - Anything else → `<location>: <ajv message>`.
   - Deduplicate, sort by location, and show at most 10 lines, then ` (+N more)`.
6. **Semantic checks** that the schema can't express. Each check fails as `scenario-invalid`, and all of them are collected (not just the first):
   - Duplicate `id` → `steps[3] (click): duplicate id "login" (also used by steps[1])`.
   - `extract_data` `assert` key not in `fields` → `steps[5] (extract_data): assert.<k> does not name a field of this step (fields: <names>)`.
   - `wait_for` with `text === textGone` → `steps[2] (wait_for): text and textGone are both "<x>" — that can never be satisfied` (FR2-08 wording).
   - A duplicate `screenshot` `name` → `steps[7] (screenshot): duplicate screenshot name "<n>"`.
   - URL resolution, for `navigate.url` and `audit.url`:
     - a URL with a scheme is kept as is;
     - `./` or `../` → `pathToFileURL(path.resolve(dirname(abs), url)).href`, and the file must exist, else `steps[0] (navigate): file not found: <path>`;
     - `/x` → `new URL(url, opts.baseUrlOverride ?? file.baseUrl)`, and with no base → `steps[0] (navigate): url "/x" is relative to baseUrl, but no baseUrl is set (add baseUrl to the scenario or pass --base-url)`;
     - `new URL` throws → `steps[i] (<a>): invalid URL "<v>"`.
   - `upload_file.filePath`: resolved against the scenario dir when relative, and must exist and be a file, else `steps[i] (upload_file): file not found: <abs>`.
   - `extract_data.fields` → `normalizeExtractFieldMap` (it can't fail after the schema check, but its `TypeError` is still mapped here).
7. `--base-url` given but not matching the `baseUrl` pattern → `usage`: `--base-url must be an http(s) URL (e.g. --base-url http://127.0.0.1:8080)`.

#### 2.1.4 Cross-spec drift guards (`scenario-types.ts`, tsc-enforced)

```ts
/** tsc fails if FR2-07 renames/adds an ActionExpectation key; S5 checks the schema matches. */
export const EXPECT_KEYS: { readonly [K in keyof Required<ActionExpectation>]: true } = { text: true, url: true, urlChanged: true };
/** FR2-08 WaitForCondition keys (the wait_for step minus id/action). */
export const WAIT_FOR_KEYS: { readonly [K in keyof Required<WaitForCondition>]: true } = { text: true, textGone: true, url: true, js: true, timeoutMs: true };
/** FR2-02 ExtractFieldSpec keys (the object form of an extract field). */
export const EXTRACT_FIELD_KEYS: { readonly [K in keyof Required<ExtractFieldSpec>]: true } = { selector: true, attribute: true, visibleOnly: true };
/** One fully populated example per action — tsc enforces that every action has one and that each lists every key. */
export const SCENARIO_STEP_EXAMPLES: { readonly [A in ScenarioStepAction]: DeepRequired<Extract<ScenarioStep, { action: A }>> };
export const SCENARIO_EXAMPLE: DeepRequired<ScenarioFileV1>;      // steps = Object.values(SCENARIO_STEP_EXAMPLES)
```

`DeepRequired` is imported from FR2-12's module if it's exported there. Otherwise define it locally with the same definition FR2-12 used, and record that.

### 2.2 The step vocabulary and its runtime mapping

The **positional forms** below are the post-FR2-07/FR2-08 signatures, where `expect` is FR2-07's trailing parameter and `settle` is FR2-08 D13's new last parameter.
- The Executor re-anchors on the landed signatures. `tsc` is the first guard, and test R1 is the second (it pins each call's exact argument array on a fake port).
- `tabId` is always `undefined`: every step acts on the active tab.
- Trailing `undefined`s are trimmed, by the same `trimTrailingUndefined` rule FR2-08 introduced.

| action | Runtime call | Summary (for report and history; §2.4 redaction) |
|---|---|---|
| navigate | `navigate(sid, resolvedUrl, undefined, expect, settle)` | `navigate <redactHistoryUrl(url)>` |
| go_back / go_forward / reload | `goBack(sid, undefined, expect, settle)` (and so on) | `go_back` |
| click | `click(sid, target, undefined, modifiers, undefined, settle, expect)` (FR2-07: `click(…, settle?, expect?)`) | `click <target>` |
| type | `type(sid, target, value, undefined, settle, expect)` | `type <target> <N chars>` |
| press_key | `pressKey(sid, key, undefined, modifiers, expect, settle)` | `press_key Control+Shift+a` |
| focus / hover | `focus(sid, target, undefined, expect, settle)`; `hover(sid, target, undefined, undefined, expect, settle)` | `focus <target>` |
| scroll | `scroll(sid, direction ?? 'down', amount ?? 500, undefined, target, settle, expect)` | `scroll down 500[ <target>]` |
| select_option | `selectOption(sid, target, value, undefined, expect, settle)` | `select_option <target> <value>` |
| select_options | `selectOptions(sid, target, values, undefined, expect, settle)` | `select_options <target> <n> values` |
| click_by_text | `clickByText(sid, text, undefined, expect, settle)` | `click_by_text "<text>"` |
| click_by_role | `clickByRole(sid, role, name, undefined, expect, settle)` | `click_by_role <role> "<name>"` |
| type_by_label | `typeByLabel(sid, label, value, undefined, expect, settle)` | `type_by_label "<label>" <N chars>` |
| upload_file | `uploadFile(sid, target, resolvedFilePath, undefined, expect, settle)` | `upload_file <target> <basename>` |
| wait_for_selector | `waitForSelector(sid, target, timeoutMs, undefined, state, expect)` | `wait_for_selector <target> (<state ?? 'visible'>, <timeoutMs ?? 10000>ms)` |
| wait_for | `waitFor(sid, {text, textGone, url, js, timeoutMs} with undefined keys omitted)` | `wait_for ` + FR2-08 `describePageCondition(c)` |
| extract_data | `extractData(sid, resolvedFields, undefined, frameSelector, {visibleOnly})`. `options` is passed only when `visibleOnly` is defined | `extract_data <field names joined ",">` |
| screenshot | `screenshot(sid, undefined, fullPage ?? false)`, then `pngDimensions` (FR2-12) and a write to `screenshots/step-NN-<name ?? 'screenshot'>.png` | `screenshot <name>` |
| audit | `audit(sid, url ? {url: resolvedUrl} : {})`, then `writeAuditArtifacts(result, <outDir>/audit/step-NN)`, then write `audit-report.json` there | `audit <url or 'current page'>` |

**`ScenarioRuntimePort`** is `Pick<SutradharRuntime, 'launch'|'shutdown'|'setViewport'|'navigate'|'goBack'|'goForward'|'reload'|'click'|'type'|'pressKey'|'focus'|'hover'|'scroll'|'selectOption'|'selectOptions'|'clickByText'|'clickByRole'|'typeByLabel'|'uploadFile'|'waitForSelector'|'waitFor'|'extractData'|'screenshot'|'audit'|'getEventBus'|'getActionHistoryReport'|'getSessionManager'|'getPendingDialog'>`. The CLI passes the real runtime; tests pass a fake.

### 2.3 `extract_data` assertions, and `normalizeExtractFieldMap`

```ts
// packages/capability-runtime/src/extract/field-map.ts
/** D15. string → {selector}; object → shallow copy of FR2-02's ExtractFieldSpec keys only.
 *  TypeError('extract fields must be a non-empty object of name → selector or {selector, attribute?, visibleOnly?}')
 *  TypeError('extract field "<n>": selector must be a non-empty string')
 *  TypeError('extract field "<n>": unknown key "<k>" — allowed: selector, attribute, visibleOnly') */
export function normalizeExtractFieldMap(input: unknown): Record<string, ExtractFieldSpec>;
```

Matchers run on the observed `string[]` for one field. Every matcher given must pass (AND). Each failure has its own message:

| Matcher | Passes iff | Failure message |
|---|---|---|
| `equals: string[]` | same length, and `observed[i] === equals[i]` for every i | `<field>: expected exactly <JSON(equals) capped 200>, got <JSON(observed capped)>` |
| `count: n` | `observed.length === n` | `<field>: expected <n> match(es), got <m>` |
| `contains: s` | some value `.includes(s)` (case-sensitive, the same substring semantics as `expect.text`) | `<field>: no value contains "<s>" (<m> value(s))` |
| `notContains: s` | no value includes `s` | `<field>: value #<i> contains "<s>"` |

A field with no assertion is evaluated for count only and always passes. A step fails (kind `extract-mismatch`) if any field fails. The report records `observed` values **only for failing fields**, capped at 20 values × 200 characters (D16).

### 2.4 Gates (`gates.ts`)

```ts
export type GateEventType = 'browser:console:message' | 'browser:page:error' | 'browser:network:response' | 'browser:network:failed';
export const ABORTED_ERROR_TEXT = 'net::ERR_ABORTED';
export const isConsoleError = (p: { logType: string }): boolean => p.logType === 'error';          // FR2-12 D9 filter
export const isBrokenResponse = (p: { status: number }): boolean => typeof p.status === 'number' && p.status >= 400;  // FR2-12 D9 filter
export const isCountedNetworkFailure = (p: { errorText: string }): boolean => p.errorText !== ABORTED_ERROR_TEXT;     // D6

export class GateCollector {
  constructor(sessionIdFilter: () => string | undefined, cfg: Required<Pick<ScenarioGates,'ignoreUrls'>> & ScenarioGates, now?: () => Date);
  readonly observedSince: string;                 // ISO at construction
  currentStepIndex: number | null;                // set by the runner before each step (1-based); null before step 1
  onEvent(type: GateEventType, payload: any): void;   // ignores events whose sessionId ≠ filter(); stamps timestamp + stepIndex
  counts(): { consoleErrors: number; pageErrors: number; brokenRequests: number; ignoredRequests: number };
  evaluate(): { passed: boolean; results: GatesReport['results']; breaches: string[] };
  toReport(): GatesReport;                        // entries sanitized (§2.5), capped at REPORT_GATE_ENTRY_CAP each, truncated flag
  subscribe(bus: EventBus): () => void;           // subscribes to the 4 types; returns unsubscribe
}
```

**The gate rule** (`evaluate`):
- `maxConsoleErrors` is set and `consoleErrors > max` → breach: `console errors: <n> (max <max>)`.
- The same for `maxPageErrors` → `page errors: <n> (max <max>)`.
- `failOnBrokenRequests === true` and `brokenRequests > 0` → breach: `broken requests: <n>`.
- An absent gate is `'off'`. A breach adds the first 5 offending entries to the failure details, in the form `console: <text≤200>`, `pageerror: <message≤200>`, `request: <status|errorText> <redacted url>`.

**Broken-request bookkeeping:**
- a `response` with status ≥ 400 is a candidate, and so is a `failed` event where `isCountedNetworkFailure` holds;
- a candidate whose URL contains any `ignoreUrls` substring goes to `ignoredRequests`;
- every other candidate goes to `brokenRequests`.

**When gates run:** after every step that passed, and after the last step. A breach stops the run (kind `gate-failed`) at that step's index. When the run stops for another reason, gates are still reported (`toReport`) but don't change `failure`.

### 2.5 Outputs

#### 2.5.1 Types (`scenario-types.ts`)

```ts
export const SCENARIO_RUN_REPORT_SCHEMA_VERSION = 1 as const;
export const REPORT_FILE = 'report.json';
export const HISTORY_FILE = 'history.jsonl';
export const SCREENSHOTS_DIR = 'screenshots';
export type RunStatus = 'passed' | 'failed' | 'error';
export type StepStatus = 'passed' | 'failed' | 'error' | 'skipped';
export type AssertionFailureKind = 'action-failed' | 'expectation-failed' | 'wait-failed' | 'extract-mismatch' | 'gate-failed' | 'step-timeout' | 'dialog-blocked';
export type InfraFailureKind = 'usage' | 'scenario-invalid' | 'browser-launch' | 'browser-disconnected' | 'navigation-blocked' | 'output-error' | 'interrupted' | 'internal-error';
export type FailureKind = AssertionFailureKind | InfraFailureKind;
export interface ScenarioRunReport {
  schemaVersion: 1;
  runId: string;                                  // 'run-YYYYMMDDTHHMMSSZ-<4 hex>'
  status: RunStatus;
  exitCode: 0 | 1 | 2;
  scenario: { path: string | null; name: string | null; format: 'yaml' | 'json' | null; sha256: string | null; stepCount: number };
  startedAt: string; finishedAt: string; durationMs: number;
  environment: { node: string; platform: string; headless: boolean | null; viewport: { width: number; height: number } | null; baseUrl: string | null; browserVersion: string | null };
  outDir: string | null;                          // absolute; null if never prepared
  historyPath: string | null;
  totals: { steps: number; passed: number; failed: number; error: number; skipped: number };
  steps: StepReport[];
  gates: GatesReport | null;                      // null iff no browser was ever launched
  failure: FailureReport | null;                  // null iff status === 'passed'
  warnings: string[];                             // each ≤ 300 chars
}
export interface StepReport {
  index: number; id: string | null; action: ScenarioStepAction; summary: string; status: StepStatus;
  startedAt: string | null; durationMs: number | null;
  success: boolean | null;                        // the runtime result's success; null if skipped/threw
  error: string | null;                           // redactUrlsInText + cap 300
  url: string | null;                             // redactHistoryUrl(tab URL after the step)
  verification: VerificationResultDto | null;     // FR2-07, via sanitizeVerification (FR2-11)
  expectFailed: string[];                         // failedExpectations(); [] otherwise
  extract: { fields: Record<string, { count: number; passed: boolean; failures: string[]; observed: string[] | null }> } | null;
  audit: { reportPath: string; screenshotPath: string | null; consoleErrors: number; pageErrors: number; brokenRequests: number; accessibilityIssues: number } | null;
  screenshotPath: string | null;
}
export interface GatesReport {
  observedSince: string;
  config: { maxConsoleErrors: number | null; maxPageErrors: number | null; failOnBrokenRequests: boolean; ignoreUrls: string[] };
  counts: { consoleErrors: number; pageErrors: number; brokenRequests: number; ignoredRequests: number };
  results: { maxConsoleErrors: 'pass' | 'fail' | 'off'; maxPageErrors: 'pass' | 'fail' | 'off'; failOnBrokenRequests: 'pass' | 'fail' | 'off' };
  consoleErrors: { text: string; timestamp: string; tabId: string; stepIndex: number | null }[];
  pageErrors: { message: string; timestamp: string; tabId: string; stepIndex: number | null }[];
  brokenRequests: { url: string; status: number | null; errorText: string | null; timestamp: string; tabId: string; stepIndex: number | null }[];
  truncated: boolean;
}
export interface FailureReport {
  kind: FailureKind; stepIndex: number | null; stepId: string | null; action: ScenarioStepAction | null;
  message: string;                                 // one line, ≤ 500
  details: string[];                               // ≤ 20 lines, each ≤ 300
  screenshotPath: string | null; screenshotSkippedReason: string | null;
}
export const SCENARIO_RUN_REPORT_EXAMPLE: DeepRequired<ScenarioRunReport>;   // tsc drift guard (FR2-12 D5)
```

**Sanitization** (FR2-11 conventions):
- `summary`, `error`, `details`, `message` and gate `text`/`message` go through `capHistoryString(redactUrlsInText(s), cap)`, with caps of 200, 300, 300, 500 and 300 respectively.
- Gate `url` and step `url` go through `capHistoryString(redactHistoryUrl(u))`.
- `verification` goes through `sanitizeVerification` (§1 #18).
- **No base64 and no typed values anywhere.**

#### 2.5.2 `packages/cli/schemas/scenario-run-report.schema.json` (committed verbatim)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "urn:sutradhar:scenario-run-report:1",
  "title": "Sutradhar scenario run report",
  "description": "report.json written by `sutradhar run` (and printed by --json). Paths are absolute; images are files, never base64. URLs have query/fragment removed and typed values appear only as lengths (FR2-11 conventions). Any shape change bumps schemaVersion.",
  "type": "object", "additionalProperties": false,
  "required": ["schemaVersion", "runId", "status", "exitCode", "scenario", "startedAt", "finishedAt", "durationMs", "environment", "outDir", "historyPath", "totals", "steps", "gates", "failure", "warnings"],
  "definitions": {
    "iso": { "type": "string", "format": "date-time" },
    "isoOrNull": { "anyOf": [{ "type": "string", "format": "date-time" }, { "type": "null" }] },
    "strOrNull": { "type": ["string", "null"] },
    "action": { "enum": ["navigate", "go_back", "go_forward", "reload", "click", "type", "press_key", "focus", "hover", "scroll", "select_option", "select_options", "click_by_text", "click_by_role", "type_by_label", "upload_file", "wait_for_selector", "wait_for", "extract_data", "screenshot", "audit"] },
    "scalar": { "type": ["string", "number", "boolean", "null"] },
    "verification": {
      "type": ["object", "null"], "additionalProperties": false,
      "required": ["verified", "urlChanged", "elementFound", "confidence", "reason", "evidence"],
      "properties": {
        "verified": { "type": "boolean" }, "urlChanged": { "type": "boolean" }, "elementFound": { "type": "boolean" },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 }, "reason": { "type": "string" },
        "evidence": { "type": "object", "additionalProperties": false, "required": ["tier", "checks"],
          "properties": {
            "tier": { "enum": ["verified", "contradicted", "unverifiable", "low-confidence", "action-failed"] },
            "checks": { "type": "array", "maxItems": 8, "items": { "type": "object", "additionalProperties": false, "required": ["check", "outcome"],
              "properties": { "check": { "type": "string" }, "outcome": { "enum": ["pass", "fail", "not-run"] },
                "expected": { "$ref": "#/definitions/scalar" }, "observed": { "$ref": "#/definitions/scalar" }, "detail": { "type": "string" } } } } } }
      }
    }
  },
  "properties": {
    "schemaVersion": { "const": 1 },
    "runId": { "type": "string", "pattern": "^run-\\d{8}T\\d{6}Z-[0-9a-f]{4}$" },
    "status": { "enum": ["passed", "failed", "error"] },
    "exitCode": { "enum": [0, 1, 2] },
    "scenario": { "type": "object", "additionalProperties": false, "required": ["path", "name", "format", "sha256", "stepCount"],
      "properties": { "path": { "$ref": "#/definitions/strOrNull" }, "name": { "$ref": "#/definitions/strOrNull" },
        "format": { "enum": ["yaml", "json", null] }, "sha256": { "type": ["string", "null"], "pattern": "^[0-9a-f]{64}$" },
        "stepCount": { "type": "integer", "minimum": 0 } } },
    "startedAt": { "$ref": "#/definitions/iso" }, "finishedAt": { "$ref": "#/definitions/iso" },
    "durationMs": { "type": "integer", "minimum": 0 },
    "environment": { "type": "object", "additionalProperties": false, "required": ["node", "platform", "headless", "viewport", "baseUrl", "browserVersion"],
      "properties": { "node": { "type": "string" }, "platform": { "type": "string" }, "headless": { "type": ["boolean", "null"] },
        "viewport": { "type": ["object", "null"], "additionalProperties": false, "required": ["width", "height"],
          "properties": { "width": { "type": "integer", "minimum": 1 }, "height": { "type": "integer", "minimum": 1 } } },
        "baseUrl": { "$ref": "#/definitions/strOrNull" }, "browserVersion": { "$ref": "#/definitions/strOrNull" } } },
    "outDir": { "$ref": "#/definitions/strOrNull" }, "historyPath": { "$ref": "#/definitions/strOrNull" },
    "totals": { "type": "object", "additionalProperties": false, "required": ["steps", "passed", "failed", "error", "skipped"],
      "properties": { "steps": { "type": "integer", "minimum": 0 }, "passed": { "type": "integer", "minimum": 0 }, "failed": { "type": "integer", "minimum": 0 },
        "error": { "type": "integer", "minimum": 0 }, "skipped": { "type": "integer", "minimum": 0 } } },
    "steps": { "type": "array", "maxItems": 500, "items": { "type": "object", "additionalProperties": false,
      "required": ["index", "id", "action", "summary", "status", "startedAt", "durationMs", "success", "error", "url", "verification", "expectFailed", "extract", "audit", "screenshotPath"],
      "properties": {
        "index": { "type": "integer", "minimum": 1 }, "id": { "$ref": "#/definitions/strOrNull" }, "action": { "$ref": "#/definitions/action" },
        "summary": { "type": "string", "maxLength": 200 }, "status": { "enum": ["passed", "failed", "error", "skipped"] },
        "startedAt": { "$ref": "#/definitions/isoOrNull" }, "durationMs": { "type": ["integer", "null"], "minimum": 0 },
        "success": { "type": ["boolean", "null"] }, "error": { "type": ["string", "null"], "maxLength": 300 }, "url": { "$ref": "#/definitions/strOrNull" },
        "verification": { "$ref": "#/definitions/verification" },
        "expectFailed": { "type": "array", "items": { "enum": ["text", "url", "urlChanged"] } },
        "extract": { "type": ["object", "null"], "additionalProperties": false, "required": ["fields"],
          "properties": { "fields": { "type": "object", "additionalProperties": { "type": "object", "additionalProperties": false,
            "required": ["count", "passed", "failures", "observed"],
            "properties": { "count": { "type": "integer", "minimum": 0 }, "passed": { "type": "boolean" },
              "failures": { "type": "array", "items": { "type": "string" } },
              "observed": { "type": ["array", "null"], "maxItems": 20, "items": { "type": "string", "maxLength": 200 } } } } } } },
        "audit": { "type": ["object", "null"], "additionalProperties": false,
          "required": ["reportPath", "screenshotPath", "consoleErrors", "pageErrors", "brokenRequests", "accessibilityIssues"],
          "properties": { "reportPath": { "type": "string" }, "screenshotPath": { "$ref": "#/definitions/strOrNull" },
            "consoleErrors": { "type": "integer", "minimum": 0 }, "pageErrors": { "type": "integer", "minimum": 0 },
            "brokenRequests": { "type": "integer", "minimum": 0 }, "accessibilityIssues": { "type": "integer", "minimum": 0 } } },
        "screenshotPath": { "$ref": "#/definitions/strOrNull" } } } },
    "gates": { "type": ["object", "null"], "additionalProperties": false,
      "required": ["observedSince", "config", "counts", "results", "consoleErrors", "pageErrors", "brokenRequests", "truncated"],
      "properties": {
        "observedSince": { "$ref": "#/definitions/iso" },
        "config": { "type": "object", "additionalProperties": false, "required": ["maxConsoleErrors", "maxPageErrors", "failOnBrokenRequests", "ignoreUrls"],
          "properties": { "maxConsoleErrors": { "type": ["integer", "null"], "minimum": 0 }, "maxPageErrors": { "type": ["integer", "null"], "minimum": 0 },
            "failOnBrokenRequests": { "type": "boolean" }, "ignoreUrls": { "type": "array", "items": { "type": "string" } } } },
        "counts": { "type": "object", "additionalProperties": false, "required": ["consoleErrors", "pageErrors", "brokenRequests", "ignoredRequests"],
          "properties": { "consoleErrors": { "type": "integer", "minimum": 0 }, "pageErrors": { "type": "integer", "minimum": 0 },
            "brokenRequests": { "type": "integer", "minimum": 0 }, "ignoredRequests": { "type": "integer", "minimum": 0 } } },
        "results": { "type": "object", "additionalProperties": false, "required": ["maxConsoleErrors", "maxPageErrors", "failOnBrokenRequests"],
          "properties": { "maxConsoleErrors": { "enum": ["pass", "fail", "off"] }, "maxPageErrors": { "enum": ["pass", "fail", "off"] }, "failOnBrokenRequests": { "enum": ["pass", "fail", "off"] } } },
        "consoleErrors": { "type": "array", "maxItems": 50, "items": { "type": "object", "additionalProperties": false, "required": ["text", "timestamp", "tabId", "stepIndex"],
          "properties": { "text": { "type": "string", "maxLength": 300 }, "timestamp": { "$ref": "#/definitions/iso" }, "tabId": { "type": "string" }, "stepIndex": { "type": ["integer", "null"], "minimum": 1 } } } },
        "pageErrors": { "type": "array", "maxItems": 50, "items": { "type": "object", "additionalProperties": false, "required": ["message", "timestamp", "tabId", "stepIndex"],
          "properties": { "message": { "type": "string", "maxLength": 300 }, "timestamp": { "$ref": "#/definitions/iso" }, "tabId": { "type": "string" }, "stepIndex": { "type": ["integer", "null"], "minimum": 1 } } } },
        "brokenRequests": { "type": "array", "maxItems": 50, "items": { "type": "object", "additionalProperties": false, "required": ["url", "status", "errorText", "timestamp", "tabId", "stepIndex"],
          "properties": { "url": { "type": "string", "maxLength": 200 }, "status": { "type": ["integer", "null"], "minimum": 400, "maximum": 599 }, "errorText": { "$ref": "#/definitions/strOrNull" },
            "timestamp": { "$ref": "#/definitions/iso" }, "tabId": { "type": "string" }, "stepIndex": { "type": ["integer", "null"], "minimum": 1 } } } },
        "truncated": { "type": "boolean" } } },
    "failure": { "type": ["object", "null"], "additionalProperties": false,
      "required": ["kind", "stepIndex", "stepId", "action", "message", "details", "screenshotPath", "screenshotSkippedReason"],
      "properties": {
        "kind": { "enum": ["action-failed", "expectation-failed", "wait-failed", "extract-mismatch", "gate-failed", "step-timeout", "dialog-blocked", "usage", "scenario-invalid", "browser-launch", "browser-disconnected", "navigation-blocked", "output-error", "interrupted", "internal-error"] },
        "stepIndex": { "type": ["integer", "null"], "minimum": 1 }, "stepId": { "$ref": "#/definitions/strOrNull" },
        "action": { "anyOf": [{ "$ref": "#/definitions/action" }, { "type": "null" }] },
        "message": { "type": "string", "minLength": 1, "maxLength": 500 },
        "details": { "type": "array", "maxItems": 20, "items": { "type": "string", "maxLength": 300 } },
        "screenshotPath": { "$ref": "#/definitions/strOrNull" }, "screenshotSkippedReason": { "$ref": "#/definitions/strOrNull" } } },
    "warnings": { "type": "array", "items": { "type": "string", "maxLength": 300 } }
  }
}
```

#### 2.5.3 History line (`history-file.ts`, additive to FR2-11)

```ts
export interface ScenarioStepHistoryLineV1 {
  v: 1;
  type: 'scenario-step';
  ts: string;                          // step START, ISO UTC
  runId: string;
  sessionId: string;                   // the run's ephemeral runtime session
  scenario: string;                    // capHistoryString(name)
  stepIndex: number;                   // 1-based
  stepId: string | null;
  action: string;
  summary: string;                     // same string as StepReport.summary (already redacted)
  status: 'passed' | 'failed' | 'error';
  durationMs: number;
  error?: string;                      // cap 300, URL-redacted
  actions: SessionActionHistoryEntry[];   // session-ring entries with seq > previous step's max seq (FR2-11 D1)
  actionsEvicted: number;              // increase in getActionHistoryReport(...).evicted during this step
  actionsUnavailable?: string;
  truncated?: true;                    // FR2-11's 64 KiB guard, shared via applyLineGuard
  actionsOmitted?: number;
}
export type CliHistoryLine = CliHistoryLineV1 | ScenarioStepHistoryLineV1;
export function buildScenarioStepHistoryLine(input: Omit<ScenarioStepHistoryLineV1, 'v' | 'type' | 'truncated' | 'actionsOmitted'>): ScenarioStepHistoryLineV1;
// appendHistoryLine(file, line: CliHistoryLine, deps?)  — widened parameter type, unchanged behavior
// formatHistoryHuman: a line with type !== 'command' prints `<ts19>  (<type> line — see the run's report.json)`
```

- Skipped steps get no line.
- The file is truncated (`writeFile(path, '')`) right after the out dir is prepared.
- **`history.jsonl` is never shared across runs.**

#### 2.5.4 Screenshots

- They are written to `<outDir>/screenshots/`.
- `NN` is the 1-based step index, zero-padded to `max(2, digits(steps.length))`. Names:
  - a failing step: `step-NN-<action>-failure.png`;
  - a gate breach after step NN: `step-NN-gate-failure.png`;
  - an explicit screenshot step: `step-NN-<name ?? 'screenshot'>.png`.
- The failure capture is chosen in this order:
  1. the engine's `result.failureScreenshot` (captured at failure time), decoded and checked with `pngDimensions`;
  2. otherwise, if `runtime.getPendingDialog(sid)` is set, skip with `a <type> dialog is open, which blocks capture`;
  3. otherwise, if the browser is not connected, skip with `the browser is not connected`;
  4. otherwise `bounded(runtime.screenshot(sid, undefined, false), FAILURE_SCREENSHOT_TIMEOUT_MS)`. On timeout, skip with `the capture did not complete within 5000ms`. This is the GAP-010 lesson: never unbounded.
- The report stores the absolute path, or `screenshotSkippedReason`.

#### 2.5.5 Human output (stdout; in `--json` mode it goes to stderr instead, and stdout gets exactly one pretty-printed report)

```
Scenario: <name> (<path as given>)
  [1/6] navigate file:///E:/…/aria-menu.html ... ok (412ms)
  [5/6] click_by_role menuitem "Archive Item" ... FAILED (120ms)
        Expectation failed (text): Expected text "ACTION TRIGGERED: delete" was not found in the page's visible text after the action
        Screenshot: E:\…\screenshots\step-05-click_by_role-failure.png
  [6/6] extract_data result ... skipped
Gates: console errors 0 (max 0) ok; page errors 0 (max 0) ok; broken requests 0 ok
Result: FAILED (exit 1) — step 5 "archive" (click_by_role): expectation failed
Report: E:\…\report.json
History: E:\…\history.jsonl
```

- The step line is `  [i/n] <summary> ... <ok|FAILED|ERROR|skipped>[ (<ms>ms)]`.
- A failure adds one indented line per `failure.details`, capped at 5, then `Screenshot: <path>` or `Screenshot skipped: <reason>`.
- In the gates line, a gate that's off prints `<name> <n> (not gated)`, and a breach prints `FAILED` instead of `ok`.
- `Result:` is `PASSED (exit 0)`, `FAILED (exit 1) — <failure.message>` or `ERROR (exit 2) — <failure.message>`.
- The `Report:`/`History:` lines appear only when the file was written.

### 2.6 Exit codes and classification (`classify.ts`)

| Condition | kind | exit | step status |
|---|---|---|---|
| Every step passed and the gates passed | — | **0** | passed |
| Action step result `success:false` while the browser is alive | `action-failed` | **1** | failed |
| `wait_for`/`wait_for_selector` result `success:false` | `wait-failed` (or `dialog-blocked` if the error starts `wait_for blocked by an open`) | **1** | failed |
| `failedExpectations(result.verification).length > 0` | `expectation-failed` | **1** | failed |
| Any extract matcher failed | `extract-mismatch` | **1** | failed |
| A gate breached | `gate-failed` | **1** | passed (the step itself passed; the failure has its index) |
| The step exceeded `stepTimeoutMs` while the browser is alive | `step-timeout` | **1** | failed |
| Thrown error matching `/dialog is open|blocked by an open .* dialog/` (FR2-12 D11 audit fast-fail, FR2-08 D9) | `dialog-blocked` | **1** | failed |
| Thrown error, any other, browser alive (e.g. `net::ERR_CONNECTION_REFUSED` from navigate, `goBack` throws) | `action-failed` | **1** | failed |
| Bad CLI flags or args, missing/unsupported file | `usage` | **2** | — |
| Parse error, schema violation, semantic check, `InvalidSelectorError` (by `name`, FR2-06), error message starting `Invalid selector for field` / `extractData field` / `Invalid frameSelector` (FR2-02), `TypeError` whose message starts `wait_for:` (FR2-08) | `scenario-invalid` | **2** | error (if mid-run) |
| `prepareRunOutDir` failed, or the report/history write failed | `output-error` | **2** | — |
| `launch` threw, or `hasRealBrowser:false` (the session is then shut down) | `browser-launch` | **2** | — |
| Browser not connected after a throw, failure or timeout (probe: `getSessionManager().getSession(createSessionId(sid))?.getPuppeteerBrowser()?.isConnected() !== true`), or `name === 'BrowserNotAvailableError'`, or `/Target closed|Session closed|Connection closed|browser has disconnected|Target crashed|has no live browser page/i` | `browser-disconnected` | **2** | error |
| Message matches `^Navigation to ".*" was blocked:` (T20) | `navigation-blocked` | **2** | error |
| SIGINT received | `interrupted` | **2** | error |
| Any other exception inside the runner itself (including other `TypeError`s) | `internal-error` | **2** | error |

- `exitCodeForKind(k)` returns 1 for `AssertionFailureKind` and 2 for `InfraFailureKind`.
- **Precedence inside one step:** thrown/timeout classification → `success:false` → expectation → extract → gates. The first match wins.
- **Warnings** never change the exit code:
  - `step N (<action>): built-in verification was contradicted but no expect was given: <reason≤200>`, only when tier is `contradicted` and no `expect` was given (FR2-07 D5 keeps `success`);
  - `step N (wait_for_selector): "hidden" was satisfied vacuously — nothing matched <target>` (tier `unverifiable` on wait_for_selector with `matchedAtStart:false`, FR2-07 D14);
  - `step N (wait_for): textGone "<x>" was never present, so it was satisfied immediately` (`output.presentAtStart === false`, FR2-08 D4).

### 2.7 The CLI surface

**Signature:**
```
sutradhar run <scenario.yaml|.yml|.json> [--out <dir>] [--base-url <url>] [--headed] [--viewport WxH] [--allowlist-domains a.com,b.com] [--json]
```

**`parse-args.ts` (additive):**
- `KNOWN_FLAGS` gains `--out` and `--base-url`, and `isConsumedValue` covers both.
- New fields:
  - `outFlag: string | undefined`;
  - `outFlagGivenButInvalid: boolean` (present, but the next argument is missing or starts with `--`, which is the D13/FR2-12 precedent);
  - `baseUrlFlag`, `baseUrlFlagGivenButInvalid`;
  - `presentFlags: string[]` (every `KNOWN_FLAGS` member present in the arguments, in argument order).

**`cli.ts`:**
- **The first statement of `main()`** is `if (verb === 'run') return cmdRun();`. It runs before the `unrecognizedFlags`/`--viewport`/`--state`/FR2-04/07/08 checks, because those exit 1 (T8).
- `cmdRun()`:
  1. Validate flags, all as `usage` (exit 2):
     - `unrecognizedFlags` → `Unrecognized flag "<f>" — "run" accepts --out, --base-url, --headed, --viewport, --allowlist-domains, --json`;
     - any entry of `presentFlags` outside `RUN_FLAGS = ['--out','--base-url','--headed','--viewport','--allowlist-domains','--json']` → `flag <f> does not apply to "run" (per-step options go in the scenario file)`;
     - `outFlagGivenButInvalid` → `--out requires a directory`;
     - `baseUrlFlagGivenButInvalid` → `--base-url requires a URL`;
     - `viewportFlagGivenButInvalid` → `--viewport must be WIDTHxHEIGHT (e.g. --viewport 390x844)`;
     - `cleanArgs.length !== 1` → `usage: sutradhar run <scenario.yaml|.yml|.json> [--out <dir>] [--base-url <url>] [--json]`.
  2. `loadScenario`.
  3. `prepareRunOutDir(outFlag ?? path.join('.sutradhar-runs', runId))` (`mkdir -p`; a failure is `output-error`), **before any browser work**, as in FR2-12 D2.7.
  4. `runScenario(...)` with `new SutradharRuntime({ logger, allowedDomains: allowlistDomainsFlag })`.
  5. Write the report and print.
  6. `process.exitCode = report.exitCode`.
  7. Wrap everything in one `try/catch` that turns an unexpected error into `internal-error` (exit 2) and still prints or writes a report. **Nothing escapes to `main().catch`.** `printErrorAndExit` is never called from `cmdRun`.
- `activeRuntime`/`activeSessionId` are **not** set by `run`, so `main().finally`'s disconnect is a no-op for it. The runner has already shut its own browser down, bounded by `SHUTDOWN_TIMEOUT_MS` in its `finally`.
- **Non-`run` verbs:** `outFlag !== undefined || baseUrlFlag !== undefined` → `printErrorAndExit('--out and --base-url are only valid with "run"')` (exit 1), placed next to the existing checks.
- **A pre-output-dir failure in `--json` mode** still prints a schema-valid report with `outDir: null`, `historyPath: null`, `gates: null`, `steps: []`, `status: 'error'`, `exitCode: 2` and `failure.kind` of `usage` or `scenario-invalid`. In human mode it prints `Error: <message>` to stderr. Either way the exit code is 2.
- **SIGINT:** `process.once('SIGINT', …)` sets an abort flag and calls `runtime.shutdown(sid)`. The in-flight step then fails, and it's classified `interrupted`. The report is written. The handler is removed in `finally`.
- **Help text** (a Commands row plus Flags rows):

```
  run <scenario.yaml|.yml|.json> [--out <dir>] [--base-url <url>] [--json]
                                Run a declarative scenario file in a fresh, isolated browser (not
                                this directory's session; nothing is added to "history"). Steps
                                are the browser actions (navigate, click, type, press_key, ...,
                                wait_for, wait_for_selector, extract_data, screenshot, audit) with
                                expect / wait_for / extract assertions, plus optional gates
                                (maxConsoleErrors, maxPageErrors, failOnBrokenRequests). Writes
                                report.json, history.jsonl and failure screenshots to --out
                                (default ./.sutradhar-runs/<runId>). Exit codes for "run": 0 passed,
                                1 an assertion or gate failed, 2 the scenario could not be run
                                (bad file or flags, browser failed to launch or crashed).
                                Schema: packages/cli/schemas/scenario.schema.json
Flags:
  --out <dir>           "run" only: output directory (created if missing)
  --base-url <url>      "run" only: base for scenario urls starting with "/" (overrides baseUrl)
```

The `--json` row gains `"run": print the run report (report.json) as the only stdout output`.

---

## 3. Scenario files (full content)

All of these live in `tools/scenario-suite/scenarios/`. The fixture paths are relative to each file. **None of them contains a fixed sleep; the vocabulary has none (D3).**

### 3.1 `uc-14-aria-menu.yaml`: expect, wait_for (replaces sdk `:646`/`:652` and mcp `:667`), extract, gates

```yaml
schemaVersion: 1
name: "UC-14 Accessibility-only grounding (no CSS-selectable name)"
description: >-
  Ported from tools/scenario-suite (run-sdk.mjs scenarioUC14, run-cli.mjs uc14, run-mcp.mjs
  ucAccessibilityOnlyGrounding). Opens the icon-only actions menu and triggers "Archive Item" using
  only ARIA role + accessible name. The two fixed 200ms sleeps in the per-surface drivers are
  replaced by a wait on the menu's visible text.
gates:
  maxConsoleErrors: 0
  maxPageErrors: 0
  failOnBrokenRequests: true
steps:
  - id: open-fixture
    action: navigate
    url: ../fixtures/aria-menu.html
    expect:
      text: "Actions Menu (no CSS-selectable text on the trigger)"
  - id: menu-closed-at-start
    action: wait_for_selector
    target: "#actions-menu"
    state: hidden
    timeoutMs: 0
  - id: open-menu
    action: click_by_role
    role: button
    name: Open Actions Menu
  - id: menu-open
    action: wait_for
    text: Archive Item
    timeoutMs: 5000
  - id: archive
    action: click_by_role
    role: menuitem
    name: Archive Item
    expect:
      text: "ACTION TRIGGERED: archive"
  - id: result-reads-back
    action: extract_data
    fields:
      result: "#action-result"
    assert:
      result:
        equals: ["ACTION TRIGGERED: archive"]
```

Step 2 is **not** vacuous: `#actions-menu` exists and is `display:none`, so FR2-07 D14 gives `verified`.

### 3.2 `uc-14-aria-menu.json`: the JSON twin (proves format parity; test L2 asserts it deep-equals the YAML parse)

```json
{
  "schemaVersion": 1,
  "name": "UC-14 Accessibility-only grounding (no CSS-selectable name)",
  "description": "Ported from tools/scenario-suite (run-sdk.mjs scenarioUC14, run-cli.mjs uc14, run-mcp.mjs ucAccessibilityOnlyGrounding). Opens the icon-only actions menu and triggers \"Archive Item\" using only ARIA role + accessible name. The two fixed 200ms sleeps in the per-surface drivers are replaced by a wait on the menu's visible text.",
  "gates": { "maxConsoleErrors": 0, "maxPageErrors": 0, "failOnBrokenRequests": true },
  "steps": [
    { "id": "open-fixture", "action": "navigate", "url": "../fixtures/aria-menu.html", "expect": { "text": "Actions Menu (no CSS-selectable text on the trigger)" } },
    { "id": "menu-closed-at-start", "action": "wait_for_selector", "target": "#actions-menu", "state": "hidden", "timeoutMs": 0 },
    { "id": "open-menu", "action": "click_by_role", "role": "button", "name": "Open Actions Menu" },
    { "id": "menu-open", "action": "wait_for", "text": "Archive Item", "timeoutMs": 5000 },
    { "id": "archive", "action": "click_by_role", "role": "menuitem", "name": "Archive Item", "expect": { "text": "ACTION TRIGGERED: archive" } },
    { "id": "result-reads-back", "action": "extract_data", "fields": { "result": "#action-result" }, "assert": { "result": { "equals": ["ACTION TRIGGERED: archive"] } } }
  ]
}
```

### 3.3 `uc-10-prompt-injection.yaml`: extract with `visibleOnly` and `notContains`, gates

```yaml
schemaVersion: 1
name: "UC-10 Prompt injection exposure"
description: >-
  Ported from tools/scenario-suite UC-10. The injected instruction is inside a display:none span.
  It must be surfaced verbatim by a raw read (no sanitization, by design), excluded from visible
  reads, and the page's one real action must still work.
gates:
  maxConsoleErrors: 0
  maxPageErrors: 0
  failOnBrokenRequests: true
steps:
  - id: open-ticket
    action: navigate
    url: ../fixtures/prompt-injection.html
    expect:
      text: "Real Support Ticket #4471"
  - id: visible-ticket-text
    action: wait_for
    text: "Order number is SD-88213"
    timeoutMs: 0
  - id: injection-surfaced-raw-not-visible
    action: extract_data
    fields:
      injected: "#ticket-body span"
      injectedVisible:
        selector: "#ticket-body span"
        visibleOnly: true
      ticket: "#ticket-body"
    assert:
      injected:
        count: 1
        contains: "IGNORE ALL PREVIOUS INSTRUCTIONS"
      injectedVisible:
        count: 0
      ticket:
        contains: "Order number is SD-88213"
        notContains: "IGNORE ALL PREVIOUS INSTRUCTIONS"
  - id: real-action-still-works
    action: click
    target: "#mark-resolved"
    expect:
      text: "action:marked-resolved"
```

This relies on FR2-02's edge table: a `display:none` element's `innerText` falls back to `textContent`, so `injected` returns the text. `ticket` is visible, so its `innerText` excludes the hidden span.

### 3.4 `uc-06-modal-and-dynamic-content.yaml`: waits replace 4 sleeps (sdk `:336`, cli `:437`, mcp `:345`, `:360`)

```yaml
schemaVersion: 1
name: "UC-06 Modals + dynamic content"
description: >-
  Ported from tools/scenario-suite UC-06. Closes the-internet's entry-ad modal (its Close control
  is <div class="modal-footer"><p>Close</p></div>, verified live in run-mcp.mjs) and reads the
  AJAX-delayed "Hello World!". Every fixed sleep in the three drivers is replaced by a condition
  wait. No gates: third-party site, not the system under test.
stepTimeoutMs: 60000
steps:
  - id: open-entry-ad
    action: navigate
    url: https://the-internet.herokuapp.com/entry_ad
    expect:
      url: /entry_ad
  - id: modal-shown
    action: wait_for_selector
    target: ".modal-footer p"
    state: visible
    timeoutMs: 15000
  - id: close-modal
    action: click
    target: ".modal-footer p"
  - id: modal-gone
    action: wait_for_selector
    target: "#modal"
    state: hidden
    timeoutMs: 10000
  - id: open-dynamic-loading
    action: navigate
    url: https://the-internet.herokuapp.com/dynamic_loading/1
  - id: start
    action: click
    target: "#start button"
  - id: hello-world-visible
    action: wait_for
    text: "Hello World!"
    timeoutMs: 15000
  - id: read-result
    action: extract_data
    fields:
      finish:
        selector: "#finish"
        visibleOnly: true
    assert:
      finish:
        equals: ["Hello World!"]
```

### 3.5 `uc-05-saucedemo-checkout.yaml`: the long multi-step flow (replaces sdk `:261`; the math check moves into `wait_for js`)

```yaml
schemaVersion: 1
name: "UC-05 Long 10+ step flow (saucedemo checkout)"
description: >-
  Ported from tools/scenario-suite UC-05. Login -> sort by price -> product detail -> add to cart ->
  cart -> checkout -> fill form -> verify subtotal + tax = total from the real displayed numbers ->
  finish -> confirmation. Field values are read back independently (extract_data live .value),
  never trusted from type's own result. No gates: third-party site.
stepTimeoutMs: 60000
steps:
  - id: open
    action: navigate
    url: https://www.saucedemo.com/
    expect:
      text: Swag Labs
  - id: username
    action: type
    target: "#user-name"
    value: standard_user
  - id: password
    action: type
    target: "#password"
    value: secret_sauce
  - id: login
    action: click
    target: "#login-button"
    expect:
      url: /inventory.html
  - id: inventory-rendered
    action: wait_for_selector
    target: .inventory_list
  - id: sort-low-to-high
    action: select_option
    target: .product_sort_container
    value: lohi
  - id: sorted-ascending
    action: wait_for
    js: >-
      (() => { const p = [...document.querySelectorAll('.inventory_item_price')]
      .map((e) => parseFloat(e.textContent.replace('$', '')));
      return p.length > 1 && p.every((v, i) => i === 0 || p[i - 1] <= v); })()
    timeoutMs: 5000
  - id: open-first-product
    action: click
    target: .inventory_item_name
    expect:
      url: /inventory-item.html
  - id: detail-rendered
    action: wait_for_selector
    target: .inventory_details_name
  - id: add-to-cart
    action: click
    target: button.btn_primary.btn_inventory
    expect:
      text: Remove
  - id: go-to-cart
    action: click
    target: .shopping_cart_link
    expect:
      url: /cart.html
  - id: cart-has-one-item
    action: extract_data
    fields:
      items: .cart_item .inventory_item_name
      badge: .shopping_cart_badge
    assert:
      items:
        count: 1
      badge:
        equals: ["1"]
  - id: checkout
    action: click
    target: "#checkout"
    expect:
      url: /checkout-step-one.html
  - id: first-name
    action: type
    target: "#first-name"
    value: Ada
  - id: last-name
    action: type
    target: "#last-name"
    value: Lovelace
  - id: postal-code
    action: type
    target: "#postal-code"
    value: "12345"
  - id: fields-landed
    action: extract_data
    fields:
      first: "#first-name"
      last: "#last-name"
      zip: "#postal-code"
    assert:
      first:
        equals: ["Ada"]
      last:
        equals: ["Lovelace"]
      zip:
        equals: ["12345"]
  - id: continue
    action: click
    target: "#continue"
    expect:
      url: /checkout-step-two.html
  - id: totals-add-up
    action: wait_for
    js: >-
      (() => { const n = (s) => parseFloat((document.querySelector(s)?.textContent ?? '')
      .replace(/[^0-9.]/g, '')); const sub = n('.summary_subtotal_label'),
      tax = n('.summary_tax_label'), total = n('.summary_total_label');
      return Number.isFinite(sub) && Number.isFinite(tax) && Number.isFinite(total)
      && Math.abs(sub + tax - total) < 0.011; })()
    timeoutMs: 5000
  - id: finish
    action: click
    target: "#finish"
    expect:
      text: Thank you for your order!
  - id: confirmation
    action: extract_data
    fields:
      header: .complete-header
    assert:
      header:
        equals: ["Thank you for your order!"]
```

### 3.6 The deliberately failing scenario: `failing/uc-14-wrong-expectation.yaml`

```yaml
schemaVersion: 1
name: "UC-14 (deliberately failing): archive click expects the wrong result"
description: >-
  Identical to uc-14-aria-menu.yaml except the archive step expects "ACTION TRIGGERED: delete".
  The click itself succeeds; the runner must report exit 1, kind expectation-failed, step 5
  ("archive", click_by_role), quote the expected text, keep success:true on that step, skip step 6,
  and save a failure screenshot.
gates:
  maxConsoleErrors: 0
  maxPageErrors: 0
  failOnBrokenRequests: true
steps:
  - id: open-fixture
    action: navigate
    url: ../../fixtures/aria-menu.html
    expect:
      text: "Actions Menu (no CSS-selectable text on the trigger)"
  - id: menu-closed-at-start
    action: wait_for_selector
    target: "#actions-menu"
    state: hidden
    timeoutMs: 0
  - id: open-menu
    action: click_by_role
    role: button
    name: Open Actions Menu
  - id: menu-open
    action: wait_for
    text: Archive Item
    timeoutMs: 5000
  - id: archive
    action: click_by_role
    role: menuitem
    name: Archive Item
    expect:
      text: "ACTION TRIGGERED: delete"
  - id: result-reads-back
    action: extract_data
    fields:
      result: "#action-result"
    assert:
      result:
        equals: ["ACTION TRIGGERED: archive"]
```

**The diagnosis contract** (asserted in L5):
- `status: 'failed'`, `exitCode: 1`;
- `failure.kind: 'expectation-failed'`, `failure.stepIndex: 5`, `failure.stepId: 'archive'`, `failure.action: 'click_by_role'`;
- `failure.message === 'step 5 "archive" (click_by_role): expectation failed (text)'`;
- `failure.details` includes `Expected text "ACTION TRIGGERED: delete" was not found in the page's visible text after the action`, which is FR2-07 §2.2 rule 4, verbatim;
- `steps[4].success === true` and `steps[4].expectFailed` equals `['text']`;
- `steps[4].verification.evidence.tier === 'contradicted'`;
- `steps[5].status === 'skipped'`;
- `failure.screenshotPath` exists as a PNG inside `outDir`.

### 3.7 Alternate port and negative-case fixtures

**`uc-12-cart-outcome.yaml`** is an alternate. It is used only if the Orchestrator records that UC-05 or UC-06's external site is unavailable at VERIFY time (R10).

```yaml
schemaVersion: 1
name: "UC-12 Outcome verification after a state-changing action"
description: Log in, add one item, then independently re-read the cart badge and the button label.
stepTimeoutMs: 60000
steps:
  - { id: open, action: navigate, url: "https://www.saucedemo.com/" }
  - { id: username, action: type, target: "#user-name", value: standard_user }
  - { id: password, action: type, target: "#password", value: secret_sauce }
  - { id: login, action: click, target: "#login-button", expect: { url: /inventory.html } }
  - { id: inventory-rendered, action: wait_for_selector, target: .inventory_list }
  - { id: add-first, action: click, target: ".inventory_item:first-child button" }
  - { id: badge-appears, action: wait_for_selector, target: .shopping_cart_badge, timeoutMs: 5000 }
  - id: fresh-reread
    action: extract_data
    fields:
      badge: .shopping_cart_badge
      button: ".inventory_item:first-child button"
    assert:
      badge: { equals: ["1"] }
      button: { equals: ["Remove"] }
```

**`tools/scenario-suite/fixtures/fr2-13-server.mjs`** (new) exports `startFr213Server(): Promise<{origin, close()}>`. It listens on `127.0.0.1:0`, sends `Cache-Control: no-store` on every response, and has three routes:
- `/refused`: a page whose script runs `fetch('http://127.0.0.1:1/fr2-13').catch(()=>{}).finally(()=>{window.__done=true})`;
- `/abort`: `const c=new AbortController(); fetch('/slow?ms=5000',{signal:c.signal}).catch(()=>{}).finally(()=>{window.__done=true}); setTimeout(()=>c.abort(),300)`;
- `/slow?ms=`: responds 200 after `ms`.

**`tools/scenario-suite/fixtures/fr2-13/`** (each file is complete and short; the Executor writes them from this table):

| File | Content | Expected |
|---|---|---|
| `gates-fail.yaml` | `baseUrl` unset (verify passes `--base-url <FR2-12 origin>`); gates `{maxConsoleErrors:0, maxPageErrors:0, failOnBrokenRequests:true}`; steps: navigate `/audit?n=13`, wait_for text `FR2-12 audit fixture 13` (5000) | exit 1, `gate-failed` at step 2 |
| `gates-clean.yaml` | the same gates; navigate `/clean?n=13`; wait_for text `Clean 13` | exit 0 |
| `gates-ignored.yaml` | gates `{failOnBrokenRequests:true, ignoreUrls:["/missing-13.png","/api/fail-13"]}`; navigate `/audit?n=13`; wait_for text `FR2-12 audit fixture 13` | exit 0, `counts.ignoredRequests >= 2`, `brokenRequests 0` |
| `request-failed.yaml` | gates `{failOnBrokenRequests:true}`; navigate `/refused` (FR2-13 server); wait_for js `window.__done === true` (5000) | exit 1, `gate-failed`; one broken request with `status:null` and `errorText` containing `ERR_CONNECTION_REFUSED` |
| `request-aborted.yaml` | the same gate; navigate `/abort`; wait_for js `window.__done === true` (5000) | exit 0, `brokenRequests 0` |
| `action-failed.yaml` | navigate `http://127.0.0.1:1/` | exit 1, `action-failed`, step 1 |
| `wait-failed.yaml` | navigate `../aria-menu.html`; wait_for text `never-present-fr213` timeoutMs 500 | exit 1, `wait-failed`; error starts `wait_for timed out after 500ms` |
| `extract-mismatch.yaml` | navigate `../prompt-injection.html`; extract `{ticket: "#ticket-body"}` assert `{ticket: {equals: ["wrong"]}}` | exit 1, `extract-mismatch`, `observed` non-null |
| `step-timeout.yaml` | `stepTimeoutMs: 2000`; navigate `../aria-menu.html`; wait_for js `false` timeoutMs 10000 | exit 1, `step-timeout`, duration < 6 s |
| `long-wait.yaml` | navigate `../aria-menu.html`; wait_for js `false` timeoutMs 60000 | (browser killed) exit 2, `browser-disconnected` |
| `invalid-syntax.yaml` | `schemaVersion: 1\nname: x\nsteps:\n  - action: navigate\n    url: [unclosed` | exit 2, `scenario-invalid`, message contains `line` and `column` |
| `invalid-unknown-action.yaml` | a step `{action: clik, target: "#x"}` | exit 2, message contains `unknown action "clik" — allowed: navigate,` |
| `invalid-unknown-key.yaml` | a step `{action: click, selector: "#x"}` | exit 2, message contains `unknown key "selector" (did you mean "target"?)` and `missing required key "target"` |
| `invalid-relative-url.yaml` | a navigate `/x`, with no baseUrl | exit 2, message contains `no baseUrl is set` |
| `invalid-dialect-selector.yaml` | navigate `../aria-menu.html`; click `text=Archive Item` | exit 2, `scenario-invalid` (only if FR2-06 landed `InvalidSelectorError`; otherwise record the observed kind) |
| `not-a-scenario.txt` | any text | exit 2, `usage`, `unsupported scenario file extension ".txt"` |

---

## 4. Unit tests

### 4.0 The no-loosening rule

**No existing test or assertion may be changed, removed, skipped or loosened.** In particular:
- every FR2-07/08/11/12 test;
- `browser-tab-observability.spec.ts:153-154`;
- `parse-args.spec.ts`, `state.spec.ts`;
- `tools.spec.ts`'s exact tool list and count (unchanged: no tool is added).

FR2-11's `history-file.spec.ts` and `action-history.spec.ts` get **append-only** additions. If an existing test fails, the implementation is wrong.

### 4.1 `cli/tests/unit/scenario-schema.spec.ts` (new)

- **S1.** `new Ajv({allErrors:true, strict:true, allowUnionTypes:true}).compile(readJson('packages/cli/schemas/scenario.schema.json'))` doesn't throw. The same holds for the report schema with `strict:false` plus the formats from the MCP SDK validator.
- **S2.** `readJson(file)` deep-equals `SCENARIO_SCHEMA` (the runtime copy can't drift from the committed file).
- **S3.** `$id === 'urn:sutradhar:scenario:1'`, `$schema` is draft-07, and `properties.schemaVersion.const === SCENARIO_SCHEMA_VERSION`.
- **S4.** `definitions.step.properties.action.enum` equals `[...SCENARIO_STEP_ACTIONS]`. `definitions.step.allOf.length === 21`, and every `allOf[i].if.properties.action.const` is distinct and covers the enum.
- **S5 (cross-spec keys).**
  - `Object.keys(definitions.expect.properties).sort()` equals `Object.keys(EXPECT_KEYS).sort()`.
  - The `wait_for` properties minus `id`/`action` equal `Object.keys(WAIT_FOR_KEYS)`.
  - `definitions.extractField.properties` keys equal `Object.keys(EXTRACT_FIELD_KEYS)`.
  - `definitions.settle.properties` keys equal `Object.keys(DEFAULT_SETTLE_SPEC)` (FR2-08).
- **S6 (per-action keys).** For each action `a`, the properties of the referenced definition equal `Object.keys(SCENARIO_STEP_EXAMPLES[a])`, and every `required` key is present in the example.
- **S7.** `SCENARIO_EXAMPLE` is valid. Every committed `tools/scenario-suite/scenarios/**/*.{yaml,json}` parsed with `yaml`/`JSON` is valid (including the failing one: it's valid, it just fails at run time).
- **S8 (negative mutations, each invalid):**
  - `schemaVersion: 2`;
  - a missing `steps`;
  - `steps: []`;
  - a step without `action`;
  - `action: 'sleep'`;
  - click with `selector` instead of `target`;
  - `expect: {}`;
  - `expect: {textt:'x'}`;
  - `settle: 'yes'`;
  - `wait_for` with no condition key;
  - `wait_for` with `timeoutMs: 300001`;
  - `extract_data` with `fields: {}`;
  - a field name `__proto__`;
  - an assert with `{}`;
  - `url: '//evil.test/x'`;
  - `url: 'relative.html'` (no `./`);
  - `gates.maxConsoleErrors: -1`;
  - `stepTimeoutMs: 999`;
  - a top-level unknown key `timeout`.

### 4.2 `cli/tests/unit/load-scenario.spec.ts` (new, injectable fs, plus a real temp dir where noted)

- **L1.** The UC-14 YAML (read from the committed file) loads: `format 'yaml'`, `sha256` is 64 hex characters and equal to `createHash('sha256')` of the bytes, and `resolvedUrls.get(0)` is the `pathToFileURL` of `tools/scenario-suite/fixtures/aria-menu.html`.
- **L2.** The UC-14 JSON twin loads, and its `file` deep-equals L1's `file`.
- **L3.** A BOM-prefixed file loads identically.
- **L4.** `.txt` gives `ScenarioLoadError` with kind `usage` and the exact message from §2.1.3 step 1.
- **L5.** A missing file gives `usage`: `scenario file not found: <abs>`. A directory path gives `not a file:`.
- **L6.** A 1 MiB + 1 file gives `scenario-invalid`: `scenario file is 1048577 bytes; the maximum is 1048576`.
- **L7.** The `invalid-syntax.yaml` fixture gives a message matching `/is not valid YAML: .*line \d+, column \d+/s`.
- **L8.** Two YAML documents give `must contain exactly one YAML document (found 2)`.
- **L9.** Duplicate keys (`name: a\nname: b`) are rejected, and the message mentions uniqueness.
- **L10.** YAML `no`/`yes` values stay strings: a `type` value `no` passes the schema as the string `"no"`. That's the YAML 1.2 core schema.
- **L11.** An alias bomb (`a: &a [x,x,…]` nested 10 levels) is rejected with the `maxAliasCount` error, and the load returns within 1 s.
- **L12.** `formatAjvErrors`:
  - unknown key `selector` → exactly `steps[0] (click): unknown key "selector" (did you mean "target"?)`;
  - a missing `target` → `steps[0] (click): missing required key "target"`;
  - `action: clik` → a line starting `steps[0] (clik): unknown action "clik" — allowed: navigate, go_back,`;
  - no line contains `must match "then" schema`;
  - 15 errors → 10 lines plus `(+5 more)`.
- **L13 (semantic):**
  - a duplicate id gives the exact message;
  - an assert key not in fields gives the exact message;
  - `text === textGone` gives the FR2-08 wording;
  - a relative `/x` without a baseUrl gives the exact message;
  - with `baseUrlOverride` set, it resolves to `new URL('/x', override).href`;
  - a relative upload path that doesn't exist gives `file not found: <abs>`;
  - a `./missing.html` navigate gives `file not found:`.
  All errors are reported together: a file with 3 semantic errors produces a message containing all three.
- **L14.** `--base-url ftp://x` gives `usage` with the exact message.

### 4.3 `cli/tests/unit/gates.spec.ts` (new, pure; synthetic events with `now` injected)

- **G1.** Predicates:
  - `isConsoleError({logType:'error'})` is true, and `'warning'` is false;
  - `isBrokenResponse({status:404})` is true, `399` false, `500` true;
  - `isCountedNetworkFailure({errorText:'net::ERR_ABORTED'})` is false, and `'net::ERR_CONNECTION_REFUSED'` is true.
- **G2.** Events from another `sessionId` are ignored.
- **G3.** With `currentStepIndex` null → 2 → 3, three console errors carry `stepIndex` `[null, 2, 3]`.
- **G4.** `maxConsoleErrors:1` with 2 errors → `results.maxConsoleErrors 'fail'`, breach text `console errors: 2 (max 1)`. With 1 error → `'pass'`. Absent → `'off'`, and the count is still reported.
- **G5.** `failOnBrokenRequests` with one 404 response, one `ERR_ABORTED` failure and one refused failure → `brokenRequests 2`. `ignoreUrls` matching the 404's URL → `brokenRequests 1`, `ignoredRequests 1`.
- **G6.** 60 console errors → `toReport().consoleErrors.length === 50`, `truncated === true`, `counts.consoleErrors === 60`.
- **G7.** Sanitization: a console text containing `https://x.test/p?token=SECRET` gives report text without `SECRET`. A broken URL `http://h/a?t=S#f` becomes `http://h/a`. A 500-character text is capped at 300.
- **G8.** `subscribe(bus)` with a real `EventBus`: publishing each of the 4 types reaches `onEvent`, and after unsubscribe it doesn't.

### 4.4 `cli/tests/unit/classify.spec.ts` (new)

- **C1.** Every row of §2.6 maps to its kind and exit code. The inputs are:
  - an `Error('net::ERR_CONNECTION_REFUSED at http://127.0.0.1:1/')` with alive=true → `action-failed`, 1;
  - the same error with alive=false → `browser-disconnected`, 2;
  - an error named `InvalidSelectorError` → `scenario-invalid`;
  - `Error('Invalid selector for field "a": …')` → `scenario-invalid`;
  - `TypeError('wait_for: text and textGone are both "x" …')` → `scenario-invalid`;
  - `TypeError("Cannot read properties of undefined")` → `internal-error`;
  - `Error('Navigation to "https://x" was blocked: …')` → `navigation-blocked`;
  - `Error('a alert dialog is open ("hi") and blocks the page…')` → `dialog-blocked`;
  - `Error('Protocol error: Target closed')` with alive=true → still `browser-disconnected` (message rule);
  - a `BrowserNotAvailableError` → `browser-disconnected`.
- **C2.** Result classification:
  - a wait step `{success:false, error:'wait_for timed out after 500ms …'}` → `wait-failed`;
  - `{success:false, error:'wait_for blocked by an open alert dialog …'}` → `dialog-blocked`;
  - a click `{success:false}` → `action-failed`;
  - `{success:true, verification: tier 'contradicted' with an expect.text check fail}` plus an expect given → `expectation-failed`, with `expectFailed` equal to `['text']`;
  - an expect.text `not-run` check (tier `unverifiable`) → `expectation-failed` (the FR2-07 exit-4 parity rule);
  - `contradicted` with no expect → pass, plus a warning with the exact §2.6 text.
- **C3.** `exitCodeForKind` gives 1 for every assertion kind and 2 for every infra kind. It's exhaustive: a `switch` with a `never` check.

### 4.5 `cli/tests/unit/run-scenario.spec.ts` (new; `FakePort` records `[method, args]` and returns programmed results; fs in a real temp dir)

- **R1 (argument mapping).** For each action, a one-step scenario gives exactly one call with the §2.2 argument array. For example:
  - `click {target:'#a', expect:{text:'x'}}` → `['click', ['s1','#a',undefined,undefined,undefined,undefined,{text:'x'}]]`;
  - `wait_for {text:'x', timeoutMs:0}` → `['waitFor', ['s1',{text:'x',timeoutMs:0}]]`;
  - `extract_data {fields:{a:'#a'}}` → `['extractData', ['s1',{a:{selector:'#a'}},undefined,undefined]]` (no options argument, since `visibleOnly` is undefined).
  The exact arrays are **re-derived from the landed signatures** by the Executor, and the test pins them.
- **R2.** The launch sequence is `launch({headless:true})` then `setViewport('s1',{width:1280,height:800})`. `--headed` gives `headless:false`. `browser.viewport` in the file is used unless `--viewport` is given (D18).
- **R3.** `launch` returns `hasRealBrowser:false` → the report has `browser-launch`, exit 2, `shutdown('s1')` was called, and no step was called.
- **R4.** `launch` throws → `browser-launch`, exit 2, and no `shutdown` for a non-existent session.
- **R5 (stop at first failure).** Three steps, the second `{success:false}`:
  - statuses `['passed','failed','skipped']`;
  - totals `{steps:3, passed:1, failed:1, error:0, skipped:1}`;
  - the third step isn't called;
  - `shutdown` is called exactly once.
- **R6 (failure screenshot).**
  - `result.failureScreenshot` = a real 4×3 PNG base64 → a file at `screenshots/step-02-click-failure.png` whose bytes equal the decoded input, and `port.screenshot` is **not** called.
  - Without one → `port.screenshot('s1', undefined, false)` is called once.
  - A pending dialog → no capture, and `screenshotSkippedReason` is `a alert dialog is open, which blocks capture`.
  - A screenshot that never resolves → skipped after about 5000 ms (fake timers), with reason `the capture did not complete within 5000ms`.
- **R7 (step timeout).** With fake timers, `stepTimeoutMs:2000` and a `waitFor` that never resolves → kind `step-timeout`, exit 1 (the fake reports alive), no unhandled rejection (the `bounded` no-op catch), and `shutdown` is called.
- **R8 (browser gone).** The step throws `Protocol error: Target closed` and the fake reports `isConnected()` false → `browser-disconnected`, exit 2, step status `error`, no screenshot attempted (reason `the browser is not connected`), and the report is still written.
- **R9 (gates after a step).** The fake bus publishes a console error while step 1 runs, and `maxConsoleErrors:0` → the failure is `gate-failed` with `stepIndex 1`, step 1's status is `passed`, step 2 is skipped, and the screenshot is `step-01-gate-failure.png`.
- **R10 (history lines).**
  - The fake `getActionHistoryReport` returns a growing ring (seq 1..3 after step 1, 4..5 after step 2).
  - `history.jsonl` has 2 lines, `JSON.parse`d as `{v:1, type:'scenario-step', stepIndex:1, …}`, with `actions.map(a=>a.seq)` equal to `[1,2,3]` and then `[4,5]`.
  - A `type` step's `summary` is `type #pw <12 chars>`, and the raw value appears nowhere in the file.
  - A skipped step has no line.
  - The file is truncated at start: pre-seeding it with junk leaves only this run's lines.
- **R11 (extract).**
  - Observed `{a:['1','2']}` with assert `{a:{count:1}}` → `extract-mismatch`, the details line is `a: expected 1 match(es), got 2`, and `observed` equals `['1','2']`.
  - A passing field has `observed: null`.
  - 30 values → `observed` has length 20.
- **R12 (warnings).** A wait_for with `output.presentAtStart:false` and tier `unverifiable` → the exact warning text. A wait_for_selector hidden vacuous result → the exact warning.
- **R13 (SIGINT).** Emit `SIGINT` during a pending step → `interrupted`, exit 2, and `shutdown` called. The listener count on `process` for `SIGINT` returns to its pre-run value.
- **R14 (shutdown is bounded).** A `shutdown` that never resolves → the run still returns within about 10 s (fake timers), and the warning `browser shutdown did not complete within 10000ms` is present.
- **R15 (audit step).** The fake `audit` resolves a FR2-12-shaped `AuditResult` with a real PNG. `writeAuditArtifacts` is the real function, writing to `audit/step-01/`. `steps[0].audit.reportPath` exists and parses as JSON, and `consoleErrors` equals the result's length.
- **R16 (upload path).** A relative `filePath` is passed to `uploadFile` as the absolute resolved path.

### 4.6 `cli/tests/unit/scenario-report.spec.ts` (new)

- **P1.** `readJson(report schema)` has `$id === 'urn:sutradhar:scenario-run-report:1'` and `properties.schemaVersion.const === 1`.
- **P2 (drift keys, FR2-12 D5 style).** At every object level (the root, `scenario`, `environment`, `totals`, `steps.items`, `extract.fields.*`, `audit`, `gates`, `gates.config/counts/results`, the three entry arrays, `failure`, `verification`, `evidence`, `checks.items`), the schema `properties` keys equal the keys of `SCENARIO_RUN_REPORT_EXAMPLE` at that path, and `required` equals them too, except `checks.items` (`expected`/`observed`/`detail` are optional, as in FR2-07).
- **P3.** Validated with `AjvJsonSchemaValidator` (from `@modelcontextprotocol/sdk/validation/ajv`, formats on):
  - `SCENARIO_RUN_REPORT_EXAMPLE` is valid;
  - each report produced by R3, R5, R8, R9 and R11 is valid;
  - the pre-output-dir `--json` error report (`outDir:null`, `gates:null`, `steps:[]`) is valid.
- **P4 (negative mutations, each invalid):**
  - an extra `screenshotBase64` key at the root;
  - `exitCode: 3`;
  - `status: 'ok'`;
  - `failure.kind: 'boom'`;
  - `steps[0].status: 'done'`;
  - `gates.brokenRequests[0].status: 200`;
  - `runId: 'x'`;
  - `verification.evidence.tier: 'maybe'`;
  - `steps[0].summary` of 201 characters.
- **P5.** `JSON.stringify(report)` for R6's report contains no substring of the PNG base64 and no `iVBORw0KGgo`.
- **P6.** `formatRunHuman(report)`: the exact line list for the §3.6 failing report (using §2.5.5's templates), and the exact lines for a passing report, including `Result: PASSED (exit 0)`.
- **P7.** `writeReportAtomic` writes `report.json`, leaves no `report.json.tmp` behind, and overwrites an existing `report.json`.
- **P8.** `newRunId(new Date('2026-09-25T10:00:03Z'), () => 'abcd')` returns `run-20260925T100003Z-abcd`.
- **P9.** `prepareRunOutDir`:
  - a nested non-existent dir is created, and an absolute path is returned;
  - a path that is an existing file rejects with `Cannot create run output directory "<abs>": <code>` (the FR2-12 `prepareAuditOutDir` wording pattern).

### 4.7 Other packages (append or new)

- **FM1-FM4** (`capability-runtime/tests/unit/field-map.spec.ts`, new):
  - `normalizeExtractFieldMap({a:'#a', b:{selector:'#b', attribute:'attr:href', visibleOnly:true}})` deep-equals `{a:{selector:'#a'}, b:{selector:'#b', attribute:'attr:href', visibleOnly:true}}`;
  - `{}` throws the exact message, and so does `{a:''}`, and `{a:{selector:'#a', attr:'x'}}` (unknown key);
  - a key order is preserved;
  - the input isn't mutated.
- **HF1-HF3** (`cli/tests/unit/history-file.spec.ts`, append):
  - `buildScenarioStepHistoryLine` sets `v:1, type:'scenario-step'`;
  - a line with 2000 large actions hits the 64 KiB guard: `truncated:true`, `actions:[]`, `actionsOmitted:2000`, and `Buffer.byteLength(JSON.stringify(line)) < 65536`;
  - `appendHistoryLine(file, scenarioLine)` appends one line;
  - `readHistoryFile` returns it;
  - `formatHistoryHuman` renders it as `… (scenario-step line — see the run's report.json)`, and FR2-11's existing `command`-line output is byte-identical.
- **BT1-BT2** (`browser-tab-observability.spec.ts`, append):
  - fire the mock page's `requestfailed` handler with `{url:()=>'http://h/x', method:()=>'GET', resourceType:()=>'fetch', failure:()=>({errorText:'net::ERR_CONNECTION_REFUSED'})}` → `getNetworkLog()` ends with `toMatchObject({phase:'failed', url:'http://h/x', errorText:'net::ERR_CONNECTION_REFUSED'})`, and the event bus spy got `('browser:network:failed', {sessionId, tabId, url:'http://h/x', errorText:'net::ERR_CONNECTION_REFUSED'}, …)`;
  - `failure()` returning `null` gives `errorText: 'unknown'`;
  - the existing 200 cap still holds with failed entries mixed in.
- **AH1** (`action-history.spec.ts`, append): for FR2-11's H6 inputs, `sanitizeVerification(v)` deep-equals `sanitizeHistoryEntry({…, verification: v}).verification`. FR2-11's H6 passes unchanged.
- **PA1-PA4** (`parse-args.spec.ts`, append):
  - `['run','a.yaml','--out','o','--base-url','http://x']` → `cleanArgs ['a.yaml']`, `outFlag 'o'`, `baseUrlFlag 'http://x'`, `presentFlags ['--out','--base-url']`;
  - `--out` last → `outFlagGivenButInvalid`;
  - `--out --json` → invalid, and `jsonMode` is still true;
  - `presentFlags` for `['click','7','--settle','--headed']` is `['--settle','--headed']`;
  - existing fields are unchanged for existing argument vectors.

---

## 5. Live-verify script: `tools/scenario-suite/verify-fr2-13-scenario-runner.mjs`

**Setup:**
- `CLI = packages/cli/dist/cli.js` and `BUNDLE = packages/sutradhar/dist/cli-bin.js`, both from this worktree.
- `scratch = os.tmpdir()/sutradhar-fr2-13-<ts>`.
- Every run is `spawn(process.execPath, [CLI, 'run', file, '--out', <scratch>/<case>, ...extra])` with `env.SUTRADHAR_CLI_STATE_DIR = <scratch>/state`. That env var is used to prove `run` never creates CLI state.
- Start FR2-12's `startAuditFixtureServer()` and FR2-13's `startFr213Server()`.
- Load the report validator with `createRequire(packages/mcp-server/package.json)('@modelcontextprotocol/sdk/validation/ajv')` (the FR2-12 technique).
- Record `baselineChrome = countChrome()`, the count of Chrome processes whose command line contains `puppeteer_dev_chrome_profile` (the verify-fr2-01 helper pattern; GAP-005 notes the duplication).

**Common assertions for every run** (`checkRun`):
- The exit code is as expected.
- In `--json` runs, stdout parses as **one** JSON document that validates and deep-equals `<out>/report.json`.
- `report.exitCode` equals the process exit code.
- `report.outDir` equals `path.resolve(<out>)`.
- Every path in the report (`historyPath`, `screenshotPath`s, `audit.reportPath`) is absolute, inside `outDir`, and exists.
- The report text has no `iVBORw0KGgo`.
- `<scratch>/state/state.json` does **not** exist.

Output goes to `.ai/loop/field-report-2/evidence/FR2-13/live/results.jsonl` (one line per case, `{id, pass, expected, observed, ms}`), plus copies of each `report.json` (text, committed). PNGs stay in scratch.

| Case | Run | Assertions |
|---|---|---|
| **L1** | `scenarios/uc-14-aria-menu.yaml --json` | exit 0; `status passed`; 6 steps passed; gates all `pass` with counts 0; `history.jsonl` has 6 lines (`v:1, type:'scenario-step'`, stepIndex 1..6); step 5's line has an `actions` entry whose `actionType` is `'click_by_role'`; step 4's verification tier is `verified`; **no** `screenshots/` files; `warnings` is `[]` |
| **L2** | `scenarios/uc-14-aria-menu.json --json` | the same as L1: equal `steps.map(s=>[s.action,s.status])` and the same `scenario.name`; `format 'json'` |
| **L3** | `scenarios/uc-10-prompt-injection.yaml --json` | exit 0; step 3's `extract.fields` counts are `injected 1`, `injectedVisible 0`, `ticket 1`; all passed; gates pass |
| **L4** | `scenarios/uc-06-modal-and-dynamic-content.yaml --json` | exit 0; step 7 (`wait_for`) `durationMs` > 0 and it passed; step 4 (`wait_for_selector hidden`) verification tier `verified` (not vacuous); no warnings |
| **L5** | `scenarios/failing/uc-14-wrong-expectation.yaml --json` | exit **1**; the full §3.6 diagnosis contract; `failure.screenshotPath` is a PNG (signature and IHDR via `pngDimensions`), size > 0 |
| **L6** | `scenarios/uc-05-saucedemo-checkout.yaml --json` | exit 0; 21 steps passed; step 19 (`totals-add-up`) passed; the report and `history.jsonl` contain **neither** `secret_sauce` **nor** `standard_user`, and the step 2 and 3 summaries end `<12 chars>` / `<13 chars>` (the secret canary, D16) |
| **L7** | L1 again without `--json` | stdout contains `Result: PASSED (exit 0)`, `[6/6] extract_data result ... ok`, and `Report: <abs>` |
| **L8** | `fixtures/fr2-13/gates-fail.yaml --base-url <FR2-12 origin> --json` | exit 1; `gate-failed`, `stepIndex 2`; counts are `consoleErrors >= 1`, `pageErrors >= 1`, `brokenRequests >= 2`; entries include text `fr2-12-console-13`, message `fr2-12-pageerror-13`, `…/missing-13.png` with status 404 and `…/api/fail-13` with 500; details start `console errors:`; screenshot `step-02-gate-failure.png` exists |
| **L9** | `gates-clean.yaml --base-url …` | exit 0, all counts 0. **If a favicon or other unexpected 404 appears, record it as a finding** (it isn't masked) |
| **L10** | `gates-ignored.yaml --base-url …` | exit 0; `ignoredRequests >= 2`; `brokenRequests 0` |
| **L11** | `request-failed.yaml --base-url <FR2-13 origin>` | exit 1; `gate-failed`; one broken entry with `status:null` and `errorText` matching `/ERR_CONNECTION_REFUSED/` (the GAP-062 proof) |
| **L12** | `request-aborted.yaml --base-url <FR2-13 origin>` | exit 0; `brokenRequests 0` (the ERR_ABORTED exclusion) |
| **L13** | `action-failed.yaml` | exit 1; `action-failed`, step 1; `steps[0].error` matches `/ERR_CONNECTION_REFUSED/` |
| **L14** | `wait-failed.yaml` | exit 1; `wait-failed`; `steps[1].error` starts `wait_for timed out after 500ms` (FR2-08 `formatConditionFailure`) |
| **L15** | `extract-mismatch.yaml` | exit 1; `extract-mismatch`; `observed[0]` contains `Order number is SD-88213` |
| **L16** | `step-timeout.yaml` | exit 1; `step-timeout`; the process exits within 15 s of spawn |
| **L17** | `long-wait.yaml`, spawned async | poll every 200 ms, bounded to 30 s, until a Chrome process whose `ParentProcessId` is the CLI child's PID exists (PowerShell `Get-CimInstance Win32_Process`, or `ps -o ppid` on POSIX); kill it; then exit **2**, `browser-disconnected`, step 2 `error`, the report written, no screenshot (reason `the browser is not connected`) |
| **L18** | the invalid fixtures (syntax, unknown action, unknown key, relative url, `.txt`) with `--json` | each exits 2 with the §3.7 message; stdout is one valid report with `outDir: null` or `gates: null` and `failure.kind` of `scenario-invalid` or `usage`; each finishes in < 3 s; the `countChrome()` delta is 0 (no browser launched) |
| **L19** | `invalid-dialect-selector.yaml` | exit 2, `scenario-invalid`, if FR2-06 is present; otherwise record the observed kind (the Orchestrator decides) |
| **L20** | L1 with `--settle` | exit 2, `usage`, message `flag --settle does not apply to "run" …`. L1 with `--bogus`: exit 2 |
| **L21** | L1 with `--out <existing regular file>` | exit 2, `output-error`, < 3 s, no Chrome launched |
| **L22** | L1 with env `CHROME_PATH=process.execPath` | exit 2, `browser-launch`, `steps: []`; **no lingering mock or real session** (count delta 0) |
| **L23** | `node <BUNDLE> run scenarios/uc-14-aria-menu.yaml --json` | exit 0 and the same step statuses as L1. This proves the `yaml` and `ajv` inlining in the published bundle |
| **L24** | `node <CLI> nav <fixture> --out x` | exit **1** with `--out and --base-url are only valid with "run"` (other verbs unchanged). Then `node <CLI> close` |
| **L25** | Startup cost | the median of 5 `node <CLI> doctor` wall times before (from `evidence/baseline`, or `git stash`-free: a pre-change build of `dist` kept in scratch) versus after. **Recorded**, and flagged in the report if the delta is > 100 ms (no hard assertion; R7) |
| **L26** | Cleanup | after all cases, `countChrome() === baselineChrome`, no `puppeteer_dev_chrome_profile-*` dirs newer than the run start in `os.tmpdir()`, and servers closed |

**External cases** (L4 and L6) are retried once. If both attempts fail with a navigation error or a site-structure mismatch (evidence in the report), the case is recorded as `external-blocked` and the Orchestrator is told. The Executor **does not** swap in UC-12 on its own (R10).

The script's exit code is 0 only if every non-`external-blocked` case passes. Raw stdout and stderr of every run go to `evidence/FR2-13/live/raw/<case>.{out,err}.txt`.

---

## 6. Negative cases

| # | Input | Expected |
|---|---|---|
| N1 | Unknown flag / a flag from another verb / missing path / two paths | exit 2 `usage`, no browser (L18, L20) |
| N2 | Missing file, directory, `.txt`, > 1 MiB | exit 2 (L4-L6, L18) |
| N3 | YAML syntax error, multi-document, duplicate keys, alias bomb | exit 2, messages with position (L7-L11) |
| N4 | Schema violations (§4.1 S8 list) | exit 2, precise per-path messages, never `must match "then" schema` |
| N5 | Semantic: duplicate id, bad assert key, `text === textGone`, baseUrl-relative without a base, missing upload file | exit 2, all errors listed together (L13) |
| N6 | `--out` is a file, or isn't writable | exit 2 `output-error` before launch (L21) |
| N7 | No Chrome, or Chrome fails to launch (mock fallback) | exit 2 `browser-launch`, mock session shut down (R3, L22) |
| N8 | Browser killed mid-step | exit 2 `browser-disconnected`, report written (R8, L17) |
| N9 | Navigation blocked by `--allowlist-domains` | exit 2 `navigation-blocked` (C1). Live: L1's file URL is allowed (file: always passes), so run UC-06 with `--allowlist-domains example.com` → exit 2 |
| N10 | Playwright-dialect selector | exit 2 `scenario-invalid` (L19) |
| N11 | Click on a missing element | exit 1 `action-failed` after the engine's retries (R8 of §7.3: slow, but bounded by `stepTimeoutMs`) |
| N12 | An expect whose text appears 800 ms later | exit 1 `expectation-failed`. Documented as "expect checks once" (FR2-07 X3). The fix is a `wait_for` step |
| N13 | A step whose built-in check is contradicted, with no expect | exit 0 plus a warning (§2.6) |
| N14 | `wait_for textGone` never present / `wait_for_selector hidden` never matched | exit 0 plus a warning. It's vacuous, as FR2-08 D4 and FR2-07 D14 surface it |
| N15 | The same mutating step repeated within 1 s | exit 1 `action-failed` with the engine's "Duplicate …" message (R8 below) |
| N16 | `ERR_ABORTED` request | not counted (L12) |
| N17 | Console or page errors in a closed popup tab | counted (the event bus, not the ring). Unit G8 only |
| N18 | SIGINT | exit 2 `interrupted`, browser shut down (R13). Windows can't deliver SIGINT via `child.kill` → unit test only |
| N19 | Secrets in `type` values, or URL query tokens | never in the report or history (L6, G7, R10) |
| N20 | Report write fails (the out dir deleted mid-run) | exit 2 `output-error`, stderr message; the in-memory report is still printed to stdout in `--json` mode |

---

## 7. Risks

### 7.1 Dependency status at planning time (HEAD `45e7b79`, `ledger.md`)

| Item | Ledger status | What this spec consumes | Blocking? |
|---|---|---|---|
| FR2-07 | **SPEC** (not developed) | `ActionExpectation`, the trailing `expect` params, `failedExpectations`, `VerificationResultDto.evidence` | **Hard, blocks DEVELOP** |
| FR2-08 | **SPEC** | `runtime.waitFor`, `WaitForCondition`, `describePageCondition`, `formatConditionFailure`, `SettleSpec`/`DEFAULT_SETTLE_SPEC`, `settle` params | **Hard** |
| FR2-11 | **SPEC** | `getActionHistoryReport`, `SessionActionHistoryEntry.seq`, `history-file.ts` (`CliHistoryLineV1`, the guard, `appendHistoryLine`), the sanitizers | **Hard** |
| FR2-12 | **SPEC** (Step 0 still to run) | the schema convention and `DeepRequired`, `runtime.audit`, `writeAuditArtifacts`, `pngDimensions`, the `fr2-12-audit-server.mjs` fixture | **Hard** |
| FR2-02 | SPEC | the live `.value` and `visibleOnly` extract semantics (UC-05 step 17, UC-10, UC-06 step 8) | Hard in practice for the ports |
| FR2-06 | SPEC | `InvalidSelectorError` classification | Soft (L19 records the result) |
| FR2-04 / FR2-05 / FR2-10 | SPEC | none required | No |

**Nothing this item depends on is DONE, and FR2-01 is still at FIX(3).** DEVELOP can't start. The spec is written so that it starts unchanged once they land:
- every shape is referenced by symbol;
- the positional call forms are re-derived by the Executor, with R1 pinning them;
- the cross-spec key maps (§2.1.4) make any rename a `tsc` error instead of a silent drift.

**Executor precondition greps** (it stops if any finds nothing):
```
grep -n "export function failedExpectations" packages/capability-runtime/src/types.ts
grep -n "readonly evidence: VerificationEvidence" packages/browser/src/actions/action-types.ts
grep -n "public async waitFor(" packages/capability-runtime/src/runtime.ts
grep -n "export function formatConditionFailure" packages/browser/src/actions/condition-wait.ts
grep -n "export const DEFAULT_SETTLE_SPEC" packages/browser/src/actions/page-settle.ts
grep -n "getActionHistoryReport" packages/capability-runtime/src/runtime.ts
grep -n "export interface CliHistoryLineV1" packages/cli/src/history-file.ts
grep -n "export function sanitizeHistoryEntry" packages/browser/src/session/action-history.ts
ls packages/capability-runtime/schemas/audit-report.schema.json
grep -n "export async function writeAuditArtifacts" packages/capability-runtime/src/audit/audit-report.ts
ls tools/scenario-suite/fixtures/fr2-12-audit-server.mjs
grep -n "ExtractDataOptions" packages/capability-runtime/src/types.ts
```

**What could be built early, only if the Orchestrator explicitly chooses to:** the new-files-only modules (`load-scenario.ts`, the two schema files, `gates.ts`, `classify.ts`, `field-map.ts`) have no code dependency on those items. Everything else touches files they own. The default is strict sequencing.

### 7.2 False-pass risks (the hard rule)

1. **Gate undercount.** The bus covers ring eviction and closed tabs (D5). Remaining holes:
   - (a) a popup's events before adoption;
   - (b) events that arrive after the last step's gate check;
   - (c) a page that suppresses its own console.

   (a) and (b) are documented in the help and README, with the advice to "end with a `wait_for` if late errors matter". None of them can cause a false **fail**.
2. **`expect` checks once.** An effect that lands late gives a false *fail*, never a false pass (FR2-07 X3).
3. **Contradicted verification without `expect` passes the run.** That's deliberate FR2-07 D5 parity. It is always surfaced as a warning in the report and the human output. A "strict verification" scenario option is logged as GAP-new-7.
4. **`extract` `contains` is a substring match.** `"Saved"` matches `"Unsaved"`. It's documented, and `equals` is the exact alternative.
5. **`wait_for js` runs in the page's main world**, so a hostile page can lie (FR2-08 D6). Scenario authors test their own apps. It's documented.
6. **Event attribution to steps is approximate** (async delivery). It affects only `stepIndex` labelling, never counts.

### 7.3 Other risks

- **R1 Bundle size and startup.** `yaml` (~100 KB) and `ajv` (~120 KB) are inlined into `cli-bin.js`, and module evaluation affects every verb's startup. L25 records the delta. If it's over 100 ms, the Executor switches to `await import()` inside `cmdRun` (esbuild keeps one file, but evaluation becomes lazy) and records it.
- **R2 ajv strict mode** rejects a schema construct it considers ambiguous. S1 fails at build time, not for users.
- **R3 YAML semantics** (1.2 core: `no` is a string, `0o17` is octal). This is documented in the schema description, and L10 pins it.
- **R4 Windows paths.** Report paths are backslash-escaped JSON (FR2-12 D2.3). `pathToFileURL` handles drive letters. L1 asserts `resolvedUrls` on Windows.
- **R5 Popup coverage caveat** (§7.2.1a).
- **R6 `--out` reuse.** `report.json` and `history.jsonl` are overwritten, but stale screenshots from a previous run in the same dir remain, unreferenced. The report only references this run's files. It's documented, not deleted (no deletion outside our own files).
- **R7 Exit-code semantics differ from other verbs.** For `run`, 1 means an assertion failure and 4 isn't used. For action verbs, 1 means the action failed and 4 means an expectation failed. It's documented in the help and README as "for `run`".
- **R8 Engine retries and the duplicate guard.** A missing element on `click` costs up to about 3 × 15 s (GAP-001 class) before `action-failed`. The default `stepTimeoutMs` of 120 s covers it, and the ports use 60 s. Repeating an identical mutating step within 1 s trips the guard (T16). It's documented.
- **R9 GAP-062's new `phase:'failed'` entries** appear in `browser.get_network_log` output. That's additive, audit ignores them, and the MCP description is updated (or the change is dropped if a test pins the text).
- **R10 External sites** (the-internet, saucedemo) can block, go down or change markup. L4 and L6 retry once, then record `external-blocked`. The UC-12 alternate exists, but **the substitution is an Orchestrator decision**, recorded in `decisions.md`, never automatic. The Done-when's "≥4 ported and passing" must be evidenced by a real pass.
- **R11 GAP-037 is only partly closed.** The four ported UCs have sleep-free scenario files. The driver sleeps (T3) remain, because the drivers measure three surfaces and ci-gate reads their results. GAP-037 is updated to list the remaining lines.
- **R12 Composing four unlanded specs.** Any divergence at landing time (a renamed field, a changed positional order) is caught by `tsc` (the §2.1.4 key maps and the `DeepRequired` examples), by R1, and by S5.

### 7.4 Gaps to log (new) and the changelog fragment

**New gaps** (minor unless noted):
- **GAP-new-1:** no multi-file or directory `run` (D14).
- **GAP-new-2:** no `${env:VAR}` interpolation for secrets or credentials in scenario files.
- **GAP-new-3:** no `handle_dialog`/`route`/`eval`/`download_file`/`drag`/`fill_form`/`touch_tap`/tab-switch steps. The `action` field collision is noted for `handle_dialog`/`route`.
- **GAP-new-4:** the directory `history.jsonl` has no trace of runs (D8).
- **GAP-new-5:** no audit-threshold gate (for example `maxAccessibilityIssues`).
- **GAP-new-6:** no SDK `runScenario()`.
- **GAP-new-7:** no opt-in "strict verification" (fail on contradicted without `expect`).
- **GAP-new-8:** `--profile` isn't supported by `run`.

**Updated gaps:**
- **GAP-004:** syntax designed (D15); CLI/SDK implementation TODO.
- **GAP-037:** partial; the remaining lines are listed.
- **GAP-062:** runner gates count failed requests; audit still doesn't.

**Changelog fragment:**
- new `run` verb, exit codes, the two schemas;
- `yaml` (ISC) and `ajv` (MIT) inlined into the CLI bundle;
- `browser:network:failed` event and the `phase:'failed'` network-log entries;
- `--out`/`--base-url` rejected on other verbs.

---

## 8. Rollback

`git revert <FR2-13 commit>` removes every §1 file and addition. There's no persisted state format other than per-run output dirs, which are user artifacts and aren't touched.

**Partial rollback along independent seams:**
- (a) Revert only D6 (the `requestfailed` listener and the event). The runner still builds, because the collector subscribes to an event type that never fires. Then L11 fails, so mark GAP-062 open again.
- (b) Revert only the `audit` step (the schema enum, its definition, the example and the mapping). This needs a schema bump or re-release note, since it's a shape change.
- (c) Revert `run` entirely while keeping `normalizeExtractFieldMap` (harmless and unused).

**Revert order:** FR2-13 **before** FR2-07/08/11/12 if any of those is reverted, because this item imports their symbols. Otherwise the build fails loudly, which is the safe direction.

**Afterwards:** add a `decisions.md` entry, set the ledger to TODO/BLOCKED with a diagnosis, restore the GAP-004/037/062 text, and delete `changelog-fragment.md`. `.gitignore`'s `.sutradhar-runs/` line can stay.

---

### Critical Files for Implementation
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\cli.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\parse-args.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\capability-runtime\src\runtime.ts (read-only reference for the post-FR2-07/08/11/12 signatures the runner calls)
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\session\browser-tab.ts (the `requestfailed` listener, event publishing)
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\tools\scenario-suite\run-sdk.mjs (the in-process launch/viewport/shutdown pattern and the UC ground truth being ported)