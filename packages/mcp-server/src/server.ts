/**
 * @file packages/mcp-server/src/server.ts
 * @description Assembles the Sutradhar MCP server: a {@link SutradharRuntime} (the browser
 * engine façade) plus, when an LLM provider is available, an {@link AgentCore} for the
 * autonomous `agent.runGoal` tool. Mirrors the composition in
 * apps/server/src/runtime/dependency-container.ts.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SutradharRuntime,
  resolveFsRoots,
  fsRootsConfigLayer,
  resolveAllowedDomains,
  resolveIdleTimeoutMs,
  resolveRuntimeDialogPolicy,
  resolveViewport,
  type LoadedProjectConfig,
} from '@sutradhar/capability-runtime';
import type { DialogPolicy } from '@sutradhar/browser';
import { AgentCore } from '@sutradhar/agent';
import { OllamaAdapter, OpenRouterAdapter } from '@sutradhar/llm';
import type { ILlmProvider } from '@sutradhar/llm';
import { StructuredLogger } from '@sutradhar/observability';
import { registerTools, type AgentHandle } from './tools.js';
import { MCP_SERVER_VERSION } from './version.js';

/** Idle-session reaper default for the shipped MCP server: an MCP client (an LLM) can easily
 *  forget to call browser.shutdown after finishing with a session — without a default here, a
 *  forgotten session leaks its Chrome process for the lifetime of the server process. 30
 *  minutes is long enough not to interrupt a real, if slow, ongoing task, short enough that a
 *  genuinely abandoned session doesn't accumulate indefinitely. Override via
 *  `SUTRADHAR_IDLE_TIMEOUT_MS`, or pass `idleTimeoutMs: undefined`/`0` to disable entirely. */
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Constructor options for {@link createSutradharServer}. */
export interface CreateServerOptions {
  runtime?: SutradharRuntime;
  /** Force-disable the autonomous agent tool even if a provider is configured. */
  disableAgent?: boolean;
  /** Inject an explicit LLM provider; otherwise resolved from env. */
  llmProvider?: ILlmProvider;
  /**
   * Auto-close a session after this long with no observed activity. Defaults to 30 minutes
   * (or `SUTRADHAR_IDLE_TIMEOUT_MS` if set) so a session an MCP client forgets to shut down
   * doesn't leak its Chrome process for the life of the server. Pass `0` to disable. Ignored
   * if `runtime` is supplied directly (the caller owns that runtime's configuration).
   */
  idleTimeoutMs?: number;
  /**
   * When `true`, reject any navigation whose target isn't localhost, a private/loopback IP, or
   * a `file:`/`about:`/`data:` URL. Off by default — most MCP clients legitimately need to
   * browse the real internet. Also settable via `SUTRADHAR_RESTRICT_NAVIGATION_TO_LOCAL=1`.
   * Ignored if `runtime` is supplied directly (the caller owns that runtime's configuration).
   */
  restrictNavigationToLocal?: boolean;
  /**
   * When set (non-empty), reject any navigation whose hostname isn't one of these domains (or a
   * subdomain of one). Off by default. Also settable via `SUTRADHAR_ALLOWED_DOMAINS` as a
   * comma-separated list. Composable with `restrictNavigationToLocal` — both are enforced when
   * both are set. Ignored if `runtime` is supplied directly (the caller owns that runtime's
   * configuration). Intended for handing an agent a logged-in internal session safely, and as
   * partial prompt-injection defense-in-depth for navigation specifically — see the equivalent
   * doc comment on `SutradharRuntimeOptions.allowedDomains` for what this does and does not
   * cover (it gates `browser.navigate`/`launch`/`audit` (url/baselineUrl)/`new_tab`, not
   * page-initiated navigation from a clicked link, which the browser performs client-side).
   */
  allowedDomains?: readonly string[];
  /**
   * Directories `browser.download_file` may write into. Also settable via
   * `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` (path.delimiter-separated absolute paths; `~` expands to
   * the home directory). This REPLACES the default `<OS temp>/sutradhar-downloads` root — the
   * first entry becomes the destination when `downloadDir` is omitted. Ignored if `runtime` is
   * supplied directly.
   */
  allowedDownloadRoots?: readonly string[];
  /**
   * Directories `browser.upload_file`/`browser.upload_file_via_trigger` may read from. Also
   * settable via `SUTRADHAR_ALLOWED_UPLOAD_ROOTS`. Setting this TURNS ON the upload allowlist —
   * unset (the default) means unrestricted. Ignored if `runtime` is supplied directly.
   */
  allowedUploadRoots?: readonly string[];
  /**
   * A loaded `.sutradhar.json` (see `loadProjectConfig`): the LOWEST layer, below every option and
   * env var (precedence: option > env > config file > default). Never discovered here:
   * `createSutradharServer` stays independent of the cwd; only the `sutradhar-mcp` entry point
   * searches for the file and passes it in. Ignored for runtime construction if `runtime` is
   * supplied directly (but `defaultViewport` still applies at the tool level).
   */
  projectConfig?: LoadedProjectConfig;
  /**
   * Default native-dialog policy for sessions this server creates (`auto`, `report`, `accept`,
   * `dismiss`). Unset = the config file's `dialog`, else the runtime default (`auto`). Ignored if
   * `runtime` is supplied directly.
   */
  dialogPolicy?: DialogPolicy;
  /**
   * Viewport `browser.launch` uses when the call passes none (a call's own `viewport` always
   * wins). Unset = the config file's `viewport`, else Chrome's default.
   */
  defaultViewport?: { width: number; height: number };
  logger?: StructuredLogger;
}

