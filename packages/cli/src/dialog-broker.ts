/**
 * @file packages/cli/src/dialog-broker.ts
 * @description FR2-04: the "gate" — runs before `runtime.attach` on every non-exempt CLI verb to
 * detect and (per policy) handle a dialog an EARLIER, already-exited CLI process left open.
 * Branch W (Step 1's D-7 decision, decisions.md 2026-09-26): tries the warden first (it can both
 * see AND handle an orphaned dialog — Step 1 O8), falling back to a direct raw-CDP connection
 * (`DirectCdpBroker`, dialog-cdp.ts) when the warden is unavailable — degraded (detection only
 * for a truly orphaned dialog, per Step 1 O1/O2 both false) but never fatal: `status:'unknown'`
 * lets `withSessionFlow`'s normal attach (and its existing self-heal) proceed exactly as before
 * FR2-04 existed.
 */
import {
  connectForDialogs,
  listPageTargets,
  livenessProbe,
  handleDialogOnTarget,
  attributeDialogHolders,
  probeTargetsConcurrently,
} from '@sutradhar/browser';
import type { DialogPolicy } from '@sutradhar/browser';
import {
  DialogBlockedError,
  GATE_CONNECT_TIMEOUT_MS,
  LIVENESS_TIMEOUT_MS,
  HANDLE_TIMEOUT_MS,
  type PendingDialogEntry,
  type GateHandledRecord,
} from './dialog-cli.js';

export type BrokerDialog = PendingDialogEntry;

/** GAP-230: `handle()`'s outcome beyond "it worked" — set when the target was closed as a
 *  recovery path for an unknown dialog rather than actually resolved via
 *  `Page.handleJavaScriptDialog`, so the caller can report what really happened.
 *
 *  FR2-04 fix-3/GAP-236, decision point 3: `redirectTo`/`redirectUrl` are set instead of
 *  `closedTarget` when the requested target turned out to be only collaterally blocked by
 *  sharing a renderer with the ACTUAL holder — the broker refuses to close it and names the real
 *  holder so the caller can report which tab it should have asked about, rather than silently
 *  acting on the wrong one. */
export interface HandleOutcome {
  readonly closedTarget?: boolean;
  readonly message?: string;
  readonly redirectTo?: string;
  readonly redirectUrl?: string;
  /** FR2-04 escalation-1 (GAP-245/246/247), replaces fix-3's `isolated` flag: set whenever
   *  recovery deliberately declined to close the target rather than guess — either because its
   *  OWN history proves it cannot be a dialog holder (decision 1/2: `attributeDialogHolders`'s
   *  `confirmedSafe`), or because the broker has no history at all to ground an attribution in
   *  (decision 3: `DirectCdpBroker` with the warden down — see its doc comment for GAP-247). Either
   *  way, `message` explains why and always points at `sutradhar close` as the fallback escape. */
  readonly refused?: boolean;
}

/** FR2-04 fix-3, decision point 5 (GAP-239/GAP-241): `list()`'s "the browser/warden couldn't be
 *  reached at all" result now distinguishes WHY, because the gate must react differently:
 *  - no `reason` (or `'unreachable'`): connect failed outright — nothing to gate against, the
 *    caller falls through to the normal attach path (which may itself self-heal a dead session).
 *    This is the ORIGINAL, backward-compatible meaning of `status:'unknown'`.
 *  - `reason: 'timeout'`: the browser/warden WAS reachable, but the dialog check itself couldn't
 *    finish before the caller's own wait cap — decision point 5 requires failing CLOSED here
 *    (block, exit 3, type unknown) rather than the old behavior of treating any `'unknown'` the
 *    same as "nothing to worry about".
 */
export type ListStatus =
  | { status: 'ok'; dialogs: BrokerDialog[]; busy: string[] }
  | { status: 'unknown'; reason?: 'unreachable' | 'timeout' };

