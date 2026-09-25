# FR2-10: MCP optional `sessionId`, implementation spec

**Item:** FR2-10 (Phase 2, agent ergonomics).
**Base:** HEAD `8cb493f` on `claude/field-report-2-loop`. The working tree also has uncommitted FR2-01 fix-2 edits. For this item's files they are 7 lines in `tools.ts` and 4 in `runtime.ts` (`git diff --stat`), and none of them touch any session or registration code.
- Line numbers below are from the current working tree.
- FR2-02 to FR2-09 all merge before this item and all touch `tools.ts` and `runtime.ts`. So the Executor finds every anchor **by symbol name, not by line number**.

**Decisions in force:** §4.7 (use the live session only when exactly one exists; with 0 or more than 1, return an error listing the live session IDs; never guess). §4.9 (backward compatible > smallest diff > consistency).
**Hard preconditions:** none.
**Sequencing:** DEVELOP after FR2-09 in merge order. The overlap is small:
- `tools.ts`: one renamed parameter, one added line, one import, and the `browser.launch` description.
- `runtime.ts`: four lifecycle method bodies get a counter and a bookkeeping line, plus one new method.

The mechanism works at registration time, so it automatically covers tools added later (FR2-08's `browser.wait_for`, FR2-12's `browser.audit`) with no edits to them.
**Versioning:** no bump of its own (it rides the 0.5.0 bump). This item writes `evidence/FR2-10/changelog-fragment.md`.

---

## 0. Trace results

Everything below was read in code this session.

| # | Finding | Evidence |
|---|---|---|
| T1 | **Every tool is registered with its own inline `server.registerTool(name, {description, inputSchema: {…}}, handler)` call.** There's no shared schema fragment for `sessionId`: `z.string()` is written out per tool. `tools.ts` has 71 `server.registerTool(` calls: 70 `browser.*` tools and `agent.runGoal`. `registerTools` only ever uses `server` to call `.registerTool`; there's no other `server.` use in the file. | `tools.ts:104` onward; grep `server\.` |
| T2 | **The current `sessionId` shapes:**<br>- **66 tools** declare `sessionId: z.string()` (required). One of them, `browser.shutdown` (`:223`), adds `.describe('The session id from browser.launch.')`.<br>- **Optional (3):** `browser.launch` (`:135`, "Reuse an existing caller-owned session id."), `browser.attach` (`:201`), `agent.runGoal` (`:1758`, "Run against an existing browser session.").<br>- **No `sessionId` (2):** `browser.health` (`:115-117`) and `browser.shutdown_all` (`inputSchema: {}`, `:241`).<br>- 66 + 3 + 2 = 71. The finding's "4 tools" are the four `browser.*` exceptions (launch, attach, health, shutdown_all); `agent.runGoal` is the fifth. | grep `sessionId: z.string()` gives 69 lines: 66 required plus the 3 optional |
| T3 | **What happens today when `sessionId` is omitted.** The SDK (`@modelcontextprotocol/sdk` 1.30.0) validates before the handler runs:<br>- `mcp.js:125` → `validateToolInput` (`:166-180`) → `safeParseAsync(z.object(shape), args)`;<br>- on failure it throws `McpError(InvalidParams, "Input validation error: Invalid arguments for tool <name>: <zod message>")`;<br>- that error is caught and turned into `createToolError` (`isError:true`, `:141-160`).<br>So the caller sees a generic zod "Required" error with no Sutradhar text. On success the handler gets `parseResult.data`: unknown keys are stripped, and optional keys that weren't sent are absent. | `node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@3.25.76/.../dist/esm/server/mcp.js` |
| T4 | **Unknown id today.** `runtime.requireSession` (`runtime.ts:1666-1672`) throws `BrowserNotAvailableError('No browser session "<id>". Call launch() first.')`. Every handler catches it and calls `errorResult`. `withHint` matches `'no browser session'` (`tools.ts:56`) and appends `Hint: Call browser.launch first to create a session.` | `tools.ts:42-73` |
| T5 | **Handlers destructure `sessionId` by name and build the runtime's positional arguments themselves**, e.g. `async ({ sessionId, target, … }) => runtime.click(sessionId, target, tabId, modifiers, offset, settle)`.<br>- `sessionId` is a key in a zod raw shape, not a position.<br>- `browser.set_cookie` uses a rest spread, `({ sessionId, tabId, ...cookie })` (`:1046`). `sessionId` is destructured out by name first, so it never leaks into `cookie`.<br>- `browser.get_viewport`'s handler is **synchronous** (`:1331`). All the others are `async`. | `tools.ts` |
| T6 | **The "arity" pins do not apply to this change.** `tools.spec.ts:346` checks `waitForSelector('s1','#t',500,undefined,'attached')`, and FR2-07 and FR2-08 both add trailing arguments under a "pass only when defined" rule. Those are **positional runtime-call** arities that the *handler* builds. Making the `sessionId` *schema key* optional doesn't change what the handler passes. As long as the handler's `args.sessionId` still holds the same string, every runtime call is byte-identical. The only thing that could break a pin is changing the args object the handler receives, and §2.3 passes the identical object when `sessionId` is given. | `tools.spec.ts:332-347`; FR2-07 spec :97; FR2-08 spec T23/D13 |
| T7 | **The session registry is `BrowserSessionManager.sessions: Map<SessionId, BrowserSession>`** (`session-manager.ts:44`). How sessions enter and leave it:<br>- **Added** only at the very end of `doCreateSession` (`:194`), after the browser launch or connect and after the `initialUrl` tab has loaded (`:190-192`). Creates that are still running are held in a separate `pending` map (`:46`, `:153-166`) and are **not** visible through `getAllSessions()`.<br>- **Removed** in three places:<br>&nbsp;&nbsp;(a) `closeSession`, **after** `await session.close()` (`:233-234`), so a session that is closing stays listed until its close finishes;<br>&nbsp;&nbsp;(b) the `browser:session:crashed` subscription (`:79-86`), fired by `BrowserSession.handleCrash` (`browser-session.ts:109-127`) when Puppeteer's `disconnected` event fires (wired at `:68-70`);<br>&nbsp;&nbsp;(c) the idle reaper (`:109-123`) calling `closeSession` directly, **not** through `runtime.shutdown`. The MCP server's default reaper is 30 min (`server.ts` `DEFAULT_IDLE_TIMEOUT_MS`).<br>- The crash subscription exists only when an `EventBus` is passed. The runtime always passes one (`runtime.ts:176,183-188`). | `session-manager.ts`, `browser-session.ts` |
| T8 | **A session listing is already reachable, contrary to the original finding.** `runtime.getSessionManager()` is public (`runtime.ts:1610`), and `getAllSessions()` is public on the manager (`session-manager.ts:223`). But it can't be used as-is for resolution. `agent.runGoal` shares this manager (`server.ts` passes `runtime.getSessionManager()` to `AgentCore`), and when it's called **without** `sessionId` the agent loop creates its **own** short-lived session in the same map (`agent-loop.ts:157-166`) and closes it when the run ends (`:468`). A raw `getAllSessions()` would therefore count a session the MCP caller was never given an id for. The manager also exposes no in-flight state (`pending` is private). | `runtime.ts:1610`, `server.ts`, `agent-loop.ts:150-170,464-469` |
| T9 | **`BrowserSession` exposes** `id`, `createdAt` (ISO string, set in its constructor), `activeTabId`, `getTabs()` and `getTab()`. `isClosed` is **private** (`browser-session.ts:50`). `IBrowserTab.url` is a synchronous getter (`page.url()` or the cached URL, `browser-tab.ts:196-201`), so listing needs no CDP round-trip. Nothing records whether a session was launched or attached, and there's no user-facing label. | `browser-session.ts:21-42,45-66`; `browser-tab.ts:122-147` |
| T10 | **A no-Chrome launch still registers a session.** `BrowserLauncher.launch` falls back to a mock `PuppeteerBrowserInstance()` when Chrome fails (`browser-launcher.ts:163-172`). `runtime.launch` still registers that session and returns `hasRealBrowser:false`. MCP `browser.launch` then returns `isError` **without** the id and without shutting the session down (`tools.ts:176-181`). So an unusable session stays in the registry. Pre-existing; see GAP-new-A. | `runtime.ts:225-274`, `tools.ts:165-186` |
| T11 | **`launch` and `attach` give an omitted `sessionId` a different meaning.** For `launch` (`runtime.ts:232-237` → `createSession`, `session-manager.ts:149-167`): **omitted means mint a new id and create a new browser**. **Given** means "the caller's binding id": return the live session with that id if one exists, join an in-flight create with that id, or otherwise create a new session under that id. `attach` works the same way with `wsEndpoint`. `agent.runGoal` omitted means the agent creates and later closes its own short-lived session (T8). None of the three ever means "use whichever existing session there is". | as cited |
| T12 | **MCP tool calls really do run concurrently.** In `Protocol._onrequest` (`shared/protocol.js:284`), each request is dispatched as `Promise.resolve().then(() => handler(request, fullExtra)).then(…)` (`:358-367`) and **not awaited**. The stdio transport hands over each line as it arrives, so a second `tools/call` starts while the first is still awaiting Chrome. Clients such as Claude Code do send parallel tool calls. So "a call with no `sessionId` arrives while `launch` or `shutdown` is still running" can really happen. | `protocol.js:279-290,358-367` |
| T13 | **Within one call, resolution has no check-then-act gap.** If the wrapper reads the registry and calls the inner handler in the same synchronous turn, no other tool call can interleave (single-threaded JS). Inside the handler, the runtime's `rateLimiter.removeToken()` await (`runtime.ts:1649`) happens *after* the id is fixed, so it can't change which session is used. | `runtime.ts:1644-1664` |
| T14 | **The CLI and SDK always carry a concrete id.**<br>- CLI: `withSession` (`cli.ts:92-146`) attaches with `state.sessionId` from `state.json` (or spawns a fresh session) and passes the resulting id into every `fn(runtime, sessionId)`.<br>- SDK: `Browser` holds `public readonly sessionId` (`sutradhar/src/browser.ts:75`), and `Page` holds a private `sessionId` (`page.ts:81`); every runtime call uses them.<br>Neither surface has an "omitted" case, so **FR2-10 is MCP-only.** | as cited |
| T15 | **Test doubles.**<br>- `tools.spec.ts` uses `createMockServer()` (`:12-20`), which records `{config, handler}` and calls handlers directly with explicit `sessionId: 's1'` against a real `SutradharRuntime` with spies.<br>- `server.spec.ts` mocks `SutradharRuntime` as `{getSessionManager, getEventBus}` only and runs `registerTools` on a **real** `McpServer`. So registration must **not** call any new runtime method.<br>- `runtime.spec.ts` is "no browser"; `SutradharRuntimeOptions.launcher` accepts a test double (`runtime.ts:73-75`), and `BrowserLauncher`/`PuppeteerBrowserInstance` are exported (`browser/src/launcher/index.ts:7`). | tests |
| T16 | **Liveness vocabulary (FR2-03 §0.3).** The CLI statuses `live / unresponsive / unknown / stale / unreadable` classify a `state.json` whose owning process has **exited**. The Chrome is detached, nothing in any process is watching its connection, so the CLI has to probe the endpoint (`GET /json/version`, 1500 ms timeout) and check the PID. | FR2-03 spec §0.3 |
| T17 | **The live-verify helper already supports concurrent calls.** `makeMcpClient` in `verify-fr2-01-wait-states.mjs:122-173` keeps a `pending` map keyed by JSON-RPC id, so the race cases in §5 can fire calls in parallel. `textOf`/`jsonOf` read only `content[0]` (`:174-179`). | file |

