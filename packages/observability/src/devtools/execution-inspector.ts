/**
 * @file packages/observability/src/devtools/execution-inspector.ts
 * @description ExecutionInspector capturing telemetry and emitting DevTools inspection models.
 */

import {
  TimelineStageNode,
  GoalInspection,
  PlannerInspection,
  TaskGraphNodeView,
  PageInspection,
  SemanticCandidateView,
  DecisionInspection,
  RecoveryInspection,
  MemoryInspection,
  RuntimeServiceInspection,
  FullTraceExport,
} from './devtools-models.js';

export class ExecutionInspector {
  private readonly timeline: TimelineStageNode[] = [];
  private currentGoal?: GoalInspection;
  private currentPlanner?: PlannerInspection;
  private currentTaskNodes: TaskGraphNodeView[] = [];
  private currentPage?: PageInspection;
  private currentCandidates: SemanticCandidateView[] = [];
  private currentDecision?: DecisionInspection;
  private currentRecovery?: RecoveryInspection;
  private currentMemory?: MemoryInspection;
  private currentRuntimeServices: RuntimeServiceInspection[] = [];

  public recordStage(stage: TimelineStageNode): void {
    this.timeline.push(stage);
  }

  public setGoalInspection(goal: GoalInspection): void {
    this.currentGoal = goal;
  }

  public setPlannerInspection(planner: PlannerInspection): void {
    this.currentPlanner = planner;
  }

  public setTaskNodes(nodes: readonly TaskGraphNodeView[]): void {
    this.currentTaskNodes = [...nodes];
  }

  public setPageInspection(page: PageInspection): void {
    this.currentPage = page;
  }

  public setCandidates(candidates: readonly SemanticCandidateView[]): void {
    this.currentCandidates = [...candidates];
  }

  public setDecisionInspection(decision: DecisionInspection): void {
    this.currentDecision = decision;
  }

  public setRecoveryInspection(recovery: RecoveryInspection): void {
    this.currentRecovery = recovery;
  }

  public setMemoryInspection(memory: MemoryInspection): void {
    this.currentMemory = memory;
  }

  public setRuntimeServices(services: readonly RuntimeServiceInspection[]): void {
    this.currentRuntimeServices = [...services];
  }

  public getTimeline(): readonly TimelineStageNode[] {
    return this.timeline;
  }

  public generateFullExport(): FullTraceExport {
    return {
      exportTimestamp: new Date().toISOString(),
      goal: this.currentGoal ?? {
        goalId: 'goal_default',
        text: 'Default Goal',
        priority: 1,
        status: 'COMPLETED',
        childGoalIds: [],
        durationMs: 450,
      },
      timeline: this.timeline,
      planner: this.currentPlanner ?? {
        reasoning: 'Constructed execution plan',
        planId: 'plan_default',
        tasksCount: 1,
        stepsCount: 3,
        latencyMs: 25,
      },
      taskGraphNodes: this.currentTaskNodes,
      page: this.currentPage ?? {
        pageType: 'Unknown',
        primaryIntent: 'General Browsing',
        regionsCount: 2,
        formsCount: 1,
        navigationCount: 1,
        confidence: 0.9,
      },
      candidates: this.currentCandidates,
      decision: this.currentDecision ?? {
        recommendation: 'EXECUTE',
        confidence: 0.94,
        positiveFactorsCount: 4,
        penaltiesCount: 0,
        explanation: 'Decision Evidence Engine recommendation: EXECUTE',
      },
      recovery: this.currentRecovery ?? {
        recovered: true,
        message: 'No recovery required',
      },
      memory: this.currentMemory ?? {
        semanticMemoriesRetrieved: 2,
        episodicEpisodesRetrieved: 1,
        lessonsExtracted: ['Successful execution strategy on Search page.'],
      },
      runtimeServices: this.currentRuntimeServices,
    };
  }
}
