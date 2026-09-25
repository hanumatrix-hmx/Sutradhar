/**
 * @file packages/capability-runtime/src/types.ts
 * @description Public option and result types for the Sutradhar capability runtime façade.
 *
 * These types are intentionally framework-agnostic — no HTTP, no MCP, no extension
 * glue. They describe the high-level browser verbs that every integration surface
 * (MCP server, npm SDK, plugins, extension) calls through {@link SutradharRuntime}.
 */

import type {
  ActionHistoryEntry,
  BrowserLaunchOptions,
  SemanticNode,
  SkippedFrame,
  VerificationResultDto,
} from '@sutradhar/browser';
import type { SessionId, TabId } from '@sutradhar/contracts';

/** Options for {@link SutradharRuntime.launch}. */
export interface LaunchOptions {
  /** Reuse an existing caller-owned session id; omit to let Sutradhar mint one. */
  sessionId?: string;
  /** Open a fresh tab and navigate here immediately after launch. */
  initialUrl?: string;
  /** Incognito context. Defaults to false. */
  isIncognito?: boolean;
  /** Forwarded to the underlying browser launcher. */
  launch?: BrowserLaunchOptions;
  /**
   * Launch using a named, persistent profile created via `SutradharRuntime`'s `ProfileManager`
   * (cookies/history/localStorage survive across separate launches) instead of a fresh,
   * throwaway userDataDir. Resolves to that profile's userDataDir and merges it into `launch` —
   * throws if the name doesn't exist. Takes precedence over an explicit `launch.userDataDir` if
   * both are somehow set, since naming a profile is a more specific request than a raw path.
   */
  profileName?: string;
}

/** Result of {@link SutradharRuntime.launch}. */
export interface LaunchResult {
  sessionId: string;
  activeTabId?: string;
  /** true only when a real Chrome/Edge page is backing the session. */
  hasRealBrowser: boolean;
}

/** Options for {@link SutradharRuntime.attach} — connect to an external browser over CDP. */
export interface AttachOptions {
  /**
   * CDP endpoint of the external browser. Either a raw WebSocket URL
   * (`ws://host:port/devtools/browser/<id>`) or an http discovery endpoint
   * (`http://127.0.0.1:9222`). The user's real Chrome is exposed by launching it with
   * `--remote-debugging-port=9222`, or by the browser extension via `chrome.debugger`.
   */
  endpoint: string;
  /** Reuse an existing caller-owned session id; omit to let Sutradhar mint one. */
  sessionId?: string;
}

/** Result of {@link SutradharRuntime.navigate}. */
export interface NavigateResult {
  tabId: string;
  url: string;
  title: string;
}

/** Result of {@link SutradharRuntime.screenshot}. */
export interface ScreenshotResult {
  /** Base64-encoded PNG bytes, WITHOUT the `data:image/png;base64,` prefix. */
  base64: string;
}

/** A rendered view of the page suitable for an LLM to reason over. */
export interface SnapshotResult {
  sessionId: string;
  tabId: string;
  url: string;
  title: string;
  /** Compact, LLM-optimized listing of interactive elements, e.g. `[#7] button "Search"`. */
  interactiveElements: string;
  /** Number of interactive elements discovered. */
  elementCount: number;
  /** Visible body text excerpt, best-effort. */
  pageText: string;
  /** The structured element data `interactiveElements` was itself rendered from — present only
   *  when the caller opts in via `snapshot(sessionId, tabId, maxElements, { includeNodes: true })`.
   *  Lets a caller consume real per-element fields (boundingBox, confidence, isEnabled, ...)
   *  instead of re-parsing the LLM-formatted text listing. Omitted by default so existing
   *  callers see a byte-identical payload. */
  nodes?: readonly SemanticNode[];
  /** Child frames whose content could not be read this snapshot (timed out, navigated,
   *  errored, browser error page) or that exceeded the frame cap — present exactly when
   *  `nodes` is (i.e. only when the caller opts in via `includeNodes`). Listed rather than
   *  silently dropped; see `SemanticNode.frame`/`shadowHosts` for per-node frame/shadow
   *  context on `nodes` itself. */
  skippedFrames?: readonly SkippedFrame[];
}

/** Result of {@link SutradharRuntime.click} and {@link SutradharRuntime.type}. */
export interface ActionResult {
  success: boolean;
  actionType: string;
  executionTimeMs: number;
  currentUrl?: string;
  title?: string;
  output?: Record<string, unknown>;
  error?: string;
  retriesUsed?: number;
  /** Post-action verification signal — did the action's observable effect match expectations? */
  verification?: VerificationResultDto;
  /** Base64 PNG captured automatically when the action ultimately failed, for debugging. */
  failureScreenshot?: string;
}

/** Result of {@link SutradharRuntime.exportPdf}. */
export interface PdfResult {
  /** Base64-encoded PDF bytes, WITHOUT the `data:application/pdf;base64,` prefix. */
  base64: string;
}

/**
 * A portable snapshot of a tab's auth/session-relevant browser state — everything
 * {@link SutradharRuntime.getStorageState}/{@link SutradharRuntime.setStorageState} need to
 * save and restore a logged-in session across a completely different browser session, even on
 * a different machine (unlike the CLI's named-profile mechanism, which ties state to a
 * userDataDir on one machine).
 */
