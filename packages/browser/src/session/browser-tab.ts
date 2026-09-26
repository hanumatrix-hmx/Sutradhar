/**
 * @file packages/browser/src/session/browser-tab.ts
 * @description Domain class for managing single tab lifecycle, navigation, and page interaction.
 *
 * Also observes the underlying page for events an autonomous agent needs to react to but
 * can't discover just by reading the DOM: native dialogs (alert/confirm/prompt), console
 * messages, uncaught page errors, and network activity. Each is published through the
 * optional {@link EventBus} (for persistence/streaming consumers) and kept in a small bounded
 * in-memory buffer so a caller driving via MCP tools — which has no push-notification channel
 * between tool calls — can retrieve them on demand.
 */

import {
  TabId,
  SessionId,
  BrowserTabDto,
  BrowserActionDto,
  BrowserActionResultDto,
} from '@sutradhar/contracts';
import { EventBus } from '@sutradhar/events';
import { Dialog, KeyInput, Page } from 'puppeteer-core';

/** How long a native dialog is left pending before it's auto-resolved so the page doesn't
 *  hang forever if nothing ever calls {@link BrowserTab.handleDialog}. Deliberately generous
 *  (matches downloadFile's timeout) — a real caller typically checks {@link
 *  BrowserTab.getPendingDialog} and then calls {@link BrowserTab.handleDialog} as two separate
 *  round trips, and 5s (the original default) was found live to be too tight for that: an
 *  agent/tool round trip of even a couple of seconds per call could burn the whole window
 *  before the second call ever reached the dialog, silently auto-dismissing it instead. */
const DEFAULT_DIALOG_TIMEOUT_MS = 30000;

/** How long a `beforeunload` dialog specifically is left pending before auto-dismissal — much
 *  shorter than {@link DEFAULT_DIALOG_TIMEOUT_MS}. A `beforeunload` dialog uniquely blocks an
 *  in-flight `navigate()` call, which races its own Puppeteer `page.goto()` timeout (also
 *  30000ms by default) — using the same 30s window for both meant the auto-dismiss safety net
 *  NEVER actually rescued the navigation in practice: both timers expired at essentially the
 *  same instant, so `navigate()` always failed with its own "Navigation timeout of 30000ms
 *  exceeded" instead of the dialog being dismissed in time to let it through. Found live: every
 *  single navigation away from a page with a `beforeunload` handler (extremely common — any
 *  form/editor/checkout with an unsaved-changes warning) took the full 30 seconds and then
 *  failed outright, confirmed reproducible across repeated runs (see PROB-038). Unlike
 *  alert/confirm/prompt (where a real agent round trip genuinely benefits from a generous
 *  window to read and react to the dialog before acting), there's no comparable "give the agent
 *  time to decide" case for `beforeunload` specifically — an automated navigate() call already
 *  expresses clear intent to leave the page, so a short window that reliably beats the
 *  navigation timeout is the correct default. */
const BEFOREUNLOAD_DIALOG_TIMEOUT_MS = 3000;

const MAX_CONSOLE_LOGS = 200;
const MAX_PAGE_ERRORS = 50;
const MAX_NETWORK_LOG = 200;
const MAX_ACTION_HISTORY = 200;

/** One entry in a tab's action history — the MCP-appropriate shape of "session replay data";
 *  a caller that wants a durable record can fetch this and persist it however it likes. */
export interface ActionHistoryEntry {
  readonly actionType: string;
  readonly selector?: string;
  readonly success: boolean;
  readonly error?: string;
  readonly executionTimeMs: number;
  readonly timestamp: string;
}

export interface ConsoleLogEntry {
  readonly logType: string;
  readonly text: string;
  readonly timestamp: string;
}

export interface PageErrorEntry {
  readonly message: string;
  readonly stack?: string;
  readonly timestamp: string;
}

export interface NetworkLogEntry {
  readonly phase: 'request' | 'response';
  readonly url: string;
  readonly method?: string;
  readonly resourceType?: string;
  readonly status?: number;
  readonly timestamp: string;
}

export interface PendingDialogInfo {
  readonly dialogType: string;
  readonly message: string;
  readonly defaultValue?: string;
}

