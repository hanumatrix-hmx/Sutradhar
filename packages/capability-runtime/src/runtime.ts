/**
 * @file packages/capability-runtime/src/runtime.ts
 * @description {@link SutradharRuntime} — the single high-level entry point over the
 * Sutradhar browser engine.
 *
 * This façade owns a {@link BrowserSessionManager}, {@link BrowserActionEngine}, and
 * {@link DOMSemanticEngine} and exposes clean async verbs (launch/navigate/snapshot/
 * click/type/screenshot/tabs/cookies/eval/shutdown). It does NOT depend on the HTTP
 * server, the MCP protocol, or any agent loop — every integration surface composes
 * this class instead of duplicating browser logic.
 *
 * Mirrors the composition in apps/server/src/runtime/dependency-container.ts so the
 * behavior is identical to driving the REST API directly.
 */

import {
  BrowserActionEngine,
  BrowserLauncher,
  BrowserSessionManager,
  DOMSemanticEngine,
  formatGraphForLlm,
  selectorForNodeId,
  type ActionHistoryEntry,
  type IBrowserSession,
  type IBrowserTab,
  type SettleSpec,
} from '@sutradhar/browser';
import path from 'node:path';
import { access, realpath } from 'node:fs/promises';
import { createSessionId, createTabId } from '@sutradhar/contracts';
import { EventBus } from '@sutradhar/events';
import { type StructuredLogger } from '@sutradhar/observability';
import { RateLimiter } from '@sutradhar/utils';
import type {
  ActionResult,
  AttachOptions,
  LaunchOptions,
  LaunchResult,
  NavigateResult,
  PdfResult,
  SnapshotResult,
  ScreenshotResult,
  StorageState,
  TabInfo,
} from './types.js';
import { BrowserNotAvailableError, normalizeTarget } from './types.js';
import { ProfileManager } from './profiles/profile-manager.js';
import {
  AUDIT_PAGE_SCRIPT,
  VITALS_OBSERVER_SCRIPT,
  type A11yIssue,
  type WebVitals,
  type AuditResult,
} from './audit/site-audit.js';
import { compareScreenshots, type VisualCompareResult } from './audit/visual-compare.js';
import { buildAxSnapshot, type AxSnapshotResult } from './snapshot/ax-snapshot.js';

/**
 * Standard Chrome DevTools network-throttling profiles, for {@link SutradharRuntime.emulateNetwork}.
 * Values mirror Puppeteer's own `PredefinedNetworkConditions` (download/upload in bytes/sec,
 * latency in ms) — inlined rather than imported so this package doesn't need a direct
 * `puppeteer-core` dependency just for this one static table.
 */
const NETWORK_CONDITION_PRESETS = {
  'Slow 3G': { download: ((500 * 1000) / 8) * 0.8, upload: ((500 * 1000) / 8) * 0.8, latency: 400 * 5 },
  'Fast 3G': { download: ((1.6 * 1000 * 1000) / 8) * 0.9, upload: ((750 * 1000) / 8) * 0.9, latency: 150 * 3.75 },
  'Slow 4G': { download: ((1.6 * 1000 * 1000) / 8) * 0.9, upload: ((750 * 1000) / 8) * 0.9, latency: 150 * 3.75 },
  'Fast 4G': { download: ((9 * 1000 * 1000) / 8) * 0.9, upload: ((1.5 * 1000 * 1000) / 8) * 0.9, latency: 60 * 2.75 },
} as const;

/** Constructor options for {@link SutradharRuntime}. */
export interface SutradharRuntimeOptions {
  /** Reuse an existing launcher (e.g. a test double). A default one is created otherwise. */
  launcher?: BrowserLauncher;
  /**
   * Paces outbound requests to target sites — applied before every navigation and every
   * page-mutating action. Defaults to a generous 20 actions/second, which is effectively
   * invisible for a single agent driving one page but provides real backpressure against a
   * runaway loop hammering a site. Pass `null` to disable pacing entirely.
   */
  rateLimiter?: RateLimiter | null;
  /** Reuse an existing event bus. A default one is created otherwise. */
  eventBus?: EventBus;
  /**
   * Directories `browser.download_file` is allowed to write into. Defaults to just the OS
   * temp directory — a caller-supplied `downloadDir` that resolves outside every allowed root
   * is rejected. Add project-specific scratch directories here if you need downloads to land
   * somewhere other than the OS temp dir.
   */
  allowedDownloadRoots?: readonly string[];
  /**
   * Directories `browser.upload_file`/`browser.upload_file_via_trigger` are allowed to read
   * from. Unset (the default) means unrestricted — uploading an arbitrary local file the
   * caller specifies is the intended feature. Set this if the calling LLM might act on
   * untrusted page content (prompt injection) telling it to upload a sensitive local file.
   */
  allowedUploadRoots?: readonly string[];
  /**
   * Close a session automatically once it's gone this long with no observed activity
   * (navigate/action/etc.). Unset by default — a session lives until `shutdown()`/
   * `shutdownAll()` is called explicitly. Set this if callers might reasonably forget to
   * shut down a session (e.g. a long-lived MCP server driven by an LLM), so a forgotten
   * session doesn't leak its Chrome process indefinitely.
   */
  idleTimeoutMs?: number;
  /**
   * When `true`, every navigation (`navigate`, `launch`'s `initialUrl`, `createTab`'s `url`) is
   * rejected unless the target resolves to localhost, a private/loopback IP range, `file:`,
   * `about:`, or `data:` — the same "restrict to locally-hosted sites" posture the real
   * Sutradhar project defaults to. Unset (the default) here: most callers of this runtime
   * legitimately need to browse the real internet, so this is opt-in rather than default-on —
   * enable it for sandboxed/testing deployments where any real-internet navigation would be a
   * mistake, not a feature.
   */
  restrictNavigationToLocal?: boolean;
  /**
   * When set (non-empty), every navigation is rejected unless its hostname exactly matches one
   * of these domains or is a subdomain of one (e.g. `["example.com"]` allows `example.com` and
   * `app.example.com`, not `example.com.evil.net`). `file:`/`about:`/`data:` URLs are always
   * exempt, same as {@link restrictNavigationToLocal}. Independent of and composable with
   * `restrictNavigationToLocal` — both are checked when both are set. Unset (the default) means
   * no domain restriction. Intended for handing an agent a logged-in internal session safely
   * (e.g. company-only domains) — also a partial prompt-injection defense-in-depth, since a page
   * that tries to navigate the agent off-allowlist via a malicious link gets blocked here
   * regardless of why the navigation was attempted.
   */
  allowedDomains?: readonly string[];
  /** Where named-profile registry/data lives. Defaults to `~/.sutradhar` — override for tests
   *  or to keep profile data somewhere other than the user's home directory. */
  profilesBaseDir?: string;
  logger?: StructuredLogger;
}

/**
 * High-level browser automation runtime. One instance manages a pool of browser
 * sessions. Every method is a pure async verb — no transport, no protocol.
 *
 * @example
 * const runtime = new SutradharRuntime();
 * const { sessionId } = await runtime.launch({ initialUrl: 'https://example.com' });
 * const snap = await runtime.snapshot(sessionId);
 * await runtime.click(sessionId, '7'); // sd-node-id from the snapshot
 * const png = await runtime.screenshot(sessionId);
 * await runtime.shutdown(sessionId);
 */
export class SutradharRuntime {
  private readonly sessionManager: BrowserSessionManager;
  private readonly actionEngine: BrowserActionEngine;
  private readonly domEngine: DOMSemanticEngine;
  private readonly rateLimiter: RateLimiter | null;
  private readonly eventBus: EventBus;
  private readonly launcher: BrowserLauncher;
  private readonly allowedUploadRoots?: readonly string[];
  private readonly restrictNavigationToLocal: boolean;
  private readonly allowedDomains?: readonly string[];
  private readonly profileManager: ProfileManager;
  /** sessionId -> the profileName it was launched with, so `shutdown()` knows whose storage
   *  state to persist. Only sessions launched via `launch({profileName})` get an entry; a
   *  plain/unnamed launch never touches this. Entries are removed on shutdown regardless of
   *  outcome, so this never grows across a long-lived runtime's full session history. */
  private readonly sessionProfiles = new Map<string, string>();

