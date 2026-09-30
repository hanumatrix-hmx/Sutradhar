/**
 * @file packages/mcp-server/tests/unit/tools.spec.ts
 * @description Unit tests for registerTools — the full MCP tool surface, the isError
 * contract every tool handler must honor, and the agent.runGoal conditional registration.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { SutradharRuntime, buildAuditReport, AUDIT_REPORT_EXAMPLE } from '@sutradhar/capability-runtime';
import {
  WAIT_HIDDEN_CONFIRMED_VISIBLE_FRAGMENT,
  WAIT_HIDDEN_HARD_FAILURE_PREFIX,
  TAB_CLOSED_MID_WAIT_MESSAGE,
} from '@sutradhar/browser';
import { registerTools } from '../../src/tools.js';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// FR2-12: pngjs is a dependency of @sutradhar/capability-runtime, not of mcp-server itself —
// reached via createRequire against that package's own package.json (T18's technique), rather
// than adding a new devDependency here just to build a tiny test PNG. Resolved by relative path
// (not module resolution of a subpath) since capability-runtime's own `exports` map only exposes
// ".", not "./package.json".
const capabilityRuntimeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'capability-runtime');
const require_ = createRequire(path.join(capabilityRuntimeDir, 'package.json'));

/** A minimal in-memory McpServer double that just records what was registered. */
function createMockServer() {
  const tools = new Map<string, { config: any; handler: (args: any) => Promise<any> }>();
  const server = {
    registerTool: vi.fn((name: string, config: any, handler: any) => {
      tools.set(name, { config, handler });
    }),
  };
  return { server: server as unknown as McpServer, tools };
}

const EXPECTED_BROWSER_TOOLS = [
  'browser.health',
  'browser.launch',
  'browser.attach',
  'browser.shutdown',
  'browser.shutdown_all',
  'browser.navigate',
  'browser.go_back',
  'browser.go_forward',
  'browser.reload',
  'browser.snapshot',
  'browser.ax_snapshot',
  'browser.click',
  'browser.type',
  'browser.press_key',
  'browser.focus',
  'browser.scroll',
  'browser.hover',
  'browser.select_option',
  'browser.select_options',
  'browser.wait_for_selector',
  'browser.click_by_text',
  'browser.click_by_role',
  'browser.type_by_label',
  'browser.upload_file',
  'browser.right_click',
  'browser.drag_and_drop',
  'browser.touch_tap',
  'browser.download_file',
  'browser.screenshot',
  'browser.audit',
  'browser.eval',
  'browser.export_pdf',
  'browser.extract_data',
  'browser.get_cookies',
  'browser.set_cookie',
  'browser.delete_cookie',
  'browser.get_local_storage',
  'browser.set_local_storage_item',
  'browser.clear_local_storage',
  'browser.get_session_storage',
  'browser.set_session_storage_item',
  'browser.clear_session_storage',
  'browser.set_geolocation',
  'browser.grant_permissions',
  'browser.set_viewport',
  'browser.get_viewport',
  'browser.emulate',
  'browser.get_clipboard',
  'browser.set_clipboard',
  'browser.upload_file_via_trigger',
  'browser.get_pending_dialog',
  'browser.handle_dialog',
  'browser.get_console_logs',
  'browser.get_page_errors',
  'browser.get_network_log',
  'browser.get_action_history',
  'browser.route',
  'browser.clear_routes',
  'browser.list_tabs',
  'browser.new_tab',
  'browser.focus_tab',
  'browser.close_tab',
  'browser.set_network_conditions',
  'browser.fill_form',
  'browser.click_at_point',
  'browser.drag_at_points',
  'browser.get_storage_state',
  'browser.set_storage_state',
  'browser.lock_tab',
  'browser.unlock_tab',
  'browser.get_tab_lock',
  'browser.wait_for',
];

describe('@sutradhar/mcp-server registerTools', () => {
  it('registers every expected browser.* tool exactly once, and nothing extra', () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();

    registerTools(server, { runtime });

    for (const name of EXPECTED_BROWSER_TOOLS) {
      expect(tools.has(name)).toBe(true);
    }
    expect(tools.size).toBe(EXPECTED_BROWSER_TOOLS.length);
  });

  it('does not register agent.runGoal when no agent handle is provided', () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();

    registerTools(server, { runtime });

    expect(tools.has('agent.runGoal')).toBe(false);
  });

  it('registers agent.runGoal when an agent handle is provided', () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const agentCore = { executeGoal: vi.fn() } as any;

    registerTools(server, { runtime, agent: { agentCore } });

    expect(tools.has('agent.runGoal')).toBe(true);
  });

  it('every registered tool has a non-empty description and an inputSchema object', () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    registerTools(server, { runtime });

    for (const [name, { config }] of tools) {
      expect(config.description, `${name} description`).toBeTruthy();
      expect(config.inputSchema, `${name} inputSchema`).toBeTypeOf('object');
    }
  });

  it('a tool handler returns the isError contract when the underlying runtime call throws', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'click').mockRejectedValue(new Error('boom'));

    registerTools(server, { runtime });
    const result = await tools.get('browser.click')!.handler({ sessionId: 's1', target: '#x' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('click failed: boom');
  });

  it('a tool handler returns JSON success content when the underlying runtime call resolves', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'click').mockResolvedValue({
      success: true,
      actionType: 'click',
      executionTimeMs: 5,
    });

    registerTools(server, { runtime });
    const result = await tools.get('browser.click')!.handler({ sessionId: 's1', target: '#x' });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('browser.launch surfaces a clear error when no real browser is available', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'launch').mockResolvedValue({
      sessionId: 's1',
      activeTabId: 't1',
      hasRealBrowser: false,
    });

    registerTools(server, { runtime });
    const result = await tools.get('browser.launch')!.handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no real page is available');
  });

  it('browser.screenshot returns inline image content, not JSON text', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'screenshot').mockResolvedValue({ base64: 'ZmFrZQ==' });

    registerTools(server, { runtime });
    const result = await tools.get('browser.screenshot')!.handler({ sessionId: 's1' });

    expect(result.content[0].type).toBe('image');
    expect(result.content[0].data).toBe('ZmFrZQ==');
  });

  it('errorResult appends a remediation hint for well-known error patterns (thrown-exception path)', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'click').mockRejectedValue(
      new Error('No visible element found for selector: #missing'),
    );

    registerTools(server, { runtime });
    const result = await tools.get('browser.click')!.handler({ sessionId: 's1', target: '#missing' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Hint:');
    expect(result.content[0].text).toContain('browser.snapshot');
  });

  it('jsonResult appends a remediation hint on the common in-band {success:false, error} action-failure path', async () => {
    // The much more common case: SutradharRuntime's action wrappers resolve (don't throw) with
    // success:false on a routine action failure — this must get a hint too, not just the
    // rarer thrown-exception path errorResult covers.
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'click').mockResolvedValue({
      success: false,
      actionType: 'click',
      executionTimeMs: 5,
      error: 'No visible element found for selector: #missing',
    });

    registerTools(server, { runtime });
    const result = await tools.get('browser.click')!.handler({ sessionId: 's1', target: '#missing' });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('Hint:');
    expect(parsed.error).toContain('browser.snapshot');
  });

  it('GAP-111 (FR2-01 fix-5): a genuine confirmed-visible hidden-wait timeout still gets the "still visible" hint', async () => {
    // The genuine case the hint exists for: the engine explicitly confirmed some frame still
    // has a visible match, not merely "couldn't tell". Must not regress.
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'waitForSelector').mockResolvedValue({
      success: false,
      actionType: 'wait_for_selector',
      executionTimeMs: 5,
      error:
        'wait_for_selector timed out after 1000ms waiting for state=hidden: an element matching "#x" is still visible.',
    });

    registerTools(server, { runtime });
    const result = await tools.get('browser.wait_for_selector')!.handler({ sessionId: 's1', target: '#x' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('Hint: The element is still visible.');
  });

  it('GAP-111 (FR2-01 fix-5): an honest "could not verify" hidden-wait timeout must NOT get the misleading "still visible" hint', async () => {
    // fix-4's engine-level tri-state fix (GAP-082) produces this message when a busy/
    // unresponsive frame prevented a real check — a genuinely different, uncertain outcome
    // from "some frame confirmed still visible". Appending "The element is still visible."
    // here would directly contradict the engine's own honest uncertainty (audit-5 GAP-111,
    // live-reproduced probe A1).
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'waitForSelector').mockResolvedValue({
      success: false,
      actionType: 'wait_for_selector',
      executionTimeMs: 5,
      error:
        'wait_for_selector timed out after 1000ms waiting for state=hidden: could not verify: one or more frames were unresponsive.',
    });

    registerTools(server, { runtime });
    const result = await tools.get('browser.wait_for_selector')!.handler({ sessionId: 's1', target: '#x' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).not.toContain('The element is still visible.');
    // Falls through to the generic, non-committal "timed out" hint instead of no hint at all.
    expect(parsed.error).toContain('Hint:');
    expect(parsed.error).toContain('may still be loading');
  });

  it('GAP-134 (FR2-01 audit-6): a HARD failure (tab/session/target closed mid-check) wrapped in the engine\'s "wait_for_selector failed waiting for state=hidden: ..." prefix must NOT get the "still visible" hint, even though the old broad "waiting for state=hidden" trigger this replaces would have matched it', async () => {
    // Live-reproduced (audit-6 probe-a6.mjs): 3/30 calls where the element was hidden the WHOLE
    // time (an unrelated iframe merely churning) failed with a Target-closed protocol error and
    // still got the confident "The element is still visible." hint appended — a false claim
    // about a genuinely hidden element. This is NOT a timeout at all (no "timed out" substring),
    // so it must never be read as a confirmed-visible outcome.
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'waitForSelector').mockResolvedValue({
      success: false,
      actionType: 'wait_for_selector',
      executionTimeMs: 5,
      error: `${WAIT_HIDDEN_HARD_FAILURE_PREFIX} Protocol error (Runtime.callFunctionOn): Target closed`,
    });

    registerTools(server, { runtime });
    const result = await tools.get('browser.wait_for_selector')!.handler({ sessionId: 's1', target: '#x' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).not.toContain('The element is still visible.');
  });

  it('GAP-134 (FR2-01 audit-6): the GAP-132 tab-closed-mid-wait failure specifically must NOT get the "still visible" hint', async () => {
    // 57/60 tab-close failures in audit-6's live run (probe-a6-T-run2.log) carried this exact
    // false hint before the fix. Uses the engine's own exported TAB_CLOSED_MID_WAIT_MESSAGE so
    // this test can never drift from the real wording GAP-132's fix actually throws.
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'waitForSelector').mockResolvedValue({
      success: false,
      actionType: 'wait_for_selector',
      executionTimeMs: 5,
      error: `${WAIT_HIDDEN_HARD_FAILURE_PREFIX} ${TAB_CLOSED_MID_WAIT_MESSAGE}`,
    });

    registerTools(server, { runtime });
    const result = await tools.get('browser.wait_for_selector')!.handler({ sessionId: 's1', target: '#x' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).not.toContain('The element is still visible.');
  });

  it("GAP-135 (FR2-01 audit-6, process integrity): the hint's trigger/exclusion literals are IMPORTED from @sutradhar/browser's exported constants, not hand-copied strings that can silently drift out of sync with the engine's real wording (exactly what happened to the old list, which excluded a phrase — \"could not determine\" — the engine never actually emits)", () => {
    // A future rename/removal of either constant on the engine side fails this test's IMPORT
    // (a TypeScript compile error), not just a runtime string comparison — the two literally
    // cannot drift apart silently again the way GAP-135 found they already had.
    expect(WAIT_HIDDEN_CONFIRMED_VISIBLE_FRAGMENT).toBe('is still visible');
    expect(WAIT_HIDDEN_HARD_FAILURE_PREFIX).toBe('wait_for_selector failed waiting for state=hidden:');
  });

  it('browser.health reports Chrome availability without launching a session', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'checkHealth').mockReturnValue({ hasChrome: true, executablePath: '/usr/bin/google-chrome' });

    registerTools(server, { runtime });
    const result = await tools.get('browser.health')!.handler({});

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.hasChrome).toBe(true);
  });

  it('browser.shutdown_all calls runtime.shutdownAll', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const spy = vi.spyOn(runtime, 'shutdownAll').mockResolvedValue(undefined);

    registerTools(server, { runtime });
    const result = await tools.get('browser.shutdown_all')!.handler({});

    expect(result.isError).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("agent.runGoal surfaces a session:blocked event fired during the run", async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const agentCore = {
      executeGoal: vi.fn().mockImplementation(async (_goal: string, _sessionId: unknown, options: any) => {
        // Simulate the agent loop publishing session:blocked mid-run, on the SAME bus
        // agent.runGoal subscribes to via runtime.getEventBus() — using the REAL goalId the
        // handler minted and passed through via `options.goalId`, exactly like the real loop
        // (which uses that same id as its own `goalId`).
        await runtime.getEventBus().publish(
          'session:blocked',
          {
            sessionId: 's1',
            agentId: 'a1',
            goalId: options.goalId,
            blockReason: 'captcha',
            message: 'CAPTCHA detected on the page — this requires human intervention.',
          },
          'corr_g1',
        );
        return { id: options.goalId, status: 'failed', steps: [] };
      }),
    } as any;

    registerTools(server, { runtime, agent: { agentCore } });
    const result = await tools.get('agent.runGoal')!.handler({ goal: 'do something' });

    expect(result.content[0].text).toContain('BLOCKED (captcha)');
    expect(result.content[0].text).toContain('CAPTCHA detected');
  });

  it('agent.runGoal never leaks a session:blocked event from a DIFFERENT (unrelated) goalId into its response', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const agentCore = {
      executeGoal: vi.fn().mockImplementation(async () => {
        // Simulate an unrelated concurrent run's block event landing on the shared bus while
        // THIS call is in flight — it must be ignored since its goalId won't match.
        await runtime.getEventBus().publish(
          'session:blocked',
          {
            sessionId: 's_other',
            agentId: 'a_other',
            goalId: 'goal_from_a_totally_different_call',
            blockReason: 'auth_wall',
            message: 'This belongs to a different call and must not leak in.',
          },
          'corr_other',
        );
        return { id: 'whatever', status: 'completed', steps: [], answer: 'done' };
      }),
    } as any;

    registerTools(server, { runtime, agent: { agentCore } });
    const result = await tools.get('agent.runGoal')!.handler({ goal: 'do something else' });

    expect(result.content[0].text).not.toContain('BLOCKED');
    expect(result.content[0].text).not.toContain('different call');
  });
});

