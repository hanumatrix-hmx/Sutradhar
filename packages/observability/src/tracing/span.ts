/**
 * @file packages/observability/src/tracing/span.ts
 * @description OpenTelemetry-compatible Span class for tracing execution context.
 */

import { generateRandomToken } from '@pinchtab/utils';

export class Span {
  public readonly spanId: string;
  public readonly startTimeMs: number;
  private endTimeMs?: number;
  private readonly attributes: Record<string, unknown> = {};

  public constructor(
    public readonly traceId: string,
    public readonly name: string,
    public readonly parentSpanId?: string,
  ) {
    this.spanId = generateRandomToken(8);
    this.startTimeMs = Date.now();
  }

  public setAttribute(key: string, value: unknown): this {
    this.attributes[key] = value;
    return this;
  }

  public end(): void {
    if (!this.endTimeMs) {
      this.endTimeMs = Date.now();
    }
  }

  public getDurationMs(): number {
    const end = this.endTimeMs ?? Date.now();
    return end - this.startTimeMs;
  }

  public getAttributes(): Record<string, unknown> {
    return { ...this.attributes };
  }
}
