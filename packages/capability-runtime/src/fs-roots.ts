/**
 * @file packages/capability-runtime/src/fs-roots.ts
 * @description Single place layers of download/upload root configuration are resolved:
 * option > env > default, first defined layer wins, no merging (FR2-05 D6). Every caller
 * (`sutradhar-mcp`'s `createSutradharServer`, the CLI's `withSession`, and the SDK's `launch()`)
 * calls {@link resolveFsRoots} instead of hand-rolling this precedence.
 */

import os from 'node:os';
import path from 'node:path';
import { defaultDownloadRoot } from '@sutradhar/browser';

/** Env var naming the directories `browser.download_file` may write into (path.delimiter-separated). */
export const DOWNLOAD_ROOTS_ENV = 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS';
/** Env var naming the directories `upload_file`/`upload_file_via_trigger` may read from. Setting
 *  it TURNS ON the upload allowlist; unset means unrestricted (FR2-05 D4). */
export const UPLOAD_ROOTS_ENV = 'SUTRADHAR_ALLOWED_UPLOAD_ROOTS';

/** Which layer produced the resolved roots. FR2-14 adds `'config'` between `'env'` and `'default'`. */
export type RootSource = 'option' | 'env' | 'default';

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

    let expanded = trimmed;
    if (expanded === '~') {
      expanded = homedir;
    } else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
      expanded = p.join(homedir, expanded.slice(2));
    }

    if (!p.isAbsolute(expanded)) {
      throw new Error(`${name}: entry "${trimmed}" must be an absolute path (entries are separated by "${delim}")`);
    }
    entries.push(expanded);
  }

  if (entries.length === 0) return { roots: undefined, warnings };
  return { roots: entries, warnings };
}

/** An empty `options` array counts as unset, matching `?? default` semantics elsewhere. */
export function resolveFsRoots(input: ResolveFsRootsInput): ResolvedFsRoots {
  const platform = input.platform ?? process.platform;
  const homedir = input.homedir ?? os.homedir();
  const warnings: string[] = [];

  // Downloads.
  let allowedDownloadRoots: string[];
  let downloadSource: RootSource;
  if (input.options?.allowedDownloadRoots?.length) {
    allowedDownloadRoots = input.options.allowedDownloadRoots.map((r) => path.resolve(r));
    downloadSource = 'option';
  } else {
    const envResult = input.env
      ? parseRootsEnv(DOWNLOAD_ROOTS_ENV, input.env[DOWNLOAD_ROOTS_ENV], platform, homedir)
      : { roots: undefined, warnings: [] };
    warnings.push(...envResult.warnings);
    if (envResult.roots) {
      allowedDownloadRoots = envResult.roots;
      downloadSource = 'env';
    } else {
      allowedDownloadRoots = [defaultDownloadRoot()];
      downloadSource = 'default';
    }
  }

  // Uploads.
  let allowedUploadRoots: string[] | undefined;
  let uploadSource: RootSource | 'unrestricted';
  if (input.options?.allowedUploadRoots?.length) {
    allowedUploadRoots = input.options.allowedUploadRoots.map((r) => path.resolve(r));
    uploadSource = 'option';
  } else {
    const envResult = input.env
      ? parseRootsEnv(UPLOAD_ROOTS_ENV, input.env[UPLOAD_ROOTS_ENV], platform, homedir)
      : { roots: undefined, warnings: [] };
    warnings.push(...envResult.warnings);
    if (envResult.roots) {
      allowedUploadRoots = envResult.roots;
      uploadSource = 'env';
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
