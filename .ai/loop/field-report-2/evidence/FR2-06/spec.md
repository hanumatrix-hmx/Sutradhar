# FR2-06: Selector dialect coach, implementation spec

**Item:** FR2-06 (Phase 2, agent ergonomics).
**Base:** HEAD `038c481` on `claude/field-report-2-loop`, plus the uncommitted FR2-01 fix-1 working-tree changes to `browser-action-engine.ts`. Line numbers were read from that tree. FR2-02 through FR2-05 all merge before this item and touch `runtime.ts`, `tools.ts`, `cli.ts` and the engine, so the Executor finds every anchor **by symbol name, not by line number**.
**Decision in force:** §4.2. Reject with an actionable hint. Never silently translate Playwright syntax.
**Hard precondition:** FR2-02 is DONE. At HEAD, `SELECTOR_SYNTAX_HINT`, `selectorSyntaxDetail`, `planExtractFields` and the `resolveFrame` wrap **do not exist yet** (FR2-02 is still at SPEC in the ledger). If `grep -n SELECTOR_SYNTAX_HINT packages/capability-runtime/src/types.ts` finds nothing, the Executor stops and reports.
**Sequencing:** DEVELOP runs after FR2-05, with no parallel Executor, because the file sets overlap with FR2-01 through FR2-05. FR2-04's GAP-006 fix (moving `fn()` out of the self-heal `try`) should already have landed. This spec does **not** depend on it, because the CLI pre-validates (§2.6).
**Versioning:** no bump. The item writes `evidence/FR2-06/changelog-fragment.md`.

---

## 0. Trace results

All of these were read in the code unless marked *to confirm live*.

| # | Finding | Evidence |
|---|---|---|
| T1 | `normalizeTarget` maps only `^\d+$` (after trim) to `[data-sd-node-id="N"]`. Everything else passes through untouched. Types.ts has only `import type` from `@sutradhar/browser` today. | `capability-runtime/src/types.ts:157-160` |
| T2 | **Runtime entry points that call `normalizeTarget`** (15 engine-routed call sites): `click` :488, `focus` :504, `type` :599 (plus `fillForm` :611-628 through `type`, which catches throws per field), `scroll` :665 (only when a target is given), `hover` :678, `selectOption` :690, `selectOptions` :704, `waitForSelector` :722, `uploadFile` :761, `clickWithButton` :775, `dragAndDrop` :791-792 (source and dest), `touchTap` :802, `downloadFile` :819. In every case `normalizeTarget(target)` is evaluated **while the argument object is built**, before `runAction` (:1642) calls `rateLimiter.removeToken()` or `resolveTab`. A throw there therefore reaches no session, no page and no CDP. | `runtime.ts` |
| T3 | **Non-engine selector sinks:** (a) `resolveFrame` :871-895 does `current.$(normalizeTarget(hop))` inside the hop loop (:880). `eval` and `extractData` both use it. (b) `extractData` :907-928: after FR2-02, every field selector goes through `planExtractFields → normalizeTarget`. (c) `uploadFileViaTrigger` :1344-1363 **already calls `normalizeTarget`** (:1357), but only *after* `resolveTab`, `requirePage` and `assertUploadPathAllowed` (fs I/O). It then runs `page.click(selector)` with no `pierce/`, no wrapping and no wait. Grep confirms no other raw-selector sink in `capability-runtime/src` (the `site-audit.ts` selectors are hard-coded). | grep of `querySelector`, `.$(`, `.click(` in `runtime.ts` |
| T4 | **The engine prefixes caller selectors with `pierce/`** at: `type` :566, `scroll` :606, `wait_for_selector` :690, `select_option` :762, `focus` :797, `drag_and_drop` :817/:819, `touch_tap` :860, `upload_file` :946, `verifiedClick` :1680, `verifiedHover` :1811. The engine builds its **own** selectors for `click_by_text` (:526 `xpath///*[contains(., "${text}")…]`), `click_by_role` (:549 `aria/${name}[role="${role}"]`) and `type_by_label` (:578-579 `pierce/input[aria-label="${label}"], …`). Those are not caller selectors. | engine |
| T5 | **Why a bad selector used to wait out the timeout.** Puppeteer's `WaitTask.getBadError` (`puppeteer-core/src/common/WaitTask.ts:201-238`) treats an in-page `SyntaxError` as terminal, so `waitForSelector` rejects immediately. But `resolveElement` swallows every rejection: `.catch(() => null)` at :1175 (one frame), :1188 (main-frame head start) and :1223 (multi-frame poll). One frame gives an instant `null`, then the caller's generic `No (visible) element found for selector: X`, then the retry loop (`maxRetries ?? 2`, 500·n ms backoff, :253/:344-346), for ≈1.5 s plus a failure screenshot. **With any iframe** the poll loop (:1208-1226) spins for the whole remaining deadline, and every probe rejects instantly and is swallowed. That is ≈5 s per attempt, ≈16.5 s in total, hammering CDP the whole time. *To confirm live* (baseline B1/B2). | engine :1160-1228 |
| T6 | FR2-01 fix-1 already made `pierceFirstMatch` (:1266-1273) re-throw selector syntax errors (`isSelectorSyntaxError`, :1275-1278). `wait_for_selector` visible/hidden therefore now shows the parser message, but the retry loop still retries it: evidence `FR2-01/fix-1/adv-misc-results-fix1.json` h1/h2 show `retriesUsed: 2` and 1549 / 1531 ms. `state:'attached'` still goes through `resolveElement` and is still swallowed. | engine :701-753 |
| T7 | **Caller-supplied Puppeteer prefixes never work on engine actions today.** `pierce/#x` becomes `pierce/pierce/#x`. Puppeteer strips only the first prefix (`GetQueryHandler.ts:36-53`), so `Element.matches('pierce/#x')` (`injected/PierceQuerySelector.ts:25,55`) throws, and T5 applies. The same happens for `xpath/…`, `aria/…` and `text/…`. The MCP `targetDesc` (`tools.ts:420-421`) documents only "CSS selector OR numeric [#id]". | Puppeteer source |
| T8 | **Puppeteer 25.5 also accepts `=` as a prefix separator:** `QUERY_SEPARATORS = ['=', '/']` (`GetQueryHandler.ts:25`). So on the two **unprefixed** paths (`uploadFileViaTrigger`'s `page.click`, and `resolveFrame`'s `$`), `text=Browse` works today with *Puppeteer* text semantics, and so do `xpath=`, `aria=` and `pierce=`. It's undocumented legacy, but it is real current behavior that this item narrows (§7 R2). *To confirm live* (baseline B6). | `GetQueryHandler.ts` |
| T9 | Every Playwright form in the Done-when is already **invalid CSS** in Chrome (unknown pseudo-class, `=` outside brackets, two adjacent `>` combinators, function token at top level). The only exception is inside the forgiving `:is()`/`:where()` lists (§7 R1). Detection therefore changes only the message and the latency, never whether a selector can work. | CSS Selectors 4 |
| T10 | **Surface contracts.** MCP handlers wrap runtime throws with `errorResult('<tool> failed: …')` (e.g. click :462-468, `upload_file_via_trigger` :1445-1451) and pass `success:false` through `jsonResult` (:81-95). Both run `withHint` against `ERROR_HINTS` (:42-59). **CLI**: any throw inside `withSession`'s `fn` fires self-heal, which kills Chrome and respawns it (`cli.ts:121-139`, GAP-006, scheduled for FR2-04). `cmdPress` does `runtime.focus(...).catch(() => {})` and then presses anyway (:356). **SDK**: `Page.click` and `Page.type` discard `success:false` (`page.ts:105-112`), so today `page.click('text=Submit')` resolves silently. Only `waitForSelector` throws. | |
| T11 | Engine unit mocks: no `Frame` mock defines `evaluate`, and several pages have no `mainFrame` (`browser-action-engine.spec.ts`, 62 Frame mocks). A probe that treats "no `mainFrame().evaluate`" as inconclusive leaves every existing test's call sequence untouched. Page-level `evaluate` mocks *are* scripted (settle tests :1956, :2347), so the probe must use `page.mainFrame().evaluate`, **not** `page.evaluate`. | spec file |
| T12 | No existing test or scenario uses a Playwright-shaped selector (grep over `packages/*/tests`, `tools/scenario-suite/*.mjs`). The agent package builds selectors only from node ids (`agent-loop.ts:544,550`), so engine-entry detection isn't needed for it. `apps/server` takes no selectors. `packages/sdk` is the plugin SDK and takes no selectors. | grep |
| T13 | **FR2-02 interaction.** FR2-02's `resolveFrame` catch rewrites errors that match `/is not a valid selector|SyntaxError/i` and re-throws anything else unchanged. FR2-02's live N3 feeds `text=Buy`, `button >> text=OK` and similar to `extract_data` and expects "an invalid-selector error with hint". FR2-06 must keep that message shape (`Invalid selector for field "<name>": …`, §2.4). | FR2-02 spec §2.2, §2.3, §6 |

### 0.1 Decisions (the Orchestrator records these in `decisions.md`)