### 0.1 Decisions (the Orchestrator records these in `decisions.md`)

**D1. Where the logic lives: a wrapper applied at registration time in the MCP server, with a small read-only method on the runtime. It is not a per-tool check, and runtime methods don't accept `undefined`.**
- **The data:** a new public method, `SutradharRuntime.listSessions()`, returns the sessions *the caller owns* plus a count of lifecycle calls still running (D3/D4). This state belongs to the runtime, which is the only place that sees `launch`/`attach`/`shutdown`.
- **The policy:** in the new file `packages/mcp-server/src/session-resolution.ts`:
  - `resolveSessionId`, a pure function: requested id plus view → resolution or exact error message;
  - `withSessionResolution(server, runtime)`, which returns a `{registerTool}` wrapper around the real server.
- **How it hooks in:** `registerTools`' parameter is renamed `mcpServer`, and its first statement becomes `const server = withSessionResolution(mcpServer, runtime);`. The 71 existing `server.registerTool(` call sites stay **byte-identical**.
- **Why not per-tool (option a as literally stated):**
  - 66 copies of the same check would be 66 chances to get it wrong;
  - every tool FR2-08/FR2-12 add would need to remember it;
  - a wrapper at registration time is the same kind of shared mechanism as `ERROR_HINTS`/`withHint`, but it doesn't need touching per handler.
- **Why not `sessionId?: string` on runtime methods (option b):**
  - it would widen 66 public method signatures that the SDK and CLI also use (T14), where "omitted" must stay a type error;
  - the policy ("never guess", the error wording, the MCP tool-name example) is an MCP concern.
- **The wrapper's rewrite rule, exactly:** if `config.inputSchema` is a plain object with a `sessionId` key whose zod schema is **not** optional (`!schema.isOptional()`), then:
  - replace that key's value with `z.string().optional().describe(SESSION_ID_DESCRIPTION)`, keeping the key order (overwriting an existing key in a spread keeps its position);
  - wrap the handler.
- **Everything else passes through by identity**, both the config object and the handler: `launch`, `attach`, `agent.runGoal` (already optional), and `health`, `shutdown_all` (no key).
- **A required `sessionId` that isn't a `z.ZodString` throws at registration.** That's a programming-error guard, so a future tool with an odd shape gets noticed instead of silently rewritten.

**D2. "Live" for MCP means "registered in this server process's runtime, created by `launch`/`attach`, and not yet shut down, reaped or crashed". It involves no endpoint probe.**
- **Why MCP can use a simpler check than FR2-03:** the CLI's owning process has exited and nothing watches the detached Chrome, so it has to probe (T16). Here the MCP server process *is* the owner:
  - it holds the live Puppeteer connection;
  - a Chrome that dies fires `disconnected` → `handleCrash` → `browser:session:crashed` → the session is removed from the registry (T7b);
  - normal shutdowns and idle reaping remove it too (T7a, T7c).

  So registry membership is already a liveness signal that is kept up to date.
- **The one FR2-03 status the registry can't see** is `unresponsive`: Chrome still connected but hung. That doesn't affect *which* session is chosen; resolution only answers "which one". A hung session is just as hung when its id is passed explicitly, and the action fails the same way. A probe would add latency (FR2-03 uses 1500 ms) to every call that leaves `sessionId` out, and wouldn't change the choice.
- **Vocabulary:** messages say "live browser session", matching §4.7's wording. They **never** use FR2-03's `stale`/`unresponsive`/`unknown` status words, which would falsely suggest a probe happened. This definition goes in the JSDoc of `listSessions()`.

