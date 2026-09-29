# FR2-09: Snapshot frame and shadow labels, implementation spec

**Item:** FR2-09 (Phase 2, agent ergonomics).
**Base:** HEAD `d687618` on `claude/field-report-2-loop`. The working tree also holds uncommitted FR2-01 fix-2 edits to `browser-action-engine.ts`, `runtime.ts`, `cli.ts`, `tools.ts` and three READMEs.
- `git diff --stat HEAD -- packages/browser/src/dom packages/capability-runtime/src/snapshot packages/browser/tests/unit/dom-semantic-engine.spec.ts` is empty. The snapshot engine, the graph type and `ax-snapshot.ts` are byte-identical to HEAD, and the line numbers below for those three files are exact.
- Line numbers in `runtime.ts`, `tools.ts`, `cli.ts` and `types.ts` come from the current working tree. FR2-02 through FR2-08 all merge before this item and touch those files, so the Executor finds every anchor there **by symbol name, not by line number**.
- None of the FR2-01..FR2-08 specs touch `dom-semantic-engine.ts`, `semantic-element-graph.ts`, `ax-snapshot.ts` or `formatGraphForLlm` (grep over `evidence/*/spec.md`). The only mention is FR2-04's note that `dom-semantic-engine.spec.ts:166,183` builds `IBrowserTab` literals.

**Decisions in force:** §4.9 (backward compatible and additive > smallest diff > consistency). No §4 decision covers this item directly.
**Hard preconditions:** none. One optional step (§2.8) depends on whether FR2-06 has landed: the Executor checks `grep -n "node-id-syntax" packages/browser/src/actions/selector-dialect.ts`.
**Sequencing:** the file overlap with FR2-02..08 is only a few lines each in `runtime.ts` (`snapshot()`), `types.ts` (`SnapshotResult`), `tools.ts` (two descriptions and `nodesBlock`) and `cli.ts` (`cmdSnap --json`). The default is DEVELOP after FR2-08 in merge order. A parallel worktree Executor is acceptable (the rebase is trivial), and the Orchestrator decides.
**Versioning:** no bump. The item writes `evidence/FR2-09/changelog-fragment.md`.

---

## 0. Trace results

Everything below was read in code this session unless marked *to confirm live*.

| # | Finding | Evidence |
|---|---|---|
| T1 | `buildGraph` gets its frames from `page.frames().filter(f => !f.isDetached()).slice(0, MAX_FRAMES)` with `MAX_FRAMES = 20`. That order is Puppeteer's `FrameTree.#frames` Map **insertion order**, which does not guarantee the main frame comes first (a main-frame swap re-inserts it). Frames past the 20 cap are dropped **silently**, a second "vanishing" path the finding didn't name. | `dom-semantic-engine.ts:95,162-165`; `puppeteer-core@25.5.0/src/cdp/FrameTree.ts:18,51-56` |
| T2 | Per frame, `frame.evaluate(scrapeFrame, {…, startId: nextId, maxStamped: 300})`. Then `nextId += frameNodes.length`. On **any** throw the bare `catch {}` skips the frame with no record. The comment says "Cross-origin-restricted (site-isolated) or navigated-away-mid-scrape frame". There is **no timeout**: a frame whose renderer main thread is busy stalls the whole snapshot for as long as it's busy (the GAP-030 class: FR2-01 audit-2 measured this for `frame.$`, and the same CDP path applies here). | `dom-semantic-engine.ts:170-189`; `evidence/FR2-01/audit-2/probe-busy-oopif*.mjs` |
| T3 | **Cross-origin frames are NOT skipped today as a class.** Puppeteer auto-attaches out-of-process iframes (OOPIFs), lists them in `page.frames()`, and `frame.evaluate` runs over that frame's own CDP session. Evidence: `browsing-capability-loop.md:39` (Milestone 1, "`snapshot`/`click` correctly traverse into a cross-origin iframe injected… after initial load"), `:78` (Stripe Elements, real cross-origin, typing works), and FR2-01 audit-2's probe (`iframeUrl: http://localhost:<p>/frame` found in `page.frames()` from a `127.0.0.1` parent, with `f.client !== page.mainFrame().client`). The file header's claim (`:21-22`, "Cross-origin iframes that Chrome's site-isolation blocks script access to are skipped") and the catch comment (`:186-187`) are **inaccurate**. What actually lands in the catch today: (a) the frame detached between `filter` and `evaluate` ("Attempted to use detached Frame"); (b) the frame navigated mid-scrape ("Execution context was destroyed"); (c) anything else CDP raises. A busy frame doesn't throw; it **hangs**. Two more cases get recorded in Step 0 (§5.0): the `sandbox` attribute with no `allow-scripts`, and a frame blocked by X-Frame-Options (a `chrome-error://` document). *To confirm live* (§5.0 matrix). Consequence: the Done-when's "skipped cross-origin frames" really means **"frames whose scrape failed, timed out, or was capped, whatever their origin"**, and this spec implements that meaning. |
| T4 | The header comment says in words: "callers never need to know which frame an id came from". Ids are globally unique because the next frame starts at `nextId`. `scrapeFrame` (`:301-482`) collects matches recursively through **open** shadow roots (`collect`, `:326-360`, recursing at `:338-339`). It keeps no record of the host, and the returned `ScrapedNode` (`:280-293`) has no frame or shadow field. | `dom-semantic-engine.ts:11-22,280-293,326-360,375-481` |
| T5 | The opt-in listener pass (`scanForEventListenerElements`, `:220-276`) uses `DOM.getDocument({pierce:true})` on the **page** target's session, which crosses same-process iframes and open shadow roots, but not OOPIFs, which have their own targets. `extractAndStampEventListenerElement` (`:495-549`) runs with `this` = the element, inside that element's own realm. So in-page `location.href`, `window.name` and `window === window.top` describe **its** frame. | `dom-semantic-engine.ts:228-262,495-549` |
| T6 | `SemanticNode` (`semantic-element-graph.ts:15-28`) is `{id, tagName, role?, accessibleName?, label?, placeholder?, nearbyText?, value?, confidence, boundingBox?, isVisible, isEnabled}`, with no frame or shadow field. The `SemanticElementGraph` constructor is `(nodes = [], url = '', title = '')` (`:35-39`). The only `new SemanticElementGraph(` calls in `src` are in `dom-semantic-engine.ts` (`:157,203,205`). Tests build it with 3 arguments (`browser/tests/unit/{dom-semantic-engine,page-understanding}.spec.ts`, `agent/tests/unit/{decision-evidence,confidence-execution}.spec.ts`). | grep |
| T7 | `formatGraphForLlm(graph, maxElements = 60, options)` (`:572-610`):<br>- It filters to `isVisible && isEnabled && (interactiveTags \|\| INTERACTIVE_ROLES)`, then writes the header `URL: …\nTitle: …\nInteractive elements (N):`.<br>- Line formats: idsOnly `[#id]`; noText `[#id] tag role=…`; default `[#id] tag "name" role=… label="…" placeholder="…" value="…"`.<br>- It adds a `... (K more elements not shown)` line past `maxElements`.<br>- **Caps in force:** `maxElements` 60 (listing only), `MAX_STAMPED_ELEMENTS_PER_FRAME` 300 (`:106`), `MAX_FRAMES` 20, `MAX_EVENT_LISTENER_CANDIDATES` 150 (`:125`). MCP additionally slices `pageText` to 2000 characters (`tools.ts` snapshot handler). | `dom-semantic-engine.ts:95,106,125,572-610` |
| T8 | **Who consumes the text:**<br>- MCP `browser.snapshot` returns `${interactiveElements}\n\nPage text:\n${pageText.slice(0,2000)}${nodesBlock}`. `nodesBlock` is `\n\nStructured nodes (JSON):\n${JSON.stringify(snap.nodes)}`, and only when `includeNodes` is set.<br>- CLI `snap` prints `interactiveElements`. `snap --json` prints `{url,title,elementCount,nodes}`.<br>- SDK `page.snapshot()` returns `SnapshotResult`.<br>- `agent-loop.ts:261` feeds `formatGraphForLlm(graph)` to the internal LLM.<br>- `apps/server/.../browser-routes.ts:280` feeds it to the dashboard.<br>- **Machine-readable paths today:** `includeNodes` (MCP), `snap --json` (CLI), and `SnapshotResult.nodes` (runtime/SDK when `includeNodes`). `browser.ax_snapshot` is text-only: the runtime returns `{url,title,listing,nodeCount}` and has no nodes array. | `tools.ts` (`browser.snapshot`, `browser.ax_snapshot`), `cli.ts` (`cmdSnap`, `cmdAxSnap`), `runtime.ts` (`snapshot`, `axSnapshot`), `types.ts` (`SnapshotResult`) |
| T9 | **Regex parsers of the listing:**<br>- `tools/scenario-suite/run-cli.mjs:312-640` (about 20 sites) uses `/^\[#(\d+)\]/` and `/^\[#\d+\] select/`, `/^\[#\d+\] a "\d+"/`. Every target is a main-frame element on saucedemo or the-internet.<br>- `dom-semantic-engine.spec.ts:35,150,158` uses `/^\[#\d+\]/`, with main-frame nodes only.<br>- `grounding-completeness.mjs` checks the **attribute**, not the text.<br>- `run-sdk.mjs` does free-text tests only.<br>- `agent-loop.ts:577-579` only **prints** `[#N]` into its own history.<br>- FR2-06's detection rule 1 is `^\[?#(\d+)\]?$` (coaching `[#12]` → `12`).<br>- **Nothing parses frame or shadow context**, because none exists. | grep `\[#` repo-wide (excluding `node_modules`, `dist`, `.ai`) |
| T10 | `buildAxSnapshot` calls `page.accessibility.snapshot({ interestingOnly: true })` with no `includeIframes`. `flatten` walks `role ∈ INTERESTING_ROLES && name`. Lines are `[role] "name"`, or `#…# name` for headings. `PageLike` is duck-typed (`accessibility`, `title`, `url`). | `ax-snapshot.ts:22-26,60-96` |
| T11 | **Puppeteer 25.5.0 `Accessibility.snapshot`** (`src/cdp/Accessibility.ts`):<br>- `SnapshotOptions.includeIframes` is **public**, `@defaultValue false`.<br>- The main call is `Accessibility.getFullAXTree({frameId})`, so child documents are **not** included by default. **Iframe content is missing from `ax_snapshot` today.** *To confirm live* (§5.0 B-ax1).<br>- With `includeIframes: true`, `populateIframes` does the following for every AX node whose role is `'Iframe'`: `realm.adoptBackendNode(backendDOMNodeId)` → `handle.contentFrame()` → `frame.accessibility.snapshot(options)`, recursively, so nested iframes and OOPIFs go through the child frame's own realm and client. Any error is swallowed by `debugError`.<br>- `serializeTree` then **appends the child document's root as the last child of the `Iframe` node**, inline at the iframe's position.<br>- `collectInterestingNodes` keeps an `Iframe` node only if it's interesting or has an `iframeSnapshot`. So an iframe whose read **failed** (or that is focus-less and empty) disappears from the tree with no trace.<br>- There are no preconditions beyond the frame being attached.<br>- `Frame.accessibility` is `@internal` (`src/api/Frame.ts:405-408`, absent from `lib/types.d.ts`). Only `page.accessibility` and `ElementHandle.contentFrame()` are public.<br>- `SerializedAXNode.elementHandle()` is public. | `Accessibility.ts:139-160,211-300,700-720`; `api/Frame.ts:405-408,874-876` |
| T12 | `Frame.name()` returns `_name`, set from the CDP `frameNavigated` payload's `name` (the iframe's `name` attribute or `window.name` at navigation time). `url()` and `parentFrame()` are public. | `cdp/Frame.ts:309-317,387`; `api/Frame.ts:874` |
| T13 | **Staleness is per document.** `assertNotStale` compares the element's `data-sd-gen` with **its own `ownerDocument`**'s `data-sd-current-gen`. A frame that wasn't re-scraped keeps its old ids and its old current-gen, so those ids pass the staleness check (§7 R10, GAP-new-1). | `browser-action-engine.ts` `assertNotStale` (~`:2064-2104`) |
| T14 | **Existing tests pin:**<br>- the header count equals the number of `/^\[#\d+\]/` lines;<br>- the noText line `[#7] button`;<br>- idsOnly lines `toEqual(['[#7]','[#8]'])`, with `not.toContain('button')`;<br>- `buildGraph` returning an empty graph for a tab with no page (`dom-semantic-engine.spec.ts`);<br>- AX `listing toBe('[button] "OK"')` and `toBe('[button] "Named Button"')`, `nodeCount`, `''` for a null tree, and url/title (`ax-snapshot.spec.ts`). The AX `mockPage` snapshot **ignores its options argument**. | tests |
| T15 | **Fixtures available for reuse:**<br>- `tools/scenario-suite/fixtures/grounding-completeness.html`: a srcdoc iframe with a button, an open shadow button, a closed shadow button;<br>- `fr2-01-wait-states.html`: a srcdoc iframe and a shadow host, both with non-interactive content only;<br>- `aria-menu.html`, `prob043-keyboard.html`, `prompt-injection.html`, `fr2-01-singleframe.html`: no iframe or shadow;<br>- `tools/engine-comparison/hard-fixtures/nested-shadow-in-iframe{,-inner}.html`: a same-origin iframe containing an open shadow root with an input and a button;<br>- `cross-origin-iframe.html` (`https://example.com`, needs network), `closed-shadow.html`, `interactive-detection.html`.<br>- The local OOPIF recipe (parent on `127.0.0.1`, iframe on `localhost`) comes from FR2-01 audit-2.<br>- `tools/engine-comparison/measure-snapshot-cost.mjs` already fixes the repo's token proxy: `CHARS_PER_TOKEN = 4`, "no tokenizer package is installed". | files |