describe('@sutradhar/mcp-server browser.wait_for_selector state (FR2-01)', () => {
  it('M1: the state enum accepts the three valid values, omission, and rejects an invalid one', () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    registerTools(server, { runtime });

    const schema = tools.get('browser.wait_for_selector')!.config.inputSchema.state;
    expect(schema.safeParse('hidden').success).toBe(true);
    expect(schema.safeParse('visible').success).toBe(true);
    expect(schema.safeParse('attached').success).toBe(true);
    expect(schema.safeParse(undefined).success).toBe(true);
    expect(schema.safeParse('bogus').success).toBe(false);
  });

  it('M2: the handler passes state straight through to runtime.waitForSelector', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const spy = vi.spyOn(runtime, 'waitForSelector').mockResolvedValue({
      success: true,
      actionType: 'wait_for_selector',
      executionTimeMs: 5,
    });

    registerTools(server, { runtime });
    await tools
      .get('browser.wait_for_selector')!
      .handler({ sessionId: 's1', target: '#t', timeoutMs: 500, state: 'attached' });

    expect(spy).toHaveBeenCalledWith('s1', '#t', 500, undefined, 'attached');
  });

  it('M3: the description names all three states and says which one is the default', () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    registerTools(server, { runtime });

    const description = tools.get('browser.wait_for_selector')!.config.description as string;
    expect(description).toContain('visible');
    expect(description).toContain('attached');
    expect(description).toContain('hidden');
    expect(description.toLowerCase()).toContain('default');
  });

  it('M4: the "none is visible" error gets the state-aware hint, not the misleading generic "still loading" one', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'waitForSelector').mockResolvedValue({
      success: false,
      actionType: 'wait_for_selector',
      executionTimeMs: 5,
      error:
        'wait_for_selector timed out after 5000ms waiting for state=visible: 1 element(s) match "#t" and ' +
        'are attached to the DOM, but none is visible (display:none, visibility:hidden, or zero width/height). ' +
        'Pass state "attached" if DOM presence is enough.',
    });

    registerTools(server, { runtime });
    const result = await tools.get('browser.wait_for_selector')!.handler({ sessionId: 's1', target: '#t' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('state:"attached"');
    expect(parsed.error).not.toContain('page may still be loading');
  });
});

