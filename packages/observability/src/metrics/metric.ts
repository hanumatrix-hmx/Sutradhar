/**
 * @file packages/observability/src/metrics/metric.ts
 * @description In-memory metric primitives (Counter, Gauge, Histogram).
 */

import { Timestamp } from '@sutradhar/contracts';

export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface MetricValue {
  readonly name: string;
  readonly type: MetricType;
  readonly value: number;
  readonly labels?: Record<string, string>;
  readonly timestamp: Timestamp;
}

export class Counter {
  private value = 0;

  public constructor(
    public readonly name: string,
    public readonly description?: string,
  ) {}

  public increment(amount = 1): void {
    if (amount < 0) {
      throw new Error('Counter increment amount must be non-negative');
    }
    this.value += amount;
  }

  public getValue(): number {
    return this.value;
  }
}

export class Gauge {
  private value = 0;

  public constructor(
    public readonly name: string,
    public readonly description?: string,
  ) {}

  public set(val: number): void {
    this.value = val;
  }

  public getValue(): number {
    return this.value;
  }
}

export class Histogram {
  private readonly observations: number[] = [];

  public constructor(
    public readonly name: string,
    public readonly description?: string,
  ) {}

  public observe(val: number): void {
    this.observations.push(val);
  }

  public getObservations(): readonly number[] {
    return [...this.observations];
  }

  public getAverage(): number {
    if (this.observations.length === 0) return 0;
    const sum = this.observations.reduce((a, b) => a + b, 0);
    return sum / this.observations.length;
  }
}
