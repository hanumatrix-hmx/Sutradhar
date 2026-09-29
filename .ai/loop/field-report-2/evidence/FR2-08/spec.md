# FR2-08: Condition waits and settle everywhere, implementation spec

**Item:** FR2-08 (Phase 2, agent ergonomics). It adds a real "wait until X is true" primitive (`wait_for`), extends the existing opt-in `settle` to every tool that interacts with or navigates the page, and documents the pattern. Sleeping to wait for a page is the anti-pattern this item removes.

**Base:** HEAD `6ce4e18` on `claude/field-report-2-loop`. At this commit only FR2-01's code has landed (at AUDIT(2)). FR2-02 through FR2-07 exist only as specs. The line numbers below were read at `6ce4e18`. FR2-02 through FR2-07 all touch files this item touches, so **the Executor anchors by symbol name, not by line number.**

**Decisions in force:**
- §4.3: FR2-01's visibility rule, `wait_for_selector` default `visible`.
- §4.8: verification honesty.
- §4.9: additive, smallest diff, consistent with the surrounding code.
- FR2-04 D-1: nothing page-observable that disguises a page primitive.
- FR2-06 D1: Playwright-dialect detection applies to *selectors* only.
- FR2-07 D4/D5/D6: `expect` is a one-shot post-action check and never changes `success`. `expect.text` is visible text.

**Hard preconditions:** FR2-07 must be DONE before this item's DEVELOP starts. It is a hard precondition for two reasons:
- **Shared files:** the engine, `runtime.ts`, `tools.ts`, `cli.ts`, `page.ts` and `types.ts` all overlap.
- **Shared code:** this item's `text`/`textGone` probe **is** FR2-07's visible-text check (§2.2), and its result carries FR2-07's `verification` contract.

The Executor stops and reports if `grep -n "pageContainsVisibleText\|visibleTextContainsInPage" packages/browser/src/verifier/*.ts` finds nothing. FR2-04 (dialog policy, exit code 3, `cmdDialog`) and FR2-05 (`page.download`/`page.uploadFile`) are used **when present**, with the fallbacks described inline.

**Versioning:** no version bump. The item writes `evidence/FR2-08/changelog-fragment.md` (§7.3).

---

## 0. Trace results (grounded at `6ce4e18`)

### 0.1 The current `settle` implementation

| # | Finding | Evidence |
|---|---|---|
| T1 | `ActionParams.settle?: boolean \| SettleSpec`. `SettleSpec = {mutationQuietMs?, networkIdleMs?, timeoutMs?}`. The doc says "not an error if reached". | `action-types.ts:87-98`, `:103-113` |
| T2 | `DEFAULT_SETTLE_SPEC = {mutationQuietMs:300, networkIdleMs:500, timeoutMs:5000}`. | `browser-action-engine.ts:106-110` |
| T3 | **Settle is already generic in the engine.** In `executeActionSerialized`'s success path, after the dispatch race and before `verifyAction`: `if (params.settle && tab.page) { spec = true ? DEFAULT : {...DEFAULT, ...settle}; await this.waitForSettle(tab.page, spec) }`. **Any** `ActionType` that receives `params.settle` gets it. It runs only on success, never on the failure path. | `:275-278` |
| T4 | The `waitForSettle(page, spec)` algorithm: (a) `page.evaluate(fn, mutationQuietMs, timeoutMs)`, where `fn` installs a `MutationObserver` on `document.body` (childList, subtree, attributes, characterData). Each mutation re-arms a `setTimeout(done, quietMs)`, a quiet timer starts immediately, and an in-page `setTimeout(done, boundMs)` is the absolute bound. It has `.catch(()=>{})`. (b) `page.waitForNetworkIdle({idleTime: networkIdleMs, timeout: timeoutMs})` with `.catch(()=>{})`. (c) `await Promise.all([a, b])`. | `:1620-1649` |
| T5 | **A real, pre-existing defect found while tracing:** `waitForSettle` has **no Node-side bound**. Every one of its bounds is an in-page timer or a Puppeteer timeout that only starts once the evaluate is running. When a native dialog is open, `page.evaluate` does not run until the dialog closes. A `click` with `settle:true` that opens an `alert` therefore blocks until the tab's 30 s auto-dismiss (`browser-tab.ts` `DEFAULT_DIALOG_TIMEOUT_MS = 30000`). In a background tab, the in-page timers are also clamped to about 1 s granularity. It is fixed in this item (§2.3) because this item owns the function. | `:1620-1649`, `browser-tab.ts:30` |
| T6 | **Settle cannot see a pending timer.** A page that runs `setTimeout(showToast, 2000)` and does nothing else is "DOM-quiet" and "network-idle" 300–500 ms after the action. Settle returns before the toast. This is the exact case the Done-when fixture targets, and the reason `wait_for` exists as a different primitive (§3, case L1b proves it live). | T4 algorithm |
| T7 | Engine tests pin the settle call shape. `page.evaluate` is called **exactly once**, with `(fn, 300, 5000)` or `(fn, 100, 5000)`. `waitForNetworkIdle` gets `{idleTime:500, timeout:5000}`. Neither is called without settle. A settle that fails or times out never fails the action. | `browser-action-engine.spec.ts:1880-1970` |

### 0.2 Where `settle` is reachable today (exactly click, type and scroll)

| Surface | click | type | scroll | Everything else |
|---|---|---|---|---|
| Runtime | `click(sid,target,tabId?,modifiers?,offset?,settle?)` `runtime.ts:470-491` | `type(sid,target,value,tabId?,settle?)` `:587-602` | `scroll(sid,dir,amount,tabId?,target?,settle?)` `:642-668` | none of the other 25 action methods takes `settle` (`focus :503`, `clickAtPoint :514`, `dragAtPoints :552`, `fillForm :611`, `pressKey :632`, `hover :672`, `selectOption :682`, `selectOptions :696`, `clickByText :728`, `clickByRole :733`, `typeByLabel :743`, `uploadFile :753`, `clickWithButton :767`, `dragAndDrop :781`, `touchTap :799`, `downloadFile :811`, `navigate :377`, `goBack :389`, `goForward :396`, `reload :403`, `uploadFileViaTrigger :1344`, `handleDialog :1502`) |
| MCP | `settle: settleSchema` `tools.ts:459,464` | `:531,536` | `:607,612` | `settleSchema` (`:430-440`) is used by no other tool |
| CLI | `--settle` boolean (`parse-args.ts:93`) → `cmdClick` `cli.ts:312` | `cmdType :339` | `cmdScroll :503` | Help text at `cli.ts:923-926` names only these three. The flag is silently ignored on every other verb. |
| SDK | `ElementOptions.settle` → `page.click` `page.ts:105-107` | `page.type :110-112` | **not wired**: `page.scroll(direction, amount)` `:141-146` has no options | `goto :87-90`, `press :136-138`: no settle |

**The finding is confirmed** with one correction: the SDK has settle on click and type only. It does not have it on scroll.

### 0.3 Condition waits today

| # | Finding | Evidence |
|---|---|---|
| T8 | No text, URL or JS wait exists on any surface. `wait_for_selector` waits for **element state** only (FR2-01). | `tools.ts:685-721`, `runtime.ts:713-725` |
| T9 | Engine `ActionType 'wait'` is a fixed `setTimeout` (`:675-679`). No public tool exposes it. Its only caller is `agent-loop.ts:568` (`milliseconds: 0`). | grep |
| T10 | `runtime.audit` sleeps `settleMs ?? 1500` (`:1431`). `compareUrls` sleeps `settleMs ?? 500` twice (`:1485`, `:1489`). Both are fixed sleeps. They're **out of scope** here (FR2-12 owns audit), logged as a gap (§7.2). | `runtime.ts` |
| T11 | `AGENT_SETUP.md` has no waiting guidance. Its only mention is `--settle` "for `click`/`type`/`scroll`" (`:114-115`). The tool count reads "68" (`:60`). | |
| T12 | GAP-002: `tools/scenario-suite/run-cli.mjs:152` and `:437` say "CLI has no `wait` command" and use `sleep(2500)` / `sleep(6000)`. `cmdWait` exists (`cli.ts:449`). Other bare sleeps are at `:189, :257, :271, :459, :537`, with no stale claim attached. | |

### 0.4 Polling primitives: why `wait_for` must not use Puppeteer's `waitForFunction`

| # | Finding | Evidence (puppeteer-core 25.5.0) |
|---|---|---|
| T13 | `waitForFunction`'s default polling is **`'raf'`**: `const { polling = 'raf', ... } = options`. | `lib/puppeteer/api/Realm.js:45` |
| T14 | `WaitTask.rerun` picks `RAFPoller`, `MutationPoller` or `IntervalPoller`, and all three **run inside the page**. `IntervalPoller` uses in-page `setInterval`. | `lib/puppeteer/common/WaitTask.js:64-93`, `lib/puppeteer/injected/Poller.js` |
| T15 | **rAF stalls in background tabs.** This was measured live in FR2-01 audit-1: `rafCallsIn500ms: 1` when the tab is hidden, versus about 75 in the foreground (`evidence/FR2-01/audit-1/adv-gap003-pagetimer-results.json`). That is GAP-008, fixed by FR2-01 with **Node-side interval polling** (`waitForVisibleWithPolling`, `:1351-1365`; `waitForHiddenInAllFrames`, `:1242-1254`). Those loops use a Node `setTimeout` between passes, plus fully-awaited CDP probes each pass. |
| T16 | **In-page interval polling is also throttled**: Chrome clamps background-tab timers to ≥ 1 s, and applies "intensive throttling" (about 1/min) to chained timers after about 5 min hidden. Mutation polling can't see non-DOM conditions (a JS variable, `history.pushState`). **None of Puppeteer's three pollers works for a background tab plus an arbitrary condition.** | Chrome timer-throttling policy; T14 |
| T17 | A `waitForFunction` **string** predicate is compiled **inside the page** with `new Function(...)` (`createFunction`, `lib/puppeteer/util/Function.js:12-20`, called from the in-page poller setup in `WaitTask.js:66-93`). On a page with a strict `script-src` CSP (no `'unsafe-eval'`), that is expected to be blocked. This is **stated as expected, to be confirmed live** by baseline B-CSP (§5.1). By contrast, `frame.evaluate(string)` compiles through CDP `Runtime.evaluate`, which DevTools uses for the console and which is not subject to page CSP. | Puppeteer source |

**Conclusion: `wait_for` reuses FR2-01's GAP-008 fix pattern**: a Node-side loop, fully-awaited per-frame CDP probes, and a Node `setTimeout` between passes. It **never** calls `page/frame.waitForFunction` or `waitForSelector({visible|hidden})`. Unit test W19 guards this.

### 0.5 Other constraints found while tracing

| # | Finding | Evidence |
|---|---|---|
| T18 | Engine retries default to `maxRetries = 2` (`:253`). A wait routed through the engine would triple its real duration (GAP-001) and take a failure screenshot (GAP-010 exposure). | engine |
| T19 | The engine's per-tab queue (`executeAction :219-236`) serialises every engine action on a tab. Runtime-level methods (`navigate`, `clickAtPoint`, `eval`, `screenshot`, `uploadFileViaTrigger`) bypass it. | |
| T20 | `ActionResult` (`capability-runtime/src/types.ts:88-101`) has `actionType: string`. `ActionHistoryEntry.actionType` is `string` (`browser-tab.ts:56-63`). A `'wait_for'` result needs no `ActionType` union change. | |
| T21 | `IBrowserTab.getPendingDialog()` exists (`browser-tab.ts:138`, `:421-427`). Engine-test `mockTab`s lack it, so every call must be the optional `tab.getPendingDialog?.()` (the FR2-06/FR2-07 precedent). | |
| T22 | `tab.navigate` waits only for `domcontentloaded` (`browser-tab.ts:242`). Post-DCL XHR/hydration is exactly what settle on `navigate` is for. | |
| T23 | **Arity pins:** `tools.spec.ts:346` checks `waitForSelector('s1','#t',500,undefined,'attached')`. `api.spec.ts:87-104` checks `click` with 6 args and `type` with 5 args. Vitest `toHaveBeenCalledWith` compares argument arrays **by length**. FR2-07 §2.7 already established the "pass a trailing argument only when defined" rule. | |
| T24 | `run-cli.mjs` supports `SCENARIO_FILTER` (`:36`, `:721`), so a single UC can be re-run. | |

---

## 0.6 Decisions (the Orchestrator records these in `decisions.md`)

**D1. `wait_for` is a runtime-level method backed by a pure `@sutradhar/browser` module. It is not an engine `ActionType`.** The engine's machinery is wrong for a wait:
- Retries would triple the wait (T18, GAP-001).
- The duplicate guard is irrelevant (a wait mutates nothing).
- A failure screenshot is costly and can hang on a background tab (GAP-010).
- The per-tab queue (T19) would make a 60 s wait **block** a concurrent action on the same tab, and that action may be exactly what makes the condition true (an MCP client issuing a click in parallel).

The dialog gate (FR2-04) and `clickAtPoint` are the precedents for runtime-level methods. The module (`condition-wait.ts`) is pure and injectable, so it's unit-testable with mock pages and reusable by FR2-13's scenario runner. For uniformity the result still uses the `ActionResult` shape (`success/actionType:'wait_for'/executionTimeMs/currentUrl/title/output/error/verification`) and is recorded in tab history.

