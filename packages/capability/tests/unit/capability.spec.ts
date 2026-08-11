/**
 * @file packages/capability/tests/unit/capability.spec.ts
 * @description Unit tests for capability interfaces and version constant.
 */

import { CAPABILITY_VERSION, CapabilityMatrix, CapabilityRequirement } from '../../src/index.js';

describe('@pinchtab/capability Interfaces & Version', () => {
  it('should export correct package version constant', () => {
    expect(CAPABILITY_VERSION).toBe('0.1.0');
  });

  it('should instantiate a valid CapabilityMatrix interface payload', () => {
    const matrix: CapabilityMatrix = {
      providerId: 'openrouter-provider',
      capabilities: [
        { type: 'streaming', isSupported: true },
        { type: 'tool_calling', isSupported: true },
        { type: 'vision', isSupported: false },
      ],
    };

    const requirement: CapabilityRequirement = {
      type: 'streaming',
    };

    expect(matrix.providerId).toBe('openrouter-provider');
    expect(matrix.capabilities.length).toBe(3);
    expect(requirement.type).toBe('streaming');
  });
});
