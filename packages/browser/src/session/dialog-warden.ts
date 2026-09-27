/**
 * @file packages/browser/src/session/dialog-warden.ts
 * @description FR2-04 Branch W: the `DialogWarden` core. Step 1 (evidence/FR2-04/step1)
 * established that a FRESH CDP session can neither see (a fresh Page.enable never re-emits
 * `Page.javascriptDialogOpening`) nor handle (`Page.handleJavaScriptDialog` fails with "No
 * dialog is showing") a dialog that opened before it connected — but a session that was already
 * `Page.enable`d BEFORE the dialog opened CAN handle it after the process that opened it exits
 * (Step 1 E4/E4b, O8=true). The warden exists to be that pre-attached holder: a small, detached
 * Node process that connects once per CLI session and keeps every page's dialog-domain enabled
 * for the session's whole lifetime, independent of any single short-lived CLI command process.
 *
 * No `process.*` calls live here (no `process.exit`, no `process.argv`) — this class is pure
 * CDP + HTTP; `packages/cli/src/warden-control.ts` is the thing that actually spawns/wraps it as
 * a detached OS process, decodes argv, and calls `process.exit`.
 */
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import type { Browser, CDPSession, Target } from 'puppeteer-core';
import {
  connectForDialogs,
  listPageTargets,
  livenessProbe,
  closeTargetAtBrowserLevel,
  attributeDialogHolders,
  type ObservedDialog,
} from './dialog-cdp.js';
import type { DialogPolicy } from './browser-tab.js';

const DEFAULT_POLICY_GRACE_MS = 300;
const DEFAULT_STATE_POLL_MS = 2000;
/** FR2-04 escalation-2 (GAP-251), SUPERSEDES escalation-1's 500ms default: how long `track()`
 *  waits after a target's `Page.enable` acks before its one proactive "is this target confirmed
 *  safe" probe fires. escalation-1 set this to 500ms (0 for the bootstrap tab only) to protect
 *  against a hypothesized race — marking a target confirmed-safe moments before its own
 *  synchronous first-script dialog would have opened. audit-5 (`.ai/loop/field-report-2/evidence/
 *  FR2-04/audit-5/audit-findings.json`, A5-02) fired 63 real dialogs at delays from 300ms-1000ms
 *  plus 15 rapid reactive-poll trials and found ZERO cases of that race actually happening — every
 *  real dialog arrives as a tracked, typed `Page.javascriptDialogOpening` event regardless of
 *  timing, because the event and the `Page.enable` ack both come from the SAME renderer round trip
 *  and the event fires (or the renderer blocks) before this timer could ever mark the target safe.
 *  The auditor then set this to 0 for EVERY target (not just bootstrap) and re-ran every shape that
 *  motivated the 500ms value: 36/36 clean (0 misattributions) — see `a5-E3live.json`/
 *  `attrib-attack-E3live.json` in that evidence dir. The delay itself turned out to be the bug: it
 *  is exactly the window GAP-251's two attacks (a same-renderer popup younger than the delay, whose
 *  opener starts a slow synchronous XHR) exploited to get a healthy popup wrongly closed — 12/12 at
 *  gaps of 0-450ms in audit-5's own live run. escalation-2's binding decision
 *  (decisions.md 2026-09-27) is to remove the delay: default 0, probing every new target
 *  (bootstrap or not) as soon as its `Page.enable` has ack'd, never before. The underlying
 *  `confirmedResponsiveSince`/transparent-pass-through DESIGN from escalation-1 is unchanged — only
 *  this delay's value (and the bootstrap/non-bootstrap distinction it required) is gone. Kept as
 *  its own constant/option (rather than folded into `DEFAULT_POLICY_GRACE_MS`, a different concern:
 *  how long to wait before auto-applying a policy to an ALREADY-OPEN, already-tracked dialog) purely
 *  so a test can still override it to simulate the old delayed behavior without touching the policy
 *  grace period. See escalation-2's own live re-verification
 *  (`.ai/loop/field-report-2/evidence/FR2-04/escalation-2/`) for the full re-run of every prior
 *  audit's timing sweep at 0 delay. */
const DEFAULT_PROACTIVE_CONFIRM_DELAY_MS = 0;
/** Every warden HTTP call's own budget (WARDEN_HTTP_TIMEOUT_MS, FR2-04 spec §0.4) — the CLI side
 *  (warden-control.ts) applies this per-request; kept here too as the doc-of-record. */
export const WARDEN_HTTP_TIMEOUT_MS = 500;
/** GAP-220/228 (b), the defensive layer: bounded per-target liveness probe budget used by
 *  `/v1/dialogs` for EVERY page target with no tracked dialog (see the doc comment on
 *  `listWithLiveness` for fix-2's change from "only never-acked targets" to "every target").
 *  Kept short so a session with several tabs doesn't make the gate noticeably slower (measured in
 *  fix-2/gate-overhead.json) — a target that fails to answer within this window is reported as an
 *  `unknown` dialog and the gate blocks, exactly like `DirectCdpBroker`'s fallback does. */