### 0.1 Decisions (the Orchestrator records these in `decisions.md`)

**D1. Frame identity per node: `{index, url, name, parentIndex}`, recorded only for non-main frames.**
- `SemanticNode.frame` is **absent ⇔ main frame** (its URL is `graph.url`). Main-frame nodes are the majority. Stamping `frame` on every one of them would grow the `includeNodes`/`--json` payload for every caller and every page. Leaving it absent keeps the JSON **and** the text byte-identical for main-frame-only pages. The invariant is documented on the type and pinned by a unit test (U4), which is how "each node records its frame" is met without cost.
- `index` is the frame's 1-based position among non-main frames, in snapshot traversal order (D3). It is stable **within one snapshot only**; `name` and `url` are the durable identity, and the JSDoc says so.
- `name` is `frame.name()` (T12), omitted when empty.
- `url` is `frame.url()`, stored in full in the structured field and shortened for display (D5).
- `parentIndex` is set only for a nested iframe whose parent is itself an iframe. It's structured-only and never shown in text (the URL disambiguates).

**D2. Shadow identity: the full host chain in structured form, at most 2 descriptors in text.**
- Each node gets `shadowHosts?: string[]`, outermost → innermost, and only when the node is inside at least one open shadow root.
- It's computed in-page by walking `el.getRootNode()`: while the root has a `.host`, unshift a descriptor of the host and continue from `host.getRootNode()`. That walk is duck-typed and unit-testable. Only **open** roots are reachable (unchanged). Slotted light-DOM children resolve to the document root, so they get **no** shadow label, which is correct: they live in light DOM.
- **Descriptor:** `tagName.toLowerCase()`, then `#<id>` if the host has an id, else `.<firstClass>` if it has a class. Id and class are sanitized to `[A-Za-z0-9_-]` and each is capped at 30 characters, with a 40-character total cap. Examples: `payment-widget#pw`, `card-field.cvc`, `div#gc-shadow-host`.
- This matches how the listing already names elements (lower-case tag first). It is **display-only, not a guaranteed selector**, and the JSDoc says so.
- **Text rendering of the chain:** a chain of 1 renders as `payment-widget#pw`. A chain of 2 renders as `app-shell > card-field#cvc`. A chain of 3 or more renders as `app-shell > … > card-field#cvc` (outermost plus innermost). That bounds the per-line cost at about 90 characters on deeply nested component libraries while keeping the most useful two ends.

**D3. Traversal order is fixed and main-first.** `ordered = [page.mainFrame(), ...page.frames().filter(f => !f.isDetached() && f !== main)]`. The first `MAX_FRAMES` (20) are scraped, and the rest become `frame-limit` skipped entries.
- On a normal page `page.frames()[0]` is already the main frame, so ids and order are unchanged there; the byte-identical gate in §5.7 proves it.
- This also guarantees the main frame can never be cut by the cap (a latent T1 issue). The same ordering helper is used by `ax_snapshot`, so frame indices mean the same thing in both snapshots.

**D4. Text label format.** The frame goes **inside** the id bracket, and the shadow goes at the **end** of the line.
- **Frame:** `[#31 in iframe "pay" (https://pay.example.com/checkout)]` on the **first listed node** of that frame. Every later node of the same frame gets `[#32 in iframe "pay"]`: the URL is shown once per frame per listing.
- **Designator:** `"name"` when the sanitized name is non-empty **and unique** among the graph's frames (listed and skipped). Otherwise the bare `index`, as in `[#40 in iframe 2 (about:srcdoc)]`. The fallback when neither is known is `?`.
- **Shadow:** ` (shadow: <chain>)` appended after `value="…"`, as the last field.
- **Why inside the bracket:** the Done-when literally specifies `[#31 in iframe "pay" (https://…)]`, and the frame is part of the element's *address*. The cost is that `^\[#(\d+)\]` parsers miss iframe lines. T9 shows every in-repo parser targets main-frame lines, which stay byte-identical. The tolerant pattern `^\[#(\d+)` still works, and the MCP description says so (§2.7).
- **Why the shadow goes at the end:** existing prefix-anchored parsers (`/^\[#\d+\] a "\d+"/`, `/^\[#\d+\] select/`) keep matching shadow nodes.
- Frame and shadow can co-occur, e.g. `[#33 in iframe "pay"] input "CVC" (shadow: card-field#cvc)`. Each label lives in its own region of the line, so the combination stays readable.

**D5. Display URL.** For `http:`/`https:`: `origin + pathname`. Query and fragment are **dropped**, for tokens and because they carry session ids and tokens. Other schemes:
- `file:` → `file://` + pathname
- `blob:` → `blob:` + inner origin
- `data:` → `data:…`
- `about:*`, `chrome-error://*` → as is
- empty → `(no url)`
- unparsable → the raw string

The result is middle-truncated at 80 characters (first 38 + `…` + last 41, so file names survive). The structured `frame.url` stays the full URL.

**D6. Placeholders for frames that couldn't be read.** They go after all node lines (and after the `... (K more elements not shown)` line), in traversal order:
- `[iframe "ads" https://ads.example — not inspectable] (timed out after 5000ms)`
- `[iframe http://localhost:5173 — not inspectable] (navigated during snapshot)`
- `[iframe http://x.test — not inspectable] (error: <first line, ≤80 chars>)`
- `[iframe http://localhost:5173 — not inspectable] (browser error page: blocked or failed to load)`
- `[3 more iframes not scanned — frame limit 20]`, aggregated into one line for `frame-limit`

The origin comes from `frameOrigin(url)` (D5 rules, origin only). The `"name" ` prefix appears only when the frame has a name. Placeholders:
- do **not** count in the header's `Interactive elements (N)`;
- do **not** consume `maxElements`;
- have no separate cap, since there are at most 19 per-frame lines plus 1 aggregate (bounded by `MAX_FRAMES`);
- are shown in **every** mode, including `idsOnly` and `noText`, because hiding missing content is exactly the bug class being fixed.

A frame that is **detached** by the time its scrape fails is dropped silently. It's no longer on the page, so listing it would be false.

**D7. Per-frame scrape timeout for child frames only.** `FRAME_SCRAPE_TIMEOUT_MS = 5000`. The main frame stays untimed, as today; if the main document hangs, no listing is useful anyway.
- **On timeout:** attach `.catch(() => {})` to the abandoned promise (the PROB-015 pattern) and **reserve the frame's id range** with `nextId += MAX_STAMPED_ELEMENTS_PER_FRAME`. A late-completing scrape stamps ids nobody else in this snapshot uses, so it can't collide.
- **Why 5000:** it bounds today's unbounded, up-to-`protocolTimeout` stall. A real child-frame scrape takes milliseconds: the repo's own measurement is "`snapshot()` 3ms" (`extreme-scenarios-comparison-2026-08-16.md:124`), so 5 s is 100×+ headroom for heavy iframe apps.
- This is a Planner addition beyond the Done-when. A busy frame is the one realistic way a frame becomes "not inspectable" today (T3).

**D8. Error-page frames.** A child frame whose `url()` starts with `chrome-error://` after its scrape becomes a placeholder, reason `error-page`. Its nodes are discarded, and their ids stay reserved, because `nextId` already advanced.
- **Step 0 fork:** if Step 0 shows Puppeteer reports the *original* URL for an X-Frame-Options-blocked frame, add one bounded extra `frame.evaluate(() => location.href)`, only for child frames that returned **0 nodes**, and apply the same rule. Record which branch was taken in `decisions.md`.

