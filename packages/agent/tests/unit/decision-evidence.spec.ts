/**
 * @file packages/agent/tests/unit/decision-evidence.spec.ts
 * @description Unit test suite verifying DecisionEvidenceEngine evaluation, penalties, explainability, and recommendations.
 */

import { DecisionEvidenceEngine } from '../../src/evidence/decision-evidence-engine.js';
import { SemanticElementGraph, SemanticNode } from '@pinchtab/browser';

describe('Engineering Iteration 3 — Decision Evidence Engine Unit Tests', () => {
  let engine: DecisionEvidenceEngine;

  beforeEach(() => {
    engine = new DecisionEvidenceEngine();
  });

  it('should recommend EXECUTE for high semantic score visible and enabled candidates', () => {
    const nodes: SemanticNode[] = [
      {
        id: 1,
        tagName: 'BUTTON',
        role: 'button',
        accessibleName: 'Submit Form',
        confidence: 1.0,
        isVisible: true,
        isEnabled: true,
      },
    ];
    const graph = new SemanticElementGraph(nodes, 'https://example.com', 'Test Page');
    const match = graph.findCandidatesByText('Submit Form');

    const evidence = engine.evaluateCandidate(match);
    expect(evidence.recommendation).toBe('EXECUTE');
    expect(evidence.confidence).toBeGreaterThanOrEqual(0.88);
    expect(evidence.explanation).toContain('Exact accessible name match');
    expect(evidence.explanation).toContain('Recommendation: EXECUTE');
  });

  it('should recommend VERIFY_FIRST for medium confidence partial matches', () => {
    const nodes: SemanticNode[] = [
      {
        id: 1,
        tagName: 'BUTTON',
        role: 'button',
        accessibleName: 'Click here to submit details',
        confidence: 0.9,
        isVisible: true,
        isEnabled: true,
      },
    ];
    const graph = new SemanticElementGraph(nodes, 'https://example.com', 'Test Page');
    const match = graph.findCandidatesByText('submit details');

    const evidence = engine.evaluateCandidate(match);
    expect(evidence.recommendation).toBe('VERIFY_FIRST');
    expect(evidence.confidence).toBeGreaterThanOrEqual(0.7);
    expect(evidence.confidence).toBeLessThan(0.88);
  });

  it('should apply hidden_element_penalty and recommend RECOVER when candidate has high semantic match but low visibility', () => {
    const nodes: SemanticNode[] = [
      {
        id: 1,
        tagName: 'BUTTON',
        role: 'button',
        accessibleName: 'Submit Form',
        confidence: 1.0,
        isVisible: false,
        isEnabled: true,
      },
    ];
    const graph = new SemanticElementGraph(nodes, 'https://example.com', 'Test Page');
    const match = graph.findCandidatesByText('Submit Form');

    const evidence = engine.evaluateCandidate(match);
    expect(evidence.recommendation).toBe('RECOVER');
    expect(evidence.penalties.some((p) => p.type === 'hidden_element_penalty')).toBe(true);
    expect(evidence.explanation).toContain('hidden_element_penalty');
  });

  it('should apply recovery_attempt_penalty for prior recovery attempts', () => {
    const nodes: SemanticNode[] = [
      {
        id: 1,
        tagName: 'BUTTON',
        role: 'button',
        accessibleName: 'Submit Form',
        confidence: 1.0,
        isVisible: true,
        isEnabled: true,
      },
    ];
    const graph = new SemanticElementGraph(nodes, 'https://example.com', 'Test Page');
    const match = graph.findCandidatesByText('Submit Form');

    const evidenceNoRec = engine.evaluateCandidate(match, { recoveryAttemptsCount: 0 });
    const evidenceWithRec = engine.evaluateCandidate(match, { recoveryAttemptsCount: 2 });

    expect(evidenceWithRec.confidence).toBeLessThan(evidenceNoRec.confidence);
    expect(evidenceWithRec.penalties.some((p) => p.type === 'recovery_attempt_penalty')).toBe(true);
  });

  it('should recommend REPLAN when no candidate matches target query', () => {
    const graph = new SemanticElementGraph([], 'https://example.com', 'Test Page');
    const match = graph.findCandidatesByText('NonExistentButton');

    const evidence = engine.evaluateCandidate(match);
    expect(evidence.recommendation).toBe('REPLAN');
    expect(evidence.confidence).toBe(0);
    expect(evidence.explanation).toContain('No element candidate found');
  });
});
