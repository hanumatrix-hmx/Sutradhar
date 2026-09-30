/**
 * @file packages/browser/src/actions/page-settle.ts
 * @description The opt-in post-action "settle" wait (see `ActionParams.settle`), extracted from
 * the action engine so runtime-level actions (navigate, click_at_point, handle_dialog, ...) that
 * bypass the engine can use the very same wait, and so it can carry a NODE-SIDE hard bound.
 *
 * FR2-08 (T5/D14): the engine's original implementation had no bound of its own on the Node side.
 * Every bound it had was an in-page timer, or a Puppeteer timeout that only starts once the
 * evaluate is actually running. While a native dialog is open `page.evaluate` does not run until
 * the dialog closes, so a `click` with `settle:true` that opened an `alert` blocked until the
 * tab's 30 s auto-dismiss. {@link waitForPageSettle} now races the whole wait against a Node
 * timer of `timeoutMs + SETTLE_HARD_BOUND_GRACE_MS`.
 */

import type { Page } from 'puppeteer-core';
import type { SettleSpec } from './action-types.js';

/** Defaults for a `settle` passed as `true` (or as a partial {@link SettleSpec}). */
export const DEFAULT_SETTLE_SPEC: Readonly<Required<SettleSpec>> = Object.freeze({
  mutationQuietMs: 300,
  networkIdleMs: 500,
  timeoutMs: 5000,
});

/** How long past `spec.timeoutMs` the Node-side hard bound waits before giving up on a settle
 *  whose in-page/Puppeteer bounds never fired (an open dialog; a throttled background tab). */
export const SETTLE_HARD_BOUND_GRACE_MS = 500;

/** `undefined`/`false` -> `null` (don't settle); `true` -> the defaults; an object -> the defaults
 *  overridden by its own DEFINED fields. */
export function resolveSettleSpec(settle: boolean | SettleSpec | undefined): Required<SettleSpec> | null {
  if (!settle) return null;
  if (settle === true) return { ...DEFAULT_SETTLE_SPEC };
  return {
    mutationQuietMs: settle.mutationQuietMs ?? DEFAULT_SETTLE_SPEC.mutationQuietMs,
    networkIdleMs: settle.networkIdleMs ?? DEFAULT_SETTLE_SPEC.networkIdleMs,
    timeoutMs: settle.timeoutMs ?? DEFAULT_SETTLE_SPEC.timeoutMs,
  };
}

/** Runs `f`, turning a synchronous throw or an async rejection into a resolved promise. */
function swallow(f: () => Promise<unknown> | unknown): Promise<void> {
  try {
    return Promise.resolve(f()).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

/**
 * Waits for the page to stop actively changing after an action, on the theory (INSIGHTS.md
 * Insight 2) that most real-world flakiness is a race at the STATE TRANSITION after an action
 * fires, not the action itself.
 *
 * Two independent checks run in parallel:
 *  - DOM-mutation-quiet: a `MutationObserver` on `document.body` (subtree, all mutation types)
 *    resolves once `mutationQuietMs` passes with zero observed mutations;
 *  - network-idle: Puppeteer's own `page.waitForNetworkIdle`.
 *
 * Neither throws on timeout: a page with continuous background chatter never goes fully quiet,
 * which is not a failure. NEW (D14): the whole wait is also raced against a Node timer, so it
 * always returns by `timeoutMs + SETTLE_HARD_BOUND_GRACE_MS`. The timer is cleared on completion.
 *
 * NOTE what this cannot see: a timer the page scheduled for later (`setTimeout(showToast, 2000)`)
 * looks perfectly quiet. Use `wait_for` for a specific result.
 *
 * Never throws. A no-op when `settle` is falsy.
 */
export async function waitForPageSettle(page: Page, settle: boolean | SettleSpec | undefined): Promise<void> {
  const spec = resolveSettleSpec(settle);
  if (!spec) return;

  const domQuiet = swallow(() =>
    page.evaluate(
      (quietMs, boundMs) => {
        return new Promise<void>((resolve) => {
          let timer: ReturnType<typeof setTimeout>;
          const done = () => {
            observer.disconnect();
            clearTimeout(timer);
            resolve();
          };
          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(done, quietMs);
          });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
          // Start the quiet timer immediately too: a page that never mutates at all resolves
          // after `quietMs`, it doesn't wait for a mutation that's never coming.
          timer = setTimeout(done, quietMs);
          // Absolute upper bound regardless of ongoing mutations.
          setTimeout(done, boundMs);
        });
      },
      spec.mutationQuietMs,
      spec.timeoutMs,
    ),
  ); // a page mid-navigation when this evaluates is not a settle failure

  const networkIdle = swallow(() =>
    page.waitForNetworkIdle({ idleTime: spec.networkIdleMs, timeout: spec.timeoutMs }),
  ); // a timeout here just means "still busy after the bound", not an error

  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  const hardBound = new Promise<void>((resolve) => {
    hardTimer = setTimeout(resolve, Math.max(0, spec.timeoutMs) + SETTLE_HARD_BOUND_GRACE_MS);
  });
  try {
    await Promise.race([Promise.all([domQuiet, networkIdle]), hardBound]);
  } finally {
    if (hardTimer) clearTimeout(hardTimer);
  }
}