**D2. Polling is Node-side, 100 ms, fully-awaited probes (T13–T17).** Each *pass* evaluates every requested condition once. Passes run back to back, with `WAIT_FOR_POLL_MS = 100` of Node `setTimeout` between them. Each pass is bounded to `WAIT_FOR_PASS_TIMEOUT_MS = 1500` by a never-rejecting race; the abandoned probe gets a no-op `.catch`, per the PROB-015 rule. Worst-case return is `timeoutMs + 1500 ms`, which is documented.

**D3. `text` = FR2-07's visible-text check, reused, not re-implemented.** The semantics are those of `innerText`:
- It is a case-sensitive substring over `document.body.innerText`, plus every open shadow root recursively, in **every live frame** (main first; out-of-process iframes included via Puppeteer's per-frame sessions).
- `display:none`, `visibility:hidden`/`collapse`, `<script>`/`<style>`/`<template>`, closed `<details>` content and form-control *values* do **not** count.
- `opacity:0` and off-screen text **do** count.

This is the same definition as FR2-07's `expect.text` (D6), so "visible text" means one thing in Sutradhar. It lines up with FR2-01's element rule (`visibility` hidden/collapse → hidden; `opacity:0`/off-screen → visible) with **one documented divergence**: text inside a **0×0 `overflow:hidden` box** is present for `innerText` but that element is "hidden" for `wait_for_selector`. We keep `innerText` because text is not an element, and a per-text-node bounding-box walk would be a second, slower, novel definition. Case N17 documents the divergence live.

**D4. `textGone` is the exact negation, and "never there" is success.** `textGone:"X"` is met on a pass where **every** live frame answered, and none found X. If any frame could not be inspected, the pass is "unavailable" and polling continues, because we can't claim absence we didn't observe.

If X was never present, the wait **succeeds on the first pass** with `output.presentAtStart:false`. The reasons:
- It mirrors FR2-01's `hidden` on a non-match and Playwright's `state:'hidden'`.
- The caller's goal ("continue once the spinner text is gone") is met.
- The typo trap is surfaced, not hidden: `presentAtStart:false` is in the output, the CLI prints a `Note:`, and FR2-07's verification reports tier `unverifiable` for a vacuous success, the same as FR2-07 D14 for `hidden`/`matchedAtStart:false`.

Check order doesn't change the outcome, because `presentAtStart` is taken from the **first definitive** pass (found or not-found in every frame), not from an extra pre-probe.

**D5. `url` = a case-sensitive substring of `page.url()`, read Node-side with no page contact.** This is identical to `VerificationSpec.expectedUrlSubstring` and FR2-07's `expect.url`. It includes `pushState`/hash changes (Puppeteer tracks same-document navigation). Because there is no page contact, a url-only wait is unaffected by dialogs, background throttling or CSP. There's no regex or glob; a `js` condition covers that (`/re/.test(location.href)`).

**D6. `js` = a JavaScript expression, evaluated in the main frame through CDP.**
- The string is wrapped Node-side as `` `(async () => !!(await (${js}\n)))()` `` and run with `page.mainFrame().evaluate(wrapped)`, which is `Runtime.evaluate` with `awaitPromise`.
- A truthy result means met. The newline guards a trailing `//` comment.
- It must be an **expression**, like Playwright's `waitForFunction(string)` and Puppeteer's own `() => {return (${fn});}`. Statement lists fail with a `SyntaxError`; the doc says to wrap statements in an IIFE.
- **A throw fails the wait immediately** (as in Playwright and Puppeteer), with the page's message and a hint to guard with `?.`.
- **Exception:** "execution context was destroyed", "cannot find context", "detached frame" and similar are **transient** during a navigation, so polling continues. A probe that doesn't settle within the pass bound is "unavailable", not fatal.

**Safety:** this is **no new capability**. `browser.eval` already runs arbitrary caller JS in the page's main world through the same CDP path, and anyone who can call `wait_for` can call `eval`. The untrusted party in the MCP threat model is the *page*, and the page can't inject into `wait_for`'s argument. Two honest caveats are documented:
- The expression runs **every ~100 ms**, so it must be side-effect free.
- It runs in the page's main world, so a hostile page can lie to it, the same as `eval`. `text` (via `innerText`) and `url` (browser-reported) are harder to spoof.

`js` content is **not** validated or scanned. One small courtesy: if the thrown message contains `is not a valid selector` and FR2-06's `SELECTOR_SYNTAX_HINT` is exported, append it.

**D7. Multiple keys = AND, evaluated on the same pass.** All given conditions must be met on one pass. The reasons:
- It's useful ("the URL is the dashboard **and** 'Welcome' has rendered").
- It matches `expect`'s multi-key semantics.
- It's trivial to implement.

OR isn't supported; a `js` condition covers it. Validation (a `TypeError`, before any browser contact):
- Zero keys is an error.
- An empty string is an error.
- `text === textGone` is an error ("can never be satisfied").
- An unknown key is an error, and `selector` specifically points to `wait_for_selector`.

**D8. Timeout semantics.**
- `timeoutMs` defaults to 10000 (the same as `wait_for_selector`) and must be an integer from 0 to 300000.
- `0` (or less, from JS callers) means **check once, don't wait**, matching FR2-01 GAP-011.
- There are **no retries**, so `timeoutMs` is the real total (+ ≤ 1.5 s pass bound). That contrasts with GAP-001 on `wait_for_selector`, and the docs say so.
- If FR2-04's 300 s CLI watchdog exists, the CLI caps at 280000 so the wait's own clean error always wins.

**D9. Dialogs.** Each pass checks `tab.getPendingDialog?.()`.
- While a dialog is pending, page-touching probes (`text`/`textGone`/`js`) are skipped for that pass. A `url`-only wait continues unaffected.
- If a dialog has been **continuously** pending for `WAIT_FOR_DIALOG_GRACE_MS = 1000`, the wait fails fast with `wait_for blocked by an open <type> dialog (...)`. It never hangs to the 30 s auto-dismiss (FR2-04's principle).
- The grace absorbs FR2-04 `accept`/`dismiss` policies that handle a dialog within milliseconds.
- CLI exit code: FR2-04's "blocked by a dialog" code (3) if that constant exists, otherwise 1.

**D10. `wait_for` vs FR2-07 `expect`: two different things, and one shared helper.**

| | `expect` (FR2-07) | `wait_for` (FR2-08) | `settle` | `wait_for_selector` (FR2-01) |
|---|---|---|---|---|
| Is | a post-action **assertion** attached to an action | a standalone **blocking wait** before the next action | a post-action **heuristic** quiet-period | a standalone wait on **one element's state** |
| When | once, right after the action (after settle) | polls until true or timeout | after the action, until DOM + network are quiet | polls until the state or timeout |
| On failure | `success` stays true; `verified:false`, tier `contradicted`; CLI exit 4; SDK `ExpectationFailedError` | `success:false`; CLI exit 1; SDK throws `ActionFailedError` (or `Error`) | never fails the action | `success:false` |
| Waits for a delayed effect? | **No.** FR2-07 case X3 proves the 800 ms-late toast fails `expect.text` | **Yes**, that's its purpose | only if the effect lands inside the DOM-quiet/network-idle window; **cannot see a pending timer** (T6) | yes (element state) |

**Shared code:** `wait_for`'s text probe **is** FR2-07's `pageContainsVisibleText` core (`'found'|'not-found'|'unavailable'` over live frames, open shadow roots and `innerText`), refactored to take a `page` so both call one function (§2.2). One definition means `expect.text` and `wait_for.text` can never drift apart. **Not shared:** `expect` keeps its one-shot, 1500 ms-bounded, never-throws contract. `wait_for` owns the loop, AND semantics, `presentAtStart`, the dialog gate and the timeout diagnosis. `wait_for` takes **no `expect` option**, since its conditions are the assertion.

**D11. `wait_for`'s own `verification`** (FR2-07's contract: every action result carries it). The runtime calls `verifier.verifyAction(tab, prevUrl, result, undefined, builtIn)` with a built-in verdict:
- On success, one `pass` check per given key (`wait_for.text`, `wait_for.textGone`, `wait_for.url`, `wait_for.js`), giving tier `verified`.
- A vacuous `textGone` (`presentAtStart:false`) is a `not-run` check with the detail `"X" was not present when the wait started, so textGone was satisfied vacuously`, giving tier `unverifiable` (FR2-07 D14 parity).
- On failure it's `action-failed`.
- Evidence never contains page text or JS return values (FR2-07 D11). `expected` holds the caller's own needle, with `js` capped at 200 chars.

If FR2-07's final verifier API differs, the Executor adapts, but the **invariant** is binding: success ⇒ `verified:true` unless vacuous; failure ⇒ `verified:false`.

**D12. Settle scope = "every tool that interacts with or navigates the page", as a closed, tested set.** That's the AGENT_SETUP "Navigation" and "Interaction" categories plus `handle_dialog` (accepting a `confirm()` resumes page script, which commonly re-renders). The full per-tool table is in §2.6. **Excluded, with reasons:**
- reads (snapshot, eval, extract, get_*)
- waits (a settle after a wait is meaningless)
- lifecycle and tabs
- environment/storage/permission setters and routes

The setters are configuration, not interaction. When their effect on the page matters, follow them with `wait_for`. The MCP unit test M6 enforces the classification, so a future tool must be classified explicitly.

**D13. Parameter position.** On every runtime method that gains `settle`, it is the **new last** positional parameter, after anything FR2-07 added (`expect`). **No existing position moves.** `click`/`type`/`scroll` keep `settle` where it is. Every surface passes trailing arguments only when defined, via a small `trimTrailingUndefined` helper per surface, so all pinned arities (T23) stay byte-identical. The inconsistency (`click(…, settle, expect)` vs `pressKey(…, expect, settle)`) is the price of no breaking reorder, and is recorded.

**D14. Settle hard bound (fixes T5).** The extracted `waitForPageSettle` races its `Promise.all` against a Node timer of `spec.timeoutMs + SETTLE_HARD_BOUND_GRACE_MS (500)`, and the timer is cleared on normal completion. This is a behavior change only in pathological cases: a dialog open, or a throttled background tab where the in-page bound fires late. Settle still never fails an action.

**D15. Order on runtime-level methods:** primitive → FR2-07 built-in observation (e.g. `NavigationProbe.finish`, point observation) → **settle** → `verifyAction` (the `expect.*` checks). That's the same order the engine uses (settle before verify, T3), and the one FR2-07's `expectDesc` promises ("after settle, if requested").

**D16. CLI condition flags are rejected on other verbs.** `--text/--text-gone/--url/--js` on any verb except `waitfor` exits 1 with `--text is only valid with "waitfor" (did you mean --expect-text?)`. This **deviates** from the `--state`/`--settle` "silently ignored" precedent on purpose: a user who writes `click 7 --text Saved` believes they asserted something, and silently ignoring it is exactly the silent-wrongness class. `--settle` keeps the ignore precedent on non-applicable verbs (harmless) and the help text lists where it applies.

**D17. GAP-002 is folded into this item**, scoped to **exactly** `run-cli.mjs:152` and `:437` (the two lines carrying the stale "no wait command" claim).
- `:437` becomes `waitfor 15000 --text "Hello World!"`. This is a genuine dogfood: the-internet's `#finish` holds "Hello World!" in `textContent` while it's `display:none` from load, so only visible-text semantics wait correctly.
- `:152` (bot.sannysoft.com) becomes a `waitfor` on a condition the Executor finds live in the rendered page (a results cell no longer empty, or a similar signal). If no reliable page-side completion signal exists, the sleep **stays** and the comment is corrected to say exactly that. Either outcome is recorded.

The other five bare sleeps (`:189, :257, :271, :459, :537`) and the analogous ones in `run-mcp.mjs`/`run-sdk.mjs` are **not** touched; they're logged for FR2-13, which ports these UCs to scenario files with `wait_for` steps. Why here rather than FR2-17: the fix *needs* the new verb, is two lines, and gives FR2-08 a real external-site proof. FR2-17 is a docs sweep, not behavior.

---

## 1. Files to touch

| # | File | Change | Prior items that also touch it |
|---|---|---|---|
| 1 | `packages/browser/src/actions/condition-wait.ts` (**new**) | `PageCondition`, `normalizePageCondition`, `waitForPageCondition`, `formatConditionFailure`, `describePageCondition`, constants | — |
| 2 | `packages/browser/src/actions/page-settle.ts` (**new**) | `DEFAULT_SETTLE_SPEC` (moved), `resolveSettleSpec`, `waitForPageSettle` (with the D14 hard bound), `SETTLE_HARD_BOUND_GRACE_MS` | — |
| 3 | `packages/browser/src/actions/index.ts` | `export * from './condition-wait.js'; export * from './page-settle.js';` | — |
| 4 | `packages/browser/src/actions/browser-action-engine.ts` | Remove the local `DEFAULT_SETTLE_SPEC`/`waitForSettle` and import from `page-settle.ts` (the `:275-278` call site becomes `await waitForPageSettle(tab.page, params.settle)`). **No other change.** | FR2-01, 05, 06, 07 |
| 5 | FR2-07's verifier module (`packages/browser/src/verifier/execution-verifier.ts` or `post-conditions.ts`, wherever FR2-07 put `pageContainsVisibleText`) | Refactor its core into an exported `probeVisibleText(page, text, timeoutMs)`, **behavior-preserving**. FR2-07's verifier calls it after its own dialog check, and `condition-wait.ts` calls it too. FR2-07's own unit tests are the gate. | FR2-07 |
| 6 | `packages/capability-runtime/src/types.ts` | `WaitForCondition` | FR2-02, 04, 06, 07 |
| 7 | `packages/capability-runtime/src/runtime.ts` | New `waitFor`. A trailing `settle?` on 21 methods (§2.6). Private `settlePage(tab, settle)`. `fillForm` settles once. | FR2-01…07 |
| 8 | `packages/capability-runtime/src/index.ts` | `export type { WaitForCondition }` (from types), plus `PageCondition` if useful | FR2-01, 05, 07 |
| 9 | `packages/mcp-server/src/tools.ts` | New `browser.wait_for` tool. `settle: settleSchema` on 20 more tools. 3 `ERROR_HINTS` entries. `trimTrailingUndefined` helper. | FR2-01, 02, 05, 06, 07 |
| 10 | `packages/cli/src/parse-args.ts` | `--text`, `--text-gone`, `--url`, `--js` (valued). `waitForFlags`, `waitForFlagError`, `waitForConditionFromArgs` | FR2-01, 03, 04, 07 |
| 11 | `packages/cli/src/cli.ts` | `cmdWaitFor` + a `waitfor` case. `settle` passed on 11 more verbs. The D16 rejection. Help text. | FR2-01, 03, 04, 05, 06, 07 |
| 12 | `packages/sutradhar/src/page.ts`, `src/index.ts` | `Page.waitFor`. `settle` on `goto`/`press`/`scroll` (+ `download`/`uploadFile` if FR2-05 gave them options). Export types. | FR2-01, 05, 07 |
| 13 | Tests (**new**): `packages/browser/tests/unit/condition-wait.spec.ts`, `packages/browser/tests/unit/page-settle.spec.ts` | §4 | — |
| 14 | Tests (**append only**): `browser-action-engine.spec.ts`, `capability-runtime/tests/unit/runtime.spec.ts`, `mcp-server/tests/unit/tools.spec.ts` (plus one *addition* to `EXPECTED_BROWSER_TOOLS`), `cli/tests/unit/parse-args.spec.ts`, `sutradhar/tests/unit/api.spec.ts` | §4 | all prior |
| 15 | `tools/scenario-suite/fixtures/fr2-08-conditions.html`, `fr2-08-csp.html`, `fr2-08-server.mjs` (**new**) | §3 | — |
| 16 | `tools/scenario-suite/verify-fr2-08-conditions.mjs` (**new**) | §5 | — |
| 17 | `tools/scenario-suite/run-cli.mjs` | **Only lines 152 and 437** (D17) | — |
| 18 | `AGENT_SETUP.md` (canonical) **and** `packages/sutradhar/AGENT_SETUP.md` (the mirror; `scripts/build-bundle.mjs:65` copies it, but the committed mirror must match) | §2.8 section; the Interaction row; the tool count; the CLI paragraph | FR2-01…07 |
| 19 | `packages/mcp-server/README.md` (tool table near `:62`), `packages/cli/README.md` (`:67` table, `:110` flags table), `packages/sutradhar/README.md` (Page table near `:132`) | Descriptions match behavior | FR2-01…07 |
| 20 | `.ai/loop/field-report-2/evidence/FR2-08/changelog-fragment.md` (**new**) | §7.3 | — |

**Not touched:**
- `browser-tab.ts` (FR2-04 owns it; this item only *reads* `getPendingDialog`).
- `execution-verifier.ts`'s rules other than the §1.5 extraction.
- `selector-dialect.ts` (FR2-06).
- FR2-01's `wait_for_selector` case and its helpers.
- `packages/agent` and `apps/server`.
- `runtime.audit`/`compareUrls` (FR2-12, gap logged).
- The other run-cli sleeps (FR2-13, gap logged).

---

## 2. API diff

### 2.1 `condition-wait.ts` (new, `@sutradhar/browser`)

```ts
export const WAIT_FOR_POLL_MS = 100;
export const WAIT_FOR_PASS_TIMEOUT_MS = 1500;
export const WAIT_FOR_DEFAULT_TIMEOUT_MS = 10000;
export const WAIT_FOR_MAX_TIMEOUT_MS = 300000;
export const WAIT_FOR_DIALOG_GRACE_MS = 1000;
export const WAIT_FOR_JS_DISPLAY_MAX = 200;

/** A page-level condition. Given keys are ANDed; each is checked once per pass. */
export interface PageCondition {
  /** Case-sensitive substring of the page's VISIBLE text (innerText semantics, every live frame, open shadow roots). */
  readonly text?: string;
  /** The same visible-text test, negated: met when no live frame shows it. Met immediately if it was never present. */
  readonly textGone?: string;
  /** Case-sensitive substring of the tab's current URL (page.url(), includes pushState/hash changes). */
  readonly url?: string;
  /** A JS EXPRESSION evaluated in the main frame; truthy = met. Must be side-effect free. A throw fails the wait. */
  readonly js?: string;
}
export type ConditionKey = keyof PageCondition;              // 'text' | 'textGone' | 'url' | 'js'
export type ConditionProbe = 'met' | 'unmet' | 'unavailable';

/** Minimal structural page type so unit tests can pass plain mocks. */
export interface ConditionPage {
  url(): string;
  isClosed(): boolean;
  mainFrame(): ConditionFrame;
  frames(): ConditionFrame[];
}
export interface ConditionFrame {
  isDetached(): boolean;
  evaluate(...args: any[]): Promise<unknown>;
}

export interface ConditionWaitOptions {
  readonly timeoutMs: number;                                   // already normalized
  readonly pollMs?: number;                                     // default WAIT_FOR_POLL_MS (tests only)
  readonly getPendingDialog?: () => { dialogType: string; message: string } | undefined;
}

export interface ConditionWaitResult {
  readonly satisfied: boolean;
  readonly elapsedMs: number;
  readonly polls: number;                                        // passes run
  readonly presentAtStart?: boolean;                             // only when textGone given (first definitive pass)
  readonly last: Readonly<Partial<Record<ConditionKey, ConditionProbe>>>;
  readonly lastDetail: Readonly<Partial<Record<ConditionKey, string>>>; // e.g. url → current URL; text → 'N of M frames could not be inspected'
  readonly fatal?: { readonly kind: 'js-threw' | 'dialog' | 'page-closed'; readonly message: string };
}

/** Validates BEFORE any browser contact. Throws TypeError('wait_for: …'). Returns only the given keys + a normalized timeout. */
export function normalizePageCondition(input: unknown, timeoutMs: unknown):
  { condition: PageCondition; timeoutMs: number };
export async function waitForPageCondition(page: ConditionPage, condition: PageCondition,
  opts: ConditionWaitOptions): Promise<ConditionWaitResult>;
/** 'text="Saved" AND url~"stage=done" AND js(window.x === 1)' — js capped at 80 chars here. */
export function describePageCondition(c: PageCondition): string;
/** The exact user-facing error for a non-satisfied result (§2.1.3). */
export function formatConditionFailure(c: PageCondition, r: ConditionWaitResult, timeoutMs: number): string;
```

#### 2.1.1 `normalizePageCondition` rules (exact `TypeError` messages)

| Input | Message |
|---|---|
| not a plain object | `wait_for: the condition must be an object like {text: "Saved"}` |
| unknown key `selector` | `wait_for: unknown key "selector" — to wait for an element's state use wait_for_selector` |
| any other unknown key `k` | `wait_for: unknown key "k" — allowed: text, textGone, url, js, timeoutMs` |
| no condition key | `wait_for: give at least one of text, textGone, url, js` |
| a key present but not a non-empty string | `wait_for: "text" must be a non-empty string` (per key) |
| `text === textGone` | `wait_for: text and textGone are both "X" — that can never be satisfied` |
| timeout not a finite number | `wait_for: timeoutMs must be a number of milliseconds (0-300000)` |
| timeout > 300000 | `wait_for: timeoutMs 300001 exceeds the maximum 300000 (5 minutes)` |
| timeout < 0 | normalized to 0 (check once; FR2-01 GAP-011 parity) |
| timeout undefined | 10000 |
| non-integer | `Math.floor` |

`timeoutMs` may also be passed inside `input` (the runtime's `WaitForCondition` shape). The runtime passes `(condition, condition.timeoutMs)` and the key list tolerates `timeoutMs`.

#### 2.1.2 `waitForPageCondition` algorithm

```
start = now; deadline = start + timeoutMs; polls = 0; dialogSince = undefined
loop:
  if page.isClosed() → fatal page-closed: 'wait_for failed: the tab was closed while waiting (after Nms).'
  polls++
  pass = bounded(runPass(), WAIT_FOR_PASS_TIMEOUT_MS)     // never rejects; abandoned promise has .catch(()=>{})
      runPass(), keys in fixed order url, text, textGone, js:
        url      → page.url().includes(url) ? met : unmet                     (no page contact)
        dialog   = getPendingDialog?.()
        if dialog and (text|textGone|js requested):
             dialogSince ??= now; mark those keys 'unavailable' (detail 'a <type> dialog is open')
             if now - dialogSince >= WAIT_FOR_DIALOG_GRACE_MS → fatal dialog (message below)
        else dialogSince = undefined
        text     → probeVisibleText(page, text, remainingPassBudget):
                       found → met; not-found → unmet; unavailable → unavailable (+detail)
        textGone → probeVisibleText(page, textGone, …): found → unmet; not-found → met; unavailable → unavailable
                   presentAtStart ??= (found ? true : not-found ? false : undefined)
        js       → try await page.mainFrame().evaluate(WRAP(js)) → truthy ? met : unmet
                   catch e: isTransientContextError(e) → unavailable
                            else → fatal js-threw: 'wait_for failed: js condition threw after Nms: <e.message>'
  if pass timed out → every key not yet decided this pass = 'unavailable' (detail 'did not answer within 1500ms')
  if fatal → return {satisfied:false, fatal, …}
  if every requested key is 'met' on this pass → return {satisfied:true, …}
  if now >= deadline → return {satisfied:false, …}          // timeoutMs 0 ⇒ exactly one pass
  await nodeDelay(min(pollMs, deadline - now))
```

- `probeVisibleText` is the §1.5 extraction of FR2-07's function (live frames, main first, via `frame.evaluate(inPageFn, text)`, **never `page.evaluate`**). For `text` it may stop at the first frame that finds it. For `textGone` it must hear from every frame.
- `isTransientContextError(e)` matches `/Execution context was destroyed|Cannot find context with specified id|detached Frame|Execution context is not available|Target closed|Session closed/i`. The first three are the engine's `isContextDestroyedError` (`:982-989`); keep one exported copy in `condition-wait.ts`, and the engine may import it but doesn't have to (no engine change is required).
- **`WRAP(js)`** = `` `(async () => !!(await (${js}\n)))()` ``, a string, so the page compiles it through CDP (T17).
- The fatal dialog message: `` `wait_for blocked by an open ${type} dialog ("${msg≤100}") after ${N}ms — handle it (browser.handle_dialog, or "sutradhar dialog accept|dismiss"), then wait again.` ``
- **The probes of one pass are strictly sequential and fully awaited.** No `Promise.any` or `Promise.all` across frames (the PROB-015 rule; W20).

#### 2.1.3 `formatConditionFailure` (the timeout message)

`` `wait_for timed out after ${timeoutMs}ms waiting for ${describePageCondition(c)}: ${parts.join('; ')}.` ``

There is one part per key, in the order text, textGone, url, js:

| Key / last | Part |
|---|---|
| text met | `text "X" is visible` |
| text unmet | `text "X" was not found in the visible text of N frame(s)` |
| text unavailable | `text "X" could not be checked (<detail>)` |
| textGone met / unmet / unavailable | `textGone "X" is gone` / `textGone "X" is still visible` / `textGone "X" could not be checked (<detail>)` |
| url met / unmet | `url contains "X"` / `url does not contain "X" (current URL: <url>)` |
| js met / unmet / unavailable | `js <expr≤200> is truthy` / `js <expr≤200> is still falsy` / `js <expr≤200> did not settle within 1500ms` |

Rules for every message:
- Messages **never** contain page text or a JS return value.
- A timeout message never starts with `Action ` (so the engine's `isTimeoutError` can't misclassify it).
- `fatal` results use `fatal.message` verbatim.

### 2.2 The shared visible-text probe (refactor of FR2-07, behavior-preserving)

```ts
/** One-shot visible-text check across live frames (main first) and open shadow roots, innerText semantics.
 *  'unavailable' when some frames threw and none found it, or the bound elapsed. Never throws, never page.evaluate. */
export async function probeVisibleText(page: ConditionPage, text: string, timeoutMs: number):
  Promise<{ result: 'found' | 'not-found' | 'unavailable'; detail?: string; framesChecked: number }>;
```

FR2-07's `pageContainsVisibleText(tab, text)` becomes: its dialog check, then `probeVisibleText(tab.page, text, EXPECT_TEXT_TIMEOUT_MS)`. Its exact details and outcomes are kept. FR2-07's unit tests (`execution-verifier.spec.ts`) must pass **unchanged**; that is the proof the refactor preserved behavior. If FR2-07's implementation can't be split without changing a tested output, the Executor stops and reports rather than forking a copy.

### 2.3 `page-settle.ts` (new, extracted from the engine)

```ts
export const DEFAULT_SETTLE_SPEC: Readonly<Required<SettleSpec>> = { mutationQuietMs: 300, networkIdleMs: 500, timeoutMs: 5000 };
export const SETTLE_HARD_BOUND_GRACE_MS = 500;
/** undefined/false → null (don't settle); true → defaults; object → defaults ⊕ object. */
export function resolveSettleSpec(settle: boolean | SettleSpec | undefined): Required<SettleSpec> | null;
/** Engine T4 algorithm, byte-for-byte the same page.evaluate(fn, quietMs, boundMs) and
 *  waitForNetworkIdle({idleTime, timeout}) calls (T7 pins them), PLUS a Node-side hard bound of
 *  timeoutMs + SETTLE_HARD_BOUND_GRACE_MS (D14; timer cleared on completion). Never throws. No-op when spec is null. */
export async function waitForPageSettle(page: Page, settle: boolean | SettleSpec | undefined): Promise<void>;
```

Engine change (`:275-278`): `if (params.settle && tab.page) await waitForPageSettle(tab.page, params.settle);`. The private `waitForSettle` and the local `DEFAULT_SETTLE_SPEC` are deleted.

### 2.4 Runtime (`runtime.ts`, `types.ts`)

```ts
// types.ts
/** Argument of SutradharRuntime.waitFor — PageCondition plus the timeout. */
export interface WaitForCondition {
  text?: string; textGone?: string; url?: string; js?: string;
  /** Default 10000, max 300000; 0 = check once. The REAL total — no retries. */
  timeoutMs?: number;
}
```

```ts
// runtime.ts
/** Wait until every given condition holds at once (Node-side 100ms polling; works in background tabs and
 *  under strict CSP). Never retried. See PageCondition for exact semantics. */
public async waitFor(sessionId: string, condition: WaitForCondition, tabId?: string): Promise<ActionResult> {
  const { condition: c, timeoutMs } = normalizePageCondition(condition, condition?.timeoutMs); // TypeError BEFORE resolveTab
  const { tab } = this.resolveTab(sessionId, tabId);
  const page = this.requirePage(tab);
  const previousUrl = tab.url;
  const r = await waitForPageCondition(page, c, { timeoutMs, getPendingDialog: () => tab.getPendingDialog?.() });
  const result: ActionResult = {
    success: r.satisfied,
    actionType: 'wait_for',
    executionTimeMs: r.elapsedMs,
    currentUrl: page.isClosed() ? undefined : page.url(),
    title: r.fatal?.kind === 'dialog' || page.isClosed() ? undefined : await this.readTitle(tab), // title() blocks on a dialog
    output: {
      conditions: displayCondition(c),                 // echo; js capped at 200
      satisfiedAfterMs: r.satisfied ? r.elapsedMs : undefined,
      polls: r.polls,
      ...(c.textGone !== undefined ? { presentAtStart: r.presentAtStart } : {}),
      ...(r.satisfied ? {} : { last: r.last }),
    },
    ...(r.satisfied ? {} : { error: r.fatal?.message ?? formatConditionFailure(c, r, timeoutMs) }),
  };
  // FR2-07 contract (D11): builtIn verdict from r; verification = await this.verifier.verifyAction(tab, previousUrl,
  //   {success, actionType:'wait_for', outputData: result.output, error}, undefined, builtIn)
  tab.recordAction({ actionType: 'wait_for', selector: describePageCondition(c), success: result.success,
                     error: result.error, executionTimeMs: result.executionTimeMs, timestamp: new Date().toISOString() });
  return { ...result, verification, ...this.dialogPendingOf?.(tab) };   // dialogPendingOf is FR2-07's helper, when present
}
```

Notes on `waitFor`:
- It doesn't consume a rate-limiter token (it makes no request to the site; snapshot and eval don't consume one either).
- It doesn't publish on the event bus (the runtime-level precedent).
- It has **no `failureScreenshot`** (D1).

**Settle wiring.** Add `settle?: boolean | SettleSpec` as the **last** parameter (D13). Signatures shown assume FR2-07's `expect?` is present; if it isn't, `settle` simply follows the current last parameter.

| Method | New signature tail | How |
|---|---|---|
| `focus`, `pressKey`, `hover`, `selectOption`, `selectOptions`, `clickByText`, `clickByRole`, `typeByLabel`, `uploadFile`, `clickWithButton`, `dragAndDrop`, `touchTap`, `downloadFile` | `…, expect?, settle?` | `settle` added to the `runAction` params object (the engine handles it generically, T3) |
| `navigate`, `goBack`, `goForward`, `reload` | `…, tabId?, expect?, settle?` | runtime-level: `await this.settlePage(tab, settle)` after the primitive and FR2-07's probe, **before** `verifyAction` (D15). Skipped when the primitive threw. |
| `clickAtPoint`, `dragAtPoints` | `…, expect?, settle?` | inside the `try`, after the mouse ops and FR2-07's observation, before building the result |
| `uploadFileViaTrigger` | `…, tabId?, expect?, settle?` | after `fileChooser.accept` |
| `handleDialog` | `(sid, action, promptText?, tabId?, settle?)` | after `tab.handleDialog` |
| `fillForm` | `(sid, fields, tabId?, settle?)` | **once**, after the loop, only if ≥ 1 field succeeded; the per-field `type` calls get no settle |
| `click`, `type`, `scroll` | unchanged | already wired |

`private async settlePage(tab: IBrowserTab, settle?: boolean | SettleSpec): Promise<void> { if (settle && this.hasRealPage(tab)) await waitForPageSettle(tab.page!, settle); }`

### 2.5 MCP (`tools.ts`)

**New tool, registered right after `browser.wait_for_selector`:**
```ts
server.registerTool('browser.wait_for', {
  description:
    'Wait until a page condition becomes true — use this instead of sleeping. Polls from outside the page every ' +
    '~100ms, so it works in background tabs and on strict-CSP pages. Give one or more conditions; ALL must hold ' +
    'at the same moment. text: visible text appears anywhere (every frame and open shadow root; case-sensitive ' +
    'substring; display:none/visibility:hidden text and form-field values do NOT count). textGone: that visible ' +
    'text is absent — succeeds immediately if it was never there, so check output.presentAtStart. url: the tab URL ' +
    'contains this substring (pushState/hash changes included). js: a JavaScript EXPRESSION evaluated in the main ' +
    'frame, truthy = done; it re-runs every ~100ms so keep it side-effect free, and if it throws the wait fails ' +
    'immediately — guard it (e.g. document.querySelector("#x")?.textContent === "done"). timeoutMs defaults to ' +
    '10000 (max 300000; 0 = check once) and is the real total: no hidden retries. For an element\'s visible/' +
    'attached/hidden state use browser.wait_for_selector. settle:true on an action only waits for DOM/network ' +
    'quiet and cannot see a pending timer; expect on an action checks once and does not wait.',
  inputSchema: {
    sessionId: z.string(),
    text: z.string().min(1).optional().describe('Visible text that must appear (case-sensitive substring).'),
    textGone: z.string().min(1).optional().describe('Visible text that must disappear (e.g. "Loading…").'),
    url: z.string().min(1).optional().describe('Substring the tab URL must contain.'),
    js: z.string().min(1).optional().describe('JS expression; truthy = done. Side-effect free; a throw fails the wait.'),
    timeoutMs: z.number().int().min(0).max(300000).optional().describe('Defaults to 10000. 0 = check once.'),
    tabId: z.string().optional(),
  },
}, async ({ sessionId, text, textGone, url, js, timeoutMs, tabId }) => {
  try {
    const condition = omitUndefined({ text, textGone, url, js, timeoutMs });
    return jsonResult(await runtime.waitFor(sessionId, condition, ...trimTrailingUndefined([tabId])));
  } catch (e) { return errorResult(`wait_for failed: ${(e as Error).message}`); }
});
```

A validation `TypeError` (e.g. no keys) goes to the `catch`, giving `isError:true`. A timeout is `success:false` JSON with the hint appended by `jsonResult`.

**`ERROR_HINTS`:** insert these right after FR2-01's two entries and before `'stale snapshot'`, so they always precede `'timed out'`:
```ts
['wait_for timed out', 'The condition never became true. Inspect the page (browser.snapshot / browser.eval), fix the condition, or raise timeoutMs.'],
['js condition threw', 'Guard the expression so it returns false instead of throwing while the page is still loading, e.g. document.querySelector("#x")?.textContent === "done".'],
['wait_for blocked by an open', 'Handle the dialog with browser.handle_dialog, then call browser.wait_for again.'],
```

`'wait_for timed out'` can't match a `wait_for_selector` message, because `wait_for_selector timed out` has `_selector` between the two words.

**Settle.** Add `settle: settleSchema` to the 20 tools marked ADD in §2.6. Each handler passes it last, through `trimTrailingUndefined`, so the call has **exactly the pre-FR2-08 arity when `settle` is absent** (T23). `settleSchema` and `settleDesc` stay textually unchanged, except that `settleDesc` gains one sentence at the end: `' It cannot see a timer the page has scheduled for later — to wait for a specific result, use browser.wait_for.'`

The descriptions of `browser.click`/`type`/`scroll` don't change. `handle_dialog`'s description gains: `' Pass settle:true to wait for the page to finish reacting (e.g. a list re-rendering after an accepted confirm()).'`

### 2.6 The settle matrix: every tool and verb

**MCP (68 today + `wait_for` = 69, plus whatever FR2-12 adds; the count is asserted by `EXPECTED_BROWSER_TOOLS`, not hard-coded in docs):**

| Tool(s) | Mutates the page? | settle today | Change | Reason if excluded |
|---|---|---|---|---|
| `click`, `type`, `scroll` | yes | **yes** | none | — |
| `navigate`, `go_back`, `go_forward`, `reload` | yes (navigation) | no | **ADD** (runtime-level) | — |
| `click_at_point`, `drag_at_points` | yes | no | **ADD** (runtime-level) | — |
| `press_key`, `focus`, `hover`, `select_option`, `select_options`, `click_by_text`, `click_by_role`, `type_by_label`, `upload_file`, `right_click`, `drag_and_drop`, `touch_tap`, `download_file` | yes | no | **ADD** (engine, generic) | — |
| `upload_file_via_trigger` | yes | no | **ADD** (runtime-level) | — |
| `fill_form` | yes | no | **ADD** (once, after all fields) | — |
| `handle_dialog` | yes (resumes page script) | no | **ADD** (runtime-level) | — |
| `wait_for_selector`, `wait_for` | no | no | exclude | A wait; settling after a wait is meaningless. Compose waits instead. |
| `snapshot`, `ax_snapshot`, `screenshot`, `export_pdf`, `extract_data`, `get_*` (cookies, local/session storage, storage_state, viewport, clipboard, pending_dialog, console_logs, page_errors, network_log, action_history, tab_lock), `list_tabs` | no (read) | no | exclude | Read-only |
| `eval` | possibly (caller code) | no | exclude | An escape hatch whose contract is "return the value", not an action result (GAP-027 classes it as a read tool). Follow a mutating eval with `wait_for`. |
| `set_cookie`, `delete_cookie`, `set/clear_local_storage*`, `set/clear_session_storage*`, `set_storage_state`, `set_geolocation`, `grant_permissions`, `set_viewport`, `emulate`, `set_network_conditions`, `set_clipboard`, `route`, `clear_routes` | environment/configuration | no | exclude | Configuration, not interaction; usually applied before navigating. When the page's reaction matters, follow with `wait_for` (or `reload` with settle). |
| `health`, `launch`, `attach`, `shutdown`, `shutdown_all`, `new_tab`, `focus_tab`, `close_tab`, `lock_tab`, `unlock_tab` | lifecycle/tabs | no | exclude | Lifecycle; `new_tab(url)` returns TabInfo, not an action result. Use `wait_for {tabId}` on the new tab. |
| `agent.runGoal` | — | no | exclude | Its own loop |

**CLI verbs:**

| Verb | settle today | Change |
|---|---|---|
| `click`, `type`, `scroll` | yes | none |
| `nav`, `clicktext`, `clickrole`, `press` (settle after the key press, not the pre-focus), `select`, `hover`, `upload`, `drag`, `clickpoint`, `dragpoints`, `download` | no | **ADD**: pass the `settle` flag as the new last argument |
| `dialog` (FR2-04, if present) | — | **ADD** if `cmdDialog` exists at DEVELOP time; otherwise N/A |
| `snap`, `axsnap`, `text`, `screenshot`, `eval`, `wait`, `waitfor`, `getclipboard`, `setclipboard`, `grant`, `tabs`, `newtab`, `focustab`, `closetab`, `audit`, `compare`, `close`, `doctor`, `profile` | no | exclude (ignored, the existing precedent) |
| No verb exists for focus, touch_tap, type_by_label, select_options, fill_form, upload_via_trigger, back/forward/reload | — | **not added here** (logged; overlaps GAP-028) |

**SDK:**

| Method | settle today | Change |
|---|---|---|
| `click`, `type` | yes | none |
| `goto(url, options?)` | no | **ADD** `options.settle` (it joins FR2-07's `GotoOptions {expect}`) |
| `press(key, options?)`, `scroll(dir, amount, options?)` | no | **ADD** `options.settle` via `ElementOptions`. If FR2-07 hasn't already added the options parameter, add it. |
| `download`, `uploadFile` (FR2-05) | — | **ADD** if FR2-05 gave them an options object; otherwise not changed (note it) |
| `waitForSelector`, `waitFor`, `screenshot`, `evaluate`, `snapshot`, `cookies`, `get/setStorageState`, `setViewport`, `getViewport`, `bringToFront`, `close` | — | exclude, same reasons as MCP |

### 2.7 CLI and SDK

**`parse-args.ts`:**
- Add `--text`, `--text-gone`, `--url` and `--js` to `KNOWN_FLAGS`, with their value indices in `isConsumedValue`.
- A value that begins with `--` is still consumed (the index rule). That's documented.

```ts
waitForFlags: { text?: string; textGone?: string; url?: string; js?: string };   // {} when none
waitForFlagError: string | undefined;        // '--text needs a value (e.g. waitfor --text "Saved")' when flag is last/valueless
export function waitForConditionFromArgs(p: ParsedArgs, timeoutArg: string | undefined):
  { condition: WaitForCondition } | { error: string };
//   no condition flag → 'usage: sutradhar waitfor [timeoutMs] --text <t> | --text-gone <t> | --url <s> | --js <expr>  (combine to require all)'
//   timeoutArg present but not /^\d+$/ → 'waitfor: timeoutMs must be a whole number of milliseconds'
//   timeoutArg > cap (300000, or 280000 when FR2-04's watchdog exists) → 'waitfor: timeoutMs must be at most <cap>'
```

**`cli.ts`:**
- `main()` validation order: after FR2-01's `--state` check (and FR2-04/FR2-07's checks):
  - (a) `if (waitForFlagError) printErrorAndExit(waitForFlagError)`
  - (b) D16: `if (verb !== 'waitfor' && Object.keys(waitForFlags).length) printErrorAndExit('--text/--text-gone/--url/--js are only valid with "waitfor" (did you mean --expect-text / --expect-url?)')`
- `case 'waitfor': return cmdWaitFor(cleanArgs[0]);`
- `cmdWaitFor(timeoutArg)`:
  - `const parsed = waitForConditionFromArgs(...)`; an error exits 1.
  - `withSession` → `runtime.waitFor(sid, parsed.condition)`.
  - **Success:** stdout `Condition met after ${satisfiedAfterMs}ms: ${describePageCondition}`. If `presentAtStart === false`, stderr `Note: "<textGone>" was not present when the wait started, so textGone was satisfied immediately — check the text if you expected it.`
  - **Failure:** stdout `Wait failed: ${error}`, `process.exitCode = 1`, or FR2-04's dialog exit code (3) when `error` starts with `wait_for blocked by an open` and that constant exists.
  - With FR2-07's `--json`: print `toCliJson(result)` instead of the status lines.
- Help text:
  ```
    waitfor [timeoutMs] --text <t> | --text-gone <t> | --url <s> | --js <expr>
                                Wait until a page condition is true (default 10000ms; 0 = check once).
                                --text: visible text appears (any frame; hidden text and input values
                                don't count). --text-gone: it disappears (succeeds at once if it was
                                never there). --url: URL contains <s>. --js: a JS expression is truthy
                                (side-effect free; a throw fails the wait). Give several to require all.
                                Use this instead of sleeping.
  ```
  `--settle` flag text becomes: `"click"/"type"/"scroll"/"nav"/"clicktext"/"clickrole"/"press"/"select"/"hover"/"upload"/"drag"/"clickpoint"/"dragpoints"/"download"` (+ `"dialog"`), then `wait for the page to stop actively changing … It cannot see a timer the page scheduled for later — use "waitfor" to wait for a specific result.`

**SDK (`page.ts`, `index.ts`):**
```ts
/** Options for Page.waitFor — PageCondition plus Playwright-style `timeout`. */
export interface WaitForOptions { text?: string; textGone?: string; url?: string; js?: string; timeout?: number }
/** Wait until every given condition holds at once. Returns the result; THROWS on timeout/fatal
 *  (ActionFailedError from FR2-07's errors.ts when present, else Error with result.error). */
public async waitFor(options: WaitForOptions): Promise<ActionResult> {
  const { timeout, ...cond } = options ?? ({} as WaitForOptions);
  const r = await this.runtime.waitFor(this.sessionId, { ...cond, ...(timeout !== undefined ? { timeoutMs: timeout } : {}) }, this.tabId);
  if (!r.success) throw /* ActionFailedError(r) | new Error(r.error ?? 'waitFor failed') */;
  return r;
}
```

- Validation `TypeError`s from the runtime propagate. A caller passing `timeoutMs` instead of `timeout` gets the "unknown key" error, whose message names the allowed keys; the SDK doc says `timeout`.
- Exports: `type WaitForOptions`, `type WaitForCondition`.
- `goto`/`press`/`scroll` forward `options?.settle` last, via `trimTrailingUndefined` (arity).

### 2.8 `AGENT_SETUP.md`: the new section (insert after "Grounding: `snapshot` vs `ax_snapshot`", before "Other ways in")

Also update these, in both copies:
- the Interaction row gains `` `wait_for` `` next to `` `wait_for_selector` ``;
- `:60`'s count becomes the real registered count;
- the CLI paragraph (`:110-116`) lists `waitfor` and says `--settle` works on every interaction verb.

The exact prose follows. The Executor may only adjust tool/flag names if an earlier item renamed something; any such adjustment is recorded.

````markdown
## Waiting: wait on conditions, never sleep

Fixed delays are the #1 cause of flaky browser automation. A `sleep(2000)` is either too short (the
toast shows up at 2.3s on a slow run, and you read the page too early) or too long (every run pays
the full delay), and the result never tells you which one happened. Sutradhar gives you waits that
end the moment the thing you care about is true, and fail with a message saying what was still
missing when it isn't.

