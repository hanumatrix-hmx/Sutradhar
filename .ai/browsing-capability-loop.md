---
State Category: Operational / Persistent
Machine Readable: true
Update Ownership: AI Agent
Freshness Expectation: Per Loop Iteration
Update Policy: Append-driven (log), change-driven (taxonomy)
Last Updated: 2026-08-16
---

# Browsing capability loop — persistent state

See [CLAUDE.md](../CLAUDE.md) for the standing directive this doc supports: find a real
limitation by using Sutradhar → fix it → verify live → log it here → repeat.

## Capability taxonomy

Status per category. `covered` = exercised live and works. `partial` = works in the common
case, known edges untested/unfixed. `untested` = not yet exercised via real dogfooding this
loop. `excluded` = deliberately out of scope (see CLAUDE.md's scope boundary).

| Category | Status | Notes |
|---|---|---|
| Basic navigation/click/type/snapshot | covered | Exercised repeatedly this session (example.com, TodoMVC, the dashboard itself). |
| DOM-attribute grounding (`data-sd-node-id`) under re-render | covered | Survived 3 independent real re-render tests: TodoMVC filter round-trip, a continuous-stream sibling-churn test, and (Milestone 4) the hardest case — a numeric id captured *before* deleting the item above it in the list, then acted on after the deletion-driven reflow. Correctly still hit the right (surviving) element every time, no misfires. |
| Accessibility-tree grounding (`axSnapshot`) | covered | Milestone 4: used live against TodoMVC exactly as documented — `ax_snapshot` + `type_by_label` to add todos, both landed correctly with no ids involved at all. Works correctly. |
| Hover / `:hover`-revealed UI | covered | Milestone 4: `browser.hover` used live via MCP (not just direct-runtime) to reveal a `:hover`-only destroy button, then clicked it successfully — confirmed synthetic `mouseover` does NOT trigger real `:hover`, but the real tool does. |
| Multi-tab workflows, incl. OAuth-style popup login | covered | Milestone 1: created a background tab via `new_tab`, navigated/snapshotted/clicked it independently via `tabId`, confirmed the original tab was completely unaffected. Works correctly. Milestone 58: closed the CLI-specific gap — the CLI had no tab commands at all, and adding them (`tabs`/`newtab`/`focustab`/`closetab`) surfaced two real multi-tab bugs in the per-process reattach architecture (only the most-recent tab was ever discovered; a focus choice didn't survive to the next command), both fixed. See PROB-031. Milestone 59: verified the exact real-world pattern that motivated the fix — a `window.open()`-triggered popup (how real "Sign in with X" OAuth buttons work) is correctly discovered as a real tab, and closing it (simulating provider auth completing) correctly leaves the session on the real parent page. Documented an honest, non-bug nuance: tab ids are a discovery-order counter reassigned fresh on every CLI reattach, not a stable identity — they can shift once the tab set changes between commands, so always re-`tabs` before acting rather than assuming a prior id is still valid. Milestone 66: closed a
real accuracy gap in `tabs`/`list_tabs` itself — every listed tab's title was the hardcoded
placeholder `'Adopted Tab'`, never the real title, because of the CLI's per-command adoption
architecture. Now reads the title live. See PROB-035. Milestone 80: closed a real, permanent
bookkeeping leak — Milestone 59 tested closing a popup from the *session* side (simulating
provider auth completing); this milestone tested the popup closing *itself* via page-script
`window.close()` (the real mechanism OAuth popups actually use), and found `list_tabs` kept
reporting the dead tab forever, unchanged for 2+ seconds, because nothing was listening for the
underlying page's own close event outside `closeTab()`'s own explicit path. Fixed with a
`page.on('close', ...)` listener wired at every tab-creation site. See PROB-039. |
| File download | covered | Milestone 1: `runtime.downloadFile` verified end-to-end — real file landed on disk at the expected path with correct content (read back and checked, not just a success flag). |
| File upload | covered | Milestone 2: `browser.upload_file` against a real fixture page (the-internet.herokuapp.com/upload) — set a file input, clicked Upload, confirmed via the server's own response page ("File Uploaded! upload-test.txt") that it actually landed server-side, not just a client-side success flag. |
| iframes / cross-frame interaction (incl. dynamically-injected, cross-origin) | covered | Milestone 1: verified directly against the runtime — `snapshot`/`click` correctly traverse into a cross-origin iframe injected into the page *after* initial load (the hardest realistic case — matches real chat-widget/payment-iframe behavior). Works correctly today. Milestone 35: closed the one remaining unverified sub-case — `type` into a contenteditable iframe body (TinyMCE), long assumed broken/cross-origin-restricted per GLM's original C4. Turned out to be a misdiagnosis: the iframe isn't actually cross-origin (`contentDocument` fully readable from the parent), it's already groundable via `snap`, and `type` into it already works, real text landing confirmed via independent DOM read-back. The actual bug was an invalid CSS selector in this project's own scenario-suite test code, fixed at the source — see `PROB-019`/`PROB-022`. Milestone 64: closed the one remaining gap — genuinely nested iframes (an iframe inside another iframe). The main `snap`/`click`/`type` path already recursively pierced arbitrary depth automatically, but `eval --frame`/`extractData`'s explicit frame targeting only ever looked one level deep; now supports a `"::"`-separated selector chain to reach any nesting depth. See `PROB-033`. Milestone 95 (2026-08-18): confirmed a new sub-case — a `blob:`-URL iframe (the pattern code-playground/sandbox sites use for the live-rendered result pane, distinct from a plain `srcdoc` or cross-origin iframe) is pierced correctly by `snapshot`, with real `type()`/`click()` interaction confirmed working against `solidjs.com`'s official examples playground. |
| Shadow DOM | covered (open, incl. slotted content and multi-level nesting); closed is a known, reasonable limitation | Milestone 3: an injected open shadow root's button was correctly listed by `snapshot` and correctly clicked (verified via the real click handler firing). A *closed* shadow root's content is invisible to both — expected: `mode:'closed'` blocks even `evaluate()`-level JS access by design, and closed shadow roots are rare in practice since most real widgets use open ones. Not treated as a gap worth chasing. Milestone 74: extended real dogfooding to two harder, modern Web Component patterns not previously tried — a custom element with a `<slot>` projecting a light-DOM child button (interactive element lives in light DOM, renders inside the shadow boundary) worked correctly; two custom elements nested inside each other, each with its own shadow root (the real button two shadow-root hops deep, matching real design-system components like Shoelace/Lit that compose custom elements internally) also worked correctly — the recursive shadow-collection already in `scrapeFrame` handles arbitrary nesting depth, not just one level. No bug found; recorded as real positive evidence for a genuinely common modern pattern, not just the single-level case. |
| PDF handling: export | covered | `browser.export_pdf` verified — returns real, valid `%PDF-1.4` content for the current page. |
| PDF handling: reading one encountered mid-browse | covered | Milestone 67: closed a real, previously-logged gap (`PROB-009`) — navigating directly to a `.pdf` URL correctly enumerates Chrome's native PDF-viewer toolbar via `snapshot`, but `pageText` came back completely empty (root cause: the native viewer renders in an isolated guestview outside the top document's real DOM, so there was no DOM-reading fix). Now `readPageText` detects a PDF via `document.contentType` and extracts real text by fetching the PDF's own bytes through the page (reusing cookies/session) and parsing with `pdf-parse`. Live-verified against a real PDF (`bitcoin.org/bitcoin.pdf`): `pageText` now returns the document's real text instead of empty. |
| Service Workers / PWA offline-caching pages | covered, no bug found | Milestone 83: tested against a real, known PWA demo page with an active service worker (MDN's own simple-service-worker example) rather than a synthetic fixture — real registration confirmed (`navigator.serviceWorker.getRegistrations()` returned 1 real registration with the correct scope), `snapshot` worked normally on the SW-controlled page, and `reload()` — which the SW's own `fetch` handler can intercept — completed in 14ms with no hang. A page whose network requests are actively intercepted by a service worker doesn't degrade any Sutradhar capability. |
| Real-time/streaming pages (continuous background DOM churn) | covered | Milestone 1: grounding survives ongoing unrelated DOM churn elsewhere on the page (a simulated live-feed stream, numeric id captured then acted on ~8 re-renders later — still hit the right element). Milestone 19: tested a genuinely WebSocket-push-driven page (piehost.com's live WebSocket tester, real `wss://` connection, not polling) — a numeric id (a copy button) captured in a snapshot immediately after 4 new log lines arrived via real WS push resolved correctly via `eval` to the live element; occlusion detection correctly refused a click blocked by an unrelated chat widget on the same push-updated content; typing into a filter field correctly filtered the WS-delivered log from 4 entries to the 1 matching in real time. The harder "target itself gets destroyed and id gets reused" case remains untested but is a narrower edge case, not the core WebSocket/SSE gap. |
| Media (video/audio/canvas, incl. WebGL 3D) | covered | Milestone 3: native `<video controls>` UI is not exposed via `snapshot` (expected — UA-internal shadow DOM; the correct control path is the JS media API, not clicking browser chrome). `video.play()`/`.pause()`/state inspection via `eval` works correctly against a real, well-formed video. One specific external test file failed with a genuine format/codec error (`MEDIA_ELEMENT_ERROR`) — confirmed to be that file's problem, not Sutradhar's, by successfully loading a different real video right after. Canvas: `browser.click`'s `offset` param verified pixel-accurate against a hand-drawn canvas region (239,119 landed correctly inside a 200-280×100-140 target). Milestone 51: 2D canvas signature-pad drawing via `dragAtPoints` confirmed working. Milestone 63: WebGL 3D camera-orbit drag (`three.js` OrbitControls) confirmed working — `dragpoints` correctly rotates the real 3D camera, verified via before/after screenshots showing a genuinely different rendered view. |
| Accessibility media-feature emulation (`prefers-reduced-motion`) | covered, no bug found | Milestone 81: `emulateSettings({reducedMotion:'reduce'})` correctly flips `window.matchMedia('(prefers-reduced-motion: reduce)').matches` from `false` to `true` (verified via the live API, not just the emulation call's own report), and — the more meaningful check — a real CSS animation gated behind a `@media (prefers-reduced-motion: reduce)` rule genuinely resolves to `animation-name: none` afterward, confirming the emulation actually affects real page rendering decisions, not just the JS-visible flag. This capability existed in code (alongside the already-tested `colorScheme`/`timezone`/`locale` emulation) but had never specifically been dogfooded until now. |
| Mobile/device emulation | covered, 2 bugs fixed | Milestone 2: `set_viewport`'s width/height/deviceScaleFactor/media-query emulation all verified correct against a real site (github.com); found `hasTouch` never got enabled for `isMobile:true`, fixed with a spread-order default. Milestone 6: live MCP testing caught that the Milestone 2 fix didn't actually work through the real call path (an object-spread subtlety hid it from direct-runtime testing) — refixed to resolve the default before construction, re-verified against the exact MCP-handler call shape. **0.4.0 release-prep pass (2026-08-18): closed the lingering "needs one more reconnect" note** — confirmed live through a real MCP round-trip (not direct-runtime scripting): `isMobile:true` with no explicit `hasTouch` correctly cascades `navigator.maxTouchPoints` to `1` and `'ontouchstart' in window` to `true`; the explicit-decoupling case (`isMobile:false, hasTouch:true`, a touch-enabled desktop) also correctly reports the same real functional signals, matching the tool's own documented default/override behavior exactly. |
| Auth/session persistence across runs | covered, incl. sessionStorage-based logins | Milestone 2: created a named profile via the CLI, logged into a real test fixture (the-internet.herokuapp.com/login), fully closed the session (killed the Chrome process), launched a completely fresh session with the same profile, navigated straight to the auth-gated page — still authenticated, no re-login needed. Works correctly for cookie/localStorage-based auth via `userDataDir` alone. Milestone 29: closed the remaining real gap — Chrome discards real `sessionStorage` on process exit regardless of `userDataDir`, so a sessionStorage-based login was still lost on relaunch. Wired profiles to `getStorageState`/`setStorageState`, persisted automatically on `shutdown()` for a profile-launched session and restored on the next launch with the same profile + `initialUrl`. Verified with a purpose-built fixture (a real `sessionStorage` value set under a named profile survives shutdown + relaunch) since the original candidate test site (saucedemo) turned out to be cookie-based on live inspection, not sessionStorage-based as assumed. |
| Network conditions (slow/offline/throttled) | covered, new capability built | Milestone 3: confirmed this was a complete gap (zero code anywhere, not even internal). Built `SutradharRuntime.emulateNetwork` + `browser.set_network_conditions` MCP tool (offline mode + DevTools throttling presets or custom download/upload/latency), mirroring the existing `emulate`/`set_viewport` pattern. Verified live: offline genuinely blocked a real `fetch` ("Failed to fetch"), Slow 3G added ~2046ms to a request that normally takes ~17ms (matches the preset's math), clearing throttling restored the ~17ms baseline. |
| Large-scale extraction / pagination | covered, 1 significant bug found and fixed | Milestone 8: a real Hacker News front page has 227 interactive elements — found that `formatGraphForLlm`'s listing was hardcoded to show only the first 60 with NO way for any caller to ask for more (the parameter existed in the function signature but nothing threaded it through the public API), and the underlying id-stamping cap (150) was itself lower than a single ordinary content page can have. The "More" pagination link was invisible past both caps — undiscoverable by an LLM reading the snapshot. Fixed: exposed `maxElements` through `runtime.snapshot()` and `browser.snapshot`'s MCP schema (default unchanged at 60, no behavior change for existing callers), and raised the stamping cap to 300. Verified live: default snapshot still hides "More" (no regression), `maxElements:250` reveals it with a real, clickable id, and clicking that id genuinely navigated to page 2. Completed a real 3-page, 90-story extraction task end-to-end via `browser.extract_data` + `.morelink` pagination. |
| Cookies (get/set/delete) | covered | Milestone 8: verified against real `document.cookie` state directly, not just each tool's own success report. All three operations correct. |
| localStorage / sessionStorage (get/set/clear) | covered | Milestone 8: verified against real `localStorage`/`sessionStorage` APIs directly. Set, get, and clear all correct. |
| Clipboard (get/set) | covered, 2 high-severity bugs found and fixed | Milestone 8: real round-trip via `grant_permissions` + `set_clipboard` + `get_clipboard` — the exact text written was read back. Milestone 86: tested a REAL page-level "Copy to Clipboard" button (`navigator.clipboard.writeText()` in a click handler — the actual real-world pattern, not Sutradhar's own tools) and found two compounding bugs: `grant_permissions`/`set_geolocation` silently revoked every OTHER previously-granted permission on the same origin whenever either was called again (CDP replaces an origin's whole permission set, doesn't add to it); and `'clipboard-write'` specifically never actually worked at all, because Puppeteer's mapping for it doesn't satisfy the real Permissions API check. Fixed both — grants are now additive, and requesting `'clipboard-write'` automatically also grants the CDP permission that actually gates it. See PROB-040. The legacy `document.execCommand('copy')` pattern (distinct code path, still common on older sites) also confirmed working correctly. |
| Web Share API (`navigator.share()`) | honest, non-fixable limitation — documented, not a bug | Milestone 87: confirmed `navigator.share()`'s promise never resolves or rejects in headless Chrome — still genuinely pending 5+ seconds after the call, not a Sutradhar-side hang. Root cause: the API requires a real native OS share sheet, which doesn't exist in a headless environment; this is a fundamental headless-browser limitation any automation tool (Playwright, Puppeteer, Sutradhar) hits identically, not something to fix here. A caller whose page-level workflow needs to trigger `navigator.share()` should race it against their own timeout inside `eval()` (verified this works cleanly — `Promise.race([share(), timeout])` returns normally) rather than `await`ing it directly, which would hang indefinitely. |
| WebAuthn / passkeys (`navigator.credentials.get()`) | honest, non-fixable limitation — documented, not a bug | Milestone 88: same class of finding as `navigator.share()` — a real "Sign in with passkey" flow's `navigator.credentials.get()` never resolves in headless Chrome, confirmed still pending even past its own internal 2000ms `timeout` option (raced against a 4s outer timeout, genuinely never settled). Root cause: WebAuthn requires a real platform authenticator or security key, which doesn't exist headless — the same structural limitation as the Web Share API, affecting every automation tool identically, not fixable at Sutradhar's layer. Confirmed `Notification.requestPermission()` does NOT have this problem — it resolves instantly to `'denied'` in headless with no explicit grant, since Chrome auto-resolves that specific prompt rather than leaving it hanging; the hang class is specific to APIs (Share, WebAuthn) that require genuine native OS/hardware UI with no headless fallback, not permission prompts in general. Same practical guidance as Web Share: race it inside `eval()`, don't `await` it directly. Milestone 89: checked one more candidate for the same hang class — the File System Access API's `showOpenFilePicker()` (real native file-picker dialog, another "needs real OS UI" case) — and found it does NOT hang; it throws a real `AbortError` ("The user aborted a request") within milliseconds, a real, honest, fail-fast signal a caller can catch immediately rather than a silent hang. Narrows the hang class further: it's specific to Share/WebAuthn (which have no headless-mode fallback behavior defined at all), not a universal property of "APIs needing real OS UI" — some of those (file pickers) fail fast and cleanly instead. |
| Geolocation | covered | Milestone 8: `set_geolocation` verified against the real `navigator.geolocation.getCurrentPosition()` API — returned the exact overridden coordinates, permission auto-granted as documented. |
| Web Notifications API (`Notification.permission` prompt, real notification creation) | covered, no bug found | Milestone 77: `grant_permissions(['notifications'])` correctly flips `Notification.permission` from `'default'` to `'granted'`, verified via the real live API (not just the grant call's own success report); a real `new Notification(...)` construction then succeeds and carries the exact title/body passed, confirming the whole permission→construct flow works end-to-end, not just the permission flag in isolation. |
| JS framework diversity beyond React; SPA client-side routing (`history.pushState`) | covered, 1 real bug found and fixed | Milestone 3: real TodoMVC implementations in Vue, Angular, and Svelte — add-todo, snapshot, and DOM-state verification all worked correctly in each, matching the earlier React result. Grounding operates on the rendered DOM, not framework internals, so this is expected but now actually confirmed rather than assumed. Milestone 65: `goBack`/`goForward` navigation correctly follows real SPA `pushState` history, but found and fixed a real bug in `snap`'s reported title — it went stale for any title change without a real page load (the entire mechanism of client-side routing), since the underlying cache was only kept in sync by a `'load'` listener. See `PROB-034`. Milestone 95 (2026-08-18, post-0.4.0): tested SolidJS — architecturally the opposite extreme from React (fine-grained signal-based reactivity, no virtual DOM diffing at all; DOM nodes are created once and updated via direct subscriptions) — live against the official `solidjs.com/examples/todos` playground, no bug found. Also confirmed a genuinely new combination: the live app there renders inside a `blob:`-URL iframe (a playground/sandbox pattern distinct from a regular cross-origin or `srcdoc` iframe), and `snapshot` correctly pierces it — the todo input and add button were stamped with real ids, `type()`/`click()` worked, and the new todo landed with the exact correct text in Solid's reactive list, verified via direct `contentDocument` inspection of the iframe (not the tool's own success report). |
| `agent.runGoal` (Sutradhar's own autonomous loop) | blocked on environment, partially covered | Milestone 7: no LLM provider available in this environment (no Ollama running, no `OPENROUTER_API_KEY`) — the actual reasoning capability is untested and I can't responsibly fix this myself (installing Ollama is a heavier step; won't provision API keys/billing). What DID get verified: the failure mode is honest (no fabricated success) and `session:blocked` event surfacing through the tool — built in an earlier project phase — actually works live, confirmed for the first time. |
| Strict Content-Security-Policy pages (`script-src 'self'`, no `unsafe-inline`/`unsafe-eval`) | covered, no bug found | Milestone 79: tested `snapshot`/`click`/`eval` against a page with a real, strict CSP header (banking-site-style: no inline scripts, no inline event-handler attributes, no `eval()` in page code). Confirmed CSP correctly blocks what it's supposed to (an inline `<script>` tag and an inline `onclick=` attribute both genuinely never executed — real browser behavior, not a Sutradhar limitation) while Sutradhar's own `click()`/`eval()` continued to work correctly throughout, since CDP-driven operations run at a privileged automation layer the page's own CSP doesn't govern — exactly as they should. A real, common security pattern (CSP without `unsafe-inline`) doesn't degrade any Sutradhar capability. |
| Native dialogs (alert/confirm/prompt/beforeunload) | covered, 2 bugs found and fixed | Milestone 7: found a real bug live — the 5s auto-dismiss safety net was too tight for a realistic check-then-act round trip (get_pending_dialog → handle_dialog), silently losing the race and auto-dismissing dialogs the caller intended to handle. Bumped the default to 30s (matches `downloadFile`'s timeout), re-verified with simulated ~4s latency between check and handle — correctly caught and handled now. Milestone 78: found a real, high-severity bug specific to `beforeunload` (the "unsaved changes" navigation guard, extremely common on forms/editors) — `navigate()` away from any such page always took the full 30s and then failed outright, page stuck on the original URL. Two compounding causes: the 30s auto-dismiss safety net raced Puppeteer's own 30s navigation timeout and never won; and even after shortening it, the "safe default" of `dismiss()` (correct for alert/confirm/prompt) means "stay, cancel navigation" for `beforeunload` specifically — the opposite of what an in-flight `navigate()` call asks for. Fixed with a `beforeunload`-specific 3s timeout + `accept()` (proceed with leaving); other dialog types' behavior unchanged, explicitly regression-tested. See PROB-038. |
| Drag-and-drop | covered | Milestone 7: real HTML5 `DataTransfer` drag from a source to a target element — drop handler received the correct transferred data. Works correctly. |
| Right-click / context menu | covered | Milestone 7: verified the real `contextmenu` event fires correctly via `browser.right_click`. Works correctly. |
| Network request interception/mocking | covered | Milestone 7: `browser.route` with both `mock` (a real fetch received the exact mocked JSON body) and `block` (a real fetch failed as expected) actions verified against genuine `fetch()` calls, not just the tool's own success report. |
| Console/network/page-error log capture | covered | Milestone 7: `get_console_logs` correctly captured log/warn/error levels plus an incidental real network failure; `get_page_errors` correctly captured a deliberate uncaught exception with message and stack trace; `get_network_log` correctly distinguished a completed (mocked) request from a blocked one (request-only, no response phase). |
| CAPTCHA / bot-detection / stealth evasion | excluded | Deliberately out of scope per CLAUDE.md — not a gap to close. |
| Viewport control as a public, first-class capability (SDK `launch({viewport})`/`Page.set/getViewport()`, CLI `--viewport`, MCP `browser.launch`'s `viewport` param/`browser.get_viewport`) | covered, 9 real gaps found and fixed | Milestone 92 (2026-08-17, external field report `SUTRADHAR-ISSUES.md`): the internal runtime already had `setViewport`, but it was unreachable from the public SDK/CLI entirely — `launch({viewport})` silently dropped it, no CLI flag existed at all, the CDP override never resized the real headed OS window, repeated `launch()` leaked Chrome processes with no warning, there was no way to reconnect a session from another process, viewport wasn't persisted across CLI reattaches, and there was no inspection API. All fixed and live-verified: CLI `--viewport 390x844` → `window.innerWidth/innerHeight` read back exactly `390x844`, persisted correctly across a fresh CLI reattach with no re-pass; a headed session's real OS window measured via genuine Win32 `GetWindowRect` at 516×939 for a 390×844 request (the delta is exactly Chrome's own window chrome) and confirmed working both at launch time AND applied mid-session to an already-running window; SDK `launch({viewport})`/`Page.getViewport()` round-trip exact; `Browser.getWsEndpoint()` let a genuinely separate `SutradharRuntime` reconnect. Milestone 94: found the identical gap had been missed in the MCP server (this project's own documented primary integration surface) — `browser.launch` had no `viewport` param and there was no `browser.get_viewport` tool; fixed and live-verified the same way. See `PROB-042`. |
| Clipboard paste into a rich-text editor, via the CLI specifically | covered, 1 high-severity CLI-only bug found and fixed | Milestone 55: the underlying capability (`setClipboard`/`grantPermissions`/Ctrl+V) worked correctly via `SutradharRuntime` directly, but `grant` was invisible to every subsequent separate CLI process — Puppeteer's `overridePermissions()` doesn't survive a CDP client disconnect/reconnect cycle, which the CLI's one-process-per-command architecture always does. Fixed by persisting granted permissions in CLI state and re-applying them on every reattach. See PROB-029. |
| Async/debounced-network typeahead search suggestions | covered, no bug found | Milestone 54: tested live against Wikipedia's real search box — typing landed correctly, real API-backed suggestion options (`role="option"`) appeared in the very next snapshot with no extra wait needed, clicking a suggestion correctly navigated to that exact article (confirmed via independent `location.href`/`document.title` read-back, not just the click's own success report). (DuckDuckGo's homepage search was tried first but never showed a suggestions dropdown at all in this environment — not investigated further as a possible bug, since Wikipedia's equivalent worked cleanly and DDG's suggestion behavior may simply be region/consent-state-gated; noted as untested rather than assumed broken.) |
| Fullscreen API (`requestFullscreen()`) | covered, no bug found | Milestone 85: a real click-triggered `requestFullscreen()` call succeeds in headless Chrome (`document.fullscreenElement` correctly populated, no permission prompt blocking it), and `snapshot()` continues working normally afterward with no hang or degradation — a page entering/using fullscreen mode (common in video players, presentation tools, games) doesn't break any Sutradhar capability. |
| Native HTML5 `<dialog>`/`showModal()` (browser-level top-layer modal, distinct from a div-based simulated modal) | covered, no bug found | Milestone 53: a real `<dialog>` opened via `showModal()` correctly makes background content unclickable — a click on a background button is correctly refused via the existing occlusion check (`elementFromPoint` resolves to the dialog, not the background element), with a clear, actionable error. Note: Chromium does NOT set a literal `.inert` DOM property on background elements for this case (checked live — it stays `false`), so the snapshot listing still includes the now-inert background button; harmless in practice since the click attempt fails safely and clearly rather than silently succeeding or doing the wrong thing. Closing the dialog via its own real `close()`-triggering button verified independently via `dialog.open` reading back `false`. |
| Nested modal-in-modal dialogs (a modal opened from within another modal, z-index-stacked) | covered, no bug found | Milestone 52: tested live against MUI's own Nested Modal demo — opening a child modal from within a parent modal correctly stacked; `clicktext "Close Child Modal"` correctly hit the topmost (child) modal's button via occlusion detection and closed only the child, leaving the parent open — exactly correct nested-modal semantics, confirmed via real DOM state, not just each click's own success report. |
| Canvas signature/drawing pad (coordinate-based drag, no addressable DOM inside the canvas) | covered, real CLI-exposure gap closed | Milestone 51: `dragAtPoints` (already existed via MCP/SDK) correctly draws real strokes on a live `signature_pad` canvas, confirmed visually. Added `clickpoint`/`dragpoints` CLI verbs — the underlying capability existed but was unreachable from the CLI, the only surface whose whole purpose is direct scriptable access. Also confirmed the click case (distinct from drag): a real canvas-rendered bar chart, `click()` with an element-relative pixel offset correctly selected the exact bar under the click point (verified via the chart's own hit-test callback, not just the click's own success report), matching real charting-library click-to-select interactions. |
| Infinite-scroll / "load more on scroll" pages (append-on-scroll, distinct from a virtualized/recycling grid) | covered, 1 high-severity bug found and fixed | Milestone 49: tested live against a real infinite-scroll demo. `scroll bottom` reported success on every call while `window.scrollY` silently stayed at 0 — `'top'`/`'bottom'` had never actually been implemented as jumps to the real boundary, they fell through to the same branch as `'up'`, so `'bottom'` scrolled the page UP by `amount` instead (a no-op from position 0, which the boundary-check logic then misread as "already there", masking the bug completely). Fixed to jump to the true `scrollTop 0` / `scrollHeight` boundary; live-confirmed `scroll bottom` now genuinely triggers the page's infinite-scroll library to load more content. See PROB-027. |
| Rich-text-editor toolbar formatting (select text via keyboard, apply formatting via toolbar) | covered, 1 real CLI-only bug found and fixed | Milestone 48: tested live against Quill's own playground. Typing and single keypresses worked immediately; a keyboard-driven select-then-format sequence (`Home`, `Ctrl+Shift+ArrowRight`, click Bold) silently failed only through the CLI (each `press` re-clicked to focus, resetting the cursor position a prior `press` had built). Fixed by adding `SutradharRuntime.focus()`/`browser.focus` (real `.focus()`, doesn't move the cursor) and switching the CLI's `press` to use it instead of `click`. See PROB-026. |
| Portal-rendered searchable multi-select combobox (react-select and similar) | covered | Milestone 47: tested live against `react-select.com`'s own demo. Both real interaction modes verified: (1) click-to-select — click the field, type a search term to filter, click the filtered `role=option` result, confirm the resulting chip via a fresh snapshot; (2) pure keyboard-driven selection — type a search term, `press ArrowDown` then `press Enter` with no click on the option at all, confirmed the chip landed correctly. Both modes work correctly with no engine changes needed. |
| Complex JS date-range picker widgets (calendar dropdown, two-month grid, re-render-on-click) | covered | Milestone 46: tested live against `daterangepicker.com`'s real widget — 9 identical widget instances share the same CSS classes on one page (only one visible at a time), a real trap for hand-written CSS selectors (confirmed one led straight to a hidden instance) that Sutradhar's own snapshot sidesteps entirely since it only stamps elements that are actually visible. The library re-renders its calendar `<table>` after every day-cell click, correctly invalidating the previously-stamped end-date cell's id — the engine's honest stale-id refusal fired exactly as designed ("re-snapshot and use a fresh id"), not a bug. Following that advice (re-snapshot between the two day clicks) completed the full flow: start date, end date, Apply — the input's real value updated to the exact selected range, independently confirmed via read-back. |
| Cross-origin masked/validated payment iframe fields (Stripe Elements) | partial — single-field typing fully covered incl. live formatting; multi-field-group corruption is a documented, mitigated, open limitation | Milestone 45: real checkout tested against `stripe-payments-demo.appspot.com`. Typing into a single masked field (card number, expiry) works correctly and is now verified honestly (tolerates live reformatting, no longer false-negatives). A real, deeper bug found: typing into a *sibling* field in the same masked-input group can retroactively corrupt an earlier field's already-verified value — no per-field check can catch this. Mitigated procedurally (a final group-wide `snapshot` after filling all related fields), not fixed at the engine level. See PROB-025. |
| Concurrent/overlapping actions on the same session (e.g. an LLM caller firing several tool calls in parallel) | covered, no bug found | Milestone 73: real `Promise.all`-fired concurrent `type()` calls confirmed safe on two axes — 5 concurrent calls into 5 *different* fields all landed their own correct value with zero cross-contamination (the per-tab promise-chain queue in `executeAction` genuinely serializes overlapping CDP calls, not just in code review); 3 concurrent calls into the *same* field correctly triggered the existing duplicate-action guard, rejecting the 2 that arrived within its 1000ms window rather than interleaving/corrupting keystrokes — final value was clean, matching one whole input, not a mangled mix. No new engine work needed; confirms the queue + duplicate-guard design (built earlier this project) actually holds under real concurrent load, not just sequential calls. |
| Pure keyboard-only navigation (Tab between fields, arrow-key traversal, repeated same-key sequences, no `click()` at all) | covered, 1 high-severity bug found and fixed | Milestone 75: tested a real keyboard-only form flow (focus + Tab + type, zero clicks — matching a screen-reader/keyboard-only user, or an agent targeting a non-clickable custom widget). Found and fixed a real bug: `press_key` was subject to the duplicate-action guard using the raw key name as its "target", so the SECOND and every subsequent press of the SAME key within 1000ms — Tab-Tab-Tab through a form, ArrowDown-ArrowDown through a dropdown — was silently rejected as an "accidental double-dispatch", regardless of which element was actually focused. The very first Tab worked; every following one got stuck. This had gone undetected because every prior keyboard test in this taxonomy (e.g. Milestone 47's react-select combobox) happened to use a single ArrowDown then a single Enter — different keys, never the same key twice in a row. Fixed by removing `press_key` from the duplicate-guard's applicability set. See PROB-037. |
| WebRTC / `getUserMedia`-based camera+microphone pages (video call UIs, QR/photo-booth widgets) | covered, no engine work needed | Milestone 76: tested both a plain headless launch (no fake device) and one with Chrome's standard `--use-fake-device-for-media-stream`/`--use-fake-ui-for-media-stream` testing flags. Plain launch: `grant_permissions(['camera','microphone'])` bypasses the permission prompt cleanly, and `getUserMedia()` fails gracefully with a real, standard `NotFoundError` (no hardware) — no hang, no crash, an agent could accurately report "no camera available" from this. With the fake-device flags: `getUserMedia()` genuinely succeeds and returns real synthetic audio/video tracks (`"Fake Default Audio Input"`, `"fake_device_0"`), letting an agent exercise a video-call/camera UI's actual "connected" state end-to-end. No new capability needed — the already-existing generic `launch({launch:{args:[...]}})` passthrough (documented for the `--user-agent` case) already supports this standard, well-known Chrome testing mechanism with zero code changes. |
| Nested/independent scroll containers (virtualized grids, chat panes, modal bodies, code blocks) | covered, 2 real gaps found and fixed | Milestone 44: `scroll` previously only ever called `window.scrollBy()` — a page's own `overflow:auto` container (e.g. a virtualized data grid) was silently unreachable, no error. Fixed with an optional element target; also surfaced and fixed a related async-virtualization-re-render timing gap via `settle`. See PROB-024. Milestone 69: a deeper, previously-unknown grounding-correctness gap — a node id captured before scrolling a virtualized/windowed list (react-window/MUI DataGrid-style DOM node recycling) could be acted on afterward and silently hit the WRONG recycled row, `success:true`, because the generation-based staleness guard never fires when a node's id/generation attributes are untouched by recycling. Fixed with a snapshot-time text fingerprint compared against live content at act time. See PROB-036. |
| Hypermedia-driven apps (htmx-style: server-rendered HTML fragments swapped via `hx-get`/`hx-put` + `outerHTML`, near-zero client JS, real DOM node destruction/replacement on every interaction — architecturally the opposite of a client-rendered SPA) | covered, no bug found | Milestone 95 (2026-08-18): tested live against the official `htmx.org` click-to-edit example. Clicking replaces the display view with a genuinely fresh, server-fetched `<form>` (real node destruction, not an update-in-place); typing into the new form's field landed correctly (verified via `contentDocument`-independent read-back); submitting issued a real `PUT` and swapped the view back with the edited value genuinely reflected in the final rendered page. No staleness/grounding issues despite every step involving real full-element replacement rather than React-style reconciliation. |
| Modern code editors (Monaco/VS Code Web's `EditContext`-API input model) | covered, real technique documented (not obvious) | Milestone 43: tested live against the real Monaco Editor playground. Modern Monaco doesn't use a plain `<textarea>` for input at all — it uses the `EditContext` Web API, whose real focus target is an invisible, zero-box `<div class="native-edit-context">` that `click`/`type` correctly refuse to act on (no box model to click, "Node is either not clickable or not an Element") — a real, correct refusal, not a bug. The working technique: target the visible rendered surface (`.monaco-editor .view-lines`, a real, sizable, clickable div) for both `click` and `type` — Puppeteer's real synthetic keyboard events reach Monaco's model correctly through it (verified via `monaco.editor.getEditors()[0].getValue()` actually containing the typed text, not just a fabricated success report). Separately: an initial `snap` taken immediately after navigation surfaced a `<textarea aria-label="Editor content">` that looked like the obvious target but was a transitional element from Monaco's pre-`EditContext`-init state — gone moments later, clicking it failed with occlusion. A real, concrete example of why the `settle` option (Milestone 38) matters: snapshotting/acting too early after navigating into a heavy JS framework can grab elements that don't survive the framework's own init sequence. |

## MCP session staleness — resolved 2026-08-13, but re-staleness after every rebuild is a standing gotcha

Milestone 1 hit a stale MCP session that produced a false bug report (iframes looked broken,
weren't). The user reconnected it before Milestone 2, confirmed by `hasTouch`/`data-sd-*` etc.
all resolving correctly. **This isn't a one-time fix** — every future rebuild of `mcp-server`
(or any package it depends on) makes the *currently connected* session stale again until
reconnected. Two fixes landed in Milestone 2 (the double-header bug, the `hasTouch` default)
that the connected session at the time did NOT yet reflect. Standing practice: after any
capability-runtime/mcp-server code change, verify via direct-runtime scripting (import
`SutradharRuntime` from `packages/capability-runtime/dist/index.js`) rather than assuming the
connected MCP session picked it up — and note in the checkpoint report which fixes still need
a reconnect to be live-confirmed end-to-end through MCP itself.

## Iteration log

Append-only. Newest first.

### 2026-10-04 — Release 0.6.2: fixes for the WebBench 2026-10-04 defects (PROB-047/048/049/051, PROB-050 mitigated), independently audited

Built on branch `release/0.6.2` (not published): page text windows with totals and a marker (CLI/SDK/MCP, new `browser.get_page_text`, 74 tools), frame-detach containment (`frameCall` at every unsafe site, deterministic churn fixture that fails the published 0.6.1 and passes HEAD), `#N`/`[#N]` node ids, no-session reads fail with a hint instead of launching a blank browser, CLI `back`/`forward`/`reload`. The S8 audit (fresh auditor, own mutants and probes) accepted all five items; its one test gap (continue-offset hint for later windows) is closed. Discovered along the way: PROB-052 (PDF text extraction never worked in bundled builds; 0.6.1 hid it as empty text, 0.6.2 reports it). Follow-ups are logged as GAP entries (see the 0.6.2 S10b commit). Evidence: `.ai/loop/release-0.6.2/evidence/`.

### 2026-10-04 — Milestone 100: pre-registered, blind-verified WebBench run of the published 0.6.1 CLI — 4 confirmed defects (PROB-047 to PROB-050), 1 usability defect (PROB-051), three bug re-tests

Driven by the host AI through the published `sutradhar@0.6.1` CLI (sha256 `9858726a...5c59b`, checked on every call), 30 seeded fresh READ tasks plus a 6-task re-test set, strict evidence rules, a blind Opus verifier with three canaries (all caught), and orchestrator adjudication. Full report: `tools/webbench/claude-direct-run-2026-10-04.md`; protocol, logs' hashes and rulings in `.ai/loop/webbench-2026-10-04/`. Result: 6 strict completions of 29 in-scope (H1 20.7%, CI 9.8 to 38.4), 1 interpreted, 13 external blocks, 9 agent failures, 0 Sutradhar failures after adjudication. The old "0 Sutradhar-attributable failures" is now explained as a counting convention, not a measurement (see `.ai/competitive-benchmarks.md`).

**Confirmed defects (found by checking logs against controls, not by guessing):**
- **D1, detached Frame (PROB-047).** On kayak.com `/stays`, `click` and `type` fail with "Attempted to use detached Frame" (2561 seq 33/37/47/49), reproduced 3 times by the verifier through an independent frame inventory; `clickrole` on the same button worked, `text` read the page, and one `snap` returned "Interactive elements (0)". The page has a same-URL child iframe. The task was ruled AGENT-FAIL because the agent also never selected a typeahead suggestion on the working `/hotels` route, so the defect was not shown to be the cause.
- **D2, silent 4000-character `text` truncation (PROB-048).** `runtime.ts:2959` slices `innerText` to 4000 with no marker; MCP snapshot slices to 2000. 42 of 91 CLI `text` calls in the run returned exactly 4001 characters. On lawinsider.com `text` showed 3 of 10 results while `read body` showed 10. It sits behind the reads for 1379, 2687, 982 and plausibly 2582 and 1371.
- **D3, `[#N]` printed but `#N` rejected (PROB-049).** `snap` prints `[#5]`; `click "#5"` exits 1 with "pass just the number". 8 failed calls across 6 tasks.
- **D4, `undefined` printed (PROB-050).** The CLI has no `back` verb; `back` is `eval history.back()`, which prints the literal `undefined` (exit 0, navigation worked).

**Re-tests (separate from the headline):** PROB-044 `click_by_text` across `<mark>`-split text on frontiersin.org: **PASS** (597: `count "mark"` 44, `clicktext` exit 0 verified). Type-append (`type` appending to old input value): **PASS** on aliexpress.us (41) and ca.gov (192). The three tasks themselves: 597 AGENT-FAIL (substitution, "highly cited" unsupported), 41 AGENT-FAIL (substitution, skipped first match), 192 COMPLETED (interpreted, linked-org). ea.com (392): curl control returned `200 HTTP/1.1` while Chrome failed twice with `ERR_HTTP2_PROTOCOL_ERROR`, so EXTERNAL-BLOCK (client-fingerprint) by the pre-registered mapping; a client-side HTTP/2 cause is not ruled out. ford.com (568) now gives a 403 Akamai deny instead of the HTTP/2 error; stackoverflow.com (1691) cleared its Cloudflare interstitial but then showed a captcha on search and an IP-block on tag pages (EXTERNAL-BLOCK, was a completion in August). PROB-043 is not probeable through the one-process-per-command CLI.

**Smoke-test finding (PROB-051).** A read verb run with no session (before any `nav`, or after `close`) silently launches a blank browser and exits 0 (`cli-smoke-2026-10-04.md`, finding 3). The help text says only `nav` launches a session. Empty output with exit 0 is therefore ambiguous.

**Observation (not filed).** `nav` to a page that answers with an HTTP error prints `Verification: NOT verified — contradicted (confidence 0.09)` but exits **0** (e.g. realsimple.com HTTP 402 in slot K; 21 more in the 534 CLI records: 403 x 15, 404 x 3, 429 x 2, 410 x 1). The text is honest; a script trusting the exit code would not see the contradiction.

**Unconfirmed, no control:** a click whose effect applied but reported a 15 s timeout (2388 seq 35); `--expect-url-changed` checking only the original tab when a click opens a new one (2388 seq 17, exit 4); several `occluded` refusals (1925, 2561, 41).

### 2026-08-19 — Milestone 99: long-session reliability harnesses, current-head sequential evidence, and a real detached-frame crash fixed

Worked the two selected reliability items in order. For PROB-043, added a durable real-MCP soak
harness with independent DOM and application-state verification. After clean 104-, 1,008-, and
10,866-call campaigns, the same harness completed a genuine two-hour run: 260,179 real MCP calls,
83,703 checked type operations, 27,901 checked raw key presses, 697 reloads, and 1,395 temporary-tab
cycles, with zero mismatches, zero run errors, no malformed JSONL records, no call over one second,
stable harness memory, and clean owned-process teardown. The historical failure remains unexplained
and no corrective code change was made, so PROB-043 moves to monitoring rather than resolved.

For PROB-015, instrumented the sequential SDK runner with process/resource/session telemetry and
unique output paths. UC-05 and UC-14 passed 10/10 focused repetitions and every one of six
completed full-suite runs on rebuilt current source, including a final full run after the two-hour
MCP soak, with zero runtime sessions retained after each scenario. The old failure mechanism cannot be proven from the historical artifact, so this
is recorded as open/monitoring rather than relabeled as solved.

The full-suite work did expose a separate current defect: UC-07's TinyMCE frame recreation crashed
4/10 isolated Node processes because losing cross-frame `Promise.any()` selector waits survived
after a winner and later rejected against detached frames. An AbortController attempt was tested
and rejected after it still crashed 5/10 with unhandled `AbortError`. The final implementation
uses short, fully-settled sequential probes over a refreshed live-frame list: UC-07 then passed
10/10 isolated runs and three full sequential suites, including the post-soak verification. See PROB-045.

### 2026-08-17 — Milestone 90: concurrent CLI invocations silently shared one browser session — found by being the victim of it mid-benchmark, closes PROB-041

Discovered the way this loop is supposed to discover things: by actually using Sutradhar for a
real task and having it break, not by reading code. During the Opus-driven WebBench sample 10
run, `text` on what should have been an nps.gov page returned **"Sign in to BharatTech
Education"** — content from an unrelated local test fixture. The disciplined path mattered more
than the fix here: the tempting response ("weird page, just re-run it") would have produced a
benchmark whose numbers looked perfectly normal while being quietly corrupted, and would have
missed the bug entirely.

Investigated instead. `tabs` showed the active tab was `tab_sess_1786965204055_1_1` — a session
whose id timestamp (~17:53) *predated this run's own launch* (~21:14). Closing it and starting a
clean session produced the decisive evidence: a `nav` to an nps.gov URL reported
`Navigated to http://bharattech.localhost:18000/portal/me?ui-shot=schooladmin`, a URL never
requested, carrying another job's own query params (`?ui-audit=1`, `?ui-shot=...`). A concurrent
UI-audit job in the same checkout was driving this run's tab in real time.

Root cause, confirmed in source: `packages/cli/src/state.ts:39` resolved the session pointer as
`path.join(os.homedir(), '.sutradhar-cli')` — one fixed global mutable file, no locking, and
deliberately no daemon (the CLI is one-process-per-command by design). Every invocation reads it
to decide which browser to attach to, so two unrelated users on one machine necessarily collide,
silently. A related ergonomics gap kept it invisible: there is no `launch` verb in this CLI
(`nav` auto-launches; headless is the default with `--headed` as the opt-out), so
`launch --headless` printed usage and exited without an obvious error — which is precisely how
the run attached to a stale pre-existing session rather than creating its own.

Fixed narrowly and backward-compatibly: honor an optional `SUTRADHAR_CLI_STATE_DIR` env var,
default unchanged when unset. Rejected the obvious alternative live rather than by assumption —
overriding `HOME`/`USERPROFILE` to move `os.homedir()` does not work, because Chrome inherits
those and fails to launch ("Timed out waiting for Chrome to start on port 63541"). `tsc --noEmit`
clean, build clean, `packages/cli` 29/29. Live-verified against the real repro: with the env var
pointed at a scratch dir, a fresh `nav` wrote its own `state.json` (`sess_1786982166618_1`) and
`location.href` read back `https://www.nps.gov/index.htm` across two consecutive independent CLI
invocations while the concurrent job continued on the default state dir untouched — and the
remaining 6 benchmark tasks then ran to completion with zero further interference.

Scope note, logged rather than built reflexively per this file's own convention: real multi-session
support (per-invocation session ids or a `--session` flag, plus locking, and making an unrecognized
verb fail loudly instead of printing usage and exiting clean) is a larger design question than this
unblock. Left open deliberately. Benchmark result and the host-model comparison it was actually run
for: `tools/webbench/claude-direct-run-2026-08-17-sample10.md` and `.ai/competitive-benchmarks.md`.

### 2026-08-17 — Milestone 67: real PDF text extraction — closes PROB-009, a gap open since Milestone 1's era

Picked the oldest still-OPEN real capability gap in the taxonomy rather than another dogfooding
sample: `PROB-009`, logged 2026-08-13 and left unfixed as "nontrivial scope". Investigated the
actual root cause precisely before attempting a fix: Chrome's built-in PDF viewer (PDF.js) that
renders on a direct `.pdf` navigation runs inside an isolated extension-hosted guestview — the
document's real text genuinely never appears in the top document's DOM at all, confirmed live
(not a truncation bug, not a lazy-render timing issue). No DOM-reading fix could ever have
worked; the only real fix is extracting text from the PDF's own bytes.

Added `pdf-parse` (new dependency, `packages/capability-runtime`) and wired it into
`readPageText`: detect `document.contentType === 'application/pdf'`, fetch the PDF's bytes
through the page's own `fetch` (so an authenticated PDF works identically to a public one, since
it reuses the page's cookies/session), and extract real text server-side. Falls back to the
original DOM-text path if extraction fails for any reason.

`packages/capability-runtime` 90/90, `packages/browser` 184/184, `packages/cli` 29/29,
`packages/mcp-server` 25/25, `packages/sutradhar` 11/11 — all green. Live-verified against a
real PDF, not a synthetic fixture (`bitcoin.org/bitcoin.pdf`) via a direct `SutradharRuntime`
script: `pageText` went from empty to 4000 real characters of the document's actual content.
`pnpm` isn't available in this environment, so the new dependency's `node_modules` entries were
installed via a plain `npm install` in an isolated scratch directory and copied in rather than
resolved through the workspace's normal install path — noted explicitly in `PROB-009` so a
future real `pnpm install` isn't skipped by mistake. Closes `PROB-009`.

### 2026-08-17 — Milestone 88: mapped the boundary of Milestone 87's hang class — WebAuthn hangs the same way, Notification prompts don't

Extended Milestone 87's finding to figure out how wide the "requires real native UI, hangs
forever in headless" class actually is, rather than treating `navigator.share()` as a one-off.
Tested two more real prompt-gated APIs: WebAuthn's `navigator.credentials.get()` (the real
"Sign in with passkey" flow) and `Notification.requestPermission()` (the classic "Allow
notifications?" prompt).

Result: WebAuthn hangs identically to Web Share — genuinely never settles, confirmed past even
its own internal 2000ms `timeout` option, let alone a 4s outer race. Same root cause: it
requires a real platform authenticator/security key with no headless fallback. But
`Notification.requestPermission()` does NOT hang — it resolves instantly to `'denied'`, because
Chrome auto-resolves that specific prompt in headless mode rather than leaving it pending. This
draws a real, useful boundary: the hang class is specific to APIs needing genuine native
OS/hardware UI (Share, WebAuthn), not permission prompts as a category — most of those (camera,
microphone, geolocation, notifications) already resolve cleanly, as this session's earlier
milestones confirmed.

Documented both findings together with the same practical guidance as Milestone 87: race any
of these against an explicit timeout inside `eval()` rather than awaiting directly. No code
change — this is an honest capability boundary, not a bug.

### 2026-08-17 — Milestone 87: `navigator.share()` never resolves in headless Chrome — confirmed a fundamental, non-fixable headless limitation, not a Sutradhar bug

Applying the same "test real page-level API usage, not just Sutradhar's own tools" lens that
found PROB-040 to one more common pattern: the Web Share API's `navigator.share()` (real "Share"
buttons on mobile-oriented sites). A direct `await` on the call hung the whole diagnostic script
past its 20s timeout. Investigated properly rather than assuming a Sutradhar defect: raced the
same call against an explicit 5s timeout from inside `eval()` itself — the real `share()` promise
was still genuinely pending after 5+ seconds, confirming the API's own promise never
resolves/rejects at all in a headless environment, not that Sutradhar's dispatch hung.

Root cause: `navigator.share()` requires a real native OS share sheet, which structurally
doesn't exist in headless Chrome — every automation tool (Playwright, Puppeteer, Sutradhar
alike) hits this identically; it's not something fixable at Sutradhar's layer without crossing
into faking OS-level UI. Documented as an honest, non-fixable limitation rather than either
silently ignoring it or building a workaround that would misrepresent what's actually happening.
Practical guidance recorded for the one real mitigation available: a caller whose workflow needs
to trigger `navigator.share()` should race it against their own timeout from inside `eval()`
(confirmed this pattern itself works cleanly and returns normally) rather than `await`ing it
directly.

### 2026-08-17 — Milestone 86: two compounding permission-grant bugs — `clipboard-write` never actually worked, and any grant call silently revoked every other permission on the origin — closes PROB-040

Tested a genuinely different clipboard scenario from Milestone 8's: a REAL page-level "Copy to
Clipboard" button using `navigator.clipboard.writeText()` inside a click handler — the actual
real-world pattern (npm-install copy buttons, coupon codes, share links), not Sutradhar's own
`set_clipboard`/`get_clipboard` tools directly. Result: the click succeeded, but the page's own
`writeText()` promise rejected with "Write permission denied" — even immediately after calling
`grant_permissions(['clipboard-read', 'clipboard-write'])`.

Root-caused via a live diagnostic sequence rather than guessing:
1. Confirmed `clipboard-write` reads as `'granted'` via `navigator.permissions.query` in Chrome's
   own default state, *before any grant call is ever made*.
2. Confirmed calling `grant_permissions` with a totally UNRELATED permission (`geolocation`
   alone) also flipped `clipboard-write` to `'denied'` — proving this isn't clipboard-specific:
   CDP's `Browser.grantPermissions` REPLACES an origin's entire permission set with exactly what
   was passed, rather than adding to it. `set_geolocation`'s own internal auto-grant
   (`overridePermissions(origin, ['geolocation'])`) had the identical bug.
3. Confirmed granting `'clipboard-write'` explicitly still left the Permissions API reporting
   `'denied'`, while granting `'clipboard-sanitized-write'` instead correctly reported
   `'granted'` — Puppeteer's friendly-name mapping for `'clipboard-write'` (to CDP's
   `clipboardReadWrite`) doesn't actually satisfy the real Permissions API check, which is gated
   by the separate `clipboardSanitizedWrite` CDP permission.

Fixed both: added a tracked, per-origin accumulated permission set (`grantedPermissionsByOrigin`)
that `grantPermissions`/`setGeolocation` both route through via a shared `applyPermissionGrant`
helper, always re-passing the FULL accumulated set so grants are additive instead of replacing;
and that same helper automatically adds `'clipboard-sanitized-write'` whenever a caller requests
`'clipboard-write'`, since that's virtually always the real intent. `packages/capability-runtime`
90/90. Live-verified end-to-end: clipboard permissions now correctly report `'granted'`, a real
click-triggered `writeText()` succeeds with the value reading back correctly via `get_clipboard`,
and granting an unrelated permission afterward no longer wipes the earlier clipboard grant. Full
downstream rebuild+retest: `cli` 29/29, `mcp-server` 25/25, `sutradhar` 11/11, `agent` 56/56,
`apps/server` 28/28. Closes `PROB-040`.

### 2026-08-17 — Milestone 82: composite real-workflow test — four of today's fixes (PROB-037/038/039 + keyboard Enter-activation) verified working together, not just in isolation

Every fix today (66-81) was live-verified individually via a focused repro. This milestone
instead built one realistic composite workflow exercising four of them together in sequence, to
check for interaction bugs a set of isolated tests can't catch: (1) keyboard-only navigation
through a 2-field form via repeated `Tab` presses — the exact PROB-037 same-key-repeat case; (2)
activating a button via keyboard `Enter` (not `click()`) that opens a popup which self-closes
~200ms later, matching a real OAuth flow's timing; (3) `list_tabs` correctly reflecting the
self-closed popup's removal (PROB-039); (4) `navigate()` away from the same page, which also
carries a `beforeunload` guard, completing successfully despite it (PROB-038).

All four composed correctly with no interaction bugs: keyboard nav landed on the right element
each Tab press, the popup opened and was correctly discovered then correctly removed after
self-closing, and the subsequent `beforeunload`-guarded navigation completed in ~3s exactly as
its own isolated test showed. A single realistic session driving multiple recently-fixed
mechanisms back-to-back — the kind of workflow a real agent session would actually produce —
works end-to-end.

### 2026-08-17 — Milestone 80: a popup self-closing via `window.close()` left a permanent phantom entry in `list_tabs` — closes PROB-039

Tested a real, subtly different variant of an already-covered pattern: Milestone 59 verified
closing an OAuth popup from the *session* side (an explicit `closeTab()` call simulating the
provider's own completion flow). This milestone tested the OTHER real mechanism OAuth/payment
popups actually use to close themselves — page-script `window.close()`, called by the popup's
own JS once auth completes, with nothing on the parent/session side initiating the close at all.

Result: `popup.closed` correctly flipped to `true` immediately (the real browser tab genuinely
closed), but `list_tabs` kept reporting the dead tab, unchanged, for 2+ seconds afterward and
counting — a permanent bookkeeping leak, not a timing race. Root cause: `BrowserSession`'s
`tabsMap` only ever gets an entry removed by `closeTab()` itself; nothing was listening for the
underlying Puppeteer `Page`'s own `'close'` event, so any tab that closed by a route other than
this session explicitly closing it (a self-closing popup, a crashed renderer, an external CDP
client) left a stale entry with literally no cleanup path.

Fixed: added `BrowserSession.watchForClose(tabId, page)` — a `page.on('close', ...)` listener
wired at all three places a tab enters `tabsMap` (`createTab`, `adoptPopupPage`,
`adoptExistingPage`), removing the entry the moment the real page closes for any reason, with
the same active-tab re-election logic `closeTab()` already used. Guarded against
double-processing when `closeTab()` itself triggers the same event. `packages/browser` 186/186.
Live-verified: the repro now correctly drops to 1 tab immediately after the popup self-closes,
confirmed stable across 5 repeated checks over 2 seconds (previously stuck forever); explicit
`closeTab()` re-checked to still work identically (regression, not just the positive case). Full
downstream rebuild+retest: `capability-runtime` 90/90, `cli` 29/29, `mcp-server` 25/25,
`sutradhar` 11/11, `agent` 56/56, `apps/server` 28/28. Closes `PROB-039`.

### 2026-08-17 — Milestone 78: `navigate()` always failed after 30s on any page with a `beforeunload` guard — closes PROB-038, a high-severity real-world gap

Tested a genuinely common real-world pattern that had never specifically been dogfooded: a page
with a `beforeunload` handler (the standard "you have unsaved changes, are you sure you want to
leave?" browser guard — forms, editors, checkout flows all commonly use this). Result: every
single `navigate()` call away from such a page took the full 30 seconds and then failed outright
with `net::ERR_ABORTED`, leaving the session stuck on the original URL. Not an edge case — this
is one of the most common real interaction guards on the web, and the failure mode (a long stall
followed by a hard failure) would silently break any automated flow that hits it.

Root-caused via a live diagnostic that polled `getPendingDialog()` while `navigate()` was still
in flight, rather than guessing: the `beforeunload` dialog genuinely appeared almost instantly
(~110ms) and the existing dialog auto-dismiss safety net *was* firing — but two things
compounded to defeat it entirely:
1. **Timing**: the safety net's 30000ms timeout raced Puppeteer's own `page.goto()` navigation
   timeout, which is also 30000ms by default. Both timers, started within milliseconds of each
   other, expired together — so the safety net never actually won the race in time to rescue the
   navigation; `navigate()` always hit its own timeout error first.
2. **Polarity** (found only after fixing #1 alone still left `navigate()` failing, just 10x
   faster): the safety net's default action, `dialog.dismiss()`, is the correct, safe choice for
   alert/confirm/prompt (never confirms something destructive) — but for `beforeunload`
   specifically, dismissing means "stay on this page, cancel the navigation," which is the exact
   opposite of what an in-flight `navigate()` call unambiguously requested. The "safe" default
   was actively self-defeating for this one dialog type.

Fixed both, scoped precisely to `dialog.type() === 'beforeunload'` so alert/confirm/prompt keep
their original, correct 30s-timeout/dismiss-default behavior unchanged: a much shorter
`beforeunload`-specific timeout (3000ms, reliably beating the navigation timeout instead of
racing it) and `accept()` instead of `dismiss()` (there's no legitimate case where a caller
invokes `navigate()` and secretly wants to stay put). `packages/browser` 186/186. Live-verified
across 3 separate runs: `navigate()` now resolves successfully in ~3s with the real page state
confirmed at the new URL (not just the promise resolving cleanly) — and a plain `confirm()`
dialog was independently re-checked to still auto-dismiss exactly as before, confirming the
polarity change didn't leak into unrelated dialog types. Full downstream rebuild+retest:
`capability-runtime` 90/90, `cli` 29/29, `mcp-server` 25/25, `sutradhar` 11/11, `agent` 56/56,
`apps/server` 28/28. Closes `PROB-038`.

### 2026-08-17 — Milestone 76: WebRTC/`getUserMedia` camera pages — covered, no engine work needed

Tested a genuinely untested modality: pages that request camera/microphone access
(`navigator.mediaDevices.getUserMedia`) — video-call UIs, QR-scanner widgets, photo-booth apps.
Two real checks: (1) a plain headless launch with `grant_permissions(['camera','microphone'])`
— the permission prompt is bypassed cleanly, and `getUserMedia()` then fails gracefully with a
real, standard `NotFoundError` (no physical camera in this environment) rather than hanging or
crashing; an agent reading this result could accurately report "no camera available" instead of
the tool getting stuck. (2) The same page, but launched with Chrome's own standard
`--use-fake-device-for-media-stream`/`--use-fake-ui-for-media-stream` testing flags — a
well-known mechanism real test suites use to exercise camera-dependent UIs without physical
hardware. `getUserMedia()` genuinely succeeded and returned real synthetic audio/video tracks,
letting an agent drive a video-call UI all the way to its actual "connected" state.

No engine change needed for either case — the already-existing generic
`launch({launch:{args:[...]}})` passthrough (the same mechanism documented for
`--user-agent`) already supports Chrome's fake-media flags with zero code changes. Recorded as
real positive evidence for a real-world app category (WebRTC/camera-based UIs) this taxonomy
hadn't specifically exercised before, not assumed to work by extension of "args passthrough
exists."

### 2026-08-17 — Milestone 75: repeated same-key presses (Tab-Tab-Tab, ArrowDown-ArrowDown) were silently blocked after the first — closes PROB-037

Tested a genuinely different interaction modality from anything tried before: a pure
keyboard-only form flow — `focus()` the first field, `type()`, `press_key('Tab')`, `type()`
into the next field, `press_key('Tab')` again, `press_key('Enter')` to activate a focused
button — zero `click()` calls anywhere, matching how a screen-reader/keyboard-only user (or an
agent targeting a genuinely non-clickable custom widget) would operate.

Found a real, high-severity bug: the first Tab correctly moved focus from field 1 to field 2
(confirmed via `document.activeElement`), but the SECOND Tab press reported `success:false`
with `"Duplicate 'press_key' on the same target within 1000ms"` — and focus never advanced
again for any further Tab press. Root cause: `checkDuplicateAction`'s "target" derivation falls
through to the raw key name when there's no selector/role/text, so every repeat of the SAME key
— regardless of which element is actually focused at the time — looks identical to the guard.
This is backwards for keyboard input specifically: Tab-Tab-Tab through a form, ArrowDown-
ArrowDown through a dropdown, and Backspace-Backspace to clear several characters are some of
the most common, completely legitimate real interaction patterns there are — unlike a click or
type, which really do carry a meaningful "target" a rapid repeat on could plausibly double-submit.

This had gone undetected through every prior keyboard-driven test in this project (e.g.
Milestone 47's react-select keyboard-selection test) purely because none of them happened to
press the exact same key twice in a row within the 1000ms window — always a different key each
time (ArrowDown then Enter), never the reuse case that actually triggers the bug.

Fixed by removing `press_key` from `MUTATING_ACTIONS` (the duplicate-guard's applicability set).
`packages/browser` 186/186 (1 new test: three consecutive `press_key('Tab')` calls all succeed).
Live-verified via a direct `SutradharRuntime` script: a real Tab-Tab-Tab sequence through a
2-field-plus-button form now correctly traverses focus every time (f1→f2→btn→body) instead of
getting stuck after the first press. Full downstream rebuild+retest: `capability-runtime` 90/90,
`cli` 29/29, `mcp-server` 25/25, `sutradhar` 11/11. Closes `PROB-037`.

### 2026-08-17 — Milestone 74: harder Web Component patterns (slotted content, multi-level nested shadow DOM) — covered, no bug found

Extended Milestone 3's single-level shadow-DOM test to two harder, genuinely modern patterns:
(1) a custom element with a `<slot>` projecting a light-DOM child button — the actual
interactive element lives in light DOM (a normal child in `document.body`'s tree), not inside
the shadow root, even though it visually renders inside the shadow boundary; (2) two custom
elements nested inside each other, each with its own independent shadow root — the real button
two shadow-root hops deep, matching how real design-system libraries (Shoelace, Lit, Stencil)
compose components out of other components internally. Both worked correctly first try:
`snapshot` found and stamped the button in both cases, and the click landed for real (verified
via the actual click handler firing, not just the tool's own success report). Confirms
`scrapeFrame`'s recursive shadow-root collection genuinely handles arbitrary nesting depth, not
just the one level Milestone 3 originally tested. No bug found — real positive evidence for a
common modern pattern this taxonomy hadn't specifically exercised before.

### 2026-08-17 — Milestone 73: real concurrent-action safety confirmed under actual `Promise.all` load, no bug found

Picked a structural, first-principles hazard rather than another dogfooding sample: what
happens when a caller (an LLM agent issuing several tool calls back-to-back, which Claude
itself sometimes does) fires overlapping `type()`/`click()` calls against the same session
without waiting for each to settle. `executeAction`'s per-tab promise-chain queue was designed
for exactly this, but hadn't been stress-tested with real concurrent calls, only sequential
ones and the internal-retry-interleaving case (Phase 2c of the field-report remediation).

Built two real `Promise.all`-driven tests via a direct `SutradharRuntime` script: (1) 5
concurrent `type()` calls into 5 different fields — all landed correctly, zero
cross-contamination, confirming the queue genuinely serializes CDP calls against the same page
rather than just looking like it does in code review; (2) 3 concurrent `type()` calls into the
*same* field — 1 succeeded, 2 were correctly rejected by the existing duplicate-action guard
("Duplicate 'type' on the same target within 1000ms"), and the final field value was clean (one
whole intended string), not an interleaved/corrupted mix — exactly the class of bug this
project fixed once already (the "tripled keystrokes" case) staying fixed under harder,
genuinely concurrent conditions, not just the sequential-retry case it was originally found in.

No bug found — a genuinely positive result, recorded as real evidence rather than skipped for
not being a "finding." Confirms real robustness Playwright/Puppeteer's raw APIs don't provide
any equivalent safety net for on their own (both would happily interleave two concurrent
`page.type()` calls against the same element with no guard at all).

### 2026-08-17 — Milestone 71: caught and fixed a false-positive regression in Milestone 69's own fix, same day, before it caused real damage

Immediately after Milestone 69 shipped (the virtualized-list fingerprint check), deliberately
went looking for the failure mode of the fix itself rather than moving on — a hard-throw
staleness check is exactly the kind of change that can trade one bug for a worse one. Built a
second live repro: a "Buy at $X" button whose price ticks up every 200ms via an ordinary
`setInterval`, nothing virtualized at all. Result: the click was hard-blocked across all 3
retries — a completely legitimate, correct click on ordinary dynamic content, refused with the
same "likely recycled by a virtualized list" error Milestone 69 introduced.

Root cause: a content-fingerprint mismatch cannot structurally distinguish "this exact DOM node
was recycled to represent a different logical row" (the real PROB-036 bug) from "this exact DOM
node's own content legitimately changed" (a price ticker, a relative timestamp, a live counter)
— both produce the identical signal (same id, same generation, different text). Live-updating
own-content is far more common across real pages than actual list-node recycling, so treating
the ambiguous signal as fatal would have been a worse regression than the bug it fixed.

Fixed within the same session, before this reached a committed "done" state anyone would build
on: downgraded the fingerprint mismatch from a thrown error to a logged warning (the action
still proceeds) — the generation-mismatch check (an unambiguous signal: a real new snapshot
happened) still throws as before, unchanged. `packages/browser` 185/185. Live-verified three
ways: the original recycling repro (still discoverable via the log, not silently swallowed —
an honest trade-off now, not a false prevention claim); the price-ticker repro (now succeeds
normally); a plain unaffected element (regression check). Full downstream rebuild+retest:
`capability-runtime` 90/90, `cli` 29/29, `mcp-server` 25/25, `sutradhar` 11/11, `agent` 56/56,
`apps/server` 28/28 — all green. See `PROB-036`'s revised entry in `.ai/known-problems.md` for
the full before/after.

### 2026-08-17 — Milestone 69: virtualized-list node-id recycling could silently act on the wrong row — closes PROB-036, the deepest grounding-correctness gap found this session

Picked a hard, previously-unprobed hazard rather than another surface-level dogfooding pass:
what happens to a captured node id across a scroll on a list library that genuinely *recycles*
DOM nodes (react-window, MUI DataGrid, and similar — distinct from Milestone 44's "can `scroll`
even reach the container" question, which was already solved). Built a synthetic but faithful
repro matching real recycling behavior exactly (a fixed pool of DOM row elements whose
`textContent`/dataset gets reassigned as different logical rows scroll into view, never
creating/destroying the actual elements) rather than fighting a specific external site's exact
virtualization internals.

Result: a node id captured for "Row 0" before scrolling, then acted on afterward, silently
clicked "Row 50" — the recycled DOM node's real content — while reporting `success:true`. The
existing staleness guard (`assertNotStale`) never caught it: it only compares a stamped
generation against the document's current generation, which only changes on a NEW `snapshot()`
call. Scroll-triggered recycling touches neither attribute — the exact blind spot a confident
false-positive report like this project's own `verify, don't assume` standard exists to prevent.

Fixed: every stamped interactive element now also carries a `data-sd-fp` text fingerprint at
snapshot time; `assertNotStale` compares it against the element's live text in the same single
`evaluate()` round trip as the existing generation check (not a second call — kept as one to
stay a drop-in match for every existing test's mocked call-count). A mismatch throws a distinct,
honest error naming virtualized-list recycling as the likely cause. `packages/browser` 185/185
(new fingerprint-mismatch test + the one existing staleness test updated). Live-verified twice:
the repro above now correctly refuses the click instead of hitting the wrong row, and a normal,
never-recycled click still succeeds (explicit regression check, not just the positive case).
Closes `PROB-036`.

### 2026-08-17 — Milestone 66: `tabs`/`list_tabs` always showed the placeholder `'Adopted Tab'` title, never a real one — same root cause as Milestone 65, one hop further, closes PROB-035

Immediately after landing Milestone 65's "read live, don't trust the cache" fix for `snap`'s
title, checked the obvious sibling code path: `tabs`/`list_tabs`. Found it was actually worse —
not just stale for SPA-style title changes, but **permanently wrong for every tab, always**,
including a plain tab that had never had its title touched at all. Root cause: the CLI's
process-per-command architecture means every tab it ever sees arrives through `attach()`'s
adoption path, which stamps a tab with the hardcoded placeholder `'Adopted Tab'`/`'New Tab'` at
construction and never refreshes it (only `navigate()` does, and an adopted tab is never
`navigate()`d through the runtime).

Fixed: `toTabInfo` (`packages/capability-runtime/src/runtime.ts`) now reads `tab.page?.title()`
live, falling back to the cache only if that call itself fails. This makes `listTabs()` async — a
real breaking-signature change, propagated honestly to all 4 callers rather than papered over:
CLI's two call sites (`await`ed), MCP `browser.list_tabs` (`await`ed), and the SDK's
`Browser.pages()`, which itself had to become `async` (documented in its own doc comment as a
breaking API change, not silently absorbed). `packages/capability-runtime` 90/90 (one existing
test updated to the async-rejection form), `packages/cli` 29/29, `packages/mcp-server` 25/25,
`packages/sutradhar` 11/11. Live-verified through the real CLI binary: one tab navigated plainly
(no title change), a second tab's title changed via `eval` with no real navigation — `tabs`
correctly showed `Example Domain` and `SPA Route Changed` respectively, instead of
`'Adopted Tab'` for both. Closes `PROB-035`.

### 2026-08-17 — Milestone 65: `snap`'s title goes stale on SPA route changes — found testing navigation history, closes PROB-034

Rather than a reflexive blanket CLI-parity sweep (checked the full MCP-tool-vs-CLI-verb diff and
found many gaps this project's own established policy already deliberately defers — `route`,
`emulate`, `extract_data`, etc. — not worth mass-adding without fresh evidence), picked a
genuinely hard, evidence-motivated case instead: browser navigation history (`goBack`/
`goForward`) interacting with real SPA client-side routing (`history.pushState`), the pattern
virtually every modern React/Vue/Next.js app uses instead of full page navigations.

`goBack`/`goForward` themselves worked correctly — real URL history navigation confirmed via
independent `location.href` read-back. But checking the result's own `title` field surfaced a
real, high-value, previously-unknown bug: `snapshot()`/`snap` (the single most commonly used
action in the whole tool surface) reports a **stale** page title for any title change that isn't
a real full page load. `history.pushState` (the entire mechanism of client-side routing) and a
bare `document.title = ...` JS assignment both never fire the `'load'` event `BrowserTab`'s
title-caching relied on exclusively. Live-confirmed: after two simulated SPA route changes (no
real navigation), `snapshot()` still reported the page's very first title. Notably `goBack`/
`goForward`/`reload` were *already* correct — they use a separate `readTitle()` helper that
reads `page.title()` live, proving the fix pattern already existed elsewhere in the same file;
`snapshot()`'s own path just hadn't been brought in line with it.

Fixed: `DOMSemanticEngine.buildGraph` now reads `document.title` live via `page.title()` rather
than the stale cache — the same principle `tab.url`'s own getter already follows successfully.
`packages/browser` 184/184. Live-verified twice: a direct `SutradharRuntime` script confirmed
`snapshot()`'s title correctly updated after simulated SPA routing, and the real CLI binary's
own printed `snap` output confirmed the same end-to-end (`Title: Live SPA Title`). Closes
`PROB-034`.

### 2026-08-17 — Milestone 64: real 3-level nested iframe chain — found and fixed a genuine multi-hop gap in eval/extractData's frame targeting, closes PROB-033

Continuing the hard-use-case hunt with a harder variant of the iframe cases already covered:
genuinely nested iframes (an iframe inside another iframe), not just a single level. Built a
controlled 3-level test page (level 1 → level 2 loads immediately → level 3 injected
dynamically inside level 2 after a delay, mirroring a real chat-widget-lazily-injecting-a-
payment-iframe pattern) rather than hunting for a live public demo of this specific shape.

The main grounding path worked with zero extra effort — `snap`/`click`/`type` correctly found
and interacted with level 3's elements straight away, confirming the existing recursive
`resolveElement` piercing already handles arbitrary nesting depth. But verifying the result via
`eval --frame` (a CLI flag this same session's docs-audit pass had just added) surfaced a real,
separate gap: `resolveFrame` only ever looked one `<iframe>` level deep on the top-level page —
targeting level 2 correctly reached level 2's own content, but had no way to reach level 3
nested inside it. An inconsistency between the two cross-frame mechanisms, not a shared
limitation.

Fixed: `resolveFrame` (shared by `eval` and `extractData`) now accepts a `"::"`-separated chain
of selectors, resolving one hop at a time — backward compatible, a plain single selector behaves
exactly as before. `packages/capability-runtime` 90/90, `packages/cli` 29/29. Live-verified
end-to-end through the actual CLI binary: `eval "..." --frame "iframe::iframe"` correctly
returned level 3's real result text, matching exactly what an earlier `type`/`click` had produced
there. Closes `PROB-033`.

### 2026-08-17 — Milestone 63: WebGL/3D canvas interaction (OrbitControls camera drag) — covered, no bug found

Continuing the hard-use-case hunt with a genuinely different rendering technology from the
earlier 2D signature-pad canvas test: a real WebGL 3D scene (`three.js`'s own live
`misc_controls_orbit` example), where interaction means dragging to orbit a 3D camera, not
drawing 2D strokes.

First attempt (a different three.js example, `webgl_geometry_cube`) turned out to auto-rotate
regardless of input — checked the page's own script tags for `OrbitControls` before trusting a
visual change as evidence of anything, confirmed it wasn't present, and switched to the actual
dedicated OrbitControls demo instead rather than drawing a false conclusion from an
animation-driven false positive. Confirmed the correct demo has no auto-animation (two
screenshots 2s apart with zero interaction were pixel-identical in composition), then used
`dragpoints` (the coordinate-only mouse-down→move→up primitive) to drag across the canvas. The
camera view changed dramatically and correctly — a completely different viewing angle, with real
color (blue-toned pyramids) visible that wasn't rendered from the original angle — confirmed via
before/after screenshots, not the drag action's own success report. No bug found.

### 2026-08-17 — Milestone 62: multi-step form wizard (validation-gated steps) — covered, no bug found

Continuing the hard-use-case hunt with a genuinely common real pattern not yet specifically
tested: a multi-step wizard (checkout/signup flow) where each step gates progression on real
client-side validation. TanStack Form's own live docs example needed a slow-loading embedded
StackBlitz sandbox that didn't render an iframe within a reasonable wait, so built a small,
controlled 3-step wizard instead (name → email → review/submit) to test the same real mechanics
faster and more reliably.

Verified the full flow end-to-end, checking real page text after every step rather than trusting
each action's own success report: clicking Next with an empty name correctly stayed on step 1
with a real "Name is required" error; an invalid email correctly stayed on step 2 with "Valid
email required"; Back correctly returned to step 1 with the previously-typed name preserved;
moving forward again correctly preserved the earlier (invalid) email text for re-editing; a
valid email correctly advanced to a review step showing the real aggregated data from both prior
steps; and Submit correctly produced a final confirmation referencing the actual entered name and
email. No bug found — first-class support for validation-gated multi-step forms confirmed.

### 2026-08-17 — Milestone 60: styled drag-drop file upload widget (FilePond) — covered, no bug found

Continuing the hard-use-case hunt. Tested a real, popular styled upload widget
(`pqina.nl/filepond/`'s own live demo) that hides its native `<input type="file">` behind a
custom drop-zone UI — a very common real pattern. `snap` correctly did **not** stamp the hidden
input (by design — it's not meant to be directly clicked, the drop-zone/trigger is), but
`upload` targeting it directly via a plain CSS selector (`input[type=file]`) worked correctly
regardless of visibility. Verified via independent page-text read-back (not the action's own
success report): the uploaded filename genuinely appeared in FilePond's real file-list UI. No
bug found — this is the already-documented, correct technique for styled upload widgets.

### 2026-08-17 — Milestone 59: OAuth-style popup login flow — covered, real fix from Milestone 58 confirmed working end-to-end; one honest tab-id-stability caveat documented

Continuing the hard-use-case hunt, directly building on Milestone 58's tab-management fixes.
Tested the real popup-login pattern (`window.open(url, name, 'width=,height=')`, exactly how
real "Sign in with Google/GitHub/etc." buttons trigger their auth popups) via a controlled
injected button (no real OAuth provider credentials needed to test the mechanics that matter:
popup detection and post-completion state).

Clicking the "Sign in" button correctly opened a genuine second tab, and Milestone 58's
multi-tab-discovery fix correctly found and listed **both** tabs via a separate `tabs` command —
directly exercising the fix against the exact real-world pattern (a popup window, not just a
manually-opened `newtab`) that originally motivated it. Closing the popup tab (simulating a real
OAuth provider's own post-auth "close this window" behavior) correctly left the session on the
real parent page (`example.com`), confirmed via independent `location.href` read-back.

One honest, documented nuance found along the way: tab **ids** are not stable identifiers across
separate CLI invocations once the tab set changes — they're a counter assigned fresh, in
discovery order, on every `attach()`, not a persistent identity tied to the underlying page. After
closing one of two tabs, the remaining tab's id changed from `..._2` to `..._1` between one `tabs`
call and the next. The *page* was still correct (verified via URL), just the *label* shifted —
worth knowing if scripting multiple tab operations across separate CLI commands, but not a defect:
`tabs`'s whole purpose is to let a caller re-discover the current, authoritative id set before
acting, not to promise id permanence across a changing tab set.

### 2026-08-16 — Milestone 58: CLI tab management added — surfaced and fixed two real multi-tab bugs in the reattach architecture, closes PROB-031

Following up on a concrete gap surfaced while debugging an AliExpress click during the WebBench
rerun (Milestones 56-57): the CLI had **zero** tab-management commands — no way to list, switch,
or close tabs — even though `list_tabs`/`new_tab`/`focus_tab`/`close_tab` fully exist at the
runtime/MCP layer. Added `tabs`, `newtab [url]`, `focustab <tabId>`, `closetab <tabId>`.

Adding them immediately surfaced two real, previously-latent bugs in the CLI's per-process
reattach architecture — the exact kind of bug this new surface finally makes *visible*, since
before there was no way to even ask "what tabs are open":

1. **Multi-tab discovery**: `attach()`'s tab-adoption (`tryFindMostRecentPage`) only ever looked
   at the single most-recently-opened real page via `browser.pages()`, discarding the rest.
   Live-confirmed: after `newtab` opened a genuine second tab, the next `tabs` command (a fresh
   process, fresh `attach()`) listed only one tab — and the wrong one.
2. **Active-tab persistence**: `focustab`'s effect on the session's active-tab pointer is
   in-memory only on the `BrowserSession` object, which is discarded the instant that CLI
   process exits. Live-confirmed: `focustab tab_1` reported success, but the very next command's
   fresh `attach()` reverted to its own default (most-recently-opened), not the just-made choice
   — the same architectural class of bug as `PROB-029`'s `grant` (a CDP/Puppeteer-connection-
   scoped or in-process-only piece of state silently not surviving the CLI's reconnect model),
   just for tab focus instead of permissions.

Fixed both: `attach()` now enumerates and adopts every open non-blank page
(`findAllOpenPages`, replacing the single-page heuristic), preserving the most-recently-opened
page as the default active tab (unchanged single-tab behavior). `CliState` gained an
`activeTabId` field, persisted by `focustab`/`newtab` and restored by `withSession`'s reattach
path — mirroring `PROB-029`'s `grantedPermissions` fix exactly. `packages/capability-runtime`
90/90, `packages/cli` 27/27. Live-verified end-to-end through the actual CLI binary across
multiple separate processes: `newtab` → `tabs` now lists both real tabs; `focustab` → a separate
`tabs` call shows the correct `*` marker, and a separate `eval` call operates on that tab's real
page (confirmed via `location.href`); `closetab` correctly removes a tab. Closes `PROB-031`.

### 2026-08-16 — Milestone 55: `grant` was invisible across CLI commands — a real, precisely root-caused bug, fixed, closes PROB-029

Continuing the hard-use-case hunt: clipboard-paste into a real rich-text editor (Quill). The
core capability (`setClipboard` + `grantPermissions` + Ctrl+V) worked perfectly in a single
continuous script, and confirmed a genuine gap along the way — the CLI had no verb for
`clickAtPoint`/`dragAtPoints`/clipboard/permissions at all (Milestone 51 already closed the
first two; this session closed clipboard + `grant`).

But wiring `grant`/`setclipboard`/`getclipboard` into the CLI and testing the real 3-separate-
process flow (`grant` → `setclipboard` → `getclipboard`) surfaced a genuine, high-severity bug:
`getclipboard` failed with a real `NotAllowedError: Read permission denied`, even though `grant`
had reported success moments earlier against the same persisted browser session. Root-caused
precisely rather than assumed: built a script mirroring the CLI's *exact* architecture
(`spawnDetachedChrome`, then a separate `SutradharRuntime`/`attach()` per "command", explicitly
`disconnect()`-ing the Puppeteer client between each — literally what `cli.ts`'s `main().finally()`
does) — this reproduced the failure exactly. The same script without the explicit `disconnect()`
between steps did NOT reproduce it. Isolates the cause precisely: Puppeteer's
`overridePermissions()` (backing CDP's `Browser.grantPermissions`) does not survive a full CDP
client disconnect/reconnect cycle, even to the same browser and browsing context — a real
Puppeteer/CDP limitation, not a Sutradhar design choice, but one the CLI's one-process-per-
command architecture runs straight into.

Fixed by persisting granted permissions into the CLI's existing `state.json` and re-applying
them on every subsequent reattach, transparently working around the limitation rather than
requiring every caller to understand it. Live-verified end-to-end through the actual CLI binary
across multiple separate process invocations, and confirmed the full real workflow (grant →
setclipboard → click a real Quill editor → `press v --modifiers Control` → paste) lands real
text, verified via independent snapshot read-back. Closes `PROB-029`.

### 2026-08-16 — Milestone 54: async/debounced typeahead search suggestions — covered, no bug found

Continuing the hard-use-case hunt. First attempted DuckDuckGo's homepage search box (a real,
common async-typeahead pattern) but it never showed a suggestions dropdown at all after typing,
even after a 1s wait — checked via broad selectors and confirmed the typed text landed correctly
in the input, so it's not a Sutradhar action failure, just an absence of the expected UI. Didn't
chase this further as a bug: DDG's suggestion behavior is plausibly gated by region/consent state
in this environment, and a second, more reliable target (Wikipedia's search) tests the same
capability cleanly, so this is logged honestly as untested rather than assumed broken.

Wikipedia's real search box: typed a query, real API-backed suggestion options (`role="option"`)
appeared in the very next snapshot with no extra wait needed, clicked one (a genuinely amusing
real result: "Sutradhar v Natural Environment Research Council," an unrelated real Wikipedia
article), and confirmed the click correctly navigated to that exact page via independent
`location.href`/`document.title` read-back. No bug found or fix needed.

### 2026-08-16 — Milestone 53: native `<dialog>`/`showModal()` — covered, no bug found

Continuing the hard-use-case hunt with a genuinely different code path from Milestone 52's
MUI div-based modal: the real browser-native `<dialog>` element via `showModal()`, which gets
special top-layer rendering and background-inertness semantics enforced by the browser itself,
not by application JS.

Verified live (injected a minimal real `<dialog>` + open/close buttons, since MDN's own docs
page had no live embedded sample to drive): clicking a background button while the dialog is
modal-open is correctly refused by the existing occlusion check (`elementFromPoint` resolves to
the dialog/backdrop, not the background button) with a clear, actionable error — safe, correct
behavior. Checked whether Chromium sets a literal `.inert` DOM property on background elements
for this case (it would be a cheap, direct signal to proactively exclude them from `snap`'s
listing) — it does not; `.inert` reads `false` even while the dialog is genuinely modal-open, so
native-dialog inertness is enforced at the rendering/event-dispatch layer, not exposed as a DOM
property. This means the background button still appears in the interactive-element listing
while inert — a minor completeness nuance, not a bug, since the occlusion check already catches
any attempt to click it with a clear error rather than a silent wrong action. Closing the dialog
via its own real close button verified independently via `dialog.open` reading back `false`
afterward. No fix needed.

### 2026-08-16 — Milestone 52: nested modal-in-modal dialogs — covered, no bug found

Continuing the hard-use-case hunt. Considered running another WebBench sample first (the last,
sample 7, ran earlier today) but skipped it — sample 7's failures were dominated by external
anti-bot walls (Cloudflare/DataDome on the homepage itself), not Sutradhar-attributable issues,
and this session's later fixes (scroll, Stripe masking, middle-click, canvas) aren't the class
of thing WebBench's READ-category tasks exercise. The hard-UI-case hunt has a much higher recent
hit rate (real bugs in 3 of the last 5 tests), so continued there instead.

Tested live against MUI's own Nested Modal demo (`mui.com/material-ui/react-modal/#nested-modal`)
— a modal opened from within another modal, real z-index stacking. Opening the child modal
correctly layered on top of the parent (confirmed via DOM text content of all non-hidden
`.MuiModal-root` elements). `clicktext "Close Child Modal"` correctly targeted the topmost
(child) modal's button via the existing occlusion-detection logic and closed only the child,
leaving the parent modal still open — exactly correct nested-modal semantics, verified against
real DOM state rather than trusting the click's own success report. No bug found or fix needed.

### 2026-08-16 — Milestone 51: canvas signature/drawing pad — covered, plus closed a real CLI-exposure gap (clickpoint/dragpoints)

Continuing the hard-use-case hunt with a genuinely different pattern: a `<canvas>` with no
addressable DOM structure inside it, requiring precise coordinate-based mouse-down→move→up
sequences rather than element selectors. Tested live against the real `signature_pad` demo
(`szimek.github.io/signature_pad/`).

`SutradharRuntime.dragAtPoints` (already existed, exposed via MCP as `browser.drag_at_points`)
correctly draws real, clean strokes on the canvas — confirmed visually via screenshot, a
multi-segment zig-zag path landed exactly as intended. (A first attempt at verifying this via
pixel-color counting undercounted badly — anti-aliased stroke edges aren't pure black, so a
strict "R/G/B < 50" threshold missed most of the line; the screenshot made the real, correct
result obvious immediately. Worth remembering: prefer a visual/screenshot check over a brittle
pixel-threshold heuristic when verifying canvas drawing.)

Found a real, if minor, gap along the way: `clickAtPoint`/`dragAtPoints` were only reachable via
MCP/SDK — the CLI, whose whole reason for existing is direct scriptable access, had no verb for
either, meaning canvas-based interaction (signature pads, custom sliders, chart handles — any
UI with nothing DOM-addressable) was completely unreachable from the CLI. Added
`clickpoint <x> <y>` and `dragpoints <fromX> <fromY> <toX> <toY>`, mirroring the existing
`click`/`drag` commands' pattern exactly. `packages/cli` 27/27 (no parse-args changes needed —
both are plain positional args). Live-verified through the actual CLI binary: `dragpoints` drew
a real diagonal stroke, `clickpoint` added a visible dot on it, both confirmed via screenshot.

### 2026-08-16 — Milestone 50: middle-click opened a duplicate tab — found by sweeping for the same bug shape as PROB-027, closes PROB-028

After Milestone 49 fixed `scroll`'s `'top'`/`'bottom'` bug (a binary branch on a 3+-value enum
silently mishandling the non-`'down'` values), swept the rest of `browser-action-engine.ts` for
the same shape before picking a fresh UI pattern. Found one: `verifiedClick`'s delivery-detection
and JS-click fallback were both only button-aware for `'right'` — `'middle'` silently inherited
`'left'`'s behavior on both sides.

Verified live rather than assuming: a real `target="_blank"` link, middle-clicked via
`clickWithButton`, genuinely fires `auxclick` (confirmed — not `click`, per spec). But the
delivery marker was listening for `'click'`, misread the middle-click as undelivered, and fired
the fallback — which unconditionally calls `element.click()`, a plain left-click simulation. For
a `target="_blank"` link, a left click ALSO opens a new tab — so a single middle-click action
produced **two** new tabs (3 total including the original), confirmed via `listTabs()`.

Fixed both sides to be three-way button-aware, matching the existing `'right'`-handling pattern
exactly: `'middle'` now listens for `auxclick` and, on genuine non-delivery, dispatches a
synthetic `auxclick` (not `element.click()`). 2 new unit tests, `packages/browser` 184/184.
Live-verified: before the fix, 3 tabs total and a spurious extra `click` event (the fallback
firing); after, exactly 2 tabs and only the real `auxclick` — no fallback triggered for a cleanly
delivered middle-click. Closes `PROB-028`.

### 2026-08-16 — Milestone 49: infinite-scroll pages — a high-severity `scroll bottom`/`scroll top` bug found and fixed, closes PROB-027

Continuing the hard-use-case hunt. Tested live against a real infinite-scroll demo (append-more-
content-on-scroll — distinct from a virtualized/recycling grid, already covered in Milestone 44).

Found a serious, silent bug: `scroll bottom` reported success on every call, but
`window.scrollY` stayed at exactly 0 across repeated invocations. Root cause: `'top'` and
`'bottom'` were never actually implemented as jumps to the real scroll boundary — the direction
check only ever branched on `=== 'down'`, so anything else (including `'top'`/`'bottom'`) fell
through to the "scroll up by `amount`" branch. From `scrollY=0`, scrolling up 500px is a no-op
(can't go negative) — and the existing boundary-aware error-suppression logic (`before <= 1` for
"not down") then read that no-op as "already at the boundary, nothing wrong to report," so no
error ever surfaced. `scroll bottom` was silently doing the *opposite* of its name with total
confidence. This bug predates the Milestone 44 element-targeted-scroll work — it was inherited
from the original window-scroll code, and no test anywhere in the suite ever exercised `'top'`
or `'bottom'` (confirmed: zero prior references).

Fixed both the window-scroll and element-targeted-scroll paths: `'top'` now sets
`scrollTop`/scrolls to `(0,0)` directly, `'bottom'` now sets `scrollTop = scrollHeight` / scrolls
to the document's real `scrollHeight` directly — true boundary jumps, not a relative move. 3 new
unit tests, `packages/browser` 182/182. Live-verified end-to-end through the actual CLI binary:
before the fix, `scroll bottom` left `scrollY` at 0 every time; after, it correctly landed at the
real bottom (2652) **and** this genuinely triggered the page's infinite-scroll library to load
more content (post count 2 → 5, confirmed via independent `eval` read-back) — the actual
real-world use case `scroll bottom` exists for. `scroll top` confirmed to correctly return to 0.
Closes `PROB-027`.

### 2026-08-16 — Milestone 48: rich-text-editor toolbar formatting (Quill) — real CLI-only bug found and fixed, closes PROB-026

Continuing the hard-use-case hunt beyond the original 5-item list. Tested live against Quill's
own playground (`quilljs.com/playground/snow` — a real cross-origin CodeSandbox iframe editor).
Typing into the editor and single-keypress interactions worked correctly immediately. The harder
case — select a word via keyboard (`Home`, then `Ctrl+Shift+ArrowRight`), then click a toolbar
button to format the selection — worked correctly when scripted directly against
`SutradharRuntime` in one continuous process, but silently produced an *empty* selection (no
error, both presses reported success) when driven through the real CLI binary command-by-command.

Root cause: `cmdPress` re-focused its target via `runtime.click()` before every single keypress —
a real click resets the cursor to the click point, discarding whatever cursor/selection state a
*previous* `press` call in the sequence had already built. `Home` moved the cursor to position 0;
the next `press`'s own auto-click then moved it right back to wherever a click on the paragraph
lands, before `Ctrl+Shift+ArrowRight` ever ran — so the selection extended from the wrong place
(specifically: nowhere real ended up selected in this repro). This is CLI-specific: a
`SutradharRuntime` script issuing both presses in one session doesn't re-click between them the
same way (my test script only called `.click()` once, up front).

Fixed properly rather than patching around it: the engine already had a real `focus` action
(`.focus()`, doesn't move the cursor) that was never wired above `browser-action-engine.ts`.
Added `SutradharRuntime.focus()` + a matching `browser.focus` MCP tool (surface parity), and
switched `cmdPress` to use it instead of `click`. Also added the CLI's missing `--modifiers`
flag for `press` while in the area — the engine/runtime already supported modifier keys, only the
CLI had no way to pass them (the same "capability exists, CLI verb doesn't expose it" pattern
from the field-report remediation).

`packages/capability-runtime` 90/90, `packages/mcp-server` 25/25 (one hardcoded tool-count
assertion needed updating — caught immediately by the real test run, the exact drift pattern
`PROB-004`'s history warns about), `packages/cli` 27/27. Live-verified end-to-end through the
actual CLI binary with before/after screenshots: before the fix, `Home` + modifier-`ArrowRight`
left no visible selection; after, "CLI" is visibly highlighted, and clicking Bold genuinely
renders it bold (toolbar B icon shows active state). Closes `PROB-026`.

### 2026-08-16 — Milestone 47: portal-rendered searchable multi-select combobox (react-select) — covered, no bug found

Continuing to find fresh hard cases beyond the originally-planned 5-item list. Tested live
against `react-select.com`'s own demo — a real, common, tricky pattern (options list rendered
outside the normal DOM flow via a portal, filter-as-you-type, chip-based multi-value display).

Both real interaction modes verified end-to-end: click-to-select (click field → type search term
→ click the filtered `role=option` result → confirm the resulting "Remove X" chip via a fresh
snapshot) and pure keyboard-driven selection (type a search term → `press ArrowDown` → `press
Enter`, no click on the option at all → confirmed the chip landed correctly). Both work correctly
with no engine changes needed — a clean "covered" result.

### 2026-08-16 — Milestone 46: complex date-range picker widget — covered, no bug found, confirms the grounding's own honest stale-id refusal working as designed

Closing out the hard-use-case todo list's fifth item (a complex date-range picker) against the
real `daterangepicker.com` demo. Two real findings, both positive:

1. The page has **9 identical widget instances** (one per code example on the page), all sharing
   the same `.daterangepicker`/`.drp-calendar` classes — only one visible at a time. A hand-written
   CSS selector (`.daterangepicker.show-calendar td.available`) landed on a *hidden* instance
   (`querySelector` returns DOM order, not visibility order) and silently failed to select
   anything. Sutradhar's own `snapshot` sidesteps this entirely — it only ever stamps elements
   that are actually visible, so the id-based approach worked correctly on the first try with no
   extra visibility filtering needed.
2. `daterangepicker.js` re-renders its calendar `<table>` after every day-cell click (a real,
   common pattern for these widgets — not React-specific). The previously-stamped end-date cell's
   id was correctly refused as stale ("node id 291 is not present in the current snapshot
   generation... call browser.snapshot again") rather than misclicking or silently no-op'ing —
   exactly the honest-refusal behavior this project built earlier (the field-report remediation's
   navigation-aware stale-id message). Following that advice — re-snapshotting between the two
   day-cell clicks — completed the full flow correctly: start date (Aug 5), end date (Sep 18),
   Apply, with the input's real value landing as `"08/05/2026 - 09/18/2026"`, confirmed via
   independent read-back after the fact, not just trusting each click's own success report.

No engine bug found or fix needed — a genuine "covered" result, not a gap. Closes the originally
planned 5-item hard-use-case list (Monaco, SortableJS/drag-and-drop, virtualized data grid,
Stripe Elements checkout, date-range picker); continuing to find fresh hard cases per the
standing "keep going" directive rather than treating this list's exhaustion as a stopping point.

### 2026-08-16 — Milestone 45: real Stripe Elements checkout — a genuine verification false-negative fixed, a deeper retroactive-corruption bug found and honestly documented, closes PROB-025

Continuing the hard-use-case hunt (todo item 4: "a real multi-step checkout with nested iframe
payment fields, Stripe Elements"). Tested live against the official
`stripe-payments-demo.appspot.com` — real cross-origin Stripe Elements iframes for card number,
expiry, and CVC.

**First finding, fixed**: typing a valid test card number ("4242424242424242") into the real
card-number iframe field correctly landed the value, but `clearAndType`'s read-back verification
(raw string equality) reported it as a **failure** — Stripe's field legitimately reformats input
as you type (spaces every 4 digits; a slash after `MM` in the expiry field), so the landed value
never exactly matches what was typed even when it's completely correct. Fixed by comparing only
the alphanumeric characters on both sides (tolerates inserted formatting punctuation/whitespace,
still catches genuine truncation/wrong-digit/reordering failures since the alphanumeric sequence
itself still has to match).

**Second finding, precisely diagnosed and honestly NOT fully fixed**: while re-verifying the fix,
a screenshot showed the card number field genuinely reading a truncated value in a full 3-field
run. Investigated rigorously rather than assuming — five separate isolated `SutradharRuntime`
repros ruled out red herrings one at a time: Stripe's own "collapse to a last-4-digits + brand
icon summary" UI after a *valid* complete card number initially looked like data loss but is
legitimate UX (confirmed the underlying value landed correctly at t+100ms before the collapse);
a naive elapsed-time hypothesis was disproven by watching the expiry field stay stable and
correct for 15+ seconds in isolation; a plain click focusing a different field (no typing) also
left it untouched. The real, repeatable trigger: typing "1230" into the expiry field lands and
verifies correctly as "12 / 30" — genuinely correct at that moment — but the instant the **CVC
field is typed into** (the very next, completely ordinary step in any real checkout), Stripe's
shared internal Card Element state re-renders the expiry field's display from its own internal
model, which still hadn't fully registered the last keystroke, silently truncating it to
"12 / 3". Confirmed this is a real, consequential bug, not cosmetic: attempting to pay in that
state produces Stripe's own "Your card number is incomplete" validation error.

Attempted an engine-level fix (force a real `blur()` + re-check + `focus()` whenever masking is
detected) on the theory that blur triggers the canonicalization — built it, tested it, live
re-verified against the exact repro, and it did **not** catch the bug: a field's own blur+refocus
doesn't reproduce the failure (confirmed live), only a *sibling* field's later typing does. Rather
than ship an incomplete fix and claim victory, left the honest gap documented: this specific
retroactive-corruption class can't be caught by a single-field verification check because the
corruption is caused by an action on a *different* field, not anything happening to the field
itself. The blur+refocus change was kept anyway — it's a real, low-cost robustness improvement
for the more common general case of a field that DOES canonicalize on its own blur, even though
it didn't turn out to be this specific bug's mechanism.

**Verified, working mitigation**: a final group-wide `browser.snapshot` after filling all related
masked fields (not trusting each field's own individually-reported success) reliably surfaces the
corruption — live-confirmed by filling all three Stripe fields and seeing the truncated expiry
value in the final snapshot, exposing it before a real payment attempt would have hit the same
wall. Documented as the standing technique for any masked-field-group scenario.

6 new unit tests, `packages/browser` 180/180 — all live-verified against the real `browser-*`
CLI/runtime path (not just mocks): the formatting-tolerance fix, the blur-recheck's real (if
narrower-than-hoped) value, and the final-snapshot mitigation actually catching the corruption.
Closes `PROB-025` (partially — see its "PARTIALLY RESOLVED" status, which is the honest state).

### 2026-08-16 — Milestone 44: nested/independent scroll containers — a real gap found via MUI's DataGrid, closes PROB-024

Continuing the hard-use-case hunt (todo item 3: "a virtualized/infinite-scroll data grid").
Tested live against MUI X's `DataGrid` demo page, which — deliberately hard-case — renders
**three** grids on one page, only one of which actually overflows (`scrollHeight - clientHeight`
of 0, 0, and 593px respectively; a naive class selector would silently match the wrong one).

Found a real, previously-undocumented gap: `scroll` only ever called `window.scrollBy()`. A page
owning its own `overflow:auto`/`scroll` container (virtualized grids, chat panes, modal bodies,
code blocks — all common, real UI patterns) was completely unreachable by `scroll` with **no
error** — a silent no-op indistinguishable from success. The only workaround was `eval` with a
manual `el.scrollBy()`, strictly worse UX than a first-class action.

Digging into it also surfaced a second, related timing gap: MUI's `DataGrid` virtualization
re-renders **asynchronously**, not synchronously with the scroll event. A correctly-targeted
element scroll could read back stale (pre-scroll) row content if read immediately after —
confirmed by reproducing it with a raw script (scrollTop genuinely moved, row `data-id`s
unchanged in an immediate read, but completely different after a manual 500ms delay). Exactly
the class of flake `settle` (Milestone 38) exists to solve — extended `settle` support to
`scroll` and confirmed it resolves the same timing issue with no manual delay needed.

Fix: `scroll` gained an optional `selector`/`target` param — when given, scrolls the resolved
element directly (not `window`), with its own before/after `scrollTop` read-back and
boundary-aware verification (a clear, element-specific error only when genuinely stuck, not
already at the scroll boundary). Falls through to the existing, unchanged window-scroll path
when no target is given. Wired through all four layers: `browser-action-engine.ts`,
`capability-runtime`'s `scroll()`, MCP `browser.scroll` (`target`, `settle`), CLI
`scroll [dir] [amountPx] [targetRef] [--settle]`. 4 new unit tests
(target-scroll success, stuck-error, boundary-no-false-fail, default-fallback-regression) —
`packages/browser` 176/176.

Live-verified end-to-end through the **actual CLI binary** (not just a `SutradharRuntime`
script) against the real grid: correctly identified the one grid of three with real overflow,
`scroll down 500 [data-test-scroller="true"] --settle` moved `scrollTop` 0→500 and the rendered
row genuinely changed (`"Adzuki bean (4)106,726"` → `"Milk (3)128,346"`, independently confirmed
via `eval` read-back — real virtualized re-render, not the command's own success claim);
separately confirmed the no-target default path still only moves the window and leaves the
grid's `scrollTop` untouched (regression check). Closes `PROB-024`.

### 2026-08-16 — Milestone 43: hunting the hardest real use cases (new user directive) — Monaco Editor documented, PROB-013 finally closed via real CDP event-listener introspection

The user redirected the standing loop after a check-in: instead of grinding through
`.ai/known-problems.md`'s remaining backlog, actively hunt the hardest real-world use cases and
fix whatever breaks. First two targets:

**Monaco Editor (VS Code's web editor)** — already fully usable, but only via a real,
non-obvious technique now documented as `.ai/known-problems.md`'s "Documented technique"
section: modern Monaco's real input target is an invisible, zero-box `EditContext`-API div that
`click`/`type` correctly refuse to act on; the working path is targeting the visible
`.monaco-editor .view-lines` surface instead. Also caught a real, generalizable lesson: a
`snap` taken immediately after navigation grabbed a transitional `<textarea>` that Monaco's own
init sequence had already discarded by the time anything tried to act on it — concrete evidence
for why `settle` (Milestone 38) matters when acting on a heavy JS framework right after
navigating into it.

**SortableJS-based drag lists** — a real, hard gap, live-reproduced: draggable list items are
plain `<div>`s with no `draggable` attribute, `cursor:auto`, `user-select:auto` — zero CSS/ARIA
signal, invisible to every existing heuristic (confirmed via live computed-style inspection, not
assumed). This is exactly the gap `PROB-013` had deferred as "materially larger... needs CDP
`DOMDebugger.getEventListeners`" — now justified by a real example, so built it: an opt-in
`scanEventListeners` pass (`snap --scan-listeners` / `browser.snapshot`'s `scanEventListeners`
param, off by default), entirely within one CDP session (`DOM.getDocument({pierce:true})` +
`DOM.querySelectorAll` finds candidates across frames/shadow roots in one call,
`DOMDebugger.getEventListeners` checks each for a genuine interaction listener,
`Runtime.callFunctionOn` stamps real matches — all CDP-native, since a Puppeteer
`ElementHandle`'s `objectId` belongs to a different session and wouldn't resolve here), bounded
to 150 candidates. Live-verified: default snapshot finds 0 of 6 real draggable items; with the
new flag, correctly found and stamped the container in 129ms.

Found and documented an honest nuance along the way rather than overclaiming: SortableJS
attaches its listener to the *container* via event delegation, not each item, so the scan
surfaces the container, not individual items — but `drag_and_drop` targeting a real child
selector (`:nth-child(N)` on that container) still works, since the delegated handler receives
the bubbled event regardless. Live-verified end to end: a real `drag_and_drop` call genuinely
reordered the list (Item 1 moved from position 1 to position 3, confirmed via the real DOM
order before/after). Closes `PROB-013`. `packages/browser` 172/172, `packages/capability-runtime`
90/90, `packages/mcp-server` 25/25, `packages/cli` 24/24 — all green.

### 2026-08-16 — Milestone 41: `click_by_text` routed through the occlusion-safe path — closes PROB-012

A real, previously-deferred gap (`PROB-012`, first found and deliberately deferred back during
the field-report remediation's Phase 2): `click_by_text` called `element.click()` directly
instead of going through `verifiedClickOnHandle` the way `click`/`click_by_role` already do —
an occluding overlay would never be detected, and the action would report success even though
the real click landed on whatever was actually on top. Fixed: `click_by_text` now calls
`assertNotStale` + `verifiedClickOnHandle`, the exact same path `click_by_role` uses, and is
added to `ExecutionVerifier`'s `SELF_VERIFYING_ACTION_TYPES`. Live-verified against a real
Chrome fixture: an unobstructed `click_by_text` succeeds and the real click handler fires; the
identical call against the same element with a full-viewport overlay now correctly fails with
an "occluded" error and the handler does NOT fire — previously it would have fired regardless,
a genuine silent-failure risk this closes. 2 new unit tests; `packages/browser` 170/170 green.

### 2026-08-16 — Milestone 39: snapshot verbosity dial (`--no-text`/`--ids-only`) — closes the INSIGHTS.md campaign's full priority stack

Closes INSIGHTS.md Insight 6's remaining ask ("Add verbosity levels: `--ids-only`, `--no-text`,
`--max-elements K`" — `maxElements` already existed from Milestone 8). `formatGraphForLlm` gained
a `FormatGraphOptions` param: `noText` keeps tag+role+id per line, dropping accessible-name/
label/placeholder/value text (for a caller that already knows what it's targeting and just needs
fresh ids after a re-render); `idsOnly` goes further, dropping everything but the bracketed id
(smallest possible listing, at the cost of no longer being self-describing). Wired through
`runtime.snapshot`'s existing options bag (alongside `includeNodes`), the `browser.snapshot` MCP
tool schema, and CLI `snap --no-text`/`snap --ids-only`.

Live-verified against a real page (the-internet.herokuapp.com/login, 6 real interactive
elements): default listing 239 bytes → `--no-text` 154 bytes (36% smaller) → `--ids-only` 121
bytes (49% smaller) — real, measured savings, not a theoretical estimate. 4 new unit tests for
`formatGraphForLlm`'s new options (default unaffected, noText drops text, idsOnly drops
everything but id, idsOnly takes precedence if both are somehow set). `packages/browser` at
168/168, `packages/capability-runtime` at 90/90, `packages/mcp-server` at 25/25, `packages/cli`
at 22/22 — all green.

This closes out every item on INSIGHTS.md's own priority stack (Milestones 30, 32, 33/34, 35 ×2,
36, 37, 38, 39 — everything except the deliberately-rejected UA-default-flip, Insight 4, which
contradicts this project's standing anti-stealth-default policy and was flagged to the user
rather than built).

### 2026-08-16 — Milestone 38: post-action settle waits (`settle` param) — the last of INSIGHTS.md's priority-stack items

Closes INSIGHTS.md Insight 2 ("flakiness lives at state transitions, not at actions... nobody
has productized the post-condition side — a built-in post-action settle would make first-run
reliability equal retry reliability") — the #2 item on INSIGHTS' own priority stack and the one
explicitly flagged earlier this session as needing careful scoped design before building.

New opt-in `settle` param (`ActionParams.settle: boolean | SettleSpec`, default off — this adds
real latency so it's deliberately per-call, not a blanket auto-wait on every action). After a
successful dispatch and before verification, `waitForSettle` runs two checks in parallel, both
bounded by an overall timeout (default 5s): a `MutationObserver`-based DOM-quiet wait (default
300ms of zero mutations) and Puppeteer's own real `page.waitForNetworkIdle` (default 500ms,
tracks actual in-flight CDP requests — not reimplemented by hand). Neither throws on its own
timeout — a page with continuous background chatter (ads, polling, a live ticker) just means the
bound was reached, not a failure.

Scoped deliberately narrow rather than touching every action type's signature: exposed on
`runtime.click`/`runtime.type` only (the two actions INSIGHTS' own examples are about — a click
that fires before a menu renders, a submit whose toast hasn't appeared) and wired through to
`browser.click`/`browser.type` MCP tool schemas and CLI `click`/`type --settle`. Broader coverage
across all ~20 action types deferred to a future pass if it proves needed — `verificationSpec`
(the closest existing analogous opt-in param) was never wired through the convenience methods
either, so this isn't a new gap, just not fully closed everywhere at once.

Live-verified end to end (SDK direct + CLI) against a purpose-built fixture: a button whose click
handler renders a new DOM element 400ms later (a real async-menu-render race). Without `settle`,
`click` returns in ~73ms and the element isn't there yet — confirming the flake this feature
targets is real. With `settle:true`, `click` returns only after the element has actually
rendered (both via `SutradharRuntime.click` directly and via the built CLI's `--settle` flag) —
confirming the fix actually works, not just that it doesn't throw. 4 new unit tests (default-off,
requested-on with exact spec values asserted, partial-spec-with-defaults, and a
does-not-fail-the-action-if-the-wait-itself-times-out case) — `packages/browser` at 164/164,
`packages/capability-runtime` at 90/90, `packages/mcp-server` at 25/25, `packages/cli` at 20/20,
all green.

### 2026-08-16 — Milestone 37: grounding-completeness contract test — 25/25 element types verified, wired as a real CI gate

Closes INSIGHTS.md Insight 3 ("build a grounding completeness matrix page and CI-assert that
every type appears in snap or has a documented alternative command — the README's promise
should be enumerable"). New `tools/scenario-suite/fixtures/grounding-completeness.html` — one
instance of every canonical interactive element type (native button/link/every common `<input
type>`/textarea/select/contenteditable/label/summary, ARIA role=button/option, onclick-only and
cursor:pointer-only divs, plus the legitimate exceptions: video, canvas, open shadow DOM, closed
shadow DOM, a same-origin iframe) in one page, each tagged `data-expect="snap"` or
`data-expect="alternative:<name>"`. `tools/scenario-suite/grounding-completeness.mjs` asserts
each `snap`-expected element got the real `data-sd-node-id` stamp after a real `snapshot()` call
(a precise id-based check, not fuzzy text matching), and independently verifies each named
alternative actually works: video's eval-based media API, canvas's `click` `offset` param, an
open shadow root's real content pierced and grounded, a closed shadow root's genuine
inaccessibility (confirmed via `shadowRoot === null` — a real browser security boundary, not a
gap), and a same-origin iframe's real content pierced and grounded. Live run: **25/25 checks
passed**. One real fixture bug caught and fixed along the way (not a Sutradhar bug): a
`src='about:blank'` + dynamic-write iframe pattern doesn't reliably become same-origin-accessible
under a `file://` parent document specifically — switched to `srcdoc`, which works consistently
regardless of the parent's scheme. Wired into `scenario-suite.yml` as a real, ungated (no
`if:always()`) failure gate — deterministic and self-contained (no external sites), unlike the
14-scenario harness alongside it, so a real regression here should fail the job like any other
gate.

### 2026-08-16 — Milestones 30-35: a second independent field campaign's insights (INSIGHTS.md), six real fixes, one long-standing misdiagnosis corrected

A separate, independent 3-version (0.2.0→0.2.2→0.3.0) benchmark campaign produced `INSIGHTS.md`
— a fresh, real-usage-driven gap analysis distinct from GLM's original field report. Fact-checked
against source before acting (one insight — flipping the default headless UA — was explicitly
rejected as contradicting this project's standing anti-stealth-default policy; the rest were
genuine and actionable). Executed in priority order, each fixed, typechecked, unit-tested, and
live-verified against real Chrome before moving to the next:

- **Milestone 30 — `assertEffect` extended to 5 more action types.** `select_option`/
  `upload_file` now read back the real landed value/file from the DOM; `scroll` reads real
  `scrollY` before/after (boundary-aware, so a legitimate no-op at top/bottom isn't a false
  failure); `drag_and_drop` uses a delivery-marker pattern for the real `'drop'` DOM event
  (per the HTML5 spec, only fires if the target's `dragover` handler calls `preventDefault()` —
  a genuine signal, not a rubber stamp); `hover` needed only a verifier registration (its real
  occlusion check already existed). Live-verified all five against a real Chrome fixture,
  including a negative case: `drag_and_drop` onto a target with no `dragover` handler correctly
  fails after 3 real retries with the genuine reason, proving the check isn't decorative.
- **Milestone 31 — CLI session self-healing.** `withSession()` used to hard-error on a dead
  previous session, forcing a manual `close` before the next command — a real stall for an
  hours-long unattended CLI-driven agent session. Now self-heals: kills the old Chrome tree,
  clears stale state, transparently spawns a fresh session. Live-verified: injected a
  `state.json` pointing at an unreachable port, confirmed the self-heal note, real fresh
  navigation, a valid new state file, and correct reuse by a follow-up command.
- **Milestone 32 — `allowedDomains` navigation guardrail**, CLI/SDK/MCP (`--allowlist-domains`,
  `launch({allowedDomains})`, `SUTRADHAR_ALLOWED_DOMAINS`). Blocks explicit runtime-initiated
  navigation off a domain list — composable with `restrictNavigationToLocal`. Documented
  honestly (not overclaimed): only covers `navigate`/`launch`/`audit`/`compareUrls`/`createTab`,
  NOT page-initiated navigation from a clicked link (CDP doesn't route that through this check) —
  logged as `PROB-018` rather than oversold as full prompt-injection defense.
- **Milestone 33/34 — the 3-surface scenario-suite harness wired into real CI**
  (`.github/workflows/scenario-suite.yml`, scheduled + `workflow_dispatch`, not a PR gate since
  it hits real external sites). A full local dry run done specifically to validate this
  end-to-end surfaced two real bugs in the harness itself before either shipped: (a) the SDK
  driver crashed outright on UC-07 with an unhandled rejection (`PROB-019`), and (b)
  `ci-gate.mjs`'s own missing-results-file health check was silently masked by committed
  historical baseline files that `actions/checkout` leaves in place regardless of whether the
  current run produced fresh ones (`PROB-020`) — exactly the "silent false-green" failure mode
  the gate exists to prevent, caught before it ever shipped. Both fixed and re-verified.
- **Milestone 35 — CLI `profile export-state`/`import-state` + `audit --baseline`.** Building
  the profile-state verbs surfaced a real, previously-silent gap (`PROB-021`): the runtime's
  save/restore-on-launch machinery only fires for sessions IT launches, but the CLI always
  `attach()`es to a separately-spawned Chrome instead — so profile storage-state never actually
  saved or restored for any CLI session, silently. Fixed on both ends (save-on-close,
  restore-on-nav) and live-verified as a genuine full round trip: log in under profile A, close,
  export to a portable file, import into a completely fresh profile B that never visited the
  site, nav under B, read back the value only ever set under A. `audit --baseline <url>` folds
  audit + visual compare into one command with a shared `--fail-on-diff` gate, live-verified in
  both directions (0% diff passes, a real diff with the flag exits nonzero).
- **A genuine misdiagnosis corrected, not just a bug fixed**: investigating Milestone 33's UC-07
  crash led to discovering that the long-standing "no typing into cross-origin iframe bodies"
  gap (GLM's original C4, carried in `RESPONSE-TO-FIELD-REPORT.md` as "not addressed this
  round") was never actually a same-origin-policy limitation at all — see the updated iframe row
  above and `PROB-022` for the full investigation. `RESPONSE-TO-FIELD-REPORT.md`'s C4 row
  updated to reflect this rather than leaving a working capability mislabeled as an open gap.

All six milestones committed and pushed individually (`Milestone 30` through `Milestone 35` in
git history) with their own live-verification evidence; nothing here was typecheck-only.

### 2026-08-16 — Milestone 29: field-report remediation, 8 phases — 12 real bugs fixed (5 from GLM's report, 7 found along the way), a release-integrity gate built, all live-verified

An independent field-report campaign (GLM 5.3, testing the published `sutradhar` npm package,
`GAPS_AND_SUGGESTIONS.md`/`REPORT.md` at the repo root) found 5 real bugs (A1-A5) and several
gaps. Planned thoroughly in an Opus 5 planning session, approved, then executed phase-by-phase
across this whole session — full detail in `.ai/field-report-remediation-plan.md` (8 phases,
each with a RESULT block written at completion, not just planned) and
`tools/scenario-suite/BEFORE-AFTER.md` (the full per-scenario, per-surface before/after, with
every non-flip explained honestly, not just the flattering half). This entry is the
capability-loop-side summary; don't duplicate the detail here.

**Fixed, all live-verified against real Chrome, not just typechecked**: A1 (`type()` silently
reporting success while leaving a field empty — read-back + native-setter-repair + honest
throw), A2 (retry interleaving/tripled keystrokes — await a timed-out dispatch's real settlement
before retrying), A3 (modal/handler-driven elements invisible to `snap` — extended interactive
detection + a `cursor:pointer` fallback; the exact GLM-reported modal now detects, clicks, and
genuinely dismisses), A4 (stale popup title/URL — a `'load'`-listener refresh + a `toDto()`
fix), A5 (unhelpful post-navigation stale-id errors — now tells the agent to re-snapshot). Plus
7 more bugs found live, not in the original report: a duplicate-action-guard false positive on
`click_by_role`/`click_by_text`; a Windows case-sensitivity bug in the download-directory
containment check; a second, more consequential download bug (Chrome cancels any download
targeted at the bare OS temp root — silently broke every default-directory download until
fixed); a `getStorageState()` bug returning the full URL mislabeled as "origin"; a stale-CLI-test
gap where the harness itself still used pre-Phase-4 workarounds for two commands after the real
commands existed; a genuinely unrelated `capability-runtime` build blocker (`@types/pngjs` was
correctly declared but never linked — `pnpm install` fixed it permanently, not just for this
build); and the release-integrity gap below.

**New capability surface**: 8 new CLI commands (`select`, `wait`, `eval`, `hover`, `scroll`,
`upload`, `drag`, `download`), structured `snap --json` output, a `--user-agent` option across
CLI/SDK/MCP (neutral default — does NOT strip "Headless", locked in by a unit test), and
profiles wired to real storage-state persistence (a `sessionStorage`-based login now genuinely
survives a named-profile relaunch — proven with a purpose-built fixture, since GLM's suggested
test case, saucedemo, turned out to be cookie-based on live inspection, already covered by
`userDataDir` alone).

**Release-integrity gate** (Phase 6): a past published npm artifact once diverged from its own
source tree for an unrecoverable-from-git reason (workspace packages resolve through compiled
`dist/`, which had no clean-rebuild guarantee). Built `scripts/workspace-graph.mjs` (computes the
real dependency closure from `package.json`, not a hand-maintained list) + a clean-rebuild step
in `build-bundle.mjs` + a `prepublishOnly` gate (`check-release-ready.mjs`) that fails on a dirty
tree or stale workspace `dist/` + a `postpack` shasum-recording hook. All three live-verified
by actually inducing the failure conditions through the real `npm publish --dry-run` command,
not by reading the scripts.

**Final numbers** (`tools/scenario-suite/BEFORE-AFTER.md` has the full matrix and honest
per-scenario explanation of every non-flip): MCP reaches a full **14/14** clean sweep (up from
11/14). SDK and CLI both show real, independently-verified fixes whose raw pass/fail counts
don't fully capture the improvement — one residual, honestly-logged flake (`PROB-015`: UC-05/
UC-14 pass reliably in isolation but still show intermittent timing races deep into a long
sequential 14-scenario run; root mechanism not fully identified) and one pre-existing, genuine
CLI-surface gap (no tab-listing/switching command) are documented rather than hidden.

### 2026-08-16 — Milestone 28: real capability gap found via a 4-way hard-case comparison, fixed, live-reverified

`eval()`/`extractData()` could not read into a genuinely cross-origin iframe — both always ran
via `page.evaluate()` on the top-level page, subject to same-origin policy like any page script,
unlike `click`/`type` which already cross frame boundaries via `browser-action-engine.ts`'s
`resolveElement()` racing `page.frames()`. Found via a real, sourced 7-scenario hard-case
comparison against Playwright/Puppeteer/real pinchtab (see `.ai/competitive-benchmarks.md`
Milestone 28 for the full comparison and fix detail — this entry is the capability-loop-side
summary). Fixed with an additive, backward-compatible `frameSelector` parameter on both methods,
resolving the target iframe's real `Frame` via Puppeteer's `ElementHandle.contentFrame()`
(CDP-level, not subject to the same-origin restriction page.evaluate() hits) — no bigger
frame-listing subsystem built, since the realistic case (an agent that already knows a specific
iframe's selector) doesn't need one. Exposed via `SutradharRuntime`, the `browser.eval`/
`browser.extract_data` MCP tools, and the SDK's `Page.evaluate()`. 6 new unit tests +
full vitest suites (capability-runtime 77, mcp-server 22, sutradhar SDK 7) pass. Live-reverified
against the real scenario that found the gap — both `eval()` and `extractData()` now correctly
read real cross-origin content (`"Example Domain"`), and the old outer-page path was confirmed
to still correctly fail (a real browser security boundary, not something the fix should or does
bypass).

### 2026-08-14 — Milestone 22: real Playwright hits the identical real-world blocks

Direct (not analogous) evidence that Sutradhar isn't at a disadvantage versus real Playwright
on the exact real-world anti-bot walls the WebBench samples hit — ran actual `playwright-core`
(plain `chromium.launch()`, no stealth) against 6 of the blocking URLs; identical outcome on
every one (same Cloudflare challenges, same hard deny, same CAPTCHA class). Full detail in
`.ai/competitive-benchmarks.md`'s iteration log; script kept at
`tools/engine-comparison/playwright-real-world-blocks.mjs`.

### 2026-08-14 — Milestone 19: docs re-audit, then closed the last real taxonomy gap

Before picking a new capability task, re-audited docs for staleness against everything
shipped in Milestones 9-17 (network conditions, fill_form, click_at_point, drag_at_points,
storage-state export/import, tab locking, the WebBench harness). Found and fixed real
staleness: `mcp-server/README.md`'s "Tools (60)" heading was missing exactly the 9 tools built
across those milestones; `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT.md` were substantially
fictional (Next.js/Fastify/Tauri/Postgres/Qdrant — none of which exist in this repo) and got
rewritten against the real package graph, which surfaced two real, previously-undocumented
apps (`apps/server`, a genuine REST gateway; `apps/extension`, a plain workspace-external
browser extension) along the way. Full detail in the commit message and the
`roadmap_maturity` memory.

Then closed the taxonomy's last genuinely untested row: true WebSocket/SSE-driven pages (as
opposed to the polling/background-churn case already covered in Milestone 1). Used a real
public WebSocket testing tool (piehost.com, a live `wss://` connection, not a simulation) —
new log entries arrived via genuine WS push mid-session, and:
- A numeric id captured in a snapshot immediately after 4 new elements arrived via push
  resolved correctly to the live element via `eval` — grounding isn't fooled by push-driven
  insertion any more than it is by polling-driven insertion.
- Occlusion detection correctly refused a click on one of those newly-pushed elements when a
  real, unrelated chat widget overlapped it — the safety check applies uniformly regardless
  of how the occluding/occluded elements got onto the page.
- Typing into a filter field correctly filtered the WS-delivered log in real time (4 entries
  → 1 matching), confirming actions against WS-driven content actually take effect and the
  result is correctly reflected.

**Capability taxonomy is now fully covered/excluded — no untested rows remain** (the one
narrower residual case, an id being reused after its original target is destroyed under
WebSocket-driven churn specifically, wasn't hit in this test and is a finer-grained edge case
than the core gap, not a new blocking unknown).

### 2026-08-13 — Milestone 17: real bug found+fixed live — `type` was appending, not clearing

Task 36 of WebBench sample 3 (add a product to cart on AliExpress) surfaced a real bug:
searching a second term right after a first one in the same input produced a garbage
concatenated URL slug instead of a clean new search. Root cause in
`packages/browser/src/actions/browser-action-engine.ts`: `type` and `type_by_label` called
Puppeteer's bare `ElementHandle.type()`, which only appends keystrokes — despite
`browser.type`'s own documented contract ("clears field first if needed"), nothing in the
actual call path cleared the field first.

**Fixed**: added a `clearAndType` helper (triple-click to select existing content, Backspace,
then type — the same motion a real user clearing a field would make) and wired it into both
`type` and `type_by_label` (and therefore `fillForm`, which is built on `type`). Typechecked,
rebuilt, and the full `packages/browser` suite re-run clean (145/145 passing — 2 pre-existing
tests needed their mock `ElementHandle` extended with `press`/`click`, since they'd only ever
exercised the old direct-`.type()` path; added a new test locking in the exact
click→backspace→type call order). Verified live against a real browser outside the test
suite (typing two different values into the same input now correctly replaces, confirmed via
`document.getElementById(...).value`) — not just unit-test-level confidence.

Found via genuine dogfooding (an actual WebBench task), not speculative code review — exactly
the loop's intended find→fix→verify cycle. Note: the standing MCP-session-staleness gotcha
applies here too — the already-connected MCP session won't reflect this fix until it's
rebuilt/reconnected.

### 2026-08-13 — Milestone 15: second WebBench sample — 5/8 completed, a real number at last

Milestone 14's sample was inconclusive on completion rate — all 7 tasks happened to land on
3 domains with unusually aggressive anti-bot/auth walls. Ran a second, deliberately
different 8-task sample (all READ, 8 domains never touched before: alberta.ca,
aljazeera.com, allrecipes.com, apnews.com, berkeley.edu, britannica.com,
collinsdictionary.com, craigslist.org) to get past that confound. **5 of 8 completed
end-to-end with real, verifiable answers.** The 3 blocks were unambiguous external causes
(one flat IP-level deny, two distinct Cloudflare postures), not Sutradhar issues. Full detail:
`tools/webbench/claude-direct-run-2026-08-13-sample2.md`.

**Combined across both samples: 5/15 completed, 10/15 externally blocked, 0 Sutradhar
failures.** This is the headline number the loop was missing — the tool mechanics were never
the limiting factor; the limiting factor is that roughly a third to two-thirds of real
top-1000-web targets (depending on sample) now run anti-bot protection aggressive enough to
stop an unauthenticated automated session outright, and that's a fact about the 2026 web, not
about this tool.

**One more real navigation pattern learned**: when a site's own in-page search-toggle UI
doesn't cleanly reveal a working input in a DOM snapshot (apnews.com's "Show Search" button),
navigating directly to the site's own public `/search?q=...` URL pattern is a legitimate
fallback, not a bypass — it's the same destination the site's own search box would produce.
Used successfully this run; worth reaching for before spending more cycles fighting a
particular widget's rendering quirks.

### 2026-08-13 — Milestone 14: first Claude-direct WebBench run (7/7 real tasks attempted)

Full detail lives in `.ai/competitive-benchmarks.md`'s iteration log and
`tools/webbench/claude-direct-run-2026-08-13.md` — this entry is the capability-loop-relevant
summary. The user corrected the benchmarking approach: primary mode is Claude driving
`browser.*` directly (no LLM provider needed), not `agent.runGoal` + Ollama/OpenRouter. Ran
all 7 curated WebBench tasks live this way.

**Capability-relevant findings**: occlusion detection (`verifiedClickOnHandle`) correctly
refused every blind click into a recurring, repeatedly-reappearing store-locator modal on
acehardware.com — reproduced across two independent fresh sessions, zero silent misclicks.
`browser.get_network_log` + `browser.eval` were sufficient alone to precisely distinguish
three different real external blockers (an HTTP 403 on a backend API, a Cloudflare JS
challenge that never cleared, a hard Cloudflare deny) without guesswork — real diagnostic
capability under adversarial, uncontrolled conditions, not a fixture site. All 7 tasks ended
in an honest, correctly-surfaced external block (anti-bot walls, missing test credentials, or
genuine product-catalog drift) rather than a fabricated success or a Sutradhar-side failure.

**One unresolved, not-yet-a-gap observation**: a `type="button"` React click handler on
acehardware.com's search bar didn't fire via either Sutradhar's click or a raw
`element.click()` through `eval`, while real `<a>` link clicks on the same page worked fine.
Left uninvestigated this round (a working alternate path existed, and there's no strong
signal it's Sutradhar-side) — worth a closer look only if the same pattern recurs elsewhere.

### 2026-08-13 — Milestone 12: ran the actual unit test suites for the first time this session

Every verification so far this session was typecheck (`tsc`) + live scripts (direct-runtime or
MCP) — real functional verification, but never a run of the project's own `vitest` suites, and
never any *new* unit tests for anything built in Milestones 9–11. Ran them (found `vitest` is
locally available even though `pnpm` still isn't):

- **`packages/browser`**: 137 passing, no regressions.
- **`packages/capability-runtime`**: 71 passing, no regressions.
- **`packages/mcp-server`**: found a real, legitimate failure — `tools.spec.ts` asserts the
  exact registered tool count via a hardcoded `EXPECTED_BROWSER_TOOLS` list, still at 59 from
  before this session's work. The real count is now 68 (9 tools added across Milestones 3,
  9, and 11: `set_network_conditions`, `fill_form`, `click_at_point`, `drag_at_points`,
  `get_storage_state`, `set_storage_state`, `lock_tab`, `unlock_tab`, `get_tab_lock`). Fixed
  the fixture; 22/22 pass now.
- **Added real unit test coverage for tab locking** (`browser-tab-observability.spec.ts`) —
  the one new capability from this session's work that's pure logic and genuinely unit-
  testable without a real browser (timestamp/TTL bookkeeping, not Puppeteer calls). 7 new
  tests using `vi.useFakeTimers()` for precise TTL control: default-unlocked, acquire,
  conflicting acquire refused, re-acquire extends TTL, wrong-owner release refused,
  unlocked-release is a no-op, and TTL expiry making the tab acquirable again. All pass.
  The other Milestone 9–11 additions (`fill_form`, `click_at_point`, `drag_at_points`,
  storage-state export/import) remain verified only via live scripts, not durable unit
  tests — they're thin wrappers around real Puppeteer calls (mouse/cookie/storage APIs),
  which is what the project's own convention calls a "smoke script" case, not a "pure-logic,
  needs a real unit test" case; the CLI package also has zero test files at all (pre-existing,
  not new debt from this session).

**Why this matters for the loop**: exactly the kind of debt live-script verification alone
can't catch — a stale test fixture doesn't affect a running script, only a real test run.
Standing practice going forward: run the actual test suite for touched packages, not just
`tsc`, before considering a milestone's verification complete.

### 2026-08-13 — Milestone 9: goal reframed to competitive — researched, closed all 3 gaps

The user reframed the standing goal: not just "no known bugs" but genuinely better than
Playwright, Puppeteer, real `pinchtab/pinchtab`, and AI-company browser tools, with real
benchmarks backing any "best" claim. Full research and comparison now lives in
[.ai/competitive-benchmarks.md](./competitive-benchmarks.md) — summary here:

- Agent-level benchmarks (WebArena, OSWorld, Web Bench, Mind2Web) all need a real LLM driving
  `agent.runGoal` — confirmed blocked on the same no-provider constraint as Milestone 7, not a
  code gap.
- Fetched Microsoft's own Playwright MCP server's real tool list for a precise,
  LLM-independent tool-surface diff. Found 3 real gaps, built and verified all three:
  - **`browser.fill_form`** — bulk multi-field form fill in one call (was: only single-field
    `type`/`type_by_label`). Verified live against a real 2-field login form — both fields
    landed via real DOM inspection; a deliberate partial-failure case correctly isolated
    errors per-field. Incidentally confirmed a pre-existing duplicate-dispatch safety guard
    fires correctly.
  - **`browser.click_at_point`** — click at an absolute viewport `(x, y)` with no element or
    selector involved, matching Playwright MCP's vision-mode click. Verified pixel-exact
    against a hand-drawn canvas target.
  - **`browser.get_storage_state` / `set_storage_state`** — single-blob export/import of all
    cookies+localStorage+sessionStorage, distinct from the per-item tools and from the CLI's
    directory-based profile mechanism. Verified live: a blob captured from one session
    correctly restored a genuinely fresh, separate session's cookie/localStorage/sessionStorage
    together.
- Drive-by cleanup: swept and fixed ~11 remaining "pt-node-id" rename leftovers in doc
  comments across `runtime.ts`/`types.ts`/tests (the actual code/attributes were already
  correctly renamed to `sd-node-id`; only stale prose mentioned the old name).

### 2026-08-13 — Milestone 8: pagination discovery bug, cookies, storage, clipboard, geo

Closed out the last remaining taxonomy row (large-scale extraction/pagination) with a real
task, plus swept several completely untested fundamental tools.

- **Pagination discovery — the milestone's real find.** Ran a genuine extraction task against
  Hacker News (227 real interactive elements on the front page). The "More" link was
  discoverable neither via the default `browser.snapshot` listing (hardcoded to the first 60
  elements) nor by raising it — because nothing in the public API actually let a caller pass a
  different `maxElements` value at all, despite the underlying function already accepting one.
  Worse, the id-*stamping* cap (150) was independently too low for this exact real page. Fixed
  both layers: `maxElements` now threads through `runtime.snapshot()` → `browser.snapshot`'s
  MCP schema (default unchanged, zero behavior change for existing callers), and the stamping
  cap is raised to 300 (now a named constant, was a bare magic number). Verified live end to
  end: default listing still hides "More" (no regression), `maxElements:250` reveals a real
  clickable id for it, and clicking that id genuinely navigated to page 2. Completed the
  underlying task properly too — a real 3-page, 90-story extraction via `browser.extract_data`
  + `.morelink` pagination.
- **Cookies, localStorage/sessionStorage, clipboard, geolocation**: all verified against the
  real browser-side state directly (`document.cookie`, `localStorage`, the actual Clipboard
  and Geolocation APIs), not assumed from each tool's own success report. All correct, no
  gaps found.
- **Small drive-by fix**: `runtime.snapshot()`'s docstring still said "pt-node-id stamped" —
  a rename leftover. Fixed to `data-sd-node-id` while already in that code.

**Net result**: 1 significant, real bug found and fixed (pagination/large-page discoverability
— plausibly the most practically important fix this whole loop, since it blocks a common,
realistic task class rather than an edge case), 4 fundamental capability categories confirmed
already correct.

### 2026-08-13 — Milestone 7: agent.runGoal, dialogs, drag-and-drop, routing, logs

Triggered by the user directly challenging whether the loop's goal was actually complete —
correctly: the taxonomy swept was one I invented, not "all limitations," and I had never once
tested `agent.runGoal` (Sutradhar's own autonomous brain, the actual point of the tool beyond
raw browser control) this entire session. Corrected course rather than treating a self-defined
checklist as a finish line.

- **`agent.runGoal`**: no LLM provider available in this environment. Confirmed via `env`/
  `which ollama`/a direct curl to `localhost:11434` — genuinely nothing to test reasoning
  against, not a code issue. What DID get verified: the failure was honest (clear `failed`
  status, no fabricated answer) and — the actually valuable find — `session:blocked` event
  surfacing through `agent.runGoal` (built in an earlier phase, per `PROJECT_DEEP_DIVE`/prior
  commits) worked correctly live for what appears to be the first time it's been confirmed via
  MCP: `⚠ BLOCKED (stuck): Stuck loop detected...` appeared exactly as designed.
- **Native dialogs**: found and fixed a real bug through live testing. The 5-second dialog
  auto-dismiss safety net (`DEFAULT_DIALOG_TIMEOUT_MS`) is the shortest timeout anywhere in the
  engine, yet dialogs are exactly the case needing a check-then-act round trip
  (`get_pending_dialog` → `handle_dialog`). With realistic latency between those two calls
  (~3-4s, well within what this session had already shown for other actions), the window
  closed before `handle_dialog` could reach the dialog — it silently auto-dismissed instead,
  discarding whatever the caller intended (e.g. `prompt()` returning `null` instead of the
  supplied answer). Bumped the default to 30s (matches `downloadFile`), re-verified with
  ~4s of simulated latency between check and act — correctly handled now.
- **Drag-and-drop, right-click**: both verified against real HTML5 `DataTransfer`/`contextmenu`
  event handlers, not just the tool's own success report. No gaps.
- **Route interception (`mock`/`block`), console/network/page-error log capture**: all
  verified against genuine `fetch()` calls and a deliberate uncaught exception, not assumed
  from the tool's own output. No gaps.

**Net result**: 1 real, live-found bug fixed (dialog timeout); 1 previously-unverified feature
confirmed working for the first time (`session:blocked` surfacing); 5 categories confirmed
already correct; 1 category (the actual LLM reasoning behind `agent.runGoal`) remains
genuinely blocked on this environment lacking a provider — flagged honestly rather than
skipped silently.

### 2026-08-13 — Milestone 6: re-verify pending fixes live — caught a real bug doing it

MCP session reconnected (confirmed: `browser.set_network_conditions` newly present in the
tool list). Went through the 3 standing pending fixes:

- **Double-header bug**: confirmed fixed live — `browser.snapshot` now returns exactly one
  header with the correct count.
- **Network conditions**: confirmed live — `offline:true` genuinely blocked a real `fetch`
  ("Failed to fetch") through the actual MCP tool, not just direct-runtime.
- **`hasTouch` default**: **live testing caught a real regression that direct-runtime testing
  in Milestone 2 completely missed.** `isMobile:true` still produced `hasTouch:false` through
  the actual MCP call. Root cause: `tools.ts`'s handler always builds `{width, height,
  isMobile, deviceScaleFactor, hasTouch}` as an object literal from destructured params — so
  `hasTouch` is always a *present key*, even as `undefined`, when the caller doesn't pass one.
  The fix's `{hasTouch: default, ...viewport}` pattern silently loses to that explicit
  `undefined` during the spread (JS spread copies explicit `undefined` values, unlike a
  genuinely absent key). My Milestone 2 direct-runtime test happened to call the method with
  `hasTouch` truly absent, not explicitly `undefined` — so it never hit this path and falsely
  read as fully verified. Refixed: resolve the default with `??` chaining *before* the object
  is built, not via spread order (`const hasTouch = viewport.hasTouch ?? viewport.isMobile ??
  false; await page.setViewport({...viewport, hasTouch})`). Re-verified against the exact
  MCP-handler call shape (all keys present, `hasTouch: undefined` explicitly) — all 3 cases
  correct now. The corrected version itself still needs one more reconnect to confirm through
  an actual MCP round-trip (this session predates the just-made fix).

**Why this matters for the loop, not just this one bug**: this is the clearest evidence yet
for why CLAUDE.md's verification standard exists — "typechecking is necessary, not
sufficient." Direct-runtime scripting is a reasonable fallback when MCP is stale, but it is
NOT a full substitute for testing through the real call path a caller actually uses — object
construction differences invisible in one calling style can hide real bugs. Prefer live MCP
verification whenever the session is fresh; treat direct-runtime-only verification as
provisional, not final.

### 2026-08-13 — Milestone 5: a genuinely open-ended real task, not a fixture site

With the taxonomy nearly exhausted, this milestone was a change in kind rather than another
category sweep: a real, useful, unscripted research task on a genuinely complex real site
(Wikipedia), the way an actual user/agent would use Sutradhar — not a purpose-built test
fixture.

**Task**: fact-check the etymology claim behind the tool's own name. The `pinchtab_to_
sutradhar_rename` memory asserts "sutradhara" means "holder of the strings," the Sanskrit
equivalent of "puppeteer." Searched Wikipedia, navigated into "Indian classical drama," and
found the exact sentence: `"sutradhara" is "holder of the strings or threads"`, explicitly
compared to a puppeteer, cited to a real scholarly source (Richmond 1998, *Indian Theatre:
Traditions of Performance*) — not a Wikipedia editor's unsourced paraphrase. The naming
rationale documented earlier in this project is genuinely accurate.

**Net result**: no friction, no new gaps found — the whole flow (search → results → click
into an article → extract targeted content from deep inside a long page → find a citation)
worked smoothly end-to-end on a real, complex, unscripted site. That's itself a meaningful
signal: the taxonomy sweep's positive results generalize to genuine real-world use, not just
purpose-built fixtures.

### 2026-08-13 — Milestone 4: axSnapshot, hover, and the id-reuse-after-deletion case

Closed out the taxonomy's last "attempted but unfinished" items, live via MCP:

- **`axSnapshot`**: used exactly as documented — `browser.ax_snapshot` + `type_by_label` to add
  2 todos to a real TodoMVC list. Both landed correctly, no ids anywhere in the flow. Works.
- **`browser.hover` via MCP** (not just direct-runtime, which Milestone 1 already covered):
  hovered a real `:hover`-only destroy button on TodoMVC, then clicked it successfully.
- **Id-reuse-after-deletion** (the case Milestone 1 attempted and couldn't finish due to a bug
  in that test script, not a product issue): captured "Walk dog"'s checkbox numeric id, deleted
  the item above it ("Buy milk", the actual list-reflow trigger), then clicked the *stale*
  pre-deletion id with no re-snapshot in between. Correctly toggled "Walk dog" — the real
  surviving element, not a misfire onto whatever ended up at that DOM position. This was the
  single most realistic stress case for the grounding mechanism and it held up. Also
  incidentally confirms Milestone 1's script bug (todo count stuck at 1) really was my script,
  not Sutradhar — the same add-todo flow worked correctly here via plain MCP tool calls.
- **Re-verifying the 3 pending Milestone 2/3 fixes through an actual MCP round-trip**: still
  blocked. Checked directly — this connected session doesn't even have
  `browser.set_network_conditions` registered, confirming it predates Milestone 3 entirely.
  Needs a reconnect; not something I can force from here.

**Net result**: no code changes this milestone — every remaining taxonomy gap tested turned
out to already work correctly. The capability taxonomy now has no `untested` or `partial` rows
left except the ones explicitly deferred (large-scale extraction/pagination, true WebSocket/
SSE-driven pages) and the standing MCP-reconnect item.

### 2026-08-13 — Milestone 3: shadow DOM, media, network conditions, framework diversity

- **Shadow DOM**: open shadow root — listing and clicking both verified correct. Closed shadow
  root — correctly invisible to both, which is expected JS-level encapsulation, not a bug.
- **Media**: native `<video>` controls not exposed via `snapshot` (expected — UA-internal
  shadow DOM, not something any automation framework interacts with directly); the actual JS
  media API (`play`/`pause`/state) works correctly. One external test video failed with a
  genuine codec/format error — confirmed as that file's problem, not Sutradhar's, by loading a
  different real video successfully right after. Canvas `offset`-based clicking verified
  pixel-accurate against a hand-drawn target region.
- **Network conditions**: confirmed this was a complete gap (no code anywhere, not even
  internal) — built a new capability rather than just logging it, since it's small and follows
  an existing pattern (`emulate`/`set_viewport`). Added `SutradharRuntime.emulateNetwork` +
  `browser.set_network_conditions` (offline mode + DevTools throttling presets or custom
  throughput/latency). Verified live: offline genuinely blocked a real fetch, Slow 3G added
  ~2046ms to a request that normally takes ~17ms (matches the preset's own math), clearing
  throttling restored the baseline. Not yet confirmed through an actual MCP round-trip (same
  standing gotcha as Milestone 2's fixes — needs a reconnect).
- **JS framework diversity**: real TodoMVC apps in Vue, Angular, and Svelte — add-todo,
  snapshot, and DOM verification all worked correctly in each, same as the earlier React
  result. Confirms grounding is genuinely framework-agnostic rather than assumed to be.
- **Minor DX observation, not chased further**: `browser.eval` calls appear to share
  persistent top-level scope across separate invocations within a session (a `const` declared
  in one `eval` call collided with the same name in a later, separate call). Worth understanding
  if it comes up again, but low priority — easy to work around by not reusing identifier names.

**Net result**: 1 new capability built from scratch (network conditions) and verified live; 3
of 4 categories confirmed already correct with no code changes needed (shadow DOM open case,
media, framework diversity); 1 external-file issue correctly identified as not a Sutradhar bug.

### 2026-08-13 — Milestone 2: upload, auth persistence, mobile emulation, PDF

MCP session was reconnected at the start of this milestone (resolved Milestone 1's blocker).
Sanity-checked first (`data-sd-node-id`/`data-sd-gen` live, correct) before proceeding.

- **File upload**: `browser.upload_file` against a real fixture (the-internet.herokuapp.com/
  upload) — verified server-side, not just client success. No gap found.
- **Bonus fix (not part of the plan, found while sanity-checking)**: `browser.snapshot`'s MCP
  response double-printed its own header with two different element counts (4 vs 1, same
  page) — confusing and live. Root cause: `tools.ts` wrapped `snap.interactiveElements` in its
  own redundant header, not realizing the string already embeds one (the CLI's `cmdSnap` has
  an explicit comment warning about exactly this trap). Fixed, rebuilt, typechecked clean.
  Logged as `PROB-008`, resolved.
- **Auth/session persistence**: created a named CLI profile, logged into a real test fixture,
  fully killed the session, launched fresh with the same profile — still authenticated. No
  gap found; this is a genuinely strong capability already.
- **Mobile/device emulation**: `set_viewport` verified against a real site (github.com) —
  dimensions, pixel ratio, and media queries all correct. Found and fixed a real gap:
  `isMobile:true` never enabled touch event support (`hasTouch` wasn't threaded through to
  Puppeteer at all). Fixed with a sensible default (`hasTouch` follows `isMobile` unless
  overridden), verified all 3 cases directly against the runtime, rebuilt, typechecked clean.
- **PDF handling**: `export_pdf` (page → PDF) verified correct. Reading a PDF encountered via
  direct navigation is a real, confirmed gap — the native viewer's toolbar gets enumerated but
  `pageText` is empty even against a PDF with real text content. Logged as `PROB-009`, open —
  correctly not attempted as a quick fix (needs real PDF text-layer extraction).

**Net result**: 2 real product code fixes landed (double-header bug, `hasTouch` default),
both typechecked and verified directly against the runtime; neither yet confirmed end-to-end
through a live MCP round-trip since the connected session predates both changes — needs
another reconnect to close that loop. 1 new real gap found and deliberately not fixed
(`PROB-009`, PDF text extraction — correctly out of "quick fix" scope). 3 of 4 categories
tested turned out to already work correctly with no changes needed.

### 2026-08-13 — Milestone 1: multi-tab, download, iframes, real-time pages

Tested 4 categories not yet touched this session, all via real dogfooding (live browser,
real or realistically-constructed targets, not mocks):

- **Multi-tab**: Hacker News front page + a story's comments page in a background tab.
  `new_tab`/`tabId`-scoped `snapshot`/`click`/`eval` all worked correctly; confirmed the two
  tabs' state stayed fully isolated. No gap found.
- **File download**: injected a real `<a download>` link, called `runtime.downloadFile`
  directly. File landed on disk with the right name and content (verified by reading it back).
  No gap found; also re-confirms the Wave-8 download-path-containment fix still holds.
- **iframes**: found what looked like a real bug via the connected MCP tools (cross-origin,
  dynamically-injected iframe content invisible to both `snapshot` and `click`) — but this
  turned out to be a **false positive caused by the stale MCP session**, not a real defect.
  Verified directly against `SutradharRuntime` (bypassing MCP): both `snapshot` and `click`
  correctly reach into a cross-origin iframe injected after page load. No real gap; the actual
  finding here is the MCP-staleness blocker logged above.
- **Real-time pages**: simulated a live-updating feed (unrelated DOM churning every 150ms)
  next to a target button; captured the button's numeric grounding id, waited through ~8 more
  re-renders, then clicked via that id — correctly hit the real button every time. Grounding
  holds up under this kind of background churn. The harder case (the *target itself* gets
  destroyed/recreated, e.g. via deletion) remains untested — attempted but blocked by an
  unrelated bug in my own test script, not chased further this round.

**Net result**: no code fixes were needed this milestone — every category tested turned out to
already work correctly. The most valuable finding was procedural, not a product bug: the
stale MCP session is unreliable for verification and produced a false bug report. Logged as a
standing blocker above.

### 2026-08-13 — Loop established (Milestone 0)

Set up `CLAUDE.md` and this doc per the user's request to make the find→fix→verify loop the
standing way of working, not a one-off. No capability work done yet in this entry — Milestone
1 (multi-tab, file download, iframe, real-time page) starts next, logged separately below as
it completes.

## Current milestone

**Milestone 19: DONE** (2026-08-14) — docs re-audit (found and fixed real staleness in
`mcp-server/README.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, root `README.md`), then
closed the capability taxonomy's last untested row (true WebSocket/SSE-driven pages, tested
against a real live `wss://` connection). **The capability taxonomy has no untested rows
left** — everything is `covered` or deliberately `excluded`. Combined with Milestones 14-17's
benchmark work (15/29 WebBench tasks completed, 0 Sutradhar-attributable failures) and 9-11's
competitive tool-surface research, both halves of CLAUDE.md's goal (capability parity/edge,
and evidenced benchmark numbers) are now in a genuinely strong, real state.

**Next**: no specific capability gap queued — the taxonomy is exhausted. Candidates if
resuming: the unresolved click-handler observation from Milestone 14 if it recurs on a
different site, confirming the `type`-clear fix (Milestone 17) through an actual MCP
round-trip once the session is rebuilt/reconnected, a fourth WebBench sample for a tighter
completion-rate estimate, or a genuinely new axis entirely (per CLAUDE.md's ownership
section: don't stop at "nothing queued," go find the next real thing by actually using the
tool, the same way every item on this list was found).

**Milestone 14: DONE** (2026-08-13) — first Claude-direct WebBench run, 7/7 tasks attempted
live via `browser.*`. All 7 ended in honest, correctly-diagnosed external blocks (anti-bot
walls, missing credentials, catalog drift), not Sutradhar failures — see iteration log above
and `tools/webbench/claude-direct-run-2026-08-13.md`. This is now the primary benchmarking
mode going forward (Claude/host-AI driving `browser.*` directly), not `agent.runGoal` +
external LLM, per the user's correction.

**Milestone 1: DONE. Milestone 2: DONE. Milestone 3: DONE. Milestone 4: DONE** (all
2026-08-13) — see iteration log above.

**Remaining untested rows in the taxonomy**: true WebSocket/SSE-driven pages (vs. the
background-churn case already covered) and large-scale extraction/pagination. Everything else
in the taxonomy is now `covered` or `excluded`.

**Milestone 5: DONE** (2026-08-13) — a real open-ended task on Wikipedia (fact-checking the
tool's own naming etymology), not another fixture-site sweep. No new gaps found; the whole
flow worked smoothly end-to-end on a genuine, complex, unscripted site — see iteration log.

**Milestone 6: DONE** (2026-08-13) — MCP reconnected; re-verified the 3 pending fixes live.
2 of 3 confirmed working through an actual MCP round-trip (double-header bug, network
conditions). The 3rd (`hasTouch`) turned out to still be broken through the real call path —
live testing caught a real bug direct-runtime verification had missed entirely (see iteration
log for the full root cause). Refixed and re-verified against the exact call shape that
exposed it. **Still needs one more reconnect** to confirm the corrected version live — this
standing item persists, now down to 1 of 3 rather than 3 of 3.

**Also learned in Milestone 6→7's gap**: an MCP *client* reconnect and an actual *process*
restart of `mcp-server` are different things. A client can reconnect to the same still-running
node process, which keeps whatever code was in memory when it launched — new code on disk
doesn't take effect until the process itself restarts, not just the client connection. Confirm
which one actually happened (e.g. by checking whether a very recently added tool is present)
before trusting a "reconnected" session reflects the latest build.

**Milestone 7: DONE** (2026-08-13) — see iteration log above. Prompted by direct user pushback
("is our goal completed? do you even remember your goal?") after Milestone 6's checkpoint
wrongly treated an exhausted self-invented taxonomy as if it were the whole goal. Correction,
recorded here so it isn't repeated: the standing directive is a genuinely open-ended,
continuous loop, not a checklist with a finish line — "no more items in the table I made" is
never itself a reason to stop; the right question is always "what haven't I actually tried
yet," and `agent.runGoal` — the tool's actual headline feature — had gone untested all session
despite an exhaustive-looking taxonomy.

**Standing items**: the `hasTouch` fix (Milestone 6) still isn't confirmed through an actual
live MCP round-trip — needs a real process restart, not just a reconnect. The `agent.runGoal`
reasoning path remains genuinely blocked on this environment having no LLM provider (not
something resolvable without the user installing Ollama or supplying an OpenRouter key).

**Milestone 8: DONE** (2026-08-13) — closed the last untested taxonomy row (large-scale
extraction/pagination) with a real task, found and fixed a genuinely significant bug in the
process (element-listing cap had no way to be raised, on top of an independently-too-low
stamping cap — together made pagination links on ordinary content-heavy pages undiscoverable).
Swept cookies/storage/clipboard/geolocation too — all correct. See iteration log.

**Taxonomy status**: every row is now `covered`, `excluded`, or explicitly blocked on an
external constraint (`agent.runGoal`'s reasoning, on an LLM provider). No untested rows remain
that are actually resolvable from inside this environment.

**Standing items, unchanged**: the `hasTouch` fix (Milestone 6) still isn't confirmed through
an actual live MCP round-trip — needs a real process restart, not just a reconnect.
`agent.runGoal`'s reasoning path remains genuinely blocked on no LLM provider being available.

**Milestone 9: DONE** (2026-08-13) — goal reframed to competitive positioning (see
`.ai/competitive-benchmarks.md`); researched the real benchmark/competitor landscape; closed
all 3 tool-surface gaps found against Playwright MCP (`fill_form`, `click_at_point`,
`get_storage_state`/`set_storage_state`). See that doc's own iteration log for ongoing
competitive-comparison work — this doc stays focused on Sutradhar's own capability taxonomy;
the competitive doc tracks positioning against named competitors specifically.

**Milestones 10–11** happened entirely in `.ai/competitive-benchmarks.md` (Puppeteer/real-
PinchTab/AI-company-tools research, tab locking, coordinate-drag) — see that doc's own
iteration log, not repeated here.

**Milestone 12: DONE** (2026-08-13) — ran the actual `vitest` suites for the first time this
session (previously typecheck + live scripts only), found and fixed a real stale-fixture test
failure, added real unit coverage for tab locking. See iteration log above.

**Proposed Milestone 13**: no specific plan. Standing practice reinforced this round: run the
real test suite for any touched package before calling a milestone's verification complete,
not just `tsc`. Otherwise, real usage and real comparisons drive what's next.
