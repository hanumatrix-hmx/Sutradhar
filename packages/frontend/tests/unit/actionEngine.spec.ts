/**
 * @file packages/frontend/tests/unit/actionEngine.spec.ts
 * @description Unit test suite for Frontend Milestone 6 Browser Action Engine.
 */

import { describe, it, expect } from 'vitest';
import {
  ActionExecutor,
  ActionRegistry,
  ActionHistory,
  DefaultActionLogger,
  SimpleCancellationToken,
  NavigateAction,
  CreateTabAction,
  CloseTabAction,
  FocusTabAction,
  ReloadAction,
  BackAction,
  ForwardAction,
  ClickElementAction,
  TypeTextAction,
  HoverElementAction,
  ScrollAction,
  ExtractDOMAction,
  CaptureScreenshotAction,
  ExecuteJavaScriptAction,
  WaitAction,
  DownloadFileAction,
  UploadFileAction,
} from '../../src/runtime/actions/index.js';
import { BrowserRuntime } from '../../src/runtime/browser/browserRuntime.js';
import { MockBrowserAdapter } from '../_mocks/MockBrowserAdapter.js';
import { ActionContext } from '../../src/runtime/actions/actionContext.js';

describe('@pinchtab/frontend Milestone 6 — Browser Action Engine', () => {
  const adapter = new MockBrowserAdapter();
  const runtime = new BrowserRuntime('sess_act_test', adapter);

  const context: ActionContext = {
    sessionId: 'sess_act_test',
    browserRuntime: runtime,
    browserAdapter: adapter,
    logger: new DefaultActionLogger(),
    variables: {},
    environment: {},
  };

  it('1. should register and discover all 17 concrete action types in ActionRegistry', () => {
    const registry = ActionRegistry.getInstance();
    const actions = registry.discover();
    expect(actions.length).toBe(17);

    const navActions = registry.discover('navigation');
    expect(navActions.length).toBe(7);

    const navInstance = registry.instantiate('Navigate', { url: 'https://github.com' });
    expect(navInstance).toBeInstanceOf(NavigateAction);
  });

  it('2. should execute NavigateAction and return ActionResult with artifacts and logs', async () => {
    await runtime.launch();
    const executor = new ActionExecutor();
    const action = new NavigateAction({ url: 'https://google.com' });

    const result = await executor.execute(action, context);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ url: 'https://google.com', title: 'Google Search' });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('3. should handle retry policies on failed action attempts', async () => {
    const executor = new ActionExecutor();
    let retryEventsCount = 0;

    executor.onEvent((e) => {
      if (e.type === 'ActionRetried') retryEventsCount++;
    });

    const failingAction = new NavigateAction({ url: '' }); // Invalid URL
    failingAction.retryPolicy = { strategy: 'FixedRetry', maxAttempts: 2, initialDelayMs: 10 };

    const result = await executor.execute(failingAction, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VALIDATION_FAILED');
  });

  it('4. should handle cancellation via CancellationToken', async () => {
    const executor = new ActionExecutor();
    const token = new SimpleCancellationToken();
    token.cancel();

    const cancelContext: ActionContext = { ...context, cancellationToken: token };
    const action = new WaitAction({ durationMs: 100 });

    const result = await executor.execute(action, cancelContext);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ACTION_CANCELLED');
  });

  it('5. should execute all remaining interaction, data, and file actions cleanly', async () => {
    const executor = new ActionExecutor();

    const createTabRes = await executor.execute(
      new CreateTabAction({ url: 'https://vitejs.dev' }),
      context,
    );
    expect(createTabRes.success).toBe(true);

    const focusTabRes = await executor.execute(
      new FocusTabAction({ tabId: createTabRes.output!.id }),
      context,
    );
    expect(focusTabRes.success).toBe(true);

    const clickRes = await executor.execute(
      new ClickElementAction({ selector: '#submit-btn' }),
      context,
    );
    expect(clickRes.success).toBe(true);

    const typeRes = await executor.execute(
      new TypeTextAction({ selector: 'input[name="q"]', text: 'PinchTab' }),
      context,
    );
    expect(typeRes.success).toBe(true);

    const hoverRes = await executor.execute(
      new HoverElementAction({ selector: '.menu-item' }),
      context,
    );
    expect(hoverRes.success).toBe(true);

    const scrollRes = await executor.execute(
      new ScrollAction({ direction: 'down', amountPx: 500 }),
      context,
    );
    expect(scrollRes.success).toBe(true);

    const extractDomRes = await executor.execute(new ExtractDOMAction(), context);
    expect(extractDomRes.success).toBe(true);
    expect(extractDomRes.artifacts.length).toBe(1);

    const screenshotRes = await executor.execute(new CaptureScreenshotAction(), context);
    expect(screenshotRes.success).toBe(true);
    expect(screenshotRes.artifacts[0]?.type).toBe('screenshot');

    const evalJsRes = await executor.execute(
      new ExecuteJavaScriptAction({ script: 'window.title' }),
      context,
    );
    expect(evalJsRes.success).toBe(true);

    const waitRes = await executor.execute(new WaitAction({ durationMs: 10 }), context);
    expect(waitRes.success).toBe(true);

    const downloadRes = await executor.execute(
      new DownloadFileAction({ url: 'https://example.com/report.pdf' }),
      context,
    );
    expect(downloadRes.success).toBe(true);

    const uploadRes = await executor.execute(
      new UploadFileAction({ selector: 'input[type="file"]', filePath: '/tmp/doc.txt' }),
      context,
    );
    expect(uploadRes.success).toBe(true);

    const closeTabRes = await executor.execute(
      new CloseTabAction({ tabId: createTabRes.output!.id }),
      context,
    );
    expect(closeTabRes.success).toBe(true);
  });

  it('6. should store execution results in ActionHistory', () => {
    const history = new ActionHistory('sess_history_test');
    const dummyResult = {
      actionId: 'act_1',
      actionType: 'Navigate',
      success: true,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 12,
      logs: [],
      artifacts: [],
      metadata: {},
      warnings: [],
    };

    history.record(dummyResult);
    expect(history.getHistory().length).toBe(1);
    expect(history.getSuccessful().length).toBe(1);
  });
});