**Decide what you're actually waiting for, then wait for exactly that:**

| You're waiting for… | Use |
|---|---|
| an element to appear, become visible, or go away | `browser.wait_for_selector` (`state`: `visible` default, `attached`, `hidden`) |
| some text to show up anywhere on the page | `browser.wait_for` `{text}` |
| a spinner / "Loading…" / "Saving…" message to go away | `browser.wait_for` `{textGone}` |
| a navigation or client-side route change | `browser.wait_for` `{url}` |
| app state that isn't visible in the DOM (a JS flag, a store value, a counter) | `browser.wait_for` `{js}` |
| "let the page finish reacting" after an action, with no specific signal | `settle: true` on that action |

**`wait_for` examples** (MCP, then CLI, then SDK):

```jsonc
{ "sessionId": "s1", "text": "Saved successfully" }                          // appears
{ "sessionId": "s1", "textGone": "Loading…", "timeoutMs": 20000 }             // disappears
{ "sessionId": "s1", "url": "/dashboard" }                                    // route changed
{ "sessionId": "s1", "js": "window.__app?.ready === true" }                   // JS state
{ "sessionId": "s1", "url": "/orders/", "text": "Order confirmed" }           // BOTH must hold
```

```bash
sutradhar waitfor --text "Saved successfully"
sutradhar waitfor 20000 --text-gone "Loading…"
sutradhar waitfor --url /dashboard
sutradhar waitfor --js "window.__app?.ready === true"
sutradhar waitfor --url /orders/ --text "Order confirmed"
```

