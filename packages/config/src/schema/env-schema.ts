/**
 * @file packages/config/src/schema/env-schema.ts
 * @description Zod environment schemas for Server, LLM providers, Sutradhar, and Storage backends.
 */

import { z } from 'zod';

export const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export const OpenRouterEnvSchema = z.object({
  SUTRADHAR_OPENROUTER_API_KEY: z.string().optional(),
  SUTRADHAR_OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
});

export const OllamaEnvSchema = z.object({
  SUTRADHAR_OLLAMA_HOST: z.string().default('http://localhost:11434'),
  SUTRADHAR_OLLAMA_DEFAULT_MODEL: z.string().default('llama3'),
});

export const SutradharEnvSchema = z.object({
  SUTRADHAR_SERVER_URL: z.string().default('http://localhost:9876'),
  SUTRADHAR_AUTH_TOKEN: z.string().optional(),
});

export const StorageEnvSchema = z.object({
  DATABASE_URL: z.string().default('sqlite://sutradhar.db'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  QDRANT_URL: z.string().default('http://localhost:6333'),
});

export const MasterEnvSchema = ServerEnvSchema.merge(OpenRouterEnvSchema)
  .merge(OllamaEnvSchema)
  .merge(SutradharEnvSchema)
  .merge(StorageEnvSchema);

export type ServerEnv = z.infer<typeof ServerEnvSchema>;
export type OpenRouterEnv = z.infer<typeof OpenRouterEnvSchema>;
export type OllamaEnv = z.infer<typeof OllamaEnvSchema>;
export type SutradharEnv = z.infer<typeof SutradharEnvSchema>;
export type StorageEnv = z.infer<typeof StorageEnvSchema>;
export type AppEnv = z.infer<typeof MasterEnvSchema>;
