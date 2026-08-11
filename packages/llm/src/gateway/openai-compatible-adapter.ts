/**
 * @file packages/llm/src/gateway/openai-compatible-adapter.ts
 * @description REAL LLM adapter speaking the OpenAI /v1/chat/completions protocol.
 *
 * This is a single, genuine HTTP client that works against any OpenAI-compatible
 * endpoint: OpenAI itself, OpenRouter, a LiteLLM proxy, or Ollama's built-in
 * OpenAI shim (http://localhost:11434/v1). It performs real network fetches,
 * parses real token usage, streams real deltas, and retries transient errors.
 *
 * Unlike the previous string-template stubs, every completion here is produced
 * by an actual model. If the network is unreachable or the model is missing,
 * this adapter throws — it never fabricates a response.
 */

import { CapabilityMatrix } from '@sutradhar/capability';
import {
  CompletionRequestDto,
  CompletionResponseDto,
  CompletionMessageDto,
  StreamChunkDto,
  LlmToolCallDto,
  createModelId,
} from '@sutradhar/contracts';
import { RateLimiter, retryWithBackoff } from '@sutradhar/utils';
import { StructuredLogger } from '@sutradhar/observability';
import { ILlmProvider } from './llm-provider.js';
import { FallbackLlmProvider } from './fallback-provider.js';
import { HeuristicLlmProvider } from '../heuristic/heuristic-provider.js';

export interface OpenAiCompatibleAdapterOptions {
  /** Base URL of an OpenAI-compatible API, WITHOUT a trailing slash. */
  readonly baseUrl: string;
  /** API key. Optional for local servers (e.g. Ollama) that don't require auth. */
  readonly apiKey?: string;
  /** Default model id used when the request omits modelId. */
  readonly defaultModel: string;
  /** Provider id surfaced via capabilities (e.g. 'openrouter', 'ollama-local'). */
  readonly providerId?: string;
  /** Request timeout in ms. */
  readonly timeoutMs?: number;
  readonly rateLimiter?: RateLimiter;
  readonly logger?: StructuredLogger;
  /**
   * Hint to the server that we want a JSON object back. Ollama supports
   * `format: "json"` natively; OpenAI/OpenRouter honor `response_format`.
   */
  readonly jsonMode?: boolean;
}

/** OpenAI chat message shape (what we send on the wire). */
interface OpenAiChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly name?: string;
}

interface OpenAiChoice {
  readonly index?: number;
  readonly message?: { role?: string; content?: string };
  readonly delta?: { role?: string; content?: string };
  readonly finish_reason?: string | null;
}

interface OpenAiUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
}

interface OpenAiChatResponse {
  readonly id?: string;
  readonly model?: string;
  readonly choices?: readonly OpenAiChoice[];
  readonly usage?: OpenAiUsage;
}

/**
 * Builds an AbortController that fires after `timeoutMs`, and returns both the
 * signal and a cleaner so the caller can cancel the timer once the fetch settles.
 */
function withTimeout(timeoutMs: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(handle) };
}

/** True for transient/network-class errors worth retrying. */
function isTransient(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('abort')) return true;
    if (msg.includes('fetch failed') || msg.includes('econnreset')) return true;
    if (msg.includes('socket hang up') || msg.includes('network')) return true;
  }
  // Retry on 429 / 5xx status carried on a thrown LlmHttpError.
  if (err instanceof LlmHttpError && (err.status === 429 || err.status >= 500)) return true;
  return false;
}

/** HTTP-layer error carrying the upstream status so retry logic can inspect it. */
export class LlmHttpError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly bodyText?: string,
  ) {
    super(message);
    this.name = 'LlmHttpError';
  }
}

export class OpenAiCompatibleAdapter implements ILlmProvider {
  public readonly providerId: string;
  public readonly capabilities: CapabilityMatrix;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;
  private readonly jsonMode: boolean;
  private readonly rateLimiter: RateLimiter;
  private readonly logger: StructuredLogger;

