# FR2-01 — `wait_for_selector` visibility states: implementation spec

**Item:** FR2-01 (Phase 1, silent-wrongness bug). **Decision in force:** §4.3 of the loop prompt,
the default becomes `visible`. This is the one intentional behavior change. **Version:** this
item contributes to the 0.5.0 minor bump but does **not** bump anything. The later release item
owns the version bump and CHANGELOG. This item only writes a changelog fragment (see §1).

**The bug:** `packages/browser/src/actions/browser-action-engine.ts:639-641` calls
`resolveElement(page, 'pierce/'+sel, { timeoutMs })` with no `visible`. `resolveElement` passes
`visible: undefined` to Puppeteer (`:1064`, `:1077`, `:1110`), so Puppeteer only checks that the
element is attached. The docs claim "visible": `packages/mcp-server/src/tools.ts:680`,
`packages/capability-runtime/src/runtime.ts:708`, `packages/cli/src/cli.ts:831`,
`packages/cli/README.md:67`, `packages/mcp-server/README.md:62`.

**Proof the bug matters in this repo:** in the-internet `dynamic_loading/1`, `#finish` is in the
DOM with `display:none` from page load. `run-mcp.mjs:375`, `run-sdk.mjs:359`,
`engine-comparison/sutradhar-harness.mjs:62` and `pinchtab-harness.mjs:73` return instantly
today. They then read `textContent` "Hello World!", which exists even while hidden, so those
scenarios pass vacuously.

**Four extra findings the design depends on (found by the Planner while tracing the code, not in
the original finding):**
- **Hidden success looks like "not found".** Puppeteer `waitForSelector({hidden:true})` resolves
  to **`null` on success** (puppeteer-core 25.5.0 `src/common/QueryHandler.ts` `waitFor`:
  returns `null` when the polled value is not a handle). `resolveElement` maps every rejection to
  `null` too (`:1063-1065`). So `hidden` can't be routed through `resolveElement`; it needs its
  own helper.
- **The outer race hides the state.** `executeActionSerialized` races dispatch against
  `params.timeoutMs ?? 15000` (`:219`, `:241`). The `wait_for_selector` inner wait uses
  `params.timeoutMs ?? 10000` (`:640`). When a caller passes `timeoutMs`, the two are equal and
  race each other. The outer one usually wins and produces the generic
  `Action wait_for_selector timed out after Xms`, which names no state.
- **Retries triple the wait.** The engine default is `maxRetries = 2` (`:220`) and
  `runtime.waitForSelector` doesn't override it. A timing-out wait runs 3 attempts plus 0.5s and
  1.0s backoff (`:312`) plus a failure screenshot (`:323-330`).
- **Puppeteer checks only the first match per frame.** The query returns the first match (per
  frame) and applies `checkVisibility` to that node only (`QueryHandler.ts` `waitFor` →
  `PuppeteerUtil.checkVisibility(node, visible)`).

---

## 1. Files to touch

| # | File | Reason |
|---|---|---|
| 1 | `packages/browser/src/actions/action-types.ts` | Add the `WaitForSelectorState` type and the optional `ActionParams.state` field, the engine-level public shape. |
| 2 | `packages/browser/src/actions/browser-action-engine.ts` | Implement the three states: honor `state` in the `wait_for_selector` case (`:636-644`), add a hidden-wait helper and a timeout-diagnosis helper, and give the outer race a grace period for this action (`:219`) so the state-naming error wins. |
| 3 | `packages/capability-runtime/src/runtime.ts` | Add an optional 5th positional `state` param to `waitForSelector` (`:708-720`) and fix its JSDoc. |
| 4 | `packages/capability-runtime/src/index.ts` | Re-export `WaitForSelectorState` next to the existing `SettleSpec` re-export (`:18`) so the MCP server, CLI and SDK can use it. |
| 5 | `packages/mcp-server/src/tools.ts` | Add the `state` enum to the `browser.wait_for_selector` schema, pass it through, rewrite the description (`:676-696`), and add one targeted `ERROR_HINTS` entry (`:42-51`). |
| 6 | `packages/cli/src/parse-args.ts` | Parse and validate the new `--state <visible|attached|hidden>` valued flag. |
| 7 | `packages/cli/src/cli.ts` | Destructure the flag (`:20-39`), reject an invalid one in `main()` (`:727-735`), pass it through in `cmdWait` (`:447-455`), and update the `--help` text (`:831`, plus a Flags entry). |
| 8 | `packages/sutradhar/src/page.ts` | Add the new SDK method `Page.waitForSelector(selector, { state?, timeout? })`. It throws on failure. |
| 9 | `packages/sutradhar/src/index.ts` | Export the `WaitForSelectorOptions` and `WaitForSelectorState` types (`:67-73`). |
| 10 | `packages/browser/tests/unit/browser-action-engine.spec.ts` | Add engine unit tests (§4). |
| 11 | `packages/capability-runtime/tests/unit/runtime.spec.ts` | Add a pass-through test. |
| 12 | `packages/mcp-server/tests/unit/tools.spec.ts` | Add schema, pass-through, description and hint tests. The tool count is unchanged. |
| 13 | `packages/cli/tests/unit/parse-args.spec.ts` | Add `--state` parsing tests. |
| 14 | `packages/sutradhar/tests/unit/api.spec.ts` | Add `Page.waitForSelector` delegation and throw-on-failure tests. |
| 15 | `tools/scenario-suite/fixtures/fr2-01-wait-states.html` (new) | The live fixture (§3). |
| 16 | `tools/scenario-suite/verify-fr2-01-wait-states.mjs` (new) | The live-verify script for MCP, CLI and SDK (§5). |
| 17 | `packages/cli/README.md` (`:67`), `packages/mcp-server/README.md` (`:62`), `packages/sutradhar/README.md` (Page table `:123-137`) | Make the descriptions match behavior (Done-when). |
| 18 | `.ai/loop/field-report-2/evidence/FR2-01/changelog-fragment.md` (new) | Breaking-default migration note for the later 0.5.0 item. Don't create a CHANGELOG now; none exists in the repo. |

