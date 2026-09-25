/**
 * @file packages/mcp-server/tests/unit/session-resolution.spec.ts
 * @description Unit tests for FR2-10's session-resolution module: the pure resolver, the line
 * formatter/URL display helper, and the `withSessionResolution` registration-time wrapper.
 */

import { z } from 'zod';
import type { LiveSessionInfo, LiveSessionsView } from '@sutradhar/capability-runtime';
import {
  SESSION_ID_DESCRIPTION,
  displaySessionUrl,
  formatSessionLines,
  resolveSessionId,
  withSessionResolution,
} from '../../src/session-resolution.js';

function session(overrides: Partial<LiveSessionInfo> & { sessionId: string }): LiveSessionInfo {
  return {
    origin: 'launched',
    createdAt: '2026-09-25T10:00:00.000Z',
    tabCount: 1,
    activeUrl: undefined,
    hasRealBrowser: true,
    ...overrides,
  };
}

function view(sessions: LiveSessionInfo[], lifecycleOpsInFlight = 0): LiveSessionsView {
  return { sessions, lifecycleOpsInFlight };
}

const A = session({ sessionId: 'A' });
const B = session({ sessionId: 'B' });
const C = session({ sessionId: 'C' });

describe('resolveSessionId', () => {
  it('R1: 0 sessions -> exact MSG_NONE', () => {
    const r = resolveSessionId(undefined, view([]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toBe(
        'No sessionId given, and there is no live browser session to use. Call browser.launch (or ' +
          'browser.attach) first; its result contains the sessionId. sessionId may be omitted only ' +
          'while exactly one session is live.',
      );
    }
  });

  it('R2: 1 session -> resolves implicitly', () => {
    const r = resolveSessionId(undefined, view([A]));
    expect(r).toEqual({ ok: true, sessionId: 'A', implicit: true });
  });

  it('R3: more than 1 -> ambiguity error listing both, with the id placeholder, never a real id', () => {
    const r = resolveSessionId(undefined, view([A, B]));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.message.startsWith('No sessionId given, and 2 browser sessions are live')).toBe(true);
    expect(r.message).toContain('  - A (');
    expect(r.message).toContain('  - B (');
    expect(r.message).toContain('{"sessionId": "<id>", ...}');
    expect(r.message).not.toContain('{"sessionId": "A"');
    expect(r.message).not.toContain('{"sessionId": "B"');
  });

  it('R3b: three sessions mentions "3 browser sessions"', () => {
    const r = resolveSessionId(undefined, view([A, B, C]));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.message).toContain('3 browser sessions');
  });

  it('R4: in flight with 1 session never resolves to it', () => {
    const r = resolveSessionId(undefined, view([A], 1));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.message).toContain('1 browser.launch/attach/shutdown call(s) are still in progress');
    expect(r.message).toContain('  - A (');
  });

  it('R5: in flight with 0 sessions', () => {
    const r = resolveSessionId(undefined, view([], 2));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.message).toContain('2 browser.launch');
    expect(r.message).toContain('  (none)');
  });

  it('R6: an explicit id is passed through unchanged, never redirected', () => {
    for (const v of [view([]), view([A, B]), view([A], 3)]) {
      expect(resolveSessionId('X', v)).toEqual({ ok: true, sessionId: 'X', implicit: false });
    }
    expect(resolveSessionId('', view([A]))).toEqual({ ok: true, sessionId: '', implicit: false });
  });
});

describe('formatSessionLines / displaySessionUrl', () => {
  it('R7: exact line for a launched session, with the query/fragment stripped', () => {
    const s = session({
      sessionId: 'A',
      origin: 'launched',
      createdAt: '2026-09-25T10:00:00.000Z',
      tabCount: 1,
      activeUrl: 'https://shop.test/checkout?token=SECRET#x',
      hasRealBrowser: true,
    });
    const line = formatSessionLines([s]);
    expect(line).toBe('  - A (launched 2026-09-25T10:00:00.000Z; 1 tab; active: https://shop.test/checkout)');
    expect(line).not.toContain('SECRET');
  });

  it('R7b: attached, multi-tab, no real browser page', () => {
    const s = session({
      sessionId: 'B',
      origin: 'attached',
      tabCount: 3,
      hasRealBrowser: false,
      activeUrl: 'https://x.test/',
    });
    const line = formatSessionLines([s]);
    expect(line).toContain('attached');
    expect(line).toContain('3 tabs');
    expect(line.endsWith('; no real browser page)')).toBe(true);
  });

  it('R8: displaySessionUrl cases', () => {
    expect(displaySessionUrl(undefined)).toBe('(no page)');
    expect(displaySessionUrl('about:blank')).toBe('about:blank');
    expect(displaySessionUrl('data:text/html,<b>')).toBe('data:…');
    const longPath = `http://x.test/${'a'.repeat(200)}`;
    const truncated = displaySessionUrl(longPath);
    expect(truncated.length).toBe(80);
    expect(truncated.indexOf('…')).toBe(38);
    expect(displaySessionUrl('http://x.test/a\nb')).not.toContain('\n');
  });

  it('R9: caps the listing at 20 lines, then a "and N more" summary', () => {
    const many = Array.from({ length: 25 }, (_, i) => session({ sessionId: `s${i}` }));
    const text = formatSessionLines(many);
    const lines = text.split('\n');
    expect(lines.filter((l) => l.startsWith('  - ')).length).toBe(20);
    expect(lines.at(-1)).toBe('  … and 5 more');
  });

  it('R10: does not re-sort — keeps the caller-supplied order', () => {
    const text = formatSessionLines([B, A]);
    expect(text.indexOf('  - B (')).toBeLessThan(text.indexOf('  - A ('));
  });
});