```ts
await page.waitFor({ text: 'Saved successfully' });
await page.waitFor({ textGone: 'Loading…', timeout: 20000 });
await page.waitFor({ url: '/dashboard' });
await page.waitFor({ js: 'window.__app?.ready === true' });
```

**What each condition means, exactly:**
- `text` is **visible** text: the same rule as `expect.text`, across every frame and open shadow
  root, case-sensitive. Text in `display:none` / `visibility:hidden` elements doesn't count, and
  neither does a form field's value. Use `js` for values, e.g.
  `document.querySelector('#email')?.value === 'a@b.com'`.
- `textGone` succeeds **immediately** if the text was never on the page. The result's
  `output.presentAtStart` is `false` in that case. Check it if you expected the text to be there
  (a typo looks exactly like "already gone").
- `url` is a plain substring of the current URL, including `pushState` and `#hash` changes.
- `js` is an **expression** (not statements; wrap those in an IIFE). It re-runs about every
  100 ms, so it must not change anything. If it throws, the wait fails right away with the page's
  error, so guard it with `?.`.
- Several conditions together mean **all of them, at the same moment**.
- `timeoutMs` defaults to 10000 (max 300000); `0` means "check once, don't wait". It's the real
  total, with no hidden retries. On timeout the error lists which conditions were met and which
  weren't.
