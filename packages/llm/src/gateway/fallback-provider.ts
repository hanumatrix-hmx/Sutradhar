/**
 * @file packages/llm/src/gateway/fallback-provider.ts
 * @description Fallback LLM provider that tries multiple providers in order.
 *
 * If the primary provider fails (network error, timeout, etc.), this wrapper
 * automatically falls back to the next provider in the chain. The currently
 * active provider is tracked and exposed via `activeProviderId`.
 */

import { CapabilityMatrix } from '@sutradhar/capability';
import { CompletionRequestDto, CompletionResponseDto, StreamChunkDto } from '@sutradhar/contracts';
import { StructuredLogger } from '@sutradhar/observability';
import { ILlmProvider } from './llm-provider.js';

export interface FallbackProviderOptions {
  /** Providers to try, in priority order (first = primary). */
  readonly providers: readonly ILlmProvider[];
  readonly logger?: StructuredLogger;
}

/**
 * Wraps multiple LLM providers and tries them in order. On each completion
 * request, iterates through the chain until one succeeds. If all fail, throws
 * an error listing every failure reason.
 */
export class FallbackLlmProvider implements ILlmProvider {
  public readonly providerId = 'fallback-chain';
  public readonly capabilities: CapabilityMatrix;

  private readonly providers: readonly ILlmProvider[];
  private readonly logger: StructuredLogger;
  private _activeProvider: ILlmProvider | null = null;

  public constructor(opts: FallbackProviderOptions) {
    if (opts.providers.length === 0) {
      throw new Error('[FallbackLlmProvider] at least one provider is required');
    }
    this.providers = opts.providers;
    this.logger = opts.logger ?? new StructuredLogger({ minLevel: 'info' });
    this._activeProvider = opts.providers[0]!;
    // Expose the primary provider's capabilities as the chain's capabilities.
    this.capabilities = opts.providers[0]!.capabilities;
  }

  /** The provider that last successfully served a completion. */
  public get activeProviderId(): string {
    return this._activeProvider?.providerId ?? 'none';
  }

  public async generateCompletion(
    request: CompletionRequestDto,
  ): Promise<CompletionResponseDto> {
    const failures: Array<{ providerId: string; error: string }> = [];

    // Strip the modelId from the request so each provider uses its own
    // defaultModel instead of receiving the fallback chain's providerId.
    const { modelId: _unused, ...restRequest } = request as CompletionRequestDto & { modelId?: unknown };

    for (const provider of this.providers) {
      try {
        const result = await provider.generateCompletion(restRequest as CompletionRequestDto);
        this._activeProvider = provider;
        if (failures.length > 0) {
          this.logger.info(
            `[FallbackLlmProvider] ${provider.providerId} succeeded after ${failures.length} fallback(s)`,
          );
        }
        return result;
      } catch (err) {
        const msg = (err as Error).message;
        this.logger.warn(
          `[FallbackLlmProvider] ${provider.providerId} failed: ${msg}`,
        );
        failures.push({ providerId: provider.providerId, error: msg });
      }
    }

    // All providers exhausted.
    const detail = failures
      .map((f) => `  - ${f.providerId}: ${f.error}`)
      .join('\n');
    throw new Error(
      `[FallbackLlmProvider] All ${this.providers.length} LLM provider(s) exhausted:\n${detail}`,
    );
  }

  public async *generateStream(
    request: CompletionRequestDto,
  ): AsyncIterable<StreamChunkDto> {
    const failures: Array<{ providerId: string; error: string }> = [];

    for (const provider of this.providers) {
      try {
        const stream = provider.generateStream(request);
        let yielded = false;
        for await (const chunk of stream) {
          yielded = true;
          yield chunk;
        }
        if (yielded) {
          this._activeProvider = provider;
          return;
        }
      } catch (err) {
        const msg = (err as Error).message;
        this.logger.warn(
          `[FallbackLlmProvider] stream ${provider.providerId} failed: ${msg}`,
        );
        failures.push({ providerId: provider.providerId, error: msg });
      }
    }

    const detail = failures
      .map((f) => `  - ${f.providerId}: ${f.error}`)
      .join('\n');
    throw new Error(
      `[FallbackLlmProvider] All ${this.providers.length} streaming provider(s) exhausted:\n${detail}`,
    );
  }
}