export const LIVENESS_PROBE_MS = 400;
/**
 * FR2-04 fix-2/GAP-228: fix-1 narrowed the liveness probe (see git history) to only a target
 * whose `Page.enable` had never ACKed, because its probe signal at the time (`Runtime.evaluate`)
 * was NOT decidable — it timed out under both a genuinely dialog-blocked renderer and a page
 * merely running a long synchronous script, so probing every target with it false-blocked the
 * legitimate busy-script cases N9/N10. That narrowing traded a live regression for a real,
 * common miss: a target whose `Page.enable` happens to ACK despite an already-open dialog (the
 * `about:blank` popup that `alert()`s synchronously during its own construction, Step 1's O1
 * shape) was never probed at all and went undetected 26/26 (audit-2, GAP-228).
 *
 * `livenessProbe` (dialog-cdp.ts) now uses `Performance.getMetrics`, which audit-2's signal
 * research (and fix-2's own re-verification, evidence/FR2-04/fix-2/signal-reverify/) confirmed IS
 * decidable: it answers under a busy synchronous script but times out under every native dialog
 * type. That removes the reason fix-1 had to narrow the probe at all, so `listWithLiveness` below
 * now probes EVERY real page target with nothing tracked, regardless of `pageEnableAckedAt` —
 * `pageEnableAckedAt` is kept only for diagnostics now, not as a probe gate.
 */

export interface WardenOptions {
  readonly wsEndpoint: string;
  /** Read the session's current dialog policy (mirrors CLI state's `dialogPolicy`). Called after
   *  `policyGraceMs` for each newly-opened dialog, and re-checked at handle time. */
  readonly readPolicy: () => Promise<DialogPolicy | undefined>;
  /** Is this warden still the one that should be running? `false` means the state file is gone,
   *  or points at a different session — the warden then exits (R-D: no GC net exists, so the
   *  warden must police its own lifetime). */
  readonly isStillCurrent: () => Promise<boolean>;
  readonly onReady: (info: { port: number; token: string }) => Promise<void> | void;
  readonly onExit: (reason: string) => Promise<void> | void;
  readonly policyGraceMs?: number;
  readonly statePollMs?: number;
  /** FR2-04 escalation-1: overrides `DEFAULT_PROACTIVE_CONFIRM_DELAY_MS` — test-only knob so a
   *  unit test can make the proactive confirm probe fire (near-)immediately instead of waiting
   *  500ms of real (or advanced fake) timer time. */
  readonly proactiveConfirmDelayMs?: number;
  readonly connect?: typeof connectForDialogs;
}

interface TrackedDialog extends ObservedDialog {
  handled: boolean;
}

/**
 * Tracks every page target's dialogs for one Chrome session and serves a tiny localhost HTTP API
 * so the CLI (a separate, short-lived process) can list/handle them. See the file header for why
 * this needs to be a separate long-lived process at all (Step 1 O8).
 */
export class DialogWarden {
  private browser?: Browser;
  private server?: http.Server;
  private readonly token = crypto.randomBytes(32).toString('hex');
  private readonly sessions = new Map<string, CDPSession>();
  private readonly dialogs = new Map<string, TrackedDialog>(); // keyed by targetId (one at a time per target)
  /** When this warden first discovered each target — kept for diagnostics and as the bootstrap
   *  fallback age (see `listWithLiveness`'s use of it for a target with no ack recorded yet). */
  private readonly discoveredAt = new Map<string, number>();
  /** When each target's `Page.enable` last ACKed — see `PAGE_ENABLE_GRACE_MS`. */
  private readonly pageEnableAckedAt = new Map<string, number>();
  /** FR2-04 escalation-1, decision 1 (GAP-245/246/247): when a liveness probe TAKEN AFTER this
   *  target's `Page.enable` acked first found it responsive — i.e. the moment history proves this
   *  target's dialog listener has been live and silent. Set once, never cleared until the target
   *  itself is destroyed. See `attributeDialogHolders`'s `confirmedSafe` doc comment for why this
   *  (history), not current topology, is the right thing to key "definitely not a dialog holder"
   *  off of. */
  private readonly confirmedResponsiveSince = new Map<string, number>();
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pollTimer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private port = 0;

  public constructor(private readonly opts: WardenOptions) {}

  /** The HTTP server's actual bound address (host, port, family) — exposed so tests (and anyone
   *  auditing this at runtime) can assert the real bind address rather than merely that SOME
   *  request to 127.0.0.1 happens to succeed, which would still pass even if this server were
   *  mistakenly bound to `0.0.0.0` (GAP-225: WD7 never actually checked this before). */
  public address(): { address: string; port: number; family: string } | undefined {
    const addr = this.server?.address();
    return typeof addr === 'object' && addr ? addr : undefined;
  }

