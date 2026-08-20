/**
 * @file packages/browser/src/dom/semantic-element-graph.ts
 * @description SemanticElementGraph and element node models for rich DOM accessibility understanding.
 */

import { ElementCandidate, CandidateMatchResult, MatchingStrategy } from './element-candidate.js';

export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SemanticNode {
  readonly id: number;
  readonly tagName: string;
  readonly role?: string;
  readonly accessibleName?: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly nearbyText?: string;
  readonly value?: string;
  readonly confidence: number;
  readonly boundingBox?: BoundingBox;
  readonly isVisible: boolean;
  readonly isEnabled: boolean;
}

export class SemanticElementGraph {
  public readonly nodes: readonly SemanticNode[];
  public readonly url: string;
  public readonly title: string;

  public constructor(nodes: readonly SemanticNode[] = [], url = '', title = '') {
    this.nodes = nodes;
    this.url = url;
    this.title = title;
  }

  public findByRole(role: string, name?: string): SemanticNode | undefined {
    return this.findCandidateByRole(role, name).candidate?.node;
  }

  public findByText(text: string): SemanticNode | undefined {
    return this.findCandidatesByText(text).candidate?.node;
  }

  public findInputByLabel(label: string): SemanticNode | undefined {
    return this.findCandidateInputByLabel(label).candidate?.node;
  }

  public findPrimaryButton(name?: string): SemanticNode | undefined {
    return this.nodes.find((n) => {
      const isBtn = n.tagName === 'BUTTON' || n.role === 'button' || n.tagName === 'A';
      if (!isBtn) return false;
      if (!name) return true;
      return n.accessibleName?.toLowerCase().includes(name.toLowerCase());
    });
  }

  public findCandidatesByText(text: string): CandidateMatchResult {
    const query = text.toLowerCase().trim();
    const candidates: ElementCandidate[] = [];

    for (const n of this.nodes) {
      let score = 0;
      let strategy: MatchingStrategy = 'partial_text';
      let evidence = '';

      if (n.accessibleName?.toLowerCase() === query) {
        score = 0.95;
        strategy = 'exact_accessible_name';
        evidence = `Exact accessible name match: "${n.accessibleName}"`;
      } else if (n.accessibleName?.toLowerCase().includes(query)) {
        score = 0.75;
        strategy = 'partial_text';
        evidence = `Partial accessible name match: "${n.accessibleName}"`;
      } else if (n.label?.toLowerCase().includes(query)) {
        score = 0.7;
        strategy = 'label_attribute';
        evidence = `Label attribute match: "${n.label}"`;
      } else if (n.placeholder?.toLowerCase().includes(query)) {
        score = 0.65;
        strategy = 'placeholder_match';
        evidence = `Placeholder match: "${n.placeholder}"`;
      } else if (n.nearbyText?.toLowerCase().includes(query)) {
        score = 0.55;
        strategy = 'nearby_text_match';
        evidence = `Nearby text match: "${n.nearbyText}"`;
      }

      if (score > 0) {
        const selector = n.accessibleName
          ? `[aria-label="${n.accessibleName}"]`
          : `${n.tagName.toLowerCase()}`;
        candidates.push({
          node: n,
          selector,
          role: n.role,
          accessibleName: n.accessibleName,
          confidence: Math.min(1.0, score * n.confidence),
          evidence,
          matchingStrategy: strategy,
        });
      }
    }

    candidates.sort((a, b) => b.confidence - a.confidence);

    const top = candidates[0];
    return {
      candidate: top,
      alternatives: candidates.slice(1),
      confidence: top?.confidence ?? 0,
      reasoning: top
        ? `Selected top candidate with score ${top.confidence.toFixed(2)} via strategy "${top.matchingStrategy}": ${top.evidence}`
        : `No element candidate found for text "${text}"`,
    };
  }

  public findCandidateByRole(role: string, name?: string): CandidateMatchResult {
    const candidates: ElementCandidate[] = [];

    for (const n of this.nodes) {
      const roleMatch = n.role?.toLowerCase() === role.toLowerCase();
      if (!roleMatch) continue;

      let score = 0.7;
      let evidence = `Role match: ${role}`;

      if (name && n.accessibleName?.toLowerCase().includes(name.toLowerCase())) {
        score = 0.92;
        evidence += ` with name "${n.accessibleName}"`;
      }

      candidates.push({
        node: n,
        selector: `[role="${role}"]`,
        role: n.role,
        accessibleName: n.accessibleName,
        confidence: score * n.confidence,
        evidence,
        matchingStrategy: 'role_match',
      });
    }

    candidates.sort((a, b) => b.confidence - a.confidence);

    const top = candidates[0];
    return {
      candidate: top,
      alternatives: candidates.slice(1),
      confidence: top?.confidence ?? 0,
      reasoning: top
        ? `Selected candidate with confidence ${top.confidence.toFixed(2)} for role "${role}": ${top.evidence}`
        : `No candidate found for role "${role}"`,
    };
  }

  public findCandidateInputByLabel(label: string): CandidateMatchResult {
    const query = label.toLowerCase();
    const candidates: ElementCandidate[] = [];

    for (const n of this.nodes) {
      const isInput = n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.role === 'textbox';
      if (!isInput) continue;

      let score = 0;
      let strategy: MatchingStrategy = 'label_attribute';
      let evidence = '';

      if (n.label?.toLowerCase().includes(query)) {
        score = 0.92;
        strategy = 'label_attribute';
        evidence = `Input label match: "${n.label}"`;
      } else if (n.placeholder?.toLowerCase().includes(query)) {
        score = 0.82;
        strategy = 'placeholder_match';
        evidence = `Input placeholder match: "${n.placeholder}"`;
      } else if (n.accessibleName?.toLowerCase().includes(query)) {
        score = 0.78;
        strategy = 'exact_accessible_name';
        evidence = `Input accessible name match: "${n.accessibleName}"`;
      }

      if (score > 0) {
        candidates.push({
          node: n,
          selector: n.label ? `input[aria-label="${n.label}"]` : 'input',
          role: n.role,
          accessibleName: n.accessibleName,
          confidence: score * n.confidence,
          evidence,
          matchingStrategy: strategy,
        });
      }
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    const top = candidates[0];

    return {
      candidate: top,
      alternatives: candidates.slice(1),
      confidence: top?.confidence ?? 0,
      reasoning: top
        ? `Selected input candidate with confidence ${top.confidence.toFixed(2)}: ${top.evidence}`
        : `No input candidate found for label "${label}"`,
    };
  }
}