**D9. Structured fields as well as text: yes, both.** Programmatic paths exist today (T8): `includeNodes`, `snap --json` and `SnapshotResult.nodes`. A consumer there must not have to regex-parse labels.
- `SemanticNode.frame?` and `SemanticNode.shadowHosts?` are added.
- `SemanticElementGraph.skippedFrames` is added (4th constructor parameter, default `[]`).
- `SnapshotResult.skippedFrames?` is present exactly when `includeNodes` is set, alongside `nodes`.
- MCP appends `\n\nSkipped frames (JSON):\n[…]` after the nodes block **only** when `includeNodes` is set and the list is non-empty.
- CLI `snap --json` gains a `skippedFrames` key, always an array.
- `ax_snapshot` has no structured output today (T8), so none is added (§7 R8).

**D10. `ax_snapshot` uses the public `includeIframes: true`**, not the `@internal` `frame.accessibility` (T11), and recovers frame identity per `Iframe` node through public APIs: `node.elementHandle()` → `contentFrame()` → `url()` and `name()`, with the index taken from D3's ordering (instance equality with `page.frames()` entries).
- **Format:** iframe content is **grouped** under a header line `[iframe "pay" (https://pay.example/checkout)]` at the iframe's position in document order. The content lines are indented 2 spaces per nesting depth. The header is printed only if at least one line lands under it.
- **Why grouping:** the AX listing has no ids, so D4's bracket-id form has nothing to attach to. The AX flattening already preserves document order with the iframe's content contiguous, so one header per frame is cheaper than per-line suffixes and unambiguous. It uses the same designator and URL rules as D4 and D5.
- `nodeCount` still counts only role lines. A page without iframes has an unchanged listing.

**D11. Bounded `includeIframes`.** Puppeteer's per-iframe AX read has no timeout, so the same busy-OOPIF hang (T2) would now reach `ax_snapshot`, which today ignores iframes. Race the `includeIframes:true` call against `AX_IFRAMES_TIMEOUT_MS = 5000`. On timeout **or** rejection, re-read with `{interestingOnly:true}` (no iframes) and append one final line: `[iframes not included — reading an iframe's accessibility tree timed out after 5000ms]`, or `… failed: <≤80 chars>`.

**D12. `ax_snapshot` carries no shadow labels and no per-frame "not inspectable" placeholders.**
- The AX tree is shadow-transparent by design. Mapping each AX node back to its DOM root would cost one `DOM.describeNode` per node.
- Puppeteer swallows per-iframe failures and drops the `Iframe` node (T11). With public API, a failed frame can't be told apart from a hidden or empty one, and guessing would print false placeholders for every hidden ad or tracking iframe.
- The DOM snapshot is where D6's placeholders live. Logged as GAP-new-3 and GAP-new-4.

**D13. `noText` and `idsOnly` behavior.**
- `idsOnly` keeps `[#31]` exactly (its contract is "nothing but the id", and ids are globally unique and target the right frame automatically).
- `noText` keeps the designator but drops the URL and the shadow label (`[#31 in iframe "pay"] input`). Both are descriptive text, which `noText` exists to drop.
- Placeholders stay in both modes (D6).

**D14. Sanitizing page-controlled strings.** The frame name, host id/class and URL are page-controlled and now land in text an LLM reads.
- Names: `\r\n\t` become spaces, `"` becomes `'`, `[` and `]` are removed, trimmed, capped at 30.
- Host id and class: `[^\w-]` is removed.
- URLs go through `new URL()` normalization (D5).

No label can forge a line or close a bracket (N7/N8). The pre-existing, unrelated newline-in-`accessibleName` issue is logged as GAP-new-2, not fixed here.

**D15. Token measurement proxy.** Characters, with `approxTokens = ceil(chars / 4)`, which is exactly `measure-snapshot-cost.mjs`'s documented `CHARS_PER_TOKEN = 4`. No tokenizer dependency is added (§5.7).

**Gaps to log (found while tracing; not fixed here):**
- **GAP-new-1 (minor):** ids stamped by a *previous* snapshot inside a frame that this snapshot couldn't re-scrape (it timed out or errored) keep a matching per-document generation (T13). Such an id can collide with a fresh id elsewhere. The id reservation in D7 only protects the *current* snapshot's late stamps. A real fix (a global id namespace per snapshot) is out of scope.
- **GAP-new-2 (minor, prompt-injection adjacent):** `accessibleName`/`label` come from `innerText` and can contain newlines. A page can therefore emit a physical line that looks like `[#N] button "…"` (pre-existing: `scrapeFrame :425-430`, `formatGraphForLlm :598`).
- **GAP-new-3 (minor):** `ax_snapshot` can't report an iframe whose AX read failed, because Puppeteer swallows it (T11).
- **GAP-new-4 (minor):** `ax_snapshot` has no shadow-host context.

---

## 1. Files to touch

| # | File | Change |
|---|---|---|
| 1 | `packages/browser/src/dom/frame-labels.ts` (new) | Pure helpers: `displayFrameUrl`, `frameOrigin`, `sanitizeFrameName`, `frameDesignator`, `formatShadowChain`, `orderSnapshotFrames`, `formatSkippedFrameLine`, `SKIPPED_REASON_TEXT` |
| 2 | `packages/browser/src/dom/index.ts` | `export * from './frame-labels.js';` |
| 3 | `packages/browser/src/dom/semantic-element-graph.ts` | `SemanticFrameRef`, `SkippedFrame`, `SkippedFrameReason`; `SemanticNode.frame?`, `.shadowHosts?`; `SemanticElementGraph.skippedFrames` plus the optional 4th constructor parameter |
| 4 | `packages/browser/src/dom/dom-semantic-engine.ts` | Header comment corrected (T3/T4); `FRAME_SCRAPE_TIMEOUT_MS`; `buildGraph` frame loop (D3/D6/D7/D8); `ScrapedNode.shadowHosts?`; `scrapeFrame` computes `shadowHosts` and is exported `@internal`; `extractAndStampEventListenerElement` returns in-page frame and shadow identity and is exported `@internal`; the listener pass maps frames; `formatGraphForLlm` labels and placeholders |
| 5 | `packages/capability-runtime/src/snapshot/ax-snapshot.ts` | `includeIframes`, the D11 race and fallback, async walk with iframe headers and indentation, `PageLike`/`RawAxNode` widened, `AX_IFRAMES_TIMEOUT_MS` |
| 6 | `packages/capability-runtime/src/types.ts` | `SnapshotResult.skippedFrames?: readonly SkippedFrame[]` (import type from `@sutradhar/browser`) |
| 7 | `packages/capability-runtime/src/runtime.ts` | `snapshot()`: `...(options?.includeNodes ? { nodes: graph.nodes, skippedFrames: graph.skippedFrames } : {})`; JSDoc sentence on labels |
| 8 | `packages/mcp-server/src/tools.ts` | `browser.snapshot` and `browser.ax_snapshot` descriptions (§2.7); the skipped-frames JSON block |
| 9 | `packages/cli/src/cli.ts` | `cmdSnap --json`: add `skippedFrames: snap.skippedFrames ?? []`; `cmdAxSnap` unchanged (prints `listing`) |
| 10 | `AGENT_SETUP.md` | One sentence next to the snapshot/`frameSelector` text (§2.7) |
| 11 | `packages/browser/src/actions/selector-dialect.ts` (**only if FR2-06 has landed**) | Extend `node-id-syntax` (§2.8) |
| 12 | Tests | `browser/tests/unit/frame-labels.spec.ts` (new); `dom-semantic-engine.spec.ts` (append); `capability-runtime/tests/unit/ax-snapshot.spec.ts` (append); `runtime.spec.ts` (append); `mcp-server/tests/unit/tools.spec.ts` (append); FR2-06's `selector-dialect.spec.ts` (append, if #11) |
| 13 | `tools/scenario-suite/fixtures/fr2-09-frames.html`, `fr2-09-inner.html`, `fr2-09-many-frames.html` (new) | §3 |
| 14 | `tools/scenario-suite/verify-fr2-09-frames.mjs` (new) | §5 |
| 15 | `.ai/loop/field-report-2/evidence/FR2-09/changelog-fragment.md`, `token-size.md` (new) | §7.1, §5.7 |

**Not touched:** `browser-action-engine.ts` (ids still resolve across frames; no targeting change); `packages/sutradhar/src/*` (it gets the new fields through `SnapshotResult`); `packages/agent`; `apps/server` (both get labels through `formatGraphForLlm` automatically); `run-cli.mjs` (T9: all its targets are main-frame); `INTERACTIVE_SELECTOR`, visibility logic, confidence.

---

## 2. API diff

### 2.1 `semantic-element-graph.ts`

```ts
/** Where a non-main-frame node lives. ABSENT on a SemanticNode ⇔ the node is in the main frame
 *  (whose URL is SemanticElementGraph.url) — omitted there so main-frame-only pages keep a
 *  byte-identical text listing and JSON payload. */
export interface SemanticFrameRef {
  /** 1-based position among the non-main frames this snapshot traversed (main frame first, then
   *  page.frames() order). Stable within ONE snapshot only — use url/name as durable identity.
   *  Absent only when the frame could not be matched (event-listener pass, rare). */
  readonly index?: number;
  /** Full frame URL (the text listing shows a shortened form). */
  readonly url: string;
  /** frame.name() — the iframe's name attribute / window.name at navigation. Omitted when empty. */
  readonly name?: string;
  /** index of the parent frame when the parent is itself an iframe; absent when the parent is the main frame. */
  readonly parentIndex?: number;
}

export type SkippedFrameReason = 'timeout' | 'navigated' | 'error' | 'error-page' | 'frame-limit';

/** A child frame whose content is NOT in this snapshot — listed rather than silently dropped. */
export interface SkippedFrame {
  readonly index: number;
  readonly url: string;
  /** frameOrigin(url) — what the text placeholder shows. */
  readonly origin: string;
  readonly name?: string;
  readonly reason: SkippedFrameReason;
  /** timeout: the limit in ms as a string; error: first line of the message (≤80 chars). */
  readonly detail?: string;
}

export interface SemanticNode {
  // …existing fields unchanged…
  /** Present only for nodes inside an iframe — see SemanticFrameRef. */
  readonly frame?: SemanticFrameRef;
  /** Open-shadow-root host descriptors, outermost → innermost (e.g. ["app-shell", "card-field#cvc"]).
   *  Display-only descriptors (tag + #id or .firstClass), not guaranteed selectors. Absent in light DOM. */
  readonly shadowHosts?: readonly string[];
}

export class SemanticElementGraph {
  public readonly nodes: readonly SemanticNode[];
  public readonly url: string;
  public readonly title: string;
  /** Child frames whose content could not be read this snapshot (timed out, navigated, errored,
   *  browser error page) or that exceeded the frame cap. Empty on a normal page. */
  public readonly skippedFrames: readonly SkippedFrame[];

  public constructor(nodes: readonly SemanticNode[] = [], url = '', title = '', skippedFrames: readonly SkippedFrame[] = []) { … }
}
```

### 2.2 `frame-labels.ts` (new, pure; all exported)

```ts
export function displayFrameUrl(url: string): string;          // D5, middle-truncated at 80
export function frameOrigin(url: string): string;              // D5 origin rules
export function sanitizeFrameName(name: string | undefined): string; // D14 (≤30, "→', no []\r\n\t)
/** `"name"` if sanitized name non-empty AND unique in `allNames` (sanitized multiset), else String(index), else '?'. */
export function frameDesignator(ref: { name?: string; index?: number }, allNames: readonly string[]): string;
export function formatShadowChain(chain: readonly string[]): string; // D2: 1 → a; 2 → a > b; ≥3 → a > … > z
/** D3: [main, ...frames.filter(!detached && !== main)] — works on any duck-typed frame. */
export function orderSnapshotFrames<F extends { isDetached(): boolean }>(frames: readonly F[], main: F): F[];
export const SKIPPED_REASON_TEXT: Record<Exclude<SkippedFrameReason, 'frame-limit'>, (detail?: string) => string>;
//  timeout    → `timed out after ${detail}ms`
//  navigated  → 'navigated during snapshot'
//  error      → `error: ${detail}`
//  error-page → 'browser error page: blocked or failed to load'
export function formatSkippedFrameLines(skipped: readonly SkippedFrame[], maxFrames: number): string[];
//  per non-limit entry: `[iframe ${name ? `"${sanitizeFrameName(name)}" ` : ''}${origin} — not inspectable] (${reasonText})`
//  frame-limit entries aggregated: `[${k} more iframe${k === 1 ? '' : 's'} not scanned — frame limit ${maxFrames}]`
```
`displayFrameUrl` and `frameOrigin` never throw: any parse failure falls back to the raw string (sliced to 80 or 40 characters respectively).

### 2.3 `buildGraph` (`dom-semantic-engine.ts:151-207`)

**Before (`:160-189`):** frames = `filter(!detached).slice(0, 20)`; per frame `try { await frame.evaluate(...) } catch {}`.

**After** (inside the existing outer `try`):
```ts
const generation = String(Date.now());
const main = page.mainFrame();
const ordered = orderSnapshotFrames(page.frames(), main);          // D3
const indexOf = new Map<Frame, number>();
ordered.forEach((f, i) => { if (i > 0) indexOf.set(f, i); });
const refOf = (f: Frame): SemanticFrameRef => {
  const parent = f.parentFrame();
  const parentIndex = parent ? indexOf.get(parent) : undefined;
  const name = f.name() || undefined;
  return { index: indexOf.get(f), url: f.url(), ...(name ? { name } : {}), ...(parentIndex ? { parentIndex } : {}) };
};
const allNodes: ScrapedNode[] = [];
const skipped: SkippedFrame[] = [];
let nextId = 1;

for (const frame of ordered.slice(0, MAX_FRAMES)) {
  const isMain = frame === main;
  const scrape = frame.evaluate(scrapeFrame, { /* unchanged params */ startId: nextId, … });
  scrape.catch(() => {});                                            // an abandoned scrape never goes unhandled
  try {
    const frameNodes = isMain ? await scrape : await raceFrameTimeout(scrape, FRAME_SCRAPE_TIMEOUT_MS);
    if (!isMain && frame.url().startsWith('chrome-error://')) {     // D8
      nextId += frameNodes.length;                                   // stamped but unlisted: keep ids reserved
      skipped.push(skippedOf(frame, 'error-page'));
      continue;
    }
    const ref = isMain ? undefined : refOf(frame);
    allNodes.push(...(ref ? frameNodes.map((n) => ({ ...n, frame: ref })) : frameNodes));
    nextId += frameNodes.length;
  } catch (e) {
    if (e === FRAME_TIMEOUT) {                                       // D7 (child frames only)
      nextId += MAX_STAMPED_ELEMENTS_PER_FRAME;
      skipped.push(skippedOf(frame, 'timeout', String(FRAME_SCRAPE_TIMEOUT_MS)));
      continue;
    }
    if (isMain || frame.isDetached()) continue;                      // today's behavior / frame is gone (D6)
    const msg = firstLine(e);
    skipped.push(skippedOf(frame, /Execution context was destroyed|Cannot find context|navigat/i.test(msg) ? 'navigated' : 'error', msg.slice(0, 80)));
  }
}
for (const frame of ordered.slice(MAX_FRAMES)) skipped.push(skippedOf(frame, 'frame-limit'));
```
- `skippedOf(f, reason, detail?)` returns `{ index: indexOf.get(f)!, url: f.url(), origin: frameOrigin(f.url()), name?, reason, detail? }`.
- `FRAME_TIMEOUT` is a module-private sentinel symbol. `raceFrameTimeout` clears its timer in `finally`.
- The final `return` becomes `new SemanticElementGraph(allNodes, tab.url, liveTitle, skipped)`. The empty-graph returns (`:157`, `:205`) are unchanged.

**Listener pass** (`:191-194`, `:246-262`): `extractAndStampEventListenerElement` also returns `frameUrl: location.href`, `frameName: window.name`, `isTopFrame: window === window.top` and `shadowHosts` (same inline walk as §2.4). Node-side, before pushing:
- if `isTopFrame`, the node gets **no** `frame`;
- otherwise, `frame` = `refOf(first ordered frame with url() === frameUrl && name() === frameName)`, or `{ url: frameUrl, name?: frameName }` (no index) when nothing matches.

The three helper fields are stripped before the push.

### 2.4 `scrapeFrame` (`:301-482`)

It is exported with `/** @internal exported for unit tests; runs in-page, must stay self-contained. */` and its parameters are unchanged. It gains two inner functions (serialized with it, like `collect` today):

```ts
function describeHost(h: Element): string {
  const tag = h.tagName.toLowerCase();
  const id = (h.id || '').replace(/[^\w-]/g, '').slice(0, 30);
  const cls = typeof (h as HTMLElement).className === 'string'
    ? ((h as HTMLElement).className.trim().split(/\s+/)[0] || '').replace(/[^\w-]/g, '').slice(0, 30) : '';
  return (tag + (id ? `#${id}` : cls ? `.${cls}` : '')).slice(0, 40);
}
function shadowHostsOf(el: Element): string[] | undefined {
  const chain: string[] = [];
  let root: Node = el.getRootNode();
  while (root && (root as ShadowRoot).host) {           // duck-typed: Document has no .host
    const host = (root as ShadowRoot).host;
    chain.unshift(describeHost(host));
    root = host.getRootNode();
  }
  return chain.length ? chain : undefined;
}
```
In the returned object, `...(hosts ? { shadowHosts: hosts } : {})` is added, where `const hosts = shadowHostsOf(el)`, so the key is absent in light DOM. `ScrapedNode` gains `shadowHosts?: string[]`. `extractAndStampEventListenerElement` inlines identical copies of both helpers. The duplication follows the existing precedent: its `isVisible` logic already duplicates `scrapeFrame`'s, because each function must serialize on its own. Unit U10 pins that the two copies behave the same.

### 2.5 `formatGraphForLlm` (`:572-610`)

The header, filter and `maxElements` behavior are unchanged.
```ts
const frames = collectFrames(graph);                          // every SemanticFrameRef in nodes + skippedFrames
const allNames = frames.map((f) => sanitizeFrameName(f.name)).filter(Boolean);
const urlShown = new Set<string>();                           // key: `i${index}` or `u${url}`
for (const n of interactive.slice(0, maxElements)) {
  if (options.idsOnly) { lines.push(`[#${n.id}]`); continue; }                 // D13: unchanged
  let where = '';
  if (n.frame) {
    where = ` in iframe ${frameDesignator(n.frame, allNames)}`;
    const key = n.frame.index !== undefined ? `i${n.frame.index}` : `u${n.frame.url}`;
    if (!options.noText && !urlShown.has(key)) { where += ` (${displayFrameUrl(n.frame.url)})`; urlShown.add(key); }
  }
  const idPart = `[#${n.id}${where}]`;
  const tag = …; const role = …;                                                  // unchanged
  if (options.noText) { lines.push(`${idPart} ${tag}${role}`); continue; }
  // namePart/labelPart/placeholderPart/valuePart unchanged
  const shadowPart = n.shadowHosts?.length ? ` (shadow: ${formatShadowChain(n.shadowHosts)})` : '';
  lines.push(`${idPart} ${tag}${namePart}${role}${labelPart}${placeholderPart}${valuePart}${shadowPart}`);
}
if (interactive.length > maxElements) lines.push(`... (${interactive.length - maxElements} more elements not shown)`);
lines.push(...formatSkippedFrameLines(graph.skippedFrames ?? [], MAX_FRAMES));
return `${header}\n${lines.join('\n')}`;
```
The JSDoc example block gains the iframe, shadow and placeholder examples below.

**Worked examples, exact output.** The graph URL is `https://shop.test/checkout`.

