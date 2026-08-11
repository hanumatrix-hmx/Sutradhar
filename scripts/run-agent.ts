/**
 * @file scripts/run-agent.ts
 * @description End-to-end demo of the REAL Sutradhar agent loop.
 *
 * Usage:
 *   node --experimental-strip-types scripts/run-agent.ts "your goal here"
 *   node --experimental-strip-types scripts/run-agent.ts          # runs a default demo goal
 *
 * Environment (all optional; auto-detected):
 *   SUTRADHAR_MODEL       model id (default: qwen3.5:9b for local Ollama)
 *   SUTRADHAR_LLM_BASE    override LLM base URL (any OpenAI-compatible endpoint)
 *   SUTRADHAR_LLM_KEY     override API key
 *   OPENROUTER_API_KEY   if set, uses OpenRouter cloud instead of local Ollama
 *   CHROME_PATH          path to Chrome/Edge executable if auto-detection fails
 *   HEADED=1             show the browser window (default: headless)
 *
 * This script launches a REAL Chrome browser and drives a REAL LLM. Every step
 * shown is genuine — real navigations, real clicks, real model reasoning.
 */

import { createLlmProviderFromEnv } from '../packages/llm/dist/gateway/openai-compatible-adapter.js';
import { BrowserSessionManager, BrowserLauncher } from '../packages/browser/dist/index.js';
import { StructuredLogger } from '../packages/observability/dist/index.js';
import { runAgentLoop } from '../packages/agent/dist/core/agent-loop.js';
import { createAgentId } from '../packages/contracts/dist/index.js';

async function main(): Promise<void> {
  const goal =
    process.argv[2] ??
    'Open https://en.wikipedia.org/wiki/Alan_Turing and tell me his birth date.';
  const headed = process.env['HEADED'] === '1';

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║          Sutradhar — REAL Agent Loop Demo                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nGoal: ${goal}\n`);

  const logger = new StructuredLogger({ minLevel: 'warn' }); // quiet logs; we print our own
  const llmProvider = createLlmProviderFromEnv(logger);
  console.log(`LLM provider: ${llmProvider.providerId}`);

  const launcher = new BrowserLauncher(logger);
  const sessionManager = new BrowserSessionManager(launcher, undefined, logger);

  const startedAt = Date.now();
  const result = await runAgentLoop({
    agentId: createAgentId('demo_agent'),
    objective: goal,
    llmProvider,
    sessionManager,
    maxSteps: 15,
    maxTokensPerTurn: 768,
    logger,
    onTurn: (line) => console.log(line),
  });

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n──────────────────────────────────────────────────────────────');
  console.log(`Status:    ${result.status.toUpperCase()}`);
  console.log(`Steps:     ${result.steps.length}`);
  console.log(`Duration:  ${secs}s`);
  if (result.answer) console.log(`Answer:    ${result.answer}`);
  if (result.summary) console.log(`Summary:   ${result.summary}`);
  console.log('──────────────────────────────────────────────────────────────\n');

  // Print the full truthful trace.
  console.log('Full step trace:');
  for (const step of result.steps) {
    const mark = step.success ? '✓' : '✗';
    console.log(
      `  ${mark} [${step.stepNumber}] ${step.actionName} — ${step.observation.slice(0, 140)}`,
    );
  }
  console.log('');

  process.exit(result.status === 'completed' ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
