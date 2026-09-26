/**
 * @file packages/browser/src/session/dialog-cdp.ts
 * @description FR2-04: raw-CDP dialog primitives used by the CLI's dialog gate/warden to detect
 * and handle a native dialog (alert/confirm/prompt/beforeunload) left open by an EARLIER,
 * already-exited process — a page's `Puppeteer.Page` (and therefore `BrowserTab`) only exists
 * within the process that created it, so a later process reattaching over CDP needs a way to
 * observe/act on a dialog without ever calling `browser.pages()`/`target.page()`, both of which
 * BLOCK on a dialog-blocked renderer (see FR2-04 spec §0.2 C5/C6) — these helpers use only
 * browser-level (`Target.attachToTarget`) and dialog-scoped CDP calls, never Puppeteer's own
 * `Page` object.
 *
 * Every function here takes real CDP types (`Browser`/`CDPSession`/`Target`) but never imports
 * or constructs a `Page` — that's the whole point.
 */
import type { Browser, CDPSession, Target } from 'puppeteer-core';

export interface PageTargetInfo {
  readonly targetId: string;
  readonly url: string;
  /** FR2-04 fix-3/GAP-236: the CDP target id of the target that OPENED this one (`window.open()`/
   *  a `target=_blank` link), when known — `Target.getTargetInfo`'s `openerId`, surfaced by
   *  Puppeteer's `Target.opener()`. Populated for every target this module touches (not just
   *  popups) so {@link attributeDialogHolders} can tell a popup apart from the long-lived opener
   *  it shares a renderer process with — see that function's doc comment for why the liveness
   *  probe alone (audit-3 finding, GAP-236) can never make this distinction on its own: both
   *  targets share one renderer, so a probe that only asks "responsive or not" times out on BOTH
   *  identically, and audit-3 found the old code (sorting by nothing in particular) attributed the
   *  block to whichever target happened to sort first — usually the opener, the user's healthy
   *  tab, not the popup actually holding the dialog. `openerId` is a browser-level field (no
   *  renderer round trip), so reading it never blocks even while the renderer itself is wedged. */
  readonly openerTargetId?: string;
}

export interface ObservedDialog {
  readonly targetId: string;
  readonly url: string;
  readonly type: string;
  readonly message: string;
  readonly defaultPrompt?: string;
  readonly openedAt: string;
  readonly source: 'event' | 'hint';
  /** GAP-223: a unique identity for THIS specific dialog instance (not just its target), so a
   *  late `handle()` call decided against an earlier `list()` snapshot can be verified to still
   *  refer to the same dialog before it's applied, rather than silently landing on whatever new
   *  dialog now occupies the same `targetId` (e.g. a confirm->prompt chain). Only the warden
   *  populates this (`DialogWarden`); a `DirectCdpBroker` dialog is always a live, single-shot
   *  read with no persistent identity to protect. */
  readonly id?: string;
  /** FR2-04 fix-3/GAP-236, decision point 1: set to another target's id when THIS entry is not
   *  itself a dialog holder but is only reported because {@link attributeDialogHolders} found it
   *  collaterally blocked by sharing a renderer with `blockedBy`. The gate still needs to know
   *  about it (the shared renderer really is unresponsive, so a command run against THIS target
   *  right now would still hang) but must never treat it as an independently addressable dialog:
   *  never pass it to `handleDialogOnTarget`/`closeTargetAtBrowserLevel` on its own, and never
   *  auto-select it as "the" dialog to accept/dismiss (see `dialog-cli.ts`'s `selectDialog` and
   *  `dialog-broker.ts`'s `runDialogGate`, both of which skip a `blockedBy`-tagged entry). */
  readonly blockedBy?: string;
}

export type LivenessState = 'responsive' | 'blocked' | 'error';

/**
 * Connect to `wsEndpoint` for dialog work only (never calls `.pages()`), racing the connect
 * itself against `timeoutMs` so a genuinely dead/unreachable endpoint can't hang the CLI's gate.
 * Returns `undefined` on any failure or timeout — the caller (the gate) treats that as "unknown"
 * and falls through to today's normal attach path, which may itself self-heal.
 */
export async function connectForDialogs(
  wsEndpoint: string,
  timeoutMs: number,
  connect: (endpoint: string) => Promise<Browser> = async (endpoint) => {
    const puppeteer = await import('puppeteer-core');
    return puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null });
  },
): Promise<Browser | undefined> {
  try {
    const browser = await Promise.race([
      connect(wsEndpoint),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('connectForDialogs timeout')), timeoutMs)),
    ]);
    return browser;
  } catch {
    return undefined;
  }
}