**Not touched, on purpose:**
- `AGENT_SETUP.md`: it only lists the tool name (`:67`) and makes no behavioral claim. The
  "wait on conditions" section belongs to FR2-08/FR2-17.
- `packages/mcp-server/src/server.ts`: nothing relevant.
- `packages/browser/src/verifier/execution-verifier.ts`: the verification contract is FR2-07.
  This item adds `output.state` for FR2-07 to use.

---

## 2. API/schema diff

**A single default.** `'visible'` is applied in exactly one place: the engine. Every surface
passes `undefined` through unchanged.

### 2.1 Engine types (`action-types.ts`)

```ts
// NEW
/** Element state 'wait_for_selector' waits for. See BrowserActionEngine for the exact visibility test. */
export type WaitForSelectorState = 'visible' | 'attached' | 'hidden';

export interface ActionParams {
  // ...existing fields unchanged...
  /** Only for 'wait_for_selector'. Default 'visible'. */
  readonly state?: WaitForSelectorState;   // NEW, optional
}
```

### 2.2 Engine behavior (`browser-action-engine.ts`)

| | Before | After |
|---|---|---|
| `wait_for_selector` inner wait | `resolveElement(..., { timeoutMs: params.timeoutMs ?? 10000 })`, attached only | `state = params.state ?? 'visible'`, `waitMs = Math.max(1, params.timeoutMs ?? 10000)` |
| `state: 'visible'` | n/a | `resolveElement(page, 'pierce/'+sel, { visible: true, timeoutMs: waitMs })` |
| `state: 'attached'` | (was the only behavior) | `resolveElement(page, 'pierce/'+sel, { timeoutMs: waitMs })`, the old behavior exactly |
| `state: 'hidden'` | n/a | New private helper `waitForHiddenInAllFrames(page, fullSelector, waitMs): Promise<boolean>` (algorithm below) |
| Unknown `state` value (JS callers that bypass types) | n/a | Throw `Invalid wait_for_selector state "<x>" — expected one of: visible, attached, hidden.` |
| Success `outputData` | `{ foundSelector }` | `{ foundSelector, state }` for visible/attached. `{ foundSelector, state: 'hidden', matchedAtStart: boolean \| undefined }` for hidden. `foundSelector` is kept for shape stability. |
| Outer race timeout (`:219`) | `params.timeoutMs ?? 15000` | For `wait_for_selector` only: `Math.max(1, params.timeoutMs ?? 10000) + 2000` (grace constant `WAIT_FOR_SELECTOR_OUTER_GRACE_MS = 2000`). Other actions unchanged. |
| Failure message | `No element found for selector: X` (when the inner wait won) or `Action wait_for_selector timed out after Xms` (when the outer race won) | Always a state-naming message (below) |

About `timeoutMs <= 0`: clamping to 1ms prevents Puppeteer's `timeout: 0` meaning "wait
forever". Document it as "check once, don't wait".

**`waitForHiddenInAllFrames` algorithm**

It mirrors `resolveElement`'s PROB-015-safe pattern: no `Promise.any`, and every probe is fully
awaited.
- Live frames = `page.frames().filter(f => !f.isDetached())`, falling back to
  `[page.mainFrame()]`.
- **One frame:** `frame.waitForSelector(fullSelector, { hidden: true, timeout: waitMs })`.
  Resolve → `true`, reject → `false`.
- **Several frames:** loop until the deadline. Each pass re-reads live frames and probes each one
  with `waitForSelector(fullSelector, { hidden: true, timeout: Math.min(150, remaining) })`.
  Guard `remaining > 0` so the probe timeout is never 0. If **every** live frame resolves in the
  same pass, return `true`. Otherwise start the next pass.
- **Meaning:** `hidden` ⇔ in every live frame, the first match is absent or not visible. That's
  the exact negation of `visible`, which is "some frame's first match is visible", the same as
  `resolveElement`'s any-frame behavior.
- **`matchedAtStart`:** before waiting, run a best-effort `frame.$(fullSelector)` over live
  frames inside try/catch, bounded to about 500ms. `true` if any frame matched. Put it in
  `outputData` so a caller can spot a typo'd selector that "hid" instantly.

**Timeout diagnosis**

New private helper `describeWaitTimeout(page, selector, fullSelector, state, waitMs)`,
best-effort. Wrap it in try/catch and cap the whole thing at 1000ms with `Promise.race` so it
fits inside the 2000ms grace. It uses
`frame.$$eval(fullSelector, els => els.map(el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return !['hidden','collapse'].includes(s.visibility) && r.width > 0 && r.height > 0; }))`
per live frame. That check copies Puppeteer's rule exactly.

Error messages. None may start with `Action wait_for_selector timed out after `, or
`isTimeoutError` (`:432-434`) would misclassify them.

| Case | Message |
|---|---|
| visible, zero matches | `wait_for_selector timed out after ${waitMs}ms waiting for state=visible: ` + `await this.describeMissingElement(page, selector)`. This keeps the node-id staleness guidance and the `no element found` substring the MCP hint relies on. |
| visible, matches exist, none visible | `wait_for_selector timed out after ${waitMs}ms waiting for state=visible: ${n} element(s) match "${selector}" and are attached to the DOM, but none is visible (display:none, visibility:hidden, or zero width/height). Pass state "attached" if DOM presence is enough.` |
| visible, first match hidden, a later match visible | Same prefix + `the first match is not visible, but ${k} later match(es) are. Visibility is checked on the first match in document order; use a more specific selector.` |
| attached | `wait_for_selector timed out after ${waitMs}ms waiting for state=attached: ` + `describeMissingElement(...)` |
| hidden | `wait_for_selector timed out after ${waitMs}ms waiting for state=hidden: an element matching "${selector}" is still visible.` |

