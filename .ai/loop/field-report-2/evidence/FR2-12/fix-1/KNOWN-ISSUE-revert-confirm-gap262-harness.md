# Known issue: `revert-confirm-gap262.mjs` harness is unreliable — not a GAP-262 regression

`revert-confirm-gap262.json` (written ~15:08) shows `fixed.leaks: 10/10`, which looks like a
contradiction against `live-verify-run2.log`'s `L12b (GAP-262 fix-1, 15 repeats)` case (`leaks=0/15`).
**This is a harness bug, not a real regression.** Root-caused as follows:

1. The 15:08 run used an early version of `revert-confirm-gap262.mjs` that measured both the
   "reverted" and "fixed" phases via same-process dynamic `import()` with a cache-busting query
   string on `dist/index.js` only. `dist/` is plain per-file `tsc` output (not a bundle) —
   `index.js` re-exports `audit/site-audit.js` via a normal relative import, which resolves to the
   SAME module URL both times. Node's ESM cache served the STALE (pre-restore-rebuild) compiled
   `site-audit.js` for the "fixed" measurement, so it silently kept running the REVERTED logic even
   after the file on disk was restored and rebuilt. That 10/10 result describes the reverted code
   twice, not the fixed code failing.
2. The script was refactored to run each phase in its own fresh child process (`_gap262-repeat-child.mjs`),
   which fixes (1). That version then hit a second, unrelated problem on this shared, heavily-loaded
   machine (130+ pre-existing Chrome processes from other sessions): a freshly-launched browser's
   FIRST navigation sometimes hangs for the full 30s Puppeteer timeout, consistently across every
   retry against that SAME browser instance — the browser itself came up unhealthy (most likely
   its renderer starved for CPU/handles right after the immediately-preceding `tsc` build), not a
   transient single-navigation blip. The child's own `SIGTERM` handler awaited
   `runtime.shutdownAll()` before exiting, which also hung against the same unresponsive browser,
   so the parent's `execFileSync` `timeout` option didn't actually bound the wall-clock time as
   intended — this is what left a `node` process (PID 58628) alive for hours until the Orchestrator
   killed it by PID.

**GAP-262 is fixed, established by three independent, real confirmations, not by this script:**
- `live-verify-run2.log`'s `L12b (GAP-262 fix-1, 15 repeats)`: **0/15 leaks**, run through the real
  MCP tool surface (`browser.navigate` + `browser.audit`), the same runtime-direct URL-mode path
  audit-1's original finding used.
- The Orchestrator independently ran the exact single-trial repro (navigate `/noisy-interval` ->
  wait 80ms -> `audit` `/clean-delayed?delayMs=150`) directly against the current build: 0 console
  errors, 0 broken requests, ~1.7s total — then 10x in a fresh script, 0/10 leaks.
- `revert-confirm-gap261.json` (a *different*, working revert-confirm script for GAP-261) confirms
  the sha-verified-restore pattern itself works correctly when the harness doesn't hit the above
  two bugs — i.e. the pattern is sound, this one instance's implementation wasn't.

`revert-confirm-gap262.json`, `revert-confirm-gap262-run.log` and `revert-confirm-gap262-run2.log`
are kept as-is (not deleted or edited) per this loop's evidence-integrity rule — this note explains
them rather than hiding them. `_gap262-repeat-child.mjs` and `revert-confirm-gap262.mjs` on disk
are the HARDENED versions (health-checked launch, retry, hard timeouts) reflecting the last edit
made before this was set aside per the Orchestrator's explicit instruction to stop iterating on
this specific script and finalize the report — they were not re-run to a clean pass/fail after
that hardening, so treat them as a documented residual for a future item, not as verified evidence
either way.