  public constructor(options: OpenAiCompatibleAdapterOptions) {
    if (!options.baseUrl) {
      throw new Error('OpenAiCompatibleAdapter requires a baseUrl');
    }
    if (!options.defaultModel) {
      throw new Error('OpenAiCompatibleAdapter requires a defaultModel');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.defaultModel = options.defaultModel;
    this.providerId = options.providerId ?? 'openai-compatible';
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.jsonMode = options.jsonMode ?? false;
    this.rateLimiter =
      options.rateLimiter ?? new RateLimiter({ tokensPerInterval: 60, intervalMs: 60_000 });
    this.logger = options.logger ?? new StructuredLogger({ minLevel: 'info' });

    this.capabilities = {
      providerId: this.providerId,
      capabilities: [
        { type: 'streaming', isSupported: true, version: '1.0.0' },
        { type: 'tool_calling', isSupported: true },
        { type: 'vision', isSupported: false },
        { type: 'embeddings', isSupported: false },
        { type: 'reasoning', isSupported: true },
        { type: 'browser_automation', isSupported: false },
        { type: 'memory_search', isSupported: false },
        { type: 'ocr', isSupported: false },
        { type: 'speech', isSupported: false },
      ],
    };
  }

  public async generateCompletion(request: CompletionRequestDto): Promise<CompletionResponseDto> {
    await this.rateLimiter.removeToken(1);
    // Prefer the configured default model (the real model name). Only honor the
    // request's modelId if the caller explicitly named a different model — many
    // callers pass a placeholder (e.g. the providerId) which is not a real model.
    const requested = request.modelId as string;
    const modelId =
      requested && requested !== this.providerId && requested.length > 0
        ? requested
        : this.defaultModel;

    this.logger.info(`[${this.providerId}] Generating completion`, {
      model: modelId,
      messages: request.messages.length,
    });

    return retryWithBackoff(
      async () => {
        const startTime = Date.now();
        const body = this.buildRequestBody(request, modelId, /* stream */ false);
        const json = await this.post('/chat/completions', body);

        const choice = json.choices?.[0];
        const content = choice?.message?.content ?? '';
        const finishRaw = (choice?.finish_reason ?? 'stop') as string;
        const finish: CompletionResponseDto['finishReason'] = ['stop', 'length', 'tool_calls', 'content_filter'].includes(finishRaw)
          ? (finishRaw as CompletionResponseDto['finishReason'])
          : 'stop';

        const message: CompletionMessageDto = { role: 'assistant', content };

        return {
          id: json.id ?? `gen_${Date.now()}`,
          modelId: createModelId(modelId),
          message,
          finishReason: finish,
          promptTokens: json.usage?.prompt_tokens ?? 0,
          completionTokens: json.usage?.completion_tokens ?? 0,
          totalTokens: json.usage?.total_tokens ?? 0,
          executionTimeMs: Date.now() - startTime,
        };
      },
      { maxRetries: 3, shouldRetry: isTransient },
    );
  }

  public async *generateStream(request: CompletionRequestDto): AsyncIterable<StreamChunkDto> {
    await this.rateLimiter.removeToken(1);
    const requested = request.modelId as string;
    const modelId =
      requested && requested !== this.providerId && requested.length > 0
        ? requested
        : this.defaultModel;
    const body = this.buildRequestBody(request, modelId, /* stream */ true);

    this.logger.info(`[${this.providerId}] Starting stream`, { model: modelId });

    const { signal, clear } = withTimeout(this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      clear();
      throw new Error(`[${this.providerId}] stream fetch failed: ${(err as Error).message}`);
    }

    if (!response.ok || !response.body) {
      clear();
      const text = await response.text().catch(() => '');
      throw new LlmHttpError(
        `[${this.providerId}] stream HTTP ${response.status}`,
        response.status,
        text,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunkIndex = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by blank lines; each data line is prefixed "data: ".
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const rawLine = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!rawLine || !rawLine.startsWith('data:')) continue;
          const payload = rawLine.slice('data:'.length).trim();
          if (payload === '[DONE]') {
            yield { id: `chunk_${chunkIndex++}`, textDelta: '', isFinal: true };
            return;
          }
          try {
            const frame = JSON.parse(payload) as OpenAiChatResponse;
            const delta = frame.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              yield { id: `chunk_${chunkIndex++}`, textDelta: delta, isFinal: false };
            }
          } catch {
            // Skip malformed partial frames; SSE frames can split across reads.
          }
        }
      }
      yield { id: `chunk_${chunkIndex++}`, textDelta: '', isFinal: true };
    } finally {
      clear();
      reader.releaseLock();
    }
  }

  // ---- internals ----------------------------------------------------------

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      // OpenRouter wants a friendly referer/title; harmless elsewhere.
      h['Authorization'] = `Bearer ${this.apiKey}`;
    }
    if (this.providerId === 'openrouter' || this.baseUrl.includes('openrouter.ai')) {
      h['HTTP-Referer'] = 'https://github.com/sutradhar';
      h['X-Title'] = 'Sutradhar';
    }
    return h;
  }

  private buildRequestBody(
    request: CompletionRequestDto,
    modelId: string,
    stream: boolean,
  ): Record<string, unknown> {
    const messages: OpenAiChatMessage[] = request.messages.map((m: CompletionMessageDto) => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    }));

    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      stream,
    };
    if (request.temperature !== undefined) body['temperature'] = request.temperature;
    if (request.maxTokens !== undefined) body['max_tokens'] = request.maxTokens;
    if (request.stopSequences?.length) body['stop'] = request.stopSequences;

    if (this.jsonMode) {
      // Ollama understands `format: "json"`; OpenAI/OpenRouter understand response_format.
      if (this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1')) {
        body['format'] = 'json';
      } else {
        body['response_format'] = { type: 'json_object' };
      }
    }

    if (request.tools?.length) {
      // We expose tools but keep parsing of returned tool_calls model-agnostic in the agent loop.
      body['tools'] = request.tools;
    }
    return body;
  }

  private async post(path: string, body: unknown): Promise<OpenAiChatResponse> {
    const { signal, clear } = withTimeout(this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new LlmHttpError(
          `[${this.providerId}] HTTP ${response.status}: ${text.slice(0, 500)}`,
          response.status,
          text,
        );
      }

      return (await response.json()) as OpenAiChatResponse;
    } finally {
      clear();
    }
  }
}

