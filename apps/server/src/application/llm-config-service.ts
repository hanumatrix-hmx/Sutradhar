/**
 * @file apps/server/src/application/llm-config-service.ts
 * @description Runtime-reconfigurable LLM provider service.
 *
 * Holds the active LLM configuration and can rebuild the provider chain when
 * the frontend updates settings. This fixes the honest-lifecycle violation
 * where the UI claimed to configure OpenRouter/Ollama but the backend ignored it.
 */

import {
  FallbackLlmProvider,
  OpenAiCompatibleAdapter,
  OllamaAdapter,
  HeuristicLlmProvider,
  ILlmProvider,
} from '@pinchtab/llm';
import { StructuredLogger } from '@pinchtab/observability';

export interface LlmRuntimeConfig {
  readonly providerMode: 'heuristic' | 'openrouter' | 'ollama';
  readonly openrouterApiKey?: string;
  readonly openrouterModel?: string;
  readonly openrouterBaseUrl?: string;
  readonly ollamaEndpoint?: string;
  readonly ollamaModel?: string;
  readonly temperature?: number;
}

export class LlmConfigService {
  private config: LlmRuntimeConfig;
  private provider: FallbackLlmProvider;
  private readonly logger: StructuredLogger;

  public constructor(initialConfig: LlmRuntimeConfig, logger: StructuredLogger) {
    this.config = initialConfig;
    this.logger = logger;
    this.provider = this.buildProviderChain(initialConfig);
  }

  public getProvider(): FallbackLlmProvider {
    return this.provider;
  }

  public getConfig(): LlmRuntimeConfig {
    return this.config;
  }

  public updateConfig(newConfig: LlmRuntimeConfig): void {
    this.config = newConfig;
    this.provider = this.buildProviderChain(newConfig);
    this.logger.info(`[LlmConfigService] provider chain rebuilt: ${newConfig.providerMode}`);
  }

  private buildProviderChain(config: LlmRuntimeConfig): FallbackLlmProvider {
    const providers: ILlmProvider[] = [];

    // Primary provider based on config
    if (config.providerMode === 'openrouter' && config.openrouterApiKey) {
      providers.push(
        new OpenAiCompatibleAdapter({
          baseUrl: config.openrouterBaseUrl ?? 'https://openrouter.ai/api/v1',
          apiKey: config.openrouterApiKey,
          defaultModel: config.openrouterModel ?? 'openai/gpt-4o-mini',
          providerId: 'openrouter',
          logger: this.logger,
        }),
      );
      this.logger.info('[LlmConfigService] primary: OpenRouter cloud');
    } else if (config.providerMode === 'ollama') {
      providers.push(
        new OllamaAdapter({
          host: config.ollamaEndpoint ?? 'http://localhost:11434',
          defaultModel: config.ollamaModel ?? 'qwen3.5:9b',
          logger: this.logger,
        }),
      );
      this.logger.info('[LlmConfigService] primary: Ollama local');
    } else {
      // heuristic or no API key for openrouter
      providers.push(new HeuristicLlmProvider());
      this.logger.info('[LlmConfigService] primary: heuristic (rule-based)');
    }

    // Fallback: always include Ollama if not already primary, then heuristic
    if (config.providerMode !== 'ollama') {
      providers.push(
        new OllamaAdapter({
          host: config.ollamaEndpoint ?? 'http://localhost:11434',
          defaultModel: config.ollamaModel ?? 'qwen3.5:9b',
          logger: this.logger,
        }),
      );
      this.logger.info('[LlmConfigService] fallback: Ollama local');
    }

    if (config.providerMode !== 'heuristic') {
      providers.push(new HeuristicLlmProvider());
      this.logger.info('[LlmConfigService] last resort: heuristic');
    }

    this.logger.info(
      `[LlmConfigService] chain: ${providers.map((p) => p.providerId).join(' → ')}`,
    );
    return new FallbackLlmProvider({ providers, logger: this.logger });
  }
}