describe('withSessionResolution', () => {
  function mockRegistrar() {
    const tools = new Map<string, { config: any; handler: any }>();
    const server = { registerTool: vi.fn((name: string, config: any, handler: any) => tools.set(name, { config, handler })) };
    return { server, tools };
  }

  function fakeRuntime(v: LiveSessionsView) {
    return { listSessions: vi.fn(() => v) };
  }

  it('W1: rewrites a required sessionId to optional, keeping key order and sibling schema identity', () => {
    const { server, tools } = mockRegistrar();
    const runtime = fakeRuntime(view([]));
    const targetSchema = z.string();
    const wrapped = withSessionResolution(server as any, runtime as any);
    wrapped.registerTool(
      't.req',
      { inputSchema: { sessionId: z.string(), target: targetSchema, tabId: z.string().optional() } },
      vi.fn(),
    );
    const recorded = tools.get('t.req')!.config.inputSchema;
    expect(recorded.sessionId.safeParse(undefined).success).toBe(true);
    expect(recorded.sessionId.safeParse('s').success).toBe(true);
    expect(recorded.sessionId.safeParse(1).success).toBe(false);
    expect(recorded.sessionId.description).toBe(SESSION_ID_DESCRIPTION);
    expect(Object.keys(recorded)).toEqual(['sessionId', 'target', 'tabId']);
    expect(recorded.target).toBe(targetSchema);
  });

  it('W2: an already-optional sessionId passes through by identity', () => {
    const { server, tools } = mockRegistrar();
    const runtime = fakeRuntime(view([]));
    const wrapped = withSessionResolution(server as any, runtime as any);
    const config = { inputSchema: { sessionId: z.string().optional().describe('Reuse…') } };
    const handler = vi.fn();
    wrapped.registerTool('t.launch', config, handler);
    const recorded = tools.get('t.launch')!;
    expect(recorded.config).toBe(config);
    expect(recorded.handler).toBe(handler);
  });

  it('W3: no sessionId key (or no inputSchema at all) passes through by identity', () => {
    const { server, tools } = mockRegistrar();
    const runtime = fakeRuntime(view([]));
    const wrapped = withSessionResolution(server as any, runtime as any);
    const config1 = { inputSchema: {} };
    const handler1 = vi.fn();
    wrapped.registerTool('t.health', config1, handler1);
    expect(tools.get('t.health')!.config).toBe(config1);
    expect(tools.get('t.health')!.handler).toBe(handler1);

    const config2 = {};
    const handler2 = vi.fn();
    wrapped.registerTool('t.shutdown_all', config2, handler2);
    expect(tools.get('t.shutdown_all')!.config).toBe(config2);
    expect(tools.get('t.shutdown_all')!.handler).toBe(handler2);
  });

  it('W4: explicit id -> same args reference in, same return reference out, sync stays sync', () => {
    const { server, tools } = mockRegistrar();
    const listSessions = vi.fn(() => view([A]));
    const runtime = { listSessions };
    const wrapped = withSessionResolution(server as any, runtime as any);
    const innerReturn = { content: [] };
    const inner = vi.fn(() => innerReturn);
    wrapped.registerTool('t.req', { inputSchema: { sessionId: z.string(), target: z.string() } }, inner);
    const args = { sessionId: 's1', target: '#x' };
    const ret = tools.get('t.req')!.handler(args, undefined);
    expect(inner).toHaveBeenCalledWith(args, undefined);
    expect(ret).toBe(innerReturn);
    expect(ret).not.toBeInstanceOf(Promise);
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('W5: omitted with 1 live session -> resolves, appends the note as the last content item', async () => {
    const { server, tools } = mockRegistrar();
    const listSessions = vi.fn(() => view([A]));
    const runtime = { listSessions };
    const wrapped = withSessionResolution(server as any, runtime as any);
    const inner = vi.fn(async () => ({ content: [{ type: 'text', text: '{"ok":1}' }] }));
    wrapped.registerTool('t.req', { inputSchema: { sessionId: z.string(), target: z.string() } }, inner);
    const result = await tools.get('t.req')!.handler({ target: '#x' }, undefined);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledWith({ target: '#x', sessionId: 'A' }, undefined);
    expect(result.content[0]).toEqual({ type: 'text', text: '{"ok":1}' });
    expect(result.content.length).toBe(2);
    expect(result.content[1].text).toBe('sessionId omitted: used "A", the only live browser session.');
    expect(listSessions).toHaveBeenCalledTimes(1);
  });

  it('W5b: an isError result keeps isError:true, note still appended last', async () => {
    const { server, tools } = mockRegistrar();
    const runtime = { listSessions: vi.fn(() => view([A])) };
    const wrapped = withSessionResolution(server as any, runtime as any);
    const inner = vi.fn(async () => ({ isError: true, content: [{ type: 'text', text: 'boom' }] }));
    wrapped.registerTool('t.req', { inputSchema: { sessionId: z.string() } }, inner);
    const result = await tools.get('t.req')!.handler({}, undefined);
    expect(result.isError).toBe(true);
    expect(result.content.at(-1).text).toBe('sessionId omitted: used "A", the only live browser session.');
  });

  it('W6: omitted with 0 sessions -> inner never called, exact error, no Hint: line', async () => {
    const { server, tools } = mockRegistrar();
    const runtime = { listSessions: vi.fn(() => view([])) };
    const wrapped = withSessionResolution(server as any, runtime as any);
    const inner = vi.fn();
    wrapped.registerTool('browser.req', { inputSchema: { sessionId: z.string() } }, inner);
    const result = await tools.get('browser.req')!.handler({}, undefined);
    expect(inner).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: 'text',
        text:
          'req failed: No sessionId given, and there is no live browser session to use. Call browser.launch (or ' +
          'browser.attach) first; its result contains the sessionId. sessionId may be omitted only while exactly ' +
          'one session is live.',
      },
    ]);
    expect(result.content[0].text).not.toContain('Hint:');
  });

  it('W7: omitted with 2+ sessions -> inner never called, both ids present', async () => {
    const { server, tools } = mockRegistrar();
    const runtime = { listSessions: vi.fn(() => view([A, B])) };
    const wrapped = withSessionResolution(server as any, runtime as any);
    const inner = vi.fn();
    wrapped.registerTool('browser.req', { inputSchema: { sessionId: z.string() } }, inner);
    const result = await tools.get('browser.req')!.handler({}, undefined);
    expect(inner).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('A');
    expect(result.content[0].text).toContain('B');
  });

  it('W7b: omitted while a lifecycle op is in flight -> inner never called, "in progress" in text', async () => {
    const { server, tools } = mockRegistrar();
    const runtime = { listSessions: vi.fn(() => view([A], 1)) };
    const wrapped = withSessionResolution(server as any, runtime as any);
    const inner = vi.fn();
    wrapped.registerTool('browser.req', { inputSchema: { sessionId: z.string() } }, inner);
    const result = await tools.get('browser.req')!.handler({}, undefined);
    expect(inner).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('in progress');
  });

  it('W8: a required non-string sessionId throws at registration', () => {
    const { server } = mockRegistrar();
    const runtime = { listSessions: vi.fn(() => view([])) };
    const wrapped = withSessionResolution(server as any, runtime as any);
    expect(() =>
      wrapped.registerTool('t.bad', { inputSchema: { sessionId: z.number() } }, vi.fn()),
    ).toThrow(/must be z\.string\(\)/);
  });

  it('W9: registering several tools never calls listSessions at registration time', () => {
    const { server } = mockRegistrar();
    const listSessions = vi.fn(() => view([]));
    const runtime = { listSessions };
    const wrapped = withSessionResolution(server as any, runtime as any);
    wrapped.registerTool('t.a', { inputSchema: { sessionId: z.string() } }, vi.fn());
    wrapped.registerTool('t.b', { inputSchema: { sessionId: z.string().optional() } }, vi.fn());
    wrapped.registerTool('t.c', { inputSchema: {} }, vi.fn());
    expect(listSessions).not.toHaveBeenCalled();
  });
});
