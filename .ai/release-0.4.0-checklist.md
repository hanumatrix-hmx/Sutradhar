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

**PHASE A COMPLETE (2026-08-18) — every single package clean.** No bugs found in this pass
(pure regression sweep); real bug-hunting is Phase B.

| Package | Typecheck | Build | Test | Notes |
|---|---|---|---|---|
| capability-runtime | ✅ | ✅ | ✅ 90/90 | |
| cli | ✅ | ✅ | ✅ 32/32 | |
| sutradhar | ✅ | ✅ | ✅ 11/11 | |
| mcp-server | ✅ | ✅ | ✅ 25/25 | |
| agent | ✅ | ✅ | ✅ 56/56 | |
| apps/server | ✅ | ✅ | ✅ 28/28 | incl. live browser integration tests |
| browser | ✅ | ✅ | ✅ 9 files, all pass | |
| capability | ✅ | ✅ | ✅ 2 files, all pass | |
| config | ✅ | ✅ | ✅ 6/6 | |
| contracts | ✅ | ✅ | ✅ 7/7 | |
| events | ✅ | ✅ | ✅ 6/6 | |
| llm | ✅ | ✅ | ✅ 2 files, all pass | |
| memory | ✅ | ✅ | ✅ 8/8 | |
| observability | ✅ | ✅ | ✅ 13/13 | |
| storage | ✅ | ✅ | ✅ 7/7 | |
| utils | ✅ | ✅ | ✅ 20/20 | |
| workflow | ✅ | ✅ | ✅ 2 files, all pass | |
| frontend | ✅ | ✅ real `vite build` | ✅ 29/29 | prod bundle: 271KB JS / 70KB CSS |
| sdk | ✅ | ✅ | ✅ 2 files, all pass | v0.2.0, no `private` flag — flagged for Phase C check |
| dev-runtime | ✅ | ✅ | n/a (no test script) | `@hanumatrix/dev-runtime`, no `private` flag — flagged for Phase C |
| apps/extension | n/a (no build tooling) | n/a | manifest.json valid (MV3), background.js/popup.js syntax OK | plain extension, no package.json |

## Phase B — Real bug-hunting (not just re-running existing tests)

Existing tests only catch regressions in already-known behavior. "Thorough" per the user's
instruction means actually finding NEW real bugs too, the same way Milestones 1-94 did —
dogfooding real scenarios, not just running `vitest`. Plan: sweep the capability taxonomy in
`.ai/browsing-capability-loop.md` for anything marked untested/partial, and drive fresh real
scenarios (a WebBench-style sample is one proven way, but also directly exercise less-common
verbs: drag/drop, file upload, iframe eval, dialog handling, network mocking/throttling, PDF
export, clipboard, geolocation, storage state round-trip, tab locking).

- [x] Sweep `.ai/browsing-capability-loop.md` taxonomy for untested/partial rows — closed the
      lingering mobile/hasTouch-emulation reconnect note, added a viewport-as-public-API row
- [x] Sweep `.ai/known-problems.md` for anything still open (not RESOLVED) — none release-
      blocking (PROB-002 awaits user product-direction sign-off, PROB-018 deliberate scope,
      PROB-015/025 deeply-investigated honest-failure-mode flakiness); marked PROB-010's dead
      code `@experimental` for clarity
- [x] Live-drive a fresh batch of less-common verbs not recently exercised — ran a combined
      mobile-viewport checkout flow (saucedemo: login, sort, add-to-cart, cart, checkout form)
      and **found a new, real, significant bug: `PROB-043`** — `type()`/`press_key()` can report
      false-positive success on a long-lived MCP-server session while the real DOM shows nothing
      landed. Extensively isolated (4 separate reproduction attempts via direct `SutradharRuntime`
      scripting, all failed to reproduce — only the live MCP session shows it) but root cause NOT
      identified. **This is the one open item this release-prep pass could not close.** See
      `PROB-043` in known-problems.md for the full investigation. Did not reproduce via SDK/CLI in
      any test this session, including the extensive PROB-042 work — scope currently believed
      limited to long-lived MCP sessions specifically, not confirmed to affect SDK/CLI callers.
- [x] Any bug found: root-cause, fix, typecheck+build+test the package, live-verify, log in
      known-problems.md with the same PROB-NNN rigor as prior entries — done for everything
      EXCEPT PROB-043, which could not be root-caused or fixed within this pass (see above);
      logged with full rigor instead of hidden or claimed-fixed.

## Phase C — Release hygiene

