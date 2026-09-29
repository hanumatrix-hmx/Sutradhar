# FR2-04 spec amendment: re-planned onto HEAD `368598b`, with no FR2-03 dependency

FR2-04 can drop its FR2-03 dependency. Of the 10 §0.6 touchpoints, 5 are dropped and 5 are small changes FR2-04 makes itself to code that exists at HEAD. None is a hard dependency.

Step 1 has **not run yet**: `evidence/FR2-04/` contains only `spec.md` and `step1-experiment.mjs`. So branch D-7 is still undecided. That is FR2-04's own first step, not a dependency, but the build Step 1 runs against has to be clean (§D R-A).

## §A Trace: FR2-03 shapes absent at HEAD

Everything below was read with `git show HEAD:<path>`. `git grep` at HEAD finds **none** of these: `releaseSessionResources`, `clearStateFileIfUnchanged`, `parseCliState`, `probeEndpoint`, `gcFlagError`, `profileDirOwned`, `SUTRADHAR_CLI_STATE_ROOT`, a `'sessions'` verb, `launch-marker`. All of them exist only in the uncommitted working tree (`cli.ts:119`, `state.ts:119`, `parse-args.ts:211`, and the untracked `gc.ts` and `sessions.ts`).

| Planned FR2-03 shape | What HEAD actually has |
|---|---|
| `CliState` gains `profileDir`, `profileDirOwned`, `cwd`, `createdAt` | `state.ts:14-44` has only `sessionId`, `wsEndpoint`, `chromePid?`, `lastUrl?`, `profileName?`, `grantedPermissions?`, `activeTabId?`, `viewport?` |
| `parseCliState` (a subset-picker risk, ST-D1) | `readState` at `state.ts:77-84` is `JSON.parse(raw) as CliState`, which already passes the whole object through. `STATE_DIR` is fixed when the module loads (`:74`). |
| `clearStateFileIfUnchanged`, plus `rmdir` | `clearState` at `state.ts:91-93` is `rm(STATE_FILE, {force:true})`. It never removes the directory. |
| `spawnFreshSession` writes the new fields | `cli.ts:60-91`. The literal at `:82-88` is `{sessionId, wsEndpoint, chromePid, profileName, viewport}`. `SpawnedChrome` (`spawn-chrome.ts:31-39`) is `{wsEndpoint, pid}` only, with no ownership flag. The temp profile is created at `spawn-chrome.ts:68` via `os.tmpdir()`. |
| `releaseSessionResources` in the self-heal | The self-heal is inline at `cli.ts:123-140`: a `Note:` line, `killChromeTree(state.chromePid)`, `clearState()`, `spawnFreshSession`, then `fn` **again** at `:139`. `fn()` runs **inside** the `try` at `:122`, so GAP-006 is real at HEAD. |
| `cmdClose` rewrite | `cli.ts:734-774`: the profile-save `attach` at `:748-756`, the no-`chromePid` `attach`+`shutdown` at `:763-771`, then `clearState()` at `:772` |
| `KNOWN_FLAGS` and `gcFlagError` | `KNOWN_FLAGS` is a **local const** inside `parseArgs` (`parse-args.ts:135-151`), with `isConsumedValue` at `:152-160`. Bad values are reported through `*GivenButInvalid` booleans that `main()` checks at `cli.ts:783-794`, before the `switch` at `:795`. |
| `probeEndpoint`, `sessions --json`, GC attribution | None. No `sessions` case; that verb falls through to help and exits 1 (`cli.ts:860-1012`). |
| FR2-03's awaited cleanup and force-exit changes | `.finally` at `cli.ts:1022-1040`: it disconnects only `activeRuntime`'s session (`:1031-1034`), and the unref'd 3 s force-exit is at `:1039` |

**Already at HEAD and must be kept.** FR2-06 put 10 `validateSelectorArgs` calls in `cli.ts` (`:324, 353, 369, 461, 488, 525, 540, 555, 566, 720`, plus the import at `:18`), `validateFrameChain` at `:510`, and the Selectors help lines at `:883-885`. Each of these runs inside a `cmd*` function **before** `withSession`, so they naturally come before the gate. FR2-04 leaves them alone.

