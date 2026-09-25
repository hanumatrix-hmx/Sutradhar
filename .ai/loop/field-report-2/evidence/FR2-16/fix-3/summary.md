# FR2-16 fix-3 summary

Fixed GAP-118, GAP-119, GAP-120, GAP-121 (audit-2's findings). See individual logs in this
directory for raw command output.

## GAP-118 (major) - "stability flag" false framing removed
- packages/browser/README.md:37 - removed "Chrome-recommended stability flag ... side-effect"
  claim; states single honest reason (hides navigator.webdriver) plus Chromium source citation
  (bad_flags_prompt.cc classifies --disable-blink-features as unsupported/developer-only) and
  the live headed-launch banner evidence (still shows automation-controlled banner) and the
  HeadlessChrome UA substring fact.
- packages/browser/src/launcher/browser-options.ts:37-46 - same fix in the DEFAULT_LAUNCH_ARGS
  comment.
- PROJECT_DEEP_DIVE.md:48 and :872/876-882 - removed "plain, undisguised browser" absolute
  claim that contradicted the very next sentence's stated exception; removed "kept mainly as a
  ... stability flag but also has a measured side effect" framing; rewrote §11.1 to state the
  webdriver-hiding fact first and plainly, with the same Chromium-source + live-banner evidence.
- Also found (own grep, not in the original gap list) and fixed the same pattern in
  packages/sutradhar/AGENT_SETUP.md:160, which still had the old "plain, undisguised browser"
  wording with no stated exception, unlike the already-correct root AGENT_SETUP.md.

## GAP-119 (minor) - SECURITY.md and competitive-benchmarks.md
- SECURITY.md:41 - "No plugin masks automation signals" -> now states the retained flag does
  mask navigator.webdriver as its one narrow exception, everything else stays unmasked.
- .ai/competitive-benchmarks.md:68-69 - was claiming "Sutradhar's plain launch does neither"
  (masks navigator.webdriver nor disables --enable-automation) - false for the webdriver half;
  reworded to state both sides mask navigator.webdriver (via Sutradhar's retained flag), and the
  real remaining asymmetry is --enable-automation + the HeadlessChrome UA substring only.
- .ai/competitive-benchmarks.md:693-696 - was listing "navigator.webdriver masking" as part of
  the excluded/unbuilt stealth category for Sutradhar - false, since it's already done
  unconditionally. Reworded to describe the real remaining gap (UA substring, --enable-automation)
  as the excluded category, and to state the webdriver point is not part of that gap.

## GAP-120 (minor) - strengthened regression guards
- tools/scenario-suite/fr2-16/doc-static.spec.mjs - added a negative check across README.md,
  browser-options.ts, and PROJECT_DEEP_DIVE.md for /stability flag|kept for stability|
  Chrome-recommended stability/i. Initially caught my OWN first-draft wording still containing
  the literal phrase "stability flag" (in a negated sentence) - see doc-static.log's first FAIL
  run is not saved (I fixed the wording before saving a passing baseline), but the mutation test
  below proves the check fires correctly.
- tools/scenario-suite/fr2-16/verify-fr2-16-boundary.mjs - added the same negative check (now
  live-verify and doc-static are properly redundant, not accidentally complementary), plus a new
  "stealth launch flags" README check that previously only doc-static had.
- Mutation test (mutation-doc-static.log, mutation-live-verify.log): reintroduced
  "It is a Chrome-recommended stability flag." into README.md, ran both scripts - BOTH failed
  with the new check (and only that check). Reverted README.md exactly afterward (diff-confirmed
  byte-identical to the pre-mutation version, modulo CRLF normalization from the shell tool).

## GAP-121 (minor, optional) - regression-guard comment honesty
- packages/browser/tests/unit/launcher.spec.ts:49-60 - reworded the comment to state plainly
  that "tsc succeeds" does NOT by itself prove IStealthEngine/StealthOptions were removed (tsc
  would still pass if they were re-added without being re-exported from the barrel), and that
  what the test actually verifies directly is the barrel's runtime re-exports (StealthEngine
  class + helper functions) being gone, which only indirectly/accidentally also catches a bare
  interface re-add today. No new type-level check added (skipped per instructions, to avoid
  destabilizing scope).

## Verification
- webdriver-probe.mjs (copied from fix-2, rerun fresh): flag=present -> navigator.webdriver=false;
  flag=absent -> navigator.webdriver=true. Confirms all new wording is accurate.
- ua-probe.mjs (new): default headless UA with the flag present still contains "HeadlessChrome" -
  confirms the added UA claim is accurate.
- Headed-Chrome automation-controlled banner: not re-run live in fix-3 (audit-2 already proved
  this directly with a screenshot, headed-infobar-probe.log/png in the audit-2 evidence dir);
  reused as citation rather than re-verified, per the task's "optional, audit-2 already did this
  once" allowance.
- Typecheck: all 8 correct consumers (browser, agent, capability-runtime, cli, mcp-server,
  workflow, sutradhar, apps/server) via `npx turbo run typecheck --filter=<pkg>` - all exit 0.
  Consumer list independently re-verified via grep for "@sutradhar/browser" across
  packages/*/package.json and apps/*/package.json (7 direct + sutradhar transitively via
  capability-runtime) - matches audit-1/2's confirmed list of 8.
- Vitest: packages/browser 227/227 passed (8 test files); packages/cli 47/47 passed (3 test
  files, including the new help-text.spec.ts left uncommitted by fix-2).
- doc-static.spec.mjs: ALL PASS (final clean run: doc-static-final.log).
- verify-fr2-16-boundary.mjs: OVERALL PASS (final clean run: live-verify-final.log), after a
  clean `rm -rf packages/browser/dist packages/cli/dist` + `npx turbo run build` (build-browser-cli.log,
  exit 0, 9/9 tasks successful).
