/**
 * @file packages/cli/src/text-output.ts
 * @description I-048: what `sutradhar text` prints for a window of page text, as pure functions (so the marker rule, the
 * `--json` shape and the read-error contract are unit-testable without a browser; cli.ts runs main() at module load).
 */
import { formatPageTextMarker, type PageTextResult } from '@sutradhar/capability-runtime';

export interface TextOutcome {
  /** One entry per `console.log` call. */
  stdout: string[];
  /** One entry per `console.error` call. */
  stderr: string[];
  exitCode: number;
}

/** The hint a truncated read ends with: where to continue. */
export function textContinueHint(end: number): string {
  return `Continue with: sutradhar text --offset ${end}`;
}

/** A successful read. Plain mode: the window, then (only when the read was not complete) the marker as its own final
 *  stdout line. `--json`: exactly one document, the {@link PageTextResult}, and no marker line. */
export function textOutput(r: PageTextResult, jsonMode: boolean): TextOutcome {
  if (jsonMode) return { stdout: [JSON.stringify(r, null, 2)], stderr: [], exitCode: 0 };
  const marker = formatPageTextMarker(r, textContinueHint(r.offset + r.returnedChars));
  return { stdout: marker === null ? [r.text] : [r.text, marker], stderr: [], exitCode: 0 };
}

/** The slice of the runtime `runTextCommand` needs (so a unit test can pass a fake). */
export interface TextRuntime {
  readTextWindow(sessionId: string, tabId?: string, opts?: { offset?: number; maxChars?: number }): Promise<PageTextResult>;
}

/** The whole `text` verb minus the printing: reads the window through `readTextWindow` (NOT `snapshot()`, so node ids are not
 *  re-stamped), passing exactly the flags the caller gave, and turns the result or a `PageTextReadError` into the outcome.
 *  Any other error is rethrown (it reaches `main().catch` like any failing verb). */
export async function runTextCommand(
  runtime: TextRuntime,
  sessionId: string,
  flags: { offset?: number; maxChars?: number; jsonMode: boolean },
): Promise<TextOutcome> {
  let result: PageTextResult;
  try {
    result = await runtime.readTextWindow(sessionId, undefined, {
      ...(flags.offset !== undefined ? { offset: flags.offset } : {}),
      ...(flags.maxChars !== undefined ? { maxChars: flags.maxChars } : {}),
    });
  } catch (err) {
    if (!isPageTextReadError(err)) throw err;
    return textReadErrorOutput(err);
  }
  return textOutput(result, flags.jsonMode);
}

/** The runtime's read-failure error is duplicated into each bundle, so it is matched by `name`, never `instanceof`. */
export function isPageTextReadError(err: unknown): err is Error & { source?: 'dom' | 'pdf' } {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'PageTextReadError';
}

/** A failed read: exactly one stderr line, nothing on stdout (also with `--json`), exit 1. Never a `Fatal:` line and
 *  never an empty stdout with exit 0 (which is what 0.6.1 did). */
export function textReadErrorOutput(err: Error): TextOutcome {
  return { stdout: [], stderr: [`Error: text read failed: ${err.message}`], exitCode: 1 };
}