/** FR2-04: how a tab's native dialogs (alert/confirm/prompt/beforeunload) are resolved.
 *  `'auto'` (the default) is byte-for-byte today's pre-FR2-04 behavior — a 30s dismiss timer
 *  for alert/confirm/prompt, a 3s accept timer for beforeunload — so MCP and the SDK, which
 *  never pass this, are unaffected. `'report'` (the CLI's own default) never auto-resolves
 *  alert/confirm/prompt at all (they stay pending until something calls handleDialog), but
 *  still keeps the 3s beforeunload accept — a page-initiated navigation must not hang forever
 *  just because nothing is watching for it. `'accept'`/`'dismiss'` resolve every dialog
 *  immediately with that action. */
export type DialogPolicyMode = 'auto' | 'report' | 'accept' | 'dismiss';

export interface DialogPolicy {
  readonly mode: DialogPolicyMode;
  /** Only meaningful for `'accept'` on a `prompt()` dialog — the text entered. Omitted means
   *  "whatever the prompt's own default value is" (see BrowserTab's accept-prompt-text rule). */
  readonly promptText?: string;
}

export const DEFAULT_DIALOG_POLICY: DialogPolicy = { mode: 'auto' };

/** Bound on {@link BrowserTab.getDialogHistory}'s ring buffer — plenty for a CLI session's
 *  worth of dialogs without growing unbounded across a very long-lived one. */
export const MAX_DIALOG_HISTORY = 50;

/** One dialog this tab has seen, from the moment it opened to however it was (or wasn't yet)
 *  resolved. Pushed once a dialog finishes being handled — by policy, by an explicit caller
 *  {@link BrowserTab.handleDialog} call, or by the safety-net auto-timeout. */
export interface DialogRecord {
  readonly dialogType: string;
  readonly message: string;
  readonly defaultValue?: string;
  readonly url: string;
  readonly openedAt: string;
  readonly handledAt?: string;
  readonly action?: 'accept' | 'dismiss';
  readonly promptText?: string;
  readonly handledBy?: 'policy' | 'caller' | 'auto-timeout';
  readonly error?: string;
}

/**
 * A tab-level lock so multiple concurrent callers (separate agents/sessions sharing one
 * Sutradhar session) can coordinate who's currently driving a tab — matches real PinchTab's
 * `POST /tab/lock` (owner + TTL) shape. **Advisory only in this pass**: acquiring/releasing/
 * checking the lock works, but `click`/`type`/etc. don't yet refuse to run against a
 * tab locked by a different owner — that would mean threading an `owner` identity through
 * every action method's public signature (a much bigger change than this pass), not just the
 * three lock methods. A well-behaved caller checks {@link BrowserTab.getLock} before acting;
 * nothing currently stops a caller that doesn't.
 */
export interface TabLockInfo {
  readonly owner: string;
  /** Unix ms timestamp; the lock is treated as released once `Date.now()` passes this. */
  readonly expiresAt: number;
}

/**
 * A rule applied to matching outgoing requests once interception is active. `pattern` is a
 * plain substring match against the request URL — simple and predictable rather than a full
 * glob/regex engine, which is enough for "block this analytics domain" / "mock this API call"
 * use cases without surprising wildcard-matching edge cases.
 */
export interface RouteRule {
  readonly pattern: string;
  readonly action: 'block' | 'mock';
  readonly mockStatus?: number;
  readonly mockContentType?: string;
  readonly mockBody?: string;
}

