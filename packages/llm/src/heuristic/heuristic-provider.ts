/**
 * @file packages/llm/src/heuristic/heuristic-provider.ts
 * @description Heuristic LLM provider — a simple rule-based fallback that
 * extracts actions from the goal text without any external LLM call.
 *
 * This is the LAST resort in the fallback chain. It does NOT perform real
 * reasoning — it applies simple heuristics (URL extraction, keyword matching)
 * to produce a best-effort action. Use it only when OpenRouter and Ollama are
 * both unreachable.
 */

import { CapabilityMatrix, CapabilityDeclaration } from '@sutradhar/capability';
import {
  CompletionRequestDto,
  CompletionResponseDto,
  StreamChunkDto,
  createModelId,
} from '@sutradhar/contracts';
import { ILlmProvider } from '../gateway/llm-provider.js';

export class HeuristicLlmProvider implements ILlmProvider {
  public readonly providerId = 'heuristic';
  public readonly capabilities: CapabilityMatrix;

  public constructor() {
    this.capabilities = {
      providerId: 'heuristic',
      capabilities: [
        { type: 'streaming', isSupported: false },
        { type: 'tool_calling', isSupported: false },
      ] as readonly CapabilityDeclaration[],
    };
  }

  public async generateCompletion(
    request: CompletionRequestDto,
  ): Promise<CompletionResponseDto> {
    const userMessage =
      request.messages.find((m) => m.role === 'user')?.content ?? '';
    const goal = extractGoal(userMessage);
    const url = extractUrl(goal);

    let actionJson: Record<string, unknown>;

    if (url) {
      // Heuristic 1: if the goal contains a URL, navigate to it.
      actionJson = {
        action: 'navigate',
        url,
        thinking: `[heuristic] Navigating to target URL found in goal.`,
      };
    } else if (/extract|find|what|who|tell me|search/i.test(goal)) {
      // Heuristic 2: extraction-style goal — return what's visible.
      actionJson = {
        action: 'done',
        extracted: `[heuristic] No LLM available. Goal received: "${goal.slice(0, 200)}". Please configure OpenRouter or start Ollama for real agent reasoning.`,
        summary: 'Heuristic mode — no LLM configured',
        thinking: '[heuristic] No URL found; returning goal echo.',
      };
    } else {
      // Heuristic 3: default — signal done with a helpful message.
      actionJson = {
        action: 'done',
        extracted: `[heuristic] No LLM configured. To enable real agent reasoning, set OPENROUTER_API_KEY in your .env file or start Ollama on localhost:11434.`,
        summary: 'Heuristic fallback active — no LLM available',
        thinking: '[heuristic] Fallback response.',
      };
    }

    return {
      id: `heur_${Date.now()}`,
      modelId: createModelId('heuristic'),
      message: {
        role: 'assistant',
        content: JSON.stringify(actionJson),
      },
      finishReason: 'stop',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      executionTimeMs: 1,
    };
  }

  public async *generateStream(
    _request: CompletionRequestDto,
  ): AsyncIterable<StreamChunkDto> {
    // Heuristic provider doesn't support streaming — yield a single chunk.
    const completion = await this.generateCompletion(_request);
    yield {
      id: `heur_chunk_${Date.now()}`,
      textDelta: completion.message.content,
      isFinal: true,
    };
  }
}

function extractUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s)"']+/i);
  return match ? match[0] : undefined;
}

function extractGoal(userMessage: string): string {
  // The user message includes "# Goal\n..." — extract just the goal line.
  const goalMatch = userMessage.match(/# Goal\n(.+)/);
  return goalMatch ? goalMatch[1]!.trim() : userMessage;
}
