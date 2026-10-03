# S3a evidence - refresh 5 SDK-subtree packages in the lockfile (within existing ranges)

Commands are exactly those of plan S3a (update, install --frozen-lockfile, both audits, forced build with
`--concurrency=1`, dist marker grep, both inventories), then the mcp-server and capability-runtime matrix entries
(`$SP/matrix.sh S3a mcp-server capability-runtime`, same per-entry command as S1) and the live probe.
Build: start 04:40:18, end 04:41:02 (`build-times.txt`), `Tasks: 20 successful, 20 total`, `Cached: 0 cached`, exit 0.
df -h /e before: 50G free.

Moved keys (`moved-keys.txt`, from `lock.diff`): fast-uri 3.1.5 -> 3.1.8, qs 6.15.3 -> 6.16.0, hono 4.13.1 -> 4.13.12,
@hono/node-server 2.1.0 -> 2.1.3, ip-address 10.3.1 -> 10.7.3. Nothing else moved (lock.diff: 22 insertions, 22 deletions).

## AC results
| AC | result | evidence |
|---|---|---|
| S3a-1 | PASS | `ac-check.out.txt` S3a-1; `s3a-1-details.txt`: `git diff --name-only` = `pnpm-lock.yaml` only, manifest changes 0, `overrides` in lock diff 0 and in root package.json 0, SDK still `@modelcontextprotocol/sdk@1.30.0` (lock lines 974/3045; manifest `"1.30.0"`). `status.txt` = lockfile + evidence dir only. |
| S3a-2 | PASS | `ac-check.out.txt` S3a-2: moved package set is exactly `@hono/node-server,fast-uri,hono,ip-address,qs`. |
| S3a-3 | PASS | `audit-summary.txt`: `audit-prod 0/0/0/0`, advisories=0, totalDependencies=160 (S1 prod: 16 advisories, same 160 deps). Full audit: 5 moderate / 12 high / 1 critical (S1: 16/17/1); the remainder is dev-only (vitest critical, vite, esbuild, braces, and the dev packages S3b targets). |
| S3a-4 | PASS | `dist-fast-uri.txt`: exactly one marker `fast-uri@3.1.8` (>= 3.1.8). `build.log` dist mtimes 2026-10-04 04:40:59 (after the lockfile change and `install`). `inventory-vs-NEW-audit.txt`: `shipped advisories: 0`; `inventory-vs-OLD-audit.txt` (S1 audit, still listing fast-uri@3.1.5 advisories) also 0 because the inlined version is now 3.1.8. `grep -c fast-uri`: mcp-cli.js 6, index.js 0, cli-bin.js 0 (unchanged distribution, only the version moved). |
| S3a-5 | PASS | `test-totals.txt`: mcp-server 5 files / 156 tests passed, `tools.spec.ts` named in the log; capability-runtime 13 / 505 passed; both equal S1 (`$EV/S1/test-totals.txt`); iso-guard lines present (36 / 44), exit=0. |
| S3a-6 | PASS | `mcp-probe.out.json`: serverInfo.version `0.6.0`, toolCount 73, `browser.wait_for` present, `browser.launch` real browser, `browser.navigate` to its own 127.0.0.1 server (server saw `/s3a-probe`; title `S3a-probe-title`, verification verified), `browser.shutdown_all` success, `childExited {"code":0}`, `noLeftoverChromeUnderTmp` PASS, `[iso-guard]` in both the probe and the MCP child (NODE_OPTIONS inherited, pid 74520). `mcp-probe.sha256` records the probe hash (S11 must reuse unmodified). |

## Mutants (check-level; `mutants.txt`, `mcp-probe-negative.txt`)
- `install` skipped (dist still built from the old tree; modelled by feeding the S3a-4 check the S1 baseline dist markers,
  `fast-uri@3.1.5`, and the S1 inventory): `S3a-4: FAIL: versions=3.1.5 inv0=false`, exit 1.
- `--latest`-style update (modelled by a fabricated moved-keys list with an SDK move + zod and a fabricated status with a
  manifest change): `S3a-1: FAIL ... package.json`, `S3a-2: FAIL: moved: @modelcontextprotocol/sdk,fast-uri,zod`, exit 1.
- Probe with `EXPECT_VERSION=9.9.9`: `version: FAIL`, exit 1. Probe under the real TEMP: `ISOLATION GUARD ... exit=97`.
  These were not full re-runs of pnpm with the mutation applied (that would rewrite the lockfile / node_modules); the real
  commands were run once, un-mutated.

## False-pass analysis
- S3a-1: `git status` clean-looking because the lockfile change was already staged/committed. Ruled out: the commit has not
  happened yet; `git diff --name-only` (live, unstaged) lists `pnpm-lock.yaml` and nothing else (`s3a-1-details.txt`).
- S3a-2: key names grepped from a stale diff. `lock.diff` was regenerated after the update and the keys are also visible in
  the lock itself; check run live by `ac-check.mjs`, which also fails on the fabricated SDK move.
- S3a-3: `audit --prod` = 0 could be an offline/error response. `audit-prod.json` has `totalDependencies=160`, no `error`,
  and the full audit run right after it still reports 18 real advisories (dev), so the registry was reachable.
- S3a-4: the dist could be a cached turbo output. Build used `--force` ("Cached: 0 cached, 20 total"), dist mtimes are 04:40:59
  (this run), and the marker grep reads the shipped file, not the metafile. Two independent sources (dist grep + esbuild
  metafile inventory) agree on 3.1.8. `grep -c` confirms only mcp-cli.js carries fast-uri.
- S3a-5: logs could be pre-existing S1 logs. They live in `$EV/S3a/` and were produced at 04:41:15-04:41:30 with the guard
  lines; counts equal S1 by coincidence of unchanged tests, not by copy.
- S3a-6: the probe could pass with a mocked/other server. It spawns `process.execPath` on the absolute
  `<WT>/packages/sutradhar/dist/mcp-cli.js` (logged on stderr), checks the server's own request log (`serverSawRequest`:
  `/s3a-probe` was fetched by Chrome), and a negative run (`EXPECT_VERSION=9.9.9`) shows the checks can fail. The leftover-Chrome
  query filters on process Name chrome/msedge + the isolated tmp basename (a plain cmdline match would hit the parent bash).
