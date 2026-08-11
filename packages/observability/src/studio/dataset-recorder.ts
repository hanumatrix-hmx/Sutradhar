/**
 * @file packages/observability/src/studio/dataset-recorder.ts
 * @description DatasetRecorder capturing full execution traces and ground truth for model evaluation datasets.
 */

import { FullTraceExport } from '../devtools/devtools-models.js';
import { RecordedDataset } from './studio-models.js';

export class DatasetRecorder {
  public static recordDataset(trace: FullTraceExport): RecordedDataset {
    const datasetId = `ds_${Date.now()}_${trace.goal.goalId}`;
    return {
      datasetId,
      recordedAt: new Date().toISOString(),
      goal: trace.goal.text,
      fullTrace: trace,
      groundTruthOutcome: trace.goal.status,
    };
  }

  public static exportDatasetToJson(dataset: RecordedDataset): string {
    return JSON.stringify(dataset, null, 2);
  }
}