/** Every real page target on `browser`, in `targets()` order (the same order `attach()` adopts
 *  pages in) — non-page targets (service workers, background pages, the browser target itself)
 *  are dropped, since a gate/warden has nothing useful to check on them.
 *
 *  FR2-04 fix-3/GAP-238: `about:blank` targets are DELIBERATELY no longer excluded here. fix-2
 *  excluded them because the gate/`DirectCdpBroker` "has nothing useful to check" on a blank
 *  page — true for a NORMAL blank tab, but audit-3 found the exact case where that reasoning
 *  breaks: once a popup that alerts during construction has its (wrongly-attributed) opener
 *  closed by recovery, the popup itself is left as `about:blank` (it never got a chance to
 *  navigate) and STILL has a real dialog open on it — excluding it here made it invisible to
 *  every later gate check, so the next command hung ~180s and silently landed on the wrong tab
 *  (GAP-238, 8/8). A blank target that is genuinely idle just probes as `responsive` and costs one
 *  extra `Performance.getMetrics` round trip (run in parallel with every other target — see
 *  `LIVENESS_PROBE_MS`'s callers, fix-3 point 5) — negligible next to the cost of missing a real
 *  dialog entirely. */
export function listPageTargets(browser: Browser): Array<{ info: PageTargetInfo; target: Target }> {
  return browser
    .targets()
    .filter((t) => t.type() === 'page')
    .map((target) => ({
      info: { targetId: targetIdOf(target), url: target.url(), openerTargetId: openerIdOf(target) },
      target,
    }));
}

/** Internal Puppeteer field, same one `BrowserTab.targetId` reads — see that getter's doc
 *  comment. Kept as a free function here since `dialog-cdp.ts` never touches `BrowserTab`. */
function targetIdOf(target: Target): string {
  return (target as unknown as { _targetId: string })._targetId;
}

/** `Target.opener()` is public API (`pp:api/Target.ts`, backed by `TargetInfo.openerId`, a
 *  browser-level field) — returns the CDP target id of whichever target opened `target` via
 *  `window.open()`/`target=_blank`, or `undefined` for a target nobody opened (a normal
 *  navigated tab, or the browser's first tab). Guarded with optional chaining: test doubles for
 *  `Target` in this codebase's unit tests predate this field and don't implement `.opener()`. */
function openerIdOf(target: Target): string | undefined {
  const opener = (target as unknown as { opener?: () => Target | undefined }).opener?.();
  return opener ? targetIdOf(opener) : undefined;
}

/**
 * Is `session`'s page currently blocked by an open native dialog? FR2-04 fix-2/GAP-228:
 * `Runtime.evaluate` (the original signal) is NOT decidable — audit-2's signal research
 * (evidence/FR2-04/audit-2/signal-probe-2.json, re-verified live in fix-2/signal-reverify/)
 * showed it times out under BOTH a genuinely dialog-blocked renderer AND a page merely running a
 * long synchronous script, so probing every target with it (as GAP-220's original design
 * intended) false-blocked busy-script cases (N9/N10, fix-1's disclosed reason for narrowing the
 * probe to only-never-acked targets — which is exactly what let GAP-228's acked-but-missed
 * blank-popup shape through 26/26).
 *
 * `Performance.getMetrics` is decidable: it answers immediately under a busy synchronous script
 * (it's served by the browser/page-agent side, not queued behind the renderer's blocked JS task
 * queue the same way `Runtime.evaluate` is) but times out for the full duration a native dialog
 * (alert/confirm/prompt/beforeunload) is open, because CDP itself suspends per-frame protocol
 * command dispatch while a `Page.javascriptDialogOpening` is unresolved. This lets fix-2 safely
 * probe EVERY page target with no tracked dialog (GAP-228's decision 1) without reintroducing the
 * N9/N10 false-block fix-1 hit with the old signal.
 */
export async function livenessProbe(session: CDPSession, ms: number): Promise<LivenessState> {
  try {
    await session.send('Performance.getMetrics', undefined, { timeout: ms });
    return 'responsive';
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (/timed out/i.test(message)) return 'blocked';
    return 'error';
  }
}

