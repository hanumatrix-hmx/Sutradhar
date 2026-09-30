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
  DialogPolicy,
  SemanticNode,
  SessionActionHistoryEntry,
  SkippedFrame,
  VerificationResultDto,
  VerificationSpec,
} from '@sutradhar/browser';
import { assertSupportedSelectorDialect, InvalidSelectorError, SELECTOR_SYNTAX_HINT, selectorSyntaxDetail } from '@sutradhar/browser';
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
  /** FR2-04: overrides the runtime's own `dialogPolicy` default for this one session. */
  dialogPolicy?: DialogPolicy;
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
  /** FR2-04: overrides the runtime's own `dialogPolicy` default for this one session. */
  dialogPolicy?: DialogPolicy;
}

/**
 * FR2-07: the native dialog currently blocking a tab, exactly as FR2-04's CLI `dialogPending:` line
 * prints it (same keys, same order) so there is one contract across CLI, MCP and SDK.
 */
export interface DialogPendingInfo {
  type: string;
  message: string;
  defaultValue: string | null;
  url: string;
}

/** Result of {@link SutradharRuntime.navigate} / goBack / goForward / reload. */
export interface NavigateResult {
  tabId: string;
  url: string;
  title: string;
  /** FR2-07: did the navigation really commit? See `verification.evidence`. */
  verification?: VerificationResultDto;
  /** FR2-07: present only while a native dialog is open on the tab. */
  dialogPending?: DialogPendingInfo;
}

/** Result of {@link SutradharRuntime.screenshot}. */
export interface ScreenshotResult {
  /** Base64-encoded PNG bytes, WITHOUT the `data:image/png;base64,` prefix. */
  base64: string;
  /** FR2-07: a screenshot has no post-condition; the capture is checked to be a well-formed PNG. */
  verification?: VerificationResultDto;
}

/** Result of {@link SutradharRuntime.readClipboard}. */
export interface ClipboardReadResult {
  /** The clipboard text. `''` with an `unverifiable` verification means the read was BLOCKED, not
   *  that the clipboard is empty. */
  text: string;
  verification: VerificationResultDto;
  dialogPending?: DialogPendingInfo;
}

/**
 * FR2-07: the public, caller-facing post-action assertion (MCP `expect`, CLI `--expect-*`, SDK
 * `options.expect`). A failed expectation never fails the action: `success` stays true and the
 * verification reports `verified:false, tier:'contradicted'` with a failing `expect.*` check.
 */
export interface ActionExpectation {
  /** RENDERED text that must appear somewhere on the page after the action (any frame, open shadow
   *  roots; case-sensitive substring). Rendered = laid out, `visibility:visible`, not under `display:none` /
   *  `content-visibility:hidden` / a closed `<details>`, and every enclosing `<iframe>` itself rendered and
   *  visible; script/style text never counts. `opacity:0`, `aria-hidden`, off-screen and clipped text DO count.
   *  Checked once, right after the action (and after settle, if requested). */
  text?: string;
  /** Substring the tab's final URL must contain. */
  url?: string;
  /** true: the URL must differ from the pre-action URL. false: it must be identical (string
   *  compare, fragment included). */
  urlChanged?: boolean;
}

/**
 * FR2-08: the argument of `SutradharRuntime.waitFor` — a page condition plus a timeout. Every given
 * condition must hold at the same moment. `text`/`textGone` are the RENDERED-text check shared with
 * `expect.text` (same limits: text in never-painted SVG containers counts, split inline-block text and
 * `<textarea>` text can be missed); `url` is a substring of the tab URL; `js` is a side-effect-free JS
 * EXPRESSION evaluated in the main frame (a throw fails the wait).
 */
export interface WaitForCondition {
  text?: string;
  textGone?: string;
  url?: string;
  js?: string;
  /** Default 10000, max 300000; `<= 0` = check once. The REAL total: no retries. */
  timeoutMs?: number;
}

const EXPECTATION_KEYS = ['text', 'url', 'urlChanged'];

/**
 * Maps an {@link ActionExpectation} onto the engine's `VerificationSpec`. Throws `TypeError` on a
 * non-object, an unknown key, a `text`/`url` that isn't a non-empty string, or a non-boolean
 * `urlChanged` — before any browser contact. Returns `undefined` for `undefined`.
 */
