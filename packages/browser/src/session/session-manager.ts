/**
 * @file packages/browser/src/session/session-manager.ts
 * @description Centralized BrowserSessionManager orchestrating multi-session lifecycles and event bus integration.
 */

import { SessionId, createSessionId } from '@sutradhar/contracts';
import { EventBus, type SubscriptionToken } from '@sutradhar/events';
import { StructuredLogger } from '@sutradhar/observability';
import { BrowserLauncher } from '../launcher/browser-launcher.js';
import type { BrowserLaunchOptions } from '../launcher/browser-options.js';
import { BrowserSession, IBrowserSession } from './browser-session.js';
import type { DialogPolicy } from './browser-tab.js';

export interface CreateSessionOptions {
  readonly sessionId?: SessionId;
  readonly isIncognito?: boolean;
  readonly initialUrl?: string;
  /**
   * Forwarded to {@link BrowserLauncher.launch} — headless/viewport/userDataDir/etc.
   * `isIncognito` on this object (if set) takes precedence over a value nested here.
   */
  readonly launch?: BrowserLaunchOptions;
  /**
   * Connect to an EXTERNAL browser over the Chrome DevTools Protocol instead of launching a
   * new one. Provide a CDP WebSocket URL (e.g. `ws://127.0.0.1:9222/devtools/browser/<id>`)
   * or an `http://host:port` discovery endpoint (resolved to its browser WS target).
   *
   * Used by the browser-extension path: the user's real, logged-in Chrome is the target, so
   * the agent can operate on sessions headless Chrome cannot reach (SSO, 2FA, etc.). When set,
   * `isIncognito`/launch options are ignored — the external browser owns its own context.
   */
  readonly wsEndpoint?: string;
  /** FR2-04: this session's default native-dialog policy. Unset (the default) leaves every tab
   *  at `'auto'` — today's exact pre-FR2-04 behavior. */
  readonly dialogPolicy?: DialogPolicy;
}

export interface IBrowserSessionManager {
  createSession(options?: CreateSessionOptions): Promise<IBrowserSession>;
  getSession(sessionId: SessionId): IBrowserSession | undefined;
  getSessionCount(): number;
  getAllSessions(): readonly IBrowserSession[];
  closeSession(sessionId: SessionId, reason?: string): Promise<void>;
  closeAllSessions(): Promise<void>;
}

export class BrowserSessionManager implements IBrowserSessionManager {
  private readonly sessions = new Map<SessionId, BrowserSession>();
  /** In-flight creates keyed by caller-supplied id — coalesces concurrent requests. */
  private readonly pending = new Map<SessionId, Promise<IBrowserSession>>();
  private readonly launcher: BrowserLauncher;
  private readonly eventBus?: EventBus;
  private readonly logger: StructuredLogger;
  private sessionCounter = 0;
  /** How long a session may go without any observed activity before the reaper closes it.
   *  `undefined` (the default) disables reaping entirely — a caller (e.g. an MCP server whose
   *  client is expected to call browser.shutdown itself) opts in explicitly. */
  private readonly idleTimeoutMs?: number;
  private readonly lastActivityAt = new Map<SessionId, number>();
  private readonly reaperInterval?: NodeJS.Timeout;
  /** Tokens for the two `EventBus` subscriptions made below — held so {@link dispose} can
   *  unsubscribe them. Without this, every `BrowserSessionManager` ever constructed against a
   *  long-lived shared `EventBus` (a test harness that creates several, a hot-reload, etc.)
   *  leaves its listeners attached forever, each still doing (harmless but wasted) work on
   *  every future event indefinitely. */
  private readonly eventSubscriptions: SubscriptionToken[] = [];

  public constructor(
    launcher?: BrowserLauncher,
    eventBus?: EventBus,
    logger?: StructuredLogger,
    idleTimeoutMs?: number,
  ) {
    this.launcher = launcher ?? new BrowserLauncher();
    this.eventBus = eventBus;
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
    this.idleTimeoutMs = idleTimeoutMs;

    // A session that crashed (Chrome disconnected outside of a normal close()) reports
    // itself dead via this event — drop it from the map so it doesn't linger forever as a
    // reference to nothing live. Without this, `getSession()` would keep returning a session
    // object whose every action fails, instead of `getSession()` correctly reporting "gone".
    if (this.eventBus) {
      this.eventSubscriptions.push(
        this.eventBus.subscribe('browser:session:crashed', (event) => {
          this.sessions.delete(event.payload.sessionId);
          this.lastActivityAt.delete(event.payload.sessionId);
          this.logger.warn(`[BrowserSessionManager] Removed crashed session ${event.payload.sessionId}`);
        }),
      );

      // Any event carrying a sessionId counts as activity for the idle reaper — reuses the
      // existing event-bus feed rather than threading a "touch" call through every action
      // call site. Wired up unconditionally (cheap to track); it only ever matters if
      // idleTimeoutMs is actually set.
      this.eventSubscriptions.push(
        this.eventBus.subscribeAll((event) => {
          const sessionId = (event as { payload?: { sessionId?: SessionId } }).payload?.sessionId;
          if (sessionId && this.sessions.has(sessionId)) {
            this.lastActivityAt.set(sessionId, Date.now());
          }
        }),
      );
    }

    if (this.idleTimeoutMs) {
      const sweepIntervalMs = Math.min(this.idleTimeoutMs, 60_000);
      this.reaperInterval = setInterval(() => this.reapIdleSessions(), sweepIntervalMs);
      this.reaperInterval.unref?.(); // never keep the process alive just for the reaper
    }
  }