  public constructor(options: SutradharRuntimeOptions = {}) {
    const eventBus = options.eventBus ?? new EventBus(options.logger);
    this.eventBus = eventBus;
    this.launcher = options.launcher ?? new BrowserLauncher(options.logger);
    this.allowedUploadRoots = options.allowedUploadRoots;
    this.restrictNavigationToLocal = options.restrictNavigationToLocal ?? false;
    this.allowedDomains = options.allowedDomains?.length ? options.allowedDomains : undefined;
    this.profileManager = new ProfileManager(options.profilesBaseDir);
    this.sessionManager = new BrowserSessionManager(
      this.launcher,
      eventBus,
      options.logger,
      options.idleTimeoutMs,
    );
    this.actionEngine = new BrowserActionEngine(
      eventBus,
      options.logger,
      undefined,
      options.allowedDownloadRoots,
      options.allowedUploadRoots,
    );
    this.domEngine = new DOMSemanticEngine();
    this.rateLimiter =
      options.rateLimiter === null
        ? null
        : (options.rateLimiter ?? new RateLimiter({ tokensPerInterval: 20, intervalMs: 1000 }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Preflight check: is a real Chrome/Edge executable available? Cheap (no browser process
   * launched) — lets a caller check availability before committing to a full `launch()`,
   * rather than the only signal being a `hasRealBrowser:false` after already attempting one.
   */
  public checkHealth(executablePath?: string): { hasChrome: boolean; executablePath?: string } {
    const resolved = this.launcher.findExecutablePath(executablePath);
    return { hasChrome: !!resolved, executablePath: resolved };
  }

  /**
   * Launch a browser session, optionally opening an initial URL in a first tab.
   *
   * Always ensures at least one tab exists and is active so the returned session is
   * immediately usable. (BrowserSessionManager only creates a tab when `initialUrl` is
   * set; without this, the session starts tab-less and every verb would need a tab
   * created on demand.)
   */
  public async launch(options: LaunchOptions = {}): Promise<LaunchResult> {
    if (options.initialUrl) this.assertNavigationAllowed(options.initialUrl);
    let launchOptions = options.launch;
    if (options.profileName) {
      const userDataDir = await this.profileManager.resolveUserDataDir(options.profileName);
      launchOptions = { ...launchOptions, userDataDir };
    }
    const session = await this.sessionManager.createSession({
      sessionId: options.sessionId ? createSessionId(options.sessionId) : undefined,
      isIncognito: options.isIncognito,
      initialUrl: options.initialUrl,
      launch: launchOptions,
    });
    let activeTab = session.activeTabId
      ? session.getTab(session.activeTabId)
      : session.getTabs()[0];
    if (!activeTab) {
      // No initialUrl was given so the manager created zero tabs — open a blank one
      // so the session has a live page to act on.
      activeTab = await session.createTab();
      session.setActiveTab(activeTab.id);
    }

    if (options.profileName) {
      this.sessionProfiles.set(session.id, options.profileName);
      // Restoring storage-state requires a real origin to restore it INTO — localStorage/
      // sessionStorage are origin-scoped, so there's nothing to restore onto until the tab has
      // navigated somewhere. Only possible here when the caller also gave `initialUrl` (which
      // BrowserSessionManager already navigated to before this point — see its own doc
      // comment). A profile launched with no `initialUrl` still gets userDataDir's own
      // cookies/localStorage restore (that part needs no help from this); only the
      // sessionStorage half of a bare, no-initialUrl launch stays lost until the caller
      // navigates and restores it themselves via `setStorageState`.
      if (options.initialUrl && this.hasRealPage(activeTab)) {
        const saved = await this.profileManager.loadStorageState(options.profileName).catch(() => undefined);
        if (saved && saved.origin === new URL(activeTab.url).origin) {
          // Best-effort — a failed restore should not fail the whole launch.
          await this.setStorageState(session.id, saved, activeTab.id).catch(() => {});
        }
      }
    }

    return {
      sessionId: session.id,
      activeTabId: activeTab.id,
      hasRealBrowser: this.hasRealPage(activeTab),
    };
  }

  /**
   * Attach to an EXTERNAL browser over the Chrome DevTools Protocol instead of launching one.
   *
   * This is the browser-extension path: the user's real, logged-in Chrome is the target
   * (exposed via `--remote-debugging-port` or the extension's `chrome.debugger` relay), so
   * the agent can operate on sessions headless Chrome cannot reach (SSO, 2FA, internal
   * tools). Sutradhar does NOT own the browser lifecycle here — closing the session detaches
   * but leaves the user's browser running.
   */
  public async attach(options: AttachOptions): Promise<LaunchResult> {
    const session = await this.sessionManager.createSession({
      sessionId: options.sessionId ? createSessionId(options.sessionId) : undefined,
      wsEndpoint: options.endpoint,
    });
    // BrowserSession does not mirror the external browser's existing tabs into its tab map, so
    // on attach the session appears tab-less even though the real browser may already have open
    // pages (e.g. left navigated by a previous `attach()` against this same wsEndpoint — the CLI
    // does exactly this to persist a "session" across separate short-lived process invocations).
    // Adopt EVERY open real page, not just the most recent one — found live: after `newtab`
    // opened a genuine second tab, the next CLI command's fresh `attach()` (a brand-new
    // BrowserSession, empty tab map) only ever adopted the single most-recently-opened page,
    // silently orphaning the first tab from `tabs`/`focustab`/`closetab` for the rest of the
    // CLI session — a real, previously-latent gap the new tab-management commands finally made
    // directly visible. The most-recently-opened page still becomes the active tab, preserving
    // prior single-tab behavior exactly.
    let activeTab = session.activeTabId
      ? session.getTab(session.activeTabId)
      : session.getTabs()[0];
    if (!activeTab) {
      const openPages = await this.findAllOpenPages(session);
      if (openPages.length > 0) {
        for (const page of openPages.slice(0, -1)) {
          await session.adoptExistingPage(page, false);
        }
        activeTab = await session.adoptExistingPage(openPages[openPages.length - 1]!, false);
      } else {
        activeTab = await session.createTab();
      }
      session.setActiveTab(activeTab.id);
    }
    return {
      sessionId: session.id,
      activeTabId: activeTab.id,
      hasRealBrowser: this.hasRealPage(activeTab),
    };
  }

  /** Best-effort: every non-blank page already open on `session`'s underlying browser, in
   *  Puppeteer's own discovery order (relevant only for `attach()`, where the browser process
   *  outlives this runtime instance). Never throws — a failure here just means `attach()` falls
   *  back to opening a fresh blank tab, same as before this existed. */
  private async findAllOpenPages(session: IBrowserSession) {
    try {
      const browser = session.getPuppeteerBrowser();
      if (!browser) return [];
      const pages = await browser.pages();
      // Exclude blank/about:blank pages — adopting one of those is no better than opening a
      // fresh tab, and a browser freshly launched with no navigation yet always has exactly one.
      return pages.filter((p) => p.url() && p.url() !== 'about:blank');
    } catch {
      return [];
    }
  }

  /** Shut down a single session and release its browser. If the session was launched with
   *  `profileName`, its current storage-state (cookies/localStorage/sessionStorage) is
   *  persisted for that profile first, best-effort — see {@link ProfileManager.saveStorageState}
   *  for why this matters beyond what `userDataDir` alone already covers. */
  public async shutdown(sessionId: string, reason = 'Runtime shutdown'): Promise<void> {
    const session = this.requireSession(sessionId);
    const profileName = this.sessionProfiles.get(sessionId);
    if (profileName) {
      const activeTab = session.activeTabId ? session.getTab(session.activeTabId) : session.getTabs()[0];
      if (activeTab && this.hasRealPage(activeTab)) {
        const state = await this.getStorageState(sessionId, activeTab.id).catch(() => undefined);
        if (state) {
          await this.profileManager.saveStorageState(profileName, state).catch(() => {});
        }
      }
      this.sessionProfiles.delete(sessionId);
    }
    await this.sessionManager.closeSession(session.id, reason);
  }

  /** Shut down every session. Safe to call on teardown. Persists storage-state for every
   *  profile-launched session first, same as {@link shutdown} — bypassing that per-session
   *  logic here would silently lose any profile's session-storage-based login on every
   *  teardown that goes through this method instead of individual `shutdown()` calls. */
  public async shutdownAll(): Promise<void> {
    await Promise.all(
      Array.from(this.sessionProfiles.keys()).map((sessionId) =>
        this.shutdown(sessionId, 'Runtime shutdown').catch(() => {}),
      ),
    );
    await this.sessionManager.closeAllSessions();
    this.sessionManager.dispose();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────────────────────

  /** Navigate a tab to a URL. Creates a tab in the session if none is specified. */
  public async navigate(
    sessionId: string,
    url: string,
    tabId?: string,
  ): Promise<NavigateResult> {
    this.assertNavigationAllowed(url);
    await this.rateLimiter?.removeToken();
    const { tab } = this.resolveTab(sessionId, tabId, /* createIfMissing */ true);
    const dto = await tab.navigate(url);
    return { tabId: dto.id, url: dto.url, title: dto.title };
  }

  public async goBack(sessionId: string, tabId?: string): Promise<NavigateResult> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    await page.goBack();
    return { tabId: tab.id, url: page.url(), title: await this.readTitle(tab) };
  }

  public async goForward(sessionId: string, tabId?: string): Promise<NavigateResult> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    await page.goForward();
    return { tabId: tab.id, url: page.url(), title: await this.readTitle(tab) };
  }

  public async reload(sessionId: string, tabId?: string): Promise<NavigateResult> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    await page.reload({ waitUntil: 'domcontentloaded' });
    return { tabId: tab.id, url: page.url(), title: await this.readTitle(tab) };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Agent vision — the semantic DOM snapshot
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Produce an LLM-optimized snapshot of the active page: the interactive-element
   * listing (data-sd-node-id stamped), the element count, and a visible-text excerpt.
   * This is the single most reusable asset for an external AI driving the browser.
   *
   * `maxElements` (default 60) bounds how many elements appear in `interactiveElements` — up
   * to `MAX_STAMPED_ELEMENTS_PER_FRAME` (300) elements per frame get a real, clickable id
   * regardless of this value, so raising it (e.g. for a content-heavy page whose pagination
   * link is past the default 60) surfaces ids that already exist rather than stamping new ones.
   */
  public async snapshot(
    sessionId: string,
    tabId?: string,
    maxElements?: number,
    options?: { includeNodes?: boolean; noText?: boolean; idsOnly?: boolean; scanEventListeners?: boolean },
  ): Promise<SnapshotResult> {
    const { tab } = this.resolveTab(sessionId, tabId);
    this.requirePage(tab); // fail early if no real browser
    const graph = await this.domEngine.buildGraph(tab, { scanEventListeners: options?.scanEventListeners });
    const interactiveElements = formatGraphForLlm(graph, maxElements, {
      noText: options?.noText,
      idsOnly: options?.idsOnly,
    });
    const pageText = await this.readPageText(tab);
    return {
      sessionId,
      tabId: tab.id,
      url: graph.url || tab.url,
      title: graph.title || tab.title,
      interactiveElements,
      elementCount: graph.nodes.length,
      pageText,
      ...(options?.includeNodes ? { nodes: graph.nodes } : {}),
    };
  }

  /**
   * Accessibility-tree-based alternative to {@link snapshot} — see ax-snapshot.ts for why this
   * exists alongside it rather than replacing it. Nothing in the returned listing can go stale
   * (no ids); act on it via `clickByRole`/`clickByText`/`typeByLabel`, which re-resolve by
   * role/text/label at call time.
   */
  public async axSnapshot(sessionId: string, tabId?: string): Promise<AxSnapshotResult> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    return buildAxSnapshot(page);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Interaction (click / type / press / scroll / hover / select)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Click an element. `target` may be a CSS selector OR a numeric sd-node-id from a
   * prior {@link SutradharRuntime.snapshot} (e.g. `"7"` → `[data-sd-node-id="7"]`).
   */
  public async click(
    sessionId: string,
    target: string,
    tabId?: string,
    modifiers?: readonly ('Control' | 'Shift' | 'Alt' | 'Meta')[],
    /** Click at a specific point within the target's bounding box, relative to its top-left
     *  corner, instead of the default (its center). Needed for canvas-rendered UI, where the
     *  interactive thing is pixels drawn inside a `<canvas>`, not a sub-selectable DOM node. */
    offset?: { x: number; y: number },
    /** Opt-in: after the click, wait for the page to stop actively changing (no DOM mutations,
     *  no in-flight network requests) before returning — see `ActionParams.settle`'s doc
     *  comment. Off by default; pass `true` for the defaults or a partial `SettleSpec` to
     *  override individual fields. Useful when a click triggers a menu/modal/toast that takes
     *  a moment to finish rendering and the very next call needs to see the settled result. */
    settle?: boolean | SettleSpec,
  ): Promise<ActionResult> {
    return this.runAction(
      sessionId,
      { actionType: 'click', selector: normalizeTarget(target), modifiers, offset, settle },
      tabId,
    );
  }

  /**
   * Focus an element via the real DOM `.focus()` method — unlike {@link click}, this does not
   * simulate a mouse click at coordinates, so it does not move/collapse an existing text cursor
   * or selection. Use this (not `click`) to focus a field before a `pressKey` call that's part
   * of a multi-step keyboard sequence (e.g. Home, then Ctrl+Shift+Right to select a word) — a
   * `click`-based focus resets the cursor to the click point on every call, silently discarding
   * cursor state built by a prior `pressKey` in the same sequence (found live: `cli.ts`'s
   * `press` command previously used `click` to focus, which broke exactly this pattern when
   * testing a real rich-text-editor's word-select-then-format toolbar workflow).
   */
  public async focus(sessionId: string, target: string, tabId?: string): Promise<ActionResult> {
    return this.runAction(sessionId, { actionType: 'focus', selector: normalizeTarget(target) }, tabId);
  }

  /**
   * Click at an absolute viewport coordinate — no element or selector involved at all. For
   * UI with nothing DOM-addressable to target: content drawn inside a `<canvas>` at a
   * position not known ahead of time (unlike {@link SutradharRuntime.click}'s `offset`, which
   * still needs a real element to be relative to), a PDF/video overlay, or anything only
   * knowable from a screenshot's pixel coordinates rather than the page's semantic structure.
   */
  public async clickAtPoint(
    sessionId: string,
    x: number,
    y: number,
    tabId?: string,
    button: 'left' | 'right' | 'middle' = 'left',
  ): Promise<ActionResult> {
    const start = Date.now();
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    try {
      await page.mouse.click(x, y, { button });
      return {
        success: true,
        actionType: 'click_at_point',
        executionTimeMs: Date.now() - start,
        currentUrl: page.url(),
        title: await this.readTitle(tab),
        output: { x, y, button },
      };
    } catch (err) {
      return {
        success: false,
        actionType: 'click_at_point',
        executionTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Drag from one absolute viewport coordinate to another — no elements or selectors involved
   * at all, the coordinate-only sibling of {@link SutradharRuntime.clickAtPoint}. For dragging
   * canvas-rendered content (a slider drawn on a `<canvas>`, a custom chart handle) where
   * {@link SutradharRuntime.dragAndDrop}'s element-to-element model doesn't apply. Performs a
   * real mouse-down → move → mouse-up sequence (not the HTML5 `DataTransfer` drag Puppeteer's
   * element-level drag-and-drop uses), matching how canvas/custom UI actually reads input.
   */
  public async dragAtPoints(
    sessionId: string,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    tabId?: string,
  ): Promise<ActionResult> {
    const start = Date.now();
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    try {
      await page.mouse.move(fromX, fromY);
      await page.mouse.down();
      await page.mouse.move(toX, toY);
      await page.mouse.up();
      return {
        success: true,
        actionType: 'drag_at_points',
        executionTimeMs: Date.now() - start,
        currentUrl: page.url(),
        title: await this.readTitle(tab),
        output: { fromX, fromY, toX, toY },
      };
    } catch (err) {
      return {
        success: false,
        actionType: 'drag_at_points',
        executionTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Type text into an element targeted by selector or sd-node-id. */
  public async type(
    sessionId: string,
    target: string,
    value: string,
    tabId?: string,
    /** Opt-in post-action settle wait — see {@link SutradharRuntime.click}'s equivalent param
     *  for what this does. Useful when typing triggers an async autocomplete/validation UI
     *  that takes a moment to render and the next call needs to see it. */
    settle?: boolean | SettleSpec,
  ): Promise<ActionResult> {
    return this.runAction(
      sessionId,
      { actionType: 'type', selector: normalizeTarget(target), value, settle },
      tabId,
    );
  }

  /**
   * Fill multiple form fields in one call — an object mapping each field's target (selector or
   * numeric `[#id]`) to the value to type into it. Fields are filled sequentially, not in
   * parallel, to avoid focus-stealing races between fields on the same page (matches how a
   * real user tabs through a form). A field that fails doesn't stop the rest from being
   * attempted — returns one {@link ActionResult} per field, keyed by its target.
   */
  public async fillForm(
    sessionId: string,
    fields: Record<string, string>,
    tabId?: string,
  ): Promise<Record<string, ActionResult>> {
    const results: Record<string, ActionResult> = {};
    for (const [target, value] of Object.entries(fields)) {
      results[target] = await this.type(sessionId, target, value, tabId).catch(
        (err: unknown) =>
          ({
            success: false,
            actionType: 'type',
            executionTimeMs: 0,
            error: err instanceof Error ? err.message : String(err),
          }) satisfies ActionResult,
      );
    }
    return results;
  }

  /** Press a keyboard key (e.g. `"Enter"`, `"Escape"`). */
  public async pressKey(
    sessionId: string,
    key: string,
    tabId?: string,
    modifiers?: readonly ('Control' | 'Shift' | 'Alt' | 'Meta')[],
  ): Promise<ActionResult> {
    return this.runAction(sessionId, { actionType: 'press_key', key, modifiers }, tabId);
  }

  /** Scroll the page. direction defaults to "down"; amount defaults to 500px. */
  public async scroll(
    sessionId: string,
    direction: 'up' | 'down' | 'top' | 'bottom' = 'down',
    amount = 500,
    tabId?: string,
    /**
     * Scroll THIS element's own scroll container instead of the window — a CSS selector or
     * `snap` node id. Needed for anything with its own independent scrollable region: a
     * virtualized data grid's rows, a chat pane, a modal's scrollable body, a code block.
     * Without this, `scroll` can only ever move `window.scrollY`, which does nothing to a
     * nested scroll container (confirmed live against a real virtualized data grid — window-
     * scrolling the page left its rendered rows completely unchanged).
     */
    target?: string,
    /** Opt-in post-action settle wait — see {@link SutradharRuntime.click}'s equivalent param.
     *  Particularly useful after scrolling a virtualized region: many virtualization libraries
     *  (confirmed live against a real MUI Data Grid) re-render their visible rows on a short
     *  debounce after the real scroll event, not synchronously — reading the DOM immediately
     *  after `scroll` returns can still show the pre-scroll rows. */
    settle?: boolean | SettleSpec,
  ): Promise<ActionResult> {
    return this.runAction(
      sessionId,
      { actionType: 'scroll', direction, amount, selector: target ? normalizeTarget(target) : undefined, settle },
      tabId,
    );
  }

  /** Hover an element targeted by selector or sd-node-id. `offset` (relative to the target's
   *  top-left corner) hovers a specific point within it instead of its center. */
  public async hover(
    sessionId: string,
    target: string,
    tabId?: string,
    offset?: { x: number; y: number },
  ): Promise<ActionResult> {
    return this.runAction(sessionId, { actionType: 'hover', selector: normalizeTarget(target), offset }, tabId);
  }

  /** Select an `<option>` by value on a `<select>` targeted by selector or sd-node-id. */
  public async selectOption(
    sessionId: string,
    target: string,
    value: string,
    tabId?: string,
  ): Promise<ActionResult> {
    return this.runAction(
      sessionId,
      { actionType: 'select_option', selector: normalizeTarget(target), value },
      tabId,
    );
  }

  /** Select multiple values on a `<select multiple>`. */
  public async selectOptions(
    sessionId: string,
    target: string,
    values: readonly string[],
    tabId?: string,
  ): Promise<ActionResult> {
    return this.runAction(
      sessionId,
      { actionType: 'select_option', selector: normalizeTarget(target), values },
      tabId,
    );
  }

  /** Wait for a selector to appear (and be visible) before returning. */
  public async waitForSelector(
    sessionId: string,
    target: string,
    timeoutMs?: number,
    tabId?: string,
  ): Promise<ActionResult> {
    return this.runAction(
      sessionId,
      { actionType: 'wait_for_selector', selector: normalizeTarget(target), timeoutMs },
      tabId,
    );
  }

  /** Click the first element whose visible text contains `text`. */
  public async clickByText(sessionId: string, text: string, tabId?: string): Promise<ActionResult> {
    return this.runAction(sessionId, { actionType: 'click_by_text', text }, tabId);
  }

  /** Click an element by its ARIA `role` attribute (optionally narrowed by accessible `name`). */
  public async clickByRole(
    sessionId: string,
    role: string,
    name?: string,
    tabId?: string,
  ): Promise<ActionResult> {
    return this.runAction(sessionId, { actionType: 'click_by_role', role, name }, tabId);
  }

  /** Type into the input whose `aria-label` or `placeholder` matches `label`. */
  public async typeByLabel(
    sessionId: string,
    label: string,
    value: string,
    tabId?: string,
  ): Promise<ActionResult> {
    return this.runAction(sessionId, { actionType: 'type_by_label', label, value }, tabId);
  }

  /** Upload a local file into a `<input type="file">` targeted by selector or sd-node-id. */
  public async uploadFile(
    sessionId: string,
    target: string,
    filePath: string,
    tabId?: string,
  ): Promise<ActionResult> {
    return this.runAction(
      sessionId,
      { actionType: 'upload_file', selector: normalizeTarget(target), filePath },
      tabId,
    );
  }

  /** Right-click (or middle-click) an element targeted by selector or sd-node-id. */
  public async clickWithButton(
    sessionId: string,
    target: string,
    button: 'left' | 'right' | 'middle',
    tabId?: string,
  ): Promise<ActionResult> {
    return this.runAction(
      sessionId,
      { actionType: 'click', selector: normalizeTarget(target), button },
      tabId,
    );
  }

  /** Drag `sourceTarget` onto `destTarget` (both selectors or sd-node-ids). */
  public async dragAndDrop(
    sessionId: string,
    sourceTarget: string,
    destTarget: string,
    tabId?: string,
  ): Promise<ActionResult> {
    return this.runAction(
      sessionId,
      {
        actionType: 'drag_and_drop',
        selector: normalizeTarget(sourceTarget),
        targetSelector: normalizeTarget(destTarget),
      },
      tabId,
    );
  }

  /** Simulate a touchscreen tap on an element targeted by selector or sd-node-id. */
  public async touchTap(sessionId: string, target: string, tabId?: string): Promise<ActionResult> {
    return this.runAction(
      sessionId,
      { actionType: 'touch_tap', selector: normalizeTarget(target) },
      tabId,
    );
  }

  /**
   * Trigger a file download by clicking `target` and wait for it to land on disk.
   * `downloadDir` defaults to the OS temp directory.
   */
  public async downloadFile(
    sessionId: string,
    target: string,
    downloadDir?: string,
    tabId?: string,
  ): Promise<ActionResult> {
    return this.runAction(
      sessionId,
      { actionType: 'download_file', selector: normalizeTarget(target), downloadDir, timeoutMs: 30000 },
      tabId,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Capture & inspection
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Capture a PNG screenshot. Full-page by default; pass `fullPage: false` to capture
   * only the current viewport. Returns raw base64 (no data-URI prefix).
   */
  public async screenshot(
    sessionId: string,
    tabId?: string,
    fullPage = true,
  ): Promise<ScreenshotResult> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    const base64 = (await page.screenshot({ type: 'png', encoding: 'base64', fullPage })) as string;
    return { base64 };
  }

  /** Export the current page as a PDF. Returns raw base64 (no data-URI prefix). */
  public async exportPdf(sessionId: string, tabId?: string): Promise<PdfResult> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    const buf = await page.pdf({ format: 'A4' });
    return { base64: Buffer.from(buf).toString('base64') };
  }

  /**
   * Resolve an `<iframe>` element (found on the top-level page, by CSS selector or snapshot
   * node id) to its own `Frame` — including genuinely cross-origin frames. `page.evaluate()`
   * runs in the top-level page's own JS context, so it's subject to the same-origin policy
   * exactly like any page script would be; a `Frame`'s `.evaluate()` runs via Puppeteer's
   * per-frame CDP execution context instead, which is why `click`/`type` (built on
   * `browser-action-engine`'s cross-frame `resolveElement`) can already reach into a
   * cross-origin iframe while a plain page-level `eval()` cannot — this gives `eval`/
   * `extractData` the same real capability, not a workaround.
   */
  /**
   * Resolves `frameSelector` against the top-level page, one `<iframe>` hop at a time. Accepts
   * a chain of selectors separated by `"::"` (e.g. `"iframe.widget::iframe.payment"`) to reach
   * an iframe nested inside another iframe — the main `click`/`type` grounding path
   * (`browser-action-engine`'s `resolveElement`) already recursively pierces arbitrary nesting
   * depth automatically, but this explicit frame-targeting path previously only ever looked one
   * level deep on the top-level page, silently failing to find anything inside a deeper frame
   * (found live testing a real 3-level nested iframe chain — a genuine pattern, e.g. a chat
   * widget iframe that itself lazily injects a payment sub-iframe).
   */
  private async resolveFrame(page: ReturnType<SutradharRuntime['requirePage']>, frameSelector: string) {
    const hops = frameSelector.split('::').map((s) => s.trim()).filter((s) => s.length > 0);
    type Hoppable = {
      $(selector: string): Promise<{ contentFrame(): Promise<Hoppable | null> } | null>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural type spanning
      // both Puppeteer's Page and Frame, whose real `evaluate` overloads are too varied to
      // usefully narrow here; callers already cast their own specific return type.
      evaluate(fn: any, ...args: any[]): Promise<any>;
    };
    let current: Hoppable = page;
    for (const [i, hop] of hops.entries()) {
      const handle = await current.$(normalizeTarget(hop));
      if (!handle) {
        throw new Error(
          `No element matched frameSelector "${hop}" (from the full chain "${frameSelector}") — reached via ${i === 0 ? 'the top-level page' : 'the previous frame in the chain'}.`,
        );
      }
      const frame = await handle.contentFrame();
      if (!frame) {
        throw new Error(
          `Element matching "${hop}" is not an <iframe> (or its content frame isn't available yet — the frame may still be loading).`,
        );
      }
      current = frame;
    }
    return current;
  }

  /**
   * Extract structured data: for each entry in `fields`, run a `querySelectorAll` and collect
   * either the element's text content or a named attribute from every match. A purpose-built
   * alternative to hand-writing an `eval()` scraper for the common "give me a list of
   * {title, price, link}" case.
   *
   * Runs against the top-level page by default. Pass `frameSelector` (a CSS selector or
   * snapshot node id identifying an `<iframe>` element on the top-level page) to extract from
   * inside that frame instead — including a genuinely cross-origin one.
   */
  public async extractData(
    sessionId: string,
    fields: Record<string, { selector: string; attribute?: string }>,
    tabId?: string,
    frameSelector?: string,
  ): Promise<Record<string, string[]>> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    const target = frameSelector ? await this.resolveFrame(page, frameSelector) : page;
    return target.evaluate((fieldSpec: Record<string, { selector: string; attribute?: string }>) => {
      const out: Record<string, string[]> = {};
      for (const [name, spec] of Object.entries(fieldSpec)) {
        const elements = Array.from(document.querySelectorAll(spec.selector));
        out[name] = elements.map((el) =>
          spec.attribute ? (el.getAttribute(spec.attribute) ?? '') : (el.textContent ?? '').trim(),
        );
      }
      return out;
    }, fields);
  }

  /**
   * Evaluate arbitrary JS. Runs in the top-level page's context by default; pass
   * `frameSelector` (a CSS selector or snapshot node id identifying an `<iframe>` element on
   * the top-level page) to evaluate inside that frame instead — including a genuinely
   * cross-origin one, which the top-level page's own JS could never reach into itself. For an
   * iframe nested inside another iframe, chain selectors with `"::"`
   * (e.g. `"iframe.widget::iframe.payment"` reaches a payment iframe nested inside a widget
   * iframe) — see {@link resolveFrame}.
   */
  public async eval<T = unknown>(
    sessionId: string,
    code: string,
    tabId?: string,
    frameSelector?: string,
  ): Promise<T> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    const target = frameSelector ? await this.resolveFrame(page, frameSelector) : page;
    // evaluate<unknown, unknown> keeps the dynamic return type honest under strict TS.
    return (await target.evaluate(code as unknown as string)) as T;
  }

  /** Read cookies for the active tab's URL. */
  public async getCookies(sessionId: string, tabId?: string): Promise<unknown[]> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    return page.cookies();
  }

  /** Set (or overwrite) a cookie. Defaults `url` to the tab's current URL if not given. */
  public async setCookie(
    sessionId: string,
    cookie: {
      name: string;
      value: string;
      url?: string;
      domain?: string;
      path?: string;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: 'Strict' | 'Lax' | 'None';
      expires?: number;
    },
    tabId?: string,
  ): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    await page.setCookie({ url: page.url(), ...cookie });
  }

  /** Delete a cookie by name (optionally scoped to a URL; defaults to the tab's current one). */
  public async deleteCookie(sessionId: string, name: string, url?: string, tabId?: string): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    await page.deleteCookie({ name, url: url ?? page.url() });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Storage: localStorage / sessionStorage
  // ─────────────────────────────────────────────────────────────────────────

  /** Dump all localStorage key/value pairs for the current page. */
  public async getLocalStorage(sessionId: string, tabId?: string): Promise<Record<string, string>> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    return page.evaluate(() => ({ ...window.localStorage }));
  }

  /** Set a single localStorage item. */
  public async setLocalStorageItem(
    sessionId: string,
    key: string,
    value: string,
    tabId?: string,
  ): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    await page.evaluate((k, v) => window.localStorage.setItem(k, v), key, value);
  }

  /** Clear all localStorage for the current page's origin. */
  public async clearLocalStorage(sessionId: string, tabId?: string): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    await page.evaluate(() => window.localStorage.clear());
  }

  /** Dump all sessionStorage key/value pairs for the current page. */
  public async getSessionStorage(sessionId: string, tabId?: string): Promise<Record<string, string>> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    return page.evaluate(() => ({ ...window.sessionStorage }));
  }

