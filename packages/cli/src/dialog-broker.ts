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
} from '@sutradhar/browser';
import type { DialogPolicy } from '@sutradhar/browser';
import {
  DialogBlockedError,
  GATE_CONNECT_TIMEOUT_MS,
  LIVENESS_TIMEOUT_MS,
  HANDLE_TIMEOUT_MS,
  type PendingDialogEntry,
} from './dialog-cli.js';

export type BrokerDialog = PendingDialogEntry;

export interface DialogBroker {
  /** Every dialog currently open across the session's tabs, or `'unknown'` if the browser
   *  couldn't be reached at all (the caller falls through to the normal attach path). */
  list(): Promise<{ status: 'ok'; dialogs: BrokerDialog[]; busy: string[] } | { status: 'unknown' }>;
  /** `dialogId`, when known (warden-sourced dialogs — GAP-223), lets the broker refuse to apply
   *  this decision to a dialog that isn't the exact one it was made about any more. */
  handle(targetId: string, accept: boolean, promptText: string | undefined, dialogId?: string): Promise<void>;
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

  public async list(): ReturnType<DialogBroker['list']> {
    const browser = await connectForDialogs(this.wsEndpoint, GATE_CONNECT_TIMEOUT_MS);
    if (!browser) return { status: 'unknown' };
    this.browser = browser;
    const dialogs: BrokerDialog[] = [];
    const busy: string[] = [];
    for (const { info, target } of listPageTargets(browser)) {
      let session;
      try {
        session = await target.createCDPSession();
      } catch {
        continue;
      }
      const state = await livenessProbe(session, LIVENESS_TIMEOUT_MS);
      if (state === 'responsive') continue;
      if (state === 'blocked') {
        if (this.hint && this.hint.url === info.url) {
          dialogs.push({
            targetId: info.targetId,
            dialogType: this.hint.type,
            message: this.hint.message,
            defaultValue: this.hint.defaultValue,
            url: info.url,
            openedAt: this.hint.openedAt,
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
          });
        }
      }
    }
    return { status: 'ok', dialogs, busy };
  }

  public async handle(targetId: string, accept: boolean, promptText: string | undefined): Promise<void> {
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
    await handleDialogOnTarget(session, accept, promptText, HANDLE_TIMEOUT_MS);
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
      if (!res.ok) return { status: 'unknown' };
      const body = (await res.json()) as {
        dialogs: Array<{ targetId: string; url: string; type: string; message: string; defaultPrompt?: string; openedAt: string; id?: string }>;
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
        })),
      };
    } catch {
      return { status: 'unknown' };
    }
  }

  public async handle(targetId: string, accept: boolean, promptText: string | undefined, dialogId?: string): Promise<void> {
    const res = await this.request('/v1/dialogs/handle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetId, accept, promptText, dialogId }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
      throw new Error(body.error ?? `warden handle failed with HTTP ${res.status}`);
    }
  }

  public async dispose(): Promise<void> {
    // Nothing to release — every call is a fresh, short-lived HTTP request.
  }
}

export type GateMode = 'command' | 'close';
export type GateResult =
  | { status: 'clear' }
  | { status: 'handled'; records: Array<{ dialog: BrokerDialog; action: 'accept' | 'dismiss'; promptText?: string }> }
  | { status: 'blocked'; dialogs: BrokerDialog[] };

/**
 * The gate itself (spec §2.8.2). Runs BEFORE `runtime.attach`, outside any self-heal `try` — the
 * only thing it may throw is {@link DialogBlockedError}, in `command` mode with policy `'report'`
 * or a failed handle attempt.
 */
export async function runDialogGate(
  verb: string | undefined,
  broker: DialogBroker,
  policy: DialogPolicy,
  mode: GateMode,
): Promise<GateResult> {
  try {
    const listed = await broker.list();
    if (listed.status === 'unknown') return { status: 'clear' };
    if (listed.dialogs.length === 0) {
      if (listed.busy.length > 0) {
        console.error('Note: the page did not respond within 1000ms (a long-running script?).');
      }
      return { status: 'clear' };
    }

    if (policy.mode === 'accept' || policy.mode === 'dismiss') {
      const records: Array<{ dialog: BrokerDialog; action: 'accept' | 'dismiss'; promptText?: string }> = [];
      const accept = policy.mode === 'accept';
      try {
        for (const dialog of [...listed.dialogs].sort((a, b) => a.openedAt.localeCompare(b.openedAt))) {
          // GAP-221/D-9: accept with no explicit --dialog-text means "OK with the prefilled
          // text" — fall back to the dialog's own defaultValue, exactly like `sutradhar dialog
          // accept` (cli.ts cmdDialog) already does. Without this, an orphaned prompt resolved by
          // the gate's own policy application got resolved with an EMPTY string instead.
          const promptText =
            accept && dialog.dialogType === 'prompt' ? (policy.promptText ?? dialog.defaultValue) : undefined;
          await broker.handle(dialog.targetId!, accept, promptText, dialog.dialogId);
          records.push({ dialog, action: policy.mode, promptText });
        }
        return { status: 'handled', records };
      } catch (err) {
        if (mode === 'close') return { status: 'blocked', dialogs: listed.dialogs };
        throw new DialogBlockedError(verb, listed.dialogs, 'blocked', `applying the "${policy.mode}" policy failed: ${(err as Error).message}.`);
      }
    }

    // policy.mode === 'report' (or 'auto', which never reaches the CLI gate in practice, but is
    // handled the same conservative way if it does)
    if (mode === 'close') return { status: 'blocked', dialogs: listed.dialogs };
    throw new DialogBlockedError(verb, listed.dialogs, 'blocked');
  } finally {
    await broker.dispose();
  }
}
