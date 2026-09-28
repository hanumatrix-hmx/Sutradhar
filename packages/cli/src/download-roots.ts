/**
 * @file packages/cli/src/download-roots.ts
 * @description Pure helpers for the CLI's `download` verb (FR2-05). The directory typed on the
 * command line was chosen by whoever runs the shell — that principal can already write anywhere
 * with `cp`/`curl`/`>`, so it's granted for this single invocation's `download` verb only,
 * without widening the configured roots or being persisted to `CliState` (D1).
 */

import path from 'node:path';
import { stat } from 'node:fs/promises';

/**
 * Combine the configured download roots with the CLI's own per-invocation grant for an explicit
 * destination directory. `configured` is never mutated.
 */
export function cliDownloadGrant(
  configured: readonly string[],
  explicitDir: string | undefined,
  cwd: string,
): { roots: string[]; downloadDir: string | undefined } {
  if (explicitDir === undefined) {
    return { roots: [...configured], downloadDir: undefined };
  }
  const resolved = path.resolve(cwd, explicitDir);
  return { roots: [...configured, resolved], downloadDir: resolved };
}

/** Rejects if `dir` exists and is not a directory. A nonexistent path is fine (CDP creates it). */
export async function assertDownloadDirUsable(dir: string): Promise<void> {
  let s;
  try {
    s = await stat(dir);
  } catch {
    return; // ENOENT (or any other stat failure) — CDP will create it.
  }
  if (!s.isDirectory()) {
    throw new Error(`"${dir}" exists and is not a directory`);
  }
}
