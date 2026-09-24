# FR2-02: `extract_data` reads live values. Implementation spec

Written by the Planner (Opus, read-only), saved verbatim by the Orchestrator.

**Item:** FR2-02 (Phase 1, silent-wrongness bug).
**Decision in force:** §4.4 of the loop prompt, not reopened. `value`/`checked`/`selected` read
live DOM properties. `attr:<name>` reads the raw attribute. With no attribute, form controls
return `.value` and everything else returns `innerText`. The default return type stays
`Record<string, string[]>`. Any per-element metadata is opt-in only.
**Done-when additions:** an optional `visibleOnly`, and an actionable error for invalid selectors.

**Version:** the default output changes, so this item adds to the 0.5.0 minor bump. It does
**not** bump anything itself. It writes only a changelog fragment (§1).

**Sequencing:** this item shares four files with FR2-01: `runtime.ts`, `tools.ts`,
`runtime.spec.ts` and `tools.spec.ts`. FR2-02's DEVELOP must start from FR2-01's final tree,
after any FR2-01 FIX cycles, and must not run in parallel with FR2-01 fixes.

**The bug, as the code stands now** (line numbers on top of FR2-01, commit 16a9173):
- `packages/capability-runtime/src/runtime.ts:907-928`, `extractData`, in-page callback:
  ```ts
  const elements = Array.from(document.querySelectorAll(spec.selector));          // :921
  out[name] = elements.map((el) =>
    spec.attribute ? (el.getAttribute(spec.attribute) ?? '') : (el.textContent ?? '').trim(),   // :923
  );
  ```
- `packages/mcp-server/src/tools.ts:971-1002` is `browser.extract_data`, the only public way in.
  There is no CLI verb and no SDK method.

**Five extra findings (from reading the code, not in the original finding):**
- **Numeric node IDs aren't normalized for field selectors.** Field selectors never go through
  `normalizeTarget` (`types.ts:157-160`), so a snapshot node ID like `"12"` throws a raw
  `SyntaxError` today. `frameSelector` hops *are* normalized (`runtime.ts:880`). Normalizing fields
  is purely additive: every numeric selector fails today.
- **`resolveFrame` leaks the same raw error.** `current.$(normalizeTarget(hop))` at
  `runtime.ts:880` isn't wrapped. An invalid `frameSelector` leaks Puppeteer's raw `SyntaxError`
  text, and `eval` (`runtime.ts:939-949`) shares `resolveFrame`, so `browser.eval` leaks it too.
- **Invalid selectors abort mid-loop.** A bad selector throws out of the loop, so the whole call
  rejects and earlier fields are lost. No partial result today; the new design keeps it that way.
- **No `ERROR_HINTS` entry covers this.** None of `tools.ts:42-59` matches a selector-syntax error,
  so today the MCP text is the bare `extract_data failed: <puppeteer text>`.
- **Shadow DOM isn't pierced.** `document.querySelectorAll` doesn't enter shadow roots. That stays
  the same (§2.6).

---

## 1. Files to touch

| # | File | Reason |
|---|---|---|
| 1 | `packages/capability-runtime/src/types.ts` | New public types `ExtractFieldSpec`, `ExtractDataOptions`. Next to `normalizeTarget` (`:157`), add `SELECTOR_SYNTAX_HINT` and `selectorSyntaxDetail()`, the seam FR2-06 takes over (§2.5). |
| 2 | `packages/capability-runtime/src/extract/extract-data.ts` (new) | `planExtractFields` (Node side), `extractFieldsInPage` (self-contained in-page function), `invalidExtractSelectorsError`. Out of `runtime.ts` so they're unit-testable without a browser. |
| 3 | `packages/capability-runtime/src/runtime.ts` | Rewrite `extractData` (`:897-928`) with a new optional 5th positional `options` param and new JSDoc. Wrap the `$` call in `resolveFrame` (`:880`). |
| 4 | `packages/mcp-server/src/tools.ts` | `browser.extract_data` (`:971-1002`): per-field and top-level `visibleOnly`, describe `attribute`, new description, pass `options` through. **No `ERROR_HINTS` change** (§2.4). |
| 5 | `packages/capability-runtime/tests/unit/extract-data.spec.ts` (new) | §4.1, §4.2 |
| 6 | `packages/capability-runtime/tests/unit/runtime.spec.ts` | §4.3 |
| 7 | `packages/mcp-server/tests/unit/tools.spec.ts` | §4.4. Tool count unchanged. |
| 8 | `tools/scenario-suite/fixtures/fr2-02-extract-live.html` (new) | §3 |
| 9 | `tools/scenario-suite/verify-fr2-02-extract-live.mjs` (new) | §5 |
| 10 | `packages/mcp-server/README.md:73`, `AGENT_SETUP.md:68` | One-line descriptions match: live values, `attr:`, `visibleOnly`. |
| 11 | `.ai/loop/field-report-2/evidence/FR2-02/changelog-fragment.md` (new) | Behavior-change note for 0.5.0. |

**Not touched, on purpose:**
- **CLI and SDK.** Don't add a CLI `extract` verb or SDK `Page.extract` here. Done-when needs only
  MCP + runtime proof; §4.9 prefers the smallest diff; the CLI field-map syntax is really FR2-13's
  design question (its scenario `extract` steps are the first non-MCP consumer), and designing it
  twice risks two dialects. SDK users have `page.evaluate`. Orchestrator logs a minor gap (home:
  FR2-13) and records the choice.