  public pending(): ObservedDialog[] {
    return Array.from(this.dialogs.values())
      .filter((d) => !d.handled)
      .sort((a, b) => a.openedAt.localeCompare(b.openedAt))
      .map(({ handled: _handled, ...rest }) => rest);
  }

  /**
   * GAP-220/228 defensive layer (b): `pending()` alone only reports dialogs the warden's OWN
   * `Page.javascriptDialogOpening` listener actually saw — which the structural layer above
   * cannot guarantee for a target whose dialog fires during the attach race, OR (GAP-228) for a
   * target whose `Page.enable` acks normally but whose FIRST script (synchronous, before the
   * warden's listener could ever fire) already opened and is blocking on a dialog. Never trust
   * "no tracked dialog" by itself: for EVERY real page target with nothing tracked — fix-2 removed
   * the old "only never-acked" narrowing (see `LIVENESS_PROBE_MS`'s doc comment) now that the probe
   * signal itself (`Performance.getMetrics`) is decidable — run a short, bounded liveness probe
   * and report an unresponsive one as an `unknown` dialog, exactly like `DirectCdpBroker`'s
   * fallback does. The gate then blocks (exit 3) instead of letting `runtime.attach()` risk the
   * 180s hang / silent wrong-tab adoption (GAP-017/GAP-220/GAP-228). Bounded to
   * `LIVENESS_PROBE_MS` per target so a session with a normal number of tabs doesn't make every
   * gated command noticeably slower (measured in fix-2/gate-overhead.json).
   */
  public async listWithLiveness(): Promise<{ dialogs: ObservedDialog[]; busy: string[] }> {
    const dialogs = this.pending();
    const busy: string[] = [];
    if (!this.browser) return { dialogs, busy };
    const trackedIds = new Set(dialogs.map((d) => d.targetId));
    const candidates = listPageTargets(this.browser).filter(({ info }) => !trackedIds.has(info.targetId));

    // FR2-04 fix-3, decision point 5 (GAP-241): probe every candidate CONCURRENTLY, not one after
    // another — see `probeTargetsConcurrently`'s doc comment for the exact failure this replaces
    // (serial 400ms-per-target probing scaling linearly with tab count until it blew past the
    // CLI's own 5s outer wait cap, which then failed OPEN). Each probe still has its own bounded
    // `LIVENESS_PROBE_MS` timeout, so the whole round costs about one probe's worth of wall time
    // regardless of how many targets there are. A target whose session can't even be attached
    // (closed between listing and attach) is dropped, exactly as before.
    const sessionInfo = new Map<string, { session: CDPSession; ownSession: boolean }>();
    await Promise.all(
      candidates.map(async ({ info, target }) => {
        let session = this.sessions.get(info.targetId);
        let ownSession = false;
        if (!session) {
          try {
            session = await target.createCDPSession();
            ownSession = true;
          } catch {
            return; // target gone between listing and attach — nothing to probe
          }
        }
        sessionInfo.set(info.targetId, { session, ownSession });
      }),
    );
    const probeable = candidates.filter(({ info }) => sessionInfo.has(info.targetId));
    const states = new Map<string, Awaited<ReturnType<typeof livenessProbe>>>(
      await Promise.all(
        probeable.map(async ({ info }): Promise<[string, Awaited<ReturnType<typeof livenessProbe>>]> => {
          const { session, ownSession } = sessionInfo.get(info.targetId)!;
          try {
            return [info.targetId, await livenessProbe(session, LIVENESS_PROBE_MS)];
          } finally {
            if (ownSession) void session.detach().catch(() => {});
          }
        }),
      ),
    );

    // FR2-04 escalation-1, decision 1: the FIRST time a probe finds a target responsive AFTER its
    // Page.enable acked, that target's history is settled for good — record it. This is the ONLY
    // place `confirmedResponsiveSince` is ever set (never by mere Page.enable ack alone — Step 1's
    // E2/E4 showed enable can ack with a dialog already open, and GAP-228 showed enable can ack on
    // a target whose FIRST script already opened a dialog before this probe ever ran — a target
    // must actually be OBSERVED responsive, not just enabled, to be provably safe).
    for (const { info } of probeable) {
      if (states.get(info.targetId) === 'responsive' && this.pageEnableAckedAt.has(info.targetId) && !this.confirmedResponsiveSince.has(info.targetId)) {
        this.confirmedResponsiveSince.set(info.targetId, Date.now());
      }
    }

    // FR2-04 fix-3, decision point 1 (GAP-236) / escalation-1 decision 1 (GAP-245/246/247): among
    // everything that just came back non-responsive, figure out which target actually HOLDS the
    // dialog versus which is merely collaterally blocked by sharing a renderer with the holder (a
    // popup and its opener being the concrete, evidenced case) — see `attributeDialogHolders`'s doc
    // comment for the full reasoning, in particular why this is now HISTORY-based
    // (`confirmedSafe`), not purely topology-based. Only a non-confirmed-safe holder is reported as
    // addressable; a collateral OR confirmed-safe target is reported with `blockedBy`/
    // `confirmedSafe` set instead, so the gate still blocks (the shared renderer really is
    // unresponsive) but recovery/auto-policy code never treats it as independently addressable.
    const blockedInfos = probeable
      .filter(({ info }) => states.get(info.targetId) !== 'responsive')
      .map(({ info }) => ({
        targetId: info.targetId,
        openerTargetId: info.openerTargetId,
        discoveredAt: this.discoveredAt.get(info.targetId),
        confirmedSafe: this.confirmedResponsiveSince.has(info.targetId),
      }));
    // FR2-04 escalation-2 (GAP-252): every real page target this warden currently knows about
    // (blocked or not, tracked-real-dialog or not) — lets `attributeDialogHolders` connect two
    // blocked siblings through their shared opener even when that opener itself never blocked (a
    // cross-site popup pair, the exact GAP-252 shape). Cheap: `listPageTargets` reads only
    // browser-level `Target` fields, no CDP round trip.
    const allTargets = listPageTargets(this.browser).map(({ info }) => ({ targetId: info.targetId, openerTargetId: info.openerTargetId }));
    const attribution = attributeDialogHolders(blockedInfos, allTargets);
    for (const { info } of probeable) {
      const state = states.get(info.targetId);
      if (state === 'responsive') continue;
      busy.push(info.targetId);
      const attr = attribution.get(info.targetId);
      dialogs.push({
        targetId: info.targetId,
        url: info.url,
        type: 'unknown',
        message: '',
        openedAt: new Date().toISOString(),
        source: 'hint',
        blockedBy: attr?.blockedBy,
        confirmedSafe: attr?.confirmedSafe,
      });
    }
    return { dialogs, busy };
  }