/**
 * FR2-04 fix-3, decision point 1 (GAP-236): a same-renderer popup and its opener both time out on
 * {@link livenessProbe} identically — the probe is a renderer-level signal (Chromium suspends
 * per-frame CDP dispatch for every target hosted by a blocked renderer process while a dialog's
 * modal IPC is unresolved, not just for the one target that actually owns the dialog), so it
 * structurally cannot by itself tell "the target holding the dialog" apart from "an unrelated
 * sibling target that merely shares its process". audit-3 found fix-2's code picked whichever
 * target happened to sort first (usually the long-lived opener — the user's healthy tab), closed
 * IT during recovery, and left the actual popup still blocked (GAP-236, 8/8 single-popup).
 *
 * `openerId` (a BROWSER-level field — `Target.getTargetInfo`, no renderer round trip, so it's
 * always readable even while the renderer is fully wedged) gives a real, structural way to break
 * the tie for the specific relationship this item's own evidence is built on (a popup and the
 * page that opened it): given a set of targets that are ALL blocked right now, walk each target's
 * opener chain — if target A's opener B is ALSO in the blocked set, A is presumed the actual
 * holder (a popup script commonly starts running, and can alert()/confirm() synchronously, before
 * the popup has navigated anywhere) and B is reported as merely collaterally blocked BY A, never
 * as its own independent "unknown" dialog (decision point 1's exact requirement). The walk repeats
 * for a longer chain (grandparent -> parent -> child, all sharing one renderer) until it reaches a
 * target that isn't the opener of any other still-blocked target — that leaf is the holder.
 *
 * A blocked target with no opener relationship to any OTHER blocked target (the common case: one
 * tab, one dialog; or two genuinely independent popups from unrelated `window.open()` calls, each
 * in their own renderer) is its own holder, exactly like before this function existed — this is
 * deliberately a narrow, additive fix for the one relationship this item's evidence demonstrates
 * (opener/popup), not a claim that it resolves every conceivable multi-target ambiguity.
 *
 * Returns a map from every blocked target's id to either `undefined` (this target IS the holder —
 * report/recover it as its own dialog) or the holder's target id (this target is collaterally
 * blocked — report it as "blocked by tab <holder>", never hand it to `handleDialogOnTarget` or
 * `closeTargetAtBrowserLevel` as if it had a dialog of its own).
 */
export function attributeDialogHolders(
  blocked: ReadonlyArray<{ readonly targetId: string; readonly openerTargetId?: string; readonly discoveredAt?: number }>,
): Map<string, string | undefined> {
  type Entry = (typeof blocked)[number];
  const byId = new Map(blocked.map((b) => [b.targetId, b] as const));
  // Group every blocked target that has a BLOCKED opener under that opener's id — only a
  // relationship where BOTH ends are currently blocked is evidence of anything (an opener whose
  // popup is fine is just an ordinary responsive-or-not target on its own).
  const childrenByOpener = new Map<string, Entry[]>();
  for (const b of blocked) {
    if (b.openerTargetId && byId.has(b.openerTargetId)) {
      const arr = childrenByOpener.get(b.openerTargetId) ?? [];
      arr.push(b);
      childrenByOpener.set(b.openerTargetId, arr);
    }
  }
  const isOpenerOfBlocked = new Set(childrenByOpener.keys());

  // The ultimate holder of everything rooted at `id`: if `id` has blocked children, it's whatever
  // the newest child's OWN subtree ultimately resolves to (handles a chain of any depth); a target
  // with no blocked children is a leaf and holds its own dialog.
  const memo = new Map<string, string>();
  const visiting = new Set<string>();
  function ultimateHolder(id: string): string {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return id; // cycle guard — never actually reachable via real openerId chains
    visiting.add(id);
    const children = childrenByOpener.get(id);
    const result =
      !children || children.length === 0
        ? id
        : ultimateHolder([...children].sort((x, y) => (y.discoveredAt ?? 0) - (x.discoveredAt ?? 0))[0]!.targetId);
    visiting.delete(id);
    memo.set(id, result);
    return result;
  }

  const result = new Map<string, string | undefined>();
  for (const b of blocked) {
    let holder: string;
    if (isOpenerOfBlocked.has(b.targetId)) {
      // An opener (of at least one blocked child): defer entirely to its subtree's holder.
      holder = ultimateHolder(b.targetId);
    } else if (b.openerTargetId && byId.has(b.openerTargetId)) {
      // A leaf that itself has a blocked opener: it's the holder only if it's the newest among
      // its OWN siblings under that same opener; otherwise every sibling defers to whichever one
      // the newest sibling's subtree ultimately resolves to (kept consistent with `ultimateHolder`
      // rather than pointing at the raw newest sibling directly, so a longer chain still resolves
      // to one single leaf everyone agrees on).
      const siblings = childrenByOpener.get(b.openerTargetId)!;
      const newestSibling = [...siblings].sort((x, y) => (y.discoveredAt ?? 0) - (x.discoveredAt ?? 0))[0]!;
      holder = newestSibling.targetId === b.targetId ? b.targetId : ultimateHolder(newestSibling.targetId);
    } else {
      // No opener relationship to any other currently-blocked target at all — its own holder,
      // exactly like before this function existed (the common single-tab, or independent-popups,
      // case).
      holder = b.targetId;
    }
    result.set(b.targetId, holder === b.targetId ? undefined : holder);
  }
  return result;
}

