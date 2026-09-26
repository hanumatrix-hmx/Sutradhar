/**
 * @file packages/cli/src/dialog-cli.ts
 * @description FR2-04: pure (no I/O, no CDP, no fs) CLI-side dialog logic — policy resolution,
 * output formatting, verb classification, dialog selection/racing and timing. Split out from
 * cli.ts/dialog-broker.ts the same way parse-args.ts is, so it's unit-testable without spawning
 * a runtime or touching a real CliState file.
 */
import type { CliState } from './state.js';

export type DialogPolicyMode = 'auto' | 'report' | 'accept' | 'dismiss';

export interface ResolvedDialogPolicy {
  readonly policy: { mode: DialogPolicyMode; promptText?: string };
  readonly persist: 'set' | 'keep';
}

/**
 * Precedence (spec §2.8.1, amended by FR2-14's D10 fold-in — decisions.md 2026-09-26): flag >
 * `state.dialogPolicy` > `{mode:'report'}` (the CLI's own default — NOT `'auto'`, which is the
 * runtime/MCP/SDK default; see D-2).
 *
 * **D10 (corrected):** `--dialog report` PERSISTS, exactly like `--dialog accept|dismiss` — it
 * does NOT clear the persisted policy. `CliState.dialogPolicy.action` is `'accept'|'dismiss'|
 * 'report'`. This means a persisted `'report'` is never silently overridden back to some other
 * policy by a later command that passes no `--dialog` flag at all (FR2-14 DC2) — the state's own
 * `existing` branch below is what carries it forward on every no-flag command.
 */
export function resolveDialogPolicy(
  dialogFlag: 'accept' | 'dismiss' | 'report' | undefined,
  dialogTextFlag: string | undefined,
  state: Pick<CliState, 'dialogPolicy'> | undefined,
): ResolvedDialogPolicy {
  if (dialogFlag === 'accept' || dialogFlag === 'dismiss') {
    return { policy: { mode: dialogFlag, promptText: dialogTextFlag }, persist: 'set' };
  }
  if (dialogFlag === 'report') {
    return { policy: { mode: 'report' }, persist: 'set' };
  }
  const existing = state?.dialogPolicy;
  if (existing) {
    return { policy: { mode: existing.action, promptText: existing.promptText }, persist: 'keep' };
  }
  return { policy: { mode: 'report' }, persist: 'keep' };
}

export interface DialogLike {
  readonly type: string;
  readonly message: string;
  readonly defaultValue?: string | null;
  readonly url: string;
}

/** Exact §2.8.5 stdout line for a still-open dialog. Key order is fixed: type, message,
 *  defaultValue, url. */
export function formatDialogPending(d: DialogLike): string {
  return `dialogPending: ${JSON.stringify({
    type: d.type,
    message: d.message,
    defaultValue: d.defaultValue ?? null,
    url: d.url,
  })}`;
}

export interface DialogHandledLike {
  readonly type: string;
  readonly message: string;
  readonly action: 'accept' | 'dismiss';
  readonly promptText?: string | null;
  readonly by: 'policy' | 'caller' | 'cli-exit';
}

/** Exact §2.8.5 stdout line for a dialog handled during the command. Key order is fixed: type,
 *  message, action, promptText, by. */
export function formatDialogHandled(d: DialogHandledLike): string {
  return `dialogHandled: ${JSON.stringify({
    type: d.type,
    message: d.message,
    action: d.action,
    promptText: d.promptText ?? null,
    by: d.by,
  })}`;
}

export const DIALOG_HINT =
  (type: string) =>
    `Hint: a ${type} dialog is open and blocking the page. Run "sutradhar dialog accept [text]" or ` +
    `"sutradhar dialog dismiss", or set a policy with --dialog accept|dismiss. For a dialog type ` +
    `"unknown", that same command now recovers by closing the affected tab (GAP-230) — run ` +
    `"sutradhar tabs" (never gated) afterwards to confirm, or "sutradhar closetab <tabId>" directly. ` +
    `If nothing else works, "sutradhar close" ends the whole session so you can start a fresh one.`;