  public async start(): Promise<void> {
    const connect = this.opts.connect ?? connectForDialogs;
    const browser = await connect(this.opts.wsEndpoint, 10000);
    if (!browser) throw new Error(`DialogWarden could not connect to ${this.opts.wsEndpoint}`);
    this.browser = browser;

    browser.on('disconnected', () => {
      void this.stop('browser-disconnected');
    });
    browser.on('targetcreated', (target) => {
      if (target.type() === 'page') void this.track(target);
    });
    browser.on('targetdestroyed', (target) => {
      const targetId = idOf(target);
      this.dialogs.delete(targetId);
      const session = this.sessions.get(targetId);
      this.sessions.delete(targetId);
      void session?.detach().catch(() => {});
      const timer = this.graceTimers.get(targetId);
      if (timer) {
        clearTimeout(timer);
        this.graceTimers.delete(targetId);
      }
      this.discoveredAt.delete(targetId);
      this.pageEnableAckedAt.delete(targetId);
      this.confirmedResponsiveSince.delete(targetId);
    });

    // Deliberately NOT `listPageTargets(browser)` here — that helper filters out `about:blank`
    // targets (right, for the gate's/DirectCdpBroker's OWN listing, which has nothing useful to
    // check on a blank tab). But this is the warden's bootstrap: a session's very first tab
    // typically STARTS as `about:blank` and is navigated to its real URL moments later by the
    // very first CLI command — that's a URL CHANGE on an EXISTING target, which never fires
    // `targetcreated`, so if this loop skipped it, it would never get a `discoveredAt` entry at
    // all. `listWithLiveness()` then has to treat a missing entry as "brand new" (age 0) to stay
    // safe for a genuinely-new target it truly missed — which made this untracked-since-launch
    // primary tab look "brand new" on EVERY check, forever, and start false-blocking any
    // legitimately slow script on it (regressed live: N9/N10). Track every real page target,
    // blank or not, so the common case (single already-open tab) gets a proper bootstrap-time
    // `discoveredAt` and ages out of the liveness-probe window normally.
    for (const target of browser.targets()) {
      if (target.type() === 'page') await this.track(target);
    }

    await this.listen();
    await this.opts.onReady({ port: this.port, token: this.token });

    const statePollMs = this.opts.statePollMs ?? DEFAULT_STATE_POLL_MS;
    this.pollTimer = setInterval(() => {
      void this.opts.isStillCurrent().then((current) => {
        if (!current) void this.stop('state-changed');
      });
    }, statePollMs);
    this.pollTimer.unref?.();
  }