describe('@sutradhar/mcp-server browser.extract_data live values (FR2-02)', () => {
  it('M1: visibleOnly (top-level and per-field) validates as boolean; fields refine is unchanged', () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    registerTools(server, { runtime });

    const config = tools.get('browser.extract_data')!.config.inputSchema;
    expect(config.visibleOnly.safeParse(true).success).toBe(true);
    expect(config.visibleOnly.safeParse(undefined).success).toBe(true);
    expect(config.visibleOnly.safeParse('yes').success).toBe(false);

    expect(
      config.fields.safeParse({ a: { selector: '#a', attribute: 'attr:value', visibleOnly: true } }).success,
    ).toBe(true);
    expect(config.fields.safeParse({ a: { selector: '#a', visibleOnly: 'yes' } }).success).toBe(false);

    const emptyResult = config.fields.safeParse({});
    expect(emptyResult.success).toBe(false);
    expect(emptyResult.error!.issues[0].message).toBe(
      'fields must have at least one entry — an empty object is a no-op extraction',
    );
  });

  it('M2: the handler passes sessionId/fields/tabId/frameSelector and { visibleOnly } through to runtime.extractData', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const F = { v: { selector: '#v' } };
    const spy = vi.spyOn(runtime, 'extractData').mockResolvedValue({ v: ['x'] });

    registerTools(server, { runtime });
    const result = await tools
      .get('browser.extract_data')!
      .handler({ sessionId: 's1', fields: F, tabId: 't1', frameSelector: '#f', visibleOnly: true });

    expect(spy).toHaveBeenCalledWith('s1', F, 't1', '#f', { visibleOnly: true });
    expect(JSON.parse(result.content[0].text)).toEqual({ v: ['x'] });

    spy.mockClear();
    await tools.get('browser.extract_data')!.handler({ sessionId: 's1', fields: F });
    expect(spy).toHaveBeenCalledWith('s1', F, undefined, undefined, { visibleOnly: undefined });
  });

  it('M3: the description and field description document every FR2-02 semantic', () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    registerTools(server, { runtime });

    const tool = tools.get('browser.extract_data')!;
    const description = tool.config.description as string;
    for (const term of ['live', 'attr:', 'visibleOnly', 'innerText', '"true"', 'option:checked', 'shadow']) {
      expect(description).toContain(term);
    }
    const attributeDesc = (tool.config.inputSchema.fields as any)._def.schema._def.valueType._def.shape().attribute
      .description as string;
    expect(attributeDesc).toContain('attr:');
  });

  it('M4: an invalid-selector rejection gets the "extract_data failed:" prefix and no misleading/duplicate hint', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'extractData').mockRejectedValue(
      new Error(
        'Invalid selector for field "bad": ".p[" — Failed to execute \'querySelectorAll\' on \'Document\': ' +
          "'.p[' is not a valid selector.\n" +
          'Use standard CSS or a snapshot node id. Playwright-style selectors (text=, role=, >>, :has-text(), ' +
          'getBy*, internal:) are not supported: take a snapshot to find a CSS selector or node id, or use ' +
          'click_by_text / click_by_role / type_by_label to act by visible text.',
      ),
    );

    registerTools(server, { runtime });
    const result = await tools.get('browser.extract_data')!.handler({ sessionId: 's1', fields: { bad: { selector: '.p[' } } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^extract_data failed: Invalid selector for field "bad"/);
    expect(result.content[0].text).not.toContain('page may still be loading');
    expect(result.content[0].text).not.toContain('Hint:');
  });

  it('M5: an invalid frameSelector rejection from browser.eval gets the "eval failed:" prefix', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'eval').mockRejectedValue(
      new Error(
        'Invalid frameSelector "iframe[" (from the full chain "iframe[") — Failed to execute \'querySelector\' ' +
          "on 'Document': 'iframe[' is not a valid selector. Use standard CSS or a snapshot node id.",
      ),
    );

    registerTools(server, { runtime });
    const result = await tools
      .get('browser.eval')!
      .handler({ sessionId: 's1', code: '1', frameSelector: 'iframe[' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^eval failed: Invalid frameSelector/);
  });
});

describe('@sutradhar/mcp-server FR2-09 frame/shadow labels', () => {
  it('M1: browser.snapshot\'s description documents the iframe/shadow label forms, the tolerant id pattern, and not-inspectable placeholders', () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    registerTools(server, { runtime });

    const desc = tools.get('browser.snapshot')!.config.description as string;
    expect(desc).toContain('in iframe');
    expect(desc).toContain('(shadow:');
    expect(desc).toContain('not inspectable');
    expect(desc).toContain('^\\[#(\\d+)');
  });

  it('M1: browser.ax_snapshot\'s description documents grouped iframe content', () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    registerTools(server, { runtime });

    const desc = tools.get('browser.ax_snapshot')!.config.description as string;
    expect(desc).toContain('[iframe');
  });

  it('M1: registering tools does not change the total tool count', () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    registerTools(server, { runtime });
    expect(tools.size).toBe(EXPECTED_BROWSER_TOOLS.length);
  });

  it('M2: includeNodes + a non-empty skippedFrames appends a "Skipped frames (JSON)" block after the nodes block', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const skippedFrames = [
      { index: 1, url: 'https://ads.example', origin: 'https://ads.example', reason: 'timeout', detail: '5000' },
    ];
    vi.spyOn(runtime, 'snapshot').mockResolvedValue({
      sessionId: 's1',
      tabId: 't1',
      url: 'https://x.test',
      title: 'T',
      interactiveElements: 'URL: https://x.test\nTitle: T\nInteractive elements (0):\n',
      elementCount: 0,
      pageText: '',
      nodes: [],
      skippedFrames,
    } as any);

    registerTools(server, { runtime });
    const result = await tools.get('browser.snapshot')!.handler({ sessionId: 's1', includeNodes: true });

    expect(result.content[0].text).toContain('Structured nodes (JSON):');
    expect(result.content[0].text.indexOf('Skipped frames (JSON):')).toBeGreaterThan(
      result.content[0].text.indexOf('Structured nodes (JSON):'),
    );
    expect(result.content[0].text).toContain(JSON.stringify(skippedFrames));
  });

  it('M2: includeNodes with an empty skippedFrames array adds no block', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'snapshot').mockResolvedValue({
      sessionId: 's1',
      tabId: 't1',
      url: 'https://x.test',
      title: 'T',
      interactiveElements: 'URL: https://x.test\nTitle: T\nInteractive elements (0):\n',
      elementCount: 0,
      pageText: '',
      nodes: [],
      skippedFrames: [],
    } as any);

    registerTools(server, { runtime });
    const result = await tools.get('browser.snapshot')!.handler({ sessionId: 's1', includeNodes: true });

    expect(result.content[0].text).not.toContain('Skipped frames (JSON):');
  });

  it('M2: without includeNodes, no skipped-frames block even if the runtime happened to return one', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'snapshot').mockResolvedValue({
      sessionId: 's1',
      tabId: 't1',
      url: 'https://x.test',
      title: 'T',
      interactiveElements: 'URL: https://x.test\nTitle: T\nInteractive elements (0):\n',
      elementCount: 0,
      pageText: '',
    } as any);

    registerTools(server, { runtime });
    const result = await tools.get('browser.snapshot')!.handler({ sessionId: 's1' });

    expect(result.content[0].text).not.toContain('Skipped frames (JSON):');
    expect(result.content[0].text).not.toContain('Structured nodes (JSON):');
  });
});

