# FR2-11: Full action history (implementation spec)

**Item:** FR2-11, Phase 3. History is currently per tab, capped at 200, missing navigate and eval, kept only in memory, and the CLI has no history command.

**Decisions in force:**
- §4.9 of the loop prompt: prefer additive, opt-in changes, then the smallest diff, then consistency with the surrounding code.
- FR2-03 D11 / spec §2.5: `clearStateFileIfUnchanged` removes only `state.json`, and removes the directory only if it is empty. That spec names `history.jsonl` as a sibling that must survive.
- FR2-04 D-10: sidecar files next to `state.json` (`warden.json`) are versioned `{v:1,…}` objects, kept separate so they never race `writeState`'s read-modify-write.
- FR2-07 D1 and D11: evidence strings are capped at 200 characters and details at 300. Evidence never contains field values or clipboard contents.
- FR2-09 D5 and FR2-10: display URLs are origin plus pathname. The query and fragment are dropped because they carry tokens. Display URLs are middle-truncated at 80 characters.

**Baseline read at:** HEAD `e638e2a` on `claude/field-report-2-loop`. All line numbers below were read in this planning session from the current files.

**Soft dependency: FR2-07.** The ledger shows FR2-07 at `SPEC`, not `DONE`. Under the P1 → P2 → P3 order, FR2-07 should be DONE before FR2-11's DEVELOP starts, but this spec does not require it (§0.6).

---

## 0. Trace results (grounded at `e638e2a`)

### 0.1 The per-tab history today

- `packages/browser/src/session/browser-tab.ts:52`: `const MAX_ACTION_HISTORY = 200;`. The cap really is 200, and the constant is module-private, not exported.
- `:56-63`: `ActionHistoryEntry` is `{actionType, selector?, success, error?, executionTimeMs, timestamp}`. It has no target, URL or verification field.
- `:142-143`: `IBrowserTab.getActionHistory()` and `recordAction(entry)` are both required members.
- `:166`: `private readonly actionHistory: ActionHistoryEntry[] = []`.
- `:513-520`: the whole implementation:

  ```ts
  public getActionHistory(): readonly ActionHistoryEntry[] { return this.actionHistory; }
  public recordAction(entry: ActionHistoryEntry): void {
    this.actionHistory.push(entry);
    if (this.actionHistory.length > MAX_ACTION_HISTORY) this.actionHistory.shift();
  }
  ```

  **Eviction is silent.** `shift()` drops the oldest entry, and nothing counts it anywhere. `getActionHistory` returns the live array reference.
- **Timestamps** are `new Date().toISOString()`: UTC, millisecond precision. The engine stamps them at **completion**, not at start (`browser-action-engine.ts:338`, `:435`). Two tabs running concurrently (the engine serializes per tab only, `:241-258`) can finish in the same millisecond, so timestamps can tie across tabs.

### 0.2 Which actions are recorded today, and which are not

There are only two `recordAction` call sites in the repo, both in `executeActionSerialized`:
- `browser-action-engine.ts:333-339`: success. Written after `verifyAction`, but **without** the verification.
- `:429-436`: final failure, also without the verification.

The early returns at `:261-264` (duplicate-action guard) and `:268-271` (invalid `timeoutMs`, GAP-032) **are not recorded.**

