/**
 * @file packages/cli/tests/unit/profile-cleanup.spec.ts
 * @description FR2-03 PC1-PC8: the guard (`isOwnedTempProfileDir`) every GC deletion goes
 * through, plus the retrying directory remover.
 */
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { existsSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SUTRADHAR_TEMP_DIR_RE,
  PUPPETEER_TEMP_DIR_RE,
  isOwnedTempProfileDir,
  normalizePathForCompare,
  removeDirWithRetry,
  probeLock,
} from '../../src/profile-cleanup.js';

describe('PC1: temp-dir regexes', () => {
  it('match valid CLI temp dir names', () => {
    expect(SUTRADHAR_TEMP_DIR_RE.test('sutradhar-cli-1727000000000')).toBe(true);
    expect(SUTRADHAR_TEMP_DIR_RE.test('sutradhar-cli-1727000000000-AbC123')).toBe(true);
  });
  it('reject invalid names', () => {
    expect(SUTRADHAR_TEMP_DIR_RE.test('sutradhar-cli-foo')).toBe(false);
    expect(SUTRADHAR_TEMP_DIR_RE.test('xsutradhar-cli-1727000000000')).toBe(false);
    expect(SUTRADHAR_TEMP_DIR_RE.test('sutradhar-cli-1727000000000-AbC12')).toBe(false);
    expect(SUTRADHAR_TEMP_DIR_RE.test('sutradhar-cli-1727000000000/..')).toBe(false);
  });
  it('puppeteer regex rejects a bare prefix with no suffix', () => {
    expect(PUPPETEER_TEMP_DIR_RE.test('puppeteer_dev_chrome_profile-')).toBe(false);
    expect(PUPPETEER_TEMP_DIR_RE.test('puppeteer_dev_chrome_profile-AbC123')).toBe(true);
  });
});

describe('PC2/PC3: isOwnedTempProfileDir + normalizePathForCompare', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'fr2-03-pc-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('true for a direct child matching the CLI naming', async () => {
    const dir = path.join(root, 'sutradhar-cli-1727000000000');
    await mkdir(dir);
    expect(isOwnedTempProfileDir(dir, root)).toBe(true);
  });

  it('false for a nested dir two levels down', async () => {
    const nested = path.join(root, 'a', 'sutradhar-cli-1727000000000');
    await mkdir(path.dirname(nested), { recursive: true });
    await mkdir(nested);
    expect(isOwnedTempProfileDir(nested, root)).toBe(false);
  });

  it('false for a named-profile-shaped path outside tempRoot', () => {
    const named = path.join(os.homedir(), '.sutradhar', 'profiles', 'x');
    expect(isOwnedTempProfileDir(named, root)).toBe(false);
  });

  it('false for a symlink/junction, even with a matching name', async () => {
    const target = path.join(root, 'target-dir');
    await mkdir(target);
    const link = path.join(root, 'sutradhar-cli-1727000000001');
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(isOwnedTempProfileDir(link, root)).toBe(false);
  });

  it('false for a regular file with a matching name', async () => {
    const file = path.join(root, 'sutradhar-cli-1727000000002');
    await writeFile(file, 'x');
    expect(isOwnedTempProfileDir(file, root)).toBe(false);
  });

  it("kind:'cli' is false for a Puppeteer-named dir", async () => {
    const dir = path.join(root, 'puppeteer_dev_chrome_profile-AbC123');
    await mkdir(dir);
    expect(isOwnedTempProfileDir(dir, root, 'cli')).toBe(false);
    expect(isOwnedTempProfileDir(dir, root, 'runtime')).toBe(true);
  });

  it('PC3: win32 comparison is case-insensitive', () => {
    expect(normalizePathForCompare('C:\\Users\\X\\', 'win32')).toBe(normalizePathForCompare('c:\\users\\x', 'win32'));
  });

  it('PC3: linux comparison is case-sensitive', () => {
    expect(normalizePathForCompare('/Tmp/A', 'linux')).not.toBe(normalizePathForCompare('/tmp/a', 'linux'));
  });
});

