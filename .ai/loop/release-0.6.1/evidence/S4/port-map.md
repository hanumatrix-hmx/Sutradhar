# C5-live(d): branch spec -> node:test port map (WSL Node 20.20.2)

Source: `git show fix/gap-315-temp-profile-cleanup:packages/cli/tests/unit/temp-profile.spec.ts` (19 `it` cases).
Port: `probes/wsl/wsl-port.mjs` (run with `node --test` under the literal A9 guard). Log: `wsl/wsl-port.log`
(`# tests 19`, `# pass 19`, `# fail 0`). Count asserted: `grep -c "it('T" wsl-port.mjs` = 19 and node:test reports 19.

| # | spec describe / it | port |
|---|---|---|
| 1 | isAutoTempProfileDir: accepts legacy and mkdtemp-suffixed names | T01 |
| 2 | isAutoTempProfileDir: rejects named profiles, nested dirs, other roots and look-alikes | T02 |
| 3 | commandLinesReference: matches the basename as a whole token, case-insensitively | T03 |
| 4 | commandLinesReference: does not match a longer name that merely starts with it | T04 |
| 5 | decideRemoval: removes only when every rule holds | T05 |
| 6 | decideRemoval: keeps a named/non-temp dir | T06 |
| 7 | decideRemoval: fails closed when the process scan failed | T07 |
| 8 | decideRemoval: keeps a dir a running process has on its command line | T08 |
| 9 | decideRemoval: keeps a dir whose owning Chrome PID is alive | T09 |
| 10 | decideRemoval: keeps a dir younger than the threshold | T10 |
| 11 | waitForPidExit: false at the hard timeout | T11 |
| 12 | waitForPidExit: true once the PID is gone | T12 |
| 13 | fs: createTempProfileDir unique + marker round-trip | T13 |
| 14 | fs: sweep removes only stale, unreferenced, dead-owner temp dirs | T14 |
| 15 | fs: sweep deletes nothing when the process scan fails | T15 |
| 16 | fs: close removes its own fresh temp dir once the owner is gone | T16 |
| 17 | fs: close never removes a dir still referenced by a running process | T17 |
| 18 | fs: close never removes a named profile dir | T18 |
| 19 | fs: close keeps the dir if Chrome does not exit within the timeout | T19 |

## Assertion diff (spec -> port); no assertion weakened
- `expect(x).toBe(y)` -> `assert.equal(x, y)` (node:assert/strict, i.e. `===`).
- `expect(x).toEqual(y)` -> `assert.deepEqual(x, y)` (strict deep equality).
- `expect(x).not.toBe(y)` -> `assert.notEqual(x, y)`.
- `expect(x).toMatch(re)` -> `assert.match(x, re)`.
- `expect(t).toBeLessThan(5_000)` -> `assert.ok(t < 5000)`.
- Literal changes with identical runtime values: Windows-path strings in T03/T04 are built with
  `String.fromCharCode(92)` for the backslash (the tool shell collapses escaped backslashes); T16 writes
  `String()` (the empty string) as the lockfile content; the spec's `ROOT` constant is named `SROOT` because the
  A9 guard already declares `ROOT`. Values: `SROOT = path.resolve(os.tmpdir(), 'root-for-rules')`, same as the spec.
- Every path is printed as a `[cleanup] probe ... path="..."` line for the X1 path check.

Same 19 cases also run on Windows v25 through the branch spec itself, against the extracted module under the
preamble: `spec/branch-spec-vitest.log` (`Tests 19 passed (19)`).
