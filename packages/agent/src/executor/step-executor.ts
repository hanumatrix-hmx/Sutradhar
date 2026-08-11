/**
 * @file packages/agent/src/executor/step-executor.ts
 * @description StepExecutor dispatching browser action commands and recording verified observations.
 */

import { AgentStepDto, AgentId, TaskId } from '@pinchtab/contracts';
import { IBrowserSession } from '@pinchtab/browser';
import { EventBus } from '@pinchtab/events';
import { StructuredLogger } from '@pinchtab/observability';
import { ReflectionEngine } from './reflection-engine.js';

export interface IStepExecutor {
  executeStep(
    agentId: AgentId,
    taskId: TaskId,
    step: AgentStepDto,
    session?: IBrowserSession,
    history?: readonly AgentStepDto[],
  ): Promise<AgentStepDto>;
}

export class StepExecutor implements IStepExecutor {
  private readonly reflectionEngine: ReflectionEngine;
  private readonly eventBus?: EventBus;
  private readonly logger: StructuredLogger;

  public constructor(eventBus?: EventBus, logger?: StructuredLogger) {
    this.reflectionEngine = new ReflectionEngine(logger);
    this.eventBus = eventBus;
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  public async executeStep(
    agentId: AgentId,
    taskId: TaskId,
    step: AgentStepDto,
    session?: IBrowserSession,
    history: readonly AgentStepDto[] = [],
  ): Promise<AgentStepDto> {
    this.logger.info(
      `[StepExecutor] Executing step ${step.stepNumber} (${step.actionName}) for agent ${agentId}`,
    );

    let observation = `Action ${step.actionName} executed`;
    const activeTab = session?.getTabs().find((t) => t.isActive);

    if (activeTab) {
      const actionResult = await activeTab.executeAction({
        type: step.actionName === 'click' ? 'click' : 'navigate',
        url:
          typeof step.actionPayload === 'object' &&
          step.actionPayload !== null &&
          'url' in step.actionPayload
            ? String((step.actionPayload as Record<string, unknown>).url)
            : undefined,
      });

      observation = actionResult.success
        ? `Browser action ${step.actionName} succeeded on ${activeTab.url}`
        : `Browser action ${step.actionName} failed: ${actionResult.error ?? 'Unknown error'}`;
    }

    const executedStep: AgentStepDto = {
      ...step,
      observation,
      isVerified: true,
      timestamp: new Date().toISOString(),
    };

    // Reflection evaluation
    const reflection = this.reflectionEngine.evaluateStep(executedStep, history);

    if (this.eventBus) {
      await this.eventBus.publish(
        'agent:step:executed',
        {
          agentId,
          taskId,
          stepId: step.id,
          action: step.actionName,
          result: observation,
          success: reflection.isSuccessful,
        },
        `corr_${step.id}`,
      );
    }

    return {
      ...executedStep,
      isVerified: reflection.isSuccessful,
    };
  }
}
