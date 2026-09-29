/**
 * @file packages/cli/src/selector-args.ts
 * @description FR2-06: pre-validates CLI selector arguments (and `--frame` chains) for
 * Playwright-style syntax BEFORE `withSession` runs — so a bad selector exits 1 with an
 * actionable hint without ever attaching to Chrome, spawning one, or exposing GAP-006's
 * self-heal path, whatever state that item is in. Pure; no session, no browser.
 */
import { normalizeTarget } from '@sutradhar/capability-runtime';
import { InvalidSelectorError, SELECTOR_SYNTAX_HINT } from '@sutradhar/browser';

/** Returns the error text for the first unsupported selector arg, or `null` when every given
 *  arg (skipping `undefined`s — an omitted optional selector) is fine. */
export function validateSelectorArgs(args: ReadonlyArray<string | undefined>): string | null {
  for (const arg of args) {
    if (arg === undefined) continue;
    try {
      normalizeTarget(arg);
    } catch (e) {
      if (e instanceof InvalidSelectorError) return e.message;
      throw e;
    }
  }
  return null;
}

/** Same idea, for a `"::"`-chained `--frame` value — names the specific hop and the full chain,
 *  the same way `SutradharRuntime`'s own `resolveFrame` does. */
export function validateFrameChain(chain: string | undefined): string | null {
  if (chain === undefined) return null;
  const hops = chain.split('::').map((s) => s.trim()).filter((s) => s.length > 0);
  for (const hop of hops) {
    try {
      normalizeTarget(hop);
    } catch (e) {
      if (e instanceof InvalidSelectorError) {
        return `Invalid frameSelector "${hop}" (from the full chain "${chain}") — ${e.reason} ${SELECTOR_SYNTAX_HINT}`;
      }
      throw e;
    }
  }
  return null;
}
