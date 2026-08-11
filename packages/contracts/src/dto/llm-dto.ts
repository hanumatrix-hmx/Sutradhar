/**
 * @file packages/contracts/src/dto/llm-dto.ts
 * @description Canonical DTOs for LLM Gateways and Providers.
 */

import { ModelId } from '../shared/identifiers.js';

export interface ModelCapabilityDto {
  readonly supportsStreaming: boolean;
  readonly supportsToolCalling: boolean;
  readonly supportsVision: boolean;
  readonly supportsEmbeddings: boolean;
  readonly maxContextTokens: number;
}

export interface ModelDiscoveryDto {
  readonly id: ModelId;
  readonly name: string;
  readonly provider: string;
  readonly capabilities: ModelCapabilityDto;
  readonly costPer1kInputTokens?: number;
  readonly costPer1kOutputTokens?: number;
}

export interface LlmToolCallDto {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface CompletionMessageDto {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly name?: string;
  readonly toolCalls?: readonly LlmToolCallDto[];
}

export interface CompletionRequestDto {
  readonly modelId: ModelId;
  readonly messages: readonly CompletionMessageDto[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly stopSequences?: readonly string[];
  readonly tools?: readonly unknown[];
}

export interface CompletionResponseDto {
  readonly id: string;
  readonly modelId: ModelId;
  readonly message: CompletionMessageDto;
  readonly finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly executionTimeMs: number;
}

export interface StreamChunkDto {
  readonly id: string;
  readonly textDelta: string;
  readonly toolCallDelta?: Partial<LlmToolCallDto>;
  readonly isFinal: boolean;
}