- **`uploadFileViaTrigger` (`runtime.ts:1344-1363`)** and the engine's `resolveElement`: FR2-06.
- **`verify-fr2-01-wait-states.mjs`**: don't refactor it into a shared module; copy helpers (§5).
  Log a minor gap to consolidate after Phase 1.
- **`apps/server`, `packages/agent`, `packages/frontend`, `packages/sdk`, `tools/reliability/*`**:
  none call `extractData` (grep-verified).

---

## 2. API/schema diff

### 2.1 Types (`types.ts`, exported through `index.ts`'s `export *`)

```ts
/** One named field of {@link SutradharRuntime.extractData}. */
export interface ExtractFieldSpec {
  /** Standard CSS (run with querySelectorAll in the target document) or a snapshot node id ("12"). */
  selector: string;
  /**
   * What to read from each matched element.
   * - omitted or '' → "what the user sees": <input>/<select>/<textarea> → the live `.value`;
   *   <option> → `.text`; any other element → rendered `innerText`, trimmed (falls back to
   *   `textContent`, trimmed, for elements without innerText, e.g. SVG).
   * - 'value' | 'checked' | 'selected' (case-insensitive) → the LIVE DOM property, stringified
   *   ('checked'/'selected' give "true"/"false"). An element with no such property of the right
   *   type (string for value, boolean for checked/selected) falls back to the raw attribute.
   * - 'attr:<name>' → the raw markup attribute via getAttribute ('' when absent),
   *   e.g. 'attr:value' = the original default value.
   * - any other name (e.g. 'href') → the raw attribute, exactly as before (href is NOT resolved).
   */
  attribute?: string;
  /** Per-field override of {@link ExtractDataOptions.visibleOnly}. */
  visibleOnly?: boolean;
}

/** Call-level options for {@link SutradharRuntime.extractData}. */
export interface ExtractDataOptions {
  /** Drop matched elements that are not visible: computed visibility hidden/collapse, or a zero
   *  width/height bounding box (same rule as wait_for_selector's state 'visible'; opacity and
   *  off-screen position are ignored). An <option> is judged by its owning <select>. Default false. */
  visibleOnly?: boolean;
}
```

Also in `types.ts` (the FR2-06 seam, §2.5):

```ts
/** Actionable tail appended to every selector-syntax error. FR2-06 owns and may reword this. */
export const SELECTOR_SYNTAX_HINT =
  'Use standard CSS or a snapshot node id. Playwright-style selectors (text=, role=, >>, :has-text(), ' +
  'getBy*, internal:) are not supported: take a snapshot to find a CSS selector or node id, or use ' +
  'click_by_text / click_by_role / type_by_label to act by visible text.';

/** First line of a browser selector-parser message, with a leading "SyntaxError: " / "DOMException: " removed. */
export function selectorSyntaxDetail(parserMessage: string): string;
```

`selectorSyntaxDetail` never returns an empty string; with no message it returns
`'invalid selector syntax'`.

### 2.2 Runtime (`runtime.ts`)

**Before (`:907-912`):**
```ts
public async extractData(sessionId: string, fields: Record<string, { selector: string; attribute?: string }>,
                         tabId?: string, frameSelector?: string): Promise<Record<string, string[]>>
```

**After** (positional, as FR2-01 did for `waitForSelector`):
```ts
public async extractData(sessionId: string, fields: Record<string, ExtractFieldSpec>,
                         tabId?: string, frameSelector?: string,
                         options?: ExtractDataOptions): Promise<Record<string, string[]>> {
  const { tab } = this.resolveTab(sessionId, tabId);        // unchanged: unknown session still throws first
  const page = this.requirePage(tab);
  const plan = planExtractFields(fields, options);          // throws on 'attr:' with no name — before any CDP call
  const target = (frameSelector ? await this.resolveFrame(page, frameSelector) : page) as ...;  // unchanged cast
  const result = (await target.evaluate(extractFieldsInPage as never, plan as never)) as ExtractInPageResult;
  if (!result.ok) throw invalidExtractSelectorsError(result.invalid);
  return result.data;
}
```

- Resolving the tab first keeps `runtime.spec.ts:397-409` passing unchanged (unknown session throws
  `BrowserNotAvailableError` even with a `frameSelector`).
- JSDoc states the §2.1 read rules, the `visibleOnly` rule, "no shadow-DOM piercing", "all
  selectors are validated before anything is read: an invalid selector fails the whole call and
  names every bad field", and "arrays have one entry per match in document order unless
  `visibleOnly` drops some; with `visibleOnly`, index alignment across fields is not guaranteed."

**`resolveFrame` (`:880`), before:** `const handle = await current.$(normalizeTarget(hop));`

**After:**
```ts
let handle;
try {
  handle = await current.$(normalizeTarget(hop));
} catch (e) {
  const msg = (e as Error)?.message ?? String(e);
  if (/is not a valid selector|SyntaxError/i.test(msg)) {
    throw new Error(`Invalid frameSelector "${hop}" (from the full chain "${frameSelector}") — ` +
                    `${selectorSyntaxDetail(msg)} ${SELECTOR_SYNTAX_HINT}`);
  }
  throw e;          // navigation/context errors pass through untouched (same object)
}
```

