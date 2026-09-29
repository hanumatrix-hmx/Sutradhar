/**
 * @file packages/cli/src/dialog-json-routing.ts
 * @description GAP-261/GAP-268/GAP-269 (FR2-12): the pure decisions behind "a dialog line never
 * corrupts `--json` stdout", pulled out of `cli.ts` into their own module — exactly like
 * `audit-output.ts` — so a CLI unit test can import and assert on them directly. `cli.ts` itself
 * calls `main()` unconditionally at module load (it's a bin entrypoint, not a library), so a test
 * that imported these from `cli.ts` directly would trigger a real CLI run as a side effect of the
 * import; keeping them here avoids that entirely.
 *
 * GAP-269 (test-integrity, fix-2): before this module existed, none of GAP-261's CLI-side fix (in
 * `reportDialogs`/the session gate/`cmdAudit`'s catch, all in `cli.ts`) had unit coverage — only
 * the live probe and live-verify scripts caught a regression there (confirmed by audit-2's own
 * mutation testing: M6/M7 revert the stdout/stderr routing, M8/M9 delete one of the two
 * dialog-blocked-JSON writers, and all of them passed every existing unit test). The three pieces
 * below are exactly what audit-2's mutations touched.
 */

import type { PendingDialogEntry } from './dialog-cli.js';

/** GAP-261's routing rule: in `--json` mode, a dialog-status line must never reach stdout ahead
 *  of (or instead of) a command's own JSON document — it goes to stderr instead. Outside
 *  `--json` mode it's a normal stdout line, same as before FR2-04. Pulled out so `reportDialogs`
 *  and the session gate's own dialog-handled printing share ONE decision instead of two copies
 *  that could drift (audit-2's M6/M7 mutations each reverted one of the two copies back to always
 *  `console.log`). */
export function dialogOutputSink(isJsonMode: boolean): typeof console.log {
  return isJsonMode ? console.error : console.log;
}

/** GAP-261: the single JSON document printed to stdout, in `--json` mode only, when a dialog
 *  blocks a command entirely (either the gate refused to even start it, or it pre-empted a
 *  running command past its grace period) — the schema's own `dialogPending`/`dialogsHandled`
 *  keys (audit-report.schema.json, D2.4), but standalone rather than nested in a full
 *  `AuditReport` (there is no report at all in the blocked case: the command never got far enough
 *  to produce one). Not audit-specific — `jsonMode` is a global CLI flag, and any `--json` command
 *  a dialog blocks must keep the same "stdout is always exactly one parseable document" guarantee.
 *  Pure: takes everything it needs as arguments, writes nothing itself. */
export function dialogBlockedJsonDoc(
  message: string,
  dialogs: readonly PendingDialogEntry[],
  handled: readonly { dialog: PendingDialogEntry; action: 'accept' | 'dismiss'; promptText?: string }[] = [],
): string {
  const first = dialogs[0];
  return JSON.stringify(
    {
      error: message,
      dialogPending: first
        ? { type: first.dialogType, message: first.message, defaultValue: first.defaultValue ?? null, url: first.url }
        : null,
      dialogsHandled: handled.map((r) => ({
        type: r.dialog.dialogType,
        message: r.dialog.message,
        action: r.action,
        promptText: r.promptText ?? null,
        by: 'policy',
      })),
    },
    null,
    2,
  );
}

/** GAP-268 (FR2-12 audit-2, fix-2; widened after fix-2's own first attempt was caught by its own
 *  live sweep): MORE than two call sites in `cli.ts` can each decide to write a JSON document to
 *  stdout for the SAME `--json` command invocation, and none of them cancels any other —
 *  `withSession`'s own pre-emption branch returns immediately once a dialog outlives the grace
 *  period, but the raced `work` promise (a command's own `fn(runtime, sessionId)` callback — e.g.
 *  `cmdAudit`'s body) is NOT cancelled (Puppeteer/CDP calls have no cancellation token) and keeps
 *  running in the background. Two different things can then happen to that abandoned work, and
 *  fix-2's FIRST pass only guarded one of them:
 *   1. it fails on its own (e.g. `page.evaluate`/`page.screenshot` rejecting with "Target closed"
 *      once the dialog has fully blocked the page) and `cmdAudit`'s own catch reconstructs the
 *      same blocked-JSON shape a second time — audit-2's originally reported shape (12/18 trials
 *      at 1500-1575ms).
 *   2. it actually SUCCEEDS anyway (found live by fix-2's own re-verification sweep, 2/15 trials
 *      at 1560-1570ms: a headless Chrome `page.screenshot()`/`page.evaluate()` pair can complete
 *      even with a JS `alert()` already open, because the CDP calls themselves aren't blocked by
 *      the renderer's dialog the way user-facing script execution is) — and `cmdAudit`'s NORMAL
 *      success path then prints the full `AuditReport` JSON as a second document.
 *  Confirmed by mutation that deleting just one of these write sites does NOT fix it (the
 *  remaining writers still race each other).
 *
 *  Fixed with actual coordination across EVERY stdout-JSON write for the command, not just the
 *  blocked-doc ones: a single per-process guard, shared by reference through this one function,
 *  so only the FIRST write for the whole command invocation — whichever shape it is — actually
 *  reaches stdout. `resetJsonStdoutGuard` lets a test exercise the guard itself — several calls in
 *  a row — without needing a live dialog race. Each function returns whether ITS call actually
 *  wrote (callers use that to decide whether to also print their own stderr line), and takes the
 *  sink function itself (defaults to the real `console.log`) so a test can assert on the write
 *  without polluting its own stdout. */
let guardState = { printed: false };
export function resetJsonStdoutGuard(): void {
  guardState = { printed: false };
}
/** The one place any `--json` command's stdout JSON document is actually written. Every call
 *  site in `cli.ts` that would otherwise call `console.log(JSON.stringify(...))` for a `--json`
 *  command's own result goes through this instead. */
export function writeJsonStdoutOnce(text: string, sink: typeof console.log = console.log): boolean {
  if (guardState.printed) return false;
  guardState.printed = true;
  sink(text);
  return true;
}
export function printDialogBlockedJsonOnce(
  message: string,
  dialogs: readonly PendingDialogEntry[],
  handled: readonly { dialog: PendingDialogEntry; action: 'accept' | 'dismiss'; promptText?: string }[] = [],
  sink: typeof console.log = console.log,
): boolean {
  return writeJsonStdoutOnce(dialogBlockedJsonDoc(message, dialogs, handled), sink);
}
