/**
 * @file packages/cli/tests/unit/system-binaries.spec.ts
 * @description The OS tools the CLI runs are addressed by absolute path (GAP-315 audit finding
 * F3: a bare `powershell.exe` resolves from the cwd first on Node 18/20). `SystemRoot` must be read
 * on every call. Platform-neutral: the helpers build Windows paths with path.win32.
 * S6e-3 adds proof at the call sites: the executable that `scanCommandLines` and `killChromeTree`
 * actually run is the helper's absolute path, and no other spawn/execFile site in `src` uses a bare name.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killChromeTree } from '../../src/spawn-chrome.js';
import { powershellExe, psBin, taskkillExe } from '../../src/system-binaries.js';
import { scanCommandLines } from '../../src/temp-profile.js';

describe('system-binaries', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.SystemRoot;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = saved;
  });

  it('builds absolute Windows paths under %SystemRoot%\\System32', () => {
    process.env.SystemRoot = 'D:\\Win';
    expect(powershellExe()).toBe('D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(taskkillExe()).toBe('D:\\Win\\System32\\taskkill.exe');
    expect(path.win32.isAbsolute(powershellExe())).toBe(true);
    expect(path.win32.isAbsolute(taskkillExe())).toBe(true);
  });

  it('reads SystemRoot on every call, not once at module load', () => {
    process.env.SystemRoot = 'D:\\One';
    expect(taskkillExe()).toBe('D:\\One\\System32\\taskkill.exe');
    process.env.SystemRoot = 'D:\\Two';
    expect(taskkillExe()).toBe('D:\\Two\\System32\\taskkill.exe');
    expect(powershellExe().startsWith('D:\\Two\\')).toBe(true);
  });

  it('falls back to C:\\Windows when SystemRoot is unset or empty', () => {
    delete process.env.SystemRoot;
    expect(taskkillExe()).toBe('C:\\Windows\\System32\\taskkill.exe');
    process.env.SystemRoot = '';
    expect(powershellExe()).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });

  it('psBin is the absolute /bin/ps', () => {
    expect(psBin()).toBe('/bin/ps');
  });
});

describe('S6e-3 (F3): the executables actually run are absolute helper paths', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.SystemRoot;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = saved;
  });

  it('F3-a: the Windows scan runs powershellExe() (absolute), and follows SystemRoot (so it is the helper, not a literal)', async () => {
    const seen: string[] = [];
    const run = async (file: string): Promise<string | null> => {
      seen.push(file);
      return '';
    };
    process.env.SystemRoot = 'D:\\One';
    await scanCommandLines(1000, { platform: 'win32', run });
    process.env.SystemRoot = 'D:\\Win';
    await scanCommandLines(1000, { platform: 'win32', run });
    expect(seen).toEqual([
      'D:\\One\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ]);
    for (const f of seen) {
      expect(path.win32.isAbsolute(f)).toBe(true);
      expect(f.toLowerCase()).not.toBe('powershell.exe'); // never the bare name
    }
  });

  it('F3-b: the POSIX scan (macOS) runs the absolute psBin(), never the bare name `ps`', async () => {
    const seen: string[] = [];
    await scanCommandLines(1000, {
      platform: 'darwin',
      run: async (file) => {
        seen.push(file);
        return '';
      },
    });
    expect(seen).toEqual([psBin()]);
    expect(path.posix.isAbsolute(seen[0] ?? '')).toBe(true);
  });

  it.skipIf(process.platform !== 'win32')('F3-c (Windows): killChromeTree runs taskkillExe() (absolute) with exactly /PID <pid> /T /F', async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const spawnFn = (file: string, args: string[]) => {
      calls.push({ file, args });
      const child = new EventEmitter();
      setImmediate(() => child.emit('exit'));
      return child;
    };
    await killChromeTree(4242, 5000, spawnFn);
    expect(calls).toEqual([{ file: taskkillExe(), args: ['/PID', '4242', '/T', '/F'] }]);
    expect(path.win32.isAbsolute(calls[0]?.file ?? '')).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('F3-c (POSIX): killChromeTree signals the process group, then falls back to the pid, and runs no executable', async () => {
    const sent: Array<[number, string | number | undefined]> = [];
    const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number, sig?: string | number) => {
      sent.push([pid, sig]);
      if (pid < 0) throw new Error('ESRCH');
      return true;
    }) as typeof process.kill);
    try {
      await killChromeTree(4242, 1000, () => {
        throw new Error('no executable may be spawned on POSIX');
      });
    } finally {
      kill.mockRestore();
    }
    expect(sent).toEqual([
      [-4242, 'SIGKILL'],
      [4242, 'SIGKILL'],
    ]);
  });

  it('F3-d: every spawn/execFile call site in packages/cli/src runs a helper path, process.execPath, the resolved Chrome path or an injected seam, never a bare tool name', () => {
    const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
    const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const sites: string[] = [];
    for (const f of fs.readdirSync(srcDir).filter((n) => n.endsWith('.ts')).sort()) {
      const code = stripComments(fs.readFileSync(path.join(srcDir, f), 'utf8'));
      for (const m of code.matchAll(/\b(execFile|execFileSync|spawn|spawnSync|exec|execSync|spawnFn)\(\s*([^,)]*(?:\([^)]*\))?)\s*,/g)) {
        sites.push(`${f}: ${m[1]}(${(m[2] ?? '').trim()}`);
      }
    }
    // Reviewed in evidence/S6e-3/spawn-sites.md. `file` is only ever fed by powershellExe()/psBin() (scanCommandLines)
    // or is the injected spawnFn's own parameter; `execPath` is `deps.execPath ?? process.execPath`; `chromePath` is
    // the injected/resolved Chrome executable.
    expect(sites).toEqual([
      'spawn-chrome.ts: spawn(file', // default spawnFn of spawnDetachedChrome (forwards the executable it is given)
      'spawn-chrome.ts: spawnFn(chromePath', // the resolved / injected Chrome executable
      'spawn-chrome.ts: spawn(file', // default spawnFn of killChromeTree (forwards the executable it is given)
      'spawn-chrome.ts: spawnFn(taskkillExe()', // taskkill: absolute helper path
      'temp-profile.ts: execFile(file', // fed only by powershellExe() / psBin() in scanCommandLines
      'warden-control.ts: spawnFn(execPath', // deps.execPath ?? process.execPath
    ]);
    for (const s of sites) expect(s).not.toMatch(/\((['"`])/); // no string-literal executable at any site
  });
});