describe('FR2-10 optional sessionId', () => {
  const A = {
    sessionId: 'A',
    origin: 'launched' as const,
    createdAt: '2026-09-25T10:00:00.000Z',
    tabCount: 1,
    activeTabId: 't1',
    activeUrl: 'https://x.test/',
    hasRealBrowser: true,
  };
  const B = { ...A, sessionId: 'B', createdAt: '2026-09-25T10:01:00.000Z' };

  it('T1: every non-exempt tool has an optional sessionId; exempt tools are untouched', () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const agentCore = { executeGoal: vi.fn() } as any;

    registerTools(server, { runtime, agent: { agentCore } });

    const EXEMPT = ['browser.launch', 'browser.attach', 'browser.health', 'browser.shutdown_all'];
    let nonExemptCount = 0;
    for (const name of EXPECTED_BROWSER_TOOLS) {
      if (EXEMPT.includes(name)) continue;
      const schema = tools.get(name)!.config.inputSchema;
      expect(schema.sessionId, `${name} should have a sessionId key`).toBeDefined();
      expect(schema.sessionId.safeParse(undefined).success).toBe(true);
      expect(schema.sessionId.safeParse('s1').success).toBe(true);
      expect(schema.sessionId.safeParse(5).success).toBe(false);
      nonExemptCount++;
    }
    expect(nonExemptCount).toBeGreaterThanOrEqual(66);

    expect(tools.get('browser.launch')!.config.inputSchema.sessionId.safeParse(undefined).success).toBe(true);
    expect(tools.get('browser.attach')!.config.inputSchema.sessionId.safeParse(undefined).success).toBe(true);
    expect(tools.get('browser.launch')!.config.inputSchema.sessionId.description).toBe(
      'Reuse an existing caller-owned session id.',
    );
    expect(tools.get('browser.health')!.config.inputSchema.sessionId).toBeUndefined();
    expect(tools.get('browser.shutdown_all')!.config.inputSchema.sessionId).toBeUndefined();
    expect(tools.get('agent.runGoal')!.config.inputSchema.sessionId.description).toBe(
      'Run against an existing browser session.',
    );
  });

  it('T2: omitted (1 live session) resolves to the same positional runtime call as an explicit id', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'listSessions').mockReturnValue({ sessions: [A], lifecycleOpsInFlight: 0 });
    const spy = vi
      .spyOn(runtime, 'click')
      .mockResolvedValue({ success: true, actionType: 'click', executionTimeMs: 1 });

    registerTools(server, { runtime });
    const r1 = await tools.get('browser.click')!.handler({ target: '#x' });
    const r2 = await tools.get('browser.click')!.handler({ sessionId: 'A', target: '#x' });

    expect(spy.mock.calls[0]).toEqual(spy.mock.calls[1]);
    expect(spy.mock.calls[0].length).toBe(spy.mock.calls[1].length);
    expect(r1.content.length).toBe(2);
    expect(r2.content.length).toBe(1);
  });

  it('T3: omitted with 0 live sessions -> isError, runtime.click never called', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'listSessions').mockReturnValue({ sessions: [], lifecycleOpsInFlight: 0 });
    const spy = vi.spyOn(runtime, 'click');

    registerTools(server, { runtime });
    const result = await tools.get('browser.click')!.handler({ target: '#x' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('click failed: No sessionId given, and there is no live browser session');
    expect(spy).not.toHaveBeenCalled();
  });

  it('T4: omitted with 2+ live sessions -> isError listing both ids, runtime.click never called', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'listSessions').mockReturnValue({ sessions: [A, B], lifecycleOpsInFlight: 0 });
    const spy = vi.spyOn(runtime, 'click');

    registerTools(server, { runtime });
    const result = await tools.get('browser.click')!.handler({ target: '#x' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('A');
    expect(result.content[0].text).toContain('B');
    expect(spy).not.toHaveBeenCalled();
  });

  it('T5: browser.launch is unaffected — omitted sessionId always means "create new", never resolved', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const listSessions = vi.spyOn(runtime, 'listSessions').mockReturnValue({ sessions: [A], lifecycleOpsInFlight: 0 });
    const spy = vi
      .spyOn(runtime, 'launch')
      .mockResolvedValue({ sessionId: 'N', activeTabId: 't', hasRealBrowser: true });

    registerTools(server, { runtime });
    const result = await tools.get('browser.launch')!.handler({});

    expect(spy.mock.calls[0][0]).toMatchObject({ sessionId: undefined });
    expect(listSessions).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.sessionId).toBe('N');
    expect(result.content.length).toBe(1);
  });

  it('T6: browser.attach is unaffected the same way', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'listSessions').mockReturnValue({ sessions: [A], lifecycleOpsInFlight: 0 });
    const spy = vi
      .spyOn(runtime, 'attach')
      .mockResolvedValue({ sessionId: 'N', activeTabId: 't', hasRealBrowser: true });

    registerTools(server, { runtime });
    await tools.get('browser.attach')!.handler({ endpoint: 'http://127.0.0.1:9222' });

    expect(spy.mock.calls[0][0]).toMatchObject({ endpoint: 'http://127.0.0.1:9222', sessionId: undefined });
  });

  it('T7: browser.shutdown resolves the omitted id and reports it', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'listSessions').mockReturnValue({ sessions: [A], lifecycleOpsInFlight: 0 });
    const spy = vi.spyOn(runtime, 'shutdown').mockResolvedValue(undefined);

    registerTools(server, { runtime });
    const result = await tools.get('browser.shutdown')!.handler({});

    expect(spy).toHaveBeenCalledWith('A');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ success: true, sessionId: 'A' });
    expect(result.content.length).toBe(2);
    expect(result.content[1].text).toBe('sessionId omitted: used "A", the only live browser session.');
  });

  it('T8: browser.get_viewport (sync handler) resolves the omitted id; explicit id stays synchronous', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'listSessions').mockReturnValue({ sessions: [A], lifecycleOpsInFlight: 0 });
    const spy = vi.spyOn(runtime, 'getViewport').mockReturnValue(null);

    registerTools(server, { runtime });
    await tools.get('browser.get_viewport')!.handler({});
    expect(spy).toHaveBeenCalledWith('A', undefined);

    const syncRet = tools.get('browser.get_viewport')!.handler({ sessionId: 'A' });
    expect(syncRet).not.toBeInstanceOf(Promise);
  });

  it('T9: browser.set_cookie (rest spread) never leaks sessionId into the cookie object', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'listSessions').mockReturnValue({ sessions: [A], lifecycleOpsInFlight: 0 });
    const spy = vi.spyOn(runtime, 'setCookie').mockResolvedValue(undefined);

    registerTools(server, { runtime });
    await tools.get('browser.set_cookie')!.handler({ name: 'n', value: 'v' });
    await tools.get('browser.set_cookie')!.handler({ sessionId: 'A', name: 'n', value: 'v' });

    expect(spy.mock.calls[0][1]).not.toHaveProperty('sessionId');
    expect(spy.mock.calls[0][1]).toEqual(spy.mock.calls[1][1]);
  });

  it('T10: agent.runGoal is unaffected — omitted sessionId still means "let the agent create one"', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'listSessions').mockReturnValue({ sessions: [A], lifecycleOpsInFlight: 0 });
    const executeGoal = vi.fn().mockResolvedValue({ finalAnswer: 'done', steps: [], success: true });
    const agentCore = { executeGoal } as any;

    registerTools(server, { runtime, agent: { agentCore } });
    await tools.get('agent.runGoal')!.handler({ goal: 'g' });

    expect(executeGoal.mock.calls[0][1]).toBeUndefined();
  });

  it('T11: browser.screenshot keeps the image as content[0], note appended after it', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'listSessions').mockReturnValue({ sessions: [A], lifecycleOpsInFlight: 0 });
    vi.spyOn(runtime, 'screenshot').mockResolvedValue({ base64: 'ZmFrZQ==' });

    registerTools(server, { runtime });
    const result = await tools.get('browser.screenshot')!.handler({});

    expect(result.content[0].type).toBe('image');
    expect(result.content[1].text).toBe('sessionId omitted: used "A", the only live browser session.');
  });

  it('T12: an explicit but unknown id is never redirected to the one live session', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const listSessions = vi.spyOn(runtime, 'listSessions').mockReturnValue({ sessions: [A], lifecycleOpsInFlight: 0 });

    registerTools(server, { runtime });
    const result = await tools.get('browser.click')!.handler({ sessionId: 'nope', target: '#x' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No browser session "nope"');
    expect(listSessions).not.toHaveBeenCalled();
  });
});

describe('browser.audit (FR2-12)', () => {
  const { PNG } = require_('pngjs');
  const schema = JSON.parse(readFileSync(path.join(capabilityRuntimeDir, 'schemas', 'audit-report.schema.json'), 'utf-8'));
  const validate = new AjvJsonSchemaValidator().getValidator(schema);

  function makePngBase64(w: number, h: number): string {
    const png = new PNG({ width: w, height: h });
    for (let i = 0; i < w * h; i++) {
      png.data[i * 4] = 10;
      png.data[i * 4 + 1] = 20;
      png.data[i * 4 + 2] = 30;
      png.data[i * 4 + 3] = 255;
    }
    return PNG.sync.write(png).toString('base64');
  }

  function fakeResult(overrides: Partial<any> = {}): any {
    return {
      url: 'http://127.0.0.1:1/audit',
      title: 'T',
      timestamp: '2026-01-01T00:00:00.000Z',
      screenshotBase64: makePngBase64(5, 4),
      consoleErrors: [],
      pageErrors: [],
      brokenRequests: [],
      accessibilityIssues: [],
      webVitals: { lcpMs: 10, cls: 0, fcpMs: 5, ttfbMs: 1 },
      requestedUrl: 'http://127.0.0.1:1/audit',
      observation: {
        mode: 'navigated',
        documentStartedAt: '2026-01-01T00:00:00.000Z',
        observingSince: '2026-01-01T00:00:00.000Z',
        coversWholeDocument: true,
        pageWasHidden: false,
      },
      baseline: null,
      ...overrides,
    };
  }

  it('M1: EXPECTED_BROWSER_TOOLS contains browser.audit and the count test passes with it', () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    registerTools(server, { runtime });
    expect(EXPECTED_BROWSER_TOOLS).toContain('browser.audit');
    expect(tools.has('browser.audit')).toBe(true);
    expect(tools.size).toBe(EXPECTED_BROWSER_TOOLS.length);
  });

  it('M2: the input schema accepts/rejects url, baselineUrl, includeImages, and has no outDir key', () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    registerTools(server, { runtime });
    const inputSchema = tools.get('browser.audit')!.config.inputSchema;

    expect(inputSchema.url.safeParse('').success).toBe(false);
    expect(inputSchema.url.safeParse(undefined).success).toBe(true);
    expect(inputSchema.baselineUrl.safeParse('').success).toBe(false);
    expect(inputSchema.baselineUrl.safeParse(undefined).success).toBe(true);
    expect(inputSchema.includeImages.safeParse('yes').success).toBe(false);
    expect('outDir' in inputSchema).toBe(false);
  });

  it('M3: content is [text report, image screenshot] with no base64 leaked into the text', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const result = fakeResult();
    vi.spyOn(runtime, 'audit').mockResolvedValue(result);
    registerTools(server, { runtime });

    const res = await tools.get('browser.audit')!.handler({ sessionId: 's1' });
    expect(res.content.length).toBe(2);
    expect(res.content[0].type).toBe('text');
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed).toEqual(buildAuditReport(result, { screenshotPath: null, diffPath: null }));
    expect(res.content[1]).toEqual({ type: 'image', data: result.screenshotBase64, mimeType: 'image/png' });
    expect(res.content[0].text).not.toContain(result.screenshotBase64);
  });

  it('M4: a successful baseline adds a third image content item, diffPath null', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const diffBase64 = makePngBase64(5, 4);
    const result = fakeResult({
      baseline: { url: 'http://127.0.0.1:1/b', width: 5, height: 4, diffPixelCount: 1, totalPixels: 20, diffPercentage: 5, diffImageBase64: diffBase64 },
    });
    vi.spyOn(runtime, 'audit').mockResolvedValue(result);
    registerTools(server, { runtime });

    const res = await tools.get('browser.audit')!.handler({ sessionId: 's1' });
    expect(res.content.length).toBe(3);
    expect(res.content[2]).toEqual({ type: 'image', data: diffBase64, mimeType: 'image/png' });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.baseline.diffPath).toBeNull();
  });

  it('M5: includeImages:false omits images; a baseline error omits isError and the diff image', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'audit').mockResolvedValue(fakeResult());
    registerTools(server, { runtime });

    const res1 = await tools.get('browser.audit')!.handler({ sessionId: 's1', includeImages: false });
    expect(res1.content.length).toBe(1);

    const runtime2 = new SutradharRuntime();
    const errResult = fakeResult({ baseline: { url: 'http://127.0.0.1:1/b', error: 'boom' } });
    vi.spyOn(runtime2, 'audit').mockResolvedValue(errResult);
    const { server: server2, tools: tools2 } = createMockServer();
    registerTools(server2, { runtime: runtime2 });
    const res2 = await tools2.get('browser.audit')!.handler({ sessionId: 's1' });
    expect(res2.content.length).toBe(2);
    expect(res2.isError).toBeUndefined();
    const parsed2 = JSON.parse(res2.content[0].text);
    expect(parsed2.baseline).toEqual({ url: 'http://127.0.0.1:1/b', error: 'boom' });
  });

  it('M6: argument pass-through is exact', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const spy = vi.spyOn(runtime, 'audit').mockResolvedValue(fakeResult());
    registerTools(server, { runtime });

    await tools.get('browser.audit')!.handler({ sessionId: 's1', url: 'http://127.0.0.1/a' });
    expect(spy).toHaveBeenCalledWith('s1', { url: 'http://127.0.0.1/a' });

    spy.mockClear();
    await tools.get('browser.audit')!.handler({ sessionId: 's1' });
    expect(spy).toHaveBeenCalledWith('s1', {});

    spy.mockClear();
    await tools.get('browser.audit')!.handler({ sessionId: 's1', url: 'http://127.0.0.1/a', baselineUrl: 'http://127.0.0.1/b', tabId: 't1' });
    expect(spy).toHaveBeenCalledWith('s1', { url: 'http://127.0.0.1/a', tabId: 't1', baselineUrl: 'http://127.0.0.1/b' });
  });

  it('M7: an unknown session is isError with the "audit failed:" prefix and the existing hint', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'audit').mockRejectedValue(new Error('No browser session "x"'));
    registerTools(server, { runtime });

    const res = await tools.get('browser.audit')!.handler({ sessionId: 'x' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/^audit failed: No browser session/);
    expect(res.content[0].text).toContain('Hint:');
  });

  it('M8: the schema validates real output and rejects known mutations; the example itself is valid', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const withBaseline = fakeResult({
      baseline: { url: 'http://127.0.0.1:1/b', width: 5, height: 4, diffPixelCount: 1, totalPixels: 20, diffPercentage: 5, diffImageBase64: makePngBase64(5, 4) },
    });
    vi.spyOn(runtime, 'audit').mockResolvedValue(withBaseline);
    registerTools(server, { runtime });

    const res = await tools.get('browser.audit')!.handler({ sessionId: 's1' });
    const report = JSON.parse(res.content[0].text);
    expect(validate(report).valid).toBe(true);

    const mutations: Array<(r: any) => any> = [
      (r) => ({ ...r, screenshotBase64: 'x' }),
      (r) => ({ ...r, brokenRequests: [{ url: 'http://x', status: 200 }] }),
      (r) => { const c = { ...r }; delete c.webVitals; return c; },
      (r) => ({ ...r, observation: { ...r.observation, mode: 'other' } }),
      (r) => ({ ...r, schemaVersion: 2 }),
      (r) => ({ ...r, baseline: { url: 'u' } }),
      (r) => ({ ...r, timestamp: 'yesterday' }),
      (r) => ({ ...r, accessibilityIssues: [{ rule: 'img-alt', description: 'x', count: 0 }] }),
    ];
    for (const mutate of mutations) {
      const mutated = mutate(JSON.parse(JSON.stringify(report)));
      expect(validate(mutated).valid, JSON.stringify(mutated)).toBe(false);
    }

    expect(validate(AUDIT_REPORT_EXAMPLE).valid).toBe(true);
  });
});

