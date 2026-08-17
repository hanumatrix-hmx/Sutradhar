# Sutradhar issues log

Running log of bugs/gaps hit in the `sutradhar` npm package (hanumatrix-hmx/Sutradhar) while using it
to drive the app for UI audit/edit work. Append a new dated entry every time something breaks —
don't overwrite history. Version tested: **0.3.0** (update this line when we bump versions).

Purpose: feed these back upstream to the Sutradhar repo so the tool gets better over time.

---

## 2026-08-16

### 1. `launch({ viewport })` is silently dropped — public SDK never forwards it
**Severity:** High (blocks the core "phone-accurate preview" use case)
**Where:** `src/index.ts` `launch()` — only forwards `initialUrl`, `isIncognito`,
`launch.{headless,userAgent}`, `profileName` to `runtime.launch()`. `options.viewport` is accepted
by the TS type/README implication but never read.
**Symptom:** Page renders at full desktop width regardless of the `viewport` option passed to `launch()`.
**Workaround used:** reach `page.runtime.setViewport(page.sessionId, {...}, page.tabId)` directly —
an internal `SutradharRuntime` method that exists (it's what the MCP `set_viewport` tool calls) but
is never exposed on the public `Browser`/`Page` wrapper classes.
**Fix wanted:** `Browser`/`Page` should expose `setViewport()` publicly, and/or `launch({viewport})`
should apply it immediately after creating the initial page.

### 2. No CLI flag for viewport/device size at all
**Severity:** Medium
**Where:** `sutradhar` CLI (`nav`, all commands) — `--help` lists `--profile`, `--user-agent`,
`--headed`, `--json`, `--fail-on-diff`. No `--viewport`/`--device` flag exists.
**Symptom:** CLI-driven sessions (`sutradhar nav <url> --headed`) always render at Puppeteer's
default desktop viewport; there is no way to get a phone-accurate preview through the CLI alone —
only the SDK (with the workaround above) can do it.
**Fix wanted:** `--viewport 390x844` (and maybe `--mobile`) flags on `nav`.

### 3. Setting the CDP viewport does not resize the actual OS window
**Severity:** Medium (compounds #1 — even with the workaround, the result looks wrong)
**Symptom:** After `setViewport`, the *page* renders at 390×844, but the physical Chrome window
stays whatever size it launched at — the phone-sized content sits inside a big window with a large
empty grey margin. Confusing to a human looking at the visible browser (looks broken, isn't).
**Root cause:** CDP device-metrics override (what `setViewport` does) only affects what the page
*thinks* its size is — it's a separate concern from the OS window's actual bounds.
**Workaround used:** reach the raw Puppeteer `Browser` (`session.getPuppeteerBrowser()`, exposed
only for internal `attach()` use) and call `Browser.setWindowBounds` via a manual CDP session on the
page target, with a hand-guessed frame offset (`+16` width, `+88` height). Imprecise — see #4.
**Better fix found via research:** modern Puppeteer (bundled `puppeteer-core` here is ^25.5.0) has a
first-class `page.resize({ contentWidth, contentHeight })` that resizes the OS window so the
*content area* (not including Chrome's own frame) is exactly the target size — no offset-guessing.
Confirmed present in this package's bundled puppeteer-core (`cdp/Page.js` has `async resize(params)`).
**Fix wanted:** `Browser`/`Page` should call the underlying `page.resize()` when a headed session is
launched with a `viewport` option, so a headed launch just looks phone-sized by default — no
workaround needed at all.

### 4. Repeated `launch()` calls with no session reuse → orphaned Chrome instances accumulate
**Severity:** Medium (resource/UX issue, not a correctness bug)
**Symptom:** Each SDK `launch()` call spawns a brand-new Chrome browser process. Nothing in the SDK
warns or errors if a previous `launch()`'s browser was never `.close()`d — across several iterations
of a script this silently piles up multiple full Chrome instances with no visible limit or count
surfaced to the caller.
**Fix wanted:** either (a) `launch()` warns/errors if the same Node process already has an
un-closed `Browser` outstanding, or (b) a `SutradharRuntime`-level registry + a `listSessions()`
convenience so a caller can see/clean up what's actually running before launching another one.
The CLI already has the right idea (`~/.sutradhar-cli/state.json` tracks one session, `close`
before opening another) — the SDK has no equivalent guardrail.

### 5. Stale `[#id]` refs from `browser.snapshot`/CLI `snap` on controlled inputs
**Severity:** Low (documented behavior, but easy to trip on)
**Symptom:** Typing into a controlled RN-web input (re-renders on every keystroke) via a numeric
`[#id]` selector from `snap` silently drops/garbles characters (e.g. typed `9000000001`, field ended
up `999000`) — not caught by tsc/lint, purely a runtime automation footgun.
**Not really a bug** — `AGENT_SETUP.md` already documents this exact failure mode and says to prefer
`ax_snapshot` + `click_by_role`/`type_by_label` for anything that re-renders. Logging it here because
it cost real time before the doc's advice was actually re-read.

### 6. Chrome enforces a hard minimum window width (~516px) — not fixable via CDP at all
**Severity:** Low (cosmetic only; the functional viewport is unaffected)
**Symptom:** Even after correctly setting both the CDP device-metrics override AND calling
`Browser.setWindowBounds`/`page.resize()`, a HEADED Chrome window will never visually shrink
narrower than ~516px wide (confirmed empirically: requested 500px width, Chrome silently clamped
the actual window to 516px; height had no equivalent floor). This is a Chromium platform
constraint, not something Sutradhar (or any CDP-based tool) can override.
**Not a real bug** — logging it because it cost time before being root-caused. The functional
signal (`window.innerWidth`/`innerHeight`/`devicePixelRatio` inside the page, which is what the
app's own layout logic reads) is correct and unaffected by this — only the *visible on-screen
window* keeps a margin below that floor. `page.screenshot()` captures the content viewport only,
so screenshots are unaffected either way. This is also why Chrome DevTools' own "Responsive"
device-toolbar mode doesn't resize the OS window at all — it renders the phone-width canvas
*inside* a normal-sized window, which is the correct pattern to mimic if a headed session ever
needs to look narrower than 516px on screen (e.g. draw the page into a canvas/iframe at target
size rather than resizing the real window).
**Fix wanted:** none realistic — worth a line in AGENT_SETUP.md's viewport guidance so the next
person doesn't spend time trying to force a narrower real window.

---

## 2026-08-17

### 7. CLI silently misparses an unrecognized/misplaced flag as the positional filename arg
**Severity:** Medium (silent data-corruption-adjacent footgun — no error, just wrong files)
**Where:** `sutradhar screenshot [path]` (likely any CLI command with an optional positional arg).
**Symptom:** Running `sutradhar screenshot --out somefile.png` or `sutradhar screenshot --help`
does NOT error or show help — it silently treats the literal string `--out`/`--help` as the `path`
argument and creates a file named exactly `--out` or `--help` in the current directory. Cost real
time (had to notice two garbage files named `--help`/`--out` had been created in the project's repo
root before realizing what happened) and could easily corrupt a real path if a caller has any
similar typo.
**Fix wanted:** reject/warn on a positional arg that starts with `--` instead of silently accepting
it as a literal filename; a real `--help` should print usage, not create a file called `--help`.

### 8. No public/documented way to reconnect an SDK script to an already-running headed session
**Severity:** Medium (blocks a very natural workflow: "keep driving the same visible window across
several separate script runs" instead of relaunching a new browser each time)
**Symptom:** `SutradharRuntime.attach({ endpoint })` exists and works, but discovering the
`endpoint` (the browser's CDP `ws://` URL) for a session launched moments ago by a DIFFERENT script
invocation has no supported path. Had to manually read Chrome's own
`<user-data-dir>/DevToolsActivePort` file off disk to recover the port, then hand-construct the
`ws://localhost:<port>/devtools/browser/<id>` URL. The wsEndpoint IS available in-process via
`browser.runtime.sessionManager.sessions.get(sessionId).getPuppeteerBrowser().wsEndpoint()` — but
only from the SAME process that launched it, which by definition can't be the reconnecting one.
**Fix wanted:** `launch()`'s return value (or a `Browser.getWsEndpoint()` public method) should
surface the endpoint so a caller can persist it (e.g. write to a file) for a later `attach()` call
in a different process — this is the whole point of `attach()` existing, but nothing produces the
value it consumes.

### 9. A script that calls `attach()`/`launch()` and never explicitly exits hangs forever
**Severity:** Low-Medium (compounds #4 — this is WHY orphaned processes accumulate so easily)
**Symptom:** The CDP WebSocket connection keeps Node's event loop alive indefinitely. A script that
finishes all its work but doesn't call `process.exit(0)` (or `browser.close()`/`runtime.shutdown()`)
just sits there as a live process forever, invisible unless someone thinks to check `tasklist`/`ps`.
Several of these accumulated silently during this session before being noticed and killed by hand.
**Fix wanted:** either the SDK auto-detaches/exits cleanly once the calling script's synchronous
work is done (hard to detect in general), or — more realistically — this should be called out
loudly in the README/AGENT_SETUP.md ("always call `process.exit(0)` or `browser.close()` at the
end of a one-shot script, or it will never exit").

### 10. `Browser.getWindowForTarget` throws an unhelpful error if the CDP session isn't on a page target
**Severity:** Low (undocumented footgun for anyone doing window-bounds work, which the built-in
`set_viewport` MCP tool implies is a supported thing to want to do)
**Symptom:** Creating a CDP session via the raw Puppeteer `Browser`'s own top-level target
(`rawBrowser.target().createCDPSession()`) and then calling `Browser.getWindowForTarget` fails with
`Protocol error (Browser.getWindowForTarget): No web contents in the target` — the session has to
be created from a PAGE target (`(await rawBrowser.pages())[0].target().createCDPSession()`)
instead. Not obvious, not documented anywhere in Sutradhar's own docs (this is a raw Puppeteer/CDP
quirk that Sutradhar's abstractions don't shield a caller from once they've had to drop to the raw
`getPuppeteerBrowser()` escape hatch for window-bounds work — see #3/#6).
**Fix wanted:** n/a for Sutradhar directly (this is upstream Puppeteer/CDP behavior) — but IF
Sutradhar ever adds first-class window-bounds support (per #3's "fix wanted"), it should absorb
this footgun so callers never need to know it exists.

### 11. Viewport configuration is not persisted or restored when reconnecting
**Severity:** Medium (can invalidate visual comparisons without an obvious failure)
**Where:** SDK `launch()`/`attach()` session lifecycle.
**Symptom:** The canonical phone viewport has to be applied manually after every new process
starts or attaches to a running Chrome session. Reconnecting successfully does not itself prove
that the page is still using the project's canonical viewport; a missed setup call silently
returns the comparison to Chrome's default desktop metrics. This is especially easy to miss when
the visible headed window is still the same window and the page continues to load normally.
**Why this is separate from #1:** #1 is about `launch({ viewport })` being dropped. This issue is
about session continuity: once a viewport has been applied, the setting is not exposed as a
session invariant that `attach()` can restore or verify.
**Fix wanted:** persist the effective viewport/device metrics in the Sutradhar session metadata
and restore them on `attach()`; alternatively, expose an explicit `attach({ viewport })` contract
that applies the metrics before the first navigation, plus a clear warning when an attached page
has no configured viewport.

### 12. No first-class inspection API for the effective viewport/device metrics
**Severity:** Medium (makes false visual mismatches hard to diagnose)
**Where:** SDK `Browser`/`Page` and CLI inspection output.
**Symptom:** There is no single supported Sutradhar call that reports the metrics actually in
effect: CSS viewport width/height, device scale factor, mobile/touch emulation, browser zoom
(`visualViewport.scale`), and—when headed—the separate OS window bounds. To verify the current
session, the operator has to run page JavaScript manually and use raw Puppeteer/CDP for the rest.
That makes it easy to confuse a wrong viewport with a real component/layout difference.
**Fix wanted:** expose `page.getViewport()` (or equivalent) returning the effective page metrics,
and a separate `page.getWindowBounds()` for headed sessions; include both in `--json`/diagnostic
output so a visual smoke report can record the calibration alongside its screenshot.

---

<!-- Append new dated entries above this line, newest first. -->
