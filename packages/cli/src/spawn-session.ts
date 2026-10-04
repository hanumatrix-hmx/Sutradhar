/**
 * @file packages/cli/src/spawn-session.ts
 * @description GAP-349 / F8: a freshly spawned Chrome is not in state.json until the CLI has attached
 * to it and applied its viewport, so if that setup fails nothing could ever `close` it. The failure
 * path therefore awaits a discard (kill the Chrome, remove its auto-created temp dir) BEFORE the
 * original error propagates.
 */
import type { SpawnedChrome } from './spawn-chrome.js';

/** Runs `attach`. If it throws, awaits `discard(spawned)` (a failing discard never replaces the
 *  original error) and rethrows the ORIGINAL error. On success nothing is discarded. */
export async function attachOrDiscard<T>(
  spawned: SpawnedChrome,
  attach: () => Promise<T>,
  discard: (spawned: SpawnedChrome) => Promise<void>,
): Promise<T> {
  try {
    return await attach();
  } catch (err) {
    try {
      await discard(spawned);
    } catch {
      // the original error is the one that matters
    }
    throw err;
  }
}
