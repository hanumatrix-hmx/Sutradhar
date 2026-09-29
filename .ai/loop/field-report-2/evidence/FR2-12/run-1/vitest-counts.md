# FR2-12 vitest counts (before / after)

Full suite per package, not just new tests. `node_modules/.bin/vitest run` from each package dir.

| package | before (pre-change, HEAD 3bd520c) | after | delta |
|---|---|---|---|
| capability-runtime | 164 (5 files) | 192 (6 files) | +28 (20 new audit-report.spec.ts + 8 new RA* in runtime.spec.ts) |
| browser | 497 (13 files) | 498 (13 files) | +1 (BT1 in browser-tab-observability.spec.ts) |
| cli | 144 (10 files) | 161 (11 files) | +17 (12 new audit-output.spec.ts + 5 new parse-args.spec.ts) |
| mcp-server | 84 (3 files) | 92 (3 files) | +8 (M1-M8 in tools.spec.ts) |
| sutradhar | 15 (1 file) | 20 (1 file) | +5 (P3-P7 in api.spec.ts) |

All 973 tests passing after the change (192+498+161+92+20 = 963; plus the pre-existing counts
already summed to 904 before — 164+497+144+84+15 = 904; delta +59 matches the individual deltas
above: 28+1+17+8+5 = 59).

No existing test was changed, loosened, skipped or deleted — `EXPECTED_BROWSER_TOOLS` (mcp-server)
got exactly one addition (`'browser.audit'`), which is the only edit to an existing construct.

Full monorepo `pnpm typecheck`: 34/34 successful (matches the loop's baseline count).
Full monorepo `pnpm build`: 9/9 successful (both the `!sutradhar` and `sutradhar` turbo filter
runs).
