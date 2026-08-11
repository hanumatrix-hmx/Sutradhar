/**
 * @file packages/frontend/src/runtime/workflow/workflowExecutor.ts
 * @description WorkflowExecutor engine orchestrating execution graph traversal.
 */

import { Workflow, WorkflowNode } from './workflowGraph.js';
import { WorkflowContext } from './workflowContext.js';
import { WorkflowResult, WorkflowLifecycleEvent } from './workflowTypes.js';
import { ActionRegistry } from '../actions/actionRegistry.js';

export type WorkflowLifecycleListener = (event: WorkflowLifecycleEvent) => void;

export class WorkflowExecutor {
  private readonly listeners = new Set<WorkflowLifecycleListener>();

  public onEvent(listener: WorkflowLifecycleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: WorkflowLifecycleEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener failures
      }
    }
  }

  public async execute(
    workflow: Workflow,
    context: WorkflowContext,
    startFromNodeId?: string,
  ): Promise<WorkflowResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const nodeResults: Record<string, unknown> = {};

    const validation = workflow.validate();
    if (!validation.valid) {
      return {
        workflowId: workflow.id,
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        nodeResults: {},
        variables: context.variableStore.toObject(),
        error: validation.reason,
      };
    }

    workflow.status = 'running';
    this.emit({
      type: 'WorkflowStarted',
      workflowId: workflow.id,
      sessionId: context.sessionId,
      timestamp: startedAt,
    });

    let currentNodeId: string | null = startFromNodeId || workflow.startNodeId;

    while (currentNodeId) {
      if (context.cancellationToken?.isCancelled) {
        workflow.status = 'cancelled';
        const finishedAt = new Date().toISOString();
        this.emit({
          type: 'WorkflowCancelled',
          workflowId: workflow.id,
          sessionId: context.sessionId,
          timestamp: finishedAt,
        });

        return {
          workflowId: workflow.id,
          status: 'cancelled',
          startedAt,
          finishedAt,
          durationMs: Date.now() - startTime,
          nodeResults,
          variables: context.variableStore.toObject(),
          error: 'Workflow cancelled by user',
        };
      }

      const node: WorkflowNode | undefined = workflow.getNode(currentNodeId);
      if (!node) break;

      node.status = 'running';
      this.emit({
        type: 'NodeStarted',
        workflowId: workflow.id,
        sessionId: context.sessionId,
        nodeId: node.id,
        timestamp: new Date().toISOString(),
      });

      try {
        let nextNodeIdOverride: string | undefined = undefined;

        switch (node.type) {
          case 'action': {
            if (!node.data.actionType) throw new Error(`Node ${node.id} missing actionType`);
            const rawInput = node.data.actionInput || {};
            const interpolatedInput = context.variableStore.interpolate(rawInput);
            const action = ActionRegistry.getInstance().instantiate(
              node.data.actionType,
              interpolatedInput,
            );
            const actionRes = await context.actionExecutor.execute(action, context.actionContext);

            if (!actionRes.success) {
              throw new Error(actionRes.error?.message || `Action ${node.data.actionType} failed`);
            }

            nodeResults[node.id] = actionRes.output;
            if (actionRes.output && typeof actionRes.output === 'object') {
              context.variableStore.set(`nodes.${node.id}`, actionRes.output);
            }
            break;
          }

          case 'condition': {
            const expr = node.data.conditionExpression || 'false';
            const condResult = context.variableStore.evaluateCondition(expr);
            nodeResults[node.id] = condResult;
            nextNodeIdOverride = condResult ? node.nextId : node.elseId;
            break;
          }

          case 'delay': {
            const delayMs = node.data.delayMs || 100;
            await new Promise((r) => setTimeout(r, Math.min(delayMs, 500)));
            nodeResults[node.id] = { delayedMs: delayMs };
            break;
          }

          case 'approval': {
            workflow.status = 'paused';
            node.status = 'pending';
            this.emit({
              type: 'WorkflowPaused',
              workflowId: workflow.id,
              sessionId: context.sessionId,
              nodeId: node.id,
              timestamp: new Date().toISOString(),
              payload: {
                reason: 'Human approval required',
                description: node.data.approvalDescription,
              },
            });

            return {
              workflowId: workflow.id,
              status: 'paused',
              startedAt,
              finishedAt: new Date().toISOString(),
              durationMs: Date.now() - startTime,
              nodeResults,
              variables: context.variableStore.toObject(),
            };
          }

          case 'parallel': {
            const branchIds = node.data.parallelBranchIds || [];
            const branchPromises = branchIds.map(async (bId) => {
              const bNode = workflow.getNode(bId);
              if (bNode && bNode.data.actionType) {
                const action = ActionRegistry.getInstance().instantiate(
                  bNode.data.actionType,
                  bNode.data.actionInput || {},
                );
                return context.actionExecutor.execute(action, context.actionContext);
              }
              return null;
            });
            const parallelResults = await Promise.all(branchPromises);
            nodeResults[node.id] = parallelResults;
            break;
          }

          case 'loop': {
            const itemsVarName = node.data.loopItemsVariable || 'items';
            const items = (context.variableStore.get(itemsVarName) as unknown[]) || [];
            const alias = node.data.loopItemAlias || 'item';
            const loopOutputs: unknown[] = [];

            for (const item of items) {
              context.variableStore.set(alias, item);
              if (node.data.actionType) {
                const action = ActionRegistry.getInstance().instantiate(
                  node.data.actionType,
                  context.variableStore.interpolate(node.data.actionInput || {}),
                );
                const res = await context.actionExecutor.execute(action, context.actionContext);
                loopOutputs.push(res.output);
              }
            }
            nodeResults[node.id] = loopOutputs;
            break;
          }

          default:
            nodeResults[node.id] = { executed: true };
        }

        node.status = 'completed';
        this.emit({
          type: 'NodeCompleted',
          workflowId: workflow.id,
          sessionId: context.sessionId,
          nodeId: node.id,
          timestamp: new Date().toISOString(),
        });

        currentNodeId = nextNodeIdOverride !== undefined ? nextNodeIdOverride : node.nextId || null;
      } catch (err) {
        node.status = 'failed';
        node.error = (err as Error).message;
        workflow.status = 'failed';

        const finishedAt = new Date().toISOString();
        this.emit({
          type: 'NodeFailed',
          workflowId: workflow.id,
          sessionId: context.sessionId,
          nodeId: node.id,
          timestamp: finishedAt,
          payload: { error: node.error },
        });

        return {
          workflowId: workflow.id,
          status: 'failed',
          startedAt,
          finishedAt,
          durationMs: Date.now() - startTime,
          nodeResults,
          variables: context.variableStore.toObject(),
          error: node.error,
        };
      }
    }

    workflow.status = 'completed';
    const finishedAt = new Date().toISOString();
    this.emit({
      type: 'WorkflowCompleted',
      workflowId: workflow.id,
      sessionId: context.sessionId,
      timestamp: finishedAt,
    });

    return {
      workflowId: workflow.id,
      status: 'completed',
      startedAt,
      finishedAt,
      durationMs: Date.now() - startTime,
      nodeResults,
      variables: context.variableStore.toObject(),
    };
  }

  public resume(
    workflow: Workflow,
    context: WorkflowContext,
    fromNodeId: string,
  ): Promise<WorkflowResult> {
    workflow.status = 'running';
    this.emit({
      type: 'WorkflowResumed',
      workflowId: workflow.id,
      sessionId: context.sessionId,
      timestamp: new Date().toISOString(),
    });
    return this.execute(workflow, context, fromNodeId);
  }
}
