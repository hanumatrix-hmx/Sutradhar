/**
 * @file apps/server/src/runtime/env-loader.ts
 * @description Minimal .env loader (no dependencies).
 *
 * Loads a `.env` file from the server's working directory (or repo root) into
 * `process.env` on startup, but never overwrites variables that are already set.
 * This lets you drop `OPENROUTER_API_KEY=...`, `PINCHTAB_MODEL=...`, etc. into a
 * repo-root `.env` and have them just work when the server boots.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Loads `.env` from one of the candidate locations. Called once at startup.
 * Silently no-ops if no file exists (env vars from the shell still apply).
 */
export function loadEnvFile(candidates?: readonly string[]): void {
  const dirs = candidates ?? [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '../..'),
  ];

  let envPath: string | undefined;
  for (const dir of dirs) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      envPath = candidate;
      break;
    }
  }

  if (!envPath) return;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Never overwrite an already-set variable (shell env wins).
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
