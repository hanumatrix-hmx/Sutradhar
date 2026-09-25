# FR2-02 audit-1: independent Auditor (Opus) report

**Verdict: PASS with caveats.** The product code matches the spec. I checked it line by line,
killed 10 of 10 mutations, and ran 14 of my own adversarial cases live, all passing. Six gaps are
logged below (GAP-169 to GAP-174). None makes shipped behavior wrong. Two are cheap test-integrity
fixes worth landing with the commit: GAP-169 and GAP-170.

## 1. Spec re-derivation vs the code (`extract/extract-data.ts`, `runtime.ts`, `types.ts`, `tools.ts`)
- `attr:<name>`: its branch is checked first in `read()` and returns `el.getAttribute(name) ?? ''`
  for every element type. No live-property code runs. Confirmed live on checkbox, radio, select,
  option and multi-select (adv-live (c), (a), and the bundle MCP case).
- Form-control default: `localName` is `input`/`select`/`textarea` → `String(value ?? '')`,
  untrimmed. `option` → `.text`. Anything else → `innerText.trim()`, falling back to `textContent.trim()`. This matches spec §2.3.
- `planExtractFields`: the live keywords are case-insensitive and `attr:` is case-sensitive, as
  the spec says. A blank name after `attr:` throws. Everything else is the raw attribute.
  `normalizeTarget` is applied to each field selector.
- Visibility: `browser-action-engine.ts:1605-1608`, `:1896-1899` and `:2020-2023` use
  `!['hidden','collapse'].includes(s.visibility) && r.width > 0 && r.height > 0`. `isVisible` in
  extract-data.ts is the same predicate, written as two statements. So it is semantically
  identical, but not byte-identical. The only addition is the option/optgroup → `closest('select')`
  delegation that spec §2.3 asks for.
- `resolveFrame` wrap: this matches spec §2.2. Non-syntax errors are rethrown as the same object
  (R6).

## 2. Revert-and-confirm (my own subset, 10 mutations): `revert-and-confirm.txt`
Each mutation was applied, the target test was run, the failure diff was read, the file was
restored, and a clean re-run passed. SHA-256 of all four touched files matched the pre-audit
values afterward.

| Mutation | Test that caught it | Failure (read, correct reason) |
|---|---|---|
| A `attr:` reads live prop first | I7 | `"markup"` became `"live"` |
| B option auto → innerText | I3 | `"Alpha"` became `"NOT THIS"` |
| C textarea dropped from the form-control set | I2 | `"notes text"` became `""` |
| D validation stops at the first bad selector | I11 | `bad2` missing |
| E reads interleaved with validation | I11 | throwing getter hit (`"should never be called"`) |
| F option not delegated to its select | I10 | `["kept"]` became `[]` |
| G live keyword case-sensitive | P2 | `Value` became kind `attr` |
| H resolveFrame no longer wraps | R5 | raw `Failed to execute 'querySelector'` |
| I MCP handler drops visibleOnly | M2 | called with `{}` |
| J visibility ignores `collapse` | I9 | 2 elements kept, not 1 |

## 3. C12 live (`adv-live-output.txt`)
In real headless Chrome, **every `<option>` inside a closed dropdown `<select>` has a 0×0 rect**,
even when its select is visible. Only `size=3` listbox options have real rects. So the
select-delegation rule is load-bearing: a naive per-option check would drop every option.

Observed with `visibleOnly`:
- Visible select: kept.
- `display:none` select: `[]`.
- Select inside a `display:none` parent: `[]`.
- `visibility:hidden` select (70×19 box): `[]`.
- Listbox options and optgroup: kept.
- `<datalist>` options: `[]`.
- Option in a hidden select inside an iframe: `[]`.

Without `visibleOnly`, all hidden options are still returned. The implementation is correct live.
The unit test alone would not have shown the 0×0 fact. C12 is still missing from the re-runnable
script (GAP-171).

## 4. The 5 "pre-existing, unrelated" full-repo failures: `vitest-full-with-fr2-02.txt`
The full run gave 762/767 tests, 70/74 files.

- **The 5 failing tests are all Ollama tests** (`packages/llm` gateway.spec ×2, local.spec ×3).
  They fail with HTTP 404 `model 'qwen3.5:9b' not found`. Ollama is running but has zero models
  (`/api/tags` → `{"models":[]}`). `@sutradhar/llm` depends on neither capability-runtime nor
  mcp-server. They are unrelated.
- **The 2 failing files are FR2-16 standalone scripts**, `doc-static.spec.mjs` and
  `stealth-claim-check.mutation.spec.mjs`. Vitest reports `process.exit unexpectedly called with
  "0"`, and their own output is `ALL PASS`. Run directly with node on the FR2-02 tree, both exit 0
  (`fr2-16-*.with-fr2-02.txt`). That also shows FR2-02's doc edits pass the stealth-claim check.
- The Executor described these as "Ollama tests and FR2-16 stealth tests" among the 5 failures.
  That is slightly inaccurate: all 5 failing tests are Ollama tests, and FR2-16 accounts for 2
  failing files, not tests (GAP-174).

## 5. Adversarial angles: `adv-live.mjs` / `adv-live-output.txt`, 14/14, 0 lingering Chrome
- (a) `<select multiple>` with b, c, d selected: with no attribute and with `value` → `["b"]`.
  `option:checked` + `value` → `["b","c","d"]`. With no attribute → `["B","C","D"]`. Per-option
  `selected` is correct. This matches the documented design.
- (b) Shadow DOM is still not pierced: light-DOM selectors return `[]`. The host's innerText is
  `""`. `pierce/` is rejected with the prefix note. The schema and tool description say so.