export interface DialogBroker {
  /** Every dialog currently open across the session's tabs — see {@link ListStatus}. */
  list(): Promise<ListStatus>;
  /** `dialogId`, when known (warden-sourced dialogs — GAP-223), lets the broker refuse to apply
   *  this decision to a dialog that isn't the exact one it was made about any more. */
  handle(targetId: string, accept: boolean, promptText: string | undefined, dialogId?: string): Promise<HandleOutcome | void>;
  /** Releases whatever connection `list()`/`handle()` opened (R-E: every gate path must
   *  disconnect its own connection, even on an exception). Idempotent. */
  dispose(): Promise<void>;
}

/**
 * Branch W's degraded fallback, used only when the warden is unreachable (spec §2.8.2 point 1):
 * talks straight to Chrome over CDP. Step 1 established a FRESH connection can neither see
 * (O1 false) nor handle (O2 false) an orphaned dialog on its own, so this broker cannot tell a
 * genuinely-blocked-by-a-dialog target apart from one merely running a slow script.
 *
 * **Precise fallback semantics (fixed after an initial "report busy, don't block" version was
 * found unsafe):** a blocked target whose URL matches `lastPendingDialog` is reported as that
 * dialog (D-hint-style, real type/message). A blocked target with **no** hint is reported as an
 * `{type:'unknown', message:''}` dialog too — NOT silently classified as merely "busy" — because
 * letting the gate return `clear` here would let `runtime.attach()` proceed straight into the
 * exact hang/GAP-017 risk this whole item exists to close: `findAllOpenPages` blocks until
 * `protocolTimeout` (180s) against a truly dialog-blocked page, and on that timeout it silently
 * adopts a NEW blank tab (GAP-017) instead of throwing. Reporting `unknown` makes the gate BLOCK
 * (`DialogBlockedError`, exit 3, honest and immediate) instead — the user sees a clear, honest
 * "something is blocking the page" message instead of a silent 180s hang ending in the wrong
 * tab. The real trade-off this accepts: with the warden down, a page merely running a long
 * script (not an actual dialog) is ALSO reported as `unknown` and blocks the command — safe-but-
 * conservative, and only in this already-degraded (warden-down) fallback path; the normal,
 * warden-healthy path (WardenBroker) never has this ambiguity, because it tracks real
 * `Page.javascriptDialogOpening` events rather than inferring from liveness alone. See the live
 * case "warden killed, then a dialog opens, then a command runs" in
 * tools/scenario-suite/verify-fr2-04-dialogs.mjs for the end-to-end proof of both halves (no
 * hang, no silent wrong-tab action). */
export class DirectCdpBroker implements DialogBroker {
  private browser: Awaited<ReturnType<typeof connectForDialogs>> | undefined;
  private disposed = false;

  public constructor(
    private readonly wsEndpoint: string,
    private readonly hint?: { type: string; message: string; url: string; openedAt: string; defaultValue?: string },
  ) {}

  /** FR2-04 fix-3, decision point 5 (GAP-241): an overall ceiling on ONE `list()` round, on top of
   *  every individual probe's own `LIVENESS_TIMEOUT_MS` budget — pure defense in depth (parallel
   *  probing already bounds the normal case to roughly one probe's own timeout regardless of tab
   *  count), so a `list()` call can never itself hang the gate past this even under some
   *  unforeseen CDP scheduling pathology. Exceeding it fails CLOSED (`reason:'timeout'`), never
   *  open. */
  private static readonly PROBE_ROUND_CAP_MS = LIVENESS_TIMEOUT_MS + 1500;

