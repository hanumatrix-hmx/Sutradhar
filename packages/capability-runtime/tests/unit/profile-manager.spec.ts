/**
 * @file packages/capability-runtime/tests/unit/profile-manager.spec.ts
 * @description Unit tests for ProfileManager — real filesystem operations against a scratch
 * temp directory (not mocked), since its whole job IS filesystem state (a registry file plus
 * one userDataDir per profile).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProfileManager } from '../../src/profiles/profile-manager.js';

describe('@sutradhar/capability-runtime ProfileManager', () => {
  let baseDir: string;
  let manager: ProfileManager;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), 'sutradhar-profile-test-'));
    manager = new ProfileManager(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('creates a profile with its own userDataDir under the registry root', async () => {
    const info = await manager.create('work', 'my work account');

    expect(info.name).toBe('work');
    expect(info.description).toBe('my work account');
    expect(info.userDataDir.startsWith(baseDir)).toBe(true);
    expect(existsSync(info.userDataDir)).toBe(true);
  });

  it('lists created profiles', async () => {
    await manager.create('work');
    await manager.create('personal');

    const list = await manager.list();
    expect(list.map((p) => p.name).sort()).toEqual(['personal', 'work']);
  });

  it('rejects creating a profile with a name that already exists', async () => {
    await manager.create('work');
    await expect(manager.create('work')).rejects.toThrow(/already exists/);
  });

  it('rejects invalid profile names', async () => {
    await expect(manager.create('')).rejects.toThrow(/Invalid profile name/);
    await expect(manager.create('has spaces')).rejects.toThrow(/Invalid profile name/);
    await expect(manager.create('-leading-dash')).rejects.toThrow(/Invalid profile name/);
    await expect(manager.create('../../etc')).rejects.toThrow(/Invalid profile name/);
  });

  it('resolveUserDataDir returns the profile\'s directory for an existing profile', async () => {
    const info = await manager.create('work');
    const resolved = await manager.resolveUserDataDir('work');
    expect(resolved).toBe(info.userDataDir);
  });

  it('resolveUserDataDir throws a clear error for an unknown profile name', async () => {
    await expect(manager.resolveUserDataDir('nope')).rejects.toThrow(/No profile named "nope"/);
  });

  it('delete removes the profile from the registry AND deletes its userDataDir', async () => {
    const info = await manager.create('work');
    expect(existsSync(info.userDataDir)).toBe(true);

    await manager.delete('work');

    expect(await manager.get('work')).toBeUndefined();
    expect(existsSync(info.userDataDir)).toBe(false);
  });

  it('delete is a no-op (does not throw) for a profile that does not exist', async () => {
    await expect(manager.delete('nope')).resolves.toBeUndefined();
  });

  it('persists across separate ProfileManager instances pointed at the same baseDir', async () => {
    await manager.create('work');

    const secondManager = new ProfileManager(baseDir);
    const info = await secondManager.get('work');
    expect(info?.name).toBe('work');
  });

  describe('storage-state persistence (field-report remediation 5c: wiring profiles to storage-state)', () => {
    const sampleState = {
      origin: 'https://saucedemo.com',
      cookies: [{ name: 'session-username', value: 'standard_user' }],
      localStorage: { theme: 'dark' },
      sessionStorage: { 'cart-token': 'abc123' },
    };

    it('loadStorageState returns undefined for a profile that has never had state saved', async () => {
      await manager.create('work');
      expect(await manager.loadStorageState('work')).toBeUndefined();
    });

    it('round-trips a saved storage-state blob for an existing profile', async () => {
      await manager.create('work');
      await manager.saveStorageState('work', sampleState);

      const loaded = await manager.loadStorageState('work');
      expect(loaded).toEqual(sampleState);
    });

    it('persists storage-state across separate ProfileManager instances pointed at the same baseDir — this IS the relaunch-survives-login scenario', async () => {
      await manager.create('work');
      await manager.saveStorageState('work', sampleState);

      const secondManager = new ProfileManager(baseDir);
      const loaded = await secondManager.loadStorageState('work');
      expect(loaded).toEqual(sampleState);
    });

    it('saveStorageState throws for a profile that does not exist, rather than silently writing an orphaned file', async () => {
      await expect(manager.saveStorageState('nope', sampleState)).rejects.toThrow(/No profile named "nope"/);
    });

    it('does not touch the profile\'s own userDataDir — storage-state is stored in a separate location', async () => {
      const info = await manager.create('work');
      await manager.saveStorageState('work', sampleState);

      // The userDataDir itself must be untouched by this — Chrome owns everything inside it.
      const { readdir } = await import('node:fs/promises');
      const contents = await readdir(info.userDataDir).catch(() => []);
      expect(contents).toEqual([]);
    });
  });
});
