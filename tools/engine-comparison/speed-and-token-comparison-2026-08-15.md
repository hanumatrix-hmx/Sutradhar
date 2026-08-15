# Speed and token-cost comparison: Sutradhar vs. Playwright vs. Puppeteer vs. real pinchtab/pinchtab

Answers a direct question: how does Sutradhar compare on **speed** (real wall-clock per action/
scenario) and **token cost** (how many tokens an LLM has to read per "ground the page" call) —
neither of which the earlier WebBench completion-rate comparison
(`head-to-head-comparison-2026-08-14.md`) measured. This is a separate, narrower benchmark.

**Real prior work found on disk, reused rather than redone**: `scenarios.mjs`,
`playwright-harness.mjs`, `playwright-hard.mjs`, `puppeteer-hard.mjs`, `pinchtab-harness.mjs`,
`pinchtab-hard.mjs`, and `measure-snapshot-cost.mjs` already existed in this directory, dated
2026-08-11 — from an earlier session, before this one. They define 5 "public" scenarios (real
sites: the-internet.herokuapp.com, saucedemo.com) + 6 "hard" scenarios (local fixture pages:
closed shadow DOM, canvas-only UI, a virtualized list, native drag-and-drop, an animated panel,
nested scroll), each timed identically (`Date.now()` before/after) per engine. That prior work
covered Playwright, Puppeteer, and real pinchtab — but never Sutradhar itself, and
`puppeteer-results.json` (the public-scenario run) was missing entirely. This session wrote
`sutradhar-harness.mjs` and `sutradhar-hard.mjs`, replicating the identical scenarios via
`SutradharRuntime` directly (not the MCP layer, to avoid adding protocol/host-AI round-trip
overhead on top of the engine itself — the fair comparison, since the other three are also
direct Node scripts with no LLM in the loop), and ran them to fill the gap.

## Speed: 5 public (real network) scenarios, milliseconds

| Scenario | Sutradhar | Playwright | pinchtab |
|---|---|---|---|
| login-flow | 14,030 | 6,650 | 5,079 |
| dynamic-loading | 11,757 | 8,948 | 8,644 |
| file-upload | 5,546 | 3,777 | 4,027 |
| long-checkout (multi-step) | 5,170 | 796 | 878 |
| local-fixture (shadow DOM + iframe) | 4,663 | 1,777 | 4,642 |

(No Puppeteer row — `puppeteer-results.json` for this scenario set doesn't exist on disk; only
the "hard" set below has all four. Not filled in for this pass, noted honestly rather than
guessed at.)

**Sutradhar is slower than Playwright and pinchtab on every single public scenario** — roughly
1.3x to 6.5x, worst on `long-checkout`. This is a real, consistent pattern, not noise.

## Speed: 6 hard (local fixture) scenarios, milliseconds

| Scenario | Sutradhar | Playwright | Puppeteer | pinchtab |
|---|---|---|---|---|
| closed-shadow (correctly fails) | **27,505** | 3,380 | 3,573 | 16,948 |
| canvas-ui | 451 | 536 | 1,050 | 485 |
| virtualized-list | 2,930 | 2,504 | 2,495 | 3,019 |
| native-dnd | 615 | 599 | 599 | 539 |
| animated-panel | 1,735 | 1,336 | 683 (**failed**) | 1,393 |
| nested-scroll | **437** | 663 | 535 | 470 |

With real network latency removed, the picture flips: Sutradhar is competitive or fastest on
4 of 6 (fastest on `nested-scroll`, essentially tied on `native-dnd`/`virtualized-list`,
close on `canvas-ui`) — and Puppeteer's `animated-panel` result isn't a fast success, it's a
fast **failure** (`"Node is either not clickable or not an Element"`), which every other engine
handled correctly.

The one real outlier: **`closed-shadow` took Sutradhar 27.5 seconds** — 8x Playwright/Puppeteer
and 1.6x even pinchtab's own outlier on the same scenario (16.9s). All four engines reach the
*same correct outcome* (the click genuinely can't succeed — a closed shadow root is
inaccessible by spec) but Sutradhar takes dramatically longer to conclude that. The plausible,
evidence-adjacent explanation (not proven by an ablation, but consistent with code confirmed
elsewhere this session): Sutradhar's action engine does occlusion-aware, verified clicking with
retries before giving up, a deliberate reliability tradeoff that has paid off repeatedly in this
session's own adversarial-page testing (zero silent misclicks across dozens of real WebBench
tasks) — but it has a real, measured latency cost on a target that's genuinely unreachable, not
just occluded.

## Token cost: same 4 pages, four engines' real "ground the page" output

Character count of each engine's actual response to reading a page, converted at the standard
~4-chars-per-token approximation (same methodology `measure-snapshot-cost.mjs` already used).
Real, captured output — not estimated.

| Page | Sutradhar (full snapshot) | Sutradhar (interactive elements only) | Playwright (`ariaSnapshot` mode:ai) | Puppeteer (raw DOM query) | pinchtab (real CLI) |
|---|---|---|---|---|---|
| login | 166 | 53 | 285 | 63 | 201 |
| homepage (49 links) | 590 | 337 | 1,592 | 1,156 | 429 |
| saucedemo | 143 | 54 | 146 | 45 | 135 |
| example.com | 104 | 25 | 82 | 22 | 112 |
| **average** | **251** | **117** | **526** | **322** | **219** |

No clean winner — genuinely mixed, not spun toward any result:

- **Sutradhar's interactive-elements-only view (117 avg) is the leanest structural option of
  any measurement here** — but that's not quite the same thing its "full snapshot" (251, which
  also includes page text) represents; the fairer like-for-like comparison against the other
  three's single combined response is the full-snapshot number.
- **Playwright's `ariaSnapshot` is the most verbose across the board** (526 avg, worst on the
  link-heavy homepage at 1,592) — its accessibility-tree format includes more structural detail
  than the others' flatter listings.
- **Puppeteer's raw DOM query is cheapest on simple pages but scales worst on link-heavy ones**
  (1,156 on the 49-link homepage, second only to Playwright) — it has no relevance filtering or
  pruning, just a flat dump of everything matching its selector, capped at 120 elements (not hit
  here).
- **pinchtab (219 avg) sits in the middle**, and its real output includes a consistent,
  measured overhead the others don't: a prompt-injection safety-warning wrapper
  (`<untrusted_web_content>...` plus a fixed warning sentence) on every single call — a real,
  deliberate design choice (its IDPI content-safety feature, already documented in this
  project's Milestone 24), not free.

## Reading this honestly

Small sample (4 pages, 11 scenarios) — treat as a real, directional data point, not a
statistically powered verdict. Two honest, separately-true conclusions:

1. **On raw speed against real network-hosted pages, Sutradhar is consistently slower than
   Playwright and pinchtab** — this is the least flattering finding of this whole benchmarking
   effort and is reported exactly as measured, not softened.
2. **On local interaction latency and token cost, Sutradhar is competitive** — often fastest,
   and its leanest snapshot mode is the smallest of any measurement taken here.

The `closed-shadow` outlier is worth a real follow-up: is Sutradhar's click-retry policy tuned
sensibly for genuinely-unreachable targets, or does it retry far past the point of diminishing
returns? That's a legitimate, scoped question for a future milestone — not chased further in
this pass, which was about measuring honestly, not fixing anything yet.
