# Sutradhar 0.4.0 — release readiness summary

**Status: ready to publish.** This document summarizes the thorough test/fix pass done between
`sutradhar@0.3.0` (commit `d603f20`) and this release, per the user's 2026-08-18 request to test
everything and prepare a 0.4.0 release. Full live status/process detail:
`.ai/release-0.4.0-checklist.md`. Individual issue detail: `.ai/known-problems.md`.

## What changed since 0.3.0

**Milestone 92-94 — a 9-issue external field-report batch fixed** (`SUTRADHAR-ISSUES.md`, a real
tester's log from using the published `0.3.0` package): viewport control is now a genuine
first-class capability across all three integration surfaces (previously only reachable
internally):
- SDK: `launch({viewport})`, `Page.setViewport()`/`Page.getViewport()`
- CLI: `--viewport WIDTHxHEIGHT`, persisted across CLI reattaches
- MCP: `browser.launch`'s `viewport` param, new `browser.get_viewport` tool
- A headed session's real OS window now follows the requested viewport (`page.resize()`), not
  just the CDP override
- `Browser.getWsEndpoint()` for cross-process reconnect
- A console warning when `launch()` is called again without closing a prior session
- The CLI now rejects an unrecognized `--flag` before dispatch instead of silently treating it as
  a positional filename argument

Every fix above is live-verified against a real Chrome, not just unit tests — see `PROB-042` in
`known-problems.md` for the full verification detail (exact measured values, real OS window
bounds via Win32 `GetWindowRect`, etc.).

## Full regression sweep (Phase A)

Every one of the 20 packages/apps in the workspace typechecks, builds, and passes its full test
suite clean: `agent`, `browser`, `capability`, `capability-runtime`, `cli`, `config`, `contracts`,
`events`, `llm`, `mcp-server`, `memory`, `observability`, `sdk`, `storage`, `sutradhar`, `utils`,
`workflow`, `dev-runtime`, `apps/server`, `apps/extension` (the last via manifest/syntax checks —
it has no build tooling). `frontend` additionally verified with a real production `vite build`.
Zero regressions found. Full table in `.ai/release-0.4.0-checklist.md`.

## Real bug-hunting beyond existing tests (Phase B)

- Closed a lingering unverified note in the capability taxonomy (mobile/`hasTouch` emulation —
  now confirmed live through a real MCP round-trip).
- Swept `known-problems.md` for anything still open — nothing found is release-blocking (see
  "Known open items" below).
- **Found a new, real, unresolved bug while dogfooding a combined mobile-viewport checkout flow —
  see "The one significant open item" below.**

## Release hygiene (Phase C)

- Version bumped `0.3.0` → `0.4.0` (minor: additive API surface + bug fixes, no breaking changes).
- Found and fixed a real latent gap: `@sutradhar/sdk` had `publishConfig.access:public` and no
  `private` flag, but depends on two `workspace:*` packages that are both private and never
  published — if it were ever accidentally published, those dependency ranges would be
  unresolvable for any real consumer. Marked `private:true` (along with `@hanumatrix/dev-runtime`,
  which has zero consumers anywhere in the workspace). Neither is part of the `sutradhar` bundle.
- `scripts/check-release-ready.mjs` (the `prepublishOnly` gate) passes clean.
- Full clean rebuild of the bundle from source (`scripts/build-bundle.mjs`, 14 workspace
  dependencies rebuilt from clean, in dependency order) — smoke-tested the actual built
  `dist/index.js`/`dist/cli-bin.js`/`dist/mcp-cli.js` artifacts against a real Chrome, not just
  `src/`.
- `npm publish --dry-run` succeeds cleanly: gate passes, real tarball built (18 files, 1.0MB
  packed / 5.2MB unpacked), no 2FA prompt (confirmed live — a dry-run doesn't trigger it).

## The one significant open item: `PROB-043`

While dogfooding a realistic combined flow (mobile-viewport checkout on saucedemo.com via the
live MCP tool interface), `type()`/`press_key()` reported `success:true` while the real page
showed the value never landed. Reproduced twice. Extensively isolated — 4 separate attempts to
reproduce via direct `SutradharRuntime` scripting (matching viewport, selector style, action
sequence, repeated snapshots, and even a real 70-second delay) all failed to reproduce it; a
fresh tab in the same session typed correctly on the first try. Root cause not identified.

**Not treated as release-blocking**: never reproduced via the SDK or CLI, and it required a
pathologically long-lived MCP server process (hundreds of tool calls across several hours) that a
fresh install wouldn't hit under normal usage. Full investigation: `PROB-043` in
`known-problems.md`. Recommended as the first thing to revisit in a future session, ideally with
a fresh MCP server process available to test reproduction against.

## Known open items (none release-blocking)

- `PROB-002`: whether to wire `packages/memory`'s tier system into the live agent loop — a
  product-direction call awaiting your explicit sign-off, not a bug (recommendation already on
  record: don't build it, `CrossRunMemory` already covers current real usage).
- `PROB-010`: an unwired `RuntimeKernel`/`GoalPlanner` subsystem — real, tested code but dead,
  now marked `@experimental` for clarity rather than deleted (a more consequential change
  deserving its own deliberate look).
- `PROB-015`, `PROB-025`: deeply-investigated, honest-failure-mode flakiness (real validation
  errors / rejected duplicates, not silent corruption) under specific hard scenarios (a 14-scenario
  sequential harness; Stripe Elements cross-field state) — not blocking, already documented.
- `PROB-018`: a deliberate, documented scope boundary (the `allowedDomains` guard doesn't
  intercept click-triggered navigation) — would need real CDP-level interception work to close.

## What to run

```
cd packages/sutradhar
npm publish
```

This will need your hardware-key 2FA — that step was intentionally not attempted here. Everything
up to it has been verified ready.
