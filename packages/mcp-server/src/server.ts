/**
 * @file packages/mcp-server/src/server.ts
 * @description Assembles the PinchTab MCP server: a {@link PinchTabRuntime} (the browser
 * engine façade) plus, when an LLM provider is available, an {@link AgentCore} for the
 * autonomous `agent.runGoal` tool. Mirrors the composition in
 * apps/server/src/runtime/dependency-container.ts.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PinchTabRuntime } from '@pinchtab/capability-runtime';
import { AgentCore } from '@pinchtab/agent';
import { OllamaAdapter, OpenRouterAdapter } from '@pinchtab/llm';
import type { ILlmProvider } from '@pinchtab/llm';
import { StructuredLogger } from '@pinchtab/observability';
import { registerTools, type AgentHandle } from './tools.js';

/** Idle-session reaper default for the shipped MCP server: an MCP client (an LLM) can easily
 *  forget to call browser.shutdown after finishing with a session — without a default here, a
 *  forgotten session leaks its Chrome process for the lifetime of the server process. 30
 *  minutes is long enough not to interrupt a real, if slow, ongoing task, short enough that a
 *  genuinely abandoned session doesn't accumulate indefinitely. Override via
 *  `PINCHTAB_IDLE_TIMEOUT_MS`, or pass `idleTimeoutMs: undefined`/`0` to disable entirely. */
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Constructor options for {@link createPinchTabServer}. */
export interface CreateServerOptions {
  runtime?: PinchTabRuntime;
  /** Force-disable the autonomous agent tool even if a provider is configured. */
  disableAgent?: boolean;
  /** Inject an explicit LLM provider; otherwise resolved from env. */
  llmProvider?: ILlmProvider;
  /**
   * Auto-close a session after this long with no observed activity. Defaults to 30 minutes
   * (or `PINCHTAB_IDLE_TIMEOUT_MS` if set) so a session an MCP client forgets to shut down
   * doesn't leak its Chrome process for the life of the server. Pass `0` to disable. Ignored
   * if `runtime` is supplied directly (the caller owns that runtime's configuration).
   */
  idleTimeoutMs?: number;
  /**
   * When `true`, reject any navigation whose target isn't localhost, a private/loopback IP, or
   * a `file:`/`about:`/`data:` URL. Off by default — most MCP clients legitimately need to
   * browse the real internet. Also settable via `PINCHTAB_RESTRICT_NAVIGATION_TO_LOCAL=1`.
   * Ignored if `runtime` is supplied directly (the caller owns that runtime's configuration).
   */
  restrictNavigationToLocal?: boolean;
  logger?: StructuredLogger;
}

/** Return value of {@link createPinchTabServer}: the MCP server plus the runtime backing it,
 *  so a process entrypoint can shut the runtime down gracefully (closing browser sessions,
 *  stopping the idle reaper) on SIGINT/SIGTERM instead of leaking Chrome on every exit. */
export interface PinchTabServerHandle {
  server: McpServer;
  runtime: PinchTabRuntime;
}

/**
 * Build the PinchTab {@link McpServer}. Browser tools are always registered; the
 * `agent.runGoal` tool is registered only when an LLM provider is available.
 */
export async function createPinchTabServer(options: CreateServerOptions = {}): Promise<PinchTabServerHandle> {
  const logger = options.logger ?? new StructuredLogger({ minLevel: 'info' });
  const idleTimeoutMs =
    options.idleTimeoutMs ??
    (process.env['PINCHTAB_IDLE_TIMEOUT_MS'] ? Number(process.env['PINCHTAB_IDLE_TIMEOUT_MS']) : DEFAULT_IDLE_TIMEOUT_MS);
  const restrictNavigationToLocal =
    options.restrictNavigationToLocal ?? process.env['PINCHTAB_RESTRICT_NAVIGATION_TO_LOCAL'] === '1';
  const runtime =
    options.runtime ??
    new PinchTabRuntime({
      logger,
      idleTimeoutMs: idleTimeoutMs > 0 ? idleTimeoutMs : undefined,
      restrictNavigationToLocal,
    });

  // Resolve an LLM provider for the autonomous agent (optional).
  const llmProvider = options.llmProvider ?? resolveLlmProvider(logger);
  let agent: AgentHandle | undefined;
  if (llmProvider && !options.disableAgent) {
    const agentCore = new AgentCore({
      llmProviderAccessor: () => llmProvider,
      sessionManager: runtime.getSessionManager(),
      // Without this, the agent loop's domain events (e.g. `session:blocked` when it hits a
      // CAPTCHA/auth wall/stuck loop) are published on a bus nothing else is listening to —
      // sharing the runtime's own bus lets agent.runGoal subscribe and surface them.
      eventBus: runtime.getEventBus(),
      logger,
    });
    agent = { agentCore };
  }

  const server = new McpServer({
    name: 'pinchtab',
    version: '0.1.0',
  });

  registerTools(server, { runtime, agent });
  return { server, runtime };
}

/**
 * Resolve an LLM provider from environment variables.
 *
 * Selection rule (matches apps/server composition): if OPENROUTER_API_KEY is set, use
 * OpenRouter; otherwise use local Ollama (free). Returns undefined if neither is reachable
 * — in which case the autonomous agent tool is simply omitted and only browser.* tools run.
 *
 * We do NOT throw on unreachable providers: an MCP client may legitimately want only the
 * browser tools (host AI is the brain). The agent tool's description makes the requirement
 * explicit so the model is told when autonomous mode is unavailable.
 */
function resolveLlmProvider(logger: StructuredLogger): ILlmProvider | undefined {
  const openrouterKey = process.env['OPENROUTER_API_KEY'];
  if (openrouterKey) {
    logger.info('pinchtab-mcp: using OpenRouter LLM provider');
    return new OpenRouterAdapter({ apiKey: openrouterKey, logger });
  }
  // Default to local Ollama (free). If it isn't running, browser tools still work.
  try {
    const ollama = new OllamaAdapter({
      host: process.env['PINCHTAB_LLM_BASE'] ?? 'http://localhost:11434',
      defaultModel: process.env['PINCHTAB_MODEL'] ?? 'qwen3.5:9b',
      logger,
    });
    logger.info('pinchtab-mcp: using local Ollama LLM provider (no OPENROUTER_API_KEY set)');
    return ollama;
  } catch (e) {
    logger.warn(`pinchtab-mcp: Ollama provider unavailable, agent.runGoal disabled: ${(e as Error).message}`);
    return undefined;
  }
}
