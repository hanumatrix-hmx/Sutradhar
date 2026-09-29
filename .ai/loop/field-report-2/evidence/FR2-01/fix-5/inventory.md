# FR2-01 fix-5 — outside-in inventory of the wait_for_selector call graph

Per the escalation brief: trace DOWN from each of the three user/agent-facing surfaces
(MCP tool, CLI verb, SDK) into the engine, listing every place a message/hint/boolean gets
constructed or rendered along the way — not just inside browser-action-engine.ts.

## Surface 1: MCP tool (packages/mcp-server/src/tools.ts)

- `browser.wait_for_selector` tool handler calls `runtime.waitForSelector(...)`.
- Success path: returns `jsonResult(result)` verbatim (`SutradharRuntime`'s action wrapper
  resolves `{success:false, error:"..."}` rather than rejecting for a routine wait failure —
  see `jsonResult`'s own doc comment, tools.ts:75-90). `jsonResult` runs `.error` through
  `withHint()` (tools.ts:82-98, exact line depends on tool) — **message-construction site #1**.
- A thrown exception (rarer path, e.g. genuine selector-syntax error) goes through
  `errorResult()` → also calls `withHint()` (tools.ts:71-73) — **same site, same function**.
- `withHint()` (tools.ts:63-67) matches `ERROR_HINTS` (tools.ts:42-59) by substring against the
  lowercased message and appends the first matching hint. **This is GAP-111's exact location**:
  the `'waiting for state=hidden'` entry (tools.ts:50, pre-fix) matches BOTH of the engine's two
  distinct hidden-timeout messages (confirmed-visible AND "could not verify: one or more frames
  were unresponsive") and asserts the confident claim regardless of which one it actually is.
  **Confirms audit-5 finding GAP-111 exactly** — this inventory, done outside-in, lands on the
  same line audit-5 named.

## Surface 2: CLI verb (packages/cli/src/cli.ts, `wait` command → `cmdWait`)

- `cmdWait` (cli.ts:449-476) calls `runtime.waitForSelector(...)` and on failure does:
  `console.log(\`Wait failed: ${result.error}\`)` (cli.ts:472) — the RAW engine/runtime message,
  forwarded verbatim. **No hint logic, no message rewriting, no boolean re-derivation of its
  own.** Nothing to fix here for GAP-111/112/113 — confirmed by direct read, not assumption.
  (The task brief flagged this file as a possible second site "if the CLI has its own hint
  logic" — it does not; `cli.ts` was NOT touched by this fix cycle.)

## Surface 3: SDK (packages/sutradhar/src/page.ts, `Page.waitForSelector`)

- `Page.waitForSelector` (page.ts:142-145) calls `runtime.waitForSelector(...)` and on failure:
  `throw new Error(r.error ?? ...)` — again the RAW message, verbatim, no rewriting. Nothing to
  fix here either.

## Surface → engine seam: SutradharRuntime (packages/capability-runtime)

- Grepped for any `waitForSelector`-adjacent string construction, hint text, or boolean
  collapsing in the runtime layer between the three surfaces above and
  `BrowserActionEngine.executeActionSerialized`/`executeAction`. Found none — the runtime is a
  thin `{success, error}` / `{success, data}` pass-through for this action type. All actual
  message text originates in `browser-action-engine.ts`.

## Inside the engine (packages/browser/src/actions/browser-action-engine.ts)

Traced every place a per-frame/per-probe result gets turned into a definite boolean or a
user-facing string, for the `wait_for_selector` path specifically (hidden / visible / attached,
both the timed and check-once `timeoutMs<=0` variants):

1. `pierceFirstMatch` (~1467) — CONFIRMED FIXED by fix-4 (audit-5 re-confirmed).
2. `isHandleVisible` (~1602) — CONFIRMED FIXED by fix-4 (audit-5 re-confirmed).
3. `waitForHiddenInAllFrames`/`isHiddenInEveryFrame` tri-state plumbing (~1415-1445, ~1724) —
   CONFIRMED FIXED by fix-4 (audit-5 re-confirmed).
4. The hidden-state timed-wait message construction (~857-867) and the check-once hidden
   message construction (~2027-2037, `checkWaitForSelectorOnce`) — CONFIRMED FIXED by fix-4:
   both already distinguish `'unknown'` ("could not verify...") from a confirmed-visible
   timeout, per GAP-082/GAP-099.
5. **`diagnoseSelectorVisibility`** (~1975-2007) — **GAP-112, NOT fixed by fix-4.** Its
   per-frame `$$eval(...).catch(() => null)` swallows a genuine thrown per-frame error (as
   opposed to a `raceBounded` TIMEOUT, which fix-4 did handle via `unconfirmedFrames`) into a
   plain `null`, indistinguishable from "this frame had nothing to contribute" — audit-5's own
   inventory-methodology gap (GAP-116) notes fix-4's own comments called this "unsafe" without
   following through. `describeWaitForSelectorTimeout`'s caller (~2020-2085) then falls through
   to `describeMissingElement`'s "No element found for selector" for an element that
   DEMONSTRABLY EXISTS (audit-5 probe A2).
6. **`countOtherVisibleMatches`** (~1889-1913) — **GAP-113, NOT fixed by fix-4.** Same shape:
   its per-frame `$$eval(...).catch(() => null)` treats a genuine thrown error as `null` →
   `return 0`, contributing to a confirmed `unconfirmed:false` zero-count, indistinguishable
   from "every frame answered and found zero". Fix-4 only added the `unconfirmed`/`BOUNDED_
   TIMED_OUT` handling for the TIMEOUT case, not this thrown-error case (GAP-085's fix was
   partial).
7. `isFatalFrameCheckError` (~1578) — GAP-114 (minor, not fixed this cycle, see report).
8. `firstAnyHandleAnyFrame`'s parallelization (attached-state probing) — GAP-115 (minor, test
   coverage gap, addressed this cycle — see below).

## Cross-check against GAP-111/112/113's exact locations

All three exactly match this inventory's own outside-in trace:
- GAP-111 → tools.ts `ERROR_HINTS`/`withHint` (Surface 1, the only surface with its own
  message-rewriting logic — CLI and SDK have none).
- GAP-112 → `diagnoseSelectorVisibility` (engine item 5 above).
- GAP-113 → `countOtherVisibleMatches` (engine item 6 above).

**Conclusion: yes, this inventory — done outside-in from the three surfaces down — would have
found all three GAPs even without having read audit-5's findings first.** The key difference
from fix-4's inventory (which stopped at the engine file boundary) is Surface 1: tracing UP
through what actually happens to an engine error message once it leaves
`browser-action-engine.ts` immediately surfaces `withHint()` as a second, independent
message-construction site with its own (previously unexamined) classification logic — exactly
the layer fix-4's own inventory never reached. The CLI and SDK surfaces, once actually read
(not assumed clean), turn out to have no equivalent logic of their own, so they contribute no
further sibling sites.