- It polls from outside the page, so it keeps working in a background tab and on sites with a
  strict Content-Security-Policy. If a native dialog (alert/confirm) blocks the page, it fails
  within about a second and tells you to handle the dialog. It doesn't hang.

**`settle` vs `wait_for` vs `expect`: three different tools.**
- `settle: true` on an action (every interaction and navigation tool accepts it) waits until the
  DOM has stopped changing and the network is idle, up to 5 s. It's a heuristic for "let the menu
  finish rendering". **It can't see a timer the page scheduled for later.** A page that calls
  `setTimeout(showToast, 2000)` looks perfectly quiet for those two seconds, so settle returns
  before the toast exists.
- `wait_for` waits for the specific thing you name, however long it takes, up to the timeout.
- `expect` on an action (`{text, url, urlChanged}`) is a **one-shot check right after the
  action**. It never waits. If the effect you expect is delayed, do the action, then
  `wait_for` the effect.

**Don't build your own polling loop** out of repeated `snapshot`/`eval` calls with sleeps in
between. Each iteration is a full round trip through your context window, and you'll still guess
the interval. One `wait_for` call does the same thing in-process every 100 ms, and returns one
result.
````

---

## 3. Fixture design

**`tools/scenario-suite/fixtures/fr2-08-server.mjs`** exports `startFr208Server(): Promise<{origin, url(path, params), requests: Array<{path, at}>, close()}>`. It listens on `127.0.0.1:0`, never on `0.0.0.0`. Every response is `Cache-Control: no-store`, and every request is logged to `requests[]` (the network ground truth). Routes:
- `/conditions.html` → `fr2-08-conditions.html`
- `/csp.html` → `fr2-08-csp.html`, with header `Content-Security-Policy: script-src 'nonce-fr208'` (no `'unsafe-eval'`)
- `/slow?ms=N` → JSON `{ok:true}` after N ms
- `/download.bin` → 1024 random bytes, `Content-Disposition: attachment; filename="fr2-08.bin"`
- `/arrived.html` → `<h1>Arrived</h1>`, built as `'Arri'+'ved'` in script, with a `load` → burst hook

**Per-case uniqueness goes in the query string only** (`?case=…&delay=…&n=<nonce>`), not the fragment. That's the FR2-01 same-document gotcha.

**`fixtures/fr2-08-conditions.html`:**
- A **head** script installs a passive recorder: `window.__fx8 = {events:[], mutations:[], loadAt}`, plus a `MutationObserver` on `document` (subtree, all types) that pushes only `{at: Date.now(), n: records.length}`. It never mutates the DOM.
- `rec(what)` pushes `{what, at: Date.now()}` to `__fx8.events`.
- **Script-built strings:** every expected text is built from string pieces in script (`'Saved ' + 'successfully'`), so the literal never sits in `<script>` source. That's FR2-07's gotcha, kept for safety even though `innerText` excludes scripts.
- **One case per load.** A case schedules only its own timers, so the "pure" cases really are pure.

| `case=` | At load | At `delay` (default 2000 ms; `mode=manual` → only when the observer calls `__fx8.arm(ms)`) | Proves |
|---|---|---|---|
| `toast` (**the Done-when case**) | **Nothing** except `setTimeout(show, delay)`: no other timers, no rAF, no network, no DOM writes | Appends `<div id="toast">Saved successfully</div>`; `rec('toastShown')` | wait_for catches a pure-setTimeout toast. `__fx8.mutations` before `toastShown` must be empty, and `server.requests` after load empty. |
| `toast-click` | `#start-toast` button; its click only calls `setTimeout(show, delay)` | same toast | L1b: settle on the click returns **before** the toast; wait_for then catches it |
| `hidden-toast` | `<div id="ht" style="display:none">Order confirmed</div>` | `ht.style.display='block'`; `rec('htShown')` | Hidden text doesn't count until revealed (innerText, D3) |
| `vis-toast` | `<div style="visibility:hidden">Visibility toast</div>` | `visibility='visible'` | visibility:hidden text doesn't count |
| `spinner` | `<div id="sp">Loading data…</div>` visible | `sp.remove()`; `rec('spinnerGone')` | textGone, `presentAtStart:true` |
| `js` | `window.__appState = {ready:false}` | `__appState.ready = true` (**no DOM change**); `rec('jsReady')` | A pure JS-variable condition |
| `push` | — | `history.pushState({}, '', location.pathname + location.search + '&stage=done')`; `rec('pushed')` | url, same-document |
| `nav` | — | `location.href = '/arrived.html?n=…&stage=arrived'` (recorded in `sessionStorage` before leaving) | url + text AND across a cross-document navigation; transient context errors are survived |
| `shadow` | `#host` with an open shadow root, empty | appends `<span>Shadow saved</span>` inside the root | Shadow roots |
| `frame` | `<iframe id="f" srcdoc=…>` (closed with plain `</script>`, the FR2-01 lesson) with its own timer | the iframe appends `Frame saved`; records into `parent.__fx8.events` | Child frames |
| `alert` | — | `alert('fr2-08')`; `rec('alertOpened')` just before | Dialog gate (N10) |
| `static` | `<input id="inp" value="Typed value">`; `<div style="display:none">Hidden forever</div>`; `<div style="width:0;height:0;overflow:hidden">Zero box text</div>`; `<div style="opacity:0">Ghost text</div>`; `<p>text=Submit &gt;&gt; nth=0</p>` absent (not rendered); `<p id="lit">Price: $5</p>` | none | N13, N14, N15, N17 and the opacity rule |
| `big` | 20,000 generated `<div>`s of text | toast at `delay` | Per-pass cost measurement (R-perf) |
| `settle` | All the settle triggers below | — | §5 settle sweep |
| `settle-load` | `load` → `burst('load')`; `pageshow` → `burst('pageshow')` | — | navigate/reload/back/forward settle |

