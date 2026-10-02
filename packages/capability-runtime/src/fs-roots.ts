/**
 * @file packages/capability-runtime/src/fs-roots.ts
 * @description Single place layers of download/upload root configuration are resolved:
 * option > env > config > default, first defined layer wins, no merging (FR2-05 D6; FR2-14 added the
 * `config` layer). Every caller
 * (`sutradhar-mcp`'s `createSutradharServer`, the CLI's `withSession`, and the SDK's `launch()`)
 * calls {@link resolveFsRoots} instead of hand-rolling this precedence.
 */

import os from 'node:os';
import path from 'node:path';
import { defaultDownloadRoot } from '@sutradhar/browser';
import { echo } from './echo.js';
import { isLayerSet } from './layer-set.js';

/** Env var naming the directories `browser.download_file` may write into (path.delimiter-separated). */
export const DOWNLOAD_ROOTS_ENV = 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS';
/** Env var naming the directories `upload_file`/`upload_file_via_trigger` may read from. Setting
 *  it TURNS ON the upload allowlist; unset means unrestricted (FR2-05 D4). */
export const UPLOAD_ROOTS_ENV = 'SUTRADHAR_ALLOWED_UPLOAD_ROOTS';

/** Which layer produced the resolved roots (FR2-14: `'config'` sits between `'env'` and `'default'`). */
export type RootSource = 'option' | 'env' | 'config' | 'default';

export interface FsRootsOptions {
  allowedDownloadRoots?: readonly string[];
  allowedUploadRoots?: readonly string[];
}

export interface ResolveFsRootsInput {
  /** SDK `launch()` / `createSutradharServer` options; a relative entry is resolved against
   *  `process.cwd()` (today's behavior, unchanged). */
  options?: FsRootsOptions;
  /** Omit entirely to skip the env layer (the SDK does this deliberately — D5). */
  env?: Record<string, string | undefined>;
  /**
   * FR2-14: the `.sutradhar.json` layer, below env and above the default. Entries are resolved
   * against `baseDir` (the config file's directory), NOT against `process.cwd()`; an absolute
   * entry (what the project-config loader already produces) is unchanged. Whole value, never
   * merged with another layer (D9).
   */
  config?: FsRootsOptions & {
    baseDir: string;
    /**
     * FR2-14 fix-1 (F1): why this (discovered, untrusted) file's download roots may NOT be used, e.g.
     * an out-of-tree `downloadDir`. Raised ONLY when the config layer is the one that would supply
     * the download roots, so an option or an env var (which outrank the file) always wins instead
     * of being blocked by a layer they replace.
     */
    downloadRefusal?: string;
  };
  /** Injectable for tests. */
  platform?: NodeJS.Platform;
  homedir?: string;
}

export interface ResolvedFsRoots {
  /** Never empty; the default is `[defaultDownloadRoot()]`. */
  allowedDownloadRoots: string[];
  /** `undefined` means unrestricted. */
  allowedUploadRoots: string[] | undefined;
  sources: { download: RootSource; upload: RootSource | 'unrestricted' };
  warnings: string[];
}

/**
 * Expands a leading `~` (alone, or `~/`/`~\`) to `homedir`. Returns `undefined` for `~user...`
 * (unsupported — the caller reports the error); any other entry is returned unchanged.
 */
export function expandHome(
  entry: string,
  homedir: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (entry === '~') return homedir;
  if (entry.startsWith('~/') || entry.startsWith('~\\')) return p.join(homedir, entry.slice(2));
  if (entry.startsWith('~')) return undefined;
  return entry;
}

/**
 * Resolves one path written INSIDE a project config file: `~` expands to the home directory, a
 * relative path resolves against `baseDir` (the config file's directory, never the cwd), an
 * absolute path is taken as-is. `~user` throws.
 */
export function resolveConfigPath(
  entry: string,
  baseDir: string,
  homedir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const e = expandHome(entry, homedir, platform);
  if (e === undefined) throw new Error(`"${echo(entry)}": ~user is not supported (use ~ or an explicit path)`);
  return path.resolve(baseDir, e);
}

/**
 * Splits `raw` on the platform's `path.delimiter`, trims entries, drops empties, expands a
 * leading `~` (alone, or `~/`/`~\`) to `homedir`, and requires every remaining entry to be
 * absolute — a relative entry throws, since the MCP server's cwd is whatever the client happens
 * to spawn it with, and resolving against it silently would be a trap (D2).
 */
