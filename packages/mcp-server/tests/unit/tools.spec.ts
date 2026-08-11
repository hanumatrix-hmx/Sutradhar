/**
 * @file packages/mcp-server/tests/unit/tools.spec.ts
 * @description Unit tests for registerTools — the full MCP tool surface, the isError
 * contract every tool handler must honor, and the agent.runGoal conditional registration.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SutradharRuntime } from '@sutradhar/capability-runtime';
import { registerTools } from '../../src/tools.js';

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