  public async list(): ReturnType<DialogBroker['list']> {
    const browser = await connectForDialogs(this.wsEndpoint, GATE_CONNECT_TIMEOUT_MS);
    if (!browser) return { status: 'unknown', reason: 'unreachable' };
    this.browser = browser;
    const candidates = listPageTargets(browser);
    type Candidate = (typeof candidates)[number];
    const sessions = new Map<string, Awaited<ReturnType<Candidate['target']['createCDPSession']>>>();
    await Promise.all(
      candidates.map(async ({ info, target }) => {
        try {
          sessions.set(info.targetId, await target.createCDPSession());
        } catch {
          // target gone between listing and attach — nothing to probe
        }
      }),
    );
    const probeable = candidates.filter(({ info }) => sessions.has(info.targetId));

    let states: Map<string, Awaited<ReturnType<typeof livenessProbe>>>;
    try {
      states = await Promise.race([
        probeTargetsConcurrently(
          probeable.map(({ info }) => ({ targetId: info.targetId })),
          (entry) => livenessProbe(sessions.get(entry.targetId)!, LIVENESS_TIMEOUT_MS),
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('probe round exceeded its cap')), DirectCdpBroker.PROBE_ROUND_CAP_MS),
        ),
      ]);
    } catch {
      // GAP-241/decision point 5: the probe round itself didn't finish in time — fail CLOSED
      // (the gate blocks, exit 3, type unknown) rather than the old blanket "unknown -> clear".
      return { status: 'unknown', reason: 'timeout' };
    }

    const dialogs: BrokerDialog[] = [];
    const busy: string[] = [];
    // FR2-04 escalation-1, decision 3 (GAP-247): `DirectCdpBroker` is only ever used while the
    // warden is unreachable, which means it has NO per-target history at all — every candidate here
    // is passed with `confirmedSafe: false` (unconditionally "never confirmed"), so the attribution
    // below degrades to exactly fix-3's topology-only guess (newest-leaf). That guess is UNSOUND in
    // this mode specifically because there is no guarantee every older target was tracked
    // continuously from before the dialog opened (see `attributeDialogHolders`'s doc comment) — so
    // this `blockedBy`/holder split is used for LISTING/messaging only. `handle()` below never acts
    // on it to close anything; recovery is refused outright in this mode (decision 3(a): the
    // smaller, provably-safe half of the two options decisions.md offered).
    const blockedInfos = probeable
      .filter(({ info }) => states.get(info.targetId) === 'blocked')
      .map(({ info }) => ({ targetId: info.targetId, openerTargetId: info.openerTargetId }));
    // FR2-04 escalation-2 (GAP-252): same fix as `DialogWarden.listWithLiveness` — pass every
    // known target (blocked or not) so two blocked siblings sharing an UNBLOCKED opener still get
    // attributed against each other instead of each becoming an independent "holder". This mode has
    // no tracking history at all (see the class doc comment), so the resulting `blockedBy` split is
    // still listing/messaging-only here — `handle()` below never acts on it to close anything.
    const attribution = attributeDialogHolders(blockedInfos, candidates.map(({ info }) => ({ targetId: info.targetId, openerTargetId: info.openerTargetId })));
    for (const { info } of probeable) {
      const state = states.get(info.targetId);
      if (state !== 'blocked') continue;
      if (this.hint && this.hint.url === info.url) {
        dialogs.push({
          targetId: info.targetId,
          dialogType: this.hint.type,
          message: this.hint.message,
          defaultValue: this.hint.defaultValue,
          url: info.url,
          openedAt: this.hint.openedAt,
          // FR2-04 escalation-2 (GAP-254): marked even on a hint-matched (real type/message)
          // entry — `handle()` below still tries `Page.handleJavaScriptDialog` first for these, but
          // falls back to the same no-warden refusal path as any other entry if that fails.
          wardenDown: true,
        });
      } else {
        // No hint to identify what's blocking this target — report it as an unknown dialog
        // (never silently "clear") so the gate blocks rather than letting attach() risk the
        // 180s hang / GAP-017 blank-tab adoption. See this class's doc comment.
        busy.push(info.targetId);
        dialogs.push({
          targetId: info.targetId,
          dialogType: 'unknown',
          message: '',
          url: info.url,
          openedAt: new Date().toISOString(),
          blockedBy: attribution.get(info.targetId)?.blockedBy,
          wardenDown: true,
        });
      }
    }
    return { status: 'ok', dialogs, busy };
  }

  public async handle(targetId: string, accept: boolean, promptText: string | undefined): Promise<HandleOutcome | void> {
    // GAP-222: `handle()` must work even when `list()` was never called first — `sutradhar
    // dialog accept|dismiss` builds a fresh broker and calls `handle()` directly (cli.ts
    // `cmdDialog`), with no `list()` in between. Connect lazily here instead of requiring the
    // caller to have listed first.
    if (!this.browser) {
      const browser = await connectForDialogs(this.wsEndpoint, GATE_CONNECT_TIMEOUT_MS);
      if (!browser) throw new Error('could not reach the browser to handle the dialog.');
      this.browser = browser;
    }
    const entry = listPageTargets(this.browser).find(({ info }) => info.targetId === targetId);
    if (!entry) throw new Error('No dialog is open on that tab');
    const session = await entry.target.createCDPSession();
    try {
      await handleDialogOnTarget(session, accept, promptText, HANDLE_TIMEOUT_MS);
    } catch (err) {
      // GAP-230: this fallback path has no persistent dialog identity to check (it's a live,
      // single-shot CDP read every time), so an `unknown`-typed target (state:'blocked', no hint)
      // reaching here means `Page.handleJavaScriptDialog` really has nothing to resolve. Recover
      // the same way the warden does: close the target at the browser level instead of dead-
      // ending — re-probe first so a target that cleared on its own between `list()` and this
      // call is never closed unnecessarily.
      const state = await livenessProbe(session, LIVENESS_TIMEOUT_MS).catch(() => 'error' as const);
      if (state === 'responsive') throw err;

      // FR2-04 escalation-1, decision 3 (GAP-247): audit-4's A4-01 measured the OLD behavior here
      // (re-check attribution, then close whatever it named as "the holder") closing the WRONG,
      // innocent tab first for a dialog on the opener (3/3) or the middle of a 3-target chain
      // (3/3), and 1/3 for the older of two siblings — only 0/3 (the newest-sibling shape) was ever
      // correct. The root cause: `DirectCdpBroker` only exists because the warden is unreachable,
      // so it has NO per-target history (`confirmedSafe`) at all — the "newest target holds it"
      // premise is sound ONLY when every older target was tracked continuously from before the
      // dialog opened (see `attributeDialogHolders`'s doc comment), a guarantee that does not hold
      // here. Rather than guess and risk closing an innocent tab, refuse ALL destructive recovery
      // in this degraded mode — decision 3's smaller, provably-safe option ("refuse recovery and
      // point at close"), proven live against all three of audit-4's warden-down attribution
      // attacks (opener-held, chain-middle, older-sibling): zero closes, by construction, in every
      // shape, not just the ones actually tried.
      const relisted = await this.list();
      const mine = relisted.status === 'ok' ? relisted.dialogs.find((d) => d.targetId === targetId) : undefined;
      if (mine?.blockedBy) {
        // Still useful as a HINT even in degraded mode (informational only — not acted on): the
        // gate's own topology guess names a candidate, but the guess itself is what's unsound, so
        // this is surfaced, never auto-followed.
        const holder = relisted.status === 'ok' ? relisted.dialogs.find((d) => d.targetId === mine.blockedBy) : undefined;
        return {
          refused: true,
          redirectTo: mine.blockedBy,
          redirectUrl: holder?.url,
          message:
            `Tab ${targetId} is unresponsive, sharing a browser process with tab ${mine.blockedBy}` +
            `${holder?.url ? ` (${holder.url})` : ''} — but the dialog warden is not running, so which of the two ` +
            'actually holds the dialog cannot be proven without its tracking history. No automatic recovery was ' +
            // FR2-04 escalation-2 (GAP-254, audit-5): dropped "or retry once a warden is available"
            // — nothing can start a fresh warden that would help here. A warden that attaches AFTER
            // the dialog opened has exactly the same problem this whole broker exists to work
            // around (Step 1 O1/O2 both false: a fresh session can neither see nor handle a dialog
            // it wasn't already watching for) — restarting the warden buys no new information while
            // this page stays blocked. "sutradhar close" is the one thing that actually works.
            'attempted. Run "sutradhar close" to end the session.',
        };
      }
      return {
        refused: true,
        message:
          `Tab ${targetId} is unresponsive, but the dialog warden is not running, so this dialog cannot be ` +
          'safely attributed to one specific tab without guessing (guessing here has been measured to close ' +
          'the wrong, innocent tab) — no automatic recovery was attempted. Run "sutradhar close" to end the ' +
          'session.',
      };
    }
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.browser?.connected) await this.browser.disconnect().catch(() => {});
  }
}

