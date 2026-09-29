/**
 * @file packages/sutradhar/src/errors.ts
 * @description FR2-07: the two ways an SDK action call can throw, so a caller can tell "the action
 * did not happen" apart from "the action happened but did not do what I expected".
 */

import type { ActionResult, NavigateResult } from '@sutradhar/capability-runtime';

/**
 * The action itself failed (`success:false`): the element wasn't found, the click was occluded, the
 * download timed out, ... `result` is the full runtime result (its `verification.evidence.tier` is
 * `'action-failed'`). Before FR2-07 the SDK swallowed this silently for click/type/press/scroll.
 */
export class ActionFailedError extends Error {
  public override readonly name = 'ActionFailedError';

  public constructor(public readonly result: ActionResult) {
    super(result.error ?? `${result.actionType} failed`);
  }
}

/**
 * The action succeeded, but an `expect` assertion the caller passed did not hold (or couldn't be
 * evaluated). `failed` lists the failing keys (`'text' | 'url' | 'urlChanged'`); `result` is the
 * successful result, whose `verification` explains what was observed.
 */
export class ExpectationFailedError extends Error {
  public override readonly name = 'ExpectationFailedError';

  public constructor(
    public readonly result: ActionResult | NavigateResult,
    public readonly failed: string[],
  ) {
    super(`Expectation failed (${failed.join(', ')}): ${result.verification?.reason ?? 'no reason reported'}`);
  }
}