| Case | Node / entry | Line |
|---|---|---|
| Main frame, no shadow | `{id:7, BUTTON, name "Search"}` | `[#7] button "Search"` (byte-identical to today) |
| Main frame, shadow depth 1 | `shadowHosts:["payment-widget#pw"]`, INPUT, name "Card" | `[#12] input "Card" (shadow: payment-widget#pw)` |
| Main frame, shadow depth 2 | `["app-shell","card-field.cvc"]` | `[#13] input "CVC" (shadow: app-shell > card-field.cvc)` |
| Main frame, shadow depth 4 | `["a-x","b-y","c-z","card-field#n"]` | `… (shadow: a-x > … > card-field#n)` |
| Same-origin iframe, first node | `frame:{index:1,url:"https://shop.test/pay/form?sid=abc",name:"pay"}`, INPUT placeholder "1234" | `[#31 in iframe "pay" (https://shop.test/pay/form)] input placeholder="1234"` (the query is dropped) |
| Same frame, next node | same ref, BUTTON "Pay" | `[#32 in iframe "pay"] button "Pay"` |
| Cross-origin OOPIF, unnamed | `frame:{index:2,url:"http://localhost:5173/frame"}` | `[#40 in iframe 2 (http://localhost:5173/frame)] button "In frame"` |
| srcdoc, unnamed | `frame:{index:3,url:"about:srcdoc"}` | `[#41 in iframe 3 (about:srcdoc)] button "In-iframe button"` |
| Iframe plus shadow | `frame:{index:1,…,"pay"}`, `shadowHosts:["card-field#cvc"]` | `[#33 in iframe "pay"] input "CVC" (shadow: card-field#cvc)` |
| Duplicate names | two frames both named `dup` (indices 4, 5) | `[#50 in iframe 4 (…)]`, `[#51 in iframe 5 (…)]` |
| noText | the #31 node | `[#31 in iframe "pay"] input` |
| idsOnly | the #31 node | `[#31]` |
| Skipped: timeout | `{index:6,url:"https://ads.example/x?y",origin:"https://ads.example",name:"ads",reason:"timeout",detail:"5000"}` | `[iframe "ads" https://ads.example — not inspectable] (timed out after 5000ms)` |
| Skipped: navigated | unnamed, `http://localhost:5173` | `[iframe http://localhost:5173 — not inspectable] (navigated during snapshot)` |
| Skipped: error page | an X-Frame-Options-denied frame | `[iframe http://localhost:5173 — not inspectable] (browser error page: blocked or failed to load)` |
| Skipped: frame limit | 4 `frame-limit` entries | `[4 more iframes not scanned — frame limit 20]` |