- The two existing messages (`:882-884`, `:888-890`) stay byte-identical.
- Wrap instead of pre-validate: `$` accepts Puppeteer's `pierce/`, `xpath/`, `aria/`, `text/`
  prefixes, so a pre-check would reject valid input. `eval` inherits the fix.

### 2.3 `extract/extract-data.ts` (new)

```ts
export type ExtractRead =
  | { kind: 'auto' }
  | { kind: 'live'; prop: 'value' | 'checked' | 'selected' }
  | { kind: 'attr'; name: string };
export interface ExtractPlanEntry { name: string; selector: string; read: ExtractRead; visibleOnly: boolean; }
export type ExtractInPageResult =
  | { ok: true; data: Record<string, string[]> }
  | { ok: false; invalid: Array<{ name: string; selector: string; message: string }> };
```

**`planExtractFields(fields, options): ExtractPlanEntry[]`** (Node side, pure):
- Keep `Object.entries` order. `selector: normalizeTarget(spec.selector)`.
  `visibleOnly: spec.visibleOnly ?? options?.visibleOnly ?? false`.
- `attribute` → `read`:
  - `undefined` or `''` → `auto`.
  - Lowercase is `value`/`checked`/`selected` → `live` with the lowercased prop.
  - Starts with `attr:` (case-sensitive) → `attr` with the rest. If `name.trim() === ''`, throw
    `Error('extractData field "<name>": attribute "attr:" needs an attribute name after the prefix, e.g. "attr:value".')`.
  - Anything else → `attr`, string unchanged (old `getAttribute` behavior; `'href'` stays raw).

**`extractFieldsInPage(plan): ExtractInPageResult`** (in-page):
- **Fully self-contained**: no imports, no module-level constants or outside helpers (Puppeteer
  serializes it with `toString()`). Nested helpers `isVisible` and `read` are declared inside it.
  Synchronous.
- Algorithm:
  1. **Validate everything first**: for each entry
     `try { matches[i] = Array.from(document.querySelectorAll(sel)) } catch (e) { invalid.push({ name, selector, message: String(e?.message ?? e) }) }`.
     If any invalid, return `{ ok: false, invalid }` without reading any element.
  2. **Filter**: `visibleOnly ? els.filter(isVisible) : els`.
  3. **Map** with `read(el, entry.read)`.
  4. Build `data` with `Object.fromEntries(...)` (a field named `__proto__` becomes an own property).
- `isVisible(el)`: `t = el`; if `el.localName` is `option`/`optgroup`, `t = el.closest('select')`,
  and with no select (e.g. `<datalist>`) return `false`. Then FR2-01's rule:
  `const s = getComputedStyle(t); if (s.visibility === 'hidden' || s.visibility === 'collapse') return false; const r = t.getBoundingClientRect(); return r.width > 0 && r.height > 0;`
- `read(el, how)` — duck typing on `localName` and property type, never `instanceof` (breaks across
  frame realms):
  - `attr` → `el.getAttribute(how.name) ?? ''`
  - `live` → `v = el[how.prop]`. `value`: `typeof v === 'string'` → `v`. `checked`/`selected`:
    `typeof v === 'boolean'` → `String(v)`. Otherwise `el.getAttribute(how.prop) ?? ''`.
    **Live values are never trimmed.**
  - `auto`: `input`/`select`/`textarea` → `String(el.value ?? '')` untrimmed; `option` →
    `el.text ?? ''`; otherwise `typeof el.innerText === 'string'` ? `el.innerText.trim()` :
    `(el.textContent ?? '').trim()`.

**`invalidExtractSelectorsError(invalid): Error`** — one line per invalid field, then the hint:
```
Invalid selector for field "<name>": "<selector>" — <selectorSyntaxDetail(message)><prefixNote>
...
<SELECTOR_SYNTAX_HINT>
```
- `prefixNote` when `/^(pierce|xpath|aria|text)\//.test(selector)`:
  ` (extractData runs document.querySelectorAll, which does not support Puppeteer's pierce/ xpath/ aria/ text/ prefixes.)`
- Plain `Error` (`name === 'Error'`); message must not start with `SyntaxError`.

### 2.4 MCP (`tools.ts:971-1002`)

**Before:**
```ts
fields: z.record(z.string(), z.object({ selector: z.string(), attribute: z.string().optional() })).refine(...)
// handler: runtime.extractData(sessionId, fields, tabId, frameSelector)
```

**After:**
```ts
fields: z.record(z.string(), z.object({
    selector: z.string().describe('CSS selector or snapshot [#id]. Does not pierce shadow DOM.'),
    attribute: z.string().optional().describe(
      'Omit for the current value/visible text. "value" | "checked" | "selected" read LIVE state ' +
      '("checked"/"selected" → "true"/"false"). "attr:<name>" reads the raw HTML attribute ' +
      '(e.g. "attr:value" = original markup value). Any other name (e.g. "href") returns the raw attribute.'),
    visibleOnly: z.boolean().optional().describe('Per-field override of the top-level visibleOnly.'),
  })).refine(/* existing refine, message unchanged */),
tabId: /* unchanged */, frameSelector: /* unchanged */,
visibleOnly: z.boolean().optional().describe(
  'Drop matched elements that are not visible (visibility:hidden/collapse or a zero-size box; opacity ' +
  'is ignored). Default false: hidden matches are still returned.'),
// handler: ({ sessionId, fields, tabId, frameSelector, visibleOnly }) =>
//   runtime.extractData(sessionId, fields, tabId, frameSelector, { visibleOnly })
```