export function beforeunloadCancelMessage(url: string): string {
  return (
    `Navigate failed: the page's beforeunload dialog was dismissed (--dialog dismiss is in effect), ` +
    `so the navigation to ${url} was cancelled. Use --dialog accept to leave pages that ask for confirmation.`
  );
}

/** True only for an `ERR_ABORTED`-shaped navigation error combined with a beforeunload the
 *  policy dismissed at or after `since` — distinguishes "cancelled by our own dismiss policy"
 *  from any other reason a navigation might abort. */
export function isBeforeunloadCancel(
  err: unknown,
  history: ReadonlyArray<{ dialogType: string; action?: string; handledAt?: string }>,
  since: number,
): boolean {
  const message = String((err as { message?: unknown })?.message ?? err);
  if (!/ERR_ABORTED/.test(message)) return false;
  return history.some(
    (h) => h.dialogType === 'beforeunload' && h.action === 'dismiss' && h.handledAt && Date.parse(h.handledAt) >= since,
  );
}

export type VerbClass = 'exempt' | 'trigger' | 'guarded';

// GAP-230 (fix-2): 'tabs' must never be gated — it is the only way to learn a tab's id when
// `dialog accept|dismiss` can't address it directly (an `unknown` dialog before fix-2's
// Target.closeTarget recovery existed at all), and it is harmless to run against a
// dialog-blocked session (it only lists tabs, via the same browser-level info the gate itself
// uses — no attach/page interaction that could hang).
const EXEMPT_VERBS = new Set(['dialog', 'doctor', 'profile', 'sessions', 'close', 'tabs', '__dialog-warden']);
const TRIGGER_VERBS = new Set(['click', 'clicktext', 'clickrole', 'clickpoint']);

/** Classifies a verb per spec §2.10. Help/no-verb (`undefined`) is exempt; any unknown/unlisted
 *  verb defaults to `'guarded'` (safer default: the gate still runs). */
export function classifyVerb(verb: string | undefined): VerbClass {
  if (verb === undefined || EXEMPT_VERBS.has(verb)) return 'exempt';
  if (TRIGGER_VERBS.has(verb)) return 'trigger';
  return 'guarded';
}

export const PREEMPT_GRACE_MS = 250;
export const TRIGGER_PREEMPT_GRACE_MS = 4000;
export const GATE_CONNECT_TIMEOUT_MS = 5000;
export const GATE_LISTEN_MS = 400;
export const LIVENESS_TIMEOUT_MS = 1000;
export const HANDLE_TIMEOUT_MS = 5000;
export const VERIFY_UNBLOCK_MS = 2000;

export interface PendingDialogEntry {
  readonly targetId?: string;
  readonly tabId?: string;
  readonly dialogType: string;
  readonly message: string;
  readonly defaultValue?: string;
  readonly url: string;
  readonly openedAt: string;
  /** GAP-223: the warden's per-instance dialog identity (see `ObservedDialog.id`), threaded
   *  through so a later `handle()` call can ask the warden to verify it's still acting on the
   *  same dialog it listed. `undefined` for anything not warden-sourced (e.g. `DirectCdpBroker`),
   *  which has no persistent identity to protect in the first place. */
  readonly dialogId?: string;
}

/** FIFO selection (§2.9/D-8): the OLDEST pending dialog by `openedAt`, plus the rest. */
export function selectDialog<T extends PendingDialogEntry>(pending: readonly T[]): { target: T | undefined; rest: T[] } {
  if (pending.length === 0) return { target: undefined, rest: [] };
  const sorted = [...pending].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const [target, ...rest] = sorted;
  return { target, rest };
}

export type RaceResult<T> = { kind: 'done'; value: T } | { kind: 'dialog'; pending: PendingDialogEntry[] };

export interface RaceWithDialogOptions {
  readonly graceMs: number;
  readonly pollMs?: number;
  readonly ignoreTypes?: readonly string[];
}