describe('@sutradhar/mcp-server FR2-06 selector dialect', () => {
  it('M1: browser.click\'s target description documents the dialect', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    registerTools(server, { runtime });

    const desc = (tools.get('browser.click')!.config.inputSchema.target as any).description as string;
    expect(desc).toContain('Playwright');
    expect(desc).toContain('click_by_text');
    expect(desc).toContain('xpath/');
  });

  it('M2: every selector-taking handler rejects a Playwright selector with isError, no "\\nHint:", before touching a real session', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime(); // real instance, no sessions created
    registerTools(server, { runtime });

    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['browser.click', { sessionId: 'nope', target: 'text=Submit' }, 'click'],
      ['browser.right_click', { sessionId: 'nope', target: 'text=Submit' }, 'right_click'],
      ['browser.type', { sessionId: 'nope', target: 'text=Submit', value: 'x' }, 'type'],
      ['browser.hover', { sessionId: 'nope', target: 'text=Submit' }, 'hover'],
      ['browser.focus', { sessionId: 'nope', target: 'text=Submit' }, 'focus'],
      ['browser.select_option', { sessionId: 'nope', target: 'text=Submit', value: 'v' }, 'select_option'],
      ['browser.select_options', { sessionId: 'nope', target: 'text=Submit', values: ['v'] }, 'select_options'],
      ['browser.wait_for_selector', { sessionId: 'nope', target: 'text=Submit' }, 'wait_for_selector'],
      ['browser.upload_file', { sessionId: 'nope', target: 'text=Submit', filePath: '/tmp/x' }, 'upload_file'],
      ['browser.drag_and_drop', { sessionId: 'nope', sourceTarget: 'text=Submit', destTarget: '#ok' }, 'drag_and_drop'],
      ['browser.drag_and_drop', { sessionId: 'nope', sourceTarget: '#ok', destTarget: 'text=Submit' }, 'drag_and_drop'],
      ['browser.touch_tap', { sessionId: 'nope', target: 'text=Submit' }, 'touch_tap'],
      ['browser.download_file', { sessionId: 'nope', target: 'text=Submit' }, 'download_file'],
      ['browser.scroll', { sessionId: 'nope', target: 'text=Submit' }, 'scroll'],
    ];
    for (const [toolName, args, verb] of cases) {
      const result = await tools.get(toolName)!.handler(args);
      expect(result.isError, `${toolName} isError`).toBe(true);
      const text = result.content[0].text as string;
      expect(text, `${toolName} text`).toMatch(new RegExp(`^${verb} failed: Invalid selector "text=Submit"`));
      expect(text).toContain('click_by_text');
      expect(text).not.toContain('\nHint:');
    }

    const fillResult = await tools.get('browser.fill_form')!.handler({ sessionId: 'nope', fields: { 'text=Submit': 'x' } });
    expect(fillResult.isError).toBeUndefined();
    const parsed = JSON.parse(fillResult.content[0].text);
    expect(parsed['text=Submit'].success).toBe(false);
    expect(parsed['text=Submit'].error).toContain('Playwright-style');
  });

  it('M3: a runtime.click success:false with the selector-dialect hint is not double-hinted', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const message = 'Invalid selector "div[" — is not a valid selector. Use standard CSS or a snapshot node id (e.g. "12")';
    vi.spyOn(runtime, 'click').mockResolvedValue({
      success: false,
      actionType: 'click',
      executionTimeMs: 1,
      error: message,
    });

    registerTools(server, { runtime });
    const result = await tools.get('browser.click')!.handler({ sessionId: 's1', target: 'div[' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe(message);
    expect(parsed.error).not.toContain('\nHint:');
  });

  it('M4: the tool count is unchanged by this item', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    registerTools(server, { runtime });
    expect(tools.size).toBe(EXPECTED_BROWSER_TOOLS.length);
  });
});

describe('@sutradhar/mcp-server FR2-05 download/upload root hints and descriptions', () => {
  it('T1: a download-outside-roots error gets a Hint naming SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'downloadFile').mockResolvedValue({
      success: false,
      actionType: 'download_file',
      executionTimeMs: 1,
      error: 'downloadDir "X" is outside the allowed download directories (Y). Pass a path under one of these.',
    });

    registerTools(server, { runtime });
    const result = await tools.get('browser.download_file')!.handler({ sessionId: 's1', target: '#dl', downloadDir: 'X' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('Hint:');
    expect(parsed.error).toContain('SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS');
  });

  it('T2: an upload-outside-roots error gets a Hint naming SUTRADHAR_ALLOWED_UPLOAD_ROOTS', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'uploadFile').mockResolvedValue({
      success: false,
      actionType: 'upload_file',
      executionTimeMs: 1,
      error: 'Upload file "X" is outside the allowed upload directories (Y).',
    });

    registerTools(server, { runtime });
    const result = await tools.get('browser.upload_file')!.handler({ sessionId: 's1', target: '#f', filePath: 'X' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain('Hint:');
    expect(parsed.error).toContain('SUTRADHAR_ALLOWED_UPLOAD_ROOTS');
  });

  it('T3: the download_file/downloadDir descriptions describe the real default, not the old wrong one', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    registerTools(server, { runtime });
    const config = tools.get('browser.download_file')!.config;
    const description = config.description as string;
    const downloadDirSchema = config.inputSchema.downloadDir as { description?: string };
    const downloadDirDescription = downloadDirSchema.description ?? '';
    const combined = `${description}\n${downloadDirDescription}`;

    expect(combined).not.toContain('Defaults to the OS temp directory.');
    expect(description).toContain('downloadedPath');
    expect(combined).toContain('sutradhar-downloads');
  });
});