  /**
   * GAP-220 structural layer (a): attaches to `target` and enables `Page` as fast as this
   * process can manage. Puppeteer's own `TargetManager` already auto-attaches every new target
   * with `Target.setAutoAttach({waitForDebuggerOnStart:true, flatten:true})` and releases it with
   * `Runtime.runIfWaitingForDebugger` **synchronously**, inside the same `Target.attachedToTarget`
   * handler turn, before this class's `browser.on('targetcreated', …)` listener can even run
   * (Puppeteer's `Browser` only re-emits `targetcreated` after the target's OWN internal
   * initialization promise resolves — by which point the paused-target window has already
   * closed). That means a brand-new attach via `target.createCDPSession()` cannot structurally
   * win the race against a script that runs immediately on load (confirmed live: FR2-04 fix-1
   * evidence, GAP-220 rerun). This method narrows the window as much as is reachable from the
   * public Puppeteer API — reusing the session Puppeteer already attached (`target._session()`,
   * one CDP round-trip cheaper than a fresh `createCDPSession()`) and sending `Page.enable`
   * before doing anything else — but it is NOT a structural guarantee on its own. GAP-220's actual
   * safety net is the defensive liveness probe in `listWithLiveness()` below: any page target this
   * method (or Puppeteer's own release) loses the race on still gets caught there and reported as
   * an `unknown` blocking dialog rather than silently treated as clear.
   */
  private async track(target: Target): Promise<void> {
    if (this.stopped) return;
    const targetId = idOf(target);
    if (!this.discoveredAt.has(targetId)) this.discoveredAt.set(targetId, Date.now());
    if (this.sessions.has(targetId)) return;
    let session: CDPSession | undefined;
    let ownAttach = false;
    try {
      // Reuse Puppeteer's own already-attached session when available — one fewer CDP round trip
      // than a fresh `createCDPSession()`, which matters exactly during the GAP-220 window.
      session = (target as unknown as { _session?: () => CDPSession | undefined })._session?.();
      if (!session) {
        session = await target.createCDPSession();
        ownAttach = true;
      }
    } catch {
      session = undefined;
    }
    if (!session) return; // target may have closed between discovery and attach — nothing to track
    if (this.stopped) {
      // Warden stopped while we were attaching — never leave a target paused/tracked past stop().
      if (ownAttach) void session.detach().catch(() => {});
      return;
    }
    this.sessions.set(targetId, session);

    session.on('Page.javascriptDialogOpening', (e: { type: string; message: string; defaultPrompt?: string }) => {
      const dialog: TrackedDialog = {
        id: crypto.randomUUID(),
        targetId,
        url: target.url(),
        type: e.type,
        message: e.message,
        defaultPrompt: e.defaultPrompt,
        openedAt: new Date().toISOString(),
        source: 'event',
        handled: false,
      };
      this.dialogs.set(targetId, dialog);
      const graceMs = this.opts.policyGraceMs ?? DEFAULT_POLICY_GRACE_MS;
      const timer = setTimeout(() => {
        this.graceTimers.delete(targetId);
        void this.maybeApplyPolicy(targetId, dialog);
      }, graceMs);
      this.graceTimers.set(targetId, timer);
    });
    session.on('Page.javascriptDialogClosed', () => {
      this.dialogs.delete(targetId);
      const timer = this.graceTimers.get(targetId);
      if (timer) {
        clearTimeout(timer);
        this.graceTimers.delete(targetId);
      }
    });

    try {
      // Sent, not awaited past a short cap — Step 1 (E4) established the browser-side handler
      // becomes enabled at SEND time, and a fresh Page.enable can itself hang while a dialog is
      // already open (E2.pageEnable) — awaiting it fully here would deadlock the warden on exactly
      // the tab it most needs to keep tracking. A target we just released
      // (`Runtime.runIfWaitingForDebugger`, only reachable via the fallback `createCDPSession()`
      // path) is never left paused: we always at least attempt the release below.
      const enableTimeout = setTimeout(() => {}, 2000);
      session
        .send('Page.enable')
        .then(() => {
          // GAP-220 (b): the precise end of this target's race window — see
          // `PAGE_ENABLE_GRACE_MS`'s doc comment for why this is measured from HERE, not from
          // when the target was merely discovered.
          this.pageEnableAckedAt.set(targetId, Date.now());
          // FR2-04 escalation-1 (found live, re-verifying GAP-245's xhr-popup-manual shape): a
          // target only ever gets liveness-probed (the thing that actually sets
          // `confirmedResponsiveSince`, see `listWithLiveness`) REACTIVELY, when some later CLI
          // command's gate happens to call `/v1/dialogs` — decision 1's history rule was proven
          // sound at the unit level (dialog-cdp.spec.ts's mocked timeline), but a live attack that
          // creates a popup and blocks its shared renderer with NO intervening CLI command in
          // between (this scenario's exact shape: two raw-CDP `Runtime.evaluate` steps with no
          // `cli(...)` call between them) never gives the warden a chance to observe EITHER target
          // responsive before everything blocks — so neither ever earns `confirmedSafe`, and
          // GAP-245 reopens for the popup AND (since even the long-lived opener's very first probe
          // this session also happens to land after the block) the opener too.
          //
          // FR2-04 escalation-2 (GAP-251), SUPERSEDES the paragraph this replaces: escalation-1
          // reasoned that probing right away would race an `about:blank` popup that alerts
          // synchronously during its OWN construction (audit-2's original finding) — nominally
          // "responsive" for a few ms right after `Page.enable` acks, before its first script has
          // actually run — and added a delay (bootstrap targets exempted) to give that first script
          // a chance to either become a TRACKED event or already be blocking the probe. audit-5
          // proved this reasoning wrong with live data (see `DEFAULT_PROACTIVE_CONFIRM_DELAY_MS`'s
          // doc comment for the full evidence): the event and the ack come from the same renderer
          // round trip, so a real dialog is ALWAYS either already a tracked event or already
          // blocking this very probe by the time it runs, at delay 0 — 63 real dialogs fired at
          // 300-1000ms plus 36/36 clean at delay 0 across every shape that motivated the delay in
          // the first place. The delay bought no protection and was itself the bug: it's the exact
          // window GAP-251's attacks (a same-renderer popup younger than the delay, whose opener
          // starts a slow synchronous XHR) used to get a healthy popup wrongly closed. There is no
          // longer a bootstrap/non-bootstrap distinction — every target (the session's pre-existing
          // primary tab or a brand-new one) is probed the same way, immediately once `Page.enable`
          // has ack'd. `this.dialogs.has(targetId)` is still checked below (and again inside the
          // probe's own callback) so a dialog that DID arrive as a tracked event in the meantime is
          // never overridden. Fire-and-forget either way: losing this race just leaves the target a
          // candidate, exactly as before this addition.
          if (!this.confirmedResponsiveSince.has(targetId) && !this.dialogs.has(targetId)) {
            const delayMs = this.opts.proactiveConfirmDelayMs ?? DEFAULT_PROACTIVE_CONFIRM_DELAY_MS;
            setTimeout(() => {
              if (this.stopped || this.confirmedResponsiveSince.has(targetId) || this.dialogs.has(targetId)) return;
              livenessProbe(session, LIVENESS_PROBE_MS)
                .then((state) => {
                  if (state === 'responsive' && !this.confirmedResponsiveSince.has(targetId) && !this.dialogs.has(targetId)) {
                    this.confirmedResponsiveSince.set(targetId, Date.now());
                  }
                })
                .catch(() => {});
            }, delayMs).unref?.();
          }
        })
        .catch(() => {})
        .finally(() => clearTimeout(enableTimeout));
      if (ownAttach) {
        // Our own fresh attach also auto-pauses the target (Puppeteer's browser-level
        // Target.setAutoAttach applies to every attach, including ours) — release it. Never skip
        // this: a target left paused here would hang forever, worse than the race we're guarding
        // against. Fire-and-forget with its own short timeout, same reasoning as Page.enable.
        session.send('Runtime.runIfWaitingForDebugger').catch(() => {});
      }
    } catch {
      // Never leave a target paused because of an unexpected throw setting up listeners.
      if (ownAttach) void session.send('Runtime.runIfWaitingForDebugger').catch(() => {});
    }
  }