**`burst(tag)`:** `setTimeout(()=>{ mutate(); rec(tag+':1') }, 150); setTimeout(()=>{ mutate(); rec(tag+':2') }, 400)`, where `mutate()` appends a `<div>` to `#burst-log`. Every gap is < 300 ms (`mutationQuietMs`), so a settle that started at or after the trigger **cannot** return before `tag:2`. A no-settle call on a fast tool returns before it.

**`case=settle` triggers.** Every listener calls `rec(<tool>-trigger)` and then `burst(<tool>)`:

| Element | Listener | Tool proved |
|---|---|---|
| `#s-click` | click | click (existing; a control for the harness) |
| `#s-text` with text `Settle by text` | click | click_by_text |
| `<button aria-label="Settle role">` | click | click_by_role |
| `#s-ctx` | contextmenu | right_click |
| `#s-key` input | keydown | press_key |
| `#s-focus` input | focus | focus |
| `#s-hover` | mouseenter | hover |
| `#s-sel` select, `#s-multi` select multiple | change | select_option / select_options |
| `<input aria-label="Settle label">` | input | type_by_label |
| `#s-file` file input | change | upload_file |
| `#s-trigger` button → hidden `#s-file2` | change on `#s-file2` | upload_file_via_trigger |
| `#s-src` → `#s-dst` | dragover preventDefault; drop | drag_and_drop |
| `#s-tap` | touchend **and** pointerup | touch_tap (see the FR2-07 D15 caveat in §5) |
| `#s-pad` (300×150, fixed position) | mouseup | drag_at_points |
| `#s-point` (fixed at `left:40px; top:300px; 120×40`) | click | click_at_point |
| `<a id="s-dl" href="/download.bin">` | click | download_file |
| `#s-confirm` | onclick `if (confirm('fr2-08')) burst('dialog')` | handle_dialog |
| `#f1`, `#f2` (input on `#f2`) | input | fill_form (settle after the last field) |
| `#s-fetch` | click → `fetch('/slow?ms=800')` → then appends `#fetched`; `rec('fetchDone')` | the network-idle half, via click with settle |
| `#s-scrollbox` (overflow:auto, tall content) | scroll | scroll (SDK) |
| `#s-alert` | onclick `alert('settle')` | N18: settle + dialog hard bound |

**`fixtures/fr2-08-csp.html`** is served with the CSP header:
- `<script nonce="fr208">window.__flag=false; setTimeout(()=>{ window.__flag=true; document.body.insertAdjacentHTML('beforeend', '<p>'+'CSP '+'ready'+'</p>'); window.__fx8={events:[{what:'cspReady',at:Date.now()}]} }, 2000)</script>`
- Cases: a `js` condition `window.__flag === true` and a `text` condition `CSP ready`. B-CSP is the baseline.

**Background-tab variant (required, because D2 claims immunity to GAP-008):** the same `case=toast`, `case=js` and `case=push` pages, with the fixture tab backgrounded by the observer. Reuse FR2-01 audit-1's proven technique (`evidence/FR2-01/audit-1/adv-gap003-pagetimer.mjs`: `pageB = await observer.newPage(); await pageB.bringToFront()`). Then **assert** `document.visibilityState === 'hidden'` in the fixture tab before starting, and record `rafCallsIn500ms`. If the tab won't background (`visible`), the case is **inconclusive**, and the script fails it, since this is a claim we must prove.

---

## 4. Unit tests

### 4.0 The no-loosening rule

**No existing assertion may be changed, removed, skipped or loosened.** These must pass byte-unchanged:
- `browser-action-engine.spec.ts:1880-1970` (the settle call shape, T7)
- all FR2-01 `wait_for_selector` tests
- FR2-07's `execution-verifier.spec.ts` and `post-conditions.spec.ts` (they gate the §2.2 refactor)
- `api.spec.ts:81-105` (click with 6 args, type with 5 args)
- `api.spec.ts:108+` (FR2-01 S1–S4)
- `tools.spec.ts:332-347` (the `waitForSelector` arity)
- `parse-args.spec.ts:126-134` (`--settle`)
- FR2-07's arity tests

The **only** edit to an existing literal is **appending** `'browser.wait_for'` to `EXPECTED_BROWSER_TOOLS` (`tools.spec.ts:22-93`), which that test's "nothing extra" contract requires.

### 4.1 `browser/tests/unit/condition-wait.spec.ts` (new)

The mock page: `{url: vi.fn(), isClosed: vi.fn(()=>false), mainFrame, frames}`. Frames are `{isDetached:()=>false, evaluate: vi.fn()}`. `pollMs: 10` keeps tests fast, and real timers are used unless noted.

- **W1** `text` found on the 3rd pass (the frame's evaluate resolves false, false, true) → `satisfied:true`, `polls === 3`, `last.text === 'met'`.
- **W2** `text` only in the second frame (main answers false, child true) → satisfied on pass 1.
- **W3** `text` never, `timeoutMs 120` → `satisfied:false`. `formatConditionFailure` matches `^wait_for timed out after 120ms waiting for text="Never"` and contains `was not found in the visible text of 2 frame(s)`. It does **not** start with `Action `.
- **W4** `textGone`: found, found, not-found → satisfied; `presentAtStart === true`.
- **W5** `textGone` never present → satisfied with `polls === 1` and `presentAtStart === false`.
- **W6** `textGone`: one frame rejects `Error('Protocol error: Target closed')` on pass 1, then all frames not-found on pass 2 → pass 1 is `unavailable` (not met), satisfied on pass 2, `presentAtStart === false` (first **definitive** pass).
- **W7** `text`: pass 1 rejects `Execution context was destroyed`, pass 2 found → satisfied (the navigation is survived).
- **W8** `url` only: `page.url` returns `a`, `a`, `b?stage=done` → satisfied on pass 3. **No frame's `evaluate` is ever called** (no page contact).
- **W9** `js`: `mainFrame().evaluate` receives exactly `` `(async () => !!(await (window.x === 1\n)))()` `` (string equality) and resolves false, then true → satisfied.
- **W10** `js` rejects `Error('TypeError: Cannot read properties of undefined (reading \'ready\')')` → `fatal.kind === 'js-threw'`, `polls === 1`, `elapsedMs < 50`. The message starts with `wait_for failed: js condition threw after` and contains `Cannot read properties`.
- **W11** `js` rejects `SyntaxError: Unexpected end of input` → fatal on pass 1.
- **W12** `js` rejects `Execution context was destroyed` → not fatal, and polling continues.
- **W13** AND: `text` met from pass 1, `url` met only from pass 3 → satisfied on pass 3. Another case where `url` is never met → failure, with parts `text "S" is visible` and `url does not contain "Z" (current URL: …)`.
- **W14** `normalizePageCondition` (validation): each row of §2.1.1 throws `TypeError` with its exact message. `-5` → 0, `undefined` → 10000, `1500.7` → 1500.
- **W15** `timeoutMs: 0`: unmet → `polls === 1`, `satisfied:false`, message `timed out after 0ms`. Met → `polls === 1`, `satisfied:true`.
- **W16** Dialog:
  - `getPendingDialog` always returns `{dialogType:'alert', message:'hi'}`; `text` → `fatal.kind === 'dialog'` after ≥ 1000 ms and < 1500 ms (`pollMs 10`). No frame `evaluate` is called while the dialog is pending.
  - A `url`-only condition with the same always-pending dialog is satisfied normally.
  - A dialog pending for 1 pass (under 1000 ms), then gone → no fatal.
- **W17** The pass bound: a frame `evaluate` never resolves, `timeoutMs 200` → it returns with `satisfied:false` within `200 + 1500 + 300 ms`, and the `text` detail mentions `did not answer within 1500ms`. A `process.on('unhandledRejection')` spy records **zero** events across the test, including after rejecting the abandoned promise later.
- **W18** `isClosed()` flips to true on pass 2 → `fatal.kind === 'page-closed'`.
- **W19** (the GAP-008 regression guard) The mock page and frames define `waitForFunction`, `waitForSelector` and `evaluateHandle` as `vi.fn(() => { throw new Error('must not be called') })`. A full run over all four keys never calls them.
- **W20** Sequential probes: two frames whose evaluates push `start:i`/`end:i` to an `order` array. The order is strictly `start:0, end:0, start:1, end:1` within a pass (the same technique as `browser-action-engine.spec.ts:1365-1405`).
- **W21** Messages never contain page text: the frame's evaluate returns false. The failure message contains the needle but not a sentinel string placed only in a mock "page text" fixture. `js` is capped: a 500-char expression appears as ≤ 200 chars plus `…`.
- **W22** `describePageCondition({url:'u', text:'t', js:'x'})` gives exactly `text="t" AND url~"u" AND js(x)`, in the fixed key order.

### 4.2 `browser/tests/unit/page-settle.spec.ts` (new)

- **P1** `resolveSettleSpec`: `undefined` and `false` → `null`; `true` → the defaults; `{mutationQuietMs:100}` → `{100, 500, 5000}`.
- **P2** `waitForPageSettle(page, true)` calls `page.evaluate` exactly once with `(expect.any(Function), 300, 5000)`, and `waitForNetworkIdle` with `{idleTime:500, timeout:5000}`.
- **P3** The hard bound (D14): `evaluate` and `waitForNetworkIdle` both never resolve; `settle {timeoutMs: 100}` → it resolves in ≥ 100 ms and < 100 + 500 + 250 ms. No unhandled rejection.
- **P4** Rejections from either half are swallowed, and it resolves.
- **P5** `waitForPageSettle(page, undefined)` makes no calls.
- **P6** The hard-bound timer is cleared on normal completion: with fake timers, `vi.getTimerCount()` is 0 after resolution.

### 4.3 `browser-action-engine.spec.ts` (append `describe('FR2-08 settle via page-settle')`)

- **E1** `settle:true` on `hover` (a mock page with the `verifiedHover` needs from the existing hover tests) → `evaluate` is called with `(fn, 300, 5000)` after the hover completes. This proves the generic engine path for a newly-wired type.
- **E2** A failed action (`press_key` with no page) plus `settle:true` → `waitForNetworkIdle` is never called (settle only runs on success; pins T3).
- **E3** A settle whose `evaluate` never resolves, `settle {timeoutMs: 50}`, `maxRetries 0` → the result is `success:true` within about 1 s (D14 through the engine).

### 4.4 `capability-runtime/tests/unit/runtime.spec.ts` (append)

- **R1** A table-driven test over the 13 engine-routed methods, spying on the private `runAction` (the FR2-01 R1 technique). `settle: true` → the params contain `settle: true`. Omitted → the params have no truthy `settle`.
- **R2** Runtime-level methods (`navigate`, `goBack`, `goForward`, `reload`, `clickAtPoint`, `dragAtPoints`, `uploadFileViaTrigger`, `handleDialog`), with a stubbed `resolveTab`/`requirePage` and `vi.spyOn(runtime as any, 'settlePage')`:
  - with `settle` → `settlePage` is called once, **after** the primitive's spy (`mock.invocationCallOrder`);
  - without it → not called;
  - if the primitive throws → not called.
- **R3** `fillForm(sid, {a:'1', b:'2'}, undefined, true)` → `settlePage` is called exactly once, after both `type` calls, and `type` is never called with a `settle` argument. If every field fails → `settlePage` is not called.
- **R4** `waitFor('nope', {})` throws `TypeError` (`give at least one`), not `BrowserNotAvailableError` (validation precedes `resolveTab`). `waitFor('nope', {text:'x'})` throws `BrowserNotAvailableError`.
- **R5** `waitFor` maps a satisfied result to an `ActionResult`, with `vi.mock` of `waitForPageCondition` or a stubbed page:
  - `success:true`, `actionType:'wait_for'`;
  - `output.conditions` echoes exactly the given keys;
  - `output.polls`;
  - no `error`, no `failureScreenshot`;
  - `tab.recordAction` is called once with `actionType:'wait_for'` and `selector:'text="x"'`.
- **R6** A not-satisfied result → `success:false`, `error` starts with `wait_for timed out after`, and `output.last` is present.
- **R7** A dialog fatal → `title` is `undefined` (`readTitle` is not called, because it would block on the dialog).
- **R8** (FR2-07 present) `verification.verified === true` on success. For a vacuous `textGone` → `verified:false` with tier `unverifiable`. On failure → tier `action-failed`.

### 4.5 `mcp-server/tests/unit/tools.spec.ts` (append; plus the one-line `EXPECTED_BROWSER_TOOLS` addition)

- **M1** The tool list includes `browser.wait_for` (via the existing list test).
- **M2** Schema: `text.safeParse('')` fails and `'x'` passes. `timeoutMs.safeParse(-1)` fails, `300001` fails, `1.5` fails, `0` passes. Every key is optional at the key level.
- **M3** The handler forwards `{text:'Saved', timeoutMs:5000}` and **no undefined keys**: the spy sees `('s1', {text:'Saved', timeoutMs:5000})` (length 2, because `tabId` is absent). With a `tabId` → length 3.
- **M4** No condition keys → the runtime's `TypeError` → `isError:true`, text contains `give at least one`.
- **M5** A timeout `success:false` → the parsed `error` contains the `wait_for timed out` hint and does **not** contain `page may still be loading`. A `js condition threw` error gets its guard hint.
- **M6** **Classification guard.** `SETTLE_TOOLS` = the 23 tools with `settle` (the 3 existing plus the 20 new). `NO_SETTLE_TOOLS` = every other registered tool. For each: `'settle' in config.inputSchema` equals membership. Also assert that `SETTLE_TOOLS ∪ NO_SETTLE_TOOLS` equals the full registered set, so a future tool must be classified.
- **M7** Arity: for each of the 20 newly-wired handlers, call it without `settle` and assert the runtime spy's argument count equals the count it had before FR2-08 (a table derived from the handler list; FR2-07's arity table where applicable). With `settle:true`, the last argument `=== true`.
- **M8** The `wait_for` description contains `visible`, `ALL`, `EXPRESSION`, `side-effect free`, `background tabs`, `wait_for_selector`, `settle` and `expect`.
- **M9** `settleDesc` ends with the new `browser.wait_for` sentence.

