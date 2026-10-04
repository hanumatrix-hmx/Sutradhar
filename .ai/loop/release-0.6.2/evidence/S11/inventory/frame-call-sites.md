# S4 call-site inventory (every call in packages/*/src of a method that can throw synchronously)

Source: `sites.txt` (210 keys, `list-sites.mjs`); methods: `sync-throw-methods.txt`. Columns: file:line:col | receiver type | SAFE/UNSAFE | reason.
SAFE = a synchronous throw ends up in exactly the handling a rejection of the same call gets. UNSAFE = it escapes that handling.
Totals: SAFE 210, UNSAFE 0, UNCLASSIFIED 0.

| key | receiver | class | reason |
|---|---|---|---|
| packages/agent/src/core/agent-loop.ts:686:32 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/agent/src/core/block-detector.ts:22:27 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:121:71 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:528:19 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:658:26 | Frame | SAFE | inside probeSelectorSyntax's try/catch (returns null = "can't run" outcome); nothing was abandoned before the throw |
| packages/browser/src/actions/browser-action-engine.ts:854:89 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:917:79 | non-Puppeteer (Keyboard/Mouse) | SAFE | Keyboard/Mouse method: async, CDP-session based, not throwIfDetached |
| packages/browser/src/actions/browser-action-engine.ts:951:38 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:959:23 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:968:37 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:969:44 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:988:34 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:991:19 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:1000:33 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:1001:38 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:1141:61 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1146:36 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1176:53 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1187:31 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:1213:21 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1224:23 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1225:23 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1227:39 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1256:57 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1308:44 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1570:18 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1580:19 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:1593:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1612:77 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:1650:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1651:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1652:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1662:19 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1664:19 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1664:56 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:1731:10 | Frame | SAFE | fixed in S4: the call runs inside frameCall (async), so Puppeteer's synchronous throwIfDetached throw is a rejection and the existing handling applies |
| packages/browser/src/actions/browser-action-engine.ts:1744:8 | Frame | SAFE | fixed in S4: the call runs inside frameCall (async), so Puppeteer's synchronous throwIfDetached throw is a rejection and the existing handling applies |
| packages/browser/src/actions/browser-action-engine.ts:1778:12 | Frame | SAFE | fixed in S4: the call runs inside frameCall (async), so Puppeteer's synchronous throwIfDetached throw is a rejection and the existing handling applies |
| packages/browser/src/actions/browser-action-engine.ts:1904:44 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:1915:23 | Frame | SAFE | first statement of async raceFrameProbe: the sync throw is a rejection of raceFrameProbe, which its only caller pierceFirstMatch wraps in try/catch (same handling as a rejected $); no promise or timer exists yet to abandon |
| packages/browser/src/actions/browser-action-engine.ts:1998:14 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2011:15 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2314:18 | Frame | SAFE | argument of raceBounded inside the per-frame `try` of an async arrow: a sync throw lands in the same catch as a rejected $$eval (context-destroyed -> null, else unconfirmed); nothing abandoned |
| packages/browser/src/actions/browser-action-engine.ts:2440:18 | Frame | SAFE | argument of raceBounded inside the per-frame `try` of an async arrow: a sync throw lands in the same catch as a rejected $$eval (context-destroyed -> null, else unconfirmed); nothing abandoned |
| packages/browser/src/actions/browser-action-engine.ts:2587:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2615:68 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2619:67 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2621:73 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2625:27 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2674:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2685:31 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2713:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2728:13 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2745:9 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2752:31 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2754:21 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2758:65 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2760:21 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2764:21 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2764:58 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2785:17 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2796:31 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2813:21 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/browser-action-engine.ts:2819:19 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/browser-action-engine.ts:2851:7 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/actions/browser-action-engine.ts:2881:32 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/actions/condition-wait.ts:371:43 | Frame | SAFE | directly awaited inside a try whose catch classifies transient frame errors (isTransientContextError) exactly like a rejection |
| packages/browser/src/actions/frame-call.ts:8:10 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/frame-call.ts:8:68 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/frame-call.ts:9:21 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/actions/page-settle.ts:77:9 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/dom/dom-semantic-engine.ts:253:48 | Frame | SAFE | inside recoverBlockedFrameSrc's try/catch (documented never-throws: returns undefined); the sync throw is caught there like a rejection |
| packages/browser/src/dom/dom-semantic-engine.ts:256:48 | ElementHandle-JSHandle | SAFE | handle from frameElement(), used inside try before the finally that disposes it; throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/dom/dom-semantic-engine.ts:398:12 | Frame | SAFE | fixed in S4: the call runs inside frameCall (async), so Puppeteer's synchronous throwIfDetached throw is a rejection and the existing handling applies |
| packages/browser/src/dom/dom-semantic-engine.ts:466:35 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/browser/src/dom/dom-semantic-engine.ts:481:77 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/dom/dom-semantic-engine.ts:805:43 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
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
| packages/browser/src/verifier/post-conditions.ts:238:28 | Frame | SAFE | inside the per-child try/catch of matchChildFrame ("a frame we can't reach is simply not the match") |
| packages/browser/src/verifier/post-conditions.ts:240:30 | ElementHandle-JSHandle | SAFE | owner from frameElement() inside the per-child try; never disposed before the call |
| packages/browser/src/verifier/post-conditions.ts:609:69 | Frame | SAFE | inside async `run` that observeFocusForKey passes to bounded(): rejection -> `{error}` outcome |
| packages/browser/src/verifier/post-conditions.ts:616:25 | Frame | SAFE | inside async `run` passed to bounded() (same as above) |
| packages/browser/src/verifier/post-conditions.ts:619:45 | Frame | SAFE | inside async `run` passed to bounded() (same as above) |
| packages/browser/src/verifier/post-conditions.ts:633:34 | Frame | SAFE | fixed in S4: the call runs inside frameCall (async), so Puppeteer's synchronous throwIfDetached throw is a rejection and the existing handling applies |
| packages/browser/src/verifier/post-conditions.ts:652:36 | Frame | SAFE | fixed in S4: the call runs inside frameCall (async), so Puppeteer's synchronous throwIfDetached throw is a rejection and the existing handling applies |
| packages/browser/src/verifier/post-conditions.ts:721:14 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/verifier/post-conditions.ts:727:18 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/browser/src/verifier/post-conditions.ts:735:13 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/verifier/post-conditions.ts:819:11 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/verifier/post-conditions.ts:875:15 | ElementHandle-JSHandle | SAFE | throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup) |
| packages/browser/src/verifier/post-conditions.ts:1214:16 | Frame | SAFE | fixed in S4: the call runs inside frameCall (async), so Puppeteer's synchronous throwIfDetached throw is a rejection and the existing handling applies |
| packages/browser/src/verifier/post-conditions.ts:1515:28 | Frame | SAFE | inside async `run` passed to bounded() (observePoint) |
| packages/browser/src/verifier/post-conditions.ts:1567:36 | Frame | SAFE | fixed in S4: the call runs inside frameCall (async), so Puppeteer's synchronous throwIfDetached throw is a rejection and the existing handling applies |
| packages/browser/src/verifier/post-conditions.ts:1756:52 | Frame | SAFE | fixed in S4: the call runs inside frameCall (async), so Puppeteer's synchronous throwIfDetached throw is a rejection and the existing handling applies |
| packages/browser/src/verifier/post-conditions.ts:1765:34 | Frame | SAFE | fixed in S4: the call runs inside frameCall (async), so Puppeteer's synchronous throwIfDetached throw is a rejection and the existing handling applies |
| packages/browser/src/verifier/post-conditions.ts:1782:33 | Frame | SAFE | inside async `run` passed to bounded() (finishUploadObservation) |
| packages/browser/src/verifier/post-conditions.ts:1786:30 | Frame | SAFE | inside async `run` passed to bounded() (finishUploadObservation) |
| packages/browser/src/verifier/post-conditions.ts:1881:9 | in-page DOM | SAFE | runs inside the browser page (DOM element method), not a Puppeteer call |
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
| packages/capability-runtime/src/runtime.ts:2145:86 | Page-plain-delegator | SAFE | fixed in S4: the click runs in an async IIFE, so a sync throw is a rejection that Promise.all and the surrounding catch handle; waitForFileChooser() is never abandoned |
| packages/capability-runtime/src/runtime.ts:2415:11 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:2416:11 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:2438:45 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:2489:48 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:2560:29 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/capability-runtime/src/runtime.ts:2564:29 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/capability-runtime/src/runtime.ts:2985:12 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:2992:12 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:3013:25 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:3033:26 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:3046:24 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:3066:33 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/runtime.ts:3098:37 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/capability-runtime/src/runtime.ts:3106:38 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/capability-runtime/src/snapshot/ax-snapshot.ts:236:23 | Page-async | SAFE | Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function |
| packages/cli/src/cli.ts:896:33 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/cli/src/cli.ts:922:33 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/cli/src/cli.ts:939:27 | non-code | SAFE | inside a comment/JSDoc/string literal; not a call |
| packages/cli/src/cli.ts:948:28 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/cli/src/cli.ts:970:33 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/cli/src/cli.ts:1096:33 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/cli/src/cli.ts:1152:33 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
| packages/cli/src/cli.ts:1190:33 | non-Puppeteer | SAFE | SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page |
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
