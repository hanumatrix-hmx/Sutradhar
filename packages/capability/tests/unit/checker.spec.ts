/**
 * @file packages/capability/tests/unit/checker.spec.ts
 * @description Unit tests for CapabilityChecker matching engine.
 */

import { CapabilityChecker, CapabilityMatrix, CapabilityRequirement } from '../../src/index.js';

describe('CapabilityChecker Engine', () => {
  const openRouterMatrix: CapabilityMatrix = {
    providerId: 'openrouter',
    capabilities: [
      { type: 'streaming', isSupported: true, version: '1.0.0' },
      { type: 'tool_calling', isSupported: true, version: '2.0.0' },
      { type: 'vision', isSupported: false },
    ],
  };

  const ollamaMatrix: CapabilityMatrix = {
    providerId: 'ollama-local',
    capabilities: [
      { type: 'streaming', isSupported: true, version: '1.0.0' },
      { type: 'tool_calling', isSupported: false },
      { type: 'vision', isSupported: true, version: '1.5.0' },
    ],
  };

  it('should evaluate single requirement accurately', () => {
    const streamReq: CapabilityRequirement = { type: 'streaming' };
    const visionReq: CapabilityRequirement = { type: 'vision' };

    expect(CapabilityChecker.supportsCapability(openRouterMatrix, streamReq)).toBe(true);
    expect(CapabilityChecker.supportsCapability(openRouterMatrix, visionReq)).toBe(false);
  });

  it('should enforce minVersion matching when specified', () => {
    const versionReqPass: CapabilityRequirement = { type: 'tool_calling', minVersion: '1.5.0' };
    const versionReqFail: CapabilityRequirement = { type: 'tool_calling', minVersion: '3.0.0' };

    expect(CapabilityChecker.supportsCapability(openRouterMatrix, versionReqPass)).toBe(true);
    expect(CapabilityChecker.supportsCapability(openRouterMatrix, versionReqFail)).toBe(false);
  });

  it('should return complete CapabilityMatchResult with satisfied and missing requirements', () => {
    const requirements: CapabilityRequirement[] = [
      { type: 'streaming' },
      { type: 'tool_calling' },
      { type: 'vision' },
    ];

    const result = CapabilityChecker.checkCapabilities(openRouterMatrix, requirements);

    expect(result.isSatisfied).toBe(false);
    expect(result.satisfiedCapabilities.length).toBe(2);
    expect(result.missingRequirements.length).toBe(1);
    expect(result.missingRequirements[0]?.type).toBe('vision');
  });

  it('should filter capable provider matrices matching requirement set', () => {
    const matrices = [openRouterMatrix, ollamaMatrix];
    const requirements: CapabilityRequirement[] = [{ type: 'streaming' }, { type: 'tool_calling' }];

    const capable = CapabilityChecker.filterCapableProviders(matrices, requirements);

    expect(capable.length).toBe(1);
    expect(capable[0]?.providerId).toBe('openrouter');
  });
});