export interface IBrowserTab {
  readonly id: TabId;
  readonly url: string;
  readonly title: string;
  readonly active: boolean;
  readonly isActive: boolean;
  readonly isClosed: boolean;
  readonly page?: Page;
  setActive(active: boolean): void;
  navigate(url: string): Promise<BrowserTabDto>;
  executeAction(action: BrowserActionDto): Promise<BrowserActionResultDto>;
  close(): Promise<void>;
  toDto(): BrowserTabDto;
  getConsoleLogs(): readonly ConsoleLogEntry[];
  getPageErrors(): readonly PageErrorEntry[];
  getNetworkLog(): readonly NetworkLogEntry[];
  getPendingDialog(): PendingDialogInfo | undefined;
  handleDialog(action: 'accept' | 'dismiss', promptText?: string): Promise<void>;
  /** FR2-04. Optional so existing `IBrowserTab` literal mocks (e.g. dom-semantic-engine.spec.ts)
   *  keep compiling unchanged. */
  readonly targetId?: string;
  setDialogPolicy?(policy: DialogPolicy): void;
  getDialogPolicy?(): DialogPolicy;
  getPendingDialogDetail?(): (PendingDialogInfo & { url: string; openedAt: string }) | undefined;
  getDialogHistory?(): readonly DialogRecord[];
  addRoute(rule: RouteRule): Promise<void>;
  clearRoutes(): Promise<void>;
  getActionHistory(): readonly ActionHistoryEntry[];
  recordAction(entry: ActionHistoryEntry): void;
  getLock(): TabLockInfo | undefined;
  acquireLock(owner: string, ttlMs: number): boolean;
  releaseLock(owner: string): boolean;
}

export class BrowserTab implements IBrowserTab {
  public readonly id: TabId;
  public readonly page?: Page;
  private currentUrl: string;
  private currentTitle: string;
  private activeState: boolean;
  private closedState = false;

  private readonly sessionId?: SessionId;
  private readonly eventBus?: EventBus;
  private readonly consoleLogs: ConsoleLogEntry[] = [];
  private readonly pageErrors: PageErrorEntry[] = [];
  private readonly networkLog: NetworkLogEntry[] = [];
  private pendingDialog?: Dialog;
  private pendingDialogOpenedAt?: string;
  private dialogTimeout?: ReturnType<typeof setTimeout>;
  private dialogPolicy: DialogPolicy;
  private readonly dialogHistory: DialogRecord[] = [];
  private routeRules: RouteRule[] = [];
  private interceptionEnabled = false;
  private readonly actionHistory: ActionHistoryEntry[] = [];
  private lock?: TabLockInfo;

  public constructor(
    id: TabId,
    initialUrl = 'about:blank',
    initialTitle = 'New Tab',
    active = true,
    page?: Page,
    sessionId?: SessionId,
    eventBus?: EventBus,
    dialogPolicy: DialogPolicy = DEFAULT_DIALOG_POLICY,
  ) {
    this.id = id;
    this.currentUrl = initialUrl;
    this.currentTitle = initialTitle;
    this.activeState = active;
    this.page = page;
    this.sessionId = sessionId;
    this.eventBus = eventBus;
    this.dialogPolicy = dialogPolicy;

    if (this.page) {
      this.attachPageListeners(this.page);
      // Best-effort immediate sync — covers an adopted popup/existing page that had ALREADY
      // finished loading before this tab object was constructed (so no future 'load' event
      // will fire to trigger refreshTitleFromPage below). See that method's doc comment for
      // why `title` can't just read live the way `url` does.
      void this.refreshTitleFromPage();
    }
  }

  public get url(): string {
    if (this.page && !this.page.isClosed()) {
      return this.page.url();
    }
    return this.currentUrl;
  }

  /**
   * `title` cannot read live from the page the way {@link url} does — Puppeteer's
   * `page.title()` is an async CDP round trip, and this getter must stay synchronous. Instead,
   * `currentTitle` is kept in sync by a `'load'` listener (registered in
   * {@link attachPageListeners}) plus the constructor's own best-effort refresh above. Without
   * this, a tab adopted outside of `navigate()` (an adopted popup or a browser-level
   * `targetcreated` page — see `browser-session.ts`) would report the constructor's placeholder
   * title forever, since nothing else ever calls `navigate()` on it — found live via GLM's
   * original UC-09 popup repro, where `title` stayed frozen at `'New Tab'` even though `url`
   * (reading live) was already correct.
   */
  public get title(): string {
    return this.currentTitle;
  }

  public get active(): boolean {
    return this.activeState;
  }

  public get isActive(): boolean {
    return this.activeState;
  }

  public get isClosed(): boolean {
    return this.closedState;
  }

  public setActive(active: boolean): void {
    this.activeState = active;
  }

  public async navigate(url: string): Promise<BrowserTabDto> {
    if (this.isClosed) {
      throw new Error(`Cannot navigate closed tab ${this.id}`);
    }

    this.currentUrl = url;

    if (this.page && !this.page.isClosed()) {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      this.currentUrl = this.page.url();
      try {
        this.currentTitle = await this.page.title();
      } catch {
        this.currentTitle = this.currentUrl;
      }
    } else {
      this.currentTitle = `Title for ${url}`;
    }

    return this.toDto();
  }

