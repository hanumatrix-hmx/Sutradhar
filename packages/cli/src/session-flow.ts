/**
 * @file packages/cli/src/session-flow.ts
 * @description FR2-04: `withSession`'s control flow extracted out of cli.ts, with every I/O step
 * injected, so the GAP-006 fix (closing the self-heal `try` around `fn()`) is unit-testable
 * without a real runtime/Chrome. GAP-006: today's `cli.ts` runs the caller's `fn()` INSIDE the
 * same `try` that self-heals a dead previous session — so a genuine mid-command failure (a
 * selector that doesn't match, a page that throws) is indistinguishable from "the session is
 * dead" and triggers exactly the same "kill Chrome, respawn, retry" response, which is both
 * surprising (the caller's error silently vanishes and gets replaced with a fresh, unrelated
 * run) and, per FR2-04's own §D-6, actively unsafe once dialogs are in play (a dialog easily
 * raises the rate of `fn()` throwing for reasons that have nothing to do with the session being
 * dead — e.g. a `DialogBlockedError` from inside a nested `withSessionFlow` call, or a timer
 * dialog interrupting an `eval`). This module fixes it structurally: `fn()` runs OUTSIDE
 * `runGuarded`'s own try/self-heal boundary by construction — see `withSessionFlow`'s body.
 */

/**
 * I-051: raised when a command that cannot start a browser finds no session. `main().catch` matches it by `name` (the
 * `ProjectConfigError` pattern) and prints exactly `Error: <message>`, exit 1, nothing on stdout.
 */
export class NoSessionError extends Error {
  public constructor(verb: string | undefined) {
    super(noSessionMessage(verb));
    this.name = 'NoSessionError';
  }
}

/** The one-line explanation printed (after `Error: `) when a non-launching verb finds no session. */
export function noSessionMessage(verb: string | undefined): string {
  return `no active browser session \u2014 "${verb ?? ''}" needs an open page and does not start one. Start a session with: sutradhar nav <url>`;
}

/**
 * I-051: may this invocation start a browser when none is running? Only `nav <url>`, `newtab <url>`, `audit <url>` and
 * `compare <urlA> <urlB>` (every one of them names a page to open). Everything else — snap, text, click, back, tabs, grant,
 * newtab/audit without a url, ... — reads or acts on an existing page and must not silently launch a blank browser.
 * `args` are the verb's positional arguments (flags already removed).
 */
export function isLaunchCapable(verb: string | undefined, args: readonly (string | undefined)[]): boolean {
  const given = (i: number): boolean => typeof args[i] === 'string' && args[i]!.length > 0;
  switch (verb) {
    case 'nav':
    case 'newtab':
    case 'audit':
      return given(0);
    case 'compare':
      return given(0) && given(1);
    default:
      return false;
  }
}

export interface SessionFlowDeps<T> {
  /** I-051: when there is NO prior state, may this command start a browser? `false` -> `noSession()` is thrown instead. */
  readonly mayLaunch: boolean;
  /** I-051: the error thrown when there is no prior state and `mayLaunch` is false (a `NoSessionError`). */
  readonly noSession: () => Error;
  /** Reads persisted CLI state; `undefined` means "no prior session". */
  readonly readState: () => Promise<unknown>;
  /** No prior state: spawns a brand-new session and returns its id. */
  readonly spawnFresh: () => Promise<string>;
  /** Prior state exists: the gate (FR2-04 §2.8.2). May throw `DialogBlockedError` — nothing else
   *  is a valid throw from this step. Never called when there's no prior state (a fresh spawn
   *  has nothing to gate). */
  readonly gate: (state: unknown) => Promise<void>;
  /** Reattach to the prior session (attach + grants + focusTab + viewport + persist — today's
   *  cli.ts:99-120). Throws on a dead/unreachable session. */
  readonly reattach: (state: unknown) => Promise<string>;
  /** `reattach` threw: FR2-03's release/kill + clearState + spawnFresh (carrying dialogPolicy),
   *  same shape as today's inline self-heal block. Returns the healed session id. */
  readonly selfHeal: (state: unknown, err: unknown) => Promise<string>;
  /** Runs once a session id is settled, whether via spawnFresh, reattach, or selfHeal — persists
   *  the effective dialog policy, and (Branch W) ensures the warden. `isFreshSpawn` distinguishes
   *  the "no prior state" path (today's cli.ts never re-persists anything extra there beyond
   *  spawnFreshSession's own write) from a reattach/self-heal path. */
  readonly afterAttach: (sessionId: string, isFreshSpawn: boolean) => Promise<void>;
  /** The command body. Runs OUTSIDE the self-heal boundary — see the file header (GAP-006). */
  readonly fn: (sessionId: string) => Promise<T>;
}

/**
 * FR2-04 §2.8.3's `withSessionFlow`. Order (session-flow.spec.ts W5): `readState` < `gate` <
 * `reattach` (or `spawnFresh`) < `afterAttach` < `fn`. `fn`'s own errors never trigger
 * `selfHeal` (W3) — only `reattach`'s do.
 */
export async function withSessionFlow<T>(deps: SessionFlowDeps<T>): Promise<T> {
  const state = await deps.readState();

  let sessionId: string;
  if (!state) {
    if (!deps.mayLaunch) throw deps.noSession(); // I-051: BEFORE spawnFresh/afterAttach/fn — nothing is launched or written
    sessionId = await deps.spawnFresh();
    await deps.afterAttach(sessionId, true);
    return deps.fn(sessionId);
  }

  await deps.gate(state); // may throw DialogBlockedError — propagates untouched, fn() never runs

  try {
    sessionId = await deps.reattach(state);
  } catch (err) {
    sessionId = await deps.selfHeal(state, err);
  }

  await deps.afterAttach(sessionId, false);
  return deps.fn(sessionId); // OUTSIDE the try above — fn()'s errors never self-heal (GAP-006)
}
