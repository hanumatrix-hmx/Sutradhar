/**
 * @file packages/observability/src/tracing/tracer.ts
 * @description Tracer class for creating spans and managing active trace contexts.
 */

import { generateRandomToken } from '@sutradhar/utils';
import { Span } from './span.js';

export class Tracer {
  private currentTraceId: string;
  private readonly completedSpans: Span[] = [];

  public constructor(traceId?: string) {
    this.currentTraceId = traceId ?? generateRandomToken(16);
  }

  public getTraceId(): string {
    return this.currentTraceId;
  }

  public startSpan(name: string, parentSpanId?: string): Span {
    const span = new Span(this.currentTraceId, name, parentSpanId);
    this.completedSpans.push(span);
    return span;
  }

  public getSpans(): readonly Span[] {
    return [...this.completedSpans];
  }
}