describe('FR2-07: the expect option and the verification contract on MCP results', () => {
  const EXPECT_TOOLS = [
    'browser.navigate', 'browser.go_back', 'browser.go_forward', 'browser.reload', 'browser.click',
    'browser.click_at_point', 'browser.drag_at_points', 'browser.type', 'browser.press_key', 'browser.focus',
    'browser.scroll', 'browser.hover', 'browser.select_option', 'browser.select_options',
    'browser.wait_for_selector', 'browser.click_by_text', 'browser.click_by_role', 'browser.type_by_label',
    'browser.upload_file', 'browser.right_click', 'browser.drag_and_drop', 'browser.touch_tap',
    'browser.download_file', 'browser.upload_file_via_trigger',
  ];
  const VERIFIED = {
    verified: true, urlChanged: false, elementFound: true, confidence: 0.9, reason: 'ok',
    evidence: { tier: 'verified', checks: [{ check: 'x.built-in', outcome: 'pass' }] },
  } as any;
  const UNVERIFIABLE = { ...VERIFIED, verified: false, confidence: 0.45, evidence: { tier: 'unverifiable', checks: [] } } as any;

  it('M1: exactly the 24 documented tools take a strict optional expect; clipboard/screenshot/fill_form do not', () => {
    const { server, tools } = createMockServer();
    registerTools(server, { runtime: new SutradharRuntime() });
    expect(EXPECT_TOOLS).toHaveLength(24);
    for (const name of EXPECT_TOOLS) {
      const schema = tools.get(name)!.config.inputSchema.expect;
      expect(schema, name).toBeDefined();
      for (const ok of [undefined, {}, { text: 'x' }, { urlChanged: false }, { url: '/a', text: 'b', urlChanged: true }]) {
        expect(schema.safeParse(ok).success, `${name} accepts ${JSON.stringify(ok)}`).toBe(true);
      }
      for (const bad of [{ text: '' }, { bogus: 1 }, { urlChanged: 'yes' }, { url: '' }, 'text', 5]) {
        expect(schema.safeParse(bad).success, `${name} rejects ${JSON.stringify(bad)}`).toBe(false);
      }
    }
    for (const name of ['browser.set_clipboard', 'browser.get_clipboard', 'browser.screenshot', 'browser.fill_form']) {
      expect(tools.get(name)!.config.inputSchema.expect, name).toBeUndefined();
    }
    // no OTHER tool gained one by accident
    const withExpect = [...tools.entries()].filter(([, t]) => t.config.inputSchema && 'expect' in t.config.inputSchema).map(([n]) => n);
    expect(withExpect.sort()).toEqual([...EXPECT_TOOLS].sort());
  });

  it('M2: the arity rule: expect is appended only when given (click 6->7, wait_for_selector 5->6, navigate 3->4, click_at_point 5->6)', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const click = vi.spyOn(runtime, 'click').mockResolvedValue({ success: true, actionType: 'click', executionTimeMs: 1 });
    const wait = vi.spyOn(runtime, 'waitForSelector').mockResolvedValue({ success: true, actionType: 'wait_for_selector', executionTimeMs: 1 });
    const nav = vi.spyOn(runtime, 'navigate').mockResolvedValue({ tabId: 't', url: 'https://a.test/', title: '' });
    const point = vi.spyOn(runtime, 'clickAtPoint').mockResolvedValue({ success: true, actionType: 'click_at_point', executionTimeMs: 1 });
    registerTools(server, { runtime });
    const exp = { text: 'x' };

    await tools.get('browser.click')!.handler({ sessionId: 's1', target: '#a' });
    expect(click.mock.calls[0]).toHaveLength(6);
    await tools.get('browser.click')!.handler({ sessionId: 's1', target: '#a', expect: exp });
    expect(click.mock.calls[1]).toHaveLength(7);
    expect(click.mock.calls[1]![6]).toEqual(exp);

    await tools.get('browser.wait_for_selector')!.handler({ sessionId: 's1', target: '#t', timeoutMs: 500, state: 'attached' });
    expect(wait.mock.calls[0]).toHaveLength(5);
    await tools.get('browser.wait_for_selector')!.handler({ sessionId: 's1', target: '#t', timeoutMs: 500, state: 'attached', expect: exp });
    expect(wait.mock.calls[1]).toHaveLength(6);
    expect(wait.mock.calls[1]![5]).toEqual(exp);

    await tools.get('browser.navigate')!.handler({ sessionId: 's1', url: 'https://a.test/' });
    expect(nav.mock.calls[0]).toHaveLength(3);
    await tools.get('browser.navigate')!.handler({ sessionId: 's1', url: 'https://a.test/', expect: exp });
    expect(nav.mock.calls[1]).toHaveLength(4);

    await tools.get('browser.click_at_point')!.handler({ sessionId: 's1', x: 1, y: 2 });
    expect(point.mock.calls[0]).toHaveLength(5);
    await tools.get('browser.click_at_point')!.handler({ sessionId: 's1', x: 1, y: 2, expect: exp });
    expect(point.mock.calls[1]).toHaveLength(6);
  });

  it('M3: set_clipboard / get_clipboard / upload_file_via_trigger results carry verification (and keep their old keys)', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'setClipboard').mockResolvedValue({ success: true, actionType: 'set_clipboard', executionTimeMs: 1, verification: UNVERIFIABLE });
    vi.spyOn(runtime, 'readClipboard').mockResolvedValue({ text: 'hi', verification: VERIFIED });
    vi.spyOn(runtime, 'uploadFileViaTrigger').mockResolvedValue({ success: true, actionType: 'upload_file_via_trigger', executionTimeMs: 1, verification: UNVERIFIABLE });
    registerTools(server, { runtime });

    const set = JSON.parse((await tools.get('browser.set_clipboard')!.handler({ sessionId: 's1', text: 'x' })).content[0].text);
    expect(set.success).toBe(true);
    expect(set.verification.evidence.tier).toBe('unverifiable');
    const get = JSON.parse((await tools.get('browser.get_clipboard')!.handler({ sessionId: 's1' })).content[0].text);
    expect(get.text).toBe('hi');
    expect(get.verification.verified).toBe(true);
    const up = JSON.parse((await tools.get('browser.upload_file_via_trigger')!.handler({ sessionId: 's1', target: '#b', filePath: '/tmp/a.txt' })).content[0].text);
    expect(up).toMatchObject({ success: true, filePath: '/tmp/a.txt' });
    expect(up.verification).toBeDefined();
  });

  it('M4: screenshot keeps the image at content[0] and adds the verification as a JSON text block at content[1]', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'screenshot').mockResolvedValue({ base64: 'ZmFrZQ==', verification: UNVERIFIABLE });
    registerTools(server, { runtime });
    const res = await tools.get('browser.screenshot')!.handler({ sessionId: 's1' });
    expect(res.content[0]).toEqual({ type: 'image', data: 'ZmFrZQ==', mimeType: 'image/png' });
    expect(res.content[1].type).toBe('text');
    const parsed = JSON.parse(res.content[1].text);
    expect(parsed.verification.evidence.tier).toBe('unverifiable');
    expect(parsed.actionType).toBe('screenshot');
    expect(res.content[1].text).not.toContain('ZmFrZQ=='); // the image is never duplicated into the text
  });

  it('M5: the click_at_point description no longer claims verification is bypassed, and points at expect', () => {
    const { server, tools } = createMockServer();
    registerTools(server, { runtime: new SutradharRuntime() });
    const d: string = tools.get('browser.click_at_point')!.config.description;
    expect(d).not.toContain('verification entirely');
    expect(d).toContain('expect');
    expect(d).toContain('actually at the point');
  });

  it('M6: a navigate result carries verification, and the expect description states the honest semantics', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'navigate').mockResolvedValue({ tabId: 't', url: 'https://a.test/', title: 'A', verification: VERIFIED });
    registerTools(server, { runtime });
    const parsed = JSON.parse((await tools.get('browser.navigate')!.handler({ sessionId: 's1', url: 'https://a.test/' })).content[0].text);
    expect(parsed.verification.evidence.tier).toBe('verified');
    const d: string = tools.get('browser.click')!.config.inputSchema.expect.description;
    expect(d).toContain('does NOT fail the action');
    expect(d).toContain('unverifiable');
    // fix-2: the description states the precise rendered-text contract, including what still counts
    expect(d).toContain('RENDERED text');
    expect(d).toContain('display:none / content-visibility:hidden / a closed <details>');
    expect(d).toContain('every enclosing iframe itself visible');
    expect(d).toContain('opacity:0, aria-hidden and off-screen text still count');
    expect(d).toContain('never-painted SVG containers');
  });

  it('M7: a runtime TypeError from a bad expect is reported as an isError result, not a crash', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    vi.spyOn(runtime, 'click').mockRejectedValue(new TypeError('expect.urlChanged must be a boolean'));
    registerTools(server, { runtime });
    const res = await tools.get('browser.click')!.handler({ sessionId: 's1', target: '#a', expect: { urlChanged: 'yes' } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('expect.urlChanged must be a boolean');
  });
});

