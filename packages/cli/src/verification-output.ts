/**
 * @file packages/cli/src/verification-output.ts
 * @description FR2-07: pure helpers that turn an action result's `verification` into what the CLI
 * prints and which exit code it uses. Kept free of cli.ts (which runs `main()` at module load) so
 * they are unit-testable.
 */

import { failedExpectations, type VerificationResultDto } from '@sutradhar/capability-runtime';

/** Exit code for "the action ran, but an `--expect-*` assertion failed or couldn't be evaluated".
 *  Distinct from 1 (the action itself failed) and 3 (blocked by a dialog). */
export const EXIT_EXPECTATION_FAILED = 4;

const REASON_CAP = 400;

/**
 * `Verification: verified (confidence 0.90) — <reason>` or
 * `Verification: NOT verified — <tier> (confidence 0.45) — <reason>`; `none reported` when the
 * result carried no verification at all. Newlines in the reason collapse to spaces; capped at 400.
 */
export function formatVerificationLine(v: VerificationResultDto | undefined): string {
  if (!v) return 'Verification: none reported';
  let reason = v.reason.replace(/\s*[\r\n]+\s*/g, ' ');
  if (reason.length > REASON_CAP) reason = `${reason.slice(0, REASON_CAP - 1)}…`;
  const confidence = v.confidence.toFixed(2);
  if (v.verified) return `Verification: verified (confidence ${confidence}) — ${reason}`;
  return `Verification: NOT verified — ${v.evidence.tier} (confidence ${confidence}) — ${reason}`;
}

/** 1 when the action failed; 4 when an expectation was given and any `expect.*` check did not pass;
 *  otherwise 0 (a built-in contradiction with no expectation is reported on the line, not the exit code). */
export function exitCodeForResult(
  r: { success: boolean; verification?: VerificationResultDto },
  expectGiven: boolean,
): 0 | 1 | 4 {
  if (!r.success) return 1;
  if (expectGiven && failedExpectations(r.verification).length > 0) return EXIT_EXPECTATION_FAILED;
  return 0;
}

/** The result as CLI `--json` prints it: the (large, base64) failure screenshot is dropped and its
 *  omission recorded, everything else untouched. */
export function toCliJson(r: object): object {
  const out: Record<string, unknown> = { ...(r as Record<string, unknown>) };
  if ('failureScreenshot' in out) {
    const had = typeof out.failureScreenshot === 'string' && out.failureScreenshot.length > 0;
    delete out.failureScreenshot;
    if (had) out.failureScreenshotOmitted = true;
  }
  return out;
}