**The spec's anchors have drifted since its base `049a899`:**
- `cli.ts`:
  - `withSession` moved from `:92-147` to `:93-148`.
  - Disconnect moved from `:958` to `:1034`; force-exit from `:963` to `:1039`.
  - Click moved from `:309-316` to `:322-330`; eval from `:467-485` to `:500-520`.
- `runtime.ts` (changed by FR2-02, FR2-09 and FR2-10):
  - Options interface is now `:90` (`allowedDomains` at `:145`); `attach` is `:314`.
  - `findAllOpenPages` is `:362`; `clickAtPoint` is `:569`; `eval` is `:1044`.
  - `getPendingDialog` and `handleDialog` are `:1610-1616`.
- `types.ts`: `AttachOptions` is at `:49`.
- GAP-010's `FAILURE_SCREENSHOT_TIMEOUT_MS` is now **committed**, at `browser-action-engine.ts:111`. It is no longer an uncommitted FR2-01 edit.
- `browser-tab.ts`, `browser-session.ts` and `session-manager.ts` haven't changed since `049a899`, so their anchors still hold.

## §B Disposition of the §0.6 touchpoints

| # | Touchpoint | Disposition | Exact change |
|---|---|---|---|
| 1 | `CliState` fields plus `parseCliState` pass-through | **(b) Self-provide** | Add `dialogPolicy?` and `lastPendingDialog?` to HEAD's `CliState` (`state.ts:14-44`) as §2.7 describes. There is no `profileDir` coupling. `readState` already passes the whole object through, so there's no picker to check. **Recommended fold-in (FR2-14 P1/D10):** make `dialogPolicy.action` `'accept' \| 'dismiss' \| 'report'`, so `--dialog report` **persists** instead of clearing. This avoids rewriting the same line again in FR2-14. |
| 2 | `spawnFreshSession` writes the new fields | **(b) Self-provide** | Add an optional 2nd param `carry?: Pick<CliState,'dialogPolicy'>` to `spawnFreshSession` (`cli.ts:60`), and add `dialogPolicy: <flag-resolved> ?? carry?.dialogPolicy` to the literal at `:82-88`. `lastPendingDialog` is **not** carried over: a fresh Chrome has no dialog open. |
| 3 | Self-heal to `releaseSessionResources` | **(b) Self-provide** | `deps.selfHeal` in `session-flow.ts` is HEAD's existing sequence (`:133-138`): the same `Note: previous session was unreachable (…) — starting a fresh session.` text, `if (state.chromePid) killChromeTree(pid)`, `clearState()`, then `spawnFreshSession(runtime, {dialogPolicy: state.dialogPolicy})`. In Branch W, `stopWarden` runs first. The second `fn` call at `:139` goes away, because `fn` now runs once after the `try` (the GAP-006 split). |
| 4 | `cmdClose` rewrite | **(b) Self-provide** | Work against HEAD's `:734-774`. (a) Run the close-mode gate once before either attach. If it returns `blocked`, skip the profile-save attach (`:748-756`) with the §2.10 warning, **and** skip the no-pid attach at `:763-771`, which would otherwise also hang for 180 s; just clear state. (b) In Branch W, run `stopWarden` before `clearState()` (`:772`). |
| 5 | `KNOWN_FLAGS` and `gcFlagError` | **(b) Self-provide** | Add `--dialog` and `--dialog-text` to the local `KNOWN_FLAGS` (`parse-args.ts:135-151`), and cover both value positions in `isConsumedValue` (`:152-160`). Export `dialogFlagError`. In `main()`, call it right after the `stateFlagGivenButInvalid` check (`cli.ts:792-794`) and before the `switch`. There is no `gcFlagError` to order it after. |
| 6 | `sessions --json` key set (S10) | **(a) Drop** | Doesn't exist at HEAD. |
| 7 | `probeEndpoint` classifies the session `live` | **(a) Drop** | C11 stays as a Chromium fact that E1.jsonVersion verifies. L11 and the STOP row are reworded (§C). |
| 8 | GC attribution of warden processes | **(a) Drop** | Keep the warden's `cwd: os.homedir()` anyway; it costs nothing and avoids Windows directory locks. |
| 9 | `clearStateFileIfUnchanged` plus `rmdir` | **(a) Drop** | HEAD's `clearState` never removes the directory, so `warden.json` can't interfere with it. `stopWarden` still deletes `warden.json` for tidiness. |
| 10 | Force-exit timer and awaited cleanup | **(a) Drop** (re-anchor only) | The watchdog is unchanged and independent of HEAD's `:1039` timer. |