**D3. The sessions that can be picked are the ones the runtime created through `launch()`/`attach()`, not every session in the manager.** A new private map, `clientSessions: Map<string, 'launched' | 'attached'>`:
- an entry is added right after `createSession` returns inside `launch`/`attach`;
- it's removed in `shutdown`, cleared in `shutdownAll`;
- at read time, entries whose id is gone from the manager (crash or reap) are dropped.

**Why:** `agent.runGoal` without a `sessionId` creates a short-lived session in the **same** manager (T8), and the MCP caller was never given its id. With 0 caller sessions and an agent run in flight, a plain `getAllSessions()` would silently resolve a `browser.*` call onto the **agent's** browser, acting on a session the caller doesn't own. That is exactly "guessing". An id the caller could never have named is not a candidate.

The CLI (`attach` each run) and the SDK (`launch`) also populate the map. That's harmless: neither surface ever omits the id (T14).

**D4. While any launch, attach or shutdown is still running, an omitted `sessionId` gets an error.** A private counter, `lifecycleOpsInFlight`, is incremented as the **first synchronous statement** of `launch`/`attach`/`shutdown`/`shutdownAll` and decremented in `finally`. `resolveSessionId` returns an error while it's above 0, whatever the session count, and still lists the current sessions.

This covers real overlap windows (T12):
- **A launch in flight:** the new session isn't in the registry until its first tab has loaded (T7). Without the guard, a call with no id sent in parallel with `launch` would resolve to the *older* session while the caller had just asked for a new one.
- **A shutdown in flight:** the closing session stays registered until `close()` returns (T7a).

It is **not** a promise about the order the client sent things in. If the server starts the omitted call's handler *before* the launch handler has started (validation is async, T3), the launch hasn't begun from the server's point of view. The one session live at that moment is then, correctly, the only live session. §5 L7 asserts the invariant that actually holds: the call never acts on the session being created or shut down, and the reported id always matches where the effect landed.

Idle-reaper and crash closes are **not** counted: they bypass the runtime (T7c). Their worst case is resolving to a session that is closing, and the action then fails with the existing closed/no-page error. It never acts on a *different* session (§7 R1d).

**D5. The error messages are exact, returned directly (not through `withHint`), and prefixed the way the handlers prefix their own errors (`<short> failed: `, where `<short>` is the tool name without the `browser.` prefix).** The full text is in §2.2.
- Each listed session shows:
  - its id;
  - `launched`/`attached`;
  - the `createdAt` ISO time;
  - the tab count;
  - the active tab's URL (origin + path, with query/fragment dropped and truncated at 80, the same rules as FR2-09's D5);
  - `no real browser page` when true.
- These are the fields that help a caller tell sessions apart. `createdAt` answers "which did I launch first", and the URL answers "which one is on the checkout page".
- **Why drop the query and fragment:** they carry tokens, and this text goes into the model's context. Full URLs stay available from `browser.list_tabs` with an explicit id.
- **The example uses a placeholder, `{"sessionId": "<id>", ...}`, never a real id.** Showing the first listed id as "the example" would nudge a model to copy it, which amounts to the server picking one indirectly.
- The list is capped at 20 lines, then `… and N more`.
- Sorted by `createdAt`, then by id, so the order is stable.

