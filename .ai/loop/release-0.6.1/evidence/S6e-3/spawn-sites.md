# Spawn / execFile call sites in `packages/cli/src` (S6e-3 coverage check)

Greps and their raw output: `spawn-sites-grep.txt`. The plan's grep (`execFile|execFileSync|spawn|spawnSync|exec|execSync` followed by `(`) finds 3 lines; because
the code also calls through injected seams named `spawnFn`, the extended grep adds those. Nothing else in `packages/cli/src` imports `node:child_process`
(imports: spawn-chrome.ts, temp-profile.ts, warden-control.ts only). Every site, with where its executable argument comes from:

| # | site | executable argument | category | why it cannot be a cwd-resolved bare name |
|---|---|---|---|---|
| 1 | `spawn-chrome.ts:178` `deps.spawnFn ?? ((file, a, o) => spawn(file, a, o))` | `file` = whatever the next line passes | forwarder | default of the `spawnFn` seam; it only forwards the executable it is handed (site 2) |
| 2 | `spawn-chrome.ts:179` `spawnFn(chromePath, args, ...)` | `chromePath` | the resolved Chrome path / injected seam | `deps.executablePath ?? new BrowserLauncher().findExecutablePath()` (an installed browser's absolute path; `CHROME_PATH` is honoured only if the file exists); the G tests inject `'fake-chrome'` together with a fake `spawnFn` |
| 3 | `spawn-chrome.ts:241` default of `killChromeTree`'s `spawnFn` (`spawn(file, args, options)`) | `file` = whatever site 4 passes | forwarder | same, for the kill seam |
| 4 | `spawn-chrome.ts:247` `spawnFn(taskkillExe(), ['/PID', pid, '/T', '/F'], ...)` | `taskkillExe()` | helper call | `%SystemRoot%\System32\taskkill.exe`, absolute (unit test F3-c asserts the exact call; live `kill-probe` against a planted `taskkill.exe` in the cwd on 4 runtimes) |
| 5 | `temp-profile.ts:255` `execFile(file, args, ...)` inside `execRun` | `file` | helper call (via `scanCommandLines`) | `file` is only ever `powershellExe()` (win32 branch) or `psBin()` (other POSIX); Linux does not exec at all (reads `/proc`). Unit tests F3-a/F3-b assert the exact value passed to `run`; live `win-plant` on 4 runtimes |
| 6 | `warden-control.ts:278` `spawnFn(execPath, [argv1, '__dialog-warden', payload], ...)` | `execPath` | `process.execPath` / injected seam | `const execPath = deps.execPath ?? process.execPath;` (line 272); `cli.ts` never passes an `execPath`, so production always runs the current Node binary by its absolute path |

No site uses a string-literal executable. The unit test F3-d (`system-binaries.spec.ts`) pins exactly this list (6 sites, in order) and additionally asserts
that no site's first argument starts with a quote, so a new bare-name spawn (or a literal in an existing site) fails the suite; mutant M-F3d demonstrates it.
