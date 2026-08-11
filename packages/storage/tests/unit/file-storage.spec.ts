/**
 * @file packages/storage/tests/unit/file-storage.spec.ts
 * @description Unit tests for LocalFileStorage, key sanitization, read/write/delete operations.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { LocalFileStorage, STORAGE_VERSION } from '../../src/index.js';

describe('@pinchtab/storage Abstraction & File Store', () => {
  const testDir = path.join(process.cwd(), '.test-storage-temp');

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('should export correct package version constant', () => {
    expect(STORAGE_VERSION).toBe('0.1.0');
  });

  it('should write, read, check existence, and delete file in LocalFileStorage', async () => {
    const storage = new LocalFileStorage({ baseDir: testDir });
    const key = 'artifacts/session_1/screenshot.txt';

    const pathWritten = await storage.writeFile(key, 'Hello PinchTab Storage');
    expect(pathWritten).toContain('screenshot.txt');

    const exists = await storage.exists(key);
    expect(exists).toBe(true);

    const buffer = await storage.readFile(key);
    expect(buffer.toString('utf-8')).toBe('Hello PinchTab Storage');

    const fileList = await storage.listFiles();
    expect(fileList.length).toBeGreaterThanOrEqual(1);

    const deleted = await storage.deleteFile(key);
    expect(deleted).toBe(true);

    const existsAfter = await storage.exists(key);
    expect(existsAfter).toBe(false);
  });

  it('should reject path traversal security attempts', async () => {
    const storage = new LocalFileStorage({ baseDir: testDir });
    const maliciousKey = '../../../../etc/passwd';

    await expect(storage.readFile(maliciousKey)).rejects.toThrow();
  });

  it('rejects a key that resolves through a symlink pointing outside baseDir, even though the string check alone would pass', async () => {
    const escapeTarget = path.join(process.cwd(), '.test-storage-escape-target');
    await fs.mkdir(escapeTarget, { recursive: true });
    await fs.writeFile(path.join(escapeTarget, 'secret.txt'), 'should not be reachable');

    const symlinkDir = path.join(testDir, 'escape-link');
    await fs.mkdir(testDir, { recursive: true });
    try {
      // 'junction' works on Windows without elevated privileges; posix systems accept a plain
      // directory symlink. Skip the assertion (rather than fail the suite) on a filesystem/
      // permission combo that can't create either — the fix is verified elsewhere by the
      // synchronous ancestor-walk logic; this test only adds a real end-to-end symlink case.
      await fs.symlink(escapeTarget, symlinkDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }

    const storage = new LocalFileStorage({ baseDir: testDir });
    await expect(storage.readFile('escape-link/secret.txt')).rejects.toThrow(/symlink/);

    await fs.rm(escapeTarget, { recursive: true, force: true });
  });
});
