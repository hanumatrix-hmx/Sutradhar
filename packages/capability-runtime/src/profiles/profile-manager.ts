/**
 * @file packages/capability-runtime/src/profiles/profile-manager.ts
 * @description Named, persistent browser profiles — cookies/history/localStorage survive
 * across separate launches, the same way logging into a real desktop Chrome profile does.
 *
 * The underlying mechanism (Chrome's own `--user-data-dir` flag, already wired through
 * `BrowserLaunchOptions.userDataDir` → `BrowserLauncher.launch()`) already existed — what this
 * adds is the missing management layer on top: a registry mapping human-readable names to their
 * own dedicated userDataDir, so a caller can say "launch as my-logged-in-account" instead of
 * tracking raw filesystem paths themselves. Mirrors the real sutradhar/sutradhar project's
 * `POST /profiles` + per-instance profile selection.
 */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface ProfileInfo {
  readonly name: string;
  readonly description?: string;
  readonly userDataDir: string;
  readonly createdAt: string;
}

interface ProfileRegistry {
  profiles: Record<string, ProfileInfo>;
}

const VALID_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export class ProfileManager {
  private readonly registryPath: string;
  private readonly profilesRoot: string;

  public constructor(baseDir?: string) {
    const root = baseDir ?? path.join(os.homedir(), '.sutradhar');
    this.registryPath = path.join(root, 'profiles.json');
    this.profilesRoot = path.join(root, 'profiles');
  }

  private async readRegistry(): Promise<ProfileRegistry> {
    try {
      const raw = await readFile(this.registryPath, 'utf-8');
      return JSON.parse(raw) as ProfileRegistry;
    } catch {
      return { profiles: {} };
    }
  }

  private async writeRegistry(registry: ProfileRegistry): Promise<void> {
    await mkdir(path.dirname(this.registryPath), { recursive: true });
    await writeFile(this.registryPath, JSON.stringify(registry, null, 2), 'utf-8');
  }

  /** Create a new named profile (a dedicated, empty userDataDir) — throws if the name is
   *  invalid or already taken, rather than silently overwriting an existing profile's data. */
  public async create(name: string, description?: string): Promise<ProfileInfo> {
    if (!VALID_NAME.test(name)) {
      throw new Error(
        `Invalid profile name "${name}": must be 1-64 characters, letters/digits/hyphen/underscore only, not starting with - or _.`,
      );
    }
    const registry = await this.readRegistry();
    if (registry.profiles[name]) {
      throw new Error(`Profile "${name}" already exists. Use a different name, or delete() it first.`);
    }

    const userDataDir = path.join(this.profilesRoot, name);
    await mkdir(userDataDir, { recursive: true });

    const info: ProfileInfo = { name, description, userDataDir, createdAt: new Date().toISOString() };
    registry.profiles[name] = info;
    await this.writeRegistry(registry);
    return info;
  }

  public async list(): Promise<readonly ProfileInfo[]> {
    const registry = await this.readRegistry();
    return Object.values(registry.profiles);
  }

  public async get(name: string): Promise<ProfileInfo | undefined> {
    const registry = await this.readRegistry();
    return registry.profiles[name];
  }

  /** Remove a profile from the registry and delete its userDataDir (cookies/history/storage —
   *  irreversible). No-ops if the profile doesn't exist. */
  public async delete(name: string): Promise<void> {
    const registry = await this.readRegistry();
    const info = registry.profiles[name];
    if (!info) return;
    delete registry.profiles[name];
    await this.writeRegistry(registry);
    await rm(info.userDataDir, { recursive: true, force: true });
  }

  /** Resolve a profile name to its userDataDir, for wiring into `BrowserLaunchOptions`.
   *  Throws if the profile doesn't exist — a typo'd profile name should fail loudly, not
   *  silently fall back to launching a fresh, unnamed, throwaway profile instead. */
  public async resolveUserDataDir(name: string): Promise<string> {
    const info = await this.get(name);
    if (!info) {
      throw new Error(`No profile named "${name}". Run profile list to see what's available, or create() it first.`);
    }
    return info.userDataDir;
  }
}