  /**
   * `expected` is the EXACT `TrackedDialog` object instance this policy decision was made about
   * (captured at schedule time, when the grace timer was armed). GAP-223: without this identity
   * check, a late policy application (delayed by the grace timer, or by a slow `readPolicy()`)
   * could land on a DIFFERENT dialog that has since opened on the same `targetId` — e.g. a
   * confirm→prompt chain, where the confirm's grace timer fires just as the prompt has already
   * replaced it in `this.dialogs`. Comparing object identity (not just "is something pending")
   * catches that even though the replacement dialog reuses the same map key.
   */
  private async maybeApplyPolicy(targetId: string, expected: TrackedDialog): Promise<void> {
    const dialog = this.dialogs.get(targetId);
    if (!dialog || dialog.handled || dialog !== expected) return;
    const policy = await this.opts.readPolicy().catch(() => undefined);
    if (!policy || (policy.mode !== 'accept' && policy.mode !== 'dismiss')) return;
    const session = this.sessions.get(targetId);
    if (!session) return;
    const stillPending = this.dialogs.get(targetId);
    if (!stillPending || stillPending.handled || stillPending !== expected) return;
    const promptText =
      policy.mode === 'accept' && dialog.type === 'prompt' ? (policy.promptText ?? dialog.defaultPrompt) : undefined;
    try {
      await session.send(
        'Page.handleJavaScriptDialog',
        { accept: policy.mode === 'accept', promptText },
        { timeout: 5000 },
      );
      dialog.handled = true;
      this.dialogs.delete(targetId);
    } catch {
      // "No dialog is showing" (or any other CDP failure) means the in-process BrowserTab (or a
      // concurrent `sutradhar dialog` call) already got there first with the same policy —
      // logged-and-ignored per spec §2.5, not an error worth surfacing.
    }
  }

