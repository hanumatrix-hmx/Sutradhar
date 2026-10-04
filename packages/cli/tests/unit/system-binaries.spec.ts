/**
 * @file packages/cli/tests/unit/system-binaries.spec.ts
 * @description The OS tools the CLI runs are addressed by absolute path (GAP-315 audit finding
 * F3: a bare `powershell.exe` resolves from the cwd first on Node 18/20). `SystemRoot` must be read
 * on every call. Platform-neutral: the helpers build Windows paths with path.win32.
 */
import path from 'node:path';
import { powershellExe, psBin, taskkillExe } from '../../src/system-binaries.js';

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
