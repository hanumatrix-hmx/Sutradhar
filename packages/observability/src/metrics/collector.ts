/**
 * @file packages/observability/src/metrics/collector.ts
 * @description Centralized MetricsCollector service aggregating system counters, gauges, and histograms.
 */

import { Counter, Gauge, Histogram } from './metric.js';

export class MetricsCollector {
  private readonly counters = new Map<string, Counter>();
  private readonly gauges = new Map<string, Gauge>();
  private readonly histograms = new Map<string, Histogram>();

  public createCounter(name: string, description?: string): Counter {
    if (this.counters.has(name)) {
      return this.counters.get(name)!;
    }
    const counter = new Counter(name, description);
    this.counters.set(name, counter);
    return counter;
  }

  public createGauge(name: string, description?: string): Gauge {
    if (this.gauges.has(name)) {
      return this.gauges.get(name)!;
    }
    const gauge = new Gauge(name, description);
    this.gauges.set(name, gauge);
    return gauge;
  }

  public createHistogram(name: string, description?: string): Histogram {
    if (this.histograms.has(name)) {
      return this.histograms.get(name)!;
    }
    const histogram = new Histogram(name, description);
    this.histograms.set(name, histogram);
    return histogram;
  }

  public getSnapshot(): Record<string, unknown> {
    const counterSnapshots: Record<string, number> = {};
    for (const [name, counter] of this.counters.entries()) {
      counterSnapshots[name] = counter.getValue();
    }

    const gaugeSnapshots: Record<string, number> = {};
    for (const [name, gauge] of this.gauges.entries()) {
      gaugeSnapshots[name] = gauge.getValue();
    }

    const histogramSnapshots: Record<string, { count: number; avg: number }> = {};
    for (const [name, histogram] of this.histograms.entries()) {
      histogramSnapshots[name] = {
        count: histogram.getObservations().length,
        avg: histogram.getAverage(),
      };
    }

    return {
      counters: counterSnapshots,
      gauges: gaugeSnapshots,
      histograms: histogramSnapshots,
    };
  }
}
