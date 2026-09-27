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
  /** FR2-04 escalation-1, decision 1: mirrors {@link DialogAttribution.confirmedSafe} — true means
   *  history proves this target cannot be hiding a dialog (see that doc comment). Only ever set on
   *  a `source: 'hint'` entry (a real, tracked `source: 'event'` dialog is never liveness-inferred
   *  in the first place). Never selected/closed as a dialog holder. */
  readonly confirmedSafe?: boolean;
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

/** Input to {@link attributeDialogHolders} for one currently-blocked target. */
export interface DialogAttributionInput {
  readonly targetId: string;
  readonly openerTargetId?: string;
  readonly discoveredAt?: number;
  /** FR2-04 escalation-1, decision 1 (GAP-245/246/247): true when THIS target's `Page.enable`
   *  ack'd AND at least one liveness probe taken after that ack found it responsive, at any point
   *  since (see `DialogWarden`'s `confirmedResponsiveSince`). Such a target's dialog listener has
   *  been live and silent the whole time it could have hidden something — any dialog opening on it
   *  would already exist as a tracked, typed `Page.javascriptDialogOpening` event, so it
   *  STRUCTURALLY cannot be the source of an untracked "unknown" dialog. `false`/`undefined` means
   *  "never confirmed" — the target could genuinely be hiding a dialog the warden missed. */
  readonly confirmedSafe?: boolean;
}

/** FR2-04 escalation-2 (GAP-252): one entry of the OPTIONAL second argument to
 *  {@link attributeDialogHolders} — every other currently-known real page target, blocked or not.
 *  Only `targetId`/`openerTargetId` are needed: this is used purely to let a blocked candidate's
 *  opener-chain walk continue THROUGH a target that is known to exist but is not itself in the
 *  `blocked` array (almost always because it answered its liveness probe just fine). Without this,
 *  two same-renderer popups whose shared opener never blocked have no edge connecting them at all
 *  (see that function's doc comment for the exact GAP-252 shape and why this fixes it). A `blocked`
 *  entry doubles as its own `KnownTargetLink`, so callers only need to pass the targets that are
 *  NOT in `blocked` here (though passing the full known set is harmless — see the implementation). */
export interface KnownTargetLink {
  readonly targetId: string;
  readonly openerTargetId?: string;
}