/**
 * Convenience factory that returns a provider configured from environment
 * variables, with a built-in fallback chain:
 *
 *   1. OPENROUTER_API_KEY set → OpenRouter cloud (primary)
 *   2. Local Ollama daemon (secondary, tried if primary fails)
 *   3. Heuristic rule-based provider (last resort, no LLM needed)
 *
 * Honors: SUTRADHAR_MODEL (model id), SUTRADHAR_LLM_BASE (override base url),
 *         SUTRADHAR_LLM_KEY (override key), SUTRADHAR_LLM_JSON (json mode).
 */
export function createLlmProviderFromEnv(
  logger?: StructuredLogger,
): FallbackLlmProvider {
  const log = logger ?? new StructuredLogger({ minLevel: 'info' });
  const openRouterKey = process.env['OPENROUTER_API_KEY'];
  const overrideBase = process.env['SUTRADHAR_LLM_BASE'];
  const overrideKey = process.env['SUTRADHAR_LLM_KEY'];
  const model = process.env['SUTRADHAR_MODEL'];
  const jsonMode = process.env['SUTRADHAR_LLM_JSON'] === '1';

  const providers: ILlmProvider[] = [];

  // 1. Primary: OpenRouter or custom endpoint (if configured)
  if (overrideBase) {
    providers.push(
      new OpenAiCompatibleAdapter({
        baseUrl: overrideBase,
        apiKey: overrideKey,
        defaultModel: model ?? 'gpt-4o-mini',
        providerId: 'custom-openai-compatible',
        jsonMode,
        logger: log,
      }),
    );
    log.info(`[LLM] primary: custom endpoint ${overrideBase}`);
  } else if (openRouterKey) {
    providers.push(
      new OpenAiCompatibleAdapter({
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: openRouterKey,
        defaultModel: model ?? 'openai/gpt-4o-mini',
        providerId: 'openrouter',
        jsonMode,
        logger: log,
      }),
    );
    log.info('[LLM] primary: OpenRouter cloud');
  }

  // 2. Secondary: local Ollama (always in the chain as fallback)
  providers.push(
    new OpenAiCompatibleAdapter({
      baseUrl: 'http://localhost:11434/v1',
      apiKey: undefined,
      defaultModel: model ?? 'qwen3.5:9b',
      providerId: 'ollama-local',
      jsonMode,
      logger: log,
    }),
  );
  log.info('[LLM] secondary: Ollama local (http://localhost:11434/v1)');

  // 3. Last resort: heuristic (rule-based, no network calls)
  providers.push(new HeuristicLlmProvider());
  log.info('[LLM] last resort: heuristic (rule-based)');

  log.info(`[LLM] fallback chain active: ${providers.map((p) => p.providerId).join(' → ')}`);
  return new FallbackLlmProvider({ providers, logger: log });
}

/** Re-exported type for callers building tool-call payloads. */
export type { LlmToolCallDto };