describe('FR2-08 browser.wait_for and settle on every interacting/navigating tool', () => {
  // The 25 tools that take `settle`: click/type/scroll (already had it) + the 22 newly wired.
  const SETTLE_TOOLS = [
    'browser.click', 'browser.type', 'browser.scroll',
    'browser.navigate', 'browser.go_back', 'browser.go_forward', 'browser.reload',
    'browser.click_at_point', 'browser.drag_at_points',
    'browser.press_key', 'browser.focus', 'browser.hover', 'browser.select_option', 'browser.select_options',
    'browser.click_by_text', 'browser.click_by_role', 'browser.type_by_label', 'browser.fill_form',
    'browser.upload_file', 'browser.right_click', 'browser.drag_and_drop', 'browser.touch_tap', 'browser.download_file',
    'browser.upload_file_via_trigger', 'browser.handle_dialog',
  ];
  // Every other registered tool, each with the reason it is excluded (spec section 2.6). A NEW tool must be
  // classified in one of the two lists, or the completeness assertion below fails.
  const NO_SETTLE_TOOLS = [
    // waits: settling after a wait is meaningless
    'browser.wait_for_selector', 'browser.wait_for',
    // reads
    'browser.snapshot', 'browser.ax_snapshot', 'browser.screenshot', 'browser.export_pdf', 'browser.extract_data',
    'browser.audit', 'browser.eval', 'browser.get_cookies', 'browser.get_local_storage', 'browser.get_session_storage',
    'browser.get_storage_state', 'browser.get_viewport', 'browser.get_clipboard', 'browser.get_pending_dialog',
    'browser.get_console_logs', 'browser.get_page_errors', 'browser.get_network_log', 'browser.get_action_history',
    'browser.get_tab_lock', 'browser.list_tabs',
    // environment / configuration
    'browser.set_cookie', 'browser.delete_cookie', 'browser.set_local_storage_item', 'browser.clear_local_storage',
    'browser.set_session_storage_item', 'browser.clear_session_storage', 'browser.set_storage_state',
    'browser.set_geolocation', 'browser.grant_permissions', 'browser.set_viewport', 'browser.emulate',
    'browser.set_network_conditions', 'browser.set_clipboard', 'browser.route', 'browser.clear_routes',
    // lifecycle / tabs
    'browser.health', 'browser.launch', 'browser.attach', 'browser.shutdown', 'browser.shutdown_all',
    'browser.new_tab', 'browser.focus_tab', 'browser.close_tab', 'browser.lock_tab', 'browser.unlock_tab',
  ];

  it('M1: browser.wait_for is registered', () => {
    const { server, tools } = createMockServer();
    registerTools(server, { runtime: new SutradharRuntime() });
    expect(tools.has('browser.wait_for')).toBe(true);
    expect(EXPECTED_BROWSER_TOOLS).toContain('browser.wait_for');
  });

  it('M2: wait_for schema: non-empty strings, timeoutMs an integer 0..300000, every key optional', () => {
    const { server, tools } = createMockServer();
    registerTools(server, { runtime: new SutradharRuntime() });
    const sch = tools.get('browser.wait_for')!.config.inputSchema;
    for (const k of ['text', 'textGone', 'url', 'js']) {
      expect(sch[k].safeParse('').success, `${k} rejects ''`).toBe(false);
      expect(sch[k].safeParse('x').success, `${k} accepts 'x'`).toBe(true);
      expect(sch[k].safeParse(undefined).success, `${k} optional`).toBe(true);
    }
    expect(sch.timeoutMs.safeParse(-1).success).toBe(false);
    expect(sch.timeoutMs.safeParse(300001).success).toBe(false);
    expect(sch.timeoutMs.safeParse(1.5).success).toBe(false);
    expect(sch.timeoutMs.safeParse(0).success).toBe(true);
    expect(sch.timeoutMs.safeParse(300000).success).toBe(true);
    expect(sch.tabId.safeParse(undefined).success).toBe(true);
    expect('expect' in sch).toBe(false); // its conditions ARE the assertion
    expect('settle' in sch).toBe(false);
  });

  it('M3: the handler forwards only the given keys (no undefined keys) and tabId only when given', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const spy = vi.spyOn(runtime, 'waitFor').mockResolvedValue({ success: true, actionType: 'wait_for', executionTimeMs: 1 });
    registerTools(server, { runtime });
    await tools.get('browser.wait_for')!.handler({ sessionId: 's1', text: 'Saved', timeoutMs: 5000 });
    expect(spy.mock.calls[0]).toHaveLength(2);
    expect(spy.mock.calls[0]![1]).toStrictEqual({ text: 'Saved', timeoutMs: 5000 });
    await tools.get('browser.wait_for')!.handler({ sessionId: 's1', url: '/x', tabId: 't9', text: undefined, js: undefined });
    expect(spy.mock.calls[1]).toHaveLength(3);
    expect(spy.mock.calls[1]![1]).toStrictEqual({ url: '/x' });
    expect(spy.mock.calls[1]![2]).toBe('t9');
  });

  it('M4: no condition keys -> the runtime TypeError -> isError:true "give at least one" (browser never touched)', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const resolve = vi.spyOn(runtime as any, 'resolveTab');
    registerTools(server, { runtime });
    const r = await tools.get('browser.wait_for')!.handler({ sessionId: 's1' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('give at least one');
    expect(resolve).not.toHaveBeenCalled();
    const both = await tools.get('browser.wait_for')!.handler({ sessionId: 's1', text: 'X', textGone: 'X' });
    expect(both.isError).toBe(true);
    expect(both.content[0].text).toContain('can never be satisfied');
  });

  it('M5: wait_for failures get their OWN hints, not the generic "page may still be loading" and not the FR2-01 "element is still visible" one', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const spy = vi.spyOn(runtime, 'waitFor');
    registerTools(server, { runtime });
    const call = async (error: string) => {
      spy.mockResolvedValueOnce({ success: false, actionType: 'wait_for', executionTimeMs: 1, error });
      return JSON.parse((await tools.get('browser.wait_for')!.handler({ sessionId: 's1', text: 'x' })).content[0].text).error as string;
    };
    const timedOut = await call('wait_for timed out after 1500ms waiting for text="x": text "x" was not found in the visible text of 1 frame(s).');
    expect(timedOut).toContain('Hint: The condition never became true');
    expect(timedOut).toContain('browser.snapshot');
    expect(timedOut).not.toContain('page may still be loading');
    // the textGone timeout message contains FR2-01's 'is still visible' fragment: it must NOT get that hint
    const goneStill = await call('wait_for timed out after 1500ms waiting for textGone="Loading": textGone "Loading" is still visible.');
    expect(goneStill).toContain('Hint: The condition never became true');
    expect(goneStill).not.toContain('The element is still visible');
    const threw = await call('wait_for failed: js condition threw after 3ms: Evaluation failed: TypeError: Cannot read properties of undefined');
    expect(threw).toContain('Hint: Guard the expression');
    expect(threw).toContain('?.');
    const dialog = await call('wait_for blocked by an open alert dialog ("hi") after 1003ms — handle it (browser.handle_dialog).');
    expect(dialog).toContain('Hint: Handle the dialog with browser.handle_dialog, then call browser.wait_for again.');
    // wait_for_selector's own hints are untouched
    spy.mockRestore();
    const ws = vi.spyOn(runtime, 'waitForSelector').mockResolvedValue({ success: false, actionType: 'wait_for_selector', executionTimeMs: 1, error: 'wait_for_selector timed out after 500ms' });
    const sel = JSON.parse((await tools.get('browser.wait_for_selector')!.handler({ sessionId: 's1', target: '#t' })).content[0].text).error as string;
    expect(sel).toContain('page may still be loading');
    expect(ws).toHaveBeenCalled();
  });

  it('M6: classification guard: every registered tool is in exactly one list, and `settle` is in the schema iff it is a settle tool', () => {
    const { server, tools } = createMockServer();
    registerTools(server, { runtime: new SutradharRuntime() });
    expect(SETTLE_TOOLS).toHaveLength(25);
    expect(new Set(SETTLE_TOOLS).size).toBe(SETTLE_TOOLS.length);
    expect(new Set(NO_SETTLE_TOOLS).size).toBe(NO_SETTLE_TOOLS.length);
    for (const n of SETTLE_TOOLS) expect(NO_SETTLE_TOOLS, n).not.toContain(n);
    const classified = [...SETTLE_TOOLS, ...NO_SETTLE_TOOLS].sort();
    expect(classified).toEqual([...tools.keys()].sort());
    for (const [name, t] of tools) {
      const has = !!t.config.inputSchema && 'settle' in t.config.inputSchema;
      expect(has, `${name}: settle in schema`).toBe(SETTLE_TOOLS.includes(name));
    }
  });

  // [tool, runtime method, minimal handler args, positional args the runtime got BEFORE FR2-08 (no expect, no settle)]
  const WIRED: Array<[string, string, Record<string, unknown>, number]> = [
    ['browser.navigate', 'navigate', { url: 'https://a.test/' }, 3],
    ['browser.go_back', 'goBack', {}, 2],
    ['browser.go_forward', 'goForward', {}, 2],
    ['browser.reload', 'reload', {}, 2],
    ['browser.click_at_point', 'clickAtPoint', { x: 1, y: 2 }, 5],
    ['browser.drag_at_points', 'dragAtPoints', { fromX: 1, fromY: 2, toX: 3, toY: 4 }, 6],
    ['browser.press_key', 'pressKey', { key: 'a' }, 4],
    ['browser.focus', 'focus', { target: '#a' }, 3],
    ['browser.hover', 'hover', { target: '#a' }, 4],
    ['browser.select_option', 'selectOption', { target: '#a', value: 'v' }, 4],
    ['browser.select_options', 'selectOptions', { target: '#a', values: ['v'] }, 4],
    ['browser.click_by_text', 'clickByText', { text: 'Go' }, 3],
    ['browser.click_by_role', 'clickByRole', { role: 'button' }, 4],
    ['browser.type_by_label', 'typeByLabel', { label: 'L', value: 'v' }, 4],
    ['browser.fill_form', 'fillForm', { fields: { a: '1' } }, 3],
    ['browser.upload_file', 'uploadFile', { target: '#a', filePath: '/x' }, 4],
    ['browser.right_click', 'clickWithButton', { target: '#a' }, 4],
    ['browser.drag_and_drop', 'dragAndDrop', { sourceTarget: '#a', destTarget: '#b' }, 4],
    ['browser.touch_tap', 'touchTap', { target: '#a' }, 3],
    ['browser.download_file', 'downloadFile', { target: '#a' }, 4],
    ['browser.upload_file_via_trigger', 'uploadFileViaTrigger', { target: '#a', filePath: '/x' }, 4],
    ['browser.handle_dialog', 'handleDialog', { action: 'accept' }, 4],
  ];

  it('M7: arity: each newly wired handler passes EXACTLY its pre-FR2-08 argument count without settle, and settle LAST when given', async () => {
    expect(WIRED).toHaveLength(22);
    for (const [tool, method, args, pre] of WIRED) {
      const { server, tools } = createMockServer();
      const runtime = new SutradharRuntime();
      const spy = vi.spyOn(runtime as any, method).mockResolvedValue({ success: true, actionType: 'x', executionTimeMs: 1, tabId: 't', url: 'u', title: 't' });
      registerTools(server, { runtime });
      const h = tools.get(tool)!.handler;
      const hasExpect = !!tools.get(tool)!.config.inputSchema.expect;
      await h({ sessionId: 's1', ...args });
      expect(spy.mock.calls[0], `${tool} without settle`).toHaveLength(pre);
      await h({ sessionId: 's1', ...args, settle: true });
      const withSettle = spy.mock.calls[1]!;
      expect(withSettle[withSettle.length - 1], `${tool}: settle is the last argument`).toBe(true);
      expect(withSettle, `${tool}: length with settle`).toHaveLength(pre + (hasExpect ? 2 : 1));
      // a settle SPEC object is forwarded as-is
      await h({ sessionId: 's1', ...args, settle: { timeoutMs: 1234 } });
      expect(spy.mock.calls[2]![spy.mock.calls[2]!.length - 1]).toEqual({ timeoutMs: 1234 });
      if (hasExpect) {
        await h({ sessionId: 's1', ...args, expect: { text: 'x' }, settle: true });
        const both = spy.mock.calls[3]!;
        expect(both[both.length - 2]).toEqual({ text: 'x' });
        expect(both[both.length - 1]).toBe(true);
        await h({ sessionId: 's1', ...args, expect: { text: 'x' } });
        expect(spy.mock.calls[4], `${tool}: expect only`).toHaveLength(pre + 1);
      }
    }
  });

  it('M7b: the three tools that already had settle keep their exact arities', async () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    const click = vi.spyOn(runtime, 'click').mockResolvedValue({ success: true, actionType: 'click', executionTimeMs: 1 });
    const type = vi.spyOn(runtime, 'type').mockResolvedValue({ success: true, actionType: 'type', executionTimeMs: 1 });
    registerTools(server, { runtime });
    await tools.get('browser.click')!.handler({ sessionId: 's1', target: '#a' });
    expect(click.mock.calls[0]).toHaveLength(6);
    await tools.get('browser.type')!.handler({ sessionId: 's1', target: '#a', value: 'v' });
    expect(type.mock.calls[0]).toHaveLength(5);
  });

  it('M8: the wait_for description states the semantics, the limits, and how it differs from settle/expect/wait_for_selector', () => {
    const { server, tools } = createMockServer();
    registerTools(server, { runtime: new SutradharRuntime() });
    const d: string = tools.get('browser.wait_for')!.config.description;
    for (const needle of [
      'visible', 'ALL', 'EXPRESSION', 'side-effect free', 'background tabs', 'wait_for_selector', 'settle', 'expect',
      'RENDERED', 'never-painted SVG', 'inline-block', '<textarea>', 'never read as "gone"', 'presentAtStart', 'no hidden retries',
      'about 1 s', 'about 2.7 s after it opens', 'exceed timeoutMs by up to about 3 s', 'less than one poll interval',
    ]) {
      expect(d, needle).toContain(needle);
    }
  });

  it('M9: settleDesc ends with the browser.wait_for pointer, on every settle tool', () => {
    const { server, tools } = createMockServer();
    registerTools(server, { runtime: new SutradharRuntime() });
    for (const name of SETTLE_TOOLS) {
      const d: string = tools.get(name)!.config.inputSchema.settle.description;
      expect(d.endsWith('to wait for a specific result, use browser.wait_for.'), name).toBe(true);
    }
    const dlg: string = tools.get('browser.handle_dialog')!.config.description;
    expect(dlg).toContain('Pass settle:true');
  });
});

