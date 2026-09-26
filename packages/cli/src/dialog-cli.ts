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

/** FR2-04 fix-3/GAP-237, decision point 4: `tabs` is no longer exempt from the gate (it used to
 *  claim "never gated" here, but it still called `runtime.attach()` underneath regardless of
 *  exemption, which hung ~180s against ANY open dialog — see `classifyVerb`'s doc comment). Once
 *  the blocking dialog is actually resolved (via this same hint), `tabs` works normally again —
 *  it just can no longer be used AS the recovery tool for learning a tab id while still blocked.
 *  That's an acceptable trade now that `dialog accept|dismiss` recovers an `unknown` dialog by
 *  identifying and naming the actual holder tab itself (fix-3 points 1+3), which is what `tabs`
 *  was mainly needed for in the first place. */
export const DIALOG_HINT =
  (type: string) =>
    `Hint: a ${type} dialog is open and blocking the page. Run "sutradhar dialog accept [text]" or ` +
    `"sutradhar dialog dismiss", or set a policy with --dialog accept|dismiss. For a dialog type ` +
    `"unknown", that same command identifies and names the specific tab actually holding the ` +
    `dialog and recovers by closing just that tab (never a different, healthy tab it merely shares ` +
    `a browser process with). If nothing else works, "sutradhar close" ends the whole session so ` +
    `you can start a fresh one.`;

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

// FR2-04 fix-3/GAP-237, decision point 4: 'tabs' was exempted here in fix-2 on the theory that it
// is "harmless to run against a dialog-blocked session (it only lists tabs...)" — that theory was
// never actually true: `cmdTabs` goes through the same `withSession`/`withSessionFlow` as every
// other verb, and classifying a verb 'exempt' only skips the GATE step (`runDialogGate`), not the
// `reattach`/`runtime.attach()` step that follows it unconditionally (session-flow.ts:56-59).
// `runtime.attach()` still called `browser.pages()` under the hood, which blocks on ANY
// dialog-blocked renderer for the full ~180s protocol timeout and then silently adopts a fresh
// blank tab (audit-3, GAP-237: 3/3 at a 250s cap). Decision point 4 offered two fixes — gate
// `tabs` fully (simplest, safest), or give it its own browser-level-only path that never attaches
// — and this cycle takes the simplest one: `tabs` is now a normal 'guarded' verb, gated exactly
// like `snap`/`click`/etc. It stops being useful AS a recovery tool while a dialog is still open,
// but fix-3 points 1+3 remove the reason it was needed for that: `dialog accept|dismiss` now
// identifies and names the actual holder tab itself, rather than requiring `tabs` to learn its id
// first.
const EXEMPT_VERBS = new Set(['dialog', 'doctor', 'profile', 'sessions', 'close', '__dialog-warden']);
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
  /** FR2-04 fix-3/GAP-236, decision point 1: set when this entry is not itself a dialog holder
   *  but is only reported because it's collaterally blocked by sharing a renderer with another
   *  target (that target's id). See `ObservedDialog.blockedBy`'s doc comment (dialog-cdp.ts) for
   *  the full reasoning — mirrored here so pure CLI-side code (`selectDialog`, `runDialogGate`)
   *  never needs to import from `@sutradhar/browser` just to check this. */
  readonly blockedBy?: string;
}

/** FIFO selection (§2.9/D-8): the OLDEST pending dialog by `openedAt`, plus the rest.
 *
 * FR2-04 fix-3/GAP-236, decision point 1: a collaterally-blocked entry (`blockedBy` set — it has
 * no dialog of its own, it's just unresponsive because it shares a renderer with the actual
 * holder) is never eligible to be selected as "the" dialog `sutradhar dialog accept|dismiss` acts
 * on — accepting/dismissing it would either 404 (nothing to resolve there) or, worse, recover by
 * closing the wrong tab (exactly GAP-236). Filtered out before the FIFO sort so a real holder
 * that opened slightly later than a collateral entry is still preferred over it; `rest` still
 * includes any collateral entries so callers can report them as informational context. */