**D1. Detection and validation are separate problems with separate homes.**
- **Detection** of Playwright-isms is a synchronous, pure string check. It lives in one function in `@sutradhar/browser` (the lowest layer, so both runtime and engine can import it) and is called from `normalizeTarget`. It throws before any `await`, session lookup or CDP call.
- **Validation** of all other CSS and XPath is done once per action by the *browser's own parser*, in a pre-loop probe inside the engine, before the retry loop.
- Where no probe can run cheaply (`uploadFileViaTrigger`, `resolveFrame`, `extractData`), Puppeteer's own immediate call already fails fast, and the parser error is wrapped instead.

**D2. The probe parses; it doesn't match.** In the main frame it runs `document.createDocumentFragment().querySelector(expr)` for CSS, or `document.createExpression(expr)` for `xpath/`.
- An empty fragment makes the probe O(1) and independent of page content, so a valid selector that currently matches nothing **cannot** be misclassified.
- Only an exception whose `name === 'SyntaxError'` counts as invalid. Anything else (a timeout, a detached context, a missing `evaluate`, a pending dialog) is *inconclusive*, and the action continues on today's path.
- One frame is enough, because every frame (including out-of-process iframes) runs the same Chrome binary and so the same parser.
- The probe runs once per action, before the retry loop and outside the per-attempt `timeoutMs` race. It is bounded at `SELECTOR_SYNTAX_PROBE_TIMEOUT_MS = 500`.

**D3. `pierce/`, `xpath/`, `aria/` and `text/` really work on engine actions.** A new `toPuppeteerQuery()` passes a caller selector that already carries one of these slash prefixes straight to Puppeteer, and prefixes `pierce/` only for plain CSS. This is purely additive (T7: every such call fails today). The Done-when says they "still work", and live case (c) must show them finding real elements.

**D4. Payload scanning by prefix.**
- The payload after `pierce/` is CSS and **is** scanned, so `pierce/text=Submit` is rejected.
- Payloads after `xpath/`, `aria/` and `text/` are XPath, accessible names and free text. They are **never** scanned, because they can legitimately contain `=`, `>>` or `text()`. For example, `aria/text=Submit` targets a button whose accessible name is `text=Submit`.

