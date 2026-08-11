/**
 * @file apps/server/src/eval/evaluation-framework.ts
 * @description Evaluation Framework logging metrics, timeline artifacts, and failure classifications for Sutradhar tasks.
 */

export type FailureCategory =
  | 'planning_failure'
  | 'browser_failure'
  | 'wrong_element'
  | 'timeout'
  | 'recovery_exhausted'
  | 'llm_hallucination'
  | 'dom_ambiguity'
  | 'auth_failure'
  | 'unexpected_navigation';

export interface TaskEvaluationResult {
  readonly taskId: string;
  readonly category: string;
  readonly title: string;
  readonly goal: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly planningTimeMs: number;
  readonly llmLatencyMs: number;
  readonly memoryLatencyMs: number;
  readonly actionCount: number;
  readonly recoveryAttempts: number;
  readonly failureCategory?: FailureCategory;
  readonly failureReason?: string;
  readonly timeline: readonly string[];
  readonly timestamp: string;
}

export class FailureClassifier {
  public static classify(errorMsg: string): FailureCategory {
    const msg = errorMsg.toLowerCase();

    if (msg.includes('timeout')) {
      return 'timeout';
    }
    if (msg.includes('selector') || msg.includes('not found') || msg.includes('element')) {
      return 'wrong_element';
    }
    if (msg.includes('ambiguous') || msg.includes('multiple elements')) {
      return 'dom_ambiguity';
    }
    if (msg.includes('recovery')) {
      return 'recovery_exhausted';
    }
    if (msg.includes('plan') || msg.includes('planner')) {
      return 'planning_failure';
    }
    if (msg.includes('auth') || msg.includes('login') || msg.includes('password')) {
      return 'auth_failure';
    }
    if (msg.includes('redirect') || msg.includes('navigation')) {
      return 'unexpected_navigation';
    }
    if (msg.includes('llm') || msg.includes('hallucination')) {
      return 'llm_hallucination';
    }

    return 'browser_failure';
  }
}

export class EvaluationRecorder {
  private readonly results: TaskEvaluationResult[] = [];

  public recordResult(result: TaskEvaluationResult): void {
    this.results.push(result);
  }

  public getRecordedResults(): readonly TaskEvaluationResult[] {
    return this.results;
  }
}
