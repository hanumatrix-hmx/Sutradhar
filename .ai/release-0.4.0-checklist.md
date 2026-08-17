# 0.4.0 release prep — live checklist

**Started**: 2026-08-18. **Owner instruction** (verbatim intent): "Do a thorough testing and bug
fixes till everything is tested, and then I want you to publish it or at least make it
publishable for 0.4.0, do not miss anything. This is a long horizon task. Do not stop at all...
I want you to run it and finish it." User will not be at the PC — this runs autonomously across
many turns/context windows.

**Read this file first in any new session/context window** — it's the authoritative, always-
current status. Update it after every real step (not just at the end). See the
`release_0_4_0_prep` memory file for the why/background if this file itself is somehow lost.

**Hard constraint — do not violate**: actually running `npm publish` needs the user's physical
hardware-key 2FA. This CANNOT be automated or worked around. The goal is to get the repo to a
state where `npm publish` (run by the user) would succeed immediately — clean tree, version
bumped, release gate green, full test suite green, bundle verified fresh. NOT to attempt to run
`npm publish` itself.

## Package landscape (surveyed 2026-08-18)

Only `packages/sutradhar` (published as npm `sutradhar`, currently 0.3.0) is actually published
— every other workspace package is `"private": true` and gets bundled INTO it via
`scripts/build-bundle.mjs`. Three packages have no explicit `private` field and should be
double-checked they're not accidentally publishable: `@hanumatrix/dev-runtime`, `@sutradhar/frontend`,
`@sutradhar/sdk` (0.2.0 — check what this is, may be legacy/unused).

Full private-package list to test: agent, browser, capability, capability-runtime, cli, config,
contracts, events, llm, mcp-server, memory, observability, storage, sutradhar, utils, workflow
(16 packages) + apps/server + apps/extension.

## Phase A — Full regression sweep (typecheck + build + test, every package)

Baseline as of 2026-08-18 (from Milestones 92-94 this session): capability-runtime 90/90,
cli 32/32, sutradhar 11/11, mcp-server 25/25, agent 56/56, apps/server 28/28 — all clean.
NOT yet run this pass: browser, capability, config, contracts, events, llm, memory,
observability, storage, utils, workflow, frontend, sdk, dev-runtime, apps/extension.

| Package | Typecheck | Build | Test | Notes |
|---|---|---|---|---|
| capability-runtime | ✅ | ✅ | ✅ 90/90 | from Milestone 92 |
| cli | ✅ | ✅ | ✅ 32/32 | from Milestone 92/94 |
| sutradhar | ✅ | ✅ | ✅ 11/11 | from Milestone 92 |
| mcp-server | ✅ | ✅ | ✅ 25/25 | from Milestone 94 |
| agent | ✅ | ✅ | ✅ 56/56 | from Milestone 92 |
| apps/server | ✅ | ✅ | ✅ 28/28 | from Milestone 92 |
| browser | ⬜ | ⬜ | ⬜ | not yet run this pass |
| capability | ⬜ | ⬜ | ⬜ | not yet run this pass |
| config | ⬜ | ⬜ | ⬜ | not yet run this pass |
| contracts | ⬜ | ⬜ | ⬜ | not yet run this pass |
| events | ⬜ | ⬜ | ⬜ | not yet run this pass |
| llm | ⬜ | ⬜ | ⬜ | not yet run this pass |
| memory | ⬜ | ⬜ | ⬜ | not yet run this pass |
| observability | ⬜ | ⬜ | ⬜ | not yet run this pass |
| storage | ⬜ | ⬜ | ⬜ | not yet run this pass |
| utils | ⬜ | ⬜ | ⬜ | not yet run this pass |
| workflow | ⬜ | ⬜ | ⬜ | not yet run this pass |
| frontend | ⬜ | ⬜ | ⬜ | not yet run this pass |
| sdk | ⬜ | ⬜ | ⬜ | not yet run this pass — check if this is even still live/used |
| dev-runtime | ⬜ | ⬜ | ⬜ | not yet run this pass |
| apps/extension | ⬜ | ⬜ | ⬜ | not yet run this pass |

## Phase B — Real bug-hunting (not just re-running existing tests)

Existing tests only catch regressions in already-known behavior. "Thorough" per the user's
instruction means actually finding NEW real bugs too, the same way Milestones 1-94 did —
dogfooding real scenarios, not just running `vitest`. Plan: sweep the capability taxonomy in
`.ai/browsing-capability-loop.md` for anything marked untested/partial, and drive fresh real
scenarios (a WebBench-style sample is one proven way, but also directly exercise less-common
verbs: drag/drop, file upload, iframe eval, dialog handling, network mocking/throttling, PDF
export, clipboard, geolocation, storage state round-trip, tab locking).

- [ ] Sweep `.ai/browsing-capability-loop.md` taxonomy for untested/partial rows
- [ ] Sweep `.ai/known-problems.md` for anything still open (not RESOLVED)
- [ ] Live-drive a fresh batch of less-common verbs not recently exercised
- [ ] Any bug found: root-cause, fix, typecheck+build+test the package, live-verify, log in
      known-problems.md with the same PROB-NNN rigor as prior entries

## Phase C — Release hygiene

- [ ] Decide on `SUTRADHAR-ISSUES.md` (currently untracked, blocks the clean-tree gate) — commit
      it (it's real, valuable field-report documentation already cited in known-problems.md)
- [ ] Bump `packages/sutradhar/package.json` version 0.3.0 → 0.4.0 (minor bump: additive API
      surface — new `Page.setViewport/getViewport`, `Browser.getWsEndpoint`, CLI `--viewport` —
      plus real bug fixes, no breaking changes identified so far)
- [ ] Confirm `scripts/check-release-ready.mjs` passes (clean tree + no stale workspace dist/)
- [ ] Fresh clean build of the bundle (`npm run clean && npm run build` in packages/sutradhar)
      and spot-check the built artifact behaves correctly (not just src/)
- [ ] `npm publish --dry-run` from packages/sutradhar to confirm the tarball contents/gate are
      correct WITHOUT actually publishing (dry-run should not require 2FA — verify this
      assumption live, don't just assume it)

## Phase D — Final report

- [ ] Write a short RELEASE-0.4.0-READY.md or update known-problems.md/competitive-benchmarks.md
      summarizing everything tested/fixed since 0.3.0
- [ ] Tell the user explicitly: repo is ready, here's exactly what to run (`npm publish` from
      packages/sutradhar) and that it needs their hardware key — do NOT attempt this step myself

## Log

- 2026-08-18: Checklist created. Starting Phase A (full regression sweep across untested
  packages) next.
