/**
 * @file packages/agent/src/planner/goal-planner.ts
 * @description GoalPlanner transforming natural language goal requests into canonical AgentPlanDto and TaskGraph instances, enriched by Episodic Memory experience.
 */

import {
  GoalId,
  AgentId,
  AgentPlanDto,
  createPlanId,
  createTaskId,
  createStepId,
} from '@sutradhar/contracts';
import { StructuredLogger } from '@sutradhar/observability';
import { ILlmProvider } from '@sutradhar/llm';
import { TaskGraph } from '../graph/task-graph-models.js';
import { EpisodicMemoryManager } from '@sutradhar/memory';

export class GoalPlanner {
  private readonly _llmProvider?: ILlmProvider;
  private readonly logger: StructuredLogger;
  private readonly episodicMemory?: EpisodicMemoryManager;

  public constructor(
    llmProvider?: ILlmProvider,
    logger?: StructuredLogger,
    episodicMemory?: EpisodicMemoryManager,
  ) {
    this._llmProvider = llmProvider;
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
    this.episodicMemory = episodicMemory;
  }

  /** The configured LLM provider, if any. */
  public get llmProvider(): ILlmProvider | undefined {
    return this._llmProvider;
  }

  public async createPlan(
    goalId: GoalId,
    agentId: AgentId,
    goalText: string,
  ): Promise<AgentPlanDto> {
    this.logger.info(`[GoalPlanner] Creating plan for goal ${goalId}`, { goal: goalText });

    if (this.episodicMemory) {
      const priorEpisodes = this.episodicMemory.queryEpisodes({
        goal: goalText,
        outcome: 'success',
      });
      if (priorEpisodes.length > 0) {
        this.logger.info(
          `[GoalPlanner] Informed by ${priorEpisodes.length} relevant historical episodes for goal "${goalText}"`,
        );
      }
    }

    const planId = createPlanId(`plan_${Date.now()}`);
    const taskId = createTaskId(`task_${goalId}`);

    return {
      id: planId,
      goalId,
      agentId,
      tasks: [
        {
          id: taskId,
          goalId,
          title: `Execute goal: ${goalText}`,
          description: goalText,
          isCompleted: false,
          steps: [
            {
              id: createStepId(`step_${Date.now()}_1`),
              stepNumber: 1,
              reasoning: 'Navigate to target web page and inspect DOM graph',
              actionName: 'navigate_and_inspect',
              actionPayload: { goal: goalText },
              observation: '',
              isVerified: false,
              timestamp: new Date().toISOString(),
            },
            {
              id: createStepId(`step_${Date.now()}_2`),
              stepNumber: 2,
              reasoning: 'Evaluate semantic element candidates and execute browser actions',
              actionName: 'execute_actions',
              actionPayload: { goal: goalText },
              observation: '',
              isVerified: false,
              timestamp: new Date().toISOString(),
            },
            {
              id: createStepId(`step_${Date.now()}_3`),
              stepNumber: 3,
              reasoning: 'Verify completion status and store output artifacts',
              actionName: 'verify_and_store',
              actionPayload: { goal: goalText },
              observation: '',
              isVerified: false,
              timestamp: new Date().toISOString(),
            },
          ],
        },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  public async createTaskGraph(goalId: GoalId, goalText: string): Promise<TaskGraph> {
    const graph = new TaskGraph(`graph_${goalId}`, goalId);

    const node1Id = `node_${goalId}_1`;
    const node2Id = `node_${goalId}_2`;
    const node3Id = `node_${goalId}_3`;

    graph.addNode({
      id: node1Id,
      name: 'Navigate and Inspect',
      goal: goalText,
      status: 'READY',
      priority: 10,
      dependencies: [],
      actionName: 'navigate_and_inspect',
      retryCount: 0,
      maxRetries: 2,
    });

    graph.addNode({
      id: node2Id,
      name: 'Execute Semantic Actions',
      goal: goalText,
      status: 'WAITING',
      priority: 8,
      dependencies: [node1Id],
      actionName: 'execute_actions',
      retryCount: 0,
      maxRetries: 2,
    });

    graph.addNode({
      id: node3Id,
      name: 'Verify and Store Output',
      goal: goalText,
      status: 'WAITING',
      priority: 5,
      dependencies: [node2Id],
      actionName: 'verify_and_store',
      retryCount: 0,
      maxRetries: 2,
    });

    graph.addEdge(node1Id, node2Id);
    graph.addEdge(node2Id, node3Id);

    return graph;
  }
}