**No extra calls on the visible/attached success path.** Don't add any `handle.evaluate` calls
there. The existing duplicate-guard test (`spec.ts:681-693`) uses a handle whose `evaluate` is a
bare `vi.fn()` and must keep passing untouched.

### 2.3 Runtime (`runtime.ts:708-720`)

```ts
// BEFORE
/** Wait for a selector to appear (and be visible) before returning. */
public async waitForSelector(sessionId: string, target: string, timeoutMs?: number, tabId?: string): Promise<ActionResult>

// AFTER — positional, matching this file's existing convention (click/type/scroll grew positional params)
/** Wait until the element matched by `target` reaches `state` (default 'visible'; 'attached' = present in
 *  the DOM, visibility ignored; 'hidden' = absent or not visible, and succeeds immediately if nothing matches).
 *  Visible means computed visibility not hidden/collapse AND a non-empty bounding box (opacity is ignored),
 *  checked on the FIRST match. */
public async waitForSelector(sessionId: string, target: string, timeoutMs?: number, tabId?: string,
                             state?: WaitForSelectorState): Promise<ActionResult>
// body: runAction(sessionId, { actionType: 'wait_for_selector', selector: normalizeTarget(target), timeoutMs, state }, tabId)
```

Import `WaitForSelectorState` from `@sutradhar/browser`. `index.ts:18` becomes
`export type { SettleSpec, WaitForSelectorState } from '@sutradhar/browser';`. Existing 2–4-arg
callers are unaffected, apart from the default change.

### 2.4 MCP (`tools.ts:676-696`)

```ts
inputSchema: {
  sessionId: z.string(),
  target: z.string().describe(targetDesc),
  timeoutMs: z.number().int().optional().describe('Defaults to 10000ms.'),
  tabId: z.string().optional(),
  state: z.enum(['visible', 'attached', 'hidden']).optional().describe(          // NEW
    'Defaults to "visible". "visible": the element exists AND is visible (non-empty box, not visibility:hidden; ' +
    'opacity is ignored). "attached": it only has to exist in the DOM. "hidden": it is removed or not visible; ' +
    'succeeds immediately if nothing matches, so double-check the selector.'),
},
// handler: ({ sessionId, target, timeoutMs, tabId, state }) => runtime.waitForSelector(sessionId, target, timeoutMs, tabId, state)
```

New description:

> Wait for an element to reach a state before returning: "visible" by default, or "attached" /
> "hidden". Use this instead of guessing a fixed delay for content that loads or appears
> asynchronously (AJAX, toasts, animations). Visibility is checked on the first element matching
> the selector.

New `ERROR_HINTS` entries, inserted **first** in the list (first match wins; `withHint` is at
`:55-59`):
- `['but none is visible', 'The element exists but is hidden. Pass state:"attached" to wait only for DOM presence, or trigger whatever reveals it.']`
- `['waiting for state=hidden', 'The element is still visible. Check the selector, or raise timeoutMs.']`

The "none visible" error also contains `timed out`, so without the first entry the hint would be
the misleading "The page may still be loading".

### 2.5 CLI

**`parse-args.ts`**
- New `ParsedArgs` fields: `stateFlag: 'visible' | 'attached' | 'hidden' | undefined` and
  `stateFlagGivenButInvalid: boolean`.
- Add `'--state'` to `KNOWN_FLAGS` (`:121-136`) and its value index to `isConsumedValue`
  (`:137-144`).
- Invalid means the flag is present but the value is missing or not one of the three.

**`cli.ts`**
- Destructure both new fields.
- In `main()`, after the viewport check (`:733-735`):
  `if (stateFlagGivenButInvalid) printErrorAndExit('--state must be one of: visible, attached, hidden (e.g. wait "#toast" --state hidden)')`.
- `cmdWait`: `runtime.waitForSelector(sessionId, ref!, timeoutMs, undefined, stateFlag)`. Success
  output changes from `` `${ref} appeared` `` to
  `` `${ref} is ${state === 'hidden' ? 'hidden or absent' : state} (state=${state})` ``, where
  `state = stateFlag ?? 'visible'` (display only). Failure output is unchanged:
  `Wait failed: <error>` with exit code 1.
- Usage string: `usage: sutradhar wait <ref> [timeoutMs] [--state visible|attached|hidden]`.
- Help text at `:831` becomes
  `wait <ref> [timeoutMs] [--state S]  Wait for an element to become visible (default), --state attached (just in the DOM), or --state hidden (removed or not visible)`,
  plus a Flags entry for `--state`.
- **Flag on other verbs:** `--state` on any verb other than `wait` is ignored, the same way
  `--settle` is today. Record this in `decisions.md`.

### 2.6 SDK (`packages/sutradhar/src/page.ts`, new method)

```ts
export type { WaitForSelectorState } from '@sutradhar/capability-runtime';
/** Options accepted by {@link Page.waitForSelector} (Playwright-style names). */
export interface WaitForSelectorOptions {
  /** 'visible' (default) | 'attached' | 'hidden'. */
  state?: WaitForSelectorState;
  /** Milliseconds; defaults to 10000. */
  timeout?: number;
}
/** Wait for `selector` (CSS or a snapshot [#id]) to reach `options.state`. Throws on timeout,
 *  with a message naming the state it waited for. */
public async waitForSelector(selector: string, options?: WaitForSelectorOptions): Promise<void> {
  const r = await this.runtime.waitForSelector(this.sessionId, selector, options?.timeout, this.tabId, options?.state);
  if (!r.success) throw new Error(r.error ?? `waitForSelector("${selector}") failed`);
}
```

