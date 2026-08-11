/**
 * @file packages/llm/src/gateway/llm-provider.ts
 * @description Universal ILlmProvider contract interface for multi-vendor LLM gateway integrations.
 */

import { CapabilityMatrix } from '@sutradhar/capability';
import { CompletionRequestDto, CompletionResponseDto, StreamChunkDto } from '@sutradhar/contracts';

export interface ILlmProvider {
  readonly providerId: string;
  readonly capabilities: CapabilityMatrix;

  generateCompletion(request: CompletionRequestDto): Promise<CompletionResponseDto>;

  generateStream(request: CompletionRequestDto): AsyncIterable<StreamChunkDto>;
}