export function selectDialog<T extends PendingDialogEntry>(pending: readonly T[]): { target: T | undefined; rest: T[] } {
  if (pending.length === 0) return { target: undefined, rest: [] };
  const sorted = [...pending].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const target = sorted.find((d) => !d.blockedBy);
  if (!target) return { target: undefined, rest: sorted };
  return { target, rest: sorted.filter((d) => d !== target) };
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
 * spuriously pre-empts a normal command. A rejection from `work` propagates as this function's
 * own rejection, same as a plain `await work` would.
 *
 * FR2-04 fix-3, decision point 8: audit-3 measured +129-159ms of per-command overhead versus
 * master and traced essentially all of it (the gate itself costs ~2.6ms) to THIS function's own
 * poll timer. The root cause: `work` resolving and winning `Promise.race` below does not cancel
 * the `dialogWatch` loop's in-flight `setTimeout(pollMs)` — that timer is still ref'd, so once
 * `main()` reaches its own teardown, Node's event loop cannot go idle (and the watchdog/force-exit
 * timers are already `unref()`'d, so nothing else masks this) until that ~100ms timer actually
 * fires and the loop notices `stopped` and returns. `cancellableDelay` keeps a handle to its own
 * timer so the `finally` below can `clearTimeout` it THE MOMENT the race settles, and `unref()`s
 * it too as defense in depth (a scheduling hiccup between "the race settled" and "the finally ran"
 * should never be able to hold the process open even a few extra ms).
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
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  const cancellableDelay = (ms: number) =>
    new Promise<void>((resolve) => {
      pendingTimer = setTimeout(() => {
        pendingTimer = undefined;
        resolve();
      }, ms);
      pendingTimer.unref?.();
    });

  const dialogWatch: Promise<RaceResult<T>> = (async () => {
    while (!stopped) {
      await cancellableDelay(pollMs);
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
    if (pendingTimer !== undefined) {
      clearTimeout(pendingTimer);
      pendingTimer = undefined;
    }
  }
}

/** A dialog the gate's own policy already resolved (accept/dismiss) before it hit whatever
 *  condition made it block anyway (a chain limit, a probe timeout) — see `DialogBlockedError`'s
 *  `handledRecords` for why this needs to survive the throw. */
export interface GateHandledRecord {
  readonly dialog: PendingDialogEntry;
  readonly action: 'accept' | 'dismiss';
  readonly promptText?: string;
}

export class DialogBlockedError extends Error {
  public readonly name = 'DialogBlockedError';
  public readonly exitCode = 3;
  public readonly dialogs: readonly PendingDialogEntry[];
  public readonly kind: 'blocked' | 'preempted';
  /** FR2-04 fix-3/GAP-242: dialogs the gate's own policy already handled in an earlier round of
   *  the SAME gate run before it decided to block/throw (e.g. a chain that hit its round limit
   *  with 4 of 5 dialogs already resolved) — dropped entirely by fix-2, so a caller had no way to
   *  know those 4 were ever handled. Carried on the error so `main().catch` can still print
   *  `dialogHandled:` lines for them before reporting the block, instead of silently discarding
   *  real, already-completed work. */
  public readonly handledRecords: readonly GateHandledRecord[];

  public constructor(
    verb: string | undefined,
    dialogs: readonly PendingDialogEntry[],
    kind: 'blocked' | 'preempted',
    extra?: string,
    handledRecords: readonly GateHandledRecord[] = [],
  ) {
    const first = dialogs[0];
    const type = first?.dialogType ?? 'unknown';
    const base =
      kind === 'blocked'
        ? `a ${type} dialog is open and blocking the page, so "${verb}" did not run.`
        : `a ${type} dialog opened while "${verb}" was running and is blocking the page; "${verb}" did not complete (it may have partially run).`;
    super(extra ? `${base} ${extra}` : base);
    this.dialogs = dialogs;
    this.kind = kind;
    this.handledRecords = handledRecords;
  }

  public stdoutLines(): string[] {
    return this.dialogs.map((d) =>
      formatDialogPending({ type: d.dialogType, message: d.message, defaultValue: undefined, url: d.url }),
    );
  }

  /** GAP-242: the `dialogHandled:` lines for whatever this gate run resolved before it blocked —
   *  print these BEFORE `stdoutLines()`'s pending lines, same order a fully-successful gate run
   *  would have printed them in (`withSession`'s own `result.status === 'handled'` branch). */
  public handledStdoutLines(): string[] {
    return this.handledRecords.map((r) =>
      formatDialogHandled({
        type: r.dialog.dialogType,
        message: r.dialog.message,
        action: r.action,
        promptText: r.promptText,
        by: 'policy',
      }),
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