export interface StorageState {
  /** The origin this state was captured from — restoring elsewhere only makes sense for the
   *  same origin, since storage APIs are origin-scoped. */
  origin: string;
  /** Raw cookie objects as returned by the underlying browser (shape intentionally left
   *  framework-agnostic here — round-trip through getStorageState/setStorageState, don't
   *  construct or inspect these by hand). */
  cookies: unknown[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

/** Result of {@link SutradharRuntime.downloadFile}. */
export interface DownloadResult {
  filename: string;
  path: string;
  downloadDir: string;
}

export { type ActionHistoryEntry };

/** A row in {@link SutradharRuntime.listTabs}. */
export interface TabInfo {
  id: string;
  url: string;
  title: string;
  isActive: boolean;
}

/** Failure raised when a session/tab cannot be resolved or the backing page is absent. */
export class BrowserNotAvailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'BrowserNotAvailableError';
  }
}

/** A verb argument that targets an element either by CSS selector or by snapshot node id. */
export type ElementTarget = string;

/** One named field of {@link SutradharRuntime.extractData}. */
export interface ExtractFieldSpec {
  /** Standard CSS (run with querySelectorAll in the target document) or a snapshot node id ("12"). */
  selector: string;
  /**
   * What to read from each matched element.
   * - omitted or '' → "what the user sees": <input>/<select>/<textarea> → the live `.value`;
   *   <option> → `.text`; any other element → rendered `innerText`, trimmed (falls back to
   *   `textContent`, trimmed, for elements without innerText, e.g. SVG).
   * - 'value' | 'checked' | 'selected' (case-insensitive) → the LIVE DOM property, stringified
   *   ('checked'/'selected' give "true"/"false"). An element with no such property of the right
   *   type (string for value, boolean for checked/selected) falls back to the raw attribute.
   * - 'attr:<name>' → the raw markup attribute via getAttribute ('' when absent),
   *   e.g. 'attr:value' = the original default value.
   * - any other name (e.g. 'href') → the raw attribute, exactly as before (href is NOT resolved).
   */
  attribute?: string;
  /** Per-field override of {@link ExtractDataOptions.visibleOnly}. */
  visibleOnly?: boolean;
}

/** Call-level options for {@link SutradharRuntime.extractData}. */
export interface ExtractDataOptions {
  /** Drop matched elements that are not visible: computed visibility hidden/collapse, or a zero
   *  width/height bounding box (same rule as wait_for_selector's state 'visible'; opacity and
   *  off-screen position are ignored). An <option> is judged by its owning <select>. Default false. */
  visibleOnly?: boolean;
}

/** Internal helper: convert a snapshot node id (number) or selector string to a CSS selector. */
export function normalizeTarget(target: ElementTarget): string {
  // A pure-numeric target is interpreted as a sd-node-id stamped by the DOM semantic engine.
  return /^\d+$/.test(target.trim()) ? `[data-sd-node-id="${target.trim()}"]` : target;
}

/**
 * Actionable tail appended to every selector-syntax error raised across the runtime (FR2-02).
 * Owned here as the seam FR2-06 (a dedicated fast Playwright-pattern detector) takes over —
 * FR2-06 may reword this constant and {@link selectorSyntaxDetail} in place, but every caller
 * (extractData, resolveFrame/eval today) keeps working unchanged.
 */
export const SELECTOR_SYNTAX_HINT =
  'Use standard CSS or a snapshot node id. Playwright-style selectors (text=, role=, >>, :has-text(), ' +
  'getBy*, internal:) are not supported: take a snapshot to find a CSS selector or node id, or use ' +
  'click_by_text / click_by_role / type_by_label to act by visible text.';

/**
 * Extracts the first line of a browser selector-parser error message, with a leading
 * "SyntaxError: " / "DOMException: " prefix stripped, for use in a Sutradhar-authored error
 * message (the raw parser message is still useful, just not as the exception's own `name`/type).
 * Never returns an empty string — falls back to a generic phrase when given no message.
 */
export function selectorSyntaxDetail(parserMessage: string): string {
  const firstLine = (parserMessage ?? '').split('\n')[0]?.trim() ?? '';
  const stripped = firstLine.replace(/^(SyntaxError|DOMException):\s*/i, '').trim();
  return stripped.length > 0 ? stripped : 'invalid selector syntax';
}

export { type SessionId, type TabId };

/** One caller-owned browser session, as reported by {@link SutradharRuntime.listSessions}. */
export interface LiveSessionInfo {
  sessionId: string;
  /** How the session came to exist: launch() (Sutradhar owns the browser) or attach() (external browser). */
  origin: 'launched' | 'attached';
  /** ISO timestamp the session was created (BrowserSession.createdAt). */
  createdAt: string;
  tabCount: number;
  activeTabId?: string;
  /** The active tab's current URL (full; callers that display it should shorten it). */
  activeUrl?: string;
  /** false when the session is backed by the no-Chrome mock instance (launch fell back). */
  hasRealBrowser: boolean;
}

/** Snapshot of the runtime's caller-owned sessions at one instant. */
export interface LiveSessionsView {
  /** Sorted by createdAt ascending, then sessionId. */
  sessions: LiveSessionInfo[];
  /** launch/attach/shutdown/shutdownAll calls currently executing — while > 0 the set is changing. */
  lifecycleOpsInFlight: number;
}
