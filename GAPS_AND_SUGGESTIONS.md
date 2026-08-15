# Sutradhar — Gaps, Limitations & Suggestions
Field report from an independent 14-scenario benchmark campaign · 2026-08-16
Tested versions: 0.2.0 (full suite) and 0.2.2 (full re-run). Environment: Windows 11, Node 25, real Chrome 151, CLI + SDK paths.

---

## A. Reproducible bugs (with test evidence)

### A1. `type()` silently no-ops on some forms — **blocker-grade**
- **Where:** saucedemo.com checkout form (`#first-name` etc.). Typing returns success, no error, input stays empty. Identical typing on the same site's login page works (SDK: 34 ms, correct value).
- **Repro:** `tests/retest-022.mjs` (prints `type() result: ""`), `tests/dbg3.mjs`/`dbg4.mjs`.
- **Present in:** 0.2.0 **and** 0.2.2.
- **Suspect:** the action engine reports success without verifying the value landed; possibly a focus/injection race on this DOM shape.
- **Suggestion:** (1) after typing, read back the element value and throw/retry on mismatch; (2) add a `fill()`-style fast path using the native value setter + `input` event (our workaround in `tests/dbg5.mjs` works flawlessly and would make controlled-component frameworks happy too).

### A2. CLI `type` triple-types characters and hits a 15 s timeout in long-lived headed sessions
- **Where:** saucedemo login via CLI in `--headed` session: value became `ssstttaaannndddaaarrrddd___uuussseeerrr` with "Action type timed out after 15000ms", three times in a row. Headless CLI and SDK are clean.
- **Repro:** steps in `REPORT.md` (UC-03 first attempt).
- **Suggestion:** likely event duplication on re-dispatch during retry; make retries idempotent (clear-then-type) and only after a verified-failed attempt.

### A3. `snap` misses interactive elements inside visible overlay modals
- **Where:** the-internet.herokuapp.com/entry_ad — the modal's Close button (plain `<div>`/button in an overlay) never appeared in `snap` output while the modal was visually on screen; meanwhile the occlusion detector correctly refused to click through it. `axsnap` + `clicktext Close` did see and dismiss it.
- **Suggestion:** the DOM listing's visibility/interactability heuristics need to cover overlay-attached elements; until then, document "if click says occluded but snap shows nothing, switch to axsnap".

### A4. SDK popup tab handle doesn't track navigation
- **Where:** UC-09 — `browser.pages()` correctly exposes a popup opened by a click, but `popup.snapshot()` keeps returning `about:blank` even seconds after the popup navigated. The CLI auto-adopts the same popup fine.
- **Repro:** `tests/uc09b.mjs`.
- **Suggestion:** re-resolve the CDP target on snapshot when the page object's URL is `about:blank` but the target has navigated.

### A5. Stale `[#id]` failure message doesn't tell the agent what to do
- **Where:** after any navigation, ids go stale by design (documented), but the error is `No element found for selector: [data-sd-node-id="9"]` — an LLM can't tell "re-snapshot" from "wrong element".
- **Suggestion:** detect navigation since last snapshot (you already track it) and say: "page navigated after last snapshot — run snap again". Cheap fix, big agent-reliability win.

### A6. Fixed between our runs (for the record)
- `<select>` elements missing from the interactive listing on 0.2.0 → **listed correctly on 0.2.2**. ✔
- Note: there is still no dedicated "choose option" action in the CLI; agents must fall back to `evaluate` to change a select.

---

## B. Gaps vs the problem space (things no tool solves — know your walls)

These matched every competitor we benchmarked (Playwright, Puppeteer, PinchTab, Browser Use, Stagehand, Skyvern); not fixable by Sutradhar alone, listed so positioning is honest:

1. **CAPTCHA solving** — sutradhar grounds the reCAPTCHA challenge tiles (better than most!) but solving is out of scope; needs solver integrations.
2. **OTP / 2FA / passkeys** — hard auth walls remain; the practical pattern is persistent profiles + human-in-the-loop once.
3. **Canvas / WebGL content** — Google Maps controls groundable, map itself opaque. Only vision-based approaches (screenshot → VLM) see it; a "describe screenshot" helper action would be a differentiator.
4. **Prompt injection** — page text (including "IGNORE ALL INSTRUCTIONS…" payloads) is surfaced verbatim to the driving LLM. No sanitization, same as all DOM-readers.

