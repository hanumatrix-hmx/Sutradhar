/**
 * @file packages/cli/src/history-output.ts
 * @description I-NAV: what `sutradhar back | forward | reload` print and which exit code they use, as pure functions
 * (cli.ts runs `main()` at module load, so it is never imported by a unit test).
 *
 * Success of a history move is decided by the verification's HISTORY INDEX (`<go_back|go_forward>.history-index`), never by
 * a loader id: a same-document entry (`pushState`, a `#hash`) moves the index without a new document. "No entry in that
 * direction" is recognised ONLY by the machine-readable `<verb>.history-edge` check the probe emits at an edge; never from
 * the verdict reason text (an `--expect-*` failure replaces it, Rule 5) and never from `expected === -1`.
 */
import {
  failedExpectations,
  type ActionExpectation,
  type NavigateResult,
  type SettleSpec,
  type VerificationResultDto,
} from '@sutradhar/capability-runtime';
import { dismissedBeforeunloadSince, beforeunloadCancelMessage } from './dialog-cli.js';
import { EXIT_EXPECTATION_FAILED, formatVerificationLine, toCliJson } from './verification-output.js';

export type HistoryVerb = 'back' | 'forward' | 'reload';
export type HistoryOutcome = 'moved' | 'edge' | 'unconfirmed' | 'not-moved' | 'reloaded';

/** The verification evidence check family a verb's probe records under. */
const CHECK_PREFIX: Record<Exclude<HistoryVerb, 'reload'>, 'go_back' | 'go_forward'> = { back: 'go_back', forward: 'go_forward' };

/**
 * Classifies a finished history verb from its verification evidence only.
 * - `reload` -> `reloaded` (its Verification line carries the new-document check).
 * - back/forward: edge iff the `<t>.history-edge` check is present; otherwise by the `<t>.history-index` check:
 *   `pass` -> moved, `fail` -> not-moved, `not-run` or absent (probe could not observe: dialog, CDP timeout, no checks at all)
 *   -> unconfirmed.
 */
export function classifyHistoryOutcome(verb: HistoryVerb, verification: VerificationResultDto | undefined): HistoryOutcome {
  if (verb === 'reload') return 'reloaded';
  const t = CHECK_PREFIX[verb];
  const checks = verification?.evidence?.checks ?? [];
  if (checks.some((c) => c.check === `${t}.history-edge`)) return 'edge';
  const idx = checks.find((c) => c.check === `${t}.history-index`);
  if (!idx) return 'unconfirmed';
  if (idx.outcome === 'pass') return 'moved';
  if (idx.outcome === 'fail') return 'not-moved';
  return 'unconfirmed';
}

/** Exit code: edge -> 1 (regardless of `--expect-*`), then a failed expectation -> 4, otherwise 0. */
export function historyExitCode(outcome: HistoryOutcome, verification: VerificationResultDto | undefined, expectGiven: boolean): 0 | 1 | 4 {
  if (outcome === 'edge') return 1;
  if (expectGiven && failedExpectations(verification).length > 0) return EXIT_EXPECTATION_FAILED;
  return 0;
}

export interface HistoryOutcomeLines {
  /** One entry per `console.log` call. */
  stdout: string[];
  /** One entry per `console.error` call. */
  stderr: string[];
  exitCode: number;
  outcome: HistoryOutcome | 'cancelled';
}

const LABEL: Record<Exclude<HistoryVerb, 'reload'>, string> = { back: 'Back', forward: 'Forward' };

