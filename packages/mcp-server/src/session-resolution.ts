/**
 * @file packages/mcp-server/src/session-resolution.ts
 * @description FR2-10: makes `sessionId` optional on every MCP tool that requires it today,
 * resolving an omitted id to the caller's one live session — or failing with a message that
 * lists the live session ids — instead of forcing every caller to track and pass one even in
 * the common single-session case.
 *
 * The mechanism lives here, applied once at registration time in `tools.ts`
 * (`withSessionResolution`), rather than being duplicated per tool. See
 * `.ai/loop/field-report-2/evidence/FR2-10/spec.md` for the full design ("D1" onward) — in
 * particular why this is a registration-time wrapper and not a change to runtime method
 * signatures (D1), what "live" means here (D2), which sessions are candidates (D3), the
 * in-flight-lifecycle guard (D4), and the exact error/note wording (D5/D6).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LiveSessionInfo, LiveSessionsView, SutradharRuntime } from '@sutradhar/capability-runtime';

/** Repeated on every tool with an optional `sessionId` (66+ at FR2-10 time) — kept short since
 *  every MCP client loads `tools/list` (and therefore every description) into its context. The
 *  full rule lives once, in `browser.launch`'s own description. */
export const SESSION_ID_DESCRIPTION =
  'From browser.launch/attach. Optional only when exactly one session is live.';

const MAX_LISTED = 20;

/**
 * Render a session's active-tab URL for the live-session listing: origin+pathname for http(s)
 * (query/fragment dropped — they carry tokens, and this text goes into the model's context),
 * `data:…` for data URLs, everything else as-is; control characters (in particular newlines)
 * are collapsed to a space so a listing line can never wrap or truncate mid-URL; then
 * middle-truncated to 80 characters (first 38 + `…` + last 41) when still too long.
 */
export function displaySessionUrl(url: string | undefined): string {
  if (url === undefined) return '(no page)';
  let display = url;
  if (url.startsWith('data:')) {
    display = 'data:…';
  } else if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const parsed = new URL(url);
      display = `${parsed.origin}${parsed.pathname}`;
    } catch {
      // Not actually a valid URL despite the http(s) prefix — fall through with the raw string.
    }
  }
  // eslint-disable-next-line no-control-regex
  display = display.replace(/[\u0000-\u001f]/g, ' ');
  if (display.length > 80) {
    display = `${display.slice(0, 38)}…${display.slice(display.length - 41)}`;
  }
  return display;
}

/** One line per session, two-space indented, e.g.
 *  `  - sess_1 (launched 2026-09-25T10:00:00.000Z; 1 tab; active: http://x.test/checkout)`.
 *  Capped at {@link MAX_LISTED} lines, then a `  … and N more` summary line — this text goes
 *  straight into a model's context, so an unbounded list of live sessions can't blow it up. */
export function formatSessionLines(sessions: readonly LiveSessionInfo[]): string {
  const shown = sessions.slice(0, MAX_LISTED);
  const lines = shown.map((s) => {
    const tabWord = s.tabCount === 1 ? 'tab' : 'tabs';
    const parts = [`${s.origin} ${s.createdAt}`, `${s.tabCount} ${tabWord}`, `active: ${displaySessionUrl(s.activeUrl)}`];
    let line = `  - ${s.sessionId} (${parts.join('; ')}`;
    if (!s.hasRealBrowser) line += '; no real browser page';
    return `${line})`;
  });
  if (sessions.length > MAX_LISTED) {
    lines.push(`  … and ${sessions.length - MAX_LISTED} more`);
  }
  return lines.join('\n');
}

const MSG_NONE =
  'No sessionId given, and there is no live browser session to use. Call browser.launch (or ' +
  'browser.attach) first; its result contains the sessionId. sessionId may be omitted only ' +
  'while exactly one session is live.';

function msgMany(n: number, lines: string): string {
  return (
    `No sessionId given, and ${n} browser sessions are live, so which one to use is ambiguous ` +
    `(Sutradhar never picks one for you). Pass sessionId explicitly, e.g. {"sessionId": "<id>", ...} ` +
    `using one of these ids:\n${lines}`
  );
}

