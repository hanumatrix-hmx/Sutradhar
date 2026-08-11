/**
 * @file packages/frontend/src/stores/llmSettingsStore.ts
 * @description Persisted store for LLM provider configurations, dynamic OpenRouter models & fallback chains.
 */

export type LLMProviderMode = 'heuristic' | 'openrouter' | 'ollama';

export interface OpenRouterModelItem {
  id: string;
  name: string;
  isFree: boolean;
  contextLength?: number;
}

export interface LLMConfig {
  providerMode: LLMProviderMode;
  openrouterApiKey: string;
  openrouterModel: string;
  openrouterBaseUrl: string;
  ollamaEndpoint: string;
  ollamaModel: string;
  temperature: number;
  isVerified: boolean;
  lastVerifiedAt?: string;
  verifiedModel?: string;
  verifiedLatencyMs?: number;
  fallbackProviderMode: LLMProviderMode;
  fallbackModel: string;
}

const LLM_CONFIG_KEY = 'pinchtab_llm_config_v1';

export const POPULAR_FREE_MODELS: OpenRouterModelItem[] = [
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free)', isFree: true },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B Instruct (Free)', isFree: true },
  { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free)', isFree: true },
  { id: 'qwen/qwen-2.5-72b-instruct:free', name: 'Qwen 2.5 72B Instruct (Free)', isFree: true },
  { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B Instruct (Free)', isFree: true },
];

export const POPULAR_PAID_MODELS: OpenRouterModelItem[] = [
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (Paid)', isFree: false },
  { id: 'openai/gpt-4o', name: 'GPT-4o (Paid)', isFree: false },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (Paid)', isFree: false },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (Paid)', isFree: false },
  { id: 'google/gemini-pro-1.5', name: 'Gemini 1.5 Pro (Paid)', isFree: false },
];

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  providerMode: 'heuristic',
  openrouterApiKey: '',
  openrouterModel: 'google/gemini-2.0-flash-exp:free',
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  ollamaEndpoint: 'http://localhost:11434',
  ollamaModel: 'qwen2.5',
  temperature: 0.2,
  isVerified: true,
  fallbackProviderMode: 'heuristic',
  fallbackModel: 'Local Heuristic Engine',
};

export function loadLLMConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(LLM_CONFIG_KEY);
    if (raw) {
      return { ...DEFAULT_LLM_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_LLM_CONFIG;
}

export function saveLLMConfig(config: LLMConfig): void {
  try {
    localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('Failed to save LLM config:', err);
  }
}
