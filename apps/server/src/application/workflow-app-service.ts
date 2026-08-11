/**
 * @file apps/server/src/application/workflow-app-service.ts
 * @description Application service for multi-agent DAG workflow orchestration use cases.
 */

import { createWorkflowId } from '@pinchtab/contracts';
import {
  WorkflowRunner,
  WorkflowGraph,
  WorkflowNodeDto,
  WorkflowExecutionResultDto,
} from '@pinchtab/workflow';
import { StructuredLogger } from '@pinchtab/observability';

export interface ExecuteWorkflowCommand {
  readonly name?: string;
  readonly nodes: readonly WorkflowNodeDto[];
  readonly initialInputs?: Record<string, unknown>;
}

export class WorkflowApplicationService {
  private readonly workflowRunner: WorkflowRunner;
  private readonly logger: StructuredLogger;

  public constructor(workflowRunner: WorkflowRunner, logger?: StructuredLogger) {
    this.workflowRunner = workflowRunner;
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  public async executeWorkflow(
    command: ExecuteWorkflowCommand,
  ): Promise<WorkflowExecutionResultDto> {
    this.logger.info('[WorkflowApplicationService] Executing workflow use case', {
      name: command.name,
      nodeCount: command.nodes.length,
    });

    const workflowId = createWorkflowId(`wf_${Date.now()}`);
    const graph = new WorkflowGraph(workflowId, command.name ?? 'Autonomous Workflow');

    for (const node of command.nodes) {
      graph.addNode(node);
    }

    return this.workflowRunner.runWorkflow(graph, command.initialInputs);
  }
}
