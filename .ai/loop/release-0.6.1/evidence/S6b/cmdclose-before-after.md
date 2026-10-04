# cmdClose / self-heal: before (S5 merge 254b1ed + S6a) and after (S6b)

Diff: `cli-vs-S6a.diff` (vs the S6a commit) and `cli-vs-S5-merge.diff` (vs the S5 merge). No line outside the three hunks below changed
(`git diff HEAD -- packages/cli/src/cli.ts | grep -E "^[+-].*(process\.exit|exitCode)"` = 0 lines, `grep-exit-diff.txt`).

## cmdClose, in source order
| # | statement (before) | after | preserved? |
|---|---|---|---|
| 1 | `readState()`, "No active session" early return | unchanged | yes (above every hunk) |
| 2 | dialog gate (`runDialogGate`, `getBroker`, printing handled/blocked dialogs) | unchanged | yes |
| 3 | `closeBlocked` computation + the two warnings | unchanged | yes |
| 4 | `await stopWarden(STATE_DIR).catch(() => {})` | unchanged | yes |
| 5 | `if (state.profileName && !closeBlocked) { ...saveStorageState... }` | unchanged | yes |
| 6 | `if (state.chromePid) {` | `if (state.chromePid) {` | yes |
| 7 | `await killChromeTree(state.chromePid);` | inside `stopSpawnedChrome`: `await deps.kill(pid, KILL_CAP_MS)` with `kill: killChromeTree` (same function, by reference) | yes (same kill; PID validated as a positive integer first, N2) |
| 8 | `await cleanupSessionTempProfile(state, ..., true, deadline)` | inside `stopSpawnedChrome`, AFTER `clearState` | **order changed on purpose** |
| 9 | (shared trailing) `await clearState();` | inside `stopSpawnedChrome`, BEFORE the cleanup. **The trailing clear is removed from this branch** | **the one planned exception** |
| 10 | `} else if (!closeBlocked) { attach + shutdown }` then shared `await clearState()` | `} else { if (!closeBlocked) { attach + shutdown } await clearState(); }` | yes: `clearState()` still runs for both no-chromePid paths, including dialog-blocked (legacy state, N11b); guarded by the O7 source guard (b) and mutant M-O6 |
| 11 | `console.log('Session closed.')` | unchanged | yes |

Exit codes: none changed (no `process.exit`/`exitCode` in the diff). `stopSpawnedChrome` never throws, so a failure in the kill, the state
clear or the cleanup is a warning/debug line, never a new exit path.

## Self-heal (`withSession` `selfHeal`)
Before: `stopWarden` ; `if (state.chromePid) await killChromeTree(pid)` ; `await cleanupSessionTempProfile(state, pid, true, ...)` ; `await clearState()` ; `spawnFreshSession`.
After: `stopWarden` ; `await stopSpawnedChrome(state, sessionStopDeps())` (kill -> clearState -> cleanup, warn=true) ; `spawnFreshSession`.
`clearState` still always runs (it is inside `stopSpawnedChrome`, also when there is no chromePid).