**D6. When the id was resolved automatically, the result says which session was used.** The wrapper appends one extra content item, `{type:'text', text:'sessionId omitted: used "<id>", the only live browser session.'}`, as the **last** item. This applies to both success and `isError` results from the inner handler.
- It's additive: `content[0]` (JSON text, the snapshot listing, or the screenshot image) is untouched, so every existing parser, including the harness `textOf`/`jsonOf`, is unaffected.
- **Why:** it makes an implicit choice auditable, which is the main mitigation for §7 R1g (the caller's idea of which session is live is out of date).
- When `sessionId` is passed explicitly, nothing is appended, so results are byte-identical to today.

**D7. The meaning of `launch`/`attach`/`agent.runGoal` does not change.** Their optional `sessionId` means **"the id to create or reuse under"** (T11), and leaving it out means **"create a new one"**. That's a different operation from FR2-10's **"which *existing* live session to act on"**. The wrapper leaves them alone by construction (D1: already optional → identity passthrough), and a unit test pins it.
- `browser.launch` with nothing given, while one session is live, still creates a **second** session. It does not return the existing one.
- `browser.shutdown` **does** gain resolution. It's a `browser.*` tool with a required id, and §4.7 says "every tool". Its result already echoes `{success:true, sessionId}` (`tools.ts:228`), so the resolved id is reported in the JSON as well as in the D6 note.

**D8. What counts as "given":** `args.sessionId !== undefined`. An explicit `""` is passed through unchanged, so today's `No browser session ""` error still happens. The server never reinterprets a value the caller actually sent (§6 N5). JSON `null` and non-strings are still rejected by zod (unchanged).

**D9. The parameter description is short, because it's repeated on 66 tools and every client loads `tools/list` into its context.**
- `SESSION_ID_DESCRIPTION = 'From browser.launch/attach. Optional only when exactly one session is live.'` (74 characters, about 5 KB across 66 tools).
- The full rule goes once in `browser.launch`'s description (§2.4).
- §5 Step 0 and L1 measure the `tools/list` byte size before and after and record the delta.

**Gaps to log (found while tracing; not fixed here):**
- **GAP-new-A (minor):** MCP `browser.launch` with no real browser (T10) leaves a mock session registered, never returns its id, and never shuts it down. After FR2-10 that session is listed (annotated `no real browser page`) and makes later calls without an id ambiguous until `shutdown_all` or an explicit shutdown of the listed id. The fix is a best-effort shutdown in that branch **only when the caller didn't supply `sessionId`**. That's a behavior change to `launch`, so it's logged rather than made here.
- **GAP-new-B (minor):** an explicit *unknown* id still gets the generic "Call browser.launch first" hint, without listing the live ids. That would be a cheap follow-up that reuses `formatSessionLines`.
- **GAP-new-C (minor, idea):** there's no `browser.list_sessions` tool. The error message covers the need for now; adding the tool would change `EXPECTED_BROWSER_TOOLS`, so it's left to FR2-17 or later triage.
- **GAP-new-D (minor, future):** the resolution scope is the whole server process. That's correct for stdio, which has one client. If an HTTP/SSE transport with several clients is ever added, resolution must be scoped per client connection.

---

## 1. Files to touch

| # | File | Change |
|---|---|---|
| 1 | `packages/mcp-server/src/session-resolution.ts` (**new**) | `SESSION_ID_DESCRIPTION`, `displaySessionUrl`, `formatSessionLines`, `resolveSessionId` (pure), `withSessionResolution` (the wrapper) |
| 2 | `packages/mcp-server/src/tools.ts` | Import; rename the `registerTools` parameter to `mcpServer` and add `const server = withSessionResolution(mcpServer, runtime);`; new `browser.launch` description (§2.4). **No other edits.** |
| 3 | `packages/capability-runtime/src/types.ts` | `LiveSessionInfo`, `LiveSessionsView` |
| 4 | `packages/capability-runtime/src/runtime.ts` | `clientSessions`, `lifecycleOpsInFlight`; `listSessions()`; counter and bookkeeping in `launch`, `attach`, `shutdown`, `shutdownAll` |
| 5 | `packages/mcp-server/tests/unit/session-resolution.spec.ts` (**new**) | §4.1 |
| 6 | `packages/mcp-server/tests/unit/tools.spec.ts` | **Append only**: §4.2 |
| 7 | `packages/capability-runtime/tests/unit/runtime.spec.ts` | **Append only**: §4.3 |
| 8 | `packages/mcp-server/README.md` | The `browser.launch` row gets one sentence (§2.4) |
| 9 | `AGENT_SETUP.md` | The Lifecycle row (`:64`) gets one sentence (§2.4) |
| 10 | `tools/scenario-suite/verify-fr2-10-optional-session.mjs` (**new**) | §5 |
| 11 | `.ai/loop/field-report-2/evidence/FR2-10/changelog-fragment.md` (**new**) | §7.1 |

**Not touched:** `session-manager.ts`, `browser-session.ts` (D2/D3 need nothing from them), `server.ts` and `mcp-server/src/cli.ts` (registration is the only hook), `packages/cli`, `packages/sutradhar`, `packages/agent` (T14, D7). No fixture file (§3).

---

## 2. API diff

### 2.1 `capability-runtime/src/types.ts`

```ts
/** One caller-owned browser session, as reported by {@link SutradharRuntime.listSessions}. */
export interface LiveSessionInfo {
  sessionId: string;
  /** How the session came to exist: launch() (Sutradhar owns the browser) or attach() (external browser). */
  origin: 'launched' | 'attached';
  /** ISO timestamp the session was created (BrowserSession.createdAt). */
  createdAt: string;
  tabCount: number;
  activeTabId?: string;
  /** The active tab's current URL (full; callers that display it should shorten it). */
  activeUrl?: string;
  /** false when the session is backed by the no-Chrome mock instance (launch fell back). */
  hasRealBrowser: boolean;
}

/** Snapshot of the runtime's caller-owned sessions at one instant. */
export interface LiveSessionsView {
  /** Sorted by createdAt ascending, then sessionId. */
  sessions: LiveSessionInfo[];
  /** launch/attach/shutdown/shutdownAll calls currently executing — while > 0 the set is changing. */
  lifecycleOpsInFlight: number;
}
```

### 2.2 `runtime.ts`

```ts
/** Sessions created through this runtime's own launch()/attach() — i.e. ones a caller was handed
 *  an id for. Deliberately NOT every session in the manager: agent.runGoal (no sessionId) creates
 *  its own ephemeral session in the same manager (agent-loop.ts), which no MCP caller holds an id
 *  for and must never be auto-selected (FR2-10 D3). Entries whose session has left the manager
 *  (crash, idle reap) are pruned lazily in listSessions(). */
private readonly clientSessions = new Map<string, 'launched' | 'attached'>();
/** launch/attach/shutdown/shutdownAll calls currently executing (FR2-10 D4). */
private lifecycleOpsInFlight = 0;
```

- **`launch`:** the first statement is `this.lifecycleOpsInFlight++;`, and the **whole existing body** (including `assertNavigationAllowed`) moves inside `try { … } finally { this.lifecycleOpsInFlight--; }`. Immediately after `const session = await this.sessionManager.createSession(…)`, add `if (!this.clientSessions.has(session.id)) this.clientSessions.set(session.id, 'launched');`, so a reused id keeps its original origin. The logic is otherwise unchanged.
- **`attach`:** the same counter and `try/finally`. After `createSession`, the same `set` with `'attached'`.
- **`shutdown`:** the same counter and `try/finally`, wrapping the existing body, whose `requireSession` throw still propagates. After `await this.sessionManager.closeSession(…)`, add `this.clientSessions.delete(sessionId);`.
- **`shutdownAll`:** the same counter and `try/finally`. After `closeAllSessions()`, add `this.clientSessions.clear();`. It calls `shutdown` internally; the nested increments are fine.
- **New public method**, placed next to `listTabs`:

```ts
/**
 * The caller-owned sessions (created via launch()/attach()) that are still live, plus how many
 * lifecycle calls are in flight. "Live" = still registered in this process's session manager:
 * removed on shutdown, idle reap, or Chrome disconnect (crash). No endpoint probe — this process
 * holds the browser connection itself, unlike the CLI's detached-Chrome model (FR2-03), so the
 * registry is already a maintained liveness signal. Synchronous and CDP-free.
 */
public listSessions(): LiveSessionsView {
  const sessions: LiveSessionInfo[] = [];
  for (const [id, origin] of this.clientSessions) {
    const session = this.sessionManager.getSession(createSessionId(id));
    if (!session) { this.clientSessions.delete(id); continue; }   // crashed / reaped behind our back
    const tabs = session.getTabs();
    const active = session.activeTabId ? session.getTab(session.activeTabId) : tabs[0];
    sessions.push({
      sessionId: id, origin, createdAt: session.createdAt, tabCount: tabs.length,
      activeTabId: active?.id, activeUrl: active?.url, hasRealBrowser: this.hasRealPage(active),
    });
  }
  sessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.sessionId.localeCompare(b.sessionId));
  return { sessions, lifecycleOpsInFlight: this.lifecycleOpsInFlight };
}
```

(Deleting from a `Map` while iterating it with `for…of` is well-defined in JS.)

### 2.3 `mcp-server/src/session-resolution.ts` (new)

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LiveSessionsView, LiveSessionInfo, SutradharRuntime } from '@sutradhar/capability-runtime';

export const SESSION_ID_DESCRIPTION =
  'From browser.launch/attach. Optional only when exactly one session is live.';
const MAX_LISTED = 20;

/** origin+pathname for http(s) (query/fragment dropped — tokens), `data:…` for data URLs,
 *  others as-is; control chars → space; middle-truncated to 80 (first 38 + … + last 41). */
export function displaySessionUrl(url: string | undefined): string { /* … */ }

/** One "  - <id> (<origin> <createdAt>; <n> tab(s); active: <url>[; no real browser page])" line per session. */
export function formatSessionLines(sessions: readonly LiveSessionInfo[]): string { /* … cap + "  … and N more" */ }

export type SessionResolution =
  | { ok: true; sessionId: string; implicit: boolean }
  | { ok: false; message: string };

