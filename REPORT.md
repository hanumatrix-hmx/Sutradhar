# Sutradhar Test Report — 14 Failure-Scenario Benchmarks
Date: 2026-08-16 · Environment: Windows 11, Node 25, Chrome 151 (real, not bundled) · all tests run from `D:\Test\zcode\sutradhar`

> **Version note:** the suite ran twice — first on **0.2.0** (installed 19:29 UTC), then fully re-run on **0.2.2** (published 19:29 UTC, i.e. mid-session — we were on the previous version without knowing). Both runs' verdicts below; 0.2.2 is the authoritative one.

## 0.2.0 → 0.2.2: what changed between runs

| Test | 0.2.0 | 0.2.2 | Delta |
|---|---|---|---|
| UC-05 `<select>` in listing | ❌ missing | ✅ listed | **Fixed upstream** |
| UC-05/UC-03 `type()` on checkout form | ❌ silent no-op | ❌ still empty | **Bug persists** |
| UC-06a modal in `snap` | ❌ blind spot | ❌ blind spot | Unchanged (`axsnap` workaround still works) |
| UC-09 popup via CLI | ✅ auto-adopt | ✅ auto-adopt | Unchanged (0.2.2 first looked flaky — was my stale-snapshot error; CLI adopts after fresh `snap`) |
| UC-09 popup via SDK `pages()` | — | ⚠️ popup handle reads `about:blank` | New/observed limitation |
| UC-13 SDK per-step | 11–14 ms (avg 37) | 10–18 ms (avg 46) | Same ballpark (cold-start noise) |
| UC-01/02/03/04/07/08/10/11/12/14 | see matrix | identical results | No regressions |

Net: 0.2.2 = one real fix (`<select>` grounding), one bug still open (silent `type()` failure), one SDK tab-tracking quirk.

## Verdict matrix (0.2.2)

| UC | Scenario | Result | Notes |
|----|----------|--------|-------|
| 01 | Bot detection | ⚠️ PARTIAL | Headless leaks `HeadlessChrome/151` in UA; WebDriver, chrome.runtime, plugins, WebGL all **pass**. Headed mode = clean UA. Far better than vanilla Playwright/Puppeteer (which fail ~7 rows) |
| 02 | CAPTCHA | ⚠️ PARTIAL | Checkbox clickable; the **image-challenge tiles inside the cross-origin iframe appeared as groundable elements** ([#13..#21], VERIFY button) — better iframe piercing than expected. Solving remains impossible (as for all tools) |
| 03 | Auth + session persistence | ⚠️ PARTIAL | Login works. Named profiles (`profile create`) persist storage, but saucedemo uses sessionStorage → session lost on relaunch. Cookie-based sites would persist. OTP/2FA: untouched (unsolved universally) |
| 04 | Canvas blindness | ⚠️ AS EXPECTED | Google Maps: controls groundable (search box, buttons); map canvas opaque — same as every DOM tool |
| 05 | Long 10+ step flow | ✅ PASS* | Full saucedemo flow login→sort→detail→add→cart→checkout→overview with correct math ($29.99 + tax = $32.39). *Caveat: `type()` silently no-ops on the checkout form (workaround: native-setter evaluate). `<select>` now listed on 0.2.2 |
| 06 | Modals / dynamic content | ✅ PASS via axsnap | `snap` had a blind spot (modal Close button missing from listing while occlusion detection caught the overlay), but `axsnap` saw the modal and `clicktext Close` dismissed it. Dynamic "Hello World!" captured after wait. Dual grounding genuinely rescues DOM-snapshot misses |
| 07 | Cross-origin iframes | ⚠️ PARTIAL | TinyMCE toolbar buttons **inside the iframe** fully listed by both `snap` and `axsnap`; the contenteditable body itself was not groundable → couldn't type into the editor |
| 08 | File download | ✅ PASS | Click on download link triggered a real file to ~/Downloads. No download-event feedback (agent must check the filesystem) |
| 09 | Multi-tab | ✅ PASS | Clicking a link that opens a new tab: session **auto-adopted the new tab** — `text` immediately read "New Window". No manual handle switching (better than Selenium/Puppeteer UX) |
| 10 | Prompt injection | ⚠️ BY DESIGN | Page's injected "IGNORE ALL INSTRUCTIONS" text is surfaced verbatim to the agent; no sanitization. Safety depends entirely on the driving LLM (this agent did not follow it). Same exposure as every DOM-reading tool |
| 11 | Token efficiency | ✅ PASS | saucedemo inventory: element listing 684 B, listing+text 2,057 B vs 3,414 B raw HTML (~1.7–5× smaller; small page, bigger gains on real SPAs). Matches PinchTab's accessibility-tree philosophy |
| 12 | Outcome verification | ✅ PASS | Cart badge "1" + button flip to "Remove" verified from fresh snapshots (done during UC-05/UC-03 runs) |
| 13 | Speed | ✅ PASS (strong) | SDK: **11–14 ms per step** (goto+snapshot), launch 198 ms, 10-step loop 369 ms total. CLI: ~1.77 s per nav+snap cycle (npx/Node startup dominates — SDK for loops, CLI for exploration) |
| 14 | A11y-only grounding | ✅ PASS (strong) | `clickrole button "Open Actions Menu"` opened an ARIA menu invisible to CSS selectors; `axsnap` then listed the 3 `menuitem`s; `clicktext "Archive Item"` fired the action ("ACTION TRIGGERED: archive"). SR-only text included in `text`. This is sutradhar's standout capability |

## Bugs found (reproducible)

1. **`type()` silently fails on some pages** — checkout form inputs stay empty, no error thrown; identical typing works on the login page (SDK 34 ms, correct value). CLI variant additionally triple-types characters and hits a 15 s timeout in long-lived headed sessions.
2. **`snap` modal blind spot** — a visible Close button in an entry-ad overlay was omitted from the DOM listing; `axsnap` + `clicktext` worked around it.
3. **Stale `[#id]` after any navigation** — by design, but the error message could be clearer ("No element found for selector: [data-sd-node-id=…]" rather than "re-snapshot needed").
4. **SDK popup tab handle** — `browser.pages()` exposes a newly opened popup, but its snapshot stays `about:blank`; the CLI adopts popups correctly.

## Where sutradhar genuinely beats the incumbents

- **vs Playwright/Puppeteer**: agent-native grounding (no selector writing), auto tab adoption, a11y role/text clicking, `audit`/`compare` one-shotters, and much lower bot-detection surface headless (only UA leaks).
- **vs PinchTab**: same token-lean philosophy, but adds dual grounding (DOM ids **and** stale-proof a11y), an SDK + MCP + CLI trio, and visual regression (`compare`).
- **vs Browser Use/Stagehand/Skyvern**: deterministic, local, no LLM required per step (11 ms/step vs seconds + tokens), prompt-injection exposure only when an LLM drives it.

## Where it trails

- CAPTCHA/OTP solving (everyone does), canvas content, typing reliability bug above, no download events, no parallel workers/test runner (Playwright's forte), sessionStorage-based session persistence.

## Bottom line

Sutradhar is a credible "browser control plane for agents" that already outperforms the classical tools on agent-relevant axes (grounding, tokens, tab handling, bot surface) and matches PinchTab's cost pitch with a richer feature set. The typing-reliability bug is the one blocker-grade issue found.