/**
 * FR2-04 fix-3, decision point 5 (GAP-241): probes every entry in `targets` CONCURRENTLY instead
 * of one after another. audit-3 measured the old serial loop (`LIVENESS_PROBE_MS`, 400ms, per
 * target) scaling linearly with tab count — 14 same-renderer tabs took ~5.6s, which blew past the
 * CLI's own 5s outer wait cap on the whole gate check and made THAT cap's own timeout handler
 * treat "didn't finish in time" as "clear" (fail OPEN, the opposite of decision point 5's
 * requirement). Running every probe at once bounds the whole round to roughly one probe's own
 * timeout (`ms`) regardless of how many targets there are — each individual `livenessProbe` call
 * already has its own bounded timeout, so nothing here can hang past `ms` plus normal CDP
 * scheduling overhead.
 */
export async function probeTargetsConcurrently<T extends { readonly targetId: string }>(
  entries: readonly T[],
  probe: (entry: T) => Promise<LivenessState>,
): Promise<Map<string, LivenessState>> {
  const results = await Promise.all(
    entries.map(async (entry) => [entry.targetId, await probe(entry)] as const),
  );
  return new Map(results);
}

/**
 * Subscribe to dialog events on `session`, send `Page.enable` (NOT awaited past `listenMs` —
 * Step 1's E2 found a fresh session's `Page.enable` itself hangs while a dialog is open), and
 * return whatever `Page.javascriptDialogOpening` events arrived within the window. An empty
 * result is itself the Branch-D-relevant observation ("no re-emitted event") — Step 1 found this
 * happens for a FRESH session (O1 false), which is why Branch W exists at all.
 */
export async function collectDialogEvents(
  session: CDPSession,
  info: PageTargetInfo,
  listenMs: number,
): Promise<ObservedDialog[]> {
  const events: ObservedDialog[] = [];
  const onOpening = (e: { type: string; message: string; defaultPrompt?: string }) => {
    events.push({
      targetId: info.targetId,
      url: info.url,
      type: e.type,
      message: e.message,
      defaultPrompt: e.defaultPrompt,
      openedAt: new Date().toISOString(),
      source: 'event',
    });
  };
  session.on('Page.javascriptDialogOpening', onOpening);
  // Deliberately not awaited beyond listenMs — a fresh Page.enable can itself block for the
  // full protocolTimeout while a dialog is open (Step 1 E2.pageEnable).
  session.send('Page.enable').catch(() => {});
  await new Promise((r) => setTimeout(r, listenMs));
  session.off('Page.javascriptDialogOpening', onOpening);
  return events;
}

/** Accept or dismiss the dialog open on `session`'s target. Throws the raw CDP error message
 *  unchanged (e.g. `"No dialog is showing"`) — the caller (the gate / `sutradhar dialog`)
 *  decides how to report it. */
export async function handleDialogOnTarget(
  session: CDPSession,
  accept: boolean,
  promptText: string | undefined,
  ms: number,
): Promise<void> {
  await session.send('Page.handleJavaScriptDialog', { accept, promptText }, { timeout: ms });
}

/**
 * GAP-230: closes `targetId` at the BROWSER level (`Target.closeTarget`, sent on the browser's
 * own root connection, not a per-target session send) — the escape hatch for a dialog this
 * process has no way to identify or resolve directly (an `unknown` dialog: the target's
 * `Page.enable` never acked, so there is no `Page.javascriptDialogOpening` payload to act on and
 * `Page.handleJavaScriptDialog` on that target's session either hangs or fails "No dialog is
 * showing"). `Target.closeTarget` does not go through the blocked renderer at all — Chrome's
 * browser process tears the target down directly — so it works even while the tab is completely
 * wedged behind a dialog it never told us about. Confirmed live (fix-2/live-verify):
 * `unknown-recovery-probe` closes such a tab in well under a second with the session's OTHER
 * tabs (and the warden itself) unaffected.
 */
export async function closeTargetAtBrowserLevel(browser: Browser, targetId: string): Promise<void> {
  const connection = (browser as unknown as { _connection?: { send: (method: string, params?: unknown) => Promise<unknown> } })
    ._connection;
  if (!connection) throw new Error('no browser-level CDP connection available to close the target');
  await connection.send('Target.closeTarget', { targetId });
}