/** Branch W: talks to the per-session warden over its localhost HTTP API instead of opening a
 *  second raw CDP connection — the warden already holds the pre-attached sessions Step 1 proved
 *  necessary (O8), so re-deriving that over a fresh connect here would just race it. */
export class WardenBroker implements DialogBroker {
  public constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(path: string, init?: RequestInit): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(5000),
    });
  }

  public async list(): ReturnType<DialogBroker['list']> {
    try {
      const res = await this.request('/v1/dialogs');
      if (!res.ok) return { status: 'unknown', reason: 'unreachable' };
      const body = (await res.json()) as {
        dialogs: Array<{
          targetId: string;
          url: string;
          type: string;
          message: string;
          defaultPrompt?: string;
          openedAt: string;
          id?: string;
          blockedBy?: string;
          confirmedSafe?: boolean;
        }>;
        busy?: string[];
      };
      return {
        status: 'ok',
        busy: body.busy ?? [],
        dialogs: body.dialogs.map((d) => ({
          targetId: d.targetId,
          dialogType: d.type,
          message: d.message,
          // CDP's own dialogOpening event always carries `defaultPrompt` as a string, even for
          // alert/confirm (empty ''), not just prompt() — normalize it the same way
          // BrowserTab.getPendingDialog() does (`dialog.defaultValue() || undefined`), or the
          // exact `"defaultValue":null` contract (§2.8.5) breaks for every non-prompt dialog.
          defaultValue: d.defaultPrompt || undefined,
          url: d.url,
          openedAt: d.openedAt,
          dialogId: d.id,
          blockedBy: d.blockedBy,
          confirmedSafe: d.confirmedSafe,
        })),
      };
    } catch (err) {
      // FR2-04 fix-3, decision point 5 (GAP-241): `getBroker()` only ever picks `WardenBroker`
      // after a health check just confirmed the warden IS up and pointing at this session's
      // browser — so a failure reaching THIS specific request means either the warden died in the
      // last few hundred ms (a real disconnect: `TypeError`/`ECONNREFUSED`-shaped, `unreachable`,
      // safe to fall through to `clear`) or it's still there but couldn't finish probing every
      // target before this request's own `AbortSignal.timeout` fired (a `TimeoutError`/
      // `AbortError` — the warden is overloaded/slow, not gone, so failing open to `clear` here
      // would repeat GAP-241/GAP-239's exact mistake: silently letting a command run against a
      // session that never actually got the all-clear).
      const name = (err as { name?: string } | undefined)?.name;
      const reason = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable';
      return { status: 'unknown', reason };
    }
  }

  public async handle(targetId: string, accept: boolean, promptText: string | undefined, dialogId?: string): Promise<HandleOutcome | void> {
    const res = await this.request('/v1/dialogs/handle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetId, accept, promptText, dialogId }),
    });
    if (res.status === 409) {
      // FR2-04 fix-3/GAP-236, decision point 3: the warden refused because `targetId` is only
      // collaterally blocked by the ACTUAL holder (see DialogWarden.tryRecoverUnknownTarget) — a
      // GAP-223 "dialog changed since it was listed" 409 has no `holderTargetId` and still throws
      // below, unchanged from before this fix.
      const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
        error?: string;
        holderTargetId?: string;
        confirmedSafe?: boolean;
      };
      // FR2-04 escalation-1, decision 1 (GAP-245/246): checked BEFORE the plain `holderTargetId`
      // branch below — a `confirmedSafe` refusal can ALSO carry a `holderTargetId` (a still-in-
      // question candidate elsewhere in the same component), and must never be mistaken for the
      // (unconditional) "this target holds a real, addressable dialog elsewhere" redirect that
      // plain `holderTargetId` alone means.
      if (body.confirmedSafe) {
        return { refused: true, redirectTo: body.holderTargetId, message: body.error };
      }
      if (body.holderTargetId) {
        return { redirectTo: body.holderTargetId, message: body.error };
      }
      throw new Error(body.error ?? `warden handle failed with HTTP ${res.status}`);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
      throw new Error(body.error ?? `warden handle failed with HTTP ${res.status}`);
    }
    // GAP-230: the warden reports `closedTarget:true` when it recovered an unknown dialog by
    // closing the tab (`Target.closeTarget`) instead of actually resolving one via
    // `Page.handleJavaScriptDialog` — surface that so `cmdDialog` can tell the user what really
    // happened, rather than printing "Accepted/Dismissed" for a dialog it never touched.
    const body = (await res.json().catch(() => undefined)) as { closedTarget?: boolean; message?: string } | undefined;
    if (body?.closedTarget) return { closedTarget: true, message: body.message };
  }

  public async dispose(): Promise<void> {
    // Nothing to release — every call is a fresh, short-lived HTTP request.
  }
}

