/**
 * @file packages/llm/src/local/ollama-options.ts
 * @description Configuration options and defaults for local Ollama provider engine.
 */

import { RateLimiter } from '@pinchtab/utils';
import { StructuredLogger } from '@pinchtab/observability';

export interface OllamaAdapterOptions {
  readonly host?: string;
  readonly defaultModel?: string;
  readonly timeoutMs?: number;
  readonly rateLimiter?: RateLimiter;
  readonly logger?: StructuredLogger;
}

export const DEFAULT_OLLAMA_OPTIONS: Required<
  Pick<OllamaAdapterOptions, 'host' | 'defaultModel' | 'timeoutMs'>
> = {
  host: 'http://localhost:11434',
  defaultModel: 'qwen3.5:9b',
  timeoutMs: 30000,
};