  public async executeAction(action: BrowserActionDto): Promise<BrowserActionResultDto> {
    if (this.isClosed) {
      return {
        success: false,
        actionType: action.type,
        executionTimeMs: 0,
        actionId: action.id,
        error: `Cannot execute action on closed tab ${this.id}`,
      };
    }

    const textValue = action.textValue ?? action.textInput;

    try {
      if (action.type === 'navigate' && action.url) {
        await this.navigate(action.url);
      }

      // 'navigate' is handled above and doesn't need a live Puppeteer page (BrowserTab.navigate
      // owns its own real/mock distinction). Every other action type genuinely needs one — no
      // live page must never fall through to the blanket success below, or a caller against a
      // mock-fallback tab (Chrome unavailable) would see fabricated success for actions that
      // never actually ran.
      const hasLivePage = !!this.page && !this.page.isClosed();
      if (action.type !== 'navigate' && !hasLivePage) {
        return {
          success: false,
          actionType: action.type,
          executionTimeMs: 0,
          actionId: action.id,
          error: `No live browser page for tab ${this.id} — cannot execute ${action.type}.`,
        };
      }

      if (hasLivePage) {
        switch (action.type) {
          case 'click':
            if (!action.targetSelector) throw new Error("'click' requires targetSelector");
            await this.page!.click(action.targetSelector);
            break;

          case 'type':
            if (!action.targetSelector || !textValue) throw new Error("'type' requires targetSelector and textValue");
            await this.page!.type(action.targetSelector, textValue);
            break;

          case 'scroll':
            await this.page!.evaluate(() => window.scrollBy(0, 300));
            break;

          case 'hover':
            if (!action.targetSelector) throw new Error("'hover' requires targetSelector");
            await this.page!.hover(action.targetSelector);
            break;

          case 'pressKey':
            if (!action.key) throw new Error("'pressKey' requires key");
            await this.page!.keyboard.press(action.key as KeyInput);
            break;

          case 'evaluate': {
            if (!action.expression) throw new Error("'evaluate' requires expression");
            const result = await this.page!.evaluate(action.expression);
            return {
              success: true,
              actionType: 'evaluate',
              executionTimeMs: 0,
              actionId: action.id,
              data: { result },
            };
          }

          case 'screenshot': {
            const b64 = await this.page!.screenshot({ type: 'png', encoding: 'base64' });
            return {
              success: true,
              actionType: 'screenshot',
              executionTimeMs: 0,
              actionId: action.id,
              data: { screenshot: `data:image/png;base64,${b64}` },
            };
          }

          default:
            // BrowserActionDto's own type union is exhaustively handled above — this is only
            // reachable for a caller that bypasses TypeScript and passes an unrecognized raw
            // string. Fail loudly rather than silently reporting fabricated success for an
            // action type nothing here actually understands.
            throw new Error(`Unsupported action type: ${action.type}`);
        }
      }

      return {
        success: true,
        actionType: action.type,
        executionTimeMs: 0,
        actionId: action.id,
        data: { message: `Executed ${action.type} on tab ${this.id}` },
      };
    } catch (err) {
      return {
        success: false,
        actionType: action.type,
        executionTimeMs: 0,
        actionId: action.id,
        error: (err as Error).message,
      };
    }
  }

  public async close(): Promise<void> {
    if (this.closedState) {
      return;
    }

    this.closedState = true;
    if (this.dialogTimeout) {
      clearTimeout(this.dialogTimeout);
    }
    if (this.page && !this.page.isClosed()) {
      await this.page.close().catch(() => {});
    }
  }