/** Output of {@link attributeDialogHolders} for one currently-blocked target. */
export interface DialogAttribution {
  /** Set when this target is not itself eligible to be treated as the dialog holder — points at
   *  whichever target (a candidate holder still in question) actually is, when one exists in the
   *  same opener-chain component. `undefined` with `confirmedSafe: false` means THIS target is the
   *  presumed holder — the only entry `handleDialogOnTarget`/`closeTargetAtBrowserLevel` may ever
   *  be aimed at for a liveness-inferred ("unknown") dialog. */
  readonly blockedBy?: string;
  /** Mirrors the input's `confirmedSafe` (see {@link DialogAttributionInput}) — carried onto the
   *  output so callers never need to re-cross-reference the input array. A target with
   *  `confirmedSafe: true` must NEVER be selected/closed as a dialog holder, regardless of
   *  `blockedBy` (which is purely informational for it — see doc comment below). */
  readonly confirmedSafe: boolean;
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
 * page that opened it): among the targets that are still CANDIDATES (see below), walk each
 * target's opener chain — if target A's opener B is ALSO a candidate, A is presumed the actual
 * holder (a popup script commonly starts running, and can alert()/confirm() synchronously, before
 * the popup has navigated anywhere) and B is reported as merely collaterally blocked BY A, never
 * as its own independent "unknown" dialog (decision point 1's exact requirement). The walk repeats
 * for a longer chain (grandparent -> parent -> child, all sharing one renderer) until it reaches a
 * target that isn't the opener of any other still-candidate target — that leaf is the holder.
 *
 * **FR2-04 escalation-1 (audit-4 GAP-245/246/247): this "current topology" reasoning alone is not
 * sufficient — it was fix-3's whole design, and audit-4 found it wrong in both directions:**
 * - GAP-245: a target that merely SHARES a blocked renderer with a genuinely busy (not
 *   dialog-holding) sibling — e.g. an opener running a slow synchronous XHR with an idle
 *   same-renderer popup — looks structurally identical to a real popup/opener dialog pair. Fix-3
 *   picked "the newest" as the holder and closed it, even though nothing there was ever a dialog.
 * - GAP-246: fix-3's flip-side "isolated = safe, refuse recovery" rule (formerly implemented by
 *   the caller, not this function) then made a REAL dialog in a genuinely isolated new tab (e.g. an
 *   ordinary `target=_blank` link, always its own renderer) permanently unrecoverable, because it
 *   has no sibling to be "attributed" against at all.
 *
 * The fix is `confirmedSafe` (decision 1): a target the warden has ACTUALLY watched respond at
 * least once since its dialog listener went live cannot be hiding a dialog — it is excluded from
 * being a `candidate` holder entirely (its dialog listener would have already turned any dialog on
 * it into a real, typed, tracked event). A target that has NEVER been confirmed responsive remains
 * a `candidate` — including one with no sibling at all (decision 2: GAP-246's exact fix, replacing
 * fix-3's blanket "isolated = refuse"). Confirmed-safe targets are never candidates, so a busy but
 * confirmed-safe sibling can no longer make an innocent candidate look like a holder by mere
 * association (GAP-245's fix) — see `whyItHoldsWithWardenUp`/GAP-247 in
 * `.ai/loop/field-report-2/evidence/FR2-04/audit-4/audit-findings.json` for why the ORIGINAL
 * newest-leaf premise ("nothing in a blocked renderer can create a newer target, so an unobserved
 * dialog is always in the newest target — PROVIDED every older target was tracked continuously
 * from before the dialog opened") still holds among candidates alone: a confirmed-safe target
 * proves it WAS tracked and silent, so removing it from consideration doesn't create a new gap; a
 * never-confirmed target is exactly the case the original premise already covered.
 *
 * Returns, for every blocked target: `confirmedSafe` (mirrors the input) and `blockedBy` — set to
 * the id of a still-in-question candidate holder that shares this target's opener-chain component
 * (informational once `confirmedSafe` is true — a confirmed-safe target is never itself a holder
 * regardless of `blockedBy`), or `undefined` when this target has no such candidate anywhere in
 * its component (a confirmed-safe target with `blockedBy: undefined` is safe with no known cause;
 * a NON-confirmed-safe target with `blockedBy: undefined` IS the presumed holder — the only kind
 * of entry recovery may ever act on).
 *
 * **Escalation-1 correction (found LIVE re-verifying GAP-245, attrib-attack-probe.mjs's
 * `rapid-gap100`):** an earlier version of this function built TWO separate graphs — one over
 * candidates only (for deciding the holder) and one over the full blocked set (for messaging).
 * That silently broke sibling attribution whenever the SHARED OPENER happened to be confirmed-safe:
 * excluding it from the candidate-only graph didn't just stop IT from being a holder (correct) — it
 * also deleted the EDGE connecting its two candidate children to each other, so two genuine
 * siblings (an older, innocent popup and a newer one that actually alerts) stopped being attributed
 * against each other at all and each became its own independent "holder", making `dialog accept`
 * close the innocent one FIRST (3/3 live). The fix below uses ONE graph, built from the FULL
 * blocked set exactly like fix-3's original — a confirmed-safe node is walked THROUGH (it can
 * still connect two candidates on either side of it) but is never itself an acceptable answer,
 * so the recursion transparently skips over it and keeps searching its children for a real
 * candidate — preserving both fix-3's original connectivity and decision 1's safety rule.
 *
 * **Escalation-2 fix (GAP-252, audit-5 A5-03): two popups whose shared opener never blocks at
 * all.** Everything above still assumes the opener chain is built purely from the `blocked` array
 * — fine for "a popup and its opener", where the opener is usually blocked too (it shares the same
 * renderer). audit-5 found a shape that breaks that assumption: two popups opened to a DIFFERENT
 * origin than their (unblocked, still perfectly responsive) opener share a renderer WITH EACH
 * OTHER, but the opener itself never blocks — it's a separate process. Since the opener was never
 * in `blocked` at all, the old code never built an edge from it to either popup, so the two popups
 * had no connection to each other whatsoever: each resolved to itself, both got reported as "the
 * holder", and `dialog accept` closed the innocent older one first (3/3 live, reachable via
 * ordinary CLI use — typing into a field that opens one same-site popup per keystroke). The fix is
 * the optional `allKnown` parameter: it lets `findRoot`'s walk continue through an opener id that
 * is KNOWN (the caller just probed it and found it responsive) even though it isn't itself
 * BLOCKED, and `resolve()` treats such a node exactly like a confirmed-safe one — a transparent
 * pass-through, never itself a candidate answer, because a target that just answered its own
 * liveness probe cannot simultaneously be hiding an open dialog. This restores a single,
 * deterministic holder among the sibling popups (the newest, same premise as everywhere else in
 * this function) instead of two independent "holders" that both get closed in turn. A genuinely
 * isolated single popup (no sibling, opener present or not) is unaffected — `findRoot`/`resolve`
 * reduce to exactly their pre-fix behavior when there is only one blocked candidate in the
 * component, preserving GAP-236/246.
 */
export function attributeDialogHolders(
  blocked: readonly DialogAttributionInput[],
  allKnown: readonly KnownTargetLink[] = [],
): Map<string, DialogAttribution> {
  const byId = new Map(blocked.map((b) => [b.targetId, b] as const));
  // FR2-04 escalation-2 (GAP-252): `linkById` is the union of every BLOCKED target plus every
  // OTHER currently-known target `allKnown` names (typically every real page target the caller
  // just probed, blocked or not) — used only to decide whether an opener id is a real, known
  // target worth walking the chain through. A responsive (non-blocked) opener is real and known,
  // it just isn't itself a `DialogAttribution` candidate.
  const linkById = new Map<string, KnownTargetLink>();
  for (const k of allKnown) linkById.set(k.targetId, k);
  for (const b of blocked) linkById.set(b.targetId, b);
  const openerOf = (id: string): string | undefined => linkById.get(id)?.openerTargetId;

  const childrenByOpener = new Map<string, DialogAttributionInput[]>();
  for (const b of blocked) {
    if (b.openerTargetId && linkById.has(b.openerTargetId)) {
      const arr = childrenByOpener.get(b.openerTargetId) ?? [];
      arr.push(b);
      childrenByOpener.set(b.openerTargetId, arr);
    }
  }

  // For `id`: which CANDIDATE (never-confirmed-safe, actually BLOCKED) target, among `id` itself
  // and everything reachable through its blocked-children subtree, is the presumed dialog holder —
  // `undefined` if the WHOLE subtree (every candidate-eligible node in it) is confirmed-safe OR
  // `id` itself isn't even a blocked target (GAP-252: a responsive opener reached only via
  // `findRoot`'s walk — see that function). Among several children, prefer whichever child's OWN
  // resolved answer belongs to the newest child (fix-3's original newest-leaf premise) — a child
  // whose subtree resolves to `undefined` (all confirmed-safe) is skipped entirely rather than
  // treated as a tie-breaking candidate itself.
  const memo = new Map<string, string | undefined>();
  const visiting = new Set<string>();
  function resolve(id: string): string | undefined {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return undefined; // cycle guard — never actually reachable via real openerId chains
    visiting.add(id);
    const children = childrenByOpener.get(id) ?? [];
    const resolvedChildren = children
      .map((child) => ({ child, holder: resolve(child.targetId) }))
      .filter((x): x is { child: DialogAttributionInput; holder: string } => x.holder !== undefined)
      .sort((a, b) => (b.child.discoveredAt ?? 0) - (a.child.discoveredAt ?? 0));
    // `info` is `undefined` exactly when `id` is a real, KNOWN target that is not itself in the
    // blocked set — i.e. a currently-responsive opener reached only through `findRoot`'s walk
    // (GAP-252). Being responsive right now is direct proof it isn't hiding an unresolved dialog,
    // so it's treated exactly like a confirmed-safe blocked node: never itself a result, but still
    // a transparent pass-through connecting its candidate children to each other.
    const info = byId.get(id);
    const result = resolvedChildren.length > 0 ? resolvedChildren[0]!.holder : info && !info.confirmedSafe ? id : undefined;
    visiting.delete(id);
    memo.set(id, result);
    return result;
  }

  // The topmost ancestor of `id` within the KNOWN set (its own opener chain, followed as far as it
  // still leads to another KNOWN target — GAP-252: not just another BLOCKED one, so a chain that
  // passes through a currently-responsive-but-known opener still reaches its true root instead of
  // stopping short at that opener). Every member of one opener-chain component shares exactly one
  // root, so resolving from the root once (memoized) gives every member the SAME answer, which is
  // what makes a confirmed-safe (or merely responsive) pass-through node connect its candidate
  // children correctly instead of splitting them into separate, independently-resolved subtrees.
  function findRoot(id: string): string {
    let cur = id;
    for (let i = 0; i <= blocked.length + allKnown.length; i++) {
      const opener = openerOf(cur);
      if (opener && linkById.has(opener) && opener !== cur) {
        cur = opener;
      } else {
        return cur;
      }
    }
    return cur; // defensive only — real openerId chains are always acyclic and finite
  }

  const result = new Map<string, DialogAttribution>();
  for (const b of blocked) {
    const holder = resolve(findRoot(b.targetId));
    result.set(b.targetId, { blockedBy: holder === b.targetId ? undefined : holder, confirmedSafe: !!b.confirmedSafe });
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