- **Throws instead of returning a result.** `click`/`type` swallow `success:false`, but a wait
  that returns silently on timeout is the same silent-wrongness bug class this item exists to
  fix. Throwing also matches Puppeteer and Playwright. Record this in `decisions.md`.
- **Exports:** `index.ts` exports `type WaitForSelectorOptions` and `type WaitForSelectorState`.
- **No `Browser`-level method.**

### 2.7 Threading summary

- **CLI:** `--state` → `parseArgs.stateFlag` → `cmdWait` → `runtime.waitForSelector(..., stateFlag)`
- **MCP:** `args.state` (zod-validated) → `runtime.waitForSelector(..., state)`
- **SDK:** `options.state` → `runtime.waitForSelector(..., options.state)`

All three then go `runAction` → `ActionParams.state` → engine `params.state ?? 'visible'`.

---

## 3. Fixture design: `tools/scenario-suite/fixtures/fr2-01-wait-states.html`

Load it via `pathToFileURL(...)`, the same as `scenarios.mjs:16`. `file:` is allowed by
`restrictNavigationToLocal` (`runtime.ts:1731`).

**Main mechanism: `display:none`.** It's the most common real toast/modal pattern. It's also
exactly the the-internet `#finish` case that currently passes vacuously. And `textContent` stays
readable while hidden, which is what makes the attached-only bug silently wrong. Other
mechanisms get their own elements so the Done-when bullet "`display:none` / `visibility:hidden` /
zero-size doesn't satisfy visible" is proven per mechanism.

**Modes, chosen by URL hash:**
- `#auto` (default): timers start at `load`, reveal/hide/remove at **1500ms** (`#delay=<ms>`
  overrides).
- `#manual`: no timers. The observer drives transitions through `window.__fx.reveal(id)`,
  `__fx.hide(id)` and `__fx.remove(id)`.

**Timeline:** every transition pushes `{ id, what, at: Date.now() }` onto `window.__fx.events`.
`Date.now()` in the page and in Node read the same OS clock, so page times and script times
compare directly.

| id | At load | Transition (auto: t=1500ms) | Purpose |
|---|---|---|---|
| `#toast` (class `toast`, text "Saved!") | In DOM, `display:none` | → `display:block` | Done-when toast. visible waits about 1.5s; attached returns immediately. |
| `#vis-hidden` | `visibility:hidden` (has size) | → `visible` | Mechanism 2 |
| `#zero-size` | `width:0;height:0;overflow:hidden` | → `width:120px;height:24px` | Mechanism 3 |
| `#ancestor-hidden > #child` | Parent `display:none` | Parent → `block` | Inherited hiding |
| `#opacity-zero` | `opacity:0`, sized, never changes | none | Documents that opacity:0 counts as VISIBLE (§6) |
| `#offscreen` | `position:absolute;left:-9999px`, sized | none | Off-screen counts as visible |
| `#banner` | Visible | → `display:none` | hidden-by-CSS |
| `#spinner` | Visible | → `remove()` | hidden-by-removal |
| `#late` | Not in DOM | Inserted, visible | Control: attached and visible both wait |
| `#never` | `display:none` forever | none | Negative: visible must time out |
| `#stays` | Visible forever | none | Negative: hidden must time out |
| `.dup` ×2 | First `display:none` forever, second visible | none | First-match semantics diagnostic |
| `#host` (open shadow root) → `#shadow-toast` | `display:none` inside the shadow root | → `block` | Checks `pierce/` still works with `visible` |
| `<iframe id="f" srcdoc=…>` → `#frame-toast` | `display:none` inside the iframe | → `block` | Multi-frame `visible` path, plus a `hidden` multi-frame probe |

- **Implementation:** a small inline `<script>` holding a `const T = {...}` table of transition
  functions keyed by id. The `#auto` path calls `setTimeout(() => runAll(), delay)`; `#manual`
  exposes the same functions on `window.__fx`.
- **Iframe transitions:** for `#frame-toast`, the iframe runs its own timer, armed from
  `parent.__fx` on load, and records into `parent.__fx.events`.
- **Constraints:** no network requests, no external resources.

---

## 4. Unit tests to add or modify

**No existing assertion may be changed or loosened.** Existing tests that must still pass
unchanged:
- `browser-action-engine.spec.ts:681-693` (duplicate guard; its mock ignores options)
- `browser-action-engine.spec.ts:1807` (no-page failure)
- `runtime.spec.ts:256-258` (unknown session)
- `tools.spec.ts:22-95` (tool list/count, still 68 + optional agent)
- `api.spec.ts:10-12` (`'0.4.3'` version; the bump is a later item)

### 4.1 `packages/browser/tests/unit/browser-action-engine.spec.ts`

New `describe('... wait_for_selector states (FR2-01)')`. Every test uses `maxRetries: 0`.

- **E1** Default state is visible. With a `singleFramePage` mock, `waitForSelector` is called
  with `('pierce/#t', expect.objectContaining({ visible: true }))`.
  `result.output.state === 'visible'`. Name the test so it says this is the intentional 0.5.0
  behavior change.
- **E2** `state:'visible'` waits past attached-but-hidden. The mock resolves the handle only when
  called with `visible: true`, and rejects after `options.timeout` when `visible` is falsy (it
  simulates Puppeteer). Assert success, and that no call had a falsy `visible`.
- **E3** `state:'attached'` returns even though the element is hidden. Assert
  `mock.calls[0][1].visible` is **not** `true`. Success; `output.state === 'attached'`.
- **E4** `state:'hidden'` resolves on hide or removal. The single-frame mock's `waitForSelector`
  resolves `null` when `options.hidden === true`. Assert success, `output.state === 'hidden'`,
  and that the call had `hidden: true`. Mock `$` returns a handle → `matchedAtStart === true`. A
  second case where `$` returns null → `matchedAtStart === false`, still success.