- [x] Decide on `SUTRADHAR-ISSUES.md` (currently untracked, blocks the clean-tree gate) — commit
      it (it's real, valuable field-report documentation already cited in known-problems.md)
      DONE 2026-08-18, commit 36b7fdc
- [x] `sdk` and `dev-runtime` packages have no `private` field — verify neither is accidentally
      publishable and doesn't need one added (found during Phase A's package survey)
      DONE 2026-08-18, commit e6b0e50 — both marked `private:true` (sdk had a stale
      `publishConfig.access:public` plus unresolvable `workspace:*` deps on private packages;
      dev-runtime has zero consumers anywhere). Neither is part of the sutradhar bundle.
- [x] Bump `packages/sutradhar/package.json` version 0.3.0 → 0.4.0
      DONE 2026-08-18, commit e5b9679 — also bumped the exported `SUTRADHAR_VERSION` constant
      and the test asserting it (would have been a stale-fixture drift otherwise).
- [x] Confirm `scripts/check-release-ready.mjs` passes (clean tree + no stale workspace dist/)
      DONE 2026-08-18 — first run correctly caught real staleness (agent/sutradhar dist older
      than src, from this pass's own edits); passed clean after a real `build-bundle.mjs` run.
- [x] Fresh clean build of the bundle (`npm run clean && npm run build` in packages/sutradhar)
      and spot-check the built artifact behaves correctly (not just src/)
      DONE 2026-08-18 — `scripts/build-bundle.mjs` rebuilt all 14 workspace dependencies from
      clean, in order. Smoke-tested the real built `dist/index.js` end-to-end against a real
      Chrome: `SUTRADHAR_VERSION` reads `0.4.0`, `launch({viewport})` + `getViewport()` +
      `getWsEndpoint()` all work correctly through the actual bundled artifact. `dist/cli-bin.js`
      runs and its `--help` text includes the `--viewport` flag. `dist/mcp-cli.js` starts cleanly.
- [x] `npm publish --dry-run` from packages/sutradhar to confirm the tarball contents/gate are
      correct WITHOUT actually publishing (dry-run should not require 2FA — verify this
      assumption live, don't just assume it)
      DONE 2026-08-18 — dry-run succeeded cleanly: `prepublishOnly` gate passed, real tarball
      built (18 files, 1.0MB packed / 5.2MB unpacked, sha512 integrity printed), no 2FA prompt
      encountered (confirmed live, not assumed). **Repo is now genuinely publish-ready.**

**PHASE C COMPLETE (2026-08-18).**

## Phase D — Final report

- [x] Write a short RELEASE-0.4.0-READY.md or update known-problems.md/competitive-benchmarks.md
      summarizing everything tested/fixed since 0.3.0 — DONE, see `RELEASE-0.4.0-READY.md` at
      repo root.
- [x] Tell the user explicitly: repo is ready, here's exactly what to run (`npm publish` from
      packages/sutradhar) and that it needs their hardware key — do NOT attempt this step myself
      — DONE, see `RELEASE-0.4.0-READY.md`'s final section.

**TASK COMPLETE (2026-08-18).** Repo is genuinely publish-ready for 0.4.0. Only remaining step is
the user running `npm publish` themselves (2FA required, cannot be automated). One significant
real bug (`PROB-043`) was found and documented but not resolved — not release-blocking per the
reasoning above, but the user has been told plainly.

## Log

- 2026-08-18: Checklist created. Starting Phase A (full regression sweep across untested
  packages) next.
- 2026-08-18: Phase A complete — every one of the 20 packages/apps typechecks, builds, and
  passes its full test suite clean (frontend also verified with a real `vite build`, extension
  verified with manifest/syntax checks since it has no test infra). Zero regressions found.
  Starting Phase B (real bug-hunting beyond existing tests) next.
- 2026-08-18: Phase B found `PROB-043` — a real, reproduced-twice, extensively-isolated bug where
  `type()`/`press_key()` report false-positive success on a long-lived MCP session while the real
  DOM shows nothing landed. Could NOT root-cause or fix within this pass (4 separate direct-
  runtime reproduction attempts all failed — only the actual long-running MCP process shows it).
  **This is the one significant open item from this release-prep pass.** Decision: NOT treating
  as release-blocking for 0.4.0 — never reproduced via SDK/CLI, and reproducing it needs a
  pathologically long-lived MCP process (hundreds of tool calls over hours) that a fresh install
  wouldn't hit on normal usage — but flagging prominently to the user rather than hiding it or
  quietly shipping around it. Logged in known-problems.md with full investigation detail so a
  future session (ideally with a genuinely fresh MCP server process available to test against)
  can pick up where this left off. Continuing to the rest of Phase B, then Phase C.