**New description** (content; wording may be tightened, but every fact must be present):
- For each named field give a CSS selector (or snapshot [#id]); one string per matching element in
  document order, e.g. `{"titles": {"selector": ".product h2"}, "links": {"selector": ".product a", "attribute": "href"}}`.
- With no attribute: form controls return their **live** current value including typed text;
  other elements return rendered text (innerText, trimmed), leaving out CSS-hidden text inside.
- `"value"`/`"checked"`/`"selected"` read live state; `"checked"`/`"selected"` return `"true"`/`"false"`.
- `"attr:<name>"` reads the raw HTML attribute. Any other name, e.g. `"href"`, returns the raw
  attribute, not resolved to an absolute URL.
- Hidden matches are still returned unless `visibleOnly` is true (whole call or per field).
- For a checkbox's state use `"checked"`; with no attribute a checkbox returns its value (usually `"on"`).
- For `<select multiple>`, `"value"` is only the first selected value; use
  `select option:checked` with `"value"` for all.
- Selectors don't pierce shadow DOM.
- `frameSelector` (existing text) extracts from inside an iframe, including cross-origin.

**`ERROR_HINTS`: no new entry.** The runtime message already carries the hint (and runtime/SDK
users have no hint layer); `withHint` would duplicate it. The new messages contain none of the
existing patterns, so nothing misleading is appended (M4 asserts this).

### 2.5 Selector validation: minimal, ready for FR2-06

- FR2-02 doesn't regex-detect Playwright patterns; those names appear only in the static hint.
  Sub-100ms detection is FR2-06's job.
- Validation is the browser's own parser, in the page (`querySelectorAll` inside `try`, collecting
  all failures before any read) — exactly FR2-06's "other invalid CSS fails fast with the parser
  message", at no extra round-trip, and the only correct parser for version-dependent syntax.
- FR2-06 absorbs it: every field selector and frame hop now passes through `normalizeTarget`, so
  FR2-06's validator there applies automatically (and `planExtractFields` runs before any CDP
  call). FR2-06 rewords `SELECTOR_SYNTAX_HINT`/`selectorSyntaxDetail` in one place and reuses them
  for `uploadFileViaTrigger` and `resolveElement`. The in-page check remains the second layer.
- **FR2-06 caveat:** its validator must accept `pierce/`, `xpath/`, `aria/`. Those then reach
  extract's in-page check, fail as invalid CSS, and get the prefix note — correct, extract never
  supported them.

### 2.6 Edge-semantics decisions (record in `decisions.md`)

| Case | Decision | Why |
|---|---|---|
| Checkbox/radio `checked` | `"true"`/`"false"` from `el.checked` (a text input gives `"false"`) | §4.4, duck typing |
| Checkbox, no attribute | `.value` (usually `"on"`), not checked state | §4.4 literally; description points to `"checked"` |
| `<select multiple>` `value` / none | `select.value` = first selected or `""` | Live property literally; no invented delimiter; alignment kept; description documents `option:checked` |
| `<option>`, no attribute | `option.text` | Spec-defined, rendering-independent |
| `<option>` `value` | `option.value` (falls back to text if no attribute) | Live property; change from `''` (§7) |
| `<option>` `selected` | `"true"`/`"false"` | §4.4 |
| `<option>` under `visibleOnly` | Judged by owning `<select>`; no select → hidden | Otherwise closed-dropdown options could all be dropped |
| contenteditable, no attribute | `innerText.trim()` | Not a form control |
| contenteditable `value` | Attribute fallback → `''` | Fallback rule |
| `href` / other names | Raw `getAttribute`, relative stays relative | §4.9 backward compat. Future `prop:<name>` is a logged idea, not built |
| `li`/`meter`/`progress` `value` (numeric) | Attribute fallback, as before | String type check |
| `output.value`, form-associated custom elements | Live property | Works for web components too |
| `display:none` element, no attribute | `innerText` falls back to text content (HTML spec) → text **returned**; dropped only under `visibleOnly` | Why `visibleOnly` exists; live verify asserts it |
| `visibility:hidden` element, no attribute | Whatever Chrome's `innerText` gives (expected `""`); never dropped without `visibleOnly` | Live verify asserts equality with observer, records literal |
| Hidden text inside a visible element | Left out by `innerText` | The "hidden text node" case; old `textContent` included it |
| `<script>`/`<style>` inside | Left out | Old `textContent` included source |
| `text-transform` | Applied (`"MIXED CASE"`) | What the user sees; §7 |
| Block children / `<br>` | `\n` inserted | Improvement over run-together text |
| SVG etc. without `innerText` | `textContent.trim()` | Fallback |
| `visibleOnly` definition | FR2-01 rule exactly (opacity:0, off-screen, clipped, occluded = visible; `display:contents` = hidden) | Consistency |
| `visibleOnly` inside `frameSelector` | Judged within the frame's own document only | Documented limitation |
| Shadow DOM | Not pierced | Out of scope, documented |
| `attribute: ''` | No attribute | Keeps falsy check |
| Numeric selector `"12"` | `[data-sd-node-id="12"]` | Additive |
| Password inputs | Live `.value` returned | Correct semantics; `eval` could already read it; §7 |