/** Return value of {@link createSutradharServer}: the MCP server plus the runtime backing it,
 *  so a process entrypoint can shut the runtime down gracefully (closing browser sessions,
 *  stopping the idle reaper) on SIGINT/SIGTERM instead of leaking Chrome on every exit. */
export interface SutradharServerHandle {
  server: McpServer;
  runtime: SutradharRuntime;
}

/**
 * Build the Sutradhar {@link McpServer}. Browser tools are always registered; the
 * `agent.runGoal` tool is registered only when an LLM provider is available.
 */
export async function createSutradharServer(options: CreateServerOptions = {}): Promise<SutradharServerHandle> {
  const logger = options.logger ?? new StructuredLogger({ minLevel: 'info' });
  const restrictNavigationToLocal =
    options.restrictNavigationToLocal ?? process.env['SUTRADHAR_RESTRICT_NAVIGATION_TO_LOCAL'] === '1';
  const cfg = options.projectConfig;
  // Precedence for every setting below is ONE rule (config-precedence.ts): option > env > config
  // file > default. The file can never override anything set explicitly.
  const viewport = resolveViewport({ option: options.defaultViewport, config: cfg });
  let runtime: SutradharRuntime;
  if (options.runtime) {
    runtime = options.runtime;
  } else {
    // Throws on a malformed SUTRADHAR_IDLE_TIMEOUT_MS instead of silently disabling the reaper.
    const idle = resolveIdleTimeoutMs({
      option: options.idleTimeoutMs,
      env: process.env,
      config: cfg,
      fallback: DEFAULT_IDLE_TIMEOUT_MS,
    });
    const domains = resolveAllowedDomains({ option: options.allowedDomains, env: process.env, config: cfg });
    const dialog = resolveRuntimeDialogPolicy({ option: options.dialogPolicy, config: cfg, surface: 'mcp' });
    const fsRoots = resolveFsRoots({
      options: { allowedDownloadRoots: options.allowedDownloadRoots, allowedUploadRoots: options.allowedUploadRoots },
      env: process.env,
      config: fsRootsConfigLayer(cfg),
    });
    // MCP stdout is JSON-RPC — any startup diagnostic MUST go to stderr, never stdout (B11).
    for (const w of [...fsRoots.warnings, ...dialog.warnings]) console.error(`[sutradhar-mcp] warning: ${w}`);
    runtime = new SutradharRuntime({
      logger,
      idleTimeoutMs: idle.value,
      restrictNavigationToLocal,
      allowedDomains: domains.value,
      allowedDownloadRoots: fsRoots.allowedDownloadRoots,
      allowedUploadRoots: fsRoots.allowedUploadRoots,
      dialogPolicy: dialog.value,
    });
  }

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
    name: 'sutradhar',
    version: MCP_SERVER_VERSION,
  });

  registerTools(server, { runtime, agent, defaultViewport: viewport.value });
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
    logger.info('sutradhar-mcp: using OpenRouter LLM provider');
    return new OpenRouterAdapter({ apiKey: openrouterKey, logger });
  }
  // Default to local Ollama (free). If it isn't running, browser tools still work.
  try {
    const ollama = new OllamaAdapter({
      host: process.env['SUTRADHAR_LLM_BASE'] ?? 'http://localhost:11434',
      defaultModel: process.env['SUTRADHAR_MODEL'] ?? 'qwen3.5:9b',
      logger,
    });
    logger.info('sutradhar-mcp: using local Ollama LLM provider (no OPENROUTER_API_KEY set)');
    return ollama;
  } catch (e) {
    logger.warn(`sutradhar-mcp: Ollama provider unavailable, agent.runGoal disabled: ${(e as Error).message}`);
    return undefined;
  }
}
