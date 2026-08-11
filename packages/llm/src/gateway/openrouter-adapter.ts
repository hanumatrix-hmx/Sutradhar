/**
 * @file packages/llm/src/gateway/openrouter-adapter.ts
 * @description OpenRouter provider — a thin wrapper over the REAL OpenAiCompatibleAdapter.
 *
 * Completions are produced by genuine HTTPS calls to https://openrouter.ai/api/v1.
 * An API key (OPENROUTER_API_KEY) is required at runtime; without it this adapter
 * still constructs but every call will fail loudly at the network boundary rather
 * than fabricate a response.
 */

import { CapabilityMatrix } from '@pinchtab/capability';
import { CompletionRequestDto, CompletionResponseDto, StreamChunkDto } from '@pinchtab/contracts';
import { RateLimiter } from '@pinchtab/utils';
import { StructuredLogger } from '@pinchtab/observability';
import { ILlmProvider } from './llm-provider.js';
import { OpenAiCompatibleAdapter } from './openai-compatible-adapter.js';

export interface OpenRouterAdapterOptions {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly defaultModel?: string;
  readonly rateLimiter?: RateLimiter;
  readonly logger?: StructuredLogger;
  readonly jsonMode?: boolean;
}

export class OpenRouterAdapter implements ILlmProvider {
  public readonly providerId = 'openrouter';
  public readonly capabilities: CapabilityMatrix;
  private readonly inner: OpenAiCompatibleAdapter;

  public constructor(options: OpenRouterAdapterOptions = {}) {
    const apiKey = options.apiKey ?? process.env['OPENROUTER_API_KEY'];
    this.inner = new OpenAiCompatibleAdapter({
      baseUrl: options.baseUrl ?? 'https://openrouter.ai/api/v1',
      apiKey,
      defaultModel: options.defaultModel ?? 'openai/gpt-4o-mini',
      providerId: 'openrouter',
      rateLimiter: options.rateLimiter,
      logger: options.logger,
      jsonMode: options.jsonMode,
    });
    this.capabilities = this.inner.capabilities;
  }

  public generateCompletion(request: CompletionRequestDto): Promise<CompletionResponseDto> {
    return this.inner.generateCompletion(request);
  }

  public generateStream(request: CompletionRequestDto): AsyncIterable<StreamChunkDto> {
    return this.inner.generateStream(request);
  }
}