- **E5** Hidden with multiple frames requires every frame. The main frame resolves hidden and the
  iframe rejects on every probe. With `timeoutMs: 400` the result is failure and the error
  matches `/waiting for state=hidden/`. Every probe was fully awaited, using the same ordering
  assertion technique as `:1360-1402`.
- **E6** A visible timeout names the state and diagnoses hidden elements. `waitForSelector`
  rejects, and the frame's `$$eval` mock resolves `[false]`. The error matches
  `/timed out after \d+ms waiting for state=visible/` and contains
  `attached to the DOM, but none is visible`.
- **E7** First match hidden, later match visible. `$$eval` resolves `[false, true]`. The error
  contains `later match(es) are`.
- **E8** Visible with no match: the error contains both `state=visible` and
  `No element found for selector: #nope`. Also a node-id selector `[data-sd-node-id="99"]` with
  `page.evaluate` resolving `null` → the error contains `navigated since the last snapshot`, so
  the staleness guidance is preserved.
- **E9** An attached timeout names the state: `/waiting for state=attached/`.
- **E10** The state-specific error beats the outer race. `timeoutMs: 100`, and the mock rejects at
  100ms like a Puppeteer TimeoutError. `result.error` must **not** start with
  `Action wait_for_selector timed out after`, and must match `/state=visible/`.
- **E11** An invalid state from JS: `state: 'bogus' as any` → failure, error contains
  `Invalid wait_for_selector state "bogus"`.
- **E12** `timeoutMs: 0` is clamped. `waitForSelector` is called with `timeout: 1`, never `0`.
- **E13** The diagnosis is best-effort. With frames that have no `$$eval` (the existing mock
  shape), a visible timeout still returns a state-naming error rather than a TypeError.

### 4.2 `packages/capability-runtime/tests/unit/runtime.spec.ts`

- **R1** Spy on the private method with
  `vi.spyOn(runtime as any, 'runAction').mockResolvedValue({ success: true, actionType: 'wait_for_selector', executionTimeMs: 1 })`.
  `await runtime.waitForSelector('s', '7', 500, 't', 'hidden')` → `runAction` was called with
  `('s', { actionType: 'wait_for_selector', selector: '[data-sd-node-id="7"]', timeoutMs: 500, state: 'hidden' }, 't')`.
- **R2** Called without a state, the `state` passed is `undefined`. The engine owns the default.

### 4.3 `packages/mcp-server/tests/unit/tools.spec.ts`

- **M1** `inputSchema.state.safeParse('hidden').success === true`,
  `safeParse(undefined).success === true`, `safeParse('bogus').success === false`.
- **M2** The handler passes the state through: the spy on `runtime.waitForSelector` gets
  `('s1', '#t', 500, undefined, 'attached')`.
- **M3** The description mentions `visible`, `attached` and `hidden`, and the word "default".
- **M4** The hint for the none-visible error: the spy resolves
  `{ success: false, error: '... waiting for state=visible: 1 element(s) match "#t" and are attached to the DOM, but none is visible ...' }`.
  The parsed error contains `state:"attached"` and does **not** contain
  `page may still be loading`.

### 4.4 `packages/cli/tests/unit/parse-args.spec.ts`

- **C1** `['wait', '#t', '5000', '--state', 'hidden']` → `stateFlag: 'hidden'`,
  `cleanArgs: ['#t', '5000']`, `unrecognizedFlags: []`.
- **C2** Not given → `stateFlag: undefined`, `stateFlagGivenButInvalid: false`.
- **C3** `--state bogus` → `stateFlag: undefined`, `stateFlagGivenButInvalid: true`, and `bogus`
  is stripped from `cleanArgs`.
- **C4** `--state` as the last token → `stateFlagGivenButInvalid: true`.
- **C5** Each of the three valid values parses.

### 4.5 `packages/sutradhar/tests/unit/api.spec.ts`

- **S1** `page.waitForSelector('#t')` → the stub gets `('sess-1', '#t', undefined, 'tab-1', undefined)`.
- **S2** `page.waitForSelector('#t', { state: 'hidden', timeout: 2000 })` → `('sess-1', '#t', 2000, 'tab-1', 'hidden')`.
- **S3** The stub resolves `{ success: false, error: 'wait_for_selector timed out after 2000ms waiting for state=visible: ...' }`
  → the call rejects with that exact message.
- **S4** The stub resolves success → the promise resolves `undefined`.

### 4.6 The one intentional behavior change

Callers that pass no state, and today target an element that is attached but not visible, will
now **wait up to `timeoutMs` (×3 attempts with retries) and then fail**, where they used to
succeed instantly. Nothing else changes for existing callers:
- Elements that are visible when they attach behave the same.
- Absent elements still time out; only the message is new.
- `output.foundSelector` is kept.

E1's test name and the changelog fragment must say this explicitly.

---

## 5. Live-verify script: `tools/scenario-suite/verify-fr2-01-wait-states.mjs`

**Prerequisite:** `pnpm build` (the worktree's `packages/mcp-server/dist/cli.js`,
`packages/cli/dist/cli.js`, and `packages/sutradhar/dist/index.js`).

**Output:**
- Write to `.ai/loop/field-report-2/evidence/FR2-01/`: `live-mcp.jsonl`, `live-cli.jsonl`,
  `live-sdk.jsonl`, and `live-summary.json` (one line per case: surface, case, expected, observed,
  pass, timings).
- Exit 1 if any case fails.

**Independent observer.** Load raw `puppeteer-core` with
`createRequire(path.join(repoRoot, 'packages/browser/package.json'))('puppeteer-core')`; it's not
hoisted to the root `node_modules`. Every assertion reads ground truth through this observer's
own `page.evaluate` of `window.__fx.events` and `getComputedStyle`/`getBoundingClientRect` on the
target. Never trust the tool's `success` alone.