**Opt-in per-element metadata is deferred** (nothing needs it; adding later is additive).

**`innerText` cost: no new bound.** One forced layout per `evaluate`; the nested-match risk already
existed with `textContent`; truncation would be silent wrongness. C18 measures 5,000 rows; if it's
over its ceiling, log a gap, don't cap here.

---

## 3. Fixture: `tools/scenario-suite/fixtures/fr2-02-extract-live.html`

- Loaded by `file://` URL with a **query-string nonce** `?t=<nonce>` (never fragment-only; see the
  `decisions.md` gotcha). No network/external resources. Load script ends with
  `window.__fx2 = { ready: true }`.

| Element | Markup / load-time state | Purpose |
|---|---|---|
| `h1` | `FR2-02 extract_data live values` | Compat |
| `#name` | `<input id="name">`, no value attr | Typed with real keys: `"Ada Lovelace"` |
| `#prefilled` | `<input value="markup-default">` | Typed `"live-typed"`; attr ≠ live |
| `#notes` | `<textarea>default notes</textarea>` | Typed `"new notes"` |
| `#cb-js` | checkbox, no `checked` attr | Tool eval sets `.checked = true` |
| `#cb-markup` | checkbox `checked="checked"` | Tool eval unchecks → live `"false"` vs attr `"checked"` |
| `#cb-load` | checkbox; load script sets `.checked = true` | Page-set property |
| `#cb-click` | checkbox | Real tool click |
| `#r1`, `#r2` (`name=r`) | `#r1` checked in markup | Click `#r2` → `["false","true"]` |
| `#single` | options `a` (selected, "Alpha"), `b` ("Beta"), valueless "Gamma" | `select_option` → `'b'` |
| `#js-select` | `x` (`selected="selected"`), `y`; load script sets `.value='y'` | Live vs `attr:selected` |
| `#multi` | `<select multiple>` x,y,z | `select_options` → `['x','z']` |
| `#hidden-select` | `<select style="display:none">`, two options | Option visibility via select |
| `#editor` | `<div contenteditable><b>Hello</b> world</div>` | Typed `"Edited text"` |
| `#rel-link` | `<a href="/docs/page?x=1">Docs</a>` | href stays raw |
| `.msg` #m1 | `Visible message` | Visible |
| `.msg` #m2 | `display:none`: `SECRET-DISPLAY-NONE` | Hidden |
| `.msg` #m3 | `visibility:hidden`, sized: `SECRET-VIS-HIDDEN` | Hidden |
| `.msg` #m4 | `width:0;height:0;overflow:hidden`: `SECRET-ZERO` | Zero-size |
| `.msg` #m5 | inside `display:none` div: `SECRET-ANCESTOR` | Hidden ancestor |
| `#mixed` | `<p>Visible part<span style="display:none"> SECRET-NESTED</span></p>` | Hidden text node |
| `#with-script` | `<div>Shown<script>/*SCRIPT-SOURCE*/</script></div>` | Script excluded |
| `#upper` | `text-transform:uppercase`: `mixed Case` | text-transform |
| `#multiline` | `<div><div>Line A</div><div>Line B</div></div>` | Newline |
| `#ghost` | `opacity:0`, sized | Visible per rule |
| `#offscreen-msg` | `position:absolute;left:-9999px`, sized | Visible per rule |
| `#csrf` | `<input type="hidden" value="tok123">` | Dropped by `visibleOnly`, kept by override |
| `#host` | open shadow root with `<span class="in-shadow">shadow text</span>` | Not pierced |
| `iframe#f` | srcdoc: `<input id='fi' value='frame-markup'>`, `<p class='fmsg'>frame visible</p>`, `<p class='fmsg' style='display:none'>FRAME-SECRET</p>` | frameSelector + visibleOnly |
| `#big` | `<ul style="height:120px;overflow:auto">` + 5,000 `<li class="row">Row N</li>` | C18 |

Malformed selectors come from the verify script, not the fixture. (FR2-01 lesson: inside an HTML
`srcdoc` attribute, close scripts with plain `</script>`, not `<\/script>`.)

---

## 4. Unit tests

**No existing assertion may be changed, removed or loosened.** Must pass unchanged:
`runtime.spec.ts:397-409`, `:425-464` (four `resolveFrame` tests incl. exact messages and `$`
args), `:502-531` (FR2-01 R1/R2); `tools.spec.ts:22-95`, `:95-113` (tool list and exact count —
**no new tool**), `:318-381` (FR2-01 M1-M4).

### 4.1 `extract-data.spec.ts` (new): `planExtractFields`
- **P1** no attribute / `''` → `auto`.
- **P2** `'value'`,`'checked'`,`'selected'`,`'Value'`,`'CHECKED'` → `live` lowercase.
- **P3** `'attr:value'` → name `value`; `'attr:data-x'` → `data-x`.
- **P4** `'href'`,`'data-id'`,`'aria-label'` → `attr` unchanged.
- **P5** `'attr:'`, `'attr:   '` throw `/attribute "attr:" needs an attribute name/`, naming the field.
- **P6** `'12'` → `'[data-sd-node-id="12"]'`; `' 7 '` → `'[data-sd-node-id="7"]'`; `'.a > b'` unchanged.
- **P7** visibleOnly: call true/field unset → true; call true/field false → false; field true → true; neither → false.
- **P8** output order = insertion order.