  /** Set a single sessionStorage item. */
  public async setSessionStorageItem(
    sessionId: string,
    key: string,
    value: string,
    tabId?: string,
  ): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    await page.evaluate((k, v) => window.sessionStorage.setItem(k, v), key, value);
  }

  /** Clear all sessionStorage for the current page's origin. */
  public async clearSessionStorage(sessionId: string, tabId?: string): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    await page.evaluate(() => window.sessionStorage.clear());
  }

  /**
   * Export the tab's full auth/session-relevant state — cookies, localStorage, sessionStorage
   * — as a single portable blob. Distinct from the per-item cookie/storage tools (bulk vs
   * one-at-a-time) and from the CLI's named-profile mechanism (a whole userDataDir on disk,
   * tied to one machine) — this blob can be saved and handed to a *different* session, even on
   * a different machine, to restore login state without redoing a login flow.
   */
  public async getStorageState(sessionId: string, tabId?: string): Promise<StorageState> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    const cookies = await page.cookies();
    const [localStorageItems, sessionStorageItems] = await page.evaluate(() => {
      const dump = (store: Storage) => {
        const out: Record<string, string> = {};
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          if (key !== null) out[key] = store.getItem(key) ?? '';
        }
        return out;
      };
      return [dump(window.localStorage), dump(window.sessionStorage)] as [Record<string, string>, Record<string, string>];
    });
    // `new URL(...).origin`, not the raw `page.url()` — found live while wiring 5c (profile ↔
    // storage-state persistence): this previously returned the full URL (path/query/hash and
    // all) mislabeled as "origin", which silently broke any caller that actually compared
    // origins for a match (as launch()'s profile-restore path now does) since two pages on the
    // same origin but different paths would never compare equal.
    const origin = new URL(page.url()).origin;
    return { origin, cookies, localStorage: localStorageItems, sessionStorage: sessionStorageItems };
  }

  /**
   * Restore a blob previously captured by {@link SutradharRuntime.getStorageState} — sets
   * every cookie, then every localStorage/sessionStorage item, on the current tab. Call this
   * right after navigating to the target origin (storage APIs are origin-scoped) and before
   * anything else that depends on being logged in.
   */
  public async setStorageState(sessionId: string, state: StorageState, tabId?: string): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    if (state.cookies.length > 0) {
      await page.setCookie(...(state.cookies as Parameters<typeof page.setCookie>));
    }
    await page.evaluate(
      (ls, ss) => {
        for (const [key, value] of Object.entries(ls)) window.localStorage.setItem(key, value);
        for (const [key, value] of Object.entries(ss)) window.sessionStorage.setItem(key, value);
      },
      state.localStorage,
      state.sessionStorage,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Geolocation & permissions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Override the page's geolocation. Auto-grants the 'geolocation' permission for the
   * current origin first — without it, in-page `navigator.geolocation` calls would still
   * be blocked even with coordinates set.
   */
  public async setGeolocation(
    sessionId: string,
    coords: { latitude: number; longitude: number; accuracy?: number },
    tabId?: string,
  ): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    const origin = new URL(page.url()).origin;
    await page.browserContext().overridePermissions(origin, ['geolocation']);
    await page.setGeolocation(coords);
  }

  /** Grant a set of permissions (e.g. 'geolocation', 'notifications', 'camera') for an origin. */
  public async grantPermissions(
    sessionId: string,
    origin: string,
    permissions: string[],
    tabId?: string,
  ): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    await page.browserContext().overridePermissions(origin, permissions as any);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Viewport, media/locale/timezone emulation, clipboard
  // ─────────────────────────────────────────────────────────────────────────

  /** Resize the viewport (and optionally emulate a mobile device / pixel ratio) at runtime —
   *  the launch-time `viewport` option only sets the *initial* size. */
  public async setViewport(
    sessionId: string,
    viewport: {
      width: number;
      height: number;
      isMobile?: boolean;
      deviceScaleFactor?: number;
      /** Enable touch-event emulation (`ontouchstart` in window, etc). Defaults to `isMobile`'s
       *  value — every real mobile device has touch, so mobile emulation without it is
       *  incomplete and can make touch-branching sites behave like desktop despite isMobile. */
      hasTouch?: boolean;
    },
    tabId?: string,
  ): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    // Resolve the default explicitly with `??` rather than relying on spread order — a caller
    // (e.g. the MCP tool handler) that builds this object from destructured params always
    // includes the `hasTouch` key, even as `undefined`, which would silently defeat a
    // `{hasTouch: default, ...viewport}`-style spread (an explicit `undefined` in a later
    // spread overrides an earlier value — it doesn't get skipped like a genuinely absent key).
    const hasTouch = viewport.hasTouch ?? viewport.isMobile ?? false;
    await page.setViewport({ ...viewport, hasTouch });
  }

  /**
   * Emulate timezone/locale/color-scheme/reduced-motion for the page. Each field is optional
   * and independent — pass only the ones you want to change.
   */
  public async emulateSettings(
    sessionId: string,
    settings: {
      timezone?: string;
      locale?: string;
      colorScheme?: 'light' | 'dark' | 'no-preference';
      reducedMotion?: 'reduce' | 'no-preference';
    },
    tabId?: string,
  ): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    if (settings.timezone !== undefined) await page.emulateTimezone(settings.timezone);
    if (settings.locale !== undefined) await page.emulateLocale(settings.locale);
    const features: Array<{ name: string; value: string }> = [];
    if (settings.colorScheme) features.push({ name: 'prefers-color-scheme', value: settings.colorScheme });
    if (settings.reducedMotion) features.push({ name: 'prefers-reduced-motion', value: settings.reducedMotion });
    if (features.length > 0) await page.emulateMediaFeatures(features);
  }

  /**
   * Emulate network conditions — offline mode and/or throughput/latency throttling. Offline is
   * independent of throughput/latency (matches Puppeteer's own split: `setOfflineMode` doesn't
   * touch the throttling values, and vice versa), so both can be set in the same call.
   *
   * `preset` picks one of Chrome DevTools' standard profiles ('Slow 3G' | 'Fast 3G' | 'Slow 4G'
   * | 'Fast 4G'). Pass explicit `download`/`upload` (bytes/sec) and `latency` (ms) instead for a
   * custom profile. Pass `conditions: null` (or omit both `preset` and explicit values) to
   * clear throttling back to unrestricted.
   */
  public async emulateNetwork(
    sessionId: string,
    options: {
      offline?: boolean;
      conditions?:
        | { preset: 'Slow 3G' | 'Fast 3G' | 'Slow 4G' | 'Fast 4G' }
        | { download: number; upload: number; latency: number }
        | null;
    },
    tabId?: string,
  ): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    if (options.offline !== undefined) await page.setOfflineMode(options.offline);
    if (options.conditions === null) {
      await page.emulateNetworkConditions(null);
    } else if (options.conditions && 'preset' in options.conditions) {
      await page.emulateNetworkConditions(NETWORK_CONDITION_PRESETS[options.conditions.preset]);
    } else if (options.conditions) {
      await page.emulateNetworkConditions(options.conditions);
    }
  }

  /** Read the current clipboard text. Requires the 'clipboard-read' permission — grant it
   *  first via {@link grantPermissions} if this throws a permission error. */
  public async getClipboard(sessionId: string, tabId?: string): Promise<string> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    // The async Clipboard API requires the document to have focus, and in practice still
    // throws NotAllowedError in some headless Chrome configurations even with the
    // 'clipboard-read' permission granted and the page focused — fall back to the older
    // execCommand('paste') path (via a scratch textarea), which headless Chrome honors
    // more reliably.
    await page.bringToFront();
    try {
      return await page.evaluate(() => navigator.clipboard.readText());
    } catch {
      return page.evaluate(() => {
        const ta = document.createElement('textarea');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        document.execCommand('paste');
        const value = ta.value;
        document.body.removeChild(ta);
        return value;
      });
    }
  }

  /** Write text to the clipboard. Requires the 'clipboard-write' permission (granted by
   *  default in most browsers for the active tab, but not guaranteed headless). */
  public async setClipboard(sessionId: string, text: string, tabId?: string): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    await page.bringToFront();
    try {
      await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    } catch {
      // See getClipboard's comment — same headless-Chrome fallback.
      await page.evaluate((t) => {
        const ta = document.createElement('textarea');
        ta.value = t;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }, text);
    }
  }

  /**
   * Upload a file via a JS-triggered native file picker (e.g. a styled "Browse" button that
   * isn't a plain `<input type=file>` — `uploadFile`/`browser.upload_file` can't target
   * those). Clicks `triggerSelector` and races it against Puppeteer's file-chooser
   * interception, then feeds it the given local path.
   */
  public async uploadFileViaTrigger(
    sessionId: string,
    triggerTarget: string,
    filePath: string,
    tabId?: string,
  ): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    // This bypasses BrowserActionEngine entirely (no action-engine 'upload_file' case
    // involved), so it needs its own copy of the same existence/allowlist check that case
    // applies — otherwise this path would read an arbitrary host file with no validation at
    // all, unlike its sibling.
    await this.assertUploadPathAllowed(filePath);
    const selector = normalizeTarget(triggerTarget);
    const [fileChooser] = await Promise.all([
      page.waitForFileChooser(),
      page.click(selector),
    ]);
    await fileChooser.accept([filePath]);
  }

  /** Shared with {@link uploadFileViaTrigger} — mirrors `BrowserActionEngine`'s
   *  `assertUploadPathAllowed` for the one upload path that bypasses the action engine. */
  private async assertUploadPathAllowed(filePath: string): Promise<void> {
    const resolved = path.resolve(filePath);
    try {
      await access(resolved);
    } catch {
      throw new Error(`Upload file "${filePath}" does not exist or is not accessible.`);
    }

    if (!this.allowedUploadRoots || this.allowedUploadRoots.length === 0) return;

    const canonical = await realpath(resolved).catch(() => resolved);
    for (const root of this.allowedUploadRoots) {
      const resolvedRoot = path.resolve(root);
      const canonicalRoot = await realpath(resolvedRoot).catch(() => resolvedRoot);
      if (canonical === canonicalRoot || canonical.startsWith(canonicalRoot + path.sep)) return;
    }
    throw new Error(
      `Upload file "${filePath}" is outside the allowed upload directories ` +
        `(${this.allowedUploadRoots.join(', ')}).`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Observability: console / page errors / network / dialogs
  // ─────────────────────────────────────────────────────────────────────────

  /** Recent console messages logged by the page (bounded ring buffer). */
  public getConsoleLogs(sessionId: string, tabId?: string) {
    const { tab } = this.resolveTab(sessionId, tabId);
    return tab.getConsoleLogs();
  }

  /** Recent uncaught page errors (bounded ring buffer). */
  public getPageErrors(sessionId: string, tabId?: string) {
    const { tab } = this.resolveTab(sessionId, tabId);
    return tab.getPageErrors();
  }

  /** Recent network request/response activity (bounded ring buffer). */
  public getNetworkLog(sessionId: string, tabId?: string) {
    const { tab } = this.resolveTab(sessionId, tabId);
    return tab.getNetworkLog();
  }

  /**
   * A single-page audit bundling screenshot, console/page/network errors, basic accessibility
   * checks, and Core Web Vitals — mirrors what real Sutradhar's `sutradhar audit <url>` produces.
   * If `url` is given, navigates there first and waits `settleMs` (default 1500ms) for the page
   * to render and Web Vitals observers to collect data before capturing anything; omit it to
   * audit whatever page the session is already on.
   */
  public async audit(sessionId: string, options: { url?: string; tabId?: string; settleMs?: number } = {}): Promise<AuditResult> {
    if (options.url) {
      this.assertNavigationAllowed(options.url);
      // Install the Web Vitals observers BEFORE navigating (not after) — LCP/CLS entries are
      // only ever captured by an observer that was already listening when they occurred; a
      // post-hoc performance.getEntriesByType() query, unlike for 'paint'/'navigation' entries,
      // comes back empty for them otherwise. This only matters when we're doing the navigating
      // ourselves; auditing a page the caller already loaded can't retroactively observe vitals
      // that already happened, so lcpMs/cls legitimately come back null in that case.
      const { tab: preNavTab } = this.resolveTab(sessionId, options.tabId);
      const preNavPage = this.requirePage(preNavTab);
      await preNavPage.evaluateOnNewDocument(VITALS_OBSERVER_SCRIPT);
      await this.navigate(sessionId, options.url, options.tabId);
      await new Promise((r) => setTimeout(r, options.settleMs ?? 1500));
    }

    const { tab } = this.resolveTab(sessionId, options.tabId);
    const page = this.requirePage(tab);

    const [screenshotBase64, pageResult] = await Promise.all([
      page.screenshot({ type: 'png', encoding: 'base64', fullPage: true }) as Promise<string>,
      page.evaluate(AUDIT_PAGE_SCRIPT) as Promise<{ issues: A11yIssue[]; webVitals: WebVitals }>,
    ]);

    const consoleErrors = tab
      .getConsoleLogs()
      .filter((l) => l.logType === 'error')
      .map((l) => ({ text: l.text, timestamp: l.timestamp }));
    const pageErrors = tab.getPageErrors().map((e) => ({ message: e.message, timestamp: e.timestamp }));
    const brokenRequests = tab
      .getNetworkLog()
      .filter((n) => n.phase === 'response' && n.status !== undefined && n.status >= 400)
      .map((n) => ({ url: n.url, status: n.status! }));

    return {
      url: page.url(),
      title: await this.readTitle(tab),
      timestamp: new Date().toISOString(),
      screenshotBase64,
      consoleErrors,
      pageErrors,
      brokenRequests,
      accessibilityIssues: pageResult.issues,
      webVitals: pageResult.webVitals,
    };
  }

  /**
   * Visual regression check: navigate to `urlA` then `urlB` in turn (same session/tab, so same
   * viewport for both — a size mismatch between the two screenshots would make a pixel diff
   * meaningless), screenshot each, and pixel-diff them. Mirrors real Sutradhar's
   * `sutradhar compare <url1> <url2>`.
   */
  public async compareUrls(
    sessionId: string,
    urlA: string,
    urlB: string,
    options: { tabId?: string; settleMs?: number; threshold?: number } = {},
  ): Promise<VisualCompareResult> {
    this.assertNavigationAllowed(urlA);
    this.assertNavigationAllowed(urlB);
    const settleMs = options.settleMs ?? 500;

    // Viewport-only (not fullPage) — two different pages will very likely have different
    // scrollable heights, and a fullPage capture would make the two screenshots different
    // dimensions before the diff even runs, which compareScreenshots() rejects outright.
    await this.navigate(sessionId, urlA, options.tabId);
    await new Promise((r) => setTimeout(r, settleMs));
    const shotA = await this.screenshot(sessionId, options.tabId, false);

    await this.navigate(sessionId, urlB, options.tabId);
    await new Promise((r) => setTimeout(r, settleMs));
    const shotB = await this.screenshot(sessionId, options.tabId, false);

    return compareScreenshots(shotA.base64, shotB.base64, { threshold: options.threshold });
  }

  /** The tab's currently-open native dialog (alert/confirm/prompt), if any. */
  public getPendingDialog(sessionId: string, tabId?: string) {
    const { tab } = this.resolveTab(sessionId, tabId);
    return tab.getPendingDialog();
  }

  /** Accept or dismiss the tab's currently-open native dialog. */
  public async handleDialog(
    sessionId: string,
    action: 'accept' | 'dismiss',
    promptText?: string,
    tabId?: string,
  ): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    await tab.handleDialog(action, promptText);
  }

  /** The tab's current lock (owner + expiry), or `undefined` if unlocked/expired. See
   *  {@link TabLockInfo} for why this is advisory-only in this pass, not yet enforced against
   *  concurrent actions from a different caller. */
  public getTabLock(sessionId: string, tabId?: string) {
    const { tab } = this.resolveTab(sessionId, tabId);
    return tab.getLock();
  }

  /**
   * Acquire the tab's advisory lock for `owner`, valid for `ttlMs` (default 30s). Returns
   * `true` if acquired (tab was unlocked, the previous lock expired, or `owner` already held
   * it), `false` if a different owner currently holds a still-valid lock.
   */
  public lockTab(sessionId: string, owner: string, ttlMs = 30_000, tabId?: string): boolean {
    const { tab } = this.resolveTab(sessionId, tabId);
    return tab.acquireLock(owner, ttlMs);
  }

  /** Release the tab's lock if `owner` currently holds it. Returns `false` if the tab was
   *  unlocked, already expired, or held by a different owner. */
  public unlockTab(sessionId: string, owner: string, tabId?: string): boolean {
    const { tab } = this.resolveTab(sessionId, tabId);
    return tab.releaseLock(owner);
  }

  /**
   * Block or mock requests whose URL contains `pattern`. Lazily enables request interception
   * for the tab on first use.
   */
  public async addRoute(
    sessionId: string,
    pattern: string,
    action: 'block' | 'mock',
    mockOptions?: { status?: number; contentType?: string; body?: string },
    tabId?: string,
  ): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    await tab.addRoute({
      pattern,
      action,
      mockStatus: mockOptions?.status,
      mockContentType: mockOptions?.contentType,
      mockBody: mockOptions?.body,
    });
  }

  /** Remove all route rules for the tab and disable interception. */
  public async clearRoutes(sessionId: string, tabId?: string): Promise<void> {
    const { tab } = this.resolveTab(sessionId, tabId);
    await tab.clearRoutes();
  }

  /** Bounded history of recent actions run against this tab — the MCP-appropriate shape of
   *  "session replay data" (no video/HAR; a caller wanting a durable record can persist this
   *  however it likes). */
  public getActionHistory(sessionId: string, tabId?: string): readonly ActionHistoryEntry[] {
    const { tab } = this.resolveTab(sessionId, tabId);
    return tab.getActionHistory();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tabs
  // ─────────────────────────────────────────────────────────────────────────

  /** Open a new tab, optionally navigating to a URL. */
  public async createTab(sessionId: string, url?: string): Promise<TabInfo> {
    if (url) this.assertNavigationAllowed(url);
    const session = this.requireSession(sessionId);
    const tab = await session.createTab(url);
    return this.toTabInfo(tab);
  }

  /** Close a tab. */
  public async closeTab(sessionId: string, tabId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    await session.closeTab(createTabId(tabId));
  }

  /** Focus a tab. */
  public async focusTab(sessionId: string, tabId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    session.setActiveTab(createTabId(tabId));
  }

  /** List all tabs in a session. */
  public listTabs(sessionId: string): TabInfo[] {
    return this.requireSession(sessionId).getTabs().map((t) => this.toTabInfo(t));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Exposed internals (for advanced consumers like the MCP `agent.runGoal` tool)
  // ─────────────────────────────────────────────────────────────────────────

  /** The underlying session manager. Exposed so AgentCore can be wired against the
   *  same instance an MCP server is driving. */
  public getSessionManager(): BrowserSessionManager {
    return this.sessionManager;
  }

  /** The runtime's own event bus. Exposed so a caller wiring up `AgentCore` (e.g. the MCP
   *  server's `agent.runGoal` tool) can pass the SAME bus in — without this, events the agent
   *  loop publishes (like `session:blocked`) are only ever raised on a bus nobody is
   *  listening to. */
  public getEventBus(): EventBus {
    return this.eventBus;
  }

  /** Create/list/delete named, persistent browser profiles (cookies/history/localStorage
   *  survive across separate launches) — see {@link ProfileManager}. Pass a profile's name as
   *  `launch()`'s `profileName` option to actually use one. */
  public getProfileManager(): ProfileManager {
    return this.profileManager;
  }

  /**
   * The CDP WebSocket endpoint of a live session's underlying Chrome process, if it has a real
   * one. Lets a separate process later `attach({endpoint})` to the SAME running browser instead
   * of launching a new one — the mechanism the CLI uses to persist a session across separate
   * invocations (each CLI command is its own short-lived process).
   */
  public getSessionWsEndpoint(sessionId: string): string | undefined {
    const session = this.requireSession(sessionId);
    return session.getWsEndpoint();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────────

  private async runAction(
    sessionId: string,
    params: Parameters<BrowserActionEngine['executeAction']>[1],
    tabId?: string,
  ): Promise<ActionResult> {
    await this.rateLimiter?.removeToken();
    const { tab } = this.resolveTab(sessionId, tabId);
    const result = await this.actionEngine.executeAction(tab, params);
    return {
      success: result.success,
      actionType: result.actionType,
      executionTimeMs: result.executionTimeMs,
      currentUrl: result.currentUrl,
      title: result.title,
      output: result.outputData,
      error: result.error,
      retriesUsed: result.retriesUsed,
      verification: result.verification,
      failureScreenshot: result.failureScreenshot,
    };
  }

  private requireSession(sessionId: string): IBrowserSession {
    const session = this.sessionManager.getSession(createSessionId(sessionId));
    if (!session) {
      throw new BrowserNotAvailableError(`No browser session "${sessionId}". Call launch() first.`);
    }
    return session;
  }

  /**
   * Resolve a tab within a session. When `createIfMissing` is true (navigate) and no
   * tab is specified and the session has none, a fresh tab is created — matching the
   * server's /navigate behavior.
   */
  private resolveTab(
    sessionId: string,
    tabId?: string,
    createIfMissing = false,
  ): { session: IBrowserSession; tab: IBrowserTab } {
    const session = this.requireSession(sessionId);
    const tab = tabId
      ? session.getTab(createTabId(tabId))
      : session.activeTabId
        ? session.getTab(session.activeTabId)
        : session.getTabs()[0];
    if (!tab && createIfMissing) {
      // Defer the async createTab to the caller (navigate) — here just report absence.
      throw new BrowserNotAvailableError(`Session "${sessionId}" has no tab to act on.`);
    }
    if (!tab) {
      throw new BrowserNotAvailableError(`No tab "${tabId ?? '<active>'}" in session "${sessionId}".`);
    }
    return { session, tab };
  }

  /**
   * Return the live Puppeteer page or throw. The browser engine silently falls back
   * to a mock instance when Chrome fails to launch, so `tab.page` can be undefined.
   * Every page-touching verb must go through this guard.
   */
  private requirePage(tab: IBrowserTab) {
    const page = tab.page;
    if (!page || page.isClosed?.()) {
      throw new BrowserNotAvailableError(
        `Tab "${tab.id}" has no live browser page. Launch a real browser (headless:false or CHROME_PATH set).`,
      );
    }
    return page;
  }

  private hasRealPage(tab?: IBrowserTab): boolean {
    return !!tab && !!tab.page && !tab.page.isClosed?.();
  }

  /**
   * When {@link SutradharRuntimeOptions.restrictNavigationToLocal} and/or
   * {@link SutradharRuntimeOptions.allowedDomains} is set, rejects a navigation target that
   * fails either check. Both are a no-op when unset (the default) — most callers legitimately
   * need to browse the real internet without restriction. `file:`/`about:`/`data:` URLs are
   * always exempt from both checks.
   */
  private assertNavigationAllowed(url: string): void {
    if (!this.restrictNavigationToLocal && !this.allowedDomains) return;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      // Not a parseable absolute URL (e.g. a bare "example.com") — let it fail naturally at
      // the browser layer rather than misclassifying it here.
      return;
    }

    if (['file:', 'about:', 'data:'].includes(parsed.protocol)) return;

    const host = parsed.hostname.toLowerCase();

    if (this.restrictNavigationToLocal) {
      const isLocal =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host === '0.0.0.0' ||
        host.endsWith('.localhost') ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);

      if (!isLocal) {
        throw new Error(
          `Navigation to "${url}" was blocked: restrictNavigationToLocal is enabled, which only ` +
            'allows localhost/private-IP targets (and file:/about:/data: URLs). Disable this option ' +
            'if this runtime needs to reach the real internet.',
        );
      }
    }

    if (this.allowedDomains) {
      const allowed = this.allowedDomains.some((d) => {
        const domain = d.toLowerCase();
        return host === domain || host.endsWith(`.${domain}`);
      });

      if (!allowed) {
        throw new Error(
          `Navigation to "${url}" was blocked: allowedDomains is configured and "${host}" is not in ` +
            `the allowlist (${this.allowedDomains!.join(', ')}). This is a safety guardrail — add the ` +
            'domain to allowedDomains if this navigation is expected.',
        );
      }
    }
  }

  private async readTitle(tab: IBrowserTab): Promise<string> {
    const page = this.requirePage(tab);
    try {
      return (await page.title()) ?? '';
    } catch {
      return '';
    }
  }

  private async readPageText(tab: IBrowserTab): Promise<string> {
    const page = this.requirePage(tab);
    try {
      // Best-effort visible text excerpt (mirrors the server's snapshot endpoint).
      return (await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? '')) as string;
    } catch {
      return '';
    }
  }

  private toTabInfo(tab: IBrowserTab): TabInfo {
    return { id: tab.id, url: tab.url, title: tab.title, isActive: tab.isActive };
  }
}

// Re-export the node-id bridge so consumers don't need @sutradhar/browser for it.
export { selectorForNodeId };