  public toDto(): BrowserTabDto {
    // `this.url` (not `this.currentUrl`) — the getter already reads live from the page when one
    // exists; using the raw cached field here reintroduced the exact staleness `url`'s own
    // getter was written to avoid, just one layer further out. Found live via GLM's UC-09 popup
    // repro: `toDto()` (and therefore `list_tabs`/`BrowserSession.toDto()`) reported a stale
    // `about:blank` for an adopted popup's URL and history even though `tab.url` itself was
    // already correct.
    const liveUrl = this.url;
    return {
      id: this.id,
      url: liveUrl,
      title: this.currentTitle,
      isActive: this.activeState,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      historyStack: [liveUrl],
      historyIndex: 0,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Observability: console / page errors / network log
  // ─────────────────────────────────────────────────────────────────────────

  public getConsoleLogs(): readonly ConsoleLogEntry[] {
    return this.consoleLogs;
  }

  public getPageErrors(): readonly PageErrorEntry[] {
    return this.pageErrors;
  }

  public getNetworkLog(): readonly NetworkLogEntry[] {
    return this.networkLog;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Dialogs (alert / confirm / prompt / beforeunload)
  // ─────────────────────────────────────────────────────────────────────────

  public getPendingDialog(): PendingDialogInfo | undefined {
    if (!this.pendingDialog || this.pendingDialog.handled) return undefined;
    return {
      dialogType: this.pendingDialog.type(),
      message: this.pendingDialog.message(),
      defaultValue: this.pendingDialog.defaultValue() || undefined,
    };
  }

  /** FR2-04. Same data as {@link getPendingDialog} plus `url`/`openedAt`, for the CLI's
   *  reporting/gate logic. Kept as a separate method (rather than widening
   *  `getPendingDialog`'s own shape) because an existing test asserts `getPendingDialog()`'s
   *  exact 3-key shape via `toEqual`. */
  public getPendingDialogDetail(): (PendingDialogInfo & { url: string; openedAt: string }) | undefined {
    const base = this.getPendingDialog();
    if (!base || !this.pendingDialogOpenedAt) return undefined;
    return { ...base, url: this.url, openedAt: this.pendingDialogOpenedAt };
  }

  public getDialogHistory(): readonly DialogRecord[] {
    return this.dialogHistory;
  }

  /** FR2-04. Sets this tab's dialog policy going forward. Affects only FUTURE dialogs — a
   *  currently-pending one keeps whatever behavior was already armed for it (the CLI's gate
   *  handles a pending dialog explicitly instead). */
  public setDialogPolicy(policy: DialogPolicy): void {
    this.dialogPolicy = policy;
  }

  public getDialogPolicy(): DialogPolicy {
    return this.dialogPolicy;
  }

  /** FR2-04: the underlying CDP target id, when known — internal Puppeteer API (`_targetId`,
   *  stable across the pinned puppeteer-core version; see dialog-policy.live.spec.ts LV5). Used
   *  by the CLI's dialog gate/warden to correlate a raw-CDP-observed dialog with this tab.
   *  `undefined` for a mock/no-page tab. */
  public get targetId(): string | undefined {
    if (!this.page) return undefined;
    const target = this.page.target() as unknown as { _targetId?: string };
    return target._targetId;
  }

  private pushDialogRecord(record: DialogRecord): void {
    this.dialogHistory.push(record);
    if (this.dialogHistory.length > MAX_DIALOG_HISTORY) this.dialogHistory.shift();
  }

  public async handleDialog(action: 'accept' | 'dismiss', promptText?: string): Promise<void> {
    const dialog = this.pendingDialog;
    if (!dialog || dialog.handled) {
      throw new Error(`Tab ${this.id} has no pending dialog to handle.`);
    }
    if (this.dialogTimeout) {
      clearTimeout(this.dialogTimeout);
      this.dialogTimeout = undefined;
    }
    const openedAt = this.pendingDialogOpenedAt ?? new Date().toISOString();
    const dialogType = dialog.type();
    const message = dialog.message();
    const defaultValue = dialog.defaultValue() || undefined;
    const url = this.url;
    try {
      if (action === 'accept') {
        await dialog.accept(promptText);
      } else {
        await dialog.dismiss();
      }
      this.pushDialogRecord({
        dialogType,
        message,
        defaultValue,
        url,
        openedAt,
        handledAt: new Date().toISOString(),
        action,
        promptText,
        handledBy: 'caller',
      });
    } catch (err) {
      this.pushDialogRecord({
        dialogType,
        message,
        defaultValue,
        url,
        openedAt,
        handledAt: new Date().toISOString(),
        action,
        promptText,
        handledBy: 'caller',
        error: (err as Error).message,
      });
      throw err;
    } finally {
      this.pendingDialog = undefined;
      this.pendingDialogOpenedAt = undefined;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Multi-agent tab locking (advisory — see class-level note)
  // ─────────────────────────────────────────────────────────────────────────

  /** Current lock, or `undefined` if unlocked or the previous lock's TTL has elapsed. Reading
   *  this never mutates state — an expired lock is simply reported as absent; the next
   *  {@link acquireLock} call is what actually clears the stale entry. */
  public getLock(): TabLockInfo | undefined {
    if (!this.lock) return undefined;
    if (Date.now() >= this.lock.expiresAt) return undefined;
    return this.lock;
  }

  /**
   * Acquire the tab's advisory lock for `owner`, valid for `ttlMs` from now. Succeeds
   * (returns `true`) if the tab is unlocked, the existing lock has expired, or `owner` already
   * holds it (re-acquiring extends the TTL). Fails (`false`, lock untouched) if a *different*
   * owner currently holds a still-valid lock.
   */
  public acquireLock(owner: string, ttlMs: number): boolean {
    const current = this.getLock();
    if (current && current.owner !== owner) return false;
    this.lock = { owner, expiresAt: Date.now() + ttlMs };
    return true;
  }

  /** Release the lock if `owner` currently holds it. Returns `false` (no-op) if the tab is
   *  unlocked, already expired, or held by a different owner — releasing is never forced. */
  public releaseLock(owner: string): boolean {
    const current = this.getLock();
    if (!current || current.owner !== owner) return false;
    this.lock = undefined;
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Network interception / mocking
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add a block/mock rule for requests whose URL contains `rule.pattern`. Lazily enables
   * Puppeteer's request interception the first time a rule is added for this tab — every
   * request is resolved (continued, blocked, or mocked) by the same `request` listener that
   * already logs network activity, so nothing else needs to change once interception is on.
   */
  public async addRoute(rule: RouteRule): Promise<void> {
    this.routeRules.push(rule);
    if (!this.interceptionEnabled && this.page && !this.page.isClosed()) {
      this.interceptionEnabled = true;
      await this.page.setRequestInterception(true);
    }
  }

  /** Remove all route rules and disable interception (all requests pass through untouched). */
  public async clearRoutes(): Promise<void> {
    this.routeRules = [];
    if (this.interceptionEnabled && this.page && !this.page.isClosed()) {
      this.interceptionEnabled = false;
      await this.page.setRequestInterception(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Action history
  // ─────────────────────────────────────────────────────────────────────────

  public getActionHistory(): readonly ActionHistoryEntry[] {
    return this.actionHistory;
  }

  public recordAction(entry: ActionHistoryEntry): void {
    this.actionHistory.push(entry);
    if (this.actionHistory.length > MAX_ACTION_HISTORY) this.actionHistory.shift();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────────

  /** Best-effort sync of {@link currentTitle} from the live page — see the `title` getter's doc
   *  comment for why this can't just be read live on every access the way `url` is. */
  private async refreshTitleFromPage(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      this.currentTitle = await this.page.title();
    } catch {
      // Best-effort — leave currentTitle as whatever it was (e.g. the constructor's
      // placeholder), rather than throwing out of a fire-and-forget background refresh.
    }
  }

  /** FR2-04: immediately resolves `dialog` per an `'accept'`/`'dismiss'` policy. Fire-and-forget
   *  (called via `void` from the `'dialog'` listener, which cannot be async) — every path pushes
   *  a {@link DialogRecord}, including a rejection (e.g. a warden/gate got there first with
   *  "No dialog is showing"), so this can never produce an unhandled promise rejection. */
  private async applyPolicyNow(
    dialog: Dialog,
    mode: 'accept' | 'dismiss',
    policy: DialogPolicy,
    isBeforeUnload: boolean,
  ): Promise<void> {
    const openedAt = this.pendingDialogOpenedAt ?? new Date().toISOString();
    const dialogType = dialog.type();
    const message = dialog.message();
    const defaultValue = dialog.defaultValue() || undefined;
    const url = this.url;
    // Prompt accept-with-no-text rule (D-9): "OK with the prefilled text", explicit rather than
    // relying on CDP's own behavior when promptText is omitted. Non-prompt dialogs never pass
    // promptText through, even if the policy set one.
    const promptText =
      mode === 'accept' && dialogType === 'prompt' ? (policy.promptText ?? defaultValue) : undefined;
    try {
      if (mode === 'accept') {
        await dialog.accept(promptText);
      } else {
        await dialog.dismiss();
      }
      this.pushDialogRecord({
        dialogType,
        message,
        defaultValue,
        url,
        openedAt,
        handledAt: new Date().toISOString(),
        action: mode,
        promptText,
        handledBy: 'policy',
      });
    } catch (err) {
      this.pushDialogRecord({
        dialogType,
        message,
        defaultValue,
        url,
        openedAt,
        handledAt: new Date().toISOString(),
        action: mode,
        promptText,
        handledBy: 'policy',
        error: (err as Error).message,
      });
    } finally {
      if (this.pendingDialog === dialog) {
        this.pendingDialog = undefined;
        this.pendingDialogOpenedAt = undefined;
      }
      void isBeforeUnload; // reserved for parity with the timer branch; no special-case needed here
    }
  }

  private attachPageListeners(page: Page): void {
    // Keeps `title` from going stale after any real navigation this BrowserTab didn't itself
    // drive via `navigate()` — an adopted popup, a `targetcreated`-adopted tab, or the page's
    // own client-side navigation (SPA route change, redirect). `'load'` fires once per real
    // top-level navigation, unlike `'framenavigated'` which also fires for every subframe.
    page.on('load', () => {
      void this.refreshTitleFromPage();
    });

    page.on('dialog', (dialog) => {
      this.pendingDialog = dialog;
      this.pendingDialogOpenedAt = new Date().toISOString();

      if (this.eventBus && this.sessionId) {
        void this.eventBus.publish(
          'browser:dialog:opened',
          {
            sessionId: this.sessionId,
            tabId: this.id,
            dialogType: dialog.type(),
            message: dialog.message(),
            defaultValue: dialog.defaultValue() || undefined,
          },
          `corr_dialog_${Date.now()}`,
        );
      }

      const isBeforeUnload = dialog.type() === 'beforeunload';
      const policy = this.dialogPolicy;

      // FR2-04: `accept`/`dismiss` resolve every dialog (including beforeunload) at once, and
      // never arm the safety-net timer at all. This is the ONLY new branch that changes
      // observable timing for non-'auto' modes — see BrowserTab-observability T1-T8.
      if (policy.mode === 'accept' || policy.mode === 'dismiss') {
        void this.applyPolicyNow(dialog, policy.mode, policy, isBeforeUnload);
        return;
      }

      // 'report' (the CLI's own default): alert/confirm/prompt stay pending indefinitely — no
      // timer at all — until something (the gate, `sutradhar dialog`, or a caller) resolves it.
      // beforeunload still gets the short accept-timeout: it uniquely blocks an in-flight
      // navigate() call, and there is no legitimate "leave it open forever" outcome for that
      // (see BEFOREUNLOAD_DIALOG_TIMEOUT_MS's doc comment — same reasoning as 'auto').
      if (policy.mode === 'report' && !isBeforeUnload) {
        return;
      }

      // 'auto' (default; also 'report'+beforeunload): unchanged pre-FR2-04 safety-net timer —
      // see BEFOREUNLOAD_DIALOG_TIMEOUT_MS's doc comment for why beforeunload's timeout/polarity
      // differ from alert/confirm/prompt's.
      const timeoutMs = isBeforeUnload ? BEFOREUNLOAD_DIALOG_TIMEOUT_MS : DEFAULT_DIALOG_TIMEOUT_MS;
      this.dialogTimeout = setTimeout(() => {
        if (!dialog.handled) {
          const openedAt = this.pendingDialogOpenedAt ?? new Date().toISOString();
          const dialogType = dialog.type();
          const message = dialog.message();
          const defaultValue = dialog.defaultValue() || undefined;
          const url = this.url;
          const action: 'accept' | 'dismiss' = isBeforeUnload ? 'accept' : 'dismiss';
          const resolve = isBeforeUnload ? dialog.accept() : dialog.dismiss();
          resolve
            .then(() => {
              this.pushDialogRecord({
                dialogType,
                message,
                defaultValue,
                url,
                openedAt,
                handledAt: new Date().toISOString(),
                action,
                handledBy: 'auto-timeout',
              });
            })
            .catch((err: Error) => {
              this.pushDialogRecord({
                dialogType,
                message,
                defaultValue,
                url,
                openedAt,
                handledAt: new Date().toISOString(),
                action,
                handledBy: 'auto-timeout',
                error: err.message,
              });
            });
        }
        this.pendingDialog = undefined;
        this.pendingDialogOpenedAt = undefined;
      }, timeoutMs);
    });

    page.on('console', (msg) => {
      const entry: ConsoleLogEntry = {
        logType: msg.type(),
        text: msg.text(),
        timestamp: new Date().toISOString(),
      };
      this.consoleLogs.push(entry);
      if (this.consoleLogs.length > MAX_CONSOLE_LOGS) this.consoleLogs.shift();

      if (this.eventBus && this.sessionId) {
        void this.eventBus.publish(
          'browser:console:message',
          { sessionId: this.sessionId, tabId: this.id, logType: entry.logType, text: entry.text },
          `corr_console_${Date.now()}`,
        );
      }
    });

    page.on('pageerror', (err) => {
      // Puppeteer's typings promise an `Error`, but a page can `throw null`/`throw undefined`/
      // throw a non-Error value, which CDP forwards as-is — `err` itself can be null here, not
      // just missing `.message`. Found live: this crashed the whole CLI process
      // (`Cannot read properties of null (reading 'message')`) on a real page whose console
      // logged such a throw, taking out an otherwise-healthy session's next command.
      const error = err as Error | null | undefined;
      const entry: PageErrorEntry = {
        message: error?.message ?? String(err),
        stack: error?.stack,
        timestamp: new Date().toISOString(),
      };
      this.pageErrors.push(entry);
      if (this.pageErrors.length > MAX_PAGE_ERRORS) this.pageErrors.shift();

      if (this.eventBus && this.sessionId) {
        void this.eventBus.publish(
          'browser:page:error',
          { sessionId: this.sessionId, tabId: this.id, message: entry.message, stack: entry.stack },
          `corr_pageerror_${Date.now()}`,
        );
      }
    });

    page.on('request', (req) => {
      const entry: NetworkLogEntry = {
        phase: 'request',
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
        timestamp: new Date().toISOString(),
      };
      this.networkLog.push(entry);
      if (this.networkLog.length > MAX_NETWORK_LOG) this.networkLog.shift();

      if (this.eventBus && this.sessionId) {
        void this.eventBus.publish(
          'browser:network:request',
          {
            sessionId: this.sessionId,
            tabId: this.id,
            url: entry.url,
            method: entry.method ?? 'GET',
            resourceType: entry.resourceType ?? 'other',
          },
          `corr_request_${Date.now()}`,
        );
      }

      // Once interception is on, every request MUST be resolved (continue/abort/respond) or
      // the page hangs forever on it — so this branch is not optional once addRoute() has run.
      if (this.interceptionEnabled) {
        const rule = this.routeRules.find((r) => entry.url.includes(r.pattern));
        if (rule?.action === 'block') {
          req.abort().catch(() => {});
        } else if (rule?.action === 'mock') {
          req
            .respond({
              status: rule.mockStatus ?? 200,
              contentType: rule.mockContentType ?? 'application/json',
              body: rule.mockBody ?? '',
            })
            .catch(() => {});
        } else {
          req.continue().catch(() => {});
        }
      }
    });

    page.on('response', (res) => {
      const entry: NetworkLogEntry = {
        phase: 'response',
        url: res.url(),
        status: res.status(),
        timestamp: new Date().toISOString(),
      };
      this.networkLog.push(entry);
      if (this.networkLog.length > MAX_NETWORK_LOG) this.networkLog.shift();

      if (this.eventBus && this.sessionId) {
        void this.eventBus.publish(
          'browser:network:response',
          { sessionId: this.sessionId, tabId: this.id, url: entry.url, status: entry.status ?? 0 },
          `corr_response_${Date.now()}`,
        );
      }
    });
  }
}