### 4.2 Same file: `extractFieldsInPage`
`vi.stubGlobal('document', { querySelectorAll })`, `vi.stubGlobal('getComputedStyle', fn)`, fake
elements as plain objects; unstub after each.
- **I1** input auto: `value:'  typed '`, attr `'markup'` → `'  typed '` exactly (untrimmed).
- **I2** select/textarea auto → `.value`.
- **I3** option auto → `.text`, not `innerText`.
- **I4** div auto → `innerText.trim()`; `innerText` undefined → `textContent.trim()`.
- **I5** live `value` on div → attribute `'x'`; `null` → `''`.
- **I6** live `checked` true/false → `'true'`/`'false'`; non-boolean → attr fallback; option `selected` true → `'true'`.
- **I7** attr → raw attr (`value:'live'`, attr `'markup'` → `'markup'`); `null` → `''`.
- **I8** `li` numeric `value: 3`, attr `'3'` → `'3'`; attr `null` → `''` (not `'3'`).
- **I9** visibleOnly over five: visibility hidden, collapse, width 0, height 0 dropped; opacity `'0'` kept → length 1; with false → 5 in order.
- **I10** option whose `closest('select')` is visible kept despite 0×0 own rect; `closest` null → dropped.
- **I11** valid `a` + `bad` throwing a SyntaxError-named error "Failed to execute 'querySelectorAll' on 'Document': '.p[' is not a valid selector." → `{ ok:false, invalid:[{ name:'bad', selector:'.p[', message }] }`; element accessors (throwing getters) never touched; two bad fields → both listed in order.
- **I12** self-contained: `new Function('return (' + extractFieldsInPage.toString() + ')')()` on the I1 scenario gives the same result.
- **I13** field `'__proto__'` → own property, array value.

`invalidExtractSelectorsError`:
- **X1** message matches `/^Invalid selector for field "bad": "\.p\[" — Failed to execute 'querySelectorAll' on 'Document': '\.p\[' is not a valid selector\./`, ends with `SELECTOR_SYNTAX_HINT`, `name === 'Error'`, doesn't start with `SyntaxError`.
- **X2** leading `SyntaxError: ` stripped.
- **X3** `pierce/#x` → contains `does not support Puppeteer's pierce/`.
- **X4** two entries → two lines, exactly one hint.

### 4.3 `runtime.spec.ts` additions — `describe('extractData live values (FR2-02)')`
Stub `resolveTab` → `{ tab: {} }`, `requirePage` → `fakePage` with `evaluate = vi.fn((fn, arg) => fn(arg))`, §4.2 globals stubbed.
- **R1** `{ v:{selector:'#i'}, t:{selector:'12'} }` → exactly `{ v:['typed'], t:['text'] }` (no `ok` wrapper); plan had `'[data-sd-node-id="12"]'`.
- **R2** invalid → rejects `/^Invalid selector for field "bad"/`, contains `is not a valid selector` and `Playwright-style`, `name === 'Error'`.
- **R3** `'attr:'` → rejects `/needs an attribute name/`, `evaluate` not called.
- **R4** `{ visibleOnly: true }` → every plan entry `visibleOnly: true`; per-field false → false.
- **R5** `resolveFrame` wraps: `$` rejects with "SyntaxError: Failed to execute 'querySelector' on 'Document': 'iframe[' is not a valid selector." → rejects `/^Invalid frameSelector "iframe\[" \(from the full chain "iframe\["\) — Failed to execute/`, contains `Playwright-style`, not `SyntaxError:`.
- **R6** non-syntax rejection (`'Execution context was destroyed'`) rethrown as the same object (`rejects.toBe(err)`).
- **R7** chain `'iframe.a::iframe['` with second-hop syntax error → message names hop `"iframe["` and chain `"iframe.a::iframe["`.

### 4.4 `tools.spec.ts` additions — `describe('@sutradhar/mcp-server browser.extract_data live values (FR2-02)')`
- **M1** schema: top-level `visibleOnly` true/undefined ok, `'yes'` fails; field with `attribute:'attr:value', visibleOnly:true` ok; field `visibleOnly:'yes'` fails; `{}` still fails with the existing refine message.
- **M2** pass-through: `{ sessionId:'s1', fields:F, tabId:'t1', frameSelector:'#f', visibleOnly:true }` → `('s1', F, 't1', '#f', { visibleOnly: true })`; without → `('s1', F, undefined, undefined, { visibleOnly: undefined })`; result parses to `{ v:['x'] }`.
- **M3** description contains `live`, `attr:`, `visibleOnly`, `innerText`, `"true"`, `option:checked`, `shadow`; `attribute` field description contains `attr:`.
- **M4** spy rejects with the X1 message → `isError`, text starts `extract_data failed: Invalid selector for field "bad"`, no `page may still be loading`, no `Hint:`.
- **M5** `browser.eval` spy rejects with an R5-style message → text starts `eval failed: Invalid frameSelector`.

---

## 5. Live-verify script: `tools/scenario-suite/verify-fr2-02-extract-live.mjs`

Prerequisite `pnpm build`. Copy helpers verbatim from `verify-fr2-01-wait-states.mjs` (don't import
or refactor it): `freshUrl` (query-string nonce), `delay`, `record`, `writeJsonl`,
`resolveChromeExecutablePath`, `rmWithRetry`, `makeMcpClient`, `textOf`, `jsonOf`.

