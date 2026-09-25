/**
 * @file packages/mcp-server/src/tools.ts
 * @description Tool definitions that expose Sutradhar's browser engine (and, optionally,
 * its autonomous agent) to MCP-compatible AI clients.
 *
 * Two categories:
 *   1. Browser tools  — the host AI is the brain; it calls launch/snapshot/click/type/...
 *      and reasons over the returned DOM listing. This is the primary, always-available surface.
 *   2. agent.runGoal  — Sutradhar's own loop is the brain. Only registered when an AgentCore
 *      is supplied, which in turn requires an LLM provider (Ollama/OpenRouter) to be configured.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SutradharRuntime } from '@sutradhar/capability-runtime';
import type { AgentCore } from '@sutradhar/agent';
import { createGoalId } from '@sutradhar/contracts';
import { withSessionResolution } from './session-resolution.js';

/** Shape of the agent core passed to {@link registerTools}, if autonomous mode is enabled. */
export interface AgentHandle {
  agentCore: AgentCore;
}

/** Options for {@link registerTools}. */
export interface RegisterToolsOptions {
  runtime: SutradharRuntime;
  /** Provide this to also register the `agent.runGoal` autonomous-agent tool. */
  agent?: AgentHandle;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-line remediation hints appended to well-known error patterns — most tool errors are
 * just Puppeteer's/the action engine's raw message forwarded verbatim, which is often
 * missing the Sutradhar-specific fix (e.g. "re-snapshot" isn't something Puppeteer's own
 * error text would ever say). Matched by substring against the lowercased message; first
 * match wins. Deliberately short and generic — this is a hint, not a diagnosis.
 */
const ERROR_HINTS: ReadonlyArray<readonly [pattern: string, hint: string, unless?: readonly string[]]> = [
  // These two must precede the generic 'timed out' entry below — a wait_for_selector timeout
  // message always contains "timed out" too, and without a more specific match winning first
  // the hint would be the misleading "The page may still be loading" (FR2-01).
  [
    'but none is visible',
    'The element exists but is hidden. Pass state:"attached" to wait only for DOM presence, or trigger whatever reveals it.',
  ],
  [
    'waiting for state=hidden',
    'The element is still visible. Check the selector, or raise timeoutMs.',
    // GAP-111 (FR2-01 audit-5/fix-5): this hint asserts a CONFIDENT claim ("the element is
    // still visible") that directly contradicts the engine's own honest uncertainty message
    // for the SAME "waiting for state=hidden" substring — `hiddenVerdict === 'unknown'` (a
    // busy/unresponsive frame, not a confirmed-visible one) produces "...could not verify: one
    // or more frames were unresponsive", which is a genuinely different outcome from "some
    // frame confirmed it's still visible" (GAP-082's whole point at the engine layer). Without
    // this exclusion, the MCP layer re-collapses the tri-state result the engine just went to
    // the trouble of preserving. Any future "could not determine..." uncertainty phrasing this
    // or a later fix introduces for the same message family must be added here too.
    ['could not verify', 'could not determine'],
  ],
  ['stale snapshot', 'Call browser.snapshot again and use a fresh element id.'],
  ['no visible element found', 'Verify the selector/id via browser.snapshot — the page may have changed.'],
  ['no element found', 'Verify the selector/id via browser.snapshot — the page may have changed.'],
  ['timed out', 'The page may still be loading — retry, or raise timeoutMs on this call.'],
  ['no live browser page', 'Call browser.launch (or browser.health to check availability) before acting on this session.'],
  ['no browser session', 'Call browser.launch first to create a session.'],
  ['occluded', 'Another element is covering the target — try scrolling it into view or re-snapshot the page.'],
  ['outside the allowed download directories', 'Pass a downloadDir under an allowed root, or omit it to use the default.'],
];

/** Appends a one-line remediation hint to `message` for well-known error patterns, when one
 *  matches — otherwise returns it unchanged. A pattern's optional `unless` list (GAP-111) skips
 *  that hint (falling through to try later, lower-priority entries — e.g. the generic 'timed
 *  out' one) when the message also contains one of those substrings, so a hint asserting a
 *  confident claim never fires on the engine's own honest "couldn't verify" outcome. */
function withHint(message: string): string {
  const lower = message.toLowerCase();
  const match = ERROR_HINTS.find(
    ([pattern, , unless]) => lower.includes(pattern) && !(unless ?? []).some((u) => lower.includes(u)),
  );
  return match ? `${message}\nHint: ${match[1]}` : message;
}

/** Wrap an error into an MCP tool-execution error (isError: true) the model can recover from,
 *  appending a one-line remediation hint for well-known error patterns when one matches. */
function errorResult(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: withHint(message) }] };
}

/**
 * Serialize a plain object as JSON text content. Most action tools (browser.click,
 * browser.type, ...) never throw for a routine action failure — `SutradharRuntime`'s action
 * wrappers resolve with `{success:false, error: "..."}` rather than rejecting, so that
 * result flows through here, not through `errorResult`. Enrich `.error` the same way so the
 * hint actually reaches the common case, not just the rarer thrown-exception path.
 */