function msgInFlight(k: number, lines: string): string {
  return (
    `No sessionId given, and ${k} browser.launch/attach/shutdown call(s) are still in progress, ` +
    `so the set of live sessions is changing. Pass sessionId explicitly, or retry after that call ` +
    `returns. Live sessions right now:\n${lines}`
  );
}

export type SessionResolution =
  | { ok: true; sessionId: string; implicit: boolean }
  | { ok: false; message: string };

/**
 * Pure resolver: given a possibly-omitted `sessionId` and a snapshot of the runtime's live
 * caller-owned sessions, decide what to do. Never guesses: an omitted id resolves only when
 * exactly one session is live and no launch/attach/shutdown is currently in flight (D4);
 * otherwise it returns an exact, session-listing error message (D5). An explicitly given id
 * (including `""`) is passed through unchanged (D8) — this function never overrides a value the
 * caller actually sent.
 */
export function resolveSessionId(requested: string | undefined, view: LiveSessionsView): SessionResolution {
  if (requested !== undefined) return { ok: true, sessionId: requested, implicit: false };
  const lines = view.sessions.length ? formatSessionLines(view.sessions) : '  (none)';
  if (view.lifecycleOpsInFlight > 0) return { ok: false, message: msgInFlight(view.lifecycleOpsInFlight, lines) };
  if (view.sessions.length === 1) return { ok: true, sessionId: view.sessions[0]!.sessionId, implicit: true };
  if (view.sessions.length === 0) return { ok: false, message: MSG_NONE };
  return { ok: false, message: msgMany(view.sessions.length, lines) };
}

/** Only the registration method the wrapper needs — kept narrow so a test double doesn't have to
 *  implement the rest of `McpServer`. */
type Registrar = Pick<McpServer, 'registerTool'>;

/**
 * Wrap an `McpServer` (or a test double with the same `registerTool` shape) so that any tool
 * registered with a *required* `sessionId: z.string()` in its `inputSchema` gets that key
 * rewritten to optional, with a handler that resolves an omitted id automatically (D1's
 * rewrite rule). Every other tool — one with no `sessionId` key at all (`browser.health`,
 * `browser.shutdown_all`), or one whose `sessionId` is already optional (`browser.launch`,
 * `browser.attach`, `agent.runGoal`) — passes through by identity: same config object, same
 * handler reference (D7).
 *
 * `runtime.listSessions()` is called only inside a wrapped handler when `sessionId` was
 * actually omitted, never at registration time (R3) — a test double for `runtime` that lacks
 * `listSessions` is safe to register tools against as long as every call passes an explicit id.
 */
export function withSessionResolution(
  server: Registrar,
  runtime: Pick<SutradharRuntime, 'listSessions'>,
): Registrar {
  const registerTool = (name: string, config: any, cb: any) => {
    const shape = config?.inputSchema;
    const sid = shape && typeof shape === 'object' && !(shape instanceof z.ZodType) ? shape.sessionId : undefined;
    if (!sid || sid.isOptional()) return server.registerTool(name, config, cb);
    if (!(sid instanceof z.ZodString)) {
      throw new Error(`${name}: required sessionId must be z.string() (FR2-10)`);
    }
    const short = name.replace(/^browser\./, '');
    const wrapped = (args: any, extra: any) => {
      if (args?.sessionId !== undefined) return cb(args, extra);
      const r = resolveSessionId(undefined, runtime.listSessions());
      if (!r.ok) {
        return { isError: true, content: [{ type: 'text' as const, text: `${short} failed: ${r.message}` }] };
      }
      return Promise.resolve(cb({ ...args, sessionId: r.sessionId }, extra)).then((res: any) => ({
        ...res,
        content: [
          ...(res?.content ?? []),
          {
            type: 'text' as const,
            text: `sessionId omitted: used "${r.sessionId}", the only live browser session.`,
          },
        ],
      }));
    };
    return server.registerTool(
      name,
      { ...config, inputSchema: { ...shape, sessionId: z.string().optional().describe(SESSION_ID_DESCRIPTION) } },
      wrapped as any,
    );
  };
  return { registerTool: registerTool as McpServer['registerTool'] };
}