Output to `.ai/loop/field-report-2/evidence/FR2-02/`: `live-mcp.jsonl`, `live-runtime.jsonl`,
`live-bundle.jsonl`, `live-summary.json` (per case: surface, case, expected, observed,
observerTruth, oldSemanticsWouldReturn, pass, ms), `live-verify.log`. Exit 1 on any failure.

**Observer:** `puppeteer-core` via `createRequire(packages/browser/package.json)`,
`puppeteer.launch({ executablePath, headless: true, userDataDir: <mkdtemp>, args: ['--no-sandbox'] })`.
Both surfaces **attach** to it: MCP `browser.attach({ endpoint: observer.wsEndpoint() })`; runtime
`new SutradharRuntime({ logger: silent }).attach({ endpoint })`. After each tool navigation, find
the page by URL prefix and `waitForFunction(() => window.__fx2?.ready)`.

**Ground truth, every case:** (1) tool output equals a hard-coded expected literal where semantics
are defined; (2) the observer's own DOM read confirms the state is real (e.g. `#cb-js.checked ===
true && !hasAttribute('checked')`); (3) `oldSemanticsWouldReturn` = observer computes the old
formula on the same elements; for C1-C4, C6, C8, C10 assert it **differs** from the new output.
Where semantics are "whatever Chrome's innerText is" (#m3, #m4, #upper, #multiline), assert tool
output === observer `innerText.trim()` and record the literal.

**Driver abstraction** runs the same cases on both surfaces: navigate, type, click, selectOption,
selectOptions, eval, snapshot, extract(fields, frameSelector?, visibleOnly?). Runtime throws are
caught into `{ ok:false, errorText, errorName }`. Typing always through the tool (real CDP keys).

| # | Steps | Expected |
|---|---|---|
| C1 | Type `#name` "Ada Lovelace"; extract `{a:'#name', b:{'#name', value}}` | both `["Ada Lovelace"]`; old `[""]`,`[""]` |
| C2 | Type `#prefilled` "live-typed"; extract `value`, `VALUE`, `attr:value`, none | `["live-typed"]`,`["live-typed"]`,`["markup-default"]`,`["live-typed"]`; old value `["markup-default"]` |
| C3 | Type `#notes` "new notes"; none, `attr:value` | `["new notes"]`, `[""]`; old `["default notes"]` |
| C4 | Tool eval `#cb-js.checked=true; #cb-markup.checked=false`; click `#cb-click`; `checked` on 4 boxes, `Checked` on #cb-js, `attr:checked` on each, none on #cb-js | `["true"]`,`["false"]`,`["true"]`,`["true"]`; `["true"]`; `[""]`,`["checked"]`,`[""]`,`[""]`; `["on"]`; observer confirms `.checked` |
| C5 | Click `#r2`; `input[name=r]` checked | `["false","true"]` |
| C6 | `select_option('#single','b')`; `#single` value/none/`attr:value`; `#single option` selected/none/value; `#js-select` value; `#js-select option` selected/`attr:selected` | `["b"]`,`["b"]`,`[""]`; `["false","true","false"]`,`["Alpha","Beta","Gamma"]`,`["a","b","Gamma"]`; `["y"]`; `["false","true"]`,`["selected",""]`; old none on #single `["AlphaBetaGamma"]` |
| C7 | `select_options('#multi',['x','z'])`; `#multi` value; `#multi option:checked` value | `["x"]`, `["x","z"]` |
| C8 | Type `#editor` "Edited text"; none, value | `["Edited text"]` (= observer innerText.trim()), `[""]` |
| C9 | `#rel-link`: href, `attr:href`, none | `["/docs/page?x=1"]` ×2, `["Docs"]`; observer `el.href` absolute ≠ raw |
| C10 (Done-when) | `.msg` none, then `visibleOnly`; `#mixed`, `#with-script`, `#upper`, `#multiline` | length 5, `[0]` "Visible message", `[1]` "SECRET-DISPLAY-NONE", `[4]` "SECRET-ANCESTOR", `[2]`,`[3]` = observer innerText.trim() (recorded); visibleOnly → exactly `["Visible message"]`, no `SECRET-` in JSON; `#mixed` `["Visible part"]`; `#with-script` `["Shown"]`; `#upper`,`#multiline` = observer (expect "MIXED CASE", "Line A\nLine B") |
| C11 | Call `visibleOnly:true` with `{msg:'.msg', csrf:{'#csrf', visibleOnly:false}}`; then call unset with `{msg:{'.msg', visibleOnly:true}}`; `#csrf` with call visibleOnly, no override | `["tok123"]`,`["Visible message"]`; `["Visible message"]`; `[]` |
| C12 | `#single option` visibleOnly; `#hidden-select option` with/without | 3; `[]` and 2; observer records raw option rect |
| C13 | `#ghost`, `#offscreen-msg` visibleOnly | both returned |
| C14 | Type `#fi` "in-frame"; `frameSelector:'#f'` `{v:'#fi', a:{'#fi', attr:value}, m:{'.fmsg', visibleOnly:true}}`; top-level `{v:'#fi'}` | `["in-frame"]`,`["frame-markup"]`,`["frame visible"]`; top-level `[]`. If the type tool can't reach `#fi`, record it as a separate finding and type via the observer's `frame.type` so the extract assertion still runs |
| C15 | `.in-shadow` | `[]`; observer confirms it exists in `#host.shadowRoot` |
| C16 | Tool `snapshot` after C1 typing; observer reads `#name`'s `data-sd-node-id` N; extract `{v:{selector:String(N)}}` | `["Ada Lovelace"]` |
| C17 | `h1` none | `["FR2-02 extract_data live values"]` = old textContent.trim() |
| C18 | `.row` none, timed | length 5000, `[0]` "Row 0"; record ms and observer textContent baseline; fail only if tool > 5000ms |
| C19 | Observer sets `#cb-js.checked=false`, `#name.value='changed'`; re-extract | `["false"]`, `["changed"]` |

