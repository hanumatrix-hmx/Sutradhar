/**
 * @file packages/workflow/src/runner/workflow-runner.ts
 * @description WorkflowRunner service executing DAG node graphs, handling state transitions, and event publishing.
 */

import { EventBus } from '@sutradhar/events';
import { StructuredLogger } from '@sutradhar/observability';
import { IAgentCore, AgentCore } from '@sutradhar/agent';
import { WorkflowGraph } from '../graph/workflow-graph.js';
import { WorkflowNodeDto } from '../graph/workflow-node.js';
import { WorkflowExecutionResultDto, WorkflowRunnerOptions } from './workflow-runner-options.js';

export interface IWorkflowRunner {
  runWorkflow(
    graph: WorkflowGraph,
    initialInputs?: Record<string, unknown>,
  ): Promise<WorkflowExecutionResultDto>;
}

export class WorkflowRunner implements IWorkflowRunner {
  private readonly agentCore: IAgentCore;
  private readonly eventBus?: EventBus;
  private readonly logger: StructuredLogger;

  public constructor(options: WorkflowRunnerOptions = {}) {
    this.agentCore = options.agentCore ?? new AgentCore();
    this.eventBus = options.eventBus;
    this.logger = options.logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  public async runWorkflow(
    graph: WorkflowGraph,
    initialInputs: Record<string, unknown> = {},
  ): Promise<WorkflowExecutionResultDto> {
    const startTime = Date.now();
    const executionId = `exec_${graph.id}_${Date.now()}`;

    this.logger.info(`[WorkflowRunner] Starting workflow execution ${executionId} for ${graph.id}`);

    const validation = graph.validate();
    if (!validation.isValid) {
      const errorMsg = `Invalid workflow graph topology: ${validation.errors.join('; ')}`;
      this.logger.error(`[WorkflowRunner] ${errorMsg}`);
      return {
        executionId,
        workflowId: graph.id,
        state: 'failed',
        executedNodes: [],
        nodeOutputs: {},
        durationMs: Date.now() - startTime,
        error: errorMsg,
      };
    }

    if (this.eventBus) {
      await this.eventBus.publish(
        'workflow:execution:started',
        {
          workflowId: graph.id,
          executionId,
          timestamp: new Date().toISOString(),
        },
        `corr_${executionId}`,
      );
    }

    const executedNodes: string[] = [];
    const nodeOutputs: Record<string, unknown> = { ...initialInputs };

    let currentNode: WorkflowNodeDto | undefined = graph.getStartNode();

    try {
      while (currentNode) {
        executedNodes.push(currentNode.id);
        this.logger.debug(
          `[WorkflowRunner] Executing node ${currentNode.id} (${currentNode.type})`,
        );

        if (currentNode.type === 'task') {
          const actionGoal = currentNode.name || 'Execute workflow node task';
          const goalResult = await this.agentCore.executeGoal(actionGoal);
          nodeOutputs[currentNode.id] = {
            status: goalResult.status,
            goalId: goalResult.id,
          };
        } else {
          nodeOutputs[currentNode.id] = { status: 'passed' };
        }

        if (
          currentNode.type === 'end' ||
          !currentNode.nextNodes ||
          currentNode.nextNodes.length === 0
        ) {
          break;
        }

        // Advance to next node in DAG chain
        const nextId = currentNode.nextNodes[0];
        currentNode = nextId ? graph.getNode(nextId) : undefined;
      }

      const result: WorkflowExecutionResultDto = {
        executionId,
        workflowId: graph.id,
        state: 'completed',
        executedNodes,
        nodeOutputs,
        durationMs: Date.now() - startTime,
      };

      if (this.eventBus) {
        await this.eventBus.publish(
          'workflow:execution:completed',
          {
            workflowId: graph.id,
            executionId,
            durationMs: result.durationMs,
          },
          `corr_${executionId}`,
        );
      }

      return result;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`[WorkflowRunner] Execution ${executionId} failed: ${errorMessage}`);

      if (this.eventBus) {
        await this.eventBus.publish(
          'workflow:execution:failed',
          {
            workflowId: graph.id,
            executionId,
            error: errorMessage,
          },
          `corr_${executionId}`,
        );
      }

      return {
        executionId,
        workflowId: graph.id,
        state: 'failed',
        executedNodes,
        nodeOutputs,
        durationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }
}