**Timing rule.** Record `sentAt` / `recvAt` with `Date.now()` around each call and compare
against the fixture's `events[].at`.

**Sleeps.** The only deliberate delays are "not-yet" assertions, written as
`Promise.race([call, delay(ms)])` where the delay must win. They prove the call is still
blocked; that's not a sleep standing in for a condition.

### 5.1 MCP (spawns the worktree's MCP server)

Reuse the JSON-RPC stdio transport pattern from `run-mcp.mjs:22-86`, copied locally.
`run-mcp.mjs` runs `main()` on import, so it can't be imported.

`browser.launch` doesn't expose a wsEndpoint (`LaunchResult`, `types.ts:34-39`). So:
1. The script starts Chrome itself with `puppeteer.launch({ executablePath: CHROME_PATH or
   BrowserLauncher().findExecutablePath() from packages/browser/dist, headless: true,
   userDataDir: <scratch dir> })`.
2. The MCP server joins that same browser with `browser.attach({ endpoint: observer.wsEndpoint() })`.
3. Per case: `browser.navigate` to the fixture URL, then the observer finds the page with
   `(await browser.pages()).find(p => p.url().startsWith(fixtureUrl))`.

**Auto mode (1.5s), one fresh navigation per case:**
- **(a) `state` omitted (default visible), target `#toast`, timeoutMs 5000.**
  - Before sending, the observer confirms `#toast` is in the DOM and hidden: display none and
    rect 0.
  - Asserts: `success:true`, `output.state === 'visible'`, `toastShownAt` exists with
    `sentAt <= toastShownAt <= recvAt`, and at `recvAt` the observer sees it visible.
  - This is the "genuinely waited for the CSS change" proof. Repeat with explicit
    `state:'visible'`.
- **(b) `state:'attached'`, target `#toast`.** Asserts `success:true`,
  `recvAt < toastShownAt` (or no reveal yet), and at `recvAt` the observer sees `display:none`.
  Proves it returned before the change.
- **(c1) `state:'hidden'`, target `#banner`.** `sentAt <= bannerHiddenAt <= recvAt`; the observer
  sees it hidden at `recvAt`.
- **(c2) `state:'hidden'`, target `#spinner`.** Same window with `spinnerRemovedAt`; the observer
  sees `querySelector('#spinner') === null`.
- **Per mechanism:** default visible on `#vis-hidden`, `#zero-size`, `#child`, `#shadow-toast`
  and `#frame-toast`, each with the same `sent <= shownAt <= recv` rule. `#late` in both attached
  and visible mode, where both wait.

**Manual-mode causality proof (`#manual`):**
- Default wait on `#toast`, timeoutMs 10000. `Promise.race([call, delay(1500)])` → the delay must
  win.
- Then the observer runs `__fx.reveal('toast')` → the call must resolve within 1000ms, and
  `recvAt >= revealAt`.
- Same pattern for hidden: the observer runs `__fx.hide('banner')`.

**Negative cases (§6):** N1–N9 over MCP. Invalid `state:'bogus'` must come back as a JSON-RPC
error or `isError:true`, never `success:true`.

**Teardown:** `browser.shutdown` (detach) → end the MCP child's stdin and kill it →
`observer.close()` → `rm -rf` the scratch userDataDir, retrying on Windows EBUSY.

### 5.2 CLI (spawns the worktree's CLI)

- **Setup:**
  - Set `SUTRADHAR_CLI_STATE_DIR` to a scratch dir (`state.ts:67-71`).
  - Snapshot the set of `os.tmpdir()/sutradhar-cli-*` dirs **before** starting.
  - `node packages/cli/dist/cli.js nav "<fixture>#manual"`.
  - Read `state.json` (it has `wsEndpoint` and `chromePid`), then
    `puppeteer.connect({ browserWSEndpoint })` as the observer.
- **Why manual mode.** Each CLI command is a new Node process that re-attaches, costing about
  0.5–1.5s. So a fixed 1.5s auto timer can't prove waiting: the toast may already be visible
  before the wait starts. Record this in `decisions.md`.
  - `wait "#toast" 10000` (no flag): the child must still be running after 2500ms (race child
    exit vs `delay(2500)`). Then the observer reveals the toast → the child exits 0 and stdout
    matches `/is visible \(state=visible\)/`. The observer confirms visible and
    `exitAt >= revealAt`. The toast was hidden at least 1.5s before the reveal, which satisfies
    the Done-when.
  - `wait "#toast" 10000 --state attached`, on a fresh `nav #manual`: exit 0 promptly; the
    observer confirms still `display:none`; no reveal event.
  - `wait "#banner" 10000 --state hidden`: still running after 2500ms → observer runs
    `__fx.hide('banner')` → exit 0, stdout `/hidden or absent/`. Same again with
    `__fx.remove('spinner')`.
- **Negatives:**
  - `wait "#never" 1500` → exit 1, stdout contains `Wait failed:` and `waiting for state=visible`
    and `none is visible`.
  - `--state bogus` → exit 1, stderr `--state must be one of`.
  - `--state` with no value → exit 1.
  - `wait "#stays" 1500 --state hidden` → exit 1 with `state=hidden`.
- **Teardown:**
  - `node cli.js close`.
  - Disconnect the observer.
  - Assert `chromePid` is dead.
  - Remove only the `sutradhar-cli-*` dirs that weren't in the "before" snapshot, retrying on
    lock. They leak today because of FR2-03, and §10 of the loop prompt forbids leaving them
    behind.
  - Remove the scratch state dir.

### 5.3 SDK (imports the worktree's built SDK)

- **Setup:** `import { launch } from '<repo>/packages/sutradhar/dist/index.js'` →
  `browser = await launch({ headless: true })`, `page = (await browser.pages())[0]`,
  `observer = await puppeteer.connect({ browserWSEndpoint: browser.getWsEndpoint() })`.