/**
 * Races `work` against a poll of `pollPending()` (spec §2.8.4). Resolves `{kind:'dialog'}` only
 * once a non-ignored dialog has been CONTINUOUSLY pending for `graceMs` — a dialog the policy
 * clears inside the grace window doesn't count, so a policy that resolves dialogs quickly never
 * spuriously pre-empts a normal command.
 */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Races `work` against a poll of `pollPending()` (spec §2.8.4). Resolves `{kind:'dialog'}` only
 * once a non-ignored dialog has been CONTINUOUSLY pending for `graceMs` — a dialog the policy
 * clears inside the grace window doesn't count, so a policy that resolves dialogs quickly never
 * spuriously pre-empts a normal command. A rejection from `work` propagates as this function's
 * own rejection, same as a plain `await work` would.
 */
export async function raceWithDialog<T>(
  work: Promise<T>,
  pollPending: () => PendingDialogEntry[] | Promise<PendingDialogEntry[]>,
  options: RaceWithDialogOptions,
): Promise<RaceResult<T>> {
  const pollMs = options.pollMs ?? 100;
  const ignore = new Set(options.ignoreTypes ?? []);
  let stopped = false;
  let firstSeenAt: number | undefined;

  const dialogWatch: Promise<RaceResult<T>> = (async () => {
    while (!stopped) {
      await delay(pollMs);
      if (stopped) break;
      const all = await pollPending();
      const relevant = all.filter((d) => !ignore.has(d.dialogType));
      if (relevant.length === 0) {
        firstSeenAt = undefined;
        continue;
      }
      if (firstSeenAt === undefined) firstSeenAt = Date.now();
      if (Date.now() - firstSeenAt >= options.graceMs) {
        return { kind: 'dialog', pending: relevant };
      }
    }
    return new Promise<RaceResult<T>>(() => {}); // never resolves — 'done' already won
  })();

  const doneWatch: Promise<RaceResult<T>> = work.then((value) => ({ kind: 'done', value }) as const);

  try {
    return await Promise.race([doneWatch, dialogWatch]);
  } finally {
    stopped = true;
  }
}

export class DialogBlockedError extends Error {
  public readonly name = 'DialogBlockedError';
  public readonly exitCode = 3;
  public readonly dialogs: readonly PendingDialogEntry[];
  public readonly kind: 'blocked' | 'preempted';

  public constructor(verb: string | undefined, dialogs: readonly PendingDialogEntry[], kind: 'blocked' | 'preempted', extra?: string) {
    const first = dialogs[0];
    const type = first?.dialogType ?? 'unknown';
    const base =
      kind === 'blocked'
        ? `a ${type} dialog is open and blocking the page, so "${verb}" did not run.`
        : `a ${type} dialog opened while "${verb}" was running and is blocking the page; "${verb}" did not complete (it may have partially run).`;
    super(extra ? `${base} ${extra}` : base);
    this.dialogs = dialogs;
    this.kind = kind;
  }

  public stdoutLines(): string[] {
    return this.dialogs.map((d) =>
      formatDialogPending({ type: d.dialogType, message: d.message, defaultValue: undefined, url: d.url }),
    );
  }
}

export interface DeadlineEnv {
  readonly SUTRADHAR_CLI_DEADLINE_MS?: string;
}

export const DEFAULT_CLI_DEADLINE_MS = 300_000;

/** The CLI process watchdog's deadline (§2.8.6). `wait <ref> <timeoutMs>`'s own timeout can
 *  legitimately exceed the default budget, so its deadline scales with it. */
export function deadlineFor(verb: string | undefined, cleanArgs: readonly string[], env: DeadlineEnv): number {
  let base = DEFAULT_CLI_DEADLINE_MS;
  const override = env.SUTRADHAR_CLI_DEADLINE_MS;
  if (override !== undefined) {
    const n = Number(override);
    if (Number.isFinite(n) && n > 0) base = n;
  }
  if (verb === 'wait') {
    const t = Number(cleanArgs[1]);
    if (Number.isFinite(t) && t > 0) {
      return Math.max(base, 3 * t + 30_000);
    }
  }
  return base;
}
