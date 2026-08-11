/**
 * @file packages/observability/src/devtools/trace-exporter.ts
 * @description TraceExporter serializing full DevTools inspection traces into formatted JSON format.
 */

import { FullTraceExport } from './devtools-models.js';

export class TraceExporter {
  public static exportToJson(trace: FullTraceExport): string {
    return JSON.stringify(trace, null, 2);
  }

  public static importFromJson(jsonStr: string): FullTraceExport {
    return JSON.parse(jsonStr) as FullTraceExport;
  }
}
