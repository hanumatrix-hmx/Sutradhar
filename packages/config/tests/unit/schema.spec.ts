/**
 * @file packages/config/tests/unit/schema.spec.ts
 * @description Unit tests for Zod environment and secret schemas.
 */

import { MasterEnvSchema, ServerEnvSchema, CONFIG_VERSION } from '../../src/index.js';

describe('@pinchtab/config Zod Schemas & Version', () => {
  it('should export correct package version constant', () => {
    expect(CONFIG_VERSION).toBe('0.1.0');
  });

  it('should parse valid environment object with default values', () => {
    const rawEnv = {
      NODE_ENV: 'test',
      PORT: '4000',
    };

    const parsed = MasterEnvSchema.parse(rawEnv);

    expect(parsed.NODE_ENV).toBe('test');
    expect(parsed.PORT).toBe(4000);
    expect(parsed.HOST).toBe('0.0.0.0');
    expect(parsed.LOG_LEVEL).toBe('info');
    expect(parsed.PINCHTAB_OLLAMA_HOST).toBe('http://localhost:11434');
  });

  it('should throw validation error on invalid port or node env', () => {
    const invalidEnv = {
      NODE_ENV: 'invalid_mode',
      PORT: '999999',
    };

    expect(() => ServerEnvSchema.parse(invalidEnv)).toThrow();
  });
});