export type GateMode = 'command' | 'close';
export type GateResult =
  | { status: 'clear' }
  | { status: 'handled'; records: GateHandledRecord[] }
  | { status: 'blocked'; dialogs: BrokerDialog[]; records?: GateHandledRecord[] };

/** GAP-229 (fix-2): bounds on the gate's re-check loop after applying a policy — an alert-then-
 *  confirm (or longer) chain must be re-gated before the command is allowed to run, but that loop
 *  must not itself become an unbounded hang if a page keeps opening dialogs indefinitely. */
const GATE_REGATE_MAX_ROUNDS = 5;
const GATE_REGATE_BUDGET_MS = 3000;
const GATE_REGATE_POLL_MS = 150;

/** A single synthetic placeholder dialog entry used only to give {@link DialogBlockedError} a
 *  `dialogs[0]` to report a type/message from when the gate blocks for a reason that ISN'T an
 *  actual dialog it listed (decision point 5's probe-timeout case) — the message text itself
 *  always overrides what the user actually sees, this only keeps `err.dialogs` non-empty for any
 *  code that inspects it. */
function timeoutPlaceholder(): BrokerDialog {
  return { dialogType: 'unknown', message: '', url: '', openedAt: new Date().toISOString() };
}

/**
 * The gate itself (spec §2.8.2). Runs BEFORE `runtime.attach`, outside any self-heal `try` — the
 * only thing it may throw is {@link DialogBlockedError}, in `command` mode with policy `'report'`
 * or a failed handle attempt.
 *
 * FR2-04 fix-2/GAP-229: the original version listed once, handled whatever it found, and returned
 * — so a chained second dialog (e.g. `alert()` immediately followed by `confirm()`, the second
 * only opening once the page's own script resumes after the first is resolved) was never re-
 * checked: the command then ran straight into it, `findAllOpenPages`-style code blocked for the
 * full 180s protocol timeout, and the command silently returned from the wrong (`about:blank`)
 * tab with exit 0 (audit-2, 4/4). This version loops: after applying the policy to everything
 * `list()` currently reports, it waits a short beat (a chained dialog needs the page's script to
 * actually resume and call the next one) and re-lists. It only returns "clear enough to run" once
 * a list comes back with nothing pending — bounded to `GATE_REGATE_MAX_ROUNDS` handled dialogs or
 * `GATE_REGATE_BUDGET_MS` total, whichever comes first, after which ONE final list decides: if
 * still blocked, the gate fails closed (throws/`blocked`) rather than ever letting the command run
 * against a target that might still be blocked — never the silent "assume clear" that caused
 * GAP-229 in the first place.
 *
 * FR2-04 fix-3 changes three things about this loop:
 * - decision point 5 (GAP-239/GAP-241): `list()` returning `status:'unknown'` no longer always
 *   means "clear" — only `reason !== 'timeout'` does (the browser/warden was never reachable at
 *   all, so there's genuinely nothing to gate against). `reason:'timeout'` (the probe was
 *   reachable but couldn't finish) fails CLOSED instead.
 * - decision point 6 (GAP-240): a `dialogType === 'unknown'` entry is liveness-inferred, not an
 *   observed `Page.javascriptDialogOpening` — it might be a real, un-attributable dialog, or it
 *   might just be a page running a slow synchronous script (a sync XHR, heavy layout work).
 *   Automatic policy (`--dialog accept|dismiss`) NEVER calls `broker.handle()` on one of these:
 *   the harm of leaving a busy-but-healthy tab blocked for one command is far smaller than the
 *   harm of an automatic policy silently closing it on a false positive (GAP-240 measured 3/3
 *   sync-XHR cases actually closed under the old code). The command still blocks (exit 3) with a
 *   message that says plainly this may not be an actual dialog — the explicit, one-shot
 *   `sutradhar dialog accept|dismiss` command (cli.ts `cmdDialog`) is a deliberate user decision
 *   and MAY still attempt the same tab-targeted recovery `DirectCdpBroker`/`DialogWarden` already
 *   perform, now correctly scoped to the identified holder (points 1+3).
 * - decision point 7 (GAP-242): every dialog actually resolved in an earlier round of THIS gate
 *   run is threaded onto whatever this function returns OR throws, so a chain that hits the round/
 *   budget limit with some dialogs already handled never silently drops that record.
 */
