# S4 call-site inventory (every call in packages/*/src of a method that can throw synchronously)

Source: `sites.txt` (207 keys, `list-sites.mjs`); methods: `sync-throw-methods.txt`. Columns: file:line:col | receiver type | SAFE/UNSAFE | reason.
SAFE = a synchronous throw ends up in exactly the handling a rejection of the same call gets. UNSAFE = it escapes that handling.
Totals: SAFE 196, UNSAFE 11, UNCLASSIFIED 0.

| key | receiver | class | reason |
|---|---|---|---|
| packages/agent/src/core/agent-loop.ts:686:32 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/agent/src/core/block-detector.ts:22:27 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:120:71 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:527:19 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:657:26 | Frame | SAFE | inside probeSelectorSyntax's try/catch (returns null = "can't run" outcome); nothing was abandoned before the throw |
| packages/browser/src/actions/browser-action-engine.ts:853:89 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:916:79 | non-Puppeteer (Keyboard/Mouse) | SAFE | Keyboard/Mouse method: async, CDP-session based, not throwIfDetached |
| packages/browser/src/actions/browser-action-engine.ts:950:38 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:958:23 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:967:37 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:968:44 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:987:34 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:990:19 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:999:33 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:1000:38 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:1140:61 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1145:36 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1175:53 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1186:31 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:1212:21 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1223:23 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1224:23 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1226:39 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1255:57 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1307:44 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1569:18 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1579:19 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:1592:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1611:77 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:1649:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1650:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1651:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1661:19 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1663:19 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1663:56 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1729:9 | Frame | UNSAFE | `.catch(() => null)` is chained on the call: the synchronous throw happens before there is a promise (single-frame path) |
| packages/browser/src/actions/browser-action-engine.ts:1742:7 | Frame | UNSAFE | `.catch(() => null)` chained on the call: sync throw escapes (head start) |
| packages/browser/src/actions/browser-action-engine.ts:1774:11 | Frame | UNSAFE | `.catch(() => null)` chained on the call: a frame captured at pass start can detach while an earlier frame is probed (kayak churn) |
| packages/browser/src/actions/browser-action-engine.ts:1900:44 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:1911:23 | Frame | SAFE | first statement of async raceFrameProbe: the sync throw is a rejection of raceFrameProbe, which its only caller pierceFirstMatch wraps in try/catch (same handling as a rejected $); no promise or timer exists yet to abandon |
| packages/browser/src/actions/browser-action-engine.ts:1994:14 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2007:15 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2310:18 | Frame | SAFE | argument of raceBounded inside the per-frame `try` of an async arrow: a sync throw lands in the same catch as a rejected $$eval (context-destroyed -> null, else unconfirmed); nothing abandoned |
| packages/browser/src/actions/browser-action-engine.ts:2436:18 | Frame | SAFE | argument of raceBounded inside the per-frame `try` of an async arrow: a sync throw lands in the same catch as a rejected $$eval (context-destroyed -> null, else unconfirmed); nothing abandoned |
| packages/browser/src/actions/browser-action-engine.ts:2583:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2611:68 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2615:67 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2617:73 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2621:27 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2670:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2681:31 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2709:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2724:13 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2741:9 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2748:31 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2750:21 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2754:65 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2756:21 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2760:21 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2760:58 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2781:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2792:31 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2809:21 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2815:19 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2847:7 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:2877:32 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/condition-wait.ts:371:43 | Frame | SAFE | directly awaited inside a try whose catch classifies transient frame errors (isTransientContextError) exactly like a rejection |
| packages/browser/src/actions/page-settle.ts:77:9 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/dom/dom-semantic-engine.ts:252:48 | Frame | SAFE | inside recoverBlockedFrameSrc's try/catch (documented never-throws: returns undefined); the sync throw is caught there like a rejection |
| packages/browser/src/dom/dom-semantic-engine.ts:255:48 | ElementHandle-JSHandle | SAFE | handle from frameElement(), used inside try before the finally that disposes it; throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/dom/dom-semantic-engine.ts:392:29 | Frame | UNSAFE | promise created OUTSIDE the per-frame try: a child detached while an earlier frame was scraped throws past the D6 catch into the outer catch-all (empty graph) |
| packages/browser/src/dom/dom-semantic-engine.ts:459:35 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/dom/dom-semantic-engine.ts:474:77 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/dom/dom-semantic-engine.ts:798:43 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/session/browser-session.ts:93:15 | non-Puppeteer | SAFE | Dialog/Target/ConsoleMessage .type() getter: not decorated, never throws on frame detach |
| packages/browser/src/session/browser-tab.ts:42:69 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/session/browser-tab.ts:219:74 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/session/browser-tab.ts:272:78 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/session/browser-tab.ts:499:11 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/session/browser-tab.ts:543:42 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/session/browser-tab.ts:546:39 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/session/browser-tab.ts:550:44 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/session/browser-tab.ts:599:29 | Page-plain-delegator | SAFE | throws synchronously only if the MAIN frame is detached (page gone); called with `await` directly inside an async function, so it is an ordinary rejection of that function (no abandoned promise) |
| packages/browser/src/session/browser-tab.ts:604:29 | Page-plain-delegator | SAFE | throws synchronously only if the MAIN frame is detached (page gone); called with `await` directly inside an async function, so it is an ordinary rejection of that function (no abandoned promise) |
| packages/browser/src/session/browser-tab.ts:608:29 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/session/browser-tab.ts:613:29 | Page-plain-delegator | SAFE | throws synchronously only if the MAIN frame is detached (page gone); called with `await` directly inside an async function, so it is an ordinary rejection of that function (no abandoned promise) |
| packages/browser/src/session/browser-tab.ts:618:38 | non-Puppeteer (Keyboard/Mouse) | SAFE | Keyboard/Mouse method: async, CDP-session based, not throwIfDetached |
| packages/browser/src/session/browser-tab.ts:623:44 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/session/browser-tab.ts:634:41 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/session/browser-tab.ts:737:37 | non-Puppeteer | SAFE | Dialog/Target/ConsoleMessage .type() getter: not decorated, never throws on frame detach |
| packages/browser/src/session/browser-tab.ts:793:30 | non-Puppeteer | SAFE | Dialog/Target/ConsoleMessage .type() getter: not decorated, never throws on frame detach |
| packages/browser/src/session/browser-tab.ts:918:42 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/session/browser-tab.ts:936:30 | non-Puppeteer | SAFE | Dialog/Target/ConsoleMessage .type() getter: not decorated, never throws on frame detach |
| packages/browser/src/session/browser-tab.ts:1003:31 | non-Puppeteer | SAFE | Dialog/Target/ConsoleMessage .type() getter: not decorated, never throws on frame detach |
| packages/browser/src/session/browser-tab.ts:1011:36 | non-Puppeteer | SAFE | Dialog/Target/ConsoleMessage .type() getter: not decorated, never throws on frame detach |
| packages/browser/src/session/browser-tab.ts:1038:36 | non-Puppeteer | SAFE | Dialog/Target/ConsoleMessage .type() getter: not decorated, never throws on frame detach |
| packages/browser/src/session/browser-tab.ts:1078:21 | non-Puppeteer | SAFE | Dialog/Target/ConsoleMessage .type() getter: not decorated, never throws on frame detach |
| packages/browser/src/session/dialog-cdp.ts:137:21 | non-Puppeteer | SAFE | Dialog/Target/ConsoleMessage .type() getter: not decorated, never throws on frame detach |
| packages/browser/src/session/dialog-warden.ts:337:17 | non-Puppeteer | SAFE | Dialog/Target/ConsoleMessage .type() getter: not decorated, never throws on frame detach |
| packages/browser/src/session/dialog-warden.ts:377:17 | non-Puppeteer | SAFE | Dialog/Target/ConsoleMessage .type() getter: not decorated, never throws on frame detach |
| packages/browser/src/verifier/execution-verifier.ts:343:10 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/verifier/execution-verifier.ts:357:23 | Frame | SAFE | inside try/catch in an async IIFE (own = unjudgeable); same handling as a rejection |
| packages/browser/src/verifier/execution-verifier.ts:358:38 | ElementHandle-JSHandle | SAFE | handle from frameElement(), used inside try before the finally that disposes it; throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/verifier/execution-verifier.ts:414:26 | Frame | SAFE | inside the async IIFE passed to bounded(): the sync throw rejects the IIFE promise, bounded() maps it to failed |
| packages/browser/src/verifier/post-conditions.ts:237:28 | Frame | SAFE | inside the per-child try/catch of matchChildFrame ("a frame we can't reach is simply not the match") |
| packages/browser/src/verifier/post-conditions.ts:239:30 | ElementHandle-JSHandle | SAFE | owner from frameElement() inside the per-child try; never disposed before the call |
| packages/browser/src/verifier/post-conditions.ts:608:69 | Frame | SAFE | inside async `run` that observeFocusForKey passes to bounded(): rejection -> `{error}` outcome |
| packages/browser/src/verifier/post-conditions.ts:615:25 | Frame | SAFE | inside async `run` passed to bounded() (same as above) |
| packages/browser/src/verifier/post-conditions.ts:618:45 | Frame | SAFE | inside async `run` passed to bounded() (same as above) |
| packages/browser/src/verifier/post-conditions.ts:631:26 | Frame | UNSAFE | `bounded(frame.evaluate(...))`: the call runs before bounded(), so a sync throw rejects disposeKeyObservation, documented "never throws" |
| packages/browser/src/verifier/post-conditions.ts:647:38 | Frame | UNSAFE | `bounded(frame.evaluate(...))`: sync throw bypasses bounded() and rejects finishKeyObservation instead of recording navigated/postError |
| packages/browser/src/verifier/post-conditions.ts:714:14 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/verifier/post-conditions.ts:720:18 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/verifier/post-conditions.ts:728:13 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/verifier/post-conditions.ts:812:11 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/verifier/post-conditions.ts:868:15 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/verifier/post-conditions.ts:1197:29 | Frame | UNSAFE | `bounded(page.mainFrame().evaluate(...))`: sync throw rejects NavigationProbe.finish |
| packages/browser/src/verifier/post-conditions.ts:1497:28 | Frame | SAFE | inside async `run` passed to bounded() (observePoint) |
| packages/browser/src/verifier/post-conditions.ts:1548:38 | Frame | UNSAFE | `bounded(frame.evaluate(...))`: sync throw rejects finishPointObservation |
| packages/browser/src/verifier/post-conditions.ts:1735:32 | Frame | UNSAFE | `bounded(frame.evaluate(...))`: sync throw rejects observeUploadTargets |
| packages/browser/src/verifier/post-conditions.ts:1743:26 | Frame | UNSAFE | `bounded(frame.evaluate(...))`: sync throw rejects removeUploadListener, documented best-effort cleanup |
| packages/browser/src/verifier/post-conditions.ts:1758:33 | Frame | SAFE | inside async `run` passed to bounded() (finishUploadObservation) |
| packages/browser/src/verifier/post-conditions.ts:1762:30 | Frame | SAFE | inside async `run` passed to bounded() (finishUploadObservation) |
| packages/browser/src/verifier/post-conditions.ts:1857:9 | in-page DOM | SAFE | runs inside the browser page (DOM element method), not a Puppeteer call |
| packages/capability-runtime/src/audit/site-audit.ts:206:38 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/page-text.ts:86:49 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:310:17 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:311:29 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:847:41 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:907:37 | non-Puppeteer (Keyboard/Mouse) | SAFE | Keyboard/Mouse method: async, CDP-session based, not throwIfDetached |
| packages/capability-runtime/src/runtime.ts:1071:35 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/capability-runtime/src/runtime.ts:1466:31 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:1495:84 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:1497:58 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:1545:31 | Frame (hops after the first) / Page | SAFE | directly awaited inside resolveFrame's try/catch, which rethrows non-syntax errors untouched: identical to a rejection |
| packages/capability-runtime/src/runtime.ts:1615:33 | Frame / Page | SAFE | directly awaited in async extractData; a sync throw is a rejection of extractData, same as a rejected evaluate (no wrapper or abandoned promise) |
| packages/capability-runtime/src/runtime.ts:1641:25 | Frame / Page | SAFE | directly awaited in async eval(); same as above |
| packages/capability-runtime/src/runtime.ts:1687:16 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:1699:15 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:1706:15 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:1713:16 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:1725:15 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:1732:15 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:1746:64 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:1778:15 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:2033:24 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:2035:18 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:2040:11 | in-page DOM | SAFE | runs inside the browser page (DOM element method), not a Puppeteer call |
| packages/capability-runtime/src/runtime.ts:2064:17 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:2067:17 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:2073:11 | in-page DOM | SAFE | runs inside the browser page (DOM element method), not a Puppeteer call |
| packages/capability-runtime/src/runtime.ts:2074:11 | in-page DOM | SAFE | runs inside the browser page (DOM element method), not a Puppeteer call |
| packages/capability-runtime/src/runtime.ts:2141:73 | Page-plain-delegator | UNSAFE | array element: a sync throw (main frame detached) escapes BEFORE Promise.all attaches handlers, abandoning waitForFileChooser() (later unhandled rejection) |
| packages/capability-runtime/src/runtime.ts:2411:11 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:2412:11 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:2434:45 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:2485:48 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:2556:29 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/capability-runtime/src/runtime.ts:2560:29 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/capability-runtime/src/runtime.ts:2981:12 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:2988:12 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:3009:25 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:3029:26 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:3042:24 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:3062:33 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:3094:37 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:3102:38 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/snapshot/ax-snapshot.ts:236:23 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/cli/src/cli.ts:874:33 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/cli/src/cli.ts:900:33 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/cli/src/cli.ts:917:27 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/cli/src/cli.ts:926:28 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/cli/src/cli.ts:948:33 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/cli/src/cli.ts:1074:33 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/cli/src/cli.ts:1130:33 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/cli/src/cli.ts:1168:33 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/cli/src/dialog-json-routing.ts:76:48 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/cli/src/dialog-json-routing.ts:76:68 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/frontend/src/app/App.tsx:118:23 | non-Puppeteer | SAFE | browser DOM / React ref method in the frontend package, not Puppeteer |
| packages/frontend/src/components/browser/EmbeddedBrowser.tsx:370:44 | non-Puppeteer | SAFE | browser DOM / React ref method in the frontend package, not Puppeteer |
| packages/frontend/src/components/ui/CommandPalette.tsx:48:49 | non-Puppeteer | SAFE | browser DOM / React ref method in the frontend package, not Puppeteer |
| packages/frontend/src/components/ui/Drawer.tsx:30:22 | non-Puppeteer | SAFE | browser DOM / React ref method in the frontend package, not Puppeteer |
| packages/frontend/src/components/ui/Modal.tsx:32:23 | non-Puppeteer | SAFE | browser DOM / React ref method in the frontend package, not Puppeteer |
| packages/frontend/src/pages/session/SessionPage.tsx:459:28 | non-Puppeteer | SAFE | browser DOM / React ref method in the frontend package, not Puppeteer |
| packages/frontend/src/pages/session/SessionPage.tsx:498:6 | non-Puppeteer | SAFE | browser DOM / React ref method in the frontend package, not Puppeteer |
| packages/frontend/src/runtime/actions/impl/interactionActions.ts:31:68 | non-Puppeteer | SAFE | browser DOM / React ref method in the frontend package, not Puppeteer |
| packages/frontend/src/runtime/browser/browserCapabilityAPI.ts:93:13 | non-Puppeteer | SAFE | browser DOM / React ref method in the frontend package, not Puppeteer |
| packages/frontend/src/runtime/browser/browserCapabilityAPI.ts:94:49 | non-Puppeteer | SAFE | browser DOM / React ref method in the frontend package, not Puppeteer |
| packages/mcp-server/src/tools.ts:648:40 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/mcp-server/src/tools.ts:726:40 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/mcp-server/src/tools.ts:761:44 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/mcp-server/src/tools.ts:777:40 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/mcp-server/src/tools.ts:834:40 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/mcp-server/src/tools.ts:921:40 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/mcp-server/src/tools.ts:1127:40 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/mcp-server/src/tools.ts:1200:55 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/sutradhar/src/index.ts:14:14 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/sutradhar/src/index.ts:17:14 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/sutradhar/src/index.ts:18:14 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/sutradhar/src/index.ts:19:26 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/sutradhar/src/page.ts:186:14 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/sutradhar/src/page.ts:188:14 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/sutradhar/src/page.ts:189:26 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/sutradhar/src/page.ts:279:25 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/sutradhar/src/page.ts:295:25 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/sutradhar/src/page.ts:329:33 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/sutradhar/src/page.ts:466:38 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