function jsonResult(value: unknown) {
  if (
    value &&
    typeof value === 'object' &&
    'success' in value &&
    (value as { success: unknown }).success === false &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  ) {
    value = { ...value, error: withHint((value as { error: string }).error) };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register all Sutradhar browser tools (and, if an agent is provided, the
 * `agent.runGoal` tool) onto an {@link McpServer}.
 */
export function registerTools(mcpServer: McpServer, options: RegisterToolsOptions): void {
  const { runtime } = options;
  // FR2-10: every tool whose schema requires sessionId gets it made optional, resolved to the
  // one live session when omitted (error listing the live ids when there are 0 or several). One
  // mechanism for all tools — see session-resolution.ts.
  const server = withSessionResolution(mcpServer, runtime);

  // ── Lifecycle ────────────────────────────────────────────────────────────
  server.registerTool(
    'browser.health',
    {
      description:
        'Preflight check: is a real Chrome/Edge executable available? Cheap — does not launch a ' +
        'browser process. Use before browser.launch to check availability, or to diagnose why a ' +
        'session came back with hasRealBrowser:false.',
      inputSchema: {
        executablePath: z.string().optional().describe('Check a specific path instead of auto-detecting.'),
      },
    },
    async ({ executablePath }) => {
      try {
        return jsonResult(runtime.checkHealth(executablePath));
      } catch (e) {
        return errorResult(`health check failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.launch',
    {
      description:
        'Launch a real browser session. Returns a sessionId and whether a real Chrome/Edge page is backing ' +
        'the session. Optionally open an initial URL. Pass the sessionId to other browser tools. You may omit ' +
        'it while this is the ONLY live session: the call then uses that session and says so. With 0 or several ' +
        'live sessions, an omitted sessionId fails and lists the live ids. Nothing is ever guessed. The ' +
        'sessionId parameter HERE is different: it is the id to create (or return, if already live) and never ' +
        'selects an existing session automatically. Omitting it always launches a new session.',
      inputSchema: {
        sessionId: z.string().optional().describe('Reuse an existing caller-owned session id.'),
        initialUrl: z.string().url().optional().describe('Open a tab and navigate here immediately.'),
        headless: z.boolean().optional().describe('Run headless. Defaults to true in most environments.'),
        userAgent: z
          .string()
          .optional()
          .describe(
            'Override navigator.userAgent for this session. Unset by default — the real Chrome UA ' +
              '(including "HeadlessChrome" when headless) is left as-is; this is plain configurability, not a ' +
              'detection-evasion default.',
          ),
        profileName: z
          .string()
          .optional()
          .describe(
            'Launch using a named, persistent profile (cookies/history/localStorage survive across separate ' +
              'launches) — create one first via the CLI ("sutradhar profile create <name>") or the SDK\'s ' +
              'profile manager. Throws if the name does not exist.',
          ),
        viewport: z
          .object({ width: z.number().int().positive(), height: z.number().int().positive() })
          .optional()
          .describe(
            'Set the initial viewport size (CDP device-metrics override, plus a best-effort real OS window ' +
              'resize for a non-headless session). Use browser.set_viewport to change it mid-session instead, ' +
              'or to also emulate mobile/touch/pixel-ratio. Was previously accepted only by browser.set_viewport, ' +
              'not at launch time — found missing via an external field report (PROB-042).',
          ),
      },
    },
    async ({ sessionId, initialUrl, headless, userAgent, profileName, viewport }) => {
      try {
        const result = await runtime.launch({
          sessionId,
          initialUrl,
          launch:
            headless !== undefined || userAgent !== undefined || viewport !== undefined
              ? { headless, userAgent, viewport }
              : undefined,
          profileName,
        });
        if (!result.hasRealBrowser) {
          return errorResult(
            'Browser launched but no real page is available (Chrome may not be installed/found). ' +
              'Set CHROME_PATH or install Chrome/Edge. Other browser tools will fail until a real page exists.',
          );
        }
        return jsonResult(result);
      } catch (e) {
        return errorResult(`launch failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.attach',
    {
      description:
        "Attach to the user's REAL browser over the Chrome DevTools Protocol, instead of launching a new one. " +
        'Lets the agent operate on sites behind the user\'s SSO/2FA (the use case headless Chrome cannot reach). ' +
        'The user exposes their browser by launching Chrome with --remote-debugging-port, or via the Sutradhar extension. ' +
        'endpoint is an http discovery URL (e.g. http://127.0.0.1:9222) or a ws:// URL.',
      inputSchema: {
        endpoint: z
          .string()
          .describe('CDP endpoint: http://127.0.0.1:9222 or ws://host:port/devtools/browser/<id>'),
        sessionId: z.string().optional(),
      },
    },
    async ({ endpoint, sessionId }) => {
      try {
        const result = await runtime.attach({ endpoint, sessionId });
        if (!result.hasRealBrowser) {
          return errorResult(
            'Attached but no real page is available. Ensure Chrome is running with the matching --remote-debugging-port.',
          );
        }
        return jsonResult(result);
      } catch (e) {
        return errorResult(`attach failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.shutdown',
    {
      description: 'Shut down a browser session and release its browser process.',
      inputSchema: { sessionId: z.string().describe('The session id from browser.launch.') },
    },
    async ({ sessionId }) => {
      try {
        await runtime.shutdown(sessionId);
        return jsonResult({ success: true, sessionId });
      } catch (e) {
        return errorResult(`shutdown failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.shutdown_all',
    {
      description:
        'Shut down every browser session and release all browser processes. Use when wrapping ' +
        'up entirely, not for closing a single session (use browser.shutdown for that).',
      inputSchema: {},
    },
    async () => {
      try {
        await runtime.shutdownAll();
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`shutdown_all failed: ${(e as Error).message}`);
      }
    },
  );

  // ── Navigation ───────────────────────────────────────────────────────────
  server.registerTool(
    'browser.navigate',
    {
      description: 'Navigate a session\'s tab to a URL. Creates a tab if none is active.',
      inputSchema: {
        sessionId: z.string(),
        url: z.string().url(),
        tabId: z.string().optional().describe('Target a specific tab; defaults to the active one.'),
      },
    },
    async ({ sessionId, url, tabId }) => {
      try {
        return jsonResult(await runtime.navigate(sessionId, url, tabId));
      } catch (e) {
        return errorResult(`navigate failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.go_back',
    {
      description: "Navigate back in the tab's history.",
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        return jsonResult(await runtime.goBack(sessionId, tabId));
      } catch (e) {
        return errorResult(`go_back failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.go_forward',
    {
      description: "Navigate forward in the tab's history.",
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        return jsonResult(await runtime.goForward(sessionId, tabId));
      } catch (e) {
        return errorResult(`go_forward failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.reload',
    {
      description: 'Reload the current page.',
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        return jsonResult(await runtime.reload(sessionId, tabId));
      } catch (e) {
        return errorResult(`reload failed: ${(e as Error).message}`);
      }
    },
  );

  // ── Agent vision (the killer feature) ────────────────────────────────────
  server.registerTool(
    'browser.snapshot',
    {
      description:
        'Capture an LLM-optimized snapshot of the active page. Returns `interactiveElements`: a compact listing ' +
        'of every interactive element stamped with a numeric [#id] (e.g. `[#7] button "Search"`), plus `pageText` ' +
        '(visible body text). Use the [#id] as the `target` argument to browser.click / browser.type to act on an element. ' +
        'Elements inside an iframe are listed as `[#31 in iframe "pay" (https://…)]` (the frame\'s URL is shown on its ' +
        'first listed element, then just `[#32 in iframe "pay"]`; an unnamed frame shows its number instead). Elements ' +
        'inside an open shadow root end with `(shadow: host-tag#id)`. Ids stay globally unique across frames, so pass ' +
        'just the number (`"31"`); when parsing, match `^\\[#(\\d+)`, not `^\\[#(\\d+)\\]`. A frame whose content could ' +
        'not be read is listed as `[iframe <origin> — not inspectable] (reason)` rather than silently omitted; take the ' +
        'snapshot again, or read it with eval/extract_data + `frameSelector` (e.g. `iframe[name="pay"]`). With ' +
        'includeNodes, nodes carry `frame` and `shadowHosts` fields, and skipped frames are returned as JSON. ' +
        'Caution: the [#id] is a snapshot of the DOM at the moment this ran — if the page re-renders afterward (a React/' +
        'Vue update, a list re-sorting) before you act on it, the id can point at nothing or the wrong element. For pages ' +
        'that update frequently, prefer browser.ax_snapshot + browser.click_by_role/click_by_text/type_by_label instead, ' +
        'which re-resolve the real element at the moment they run rather than trusting a stored id. ' +
        'maxElements (default 60) bounds the listing — raise it for a content-heavy page whose element of interest ' +
        '(e.g. a "next page" link) is further down; up to 300 elements per frame get a real, usable id regardless. ' +
        'includeNodes (default false) additionally returns the raw structured element data (boundingBox, confidence, ' +
        'isEnabled, ...) the listing was rendered from, as a JSON block after the text listing — use this when you need ' +
        'a field the compact listing does not show, instead of re-parsing the listing text. ' +
        'noText (default false) drops each line\'s name/label/placeholder/value text, keeping tag+role+id — for when ' +
        'you already know what you\'re targeting (e.g. from an earlier full snapshot) and just need fresh ids after a ' +
        're-render. idsOnly (default false) drops everything but the id itself — the smallest possible listing, at the ' +
        'cost of it no longer being self-describing; implies noText. ' +
        'scanEventListeners (default false) additionally finds elements whose ONLY interactivity signal is a real ' +
        'addEventListener-attached handler with no onclick=/role=/tabindex/cursor:pointer at all — real libraries ' +
        '(e.g. SortableJS-based drag lists) attach raw pointerdown/mousedown/dragstart handlers with zero CSS/ARIA ' +
        'signal, invisible to the default pass. Uses real CDP event-listener introspection (not a guess), bounded to ' +
        '150 candidates. Slower than a normal snapshot — reach for it only when the default listing is missing ' +
        'something you can see is interactive. Note: some libraries attach the listener to a CONTAINER (event ' +
        'delegation), not each item — if so, this finds the container, and a real child selector (e.g. ' +
        '\':nth-child(N)\' on that container) still works for browser.drag_and_drop even though the child itself ' +
        'has no listener, since the delegated handler still receives the bubbled event.',
      inputSchema: {
        sessionId: z.string(),
        tabId: z.string().optional(),
        maxElements: z.number().int().positive().optional(),
        includeNodes: z.boolean().optional(),
        noText: z.boolean().optional(),
        idsOnly: z.boolean().optional(),
        scanEventListeners: z.boolean().optional(),
      },
    },
    async ({ sessionId, tabId, maxElements, includeNodes, noText, idsOnly, scanEventListeners }) => {
      try {
        const snap = await runtime.snapshot(sessionId, tabId, maxElements, {
          includeNodes,
          noText,
          idsOnly,
          scanEventListeners,
        });
        // Return as readable text rather than JSON — the model parses the listing directly.
        // `snap.interactiveElements` already embeds its own "URL/Title/Interactive elements
        // (N):" header (N = the true interactive-only count) — do not prepend another one here.
        // `snap.elementCount` counts ALL semantic-graph nodes, not just interactive ones, so a
        // second header built from it would show a different, confusing number (see the same
        // caveat in packages/cli/src/cli.ts's cmdSnap).
        const nodesBlock = snap.nodes ? `\n\nStructured nodes (JSON):\n${JSON.stringify(snap.nodes)}` : '';
        const skippedFramesBlock =
          snap.nodes && snap.skippedFrames && snap.skippedFrames.length > 0
            ? `\n\nSkipped frames (JSON):\n${JSON.stringify(snap.skippedFrames)}`
            : '';
        return {
          content: [
            {
              type: 'text' as const,
              text: `${snap.interactiveElements}\n\nPage text:\n${snap.pageText.slice(0, 2000)}${nodesBlock}${skippedFramesBlock}`,
            },
          ],
        };
      } catch (e) {
        return errorResult(`snapshot failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.ax_snapshot',
    {
      description:
        'Accessibility-tree-based alternative to browser.snapshot — reads the real browser-computed accessibility ' +
        'tree instead of stamped [#id] attributes, so it never goes stale if the page re-renders between reading ' +
        'this and acting on it. Nothing here has an id to look up; instead, act on what you read using ' +
        'browser.click_by_role (role + optional name), browser.click_by_text, or browser.type_by_label — all three ' +
        'resolve the real element fresh at the moment they run, not a snapshot of where it used to be. Prefer this ' +
        'over browser.snapshot when a page is known to re-render frequently (React/Vue apps, live-updating lists). ' +
        'Iframe content (including cross-origin frames) is included in place, grouped under an indented ' +
        '[iframe "name" (url)] line.',
      inputSchema: {
        sessionId: z.string(),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, tabId }) => {
      try {
        const snap = await runtime.axSnapshot(sessionId, tabId);
        return {
          content: [
            {
              type: 'text' as const,
              text: `URL: ${snap.url}\nTitle: ${snap.title}\n\nAccessible elements (${snap.nodeCount}):\n${snap.listing}`,
            },
          ],
        };
      } catch (e) {
        return errorResult(`ax_snapshot failed: ${(e as Error).message}`);
      }
    },
  );

  // ── Interaction ──────────────────────────────────────────────────────────
  const targetDesc =
    'A CSS selector OR a numeric [#id] from browser.snapshot (e.g. "7" resolves to [data-sd-node-id="7"]). ' +
    "Puppeteer's pierce/, xpath/, aria/ and text/ prefixes are also accepted. Playwright syntax (text=, " +
    'role=, >>, :has-text(), getBy*()) is rejected immediately — use browser.click_by_text / ' +
    'browser.click_by_role / browser.type_by_label to target by visible text or role.';

  const settleDesc =
    'Opt-in: after the action, wait for the page to stop actively changing (no DOM mutations, no ' +
    'in-flight network requests) before returning — helps when the action triggers a menu/modal/' +
    'toast/autocomplete that takes a moment to finish rendering and the very next call needs to see ' +
    'the settled result. true uses the defaults (300ms DOM-quiet, 500ms network-idle, 5s overall ' +
    'bound); pass an object to override individual fields. Off by default — most actions don\'t need ' +
    'it and it adds real latency.';
  const settleSchema = z
    .union([
      z.boolean(),
      z.object({
        mutationQuietMs: z.number().optional(),
        networkIdleMs: z.number().optional(),
        timeoutMs: z.number().optional(),
      }),
    ])
    .optional()
    .describe(settleDesc);

  server.registerTool(
    'browser.click',
    {
      description:
        'Click an element on the page. Optionally hold modifier keys (Ctrl+click, Shift+click, etc.), ' +
        'or click a specific point within the element via offset (needed for canvas-rendered UI, where ' +
        "the interactive thing is pixels drawn inside a <canvas> — e.g. offset:{x:80,y:20} to click 80px " +
        "right and 20px down from the canvas element's top-left corner, instead of its center).",
      inputSchema: {
        sessionId: z.string(),
        target: z.string().describe(targetDesc),
        modifiers: z.array(z.enum(['Control', 'Shift', 'Alt', 'Meta'])).optional(),
        offset: z
          .object({ x: z.number(), y: z.number() })
          .optional()
          .describe('Click this point relative to the target element\'s top-left corner, instead of its center.'),
        tabId: z.string().optional(),
        settle: settleSchema,
      },
    },
    async ({ sessionId, target, modifiers, offset, tabId, settle }) => {
      try {
        return jsonResult(await runtime.click(sessionId, target, tabId, modifiers, offset, settle));
      } catch (e) {
        return errorResult(`click failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.click_at_point',
    {
      description:
        'Click at an absolute viewport coordinate — no element or selector at all. For UI with nothing ' +
        "DOM-addressable to target (canvas content at a position only knowable from a screenshot's pixel " +
        "coordinates, a PDF/video overlay). Prefer browser.click when there's a real element to target — " +
        "this bypasses element resolution and verification entirely.",
      inputSchema: {
        sessionId: z.string(),
        x: z.number().describe('Viewport x coordinate in pixels.'),
        y: z.number().describe('Viewport y coordinate in pixels.'),
        button: z.enum(['left', 'right', 'middle']).optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, x, y, button, tabId }) => {
      try {
        return jsonResult(await runtime.clickAtPoint(sessionId, x, y, tabId, button));
      } catch (e) {
        return errorResult(`click_at_point failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.drag_at_points',
    {
      description:
        'Drag from one absolute viewport coordinate to another — no elements or selectors at all, the ' +
        'coordinate-only sibling of browser.click_at_point. For canvas-rendered drag targets (a slider or ' +
        'chart handle drawn on a <canvas>) where browser.drag_and_drop\'s element-to-element model doesn\'t ' +
        'apply. Performs a real mouse-down -> move -> mouse-up sequence.',
      inputSchema: {
        sessionId: z.string(),
        fromX: z.number(),
        fromY: z.number(),
        toX: z.number(),
        toY: z.number(),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, fromX, fromY, toX, toY, tabId }) => {
      try {
        return jsonResult(await runtime.dragAtPoints(sessionId, fromX, fromY, toX, toY, tabId));
      } catch (e) {
        return errorResult(`drag_at_points failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.type',
    {
      description: 'Type text into an input element (replaces existing focus; clears field first if needed).',
      inputSchema: {
        sessionId: z.string(),
        target: z.string().describe(targetDesc),
        value: z.string().describe('Text to type into the element.'),
        tabId: z.string().optional(),
        settle: settleSchema,
      },
    },
    async ({ sessionId, target, value, tabId, settle }) => {
      try {
        return jsonResult(await runtime.type(sessionId, target, value, tabId, settle));
      } catch (e) {
        return errorResult(`type failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.press_key',
    {
      description:
        'Press a keyboard key (e.g. "Enter", "Escape", "Tab"). Optionally hold modifier keys ' +
        '(e.g. modifiers:["Control"], key:"a" for Ctrl+A).',
      inputSchema: {
        sessionId: z.string(),
        key: z.string(),
        modifiers: z.array(z.enum(['Control', 'Shift', 'Alt', 'Meta'])).optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, key, modifiers, tabId }) => {
      try {
        return jsonResult(await runtime.pressKey(sessionId, key, tabId, modifiers));
      } catch (e) {
        return errorResult(`press_key failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.focus',
    {
      description:
        'Focus an element via the real DOM .focus() method — unlike browser.click, this does not simulate a ' +
        'mouse click at coordinates, so it does not move or collapse an existing text cursor/selection. Use ' +
        'this (not click) before a browser.press_key call that is part of a multi-step keyboard sequence ' +
        '(e.g. Home, then Ctrl+Shift+Right to select a word, then a toolbar click to format it) — clicking to ' +
        'focus on every step resets the cursor to the click point each time, silently discarding cursor state ' +
        "a prior press_key call already established.",
      inputSchema: {
        sessionId: z.string(),
        target: z.string().describe(targetDesc),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, target, tabId }) => {
      try {
        return jsonResult(await runtime.focus(sessionId, target, tabId));
      } catch (e) {
        return errorResult(`focus failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.scroll',
    {
      description:
        'Scroll the page, or a specific scrollable element within it. Without target, scrolls the window — does ' +
        'nothing to an element with its OWN independent scroll container (a virtualized data grid\'s rows, a chat ' +
        'pane, a modal\'s scrollable body, a code block). Pass target (a CSS selector or snap [#id]) to scroll that ' +
        'element\'s own scrollTop instead — confirmed live against a real virtualized data grid: window-scrolling ' +
        'left its rendered rows completely unchanged, target-scrolling correctly revealed new virtualized rows. ' +
        'Many virtualization libraries re-render on a short debounce after the real scroll, not synchronously — ' +
        'pair with settle:true to reliably see the new rows before your next call.',
      inputSchema: {
        sessionId: z.string(),
        direction: z.enum(['up', 'down', 'top', 'bottom']).optional().describe('Defaults to "down".'),
        amount: z.number().int().optional().describe('Pixels; defaults to 500.'),
        tabId: z.string().optional(),
        target: z.string().optional().describe(targetDesc + ' Scrolls this element\'s own scroll container instead of the window.'),
        settle: settleSchema,
      },
    },
    async ({ sessionId, direction, amount, tabId, target, settle }) => {
      try {
        return jsonResult(await runtime.scroll(sessionId, direction, amount, tabId, target, settle));
      } catch (e) {
        return errorResult(`scroll failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.hover',
    {
      description:
        'Hover the mouse over an element. Optionally hover a specific point within it via offset ' +
        '(relative to the top-left corner, instead of its center) — same use case as browser.click\'s offset.',
      inputSchema: {
        sessionId: z.string(),
        target: z.string().describe(targetDesc),
        offset: z
          .object({ x: z.number(), y: z.number() })
          .optional()
          .describe('Hover this point relative to the target element\'s top-left corner, instead of its center.'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, target, offset, tabId }) => {
      try {
        return jsonResult(await runtime.hover(sessionId, target, tabId, offset));
      } catch (e) {
        return errorResult(`hover failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.select_option',
    {
      description: 'Select an <option> by value on a <select> element.',
      inputSchema: {
        sessionId: z.string(),
        target: z.string().describe(targetDesc),
        value: z.string().describe('The option value to select.'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, target, value, tabId }) => {
      try {
        return jsonResult(await runtime.selectOption(sessionId, target, value, tabId));
      } catch (e) {
        return errorResult(`select_option failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.select_options',
    {
      description: 'Select multiple <option>s by value on a <select multiple> element.',
      inputSchema: {
        sessionId: z.string(),
        target: z.string().describe(targetDesc),
        values: z.array(z.string()).min(1).describe('The option values to select.'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, target, values, tabId }) => {
      try {
        return jsonResult(await runtime.selectOptions(sessionId, target, values, tabId));
      } catch (e) {
        return errorResult(`select_options failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.wait_for_selector',
    {
      description:
        'Wait for an element to reach a state before returning: "visible" by default, or "attached" / ' +
        '"hidden". Use this instead of guessing a fixed delay for content that loads or appears ' +
        'asynchronously (AJAX, toasts, animations). Visibility is checked on the first element matching ' +
        'the selector. "visible" means a non-empty bounding box AND computed visibility not ' +
        'hidden/collapse — opacity:0 and off-screen elements still count as visible; zero width/height, ' +
        'display:none and visibility:hidden count as hidden. timeoutMs applies to each internal attempt; ' +
        'retries can extend the real total wait beyond it (open issue). timeoutMs <= 0 checks the current ' +
        'state once, immediately, with no waiting or retrying. Waiting states poll roughly every 100ms, so ' +
        "a state that's only true for less than ~100ms (a fast visibility flicker) may be missed. On " +
        'success, state:"hidden" may also return output.otherVisibleMatches (best-effort) when a LATER ' +
        'match is still visible.',
      inputSchema: {
        sessionId: z.string(),
        target: z.string().describe(targetDesc),
        timeoutMs: z.number().int().optional().describe('Defaults to 10000ms. Applies per attempt; retries can extend the real total.'),
        tabId: z.string().optional(),
        state: z
          .enum(['visible', 'attached', 'hidden'])
          .optional()
          .describe(
            'Defaults to "visible". "visible": the element exists AND is visible — a non-empty box ' +
              '(width>0, height>0) AND computed visibility not hidden/collapse, checked on the FIRST ' +
              'matching element in document order. opacity:0 and off-screen positioning still count as ' +
              'visible; zero size, display:none, and visibility:hidden count as hidden. "attached": it ' +
              'only has to exist in the DOM, visibility ignored. "hidden": the first match is removed or ' +
              'not visible; succeeds immediately if nothing matches at all, so double-check the selector.',
          ),
      },
    },
    async ({ sessionId, target, timeoutMs, tabId, state }) => {
      try {
        return jsonResult(await runtime.waitForSelector(sessionId, target, timeoutMs, tabId, state));
      } catch (e) {
        return errorResult(`wait_for_selector failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.click_by_text',
    {
      description: 'Click the first element whose visible text contains the given text.',
      inputSchema: {
        sessionId: z.string(),
        text: z.string().describe('Visible text to match (substring match).'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, text, tabId }) => {
      try {
        return jsonResult(await runtime.clickByText(sessionId, text, tabId));
      } catch (e) {
        return errorResult(`click_by_text failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.click_by_role',
    {
      description: 'Click an element by its ARIA role (e.g. "button", "link", "checkbox").',
      inputSchema: {
        sessionId: z.string(),
        role: z.string().describe('ARIA role, e.g. "button".'),
        name: z.string().optional().describe('Accessible name to narrow the match, if ambiguous.'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, role, name, tabId }) => {
      try {
        return jsonResult(await runtime.clickByRole(sessionId, role, name, tabId));
      } catch (e) {
        return errorResult(`click_by_role failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.type_by_label',
    {
      description: 'Type into the input whose aria-label or placeholder matches the given label.',
      inputSchema: {
        sessionId: z.string(),
        label: z.string().describe('The input\'s aria-label or placeholder text.'),
        value: z.string().describe('Text to type.'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, label, value, tabId }) => {
      try {
        return jsonResult(await runtime.typeByLabel(sessionId, label, value, tabId));
      } catch (e) {
        return errorResult(`type_by_label failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.fill_form',
    {
      description:
        'Fill multiple form fields in one call instead of separate browser.type calls per field. ' +
        'Provide an object mapping each field\'s target (a CSS selector or numeric [#id] from browser.snapshot) ' +
        'to the value to type into it, e.g. {"#email": "a@b.com", "3": "hunter2"}. Fields are filled ' +
        'sequentially; a field that fails does not stop the rest — check each result.',
      inputSchema: {
        sessionId: z.string(),
        fields: z.record(z.string(), z.string()).refine((obj) => Object.keys(obj).length > 0, {
          message: 'fields must have at least one entry',
        }),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, fields, tabId }) => {
      try {
        return jsonResult(await runtime.fillForm(sessionId, fields, tabId));
      } catch (e) {
        return errorResult(`fill_form failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.upload_file',
    {
      description: 'Upload a local file into a <input type="file"> element.',
      inputSchema: {
        sessionId: z.string(),
        target: z.string().describe(targetDesc),
        filePath: z.string().describe('Absolute path to the local file to upload.'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, target, filePath, tabId }) => {
      try {
        return jsonResult(await runtime.uploadFile(sessionId, target, filePath, tabId));
      } catch (e) {
        return errorResult(`upload_file failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.right_click',
    {
      description: 'Right-click an element to open its context menu (or middle-click, via button).',
      inputSchema: {
        sessionId: z.string(),
        target: z.string().describe(targetDesc),
        button: z.enum(['right', 'middle']).optional().describe('Defaults to "right".'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, target, button, tabId }) => {
      try {
        return jsonResult(await runtime.clickWithButton(sessionId, target, button ?? 'right', tabId));
      } catch (e) {
        return errorResult(`right_click failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.drag_and_drop',
    {
      description: 'Drag one element and drop it onto another.',
      inputSchema: {
        sessionId: z.string(),
        sourceTarget: z.string().describe(`Element to drag. ${targetDesc}`),
        destTarget: z.string().describe(`Element to drop onto. ${targetDesc}`),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, sourceTarget, destTarget, tabId }) => {
      try {
        return jsonResult(await runtime.dragAndDrop(sessionId, sourceTarget, destTarget, tabId));
      } catch (e) {
        return errorResult(`drag_and_drop failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.touch_tap',
    {
      description: 'Simulate a touchscreen tap on an element.',
      inputSchema: {
        sessionId: z.string(),
        target: z.string().describe(targetDesc),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, target, tabId }) => {
      try {
        return jsonResult(await runtime.touchTap(sessionId, target, tabId));
      } catch (e) {
        return errorResult(`touch_tap failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.download_file',
    {
      description:
        'Click an element that triggers a file download and wait for the download to complete on disk.',
      inputSchema: {
        sessionId: z.string(),
        target: z.string().describe(`The download-triggering element. ${targetDesc}`),
        downloadDir: z.string().optional().describe('Destination directory. Defaults to the OS temp directory.'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, target, downloadDir, tabId }) => {
      try {
        return jsonResult(await runtime.downloadFile(sessionId, target, downloadDir, tabId));
      } catch (e) {
        return errorResult(`download_file failed: ${(e as Error).message}`);
      }
    },
  );

  // ── Capture ─────────────────────────────────────────────────────────────
  server.registerTool(
    'browser.screenshot',
    {
      description: 'Capture a PNG screenshot. Full-page by default. Returns the image inline (base64).',
      inputSchema: {
        sessionId: z.string(),
        tabId: z.string().optional(),
        fullPage: z.boolean().optional().describe('Defaults to true. Set false to capture only the visible viewport.'),
      },
    },
    async ({ sessionId, tabId, fullPage }) => {
      try {
        const { base64 } = await runtime.screenshot(sessionId, tabId, fullPage);
        return { content: [{ type: 'image' as const, data: base64, mimeType: 'image/png' }] };
      } catch (e) {
        return errorResult(`screenshot failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.eval',
    {
      description:
        'Evaluate arbitrary JavaScript in the page context and return the serialized result. ' +
        'Use for extraction the dedicated tools cannot express. Runs in the top-level page by ' +
        'default; pass frameSelector (a CSS selector or snapshot [#id] for an <iframe> element ' +
        'on the top-level page) to evaluate inside that frame instead — including a genuinely ' +
        'cross-origin one, which the top-level page\'s own JS could never read into itself ' +
        '(same-origin policy). click/type already reach into cross-origin iframes on their ' +
        'own; eval needs frameSelector to do the same.',
      inputSchema: {
        sessionId: z.string(),
        code: z.string().describe('JavaScript expression or function body to evaluate.'),
        tabId: z.string().optional(),
        frameSelector: z
          .string()
          .optional()
          .describe('CSS selector or snapshot [#id] for an <iframe> element on the top-level page — evaluate inside that frame instead of the top-level page.'),
      },
    },
    async ({ sessionId, code, tabId, frameSelector }) => {
      try {
        return jsonResult({ result: await runtime.eval(sessionId, code, tabId, frameSelector) });
      } catch (e) {
        return errorResult(`eval failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.export_pdf',
    {
      description: 'Export the current page as a PDF. Returns the PDF inline (base64).',
      inputSchema: {
        sessionId: z.string(),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, tabId }) => {
      try {
        const { base64 } = await runtime.exportPdf(sessionId, tabId);
        return { content: [{ type: 'text' as const, text: base64 }] };
      } catch (e) {
        return errorResult(`export_pdf failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.extract_data',
    {
      description:
        'Extract structured data from the page. For each named field give a CSS selector (or snapshot [#id]); ' +
        'returns one string per matching element in document order, ' +
        'e.g. {"titles": {"selector": ".product h2"}, "links": {"selector": ".product a", "attribute": "href"}}. ' +
        'With no attribute: form controls (input/select/textarea) return their LIVE current value, including ' +
        'typed text not yet submitted; other elements return rendered text (innerText, trimmed), leaving out ' +
        'CSS-hidden text and <script>/<style> content. "value"/"checked"/"selected" (case-insensitive) read ' +
        'live DOM state instead of markup; "checked"/"selected" return "true"/"false". "attr:<name>" reads the ' +
        'raw HTML attribute (e.g. "attr:value" = the original markup value). Any other name, e.g. "href", ' +
        'returns the raw attribute, not resolved to an absolute URL. Hidden matches are still returned unless ' +
        'visibleOnly is true (whole call or per field). For a checkbox/radio\'s state use "checked"; with no ' +
        'attribute a checkbox returns its value (usually "on"). For <select multiple>, "value" is only the ' +
        'first selected value — use selector "select option:checked" with attribute "value" for all selected. ' +
        'Selectors don\'t pierce shadow DOM. Runs against the top-level page by default; pass frameSelector ' +
        '(a CSS selector or snapshot [#id] for an <iframe> element on the top-level page) to extract from ' +
        'inside that frame instead — including a genuinely cross-origin one.',
      inputSchema: {
        sessionId: z.string(),
        fields: z
          .record(
            z.string(),
            z.object({
              selector: z.string().describe('CSS selector or snapshot [#id]. Does not pierce shadow DOM.'),
              attribute: z
                .string()
                .optional()
                .describe(
                  'Omit for the current value/visible text. "value" | "checked" | "selected" read LIVE state ' +
                    '("checked"/"selected" → "true"/"false"). "attr:<name>" reads the raw HTML attribute ' +
                    '(e.g. "attr:value" = original markup value). Any other name (e.g. "href") returns the raw attribute.',
                ),
              visibleOnly: z.boolean().optional().describe('Per-field override of the top-level visibleOnly.'),
            }),
          )
          .refine((obj) => Object.keys(obj).length > 0, {
            message: 'fields must have at least one entry — an empty object is a no-op extraction',
          }),
        tabId: z.string().optional(),
        frameSelector: z
          .string()
          .optional()
          .describe('CSS selector or snapshot [#id] for an <iframe> element on the top-level page — extract from inside that frame instead of the top-level page.'),
        visibleOnly: z
          .boolean()
          .optional()
          .describe(
            'Drop matched elements that are not visible (visibility:hidden/collapse or a zero-size box; opacity ' +
              'is ignored). Default false: hidden matches are still returned.',
          ),
      },
    },
    async ({ sessionId, fields, tabId, frameSelector, visibleOnly }) => {
      try {
        return jsonResult(await runtime.extractData(sessionId, fields, tabId, frameSelector, { visibleOnly }));
      } catch (e) {
        return errorResult(`extract_data failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.get_cookies',
    {
      description: "Read the browser's cookies for the active tab's URL.",
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        return jsonResult({ cookies: await runtime.getCookies(sessionId, tabId) });
      } catch (e) {
        return errorResult(`get_cookies failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.set_cookie',
    {
      description: "Set (or overwrite) a cookie. Defaults to the active tab's current URL if none given.",
      inputSchema: {
        sessionId: z.string(),
        name: z.string(),
        value: z.string(),
        url: z.string().url().optional(),
        domain: z.string().optional(),
        path: z.string().optional(),
        httpOnly: z.boolean().optional(),
        secure: z.boolean().optional(),
        sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
        expires: z.number().optional().describe('Unix timestamp in seconds.'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, tabId, ...cookie }) => {
      try {
        await runtime.setCookie(sessionId, cookie, tabId);
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`set_cookie failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.delete_cookie',
    {
      description: "Delete a cookie by name (optionally scoped to a URL; defaults to the active tab's).",
      inputSchema: {
        sessionId: z.string(),
        name: z.string(),
        url: z.string().url().optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, name, url, tabId }) => {
      try {
        await runtime.deleteCookie(sessionId, name, url, tabId);
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`delete_cookie failed: ${(e as Error).message}`);
      }
    },
  );

  // ── Storage: localStorage / sessionStorage ─────────────────────────────────
  server.registerTool(
    'browser.get_local_storage',
    {
      description: 'Dump all localStorage key/value pairs for the current page.',
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        return jsonResult({ items: await runtime.getLocalStorage(sessionId, tabId) });
      } catch (e) {
        return errorResult(`get_local_storage failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.set_local_storage_item',
    {
      description: 'Set a single localStorage item on the current page.',
      inputSchema: { sessionId: z.string(), key: z.string(), value: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, key, value, tabId }) => {
      try {
        await runtime.setLocalStorageItem(sessionId, key, value, tabId);
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`set_local_storage_item failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.clear_local_storage',
    {
      description: "Clear all localStorage for the current page's origin.",
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        await runtime.clearLocalStorage(sessionId, tabId);
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`clear_local_storage failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.get_session_storage',
    {
      description: 'Dump all sessionStorage key/value pairs for the current page.',
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        return jsonResult({ items: await runtime.getSessionStorage(sessionId, tabId) });
      } catch (e) {
        return errorResult(`get_session_storage failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.set_session_storage_item',
    {
      description: 'Set a single sessionStorage item on the current page.',
      inputSchema: { sessionId: z.string(), key: z.string(), value: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, key, value, tabId }) => {
      try {
        await runtime.setSessionStorageItem(sessionId, key, value, tabId);
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`set_session_storage_item failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.clear_session_storage',
    {
      description: "Clear all sessionStorage for the current page's origin.",
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        await runtime.clearSessionStorage(sessionId, tabId);
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`clear_session_storage failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.get_storage_state',
    {
      description:
        'Export the tab\'s full auth/session state (cookies + localStorage + sessionStorage) as one portable ' +
        'blob — unlike the per-item cookie/storage tools, this is meant to be saved and later restored via ' +
        'browser.set_storage_state, even in a completely different session, to skip redoing a login flow.',
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        return jsonResult(await runtime.getStorageState(sessionId, tabId));
      } catch (e) {
        return errorResult(`get_storage_state failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.set_storage_state',
    {
      description:
        'Restore a blob previously captured by browser.get_storage_state onto the current tab. Call this ' +
        'right after navigating to the target origin (storage is origin-scoped) and before anything else ' +
        'that depends on being logged in.',
      inputSchema: {
        sessionId: z.string(),
        state: z
          .object({
            origin: z.string(),
            cookies: z.array(z.unknown()),
            localStorage: z.record(z.string(), z.string()),
            sessionStorage: z.record(z.string(), z.string()),
          })
          .describe('A blob previously returned by browser.get_storage_state.'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, state, tabId }) => {
      try {
        await runtime.setStorageState(sessionId, state, tabId);
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`set_storage_state failed: ${(e as Error).message}`);
      }
    },
  );

  // ── Geolocation & permissions ───────────────────────────────────────────────
  server.registerTool(
    'browser.set_geolocation',
    {
      description:
        "Override the page's geolocation. Auto-grants the 'geolocation' permission for the current origin first.",
      inputSchema: {
        sessionId: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        accuracy: z.number().optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, latitude, longitude, accuracy, tabId }) => {
      try {
        await runtime.setGeolocation(sessionId, { latitude, longitude, accuracy }, tabId);
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`set_geolocation failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.grant_permissions',
    {
      description:
        "Grant a set of permissions (e.g. 'geolocation', 'notifications', 'camera', 'microphone') for an origin. " +
        'All permissions not listed are automatically denied.',
      inputSchema: {
        sessionId: z.string(),
        origin: z.string().describe('e.g. https://example.com'),
        permissions: z.array(
          z.enum([
            'accelerometer',
            'ambient-light-sensor',
            'background-sync',
            'camera',
            'clipboard-read',
            'clipboard-sanitized-write',
            'clipboard-write',
            'geolocation',
            'gyroscope',
            'idle-detection',
            'keyboard-lock',
            'magnetometer',
            'microphone',
            'midi-sysex',
            'midi',
            'notifications',
            'payment-handler',
            'persistent-storage',
            'pointer-lock',
          ]),
        ),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, origin, permissions, tabId }) => {
      try {
        await runtime.grantPermissions(sessionId, origin, permissions, tabId);
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`grant_permissions failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.set_viewport',
    {
      description:
        'Resize the viewport at runtime (and optionally emulate a mobile device / pixel ratio). ' +
        'The viewport option at browser.launch only sets the initial size — use this to change it mid-session. ' +
        'hasTouch defaults to isMobile\'s value (every real mobile device has touch) — set it explicitly to ' +
        'decouple them, e.g. a touch-enabled desktop or a non-touch mobile emulation.',
      inputSchema: {
        sessionId: z.string(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        isMobile: z.boolean().optional(),
        deviceScaleFactor: z.number().positive().optional(),
        hasTouch: z.boolean().optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, width, height, isMobile, deviceScaleFactor, hasTouch, tabId }) => {
      try {
        await runtime.setViewport(sessionId, { width, height, isMobile, deviceScaleFactor, hasTouch }, tabId);
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`set_viewport failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.get_viewport',
    {
      description:
        'Read the viewport/device metrics actually in effect right now — width, height, device scale factor, ' +
        'mobile/touch emulation. Returns null if none has ever been set (Chrome\'s own default applies). Useful ' +
        'for diagnosing a visual mismatch: confirms whether it is a wrong-viewport issue before assuming it is a ' +
        'real layout bug. Was previously unreachable via MCP at all — found missing via an external field report ' +
        '(PROB-042).',
      inputSchema: {
        sessionId: z.string(),
        tabId: z.string().optional(),
      },
    },
    ({ sessionId, tabId }) => {
      try {
        return jsonResult(runtime.getViewport(sessionId, tabId));
      } catch (e) {
        return errorResult(`get_viewport failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.emulate',
    {
      description:
        'Emulate timezone, locale, color scheme, and/or reduced-motion preference for the page. ' +
        'Each field is optional and independent.',
      inputSchema: {
        sessionId: z.string(),
        timezone: z.string().optional().describe('IANA timezone id, e.g. "America/New_York".'),
        locale: z.string().optional().describe('e.g. "en-US", "fr-FR".'),
        colorScheme: z.enum(['light', 'dark', 'no-preference']).optional(),
        reducedMotion: z.enum(['reduce', 'no-preference']).optional(),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, timezone, locale, colorScheme, reducedMotion, tabId }) => {
      try {
        await runtime.emulateSettings(sessionId, { timezone, locale, colorScheme, reducedMotion }, tabId);
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`emulate failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.set_network_conditions',
    {
      description:
        'Emulate offline mode and/or network throttling (throughput + latency). offline is independent of ' +
        'throttling — set either or both in one call. Use `preset` for a standard DevTools profile, or ' +
        'download/upload/latency together for a custom one. Set clearThrottling:true to remove throttling ' +
        '(offline is unaffected by this — set offline:false separately to go back online).',
      inputSchema: {
        sessionId: z.string(),
        offline: z.boolean().optional(),
        preset: z.enum(['Slow 3G', 'Fast 3G', 'Slow 4G', 'Fast 4G']).optional(),
        download: z.number().positive().optional().describe('Bytes/sec. Use with upload + latency for a custom profile.'),
        upload: z.number().positive().optional().describe('Bytes/sec.'),
        latency: z.number().min(0).optional().describe('Milliseconds of extra round-trip latency.'),
        clearThrottling: z.boolean().optional().describe('Remove throttling, back to unrestricted throughput.'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, offline, preset, download, upload, latency, clearThrottling, tabId }) => {
      try {
        const conditions = preset
          ? ({ preset } as const)
          : download !== undefined && upload !== undefined && latency !== undefined
            ? { download, upload, latency }
            : clearThrottling
              ? null
              : undefined;
        await runtime.emulateNetwork(sessionId, { offline, conditions }, tabId);
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`set_network_conditions failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.get_clipboard',
    {
      description:
        "Read the current clipboard text. Requires the 'clipboard-read' permission — grant it " +
        'first via browser.grant_permissions if this fails with a permission error.',
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        return jsonResult({ text: await runtime.getClipboard(sessionId, tabId) });
      } catch (e) {
        return errorResult(`get_clipboard failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.set_clipboard',
    {
      description: 'Write text to the clipboard.',
      inputSchema: { sessionId: z.string(), text: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, text, tabId }) => {
      try {
        await runtime.setClipboard(sessionId, text, tabId);
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`set_clipboard failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.upload_file_via_trigger',
    {
      description:
        'Upload a file by clicking an element that opens a native file picker via JavaScript ' +
        '(e.g. a styled "Browse" button that is not itself a plain <input type=file>). Use ' +
        'browser.upload_file instead when the target IS a plain file input.',
      inputSchema: {
        sessionId: z.string(),
        target: z.string().describe(`The element that triggers the file picker when clicked. ${targetDesc}`),
        filePath: z.string().describe('Absolute path to the local file to upload.'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, target, filePath, tabId }) => {
      try {
        await runtime.uploadFileViaTrigger(sessionId, target, filePath, tabId);
        return jsonResult({ success: true, filePath });
      } catch (e) {
        return errorResult(`upload_file_via_trigger failed: ${(e as Error).message}`);
      }
    },
  );

  // ── Dialogs, console/network observability, request interception ──────────
  server.registerTool(
    'browser.get_pending_dialog',
    {
      description:
        'Check whether the tab currently has a native dialog (alert/confirm/prompt) blocking it. ' +
        'Returns null if there is none. A pending dialog blocks most other page interactions until ' +
        'handled via browser.handle_dialog — it is auto-dismissed after 30s if never handled.',
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        return jsonResult({ dialog: runtime.getPendingDialog(sessionId, tabId) ?? null });
      } catch (e) {
        return errorResult(`get_pending_dialog failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.handle_dialog',
    {
      description: 'Accept or dismiss the tab\'s currently-pending native dialog.',
      inputSchema: {
        sessionId: z.string(),
        action: z.enum(['accept', 'dismiss']),
        promptText: z.string().optional().describe('Text to enter if the dialog is a prompt().'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, action, promptText, tabId }) => {
      try {
        await runtime.handleDialog(sessionId, action, promptText, tabId);
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`handle_dialog failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.get_console_logs',
    {
      description: "Recent console messages logged by the tab's page (bounded to the last 200).",
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        return jsonResult({ logs: runtime.getConsoleLogs(sessionId, tabId) });
      } catch (e) {
        return errorResult(`get_console_logs failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.get_page_errors',
    {
      description: 'Recent uncaught JavaScript errors thrown by the page (bounded to the last 50).',
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        return jsonResult({ errors: runtime.getPageErrors(sessionId, tabId) });
      } catch (e) {
        return errorResult(`get_page_errors failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.get_network_log',
    {
      description: "Recent network request/response activity for the tab (bounded to the last 200 entries).",
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        return jsonResult({ entries: runtime.getNetworkLog(sessionId, tabId) });
      } catch (e) {
        return errorResult(`get_network_log failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.get_action_history',
    {
      description:
        'Recent actions run against this tab (bounded to the last 200 entries) — action type, target, ' +
        'success/error, duration, and timestamp. A lightweight session-replay record for debugging.',
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        return jsonResult({ entries: runtime.getActionHistory(sessionId, tabId) });
      } catch (e) {
        return errorResult(`get_action_history failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.route',
    {
      description:
        'Block or mock network requests whose URL contains a pattern (substring match). Enables ' +
        'request interception for the tab on first use — subsequent unmatched requests still pass ' +
        'through normally. Use browser.clear_routes to remove all rules.',
      inputSchema: {
        sessionId: z.string(),
        pattern: z.string().describe('Substring to match against the request URL.'),
        action: z.enum(['block', 'mock']),
        mockStatus: z.number().int().optional().describe('HTTP status for a mock response. Defaults to 200.'),
        mockContentType: z.string().optional().describe('Content-Type for a mock response. Defaults to application/json.'),
        mockBody: z.string().optional().describe('Response body for a mock response.'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, pattern, action, mockStatus, mockContentType, mockBody, tabId }) => {
      try {
        await runtime.addRoute(
          sessionId,
          pattern,
          action,
          { status: mockStatus, contentType: mockContentType, body: mockBody },
          tabId,
        );
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`route failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.clear_routes',
    {
      description: 'Remove all network route rules for the tab and disable interception.',
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        await runtime.clearRoutes(sessionId, tabId);
        return jsonResult({ success: true });
      } catch (e) {
        return errorResult(`clear_routes failed: ${(e as Error).message}`);
      }
    },
  );

  // ── Tabs ─────────────────────────────────────────────────────────────────
  server.registerTool(
    'browser.list_tabs',
    {
      description: 'List all tabs in a session.',
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => {
      try {
        return jsonResult({ tabs: await runtime.listTabs(sessionId) });
      } catch (e) {
        return errorResult(`list_tabs failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.new_tab',
    {
      description: 'Open a new tab, optionally navigating to a URL.',
      inputSchema: {
        sessionId: z.string(),
        url: z.string().url().optional(),
      },
    },
    async ({ sessionId, url }) => {
      try {
        return jsonResult(await runtime.createTab(sessionId, url));
      } catch (e) {
        return errorResult(`new_tab failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.focus_tab',
    {
      description: 'Make a tab the active tab for a session.',
      inputSchema: { sessionId: z.string(), tabId: z.string() },
    },
    async ({ sessionId, tabId }) => {
      try {
        await runtime.focusTab(sessionId, tabId);
        return jsonResult({ success: true, tabId });
      } catch (e) {
        return errorResult(`focus_tab failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.close_tab',
    {
      description: 'Close a tab.',
      inputSchema: {
        sessionId: z.string(),
        tabId: z.string(),
      },
    },
    async ({ sessionId, tabId }) => {
      try {
        await runtime.closeTab(sessionId, tabId);
        return jsonResult({ success: true, tabId });
      } catch (e) {
        return errorResult(`close_tab failed: ${(e as Error).message}`);
      }
    },
  );

  // ── Multi-agent tab locking (advisory) ──────────────────────────────────
  server.registerTool(
    'browser.lock_tab',
    {
      description:
        'Acquire an advisory lock on a tab so other callers sharing this session know you\'re driving it — ' +
        'useful when multiple agents/sessions might act on the same tab. Succeeds if unlocked, expired, or ' +
        'already held by the same owner (re-locking extends the TTL); fails if a different owner holds it. ' +
        'ADVISORY ONLY: other browser.* calls do not currently refuse to run against a locked tab — this is ' +
        'a coordination signal for well-behaved callers to check via browser.get_tab_lock, not an enforced mutex.',
      inputSchema: {
        sessionId: z.string(),
        owner: z.string().describe('An identifier for who is acquiring the lock (e.g. an agent/run id).'),
        ttlMs: z.number().int().positive().optional().describe('Lock duration in ms. Defaults to 30000.'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, owner, ttlMs, tabId }) => {
      try {
        const acquired = runtime.lockTab(sessionId, owner, ttlMs, tabId);
        return jsonResult({ acquired });
      } catch (e) {
        return errorResult(`lock_tab failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.unlock_tab',
    {
      description: "Release a tab's advisory lock. No-ops (returns released:false) if you don't currently hold it.",
      inputSchema: {
        sessionId: z.string(),
        owner: z.string().describe('Must match the owner that acquired the lock.'),
        tabId: z.string().optional(),
      },
    },
    async ({ sessionId, owner, tabId }) => {
      try {
        const released = runtime.unlockTab(sessionId, owner, tabId);
        return jsonResult({ released });
      } catch (e) {
        return errorResult(`unlock_tab failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'browser.get_tab_lock',
    {
      description: "Check a tab's current advisory lock (owner + expiry), or null if unlocked/expired.",
      inputSchema: { sessionId: z.string(), tabId: z.string().optional() },
    },
    async ({ sessionId, tabId }) => {
      try {
        return jsonResult({ lock: runtime.getTabLock(sessionId, tabId) ?? null });
      } catch (e) {
        return errorResult(`get_tab_lock failed: ${(e as Error).message}`);
      }
    },
  );

  // ── Autonomous agent (optional) ──────────────────────────────────────────
  if (options.agent) {
    const { agentCore } = options.agent;
    server.registerTool(
      'agent.runGoal',
      {
        description:
          'Hand control to Sutradhar\'s OWN autonomous agent loop. It will reason over the page, navigate, click, ' +
          'type, and extract data to achieve the natural-language goal, then return a final answer/summary. ' +
          'Prefer this for multi-step objectives; use the browser.* tools when you want to drive the page yourself. ' +
          'Requires an LLM provider (Ollama or OpenRouter) to be configured.',
        inputSchema: {
          goal: z
            .string()
            .min(1)
            .describe(
              'Natural-language objective. Include a starting URL if you have one (e.g. "On https://example.com, find the contact email").',
            ),
          sessionId: z.string().optional().describe('Run against an existing browser session.'),
        },
      },
      async ({ goal, sessionId }) => {
        // The agent loop may publish `session:blocked` (CAPTCHA, auth wall, or a stuck loop
        // it gave up on) mid-run — collect anything fired during THIS call so it can be
        // surfaced in the response instead of silently vanishing on a bus nothing else reads.
        // `session:blocked` is a shared-bus topic with no per-call isolation — filter by THIS
        // call's own goalId (minted up front and passed through to the loop) so a concurrent
        // agent.runGoal call against a different session/goal can never leak its block event
        // into this response, or vice versa.
        const goalId = createGoalId(`goal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
        const blockedEvents: Array<{ blockReason: string; message: string }> = [];
        const subscription = runtime.getEventBus().subscribe('session:blocked', (event) => {
          if (event.payload.goalId === goalId) {
            blockedEvents.push({ blockReason: event.payload.blockReason, message: event.payload.message });
          }
        });

        try {
          const result = await agentCore.executeGoal(goal, sessionId, { goalId });
          // Surface the final answer + a trace summary so the model can report back.
          const trace = (result.steps ?? [])
            .map(
              (s) =>
                `[${s.stepNumber}] ${s.actionName ?? '?'} → ${s.success ? 'ok' : 'fail'}` +
                (s.errorMessage ? ` (${s.errorMessage})` : ''),
            )
            .join('\n');
          const blockedBlock = blockedEvents.length
            ? `\n⚠ BLOCKED (${blockedEvents[blockedEvents.length - 1]!.blockReason}): ` +
              `${blockedEvents[blockedEvents.length - 1]!.message}\n`
            : '';
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `Status: ${result.status}\n` +
                  `Duration: ${result.durationMs ?? 0}ms\n` +
                  `Answer: ${result.answer ?? '(none)'}\n` +
                  `Summary: ${result.summary ?? '(none)'}\n` +
                  blockedBlock +
                  `\nStep trace:\n${trace || '(no steps recorded)'}`,
              },
            ],
          };
        } catch (e) {
          return errorResult(`agent.runGoal failed: ${(e as Error).message}`);
        } finally {
          subscription.unsubscribe();
        }
      },
    );
  }
}