export function toVerificationSpec(e: ActionExpectation | undefined): VerificationSpec | undefined {
  if (e === undefined) return undefined;
  if (e === null || typeof e !== 'object' || Array.isArray(e)) {
    throw new TypeError('expect must be an object: {text?: string, url?: string, urlChanged?: boolean}');
  }
  for (const k of Object.keys(e)) {
    if (!EXPECTATION_KEYS.includes(k)) {
      throw new TypeError(`expect has an unknown key "${k}" — allowed keys: text, url, urlChanged`);
    }
  }
  const { text, url, urlChanged } = e;
  if (text !== undefined && (typeof text !== 'string' || text.length === 0)) {
    throw new TypeError('expect.text must be a non-empty string');
  }
  if (url !== undefined && (typeof url !== 'string' || url.length === 0)) {
    throw new TypeError('expect.url must be a non-empty string');
  }
  if (urlChanged !== undefined && typeof urlChanged !== 'boolean') {
    throw new TypeError('expect.urlChanged must be a boolean');
  }
  return {
    ...(text !== undefined ? { expectedElementText: text } : {}),
    ...(url !== undefined ? { expectedUrlSubstring: url } : {}),
    ...(urlChanged !== undefined ? { shouldUrlChange: urlChanged } : {}),
  };
}

/** The `expect.*` keys whose check did not pass (`'text' | 'url' | 'urlChanged'`); `[]` when none were given. */
export function failedExpectations(v: VerificationResultDto | undefined): string[] {
  if (!v) return [];
  return v.evidence.checks
    .filter((c) => c.check.startsWith('expect.') && c.outcome !== 'pass')
    .map((c) => c.check.slice('expect.'.length));
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
  /** Post-action verification signal — did the action's observable effect match expectations?
   *  FR2-07: always present on a result the runtime produced; see `verification.evidence.tier`. */
  verification?: VerificationResultDto;
  /** Base64 PNG captured automatically when the action ultimately failed, for debugging. */
  failureScreenshot?: string;
  /** FR2-07: present only while a native dialog is open on the tab (closes GAP-018). */
  dialogPending?: DialogPendingInfo;
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
  /** FR2-07: the fs.stat-backed verification of the downloaded file. */
  verification?: VerificationResultDto;
}

export { type ActionHistoryEntry, type SessionActionHistoryEntry };

/** FR2-11: which history {@link SutradharRuntime.getActionHistoryReport} reads. */
export type ActionHistoryScope = 'tab' | 'session';

/** FR2-11: the result of {@link SutradharRuntime.getActionHistoryReport}. */
export interface ActionHistoryReport {
  scope: ActionHistoryScope;
  /** tab scope: the tab actually read (the active one when tabId was omitted). Absent for session scope. */
  tabId?: string;
  /** tab scope: entries oldest-first. session scope: entries ordered by `seq` (each has `tabId`, including tabs
   *  that have since closed). Always a COPY. */
  entries: readonly ActionHistoryEntry[] | readonly SessionActionHistoryEntry[];
  /** How many older entries this view has dropped since it began (tab lifetime / session lifetime).
   *  0 until the cap is hit, then exact. */
  evicted: number;
  /** The cap (200). */
  capacity: number;
}

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

export { SELECTOR_SYNTAX_HINT, selectorSyntaxDetail, InvalidSelectorError };
export type { DialogPolicy, DialogPolicyMode, DialogRecord } from '@sutradhar/browser';

/**
 * Convert a snapshot node id ("12") or selector string to the selector the engine resolves.
 * Throws {@link InvalidSelectorError} synchronously — before any session lookup, `await`, or CDP
 * call — for Playwright-style syntax (text=, role=, >>, :has-text(), getBy*(), internal:, …).
 * Everything else passes through unchanged; genuinely invalid CSS is judged later by the
 * browser's own parser (FR2-06).
 */
export function normalizeTarget(target: ElementTarget): string {
  const trimmed = target.trim();
  // A pure-numeric target is interpreted as a sd-node-id stamped by the DOM semantic engine —
  // checked first (D6) so node ids never pay for the dialect scan below.
  if (/^\d+$/.test(trimmed)) return `[data-sd-node-id="${trimmed}"]`;
  assertSupportedSelectorDialect(target);
  return target;
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