describe('FR2-11 browser.get_action_history', () => {
  const setup = () => {
    const { server, tools } = createMockServer();
    const runtime = new SutradharRuntime();
    registerTools(server, { runtime });
    return { runtime, tools, tool: tools.get('browser.get_action_history')! };
  };

  it('M1: the schema has sessionId, tabId and scope; scope accepts "tab"/"session" only', () => {
    const { tool } = setup();
    const schema = tool.config.inputSchema;
    expect(Object.keys(schema).sort()).toEqual(['scope', 'sessionId', 'tabId']);
    expect(schema.scope.safeParse('session').success).toBe(true);
    expect(schema.scope.safeParse('tab').success).toBe(true);
    expect(schema.scope.safeParse(undefined).success).toBe(true);
    expect(schema.scope.safeParse('all').success).toBe(false);
  });

  it('M2: default call passes scope/tabId through unchanged and returns the report with NO note', async () => {
    const { runtime, tool } = setup();
    const report = { scope: 'tab', tabId: 't1', entries: [], evicted: 0, capacity: 200 };
    const spy = vi.spyOn(runtime, 'getActionHistoryReport').mockReturnValue(report as any);
    const r = await tool.handler({ sessionId: 's1' });
    expect(spy).toHaveBeenCalledWith('s1', { scope: undefined, tabId: undefined });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text)).toEqual(report);
    expect('note' in JSON.parse(r.content[0].text)).toBe(false);
  });

  it('M3: evicted > 0 adds an exact note (plural and singular)', async () => {
    const { runtime, tool } = setup();
    const spy = vi.spyOn(runtime, 'getActionHistoryReport');
    spy.mockReturnValue({ scope: 'session', entries: [], evicted: 7, capacity: 200 } as any);
    let out = JSON.parse((await tool.handler({ sessionId: 's1', scope: 'session' })).content[0].text);
    expect(out.note).toBe('7 older entries were evicted — only the most recent 200 are kept.');
    expect(out.evicted).toBe(7);
    spy.mockReturnValue({ scope: 'session', entries: [], evicted: 1, capacity: 200 } as any);
    out = JSON.parse((await tool.handler({ sessionId: 's1', scope: 'session' })).content[0].text);
    expect(out.note).toBe('1 older entry was evicted — only the most recent 200 are kept.');
    expect(spy).toHaveBeenLastCalledWith('s1', { scope: 'session', tabId: undefined });
  });

  it('M4: a runtime TypeError surfaces as isError with the message', async () => {
    const { runtime, tool } = setup();
    vi.spyOn(runtime, 'getActionHistoryReport').mockImplementation(() => {
      throw new TypeError('tabId cannot be combined with scope "session"');
    });
    const r = await tool.handler({ sessionId: 's1', scope: 'session', tabId: 't' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('get_action_history failed: tabId cannot be combined');
  });

  it('M5: the description states scope "session", evicted, eval, and the privacy limits', () => {
    const { tool } = setup();
    const d: string = tool.config.description;
    expect(d).toContain('scope "session"');
    expect(d).toContain('evicted');
    expect(d).toContain('eval');
    expect(d).toContain('never stored');
    expect(d).toContain('origin + path only');
    expect(d).toContain('[redacted]'); // fix-1: the rule is stated exactly, not as "query/fragment dropped"
    // fix-2: the character rule is stated verbatim, and the old over-claims are gone
    expect(d).toContain('redacted by CHARACTERS, not by recognising URLs');
    expect(d).toContain('first ? # or ; is replaced by [redacted]');
    expect(d).toContain('= or & is replaced whole');
    expect(d).toContain('last segment');
    expect(d).not.toMatch(/URL queries, fragments, path parameters and userinfo are cut/);
  });

  it('M6: end to end against a real (pageless) runtime session, a navigate is visible with its redacted target and nothing leaks', async () => {
    const { runtime, tool } = setup();
    const { BrowserSession } = await import('@sutradhar/browser');
    const { createSessionId } = await import('@sutradhar/contracts');
    const session = new BrowserSession(createSessionId('s1'));
    vi.spyOn(runtime.getSessionManager(), 'getSession').mockReturnValue(session);
    await session.createTab();
    await runtime.navigate('s1', 'https://a.test/p?token=SECRET-M6#f');
    const out = (await tool.handler({ sessionId: 's1', scope: 'session' })).content[0].text as string;
    expect(out).not.toContain('SECRET-M6');
    const j = JSON.parse(out);
    expect(j.scope).toBe('session');
    expect(j.entries[0]).toMatchObject({ actionType: 'navigate', target: 'https://a.test/p', seq: 1 });
    expect(j.evicted).toBe(0);
    expect(j.capacity).toBe(200);
  });
});