  /**
   * GAP-230/fix-3 decision point 1+3 (GAP-236): re-probes the WHOLE session (it may have
   * unblocked on its own since the caller's `list()`, and a fresh probe is the only way to know
   * which target — if several share a blocked renderer — actually holds the dialog right now).
   * Reuses {@link listWithLiveness} rather than re-implementing the probe/attribution logic: it
   * already does the exact "probe every untracked target, then attribute holder vs collateral"
   * work this recovery path needs, so a live re-probe here is cheap (bounded, parallel) and always
   * consistent with what the next `GET /v1/dialogs` would report a moment later.
   *
   * Returns `{closed:true}` only when `targetId` itself was identified as the actual holder and
   * was closed. If `targetId` is currently attributed as collaterally blocked BY another target
   * (the exact GAP-236 shape — a popup's opener sharing its renderer), this refuses to close it
   * and returns the real holder's id/url instead, so the caller can report which tab it should
   * have asked about (decision point 3: recovery must never be the implicit side effect of
   * closing whatever target merely sorted first). `{closed:false}` with no `redirectTo`/`refused`
   * means the target isn't blocked at all any more (it cleared on its own) or no longer exists —
   * nothing to recover either way.
   *
   * FR2-04 fix-3, decision point 6 (GAP-240) — SUPERSEDED by escalation-1 decision 1+2
   * (GAP-245/246): fix-3's rule was "no sibling relationship at all -> refuse" (an `isolated`
   * flag), reasoning that a lone blocked target has zero structural evidence it's an actual dialog
   * rather than a slow script. audit-4 found this wrong in BOTH directions: GAP-245, a target that
   * merely shares a renderer with a confirmed-safe (history-proven non-dialog) sibling still got
   * closed just because a sibling existed; GAP-246, a REAL dialog in a genuinely isolated new tab
   * (no sibling to attribute against at all — the common `target=_blank`/cross-site-popup shape)
   * could never be recovered at all. The fix is `confirmedSafe` (see `attributeDialogHolders`'s doc
   * comment): a target the warden has actually watched respond since its listener went live cannot
   * be hiding a dialog, so it's excluded from candidacy regardless of siblings (fixes GAP-245); a
   * target that was NEVER confirmed responsive remains an eligible candidate holder EVEN with no
   * sibling at all (fixes GAP-246, decision 2) — the accepted residual (decision 2) is narrower
   * than the old blanket rule: only a brand-new tab that is busy from the very instant of its
   * creation (never had a chance to be probed responsive) is indistinguishable from a real dialog.
   */
  private async tryRecoverUnknownTarget(
    targetId: string,
  ): Promise<{ closed: boolean; redirectTo?: string; redirectUrl?: string; refused?: boolean }> {
    if (!this.browser) return { closed: false };
    const { dialogs } = await this.listWithLiveness();
    const entry = dialogs.find((d) => d.targetId === targetId && d.source === 'hint');
    if (!entry) return { closed: false }; // not currently probed as blocked — nothing to recover
    if (entry.confirmedSafe) {
      // History proves this target cannot be hiding a dialog — never close it, and never point at
      // it as if it were a redirect target for someone else either (its own `blockedBy`, if set,
      // only names a still-in-question candidate for MESSAGING — see attributeDialogHolders).
      return { closed: false, refused: true, redirectTo: entry.blockedBy, redirectUrl: entry.blockedBy ? dialogs.find((d) => d.targetId === entry.blockedBy)?.url : undefined };
    }
    if (entry.blockedBy) {
      const holder = dialogs.find((d) => d.targetId === entry.blockedBy);
      return { closed: false, redirectTo: entry.blockedBy, redirectUrl: holder?.url };
    }
    // Never confirmed responsive, and not collateral to another still-in-question candidate — this
    // is the presumed holder, eligible for recovery even with no sibling at all (decision 2).
    try {
      await closeTargetAtBrowserLevel(this.browser, targetId);
      return { closed: true };
    } catch {
      return { closed: false };
    }
  }