**(c) Hard dependencies: none.** Dialog handling needs only `CliState`, `withSession`, `cmdClose` and `parseArgs`, and all four exist at HEAD.

## §C Changes to the spec (differences from the original only)

**Header and decisions**
- Replace the header's "Merge order FR2-01 → FR2-03 → FR2-04" with: "Base HEAD `368598b` (it includes FR2-06 and FR2-01's landed fixes). No predecessor item."
- Delete the last bullet of §0.5 D-6 (FR2-03 sessions/GC).
- §0.3 STOP row, new consequence text: "The browser process doesn't answer while a dialog is open. The gate's `connectForDialogs` would return `unknown`, attach would hang for up to 180 s, and HEAD's self-heal would kill Chrome. Escalate: the gate needs a detection signal that doesn't depend on the endpoint."

**§1 Files to touch**
- Rows 8, 9 and 13 stay, but are anchored to HEAD per §B.
- Row 16: edit the **HEAD** versions of `packages/cli/README.md` and `AGENT_SETUP.md`. Both have uncommitted FR2-03 edits in the working tree.
- Nothing is added or removed. `spawn-chrome.ts` stays untouched.

**§2 API diff**
- §2.5: `stopWarden` is called by `close` and by self-heal "before `killChromeTree`", replacing "before `releaseSessionResources`".
- §2.7, if the D10 fold-in is adopted: `action: 'accept' | 'dismiss' | 'report'`.
- §2.8.1: `--dialog report` returns `persist:'set'`.
- §2.8.3 comment: `// HEAD's kill + clearState + spawnFresh(carry dialogPolicy)`.
- §2.10: remove `sessions` from the exempt list. "Continue with FR2-03's release" becomes "continue with HEAD's `killChromeTree`/`clearState`".
- New requirement in §2.8.2: `runDialogGate` **disconnects its own `connectForDialogs` browser in a `finally`** on every path. HEAD's `.finally` only disconnects `activeRuntime`'s session (§D R-E).

