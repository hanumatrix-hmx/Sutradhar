/**
 * @file packages/agent/src/planner/prompt-compiler.ts
 * @description System prompt compiler compiling DOM snapshot context, memory context, and goal prompts.
 */

import { CompletionMessageDto } from '@sutradhar/contracts';

export interface PromptCompilerContext {
  readonly agentName: string;
  readonly agentRole: string;
  readonly systemPromptTemplate?: string;
  readonly domSnapshotTree?: string;
  readonly relevantMemories?: readonly string[];
  readonly previousSteps?: readonly string[];
}

export class PromptCompiler {
  public async compilePrompt(
    goalText: string,
    context: Partial<PromptCompilerContext> = {},
  ): Promise<CompletionMessageDto[]> {
    const fullContext: PromptCompilerContext = {
      agentName: context.agentName ?? 'Sutradhar Browser Agent',
      agentRole: context.agentRole ?? 'General Assistant',
      ...context,
    };
    return PromptCompiler.compileMessages(goalText, fullContext);
  }

  public static compileSystemPrompt(context: PromptCompilerContext): string {
    const lines: string[] = [];

    lines.push(
      `You are ${context.agentName}, an autonomous AI web agent operating as a ${context.agentRole}.`,
    );
    lines.push('Your objective is to accomplish user goals accurately, safely, and efficiently.');

    if (context.systemPromptTemplate) {
      lines.push('\n--- System Directives ---');
      lines.push(context.systemPromptTemplate);
    }

    if (context.relevantMemories && context.relevantMemories.length > 0) {
      lines.push('\n--- Relevant Memory Context ---');
      for (const mem of context.relevantMemories) {
        lines.push(`- ${mem}`);
      }
    }

    if (context.domSnapshotTree) {
      lines.push('\n--- Current DOM Accessibility Tree ---');
      lines.push(context.domSnapshotTree);
    }

    if (context.previousSteps && context.previousSteps.length > 0) {
      lines.push('\n--- Previously Executed Steps ---');
      for (let i = 0; i < context.previousSteps.length; i++) {
        lines.push(`${i + 1}. ${context.previousSteps[i]}`);
      }
    }

    return lines.join('\n');
  }

  public static compileMessages(
    goalText: string,
    context: PromptCompilerContext,
  ): CompletionMessageDto[] {
    const systemPrompt = this.compileSystemPrompt(context);
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Goal: ${goalText}` },
    ];
  }
}
