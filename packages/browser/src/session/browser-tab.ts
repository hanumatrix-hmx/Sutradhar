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
import { Dialog, Page } from 'puppeteer-core';

/** How long a native dialog is left pending before it's auto-resolved so the page doesn't
 *  hang forever if nothing ever calls {@link BrowserTab.handleDialog}. Deliberately generous
 *  (matches downloadFile's timeout) — a real caller typically checks {@link
 *  BrowserTab.getPendingDialog} and then calls {@link BrowserTab.handleDialog} as two separate
 *  round trips, and 5s (the original default) was found live to be too tight for that: an
 *  agent/tool round trip of even a couple of seconds per call could burn the whole window
 *  before the second call ever reached the dialog, silently auto-dismissing it instead. */
const DEFAULT_DIALOG_TIMEOUT_MS = 30000;

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
  private dialogTimeout?: ReturnType<typeof setTimeout>;
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
  ) {
    this.id = id;
    this.currentUrl = initialUrl;
    this.currentTitle = initialTitle;
    this.activeState = active;
    this.page = page;
    this.sessionId = sessionId;
    this.eventBus = eventBus;

    if (this.page) {
      this.attachPageListeners(this.page);
    }
  }

  public get url(): string {
    if (this.page && !this.page.isClosed()) {
      return this.page.url();
    }
    return this.currentUrl;
  }

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
            await this.page!.keyboard.press(action.key as any);
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
    return {
      id: this.id,
      url: this.currentUrl,
      title: this.currentTitle,
      isActive: this.activeState,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      historyStack: [this.currentUrl],
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

  public async handleDialog(action: 'accept' | 'dismiss', promptText?: string): Promise<void> {
    const dialog = this.pendingDialog;
    if (!dialog || dialog.handled) {
      throw new Error(`Tab ${this.id} has no pending dialog to handle.`);
    }
    if (this.dialogTimeout) {
      clearTimeout(this.dialogTimeout);
      this.dialogTimeout = undefined;
    }
    if (action === 'accept') {
      await dialog.accept(promptText);
    } else {
      await dialog.dismiss();
    }
    this.pendingDialog = undefined;
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

  private attachPageListeners(page: Page): void {
    page.on('dialog', (dialog) => {
      this.pendingDialog = dialog;

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

      // Safety net: if nothing calls handleDialog(), don't leave the page hung forever.
      // Dismissing (rather than accepting) is the safer default — it never confirms a
      // destructive action the caller never got a chance to review.
      this.dialogTimeout = setTimeout(() => {
        if (!dialog.handled) {
          dialog.dismiss().catch(() => {});
        }
        this.pendingDialog = undefined;
      }, DEFAULT_DIALOG_TIMEOUT_MS);
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
      const error = err as Error;
      const entry: PageErrorEntry = {
        message: error.message ?? String(err),
        stack: error.stack,
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