export function resolveSessionId(requested: string | undefined, view: LiveSessionsView): SessionResolution {
  if (requested !== undefined) return { ok: true, sessionId: requested, implicit: false };
  const lines = view.sessions.length ? formatSessionLines(view.sessions) : '  (none)';
  if (view.lifecycleOpsInFlight > 0) return { ok: false, message: MSG_IN_FLIGHT(view.lifecycleOpsInFlight, lines) };
  if (view.sessions.length === 1) return { ok: true, sessionId: view.sessions[0]!.sessionId, implicit: true };
  if (view.sessions.length === 0) return { ok: false, message: MSG_NONE };
  return { ok: false, message: MSG_MANY(view.sessions.length, lines) };
}
```

**Exact message texts.** Each is prefixed by the wrapper with `<short> failed: `, e.g. `snapshot failed: `.

- `MSG_NONE`:
  `No sessionId given, and there is no live browser session to use. Call browser.launch (or browser.attach) first; its result contains the sessionId. sessionId may be omitted only while exactly one session is live.`
- `MSG_MANY(n, lines)`:
  `No sessionId given, and ${n} browser sessions are live, so which one to use is ambiguous (Sutradhar never picks one for you). Pass sessionId explicitly, e.g. {"sessionId": "<id>", ...} using one of these ids:\n${lines}`
- `MSG_IN_FLIGHT(k, lines)`:
  `No sessionId given, and ${k} browser.launch/attach/shutdown call(s) are still in progress, so the set of live sessions is changing. Pass sessionId explicitly, or retry after that call returns. Live sessions right now:\n${lines}`
- **Line format** (two-space indent, then `- `):
  `  - sess_1727258400000_1 (launched 2026-09-25T10:00:00.000Z; 1 tab; active: http://127.0.0.1:5173/checkout)`
  `  - sess_1727258460000_2 (attached 2026-09-25T10:01:00.000Z; 3 tabs; active: https://github.com/; no real browser page)`
- **The auto-resolve note (D6):** `sessionId omitted: used "<id>", the only live browser session.`

**The wrapper:**

```ts
type Registrar = Pick<McpServer, 'registerTool'>;

export function withSessionResolution(
  server: Registrar,
  runtime: Pick<SutradharRuntime, 'listSessions'>,
): Registrar {
  const registerTool = (name: string, config: any, cb: any) => {
    const shape = config?.inputSchema;
    const sid = shape && typeof shape === 'object' && !(shape instanceof z.ZodType) ? shape.sessionId : undefined;
    if (!sid || sid.isOptional()) return server.registerTool(name, config, cb);     // identity passthrough
    if (!(sid instanceof z.ZodString)) throw new Error(`${name}: required sessionId must be z.string() (FR2-10)`);
    const short = name.replace(/^browser\./, '');
    const wrapped = (args: any, extra: any) => {
      if (args?.sessionId !== undefined) return cb(args, extra);                    // explicit: same object, same return (sync stays sync)
      const r = resolveSessionId(undefined, runtime.listSessions());                // read + dispatch in one synchronous turn (T13)
      if (!r.ok) return { isError: true, content: [{ type: 'text' as const, text: `${short} failed: ${r.message}` }] };
      return Promise.resolve(cb({ ...args, sessionId: r.sessionId }, extra)).then((res: any) => ({
        ...res,
        content: [...(res?.content ?? []), { type: 'text' as const,
          text: `sessionId omitted: used "${r.sessionId}", the only live browser session.` }],
      }));
    };
    return server.registerTool(
      name,
      { ...config, inputSchema: { ...shape, sessionId: z.string().optional().describe(SESSION_ID_DESCRIPTION) } },
      wrapped,
    );
  };
  return { registerTool: registerTool as McpServer['registerTool'] };
}
```

Notes for the Executor:
- `runtime.listSessions` is called **only inside `wrapped`**, never at registration. `server.spec.ts`'s mocked runtime has no such method (T15).
- Handlers keep their static type `sessionId: string`. The wrapper guarantees a string at runtime.
- The error result is built directly, not through `errorResult`/`withHint`, so the text is exact and gets no `Hint:` line.

### 2.4 `tools.ts`, descriptions and docs

```ts
import { withSessionResolution } from './session-resolution.js';
…
export function registerTools(mcpServer: McpServer, options: RegisterToolsOptions): void {
  const { runtime } = options;
  // FR2-10: every tool whose schema requires sessionId gets it made optional, resolved to the one
  // live session when omitted (error listing the live ids when there are 0 or several). One
  // mechanism for all tools — see session-resolution.ts.
  const server = withSessionResolution(mcpServer, runtime);
```

- **The `browser.launch` description becomes:**
  `'Launch a real browser session. Returns a sessionId and whether a real Chrome/Edge page is backing the session. Optionally open an initial URL. Pass the sessionId to other browser tools. You may omit it while this is the ONLY live session: the call then uses that session and says so. With 0 or several live sessions, an omitted sessionId fails and lists the live ids. Nothing is ever guessed. The sessionId parameter HERE is different: it is the id to create (or return, if already live) and never selects an existing session automatically. Omitting it always launches a new session.'`
- The `browser.launch`/`attach` `sessionId` parameter descriptions are **unchanged**.
- **`packages/mcp-server/README.md`, the launch row:** `Launch a browser session; returns a sessionId. Other tools accept it, and it may be omitted while exactly one session is live.`
- **`AGENT_SETUP.md:64`, appended to the Lifecycle row:** `Other tools take the sessionId from launch/attach. It may be omitted only while exactly one session is live. Otherwise the call fails and lists the live ids.`

---

## 3. Fixture design

**There's no fixture file.** The live script (§5) starts an in-script `http.createServer` that serves inline HTML:
- `/a` → `<title>FR2-10 A</title><button id=a>A</button>`
- `/b` → `<title>FR2-10 B</title><button id=b>B</button>`

The script also launches its own observer Chrome (`puppeteer-core`, `mkdtemp` profile, `--remote-debugging-port=0`) as the external browser for the `browser.attach` and disconnect cases.

---

## 4. Unit tests

Rule: **no existing test or assertion may be changed, loosened, skipped or deleted.** In particular, `tools.spec.ts:346` (the `waitForSelector` arity) and every existing handler call passing `sessionId: 's1'` must pass untouched. That is itself the proof of the "explicit path is identical" claim (T6).

### 4.1 `mcp-server/tests/unit/session-resolution.spec.ts` (new)

`view(sessions, inflight = 0)` builds a `LiveSessionsView` from `{sessionId, origin, createdAt, tabCount, activeUrl, hasRealBrowser}` literals.

**Pure resolver:**
- **R1 (0 sessions).** `resolveSessionId(undefined, view([]))` gives `{ok:false}`, and `message === MSG_NONE`, compared as the exact string from §2.3.
- **R2 (1 session).** `view([A])` gives `{ok:true, sessionId:'A', implicit:true}`.
- **R3 (more than 1).** `view([A,B])` gives `ok:false`. The message:
  - starts with `No sessionId given, and 2 browser sessions are live`;
  - contains `'  - A ('` and `'  - B ('`;
  - contains `{"sessionId": "<id>", ...}`;
  - does **not** contain `{"sessionId": "A"` or `{"sessionId": "B"` (D5 placeholder rule).
- **R3b.** `view([A,B,C])` → the message contains `3 browser sessions`.
- **R4 (in flight, 1 session).** `view([A], 1)` → `ok:false`. The message contains `1 browser.launch/attach/shutdown call(s) are still in progress` and `'  - A ('`. **It does not resolve to A.**
- **R5 (in flight, 0 sessions).** `view([], 2)` → `ok:false`, the message contains `2 browser.launch` and `  (none)`.
- **R6 (explicit id).** `resolveSessionId('X', v)` gives `{ok:true, sessionId:'X', implicit:false}` for `v` in `[view([]), view([A,B]), view([A],3)]`. Also `resolveSessionId('', view([A]))` gives `sessionId:''`, `implicit:false` (D8: never redirected to A).

**Line formatting:**
- **R7.** With A = `{origin:'launched', createdAt:'2026-09-25T10:00:00.000Z', tabCount:1, activeUrl:'https://shop.test/checkout?token=SECRET#x', hasRealBrowser:true}`, the line equals exactly `  - A (launched 2026-09-25T10:00:00.000Z; 1 tab; active: https://shop.test/checkout)`, and `SECRET` doesn't appear.
- **R7b.** `tabCount:3`, `origin:'attached'`, `hasRealBrowser:false` → the line contains `attached`, `3 tabs` and ends `; no real browser page)`.
- **R8 (`displaySessionUrl`):**
  - `undefined` gives `(no page)`;
  - `about:blank` is returned as-is;
  - `data:text/html,<b>` gives `data:…`;
  - a 200-character path gives length 80 with `…` at index 38;
  - `'http://x.test/a\nb'` has no `\n` in the output.
- **R9 (list cap).** With 25 sessions: 20 `  - ` lines, then `  … and 5 more`.
- **R10 (order).** The resolver doesn't re-sort; ordering is `listSessions()`' job (see S2 in §4.3). This test only checks that `formatSessionLines` keeps the input order.

**The wrapper** (the mock registrar is the same shape as `tools.spec.ts`' `createMockServer`; the fake runtime is `{ listSessions: vi.fn(() => currentView) }`):
- **W1 (rewrite).** Register `t.req` with `{inputSchema:{sessionId:z.string(), target:z.string(), tabId:z.string().optional()}}`. Then:
  - the recorded `inputSchema.sessionId.safeParse(undefined).success === true`;
  - `.safeParse('s').success === true`;
  - `.safeParse(1).success === false`;
  - `.description === SESSION_ID_DESCRIPTION`;
  - `Object.keys(recorded inputSchema)` deep-equals `['sessionId','target','tabId']` (order kept);
  - `target` is the **same schema object** as the one passed in.
- **W2 (optional passthrough).** Register `t.launch` with `{sessionId: z.string().optional().describe('Reuse…')}`. The recorded `config` is `toBe` the passed config, and the recorded handler is `toBe` the passed handler.
- **W3 (no key).** A `{}` schema and a missing `inputSchema` → both pass through by identity.
- **W4 (explicit id).** Call the wrapped handler with `args = {sessionId:'s1', target:'#x'}`:
  - the inner handler gets `toBe(args)`, the same reference;
  - its return value comes back `toBe` the same reference;
  - a **synchronous** inner return (not a Promise) stays synchronous (`expect(ret).not.toBeInstanceOf(Promise)`);
  - `listSessions` was called 0 times.
- **W5 (omitted, 1 session).** The view is `[A]`, and the inner handler returns `{content:[{type:'text',text:'{"ok":1}'}]}`. The inner handler is called once with `{target:'#x', sessionId:'A'}`. The result's `content[0]` is unchanged, `content.length === 2`, and `content[1].text === 'sessionId omitted: used "A", the only live browser session.'`. `listSessions` was called exactly once.
- **W5b.** The inner handler returns `{isError:true, content:[…]}` → `isError` is kept and the note is still appended last.
- **W6 (omitted, 0 sessions).** The inner handler is **not** called. The result is `{isError:true, content:[{type:'text', text:'req failed: ' + MSG_NONE}]}` with the tool registered as `browser.req`, and the text doesn't contain `Hint:`.
- **W7 (omitted, 2 sessions).** The inner handler isn't called; the text contains both ids.
- **W7b (omitted, 1 session, in flight).** The inner handler isn't called; the text contains `in progress`.
- **W8.** Registering a tool with `sessionId: z.number()` (required) throws `/must be z.string\(\)/`.
- **W9.** Registering 3 tools calls `listSessions` 0 times.

### 4.2 `tools.spec.ts`: append `describe('FR2-10 optional sessionId')`

These use the real `registerTools` and a real `SutradharRuntime`, with `vi.spyOn(runtime, 'listSessions').mockReturnValue(...)` and spies on the runtime methods.

- **T1 (whole surface, derived, no hardcoded 66).** Let `EXEMPT = ['browser.launch','browser.attach','browser.health','browser.shutdown_all']`.
  - For every name in `EXPECTED_BROWSER_TOOLS` not in `EXEMPT`: `config.inputSchema.sessionId` exists, `safeParse(undefined).success` and `safeParse('s1').success` are true, and `safeParse(5).success` is false.
  - `browser.launch`/`browser.attach` still have `safeParse(undefined).success` true, and launch's description `=== 'Reuse an existing caller-owned session id.'` (unchanged).
  - `browser.health` and `browser.shutdown_all` have no `sessionId` key.
  - The number of non-exempt tools is `>= 66`. That's a floor, so FR2-08/12's additions keep it passing.
  - With an agent handle: `agent.runGoal`'s `sessionId` description `=== 'Run against an existing browser session.'`.
- **T2 (1 session, the call matches an explicit one).** `listSessions` returns `[A]`, and `runtime.click` is spied to resolve `{success:true, actionType:'click', executionTimeMs:1}`.
  - Call `browser.click` with `{target:'#x'}`, then again with `{sessionId:'A', target:'#x'}`.
  - `spy.mock.calls[0]` deep-equals `spy.mock.calls[1]`: the same positional arguments and the **same length**, which is the arity parity.
  - The first result has 2 content items and the second has 1.
- **T3 (0 sessions).** `browser.click` with `{target:'#x'}` → `isError`, the text contains `click failed: No sessionId given, and there is no live browser session`, and `runtime.click` was not called.
- **T4 (more than 1).** With `[A,B]` → `isError`, the text contains both ids, and `runtime.click` was not called.
- **T5 (launch unaffected).** With `listSessions` returning `[A]`, `browser.launch` is called with `{}` and `runtime.launch` spied to resolve `{sessionId:'N', activeTabId:'t', hasRealBrowser:true}`:
  - `runtime.launch` gets an object with `sessionId === undefined`;
  - `listSessions` is never called;
  - the result JSON's `sessionId` is `'N'`;
  - there's no note item.
- **T6 (attach unaffected).** The same pattern: `runtime.attach` gets `{endpoint, sessionId: undefined}`.
- **T7 (shutdown resolves).** With `[A]`, `browser.shutdown` `{}` → the `runtime.shutdown` spy is called with `('A')`, the result JSON is `{success:true, sessionId:'A'}`, plus the note.
- **T8 (sync handler).** With `[A]`, `browser.get_viewport` `{}` → `runtime.getViewport` is called with `('A', undefined)`. With `{sessionId:'A'}` explicitly, the return value is not a Promise (as today).
- **T9 (rest spread).** With `[A]`, `browser.set_cookie` `{name:'n', value:'v'}` → the second argument to `runtime.setCookie` has no `sessionId` key and deep-equals the object from the explicit-id call.
- **T10 (agent.runGoal unaffected).** With `listSessions` returning `[A]` and an agent handle, `agent.runGoal` `{goal:'g'}` → the second argument to `executeGoal` is `undefined`.
- **T11 (screenshot).** With `[A]`, `browser.screenshot` `{}` → `content[0].type === 'image'`, and `content[1]` is the note.
- **T12 (unknown explicit id is never redirected).** With `[A]`, `browser.click` `{sessionId:'nope', target:'#x'}` against a real (unspied) `runtime.click` → `isError`, the text contains `No browser session "nope"`, and `listSessions` wasn't called. This is exactly today's behavior.

### 4.3 `runtime.spec.ts`: append `describe('listSessions (FR2-10)')`

A fake launcher: `const launcher = new BrowserLauncher();` with `vi.spyOn(launcher,'findExecutablePath').mockReturnValue(undefined)`, which gives mock instances. For attach, `vi.spyOn(launcher,'connect').mockResolvedValue(new PuppeteerBrowserInstance())`. Then `new SutradharRuntime({ launcher, rateLimiter: null })`.

- **S1.** A fresh runtime → `{sessions:[], lifecycleOpsInFlight:0}`.
- **S2.** `launch()` twice → 2 entries, both `origin:'launched'`, `hasRealBrowser:false`, `tabCount:1`, `activeUrl:'about:blank'`. `createdAt` matches ISO format, and the entries are sorted by `createdAt` then id.
- **S3.** `attach({endpoint:'ws://x'})` → an entry with `origin:'attached'`.
- **S4 (counter).** `findExecutablePath` stays undefined, but `vi.spyOn(launcher,'launch')` returns a manually controlled deferred.
  - While `runtime.launch()` is pending: `lifecycleOpsInFlight === 1`, and `sessions` doesn't yet include it.
  - After it resolves (`new PuppeteerBrowserInstance()`): 0.
  - A second run where the deferred rejects: the launch rejects and the counter is back to 0.
  - `launch({initialUrl:'https://example.com'})` with `restrictNavigationToLocal:true` throws synchronously inside the `try`, and the counter is 0 afterwards.
- **S5.** `shutdown(id)` removes the entry; `shutdownAll()` clears everything. `shutdown('nope')` still rejects with `BrowserNotAvailableError` (the existing test `:61` is untouched) **and** the counter is 0 afterwards.
- **S6 (agent-owned sessions excluded).** `await runtime.getSessionManager().createSession({})` → not listed, even though `getSessionManager().getSessionCount() === 1`.
- **S7 (removed behind the runtime's back).** After `launch()`, `await runtime.getSessionManager().closeSession(createSessionId(id))` (the reaper/crash path) → `listSessions().sessions` is empty. The internal entry is pruned, shown by `launch({sessionId:id})` then listing exactly one entry for that id.
- **S8.** `launch({sessionId:'fixed'})` twice → listed once. An `attach({endpoint, sessionId:'fixed2'})` followed by `launch({sessionId:'fixed2'})` still reports `origin:'attached'`.

---

## 5. Live-verify script: `tools/scenario-suite/verify-fr2-10-optional-session.mjs`

**Prerequisites:** `pnpm build`. Copy these helpers verbatim from `verify-fr2-01-wait-states.mjs` (GAP-005: don't refactor): `record`, `writeJsonl`, `resolveChromeExecutablePath`, `rmWithRetry`, `makeMcpClient`, `textOf`, `jsonOf`, `freshUrl`. Add a helper `note(result) = result.content.at(-1)?.text` and `markerOf(id, key) = jsonOf(await callTool('browser.eval', {sessionId:id, code:`window.${key} ?? null`})).result`.

**Surfaces:**
- MCP: `packages/mcp-server/dist/cli.js`, stdio.
- Bundle: `packages/sutradhar/dist/mcp-cli.js`, used for L1–L3 only.

**Outputs** go to `.ai/loop/field-report-2/evidence/FR2-10/`: `step0-baseline.json`, `tools-list-{before,after}.json`, `live-mcp.jsonl`, `live-bundle.jsonl`, `live-summary.json`, `live-verify.log`. The script exits 1 on any failure.

**Ground-truth rule:** every "the call acted on session X" claim is proved by writing a unique `window.__fr210_<case>` marker through the call **with `sessionId` omitted**, then reading it back through **explicit-id** `browser.eval` on **every** live session. Exactly the session named in the auto-resolve note has it, and no other session does. A pass needs **all** of these to hold:
- the call's result;
- the id named in the note;
- the location of the marker.

**Step 0 (`--baseline`, on the pre-change build; nothing asserted):**
- record the `tools/list` JSON byte size and each tool's `required` array;
- record the `browser.snapshot {}` result text (expected: `Input validation error: … sessionId … Required`);
- with 1 session launched, record the same call again (still a validation error).

**Cases:**
1. **L1 (schema).** In `tools/list` after the change:
   - no tool's `inputSchema.required` contains `sessionId`;
   - every tool with a `sessionId` property is either `browser.launch` or `browser.attach`, or has `description === SESSION_ID_DESCRIPTION`;
   - `browser.health` and `browser.shutdown_all` have no `sessionId`;
   - the byte-size delta against Step 0 is recorded (informational; §7 R6 expects about +5 KB).
2. **L2 (0 sessions).** `browser.snapshot {}` and `browser.list_tabs {}` → `isError`. The text starts `snapshot failed: No sessionId given, and there is no live browser session` (and `list_tabs failed: …` respectively), and contains `browser.launch`.
3. **L3 (1 session).** `browser.launch {headless:true, initialUrl: <srv>/a}` → id A. Then, with `sessionId` omitted:
   - `browser.snapshot {}` → no error, `content[0]` contains `FR2-10 A` or `button "A"`, and the note `=== 'sessionId omitted: used "A", the only live browser session.'`;
   - `browser.navigate {url: freshUrl('/a')}` → `success:true`;
   - `browser.eval {code:'window.__fr210_one = 1'}` → the marker is on A.
   - `browser.click {target:'#a'}` → `success:true`.
   - Explicit `browser.snapshot {sessionId:A}` → a single content item, with no note.
4. **L4 (more than 1).** `browser.launch {headless:true, initialUrl:<srv>/b}` → B. With `sessionId` omitted:
   - `browser.eval {code:'window.__fr210_many = 1'}` → `isError`. The text contains `2 browser sessions are live`, `'  - ' + A`, `'  - ' + B`, `/a`, `/b`, and `{"sessionId": "<id>", ...}`.
   - **Neither A nor B has `__fr210_many`** (explicit reads).
   - `browser.shutdown {}` → `isError`, and **both A and B are still listed** afterwards (explicit `list_tabs` on each succeeds).
   - Explicit calls still work: `browser.snapshot {sessionId:B}` contains `FR2-10 B`.
5. **L5 (back to 1).** Explicit `browser.shutdown {sessionId:B}` → the next omitted-id `eval` marker `__fr210_back` lands on A, and the note names A.
6. **L6 (launch/attach keep their own meaning).** With only A live:
   - `browser.launch {headless:true}` (no `sessionId`) → returns a **new** id C ≠ A, and the result JSON has no note.
   - The observer Chrome's `wsEndpoint` → `browser.attach {endpoint}` (no `sessionId`) → a new id D ∉ {A, C}.
   - An omitted-id `browser.snapshot {}` → `isError` listing A, C and D, with D's line containing `attached`.
   - Explicitly shut down C.
7. **L7 (races; never acts on the session being created or shut down).** With A and D live, explicitly shut down D first, so only A is live.
   - **(a) Launch race.** Fire `browser.launch {headless:true, initialUrl:<srv>/b}` **without awaiting**, then immediately `browser.eval {code:'window.__fr210_race = 1'}` with `sessionId` omitted, then await both. The launch gives E.
     - **Invariant:** `markerOf(E,'__fr210_race') === null`.
     - Either (i) the eval is `isError` with `in progress` or an ambiguity message, and A doesn't have the marker; or (ii) the eval succeeded, its note names A, and A has the marker.
     - The branch taken is recorded. Repeat 5 times with fresh markers; every run must satisfy the invariant.
   - **(b) Shutdown race.** With A and E live: fire `browser.shutdown {sessionId:E}` without awaiting, then the omitted `eval` with `__fr210_race2`.
     - **Invariant:** the eval either errors (`in progress` or ambiguous) or its note names A with A holding the marker. It never succeeds without a note.
     - After both settle, an omitted `eval` resolves to A.
8. **L8 (disconnect equals gone).** With only A live, shut A down explicitly. Attach to the observer Chrome → F. Omitted `snapshot` resolves to F (the note names F). Now the observer **closes its own Chrome** (`browser.close()`), which drops the external connection. Then poll omitted `browser.snapshot {}`, bounded to 5 s, a condition wait with no bare sleep, until it returns the `no live browser session` message. The time taken is recorded. This proves a disconnected session leaves the resolution set with no probe involved.
9. **L9 (zero again).** `browser.launch` twice, then `browser.shutdown_all {}` → omitted `snapshot` → `no live browser session`.
10. **L10 (bundle).** Using `mcp-cli.js`, repeat L2, then L3's snapshot plus note, then L4's ambiguity message. `shutdown_all`.

**Teardown:** `shutdown_all`, close both server processes' stdin (FR2-03 makes the server exit on stdin close), and close the observer. Then `rmWithRetry` the observer's profile. The final check counts leftover Chrome processes whose command line contains this run's profile dirs, and leftover `puppeteer_dev_chrome_profile-*` dirs created after the script started. Both must be 0.

**Regression gates:**
- `vitest` for `packages/mcp-server` and `packages/capability-runtime`;
- `tools/scenario-suite/ci-gate.mjs` on all 3 surfaces (it always passes explicit ids, so it must be unchanged);
- `tools/scenario-suite/run-mcp.mjs`;
- `verify-fr2-01-wait-states.mjs`.

---

## 6. Negative cases

| # | Case | Expected | Where |
|---|---|---|---|
| N1 | Omitted, 0 live | `isError` with MSG_NONE; the runtime method is never called | W6, T3, L2 |
| N2 | Omitted, 2 or more live | `isError` listing every id; **neither page mutated** | W7, T4, R3, L4 |
| N3 | Omitted while a launch/attach is in flight | never acts on the session being created | R4, R5, W7b, S4, L7a |
| N4 | Omitted while a shutdown is in flight | error, or resolves to the one other session with a note; never a note-less success | R4, L7b |
| N5 | `sessionId: ""` | passed through: today's `No browser session ""` plus the hint; never redirected | R6 |
| N6 | `sessionId: null` or `5` | SDK validation error (unchanged) | T1 (`safeParse(5)`); zod |
| N7 | Explicit unknown id with 1 live | today's error; **never replaced by the live one** | T12 |
| N8 | A session created by `agent.runGoal` (no id) | not a candidate | S6, T10 |
| N9 | `browser.launch`/`attach` with nothing given, 1 live | creates a new session; never resolves | T5, T6, L6 |
| N10 | `health`, `shutdown_all` | schemas and handlers identical by reference | W3, T1 |
| N11 | The only session disconnected or crashed | no-live-session error, no probe | S7, L8 |
| N12 | The only session is a mock (no Chrome) | resolves to it (with the note), and the call fails with the existing "no live browser page" error, the same as with an explicit id; in the more-than-1 listing it's annotated `no real browser page` | R7b; GAP-new-A |
| N13 | Omitted plus another invalid argument (e.g. a bad URL for `navigate`) | SDK validation error first; no resolution, no runtime call | SDK order (T3) |
| N14 | Explicit id: result content | byte-identical to today (no note) | W4, T2, L3 |

---

## 7. Risks

**R1. Could resolving to "the only live session" ever act on the wrong session?** Treated as a correctness hazard, per CLAUDE.md's "never guess". Every timing scenario, traced:
- **(a) A launch or attach in flight.** The new session isn't in the registry until its tab has loaded (T7). *Hazard:* resolving to the older session while the caller has just asked for a new one. *Closed by D4* for every overlap the server can see. The leftover case is the server running the omitted call's handler *before* the launch handler starts (T3 async validation). At that moment exactly one session is live, and resolving to it is what §4.7 specifies. The client sent the two calls concurrently, so it can't depend on their relative order. L7a asserts the invariant that matters: never the new session, and the note always matches where the effect landed.
- **(b) An explicit shutdown in flight.** *Closed by D4.*
- **(c) `shutdown_all` in flight.** *Closed by D4.*
- **(d) An idle-reap or crash close in flight** (these bypass the runtime):
  - Only that one session left: the call resolves to it, and the action fails on a closed or closing browser. That's the same failure an explicit id would get, and **it never lands on a different session.**
  - Two sessions, one closing: an ambiguity error. Safe.
  - After the removal finishes: the survivor really is the only live session.
- **(e) Agent-owned short-lived sessions.** *Closed by D3.*
- **(f) Check-then-act inside one call.** Doesn't exist. The registry read and the handler dispatch happen in one synchronous turn (T13).
- **(g) The caller's own picture is out of date.** Example: the caller launched A, A was reaped after 30 idle minutes (or crashed), and the caller then launched B. It omits `sessionId` still meaning A, and the call acts on B. This is the **one real leftover hazard**, and it's built into §4.7's rule, not into any timing. Mitigations:
  - D6's note names the session used in every result where the id was resolved automatically;
  - the `launch` description says to omit only while exactly one session is live;
  - reaps are logged to stderr by the manager.

  Accepted under §4.7, and recorded as a known limit in the changelog fragment.
- **(h) Multiple clients on one server.** Not reachable over stdio (one client). GAP-new-D covers any future multi-client transport.

**R2. Scope of the behavior change.** Calls with an explicit id are byte-identical: same args object, same return, no note (W4, T2, L3). The only visible changes are:
- an omitted id now succeeds or gives a Sutradhar-written error, instead of zod's "Required";
- `required` in `tools/list` shrinks;
- there's one new description string per tool.

No client can rely on the old validation error in any useful way.

**R3. Test doubles.** `server.spec.ts`'s mocked runtime has no `listSessions`. It's safe only because registration never calls it (W9). An Executor who "optimizes" by caching `listSessions` at registration would break `server.spec.ts`, and would be wrong anyway.

**R4. Rebase with FR2-02..09.**
- `tools.ts`: only the signature line, the import, the one new line and the `launch` description change. Tools added by FR2-08 and FR2-12 are covered automatically, and T1 is derived, not a hardcoded count.
- `runtime.ts`: `launch`, `attach` and `shutdown` bodies may have been edited by FR2-04 (GAP-017) or FR2-05. The Executor wraps **whatever body is there** in the `try/finally` and adds the two bookkeeping lines, found by symbol name.

**R5. Mock sessions** (GAP-new-A) can make omitted-id calls ambiguous after a failed launch. They're visible and annotated in the error, and they clear with an explicit shutdown of the listed id or `shutdown_all`. Logged, not fixed.

**R6. Token cost of `tools/list`.** Measured in L1. The expected size is about 74 × 66 ≈ 5 KB. If the measured delta is above 8 KB, shorten `SESSION_ID_DESCRIPTION` before DONE, and record it.

**R7. A thrown error inside the wrapper.** `listSessions()` is synchronous and doesn't throw (it only reads Maps). If it ever did, the exception would reach the SDK's catch (`mcp.js:134-140`) and come back as a `createToolError` result. It wouldn't crash the server.

### 7.1 Changelog fragment (`evidence/FR2-10/changelog-fragment.md`)

- **MCP:** `sessionId` is now optional on every `browser.*` tool that required it (66 tools at FR2-10 time, plus any added later). When omitted:
  - exactly one live session → that session is used, and the result gains a trailing `sessionId omitted: used "<id>" …` text item;
  - 0 live sessions, several, or a launch/attach/shutdown still in progress → `isError` with a message listing the live session ids (and their created time, tab count and active URL without query/fragment).

  It never guesses. Explicit calls are unchanged.
- `browser.launch`, `browser.attach` and `agent.runGoal` are **unchanged**: their optional `sessionId` still means "the id to create or reuse", and omitting it still creates a new session.
- **Runtime:** a new `SutradharRuntime.listSessions()` (additive).
- **Known limit:** "the only live session" is judged by the server. If a caller's session was idle-reaped or crashed and it launched another, an omitted id uses the new one. The trailing note says so.

---

## 8. Rollback

It's a single commit, and `git revert` is complete:
- no persisted state, no file format, no migration;
- nothing depends on `listSessions()` outside this item's files;
- clients go back to seeing zod's "Required" on an omitted id.

**Partial rollback (keep the runtime method, drop the MCP behavior):** delete the one `withSessionResolution` line in `registerTools` and rename `mcpServer` back to `server`. Every tool's schema and handler then return to the exact objects registered today (identity passthrough is gone, the originals are used). Only the `launch` description and the docs sentences would need reverting too.

---

### Critical Files for Implementation
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\mcp-server\src\tools.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\mcp-server\src\session-resolution.ts (new)
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\capability-runtime\src\runtime.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\session\session-manager.ts (read-only reference for the registry lifecycle)
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\mcp-server\tests\unit\tools.spec.ts