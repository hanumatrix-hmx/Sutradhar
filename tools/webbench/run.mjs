// WebBench harness: runs Sutradhar's real autonomous agent (agent.runGoal's actual production
// path — SutradharRuntime + AgentCore + a real LLM provider, composed exactly the way
// packages/mcp-server/src/server.ts composes them, not a stripped-down reimplementation) against
// a curated sample of real WebBench tasks (see tasks.json for provenance).
//
// WebBench itself has no machine-checkable per-task answer key — its own methodology is
// human-in-the-loop review ("Each result was validated by a human in the loop to assert
// evaluation data quality"). This harness matches that: it does NOT invent a scoring function.
// It runs each task, captures the real agent's status/answer/step-trace/duration, and writes a
// structured report for a human (or a separate LLM-judge pass) to actually score.
//
// Requires a real LLM provider: either OPENROUTER_API_KEY set, or Ollama running locally
// (SUTRADHAR_LLM_BASE / SUTRADHAR_MODEL to override the defaults). Without one, every task will
// come back status:"failed" with an honest "no LLM provider configured" error — which still
// proves the harness itself works end-to-end; it's the reasoning step that's unavailable, not a
// harness bug. See .ai/competitive-benchmarks.md for why this is a real, external blocker in
// this environment as of 2026-08-13, not something more code fixes.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const { SutradharRuntime } = await import(pathToFileURL(path.join(ROOT, 'packages/capability-runtime/dist/index.js')));
const { AgentCore } = await import(pathToFileURL(path.join(ROOT, 'packages/agent/dist/index.js')));
const { OllamaAdapter, OpenRouterAdapter } = await import(pathToFileURL(path.join(ROOT, 'packages/llm/dist/index.js')));

const HEADLESS = process.env.HEADFUL !== '1';

function resolveLlmProvider() {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    console.log('[webbench] using OpenRouter LLM provider');
    return new OpenRouterAdapter({ apiKey: openrouterKey });
  }
  try {
    const ollama = new OllamaAdapter({
      host: process.env.SUTRADHAR_LLM_BASE ?? 'http://localhost:11434',
      defaultModel: process.env.SUTRADHAR_MODEL ?? 'qwen3.5:9b',
    });
    console.log('[webbench] using local Ollama LLM provider (no OPENROUTER_API_KEY set)');
    return ollama;
  } catch (e) {
    console.warn(`[webbench] Ollama provider unavailable: ${e.message}`);
    return undefined;
  }
}

async function runOneTask(agentCore, runtime, task) {
  const start = Date.now();
  const { sessionId } = await runtime.launch({ launch: { headless: HEADLESS }, initialUrl: task.startingUrl });
  try {
    const goal = `On ${task.startingUrl}: ${task.task}`;
    const result = await agentCore.executeGoal(goal, sessionId);
    return {
      id: task.id,
      category: task.category,
      startingUrl: task.startingUrl,
      task: task.task,
      status: result.status,
      answer: result.answer ?? null,
      summary: result.summary ?? null,
      stepCount: result.steps?.length ?? 0,
      steps: result.steps ?? [],
      durationMs: Date.now() - start,
      harnessError: null,
    };
  } catch (err) {
    return {
      id: task.id,
      category: task.category,
      startingUrl: task.startingUrl,
      task: task.task,
      status: 'failed',
      answer: null,
      summary: null,
      stepCount: 0,
      steps: [],
      durationMs: Date.now() - start,
      harnessError: err.message,
    };
  } finally {
    await runtime.shutdown(sessionId).catch(() => {});
  }
}

async function main() {
  const { tasks, _source } = JSON.parse(readFileSync(path.join(__dirname, 'tasks.json'), 'utf-8'));
  const llmProvider = resolveLlmProvider();

  const runtime = new SutradharRuntime();
  const agentCore = new AgentCore({
    llmProviderAccessor: llmProvider ? () => llmProvider : undefined,
    sessionManager: runtime.getSessionManager(),
    eventBus: runtime.getEventBus(),
  });

  console.log(`[webbench] running ${tasks.length} tasks from ${_source}`);
  const results = [];
  for (const task of tasks) {
    console.log(`[webbench] [${task.id}] (${task.category}) starting...`);
    const result = await runOneTask(agentCore, runtime, task);
    console.log(`[webbench] [${task.id}] -> ${result.status}${result.harnessError ? ` (${result.harnessError})` : ''}`);
    results.push(result);
  }

  const outDir = path.join(__dirname, 'results');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const report = {
    ranAt: new Date().toISOString(),
    llmProviderAvailable: Boolean(llmProvider),
    taskSource: _source,
    summary: {
      total: results.length,
      completed: results.filter((r) => r.status === 'completed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      blocked: results.filter((r) => r.status !== 'completed' && r.status !== 'failed').length,
    },
    note:
      'WebBench itself uses human-in-the-loop scoring, not an automated answer key - `completed` here ' +
      'means the agent loop itself reported success, not that a human/judge verified the answer is ' +
      'actually correct. Review `answer`/`steps` per task for real scoring.',
    results,
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`[webbench] wrote ${outPath}`);
  console.log(`[webbench] ${report.summary.completed}/${report.summary.total} agent-reported-completed`);

  await runtime.shutdownAll().catch(() => {});
}

main().catch((err) => {
  console.error('[webbench] fatal:', err);
  process.exitCode = 1;
});
