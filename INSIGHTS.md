# Sutradhar — Product Insights from a 3-Version, 14-Scenario Benchmark
For the internal team · based on empirical testing of 0.2.0 → 0.2.2 → 0.3.0 (full suite each) · 2026-08-16

---

## 1. "Verify-then-succeed" is your moat — apply it everywhere, not just where bugs bit

0.3.0's typing fix worked because typing now verifies the value landed. But the philosophy that fixed it is bigger than the fix. **Every action should assert its own effect before reporting success**: click → the element actually reacted (checked state, class change, navigation, event observed); select → value changed; upload → file input holds the file; scroll → scrollY actually moved. The two 0.3.0 flakes (popup adoption, ARIA menu race) and the scroll no-op are all the same disease: *success reported, effect unverified*. One `assertEffect()` hook in the action engine retires the entire class.

## 2. Flakiness lives at state transitions, not at actions

Every race we hit was "action fired, page hadn't committed yet" — click fired before the menu rendered items, popup read before it navigated. Playwright solved the pre-condition side (auto-wait *before* acting); nobody has productized the **post-condition side** (settle *after* acting). A built-in post-action settle — wait until DOM mutations quiesce + network idle for N ms, configurable per command — would make first-run reliability equal retry reliability. That's the difference between "works in demos" and "works in CI."

## 3. Grounding completeness should be a tested contract, not an emergent property

`select` exists as a command but real `<select>`s aren't listed (only their option-span). The contenteditable iframe body isn't groundable. `<input type="range">`, date pickers, `<video>` controls, custom web-component internals — same risk. **Suggestion:** build a "grounding completeness matrix" page (one element of every interactive type) and CI-assert that every type appears in `snap` or has a documented alternative command. The README's "drives the DOM" promise should be enumerable.

## 4. Defaults beat flags — flip the safe ones

`--user-agent` works, but default headless still ships `HeadlessChrome/151` in the UA. Internal users won't read the flags doc; they'll run `nav` bare and get detected. Every "clean" behavior discovered in this campaign (UA rewrite, headed-grade fingerprints) should be the **default**, with flags as opt-*out*. One-line change, category-leading bot-detection story.

## 5. Three surfaces, one engine — make parity a CI gate, not a docs note

The typing bug existed simultaneously in CLI, SDK, and MCP (we reproduced all three). The MCP server has 69 tools; CLI just closed the gap on 8 commands. **Suggestion:** run the same 14-scenario harness against all three surfaces in CI — this campaign's `tests/` folder is exactly that harness and it caught 6 real issues across 3 versions. Any tool that exists in one surface should be exercisable from all, or explicitly marked "MCP-only" in `--help`.

## 6. Token efficiency is proven at scale — now productize the dial

CNN: 5.5 MB HTML → 3.4 KB listing (~1,600×). But one size won't fit all agents:
- Add verbosity levels: `--ids-only`, `--no-text`, `--max-elements K` (top-K by the confidence score you already compute — pages with 1,000+ interactives will come).
- The `boundingBox` + `confidence` data in `--json` is quietly powerful: it enables visual clustering ("elements in the top nav"), viewport-relative grounding, and model-side reranking. Document it as a feature; it's currently a hidden superpower.

## 7. The remaining partials sort into "build" vs "wrap" — don't mix them up

**Build (your core):**
- sessionStorage capture/restore in profiles → unlocks login survival for internal dashboards (most SSO-heavy internal apps use it).
- Grounding the iframe contenteditable body → unlocks rich-text admin surfaces (CMS, ticketing, email composers) — the last common element type we couldn't act on.
- Scroll that dispatches real wheel events → unlocks infinite-feed scraping.

**Wrap (partner, don't reinvent):**
- CAPTCHA: integrate a solver service behind a flag; the fact that you *ground the challenge tiles* already puts you ahead of every peer.
- Canvas/WebGL: a `describe_screenshot` hook (screenshot → VLM of the host agent's choosing) is the principled answer; deterministic tools shouldn't grow eyes, they should hand the image to whoever has them.

## 8. Long-session resilience matters for the internal use case

Our CLI run hit "Could not reconnect to the previous session" after an audit crash — stale `state.json` blocked the next command until manual `close`. For agents running hours-long sessions: auto-detect dead sessions and transparently relaunch (profiles make this near-lossless), and consider session snapshots/checkpoints (you already have `get_action_history` in MCP — a `replay` on top is a deterministic redo).

## 9. Positioning: you've earned "the reliable execution layer" — claim it

The benchmark's competitive read: LLM-loop agents (Browser Use, Stagehand, Skyvern) own *exploration*; nothing owns *reliable execution* — 15 ms/step, deterministic, verifiable, token-lean, real-browser. That's Sutradhar's lane and 0.3.0 closed the credibility gap (the typing blocker). For internal rollout the pitch writes itself: *"agents explore with whatever LLM tool they like; when work must be done right every time, it runs through Sutradhar."* Record-and-replay of action history as a feature would make that literal.

## 10. Internal-tool quick wins specific to company usage

- **SSO injection:** `browser.set_storage_state` exists in MCP — expose `sutradhar profile import-state <file>` in CLI so IT can pre-bake authenticated profiles for internal apps.
- **Corporate proxy/cert:** document `HTTPS_PROXY`/`NODE_EXTRA_CA_CERTS` behavior; internal agents live behind both.
- **Compliance angle:** `audit` (Web Vitals + a11y + errors) over internal apps on a schedule = cheap continuous QA; a `sutradhar audit --baseline compare` combining `audit` + `compare` would be a one-command regression gate for every internal web app.
- **Guardrails:** a `--allowlist-domains` flag (block nav outside company domains) makes it safe to hand agents a logged-in internal session — also partial prompt-injection defense-in-depth.

## Priority stack (impact ÷ effort, informed by all three runs)

| # | Item | Why first |
|---|------|-----------|
| 1 | `assertEffect()` on every action (Insight 1) | Retires the whole silent-failure class permanently |
| 2 | Post-action settle waits (Insight 2) | First-run = retry-run reliability; kills the flake class |
| 3 | Default UA + safe defaults flip (Insight 4) | One line to a fully-clean bot story |
| 4 | `<select>` + iframe-contenteditable grounding (Insights 3, 7) | Last common element types; unlocks real internal surfaces |
| 5 | sessionStorage in profiles (Insight 7) | Login survival for SSO-heavy internal apps |
| 6 | CI: run the 3-surface harness (Insight 5) | This campaign caught 6 bugs in 3 versions; institutionalize it |
| 7 | Session self-healing (Insight 8) | Hours-long agent sessions shouldn't need babysitting |
| 8 | Verbosity dial + JSON docs (Insight 6) | Scale the proven token advantage |
| 9 | Wrap: CAPTCHA solver + describe_screenshot (Insight 7) | Differentiators without core drift |
| 10 | Internal quick wins: import-state, allowlist, audit-baseline (Insight 10) | Company-specific lock-in of the best kind |

— Companion docs: `REPORT.md` (3-version matrix), `GAPS_AND_SUGGESTIONS.md` (bug-level detail), `USER_REVIEW.md` (user-perspective verdict), `tests/` (the runnable harness this is all based on).