### 2.6 `ax-snapshot.ts`

```ts
interface FrameLike { url(): string; name(): string; isDetached(): boolean; }
interface PageLike {
  accessibility: { snapshot(options?: { interestingOnly?: boolean; includeIframes?: boolean }): Promise<unknown> };
  title(): Promise<string | undefined>;
  url(): string;
  /** Optional so existing duck-typed test pages keep working; real Puppeteer pages have both. */
  frames?(): FrameLike[];
  mainFrame?(): FrameLike;
}
interface RawAxNode {
  role?: string; name?: string; level?: number; children?: readonly RawAxNode[];
  elementHandle?(): Promise<{ contentFrame?(): Promise<FrameLike | null>; dispose?(): Promise<void> } | null>;
}
export const AX_IFRAMES_TIMEOUT_MS = 5000;
```
**`buildAxSnapshot`:**
1. `p = page.accessibility.snapshot({ interestingOnly: true, includeIframes: true })`, then `p.catch(() => {})`. Race it against `AX_IFRAMES_TIMEOUT_MS`.
2. On timeout or rejection: `tree = await page.accessibility.snapshot({ interestingOnly: true })` and set `note` (D11). That second call's rejection propagates exactly as today.
3. `order = page.frames && page.mainFrame ? orderSnapshotFrames(page.frames(), page.mainFrame()) : []`, `index = Map(frame → i)` for `i ≥ 1`, and `allNames` from `order.slice(1)`.
4. Run an async `walk(node, depth)`:
   - If `node.role === 'Iframe'`: resolve `frame` via `node.elementHandle?.()` → `contentFrame?.()`, inside a try/catch, disposing the handle. Walk the children at `depth + 1` into a child buffer. If the buffer is non-empty, push `indent(depth) + '[iframe ' + frameDesignator({name: frame?.name() || undefined, index: frame ? index.get(frame) : undefined}, allNames) + (frame?.url() ? ` (${displayFrameUrl(frame.url())})` : '') + ']'`, then the buffer. Return.
   - Otherwise, if interesting (unchanged predicate), push `indent(depth) + <unchanged line format>` and push the node into `nodes`.
   - Recurse into the children at the same `depth`.
5. If `note` is set, push it last. `indent(d) = '  '.repeat(d)`.

`url`, `title` and `nodeCount` keep their semantics. `AxNode` stays exported unchanged; the frame context lives only in the listing (D9). **Example output:**
```
[button] "Checkout"
[iframe "pay" (http://127.0.0.1:5173/fr2-09-inner.html)]
  ## Card details
  [textbox] "Card number"
  [button] "Pay"
  [iframe 3 (about:srcdoc)]
    [button] "Nested"
[link] "Help"
```

### 2.7 Descriptions and docs