describe('PC4-PC8: removeDirWithRetry', () => {
  function ebusyErr(): NodeJS.ErrnoException {
    const e = new Error('busy') as NodeJS.ErrnoException;
    e.code = 'EBUSY';
    return e;
  }

  it('PC4: EBUSY x3 then success gives deleted after 4 attempts, sleeping [100,200,400]', async () => {
    let call = 0;
    const sleeps: number[] = [];
    const result = await removeDirWithRetry(
      '/fake/dir',
      {
        rm: async () => {
          call++;
          if (call <= 3) throw ebusyErr();
        },
        exists: () => (call <= 3 ? true : call === 4 ? false : false),
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    expect(result).toEqual({ status: 'deleted', attempts: 4 });
    expect(sleeps).toEqual([100, 200, 400]);
  });

  it('PC5: EBUSY on every attempt gives failed after 8 attempts, dir still exists', async () => {
    const result = await removeDirWithRetry('/fake/dir', {
      rm: async () => {
        throw ebusyErr();
      },
      exists: () => true,
      sleep: async () => {},
    });
    expect(result).toEqual({ status: 'failed', attempts: 8, code: 'EBUSY', message: 'busy' });
  });

  it('PC6: rm resolves but exists still true gives failed/STILL_EXISTS, never deleted', async () => {
    const result = await removeDirWithRetry('/fake/dir', {
      rm: async () => {},
      exists: () => true,
      sleep: async () => {},
    });
    expect(result.status).toBe('failed');
    expect(result.code).toBe('STILL_EXISTS');
  });

  it('PC7: absent up front gives 0 rm calls', async () => {
    let rmCalls = 0;
    const result = await removeDirWithRetry('/fake/dir', {
      rm: async () => {
        rmCalls++;
      },
      exists: () => false,
    });
    expect(result).toEqual({ status: 'absent', attempts: 0 });
    expect(rmCalls).toBe(0);
  });

  it('PC8: a non-retryable code fails on attempt 1 with no sleep', async () => {
    let sleepCalls = 0;
    const einval = new Error('bad') as NodeJS.ErrnoException;
    einval.code = 'EINVAL';
    const result = await removeDirWithRetry('/fake/dir', {
      rm: async () => {
        throw einval;
      },
      exists: () => true,
      sleep: async () => {
        sleepCalls++;
      },
    });
    expect(result).toEqual({ status: 'failed', attempts: 1, code: 'EINVAL', message: 'bad' });
    expect(sleepCalls).toBe(0);
  });
});

// GAP-186 (audit-2): probeLock had NO dedicated test at all -- the mutation that reverted it to
// a destructive `unlinkSync` probe (M7) passed all 142 existing tests. These pin both its
// free/in-use/unknown classification AND, critically, that a probe is READ-ONLY: it must never
// remove the very file it's inspecting, on either platform's code path, dry-run or not.
describe('PL1-PL5: probeLock is a read-only probe, never a mutation', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'fr2-03-pl-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('PL1: win32, no lockfile at all -> free', async () => {
    expect(await probeLock(root, 'win32')).toBe('free');
  });

  it('PL2: win32, lockfile present and not held open -> free, AND the lockfile is NOT deleted by the probe (the exact M7 regression: a reverted destructive unlinkSync probe would delete it here)', async () => {
    const lockPath = path.join(root, 'lockfile');
    await writeFile(lockPath, 'x');
    expect(await probeLock(root, 'win32')).toBe('free');
    expect(existsSync(lockPath)).toBe(true);
  });

  it('PL3: posix, no SingletonLock at all -> free', async () => {
    expect(await probeLock(root, 'linux')).toBe('free');
  });

  it('PL4: posix, SingletonLock points at this test process\'s own (alive) pid -> in-use, and the symlink survives the probe', async () => {
    const linkPath = path.join(root, 'SingletonLock');
    symlinkSync(`host-${process.pid}`, linkPath);
    expect(await probeLock(root, 'linux')).toBe('in-use');
    const { lstatSync } = await import('node:fs');
    expect(() => lstatSync(linkPath)).not.toThrow(); // the symlink itself must still exist -- not unlinked by the probe
  });

  it('PL5: posix, SingletonLock points at a PID that is certainly dead -> free', async () => {
    const linkPath = path.join(root, 'SingletonLock');
    // A PID this high is never a real, live process on any real machine.
    symlinkSync('host-999999999', linkPath);
    expect(await probeLock(root, 'linux')).toBe('free');
  });
});