### 4.6 CLI (`cli/tests/unit/parse-args.spec.ts`, append)

- **C1** `['waitfor','5000','--text','Saved']` → `waitForFlags {text:'Saved'}`, `cleanArgs ['5000']`, `unrecognizedFlags []`.
- **C2** All four flags together → all four keys set.
- **C3** `--text` as the last token → `waitForFlagError` matches `/--text needs a value/`.
- **C4** `waitForConditionFromArgs` with no flag → the `{error}` usage message. `'abc'` as the timeout → the whole-number error. `'300001'` → the cap error. `'0'` → `timeoutMs 0`.
- **C5** `['click','7','--text','Saved']` parses `waitForFlags {text:'Saved'}`. The CLI's D16 rejection is proved live (N-C3), since `cli.ts` can't be unit-imported.
- **C6** `['waitfor','--js','document.title === "a b"']` → `js` is exactly that string. A value starting with `--` (`--text --x`) is consumed as text `--x` (documented).
- **C7** `--settle` is still a boolean and still defaults to false (the existing tests plus one for `['press','3','Enter','--settle']`).

### 4.7 `sutradhar/tests/unit/api.spec.ts` (append)

- **S1** `page.waitFor({text:'x'})` → the stub gets `('sess-1', {text:'x'}, 'tab-1')`. `{text:'x', timeout:500}` → `('sess-1', {text:'x', timeoutMs:500}, 'tab-1')`.
- **S2** The stub resolves `{success:false, error:'wait_for timed out after 500ms …'}` → it rejects with that exact message (`ActionFailedError` if FR2-07 exported it; check `.result`).
- **S3** The stub resolves success → the promise resolves to that same result object.
- **S4** `page.goto(url, {settle:true})` → `navigate` receives `true` as its last argument (length per D13). `page.goto(url)` keeps its pre-FR2-08 arity.
- **S5** `page.press('Enter', {settle:true})` and `page.scroll('down', 300, {settle:true})` → `true` last. Without options → the pre-FR2-08 arity.
- **S6** `page.waitFor({timeoutMs: 5} as any)` → the runtime's unknown-key `TypeError` propagates (it names the allowed keys).

---

## 5. Live-verify script: `tools/scenario-suite/verify-fr2-08-conditions.mjs`

**Prerequisites:** `pnpm build` of the worktree. The script starts `startFr208Server()`.

**Output:** `evidence/FR2-08/` receives `live-mcp.jsonl`, `live-cli.jsonl`, `live-sdk.jsonl`, `baselines.jsonl` and `live-summary.json`. Each case records `{surface, case, expected, observed, pass, sentAt, recvAt, eventAt, latencyMs, gating}`. The script exits 1 if any **gating** case fails.

**Independent observer:** raw `puppeteer-core` loaded via `createRequire(packages/browser/package.json)`. Ground truth always comes from the observer:
- `__fx8.events` / `__fx8.mutations` via `frame.evaluate`
- `server.requests`
- `document.visibilityState`

Never trust `success` alone.

**Timing rule:** `sentAt`/`recvAt` are `Date.now()` around each call, compared with page `events[].at` (same OS clock). "Not-yet" checks use `Promise.race([call, delay(ms)])` where the delay must win. That's a blocking proof, not a sleep standing in for a condition. **No other sleeps.**

### 5.1 MCP (spawns `packages/mcp-server/dist/cli.js` over stdio; the observer launches Chrome, then `browser.attach`)

These are the FR2-01 §5.1 mechanics, with the stdio client copied locally.

| # | Case | Assertions (all gating unless marked) |
|---|---|---|
| L1 | **Pure-setTimeout toast (Done-when).** `navigate case=toast&delay=2000`; send `wait_for {text:'Saved successfully', timeoutMs:8000}` immediately | `success:true`. `sentAt ≤ toastShown.at ≤ recvAt`. `recvAt − toastShown.at ≤ 700`. The observer sees `#toast` at `recvAt`. **Purity:** zero `__fx8.mutations` with `at < toastShown.at − 0` after `loadAt`, and zero `server.requests` between `loadAt` and `toastShown.at`. `output.polls ≥ 10`. |
| L1b | **Settle can't see the timer.** `case=toast-click`: `click #start-toast` with `settle:true`, then `wait_for {text}` | The click returns with `recvAt < toastShown.at`, so settle returned **before** the toast (T6 proved live). The subsequent wait_for catches it (L1 rules). |
| L1c | **expect doesn't wait** (only if FR2-07 is present). `case=toast-click`: `click #start-toast` with `expect:{text:'Saved successfully'}` | `success:true`, `verification.verified:false`, a failing `expect.text` check. Then wait_for succeeds. This makes the D10 boundary executable. |
| L2 | **Background tab.** `navigate case=toast` → the observer opens `pageB` and brings it to front → assert the fixture's `visibilityState==='hidden'` and record rAF/500ms → send `wait_for {text, timeoutMs:10000}` | `success:true`. `recvAt − toastShown.at ≤ 700` (the page's own timer may fire late under throttling; latency is measured from when it actually fired). Repeat for `case=js` (`js`) and `case=push` (`url`). |
| B-RAF (informational) | Same background setup, fresh load; the **observer** runs `fixturePage.waitForFunction(() => document.body.innerText.includes('Saved successfully'), {polling:'raf', timeout:10000})` | Record the latency or timeout. Expected: a stall far beyond 700 ms. It documents why D2 exists. It's not gating, since it measures Puppeteer. |
| B-INT (informational) | The same with `{polling: 100}` | Record the latency (expected ≥ about 1 s granularity) |
| L3 | `case=spinner`: `wait_for {textGone:'Loading data…'}` | `sentAt ≤ spinnerGone.at ≤ recvAt`, `output.presentAtStart === true` |
| L4 | `case=hidden-toast`: `{text:'Order confirmed'}`; also `case=vis-toast` | `sentAt ≤ htShown.at ≤ recvAt`. The text was in `textContent` at `sentAt` (observer check), so this proves visible-only semantics. |
| L5 | `case=push`: `{url:'stage=done'}` | window rule against `pushed.at` |
| L5b | `case=nav`: `{url:'stage=arrived', text:'Arrived'}` | `success:true`. The observer confirms the new document. `output.polls ≥ 2` (the navigation spanned passes). |
| L6 | `case=js`: `{js:'window.__appState.ready === true'}` | window rule against `jsReady.at`. Zero mutations between load and `jsReady` (a pure JS condition). |
| L7 | `case=shadow` `{text:'Shadow saved'}`; `case=frame` `{text:'Frame saved'}` | window rules |
| L8 | `/csp.html`: `{js:'window.__flag === true'}` and `{text:'CSP ready'}` | Both `success:true` within the window |
| B-CSP (informational, recorded) | The observer runs `page.waitForFunction('window.__flag === true', {polling:100, timeout:5000})` on `/csp.html` | Record whether it rejects (expected: a CSP/EvalError) or succeeds. Either result is written into the changelog fragment's rationale **honestly**. |
| L9 | AND negative: `case=toast`, `{text:'Saved successfully', url:'stage=never', timeoutMs:4000}` | `success:false`. The error contains `text "Saved successfully" is visible` and `url does not contain "stage=never"`. |
| L10 | `timeoutMs:0` on `case=static`: `{text:'Price: $5'}` → success with `polls 1`; `{text:'Nope'}` → failure `timed out after 0ms` | — |
| L11 | Verification (FR2-07): L1's result has `verification.verified === true` and a `wait_for.text` `pass` check. N12's has tier `unverifiable`. | — |
| L12 | History: `browser.get_action_history` contains a `wait_for` entry with `selector: 'text="Saved successfully"'` | — |
| R-perf (recorded, gating only on the bound) | `case=big&delay=2000`, `{text}` | Median per-pass cost = `(recvAt − sentAt)/polls`, recorded. Gate: `success:true` and latency ≤ 1500. |

**Settle sweep (MCP):** `navigate case=settle` once per group, then for each newly-wired tool run the trigger call with `settle:true`.
- **Gate:** the observer sees `<tool>:2` with `at ≤ recvAt`, and `#burst-log` has both entries at `recvAt`.
- **Tools:** click_by_text, click_by_role, right_click, press_key (after `focus #s-key`), focus, hover, select_option, select_options, type_by_label, upload_file (a temp file), upload_file_via_trigger, drag_and_drop, touch_tap, click_at_point (at the `#s-point` centre), drag_at_points (across `#s-pad`), download_file (`#s-dl`), handle_dialog (`click #s-confirm` → `handle_dialog accept settle:true`), fill_form (`{"#f1":"a","#f2":"b"}`), navigate/reload (`case=settle-load`: gate on `load:2`), go_back/go_forward (a two-entry history of `settle-load` pages: gate on `pageshow:2`).
- **Network half:** `click #s-fetch settle:true` → `recvAt ≥ fetchDone.at` and `server.requests` shows `/slow` completed.
- **Controls without settle (gating):** click_at_point and press_key → `recvAt < <tool>:2.at`. This proves the sweep can distinguish. For other tools the control is informational.
- **touch_tap:** if the observer sees no `touch_tap-trigger` event at all (no trusted touch delivered without touch emulation, FR2-07 D15), the case is recorded as `not-provable: trigger not delivered` and is **non-gating**, with the reason in the summary.

### 5.2 CLI (spawns `packages/cli/dist/cli.js`; `SUTRADHAR_CLI_STATE_DIR` in scratch; `sutradhar-cli-*` temp dirs snapshotted before/after, as in FR2-01 §5.2)

The FR2-01 D2 rationale applies: each command re-attaches (0.5–1.5 s), so causality is proven with `mode=manual`.

| # | Case | Assertions |
|---|---|---|
| C-L1 | **Pure-setTimeout toast.** `nav case=toast&mode=manual` → spawn `waitfor 15000 --text "Saved successfully"` → race child-exit against `delay(2500)` (the delay must win) → the observer calls `__fx8.arm(2000)` (a pure 2 s `setTimeout`, nothing else) | The child exits 0 with `exitAt ≥ toastShown.at` and `exitAt − toastShown.at ≤ 1500`. stdout matches `/^Condition met after \d+ms: text="Saved successfully"/`. The purity checks are as in L1. |
| C-L2 | `waitfor --url stage=done` + arm (`case=push`); `waitfor --js "window.__appState.ready === true"` + arm (`case=js`); `waitfor --text-gone "Loading data…"` + arm (`case=spinner`) | The same causality rule for each |
| C-L3 | `waitfor 3000 --text "Never appears"` | exit 1; stdout `Wait failed: wait_for timed out after 3000ms` |
| C-L4 | `waitfor 3000 --text-gone "Never was here"` | exit 0; stderr has `Note: "Never was here" was not present` |
| C-L5 | Settle: `nav <settle-load> --settle`, `press #s-key x --settle`, `hover #s-hover --settle`, `select #s-sel v2 --settle`, `clickpoint <x> <y> --settle`, `dragpoints … --settle`, `clicktext "Settle by text" --settle`, `clickrole button "Settle role" --settle`, `upload #s-file <tmp> --settle`, `drag #s-src #s-dst --settle`, `download #s-dl <scratch>/dl --settle` | For each, the time the child's stdout status line arrives is ≥ `<tool>:2.at` (observer) |
| C-L6 | GAP-002: `SCENARIO_FILTER=UC-06 node tools/scenario-suite/run-cli.mjs` (and UC-01) | UC-06 passes using `waitfor`, and the harness JSON detail shows the `waitfor` stdout. An external-site failure (the-internet down or blocked) is recorded as **Blocked**, not a pass, and not an FR2-08 failure. |
| **Negatives** | N-C1: `waitfor` with no flags → exit 1, usage. N-C2: `waitfor abc --text x` → exit 1. N-C3 (D16): `click #s-click --text Saved` → exit 1, `only valid with "waitfor"`, **and the observer confirms `s-click` was never clicked**. N-C4: `case=alert&delay=500`, `waitfor 10000 --text "Never appears"` → fails in < 3000 ms with `blocked by an open alert dialog`, exit 3 if FR2-04 is present, else 1. | — |