- (c) `attr:checked` returns the raw attribute after real clicks: live `false` / raw `""` on a
  markup-checked box, and live `true` / raw `""` on a plain box. This confirms the bypass. But see
  GAP-173: a bare `<input checked>` reads `""`, which is the same as absent.
- (d) With 6 fields, 4 of them invalid (`.a[`, `text=Buy`, `div:has-text("x")`, `""`), all 4 are
  named in order. No data is returned, the hint appears exactly once, and the error is a plain
  `Error`. The same holds for 3 invalid fields through the esbuild bundle over MCP.
- Also run live, though the Executor did not: N3 (5 Playwright-style selectors, each rejected
  with the hint), N11 (`BrowserNotAvailableError`), and N5 on the `eval` side (wrapped message).
  Also checked: password live value, `attr:` whitespace/case (GAP-172), and live checked plus
  option visibility inside a frame.

## 6. Re-runs
All re-runs are forced, with no turbo cache. The Executor's run-1 typecheck and build logs were
100% cache replays.

- Typecheck: 34/34 successful, 0 cached, exit 0.
- Build: 19/19 plus 9/9 (bundle) successful, 0 cached, exit 0. The bundle was rebuilt. The
  in-bundle `extractFieldsInPage` has no `__name` or helper references, and there is no
  `keepNames`.
- vitest for capability-runtime + mcp-server: 8 files, **220/220**. The new tests are
  extract-data.spec 25, runtime.spec +7 (84 total), and tools.spec +5 (43 total).
- The Executor's live-verify, re-run into `live-verify-rerun/`: **61/61** (30 MCP, 27 runtime,
  4 bundle), 0 lingering Chrome.

## Gaps

GAP-169 | FR2-02 audit-1 | minor, test-integrity | `runtime.spec.ts` `extractData live values (FR2-02)` calls `vi.spyOn(SutradharRuntime.prototype, 'resolveTab'/'requirePage')` with no `vi.restoreAllMocks()`. The root vitest.config has no `restoreMocks`, so the prototype stays mocked for every later test in the file. Demonstrated in `spy-leak-probe.txt`: a probe appended after the FR2-02 describe found both prototype methods still mocked, and `extractData('no-such-session', …)` returned an invalid-selector error instead of `BrowserNotAvailableError`. It masks nothing today (the later FR2-09/FR2-10 tests pass either way), but any future unknown-session test placed after line 537 would silently pass or fail wrongly. Fix: add `vi.restoreAllMocks()` to that describe's `afterEach`. |
GAP-170 | FR2-02 audit-1 | minor, evidence accuracy | run-1's C14 records the finding "click/type tools do not target inside a srcdoc iframe by top-level selector". The script never tested this: it tried typing into `#f`, the iframe element itself, not `#fi`. It then set `#fi.value` through the observer with `frame.evaluate`, so C14 exercises a JS property set, not real keystrokes. `c14-type-into-frame-probe-output.txt` shows `runtime.click`/`runtime.type(sid, '#fi', 'in-frame')` succeed with real keys, and extract with frameSelector `#f` then returns `["in-frame"]`/`["frame-markup"]`. The recorded "finding" is false and must not be logged as a tool limitation. The script should type through the tool. |
GAP-171 | FR2-02 audit-1 | minor, test coverage | `verify-fr2-02-extract-live.mjs` deviates from spec §5/§6. (1) In C6 the `value` call is identical to `none`, so `#single` with `attribute:'value'` is never exercised. (2) The spec's "old semantics must differ" assertion is missing for C4, C8 and C10. (3) C12, N3 and N11 are absent, as is N5 on `eval`. (4) The observer's raw "before" errors for N1/N5 are not recorded. (5) There is no `live-verify.log`, and per-case records lack the `surface`/`observerTruth`/`ms` fields in most cases. audit-1's `adv-live.mjs` covers C12, N3, N11 and N5-eval live, and all passed, but the committed re-runnable script still lacks them. |
GAP-172 | FR2-02 audit-1 | minor, silent wrongness | `attr:` validation trims but use doesn't: `'attr: value'` passes validation and then reads `getAttribute(' value')`, giving `""` silently. `'Attr:value'` falls through to a raw attribute literally named `Attr:value`, also `""` silently. This is spec-literal ("the rest", case-sensitive prefix), but it is the silent-wrongness class this item exists to remove. Suggest using the trimmed name, and/or treating the prefix case-insensitively. Confirmed live in adv-live "extra". |
GAP-173 | FR2-02 audit-1 | minor, design/docs | `attr:<boolean attribute>` on a bare boolean attribute (`<input checked>`, `<option selected>`, the most common markup form) returns `""`, the same as absent. It cannot tell you the markup default. run-1's fixture used `checked="checked"`, which hides this. Workaround: a presence selector (`#cb[checked]`) with length > 0. Document it in the tool description, or consider a `has:<name>` form later (FR2-17 docs home). |
GAP-174 | FR2-02 audit-1 | minor, evidence accuracy | run-1's claims are slightly inaccurate. (1) "5 failures = Ollama + FR2-16 tests": in fact all 5 failing tests are Ollama (no model installed), plus 2 FR2-16 file-level `process.exit(0)` artifacts. (2) "build clean across 34 packages": the build is 19 + 9 tasks, and 34 is the typecheck count. (3) run-1's typecheck/build logs are full turbo cache replays (0 fresh), so they don't prove a fresh compile. audit-1's forced re-runs confirm all three are clean. |

Out of scope, pre-existing: the `tools/scenario-suite/results/baseline-{cli,mcp,sdk}.json`
modifications are GAP-100/GAP-106 churn (mtime 08:35, before FR2-02 work). They must not go into
the FR2-02 commit.
