/**
 * @file packages/cli/src/process-list.ts
 * @description Cross-platform process enumeration with no new dependency (no `wmic` — it's
 * gone from modern Windows; no `ps-list`/`ps-tree` package). Used by `sessions` and
 * `doctor --gc` to find every Chrome process, attribute it, and safely tell "still running" from
 * "dead" before ever killing or deleting anything. See FR2-03 spec §0.2 for the measured design
 * (712ms/604 processes on this Windows machine; the "children carry no --user-data-dir" finding;
 * the platform-specific command choices).
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export interface ProcessInfo {
  pid: number;
  ppid: number;
  /** Approximate start time in epoch ms. */
  startMs: number;
  /** Full command line when available and relevant (see the platform notes below); undefined
   *  when the process's command line wasn't captured (out of scope for our filters) or
   *  couldn't be read. */
  commandLine: string | undefined;
}

export type ListProcessesResult = { ok: true; processes: ProcessInfo[] } | { ok: false; reason: string };

interface CommandRunner {
  (cmd: string, args: string[], opts?: { timeoutMs?: number }): Promise<{ stdout: string; code: number | null }>;
}

/** Default command runner: spawns a child process, collects stdout, and resolves/rejects based
 *  on exit code and an optional timeout. Injectable so tests never actually shell out. */
export const defaultRunner: CommandRunner = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = opts?.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, opts.timeoutMs)
      : undefined;
    child.stdout?.on('data', (d) => (stdout += d.toString('utf-8')));
    child.stderr?.on('data', (d) => (stderr += d.toString('utf-8')));
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${cmd} timed out after ${opts?.timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve({ stdout, code });
    });
  });

/** Parses a Windows command-line STRING (as reported by `Win32_Process.CommandLine`, or a raw
 *  string in tests) into its individual argv-style tokens, honoring double-quoted segments —
 *  Windows command lines have no argv array, only one string, and naive `.split(' ')` breaks on
 *  a quoted path containing spaces (e.g. `"C:\Program Files\..."`, or
 *  `"--user-data-dir=C:\Users\John Doe\..."`). */
