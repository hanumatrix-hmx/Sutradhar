/**
 * @file packages/llm/src/local/ollama-adapter.ts
 * @description Local Ollama provider — a thin wrapper over the REAL OpenAiCompatibleAdapter.
 *
 * Speaks to Ollama's built-in OpenAI shim at http://localhost:11434/v1. No API key
 * required for local use. Completions are produced by genuine HTTP calls to the
 * running Ollama daemon; if Ollama is not running, calls fail loudly.
 */

import { CapabilityMatrix } from '@sutradhar/capability';
import {
  CompletionRequestDto,
  CompletionResponseDto,
  StreamChunkDto,
  ModelDiscoveryDto,
  createModelId,
} from '@sutradhar/contracts';
import { ILlmProvider } from '../gateway/llm-provider.js';
import { OpenAiCompatibleAdapter } from '../gateway/openai-compatible-adapter.js';
import { OllamaAdapterOptions, DEFAULT_OLLAMA_OPTIONS } from './ollama-options.js';

export class OllamaAdapter implements ILlmProvider {
  public readonly providerId = 'ollama-local';
  public readonly capabilities: CapabilityMatrix;
  private readonly inner: OpenAiCompatibleAdapter;
  private readonly host: string;

  public constructor(options: OllamaAdapterOptions = {}) {
    this.host = options.host ?? DEFAULT_OLLAMA_OPTIONS.host;
    this.inner = new OpenAiCompatibleAdapter({
      baseUrl: `${this.host.replace(/\/+$/, '')}/v1`,
      defaultModel: options.defaultModel ?? DEFAULT_OLLAMA_OPTIONS.defaultModel,
      providerId: 'ollama-local',
      timeoutMs: options.timeoutMs ?? DEFAULT_OLLAMA_OPTIONS.timeoutMs,
      rateLimiter: options.rateLimiter,
      logger: options.logger,
      // Ollama supports native JSON output mode via `format: "json"`.
      jsonMode: true,
    });
    this.capabilities = this.inner.capabilities;
  }

  public generateCompletion(request: CompletionRequestDto): Promise<CompletionResponseDto> {
    return this.inner.generateCompletion(request);
  }

  public generateStream(request: CompletionRequestDto): AsyncIterable<StreamChunkDto> {
    return this.inner.generateStream(request);
  }

  /** Pings the Ollama daemon. Returns true only on a real successful HTTP response. */
  public async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/api/tags`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Lists models actually installed in the local Ollama daemon via /api/tags.
   * Falls back to an empty list (never invents models) if the daemon is unreachable.
   */
  public async listLocalModels(): Promise<ModelDiscoveryDto[]> {
    try {
      const res = await fetch(`${this.host}/api/tags`, { method: 'GET' });
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: ReadonlyArray<{ name?: string }> };
      return (data.models ?? []).map((m) => ({
        id: createModelId(m.name ?? 'unknown'),
        name: m.name ?? 'unknown',
        provider: 'ollama',
        capabilities: {
          supportsStreaming: true,
          supportsToolCalling: true,
          supportsVision: false,
          supportsEmbeddings: true,
          maxContextTokens: 8192,
        },
      }));
    } catch {
      return [];
    }
  }
}
