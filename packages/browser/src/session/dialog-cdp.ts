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
 *  pages in) — `about:blank` and non-page targets (service workers, background pages, the
 *  browser target itself) are dropped, since a gate/warden has nothing useful to check on them. */
export function listPageTargets(browser: Browser): Array<{ info: PageTargetInfo; target: Target }> {
  return browser
    .targets()
    .filter((t) => t.type() === 'page' && t.url() !== 'about:blank')
    .map((target) => ({
      info: { targetId: targetIdOf(target), url: target.url() },
      target,
    }));
}

/** Internal Puppeteer field, same one `BrowserTab.targetId` reads — see that getter's doc
 *  comment. Kept as a free function here since `dialog-cdp.ts` never touches `BrowserTab`. */
function targetIdOf(target: Target): string {
  return (target as unknown as { _targetId: string })._targetId;
}

/** Is `session`'s page currently answering `Runtime.evaluate`? A dialog-blocked renderer never
 *  responds until the dialog closes (FR2-04 spec §0.2 C13), so this is the gate's core "is a
 *  dialog (or a long script) blocking this tab right now" signal. */
export async function livenessProbe(session: CDPSession, ms: number): Promise<LivenessState> {
  try {
    await session.send('Runtime.evaluate', { expression: '1', returnByValue: true }, { timeout: ms });
    return 'responsive';
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (/timed out/i.test(message)) return 'blocked';
    return 'error';
  }
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
