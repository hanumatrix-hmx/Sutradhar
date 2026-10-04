# GAP-315 fix: the CLI no longer leaks its temp Chrome profile dir

Date: 2026-10-01. Branch `fix/gap-315-temp-profile-cleanup` (off master `fdae749`).
Trigger: 299 leaked `sutradhar-cli-*` dirs (16.9 GB) filled drive E: to 0 MB and broke an audit.

## Change

- `packages/cli/src/temp-profile.ts` (new): the safety rules (`decideRemoval`), the process scan,
  `removeSessionTempProfile` (the close path) and `sweepStaleTempProfiles` (the session-start path).
- `spawn-chrome.ts`: the temp dir is created with `mkdtemp` (`sutradhar-cli-<ms>-<rand>`, so no
  same-millisecond collision). A `.sutradhar-owner.json` marker records the Chrome PID.
  `killChromeTree` is now async and waits for `taskkill` to finish (10 s cap).
- `state.ts`: `userDataDir` + `tempProfile` are persisted with the session.
- `cli.ts`: `close` and self-heal await the kill, wait for the Chrome PID to exit (10 s cap), then
  remove the dir with retries (15 s cap, 250 ms apart, for Windows' post-exit locks).
  `spawnFreshSession` sweeps stale dirs first (15 s budget). A failed removal on `close` only
  prints a warning. Exit code stays 0, and the next session start retries the dir.

Deletion requires ALL of the following:

1. The basename matches `sutradhar-cli-<10+ digits>[-<suffix>]` AND the dir sits directly in
   `os.tmpdir()`. Named profiles (`~/.sutradhar/profiles/<name>`) never match, and `close` also
   requires `state.tempProfile === true`.
2. The process scan succeeded (a failed scan keeps everything) AND no running process has the
   basename as a whole token on its command line.
3. The owner PID (from the marker, or POSIX `SingletonLock`) is not alive.
4. Sweep only: mtime is older than 10 min. `close` uses no age threshold.
5. On Windows, Chrome's exclusive `lockfile` must be deletable before the recursive rm starts.

## Evidence

| AC | Command | Result |
|---|---|---|
| Unit: safety rules | `cd packages/cli && ../../node_modules/.bin/vitest run --globals tests/unit/temp-profile.spec.ts --reporter=verbose` | 19/19 pass (`temp-profile-spec.log`) |
| CLI unit suite | `cd packages/cli && ../../node_modules/.bin/vitest run --globals` | 16 files, 227/227 pass (`cli-vitest.log`) |
| Browser unit suite | `cd packages/browser && ../../node_modules/.bin/vitest run --globals` | 20 files, 933/933 pass |
| tsc | `tsc --noEmit -p packages/cli`, `-p packages/browser` | both clean |
| Live 10x nav+close | `node gap315-live.mjs` (built CLI `packages/cli/dist/cli.js`, isolated `SUTRADHAR_CLI_STATE_DIR`) | ALL PASS (`gap315-live.log`): every iteration exits 0, the session dir is gone after `close`, Chrome PID dead, close 1.3-1.8 s. "no new sutradhar-cli-* dirs remain (new: none)" |
| Negative (live) | same script: a Chrome that the harness started itself (pid 55968) on a backdated `sutradhar-cli-1700000000000-NEG315` dir, with a marker naming a dead PID | the dir survived all 10 session-start sweeps. `removeSessionTempProfile` returned `{"removed":false,"reason":"in-use"}`. After that PID was killed (by PID), the same call returned `{"removed":true}` |
| Negative (live, not staged) | same script | 3 dirs used by OTHER sessions' running Chrome (`sutradhar-cli-1790798002107`, `...2484674`, `...2489781`) all survived |
| Stale sweep (live) | same script | removed 6 pre-existing dead dirs (`sutradhar-cli-1790798439698` ... `...800116522`) whose Chrome was gone (none in the pre-run scan) |

## Mutant check

With `await cleanupSessionTempProfile(state, true);` in `cmdClose` replaced by a no-op in
`dist/cli.js`, one `nav` + `close` left `sutradhar-cli-1790802582944-kiSVg5` behind (it existed
after `close`), so the live check's per-iteration assertion fails. The next session's sweep does
NOT hide the mutant, because the 10-min age rule protects the fresh dir. `dist/cli.js` was
restored from the copy, and the leftover dir was then removed through `removeSessionTempProfile`.

Side observation from that cleanup: the first retry returned `in-use` because the dir's name was
on the command line of the invoking `bash`/`node -e` processes. Rule 2 matches ANY process, not
just Chrome, on purpose. Passing the path through an env var removed the reference, and the
removal then succeeded.

## False-pass analysis

- "Dir removed" could pass if the dir never existed. Ruled out: the mutant run shows the same dir
  exists after `nav` (`ls -d` printed it), and the state's `tempProfile=true` was checked per iteration.
- "No new dirs" could pass if a concurrent session's sweep deleted our dirs rather than `close`.
  Ruled out: sweeps skip dirs younger than 10 min, and the mutant run shows the dir persisting
  when `close` doesn't remove it.
- "Negative survived" could pass through `too-young` (Chrome keeps touching the mtime) instead of
  the in-use rule. Ruled out for the rule itself: the direct `removeSessionTempProfile` call
  (no age threshold) returned `reason: "in-use"`.
- Stale build: the live harness imports `packages/cli/dist` rebuilt by `turbo run build` after
  the change (`dist/temp-profile.js` 02:37, `grep -c removeSessionTempProfile dist/cli.js` = 2).

## Not covered

- A live `--profile <name>` run: that would mean creating a profile in the user's shared
  `~/.sutradhar/profiles.json`. Covered by unit tests (`not-auto-temp`) plus the structural guard
  (`tempProfile:false`, and the dir is outside the temp root).
- POSIX paths (`ps`, `SingletonLock`) are implemented but only exercised on Windows here.
- The PID-reuse-verified kill in FR2-03's spec (`close` kills `state.chromePid` without checking
  the PID is still Chrome) is out of scope and unchanged.