/** What a finished (resolved) history verb prints. */
export function historyOutput(
  verb: HistoryVerb,
  result: Pick<NavigateResult, 'url' | 'title' | 'verification'>,
  opts: { jsonMode: boolean; expectGiven: boolean },
): HistoryOutcomeLines {
  const v = result.verification;
  const outcome = classifyHistoryOutcome(verb, v);
  const exitCode = historyExitCode(outcome, v, opts.expectGiven);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const edgeLine = (): string =>
    verb === 'back'
      ? `Back: no history entry to go back to (still on ${result.url})`
      : `Forward: no forward history entry (still on ${result.url})`;

  if (opts.jsonMode) {
    // The same document `nav --json` prints (success:true); the edge line moves to stderr.
    stdout.push(JSON.stringify(toCliJson({ ...result, success: true }), null, 2));
    if (outcome === 'edge') stderr.push(edgeLine());
  } else {
    switch (outcome) {
      case 'edge':
        stdout.push(edgeLine());
        break;
      case 'moved':
        stdout.push(`Navigated ${verb} to ${result.url}`, `Title: ${result.title}`, formatVerificationLine(v));
        break;
      case 'reloaded':
        stdout.push(`Reloaded ${result.url}`, `Title: ${result.title}`, formatVerificationLine(v));
        break;
      case 'unconfirmed': {
        const reason = (v?.reason ?? 'no verification reported').replace(/\s*[\r\n]+\s*/g, ' ');
        stdout.push(`${LABEL[verb as 'back' | 'forward']} requested; the history move could not be confirmed (${reason})`, formatVerificationLine(v));
        break;
      }
      case 'not-moved':
        stdout.push(formatVerificationLine(v));
        break;
    }
  }
  if (exitCode === EXIT_EXPECTATION_FAILED) {
    stderr.push(`Error: expectation failed: ${failedExpectations(v).join(', ')} — ${v?.reason ?? 'no reason reported'}`);
  }
  return { stdout, stderr, exitCode, outcome };
}

/** The slice of the runtime a history verb needs (so a unit test can pass a fake). */
export interface HistoryRuntime {
  goBack(sessionId: string, tabId?: string, expect?: ActionExpectation, settle?: boolean | SettleSpec): Promise<NavigateResult>;
  goForward(sessionId: string, tabId?: string, expect?: ActionExpectation, settle?: boolean | SettleSpec): Promise<NavigateResult>;
  reload(sessionId: string, tabId?: string, expect?: ActionExpectation, settle?: boolean | SettleSpec): Promise<NavigateResult>;
  getDialogHistory(sessionId: string): ReadonlyArray<{ dialogType: string; action?: string; handledAt?: string }>;
  listTabs(sessionId: string): Promise<ReadonlyArray<{ url: string; isActive: boolean }>>;
}

export interface HistoryCommandOptions {
  verb: HistoryVerb;
  expect?: ActionExpectation;
  settle?: boolean | SettleSpec;
  jsonMode: boolean;
  /** Wall-clock ms at which the verb started (the same clock as the dialog history's `handledAt`). */
  startedAt: number;
  /** Poll interval/attempts for the dialog-history detection after a rejection (the dismiss is an async CDP round trip). */
  pollMs?: number;
  pollTries?: number;
}

/**
 * The whole `back | forward | reload` verb minus the printing. A beforeunload dialog dismissed by `--dialog dismiss`
 * cancels the move WITHOUT an `ERR_ABORTED`-style error (S1 spike SP-1: the verb waits for Puppeteer's 30 s navigation
 * timeout, and the dismissed dialog is in the dialog history), so the cancel is detected from the dialog history, after a
 * rejection (polling briefly) and after a resolution. Any other rejection propagates to `main().catch` (`Fatal:`,
 * exit 1, never a "Navigated"/"Reloaded" line).
 */
export async function runHistoryCommand(
  runtime: HistoryRuntime,
  sessionId: string,
  o: HistoryCommandOptions,
): Promise<HistoryOutcomeLines> {
  const cancelled = (): boolean => dismissedBeforeunloadSince(runtime.getDialogHistory(sessionId), o.startedAt);
  const cancelLines = async (knownUrl?: string): Promise<HistoryOutcomeLines> => {
    let url = knownUrl;
    if (!url) {
      try {
        url = (await runtime.listTabs(sessionId)).find((t) => t.isActive)?.url;
      } catch {
        /* best effort: the message below falls back to a generic page name */
      }
    }
    return { stdout: [beforeunloadCancelMessage(url ?? 'the page')], stderr: [], exitCode: 1, outcome: 'cancelled' };
  };

  let result: NavigateResult;
  try {
    result =
      o.verb === 'back'
        ? await runtime.goBack(sessionId, undefined, o.expect, o.settle)
        : o.verb === 'forward'
          ? await runtime.goForward(sessionId, undefined, o.expect, o.settle)
          : await runtime.reload(sessionId, undefined, o.expect, o.settle);
  } catch (err) {
    const tries = o.pollTries ?? 10;
    for (let i = 0; i < tries; i++) {
      if (cancelled()) return cancelLines();
      await new Promise((r) => setTimeout(r, o.pollMs ?? 50));
    }
    throw err;
  }
  if (cancelled()) return cancelLines(result.url);
  return historyOutput(o.verb, result, { jsonMode: o.jsonMode, expectGiven: o.expect !== undefined });
}
