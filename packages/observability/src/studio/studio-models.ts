/**
 * @file packages/observability/src/studio/studio-models.ts
 * @description Data models and DTO interfaces for PinchTab Studio engineering environment.
 */

import { FullTraceExport } from '../devtools/devtools-models.js';

export interface ReplayFrame {
  readonly frameIndex: number;
  readonly stageName: string;
  readonly timestamp: string;
  readonly pageType: string;
  readonly activeNodeId?: string;
  readonly evidenceConfidence: number;
  readonly recommendation: string;
  readonly domSnapshotRef?: string;
}

export interface DecisionDiffResult {
  readonly traceAId: string;
  readonly traceBId: string;
  readonly planIdentical: boolean;
  readonly confidenceDelta: number;
  readonly latencyDeltaMs: number;
  readonly recoveryPathsMatch: boolean;
  readonly outcomeMatch: boolean;
  readonly diffSummary: string;
}

export interface VisualDomNode {
  readonly id: number;
  readonly tagName: string;
  readonly role?: string;
  readonly accessibleName?: string;
  readonly isPrimaryCta: boolean;
  readonly isInForm: boolean;
  readonly isInNavigation: boolean;
}

export interface MemoryGraphNode {
  readonly id: string;
  readonly type: 'semantic' | 'episodic' | 'lesson';
  readonly label: string;
  readonly score?: number;
}

export interface MemoryGraphView {
  readonly nodes: readonly MemoryGraphNode[];
  readonly totalRetrieved: number;
}

export interface PerformanceProfile {
  readonly totalDurationMs: number;
  readonly planningDurationMs: number;
  readonly browserDurationMs: number;
  readonly verificationDurationMs: number;
  readonly recoveryDurationMs: number;
  readonly memoryLatencyMs: number;
}

export interface ChaosExperimentResult {
  readonly experimentId: string;
  readonly failureType: string;
  readonly injectedAt: string;
  readonly recoveredSuccessfully: boolean;
  readonly recoveryStrategy: string;
  readonly recoveryLatencyMs: number;
}

export interface RecordedDataset {
  readonly datasetId: string;
  readonly recordedAt: string;
  readonly goal: string;
  readonly fullTrace: FullTraceExport;
  readonly groundTruthOutcome: string;
}