**Recorded:** every runtime method that goes through `runAction` (`runtime.ts:1644-1664`). That is `click` (:486), `focus` (:504), `type` (:597, which also covers `fillForm`'s fields, :618), `pressKey` (:638), `scroll` (:663), `hover` (:678), `selectOption`/`selectOptions` (:688/:702), `waitForSelector` (:722), `clickByText` (:731), `clickByRole` (:741), `typeByLabel` (:751), `uploadFile` (:761), `clickWithButton` (:775), `dragAndDrop` (:789), `touchTap` (:802) and `downloadFile` (:819). The engine's own `navigate` case (`:564-568`, used by the agent path) is also recorded.

**Not recorded.** These runtime-level methods bypass the engine entirely:

| method | line | primitive |
|---|---|---|
| `navigate` | `runtime.ts:377-387` | `tab.navigate(url)` directly. `BrowserTab.navigate` (`browser-tab.ts:234-254`) has no `recordAction`. |
| `goBack` / `goForward` / `reload` | `:389-408` | `page.goBack()` / `goForward()` / `reload()` |
| `clickAtPoint` / `dragAtPoints` | `:514-542` / `:552-584` | `page.mouse.*`, returning `ActionResult` literals |
| `eval` | `:941-954` | `target.evaluate(code)` |
| `setClipboard` | `:1318-1337` | `page.evaluate(...)` |
| `uploadFileViaTrigger` | `:1346-1362` | `waitForFileChooser` + `page.click` |

Everything that uses `runtime.navigate` is therefore unrecorded: MCP `browser.navigate` (`tools.ts:254-271`), CLI `nav` (`cli.ts:241-264`), SDK `page.goto` (`page.ts:87`), and runtime `audit`/`compareUrls` (`runtime.ts:1432, 1486, 1490`).

**Recording must not go into `BrowserTab.navigate` itself.** The engine's `navigate` case calls it and then records through the engine, so that would record the action twice. `BrowserSession.createTab(url)` (`browser-session.ts:162-164`) also calls it for a new tab's initial load.

### 0.3 Surfaces

- **Runtime** `getActionHistory(sessionId, tabId?)` (`runtime.ts:1566-1572`) returns `tab.getActionHistory()` for **one** tab. `resolveTab` (`:1679-1698`) maps an omitted `tabId` to the **active** tab.
- **MCP** `browser.get_action_history` (`tools.ts:1543-1558`):
  - schema: `{ sessionId: z.string(), tabId: z.string().optional() }`
  - output: `jsonResult({ entries })`
  - description: "Recent actions run against this tab (bounded to the last 200 entries)…"

  An omitted `tabId` already means "the active tab", so it can't be reused to mean "all tabs" (§0.5).
- **Tool count:** `tools.spec.ts:22-…` `EXPECTED_BROWSER_TOOLS` lists `browser.get_action_history` (`:77`). The only history-specific tests are `browser-action-engine.spec.ts:1575-1606` (history length is 1, `toMatchObject` on `{actionType, success}`) and `runtime.spec.ts:411-414` (unknown session throws).
- **SDK:** `packages/sutradhar/src` has no history API (grep: no hits), and the Done-when doesn't require one (§7, gap G-A).
- **CLI:** no `history` verb. The dispatch is at `cli.ts:760-825` and the help text at `:826-963`.

### 0.4 Does history survive across CLI processes today? No. Traced precisely:

1. Each CLI invocation constructs a new `SutradharRuntime` (`cli.ts:93`) and calls `runtime.attach({endpoint, sessionId: state.sessionId})` (`:99`).
2. `attach` calls `sessionManager.createSession({sessionId, wsEndpoint})` (`runtime.ts:284-287`). The manager is new and empty in this process, so `doCreateSession` builds a **new `BrowserSession`** (`session-manager.ts:173-179`).
3. `attach` then adopts every open page via `adoptExistingPage` (`runtime.ts:303-309`). Each call constructs a **new `BrowserTab`** (`browser-session.ts:270-278`) with `actionHistory = []`.

So in-memory history starts empty in every CLI process. FR2-03's `CliState` changes (`profileDir`, `profileDirOwned`, `cwd`, `createdAt`) persist nothing about history, and FR2-04's warden is a raw-CDP process that holds no runtime. **The only cross-process record possible is a file.**

Tab ids are also not stable across CLI processes. They're minted as `tab_<sessionId>_<counter>` per `BrowserSession` object (`browser-session.ts:267-268`), and the counter follows `browser.pages()` adoption order. Closing a tab shifts the numbering in the next process. Because of this, CLI history lines also record the page URL (§2.1).

**MCP:** the in-memory history lives exactly as long as the server process. A restart loses it. The Done-when asks for persistence only on the CLI (gap G-B).

### 0.5 Closed tabs and the merged view

- `BrowserSession.closeTab` (`browser-session.ts:318-334`) runs `tabsMap.delete(tabId)`.
- `watchForClose` (`:210-222`, a page closed any other way, such as a popup calling `window.close()`) also deletes it.
- `handleCrash` (`:109-127`) and `close` (`:336-346`) clear the whole map.

Once a tab leaves `tabsMap`, **its `BrowserTab` object, and with it its history, can't be reached.** A merged view that only walked `getTabs()` would silently lose every closed tab's actions. OAuth popups are the typical case: they close themselves right after the interesting actions.

**Decision D1: the session keeps its own ring, fed by the tabs.** It's a session-level ring buffer (`BrowserSession.sessionActionHistory`), appended to through a listener every time any of its tabs records an action:
- Each entry is `{...entry, tabId, seq}`, where `seq` is a per-session counter that starts at 1 and only goes up.
- **Order is insertion order (`seq`), not timestamp.** Timestamps are completion-time with millisecond precision and can tie across tabs (§0.1). `seq` is exact and unambiguous. Because the engine serializes per tab, per-tab order is preserved.
- Entries of closed tabs **stay** until the ring evicts them. They're tagged with a `tabId` that no longer appears in `list_tabs`.
- **The capacity is the same 200 (`MAX_ACTION_HISTORY`).** No new number is introduced. The documented bound ("the last 200 entries") becomes true for both scopes, and a merged view reads naturally as "the last 200 things that happened in this session".
- It lives exactly as long as the session. It's gone after `shutdown`, a crash, or an MCP restart.

**Decision D2: the merged view is opt-in, and the default stays the active tab.** `browser.get_action_history` gets `scope: 'tab' | 'session'`, defaulting to `'tab'`.
- Why not "omitted `tabId` means all tabs", which FR2-04's new `getDialogHistory` used: that was a *new* method with no callers. `get_action_history` has shipped with omitted `tabId` meaning the active tab (`resolveTab`, `runtime.ts:1685-1689`). Flipping that silently would hand a multi-tab caller other tabs' entries that it would attribute to the active tab. That's exactly the silent-wrongness class this loop exists to close, and it breaks the additive rule every prior item followed.
- FR2-10 makes `sessionId` optional; that is orthogonal to this. `scope` is its own key, and FR2-10's registration-time rewrite only touches `sessionId`.

### 0.6 FR2-07 dependency (checked against the ledger and `evidence/FR2-07/spec.md`)

- **Status:** the ledger shows `FR2-07 | … | SPEC`. It is not developed or audited yet.
- **FR2-07's own shape** (its spec §2.1). The field on results is **`verification`**, of type **`VerificationResultDto`** = `{verified, urlChanged, elementFound, confidence, reason, evidence}`.
  - `evidence` = `{tier, checks[]}`, and each check is `{check, outcome, expected?, observed?, detail?}`.
  - Strings are capped at 200, `detail` at 300, and there are at most 8 checks.
- **At HEAD, `VerificationResultDto` already exists** (`action-types.ts`: `{verified, urlChanged, elementFound, confidence, reason}`), and the engine already computes it before both `recordAction` sites (`:325-330`, `:422-427`).

**Decision D3: history entries reuse the exact field name and type, `verification?: VerificationResultDto`.** No projection and no renamed field.
- **Before FR2-07:** engine entries carry today's 5-key verification. Runtime-level entries have none, because the runtime methods produce none.
- **After FR2-07:** the same code carries `evidence` automatically (it's the same type), and runtime-level navigate, back, forward, reload, click_at_point, drag_at_points, set_clipboard and upload_file_via_trigger results gain `verification`, which the history wrapper (§2.4) picks up from the result.
- **eval never has one.** FR2-07 D13a puts it outside the contract, so the field stays **absent**, not faked.
- The sanitizer (§2.2) reads `evidence` structurally (`'evidence' in v`), so it compiles and works against both the pre- and post-FR2-07 type.

This is a genuinely soft dependency. Nothing here waits for FR2-07.

### 0.7 Secrets that would reach the history (and the disk)

New or newly persisted strings:
- navigate URLs, often carrying `?token=`, `?code=` (OAuth) or `#access_token=`;
- eval code (`localStorage.setItem('jwt','…')`);
- CLI `type <ref> <text>` (passwords) and `setclipboard <text>`;
- error messages, which can quote page text;
- FR2-07 verification reasons and `observed` values, which contain full current URLs. For example, `Current URL http://x/?t=… does not contain…`, and navigate reasons contain `<after.url>`, per FR2-07 §2.2 rule 4 and §2.8.4.

Policy, in §2.2 and §7 R1:
- one central sanitizer applied at `recordAction` time;
- FR2-09 D5 URL redaction applied to every URL-bearing string, including inside verification text;
- FR2-07's 200/300 caps;
- eval stored only as a whitespace-collapsed preview;
- typed and clipboard text never stored, only its length.

---

## 1. Files to touch

| # | File | Change | Other items also touching it |
|---|---|---|---|
| 1 | `packages/browser/src/session/action-history.ts` (**new**, pure) | Caps; `redactHistoryUrl`, `redactUrlsInText`, `capHistoryString`, `evalCodePreview`, `sanitizeHistoryEntry`, `describeActionTarget`; `SessionActionHistoryEntry` type | — |
| 2 | `packages/browser/src/session/index.ts` | `export * from './action-history.js'` | — |
| 3 | `packages/browser/src/session/browser-tab.ts` | Entry fields; `export const MAX_ACTION_HISTORY`; eviction counter; listener; sanitize on record; optional `IBrowserTab.getActionHistoryEvictedCount?` | FR2-04 (dialog policy, same file, other regions) |
| 4 | `packages/browser/src/session/browser-session.ts` | Session ring, `seq`, eviction counter; `wireActionHistory(tab)` at the 3 construction sites (`:155`, `:233`, `:270`); optional `IBrowserSession` getters | FR2-04 (passes `dialogPolicy` at the same 3 sites; a trivial rebase) |
| 5 | `packages/browser/src/actions/browser-action-engine.ts` | One `private recordHistory(...)` that replaces the two literals at `:333-339` and `:429-436`, and is also called on the two early returns (`:261-271`) | FR2-01, 05, 06, 07, 08 |
| 6 | `packages/capability-runtime/src/types.ts` | `ActionHistoryScope`, `ActionHistoryReport`; re-export `SessionActionHistoryEntry` | FR2-02, 04, 06, 07, 10 |
| 7 | `packages/capability-runtime/src/runtime.ts` | `private withHistory(...)` applied to 9 methods; new `getActionHistoryReport`. `getActionHistory` is unchanged. | all prior |
| 8 | `packages/mcp-server/src/tools.ts` | `get_action_history`: the `scope` param, the report output, the description | FR2-01, 02, 05, 06, 07, 10 |
| 9 | `packages/cli/src/history-file.ts` (**new**, pure plus injectable fs) | Line builder, argument redaction, append with rotation, reader, human formatter | — |
| 10 | `packages/cli/src/state.ts` | Export `STATE_DIR_PATH` and `HISTORY_FILE_PATH` (additive constants next to `:76-77`) | FR2-03 (which exports `STATE_FILE_PATH`, same spot) |
| 11 | `packages/cli/src/cli.ts` | `withSession` wrapped by a recording `try/finally`; `cmdClose` appends a `close` line; new `cmdHistory`; dispatch; help | FR2-01, 03, 04, 05, 07, 08 |
| 12 | `packages/cli/src/index.ts` | `export type { CliHistoryLineV1 } from './history-file.js'` (for FR2-13) | FR2-03 |
| 13 | Tests (new): `packages/browser/tests/unit/action-history.spec.ts`, `packages/browser/tests/unit/session-action-history.spec.ts`, `packages/cli/tests/unit/history-file.spec.ts` | §4 | — |
| 14 | Tests (append only): `browser-action-engine.spec.ts`, `capability-runtime/tests/unit/runtime.spec.ts`, `mcp-server/tests/unit/tools.spec.ts` | §4 | all prior |
| 15 | `tools/scenario-suite/fixtures/fr2-11-history.html` (new), `tools/scenario-suite/verify-fr2-11-action-history.mjs` (new) | §3, §5 | — |
| 16 | Docs: `packages/mcp-server/README.md:100`, `packages/cli/README.md` (commands table, a "History" section, the `--json` row at `:105`), `AGENT_SETUP.md:71` and `packages/sutradhar/AGENT_SETUP.md:71` (identical) | Match behavior | FR2-07, 08, 17 |
| 17 | `.ai/loop/field-report-2/evidence/FR2-11/changelog-fragment.md` (new) | §7.3 | — |

**Not touched:**
- `BrowserTab.navigate` (§0.2: it would record twice).
- `packages/sutradhar/src` (G-A).
- `execution-verifier.ts` (FR2-07 owns it; this item only *reads* `verification`).
- `session-manager.ts`.
- `parse-args.ts`: `--json` is already a known flag, and a bare verb needs no parsing.
- `EXPECTED_BROWSER_TOOLS`: no new tool.

---

## 2. API diff

### 2.1 Entry types (`browser-tab.ts`, `action-history.ts`)

```ts
// browser-tab.ts
export const MAX_ACTION_HISTORY = 200;          // was module-private; value unchanged

export interface ActionHistoryEntry {
  readonly actionType: string;
  readonly selector?: string;
  readonly success: boolean;
  readonly error?: string;
  readonly executionTimeMs: number;
  readonly timestamp: string;                     // ISO-8601 UTC, ms precision, stamped at completion (unchanged)
  /** NEW (FR2-11). What the action was aimed at when that isn't a selector: the redacted URL for
   *  navigate, the eval code preview, "(x, y) left" for click_at_point, the key for press_key, etc.
   *  See describeActionTarget. Never a typed value or clipboard content. */
  readonly target?: string;
  /** NEW (FR2-11). The tab's URL right after the action, query and fragment dropped (FR2-09 D5). */
  readonly url?: string;
  /** NEW (FR2-11). The same VerificationResultDto the action's result carried (FR2-07's contract:
   *  once FR2-07 lands it includes `evidence`). Absent when the action produced none (eval, or
   *  runtime-level actions before FR2-07). URL-redacted and capped by sanitizeHistoryEntry. */
  readonly verification?: VerificationResultDto;  // `import type` from '../actions/action-types.js' (no runtime cycle)
}

// IBrowserTab — optional addition, because dom-semantic-engine.spec.ts:166 builds an untyped-cast literal
getActionHistoryEvictedCount?(): number;
```

```ts
// action-history.ts
export interface SessionActionHistoryEntry extends ActionHistoryEntry {
  readonly tabId: string;
  /** 1-based, strictly increasing per session. Merge order = recording order (not timestamp). */
  readonly seq: number;
}
```

### 2.2 Sanitization (`action-history.ts`, pure, all exported)

```ts
/** FR2-07 D1's scalar-string cap: selector, target, url, evidence expected/observed. */
export const HISTORY_STRING_CAP = 200;
/** FR2-07's detail cap: error, verification.reason, evidence detail. */
export const HISTORY_TEXT_CAP = 300;

/** End-truncate: s.length <= cap ? s : s.slice(0, cap - 1) + '…'. Replaces control chars (\r\n\t etc.) with ' ' first. */
export function capHistoryString(s: string, cap?: number): string;

/** FR2-09 D5's rules, WITHOUT the 80-char display truncation (storage uses capHistoryString):
 *  http/https/ws/wss → origin + pathname; file: → 'file://' + pathname; blob: → 'blob:' + inner origin;
 *  data: → 'data:…'; about:*, chrome-error://* → as is; '' → '(no url)'; unparsable → the raw string.
 *  Query and fragment are ALWAYS dropped. If FR2-09's frame-labels.ts has landed and exports an
 *  untruncated D5 helper, delegate to it rather than duplicating the scheme table. */
export function redactHistoryUrl(url: string): string;

/** Replace every URL-looking token inside free text with redactHistoryUrl(token):
 *  /\b(?:https?|wss?|file|blob):\/\/[^\s"'`<>()[\]{}]+/gi, and /\bdata:[^\s"'`<>]+/gi → 'data:…'. */
export function redactUrlsInText(text: string): string;

/** Collapse /\s+/ to ' ', trim, redactUrlsInText, then capHistoryString(…, 200). */
export function evalCodePreview(code: string): string;

/** Pure; returns a NEW object and never mutates `e` or `e.verification`:
 *  - selector       → capHistoryString(redactUrlsInText(s))
 *  - target         → actionType === 'navigate' ? capHistoryString(redactHistoryUrl(t)) : capHistoryString(redactUrlsInText(t))
 *  - url            → capHistoryString(redactHistoryUrl(u))
 *  - error          → capHistoryString(redactUrlsInText(err), 300)
 *  - verification   → { ...v, reason: cap(redact(v.reason), 300),
 *                       ...('evidence' in v && v.evidence ? { evidence: { ...v.evidence, checks: v.evidence.checks.map(c => ({
 *                            ...c, expected: scalar(c.expected), observed: scalar(c.observed),
 *                            ...(c.detail !== undefined ? { detail: cap(redact(c.detail), 300) } : {}) })) } } : {}) }
 *                     where scalar(x) = typeof x === 'string' ? cap(redact(x), 200) : x
 *  - undefined keys stay absent (no `key: undefined` in the JSON). */
export function sanitizeHistoryEntry(e: ActionHistoryEntry): ActionHistoryEntry;

/** The engine-side `target` (import type ActionParams). Never reads params.value.
 *  navigate → params.url; press_key → [...(modifiers ?? []), key].join('+'); click_by_text → text;
 *  click_by_role → name ? `${role} "${name}"` : role; type_by_label → label;
 *  scroll → [direction, amount].filter(Boolean).join(' '); wait → `${milliseconds}ms`;
 *  wait_for_selector → `state=${state ?? 'visible'}`; upload_file → path.basename(filePath);
 *  anything else → undefined. */
export function describeActionTarget(params: ActionParams): string | undefined;
```

### 2.3 Eviction and the session ring (`browser-tab.ts`, `browser-session.ts`)

```ts
// BrowserTab
private actionHistoryEvicted = 0;
private actionRecordedListener?: (stored: ActionHistoryEntry) => void;

public recordAction(entry: ActionHistoryEntry): void {
  const stored = sanitizeHistoryEntry(entry);
  this.actionHistory.push(stored);
  if (this.actionHistory.length > MAX_ACTION_HISTORY) {
    this.actionHistory.shift();
    this.actionHistoryEvicted++;                       // NEW: counted, never reset for this tab's lifetime
  }
  try { this.actionRecordedListener?.(stored); } catch { /* a listener must never break an action */ }
}
public getActionHistoryEvictedCount(): number { return this.actionHistoryEvicted; }
/** Concrete-class only (not on IBrowserTab): BrowserSession wires its ring here. Last setter wins. */
public setActionRecordedListener(fn: ((stored: ActionHistoryEntry) => void) | undefined): void;
```

```ts
// BrowserSession
private readonly sessionActionHistory: SessionActionHistoryEntry[] = [];
private sessionActionSeq = 0;
private sessionActionEvicted = 0;
private wireActionHistory(tab: BrowserTab): void {
  const tabId = tab.id;
  tab.setActionRecordedListener((stored) => {
    this.sessionActionHistory.push({ ...stored, tabId, seq: ++this.sessionActionSeq });
    if (this.sessionActionHistory.length > MAX_ACTION_HISTORY) { this.sessionActionHistory.shift(); this.sessionActionEvicted++; }
  });
}
// called right after `new BrowserTab(...)` at :155 (createTab), :233 (adoptPopupPage), :270 (adoptExistingPage)
public getSessionActionHistory(): readonly SessionActionHistoryEntry[] { return this.sessionActionHistory; }
public getSessionActionHistoryEvictedCount(): number { return this.sessionActionEvicted; }

// IBrowserSession — optional (literal mocks keep compiling)
getSessionActionHistory?(): readonly SessionActionHistoryEntry[];
getSessionActionHistoryEvictedCount?(): number;
```

The eviction counts answer explicit decision #1:
- **Per tab:** counted in `BrowserTab` at the `shift()` site. It lives as long as the tab object and is gone when the tab is closed. That's fine, because a closed tab's per-tab view can't be reached anyway (`resolveTab` throws).
- **Per session:** counted in the ring. It lives for the whole session, including after its tabs close, and is gone on session close or crash or an MCP restart.
- Neither is ever reset while its owner lives. Both are exact counts, not estimates.

### 2.4 Engine (`browser-action-engine.ts`)

```ts
private recordHistory(tab: IBrowserTab, params: ActionParams, r: {
  success: boolean; executionTimeMs: number; error?: string; verification?: VerificationResultDto }): void {
  tab.recordAction({
    actionType: params.actionType,
    selector: params.selector,
    success: r.success,
    ...(r.error !== undefined ? { error: r.error } : {}),
    executionTimeMs: r.executionTimeMs,
    timestamp: new Date().toISOString(),
    ...(describeActionTarget(params) !== undefined ? { target: describeActionTarget(params) } : {}),
    url: tab.url,
    ...(r.verification ? { verification: r.verification } : {}),
  });
}
```

- `:333-339` becomes `this.recordHistory(tab, params, { success: true, executionTimeMs, verification })`. The existing order is kept: record after `verifyAction`, before the event publish.
- `:429-436` becomes `this.recordHistory(tab, params, { success: false, executionTimeMs, error: failResult.error, verification })`.
- **Newly recorded:** the duplicate guard (`:261-264`) and invalid `timeoutMs` (`:268-271`) early returns. Each becomes `this.recordHistory(tab, params, { success: false, executionTimeMs: 0, error: <returned>.error, verification: <returned>.verification })`, then `return`. After FR2-07 these results carry `verification`; before it, they don't. The attempts were real and were rejected, so a "full" history should show them. §4 E4 pins this.
- **The test mocks keep working.** `mockTab` (`browser-action-engine.spec.ts:21-39`) pushes whatever it receives, and the existing assertions (`:1588-1589`, `:1604-1605`) use `toMatchObject` on `{actionType, success}`, which extra keys don't affect.

### 2.5 Runtime (`types.ts`, `runtime.ts`)

```ts
// types.ts
export type ActionHistoryScope = 'tab' | 'session';
export interface ActionHistoryReport {
  scope: ActionHistoryScope;
  /** tab scope: the tab actually read (the active one when tabId was omitted). Absent for session scope. */
  tabId?: string;
  /** tab scope: ActionHistoryEntry[] oldest-first. session scope: SessionActionHistoryEntry[] ordered by seq. A COPY. */
  entries: readonly ActionHistoryEntry[] | readonly SessionActionHistoryEntry[];
  /** How many older entries this view has dropped since it began (tab lifetime / session lifetime). 0 until the cap is hit. */
  evicted: number;
  /** MAX_ACTION_HISTORY (200). */
  capacity: number;
}
export { type SessionActionHistoryEntry };   // alongside the existing `export { type ActionHistoryEntry }` (:135)
```

```ts
// runtime.ts — NEW; getActionHistory (:1569-1572) stays byte-identical
public getActionHistoryReport(
  sessionId: string,
  options: { scope?: ActionHistoryScope; tabId?: string } = {},
): ActionHistoryReport {
  const scope = options.scope ?? 'tab';
  if (scope !== 'tab' && scope !== 'session') throw new TypeError(`scope must be "tab" or "session" (got ${JSON.stringify(options.scope)})`);
  if (scope === 'session') {
    if (options.tabId !== undefined) {
      throw new TypeError('tabId cannot be combined with scope "session" — the session view already merges every tab (each entry carries its tabId). Omit tabId, or use scope "tab".');
    }
    const session = this.requireSession(sessionId);                         // unknown → BrowserNotAvailableError (unchanged class)
    return { scope, entries: [...(session.getSessionActionHistory?.() ?? [])],
             evicted: session.getSessionActionHistoryEvictedCount?.() ?? 0, capacity: MAX_ACTION_HISTORY };
  }
  const { tab } = this.resolveTab(sessionId, options.tabId);
  return { scope, tabId: tab.id, entries: [...tab.getActionHistory()],
           evicted: tab.getActionHistoryEvictedCount?.() ?? 0, capacity: MAX_ACTION_HISTORY };
}
```

This is a TypeError rather than silently ignoring `tabId`, following FR2-08 decision 6: a flag that would be silently ignored is rejected.

**Wiring navigate and eval (explicit decision #3).** One private wrapper records around the body, **after** the method's existing `resolveTab` (the statement order FR2-07 pins is unchanged):

```ts
private async withHistory<T>(
  tab: IBrowserTab,
  meta: { actionType: string; selector?: string; target?: string },
  run: () => Promise<T>,
  /** true when T is ActionResult/NavigateResult-shaped (success/error/verification are read from it).
   *  false for eval: its T is the page's own value and may legitimately contain a `success` key. */
  resultIsActionResult: boolean,
): Promise<T> {
  const start = Date.now();
  try {
    const r = await run();
    const ar = resultIsActionResult ? (r as { success?: boolean; error?: string; verification?: VerificationResultDto } | undefined) : undefined;
    tab.recordAction({ ...meta, success: ar?.success ?? true, ...(ar?.error ? { error: ar.error } : {}),
      executionTimeMs: Date.now() - start, timestamp: new Date().toISOString(), url: tab.url,
      ...(ar?.verification ? { verification: ar.verification } : {}) });
    return r;
  } catch (err) {
    tab.recordAction({ ...meta, success: false, error: err instanceof Error ? err.message : String(err),
      executionTimeMs: Date.now() - start, timestamp: new Date().toISOString(), url: tab.url });
    throw err;                                                                // the same error object: behavior unchanged
  }
}
```

| method | `meta` | `resultIsActionResult` |
|---|---|---|
| `navigate` | `{actionType:'navigate', target: url}`. `assertNavigationAllowed` and the rate limiter still run **before** `resolveTab`, unrecorded (N4). | true (after FR2-07, `NavigateResult` has `verification`; before it, there's none) |
| `goBack` / `goForward` / `reload` | `{actionType:'go_back'|'go_forward'|'reload'}` | true |
| `clickAtPoint` | `{actionType:'click_at_point', target:\`(${x}, ${y}) ${button}\`}` | true (its `success:false` literal is recorded as a failure) |
| `dragAtPoints` | `{actionType:'drag_at_points', target:\`(${fromX}, ${fromY}) -> (${toX}, ${toY})\`}` | true |
| `setClipboard` | `{actionType:'set_clipboard', target:\`<${text.length} chars>\`}`. **The content is never stored** (FR2-07 D11). | true (`void` today, which records success:true; `ActionResult` after FR2-07) |
| `uploadFileViaTrigger` | `{actionType:'upload_file_via_trigger', selector: normalizeTarget(triggerTarget), target: path.basename(filePath)}` | true |
| `eval` | `{actionType:'eval', selector: frameSelector (only when given), target: code}`. `sanitizeHistoryEntry` turns this into the preview; `evalCodePreview` is applied in the sanitizer via the non-navigate `target` rule, plus whitespace collapse for `actionType === 'eval'`. The **result is never recorded**. | **false** |

- The body inside `run` is the method's existing code after `resolveTab`, unchanged. `requirePage` failures happen inside `run`, so a pageless tab's eval is recorded as a failure, the same as the engine records its "no live page" failures.
- **Why these 7 beyond navigate and eval:** they're the other engine-bypassing, state-changing action tools, the same set FR2-07 gives verification to. Leaving them out would keep "full action history" untrue for exactly the tools whose history an auditor most needs, and each one is a single wrapper call.
- **Not recorded, by design:** reads (`snapshot`, `screenshot`, `extract_data`, `get_*`), tab lifecycle (`createTab`, `closeTab`, `focusTab`), and state setters (`set_cookie`, `set_*_storage_item`, `grant_permissions`, `set_viewport`, `emulate*`, `route`). See G-C.
- `audit` and `compareUrls` call `this.navigate` (`:1432`, `:1486`, `:1490`), so their navigations now appear in history. That's correct and is noted in the changelog.

### 2.6 MCP (`tools.ts:1543-1558`)

```ts
server.registerTool(
  'browser.get_action_history',
  {
    description:
      'Recent actions (bounded to the last 200 entries) — action type, selector/target, success/error, ' +
      'duration, timestamp, the page URL afterward (query/fragment dropped), and the action\'s verification ' +
      'when it produced one. Includes navigate and eval (eval is recorded as a ≤200-char code preview; its ' +
      'result is never stored), go_back/go_forward/reload, click_at_point/drag_at_points, set_clipboard ' +
      '(length only) and upload_file_via_trigger, as well as every element action. scope "tab" (default): ' +
      'one tab — tabId, or the active tab. scope "session": every tab in this session merged in the order ' +
      'the actions were recorded (each entry has tabId and seq), including tabs that have since closed. ' +
      '`evicted` counts older entries dropped once the 200-entry cap was hit (0 = nothing lost).',
    inputSchema: {
      sessionId: z.string(),
      tabId: z.string().optional().describe('scope "tab" only: the tab to read; defaults to the active tab.'),
      scope: z.enum(['tab', 'session']).optional()
        .describe('"tab" (default): one tab\'s history. "session": all tabs merged by recording order. Cannot be combined with tabId.'),
    },
  },
  async ({ sessionId, tabId, scope }) => {
    try {
      const report = runtime.getActionHistoryReport(sessionId, { scope, tabId });
      return jsonResult({
        ...report,
        ...(report.evicted > 0
          ? { note: `${report.evicted} older entr${report.evicted === 1 ? 'y was' : 'ies were'} evicted — only the most recent ${report.capacity} are kept.` }
          : {}),
      });
    } catch (e) {
      return errorResult(`get_action_history failed: ${(e as Error).message}`);
    }
  },
);
```

**Output:** `{scope, tabId?, entries, evicted, capacity, note?}`. It's a superset of today's `{entries}`, and the `entries` key and its per-entry base keys are unchanged. `evicted` is **always present**, so a machine consumer never has to check whether the key exists. `note` is present only when `evicted > 0`, for LLM readers.

### 2.7 CLI: `history.jsonl` (`history-file.ts`, `state.ts`, `cli.ts`)

**Location (explicit decision #4).** `state.ts` gains:

```ts
export const STATE_DIR_PATH = STATE_DIR;                                    // existing resolved dir (:76)
export const HISTORY_FILE_PATH = path.join(STATE_DIR, 'history.jsonl');     // next to state.json
```

It uses the same directory as `state.json`, whether that's the cwd-hash dir or `SUTRADHAR_CLI_STATE_DIR`. If FR2-03 adds `SUTRADHAR_CLI_STATE_ROOT`, it flows through `STATE_DIR` automatically.

**Coexistence with FR2-03 and FR2-04:**
- It's a third sidecar, next to `state.json` and `warden.json`.
- It's **append-only**, and never read-modified-written, so it can't lose updates against `writeState` or FR2-04's warden writes.
- FR2-03's `clearStateFileIfUnchanged` removes only `state.json` and removes the dir only if it's empty. `history.jsonl` therefore survives `close`, self-heal and `doctor --gc`, and keeps the dir, exactly as FR2-03 §2.5, its §4 test ("a sibling `history.jsonl` survives, and so does the dir") and its §7 item 10 anticipated.
- FR2-03's `sessions` scans only `*/state.json`, so it's unaffected.
- No new locking discipline is invented. FR2-03 and FR2-04 use none either.

**Which commands append a line.** Every command that runs through `withSession` (the verbs that touch the browser session) appends **one line per command**, whether or not it's read-only: `snap`, `text`, `tabs`, `eval` and `screenshot` included. That's the literal Done-when ("the CLI appends every command"), and a read like `snap` is part of the story of what an agent saw.

This is deliberately different from the in-memory history's scope. In memory, an *action* is a recorded runtime action (§2.5), which is broader than FR2-07's "state-changing tool" set only by `eval`. A CLI *line* is a command. Its `actions[]` array holds the in-memory entries that command produced: `snap` has `[]`, and `press` has `[focus, press_key]`.

`close` also appends a line, marking the session's end. `doctor`, `profile`, `sessions`, `doctor --gc`/`close --all-stale`, `history` itself, help, and usage errors append nothing: no session was touched, and `history` must not pollute its own output.

**Line schema (v1, self-describing):**

```ts
export const HISTORY_SCHEMA_VERSION = 1;
export interface CliHistoryLineV1 {
  v: 1;
  type: 'command';                  // discriminator: FR2-13's runner may add other types later
  ts: string;                       // ISO-8601 UTC, command START time
  sessionId: string | null;         // the session the command ran against (post-self-heal id)
  cwd: string;                      // path.resolve(process.cwd())
  verb: string;
  args: string[];                   // positional args after redactCliArgs (flags are not recorded in v1)
  exitCode: number;                 // process.exitCode after the command body (0/1/3/4…), or 1 if it threw
  durationMs: number;
  error?: string;                   // thrown error message, capped 300 + URL-redacted
  actions: SessionActionHistoryEntry[];  // the session ring's entries recorded in THIS process (sanitized already)
  actionsEvicted: number;           // session ring eviction count (non-zero only if one command did >200 actions)
  actionsUnavailable?: string;      // why actions couldn't be read (e.g. the session crashed mid-command)
  truncated?: true;                 // set when the line hit HISTORY_MAX_LINE_BYTES and actions were dropped
  actionsOmitted?: number;          // with truncated: how many actions were dropped
}
```

Since each CLI process starts with an empty in-memory history (§0.4), the session ring in that process holds exactly this command's actions. That's true for the normal, fresh-spawn and self-heal paths alike.

```ts
/** Positional-arg redaction by verb, then redactUrlsInText + capHistoryString(…, 200) on every arg:
 *  type         → [args[0], `<${args.slice(1).join(' ').length} chars>`]    (typed text: passwords)
 *  setclipboard → [`<${args.join(' ').length} chars>`]
 *  eval         → [evalCodePreview(args.join(' '))]
 *  dialog       → [args[0], ...(args.length > 1 ? [`<${args.slice(1).join(' ').length} chars>`] : [])]   (FR2-04 prompt text)
 *  everything else → each arg redacted + capped */
export function redactCliArgs(verb: string, args: readonly string[]): string[];
export function buildHistoryLine(input: {...}): CliHistoryLineV1;           // pure; builds + applies the 64 KiB guard
export const HISTORY_MAX_LINE_BYTES = 64 * 1024;   // guard only: a CLI line is ~0.5–8 KB in practice
export const HISTORY_ROTATE_BYTES = 5 * 1024 * 1024;
export const HISTORY_ROTATED_FILE_NAME = 'history.1.jsonl';

/** mkdir -p dir; if stat(file).size >= rotateBytes → rename(file, dir/history.1.jsonl) (replacing it;
 *  ENOENT/EPERM/EBUSY → skip rotation this time); then ONE fs.appendFile(file, JSON.stringify(line) + '\n',
 *  { encoding: 'utf-8', mode: 0o600 }). Never throws: returns { ok: false, code } on failure. */
export async function appendHistoryLine(file: string, line: CliHistoryLineV1,
  deps?: { fs?: …; rotateBytes?: number }): Promise<{ ok: true; rotated: boolean } | { ok: false; code: string }>;

/** Splits on /\r?\n/, skips blank lines; a line is valid iff it JSON.parses to an object whose v is a
 *  positive integer. Returns { lines: {raw, parsed}[], skipped: number, rotatedExists: boolean }. ENOENT → lines []. */
export async function readHistoryFile(file: string, deps?: …): Promise<ReadHistoryResult>;
export function formatHistoryHuman(r: ReadHistoryResult, opts: { file: string; currentSessionId?: string }): string;
```

**Size bound, rotation and truncation (explicit decisions #4 and #7):**
- *Per field:* the §2.2 caps reuse FR2-07's 200/300 numbers, so no new per-field numbers are invented.
- *Per line:* `HISTORY_MAX_LINE_BYTES` = 64 KiB is a guard only.
  - It's not reachable by any real command: ≤ 8 checks × ~500 B per action, and 1-3 actions per command.
  - If it's exceeded, the line keeps the header keys and `actions: []`, and gains `truncated: true` and `actionsOmitted: n`.
  - Staying under 64 KiB also keeps each line a single `WriteFile`/`write` call, which O_APPEND (POSIX) and FILE_APPEND_DATA (Windows) make atomic relative to other appenders, so concurrent commands can't interleave bytes. L7 proves this empirically.
- *Per file:* size-based rotation at 5 MiB into one generation (`history.1.jsonl`), so the cap is about 10 MiB per directory. This is a new number, justified: a line is roughly 1-2 KB, so 5 MiB is about 3,000-5,000 commands, which is hours of continuous agent use per generation.
  - **Not rotated on `close` or on a new session:** the history is exactly what a user wants to inspect after `close` (and FR2-13 wants it as run output), and `sessionId` on every line already separates sessions.
  - The only accepted race: two processes rotating at the same instant can make the second rename push the first's fresh file over the old generation, so one old generation is lost. It never corrupts or interleaves a line, and it's documented (R5). This matches the lost-update tolerance FR2-03 already accepted for `writeState`.
- *Mode 0o600* applies on creation only. It's a no-op on Windows and harmless, and it's the one hardening this item adds (R1).

**`cli.ts` wiring.** The existing `withSession` body (`:92-147`) is renamed `withSessionUnrecorded`, unchanged. A new wrapper takes its name:

```ts
async function withSession<T>(fn: (runtime: SutradharRuntime, sessionId: string) => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  let thrown: unknown;
  try {
    return await withSessionUnrecorded(fn);
  } catch (err) {
    thrown = err;
    throw err;
  } finally {
    await recordCliCommand(startedAt, thrown);   // never throws; one stderr warning on failure
  }
}

async function recordCliCommand(startedAt: number, thrown: unknown): Promise<void> {
  if (!activeSessionId) return;                  // no session was ever attached/spawned: nothing to attribute
  let actions: SessionActionHistoryEntry[] = [], actionsEvicted = 0, actionsUnavailable: string | undefined;
  try {
    const r = activeRuntime!.getActionHistoryReport(activeSessionId, { scope: 'session' });
    actions = r.entries as SessionActionHistoryEntry[]; actionsEvicted = r.evicted;
  } catch (e) { actionsUnavailable = (e as Error).message; }
  const line = buildHistoryLine({ ts: new Date(startedAt).toISOString(), sessionId: activeSessionId, cwd: path.resolve(process.cwd()),
    verb: verb!, args: cleanArgs, exitCode: thrown ? 1 : Number(process.exitCode ?? 0), durationMs: Date.now() - startedAt,
    error: thrown ? (thrown as Error).message : undefined, actions, actionsEvicted, actionsUnavailable });
  const res = await appendHistoryLine(HISTORY_FILE_PATH, line);
  if (!res.ok) console.error(`Warning: could not append to ${HISTORY_FILE_PATH} (${res.code}); the command itself is unaffected.`);
}
```

The append is awaited inside `main()`, so it finishes before the force-exit timer in `.finally` (`:991`) is armed.

**Paths that skip the append,** documented in §6:
- `printErrorAndExit` (`:50-53`, a raw `process.exit(1)`), reached only on spawn/attach failure (`:65, 72, 76`), before any session exists;
- FR2-04's watchdog, if it hard-exits.

**`cmdClose`** (`:699-739`, or FR2-03's rewrite of it): after the kill/detach and the state clear, and only when a `state` existed, it appends `buildHistoryLine({verb:'close', args:[], sessionId: state.sessionId, exitCode: 0, actions: [], actionsEvicted: 0, …})`. "No active session." appends nothing.

**`sutradhar history [--json]` (explicit decision #5).** A new `case 'history': return cmdHistory(jsonMode);`. It **never** calls `withSession` or `readState`-then-attach, so it never spawns Chrome and never creates `state.json`. It only reads `state.json` to mark the current session.

- **Human mode** (exact format; `ts19 = ts.slice(0,19).replace('T',' ') + 'Z'`):

  ```
  History: 4 command(s) in C:\Users\x\.sutradhar-cli\1a2b3c4d5e6f7a8b\history.jsonl
  --- session sess_1758800000000_1 (current) ---
  2026-09-25 14:02:11Z  exit 0    1204ms  nav http://127.0.0.1:53211/fr2-11-history.html
      - navigate ok verified tab_sess_1758800000000_1_1 http://127.0.0.1:53211/fr2-11-history.html
  2026-09-25 14:02:14Z  exit 0     310ms  eval document.title
      - eval ok no-verification tab_sess_1758800000000_1_1 document.title
  2026-09-25 14:02:15Z  exit 0     120ms  snap
  2026-09-25 14:02:17Z  exit 1   15840ms  click #missing
      - click FAILED action-failed tab_sess_1758800000000_1_1 #missing: No element found for selector: #missing
  ```

  - The header counts the valid lines of the current file.
  - A `--- session <id>[ (current)] ---` row is printed whenever `sessionId` changes from the previous line. `(current)` means it equals `state.json`'s `sessionId`.
  - Command row: `exit` is right-padded to 3 characters and the duration right-aligned to 6 characters plus `ms`. The command text is `[verb, ...args].join(' ')`; URL tokens in it use FR2-09's display rule (D5, middle-truncated at 80), and the whole text is capped at 200.
  - `    error: <first line, ≤300>` when `error` is present.
  - One `    - ` row per action: `<actionType> <ok|FAILED> <verif> <tabId> <what>[: <error first line ≤200>]`.
    - `verif` is `verification.evidence.tier` when present (FR2-07). Otherwise it's `verified`/`not-verified` from `verification.verified`, or `no-verification` when absent.
    - `what` is `target ?? selector ?? ''`, middle-truncated at 80 (FR2-09 display width).
  - `    (<n> earlier action(s) of this command were evicted from the 200-entry in-memory history)` when `actionsEvicted > 0`.
  - A line with `v > 1` prints `<ts19>  (history line version <v> — upgrade sutradhar to display it)`.
  - Footer `Older commands were rotated to <dir>\history.1.jsonl (not shown).` when that file exists.
  - A missing file prints `No CLI history yet for this directory (<file> does not exist).`
- **`--json`:** prints the **verbatim raw text** of each valid line, one per line (JSONL, byte-identical to the file, including `v > 1` lines). It prints nothing else on stdout: no header, and an empty file prints nothing. Raw JSONL was chosen over a wrapped array because it's streamable, pipeable to `tail`/`jq`, and identical to the on-disk format FR2-13 will emit.
- **Both modes:**
  - The rotated file is not read.
  - Unreadable lines, such as a torn final line from a crash mid-write, are skipped, and stderr gets `Note: skipped <k> unreadable line(s) in <file>.`
  - Exit 0 when the file is missing or readable; exit 1 on any other read error (EACCES, EISDIR).
- **Filtering: none in this item.** No `--last N` and no `--session`. The smallest diff wins: rotation bounds the output, and `sutradhar history | tail -n 40` (or `Select-Object -Last 40`) covers "last N". This is logged as gap G-D.
- **Help:** add `history [--json]` to Commands:

  ```
    history [--json]             Every command run against this directory's sessions (read from
                                  history.jsonl next to the session state; persists after "close").
                                  --json prints the raw JSONL lines. Typed text and clipboard text
                                  are recorded as lengths only; URLs drop their query/fragment.
  ```

  Also extend the `--json` flag row: `… "history": raw JSONL`. Update the last paragraph's path mention to include `history.jsonl`.

---

## 3. Fixture design

**`tools/scenario-suite/fixtures/fr2-11-history.html`** (new, minimal; existing fixtures don't give a known-count click target):
- `<title>FR2-11 history</title>`
- `<button id="bump">Bump</button><output id="count">0</output>`: a click increments `#count`.
- `<input id="name" aria-label="Name">`
- `<a id="pop" href="fr2-11-history.html?popup=1" target="_blank">popup</a>`

It is served over **HTTP** by an inline `http.createServer` in the verify script (bound to `127.0.0.1:0`, like FR2-07's server). The HTTP query-drop is the main real-world redaction case. `file://` fixtures are used only in the N-cases that check the `file:` rule.

Per-case uniqueness always goes in the query string (`?n=<nonce>&token=SECRET-<nonce>`), never the fragment, per the decisions.md gotcha. The `token` value doubles as the canary for secret leakage.

---

## 4. Unit tests (numbered; no existing test may be loosened, skipped, or have its matcher widened)

### 4.1 `packages/browser/tests/unit/action-history.spec.ts` (new, pure)

- **H1** `redactHistoryUrl('https://a.test/p/x?token=S#frag')` is `'https://a.test/p/x'`.
- **H2** `'file:///E:/r/f.html?t=1'` gives `'file:///E:/r/f.html'`; `'data:text/html,<b>x'` gives `'data:…'`; `'about:blank'` stays `'about:blank'`; `''` gives `'(no url)'`; `'not a url'` stays `'not a url'`; `'wss://h:1/devtools/browser/abc?x=1'` gives `'wss://h:1/devtools/browser/abc'`.
- **H3** `redactUrlsInText('Current URL http://x.test/a?t=S does not contain y; also https://b.test/?k=S2')` contains neither `S` nor `S2`, and contains `http://x.test/a` and `https://b.test/`.
- **H4** `capHistoryString('a'.repeat(250))` has length 200 and ends with `'…'`. `capHistoryString('a\nb')` is `'a b'`. A 199-character string is returned unchanged.
- **H5** `evalCodePreview('  const x =\n  1;\n\n fetch("https://t.test/?k=S") ')` is `'const x = 1; fetch("https://t.test/") '` trimmed (no `S`, no newlines). A 10,000-character code gives length 200 ending in `'…'`.
- **H6** `sanitizeHistoryEntry`:
  - navigate `target` gets the URL rule;
  - `error` of 500 characters is capped at 300;
  - `selector` of 300 characters is capped at 200;
  - a pre-FR2-07 `verification` (no `evidence`) keeps exactly its 5 keys, with `reason` URL-redacted;
  - a post-FR2-07-shaped `verification` with `evidence.checks[0].observed = 'http://x/?t=S'` and `detail` of 400 characters gives `observed` without `S` and `detail` of length 300;
  - numeric and boolean `expected`/`observed` pass through unchanged;
  - **the input object and its nested `verification` are deep-equal to a pre-call `structuredClone`** (no mutation);
  - keys that were `undefined` are absent (`!('error' in out)`).
- **H7** `describeActionTarget`:
  - `{actionType:'press_key', key:'ArrowRight', modifiers:['Control','Shift']}` gives `'Control+Shift+ArrowRight'`;
  - `{actionType:'type', selector:'#pw', value:'hunter2'}` gives `undefined` (**never the value**);
  - `click_by_role` with `role:'button', name:'Save'` gives `'button "Save"'`;
  - `upload_file` with `filePath:'C:\\a\\b\\c.pdf'` gives `'c.pdf'`;
  - `navigate` gives `params.url` (raw; the sanitizer redacts it).

### 4.2 `packages/browser/tests/unit/session-action-history.spec.ts` (new; `BrowserSession` with no `browserInstance`, so tabs have no page)

- **S1** `MAX_ACTION_HISTORY === 200` is exported.
- **S2** `BrowserTab` records 201 entries (`actionType:'a<i>'`): `getActionHistory().length === 200`, `[0].actionType === 'a1'`, `getActionHistoryEvictedCount() === 1`. After 450: `200`, `'a250'`, evicted `250`.
- **S3** `BrowserTab` with 0 records: evicted is `0`, and `getActionHistory()` is `[]`.
- **S4** The listener gets the **sanitized** stored object: record with `url:'http://x/?t=S'`, and the listener argument's `url` is `'http://x/'`, `===` the object at `getActionHistory()[0]`.
- **S5** A listener that throws doesn't break `recordAction` (the entry is still stored, and nothing throws).
- **S6** Session merge: `A = await session.createTab()`, `B = await session.createTab()`. Record `A:a1, B:b1, A:a2, B:b2`.
  - `getSessionActionHistory().map(e => [e.tabId, e.actionType, e.seq])` equals `[[A.id,'a1',1],[B.id,'b1',2],[A.id,'a2',3],[B.id,'b2',4]]`.
  - The per-tab views are unaffected: `A.getActionHistory().map(e => e.actionType)` is `['a1','a2']` and has no `tabId`/`seq` keys.
- **S7** Same-millisecond ordering: with `vi.useFakeTimers()` and the clock frozen, record on B then A. The session order is `[B, A]` by `seq` even though the timestamps are equal.
- **S8** A closed tab's entries survive: after `await session.closeTab(A.id)`, the session history still contains `a1` and `a2` with `tabId === A.id`, and `session.getTab(A.id)` is `undefined`.
- **S9** Session eviction: 120 records on A and 85 on B, interleaved. The session ring length is 200, `getSessionActionHistoryEvictedCount() === 5`, and `[0].seq === 6`. Each per-tab eviction count is `0`, because both tabs are under 200.
- **S10** Popup and adopted-page tabs are wired too: `adoptExistingPage(mockPage)` then record gives an entry in the session ring. `mockPage` is `{on, url, title, isClosed}` as in `browser-tab-observability.spec.ts:13-26`, plus `title: async () => 't'`.

### 4.3 `browser-action-engine.spec.ts` (append `describe('FR2-11 history entries')`, reusing `mockTab`)

- **E1** A successful `press_key` Enter gives `tab.getActionHistory()[0]` matching `{actionType:'press_key', success:true, target:'Enter', url:'https://example.com'}`, with `verification` an object whose `verified` is a boolean.
- **E2** A failed click `#does-not-exist` gives `[0]` matching `{actionType:'click', selector:'#does-not-exist', success:false}`, with `typeof error === 'string'` and a `verification` object.
- **E3** `type` with value `'hunter2'` gives `JSON.stringify(tab.getActionHistory())` **not containing `'hunter2'`**.
- **E4** Two identical `click` calls on the same selector within the duplicate window (the second is rejected by `checkDuplicateAction`) give history length 2, with `[1].success === false` and `[1].error` equal to the returned error.
- **E5** `timeoutMs: NaN` (the GAP-032 early return) gives one entry with `success:false`.
- **E6** The existing tests at `:1575-1606` are unchanged and still pass (run and cited in evidence).

### 4.4 `capability-runtime/tests/unit/runtime.spec.ts` (append)

Setup: `const s = new BrowserSession(createSessionId('s1'))`, then `vi.spyOn(runtime.getSessionManager(), 'getSession').mockReturnValue(s)`, then `await s.createTab()` (pageless).

- **R1** `await runtime.navigate('s1','https://a.test/p?token=S')` resolves. Then `getActionHistory('s1')` has length 1 and `[0]` matches `{actionType:'navigate', success:true, target:'https://a.test/p'}`, and `JSON.stringify` of it doesn't contain `'S'`.
- **R2** `await expect(runtime.eval('s1','1+1')).rejects.toThrow(BrowserNotAvailableError)`. Then `[0]` matches `{actionType:'eval', success:false, target:'1+1'}`. The error is the same class as before this change.
- **R3** eval success: a tab from `s.adoptExistingPage(mockPage({evaluate: async () => ({success:false, v:1})}))`. `runtime.eval` returns `{success:false, v:1}` exactly, and the history entry has `success:true` (the page value's own `success` key is ignored) and has **no** `verification` key.
- **R4** `getActionHistoryReport('s1')` gives `{scope:'tab', tabId:<active>, evicted:0, capacity:200}`, with `entries` deep-equal to `getActionHistory('s1')` but **not the same reference**.
- **R5** `getActionHistoryReport('s1',{scope:'session'})` over two tabs gives entries ordered by `seq`, each with `tabId`, and no `tabId` at the report level.
- **R6** `getActionHistoryReport('s1',{scope:'session', tabId:'x'})` throws `TypeError` matching `/cannot be combined/`. `{scope:'bogus' as any}` throws `TypeError` matching `/scope must be/`.
- **R7** `getActionHistoryReport('nope')` and `getActionHistoryReport('nope',{scope:'session'})` both throw `BrowserNotAvailableError` (the unknown-session class is unchanged).
- **R8** `navigate` with `allowedDomains:['example.com']` to `https://evil.test` rejects exactly as before, and **no** entry is recorded (N4).
- **R9** `setClipboard` on an adopted mock-page tab with text `'secret'` gives an entry with `target === '<6 chars>'`, and `JSON.stringify` doesn't contain `'secret'`.
- **R10** `clickAtPoint` with `page.mouse.click` rejecting gives an entry with `success:false` and `target:'(10, 20) left'`, and the returned result is still the unchanged `success:false` literal.
- **R11** The existing `:411-414` test is unchanged.

### 4.5 `mcp-server/tests/unit/tools.spec.ts` (append)

- **M1** `browser.get_action_history`'s `config.inputSchema` has keys `sessionId`, `tabId`, `scope`. `scope.safeParse('session').success` is true and `safeParse('all').success` is false.
- **M2** Spy `getActionHistoryReport` resolving `{scope:'tab', tabId:'t1', entries:[], evicted:0, capacity:200}`. The handler is called with `('s1', {scope: undefined, tabId: undefined})`, and the parsed output equals the report with **no `note` key**.
- **M3** With `evicted: 7`: output `note === '7 older entries were evicted — only the most recent 200 are kept.'`. With `evicted: 1`: `'1 older entry was evicted — …'`.
- **M4** The spy throws a `TypeError('tabId cannot be combined …')`: `isError` is true and the text contains `get_action_history failed: tabId cannot be combined`.
- **M5** The description contains `scope "session"`, `evicted` and `eval`.
- **M6** The existing tool-count test is unchanged (still `EXPECTED_BROWSER_TOOLS.length`).

### 4.6 `packages/cli/tests/unit/history-file.spec.ts` (new; real temp dir under `os.tmpdir()`, removed in `afterEach`)

- **C1** `redactCliArgs('type', ['#pw','hunter','2'])` is `['#pw','<8 chars>']`; `('setclipboard',['a b'])` is `['<3 chars>']`; `('eval',['fetch("https://t/?k=S")'])` has no `S`; `('nav',['https://a/p?token=S'])` is `['https://a/p']`; `('dialog',['accept'])` is `['accept']`; `('dialog',['accept','Ada'])` is `['accept','<3 chars>']`.
- **C2** `buildHistoryLine(...)` has exactly the keys `v, type, ts, sessionId, cwd, verb, args, exitCode, durationMs, actions, actionsEvicted` (with no `error`/`truncated` when they weren't given), `v === 1` and `type === 'command'`.
- **C3** The 64 KiB guard: 50 actions, each with a 2,000-character `target` (bypassing the sanitizer on purpose). The result has `truncated: true`, `actionsOmitted: 50`, `actions: []`, and `Buffer.byteLength(JSON.stringify(line)) < 64*1024`.
- **C4** `appendHistoryLine` into a non-existent nested dir creates it. Two appends give a file of exactly 2 `\n`-terminated lines, each `JSON.parse`-able and deep-equal to its input.
- **C5** Rotation with `rotateBytes: 100`: after the first append (about 300 B), the second append renames to `history.1.jsonl` (byte-equal to the first file) and `history.jsonl` has exactly 1 line. The result is `rotated: true`.
- **C6** When the target path is a **directory**, `appendHistoryLine` resolves `{ok:false, code:'EISDIR'}` (or the platform's `EPERM`) and never throws.
- **C7** `readHistoryFile` over valid line + blank + `'{"v":1,"type":"comm'` (torn) + `'[1,2]'` + `'{"v":"x"}'` + valid line gives 2 lines and `skipped: 3`. A missing file gives `{lines: [], skipped: 0}`.
- **C8** `formatHistoryHuman`, on a fixed 3-line fixture (two sessions, one failing action, one pre-FR2-07 verification, one `evidence.tier`, one `v:2` line) with `currentSessionId` set to the second session, **equals a checked-in expected string exactly**: the header count, both `--- session` rows, `(current)` on the second only, `FAILED … : <err>`, `verified`, `contradicted`, `no-verification`, and the `v:2` notice.
- **C9** 30 concurrent `appendHistoryLine` calls from `Promise.all` (same process) give exactly 30 lines, all parseable. The live L7 covers the cross-process case.
- **C10** The existing `state.spec.ts` is unchanged. A new assertion: `HISTORY_FILE_PATH === path.join(path.dirname(<state file>), 'history.jsonl')`, via `STATE_DIR_PATH`.

---

## 5. Live-verify script: `tools/scenario-suite/verify-fr2-11-action-history.mjs`

It drives the **worktree's built** `packages/mcp-server/dist/cli.js` (stdio, spawned like `verify-fr2-01-wait-states.mjs:123`) and `packages/cli/dist/cli.js` (a separate process per command, `SUTRADHAR_CLI_STATE_DIR = <scratch>/state`), against real Chrome.

- **Never trust the tool's own report:** an independent `puppeteer-core` observer (`require_('puppeteer-core')` via `packages/browser/package.json`, as FR2-01's script does) connects to the same Chrome to confirm real effects (for example, `#count` really incremented).
- **Evidence** goes to `SUTRADHAR_FR2_11_EVIDENCE_DIR ?? .ai/loop/field-report-2/evidence/FR2-11/`, following the standing per-round rule: a fix round sets the env var to its own `fix-N/` dir. The script writes `results.json`, raw MCP transcripts, a copy of the CLI's `history.jsonl`, and CLI stdout/stderr.
- **FR2-07 detection:** `fr207 = !!clickEntry.verification && 'evidence' in clickEntry.verification`. It's recorded in the results. Assertions that depend on it are conditional and named.

**L1: MCP, navigate/eval/click in the tab view.**
1. `launch`, then `navigate` to `http://127.0.0.1:P/fr2-11-history.html?n=L1&token=SECRET-L1`, then `eval "document.title"`, then `click "#bump"`, then `eval "throw new Error('boom-L1')"` (the MCP result is `isError`).
2. The observer confirms `#count` is `1`.
3. `get_action_history {sessionId}`:
   - `entries.map(e=>e.actionType)` is `['navigate','eval','click','eval']`;
   - `entries[0].target` is `'http://127.0.0.1:P/fr2-11-history.html'`;
   - the **raw response text contains no `SECRET-L1` and no `?n=`**;
   - `entries[1].target === 'document.title'` and `entries[1].verification === undefined`;
   - `entries[3]` matches `{success:false}` with `error` containing `boom-L1`;
   - `entries[2].verification` is an object;
   - if `fr207`: `entries[0].verification.evidence.tier === 'verified'`, else `entries[0].verification === undefined`;
   - `evicted === 0`, `capacity === 200`, `scope === 'tab'`, and there's no `note`.

**L2: MCP, session merge including a closed tab.**
1. `new_tab` with the fixture `?n=L2b&token=SECRET-L2`, then `click "#bump" tabId:T2`, then `focus_tab T1`, then `eval "1+1"` (on T1), then `close_tab T2`.
2. `get_action_history {scope:'session'}`:
   - `seq` is strictly increasing by 1;
   - the order equals the call order (L1's 4 entries, then T2's entries, then T1's eval);
   - T2's entries are present with `tabId === T2` **after** T2 was closed;
   - no `SECRET-L2` in the text.
3. `get_action_history {}` (the default) contains **only** T1 entries and has no `seq` key. This is the backward-compatibility check.
4. `get_action_history {tabId: T2}` is `isError` (tab gone; the behavior is unchanged).

**L3: MCP, eviction exact counts.**
1. 205 × `eval "${i}+1"` on T1. The script keeps its own counter `nT1` of every action it sent to T1, including L1's and L2's.
2. Tab view:
   - `entries.length === 200`;
   - `evicted === nT1 - 200`;
   - `entries[0].target` equals the `(nT1-200+1)`-th action's expected target;
   - `note` matches `^\d+ older entries were evicted`.
3. Session view: `evicted === nSession - 200` and `entries[0].seq === nSession - 199`.
4. The whole run takes less than 30 s (no rate-limit stall: `runtime.eval` doesn't call the rate limiter).

**L4: MCP, bad arguments.**
- `{scope:'session', tabId:T1}` is `isError` with `cannot be combined`.
- `{scope:'all'}` is `isError` (zod).
- `{sessionId:'nope'}` is `isError` (unknown session; the text is unchanged).

**L5: CLI across separate processes** (each bullet is its own `node packages/cli/dist/cli.js …` process):
1. `nav http://127.0.0.1:P/fr2-11-history.html?n=L5&token=SECRET-L5`, then `eval document.title`, then `click #bump`, then `type #name hunter2-L5`, then `snap`, then `eval "throw new Error('x-L5')"` (exit 1), then `press #name Enter`.
2. The observer confirms `#count === 1` and that `#name`'s value is `hunter2-L5`, i.e. the actions really happened.
3. `<scratch>/state/history.jsonl` exists **next to** `state.json`. Its **raw bytes contain none of `SECRET-L5`, `hunter2-L5`, `?n=`**.
4. `history --json` (a new process): exactly 7 lines, each `JSON.parse`-able with `v === 1` and `type === 'command'`:
   - verbs in order;
   - every `sessionId` equals `state.json`'s `sessionId`;
   - the nav line's `actions[0].actionType === 'navigate'`;
   - the type line's `args[1]` matches `^<\d+ chars>$`;
   - the snap line has `actions: []`;
   - the failing eval has `exitCode 1` and `actions[0].success === false`;
   - the press line has `actions.map(a=>a.actionType)` equal to `['focus','press_key']` and `actions[1].target === 'Enter'`;
   - if `fr207`, the click line's `actions[0].verification.evidence` exists.
5. Human `history` (a new process):
   - stdout line 1 matches `^History: 7 command\(s\) in .*history\.jsonl$`;
   - exactly one `--- session … (current) ---` row;
   - 7 rows matching `^\d{4}-\d\d-\d\d \d\d:\d\d:\d\dZ  exit `;
   - one ` FAILED ` action row containing `x-L5`.
6. `history` must not start Chrome: the Chrome process count containing the scratch `--user-data-dir` root is identical before and after, and its `durationMs` is under 2 s.

**L6: CLI close and lifecycle.**
1. `close`: `state.json` is gone, `history.jsonl` **still exists**, the dir still exists, and the last line has `verb === 'close'` and `actions: []`.
2. `history` after close: exit 0, 8 commands, and no `(current)` marker.
3. `nav …?n=L6` (a new session): a new `sessionId`. `history` shows a second `--- session` row marked `(current)`.

**L7: CLI concurrency.** 5 parallel `eval "1"` processes against the same session: exactly 5 new lines, all parseable, and each file line individually `JSON.parse`-able (no interleaving).

**L8: CLI rotation, without an env knob.**
1. Stop the session.
2. Pre-seed `history.jsonl` with synthetic valid v1 lines totalling ≥ 5 MiB (the same approach FR2-03 uses for its grace period: shape the fixture, not the code), and record its sha256.
3. One `nav` gives `history.1.jsonl` whose sha256 equals the seeded one, and `history.jsonl` with exactly 1 line. Human `history` ends with `Older commands were rotated to …history.1.jsonl (not shown).`

**L9: Regression gates.**
- `tools/scenario-suite/ci-gate.mjs` on all 3 surfaces, because the engine and runtime changed.
- `tools/reliability/prob043-mcp-soak.mjs` for a 5-minute smoke; the full 20-minute run is left to the phase gate.
- A before/after timing of 200 `eval`s over MCP: the mean per-call overhead added by recording must be under 1 ms. Record both numbers.

**Teardown** (always, in `finally`): `shutdown_all`; CLI `close`; kill the observer; assert 0 Chrome processes whose command line contains the scratch root; `rm -r` the scratch dir with retry; stop the HTTP server.

---

## 6. Negative cases

| # | Case | Expected | Proved by |
|---|---|---|---|
| N1 | `scope:'session'` plus `tabId` | TypeError / MCP `isError`, "cannot be combined" | R6, M4, L4 |
| N2 | Unknown session, either scope | `BrowserNotAvailableError`, unchanged | R7, L4 |
| N3 | eval throws | The error propagates **unchanged** (same object), and a `success:false` entry is recorded | R2, L1, L5 |
| N4 | navigate rejected by the allowlist or restrict-to-local, before tab resolution | The rejection is unchanged, and **no** entry. Documented: policy rejections before a tab is resolved aren't actions. | R8 |
| N5 | navigate or eval with an unknown `tabId` | `resolveTab` throws first; no entry (no tab to record into) | R7-style, L2 step 4 |
| N6 | Secrets: URL query and fragment, eval code containing a URL with a token, CLI `type` text, `setclipboard` text | Absent from MCP output **and** `history.jsonl` bytes | H1-H6, E3, R1, R9, C1, L1, L2, L5 |
| N7 | A torn or garbage line in `history.jsonl` | Skipped with a stderr note; exit 0; `--json` omits it | C7; L5 variant (append `{"v":1,"ty` before step 4, then assert 7 lines, not 8, and the note) |
| N8 | `history.jsonl` unwritable (a directory with that name) | The command's stdout and exit code are identical to a control run; stderr gets exactly one `Warning: could not append` | C6; a live variant in L5 on a separate scratch dir |
| N9 | `history` with no file | `No CLI history yet …`, exit 0, no Chrome spawned, no `state.json` created | L5 step 6 variant on a fresh scratch dir |
| N10 | `history --bogus` | The existing unrecognized-flag error, exit 1 | live |
| N11 | A tab-scope default caller | Entries for engine actions keep the original 6 keys with identical values (new keys are additive only) | L2 step 3, E6 |
| N12 | eval code of 10,000 characters | `target.length <= 200`, ending in `…` | H5 |
| N13 | More than 200 actions | `evicted` exact at both scopes | S2, S9, L3 |
| N14 | A page value with its own `success:false` key returned by eval | Recorded as success, not misread as a failure | R3 |
| N15 | A command that dies before any session exists (Chrome spawn failure, so `printErrorAndExit` runs) | No line (nothing to attribute). Documented. | reviewed in the audit; a `CHROME_PATH=<nonexistent>` live check that `history.jsonl` is unchanged |
| N16 | Duplicate-guard rejection and invalid `timeoutMs` | Now recorded as `success:false` | E4, E5 |

---

## 7. Risks

- **R1: secrets persisted to disk (the main risk).**
  - **Covered:** URL query and fragment (the FR2-09 D5 precedent, applied to every URL-bearing string, including inside FR2-07 verification reasons and evidence); typed and clipboard text (length only, FR2-07 D11); eval *results* (never stored).
  - **Not fully covered, documented plainly:**
    - The first 200 characters of eval code can still contain a literal secret such as `setItem('jwt','eyJ…')`. String-literal masking was considered and rejected: it's unreliable on arbitrary JS and would give false assurance.
    - `click_by_text` text, `expect.text`, and error messages quoting page text are stored, capped.
    - URL paths themselves can carry tokens (`/reset/<token>`), which D5 keeps, as FR2-09 and FR2-10 already accepted.
  - **Context:** `history.jsonl` sits in the same directory as `state.json`, whose `wsEndpoint` already grants full control of the browser, including every cookie. The file adds far less exposure than its neighbor. It's created 0600 on POSIX.
  - The changelog and CLI README say: "history.jsonl records commands; don't eval literal secrets if the directory is shared."
  - No env knob to disable it (FR2-03 D8 precedent: no knobs without need). A later `SUTRADHAR_CLI_HISTORY=off` is logged as G-F.
- **R2: observable additive change.** Tab-view entries now include navigate, eval, back/forward/reload, the point actions, clipboard, trigger-upload, and rejected duplicates. A consumer counting entries sees more. Entries also gain `target`, `url` and `verification` keys. It's a superset, recorded in the changelog.
- **R3: memory.** Entries now carry `verification` (≤ ~4 KB after FR2-07). That's 200 × tabs plus 200 per session ring (the ring shares the verification object by reference and shallow-copies the entry), so a few MB at worst per session.
- **R4: CLI tab ids are not stable across processes** (§0.4). The `url` on every action row is the mitigation. This is documented in the README's history section.
- **R5: the rotation race** can drop one old generation under simultaneous rotation. It never corrupts a line. This is the same tolerance class as FR2-03's accepted `writeState` lost update.
- **R6: hard exits skip the append:** `printErrorAndExit` before a session exists, and FR2-04's watchdog if it calls `process.exit`. Mitigation: the Executor must not add any new `process.exit` inside `withSession` paths. If FR2-04 has landed with a hard-exit watchdog, its exit handler should call `recordCliCommand` first. Check at DEVELOP time and report; don't redesign FR2-04.
- **R7: merge conflicts.** `runtime.ts`, `tools.ts`, `cli.ts`, `browser-session.ts` (FR2-04's 3 construction sites) and `browser-action-engine.ts` are shared with nearly every prior item. The diff is kept to wrappers, one helper, and additive keys. DEVELOP happens after all Phase 2 items merge.
- **R8: FR2-07's final code could differ from its spec** (for example, a renamed field). The sanitizer treats `evidence` structurally, and the history stores whatever `verification` the result carries, so a rename shows up as a pass-through, not a crash. The Executor must `grep` the landed `VerificationResultDto` and report any mismatch with FR2-07/spec.md.
- **R9: the listener re-entrancy/exception path** (S5) is guarded, so a buggy ring can never fail an action.

### 7.1 Decisions to record in decisions.md

1. **D1:** a session ring with a `seq` merge order, reusing the 200 cap, and keeping closed tabs' entries.
2. **D2:** `scope` is opt-in, and the default stays the active tab (with the FR2-04 `getDialogHistory` contrast explained).
3. **D3:** `verification` has the same name and type as FR2-07's. It's a soft dependency, and eval is always absent.
4. The 7 extra runtime-level actions are recorded, beyond navigate and eval.
5. The duplicate-guard and invalid-`timeoutMs` early returns are now recorded.
6. The CLI writes one line per session-bound command, including reads. `close` gets a line. The meta verbs get none.
7. Rotation is at 5 MiB with one generation. There's no rotation on `close`.
8. No history filters, and no knob to disable it.
9. Central sanitization at `recordAction`, with the FR2-07 caps and FR2-09 D5 URLs. The eval preview keeps literals, with the reason why.

### 7.2 New gaps to log in gaps.md

- **G-A:** The SDK has no history API (`browser.history()` / `page.history()`).
- **G-B:** MCP history isn't persisted across server restarts.
- **G-C:** Tab lifecycle (`new_tab`/`close_tab`/`focus_tab`) and state setters aren't recorded (the GAP-027 class).
- **G-D:** `history` has no `--last N` or `--session` filter.
- **G-E:** CLI flags (for example `--expect-text` and `--frame`) aren't recorded in v1 lines.
- **G-F:** There's no opt-out for CLI history persistence.
- **G-G:** CLI tab ids aren't stable across processes (R4).

### 7.3 Changelog fragment (`evidence/FR2-11/changelog-fragment.md`)

- **Added:**
  - `get_action_history` `scope:"session"`;
  - `evicted`/`capacity`/`note` in its output;
  - new entry keys `target`/`url`/`verification`;
  - navigate/eval/back/forward/reload/click_at_point/drag_at_points/set_clipboard/upload_file_via_trigger recorded;
  - CLI `history.jsonl` and `sutradhar history [--json]`;
  - `SutradharRuntime.getActionHistoryReport`.
- **Changed (additive):** tab-view entries now include those action types and rejected duplicates; URLs in history drop their query and fragment.
- **Privacy note:** the R1 text.

---

## 8. Rollback

- **Code:** revert the FR2-11 commit. Every change is additive:
  - the new optional interface members;
  - the new keys;
  - a new runtime method and MCP param;
  - a new CLI verb;
  - the `withSession` wrapper, a pure rename plus a `try/finally`.

  No existing signature or return shape narrows, so reverting restores the exact prior behavior.
- **Data:** `history.jsonl`/`history.1.jsonl` files left in `~/.sutradhar-cli/<hash>/` (or `SUTRADHAR_CLI_STATE_DIR`) are inert. Older CLIs never read them, and FR2-03's clear/GC paths leave them alone. Users can delete them by hand, and nothing depends on them.
- **Partial rollback:** if the CLI persistence has a problem, the CLI half (items 9-12) can be reverted alone. The browser, runtime and MCP halves stand on their own.

---

### Critical Files for Implementation
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\session\browser-tab.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\session\browser-session.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\capability-runtime\src\runtime.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\mcp-server\src\tools.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\cli.ts (plus the new `packages/cli/src/history-file.ts` and `packages/browser/src/session/action-history.ts`)