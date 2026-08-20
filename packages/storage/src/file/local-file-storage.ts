/**
 * @file packages/storage/src/file/local-file-storage.ts
 * @description LocalFileStorage adapter implementing IFileStorage using Node.js fs/promises.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { StructuredLogger } from '@sutradhar/observability';
import { IFileStorage } from './storage-interfaces.js';

export interface LocalFileStorageOptions {
  readonly baseDir?: string;
  readonly logger?: StructuredLogger;
}

export class LocalFileStorage implements IFileStorage {
  private readonly baseDir: string;
  private readonly logger: StructuredLogger;

  public constructor(options: LocalFileStorageOptions = {}) {
    this.baseDir = options.baseDir ?? path.join(process.cwd(), '.sutradhar-storage');
    this.logger = options.logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  public async writeFile(key: string, data: Buffer | string): Promise<string> {
    const filePath = await this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);

    this.logger.debug(
      `[LocalFileStorage] Wrote ${typeof data === 'string' ? data.length : data.byteLength} bytes to ${key}`,
    );
    return filePath;
  }

  public async readFile(key: string): Promise<Buffer> {
    const filePath = await this.resolvePath(key);
    try {
      return await fs.readFile(filePath);
    } catch (err: unknown) {
      throw new Error(
        `File '${key}' not found in storage: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  public async deleteFile(key: string): Promise<boolean> {
    const filePath = await this.resolvePath(key);
    try {
      await fs.unlink(filePath);
      this.logger.debug(`[LocalFileStorage] Deleted file ${key}`);
      return true;
    } catch {
      return false;
    }
  }

  public async exists(key: string): Promise<boolean> {
    const filePath = await this.resolvePath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  public async listFiles(prefix = ''): Promise<readonly string[]> {
    const targetDir = prefix ? await this.resolvePath(prefix) : this.baseDir;
    try {
      const entries = await fs.readdir(targetDir, { recursive: true, withFileTypes: true });
      const files: string[] = [];

      for (const entry of entries) {
        if (entry.isFile()) {
          const fullPath = path.join(entry.path ?? targetDir, entry.name);
          const relativeKey = path.relative(this.baseDir, fullPath).replace(/\\/g, '/');
          files.push(relativeKey);
        }
      }

      return files;
    } catch {
      return [];
    }
  }

  /**
   * Resolves `key` to an absolute path under `baseDir`, sanitizing `..` segments, and rejects
   * anything that would escape it.
   *
   * The string-prefix check alone (a caller-supplied `key` can never literally escape
   * `baseDir` once `..` segments are stripped, since `path.join(baseDir, sanitized)` is always
   * string-prefixed by `baseDir`) doesn't catch a DIFFERENT escape route: if `baseDir` itself,
   * or any directory segment along the resolved path, is actually a symlink/junction pointing
   * elsewhere, the real read/write still lands outside the intended storage root even though
   * the string comparison passes. Defense in depth: walk up from the resolved path to the
   * deepest EXISTING ancestor directory, resolve ITS real (symlink-free) path, and confirm
   * that's still contained within `baseDir`'s own real path.
   */
  private async resolvePath(key: string): Promise<string> {
    // Sanitize path key to prevent directory traversal
    const sanitized = path.normalize(key).replace(/^(\.\.[/\\])+/, '');
    const resolved = path.join(this.baseDir, sanitized);

    if (resolved !== this.baseDir && !resolved.startsWith(this.baseDir + path.sep)) {
      throw new Error(`Invalid storage key '${key}': directory traversal attempt detected`);
    }

    // Walk up from the resolved path's parent, but never above `baseDir` itself — if nothing
    // between them exists yet, there's nothing to symlink-check (a fresh `mkdir -p` creates
    // real directories, not symlinks). Only once we find an existing directory at or under
    // `baseDir` do we resolve it (and `baseDir`, which must then also exist, since a nested
    // path can't exist without its parent) to their real paths and compare.
    let probe = path.dirname(resolved);
    while (probe === this.baseDir || probe.startsWith(this.baseDir + path.sep)) {
      let canonicalProbe: string;
      try {
        canonicalProbe = await fs.realpath(probe);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          probe = path.dirname(probe);
          continue;
        }
        throw err;
      }
      const canonicalBaseDir = await fs.realpath(this.baseDir);
      if (canonicalProbe !== canonicalBaseDir && !canonicalProbe.startsWith(canonicalBaseDir + path.sep)) {
        throw new Error(`Invalid storage key '${key}': resolves outside the storage root via a symlink`);
      }
      break;
    }

    return resolved;
  }
}