  private async listen(): Promise<void> {
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    this.port = typeof address === 'object' && address ? address.port : 0;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${this.token}`) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/v1/health') {
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ pid: process.pid, wsEndpoint: this.opts.wsEndpoint }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/dialogs') {
      const { dialogs, busy } = await this.listWithLiveness();
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ dialogs, busy }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/dialogs/handle') {
      let body = '';
      for await (const chunk of req) body += chunk;
      let parsed: { targetId?: string; accept?: boolean; promptText?: string; dialogId?: string };
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid JSON body' }));
        return;
      }
      const { targetId, accept, promptText, dialogId } = parsed;
      const session = targetId ? this.sessions.get(targetId) : undefined;
      const dialog = targetId ? this.dialogs.get(targetId) : undefined;
      if (!session || !dialog || dialog.handled) {
        // GAP-230: an `unknown` dialog (this target's `Page.enable` never acked, so it was never
        // tracked as a real `TrackedDialog` at all — `listWithLiveness` only synthesizes a
        // transient `unknown` entry for the caller, nothing persists in `this.dialogs`) used to be
        // a dead end here: every `dialog accept|dismiss` failed "No dialog is open on that tab",
        // and the ONLY escape was `sutradhar close` (losing the whole session). Recover instead:
        // if the target genuinely exists and is still unresponsive (re-probe — it may have
        // resolved on its own between list() and this call), close it at the BROWSER level
        // (`Target.closeTarget`, which doesn't touch the blocked renderer at all, so it works
        // even though `Page.handleJavaScriptDialog` has nothing to act on). A target that's
        // actually fine (session missing because it already closed, or newly responsive) still
        // 404s as before — this only recovers a target that's genuinely still stuck.
        if (targetId && this.browser) {
          const recovery = await this.tryRecoverUnknownTarget(targetId);
          if (recovery.closed) {
            const url = listPageTargets(this.browser).find(({ info }) => info.targetId === targetId)?.info.url;
            res
              .writeHead(200, { 'content-type': 'application/json' })
              .end(
                JSON.stringify({
                  handled: true,
                  closedTarget: true,
                  message: `Tab ${targetId}${url ? ` (${url})` : ''} was closed because its dialog could not be addressed directly (unknown dialog).`,
                }),
              );
            return;
          }
          if (recovery.refused) {
            // FR2-04 escalation-1, decision 1+2 (GAP-245/246): `targetId`'s history PROVES it
            // cannot be hiding a dialog (it was observed responding at some point after its
            // listener went live) — never close it, regardless of whether a still-in-question
            // candidate exists elsewhere.
            res
              .writeHead(409, { 'content-type': 'application/json' })
              .end(
                JSON.stringify({
                  error: recovery.redirectTo
                    ? `tab ${targetId} is busy, but its own history proves it cannot be hiding a dialog (it was ` +
                      `observed responding earlier) — the still-unresolved candidate is tab ${recovery.redirectTo}` +
                      `${recovery.redirectUrl ? ` (${recovery.redirectUrl})` : ''} — re-run "sutradhar dialog" and target that tab instead.`
                    : `tab ${targetId} is busy or unresponsive, but its own history proves it cannot be hiding a ` +
                      'dialog (it was observed responding earlier, likely just a slow script now) — no automatic ' +
                      'recovery was attempted. If you are sure it is a stuck dialog, "sutradhar close" ends the session.',
                  confirmedSafe: true,
                  holderTargetId: recovery.redirectTo,
                }),
              );
            return;
          }
          if (recovery.redirectTo) {
            // FR2-04 fix-3/GAP-236, decision point 3: `targetId` is only collaterally blocked by
            // sharing a renderer with the ACTUAL (never-confirmed, still-in-question) holder —
            // refuse to close it, and name the real holder so the caller (cmdDialog) can report it
            // plainly rather than silently acting on whichever tab it happened to be asked about.
            res
              .writeHead(409, { 'content-type': 'application/json' })
              .end(
                JSON.stringify({
                  error:
                    `tab ${targetId} is unresponsive because it shares a browser process with tab ` +
                    `${recovery.redirectTo}${recovery.redirectUrl ? ` (${recovery.redirectUrl})` : ''}, which actually holds the ` +
                    'dialog — re-run "sutradhar dialog" and target that tab instead.',
                  holderTargetId: recovery.redirectTo,
                }),
              );
            return;
          }
        }
        res
          .writeHead(404, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: 'No dialog is open on that tab' }));
        return;
      }
      // GAP-223: if the caller told us which specific dialog it decided on, refuse to apply that
      // decision to a DIFFERENT dialog that has since replaced it on the same target (e.g. a
      // confirm the caller listed, then a prompt opens before the caller's `handle` call lands).
      if (dialogId !== undefined && dialog.id !== dialogId) {
        res
          .writeHead(409, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: 'the dialog on that tab has changed since it was listed; re-run "sutradhar dialog" to see the current one' }));
        return;
      }
      const timer = this.graceTimers.get(targetId!);
      if (timer) {
        clearTimeout(timer);
        this.graceTimers.delete(targetId!);
      }
      try {
        await session.send('Page.handleJavaScriptDialog', { accept: !!accept, promptText }, { timeout: 5000 });
        dialog.handled = true;
        this.dialogs.delete(targetId!);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ handled: true }));
      } catch (err) {
        res
          .writeHead(409, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
  }

  public async stop(reason: string): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    for (const timer of this.graceTimers.values()) clearTimeout(timer);
    this.graceTimers.clear();
    for (const session of this.sessions.values()) {
      await session.detach().catch(() => {});
    }
    this.sessions.clear();
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
    if (this.browser && this.browser.connected) {
      await this.browser.disconnect().catch(() => {});
    }
    await this.opts.onExit(reason);
  }
}

function idOf(target: Target): string {
  return (target as unknown as { _targetId: string })._targetId;
}