## C. Sutradhar-specific limitations (vs. its own design goals)

1. **Headless UA leaks `HeadlessChrome/151`** — the only detection row it fails on bot.sannysoft.com. A default UA rewrite (or `--ua` flag) would make the headless surface fully clean; everything else (WebDriver, chrome.runtime, plugins, WebGL) already passes — genuinely ahead of vanilla Playwright/Puppeteer.
2. **Profile persistence doesn't cover sessionStorage sites** — saucedemo login state is lost across profile relaunches (cookies/localStorage presumably persist). An option to snapshot/restore sessionStorage per profile would fix a common real-world login-survival case.
3. **No download feedback** — downloads work (file landed in ~/Downloads) but the CLI just says "Clicked"; no download event, filename, or completion signal. Agent must poll the filesystem.
4. **No typing into cross-origin iframe bodies** — TinyMCE toolbar buttons inside the iframe are listed (impressive), but the contenteditable body isn't groundable, so no way to type content. 
5. **CLI per-command overhead ~1.7 s** (npx/Node startup dominates; SDK is 11–18 ms/step). A `sutradhar daemon`/`--server` mode the CLI talks to would give scripted CLI flows near-SDK latency.
6. **Snapshot output is text-only — no `--json` mode** — programmatic consumers (our harness) must regex-parse the `[#id]` listing. A structured JSON variant of `interactiveElements` costs little and unlocks non-LLM tooling.
7. **No built-in waits / retry policies exposed** — our scripts needed fixed `sleep()`s after clicks and navigations; auto-wait (a la Playwright) or at least a `wait <text|url|idle>` command would remove most flakiness agents hit.
8. **axsnap inconsistencies** — screen-reader-only text shows in `text` but not in `axsnap`'s listing; hidden-by-aria-hidden menu items correctly absent. The sr-only omission looks like an a11y-tree filter that's too aggressive.
9. **Missing small actions** for full agent coverage: `hover`, `drag`, `select <ref> <option>`, `upload <file>`, scroll-to-element. Each currently forces `evaluate` fallbacks.
10. **No network-layer controls** — `audit` captures network errors nicely, but there's no interception/mock/offline throttle for testing workflows (Playwright's forte).
11. **MCP server + `agent.runGoal` untested here** — this campaign covered CLI + SDK only; the MCP surface (the primary Claude Code / Z.ai integration!) deserves the same 14-scenario pass. We can supply the harness as-is.

## D. What's genuinely strong (keep and market these)

1. **Dual grounding** (`snap` ids + stale-proof `axsnap`/`clicktext`/`clickrole`) — recovered from the modal blind spot no DOM-only tool would have; best-in-class answer to snapshot-staleness.
2. **11–18 ms/step deterministic SDK** — orders of magnitude cheaper than LLM-per-step agents.
3. **Auto tab adoption in CLI** — popups just become the active tab; no handle juggling.
4. **Minimal headless detection surface** — one UA string away from clean.
5. **Cross-origin iframe visibility** — reCAPTCHA/TinyMCE internals listed where Puppeteer sees nothing without frame code.
6. **a11y-only element access** — `clickrole` on ARIA menu items invisible to CSS selectors; unique among peers.
7. **One package, three interfaces** (CLI/SDK/MCP) on a real browser — the "browser control plane" pitch is real.

## E. Prioritized fix list (our recommendation)

| P | Item | Effort | Impact |
|---|---|---|---|
| 1 | A1 typed-value verification + `fill()` fast path | S | Removes the only blocker-grade bug |
| 2 | A5 stale-id error message ("run snap again") | XS | Large agent-reliability gain |
| 3 | C1 headless UA override | XS | Clean bot-detection story |
| 4 | C7 `wait` command / auto-wait defaults | S | Kills most flakiness |
| 5 | A3 modal visibility in `snap` | M | Closes dual-grounding gap |
| 6 | C6 `--json` snapshot mode | S | Non-LLM tooling unlock |
| 7 | A4 popup handle navigation tracking | S | SDK parity with CLI |
| 8 | C5 CLI daemon mode | M | ~100x faster scripted CLI flows |
| 9 | C3 download events | S | Completes the action loop |
| 10 | C2 sessionStorage in profiles | M | Real-world login survival |

— Generated by an independent test campaign; harness in `tests/`, raw evidence in `REPORT.md` + `results/`.