  private reapIdleSessions(): void {
    if (!this.idleTimeoutMs) return;
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      const lastActivity = this.lastActivityAt.get(sessionId) ?? new Date(session.createdAt).getTime();
      if (now - lastActivity >= this.idleTimeoutMs) {
        this.logger.warn(
          `[BrowserSessionManager] Reaping idle session ${sessionId} (idle for ${now - lastActivity}ms, limit ${this.idleTimeoutMs}ms)`,
        );
        void this.closeSession(sessionId, 'Idle timeout').catch((err) => {
          this.logger.warn(`[BrowserSessionManager] Failed to reap idle session ${sessionId}: ${(err as Error).message}`);
        });
      }
    }
  }

  /** Stops the idle-reaper interval, if one is running. Call on process shutdown/in tests —
   *  otherwise harmless since the interval is already `.unref()`'d. Superseded by
   *  {@link dispose}, which also releases the EventBus subscriptions; kept for backward
   *  compatibility with existing callers. */
  public stopIdleReaper(): void {
    if (this.reaperInterval) clearInterval(this.reaperInterval);
  }

  /**
   * Releases everything this manager holds onto outside itself: the idle-reaper interval and
   * both `EventBus` subscriptions made in the constructor. Call this when a
   * `BrowserSessionManager` is being discarded (e.g. replaced by a new one against the same
   * long-lived event bus) — without it, the old instance's listeners stay attached to the bus
   * forever, each still doing (harmless but wasted) work on every future event indefinitely.
   * Does NOT close any live sessions — call {@link closeAllSessions} first if that's wanted.
   */
  public dispose(): void {
    this.stopIdleReaper();
    for (const subscription of this.eventSubscriptions) {
      subscription.unsubscribe();
    }
    this.eventSubscriptions.length = 0;
  }

  public async createSession(options: CreateSessionOptions = {}): Promise<IBrowserSession> {
    // Caller-supplied ids are binding ids (UI session ↔ backend browser):
    // never spawn a second browser for them — return the live session, or
    // coalesce onto an in-flight create racing this request.
    if (options.sessionId) {
      const existing = this.sessions.get(options.sessionId);
      if (existing) return existing;
      const inflight = this.pending.get(options.sessionId);
      if (inflight) return inflight;
    }
    const creation = this.doCreateSession(options);
    if (options.sessionId) {
      this.pending.set(options.sessionId, creation);
      creation.catch(() => {}).finally(() => {
        this.pending.delete(options.sessionId!);
      });
    }
    return creation;
  }

  private async doCreateSession(options: CreateSessionOptions): Promise<IBrowserSession> {
    this.sessionCounter++;
    const sessionId =
      options.sessionId || createSessionId(`sess_${Date.now()}_${this.sessionCounter}`);
    const isIncognito = options.isIncognito ?? false;

    // Initialize underlying browser instance. When wsEndpoint is provided, ATTACH to the
    // external browser over CDP instead of launching a new one (the extension path). The
    // launcher's connect() resolves an http:// discovery URL to its browser WS target.
    const browserInstance = options.wsEndpoint
      ? await this.launcher.connect(options.wsEndpoint)
      : await this.launcher.launch({ ...options.launch, isIncognito });

    const session = new BrowserSession(
      sessionId,
      isIncognito,
      this.eventBus,
      this.logger,
      browserInstance,
      options.dialogPolicy,
    );

    if (options.initialUrl) {
      await session.createTab(options.initialUrl);
    }

    this.sessions.set(sessionId, session);

    this.logger.info(`[BrowserSessionManager] Created browser session ${sessionId}`, {
      isIncognito,
      initialUrl: options.initialUrl,
    });

    if (this.eventBus) {
      await this.eventBus.publish(
        'browser:session:created',
        {
          sessionId,
          createdAt: session.createdAt,
        },
        'BrowserSessionManager',
      );
    }

    return session;
  }

  public getSession(sessionId: SessionId): IBrowserSession | undefined {
    return this.sessions.get(sessionId);
  }

  public getSessionCount(): number {
    return this.sessions.size;
  }

  public getAllSessions(): readonly IBrowserSession[] {
    return Array.from(this.sessions.values());
  }

  public async closeSession(sessionId: SessionId, reason = 'User requested close'): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    await session.close(reason);
    this.sessions.delete(sessionId);
    this.lastActivityAt.delete(sessionId);

    this.logger.info(`[BrowserSessionManager] Closed session ${sessionId}`, { reason });

    if (this.eventBus) {
      await this.eventBus.publish(
        'browser:session:closed',
        { sessionId, closedAt: new Date().toISOString(), reason },
        'BrowserSessionManager',
      );
    }
  }

  public async closeAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.closeSession(sessionId, 'Close all sessions requested');
    }
  }
}
