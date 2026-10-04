/**
 * @file packages/llm/tests/unit/ollama-gate.spec.ts
 * @description Pure tests (stubbed fetch, no network) for the live-test gate helper.
 */

import { describe, it, expect } from 'vitest';
import { ollamaHasModel } from './ollama-gate.js';

const reply = (ok: boolean, body: unknown) => async () => ({ ok, json: async () => body });

describe('ollamaHasModel gate', () => {
  it('reachable and lists the model (name field) -> true', async () => {
    expect(await ollamaHasModel('qwen3.5:9b', reply(true, { models: [{ name: 'qwen3.5:9b' }] }))).toBe(true);
  });

  it('reachable and lists the model (model field) -> true', async () => {
    expect(await ollamaHasModel('qwen3.5:9b', reply(true, { models: [{ model: 'qwen3.5:9b' }] }))).toBe(true);
  });

  it('reachable but no models -> false', async () => {
    expect(await ollamaHasModel('qwen3.5:9b', reply(true, { models: [] }))).toBe(false);
  });

  it('reachable with only other models -> false', async () => {
    expect(await ollamaHasModel('qwen3.5:9b', reply(true, { models: [{ name: 'llama3:latest' }] }))).toBe(false);
  });

  it('not ok response -> false', async () => {
    expect(await ollamaHasModel('qwen3.5:9b', reply(false, { models: [{ name: 'qwen3.5:9b' }] }))).toBe(false);
  });

  it('unreachable (fetch throws) -> false', async () => {
    const down = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(await ollamaHasModel('qwen3.5:9b', down)).toBe(false);
  });
});