- **Cases:** (a), (b), (c1) and (c2) as in 5.1 via `page.goto(fixture)` +
  `page.waitForSelector(sel, { state, timeout })`, with the same observer timing rules.
- **Negatives:**
  - `page.waitForSelector('#never', { timeout: 1500 })` **rejects** with a message matching
    `/state=visible/`.
  - `{ state: 'bogus' }` (JS) rejects with `Invalid wait_for_selector state`.
- **Teardown:** `browser.close()` and `observer.disconnect()`.

**Final check, all surfaces.** Count the Chrome processes whose command line contains the scratch
profile paths and the new `sutradhar-cli-*` dirs. Both must be 0. Save this in
`live-summary.json`.

---

## 6. Negative cases required by the §8 Auditor template

**What counts as "visible".** The engine passes `visible: true` to Puppeteer's own
`waitForSelector`. In puppeteer-core 25.5.0, `src/injected/util.ts` `checkVisibility` treats an
element as visible iff:
1. computed `visibility` is not `hidden` or `collapse`, **and**
2. `getBoundingClientRect()` has width > 0 **and** height > 0.

It is applied to the **first** node the selector matches, per frame.

Consequences, adopted as-is as this project's definition, for consistency with `click_by_role`
(`:505`) and every other `visible:true` caller of `resolveElement`:

| Condition | Counts as |
|---|---|
| `display:none` on the element or an ancestor | hidden (zero rect) |
| `hidden` attribute | hidden |
| `visibility:hidden` or `collapse`, own or inherited | hidden |
| width 0 or height 0 | hidden |
| `display:contents` element | hidden (zero rect) |
| `opacity:0` | **visible** |
| off-screen position | **visible** |
| clipped by `overflow` / `clip-path` | **visible** |
| covered by another element | **visible** |

Playwright's actionability docs (paraphrased) likewise treat `opacity:0` as visible and zero-size
/ `display:none` as not visible. Record in `decisions.md`: **opacity:0 is visible; zero-size is
hidden.** Covering and occlusion are the click path's job (`verifiedClick`'s occlusion check),
not the wait's.

**Required negative cases.** Each runs live on MCP. The ones marked † also run on CLI and SDK.

| # | Case | Expected |
|---|---|---|
| N1† | `#never` (display:none forever), state visible, timeoutMs 1500 | `success:false`; error matches `/timed out after 1500ms waiting for state=visible/` and contains `none is visible`; MCP error carries the new state:"attached" hint; elapsed ≥ 1500ms (retries make it about 3×) |
| N2 | `#does-not-exist`, visible | Error contains `state=visible` **and** `No element found for selector: #does-not-exist` |
| N3† | `#stays`, state hidden, 1500 | `success:false`, `/waiting for state=hidden/`, `still visible` |
| N4 | `#typo-nothing`, state hidden | **Success quickly** (documented semantics), `output.matchedAtStart === false`. Proves the typo is detectable. |
| N5 | `#opacity-zero`: visible → success immediately; hidden, 1500 → timeout | Documents the opacity rule |
| N6 | `#offscreen`, visible | Success immediately (documented) |
| N7 | `.dup` (first hidden, second visible), visible, 1500 | Timeout, error contains `later match(es) are` |
| N8† | Invalid state: MCP `'bogus'` → schema rejection; CLI `--state bogus` / missing value → exit 1 with usage; SDK/runtime `'bogus'` → `Invalid wait_for_selector state` | Never a success |
| N9 | `timeoutMs: 0` on `#never` | Fails in about 0s per attempt with a state message; no hang |
| N10 | Stale node id `"999"` after a navigation | Error keeps the "Call browser.snapshot again" guidance plus `state=visible` |
| N11 | Any timeout | `error` never starts with `Action wait_for_selector timed out after` |

---

## 7. Risks

### 7.1 Every existing call site

None of these pass a state, so all switch to default visible.

| Call site | Target | Expected impact |
|---|---|---|
| `tools/scenario-suite/run-mcp.mjs:375`, `run-sdk.mjs:359` | `#finish` (the-internet dynamic_loading/1, display:none from load) | Behavior improves: it now really waits for the ~5s reveal instead of passing vacuously. MCP uses 8000ms and SDK 10000ms, which is enough; it's slower by about 5s. |
| `tools/engine-comparison/sutradhar-harness.mjs:62`, `pinchtab-harness.mjs:73` | `#finish h4` (same page) | Same as above |
| `run-mcp.mjs:199, 249, 256, 259, 277, 317, 598, 618`; `run-sdk.mjs:179, 258, 265, 270, 274, 300, 313, 558, 583` | saucedemo `.inventory_list`, `button[id^=add-to-cart]`, `#checkout`, `.summary_total_label`, `.complete-header`, `.cart_list`, `#first-name`, `.inventory_details_name`, `.summary_info` | Visible when attached; no change expected. Confirm in the phase-gate scenario suite. |
| `run-sdk.mjs:122` | `iframe[title*="reCAPTCHA"], iframe[src*="recaptcha"]` | The first match in document order is the visible anchor iframe. The hidden challenge iframe comes later, so first-match semantics could bite if the order ever changes. The Auditor should re-run UC-02. |
| `run-sdk.mjs:384` | `iframe.tox-edit-area__iframe, iframe[id$="_ifr"]`; `run-mcp.mjs:402` `.tox-toolbar__primary` | Visible after TinyMCE init; re-run UC-07 |
| `engine-comparison/sutradhar-harness.mjs:43, 49, 74, 87, 97, 102, 107, 110, 129` and `pinchtab-harness.mjs:54, 60, 85, 98, 108, 113, 118, 121, 140` | `.flash.success`, `#uploaded-files`, saucedemo selectors, `#delayed-result` (created with text) | Visible; no change |
| `sutradhar-harness.mjs:137`, `pinchtab-harness.mjs:148` | `#inner-result` inside an iframe: `<div id='inner-result'></div>`, **zero height until text is set** (`engine-comparison/fixtures/complex.html:30`) | Waited on *after* the submit click that sets its text synchronously, so it's visible. This is exactly the zero-size rule in action; the Auditor must re-run it. |
| `engine-comparison/sutradhar-hard.mjs:45` | `#secret-btn` in a **closed** shadow root | `pierce/` can't enter closed roots; outcome unchanged either way |
| `engine-comparison/sutradhar-extreme.mjs:55, 115, 190, 266, 305` | `iframe#nested-frame` (500×200), `.ProseMirror`, `iframe#cross-origin-frame` (600×300), `.row-50 .column-1`, `.flash.success` | Visible; no change expected |
| `packages/cli/src/cli.ts:451` | User-supplied | Output text changes from "appeared" to "is visible (state=visible)". Nothing in the repo parses the old text; `run-cli.mjs` never calls `wait`. |
| `packages/mcp-server/src/tools.ts:691` | User-supplied | Default behavior change (intended) |