**Teardown:** `close`, the observer disconnects, assert `chromePid` is dead, remove only the new `sutradhar-cli-*` dirs (with a lock retry), and remove the scratch state dir.

### 5.3 SDK (imports `packages/sutradhar/dist/index.js`)

- **SDK-L1** `page.goto(case=toast)`, then `await page.waitFor({text:'Saved successfully', timeout: 8000})`: the L1 window and purity rules. **Background:** `const other = await browser.newPage(); await other.bringToFront()`. The observer confirms the first page is `hidden`, then it's repeated.
- **SDK-L2** `page.waitFor({js:'window.__appState.ready === true'})` and `page.waitFor({url:'stage=done'})` (on their cases).
- **SDK-L3** Settle: `page.goto(<settle-load>, {settle:true})` resolves after `load:2`. `page.press('x', {settle:true})` after focusing `#s-key` via `page.click('#s-key')` resolves after `press_key:2`. `page.scroll('down', 300, {settle:true})` on `#s-scrollbox` resolves after `scroll:2`. `page.download`/`page.uploadFile` get settle only if they have options.
- **Negatives:**
  - `page.waitFor({text:'Never appears', timeout:1500})` **rejects** with `/wait_for timed out after 1500ms/`.
  - `page.waitFor({})` rejects `TypeError /at least one/`.
  - `page.waitFor({js:'window.__nope.ready'})` rejects in < 1000 ms with `/js condition threw/`.

**Final check for all surfaces:** count the Chrome processes whose command line contains the scratch profile paths or new `sutradhar-cli-*` dirs (must be 0), and check `server.close()`. Write it to `live-summary.json`.

---

## 6. Negative cases (each runs live on MCP; † also on CLI and SDK)

| # | Case | Expected |
|---|---|---|
| N1† | The condition never becomes true: `{text:'Never appears', timeoutMs:1500}` | `success:false`. The error starts with `wait_for timed out after 1500ms waiting for text="Never appears"`. Elapsed is in [1500, 1500+1500+300] (no retries, D8). No `failureScreenshot`. `retriesUsed` is absent. The MCP hint names `browser.snapshot`. CLI exit 1. The SDK rejects. |
| N2† | The js throws: `{js:'window.__nope.ready'}` | Fails in < 1000 ms, `polls === 1`. The error contains `js condition threw` and the page's `Cannot read properties of undefined`. The MCP hint suggests `?.`. |
| N3 | js `SyntaxError`: `{js:'window.__x ==='}` | Fails fast with `SyntaxError` |
| N4† | No keys: MCP `{sessionId}` only; CLI `waitfor`; SDK `waitFor({})` | MCP `isError` `give at least one`; CLI exit 1 usage; SDK `TypeError`. The browser is never touched: `resolveTab` isn't reached (R4). |
| N5 | An empty string: `{text:''}` | MCP zod rejection; SDK `TypeError` |
| N6 | `{text:'X', textGone:'X'}` | `TypeError` `can never be satisfied` |
| N7 | Multiple keys where one never holds (L9) | A timeout listing met and unmet keys (AND proven) |
| N8 | `timeoutMs` −1 or 300001 (MCP); SDK `timeout: 'abc'` | zod rejection; SDK `TypeError` |
| N9 | SDK/JS `{selector:'#t'}` | `TypeError` pointing to `wait_for_selector` |
| N10† | A dialog: `case=alert&delay=500`, `{text:'Never appears', timeoutMs:15000}` | Fails with `blocked by an open alert dialog` within about 2.5 s of `alertOpened.at`, **not** 15 s or 30 s. A `url`-only wait on the same page (`{url:'case=alert'}`) succeeds while the dialog is open. |
| N11 | The tab closes mid-wait: the observer closes the fixture page 500 ms into `{text:'Never', timeoutMs:10000}` | Fails in < 1500 ms after the close, with `the tab was closed while waiting`. The MCP server stays healthy (a follow-up `browser.list_tabs` succeeds). |
| N12† | Vacuous `textGone:'Never was here'` | `success:true`, `polls 1`, `presentAtStart:false`. FR2-07 verification tier `unverifiable`. CLI `Note:`. |
| N13 | Hidden text is never counted: `case=static`, `{text:'Hidden forever', timeoutMs:1000}` | Timeout. The observer confirms the text **is** in `textContent`. |
| N14 | Input values aren't text: `{text:'Typed value', timeoutMs:1000}` times out; `{js:"document.querySelector('#inp').value === 'Typed value'"}` succeeds | The documented D3 behavior |
| N15 | Selector-looking text is literal: `{text:'text=Submit >> nth=0', timeoutMs:1000}` | A plain timeout. **No** `InvalidSelectorError` and no FR2-06 hint (text is never parsed as a selector, §0.6 D6/§7). |
| N16 | `timeoutMs:0` (L10) | Check once, both outcomes |
| N17 | The D3 divergence, documented: `{text:'Zero box text'}` succeeds immediately, while `wait_for_selector` on that div with `state:'visible'`, `timeoutMs:500` times out | Both results are recorded side by side (documents the divergence, doesn't hide it) |
| N18 | Settle + dialog hard bound (T5/D14): `click #s-alert settle:{timeoutMs:2000}` | The click returns within 2000 + 500 + 1500 ms of `sentAt`, not after 30 s. Run it on the **pre-change build** too (`--baseline` flag) to record the old hang as a before/after pair, capped at 35 s in the script. |
| N19 | Opacity rule parity: `{text:'Ghost text'}` succeeds immediately (opacity:0 counts, the same as FR2-01) | — |

---

## 7. Risks

### 7.1 Behavior and design risks

1. **The `innerText` cost per pass.** Every pass forces style and layout in every frame. On very large DOMs, a 100 ms cadence could cost real CPU. Mitigations:
   - probes are sequential, and a pass can't overlap the next one;
   - the pass bound is 1500 ms;
   - R-perf measures a 20k-node page, and any result over budget becomes a gap (FR2-02's precedent: measure, don't truncate).

   `url`-only waits have zero page cost.
2. **Semantics people may not expect (all documented):**
   - case-sensitive;
   - no whitespace normalization, and text split across block elements gets `\n` from `innerText`;
   - input values excluded;
   - 0×0 overflow-hidden text included (N17);
   - `textGone` is vacuous on a typo (surfaced via `presentAtStart`, the CLI `Note:` and verification tier `unverifiable`).
3. **`js` runs repeatedly in the page's main world.** Side effects repeat, and a hostile page can make it lie, the same as `eval`. `js` is main-frame only; there's no `frameSelector` (logged as a follow-up). An async predicate that never resolves turns every pass "unavailable", and the timeout message says so.
4. **Long waits vs client timeouts.** MCP clients may abort a call before a 300 s wait ends. The description recommends reasonable timeouts. The CLI cap stays under FR2-04's watchdog (D8).
5. **Bypassing the per-tab queue (D1)** is intentional. A concurrent same-tab action and a wait interleave only read-only CDP calls, unless a caller's `js` mutates, which is documented as forbidden.
6. **Positional parameter growth (D13).** `settle` sits after `expect` on the newly-wired methods but before it on click/type/scroll. `tsc`'s weak-type detection catches a swapped `{text}`/`{mutationQuietMs}` object. `trimTrailingUndefined` keeps every pinned arity. A later item (FR2-13/14) could introduce an options-bag overload; that's not done here.
7. **Settle hard bound (D14)** changes pathological timing only: settle now returns by `timeoutMs + 500 ms` even when a dialog or throttling stalls the in-page part. That's strictly an improvement, but it is a behavior change, recorded in the changelog.
8. **The FR2-07 API may drift in its own audits.** The §2.2 refactor and D11 are specified as contracts (the one-definition rule; the success/vacuous/failure → tier invariant), so the Executor adapts names without changing meaning, and must stop rather than fork a copy of the visible-text function.
9. **FR2-04 interplay.** With the CLI default dialog policy `report`, a dialog stays pending, and `waitfor` fails fast with exit 3, which is consistent. Under `accept`/`dismiss` policies, the 1000 ms grace absorbs auto-handling.
10. **Background-tab proof depends on the environment.** If Chrome in this environment won't background the tab (`visibilityState` stays `visible`), L2 is inconclusive, and the script **fails** rather than claiming immunity.
11. **External-site dependency in GAP-002** (UC-06 on the-internet, UC-01 on sannysoft). A site outage makes C-L6 Blocked, not green. The UC-01 conversion may legitimately end as "sleep kept, comment corrected" (D17).
12. **Tool count and docs merge order.** FR2-12 also adds a tool. The docs must say the real count at merge time, and the tools.spec list is the source of truth (FR2-17 re-checks).
13. **Selector dialect (FR2-06) does not apply.** `wait_for` accepts no selector anywhere: `text`/`textGone` are compared as substrings of `innerText` and never passed to `querySelector`, `url` is a string compare, and `js` is opaque caller code. So there's nothing for FR2-06's validator to check, and running it would create false positives (a page's text can legitimately contain `>>` or `text=`, see N15). The only cross-over is the optional FR2-06 hint appended when caller JS itself throws "is not a valid selector" (D6).

### 7.2 New gaps for the Orchestrator to log in `gaps.md`

| gap | severity | description | home |
|---|---|---|---|
| GAP-new-1 | minor | Remaining fixed sleeps in `run-cli.mjs` (`:189, :257, :271, :459, :537`) and the equivalents in `run-mcp.mjs`/`run-sdk.mjs` | FR2-13 (ports UCs with `wait_for` steps) |
| GAP-new-2 | minor | `runtime.audit` (`:1431`) and `compareUrls` (`:1485`, `:1489`) use fixed `settleMs` sleeps | FR2-12 (switch to `waitForPageSettle` plus a bounded minimum dwell for LCP) |
| GAP-new-3 | major, **fixed in FR2-08** | Engine settle had no Node-side bound: settle plus an open dialog blocked until the 30 s auto-dismiss (T5) | FR2-08 D14 |
| GAP-new-4 | minor | No CLI verbs for focus, touch_tap, type_by_label, select_options, fill_form, upload_via_trigger, back/forward/reload, so settle can't be reached for them on the CLI (overlaps GAP-028) | follow-up |
| GAP-new-5 | minor | `wait_for.js` is main-frame only (no `frameSelector`) | follow-up |

### 7.3 Changelog fragment (`evidence/FR2-08/changelog-fragment.md`)

- **New:** `browser.wait_for` / `sutradhar waitfor` / `page.waitFor`, with `text`, `textGone`, `url` and `js` conditions (AND), Node-side polling (background-tab and CSP safe), no retries, and 0 meaning check once.
- **New:** `settle` on every interaction and navigation tool (the §2.6 list).
- **Changed:** settle now has a hard upper bound of `timeoutMs + 500 ms` (it previously could block up to 30 s behind an open dialog).
- **Changed (CLI):** `--text/--text-gone/--url/--js` on any verb other than `waitfor` is an error.
- **Changed (docs):** AGENT_SETUP gains "Waiting: wait on conditions, never sleep".
- Include the B-CSP and B-RAF baseline outcomes as the stated rationale for not using `waitForFunction`.

---

## 8. Rollback

`git revert <FR2-08 commit>`. There's no persisted state, no on-disk format, and no data migration. After a revert:
- `wait_for` is gone from all three surfaces, so the MCP tool count drops by one. `EXPECTED_BROWSER_TOOLS` reverts with it.
- Settle returns to click/type/scroll only, and the unbounded settle (GAP-new-3) returns. Re-open that gap.
- The FR2-07 visible-text refactor (§2.2) reverts to FR2-07's own function. FR2-07's tests gate both states.
- `run-cli.mjs:152/437` go back to their sleeps (GAP-002 re-opens).
- AGENT_SETUP (both copies) and the three READMEs revert.
- Append a `decisions.md` entry, mark the ledger row `TODO`/`BLOCKED`, and drop the changelog fragment.

Dependents: FR2-13's scenario `wait_for` step would need this primitive, or a rework. FR2-15's migration rows `waitForFunction`/`waitForURL` map to `wait_for` and would need re-mapping. FR2-11's history would simply stop receiving `wait_for` entries.

---

### Critical Files for Implementation
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\actions\browser-action-engine.ts` (settle extraction at `:106-110`, `:275-278`, `:1620-1649`; FR2-01's Node-side polling precedent at `:1242-1254`, `:1351-1365`)
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\capability-runtime\src\runtime.ts` (new `waitFor`; `settle` on 21 methods; `settlePage`)
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\mcp-server\src\tools.ts` (new `browser.wait_for`; `settleSchema` on 20 more tools; `ERROR_HINTS`)
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\cli.ts` (with `parse-args.ts`: `waitfor` verb, `--settle` wiring, the D16 rejection)
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\sutradhar\src\page.ts` (`Page.waitFor`; settle on `goto`/`press`/`scroll`), plus the new `packages\browser\src\actions\condition-wait.ts` and `page-settle.ts`