export function parseRootsEnv(
  name: string,
  raw: string | undefined,
  platform: NodeJS.Platform = process.platform,
  homedir: string = os.homedir(),
): { roots: string[] | undefined; warnings: string[] } {
  const warnings: string[] = [];
  if (raw === undefined) return { roots: undefined, warnings };

  const delim = platform === 'win32' ? ';' : ':';
  const p = platform === 'win32' ? path.win32 : path.posix;

  const rawEntries = raw.split(delim);
  const entries: string[] = [];
  for (const rawEntry of rawEntries) {
    const trimmed = rawEntry.trim();
    if (trimmed === '') continue;
    if (trimmed.includes(',')) {
      warnings.push(
        `${name}: entry "${trimmed}" contains a comma — entries are separated by "${delim}" (path.delimiter), not ",".`,
      );
    }

    // `~user` stays unexpanded here and falls into the "must be absolute" error below (unchanged).
    const expanded = expandHome(trimmed, homedir, platform) ?? trimmed;

    if (!p.isAbsolute(expanded)) {
      throw new Error(`${name}: entry "${trimmed}" must be an absolute path (entries are separated by "${delim}")`);
    }
    entries.push(expanded);
  }

  if (entries.length === 0) return { roots: undefined, warnings };
  return { roots: entries, warnings };
}

/** What counts as "set" for every layer is defined ONCE in `layer-set.ts` (`isLayerSet`). */
export function resolveFsRoots(input: ResolveFsRootsInput): ResolvedFsRoots {
  const platform = input.platform ?? process.platform;
  const homedir = input.homedir ?? os.homedir();
  const warnings: string[] = [];

  // Downloads.
  let allowedDownloadRoots: string[];
  let downloadSource: RootSource;
  if (isLayerSet(input.options?.allowedDownloadRoots)) {
    allowedDownloadRoots = input.options.allowedDownloadRoots.map((r) => path.resolve(r));
    downloadSource = 'option';
  } else {
    const envResult = input.env
      ? parseRootsEnv(DOWNLOAD_ROOTS_ENV, input.env[DOWNLOAD_ROOTS_ENV], platform, homedir)
      : { roots: undefined, warnings: [] };
    warnings.push(...envResult.warnings);
    if (isLayerSet(envResult.roots)) {
      allowedDownloadRoots = envResult.roots;
      downloadSource = 'env';
    } else if (isLayerSet(input.config?.allowedDownloadRoots)) {
      if (input.config.downloadRefusal !== undefined) {
        const err = new Error(input.config.downloadRefusal);
        err.name = 'ProjectConfigError';
        throw err;
      }
      allowedDownloadRoots = input.config.allowedDownloadRoots.map((r) =>
        resolveConfigPath(r, input.config!.baseDir, homedir, platform),
      );
      downloadSource = 'config';
    } else {
      allowedDownloadRoots = [defaultDownloadRoot()];
      downloadSource = 'default';
    }
  }

  // Uploads.
  let allowedUploadRoots: string[] | undefined;
  let uploadSource: RootSource | 'unrestricted';
  if (isLayerSet(input.options?.allowedUploadRoots)) {
    allowedUploadRoots = input.options.allowedUploadRoots.map((r) => path.resolve(r));
    uploadSource = 'option';
  } else {
    const envResult = input.env
      ? parseRootsEnv(UPLOAD_ROOTS_ENV, input.env[UPLOAD_ROOTS_ENV], platform, homedir)
      : { roots: undefined, warnings: [] };
    warnings.push(...envResult.warnings);
    if (isLayerSet(envResult.roots)) {
      allowedUploadRoots = envResult.roots;
      uploadSource = 'env';
    } else if (isLayerSet(input.config?.allowedUploadRoots)) {
      allowedUploadRoots = input.config.allowedUploadRoots.map((r) =>
        resolveConfigPath(r, input.config!.baseDir, homedir, platform),
      );
      uploadSource = 'config';
    } else {
      allowedUploadRoots = undefined;
      uploadSource = 'unrestricted';
    }
  }

  return {
    allowedDownloadRoots,
    allowedUploadRoots,
    sources: { download: downloadSource, upload: uploadSource },
    warnings,
  };
}