**D5. Only slash spellings are supported.**
- `text=` is rejected per the Done-when, with a pointer to Puppeteer's `text/`.
- `xpath=`, `aria=` and `pierce=` (Puppeteer's legacy `=` separator, T8) are rejected with "use `xpath/`" (and so on).
- This narrows two undocumented paths that work today (§7 R2). Baseline evidence records it.

**D6. The numeric shorthand is checked first.** `normalizeTarget` trims, maps `^\d+$`, and only then runs detection. No rule could match digits anyway; the order just means node ids never pay for the scan.

**D7. Runtime contract.**
- A Playwright selector makes the runtime method **reject** with `InvalidSelectorError`. It does not resolve `success:false`. This is static argument validation, the same class as `BrowserNotAvailableError`, which the runtime already throws.
- Invalid CSS found by the browser probe is an **action result** (`success:false`, `retriesUsed: 0`).
- Consequence on each surface: MCP `isError` (all handlers already catch). CLI exits 1 before touching the session (§2.6). The SDK's `page.click('text=…')` now throws where it used to resolve silently. `fillForm` reports the failure per field.
- Error order also changes: a Playwright selector now fails before an unknown-session error on engine-routed methods.

**D8. Engine no-retry rule.** When a dispatch error's message matches `/is not a valid selector|is not a valid XPath expression/`, the retry loop stops immediately. This covers the case where the probe was inconclusive and a syntax error then surfaces through FR2-01's `pierceFirstMatch`.

**D9. Detection rules only match provably invalid CSS.** The one documented exception is Playwright pseudo-classes inside forgiving `:is()`/`:where()` lists (§7 R1). Before any substring rule runs, string literals, comments and backslash escapes are stripped, so text inside attribute values, `\>`-escaped identifiers and comments can never trigger a rule.

**D10. Planner additions beyond the Done-when minimum.** Each one is zero-false-positive and cheap:
- `css=`, `id=` and `data-testid=` (and similar) engine prefixes;
- `:text()`, `:text-is()`, `:text-matches()`, `:nth-match()` and `:visible`;
- a leading-quote legacy text selector;
- a bare XPath without the prefix (`//…`), coached to `xpath/`;
- `#12` / `[#12]`, coached to the bare node id `12` (the snapshot lists ids as `[#12]`, a very common agent mistake).

**D11. Not in scope.** Puppeteer P-selectors (`>>>`, `::-p-text()`) on engine actions aren't supported and aren't detected as Playwright. The probe rejects them with the parser message plus a note that shadow roots are already crossed automatically. They keep working on the unprefixed paths (`uploadFileViaTrigger`, `resolveFrame`), where Puppeteer handles them natively.

**Gaps to log (minor, found while tracing; not fixed here):**
- **GAP-new-1:** `click_by_text`, `type_by_label` and `click_by_role` interpolate caller text into XPath/CSS/aria without escaping. A `"` in the text builds an invalid selector, which is swallowed as "No element found" after 5 s × 3. Recommend taking this right after FR2-06 as FR2-X01 (XPath `concat()` literal, CSS attribute-value escaping).
- **GAP-new-2** (home FR2-07): SDK `Page.click` and `Page.type` discard `success:false`, so invalid CSS stays silent in the SDK.
- **GAP-new-3:** `cmdPress` ignores a failed focus and presses on whatever is focused.
- **GAP-new-4:** after a click failure, `uploadFileViaTrigger` leaves `waitForFileChooser` pending, with interception enabled for up to 30 s. It also can't reach shadow DOM or iframes (it uses a plain `page.click`).

---

## 1. Files to touch

| # | File | Change |
|---|---|---|
| 1 | `packages/browser/src/actions/selector-dialect.ts` (new) | The shared validator and everything selector-dialect: `SELECTOR_SYNTAX_HINT` and `selectorSyntaxDetail` (**moved** from capability-runtime `types.ts`), `InvalidSelectorError`, `detectForeignSelectorDialect`, `assertSupportedSelectorDialect`, `invalidSelectorSyntaxError`, `PUPPETEER_SELECTOR_PREFIX_RE`, `toPuppeteerQuery`, `selectorProbeTarget`, `selectorSyntaxProbeInPage`, `SELECTOR_SYNTAX_PROBE_TIMEOUT_MS` |
| 2 | `packages/browser/src/actions/index.ts` | `export * from './selector-dialect.js';` |
| 3 | `packages/browser/src/actions/browser-action-engine.ts` | Pre-loop `rejectInvalidCallerSelector` plus `probeSelectorSyntax`; `toPuppeteerQuery` at the 11 caller-selector sites (T4, excluding `type_by_label`); the D8 no-retry rule; JSDoc on `resolveElement` |
| 4 | `packages/capability-runtime/src/types.ts` | `normalizeTarget` calls detection. Replace FR2-02's local `SELECTOR_SYNTAX_HINT`/`selectorSyntaxDetail` definitions with a re-export from `@sutradhar/browser` (same exported names), and also re-export `InvalidSelectorError` |
| 5 | `packages/capability-runtime/src/runtime.ts` | `resolveFrame`: normalize every hop up front and wrap `InvalidSelectorError` with frame context. `uploadFileViaTrigger`: normalize before `assertUploadPathAllowed`, and wrap the parser error from `page.click`. JSDoc on `click`/class doc: which errors throw and which return |
| 6 | `packages/capability-runtime/src/extract/extract-data.ts` (FR2-02's file) | `planExtractFields` collects `InvalidSelectorError` per field and throws through FR2-02's `invalidExtractSelectorsError` |
| 7 | `packages/cli/src/selector-args.ts` (new) + `packages/cli/src/cli.ts` | Pre-validate selector args and `--frame` hops before `withSession` in: click, type, press, select, wait, eval `--frame`, hover, scroll (target), upload, drag (both), download. Add one `--help` line |
| 8 | `packages/mcp-server/src/tools.ts` | Extend `targetDesc` (§2.7). **No** `ERROR_HINTS` change |
| 9 | `AGENT_SETUP.md` | One sentence in the Interaction row or selector note: accepted dialects, Playwright rejected, use `click_by_text`/`click_by_role`/`type_by_label` |
| 10 | Tests | `browser/tests/unit/selector-dialect.spec.ts` (new); `browser-action-engine.spec.ts` (append); `capability-runtime/tests/unit/runtime.spec.ts` (append); `extract-data.spec.ts` (append); `mcp-server/tests/unit/tools.spec.ts` (append); `cli/tests/unit/selector-args.spec.ts` (new) |
| 11 | `tools/scenario-suite/fixtures/fr2-06-selectors.html` (new) | §3 |
| 12 | `tools/scenario-suite/verify-fr2-06-selectors.mjs` (new) | §5 |
| 13 | `.ai/loop/field-report-2/evidence/FR2-06/changelog-fragment.md` (new) | Behavior changes (§7.1) |

**Not touched:** `packages/sutradhar/src/*` (SDK behavior changes only because the runtime now throws); `packages/agent`; `apps/server`; `resolveElement`'s `.catch(() => null)` (left as is, because the pre-loop probe means caller CSS errors never reach it); FR2-01's `pierceFirstMatch`/`isSelectorSyntaxError`; the `type_by_label`/`click_by_text`/`click_by_role` selector builders (GAP-new-1).

---

## 2. API diff

### 2.1 `selector-dialect.ts` (new, `@sutradhar/browser`)

```ts
/** Actionable tail appended to every selector error. Single source of truth (moved from
 *  capability-runtime/types.ts, where FR2-02 introduced it; re-exported there unchanged in name). */
export const SELECTOR_SYNTAX_HINT =
  'Use standard CSS or a snapshot node id (e.g. "12"); Puppeteer\'s pierce/, xpath/, aria/ and text/ ' +
  'prefixes also work for element actions. Playwright-style selectors (text=, role=, >>, :has-text(), ' +
  'getBy*(), internal:) are not supported: to target by visible text or accessible role/name, use ' +
  'click_by_text, click_by_role or type_by_label (CLI: clicktext, clickrole), or take a snapshot and ' +
  'use a node id.';
```

Invariants, each enforced by a test (D5, §4.1):
- The hint contains `Playwright-style` (FR2-02's R2 and N1 depend on it).
- It contains none of `ERROR_HINTS`' patterns (`no element found`, `timed out`, `stale snapshot`, `occluded`, `no browser session`, `no live browser page`, `but none is visible`, `waiting for state=hidden`, `outside the allowed download directories`, `no visible element found`).
- It contains neither `SyntaxError` nor `is not a valid selector`.

```ts
/** FR2-02's function, moved verbatim: first line of a parser message, leading "SyntaxError: " /
 *  "DOMException: " removed; never empty ('invalid selector syntax'). */
export function selectorSyntaxDetail(parserMessage: string): string;

export type InvalidSelectorKind = 'foreign-dialect' | 'invalid-syntax';

export class InvalidSelectorError extends Error {
  public override readonly name = 'InvalidSelectorError';
  public constructor(
    public readonly selector: string,
    /** One sentence, no hint — wrappers (extract, frameSelector) rebuild their own framing from it. */
    public readonly reason: string,
    public readonly kind: InvalidSelectorKind,
  ) {
    super(`Invalid selector "${selector}" — ${reason} ${SELECTOR_SYNTAX_HINT}`);
  }
}

export interface ForeignDialectMatch { rule: ForeignDialectRule; token: string; reason: string; }
export type ForeignDialectRule =
  | 'node-id-syntax' | 'quoted-text' | 'bare-xpath' | 'internal' | 'engine-prefix'
  | 'chain' | 'pseudo' | 'locator-method';

/** Slash prefixes Puppeteer resolves natively. The `=` spellings are deliberately NOT here (D5). */
export const PUPPETEER_SELECTOR_PREFIX_RE = /^(pierce|xpath|aria|text)\//;
```

**`detectForeignSelectorDialect(selector: string): ForeignDialectMatch | null`** is pure, synchronous and O(n):

1. `s = selector.trim()`. If it's empty, return `null`.
2. If `PUPPETEER_SELECTOR_PREFIX_RE` matches: for `xpath`, `aria` or `text`, return `null` (D4). For `pierce`, set `css = s` minus the prefix. Otherwise `css = s`.
3. `bare = stripCssOpaqueRegions(css)`. This is one pass over the string. `\` plus the next char becomes `_`. A `"…"` or `'…'` string (with escapes inside) becomes an empty pair of the same quotes, and an unterminated string is consumed to the end. A `/* … */` comment becomes one space, and an unterminated comment is consumed to the end.
4. Rules, first match wins, in this order:

| Order | Rule | Regex (on) | Token | Reason (exact text) |
|---|---|---|---|---|
| 1 | node-id-syntax | `^\[?#(\d+)\]?$` (css) | `#12` | `this looks like a snapshot node id; pass just the number, e.g. "12".` (the number is filled in) |
| 2 | quoted-text | `^["']` (css) | `"` | `a quoted string is Playwright's legacy text selector, not CSS.` |
| 3 | bare-xpath | `^\(*\s*\.{0,2}\/` (css) | `//` | `this looks like an XPath expression; prefix it with "xpath/" (e.g. xpath///button[@id="go"]).` |
| 4 | internal | `(?<![\w.#-])internal:[a-z][a-z-]*\s*=` (bare) | e.g. `internal:role=` | `"internal:role=" is Playwright-internal selector syntax (as printed by Playwright locators/codegen), not CSS.` |
| 5 | engine-prefix | `^(text\|role\|css\|xpath\|aria\|pierce\|id\|data-testid\|data-test-id\|data-test)\s*=` (css, `i`) | e.g. `text=` | text/role: `"text=" is Playwright selector-engine syntax (Puppeteer's own text query is spelled "text/").` / `"role=" is Playwright selector-engine syntax.` · css: `"css=" is Playwright's explicit CSS-engine prefix; drop it and pass the CSS itself.` · xpath/aria/pierce: `"xpath=" is not supported; use the slash form "xpath/".` · id/data-test*: `"data-testid=" is a Playwright attribute-engine prefix; use a CSS attribute selector such as [data-testid="…"].` |
| 6 | chain | `(?<!>)>>(?!>)` (bare) | `>>` | `">>" (Playwright selector chaining) is Playwright selector syntax.` |
| 7 | pseudo | `:(?:has-text\|text-is\|text-matches\|text\|nth-match)\(\|:visible(?![\w-])` (bare) | e.g. `:has-text(` | `":has-text()" is a Playwright-only pseudo-class, not CSS.` |
| 8 | locator-method | `getBy[A-Z][A-Za-z]*\s*\(` (bare) | e.g. `getByRole(` | `"getByRole(" is a Playwright locator method, not a selector.` |

Why each rule is zero-false-positive against valid CSS:
- Rules 1, 2, 3 and 5 are start-anchored. A CSS selector can never start with `#<digit>`, `[#`, a quote, `/`, `(`, `./` or `..`, or with `ident=`.
- Rule 4: `=` outside brackets and strings is never valid CSS, and the look-behind excludes `.internal:` and `#internal:`.
- Rule 6: two adjacent `>` combinators are invalid. Puppeteer's `>>>` and `>>>>` are excluded by the look-arounds.
- Rule 7: these are unknown pseudo-classes. `:has(` and `:focus-visible` don't match.
- Rule 8: a function token outside a known pseudo-class is invalid.
- All of these hold except inside forgiving `:is()`/`:where()` lists (§7 R1).

**`assertSupportedSelectorDialect(selector): void`** throws `new InvalidSelectorError(selector, match.reason, 'foreign-dialect')` when there's a match. It is synchronous.

**`invalidSelectorSyntaxError(selector, parserMessage, opts?: { enginePath?: boolean }): InvalidSelectorError`**:
- `reason = selectorSyntaxDetail(parserMessage)`.
- When `opts.enginePath` is set and `stripCssOpaqueRegions(selector)` matches `/>>>|::-p-/`, append ` (Puppeteer's >>> and ::-p-*() extensions are not supported for element actions; open shadow roots are already searched automatically, so use a plain descendant combinator.)`.
- `kind = 'invalid-syntax'`.

**`toPuppeteerQuery(selector): string`**: `t = selector.trim()`, then `PUPPETEER_SELECTOR_PREFIX_RE.test(t) ? t : 'pierce/' + selector`.

**`selectorProbeTarget(selector): { kind: 'css' | 'xpath'; expr: string } | null`**:
- `null` for an exact node id `^\[data-sd-node-id="\d+"\]$` (known valid).
- `null` for the `aria/` and `text/` prefixes.
- `xpath/` gives `{xpath, payload}`, `pierce/` gives `{css, payload}`, anything else gives `{css, selector}`.

**`selectorSyntaxProbeInPage(kind, expr): string | null`**:
- Runs in the page. It must be **fully self-contained** (Puppeteer serializes it with `toString()`): no imports and no outside references.
- `try { kind === 'xpath' ? document.createExpression(expr) : document.createDocumentFragment().querySelector(expr); return null; } catch (e) { return e && e.name === 'SyntaxError' ? String(e.message ?? e) : null; }`

`SELECTOR_SYNTAX_PROBE_TIMEOUT_MS = 500`.

### 2.2 Engine (`browser-action-engine.ts`)

**`executeActionSerialized`, before (:238-242):**
```ts
const duplicateError = this.checkDuplicateAction(tab.id, params);
if (duplicateError) return duplicateError;
```
**After:**
```ts
// FR2-06: one browser-side parse of every CALLER selector, before the duplicate guard (a rejected
// selector must not occupy the duplicate window) and before the retry loop (never retried, never
// counted against timeoutMs).
const invalidSelector = await this.rejectInvalidCallerSelector(tab, params);
if (invalidSelector) return invalidSelector;
const duplicateError = this.checkDuplicateAction(tab.id, params);
if (duplicateError) return duplicateError;
```

**New private methods:**
```ts
/** Caller-supplied selectors only — never the selectors the engine builds itself for
 *  click_by_text (XPath from free text), click_by_role (aria/ from role+name) or type_by_label. */
private static callerSelectorsOf(p: ActionParams): string[] {
  switch (p.actionType) {
    case 'click': case 'type': case 'wait_for_selector': case 'select_option': case 'hover':
    case 'focus': case 'touch_tap': case 'download_file': case 'upload_file': case 'scroll':
      return p.selector ? [p.selector] : [];
    case 'drag_and_drop':
      return [p.selector, p.targetSelector].filter((s): s is string => !!s);
    default:
      return [];
  }
}

private async rejectInvalidCallerSelector(tab: IBrowserTab, params: ActionParams): Promise<ActionResultDto | undefined> {
  const page = tab.page;
  const selectors = BrowserActionEngine.callerSelectorsOf(params);
  if (!page || selectors.length === 0) return undefined;
  if (tab.getPendingDialog?.()) return undefined;             // main-thread evaluate would block on the dialog
  const start = Date.now();
  for (const selector of selectors) {
    const target = selectorProbeTarget(selector);
    if (!target) continue;
    const parserMessage = await this.probeSelectorSyntax(page, target);
    if (parserMessage === null) continue;                        // valid OR inconclusive -> today's path
    const error = invalidSelectorSyntaxError(selector, parserMessage, { enginePath: true }).message;
    const executionTimeMs = Date.now() - start;
    const failResult: ActionResultDto = {
      success: false, actionType: params.actionType, executionTimeMs,
      currentUrl: tab.url, title: tab.title, error, retriesUsed: 0,   // no failureScreenshot: nothing on the page is relevant
    };
    const verification = await this.verifier.verifyAction(tab, tab.url, failResult, params.verificationSpec); // pure on failure
    tab.recordAction({ actionType: params.actionType, selector: params.selector, success: false, error,
                       executionTimeMs, timestamp: new Date().toISOString() });
    this.logger.warn(`[BrowserActionEngine] Rejected invalid selector before dispatch: ${error}`);
    return { ...failResult, verification };
  }
  return undefined;
}

/** Returns the browser parser's message iff it DEFINITELY rejects the selector; null when valid
 *  or when the probe can't run/answer in time (never a guess). */
private async probeSelectorSyntax(page: Page, target: { kind: 'css' | 'xpath'; expr: string }): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const frame = page.mainFrame();
    if (!frame || typeof frame.evaluate !== 'function' || frame.isDetached?.()) return null;
    const probe = frame.evaluate(selectorSyntaxProbeInPage, target.kind, target.expr);
    probe.catch(() => {});                                       // PROB-015: an abandoned probe must never go unhandled
    return await Promise.race([
      probe.then((r) => (typeof r === 'string' ? r : null)),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), SELECTOR_SYNTAX_PROBE_TIMEOUT_MS); }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
```

**Prefix passthrough:** at each of the 11 sites in T4 (all except `type_by_label` :579, `click_by_text` :526 and `click_by_role` :549), replace the literal `` `pierce/${X}` `` with `toPuppeteerQuery(X)`. In `wait_for_selector` that is `const fullSelector = toPuppeteerQuery(params.selector)`. Error messages keep the caller's unprefixed selector, as today.

**No-retry rule (D8):** in the retry loop's `catch`, after the warn log and before the backoff:
```ts
if (/is not a valid selector|is not a valid XPath expression/.test(lastError.message)) break; // FR2-06: parse errors are deterministic
```

The `resolveElement` JSDoc gains one sentence: a caller selector's *syntax* is checked once, up front, by `rejectInvalidCallerSelector`, so the `.catch(() => null)` here only ever sees "not found / not yet" for caller CSS.

### 2.3 `normalizeTarget` (`capability-runtime/src/types.ts`)

**Before (:156-160):**
```ts
/** Internal helper: convert a snapshot node id (number) or selector string to a CSS selector. */
export function normalizeTarget(target: ElementTarget): string {
  return /^\d+$/.test(target.trim()) ? `[data-sd-node-id="${target.trim()}"]` : target;
}
```
**After:**
```ts
import { assertSupportedSelectorDialect } from '@sutradhar/browser';
export { SELECTOR_SYNTAX_HINT, selectorSyntaxDetail, InvalidSelectorError } from '@sutradhar/browser';

/**
 * Convert a snapshot node id ("12") or selector string to the selector the engine resolves.
 * Throws {@link InvalidSelectorError} synchronously — before any session lookup, await, or CDP call —
 * for Playwright-style syntax (text=, role=, >>, :has-text(), getBy*(), internal:, …). Everything
 * else passes through unchanged; genuinely invalid CSS is judged later by the browser's own parser.
 */
export function normalizeTarget(target: ElementTarget): string {
  const trimmed = target.trim();
  if (/^\d+$/.test(trimmed)) return `[data-sd-node-id="${trimmed}"]`;   // D6: node id first
  assertSupportedSelectorDialect(target);
  return target;
}
```
FR2-02's local definitions of `SELECTOR_SYNTAX_HINT` and `selectorSyntaxDetail` are deleted in favor of the re-export. Their exported names and import paths (`from '../types.js'`) are unchanged.

### 2.4 Runtime (`runtime.ts`) and extract (`extract-data.ts`)

**`resolveFrame`, after FR2-02** (hops are normalized up front, so a bad second hop costs no first-hop round trip):
```ts
const normalizedHops = hops.map((hop) => {
  try { return normalizeTarget(hop); }
  catch (e) {
    if (e instanceof InvalidSelectorError) {
      throw new Error(`Invalid frameSelector "${hop}" (from the full chain "${frameSelector}") — ${e.reason} ${SELECTOR_SYNTAX_HINT}`);
    }
    throw e;
  }
});
// loop body: `current.$(normalizedHops[i])` inside FR2-02's existing try/catch (unchanged)
```

**`uploadFileViaTrigger`, before (:1350-1362):** `resolveTab`, `requirePage`, `assertUploadPathAllowed`, `normalizeTarget`, then `Promise.all([waitForFileChooser(), page.click(selector)])`.

**After:**
```ts
const { tab } = this.resolveTab(sessionId, tabId);        // unchanged order: unknown session still throws first (runtime.spec.ts:354)
const page = this.requirePage(tab);
const selector = normalizeTarget(triggerTarget);          // moved up: Playwright syntax fails before any fs I/O
await this.assertUploadPathAllowed(filePath);
let fileChooser;
try {
  [fileChooser] = await Promise.all([page.waitForFileChooser(), page.click(selector)]);
} catch (e) {
  const msg = (e as Error)?.message ?? String(e);
  if (/is not a valid selector|is not a valid XPath expression/i.test(msg)) {
    throw new Error(invalidSelectorSyntaxError(selector, msg).message);   // no enginePath: P-selectors DO work here
  }
  throw e;                                                // same object
}
await fileChooser.accept([filePath]);
```
The thrown error is a plain `Error`. The FR2-02 convention is that wrapped errors stay plain; only the `normalizeTarget` throw is `InvalidSelectorError`.

**`planExtractFields` (FR2-02's `extract-data.ts`):** wrap each field's `normalizeTarget(spec.selector)` in a `try`. Collect every `InvalidSelectorError` as `{ name, selector: spec.selector, message: e.reason }`. After the loop, if any were collected, `throw invalidExtractSelectorsError(collected)`. That keeps FR2-02's exact shape: one `Invalid selector for field "<name>": "<selector>" — <reason>` line per field, then exactly one hint. FR2-02's `pierce|xpath|aria|text` prefix note still applies. Any other throw is re-thrown unchanged.

**Runtime JSDoc** (class doc and `click`): "A Playwright-style selector rejects with `InvalidSelectorError` (thrown, no browser contact). Syntactically invalid CSS/XPath resolves `{success:false, retriesUsed:0}` with the browser parser's message."

### 2.5 Final error messages

| Case | Message |
|---|---|
| Playwright (runtime throw) | `Invalid selector "text=Submit" — "text=" is Playwright selector-engine syntax (Puppeteer's own text query is spelled "text/"). <HINT>` |
| Invalid CSS (engine) | `Invalid selector "div[" — Failed to execute 'querySelector' on 'DocumentFragment': 'div[' is not a valid selector. <HINT>` (the exact parser text is *to confirm live*) |
| Invalid XPath (engine) | `Invalid selector "xpath///[" — Failed to execute 'createExpression' on 'Document': The string '//[' is not a valid XPath expression. <HINT>` |
| P-selector on engine | invalid-CSS message plus the D11 note |
| `upload_file_via_trigger` invalid CSS | `upload_file_via_trigger failed: Invalid selector "div[" — <parser detail> <HINT>` |
| frame hop | `Invalid frameSelector "role=frame" (from the full chain "iframe.a::role=frame") — "role=" is Playwright selector-engine syntax. <HINT>` |
| extract | `Invalid selector for field "bad": "text=Buy" — "text=" is …\n<HINT>` |

### 2.6 CLI

`packages/cli/src/selector-args.ts` (new):
```ts
import { normalizeTarget } from '@sutradhar/capability-runtime';
/** Returns the error text for the first unsupported selector arg, or null. Pure; no session. */
export function validateSelectorArgs(args: ReadonlyArray<string | undefined>): string | null;
/** Same, for a "::"-chained --frame value; message names the hop and the chain (as resolveFrame does). */
export function validateFrameChain(chain: string | undefined): string | null;
```

In `cli.ts`, each of these commands calls `printErrorAndExit(msg)` (stderr, exit 1) **before** `withSession`: `cmdClick`, `cmdType`, `cmdPress`, `cmdSelect`, `cmdWait`, `cmdEval` (`frameFlag`), `cmdHover`, `cmdScroll` (target), `cmdUpload`, `cmdDrag` (both), `cmdDownload`. There is no attach, no spawn and no self-heal exposure, whatever state GAP-006 is in.

Add one line to `--help` after the `clickrole` entry: `Selectors are CSS (shadow roots crossed), a numeric id from "snap", or pierce/ xpath/ aria/ text/; Playwright syntax (text=, >>, role=) is rejected — use clicktext/clickrole.`

### 2.7 MCP `targetDesc` (`tools.ts:420-421`)

```ts
const targetDesc =
  'A CSS selector OR a numeric [#id] from browser.snapshot (e.g. "7" resolves to [data-sd-node-id="7"]). ' +
  'Puppeteer\'s pierce/, xpath/, aria/ and text/ prefixes are also accepted. Playwright syntax (text=, ' +
  'role=, >>, :has-text(), getBy*()) is rejected immediately — use browser.click_by_text / ' +
  'browser.click_by_role / browser.type_by_label to target by visible text or role.';
```
The tool count is unchanged, and there's no `ERROR_HINTS` entry (the messages already carry the hint).

---

## 3. Fixture: `tools/scenario-suite/fixtures/fr2-06-selectors.html` (new)

**Why a new fixture:**
- None of the existing ones (`fr2-01-wait-states.html`, `fr2-01-singleframe.html`, `aria-menu.html`, FR2-02's `fr2-02-extract-live.html`) records *which* element received a click.
- None has a JS-triggered file chooser, or elements whose attributes, classes or text *contain* Playwright tokens (needed for the false-positive proofs).

The fixture is minimal: no network, loaded by `file://` with a **query-string nonce** (decisions.md gotcha), and it ends with `window.__fx6.ready = true`.

| Element | Markup | Proves |
|---|---|---|
| `#plain-btn` | `<button>Plain</button>` | CSS, node id, overhead |
| `#xp-btn` | `<button>XPath target</button>` | `xpath/` |
| `#aria-btn` | `<button aria-label="Submit order">OK</button>` | `aria/Submit order[role="button"]` |
| `#text-btn` | `<button>Exact text button</button>` | `text/` |
| `#pw-text-btn` | `<button>text=Submit</button>` | `click_by_text("text=Submit")`, `aria/text=Submit`, `xpath///*[text()="text=Submit"]` |
| `#chev-btn` | `<button>Next &gt;&gt; step</button>` | `click_by_text("Next >> step")` |
| `#eq-btn` | `<button>a=b</button>` | `click_by_text("a=b")` |
| `#role-name-btn` | `<button aria-label="Go &gt;&gt; now">Go</button>` | `click_by_role("button","Go >> now")` |
| `#label-input` | `<input aria-label="Notes &gt;&gt; extra">` | `type_by_label` |
| `#attr-text` | `<button data-text="text=Submit">` | FP `[data-text="text=Submit"]` |
| `#attr-chain` | `<button data-x="a &gt;&gt; b">` | FP `[data-x="a >> b"]` |
| `#attr-internal` | `<button title="internal:role=button">` | FP `[title="internal:role=button"]` |
| `#attr-getby` | `<button data-q="getByRole('x')">` | FP `[data-q="getByRole('x')"]` |
| `#cls-chev` | `<button class="a&gt;&gt;b">` | FP `.a\>\>b` |
| `#getByRole` | `<button id="getByRole">` | FP `#getByRole` |
| `#cls-internal` | `<button class="internal">` | FP `button.internal:not(.nope)` |
| `#host` | open shadow root with `<button id="shadow-btn">Shadow</button><input id="shadow-input">` | auto-pierce and explicit `pierce/` |
| `iframe#f` | srcdoc `<button id='in-frame-btn'>Frame</button>` plus a click listener that pushes to `parent.__fx6.clicks` | multi-frame path (the old ≈16 s case) and in-frame CSS |
| `#browse-btn` + `#hidden-file` | `<button>Browse</button>` whose click runs `hiddenFile.click()`; `<input type=file id=hidden-file style="display:none">` | `upload_file_via_trigger` |
| `#late-slot` | empty container | `__fx6.insertLate(id, ms)` appends `<button id=…>` after `ms` |

Script details:
- `window.__fx6 = { ready, clicks: [], insertLate, busy(ms) }`.
- A capture-phase `click` listener on `document` pushes `e.composedPath()[0].id` (so a click inside the shadow root records `shadow-btn`, not `host`).
- `busy(ms)` is a synchronous `while (Date.now() - t < ms) {}` loop.
- **Gotcha:** the script source must not contain the literals `text=Submit`, `a=b`, `Next >> step` or `Exact text button`. `click_by_text`'s XPath matches `<script>` text content too.
- In `srcdoc`, close scripts with a plain `</script>` (FR2-01 lesson).

---

## 4. Unit tests

**No existing assertion may be changed, removed, skipped or loosened.** These must pass byte-unchanged:
- all of `browser-action-engine.spec.ts` (including GAP-015 :2609-2635 and every scripted `evaluate` sequence);
- `runtime.spec.ts` `normalizeTarget` :26-42, `uploadFileViaTrigger` :354-358, and the `resolveFrame` tests :425-464;
- every FR2-01 and FR2-02 test;
- `tools.spec.ts` tool list and exact count;
- `parse-args.spec.ts` and `state.spec.ts`.

If one of these fails, the implementation is wrong, not the test.

### 4.1 `browser/tests/unit/selector-dialect.spec.ts` (new)

- **D1. Every Playwright form is rejected.** `detectForeignSelectorDialect(x)` is non-null with the expected rule:
  - `text=Submit`, `text="Submit"i`, `text=/Sub.*/`, `  text=Submit  `, `TEXT=Submit`: engine-prefix
  - `role=button[name="Submit"]`, `Role = button`: engine-prefix
  - `button >> text=OK`, `div>>span`, `pierce/div >> span`: chain
  - `div:has-text("x")`, `:text("x")`, `button:text-is("OK")`, `a:text-matches("x")`, `:nth-match(li, 2)`, `button:visible`: pseudo
  - `getByRole('button')`, `getByText("x")`, `page.getByLabel('Email')`, `getByTestId("go")`: locator-method
  - `internal:has-text="x"`, `internal:role=button`, `div >> internal:text="x"i`: internal
  - `css=button`, `xpath=//button`, `aria=Submit`, `pierce=#x`, `id=main`, `data-testid=go`: engine-prefix
  - `pierce/text=Submit`: engine-prefix (the pierce payload is scanned)
  - `//button[@id="x"]`, `(//a)[1]`, `.//span`, `../div`: bare-xpath
  - `#12`, `[#12]`: node-id-syntax, and the reason contains `"12"`
  - `"Submit"`, `'Submit'`: quoted-text
- **D2. Everything below returns `null`** (false-positive guards):
  - `#plain-btn`, `.btn.primary`, `div > span`, `a + b ~ c`, `div:has(> span)`, `:is(a, b)`, `input[type="text" i]`, `[data-sd-node-id="7"]`
  - `[data-text="text=Submit"]`, `[data-a='role=x']`, `[data-x="a >> b"]`, `[href*=">>"]`, `[title="internal:role=button"]`, `[data-q="getByRole('x')"]`, `a[title=":has-text(x)"]`
  - `.a\>\>b`, `#a\:has-text\(x\)`, `#getByRole`, `button.internal:not(.nope)`, `internal:first-child`, `.has-text`, `.text-is`, `button:focus-visible`, `[data-visible]`, `div /* >> text=x */ span`
  - `text`, `text[x="1"]`, `svg text`, `role`
  - `div >>> span`, `div >>>> span`, `div::-p-text(x)` (Puppeteer P-selectors are not Playwright, D11)
  - `xpath///*[text()="text=Submit"]`, `xpath//a[contains(., ">>")]`, `aria/text=Submit`, `aria/Submit order[role="button"]`, `text/text=Submit`, `text/a >> b`, `pierce/#x`, `pierce/[data-x="a >> b"]`
  - `12`, ` 7 `, `''`, `'   '`
- **D3. Error shape.** `assertSupportedSelectorDialect('text=Submit')` throws synchronously (`expect(() => …).toThrow(InvalidSelectorError)`), and:
  - `name === 'InvalidSelectorError'`, `.selector === 'text=Submit'`, `.kind === 'foreign-dialect'`;
  - the message starts with `Invalid selector "text=Submit" — "text="` and ends with `SELECTOR_SYNTAX_HINT`;
  - it contains `click_by_text`, `click_by_role`, `type_by_label` and `Playwright-style`;
  - it contains neither `SyntaxError` nor `is not a valid selector`;
  - the lowercased message contains none of the 10 `ERROR_HINTS` patterns (hard-coded list in the test). Repeat for one input per rule.
- **D4. Speed and sync.** The return value is never a Promise. Running the full D1+D2 list 1,000 times, plus a 10,000-char selector, takes < 100 ms total (a loose guard; the deterministic guarantee is that the function is synchronous).
- **D5. `SELECTOR_SYNTAX_HINT`** contains `Playwright-style`, `click_by_text`, `click_by_role`, `type_by_label`, `snapshot` and `pierce/`.
- **D6. `toPuppeteerQuery`:**
  - `#x` becomes `pierce/#x`;
  - `pierce/#x`, `xpath///a`, `aria/X[role="button"]` and `text/Hi` are unchanged;
  - ` xpath//a` becomes `xpath//a`;
  - `[data-sd-node-id="3"]` becomes `pierce/[data-sd-node-id="3"]`.
- **D7. `selectorProbeTarget`:**
  - `#x` gives `{css,'#x'}`; `pierce/#x` gives `{css,'#x'}`; `xpath//[` gives `{xpath,'/['}`;
  - `aria/…`, `text/…` and `[data-sd-node-id="12"]` give `null`;
  - `[data-sd-node-id="12"], .x` gives css (not the exact form).
- **D8. `selectorSyntaxProbeInPage`**, with `vi.stubGlobal('document', …)` and unstubbed after each test:
  - valid CSS returns `null`, and `fragment.querySelector` is called with `expr`;
  - `{name:'SyntaxError', message:M}` returns `M`;
  - a `NamespaceError` returns `null`, and a `TypeError` returns `null`;
  - xpath calls `createExpression`, and its `SyntaxError` returns the message;
  - self-containment: `new Function('return (' + fn.toString() + ')')()` gives the same result.
- **D9. `invalidSelectorSyntaxError`:**
  - `('div[', "Failed to execute 'querySelector' on 'DocumentFragment': 'div[' is not a valid selector.")` has message `/^Invalid selector "div\[" — Failed to execute 'querySelector'/` and ends with the hint;
  - a leading `SyntaxError: ` is stripped;
  - `('#h >>> #b', msg, {enginePath:true})` contains `>>> and ::-p-*()`; without `enginePath` it doesn't;
  - `kind === 'invalid-syntax'`.

### 4.2 `browser-action-engine.spec.ts`: append `describe('FR2-06 caller-selector syntax probe')`

Helper: a page whose `mainFrame` has `isDetached`, `waitForSelector` and `evaluate: vi.fn()`, plus `page.screenshot: vi.fn()`. The existing `mockTab` is used, with `getPendingDialog` added only where a test needs it.

- **E1 invalid.** `evaluate` resolves the parser message. Then:
  - `success:false`, `retriesUsed === 0`;
  - `error` starts `Invalid selector "div["` and contains the message and the hint;
  - `waitForSelector` and `page.screenshot` are **not called**, and `failureScreenshot` is undefined;
  - `verification.verified === false`;
  - the tab history has one `success:false` entry;
  - `evaluate` was called once, with `(fn, 'css', 'div[')`.
- **E2 valid but absent.** `evaluate` resolves `null`. `waitForSelector` rejects `not found`. The click uses default `maxRetries`. Then `error` contains `No visible element found for selector: #nope` and **not** `Invalid selector`. `evaluate` was called **exactly once**, while `waitForSelector` was called 3 times (the probe runs before the loop and doesn't use retries).
- **E3 valid and present.** The probe returns `null` and the click succeeds (scripted `mockHandle`, like the existing click tests).
- **E4 inconclusive.** `evaluate` rejects `Execution context was destroyed`, and the action succeeds.
- **E5 hang.** `evaluate` never resolves. The action succeeds with elapsed ≥ 450 and < 2000 ms (real timers), and no unhandled rejection is logged.
- **E6 skips.** `evaluate` is **not called** for:
  - `[data-sd-node-id="12"]`, `aria/Submit[role="button"]`, `text/Hi`;
  - `click_by_text` (`text: 'text=Submit'`), `click_by_role` (`name: 'Go >> now'`), `type_by_label` (`label: 'Notes >> x'`);
  - `press_key`, and `scroll` with no selector;
  - any action when `tab.getPendingDialog()` returns `{type:'alert'}`.
- **E7 prefixes.** `xpath//[` calls the probe with `('xpath','/[')`, and `pierce/#x` with `('css','#x')`.
- **E8 `drag_and_drop`.** The source is valid and the target invalid. The error names the target selector, and `evaluate` is called twice.
- **E9 passthrough.** `waitForSelector`'s first argument is:
  - `xpath///button` for click `xpath///button` (not `pierce/xpath…`);
  - `pierce/#x` for `pierce/#x` (not `pierce/pierce/#x`);
  - `pierce/#x` for `#x` (unchanged);
  - `aria/Name[role="textbox"]` for type with that selector.
  - For `wait_for_selector` visible `xpath//div`, `mainFrame.$` receives `xpath//div`.
- **E10 no-retry.** The page has no probe (no `evaluate`). `$` rejects `"…'div[' is not a valid selector."` for `wait_for_selector` visible with default `maxRetries`. Then `retriesUsed === 0`, the `$` call count equals one attempt's count, and elapsed < 400 ms (no 500 ms backoff).
- **E11 duplicate guard.** Two back-to-back clicks on `div[` (probe says invalid) both give the `Invalid selector` error; neither gives `Duplicate`.

### 4.3 `runtime.spec.ts`: append `describe('FR2-06 selector dialect')`

- **R1 `normalizeTarget`.**
  - Every D1 string throws `InvalidSelectorError` synchronously.
  - `'12'` and `' 7 '` still map.
  - `pierce/#x`, `xpath///a`, `aria/X` and `text/Y` pass through **unchanged**.
  - Every D2 CSS string passes through unchanged (`toBe(input)`).
- **R2 zero browser contact.** Use a real `SutradharRuntime` with **no sessions**, and spy on `resolveTab` and `actionEngine.executeAction` on the instance. Each of `click`, `clickWithButton`, `focus`, `type`, `scroll` (target), `hover`, `selectOption`, `selectOptions`, `waitForSelector`, `uploadFile`, `dragAndDrop` (bad source; separately bad dest), `touchTap` and `downloadFile` with `'text=Submit'` rejects `InvalidSelectorError` (**not** `BrowserNotAvailableError`), and both spies have **0 calls**.
- **R3 `fillForm`.** `fillForm('s1', {'text=Name':'x', '#ok':'y'})`, with a stubbed `runAction`: `results['text=Name']` is `success:false` with `error` containing `Playwright-style`, and `runAction` is called once, for `#ok`.
- **R4 free-text inputs aren't selectors.** With `runAction` stubbed, each of these resolves, and `runAction` receives exactly the given `text` / `role` / `name` / `label`:
  - `clickByText('s1', 'text=Submit' | 'Next >> step' | 'a=b' | 'getByRole(x)')`
  - `clickByRole('s1', 'button', 'Go >> now' | 'role=x')`
  - `typeByLabel('s1', 'Notes >> extra', 'v')`
- **R5 `uploadFileViaTrigger` Playwright.** `('s1', 'text=Browse', '<nonexistent path>')`, with the tab and page stubbed, rejects `InvalidSelectorError`. The error is **not** `does not exist`, and `page.click` and `page.waitForFileChooser` are not called.
- **R6 `uploadFileViaTrigger` wrap.**
  - `page.click` rejects `SyntaxError: Failed to execute 'querySelector' on 'Document': 'div[' is not a valid selector.`. The call rejects `/^Invalid selector "div\[" — Failed to execute/`, containing the hint and not starting with `SyntaxError`, with `name === 'Error'`.
  - `page.click` rejects `new Error('No element found for selector: #x')`. That exact object is re-thrown (`rejects.toBe(err)`).
- **R7 frame hops.** `eval('s1', '1', undefined, 'iframe.a::role=frame')` rejects `/^Invalid frameSelector "role=frame" \(from the full chain "iframe\.a::role=frame"\) — "role="/`, and page `$` is **never** called, not even for the first hop.
- **R8 extract.** `extractData(..., {ok:{selector:'h1'}, bad:{selector:'text=Buy'}, bad2:{selector:'button >> text=OK'}})` rejects with a message starting `Invalid selector for field "bad": "text=Buy" — "text="`. It contains a line for `bad2`, and `SELECTOR_SYNTAX_HINT` appears exactly once. `evaluate` is not called.

`extract-data.spec.ts` append:
- **P9** `planExtractFields` with `pierce/text=x` gives FR2-02's prefix note plus the reason.
- **P10** a non-`InvalidSelectorError` throw passes through unchanged.

### 4.4 `tools.spec.ts`: append `describe('FR2-06 selector dialect')`

- **M1.** `browser.click`'s `target` description contains `Playwright`, `click_by_text` and `xpath/`.
- **M2.** Register tools with a **real** `SutradharRuntime` (no sessions). Call each of these handlers with `sessionId:'nope'` and `'text=Submit'` in its selector field: `click`, `right_click`, `type`, `hover`, `focus`, `select_option`, `select_options`, `wait_for_selector`, `upload_file`, `drag_and_drop` (source; then target), `touch_tap`, `download_file`, `scroll` (with target). The Executor reads the real parameter names from `tools.ts`. Each returns `isError:true` with text `/^<verb> failed: Invalid selector "text=Submit"/`, containing `click_by_text` and **not** `\nHint:`. `fill_form` with `{'text=Submit':'x'}` returns per-field `success:false`.
- **M3.** A `runtime.click` spy resolves `{success:false, error:'Invalid selector "div[" — … is not a valid selector. ' + SELECTOR_SYNTAX_HINT}`. The JSON `error` doesn't gain `\nHint:`.
- **M4.** The tool count is unchanged (the existing assertion, not re-asserted).

### 4.5 `cli/tests/unit/selector-args.spec.ts` (new)

- **C1.** `validateSelectorArgs(['text=Submit'])` contains `Playwright-style` and `clickrole`. `(['#ok', undefined])` and `(['12'])` return `null`. `(['#ok', 'a >> b'])` names `a >> b`.
- **C2.** `validateFrameChain('iframe.a::role=x')` matches `/Invalid frameSelector "role=x" \(from the full chain "iframe\.a::role=x"\)/`. `validateFrameChain(undefined)` returns `null`.

---

## 5. Live-verify script: `tools/scenario-suite/verify-fr2-06-selectors.mjs`

**Prerequisites:** `pnpm build`. Copy these helpers verbatim from `verify-fr2-01-wait-states.mjs` (don't refactor; GAP-005): `freshUrl` (query-string nonce), `record`, `writeJsonl`, `resolveChromeExecutablePath`, `rmWithRetry`, `makeMcpClient`, `textOf`, `jsonOf`, and the CLI and observer helpers.

**Outputs** go to `.ai/loop/field-report-2/evidence/FR2-06/`:
- `live-{mcp,runtime,cli,sdk,bundle}.jsonl`
- `live-summary.json`, with per case: surface, case, input, expected, observed, observerTruth, elapsedMs, `baselineElapsedMs` (when present), pass
- `live-verify.log`

The script exits 1 on any failure.

**Surfaces:**
- **Observer:** `puppeteer-core` launched from a `mkdtemp` profile. MCP (`packages/mcp-server/dist/cli.js`, stdio) and the runtime (`packages/capability-runtime/dist`) **attach** to it through `browser.attach` / `runtime.attach`.
- **CLI:** `packages/cli/dist/cli.js` with its own session; the observer connects to its `state.json` `wsEndpoint`.
- **SDK:** `packages/sutradhar/dist`.
- **Bundle:** `packages/sutradhar/dist/mcp-cli.js`.

**Step 0 (baseline, before any code change).** The Executor writes the script first, builds the pre-change tree (FR2-02..05 merged, no FR2-06 code), and runs it with `--baseline`. That mode runs the B-cases, records elapsed time, the error text and `retriesUsed` to `baseline.jsonl`, and asserts nothing. The normal run then reads `baseline.jsonl`, if present, for speedup ratios.

| # | Baseline case (pre-fix build, MCP, multi-frame fixture) | Expected pre-fix observation |
|---|---|---|
| B1 | `click('text=Submit')` | `success:false`, `No visible element found for selector: text=Submit`, `retriesUsed:2`, ≈16 s |
| B2 | `click('div[')` | same shape, ≈16 s, no parser text |
| B3 | `wait_for_selector('div[', 5000)` visible | parser text, `retriesUsed:2`, ≈1.5 s |
| B4 | `wait_for_selector('div[', 800, attached)` | `timed out … No element found`, ≈3×0.8 s plus backoff |
| B5 | `click` on `pierce/#shadow-btn`, `xpath///button[@id="xp-btn"]`, `aria/Submit order[role="button"]`, `text/Exact text button` | all `success:false` (T7) |
| B6 | `upload_file_via_trigger('text=Browse')`, `('div[')` | first **succeeds** (T8, Puppeteer text); second fails with raw parser text |
| B7 | SDK `page.click('text=Submit')` | **resolves silently** |
| B8 | 20× `wait_for_selector('#plain-btn', attached)` | median `executionTimeMs` recorded |
| B9 | single-frame fixture (`fr2-01-singleframe.html`) `click('text=Submit')` | ≈1.5 s |

**(a) Playwright selectors fail fast with zero browser round trips.**
- **A1 runtime.** For each of the 13 strings (D1's first entry per rule, plus `button >> text=OK`, `role=button[name="Submit"]`, `div:has-text("x")`, `getByRole('button')`, `internal:role=button`), across `click`, `type`, `hover`, `waitForSelector` and `dragAndDrop` (dest):
  - the call rejects with `name === 'InvalidSelectorError'`;
  - the message contains `Playwright-style` and `click_by_text`;
  - elapsed < 100 ms;
  - **instance counters** (JS monkeypatch on the built runtime of `resolveTab` and `actionEngine.executeAction`) are **0**.
- **A2 MCP, busy-page proof (deterministic).**
  - The observer runs `window.__fx6.busy(3000)` via `setTimeout(…, 0)`. `busyStart` is recorded once the observer sees `performance.now()` stall.
  - Immediately after, MCP calls `click('text=Submit')`, `extract_data({f:{selector:'text=Buy'}})`, `eval('1', frameSelector 'role=frame')` and `upload_file_via_trigger('text=Browse')`. Each returns `isError` with the hint, and client-measured elapsed < 100 ms **while the page's main thread is blocked**. Any page round trip would have waited out the busy loop.
  - **Control**, issued in the same busy window: `wait_for_selector('#plain-btn', attached)` takes ≥ `busyEnd - now - 200` ms. This proves the blocking really stops page calls, so the fast returns above can't be a false positive.
- **A3 CLI.**
  - `click "text=Submit"` exits 1, and stderr contains `Playwright-style` and `clickrole`. `state.json` is byte-identical and its mtime unchanged, and the `chromePid` is still alive. Elapsed is less than a `sutradhar eval "1"` issued right after, which must attach.
  - `eval "1" --frame "iframe#f::role=x"` exits 1 with the same state invariants.
  - A later `sutradhar click "#plain-btn"` succeeds on the **same** session (observer sees `plain-btn`).
- **A4 SDK.** `page.click('text=Submit')` rejects `InvalidSelectorError` in < 100 ms. B7 recorded the silent resolve.

**(b) Other invalid CSS fails fast through the browser's real parser.**
- **B-new-1 MCP, one call per input.** Inputs: `click('div[')`, `type('#x[', 'v')`, `wait_for_selector('div[', 5000)` visible and attached, `drag_and_drop('div[', '#plain-btn')`, `click('xpath///[')`, `click('#host >>> #shadow-btn')`, `click('   ')`, `click('12abc')`. Each gives:
  - `success:false`, `retriesUsed === 0`, no `failureScreenshot`;
  - `error` starting `Invalid selector "<input>"`, containing the hint and **not** `No element found`/`timed out`;
  - `executionTimeMs < 1000` and client elapsed < 1000.
  - **observerTruth:** the observer itself runs `document.createDocumentFragment().querySelector(x)` (or `document.createExpression` for xpath) and captures `e.message`. The tool's detail **equals** that message, which proves it's the browser's own parser text.
  - For `>>>`, the error also contains the D11 note.
  - Where a baseline exists, record `speedup = baselineElapsed / elapsed`, and assert ≥ 10 for B2 (multi-frame click).
- **B-new-2.** The runtime surface gives the same results for `click('div[')` and `waitForSelector('div[')`.
- **B-new-3 SDK.** `page.waitForSelector('div[', {timeout: 5000})` rejects in < 1000 ms with the parser text. `page.click('div[')` resolves (GAP-new-2), recorded as a known gap, not a pass.
- **B-new-4.** `upload_file_via_trigger('div[', file)` gives `isError`, with text starting `upload_file_via_trigger failed: Invalid selector "div["`, containing the observer's parser text, not raw `SyntaxError:`, and elapsed < 1000.
- **B-new-5 CLI.** `click "div["` exits 1, prints `Click failed: Invalid selector "div["`, and elapsed − (`eval 1` elapsed) < 500 ms (no backoff).
- **B-new-6: valid syntax is never misclassified.**
  - `wait_for_selector('#never', 800, attached)` has `error` containing `timed out after 800ms` and **not** `Invalid selector`, with elapsed ≥ 800.
  - The observer calls `insertLate('late1', 1000)` and MCP then calls `click('#late1')`: `success:true`, elapsed ≥ 900, and the observer sees `late1` in `clicks`.
  - `wait_for_selector('xpath///button[@id="late2"]')` after `insertLate('late2', 700)` gives `success:true`.

**(c) Every supported dialect finds real elements.** Run on MCP and runtime, plus CLI `click` and SDK `click`/`type` for the rows marked †. Each click is confirmed by the observer's `__fx6.clicks` tail equal to the expected id:
- `#plain-btn` †
- node id: `snapshot`, then the observer reads `#plain-btn[data-sd-node-id]` = N, then `click(String(N))` †
- `#shadow-btn` (auto-pierce) and `pierce/#shadow-btn` † (NEW; B5 failed)
- `xpath///button[@id="xp-btn"]` (NEW), `aria/Submit order[role="button"]` (NEW), `text/Exact text button` (NEW)
- `#in-frame-btn`
- the false-positive CSS list: `[data-text="text=Submit"]`, `[data-x="a >> b"]`, `[title="internal:role=button"]`, `[data-q="getByRole('x')"]`, `.a\>\>b`, `#getByRole`, `button.internal:not(.nope)`, each clicking its own fixture element
- payloads that aren't scanned: `aria/text=Submit` and `xpath///*[text()="text=Submit"]` both land on `pw-text-btn`
- `type('pierce/#shadow-input', 'hi')` †: the observer reads `hi`
- `click_by_text('Next >> step' | 'a=b' | 'text=Submit')` land on `chev-btn`, `eq-btn`, `pw-text-btn`
- `click_by_role('button', 'Go >> now')` lands on `role-name-btn`
- `type_by_label('Notes >> extra', 'v')` gives `#label-input` value `v`
- `upload_file_via_trigger('#browse-btn', tmpfile)` and `('pierce/#browse-btn', tmpfile)`: the observer reads `#hidden-file.files[0].name` equal to the basename

**(d) Overhead.** 20× `wait_for_selector('#plain-btn', attached)`. The median `executionTimeMs` minus B8's median must be < 25 ms (if the baseline exists; otherwise just recorded).

**Bundle smoke** (`mcp-cli.js`): A2's `click('text=Submit')`, B-new-1's `click('div[')` (proves esbuild serializes `selectorSyntaxProbeInPage` intact), and (c)'s `xpath///button[@id="xp-btn"]`.

**Regression gates** the Executor also runs:
- `tools/scenario-suite/ci-gate.mjs` (3 surfaces);
- `verify-fr2-01-wait-states.mjs`;
- `verify-fr2-02-extract-live.mjs`. Its N3 must still pass: the messages now come from detection, and they keep the `Invalid selector for field` shape plus the hint.

**Teardown:** MCP `browser.shutdown`, `stdin.end()` and kill; `runtime.shutdown`; CLI `close`; `observer.close()`; `rmWithRetry` of the profiles and the temp upload file. `live-summary.json` records 0 Chrome processes with a scratch profile in their command line and 0 new `sutradhar-cli-*` dirs.

---

## 6. Negative cases

| # | Case | Expected |
|---|---|---|
| N1 | Every D1 pattern via MCP `click` | `isError`, the hint, < 100 ms, no browser contact (A1/A2) |
| N2 | `pierce/text=Submit` | Rejected (the pierce payload is scanned, D4) |
| N3 | `aria/text=Submit`, `text/a >> b`, `xpath///*[text()="text=Submit"]` | Accepted. The first and third click `pw-text-btn`. `text/a >> b` resolves nothing and fails as not-found, **not** as invalid |
| N4 | `:is(:has-text("x"), #plain-btn)` | Rejected (documented forgiving-list exception, §7 R1). The observer records that Chrome's own `querySelector` accepts it |
| N5 | `div:has(> span)`, `button:focus-visible`, `internal:first-child` | Accepted (no false positive) |
| N6 | `#12`, `[#12]` | Rejected with "pass just the number" |
| N7 | `12`, ` 7 ` | Node id and a real click (no detection) |
| N8 | `''` via MCP `click` | Unchanged from today (`Click action requires a selector parameter`); recorded, not modified |
| N9 | `'   '` | Probe gives `Invalid selector` quickly (improvement) |
| N10 | `#host >>> #shadow-btn` on `click` | Invalid CSS plus the D11 note. On `upload_file_via_trigger` with `#host >>> #browse-in-shadow`, where applicable: accepted by Puppeteer natively (not rejected) |
| N11 | `xpath=//button`, `pierce=#x`, `aria=Submit` | Rejected with "use the slash form" (D5 narrowing, baseline B6 shows the old `=` behavior) |
| N12 | Unknown session with `text=x` on `runtime.click` | `InvalidSelectorError` (order change D7). With `#x`: `BrowserNotAvailableError` (unchanged) |
| N13 | `fill_form` `{ 'text=Name':'x', '#label-input':'y' }` | First field `success:false` with the hint; the second is typed (the observer reads `y`) |
| N14 | A pending `alert` in the tab, then `click('#plain-btn')` | Probe skipped (no 500 ms added); behavior as today |
| N15 | 10,000-char valid CSS | Detection < 5 ms; the action proceeds |
| N16 | `drag_and_drop('#plain-btn', 'div[')` | `Invalid selector "div["` names the target, `retriesUsed: 0` |
| N17 | Busy main thread (4 s) and `click('#plain-btn')` | Probe times out at 500 ms, inconclusive; the click succeeds after the busy loop (no misclassification) |

---

## 7. Risks

**R1: false-positive rejection (the hard rule; as bad as the original bug).**
- Every rule matches only strings that are invalid CSS (D9 proof per rule), after strings, comments and escapes are stripped.
- D2 pins about 40 real valid selectors, and live (c) clicks 7 false-positive-shaped selectors on real elements.
- **One documented exception:** a Playwright pseudo-class or `getBy*(` inside a forgiving `:is()`/`:where()` list. Chrome silently *drops* that branch, so the selector is valid but can never do what was written. Rejecting it with the hint is the lesser harm. It's recorded in decisions and pinned by N4.
- The probe counts only `SyntaxError`-named exceptions, and it parses with the same algorithm Puppeteer's `pierce/` uses (`Element.matches`), so the two can't disagree. A page that monkey-patches `DocumentFragment.prototype.querySelector` could skew it. That is exotic, and an exception with any other name is inconclusive.

**R2: narrowed existing behavior.** `text=`, `xpath=`, `aria=` and `pierce=` (Puppeteer's undocumented `=` separator, T8) used to work on `upload_file_via_trigger` and `frameSelector` hops. They are now rejected, with the exact fix in the message. Baseline B6 records it, and the changelog lists it.

**R3: contract change (D7).**
- Runtime methods now **throw** for Playwright selectors, where before they resolved `success:false` about 16 s later.
- Every MCP handler catches (M2 iterates them). The CLI pre-validates (§2.6), so self-heal can't be triggered whatever state GAP-006 is in. `fillForm` catches per field. The SDK's `page.click` now throws, which is an improvement over the silent resolve (B7).
- Error order changes for an unknown session combined with a Playwright selector (N12).

**R4: probe latency.** One `Runtime.callFunctionOn`, about 1-5 ms, measured in (d). It's bounded at 500 ms when the main thread is busy or the page is navigating (N17), and skipped when a dialog is pending (N14) or the selector is an exact node id. It's never part of `timeoutMs` and never counted as a retry.

**R5: prefix passthrough is new capability on engine actions.** `aria/` makes Puppeteer use rAF polling, the GAP-008 class of background-tab stall; that already applies to all `visible:true` clicks. `text/` has Puppeteer's semantics. All of this is documented in `targetDesc` and `--help`.

**R6: the D8 no-retry regex.** Only selector-parse errors produce `is not a valid selector` or `is not a valid XPath expression`. Unit E10 covers it, and the existing retry tests are unchanged.

**R7: FR2-02 coupling.**
- The constants are moved, not duplicated, and the exported names and import paths are unchanged.
- FR2-02's messages keep their shape (§2.4), and its unit tests are unchanged.
- FR2-02's live N3 must be re-run (§5 regression gates).
- If FR2-02 isn't DONE, the precondition stops the item.

**R8: serialization of `selectorSyntaxProbeInPage`.** Guarded by D8 (tsc/vitest) and the bundle smoke test (esbuild).

**R9: engine unit mocks.** All existing mocks lack `mainFrame().evaluate`, so the probe is inconclusive with **no timer created** (it returns before the race). Fake-timer tests are unaffected. Page-level `evaluate` scripts are never touched (T11).

### 7.1 Changelog fragment (behavior changes for 0.5.0)

1. Playwright-style selectors are rejected immediately with a hint. Runtime and SDK callers get a thrown `InvalidSelectorError` instead of a delayed `success:false`.
2. Invalid CSS/XPath fails in one round trip with the browser's parser message: `retriesUsed: 0`, no failure screenshot.
3. The `pierce/`, `xpath/`, `aria/` and `text/` prefixes now work on element actions.
4. The legacy `text=`/`xpath=`/`aria=`/`pierce=` forms are no longer accepted by `upload_file_via_trigger` and `frameSelector`.
5. SDK `page.click('text=…')` now throws.

---

## 8. Rollback

`git revert <FR2-06 commit>` reverts only the §1 files. There's no persisted state, no on-disk format, and no change to the tool count.
- The revert restores FR2-02's own `SELECTOR_SYNTAX_HINT` and `selectorSyntaxDetail` definitions in `types.ts` automatically, because FR2-06's commit is the one that moved them. FR2-02's tests then pass unchanged.
- Afterwards: add a `decisions.md` entry, set the ledger status to `TODO`/`BLOCKED`, drop the changelog fragment, and move GAP-new-1..4 back to TODO.
- A partial rollback (keeping detection and dropping the engine probe, or the reverse) is safe. The two layers are independent: detection is pure, and the probe's inconclusive path is today's behavior.

---

### Critical files for implementation
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\actions\browser-action-engine.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\capability-runtime\src\types.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\capability-runtime\src\runtime.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\cli.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\mcp-server\src\tools.ts`