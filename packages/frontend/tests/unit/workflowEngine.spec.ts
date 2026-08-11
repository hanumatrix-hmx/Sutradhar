/**
 * @file packages/frontend/tests/unit/workflowEngine.spec.ts
 * @description Unit test suite for Frontend Milestone 7 Workflow Engine.
 */

import { describe, it, expect } from 'vitest';
import {
  Workflow,
  WorkflowNode,
  WorkflowExecutor,
  VariableStore,
  WorkflowContext,
  WorkflowRegistry,
  WorkflowPersistence,
} from '../../src/runtime/workflow/index.js';
import { ActionExecutor, DefaultActionLogger } from '../../src/runtime/actions/index.js';
import { BrowserRuntime } from '../../src/runtime/browser/browserRuntime.js';
import { MockBrowserAdapter } from '../_mocks/MockBrowserAdapter.js';

describe('@pinchtab/frontend Milestone 7 — Workflow Engine', () => {
  const adapter = new MockBrowserAdapter();
  const runtime = new BrowserRuntime('sess_wf_test', adapter);
  const actionExecutor = new ActionExecutor();

  const createTestContext = (vars: Record<string, unknown> = {}): WorkflowContext => {
    const logger = new DefaultActionLogger();
    return {
      sessionId: 'sess_wf_test',
      workflowId: 'wf_test_1',
      actionExecutor,
      variableStore: new VariableStore(vars),
      actionContext: {
        sessionId: 'sess_wf_test',
        browserRuntime: runtime,
        browserAdapter: adapter,
        logger,
        variables: {},
        environment: {},
      },
    };
  };

  it('1. should construct, serialize, and deserialize a Workflow graph', () => {
    const wf = new Workflow({ id: 'wf_graph_1', name: 'Sample Web Scraping Graph' });
    const node1 = new WorkflowNode({
      id: 'n1',
      name: 'Open Page',
      type: 'action',
      data: { actionType: 'Navigate', actionInput: { url: 'https://github.com' } },
    });
    const node2 = new WorkflowNode({
      id: 'n2',
      name: 'Extract DOM',
      type: 'action',
      data: { actionType: 'ExtractDOM' },
    });
    node1.nextId = 'n2';

    wf.addNode(node1);
    wf.addNode(node2);

    expect(wf.validate().valid).toBe(true);

    const snap = wf.createSnapshot('n1', { targetUrl: 'https://github.com' });
    expect(snap.nodes.length).toBe(2);

    const restoredWf = Workflow.fromSnapshot(snap);
    expect(restoredWf.id).toBe('wf_graph_1');
    expect(restoredWf.getNode('n1')?.name).toBe('Open Page');
  });

  it('2. should execute a sequential workflow of Browser Actions', async () => {
    await runtime.launch();
    const wf = new Workflow({ id: 'wf_seq', name: 'Sequential Search' });
    const node1 = new WorkflowNode({
      id: 'n1',
      name: 'Navigate to Google',
      type: 'action',
      nextId: 'n2',
      data: { actionType: 'Navigate', actionInput: { url: 'https://google.com' } },
    });
    const node2 = new WorkflowNode({
      id: 'n2',
      name: 'Take Screenshot',
      type: 'action',
      data: { actionType: 'CaptureScreenshot' },
    });

    wf.addNode(node1);
    wf.addNode(node2);

    const executor = new WorkflowExecutor();
    const context = createTestContext();

    const result = await executor.execute(wf, context);
    expect(result.status).toBe('completed');
    expect(result.nodeResults['n1']).toEqual({ url: 'https://google.com', title: 'Google Search' });
    expect(result.nodeResults['n2']).toBeDefined();
  });

  it('3. should evaluate conditional branches correctly', async () => {
    const wf = new Workflow({ id: 'wf_cond', name: 'Conditional Branching' });

    const condNode = new WorkflowNode({
      id: 'cond_1',
      name: 'Check Target URL',
      type: 'condition',
      nextId: 'true_branch',
      elseId: 'false_branch',
      data: { conditionExpression: 'vars.shouldRun === true' },
    });

    const trueNode = new WorkflowNode({
      id: 'true_branch',
      name: 'True Path Action',
      type: 'action',
      data: { actionType: 'Navigate', actionInput: { url: 'https://github.com' } },
    });

    const falseNode = new WorkflowNode({
      id: 'false_branch',
      name: 'False Path Action',
      type: 'action',
      data: { actionType: 'Navigate', actionInput: { url: 'https://google.com' } },
    });

    wf.addNode(condNode);
    wf.addNode(trueNode);
    wf.addNode(falseNode);

    const executor = new WorkflowExecutor();

    // Test True path
    const trueContext = createTestContext({ shouldRun: true });
    const trueResult = await executor.execute(wf, trueContext);
    expect(trueResult.status).toBe('completed');
    expect(trueResult.nodeResults['true_branch']).toBeDefined();
    expect(trueResult.nodeResults['false_branch']).toBeUndefined();
  });

  it('4. should pause on Approval Gate node and resume', async () => {
    const wf = new Workflow({ id: 'wf_approval', name: 'Approval Flow' });

    const navNode = new WorkflowNode({
      id: 'n1',
      name: 'Open Checkout',
      type: 'action',
      nextId: 'appr_1',
      data: { actionType: 'Navigate', actionInput: { url: 'https://shop.com/checkout' } },
    });

    const approvalNode = new WorkflowNode({
      id: 'appr_1',
      name: 'Human Payment Confirmation',
      type: 'approval',
      nextId: 'n2',
      data: { approvalDescription: 'Confirm payment of $50' },
    });

    const submitNode = new WorkflowNode({
      id: 'n2',
      name: 'Submit Order',
      type: 'action',
      data: { actionType: 'ClickElement', actionInput: { selector: '#submit' } },
    });

    wf.addNode(navNode);
    wf.addNode(approvalNode);
    wf.addNode(submitNode);

    const executor = new WorkflowExecutor();
    const context = createTestContext();

    // Initial execution pauses at approval gate
    const pauseResult = await executor.execute(wf, context);
    expect(pauseResult.status).toBe('paused');
    expect(wf.status).toBe('paused');

    // Resume execution from approval node's next target (n2)
    const resumeResult = await executor.resume(wf, context, 'n2');
    expect(resumeResult.status).toBe('completed');
    expect(resumeResult.nodeResults['n2']).toBeDefined();
  });

  it('5. should execute parallel branch nodes', async () => {
    const wf = new Workflow({ id: 'wf_parallel', name: 'Parallel Execution' });

    const b1 = new WorkflowNode({
      id: 'b1',
      name: 'Branch 1',
      type: 'action',
      data: { actionType: 'Navigate', actionInput: { url: 'https://google.com' } },
    });
    const b2 = new WorkflowNode({
      id: 'b2',
      name: 'Branch 2',
      type: 'action',
      data: { actionType: 'Navigate', actionInput: { url: 'https://github.com' } },
    });

    const parallelNode = new WorkflowNode({
      id: 'p1',
      name: 'Parallel Fetch',
      type: 'parallel',
      data: { parallelBranchIds: ['b1', 'b2'] },
    });

    wf.addNode(parallelNode);
    wf.addNode(b1);
    wf.addNode(b2);

    const executor = new WorkflowExecutor();
    const result = await executor.execute(wf, createTestContext());
    expect(result.status).toBe('completed');
    expect((result.nodeResults['p1'] as unknown[]).length).toBe(2);
  });

  it('6. should persist and restore workflow snapshots', () => {
    const wf = new Workflow({ id: 'wf_persist', name: 'Persist Test' });
    wf.addNode(
      new WorkflowNode({ id: 'n1', name: 'Step 1', type: 'delay', data: { delayMs: 10 } }),
    );

    const snap = wf.createSnapshot('n1', { val: 42 });
    WorkflowPersistence.saveSnapshot('sess_test', snap);

    const loaded = WorkflowPersistence.loadSnapshot('sess_test', 'wf_persist');
    expect(loaded?.id).toBe('wf_persist');
    expect(loaded?.variables['val']).toBe(42);

    WorkflowPersistence.clearSnapshot('sess_test', 'wf_persist');
  });

  it('7. should register and discover workflow graph templates in WorkflowRegistry', () => {
    const registry = WorkflowRegistry.getInstance();
    registry.register(
      'template_1',
      () => new Workflow({ id: 'tmpl_1', name: 'Template Workflow' }),
    );

    expect(registry.list()).toContain('template_1');
    const factory = registry.lookup('template_1');
    expect(factory!().name).toBe('Template Workflow');
  });
});
