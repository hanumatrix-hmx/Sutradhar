/**
 * @file packages/config/tests/unit/provider.spec.ts
 * @description Unit tests for ConfigurationProvider, custom config sources, and secret masking.
 */

import { ConfigurationProvider, IConfigurationSource, maskSecret } from '../../src/index.js';

describe('ConfigurationProvider & Secret Masking', () => {
  class MockConfigSource implements IConfigurationSource {
    public readonly name = 'MockSource';
    public load(): Record<string, unknown> {
      return {
        NODE_ENV: 'test',
        PORT: 5050,
        PINCHTAB_OPENROUTER_API_KEY: 'sk-or-v1-abcdef1234567890ghijkl',
      };
    }
  }

  it('should load and validate configuration from custom config source', () => {
    const provider = new ConfigurationProvider([new MockConfigSource()]);
    const config = provider.getAppConfig();

    expect(config.NODE_ENV).toBe('test');
    expect(config.PORT).toBe(5050);
    expect(config.PINCHTAB_OPENROUTER_API_KEY).toBe('sk-or-v1-abcdef1234567890ghijkl');
  });

  it('should retrieve and mask secrets correctly', () => {
    const provider = new ConfigurationProvider([new MockConfigSource()]);
    const secret = provider.getSecret('PINCHTAB_OPENROUTER_API_KEY');
    const masked = provider.getMaskedSecret('PINCHTAB_OPENROUTER_API_KEY');

    expect(secret).toBe('sk-or-v1-abcdef1234567890ghijkl');
    expect(masked).not.toBe(secret);
    expect(masked).toContain('sk-o');
    expect(masked).toContain('ijkl');
    expect(masked).toContain('***');
  });

  it('should mask empty or short secrets safely', () => {
    expect(maskSecret('')).toBe('[EMPTY]');
    expect(maskSecret('123')).toBe('***masked***');
  });
});