**Bundle smoke** (`packages/sutradhar/dist/mcp-cli.js`, spawned like MCP): C1, C4 (`#cb-js`),
C10 (`visibleOnly`), N1 — proves esbuild serializes `extractFieldsInPage` intact.

**Teardown:** MCP `browser.shutdown`, `stdin.end()`, kill; `runtime.shutdown(sid)`;
`observer.close()`, `rmWithRetry` the profile; final check in `live-summary.json`: 0 Chrome
processes with the scratch profile path in their command line.

---

## 6. Negative cases (MCP and runtime; † also bundle)

| # | Case | Expected |
|---|---|---|
| N1† | `.price[` | MCP `isError`, text starts `extract_data failed: Invalid selector for field "bad": ".price["`, contains `is not a valid selector` and `Playwright-style`. Runtime rejects `name === 'Error'`, not starting `SyntaxError`. Observer records Chrome's raw `querySelectorAll('.price[')` error as "before" |
| N2 | `{ok:'h1', bad:'.x[', bad2:'a[['}` | Error, no partial data, names both, one hint |
| N3 | `text=Buy`, `button >> text=OK`, `role=button`, `div:has-text("x")`, `internal:text="x"` (separate calls) | Each an invalid-selector error with hint. Record the parser message; if Chrome unexpectedly accepts one, record and log for FR2-06 |
| N4 | `pierce/#x` | Contains `does not support Puppeteer's pierce/` |
| N5 | `frameSelector:'iframe['` on extract and on eval (MCP + runtime) | `Invalid frameSelector "iframe[" (from the full chain "iframe[") — …` + hint; observer records raw `page.$('iframe[')` error |
| N6 | `frameSelector:'#nope'`; `'h1'` | Existing messages unchanged |
| N7 | `attribute:'attr:'` | `/needs an attribute name/` |
| N8 | MCP `visibleOnly:'yes'` top-level and per-field | Schema rejection, never data |
| N9 | MCP `fields:{}` | Existing refine error |
| N10 | selector `""` | Invalid-selector error |
| N11 | Unknown `sessionId` | Runtime `BrowserNotAvailableError`; MCP `No browser session` + existing hint |
| N12 | `#does-not-exist` | `[]`, not an error |
| N13 | `visibleOnly` on `#m2` only | `[]`, not an error, no hidden text |

---

## 7. Risks

### 7.1 Callers whose output changes

| Caller | Call | Impact |
|---|---|---|
| `tools/engine-comparison/sutradhar-extreme.mjs:218-226` | `{heading:'h1'}` in cross-origin frame (example.com) | `innerText` = `textContent.trim()`; no change expected. Auditor re-runs (network) |
| `packages/capability-runtime/scripts/smoke-wave6.mjs:129-133` | table cells | Plain text; asserts non-empty only |
| `tools.ts:997` (all MCP users) | — | **Intended change**: form controls live; other elements innerText (text-transform applied, hidden descendants and script text out, `\n` between blocks); live value/checked/selected; option value falls back to text; `output.value` live |
| `AGENT_SETUP.md:68,151`, `mcp-server/README.md:73`, `~/.claude/skills/uat/SKILL.md:100` | docs | First two updated here; uat skill still accurate, flag for FR2-17 |
| Historical WebBench/loop runs | not re-runnable | whitespace shapes would differ |
| scenario-suite runners, ci-gate, soak, apps/server, agent, frontend, sdk | none | none |

### 7.2 Other risks
1. Index alignment across fields breaks only under `visibleOnly` (documented).
2. Serialization of `extractFieldsInPage`: guarded by I12 (tsc/vitest) and the bundle smoke
   (esbuild). `build-bundle.mjs` uses no `keepNames`/`minify` (`:95-104`); keep it that way.
3. Chrome `innerText` specifics asserted by observed equality, not assumed.
4. Option rects: the select-delegation rule doesn't depend on them; C12 records them.
5. Password values now readable without an attribute (eval already could); note in changelog.
6. `innerText` cost measured in C18; no cap.
7. FR2-06 overlap: FR2-06's spec must build on `SELECTOR_SYNTAX_HINT`/`selectorSyntaxDetail`.
8. Handler always passes `{ visibleOnly }` (possibly undefined): harmless; M2 pins it.
9. Stale-execution-context errors pass through unchanged (R6).

## 8. Rollback

`git revert <FR2-02 commit>` reverts only §1's files. No persisted state, no on-disk format, no
tool-count change. Afterwards: `decisions.md` entry, ledger `TODO`/`BLOCKED`, drop the changelog
fragment. If FR2-06 already landed on top, it must keep or re-add `SELECTOR_SYNTAX_HINT` and
`selectorSyntaxDetail` in `types.ts`.
