/**
 * @file packages/observability/src/devtools/devtools-models.ts
 * @description Inspection DTO models for Developer Console & Execution Inspector.
 */

export interface TimelineStageNode {
  readonly id: string;
  readonly stageName: string;
  readonly status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'RECOVERED';
  readonly timestamp: string;
  readonly durationMs: number;
  readonly details: Record<string, unknown>;
}

export interface GoalInspection {
  readonly goalId: string;
  readonly text: string;
  readonly priority: number;
  readonly status: string;
  readonly parentGoalId?: string;
  readonly childGoalIds: readonly string[];
  readonly durationMs: number;
}

export interface PlannerInspection {
  readonly reasoning: string;
  readonly planId: string;
  readonly tasksCount: number;
  readonly stepsCount: number;
  readonly latencyMs: number;
}

export interface TaskGraphNodeView {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly priority: number;
  readonly dependencies: readonly string[];
  readonly retryCount: number;
  readonly durationMs?: number;
}

export interface PageInspection {
  readonly pageType: string;
  readonly primaryIntent: string;
  readonly primaryCta?: string;
  readonly regionsCount: number;
  readonly formsCount: number;
  readonly navigationCount: number;
  readonly confidence: number;
}

export interface SemanticCandidateView {
  readonly selector: string;
  readonly role?: string;
  readonly accessibleName?: string;
  readonly confidence: number;
  readonly matchingStrategy: string;
  readonly isVisible: boolean;
}

export interface DecisionInspection {
  readonly recommendation: string;
  readonly confidence: number;
  readonly positiveFactorsCount: number;
  readonly penaltiesCount: number;
  readonly explanation: string;
}

export interface RecoveryInspection {
  readonly failureReason?: string;
  readonly strategyName?: string;
  readonly recovered: boolean;
  readonly message?: string;
}

export interface MemoryInspection {
  readonly semanticMemoriesRetrieved: number;
  readonly episodicEpisodesRetrieved: number;
  readonly lessonsExtracted: readonly string[];
}

export interface RuntimeServiceInspection {
  readonly serviceId: string;
  readonly state: string;
  readonly health: string;
  readonly metrics: Record<string, number | string>;
}

export interface FullTraceExport {
  readonly exportTimestamp: string;
  readonly goal: GoalInspection;
  readonly timeline: readonly TimelineStageNode[];
  readonly planner: PlannerInspection;
  readonly taskGraphNodes: readonly TaskGraphNodeView[];
  readonly page: PageInspection;
  readonly candidates: readonly SemanticCandidateView[];
  readonly decision: DecisionInspection;
  readonly recovery: RecoveryInspection;
  readonly memory: MemoryInspection;
  readonly runtimeServices: readonly RuntimeServiceInspection[];
}
