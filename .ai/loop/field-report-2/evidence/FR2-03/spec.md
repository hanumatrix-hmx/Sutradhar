# FR2-03: Session and profile garbage collection (implementation spec)

**Item:** FR2-03 (Phase 1, a resource leak with real user impact: 300+ leaked profiles nearly filled a disk).

**Decisions in force:**
- §4.9: prefer additive, backward-compatible changes and the smallest diff; record each choice.
- CLAUDE.md scope boundary: deletions are part of the product's feature. The harness may only delete inside its own scratch root, and it proves that.

**Baseline read at:** HEAD 74be245 on `claude/field-report-2-loop`. FR2-01's code is in 16a9173. Line numbers below are from the current files, not the finding's older ones.

## 0. Trace results (the "must decide explicitly" list)

### 0.1 Where profile dirs are created, and who owns them

| # | Creator | Code | Dir | Owner today | Deleted today? |
|---|---|---|---|---|---|
| A | CLI throwaway session | `packages/cli/src/spawn-chrome.ts:68`: `path.join(os.tmpdir(), \`sutradhar-cli-${Date.now()}\`)`. The CLI never creates the dir; Chrome creates it when it launches. | `%TEMP%/sutradhar-cli-<ms>` | Nothing is recorded. `CliState` (`state.ts:14-44`) has no path. | **Never.** Not by `cmdClose` (`cli.ts:688-728`), not by self-heal (`cli.ts:122-139`), not when spawning fails (`spawn-chrome.ts:97` throws and leaves Chrome and its dir behind). |
| B | CLI named profile | `cli.ts:61-66` resolves `ProfileManager.resolveUserDataDir` to `~/.sutradhar/profiles/<name>` (`profile-manager.ts:42-44, 75, 113`) | persistent | ProfileManager registry | Only `profile delete`. **GC must never touch it.** |
| C | Runtime launch (SDK `launch()`, MCP `browser.launch`, apps/server) with no `userDataDir` | `browser-launcher.ts:147-155` calls `puppeteer.launch({ userDataDir: undefined })`. puppeteer-core 25.5.0 `ChromeLauncher.js:76-80` creates it with `mkdtemp(join(os.tmpdir(), 'puppeteer_dev_chrome_profile-'))` (`BrowserLauncher.js:280`; `temporaryDirectory` is never set in puppeteer-core) | `%TEMP%/puppeteer_dev_chrome_profile-XXXXXX` | Puppeteer, in memory | Yes on a graceful `browser.close()` (`BrowserLauncher.js:75-78` and `cleanUserDataDir`, `rm` with `maxRetries: 5`). **Not** on a hard crash of Node. **Also not** when a script simply exits without `close()`: @puppeteer/browsers `launch.js:236-272` kills Chrome synchronously on process `exit`, but the dir removal runs from Chrome's async `'exit'` event (`:196-216`), which never fires inside an exiting process. |
| D | Runtime launch with `profileName` or an explicit `userDataDir` | `runtime.ts:229-230` | caller's or named dir | caller | Never. That's correct. |

**Can the dir alone prove Sutradhar created it?**
- Row A: yes. The name `sutradhar-cli-<digits>` sits directly under the temp root, and nothing else uses that prefix.
- Row C: **no.** Every Puppeteer user on the machine creates `puppeteer_dev_chrome_profile-*`, including other MCP servers and this harness's own observers.

**Decision D1: mark every Sutradhar-launched Chrome.**
- **A process marker.** Add these switches to the Chrome command line:
  - `--sutradhar-launch=<cli|runtime>`
  - `--sutradhar-owner-pid=<node pid>`
  - `--sutradhar-owner-start=<ms epoch>`
  - `--sutradhar-state=<base64url(abs state.json path)>` (CLI only)

  Chrome ignores unknown switches, and pages can't see the command line, so this has no stealth or fingerprint effect.
- **An owner file for row-C dirs only.** When `options.userDataDir === undefined`, write `.sutradhar-owner.json` (`{v:1, tool:"sutradhar", kind:"runtime", ownerPid, ownerStartMs, chromePid, createdAt}`) into Puppeteer's temp dir right after launch. Puppeteer's own graceful cleanup still removes it together with the dir.

**Decision D2: --gc covers row-C dirs, but only when attributed.** A `puppeteer_dev_chrome_profile-*` dir is deleted only if it holds a valid owner file whose owner is dead. It's also deleted if a marked `runtime` browser process pointing at it was just killed by this GC run. Unmarked Puppeteer dirs are never touched: they're reported as kept with reason `not-sutradhar`.

Rows B and D are never deleted, under any rule. Every deleter goes through one guard, `isOwnedTempProfileDir(dir, tempRoot)` (§2.4):
- `dirname(realpath(dir)) === realpath(tempRoot)`
- the basename matches `^sutradhar-cli-\d{10,}(?:-[A-Za-z0-9]{6})?$` or `^puppeteer_dev_chrome_profile-[A-Za-z0-9]{6}$`
- `lstat` says it's a real directory, not a symlink or junction

### 0.2 Process enumeration, cross-platform, no new dependency

- `killChromeTree` (`spawn-chrome.ts:104-118`) is fire-and-forget:
  - On Windows it runs `spawn('taskkill', ['/PID', pid, '/T', '/F'])` and never awaits it.
  - On POSIX it sends `process.kill(-pid, 'SIGKILL')`, which works because `spawn-chrome.ts:79` uses `detached: true`, so Chrome is a process-group leader.

  FR2-03 reuses the same commands, but awaits them and then confirms the PID has exited (§2.3).
- **Windows:** `wmic` is gone. It's absent on this machine: `Get-Command wmic` returned nothing. Use `powershell.exe -NoProfile -NonInteractive -EncodedCommand <b64 UTF-16LE>`, running:

  ```powershell
  [Console]::OutputEncoding=[Text.Encoding]::UTF8
  Get-CimInstance Win32_Process | ForEach-Object {
    [pscustomobject]@{ p=$_.ProcessId; pp=$_.ParentProcessId;
      c=[int64](($_.CreationDate.ToUniversalTime()-[datetime]'1970-01-01').TotalMilliseconds);
      a=$(if ($_.CommandLine -like '*--user-data-dir*' -or $_.CommandLine -like '*--sutradhar-*' -or $_.CommandLine -like '*sutradhar-cli-*' -or $_.CommandLine -like '*puppeteer_dev_chrome_profile-*') { $_.CommandLine } else { $null }) } } |
    ConvertTo-Json -Compress
  ```

  **Measured cost here:** 712 ms end-to-end for 604 processes (a `Measure-Command` of an equivalent query). Timeout 15 s. `-EncodedCommand` avoids quoting problems. Execution policy doesn't apply to `-Command`/`-EncodedCommand`.
- **Windows children carry no `--user-data-dir`.** Measured on this machine: of 8 `chrome.exe` processes, only the browser (whose default profile has no flag) and `crashpad-handler` had `--user-data-dir`. The `gpu-process`, `utility` and `renderer` processes had none. So:
  - A process belongs to dir D if its command line contains `--user-data-dir=D`, **or** contains D as a path substring (crashpad), **or** its `ParentProcessId` chain within the snapshot reaches such a process.
  - Guard against PPID reuse: a parent must have been created before its child.
  - The **browser process** is the one without `--type=`.
- **macOS/Linux:** `ps -axo pid=,ppid=,etime=,command=` works on procps and on BSD/macOS `ps`. `etimes` isn't on macOS, so parse `etime` (`[[dd-]hh:]mm:ss`) and compute `startMs = now - etime*1000`, accurate to 1 s. On Linux, re-read `/proc/<pid>/cmdline` (NUL-separated, exact) for candidate lines, because `ps` output loses argument boundaries around spaces.
- **Unavailable** (no PowerShell, Constrained Language failure, busybox `ps`, timeout, parse failure): return `{ok:false, reason}`. GC then **kills nothing**. It deletes a dir only if every other rule holds and a lock probe says the dir is free:
  - POSIX: read the `SingletonLock` symlink target `host-<pid>`; free if that PID is dead or the link is absent.
  - Windows: try to `unlink(<dir>/lockfile)`; free if that works or the file is absent. A running Chrome holds it open, so the unlink fails with EBUSY/EPERM.

  The report says `processEnumeration: unavailable (<reason>)` and the exit code is 2.
- **Single-PID lookup** for close/self-heal verification: `getProcessCommandLine(pid)`.
  - Windows: `Get-CimInstance Win32_Process -Filter "ProcessId=<int>"`. Only a validated integer is interpolated.
  - POSIX: `/proc/<pid>/cmdline`, or `ps -p <pid> -o command=`.

### 0.3 "Live" and "stale", defined precisely

For each `state.json`:
- **Endpoint probe.** Parse `ws://H:P/devtools/browser/<id>`, then `GET http://H:P/json/version` with `AbortSignal.timeout(1500)`. `reachable` means HTTP 200 **and** `webSocketDebuggerUrl` ends with `/devtools/browser/<same id>`. A different id means another browser has reused the port, which counts as **unreachable**.
- **`pidAlive`:** `process.kill(pid, 0)`. It's alive on success or EPERM, dead on ESRCH.
- **`pidMatchesProfile`:** from enumeration, the PID's command line contains `--user-data-dir=<state.profileDir>` (normalized per §0.8). For a legacy state with no `profileDir`, it must contain `--user-data-dir=<tempRoot>/sutradhar-cli-`. The result is `null` when enumeration is unavailable.