export function parseWindowsCommandLine(cmdline: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < cmdline.length; i++) {
    const ch = cmdline[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ' ' && !inQuotes) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/** Extracts the `--user-data-dir` value from a command line, string or argv, handling both a
 *  quoted `--user-data-dir="C:\a b\c"` form and an unquoted one. `undefined` when the flag is
 *  absent, or present with an empty value. */
export function extractUserDataDir(cmdline: string | readonly string[]): string | undefined {
  const tokens: readonly string[] = typeof cmdline === 'string' ? parseWindowsCommandLine(cmdline) : cmdline;
  for (const tok of tokens) {
    if (tok.startsWith('--user-data-dir=')) {
      const value = tok.slice('--user-data-dir='.length).replace(/^"|"$/g, '');
      return value.length > 0 ? value : undefined;
    }
  }
  // Fallback for a raw (unparsed) string form where quoting swallowed the `=`, e.g.
  // `--user-data-dir="C:\a b\c"` split naively — try a regex on the whole string too.
  if (typeof cmdline === 'string') {
    const m = cmdline.match(/--user-data-dir=("([^"]*)"|(\S+))/);
    if (m) {
      const value = m[2] ?? m[3];
      return value && value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

/** The browser process (not a renderer/gpu/utility/crashpad child) is the one with no
 *  `--type=...` flag on its command line. */
export function isBrowserProcess(cmdline: string | readonly string[] | undefined): boolean {
  if (!cmdline) return false;
  const text: string = typeof cmdline === 'string' ? cmdline : cmdline.join(' ');
  return !/--type=/.test(text);
}

/** Parses `Get-CimInstance Win32_Process | ConvertTo-Json -Compress` output — a single object
 *  (PowerShell unwraps a one-element array), a proper array, or an empty string (no processes,
 *  which `ConvertTo-Json` on an empty pipeline renders as nothing at all). A genuinely malformed
 *  *entry* inside an otherwise-valid array is skipped rather than aborting the whole parse — but
 *  non-empty text that isn't valid JSON at all (a truncated/garbled PowerShell stream) THROWS
 *  rather than silently returning `[]`. That distinction matters: `listProcesses` must report
 *  `{ok:false}` for a parse failure (spec §0.2 — GC then kills nothing), not `{ok:true, processes:
 *  []}`, which a caller can't tell apart from "genuinely zero matching processes right now" and
 *  would proceed as if it had verified no processes reference a directory (GAP-179/GAP-181: a
 *  real bug where an unparsable stream silently looked like a clean, fully-verified empty list). */
export function parseCimJson(json: string): ProcessInfo[] {
  const trimmed = json.trim();
  if (trimmed.length === 0) return [];
  const parsed: unknown = JSON.parse(trimmed); // intentionally not try/caught — see doc comment
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const out: ProcessInfo[] = [];
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.p !== 'number' || typeof o.pp !== 'number' || typeof o.c !== 'number') continue;
    out.push({
      pid: o.p,
      ppid: o.pp,
      startMs: o.c,
      commandLine: typeof o.a === 'string' ? o.a : undefined,
    });
  }
  return out;
}

/** `[[dd-]hh:]mm:ss` -> total seconds, the format `ps -o etime=` prints on both procps (Linux)
 *  and BSD/macOS `ps` (which lacks `etimes`). `undefined` for anything that doesn't match. */
export function parseEtime(etime: string): number | undefined {
  const m = etime
    .trim()
    .match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return undefined;
  const days = m[1] ? Number(m[1]) : 0;
  const hours = m[2] ? Number(m[2]) : 0;
  const minutes = Number(m[3]);
  const seconds = Number(m[4]);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/** Parses `ps -axo pid=,ppid=,etime=,command=` output. `now` is injectable so tests don't race
 *  real wall-clock time. Lines that don't parse are skipped. */
export function parsePsOutput(output: string, now: number = Date.now()): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  for (const line of output.split('\n')) {
    if (line.trim().length === 0) continue;
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const etimeSecs = parseEtime(m[3]!);
    if (etimeSecs === undefined) continue;
    out.push({ pid, ppid, startMs: now - etimeSecs * 1000, commandLine: m[4] });
  }
  return out;
}

const WINDOWS_ENUM_SCRIPT = `
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Get-CimInstance Win32_Process | ForEach-Object {
  [pscustomobject]@{ p=$_.ProcessId; pp=$_.ParentProcessId;
    c=[int64](($_.CreationDate.ToUniversalTime()-[datetime]'1970-01-01').TotalMilliseconds);
    a=$(if ($_.CommandLine -like '*--user-data-dir*' -or $_.CommandLine -like '*--sutradhar-*' -or $_.CommandLine -like '*sutradhar-cli-*' -or $_.CommandLine -like '*puppeteer_dev_chrome_profile-*') { $_.CommandLine } else { $null }) } } |
  ConvertTo-Json -Compress
`;

function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** Lists every process on the machine, cross-platform, with each candidate Chrome/Sutradhar
 *  process's command line captured (everything else's `commandLine` is `undefined` on Windows,
 *  to keep the encoded command's output small — irrelevant processes are never inspected for
 *  attribution anyway). Never throws: any failure (missing PowerShell, Constrained Language
 *  Mode, a non-procps/BSD `ps`, a timeout, a parse failure) comes back as `{ok:false, reason}` —
 *  callers (GC) must then kill nothing (see spec §0.2). */
export async function listProcesses(
  runner: CommandRunner = defaultRunner,
  platform: NodeJS.Platform = process.platform,
): Promise<ListProcessesResult> {
  try {
    if (platform === 'win32') {
      const encoded = encodePowerShellCommand(WINDOWS_ENUM_SCRIPT);
      const { stdout } = await runner(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        { timeoutMs: 15_000 },
      );
      const processes = parseCimJson(stdout);
      return { ok: true, processes };
    }
    const { stdout } = await runner('ps', ['-axo', 'pid=,ppid=,etime=,command='], { timeoutMs: 15_000 });
    const processes = parsePsOutput(stdout);
    return { ok: true, processes };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

export interface CommandLineResult {
  ok: boolean;
  commandLine?: string;
  reason?: string;
}

/** Single-PID lookup used for close/self-heal verification (§0.2's "Single-PID lookup") —
 *  cheaper than a full enumeration when only one PID's command line needs checking. */
export async function getProcessCommandLine(
  pid: number,
  runner: CommandRunner = defaultRunner,
  platform: NodeJS.Platform = process.platform,
): Promise<CommandLineResult> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return { ok: false, reason: 'invalid pid' };
  try {
    if (platform === 'win32') {
      const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8\nGet-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine`;
      const { stdout } = await runner(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShellCommand(script)],
        { timeoutMs: 10_000 },
      );
      const trimmed = stdout.trim();
      return trimmed.length > 0 ? { ok: true, commandLine: trimmed } : { ok: false, reason: 'no such process' };
    }
    try {
      const cmdline = await readFile(`/proc/${pid}/cmdline`, 'utf-8');
      const parts = cmdline.split('\0').filter((s) => s.length > 0);
      if (parts.length > 0) return { ok: true, commandLine: parts.join(' ') };
    } catch {
      // /proc unavailable (macOS) or process gone — fall through to `ps`.
    }
    const { stdout } = await runner('ps', ['-p', String(pid), '-o', 'command='], { timeoutMs: 10_000 });
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? { ok: true, commandLine: trimmed } : { ok: false, reason: 'no such process' };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/** `process.kill(pid, 0)`-based liveness check: true on success (alive) or EPERM (alive, no
 *  permission to signal), false on ESRCH (dead) or any other case. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Polls `isPidAlive` every 50ms until it reports dead, up to `waitMs`. Resolves `true` once
 *  dead, `false` if `waitMs` elapses while still alive. */
export async function waitForPidExit(pid: number, waitMs = 5000): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !isPidAlive(pid);
}

/** Best-effort single-process kill (no tree) — used for a stray attributed child whose parent
 *  browser is already gone. Swallows "already gone" errors. */
export function killPid(pid: number): void {
  try {
    process.kill(pid, process.platform === 'win32' ? undefined : 'SIGKILL');
  } catch {
    // Already gone — not an error worth surfacing.
  }
}