export async function runDialogGate(
  verb: string | undefined,
  broker: DialogBroker,
  policy: DialogPolicy,
  mode: GateMode,
): Promise<GateResult> {
  const records: GateHandledRecord[] = [];
  const startedAt = Date.now();
  const blockWith = (dialogs: BrokerDialog[], extra?: string): GateResult => {
    if (mode === 'close') return { status: 'blocked', dialogs, records };
    throw new DialogBlockedError(verb, dialogs, 'blocked', extra, records);
  };
  try {
    for (let round = 0; round < GATE_REGATE_MAX_ROUNDS; round++) {
      const listed = await broker.list();
      if (listed.status === 'unknown') {
        if (listed.reason === 'timeout') {
          return blockWith([timeoutPlaceholder()], 'the dialog check could not finish in time; try the command again.');
        }
        return { status: 'clear' };
      }
      // decision point 6 (GAP-240): split what `list()` found into real, observed dialogs vs
      // liveness-inferred `unknown` entries — the latter never get an automatic accept/dismiss.
      const real = listed.dialogs.filter((d) => d.dialogType !== 'unknown');
      const hint = listed.dialogs.filter((d) => d.dialogType === 'unknown');
      if (real.length === 0 && hint.length === 0) {
        if (listed.busy.length > 0) {
          console.error('Note: the page did not respond within 1000ms (a long-running script?).');
        }
        return records.length > 0 ? { status: 'handled', records } : { status: 'clear' };
      }

      if (policy.mode !== 'accept' && policy.mode !== 'dismiss') {
        // policy.mode === 'report' (or 'auto', which never reaches the CLI gate in practice, but
        // is handled the same conservative way if it does) — nothing to apply, so there's no
        // chain to loop on; report/block on whatever is open right now.
        return blockWith(listed.dialogs);
      }

      const accept = policy.mode === 'accept';
      if (real.length > 0) {
        try {
          for (const dialog of [...real].sort((a, b) => a.openedAt.localeCompare(b.openedAt))) {
            // GAP-221/D-9: accept with no explicit --dialog-text means "OK with the prefilled
            // text" — fall back to the dialog's own defaultValue, exactly like `sutradhar dialog
            // accept` (cli.ts cmdDialog) already does. Without this, an orphaned prompt resolved
            // by the gate's own policy application got resolved with an EMPTY string instead.
            const promptText =
              accept && dialog.dialogType === 'prompt' ? (policy.promptText ?? dialog.defaultValue) : undefined;
            await broker.handle(dialog.targetId!, accept, promptText, dialog.dialogId);
            records.push({ dialog, action: policy.mode, promptText });
          }
        } catch (err) {
          return blockWith(listed.dialogs, `applying the "${policy.mode}" policy failed: ${(err as Error).message}.`);
        }
      }
      if (hint.length > 0) {
        // decision point 6: never auto-handle a liveness-inferred entry. Give it one regate round
        // to clear on its own first — a same-renderer sibling that was only collaterally blocked
        // (decision point 1) typically becomes responsive again within a round or two of the real
        // dialog (just handled above, if there was one) actually being resolved and freeing the
        // shared renderer (this is also what fixes GAP-239's phantom-unknown-after-handle shape:
        // a fresh re-probe next round, not a stale classification, decides whether it's still
        // busy). If it's STILL there once the loop's own budget/rounds run out, the final check
        // below reports it plainly as "busy, not necessarily a dialog" rather than pretending it
        // was ever a dialog this policy could have resolved.
        if (Date.now() - startedAt <= GATE_REGATE_BUDGET_MS) {
          await new Promise((r) => setTimeout(r, GATE_REGATE_POLL_MS));
          continue;
        }
        return blockWith(
          hint,
          'the page is busy or blocked and did not respond in time — this may not be an actual dialog, so no automatic recovery was attempted.',
        );
      }

      if (Date.now() - startedAt > GATE_REGATE_BUDGET_MS) break;
      // GAP-229: give a chained dialog a moment to actually open (the page's script only resumes,
      // and only THEN may call the next dialog, once this one's `handle()` above returns) before
      // re-checking — an immediate re-list after the first `accept`/`dismiss` of a chain missed
      // the second dialog entirely (same shape `cmdDialog`'s own poll loop already guards against).
      await new Promise((r) => setTimeout(r, GATE_REGATE_POLL_MS));
    }

    // Ran out of rounds/budget — one last check. The command must NEVER run against a target
    // that's still blocked (GAP-229's core requirement), so a dialog still open here fails
    // closed exactly like the very first round would have.
    const finalListed = await broker.list();
    if (finalListed.status === 'unknown' && finalListed.reason === 'timeout') {
      return blockWith([timeoutPlaceholder()], 'the dialog check could not finish in time; try the command again.');
    }
    if (finalListed.status !== 'unknown' && finalListed.dialogs.length > 0) {
      const allHint = finalListed.dialogs.every((d) => d.dialogType === 'unknown');
      return blockWith(
        finalListed.dialogs,
        allHint
          ? 'the page is busy or blocked and did not respond in time — this may not be an actual dialog, so no automatic recovery was attempted.'
          : 'too many dialogs opened in a row (chain limit reached).',
      );
    }
    return records.length > 0 ? { status: 'handled', records } : { status: 'clear' };
  } finally {
    await broker.dispose();
  }
}
