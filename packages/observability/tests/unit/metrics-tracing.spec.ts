/**
 * @file packages/observability/tests/unit/metrics-tracing.spec.ts
 * @description Unit tests for Counter, Gauge, Histogram, MetricsCollector, Span, and Tracer.
 */

import { MetricsCollector, Tracer } from '../../src/index.js';

describe('@sutradhar/observability Metrics & Tracing Engine', () => {
  it('should aggregate metrics via MetricsCollector', () => {
    const collector = new MetricsCollector();

    const requestCounter = collector.createCounter('http_requests_total');
    requestCounter.increment(1);
    requestCounter.increment(4);

    const memoryGauge = collector.createGauge('memory_usage_bytes');
    memoryGauge.set(1024 * 1024 * 64);

    const latencyHistogram = collector.createHistogram('http_request_duration_ms');
    latencyHistogram.observe(120);
    latencyHistogram.observe(80);

    const snapshot = collector.getSnapshot() as {
      counters: Record<string, number>;
      gauges: Record<string, number>;
      histograms: Record<string, { count: number; avg: number }>;
    };

    expect(snapshot.counters['http_requests_total']).toBe(5);
    expect(snapshot.gauges['memory_usage_bytes']).toBe(67108864);
    expect(snapshot.histograms['http_request_duration_ms']?.count).toBe(2);
    expect(snapshot.histograms['http_request_duration_ms']?.avg).toBe(100);
  });

  it('should manage trace context and spans via Tracer', async () => {
    const tracer = new Tracer();
    expect(typeof tracer.getTraceId()).toBe('string');

    const rootSpan = tracer.startSpan('http_handle_request');
    rootSpan.setAttribute('path', '/api/v1/sessions');

    await new Promise((r) => setTimeout(r, 10));

    const childSpan = tracer.startSpan('db_query', rootSpan.spanId);
    childSpan.setAttribute('table', 'sessions');
    childSpan.end();
    rootSpan.end();

    expect(tracer.getSpans().length).toBe(2);
    expect(rootSpan.getAttributes()['path']).toBe('/api/v1/sessions');
    expect(childSpan.parentSpanId).toBe(rootSpan.spanId);
    expect(childSpan.traceId).toBe(tracer.getTraceId());
    expect(rootSpan.getDurationMs()).toBeGreaterThanOrEqual(10);
  });
});
