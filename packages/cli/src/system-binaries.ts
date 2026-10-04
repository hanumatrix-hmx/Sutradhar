/**
 * @file packages/cli/src/system-binaries.ts
 * @description Absolute paths of the OS tools this CLI runs (the Windows process scanner and
 * `taskkill`, the POSIX `ps`). Every call site uses one of these named helpers instead of a bare
 * executable name.
 *
 * Why: on Windows, Node 18 and 20 resolve a bare `powershell.exe` / `taskkill` against the
 * CURRENT DIRECTORY before PATH (CreateProcess search order), so a planted copy in the CLI's
 * cwd would be executed — and the temp-profile sweep runs at every fresh session start (GAP-315
 * audit finding F3). An absolute path under %SystemRoot%\System32 is the same program, minus the
 * search.
 *
 * `SystemRoot` is read on EVERY call, not once at module load, so a test (or a hostile
 * environment) is seen the same way by every caller.
 */
import path from 'node:path';

const DEFAULT_SYSTEM_ROOT = 'C:\\Windows';

function systemRoot(): string {
  const v = process.env.SystemRoot;
  return v && v.length > 0 ? v : DEFAULT_SYSTEM_ROOT;
}

/** `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`. */
export function powershellExe(): string {
  return path.win32.join(systemRoot(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** `%SystemRoot%\System32\taskkill.exe`. */
export function taskkillExe(): string {
  return path.win32.join(systemRoot(), 'System32', 'taskkill.exe');
}

/** `/bin/ps` (Linux and macOS). */
export function psBin(): string {
  return '/bin/ps';
}
