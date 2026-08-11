/**
 * @file packages/agent/tests/unit/confidence-execution.spec.ts
 * @description Unit test suite verifying confidence-aware execution, CandidateMatchResult ranking, and threshold rules.
 */

import { SemanticElementGraph, SemanticNode } from '@pinchtab/browser';
import { RecoveryEngine } from '../../src/recovery/recovery-engine.js';
import { ExecutionVerifier } from '@pinchtab/browser';

describe('Engineering Iteration 2 — Confidence-Aware Execution Unit Tests', () => {
  it('should rank exact accessible name matches with high confidence >= 0.90', () => {
    const nodes: SemanticNode[] = [
      {
        id: 1,
        tagName: 'BUTTON',
        role: 'button',
        accessibleName: 'Submit Form',
        confidence: 0.98,
        isVisible: true,
        isEnabled: true,
      },
      {
        id: 2,
        tagName: 'BUTTON',
        role: 'button',
        accessibleName: 'Submit',
        confidence: 0.9,
        isVisible: true,
        isEnabled: true,
      },
    ];

    const graph = new SemanticElementGraph(nodes, 'https://example.com', 'Test Page');
    const result = graph.findCandidatesByText('Submit Form');

    expect(result.candidate).toBeDefined();
    expect(result.candidate?.accessibleName).toBe('Submit Form');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.candidate?.matchingStrategy).toBe('exact_accessible_name');
  });

  it('should assign medium confidence (0.70 - 0.90) for partial text matches', () => {
    const nodes: SemanticNode[] = [
      {
        id: 1,
        tagName: 'BUTTON',
        role: 'button',
        accessibleName: 'Click here to submit feedback',
        confidence: 0.95,
        isVisible: true,
        isEnabled: true,
      },
    ];

    const graph = new SemanticElementGraph(nodes, 'https://example.com', 'Test Page');
    const result = graph.findCandidatesByText('submit feedback');

    expect(result.candidate).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.confidence).toBeLessThan(0.9);
    expect(result.candidate?.matchingStrategy).toBe('partial_text');
  });

  it('should rank multiple similar buttons and provide candidate alternatives', () => {
    const nodes: SemanticNode[] = [
      {
        id: 1,
        tagName: 'BUTTON',
        role: 'button',
        accessibleName: 'Search Google',
        confidence: 0.95,
        isVisible: true,
        isEnabled: true,
      },
      {
        id: 2,
        tagName: 'BUTTON',
        role: 'button',
        accessibleName: 'Search Wikipedia',
        confidence: 0.95,
        isVisible: true,
        isEnabled: true,
      },
      {
        id: 3,
        tagName: 'BUTTON',
        role: 'button',
        accessibleName: 'Search GitHub',
        confidence: 0.95,
        isVisible: true,
        isEnabled: true,
      },
    ];

    const graph = new SemanticElementGraph(nodes, 'https://example.com', 'Test Page');
    const result = graph.findCandidatesByText('Search');

    expect(result.candidate).toBeDefined();
    expect(result.alternatives.length).toBe(2);
  });

  it('should trigger low confidence fallback when query score is < 0.70', async () => {
    const nodes: SemanticNode[] = [
      {
        id: 1,
        tagName: 'DIV',
        role: 'generic',
        nearbyText: 'Unrelated footer content text',
        confidence: 0.8,
        isVisible: true,
        isEnabled: true,
      },
    ];

    const graph = new SemanticElementGraph(nodes, 'https://example.com', 'Test Page');
    const result = graph.findCandidatesByText('Unrelated footer');

    expect(result.confidence).toBeLessThan(0.7);

    const recovery = new RecoveryEngine();
    const mockTab: any = {
      url: 'https://example.com',
      title: 'Example',
    };

    const recoveryRes = await recovery.attemptRecovery(
      'low_confidence',
      mockTab,
      'Unrelated footer',
    );
    expect(recoveryRes.strategyName).toBe('CandidateFallbackRanking');
  });

  it('should incorporate confidence into ExecutionVerifier results', async () => {
    const verifier = new ExecutionVerifier();
    const mockTab: any = { url: 'https://example.com', title: 'Example' };

    const verifyRes = await verifier.verifyAction(
      mockTab,
      'https://example.com',
      { success: true, actionType: 'click' },
      { candidateConfidence: 0.85 },
    );

    expect(verifyRes.verified).toBe(true);
    expect(verifyRes.confidence).toBe(0.85);
  });
});