**MCP `browser.snapshot`**: insert after the first sentence:
> Elements inside an iframe are listed as `[#31 in iframe "pay" (https://…)]` (the frame's URL is shown on its first listed element, then just `[#32 in iframe "pay"]`; an unnamed frame shows its number instead). Elements inside an open shadow root end with `(shadow: host-tag#id)`. Ids stay globally unique across frames, so pass just the number (`"31"`); when parsing, match `^\[#(\d+)`, not `^\[#(\d+)\]`. A frame whose content could not be read is listed as `[iframe <origin> — not inspectable] (reason)` rather than silently omitted; take the snapshot again, or read it with eval/extract_data + `frameSelector` (e.g. `iframe[name="pay"]`). With includeNodes, nodes carry `frame` and `shadowHosts` fields, and skipped frames are returned as JSON.

**MCP `browser.ax_snapshot`**: append:
> Iframe content (including cross-origin frames) is included in place, grouped under an indented `[iframe "name" (url)]` line.

**AGENT_SETUP.md**: one sentence in the snapshot guidance area, near the `frameSelector` note at `:68`, with the same content as the first two MCP sentences.

**`runtime.snapshot` JSDoc**: one sentence pointing to `SemanticNode.frame` and `shadowHosts`, and to `skippedFrames` (present with `includeNodes`).

### 2.8 Conditional: FR2-06 coaching (only if `selector-dialect.ts` exists)

Rule 1 (`node-id-syntax`) regex `^\[?#(\d+)\]?$` becomes `^\[?#(\d+)(?:\s+in\s+iframe\b[^\]]*)?\]?$`. The reason text is unchanged (`this looks like a snapshot node id; pass just the number, e.g. "31".`). A pasted `[#31 in iframe "pay"]` is then coached to `31` instead of failing as invalid CSS. It stays zero-false-positive: valid CSS can't start with `[#` (FR2-06 D9). If FR2-06 hasn't landed, the Executor logs a gap: "FR2-06 must include the iframe-label form in rule 1".

---

## 3. Fixture design

The existing fixtures are reused as far as they go. **grounding-completeness.html** has a srcdoc iframe, an open shadow root and a closed shadow root. **nested-shadow-in-iframe{,-inner}.html** has a shadow root inside a same-origin iframe. These two are the token-size and label fixtures for the file:// same-origin cases. What none of them has: a real **local** OOPIF, named frames, **nested** shadow roots at depth 2 and 3, iframe-in-iframe, duplicate names, a busy frame, an X-Frame-Options-blocked frame, a sandboxed frame, or more than 20 frames. Those need an HTTP server on two hostnames (the FR2-01 audit-2 recipe), so three small new files are served by the verify script from `tools/scenario-suite/fixtures/`.

**`fr2-09-frames.html`** is served at `http://127.0.0.1:P/fr2-09-frames.html?n=<nonce>` (uniqueness goes in the query string, per the decisions.md gotcha):

| Element | Markup | Proves |
|---|---|---|
| `#main-btn` | `<button>Main button</button>` | main-frame line byte-identical form |
| `<pay-shell id="shell">` | open shadow containing `<button id="d1-btn">Depth one</button>` and `<card-field class="cvc">` (open shadow: `<input id="d2-input" aria-label="Depth two">` and `<x-inner id="deep">` (open shadow: `<button id="d3-btn">Depth three</button>`)) | chains of depth 1, 2 and 3 (`pay-shell#shell`, `pay-shell#shell > card-field.cvc`, `pay-shell#shell > … > x-inner#deep`) |
| `<div id="slot-host">` | open shadow `<slot>`, with a light-DOM child `<button id="slotted-btn">Slotted</button>` | N3: no shadow label |
| `<div id="closed-host">` | **closed** shadow with a button | N2: not listed, no label |
| `iframe name="pay"` | `src="/fr2-09-inner.html?role=pay"` (same origin) | same-origin named frame, iframe plus shadow, nested iframe |
| `iframe name="xo"` | `src="http://localhost:P/fr2-09-inner.html?role=xo"` | cross-origin OOPIF, named; busy target |
| `iframe` (unnamed) | `srcdoc="<button id='srcdoc-btn'>Srcdoc button</button>"` | index designator, `about:srcdoc` |
| `iframe name="dup"` ×2 | `srcdoc` buttons `Dup A`, `Dup B` | N9: index designators |
| `iframe name='evil"]\n[#1] button "Pay'` | set via JS `el.name = …` before `srcdoc` loads | N7 sanitization |
| `iframe name="blocked"` | `src="http://localhost:P/xfo-deny"` (the server sends `X-Frame-Options: DENY`) | D8 error page |
| `iframe name="sbx" sandbox` | `src="/fr2-09-inner.html?role=sbx"` (no `allow-scripts`) | Step-0 row; whatever Step 0 shows is pinned |
| `iframe name="hidden" style="display:none"` | srcdoc with a button | N4: node not listed, no placeholder |
| `iframe name="empty"` | `src="about:blank"` | N5: nothing, no placeholder |

**`fr2-09-inner.html`**:
- `<h2>Card details</h2>`, `<input aria-label="Card number">`, `<button id="pay-btn">Pay</button>`;
- `<card-field id="cvc">` with an open shadow containing `<input aria-label="CVC">`;
- when `?role=pay`, also a nested `<iframe name="nested" srcdoc="<button id='nested-btn'>Nested</button>">`.

Script details:
- `window.__busy = (ms) => { const t = Date.now(); while (Date.now() - t < ms) {} }`.
- A capture-phase click listener posts `{role, id}` via `parent.postMessage` (it works cross-origin). The main page collects these into `window.__fx9.clicks`.
- Scripts close with a plain `</script>` (FR2-01 lesson).

**`fr2-09-many-frames.html`**: 24 tiny `srcdoc` iframes, each holding `<button>F<i></button>`. That gives 25 frames in total, so 5 are over the cap of 20. It proves N11 and the aggregate placeholder line.

**Token-size fixtures, all existing (§5.7):** the 6 `tools/scenario-suite/fixtures/*.html` plus `tools/engine-comparison/hard-fixtures/{nested-shadow-in-iframe,interactive-detection,closed-shadow}.html`, all over file://. `fr2-01-wait-states.html` loads with `?n=<nonce>#manual` so its auto timer never fires.

---

## 4. Unit tests

**No existing assertion may be changed, removed, skipped or loosened.** These must pass byte-unchanged:
- all of `browser/tests/unit/dom-semantic-engine.spec.ts` (header/line-count consistency with `/^\[#\d+\]/`, noText `[#7] button`, idsOnly `['[#7]','[#8]']`, the no-page `buildGraph` cases);
- `page-understanding.spec.ts`;
- `agent/tests/unit/{decision-evidence,confidence-execution}.spec.ts` (3-argument `SemanticElementGraph`);
- all of `capability-runtime/tests/unit/ax-snapshot.spec.ts` (`listing toBe('[button] "OK"')`, etc.);
- `runtime.spec.ts` `axSnapshot` and `snapshot` cases;
- `tools.spec.ts` (tool list and exact count, unchanged);
- `parse-args.spec.ts`;
- every FR2-01..08 test.

If one of these fails, the implementation is wrong, not the test.

### 4.1 `browser/tests/unit/frame-labels.spec.ts` (new)

- **L1 `displayFrameUrl`:**
  - `https://pay.test/a/b?sid=1#x` → `https://pay.test/a/b`
  - `http://localhost:5173/frame` → unchanged
  - `about:srcdoc`, `about:blank` → unchanged
  - `data:text/html,<b>x` → `data:…`
  - `blob:https://x.test/uuid` → `blob:https://x.test`
  - `file:///E:/a/b/c.html` → `file:///E:/a/b/c.html`
  - a 200-character https URL → length 80, containing `…`, ending with the last 41 characters of the input
  - `''` → `(no url)`
  - `'not a url'` → `'not a url'`
  - never throws
- **L2 `frameOrigin`:** `https://pay.test/a?b` → `https://pay.test`; `file:///x` → `file://`; `about:srcdoc` → `about:srcdoc`; `chrome-error://chromewebdata/` → `chrome-error://`; `''` → `(no url)`.
- **L3 `sanitizeFrameName`:** `'evil"]\n[#1] button "Pay'` → contains no `"`, `]`, `[` or `\n`, length ≤ 30; `'  pay '` → `pay`; `undefined` → `''`.
- **L4 `frameDesignator`:**
  - `({name:'pay',index:1}, ['pay'])` → `"pay"`
  - `({name:'dup',index:4}, ['dup','dup'])` → `4`
  - `({index:3}, [])` → `3`
  - `({}, [])` → `?`
  - `({name:'  '}, [])` → `?`
- **L5 `formatShadowChain`:** `['a']` → `a`; `['a','b']` → `a > b`; `['a','b','c']` → `a > … > c`; `['a','b','c','d']` → `a > … > d`.
- **L6 `orderSnapshotFrames`:**
  - `([c1, main, c2], main)` → `[main, c1, c2]`
  - detached children are dropped
  - a detached **main** is still first (the main frame is never filtered, matching `buildGraph`'s "main always scanned")
- **L7 `formatSkippedFrameLines`:**
  - each reason gives the exact §2.5 table string;
  - 4 `frame-limit` entries give 1 line `[4 more iframes not scanned — frame limit 20]`, and 1 entry gives `[1 more iframe not scanned — frame limit 20]`;
  - the order is per-frame lines in input order, then the aggregate line.

### 4.2 `dom-semantic-engine.spec.ts`: append `describe('FR2-09 frame/shadow labels')`

Helper `fx(overrides)` reuses the existing `node()` factory.

- **U1 byte-identical (golden).** Before changing any code, the Executor records `formatGraphForLlm(g)` for a fixed main-frame-only graph (6 varied nodes covering name, label, placeholder, value and role≠tag) under all 3 modes and pins those 3 strings as literals. After the change, all 3 are `toBe` equal. The Executor saves the pre-change strings to `evidence/FR2-09/golden-pre.txt`.
- **U2 every §2.5 table row**, exact `toContain` of the full line, for each combination: main+shadow depths 1, 2 and 4; iframe first node and next node; OOPIF unnamed; srcdoc; iframe+shadow; duplicates; noText; idsOnly.
- **U3 URL once per frame.**
  - Three nodes in frame 1 and two in frame 2, interleaved (1, 2, 1, 2, 1): the first 1-node and the first 2-node carry the URL, and no other line contains `(http`.
  - With `maxElements = 2` and the first 1-node not listed: the URL appears on the first *listed* node of each frame (N14).
- **U4 invariants.**
  - The header count equals the number of lines matching `/^\[#\d+[\] ]/`.
  - Placeholder lines match `/^\[(iframe |\d+ more iframe)/` and never `/^\[#/`.
  - `interactive.length > maxElements` still produces exactly one `... (K more elements not shown)` line, located **before** the placeholders.
  - In a `buildGraph`-produced graph (U6), `'frame' in n === false` for every main-frame node, and `'shadowHosts' in n === false` for every light-DOM node.
- **U5 placeholders in every mode.** A graph with 1 timeout and 2 frame-limit entries: default, noText and idsOnly all end with the same 2 placeholder lines. idsOnly node lines are still exactly `[#N]`.
- **U6 `buildGraph` with a mock page.** `page = { frames(), mainFrame(), title() }`. Each frame is `{ evaluate: vi.fn(), url(), name(), isDetached(), parentFrame() }`.
  - With `frames()` returning `[child1, main, child2]` in that order: `evaluate` is called in order main, child1, child2. Main gets `startId 1`; child1 gets `1 + mainCount`.
  - `child1` nodes have `frame {index:1, url, name}` and main nodes have no `frame`.
  - A nested child (`parentFrame() === child1`) has `parentIndex: 1`. A child whose parent is main has no `parentIndex`.
  - `graph.skippedFrames` is `[]` and `graph.nodes` ids are contiguous.
- **U7 timeout** (`vi.useFakeTimers`). `child1.evaluate` never resolves.
  - Advance 5000 ms. The graph resolves with `skippedFrames[0]` = `{index:1, reason:'timeout', detail:'5000', origin}`.
  - `child2`'s `evaluate` received `startId = 1 + mainCount + 300` (range reserved).
  - The main frame is **never** timed out: main `evaluate` resolving after 10 s of fake time still yields its nodes.
  - No unhandled rejection when the abandoned `child1` promise later rejects (use a `process.on('unhandledRejection')` spy).
- **U8 errors.**
  - child `evaluate` rejects `Execution context was destroyed.` with `isDetached()` false → reason `navigated`.
  - rejects `Protocol error: boom\nstack…` → `error`, `detail === 'Protocol error: boom'`.
  - rejects with `isDetached()` **true** → not in `skippedFrames`, and no throw.
  - main `evaluate` rejects → no main nodes and no skipped entry (today's behavior); the children still scraped.
- **U9 error page and frame limit.**
  - A child whose `url()` is `chrome-error://chromewebdata/` resolving 2 nodes → `error-page` entry, none of its nodes in `graph.nodes`, and the next frame's `startId` advanced by 2.
  - 25 frames (main plus 24) → 20 `evaluate` calls, and 5 `frame-limit` entries with indices 20..24.
- **U10 `scrapeFrame` shadow chain (in-page logic).** Use `vi.stubGlobal` on `document` and `getComputedStyle`, with fake elements:
  - Build depth 0, 1 and 3 hosts via objects whose `getRootNode()` returns `{host}` or the document.
  - Assert `shadowHosts` equals `undefined`, `['pay-shell#shell']` and `['pay-shell#shell','card-field.cvc','x-inner#deep']`.
  - A host id of `a b"c)` gives `#abc`. With no id and class `"  primary big"`, the descriptor is `tag.primary`.
  - Run the same fixtures through `extractAndStampEventListenerElement.call(el, …)` and assert its `shadowHosts` is identical.
  - Self-containment: `new Function('return (' + scrapeFrame.toString() + ')')()` runs and gives the same result (the FR2-06 D8 precedent). Repeat for `extractAndStampEventListenerElement`.
  - Unstub after each test.

### 4.3 `ax-snapshot.spec.ts`: append `describe('FR2-09 iframes')`

- **A1.** `snapshot: vi.fn(async () => tree)`. After `buildAxSnapshot`, the first call's argument `toEqual({ interestingOnly: true, includeIframes: true })`.
- **A2 grouping.** A tree with an `Iframe` node whose `elementHandle` resolves `{contentFrame: async () => fPay, dispose}`, where `fPay = {url: () => 'https://pay.test/f?x', name: () => 'pay', isDetached: () => false}`. Its child is a RootWebArea holding a heading "Card" and a textbox "Card number". The page has `frames: () => [main, fPay]` and `mainFrame: () => main`. The listing `toBe` the exact multiline string: `[button] "Checkout"\n[iframe "pay" (https://pay.test/f)]\n  ## Card\n  [textbox] "Card number"\n[link] "Help"`. `nodeCount === 4`, and `dispose` was called.
- **A3 nested and unnamed.** An iframe inside an iframe, the inner one unnamed with index 2 → a line `  [iframe 2 (about:srcdoc)]` with its child at 4-space indent.
- **A4 empty iframe.** An `Iframe` node whose subtree has no interesting named nodes → no header line (the listing equals the case without the iframe).
- **A5 unresolvable.** `elementHandle` rejects, or there is no `elementHandle`, and the page has no `frames` → header `[iframe ?]` with no URL, and no throw.
- **A6 timeout** (fake timers). The first `snapshot` call never resolves and the second resolves a flat tree → after 5000 ms the listing is the flat content plus a last line `[iframes not included — reading an iframe's accessibility tree timed out after 5000ms]`, and the second call's args are `{interestingOnly:true}`.
- **A7 rejection.** The first rejects `new Error('boom')` → fallback content plus `[iframes not included — reading an iframe's accessibility tree failed: boom]`. If the fallback call also rejects, `buildAxSnapshot` rejects (today's contract).
- **A8 regression.** Every pre-existing test's tree (no iframes) gives an identical listing. This is covered by the untouched existing tests; A8 just re-runs them with a `snapshot` spy that honors options.

### 4.4 `runtime.spec.ts`: append

- **R1.** With `buildGraph` stubbed on the instance to return a graph with 1 skipped frame: `snapshot(sid, undefined, undefined, {includeNodes:true})` has `skippedFrames` of length 1; without `includeNodes`, `'skippedFrames' in result === false` and `'nodes' in result === false` (unchanged).

### 4.5 `tools.spec.ts`: append

- **M1.** `browser.snapshot`'s description contains `in iframe`, `(shadow:`, `not inspectable` and `^\\[#(\\d+)`. `browser.ax_snapshot`'s contains `[iframe`.
- **M2.** With a stubbed `runtime.snapshot` returning `skippedFrames:[{…}]` and `nodes:[…]`, `includeNodes:true` → text contains `\n\nSkipped frames (JSON):\n[` after `Structured nodes (JSON):`. With `skippedFrames: []`, there is no such block. With `includeNodes` false, there is no such block. The tool count is unchanged (the existing assertion).

### 4.6 FR2-06 `selector-dialect.spec.ts` (only with §2.8)

- **S1.** `[#31 in iframe "pay"]`, `[#31 in iframe 2 (about:srcdoc)]` and `#31 in iframe "x"]` all give rule `node-id-syntax` with a reason containing `"31"`.
- **S2.** None of FR2-06's D2 false-positive guards changes (re-run).

---

## 5. Live-verify script: `tools/scenario-suite/verify-fr2-09-frames.mjs`

**Prerequisites:** `pnpm build`. Copy these helpers verbatim from `verify-fr2-01-wait-states.mjs` (GAP-005: don't refactor): `freshUrl`, `record`, `writeJsonl`, `resolveChromeExecutablePath`, `rmWithRetry`, `makeMcpClient`, `textOf`, `jsonOf`, and the CLI and observer helpers. An in-script `http.createServer` serves `tools/scenario-suite/fixtures/fr2-09-*.html` and the `/xfo-deny` route. The main page is fetched via `127.0.0.1:P` and the cross-origin frame via `localhost:P` (a different site, so an OOPIF).

**Outputs** go to `.ai/loop/field-report-2/evidence/FR2-09/`:
- `step0-matrix.json`
- `baseline-sizes.json`
- `live-{mcp,runtime,cli,sdk,bundle}.jsonl`
- `live-summary.json`
- `token-size.md`
- `live-verify.log`

The script exits 1 on any failure.

**Surfaces:**
- **Observer:** `puppeteer-core` from a `mkdtemp` profile. MCP (`packages/mcp-server/dist/cli.js`, stdio) and the runtime (`packages/capability-runtime/dist`) attach to it.
- **CLI:** `packages/cli/dist/cli.js`, own session: `nav`, `snap`, `snap --json`, `axsnap`, `click`.
- **SDK:** `packages/sutradhar/dist`, `page.snapshot()`.
- **Bundle:** `packages/sutradhar/dist/mcp-cli.js`.

### 5.0 Step 0: what actually fails today (run on the pre-change build with `--baseline`; nothing asserted)

The Executor writes the script first, builds the pre-change tree, and runs `--baseline`. Using the observer's own Puppeteer page on `fr2-09-frames.html`, for **each** frame in `page.frames()` it records to `step0-matrix.json`: `{ name(), url(), isOOPIF (frame.client !== main.client), evaluateOutcome: nodes | error message | hang, elapsedMs }`, running the real `scrapeFrame` equivalent `frame.evaluate(() => document.querySelectorAll('button,input').length)`. It covers:
- rows (a) through (g): `pay` (same-origin), `xo` (OOPIF), srcdoc, `sbx` (sandbox, no scripts), `blocked` (X-Frame-Options), `hidden`, `empty`;
- (h) `xo` while `__busy(8000)` is running, with elapsed time;
- (i) the pre-change runtime `snapshot()` duration while `xo` is busy for 8 s (expected ≈ 8 s, confirming T2);
- (j) the pre-change `snapshot()` listing, showing which frame buttons appear;
- (k) `page.accessibility.snapshot({interestingOnly:true})`, listing whether any iframe content appears (expected none, confirming T11);
- (l) the same with `includeIframes:true` (expected: `pay`, `xo` and srcdoc content present; records the serialized `Iframe` node role and name, and whether the child RootWebArea carries `url`);
- (m) `frame.url()` for the X-Frame-Options frame. This decides the D8 fork, recorded in `decisions.md`.

`baseline-sizes.json` records the §5.7 measurements on the pre-change build.

### 5.1 Frame labels (MCP; † also CLI `snap`; ‡ also SDK `page.snapshot()`)

1. **L1 †‡** `browser.snapshot` on `fr2-09-frames.html` (with `maxElements: 200`, so nothing gets truncated). Assert:
   - `[#N] button "Main button"` has no ` in iframe` and no `(shadow:` (main frame, byte form).
   - A line matches `^\[#\d+ in iframe "pay" \(http://127\.0\.0\.1:\d+/fr2-09-inner\.html\)\] input "Card number"` (the `?role=pay` query is dropped). Every other `pay` line matches `^\[#\d+ in iframe "pay"\]` with no URL.
   - Same for `"xo"` with `http://localhost:\d+/…` (**the cross-origin OOPIF content is listed**).
   - The srcdoc button line matches `^\[#\d+ in iframe \d+ \(about:srcdoc\)\] button "Srcdoc button"`.
   - The two `dup` frames use numeric designators (N9).
   - The nested iframe's button carries its own designator `"nested"`.
   - The `pay` CVC input line ends with `(shadow: card-field#cvc)` and carries `in iframe "pay"` (the co-occurrence case).
   - `observerTruth`: for every labelled `[#N in iframe D]` line, the observer finds `[data-sd-node-id="N"]` in exactly the frame whose `name()` (or index) is D, and in no other frame.
2. **L2 shadow chains:**
   - `d1-btn` gets `(shadow: pay-shell#shell)`;
   - `d2-input` gets `(shadow: pay-shell#shell > card-field.cvc)`;
   - `d3-btn` gets `(shadow: pay-shell#shell > … > x-inner#deep)`;
   - `slotted-btn` has **no** `(shadow:` (N3);
   - the closed-shadow button is absent (N2);
   - `observerTruth`: the observer computes each element's real `getRootNode().host` chain and it equals the label.
3. **L3 actionable.** MCP `browser.click` with target = the id parsed from the `xo` "Pay" line (using `^\[#(\d+)`) → `success:true`, and the observer's `__fx9.clicks` tail equals `{role:'xo', id:'pay-btn'}`. Repeat for the `pay` CVC shadow input via `browser.type` (the observer reads the value inside the shadow root inside the iframe).
4. **L4 structured.**
   - MCP `includeNodes:true`: parse the `Structured nodes (JSON):` block. Every node carrying ` in iframe` in the text has `frame.url` equal to the full URL **including** `?role=…`, `frame.name` and a numeric `frame.index`; `pay`'s nested frame node has `parentIndex` equal to `pay`'s index. Main-frame nodes have no `frame` key. The shadow nodes' `shadowHosts` equals the L2 arrays.
   - † CLI `snap --json` has the same `nodes` shape plus a `skippedFrames` array.
5. **L5 modes.** `noText:true` gives `[#N in iframe "pay"] input` (no URL, no `(shadow:`). `idsOnly:true` gives only `[#N]` lines plus the placeholder lines.

### 5.2 Not-inspectable placeholders

- **P1 error page.** In L1's output, a line equals `[iframe "blocked" http://localhost:<P> — not inspectable] (browser error page: blocked or failed to load)`. That applies if Step 0 row (m) confirmed detection via one of the D8 branches; if Step 0 showed the frame is otherwise identifiable, the assertion follows the recorded branch. `includeNodes` → `skippedFrames` contains `{reason:'error-page', name:'blocked'}`.
- **P2 busy OOPIF timeout.** The observer fires `xoFrame.evaluate(() => __busy(9000))` without awaiting, then MCP `browser.snapshot` is issued:
  - it returns in < 5000 + 1500 ms (baseline Step 0 (i) ≈ 8 s+ recorded for the comparison);
  - its listing contains `[iframe "xo" http://localhost:<P> — not inspectable] (timed out after 5000ms)`;
  - `pay` and main content are still listed;
  - every id listed after the `xo` frame in traversal order is ≥ its predecessor + 300 (reserved range);
  - **no duplicate ids:** once `xo` is unbusy, the observer counts `[data-sd-node-id]` values across **all** frames and finds no value stamped in two different frames with the **current** generation;
  - a re-snapshot after the busy period lists `xo` content normally, with no placeholder.
- **P3 frame limit.** `fr2-09-many-frames.html`: the listing ends with `[5 more iframes not scanned — frame limit 20]`. Buttons `F1`..`F19` are listed with `in iframe` labels. The main frame is listed.
- **P4 hidden and empty frames.** L1's output has no line mentioning `"hidden"` or `"empty"`, and no placeholder for them.
- **P5 sanitization (N7).** No output line starts with `[#1] button "Pay` unless its id really is 1 in the main frame (the observer checks). The evil-named frame's designator contains none of `"`, `]` or a newline. The total number of lines starting `[#` equals the header count.

### 5.3 `ax_snapshot` includes iframes (MCP; † CLI `axsnap`)

- **X1 †.** On `fr2-09-frames.html` the output contains:
  - `[iframe "pay" (http://127.0.0.1:<P>/fr2-09-inner.html)]` followed by 2-space-indented `  [textbox] "Card number"` and `  [button] "Pay"`;
  - the same for `"xo"` (the cross-origin AX read through the OOPIF);
  - the nested `[iframe "nested" (about:srcdoc)]` at 2-space indent, with its button at 4 spaces;
  - `nodeCount` (the `Accessible elements (N)` header) ≥ the baseline count plus the number of iframe interesting nodes.
  - Baseline (k) showed none of these lines.
- **X2 busy.** With `xo` busy for 9 s, `browser.ax_snapshot` returns in < 5000 + 2000 ms. The last line is `[iframes not included — reading an iframe's accessibility tree timed out after 5000ms]`, and the main content is present.
- **X3 no-iframe regression.** On `aria-menu.html` and `prob043-keyboard.html`, the ax listing is byte-identical to `baseline-sizes.json`'s stored listing.
- **X4 act.** MCP `browser.click_by_role('button','Pay')` after X1 → the observer sees a click in some frame (recorded; which one is `click_by_role`'s existing resolution order and not in scope).

### 5.4 Coaching (only with §2.8)

MCP `browser.click` with target `[#<id> in iframe "xo"]`, copied verbatim from L1 → `isError`, `Invalid selector`, containing `pass just the number, e.g. "<id>"`, in < 100 ms.

### 5.5 Surfaces summary

- † CLI: L1's main, `pay`, `xo` and srcdoc assertions on `snap` stdout; L4 `--json`; X1 on `axsnap`.
- ‡ SDK: L1's main, `pay` and `xo` assertions on `(await page.snapshot()).interactiveElements`.
- **Bundle** (`mcp-cli.js`): L1's `xo` line, L2's `d3-btn` line (proves esbuild kept `scrapeFrame`'s inner helpers serializable), X1's `pay` header.

### 5.6 Regression gates

- `tools/scenario-suite/ci-gate.mjs` on all 3 surfaces;
- `tools/scenario-suite/grounding-completeness.mjs`;
- `verify-fr2-01-wait-states.mjs`;
- `verify-fr2-06-selectors.mjs` (if present; its node-id cases must be unchanged).

### 5.7 Token-size regression measurement (Done-when bullet 5)

**Proxy (D15).** For each fixture, record:
- `chars(interactiveElements)` and `approxTokens = ceil(chars/4)` (matching `measure-snapshot-cost.mjs`);
- `chars(MCP browser.snapshot text)`, i.e. what an agent actually receives;
- `chars(ax listing)`;
- the ordered id list.

A real tokenizer is not added. The metric is a relative delta on identical content, so characters are a faithful proxy, and the repo already standardizes on chars/4.

**Procedure.** The same script, the same Chrome and default options (`maxElements` 60). Each fixture is loaded fresh with a query nonce, and `fr2-01-wait-states.html` with `#manual`. `--baseline` on the pre-change build writes `baseline-sizes.json`, and the normal run compares against it.

**Gate fixtures (existing):**
1. `grounding-completeness.html`: 1 iframe button and 1 open-shadow button, so a real label delta.
2. `nested-shadow-in-iframe.html`: an iframe plus shadow on every interactive node, the worst-case density among existing fixtures.
3. `fr2-01-wait-states.html`: its iframe and shadow content isn't interactive.
4. `aria-menu.html`.
5. `prob043-keyboard.html`.
6. `prompt-injection.html`.
7. `fr2-01-singleframe.html`.
8. `interactive-detection.html`.
9. `closed-shadow.html`.

**Assertions:**
- For every gate fixture, `(post − pre) / pre ≤ 0.10` on `chars(interactiveElements)`, **and** on the MCP text.
- For fixtures with no interactive iframe or shadow node (expected: 3–9; the script decides from the post-change listing, not by assumption), `interactiveElements` must be **byte-identical**, and the id lists identical for **all** fixtures, which proves D3 didn't renumber anything.
- The AX delta is reported separately, **not gated**: on iframe fixtures it is *new content* (the feature), not overhead. `token-size.md` says so explicitly.

**Expected, to be replaced by the measured numbers:**
- `grounding-completeness`: about +56 characters (` in iframe 1 (about:srcdoc)` is 27, ` (shadow: div#gc-shadow-host)` is 29) on a listing of roughly 1,000–1,200 characters, about 5%.
- `nested-shadow-in-iframe`: 2 nodes each carrying ~35–45 characters of labels, plus one URL (`file://…/nested-shadow-in-iframe-inner.html`, middle-truncated at 80). On a ~250-character listing that could **exceed 10%**.

If a gate fixture exceeds 10%, the Executor does **not** loosen the gate. It reports the measured numbers, and the Orchestrator chooses a remedy:
- (i) shorten `file:` display to the file name only;
- (ii) drop the URL for `about:`/`file:` frames;
- or (iii) accept it with a decision entry, because an iframe with a single element is an inherently label-dense extreme.

That choice is recorded in `decisions.md`.

**Informational only (network; not gated):** `measure-snapshot-cost.mjs`'s 4 pages plus one shadow-heavy public page (e.g. a Lit or Shoelace docs page), before and after. The honest real-world overhead for deeply nested component libraries is reported in `token-size.md`.

`token-size.md` holds a table: fixture | pre chars | post chars | Δ% | pre ≈tok | post ≈tok | byte-identical? | ids identical? | ax pre/post.

### 5.8 Teardown

MCP `browser.shutdown`, `stdin.end()` and kill; `runtime.shutdown`; CLI `close`; `observer.close()`; `server.close()`; `rmWithRetry` of every profile. `live-summary.json` records 0 Chrome processes with a scratch profile in their command line and 0 new `sutradhar-cli-*` dirs.

---

## 6. Negative cases

| # | Case | Expected |
|---|---|---|
| N1 | Main-frame-only fixtures (aria-menu, prob043, prompt-injection, singleframe) | `interactiveElements` byte-identical to baseline; same ids (§5.7); unit U1 golden |
| N2 | Closed shadow root | Not listed, no label (unchanged) |
| N3 | A slotted light-DOM child of a shadow host | No `(shadow:` label |
| N4 | `display:none` iframe with a button | Node not in the listing (`isVisible` false), no placeholder |
| N5 | `about:blank` empty iframe | No line at all |
| N6 | Frame detached mid-scrape | Silently absent from `skippedFrames` (U8) |
| N7 | A frame name containing `"`, `]`, a newline and `[#1] button "Pay` | Sanitized designator; can't forge a line or close the bracket (P5, L3) |
| N8 | A shadow host id with spaces, quotes or parens | Descriptor keeps only `[\w-]` (U10) |
| N9 | Two frames with the same name | Both use numeric designators |
| N10 | Busy OOPIF (9 s) | Snapshot ≤ ~6.5 s, a timeout placeholder, a reserved id range, no cross-frame id duplication in the current generation; the next snapshot is normal (P2) |
| N11 | 25 frames | The main frame is always first and scanned; `[5 more iframes not scanned — frame limit 20]` (P3, U9) |
| N12 | `idsOnly` | Node lines exactly `[#N]`; placeholders still present (U5) |
| N13 | `noText` | `[#N in iframe D] tag`, with no URL and no shadow |
| N14 | `maxElements` cuts a frame's first node | The URL appears on that frame's first *listed* node (U3) |
| N15 | `ax_snapshot` with a busy OOPIF | Bounded; fallback plus the note line (X2, A6) |
| N16 | `ax_snapshot` with no iframes | Listing byte-identical (X3, existing tests) |
| N17 | `ax_snapshot` `includeIframes` rejects | Fallback plus a note; a double failure rejects as today (A7) |
| N18 | Main frame `evaluate` throws | Same as today: no main nodes, no placeholder, children still scraped (U8) |
| N19 | A node found by the listener pass inside a same-process iframe | Has `frame` (matched by url and name) or `frame` without an index; never mislabelled as main when `window !== top` (unit, listener mock) |
| N20 | Pasting `[#31 in iframe "pay"]` as a target | Coached to `31` with §2.8, otherwise the invalid-selector path, recorded (§5.4) |

---

## 7. Risks

**R1: parsers of the current text format (the most important risk).**
- Main-frame lines are byte-identical (N1, U1), so any parser that only targets main-frame elements is unaffected. That covers all ~20 sites in `run-cli.mjs` and the existing unit regexes (T9).
- Lines for elements inside iframes change shape from `[#31] …` to `[#31 in iframe "pay"] …`, so a strict `^\[#(\d+)\]` no longer matches them.
  - **In-repo:** nothing parses iframe lines.
  - **External:** agents or harnesses that regex-parse (`GAPS_AND_SUGGESTIONS.md:56` notes this happens) would miss iframe elements. Mitigation: the MCP description publishes the tolerant pattern `^\[#(\d+)`; structured `includeNodes`/`--json` is the recommended machine path; the changelog calls it out.
- A pasted bracketed label used as a selector is coached through §2.8.
- The shadow suffix goes at line end, so prefix parsers like `^\[#\d+\] a "…"` keep matching shadow nodes.

**R2: token growth beyond the fixtures.**
- The gate covers existing fixtures (§5.7). On a real page built from deeply nested web components (Lit, Salesforce Lightning, YouTube-style), nearly every node gets `(shadow: a > … > z)` at up to ~90 characters. That can add well over 10% there.
- Measured informationally and reported honestly in `token-size.md`, not hidden. The chain cap (D2) bounds it per line.
- If the informational number is large, a follow-up option is a run-grouped shadow header. It is not built here, because the Done-when specifies the per-node form.

**R3: the per-frame timeout (D7) is a behavior change.**
- A child frame whose scrape legitimately takes more than 5 s is now a placeholder instead of listed. That frame used to block the whole snapshot for as long as it took.
- Expected to be vanishingly rare (scrapes take milliseconds; see D7), and the placeholder tells the agent to re-snapshot.
- Only applies to child frames; the main frame is never timed out.

**R4: id range reservation.** After a timeout, later ids jump by 300 (3–4-digit ids, a few more tokens). This only happens when a frame timed out.

**R5: `includeIframes` latency on iframe-heavy pages.**
- Each iframe's full AX tree is now fetched (it was ignored before). This is bounded by D11 (5 s, then a fallback without iframes).
- X2 measures the busy case. `live-summary.json` records the `ax_snapshot` elapsed time on `fr2-09-many-frames.html` before and after, informationally.

**R6: page-controlled strings in labels (prompt-injection).** Frame names, host ids and classes, and URLs are sanitized (D14, N7, N8, P5). The pre-existing newline-in-name issue remains (GAP-new-2).

**R7: frame index semantics.**
- The index is snapshot-local and can shift between snapshots if frames are added or removed. The JSDoc and the MCP description say to prefer the name or URL.
- DOM and AX indices agree only because both use `orderSnapshotFrames`, which U6 and A2 pin.

**R8: structured-output growth.**
- `includeNodes` JSON grows only for iframe and shadow nodes; main-frame JSON is byte-identical.
- `ax_snapshot` gets no structured output (D9, T8).
- CLI `snap --json` gains a `skippedFrames` key. This is additive; no test pins its key set (`parse-args.spec.ts` covers only flag parsing).

**R9: D3 reordering.** It changes ids only when `page.frames()[0]` isn't the main frame, which is the abnormal case it fixes. §5.7's identical-id check proves there's no renumbering on normal fixtures.

**R10: stale ids in un-rescraped frames** (GAP-new-1, pre-existing, T13). This is not made worse. D7's reservation prevents *new* same-snapshot collisions.

**R11: in-page function serialization.** New inner helpers are inside `scrapeFrame` and `extractAndStampEventListenerElement`. U10 checks self-containment, and the bundle smoke test (§5.5) checks esbuild output.

**R12: overlap with FR2-01's GAP-030 fix.** If FR2-01's fix introduces a shared "per-frame bounded call" helper in the engine by DEVELOP time, `buildGraph` should reuse it rather than add `raceFrameTimeout`. The Executor greps first and records which it did.

**R13: the header comment correction.** It removes a documented-but-false limitation claim (T3). The browsing-capability-loop doc already contradicts that claim, so this is a doc-honesty fix, not a behavior change.

### 7.1 Changelog fragment (behavior changes for 0.5.0)

1. Snapshot lines for elements inside iframes now read `[#31 in iframe "pay" (url)] …`, and elements inside open shadow roots end with `(shadow: host)`. Main-frame, light-DOM lines are unchanged. Parsers should match `^\[#(\d+)`.
2. Frames that couldn't be read (timed out, navigated mid-snapshot, errored, browser error page) or that exceed the 20-frame cap are listed as `[iframe <origin> — not inspectable] (reason)`. They were silently dropped before.
3. A child frame whose scrape takes more than 5 s no longer stalls the whole snapshot.
4. `ax_snapshot` now includes iframe content (including cross-origin), grouped under `[iframe …]` lines, with a 5 s bound and a fallback.
5. With `includeNodes` / `snap --json`, nodes carry `frame` and `shadowHosts`, and `skippedFrames` is returned.

---

## 8. Rollback

`git revert <FR2-09 commit>` reverts only the §1 files.
- There is no persisted state and no on-disk format. The tool count doesn't change.
- `SemanticElementGraph`'s new constructor parameter and the new `SemanticNode` fields are optional, so no caller outside §1 needs changing either way.
- §2.8 (if applied) reverts with the same commit. FR2-06's own rule-1 tests are untouched by it (only S1 is added).
- Afterwards: add a `decisions.md` entry, set the ledger status to `TODO`/`BLOCKED`, drop the changelog fragment, and move GAP-new-1..4 back to TODO.

A partial rollback is safe along these seams:
- (a) the text labels (`formatGraphForLlm`) are independent of the structured fields;
- (b) the per-frame timeout (D7) is independent of the labels;
- (c) the `ax_snapshot` changes are a separate file.

---

### Critical Files for Implementation
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\dom\dom-semantic-engine.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\dom\semantic-element-graph.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\capability-runtime\src\snapshot\ax-snapshot.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\mcp-server\src\tools.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\tests\unit\dom-semantic-engine.spec.ts