/**
 * @file packages/cli/src/waitfor-output.ts
 * @description FR2-08: pure formatting of a `waitfor` result into what the CLI prints and which exit code
 * it uses. Kept free of cli.ts (which runs `main()` at module load) so it is unit-testable.
 */

import type { ActionResult, WaitForCondition } from '@sutradhar/capability-runtime';
import { describePageCondition } from '@sutradhar/browser';
import { formatVerificationLine } from './verification-output.js';

/** The exit code FR2-04 uses for "blocked by / interrupted by an open dialog". */
export const EXIT_BLOCKED_BY_DIALOG = 3;

const DIALOG_FAILURE_PREFIX = 'wait_for blocked by an open';

export interface WaitForOutcome {
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
  readonly exitCode: 0 | 1 | 3;
}

/**
 * Success: `Condition met after Nms: text="..."` (+ the Verification line), and on a vacuous `textGone`
 * a stderr `Note:` (the text was never there, so the wait was satisfied at once: check it for a typo).
 * Failure: `Wait failed: <error>`, exit 1 (3 when a dialog blocked the page).
 */
export function waitForOutcome(result: ActionResult, condition: WaitForCondition): WaitForOutcome {
  const { timeoutMs: _t, ...c } = condition;
  if (!result.success) {
    const error = result.error ?? 'wait_for failed';
    return {
      stdout: [`Wait failed: ${error}`],
      stderr: [],
      exitCode: error.startsWith(DIALOG_FAILURE_PREFIX) ? EXIT_BLOCKED_BY_DIALOG : 1,
    };
  }
  const output = (result.output ?? {}) as { satisfiedAfterMs?: number; presentAtStart?: boolean };
  const stderr: string[] = [];
  if (c.textGone !== undefined && output.presentAtStart === false) {
    stderr.push(
      `Note: "${c.textGone}" was not present when the wait started, so textGone was satisfied immediately — check the text if you expected it.`,
    );
  }
  return {
    stdout: [
      `Condition met after ${output.satisfiedAfterMs ?? result.executionTimeMs}ms: ${describePageCondition(c)}`,
      formatVerificationLine(result.verification),
    ],
    stderr,
    exitCode: 0,
  };
}