| status | rule | GC action |
|---|---|---|
| `live` | reachable | never touched |
| `unresponsive` | not reachable, `pidAlive`, `pidMatchesProfile === true` | kept (hung Chrome, or just slow). Reported with the hint "run `sutradhar close` in <cwd>". |
| `unknown` | not reachable, `pidAlive`, `pidMatchesProfile === null` | kept (can't prove anything) |
| `stale` | not reachable **and** (`!pidAlive` **or** `pidMatchesProfile === false`, which means the PID was reused) | clear state. Delete `profileDir` if `profileDirOwned` and it passes the guard. Kill nothing: the PID is dead or belongs to someone else. |
| `unreadable` | JSON parse failure or no `wsEndpoint` | kept and reported; never deleted |

A PID alone is never proof. A kill always needs either (reachable + same browser id) or (a command-line match on the profile dir or a marker).

### 0.4 Races

- **Another cwd mid-spawn** (dir exists, `state.json` not yet written):
  - The new spawn creates its dir with `mkdtemp` before launching Chrome (§2.3).
  - Chrome carries `--sutradhar-owner-pid=<CLI pid>`. While that owner is alive and its start time matches within 5 s, the browser is not an orphan.
  - GC lists dirs **before** enumerating processes. Any Chrome that already existed when the dir listing ran is therefore visible to the enumeration.
  - The only window left is `mkdtemp` → Chrome process creation. That's covered by a **grace period of N = 120 s** on dirs that have no evidence of any kind (no state, no process, no owner file), with age taken from the dir's `mtime`.
  - **Why N = 120 s:** a spawn's worst case is the 10 s DevTools deadline (`spawn-chrome.ts:84`) plus attach plus `writeState`, well under 30 s. So 120 s is a margin of more than 4×, and it costs nothing for a leak measured in days. Constant `GC_GRACE_MS = 120_000`, with no environment knob; the harness backdates dirs with `utimes` instead.
- **Legacy (pre-0.5.0) unmarked Chrome** with a `sutradhar-cli-*` dir and no state referencing it: killed only if its process age is ≥ 120 s. That protects an old-version CLI that's mid-spawn.
- **Concurrent `close` or self-heal on a session GC judged stale:**
  - `clearState` is compare-and-delete: GC re-reads the file just before `rm` and deletes only if `sessionId` and `wsEndpoint` still equal what it planned against. Otherwise the result is `changed-concurrently`.
  - Deleting a dir or killing a process that's already gone is fine: `rm` uses `force` and ignores ENOENT, and taskkill's "not found" is ignored.
  - Dirs of sessions that were live in the snapshot are never deleted by GC. If `close` fails to delete one, the next GC collects it.

### 0.5 Windows locks after a kill

1. `await killChromeTree(pid)`: await taskkill's exit, then poll `process.kill(pid, 0)` every 50 ms until ESRCH, up to 5 s.
2. `removeDirWithRetry(dir)`: up to **8 attempts**, delays 100, 200, 400, 800, 1000, 1000, 1000 ms (≈4.5 s worst case). It retries on EBUSY, EPERM, ENOTEMPTY, EACCES, EMFILE and ENFILE.
3. After `rm` resolves, check `existsSync(dir)`. Only `!exists` counts as `deleted`.
   - An exhausted retry, or a dir that still exists, gives `{status:'failed', code, attempts}`. It's printed and counted, and makes the GC exit code 2.
   - ENOENT on the first attempt gives `absent`, reported separately.
   - **Nothing is ever reported deleted without the existence check.**

### 0.6 MCP stdin close

- The SDK is `@modelcontextprotocol/sdk` 1.30.0. `StdioServerTransport` (`dist/esm/server/stdio.js`) listens only for `data` and `error`, never `end` or `close`. `close()` pauses stdin without emitting `end`.
- Today `packages/mcp-server/src/cli.ts:37-47` hooks SIGINT/SIGTERM with a `shuttingDown` flag, and nothing else.
- **Decision:** move the hooks into a new testable module `shutdown-hooks.ts`:
  - Triggers are `stdin 'end'`, `stdin 'close'`, SIGINT and SIGTERM, all behind one shared guard.
  - `stdin 'error'` is **not** a trigger on its own; a real disconnect also produces `end`/`close`.
  - `'end'` fires only when the client closes its write side. The transport's `data` listener keeps stdin flowing, so an idle open pipe never fires it.
  - A stdin of `/dev/null` or `ignore` would end immediately and shut down. A stdio MCP server can't work without stdin anyway, so this is documented, not guarded.
- **Exit codes:** 0 after `shutdownAll` settles, even if it rejected (logged to stderr; the same as today's `:43-44`). A new 10 s deadline forces `exit(1)` if `shutdownAll` hangs.

### 0.7 Synchronous deletion and the 3 s timer

- The force-exit timer (`cli.ts:963`) is armed in `.finally` **after `main()` settles**. Everything awaited inside `cmdClose`, self-heal, `sessions` and GC finishes before it starts. So deletion runs synchronously (awaited) in both `close` and self-heal.
- Self-heal does kill → wait → remove the old dir **before** `spawnFreshSession`: sequential and deterministic, typically under 300 ms.
- The risk is `printErrorAndExit` (`cli.ts:50-53`, a raw `process.exit(1)`) on the spawn-failure paths (`cli.ts:65, 72, 76`). Cleanup must be **awaited before** it's called (§2.5).

### 0.8 Backward compatibility and path identity

- An old `state.json` without `profileDir`/`cwd`/`createdAt`:
  - `readState` still works.
  - `sessions` shows `cwd: null` ("unknown (created before 0.5.0)") and uses the state file's `mtime` as age (`ageSource: "stateFileMtime"`).
  - `close` kills as before, now PID-verified, and prints a stderr note to run `doctor --gc`.
  - Its dir, once unreferenced and older than the grace period, is collected by the orphan-dir scan.
- New fields are ignored by old CLIs.
- **Path comparison:** normalize with `fs.realpathSync.native` when the path exists (this expands Windows 8.3 names like `RUCHIK~1` and macOS `/var` → `/private/var`), otherwise `path.resolve`. Strip trailing separators. Lower-case on win32 only.

### 0.9 `close --all-stale` vs `doctor --gc`

**Decision D3:** one operation, two spellings. `close --all-stale` is an exact alias of `doctor --gc`: same code, output and exit codes. Both accept `--dry-run`. Rationale: both are in the Done-when list, the semantics would otherwise overlap about 90%, and one code path means one test set.

### 0.10 FR2-01 carry-over

`parse-args.ts` (current `:88-188`) has the `KNOWN_FLAGS` set and the `isConsumedValue` pattern. `main()` (`cli.ts:730-748`) validates flags before dispatch. New flags must go into `KNOWN_FLAGS`, or `unrecognizedFlags` rejects them.

GAP-003's possible fix adds renderer-backgrounding flags to `spawn-chrome.ts`. **FR2-03 must start DEVELOP only after FR2-01 is DONE** and rebase onto whatever `spawn-chrome.ts` looks like then. FR2-03 has no file overlap with FR2-02 (whose file list is capability-runtime plus `tools.ts`), so the two can run in parallel in separate worktrees.

---

## 1. Files to touch

| # | File | Reason |
|---|---|---|
| 1 | `packages/browser/src/launcher/launch-marker.ts` (new) | Marker constants; `buildMarkerArgs`; `parseMarkerArgs`; `OWNER_FILE_NAME = '.sutradhar-owner.json'`; `writeOwnerFile`; `parseOwnerFile`; `processStartMs()`. Single source of truth for the CLI and the runtime. |
| 2 | `packages/browser/src/launcher/index.ts` | `export * from './launch-marker.js'` |
| 3 | `packages/browser/src/launcher/browser-launcher.ts` | `launch()` (`:135-172`): append the runtime markers to `args` (not in `prepareLaunchArgs`, so its tests are unchanged). After launch, if `options.userDataDir === undefined`, write the owner file best-effort. |
| 4 | `packages/cli/src/state.ts` | New `CliState` fields; `resolveStateRoot`; an optional third param on `resolveStateDir`; `SUTRADHAR_CLI_STATE_ROOT`; export `STATE_FILE_PATH`; `parseCliState` (tolerant); `clearStateIfUnchanged`. |
| 5 | `packages/cli/src/spawn-chrome.ts` | `mkdtemp` naming; markers; return `userDataDir`/`ownsUserDataDir`; clean up on failure; `killChromeTree` becomes async and awaits exit. |
| 6 | `packages/cli/src/process-list.ts` (new) | `listProcesses`, `getProcessCommandLine`, parsers (`parseWindowsCommandLine`, `parseEtime`, `parsePsOutput`, `parseCimJson`), `extractUserDataDir`, `isBrowserProcess`, `isPidAlive`, `waitForPidExit`, `killPid`. Command runner is injectable. |
| 7 | `packages/cli/src/profile-cleanup.ts` (new) | `normalizePathForCompare`, `isOwnedTempProfileDir`, `removeDirWithRetry`, `probeLock`, `SUTRADHAR_TEMP_DIR_RE`, `PUPPETEER_TEMP_DIR_RE`, `GC_GRACE_MS`. |
| 8 | `packages/cli/src/sessions.ts` (new) | `scanStateFiles`, `probeEndpoint`, `classifySession` (pure), `formatSessionsHuman`, `toSessionsJson`. |
| 9 | `packages/cli/src/gc.ts` (new) | `collectGcSnapshot`, `planGc` (pure), `executeGc` (injectable deps), `formatGcHuman`, and a JSON report. |
| 10 | `packages/cli/src/parse-args.ts` | `--all-stale`, `--gc`, `--dry-run` booleans in `KNOWN_FLAGS`; exported `gcFlagError(parsed)`. |
| 11 | `packages/cli/src/cli.ts` | `spawnFreshSession` (`:59-90`) writes the new fields and cleans up on failure. Self-heal (`:122-139`). `cmdClose` (`:688-728`). `cmdDoctor` (`:226-239`) gets a summary plus `--gc`. New `cmdSessions`. `main()` validation and dispatch. Help text (`:815-935`). |
| 12 | `packages/cli/src/index.ts` | Also export the `CliState` type as-is. No other public additions. |
| 13 | `packages/mcp-server/src/shutdown-hooks.ts` (new) | `installShutdownHooks` |
| 14 | `packages/mcp-server/src/cli.ts` | Replace `:37-47` with `installShutdownHooks({ runtime, stdin: process.stdin, proc: process })`. |
| 15 | Tests (new): `packages/browser/tests/unit/launch-marker.spec.ts`, `packages/cli/tests/unit/{process-list,profile-cleanup,sessions,gc,spawn-chrome}.spec.ts`, `packages/mcp-server/tests/unit/shutdown-hooks.spec.ts` | §4 |
| 16 | Tests (extend, never loosen): `packages/browser/tests/unit/launcher.spec.ts`, `packages/cli/tests/unit/{state,parse-args}.spec.ts` | §4 |
| 17 | `tools/scenario-suite/verify-fr2-03-session-gc.mjs` (new), `tools/scenario-suite/fixtures/fr2-03-page.html` (new), `tools/scenario-suite/fixtures/fr2-03-sdk-holder.mjs` (new), `tools/scenario-suite/fixtures/fr2-03-decoy-puppeteer.mjs` (new) | §3, §5 |
| 18 | `packages/cli/README.md` (`:12`, `:89-90`, `:133-137`), `packages/mcp-server/README.md` (a lifecycle note), `AGENT_SETUP.md` (one line under the CLI section: `doctor --gc`) | Docs match behavior. |
| 19 | `.ai/loop/field-report-2/evidence/FR2-03/changelog-fragment.md` (new) | Additive note: new verbs/flags, the new env var, dirs now cleaned, MCP exits on stdin EOF. |

**Not touched:**
- `profile-manager.ts`: named profiles are only read, never modified.
- `runtime.ts`: `shutdownAll` is unchanged.
- `tools.ts`: tool count is unchanged.
- `session-manager.ts`.

---

## 2. API / CLI / schema diff

### 2.1 `launch-marker.ts` (new, `@sutradhar/browser`)

```ts
export const MARKER_LAUNCH = '--sutradhar-launch';          // =cli|runtime
export const MARKER_OWNER_PID = '--sutradhar-owner-pid';     // =<int>
export const MARKER_OWNER_START = '--sutradhar-owner-start'; // =<ms epoch int>
export const MARKER_STATE = '--sutradhar-state';             // =<base64url(abs state.json path)>, cli only
export const OWNER_FILE_NAME = '.sutradhar-owner.json';
export type LaunchKind = 'cli' | 'runtime';
export interface LaunchMarker { kind: LaunchKind; ownerPid: number; ownerStartMs: number; stateFile?: string }
export function processStartMs(): number;                 // Math.round(Date.now() - process.uptime()*1000)
export function buildMarkerArgs(m: LaunchMarker): string[]; // no arg contains whitespace or a quote
export function parseMarkerArgs(argvOrCmdline: readonly string[] | string): LaunchMarker | undefined;
export interface OwnerFile { v: 1; tool: 'sutradhar'; kind: 'runtime'; ownerPid: number; ownerStartMs: number; chromePid?: number; createdAt: string }
export async function writeOwnerFile(userDataDir: string, data: Omit<OwnerFile,'v'|'tool'>): Promise<void>; // throws; the caller swallows
export function parseOwnerFile(raw: string): OwnerFile | undefined; // strict: v===1, tool==='sutradhar', integer PIDs
```

### 2.2 `browser-launcher.ts` `launch()`

```ts
// BEFORE (:147) puppeteer.launch({ executablePath, headless, args: launchArgs, defaultViewport, userDataDir })
// AFTER
const marker = buildMarkerArgs({ kind: 'runtime', ownerPid: process.pid, ownerStartMs: processStartMs() });
const browser = await puppeteer.launch({ ..., args: [...launchArgs, ...marker], userDataDir: options.userDataDir });
if (options.userDataDir === undefined) {
  const udd = browser.process()?.spawnargs.find(a => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
  if (udd) await writeOwnerFile(udd, { kind:'runtime', ownerPid: process.pid, ownerStartMs: processStartMs(),
                                       chromePid: browser.process()?.pid, createdAt: new Date().toISOString() })
             .catch(err => this.logger.warn('[BrowserLauncher] owner file not written', { error: (err as Error).message }));
}
```

`prepareLaunchArgs` is unchanged. Never write into a caller-supplied or named-profile dir.

### 2.3 `spawn-chrome.ts`

```ts
// BEFORE
export interface SpawnedChrome { wsEndpoint: string; pid: number }
export async function spawnDetachedChrome(headless, userDataDir?, userAgent?, windowSize?): Promise<SpawnedChrome>
export function killChromeTree(pid: number): void
// AFTER
export interface SpawnedChrome { wsEndpoint: string; pid: number; userDataDir: string; ownsUserDataDir: boolean }
export async function spawnDetachedChrome(headless: boolean, userDataDir?: string, userAgent?: string,
  windowSize?: { width: number; height: number }, stateFile?: string): Promise<SpawnedChrome>
//  - no userDataDir: dir = await mkdtemp(path.join(os.tmpdir(), `sutradhar-cli-${Date.now()}-`)), ownsUserDataDir = true
//    (this also fixes the same-millisecond collision: two concurrent spawns used to share one dir, and Chrome's singleton
//    handoff would then attach the second spawn to the first browser)
//  - args += buildMarkerArgs({ kind:'cli', ownerPid: process.pid, ownerStartMs: processStartMs(), stateFile })
//  - on the 10s timeout, and on any throw after spawn: await killChromeTree(pid); if owned, await removeDirWithRetry(dir); rethrow the same message
export async function killChromeTree(pid: number, waitMs = 5000): Promise<{ exited: boolean }>
//  win32: await the taskkill /PID <pid> /T /F child's exit (ignore its exit code), then waitForPidExit(pid, waitMs)
//  posix: the same kill(-pid) → kill(pid) fallback as today, then waitForPidExit
```

### 2.4 `profile-cleanup.ts` (new)

```ts
export const GC_GRACE_MS = 120_000;
export const SUTRADHAR_TEMP_DIR_RE = /^sutradhar-cli-\d{10,}(?:-[A-Za-z0-9]{6})?$/;
export const PUPPETEER_TEMP_DIR_RE = /^puppeteer_dev_chrome_profile-[A-Za-z0-9]{6}$/;
export function normalizePathForCompare(p: string, platform = process.platform): string;
export function isOwnedTempProfileDir(dir: string, tempRoot: string, kind: 'cli'|'runtime'|'any' = 'any'): boolean; // §0.1 guard
export interface RemoveResult { status: 'deleted'|'absent'|'failed'; attempts: number; code?: string; message?: string }
export async function removeDirWithRetry(dir: string, deps?: { rm?, exists?, sleep? }, attempts = 8): Promise<RemoveResult>;
export async function probeLock(dir: string): Promise<'free'|'in-use'|'unknown'>; // §0.2 degraded mode
```

### 2.5 `state.ts`

```ts
export interface CliState {
  // ...all existing fields unchanged...
  /** NEW. The exact --user-data-dir passed to Chrome (throwaway temp dir or named-profile dir). Absent in pre-0.5.0 states. */
  profileDir?: string;
  /** NEW. true only when the CLI created profileDir itself as a throwaway temp dir; false for --profile. Only true dirs are ever deleted. */
  profileDirOwned?: boolean;
  /** NEW. path.resolve(process.cwd()) when the session was created. */
  cwd?: string;
  /** NEW. ISO time the session was created (age for `sessions`). */
  createdAt?: string;
}
export function resolveStateRoot(envRoot: string | undefined): string; // envRoot ? path.resolve(envRoot) : ~/.sutradhar-cli
export function resolveStateDir(cwd: string, envOverride: string | undefined, envRoot?: string): string;
//   BEFORE: path.join(os.homedir(), '.sutradhar-cli', hash). AFTER: path.join(resolveStateRoot(envRoot), hash). Override still wins.
export const STATE_FILE_PATH: string;   // exported, used for the marker and the `current` flag
export function parseCliState(raw: string): CliState | undefined; // undefined unless an object with string sessionId + wsEndpoint
export async function clearStateFileIfUnchanged(file: string, expect: { sessionId: string; wsEndpoint: string }): Promise<'cleared'|'changed-concurrently'|'absent'>;
//   also rmdir(dirname(file)) only if now empty; never removes other files (FR2-11 history.jsonl will live there)
```

**New env var:** `SUTRADHAR_CLI_STATE_ROOT`. It's needed because the harness must not touch `~/.sutradhar-cli`, and overriding HOME breaks Chrome (`state.ts:65-66`).

**Temp-root override (D4):** none is added. `os.tmpdir()` already honors `TEMP`/`TMP` (Windows) and `TMPDIR` (POSIX) at call time, and Puppeteer's `getProfilePath` calls `tmpdir()` at launch. So one env override isolates both CLI dirs and Puppeteer dirs. The harness preflight (§3.2) proves Chrome launches under it. **If that preflight fails**, fall back to adding `SUTRADHAR_CLI_TEMP_ROOT` (used by `spawn-chrome.ts` and as GC's CLI `tempRoot`), and record it in decisions.md.

`spawnFreshSession` writes:

```ts
{ sessionId, wsEndpoint, chromePid, profileName, viewport,
  profileDir: spawned.userDataDir, profileDirOwned: spawned.ownsUserDataDir,
  cwd: path.resolve(process.cwd()), createdAt: new Date().toISOString() }
```

It passes `STATE_FILE_PATH` as `stateFile`. On attach failure (`:75-77`) it runs `await killChromeTree(spawned.pid)`, then removes the dir if owned, **then** calls `printErrorAndExit`.

### 2.6 Close and self-heal (shared helper in `cli.ts`)

```ts
async function releaseSessionResources(state: CliState): Promise<void> // never throws; warnings go to stderr
// 1. probe = await probeEndpoint(state.wsEndpoint)
// 2. if state.chromePid:
//      reachable                       → await killChromeTree(pid)
//      !reachable && isPidAlive(pid)   → cmd = await getProcessCommandLine(pid);
//                                         kill only if cmd.ok && the command line references state.profileDir
//                                         (legacy: `${tempRoot}/sutradhar-cli-`); else stderr
//                                         `Warning: not killing PID <n>: could not verify it is this session's Chrome (<reason>).`
//      !isPidAlive                     → nothing
//    (today's code kills state.chromePid blindly: cli.ts:135 and :716)
// 3. if profileDir && profileDirOwned && isOwnedTempProfileDir(profileDir, os.tmpdir(), 'cli'):
//      r = await removeDirWithRetry(profileDir);
//      if r.status==='failed': stderr `Warning: could not remove profile dir <dir> (<code> after <n> attempts). Reclaim it later with "sutradhar doctor --gc".`
//    else if !profileDir: stderr `Note: this session was created by an older Sutradhar version that did not record its profile dir. Run "sutradhar doctor --gc" to reclaim it.`
```

- **`cmdClose`:** profile save (`:694-711`, unchanged). If `chromePid` is set, call `releaseSessionResources`; otherwise use the existing detach path. Then `clearState()`. stdout stays exactly `Session closed.`, exit code 0.
- **Self-heal (`:132-138`):** the same `Note:` line, then `await releaseSessionResources(state)`, `clearState()`, `spawnFreshSession`.

### 2.7 `parse-args.ts`

```ts
// ParsedArgs additions
allStale: boolean;   // --all-stale
gc: boolean;         // --gc
dryRun: boolean;     // --dry-run
// KNOWN_FLAGS += '--all-stale', '--gc', '--dry-run'   (booleans, no consumed values)
export function gcFlagError(p: ParsedArgs): string | undefined;
//  --gc with verb !== 'doctor'        → '--gc is only valid with "doctor" (sutradhar doctor --gc [--dry-run])'
//  --all-stale with verb !== 'close'  → '--all-stale is only valid with "close" (sutradhar close --all-stale [--dry-run])'
//  --dry-run without doctor --gc / close --all-stale → '--dry-run requires "doctor --gc" or "close --all-stale"'
```

`main()` calls `gcFlagError` right after the `stateFlagGivenButInvalid` check (`cli.ts:746-748`), and exits 1 with `Error: <msg>`.

### 2.8 New and changed verbs

**`sessions [--json]`** (read-only; never mutates anything)
- Scans `resolveStateRoot(env)/*/state.json`, plus `SUTRADHAR_CLI_STATE_DIR/state.json` if that's set and outside the root. It enumerates processes once and probes endpoints in parallel (concurrency 16).
- Human output: a header line, one row per session, sorted by status (live, unresponsive, unknown, stale, unreadable) then by age. `*` marks the current cwd's state file.

```
Sessions (3) in C:\Users\x\.sutradhar-cli   (process check: ok)
  STATUS        AGE     CHROME PID      ENDPOINT      CWD
* live          12m     12345 alive     reachable     E:\proj\a
  stale         3h 5m   23456 dead      unreachable   E:\proj\b
  stale         2d      31337 reused    unreachable   (unknown: created before 0.5.0)
2 stale: run "sutradhar doctor --gc --dry-run" to preview cleanup.
```

  With zero sessions it prints `No CLI sessions found in <root>.`
- `--json` prints:

```json
{ "stateRoot": "...", "generatedAt": "ISO", "processEnumeration": { "ok": true } | { "ok": false, "reason": "..." },
  "sessions": [ { "stateFile": "...", "current": true, "status": "live|unresponsive|unknown|stale|unreadable",
    "sessionId": "...|null", "cwd": "...|null", "createdAt": "ISO|null", "ageMs": 720000, "ageSource": "createdAt|stateFileMtime",
    "chromePid": 12345, "pidAlive": true, "pidMatchesProfile": true, "endpoint": "ws://...", "endpointReachable": true,
    "profileDir": "...|null", "profileDirOwned": true, "profileDirExists": true, "profileName": "...|null" } ] }
```

- **Exit codes:** 0 whenever the listing ran, including when there are 0 sessions, stale sessions, or enumeration was unavailable. 1 for a usage error, or an error reading the state root other than ENOENT.

**`doctor`** (no flags): the existing 4-5 lines are unchanged, plus:

```
Sessions:        3 (1 live, 2 stale): "sutradhar sessions" for details
Leaked profiles: 5 dirs, 2 orphan Chrome processes: "sutradhar doctor --gc --dry-run" to preview cleanup
```

These are computed from a dry plan.

**`doctor --gc [--dry-run]`**, and its alias `close --all-stale [--dry-run]`:

Order of operations:
1. Scope: `tempRoot = realpath(os.tmpdir())`, `stateRoot`, plus the extra `STATE_DIR`.
2. List candidate dirs (regexes + `lstat` + `mtime`), **first**.
3. Scan states.
4. Enumerate processes.
5. Probe endpoints.
6. `planGc`.
7. With `--dry-run`: print and exit 0.
8. Execute, in this order:
   - Kill browser trees, all in parallel, each awaited up to 5 s.
   - Kill stray attributed children (`killPid`, no tree).
   - `clearStateFileIfUnchanged` for stale sessions.
   - `removeDirWithRetry` for each planned dir, concurrency 4.
9. Re-list dirs and re-enumerate processes to get `remaining`.

**Attribution:**
- A browser process P with `--user-data-dir=D` (and no `--type=`) is **Sutradhar's** if:
  - (a) it has the `--sutradhar-launch` marker, or
  - (b) D passes `isOwnedTempProfileDir(D, tempRoot, 'cli')` (legacy), or
  - (c) D holds a valid owner file.
- It's **in scope** if D is under `tempRoot`, or its CLI marker's state file is under `stateRoot` or `STATE_DIR`.

**Kill P only if all of these hold:**
1. It's Sutradhar's.
2. It's in scope.
3. No non-stale scanned session references P (by `chromePid` or `profileDir`).
4. Its orphan test passes:
   - `cli` marker: the marker's state file is missing, unparsable, or references neither P nor D, **and** the owner PID isn't alive-and-same (alive, and its start time within 5 s of `ownerStartMs`; alive with an unknown start time counts as alive).
   - `runtime` marker: the owner PID isn't alive-and-same.
   - Legacy (b): process age ≥ `GC_GRACE_MS`.
   - Owner file only (c): owner not alive-and-same.
5. Enumeration is ok.

Named-profile CLI orphans (D under `~/.sutradhar/profiles`): the process is killed (D5), and the dir is **never** deleted.

**Delete dir D only if all of these hold:**
1. `isOwnedTempProfileDir(D, tempRoot)`.
2. If it's a Puppeteer dir, it has a valid owner file whose owner is not alive-and-same, **or** this run killed a marked runtime browser on D.
3. No non-stale session references D.
4. No process in the post-kill state references D. Enumeration ok, or, when degraded, `probeLock(D) === 'free'`.
5. One of these holds:
   - D is a stale session's dir,
   - D's browser was killed by this run,
   - D's owner file shows a dead owner,
   - or `now - mtime(D) ≥ GC_GRACE_MS`.

**`kept[]` reasons:** `live-session`, `unresponsive-session`, `unknown-liveness`, `in-use`, `grace`, `not-sutradhar`, `out-of-scope`, `named-profile`, `symlink`, `unreadable-state`.

**JSON report (`--json`):**

```json
{ "dryRun": false, "scope": { "tempRoot": "...", "stateRoot": "...", "extraStateDirs": [] }, "graceMs": 120000,
  "processEnumeration": { "ok": true, "count": 604 },
  "actions": [
    { "type": "kill", "pid": 1, "role": "browser|child", "userDataDir": "...", "reason": "orphan-cli|orphan-runtime|legacy-orphan", "result": "planned|killed|failed", "error": "?" },
    { "type": "clearState", "stateFile": "...", "result": "planned|cleared|changed-concurrently|absent" },
    { "type": "deleteDir", "path": "...", "reason": "stale-session|orphan-browser|owner-dead|orphan-dir", "result": "planned|deleted|absent|failed", "code": "?", "attempts": 0 } ],
  "kept": [ { "path": "...?", "pid": 0, "reason": "..." } ],
  "remaining": { "orphanProcesses": 0, "orphanDirs": 0 }, "exitCode": 0 }
```

The human output mirrors this. It ends with `Summary: killed a/b orphan browsers, cleared c stale sessions, deleted d/e dirs, f FAILED.` Every failure is on its own line with its code.

**Exit codes:**
- 0: every planned action succeeded (kept items are fine), or it was a dry run.
- 2: at least one action `failed`, or process enumeration was unavailable (orphans may remain undetected).
- 1: a usage error or a fatal error.

### 2.9 MCP `shutdown-hooks.ts`

```ts
export interface ShutdownHookOptions {
  runtime: { shutdownAll(): Promise<void> };
  stdin: NodeJS.EventEmitter; proc: { on(ev: 'SIGINT'|'SIGTERM', fn: () => void): unknown; exit(code: number): never };
  log?: (msg: string, err?: unknown) => void;   // default: console.error (never stdout)
  deadlineMs?: number;                           // default 10000
}
export function installShutdownHooks(o: ShutdownHookOptions): { trigger(reason: string): void };
// Triggers: stdin 'end' | 'close', SIGINT, SIGTERM. One guard. Each fire logs `[sutradhar-mcp] shutting down (<reason>)`.
// When shutdownAll settles → exit(0). Deadline timer (unref) → log + exit(1).
```

`cli.ts` `main()` calls it after `server.connect(transport)`. The existing uncaught/unhandled handlers are unchanged.

---

## 3. Fixture and harness design

### 3.1 Isolation (it must never touch the real user's state)

**Scratch root:** `R = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-03-'))`. Subdirs:
- `R/temp`: the temp override
- `R/state-root`
- `R/cwd-1 … R/cwd-9`
- `R/named/fr2p`: a fake named profile holding a `Preferences` file
- `R/outside/sutradhar-cli-1600000000001`: a tampered-path target
- `R/precious/keep.txt`: a symlink target

**Child env for every spawned CLI, MCP or SDK process:**

```
{ ...process.env, TEMP: R/temp, TMP: R/temp, TMPDIR: R/temp, SUTRADHAR_CLI_STATE_ROOT: R/state-root }
```

with `SUTRADHAR_CLI_STATE_DIR` **deleted**. Each CLI session runs with `cwd: R/cwd-i`, so the real cwd-hash path is exercised.

**Safety interlocks (abort the whole run on failure, before any non-dry GC):**
1. Snapshot the real `os.tmpdir()` names matching `^(sutradhar-cli-|puppeteer_dev_chrome_profile-)` → `realBefore`.
2. Run `node cli.js doctor --gc --dry-run --json` with the child env. Assert `scope.tempRoot === realpath(R/temp)` and `scope.stateRoot === R/state-root`.
3. After every real GC: every `kill` action's `userDataDir` and every `deleteDir` path starts with `realpath(R)`.
4. At the end: every name in `realBefore` still exists (GC never deleted real temp dirs). Other agents may add entries, so equality isn't asserted.

**Independent observer** (don't import the code under test). The harness has its own copy of the enumeration:
- Windows: the same `Get-CimInstance` script via `-EncodedCommand`.
- POSIX: `ps -axo pid=,ppid=,command=`.

`observedProcsFor(dirSubstring)` = processes whose command line contains the substring (case-insensitive on win32), plus their PPID descendants. **Orphan count** = `observedProcsFor(realpath(R/temp))`, minus processes of the control session's dir and the decoy dirs. **Dir count** = entries of `R/temp` matching the two regexes, minus the control-session and decoy dirs.

### 3.2 Preflight

Run `node cli.js nav <fixture>?case=preflight` in `R/cwd-9`. Read `state.json` under `R/state-root/*/`. Assert:
- `profileDir` starts with `realpath(R/temp)`
- `profileDirOwned === true`
- `cwd === R/cwd-9`
- `createdAt` parses and is within 60 s of now

Then `close`. Assert Chrome launched fine under the TEMP override (it navigated), and the D4 fallback isn't needed.

### 3.3 Fixture

`fixtures/fr2-03-page.html` is a static page whose title is `fr2-03 ${location.search}`. It has no `#never` element. It's served by a local `http.createServer` on 127.0.0.1:0. Per-case uniqueness goes **in the query string** (the decisions.md gotcha).

### 3.4 Helper processes

- **`fixtures/fr2-03-sdk-holder.mjs <n>`:** imports the worktree's `packages/sutradhar/dist/index.js`, calls `launch({ headless: true })` n times, prints one JSON line (`{pid: process.pid, browsers: [...wsEndpoints]}`), then idles on `setInterval`.
- **`fixtures/fr2-03-decoy-puppeteer.mjs`:** raw `puppeteer-core` (via `createRequire(packages/browser/package.json)`), `launch({ headless: true, executablePath })`, which gives an **unmarked** Puppeteer temp dir with no owner file. Prints its pid, then idles.

### 3.5 Session and crash construction (the Done-when proof, "L1")

**Leg A, runtime (MCP + SDK), 5 sessions:**
1. Spawn the MCP server (`packages/mcp-server/dist/cli.js`, stdio, child env). Call `browser.launch` ×3 with the same args `run-mcp.mjs` uses (headless).
2. Spawn `sdk-holder 2`.
3. Record the new `puppeteer_dev_chrome_profile-*` dirs in `R/temp` by diffing listings: expect 5. Find each dir's browser PID via the observer (a process containing the dir, with no `--type=`).
4. **Feature checks:** each dir has a `.sutradhar-owner.json` whose `ownerPid` is the MCP or holder PID. Each browser's command line contains `--sutradhar-launch=runtime` and the right owner PID.
5. **kill -9 the Node side:**
   - Windows: `taskkill /PID <mcpPid> /F` and `taskkill /PID <holderPid> /F`, **without `/T`**. `/T` would take Chrome down too, which a real crash doesn't.
   - POSIX: `process.kill(pid, 'SIGKILL')` (the PID only, not the group).
6. **Precondition, so the proof isn't vacuous:** all 5 browsers are still alive (observer). If any died along with Node, record that honestly in the evidence.
7. **Kill two Chromes** (one MCP, one SDK), completely: Windows `taskkill /PID <b> /T /F`; POSIX `process.kill(-b, 'SIGKILL')`. Wait until the observer shows no process for those dirs.

   Expected state: 3 orphan runtime browser trees alive, 5 runtime dirs.

**Leg B, CLI, 5 sessions plus a control:**
1. `nav` in `R/cwd-1..5` and `R/cwd-6` (control).
2. For sessions 1-5, start an in-flight `wait "#never" 60000` in each cwd. Assert each child is still running after 3 s (`Promise.race` against the child's exit: a "not-yet" assertion, not a sleep standing in for a condition).
3. kill -9 those 5 CLI Node processes (Windows `taskkill /PID /F` without `/T`; POSIX SIGKILL).
4. Kill Chrome of sessions 1 and 2 (tree). They're now **stale**: state present, PID dead, dir present.
5. Delete the state dirs of sessions 3 and 4 (`R/state-root/<hash>`). That simulates a wiped `~/.sutradhar-cli` or a deleted `SUTRADHAR_CLI_STATE_DIR`. Their Chromes are now **orphans**: CLI marker, state file missing, owner PID dead.
6. Session 5 stays **live**, and so does control 6.

**Fake old leaks (legacy simulation):**
- Create `R/temp/sutradhar-cli-16000000000{10..19}` (10 dirs), each with a `Local State` file, and `utimes` them to now − 1 h after writing.
- Create one young fake, `R/temp/sutradhar-cli-<now>-YOUNG1`: no owner, fresh mtime.

**Negative fixtures (see §6):**
- The decoy Chrome processes D1-D3.
- A hand-written legacy stale state (no new fields; the PID of a spawned-and-exited `node -e ""`, confirmed dead just before writing).
- A named-profile state (`profileDir: R/named/fr2p`, `profileDirOwned: false`, dead PID).
- A tampered state (`profileDirOwned: true`, `profileDir: R/outside/...`, dead PID).
- A symlink `R/temp/sutradhar-cli-1600000000002`, which is a junction on win32 (`fs.symlinkSync(R/precious, link, 'junction')`), backdated.
- A corrupt `R/state-root/deadbeefdeadbeef/state.json` containing `{not json`.
- A lock-held dir `R/temp/sutradhar-cli-1600000000003`, backdated:
  - Windows: a holder `node -e "setInterval(()=>{},1e9)"` spawned with `cwd` set to that dir. Windows won't delete a process's cwd.
  - POSIX: `mkdir sub; touch sub/f; chmod 0o555 sub`. Skip the POSIX variant if running as root, and record that.

### 3.6 Teardown (always, in `finally`)

- `close` in `R/cwd-5` and `R/cwd-6`.
- Kill the decoys and holder processes (tree).
- Restore `chmod`.
- `rm R` with retry.
- Final observer count of any process containing `realpath(R)` must be 0. Saved to `live-summary.json`.

---

## 4. Unit tests (numbered; all existing tests stay unchanged)

**`browser/tests/unit/launch-marker.spec.ts`**
- **M1:** `buildMarkerArgs({kind:'cli', ownerPid:123, ownerStartMs:1700000000000, stateFile:'C:\\Users\\John Doe\\.sutradhar-cli\\ab\\state.json'})` returns exactly 4 args. None matches `/[\s"]/`.
- **M2:** round trip. `parseMarkerArgs(build(x))` deep-equals x, for the argv form and for a space-joined command-line string. Includes a unicode path (`C:\\Ünï\\state.json`).
- **M3:** the `runtime` kind returns 3 args and no `--sutradhar-state`.
- **M4:** `parseMarkerArgs` on a string with no markers is `undefined`. A non-integer PID (`--sutradhar-owner-pid=12a`) is `undefined`.
- **M5:** `parseOwnerFile` accepts a valid v1 file. It returns `undefined` for `tool:'other'`, `v:2`, a string `ownerPid`, invalid JSON, or an array.

**`browser/tests/unit/launcher.spec.ts`** (additions only; the existing tests are untouched and `prepareLaunchArgs` stays marker-free)
- **L1:** real `launch({headless:true})`. `puppeteerBrowser.process().spawnargs` contains `--sutradhar-launch=runtime` and `--sutradhar-owner-pid=${process.pid}`. The `--user-data-dir` from spawnargs has `.sutradhar-owner.json` with `ownerPid === process.pid` and `chromePid === process().pid`. After `close()`, `existsSync(dir) === false`, so Puppeteer's cleanup still works.
- **L2:** `launch({headless:true, userDataDir: mkdtemp})`: the markers are present, and `existsSync(join(dir, '.sutradhar-owner.json')) === false`.
- **L3:** `prepareLaunchArgs()` contains no arg starting with `--sutradhar-`.

**`cli/tests/unit/state.spec.ts`** (the 4 existing tests are unchanged)
- **ST1:** `resolveStateRoot(undefined) === path.join(os.homedir(), '.sutradhar-cli')`.
- **ST2:** `resolveStateRoot('/x/y') === path.resolve('/x/y')`.
- **ST3:** `resolveStateDir('/p/foo', undefined, '/root')` starts with `path.resolve('/root')` and equals `resolveStateDir('/p/foo', undefined, '/root')`.
- **ST4:** the env override wins over envRoot.
- **ST5:** `parseCliState` on legacy JSON `{"sessionId":"s","wsEndpoint":"ws://x","chromePid":5}` returns an object with `profileDir/cwd/createdAt === undefined`. `'null'`, `'[]'`, `'{}'`, or `'{"sessionId":1}'` give `undefined`.
- **ST6:** `clearStateFileIfUnchanged` in a temp dir:
  - a matching file gives `cleared` and the file is gone;
  - a changed `sessionId` gives `changed-concurrently` and the file is intact;
  - a missing file gives `absent`;
  - a sibling `history.jsonl` survives, and so does the dir;
  - with no sibling, the dir is removed.

**`cli/tests/unit/parse-args.spec.ts`** (additions)
- **P1:** `['close','--all-stale']` gives `allStale:true`, `cleanArgs:[]`, `unrecognizedFlags:[]`.
- **P2:** `['doctor','--gc','--dry-run']` gives `gc:true`, `dryRun:true`, `unrecognizedFlags:[]`.
- **P3:** `['sessions','--json']` gives `jsonMode:true`.
- **P4:** `['snap']`: all three are false.
- **P5:** `gcFlagError` returns `undefined` for doctor+gc, doctor+gc+dry-run, close+all-stale, close+all-stale+dry-run.
- **P6:** the exact messages in §2.7 for `snap --gc`, `doctor --all-stale`, `doctor --dry-run`, `sessions --dry-run`.

**`cli/tests/unit/process-list.spec.ts`**
- **PL1:** `parseWindowsCommandLine('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=1 "--user-data-dir=C:\\Users\\John Doe\\AppData\\Local\\Temp\\sutradhar-cli-1727000000000-AbC123" --no-first-run')[2] === '--user-data-dir=C:\\Users\\John Doe\\AppData\\Local\\Temp\\sutradhar-cli-1727000000000-AbC123'`.
- **PL2:** `extractUserDataDir` handles `--user-data-dir="C:\\a b\\c"` (giving `C:\\a b\\c`) and an unquoted value, and returns `undefined` when absent or when the value is empty.
- **PL3:** `isBrowserProcess` is false with `--type=renderer` and with `--type=crashpad-handler`, and true without `--type`.
- **PL4:** `parseEtime`: `'05:03'`=303, `'12:34:56'`=45296, `'1-02:03:04'`=93784, `'x'` is undefined.
- **PL5:** `parsePsOutput` on a 3-line sample with leading spaces and a command containing spaces gives the correct pid/ppid/startMs (± 1000 against an injected `now`) and full args.
- **PL6:** `parseCimJson` on a single object (not an array), on an array, with `a:null`, and on an empty string (no processes) gives `[]`.
- **PL7:** `listProcesses` with an injected runner that throws, exits nonzero, times out, or returns garbage gives `{ok:false, reason}` containing the cause. It never throws.
- **PL8:** `isPidAlive(process.pid) === true`. For the PID of an awaited-exited `spawn(process.execPath, ['-e',''])`, it's false.

**`cli/tests/unit/profile-cleanup.spec.ts`**
- **PC1:** the regexes match `sutradhar-cli-1727000000000` and `sutradhar-cli-1727000000000-AbC123`, and reject `sutradhar-cli-foo`, `xsutradhar-cli-1727000000000`, `sutradhar-cli-1727000000000-AbC12`, `sutradhar-cli-1727000000000/..`, and `puppeteer_dev_chrome_profile-` with no suffix.
- **PC2:** `isOwnedTempProfileDir` is true for `<tmp>/sutradhar-cli-1727000000000`. It's false for:
  - a nested `<tmp>/a/sutradhar-cli-1727000000000`
  - the named profile path `~/.sutradhar/profiles/x`
  - a symlink or junction
  - a regular file

  With `kind:'cli'`, it's false for a Puppeteer dir.
- **PC3:** `normalizePathForCompare`: with platform `'win32'`, `C:\\Users\\X\\` equals `c:\\users\\x`. With platform `'linux'`, `/Tmp/A` ≠ `/tmp/a`.
- **PC4:** `removeDirWithRetry` with rm failing EBUSY ×3 then succeeding gives `{status:'deleted', attempts:4}`. The injected sleep was called with `[100, 200, 400]`.
- **PC5:** EBUSY on all attempts, and exists stays true, gives `{status:'failed', code:'EBUSY', attempts:8}`.
- **PC6:** rm resolves but `exists` still returns true gives `failed` with code `STILL_EXISTS`. It's never `deleted`.
- **PC7:** the dir is absent up front gives `absent`, with 0 rm calls.
- **PC8:** a non-retryable code (EINVAL) fails on attempt 1 with no sleep.

**`cli/tests/unit/sessions.spec.ts`**
- **S1-S6:** the `classifySession` rows exactly as in §0.3:
  - reachable gives live;
  - unreachable + dead gives stale;
  - unreachable + alive + match gives unresponsive;
  - unreachable + alive + mismatch gives stale;
  - unreachable + alive + enumeration unavailable gives unknown;
  - legacy state + alive + a command line with `<tmp>/sutradhar-cli-` gives unresponsive.
- **S7:** `probeEndpoint` against a local `http.Server`:
  - `/json/version` with the same browser id gives reachable;
  - a different id gives unreachable (reason `browser-id-mismatch`);
  - a closed port gives unreachable in under 1000 ms;
  - a server that never responds gives unreachable with elapsed between 1400 and 2500 ms.
- **S8:** `scanStateFiles` on a temp root with dirs holding valid, legacy and corrupt JSON, plus a plain file at the root, gives exactly 3 entries. Corrupt has status `unreadable`. An ENOENT root gives `[]`.
- **S9:** legacy age uses the state file mtime and `ageSource:'stateFileMtime'`; a new state uses `createdAt`.
- **S10:** the `toSessionsJson` keys equal exactly the §2.8 key set. The human formatter includes `(unknown: created before 0.5.0)` for `cwd:null` and marks `current` with `* `.

**`cli/tests/unit/gc.spec.ts`** (pure `planGc(snapshot, now, platform)`)
- **G1:** a live session's pid and dir appear in no action; kept reason `live-session`.
- **G2:** a stale session with a dead pid gives `clearState` plus `deleteDir(stale-session)` and no kill.
- **G3:** a stale session with `profileDirOwned:false` gives `clearState`, no `deleteDir`, and kept `named-profile`.
- **G4:** a stale session with `profileDirOwned:true` but the dir outside `tempRoot` gives no `deleteDir`.
- **G5:** a CLI-marked browser, state file missing, owner dead gives a kill (`orphan-cli`) plus `deleteDir(orphan-browser)` with no grace, even with mtime = now.
- **G6:** the same, but with the owner alive and start within 5 s: no kill, and the dir is kept `in-use`.
- **G7:** owner alive, start differs by 60 s (PID reuse): killed.
- **G8:** a CLI-marked browser whose marker state file sits **outside** `stateRoot` but exists and references its pid: not killed.
- **G9:** a runtime-marked browser with a dead owner gives a kill (`orphan-runtime`), and its Puppeteer dir is deleted.
- **G10:** an unmarked browser on a Puppeteer dir with no owner file: no kill, no delete, kept `not-sutradhar`.
- **G11:** an unmarked browser on `<tmp>/decoy-profile-1`: ignored entirely.
- **G12:** a legacy unmarked browser on `sutradhar-cli-<n>`, unreferenced: at age 30 s it's kept `grace`; at age 121 s it's killed (`legacy-orphan`).
- **G13:** an orphan `sutradhar-cli` dir with no refs and no process: mtime 121 s gives delete, 119 s gives kept `grace`.
- **G14:** a dir referenced by any process (even an unmarked renderer via ancestry): no delete, kept `in-use`.
- **G15:** enumeration unavailable gives zero kill actions and `incomplete:true`. Dirs are deleted only where `lockProbe === 'free'`; with `'unknown'` they're kept.
- **G16:** an out-of-scope marked orphan (dir outside `tempRoot`, state outside the roots): no kill, kept `out-of-scope`.
- **G17:** a named-profile CLI orphan (state under `stateRoot`, missing): killed, dir kept `named-profile`.
- **G18:** children of a killed browser (PPID chain) are covered by the tree kill. A child on an orphan dir whose browser is already dead gives `kill(child)`. A child of a live browser gives no action.
- **G19:** the win32 path comparison is case-insensitive (`C:\\Users\\X` vs `c:\\users\\x`); on linux it's case-sensitive.
- **G20:** a symlink candidate is never deleted, kept `symlink`. An unreadable state is kept `unreadable-state` and never cleared.

**`cli/tests/unit/gc.spec.ts`** (`executeGc` with injected fake deps)
- **X1:** dry-run makes 0 calls to kill, rm, clearState or unlink (spies).
- **X2:** a kill whose pid is still alive after `waitMs` gives `result:'failed'` and exit code 2.
- **X3:** a `changed-concurrently` clear is reported and isn't counted as a failure; exit 0 if nothing else failed.
- **X4:** a `deleteDir` failure keeps the path out of the deleted count, gives `remaining.orphanDirs ≥ 1`, and exit 2.
- **X5:** all ok gives exit 0; enumeration unavailable (non-dry) gives exit 2; dry-run gives 0.
- **X6:** order of operations: every kill resolves before the first `rm` call (recorded call order).

**`cli/tests/unit/spawn-chrome.spec.ts`** (the pure arg builder `buildChromeArgs` is extracted from `spawnDetachedChrome` for this)
- **SC1:** the args contain `--user-data-dir=<dir>`, `--sutradhar-launch=cli`, `--sutradhar-owner-pid=${process.pid}`, and a `--sutradhar-state` that decodes to the given path. `--headless=new` appears only when headless.
- **SC2:** the default dir basename matches `SUTRADHAR_TEMP_DIR_RE` and its parent is `os.tmpdir()`. Stub `os.tmpdir()` via the TMP/TEMP/TMPDIR env set to a temp dir.

**`mcp-server/tests/unit/shutdown-hooks.spec.ts`** (fake EventEmitters, fake timers)
- **H1:** stdin `end`: `shutdownAll` is called once, and after it resolves, `exit(0)`.
- **H2:** `end`, then `close`, then SIGINT, then SIGTERM: `shutdownAll` is called exactly once, `exit` exactly once.
- **H3:** `shutdownAll` rejects: `log` gets called with the error, then `exit(0)`.
- **H4:** `shutdownAll` never settles: after `deadlineMs`, `exit(1)` exactly once. A later settle doesn't call `exit` again.
- **H5:** no events, or only `data`/`pause`/`resume`, over 60 s of fake time: no `shutdownAll`, no `exit`.
- **H6:** stdin `error` alone: no shutdown.
- **H7:** `log` output never goes to stdout (the default logger is `console.error`; spy on `process.stdout.write`: 0 calls).

---

## 5. Live-verify script: `tools/scenario-suite/verify-fr2-03-session-gc.mjs`

**Prerequisite:** `pnpm build`.

**Outputs** (all in `.ai/loop/field-report-2/evidence/FR2-03/`):
- `live-cases.jsonl`: one line per case, with the surface, expected, observed, pass, and raw stdout/stderr/exit.
- `gc-dryrun.json` and `gc-run1.json`: raw `--json`.
- `sessions-before.json` and `sessions-after.json`.
- `observer-counts.json`: before, after-crash and after-gc dir and orphan counts.
- `live-summary.json`.

It exits 1 on any failure. No fixed sleeps except "not-yet" races. Every wait polls a condition with a deadline.

| Case | Steps | Assertions |
|---|---|---|
| **C0** interlocks | §3.1 1-2, §3.2 preflight | scope roots correct; the preflight state has all 4 new fields |
| **C1** normal close | `nav ?case=c1` in cwd-7 → read `profileDir` → `close` | exit 0; stdout exactly `Session closed.`; `!exists(profileDir)`; the observer shows 0 processes containing `profileDir`; state.json gone |
| **C2** self-heal | `nav ?case=c2` in cwd-8 → dir A, chrome pid → tree-kill Chrome → `snap` | stderr contains `previous session was unreachable`; exit 0; `!exists(A)`; new `state.profileDir` B ≠ A, `exists(B)`; then `close` gives `!exists(B)` |
| **C3** build L1 | §3.5 legs A and B, fake leaks, negative fixtures | preconditions: 5 runtime dirs with owner files; 5 runtime browsers alive after the Node kill; 2 dead after the Chrome kill; CLI sessions 1-2 stale, 3-4 orphaned, 5 and 6 live |
| **C4** sessions | `sessions --json` and `sessions` | entries for cwd-1,2 are `stale` with `pidAlive:false`; cwd-5,6 are `live`, `endpointReachable:true`, with the correct `cwd`; the legacy state has `cwd:null`, `ageSource:'stateFileMtime'`, `stale`; corrupt is `unreadable`; the human output contains `R/cwd-5` and `(unknown: created before 0.5.0)`; exit 0 |
| **C5** dry run touches nothing | full snapshot (recursive listing of `R` with mtimes, state files' bytes, observer process set for R) → `doctor --gc --dry-run --json` → snapshot again | snapshots are byte-identical; exit 0; the plan has kill actions for exactly 3 runtime + 2 CLI-orphan browsers; `deleteDir` for 5 runtime + 4 CLI (1,2 stale; 3,4 orphan) + 10 fake old + the lock-held dir; `clearState` for sessions 1,2, the legacy and named-profile states, and the tampered state; kept includes YOUNG1 (`grace`), the decoys (`not-sutradhar`), the named dir, the symlink, cwd-5/6 (`live-session`), and corrupt (`unreadable-state`) |
| **C6** the GC run | `doctor --gc --json` | every result except the lock-held dir is `killed`, `deleted` or `cleared`; the lock-held dir is `failed` with a code in {EBUSY, EPERM, ENOTEMPTY, EACCES}, still exists, and isn't counted as deleted; exit **2**; §3.1 interlock 3 holds |
| **C7** counts reach 0 | release the lock holder (kill it, or restore chmod) → `close --all-stale --json` | exit 0; that dir is `deleted`; observer: **orphan count 0 and dir count 0** (excluding control, cwd-5 and decoys); `remaining` is `{0, 0}` |
| **C8** no harm | `snap` in cwd-5 and cwd-6 | exit 0; stderr has no `previous session was unreachable`; `chromePid` and `profileDir` unchanged; the dirs exist |
| **C9** normal close after GC | `close` in cwd-5 | `!exists(profileDir5)`; dir count now excludes only control and decoys |
| **C10** MCP stdin EOF | spawn the MCP server (child env) → `browser.launch` ×2 → record the new Puppeteer dirs and browser pids (observer) → `child.stdin.end()` | the child exits within 15 s with code 0; stderr contains `shutting down (stdin-end)` or `(stdin-close)`; both browsers are dead; both dirs are gone |
| **C11** MCP not spurious | spawn the MCP server, send `initialize`, keep stdin open, race child-exit against `delay(10000)` | the delay wins; then `tools/list` responds with the unchanged tool count; then `stdin.end()` makes it exit 0 |
| **C12** final | §3.1 interlock 4, then teardown | `realBefore` all still exist; 0 processes contain `realpath(R)` |

Run the whole script on Windows (the primary platform). POSIX-only branches are code paths covered by unit tests PL4-PL5 and G-cases. The Auditor re-runs it independently.

---

## 6. Negative cases (each is asserted in C5/C6 unless noted)

| # | Case | Expected |
|---|---|---|
| N1 | Live session dirs (cwd-5, cwd-6) and their Chromes | never in any action; C8 proves they still work |
| N2 | Decoy D1: the harness spawns raw `chrome --headless=new --remote-debugging-port=0 --user-data-dir=R/temp/decoy-profile-1 about:blank`, unmarked, name doesn't match | process alive and dir present after C6 and C7 |
| N3 | Decoy D2: the unmarked raw Puppeteer Chrome from `decoy-puppeteer.mjs`, whose Node is then kill -9'd. That makes it an **orphan Puppeteer Chrome not launched by Sutradhar**, with a `puppeteer_dev_chrome_profile-*` dir and no owner file. | not killed; dir not deleted; kept `not-sutradhar` |
| N4 | Decoy D3: a raw unmarked Chrome with `--user-data-dir=R/temp/sutradhar-cli-<now>-DECOY1` (legacy-looking, young) | not killed (`grace`); dir kept |
| N5 | YOUNG1 fake dir (no owner, fresh) | kept `grace` |
| N6 | Named-profile state (`R/named/fr2p`, `profileDirOwned:false`) | state cleared; `R/named/fr2p/Preferences` still exists |
| N7 | Tampered state (`profileDirOwned:true`, dir outside `tempRoot`) | state cleared; `R/outside/...` still exists |
| N8 | Junction/symlink `sutradhar-cli-1600000000002` → `R/precious` | `R/precious/keep.txt` still exists; kept `symlink` |
| N9 | Lock-held dir | reported `failed` with a code; exit 2; the dir exists; never listed as deleted (C6) |
| N10 | Dry run | byte-identical snapshot (C5) |
| N11 | Corrupt state.json | untouched (same bytes); `unreadable` |
| N12 | Flag misuse: `snap --gc`, `doctor --all-stale`, `doctor --dry-run`, `sessions --dry-run` | exit 1 with the §2.7 messages; nothing scanned |
| N13 | The lock holder (a `node` process whose cwd is inside an attributed dir) | not killed (no `--user-data-dir`, no marker) |
| N14 | MCP stdin idle | no shutdown (C11) |
| N15 | Close with a PID that can't be verified (Auditor adversarial): hand-edit the state so `chromePid` = the PID of an unrelated live `node` process and `wsEndpoint` is dead | `close` does **not** kill that node process; stderr has `not killing PID`; the state is cleared |
| N16 | Concurrent close (Auditor adversarial): run `doctor --gc` and `close` in cwd-5 at the same time, 10 iterations | no unhandled error; the dir ends deleted; GC never reports `deleted` for a path that still exists |
| N17 | Mid-spawn race (Auditor adversarial): start `nav` in a fresh cwd, and as soon as the observer sees its new `sutradhar-cli-*` dir, run `doctor --gc` | the new Chrome isn't killed (owner PID alive, or grace); the `nav` succeeds |

---

## 7. Risks

1. **Wrong-process kill.** This is the dominant risk. The mitigations layer: a marker or a verified dir (never a process name); scope roots; the owner-PID start-time check; PID-verified close and self-heal (this also fixes the blind kills at `cli.ts:135/716`); no kills at all when enumeration fails.
2. **Pre-0.5.0 sessions under a custom `SUTRADHAR_CLI_STATE_DIR`** are invisible to the scan unless that variable is set when GC runs. After 120 s their unmarked Chrome is killed as `legacy-orphan`. This is documented in the help and README (`--dry-run` first), and recorded as decision D6.
3. **Windows cost.** Each enumeration is about 0.7 s (measured). It runs only in `sessions`, `doctor`/GC, and the rare unreachable-but-alive close/self-heal path, never on the normal command path.
4. **Path identity** (8.3 names, `/private/var`, case). Handled by `normalizePathForCompare` (PC3/G19). A TEMP that differs between spawn time and close time makes the guard fail. That fails safe: the dir stays, a warning is printed, and a later GC run collects it.
5. **The TEMP override might affect Chrome in the harness.** Preflight C0 catches it; the fallback is D4's `SUTRADHAR_CLI_TEMP_ROOT`.
6. **A failed owner-file write** leaves a runtime dir unattributable. It's never deleted. Safe, but a small residual leak, logged at warn.
7. **MCP stdin `end` with `/dev/null` stdin** shuts down immediately. Documented. Clients that half-close stdin but still expect responses would lose them; such clients are out of spec for stdio MCP. The scenario suite and `prob043-mcp-soak.mjs` end stdin only at teardown; the phase gate must confirm they still pass.
8. **The self-heal trigger is broader than "unreachable".** `cli.ts:97-139` wraps `fn()` in the same `try`, so any command that throws (e.g. `runtime.navigate` failing) kills a live Chrome and restarts it. This predates FR2-03; FR2-03 only adds deletion of the dir that was already being abandoned. **Log as a new gap** (below); out of scope here.
9. **Killing a named-profile orphan** can lose storage state that `close` would have saved (D5). It's accepted, because the process is provably orphaned; the dir itself is untouched.
10. **Later items touch the same files:** FR2-04 (dialog policy in `CliState`), FR2-11 (`history.jsonl` next to `state.json`; `clearStateFileIfUnchanged` removes only `state.json`), FR2-14 config. Merge order: FR2-01 → FR2-03 → FR2-04.
11. **Grace of 120 s:** a crash less than 2 minutes before `--gc` leaves unevidenced dirs; the report lists them as `grace`. Crashes with evidence (owner file, stale state, marked process) are collected immediately.

### 7.1 Decisions to record in decisions.md

| # | Decision |
|---|---|
| D1 | Chrome marker switches plus an owner file for Puppeteer temp dirs |
| D2 | Puppeteer dirs are collected only when attributed |
| D3 | `close --all-stale` is an alias of `doctor --gc` |
| D4 | No temp-root env var; TEMP/TMP/TMPDIR is the override (with a fallback) |
| D5 | Named-profile orphans: kill the process, never the dir |
| D6 | The legacy custom-state-dir limitation |
| D7 | `unresponsive` and `unknown` sessions are never collected |
| D8 | Grace is 120 s on dir mtime, with no env knob |
| D9 | GC exit codes are 0/1/2; `close` stays exit 0 with a stderr warning when dir removal fails |
| D10 | MCP triggers are stdin `end`/`close`, not `error`; a 10 s deadline forces `exit(1)` |
| D11 | `mkdtemp` suffix naming (fixes the same-millisecond collision) |
| D12 | `sessions` is read-only and exits 0 whenever the listing ran |

### 7.2 Existing tests or scripts to re-run

- `packages/browser` `launcher.spec.ts` (real launches)
- `packages/cli` all
- `packages/mcp-server` all
- `tools/scenario-suite` all 3 surfaces (MCP teardown now triggers shutdown on stdin end)
- `verify-fr2-01-wait-states.mjs` (its CLI teardown at `:585-708` must now find **zero** new `sutradhar-cli-*` dirs; update its comment only if the Auditor confirms)

### 7.3 New gaps to log

| gap | severity | description |
|---|---|---|
| GAP-006 | minor | Self-heal fires on `fn()` errors, not just attach failures (`cli.ts:97-139`) |
| GAP-007 | minor | The SDK process exiting without `browser.close()` leaks Puppeteer's temp dir even on a clean exit (@puppeteer/browsers `launch.js:196-272`). `doctor --gc` now reclaims it; a proper fix (a synchronous cleanup hook) is future work. |

---

## 8. Rollback

`git revert <FR2-03 commit>`. Everything is additive:

- **Files:** the new modules in §1 are removed, and the edits in `spawn-chrome.ts`, `state.ts`, `parse-args.ts`, `cli.ts`, `browser-launcher.ts`, `launcher/index.ts` and `mcp-server/src/cli.ts` are reverted.
- **Persisted artifacts:**
  - `state.json` files written with the new fields stay readable by the old code, which ignores unknown keys.
  - `.sutradhar-owner.json` files inside Puppeteer temp dirs are harmless and get removed with those dirs.
  - Marker switches only exist on running Chromes and disappear when they exit.
- **Nothing else:** no MCP tool count change, no schema file.

After a revert:
- Append a decisions.md entry.
- Mark the ledger row `TODO`/`BLOCKED`.
- Drop the changelog fragment.
- Dirs leaked in the meantime are exactly what the old code leaked; there's no new harm.

If only the MCP stdin hook causes trouble (e.g. a client that half-closes stdin), revert just `shutdown-hooks.ts` and `mcp-server/src/cli.ts` independently. They share no code with the CLI GC.

---

### Critical files for implementation
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\cli.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\spawn-chrome.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\cli\src\state.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\launcher\browser-launcher.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\mcp-server\src\cli.ts`