No callers in `apps/server`, `packages/agent` (its `step-executor.ts:48` only maps
click/navigate), `packages/frontend`, `packages/sdk` (the unrelated plugin SDK), or
`tools/reliability/prob043-mcp-soak.mjs`.

Out-of-scope staleness to log in `gaps.md`, not fix here: `tools/scenario-suite/run-cli.mjs:152`
and `:437` say "CLI has no `wait` command" and use fixed sleeps, but `cmdWait` exists
(`cli.ts:447`). Log it as a follow-up for FR2-08 or FR2-17.

### 7.2 Other risks

1. **Animation-frame polling can stall in background tabs.** Puppeteer forces animation-frame
   polling (`requestAnimationFrame`) whenever `visible` or `hidden` is set (`QueryHandler.ts`:
   `polling = visible || hidden ? RAF : options.polling`). The old attached-only default used
   mutation polling, which also works in background tabs. `puppeteer.launch` sessions are safe
   because Puppeteer's default args disable renderer backgrounding. Two paths are exposed:
   - A **headed** CLI session: `spawn-chrome.ts:69-76` passes no
     `--disable-renderer-backgrounding` / `--disable-backgrounding-occluded-windows`.
   - `browser.attach` to a user's real Chrome, when the target tab is in the background.

   `click_by_role` already has this exposure. **Auditor adversarial case:** a headed CLI or
   attached session, a wait on a non-foreground tab. **Mitigation if it reproduces:** replace
   Puppeteer's `visible`/`hidden` with `frame.waitForFunction(pred, { polling: 100 })` using the
   §6 predicate (interval polling isn't paused by rAF throttling). Alternatively add the two flags
   to `spawn-chrome.ts` (then FR2-03 must re-verify its file set).
2. **First-match semantics.** A hidden duplicate earlier in the DOM (a mobile-nav copy, a toast
   template) makes `visible` time out where attached-only "succeeded" on the wrong, hidden
   element. The E7/N7 diagnostic makes this actionable, not silent.
3. **Retries make visible timeouts much slower.** `maxRetries` defaults to 2 (`:220`), so a
   visible timeout now costs about 3×timeoutMs + 1.5s + screenshot. A call that used to succeed
   instantly on a hidden element can now take about 26s at 8000ms. That can hit a client's own
   MCP tool timeout. **Don't change retries in this item** (smallest diff). Log a gap proposing
   `maxRetries: 0` default for `wait_for_selector` (the wait is its own retry) for the
   Orchestrator to triage.
4. **`hidden` succeeds on a typo.** A typo'd selector "succeeds" instantly under `hidden`.
   Mitigated by the MCP description text and `output.matchedAtStart`.
5. **Hand-offs to later items.**
   - FR2-07 must turn `output.state` into a real check that the element matched in the requested
     state.
   - FR2-08's `wait_for` must not duplicate or contradict these semantics.
   - FR2-15's migration row `waitForSelector(state)` maps to
     `page.waitForSelector(sel, { state, timeout })`.

   The cross-cutting phase Auditor should check all three.
6. **`$$eval` with the `pierce/` prefix** in the diagnosis helper depends on Puppeteer query-
   handler support in `$$eval`. It's wrapped best-effort, so a failure there only degrades the
   message (covered by E13).

---

## 8. Rollback

Reverting this item alone means `git revert <FR2-01 commit>`. It touches only the files in §1:
- Engine: `action-types.ts`, `browser-action-engine.ts` (the `wait_for_selector` case, the two
  new private helpers, and the `:219` outer-timeout branch).
- `runtime.ts` and `capability-runtime/src/index.ts`.
- `tools.ts` (schema, description, two `ERROR_HINTS` entries).
- `parse-args.ts` and `cli.ts`.
- SDK `page.ts` and `index.ts`.
- The five test files.
- The new fixture and verify script.
- The three READMEs.
- `evidence/FR2-01/changelog-fragment.md`.

There's no persisted state, no on-disk format, and no MCP tool-count change to undo. After a
revert:
- Add an append-only `decisions.md` entry.
- Mark the ledger row `TODO`/`BLOCKED`.
- Drop the fragment from the 0.5.0 changelog input. If FR2-01 was the only breaking change, the
  minor bump's justification must be re-checked by the release item.

Items that build on it (FR2-07's `wait_for_selector` check, FR2-15's mapping row) would need the
same revert or a rework.

---

## Critical files for implementation
- `packages/browser/src/actions/browser-action-engine.ts`
- `packages/browser/src/actions/action-types.ts`
- `packages/capability-runtime/src/runtime.ts`
- `packages/mcp-server/src/tools.ts`
- `packages/cli/src/cli.ts` (with `parse-args.ts` and `packages/sutradhar/src/page.ts`)