**§4 Tests**
- **ST-D1, rewritten:** use `vi.stubEnv('SUTRADHAR_CLI_STATE_DIR', tmp)` and `vi.resetModules()`, dynamically import `state.js`, then check that `writeState` followed by `readState` round-trips both new keys deep-equal. The spread `writeState({...state, …})` at `cli.ts:120` also keeps them.
- **D1 row 2, if D10 is adopted:** expect `{policy:{mode:'report'}, persist:'set'}`, with state `action:'report'`. Add FR2-14's DC2 regression row now.
- **D5:** drop `'sessions'` from the exempt assertions.
- **New B6:** in `runDialogGate`, the fake browser's `disconnect` is called exactly once on each of the `clear`, `handled`, `blocked` and throw paths.
- **New P-D9:** `KNOWN_FLAGS` still recognizes every pre-existing flag. `['wait','#x','--state','hidden','--dialog','accept']` parses both flags, with `cleanArgs:['#x']`.
- Re-run `help-text.spec.ts` (FR2-16), which cuts out the help block at the first `` `); ``. The new help lines must not contain that sequence, and FR2-06's Selectors lines must stay unchanged.

**§5 Live verify**
- **Isolation:** set `SUTRADHAR_CLI_STATE_DIR=R/state-<case>` per case, replacing `SUTRADHAR_CLI_STATE_ROOT`. Keep `TEMP`/`TMP`/`TMPDIR=R/temp`, so the `sutradhar-cli-*` profile created at `spawn-chrome.ts:68` lands inside R.
- **Process enumeration:** built into the verify script itself: PowerShell `Get-CimInstance Win32_Process | Select ProcessId,CommandLine`. Chrome is matched by `--user-data-dir=` under `realpath(R)`. Wardens are matched as before.
- **L11, rewritten:** while L1's dialog is open, the observer's `fetch(/json/version)` returns 200 within 3 s. `state.chromePid` stays the same across L1-L10. The text `Note: previous session was unreachable` appears in no case's stderr.
- **L14:** leftover `R/temp/sutradhar-cli-*` directories are expected, because HEAD's `close` never deletes the temp profile. That's an existing leak, not an FR2-04 failure; `rm R` with retry covers it.
- **New L15, self-heal regression** (replaces the §7.2 re-run of `verify-fr2-03-session-gc.mjs`, which doesn't exist at HEAD): the observer `taskkill`s Chrome, then `snap` exits 0. Stderr has the `Note:` line, there's a new `chromePid`, and `dialogPolicy` from an earlier `--dialog accept` is carried over.

**§7**
- R6 is reworded to: "Warden must not outlive its Chrome or its state". Drop the GC reference.
- §7.2: drop `verify-fr2-03-session-gc.mjs`. Add `help-text.spec.ts` and `selector-args.spec.ts`.

## §D New risks from removing the FR2-03 dependency

- **R-A (critical, process).** The working tree carries FR2-03's uncommitted edits to `cli.ts`, `state.ts`, `parse-args.ts`, `spawn-chrome.ts`, the two READMEs, `AGENT_SETUP.md`, `mcp-server/src/cli.ts` and the browser launcher. Before Step 1 or DEVELOP, those must be moved to a WIP commit on a side branch (per the environment rules, don't use a bare `git stash`), and then `pnpm build` rerun from a HEAD-clean tree. Step 1 runs `packages/cli/dist/cli.js`. A build that still contains FR2-03 code would give E3 self-heal readings that don't match what ships.
- **R-B (self-heal at HEAD is cruder).** HEAD's self-heal:
  - kills by raw PID, without FR2-03's GAP-183 start-time check;
  - leaks the temp profile.

  FR2-04 doesn't make this worse. It makes self-heal fire **less often**: the gate stops a dialog from making attach fail, and the GAP-006 split removes `fn()` as a trigger. The gate's `unknown` path (connect fails) still falls through to today's attach and self-heal, unchanged.
- **R-C (close with an open dialog).** `killChromeTree` works whether or not a dialog is open. Only the two `attach` calls in `cmdClose` could hang, and both are gated per §B row 4. N11 covers the profile case. Add N11b for a legacy state with no `chromePid`: it must finish in under 10 s.
- **R-D (warden with no GC safety net), Branch W only.** Nothing sweeps up leaked wardens. The warden's own exit conditions are:
  - Chrome's WebSocket disconnects: a tree kill doesn't reach the warden, because it's a detached Node child, so it exits on this signal instead;
  - the state file is gone or points to a different endpoint (close, self-heal, a deleted state dir);
  - SIGTERM.

  A warden therefore lives exactly as long as its session is "current". Leftover risk: a `state.json` that still points at an orphaned Chrome keeps about 40 MB alive per orphan. That orphaned-Chrome leak already exists and is FR2-03's territory. WD5, WD6 and L14 are the guards.
- **R-E (event-loop linger).** Exit 3 from the gate happens before `activeSessionId` is set, so `.finally` has nothing to disconnect. If the gate doesn't disconnect its own connection, every exit-3 lingers until the 3 s force-exit, which puts L1's "exits 3 in < 6 s" budget at risk. B6 guards this.
- **R-F (more state writes).** `lastPendingDialog` and `dialogPolicy` add writes to HEAD's non-atomic `writeFile` read-modify-write. Concurrent commands in one directory could overwrite each other's keys, as can already happen today. Mitigation:
  - write only when the value changed (already in the spec);
  - re-read state immediately before each write and spread it (`{...fresh, key}`), instead of reusing the copy read at the start.

## §E FR2-05 and FR2-14

**FR2-05: no hard FR2-03 dependency. It is unblocked once FR2-04 is re-planned.**
- Its FR2-03 references are all soft:
  - `SUTRADHAR_CLI_STATE_ROOT` (`:407`) already has a fallback to `SUTRADHAR_CLI_STATE_DIR` (`:511`); make that the primary.
  - The GC-regex check (`:510`): drop it.
  - The self-heal merge note (`:505`): reword it to say FR2-05 builds on FR2-04's `session-flow.ts`.
  - The `sessions`/`--gc` help text (`:508`): drop it.
- Its dependency on FR2-04 is only textual. It adds two keys to the runtime options literal in `withSession` and one wrapper parameter, and puts the env resolution before the gate.
- If Step 1 stalls, FR2-05 could land first and FR2-04 would rebase. Doing them one after the other is still simpler.

**FR2-14: unblocked in principle, but still waits for FR2-04 and FR2-05 to be DONE.** Those are its hard dependencies, and this amendment doesn't change FR2-04's shapes: `DialogPolicy`, `SutradharRuntimeOptions.dialogPolicy`, `CliState.dialogPolicy` and `resolveDialogPolicy` all stay. Adopting D10 now actually settles its P1. Its FR2-03 references need small fixes:
- `STATE_ROOT` (`:23`, `:887`): use the `STATE_DIR` fallback.
- `installShutdownHooks` in `mcp-server/src/cli.ts`: it's uncommitted, so base on HEAD's file.
- The `cmdDoctor` session lines (`:993`): drop.
- The `sessions` verb in the "never loads config" list (`:167`, `:564`) and in N3 (`:936`): remove it.
- ST-C1 (`:838`): rewrite it on `readState` the same way as ST-D1.

**The wider chain:**
- **FR2-07 and FR2-08:** my grep of their specs found FR2-03 only in merge-order preamble text, no shape dependency. They follow FR2-05 once it's DONE.
- **FR2-13:** follows FR2-07, FR2-08, FR2-11 and FR2-12.
- **FR2-15 stays blocked.** Its hard dependency is FR2-01, not this chain.

So this re-plan clears the way for 6 of the 7 (FR2-04, 05, 07, 08, 13, 14), but not FR2-15.

## §F Recommendation

**Yes, FR2-04 is unblocked for DEVELOP.** Every §0.6 touchpoint is either dropped or a small change against code that exists at HEAD. Dialog handling doesn't need GC, profile ownership or endpoint probing. Two preconditions come from the item itself, not from other items:
1. **R-A first:** set aside the FR2-03 working-tree changes and rebuild `dist` from HEAD.
2. **Then run Step 1** to settle D-7 (D, D-hint, W or X), per the spec's own sequencing. The note in `decisions.md` about waiting for FR2-01's fix round no longer applies, since FR2-01 is BLOCKED.

Also decide explicitly whether to fold in FR2-14's D10 "persist report" change. I recommend yes.

Change the ledger row to SPEC (amended, unblocked), and FR2-05 to SPEC, to be developed after FR2-04.

### Critical Files for Implementation
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\cli.ts (HEAD version: `withSession` `:93-148`, `spawnFreshSession` `:60-91`, `cmdClose` `:734-774`, `main` `:776-1014`)
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\state.ts (HEAD `CliState` `:14-44`)
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\parse-args.ts (HEAD `KNOWN_FLAGS` `:135-160`)
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\session\browser-tab.ts
- E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\.ai\loop\field-report-2\evidence\FR2-04\spec.md